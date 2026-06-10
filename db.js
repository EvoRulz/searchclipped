'use strict';
/*
 * db.js — IndexedDB wrapper
 * DB name : searchclipped
 * Store   : images  (keyPath: id, value: { id, blob })
 *
 * All image data lives here; localStorage holds metadata only.
 * Exported on window.DB
 */
const DB_NAME    = 'searchclipped';
const DB_VERSION = 2;
const STORE      = 'images';
let _db = null;
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('undostacks')) {
        db.createObjectStore('undostacks', { keyPath: 'id' });
      }
    };
    req.onsuccess = function (e) {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror = function (e) {
      reject(e.target.error);
    };
  });
}
async function saveImage(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req   = store.put({ id: id, blob: blob });
    req.onsuccess = function () { resolve(); };
    tx.onerror    = function (e) { reject(e.target.error); };
  });
}
async function loadImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = function (e) {
      resolve(e.target.result ? e.target.result.blob : null);
    };
    req.onerror = function (e) { reject(e.target.error); };
  });
}
async function deleteImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = function () { resolve(); };
    tx.onerror    = function (e) { reject(e.target.error); };
  });
}
async function getAllImageIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror   = function (e) { reject(e.target.error); };
  });
}
/* Returns array of { id, blob } for export */
async function exportAllImages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror   = function (e) { reject(e.target.error); };
  });
}
/* Imports array of { id, blob } — merges, does not clear existing */
async function importImages(records) {
  if (!records || !records.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (var i = 0; i < records.length; i++) {
      store.put(records[i]);
    }
    tx.oncomplete = function () { resolve(); };
    tx.onerror    = function (e) { reject(e.target.error); };
  });
}
async function saveUndoStack(type, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('undostacks', 'readwrite');
    const store = tx.objectStore('undostacks');
    const req   = store.put({ id: type, data: data });
    req.onsuccess = function () { resolve(); };
    tx.onerror    = function (e) { reject(e.target.error); };
  });
}
async function loadUndoStack(type) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('undostacks', 'readonly');
    const req = tx.objectStore('undostacks').get(type);
    req.onsuccess = function (e) { resolve(e.target.result ? e.target.result.data : null); };
    req.onerror   = function (e) { reject(e.target.error); };
  });
}
async function saveSearchHistory(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('undostacks', 'readwrite');
    const store = tx.objectStore('undostacks');
    const req   = store.put({ id: 'searchHistory', data: entries });
    req.onsuccess = function () { resolve(); };
    tx.onerror    = function (e) { reject(e.target.error); };
  });
}
async function loadSearchHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('undostacks', 'readonly');
    const req = tx.objectStore('undostacks').get('searchHistory');
    req.onsuccess = function (e) { resolve(e.target.result ? e.target.result.data : []); };
    req.onerror   = function (e) { reject(e.target.error); };
  });
}
async function saveCopyCounts(counts) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('undostacks', 'readwrite');
    const store = tx.objectStore('undostacks');
    const req   = store.put({ id: 'copyCounts', data: counts });
    req.onsuccess = function () { resolve(); };
    tx.onerror    = function (e) { reject(e.target.error); };
  });
}
async function loadCopyCounts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('undostacks', 'readonly');
    const req = tx.objectStore('undostacks').get('copyCounts');
    req.onsuccess = function (e) { resolve(e.target.result ? e.target.result.data : {}); };
    req.onerror   = function (e) { reject(e.target.error); };
  });
}
window.DB = {
  openDB,
  saveImage,
  loadImage,
  deleteImage,
  getAllImageIds,
  exportAllImages,
  importImages,
  saveUndoStack,
  loadUndoStack,
  saveSearchHistory,
  loadSearchHistory,
  saveCopyCounts,
  loadCopyCounts
};

