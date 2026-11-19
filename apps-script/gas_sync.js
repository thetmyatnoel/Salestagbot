/**
 * gas_sync.js — the Google side of the sync API (core_sync.js holds every rule).
 *
 * doPost(e) in gas_main.js routes `?api=<name>` here before the Telegram token check. The reply is
 * JSON through ContentService (the phone's fetch follows the 302 to script.googleusercontent.com);
 * the Telegram branch keeps HtmlService. Device tokens travel only in the JSON body and are stored
 * as SHA-256 in the Devices tab. Tabs Devices, SyncLog, Quarantine and AiJobs are created on first
 * use with the CFG headers. LEDGER_SEQ and MASTER_REV live in Script Properties and are touched only
 * inside the script lock (serverPorts.lock.run wraps every write path; it is gasLocked() of gas_main.js,
 * the one re-entrant holder, so a store method that locks itself can run inside a batch).
 *
 * One-time helper for the editor: backfillSync() stamps Seq on rows from before this version, Rev on
 * masters and ReceiptNo on old SALE groups. It is the single sanctioned code path that writes into
 * existing Ledger rows, run by hand once after the paste; new rows are stamped as they are appended
 * (gasStore.appendLedger, gasSyncTabs.appendRows), so it never has to be re-run unless someone inserts
 * a Sheet row by hand. Telegram side: gasSyncBotPort() is ports.sync for core_bot (the 📲 button mints
 * a typed code with syncMintEnrollCode, /devices and the DV| buttons use gasSyncDevicesText and
 * gasSyncDeviceAction), gasSyncTelegramDocument(update) is called by doPost for Transport B,
 * gasSyncSummaryLines() adds the stale-phone line to the 21:00 summary.
 */

var GAS_SYNC_TABS = {
  Devices: CFG.DEVICE_COLS, SyncLog: CFG.SYNCLOG_COLS, Quarantine: CFG.QUARANTINE_COLS, AiJobs: CFG.AIJOB_COLS
};

/** The web app branch: always JSON, always 200 after the redirect, never throws. */
function gasSyncHandle(api, e) {
  var body = {}, out;
  try {
    var raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    if (raw) body = JSON.parse(raw);
  } catch (err) {
    return gasSyncJson({ ok: false, error: 'bad_request', message: 'body is not JSON', serverTime: new Date().toISOString() });
  }
  try {
    out = syncHandle(gasSyncServerPorts(), String(api), body, new Date(), gasSyncHooks());
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    try { gasStore.logError('gasSyncHandle:' + api, err, body && body.device ? String(body.device) : '', String(api)); } catch (ignore) {}
    out = /lock|timed out|timeout/i.test(msg) ? { ok: false, error: 'busy', message: 'try again', retryAfterSec: 10 }
                                             : { ok: false, error: 'server', message: msg.slice(0, 200) };
    out.serverTime = new Date().toISOString();
  }
  return gasSyncJson(out);
}

function gasSyncJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------ tabs ------------------------------ */

function gasSyncSheet(name) {
  var ss = gasSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var header = GAS_SYNC_TABS[name];
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (name === 'Devices') sh.hideSheet();          // token hashes: not a tab the family browses
  }
  return sh;
}

/** Every row of a sync tab as objects keyed by header (no caching: these tabs are small and change often). */
function gasSyncRows(name) {
  var sh = gasSyncSheet(name);
  var values = sh.getDataRange().getValues();
  var header = values[0] || [], rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 }, empty = true;
    for (var c = 0; c < header.length; c++) {
      var v = values[r][c];
      o[header[c]] = v;
      if (v !== '' && v !== null && v !== undefined) empty = false;
    }
    if (!empty) rows.push(o);
  }
  return rows;
}

/* ------------------------------ counters (Script Properties, under the caller's lock) ------------------------------ */

function gasSyncProp(key, def) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === undefined || v === '' ? def : Number(v);
}
function gasSyncSetProp(key, value) { PropertiesService.getScriptProperties().setProperty(key, String(value)); }

