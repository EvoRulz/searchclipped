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
  document.addEventListener('sc:create-image',       function (e) { _createImageItem(e.detail.blob); });
  document.addEventListener('paste',                 _onPaste);
  document.addEventListener('sc:toggle-tag-sel', _onToggleTagSel);
}
/* ====== CREATE ====== */
function _onCreate(e) {
  var text = (e.detail.text || '').trim();
  if (!text) return;
  State.pushUndo(_state);
  var item = State.createItem(text, e.detail.html || text, null);
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
  State.pushUndo(_state);
  item.text       = e.detail.text || '';
  item.html       = e.detail.html || item.text;
  item.modifiedAt = State.nowISO();
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
  item.modifiedAt = State.nowISO();
  State.saveState(_state);
  _refresh();
}
/* ====== TAGS ====== */
function _onOpenTags(e) {
  Modals.openTagEditor(_state, e.detail.id, function (item) {
    State.pushUndo(_state);
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
window.Items = {
  init,
  getSelectedIds,
  selectAll,
  selectFiltered,
  clearSelection,
  bulkDelete,
  getTagSelMode,
  getSelectedTags,
  exitTagSelMode,
  bulkDeleteTags
};

