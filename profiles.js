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
var _bulkDeleteConfirmOpen = false;
var _selectedCloudIds      = new Set();
var _cloudBulkDeleteConfirmOpen = false;
var _cloudStyleEditId           = null;
var _syncEnabled   = {};      // profileId → boolean
var _pullQueue        = [];   // [{cloudProfileId, cloudProfileName, cloudProfileData}]
var _pullQueueActive  = false;
var _pullQueueCancelled = false;
var _syncTimers    = {};      // profileId → debounce timer id
var _syncStatus    = {};      // profileId → 'synced' | 'unsynced' | 'never'
var _syncListeners = {};      // profileId → unsubscribe function
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
      devType === 'mobile' ? _mobileSVG() : _computerSVG(),
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
  var _iconMigrated = false;
  _profiles.forEach(function(p) {
    if (!p.icon) {
      if (p.deviceType === 'mobile')        { p.icon = _mobileSVG();   _iconMigrated = true; }
      else if (p.deviceType === 'computer') { p.icon = _computerSVG(); _iconMigrated = true; }
    }
  });
  if (_iconMigrated) await DB.saveProfiles(_profiles);
  _panelOpen = false;
  _loadPrefs();
  var _wasPanelOpen = _panelOpen;
  _panelOpen = false;
  _initFirebase();
  _wirePanel();
  _updateAuthUI();
  _renderDeviceIcons();
  if (_refreshFn) _refreshFn();
  if (_wasPanelOpen) openPanel();
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
    _activeIds   = new Set(active.length  ? active  : [_profiles[0].id]);
    _visibleIds  = new Set(visible.length ? visible : [_profiles[0].id]);
    _panelOpen   = !!p.panelOpen;
    _syncEnabled = p.syncEnabled || {};
    _syncStatus  = p.syncStatus  || {};
  } catch(e) { _resetToDefaults(); }
}
function _syncSVG(color) {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 7A5 5 0 0 1 12 7" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M12 7A5 5 0 0 1 2 7" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M10.5 4.5L12 7l2-1.5" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3.5 9.5L2 7 0 8.5" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function _cloudDownSyncSVG() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.5 11.5a2.5 2.5 0 01-.5-4.95A3.5 3.5 0 0111 5.05 2.75 2.75 0 0112.5 11.5h-8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M8 7v4.5M6 9.5l2 2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function _savePrefs() {
  try {
    localStorage.setItem('sc_profile_prefs', JSON.stringify({
      activeIds:  Array.from(_activeIds),
      visibleIds: Array.from(_visibleIds),
      panelOpen:  _panelOpen,
      syncEnabled: _syncEnabled,
      syncStatus:  _syncStatus
    }));
  } catch(e) {}
}
function _resetToDefaults() {
  var id = _profiles.length ? _profiles[0].id : null;
  _activeIds  = id ? new Set([id]) : new Set();
  _visibleIds = id ? new Set([id]) : new Set();
}
// ===== FIREBASE USAGE TRACKING =====
function _getTodayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _trackUsage(reads, writes, deletes) {
  if (!_firestoreDb || (!reads && !writes && !deletes)) return;
  var ref = _firestoreDb.collection('_usage').doc(_getTodayKey());
  var inc = firebase.firestore.FieldValue.increment;
  var upd = {};
  if (reads)   upd.reads   = inc(reads);
  if (writes)  upd.writes  = inc(writes);
  if (deletes) upd.deletes = inc(deletes);
  ref.set(upd, { merge: true }).catch(function(e) { console.warn('_trackUsage failed', e); });
}
async function fetchDailyUsage() {
  if (!_firestoreDb) return null;
  try {
    var snap = await _firestoreDb.collection('_usage').doc(_getTodayKey()).get();
    if (!snap.exists) return { reads: 0, writes: 0, deletes: 0 };
    var d = snap.data();
    return { reads: d.reads || 0, writes: d.writes || 0, deletes: d.deletes || 0 };
  } catch(e) {
    console.warn('fetchDailyUsage failed', e);
    return null;
  }
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
      if (!user) {
        _cloudProfiles = null;
        _cloudProfilesLoading = false;
        Object.keys(_syncListeners).forEach(function(pid) { _stopSyncListener(pid); });
      } else {
        _profiles.forEach(function(p) { if (_syncEnabled[p.id]) _startSyncListener(p.id); });
      }
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
async function _checkSyncStatus(profileId) {
  if (!_currentUser || !_firestoreDb) return;
  var profile = _profiles.find(function(p) { return p.id === profileId; });
  if (!profile) return;
  var uid  = _currentUser.uid;
  var base = _firestoreDb.collection('users').doc(uid).collection('profiles').doc(profileId);
  try {
    var snap = await base.collection('items').get();
    var cloudItems = {};
    snap.forEach(function(doc) { cloudItems[doc.id] = doc.data(); });
    _trackUsage(Math.max(1, snap.size), 0, 0);
    var localItems = _appState.items.filter(function(i) { return (i.profileIds || []).indexOf(profileId) !== -1; });
    var inSync = true;
    if (localItems.length !== Object.keys(cloudItems).length) {
      inSync = false;
    } else {
      for (var i = 0; i < localItems.length; i++) {
        var li = localItems[i];
        var ci = cloudItems[li.id];
        if (!ci || ci.modifiedAt !== li.modifiedAt || ci.text !== li.text || ci.title !== li.title) {
          inSync = false;
          break;
        }
      }
    }
    _syncStatus[profileId] = inSync ? 'synced' : 'unsynced';
    if (!inSync && _syncEnabled[profileId]) _triggerAutoSync(profileId);
  } catch(e) {
    console.warn('_checkSyncStatus failed', e);
  }
  _savePrefs();
  if (_panelOpen) _renderProfilePanel();
}
function _triggerAutoSync(profileId) {
  if (!_syncEnabled[profileId]) return;
  if (!_currentUser || !_firestoreDb) return;
  clearTimeout(_syncTimers[profileId]);
  _syncStatus[profileId] = 'unsynced';
  if (_panelOpen) _renderProfilePanel();
  _syncTimers[profileId] = setTimeout(async function() {
    await syncProfile(profileId);
    _syncStatus[profileId] = 'synced';
    _savePrefs();
    if (_panelOpen) _renderProfilePanel();
    var _autoProf = _profiles.find(function(p) { return p.id === profileId; });
    _showProfileStatus('Auto-sync complete for "' + (_autoProf ? _autoProf.name : profileId) + '".');
  }, 10 * 1000);
}
function _startSyncListener(profileId) {
  if (_syncListeners[profileId]) return;
  if (!_currentUser || !_firestoreDb) return;
  var uid  = _currentUser.uid;
  var base = _firestoreDb.collection('users').doc(uid).collection('profiles').doc(profileId);
  var unsub = base.collection('items').onSnapshot(function(snapshot) {
    _onSyncSnapshot(profileId, snapshot);
  }, function(err) {
    console.warn('Sync listener error for ' + profileId, err);
  });
  _syncListeners[profileId] = unsub;
}
function _stopSyncListener(profileId) {
  if (_syncListeners[profileId]) {
    _syncListeners[profileId]();
    delete _syncListeners[profileId];
  }
}
function _onSyncSnapshot(profileId, snapshot) {
  if (!_currentUser) return;
  var profile = _profiles.find(function(p) { return p.id === profileId; });
  if (!profile) return;
  var changed = false;
  snapshot.docChanges().forEach(function(change) {
    if (change.type === 'removed') return;
    var remote = change.doc.data();
    var local  = State.getItem(_appState, remote.id);
    if (!local) {
      if (!remote.versions)      remote.versions      = [];
      if (!remote.itemUndoStack) remote.itemUndoStack = [];
      if (!remote.itemRedoStack) remote.itemRedoStack = [];
      if ((remote.profileIds || []).indexOf(profileId) === -1) {
        remote.profileIds = (remote.profileIds || []).concat([profileId]);
      }
      _appState.items.push(remote);
      changed = true;
    } else if (remote.modifiedAt > (local.modifiedAt || '')) {
      var localSnap = {
        ts:         local.modifiedAt,
        text:       local.text,
        html:       local.html,
        title:      local.title,
        tags:       (local.tags || []).slice(),
        name:       local.versionName || '',
        deleted:    local.deleted || false,
        profileIds: (local.profileIds || []).slice()
      };
      State.addItemVersion(local, localSnap);
      (remote.versions || []).forEach(function(rv) {
        State.addItemVersion(local, rv);
      });
      var preserved = { itemUndoStack: local.itemUndoStack || [], itemRedoStack: local.itemRedoStack || [] };
      Object.assign(local, remote, preserved);
      if ((local.profileIds || []).indexOf(profileId) === -1) {
        local.profileIds = (local.profileIds || []).concat([profileId]);
      }
      changed = true;
    } else if (remote.modifiedAt === (local.modifiedAt || '') &&
               (remote.text !== local.text || remote.html !== local.html || remote.title !== local.title)) {
      State.addItemVersion(local, {
        ts:         remote.modifiedAt,
        text:       remote.text,
        html:       remote.html,
        title:      remote.title,
        tags:       (remote.tags || []).slice(),
        name:       remote.versionName || '',
        deleted:    remote.deleted || false,
        profileIds: (remote.profileIds || []).slice()
      });
      changed = true;
    }
  });
  if (changed) {
    State.saveState(_appState);
    if (_refreshFn) _refreshFn();
  }
}
function notifyItemChanged() {
  _profiles.forEach(function(profile) {
    if (_syncEnabled[profile.id]) _triggerAutoSync(profile.id);
  });
}
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
  _trackUsage(0, items.length + 1, 0);
  _syncStatus[profileId] = 'synced';
  _savePrefs();
  if (_panelOpen) _renderProfilePanel();
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
    _trackUsage(Math.max(1, _cloudProfiles.length), 0, 0);
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
  _selectedCloudIds.forEach(function(id) {
    if (!_cloudProfiles.some(function(cp) { return cp.id === id; })) _selectedCloudIds.delete(id);
  });
  var cCtrlBar = document.createElement('div');
  cCtrlBar.className = 'version-ctrl-bar profile-ctrl-bar';
  var cSelAllCb = document.createElement('canvas');
  cSelAllCb.className = 'version-sel-canvas';
  cSelAllCb.width = 13;
  cSelAllCb.height = 13;
  cSelAllCb.title = 'Select all cloud profiles';
  var cBulkPullBtn = document.createElement('button');
  cBulkPullBtn.className = 'version-restore-ver-btn';
  cBulkPullBtn.textContent = 'pull';
  cBulkPullBtn.disabled = true;
  var cBulkDelBtn = document.createElement('button');
  cBulkDelBtn.className = 'version-del-ver-btn';
  cBulkDelBtn.textContent = 'delete';
  cBulkDelBtn.disabled = true;
  function _updateCloudCtrl() {
    var total = _cloudProfiles.length;
    var selSet = new Set();
    _cloudProfiles.forEach(function(cp, vi) {
      if (_selectedCloudIds.has(cp.id)) selSet.add(total - 1 - vi);
    });
    Render.drawSelCanvas(cSelAllCb, total, selSet, false);
    var count = _selectedCloudIds.size;
    cBulkPullBtn.disabled = count === 0;
    cBulkDelBtn.disabled  = count === 0;
    if (count === 0) _cloudBulkDeleteConfirmOpen = false;
  }
  cSelAllCb.addEventListener('click', function() {
    var allSel = _cloudProfiles.length > 0 && _cloudProfiles.every(function(cp) { return _selectedCloudIds.has(cp.id); });
    if (allSel) { _cloudProfiles.forEach(function(cp) { _selectedCloudIds.delete(cp.id); }); }
    else        { _cloudProfiles.forEach(function(cp) { _selectedCloudIds.add(cp.id);    }); }
    itemsEl.querySelectorAll('.cloud-profile-row-cb').forEach(function(cb, vi) {
      var cp = _cloudProfiles[vi];
      Render.drawSelCanvas(cb, 1, (cp && _selectedCloudIds.has(cp.id)) ? new Set([0]) : new Set(), false);
    });
    _updateCloudCtrl();
  });
  cBulkPullBtn.addEventListener('click', function() {
    var toPull = _cloudProfiles.filter(function(cp) { return _selectedCloudIds.has(cp.id); });
    var queue  = toPull.map(function(cp) {
      return { cloudProfileId: cp.id, cloudProfileName: (cp.data && cp.data.name) ? cp.data.name : cp.id, cloudProfileData: cp.data };
    });
    _selectedCloudIds.clear();
    _renderCloudProfileSection();
    _enqueuePull(queue);
  });
  cBulkDelBtn.addEventListener('click', function() {
    _cloudBulkDeleteConfirmOpen = true;
    _renderCloudProfileSection();
  });
  cCtrlBar.appendChild(cSelAllCb);
  cCtrlBar.appendChild(cBulkPullBtn);
  cCtrlBar.appendChild(cBulkDelBtn);
  itemsEl.appendChild(cCtrlBar);
  _updateCloudCtrl();
  if (_cloudBulkDeleteConfirmOpen && _selectedCloudIds.size > 0) {
    var cBulkConfirmWrap = document.createElement('div');
    cBulkConfirmWrap.className = 'profile-delete-confirm';
    var cBulkConfirmInput = document.createElement('input');
    cBulkConfirmInput.type        = 'text';
    cBulkConfirmInput.placeholder = 'type "del profiles"';
    cBulkConfirmInput.className   = 'profile-delete-input';
    var cBulkConfirmBtn = document.createElement('button');
    cBulkConfirmBtn.textContent = 'Confirm';
    cBulkConfirmBtn.className   = 'profile-delete-confirm-btn';
    cBulkConfirmBtn.addEventListener('click', async function() {
      if ((cBulkConfirmInput.value || '').trim().toLowerCase() === 'del profiles') {
        var toDelete = _cloudProfiles.filter(function(cp) { return _selectedCloudIds.has(cp.id); });
        _selectedCloudIds.clear();
        _cloudBulkDeleteConfirmOpen = false;
        for (var di = 0; di < toDelete.length; di++) {
          var cpD = toDelete[di];
          var cpDName = (cpD.data && cpD.data.name) ? cpD.data.name : cpD.id;
          await _doDeleteCloudProfile(cpD.id, cpDName);
        }
      } else {
        cBulkConfirmInput.classList.add('error');
        setTimeout(function() { cBulkConfirmInput.classList.remove('error'); }, 400);
        cBulkConfirmInput.focus();
      }
    });
    cBulkConfirmInput.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter') cBulkConfirmBtn.click();
      if (e.key === 'Escape') { _cloudBulkDeleteConfirmOpen = false; _renderCloudProfileSection(); }
    });
    var cBulkCancelBtn = document.createElement('button');
    cBulkCancelBtn.textContent = 'Cancel';
    cBulkCancelBtn.className   = 'profile-delete-cancel-btn';
    cBulkCancelBtn.addEventListener('click', function() { _cloudBulkDeleteConfirmOpen = false; _renderCloudProfileSection(); });
    cBulkConfirmWrap.appendChild(cBulkConfirmInput);
    cBulkConfirmWrap.appendChild(cBulkConfirmBtn);
    cBulkConfirmWrap.appendChild(cBulkCancelBtn);
    itemsEl.appendChild(cBulkConfirmWrap);
    setTimeout(function() { cBulkConfirmInput.focus(); }, 30);
  }
  _cloudProfiles.forEach(function(cp) {
    var cpName = (cp.data && cp.data.name) ? cp.data.name : cp.id;
    var row    = document.createElement('div');
    row.className = 'cloud-profile-row';
    var rowCb = document.createElement('canvas');
    rowCb.className = 'version-sel-canvas cloud-profile-row-cb';
    rowCb.width  = 13;
    rowCb.height = 13;
    rowCb.title  = 'Select';
    (function(cpId, canvas) {
      Render.drawSelCanvas(canvas, 1, _selectedCloudIds.has(cpId) ? new Set([0]) : new Set(), false);
      canvas.addEventListener('click', function() {
        if (_selectedCloudIds.has(cpId)) _selectedCloudIds.delete(cpId);
        else _selectedCloudIds.add(cpId);
        Render.drawSelCanvas(canvas, 1, _selectedCloudIds.has(cpId) ? new Set([0]) : new Set(), false);
        _updateCloudCtrl();
      });
    })(cp.id, rowCb);
    row.appendChild(rowCb);
    var cpIconEl       = document.createElement('div');
    cpIconEl.className = 'profile-icon-wrap';
    cpIconEl.style.cursor = 'pointer';
    cpIconEl.title    = 'Click to restyle';
    cpIconEl.innerHTML = _profileIconHTML(
        { name: cpName, icon: (cp.data && cp.data.icon) || null, color: (cp.data && cp.data.color) || '#5c9edb' },
        window._dbgSzPanel !== undefined ? window._dbgSzPanel : 28
    );
    (function(cpId) {
      cpIconEl.addEventListener('click', function() {
        _cloudStyleEditId     = (_cloudStyleEditId === cpId) ? null : cpId;
        _cloudDeleteConfirmId = null;
        _renderCloudProfileSection();
      });
    })(cp.id);
    row.appendChild(cpIconEl);
    var nameEl = document.createElement('span');
    nameEl.className   = 'cloud-profile-name';
    nameEl.textContent = cpName;
    var idEl = document.createElement('span');
    idEl.className   = 'profile-id-display';
    idEl.textContent = cp.id;
    var cloudNameIdWrap = document.createElement('div');
    cloudNameIdWrap.className = 'profile-name-id-wrap';
    cloudNameIdWrap.appendChild(nameEl);
    cloudNameIdWrap.appendChild(idEl);
    var pullBtn = document.createElement('button');
    pullBtn.className   = 'cloud-profile-pull-btn';
    pullBtn.innerHTML   = _cloudDownSyncSVG();
    pullBtn.title       = 'Pull from cloud';
    pullBtn.addEventListener('click', function() { _doPullProfile(cp.id, cpName, cp.data); });
    if (_cloudDeleteConfirmId === cp.id) {
      var confirmWrap = document.createElement('div');
      confirmWrap.className = 'profile-delete-confirm';
      var confirmInput = document.createElement('input');
      confirmInput.type        = 'text';
      confirmInput.placeholder = 'type "del profile"';
      confirmInput.className   = 'profile-delete-input';
      var confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.className   = 'profile-delete-confirm-btn';
      confirmBtn.addEventListener('click', function() {
        if ((confirmInput.value || '').trim().toLowerCase() === 'del profile') {
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
      row.appendChild(cloudNameIdWrap);
      row.appendChild(pullBtn);
      row.appendChild(confirmWrap);
      itemsEl.appendChild(row);
      setTimeout(function() { confirmInput.focus(); }, 30);
    } else {
      var delCloudBtn = document.createElement('button');
      delCloudBtn.className   = 'cloud-profile-del-btn';
      delCloudBtn.textContent = '×';
      delCloudBtn.addEventListener('click', function() { _cloudDeleteConfirmId = cp.id; _cloudStyleEditId = null; _renderCloudProfileSection(); });
      row.appendChild(cloudNameIdWrap);
      row.appendChild(pullBtn);
      row.appendChild(delCloudBtn);
      itemsEl.appendChild(row);
    }
    if (_cloudStyleEditId === cp.id && _cloudDeleteConfirmId !== cp.id) {
      var styleWrap             = document.createElement('div');
      styleWrap.className       = 'profile-style-edit';
      var styleIconInput        = document.createElement('input');
      styleIconInput.type        = 'text';
      styleIconInput.placeholder = 'Icon: SVG, URL, or emoji';
      styleIconInput.value       = (cp.data && cp.data.icon) || '';
      styleIconInput.className   = 'profile-style-icon-input';
      var styleColorInput       = document.createElement('input');
      styleColorInput.type      = 'color';
      styleColorInput.value     = (cp.data && cp.data.color) || '#5c9edb';
      styleColorInput.className = 'profile-style-color-input';
      var styleApplyBtn         = document.createElement('button');
      styleApplyBtn.textContent  = 'Apply';
      styleApplyBtn.className    = 'profile-style-apply-btn';
      var styleCloseBtn         = document.createElement('button');
      styleCloseBtn.textContent  = 'Close';
      styleCloseBtn.className    = 'profile-style-close-btn';
      styleApplyBtn.addEventListener('click', async function() {
        var newIcon  = (styleIconInput.value || '').trim() || null;
        var newColor = styleColorInput.value;
        if (!cp.data) cp.data = {};
        cp.data.icon  = newIcon;
        cp.data.color = newColor;
        if (_currentUser && _firestoreDb) {
          try {
            await _firestoreDb.collection('users').doc(_currentUser.uid).collection('profiles').doc(cp.id).set(
              { icon: newIcon, color: newColor }, { merge: true }
            );
          } catch(e) { console.warn('cloud style save failed', e); }
        }
        _cloudStyleEditId = null;
        _renderCloudProfileSection();
      });
      styleCloseBtn.addEventListener('click', function() { _cloudStyleEditId = null; _renderCloudProfileSection(); });
      styleIconInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') styleApplyBtn.click(); });
      styleWrap.appendChild(styleIconInput);
      [{ title: 'Mobile', svg: _mobileSVG() }, { title: 'Laptop', svg: _laptopSVG() }, { title: 'PC', svg: _computerSVG() }].forEach(function(def) {
        var pickBtn       = document.createElement('button');
        pickBtn.type      = 'button';
        pickBtn.className = 'profile-icon-pick-btn';
        pickBtn.title     = def.title;
        pickBtn.innerHTML = def.svg;
        pickBtn.addEventListener('click', function() { styleIconInput.value = def.svg; });
        styleWrap.appendChild(pickBtn);
      });
      styleWrap.appendChild(styleColorInput);
      styleWrap.appendChild(styleApplyBtn);
      styleWrap.appendChild(styleCloseBtn);
      row.appendChild(styleWrap);
      setTimeout(function() { styleIconInput.focus(); }, 30);
    }
  });
}
function _enqueuePull(profiles) {
  _pullQueue = _pullQueue.concat(profiles);
  if (!_pullQueueActive) _processNextPull();
}
async function _processNextPull() {
  if (!_pullQueue.length) {
    _pullQueueActive    = false;
    _pullQueueCancelled = false;
    _renderPullConflictUI(null);
    return;
  }
  _pullQueueActive = true;
  var next = _pullQueue.shift();
  if (_pullQueueCancelled) { _processNextPull(); return; }
  var existingLocal = _profiles.find(function(p) { return p.id === next.cloudProfileId; });
  var deviceType    = (next.cloudProfileData && next.cloudProfileData.deviceType) || 'custom';
  var typeConflict  = (deviceType === 'mobile' || deviceType === 'computer') &&
    _profiles.some(function(p) { return p.deviceType === deviceType && p.id !== next.cloudProfileId; });
  _renderPullConflictUI({
    cloudProfileId:   next.cloudProfileId,
    cloudProfileName: next.cloudProfileName,
    cloudProfileData: next.cloudProfileData,
    existingLocal:    existingLocal,
    typeConflict:     typeConflict,
    deviceType:       deviceType
  });
}
function _renderPullConflictUI(ctx) {
  var container = document.getElementById('pull-conflict-container');
  if (!container) return;
  container.innerHTML = '';
  if (!ctx) return;
  var box = document.createElement('div');
  box.className = 'pull-conflict-box';
  var header = document.createElement('div');
  header.className   = 'pull-conflict-header';
  header.textContent = 'Pulling: ' + ctx.cloudProfileName + ' (' + ctx.cloudProfileId + ')';
  box.appendChild(header);
  var remaining = _pullQueue.length;
  if (remaining > 0) {
    var queueNote = document.createElement('div');
    queueNote.className   = 'pull-conflict-queue-note';
    queueNote.textContent = remaining + ' more profile' + (remaining > 1 ? 's' : '') + ' queued after this.';
    box.appendChild(queueNote);
  }
  var desc = document.createElement('div');
  desc.className = 'pull-conflict-desc';
  if (ctx.existingLocal) {
    desc.textContent = 'A local profile with this ID already exists ("' + ctx.existingLocal.name + '"). How do you want to handle this?';
  } else if (ctx.typeConflict) {
    desc.textContent = 'No local profile with this ID exists, but you already have a local "' + ctx.deviceType + '" profile. How do you want to handle the device type?';
  } else {
    desc.textContent = 'No local profile with this ID exists. A new local profile will be created using the cloud data.';
  }
  box.appendChild(desc);
  var _editFields = null;
  function _makeEditFields(prefilledData) {
    var wrap = document.createElement('div');
    wrap.className = 'pull-conflict-edit-fields';
    var nameInp = document.createElement('input');
    nameInp.type        = 'text';
    nameInp.className   = 'pull-conflict-field';
    nameInp.placeholder = 'Profile name...';
    nameInp.value       = (prefilledData && prefilledData.name)  || ctx.cloudProfileName || '';
    var iconInp = document.createElement('input');
    iconInp.type        = 'text';
    iconInp.className   = 'pull-conflict-field';
    iconInp.placeholder = 'Icon: SVG string, URL, or emoji (optional)...';
    iconInp.value       = (prefilledData && prefilledData.icon)  || (ctx.cloudProfileData && ctx.cloudProfileData.icon) || '';
    var colorInp = document.createElement('input');
    colorInp.type  = 'color';
    colorInp.value = (prefilledData && prefilledData.color) || (ctx.cloudProfileData && ctx.cloudProfileData.color) || '#5c9edb';
    var dtSel = document.createElement('select');
    dtSel.className = 'pull-conflict-field';
    ['mobile', 'computer', 'custom'].forEach(function(opt) {
      var o = document.createElement('option');
      o.value       = opt;
      o.textContent = opt;
      if (opt === ((prefilledData && prefilledData.deviceType) || ctx.deviceType || 'custom')) o.selected = true;
      dtSel.appendChild(o);
    });
    var colorRow = document.createElement('div');
    colorRow.className = 'pull-conflict-color-row';
    var colorLabel = document.createElement('span');
    colorLabel.textContent = 'Colour:';
    colorLabel.className   = 'pull-conflict-color-label';
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(colorInp);
    wrap.appendChild(nameInp);
    wrap.appendChild(iconInp);
    wrap.appendChild(colorRow);
    wrap.appendChild(dtSel);
    _editFields = { nameInp: nameInp, iconInp: iconInp, colorInp: colorInp, dtSel: dtSel };
    return wrap;
  }
  function _getEditedMeta() {
    if (!_editFields) return null;
    return {
      name:       (_editFields.nameInp.value  || '').trim() || ctx.cloudProfileName,
      icon:       (_editFields.iconInp.value  || '').trim() || null,
      color:      _editFields.colorInp.value  || '#5c9edb',
      deviceType: _editFields.dtSel.value     || 'custom'
    };
  }
  var btnRow = document.createElement('div');
  btnRow.className = 'pull-conflict-btn-row';
  function _skipBtn(label) {
    var b = document.createElement('button');
    b.className   = 'pull-conflict-btn pull-conflict-btn-skip';
    b.textContent = label;
    b.addEventListener('click', function() { _processNextPull(); });
    return b;
  }
  function _cancelAllBtn() {
    var b = document.createElement('button');
    b.className   = 'pull-conflict-btn pull-conflict-btn-cancel';
    b.textContent = 'Cancel all remaining';
    b.addEventListener('click', function() {
      _pullQueueCancelled = true;
      _pullQueue          = [];
      _renderPullConflictUI(null);
      _pullQueueActive    = false;
    });
    return b;
  }
  if (ctx.existingLocal) {
    var mergeItemsOnlyBtn = document.createElement('button');
    mergeItemsOnlyBtn.className   = 'pull-conflict-btn pull-conflict-btn-primary';
    mergeItemsOnlyBtn.textContent = 'Merge items only (keep local name and style)';
    mergeItemsOnlyBtn.addEventListener('click', async function() {
      await _executePull(ctx.cloudProfileId, ctx.cloudProfileName, ctx.cloudProfileData, ctx.existingLocal, null);
      _processNextPull();
    });
    var mergeAndUpdateWrap = document.createElement('div');
    mergeAndUpdateWrap.className = 'pull-conflict-expand-wrap';
    var mergeAndUpdateBtn = document.createElement('button');
    mergeAndUpdateBtn.className   = 'pull-conflict-btn pull-conflict-btn-secondary';
    mergeAndUpdateBtn.textContent = 'Merge items and update name / style from cloud (click to expand)';
    var editFieldsContainer = document.createElement('div');
    editFieldsContainer.style.display = 'none';
    var fieldsEl = _makeEditFields(ctx.cloudProfileData);
    editFieldsContainer.appendChild(fieldsEl);
    var confirmUpdateBtn = document.createElement('button');
    confirmUpdateBtn.className   = 'pull-conflict-btn pull-conflict-btn-primary';
    confirmUpdateBtn.textContent = 'Confirm merge and update style';
    confirmUpdateBtn.addEventListener('click', async function() {
      var meta = _getEditedMeta();
      await _executePull(ctx.cloudProfileId, ctx.cloudProfileName, ctx.cloudProfileData, ctx.existingLocal, meta);
      _processNextPull();
    });
    editFieldsContainer.appendChild(confirmUpdateBtn);
    mergeAndUpdateBtn.addEventListener('click', function() {
      editFieldsContainer.style.display = editFieldsContainer.style.display === 'none' ? '' : 'none';
    });
    mergeAndUpdateWrap.appendChild(mergeAndUpdateBtn);
    mergeAndUpdateWrap.appendChild(editFieldsContainer);
    btnRow.appendChild(mergeItemsOnlyBtn);
    btnRow.appendChild(mergeAndUpdateWrap);
    btnRow.appendChild(_skipBtn('Skip this profile'));
    if (_pullQueue.length > 0) btnRow.appendChild(_cancelAllBtn());
  } else if (ctx.typeConflict) {
    var asCustomBtn = document.createElement('button');
    asCustomBtn.className   = 'pull-conflict-btn pull-conflict-btn-primary';
    asCustomBtn.textContent = 'Create as "custom" device type (avoids having two "' + ctx.deviceType + '" profiles)';
    asCustomBtn.addEventListener('click', async function() {
      var data = Object.assign({}, ctx.cloudProfileData, { deviceType: 'custom' });
      await _executePull(ctx.cloudProfileId, ctx.cloudProfileName, data, null, null);
      _processNextPull();
    });
    var asOriginalBtn = document.createElement('button');
    asOriginalBtn.className   = 'pull-conflict-btn pull-conflict-btn-secondary';
    asOriginalBtn.textContent = 'Create as "' + ctx.deviceType + '" anyway (you will have two "' + ctx.deviceType + '" profiles)';
    asOriginalBtn.addEventListener('click', async function() {
      await _executePull(ctx.cloudProfileId, ctx.cloudProfileName, ctx.cloudProfileData, null, null);
      _processNextPull();
    });
    btnRow.appendChild(asCustomBtn);
    btnRow.appendChild(asOriginalBtn);
    btnRow.appendChild(_skipBtn('Skip this profile'));
    if (_pullQueue.length > 0) btnRow.appendChild(_cancelAllBtn());
  } else {
    var createBtn = document.createElement('button');
    createBtn.className   = 'pull-conflict-btn pull-conflict-btn-primary';
    createBtn.textContent = 'Create local profile and pull items';
    createBtn.addEventListener('click', async function() {
      await _executePull(ctx.cloudProfileId, ctx.cloudProfileName, ctx.cloudProfileData, null, null);
      _processNextPull();
    });
    btnRow.appendChild(createBtn);
    btnRow.appendChild(_skipBtn('Skip this profile'));
    if (_pullQueue.length > 0) btnRow.appendChild(_cancelAllBtn());
  }
  box.appendChild(btnRow);
  container.appendChild(box);
}
async function _executePull(cloudProfileId, cloudProfileName, cloudProfileData, existingLocal, metaOverride) {
  if (!_currentUser || !_firestoreDb) { _showProfileStatus('Sign in to sync.'); return; }
  var uid  = _currentUser.uid;
  var base = _firestoreDb.collection('users').doc(uid).collection('profiles').doc(cloudProfileId);
  var snap = await base.collection('items').get();
  if (snap.empty) { _showProfileStatus('No items found in cloud for "' + cloudProfileName + '".'); return; }
  _trackUsage(Math.max(1, snap.size), 0, 0);
  var targetProfile;
  if (existingLocal) {
    targetProfile = existingLocal;
    if (metaOverride) {
      targetProfile.name       = metaOverride.name       || targetProfile.name;
      targetProfile.icon       = metaOverride.icon       !== undefined ? metaOverride.icon : targetProfile.icon;
      targetProfile.color      = metaOverride.color      || targetProfile.color;
      targetProfile.deviceType = metaOverride.deviceType || targetProfile.deviceType;
      await DB.saveProfiles(_profiles);
    }
  } else {
    var resolvedDeviceType = (cloudProfileData && cloudProfileData.deviceType) || 'custom';
    targetProfile = {
      id:         cloudProfileId,
      name:       (metaOverride && metaOverride.name)       || (cloudProfileData && cloudProfileData.name)       || cloudProfileName,
      icon:       (metaOverride && metaOverride.icon)       || (cloudProfileData && cloudProfileData.icon)       || null,
      color:      (metaOverride && metaOverride.color)      || (cloudProfileData && cloudProfileData.color)      || '#5c9edb',
      deviceType: (metaOverride && metaOverride.deviceType) || resolvedDeviceType,
      createdAt:  (cloudProfileData && cloudProfileData.createdAt) || new Date().toISOString()
    };
    _profiles.push(targetProfile);
    await DB.saveProfiles(_profiles);
    _activeIds.add(targetProfile.id);
    _visibleIds.add(targetProfile.id);
    _savePrefs();
  }
  var pulled = 0;
  snap.forEach(function(doc) {
    var remote = doc.data();
    var local  = State.getItem(_appState, remote.id);
    if (!local) {
      if (!remote.versions)      remote.versions      = [];
      if (!remote.itemUndoStack) remote.itemUndoStack = [];
      if (!remote.itemRedoStack) remote.itemRedoStack = [];
      remote.profileIds = [targetProfile.id];
      _appState.items.push(remote);
      pulled++;
    } else {
      if ((local.profileIds || []).indexOf(targetProfile.id) === -1) {
        local.profileIds = (local.profileIds || []).concat([targetProfile.id]);
      }
      if (remote.modifiedAt === (local.modifiedAt || '') &&
          (remote.text !== local.text || remote.html !== local.html || remote.title !== local.title)) {
        State.addItemVersion(local, {
          ts:         remote.modifiedAt,
          text:       remote.text,
          html:       remote.html,
          title:      remote.title,
          tags:       (remote.tags || []).slice(),
          name:       remote.versionName || '',
          deleted:    remote.deleted || false,
          profileIds: (remote.profileIds || []).slice()
        });
      } else if (remote.modifiedAt > (local.modifiedAt || '')) {
        var localSnap = {
          ts: local.modifiedAt, text: local.text, html: local.html,
          title: local.title, tags: (local.tags || []).slice(),
          name: local.versionName || '', deleted: local.deleted || false,
          profileIds: (local.profileIds || []).slice()
        };
        State.addItemVersion(local, localSnap);
        (remote.versions || []).forEach(function(rv) { State.addItemVersion(local, rv); });
        var preserved = { itemUndoStack: local.itemUndoStack || [], itemRedoStack: local.itemRedoStack || [] };
        Object.assign(local, remote, preserved);
        if ((local.profileIds || []).indexOf(targetProfile.id) === -1) {
          local.profileIds = (local.profileIds || []).concat([targetProfile.id]);
        }
      }
    }
  });
  State.saveState(_appState);
  _syncStatus[targetProfile.id] = 'synced';
  _savePrefs();
  _renderProfilePanel();
  if (_refreshFn) _refreshFn();
  _showProfileStatus('Pulled ' + pulled + ' new item(s) into profile "' + targetProfile.name + '".');
}
async function _doPullProfile(cloudProfileId, cloudProfileName, cloudProfileData) {
  if (!_currentUser || !_firestoreDb) return;
  _enqueuePull([{ cloudProfileId: cloudProfileId, cloudProfileName: cloudProfileName, cloudProfileData: cloudProfileData }]);
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
    _trackUsage(Math.max(1, itemsSnap.size), 0, itemsSnap.size + 1);
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
  if (visible) {
    _visibleIds.add(profileId);
  } else {
    _visibleIds.delete(profileId);
    _activeIds.delete(profileId);
  }
  if (!_visibleIds.size && _profiles.length) _visibleIds.add(_profiles[0].id);
  if (!_activeIds.size && _profiles.length) {
    var _firstVisible = _profiles.find(function(p) { return _visibleIds.has(p.id); });
    _activeIds.add(_firstVisible ? _firstVisible.id : _profiles[0].id);
  }
  _savePrefs();
  if (_refreshFn) _refreshFn();
  _renderDeviceIcons();
}
function setActive(profileId, active) {
  if (active) {
    _activeIds.add(profileId);
    _visibleIds.add(profileId);
  } else {
    _activeIds.delete(profileId);
  }
  if (!_activeIds.size && _profiles.length) _activeIds.add(_profiles[0].id);
  _savePrefs();
  if (_refreshFn) _refreshFn();
  _renderDeviceIcons();
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
    if (anyVisible) {
      _visibleIds.delete(p.id);
      _activeIds.delete(p.id);
    } else {
      _visibleIds.add(p.id);
    }
  });
  if (!_visibleIds.size && _profiles.length) _visibleIds.add(_profiles[0].id);
  if (!_activeIds.size && _profiles.length) {
    var _firstVisible = _profiles.find(function(p) { return _visibleIds.has(p.id); });
    _activeIds.add(_firstVisible ? _firstVisible.id : _profiles[0].id);
  }
  _savePrefs();
  if (_refreshFn) _refreshFn();
  _renderDeviceIcons();
  if (_panelOpen) _renderProfilePanel();
}
function _anyVisibleOfType(deviceType) {
  return _profiles.some(function(p) { return p.deviceType === deviceType && _visibleIds.has(p.id); });
}
function _getProfileHeaderState(profile) {
  var isVisible = _visibleIds.has(profile.id);
  var isActive  = _activeIds.has(profile.id);
  var isSynced  = _syncEnabled[profile.id] && _syncStatus[profile.id] === 'synced';
  if (!isVisible) return 'hidden';
  if (isVisible && isActive && isSynced) return 'synced';
  if (isVisible && isActive) return 'writing';
  return 'visible';
}
function _cycleProfileHeaderState(profile) {
  var state = _getProfileHeaderState(profile);
  if (state === 'hidden') {
    _visibleIds.add(profile.id);
    _activeIds.delete(profile.id);
  } else if (state === 'visible') {
    _visibleIds.add(profile.id);
    _activeIds.add(profile.id);
  } else if (state === 'writing') {
    if (_syncEnabled[profile.id]) {
      _visibleIds.add(profile.id);
      _activeIds.add(profile.id);
      _syncStatus[profile.id] = 'synced';
    } else {
      _visibleIds.delete(profile.id);
      _activeIds.delete(profile.id);
    }
  } else if (state === 'synced') {
    _visibleIds.delete(profile.id);
    _activeIds.delete(profile.id);
  }
  if (!_visibleIds.size && _profiles.length) _visibleIds.add(_profiles[0].id);
  if (!_activeIds.size && _profiles.length) {
    var _firstVis = _profiles.find(function(p) { return _visibleIds.has(p.id); });
    _activeIds.add(_firstVis ? _firstVis.id : _profiles[0].id);
  }
  _savePrefs();
  if (_refreshFn) _refreshFn();
  _renderDeviceIcons();
  if (_panelOpen) _renderProfilePanel();
}
function _renderDeviceIcons() {
  var wrap = document.getElementById('profile-device-icons');
  if (!wrap) return;
  wrap.innerHTML = '';
  var visibleProfiles = _profiles.filter(function(p) {
    if (p.id === 'p_orphaned') return false;
    return true;
  });
  visibleProfiles.forEach(function(profile) {
    var state = _getProfileHeaderState(profile);
    var btn = document.createElement('button');
    btn.className = 'profile-header-icon-btn profile-header-state-' + state;
    btn.title = profile.name + ' (' + state + ')';
    btn.innerHTML = _profileIconHTML(profile, window._dbgSzHeader !== undefined ? window._dbgSzHeader : 16);
    (function(p) {
      btn.addEventListener('click', function() { _cycleProfileHeaderState(p); });
    })(profile);
    wrap.appendChild(btn);
  });
}
// ===== PROFILE PANEL =====
function openPanel() {
  var panel = document.getElementById('profile-panel');
  if (!panel) return;
  _panelOpen = true;
  _savePrefs();
  panel.classList.remove('hidden');
  _hideProfileStatus();
  _renderProfilePanel();
  if (_currentUser) {
    _fetchAndRenderCloudProfiles();
    _profiles.forEach(function(p) {
      if (_syncEnabled[p.id]) _checkSyncStatus(p.id);
    });
  }
}
function closePanel() {
  var panel = document.getElementById('profile-panel');
  if (panel) panel.classList.add('hidden');
  _panelOpen       = false;
  _addFormOpen     = false;
  _deleteConfirmId = null;
  _styleEditId     = null;
  _hideProfileStatus();
  _savePrefs();
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
    if (count === 0) _bulkDeleteConfirmOpen = false;
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
  pBulkDelBtn.addEventListener('click', function() {
    _bulkDeleteConfirmOpen = true;
    _renderProfilePanel();
  });
  pCtrlBar.appendChild(pSelAllCb);
  pCtrlBar.appendChild(pBulkShowBtn);
  pCtrlBar.appendChild(pBulkHideBtn);
  pCtrlBar.appendChild(pBulkWriteOnBtn);
  pCtrlBar.appendChild(pBulkWriteOffBtn);
  pCtrlBar.appendChild(pBulkDelBtn);
  var onThisDeviceHeader = document.createElement('div');
  onThisDeviceHeader.className = 'cloud-profile-section-header';
  onThisDeviceHeader.textContent = 'On This Device';
  listEl.appendChild(onThisDeviceHeader);
  listEl.appendChild(pCtrlBar);
  _updateProfileCtrl();
  if (_bulkDeleteConfirmOpen && _selectedProfileIds.size > 0) {
    var bulkConfirmWrap = document.createElement('div');
    bulkConfirmWrap.className = 'profile-delete-confirm';
    var bulkConfirmInput = document.createElement('input');
    bulkConfirmInput.type        = 'text';
    bulkConfirmInput.placeholder = 'type "del profiles"';
    bulkConfirmInput.className   = 'profile-delete-input';
    var bulkConfirmBtn = document.createElement('button');
    bulkConfirmBtn.textContent = 'Confirm';
    bulkConfirmBtn.className   = 'profile-delete-confirm-btn';
    bulkConfirmBtn.addEventListener('click', async function() {
      if ((bulkConfirmInput.value || '').trim().toLowerCase() === 'del profiles') {
        var toDelete = Array.from(_selectedProfileIds);
        _selectedProfileIds.clear();
        _bulkDeleteConfirmOpen = false;
        for (var di = 0; di < toDelete.length; di++) { await deleteProfile(toDelete[di]); }
      } else {
        bulkConfirmInput.classList.add('error');
        setTimeout(function() { bulkConfirmInput.classList.remove('error'); }, 400);
        bulkConfirmInput.focus();
      }
    });
    bulkConfirmInput.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter') bulkConfirmBtn.click();
      if (e.key === 'Escape') { _bulkDeleteConfirmOpen = false; _renderProfilePanel(); }
    });
    var bulkCancelBtn = document.createElement('button');
    bulkCancelBtn.textContent = 'Cancel';
    bulkCancelBtn.className   = 'profile-delete-cancel-btn';
    bulkCancelBtn.addEventListener('click', function() { _bulkDeleteConfirmOpen = false; _renderProfilePanel(); });
    bulkConfirmWrap.appendChild(bulkConfirmInput);
    bulkConfirmWrap.appendChild(bulkConfirmBtn);
    bulkConfirmWrap.appendChild(bulkCancelBtn);
    listEl.appendChild(bulkConfirmWrap);
    setTimeout(function() { bulkConfirmInput.focus(); }, 30);
  }
  _visibleProfiles.forEach(function(profile, vi) {
    var isVisible = _visibleIds.has(profile.id);
    var isActive  = _activeIds.has(profile.id);
    var row = document.createElement('div');
    row.className = 'profile-row';
    var iconEl = document.createElement('div');
    iconEl.className   = 'profile-icon-wrap';
    iconEl.innerHTML   = _profileIconHTML(profile, window._dbgSzPanel !== undefined ? window._dbgSzPanel : 28);
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
    var nameIdWrap = document.createElement('div');
    nameIdWrap.className = 'profile-name-id-wrap';
    nameIdWrap.appendChild(nameEl);
    var idDispEl = document.createElement('span');
    idDispEl.className   = 'profile-id-display';
    idDispEl.textContent = profile.id;
    nameIdWrap.appendChild(idDispEl);
    row.appendChild(nameIdWrap);
    var dtSel = document.createElement('select');
    dtSel.className = 'profile-device-select';
    dtSel.title = 'Device type';
    ['mobile', 'computer', 'custom'].forEach(function(opt) {
      var o = document.createElement('option');
      o.value       = opt;
      o.textContent = opt;
      if (opt === (profile.deviceType || 'custom')) o.selected = true;
      dtSel.appendChild(o);
    });
    dtSel.addEventListener('click', function(e) { e.stopPropagation(); });
    dtSel.addEventListener('change', function() {
      updateProfile(profile.id, { deviceType: dtSel.value });
      _renderDeviceIcons();
      _renderProfilePanel();
    });
    row.appendChild(dtSel);
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
    if (_currentUser) {
      var isSyncOn  = !!_syncEnabled[profile.id];
      var syncState = _syncStatus[profile.id] || 'never';
      var syncColor = syncState === 'synced' ? 'var(--green)' : syncState === 'unsynced' ? 'var(--red)' : 'var(--text-ph)';
      var syncBtn   = document.createElement('button');
      syncBtn.className = 'profile-toggle-btn profile-sync-toggle-btn' + (isSyncOn ? ' active-write' : '');
      syncBtn.title     = isSyncOn ? 'Auto-sync ON — click to disable' : 'Auto-sync OFF — click to enable';
      syncBtn.innerHTML = _syncSVG(isSyncOn ? syncColor : 'var(--text-ph)');
      (function(pid, wasOn) {
        syncBtn.addEventListener('click', async function() {
          _syncEnabled[pid] = !wasOn;
          if (!_syncEnabled[pid]) {
            clearTimeout(_syncTimers[pid]);
            _stopSyncListener(pid);
          } else {
            _checkSyncStatus(pid);
            _startSyncListener(pid);
          }
          _savePrefs();
          _renderProfilePanel();
        });
      })(profile.id, isSyncOn);
      row.appendChild(syncBtn);
    }
    if (_deleteConfirmId === profile.id) {
      var confirmWrap = document.createElement('div');
      confirmWrap.className = 'profile-delete-confirm';
      var confirmInput = document.createElement('input');
      confirmInput.type        = 'text';
      confirmInput.placeholder = 'type "del profile"';
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
        if ((confirmInput.value || '').trim().toLowerCase() === 'del profile') {
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
      [{ title: 'Mobile', svg: _mobileSVG() }, { title: 'Laptop', svg: _laptopSVG() }, { title: 'PC', svg: _computerSVG() }].forEach(function(def) {
        var pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'profile-icon-pick-btn';
        pickBtn.title = def.title;
        pickBtn.innerHTML = def.svg;
        pickBtn.addEventListener('click', function() { styleIconInput.value = def.svg; });
        styleWrap.appendChild(pickBtn);
      });
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
  var _iconInp   = document.getElementById('new-profile-icon');
  var _colorInp  = document.getElementById('new-profile-color');
  if (_iconInp && _colorInp && _colorInp.parentElement) {
    [{ title: 'Mobile', svg: _mobileSVG() }, { title: 'Laptop', svg: _laptopSVG() }, { title: 'PC', svg: _computerSVG() }].forEach(function(def) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'profile-icon-pick-btn';
      b.title = def.title;
      b.innerHTML = def.svg;
      b.addEventListener('click', function() { _iconInp.value = def.svg; });
      _colorInp.parentElement.insertBefore(b, _colorInp);
    });
  }
}
// ===== ITEM PROFILE ICONS (called from render.js) =====
function getItemProfileIconsHTML(item) {
  if (!item || !item.profileIds || !item.profileIds.length) return '';
  if (_profiles.filter(function(p) { return p.id !== 'p_orphaned'; }).length <= 1) return '';
  var out = '';
  item.profileIds.forEach(function(pid) {
    var p = _profiles.find(function(pr) { return pr.id === pid; });
    if (!p) return;
    var dimmed = !_visibleIds.has(pid);
    out += '<span class="item-profile-icon' + (dimmed ? ' item-profile-icon-dim' : '') + '" title="' + p.name + '">'
        + _profileIconHTML(p, window._dbgSzBadge !== undefined ? window._dbgSzBadge : 12) + '</span>';
  });
  return out;
}
// ===== PROFILE ICON HTML =====
function _profileIconHTML(profile, size) {
  size = size || 20;
  if (profile.icon) {
    var icon = profile.icon.trim();
    if (icon.startsWith('<svg') || icon.startsWith('<SVG')) {
      var resized = icon
        .replace(/(<svg[^>]*?)\bwidth="[^"]*"/, `$1width="${size}"`)
        .replace(/(<svg[^>]*?)\bheight="[^"]*"/, `$1height="${size}"`);
      return `<span class="profile-icon-svg" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;">${resized}</span>`;
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
function _laptopSVG() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="2" width="18" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
    <rect x="1" y="15" width="22" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
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
async function deleteItemsFromCloud(itemIds) {
  if (!_currentUser || !_firestoreDb || !itemIds || !itemIds.length) return;
  var uid = _currentUser.uid;
  for (var pi = 0; pi < _profiles.length; pi++) {
    var profile = _profiles[pi];
    if (!_syncEnabled[profile.id]) continue;
    var base = _firestoreDb.collection('users').doc(uid).collection('profiles').doc(profile.id);
    var batch = _firestoreDb.batch();
    itemIds.forEach(function(id) { batch.delete(base.collection('items').doc(id)); });
    try { await batch.commit(); }
    catch(e) { console.warn('deleteItemsFromCloud failed for profile', profile.id, e); }
  }
}
window.Profiles = {
  init,
  notifyItemChanged,
  deleteItemsFromCloud,
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
  fetchDailyUsage,
  openPanel,
  closePanel,
  getItemProfileIconsHTML,
  _profileIconHTML
};

