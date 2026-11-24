/**
 * app/app_ui.js — the phone app's screens (client-app.md "Screens", critique fixes).
 *
 * Scanner-first home: the camera view on launch with Recent and Find under it; a typed 4-digit keypad
 * with a shop toggle as the fallback. After a scan the latest bot message is ONE large card with 56 px
 * buttons (renderMsg logic lifted from poc/sim_ui.js; keyboards come from the core unchanged); the chat
 * history sits behind a handle. On an item card the app intercepts the S|id|N action family: a stepper
 * [−] [1] [+] with a number keypad when the number is tapped, plus one big ✅ ရောင်း button that commits
 * S|id|N for the chosen N (default 1: one tap sells one). Amounts and prices the core asks for are typed
 * on the in-app numeric keypad. Menu grid from the core's showMenu keyboard. Sync screen, enroll screen,
 * settings, iOS install hint, banners that never block a sale. The ✅ is painted only after the store's
 * commit resolved (phone 'change' events fire after the write). Transfers run online only.
 * Everything here is app chrome; every string comes from t() (core_messages, core_sync, app_i18n).
 * Round 6 (docs/design-round-6/SPEC-round-6.md 7.4, 13): the forms (app_forms.js) own the camera while open
 * (appScannerWanted); labels are plain (APP.tt = appPlain(t), 13.1) with Tabler-style icons (app_icons.js); one
 * navigation stack (app_screens.js) drives the header's ←, the forms' ← and Android back; the history, buyers and
 * receipt are app pages; cards with a view are drawn as clean lists; the measurement form has one note and the figure.
 * Plain ES5: var and function only. No DOM access at load time; bootApp(config) starts it.
 */
var APP = null;
// How long a toast stays (the UX review for first-time phone users): a short note 2.6 s, a refusal at least 4.5 s, a long
// text longer still (55 ms per character), never past 7 s, so a slow reader gets to the end of it.
var APP_TOAST_MS = 2600;
var APP_TOAST_BAD_MS = 4500;
var APP_TOAST_BASE_MS = 1500;
var APP_TOAST_PER_CHAR_MS = 55;
var APP_TOAST_MAX_MS = 7000;

/* ------------------------------ pure helpers (also exercised by poc/run_app.js) ------------------------------ */

/** How long a toast of this text stays on the screen (see APP_TOAST_*). */
function appToastMs(text, bad) {
  var n = String(text || '').length;
  return Math.min(APP_TOAST_MAX_MS, Math.max(bad ? APP_TOAST_BAD_MS : APP_TOAST_MS, APP_TOAST_BASE_MS + APP_TOAST_PER_CHAR_MS * n));
}
/**
 * The line under the camera's Scan button (the UX review): before the phone has ever allowed the camera, what to answer
 * when it asks; after a refusal, where the permission is put back and that the keypad works meanwhile; else nothing.
 */
function appScanNote() {
  if (!APP || !APP.store) return '';
  if (APP.scanError === 'denied') return APP.tt('ui_camera_denied_hint');
  if (APP.scanState !== 'starting' && !APP.scanError && !APP.store.getPref('cameraOk')) return APP.tt('ui_camera_first');
  return '';
}

function appH(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'text') e.textContent = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'style') e.setAttribute('style', attrs[k]);
    else if (attrs[k] === false || attrs[k] === null || attrs[k] === undefined) { /* skip */ }
    else e.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}
function appClear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** An item card is recognised by its S|<id>|1 button; a SKU card also has the 🔢 Q|<id> button. */
function appCardInfo(m) {
  var kb = (m && m.keyboard) || [], sell = null, qty = null, id = null;
  for (var r = 0; r < kb.length; r++) for (var c = 0; c < kb[r].length; c++) {
    var b = kb[r][c], p = String(b.callback_data || '').split('|');
    if (p[0] === 'S' && p[2] === '1' && !sell) { sell = b; id = p[1]; }
    if (p[0] === 'Q') qty = b;
  }
  if (!sell) return null;
  return { msgId: m.id, itemId: id, sku: !!qty, sellText: sell.text, sellData: sell.callback_data, qtyData: qty ? qty.callback_data : null };
}
/** The core's own action for a stepper count: S|id|N, clamped to 1..MAX_SALE_QTY. */
function appStepperData(itemId, n) {
  var q = Math.round(Number(n));
  if (!(q >= 1)) q = 1;
  q = Math.min(q, CFG.MAX_SALE_QTY);
  return 'S|' + itemId + '|' + q;
}
/** On a SKU card the stepper replaces the ရောင်း ၁ and 🔢 buttons; every other button stays as the core sent it. */
function appKeyboardForCard(kb, info) {
  if (!info || !info.sku) return kb || [];
  var out = [];
  (kb || []).forEach(function (row) {
    var kept = row.filter(function (b) {
      var p = String(b.callback_data || '').split('|');
      return !((p[0] === 'S' && p[1] === info.itemId) || (p[0] === 'Q' && p[1] === info.itemId));
    });
    if (kept.length) out.push(kept);
  });
  return out;
}
/** What the core is waiting for: 'number' (keypad), 'text' (a name, a note, a search), 'tel' (a phone number), 'photo', or null. */
function appInputModeFor(state) {
  if (!state) return null;
  if (state.kind === 'await_number') return 'number';
  if (state.kind === 'new_item') return state.step === 'photo' ? 'photo' : (state.step === 'price' || state.step === 'cost' ? 'number' : null);
  if (state.kind === 'exp' && state.step === 'amount') return 'number';
  if (state.kind === 'await_text' && state.purpose === 'phone') return 'tel';   // 📱 CF| (round 6, U24): the phone keyboard
  if (state.kind === 'await_text' || state.kind === 'find' || state.kind === 'find_customer' || state.kind === 'notebook') return state.kind === 'notebook' ? 'photo' : 'text';
  if ((state.kind === 'credit' || state.kind === 'dep' || state.kind === 'cu') && state.step === 'name') return 'text';
  if (state.kind === 'dep' && state.step === 'note') return 'text';
  if (state.kind === 'meas_pick') return 'text';            // who is measured: a typed name, with or without a step
  return null;
}
/** The keypad opens by itself once per message AND number prompt: a second prompt on the same message opens it again. */
function appKeypadKeyFor(m, state) {
  return (m ? m.id : '') + '|' + ((state && state.purpose) || '') + '|' + (state && state.saved && state.saved.step ? state.saved.step : '');
}
function appIsMenuMessage(ports, m) { return !!m && m.from === 'bot' && m.text === t(ports, 'menu'); }
/** The first tag id in a card's text: a shop of CFG.SHOP_IDS (appShopIds, F10b), a dash, four digits; the earliest wins. */
function appItemIdFromText(text) {
  var s = String(text || ''), best = null;
  appShopIds().forEach(function (id) {
    var m = new RegExp(id + '-[0-9]{4}').exec(s);
    if (m && (!best || m.index < best.index || (m.index === best.index && m[0].length > best[0].length))) best = m;
  });
  return best ? best[0] : null;
}
function appIsIos(ua) { return /iPad|iPhone|iPod/.test(String(ua || '')) || (/Macintosh/.test(String(ua || '')) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1); }
function appIsStandalone(win) {
  if (!win) return false;
  if (win.navigator && win.navigator.standalone === true) return true;
  return !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
}
/** The api=report kind for a document the core made (reports carry their kind; 'last' is a month that is not this one). */
function appReportApiKind(report, now) {
  if (!report) return null;
  if (report.kind === 'day') return 'today';
  if (report.kind === 'month') return String(report.fileName || '').slice(8) === monthKey(now) ? 'month' : 'last';
  if (report.kind === 'stock' || report.kind === 'owed' || report.kind === 'exp' || report.kind === 'receipt') return report.kind;
  return null;
}
function appMedian(list) {
  if (!list || !list.length) return 0;
  var s = list.slice().sort(function (a, b) { return a - b; });
  return s[Math.floor(s.length / 2)];
}

/* ------------------------------ the measurement form: the pure parts (poc/run_app.js) ------------------------------ */
// SPEC-round-4.md 9.3. The server quarantines a session whose keys, values, notes or voucher break its rules, and a
// quarantined session DELETES the local record (measurementRejected): the form keeps every value inside these limits.
var APP_MEAS_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;   // a field key the server accepts (core_sync.js)
var APP_MEAS_FIELDS_MAX = 80;                   // field keys per session
var APP_MEAS_VALUE_MAX = 60;                    // characters per stored value
var APP_MEAS_NOTES_MAX = 300;
var APP_MEAS_PART_MAX = 12;                     // maxlength of one box of a multi-value field (3 boxes + 2 slashes < 60)
var APP_MEAS_ONE_MAX = 20;                      // maxlength of a number field's single box
var APP_MEAS_DRAFT_TTL = 86400;                 // a draft is kept one day
var APP_MEAS_DRAFT_MS = 400;                    // debounce of the draft's durable write

/** The fields the form shows: the active fields whose key the server accepts, at most 80. */
function appMeasFormFields(fields) {
  return (fields || []).filter(function (f) { return f && APP_MEAS_KEY_RE.test(String(f.key)); }).slice(0, APP_MEAS_FIELDS_MAX);
}
/** The boxes of a multi-value field as one stored value: joined with '/', trailing empty parts dropped, an empty middle part kept. */
function appMeasJoin(parts) {
  var p = (parts || []).map(function (x) { return x === null || x === undefined ? '' : String(x).trim(); });
  while (p.length && p[p.length - 1] === '') p.pop();
  return p.join('/');
}
/** A stored value back into `multi` boxes (value.split('/')); parts beyond the last box stay in the last box. */
function appMeasSplit(value, multi) {
  var n = Math.max(1, Math.round(Number(multi)) || 1), s = value === null || value === undefined ? '' : String(value);
  var parts = s === '' ? [] : s.split('/');
  if (parts.length > n) parts = parts.slice(0, n - 1).concat([parts.slice(n - 1).join('/')]);
  while (parts.length < n) parts.push('');
  return parts;
}
/**
 * The typed voucher: '' is none; digits alone (Arabic or Burmese) are the voucher number of the staff's shop
 * (orderIdFor: 2532 in shop S1 is V1-2532); an order id as written is made canonical the same way (v1-25 is
 * V1-0025, the id the server looks the order up by); anything else is bad (the form drops it with a toast).
 * Returns {id, bad}.
 */
function appMeasVoucher(text, shop) {
  var s = normMeasValue({ type: 'text' }, text).toUpperCase().replace(/\s+/g, '');
  if (!s) return { id: '', bad: false };
  var m = /^V(\d+)-0*(\d{1,8})$/.exec(s), id = s;
  if (/^\d+$/.test(s)) id = Number(s) > 0 ? orderIdFor(shop, Number(s)) : '';
  else if (m) id = Number(m[2]) > 0 ? orderIdFor('S' + m[1], Number(m[2])) : '';
  return isOrderId(id) ? { id: id, bad: false } : { id: '', bad: true };
}
/** htamein_side shows a two-button toggle: 'L', 'R', '' (nothing chosen), or 'text' for a stored value that is neither button. */
function appMeasSide(ports, value) {
  var v = value === null || value === undefined ? '' : String(value);
  if (v === '') return '';
  if (v === t(ports, 'btn_left')) return 'L';
  if (v === t(ports, 'btn_right')) return 'R';
  return 'text';
}
/** The form's values from the customer's newest session: {key: stored value} for the fields it filled. */
function appMeasPrefill(fields, prev) {
  var out = {}, src = prev && prev.fields ? prev.fields : {};
  (fields || []).forEach(function (f) {
    var v = src[f.key];
    if (v !== undefined && v !== null && String(v) !== '') out[f.key] = String(v);
  });
  return out;
}
/**
 * What is saved: each value through normMeasValue, empty ones left out, each at most 60 characters. {fields, n}.
 * A number field with `multi` boxes is normalised box by box and joined again (appMeasJoin): one box holding a
 * letter or 14½ must not turn the whole value into its first number (normMeasValue's parseNumberText fallback);
 * such a box is kept as normMeasValue gives it, as a single number box is.
 */
