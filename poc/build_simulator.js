/**
 * poc/build_simulator.js — inlines the shared core + simulator scripts into one self-contained HTML file:
 * poc/dist/pos-simulator.html (round 5, simulator v2, spec 6.5).
 *
 *   node poc/build_simulator.js
 *
 * 1. FILES (the core in the tools/build_app.js order + core_orders, then the simulator files) are inlined as one
 *    <script> each at the template marker <!-- @scripts -->, each under a banner "/* ===== <file> ===== *\/".
 * 2. The real app runs in one <iframe srcdoc> per device (APP is one global per document and app.css redefines the
 *    page's globals). Its document is built here: the #app shell of app/index.html (no HTML comment), the Google Fonts
 *    link, app/app.css inlined, a small prelude (the transport to the page's fake server, the demo clock, page errors),
 *    FRAME_FILES (the nine core files + the eleven app files, build_app order) in one <script>, and the boot script. No
 *    config.js, no jsQR (a click on the rack is the scan). That document is embedded as
 *    var SIM_APP_SRCDOC = "<JSON string>"; at the marker <!-- @appframe -->, with every </script written <\/script.
 * 3. No file may contain "</script" (it would end the outer block) and the frame document carries no "<!--" (inside
 *    the outer <script> a "<!--" followed by "<script" puts the HTML tokenizer into its double-escaped state, where
 *    "</script>" no longer closes the block). Prints the size.
 * Node only: modern JS is fine here.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORE = ['core_config', 'core_burmese', 'core_messages', 'core_ai_prompt', 'core_ledger', 'core_report', 'core_bot', 'core_sync', 'core_orders']
  .map(f => 'apps-script/' + f + '.js');
const FILES = CORE.concat(['sim_mock_ai', 'sim_ports', 'sim_seed', 'sim_sync', 'sim_tours', 'sim_ui'].map(f => 'poc/' + f + '.js'));
const FRAME_FILES = CORE.concat(['app_i18n', 'app_store', 'app_ports', 'app_sync', 'app_scan', 'app_media', 'app_icons', 'app_ui', 'app_forms', 'app_sketch', 'app_screens'].map(f => 'app/' + f + '.js'));
const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+Myanmar:wght@400;600&display=swap';

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function refuseScriptEnd(name, text) { if (/<\/script/i.test(text)) throw new Error(name + ' contains "</script", cannot inline'); }

/* ---------- the frame's own scripts (ES5: they run in every browser the page runs in) ---------- */

/**
 * Runs before the bundle. The transport: parent.SIM.server.handle when the page is reachable (parent.SIM.ping()),
 * else a postMessage round trip ({simFrame: 'call', id, api, body} answered by {simPage: 'reply', id, res | error}).
 * The demo clock: this device's wall clock follows the page's offset (⏩ moves every device at once, so the app never
 * sees a clock skew). Page errors go to the page's window.SIM_ERRORS.
 */
