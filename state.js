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
var MAX_UNDO    = 40;
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
    merged.undoStack = [];
    merged.redoStack = [];
    merged.items.forEach(function (item) {
      if (!Array.isArray(item.versions))      item.versions = [];
      if (!Array.isArray(item.itemUndoStack)) item.itemUndoStack = [];
      if (!Array.isArray(item.itemRedoStack)) item.itemRedoStack = [];
      if (item.versionName === undefined)     item.versionName = '';
      var _sk = [], _dv = [];
      for (var _i = item.versions.length - 1; _i >= 0; _i--) {
        var _k = _vKey(item.versions[_i]);
        if (_sk.indexOf(_k) === -1) { _sk.push(_k); _dv.unshift(item.versions[_i]); }
      }
      item.versions = _dv;
    purgeOrphanedItemUndoRedo(item);
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
function saveState(state) {
  try {
    state.items.forEach(function (item) {
      if (!item.versions) return;
      var _sk2 = [], _dv2 = [];
      for (var _i2 = item.versions.length - 1; _i2 >= 0; _i2--) {
        var _k2 = _vKey(item.versions[_i2]);
        if (_sk2.indexOf(_k2) === -1) { _sk2.push(_k2); _dv2.unshift(item.versions[_i2]); }
      }
      item.versions = _dv2;
    });
    var _toSave = Object.assign({}, state, { undoStack: [], redoStack: [] });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_toSave));
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
  return state.items.map(function (item) {
    var copy = JSON.parse(JSON.stringify(item));
    delete copy.itemUndoStack;
    delete copy.itemRedoStack;
    return copy;
  });
}
/* ===== UNDO DIFF HELPERS ===== */
function _computeDiff(prevSnap, nextSnap) {
  var prevMap = {};
  prevSnap.forEach(function (i) { prevMap[i.id] = i; });
  var nextMap = {};
  nextSnap.forEach(function (i) { nextMap[i.id] = i; });
  var added = [], removed = [], modified = [];
  nextSnap.forEach(function (item) {
    if (!prevMap[item.id]) {
      added.push(item);
    } else {
      var prev = prevMap[item.id];
      var after = {}, before = {};
      var changed = false;
      var allKeys = {};
      Object.keys(item).forEach(function (k) { allKeys[k] = true; });
      Object.keys(prev).forEach(function (k) { allKeys[k] = true; });
      Object.keys(allKeys).forEach(function (f) {
        var a = JSON.stringify(prev[f]);
        var b = JSON.stringify(item[f]);
        if (a !== b) { after[f] = item[f]; before[f] = prev[f]; changed = true; }
      });
      if (changed) modified.push({ id: item.id, after: after, before: before });
    }
  });
  prevSnap.forEach(function (item) { if (!nextMap[item.id]) removed.push(item); });
  return { added: added, removed: removed, modified: modified };
}
function _applyDiff(snap, diff) {
  var removedIds = {};
  diff.removed.forEach(function (i) { removedIds[i.id] = true; });
  var result = snap.filter(function (i) { return !removedIds[i.id]; });
  diff.added.forEach(function (item) { result.push(JSON.parse(JSON.stringify(item))); });
  diff.modified.forEach(function (mod) {
    var idx = result.findIndex(function (i) { return i.id === mod.id; });
    if (idx >= 0) result[idx] = Object.assign({}, result[idx], mod.after);
  });
  return result;
}
function _computeStackDiffs(stack) {
  if (!stack.length) return { base: [], diffs: [] };
  var base = stack[0];
  var diffs = [];
  for (var i = 1; i < stack.length; i++) { diffs.push(_computeDiff(stack[i - 1], stack[i])); }
  return { base: base, diffs: diffs };
}
function _reconstructStack(stored) {
  if (!stored || !stored.base) return [];
  var result = [stored.base];
  for (var i = 0; i < stored.diffs.length; i++) {
    result.push(_applyDiff(result[result.length - 1], stored.diffs[i]));
  }
  return result;
}
function _dedupeStack(stack) {
  if (stack.length < 2) return stack;
  var result = [stack[0]];
  for (var i = 1; i < stack.length; i++) {
    if (JSON.stringify(stack[i]) !== JSON.stringify(result[result.length - 1])) result.push(stack[i]);
  }
  return result;
}
function _persistStacks(state) {
  var undoData = _computeStackDiffs(state.undoStack);
  var redoData = _computeStackDiffs(state.redoStack);
  Promise.all([
    DB.saveUndoStack('undo', undoData),
    DB.saveUndoStack('redo', redoData)
  ]).catch(function (e) { console.error('_persistStacks failed', e); });
}
async function initUndoFromDB(state) {
  try {
    var undoData = await DB.loadUndoStack('undo');
    var redoData = await DB.loadUndoStack('redo');
    state.undoStack = undoData ? _reconstructStack(undoData) : [];
    state.redoStack = redoData ? _reconstructStack(redoData) : [];
  } catch (e) {
    console.error('initUndoFromDB failed', e);
    state.undoStack = [];
    state.redoStack = [];
  }
}
/* ===== UNDO / REDO ===== */
function pushUndo(state) {
  state.undoStack.push(snapshotItems(state));
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
  _persistStacks(state);
}
function undo(state) {
  if (!state.undoStack.length) return false;
  var liveStacks = {};
  state.items.forEach(function (i) {
    liveStacks[i.id] = { itemUndoStack: i.itemUndoStack || [], itemRedoStack: i.itemRedoStack || [] };
  });
  state.redoStack.push(snapshotItems(state));
  state.items = state.undoStack.pop().map(function (item) {
    var stacks = liveStacks[item.id] || { itemUndoStack: [], itemRedoStack: [] };
    return Object.assign({}, item, stacks);
  });
  _persistStacks(state);
  return true;
}
function redo(state) {
  if (!state.redoStack.length) return false;
  var liveStacks = {};
  state.items.forEach(function (i) {
    liveStacks[i.id] = { itemUndoStack: i.itemUndoStack || [], itemRedoStack: i.itemRedoStack || [] };
  });
  state.undoStack.push(snapshotItems(state));
  state.items = state.redoStack.pop().map(function (item) {
    var stacks = liveStacks[item.id] || { itemUndoStack: [], itemRedoStack: [] };
    return Object.assign({}, item, stacks);
  });
  _persistStacks(state);
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
  return (v.text || '').trim() + '\x00' + t.trim() + '\x00' + (v.deleted ? '1' : '0');
}
function addItemVersion(item, snapshot) {
  item.versions = item.versions || [];
  var snapText  = (snapshot.text  || '').trim();
  var snapTitle = (snapshot.title || '').replace(/\s*\(preview\)$/i, '').trim();
  var existingIdx = -1;
  for (var i = 0; i < item.versions.length; i++) {
    var v = item.versions[i];
    if ((v.text || '').trim() === snapText && (v.title || '').replace(/\s*\(preview\)$/i, '').trim() === snapTitle) {
      existingIdx = i;
      break;
    }
  }
  if (existingIdx >= 0) {
    if (!item.versions[existingIdx].deleted) return;
    item.versions.splice(existingIdx, 1);
  }
  item.versions.push(snapshot);
}
function dedupeVersions(item) {
  if (!item.versions || !item.versions.length) return false;
  var liveText  = (item.text  || '').trim();
  var liveTitle = (item.title || '').replace(/\s*\(preview\)$/i, '').trim();
  var reversed  = item.versions.slice().reverse();
  var seen      = {};
  var deduped   = [];
  var changed   = false;
  for (var i = 0; i < reversed.length; i++) {
    var v = reversed[i];
    var k = (v.text || '').trim() + '\x00' + (v.title || '').replace(/\s*\(preview\)$/i, '').trim();
    if (k === liveText + '\x00' + liveTitle) { changed = true; continue; }
    if (seen[k] !== undefined) {
      var _ex = deduped[seen[k]];
      if (_ex.deleted && !v.deleted) {
        if (_ex.name && !v.name) v = Object.assign({}, v, { name: _ex.name });
        deduped[seen[k]] = v;
      } else if (!_ex.deleted && !_ex.name && v.name && !v.deleted) {
        deduped[seen[k]] = Object.assign({}, _ex, { name: v.name });
      }
      changed = true;
    } else {
      seen[k] = deduped.length;
      deduped.push(v);
    }
  }
  if (changed) item.versions = deduped.reverse();
  return changed;
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
function purgeOrphanedItemUndoRedo(item) {
  var versions = item.versions || [];
  var validKeys = new Set();
  versions.forEach(function (v) {
    validKeys.add((v.text || '').trim() + '\x00' + (v.title || '').replace(/\s*\(preview\)$/i, '').trim());
  });
  validKeys.add((item.text || '').trim() + '\x00' + (item.title || '').replace(/\s*\(preview\)$/i, '').trim());
  function filterStack(stack) {
    return (stack || []).filter(function (snap) {
      return validKeys.has((snap.text || '').trim() + '\x00' + (snap.title || '').replace(/\s*\(preview\)$/i, '').trim());
    });
  }
  var origUndoLen = (item.itemUndoStack || []).length;
  var origRedoLen = (item.itemRedoStack || []).length;
  item.itemUndoStack = filterStack(item.itemUndoStack);
  item.itemRedoStack = filterStack(item.itemRedoStack);
  return item.itemUndoStack.length !== origUndoLen || item.itemRedoStack.length !== origRedoLen;
}
function purgeBurnedItemFromStacks(state, id) {
  purgeAllBurnedFromStacks(state, new Set([id]));
}
function purgeAllBurnedFromStacks(state, idSet) {
  function purge(stack) {
    for (var i = 0; i < stack.length; i++) {
      stack[i] = stack[i].filter(function (item) { return !idSet.has(item.id); });
    }
  }
  purge(state.undoStack);
  purge(state.redoStack);
  state.undoStack = _dedupeStack(state.undoStack);
  state.redoStack = _dedupeStack(state.redoStack);
  _persistStacks(state);
}
function purgeVersionsFromStacks(state, itemId, tsList) {
  if (!tsList || !tsList.length) return;
  var tsSet = {};
  tsList.forEach(function (ts) { tsSet[ts] = true; });
  function purge(stack) {
    for (var i = 0; i < stack.length; i++) {
      var snapshot = stack[i];
      for (var j = 0; j < snapshot.length; j++) {
        if (snapshot[j].id === itemId && snapshot[j].versions) {
          snapshot[j].versions = snapshot[j].versions.filter(function (v) { return !tsSet[v.ts]; });
        }
      }
    }
  }
  purge(state.undoStack);
  purge(state.redoStack);
  state.undoStack = _dedupeStack(state.undoStack);
  state.redoStack = _dedupeStack(state.redoStack);
  _persistStacks(state);
}
function purgeContentFromUndoStacks(state, itemId, tsList) {
  if (!tsList || !tsList.length) return;
  var tsSet = new Set(tsList);
  state.undoStack = state.undoStack.filter(function (snapshot) {
    return !snapshot.some(function (i) { return i.id === itemId && tsSet.has(i.modifiedAt); });
  });
  state.redoStack = state.redoStack.filter(function (snapshot) {
    return !snapshot.some(function (i) { return i.id === itemId && tsSet.has(i.modifiedAt); });
  });
  state.undoStack = _dedupeStack(state.undoStack);
  state.redoStack = _dedupeStack(state.redoStack);
  _persistStacks(state);
}
function purgeBurnedFromStacks(state, idSet) {
  function _filt(stack) {
    for (var i = 0; i < stack.length; i++) {
      stack[i] = stack[i].filter(function (item) { return !idSet.has(item.id); });
    }
    var out = [];
    for (var j = 0; j < stack.length; j++) {
      var sig = stack[j].map(function (it) { return it.id + '|' + it.modifiedAt; }).join(',');
      if (!out.length || sig !== out[out.length - 1]._sig) out.push({ snap: stack[j], _sig: sig });
    }
    return out.map(function (d) { return d.snap; });
  }
  state.undoStack = _filt(state.undoStack);
  state.redoStack = _filt(state.redoStack);
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
  dedupeVersions,
  itemUndo,
  itemRedo,
  purgeOrphanedItemUndoRedo,
  purgeBurnedItemFromStacks,
  purgeAllBurnedFromStacks,
  purgeVersionsFromStacks,
  purgeContentFromUndoStacks,
  initUndoFromDB
};