function appMeasCollect(fields, values) {
  var out = {}, n = 0;
  values = values || {};
  (fields || []).forEach(function (f) {
    var v = values[f.key];
    if (v === undefined || v === null) return;
    var s = f.type === 'number' && f.multi > 1
      ? appMeasJoin(String(v).split('/').map(function (p) { return normMeasValue(f, p); }))
      : normMeasValue(f, String(v));
    // The one notes field keeps CFG.MEAS_NOTE_MAX characters (round 6, revision 3, F1); every other value 60.
    var max = f.key === CFG.MEAS_NOTE_KEY ? CFG.MEAS_NOTE_MAX : APP_MEAS_VALUE_MAX;
    if (s.length > max) s = s.slice(0, max);
    if (s === '') return;
    out[f.key] = s;
    n++;
  });
  return { fields: out, n: n };
}
function appMeasDraftKey(customerId) { return 'measdraft:' + customerId; }
/**
 * The notes of a restored draft merged into the one note field (round 6, revision 3, F1, 13.7.1): when notes (trimmed) is
 * non-empty and an active field has the key note, values.note + ' · ' + notes (or notes alone), cut to 300; otherwise the
 * values unchanged.
 */
function appMeasNoteMerge(fields, values, notes) {
  var n = String(notes || '').trim(), out = {}, k;
  for (k in (values || {})) if (Object.prototype.hasOwnProperty.call(values, k)) out[k] = values[k];
  var has = (fields || []).some(function (f) { return f && f.key === CFG.MEAS_NOTE_KEY; });
  if (!n || !has) return out;
  var cur = String(out[CFG.MEAS_NOTE_KEY] || '').trim();
  out[CFG.MEAS_NOTE_KEY] = (cur ? cur + ' · ' + n : n).slice(0, CFG.MEAS_NOTE_MAX);
  return out;
}
/** The draft kept for a customer, {values, notes, voucher, sketch}, or null (none, expired or unreadable). */
function appMeasDraftRead(store, customerId) {
  var raw = store.cacheGet(appMeasDraftKey(customerId)), d = null;
  if (!raw) return null;
  try { d = JSON.parse(raw); } catch (ignore) { return null; }
  if (!d || typeof d !== 'object' || !d.values || typeof d.values !== 'object' || Array.isArray(d.values)) return null;
  var values = {};
  Object.keys(d.values).forEach(function (k) { if (typeof d.values[k] === 'string') values[k] = d.values[k]; });
  return { values: values, notes: typeof d.notes === 'string' ? d.notes : '', voucher: typeof d.voucher === 'string' ? d.voucher : '',
           sketch: typeof d.sketch === 'string' ? d.sketch : '' };
}
/** Every change is kept in memory and in the persisted cache at once; the caller commits it (debounced). */
function appMeasDraftWrite(store, customerId, draft) {
  store.cachePut(appMeasDraftKey(customerId), JSON.stringify({ values: draft.values || {}, notes: draft.notes || '', voucher: draft.voucher || '', sketch: draft.sketch || '' }), APP_MEAS_DRAFT_TTL);
}
function appMeasDraftDrop(store, customerId) { store.cacheRemove(appMeasDraftKey(customerId)); }
/**
 * What the form opens with, for req = {customerId, orderId, staff} (ports.ui.measureForm): the fields, the customer's
 * newest session (prev), and the values to show: a draft kept for this customer wins (restored), else the newest
 * session's values. The voucher input starts with the request's order id.
 */
/** The shop whose voucher series typed digits belong to: the staff of the request, else the enrolled staff, else shop 1. */
function appMeasShop(store, req) {
  if (req && req.staff && req.staff.shop) return String(req.staff.shop);
  return store.meta.staff && store.meta.staff.shop ? String(store.meta.staff.shop) : CFG.SHOP_IDS[0];
}
function appMeasModel(ports, store, req) {
  var fields = appMeasFormFields(measureFields(ports, true));
  var prev = latestMeasurement(ports, req.customerId);
  var draft = appMeasDraftRead(store, req.customerId);
  var shop = appMeasShop(store, req);
  return {
    customerId: String(req.customerId), customer: customerName(ports, req.customerId), shop: shop, fields: fields, prev: prev,
    values: draft ? draft.values : appMeasPrefill(fields, prev), notes: draft ? draft.notes : '',
    voucher: draft ? draft.voucher : (req.orderId ? String(req.orderId) : ''), restored: !!draft,
    // The drawing (round 6, revision 3): a restored draft's, else the newest session's, else none (an empty woman).
    sketch: draft && draft.sketch ? draft.sketch : (prev && prev.sketch ? String(prev.sketch) : '')
  };
}
/**
 * Save the form (input = {values, notes, voucher}): each value through normMeasValue; nothing filled in is refused
 * ({ok: false, reason: 'empty'}, the form says ui_meas_empty). A bad voucher is dropped (badVoucher: the form says
 * ui_meas_bad_voucher), the session saved with orderId ''. Then saveMeasurementLocal (the newest record at once,
 * pending, one outbox entry), the draft removed, and the bot line meas_saved_form. The caller closes the form and
 * commits (appMeasCommit). Returns {ok, n, orderId, badVoucher, record}.
 */
function appMeasSave(phone, req, input) {
  var ports = phone.ports, store = phone.store;
  input = input || {};
  var got = appMeasCollect(appMeasFormFields(measureFields(ports, true)), input.values);
  if (!got.n) return { ok: false, reason: 'empty' };     // a drawing alone is refused too (review r3, B-1)
  var v = appMeasVoucher(input.voucher, appMeasShop(store, req));
  var notes = String(input.notes || '').trim().slice(0, APP_MEAS_NOTES_MAX);
  var sketch = typeof input.sketch === 'string' && appSketchDecode(input.sketch) ? input.sketch : '';
  var rec = { customerId: req.customerId, orderId: v.id, notes: notes, fields: got.fields };
  if (sketch) rec.sketch = sketch;
  var record = store.local.saveMeasurementLocal(rec);
  // The drawing's picture (13.7.2): one sketch job through the photo-job path, after the session's entry (M1 hold).
  if (sketch && input.makeCanvas) {
    var png = appSketchPng(sketch, input.makeCanvas);
    if (png) store.addMedia({ kind: 'sketch', status: 'queued', jobId: 'j-' + appUuid().replace(/-/g, '').slice(0, 16), data: png, mime: 'image/png',
      entryId: record.entryId || '', customerId: String(req.customerId), ctx: {}, queuedAt: phone.now().toISOString() });
  }
  appMeasDraftDrop(store, req.customerId);
  phone.botSay(t(ports, 'meas_saved_form', { customer: customerName(ports, req.customerId), n: fmtCount(got.n) }));
  return { ok: true, n: got.n, orderId: v.id, badVoucher: v.bad, record: record };
}
/** The save made durable, then a sync soon (the session goes to the server). Resolves to true when written. */
function appMeasCommit(phone, sync) {
  return phone.commit('meas').then(function (ok) { if (ok && sync) sync.scheduleSync(); return ok; });
}

/* ------------------------------ boot ------------------------------ */

function bootApp(config, opts) {
  opts = opts || {};
  config = config || {};
  // config.example.js copied as is (PASTE_DEPLOYMENT_ID_HERE) counts as no URL: the enroll screen says so.
  if (config.apiUrl && /PASTE_/.test(String(config.apiUrl))) config.apiUrl = '';
  var win = opts.win || (typeof window !== 'undefined' ? window : null);
  var doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  var ua = win && win.navigator ? win.navigator.userAgent : '';
  var platform = appIsIos(ua) ? 'ios' : (/Android/i.test(ua) ? 'android' : 'web');
  var adapter = opts.adapter;
  if (!adapter) {
    var idb = createIdbAdapter();
    adapter = idb.available ? idb : createMemoryAdapter();
  }
  adapter.onreplaced = function () { appOnDbReplaced(); };
  var phone = createAppPhone({ adapter: adapter, platform: platform, name: 'app', transport: opts.transport || null });
  // navigator.onLine === false is trusted (no request is tried); true only means "maybe", the request decides.
  // phone.online stays a second switch (the dev bench's offline box sets it). opts.online replaces both (the simulator's
  // frame: its server is inside the page, so a file opened without a network can still enrol and sync).
  var online = opts.online || function () { return phone.online !== false && !(win && win.navigator && win.navigator.onLine === false); };
  var sync = createAppSync(phone, { apiUrl: config.apiUrl, transport: opts.transport || null, platform: platform, online: online, label: (platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : 'Web') + ' app' });
  APP = {
    config: config, opts: opts, win: win, doc: doc, phone: phone, sync: sync, store: phone.store, platform: platform,
    screen: 'boot', showScanner: true, qty: { msgId: null, n: 1 }, keypadAutoFor: null, scanner: null, videoEl: null, scanState: 'idle', scanError: null,
    recorder: null, installEvt: null, updateReady: false, reloadOnControl: false, tapStart: 0, toastTimer: null, iosHintDismissed: false,
    findText: '', findResults: null, persisted: null, enrollBusy: false, enrollError: '', enrollProgress: null, pdfBusy: false, thumbAsked: {},
    offlineToastShown: false, lastRenderedRev: -1, justStarted: true, rendering: false, measForm: null, reloadAfterForm: false,
    // round 6: the open form (app_forms.js) and the navigation stack (app_screens.js, 13.4)
    form: null, formPending: null, nav: [], navDepth: 0, navBusy: false, navHist: false, navGuard: false, screenArg: null,
    histDays: 7, buyersText: '', backAgainAt: 0
  };
  var $ = function (id) { return doc.getElementById(id); };
  APP.$ = $;
  var ports = phone.ports;
  // Every label, title and toast plain (round 6, revision 3, 13.1); the raw text only for the four job buttons.
  var tt = function (key, vars) { return appPlain(t(ports, key, vars)); };
  APP.tt = tt;
  APP.ttRaw = function (key, vars) { return t(ports, key, vars); };

  try { var fs = win && win.localStorage ? win.localStorage.getItem('fontSize') : null; if (fs) doc.documentElement.setAttribute('data-font', fs); } catch (ignore) {}
  try { APP.iosHintDismissed = !!(win && win.localStorage && Number(win.localStorage.getItem('iosHintDismissed') || 0) > Date.now() - 86400000); } catch (ignore) {}

  return phone.load().then(function () {
    appApplyPrefs();
    appPaintChrome();
    appWireEvents();
    phone.on('change', appOnChange);
    phone.on('sync', appOnSync);
    phone.on('syncstate', function () { appRenderHeader(); });
    phone.on('progress', function (p) { APP.enrollProgress = p; if (APP.screen === 'enroll') appRender(); });
    phone.on('revoked', function () {
      appCloseForm({});
      appCloseMeasForm({});
      appNavReset();
      APP.screen = 'enroll';
      APP.enrollError = tt('app_revoked');
      appRender();
    });
    phone.on('measureform', appOnMeasureForm);
    phone.on('openform', appOnOpenForm);
    phone.on('openscreen', appOnOpenScreen);
    sync.attach(win, doc);
    appSetupServiceWorker();
    appSetupInstallHints();
    appRequestPersist();
    appNavBoot();                                           // a reload walks the entries it kept back to depth 0 (UX-m2)
    if (phone.store.meta.deviceId) {
      APP.screen = 'home';
      APP.showScanner = true;
      sync.start();
      appRender();
      if (phone.store.getPref('cameraOk')) appStartScanner();
    } else {
      APP.screen = 'enroll';
      appRender();
    }
    if (win && win.setTimeout) win.setTimeout(function () { APP.justStarted = false; }, 15000);
    return APP;
  });
}

function appApplyPrefs() {
  var size = APP.store.getPref('fontSize', null);
  if (size) APP.doc.documentElement.setAttribute('data-font', String(size));
}

/** The chrome's icons and words (13.3): back, settings, Scan, Menu, voice. The static texts of index.html are the fallback. */
function appPaintChrome() {
  var $ = APP.$, tt = APP.tt, paint = function (el, icon, label) {
    if (!el) return;
    el.textContent = label;
    el.className = (el.className ? el.className.replace(/\s*\bwi\b/g, '') + ' ' : '') + 'wi';
    el.appendChild(appIcon(icon));
  };
  var back = $('back'), gear = $('gear');
  if (back) { back.innerHTML = appIconSvg('arrow-left'); back.setAttribute('aria-label', tt('ui_aria_back')); back.setAttribute('title', tt('ui_aria_back')); }
  if (gear) { gear.innerHTML = appIconSvg('settings'); gear.setAttribute('aria-label', tt('ui_w_settings')); gear.setAttribute('title', tt('ui_w_settings')); }
  paint($('btnScan'), 'scan', tt('ui_w_scan'));
  paint($('btnMenu'), 'menu-2', tt('ui_w_menu'));
  paint($('btnVoice'), 'microphone', tt('ui_btn_voice'));
}