const PRELUDE = `(function () {
  var P = null;
  try { if (window.parent && window.parent !== window && window.parent.SIM && window.parent.SIM.ping() === 'pong') P = window.parent.SIM; } catch (e) { P = null; }
  var pending = {}, nextId = 1, offsetMs = 0;
  function post(msg) { try { window.parent.postMessage(msg, '*'); } catch (e) {} }
  function report(text) {
    if (P) { try { P.frameError(window, text); return; } catch (e) {} }
    post({ simFrame: 'error', message: text });
  }
  window.addEventListener('error', function (e) { report(String(e.message || 'error') + (e.lineno ? ' (line ' + e.lineno + ')' : '')); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; report('unhandled rejection: ' + String((r && r.stack) || r)); });
  var RealDate = Date;
  function off() {
    if (P) { try { return Number(window.parent.SIM.world.clockOffsetMs) || 0; } catch (e) { return 0; } }
    return offsetMs;
  }
  function SimDate(a, b, c, d, h, m, s) {
    var n = arguments.length;
    if (!(this instanceof SimDate)) return new RealDate(RealDate.now() + off()).toString();
    if (n === 0) return new RealDate(RealDate.now() + off());
    if (n === 1) return new RealDate(a);
    return new RealDate(a, b, n > 2 ? c : 1, n > 3 ? d : 0, n > 4 ? h : 0, n > 5 ? m : 0, n > 6 ? s : 0);
  }
  SimDate.prototype = RealDate.prototype;
  SimDate.now = function () { return RealDate.now() + off(); };
  SimDate.parse = RealDate.parse;
  SimDate.UTC = RealDate.UTC;
  window.Date = SimDate;
  // A request in flight while the demo clock jumps (a ⏩ tap during the latency) is answered as if the jump came just
  // after it: its clientTime moves with the jump for the server and the serverTime of the reply moves back for the app,
  // so neither side sees a skew (no clock_skew row, no app_clock warning, no learned offset of days).
  function shift(iso, ms) { var t = new RealDate(iso).getTime(); return isNaN(t) ? iso : new RealDate(t + ms).toISOString(); }
  var transport = P ? function (api, body) {
    var o0 = off();
    return new Promise(function (res, rej) { setTimeout(function () {
      try {
        var jump = off() - o0;
        if (jump && body && typeof body.clientTime === 'string') body.clientTime = shift(body.clientTime, jump);
        var r = window.parent.SIM.server.handle(api, body);
        if (jump && r && typeof r.serverTime === 'string') r.serverTime = shift(r.serverTime, -jump);
        res(r);
      } catch (e) { rej(e); } }, window.parent.SIM.latency); });
  } : function (api, body) {
    return new Promise(function (res, rej) { var id = nextId++; pending[id] = { res: res, rej: rej }; post({ simFrame: 'call', id: id, api: api, body: body, o: offsetMs }); });
  };
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data || {};
    if (d.simPage === 'reply' && pending[d.id]) {
      var p = pending[d.id];
      delete pending[d.id];
      if (d.error) p.rej(new Error(d.error)); else p.res(d.res);
    } else if (d.simPage === 'cmd' && window.SIM_FRAME) {
      window.SIM_FRAME.cmd(d.c || {});
    }
  });
  window.SIM_FRAME_PRELUDE = { direct: !!P, transport: transport, post: post, setOffset: function (ms) { offsetMs = Number(ms) || 0; } };
})();`;

/**
 * Runs after the bundle: SIM_FRAME (what the page asks of this device: a snapshot, a command) and bootApp, the dev
 * page's call with parent. in front (app/dev/index.html), the in-page server's transport, online() always true and
 * noHistory (round 6, 13.4: the frame never touches the page's history; its own back pops the stack directly).
 * Round 6: the snapshot carries the open form (appFormSnap: its lines, its first problem's key and the last control
 * used), the navigation stack's kinds and the screen's argument; the commands form, set, photo and close drive the
 * app's forms (spec 8.2); hot repaints an open form; screen goes through appNavReset (13.4); mark and pick also
 * match a button's plain text (appPlain, 13.1: the app shows its labels without their emoji).
 * Over postMessage (no parent.SIM) the page keeps the last snapshot it was sent: the ready message carries one and the
 * labels of every APP_MSG key, every event carries one, a watcher posts one whenever it changes, and the 'snap' command
 * answers with a fresh one after the commands sent before it.
 * confirm() (handovers 13 and 15): the claude.ai artifact viewer may sandbox the page without allow-modals, and then a
 * frame's confirm() is ignored and returns false at once (the srcdoc child inherits the sandbox): the ← of a changed
 * form, the measurement form's close and the drawing's clear would do nothing. The frame's confirm is wrapped: a false
 * that comes back in under 30 ms is no person's answer and counts as OK; a real answer is left as it is. The command
 * modals (on: false) puts an instant false under the wrapper, the way such a host answers (SIM.smoke); on: true puts the
 * browser's own confirm back.
 */
