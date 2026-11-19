/**
 * app/app_media.js — photos and voice on the phone.
 *
 * appDownscalePhoto(file, maxPx): a capture from <input type=file capture=environment> scaled on a canvas
 * to 1280 px (JPEG ~150-250 KB) -> {blob, dataUrl, width, height, mime}; the Drive upload rides the
 * queued AI job at sync. appBlobToBase64(blob) for the api=ai body.
 * createAppRecorder(): hold-to-talk MediaRecorder with mime negotiation (Chrome audio/webm;codecs=opus,
 * Safari audio/mp4) capped at 30 s. The UI shows the microphone only when the server Setting
 * app_voice is TRUE (voice stays in Telegram for the pilot, SPEC section 8).
 * Plain ES5: var and function only. Browser APIs are touched only inside the functions.
 */
var APP_PHOTO_MAX_PX = 1280;
var APP_PHOTO_QUALITY = 0.82;
var APP_VOICE_MAX_MS = 30000;

function appBlobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    if (!blob) return resolve('');
    if (typeof FileReader === 'undefined') return reject(new Error('FileReader unavailable'));
    var reader = new FileReader();
    reader.onload = function () {
      var s = String(reader.result || '');
      var i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = function () { reject(reader.error || new Error('read failed')); };
    reader.readAsDataURL(blob);
  });
}

function appLoadImage(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) { return bmp; }, function () { return appLoadImageElement(file); });
  }
  return appLoadImageElement(file);
}
function appLoadImageElement(file) {
  return new Promise(function (resolve, reject) {
    if (typeof Image === 'undefined' || typeof URL === 'undefined') return reject(new Error('no Image'));
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

/** Downscale to maxPx on the long side; resolves {blob, dataUrl, width, height, mime}. */
function appDownscalePhoto(file, maxPx, quality) {
  maxPx = maxPx || APP_PHOTO_MAX_PX;
  quality = quality || APP_PHOTO_QUALITY;
  return appLoadImage(file).then(function (img) {
    var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    var scale = Math.min(1, maxPx / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    if (img.close) { try { img.close(); } catch (ignore) {} }
    var dataUrl = canvas.toDataURL('image/jpeg', quality);
    return new Promise(function (resolve) {
      var finish = function (blob) { resolve({ blob: blob, dataUrl: dataUrl, width: cw, height: ch, mime: 'image/jpeg' }); };
      if (canvas.toBlob) canvas.toBlob(function (blob) { finish(blob || appDataUrlToBlob(dataUrl)); }, 'image/jpeg', quality);
      else finish(appDataUrlToBlob(dataUrl));
    });
  });
}

function appDataUrlToBlob(dataUrl) {
  var i = dataUrl.indexOf(','), head = dataUrl.slice(0, i), b64 = dataUrl.slice(i + 1);
  var mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
  var bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return new Blob([bytes], { type: mime });
}

/** The first recording mime this browser can produce, in the order Gemini is most likely to accept. */
function appPickAudioMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac', 'audio/wav'];
  for (var i = 0; i < list.length; i++) { try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (ignore) {} }
  return '';
}

/** Hold-to-talk: start() on press, stop() on release -> {blob, mime, durationMs}; cancel() discards. */
function createAppRecorder(opts) {
  opts = opts || {};
  var rec = { supported: typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), recording: false, startedAt: 0, mime: '' };
  var recorder = null, stream = null, chunks = [], stopResolve = null, stopReject = null, cap = null, cancelled = false;
  function cleanup() {
    if (cap) { clearTimeout(cap); cap = null; }
    if (stream) { try { stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (ignore) {} }
    stream = null;
    recorder = null;
    rec.recording = false;
  }
  rec.start = function () {
    if (!rec.supported) return Promise.reject(new Error('unsupported'));
    if (rec.recording) return Promise.resolve();
    cancelled = false;
    chunks = [];
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (s) {
      stream = s;
      var mime = appPickAudioMime() || '';
      rec.mime = mime;
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        var blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
        var out = { blob: blob, mime: blob.type || mime, durationMs: Date.now() - rec.startedAt };
        var resolve = stopResolve, wasCancelled = cancelled;
        stopResolve = null;
        stopReject = null;
        cleanup();
        if (resolve) resolve(wasCancelled ? null : out);
      };
      recorder.onerror = function (e) { var reject = stopReject; cleanup(); if (reject) reject(e.error || new Error('recorder error')); };
      recorder.start(250);
      rec.recording = true;
      rec.startedAt = Date.now();
      cap = setTimeout(function () { if (rec.recording) rec.stop(); }, opts.maxMs || APP_VOICE_MAX_MS);
      if (opts.onStart) { try { opts.onStart(); } catch (ignore) {} }
    });
  };
  rec.stop = function () {
    if (!rec.recording || !recorder) return Promise.resolve(null);
    return new Promise(function (resolve, reject) {
      stopResolve = resolve;
      stopReject = reject;
      try { recorder.stop(); } catch (err) { cleanup(); reject(err); }
    });
  };
  rec.cancel = function () { cancelled = true; return rec.stop(); };
  return rec;
}