function appWireEvents() {
  var $ = APP.$, win = APP.win, doc = APP.doc;
  if ($('back')) $('back').addEventListener('click', function () { appNavBack(); });
  $('chip').addEventListener('click', function () { appOpenScreen('sync'); });
  $('gear').addEventListener('click', function () { appOpenScreen('settings'); });
  $('btnScan').addEventListener('click', function () { appOnScanButton(); });
  $('btnMenu').addEventListener('click', function () { appOpenMenu(); });
  appWireVoice($('btnVoice'));
  $('photoInput').addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    if (APP.form && APP.form.kind === 'newitem') appFormPhoto(file); else appOnPhotoPicked(file);
    ev.target.value = '';
  });
  if (win) {
    win.addEventListener('offline', function () { appToast(APP.tt('ui_offline_toast')); appRenderHeader(); });
    win.addEventListener('online', function () { appRenderHeader(); });
    win.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); APP.installEvt = e; appRenderBanner(); });
    win.addEventListener('popstate', appOnPop);
  }
  if (doc && !(APP.opts || {}).noHistory) {
    // The guard entry is pushed with the seller's first tap (UX-M4: Chrome skips entries added without one).
    doc.addEventListener('pointerdown', appNavGuard, true);
    doc.addEventListener('keydown', appNavGuard, true);
  }
  if (doc) doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState === 'hidden') appStopScanner();
    else if (appScannerWanted() && APP.store.getPref('cameraOk')) appStartScanner();
  });
}

/**
 * A sync finished: repaint; an open form too (a piece sold elsewhere shows at once) unless an input inside it has focus
 * (it repaints on that input's blur, U5); a setting the server refused toasts the owner (13.12).
 */
