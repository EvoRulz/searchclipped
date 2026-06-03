'use strict';
/*
 * state.js — all app state lives in a single JSON blob in localStorage.
 *
 * Shape:
 * {
 *   items:      Item[],
 *   sortMode:   'bump' | 'created' | 'modified',
 *   starFilter: boolean,
 *   permissions: { [permName]: 'granted' | 'denied' | 'never' },
 *   undoStack:  Item[][],   // snapshots of items array
 *   redoStack:  Item[][]
 * }
 *
 * Item shape:
 * {
 *   id, text, html, imageId,
 *   tags: string[],
 *   starred, deleted,
 *   createdAt, modifiedAt,   // ISO strings
 *   bumpOrder                // integer; lower = higher in bump-sort
 * }
 */
var STORAGE_KEY = 'searchclipped_state';
var MAX_UNDO    = 50;
var DEFAULT_STATE = {
  items:       [],
  sortMode:    'bump',
  starFilter:  false,
  permissions: {},
  undoStack:   [],
  redoStack:   []
};
function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();
    var parsed = JSON.parse(raw);
    var merged = cloneDefault();
    // Merge top-level keys
    Object.keys(parsed).forEach(function (k) {
      merged[k] = parsed[k];
    });
    // Ensure undoStack / redoStack exist
    if (!Array.isArray(merged.undoStack)) merged.undoStack = [];
    if (!Array.isArray(merged.redoStack)) merged.redoStack = [];
    merged.items.forEach(function (item) {
      if (!Array.isArray(item.versions))      item.versions = [];
      if (!Array.isArray(item.itemUndoStack)) item.itemUndoStack = [];
      if (!Array.isArray(item.itemRedoStack)) item.itemRedoStack = [];
      if (item.versionName === undefined)     item.versionName = '';
      var _seenK = [], _deduped = [];
      for (var _vi = item.versions.length - 1; _vi >= 0; _vi--) {
        var _vk = _vKey(item.versions[_vi]);
        if (_seenK.indexOf(_vk) === -1) { _seenK.push(_vk); _deduped.unshift(item.versions[_vi]); }
      }
      item.versions = _deduped;
    });
    saveState(merged);
    return merged;
  } catch (e) {
    console.error('loadState error', e);
    return cloneDefault();
  }
}
function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
function _vKey(v) {
  var t = (v.title || '').replace(/\s*\(preview\)$/i, '');
  return (v.text || '').trim() + '\x00' + t.trim() + '\x00' + JSON.stringify((v.tags || []).slice().sort());
}
function saveState(state) {
  try {
    state.items.forEach(function (item) {
      if (!item.versions) return;
      var _seenK2 = [], _deduped2 = [];
      for (var _vi2 = item.versions.length - 1; _vi2 >= 0; _vi2--) {
        var _vk2 = _vKey(item.versions[_vi2]);
        if (_seenK2.indexOf(_vk2) === -1) { _seenK2.push(_vk2); _deduped2.unshift(item.versions[_vi2]); }
      }
      item.versions = _deduped2;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('saveState error', e);
    alert('Storage limit reached — please export and delete old items.');
  }
}
function generateId() {
  return 'i' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
function nowISO() {
  return new Date().toISOString();
}
/* Snapshot items array (metadata only, no blobs) */
function snapshotItems(state) {
  return JSON.parse(JSON.stringify(state.items));
}
function pushUndo(state) {
  state.undoStack.push(snapshotItems(state));
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
}
function undo(state) {
  if (!state.undoStack.length) return false;
  state.redoStack.push(snapshotItems(state));
  state.items = state.undoStack.pop();
  return true;
}
function redo(state) {
  if (!state.redoStack.length) return false;
  state.undoStack.push(snapshotItems(state));
  state.items = state.redoStack.pop();
  return true;
}
function createItem(text, html, imageId) {
  var now = nowISO();
  return {
    id:         generateId(),
    text:       text    || '',
    html:       html    || '',
    title:      '',
    imageId:    imageId || null,
    tags:       [],
    starred:    false,
    deleted:    false,
    createdAt:  now,
    modifiedAt: now,
    bumpOrder:     0,
    restoredAt:    null,
    versions:      [],
    versionName:   '',
    itemUndoStack: [],
    itemRedoStack: []
  };
}
function getItem(state, id) {
  for (var i = 0; i < state.items.length; i++) {
    if (state.items[i].id === id) return state.items[i];
  }
  return null;
}
function upsertItem(state, item) {
  var idx = state.items.findIndex(function (it) { return it.id === item.id; });
  if (idx >= 0) state.items[idx] = item;
  else          state.items.push(item);
}
/* Normalise bumpOrder to 0…n for non-deleted items */
function reindexBumpOrder(state) {
  var active = state.items
    .filter(function (i) { return !i.deleted; })
    .sort(function (a, b) { return a.bumpOrder - b.bumpOrder; });
  active.forEach(function (item, idx) { item.bumpOrder = idx; });
}
function bumpItem(state, id, direction) {
  reindexBumpOrder(state);
  var active = state.items
    .filter(function (i) { return !i.deleted; })
    .sort(function (a, b) { return a.bumpOrder - b.bumpOrder; });
  var idx = active.findIndex(function (i) { return i.id === id; });
  if (idx < 0) return;
  var targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= active.length) return;
  var tmp = active[idx].bumpOrder;
  active[idx].bumpOrder    = active[targetIdx].bumpOrder;
  active[targetIdx].bumpOrder = tmp;
}
/* Returns Set of IDs for the top-N bump-sorted non-deleted items */
function getTopBumped(state, n) {
  n = n || 10;
  var active = state.items
    .filter(function (i) { return !i.deleted; })
    .sort(function (a, b) { return a.bumpOrder - b.bumpOrder; });
  var result = new Set();
  for (var i = 0; i < Math.min(n, active.length); i++) {
    result.add(active[i].id);
  }
  return result;
}
/* Per-item version history helpers */
function pushItemUndo(item, snapshot) {
  item.itemUndoStack = item.itemUndoStack || [];
  item.itemUndoStack.push(snapshot);
  if (item.itemUndoStack.length > 50) item.itemUndoStack.shift();
  item.itemRedoStack = [];
}
function _vKey(v) {
  var t = (v.title || '').replace(/\s*\(preview\)$/i, '');
  return (v.text || '').trim() + '\x00' + t.trim() + '\x00' + JSON.stringify((v.tags || []).slice().sort());
}
function addItemVersion(item, snapshot) {
  item.versions = item.versions || [];
  var snapKey = _vKey(snapshot);
  var isDup = item.versions.some(function (v) { return _vKey(v) === snapKey; });
  if (!isDup) item.versions.push(snapshot);
}
function itemUndo(item) {
  item.itemUndoStack = item.itemUndoStack || [];
  item.itemRedoStack = item.itemRedoStack || [];
  if (!item.itemUndoStack.length) return false;
  item.itemRedoStack.push({
    text: item.text, html: item.html, title: item.title,
    tags: (item.tags || []).slice()
  });
  var snap = item.itemUndoStack.pop();
  item.text  = snap.text;  item.html  = snap.html;
  item.title = snap.title; item.tags  = snap.tags || [];
  item.modifiedAt = nowISO();
  return true;
}
function itemRedo(item) {
  item.itemUndoStack = item.itemUndoStack || [];
  item.itemRedoStack = item.itemRedoStack || [];
  if (!item.itemRedoStack.length) return false;
  item.itemUndoStack.push({
    text: item.text, html: item.html, title: item.title,
    tags: (item.tags || []).slice()
  });
  var snap = item.itemRedoStack.pop();
  item.text  = snap.text;  item.html  = snap.html;
  item.title = snap.title; item.tags  = snap.tags || [];
  item.modifiedAt = nowISO();
  return true;
}
window.State = {
  loadState,
  saveState,
  generateId,
  nowISO,
  pushUndo,
  undo,
  redo,
  createItem,
  getItem,
  upsertItem,
  reindexBumpOrder,
  bumpItem,
  getTopBumped,
  pushItemUndo,
  addItemVersion,
  itemUndo,
  itemRedo
};