var gasSyncCounters = {
  counters: function () { return { seq: gasSyncProp('LEDGER_SEQ', 0), rev: gasSyncProp('MASTER_REV', 0) }; },
  setCounters: function (c) {
    if (c.seq !== undefined) gasSyncSetProp('LEDGER_SEQ', c.seq);
    if (c.rev !== undefined) gasSyncSetProp('MASTER_REV', c.rev);
  },
  nextSeq: function () { var n = gasSyncProp('LEDGER_SEQ', 0) + 1; gasSyncSetProp('LEDGER_SEQ', n); return n; },
  nextRev: function () { var n = gasSyncProp('MASTER_REV', 0) + 1; gasSyncSetProp('MASTER_REV', n); return n; }
};

/* ------------------------------ Devices tab ------------------------------ */

function gasSyncDeviceFromRow(o) {
  var d = { _row: o._row };
  SYNC.DEVICE_FIELDS.forEach(function (f, i) {
    var v = o[CFG.DEVICE_COLS[i]];
    if (v instanceof Date) v = v.toISOString();
    if (f === 'pendingCount') v = Number(v) || 0;
    else if (f === 'appVersion') v = v === '' || v === null || v === undefined ? '' : v;
    else v = v === null || v === undefined ? '' : String(v);
    d[f] = v;
  });
  return d;
}

var gasDevices = {
  list: function () { return gasSyncRows('Devices').map(gasSyncDeviceFromRow); },
  get: function (id) {
    var list = gasDevices.list();
    for (var i = 0; i < list.length; i++) if (list[i].id === String(id)) return list[i];
    return null;
  },
  create: function (rec) {
    var sh = gasSyncSheet('Devices');
    sh.appendRow(SYNC.DEVICE_FIELDS.map(function (f) { return rec[f] === undefined || rec[f] === null ? '' : rec[f]; }));
    SpreadsheetApp.flush();
  },
  update: function (id, fields) {
    var d = gasDevices.get(id);
    if (!d) throw new Error('no device ' + id);
    var sh = gasSyncSheet('Devices');
    for (var f in fields) {
      var i = SYNC.DEVICE_FIELDS.indexOf(f);
      if (i < 0) continue;
      var v = fields[f];
      sh.getRange(d._row, i + 1).setValue(v === null || v === undefined ? '' : v);
    }
    SpreadsheetApp.flush();
  },
  counters: function () { return gasSyncCounters.counters(); },
  setCounters: function (c) { gasSyncCounters.setCounters(c); },
  nextSeq: function () { return gasSyncCounters.nextSeq(); },
  nextRev: function () { return gasSyncCounters.nextRev(); },
  nextLetter: function () { return syncNextLetter(gasDevices.list()); },
  /** PENDING row holding the code's hash; the plain code goes to the staff member in Telegram once. */
  mintCode: function (rec) { gasDevices.create(rec); },
  /** {match} or {fail, left}. A wrong code counts against every live code (it cannot be tied to one row). */
  verifyCode: function (codeHash, now) {
    var r = syncMatchEnrollCode(gasDevices.list(), codeHash, now);
    if (!r.match) (r.bump || []).forEach(function (id) {
      var d = gasDevices.get(id);
      if (d) gasDevices.update(id, { note: 'attempts=' + (syncAttemptsOf(d) + 1) });
    });
    return r;
  }
};

/* ------------------------------ Ledger writes, SyncLog, Quarantine, AiJobs ------------------------------ */

function gasSyncLedgerValues(tx) {
  var map = {
    TxID: tx.txId, GroupID: tx.groupId, Time: tx.time, Day: tx.day, Shop: tx.shop, ItemID: tx.itemId, Type: tx.type,
    Qty: tx.qty, UnitPrice: tx.unitPrice, Amount: tx.amount, Cash: tx.cash, CostAtSale: tx.costAtSale,
    CustomerID: tx.customerId, RefGroupID: tx.refGroupId, Note: tx.note, Source: tx.source,
    Transcript: tx.transcript, StaffID: tx.staffId, UpdateID: tx.updateId, ReversesTxID: tx.reversesTxId,
    Method: tx.method || '', Category: tx.category || '', Seq: tx.seq || '', ReceivedAt: tx.receivedAt || '',
    DeviceID: tx.deviceId || '', ReceiptNo: tx.receiptNo || '', DueDay: tx.dueDay || ''
  };
  return CFG.LEDGER_COLS.map(function (c) { return map[c] === undefined || map[c] === null ? '' : map[c]; });
}