function appOnSync(summary) {
  appRender();
  var F = APP.form;
  if (F) {
    var act = null;
    try { act = APP.doc.activeElement; } catch (ignore) {}
    var inside = !!act && !!F.el && (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA') && typeof F.el.contains === 'function' && F.el.contains(act);
    if (inside) F.stale = true; else appFormRepaint(F);
  }
  ((summary && summary.quarantined) || []).forEach(function (q) {
    if (q && q.entry && q.entry.kind === 'setting') appToast(APP.tt('app_rejected', { reason: syncReasonText(APP.phone.ports, q.reason) }), true);
  });
}

/** Every durable change: repaint, measure the tap, and nudge the chip. */
function appOnChange(evt) {
  if (evt && (evt.kind === 'measdraft' || evt.kind === 'formdraft')) {   // a form draft written: nothing behind the form changed
    if (evt.durable === false) appToast(APP.tt('ui_not_saved'), true);
    return;
  }
  // U1: the delivery that opened a form must not turn the form's camera off.
  if (evt && evt.kind === 'update' && APP.screen === 'home' && !APP.form && !APP.formPending) APP.showScanner = false;
  appRender();
  if (APP.tapStart && APP.win && APP.win.performance) {
    APP.store.recordTapMs(APP.win.performance.now() - APP.tapStart);
    APP.tapStart = 0;
  }
  if (evt && evt.durable === false) appToast(APP.tt('ui_not_saved'), true);
}

/* ------------------------------ rendering ------------------------------ */

function appLatestBot() { return APP.phone.sim.lastBot(); }
function appUid() { return APP.phone.staffId(); }
function appState() { return APP.store.meta.deviceId ? getState(APP.phone.ports, appUid()) : null; }

function appRender() {
  if (!APP || !APP.doc) return;
  if (APP.screen === 'home') appNavCardSync();           // the card rule (13.4): a card layer exactly while the home shows a card
  loadShopRegistry(APP.phone.ports);
  var profile = APP.store.meta.staff;
  if (profile && officeRole(profile.role) && APP.store.meta.deviceId) {
    if (['people','expenseBook','closing','orders','designs','settings','work'].indexOf(APP.screen) < 0) APP.screen = 'work';
    APP.showScanner = false;
  }
  if (APP.officePage && APP.officePage.kind !== APP.screen) APP.officePage = null;
  appRenderHeader();
  appRenderBanner();
  var main = APP.$('main');
  appClear(main);
  var bottom = APP.$('bottom');
  bottom.hidden = !(APP.store.meta.deviceId && APP.screen === 'home');
  // 🎤 needs the owner's AI switch and Settings app_voice (round 6, F9b).
  var voiceOn = aiOn(APP.phone.ports) && settingOn(APP.phone.ports, 'app_voice');
  APP.$('btnVoice').hidden = !voiceOn;
  if (APP.screen === 'enroll') appRenderEnroll(main);
  else if (APP.screen === 'home') appRenderHome(main);
  else if (APP.screen === 'history') appHistoryScreen(main);
  else if (APP.screen === 'entry') appEntryScreen(main);
  else if (APP.screen === 'work') appOfficeJobs(main, profile);
  else if (APP.screen === 'orders' || APP.screen === 'designs') appWorkshopScreen(main, APP.screen);
  else if (APP.screen === 'expenseBook') appExpenseBook(main);
  else if (APP.screen === 'stockslips') appStockSlips(main);
  else if (APP.screen === 'people' || APP.screen === 'shops') appManageScreen(main, APP.screen);
  else if (APP.screen === 'closing') appClosingScreen(main);
  else if (APP.screen === 'buyers') appBuyersScreen(main);
  else if (APP.screen === 'buyer') appBuyerScreen(main);
  else if (APP.screen === 'receipt') appReceiptScreen(main);
  else if (APP.screen === 'sync') appRenderSync(main);
  else if (APP.screen === 'settings') appRenderSettings(main);
  if (!appScannerWanted()) appStopScanner();
  if (APP.form) appFormStripState(APP.form);
}

/** ONE predicate for who owns the camera (revision 2, U1): an open form's strip, else the home's scanner state. */
function appScannerWanted() {
  if (!APP) return false;
  return APP.form ? !!APP.form.scan : (APP.screen === 'home' && !!APP.showScanner);
}

/** The chip's icon by state (13.3). */
var APP_CHIP_ICON = { synced: 'cloud-check', sending: 'cloud-upload', waiting: 'cloud-upload', stale: 'cloud-upload', red: 'alert-triangle', never: 'cloud-off' };
function appRenderHeader() {
  if (!APP || !APP.doc) return;
  var staff = APP.store.meta.staff, home = APP.screen === 'home' || APP.screen === 'enroll' || APP.screen === 'boot';
  var name = home ? (staff ? shopName(APP.phone.ports, staff.shop) : (APP.config.appName || APP.tt('ui_app_name'))) : appScreenTitle(APP.screen);
  APP.$('shopName').textContent = name;
  var back = APP.$('back');
  if (back) back.hidden = !appNavCanBack();
  var chip = APP.$('chip'), st = APP.sync.chipState();
  var offline = st.offline && st.kind !== 'red' && st.kind !== 'never';
  var icon = offline ? 'cloud-off' : (APP_CHIP_ICON[st.kind] || 'cloud-check');
  var n = (st.entries || 0) + (APP.store.queuedMedia ? APP.store.queuedMedia().length : 0);
  var badge = (st.kind === 'waiting' || st.kind === 'stale' || (offline && n > 0)) && n > 0 ? (n > 99 ? myDigits(99) + '+' : myDigits(n)) : '';
  var text = appPlain(offline ? APP.tt('ui_sync_offline') : st.text);
  appClear(chip);
  chip.innerHTML = appIconSvg(icon);
  if (badge) chip.appendChild(appH('span', { class: 'badge', text: badge }));
  chip.className = 'chip iconbtn ' + st.kind + (offline ? ' offline' : '');
  chip.setAttribute('aria-label', text);
  chip.setAttribute('title', text);
}

function appRenderBanner() {
  var b = APP.$('banner');
  appClear(b);
  var tt = APP.tt, st = APP.sync.chipState();
  if (APP.store.meta.deviceId && st.kind === 'red') {
    b.className = 'banner bad';
    b.appendChild(appH('span', { class: 'txt', text: appPlain(st.text) }));
    b.appendChild(appH('button', { text: tt('ui_btn_view'), onclick: function () { appOpenScreen('sync'); } }));
    b.hidden = false;
    return;
  }
  if (APP.installEvt && APP.store.meta.deviceId) {
    b.className = 'banner info';
    b.appendChild(appH('span', { class: 'txt', text: tt('ui_install_android') }));
    b.appendChild(appH('button', { text: tt('ui_btn_install'), onclick: function () {
      var e = APP.installEvt;
      APP.installEvt = null;
      appRenderBanner();
      try { e.prompt(); } catch (ignore) {}
    } }));
    b.hidden = false;
    return;
  }
  b.hidden = true;
}

/* ---------- enroll ---------- */
function appRenderEnroll(main) {
  var tt = APP.tt;
  var screen = appH('div', { class: 'screen stack' });
  if (APP.platform === 'ios' && !appIsStandalone(APP.win) && !APP.iosHintDismissed) screen.appendChild(appInstallHint());
  screen.appendChild(appH('h2', { text: tt('ui_enroll_title') }));
  screen.appendChild(appH('p', { text: tt('ui_enroll_hint') }));
  if (!APP.config.apiUrl && !APP.sync.hasTransport) screen.appendChild(appH('div', { class: 'card system', text: tt('ui_err_config') }));
  var input = appH('input', { class: 'code', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '9', placeholder: tt('ui_enroll_placeholder'), id: 'codeInput' });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') appDoEnroll(); });
  screen.appendChild(input);
  if (APP.enrollError) screen.appendChild(appH('div', { class: 'card pending', text: APP.enrollError }));
  if (APP.enrollBusy) {
    var p = APP.enrollProgress;
    screen.appendChild(appH('div', { class: 'card system', text: p ? tt('ui_enroll_loading', { rows: fmtCount(p.rows) }) : tt('ui_enroll_wait') }));
  }
  screen.appendChild(appH('button', { class: 'primary', text: tt('ui_btn_enroll'), disabled: APP.enrollBusy, onclick: appDoEnroll }));
  main.appendChild(screen);
  if (!APP.enrollBusy) { try { input.focus(); } catch (ignore) {} }
}
function appInstallHint() {
  var tt = APP.tt;
  var box = appH('div', { class: 'install' }, [appH('strong', { text: tt('ui_install_ios_title') }), appH('div', { text: '\n' + tt('ui_install_ios_steps') })]);
  box.appendChild(appH('div', {}, [appH('button', { class: 'ghost', text: tt('ui_install_later'), onclick: function () {
    APP.iosHintDismissed = true;
    try { APP.win.localStorage.setItem('iosHintDismissed', String(Date.now())); } catch (ignore) {}
    appRender();
  } })]));
  return box;
}
function appDoEnroll() {
  var tt = APP.tt;
  var code = syncNormalizeCode(APP.$('codeInput') ? APP.$('codeInput').value : '');
  if (code.length !== SYNC.CODE_LEN) { APP.enrollError = tt('ui_enroll_short'); appRender(); return; }
  if (!APP.sync.online()) { APP.enrollError = tt('ui_enroll_offline'); appRender(); return; }
  APP.enrollBusy = true;
  APP.enrollError = '';
  APP.enrollProgress = null;
  appRender();
  APP.sync.enroll(code).then(function (res) {
    APP.enrollBusy = false;
    if (!res.ok) {
      if (res.error === 'enroll_bad') APP.enrollError = tt('enroll_bad', { left: fmtCount(res.attemptsLeft === null || res.attemptsLeft === undefined ? 0 : res.attemptsLeft) });
      else if (res.error === 'enroll_expired') APP.enrollError = tt('enroll_expired');
      else APP.enrollError = APP.sync.errorText(res.error);
      appRender();
      return;
    }
    appNavReset();
    APP.screen = 'home';
    APP.showScanner = true;
    appRender();
    appToast(tt('enroll_done', { label: APP.store.meta.label, letter: APP.store.meta.receiptLetter }));
    appStartScanner();
  });
}

/* ---------- home: scanner, recent, find, or the latest card ---------- */
function appRenderHome(main) {
  var tt = APP.tt, m = appLatestBot(), jobs = appHomeJobs(APP.phone.ports).length > 0;
  var handle = function () { return appHi('button', { class: 'handle', text: tt('ui_history'), onclick: function () { appOpenScreen('history'); } }, 'history'); };
  if (APP.showScanner || !m) {
    if (jobs) main.appendChild(appJobRow(false));
    main.appendChild(appOfficeButton('ဆိုင်ပြောင်း ပို့ / လက်ခံ', function () { appOpenScreen('stockslips'); }));
    main.appendChild(appH('button', { text: 'ဆိုင်စာရင်း ကြည့်မယ်', onclick: function () { appOpenScreen('closing'); } }));
    if (!APP.form) main.appendChild(appScannerPanel());     // a form owns the one video while it is open (U1)
    if (jobs) main.appendChild(appH('div', { class: 'muted small center', text: tt('ui_home_scan_hint') }));
    main.appendChild(appH('div', { class: 'scanrow' }, [
      appHi('button', { text: tt('ui_btn_keypad'), onclick: function () { appOpenTagKeypad(); } }, 'keyboard')
    ]));
    main.appendChild(appRecentPanel());
    main.appendChild(appFindPanel());
    if (!m) main.appendChild(appH('div', { class: 'card system', text: tt('menu') }));
    else main.appendChild(handle());
    return;
  }
  if (jobs) main.appendChild(appJobRow(true));
  var card = appRenderMsg(m, { big: true });
  main.appendChild(card);
  var bar = appInputBar(m);
  if (bar) main.appendChild(bar);
  main.appendChild(appH('div', { class: 'scanrow' }, [handle()]));
}

function appScannerPanel() {
  var tt = APP.tt;
  if (!APP.videoEl) {
    APP.videoEl = appH('video', { playsinline: 'true', muted: 'true', autoplay: 'true' });
    APP.videoEl.muted = true;
  }
  var box = appH('div', { class: 'scan' });
  box.appendChild(APP.videoEl);
  if (APP.scanState === 'running') {
    box.appendChild(appH('div', { class: 'guide' }));
    box.appendChild(appH('div', { class: 'hint', text: tt('ui_scan_hint') }));
    var tools = appH('div', { class: 'tools' });
    if (APP.scanner && APP.scanner.hasTorch) tools.appendChild(appH('button', { class: 'iconbtn', 'aria-label': tt('ui_torch'), html: appIconSvg('bulb'), onclick: function () { APP.scanner.toggleTorch(); } }));
    tools.appendChild(appH('button', { class: 'iconbtn', 'aria-label': tt('ui_btn_close'), html: appIconSvg('x'), onclick: function () { appStopScanner(); appRender(); } }));
    box.appendChild(tools);
    if (APP.videoEl.paused && APP.videoEl.srcObject) { try { APP.videoEl.play(); } catch (ignore) {} }
  } else {
    var start = appH('div', { class: 'start' });
    var plainStart = APP.scanState !== 'starting' && !APP.scanError;
    var label = APP.scanState === 'starting' ? tt('ui_scan_starting')
      : APP.scanError === 'denied' ? tt('ui_camera_denied') : APP.scanError === 'none' ? tt('ui_camera_none') : APP.scanError === 'error' ? tt('ui_camera_error') : tt('ui_w_scan');
    start.appendChild(appHi('button', { class: 'primary', text: label, disabled: APP.scanState === 'starting', onclick: function () { appStartScanner(); } }, plainStart ? 'scan' : null));
    var note = appScanNote();
    if (note) start.appendChild(appH('div', { class: 'note', text: note }));
    box.appendChild(start);
  }
  return box;
}
function appStartScanner() {
  if (!APP || !APP.store.meta.deviceId || APP.measForm || !appScannerWanted()) return;
  if (APP.scanState === 'running' || APP.scanState === 'starting') return;
  if (!APP.videoEl) appScannerPanel();
  APP.scanState = 'starting';
  APP.scanError = null;
  appRender();
  if (!APP.scanner) {
    APP.scanner = createAppScanner({
      video: APP.videoEl,
      onDecode: function (text) { APP.scanState = 'idle'; appOnDecoded(text); },
      onError: function (code) { APP.scanState = 'idle'; APP.scanError = code; appRender(); }
    });
  }
  APP.scanner.start().then(function (mode) {
    if (!APP.scanner.running) { if (APP.scanState === 'starting') APP.scanState = 'idle'; appRender(); return; }
    APP.scanState = 'running';
    APP.store.setPref('cameraOk', true);
    APP.phone.commit('pref');
    appRender();
  });
}
function appStopScanner() {
  if (APP.scanner && APP.scanner.running) APP.scanner.stop();
  if (APP.scanState !== 'idle') APP.scanState = 'idle';
}
function appOnDecoded(text) {
  var id = appParseTagLink(text);
  if (!id) { appToast(APP.tt('tag_not_found', { id: String(text).slice(0, 24) }), true); appStartScanner(); return; }
  appOpenTagId(id);
}
function appOpenTagId(id) {
  if (APP.form) return appFormTag(APP.form, id);         // an open form takes the tag (the scan router, 1.2)
  appStopScanner();
  APP.showScanner = false;
  APP.tapStart = APP.win && APP.win.performance ? APP.win.performance.now() : 0;
  APP.phone.sim.start(id);
}

function appRecentPanel() {
  var tt = APP.tt, staff = APP.store.meta.staff;
  var items = recentItems(APP.phone.ports, staff && staff.role === 'owner' ? null : staff.shop, 6);
  var sec = appH('div', { class: 'section' }, [appH('h3', { text: tt('ui_recent_title') })]);
  if (!items.length) { sec.appendChild(appH('div', { class: 'muted', text: tt('ui_recent_none') })); return sec; }
  sec.appendChild(appTiles(items));
  return sec;
}
/** A sample piece's small text badge (round 6b, G1): the word နမူနာ in a pill, no emoji (F7). */
function appSampleBadge() {
  return appH('span', { class: 'sbadge', text: APP.tt('ui_lbl_sample') });
}
function appTiles(items) {
  var tiles = appH('div', { class: 'tiles' });
  items.forEach(function (it) {
    var st = it.status === CFG.STATUS.SOLD ? APP.tt('ui_val_sold') : (isPricePending(it) ? APP.tt('btn_pending') : fmtMoney(it.price) + ' · ' + fmtCount(it.stock));
    tiles.appendChild(appH('button', { onclick: function () { appOpenTagId(it.id); } }, [
      appH('span', { class: 'id', text: it.id }),
      appH('span', { class: 'nm' }, [appH('span', { text: it.name })].concat(it.sample ? [appSampleBadge()] : [])),
      appH('span', { class: 'st', text: st })
    ]));
  });
  return tiles;
}
function appFindPanel() {
  var tt = APP.tt;
  var sec = appH('div', { class: 'section' }, [appH('h3', { text: APP.tt('btn_find') })]);
  var input = appH('input', { type: 'search', placeholder: tt('ui_find_placeholder'), value: APP.findText, autocomplete: 'off' });
  var run = function () {
    APP.findText = input.value.trim();
    if (!APP.findText) { APP.findResults = null; appRender(); return; }
    var staff = APP.store.meta.staff;
    var found = findItemsByName(APP.phone.ports, staff.role === 'owner' ? null : staff.shop, APP.findText);
    if (!found.length && staff.role !== 'owner') found = findItemsByName(APP.phone.ports, null, APP.findText);
    APP.findResults = found.slice(0, 8);
    if (!found.length) appToast(tt('ui_find_none'));
    appRender();
  };
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
  sec.appendChild(appH('div', { class: 'inbar' }, [input, appH('button', { class: 'primary iconbtn', 'aria-label': tt('ui_aria_search'), html: appIconSvg('search'), onclick: run })]));
  if (APP.findResults && APP.findResults.length) sec.appendChild(appTiles(APP.findResults));
  return sec;
}

/* ---------- the card ---------- */
function appPhotoNode(m, small) {
  var pic = appH('div', { class: 'pic' + (small ? ' small' : '') });
  var media = m.photo ? APP.store.getMedia(m.photo) : null;
  var itemId = appItemIdFromText(m.text);
  var item = itemId ? APP.phone.ports.store.getItem(itemId) : null;
  var thumb = itemId ? APP.store.thumb(itemId) : null;
  var src = null;
  if (media && media.dataUrl) src = media.dataUrl;
  else if (media && media.blob && typeof URL !== 'undefined' && URL.createObjectURL) { try { src = URL.createObjectURL(media.blob); } catch (ignore) {} }
  else if (thumb && String(thumb).indexOf('data:') === 0) src = thumb;
  else if (typeof m.photo === 'string' && /^(https?:|data:|blob:)/.test(m.photo) && !/drive\.google|googleusercontent/.test(m.photo)) src = m.photo;
  if (src) { pic.appendChild(appH('img', { src: src, alt: '' })); return pic; }
  var visual = media && media.visual;
  if (visual) { pic.setAttribute('style', 'background:' + visual.bg + ';color:#fff'); pic.textContent = visual.emoji; }
  else pic.appendChild(appIcon('camera'));                   // no emoji in the app (13.1); a preset picture keeps its own
  if (item && item.photoUrl && String(item.photoUrl).indexOf('local://') !== 0 && !thumb && !APP.thumbAsked[itemId] && APP.sync.online()) {
    APP.thumbAsked[itemId] = true;
    APP.sync.fetchThumbs([itemId]);
  }
  return pic;
}

function appRenderReport(rep) {
  var wrap = appH('div', { class: 'rep' });
  if (rep.subtitle) wrap.appendChild(appH('div', { class: 'sub', text: rep.subtitle }));
  var cell = function (v) { return typeof v === 'number' ? fmtMoney(v) : (v === undefined || v === null ? '' : String(v)); };
  rep.sections.forEach(function (sec) {
    if (sec.heading) wrap.appendChild(appH('h4', { text: sec.heading }));
    var thead = appH('thead', {}, [appH('tr', {}, sec.columns.map(function (c) { return appH('th', { text: c }); }))]);
    var tbody = appH('tbody', {}, sec.rows.map(function (r) { return appH('tr', {}, r.map(function (v) { return appH('td', { class: typeof v === 'number' ? 'r' : '', text: cell(v) }); })); }));
    (sec.totals || []).forEach(function (r) { tbody.appendChild(appH('tr', { class: 'tot' }, r.map(function (v) { return appH('td', { class: typeof v === 'number' ? 'r' : '', text: cell(v) }); }))); });
    if (!sec.rows.length && !(sec.totals || []).length) tbody.appendChild(appH('tr', {}, [appH('td', { colspan: String(sec.columns.length), text: '—' })]));
    wrap.appendChild(appH('div', { class: 'wrap' }, [appH('table', {}, [thead, tbody])]));
  });
  // The footer may hold line breaks (a receipt prints one transfer account per line).
  if (rep.footer) wrap.appendChild(appH('div', { class: 'sub foot', style: 'white-space: pre-line', text: rep.footer }));
  return wrap;
}
/** Plain-text form of a report for the share sheet. */
function appReportText(rep) {
  var lines = [rep.title];
  if (rep.subtitle) lines.push(rep.subtitle);
  rep.sections.forEach(function (sec) {
    if (sec.heading) lines.push('— ' + sec.heading);
    sec.rows.concat(sec.totals || []).forEach(function (r) { lines.push(r.map(function (v) { return typeof v === 'number' ? fmtMoney(v) : String(v === undefined || v === null ? '' : v); }).join(' · ')); });
  });
  if (rep.footer) lines.push(rep.footer);
  return lines.join('\n');
}

/** renderMsg from poc/sim_ui.js, re-laid-out as one large card; opts.big adds the stepper and the share/PDF actions. */
function appRenderMsg(m, opts) {
  opts = opts || {};
  var tt = APP.tt, ports = APP.phone.ports;
  var cls = 'card ' + (m.from === 'bot' ? 'bot' : 'user') + (m.system ? ' system' : '') + (m.pending ? ' pending' : '');
  var node = appH('div', { class: cls });
  if (m.from === 'user') {
    if (m.voice !== undefined) {
      node.appendChild(appH('div', { class: 'voice' }, [appIcon('microphone'), appH('span', { class: 'wave', text: '▂▃▅▇▅▃▂▃▅▃▂' }), appH('span', { text: m.durationMs ? Math.round(m.durationMs / 1000) + 's' : '' })]));
      if (m.voice) node.appendChild(appH('div', { class: 'muted small', text: '“' + m.voice + '”' }));
    } else if (m.photo) {
      node.appendChild(appPhotoNode(m, true));
      if (m.text) node.appendChild(document.createTextNode(m.text));
    } else node.appendChild(document.createTextNode(m.text || ''));
  } else {
    if (m.photo) node.appendChild(appPhotoNode(m, !opts.big));
    var viewNode = m.view && !m.document ? appViewNode(m.view) : null;   // a card drawn as a clean list (13.9)
    if (m.document) {
      node.appendChild(appH('div', { class: 'doc' }, [appIcon('file-text'), appH('span', { text: m.document.name })]));
      if (m.text) node.appendChild(appH('div', { text: appPlain(m.text) }));
      if (m.document.report) {
        var det = appH('details', { class: 'rep' }, [appH('summary', { text: tt('ui_report_preview') }), appRenderReport(m.document.report)]);
        if (opts.big) det.setAttribute('open', 'open');
        node.appendChild(det);
        if (opts.big) node.appendChild(appDocActions(m));
      }
    } else if (viewNode) {
      node.className += ' viewcard';
      node.appendChild(viewNode);
    } else {
      node.appendChild(document.createTextNode(appPlain(m.text || '')));
    }
    var info = opts.big ? appCardInfo(m) : null;
    if (info && info.sku) node.appendChild(appStepper(m, info));
    var kb = info ? appKeyboardForCard(m.keyboard, info) : (m.keyboard || []);
    if (kb.length) {
      var hot = APP.win ? APP.win.SIM_HOT : undefined;   // set by the simulator page on the frame's window; never in the real app
      var grid = opts.big && appIsMenuMessage(ports, m);
      var kbNode = appH('div', { class: 'kb' + (grid ? ' grid' : '') });
      var cancelText = t(ports, 'btn_cancel');
      kb.forEach(function (row) {
        var r = grid ? kbNode : appH('div', { class: 'row' });
        row.forEach(function (b) {
          // Plain labels except the main menu's (13.1); a button whose text is btn_cancel's reads 'Cancel' (UX-m1).
          var label = grid ? b.text : (b.text === cancelText ? tt('ui_w_cancel') : appPlain(b.text));
          // data-cb: a tour finds the button by its callback; hot: the button the tour expects next.
          var btn = appH('button', { text: label, 'data-cb': b.callback_data, onclick: function () { appOnTap(m, b.callback_data, btn); } });
          if (info && !info.sku && b.callback_data === info.sellData) btn.className = 'good';
          if (hot && b.callback_data === hot) btn.className = (btn.className ? btn.className + ' ' : '') + 'hot';
          r.appendChild(btn);
        });
        if (!grid) kbNode.appendChild(r);
      });
      node.appendChild(kbNode);
    }
  }
  // The time alone: no English 'edited' marker in the app (F8's word list; checker's fix of step 3).
  node.appendChild(appH('span', { class: 'time' }, [timeKey(new Date(m.ts))]));
  return node;
}

function appStepper(m, info) {
  var tt = APP.tt;
  if (APP.qty.msgId !== m.id) APP.qty = { msgId: m.id, n: 1 };
  var wrap = appH('div');
  var nNode = appH('div', { class: 'n', text: String(APP.qty.n), onclick: function () {
    appOpenNumberKeypad({ title: tt('ui_keypad_qty'), initial: APP.qty.n, max: CFG.MAX_SALE_QTY, onOk: function (v) { APP.qty.n = Math.max(1, Math.min(CFG.MAX_SALE_QTY, v)); appRender(); } });
  } });
  wrap.appendChild(appH('div', { class: 'stepper' }, [
    appH('button', { text: '−', onclick: function () { APP.qty.n = Math.max(1, APP.qty.n - 1); appRender(); } }),
    nNode,
    appH('button', { text: '+', onclick: function () { APP.qty.n = Math.min(CFG.MAX_SALE_QTY, APP.qty.n + 1); appRender(); } })
  ]));
  var label = APP.qty.n === 1 ? appPlain(info.sellText) : tt('ui_sell_n', { n: fmtCount(APP.qty.n) });
  var hot = APP.win ? APP.win.SIM_HOT : undefined;
  var isHot = typeof hot === 'string' && hot.indexOf('S|' + info.itemId + '|') === 0;   // the tour's next tap is this sell button
  var sell = appH('button', { class: 'good sell' + (isHot ? ' hot' : ''), 'data-cb': appStepperData(info.itemId, APP.qty.n), text: label,
    onclick: function () { appOnTap(m, appStepperData(info.itemId, APP.qty.n), sell); } });
  wrap.appendChild(sell);
  return wrap;
}

function appDocActions(m) {
  var tt = APP.tt, row = appH('div', { class: 'kb' }), r = appH('div', { class: 'row' });
  var rep = m.document.report, kind = appReportApiKind(rep, APP.phone.now());
  if (kind) {
    r.appendChild(appH('button', { text: APP.pdfBusy ? tt('ui_pdf_sending') : tt('ui_btn_pdf_telegram'), disabled: APP.pdfBusy, onclick: function () {
      if (!APP.sync.online()) { appToast(tt('app_need_online')); return; }
      APP.pdfBusy = true;
      appRender();
      var groupId = kind === 'receipt' ? (rep.groupId || (m.text && /R[12]-/.test(m.text) ? appReceiptGroupFor(rep) : '')) : null;
      APP.sync.requestReport(kind, groupId, false).then(function (res) {
        APP.pdfBusy = false;
        appRender();
        appToast(res.ok ? tt('app_report_sent') : (res.transportFailure ? tt('app_need_online') : tt('ui_pdf_failed')), !res.ok);
      });
    } }));
  }
  r.appendChild(appHi('button', { text: tt('ui_w_share'), onclick: function () { appShareText(appReportText(rep), rep.title); } }, 'share'));
  row.appendChild(r);
  return row;
}
/** The sale group of a receipt report: the receipt number is on the SALE row. */
function appReceiptGroupFor(rep) {
  var no = String(rep.fileName || ''), rows = APP.store.ledger;
  for (var i = rows.length - 1; i >= 0; i--) if (rows[i].receiptNo === no) return rows[i].groupId;
  var groupId = '';
  rows.forEach(function (r) { if (r.type === CFG.TX.SALE && receiptNumber(APP.phone.ports, r.groupId) === no) groupId = r.groupId; });
  return groupId;
}
function appShareText(text, title) {
  var nav = APP.win && APP.win.navigator;
  if (nav && nav.share) { nav.share({ text: text, title: title || '' }).then(null, function () {}); return; }
  if (nav && nav.clipboard && nav.clipboard.writeText) { nav.clipboard.writeText(text).then(function () { appToast(APP.tt('ui_copied')); }, function () {}); }
}

/** The core is waiting for something typed: a keypad for numbers, a text field for names, a photo button. */
/**
 * The core is waiting for something typed (13.5, F4: no chat box): the keypad bar for numbers, the Photo button, a search
 * field where searching happens, a labelled field with OK for any other question; none under a report or a view card.
 */
function appInputBar(m) {
  var tt = APP.tt, state = appState(), mode = appInputModeFor(state);
  // A screen without a number prompt frees the key: the same prompt shown again (after ⏮, or ✏️ a second time) opens the keypad again.
  if (!state || state.kind !== 'await_number') APP.keypadAutoFor = null;
  if (!mode || (m && (m.document || m.view))) return null;
  if (mode === 'number') {
    var title = appPlain(appFirstLine(m.text));
    var key = appKeypadKeyFor(m, state);
    if (state.kind === 'await_number' && APP.keypadAutoFor !== key) {
      APP.keypadAutoFor = key;
      if (APP.win && APP.win.setTimeout) APP.win.setTimeout(function () { appOpenNumberKeypad({ title: title, initial: 0, onOk: function (v) { appSendText(String(v)); } }); }, 0);
    }
    return appH('div', { class: 'inbar' }, [appHi('button', { class: 'primary', style: 'flex:1', text: tt('ui_type_number_bar'), onclick: function () {
      appOpenNumberKeypad({ title: title, initial: 0, onOk: function (v) { appSendText(String(v)); } });
    } }, 'keyboard')]);
  }
  if (mode === 'photo') return appH('div', { class: 'inbar' }, [appHi('button', { class: 'primary', style: 'flex:1', text: tt('ui_w_photo'), onclick: function () { appPickPhoto(); } }, 'camera')]);
  var input, send = function () { var v = input.value.trim(); if (!v) return; input.value = ''; appSendText(v); };
  if (state.kind === 'find' || state.kind === 'find_customer') {
    var ph = state.kind === 'find' ? tt('ui_find_placeholder') : tt('cust_find');
    input = appH('input', { type: 'search', placeholder: ph, 'aria-label': ph, autocomplete: 'off' });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    return appH('div', { class: 'inbar' }, [input, appH('button', { class: 'primary iconbtn', 'aria-label': tt('ui_aria_search'), html: appIconSvg('search'), onclick: send })]);
  }
  // A labelled field: the waiting question (the first line of the latest bot message), the input, OK ('tel': the phone keyboard).
  var question = appPlain(appFirstLine(m && m.text));
  input = appH('input', { type: 'text', inputmode: mode === 'tel' ? 'tel' : null, autocomplete: 'off', 'aria-label': question });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  return appH('div', { class: 'askbar' }, [appH('label', { text: question }), appH('div', { class: 'inbar' }, [input, appH('button', { class: 'primary', text: tt('ui_w_ok'), onclick: send })])]);
}
function appFirstLine(text) { return String(text || '').split('\n')[0]; }
function appSendText(text) {
  APP.tapStart = APP.win && APP.win.performance ? APP.win.performance.now() : 0;
  APP.phone.sim.text(text);
}

/** A button on a card. Undo and the owner's void ask first (appAskUndo); the rest goes to appTapSend at once. */
function appOnTap(m, data, btn) {
  var parts = String(data || '').split('|');
  if (parts[0] === 'U' || parts[0] === 'V') { appAskUndo(parts[0] === 'V', function () { appTapSend(m, data, btn); }); return; }
  appTapSend(m, data, btn);
}
/** The tap itself. Transfers need a fresh pull (online only); everything else is local and instant. */
function appTapSend(m, data, btn) {
  var tt = APP.tt, parts = String(data || '').split('|');
  if (parts[0] === 'X') {
    if (!APP.sync.online() || APP.store.outbox.length || APP.store.meta.lastSyncOk === null) { appToast(tt('ui_transfer_online'), true); return; }
    appOpenScreen('stockslips', parts[1]); return;
  }
  if (btn) btn.className += ' busy';
  APP.tapStart = APP.win && APP.win.performance ? APP.win.performance.now() : 0;
  APP.phone.sim.tap(m.id, data).then(null, function () { appRender(); });
}
/**
 * Leaving the home's card by Menu or Scan does what its ✖️ and ← do (appNavPop's card rule): the question that card was
 * waiting for is dropped, so a later card never gets a field or a keypad that feeds the old question (fixer, review of
 * step 3). keepScan (the Scan button): a state that draws no field (🏷 order_tag waits for the scanned tag) stays.
 */
function appDropWaiting(keepScan) {
  var st = appState();
  if (!st || (keepScan && !appInputModeFor(st))) return;
  clearState(APP.phone.ports, appUid());
}
/** The bottom bar's Scan: every layer closed (a form's draft kept), the waiting question dropped, the camera started. */
function appOnScanButton() {
  appNavReset();
  appDropWaiting(true);
  appRender();
  appStartScanner();
}
function appOpenMenu() {
  if (APP.screen !== 'home' || APP.form || APP.measForm) appNavReset();
  appDropWaiting(false);
  APP.showScanner = false;
  APP.tapStart = APP.win && APP.win.performance ? APP.win.performance.now() : 0;
  APP.phone.sim.start('');
}

/* ---------- sync screen ---------- */
function appRenderSync(main) {
  var tt = APP.tt, sync = APP.sync, st = sync.chipState(), meta = APP.store.meta;
  // Label/value rows (review r3, UX-M8); the header carries ← and the title.
  var p = appH('div', { class: 'panel' });
  p.appendChild(appKv(tt('ui_lbl_state'), appPlain(st.offline && st.kind !== 'never' ? tt('ui_sync_offline') : st.text)));
  p.appendChild(appKv(tt('ui_lbl_last_sync'), meta.lastSyncOk ? fmtDayShortMy(dayKey(new Date(meta.lastSyncOk))) + ' ' + timeKey(new Date(meta.lastSyncOk)) : tt('ui_sync_last_never')));
  if (meta.lastSyncError && sync.state !== 'ok') p.appendChild(appKv(tt('ui_sync_problem'), appPlain(sync.errorText(meta.lastSyncError))));
  if (Math.abs(meta.offsetMs || 0) > 60000) p.appendChild(appH('div', { class: 'muted small', text: tt('ui_clock_offset', { min: myDigits(Math.round(Math.abs(meta.offsetMs) / 60000)) }) }));
  p.appendChild(appH('div', { class: 'muted small', text: APP.persisted === true ? tt('ui_storage_persisted') : APP.persisted === false ? tt('ui_storage_not') : tt('ui_storage_unknown') }));
  main.appendChild(p);
  var pend = appH('div', { class: 'panel' }, [appH('h3', { text: tt('ui_sync_pending_title') })]);
  var lines = sync.pendingLines(12);
  if (!lines.length) pend.appendChild(appH('div', { class: 'muted', text: tt('ui_sync_pending_none') }));
  else pend.appendChild(appH('ul', { class: 'pend' }, lines.map(function (l) { return appH('li', { text: appPlain(l.text) }); })));
  main.appendChild(pend);
  if (st.suggestExport) main.appendChild(appH('div', { class: 'card pending', text: tt('ui_export_suggest', { h: myDigits(Math.floor(st.ageMs / 3600000)) }) }));
  var actions = appH('div', { class: 'stack' });
  actions.appendChild(appH('button', { class: 'primary', text: sync.inFlight ? tt('ui_sync_sending') : tt('ui_btn_sync_now'), disabled: !!sync.inFlight, onclick: function () {
    sync.failures = 0;
    sync.syncNow('manual').then(function (s) { if (!s.ok && s.error) appToast(appPlain(sync.errorText(s.error)), true); });
    appRender();
  } }));
  actions.appendChild(appH('button', { class: st.suggestExport ? 'primary' : '', text: tt('ui_btn_export'), onclick: function () {
    sync.shareExport().then(function (how) { appToast(how === 'empty' ? tt('ui_export_none') : tt('ui_export_done')); });
  } }));
  actions.appendChild(appH('div', { class: 'muted small', text: tt('ui_export_hint') }));
  main.appendChild(actions);
}

/* ---------- settings ---------- */
function appRenderSettings(main) {
  var tt = APP.tt, meta = APP.store.meta, ports = APP.phone.ports;
  // Label/value rows (review r3, UX-M8); the header carries ← and the title 'Settings'.
  var p = appH('div', { class: 'panel' });
  if (meta.staff) { p.appendChild(appKv(tt('ui_lbl_staff'), meta.staff.name)); p.appendChild(appKv(tt('ui_lbl_shop'), shopName(ports, meta.staff.shop))); }
  if (meta.deviceId) { p.appendChild(appKv(tt('ui_lbl_device'), meta.label)); p.appendChild(appKv(tt('ui_lbl_letter'), meta.receiptLetter || '-', { cls: 'num' })); }
  main.appendChild(p);
  if (meta.deviceId && officeRole(meta.staff.role)) {
    appOfficeJobs(main, meta.staff);
    main.appendChild(appOfficeButton('ဖုန်း ပြန်ချိတ်ဆက်', function () {
      appAsk({ kind: 'disconnect', title: tt('ui_ask_reenroll'), yes: tt('ui_ask_reenroll_yes'), no: tt('ui_w_cancel'),
        onYes: function () { APP.store.wipe().then(function () { appNavReset(); APP.officePage = null; APP.screen = 'enroll'; appRender(); }); } });
    })); return;
  }
  if (meta.deviceId) {
    if (meta.staff.role !== 'owner' && hasJob(meta.staff, 'staff') && meta.scope && meta.scope.length > 1) {
      var site = appOfficeSelect('လက်ရှိဆိုင်', meta.scope.map(function (id) { return { id: id, name: shopName(ports, id) }; }), meta.staff.shop);
      site.onchange = function () {
        clearState(ports, appUid()); APP.store.setMeta({ staff: syncMerge(meta.staff, { shop: site.value }) });
        APP.phone.commit('shop').then(function () { appNavReset(); APP.screen = 'home'; APP.showScanner = true; appRender(); });
      };
      appOfficeField(main, 'လက်ရှိဆိုင်', site);
    }
    if (meta.staff.role !== 'owner') appOfficeJobs(main, meta.staff);
    else {
      main.appendChild(appOfficeButton('အော်ဒါနှင့် အတိုင်းအတာ', function () { appOpenScreen('orders'); }));
      main.appendChild(appOfficeButton('ပစ္စည်းအသစ်နှင့် နမူနာ', function () { appOpenScreen('designs'); }));
    }
    var aiBox = appH('div', { class: 'panel' });
    if (meta.staff.role === 'owner') {
      main.appendChild(appOfficeButton('ဝန်ထမ်းနှင့် သုံးခွင့်', function () { appOpenScreen('people'); }));
      main.appendChild(appOfficeButton('ဆိုင် ဖွင့် / ပိတ်', function () { appOpenScreen('shops'); }));
    }
    appSettingsAi(aiBox);                                    // the owner's AI switch (13.11)
    main.appendChild(aiBox);
    main.appendChild(appH('button', { text: 'ဆိုင်စာရင်း ကြည့်မယ်', onclick: function () { appOpenScreen('closing'); } }));
    appSettingsShops(main);                                  // the owner's Shops section (13.12)
  }
  p = appH('div', { class: 'panel' });
  var size = String(APP.store.getPref('fontSize', APP.doc.documentElement.getAttribute('data-font') || '1'));
  var seg = appH('div', { class: 'seg' }, ['1', '2', '3'].map(function (v, i) {
    return appH('button', { class: size === v ? 'on' : '', text: ['A', 'A+', 'A++'][i], onclick: function () {
      APP.store.setPref('fontSize', v);
      APP.doc.documentElement.setAttribute('data-font', v);
      try { APP.win.localStorage.setItem('fontSize', v); } catch (ignore) {}
      APP.phone.commit('pref');
    } });
  }));
  p.appendChild(appH('div', { class: 'kv' }, [appH('span', { class: 'k', text: tt('ui_font_size') })]));
  p.appendChild(seg);
  var textCards = settingOn(ports, 'text_cards');
  p.appendChild(appH('div', { class: 'kv' }, [appH('span', { class: 'k', text: tt('ui_text_cards') }), appH('button', { class: 'switch' + (textCards ? ' on' : ''), text: textCards ? tt('ui_on') : tt('ui_off'), onclick: function () {
    APP.store.setPref('setting:text_cards', textCards ? 'FALSE' : 'TRUE');
    APP.phone.commit('pref');
  } })]));
  var build = typeof APP_BUILD !== 'undefined' ? APP_BUILD : { version: APP.config.version || 'dev', hash: '' };
  p.appendChild(appKv(tt('ui_lbl_version'), build.version + (build.hash ? ' ' + build.hash : '') + ' / sync v' + SYNC.VERSION, { cls: 'num' }));
  if (APP.updateReady) p.appendChild(appH('div', { class: 'muted small', text: tt('ui_update_ready') }));
  if (meta.tapMs && meta.tapMs.length) p.appendChild(appH('div', { class: 'muted small', text: tt('ui_tap_ms', { ms: Math.round(appMedian(meta.tapMs)) }) }));
  main.appendChild(p);
  var actions = appH('div', { class: 'stack' });
  // Disconnecting the phone always asks (the UX review): a stray tap here would leave the seller on the enrol screen
  // without a code; the question names what is lost (unsent entries) and that the owner can help.
  actions.appendChild(appH('button', { class: 'danger', text: tt('ui_btn_reenroll'), onclick: function () {
    var pending = APP.store.outbox.length;
    appAsk({ kind: 'reenroll', title: tt('ui_ask_reenroll'), text: (pending ? tt('ui_confirm_wipe', { n: fmtCount(pending) }) + ' ' : '') + tt('ui_ask_reenroll_text'),
      yes: tt('ui_ask_reenroll_yes'), no: tt('ui_w_cancel'), danger: true, onYes: function () {
        appStopScanner();
        APP.store.wipe().then(function () { appNavReset(); APP.screen = 'enroll'; APP.enrollError = ''; appRender(); });
      } });
  } }));
  main.appendChild(actions);
}

/* ------------------------------ keypads ------------------------------ */

/** Close the sheet; its layer is dropped unless the back press that closes it already removed it (opts.fromNav). */
function appCloseOverlay(opts) {
  var o = APP.$('overlay');
  if (!o) return;
  var open = !o.hidden;
  appClear(o);
  o.hidden = true;
  if (open && !(opts && opts.fromNav)) appNavDrop('sheet');
}
/** A sheet opened: its layer pushed once (a redraw of the same sheet pushes nothing). */
function appOpenSheet(o) {
  var top = appNavTop();
  if (o.hidden || !top || top.kind !== 'sheet') appNavPush({ kind: 'sheet' });
  o.hidden = false;
}
function appOpenTagKeypad() {
  var tt = APP.tt, staff = APP.store.meta.staff;
  var state = { shop: (staff && staff.shop) || 'S1', digits: '' };
  var o = APP.$('overlay');
  function draw() {
    appClear(o);
    var sheet = appH('div', { class: 'sheet' }, [appH('h3', { text: tt('ui_keypad_title') })]);
    sheet.appendChild(appH('div', { class: 'seg' }, CFG.SHOP_IDS.map(function (s) {
      return appH('button', { class: state.shop === s ? 'on' : '', text: shopName(APP.phone.ports, s), onclick: function () { state.shop = s; draw(); } });
    })));
    var shown = state.shop + '-' + (state.digits + '____').slice(0, 4);
    sheet.appendChild(appH('div', { class: 'display tag', text: shown }));
    var keys = appH('div', { class: 'keys' });
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].forEach(function (k) {
      var a = { class: k === 'del' || k === 'ok' ? 'op' : '', text: k === 'ok' ? tt('ui_w_ok') : k, onclick: function () {
        if (k === 'del') state.digits = state.digits.slice(0, -1);
        else if (k === 'ok') { if (state.digits.length === 4) { appCloseOverlay(); appOpenTagId(state.shop + '-' + state.digits); } return; }
        else if (state.digits.length < 4) state.digits += k;
        if (state.digits.length === 4) { appCloseOverlay(); appOpenTagId(state.shop + '-' + state.digits); return; }
        draw();
      } };
      if (k === 'del') { delete a.text; a.html = appIconSvg('backspace'); a['aria-label'] = tt('ui_aria_backspace'); }
      keys.appendChild(appH('button', a));
    });
    sheet.appendChild(keys);
    sheet.appendChild(appH('div', { class: 'actions' }, [appH('button', { class: 'ghost', text: tt('ui_w_cancel'), onclick: function () { appCloseOverlay(); } })]));
    o.appendChild(sheet);
  }
  draw();
  appOpenSheet(o);
}
/** Numbers for the core (prices, amounts, counts): big keys, 000 for kyat, OK sends the value. */
function appOpenNumberKeypad(spec) {
  var tt = APP.tt;
  var state = { digits: spec.initial ? String(spec.initial) : '' };
  var o = APP.$('overlay');
  function draw() {
    appClear(o);
    var sheet = appH('div', { class: 'sheet' }, [appH('h3', { text: appPlain(spec.title || tt('ui_keypad_number')) })]);
    sheet.appendChild(appH('div', { class: 'display', text: state.digits ? fmtMoney(Number(state.digits)) : '0' }));
    var keys = appH('div', { class: 'keys' });
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'del'].forEach(function (k) {
      var a = { class: k === 'del' ? 'op' : '', text: k, onclick: function () {
        if (k === 'del') state.digits = state.digits.slice(0, -1);
        else if (state.digits.length < 10) state.digits = (state.digits === '0' ? '' : state.digits) + k;
        if (spec.max && Number(state.digits) > spec.max) state.digits = String(spec.max);
        draw();
      } };
      if (k === 'del') { delete a.text; a.html = appIconSvg('backspace'); a['aria-label'] = tt('ui_aria_backspace'); }
      keys.appendChild(appH('button', a));
    });
    sheet.appendChild(keys);
    sheet.appendChild(appH('div', { class: 'actions' }, [
      appH('button', { class: 'ghost', text: tt('ui_w_cancel'), onclick: function () { appCloseOverlay(); } }),
      appH('button', { class: 'primary', text: tt('ui_w_ok'), disabled: !state.digits || Number(state.digits) <= 0, onclick: function () {
        var v = Number(state.digits);
        appCloseOverlay();
        if (v > 0) spec.onOk(v);
      } })
    ]));
    o.appendChild(sheet);
  }
  draw();
  appOpenSheet(o);
}
/**
 * The date sheet (the sale form's promised day, U21a): an input from today to opts.max; OK with a date calls
 * onOk(yyyy-mm-dd), OK with none does nothing.
 */
