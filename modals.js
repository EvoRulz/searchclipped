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
function _initConfirm() {
  _confirmModal  = document.getElementById('confirm-modal');
  _confirmMsg    = document.getElementById('confirm-msg');
  _confirmInput  = document.getElementById('confirm-input');
  _confirmOk     = document.getElementById('confirm-ok');
  _confirmCancel = document.getElementById('confirm-cancel');
  _confirmOk.addEventListener('click', function () {
    if ((_confirmInput.value || '').trim().toLowerCase() !== 'yes') {
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
function confirm(message) {
  _confirmMsg.textContent = message;
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
function _initTagEditor() {
  _tagModal   = document.getElementById('tag-modal');
  _tagListEl  = document.getElementById('tag-list-edit');
  _tagInput   = document.getElementById('tag-input');
  _tagAddBtn  = document.getElementById('tag-add-btn');
  _tagDoneBtn = document.getElementById('tag-done');
  _tagAddBtn.addEventListener('click', _addTag);
  _tagInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') _addTag();
    if (e.key === 'Escape') _closeTagEditor();
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
      _renderTagList(item);
    });
    row.appendChild(span);
    row.appendChild(delBtn);
    _tagListEl.appendChild(row);
  });
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
  _renderTagList(item);
  _tagInput.value = '';
  _tagModal.classList.remove('hidden');
  setTimeout(function () { _tagInput.focus(); }, 50);
}
function init() {
  _initConfirm();
  _initTagEditor();
}
window.Modals = { init, confirm, openTagEditor };

