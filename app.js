'use strict';
// @version 57
var SC_VERSION = '@version 57';
/*
 * app.js
 * Bootstrap, header wiring, export/import, undo/redo.
 */
(function () {
  /* ===== STATE ===== */
  var state = State.loadState();
  /* ===== INIT ===== */
  Perms.init(state);
  Modals.init();
  Render.init(state);
  DB.openDB().catch(function (e) { console.error('IndexedDB open failed', e); });
  var _verEl = document.getElementById('sc-version');
  if (_verEl) _verEl.textContent = SC_VERSION;
  /* ===== FILTER UI STATE ===== */
  var query       = '';
  var showDeleted = false;
  var hideActive  = false;
  var searchItems  = true;
  var searchTitles = true;
  var searchTags   = true;
  /* ===== HEADER ELEMENTS ===== */
  var searchInput    = document.getElementById('search-input');
  var cbSelectAll    = document.getElementById('cb-select-all');
  var cbSelFiltered  = document.getElementById('cb-select-filtered');
  var btnShowDeleted = document.getElementById('btn-show-deleted');
  var btnHideActive  = document.getElementById('btn-hide-undeleted');
  var cbSearchItems  = document.getElementById('cb-search-items');
  var cbSearchTitles = document.getElementById('cb-search-titles');
  var cbSearchTags   = document.getElementById('cb-search-tags');
  var btnStarFilter  = document.getElementById('btn-star-filter');
  var btnUndo        = document.getElementById('btn-undo');
  var btnRedo        = document.getElementById('btn-redo');
  var btnBulkCopy    = document.getElementById('btn-bulk-copy');
  var btnBulkDelete  = document.getElementById('btn-bulk-delete');
  var btnExport      = document.getElementById('btn-export');DB.openDB().catch(function (e) { console.error('IndexedDB open failed', e); });
  var _verEl = document.getElementById('sc-version');
  if (_verEl) _verEl.textContent = SC_VERSION;
  var importInput    = document.getElementById('import-input');
  var sortSelect     = document.getElementById('sort-select');
  /* ===== REFRESH ===== */
  function refresh() {
    var result = Search.getDisplayList(state, query, {
      showDeleted:   showDeleted,
      hideUndeleted: hideActive,
      searchItems:   searchItems,
      searchTitles:  searchTitles,
      searchTags:    searchTags,
      starFilter:    state.starFilter
    });
    Render.render(
      result.filtered,
      result.rest,
      Items.getSelectedIds(),
      Items.getTagSelMode(),
      Items.getSelectedTags()
    );
    _updateUndoRedo();
    _updateStarBtn();
    _updateSortBtns();
    _lastFiltered = result.filtered;
    _altShortcuts = {};
    document.querySelectorAll('.item[data-shortcut]').forEach(function (el) {
      var letter = el.dataset.shortcut;
      var id = el.dataset.id;
      if (letter && id && id !== '__new__') _altShortcuts[letter] = id;
    });
    if (_refocusEntry) {
      _refocusEntry = false;
      var ph = document.querySelector('[data-placeholder]');
      if (ph) ph.focus();
    }
    var _allVisible = result.filtered.concat(result.rest);
    var _selIds = Items.getSelectedIds();
    cbSelectAll.checked = _allVisible.length > 0 && _allVisible.every(function (i) { return _selIds.has(i.id); });
    _updatePlaceholder();
    cbSelFiltered.checked = result.filtered.length > 0 && result.filtered.every(function (i) { return _selIds.has(i.id); });
  }
  var _lastFiltered = [];
  var _refocusEntry = false;
  var _altShortcuts = {};
  document.addEventListener('sc:create-item', function () { _refocusEntry = true; });
  /* ===== INIT ITEMS ===== */
  Items.init(state, refresh);
  /* Initial render */
  refresh();
  searchInput.focus();
  /* ===== PLACEHOLDER ===== */
  function _updatePlaceholder() {
    var parts = [];
    if (searchItems)  parts.push('items');
    if (searchTitles) parts.push('titles');
    if (searchTags)   parts.push('tags');
    if (!parts.length) {
      searchInput.placeholder = 'Select a search type below';
      return;
    }
    var joined = parts.length > 1
      ? parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1]
      : parts[0];
    var base = 'Search ' + joined;
    var del = '';
    if (showDeleted && hideActive) del = ' (deleted only)';
    else if (showDeleted)          del = ' (including deleted)';
    searchInput.placeholder = base + del + '...';
  }
  /* ===== SEARCH ===== */
  searchInput.addEventListener('input', function () {
    query = searchInput.value;
    refresh();
  });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var ph = document.querySelector('[data-placeholder]');
      if (ph) ph.focus();
    }
  });
  /* ===== CHECKBOXES ===== */
  cbSelectAll.addEventListener('change', function () {
    if (cbSelectAll.checked) {
      var result = Search.getDisplayList(state, query, {
        showDeleted:   showDeleted,
        hideUndeleted: hideActive,
        searchItems:   searchItems,
        searchTitles:  searchTitles,
        searchTags:    searchTags,
        starFilter:    state.starFilter
      });
      Items.selectAll(result.filtered.concat(result.rest));
    } else {
      Items.clearSelection();
    }
  });
  cbSelFiltered.addEventListener('change', function () {
    if (cbSelFiltered.checked) {
      Items.selectFiltered(_lastFiltered);
    } else {
      Items.clearSelection();
    }
  });
  btnShowDeleted.addEventListener('click', function () {
    showDeleted = !showDeleted;
    btnShowDeleted.classList.toggle('active', showDeleted);
    refresh();
  });
  btnHideActive.addEventListener('click', function () {
    hideActive = !hideActive;
    btnHideActive.classList.toggle('active', hideActive);
    refresh();
  });
  cbSearchItems.addEventListener('change', function () {
    searchItems = cbSearchItems.checked;
    refresh();
  });
  cbSearchTitles.addEventListener('change', function () {
    searchTitles = cbSearchTitles.checked;
    refresh();
  });
  cbSearchTags.addEventListener('change', function () {
    searchTags = cbSearchTags.checked;
    refresh();
  });
  /* ===== STAR FILTER ===== */
  function _updateStarBtn() {
    if (state.starFilter) {
      btnStarFilter.classList.add('active');
      btnStarFilter.textContent = '★';
    } else {
      btnStarFilter.classList.remove('active');
      btnStarFilter.textContent = '☆';
    }
  }