function appOpenDateSheet(onOk, opts) {
  var tt = APP.tt, o = APP.$('overlay');
  opts = opts || {};
  appClear(o);
  var input = appH('input', { type: 'date', min: dayKey(APP.phone.now()), max: opts.max || null });
  var sheet = appH('div', { class: 'sheet' }, [appH('h3', { text: tt('ui_date_title') }), input]);
  sheet.appendChild(appH('div', { class: 'actions' }, [
    appH('button', { class: 'ghost', text: tt('ui_w_cancel'), onclick: function () { appCloseOverlay(); } }),
    appH('button', { class: 'primary', text: tt('ui_w_ok'), onclick: function () {
      var v = String(input.value || '');
      if (!v) return;
      appCloseOverlay();
      if (onOk) onOk(v);
    } })
  ]));
  o.appendChild(sheet);
  appOpenSheet(o);
}

/* ------------------------------ the measurement form (spec 9.3) ------------------------------ */
// Its own element div#measForm.formpage on document.body, never drawn into #overlay (the keypads clear that
// element, and the dev page keeps it inside the phone frame). The logic lives in the pure appMeas* helpers above.

/** ports.ui.measureForm (app_ports.js) emits 'measureform' inside the core's run; the form opens once that run is over. */
function appOnMeasureForm(req) {
  if (!APP || !APP.doc || !req || !req.customerId) return;
  var open = function () { appOpenMeasForm(req); };
  if (APP.win && APP.win.setTimeout) APP.win.setTimeout(open, 0); else open();
}

