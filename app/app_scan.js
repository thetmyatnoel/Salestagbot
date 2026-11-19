/**
 * app/app_scan.js — reading the hang tags inside the app.
 *
 * appParseTagLink(text): the item id out of whatever the QR carries. The printed tags encode
 * https://t.me/<bot>?start=S1-0042 (unchanged, no reprint); also accepted: tg://resolve?domain=<bot>&start=ID,
 * a bare S1-0042 (typed, pasted, or a USB scanner), and the app's own https://<host>/?start=ID. A bare id's shop is
 * one of CFG.SHOP_IDS (F10b: a third shop's tags read too), read when the call runs (appShopIds).
 * createAppScanner({video, onDecode, onError}): the camera into a <video>, decoded with BarcodeDetector
 * when the browser supports qr_code (Chrome Android with Play Services), else with the self-hosted
 * jsQR (app/vendor/jsQR.js, pinned 1.4.0) on a 480 px canvas at ~8 fps (iPhone, Samsung Internet
 * without Play Services, Huawei). First decode: vibrate, stop the camera, hand the text back.
 * Plain ES5: var and function only. Nothing here runs at load; browser APIs are touched inside calls.
 */
function appParseTagLink(text) {
  var s = String(text || '').trim();
  if (!s) return null;
  var m = /[?&#]start=([A-Za-z0-9_-]{1,64})/i.exec(s);
  if (m) return m[1].toUpperCase();
  // A bare id: a shop of CFG.SHOP_IDS, then four digits, with or without the dash and spaces (s1 0042 is S1-0042).
  var b = /^([A-Za-z][A-Za-z0-9]*?)\s*-?\s*(\d{4})$/.exec(s), shop = b ? b[1].toUpperCase() : '';
  if (b && appShopIds().some(function (id) { return id.toUpperCase() === shop; })) return shop + '-' + b[2];
  return null;
}
/** The shop ids of CFG.SHOP_IDS a tag id can start with (letters and digits only), read at each call. */
function appShopIds() {
  var ids = typeof CFG !== 'undefined' && CFG.SHOP_IDS ? CFG.SHOP_IDS : [];
  return ids.map(String).filter(function (id) { return /^[A-Za-z0-9]+$/.test(id); });
}

/** 'barcode' (native), 'jsqr' (self-hosted decoder present) or 'none'. */
function appQrSupport() {
  var hasJs = typeof jsQR === 'function';
  if (typeof BarcodeDetector === 'undefined' || typeof BarcodeDetector.getSupportedFormats !== 'function') {
    return Promise.resolve(hasJs ? 'jsqr' : 'none');
  }
  return Promise.resolve().then(function () { return BarcodeDetector.getSupportedFormats(); }).then(function (formats) {
    if (formats && formats.indexOf('qr_code') >= 0) return 'barcode';
    return hasJs ? 'jsqr' : 'none';
  }, function () { return hasJs ? 'jsqr' : 'none'; });
}

function createAppScanner(opts) {
  opts = opts || {};
  var video = opts.video;
  var canvas = opts.canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  // holdMs (round 6, revision 2, U2): set while a form owns the camera; a tag held in view is read once.
  var sc = { running: false, mode: null, hasTorch: false, torchOn: false, stream: null, track: null, lastDecode: '', lastDecodeAt: 0, frames: 0, holdMs: null };
  var timer = null, detector = null, ctx2d = null, busy = false;
  function fail(code, err) {
    sc.stop();
    if (opts.onError) { try { opts.onError(code, err); } catch (ignore) {} }
  }
  function decoded(text) {
    var at = Date.now();
    // With holdMs: a repeat of the last text inside holdMs of the last time it was SEEN refreshes that time and is dropped
    // silently (no buzz, no stop). Without it: today's 2000 ms rule exactly.
    if (sc.holdMs && text === sc.lastDecode && at - sc.lastDecodeAt < sc.holdMs) { sc.lastDecodeAt = at; return; }
    if (text === sc.lastDecode && at - sc.lastDecodeAt < 2000) return;
    sc.lastDecode = text;
    sc.lastDecodeAt = at;
    if (typeof navigator !== 'undefined' && navigator.vibrate) { try { navigator.vibrate(60); } catch (ignore) {} }
    sc.stop();
    if (opts.onDecode) { try { opts.onDecode(text); } catch (ignore) {} }
  }
  function tick() {
    if (!sc.running) return;
    var fps = sc.mode === 'barcode' ? 10 : 8;
    timer = setTimeout(tick, Math.round(1000 / fps));
    if (busy || !video || video.readyState < 2) return;
    sc.frames++;
    if (sc.mode === 'barcode' && detector) {
      busy = true;
      detector.detect(video).then(function (codes) {
        busy = false;
        if (codes && codes.length && codes[0].rawValue) decoded(String(codes[0].rawValue));
      }, function () { busy = false; });
      return;
    }
    if (sc.mode !== 'jsqr' || !canvas) return;
    var vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    if (!vw || !vh) return;
    var scale = Math.min(1, 480 / Math.max(vw, vh));
    var w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (!ctx2d) ctx2d = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
    try {
      ctx2d.drawImage(video, 0, 0, w, h);
      var img = ctx2d.getImageData(0, 0, w, h);
      var code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code && code.data) decoded(String(code.data));
    } catch (ignore) {}
  }
  sc.start = function () {
    if (sc.running) return Promise.resolve(sc.mode);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fail('none', null);
      return Promise.resolve('none');
    }
    sc.running = true;
    return appQrSupport().then(function (mode) {
      sc.mode = mode;
      if (mode === 'none') { fail('none', new Error('no QR decoder')); return 'none'; }
      if (mode === 'barcode') { try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (err) { sc.mode = typeof jsQR === 'function' ? 'jsqr' : 'none'; } }
      var constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
      return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
        if (!sc.running) { stream.getTracks().forEach(function (tr) { tr.stop(); }); return sc.mode; }
        sc.stream = stream;
        sc.track = stream.getVideoTracks()[0] || null;
        try {
          var caps = sc.track && sc.track.getCapabilities ? sc.track.getCapabilities() : {};
          sc.hasTorch = !!(caps && caps.torch);
        } catch (ignore) { sc.hasTorch = false; }
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        var played = video.play ? video.play() : null;
        return Promise.resolve(played).then(function () { tick(); return sc.mode; }, function () { tick(); return sc.mode; });
      }, function (err) {
        var name = err && err.name;
        fail(name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'denied'
          : (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError' ? 'none' : 'error'), err);
        return 'none';
      });
    });
  };
  sc.stop = function () {
    sc.running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (sc.stream) { try { sc.stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (ignore) {} }
    sc.stream = null;
    sc.track = null;
    sc.torchOn = false;
    if (video) { try { video.srcObject = null; } catch (ignore) {} }
  };
  sc.toggleTorch = function () {
    if (!sc.track || !sc.hasTorch || !sc.track.applyConstraints) return Promise.resolve(false);
    var want = !sc.torchOn;
    return sc.track.applyConstraints({ advanced: [{ torch: want }] }).then(function () { sc.torchOn = want; return want; }, function () { return sc.torchOn; });
  };
  /** Decode one still image (a photo of a tag) with jsQR; for tests and the keypad fallback. */
  sc.decodeImageData = function (data, w, h) {
    if (typeof jsQR !== 'function') return null;
    var code = jsQR(data, w, h, { inversionAttempts: 'dontInvert' });
    return code && code.data ? String(code.data) : null;
  };
  sc.decoded = decoded;            // what a decoded frame calls (the Node checks feed it directly)
  return sc;
}
