'use strict';
/*
 * clipboard.js
 * Handles writing text/plain + text/html to clipboard.
 * Falls back to text/plain only if text/html is unsupported.
 * Image items use Web Share API instead of clipboard.
 * Exported on window.Clip
 */

/*
 * writeItem(item) → Promise<void>
 * item: { text, html, imageId }
 * If imageId is set → share image via Web Share API.
 * Otherwise        → write text to clipboard (html + plain, or plain only).
 */
async function writeItem(item) {
  if (item.imageId) {
    return shareImage(item);
  }
  return writeText(item.text, item.html);
}

async function writeText(plain, html) {
  var allowed = await Perms.request(
    'clipboard-write',
    'Allow SearchClipped to write to your clipboard?'
  );
  if (!allowed) return;

  // Try ClipboardItem with both types
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    try {
      var data = {};
      if (html && html.trim()) {
        data['text/html']  = new Blob([html],  { type: 'text/html' });
      }
      data['text/plain'] = new Blob([plain], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem(data)]);
      return;
    } catch (e) {
      // Fall through to plain-text fallback
      console.warn('clipboard.write with html failed, falling back', e);
    }
  }

  // Plain-text fallback
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(plain);
      return;
    } catch (e) {
      console.warn('clipboard.writeText failed', e);
    }
  }

  // execCommand fallback (older WebViews)
  try {
    var ta = document.createElement('textarea');
    ta.value = plain;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) {
    console.error('All clipboard methods failed', e);
  }
}

/*
 * writeBulk(items) → Promise<void>
 * Concatenates text of all items separated by newlines.
 */
async function writeBulk(items) {
  var textParts = items.map(function (i) { return i.text || ''; });
  var htmlParts = items.map(function (i) { return i.html || i.text || ''; });
  var plainAll  = textParts.join('\n\n');
  var htmlAll   = '<div>' + htmlParts.join('</div><hr><div>') + '</div>';
  return writeText(plainAll, htmlAll);
}

async function shareImage(item) {
  if (!navigator.share) {
    alert('Web Share API not supported on this device/browser.');
    return;
  }
  var allowed = await Perms.request(
    'share',
    'Allow SearchClipped to share content using the system share sheet?'
  );
  if (!allowed) return;

  try {
    var blob = await DB.loadImage(item.imageId);
    if (!blob) { alert('Image not found in storage.'); return; }
    var file = new File([blob], 'image.' + _extFromBlob(blob), { type: blob.type });
    await navigator.share({ files: [file], title: item.text || 'Shared image' });
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Share failed', e);
      alert('Share failed: ' + e.message);
    }
  }
}

function _extFromBlob(blob) {
  var m = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  return m[blob.type] || 'bin';
}

window.Clip = { writeItem, writeText, writeBulk, shareImage };
