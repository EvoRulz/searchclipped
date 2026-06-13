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
  document.addEventListener('sc:toggle-tag-edit', _onToggleTagEdit);
  document.addEventListener('sc:add-tag',         _onAddTag);
  document.addEventListener('sc:rename-tag',      _onRenameTag);
  document.addEventListener('sc:delete-tag',      _onDeleteTag);
  document.addEventListener('sc:edit-title',         _onEditTitle);
  document.addEventListener('sc:create-image',       function (e) { _createImageItem(e.detail.blob); });
  document.addEventListener('paste',                 _onPaste);
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
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  var item = State.createItem(text, e.detail.html || text, null);
  item.profileIds = window.Profiles ? Array.from(Profiles.getActiveIds()) : [];
  if (e.detail.title) item.title = e.detail.title.trim();
  if (e.detail.tags && e.detail.tags.length) item.tags = State._sortTagsCustom(e.detail.tags.slice());
  // Give it the next bumpOrder slot at the top
  State.reindexBumpOrder(_state);
  // Insert at position 0 by giving it bumpOrder = -1 then reindexing
  _state.items.forEach(function (i) { if (!i.deleted) i.bumpOrder += 1; });
  item.bumpOrder = 0;
  _state.items.unshift(item);
  State.saveState(_state);
  if (window.Profiles) Profiles.notifyItemChanged();
  _refresh();
}
/* ====== EDIT ====== */
function _onEdit(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || item.deleted) return;
  var oldSnap = {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || '',
    deleted: item.deleted || false, profileIds: (item.profileIds || []).slice()
  };
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  item.text        = e.detail.text || '';
  item.html        = e.detail.html || item.text;
  item.modifiedAt  = State.nowISO();
  item.versionName = '';
  State.pushItemUndo(item, oldSnap);
  State.addItemVersion(item, oldSnap);
  State.saveState(_state);
  if (window.Profiles) Profiles.notifyItemChanged();
  _refresh();
}
/* ====== EDIT TITLE ====== */
function _onEditTitle(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || item.deleted) return;
  var oldSnap = {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || '',
    deleted: item.deleted || false, profileIds: (item.profileIds || []).slice()
  };
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  item.title       = e.detail.title || '';
  item.modifiedAt  = State.nowISO();
  item.versionName = '';
  State.pushItemUndo(item, oldSnap);
  State.addItemVersion(item, oldSnap);
  State.saveState(_state);
  _refresh();
}
/* ====== COPY ====== */
function _onCopy(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  Clip.writeItem(item);
  if (window._copyCounts && item.id) {
    window._copyCounts[item.id] = (window._copyCounts[item.id] || 0) + 1;
    DB.saveCopyCounts(window._copyCounts).catch(function (err) { console.warn('saveCopyCounts failed', err); });
    document.dispatchEvent(new CustomEvent('sc:copy-count-updated', { detail: { id: item.id, count: window._copyCounts[item.id] } }));
  }
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
function selectAllSilent(items) {
  items.forEach(function (i) { _selectedIds.add(i.id); });
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
function setSelection(ids) {
  _selectedIds.clear();
  if (ids) ids.forEach(function (id) { _selectedIds.add(id); });
  _refresh();
}
function setSelectionSilent(ids) {
  _selectedIds.clear();
  if (ids) ids.forEach(function (id) { _selectedIds.add(id); });
}
/* ====== STAR ====== */
function _onToggleStar(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  item.starred    = !item.starred;
  item.modifiedAt = State.nowISO();
  State.saveState(_state);
  _refresh();
}
/* ====== BUMP ====== */
function _onBump(e) {
  var id  = e.detail.id;
  var dir = e.detail.dir;
  if (_state.sortMode === 'bump') {
    State.reindexBumpOrder(_state);
    var active = _state.items
    .filter(function (i) { return !i.deleted; })
    .sort(function (a, b) { return a.bumpOrder - b.bumpOrder; });
    var idx = active.findIndex(function (i) { return i.id === id; });
    if (idx < 0) return;
    var targetIdx = dir === 1 ? active.length - 1 : 0;
    if (targetIdx === idx) return;
    State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
    var movedBump = active.splice(idx, 1)[0];
    active.splice(targetIdx, 0, movedBump);
    active.forEach(function (item, vi) { item.bumpOrder = vi; });
  } else {
    State.reindexBumpOrder(_state);
    var target = State.getItem(_state, id);
    if (!target) return;
    var activeNonBump = _state.items
    .filter(function (i) { return !i.deleted; })
    .sort(function (a, b) { return a.bumpOrder - b.bumpOrder; });
    var curIdx = activeNonBump.findIndex(function (i) { return i.id === id; });
    if (curIdx < 0) return;
    var newIdx = dir === 1 ? activeNonBump.length - 1 : 0;
    if (newIdx === curIdx) return;
    State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
    var movedNonBump = activeNonBump.splice(curIdx, 1)[0];
    activeNonBump.splice(newIdx, 0, movedNonBump);
    activeNonBump.forEach(function (item, vi) { item.bumpOrder = vi; });
  }
  State.saveState(_state);
  _refresh();
}
/* ====== DELETE (swipe) ====== */
function _onSwipeDelete(e) {
  _doDelete([e.detail.id]);
}
/* ====== BULK DELETE ====== */
function bulkDelete(ids) {
  if (!ids.size) return;
  _doDelete(Array.from(ids));
}
async function _doDelete(ids) {
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  ids.forEach(function (id) {
    var item = State.getItem(_state, id);
    if (item) {
      State.pushItemUndo(item, {
        ts: item.modifiedAt, text: item.text, html: item.html,
        title: item.title, tags: (item.tags || []).slice(), name: item.versionName || '', deleted: false
      });
      item.deleted    = true;
      item.starred    = false;
      item.bumpOrder  = item.bumpOrder + 0.5;
      item.modifiedAt = State.nowISO();
    }
  });
  _selectedIds.clear();
  State.saveState(_state);
  if (window.Profiles) Profiles.notifyItemChanged();
  _refresh();
}
/* ====== RESTORE ====== */
async function _onRestore(e) {
  var ok = await Modals.confirm('Restore this item? Type "yes" to confirm.');
  if (!ok) return;
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  State.pushItemUndo(item, {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || '', deleted: true
  });
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
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
  _state.items = _state.items.filter(function (i) { return i.id !== item.id; });
  await State.purgeAllBurnedFromStacks(_state, new Set([item.id]));
  _selectedIds.delete(item.id);
  State.saveState(_state);
  _refresh();
}
/* ====== TAGS ====== */
var _tagEditOldSnap = null;
function _onToggleTagEdit(e) {
  var id = e.detail.id;
  var current = Render.getTagEditItemId();
  if (current === id) {
    _finalizeTagEdit(current);
    Render.setTagEditItemId(null);
  } else {
    if (current) _finalizeTagEdit(current);
    var item = State.getItem(_state, id);
    if (!item) return;
    _tagEditOldSnap = {
      ts: item.modifiedAt, text: item.text, html: item.html,
      title: item.title, tags: (item.tags || []).slice(), name: item.versionName || '',
      deleted: item.deleted || false, profileIds: (item.profileIds || []).slice()
    };
    Render.setTagEditItemId(id);
  }
  _refresh();
}
function _finalizeTagEdit(id) {
  var item = State.getItem(_state, id);
  if (!item || !_tagEditOldSnap) { _tagEditOldSnap = null; return; }
  var before = JSON.stringify(_tagEditOldSnap.tags);
  item.tags = (item.tags || []).filter(function (t) { return (t || '').trim() !== ''; });
  var after = JSON.stringify(item.tags);
  if (before !== after) {
    item.tags        = State._sortTagsCustom(item.tags);
    item.modifiedAt  = State.nowISO();
    item.versionName = '';
    State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
    State.pushItemUndo(item, _tagEditOldSnap);
    State.addItemVersion(item, _tagEditOldSnap);
  }
  State.saveState(_state);
  _tagEditOldSnap = null;
}
function _onAddTag(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  var raw = (e.detail.tag || '').trim();
  if (!raw) return;
  item.tags = item.tags || [];
  if (item.tags.indexOf(raw) === -1) item.tags.push(raw);
  State.saveState(_state);
  _refresh();
}
function _onRenameTag(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || !item.tags) return;
  var idx = e.detail.idx;
  if (idx < 0 || idx >= item.tags.length) return;
  item.tags[idx] = (e.detail.value || '').trim();
  State.saveState(_state);
  _refresh();
}
function _onDeleteTag(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || !item.tags) return;
  var idx = e.detail.idx;
  if (idx < 0 || idx >= item.tags.length) return;
  item.tags.splice(idx, 1);
  State.saveState(_state);
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
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  var item = State.createItem('Image', '', id);
  item.profileIds = window.Profiles ? Array.from(Profiles.getActiveIds()) : [];
  _state.items.forEach(function (i) { if (!i.deleted) i.bumpOrder += 1; });
  item.bumpOrder = 0;
  _state.items.unshift(item);
  State.saveState(_state);
  _refresh();
}
/* ====== ITEM UNDO / REDO ====== */
function _onItemUndo(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || !(item.itemUndoStack && item.itemUndoStack.length)) return;
  var oldSnap = {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || '', deleted: item.deleted || false
  };
  oldSnap.profileIds = (item.profileIds || []).slice();
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  State.itemUndo(item);
  State.addItemVersion(item, oldSnap);
  State.saveState(_state);
  _refresh();
}
function _onItemRedo(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item || !(item.itemRedoStack && item.itemRedoStack.length)) return;
  var oldSnap = {
    ts: item.modifiedAt, text: item.text, html: item.html,
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || '', deleted: item.deleted || false
  };
  oldSnap.profileIds = (item.profileIds || []).slice();
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  State.itemRedo(item);
  State.addItemVersion(item, oldSnap);
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
    title: item.title, tags: (item.tags || []).slice(), name: item.versionName || '',
    profileIds: (item.profileIds || []).slice()
  });
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
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
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
  e.detail.indices.forEach(function (idx) {
    if (item.versions[idx]) item.versions[idx].deleted = true;
  });
  State.saveState(_state);
  _refresh();
}
function _onVersionUndelete(e) {
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  State.pushUndo(_state, window.AppUi ? window.AppUi.snapshotUi() : null);
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
  var burnedIds = Array.from(ids);
  burnedIds.forEach(function (id) {
    var item = State.getItem(_state, id);
    if (item && item.imageId) {
      DB.deleteImage(item.imageId).catch(function (err) { console.warn('deleteImage failed', err); });
    }
  });
  _state.items = _state.items.filter(function (i) { return !ids.has(i.id); });
  await State.purgeAllBurnedFromStacks(_state, new Set(burnedIds));
  ids.forEach(function (id) { _selectedIds.delete(id); });
  State.saveState(_state);
  _refresh();
}
async function _onVersionHardDelete(e) {
  var ok = await Modals.confirm('Permanently destroy ' + e.detail.indices.length + ' version(s)? This cannot be undone.', 'burn');
  if (!ok) return;
  var closePanel = e.detail.closePanel || false;
  var item = State.getItem(_state, e.detail.id);
  if (!item) return;
  var sorted = e.detail.indices.slice().sort(function (a, b) { return b - a; });
  var burnedTs = sorted.map(function (idx) { return item.versions[idx] ? item.versions[idx].ts : null; }).filter(Boolean);
  var burnedKeys = new Set(sorted.map(function (idx) {
    var ver = item.versions[idx];
    if (!ver) return null;
    return (ver.text || '').trim() + '\x00' + (ver.title || '').replace(/\s*\(preview\)$/i, '').trim();
  }).filter(Boolean));
  State.purgeVersionsFromStacks(_state, item.id, burnedTs);
  sorted.forEach(function (idx) {
    if (item.versions[idx] !== undefined) item.versions.splice(idx, 1);
  });
  item.itemUndoStack = (item.itemUndoStack || []).filter(function (snap) {
    return !burnedKeys.has((snap.text || '').trim() + '\x00' + (snap.title || '').replace(/\s*\(preview\)$/i, '').trim());
  });
  item.itemRedoStack = (item.itemRedoStack || []).filter(function (snap) {
    return !burnedKeys.has((snap.text || '').trim() + '\x00' + (snap.title || '').replace(/\s*\(preview\)$/i, '').trim());
  });
  State.purgeOrphanedItemUndoRedo(item);
  State.purgeItemContentFromStacks(_state, item.id, burnedKeys);
  State.saveState(_state);
  if (closePanel) {
    document.dispatchEvent(new CustomEvent('sc:close-version-panel', { detail: { id: item.id } }));
  }
  _refresh();
}
window.Items = {
  init,
  getSelectedIds,
  selectAll,
  selectAllSilent,
  selectFiltered,
  clearSelection,
  setSelection,
  setSelectionSilent,
  bulkDelete,
  bulkBurn
};