const BOOT = `(function () {
  var pre = window.SIM_FRAME_PRELUDE;
  function lastWith(data) {
    var list = APP.store.chat;
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i], rows = (m && m.from === 'bot' && m.keyboard) || [];
      for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) if (rows[r][c].callback_data === data) return m;
    }
    return null;
  }
  /** Does this element's text hold the label, as written or as the app shows it (appPlain: no emoji, 13.1)? */
  function hasText(el, text) {
    var s = el.textContent || '';
    if (s.indexOf(text) >= 0) return true;
    var p = typeof appPlain === 'function' ? appPlain(String(text)) : '';
    return !!p && s.indexOf(p) >= 0;
  }
  function mark(sel, text) {
    var old = document.querySelectorAll('.simhot');
    for (var i = 0; i < old.length; i++) old[i].className = old[i].className.replace(/\\s*\\bsimhot\\b/g, '');
    var hits = [];
    if (sel) { var q = document.querySelectorAll(sel); for (var j = 0; j < q.length; j++) hits.push(q[j]); }
    if (text) { var b = document.querySelectorAll('button'); for (var k = 0; k < b.length; k++) if (hasText(b[k], text)) hits.push(b[k]); }
    for (var h = 0; h < hits.length; h++) hits[h].className += ' simhot';
    return hits.length;
  }
  /** The first element of sel (with key: the first whose text holds this frame's label of that key, or its plain text). */
  function pick(sel, key) {
    var q = document.querySelectorAll(sel || 'button'), text = key ? window.SIM_FRAME.label(key) : '';
    for (var i = 0; i < q.length; i++) if (!text || hasText(q[i], text)) return q[i];
    return null;
  }
  /** Every APP_MSG key's label in this frame (the label rule): the page has no APP_MSG and, without parent.SIM, no frame to ask. */
  function labels() {
    var o = {};
    if (typeof APP_MSG === 'undefined' || !window.APP) return o;
    for (var k in APP_MSG) if (Object.prototype.hasOwnProperty.call(APP_MSG, k)) o[k] = window.SIM_FRAME.label(k);
    return o;
  }
  // A host that sandboxes the page without allow-modals answers confirm() with an instant false: no person answers in
  // under 30 ms, so such a false counts as OK (the app's ← of a changed form, the measurement close, the sketch clear).
  var nativeConfirm = window.confirm;
  function msNow() { var p = window.performance; return p && typeof p.now === 'function' ? p.now() : new Date().getTime(); }
  function useConfirm(ask) {
    if (typeof ask !== 'function') return;
    window.confirm = function (q) { var t0 = msNow(), yes = ask.call(window, q); return !!yes || msNow() - t0 < 30; };
  }
  useConfirm(nativeConfirm);
  window.SIM_FRAME = {
    snap: function () {
      if (!window.APP) return { ready: false, deviceId: '', screen: '', last: null, measForm: false, code: '', label: '', letter: '', chip: '', chipText: '', error: '', form: null, nav: [], screenArg: null, ask: '' };
      var m = APP.phone.sim.lastBot(), ci = document.getElementById('codeInput'), chip = APP.sync.chipState();
      return { ready: true, deviceId: APP.store.meta.deviceId || '', screen: APP.screen, label: APP.store.meta.label || '', letter: APP.store.meta.receiptLetter || '',
        last: m ? { id: m.id, text: m.text || '', keyboard: m.keyboard || [] } : null, measForm: !!APP.measForm, code: ci ? ci.value : '',
        chip: chip.kind, chipText: chip.text, error: APP.enrollError || '', busy: !!APP.enrollBusy,
        form: typeof appFormSnap === 'function' ? appFormSnap() : null, nav: (APP.nav || []).map(function (l) { return l.kind; }),
        screenArg: APP.screenArg === undefined ? null : APP.screenArg,
        ask: typeof appAsking === 'function' ? appAsking() : '' };   // the app's own question sheet that is open ('leave', 'undo', ...), or ''
    },
    label: function (key) { return String(t(APP ? APP.phone.ports : null, key)).split('{')[0].replace(/^\\s+|\\s+$/g, ''); },
    cmd: function (c) {
      if (!window.APP) return false;
      switch (c.op) {
        case 'hot': window.SIM_HOT = c.hot || ''; appRender(); if (APP.form && typeof appFormRepaint === 'function') appFormRepaint(APP.form); return true;
        case 'mark': return mark(c.sel, c.text);
        case 'open': appOpenTagId(c.id); return true;
        case 'menu': appOpenMenu(); return true;
        case 'screen': appNavReset(); if (String(c.screen || 'home') !== 'home' && APP.store.meta.deviceId) appOpenScreen(String(c.screen)); else appRender(); notify({ kind: 'screen' }); return true;   // every layer closed (13.4), then that page
        case 'tap': var m = lastWith(c.data) || APP.phone.sim.lastBot(); if (!m) return false; APP.phone.sim.tap(m.id, c.data); return true;
        case 'text': appCloseOverlay(); appSendText(String(c.text)); return true;
        case 'fill': var el = document.getElementById('codeInput') || document.querySelector('.inbar input'); if (el) el.value = String(c.text || ''); return !!el;
        case 'enroll': var ci = document.getElementById('codeInput'); if (!ci) return false; ci.value = String(c.code || ''); appDoEnroll(); return true;
        case 'sync': if (APP.store.meta.deviceId) APP.sync.syncNow(c.why || 'sim'); return true;
        case 'meas':
          var F = APP.measForm;
          if (!F) return false;
          for (var k in c.values) if (Object.prototype.hasOwnProperty.call(c.values, k)) F.values[k] = String(c.values[k]);
          appMeasFormSave();
          return true;
        case 'clock': pre.setOffset(c.offset); return true;
        case 'snap': notify({ kind: 'snap', id: c.id || 0 }); return true;   // a fresh snapshot, after every command sent before it
        case 'click': var el2 = pick(c.sel, c.key); if (el2) el2.click(); return !!el2;   // a tap of the app's own chrome or a form control (the smoke, the tours)
        // The forms (spec 8.2): a job tile's open, a control's value (or a tap without one), the preset photo, a close without asking.
        case 'form': var u = APP.phone.staffId(), rq = { chatId: u, uid: u, staff: APP.store.meta.staff }; if (c.id) rq.itemId = String(c.id); return !!appOpenForm(String(c.kind || 'sale'), rq);
        case 'set': return appFormSet(String(c.f || ''), c.value === undefined ? undefined : c.value);
        case 'photo':   // the page resolved the preset (revision 2, B3): a photo record, never a key
          var PF = APP.form, pr = c.preset || {};
          if (!PF || PF.kind !== 'newitem') return false;
          PF.last = { f: 'photo', n: PF.last.n + 1 };
          appFormPhoto({ kind: 'photo', sim: { meta: pr, visual: pr.visual, mimeType: 'image/jpeg' } });
          return true;
        case 'close': return appCloseForm({});   // no question: a confirm() would block an unattended run
        case 'modals': useConfirm(c.on === false ? function () { return false; } : nativeConfirm); return true;   // off: a sandboxed host's instant false
      }
      return false;
    }
  };
  function lite(evt) {
    var e = { kind: (evt && evt.kind) || 'change' }, u = evt && evt.update;
    if (u && u.callback_query) { e.ev = 'tap'; e.data = String(u.callback_query.data); }
    else if (u && u.message) {
      if (u.message.photo) e.ev = 'photo';
      else if (u.message.voice) e.ev = 'voice';
      else { e.ev = 'text'; e.text = String(u.message.text || ''); }
    }
    return e;
  }
  // Without parent.SIM the page sees this device only through the snapshots posted here: every event carries one, a
  // sync event also the labels (the Messages tab may have changed them), and a watcher posts one whenever it changes
  // without an event (a screen the user opened, a code typed into the box).
  var lastSent = '';
  function notify(e) {
    if (pre.direct) { try { window.parent.SIM.frameEvent(window, e); } catch (err) {} return; }
    e.snap = window.SIM_FRAME.snap();
    lastSent = JSON.stringify(e.snap);
    if (e.kind === 'sync') e.labels = labels();
    pre.post({ simFrame: 'event', e: e });
  }
  bootApp({ apiUrl: 'fake://sim-server', botUsername: 'ShopTagBot', appName: 'SalesTag (demo)', version: 'demo' },
    { adapter: createMemoryAdapter(), online: function () { return true; }, noServiceWorker: true, transport: pre.transport, noHistory: true })
    .then(function (app) {
      app.phone.on('change', function (evt) { notify(lite(evt)); });
      app.phone.on('sync', function () { notify({ kind: 'sync' }); });
      app.phone.on('syncstate', function () { notify({ kind: 'syncstate' }); });
      if (pre.direct) { window.parent.SIM.frameReady(window, app); return; }
      var s0 = window.SIM_FRAME.snap();
      lastSent = JSON.stringify(s0);
      pre.post({ simFrame: 'ready', snap: s0, labels: labels() });
      setInterval(function () { if (JSON.stringify(window.SIM_FRAME.snap()) !== lastSent) notify({ kind: 'snap' }); }, 200);
    });
})();`;