var gasSyncTabs = {
  /** A whole group with one setValues: a timeout cannot split it. The grid is CFG.LEDGER_COLS wide first (gasLedgerWidth). */
  appendRows: function (rows) {
    if (!rows.length) return;
    var sh = gasSheet('Ledger');
    gasLedgerWidth(sh);
    var values = rows.map(gasSyncLedgerValues);
    var first = sh.getLastRow() + 1;
    gasEnsureRows(sh, first + values.length - 1);   // room first: appendRow fills the tab to its last grid row, and this is a block write
    sh.getRange(first, 1, values.length, CFG.LEDGER_COLS.length).setValues(values);
    SpreadsheetApp.flush();
    gasInvalidate();
  },
  /**
   * Seq, ReceivedAt, DeviceID written into existing rows. Only backfillSync() reaches this (through
   * syncStampMissingSeq): on the request path every row is stamped as it is appended, and the server
   * never edits a Ledger row.
   */
  stampSeq: function (list) {
    if (!list.length) return;
    var sh = gasSheet('Ledger'), rows = gasTable('Ledger'), byTx = {};
    rows.forEach(function (o) { byTx[String(o.TxID)] = o._row; });
    var col = CFG.LEDGER_COLS.indexOf('Seq') + 1;
    list.forEach(function (s) {
      var r = byTx[s.txId];
      if (!r) return;
      sh.getRange(r, col, 1, 3).setValues([[s.seq, s.receivedAt || '', s.deviceId || 'TG']]);
    });
    SpreadsheetApp.flush();
    gasInvalidate();
  },
  quarantine: function (q) {
    gasSyncSheet('Quarantine').appendRow([q.time, q.deviceId, q.groupId, q.reason, String(q.rowsJson || '').slice(0, 45000)]);
  },
  log: function (l) {
    gasSyncSheet('SyncLog').appendRow([l.time, l.deviceId, l.transport, l.rowsPushed, l.rowsPulled, l.durationMs, l.result, l.appVersion, l.note || '']);
  },
  /** aiJob(id) -> cached record or null; aiJob(id, rec) stores it (CacheService 6 h plus the AiJobs tab). */
  aiJob: function (id, rec) {
    var key = 'ai:' + id, cache = CacheService.getScriptCache();
    if (rec === undefined) {
      var hit = cache.get(key);
      if (hit) { try { return JSON.parse(hit); } catch (ignore) {} }
      var rows = gasSyncRows('AiJobs');
      for (var i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i].JobID) !== String(id) || String(rows[i].Status) !== 'done') continue;
        try { return JSON.parse(String(rows[i].ResultJSON || '{}')); } catch (ignore) { return null; }
      }
      return null;
    }
    var json = JSON.stringify(rec);
    if (rec.status === 'done') { try { cache.put(key, json.slice(0, 100000), SYNC.AI_CACHE_SEC); } catch (ignore) {} }
    gasSyncSheet('AiJobs').appendRow([rec.id, rec.deviceId, rec.kind, rec.status, json.slice(0, 2000), rec.error || '', rec.createdAt || '', rec.doneAt || '', rec.itemId || '']);
  }
};

/* ------------------------------ serverPorts ------------------------------ */

function gasSyncSha256(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var h = (b < 0 ? b + 256 : b).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}

