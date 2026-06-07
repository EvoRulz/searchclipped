'use strict';
/*
 * search.js
 * Filtering + sorting pipeline.
 * Returns { filtered: Item[], rest: Item[] } where:
 *   filtered = items matched by the search query (shown at top)
 *   rest     = remaining items in their normal sort order
 * Exported on window.Search
 */
/*
 * getDisplayList(state, query, opts) → { filtered, rest }
 *
 * opts: {
 *   showDeleted:   boolean,
 *   hideUndeleted: boolean,
 *   tagsOnly:      boolean,
 *   starFilter:    boolean,
 * }
 */
function getDisplayList(state, query, opts) {
  opts = opts || {};
  // 1. Build candidate pool
  var pool = state.items.filter(function (item) {
    if (item.deleted && !opts.showDeleted)  return false;
    if (!item.deleted && opts.hideUndeleted) return false;
    return true;
  });
  // 2. Sort pool by current mode
  pool = _sort(pool, state.sortMode);
  // 3. Star group: if starFilter, split starred to front
  var starred = [];
  var normal  = [];
  if (opts.starFilter) {
    pool.forEach(function (i) {
      if (i.starred) starred.push(i);
      else           normal.push(i);
    });
  } else {
    normal = pool;
  }
  // 4. Apply search
  var q = (query || '').trim().toLowerCase();
  if (!q) {
    return { filtered: [], rest: starred.concat(normal) };
  }
  var filteredStarred = [], restStarred   = [];
  var filteredNormal  = [], restNormal    = [];
  starred.forEach(function (item) {
    var p = _matches(item, q, opts);
    if (p) { item._matchPriority = p; filteredStarred.push(item); }
    else   restStarred.push(item);
  });
  normal.forEach(function (item) {
    var p = _matches(item, q, opts);
    if (p) { item._matchPriority = p; filteredNormal.push(item); }
    else   restNormal.push(item);
  });
  filteredStarred.sort(function (a, b) { return a._matchPriority - b._matchPriority; });
  filteredNormal.sort(function (a, b)  { return a._matchPriority - b._matchPriority; });
  var filtered = filteredStarred.concat(filteredNormal);
  var rest     = restStarred.concat(restNormal);
  return { filtered: filtered, rest: rest };
}
function _matches(item, q, opts) {
  var si = opts.searchItems  !== false;
  var st = opts.searchTitles !== false;
  var sg = opts.searchTags   !== false;
  if (!si && !st && !sg) return 0;
  var hasTitle = (item.title || '').trim().length > 0;
  function _wb(text, idx) {
    if (idx === -1) return null;
    var before = idx === 0 || /\W/.test(text[idx - 1]);
    var after  = (idx + q.length) >= text.length || /\W/.test(text[idx + q.length]);
    if (before && after) return 'whole';
    if (before || after) return 'startend';
    return 'mid';
  }
  function _findBest(text, qLower) {
    var lowerIdx = text.toLowerCase().indexOf(qLower);
    if (lowerIdx === -1) return null;
    var exactIdx = text.indexOf(q);
    var wb = _wb(text, lowerIdx);
    var isExact = exactIdx === lowerIdx;
    return { idx: lowerIdx, wb: wb, exact: isExact };
  }
  function _findBestTag(tags) {
    var result = null;
    tags.forEach(function (t) {
      var lowerIdx = t.toLowerCase().indexOf(q);
      if (lowerIdx === -1) return;
      var exactIdx = t.indexOf(q);
      var wb = _wb(t, lowerIdx);
      var isExact = exactIdx === lowerIdx;
      var candidate = { idx: lowerIdx, wb: wb, exact: isExact };
      if (result === null || _slotOf(candidate, 'tag') < _slotOf(result, 'tag') ||
          (_slotOf(candidate, 'tag') === _slotOf(result, 'tag') && candidate.idx < result.idx)) {
        result = candidate;
      }
    });
    return result;
  }
  // slot: lower = higher priority
  // whole word tier: 0-7, startend tier: 8-15 (title/text/tag), mid tier: 16-23
  // within each boundary tier: title=0, textNoTitle=1, textHasTitle=2, tag=3, then *2 for inexact
  function _slotOf(m, field) {
    if (!m) return 999999;
    var wbBase = m.wb === 'whole' ? 0 : m.wb === 'startend' ? 8 : 16;
    var fieldBase;
    if (field === 'title')       fieldBase = 0;
    else if (field === 'textNT') fieldBase = 2;
    else if (field === 'textHT') fieldBase = 4;
    else                         fieldBase = 6; // tag
    var exactBonus = m.exact ? 0 : 1;
    return wbBase + fieldBase + exactBonus;
  }
  var titleM = (st && hasTitle) ? _findBest(item.title || '', q) : null;
  var textM  = si               ? _findBest(item.text  || '', q) : null;
  var tagM   = sg               ? _findBestTag(item.tags || [])  : null;
  var textField = hasTitle ? 'textHT' : 'textNT';
  var best = null;
  function _consider(m, field) {
    if (!m) return;
    var slot = _slotOf(m, field);
    var score = slot * 100000 + m.idx;
    if (best === null || score < best) best = score;
  }
  _consider(titleM, 'title');
  _consider(textM,  textField);
  _consider(tagM,   'tag');
  return best === null ? 0 : best;
}
function _sort(items, mode) {
  if (mode === 'created' || mode === 'created-desc') {
    return items.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }
  if (mode === 'created-asc') {
    return items.slice().sort(function (a, b) {
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }
  if (mode === 'modified' || mode === 'modified-desc') {
    return items.slice().sort(function (a, b) {
      return new Date(b.modifiedAt) - new Date(a.modifiedAt);
    });
  }
  if (mode === 'modified-asc') {
    return items.slice().sort(function (a, b) {
      return new Date(a.modifiedAt) - new Date(b.modifiedAt);
    });
  }
  if (mode === 'deleted-desc') {
    return items.slice().sort(function (a, b) {
      var aT = a.deleted ? new Date(a.modifiedAt).getTime() : 0;
      var bT = b.deleted ? new Date(b.modifiedAt).getTime() : 0;
      return bT - aT;
    });
  }
  if (mode === 'deleted-asc') {
    return items.slice().sort(function (a, b) {
      var aT = a.deleted ? new Date(a.modifiedAt).getTime() : 0;
      var bT = b.deleted ? new Date(b.modifiedAt).getTime() : 0;
      return aT - bT;
    });
  }
  if (mode === 'restored-desc') {
    return items.slice().sort(function (a, b) {
      var aT = a.restoredAt ? new Date(a.restoredAt).getTime() : 0;
      var bT = b.restoredAt ? new Date(b.restoredAt).getTime() : 0;
      return bT - aT;
    });
  }
  if (mode === 'restored-asc') {
    return items.slice().sort(function (a, b) {
      var aT = a.restoredAt ? new Date(a.restoredAt).getTime() : 0;
      var bT = b.restoredAt ? new Date(b.restoredAt).getTime() : 0;
      return aT - bT;
    });
  }
  // id sorts (and bump fallback)
  if (mode === 'id-desc') {
    return items.slice().sort(function (a, b) {
      return b.bumpOrder - a.bumpOrder;
    });
  }
  return items.slice().sort(function (a, b) {
    return a.bumpOrder - b.bumpOrder;
  });
}
window.Search = { getDisplayList };

