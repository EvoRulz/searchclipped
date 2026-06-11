'use strict';
/*
 * modals.js
 * Confirm modal (requires typing "yes") and tag-editor modal.
 * Exported on window.Modals
 */
/* ===== CONFIRM MODAL ===== */
var _confirmModal   = null;
var _confirmMsg     = null;
var _confirmInput   = null;
var _confirmOk      = null;
var _confirmCancel  = null;
var _confirmResolve = null;
var _confirmWord    = 'yes';
function _initConfirm() {
  _confirmModal  = document.getElementById('confirm-modal');
  _confirmMsg    = document.getElementById('confirm-msg');
  _confirmInput  = document.getElementById('confirm-input');
  _confirmOk     = document.getElementById('confirm-ok');
  _confirmCancel = document.getElementById('confirm-cancel');
  _confirmOk.addEventListener('click', function () {
    if ((_confirmInput.value || '').trim().toLowerCase() !== _confirmWord) {
      _confirmInput.classList.add('error');
      setTimeout(function () { _confirmInput.classList.remove('error'); }, 400);
      _confirmInput.focus();
      return;
    }
    _closeConfirm(true);
  });
  _confirmCancel.addEventListener('click', function () {
    _closeConfirm(false);
  });
  _confirmModal.addEventListener('click', function (e) {
    if (e.target === _confirmModal) _closeConfirm(false);
  });
  _confirmInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') _confirmOk.click();
    if (e.key === 'Escape') _closeConfirm(false);
  });
}
function _closeConfirm(result) {
  _confirmModal.classList.add('hidden');
  _confirmInput.value = '';
  if (_confirmResolve) {
    var cb = _confirmResolve;
    _confirmResolve = null;
    cb(result);
  }
}
/*
 * confirm(message) → Promise<boolean>
 */
