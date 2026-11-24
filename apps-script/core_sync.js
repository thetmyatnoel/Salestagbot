/**
 * core_sync.js — offline-first sync, platform-free (SPEC-offline-first.md, sync-and-server.md).
 *
 * Runs in three places with the same code: Apps Script (gas_sync.js wraps it), the fake server
 * of the simulator (poc/sim_sync.js) and, for the client helpers, the phone (poc/sim_phone.js,
 * later the PWA). Nothing here touches a platform API; everything goes through `serverPorts`:
 *
 * serverPorts = {
 *   store:   gasStore-like: ledgerRows, getItem, listItems, updateItem, getCustomer, listCustomers,
 *            addCustomer(rec with id), updateCustomer? (id, fields), getStaff, listStaff, getSetting,
 *            getMessage, allSettings(), allMessages(), logError, refreshViews?
 *   devices: list(), get(id), create(rec), update(id, fields), counters() -> {seq, rev},
 *            setCounters({seq?, rev?}), nextSeq(), nextRev(), mintCode(rec), verifyCode(hash, now)
 *            (device records use SYNC.DEVICE_FIELDS, camelCase, in CFG.DEVICE_COLS order)
 *   sync:    appendRows(rows) (one group, one write), quarantine(row), log(row), aiJob(id) / aiJob(id, rec),
 *            stampSeq([{txId, seq, receivedAt, deviceId}]) (used only by the one-time backfill, never on a request)
 *   cache?:  get/put/remove (optional fast paths only; every value has a durable fallback)
 *   hash(text) -> SHA-256 hex,  clock: {now},  uuid(),  lock: {run(fn)}
 * }
 * hooks (platform work the dispatcher delegates): ai(job, device), photo(itemIds), report(report,
 * device, inline), relay(notice), ping(ownerId, text, kb). Each optional; a missing hook answers
 * with a polite error instead of throwing.
 *
 * Rules kept here on purpose, so the fake server and Apps Script cannot drift apart:
 *   - the ledger is append-only; the server never edits a row. Seq/ReceivedAt/DeviceID are written
 *     together with the row: by syncApplyPush for a phone's rows (plus a blank CostAtSale filled from
 *     Items), by the store's appendLedger for Telegram-route rows (gasStore, the fake server). The
 *     only code that touches an existing row is backfillSync() in the editor, once, after the paste;
 *   - accept and flag: every well-formed row from a valid device is accepted as what happened;
 *     stock below zero, a payment above what was owed and a deposit applied beyond what was held are
 *     FLAGS (owner ping with a V| void button, summary line), never rejections;
 *   - the only rejections are duplicates whose end state already holds (a second undo of the same
 *     rows) and structural errors (unknown device, malformed row, staff or shop mismatch, unknown
 *     item); they go to the Quarantine tab and are shown on the phone under ❌;
 *   - idempotent by TxID: a re-sent batch answers `dup` for every row the server already has;
 *   - every response carries serverTime (and clockSkewSec when the body had clientTime).
 */

