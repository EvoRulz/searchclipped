'use strict';
// @version 248
var SC_VERSION = '@version 248';
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
  var showDeleted      = false;
  var _selectAllActive = false;
  var hideActive        = false;
  var hideItemContent   = false;
  var hideTitles        = false;
  var hideTags          = false;
  var hideArrows        = false;
  var hideIds           = false;
  var hideCopy          = false;
  var hideStars         = false;
  var hideStarred       = false;
  var hideTimestamps    = false;
  var hideTsCreated     = false;
  var hideTsModified    = false;
  var hideTsDeleted     = false;
  var hideTsRestored    = false;
  var hideCheckboxes    = false;
  var hideDelete       = false;
  var hideTitleEntry   = false;
  var hideItemEntry    = false;
  var hideImgEntry     = false;
  var hideFilterRow    = true;
  var searchItems        = true;
  var searchTitles       = true;
  var searchTags         = true;
  var _savedSearchItems  = true;
  var _savedSearchTitles = true;
  var _savedSearchTags   = true;
  var _tagFilterActive   = false;
  var _savedQuery        = '';
  /* ===== HEADER ELEMENTS ===== */
  var searchInput    = document.getElementById('search-input');
  var cbSelectAll    = document.getElementById('cb-select-all');
  var cbSelFiltered  = document.getElementById('cb-select-filtered');
  var btnShowDeleted = document.getElementById('btn-show-deleted');
  var btnHideActive        = document.getElementById('btn-hide-undeleted');
  var btnHideItemContent   = document.getElementById('btn-hide-item-content');
  var btnHideTitles        = document.getElementById('btn-hide-titles');
  var btnHideTagsBtn       = document.getElementById('btn-hide-tags');
  var btnHideArrows        = document.getElementById('btn-hide-arrows');
  var btnHideIds           = document.getElementById('btn-hide-ids');
  var btnHideCopy          = document.getElementById('btn-hide-copy');
  var btnHideStars         = document.getElementById('btn-hide-stars');
  var btnHideStarred       = document.getElementById('btn-hide-starred');
  var btnHideTimestamps    = document.getElementById('btn-hide-timestamps');
  var btnHideTsCreated     = document.getElementById('btn-hide-ts-created');
  var btnHideTsModified    = document.getElementById('btn-hide-ts-modified');
  var btnHideTsDeleted     = document.getElementById('btn-hide-ts-deleted');
  var btnHideTsRestored    = document.getElementById('btn-hide-ts-restored');
  var btnHideCheckboxes    = document.getElementById('btn-hide-checkboxes');
  var btnHideDelete      = document.getElementById('btn-hide-delete');
  var btnHideTitleEntry  = document.getElementById('btn-hide-title-entry');
  var btnHideItemEntry   = document.getElementById('btn-hide-item-entry');
  var btnHideImgEntry    = document.getElementById('btn-hide-img-entry');
  var btnToggleFilterRow = document.getElementById('btn-toggle-filter-row');
  var cbSearchItems  = document.getElementById('cb-search-items');
  var cbSearchTitles = document.getElementById('cb-search-titles');
  var cbSearchTags   = document.getElementById('cb-search-tags');
  var btnClearSearch = document.getElementById('btn-clear-search');
  var btnStarFilter  = document.getElementById('btn-star-filter');
  var btnUndo        = document.getElementById('btn-undo');
  var btnRedo        = document.getElementById('btn-redo');
  var btnBulkCopy    = document.getElementById('btn-bulk-copy');
  var btnBulkDelete  = document.getElementById('btn-bulk-delete');
  var btnBulkBurn    = document.getElementById('btn-bulk-burn');
  var btnExport      = document.getElementById('btn-export');
  var _verEl = document.getElementById('sc-version');
  if (_verEl) _verEl.textContent = SC_VERSION;
  var importInput    = document.getElementById('import-input');
  var sortSelect     = document.getElementById('sort-select');
  /* ===== REFRESH ===== */
  function refresh() {
    if (_selectAllActive) {
        var _r = Search.getDisplayList(state, query, {
            showDeleted:   showDeleted,
            hideUndeleted: hideActive,
            searchItems:   searchItems,
            searchTitles:  searchTitles,
            searchTags:    searchTags,
            starFilter:    state.starFilter
        });
        Items.selectAllSilent(_r.filtered.concat(_r.rest));
    }
    if (_focusedItemId) {
      var _prevFocused = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
      if (_prevFocused) _prevFocused.classList.remove('keyboard-focused');
    }
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
      Items.getSelectedTags(),
      query,
      _tagFilterActive
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
      var ph = document.querySelector('.item-content[data-placeholder]');
      if (ph) ph.focus();
    }
    var _allVisible = result.filtered.concat(result.rest);
    var _selIds = Items.getSelectedIds();
    if (!_allVisible.length) _selectAllActive = false;
    var _cbAllSelSet = new Set();
    _allVisible.forEach(function (item, vi) {
      if (_selIds.has(item.id)) _cbAllSelSet.add(_allVisible.length - 1 - vi);
    });
    Render.drawSelCanvas(cbSelectAll, _allVisible.length, _cbAllSelSet, _selectAllActive && !_allVisible.length);
    _updatePlaceholder();
    var _cbFiltSelSet = new Set();
    result.filtered.forEach(function (item, vi) {
      if (_selIds.has(item.id)) _cbFiltSelSet.add(result.filtered.length - 1 - vi);
    });
    Render.drawSelCanvas(cbSelFiltered, result.filtered.length, _cbFiltSelSet, false);
    var _now = Date.now();
    if (_now - _lastStorageCheck > 10000) { _lastStorageCheck = _now; _updateStorageDisplay(); }
  }
  var _lastFiltered = [];
  var _refocusEntry = false;
  var _altShortcuts = {};
  var _focusedItemId = null;
  (function () {
    var _list = document.getElementById('item-list');
    if (!_list) return;
    _list.addEventListener('scroll', function () {
      if (!_focusedItemId) return;
      var _el = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
      if (!_el) return;
      var _rect = _el.getBoundingClientRect();
      var _listRect = _list.getBoundingClientRect();
      if (_rect.bottom < _listRect.top || _rect.top > _listRect.bottom) {
        _el.classList.remove('keyboard-focused');
        _focusedItemId = null;
      }
    }, { passive: true });
  })();
  document.addEventListener('sc:create-item', function () { _refocusEntry = true; });
  /* ===== INIT ITEMS ===== */
  _loadUiState();
  document.getElementById('filter-row').style.display = hideFilterRow ? 'none' : '';
  btnToggleFilterRow.textContent = hideFilterRow ? 'show list' : 'hide list';
  Items.init(state, refresh);
  /* Initial render */
  refresh();
  searchInput.focus();
  /* Load undo/redo stacks from IndexedDB */
  State.initUndoFromDB(state).then(function () { _updateUndoRedo(); }).catch(function (e) {
    console.error('Failed to init undo stacks', e);
  });
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
  function _revertTagFilter() {
    if (!_tagFilterActive) return;
    searchItems            = _savedSearchItems;
    searchTitles           = _savedSearchTitles;
    cbSearchItems.checked  = searchItems;
    cbSearchTitles.checked = searchTitles;
    _tagFilterActive       = false;
    btnClearSearch.style.display = searchInput.value ? '' : 'none';
  }
  searchInput.addEventListener('input', function () {
    _revertTagFilter();
    query = searchInput.value;
    btnClearSearch.style.display = query ? '' : 'none';
    refresh();
  });
  btnClearSearch.addEventListener('click', function () {
    _revertTagFilter();
    searchInput.value = '';
    query = '';
    btnClearSearch.style.display = 'none';
    refresh();
    searchInput.focus();
  });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var ph = document.querySelector('.item-content[data-placeholder]');
      if (ph) ph.focus();
    }
  });
  /* ===== CHECKBOXES ===== */
  document.getElementById('cb-select-all-wrap').addEventListener('click', function () {
    var _r = Search.getDisplayList(state, query, {
      showDeleted:   showDeleted,
      hideUndeleted: hideActive,
      searchItems:   searchItems,
      searchTitles:  searchTitles,
      searchTags:    searchTags,
      starFilter:    state.starFilter
    });
    var _all = _r.filtered.concat(_r.rest);
    if (!_all.length) return;
    var _selIds = Items.getSelectedIds();
    var _isAllSel = _all.every(function (i) { return _selIds.has(i.id); });
    _selectAllActive = !_isAllSel;
    if (!_isAllSel) {
      Items.selectAll(_all);
    } else {
      Items.clearSelection();
    }
  });
  document.getElementById('cb-select-filtered-wrap').addEventListener('click', function () {
    if (!_lastFiltered.length) return;
    var _selIds = Items.getSelectedIds();
    var _isAllFilSel = _lastFiltered.every(function (i) { return _selIds.has(i.id); });
    if (!_isAllFilSel) {
      Items.selectFiltered(_lastFiltered);
    } else {
      Items.clearSelection();
    }
  });
  // showDeleted=false by default — button OFF means deleted items are HIDDEN
  btnShowDeleted.addEventListener('click', function () {
    var _wasAll = _selectAllActive;
    showDeleted = !showDeleted;
    btnShowDeleted.classList.toggle('active', showDeleted);
    document.getElementById('app').classList.toggle('show-deleted', showDeleted);
    if (_wasAll) {
      var _r = Search.getDisplayList(state, query, {
        showDeleted: showDeleted, hideUndeleted: hideActive,
        searchItems: searchItems, searchTitles: searchTitles,
        searchTags: searchTags, starFilter: state.starFilter
      });
      Items.selectAllSilent(_r.filtered.concat(_r.rest));
    } else {
      refresh();
    }
  });
  // hideActive=false by default — button OFF means undeleted items are VISIBLE
  btnHideActive.addEventListener('click', function () {
    var _wasAll = _selectAllActive;
    hideActive = !hideActive;
    btnHideActive.classList.toggle('active', hideActive);
    if (_wasAll) {
      var _r = Search.getDisplayList(state, query, {
        showDeleted: showDeleted, hideUndeleted: hideActive,
        searchItems: searchItems, searchTitles: searchTitles,
        searchTags: searchTags, starFilter: state.starFilter
      });
      Items.selectAllSilent(_r.filtered.concat(_r.rest));
    } else {
      refresh();
    }
  });
  btnHideItemContent.addEventListener('click', function () {
    hideItemContent = !hideItemContent;
    btnHideItemContent.classList.toggle('active', hideItemContent);
    document.getElementById('app').classList.toggle('hide-item-content', hideItemContent);
  });
  btnHideTitles.addEventListener('click', function () {
    hideTitles = !hideTitles;
    btnHideTitles.classList.toggle('active', hideTitles);
    document.getElementById('app').classList.toggle('hide-titles', hideTitles);
  });
  btnHideTagsBtn.addEventListener('click', function () {
    hideTags = !hideTags;
    btnHideTagsBtn.classList.toggle('active', hideTags);
    document.getElementById('app').classList.toggle('hide-tags', hideTags);
  });
  btnHideArrows.addEventListener('click', function () {
    hideArrows = !hideArrows;
    btnHideArrows.classList.toggle('active', hideArrows);
    document.getElementById('app').classList.toggle('hide-arrows', hideArrows);
  });
  btnHideIds.addEventListener('click', function () {
    hideIds = !hideIds;
    btnHideIds.classList.toggle('active', hideIds);
    document.getElementById('app').classList.toggle('hide-ids', hideIds);
  });
  btnHideCopy.addEventListener('click', function () {
    hideCopy = !hideCopy;
    btnHideCopy.classList.toggle('active', hideCopy);
    document.getElementById('app').classList.toggle('hide-copy', hideCopy);
  });
  btnHideStars.addEventListener('click', function () {
    hideStars = !hideStars;
    btnHideStars.classList.toggle('active', hideStars);
    document.getElementById('app').classList.toggle('hide-stars', hideStars);
  });
  btnHideStarred.addEventListener('click', function () {
    hideStarred = !hideStarred;
    btnHideStarred.classList.toggle('active', hideStarred);
    document.getElementById('app').classList.toggle('hide-starred', hideStarred);
  });
  btnHideTimestamps.addEventListener('click', function () {
    hideTimestamps = !hideTimestamps;
    btnHideTimestamps.classList.toggle('active', hideTimestamps);
    document.getElementById('app').classList.toggle('hide-timestamps', hideTimestamps);
  });
  btnHideTsCreated.addEventListener('click', function () {
    hideTsCreated = !hideTsCreated;
    btnHideTsCreated.classList.toggle('active', hideTsCreated);
    document.getElementById('app').classList.toggle('hide-ts-created', hideTsCreated);
  });
  btnHideTsModified.addEventListener('click', function () {
    hideTsModified = !hideTsModified;
    btnHideTsModified.classList.toggle('active', hideTsModified);
    document.getElementById('app').classList.toggle('hide-ts-modified', hideTsModified);
  });
  btnHideTsDeleted.addEventListener('click', function () {
    hideTsDeleted = !hideTsDeleted;
    btnHideTsDeleted.classList.toggle('active', hideTsDeleted);
    document.getElementById('app').classList.toggle('hide-ts-deleted', hideTsDeleted);
  });
  btnHideTsRestored.addEventListener('click', function () {
    hideTsRestored = !hideTsRestored;
    btnHideTsRestored.classList.toggle('active', hideTsRestored);
    document.getElementById('app').classList.toggle('hide-ts-restored', hideTsRestored);
  });
  btnHideCheckboxes.addEventListener('click', function () {
    hideCheckboxes = !hideCheckboxes;
    btnHideCheckboxes.classList.toggle('active', hideCheckboxes);
    document.getElementById('app').classList.toggle('hide-checkboxes', hideCheckboxes);
  });
  btnHideDelete.addEventListener('click', function () {
    hideDelete = !hideDelete;
    btnHideDelete.classList.toggle('active', hideDelete);
    document.getElementById('app').classList.toggle('hide-delete', hideDelete);
  });
  btnHideTitleEntry.addEventListener('click', function () {
    hideTitleEntry = !hideTitleEntry;
    btnHideTitleEntry.classList.toggle('active', hideTitleEntry);
    document.getElementById('app').classList.toggle('hide-title-entry', hideTitleEntry);
  });
  btnHideItemEntry.addEventListener('click', function () {
    hideItemEntry = !hideItemEntry;
    btnHideItemEntry.classList.toggle('active', hideItemEntry);
    document.getElementById('app').classList.toggle('hide-item-entry', hideItemEntry);
  });
  btnHideImgEntry.addEventListener('click', function () {
    hideImgEntry = !hideImgEntry;
    btnHideImgEntry.classList.toggle('active', hideImgEntry);
    document.getElementById('app').classList.toggle('hide-img-entry', hideImgEntry);
  });
  btnToggleFilterRow.addEventListener('click', function () {
    hideFilterRow = !hideFilterRow;
    document.getElementById('filter-row').style.display = hideFilterRow ? 'none' : '';
    btnToggleFilterRow.textContent = hideFilterRow ? 'show list' : 'hide list';
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
    if (searchInput.value === e.detail.tag && _tagFilterActive) {
      searchInput.value = _savedQuery;
      query             = _savedQuery;
      if (_tagFilterActive) {
        searchItems            = _savedSearchItems;
        searchTitles           = _savedSearchTitles;
        searchTags             = _savedSearchTags;
        cbSearchItems.checked  = searchItems;
        cbSearchTitles.checked = searchTitles;
        cbSearchTags.checked   = searchTags;
        _tagFilterActive       = false;
        _savedQuery            = '';
      }
    } else {
      if (!_tagFilterActive) {
        _savedSearchItems  = searchItems;
        _savedSearchTitles = searchTitles;
        _savedSearchTags   = searchTags;
        _savedQuery        = query;
        _tagFilterActive   = true;
      }
      searchInput.value      = e.detail.tag;
      query                  = e.detail.tag;
      btnClearSearch.style.display = '';
      searchItems            = false;
      searchTitles           = false;
      searchTags             = true;
      cbSearchItems.checked  = false;
      cbSearchTitles.checked = false;
      cbSearchTags.checked   = true;
    }
    refresh();
    _saveUiState();
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
  var peekThreshInput = document.getElementById('peek-threshold-input');
  if (peekThreshInput) {
    var _storedThresh = parseInt(localStorage.getItem('sc_peek_threshold'), 10);
    if (!isNaN(_storedThresh)) peekThreshInput.value = _storedThresh;
    peekThreshInput.addEventListener('change', function () {
      var v = parseInt(peekThreshInput.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      peekThreshInput.value = v;
      localStorage.setItem('sc_peek_threshold', v);
      Render.setPeekThreshold(v);
      var _peeking = document.querySelector('.version-entry-ts.version-ts-peeking');
      if (_peeking) { _peeking.click(); _peeking.click(); }
    });
  }
  /* ===== ALT SHORTCUTS ===== */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' && !e.shiftKey && _focusedItemId) {
      e.preventDefault();
      var prevFocEl2 = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
      if (prevFocEl2) {
        document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: _focusedItemId } }));
        prevFocEl2.classList.add('copy-flash');
        setTimeout(function () { prevFocEl2.classList.remove('copy-flash'); }, 500);
      }
      return;
    }
    if (e.key === 'ArrowRight' && e.shiftKey) {
      e.preventDefault();
      var list = document.getElementById('item-list');
      if (!list) return;
      var rows = Array.from(list.querySelectorAll('.item-row'));
      if (_focusedItemId) {
        var prevFocEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
        if (prevFocEl) {
          document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: _focusedItemId } }));
          prevFocEl.classList.add('copy-flash');
          setTimeout(function () { prevFocEl.classList.remove('copy-flash'); }, 500);
        }
        return;
      }
      var listTop = list.getBoundingClientRect().top;
      for (var ri = 0; ri < rows.length; ri++) {
        var rowTop = rows[ri].getBoundingClientRect().top - listTop;
        if (rowTop >= -2) {
          var innerEl = rows[ri].querySelector('.item[data-id]');
          if (innerEl && innerEl.dataset.id !== '__new__') {
            _focusedItemId = innerEl.dataset.id;
            innerEl.classList.add('keyboard-focused');
          }
          break;
        }
      }
      return;
    }
    if (e.key === 'ArrowLeft' && e.shiftKey) {
      e.preventDefault();
      if (_focusedItemId) {
        var prevEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
        if (prevEl) prevEl.classList.remove('keyboard-focused');
        _focusedItemId = null;
      }
      return;
    }
    if (e.key === 'Escape') {
      if (document.activeElement === searchInput && !searchInput.value) {
        searchInput.blur();
      } else {
        _revertTagFilter();
        searchInput.value = '';
        query = '';
        btnClearSearch.style.display = 'none';
        refresh();
        searchInput.focus();
      }
    }
    if (e.key === 'Alt') {
      e.preventDefault();
      document.getElementById('app').classList.add('alt-mode');
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && _focusedItemId) {
      e.preventDefault();
      var _bumpDir = e.key === 'ArrowUp' ? -1 : 1;
      document.dispatchEvent(new CustomEvent('sc:bump', { detail: { id: _focusedItemId, dir: _bumpDir } }));
      requestAnimationFrame(function () {
        var _bumpedEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
        if (_bumpedEl) {
          _bumpedEl.classList.add('keyboard-focused');
          _bumpedEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
      });
      return;
    }
    if (!e.altKey && !e.ctrlKey && !e.metaKey && _focusedItemId) {
      var _active = document.activeElement;
      var _isEditing = _active && (_active.isContentEditable || _active.tagName === 'INPUT' || _active.tagName === 'TEXTAREA');
      if (!_isEditing) {
        if (e.key === 's') {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('sc:toggle-star', { detail: { id: _focusedItemId } }));
          requestAnimationFrame(function () {
            var _starredEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
            if (_starredEl) _starredEl.classList.add('keyboard-focused');
          });
          return;
        }
        if (e.key === 'd') {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('sc:swipe-delete', { detail: { id: _focusedItemId } }));
          return;
        }
        if (e.key === 'c') {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: _focusedItemId } }));
          var _fEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
          if (_fEl) {
            _fEl.classList.add('copy-flash');
            setTimeout(function () { _fEl.classList.remove('copy-flash'); }, 500);
          }
          return;
        }
      }
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
  window.addEventListener('blur', function () {
    document.getElementById('app').classList.remove('alt-mode');
  });
  (function () {
    var _scrollDir = 0;
    var _scrollRaf = null;
    function _scrollStep() {
      if (!_scrollDir) return;
      var list = document.getElementById('item-list');
      if (list) list.scrollTop += _scrollDir * 8;
      _scrollRaf = requestAnimationFrame(_scrollStep);
    }
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      var active = document.activeElement;
      if (active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
      e.preventDefault();
      if (e.shiftKey) {
        var list = document.getElementById('item-list');
        if (!list) return;
        var rows = Array.from(list.querySelectorAll('.item-row'));
        if (!rows.length) return;
        var dir = e.key === 'ArrowDown' ? 1 : -1;
        if (e.key === 'ArrowRight') {
          // Focus/highlight current top visible item
          {
            var listTop2 = list.getBoundingClientRect().top;
            if (_focusedItemId) {
              var prevFocEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
              if (prevFocEl) {
                document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: _focusedItemId } }));
                prevFocEl.classList.add('copy-flash');
                setTimeout(function () { prevFocEl.classList.remove('copy-flash'); }, 500);
              }
              return;
            }
            for (var ri = 0; ri < rows.length; ri++) {
              var rowTop2 = rows[ri].getBoundingClientRect().top - listTop2;
              if (rowTop2 >= -2) {
                var innerEl2 = rows[ri].querySelector('.item[data-id]');
                if (innerEl2) {
                  _focusedItemId = innerEl2.dataset.id;
                  innerEl2.classList.add('keyboard-focused');
                }
                break;
              }
            }
          }
          if (false) {
            // Already focused: copy it
            document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: _focusedItemId } }));
            var focusedEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
            if (focusedEl) {
              focusedEl.classList.add('copy-flash');
              setTimeout(function () { focusedEl.classList.remove('copy-flash'); }, 500);
            }
          }
          return;
        }
        if (e.key === 'ArrowLeft') {
          // Un-focus
          if (_focusedItemId) {
            var prevEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
            if (prevEl) prevEl.classList.remove('keyboard-focused');
            _focusedItemId = null;
          }
          return;
        }
        var listTop = list.getBoundingClientRect().top;
        var current = 0;
        for (var i = 0; i < rows.length; i++) {
          var rowTop = rows[i].getBoundingClientRect().top - listTop;
          if (rowTop <= 2) { current = i; } else { break; }
        }
        var target = dir === 1
          ? Math.min(current + 1, rows.length - 1)
          : Math.max(current - 1, 0);
        rows[target].scrollIntoView({ block: 'start', behavior: 'instant' });
        // Move keyboard focus to new top item
        if (_focusedItemId) {
          var oldEl = document.querySelector('.item[data-id="' + _focusedItemId + '"]');
          if (oldEl) oldEl.classList.remove('keyboard-focused');
          var newInner = rows[target].querySelector('.item[data-id]');
          if (newInner) {
            _focusedItemId = newInner.dataset.id;
            newInner.classList.add('keyboard-focused');
          }
        }
        return;
      }
      var dir = e.key === 'ArrowDown' ? 1 : -1;
      if (_scrollDir === dir) return;
      _scrollDir = dir;
      if (!_scrollRaf) _scrollRaf = requestAnimationFrame(_scrollStep);
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        _scrollDir = 0;
        if (_scrollRaf) { cancelAnimationFrame(_scrollRaf); _scrollRaf = null; }
      }
    });
  })();
  /* ===== BULK COPY ===== */
  btnBulkCopy.addEventListener('click', function () {
    var ids   = Items.getSelectedIds();
    var selected = Array.from(ids).map(function (id) {
      return State.getItem(state, id);
    }).filter(Boolean).filter(function (i) { return !i.imageId; });
    if (!selected.length) { alert('No copyable items selected.'); return; }
    Clip.writeBulk(selected);
  });
  /* ===== BULK BURN ===== */
  btnBulkBurn.addEventListener('click', function () {
    var ids = Items.getSelectedIds();
    if (!ids.size) { alert('No items selected.'); return; }
    Items.bulkBurn(ids);
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
      State.pushUndo(state);
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
  /* ===== SIDE SCROLL HANDLES ===== */
  (function () {
    var left  = document.getElementById('scroll-left');
    var right = document.getElementById('scroll-right');
    var list  = document.getElementById('item-list');
    if (!left || !right || !list) return;
    function attachHandle(el) {
      el.addEventListener('wheel', function (e) {
        e.preventDefault();
        list.scrollTop += e.deltaY;
      }, { passive: false });
      var startY = 0, startScroll = 0, dragging = false;
      el.addEventListener('pointerdown', function (e) {
        dragging = true;
        startY = e.clientY;
        startScroll = list.scrollTop;
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      el.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        list.scrollTop = startScroll + (e.clientY - startY);
      });
      el.addEventListener('pointerup',     function () { dragging = false; });
      el.addEventListener('pointercancel', function () { dragging = false; });
    }
    attachHandle(left);
    attachHandle(right);
  })();
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
  var _lastStorageCheck = 0;
  async function _updateStorageDisplay() {
    try {
      var lsRaw   = localStorage.getItem('searchclipped_state') || '';
      var lsBytes = new Blob([lsRaw]).size;
      var lsLimit = 5 * 1024 * 1024;
      var lsFill  = document.getElementById('storage-ls-fill');
      var lsVal   = document.getElementById('storage-ls-val');
      if (lsFill) lsFill.style.width = Math.min(lsBytes / lsLimit * 100, 100) + '%';
      if (lsVal)  lsVal.textContent  = _fmtBytes(lsBytes) + ' / 5 MB';
    } catch (e) {}
    if (navigator.storage && navigator.storage.estimate) {
      try {
        var est    = await navigator.storage.estimate();
        var usage  = est.usage || 0;
        var quota  = est.quota || 0;
        var oFill  = document.getElementById('storage-origin-fill');
        var oVal   = document.getElementById('storage-origin-val');
        var pct    = quota ? Math.min(usage / quota * 100, 100) : 0;
        if (oFill) oFill.style.width = pct + '%';
        if (oVal)  oVal.textContent  = _fmtBytes(usage) + (quota ? ' / ' + _fmtBytes(quota) : '');
      } catch (e) {}
    }
  }
  function _fmtBytes(b) {
    if (b < 1024)          return b + ' B';
    if (b < 1024 * 1024)   return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function _saveUiState() {
    try {
      localStorage.setItem('sc_ui_prefs', JSON.stringify({
        query: query,
        showDeleted: showDeleted, hideActive: hideActive, hideItemContent: hideItemContent,
        hideTitles: hideTitles, hideTags: hideTags, hideArrows: hideArrows,
        hideIds: hideIds, hideCopy: hideCopy, hideStars: hideStars,
        hideStarred: hideStarred, hideTimestamps: hideTimestamps,
        hideTsCreated: hideTsCreated, hideTsModified: hideTsModified,
        hideTsDeleted: hideTsDeleted, hideTsRestored: hideTsRestored,
        hideCheckboxes: hideCheckboxes, hideDelete: hideDelete,
        hideTitleEntry: hideTitleEntry, hideItemEntry: hideItemEntry,
        hideImgEntry: hideImgEntry, hideFilterRow: hideFilterRow,
        searchItems: searchItems, searchTitles: searchTitles, searchTags: searchTags,
        tagFilterActive: _tagFilterActive, savedSearchItems: _savedSearchItems, savedSearchTitles: _savedSearchTitles, savedSearchTags: _savedSearchTags, savedQuery: _savedQuery
      }));
    } catch(e) {}
  }
  function _loadUiState() {
    try {
      var raw = localStorage.getItem('sc_ui_prefs');
      if (!raw) return;
      var p = JSON.parse(raw);
      var _a = document.getElementById('app');
      if (p.query !== undefined)          { query = p.query; searchInput.value = p.query; }
      if (p.showDeleted !== undefined)    { showDeleted = p.showDeleted; btnShowDeleted.classList.toggle('active', showDeleted); _a.classList.toggle('show-deleted', showDeleted); }
      if (p.hideActive !== undefined)     { hideActive = p.hideActive; btnHideActive.classList.toggle('active', hideActive); }
      if (p.hideItemContent !== undefined) {
        hideItemContent = p.hideItemContent;
        btnHideItemContent.classList.toggle('active', hideItemContent);
        _a.classList.toggle('hide-item-content', hideItemContent);
      }
      if (p.hideTitles !== undefined)     { hideTitles = p.hideTitles; btnHideTitles.classList.toggle('active', hideTitles); _a.classList.toggle('hide-titles', hideTitles); }
      if (p.hideTags !== undefined)       { hideTags = p.hideTags; btnHideTagsBtn.classList.toggle('active', hideTags); _a.classList.toggle('hide-tags', hideTags); }
      if (p.hideArrows !== undefined)     { hideArrows = p.hideArrows; btnHideArrows.classList.toggle('active', hideArrows); _a.classList.toggle('hide-arrows', hideArrows); }
      if (p.hideIds !== undefined)        { hideIds = p.hideIds; btnHideIds.classList.toggle('active', hideIds); _a.classList.toggle('hide-ids', hideIds); }
      if (p.hideCopy !== undefined)       { hideCopy = p.hideCopy; btnHideCopy.classList.toggle('active', hideCopy); _a.classList.toggle('hide-copy', hideCopy); }
      if (p.hideStars !== undefined)      { hideStars = p.hideStars; btnHideStars.classList.toggle('active', hideStars); _a.classList.toggle('hide-stars', hideStars); }
      if (p.hideStarred !== undefined)    { hideStarred = p.hideStarred; btnHideStarred.classList.toggle('active', hideStarred); _a.classList.toggle('hide-starred', hideStarred); }
      if (p.hideTimestamps !== undefined) {
        hideTimestamps = p.hideTimestamps;
        btnHideTimestamps.classList.toggle('active', hideTimestamps);
        _a.classList.toggle('hide-timestamps', hideTimestamps);
      }
      if (p.hideTsCreated !== undefined) {
        hideTsCreated = p.hideTsCreated;
        btnHideTsCreated.classList.toggle('active', hideTsCreated);
        _a.classList.toggle('hide-ts-created', hideTsCreated);
      }
      if (p.hideTsModified !== undefined) {
        hideTsModified = p.hideTsModified;
        btnHideTsModified.classList.toggle('active', hideTsModified);
        _a.classList.toggle('hide-ts-modified', hideTsModified);
      }
      if (p.hideTsDeleted !== undefined) {
        hideTsDeleted = p.hideTsDeleted;
        btnHideTsDeleted.classList.toggle('active', hideTsDeleted);
        _a.classList.toggle('hide-ts-deleted', hideTsDeleted);
      }
      if (p.hideTsRestored !== undefined) {
        hideTsRestored = p.hideTsRestored;
        btnHideTsRestored.classList.toggle('active', hideTsRestored);
        _a.classList.toggle('hide-ts-restored', hideTsRestored);
      }
      if (p.hideCheckboxes !== undefined) {
        hideCheckboxes = p.hideCheckboxes;
        btnHideCheckboxes.classList.toggle('active', hideCheckboxes);
        _a.classList.toggle('hide-checkboxes', hideCheckboxes);
      }
      if (p.hideDelete !== undefined)     { hideDelete = p.hideDelete; btnHideDelete.classList.toggle('active', hideDelete); _a.classList.toggle('hide-delete', hideDelete); }
      if (p.hideTitleEntry !== undefined) {
        hideTitleEntry = p.hideTitleEntry;
        btnHideTitleEntry.classList.toggle('active', hideTitleEntry);
        _a.classList.toggle('hide-title-entry', hideTitleEntry);
      }
      if (p.hideItemEntry !== undefined) {
        hideItemEntry = p.hideItemEntry;
        btnHideItemEntry.classList.toggle('active', hideItemEntry);
        _a.classList.toggle('hide-item-entry', hideItemEntry);
      }
      if (p.hideImgEntry !== undefined)   { hideImgEntry = p.hideImgEntry; btnHideImgEntry.classList.toggle('active', hideImgEntry); _a.classList.toggle('hide-img-entry', hideImgEntry); }
      if (p.searchItems !== undefined)    { searchItems = p.searchItems; cbSearchItems.checked = searchItems; }
      if (p.searchTitles !== undefined)   { searchTitles = p.searchTitles; cbSearchTitles.checked = searchTitles; }
      if (p.searchTags !== undefined)     { searchTags = p.searchTags; cbSearchTags.checked = searchTags; }
      if (p.tagFilterActive !== undefined) { _tagFilterActive = p.tagFilterActive; }
      if (p.savedSearchItems !== undefined) { _savedSearchItems = p.savedSearchItems; }
      if (p.savedSearchTitles !== undefined) { _savedSearchTitles = p.savedSearchTitles; }
      if (p.savedSearchTags !== undefined)   { _savedSearchTags = p.savedSearchTags; }
      if (p.savedQuery !== undefined)        { _savedQuery = p.savedQuery; }
    } catch(e) {}
  }
  (function () {
    var _st = null;
    function _defer() { clearTimeout(_st); _st = setTimeout(_saveUiState, 80); }
    document.getElementById('header').addEventListener('click', _defer, true);
    searchInput.addEventListener('input', _defer);
  })();
  function _dateStr() {
    var d  = new Date();
    var p  = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) +
           '_' + p(d.getHours()) + p(d.getMinutes());
  }
})();

