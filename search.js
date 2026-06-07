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
  var INF = 999999;
  function _wbBonus(text, idx) {
    if (idx === -1) return 0;
    var before = idx === 0 || /\W/.test(text[idx - 1]);
    var after  = (idx + q.length) >= text.length || /\W/.test(text[idx + q.length]);
    if (before && after) return -0.8 * INF;
    if (before || after) return -0.5 * INF;
    return 0;
  }
  var titleIdx = (st && hasTitle) ? (item.title || '').toLowerCase().indexOf(q) : -1;
  var textIdx  = si               ? (item.text  || '').toLowerCase().indexOf(q) : -1;
  var textWordBonus  = _wbBonus(item.text  || '', textIdx);
  var titleWordBonus = _wbBonus(item.title || '', titleIdx);
  var tagIdx = sg ? (function () {
    var best = -1;
    (item.tags || []).forEach(function (t) {
      var i = t.toLowerCase().indexOf(q);
      if (i !== -1 && (best === -1 || i < best)) best = i;
    });
    return best;
  })() : -1;
  var best = null;
  if (titleIdx !== -1) {
    var score = 1 * INF + titleIdx + titleWordBonus;
    if (best === null || score < best) best = score;
  }
  if (textIdx !== -1) {
    var base  = hasTitle ? 2 : 1;
    var score = base * INF + textIdx + textWordBonus;
    if (best === null || score < best) best = score;
  }
  if (!hasTitle && titleIdx !== -1) {
    var score = 2 * INF + titleIdx + titleWordBonus;
    if (best === null || score < best) best = score;
  }
  if (tagIdx !== -1) {
    var score = 3 * INF + tagIdx;
    if (best === null || score < best) best = score;
  }
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