var SYNC = {
  VERSION: 1,                     // protocol version in ping
  API: ['ping', 'enroll', 'sync', 'bootstrap', 'ai', 'photo', 'report', 'devices', 'office'],
  PAGE_ROWS: 500,                 // ledger rows per pull or bootstrap page (Settings pull_page_rows)
  PUSH_MAX_ROWS: 200,             // ledger rows per push (Settings push_max_rows)
  CODE_LEN: 8,                    // typed one-time enrollment code
  CODE_TTL_SEC: 900,              // 15 minutes
  CODE_MAX_ATTEMPTS: 5,
  CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',   // no 0/O or 1/I to confuse a typed code
  DRAIN_HOURS: 24,                // Settings device_drain_hours
  STALE_HOURS: 2,                 // Settings stale_device_hours: LastSeen older than this with PendingCount > 0
  STALE_EVENING_HOUR: 18,         // and: no sync at all since 18:00 Yangon
  SKEW_WARN_SEC: 300,             // 5 minutes: the phone shows app_clock, the server logs clock_skew
  MAX_AMOUNT: 100000000,          // structural: |Amount|, |Cash| above this is malformed
  MAX_QTY: 100000,
  AI_CACHE_SEC: 21600,            // 6 hours: a lost response never re-spends Gemini
  PHOTO_MAX: 20,                  // item thumbnails per api=photo call
  INLINE_PDF_MAX: 500 * 1024,     // smaller PDFs may come back inline (base64) for the share sheet
  TOKEN_HEX: 64,                  // 32 random bytes as hex
  DEVICE_ID_HEX: 16,
  RETRY_AFTER_SEC: 600,           // on a Gemini quota answer
  DENIED_LOG_PER_HOUR: 20,        // refused enroll/device calls written to Errors per hour, then one summary row
  STATUS: { PENDING: 'PENDING', ACTIVE: 'ACTIVE', DRAIN: 'DRAIN', REVOKED: 'REVOKED' },
  TRANSPORT: { A: 'A', B: 'B' },  // A: fetch to /exec?api=…, B: .json document through Telegram
  DOC_FORMAT: 'salestag-outbox',  // Transport B file header
  DOC_VERSION: 1,
  // Device record fields, camelCase, in the exact order of CFG.DEVICE_COLS.
  DEVICE_FIELDS: ['id', 'tokenHash', 'staffId', 'shop', 'role', 'label', 'platform', 'status', 'createdAt', 'lastSeen',
                  'appVersion', 'pendingCount', 'receiptLetter', 'enrollCodeHash', 'enrollExpires', 'note'],
  // Item fields a phone may change (what gasStore.updateItem maps). Anything else is stripped.
  ITEM_FIELDS: ['shop', 'name', 'category', 'type', 'price', 'cost', 'photoUrl', 'photoFileId', 'createdAt', 'createdBy', 'sample', 'alias'],
  // Master fields sent to phones (Status and Stock are derived locally, never sent).
  ITEM_PULL_FIELDS: ['id', 'shop', 'name', 'category', 'type', 'price', 'cost', 'photoUrl', 'photoFileId', 'createdAt', 'createdBy', 'sample', 'alias', 'rev', 'updatedAt'],
  CUSTOMER_PULL_FIELDS: ['id', 'name', 'phone', 'note', 'createdAt', 'rev', 'updatedAt'],
  // Apply order inside a batch (the numbers order entries and are never stored): a customer before the list option and
  // the sale that use it, a sale before a notice about it, a customer created offline before its measurement session.
  // setting (round 6, revision 3): the owner's Shops screen and AI switch write one whitelisted Settings key (SETTING_KEYS).
  ENTRY_KINDS: { customer: 1, item: 2, list: 3, group: 4, measurement: 5, notice: 6, error: 7, setting: 8 },
  MEAS_PAGE: 100,                 // measurement sessions per pull page (cursor.measAfter); more:true while some remain
  MEAS_MAX_FIELDS: 80,            // structural limits of a measurement entry from a phone
  MEAS_KEY_RE: /^[A-Za-z0-9_]{1,40}$/,
  MEAS_VALUE_MAX: 60,
  MEAS_NOTES_MAX: 300,
  MEAS_ENTRY_ID_MAX: 64,          // an entryId longer than this is not kept with the session (the values rule then applies)
  // The drawing on the figure (round 6, revision 3): '1' + 'F' or 'M' + ':' + strokes (base64url) joined by '.'; '' = none.
  MEAS_SKETCH_MAX: 4000,
  MEAS_SKETCH_RE: /^1[FM]:([A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*)?$/,
  LIST_NOTE_MAX: 100,            // structural limit of a list entry's note
  // What this server keeps that an older one drops, sent in every pull as caps (round 5: the DueDay column). A phone
  // whose pull says no dueDay (the bot rolled back, or the app published before it) sells with the one-tap card.
  CAPS: ['dueDay'],
  FLAG: { STOCK_NEGATIVE: 'stock_negative', OVERPAID: 'overpaid', DEPOSIT_OVER: 'deposit_over', CONFLICT: 'sync_conflict' },
  REASON: { SCOPE: 'scope', STAFF: 'staff', ITEM_MISSING: 'item_missing', ALREADY_REVERSED: 'already_reversed',
            REVERSES_MISSING: 'reverses_missing', MALFORMED: 'malformed', BAD_KIND: 'bad_kind' }
};
// The Settings keys a `setting` entry may write: each shop's name, address and phone (one set per CFG.SHOP_IDS, so a later
// shop needs no change here), then the AI switch and the two rows it turns on.
SYNC.SETTING_KEYS = (function () {
  var keys = [];
  ['name', 'address', 'phone'].forEach(function (f) { CFG.SHOP_IDS.forEach(function (id) { keys.push('shop_' + f + '_' + id); }); });
  return keys.concat(['ai', 'notebook_import', 'app_voice']);
})();

/** Burmese drafts the family sees around sync. Merged into MSG at load; the Messages tab can override each key. */
var SYNC_MSG = {
  app_offline: '📴 အင်တာနက် မရှိပါ · ဆက်လုပ်လို့ ရပါသည်',
  app_unsynced: '☁️ {n} ခု မပို့ရသေး',
  app_synced: '☁️ အကုန် ပို့ပြီး',
  app_wait_server: '⏳ ဆာဗာ စောင့်နေပါသည် · လိုင်း ရှိမှ အသံ/ဓာတ်ပုံ ကို စစ်ပါမည်',
  app_ai_result: '🎤 ကြားပြီးပါပြီ',
  app_rejected: '❌ ဒီမှတ်တမ်းကို ဆာဗာ လက်မခံပါ ({reason}) · ဆိုင်ရှင်ကို ပြောပါ',
  app_already_undone: '↩️ အခြားဖုန်းက ပြင်ထားပြီးပါပြီ · ဒီဖုန်းက ပြန်ဖျက်ချက်ကို မမှတ်ပါ',
  app_flagged: '⚠️ ဆာဗာက မှတ်ထားပါသည်: {detail} · ဆိုင်ရှင် စစ်ပါမည်',
  app_clock: '⏰ ဖုန်း အချိန် မမှန်ပါ ({min} မိနစ် ကွာ) · ဆာဗာ အချိန်နဲ့ ပြင်ထားပါသည်',
  app_revoked: '🔒 ဒီဖုန်းကို ပိတ်ထားပါသည် · ဆိုင်ရှင်ကို ပြောပါ',
  app_drain: '⏸ ဒီဖုန်းက ပို့လို့ ရပါသေးသည်၊ အသစ် မယူနိုင်ပါ · ဆိုင်ရှင်ကို ပြောပါ',
  app_need_online: '🖨 အင်တာနက် လိုပါသည်',
  app_report_sent: '📄 Telegram ထဲ ပို့ပြီးပါပြီ',
  app_scan: '📷 Tag ကို scan လုပ်ပါ',
  app_repaired: '🔧 {day} စာရင်းကို ဆာဗာနဲ့ ပြန်ညှိပြီးပါပြီ',
  app_sync_fail: '☁️ မပို့ရသေးပါ · လိုင်း ရှိမှ ထပ်ကြိုးစားပါမည်',
  app_enroll_code: '📲 ၁) အက်ပ်ကို အရင် သွင်းပါ ၂) icon ကနေ ဖွင့်ပါ ၃) ဒီ ကုဒ်ကို ရိုက်ပါ (၁၅ မိနစ် အတွင်း)\n\n🔑 {code}',
  app_enroll_link: '📲 အက်ပ် မသွင်းရသေးရင် ဒီ link ကို ဒီဖုန်းမှာ ဖွင့်ပါ: {url}',
  enroll_bad: '❌ ကုဒ် မမှန်ပါ · ထပ်ရိုက်ပါ ({left} ကြိမ် ကျန်)',
  enroll_expired: '⏱ ကုဒ် သက်တမ်း ကုန်သွားပါပြီ · Telegram မှာ 📲 အက်ပ် ထပ်နှိပ်ပါ',
  enroll_done: '✅ ဒီဖုန်း မှတ်ပုံတင်ပြီး · {label} · ဘောက်ချာ စာလုံး {letter}',
  summary_stale: '⏳ ဖုန်း မပို့ရသေး: {list}',
  summary_synced: '✅ ဖုန်း အားလုံး ပို့ပြီး',
  summary_late: '📊 ယမန်နေ့ ပြင်ဆင်ချက်: {list}',
  summary_flags: '⚠️ ဆာဗာ မှတ်ချက် {n} ခု: {list}',
  stale_device: '{shop} ဖုန်း {letter} ({last} ကတည်းက · {pending} ခု မပို့ရသေး)',
  devices_title: '📱 ဖုန်းများ',
  device_line: '{status} {label} · {shop} · {letter} · {last} · မပို့ရသေး {pending}',
  device_none: '📱 ဖုန်း မရှိသေးပါ',
  device_status_ACTIVE: '🟢', device_status_DRAIN: '⏸', device_status_REVOKED: '❌', device_status_PENDING: '⏳',
  btn_device_drain: '⏸ ပိတ်',
  btn_device_revoke: '❌ ဖျက်',
  btn_device_activate: '🟢 ပြန်ဖွင့်',
  ping_stock_negative: '⚠️ {name} ({id}) · လက်ကျန် {stock} · ဖုန်း ၂ လုံးက တစ်ပြိုင်နက် ရောင်းထားပါသည် · တစ်ခုကို ပယ်ဖျက်ပါ',
  ping_stock_short: '⚠️ {name} ({id}) · လက်ကျန် {stock} · 📦 ကုန်ရောက် မမှတ်ရသေးတာ ရှိနိုင်ပါသည် · စစ်ပါ',
  ping_overpaid: '⚠️ 👤 {customer} · ကျန်ငွေ {owed} ကျပ် ထက် {amount} ကျပ် ပိုလက်ခံထားပါသည် · စစ်ပါ',
  ping_deposit_over: '⚠️ 👤 {customer} · စရံ {held} ကျပ် သာ ရှိပြီး {amount} ကျပ် သုံးထားပါသည် · စစ်ပါ',
  ping_conflict: '⚠️ {id} · ဖုန်း ၂ လုံးက {field} ကို ပြောင်းထားပါသည် · {mine} → {theirs} (နောက်ဆုံး ပြောင်းသူ အတိုင်း)',
  ping_quarantine: '❌ ဖုန်း {label} ၏ မှတ်တမ်း {n} ခု လက်မခံပါ ({reason}) · Quarantine tab ကို ကြည့်ပါ',
  ingest_done: '📥 ဖိုင် လက်ခံပြီး · အသစ် {ok} · ထပ်နေ {dup} · ❌ {bad}',
  ingest_retry: '⏳ {retry} ခု ကျန်',
  ingest_bad_file: '❌ ဒီဖိုင်ကို နားမလည်ပါ · အက်ပ်ထဲက "Telegram နဲ့ ပို့မယ်" ကို သုံးပါ',
  ingest_wrong_device: '❌ ဒီဖိုင်က သင့်ဖုန်းက ထုတ်တာ မဟုတ်ပါ',
  ingest_revoked: '🔒 ဒီဖုန်းကို ပိတ်ထားပါသည်',
  reason_scope: 'ဆိုင် မမှန်', reason_staff: 'ဝန်ထမ်း မမှန်', reason_item_missing: 'Tag မတွေ့',
  reason_already_reversed: 'ပြင်ပြီးသား', reason_reverses_missing: 'မူရင်း မတွေ့', reason_malformed: 'ပုံစံ မမှန်', reason_bad_kind: 'ပုံစံ မမှန်'
};
if (typeof MSG !== 'undefined') Object.assign(MSG, SYNC_MSG);

/* ------------------------------ small helpers ------------------------------ */

function syncNum(v) { return typeof v === 'number' && isFinite(v); }
function syncInt(v) { return syncNum(v) && Math.round(v) === v; }
function syncStr(v) { return typeof v === 'string'; }
function syncBlank(v) { return v === '' || v === null || v === undefined; }
function syncCopy(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
function syncMerge(a, b) { var o = syncCopy(a); for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k]; return o; }
function syncPick(o, fields) { var c = {}; fields.forEach(function (f) { c[f] = o[f] === undefined ? '' : o[f]; }); return c; }
function syncSetting(sp, key, def) {
  var v = sp.store && sp.store.getSetting ? sp.store.getSetting(key, def) : def;
  if (v === '' || v === null || v === undefined) return def;
  var n = Number(v);
  return isNaN(n) ? v : n;
}
function syncError(code, message, extra) {
  var o = { ok: false, error: code, message: message || code };
  if (extra) for (var k in extra) o[k] = extra[k];
  return o;
}
/** Seconds the client clock is behind the server (positive) or ahead (negative). */
function syncSkewSec(serverNow, clientTime) {
  var c = new Date(clientTime);
  if (!clientTime || isNaN(c.getTime())) return null;
  return Math.round((serverNow.getTime() - c.getTime()) / 1000);
}
/** Phone side: offset in ms to add to the phone's wall clock so it reads server time. */
function syncClockOffset(serverTime, clientTime) {
  var s = new Date(serverTime), c = new Date(clientTime);
  if (isNaN(s.getTime()) || isNaN(c.getTime())) return 0;
  return s.getTime() - c.getTime();
}
function syncIsoDay(now) { return dayKey(now); }
function syncYesterday(now) { return dayKey(new Date(now.getTime() - 86400000)); }
function syncReasonText(ports, reason) {
  var key = 'reason_' + reason;
  var s = t(ports, key);
  return s === key ? reason : s;
}
/** Stable hash of a key/value map: sorted keys, JSON, through the port's SHA-256. */
function syncMapHash(sp, map) {
  var keys = Object.keys(map || {}).sort();
  var parts = keys.map(function (k) { return JSON.stringify(k) + ':' + JSON.stringify(map[k] === undefined ? null : map[k]); });
  return String(sp.hash(parts.join('|'))).slice(0, 12);
}
function syncDeviceLabel(ports, d) {
  var shop = d.shop && CFG.SHOP_IDS.indexOf(d.shop) >= 0 ? shopName(ports, d.shop) : (d.shop || '');
  return d.label || (shop + (d.receiptLetter ? ' ' + d.receiptLetter : ''));
}
/** Random code from the alphabet using the port's uuid as the entropy source (two uuids = 256 bits). */
function syncRandomCode(sp, len) {
  var hex = (String(sp.uuid()) + String(sp.uuid())).replace(/-/g, ''), out = '';
  for (var i = 0; i < len && i * 2 + 1 < hex.length; i++) {
    var byte = parseInt(hex.substr(i * 2, 2), 16);
    out += SYNC.CODE_ALPHABET[byte % SYNC.CODE_ALPHABET.length];
  }
  while (out.length < len) out += SYNC.CODE_ALPHABET[0];
  return out;
}
function syncRandomHex(sp, len) {
  var out = '';
  while (out.length < len) out += String(sp.uuid()).replace(/-/g, '');
  return out.slice(0, len).toLowerCase();
}
function syncNormalizeCode(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function syncFormatCode(code) { return code.length === 8 ? code.slice(0, 4) + '-' + code.slice(4) : code; }
/** Phone time -> Yangon "HH:MM" for summary lines. */
function syncTimeOf(iso) {
  var d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : timeKey(d);
}

/**
 * Errors-tab budget for refused enroll and device calls. The ?api= branch runs before the webhook
 * secret, so anyone who learns the /exec URL can send bad tokens all day, and every Errors row is a
 * Sheets write. Per hour and per kind, the first DENIED_LOG_PER_HOUR failures are logged one by one,
 * the next one as a summary row, the rest are only counted (cache key per hour; without a cache every
 * failure is logged, as before).
 */
function syncLogDenied(sp, where, message) {
  var n = 1;
  if (sp.cache && sp.cache.get) {
    var key = 'authfail:' + where + ':' + Math.floor(sp.clock.now().getTime() / 3600000);
    n = (Number(sp.cache.get(key)) || 0) + 1;
    try { sp.cache.put(key, String(n), 3600); } catch (ignore) {}
  }
  if (n > SYNC.DENIED_LOG_PER_HOUR + 1) return;
  var text = n > SYNC.DENIED_LOG_PER_HOUR
    ? 'more than ' + SYNC.DENIED_LOG_PER_HOUR + ' refused calls this hour; the rest are only counted until the hour ends. Last: ' + message
    : message;
  try { sp.store.logError(where, text, '', ''); } catch (ignore) {}
}

/* ------------------------------ devices, enrollment, auth ------------------------------ */

/** Next free receipt letter across every device (letters are never reused: numbers stay unique). */
function syncNextLetter(devices) {
  var used = {};
  (devices || []).forEach(function (d) { if (d.receiptLetter) used[String(d.receiptLetter)] = true; });
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (var i = 0; i < letters.length; i++) if (!used[letters[i]]) return letters[i];
  for (var a = 0; a < letters.length; a++) for (var b = 0; b < letters.length; b++) {
    if (!used[letters[a] + letters[b]]) return letters[a] + letters[b];
  }
  return 'Z' + (devices.length + 1);
}

/** Attempt counter kept in the PENDING row's Note ("attempts=n"). */
function syncAttemptsOf(d) {
  var m = /attempts=(\d+)/.exec(String(d.note || ''));
  return m ? Number(m[1]) : 0;
}

/**
 * The Telegram side calls this when a staff member taps 📲: a PENDING Devices row holding only the
 * code's hash, bound to the staff id, shop and role, valid CODE_TTL_SEC. Returns the plain code once.
 */
function syncMintCode(sp, staff, label, now) {
  now = now || sp.clock.now();
  var code = syncRandomCode(sp, SYNC.CODE_LEN);
  var rec = {
    id: syncRandomHex(sp, SYNC.DEVICE_ID_HEX), tokenHash: '', staffId: String(staff.id), shop: staff.shop || 'S1',
    role: staff.role || 'staff', label: label || '', platform: '', status: SYNC.STATUS.PENDING,
    createdAt: now.toISOString(), lastSeen: '', appVersion: '', pendingCount: 0, receiptLetter: '',
    enrollCodeHash: sp.hash(code), enrollExpires: new Date(now.getTime() + SYNC.CODE_TTL_SEC * 1000).toISOString(), note: 'attempts=0'
  };
  sp.devices.mintCode(rec);
  return { code: code, display: syncFormatCode(code), deviceId: rec.id, expiresAt: rec.enrollExpires };
}

/**
 * Pure matching used by devices.verifyCode: {match} or {fail, bump:[ids]} where bump are the pending
 * rows whose attempt counter must grow (a wrong code cannot be tied to one row, so every live code pays).
 */
function syncMatchEnrollCode(devices, codeHash, now) {
  var pending = (devices || []).filter(function (d) {
    return d.status === SYNC.STATUS.PENDING && d.enrollExpires && new Date(d.enrollExpires).getTime() > now.getTime() &&
           syncAttemptsOf(d) < SYNC.CODE_MAX_ATTEMPTS;
  });
  for (var i = 0; i < pending.length; i++) if (pending[i].enrollCodeHash === codeHash) return { match: pending[i] };
  return { fail: pending.length ? 'enroll_bad' : 'enroll_expired', bump: pending.map(function (d) { return d.id; }),
           left: pending.length ? Math.max(0, SYNC.CODE_MAX_ATTEMPTS - 1 - Math.max.apply(null, pending.map(syncAttemptsOf))) : 0 };
}

/** api=enroll: {code, platform, label, appVersion}. Mints the device token; the plain token is returned once. */
function syncEnroll(sp, body, now) {
  var code = syncNormalizeCode(body.code);
  if (code.length !== SYNC.CODE_LEN) return syncError('enroll_bad', 'code must have ' + SYNC.CODE_LEN + ' characters', { attemptsLeft: null });
  var v = sp.devices.verifyCode(sp.hash(code), now);
  if (!v || !v.match) {
    syncLogDenied(sp, 'enroll_expired', 'enroll attempt failed: ' + ((v && v.fail) || 'no pending code') + ' (label ' + String(body.label || '') + ')');
    return syncError((v && v.fail) || 'enroll_expired', 'code not accepted', { attemptsLeft: v ? v.left : 0 });
  }
  var d = v.match;
  var token = syncRandomHex(sp, SYNC.TOKEN_HEX);
  var staff = sp.store.getStaff(d.staffId);
  if (!staff || staff.role !== d.role || staff.shop !== d.shop) return syncError('revoked', 'staff assignment changed');
  var letter = syncNextLetter(sp.devices.list());
  var fields = {
    tokenHash: sp.hash(token), status: SYNC.STATUS.ACTIVE, platform: String(body.platform || ''),
    label: body.label ? String(body.label) : (d.label || ''), createdAt: now.toISOString(), lastSeen: now.toISOString(),
    appVersion: body.appVersion === undefined ? '' : body.appVersion, pendingCount: 0, receiptLetter: letter,
    enrollCodeHash: '', enrollExpires: '', note: ''
  };
  sp.devices.update(d.id, fields);
  var owners = sp.store.listStaff().filter(function (s) { return s.role === 'owner'; }).map(function (s) { return String(s.id); });
  var scope = staffShops(staff);
  return {
    ok: true,
    device: { id: d.id, token: token, receiptLetter: letter, staff: { id: String(staff.id), name: staff.name, shop: staff.shop || d.shop, role: staff.role || d.role },
              scope: scope, owners: owners, label: fields.label },
    bootstrap: !officeRole(staff.role)
  };
}

/** Hours a DRAIN device keeps accepting pushes, read from the drain note. */
function syncDrainExpired(sp, d, now) {
  var m = /drain since (\S+)/.exec(String(d.note || ''));
  if (!m) return false;
  var since = new Date(m[1]).getTime();
  if (isNaN(since)) return false;
  return now.getTime() - since > syncSetting(sp, 'device_drain_hours', SYNC.DRAIN_HOURS) * 3600000;
}

/**
 * Every authenticated call: device id and token in the body (never a URL), hash compared with the
 * Devices row, Status honoured, LastSeen/AppVersion/PendingCount updated. {ok, device} or an error.
 */
function syncAuthenticate(sp, body, now) {
  var id = String(body.device || ''), token = String(body.token || '');
  if (!id || !token) return syncError('auth', 'device and token required');
  var d = sp.devices.get(id);
  if (!d || !d.tokenHash || sp.hash(token) !== d.tokenHash) {
    syncLogDenied(sp, 'device_denied', 'unknown device or bad token: ' + id);
    return syncError('auth', 'unknown device or bad token');
  }
  if (d.status === SYNC.STATUS.REVOKED) {
    syncLogDenied(sp, 'device_denied', 'revoked device called: ' + id);
    return syncError('revoked', 'device revoked');
  }
  if (d.status === SYNC.STATUS.PENDING) return syncError('auth', 'device not enrolled');
  if (d.status === SYNC.STATUS.DRAIN && syncDrainExpired(sp, d, now)) return syncError('drain', 'drain period over; ask the owner');
  var current = sp.store.getStaff(d.staffId);
  if (!current || current.shop !== d.shop || current.role !== d.role) return syncError('revoked', 'staff assignment changed');
  var minVersion = syncSetting(sp, 'app_min_version', 0);
  if (minVersion && body.appVersion !== undefined && Number(body.appVersion) < Number(minVersion)) return syncError('version', 'app too old; update first');
  var fields = { lastSeen: now.toISOString() };
  if (body.appVersion !== undefined) fields.appVersion = body.appVersion;
  if (body.pendingCount !== undefined) fields.pendingCount = Number(body.pendingCount) || 0;
  sp.devices.update(d.id, fields);
  for (var k in fields) d[k] = fields[k];
  return { ok: true, device: d, staff: current };
}

/* ------------------------------ push: validation (structural only) ------------------------------ */

function syncIsTransfer(type) { return type === CFG.TX.TRANSFER_OUT || type === CFG.TX.TRANSFER_IN; }

/**
 * Shop scope of a group for a staff device. Rows that reference another group (PAYMENT,
 * DEPOSIT_APPLIED) may belong to the other shop: a customer who owes in shop 1 can pay in shop 2.
 * Transfer rows span shops by nature when the group touches the device's own shop. Owners see both.
 */
function syncGroupInScope(device, txs) {
  if (device.scope) return txs.every(function (tx) { return device.scope.indexOf(tx.shop) >= 0; });
  if (device.role === 'owner' || device.shop === 'BOTH') return true;
  var anyOwn = txs.some(function (tx) { return tx.shop === device.shop; });
  return txs.every(function (tx) {
    if (tx.shop === device.shop) return true;
    if (tx.refGroupId) return true;
    if (syncIsTransfer(tx.type) && anyOwn) return true;
    return false;
  });
}

function syncValidateTx(tx) {
  if (!tx || typeof tx !== 'object') return SYNC.REASON.MALFORMED;
  if (!syncStr(tx.txId) || !tx.txId || !syncStr(tx.groupId) || !tx.groupId) return SYNC.REASON.MALFORMED;
  if (!syncStr(tx.type) || !CFG.TX[tx.type]) return SYNC.REASON.MALFORMED;
  if (CFG.SHOP_IDS.indexOf(tx.shop) < 0) return SYNC.REASON.MALFORMED;
  if (!syncStr(tx.time) || isNaN(new Date(tx.time).getTime())) return SYNC.REASON.MALFORMED;
  if (!syncStr(tx.day) || !/^\d{4}-\d{2}-\d{2}$/.test(tx.day)) return SYNC.REASON.MALFORMED;
  if (!syncInt(tx.qty) || Math.abs(tx.qty) > SYNC.MAX_QTY) return SYNC.REASON.MALFORMED;
  if (!syncInt(tx.amount) || Math.abs(tx.amount) > SYNC.MAX_AMOUNT) return SYNC.REASON.MALFORMED;
  if (!syncInt(tx.cash) || Math.abs(tx.cash) > SYNC.MAX_AMOUNT) return SYNC.REASON.MALFORMED;
  if (!syncBlank(tx.unitPrice) && !syncNum(tx.unitPrice)) return SYNC.REASON.MALFORMED;
  if (!syncBlank(tx.costAtSale) && !syncNum(tx.costAtSale)) return SYNC.REASON.MALFORMED;
  var strings = ['itemId', 'customerId', 'refGroupId', 'note', 'source', 'transcript', 'staffId', 'updateId', 'reversesTxId', 'method', 'category', 'receiptNo'];
  for (var i = 0; i < strings.length; i++) {
    var v = tx[strings[i]];
    if (!(v === undefined || v === null || syncStr(v) || syncNum(v))) return SYNC.REASON.MALFORMED;
  }
  // DueDay (round 5): absent, null or '' (an old phone, a full payment), or a yyyy-mm-dd string; a number is malformed.
  if (!syncBlank(tx.dueDay) && !(syncStr(tx.dueDay) && /^\d{4}-\d{2}-\d{2}$/.test(tx.dueDay))) return SYNC.REASON.MALFORMED;
  if ((tx.type === CFG.TX.SALE || tx.type === CFG.TX.RESTOCK || tx.type === CFG.TX.RETURN || syncIsTransfer(tx.type)) && !tx.itemId) return SYNC.REASON.MALFORMED;
  return null;
}

/**
 * Structural checks only, no money logic: {entries:[{index, ok, reason}], ok:n, bad:n}.
 * A failing entry is quarantined by syncApplyPush; nothing here reads balances.
 */
function syncValidateBatch(sp, device, batch) {
  var entries = (batch && batch.entries) || [], out = [], okCount = 0, bad = 0;
  var itemCache = {};
  function itemExists(id) {
    if (itemCache[id] === undefined) itemCache[id] = !!sp.store.getItem(id);
    return itemCache[id];
  }
  entries.forEach(function (e, i) {
    var reason = null;
    if (!e || typeof e !== 'object' || !SYNC.ENTRY_KINDS[e.kind]) reason = SYNC.REASON.BAD_KIND;
    else if (e.kind === 'group') {
      if (!Array.isArray(e.txs) || !e.txs.length || e.txs.length > SYNC.PUSH_MAX_ROWS) reason = SYNC.REASON.MALFORMED;
      else {
        for (var k = 0; k < e.txs.length && !reason; k++) {
          var tx = e.txs[k];
          reason = syncValidateTx(tx);
          if (reason) break;
          if (/^(SHIP|BOOK)-/.test(tx.groupId) || !shopAcceptsEntry(sp, tx.shop, tx.time)) reason = SYNC.REASON.SCOPE;
          else if (String(tx.staffId) !== String(device.staffId)) reason = SYNC.REASON.STAFF;
          else if (tx.itemId && !itemExists(String(tx.itemId))) reason = SYNC.REASON.ITEM_MISSING;
        }
        if (!reason && !syncGroupInScope(device, e.txs)) reason = SYNC.REASON.SCOPE;
        if (!reason && !e.txs.every(function (tx) { return tx.groupId === e.txs[0].groupId; })) reason = SYNC.REASON.MALFORMED;
      }
    } else if (e.kind === 'item') {
      if (!syncStr(e.id) || !e.fields || typeof e.fields !== 'object') reason = SYNC.REASON.MALFORMED;
      else if (device.scope && e.fields.shop && device.scope.indexOf(e.fields.shop) < 0) reason = SYNC.REASON.SCOPE;
      else if (!itemExists(e.id)) reason = SYNC.REASON.ITEM_MISSING;
      else if (!Object.keys(e.fields).some(function (f) { return SYNC.ITEM_FIELDS.indexOf(f) >= 0; })) reason = SYNC.REASON.MALFORMED;
      else if (device.role !== 'owner' && e.fields.shop !== undefined && CFG.SHOP_IDS.indexOf(e.fields.shop) < 0) reason = SYNC.REASON.MALFORMED;
    } else if (e.kind === 'customer') {
      var r = e.rec;
      if (device.scope && r && sp.store.foreignCustomer(r.id)) reason = SYNC.REASON.SCOPE;
      else if (!r || typeof r !== 'object' || !syncStr(r.id) || !/^C-[0-9a-zA-Z]{4,12}$/.test(r.id) || !syncStr(r.name)) reason = SYNC.REASON.MALFORMED;
    } else if (e.kind === 'list') {
      reason = sp.store.addListOption ? syncListRecReason(e.rec) : SYNC.REASON.BAD_KIND;
      if (!reason && device.scope && e.rec.shop && device.scope.indexOf(e.rec.shop) < 0) reason = SYNC.REASON.SCOPE;
    } else if (e.kind === 'measurement') {
      reason = sp.store.addMeasurement ? syncMeasRecReason(device, e.rec) : SYNC.REASON.BAD_KIND;
      if (!reason && device.scope && (sp.store.foreignCustomer(e.rec.customerId) || (e.rec.orderId && !sp.store.getOrder(e.rec.orderId)))) reason = SYNC.REASON.SCOPE;
    } else if (e.kind === 'setting') {
      reason = sp.store.setSetting ? syncSettingReason(device, e) : SYNC.REASON.BAD_KIND;
    } else if (e.kind === 'notice') {
      if (!(syncStr(e.to) || syncNum(e.to)) || !syncStr(e.text)) reason = SYNC.REASON.MALFORMED;
    } else if (e.kind === 'error') {
      if (!syncStr(e.where)) reason = SYNC.REASON.MALFORMED;
    }
    if (reason) bad++; else okCount++;
    out.push({ index: i, ok: !reason, reason: reason });
  });
  return { entries: out, ok: okCount, bad: bad };
}

/* ------------------------------ push: option lists and measurement sessions from a phone ------------------------------ */

function syncAbsent(v) { return v === undefined || v === null; }

/** True for a 'yyyy-mm-dd' string that names a real calendar day. */
function syncValidDay(s) {
  if (!syncStr(s) || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** The number of a measurement id (M-00041 gives 41), 0 when it has none. The server pages by it, phones compare by it. */
function syncMeasNo(id) {
  var m = /^M-(\d+)$/.exec(String(syncAbsent(id) ? '' : id).trim());
  return m ? Number(m[1]) : 0;
}

/**
 * A key a phone may send only when the server already holds exactly that key: comma, colon, whitespace or a
 * control character. listKeyFor never makes one, but a legacy Settings key may hold a space ('K PAY'), and the
 * account number of such an option must still be settable from a phone (syncApplyListEntry checks the stored list).
 */
function syncListKeyOdd(key) { return /[,:\s\x00-\x1f\x7f-\x9f]/.test(String(key)); }

/**
 * A list entry's rec (spec section 8): {list, key, label?, detail?, detailWas?, shop?, note?, kind?}. Structural only, so
 * the stored-key exception of syncListKeyOdd is decided at apply time, under the lock. null when well formed.
 */
function syncListRecReason(rec) {
  var bad = SYNC.REASON.MALFORMED;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return bad;
  if (!syncStr(rec.list) || CFG.LIST_NAMES.indexOf(rec.list) < 0) return bad;
  if (!syncStr(rec.key) || !rec.key || utf8ByteLength(rec.key) > CFG.LIST_KEY_MAX_BYTES || rec.key.indexOf('|') >= 0) return bad;
  if (!syncAbsent(rec.label) && (!syncStr(rec.label) || rec.label.length < 1 || rec.label.length > CFG.LIST_LABEL_MAX)) return bad;
  if (!syncAbsent(rec.detail) && (!syncStr(rec.detail) || rec.detail.length > CFG.LIST_DETAIL_MAX)) return bad;
  if (!syncAbsent(rec.detailWas) && (!syncStr(rec.detailWas) || rec.detailWas.length > CFG.LIST_DETAIL_MAX)) return bad;
  if (syncAbsent(rec.label) && syncAbsent(rec.detail)) return bad;
  if (!syncAbsent(rec.shop) && rec.shop !== '' && CFG.SHOP_IDS.indexOf(rec.shop) < 0) return bad;
  // Kind (round 5): absent or '' is "no kind" (a wallet), never a quarantine (that would drop the seller's new option).
  if (!syncAbsent(rec.kind) && rec.kind !== '' && !(syncStr(rec.kind) && CFG.LIST_KINDS.indexOf(rec.kind) >= 0)) return bad;
  if (!syncAbsent(rec.note) && (!syncStr(rec.note) || rec.note.length > SYNC.LIST_NOTE_MAX)) return bad;
  return null;
}

/**
 * A measurement entry's rec (spec section 9.1): {customerId, orderId, day, staffId, source, notes, fields}. An
 * absent orderId counts as ''. The customer itself is looked up at apply time (it may arrive in the same batch).
 */
function syncMeasRecReason(device, rec) {
  var bad = SYNC.REASON.MALFORMED;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return bad;
  if (!syncStr(rec.customerId) || !rec.customerId) return bad;
  var f = rec.fields;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return bad;
  var keys = Object.keys(f);
  if (keys.length < 1 || keys.length > SYNC.MEAS_MAX_FIELDS) return bad;
  for (var i = 0; i < keys.length; i++) {
    // The one notes field keeps CFG.MEAS_NOTE_MAX characters (round 6, revision 3); every other value SYNC.MEAS_VALUE_MAX.
    var max = keys[i] === CFG.MEAS_NOTE_KEY ? CFG.MEAS_NOTE_MAX : SYNC.MEAS_VALUE_MAX;
    if (!SYNC.MEAS_KEY_RE.test(keys[i]) || !syncStr(f[keys[i]]) || f[keys[i]].length > max) return bad;
  }
  if (!syncAbsent(rec.notes) && (!syncStr(rec.notes) || rec.notes.length > SYNC.MEAS_NOTES_MAX)) return bad;
  // The drawing: absent, '' or the pattern within SYNC.MEAS_SKETCH_MAX characters.
  if (!syncAbsent(rec.sketch) && rec.sketch !== '' &&
      !(syncStr(rec.sketch) && rec.sketch.length <= SYNC.MEAS_SKETCH_MAX && SYNC.MEAS_SKETCH_RE.test(rec.sketch))) return bad;
  if (!syncValidDay(rec.day)) return bad;
  if (!syncAbsent(rec.orderId) && rec.orderId !== '' && !(syncStr(rec.orderId) && isOrderId(rec.orderId))) return bad;
  if (String(rec.staffId) !== String(device.staffId)) return SYNC.REASON.STAFF;
  return null;
}

/**
 * A setting entry (round 6, revision 3): {key, value}. The key is one of SYNC.SETTING_KEYS; a shop value is a string of at
 * most CFG.SHOP_TEXT_MAX[field] characters and a name is not blank; an AI value is exactly 'TRUE' or 'FALSE'; else
 * malformed. Only the owner's phone may write one (staff). null when well formed.
 */
function syncSettingReason(device, e) {
  var bad = SYNC.REASON.MALFORMED;
  if (!e || !syncStr(e.key) || (SYNC.SETTING_KEYS.indexOf(e.key) < 0 && !/^shop_(name|address|phone)_S[1-9]\d*$/.test(e.key)) || !syncStr(e.value)) return bad;
  var m = /^shop_(name|address|phone)_/.exec(e.key);
  if (m) {
    if (CFG.SHOP_IDS.indexOf(e.key.slice(m[0].length)) < 0) return bad;
    if (e.value.length > CFG.SHOP_TEXT_MAX[m[1]]) return bad;
    if (m[1] === 'name' && !e.value.trim()) return bad;
  } else if (e.value !== 'TRUE' && e.value !== 'FALSE') return bad;
  if (device.role !== 'owner') return SYNC.REASON.STAFF;
  return null;
}

/** A setting entry's value against the stored one: the AI keys (TRUE / FALSE) without case, the shop texts exactly. */
function syncSettingSame(key, stored, value) {
  var a = String(stored), b = String(value);
  return /^shop_/.test(String(key)) ? a === b : a.toLowerCase() === b.toLowerCase();
}

/** True when the server's list (its Lists rows, or the legacy rows it would seed the list with) holds exactly that key. */
function syncListKeyStored(sp, name, key) {
  var rows = sp.store.listOptions ? listNormRows(null, name, sp.store.listOptions(name)) : [];
  if (!rows.length) rows = legacyListRows(sp, name);
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return true;
  return false;
}

/**
 * Apply a well-formed list entry: the one upsert rule through store.addListOption, seeded with the legacy rows
 * while the server's list is empty. {status: 'ok' | 'dup', key} or {reason} (quarantine). A store error throws.
 */
function syncApplyListEntry(sp, device, rec) {
  if (syncListKeyOdd(rec.key) && !syncListKeyStored(sp, rec.list, rec.key)) return { reason: SYNC.REASON.MALFORMED };
  var rec2 = { list: rec.list, key: rec.key };
  ['label', 'detail', 'detailWas', 'shop'].forEach(function (f) { if (!syncAbsent(rec[f])) rec2[f] = rec[f]; });
  if (syncStr(rec.kind) && CFG.LIST_KINDS.indexOf(rec.kind) >= 0) rec2.kind = rec.kind;
  rec2.note = syncStr(rec.note) && rec.note ? rec.note : 'device ' + device.id;
  var r = sp.store.addListOption(rec2, legacyListRows(sp, rec.list)) || {};
  return { status: r.status === 'ok' ? 'ok' : 'dup', key: r.key || listNormKey(rec.list, rec.key) };
}

/** A session's day, staff, notes and non-empty fields as one comparable string (the duplicate rule). */
function syncMeasSignature(m) {
  var f = (m && m.fields) || {};
  var keys = Object.keys(f).filter(function (k) { return !syncBlank(f[k]) && String(f[k]) !== ''; }).sort();
  return JSON.stringify([String(m.day || ''), String(m.staffId || ''), String(m.notes || ''), keys.map(function (k) { return [k, String(f[k])]; })]);
}

/** Every stored session of one customer, oldest first. */
function syncCustomerSessions(sp, customerId) {
  if (sp.store.listMeasurements) return sp.store.listMeasurements(customerId) || [];
  if (!sp.store.listAllMeasurements) return [];
  return (sp.store.listAllMeasurements() || []).filter(function (m) { return String(m.customerId) === String(customerId); });
}

/** The order gets measId; the session is already stored, so a failed link is logged, never a retry. */
function syncLinkMeasOrder(sp, orderId, measId) {
  try { sp.store.updateOrder(orderId, { measId: measId }); }
  catch (err) { try { sp.store.logError('sync_apply', err, '', 'order ' + orderId + ' measId ' + measId); } catch (ignore) {} }
}

/**
 * Apply a well-formed measurement entry with store methods only (core_sync.js calls nothing of core_orders.js):
 *  - an unknown customer is malformed (a customer created offline arrives earlier in the same batch);
 *  - the duplicate rule goes by the entry's identity: a stored session of that customer that came from the same
 *    outbox entry (its entryId, kept with the session) answers dup with that session's id, so a resent batch, a lost
 *    reply or a Transport B file adds no copy. A deliberate save that goes back to the values of an older session is
 *    another entry: it is a new session and the customer's newest, on the server and on every phone. Only an entry
 *    without a usable entryId falls back to the values rule (same day, staff, notes and non-empty fields as ANY
 *    stored session of that customer);
 *  - otherwise one new session, source FORM, with the entryId; it keeps the voucher only when that order is the same
 *    customer's, and that order then gets measId. A dup also gives that order measId while the order has none (the
 *    link of the first apply failed, or the values rule matched a session saved for another voucher).
 * {status, id} or {reason}. A store error throws (the entry is answered retry).
 */
function syncApplyMeasurementEntry(sp, device, rec, entryId) {
  var customerId = String(rec.customerId);
  if (!sp.store.getCustomer(customerId)) return { reason: SYNC.REASON.MALFORMED };
  var fields = {}, k, i;
  for (k in rec.fields) if (Object.prototype.hasOwnProperty.call(rec.fields, k)) fields[k] = rec.fields[k];
  var want = { customerId: customerId, day: rec.day, staffId: String(rec.staffId), notes: syncStr(rec.notes) ? rec.notes : '', fields: fields };
  var eid = syncStr(entryId) && entryId.length <= SYNC.MEAS_ENTRY_ID_MAX ? entryId : '';
  var sessions = syncCustomerSessions(sp, customerId), dupOf = null;
  if (eid) {
    for (i = sessions.length - 1; i >= 0 && !dupOf; i--) if (sessions[i] && String(syncAbsent(sessions[i].entryId) ? '' : sessions[i].entryId) === eid) dupOf = sessions[i];
  } else {
    var sig = syncMeasSignature(want);
    for (i = sessions.length - 1; i >= 0 && !dupOf; i--) if (syncMeasSignature(sessions[i]) === sig) dupOf = sessions[i];
  }
  var order = null;
  if (syncStr(rec.orderId) && rec.orderId && sp.store.getOrder && sp.store.updateOrder) {
    var o = sp.store.getOrder(rec.orderId);
    if (o && String(o.customerId) === customerId) order = o;
  }
  if (dupOf) {
    if (order && String(syncAbsent(order.measId) ? '' : order.measId) === '') syncLinkMeasOrder(sp, rec.orderId, String(dupOf.id));
    return { status: 'dup', id: String(dupOf.id) };
  }
  var orderId = order ? rec.orderId : '';
  var add = { customerId: customerId, orderId: orderId, day: want.day, staffId: want.staffId,
    source: CFG.MEAS_SOURCE.FORM, photoUrl: '', notes: want.notes, fields: fields, entryId: eid };
  if (syncStr(rec.sketch) && rec.sketch) add.sketch = rec.sketch;   // the drawing (round 6, revision 3), only when there is one
  var stored = sp.store.addMeasurement(add);
  if (orderId) syncLinkMeasOrder(sp, orderId, stored.id);
  return { status: 'ok', id: String(stored.id) };
}

/* ------------------------------ push: apply (accept and flag) ------------------------------ */

/** Ports view over a shadow ledger (server rows plus rows accepted earlier in the same batch). */
function syncShadowPorts(sp, rows) {
  return {
    store: {
      ledgerRows: function () { return rows; },
      getItem: function (id) { return sp.store.getItem(id); },
      listItems: function (shop) { return sp.store.listItems(shop); },
      getCustomer: function (id) { return sp.store.getCustomer(id); },
      listCustomers: function () { return sp.store.listCustomers(); },
      getSetting: function (k, d) { return sp.store.getSetting(k, d); },
      getMessage: function (k) { return sp.store.getMessage ? sp.store.getMessage(k) : null; }
    },
    clock: sp.clock
  };
}

/** A stock_negative flag on a stock item (not one of a kind): more likely a restock nobody recorded than a double sale. */
function syncFlagStockShort(ports, flag) {
  if (flag.kind !== SYNC.FLAG.STOCK_NEGATIVE) return false;
  var it = ports.store.getItem(flag.itemId);
  return !!it && it.type !== CFG.ITEM_TYPE.UNIQUE;
}

function syncFlagText(ports, flag) {
  if (flag.kind === SYNC.FLAG.STOCK_NEGATIVE) {
    var it = ports.store.getItem(flag.itemId);
    return t(ports, syncFlagStockShort(ports, flag) ? 'ping_stock_short' : 'ping_stock_negative',
      { name: it && it.name ? it.name : flag.itemId, id: flag.itemId, stock: fmtCount(flag.stock) });
  }
  if (flag.kind === SYNC.FLAG.OVERPAID) {
    return t(ports, 'ping_overpaid', { customer: customerName(ports, flag.customerId), owed: fmtMoney(flag.owed), amount: fmtMoney(flag.amount) });
  }
  if (flag.kind === SYNC.FLAG.DEPOSIT_OVER) {
    return t(ports, 'ping_deposit_over', { customer: customerName(ports, flag.customerId), held: fmtMoney(flag.held), amount: fmtMoney(flag.amount) });
  }
  if (flag.kind === SYNC.FLAG.CONFLICT) {
    return t(ports, 'ping_conflict', { id: flag.itemId, field: flag.field, mine: flag.mine, theirs: flag.theirs });
  }
  return JSON.stringify(flag);
}

/**
 * Owner ping for a flag: text plus the owner-only void button for the group that caused it. A stock item's stock_negative
 * (round 6) has no button: a void would reverse the whole basket and its bank part (the owner voids from the receipt).
 */
function syncFlagPing(ports, flag) {
  var kb = flag.groupId && !syncFlagStockShort(ports, flag) ? [[{ text: t(ports, 'btn_void'), callback_data: 'V|' + flag.groupId }]] : [];
  return { text: syncFlagText(ports, flag), kb: kb, groupId: flag.groupId || '', flag: flag };
}

/**
 * Apply one push batch under the lock. Returns
 * {batchId, results:[...], accepted:[rows as written], flags:[...], pings:[{text, kb}], relay:[notices], counts}.
 * Per entry result: {kind, entryId, groupId|id, status:'ok'|'dup'|'quarantined', seq:[], flags:[], reason, rev, conflict};
 * a list entry adds {key}, a measurement entry {id}. A list or measurement entry whose store call throws is answered
 * {kind, entryId, status: 'retry'} (logged as sync_apply): the phone keeps it, and the rest of the batch is applied.
 * The later entries of the batch that depend on it are answered retry too, without a store call, so they are applied
 * after it at the next sync and never before it: a list entry for the same list and key (an account number typed right
 * after the ➕ would otherwise be a dup against a missing row and be lost), a measurement entry of the same customer
 * (an earlier save stored after a later one would become the customer's newest session on the server only).
 */
function syncApplyPush(sp, device, batch, now) {
  now = now || sp.clock.now();
  batch = batch || {};
  var entries = batch.entries || [];
  var validation = syncValidateBatch(sp, device, batch);
  var results = new Array(entries.length);
  var accepted = [], flags = [], pings = [], relay = [], counts = { ok: 0, dup: 0, quarantined: 0, rows: 0, flagged: 0, retry: 0 };
  var nowIso = now.toISOString();
  var held = {};                                       // 'l:<list>|<KEY>' and 'm:<customerId>' behind an entry answered retry
  var selfRev = {};                                    // item id -> the Rev this batch stamped on it (ok) or found (dup)

  function quarantine(e, i, reason, rowsJson) {
    counts.quarantined++;
    var row = { time: nowIso, deviceId: device.id, groupId: e && e.groupId ? e.groupId : (e && e.id ? e.id : ''), reason: reason,
                rowsJson: rowsJson || safeJson(e) };
    try { sp.sync.quarantine(row); } catch (err) { try { sp.store.logError('quarantine', err, '', reason); } catch (ignore) {} }
    try { sp.store.logError('sync_reject', reason + ' from device ' + device.id, batch.batchId || '', (e && (e.groupId || e.id)) || ''); } catch (ignore) {}
    results[i] = { kind: e && e.kind, entryId: e && e.entryId, groupId: e && e.groupId, id: e && e.id, status: 'quarantined', reason: reason };
    // bad_kind for a kind this server knows (a list or measurement entry and a store without the method) is final. A server
    // older than the kind answers bad_kind without this mark, and the phone keeps such an entry (syncApplyPushResults).
    if (reason === SYNC.REASON.BAD_KIND && e && SYNC.ENTRY_KINDS[e.kind]) results[i].kindKnown = true;
  }

  sp.lock.run(function () {
    var ledger = sp.store.ledgerRows();
    var rows = ledger.slice();                         // shadow: grows with rows accepted in this batch
    var shadow = syncShadowPorts(sp, rows);
    var byTx = {}, reversed = {}, stock = {}, costByTx = {}, groupByTx = {};
    rows.forEach(function (r) {
      byTx[r.txId] = true;
      groupByTx[r.txId] = r.groupId;
      if (r.reversesTxId) reversed[r.reversesTxId] = true;
      if (r.itemId) stock[r.itemId] = (stock[r.itemId] || 0) + (Number(r.qty) || 0);
      if (r.type === CFG.TX.SALE) costByTx[r.txId] = r.costAtSale;
    });
    var order = entries.map(function (e, i) { return i; }).sort(function (a, b) {
      var ka = (entries[a] && SYNC.ENTRY_KINDS[entries[a].kind]) || 9, kb = (entries[b] && SYNC.ENTRY_KINDS[entries[b].kind]) || 9;
      return ka - kb || a - b;
    });

    order.forEach(function (i) {
      var e = entries[i], v = validation.entries[i];
      if (!v.ok) return quarantine(e, i, v.reason);

      if (e.kind === 'customer') {
        var rec = e.rec, existing = sp.store.getCustomer(rec.id);
        if (existing) {
          var changed = {}, any = false;
          ['name', 'phone', 'note'].forEach(function (f) {
            if (rec[f] !== undefined && String(rec[f]) !== String(existing[f] || '')) { changed[f] = rec[f]; any = true; }
          });
          if (any && sp.store.updateCustomer) {
            changed.rev = sp.devices.nextRev(); changed.updatedAt = nowIso;
            sp.store.updateCustomer(rec.id, changed);
            counts.ok++;
            results[i] = { kind: 'customer', entryId: e.entryId, id: rec.id, status: 'ok', rev: changed.rev };
          } else {
            counts.dup++;
            results[i] = { kind: 'customer', entryId: e.entryId, id: rec.id, status: 'dup', rev: existing.rev || 0 };
          }
        } else {
          var crec = { id: rec.id, name: String(rec.name).trim() || rec.id, phone: rec.phone || '', note: rec.note || '',
                       createdAt: rec.createdAt || nowIso, rev: sp.devices.nextRev(), updatedAt: nowIso };
          sp.store.addCustomer(crec);
          counts.ok++;
          results[i] = { kind: 'customer', entryId: e.entryId, id: rec.id, status: 'ok', rev: crec.rev };
        }
        return;
      }

      if (e.kind === 'item') {
        var item = sp.store.getItem(e.id), fields = {}, differs = false, conflict = null;
        // A phone stamps every item entry it queues with the Rev it knew then, so its second entry of one item in a batch
        // (a new piece Saved and undone offline) carries a base older than the Rev its own first entry just got. The Rev
        // this batch already stamped (ok) or found (dup) for this device is its base too: no false conflict with itself.
        var base = syncNum(e.baseRev) ? Math.max(e.baseRev, selfRev[e.id] || 0) : e.baseRev;
        SYNC.ITEM_FIELDS.forEach(function (f) {
          if (e.fields[f] === undefined) return;
          var incoming = e.fields[f] === null ? '' : e.fields[f];
          fields[f] = incoming;
          var current = item[f] === undefined || item[f] === null ? '' : item[f];
          if (f === 'sample') { incoming = !!incoming; current = !!current; }
          if (String(incoming) !== String(current)) {
            differs = true;
            if (syncNum(base) && Number(item.rev || 0) > base && !conflict) conflict = { field: f, mine: String(incoming), theirs: String(current) };
          }
        });
        if (!differs) {                                // the same entry again (lost response): no second Rev bump
          counts.dup++;
          selfRev[e.id] = Number(item.rev || 0);
          results[i] = { kind: 'item', entryId: e.entryId, id: e.id, status: 'dup', rev: item.rev || 0, conflict: false };
          return;
        }
        fields.rev = sp.devices.nextRev();
        fields.updatedAt = nowIso;
        sp.store.updateItem(e.id, fields);
        selfRev[e.id] = fields.rev;
        counts.ok++;
        results[i] = { kind: 'item', entryId: e.entryId, id: e.id, status: 'ok', rev: fields.rev, conflict: !!conflict };
        if (conflict) {
          var cf = { kind: SYNC.FLAG.CONFLICT, itemId: e.id, field: conflict.field, mine: conflict.mine, theirs: conflict.theirs, deviceId: device.id };
          flags.push(cf);
          try { sp.store.logError('sync_conflict', e.id + '.' + conflict.field + ': ' + conflict.theirs + ' -> ' + conflict.mine + ' (device ' + device.id + ', baseRev ' + base + ')', batch.batchId || '', ''); } catch (ignore) {}
          pings.push(syncFlagPing(shadow, cf));
        }
        return;
      }

      if (e.kind === 'setting') {
        // The same value is a dup, compared as text: an AI key without case (a cell read back as the boolean TRUE still
        // matches 'TRUE'), a shop's name, address or phone exactly (a fix of capitals only is a change, written).
        var curSet = sp.store.getSetting(e.key, null);
        if (!syncAbsent(curSet) && syncSettingSame(e.key, curSet, e.value)) {
          counts.dup++;
          results[i] = { kind: 'setting', entryId: e.entryId, status: 'dup' };
          return;
        }
        try {
          sp.store.setSetting(e.key, e.value);
        } catch (err) {
          try { sp.store.logError('sync_apply', err, batch.batchId || '', 'setting entry ' + (e.entryId || '') + ' from device ' + device.id); } catch (ignore) {}
          counts.retry++;
          results[i] = { kind: 'setting', entryId: e.entryId, status: 'retry' };
          return;
        }
        counts.ok++;
        results[i] = { kind: 'setting', entryId: e.entryId, status: 'ok' };
        return;
      }

      if (e.kind === 'list' || e.kind === 'measurement') {
        var holdKey = e.kind === 'list' ? 'l:' + e.rec.list + '|' + listNormKey(e.rec.list, e.rec.key) : 'm:' + String(e.rec.customerId);
        if (held[holdKey]) {
          counts.retry++;
          results[i] = { kind: e.kind, entryId: e.entryId, status: 'retry' };
          return;
        }
        var done;
        try {
          done = e.kind === 'list' ? syncApplyListEntry(sp, device, e.rec) : syncApplyMeasurementEntry(sp, device, e.rec, e.entryId);
        } catch (err) {
          held[holdKey] = true;
          try { sp.store.logError('sync_apply', err, batch.batchId || '', e.kind + ' entry ' + (e.entryId || '') + ' from device ' + device.id); } catch (ignore) {}
          counts.retry++;
          results[i] = { kind: e.kind, entryId: e.entryId, status: 'retry' };
          return;
        }
        if (done.reason) return quarantine(e, i, done.reason);
        counts[done.status]++;
        results[i] = e.kind === 'list' ? { kind: 'list', entryId: e.entryId, status: done.status, key: done.key }
                                       : { kind: 'measurement', entryId: e.entryId, status: done.status, id: done.id };
        return;
      }

      if (e.kind === 'group') {
        var fresh = e.txs.filter(function (tx) { return !byTx[tx.txId]; });
        if (!fresh.length) {
          counts.dup++;
          results[i] = { kind: 'group', entryId: e.entryId, groupId: e.groupId, status: 'dup', seq: [] };
          return;
        }
        // Duplicate undo: the row it reverses is already reversed on the server (end state already holds).
        // A mirror outside the group it reverses is structural: undo mirrors stay in their group, so
        // group sums (openCredits, customer summaries) net out. The phone's own undoGroup never does this.
        for (var m = 0; m < fresh.length; m++) {
          var rv = fresh[m].reversesTxId;
          if (!rv) continue;
          if (reversed[rv]) return quarantine(e, i, SYNC.REASON.ALREADY_REVERSED, safeJson(e.txs));
          if (!byTx[rv]) return quarantine(e, i, SYNC.REASON.REVERSES_MISSING, safeJson(e.txs));
          if (groupByTx[rv] && groupByTx[rv] !== fresh[m].groupId) return quarantine(e, i, SYNC.REASON.MALFORMED, safeJson(e.txs));
        }
        var groupFlags = [], stamped = [], seqs = [], seqByTx = {};
        fresh.forEach(function (tx) {
          var row = syncCopy(tx);
          if (syncBlank(row.dueDay)) row.dueDay = '';    // round 5: a row of an older phone has no dueDay; stored blank, as the Sheet cell is
          row.seq = sp.devices.nextSeq();
          row.receivedAt = nowIso;
          row.deviceId = device.id;
          if (row.type === CFG.TX.SALE && syncBlank(row.costAtSale)) {
            if (row.reversesTxId && !syncBlank(costByTx[row.reversesTxId])) row.costAtSale = costByTx[row.reversesTxId];
            else {
              var it = sp.store.getItem(row.itemId);
              if (it && !syncBlank(it.cost)) row.costAtSale = Number(it.cost);
            }
          }
          // Flags: computed on the state before this row, never a rejection.
          if (row.itemId && Number(row.qty) < 0) {
            var after = (stock[row.itemId] || 0) + Number(row.qty);
            if (after < 0) groupFlags.push({ kind: SYNC.FLAG.STOCK_NEGATIVE, itemId: row.itemId, stock: after, groupId: row.groupId, deviceId: device.id });
          }
          if (row.type === CFG.TX.PAYMENT && !row.reversesTxId && row.refGroupId) {
            var info = saleGroupInfo(shadow, row.refGroupId);
            var owed = info ? info.owed : 0;
            if (Number(row.amount) > owed) groupFlags.push({ kind: SYNC.FLAG.OVERPAID, groupId: row.groupId, refGroupId: row.refGroupId, customerId: row.customerId || (info && info.customerId) || '', amount: row.amount, owed: owed, deviceId: device.id });
          }
          if (row.type === CFG.TX.DEPOSIT_APPLIED && !row.reversesTxId) {
            var held = depositsFor(shadow, row.customerId);
            if (Number(row.amount) > held) groupFlags.push({ kind: SYNC.FLAG.DEPOSIT_OVER, groupId: row.groupId, customerId: row.customerId, amount: row.amount, held: held, deviceId: device.id });
          }
          stamped.push(row);
          seqs.push(row.seq);
          seqByTx[row.txId] = row.seq;
          rows.push(row);                                // shadow sees it for the next row's checks
          byTx[row.txId] = true;
          groupByTx[row.txId] = row.groupId;
          if (row.reversesTxId) reversed[row.reversesTxId] = true;
          if (row.itemId) stock[row.itemId] = (stock[row.itemId] || 0) + (Number(row.qty) || 0);
          if (row.type === CFG.TX.SALE) costByTx[row.txId] = row.costAtSale;
        });
        sp.sync.appendRows(stamped);                     // the whole group in one write
        accepted = accepted.concat(stamped);
        counts.ok++;
        counts.rows += stamped.length;
        if (groupFlags.length) counts.flagged++;
        results[i] = { kind: 'group', entryId: e.entryId, groupId: e.groupId, status: 'ok', seq: seqs, seqByTx: seqByTx, flags: groupFlags,
                       partial: fresh.length !== e.txs.length };
        groupFlags.forEach(function (f) { flags.push(f); pings.push(syncFlagPing(shadow, f)); });
        return;
      }

      if (e.kind === 'notice') {
        relay.push({ to: String(e.to), text: e.text, kb: e.kb || [] });
        counts.ok++;
        results[i] = { kind: 'notice', entryId: e.entryId, status: 'ok' };
        return;
      }

      if (e.kind === 'error') {
        try { sp.store.logError('device:' + e.where, String(e.message || ''), e.updateId || '', 'device ' + device.id + ' ' + String(e.payload || '').slice(0, 1500)); } catch (ignore) {}
        counts.ok++;
        results[i] = { kind: 'error', entryId: e.entryId, status: 'ok' };
      }
    });
  });

  // One view refresh per batch (Credits, Deposits, Customers), the server-side equivalent of afterWrite.
  if (accepted.length && sp.store.refreshViews) {
    try { afterWrite(sp, accepted); } catch (err) { try { sp.store.logError('sync_refresh', err, batch.batchId || '', ''); } catch (ignore) {} }
  }
  return { batchId: batch.batchId || '', results: results, accepted: accepted, flags: flags, pings: pings, relay: relay, counts: counts };
}

/**
 * Stamp Seq/ReceivedAt/DeviceID on rows that have none. Used by the one-time backfill only (gas_sync.js
 * backfillSync, the fake server at start-up): on the request path every row already arrives stamped,
 * and the server never comes back to edit a Ledger row. Call under the lock.
 */
function syncStampMissingSeq(sp, now, deviceId) {
  now = now || sp.clock.now();
  var rows = sp.store.ledgerRows(), list = [], maxSeq = 0;
  rows.forEach(function (r) { if (syncNum(r.seq) && r.seq > maxSeq) maxSeq = r.seq; });
  var c = sp.devices.counters();
  if ((c.seq || 0) < maxSeq) sp.devices.setCounters({ seq: maxSeq });
  rows.forEach(function (r) {
    if (syncNum(r.seq) && r.seq > 0) return;
    list.push({ txId: r.txId, seq: sp.devices.nextSeq(), receivedAt: r.receivedAt || now.toISOString(), deviceId: r.deviceId || deviceId || 'TG' });
  });
  if (list.length) sp.sync.stampSeq(list);
  return list.length;
}

/* ------------------------------ checksums ------------------------------ */

/** {day: {shop: {n, amount, cash}}} over rows for the given days (both sides use this). */
function syncChecksums(rows, days) {
  var want = {}, out = {};
  (days || []).forEach(function (d) { want[d] = true; out[d] = {}; CFG.SHOP_IDS.forEach(function (s) { out[d][s] = { n: 0, amount: 0, cash: 0 }; }); });
  rows.forEach(function (r) {
    if (!want[r.day]) return;
    var s = out[r.day][r.shop] || (out[r.day][r.shop] = { n: 0, amount: 0, cash: 0 });
    s.n++;
    s.amount += Number(r.amount) || 0;
    s.cash += Number(r.cash) || 0;
  });
  return out;
}
function syncChecksumsLocal(rows, days) { return syncChecksums(rows, days); }

/** Days whose checksums differ between the server's map and the local one. */
function syncChecksumsDiff(local, remote) {
  var bad = [];
  Object.keys(remote || {}).forEach(function (day) {
    var l = (local || {})[day] || {}, r = remote[day];
    var shops = Object.keys(r);
    for (var i = 0; i < shops.length; i++) {
      var a = l[shops[i]] || { n: 0, amount: 0, cash: 0 }, b = r[shops[i]];
      if (a.n !== b.n || a.amount !== b.amount || a.cash !== b.cash) { bad.push(day); break; }
    }
  });
  return bad;
}

/* ------------------------------ pull and bootstrap ------------------------------ */

/**
 * The Settings map a phone receives (pull and bootstrap): a copy of the Settings tab plus the values the
 * server derives. lists_json = the Lists tab as compact rows (core_ledger.js listsJsonFor), present only
 * while the tab has rows; a list edit therefore changes the Settings hash and reaches every phone at its
 * next sync. meas_fields_json = the MeasureFields tab as a JSON array of {key, labelMy, labelEn, group, multi,
 * type, order, active}, present only while the store has listMeasureFields and it returns at least one row (the
 * phone's measurement form reads its fields from it). A hand-typed Settings row with a derived name (lists_json,
 * meas_fields_json) is never passed on.
 */
function syncSettingsFor(sp) {
  var src = sp.store.allSettings ? sp.store.allSettings() : {}, out = {}, k;
  for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  delete out.lists_json;
  delete out.meas_fields_json;
  var lists = listsJsonFor(sp);
  if (lists) out.lists_json = lists;
  var fields = sp.store.listMeasureFields ? sp.store.listMeasureFields() : [];
  if (fields && fields.length) {
    out.meas_fields_json = JSON.stringify(Array.prototype.map.call(fields, function (f) {
      return syncPick(f, ['key', 'labelMy', 'labelEn', 'group', 'multi', 'type', 'order', 'active']);
    }));
  }
  return out;
}

/**
 * One page of measurement sessions for a pull: those whose number (syncMeasNo) is above `after`, ascending, at most
 * `size` (never cutting between two sessions with the same number), each as {id, n, customerId, orderId, day, notes,
 * fields} with blank fields left out. {list, next: the highest n sent (or after), more: sessions remain}.
 */
function syncMeasPage(all, after, size) {
  var picked = [];
  (all || []).forEach(function (m) {
    var n = syncMeasNo(m && m.id);
    if (n > after) picked.push({ m: m, n: n });
  });
  picked.sort(function (a, b) { return a.n - b.n; });
  var take = Math.min(size, picked.length);
  while (take > 0 && take < picked.length && picked[take].n === picked[take - 1].n) take++;
  var page = picked.slice(0, take).map(function (x) {
    var f = x.m.fields || {}, fields = {};
    Object.keys(f).forEach(function (key) { if (!syncBlank(f[key]) && String(f[key]) !== '') fields[key] = String(f[key]); });
    var o = { id: String(x.m.id), n: x.n, customerId: String(x.m.customerId || ''), orderId: String(x.m.orderId || ''),
             day: String(x.m.day || ''), notes: String(x.m.notes || ''), fields: fields };
    if (x.m.sketch) o.sketch = String(x.m.sketch);   // the drawing (round 6, revision 3): only a session that has one
    return o;
  });
  return { list: page, next: take ? picked[take - 1].n : after, more: take < picked.length };
}

function syncItemForPull(it) { return syncPick(it, SYNC.ITEM_PULL_FIELDS); }
function syncCustomerForPull(c) { return syncPick(c, SYNC.CUSTOMER_PULL_FIELDS); }
function syncSeqRows(rows) {
  return rows.filter(function (r) { return syncNum(r.seq) && r.seq > 0; }).sort(function (a, b) { return a.seq - b.seq; });
}

/**
 * Delta for one device. cursor = {ledgerSeq, masterRev, settingsHash, messagesHash, fullMasters, repairDays, measAfter?}.
 * Both shops' rows go to every phone (the UI filters by shop). Paged at pull_page_rows with more/nextLedgerSeq.
 * Only when the cursor carries measAfter (a number; a phone whose store keeps measurement sessions) and the store has
 * listAllMeasurements, the delta also carries measurements (syncMeasPage), measNext and measFrom (the measAfter this
 * page starts from, so the phone can tell a page built before it reset its cursor); more is then also true while
 * sessions remain. A cursor without measAfter (an older phone) gets none of these keys.
 * caps = SYNC.CAPS on every page: what this server keeps that an older one drops (syncApplyDelta reads it).
 */
function syncBuildPull(sp, device, cursor, opts) {
  cursor = cursor || {};
  opts = opts || {};
  var now = opts.now || sp.clock.now();
  var pageRows = opts.pageRows || syncSetting(sp, 'pull_page_rows', SYNC.PAGE_ROWS);
  var since = Number(cursor.ledgerSeq) || 0;
  var all = sp.store.ledgerRows();
  var sorted = syncSeqRows(all);
  syncNoteUnstamped(sp, all.length - sorted.length);
  var page = [], more = false, nextSeq = since;
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i].seq <= since) continue;
    if (page.length >= pageRows) { more = true; break; }
    page.push(sorted[i]);
  }
  if (page.length) nextSeq = page[page.length - 1].seq;
  var meas = null, measAfter = cursor.measAfter;
  if (syncNum(measAfter) && sp.store.listAllMeasurements) {
    meas = syncMeasPage(sp.store.listAllMeasurements(), measAfter, SYNC.MEAS_PAGE);
    if (meas.more) more = true;
  }
  var counters = sp.devices.counters();
  var masterRev = Number(cursor.masterRev) || 0, full = !!cursor.fullMasters;
  var items = sp.store.listItems(null).filter(function (it) { return full || Number(it.rev || 0) > masterRev; }).map(syncItemForPull);
  var customers = sp.store.listCustomers().filter(function (c) { return full || Number(c.rev || 0) > masterRev; }).map(syncCustomerForPull);
  var settings = syncSettingsFor(sp), messages = sp.store.allMessages ? sp.store.allMessages() : {};
  var settingsHash = syncMapHash(sp, settings), messagesHash = syncMapHash(sp, messages);
  var days = {};
  page.forEach(function (r) { days[r.day] = true; });
  days[syncIsoDay(now)] = true;
  days[syncYesterday(now)] = true;
  var repair = null;
  if (Array.isArray(cursor.repairDays) && cursor.repairDays.length) {
    repair = {};
    cursor.repairDays.slice(0, 7).forEach(function (d) {
      days[d] = true;
      repair[d] = sorted.filter(function (r) { return r.day === d; });
    });
  }
  var out = {
    ledger: page, nextLedgerSeq: nextSeq, more: more,
    items: items, customers: customers, masterRev: counters.rev || 0, fullMasters: full,
    settings: cursor.settingsHash === settingsHash ? null : settings, settingsHash: settingsHash,
    messages: cursor.messagesHash === messagesHash ? null : messages, messagesHash: messagesHash,
    checksums: syncChecksums(all, Object.keys(days)), repair: repair, caps: SYNC.CAPS.slice()
  };
  if (meas) {
    out.measurements = meas.list;
    out.measNext = meas.next;
    out.measFrom = measAfter;
  }
  return out;
}

/**
 * Rows without a Seq never reach a phone and keep the day's checksum from matching. Nothing writes
 * such a row any more (appendLedger stamps), so one can only come from a hand-inserted Sheet row:
 * tell the maintainer once an hour instead of editing it (backfillSync() stamps it from the editor).
 */
function syncNoteUnstamped(sp, count) {
  if (count <= 0) return;
  var key = 'noseq:' + Math.floor(sp.clock.now().getTime() / 3600000);
  if (sp.cache && sp.cache.get) {
    if (sp.cache.get(key)) return;
    try { sp.cache.put(key, '1', 3600); } catch (ignore) {}
  }
  try { sp.store.logError('ledger_no_seq', count + ' Ledger row(s) have no Seq (inserted by hand?). They are invisible to the phones until backfillSync() is run from the editor.', '', ''); } catch (ignore) {}
}

/**
 * Everything a new phone needs: the whole Ledger tab (the active year; archived years live in another
 * tab and come back as opening rows later), all masters, settings, messages, staff (self plus owners).
 * Paged at pull_page_rows by Seq with opts.cursorSeq; masters are sent on the first page only.
 */
function syncBootstrap(sp, device, opts) {
  opts = opts || {};
  var now = opts.now || sp.clock.now();
  var pageRows = opts.pageRows || syncSetting(sp, 'pull_page_rows', SYNC.PAGE_ROWS);
  var cursorSeq = Number(opts.cursorSeq) || 0;
  var all = sp.store.ledgerRows();
  var sorted = syncSeqRows(all);
  var asOfSeq = sorted.length ? sorted[sorted.length - 1].seq : 0;
  var page = [], more = false;
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i].seq <= cursorSeq) continue;
    if (page.length >= pageRows) { more = true; break; }
    page.push(sorted[i]);
  }
  var out = { asOfSeq: asOfSeq, ledger: page, more: more, nextCursorSeq: page.length ? page[page.length - 1].seq : cursorSeq, total: sorted.length };
  if (cursorSeq === 0) {
    var counters = sp.devices.counters();
    var staff = sp.store.getStaff(device.staffId) || { id: device.staffId, name: device.label, shop: device.shop, role: device.role };
    var owners = sp.store.listStaff().filter(function (s) { return s.role === 'owner'; })
      .map(function (s) { return { id: String(s.id), name: s.name, shop: s.shop, role: 'owner' }; });
    var settings = syncSettingsFor(sp), messages = sp.store.allMessages ? sp.store.allMessages() : {};
    out.items = sp.store.listItems(null).map(syncItemForPull);
    out.customers = sp.store.listCustomers().map(syncCustomerForPull);
    out.settings = settings;
    out.messages = messages;
    out.settingsHash = syncMapHash(sp, settings);
    out.messagesHash = syncMapHash(sp, messages);
    out.masterRev = counters.rev || 0;
    out.staff = { id: String(staff.id), name: staff.name, shop: staff.shop, role: staff.role };
    out.owners = owners;
    out.scope = staffShops(staff);
    out.receiptLetter = device.receiptLetter || '';
  }
  if (!more) out.checksums = syncChecksums(all, [syncIsoDay(now), syncYesterday(now)]);
  return out;
}