/** The tour's highlight inside the frame for what is not a keyboard button (☰, the code box, the enrol button). */
const FRAME_CSS = '.simhot { outline: 3px solid #E0A64B !important; outline-offset: 2px; box-shadow: 0 0 0 6px rgba(224,166,75,.25) !important; }';

function frameShell() {
  const html = read('app/index.html');
  const a = html.indexOf('<div id="app">');
  const inputAt = html.indexOf('<input id="photoInput"');
  if (a < 0 || inputAt < 0) throw new Error('app/index.html: the #app shell (from <div id="app"> to #photoInput) was not found');
  const shell = html.slice(a, html.indexOf('>', inputAt) + 1);
  if (shell.indexOf('<!--') >= 0) throw new Error('the frame shell holds an HTML comment');
  return shell;
}

function buildSrcdoc() {
  const sources = FRAME_FILES.map(rel => {
    const src = read(rel);
    refuseScriptEnd(rel, src);
    return '/* ===== ' + rel + ' ===== */\n' + src.trim() + '\n';
  });
  const css = read('app/app.css');
  refuseScriptEnd('app/app.css', css);
  const shell = frameShell();
  [['the frame shell', shell], ['the prelude', PRELUDE], ['the boot script', BOOT]].forEach(p => refuseScriptEnd(p[0], p[1]));
  const doc = '<!doctype html>\n<html lang="my" data-font="1">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n' +
    '<title>SalesTag (demo)</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="stylesheet" href="' + FONTS + '">\n<style>\n' + css + '\n' + FRAME_CSS + '\n</style>\n</head>\n<body>\n' + shell + '\n' +
    '<script>\n' + PRELUDE + '\n</script>\n<script>\n' + sources.join('\n') + '</script>\n<script>\n' + BOOT + '\n</script>\n</body>\n</html>\n';
  if (doc.indexOf('<!--') >= 0) throw new Error('the frame document holds "<!--"');
  return doc;
}

