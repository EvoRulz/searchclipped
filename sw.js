/* sw.js — SearchClipped Service Worker */
'use strict';
var CACHE_NAME = 'searchclipped-v164';
var PRECACHE = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './state.js',
  './permissions.js',
  './clipboard.js',
  './search.js',
  './render.js',
  './modals.js',
  './items.js',
  './app.js',
  './manifest.webmanifest',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap'
];
/* ===== INSTALL — cache shell ===== */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});
/* ===== ACTIVATE — purge old caches ===== */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k)   { return caches.delete(k);  })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});
/* ===== FETCH — cache-first for shell, network-first for fonts ===== */
self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  // Skip non-GET and chrome-extension requests
  if (e.request.method !== 'GET') return;
  if (url.startsWith('chrome-extension://')) return;
  // Network-first for Google Fonts (they update)
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var clone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(e.request, clone);
        });
        return res;
      }).catch(function () {
        return caches.match(e.request);
      })
    );
    return;
  }
  // Cache-first for everything else (app shell)
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (res) {
        // Only cache same-origin responses
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        var clone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(e.request, clone);
        });
        return res;
      });
    })
  );
});
