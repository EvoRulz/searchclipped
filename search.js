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
    if (_matches(item, q, opts.tagsOnly)) filteredStarred.push(item);
    else                                  restStarred.push(item);
  });
  normal.forEach(function (item) {
    if (_matches(item, q, opts.tagsOnly)) filteredNormal.push(item);
    else                                  restNormal.push(item);
  });
  var filtered = filteredStarred.concat(filteredNormal);
  var rest     = restStarred.concat(restNormal);
  return { filtered: filtered, rest: rest };
}
function _matches(item, q, tagsOnly) {
  if (tagsOnly) {
    return item.tags.some(function (t) {
      return t.toLowerCase().includes(q);
    });
  }
  if ((item.text || '').toLowerCase().includes(q)) return true;
  if (item.tags.some(function (t) { return t.toLowerCase().includes(q); })) return true;
  return false;
}
function _sort(items, mode) {
  if (mode === 'created') {
    return items.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }
  if (mode === 'modified') {
    return items.slice().sort(function (a, b) {
      return new Date(b.modifiedAt) - new Date(a.modifiedAt);
    });
  }
  // bump (default)
  return items.slice().sort(function (a, b) {
    return a.bumpOrder - b.bumpOrder;
  });
}
window.Search = { getDisplayList };