/** gasStore plus what the sync core needs: whole Settings/Messages maps, client-supplied customer ids, customer edits. */
function gasSyncStore() {
  var store = {};
  for (var k in gasStore) store[k] = gasStore[k];
  store.allSettings = function () {
    var m = {};
    gasTable('Settings').forEach(function (r) { if (r.Key !== '') m[String(r.Key)] = r.Value instanceof Date ? r.Value.toISOString() : r.Value; });
    return m;
  };
  store.allMessages = function () {
    var m = {};
    gasTable('Messages').forEach(function (r) { if (r.Key !== '' && r.Text !== '') m[String(r.Key)] = String(r.Text); });
    return m;
  };
  /** Phones bring their own ids (C- plus 8 hex); the row is written as given, with Rev and UpdatedAt. */
  store.addCustomer = function (c) {
    if (!c.id) return gasStore.addCustomer(c);
    var sh = gasSheet('Customers');
    var map = { CustomerID: c.id, Name: c.name, Phone: c.phone || '', Note: c.note || '', CreatedAt: c.createdAt || new Date().toISOString(), Rev: c.rev || '', UpdatedAt: c.updatedAt || '' };
    sh.appendRow(CFG.CUSTOMER_COLS.map(function (col) { return map[col] === undefined ? '' : map[col]; }));
    SpreadsheetApp.flush();
    gasInvalidate();
    return { id: c.id, name: c.name, phone: c.phone || '', note: c.note || '', createdAt: map.CreatedAt, rev: c.rev || 0 };
  };
  store.updateCustomer = function (id, fields) {
    var rows = gasTable('Customers'), sh = gasSheet('Customers');
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].CustomerID) !== String(id)) continue;
      var colOf = { name: 'Name', phone: 'Phone', note: 'Note', rev: 'Rev', updatedAt: 'UpdatedAt' };
      for (var f in fields) {
        if (!colOf[f]) continue;
        sh.getRange(rows[i]._row, CFG.CUSTOMER_COLS.indexOf(colOf[f]) + 1).setValue(fields[f] === null || fields[f] === undefined ? '' : fields[f]);
      }
      SpreadsheetApp.flush();
      gasInvalidate();
      return;
    }
  };
  return store;
}

function gasSyncServerPorts() {
  return {
    store: gasSyncStore(),
    devices: gasDevices,
    sync: gasSyncTabs,
    cache: {
      get: function (k) { return CacheService.getScriptCache().get(k); },
      put: function (k, v, ttl) { CacheService.getScriptCache().put(k, v, Math.min(ttl || 600, 21600)); },
      remove: function (k) { CacheService.getScriptCache().remove(k); }
    },
    hash: gasSyncSha256,
    clock: { now: function () { return new Date(); } },
    uuid: function () { return Utilities.getUuid(); },
    // The re-entrant script lock of gas_main.js: a store method that locks itself (addListOption, addMeasurement,
    // addCustomer without an id) runs inside this batch lock without taking or releasing it again.
    lock: { run: function (fn) { return gasLocked(fn, 15000); } }
  };
}

/* ------------------------------ hooks: Gemini, Drive, PDF, Telegram ------------------------------ */