function appOpenMeasForm(req) {
  var tt = APP.tt, ports = APP.phone.ports, doc = APP.doc;
  if (APP.measForm) appCloseMeasForm({});                    // (cannot normally happen: the form covers the screen)
  if (APP.form) appCloseForm({ keep: true });
  appCloseOverlay();
  appStopScanner();
  var M = appMeasModel(ports, APP.store, req);
  // One note (13.7.1): a restored draft's notes go into the note field when the form has one; else they stay notes.
  var noteField = M.fields.some(function (f) { return f.key === CFG.MEAS_NOTE_KEY; });
  var values = M.restored ? appMeasNoteMerge(M.fields, M.values, M.notes) : M.values;
  var dec = appSketchDecode(M.sketch);
  var F = { req: req, model: M, values: {}, dirty: M.restored, timer: null, el: null, grid: null, voucherEl: null, idEl: null, notesEl: null, msgEl: null,
    noteField: noteField, sketch: dec ? { fig: dec.fig, strokes: dec.strokes } : { fig: 'F', strokes: [] } };
  Object.keys(values).forEach(function (k) { F.values[k] = values[k]; });
  APP.measForm = F;

  var page = appH('div', { id: 'measForm', class: 'formpage', role: 'dialog', 'aria-modal': 'true' });
  var col = appH('div', { class: 'fcol' });
  col.appendChild(appH('div', { class: 'fhead' }, [
    appH('button', { type: 'button', class: 'iconbtn back', 'data-f': 'close', 'aria-label': tt('ui_aria_back'), html: appIconSvg('arrow-left'), onclick: function () { appNavBack(); } }),
    appH('h2', { text: tt('ui_meas_title', { customer: M.customer }) })
  ]));
  if (M.prev || M.restored) {
    col.appendChild(appH('div', { class: 'fprev' }, [
      appH('span', { class: 'muted', text: M.prev ? tt('ui_meas_prev', { date: fmtDayShortMy(M.prev.day) }) : '' }),
      appH('button', { type: 'button', text: tt('ui_meas_clear'), onclick: function () { appMeasClear(F); } })
    ]));
  }
  // The voucher: digits become the id of the staff's shop, shown under the input; anything else is dropped.
  F.voucherEl = appH('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '12', enterkeyhint: 'next', value: M.voucher, 'aria-label': tt('ui_meas_voucher') });
  F.idEl = appH('div', { class: 'vid', text: appMeasVoucher(M.voucher, M.shop).id });
  F.voucherEl.addEventListener('input', function () { F.idEl.textContent = appMeasVoucher(F.voucherEl.value, M.shop).id; appMeasChanged(F); });
  F.voucherEl.addEventListener('change', function () { appMeasVoucherCheck(F); });
  col.appendChild(appH('div', { class: 'ffield fvoucher' }, [appH('label', { text: tt('ui_meas_voucher') }), F.voucherEl, F.idEl]));
  // At 700 px and wider two columns: the fields left, the figure right (sticky). Below, one column in page order: the
  // measurement groups (F.grid), the figure, then the note and what follows it (F.grid2), as on the paper sheet (13.7.2).
  var split = appH('div', { class: 'msplit' });
  F.grid = appH('div', { class: 'fgrid' });
  split.appendChild(F.grid);
  F.sketchBox = appH('div', { class: 'fsketchbox' });
  split.appendChild(F.sketchBox);
  F.grid2 = appH('div', { class: 'fgrid fgrid2' });
  split.appendChild(F.grid2);
  col.appendChild(split);
  appMeasDrawFields(F);
  page.appendChild(col);
  F.msgEl = appH('div', { class: 'fmsg', hidden: 'hidden' });
  page.appendChild(appH('div', { class: 'fbar' }, [appH('div', { class: 'fbar-in' }, [
    F.msgEl,
    appH('button', { type: 'button', class: 'good', 'data-f': 'save', text: tt('ui_w_save'), onclick: function () { appMeasFormSave(); } })
  ])]));
  // Enter moves to the next input and never submits (the notes box keeps Enter for a new line).
  page.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    var list = Array.prototype.slice.call(page.querySelectorAll('input, textarea'));
    var i = list.indexOf(e.target);
    if (i >= 0 && i + 1 < list.length) list[i + 1].focus(); else e.target.blur();
  });
  F.el = page;
  doc.body.appendChild(page);
  appNavPush({ kind: 'meas' });
}