/* ------------------------------ daily summary line ------------------------------ */

/**
 * Burmese lines for the 21:00 summary. A device is stale when LastSeen is older than
 * stale_device_hours while it still reported PendingCount > 0, or when it has not synced at all
 * since 18:00 Yangon today. Returns [] when no device is enrolled.
 */
function syncSummaryLines(ports, now) {
  if (!ports || !ports.devices || !ports.devices.list) return [];
  now = now || ports.clock.now();
  var devices = ports.devices.list().filter(function (d) { return d.status === SYNC.STATUS.ACTIVE || d.status === SYNC.STATUS.DRAIN; });
  if (!devices.length) return [];
  var staleMs = syncSetting(ports, 'stale_device_hours', SYNC.STALE_HOURS) * 3600000;
  var dayStartUtc = new Date(now.getTime() + YANGON_OFFSET_MS);
  dayStartUtc = Date.UTC(dayStartUtc.getUTCFullYear(), dayStartUtc.getUTCMonth(), dayStartUtc.getUTCDate()) - YANGON_OFFSET_MS;
  var eveningCutoff = dayStartUtc + SYNC.STALE_EVENING_HOUR * 3600000;
  var stale = devices.filter(function (d) {
    var seen = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
    var pending = Number(d.pendingCount) || 0;
    if (pending > 0 && now.getTime() - seen > staleMs) return true;
    if (now.getTime() >= eveningCutoff && seen < eveningCutoff) return true;
    return false;
  });
  if (!stale.length) return [t(ports, 'summary_synced')];
  var list = stale.map(function (d) {
    return t(ports, 'stale_device', { shop: shopName(ports, d.shop), letter: d.receiptLetter || d.label || d.id.slice(0, 4),
      last: d.lastSeen ? syncTimeOf(d.lastSeen) : '-', pending: fmtCount(Number(d.pendingCount) || 0) });
  });
  return [t(ports, 'summary_stale', { list: list.join(', ') })];
}