function gasSyncHooks() {
  return {
    /**
     * One job: the phone sends base64 media plus the context the core would have built. Round 6, revision 3: two kinds are
     * not AI and come first, before any Gemini call (core_sync.js runs them whatever the owner's AI switch says): `sketch`,
     * the PNG of a measurement session's drawing (the session found by the phone's entry id, else no_session, which the
     * phone tries again; saved as <MeasID>-figure.png and written into that session's PhotoURL), and `pic`, a new piece's
     * photo while AI is off (the item missing: no_item; saved as <itemId>.jpg and written into its photoUrl). A photo job's
     * AI name goes into the same updateItem as its Drive URL (aiRenameFields: a placeholder name only), so the item's Rev
     * moves once and the phone's own rename of the placeholder reaches the server as a dup, not a conflict.
     */
    ai: function (job, device) {
      var blob = null;
      if (job.data) {
        var mime = job.mime || (job.kind === 'sketch' ? 'image/png' : job.kind === 'photo' || job.kind === 'notebook' || job.kind === 'pic' ? 'image/jpeg' : 'audio/ogg');
        blob = Utilities.newBlob(Utilities.base64Decode(String(job.data)), mime, job.id);
      }
      if (job.kind === 'sketch') {
        var meas = gasStore.findMeasurementByEntry(job.entryId);
        if (!meas) throw new Error('no_session');
        if (!blob) throw new Error('sketch job without a picture');
        var figure = gasPhotoFolder().createFile(blob.setName(meas.id + '-figure.png')).getUrl();
        gasStore.setMeasurementPhoto(meas.id, figure);
        return { photoUrl: figure };
      }
      if (job.kind === 'pic') {
        if (!job.itemId || !gasStore.getItem(job.itemId)) throw new Error('no_item');
        if (!blob) throw new Error('pic job without a picture');
        var pic = gasPhotoFolder().createFile(blob.setName(job.itemId + '.jpg')).getUrl();
        gasStore.updateItem(job.itemId, { photoUrl: pic });
        return { photoUrl: pic };
      }
      var ctx = job.ctx || {};
      if (job.kind === 'voice') return { intent: gasAi.parseVoice(blob, ctx) };
      if (job.kind === 'text') return { intent: gasAi.parseText(String(job.text || ''), ctx) };
      if (job.kind === 'photo') {
        // Round 6b: the job's own list (a phone sends its item categories) or, without one, the piece's shop's offered list.
        var jobItem = job.itemId ? gasStore.getItem(job.itemId) : null;
        var desc = gasAi.describePhoto(blob, { categories: itemCategoryCats(ctx, { store: gasStore }, jobItem ? jobItem.shop : '').names });
        var url = '';
        if (job.itemId && blob) {
          try { url = gasPhotoFolder().createFile(blob.setName(job.itemId + '.jpg')).getUrl(); } catch (err) { gasStore.logError('photo_save', err, job.id, job.itemId); }
        }
        if (job.itemId) {
          // One write (one Rev bump): the Drive URL and, for a piece still named by its placeholder, the AI's name and category
          // (round 6b: decided against the job's own list, as the phone's replay decides, so the two agree).
          var cur = gasStore.getItem(job.itemId), f = url ? { photoUrl: url } : {}, any = !!url;
          var ren = cur ? aiRenameFields(cur, desc, itemCategoryCats(ctx, { store: gasStore }, cur.shop)) : null;
          if (ren) { f.name = ren.name; any = true; if (ren.category) f.category = ren.category; }
          if (cur && any) { try { gasStore.updateItem(job.itemId, f); } catch (ignore) {} }
        }
        return { desc: desc, photoUrl: url, thumb: '' };
      }
      if (job.kind === 'notebook') return { lines: gasAi.readNotebook(blob, ctx) };
      throw new Error('unknown ai job kind ' + job.kind);
    },
    /** Drive thumbnails as base64 so phones never fetch from googleusercontent image hosts. */
    photo: function (itemIds) {
      var out = {};
      itemIds.forEach(function (id) {
        out[id] = null;
        var item = gasStore.getItem(id);
        if (!item || !item.photoUrl) return;
        var m = /[-\w]{25,}/.exec(String(item.photoUrl));
        if (!m) return;
        try {
          var thumb = DriveApp.getFileById(m[0]).getThumbnail();
          if (thumb) out[id] = Utilities.base64Encode(thumb.getBytes());
        } catch (err) { gasStore.logError('photo_thumb', err, '', id); }
      });
      return out;
    },
    /** PDF to the staff member's Telegram chat, or inline base64 when small and asked for. */
    report: function (report, device, inline) {
      var blob = gasPdf.make(report);
      if (inline && blob.getBytes().length <= SYNC.INLINE_PDF_MAX) {
        return { sentTo: 'inline', pdf: Utilities.base64Encode(blob.getBytes()), fileName: blob.getName() };
      }
      var ports = buildPorts();
      var r = gasChat.sendDocument(device.staffId, blob, t(ports, 'rep_caption', { title: report.title }));
      return { sentTo: 'telegram', messageId: r.messageId };
    },
    relay: function (notice) { gasChat.sendMessage(notice.to, notice.text, notice.kb || []); },
    ping: function (ownerId, text, kb) { gasChat.sendMessage(ownerId, text, kb || []); }
  };
}