/**
 * The fields under their group headings: one box per number field, `multi` boxes side by side, a text box, the side
 * toggle; the note (the MeasureFields row with the key note) as a 300-character box. The figure goes between the last
 * measurement group and the note (13.7.2): the fields before the note fill F.grid, the note and any field after it F.grid2
 * (under its own group heading), so the one-column page reads groups, figure, note; at 700 px and wider the figure's box
 * is the sticky right column beside both (app.css .msplit).
 */
function appMeasDrawFields(F) {
  var ports = APP.phone.ports, lastGroup = null, placed = false, into = F.grid;
  appClear(F.grid);
  if (F.grid2) appClear(F.grid2);
  var pad = function () {
    if (placed || !F.sketchBox) return;
    placed = true;
    appClear(F.sketchBox);
    if (F.skResize && APP.win && APP.win.removeEventListener) APP.win.removeEventListener('resize', F.skResize);
    F.sketchBox.appendChild(appSketchPad(F));
    if (F.grid2) { into = F.grid2; lastGroup = null; }
  };
  F.model.fields.forEach(function (f) {
    if (f.key === CFG.MEAS_NOTE_KEY) pad();
    if (f.group !== lastGroup) { into.appendChild(appH('h3', { text: measGroupLabel(ports, f.group) })); lastGroup = f.group; }
    into.appendChild(appMeasFieldNode(F, f));
  });
  pad();
}

function appMeasFieldNode(F, f) {
  var ports = APP.phone.ports, value = F.values[f.key] || '';
  var wrap = appH('div', { class: 'ffield' }, [appH('label', { text: f.labelMy })]);
  var box = function (attrs, initial, onInput) {
    var a = { type: 'text', autocomplete: 'off', enterkeyhint: 'next', 'aria-label': f.labelMy };
    Object.keys(attrs).forEach(function (k) { a[k] = attrs[k]; });
    var el = appH('input', a);
    el.value = initial;
    el.addEventListener('input', function () { onInput(el); });
    return el;
  };
  if (f.key === 'htamein_side' && appMeasSide(ports, value) !== 'text') {
    var L = t(ports, 'btn_left'), R = t(ports, 'btn_right');
    var row = appH('div', { class: 'toggle' });
    var paint = function () { bl.className = F.values[f.key] === L ? 'on' : ''; br.className = F.values[f.key] === R ? 'on' : ''; };
    var set = function (v) { if (F.values[f.key] === v) delete F.values[f.key]; else F.values[f.key] = v; paint(); appMeasChanged(F); };
    var bl = appH('button', { type: 'button', text: L, onclick: function () { set(L); } });
    var br = appH('button', { type: 'button', text: R, onclick: function () { set(R); } });
    row.appendChild(bl);
    row.appendChild(br);
    paint();
    wrap.appendChild(row);
    return wrap;
  }
  if (f.type === 'number' && f.multi > 1) {
    // The decimal keypads of phones have no '/': one box per value, joined with '/' on save.
    var parts = appMeasSplit(value, f.multi), boxes = [];
    var multi = appH('div', { class: 'multi' });
    parts.forEach(function (p, i) {
      var el = box({ inputmode: 'decimal', maxlength: String(APP_MEAS_PART_MAX), 'aria-label': f.labelMy + ' ' + (i + 1) }, p, function () {
        F.values[f.key] = appMeasJoin(boxes.map(function (b) { return b.value; }));
        appMeasChanged(F);
      });
      boxes.push(el);
      multi.appendChild(el);
    });
    wrap.appendChild(multi);
    return wrap;
  }
  if (f.key === CFG.MEAS_NOTE_KEY) {
    // The one notes field (13.7.1): a 3-row box of CFG.MEAS_NOTE_MAX characters.
    var ta = appH('textarea', { rows: '3', maxlength: String(CFG.MEAS_NOTE_MAX), 'aria-label': f.labelMy, 'data-f': 'note' });
    ta.value = value;
    ta.addEventListener('input', function () { F.values[f.key] = ta.value; appMeasChanged(F); });
    wrap.appendChild(ta);
    return wrap;
  }
  var number = f.type === 'number';
  wrap.appendChild(box({ inputmode: number ? 'decimal' : 'text', maxlength: String(number ? APP_MEAS_ONE_MAX : APP_MEAS_VALUE_MAX) }, value, function (el) {
    F.values[f.key] = el.value;
    appMeasChanged(F);
  }));
  return wrap;
}

/** Every change is kept (the draft in the persisted cache) and written to disk shortly after (debounced phone.commit). */
function appMeasChanged(F) {
  if (APP.measForm !== F) return;
  F.dirty = true;
  if (F.msgEl && !F.msgEl.hidden) { F.msgEl.textContent = ''; F.msgEl.hidden = true; }   // an earlier refusal is out of date
  appMeasDraftWrite(APP.store, F.req.customerId, { values: F.values, notes: F.noteField ? '' : (F.model ? F.model.notes : ''),
    voucher: F.voucherEl ? F.voucherEl.value : F.model.voucher, sketch: F.sketch ? appSketchEncode(F.sketch.fig, F.sketch.strokes) : '' });
  if (F.timer && APP.win) APP.win.clearTimeout(F.timer);
  F.timer = APP.win ? APP.win.setTimeout(function () { F.timer = null; APP.phone.commit('measdraft'); }, APP_MEAS_DRAFT_MS) : null;
}

function appMeasSay(F, text) {
  if (F.msgEl) { F.msgEl.textContent = text; F.msgEl.hidden = !text; }
  if (text) appToast(text, true);
}