/* ------------------------------ Transport B: the outbox as a document ------------------------------ */

/** Phone side: the outbox as a .json document to share with the bot when Google is unreachable. */
function syncExportDocument(meta, entries, clientTime) {
  return JSON.stringify({ format: SYNC.DOC_FORMAT, version: SYNC.DOC_VERSION, device: meta.deviceId, staff: String(meta.staffId),
    label: meta.label || '', exportedAt: clientTime, clientTime: clientTime, batchId: meta.batchId || '', entries: entries });
}

/** Parse the shared file; {doc} or {error}. The file carries no token: the Telegram sender vouches for it. */
function syncParseDocument(text) {
  var doc;
  try { doc = JSON.parse(String(text || '')); } catch (err) { return { error: 'bad_file' }; }
  if (!doc || doc.format !== SYNC.DOC_FORMAT || !syncStr(doc.device) || !Array.isArray(doc.entries)) return { error: 'bad_file' };
  return { doc: doc };
}

/**
 * Server side: the document handler runs the same syncApplyPush as api=sync. `staff` is the Telegram
 * sender; the device must belong to that staff member and be ACTIVE or DRAIN.
 * Returns {ok, text (Burmese reply), results, counts} and sends pings/notices through hooks.
 */
function syncIngestDocument(sp, text, staff, now, hooks) {
  now = now || sp.clock.now();
  hooks = hooks || {};
  var parsed = syncParseDocument(text);
  if (parsed.error) return { ok: false, error: parsed.error, text: t(sp, 'ingest_bad_file') };
  var doc = parsed.doc;
  var device = sp.devices.get(doc.device);
  if (!device || !staff || String(device.staffId) !== String(staff.id)) return { ok: false, error: 'wrong_device', text: t(sp, 'ingest_wrong_device') };
  var registered = sp.store.getStaff(device.staffId);
  if (!registered || officeRole(registered.role) || registered.role !== device.role || registered.shop !== device.shop || device.status === SYNC.STATUS.REVOKED || device.status === SYNC.STATUS.PENDING) return { ok: false, error: 'revoked', text: t(sp, 'ingest_revoked') };
  var t0 = now.getTime();
  sp = syncSellerPorts(sp, device, registered);
  var applied = syncApplyPush(sp, device, { batchId: doc.batchId || ('doc-' + now.getTime()), entries: doc.entries }, now);
  sp.devices.update(device.id, { lastSeen: now.toISOString() });
  syncDeliver(sp, applied, hooks);
  try {
    sp.sync.log({ time: now.toISOString(), deviceId: device.id, transport: SYNC.TRANSPORT.B, rowsPushed: applied.counts.rows, rowsPulled: 0,
                  durationMs: sp.clock.now().getTime() - t0, result: 'ok', appVersion: '', note: 'entries ' + doc.entries.length + ' dup ' + applied.counts.dup + ' quarantined ' + applied.counts.quarantined +
                                      (applied.counts.retry ? ' retry ' + applied.counts.retry : '') });
  } catch (ignore) {}
  var text2 = t(sp, 'ingest_done', { ok: fmtCount(applied.counts.ok), dup: fmtCount(applied.counts.dup), bad: fmtCount(applied.counts.quarantined) });
  // Entries answered retry (the store failed on them) are not in yet: the phone keeps them and sends them at its next sync.
  if (applied.counts.retry) text2 += ' · ' + t(sp, 'ingest_retry', { retry: fmtCount(applied.counts.retry) });
  return { ok: true, text: text2, results: applied.results, counts: applied.counts, flags: applied.flags };
}

