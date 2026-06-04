'use strict';
/*
 * render.js
 * Builds/patches the item list DOM from a display list.
 * Exported on window.Render
 */
var _list               = null;
var _state              = null;
var _topBumped          = null; // Set<id>
var _blobUrls           = {};   // imageId → objectURL cache
var _openVersionPanels  = new Set();
var _versionSelections  = {};
var _versionSelectAll   = new Set();
function _drawSelCanvas(canvas, total, selSet, emptySelected) {
  var ctx = canvas.getContext('2d');
  var w = canvas.width;
  var h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  var style = getComputedStyle(document.documentElement);
  var colBorder  = (style.getPropertyValue('--border') || '#435160').trim();
  var colFill    = (style.getPropertyValue('--blue-dim') || '#5c9edb').trim();
  var colBg      = (style.getPropertyValue('--surface') || '#3a4455').trim();
  // Border + background
  ctx.fillStyle = colBg;
  ctx.strokeStyle = colBorder;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(0.75, 0.75, w - 1.5, h - 1.5, 2);
  ctx.fill();
  ctx.stroke();
  if (!total || !selSet.size) {
    if (emptySelected) {
      ctx.fillStyle = colFill;
      ctx.beginPath();
      ctx.roundRect(0.75, 0.75, w - 1.5, h - 1.5, 2);
      ctx.fill();
      ctx.strokeStyle = '#1a2030';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(3, 6.5);
      ctx.lineTo(5.5, 9);
      ctx.lineTo(10, 4);
      ctx.stroke();
    }
    return;
  }
  if (selSet.size === total) {
    // Full fill with checkmark
    ctx.fillStyle = colFill;
    ctx.beginPath();
    ctx.roundRect(0.75, 0.75, w - 1.5, h - 1.5, 2);
    ctx.fill();
    ctx.strokeStyle = '#1a2030';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(3, 6.5);
    ctx.lineTo(5.5, 9);
    ctx.lineTo(10, 4);
    ctx.stroke();
    return;
  }
  // Segmented bands — visual order: index 0 in selSet = top of list = top of canvas
  // The list renders reversed (_versions.slice().reverse()), so visual index 0 = _versions[total-1]
  ctx.fillStyle = colFill;
  var bandH = (h - 1.5) / total;
  for (var vi = 0; vi < total; vi++) {
    // vi=0 is top of visual list = realIdx total-1-0 = total-1
    var realIdx = total - 1 - vi;
    if (!selSet.has(realIdx)) continue;
    var y = 0.75 + vi * bandH;
    ctx.fillRect(0.75, y, w - 1.5, bandH);
  }
}
function init(state) {
  _state = state;
  _list  = document.getElementById('item-list');
}
/*
 * render(filtered, rest, selectedIds, tagSelMode, selectedTags)
 */
