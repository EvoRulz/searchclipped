'use strict';
/*
 * permissions.js
 * Manages per-feature permissions (clipboard-read, clipboard-write, share).
 * Stores decisions in state.permissions as 'granted' | 'denied' | 'never'.
 * Shows a toast for each request; resolves promise with boolean.
 * Exported on window.Perms
 */

var _state       = null;
var _pendingResolve = null;
var _toast       = null;
var _msg         = null;
var _allowBtn    = null;
var _denyBtn     = null;
var _neverBtn    = null;

function init(state) {
  _state    = state;
  _toast    = document.getElementById('perm-toast');
  _msg      = document.getElementById('perm-msg');
  _allowBtn = document.getElementById('perm-allow');
  _denyBtn  = document.getElementById('perm-deny');
  _neverBtn = document.getElementById('perm-never');

  _allowBtn.addEventListener('click', function () { _resolve(true,  false); });
  _denyBtn.addEventListener('click',  function () { _resolve(false, false); });
  _neverBtn.addEventListener('click', function () { _resolve(false, true);  });
}

function _resolve(allowed, never) {
  _toast.classList.add('hidden');
  if (!_pendingResolve) return;
  if (never)        _state.permissions[_pendingPerm] = 'never';
  else if (allowed) _state.permissions[_pendingPerm] = 'granted';
  else              _state.permissions[_pendingPerm] = 'denied';
  State.saveState(_state);
  var cb = _pendingResolve;
  _pendingResolve = null;
  _pendingPerm    = null;
  cb(allowed);
}

var _pendingPerm = null;

/*
 * request(permName, message) → Promise<boolean>
 * If 'never'   → resolves false immediately.
 * If 'granted' → resolves true immediately.
 * Otherwise    → shows toast, waits for user choice.
 */
function request(permName, message) {
  var decision = _state.permissions[permName];
  if (decision === 'never')   return Promise.resolve(false);
  if (decision === 'granted') return Promise.resolve(true);

  return new Promise(function (resolve) {
    _pendingResolve = resolve;
    _pendingPerm    = permName;
    _msg.textContent = message;
    _toast.classList.remove('hidden');
  });
}

/*
 * check(permName) → boolean
 * Non-blocking read of current permission state.
 */
function check(permName) {
  return _state.permissions[permName] === 'granted';
}

window.Perms = { init, request, check };