/** Relay notices and owner pings through the platform hooks (Telegram on the server, chats in the sim). */
function syncDeliver(sp, applied, hooks) {
  hooks = hooks || {};
  if (hooks.relay) applied.relay.forEach(function (n) {
    try { hooks.relay(n); } catch (err) { try { sp.store.logError('sync_relay', err, '', n.to); } catch (ignore) {} }
  });
  if (hooks.ping && applied.pings.length) {
    var owners = sp.store.listStaff().filter(function (s) { return s.role === 'owner'; });
    applied.pings.forEach(function (p) {
      owners.forEach(function (o) {
        try { hooks.ping(String(o.id), p.text, p.kb); } catch (err) { try { sp.store.logError('sync_ping', err, '', o.id); } catch (ignore) {} }
      });
    });
  }
}

/* ------------------------------ the dispatcher ------------------------------ */

function syncSanitizeDevice(sp, d) {
  var staff = sp.store.getStaff(d.staffId);
  return { id: d.id, label: d.label, staffId: String(d.staffId), staff: staff ? staff.name : String(d.staffId), shop: d.shop, role: d.role,
           platform: d.platform, status: d.status, createdAt: d.createdAt, lastSeen: d.lastSeen, appVersion: d.appVersion,
           pendingCount: Number(d.pendingCount) || 0, receiptLetter: d.receiptLetter };
}