function render(filtered, rest, selectedIds, tagSelMode, selectedTags) {
  _topBumped = State.getTopBumped(_state, 10);
  var frag   = document.createDocumentFragment();
  // New-item placeholder always first
  frag.appendChild(_makePlaceholder());
  // Tag selection mode banner
  if (tagSelMode) {
    var banner = document.createElement('div');
    banner.className = 'tag-sel-banner';
    var bannerTxt = document.createElement('span');
    bannerTxt.textContent = 'Tag selection mode — tap tags to select';
    var exitBtn = document.createElement('button');
    exitBtn.className   = 'tag-sel-exit-btn';
    exitBtn.textContent = 'Exit';
    exitBtn.addEventListener('click', function () { Items.exitTagSelMode(); });
    banner.appendChild(bannerTxt);
    banner.appendChild(exitBtn);
    frag.appendChild(banner);
  }
  // Filtered section
  var _sc = 'asdfghjklqwertyuiopzxcvbnm';
  var _li = 0;
  if (filtered.length > 0) {
    filtered.forEach(function (item) {
      var rowEl = _makeItem(item, true, selectedIds, tagSelMode, selectedTags);
      if (_li < _sc.length) {
        var innerEl = rowEl.querySelector('.item');
        if (innerEl) innerEl.dataset.shortcut = _sc[_li++]; else _li++;
      }
      frag.appendChild(rowEl);
    });
    var div = document.createElement('div');
    div.className   = 'filter-divider';
    div.textContent = '— rest —';
    frag.appendChild(div);
  }
  // Rest section
  rest.forEach(function (item) {
    var rowEl = _makeItem(item, false, selectedIds, tagSelMode, selectedTags);
    if (_li < _sc.length) {
      var innerEl = rowEl.querySelector('.item');
      if (innerEl) innerEl.dataset.shortcut = _sc[_li++]; else _li++;
    }
    frag.appendChild(rowEl);
  });
  _list.innerHTML = '';
  _list.appendChild(frag);
}
/* ====== PLACEHOLDER ====== */
function _makePlaceholder() {
  var el = document.createElement('div');
  el.className   = 'item new-placeholder';
  el.dataset.id  = '__new__';
  var topRow = document.createElement('div');
  topRow.className = 'placeholder-top-row';
  var titleEl = document.createElement('div');
  titleEl.className           = 'item-title';
  titleEl.contentEditable     = 'true';
  titleEl.dataset.placeholder = 'title (optional)';
  titleEl.setAttribute('aria-label', 'New item title');
  titleEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      content.focus();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      var si = document.getElementById('search-input');
      if (si) si.focus();
    }
  });
  var imgInput = document.createElement('input');
  imgInput.type          = 'file';
  imgInput.accept        = 'image/*';
  imgInput.style.display = 'none';
  imgInput.addEventListener('change', function () {
    var file = imgInput.files[0];
    if (file) document.dispatchEvent(new CustomEvent('sc:create-image', { detail: { blob: file } }));
    imgInput.value = '';
  });
  var imgBtn = document.createElement('button');
  imgBtn.className = 'img-pick-btn';
  imgBtn.tabIndex = -1;
  imgBtn.innerHTML = `<svg width="26" height="26" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="22" height="22" rx="3" fill="currentColor" opacity="0.12"/>
  <rect x="0.75" y="0.75" width="20.5" height="20.5" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="6.5" cy="6.5" r="2.2" fill="currentColor" opacity="0.65"/>
  <path d="M0 15.5 L6 9 L10.5 13.5 L14.5 10 L22 16.5 L22 22 L0 22 Z" fill="currentColor" opacity="0.5"/>
</svg>`;
  imgBtn.addEventListener('click', function (e) { e.preventDefault(); imgInput.click(); });
  topRow.appendChild(titleEl);
  var sep = document.createElement('div');
  sep.className = 'placeholder-sep';
  var content = document.createElement('div');
  content.className           = 'item-content placeholder';
  content.contentEditable     = 'true';
  content.dataset.placeholder = 'create new clipboard item…';
  content.setAttribute('aria-label', 'Create new item');
  content.addEventListener('focus', function () {
    if (content.classList.contains('placeholder')) {
      content.textContent = '';
      content.classList.remove('placeholder');
    }
  });
  content.addEventListener('blur', function () {
    var text = (content.textContent || '').trim();
    if (!text) {
      content.classList.add('placeholder');
    } else {
      var title = (titleEl.textContent || '').trim();
      document.dispatchEvent(new CustomEvent('sc:create-item', {
        detail: { text: text, html: content.innerHTML, title: title }
      }));
      content.textContent = '';
      content.classList.add('placeholder');
      titleEl.textContent = '';
    }
  });
  content.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      content.blur();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      var si = document.getElementById('search-input');
      if (si) si.focus();
    }
  });
  var contentRow = document.createElement('div');
  contentRow.className = 'placeholder-content-row';
  contentRow.appendChild(content);
  contentRow.appendChild(imgInput);
  contentRow.appendChild(imgBtn);
  el.appendChild(topRow);
  el.appendChild(sep);
  el.appendChild(contentRow);
  return el;
}
/* ====== ITEM ELEMENT ====== */
function _makeItem(item, isFiltered, selectedIds, tagSelMode, selectedTags) {
  var el = document.createElement('div');
  el.className  = 'item' + (isFiltered ? ' filtered' : '') +
  (item.starred ? ' starred' : '') +
  (item.deleted ? ' deleted' : '') +
  (item.imageId ? ' has-image' : '');
  el.dataset.id = item.id;
  // --- Left column (ID + up + checkbox + down) ---
  var left = document.createElement('div');
  left.className = 'item-left';
  var idSpan = document.createElement('span');
  idSpan.className   = 'item-id';
  idSpan.textContent = item.deleted ? '×' : item.bumpOrder + 1;
  var isBumpMode = (_state.sortMode === 'id-asc' || _state.sortMode === 'id-desc' || _state.sortMode === 'bump');
  var isTop = _topBumped.has(item.id);
  var upBtn = document.createElement('button');
  upBtn.className   = 'arrow-btn' + (isTop && !isBumpMode ? ' top-bumped' : '');
  upBtn.textContent = isBumpMode ? '▲' : '⇑';
  upBtn.title       = 'Move up';
  upBtn.addEventListener('click', function () {
    document.dispatchEvent(new CustomEvent('sc:bump', { detail: { id: item.id, dir: -1 } }));
  });
  var controls = document.createElement('div');
  controls.className = 'item-controls';
  controls.appendChild(upBtn);
  controls.appendChild(idSpan);
  var dnBtn = document.createElement('button');
  dnBtn.className   = 'arrow-btn';
  dnBtn.textContent = isBumpMode ? '▼' : '⇓';
  dnBtn.title       = 'Move down';
  dnBtn.addEventListener('click', function () {
    document.dispatchEvent(new CustomEvent('sc:bump', { detail: { id: item.id, dir: 1 } }));
  });
  if (isBumpMode) controls.appendChild(dnBtn);
  left.appendChild(controls);
  el.appendChild(left);
  // --- Content ---
  var contentCol = document.createElement('div');
  contentCol.className = 'item-content-col';
  var titleEl = document.createElement('div');
  titleEl.className       = 'item-title';
  titleEl.contentEditable = item.deleted ? 'false' : 'true';
  titleEl.dataset.placeholder = 'add title...';
  titleEl.dataset.id      = item.id;
  if (item.title) { titleEl.textContent = item.title; }
  titleEl.addEventListener('blur', function () {
    var newTitle = (titleEl.textContent || '').trim().replace(/\s*\(preview\)$/i, '');
    if (newTitle !== (item.title || '').trim()) {
      document.dispatchEvent(new CustomEvent('sc:edit-title', {
        detail: { id: item.id, title: newTitle }
      }));
    }
  });
  titleEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); titleEl.blur(); }
  });
  contentCol.appendChild(titleEl);
  var content = document.createElement('div');
  content.className       = 'item-content';
  content.contentEditable = item.deleted ? 'false' : 'true';
  content.innerHTML       = item.html || item.text || '';
  content.setAttribute('data-id', item.id);
  content.addEventListener('blur', function () {
    var newText = (content.textContent || '').trim();
    if (newText !== (item.text || '').trim()) {
      document.dispatchEvent(new CustomEvent('sc:edit-item', {
        detail: { id: item.id, text: newText, html: content.innerHTML }
      }));
    }
  });
  content.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); content.blur(); }
    if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      var dir = e.key === 'ArrowUp' ? -1 : 1;
      var lines = content.innerHTML.split(/<br\s*\/?>/i);
      if (lines.length < 2) return;
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var lineIdx = 0;
      var walker = content.firstChild;
      while (walker && walker !== sel.anchorNode && walker !== sel.anchorNode.parentNode) {
        if (walker.nodeName === 'BR') lineIdx++;
        walker = walker.nextSibling;
      }
      var target = lineIdx + dir;
      if (target < 0 || target >= lines.length) return;
      var tmp = lines[lineIdx];
      lines[lineIdx] = lines[target];
      lines[target] = tmp;
      content.innerHTML = lines.join('<br>');
      var cur = content.firstChild;
      var count = 0;
      if (target === 0) {
        cur = content.firstChild;
      } else {
        while (cur) {
          if (cur.nodeName === 'BR') { count++; if (count === target) { cur = cur.nextSibling; break; } }
          cur = cur.nextSibling;
        }
      }
      var r = document.createRange();
      if (cur && cur.nodeType === 3) { r.setStart(cur, cur.length); }
      else { r.setStart(content, content.childNodes.length); }
      r.collapse(true);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  });
  // Single click to copy (only when not editing)
  var _clickTimer = null;
  content.addEventListener('click', function (e) {
    if (document.activeElement === content) return; // already editing
    content.classList.add('copy-flash');
    setTimeout(function () { content.classList.remove('copy-flash'); }, 500);
    clearTimeout(_clickTimer);
    _clickTimer = setTimeout(function () {
      document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: item.id } }));
      el.classList.add('copy-flash');
      setTimeout(function () { el.classList.remove('copy-flash'); }, 500);
    }, 200);
  });
  // Long-press to open tag editor (2 s)
  var _lpTimer = null;
  content.addEventListener('pointerdown', function () {
    _lpTimer = setTimeout(function () {
      document.dispatchEvent(new CustomEvent('sc:open-tags', { detail: { id: item.id } }));
    }, 2000);
  });
  content.addEventListener('pointerup',    function () { clearTimeout(_lpTimer); });
  content.addEventListener('pointermove',  function () { clearTimeout(_lpTimer); });
  content.addEventListener('pointercancel',function () { clearTimeout(_lpTimer); });
  contentCol.appendChild(content);
  el.appendChild(contentCol);
  // --- Right column ---
  var right = document.createElement('div');
  right.className = 'item-right';
  var starBtn = document.createElement('button');
  starBtn.className   = 'star-btn' + (item.starred ? ' active' : '');
  starBtn.textContent = item.starred ? '★' : '☆';
  starBtn.title       = 'Star';
  starBtn.addEventListener('click', function () {
    document.dispatchEvent(new CustomEvent('sc:toggle-star', { detail: { id: item.id } }));
  });
  right.appendChild(starBtn);
  var _outerActionBtn;
  if (item.imageId) {
    var shareBtn = document.createElement('button');
    shareBtn.className   = 'share-btn';
    shareBtn.textContent = '⮫';
    shareBtn.title       = 'Share image';
    shareBtn.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('sc:share-item', { detail: { id: item.id } }));
    });
    _outerActionBtn = shareBtn;
  } else {
    var copyBtn = document.createElement('button');
    copyBtn.className   = 'copy-btn';
    copyBtn.title       = 'Copy';
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
  <path d="M3 10H2a1 1 0 01-1-1V2a1 1 0 011-1h7a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;
    copyBtn.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: item.id } }));
      el.classList.add('copy-flash');
      setTimeout(function () { el.classList.remove('copy-flash'); }, 500);
    });
    _outerActionBtn = copyBtn;
  }
  var iUndoBtn = document.createElement('button');
  iUndoBtn.className = 'item-hist-btn';
  iUndoBtn.title = 'Undo this item';
  iUndoBtn.textContent = '\u21b6';
  iUndoBtn.disabled = !(item.itemUndoStack && item.itemUndoStack.length);
  iUndoBtn.style.fontSize = '15px';
  var iRedoBtn = document.createElement('button');
  iRedoBtn.className = 'item-hist-btn';
  iRedoBtn.title = 'Redo this item';
  iRedoBtn.textContent = '\u21b7';
  iRedoBtn.disabled = !(item.itemRedoStack && item.itemRedoStack.length);
  iRedoBtn.style.fontSize = '15px';
  iRedoBtn.style.fontSize = '15px';
  right.appendChild(_outerActionBtn);
  right.appendChild(iUndoBtn);
  right.appendChild(iRedoBtn);
  el.appendChild(right);
  // --- Image ---
  if (item.imageId) {
    var imgEl = document.createElement('img');
    imgEl.className = 'item-image';
    imgEl.alt       = item.text || 'image';
    DB.loadImage(item.imageId).then(function (blob) {
      if (blob) {
        if (!_blobUrls[item.imageId]) _blobUrls[item.imageId] = URL.createObjectURL(blob);
        imgEl.src = _blobUrls[item.imageId];
      }
    });
    el.appendChild(imgEl);
  }
  // --- Footer ---
  var footer = document.createElement('div');
  footer.className = 'item-footer';
  var tsCont = document.createElement('div');
  tsCont.className = 'item-timestamps';
  var tsCreated = document.createElement('span');
  tsCreated.className   = 'item-ts item-ts-created';
  tsCreated.textContent = 'created: ' + _fmtDate(item.createdAt);
  tsCont.appendChild(tsCreated);
  var tsModWrap = document.createElement('div');
  tsModWrap.className = 'item-ts-modified-wrap';
  var tsModRow = document.createElement('div');
  tsModRow.className = 'item-ts-modified-row';
  var tsModified = document.createElement('span');
  tsModified.className = 'item-ts item-ts-modified';
  var _modLabel = 'modified: ' + _fmtDate(item.modifiedAt);
  tsModified.textContent = _modLabel;
  if (State.dedupeVersions(item)) State.saveState(_state);
  var _versionsRaw = item.versions || [];
  var _vSeen = [];
  var _versions = [];
  var _rawIdxMap = [];
  _versionsRaw.forEach(function(v, ri) {
    if (v.deleted) {
        _versions.push(v);
        _rawIdxMap.push(ri);
        return;
    }
    var k = (v.text||'').trim() + '\x00' + (v.title||'').replace(/\s*\(preview\)$/i,'').trim();
    if (_vSeen.indexOf(k) !== -1) return;
    _vSeen.push(k);
    _versions.push(v);
    _rawIdxMap.push(ri);
  });
  var vDropBtn = document.createElement('button');
  vDropBtn.className = 'version-drop-btn';
  vDropBtn.title = 'Version history (' + _versions.length + ')';
  vDropBtn.textContent = '\u25be';
  if (!_versions.length) vDropBtn.classList.add('no-versions');
  var curNameInput = document.createElement('input');
  curNameInput.type = 'text';
  curNameInput.className = 'version-name-input';
  curNameInput.placeholder = 'name\u2026';
  curNameInput.value = item.versionName || '';
  (function () {
    var _t = null;
    function _save() {
      document.dispatchEvent(new CustomEvent('sc:name-version', {
        detail: { id: item.id, versionIndex: -1, name: curNameInput.value }
      }));
    }
    curNameInput.addEventListener('input', function () { clearTimeout(_t); _t = setTimeout(_save, 400); });
    curNameInput.addEventListener('blur',  function () { clearTimeout(_t); _save(); });
    curNameInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') curNameInput.blur(); ev.stopPropagation(); });
    curNameInput.addEventListener('click',   function (ev) { ev.stopPropagation(); });
  })();
  tsModRow.appendChild(tsModified);
  tsModRow.appendChild(vDropBtn);
  tsModRow.appendChild(curNameInput);
  tsModWrap.appendChild(tsModRow);
  var vPanel = document.createElement('div');
  vPanel.className = 'version-panel hidden';
  {
    var _savedSel = (_versionSelections[item.id] || []).filter(function(i) { return i >= 0 && i < _versions.length; });
    var _selVersions = new Set(_savedSel);
    var _userSelVersions = new Set(_savedSel);
    var _showDelNow = document.getElementById('app').classList.contains('show-deleted');
    if (_versionSelectAll.has(item.id)) {
      _versions.forEach(function(v, i) { if (_showDelNow || !v.deleted) { _selVersions.add(i); _userSelVersions.add(i); } });
    }
    if (_showDelNow) {
        var _nonDelIdxs = [];
        _versions.forEach(function(v, i) { if (!v.deleted) _nonDelIdxs.push(i); });
        var _allNonDelSel = _nonDelIdxs.length > 0 && _nonDelIdxs.every(function(i) { return _selVersions.has(i); });
        if (_allNonDelSel) {
            _versions.forEach(function(v, i) { if (v.deleted) _selVersions.add(i); });
        }
    }
    var _vTsArr = {};
    var _cbPeekIdx = null;
    var _cbCheckOrder = [];
    var vList = document.createElement('div');
    vList.className = 'version-list';
    var vCtrlBar = document.createElement('div');
    vCtrlBar.className = 'version-ctrl-bar';
    var vSelAllCb = document.createElement('canvas');
    vSelAllCb.className = 'version-sel-cb version-sel-canvas';
    vSelAllCb.title = 'Select all';
    vSelAllCb.width = 13;
    vSelAllCb.height = 13;
    vSelAllCb._checked = false;
    vSelAllCb._indeterminate = false;
    var vSwitchBtn = document.createElement('button');
    vSwitchBtn.className = 'version-restore-btn';
    vSwitchBtn.textContent = 'switch';
    vSwitchBtn.disabled = true;
    var vDelVerBtn = document.createElement('button');
    vDelVerBtn.className = 'version-del-ver-btn';
    vDelVerBtn.textContent = 'delete';
    vDelVerBtn.disabled = true;
    var vRestVerBtn = document.createElement('button');
    vRestVerBtn.className = 'version-restore-ver-btn';
    vRestVerBtn.textContent = 'restore';
    vRestVerBtn.disabled = true;
    vRestVerBtn._noClose = true;
    var vBurnVerBtn = document.createElement('button');
    vBurnVerBtn.className = 'version-burn-btn';
    vBurnVerBtn.title = 'Burn versions (permanent)';
    vBurnVerBtn.innerHTML = `<svg
  width="14"
  height="14"
  viewBox="0 0 14 14"
  fill="none"
  xmlns="http://www.w3.org/2000/svg">
  <path
    d="M 7 1.5
       C 8.5 2.5, 9.5 4.5, 9 6
       C 9.5 5, 11 3.5, 10.5 3.5
       C 11.5 4.5, 12 7, 11.5 9
       C 11.5 11.5, 9.5 13, 7 13
       C 4.5 13, 2.5 11.5, 2.5 9
       C 2.5 7.5, 2 5, 3.5 3.5
       C 3 3, 4 4.5, 5 6
       C 4.5 4.5, 5.5 2.5, 7 1.5 Z"
    stroke="currentColor"
    stroke-width="1.2"
    stroke-linejoin="round"
    fill="none"/>
  <path
    d="M 7 7.5
       C 8.5 8.5, 8.5 10.5, 7 11.5
       C 5.5 10.5, 5.5 8.5, 7 7.5 Z"
    fill="currentColor"/>
</svg>`;
    vBurnVerBtn.disabled = true;
    vCtrlBar.appendChild(vSelAllCb);
    vCtrlBar.appendChild(vSwitchBtn);
    vCtrlBar.appendChild(vDelVerBtn);
    vCtrlBar.appendChild(vRestVerBtn);
    vCtrlBar.appendChild(vBurnVerBtn);
    var _updateVersionCtrl = function () {
      _versionSelections[item.id] = Array.from(_userSelVersions);
      var count = _selVersions.size;
      vSwitchBtn.disabled = count !== 1;
      vDelVerBtn.disabled = count === 0;
      vBurnVerBtn.disabled = count === 0;
      var hasDeleted = count > 0 && Array.from(_selVersions).some(function (idx) { return _versions[idx] && _versions[idx].deleted; });
      vRestVerBtn.disabled = !hasDeleted;
      var _showDel = document.getElementById('app').classList.contains('show-deleted');
      var _visIdxs = [];
      _versions.forEach(function(v, i) { if (_showDel || !v.deleted) _visIdxs.push(i); });
      var _visTotal = _visIdxs.length;
      var _visSelSet = new Set();
      _visIdxs.forEach(function(origIdx, vi) { if (_selVersions.has(origIdx)) _visSelSet.add(vi); });
      var _isSelectAll = _versionSelectAll.has(item.id);
  vSelAllCb._checked = (_visTotal > 0 && _visSelSet.size === _visTotal) || (_visTotal === 0 && _isSelectAll);
  vSelAllCb._indeterminate = _visSelSet.size > 0 && _visSelSet.size < _visTotal;
  _drawSelCanvas(vSelAllCb, _visTotal, _visSelSet, _isSelectAll && _visTotal === 0);
    };
    _updateVersionCtrl();
    vSwitchBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var idx = Array.from(_selVersions)[0];
      document.dispatchEvent(new CustomEvent('sc:restore-version', {
        detail: { id: item.id, versionIndex: _rawIdxMap[idx] }
      }));
    });
    vDelVerBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      document.dispatchEvent(new CustomEvent('sc:version-delete', {
        detail: { id: item.id, indices: Array.from(_selVersions).map(function(i){ return _rawIdxMap[i]; }) }
      }));
    });
    vBurnVerBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      document.dispatchEvent(new CustomEvent('sc:version-hard-delete', {
        detail: { id: item.id, indices: Array.from(_selVersions).map(function(i){ return _rawIdxMap[i]; }) }
      }));
    });
    vRestVerBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var hasDeleted = Array.from(_selVersions).some(function (idx) { return _versions[idx] && _versions[idx].deleted; });
      if (!hasDeleted) return;
      document.dispatchEvent(new CustomEvent('sc:version-undelete', {
        detail: { id: item.id, indices: Array.from(_selVersions).map(function (i) { return _rawIdxMap[i]; }) }
      }));
    });
    vSelAllCb.addEventListener('click', function () {
      var _showDel = document.getElementById('app').classList.contains('show-deleted');
      var _visIdxs = [];
      _versions.forEach(function(v, i) { if (_showDel || !v.deleted) _visIdxs.push(i); });
      if (!_visIdxs.length) {
        if (_versionSelectAll.has(item.id)) _versionSelectAll.delete(item.id);
        else _versionSelectAll.add(item.id);
        _updateVersionCtrl();
        return;
      }
      var _allVisSelected = _visIdxs.every(function(i) { return _selVersions.has(i); });
      if (_allVisSelected) {
        _visIdxs.forEach(function(i) { _selVersions.delete(i); });
        _visIdxs.forEach(function(i) { _userSelVersions.delete(i); });
        _versionSelectAll.delete(item.id);
      } else {
        _visIdxs.forEach(function(i) { _selVersions.add(i); });
        _visIdxs.forEach(function(i) { _userSelVersions.add(i); });
        _versionSelectAll.add(item.id);
      }
      vList.querySelectorAll('.version-row-cb').forEach(function (cb, cbIdx) {
        cb.checked = _selVersions.has(_versions.length - 1 - cbIdx);
      });
      _updateVersionCtrl();
    });
    _versions.slice().reverse().forEach(function (ver, rIdx) {
      var realIdx = _versions.length - 1 - rIdx;
      var vRow = document.createElement('div');
      vRow.className = 'version-entry' + (ver.deleted ? ' version-deleted' : '');
      var vTs = document.createElement('span');
      vTs.className = 'version-entry-ts';
      vTs.textContent = _fmtDate(ver.ts);
      var vNameInp = document.createElement('input');
      vNameInp.type = 'text';
      vNameInp.className = 'version-name-input';
      vNameInp.placeholder = 'name\u2026';
      vNameInp.value = ver.name || '';
      (function (idx) {
        var _t2 = null;
        function _save2() {
          document.dispatchEvent(new CustomEvent('sc:name-version', {
            detail: { id: item.id, versionIndex: idx, name: vNameInp.value }
          }));
        }
        vNameInp.addEventListener('input', function () { clearTimeout(_t2); _t2 = setTimeout(_save2, 400); });
        vNameInp.addEventListener('blur',  function () { clearTimeout(_t2); _save2(); });
        vNameInp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') vNameInp.blur(); ev.stopPropagation(); });
        vNameInp.addEventListener('click',   function (ev) { ev.stopPropagation(); });
        var vCb = document.createElement('input');
        vCb.type = 'checkbox';
        vCb.className = 'version-row-cb';
        vCb.checked = _selVersions.has(idx);
        _vTsArr[idx] = vTs;
        vCb.addEventListener('change', function () {
          if (vCb.checked) {
            _selVersions.add(idx);
            _userSelVersions.add(idx);
            _cbCheckOrder.push(idx);
            var anyPeeking = vList.querySelector('.version-entry-ts.version-ts-peeking');
            var isCbPeek = _cbPeekIdx !== null && _vTsArr[_cbPeekIdx] && _vTsArr[_cbPeekIdx].classList.contains('version-ts-peeking');
            if (!anyPeeking || isCbPeek) {
              if (isCbPeek) _vTsArr[_cbPeekIdx].click();
              if (_vTsArr[idx]) _vTsArr[idx].click();
              _cbPeekIdx = idx;
            }
          } else {
            _selVersions.delete(idx);
            _userSelVersions.delete(idx);
            _cbCheckOrder = _cbCheckOrder.filter(function (i) { return i !== idx; });
            if (_cbPeekIdx === idx && _vTsArr[idx] && _vTsArr[idx].classList.contains('version-ts-peeking')) {
              _vTsArr[idx].click();
              _cbPeekIdx = null;
              var lastChecked = _cbCheckOrder.length ? _cbCheckOrder[_cbCheckOrder.length - 1] : null;
              if (lastChecked !== null && _vTsArr[lastChecked]) {
                _vTsArr[lastChecked].click();
                _cbPeekIdx = lastChecked;
              }
            }
          }
          _updateVersionCtrl();
        });
        var _origHTML = '';
        var _origTitle = '';
        vTs.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var currentlyPeeking = vTs.classList.contains('version-ts-peeking');
          if (currentlyPeeking) {
            content.innerHTML = _origHTML;
            content.style.color = '';
            titleEl.textContent = _origTitle;
            vTs.classList.remove('version-ts-peeking');
          } else {
            var activePeek = vList.querySelector('.version-entry-ts.version-ts-peeking');
            if (activePeek && activePeek !== vTs) {
              activePeek.classList.remove('version-ts-peeking');
              _origHTML = activePeek._origHTML;
              _origTitle = activePeek._origTitle;
            } else {
              _origHTML = content.innerHTML;
              _origTitle = titleEl.textContent;
            }
            vTs._origHTML = _origHTML;
            vTs._origTitle = _origTitle;
            var _diffCurText   = (item.text || '');
            var _diffVerText   = (ver.text  || '');
            var _diffCurTitle  = (_origTitle || '').replace(/\s*\(preview\)$/i, '');
            var _diffVerTitle  = (ver.title  || '');
            content.innerHTML  = _diffToHTML(_charDiff(_diffCurText, _diffVerText));
            titleEl.innerHTML  = _diffToHTML(_charDiff(_diffCurTitle, _diffVerTitle)) + '<span style="color:var(--text-ph)"> (preview)</span>';
            vTs.classList.add('version-ts-peeking');
          }
        });
        var vRowInner = document.createElement('div');
        vRowInner.style.display = 'flex';
        vRowInner.style.alignItems = 'center';
        vRowInner.style.gap = '4px';
        vRowInner.style.width = '100%';
        vRowInner.appendChild(vCb);
        vRowInner.appendChild(vTs);
        vRowInner.appendChild(vNameInp);
        vRow.appendChild(vRowInner);
      })(realIdx);
      vList.appendChild(vRow);
    });
    vPanel.appendChild(vCtrlBar);
    vPanel.appendChild(vList);
  }
  if (!_versions.length) {
    var noVer = document.createElement('div');
    noVer.className = 'version-empty';
    noVer.textContent = 'no history yet';
    vPanel.appendChild(noVer);
  }
  tsModWrap.appendChild(vPanel);
  (function () {
    var _open = _openVersionPanels.has(item.id);
    if (_open) {
      vPanel.classList.remove('hidden');
      vDropBtn.textContent = '\u25b4';
      vDropBtn.classList.add('active');
    }
    vDropBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      _open = !_open;
      vPanel.classList.toggle('hidden', !_open);
      vDropBtn.textContent = _open ? '\u25b4' : '\u25be';
      vDropBtn.classList.toggle('active', _open);
      if (_open) _openVersionPanels.add(item.id);
      else       _openVersionPanels.delete(item.id);
    });
  })();
  iUndoBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    document.dispatchEvent(new CustomEvent('sc:item-undo', { detail: { id: item.id } }));
  });
  iRedoBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    document.dispatchEvent(new CustomEvent('sc:item-redo', { detail: { id: item.id } }));
  });
  tsCont.appendChild(tsModWrap);
  if (item.deleted) {
    var tsDeleted = document.createElement('span');
    tsDeleted.className   = 'item-ts item-ts-deleted';
    tsDeleted.textContent = 'deleted: ' + _fmtDate(item.modifiedAt);
    tsCont.appendChild(tsDeleted);
  }
  if (item.deleted) {
    var restoreBtn = document.createElement('button');
    restoreBtn.className   = 'restore-btn';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('sc:restore-item', { detail: { id: item.id } }));
    });
    footer.appendChild(restoreBtn);
    var hardDelBtn = document.createElement('button');
    hardDelBtn.className = 'hard-del-btn';
    hardDelBtn.title     = 'Burn (permanent)';
    hardDelBtn.innerHTML = `<svg
  width="14"
  height="14"
  viewBox="0 0 14 14"
  fill="none"
  xmlns="http://www.w3.org/2000/svg">
  <path
    d="M 7 1.5
       C 8.5 2.5, 9.5 4.5, 9 6
       C 9.5 5, 11 3.5, 10.5 3.5
       C 11.5 4.5, 12 7, 11.5 9
       C 11.5 11.5, 9.5 13, 7 13
       C 4.5 13, 2.5 11.5, 2.5 9
       C 2.5 7.5, 2 5, 3.5 3.5
       C 3 3, 4 4.5, 5 6
       C 4.5 4.5, 5.5 2.5, 7 1.5 Z"
    stroke="currentColor"
    stroke-width="1.2"
    stroke-linejoin="round"
    fill="none"/>
  <path
    d="M 7 7.5
       C 8.5 8.5, 8.5 10.5, 7 11.5
       C 5.5 10.5, 5.5 8.5, 7 7.5 Z"
    fill="currentColor"/>
</svg>`;
    hardDelBtn.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('sc:hard-delete', { detail: { id: item.id } }));
    });
    footer.appendChild(hardDelBtn);
  }
  footer.appendChild(tsCont);
  // Tags row
  var tagsRow = _makeTagsRow(item, tagSelMode, selectedTags);
  footer.appendChild(tagsRow);
  el.appendChild(footer);
  // --- Swipe-to-delete ---
  _attachSwipe(el, item.id);
  // --- Outer row wrapper ---
  var rowWrap = document.createElement('div');
  rowWrap.className = 'item-row';
  var outerCbWrap = document.createElement('label');
  outerCbWrap.className = 'item-cb-outer cb-wrap';
  var outerCb = document.createElement('input');
  outerCb.type    = 'checkbox';
  outerCb.checked = selectedIds.has(item.id);
  outerCb.addEventListener('change', function () {
    document.dispatchEvent(new CustomEvent('sc:toggle-select', { detail: { id: item.id } }));
  });
  var outerCbMark = document.createElement('span');
  outerCbMark.className = 'cb-mark';
  outerCbWrap.appendChild(outerCb);
  outerCbWrap.appendChild(outerCbMark);
  var outerTrash = document.createElement('button');
  outerTrash.className = 'item-trash-outer trash-btn';
  outerTrash.title     = 'Delete';
  outerTrash.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M6 7v3.5M8 7v3.5M3 4l.8 7.2a1 1 0 001 .8h4.4a1 1 0 001-.8L11 4"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  outerTrash.addEventListener('click', function () {
    document.dispatchEvent(new CustomEvent('sc:swipe-delete', { detail: { id: item.id } }));
  });
  rowWrap.appendChild(outerCbWrap);
  rowWrap.appendChild(el);
  rowWrap.appendChild(outerTrash);
  return rowWrap;
}
/* ====== TAGS ROW ====== */
function _makeTagsRow(item, tagSelMode, selectedTags) {
  var row = document.createElement('div');
  row.className = 'tags-row' + (tagSelMode ? ' tag-sel-mode' : '');
  if (item.tags && item.tags.length > 0) {
    item.tags.forEach(function (tag) {
      var pill = document.createElement('span');
      pill.className   = 'tag-pill' + ((selectedTags && selectedTags.has(tag + '|' + item.id)) ? ' selected' : '');
      pill.textContent = tag;
      if (tagSelMode) {
        pill.addEventListener('click', function () {
          document.dispatchEvent(new CustomEvent('sc:toggle-tag-sel', {
            detail: { itemId: item.id, tag: tag }
          }));
        });
      } else {
        pill.addEventListener('click', function () {
          document.dispatchEvent(new CustomEvent('sc:filter-tag', { detail: { tag: tag } }));
        });
      }
      row.appendChild(pill);
    });
  }
  if (!item.deleted) {
    var editBtn = document.createElement('button');
    editBtn.className   = 'tags-edit-btn';
    editBtn.textContent = 'tags';
    editBtn.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('sc:open-tags', { detail: { id: item.id } }));
    });
    // Long-press on edit button enters tag-selection mode
    var _lpTagTimer = null;
    editBtn.addEventListener('pointerdown', function () {
      _lpTagTimer = setTimeout(function () {
        document.dispatchEvent(new CustomEvent('sc:enter-tag-sel-mode'));
      }, 2000);
    });
    editBtn.addEventListener('pointerup',    function () { clearTimeout(_lpTagTimer); });
    editBtn.addEventListener('pointermove',  function () { clearTimeout(_lpTagTimer); });
    editBtn.addEventListener('pointercancel',function () { clearTimeout(_lpTagTimer); });
    row.appendChild(editBtn);
  }
  return row;
}
/* ====== SWIPE TO DELETE ====== */
function _attachSwipe(el, id) {
  var startX = 0, startY = 0, dx = 0;
  var THRESHOLD = 80;
  el.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch') return;
    if (e.target.closest('button, input, [contenteditable]')) return;
    if (e.target === el || e.target.closest('.item-left') || e.target.closest('.item-right')) return;
    startX = e.clientX;
    startY = e.clientY;
    dx     = 0;
  }, { passive: true });
  el.addEventListener('pointermove', function (e) {
    dx = e.clientX - startX;
    var dy = Math.abs(e.clientY - startY);
    if (dy > 20) { dx = 0; return; } // vertical scroll, ignore
    if (dx < 0) {
      el.style.transform = 'translateX(' + Math.max(dx, -THRESHOLD * 1.5) + 'px)';
    }
  }, { passive: true });
  el.addEventListener('pointerup', function () {
    if (dx < -THRESHOLD) {
      el.style.transform = 'translateX(-100%)';
      setTimeout(function () {
        document.dispatchEvent(new CustomEvent('sc:swipe-delete', { detail: { id: id } }));
        el.style.transform = '';
      }, 180);
    } else {
      el.style.transform = '';
    }
    dx = 0;
  });
  el.addEventListener('pointercancel', function () {
    el.style.transform = '';
    dx = 0;
  });
}
/* ====== HELPERS ====== */
function _fmtDate(iso) {
  if (!iso) return '';
  try {
    var days = ['Su','M','Tu','W','Th','F','Sa'];
    var d = new Date(iso);
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return days[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1) + '/' + String(d.getFullYear()).slice(2) +
    ' ' + h + ':' + pad(d.getMinutes()) + ampm;
  } catch (e) { return iso; }
}
function _charDiff(origText, newText) {
  if (origText.length + newText.length > 6000) {
    return newText.split('').map(function (c) { return { t: c, c: 'add' }; });
  }
  var a = origText.split(''), b = newText.split('');
  var m = a.length, n = b.length;
  var dp = [];
  for (var i = 0; i <= m; i++) { dp[i] = new Array(n + 1).fill(0); }
  for (var i = 1; i <= m; i++) {
    for (var j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  var result = [], ri = m, rj = n;
  while (ri > 0 || rj > 0) {
    if (ri > 0 && rj > 0 && a[ri - 1] === b[rj - 1]) {
      result.unshift({ t: b[rj - 1], c: false }); ri--; rj--;
    } else if (rj > 0 && (ri === 0 || dp[ri][rj - 1] >= dp[ri - 1][rj])) {
      result.unshift({ t: b[rj - 1], c: 'add' }); rj--;
    } else {
      result.unshift({ t: a[ri - 1], c: 'del' }); ri--;
    }
  }
  return result;
}
function _diffToHTML(parts) {
  var out = '', inSpan = false, spanType = null;
  for (var i = 0; i < parts.length; i++) {
    var e = parts[i].t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    var type = parts[i].c;
    if (type !== spanType) {
      if (inSpan) { out += '</span>'; inSpan = false; spanType = null; }
      if (type === 'add') {
        out += '<span style="color:var(--yellow)">'; inSpan = true; spanType = 'add';
      } else if (type === 'del') {
        out += '<span style="color:var(--red);text-decoration:line-through">'; inSpan = true; spanType = 'del';
      }
    }
    out += e;
  }
  if (inSpan) out += '</span>';
  return out;
}
window.Render = { init, render, drawSelCanvas: _drawSelCanvas };

