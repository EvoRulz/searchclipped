'use strict';
/*
 * items.js
 * Handles all item CRUD events dispatched from render.js.
 * Exported on window.Items
 */
var _state     = null;
var _refresh   = null; // callback to re-render
function init(state, refreshFn) {
  _state   = state;
  _refresh = refreshFn;
  document.addEventListener('sc:create-item',    _onCreate);
  document.addEventListener('sc:edit-item',      _onEdit);
  document.addEventListener('sc:copy-item',      _onCopy);
  document.addEventListener('sc:share-item',     _onShare);
  document.addEventListener('sc:toggle-select',  _onToggleSelect);
  document.addEventListener('sc:toggle-star',    _onToggleStar);
  document.addEventListener('sc:bump',           _onBump);
  document.addEventListener('sc:swipe-delete',   _onSwipeDelete);
  document.addEventListener('sc:restore-item',   _onRestore);
  document.addEventListener('sc:open-tags',      _onOpenTags);
  document.addEventListener('sc:enter-tag-sel-mode', _onEnterTagSelMode);
 document.addEventListener('sc:edit-title',         _onEditTitle);
  document.addEventListener('sc:create-image',       function (e) { _createImageItem(e.detail.blob); });
  document.addEventListener('paste',                 _onPaste);
  document.addEventListener('sc:toggle-tag-sel',   _onToggleTagSel);
  document.addEventListener('sc:item-undo',         _onItemUndo);
  document.addEventListener('sc:item-redo',         _onItemRedo);
  document.addEventListener('sc:restore-version',   _onRestoreVersion);
  document.addEventListener('sc:name-version',      _onNameVersion);
  document.addEventListener('sc:version-delete',    _onVersionDelete);
  document.addEventListener('sc:version-undelete',    _onVersionUndelete);
  document.addEventListener('sc:version-hard-delete', _onVersionHardDelete);
  document.addEventListener('sc:hard-delete',         _onHardDelete);
}
/* ====== CREATE ====== */
function _onCreate(e) {
  var text = (e.detail.text || '').trim();
  if (!text) return;
  State.pushUndo(_state);
  var item = State.createItem(text, e.detail.html || text, null);
  if (e.detail.title) item.title = e.detail.title.trim();
  // Give it the next bumpOrder slot at the top
  State.reindexBumpOrder(_state);
  // Insert at position 0 by giving it bumpOrder = -1 then reindexing
  _state.items.forEach(function (i) { if (!i.deleted) i.bumpOrder += 1; });
  item.bumpOrder = 0;
  _state.items.unshift(item);
  State.saveState(_state);
  _refresh();
}
/* ====== EDIT ====== */
function _onEdit(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || item.deleted) return;
  var oldSnap = {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || ''
  };
  State.pushUndo(_state);
  item.text        = e.detail.text || '';
  item.html        = e.detail.html || item.text;
  item.modifiedAt  = State.nowISO();
  item.versionName = '';
  State.pushItemUndo(item, oldSnap);
  var _isDup = item.versions && item.versions.some(function (v) { return !v.deleted && v.text === oldSnap.text && v.title === oldSnap.title; });
  if (!_isDup) State.addItemVersion(item, oldSnap);
  State.saveState(_state);
  _refresh();
}
/* ====== EDIT TITLE ====== */
function _onEditTitle(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || item.deleted) return;
  var oldSnap = {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || ''
  };
  State.pushUndo(_state);
  item.title       = e.detail.title || '';
  item.modifiedAt  = State.nowISO();
  item.versionName = '';
  State.pushItemUndo(item, oldSnap);
  var _isDupTi = item.versions && item.versions.some(function (v) { return !v.deleted && v.text === oldSnap.text && v.title === oldSnap.title; });
  if (!_isDupTi) State.addItemVersion(item, oldSnap);
  State.saveState(_state);
  _refresh();
}
/* ====== COPY ====== */
function _onCopy(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  Clip.writeItem(item);
}
/* ====== SHARE ====== */
function _onShare(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  Clip.shareImage(item);
}
/* ====== SELECT ====== */
var _selectedIds = new Set();
function getSelectedIds() { return _selectedIds; }
function _onToggleSelect(e) {
  var id = e.detail.id;
  if (_selectedIds.has(id)) _selectedIds.delete(id);
  else                       _selectedIds.add(id);
  _refresh();
}
function selectAll(items) {
  items.forEach(function (i) { _selectedIds.add(i.id); });
  _refresh();
}
function selectFiltered(filtered) {
  _selectedIds.clear();
  filtered.forEach(function (i) { _selectedIds.add(i.id); });
  _refresh();
}
function clearSelection() {
  _selectedIds.clear();
  _refresh();
}
/* ====== STAR ====== */
function _onToggleStar(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  State.pushUndo(_state);
  item.starred    = !item.starred;
  item.modifiedAt = State.nowISO();
  State.saveState(_state);
  _refresh();
}
/* ====== BUMP ====== */
function _onBump(e) {
  var id  = e.detail.id;
  var dir = e.detail.dir; // -1 = up, 1 = down
  State.pushUndo(_state);
  if (_state.sortMode === 'bump') {
    State.bumpItem(_state, id, dir);
  } else {
    // In date modes, bump promotes item into top-10 bump list
    // by assigning it bumpOrder 0 and shifting others down
    State.reindexBumpOrder(_state);
    var active = _state.items
      .filter(function (i) { return !i.deleted; })
      .sort(function (a, b) { return a.bumpOrder - b.bumpOrder; });
    active.forEach(function (i) { i.bumpOrder += 1; });
    var target = State.getItem(_state, id);
    if (target) target.bumpOrder = 0;
    State.reindexBumpOrder(_state);
  }
  _state.items.forEach(function (i) {
    if (!i.deleted) i.modifiedAt = i.modifiedAt; // no-op; keep timestamps
  });
  State.saveState(_state);
  _refresh();
}
/* ====== DELETE (swipe) ====== */
function _onSwipeDelete(e) {
  _doDelete([e.detail.id], 'Delete this item? Type "yes" to confirm.');
}
/* ====== BULK DELETE ====== */
function bulkDelete(ids) {
  if (!ids.size) return;
  _doDelete(Array.from(ids),
    'Delete ' + ids.size + ' item(s)?\nType "yes" to confirm.');
}
async function _doDelete(ids, message) {
  var ok = await Modals.confirm(message);
  if (!ok) return;
  State.pushUndo(_state);
  ids.forEach(function (id) {
    var item = State.getItem(_state, id);
    if (item) {
      item.deleted    = true;
      item.starred    = false;
      item.bumpOrder  = item.bumpOrder + 0.5;
      item.modifiedAt = State.nowISO();
    }
  });
  _selectedIds.clear();
  State.saveState(_state);
  _refresh();
}
/* ====== RESTORE ====== */
async function _onRestore(e) {
  var ok = await Modals.confirm('Restore this item? Type "yes" to confirm.');
  if (!ok) return;
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  State.pushUndo(_state);
  item.deleted    = false;
  item.bumpOrder  = Math.floor(item.bumpOrder);
  item.restoredAt = State.nowISO();
  item.modifiedAt = State.nowISO();
  State.saveState(_state);
  _refresh();
}
/* ====== HARD DELETE ====== */
async function _onHardDelete(e) {
  var ok = await Modals.confirm('Permanently destroy this item? This cannot be undone.', 'burn');
  if (!ok) return;
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  if (item.imageId) {
    DB.deleteImage(item.imageId).catch(function (err) { console.warn('deleteImage failed', err); });
  }
  State.purgeBurnedItemFromStacks(_state, item.id);
  _state.items = _state.items.filter(function (i) { return i.id !== item.id; });
  _selectedIds.delete(item.id);
  State.saveState(_state);
  _refresh();
}
/* ====== TAGS ====== */
function _onOpenTags(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  var oldSnap = {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || ''
  };
  Modals.openTagEditor(_state, e.detail.id, function (changedItem) {
    var tagsChanged = JSON.stringify(oldSnap.tags) !== JSON.stringify(changedItem.tags);
    if (tagsChanged) {
      changedItem.modifiedAt  = State.nowISO();
      changedItem.versionName = '';
      State.pushUndo(_state);
      State.pushItemUndo(changedItem, oldSnap);
      var _isDupT = changedItem.versions && changedItem.versions.some(function (v) { return !v.deleted && v.text === oldSnap.text && v.title === oldSnap.title; });
      if (!_isDupT) State.addItemVersion(changedItem, oldSnap);
    }
    State.saveState(_state);
    _refresh();
  });
}
/* ====== TAG SELECTION MODE ====== */
var _tagSelMode   = false;
var _selectedTags = new Set(); // "tag|itemId"
function getTagSelMode()   { return _tagSelMode; }
function getSelectedTags() { return _selectedTags; }
function _onEnterTagSelMode() {
  _tagSelMode = true;
  _selectedTags.clear();
  _refresh();
}
function exitTagSelMode() {
  _tagSelMode = false;
  _selectedTags.clear();
  _refresh();
}
function _onToggleTagSel(e) {
  var key = e.detail.tag + '|' + e.detail.itemId;
  if (_selectedTags.has(key)) _selectedTags.delete(key);
  else                         _selectedTags.add(key);
  _refresh();
}
/* ====== IMAGE PASTE ====== */
function _onPaste(e) {
  var items = e.clipboardData ? e.clipboardData.items : [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      var blob = items[i].getAsFile();
      if (blob) _createImageItem(blob);
      e.preventDefault();
      return;
    }
  }
}
async function _createImageItem(blob) {
  var id = State.generateId();
  await DB.saveImage(id, blob);
  State.pushUndo(_state);
  var item = State.createItem('Image', '', id);
  _state.items.forEach(function (i) { if (!i.deleted) i.bumpOrder += 1; });
  item.bumpOrder = 0;
  _state.items.unshift(item);
  State.saveState(_state);
  _refresh();
}
async function bulkDeleteTags() {
  if (!_selectedTags.size) return;
  var ok = await Modals.confirm(
    'Delete ' + _selectedTags.size + ' tag(s)?\nType "yes" to confirm.'
  );
  if (!ok) return;
  State.pushUndo(_state);
  _selectedTags.forEach(function (key) {
    var parts  = key.split('|');
    var tag    = parts[0];
    var itemId = parts[1];
    var item   = State.getItem(_state, itemId);
    if (item) {
      item.tags       = item.tags.filter(function (t) { return t !== tag; });
      item.modifiedAt = State.nowISO();
    }
  });
  _selectedTags.clear();
  _tagSelMode = false;
  State.saveState(_state);
  _refresh();
}
/* ====== ITEM UNDO / REDO ====== */
function _onItemUndo(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || !State.itemUndo(item)) return;
  State.saveState(_state);
  _refresh();
}
function _onItemRedo(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || !State.itemRedo(item)) return;
  State.saveState(_state);
  _refresh();
}
/* ====== RESTORE VERSION ====== */
function _onRestoreVersion(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  var versions = item.versions || [];
  var vIdx = e.detail.versionIndex;
  if (vIdx < 0 || vIdx >= versions.length) return;
  var ver = versions[vIdx];
  State.addItemVersion(item, {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || ''
  });
  State.pushUndo(_state);
  item.text          = ver.text;
  item.html          = ver.html;
  item.title         = ver.title;
  item.tags          = (ver.tags || []).slice();
  item.modifiedAt    = State.nowISO();
  item.versionName   = ver.name || '';
  item.itemUndoStack = [];
  item.itemRedoStack = [];
  State.saveState(_state);
  _refresh();
}
/* ====== NAME VERSION ====== */
function _onNameVersion(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  if (e.detail.versionIndex === -1) {
    item.versionName = e.detail.name || '';
  } else {
    var versions = item.versions || [];
    var vIdx = e.detail.versionIndex;
    if (vIdx >= 0 && vIdx < versions.length) {
      versions[vIdx].name = e.detail.name || '';
    }
  }
  State.saveState(_state);
}
async function _onVersionDelete(e) {
  var ok = await Modals.confirm('Delete ' + e.detail.indices.length + ' version(s)? Type "yes" to confirm.');
  if (!ok) return;
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  State.pushUndo(_state);
  e.detail.indices.forEach(function (idx) {
    if (item.versions[idx]) item.versions[idx].deleted = true;
  });
  State.saveState(_state);
  _refresh();
}
function _onVersionUndelete(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  State.pushUndo(_state);
  e.detail.indices.forEach(function (idx) {
    if (item.versions[idx]) item.versions[idx].deleted = false;
  });
  State.saveState(_state);
  _refresh();
}
async function bulkBurn(ids) {
  if (!ids.size) return;
  var ok = await Modals.confirm('Permanently destroy ' + ids.size + ' item(s)? This cannot be undone.', 'burn');
  if (!ok) return;
  ids.forEach(function (id) {
    var item = State.getItem(_state, id);
    if (item && item.imageId) {
      DB.deleteImage(item.imageId).catch(function (err) { console.warn('deleteImage failed', err); });
    }
    State.purgeBurnedItemFromStacks(_state, id);
  });
  _state.items = _state.items.filter(function (i) { return !ids.has(i.id); });
  ids.forEach(function (id) { _selectedIds.delete(id); });
  State.saveState(_state);
  _refresh();
}
async function _onVersionHardDelete(e) {
  var ok = await Modals.confirm('Permanently destroy ' + e.detail.indices.length + ' version(s)? This cannot be undone.', 'burn');
  if (!ok) return;
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  var sorted = e.detail.indices.slice().sort(function (a, b) { return b - a; });
  var burnedTs = sorted.map(function (idx) { return item.versions[idx] ? item.versions[idx].ts : null; }).filter(Boolean);
  State.purgeVersionsFromStacks(_state, item.id, burnedTs);
  sorted.forEach(function (idx) {
    if (item.versions[idx] !== undefined) item.versions.splice(idx, 1);
  });
  State.saveState(_state);
  _refresh();
}
window.Items = {
  init,
  getSelectedIds,
  selectAll,
  selectFiltered,
  clearSelection,
  bulkDelete,
  bulkBurn,
  getTagSelMode,
  getSelectedTags,
  exitTagSelMode,
  bulkDeleteTags
};