// A managed seller's phone keeps only the customers, stock and entries used by its shops.
function syncSellerPorts(sp, device, staff) {
  if (staff.role === 'owner' || !staff.shops || !staff.shops.length) return sp;
  var allowed = staffShops(staff), base = sp.store, store = syncCopy(base);
  device.scope = allowed;
  function inShop(row) { return row && allowed.indexOf(row.shop) >= 0; }
  store.ledgerRows = function () { return base.ledgerRows().filter(inShop); };
  store.listItems = function (shop) { return base.listItems(shop).filter(inShop); };
  store.getItem = function (id) { var r = base.getItem(id); return inShop(r) ? r : null; };
  if (base.getOrder) store.getOrder = function (id) { var r = base.getOrder(id); return inShop(r) ? r : null; };
  if (base.listOrders) store.listOrders = function (shop) { return base.listOrders(shop).filter(inShop); };
  function customers() {
    var ids = {};
    store.ledgerRows().concat(store.listOrders ? store.listOrders(null) : []).forEach(function (r) { if (r.customerId) ids[r.customerId] = true; });
    return ids;
  }
  store.listCustomers = function () { var ids = customers(); return base.listCustomers().filter(function (c) { return ids[c.id]; }); };
  store.getCustomer = function (id) { return customers()[id] ? base.getCustomer(id) : null; };
  store.foreignCustomer = function (id) { return !!base.getCustomer(id) && !customers()[id]; };
  if (base.listAllMeasurements) store.listAllMeasurements = function () {
    var ids = customers();
    return base.listAllMeasurements().filter(function (m) { return m.orderId ? !!store.getOrder(m.orderId) : ids[m.customerId]; });
  };
  if (base.listOptions) store.listOptions = function (name) {
    return base.listOptions(name).filter(function (r) { return !r.shop || inShop(r); });
  };
  return syncMerge(sp, { store: store });
}

/**
 * One entry point for every api. gasSyncHandle and the fake server both call this; they only
 * differ in serverPorts and hooks. Always returns a JSON-able object with ok:true|false.
 */
function syncHandle(sp, api, body, now, hooks) {
  body = body || {};
  hooks = hooks || {};
  now = now || sp.clock.now();
  var t0 = now.getTime();
  var base = { ok: true, serverTime: now.toISOString() };
  var skew = syncSkewSec(now, body.clientTime);
  if (skew !== null) base.clockSkewSec = skew;
  if (api === 'ping') return syncMerge(base, { version: SYNC.VERSION });
  loadShopRegistry(sp);
  if (api === 'enroll') return syncMerge(base, syncEnroll(sp, body, now));
  if (SYNC.API.indexOf(api) < 0) return syncMerge(base, syncError('bad_request', 'unknown api ' + api));

  var auth = syncAuthenticate(sp, body, now);
  if (!auth.ok) return syncMerge(base, auth);
  var device = auth.device;
  var drain = device.status === SYNC.STATUS.DRAIN;
  var deviceOut = { status: device.status, receiptLetter: device.receiptLetter };
  if (skew !== null && Math.abs(skew) > syncSetting(sp, 'skew_warn_sec', SYNC.SKEW_WARN_SEC)) {
    try { sp.store.logError('clock_skew', 'device ' + device.id + ' clock off by ' + skew + ' s', '', String(body.clientTime)); } catch (ignore) {}
  }

  if (api === 'office' && !drain) return syncMerge(base, syncOffice(sp, device, body, now, hooks));
  if (officeRole(device.role)) {
    if (api === 'sync' && !body.push) return syncMerge(base, { device: deviceOut, pull: null });
    return syncMerge(base, syncError('auth', 'ဤလုပ်ငန်းကို ပြုလုပ်ခွင့် မရှိပါ'));
  }
  if (auth.staff) sp = syncSellerPorts(sp, device, auth.staff);
  if (api === 'sync') {
    var out = { push: null, pull: null, device: deviceOut };
    if (body.push && body.push.entries && body.push.entries.length) {
      var applied = syncApplyPush(sp, device, body.push, now);
      syncDeliver(sp, applied, hooks);
      out.push = { batchId: applied.batchId, results: applied.results, counts: applied.counts };
    }
    var pulled = 0;
    if (body.pull && !drain) {
      out.pull = syncBuildPull(sp, device, body.pull, { now: now });
      pulled = out.pull.ledger.length;
    } else if (body.pull && drain) {
      out.pull = null;
      out.drain = true;
    }
    try {
      sp.sync.log({ time: now.toISOString(), deviceId: device.id, transport: SYNC.TRANSPORT.A,
                    rowsPushed: out.push ? out.push.counts.rows : 0, rowsPulled: pulled, durationMs: sp.clock.now().getTime() - t0,
                    result: 'ok', appVersion: body.appVersion === undefined ? '' : body.appVersion,
                    note: out.push ? ('dup ' + out.push.counts.dup + ' quarantined ' + out.push.counts.quarantined + ' flagged ' + out.push.counts.flagged +
                                      (out.push.counts.retry ? ' retry ' + out.push.counts.retry : '')) : '' });
    } catch (ignore) {}
    return syncMerge(base, out);
  }

  if (api === 'bootstrap') {
    if (drain) return syncMerge(base, syncError('drain', 'device is draining; pulls refused'));
    var b = syncBootstrap(sp, device, { now: now, cursorSeq: body.cursorSeq });
    try {
      sp.sync.log({ time: now.toISOString(), deviceId: device.id, transport: SYNC.TRANSPORT.A, rowsPushed: 0, rowsPulled: b.ledger.length,
                    durationMs: sp.clock.now().getTime() - t0, result: 'bootstrap', appVersion: body.appVersion === undefined ? '' : body.appVersion, note: 'cursor ' + (body.cursorSeq || 0) });
    } catch (ignore) {}
    return syncMerge(base, b, { device: deviceOut });
  }

  if (api === 'ai') {
    if (drain) return syncMerge(base, syncError('drain', 'device is draining; AI refused'));
    var job = body.job;
    if (!job || !syncStr(job.id) || !syncStr(job.kind)) return syncMerge(base, syncError('bad_request', 'job.id and job.kind required'));
    if (device.scope && ((job.itemId && !sp.store.getItem(String(job.itemId))) ||
        (job.kind === 'sketch' && !sp.store.listAllMeasurements().some(function (m) { return m.entryId === job.entryId; })))) return syncMerge(base, syncError('auth', 'ဆိုင် မမှန်ပါ'));
    var cached = sp.sync.aiJob(job.id);
    if (device.scope && cached && cached.deviceId !== device.id) return syncMerge(base, syncError('auth', 'သုံးခွင့် မရှိပါ'));
    if (cached && cached.status === 'done') return syncMerge(base, { job: cached, cached: true });
    // A drawing's picture (sketch) and a new piece's photo without AI (pic) are not AI jobs (round 6, revision 3): they run
    // whatever the owner's AI switch says. An AI job while the switch is off is refused without calling the hook.
    var notAi = job.kind === 'sketch' || job.kind === 'pic';
    if (!notAi && !aiOn(sp)) return syncMerge(base, { job: { id: job.id, status: 'failed', error: 'ai_off' } });
    if (!hooks.ai) return syncMerge(base, { job: { id: job.id, status: 'failed', error: 'no ai on this server' } });
    var rec = { id: job.id, deviceId: device.id, kind: job.kind, status: 'done', createdAt: job.createdAt || '', doneAt: now.toISOString(), itemId: job.itemId || '' };
    var revWas = null;
    if ((job.kind === 'photo' || job.kind === 'pic') && job.itemId && sp.store.getItem) {
      var itBefore = sp.store.getItem(String(job.itemId));
      if (itBefore) revWas = Number(itBefore.rev || 0);
    }
    try {
      var result = hooks.ai(job, device) || {};
      if (job.kind === 'photo') { rec.desc = result.desc || result; rec.photoUrl = result.photoUrl || ''; rec.thumb = result.thumb || ''; }
      else if (notAi) rec.photoUrl = result.photoUrl || '';
      else if (job.kind === 'notebook') rec.lines = result.lines || result;
      else rec.intent = result.intent || result;
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      rec.status = /429|quota|RESOURCE_EXHAUSTED/i.test(msg) ? 'quota' : 'failed';
      rec.error = msg.slice(0, 300);
      if (rec.status === 'quota') rec.retryAfterSec = SYNC.RETRY_AFTER_SEC;
      // A drawing whose session has not reached the server yet, or a photo whose item has not: the phone tries again, no Errors row.
      var quiet = (job.kind === 'sketch' && msg === 'no_session') || (job.kind === 'pic' && msg === 'no_item');
      if (!quiet) { try { sp.store.logError(rec.status === 'quota' ? 'ai_quota' : 'ai', err, job.id, job.kind); } catch (ignore) {} }
    }
    try { sp.sync.aiJob(job.id, rec); } catch (ignore) {}
    // A photo or pic job writes the item (its photo; a placeholder's AI name), which raises its Rev; the answer (not the
    // cached record) says the Rev before and after the job, so the phone whose Rev was the one before takes the new one and
    // its next entry of the piece (an undo) carries no stale base. A store without getItem answers without them.
    if (rec.status === 'done' && revWas !== null && sp.store.getItem) {
      var itAfter = sp.store.getItem(String(job.itemId));
      if (itAfter) return syncMerge(base, { job: syncMerge(rec, { itemRev: Number(itAfter.rev || 0), itemRevWas: revWas }) });
    }
    return syncMerge(base, { job: rec });
  }

  if (api === 'photo') {
    if (drain) return syncMerge(base, syncError('drain', 'device is draining'));
    var ids = Array.isArray(body.itemIds) ? body.itemIds.slice(0, SYNC.PHOTO_MAX).map(String) : [];
    if (device.scope) ids = ids.filter(function (id) { return !!sp.store.getItem(id); });
    var thumbs = {};
    ids.forEach(function (id) { thumbs[id] = null; });
    if (hooks.photo) {
      try { var got = hooks.photo(ids) || {}; ids.forEach(function (id) { thumbs[id] = got[id] === undefined ? null : got[id]; }); }
      catch (err) { try { sp.store.logError('photo_thumbs', err, '', ids.join(',')); } catch (ignore) {} }
    }
    return syncMerge(base, { thumbs: thumbs });
  }

  if (api === 'report') {
    if (drain) return syncMerge(base, syncError('drain', 'device is draining'));
    var kind = String(body.kind || 'today'), report;
    try {
      if (kind === 'receipt') {
        var rcpt = buildReceipt(sp, String(body.groupId || ''));
        if (!rcpt) return syncMerge(base, syncError('bad_request', 'no such sale'));
        report = receiptReport(sp, rcpt, now);
      } else {
        report = buildReport(sp, kind, { shop: device.role === 'owner' ? null : device.shop, now: now });
      }
    } catch (err) { return syncMerge(base, syncError('bad_request', err && err.message ? err.message : String(err))); }
    if (!hooks.report) return syncMerge(base, syncError('server', 'no pdf on this server'));
    try { return syncMerge(base, hooks.report(report, device, !!body.inline) || { sentTo: 'none' }); }
    catch (err) { try { sp.store.logError('report', err, '', kind); } catch (ignore) {} return syncMerge(base, syncError('server', 'report failed')); }
  }

  if (api === 'devices') {
    if (device.role !== 'owner') return syncMerge(base, syncError('auth', 'owner only'));
    var action = String(body.action || 'list');
    if (action !== 'list') {
      var act = syncDeviceAction(sp, body.target, action, now);
      if (!act.ok) return syncMerge(base, syncError('bad_request', act.error));
    }
    return syncMerge(base, { devices: sp.devices.list().map(function (d) { return syncSanitizeDevice(sp, d); }) });
  }
  return syncMerge(base, syncError('bad_request', 'unhandled api ' + api));
}