/** A voucher that is neither digits nor an order id is dropped with a toast; a good one shows its id under the input. */
function appMeasVoucherCheck(F) {
  var v = appMeasVoucher(F.voucherEl.value, F.model.shop);
  if (v.bad) F.voucherEl.value = '';
  F.idEl.textContent = v.id;
  appMeasChanged(F);
  if (v.bad) appMeasSay(F, APP.tt('ui_meas_bad_voucher'));
}

/** 🔄 measure anew: every value box, the note and the drawing are emptied (the voucher stays). */
function appMeasClear(F) {
  F.values = {};
  if (F.notesEl) F.notesEl.value = '';
  if (F.sketch) F.sketch.strokes = [];
  if (F.model) F.model.notes = '';
  appMeasDrawFields(F);
  appMeasChanged(F);
}

function appMeasFormSave() {
  var F = APP.measForm;
  if (!F) return;
  if (typeof appSketchLeave === 'function') appSketchLeave(F);
  // Revision 3 (13.7.1): no second notes box; a restored draft's notes are saved as notes only when the note row is hidden.
  var notes = F.noteField ? '' : (F.model ? F.model.notes : (F.notesEl ? F.notesEl.value : ''));
  var sketch = F.sketch ? appSketchEncode(F.sketch.fig, F.sketch.strokes) : '';
  var res = appMeasSave(APP.phone, F.req, { values: F.values, notes: notes || '', voucher: F.voucherEl ? F.voucherEl.value : '', sketch: sketch,
    makeCanvas: APP.doc && APP.doc.createElement ? appSketchCanvas : null });
  if (!res.ok) { appMeasSay(F, APP.tt('ui_meas_empty')); return; }
  appCloseMeasForm({});
  appToast(APP.tt('meas_saved_form', { customer: customerName(APP.phone.ports, F.req.customerId), n: fmtCount(res.n) }));
  if (res.badVoucher) appToast(APP.tt('ui_meas_bad_voucher'), true);
  appMeasCommit(APP.phone, APP.sync);
}

/**
 * Close the form. opts.ask (the close button): a form with typed values asks once; on yes its draft is dropped.
 * Returns false when the user chose to stay. A service-worker update that waited for the form reloads now.
 */
function appCloseMeasForm(opts) {
  opts = opts || {};
  var F = APP && APP.measForm;
  if (!F) return true;
  // A changed form asks with the app's own sheet (appAskLeave): the form stays until the seller chooses to leave; then this
  // runs again with F.leaveOk and drops the draft.
  if (opts.ask && F.dirty && !F.leaveOk) {
    appAskLeave(function () { if (APP.measForm === F) { F.leaveOk = true; appNavPopTo(appNavList().length - 1); } });
    return false;
  }
  if (opts.ask && F.dirty) {
    appMeasDraftDrop(APP.store, F.req.customerId);
    APP.phone.commit('measdraft');
  }
  if (F.timer && APP.win) APP.win.clearTimeout(F.timer);
  F.timer = null;
  if (F.skResize && APP.win && APP.win.removeEventListener) APP.win.removeEventListener('resize', F.skResize);
  if (F.el && F.el.parentNode) F.el.parentNode.removeChild(F.el);
  APP.measForm = null;
  // The meas layer: appNavPop removes it (opts.pop); a Save or a revoke drops it, so a form opened from the buyer page
  // returns to that page (UX-m3). Null-safe for a stub APP without a stack (M-11).
  if (!opts.pop) appNavDrop('meas');
  if (APP.reloadAfterForm) {
    // Reload only once everything is on disk: a failed write keeps its ops in memory only, and a reload would throw
    // them away (the save, its outbox entry, the bot line). The update then waits for the next form close or cold start.
    APP.reloadAfterForm = false;
    APP.phone.commit('reload').then(function (ok) { if (ok) APP.win.location.reload(); else APP.reloadAfterForm = true; });
  }
  return true;
}

/* ------------------------------ voice and photo ------------------------------ */

function appWireVoice(btn) {
  var tt = APP.tt;
  var start = function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!APP.recorder) APP.recorder = createAppRecorder({ maxMs: APP_VOICE_MAX_MS });
    if (!APP.recorder.supported) { appToast(tt('ui_voice_unsupported'), true); return; }
    APP.recorder.start().then(function () { appShowRecording(true); }, function (err) {
      appToast(err && err.name === 'NotAllowedError' ? tt('ui_voice_denied') : tt('ui_voice_unsupported'), true);
    });
  };
  var stop = function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!APP.recorder || !APP.recorder.recording) return;
    APP.recorder.stop().then(function (rec) {
      appShowRecording(false);
      if (!rec || !rec.blob || !rec.blob.size || rec.durationMs < 500) return;
      APP.showScanner = false;
      APP.phone.sim.voiceBlob(rec);
    });
  };
  if (APP.win && 'onpointerdown' in APP.win) {
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  } else {
    btn.addEventListener('touchstart', start);
    btn.addEventListener('touchend', stop);
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', stop);
  }
}
function appShowRecording(on) {
  var existing = APP.$('recOverlay');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  if (!on) { if (APP.recTimer) { APP.win.clearInterval(APP.recTimer); APP.recTimer = null; } return; }
  var box = appH('div', { class: 'rec', id: 'recOverlay' }, [appH('span', { class: 'dot' }), appH('span', { id: 'recText', text: APP.tt('ui_voice_hold') })]);
  APP.doc.body.appendChild(box);
  var started = Date.now();
  APP.recTimer = APP.win.setInterval(function () {
    var el = APP.$('recText');
    if (el) el.textContent = APP.tt('ui_voice_recording', { s: myDigits(Math.round((Date.now() - started) / 1000)) });
  }, 500);
}
function appPickPhoto() {
  var input = APP.$('photoInput');
  try { input.click(); } catch (ignore) {}
}
function appOnPhotoPicked(file) {
  if (!file) return;
  appDownscalePhoto(file, APP_PHOTO_MAX_PX).then(function (rec) {
    APP.showScanner = false;
    return APP.phone.sim.photoBlob(rec, '');
  }, function () { appToast(APP.tt('ui_camera_error'), true); });
}

/* ------------------------------ toasts, service worker, install, persistence ------------------------------ */

function appToast(text, bad) {
  var el = APP.$ && APP.$('toast');
  if (!el) return;
  var plain = appPlain(text);
  el.textContent = plain;
  el.className = 'toast' + (bad ? ' bad' : '');
  el.hidden = false;
  if (APP.toastTimer) APP.win.clearTimeout(APP.toastTimer);
  APP.toastTimer = APP.win.setTimeout(function () { el.hidden = true; }, appToastMs(plain, bad));
}

/* ------------------------------ the app's own question (the UX review: never window.confirm) ------------------------------ */
/**
 * A question the seller answers with two big Burmese buttons on a sheet: the choice that changes something on top (red
 * when it destroys something), the safe one under it; Android back and the ← of the sheet are the safe one. The phone's own
 * confirm() box is never used: its OK / Cancel are English, its buttons do not say what happens, and some hosts block it.
 * spec = {kind, title, text, yes, no, danger, onYes, onNo}. The sheet is a nav layer like the keypads (13.4).
 */
function appAsk(spec) {
  var tt = APP.tt, o = APP.$ && APP.$('overlay');
  if (!o) return false;
  appClear(o);
  var sheet = appH('div', { class: 'sheet ask', role: 'alertdialog', 'aria-label': spec.title, 'aria-modal': 'true', 'data-ask': spec.kind || 'ask' }, [appH('h3', { text: spec.title })]);
  if (spec.text) sheet.appendChild(appH('div', { class: 'muted asktext', text: spec.text }));
  sheet.appendChild(appH('div', { class: 'actions askacts' }, [
    appH('button', { type: 'button', class: spec.danger ? 'danger' : 'primary', 'data-f': 'ask:yes', text: spec.yes, onclick: function () { appAskClose(spec, true); } }),
    appH('button', { type: 'button', class: 'ghost', 'data-f': 'ask:no', text: spec.no || tt('ui_w_cancel'), onclick: function () { appAskClose(spec, false); } })
  ]));
  o.appendChild(sheet);
  appOpenSheet(o);
  spec.opener = APP.doc && APP.doc.activeElement;
  var choices = sheet.querySelectorAll ? sheet.querySelectorAll('button') : [];
  if (choices.length === 2 && choices[1].focus) {
    choices[1].focus();
    sheet.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        choices[APP.doc.activeElement === choices[0] ? 1 : 0].focus();
      }
    });
  }
  return true;
}
/** The sheet's answer: the sheet and its layer go first (no history call), the choice runs, then ONE history sync. */
function appAskClose(spec, yes) {
  appCloseOverlay({ fromNav: true });
  var top = appNavTop();
  if (top && top.kind === 'sheet') APP.nav.pop();
  if (spec.opener && spec.opener.focus) spec.opener.focus();
  if (yes) { if (spec.onYes) spec.onYes(); }
  else if (spec.onNo) spec.onNo();
  appNavSync();
}
/** The kind of the question sheet that is open ('' when none): the frame's snapshot and the checks read it. */
function appAsking() {
  var o = APP && APP.$ ? APP.$('overlay') : null, s = o && !o.hidden ? o.firstChild : null;
  return s && s.getAttribute ? (s.getAttribute('data-ask') || '') : '';
}
/** Leaving a changed form or measurement form: go() runs when the seller chooses to leave without saving. */
function appAskLeave(go) {
  var tt = APP.tt;
  return appAsk({ kind: 'leave', title: tt('ui_meas_close_ask'), yes: tt('ui_ask_leave_yes'), no: tt('ui_ask_stay'), danger: true, onYes: go });
}
/** Undo (↩️) and the owner's void (🚫) reverse money records: one question first, never on a stray tap. */
function appAskUndo(isVoid, go) {
  var tt = APP.tt;
  return appAsk({ kind: isVoid ? 'void' : 'undo', title: tt(isVoid ? 'ui_ask_void' : 'ui_ask_undo'), text: isVoid ? '' : tt('ui_ask_undo_text'),
    yes: tt(isVoid ? 'ui_ask_void_yes' : 'ui_ask_undo_yes'), no: tt('ui_ask_keep'), danger: true, onYes: go });
}

/** Silent updates: the new worker waits; it is activated on a cold start when nothing is pending, then one reload. */
function appSetupServiceWorker() {
  var nav = APP.win && APP.win.navigator;
  if (!nav || !nav.serviceWorker || APP.opts.noServiceWorker) return;
  // An update also waits while the measurement form is open (spec 9.3): its reload would close the form.
  var canApply = function () { return !APP.store.outbox.length && !APP.store.queuedMedia().length && !appState() && APP.justStarted && !APP.measForm && !APP.form; };
  var apply = function (worker) {
    if (!worker || !canApply()) { APP.updateReady = true; return; }
    APP.reloadOnControl = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
  nav.serviceWorker.addEventListener('controllerchange', function () {
    if (!APP.reloadOnControl) return;
    APP.reloadOnControl = false;
    if (APP.measForm || APP.form) APP.reloadAfterForm = true;   // a form opened meanwhile: reload when it closes
    else APP.win.location.reload();
  });
  nav.serviceWorker.register('sw.js').then(function (reg) {
    if (reg.waiting && nav.serviceWorker.controller) apply(reg.waiting);
    reg.addEventListener('updatefound', function () {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', function () {
        if (w.state === 'installed' && nav.serviceWorker.controller) apply(w);
      });
    });
  }, function () {});
}
/**
 * The database was taken over by a newer app in another tab (a higher DB version, see createIdbAdapter): this tab can
 * no longer save anything, so it reloads into the new version (the new service worker already controls it) once the
 * write in flight has settled. Every earlier commit is on disk; an open form's draft is too (debounced), and comes back
 * when the form is opened again for that customer.
 */
function appOnDbReplaced() {
  if (!APP || !APP.win || !APP.win.location) return;
  var go = function () { APP.win.location.reload(); };
  APP.store.commit().then(go, go);
}
function appSetupInstallHints() { /* iOS hint renders on the enroll screen; Android uses beforeinstallprompt (wired in appWireEvents) */ }
function appRequestPersist() {
  var nav = APP.win && APP.win.navigator;
  if (!nav || !nav.storage) return;
  var done = function (v) { APP.persisted = !!v; if (APP.screen === 'sync') appRender(); };
  if (nav.storage.persist) nav.storage.persist().then(done, function () { APP.persisted = null; });
  else if (nav.storage.persisted) nav.storage.persisted().then(done, function () { APP.persisted = null; });
}
