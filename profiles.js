'use strict';
/*
 * profiles.js — local profile management + Firebase Auth + Firestore sync
 * Fill FIREBASE_CONFIG with your project values.
 * Requires: Firebase compat SDK scripts loaded before this file.
 * window.Profiles
 */
// ===== FIREBASE CONFIG — fill these in =====
var FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDtVg2tw6lIfk3kNaibqlD1ha_jZGWuK50',
  authDomain:        'searchclipped.firebaseapp.com',
  projectId:         'searchclipped',
  storageBucket:     'searchclipped.firebasestorage.app',
  messagingSenderId: '514436177869',
  appId:             '1:514436177869:web:2bb47014f78c0ac4c46e84'
};
// ===== MODULE STATE =====
var _profiles        = [];
var _activeIds       = new Set();
var _visibleIds      = new Set();
var _currentUser     = null;
var _authInstance    = null;
var _firestoreDb     = null;
var _appState        = null;
var _refreshFn       = null;
var _panelOpen       = false;
var _addFormOpen     = false;
var _deleteConfirmId = null;
// ===== DEVICE DETECTION =====
function _getDeviceType() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'computer';
}
// ===== PROFILE FACTORY =====
function _makeProfile(name, icon, color, deviceType) {
  return {
    id:         'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name:       name       || 'Profile',
    icon:       icon       || null,
    color:      color      || '#5c9edb',
    deviceType: deviceType || 'custom',
    createdAt:  new Date().toISOString()
  };
}
// ===== INIT =====
async function init(appState, refreshFn) {
  _appState  = appState;
  _refreshFn = refreshFn;
  _profiles = (await DB.loadProfiles()) || [];
  // First run: create default profile, migrate all existing items to it
  if (!_profiles.length) {
    var devType = _getDeviceType();
    var p = _makeProfile(
      devType === 'mobile' ? 'Mobile' : 'Computer',
      null,
      devType === 'mobile' ? '#99c794' : '#5c9edb',
      devType
    );
    _profiles.push(p);
    await DB.saveProfiles(_profiles);
    _appState.items.forEach(function(item) {
      if (!item.profileIds || !item.profileIds.length) item.profileIds = [p.id];
    });
    State.saveState(_appState);
  }
  // Migrate any items that still have no profileIds
  var defaultId  = _profiles[0].id;
  var migrated   = false;
  _appState.items.forEach(function(item) {
    if (!item.profileIds || !item.profileIds.length) { item.profileIds = [defaultId]; migrated = true; }
  });
  if (migrated) State.saveState(_appState);
  _loadPrefs();
  _initFirebase();
  _wirePanel();
  _updateAuthUI();
  _renderDeviceIcons();
  if (_refreshFn) _refreshFn();
}
// ===== PREFS =====
function _loadPrefs() {
  try {
    var raw = localStorage.getItem('sc_profile_prefs');
    if (!raw) { _resetToDefaults(); return; }
    var p       = JSON.parse(raw);
    var validIds = new Set(_profiles.map(function(pr) { return pr.id; }));
    var active   = (p.activeIds  || []).filter(function(id) { return validIds.has(id); });
    var visible  = (p.visibleIds || []).filter(function(id) { return validIds.has(id); });
    _activeIds  = new Set(active.length  ? active  : [_profiles[0].id]);
    _visibleIds = new Set(visible.length ? visible : [_profiles[0].id]);
  } catch(e) { _resetToDefaults(); }
}
function _savePrefs() {
  try {
    localStorage.setItem('sc_profile_prefs', JSON.stringify({
      activeIds:  Array.from(_activeIds),
      visibleIds: Array.from(_visibleIds)
    }));
  } catch(e) {}
}
function _resetToDefaults() {
  var id = _profiles.length ? _profiles[0].id : null;
  _activeIds  = id ? new Set([id]) : new Set();
  _visibleIds = id ? new Set([id]) : new Set();
}
// ===== FIREBASE =====
function _initFirebase() {
  if (typeof firebase === 'undefined') return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _authInstance = firebase.auth();
    _firestoreDb  = firebase.firestore();
    _authInstance.onAuthStateChanged(function(user) {
      _currentUser = user;
      _updateAuthUI();
      _renderDeviceIcons();
    });
  } catch(e) { console.warn('Firebase init failed', e); }
}
async function signInWithGoogle() {
  if (!_authInstance) { alert('Firebase not configured — fill in FIREBASE_CONFIG in profiles.js.'); return; }
  try {
    var provider = new firebase.auth.GoogleAuthProvider();
    await _authInstance.signInWithPopup(provider);
  } catch(e) { if (e.code !== 'auth/popup-closed-by-user') console.warn('Sign-in failed', e); }
}
async function signOut() {
  if (!_authInstance) return;
  try { await _authInstance.signOut(); } catch(e) { console.warn('Sign-out failed', e); }
}
// ===== FIRESTORE SYNC =====
async function syncProfile(profileId) {
  if (!_currentUser || !_firestoreDb) { alert('Sign in to sync.'); return; }
  var profile = _profiles.find(function(p) { return p.id === profileId; });
  if (!profile) return;
  var uid  = _currentUser.uid;
  var base = _firestoreDb.collection('users').doc(uid).collection('profiles').doc(profileId);
  await base.set(
    { name: profile.name, color: profile.color, icon: profile.icon, deviceType: profile.deviceType, createdAt: profile.createdAt },
    { merge: true }
  );
  var items = _appState.items.filter(function(i) { return (i.profileIds || []).indexOf(profileId) !== -1; });
  var batch = _firestoreDb.batch();
  items.forEach(function(item) {
    var copy = JSON.parse(JSON.stringify(item));
    delete copy.itemUndoStack;
    delete copy.itemRedoStack;
    batch.set(base.collection('items').doc(item.id), copy, { merge: true });
  });
  await batch.commit();
  alert('Pushed ' + items.length + ' items to cloud for profile "' + profile.name + '".');
}
async function pullProfile(profileId) {
  if (!_currentUser || !_firestoreDb) { alert('Sign in to sync.'); return; }
  var uid  = _currentUser.uid;
  var base = _firestoreDb.collection('users').doc(uid).collection('profiles').doc(profileId);
  var snap = await base.collection('items').get();
  var pulled = 0;
  snap.forEach(function(doc) {
    var remote = doc.data();
    var local  = State.getItem(_appState, remote.id);
    if (!local) {
      if (!remote.profileIds)    remote.profileIds    = [profileId];
      if (!remote.versions)      remote.versions      = [];
      if (!remote.itemUndoStack) remote.itemUndoStack = [];
      if (!remote.itemRedoStack) remote.itemRedoStack = [];
      _appState.items.push(remote);
      pulled++;
    } else {
      // Merge profileIds
      (remote.profileIds || []).forEach(function(id) {
        if ((local.profileIds || []).indexOf(id) === -1) local.profileIds = (local.profileIds || []).concat([id]);
      });
      // Merge version history (add remote versions not present locally)
      (remote.versions || []).forEach(function(rv) {
        var exists = (local.versions || []).some(function(lv) { return lv.ts === rv.ts; });
        if (!exists) (local.versions = local.versions || []).push(rv);
      });
    }
  });
  State.saveState(_appState);
  if (_refreshFn) _refreshFn();
  alert('Pulled ' + pulled + ' new item(s) from cloud for profile "' +
    ((_profiles.find(function(p) { return p.id === profileId; }) || {}).name || profileId) + '".');
}
// ===== PROFILE CRUD =====
async function createProfile(name, icon, color, deviceType, sourceProfileIds) {
  var p = _makeProfile(name, icon, color, deviceType || 'custom');
  _profiles.push(p);
  await DB.saveProfiles(_profiles);
  if (sourceProfileIds && sourceProfileIds.length) {
    var seen = {};
    _appState.items.forEach(function(item) {
      var hasSource = (item.profileIds || []).some(function(id) { return sourceProfileIds.indexOf(id) !== -1; });
      if (!hasSource) return;
      var key = (item.text || '').trim() + '\x00' + (item.title || '').trim();
      if (seen[key]) {
        // Merge version history into the first occurrence
        var first = seen[key];
        (item.versions || []).forEach(function(v) {
          var exists = (first.versions || []).some(function(fv) { return fv.ts === v.ts; });
          if (!exists) (first.versions = first.versions || []).push(v);
        });
      } else {
        seen[key] = item;
        if ((item.profileIds || []).indexOf(p.id) === -1) item.profileIds.push(p.id);
      }
    });
    State.saveState(_appState);
  }
  _activeIds.add(p.id);
  _visibleIds.add(p.id);
  _savePrefs();
  _renderProfilePanel();
  if (_refreshFn) _refreshFn();
  return p;
}
async function deleteProfile(profileId) {
  var fallbackId = _profiles.filter(function(p) { return p.id !== profileId; }).length
    ? _profiles.filter(function(p) { return p.id !== profileId; })[0].id
    : null;
  _profiles = _profiles.filter(function(p) { return p.id !== profileId; });
  await DB.saveProfiles(_profiles);
  _appState.items.forEach(function(item) {
    item.profileIds = (item.profileIds || []).filter(function(id) { return id !== profileId; });
    // Items that now belong to no profile get assigned to the first remaining profile
    if (!item.profileIds.length && fallbackId) item.profileIds = [fallbackId];
  });
  State.saveState(_appState);
  _activeIds.delete(profileId);
  _visibleIds.delete(profileId);
  if (!_activeIds.size  && _profiles.length) _activeIds.add(_profiles[0].id);
  if (!_visibleIds.size && _profiles.length) _visibleIds.add(_profiles[0].id);
  _savePrefs();
  _deleteConfirmId = null;
  _renderProfilePanel();
  if (_refreshFn) _refreshFn();
}
async function updateProfile(profileId, changes) {
  var p = _profiles.find(function(pr) { return pr.id === profileId; });
  if (!p) return;
  Object.assign(p, changes);
  await DB.saveProfiles(_profiles);
  if (_refreshFn) _refreshFn();
}
// ===== VISIBILITY / ACTIVE =====
function setVisible(profileId, visible) {
  if (visible) _visibleIds.add(profileId);
  else         _visibleIds.delete(profileId);
  if (!_visibleIds.size && _profiles.length) _visibleIds.add(_profiles[0].id);
  _savePrefs();
  if (_refreshFn) _refreshFn();
}
function setActive(profileId, active) {
  if (active) _activeIds.add(profileId);
  else        _activeIds.delete(profileId);
  if (!_activeIds.size && _profiles.length) _activeIds.add(_profiles[0].id);
  _savePrefs();
}
function getActiveIds()   { return _activeIds; }
function getVisibleIds()  { return _visibleIds; }
function getProfiles()    { return _profiles; }
function getCurrentUser() { return _currentUser; }
// ===== ITEM FILTERING =====
function filterItems(items) {
  if (!_visibleIds.size) return items;
  return items.filter(function(item) {
    var pids = item.profileIds || [];
    if (!pids.length) return true; // untagged items always visible (migration safety)
    return pids.some(function(id) { return _visibleIds.has(id); });
  });
}
// ===== AUTH UI =====
function _updateAuthUI() {
  var btn = document.getElementById('auth-btn');
  if (!btn) return;
  if (_currentUser) {
    if (_currentUser.photoURL) {
      btn.innerHTML = '<img src="' + _currentUser.photoURL + '" alt="Profile" class="auth-avatar-img">';
    } else {
      btn.innerHTML = '<span class="auth-initials">' + (_currentUser.displayName || _currentUser.email || 'U').charAt(0).toUpperCase() + '</span>';
    }
    btn.title = _currentUser.displayName || _currentUser.email || 'Signed in';
    btn.classList.add('signed-in');
    btn.onclick = _showAuthMenu;
  } else {
    btn.innerHTML = _bustSVG();
    btn.title = 'Sign in with Google';
    btn.classList.remove('signed-in');
    btn.onclick = signInWithGoogle;
  }
}
function _showAuthMenu() {
  var existing = document.getElementById('auth-menu');
  if (existing) { existing.remove(); return; }
  var menu = document.createElement('div');
  menu.id = 'auth-menu';
  menu.className = 'auth-dropdown';
  var nameEl = document.createElement('div');
  nameEl.className = 'auth-menu-name';
  nameEl.textContent = _currentUser ? (_currentUser.displayName || _currentUser.email || '') : '';
  menu.appendChild(nameEl);
  var signOutBtn = document.createElement('button');
  signOutBtn.textContent = 'Sign out';
  signOutBtn.addEventListener('click', function() { menu.remove(); signOut(); });
  menu.appendChild(signOutBtn);
  var switchBtn = document.createElement('button');
  switchBtn.textContent = 'Switch account';
  switchBtn.addEventListener('click', function() { menu.remove(); signOut().then(function() { signInWithGoogle(); }); });
  menu.appendChild(switchBtn);
  document.querySelector('.title-row-right').appendChild(menu);
  setTimeout(function() {
    document.addEventListener('click', function _hide(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', _hide); }
    });
  }, 0);
}
// ===== DEVICE ICONS =====
function _renderDeviceIcons() {
  var wrap = document.getElementById('profile-device-icons');
  if (!wrap) return;
  if (!_currentUser) { wrap.innerHTML = ''; return; }
  var deviceType = _getDeviceType();
  wrap.innerHTML = '';
  var computerBtn = document.createElement('button');
  computerBtn.className = 'profile-device-btn' + (deviceType === 'computer' ? ' active' : '');
  computerBtn.title     = 'Computer';
  computerBtn.innerHTML = _computerSVG();
  computerBtn.addEventListener('click', openPanel);
  wrap.appendChild(computerBtn);
  var mobileBtn = document.createElement('button');
  mobileBtn.className = 'profile-device-btn' + (deviceType === 'mobile' ? ' active' : '');
  mobileBtn.title     = 'Mobile';
  mobileBtn.innerHTML = _mobileSVG();
  mobileBtn.addEventListener('click', openPanel);
  wrap.appendChild(mobileBtn);
}
// ===== PROFILE PANEL =====
function openPanel() {
  var panel = document.getElementById('profile-panel');
  if (!panel) return;
  _panelOpen = true;
  panel.classList.remove('hidden');
  _renderProfilePanel();
}
function closePanel() {
  var panel = document.getElementById('profile-panel');
  if (panel) panel.classList.add('hidden');
  _panelOpen       = false;
  _addFormOpen     = false;
  _deleteConfirmId = null;
}
function _renderProfilePanel() {
  if (!_panelOpen) return;
  var listEl = document.getElementById('profile-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  _profiles.forEach(function(profile) {
    var isVisible = _visibleIds.has(profile.id);
    var isActive  = _activeIds.has(profile.id);
    var row = document.createElement('div');
    row.className = 'profile-row';
    var iconEl = document.createElement('div');
    iconEl.className   = 'profile-icon-wrap';
    iconEl.innerHTML   = _profileIconHTML(profile, 28);
    row.appendChild(iconEl);
    var nameEl = document.createElement('input');
    nameEl.type      = 'text';
    nameEl.value     = profile.name;
    nameEl.className = 'profile-name-input';
    nameEl.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') nameEl.blur(); });
    nameEl.addEventListener('blur', function() {
      var v = (nameEl.value || '').trim();
      if (v && v !== profile.name) updateProfile(profile.id, { name: v });
    });
    row.appendChild(nameEl);
    if (_currentUser) {
      var pushBtn = document.createElement('button');
      pushBtn.className = 'profile-sync-btn';
      pushBtn.title     = 'Push to cloud';
      pushBtn.textContent = '↑';
      pushBtn.addEventListener('click', function() { syncProfile(profile.id); });
      row.appendChild(pushBtn);
      var pullBtn = document.createElement('button');
      pullBtn.className   = 'profile-sync-btn';
      pullBtn.title       = 'Pull from cloud';
      pullBtn.textContent = '↓';
      pullBtn.addEventListener('click', function() { pullProfile(profile.id); });
      row.appendChild(pullBtn);
    }
    var eyeBtn = document.createElement('button');
    eyeBtn.className = 'profile-toggle-btn' + (isVisible ? ' active' : '');
    eyeBtn.title     = isVisible ? 'Hide profile' : 'Show profile';
    eyeBtn.innerHTML = isVisible ? _eyeOpenSVG() : _eyeClosedSVG();
    eyeBtn.addEventListener('click', function() { setVisible(profile.id, !isVisible); _renderProfilePanel(); });
    row.appendChild(eyeBtn);
    var writeBtn = document.createElement('button');
    writeBtn.className = 'profile-toggle-btn' + (isActive ? ' active-write' : '');
    writeBtn.title     = isActive ? 'Stop writing to this profile' : 'Write to this profile';
    writeBtn.innerHTML = _pencilSVG();
    writeBtn.addEventListener('click', function() { setActive(profile.id, !isActive); _renderProfilePanel(); });
    row.appendChild(writeBtn);
    if (_deleteConfirmId === profile.id) {
      var confirmWrap = document.createElement('div');
      confirmWrap.className = 'profile-delete-confirm';
      var confirmInput = document.createElement('input');
      confirmInput.type        = 'text';
      confirmInput.placeholder = 'type "delete profile"';
      confirmInput.className   = 'profile-delete-input';
      confirmInput.addEventListener('keydown', function(e) {
        e.stopPropagation();
        if (e.key === 'Enter') confirmBtn.click();
        if (e.key === 'Escape') { _deleteConfirmId = null; _renderProfilePanel(); }
      });
      var confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.className   = 'profile-delete-confirm-btn';
      confirmBtn.addEventListener('click', function() {
        if ((confirmInput.value || '').trim().toLowerCase() === 'delete profile') {
          deleteProfile(profile.id);
        } else {
          confirmInput.classList.add('error');
          setTimeout(function() { confirmInput.classList.remove('error'); }, 400);
          confirmInput.focus();
        }
      });
      var cancelConfirmBtn = document.createElement('button');
      cancelConfirmBtn.textContent = 'Cancel';
      cancelConfirmBtn.className   = 'profile-delete-cancel-btn';
      cancelConfirmBtn.addEventListener('click', function() { _deleteConfirmId = null; _renderProfilePanel(); });
      confirmWrap.appendChild(confirmInput);
      confirmWrap.appendChild(confirmBtn);
      confirmWrap.appendChild(cancelConfirmBtn);
      row.appendChild(confirmWrap);
      setTimeout(function() { confirmInput.focus(); }, 30);
    } else {
      var delBtn = document.createElement('button');
      delBtn.className   = 'profile-del-btn';
      delBtn.title       = 'Delete profile';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', function() { _deleteConfirmId = profile.id; _renderProfilePanel(); });
      row.appendChild(delBtn);
    }
    listEl.appendChild(row);
  });
  var addBtn  = document.getElementById('btn-add-profile');
  var addForm = document.getElementById('add-profile-form');
  if (addBtn)  addBtn.style.display  = _addFormOpen ? 'none' : '';
  if (addForm) addForm.style.display = _addFormOpen ? ''     : 'none';
  if (_addFormOpen) {
    var sourcesEl = document.getElementById('add-profile-sources');
    if (sourcesEl) {
      sourcesEl.innerHTML = '';
      _profiles.forEach(function(p) {
        var lbl = document.createElement('label');
        lbl.className = 'profile-source-label';
        var cb  = document.createElement('input');
        cb.type  = 'checkbox';
        cb.value = p.id;
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode('\u00a0' + p.name));
        sourcesEl.appendChild(lbl);
      });
    }
  }
}
function _wirePanel() {
  // Stop all keydowns inside the panel from reaching global handlers
  var box = document.querySelector('.profile-panel-box');
  if (box) box.addEventListener('keydown', function(e) { e.stopPropagation(); });
  var overlay = document.getElementById('profile-panel');
  if (overlay) overlay.addEventListener('click', function(e) { if (e.target === overlay) closePanel(); });
  var closeBtn = document.getElementById('profile-panel-close');
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  var openBtn = document.getElementById('btn-profiles');
  if (openBtn) openBtn.addEventListener('click', openPanel);
  var addBtn = document.getElementById('btn-add-profile');
  if (addBtn) {
    addBtn.addEventListener('click', function() {
      _addFormOpen = true;
      _renderProfilePanel();
      setTimeout(function() { var inp = document.getElementById('new-profile-name'); if (inp) inp.focus(); }, 40);
    });
  }
  var confirmAddBtn = document.getElementById('confirm-add-profile');
  if (confirmAddBtn) {
    confirmAddBtn.addEventListener('click', function() {
      var name  = (document.getElementById('new-profile-name').value  || '').trim();
      var icon  = (document.getElementById('new-profile-icon').value  || '').trim() || null;
      var color = (document.getElementById('new-profile-color').value || '#5c9edb');
      if (!name) { document.getElementById('new-profile-name').focus(); return; }
      var cbs       = Array.from(document.querySelectorAll('#add-profile-sources input[type="checkbox"]:checked'));
      var sourceIds = cbs.map(function(cb) { return cb.value; });
      createProfile(name, icon, color, 'custom', sourceIds);
      _addFormOpen = false;
      document.getElementById('new-profile-name').value = '';
      document.getElementById('new-profile-icon').value = '';
    });
  }
  var cancelAddBtn = document.getElementById('cancel-add-profile');
  if (cancelAddBtn) {
    cancelAddBtn.addEventListener('click', function() { _addFormOpen = false; _renderProfilePanel(); });
  }
}
// ===== ITEM PROFILE ICONS (called from render.js) =====
function getItemProfileIconsHTML(item) {
  if (!item || !item.profileIds || !item.profileIds.length) return '';
  if (_visibleIds.size <= 1) return ''; // Only show icons when multiple profiles are visible
  var out = '';
  item.profileIds.forEach(function(pid) {
    var p = _profiles.find(function(pr) { return pr.id === pid; });
    if (!p) return;
    var dimmed = !_visibleIds.has(pid);
    out += '<span class="item-profile-icon' + (dimmed ? ' item-profile-icon-dim' : '') + '" title="' + p.name + '">'
        + _profileIconHTML(p, 12) + '</span>';
  });
  return out;
}
// ===== PROFILE ICON HTML =====
function _profileIconHTML(profile, size) {
  size = size || 20;
  if (profile.icon) {
    var icon = profile.icon.trim();
    if (icon.startsWith('<svg') || icon.startsWith('<SVG')) {
      return `<span class="profile-icon-svg" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;">${icon}</span>`;
    }
    if (icon.startsWith('http') || icon.startsWith('data:') || icon.startsWith('/')) {
      return `<img src="${icon}" class="profile-icon-img" style="width:${size}px;height:${size}px;" alt="${profile.name || ''}">`;
    }
    if (icon.length <= 4) {
      return `<span class="profile-icon-emoji" style="font-size:${Math.round(size * 0.78)}px;line-height:${size}px;">${icon}</span>`;
    }
  }
  var initial = (profile.name || '?').charAt(0).toUpperCase();
  return `<span class="profile-icon-initials" style="width:${size}px;height:${size}px;background:${profile.color};font-size:${Math.round(size * 0.5)}px;line-height:${size}px;">${initial}</span>`;
}
// ===== SVGs =====
function _bustSVG() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/>
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}
function _computerSVG() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
    <path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}
function _mobileSVG() {
  return `<svg width="11" height="16" viewBox="0 0 18 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="16" height="22" rx="3" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="9" cy="19.5" r="1.2" fill="currentColor"/>
  </svg>`;
}
function _eyeOpenSVG() {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0.5 7 Q4 4 7 4 Q10 4 13.5 7 Q10 10 7 10 Q4 10 0.5 7 Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="7" cy="7" r="2.6" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="7" cy="7" r="1" fill="currentColor"/>
  </svg>`;
}
function _eyeClosedSVG() {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 7 L4 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M10 7 L13 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
  </svg>`;
}
function _pencilSVG() {
  return `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.5 2.5L11.5 4.5L5 11H3V9L9.5 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`;
}
window.Profiles = {
  init,
  getProfiles,
  getActiveIds,
  getVisibleIds,
  getCurrentUser,
  filterItems,
  setVisible,
  setActive,
  createProfile,
  deleteProfile,
  updateProfile,
  syncProfile,
  pullProfile,
  signInWithGoogle,
  signOut,
  openPanel,
  closePanel,
  getItemProfileIconsHTML,
  _profileIconHTML
};