/** Drain, revoke or activate one device (api=devices and the DV| buttons). {ok, device} or {ok:false, error}. */
function syncDeviceAction(sp, deviceId, action, now) {
  now = now || sp.clock.now();
  var d = sp.devices.get(String(deviceId || ''));
  if (!d) return { ok: false, error: 'no such device' };
  if (action === 'drain') sp.devices.update(d.id, { status: SYNC.STATUS.DRAIN, note: 'drain since ' + now.toISOString() });
  else if (action === 'revoke') sp.devices.update(d.id, { status: SYNC.STATUS.REVOKED, note: 'revoked ' + now.toISOString() });
  else if (action === 'activate') sp.devices.update(d.id, { status: SYNC.STATUS.ACTIVE, note: '' });
  else return { ok: false, error: 'unknown action ' + action };
  return { ok: true, device: sp.devices.get(d.id) };
}

/**
 * The owner's 📱 reply in Telegram: {text, kb}. One row per live device with ⏸ drain (or 🟢 activate
 * while draining) and ❌ revoke; callback_data DV|<16 hex>|activate is 28 bytes. Pending codes are
 * not listed, revoked phones have no buttons. ports is the bot's ports (Messages overrides).
 */
function syncDevicesReply(sp, ports) {
  var devices = sp.devices.list().filter(function (d) { return d.status !== SYNC.STATUS.PENDING; })
    .map(function (d) { return syncSanitizeDevice(sp, d); });
  var kb = devices.filter(function (d) { return d.status !== SYNC.STATUS.REVOKED; }).map(function (d) {
    var draining = d.status === SYNC.STATUS.DRAIN, who = d.receiptLetter || d.label;
    return [{ text: t(ports, draining ? 'btn_device_activate' : 'btn_device_drain') + ' ' + who, callback_data: 'DV|' + d.id + '|' + (draining ? 'activate' : 'drain') },
            { text: t(ports, 'btn_device_revoke') + ' ' + who, callback_data: 'DV|' + d.id + '|revoke' }];
  });
  return { text: syncDevicesText(ports, devices), kb: kb };
}

/** Telegram /devices text for the owner (syncDevicesReply adds the buttons). */
function syncDevicesText(ports, devices) {
  if (!devices.length) return t(ports, 'device_none');
  var lines = [t(ports, 'devices_title')];
  devices.forEach(function (d) {
    var st = t(ports, 'device_status_' + d.status);
    lines.push(t(ports, 'device_line', { status: st === 'device_status_' + d.status ? d.status : st, label: d.label || d.staff || d.id.slice(0, 6),
      shop: shopName(ports, d.shop), letter: d.receiptLetter || '-', last: d.lastSeen ? syncTimeOf(d.lastSeen) : '-', pending: fmtCount(d.pendingCount || 0) }));
  });
  return lines.join('\n');
}

/* ------------------------------ client side helpers (phone) ------------------------------ */

/**
 * Pick the next batch from the outbox in SYNC.ENTRY_KINDS order: customers, items, list options, groups in commit
 * order, measurement sessions, notices, errors; never more than `max` ledger rows and never a split group (entries
 * sorted after a group that does not fit wait for the next batch). Returns {entries, rows, entryIds}.
 */
function syncPlanPush(outboxEntries, max) {
  max = max || SYNC.PUSH_MAX_ROWS;
  var sorted = (outboxEntries || []).map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) {
    return (SYNC.ENTRY_KINDS[a.e.kind] || 9) - (SYNC.ENTRY_KINDS[b.e.kind] || 9) || a.i - b.i;
  });
  var entries = [], rows = 0, stop = false;
  sorted.forEach(function (x) {
    if (stop) return;
    var e = x.e, n = e.kind === 'group' ? e.txs.length : 0;
    if (n && rows + n > max && rows > 0) { stop = true; return; }   // groups after a full page wait; a lone big group still goes
    entries.push(e);
    rows += n;
  });
  return { entries: entries, rows: rows, entryIds: entries.map(function (e) { return e.entryId; }) };
}

/**
 * Apply the server's push results to the local store (the LOCAL STORE CONTRACT methods
 * removeEntry(entryId), markSynced(txId, seq, receivedAt, deviceId), removeRows(txIds); optional
 * measurementSynced(customerId, id) and measurementRejected(customerId)).
 * ok and dup both mean "the server has it"; quarantined rows never became truth and leave the phone.
 * A measurement entry, after it left the outbox: ok or dup calls measurementSynced with the server's session id,
 * quarantined calls measurementRejected (each only when the local store has the method). A list entry that leaves the
 * outbox quarantined clears cursor.settingsHash, so the next pull replaces lists_json and the option the server never
 * stored leaves the phone's buttons. A setting entry answered dup clears it too (round 6: nothing was written, so the
 * server's value comes back whatever this phone holds).
 * Any other status (retry, or one this version does not know) leaves the entry in the outbox: it is sent again. So does
 * a list or measurement entry answered bad_kind without kindKnown: that server is older than the kind (the bot rolled
 * back, or the app published before it); nothing is lost, and the entry goes in once the server knows the kind.
 * Returns {acked:[entryIds], quarantined:[{entry, reason}], flagged:[{entry, flags}]}.
 */
function syncApplyPushResults(localStore, entries, results, serverTime, deviceId) {
  var acked = [], quarantined = [], flagged = [], byId = {};
  (entries || []).forEach(function (e) { byId[e.entryId] = e; });
  (results || []).forEach(function (r) {
    if (!r) return;
    var e = byId[r.entryId];
    if (!e) return;
    if (r.status === 'quarantined' && r.reason === SYNC.REASON.BAD_KIND && !r.kindKnown && (e.kind === 'list' || e.kind === 'measurement' || e.kind === 'setting')) return;
    if (r.status === 'ok' || r.status === 'dup') {
      if (e.kind === 'group') {
        e.txs.forEach(function (tx, k) {
          var seq = r.seqByTx && r.seqByTx[tx.txId] !== undefined ? r.seqByTx[tx.txId] : (r.seq && r.seq[k] !== undefined ? r.seq[k] : null);
          localStore.markSynced(tx.txId, seq, serverTime || '', deviceId || '');
        });
      }
      if (e.kind === 'item' && r.rev && localStore.setItemRev) localStore.setItemRev(e.id, r.rev);
      if (e.kind === 'customer' && r.rev && localStore.setCustomerRev) localStore.setCustomerRev(e.id, r.rev);
      localStore.removeEntry(e.entryId);
      if (e.kind === 'measurement' && e.rec && localStore.measurementSynced) localStore.measurementSynced(e.rec.customerId, r.id);
      // A setting answered dup was not written: the next pull brings the server's whole Settings map, so this phone shows
      // what every other phone shows even where its own text differed from the stored one.
      if (e.kind === 'setting' && r.status === 'dup' && localStore.getCursor && localStore.setCursor) {
        var dcur = localStore.getCursor();
        if (dcur) { dcur.settingsHash = ''; localStore.setCursor(dcur); }
      }
      acked.push(e.entryId);
      if (r.flags && r.flags.length) flagged.push({ entry: e, flags: r.flags });
    } else if (r.status === 'quarantined') {
      if (e.kind === 'group') localStore.removeRows(e.txs.map(function (tx) { return tx.txId; }));
      localStore.removeEntry(e.entryId);
      if (e.kind === 'measurement' && e.rec && localStore.measurementRejected) localStore.measurementRejected(e.rec.customerId);
      // A refused option or setting (round 6) leaves the phone too: the next pull brings the server's Settings back.
      if ((e.kind === 'list' || e.kind === 'setting') && localStore.getCursor && localStore.setCursor) {
        var cur = localStore.getCursor();
        if (cur) { cur.settingsHash = ''; localStore.setCursor(cur); }
      }
      quarantined.push({ entry: e, reason: r.reason });
    }
    // Any other status ('retry': the server's store failed on this entry) keeps the entry for the next sync.
  });
  return { acked: acked, quarantined: quarantined, flagged: flagged };
}

/**
 * Apply a pull delta to the local store (contract: upsertItem, upsertCustomer, hasRow, appendSynced,
 * markSynced, setSettings, setMessages, getCursor, setCursor, syncedRows, replaceDay; optional upsertMeasurement).
 * Checksums are compared only on the last page (more:false); differing days come back as repairDays
 * for the caller to request. Measurement sessions are upserted, and cursor.measAfter advanced to measNext, only
 * when the local store has upsertMeasurement (such a store starts its cursor with measAfter: 0; a store without it
 * loses any measAfter its cursor carries, so it never pages sessions it cannot keep), and the cursor
 * is advanced only from the measAfter the page was built from: when measurementRejected reset it to 0 while this
 * reply was applied, it stays 0 so the next pull brings every session again.
 * A delta whose caps do not name dueDay comes from a server older than the DueDay column (the bot rolled back, or the
 * app published before it), which would drop a promised date without a word (its Ledger map has no DueDay and the
 * checksums ignore it): the Settings map is stored with sale_flow quick (syncSettingsQuick), so the phone sells with
 * the one-tap card until a pull says the server keeps the date. cursor.quickForced says which map is stored; when the
 * server changes side on a page without Settings (the hash matched: a phone enrolled on that server, or two maps
 * alike), the hash is cleared and the page is marked more, so the caller's next page in this same sync brings them.
 * Returns {added, items, customers, measurements, repairDays, repaired}.
 */
function syncApplyDelta(localStore, delta) {
  var added = 0, repaired = [], meas = 0;
  if (!delta) return { added: 0, items: 0, customers: 0, measurements: 0, repairDays: [], repaired: [] };
  (delta.items || []).forEach(function (it) { localStore.upsertItem(it); });
  (delta.customers || []).forEach(function (c) { localStore.upsertCustomer(c); });
  (delta.ledger || []).forEach(function (row) {
    if (localStore.hasRow(row.txId)) localStore.markSynced(row.txId, row.seq, row.receivedAt, row.deviceId);
    else { localStore.appendSynced(row); added++; }
  });
  var oldServer = !(Array.isArray(delta.caps) && delta.caps.indexOf('dueDay') >= 0);
  if (delta.settings) localStore.setSettings(oldServer ? syncSettingsQuick(delta.settings) : delta.settings);
  if (delta.messages) localStore.setMessages(delta.messages);
  if (delta.repair) {
    Object.keys(delta.repair).forEach(function (day) { localStore.replaceDay(day, delta.repair[day]); repaired.push(day); });
  }
  var keepsMeas = !!localStore.upsertMeasurement;
  if (keepsMeas && Array.isArray(delta.measurements)) {
    delta.measurements.forEach(function (m) { localStore.upsertMeasurement(m); meas++; });
  }
  var cursor = localStore.getCursor();
  if (delta.nextLedgerSeq !== undefined && delta.nextLedgerSeq > (cursor.ledgerSeq || 0)) cursor.ledgerSeq = delta.nextLedgerSeq;
  if (delta.masterRev !== undefined) cursor.masterRev = Math.max(cursor.masterRev || 0, delta.masterRev);
  if (delta.settings) { if (oldServer) cursor.quickForced = true; else delete cursor.quickForced; }
  else if (oldServer !== !!cursor.quickForced && cursor.settingsHash) { cursor.settingsHash = ''; delta.more = true; }
  // A page without settings was built from a hash that matched; a hash cleared since (a list entry quarantined in the
  // push of this same request, syncApplyPushResults) stays clear, so the next pull brings the Settings again.
  if (delta.settingsHash && (delta.settings || cursor.settingsHash !== '')) cursor.settingsHash = delta.settingsHash;
  if (delta.messagesHash) cursor.messagesHash = delta.messagesHash;
  if (keepsMeas && !syncNum(cursor.measAfter)) cursor.measAfter = 0;  // a cursor saved before the store kept sessions
  // A store that cannot keep sessions never asks for them: a measAfter it carries anyway (a cursor saved by another build)
  // is dropped, else it would never advance and every reply would say more: true for ever.
  if (!keepsMeas && cursor.measAfter !== undefined) delete cursor.measAfter;
  if (keepsMeas && syncNum(delta.measNext) && (delta.measFrom === undefined || delta.measFrom === cursor.measAfter) &&
      delta.measNext > cursor.measAfter) cursor.measAfter = delta.measNext;
  localStore.setCursor(cursor);
  var repairDays = [];
  if (!delta.more && delta.checksums) {
    var local = syncChecksums(localStore.syncedRows(), Object.keys(delta.checksums));
    repairDays = syncChecksumsDiff(local, delta.checksums).filter(function (d) { return repaired.indexOf(d) < 0; });
  }
  return { added: added, items: (delta.items || []).length, customers: (delta.customers || []).length, measurements: meas, repairDays: repairDays, repaired: repaired };
}