document.addEventListener('sc:filter-tag', function (e) {
    searchInput.value = e.detail.tag;
    query             = e.detail.tag;
    refresh();
  });
  btnStarFilter.addEventListener('click', function () {
    state.starFilter = !state.starFilter;
    State.saveState(state);
    refresh();
  });
  /* ===== UNDO / REDO ===== */
  function _updateUndoRedo() {
    btnUndo.disabled = !state.undoStack.length;
    btnRedo.disabled = !state.redoStack.length;
  }
  btnUndo.addEventListener('click', function () {
    if (State.undo(state)) { State.saveState(state); refresh(); }
  });
  btnRedo.addEventListener('click', function () {
    if (State.redo(state)) { State.saveState(state); refresh(); }
  });
  /* ===== SORT SELECT ===== */
  function _updateSortBtns() {
    var mode = state.sortMode;
    if (mode === 'created')  mode = 'created-desc';
    if (mode === 'modified') mode = 'modified-desc';
    if (mode === 'bump')     mode = 'id-asc';
    sortSelect.value = mode;
  }
  sortSelect.addEventListener('change', function () {
    state.sortMode = sortSelect.value;
    State.saveState(state);
    refresh();
  });
  /* ===== ALT SHORTCUTS ===== */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Alt') {
      document.getElementById('app').classList.add('alt-mode');
    }
    if (e.altKey && e.code && e.code.startsWith('Key')) {
      var letter = e.code.slice(3).toLowerCase();
      var id = _altShortcuts[letter];
      if (id) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: id } }));
        var el = document.querySelector('.item[data-id="' + id + '"]');
        if (el) {
          el.classList.add('copy-flash');
          setTimeout(function () { el.classList.remove('copy-flash'); }, 500);
        }
      }
    }
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'Alt') {
      document.getElementById('app').classList.remove('alt-mode');
    }
  });
  /* ===== BULK COPY ===== */
  btnBulkCopy.addEventListener('click', function () {
    var ids   = Items.getSelectedIds();
    var selected = Array.from(ids).map(function (id) {
      return State.getItem(state, id);
    }).filter(Boolean).filter(function (i) { return !i.imageId; });
    if (!selected.length) { alert('No copyable items selected.'); return; }
    Clip.writeBulk(selected);
  });
  /* ===== BULK DELETE ===== */
  btnBulkDelete.addEventListener('click', function () {
    var ids = Items.getSelectedIds();
    if (!ids.size) { alert('No items selected.'); return; }
    if (Items.getTagSelMode()) {
      Items.bulkDeleteTags();
    } else {
      Items.bulkDelete(ids);
    }
  });
  /* ===== EXPORT ===== */
  btnExport.addEventListener('click', async function () {
    try {
      var selectedIds = Items.getSelectedIds();
      var itemsToExport = selectedIds.size
        ? state.items.filter(function (i) { return selectedIds.has(i.id); })
        : state.items;
      var imageIds = itemsToExport
        .filter(function (i) { return i.imageId; })
        .map(function (i) { return i.imageId; });
      var allImages = await DB.exportAllImages();
      var images    = allImages.filter(function (r) { return imageIds.indexOf(r.id) !== -1; });
      // Convert blobs to base64 for JSON portability
      var imgData   = await Promise.all(images.map(async function (rec) {
        var b64 = await _blobToBase64(rec.blob);
        return { id: rec.id, b64: b64, type: rec.blob.type };
      }));
      var payload = {
        version:  1,
        metadata: Object.assign({}, state, { items: itemsToExport }),
        images:   imgData
      };
      var json = JSON.stringify(payload);
      var blob = new Blob([json], { type: 'application/json' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href   = url;
      a.download = 'searchclipped_export_' + _dateStr() + '.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
      alert('Export failed: ' + e.message);
    }
  });
  /* ===== IMPORT ===== */
  importInput.addEventListener('change', async function () {
    var file = importInput.files[0];
    if (!file) return;
    try {
      var text    = await file.text();
      var payload = JSON.parse(text);
      if (!payload || !payload.metadata) { alert('Invalid export file.'); return; }
      // Restore images to IndexedDB
      if (payload.images && payload.images.length) {
        var records = await Promise.all(payload.images.map(async function (rec) {
          var blob = await _base64ToBlob(rec.b64, rec.type);
          return { id: rec.id, blob: blob };
        }));
        await DB.importImages(records);
      }
      // Restore metadata — merge items, prefer imported for conflicts
      var imported = payload.metadata;
      var existingIds = new Set(state.items.map(function (i) { return i.id; }));
      (imported.items || []).forEach(function (item) {
        if (!existingIds.has(item.id)) {
          state.items.push(item);
        }
      });
      // Restore permissions, sort mode, starFilter from import if not already set
      if (imported.sortMode)   state.sortMode   = imported.sortMode;
      if (imported.starFilter) state.starFilter  = imported.starFilter;
      State.saveState(state);
      refresh();
      alert('Import complete.');
    } catch (e) {
      console.error('Import failed', e);
      alert('Import failed: ' + e.message);
    }
    importInput.value = '';
  });
  /* ===== SERVICE WORKER ===== */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (e) {
      console.warn('SW registration failed', e);
    });
  }
  /* ===== HELPERS ===== */
  function _blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload  = function () { resolve(r.result.split(',')[1]); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  function _base64ToBlob(b64, type) {
    var bin  = atob(b64);
    var arr  = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return Promise.resolve(new Blob([arr], { type: type }));
  }
  function _dateStr() {
    var d  = new Date();
    var p  = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) +
           '_' + p(d.getHours()) + p(d.getMinutes());
  }
})();

