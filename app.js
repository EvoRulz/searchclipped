'use strict';
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
  /* ===== FILTER UI STATE ===== */
  var query       = '';
  var showDeleted = false;
  var hideActive  = false;
  var tagsOnly    = false;
  /* ===== HEADER ELEMENTS ===== */
  var searchInput    = document.getElementById('search-input');
  var cbSelectAll    = document.getElementById('cb-select-all');
  var cbSelFiltered  = document.getElementById('cb-select-filtered');
  var cbShowDeleted  = document.getElementById('cb-show-deleted');
  var cbHideActive   = document.getElementById('cb-hide-undeleted');
  var cbTagsOnly     = document.getElementById('cb-tags-only');
  var btnStarFilter  = document.getElementById('btn-star-filter');
  var btnUndo        = document.getElementById('btn-undo');
  var btnRedo        = document.getElementById('btn-redo');
  var btnBulkCopy    = document.getElementById('btn-bulk-copy');
  var btnBulkDelete  = document.getElementById('btn-bulk-delete');
  var btnExport      = document.getElementById('btn-export');
  var importInput    = document.getElementById('import-input');
  var sortBtns       = document.querySelectorAll('.sort-btn');
  /* ===== REFRESH ===== */
  function refresh() {
    var result = Search.getDisplayList(state, query, {
      showDeleted:   showDeleted,
      hideUndeleted: hideActive,
      tagsOnly:      tagsOnly,
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
  }
  var _lastFiltered = [];
  /* ===== INIT ITEMS ===== */
  Items.init(state, refresh);
  /* Initial render */
  refresh();
  /* ===== SEARCH ===== */
  searchInput.addEventListener('input', function () {
    query = searchInput.value;
    refresh();
  });
  /* ===== CHECKBOXES ===== */
  cbSelectAll.addEventListener('change', function () {
    if (cbSelectAll.checked) {
      var result = Search.getDisplayList(state, query, {
        showDeleted:   showDeleted,
        hideUndeleted: hideActive,
        tagsOnly:      tagsOnly,
        starFilter:    state.starFilter
      });
      Items.selectAll(result.filtered.concat(result.rest));
    } else {
      Items.clearSelection();
    }
    cbSelectAll.checked = false; // reset visual
  });
  cbSelFiltered.addEventListener('change', function () {
    if (cbSelFiltered.checked) {
      Items.selectFiltered(_lastFiltered);
    } else {
      Items.clearSelection();
    }
    cbSelFiltered.checked = false;
  });
  cbShowDeleted.addEventListener('change', function () {
    showDeleted = cbShowDeleted.checked;
    refresh();
  });
  cbHideActive.addEventListener('change', function () {
    hideActive = cbHideActive.checked;
    refresh();
  });
  cbTagsOnly.addEventListener('change', function () {
    tagsOnly = cbTagsOnly.checked;
    refresh();
  });
  /* ===== STAR FILTER ===== */
  function _updateStarBtn() {
    if (state.starFilter) btnStarFilter.classList.add('active');
    else                  btnStarFilter.classList.remove('active');
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
  /* ===== SORT BUTTONS ===== */
  function _updateSortBtns() {
    sortBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.sort === state.sortMode);
    });
  }
  sortBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.sortMode = btn.dataset.sort;
      State.saveState(state);
      refresh();
    });
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

