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
var _styleEditId          = null;
var _cloudProfiles        = null;
var _cloudProfilesLoading = false;
var _cloudDeleteConfirmId = null;
var _selectedProfileIds   = new Set();
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
// ===== STATUS MESSAGE =====
function _showProfileStatus(msg) {
  var el = document.getElementById('profile-status-msg');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
function _hideProfileStatus() {
  var el = document.getElementById('profile-status-msg');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
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
  var _knownIds  = new Set(_profiles.map(function(p) { return p.id; }));
  var migrated   = false;
  _appState.items.forEach(function(item) {
    if (!item.profileIds || !item.profileIds.length) {
      item.profileIds = [defaultId];
      migrated = true;
    } else if (!item.profileIds.some(function(id) { return _knownIds.has(id); })) {
      item.profileIds.push(defaultId);
      migrated = true;
    }
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
      if (!user) { _cloudProfiles = null; _cloudProfilesLoading = false; }
      _updateAuthUI();
      _renderDeviceIcons();
      _renderCloudProfileSection();
      if (user && _panelOpen) _fetchAndRenderCloudProfiles();
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
  if (!_currentUser || !_firestoreDb) { _showProfileStatus('Sign in to sync.'); return; }
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
  _showProfileStatus('Pushed ' + items.length + ' items to cloud for profile "' + profile.name + '".');
}
async function pullProfile() {
  if (!_currentUser || !_firestoreDb) { _showProfileStatus('Sign in to sync.'); return; }
  await _fetchAndRenderCloudProfiles();
}
async function _fetchAndRenderCloudProfiles() {
  if (!_currentUser || !_firestoreDb) return;
  _cloudProfilesLoading = true;
  _renderCloudProfileSection();
  try {
    var uid  = _currentUser.uid;
    var snap = await _firestoreDb.collection('users').doc(uid).collection('profiles').get();
    _cloudProfiles = [];
    snap.forEach(function(doc) { _cloudProfiles.push({ id: doc.id, data: doc.data() }); });
  } catch(e) {
    _cloudProfiles = [];
  }
  _cloudProfilesLoading = false;
  _renderCloudProfileSection();
}
function _renderCloudProfileSection() {
  var section = document.getElementById('cloud-profile-section');
  var itemsEl = document.getElementById('cloud-profile-items');
  if (!section || !itemsEl) return;
  if (!_currentUser) { section.style.display = 'none'; return; }
  section.style.display = '';
  itemsEl.innerHTML = '';
  if (_cloudProfilesLoading) {
    var loadEl = document.createElement('div');
    loadEl.className = 'cloud-profile-loading';
    loadEl.textContent = 'Loading\u2026';
    itemsEl.appendChild(loadEl);
    return;
  }
  if (!_cloudProfiles || !_cloudProfiles.length) {
    var emptyEl = document.createElement('div');
    emptyEl.className = 'cloud-profile-empty';
    emptyEl.textContent = 'No cloud profiles found.';
    itemsEl.appendChild(emptyEl);
    return;
  }
  _cloudProfiles.forEach(function(cp) {
    var cpName = (cp.data && cp.data.name) ? cp.data.name : cp.id;
    var row    = document.createElement('div');
    row.className = 'cloud-profile-row';
    var nameEl = document.createElement('span');
    nameEl.className   = 'cloud-profile-name';
    nameEl.textContent = cpName;
    var pullBtn = document.createElement('button');
    pullBtn.className   = 'cloud-profile-pull-btn';
    pullBtn.textContent = 'pull';
    pullBtn.addEventListener('click', function() { _doPullProfile(cp.id, cpName, cp.data); });
    if (_cloudDeleteConfirmId === cp.id) {
      var confirmWrap = document.createElement('div');
      confirmWrap.className = 'profile-delete-confirm';
      var confirmInput = document.createElement('input');
      confirmInput.type        = 'text';
      confirmInput.placeholder = 'type "delete profile"';
      confirmInput.className   = 'profile-delete-input';
      var confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.className   = 'profile-delete-confirm-btn';
      confirmBtn.addEventListener('click', function() {
        if ((confirmInput.value || '').trim().toLowerCase() === 'delete profile') {
          _cloudDeleteConfirmId = null;
          _doDeleteCloudProfile(cp.id, cpName);
        } else {
          confirmInput.classList.add('error');
          setTimeout(function() { confirmInput.classList.remove('error'); }, 400);
          confirmInput.focus();
        }
      });
      confirmInput.addEventListener('keydown', function(e) {
        e.stopPropagation();
        if (e.key === 'Enter') confirmBtn.click();
        if (e.key === 'Escape') { _cloudDeleteConfirmId = null; _renderCloudProfileSection(); }
      });
      var cancelConfirmBtn = document.createElement('button');
      cancelConfirmBtn.textContent = 'Cancel';
      cancelConfirmBtn.className   = 'profile-delete-cancel-btn';
      cancelConfirmBtn.addEventListener('click', function() { _cloudDeleteConfirmId = null; _renderCloudProfileSection(); });
      confirmWrap.appendChild(confirmInput);
      confirmWrap.appendChild(confirmBtn);
      confirmWrap.appendChild(cancelConfirmBtn);
      row.appendChild(nameEl);
      row.appendChild(pullBtn);
      row.appendChild(confirmWrap);
      itemsEl.appendChild(row);
      setTimeout(function() { confirmInput.focus(); }, 30);
    } else {
      var delCloudBtn = document.createElement('button');
      delCloudBtn.className   = 'cloud-profile-del-btn';
      delCloudBtn.textContent = '×';
      delCloudBtn.addEventListener('click', function() { _cloudDeleteConfirmId = cp.id; _renderCloudProfileSection(); });
      row.appendChild(nameEl);
      row.appendChild(pullBtn);
      row.appendChild(delCloudBtn);
      itemsEl.appendChild(row);
    }
  });
}
async function _doPullProfile(cloudProfileId, cloudProfileName, cloudProfileData) {
  if (!_currentUser || !_firestoreDb) return;
  var uid  = _currentUser.uid;
  var base = _firestoreDb.collection('users').doc(uid).collection('profiles').doc(cloudProfileId);
  var snap = await base.collection('items').get();
  if (snap.empty) { _showProfileStatus('No items found in cloud for "' + cloudProfileName + '".'); return; }
  // Create a new local profile for these items
  var _cloudDevType = (cloudProfileData && cloudProfileData.deviceType) || 'custom';
  var _typeConflict = (_cloudDevType === 'mobile' || _cloudDevType === 'computer') &&
    _profiles.some(function(p) { return p.deviceType === _cloudDevType; });
  var _useDevType = _typeConflict ? 'custom' : _cloudDevType;
  var newProfile = _makeProfile(cloudProfileName, null, (cloudProfileData && cloudProfileData.color) || '#5c9edb', _useDevType);
  _profiles.push(newProfile);
  await DB.saveProfiles(_profiles);
  _activeIds.add(newProfile.id);
  _visibleIds.add(newProfile.id);
  _savePrefs();
  var pulled = 0;
  snap.forEach(function(doc) {
    var remote = doc.data();
    var local  = State.getItem(_appState, remote.id);
    if (!local) {
      if (!remote.versions)      remote.versions      = [];
      if (!remote.itemUndoStack) remote.itemUndoStack = [];
      if (!remote.itemRedoStack) remote.itemRedoStack = [];
      remote.profileIds = [newProfile.id];
      _appState.items.push(remote);
      pulled++;
    } else {
      // Item already exists locally - just assign it to the new profile too
      if ((local.profileIds || []).indexOf(newProfile.id) === -1) {
        local.profileIds = (local.profileIds || []).concat([newProfile.id]);
      }
    }
  });
  State.saveState(_appState);
  _renderProfilePanel();
  if (_refreshFn) _refreshFn();
  _showProfileStatus('Pulled ' + pulled + ' new item(s) into new profile "' + newProfile.name + '".');
}
async function _doDeleteCloudProfile(cloudProfileId, cloudProfileName) {
  if (!_currentUser || !_firestoreDb) return;
  _showProfileStatus('Deleting\u2026');
  try {
    var uid      = _currentUser.uid;
    var base     = _firestoreDb.collection('users').doc(uid).collection('profiles').doc(cloudProfileId);
    var itemsSnap = await base.collection('items').get();
    var batch    = _firestoreDb.batch();
    itemsSnap.forEach(function(doc) { batch.delete(doc.ref); });
    await batch.commit();
    await base.delete();
    _cloudProfiles = _cloudProfiles.filter(function(cp) { return cp.id !== cloudProfileId; });
    _showProfileStatus('Cloud profile "' + cloudProfileName + '" deleted.');
    _renderCloudProfileSection();
  } catch(e) {
    console.error('Delete cloud profile failed', e);
    _showProfileStatus('Delete failed: ' + e.message);
  }
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
  _profiles = _profiles.filter(function(p) { return p.id !== profileId; });
  await DB.saveProfiles(_profiles);
  var orphanedIds = new Set();
  _appState.items.forEach(function(item) {
    item.profileIds = (item.profileIds || []).filter(function(id) { return id !== profileId; });
    if (!item.profileIds.length) orphanedIds.add(item.id);
  });
  if (orphanedIds.size > 0) {
    var orphanProfile = _profiles.find(function(p) { return p.id === 'p_orphaned'; });
    if (!orphanProfile) {
      orphanProfile = { id: 'p_orphaned', name: 'Orphaned', icon: null, color: '#546370', deviceType: 'custom', createdAt: new Date().toISOString() };
      _profiles.push(orphanProfile);
      await DB.saveProfiles(_profiles);
    }
    orphanedIds.forEach(function(id) {
      var item = State.getItem(_appState, id);
      if (item) item.profileIds = ['p_orphaned'];
    });
    _activeIds.add('p_orphaned');
    _visibleIds.add('p_orphaned');
  }
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
  var _knownProfileIds = new Set(_profiles.map(function(p) { return p.id; }));
  return items.filter(function(item) {
    var pids = item.profileIds || [];
    if (!pids.length) return true; // untagged items always visible (migration safety)
    if (!pids.some(function(id) { return _knownProfileIds.has(id); })) return true; // orphaned items always visible
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
function _toggleDeviceTypeVisibility(deviceType) {
  var matching = _profiles.filter(function(p) { return p.deviceType === deviceType; });
  if (!matching.length) return;
  var anyVisible = matching.some(function(p) { return _visibleIds.has(p.id); });
  matching.forEach(function(p) {
    if (anyVisible) _visibleIds.delete(p.id);
    else            _visibleIds.add(p.id);
  });
  if (!_visibleIds.size && _profiles.length) _visibleIds.add(_profiles[0].id);
  _savePrefs();
  if (_refreshFn) _refreshFn();
}
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
  computerBtn.addEventListener('click', function() { _toggleDeviceTypeVisibility('computer'); });
  wrap.appendChild(computerBtn);
  var mobileBtn = document.createElement('button');
  mobileBtn.className = 'profile-device-btn' + (deviceType === 'mobile' ? ' active' : '');
  mobileBtn.title     = 'Mobile';
  mobileBtn.innerHTML = _mobileSVG();
  mobileBtn.addEventListener('click', function() { _toggleDeviceTypeVisibility('mobile'); });
  wrap.appendChild(mobileBtn);
}
// ===== PROFILE PANEL =====
function openPanel() {
  var panel = document.getElementById('profile-panel');
  if (!panel) return;
  _panelOpen = true;
  panel.classList.remove('hidden');
  _hideProfileStatus();
  _renderProfilePanel();
  if (_currentUser) _fetchAndRenderCloudProfiles();
}
function closePanel() {
  var panel = document.getElementById('profile-panel');
  if (panel) panel.classList.add('hidden');
  _panelOpen       = false;
  _addFormOpen     = false;
  _deleteConfirmId = null;
  _styleEditId     = null;
  _hideProfileStatus();
}
function _renderProfilePanel() {
  if (!_panelOpen) return;
  var listEl = document.getElementById('profile-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  var _visibleProfiles = _profiles.filter(function(p) {
    if (p.id === 'p_orphaned') {
      return _appState.items.some(function(item) { return (item.profileIds || []).indexOf('p_orphaned') !== -1; });
    }
    return true;
  });
  _selectedProfileIds.forEach(function(id) {
    if (!_visibleProfiles.some(function(p) { return p.id === id; })) _selectedProfileIds.delete(id);
  });
  var pCtrlBar       = document.createElement('div');
  pCtrlBar.className = 'version-ctrl-bar profile-ctrl-bar';
  var pSelAllCb      = document.createElement('canvas');
  pSelAllCb.className = 'version-sel-canvas';
  pSelAllCb.width    = 13;
  pSelAllCb.height   = 13;
  pSelAllCb.title    = 'Select all profiles';
  var pBulkShowBtn       = document.createElement('button');
  pBulkShowBtn.className   = 'version-restore-btn';
  pBulkShowBtn.textContent = 'show';
  pBulkShowBtn.disabled    = true;
  var pBulkHideBtn       = document.createElement('button');
  pBulkHideBtn.className   = 'version-del-ver-btn';
  pBulkHideBtn.textContent = 'hide';
  pBulkHideBtn.disabled    = true;
  var pBulkWriteOnBtn       = document.createElement('button');
  pBulkWriteOnBtn.className   = 'version-restore-ver-btn';
  pBulkWriteOnBtn.textContent = 'write +';
  pBulkWriteOnBtn.disabled    = true;
  var pBulkWriteOffBtn       = document.createElement('button');
  pBulkWriteOffBtn.className   = 'version-del-ver-btn';
  pBulkWriteOffBtn.textContent = 'write -';
  pBulkWriteOffBtn.disabled    = true;
  var pBulkDelBtn       = document.createElement('button');
  pBulkDelBtn.className   = 'version-del-ver-btn';
  pBulkDelBtn.textContent = 'delete';
  pBulkDelBtn.disabled    = true;
  function _updateProfileCtrl() {
    var total  = _visibleProfiles.length;
    var selSet = new Set();
    _visibleProfiles.forEach(function(p, vi) {
      if (_selectedProfileIds.has(p.id)) selSet.add(total - 1 - vi);
    });
    Render.drawSelCanvas(pSelAllCb, total, selSet, false);
    var count = _selectedProfileIds.size;
    pBulkShowBtn.disabled     = count === 0;
    pBulkHideBtn.disabled     = count === 0;
    pBulkWriteOnBtn.disabled  = count === 0;
    pBulkWriteOffBtn.disabled = count === 0;
    pBulkDelBtn.disabled      = count === 0;
  }
  pSelAllCb.addEventListener('click', function() {
    var allSel = _visibleProfiles.length > 0 && _visibleProfiles.every(function(p) { return _selectedProfileIds.has(p.id); });
    if (allSel) { _visibleProfiles.forEach(function(p) { _selectedProfileIds.delete(p.id); }); }
    else        { _visibleProfiles.forEach(function(p) { _selectedProfileIds.add(p.id);    }); }
    listEl.querySelectorAll('.profile-row-cb').forEach(function(cb, vi) {
      var p = _visibleProfiles[vi];
      Render.drawSelCanvas(cb, 1, (p && _selectedProfileIds.has(p.id)) ? new Set([0]) : new Set(), false);
    });
    _updateProfileCtrl();
  });
  pBulkShowBtn.addEventListener('click', function() {
    Array.from(_selectedProfileIds).forEach(function(id) { _visibleIds.add(id); });
    _savePrefs();
    if (_refreshFn) _refreshFn();
    _renderProfilePanel();
  });
  pBulkHideBtn.addEventListener('click', function() {
    Array.from(_selectedProfileIds).forEach(function(id) { _visibleIds.delete(id); });
    if (!_visibleIds.size && _profiles.length) _visibleIds.add(_profiles[0].id);
    _savePrefs();
    if (_refreshFn) _refreshFn();
    _renderProfilePanel();
  });
  pBulkWriteOnBtn.addEventListener('click', function() {
    Array.from(_selectedProfileIds).forEach(function(id) { _activeIds.add(id); });
    if (!_activeIds.size && _profiles.length) _activeIds.add(_profiles[0].id);
    _savePrefs();
    _renderProfilePanel();
  });
  pBulkWriteOffBtn.addEventListener('click', function() {
    Array.from(_selectedProfileIds).forEach(function(id) { _activeIds.delete(id); });
    if (!_activeIds.size && _profiles.length) _activeIds.add(_profiles[0].id);
    _savePrefs();
    _renderProfilePanel();
  });
  pBulkDelBtn.addEventListener('click', async function() {
    var ok = await Modals.confirm('Delete ' + _selectedProfileIds.size + ' profile(s)? Type "yes" to confirm.');
    if (!ok) return;
    var toDelete = Array.from(_selectedProfileIds);
    _selectedProfileIds.clear();
    for (var di = 0; di < toDelete.length; di++) { await deleteProfile(toDelete[di]); }
  });
  pCtrlBar.appendChild(pSelAllCb);
  pCtrlBar.appendChild(pBulkShowBtn);
  pCtrlBar.appendChild(pBulkHideBtn);
  pCtrlBar.appendChild(pBulkWriteOnBtn);
  pCtrlBar.appendChild(pBulkWriteOffBtn);
  pCtrlBar.appendChild(pBulkDelBtn);
  listEl.appendChild(pCtrlBar);
  _updateProfileCtrl();
  _visibleProfiles.forEach(function(profile, vi) {
    var isVisible = _visibleIds.has(profile.id);
    var isActive  = _activeIds.has(profile.id);
    var row = document.createElement('div');
    row.className = 'profile-row';
    var iconEl = document.createElement('div');
    iconEl.className   = 'profile-icon-wrap';
    iconEl.innerHTML   = _profileIconHTML(profile, 28);
    iconEl.style.cursor = 'pointer';
    iconEl.title = 'Click to restyle';
    iconEl.addEventListener('click', function() {
      _styleEditId = (_styleEditId === profile.id) ? null : profile.id;
      _deleteConfirmId = null;
      _renderProfilePanel();
    });
    var rowCb       = document.createElement('canvas');
    rowCb.className = 'version-sel-canvas profile-row-cb';
    rowCb.width     = 13;
    rowCb.height    = 13;
    rowCb.title     = 'Select';
    (function(pId, canvas) {
      Render.drawSelCanvas(canvas, 1, _selectedProfileIds.has(pId) ? new Set([0]) : new Set(), false);
      canvas.addEventListener('click', function() {
        if (_selectedProfileIds.has(pId)) _selectedProfileIds.delete(pId);
        else _selectedProfileIds.add(pId);
        Render.drawSelCanvas(canvas, 1, _selectedProfileIds.has(pId) ? new Set([0]) : new Set(), false);
        _updateProfileCtrl();
      });
    })(profile.id, rowCb);
    row.appendChild(rowCb);
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
      pushBtn.innerHTML = _cloudUpSVG();
      pushBtn.addEventListener('click', function() { syncProfile(profile.id); });
      row.appendChild(pushBtn);
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
    if (_styleEditId === profile.id) {
      var styleWrap = document.createElement('div');
      styleWrap.className = 'profile-style-edit';
      var styleIconInput = document.createElement('input');
      styleIconInput.type = 'text';
      styleIconInput.placeholder = 'Icon: SVG, URL, or emoji';
      styleIconInput.value = profile.icon || '';
      styleIconInput.className = 'profile-style-icon-input';
      var styleColorInput = document.createElement('input');
      styleColorInput.type = 'color';
      styleColorInput.value = profile.color || '#5c9edb';
      styleColorInput.className = 'profile-style-color-input';
      var styleApplyBtn = document.createElement('button');
      styleApplyBtn.textContent = 'Apply';
      styleApplyBtn.className = 'profile-style-apply-btn';
      styleApplyBtn.addEventListener('click', function() {
        updateProfile(profile.id, { icon: (styleIconInput.value || '').trim() || null, color: styleColorInput.value });
        _styleEditId = null;
        _renderProfilePanel();
      });
      var styleCloseBtn = document.createElement('button');
      styleCloseBtn.textContent = 'Close';
      styleCloseBtn.className = 'profile-style-close-btn';
      styleCloseBtn.addEventListener('click', function() { _styleEditId = null; _renderProfilePanel(); });
      styleIconInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') styleApplyBtn.click(); });
      styleWrap.appendChild(styleIconInput);
      styleWrap.appendChild(styleColorInput);
      styleWrap.appendChild(styleApplyBtn);
      styleWrap.appendChild(styleCloseBtn);
      row.appendChild(styleWrap);
    }
    listEl.appendChild(row);
  });
  var addBtn  = document.getElementById('btn-add-profile');
  var addForm = document.getElementById('add-profile-form');
  if (addBtn)  addBtn.style.display  = _addFormOpen ? 'none' : '';
  if (addForm) addForm.style.display = _addFormOpen ? ''     : 'none';
  var pullCloudBtn = document.getElementById('btn-pull-cloud');
  if (pullCloudBtn) pullCloudBtn.style.display = _currentUser ? '' : 'none';
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
  _renderCloudProfileSection();
}
function _wirePanel() {
  // Stop all keydowns inside the panel from reaching global handlers
  var box = document.querySelector('.profile-panel-box');
  if (box) box.addEventListener('keydown', function(e) { e.stopPropagation(); });
  var statusEl = document.getElementById('profile-status-msg');
  if (statusEl) statusEl.addEventListener('click', _hideProfileStatus);
  var overlay = document.getElementById('profile-panel');
  if (overlay) overlay.addEventListener('click', function(e) { if (e.target === overlay) closePanel(); });
  var closeBtn = document.getElementById('profile-panel-close');
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  var openBtn = document.getElementById('btn-profiles');
  if (openBtn) openBtn.addEventListener('click', openPanel);
  var pullCloudBtn = document.getElementById('btn-pull-cloud');
  if (pullCloudBtn) {
    pullCloudBtn.innerHTML = _cloudDownSVG();
    pullCloudBtn.addEventListener('click', function() { pullProfile(); });
  }
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
function _cloudUpSVG() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.5 11.5a2.5 2.5 0 01-.5-4.95A3.5 3.5 0 0111 5.05 2.75 2.75 0 0112.5 11.5h-8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M8 11.5V7M6 9l2-2 2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function _cloudDownSVG() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.5 11.5a2.5 2.5 0 01-.5-4.95A3.5 3.5 0 0111 5.05 2.75 2.75 0 0112.5 11.5h-8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M8 7v4.5M6 9.5l2 2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
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

