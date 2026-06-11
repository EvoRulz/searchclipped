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
function init() {
  _initConfirm();
}
window.Modals = { init, confirm };