/* ------------------------------ Telegram side helpers ------------------------------ */

/**
 * For the 📲 button: a typed one-time code bound to the staff member. Returns {code, display, text, expiresAt}.
 * The code is typed into the app, never put in a link: Settings app_url, when set, only tells the
 * staff member where to install the app (a secret in a URL is against the project rules).
 */
function syncMintEnrollCode(staffId, shop, role, label) {
  var sp = gasSyncServerPorts();
  var minted = sp.lock.run(function () {
    return syncMintCode(sp, { id: String(staffId), shop: shop || 'S1', role: role || 'staff' }, label || '', new Date());
  });
  var ports = buildPorts();
  var text = t(ports, 'app_enroll_code', { code: minted.display });
  var appUrl = gasStore.getSetting('app_url', '');
  if (appUrl) text += '\n' + t(ports, 'app_enroll_link', { url: appUrl });
  minted.text = text;
  return minted;
}

/** ports.sync for core_bot (wired in buildPorts): the 📲 button, /devices and the DV| buttons. */
function gasSyncBotPort() {
  return {
    mintCode: function (staff, label) { return syncMintEnrollCode(staff.id, staff.shop, staff.role, label); },
    devicesText: function () { return gasSyncDevicesText(); },
    deviceAction: function (deviceId, action) { return gasSyncDeviceAction(deviceId, action); }
  };
}

/**
 * Transport B: the outbox exported by the app and shared to the bot as a .json document.
 * Same apply function as api=sync; the Telegram sender must own the device. Returns {ok, text, counts}.
 */
function gasSyncIngestDocument(blob, staff) {
  var text = blob && blob.getDataAsString ? blob.getDataAsString('UTF-8') : String(blob || '');
  return syncIngestDocument(gasSyncServerPorts(), text, staff, new Date(), gasSyncHooks());
}

/** doPost hook: true when the update was a staff member's .json outbox document and has been handled. */
function gasSyncTelegramDocument(update) {
  var msg = update && update.message, doc = msg && msg.document;
  if (!doc || !msg.from || !/\.json$/i.test(String(doc.file_name || ''))) return false;
  var staff = gasStore.getStaff(String(msg.from.id));
  if (!staff) return false;                                   // not staff: the Telegram branch answers as usual
  var id = String(update.update_id);
  var ports = buildPorts();
  if (ports.cache.get('upd:' + id) || (ports.dedupe && ports.dedupe.seen(id))) return true;   // re-delivery
  ports.cache.put('upd:' + id, '1', 21600);
  if (ports.dedupe) ports.dedupe.remember(id);
  var result;
  try {
    result = gasSyncIngestDocument(gasChat.getFile(doc.file_id), staff);
  } catch (err) {
    gasStore.logError('transport_b', err, id, doc.file_name);
    result = { ok: false, text: t(ports, 'ingest_bad_file') };
  }
  try { gasChat.sendMessage(msg.chat.id, result.text); } catch (err) { gasStore.logError('transport_b_reply', err, id, ''); }
  return true;
}

/** Lines for the 21:00 summary (the summary builder appends them). */
function gasSyncSummaryLines(now) { return syncSummaryLines(gasSyncServerPorts(), now || new Date()); }

/** /devices reply for the owner: {text, kb} with DV|<id>|drain (or activate) and DV|<id>|revoke buttons (core_sync.js). */
function gasSyncDevicesText() {
  return syncDevicesReply(gasSyncServerPorts(), buildPorts());
}

/** Apply a DV| button: action in {drain, revoke, activate}. Returns the refreshed /devices reply. */
function gasSyncDeviceAction(deviceId, action) {
  var sp = gasSyncServerPorts();
  syncDeviceAction(sp, deviceId, action, new Date());
  return syncDevicesReply(sp, buildPorts());
}

/* ------------------------------ one-time migration ------------------------------ */