function confirm(message, word) {
  _confirmWord = word || 'yes';
  _confirmMsg.textContent = message;
  _confirmInput.placeholder = 'Type "' + _confirmWord + '" to confirm';
  _confirmInput.value     = '';
  _confirmModal.classList.remove('hidden');
  setTimeout(function () { _confirmInput.focus(); }, 50);
  return new Promise(function (resolve) {
    _confirmResolve = resolve;
  });
}
/* ===== TAG EDITOR MODAL ===== */
var _tagModal   = null;
var _tagListEl  = null;
var _tagInput   = null;
var _tagAddBtn  = null;
var _tagDoneBtn = null;
var _tagItemId  = null;   // item being edited
var _tagState   = null;
var _tagOnDone  = null;   // callback(item)
var _tagGhostEl       = null;
var _tagEntries       = [];
var _tagHistoryOpen   = false;
var _tagHistoryDir    = null;
var _tagHistoryIdx    = 0;
var _tagHistoryList   = [];
var _tagOverlayEl     = null;
var _tagOverlayBelow  = null;
function _initTagEditor() {
  _tagModal   = document.getElementById('tag-modal');
  _tagListEl  = document.getElementById('tag-list-edit');
  _tagInput   = document.getElementById('tag-input');
  _tagAddBtn  = document.getElementById('tag-add-btn');
  _tagDoneBtn = document.getElementById('tag-done');
  _tagAddBtn.addEventListener('click', _addTag);
  _setupTagAutocomplete();
  _tagInput.addEventListener('input', function () {
    if (_tagHistoryOpen) _closeTagHistory();
    _tagGhostText();
  });
  _tagInput.addEventListener('focus', function () {
    _tagGhostText();
  });
  _tagInput.addEventListener('blur', function () {
    setTimeout(function () {
      var ae = document.activeElement;
      if (_tagOverlayEl    && _tagOverlayEl.contains(ae))    return;
      if (_tagOverlayBelow && _tagOverlayBelow.contains(ae)) return;
      _closeTagHistory();
    }, 120);
  });
  _tagInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp')   { e.preventDefault(); _openOrScrollTagHistory('up');   return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _openOrScrollTagHistory('down'); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (_tagHistoryOpen) {
        var sel = _tagHistoryList[_tagHistoryIdx];
        if (sel) _tagInput.value = sel.tag;
        _closeTagHistory();
        if (_tagGhostEl) _tagGhostEl.textContent = '';
        return;
      }
      var completion = _tagGhostCompletion();
      if (completion) {
        _tagInput.value = completion;
        if (_tagGhostEl) _tagGhostEl.textContent = '';
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (_tagHistoryOpen) {
        var selE = _tagHistoryList[_tagHistoryIdx];
        if (selE) _tagInput.value = selE.tag;
        _closeTagHistory();
        if (_tagGhostEl) _tagGhostEl.textContent = '';
        _addTag();
        return;
      }
      var completionE = _tagGhostCompletion();
      if (completionE) {
        _tagInput.value = completionE;
        if (_tagGhostEl) _tagGhostEl.textContent = '';
      }
      _addTag();
      return;
    }
    if (e.key === 'Escape') {
      if (_tagHistoryOpen) { e.preventDefault(); _closeTagHistory(); return; }
      _closeTagEditor();
    }
  });
  _tagDoneBtn.addEventListener('click', _closeTagEditor);
  _tagModal.addEventListener('click', function (e) {
    if (e.target === _tagModal) _closeTagEditor();
  });
}
function _addTag() {
  var raw = (_tagInput.value || '').trim();
  if (!raw) return;
  var item = State.getItem(_tagState, _tagItemId);
  if (!item) return;
  if (!item.tags.includes(raw)) {
    item.tags.push(raw);
    item.modifiedAt = State.nowISO();
  }
  _tagInput.value = '';
  if (_tagGhostEl) _tagGhostEl.textContent = '';
  _closeTagHistory();
  _tagEntries = _computeTagEntries(item);
  _renderTagList(item);
}
function _renderTagList(item) {
  _tagListEl.innerHTML = '';
  item.tags.forEach(function (tag) {
    var row    = document.createElement('div');
    row.className = 'tag-edit-row';
    var span   = document.createElement('span');
    span.textContent = tag;
    var delBtn = document.createElement('button');
    delBtn.className   = 'tag-del-btn';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', function () {
      item.tags = item.tags.filter(function (t) { return t !== tag; });
      item.modifiedAt = State.nowISO();
      _tagEntries = _computeTagEntries(item);
      _renderTagList(item);
    });
    row.appendChild(span);
    row.appendChild(delBtn);
    _tagListEl.appendChild(row);
  });
}
function _computeTagEntries(item) {
  var showDel = document.getElementById('app').classList.contains('show-deleted');
  var counts = {};
  (_tagState.items || []).forEach(function (it) {
    if (it.deleted && !showDel) return;
    (it.tags || []).forEach(function (t) {
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  var exclude = {};
  (item.tags || []).forEach(function (t) { exclude[t] = true; });
  var entries = Object.keys(counts).filter(function (t) { return !exclude[t]; }).map(function (t) {
    return { tag: t, count: counts[t] };
  });
  entries.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.tag.localeCompare(b.tag);
  });
  return entries;
}
function _setupTagAutocomplete() {
  var inputRow = _tagInput.parentElement;
  var inner = document.createElement('div');
  inner.className = 'tag-input-inner';
  inputRow.insertBefore(inner, _tagInput);
  var ghost = document.createElement('div');
  ghost.className = 'tag-history-ghost';
  _tagGhostEl = ghost;
  inner.appendChild(ghost);
  inner.appendChild(_tagInput);
}
function _tagGhostText() {
  if (!_tagGhostEl) return;
  var q = _tagInput.value;
  if (!q || _tagHistoryOpen) { _tagGhostEl.textContent = ''; return; }
  var ql = q.toLowerCase();
  var best = null;
  for (var i = 0; i < _tagEntries.length; i++) {
    var e = _tagEntries[i];
    if (e.tag.toLowerCase().indexOf(ql) === 0 && e.tag.length > q.length) { best = e; break; }
  }
  _tagGhostEl.textContent = best ? (q + best.tag.slice(q.length)) : '';
}
function _tagGhostCompletion() {
  var q = _tagInput.value;
  if (!q) return null;
  var ql = q.toLowerCase();
  for (var i = 0; i < _tagEntries.length; i++) {
    var e = _tagEntries[i];
    if (e.tag.toLowerCase().indexOf(ql) === 0 && e.tag.length > q.length) return e.tag;
  }
  return null;
}
function _tagHistoryFilteredList() {
  var q = (_tagInput.value || '').toLowerCase();
  if (!q) return _tagEntries;
  return _tagEntries.filter(function (e) { return e.tag.toLowerCase().indexOf(q) !== -1; });
}
function _closeTagHistory() {
  _tagHistoryOpen = false;
  _tagHistoryDir  = null;
  if (_tagOverlayEl)    { _tagOverlayEl.remove();    _tagOverlayEl    = null; }
  if (_tagOverlayBelow) { _tagOverlayBelow.remove(); _tagOverlayBelow = null; }
}
function _makeTagHistorySlot(entry, idx, isFocused) {
  var el = document.createElement('div');
  el.className = 'tag-history-slot' + (isFocused ? ' focused' : '');
  var txt = document.createElement('span');
  txt.className = 'tag-history-slot-text';
  txt.textContent = entry.tag;
  var cnt = document.createElement('span');
  cnt.className = 'tag-history-slot-count';
  cnt.textContent = entry.count;
  el.appendChild(txt);
  el.appendChild(cnt);
  el.addEventListener('click', function () {
    _tagInput.value = entry.tag;
    _closeTagHistory();
    if (_tagGhostEl) _tagGhostEl.textContent = '';
    _addTag();
  });
  return el;
}
function _renderTagHistoryOverlay() {
  if (_tagOverlayEl)    { _tagOverlayEl.remove();    _tagOverlayEl    = null; }
  if (_tagOverlayBelow) { _tagOverlayBelow.remove(); _tagOverlayBelow = null; }
  var list = _tagHistoryList;
  if (!list.length) { _closeTagHistory(); return; }
  var n = list.length;
  var wrap = _tagInput.closest('.tag-input-inner');
  function _idx(offset) { return ((_tagHistoryIdx + offset) % n + n) % n; }
  var isUp      = _tagHistoryDir === 'up';
  var above2Idx = isUp ? _idx(0)  : _idx(1);
  var above1Idx = isUp ? _idx(1)  : _idx(2);
  var below1Idx = isUp ? _idx(-1) : _idx(0);
  var below2Idx = isUp ? _idx(-2) : _idx(-1);
  var above = document.createElement('div');
  above.className = 'tag-history-above';
  if (n > 1) above.appendChild(_makeTagHistorySlot(list[above1Idx], above1Idx, false));
  above.appendChild(_makeTagHistorySlot(list[above2Idx], above2Idx, isUp));
  var below = document.createElement('div');
  below.className = 'tag-history-below';
  below.appendChild(_makeTagHistorySlot(list[below1Idx], below1Idx, !isUp));
  if (n > 1) below.appendChild(_makeTagHistorySlot(list[below2Idx], below2Idx, false));
  wrap.appendChild(above);
  wrap.appendChild(below);
  _tagOverlayEl    = above;
  _tagOverlayBelow = below;
}
function _openOrScrollTagHistory(dir) {
  var list = _tagHistoryFilteredList();
  if (!list.length) return;
  if (!_tagHistoryOpen) {
    _tagHistoryOpen = true;
    _tagHistoryDir  = dir;
    _tagHistoryIdx  = dir === 'up' ? 0 : list.length - 1;
  } else {
    _tagHistoryIdx = dir === 'up'
      ? (_tagHistoryIdx + 1) % list.length
      : (_tagHistoryIdx - 1 + list.length) % list.length;
  }
  _tagHistoryList = list;
  if (_tagGhostEl) _tagGhostEl.textContent = '';
  _renderTagHistoryOverlay();
}
function _closeTagEditor() {
  _tagModal.classList.add('hidden');
  if (_tagOnDone) {
    var item = State.getItem(_tagState, _tagItemId);
    var cb   = _tagOnDone;
    _tagOnDone  = null;
    _tagItemId  = null;
    if (item) cb(item);
  }
}
/*
 * openTagEditor(state, itemId, onDone)
 * onDone(item) — called when modal closes
 */
function openTagEditor(appState, itemId, onDone) {
  _tagState  = appState;
  _tagItemId = itemId;
  _tagOnDone = onDone;
  var item   = State.getItem(appState, itemId);
  if (!item) return;
  _tagEntries = _computeTagEntries(item);
  _closeTagHistory();
  _renderTagList(item);
  _tagInput.value = '';
  if (_tagGhostEl) _tagGhostEl.textContent = '';
  _tagModal.classList.remove('hidden');
  setTimeout(function () { _tagInput.focus(); }, 50);
}
function init() {
  _initConfirm();
  _initTagEditor();
}
window.Modals = { init, confirm, openTagEditor };

