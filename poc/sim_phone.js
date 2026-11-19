/**
 * poc/sim_phone.js — a reference phone in memory (the LOCAL STORE CONTRACT of sync-and-server.md).
 *
 * createPhone(opts) returns a device whose ports run the unchanged core (processUpdate from core_bot.js)
 * against local arrays: items, customers, ledger (rows carry synced/seq), outbox, cache, chat, plus an
 * incremental stock map so a year of rows stays instant. The chat renders to a local message list exactly
 * like sim_ports; a message to any other chat id (notifyOwners) becomes an outbox notice. The ai port queues
 * a job and throws a PendingAi error, which the core treats as its ai_down fallback (the phone then shows
 * ⏳ instead). pdf is a queued job that still returns the on-screen table. The clock is the phone's own wall
 * clock (opts.clockErrorMs makes it wrong) corrected by the offset learned from every server reply.
 *
 * Sync client: enroll(code), bootstrap() (followed by one syncNow), syncNow(transport) (push the outbox, apply
 * results, pull the delta with paging, learn the clock offset, repair days whose checksums differ), applyAiResults(),
 * exportOutbox() for Transport B, wipe() on `revoked`. The same sim helpers as sim_ports (start, text,
 * voice, photo, tap, tapLast, tapAny, lastBot, lastBotWith, button, replay) so tests read like run_scenario.js.
 *
 * Round 4 (SPEC-round-4.md sections 8 and 9.1); app/app_store.js implements exactly the same contract:
 *  - option lists: the store has NO listOptions, so the core reads its lists from Settings lists_json.
 *    store.addListOption(rec, seedRows) applies the add to the local lists_json at once (listsJsonUpsert) and queues
 *    {kind: 'list', rec} only when that changed something; local.setSettings(map) (a pull or bootstrap) re-applies
 *    every list entry still in the outbox, so an option added offline never disappears before the server has it.
 *  - measurement book: one record per customer, the newest session {customerId, id, n, day, notes, fields, pending}.
 *    local.upsertMeasurement (a pull), local.saveMeasurementLocal (the form), local.measurementSynced and
 *    local.measurementRejected (push results), store.listMeasurements(customerId) ([record] or [], which feeds
 *    core_orders.js latestMeasurement). The cursor starts with measAfter: 0, so pulls page the sessions in.
 *
 * Round 6 (docs/design-round-6/SPEC-round-6.md 3.5, 6.2, 13.7.2, 13.12); app/app_store.js and app/app_sync.js follow:
 *  - one receipt number per basket: appendLedger gives a SALE row the number of the earlier SALE row of its group;
 *  - applyAiResults renames a placeholder-named piece through aiRenameFields (the server's rule), and holds a photo job
 *    while an item entry of that piece still waits in the outbox (M1), so the job meets the item on the server;
 *  - with AI off (the phone's switch or the server's ai_off answer) a new piece's photo job goes up as a pic job and any
 *    other AI job is skipped, as app_sync.js aiOffJob; a done photo or pic answer's itemRev is taken when the phone's Rev
 *    is its itemRevWas and no item entry of that piece waits (review r6: no false conflict on a later undo);
 *  - local.setSettingLocal(key, value) changes the local Settings at once and queues {kind: 'setting', key, value};
 *    local.setSettings re-applies the waiting setting entries over a pulled map, as it re-applies list entries;
 *  - a measurement record keeps its drawing (sketch, only when there is one), from the form and from a pull.
 *
 * opts: {name, world (its clock is the base time), server (default transport) | transport(api, body), clockErrorMs}
 */
function pendingAiError(job) {
  var e = new Error('PendingAi: job ' + job.id + ' queued until the phone is online');
  e.name = 'PendingAi';
  e.pending = true;
  e.job = job;
  return e;
}