/**
 * Run once from the editor after pasting this version: Seq = row-1 on every Ledger row that has none
 * (ReceivedAt = Time, DeviceID = TG), Rev = 1 and UpdatedAt on masters that have none, ReceiptNo on old
 * SALE groups from receiptNumber()'s derivation, and the two counters set past the maxima. Safe to re-run.
 */
function backfillSync() {
  var sp = gasSyncServerPorts();
  sp.lock.run(function () {
    var ledger = gasSheet('Ledger');
    var rows = gasTable('Ledger');
    var seqCol = CFG.LEDGER_COLS.indexOf('Seq') + 1, rcpCol = CFG.LEDGER_COLS.indexOf('ReceiptNo') + 1;
    var maxSeq = 0, stamped = 0;
    rows.forEach(function (o) { if (Number(o.Seq) > maxSeq) maxSeq = Number(o.Seq); });
    if (maxSeq === 0) {
      // First migration: no row has a Seq yet, so row order is the only order there is: Seq = row - 1.
      rows.forEach(function (o) {
        var seq = o._row - 1;
        ledger.getRange(o._row, seqCol, 1, 3).setValues([[seq, o.ReceivedAt || gasIso(o.Time), o.DeviceID || 'TG']]);
        if (seq > maxSeq) maxSeq = seq;
        stamped++;
      });
      var c = gasSyncCounters.counters();
      if (c.seq < maxSeq) gasSyncCounters.setCounters({ seq: maxSeq });
      SpreadsheetApp.flush();
      gasInvalidate();
    } else {
      // Later re-runs: rows that arrived without a Seq (a hand-inserted row) take the counter, never row - 1,
      // so a number already given to another row is never reused.
      stamped = syncStampMissingSeq(sp, new Date(), 'TG');
    }

    // ReceiptNo for old SALE groups: the derivation keeps the numbers customers were given.
    var ports = buildPorts(), seen = {}, receipts = 0;
    gasTable('Ledger').forEach(function (o) {
      if (String(o.Type) !== CFG.TX.SALE || o.ReversesTxID || o.ReceiptNo || seen[String(o.GroupID)]) return;
      seen[String(o.GroupID)] = true;
      var no = receiptNumber(ports, String(o.GroupID));
      if (!no || /^R\?/.test(no)) return;
      ledger.getRange(o._row, rcpCol).setValue(no);
      receipts++;
    });
    SpreadsheetApp.flush();
    gasInvalidate();

    var revs = 0, now = new Date().toISOString();
    [['Items', CFG.ITEM_COLS], ['Customers', CFG.CUSTOMER_COLS]].forEach(function (pair) {
      var sh = gasSheet(pair[0]), revCol = pair[1].indexOf('Rev') + 1, updCol = pair[1].indexOf('UpdatedAt') + 1;
      gasTable(pair[0]).forEach(function (o) {
        if (Number(o.Rev) > 0) return;
        sh.getRange(o._row, revCol).setValue(1);
        if (updCol > 0) sh.getRange(o._row, updCol).setValue(o.UpdatedAt || now);
        revs++;
      });
    });
    if (gasSyncCounters.counters().rev < 1) gasSyncCounters.setCounters({ rev: 1 });
    SpreadsheetApp.flush();
    gasInvalidate();
    Object.keys(GAS_SYNC_TABS).forEach(function (name) { gasSyncSheet(name); });
    Logger.log('backfillSync: Seq stamped on ' + stamped + ' rows (LEDGER_SEQ=' + gasSyncCounters.counters().seq + '), ReceiptNo on ' + receipts +
               ' sale groups, Rev on ' + revs + ' master rows (MASTER_REV=' + gasSyncCounters.counters().rev + '). Sync tabs present.');
  });
}

/** Editor check: prints the device list and today's summary sync line. */
function previewSyncStatus() {
  var sp = gasSyncServerPorts();
  Logger.log(JSON.stringify(sp.devices.list().map(function (d) { return syncSanitizeDevice(sp, d); }), null, 2));
  Logger.log(gasSyncSummaryLines().join('\n') || '(no devices enrolled)');
}