/** A copy of a pulled Settings map with sale_flow quick (syncApplyDelta, for a server that does not keep DueDay). */
function syncSettingsQuick(map) {
  var out = {}, k;
  for (k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out[k] = map[k];
  out.sale_flow = CFG.SALE_FLOW.QUICK;
  return out;
}

/** Per-device receipt number: R1-A-000231 (shop digit, device letter, gap-free counter). */
function syncReceiptNo(shop, letter, counter) {
  return 'R' + String(shop).replace(/\D/g, '') + '-' + letter + '-' + ('000000' + counter).slice(-6);
}

/** Online management. Read current staff permissions under the same lock as the mutation. */
function syncOffice(sp, device, body, now, hooks) {
  function perform() {
    var actor = sp.store.getStaff(device.staffId);
    if (!actor || actor.role !== device.role || actor.shop !== device.shop) return syncError('revoked', 'ချိတ်ဆက်မှု သက်တမ်းကုန်ပါပြီ');
    var owner = actor.role === 'owner', admin = hasJob(actor, 'access');
    var action = body.action, shops = shopRegistry(sp);
    var shopIds = shops.map(function (s) { return s.id; });
    var scope = staffShops(actor);
    if (['designs','piece','piecePhoto','orders','order','orderStep','measure'].indexOf(action) >= 0) return syncWorkshop(sp, actor, body, hooks);
    if (['stock', 'sendStock', 'receiveStock'].indexOf(action) >= 0) return syncStockSlip(sp, actor, body, now);
    if (action === 'expenseBook' || action === 'recordExpense') {
      if (!hasJob(actor, 'bookkeeper')) return syncError('auth', 'သုံးခွင့် မရှိပါ');
      var open = scope.filter(function (id) { return activeShopIds(sp).indexOf(id) >= 0; });
      var site = String(body.shop || open[0] || '');
      if (open.indexOf(site) < 0) return syncError('bad_request', 'ဖွင့်ထားသည့်ဆိုင် ရွေးပါ');
      var cats = expenseCategories(sp, site), methods = payMethods(sp, site);
      if (action === 'expenseBook') return { ok: true, shop: site, shops: open.map(function (id) { return { id: id, name: shopName(sp, id) }; }),
        categories: cats.map(function (c) { return { id: c[0], name: c[1] }; }),
        methods: methods.map(function (m) { return { id: m, name: methodLabel(sp, m) }; }) };
      var amount = Number(body.amount), note = String(body.note || '').trim();
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > SYNC.MAX_AMOUNT || note.length > 180 ||
          !/^BOOK-[a-zA-Z0-9-]{8,80}$/.test(body.slip) || !cats.some(function (c) { return c[0] === body.category; }) ||
          methods.indexOf(body.method) < 0) return syncError('bad_request', 'ငွေပမာဏနှင့် အမျိုးအစား ပြန်စစ်ပါ');
      var prior = sp.store.ledgerRows().filter(function (r) { return r.groupId === body.slip; })[0];
      if (prior) return prior.staffId === String(actor.id) && prior.shop === site && prior.amount === -amount &&
        prior.category === body.category && prior.method === body.method && prior.note === note ? { ok: true } : syncError('bad_request', 'ဘောက်ချာနံပါတ် ရှိပြီးသား');
      writeGroup(sp, [newTx(sp, { groupId: body.slip, type: CFG.TX.EXPENSE, shop: site, amount: -amount, cash: -amount,
        category: body.category, method: body.method, staffId: String(actor.id), note: note, when: now })]);
      return { ok: true };
    }
    if (action === 'close') {
      if (!hasJob(actor, 'staff') && !hasJob(actor, 'bookkeeper') && !hasJob(actor, 'viewer')) return syncError('auth', 'စာရင်း ကြည့်ခွင့် မရှိပါ');
      var period = String(body.period || dayKey(now));
      if (!/^\d{4}(-(0[1-9]|1[012])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(period)) return syncError('bad_request', 'ရက်စွဲ ပြန်ရွေးပါ');
      var selected = body.shop ? [String(body.shop)] : scope;
      if (selected.some(function (id) { return scope.indexOf(id) < 0; })) return syncError('auth', 'ဆိုင် မမှန်ပါ');
      var report = closingReport(sp, period, selected, now);
      var stale = sp.devices.list().filter(function (d) {
        var worker = sp.store.getStaff(d.staffId);
        return worker && hasJob(worker, 'staff') && (d.status === SYNC.STATUS.ACTIVE || d.status === SYNC.STATUS.DRAIN) &&
          staffShops(worker).some(function (id) { return selected.indexOf(id) >= 0; }) &&
          (Number(d.pendingCount) > 0 || !d.lastSeen || dayKey(new Date(d.lastSeen)) < dayKey(now));
      });
      return { ok: true, report: report, unconfirmed: stale.length, shops: scope.map(function (id) { return { id: id, name: shopName(sp, id) }; }) };
    }
    if (!admin) return syncError('auth', 'ပြောင်းလဲခွင့် မရှိပါ');
    if (action === 'shops') return { ok: true, shops: shops.map(function (s) { return { id: s.id, name: shopName(sp, s.id), address: shopAddress(sp, s.id), phone: shopPhone(sp, s.id), active: s.active }; }) };
    if (action === 'shop' && owner) {
      var name = String(body.name || '').trim(), id = String(body.shop || '');
      if (!name || name.length > CFG.SHOP_TEXT_MAX.name || !/^S[1-9]\d*$/.test(id)) return syncError('bad_request', 'ဆိုင်အမည်နှင့် နံပါတ် စစ်ပါ');
      var found = shops.filter(function (s) { return s.id === id; })[0];
      if (found && body.create) return syncError('bad_request', 'ဆိုင်နံပါတ် ရှိပြီးသားပါ');
      if (!found && body.active === false) return syncError('bad_request', 'ဆိုင် မရှိပါ');
      if (!found && sp.store.prepareShopTags) sp.store.prepareShopTags(id);
      if (!found) shops.push({ id: id, active: true });
      else {
        if (found.active && body.active === false) found.closedAt = now.toISOString();
        if (body.active !== false) delete found.closedAt;
        found.active = body.active !== false;
      }
      if (!shops.some(function (s) { return s.active; })) return syncError('bad_request', 'ဆိုင်တစ်ဆိုင် ဖွင့်ထားရန် လိုပါသည်');
      if (body.address !== undefined) sp.store.setSetting('shop_address_' + id, String(body.address).trim().slice(0, CFG.SHOP_TEXT_MAX.address));
      if (body.phone !== undefined) sp.store.setSetting('shop_phone_' + id, String(body.phone).trim().slice(0, CFG.SHOP_TEXT_MAX.phone));
      sp.store.setSetting('shop_name_' + id, name);
      sp.store.setSetting('shop_registry', JSON.stringify(shops));
      loadShopRegistry(sp);
      return { ok: true };
    }
    if (action === 'people') return { ok: true, people: sp.store.listStaff(true), shops: activeShopIds(sp).map(function (id) { return { id: id, name: shopName(sp, id) }; }) };
    if (action === 'invite') {
      var target = sp.store.getStaff(String(body.target));
      if (!target || (target.role === 'owner' && actor.id !== target.id) || (!owner && hasJob(target, 'access'))) return syncError('auth', 'သုံးခွင့် မရှိပါ');
      return { ok: true, code: syncMintCode(sp, target, target.name, now).display };
    }
    if (action !== 'person') return syncError('bad_request', 'လုပ်ငန်း မမှန်ပါ');
    var person = body.person || {}, old = sp.store.listStaff(true).filter(function (s) { return String(s.id) === String(person.id); })[0];
    var jobs = String(person.role || '').split('+'), allowedJobs = ['staff','access','bookkeeper','viewer','designer','tailor'];
    var assigned = person.shops || [person.shop];
    if (!Array.isArray(assigned) || !assigned.length || assigned.indexOf(person.shop) < 0 || assigned.some(function (id) { return activeShopIds(sp).indexOf(id) < 0; }))
      return syncError('bad_request', 'ဆိုင် ရွေးပါ');
    if (!/^(?:\d{1,18}|W-[A-Z0-9]{1,12})$/.test(String(person.id)) || !String(person.name || '').trim() || String(person.name).length > 60 ||
        jobs.some(function (j) { return allowedJobs.indexOf(j) < 0; }) || activeShopIds(sp).indexOf(person.shop) < 0)
      return syncError('bad_request', 'အမည်၊ ဆိုင်နှင့် တာဝန် ပြန်စစ်ပါ');
    if (String(actor.id) === String(person.id) || (old && old.role === 'owner') ||
        (!owner && (hasJob(old, 'access') || hasJob(person, 'access')))) return syncError('auth', 'ပြောင်းလဲခွင့် မရှိပါ');
    person = { name: String(person.name).trim(), id: String(person.id), shop: person.shop, shops: assigned, role: jobs.sort().join('+'), active: person.active === true };
    var reset = !person.active || (old && (!old.shops || old.role !== person.role || old.shop !== person.shop || staffShops(old).join() !== assigned.join()));
    if (reset && sp.devices.list().some(function (d) {
      return String(d.staffId) === person.id && d.status === SYNC.STATUS.ACTIVE && Number(d.pendingCount) > 0;
    })) return syncError('bad_request', 'ဝန်ထမ်းဖုန်းရှိ စာရင်းများကို အရင် ပို့ပါ');
    sp.store.saveStaff(person);
    if (reset) {
      sp.devices.list().forEach(function (d) {
        if (String(d.staffId) === String(person.id)) sp.devices.update(d.id, { status: SYNC.STATUS.REVOKED });
      });
    }
    return { ok: true };
  }
  var reads = ['close', 'expenseBook', 'people', 'shops', 'stock', 'designs', 'orders', 'order'];
  return reads.indexOf(body.action) >= 0 ? perform() : sp.lock.run(perform);
}

function syncStockSlip(sp, actor, body, now) {
  var scope = staffShops(actor);
  if (!hasJob(actor, 'staff')) return syncError('auth', 'သုံးခွင့် မရှိပါ');
  var active = activeShopIds(sp), slips = {}, rows = sp.store.ledgerRows();
  rows.forEach(function (r) {
    if (String(r.groupId).indexOf('SHIP-') !== 0) return;
    var slip = slips[r.groupId] || (slips[r.groupId] = {});
    if (r.type === CFG.TX.TRANSFER_OUT) slip.out = r;
    if (r.type === CFG.TX.TRANSFER_IN) slip.received = r;
  });
  if (body.action === 'stock') {
    var incoming = [];
    Object.keys(slips).forEach(function (k) {
      var s = slips[k], r = s.out;
      if (!r) return;
      var to = r.note.slice(3), item = s.received && sp.store.getItem(s.received.itemId);
      if ((scope.indexOf(to) >= 0) && (!s.received || (item && !item.createdAt))) incoming.push({ id: k, from: shopName(sp, r.shop), to: shopName(sp, to), toId: to, tag: r.itemId, qty: -r.qty });
    });
    return { ok: true, shops: active.map(function (id) { return { id: id, name: shopName(sp, id) }; }), incoming: incoming };
  }
  var id = String(body.slip || ''), existing = slips[id];
  if (!/^SHIP-[a-zA-Z0-9-]{8,80}$/.test(id)) return syncError('bad_request', 'ဘောက်ချာနံပါတ် မမှန်ပါ');
  var item = sp.store.getItem(String(body.tag || '').toUpperCase());
  if (!item) return syncError('bad_request', 'Tag မတွေ့ပါ');
  if (body.action === 'sendStock') {
    if (existing) return existing.out && existing.out.staffId === String(actor.id) && existing.out.itemId === item.id && -existing.out.qty === Number(body.qty) && existing.out.note === 'to ' + body.to ? { ok: true } : syncError('bad_request', 'ဘောက်ချာ ရှိပြီးသား');
    var qty = Number(body.qty);
    if ((scope.indexOf(item.shop) < 0) || active.indexOf(item.shop) < 0 || active.indexOf(body.to) < 0 || item.shop === body.to ||
        !(qty > 0 && qty === Math.floor(qty) && qty <= item.stock) || item.status === CFG.STATUS.BLANK) return syncError('bad_request', 'ဆိုင်နှင့် လက်ကျန် စစ်ပါ');
    var fields = syncPick(item, ['name','category','type','price','cost','sample','photoUrl','photoFileId']);
    sp.store.appendLedger(newTx(sp, { groupId: id, itemId: item.id, qty: -qty, shop: item.shop, type: CFG.TX.TRANSFER_OUT,
      note: 'to ' + body.to, transcript: JSON.stringify(fields), staffId: String(actor.id), when: now }));
    return { ok: true };
  }
  if (!existing || !existing.out) return syncError('bad_request', 'ပို့စာ မတွေ့ပါ');
  var out = existing.out, dest = out.note.slice(3);
  if ((scope.indexOf(dest) < 0) || dest !== item.shop || (existing.received && existing.received.itemId !== item.id))
    return syncError('bad_request', 'လက်ခံမည့်ဆိုင်၏ Tag ကို သုံးပါ');
  if (existing.received && item.createdAt) return { ok: true };
  if (!existing.received && item.status !== CFG.STATUS.BLANK) return syncError('bad_request', 'Tag အသစ် လိုပါသည်');
  var data = JSON.parse(out.transcript);
  data.createdBy = actor.id; data.createdAt = now.toISOString();
  if (!existing.received) sp.store.appendLedger(newTx(sp, { groupId: id, itemId: item.id, qty: -out.qty, shop: dest,
    type: CFG.TX.TRANSFER_IN, note: 'from ' + out.shop, staffId: String(actor.id), when: now }));
  sp.store.updateItem(item.id, data);
  return { ok: true };
}

function syncWorkshop(sp, actor, body, hooks) {
  var a = body.action, scope = staffShops(actor), designer = ['designs','piece','piecePhoto'].indexOf(a) >= 0;
  if (!hasJob(actor, designer ? 'designer' : 'tailor')) return syncError('auth', 'တာဝန်နှင့် မကိုက်ညီပါ');
  if (designer) {
    if (a === 'designs') {
      return { ok: true, categories: itemCategoryRows(sp).map(function (r) { return r.label; }),
        items: sp.store.listItems(null).filter(function (it) { return scope.indexOf(it.shop) >= 0 && it.status !== CFG.STATUS.BLANK && (it.sample || isPricePending(it)); })
          .map(function (it) { return { id: it.id, name: it.name, sample: it.sample, pending: isPricePending(it) }; }) };
    }
    var item = sp.store.getItem(String(body.tag || '').trim().toUpperCase());
    if (!item || scope.indexOf(item.shop) < 0 || activeShopIds(sp).indexOf(item.shop) < 0) return syncError('bad_request', 'Tag နှင့် ဆိုင် စစ်ပါ');
    if (a === 'piecePhoto') {
      if (!hooks.ai || item.status === CFG.STATUS.BLANK || !body.data || body.data.length > 3000000 || !/^[A-Za-z0-9+/=]+$/.test(body.data)) return syncError('bad_request', 'ဓာတ်ပုံ စစ်ပါ');
      hooks.ai({ id: sp.uuid(), kind: 'pic', mime: 'image/jpeg', data: body.data, itemId: item.id }, { shop: item.shop, staffId: actor.id });
      return { ok: true };
    }
    if (!String(body.name || '').trim() || String(body.name).length > 80) return syncError('bad_request', 'ပစ္စည်းအမည် ဖြည့်ပါ');
    var worker = syncMerge(actor, { shop: item.shop });
    return commitNewItem(sp, { staff: worker, itemId: item.id, name: body.name, category: body.category, cost: body.cost,
      price: body.price, count: Number(body.qty), sample: body.sample === true, source: CFG.SOURCE.BUTTON });
  }
  if (!sp.store.listOrders) return syncError('bad_request', 'အော်ဒါစာရင်း မရရှိပါ');
  if (a === 'orders') {
    return { ok: true, orders: openOrders(sp, null).filter(function (o) { return scope.indexOf(o.shop) >= 0; }).map(function (o) {
      return { id: o.id, shop: shopName(sp, o.shop), customer: customerName(sp, o.customerId), due: o.dueDay, status: orderStatusLabel(sp, o.status) };
    }) };
  }
  var order = sp.store.getOrder(String(body.id || ''));
  if (!order || scope.indexOf(order.shop) < 0 || !orderIsOpen(order)) return syncError('bad_request', 'အော်ဒါကို ပြန်စစ်ပါ');
  if (a === 'order') {
    var last = order.measId && sp.store.getMeasurement ? sp.store.getMeasurement(order.measId) : null;
    return { ok: true, text: orderCardText(sp, order), next: nextStatuses(order).map(function (k) { return { id: k, name: orderStatusLabel(sp, k) }; }),
      fields: measureFields(sp, true).map(function (f) { return { key: f.key, name: f.labelMy, value: last && last.fields[f.key] || '' }; }) };
  }
  if (activeShopIds(sp).indexOf(order.shop) < 0) return syncError('bad_request', 'ဆိုင် ပိတ်ထားပါသည်');
  if (a === 'orderStep') return setOrderStatus(sp, order.id, String(body.status), syncMerge(actor, { shop: order.shop }));
  var values = {}, any = false;
  measureFields(sp, true).forEach(function (f) { var v = String((body.values || {})[f.key] || '').trim().slice(0, 300); values[f.key] = v; if (v) any = true; });
  if (!any) return syncError('bad_request', 'အတိုင်းအတာ ဖြည့်ပါ');
  saveMeasurement(sp, { customerId: order.customerId, orderId: order.id, values: values, source: CFG.MEAS_SOURCE.FORM }, actor);
  return { ok: true };
}