function createPhone(opts) {
  opts = opts || {};
  var baseClock = opts.clock || (opts.world ? opts.world.ports.clock.now : function () { return new Date(); });
  var phone = {
    name: opts.name || 'phone', online: true, clockErrorMs: opts.clockErrorMs || 0,
    items: [], customers: [], ledger: [], outbox: [], chat: [], errors: [], aiQueue: [], pdfJobs: [], files: {},
    settings: {}, messages: {}, stock: {}, cacheData: {}, log: [], syncLog: [],
    measurements: {},          // customerId -> the newest session {customerId, id, n, day, notes, fields, pending}
    meta: null, nextMsgId: 1, nextUpdateId: 1, nextFileId: 1, pendingBatch: null, lastSync: null, clockWarnedMs: null,
    transport: opts.transport || (opts.server ? opts.server.transport : null)
  };
  function freshMeta() {
    // measAfter: 0 because this store keeps measurement sessions (upsertMeasurement): every pull asks for the sessions
    // after the highest number it holds. A store without upsertMeasurement leaves measAfter out and gets none.
    return { deviceId: null, token: null, staff: null, owners: [], scope: [], receiptLetter: '', receiptCounter: 0, offsetMs: 0,
             cursor: { ledgerSeq: 0, masterRev: 0, settingsHash: '', messagesHash: '', measAfter: 0 }, lastFullMastersDay: '', appVersion: SYNC.VERSION,
             label: phone.name };
  }
  phone.meta = freshMeta();
  function copy(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
  function copyMeas(m) { var c = copy(m); c.fields = copy(m.fields || {}); return c; }
  /** Measurement entries of one customer still waiting in the outbox. */
  function measEntriesOf(customerId) {
    var n = 0;
    phone.outbox.forEach(function (e) { if (e.kind === 'measurement' && e.rec && String(e.rec.customerId) === String(customerId)) n++; });
    return n;
  }
  /** The phone's own clock, possibly wrong. Sent as clientTime so the server can measure the skew. */
  function wallClock() { return new Date(baseClock().getTime() + phone.clockErrorMs); }
  /** What the core sees: wall clock plus the offset learned from the server, so Day is right even offline. */
  function now() { return new Date(wallClock().getTime() + phone.meta.offsetMs); }
  function staffId() { return phone.meta.staff ? String(phone.meta.staff.id) : null; }

  /* ---------- store ---------- */
  function rawItem(id) {
    for (var i = 0; i < phone.items.length; i++) if (phone.items[i].id === String(id)) return phone.items[i];
    return null;
  }
  function viewItem(raw) {
    var stock = phone.stock[raw.id] || 0;
    var status = !raw.name ? CFG.STATUS.BLANK : (raw.type === CFG.ITEM_TYPE.UNIQUE && stock <= 0 ? CFG.STATUS.SOLD : CFG.STATUS.ACTIVE);
    var v = copy(raw);
    v.stock = stock;
    v.status = status;
    v.sample = !!raw.sample;
    v.alias = raw.alias || '';
    v.rev = raw.rev || 0;
    return v;
  }
  function addStock(row, sign) {
    if (!row.itemId) return;
    phone.stock[row.itemId] = (phone.stock[row.itemId] || 0) + sign * (Number(row.qty) || 0);
  }
  function rebuildStock() {
    phone.stock = {};
    phone.ledger.forEach(function (r) { addStock(r, 1); });
  }
  function stripLocal(row) { var c = copy(row); delete c.synced; return c; }
  function firstUnsyncedIndex() {
    for (var i = 0; i < phone.ledger.length; i++) if (!phone.ledger[i].synced) return i;
    return phone.ledger.length;
  }
  function findRow(txId) {
    for (var i = 0; i < phone.ledger.length; i++) if (phone.ledger[i].txId === txId) return i;
    return -1;
  }
  var collector = null;
  function pushOutbox(entry) {
    entry.entryId = entry.entryId || simUuid();
    entry.at = now().toISOString();
    phone.outbox.push(entry);
    return entry;
  }

  var store = {
    getItem: function (id) { var r = rawItem(id); return r ? viewItem(r) : null; },
    listItems: function (shop) { return phone.items.filter(function (r) { return !shop || r.shop === shop; }).map(viewItem); },
    updateItem: function (id, fields) {
      var r = rawItem(id);
      if (!r) throw new Error('updateItem: no item ' + id);
      var baseRev = r.rev || 0, f = {};
      for (var k in fields) { r[k] = fields[k]; f[k] = fields[k]; }
      pushOutbox({ kind: 'item', id: r.id, fields: f, baseRev: baseRev });
    },
    appendLedger: function (tx) {
      // Per-device receipt number on the SALE row (R1-A-000231), gap-free per phone, never renumbered. Round 6 (spec 3.5):
      // ONE number per basket: the rows of one writeGroup are appended one after the other, so walking back from the end
      // while the group is the same finds the group's earlier SALE row (not a mirror) and its number is copied.
      if (tx.type === CFG.TX.SALE && !tx.reversesTxId && !tx.receiptNo && phone.meta.receiptLetter) {
        var shared = '';
        for (var g = phone.ledger.length - 1; g >= 0 && phone.ledger[g].groupId === tx.groupId; g--) {
          var prev = phone.ledger[g];
          if (prev.type === CFG.TX.SALE && !prev.reversesTxId && prev.receiptNo) { shared = prev.receiptNo; break; }
        }
        if (shared) tx.receiptNo = shared;
        else {
          phone.meta.receiptCounter++;
          tx.receiptNo = syncReceiptNo(tx.shop, phone.meta.receiptLetter, phone.meta.receiptCounter);
        }
      }
      var row = copy(tx);
      row.synced = false;
      row.seq = row.seq || '';
      phone.ledger.push(row);
      addStock(row, 1);
      if (collector) collector.push(row);
      else pushOutbox({ kind: 'group', groupId: row.groupId, txs: [stripLocal(row)] });
    },
    ledgerRows: function () { return phone.ledger; },
    getStaff: function (uid) {
      if (phone.meta.staff && String(uid) === staffId()) return copy(phone.meta.staff);
      for (var i = 0; i < phone.meta.owners.length; i++) if (String(phone.meta.owners[i].id) === String(uid)) return copy(phone.meta.owners[i]);
      return null;
    },
    listStaff: function () {
      var out = phone.meta.staff ? [copy(phone.meta.staff)] : [];
      phone.meta.owners.forEach(function (o) { if (String(o.id) !== staffId()) out.push(copy(o)); });
      return out;
    },
    getCustomer: function (id) {
      for (var i = 0; i < phone.customers.length; i++) if (phone.customers[i].id === String(id)) return phone.customers[i];
      return null;
    },
    listCustomers: function () { return phone.customers.slice(); },
    addCustomer: function (c) {
      var id = 'C-' + simUuid().replace(/-/g, '').slice(0, 8);
      var rec = { id: id, name: String(c.name || '').trim() || id, phone: c.phone || '', note: c.note || '', createdAt: now().toISOString(), rev: 0, updatedAt: '' };
      phone.customers.push(rec);
      pushOutbox({ kind: 'customer', rec: copy(rec) });
      return rec;
    },
    getSetting: function (k, d) { return Object.prototype.hasOwnProperty.call(phone.settings, k) ? phone.settings[k] : d; },
    getMessage: function (k) { return phone.messages[k] || null; },
    /**
     * ➕ an option, or set an account number, offline (core_ledger.js addListOptionByLabel and setListDetail call this
     * with rec = {list, key, label?, detail?, detailWas?, shop?, note?} and seedRows = the rows the phone shows now).
     * The same upsert rule as the server (listUpsert, through listsJsonUpsert) runs on the local Settings lists_json,
     * so the option is a button at once; the new value is kept (persisted, in the app) and the rec, without the seed,
     * is queued as {kind: 'list', rec} only when the status is 'ok' (a 'dup' changed nothing, the server has nothing
     * to learn). Returns {status, key} like the server's store.
     */
    addListOption: function (rec, seedRows) {
      var r = listsJsonUpsert(phone.settings.lists_json || '', rec.list, seedRows, rec);
      if (r.raw && r.raw !== phone.settings.lists_json) phone.settings.lists_json = r.raw;
      if (r.status === 'ok') pushOutbox({ kind: 'list', rec: copy(rec) });
      return { status: r.status, key: r.key };
    },
    /** The customer's newest measurement session as a list: [record] or []. core_orders.js latestMeasurement reads it. */
    listMeasurements: function (customerId) {
      var m = phone.measurements[String(customerId)];
      return m ? [copyMeas(m)] : [];
    },
    logError: function (where, err, updateId, payload) {
      var message = err && err.message ? err.message : String(err);
      phone.errors.push({ time: now().toISOString(), where: where, message: message, updateId: updateId || '', payload: payload || '' });
      if (err && err.pending) return;                       // a queued AI job is not an error for the server
      pushOutbox({ kind: 'error', where: where, message: message, updateId: String(updateId || ''), payload: String(payload || '').slice(0, 500) });
    },
    logUnknownUser: function () {}
    // refreshViews: intentionally absent; the server refreshes Credits/Deposits once per batch
    // listOptions: intentionally absent; the phone's lists come from Settings lists_json (core_ledger.js listRows)
  };

  /* ---------- the LOCAL STORE CONTRACT extras used by the sync client (core_sync helpers) ---------- */
  var local = {
    removeEntry: function (entryId) {
      for (var i = 0; i < phone.outbox.length; i++) if (phone.outbox[i].entryId === entryId) { phone.outbox.splice(i, 1); return; }
    },
    markSynced: function (txId, seq, receivedAt, deviceId) {
      var i = findRow(txId);
      if (i < 0) return;
      var row = phone.ledger[i], wasSynced = row.synced;
      row.synced = true;
      if (seq !== null && seq !== undefined && seq !== '') row.seq = seq;
      if (receivedAt && !row.receivedAt) row.receivedAt = receivedAt;
      if (deviceId && !row.deviceId) row.deviceId = deviceId;
      if (!wasSynced) {                                      // move into the synced block, keeping seq order there
        phone.ledger.splice(i, 1);
        phone.ledger.splice(firstUnsyncedIndex(), 0, row);
      }
    },
    removeRows: function (txIds) {
      txIds.forEach(function (txId) {
        var i = findRow(txId);
        if (i < 0) return;
        addStock(phone.ledger[i], -1);
        phone.ledger.splice(i, 1);
      });
    },
    setItemRev: function (id, rev) { var r = rawItem(id); if (r) r.rev = rev; },
    setCustomerRev: function (id, rev) { var c = store.getCustomer(id); if (c) c.rev = rev; },
    upsertItem: function (rec) {
      var r = rawItem(rec.id);
      if (!r) { phone.items.push(copy(rec)); return; }
      for (var k in rec) r[k] = rec[k];
    },
    upsertCustomer: function (rec) {
      var c = store.getCustomer(rec.id);
      if (!c) { phone.customers.push(copy(rec)); return; }
      for (var k in rec) c[k] = rec[k];
    },
    hasRow: function (txId) { return findRow(txId) >= 0; },
    appendSynced: function (row) {
      var r = copy(row);
      r.synced = true;
      phone.ledger.splice(firstUnsyncedIndex(), 0, r);
      addStock(r, 1);
    },
    /**
     * A pull or bootstrap replaces the Settings map. Then every list entry still in the outbox is applied again, in
     * outbox order, to the lists_json of the map just stored, seeded the way the server seeds a list that has no rows
     * yet (legacyListRows over this store, so it reads the new map): an option added offline stays a button next to
     * all the old ones until the server has it, even when this pull came before the push (a lost reply resent).
     */
    setSettings: function (map) {
      phone.settings = copy(map);
      phone.outbox.forEach(function (e) {
        if (e.kind !== 'list' || !e.rec) return;
        var r = listsJsonUpsert(phone.settings.lists_json || '', e.rec.list, legacyListRows({ store: store }, e.rec.list), e.rec);
        if (r.raw) phone.settings.lists_json = r.raw;
      });
      // Round 6: a setting changed here and not pushed yet (the owner's Shops or AI switch) stays over the pulled value.
      phone.outbox.forEach(function (e) { if (e.kind === 'setting' && typeof e.key === 'string') phone.settings[e.key] = e.value; });
    },
    /**
     * The owner's Shops screen or AI switch (round 6, revision 3): the local Settings change at once (the phone shows the new
     * name or hides 🎤 before any sync) and {kind: 'setting', key, value} is queued; the server whitelists the key and
     * takes it from the owner's phone only (core_sync.js syncSettingReason). Returns the outbox entry.
     */
    setSettingLocal: function (key, value) {
      var k = String(key), v = String(value === null || value === undefined ? '' : value);
      phone.settings[k] = v;
      return pushOutbox({ kind: 'setting', key: k, value: v });
    },
    setMessages: function (map) { phone.messages = copy(map); },
    /**
     * A session from a pull, {id, n, customerId, orderId, day, notes, fields}: a pending local record (saved here, not
     * yet acknowledged) is kept over it; otherwise the session with the higher n is the customer's record.
     */
    upsertMeasurement: function (rec) {
      var cid = String(rec.customerId || ''), cur = phone.measurements[cid], n = Number(rec.n) || syncMeasNo(rec.id);
      if (!cid || (cur && (cur.pending || (Number(cur.n) || 0) >= n))) return;
      phone.measurements[cid] = { customerId: cid, id: String(rec.id || ''), n: n, day: String(rec.day || ''), notes: String(rec.notes || ''),
                                  fields: copy(rec.fields || {}), pending: false };
      if (rec.sketch) phone.measurements[cid].sketch = String(rec.sketch);   // the drawing (round 6), only when there is one
    },
    /**
     * The measurement form saved a session: it is the customer's newest record at once, pending until the server
     * answers, and {kind: 'measurement', rec} is queued with rec = {customerId, orderId, day, staffId, source, notes,
     * fields} (orderId '' when none; day, staffId and source FORM filled in when the caller left them out).
     * Returns a copy of the local record.
     */
    saveMeasurementLocal: function (rec) {
      var r = {
        customerId: String(rec.customerId), orderId: rec.orderId ? String(rec.orderId) : '', day: rec.day || dayKey(now()),
        staffId: rec.staffId !== undefined && rec.staffId !== null && rec.staffId !== '' ? String(rec.staffId) : staffId(),
        source: rec.source || CFG.MEAS_SOURCE.FORM, notes: rec.notes ? String(rec.notes) : '', fields: copy(rec.fields || {})
      };
      // The drawing (round 6, revision 3) goes into the record and the entry only when there is one, so an entry without
      // a drawing keeps today's exact shape.
      if (rec.sketch) r.sketch = String(rec.sketch);
      phone.measurements[r.customerId] = { customerId: r.customerId, id: '', n: 0, day: r.day, notes: r.notes, fields: copy(r.fields), pending: true };
      if (r.sketch) phone.measurements[r.customerId].sketch = r.sketch;
      var entry = pushOutbox({ kind: 'measurement', rec: r });
      var out = copyMeas(phone.measurements[r.customerId]);
      out.entryId = entry.entryId;   // the outbox entry it queued (a drawing's picture job waits for it)
      return out;
    },
    /**
     * The server stored (ok) or already had (dup) a session of this customer under `id`. Only when no other
     * measurement entry of that customer is left in the outbox (a later save is still on its way) the record takes
     * that id and number and stops being pending.
     */
    measurementSynced: function (customerId, id) {
      var cid = String(customerId), cur = phone.measurements[cid];
      if (!cur || measEntriesOf(cid) > 0) return;
      cur.id = String(id || '');
      cur.n = syncMeasNo(id);
      cur.pending = false;
    },
    /**
     * The server refused a session of this customer (quarantined). Only when no other measurement entry of that
     * customer is left in the outbox: the record (the session the server never took) is deleted and cursor.measAfter
     * goes back to 0, so the next pulls bring the server's sessions again, the customer's earlier one included.
     */
    measurementRejected: function (customerId) {
      var cid = String(customerId);
      if (measEntriesOf(cid) > 0) return;
      delete phone.measurements[cid];
      phone.meta.cursor.measAfter = 0;
    },
    getCursor: function () { return phone.meta.cursor; },
    setCursor: function (c) { phone.meta.cursor = c; },
    syncedRows: function () { return phone.ledger.filter(function (r) { return r.synced; }); },
    /** A day re-pulled after a checksum mismatch: the server's rows replace the local synced copy; unsynced rows stay. */
    replaceDay: function (day, rows) {
      phone.ledger = phone.ledger.filter(function (r) { return !(r.synced && r.day === day); });
      var at = firstUnsyncedIndex();
      rows.forEach(function (row) { var r = copy(row); r.synced = true; phone.ledger.splice(at++, 0, r); });
      rebuildStock();
    }
  };
  phone.local = local;

  /* ---------- chat ---------- */
  function pushMsg(m) {
    m.id = phone.nextMsgId++;
    m.chatId = staffId();
    m.ts = now().toISOString();
    phone.chat.push(m);
    return m;
  }
  function botSay(text, kb) { return pushMsg({ from: 'bot', text: text, keyboard: kb || [], system: true }); }
  var chat = {
    sendMessage: function (chatId, text, keyboard) {
      if (staffId() && String(chatId) !== staffId()) {
        pushOutbox({ kind: 'notice', to: String(chatId), text: text, kb: keyboard || [] });
        return { messageId: 0 };
      }
      return { messageId: pushMsg({ from: 'bot', text: text, keyboard: keyboard || [] }).id };
    },
    sendPhoto: function (chatId, photo, caption, keyboard) {
      if (staffId() && String(chatId) !== staffId()) { pushOutbox({ kind: 'notice', to: String(chatId), text: caption, kb: keyboard || [] }); return { messageId: 0 }; }
      return { messageId: pushMsg({ from: 'bot', text: caption, photo: photo, keyboard: keyboard || [] }).id };
    },
    sendDocument: function (chatId, doc, caption) {
      return { messageId: pushMsg({ from: 'bot', text: caption || '', document: doc, keyboard: [] }).id };
    },
    editMessage: function (chatId, messageId, text, keyboard) {
      for (var i = 0; i < phone.chat.length; i++) {
        if (phone.chat[i].id === messageId) {
          phone.chat[i].text = text;
          phone.chat[i].keyboard = keyboard || [];
          phone.chat[i].edited = true;
          return;
        }
      }
    },
    answerCallback: function (id) { phone.lastCallbackAnswered = id; },
    typing: function () {},
    getFile: function (fileId) { return phone.files[fileId] || {}; },
    savePhoto: function (fileId, name) { return 'local://' + name; }
  };

  /* ---------- ai: a queue; the core sees its ai_down fallback, the phone shows ⏳ ---------- */
  function queueAi(kind, file, ctx, extra) {
    var state = null;
    try { var sj = phone.ports.cache.get('st:' + staffId()); state = sj ? JSON.parse(sj) : null; } catch (ignore) {}
    var job = { id: 'j-' + simUuid().replace(/-/g, '').slice(0, 10), kind: kind, sim: file || null, data: file && file.text !== undefined ? file.text : (extra && extra.text) || '',
                mime: file && file.mimeType ? file.mimeType : '', ctx: ctx || {}, createdAt: now().toISOString(), status: 'queued',
                itemId: (extra && extra.itemId) || (state && state.kind === 'new_item' ? state.itemId : ''), text: (extra && extra.text) || '' };
    phone.aiQueue.push(job);
    phone.pendingAi = job;
    return job;
  }
  var ai = {
    parseVoice: function (file, ctx) { throw pendingAiError(queueAi('voice', file, ctx)); },
    parseText: function (text, ctx) { throw pendingAiError(queueAi('text', null, ctx, { text: text })); },
    describePhoto: function (file, ctx) { throw pendingAiError(queueAi('photo', file, ctx)); },
    readNotebook: function (file, ctx) { throw pendingAiError(queueAi('notebook', file, ctx)); }
  };
  var pdf = {
    make: function (report) {
      var doc = { name: report.fileName + '.pdf', report: report };
      phone.pdfJobs.push({ kind: report.kind, fileName: report.fileName, queuedAt: now().toISOString() });
      return doc;
    }
  };
  var cache = {
    get: function (k) {
      var e = phone.cacheData[k];
      if (!e) return null;
      if (e.exp < now().getTime()) { delete phone.cacheData[k]; return null; }
      return e.v;
    },
    put: function (k, v, ttl) { phone.cacheData[k] = { v: v, exp: now().getTime() + (ttl || 600) * 1000 }; },
    remove: function (k) { delete phone.cacheData[k]; }
  };
  var processed = [];
  phone.ports = {
    store: store, chat: chat, cache: cache, ai: ai, pdf: pdf,
    lock: {
      /** Rows appended inside one run() form one outbox group (writeGroup calls appendLedger per row). */
      run: function (fn) {
        var outer = collector;
        collector = [];
        try { return fn(); } finally {
          var rows = collector;
          collector = outer;
          if (rows.length) pushOutbox({ kind: 'group', groupId: rows[0].groupId, txs: rows.map(stripLocal) });
        }
      }
    },
    clock: { now: now },
    uuid: simUuid,
    dedupe: {
      seen: function (id) { return processed.indexOf(String(id)) >= 0; },
      remember: function (id) { processed.push(String(id)); if (processed.length > 400) processed.shift(); }
    }
  };
  phone.now = now;
  phone.wallClock = wallClock;

  /* ---------- sim helpers (same shapes as sim_ports; the phone has one chat, its own staff member) ---------- */
  function from(user) { return { id: user.id, first_name: user.name, is_bot: false }; }
  function unix() { return Math.floor(now().getTime() / 1000); }
  function deliver(update) {
    phone.pendingAi = null;
    var before = phone.nextMsgId;
    var res = processUpdate(update, phone.ports);
    if (phone.pendingAi) {
      // The core answered with its ai_down fallback; on a phone that means "queued", so say ⏳ instead.
      var waiting = t(phone.ports, 'app_wait_server'), replaced = false;
      for (var i = phone.chat.length - 1; i >= 0; i--) {
        var m = phone.chat[i];
        if (m.id < before) break;
        if (m.from === 'bot' && m.text && m.text.indexOf(t(phone.ports, 'ai_down')) >= 0) { m.text = waiting; m.pending = true; replaced = true; break; }
      }
      if (!replaced) {
        // No ai_down line to replace (photo of a new item keeps going with a placeholder): slip the ⏳ in
        // before this update's replies so the last card and its buttons stay on top.
        var idx = -1;
        for (var k = 0; k < phone.chat.length; k++) if (phone.chat[k].id >= before && phone.chat[k].from === 'bot') { idx = k; break; }
        var wm = { from: 'bot', text: waiting, keyboard: [], system: true, pending: true, id: phone.nextMsgId++, chatId: staffId(), ts: now().toISOString() };
        if (idx < 0) phone.chat.push(wm); else phone.chat.splice(idx, 0, wm);
      }
    }
    phone.log.push({ update: update, result: res });
    return res;
  }
  function userMsg(user, fields) {
    var m = { from: 'user', user: user.name };
    for (var k in fields) m[k] = fields[k];
    return pushMsg(m);
  }
  phone.sim = {
    start: function (user, payload) {
      var text = '/start' + (payload ? ' ' + payload : '');
      var m = userMsg(user, { text: text, scan: payload || null });
      return deliver({ update_id: phone.nextUpdateId++, message: { message_id: m.id, from: from(user), chat: { id: user.id, type: 'private' }, date: unix(), text: text } });
    },
    text: function (user, text) {
      var m = userMsg(user, { text: text });
      return deliver({ update_id: phone.nextUpdateId++, message: { message_id: m.id, from: from(user), chat: { id: user.id, type: 'private' }, date: unix(), text: text } });
    },
    voice: function (user, spoken) {
      var fid = 'voice_' + phone.nextFileId++;
      phone.files[fid] = { text: spoken, mimeType: 'audio/ogg' };
      var m = userMsg(user, { voice: spoken });
      return deliver({ update_id: phone.nextUpdateId++, message: { message_id: m.id, from: from(user), chat: { id: user.id, type: 'private' }, date: unix(), voice: { file_id: fid, duration: 3, mime_type: 'audio/ogg' } } });
    },
    photo: function (user, preset, caption) {
      var fid = 'photo_' + phone.nextFileId++;
      phone.files[fid] = { meta: preset, visual: preset.visual, mimeType: 'image/jpeg' };
      var m = userMsg(user, { photo: fid, text: caption || '' });
      var msg = { message_id: m.id, from: from(user), chat: { id: user.id, type: 'private' }, date: unix(), photo: [{ file_id: fid, width: 320, height: 320 }, { file_id: fid, width: 1280, height: 1280 }] };
      if (caption) msg.caption = caption;
      return deliver({ update_id: phone.nextUpdateId++, message: msg });
    },
    tap: function (user, messageId, data) {
      var target = null;
      for (var i = 0; i < phone.chat.length; i++) if (phone.chat[i].id === messageId) target = phone.chat[i];
      if (!target) throw new Error('tap: no message ' + messageId);
      var message = { message_id: messageId, chat: { id: user.id, type: 'private' }, date: unix(), text: target.text };
      if (target.photo) message.photo = [{ file_id: target.photo }];
      return deliver({ update_id: phone.nextUpdateId++, callback_query: { id: 'cq' + phone.nextUpdateId, from: from(user), message: message, data: data } });
    },
    replay: function (update) { return deliver(update); },
    lastBot: function () {
      for (var i = phone.chat.length - 1; i >= 0; i--) if (phone.chat[i].from === 'bot') return phone.chat[i];
      return null;
    },
    lastBotWith: function (user, label) {
      for (var i = phone.chat.length - 1; i >= 0; i--) {
        var m = phone.chat[i];
        if (m.from !== 'bot') continue;
        if ((m.text || '').indexOf(label) >= 0 || phone.sim.button(m, label)) return m;
      }
      return null;
    },
    button: function (message, label) {
      var rows = (message && message.keyboard) || [];
      for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c].text.indexOf(label) >= 0) return rows[r][c].callback_data;
      }
      return null;
    },
    tapLast: function (user, label) {
      var m = phone.sim.lastBot(user), data = phone.sim.button(m, label);
      if (!data) throw new Error(phone.name + ': no button "' + label + '" on: ' + (m && m.text));
      return phone.sim.tap(user, m.id, data);
    },
    tapAny: function (user, label) {
      var m = phone.sim.lastBotWith(user, label), data = m && phone.sim.button(m, label);
      if (!data) throw new Error(phone.name + ': no recent button "' + label + '"');
      return phone.sim.tap(user, m.id, data);
    }
  };
  phone.lastText = function () { var m = phone.sim.lastBot(); return (m && m.text) || ''; };
  phone.chatHas = function (text) {
    for (var i = phone.chat.length - 1; i >= 0; i--) if (phone.chat[i].from === 'bot' && (phone.chat[i].text || '').indexOf(text) >= 0) return true;
    return false;
  };

  /* ---------- sync client ---------- */
  function outboxRows() {
    var n = 0;
    phone.outbox.forEach(function (e) { n += e.kind === 'group' ? e.txs.length : 0; });
    return n;
  }
  function authBody(extra) {
    var b = { device: phone.meta.deviceId, token: phone.meta.token, appVersion: phone.meta.appVersion, clientTime: wallClock().toISOString() };
    for (var k in extra) b[k] = extra[k];
    return b;
  }
  /** One request. Network trouble (offline, thrown transport, lost reply) comes back as {transportFailure:true}. */
  function call(transport, api, body) {
    transport = transport || phone.transport;
    if (!transport) throw new Error(phone.name + ' has no transport');
    if (!phone.online) return { ok: false, error: 'offline', transportFailure: true };
    var res;
    try { res = transport(api, body); } catch (err) { return { ok: false, error: 'network', message: err.message, transportFailure: true }; }
    if (!res) return { ok: false, error: 'lost', transportFailure: true };
    return res;
  }
  function learnOffset(serverTime, sentClientTime) {
    if (!serverTime || !sentClientTime) return;
    var offset = syncClockOffset(serverTime, sentClientTime);
    phone.meta.offsetMs = offset;
    if (Math.abs(offset) > SYNC.SKEW_WARN_SEC * 1000 && phone.clockWarnedMs !== offset) {
      phone.clockWarnedMs = offset;
      botSay(t(phone.ports, 'app_clock', { min: myDigits(Math.round(Math.abs(offset) / 60000)) }));
    }
  }
  function noteSync(entry) { phone.syncLog.push(entry); return entry; }

  /** Exchange the typed code for a device token, then bootstrap. */
  phone.enroll = function (code, transport) {
    var sent = wallClock().toISOString();
    var res = call(transport, 'enroll', { code: code, platform: 'android', label: phone.name, appVersion: phone.meta.appVersion, clientTime: sent });
    if (!res.ok) { noteSync({ at: sent, api: 'enroll', ok: false, error: res.error }); return res; }
    var d = res.device;
    phone.meta.deviceId = d.id;
    phone.meta.token = d.token;
    phone.meta.staff = d.staff;
    phone.meta.owners = (d.owners || []).map(function (id) { return { id: String(id), name: 'owner', shop: 'S1', role: 'owner' }; });
    phone.meta.scope = d.scope || [];
    phone.meta.receiptLetter = d.receiptLetter || '';
    phone.meta.label = d.label || phone.name;
    learnOffset(res.serverTime, sent);
    noteSync({ at: sent, api: 'enroll', ok: true, deviceId: d.id });
    if (res.bootstrap) phone.bootstrap(transport);
    return res;
  };

  /** Everything from the server, paged; synced rows are replaced, unsynced local rows and the outbox stay. */
  phone.bootstrap = function (transport) {
    if (!phone.meta.deviceId) return { ok: false, error: 'not_enrolled' };
    phone.ledger = phone.ledger.filter(function (r) { return !r.synced; });
    var cursorSeq = 0, pages = 0, rows = 0, res, sent;
    do {
      sent = wallClock().toISOString();
      res = call(transport, 'bootstrap', authBody({ cursorSeq: cursorSeq }));
      if (!res.ok) { rebuildStock(); noteSync({ at: sent, api: 'bootstrap', ok: false, error: res.error }); return res; }
      if (res.items) {
        res.items.forEach(local.upsertItem);
        res.customers.forEach(local.upsertCustomer);
        local.setSettings(res.settings || {});
        local.setMessages(res.messages || {});
        if (res.staff) phone.meta.staff = res.staff;
        phone.meta.owners = (res.owners || []).map(function (o) { return { id: String(o.id), name: o.name || 'owner', shop: o.shop || 'S1', role: 'owner' }; });
        phone.meta.scope = res.scope || phone.meta.scope;
        if (res.receiptLetter) phone.meta.receiptLetter = res.receiptLetter;
        phone.meta.cursor.masterRev = res.masterRev || 0;
        phone.meta.cursor.settingsHash = res.settingsHash || '';
        phone.meta.cursor.messagesHash = res.messagesHash || '';
      }
      res.ledger.forEach(function (row) { if (!local.hasRow(row.txId)) local.appendSynced(row); else local.markSynced(row.txId, row.seq, row.receivedAt, row.deviceId); });
      rows += res.ledger.length;
      cursorSeq = res.nextCursorSeq;
      pages++;
    } while (res.more);
    phone.meta.cursor.ledgerSeq = res.asOfSeq || cursorSeq;
    phone.meta.lastFullMastersDay = dayKey(now());
    learnOffset(res.serverTime, sent);
    rebuildStock();
    phone.lastSync = now();
    // Spec 9.1: one sync right after a successful bootstrap. The measurement sessions are not part of the bootstrap
    // (they come in measAfter pages with a pull), and they must be on the phone before the form is first opened.
    // The sync logs its own entry first, so the bootstrap's entry stays the last one of syncLog.
    var entry = { at: sent, api: 'bootstrap', ok: true, pages: pages, rows: rows };
    entry.followUp = phone.syncNow(transport);
    return noteSync(entry);
  };

  function showQuarantine(q) {
    var reason = q.reason;
    if (reason === SYNC.REASON.ALREADY_REVERSED) botSay(t(phone.ports, 'app_already_undone'));
    else botSay(t(phone.ports, 'app_rejected', { reason: syncReasonText(phone.ports, reason) }));
  }
  function showFlags(f) {
    var detail = f.flags.map(function (fl) { return syncFlagText(phone.ports, fl); }).join(' · ');
    botSay(t(phone.ports, 'app_flagged', { detail: detail }));
  }

  /**
   * Push the outbox (same batchId on a retry), apply the results, pull the delta page by page, learn the
   * clock offset, repair days whose checksums differ. Returns a summary or {ok:false, error}.
   */
  phone.syncNow = function (transport) {
    if (!phone.meta.deviceId) return { ok: false, error: 'not_enrolled' };
    var plan = phone.pendingBatch || syncPlanPush(phone.outbox, SYNC.PUSH_MAX_ROWS);
    if (!plan.batchId) plan.batchId = simUuid();
    phone.pendingBatch = plan;
    var today = dayKey(now()), fullMasters = phone.meta.lastFullMastersDay !== today;
    var sent = wallClock().toISOString();
    var pull = copy(phone.meta.cursor);
    pull.fullMasters = fullMasters;
    var res = call(transport, 'sync', authBody({ pendingCount: outboxRows(), push: plan.entries.length ? { batchId: plan.batchId, entries: plan.entries } : null, pull: pull }));
    if (res.transportFailure) return noteSync({ at: sent, api: 'sync', ok: false, error: res.error, pending: outboxRows() });
    phone.pendingBatch = null;
    if (!res.ok) {
      if (res.error === 'revoked') { phone.wipe(); botSay(t(phone.ports, 'app_revoked')); }
      else if (res.error === 'drain') botSay(t(phone.ports, 'app_drain'));
      else botSay(t(phone.ports, 'app_sync_fail'));
      return noteSync({ at: sent, api: 'sync', ok: false, error: res.error, message: res.message });
    }
    learnOffset(res.serverTime, sent);
    var summary = { ok: true, at: sent, api: 'sync', pushed: plan.rows, entries: plan.entries.length, acked: 0, quarantined: [], flagged: [], pulled: 0, measurements: 0,
                    pages: 1, repaired: [], drain: !!res.drain };
    if (res.push) {
      var ar = syncApplyPushResults(local, plan.entries, res.push.results, res.serverTime, phone.meta.deviceId);
      summary.acked = ar.acked.length;
      summary.quarantined = ar.quarantined;
      summary.flagged = ar.flagged;
      ar.quarantined.forEach(showQuarantine);
      ar.flagged.forEach(showFlags);
    }
    if (res.drain && !phone.drainShown) { phone.drainShown = true; botSay(t(phone.ports, 'app_drain')); }
    if (!res.drain) phone.drainShown = false;
    var delta = res.pull, applied = null;
    while (delta) {
      applied = syncApplyDelta(local, delta);
      summary.pulled += applied.added;
      summary.measurements += applied.measurements || 0;
      if (!delta.more) break;
      sent = wallClock().toISOString();
      res = call(transport, 'sync', authBody({ pendingCount: outboxRows(), push: null, pull: copy(phone.meta.cursor) }));
      if (!res.ok) { summary.incomplete = true; break; }
      learnOffset(res.serverTime, sent);
      summary.pages++;
      delta = res.pull;
    }
    if (applied && applied.repairDays.length) {
      var rp = copy(phone.meta.cursor);
      rp.repairDays = applied.repairDays;
      var rres = call(transport, 'sync', authBody({ pendingCount: outboxRows(), push: null, pull: rp }));
      if (rres.ok && rres.pull) {
        var rapplied = syncApplyDelta(local, rres.pull);
        summary.repaired = rapplied.repaired;
        rapplied.repaired.forEach(function (day) {
          store.logError('checksum_repair', 'day ' + day + ' re-pulled from the server (hand edit or lost row)', '', '');
          botSay(t(phone.ports, 'app_repaired', { day: fmtDayShortMy(day) }));
        });
      }
    }
    if (fullMasters && res.pull) phone.meta.lastFullMastersDay = today;
    phone.lastSync = now();
    return noteSync(summary);
  };

  /** An entry of kind item for this piece still waits in the outbox (round 6, M1: its photo or pic job waits for it). */
  function itemEntryWaits(itemId) {
    for (var i = 0; i < phone.outbox.length; i++) if (phone.outbox[i].kind === 'item' && phone.outbox[i].id === String(itemId)) return true;
    return false;
  }
  var AI_JOB_KINDS = { voice: true, text: true, photo: true, notebook: true }, PIC_TRIES = 5;
  /**
   * A job that meets AI off (the phone's switch or the server's ai_off answer), as app_sync.js aiOffJob: a new piece's photo
   * job goes up as a pic job (13.11, review r3 M-1: the photo is the only copy of that piece's picture), its id kept; any
   * other AI job is skipped, its data kept. Either way phone.aiSkipped is set, so the waiting lines can go. Returns the job
   * to send, or null.
   */
  function aiOffJob(job) {
    phone.aiSkipped = true;
    job.lastError = 'ai_off';
    if (job.kind === 'photo' && job.itemId) { job.kind = 'pic'; job.ctx = {}; return job; }
    job.status = 'skipped';
    return null;
  }
  /** One api=ai call for a queued job: the server's job answer, or null (offline, a lost reply; lastError says why). */
  function askAi(transport, job) {
    var res = call(transport, 'ai', authBody({ job: { id: job.id, kind: job.kind, mime: job.mime, data: job.data, text: job.text, ctx: job.ctx, createdAt: job.createdAt, itemId: job.itemId, sim: job.sim } }));
    if (!res.ok) { job.lastError = res.error; return null; }
    return res.job;
  }
  /**
   * Queued voice/photo/notebook jobs: one api=ai call each, then the usual proposal through handleIntent. Round 6 (spec 6.2,
   * M1): a photo job is held (it stays queued for the next call) while an item entry of its piece waits in the outbox, so
   * the server meets the registered piece, renames it and keeps its Drive URL; the piece is renamed here by the same rule
   * (aiRenameFields: a placeholder name only, a chosen category only over the catch-all), so the entry pushed afterwards
   * carries what the server already holds (dup, no conflict). A voice or text job is never held.
   * With AI off (the phone's switch, or the server's ai_off answer, then sent again at once) a new piece's photo job
   * becomes a pic job and any other AI job is skipped (aiOffJob); a pic job is held like a photo job, says nothing when
   * done and is tried again on no_item. Once no AI job is left queued after a skip, the waiting lines are done with.
   * A done photo or pic answer gives the item's Rev before (itemRevWas) and after (itemRev) the job's own write: the phone
   * whose Rev was the one before, with no item entry of that piece waiting, takes the new one, so its next entry of the
   * piece (an undo) carries no stale base (review r6: the false conflict).
   */
  phone.applyAiResults = function (transport) {
    var done = [];
    phone.aiSkipped = false;
    phone.aiQueue.forEach(function (job) {
      if (job.status !== 'queued') return;
      var ai = !!AI_JOB_KINDS[job.kind];
      if (ai && !aiOn(phone.ports)) {
        if (!aiOffJob(job)) return;
        ai = false;
      }
      if ((job.kind === 'photo' || job.kind === 'pic') && job.itemId && itemEntryWaits(job.itemId)) return;
      var j = askAi(transport, job);
      if (j && j.status !== 'done' && ai && j.error === 'ai_off') {           // the server heard of the switch first
        if (!aiOffJob(job)) return;
        ai = false;
        j = askAi(transport, job);                                            // the same photo again, as a pic job
      }
      if (!j) return;
      if (j.status === 'quota') { job.retryAfterSec = j.retryAfterSec; return; }
      if (j.status !== 'done' && !ai) {
        // Not an AI job: no ai_down line. The piece is not on the server yet (no_item): tried again at the next call.
        job.tries = (Number(job.tries) || 0) + 1;
        job.lastError = j.error || 'failed';
        if (!(job.kind === 'pic' && j.error === 'no_item' && job.tries < PIC_TRIES)) job.status = 'failed';
        return;
      }
      if (j.status !== 'done') { job.status = 'failed'; botSay(t(phone.ports, 'ai_down')); return; }
      job.status = 'done';
      job.result = j;
      done.push(job);
      if ((job.kind === 'photo' || job.kind === 'pic') && job.itemId && typeof j.itemRev === 'number') {
        var own = rawItem(job.itemId);
        if (own && Number(own.rev || 0) === j.itemRevWas && !itemEntryWaits(job.itemId)) local.setItemRev(job.itemId, j.itemRev);
      }
      if (job.kind === 'pic') return;                                         // a photo without AI says nothing
      var staff = phone.meta.staff, uid = staffId();
      var msg = { chat: { id: Number(uid) || uid, type: 'private' }, from: { id: Number(uid) || uid }, message_id: 0 };
      try {
        if (job.kind === 'voice' || job.kind === 'text') {
          botSay(t(phone.ports, 'app_ai_result'));
          handleIntent(j.intent, msg, staff, 'ai-' + job.id, phone.ports, job.kind === 'voice' ? CFG.SOURCE.VOICE : CFG.SOURCE.TEXT, job.ctx);
        } else if (job.kind === 'photo') {
          var item = job.itemId ? rawItem(job.itemId) : null;
          var fields = item ? aiRenameFields(item, j.desc, itemCategoryCats(job.ctx, phone.ports, item.shop)) : null;   // the job's own list (round 6b)
          if (fields) {
            store.updateItem(job.itemId, fields);
            botSay(t(phone.ports, 'photo_seen', { name: fields.name, category: fields.category || item.category }));
          }
        } else if (job.kind === 'notebook') {
          (j.lines || []).slice(0, CFG.NOTEBOOK_MAX_LINES).forEach(function (line, i) {
            presentNotebookLine(msg.chat.id, uid, line, i + 1, staff, 'ai-' + job.id, phone.ports);
          });
        }
      } catch (err) { store.logError('ai_replay', err, job.id, job.kind); }
    });
    // Skipped AI jobs wait for nothing any more: their waiting lines go once no AI job is left in the queue.
    if (phone.aiSkipped && !phone.aiQueue.some(function (q) { return q.status === 'queued' && !!AI_JOB_KINDS[q.kind]; })) {
      phone.chat.forEach(function (m) { if (m.pending) m.pending = false; });
    }
    return done;
  };

  /** Transport B: the whole outbox as a .json document to share with the bot in Telegram. */
  phone.exportOutbox = function () {
    return syncExportDocument({ deviceId: phone.meta.deviceId, staffId: staffId(), label: phone.meta.label, batchId: 'doc-' + simUuid().slice(0, 8) },
      syncPlanPush(phone.outbox, 100000).entries, wallClock().toISOString());
  };

  /** REVOKED: the phone forgets everything, including the device token. The outbox is lost by design. */
  phone.wipe = function () {
    phone.items = []; phone.customers = []; phone.ledger = []; phone.outbox = []; phone.stock = {}; phone.cacheData = {};
    phone.aiQueue = []; phone.pdfJobs = []; phone.settings = {}; phone.messages = {}; phone.measurements = {};
    phone.meta = freshMeta();
    phone.pendingBatch = null;
    phone.wiped = true;
  };

  phone.stats = function () {
    return { pending: outboxRows(), entries: phone.outbox.length, lastSync: phone.lastSync ? phone.lastSync.toISOString() : null,
             offsetMs: phone.meta.offsetMs, deviceId: phone.meta.deviceId, receiptLetter: phone.meta.receiptLetter, rows: phone.ledger.length };
  };
  phone.stockOf = function (itemId) { return phone.stock[itemId] || 0; };
  return phone;
}
