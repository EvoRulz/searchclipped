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
const DB_VERSION = 1;
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
window.DB = {
  openDB,
  saveImage,
  loadImage,
  deleteImage,
  getAllImageIds,
  exportAllImages,
  importImages
};

