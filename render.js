'use strict';
/*
 * render.js
 * Builds/patches the item list DOM from a display list.
 * Exported on window.Render
 */
var _list      = null;
var _state     = null;
var _topBumped = null; // Set<id>
var _blobUrls  = {};   // imageId → objectURL cache
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
  imgBtn.innerHTML = '<svg width="26" height="26" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="22" height="22" rx="3" fill="currentColor" opacity="0.12"/><rect x="0.75" y="0.75" width="20.5" height="20.5" rx="2.5" stroke="currentColor" stroke-width="1.5"/><circle cx="6.5" cy="6.5" r="2.2" fill="currentColor" opacity="0.65"/><path d="M0 15.5 L6 9 L10.5 13.5 L14.5 10 L22 16.5 L22 22 L0 22 Z" fill="currentColor" opacity="0.5"/></svg>';
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
    var newTitle = (titleEl.textContent || '').trim();
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
  content.textContent     = item.text || '';
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
  });
  // Single click to copy (only when not editing)
  var _clickTimer = null;
  content.addEventListener('click', function (e) {
    if (document.activeElement === content) return; // already editing
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
  if (item.imageId) {
    var shareBtn = document.createElement('button');
    shareBtn.className   = 'share-btn';
    shareBtn.textContent = '⬆';
    shareBtn.title       = 'Share image';
    shareBtn.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('sc:share-item', { detail: { id: item.id } }));
    });
    right.appendChild(shareBtn);
  } else {
    var copyBtn = document.createElement('button');
    copyBtn.className   = 'copy-btn';
    copyBtn.title       = 'Copy';
    copyBtn.innerHTML   = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M3 10H2a1 1 0 01-1-1V2a1 1 0 011-1h7a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    copyBtn.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('sc:copy-item', { detail: { id: item.id } }));
      el.classList.add('copy-flash');
      setTimeout(function () { el.classList.remove('copy-flash'); }, 500);
    });
    right.appendChild(copyBtn);
  }
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
  var tsModified = document.createElement('span');
  tsModified.className   = 'item-ts item-ts-modified';
  tsModified.textContent = 'modified: ' + _fmtDate(item.modifiedAt);
  tsCont.appendChild(tsModified);
  if (item.deleted) {
    var tsDeleted = document.createElement('span');
    tsDeleted.className   = 'item-ts item-ts-deleted';
    tsDeleted.textContent = 'deleted: ' + _fmtDate(item.modifiedAt);
    tsCont.appendChild(tsDeleted);
  }
  footer.appendChild(tsCont);
  // Tags row
  var tagsRow = _makeTagsRow(item, tagSelMode, selectedTags);
  footer.appendChild(tagsRow);
  // Restore button for deleted items
  if (item.deleted) {
    var restoreBtn = document.createElement('button');
    restoreBtn.className   = 'restore-btn';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('sc:restore-item', { detail: { id: item.id } }));
    });
    footer.appendChild(restoreBtn);
  }
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
  outerTrash.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M6 7v3.5M8 7v3.5M3 4l.8 7.2a1 1 0 001 .8h4.4a1 1 0 001-.8L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var d = new Date(iso);
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return days[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1) + '/' + String(d.getFullYear()).slice(2) +
           ' ' + h + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ampm;
  } catch (e) { return iso; }
}
window.Render = { init, render };