/** The srcdoc as a JS string literal for the outer <script>: no raw </script, no <!--, no U+2028/U+2029. */
// U+2028/U+2029 end a line inside a JS string in older engines: written as escapes (and never typed raw into this file).
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
function embed(doc) {
  return JSON.stringify(doc)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .replace(LS, '\\u2028')
    .replace(PS, '\\u2029');
}

function main() {
  const scripts = FILES.map(f => {
    const src = read(f);
    refuseScriptEnd(f, src);
    return '<script>\n/* ===== ' + f + ' ===== */\n' + src + '\n</script>';
  }).join('\n');
  const srcdoc = embed(buildSrcdoc());
  const frameScript = '<script>\n/* ===== app frame (srcdoc) ===== */\nvar SIM_APP_SRCDOC = ' + srcdoc + ';\n</script>';

  const tpl = read('poc/simulator.template.html');
  ['<!-- @scripts -->', '<!-- @appframe -->'].forEach(m => { if (tpl.indexOf(m) < 0) throw new Error('template is missing ' + m); });
  // Function replacements: a '$' in a source must stay a '$' (String.replace reads '$&', "$'" in a string replacement).
  const out = tpl.replace('<!-- @appframe -->', () => frameScript).replace('<!-- @scripts -->', () => scripts);
  fs.mkdirSync(path.join(ROOT, 'poc/dist'), { recursive: true });
  const outPath = path.join(ROOT, 'poc/dist/pos-simulator.html');
  fs.writeFileSync(outPath, out);
  console.log('wrote ' + path.relative(ROOT, outPath).replace(/\\/g, '/') + ' (' + Math.round(Buffer.byteLength(out, 'utf8') / 1024) + ' KB)');
}

if (require.main === module) main();
module.exports = { FILES, FRAME_FILES, PRELUDE, BOOT, frameShell, buildSrcdoc, embed };
