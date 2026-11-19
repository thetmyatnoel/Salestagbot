/**
 * app/app_store.js — the phone's LOCAL STORE CONTRACT (sync-and-server.md) over a persistence adapter.
 *
 * The core (core_bot/core_ledger) is synchronous and talks to plain arrays, exactly as poc/sim_phone.js
 * does; this file is that reference store made durable. Everything lives in memory as the working set,
 * loaded once at start; every change is recorded as a write operation and flushed by commit() in ONE
 * adapter transaction, so the ledger rows of a sale, its outbox entry, the chat card and the per-user
 * state land together or not at all. The UI renders the ✅ only after that commit resolves.
 *
 * Adapters: createMemoryAdapter() for Node tests and the dev page, createIdbAdapter() for the browser
 * (IndexedDB database `salestag` v2 with the stores listed in APP_STORES; v2 added `measurements`, and the
 * upgrade from v1 only creates the stores that are missing, so the outbox, ledger and settings stay). Both expose
 *   open() -> Promise, readAll(store) -> Promise<records>, transact(ops) -> Promise, clearAll() -> Promise
 * where ops are {store, type:'put', value} | {store, type:'delete', key} | {store, type:'clear'}.
 *
 * Invariants kept here (the critic's fixes): an incremental stock map updated on every append and on
 * every applied pull, ledgerRows() returning the same array reference until a write, rows indexed by
 * TxID so a 15,000-row bootstrap stays linear, synced rows first in Seq order then unsynced rows in
 * commit order, receipt numbers per device letter (R1-A-000231) stamped on SALE rows.
 * Round 4 (SPEC-round-4.md sections 8 and 9.1), the same contract as the reference phone poc/sim_phone.js:
 *  - option lists: the store port has NO listOptions (the core reads Settings lists_json); addListOption(rec, seedRows)
 *    applies an add to the local lists_json at once and queues {kind: 'list', rec} only when it changed something;
 *    local.setSettings(map) re-applies every list entry still in the outbox, so an option added offline stays.
 *  - measurement book: the `measurements` store keeps the newest session per customer {customerId, id, n, day, notes,
 *    fields, pending}; local.upsertMeasurement / saveMeasurementLocal / measurementSynced / measurementRejected and the
 *    store port's listMeasurements(customerId) ([record] or [], read by core_orders.js latestMeasurement). The cursor
 *    carries measAfter (0 on a fresh phone and on a phone upgraded from v1), so the pulls page the sessions in.
 * Logic adapted from poc/sim_phone.js (same project). Plain ES5: var and function only.
 */
var APP_DB_NAME = 'salestag';
var APP_DB_VERSION = 2;
var APP_STORES = [
  { name: 'meta', keyPath: 'key' },
  { name: 'items', keyPath: 'id' },
  { name: 'customers', keyPath: 'id' },
  { name: 'settings', keyPath: 'key' },
  { name: 'messages', keyPath: 'key' },
  { name: 'ledger', keyPath: 'txId', indexes: ['groupId', 'itemId', 'day', 'seq', 'synced'] },
  { name: 'outbox', keyPath: 'entryId', indexes: ['localSeq'] },
  { name: 'media', keyPath: 'id' },
  { name: 'chat', keyPath: 'id' },
  { name: 'cache', keyPath: 'key' },
  { name: 'errors', keyPath: 'id' },
  { name: 'thumbs', keyPath: 'itemId' },
  { name: 'measurements', keyPath: 'customerId' }      // v2: the newest measurement session per customer
];
var APP_CHAT_CAP = 500;          // messages kept on the phone
var APP_ERRORS_CAP = 50;         // local error rows kept
var APP_TAPMS_CAP = 50;          // tap-to-paint ring buffer (telemetry stays out of the ledger)

function appStoreDef(name) {
  for (var i = 0; i < APP_STORES.length; i++) if (APP_STORES[i].name === name) return APP_STORES[i];
  return null;
}

/** Deep copy of plain data; Blob/ArrayBuffer/Date values are kept by reference (IndexedDB clones them itself). */
function appCloneRecord(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v;
  if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(appCloneRecord(v[i])); return a; }
  var o = {};
  for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = appCloneRecord(v[k]);
  return o;
}

/* ------------------------------ memory adapter (Node tests, dev page) ------------------------------ */

/**
 * In-memory adapter with the same contract as IndexedDB. Test hooks: holdWrites (transactions wait
 * until release() is called, to prove the ✅ waits for the write), failNext (the next transaction
 * rejects), transactions (every applied transaction's ops, for assertions on what went in together).
 */
function createMemoryAdapter(opts) {
  opts = opts || {};
  var data = {};
  APP_STORES.forEach(function (s) { data[s.name] = {}; });
  var held = [];
  function apply(ops) {
    ops.forEach(function (op) {
      var def = appStoreDef(op.store);
      if (!def) throw new Error('unknown store ' + op.store);
      var table = data[op.store];
      if (op.type === 'put') table[String(op.value[def.keyPath])] = appCloneRecord(op.value);
      else if (op.type === 'delete') delete table[String(op.key)];
      else if (op.type === 'clear') data[op.store] = {};
    });
    adapter.writes++;
    adapter.transactions.push({ ops: ops.map(function (op) { return { store: op.store, type: op.type, key: op.type === 'put' ? op.value[appStoreDef(op.store).keyPath] : op.key }; }), at: Date.now() });
  }
  var adapter = {
    kind: 'memory', data: data, writes: 0, transactions: [], holdWrites: false, failNext: false, opened: false,
    open: function () { adapter.opened = true; return Promise.resolve(adapter); },
    readAll: function (store) {
      var table = data[store] || {};
      return Promise.resolve(Object.keys(table).map(function (k) { return appCloneRecord(table[k]); }));
    },
    transact: function (ops) {
      return new Promise(function (resolve, reject) {
        var run = function () {
          if (adapter.failNext) { adapter.failNext = false; return reject(new Error('simulated write failure')); }
          try { apply(ops); resolve(); } catch (err) { reject(err); }
        };
        if (adapter.holdWrites) held.push(run); else setTimeout(run, 0);
      });
    },
    /** Let the held transactions through, in order. */
    release: function () {
      var list = held;
      held = [];
      adapter.holdWrites = false;
      list.forEach(function (run) { run(); });
    },
    heldCount: function () { return held.length; },
    clearAll: function () { return adapter.transact(APP_STORES.map(function (s) { return { store: s.name, type: 'clear' }; })); },
    count: function (store) { return Object.keys(data[store] || {}).length; },
    close: function () {}
  };
  return adapter;
}

/* ------------------------------ IndexedDB adapter (browser) ------------------------------ */

function createIdbAdapter(opts) {
  opts = opts || {};
  var idb = opts.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  var name = opts.name || APP_DB_NAME;
  var db = null;
  function need() { if (!db) throw new Error('database not open'); return db; }
  var adapter = {
    kind: 'idb', available: !!idb, writes: 0,
    open: function () {
      return new Promise(function (resolve, reject) {
        if (!idb) return reject(new Error('IndexedDB is not available'));
        var req = idb.open(name, APP_DB_VERSION);
        req.onupgradeneeded = function () {
          // v1 -> v2 (and a fresh install): only the stores that do not exist yet are created; the data of every
          // existing store (outbox, ledger, settings, meta, ...) is left as it is. The meta cursor gets measAfter in load().
          var d = req.result;
          APP_STORES.forEach(function (s) {
            if (d.objectStoreNames.contains(s.name)) return;
            var os = d.createObjectStore(s.name, { keyPath: s.keyPath });
            (s.indexes || []).forEach(function (ix) { os.createIndex(ix, ix, { unique: false }); });
          });
        };
        req.onsuccess = function () {
          db = req.result;
          // A newer app opened the database at a higher version in another tab: this connection closes so that upgrade
          // is not blocked, and nothing more can be written here. adapter.onreplaced (set by app_ui.js) reloads the tab.
          db.onversionchange = function () {
            try { db.close(); } catch (ignore) {}
            db = null;
            if (typeof adapter.onreplaced === 'function') { try { adapter.onreplaced(); } catch (ignore) {} }
          };
          resolve(adapter);
        };
        req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
        req.onblocked = function () { reject(new Error('IndexedDB open blocked by another tab')); };
      });
    },
    readAll: function (store) {
      return new Promise(function (resolve, reject) {
        var tx = need().transaction(store, 'readonly');
        var r = tx.objectStore(store).getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { reject(r.error || new Error('readAll failed: ' + store)); };
      });
    },
    transact: function (ops) {
      return new Promise(function (resolve, reject) {
        if (!ops.length) return resolve();
        var names = {};
        ops.forEach(function (op) { names[op.store] = true; });
        var tx;
        try { tx = need().transaction(Object.keys(names), 'readwrite'); } catch (err) { return reject(err); }
        tx.oncomplete = function () { adapter.writes++; resolve(); };
        tx.onerror = function () { reject(tx.error || new Error('transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
        try {
          ops.forEach(function (op) {
            var os = tx.objectStore(op.store);
            if (op.type === 'put') os.put(op.value);
            else if (op.type === 'delete') os['delete'](op.key);
            else if (op.type === 'clear') os.clear();
          });
        } catch (err) { try { tx.abort(); } catch (ignore) {} reject(err); }
      });
    },
    clearAll: function () { return adapter.transact(APP_STORES.map(function (s) { return { store: s.name, type: 'clear' }; })); },
    close: function () { if (db) { try { db.close(); } catch (ignore) {} db = null; } }
  };
  return adapter;
}

/* ------------------------------ the store ------------------------------ */

function appFreshMeta() {
  return {
    deviceId: null, token: null, staff: null, owners: [], scope: [], receiptLetter: '', receiptCounter: 0, offsetMs: 0,
    cursor: { ledgerSeq: 0, masterRev: 0, settingsHash: '', messagesHash: '', measAfter: 0 }, lastFullMastersDay: '',
    appVersion: typeof SYNC !== 'undefined' ? SYNC.VERSION : 1, label: '', platform: '', enrolledAt: '',
    nextMsgId: 1, nextUpdateId: 1, nextLocalSeq: 1, nextErrorId: 1, nextFileId: 1,
    lastSyncOk: null, lastSyncTry: null, lastSyncError: null, lastBootstrap: null,
    prefs: {}, tapMs: []
  };
}

/**
 * createAppStore(adapter) -> store. store.ports is what the core sees (ports.store); store.local is the
 * LOCAL STORE CONTRACT used by core_sync's client helpers; load() fills memory from the adapter;
 * commit() flushes the recorded operations in one transaction.
 */
function createAppStore(adapter, opts) {
  opts = opts || {};
  var S = {
    adapter: adapter, loaded: false, rev: 0, commits: 0, lastWriteError: null,
    items: [], customers: [], ledger: [], outbox: [], chat: [], errors: [], media: [], thumbs: {}, measurements: {},
    settings: {}, messages: {}, cacheData: {}, stock: {}, meta: appFreshMeta(),
    itemsById: {}, customersById: {}, rowsByTx: {}, syncedCount: 0, mediaById: {},
    ops: [], chain: Promise.resolve(), collector: null
  };
  S.now = opts.now || function () { return new Date(); };
  var SYNC_PUSH_MAX = typeof SYNC !== 'undefined' ? SYNC.PUSH_MAX_ROWS : 200;

  function copy(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
  function copyMeas(m) { var c = copy(m); c.fields = copy(m.fields || {}); return c; }
  function uuid() { return typeof appUuid === 'function' ? appUuid() : String(Math.random()).slice(2) + '-' + Date.now(); }

  /* ---------- recorded writes ---------- */
  function put(storeName, value) { S.ops.push({ store: storeName, type: 'put', value: value }); S.rev++; }
  function del(storeName, key) { S.ops.push({ store: storeName, type: 'delete', key: key }); S.rev++; }
  function clr(storeName) { S.ops.push({ store: storeName, type: 'clear' }); S.rev++; }
  function putMeta() { put('meta', { key: 'meta', value: appCloneRecord(S.meta) }); }

  /* ---------- ledger rows: memory form has synced:boolean, disk form has synced:0|1 ---------- */
  function rowToDisk(row) { var d = copy(row); d.synced = row.synced ? 1 : 0; return d; }
  function rowFromDisk(rec) { var r = copy(rec); r.synced = rec.synced === 1 || rec.synced === true; return r; }
  /** What leaves the phone: no local bookkeeping fields. */
  function stripLocal(row) { var c = copy(row); delete c.synced; delete c.localSeq; return c; }
  function addStock(row, sign) {
    if (!row.itemId) return;
    S.stock[row.itemId] = (S.stock[row.itemId] || 0) + sign * (Number(row.qty) || 0);
  }
  function rebuildIndexes() {
    S.rowsByTx = {};
    S.stock = {};
    S.syncedCount = 0;
    S.ledger.forEach(function (r) { S.rowsByTx[r.txId] = r; addStock(r, 1); if (r.synced) S.syncedCount++; });
    S.itemsById = {};
    S.items.forEach(function (it) { S.itemsById[it.id] = it; });
    S.customersById = {};
    S.customers.forEach(function (c) { S.customersById[c.id] = c; });
    S.mediaById = {};
    S.media.forEach(function (m) { S.mediaById[m.id] = m; });
  }
  function rawItem(id) { return S.itemsById[String(id)] || null; }
  function viewItem(raw) {
    var stock = S.stock[raw.id] || 0;
    var status = !raw.name ? CFG.STATUS.BLANK : (raw.type === CFG.ITEM_TYPE.UNIQUE && stock <= 0 ? CFG.STATUS.SOLD : CFG.STATUS.ACTIVE);
    var v = copy(raw);
    v.stock = stock;
    v.status = status;
    v.sample = !!raw.sample;
    v.alias = raw.alias || '';
    v.rev = raw.rev || 0;
    return v;
  }
  function staffId() { return S.meta.staff ? String(S.meta.staff.id) : null; }

  /* ---------- outbox ---------- */
  function pushOutbox(entry) {
    entry.entryId = entry.entryId || uuid();
    entry.at = S.now().toISOString();
    entry.localSeq = S.meta.nextLocalSeq++;
    S.outbox.push(entry);
    put('outbox', appCloneRecord(entry));
    putMeta();
    return entry;
  }

  /* ---------- the core's store port ---------- */
  var ports = {
    getItem: function (id) { var r = rawItem(id); return r ? viewItem(r) : null; },
    listItems: function (shop) { return S.items.filter(function (r) { return !shop || r.shop === shop; }).map(viewItem); },
    updateItem: function (id, fields) {
      var r = rawItem(id);
      if (!r) throw new Error('updateItem: no item ' + id);
      var baseRev = r.rev || 0, f = {};
      for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) { r[k] = fields[k]; f[k] = fields[k]; }
      put('items', appCloneRecord(r));
      pushOutbox({ kind: 'item', id: r.id, fields: f, baseRev: baseRev });
    },
    appendLedger: function (tx) {
      // Per-device receipt number on the SALE row (R1-A-000231): gap-free per phone, never renumbered. Round 6 (spec 3.5):
      // ONE number per basket: the rows of one writeGroup are appended one after the other, so walking back from the end
      // while the group is the same finds the group's earlier SALE row (not a mirror), whose number is copied.
      if (tx.type === CFG.TX.SALE && !tx.reversesTxId && !tx.receiptNo && S.meta.receiptLetter) {
        var shared = '';
        for (var g = S.ledger.length - 1; g >= 0 && S.ledger[g].groupId === tx.groupId; g--) {
          var prev = S.ledger[g];
          if (prev.type === CFG.TX.SALE && !prev.reversesTxId && prev.receiptNo) { shared = prev.receiptNo; break; }
        }
        if (shared) tx.receiptNo = shared;
        else {
          S.meta.receiptCounter++;
          tx.receiptNo = syncReceiptNo(tx.shop, S.meta.receiptLetter, S.meta.receiptCounter);
        }
      }
      var row = copy(tx);
      row.synced = false;
      row.seq = row.seq || '';
      row.localSeq = S.meta.nextLocalSeq++;
      S.ledger.push(row);
      S.rowsByTx[row.txId] = row;
      addStock(row, 1);
      put('ledger', rowToDisk(row));
      if (S.collector) S.collector.push(row);
      else pushOutbox({ kind: 'group', groupId: row.groupId, txs: [stripLocal(row)] });
      putMeta();
    },
    ledgerRows: function () { return S.ledger; },
    getStaff: function (uid) {
      if (S.meta.staff && String(uid) === staffId()) return copy(S.meta.staff);
      for (var i = 0; i < S.meta.owners.length; i++) if (String(S.meta.owners[i].id) === String(uid)) return copy(S.meta.owners[i]);
      return null;
    },
    listStaff: function () {
      var out = S.meta.staff ? [copy(S.meta.staff)] : [];
      S.meta.owners.forEach(function (o) { if (String(o.id) !== staffId()) out.push(copy(o)); });
      return out;
    },
    getCustomer: function (id) { return S.customersById[String(id)] || null; },
    listCustomers: function () { return S.customers.slice(); },
    addCustomer: function (c) {
      var id = 'C-' + uuid().replace(/-/g, '').slice(0, 8);
      var rec = { id: id, name: String(c.name || '').trim() || id, phone: c.phone || '', note: c.note || '', createdAt: S.now().toISOString(), rev: 0, updatedAt: '' };
      S.customers.push(rec);
      S.customersById[id] = rec;
      put('customers', appCloneRecord(rec));
      pushOutbox({ kind: 'customer', rec: appCloneRecord(rec) });
      return rec;
    },
    updateCustomer: function (id, fields) {
      var c = S.customersById[String(id)];
      if (!c) throw new Error('updateCustomer: no customer ' + id);
      for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) c[k] = fields[k];
      put('customers', appCloneRecord(c));
      pushOutbox({ kind: 'customer', rec: appCloneRecord(c) });
    },
    getSetting: function (k, d) {
      if (S.meta.prefs && Object.prototype.hasOwnProperty.call(S.meta.prefs, 'setting:' + k)) return S.meta.prefs['setting:' + k];
      return Object.prototype.hasOwnProperty.call(S.settings, k) ? S.settings[k] : d;
    },
    getMessage: function (k) { return S.messages[k] || null; },
    /**
     * ➕ an option, or set an account number, offline (core_ledger.js addListOptionByLabel and setListDetail call this
     * with rec = {list, key, label?, detail?, detailWas?, shop?, note?} and seedRows = the rows the phone shows now).
     * The server's upsert rule (listUpsert, through listsJsonUpsert) runs on the local Settings lists_json, so the option
     * is a button at once; the new value is persisted and a copy of rec (never the seed) is queued as {kind: 'list', rec}
     * only when the status is 'ok' (a 'dup' changed nothing). Returns {status, key} like the server's store.
     */
    addListOption: function (rec, seedRows) {
      var cur = typeof S.settings.lists_json === 'string' ? S.settings.lists_json : '';
      var r = listsJsonUpsert(cur, rec.list, seedRows, rec);
      if (r.raw && r.raw !== S.settings.lists_json) {
        S.settings.lists_json = r.raw;
        put('settings', { key: 'lists_json', value: r.raw });
      }
      if (r.status === 'ok') pushOutbox({ kind: 'list', rec: appCloneRecord(rec) });
      return { status: r.status, key: r.key };
    },
    /** The customer's newest measurement session as a list: [record] or []. core_orders.js latestMeasurement reads it. */
    listMeasurements: function (customerId) {
      var m = S.measurements[String(customerId)];
      return m ? [copyMeas(m)] : [];
    },
    logError: function (where, err, updateId, payload) {
      var message = err && err.message ? err.message : String(err);
      var rec = { id: S.meta.nextErrorId++, time: S.now().toISOString(), where: where, message: message, updateId: String(updateId || ''), payload: String(payload || '').slice(0, 500) };
      S.errors.push(rec);
      if (S.errors.length > APP_ERRORS_CAP) { var old = S.errors.shift(); del('errors', old.id); }
      put('errors', rec);
      putMeta();
      if (err && err.pending) return;                        // a queued AI job is not an error for the server
      pushOutbox({ kind: 'error', where: where, message: message, updateId: rec.updateId, payload: rec.payload });
    },
    logUnknownUser: function () {}
    // refreshViews: intentionally absent; the server refreshes Credits/Deposits once per batch
    // listOptions: intentionally absent; the phone's lists come from Settings lists_json (core_ledger.js listRows)
  };

  /* ---------- measurement records ---------- */
  /** Measurement entries of one customer still waiting in the (in-memory) outbox. */
  function measEntriesOf(customerId) {
    var n = 0;
    S.outbox.forEach(function (e) { if (e.kind === 'measurement' && e.rec && String(e.rec.customerId) === String(customerId)) n++; });
    return n;
  }
  function putMeas(m) { S.measurements[m.customerId] = m; put('measurements', copyMeas(m)); }

  /* ---------- LOCAL STORE CONTRACT extras for core_sync's client helpers ---------- */
  function removeRowAt(i) {
    var row = S.ledger[i];
    S.ledger.splice(i, 1);
    if (row.synced) S.syncedCount--;
    delete S.rowsByTx[row.txId];
    addStock(row, -1);
    del('ledger', row.txId);
  }
  var local = {
    removeEntry: function (entryId) {
      for (var i = 0; i < S.outbox.length; i++) if (S.outbox[i].entryId === entryId) { S.outbox.splice(i, 1); del('outbox', entryId); return; }
    },
    markSynced: function (txId, seq, receivedAt, deviceId) {
      var row = S.rowsByTx[txId];
      if (!row) return;
      var wasSynced = row.synced;
      row.synced = true;
      if (seq !== null && seq !== undefined && seq !== '') row.seq = seq;
      if (receivedAt && !row.receivedAt) row.receivedAt = receivedAt;
      if (deviceId && !row.deviceId) row.deviceId = deviceId;
      if (!wasSynced) {                                      // move into the synced block (end of it: Seq grows)
        var i = S.ledger.indexOf(row);
        S.ledger.splice(i, 1);
        S.ledger.splice(S.syncedCount, 0, row);
        S.syncedCount++;
      }
      put('ledger', rowToDisk(row));
    },
    removeRows: function (txIds) {
      txIds.forEach(function (txId) {
        var row = S.rowsByTx[txId];
        if (!row) return;
        removeRowAt(S.ledger.indexOf(row));
      });
    },
    setItemRev: function (id, rev) { var r = rawItem(id); if (r) { r.rev = rev; put('items', appCloneRecord(r)); } },
    setCustomerRev: function (id, rev) { var c = S.customersById[String(id)]; if (c) { c.rev = rev; put('customers', appCloneRecord(c)); } },
    upsertItem: function (rec) {
      var r = rawItem(rec.id);
      if (!r) { r = copy(rec); S.items.push(r); S.itemsById[r.id] = r; }
      else for (var k in rec) if (Object.prototype.hasOwnProperty.call(rec, k)) r[k] = rec[k];
      put('items', appCloneRecord(r));
    },
    upsertCustomer: function (rec) {
      var c = S.customersById[String(rec.id)];
      if (!c) { c = copy(rec); S.customers.push(c); S.customersById[c.id] = c; }
      else for (var k in rec) if (Object.prototype.hasOwnProperty.call(rec, k)) c[k] = rec[k];
      put('customers', appCloneRecord(c));
    },
    hasRow: function (txId) { return !!S.rowsByTx[txId]; },
    appendSynced: function (row) {
      var r = copy(row);
      r.synced = true;
      S.ledger.splice(S.syncedCount, 0, r);
      S.syncedCount++;
      S.rowsByTx[r.txId] = r;
      addStock(r, 1);
      put('ledger', rowToDisk(r));
    },
    /**
     * A pull or bootstrap replaces the Settings map. The map is stored first; then every list entry still in the
     * outbox is applied again, in outbox order, to the lists_json of the map just stored, seeded the way the server
     * seeds a list that has no rows yet (legacyListRows over this store port, which reads the new map): an option
     * added offline stays a button next to all the old ones until the server has it, even when this pull came
     * before the push. Persisted once.
     */
    setSettings: function (map) {
      S.settings = copy(map);
      S.outbox.forEach(function (e) {
        // Round 6: a setting changed here and not pushed yet (the owner's Shops or AI switch) stays over the pulled value.
        if (e.kind === 'setting' && typeof e.key === 'string') { S.settings[e.key] = e.value; return; }
        if (e.kind !== 'list' || !e.rec) return;
        var cur = typeof S.settings.lists_json === 'string' ? S.settings.lists_json : '';
        var r = listsJsonUpsert(cur, e.rec.list, legacyListRows({ store: ports }, e.rec.list), e.rec);
        if (r.raw) S.settings.lists_json = r.raw;
      });
      clr('settings');
      Object.keys(S.settings).forEach(function (k) { put('settings', { key: k, value: S.settings[k] }); });
    },
    /**
     * The owner's Shops screen or AI switch (round 6, revision 3, spec 13.12): the local Settings change at once (the
     * phone shows the new name or hides 🎤 before any sync) and {kind: 'setting', key, value} is queued; the server
     * whitelists the key and takes it from the owner's phone only (core_sync.js syncSettingReason). Returns the entry.
     */
    setSettingLocal: function (key, value) {
      var k = String(key), v = String(value === null || value === undefined ? '' : value);
      S.settings[k] = v;
      put('settings', { key: k, value: v });
      return pushOutbox({ kind: 'setting', key: k, value: v });
    },
    setMessages: function (map) {
      S.messages = copy(map);
      clr('messages');
      Object.keys(S.messages).forEach(function (k) { put('messages', { key: k, value: S.messages[k] }); });
      // The Messages tab may also hold the app's ui_* keys: nothing to do, t() reads getMessage first.
    },
    /**
     * A session from a pull, {id, n, customerId, orderId, day, notes, fields}: a pending local record (saved here, not
     * yet acknowledged) is kept over it; otherwise the session with the higher n is the customer's record.
     */
    upsertMeasurement: function (rec) {
      var cid = String(rec.customerId || ''), cur = S.measurements[cid], n = Number(rec.n) || syncMeasNo(rec.id);
      if (!cid || (cur && (cur.pending || (Number(cur.n) || 0) >= n))) return;
      var m = { customerId: cid, id: String(rec.id || ''), n: n, day: String(rec.day || ''), notes: String(rec.notes || ''),
                fields: copy(rec.fields || {}), pending: false };
      if (rec.sketch) m.sketch = String(rec.sketch);           // the drawing (round 6), only when there is one
      putMeas(m);
    },
    /**
     * The measurement form saved a session: it is the customer's newest record at once, pending until the server
     * answers, and {kind: 'measurement', rec} is queued with rec = {customerId, orderId, day, staffId, source, notes,
     * fields} (orderId '' when none; day, staffId (the enrolled staff) and source FORM filled in when left out).
     * Returns a copy of the local record.
     */
    saveMeasurementLocal: function (rec) {
      var r = {
        customerId: String(rec.customerId), orderId: rec.orderId ? String(rec.orderId) : '', day: rec.day || dayKey(S.now()),
        staffId: rec.staffId !== undefined && rec.staffId !== null && rec.staffId !== '' ? String(rec.staffId) : staffId(),
        source: rec.source || CFG.MEAS_SOURCE.FORM, notes: rec.notes ? String(rec.notes) : '', fields: copy(rec.fields || {})
      };
      // The drawing (round 6, revision 3) goes into the record and the entry only when there is one, so an entry without a
      // drawing keeps today's exact shape.
      if (rec.sketch) r.sketch = String(rec.sketch);
      var m = { customerId: r.customerId, id: '', n: 0, day: r.day, notes: r.notes, fields: copy(r.fields), pending: true };
      if (r.sketch) m.sketch = r.sketch;
      putMeas(m);
      var entry = pushOutbox({ kind: 'measurement', rec: r });
      var out = copyMeas(S.measurements[r.customerId]);
      out.entryId = entry.entryId;                            // the outbox entry it queued (a drawing's picture job waits for it)
      return out;
    },
    /**
     * The server stored (ok) or already had (dup) a session of this customer under `id`. Only when no other
     * measurement entry of that customer is left in the outbox (a later save is still on its way) the record takes
     * that id and number and stops being pending.
     */
    measurementSynced: function (customerId, id) {
      var cid = String(customerId), cur = S.measurements[cid];
      if (!cur || measEntriesOf(cid) > 0) return;
      cur.id = String(id || '');
      cur.n = syncMeasNo(id);
      cur.pending = false;
      putMeas(cur);
    },
    /**
     * The server refused a session of this customer (quarantined). Only when no other measurement entry of that
     * customer is left in the outbox: the record (the session the server never took) is deleted and cursor.measAfter
     * goes back to 0 on the cursor getCursor() returns, so the next pulls bring the server's sessions again.
     */
    measurementRejected: function (customerId) {
      var cid = String(customerId);
      if (measEntriesOf(cid) > 0) return;
      if (S.measurements[cid]) { delete S.measurements[cid]; del('measurements', cid); }
      S.meta.cursor.measAfter = 0;
      putMeta();
      // Round 6 (review r3, M-2): the drawing's picture of a session the server refused will never find its session.
      S.media.forEach(function (m) {
        if (m.kind !== 'sketch' || m.status !== 'queued' || String(m.customerId || '') !== cid) return;
        for (var i = 0; i < S.outbox.length; i++) if (S.outbox[i].entryId === m.entryId) return;
        m.status = 'failed';
        m.lastError = 'rejected';
        m.data = '';
        put('media', m);
      });
    },
    getCursor: function () { return S.meta.cursor; },
    setCursor: function (c) { S.meta.cursor = c; putMeta(); },
    syncedRows: function () { return S.ledger.slice(0, S.syncedCount); },
    /** A day re-pulled after a checksum mismatch: the server's rows replace the local synced copy; unsynced rows stay. */
    replaceDay: function (day, rows) {
      var keep = [];
      S.ledger.forEach(function (r) { if (r.synced && r.day === day) del('ledger', r.txId); else keep.push(r); });
      S.ledger = keep;
      rebuildIndexes();
      rows.forEach(function (row) { local.appendSynced(row); });
      // appendSynced inserted in Seq order at the end of the synced block; keep the synced block sorted by Seq.
      var synced = S.ledger.slice(0, S.syncedCount).sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
      S.ledger = synced.concat(S.ledger.slice(S.syncedCount));
      rebuildIndexes();
    },
    /** Bootstrap start: forget every synced row (they come back from the server), keep local unsynced rows and the outbox. */
    resetSynced: function () {
      S.ledger = S.ledger.filter(function (r) { return !r.synced; });
      clr('ledger');
      S.ledger.forEach(function (r) { put('ledger', rowToDisk(r)); });
      rebuildIndexes();
    }
  };

  /* ---------- chat, cache, media, thumbs, meta ---------- */
  var store = {
    S: S, adapter: adapter, ports: ports, local: local,
    get meta() { return S.meta; },
    get items() { return S.items; },
    get customers() { return S.customers; },
    get ledger() { return S.ledger; },
    get outbox() { return S.outbox; },
    get chat() { return S.chat; },
    get media() { return S.media; },
    get errors() { return S.errors; },
    get settings() { return S.settings; },
    get messages() { return S.messages; },
    get measurements() { return S.measurements; },
    get rev() { return S.rev; },
    get loaded() { return S.loaded; },
    get commits() { return S.commits; },
    get pendingOps() { return S.ops.length; }
  };
  store.setNow = function (fn) { S.now = fn; };
  /** An outbox entry from outside the core's write path (owner notices from the chat port, sync-layer errors). */
  store.pushOutbox = pushOutbox;
  store.setMeta = function (fields) {
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) S.meta[k] = fields[k];
    putMeta();
  };
  store.setPref = function (key, value) { S.meta.prefs[key] = value; putMeta(); };
  store.getPref = function (key, def) { return Object.prototype.hasOwnProperty.call(S.meta.prefs, key) ? S.meta.prefs[key] : def; };
  store.recordTapMs = function (ms) {
    S.meta.tapMs.push(Math.round(ms));
    if (S.meta.tapMs.length > APP_TAPMS_CAP) S.meta.tapMs.shift();
    putMeta();
  };
  store.nextUpdateId = function () { var n = S.meta.nextUpdateId++; putMeta(); return 'app-' + n; };
  store.nextFileId = function (prefix) { var n = S.meta.nextFileId++; putMeta(); return (prefix || 'f') + '_' + n; };

  store.pushChat = function (m) {
    m.id = S.meta.nextMsgId++;
    if (m.order === undefined) m.order = m.id;
    m.chatId = staffId();
    m.ts = S.now().toISOString();
    S.chat.push(m);
    while (S.chat.length > APP_CHAT_CAP) { var old = S.chat.shift(); del('chat', old.id); }
    put('chat', appCloneRecord(m));
    putMeta();
    return m;
  };
  /** Insert a message at a position before `beforeMsg` (the ⏳ line under a card), keeping the order on reload. */
  store.insertChatBefore = function (m, beforeMsg) {
    m.id = S.meta.nextMsgId++;
    m.order = beforeMsg.order - 0.5;
    m.chatId = staffId();
    m.ts = S.now().toISOString();
    var idx = S.chat.indexOf(beforeMsg);
    if (idx < 0) S.chat.push(m); else S.chat.splice(idx, 0, m);
    put('chat', appCloneRecord(m));
    putMeta();
    return m;
  };
  store.saveChat = function (m) { put('chat', appCloneRecord(m)); };
  store.chatById = function (id) {
    for (var i = S.chat.length - 1; i >= 0; i--) if (S.chat[i].id === id) return S.chat[i];
    return null;
  };

  store.cacheGet = function (k) {
    var e = S.cacheData[k];
    if (!e) return null;
    if (e.exp < S.now().getTime()) { delete S.cacheData[k]; del('cache', k); return null; }
    return e.v;
  };
  store.cachePut = function (k, v, ttl) {
    var e = { key: k, v: v, exp: S.now().getTime() + (ttl || 600) * 1000 };
    S.cacheData[k] = e;
    put('cache', e);
  };
  store.cacheRemove = function (k) { delete S.cacheData[k]; del('cache', k); };

  store.addMedia = function (rec) {
    rec.id = rec.id || store.nextFileId(rec.kind || 'f');
    rec.createdAt = rec.createdAt || S.now().toISOString();
    rec.status = rec.status || 'file';
    S.media.push(rec);
    S.mediaById[rec.id] = rec;
    put('media', rec);                                        // not cloned: a Blob must keep its identity
    return rec;
  };
  store.updateMedia = function (id, fields) {
    var m = S.mediaById[id];
    if (!m) return null;
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) m[k] = fields[k];
    put('media', m);
    return m;
  };
  store.getMedia = function (id) { return S.mediaById[id] || null; };
  store.removeMedia = function (id) {
    var m = S.mediaById[id];
    if (!m) return;
    S.media.splice(S.media.indexOf(m), 1);
    delete S.mediaById[id];
    del('media', id);
  };
  store.queuedMedia = function () { return S.media.filter(function (m) { return m.status === 'queued'; }); };
  store.setThumb = function (itemId, data) { S.thumbs[itemId] = data; put('thumbs', { itemId: itemId, data: data, at: S.now().toISOString() }); };
  store.thumb = function (itemId) { return S.thumbs[itemId] || null; };

  /** Rows written inside one lock.run form one outbox group (writeGroup calls appendLedger per row). */
  store.openCollector = function () { var outer = S.collector; S.collector = []; return outer; };
  store.closeCollector = function (outer) {
    var rows = S.collector;
    S.collector = outer;
    if (rows && rows.length) pushOutbox({ kind: 'group', groupId: rows[0].groupId, txs: rows.map(stripLocal) });
  };

  store.stockOf = function (itemId) { return S.stock[itemId] || 0; };
  store.pendingRows = function () {
    var n = 0;
    S.outbox.forEach(function (e) { n += e.kind === 'group' ? e.txs.length : 0; });
    return n;
  };
  store.oldestPendingAt = function () {
    var oldest = null;
    S.outbox.forEach(function (e) { if (e.at && (!oldest || e.at < oldest)) oldest = e.at; });
    return oldest;
  };
  store.stats = function () {
    return { pending: store.pendingRows(), entries: S.outbox.length, lastSyncOk: S.meta.lastSyncOk, lastSyncTry: S.meta.lastSyncTry,
             lastSyncError: S.meta.lastSyncError, offsetMs: S.meta.offsetMs, deviceId: S.meta.deviceId, receiptLetter: S.meta.receiptLetter,
             rows: S.ledger.length, syncedRows: S.syncedCount, items: S.items.length, oldestPendingAt: store.oldestPendingAt(),
             aiQueued: store.queuedMedia().length, enrolled: !!S.meta.deviceId };
  };
  store.pushMax = function () { return SYNC_PUSH_MAX; };

  /* ---------- load, commit, wipe ---------- */
  store.load = function () {
    return adapter.open().then(function () {
      return Promise.all(APP_STORES.map(function (s) { return adapter.readAll(s.name); }));
    }).then(function (all) {
      var by = {};
      APP_STORES.forEach(function (s, i) { by[s.name] = all[i]; });
      var metaRec = by.meta.filter(function (r) { return r.key === 'meta'; })[0];
      S.meta = appFreshMeta();
      if (metaRec && metaRec.value) for (var k in metaRec.value) if (Object.prototype.hasOwnProperty.call(metaRec.value, k)) S.meta[k] = metaRec.value[k];
      if (!S.meta.prefs) S.meta.prefs = {};
      if (!S.meta.tapMs) S.meta.tapMs = [];
      // A cursor saved by a v1 phone has no measAfter: this store keeps measurement sessions, so it asks for them from
      // the first sync after the upgrade (syncApplyDelta would add it only after one more pull).
      if (!S.meta.cursor || typeof S.meta.cursor !== 'object') S.meta.cursor = appFreshMeta().cursor;
      if (typeof S.meta.cursor.measAfter !== 'number' || !isFinite(S.meta.cursor.measAfter)) {
        S.meta.cursor.measAfter = 0;
        if (metaRec) putMeta();
      }
      S.items = by.items.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      S.customers = by.customers.sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
      S.settings = {};
      by.settings.forEach(function (r) { S.settings[r.key] = r.value; });
      S.messages = {};
      by.messages.forEach(function (r) { S.messages[r.key] = r.value; });
      var rows = by.ledger.map(rowFromDisk);
      var synced = rows.filter(function (r) { return r.synced; }).sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
      var unsynced = rows.filter(function (r) { return !r.synced; }).sort(function (a, b) { return (a.localSeq || 0) - (b.localSeq || 0); });
      S.ledger = synced.concat(unsynced);
      S.outbox = by.outbox.sort(function (a, b) { return (a.localSeq || 0) - (b.localSeq || 0); });
      S.chat = by.chat.sort(function (a, b) { return (a.order !== undefined ? a.order : a.id) - (b.order !== undefined ? b.order : b.id); });
      while (S.chat.length > APP_CHAT_CAP) { var old = S.chat.shift(); del('chat', old.id); }
      S.cacheData = {};
      var nowMs = S.now().getTime();
      by.cache.forEach(function (e) { if (e.exp < nowMs) del('cache', e.key); else S.cacheData[e.key] = e; });
      S.errors = by.errors.sort(function (a, b) { return a.id - b.id; }).slice(-APP_ERRORS_CAP);
      S.media = by.media.sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
      S.thumbs = {};
      by.thumbs.forEach(function (r) { S.thumbs[r.itemId] = r.data; });
      S.measurements = {};
      (by.measurements || []).forEach(function (m) { if (m && m.customerId) S.measurements[String(m.customerId)] = m; });
      rebuildIndexes();
      S.loaded = true;
      return S.ops.length ? store.commit() : null;
    }).then(function () { return store; });
  };

  /** Flush the recorded operations in ONE adapter transaction. Failed writes are kept for the next commit. */
  store.commit = function () {
    if (!S.ops.length) return S.chain;
    var ops = S.ops;
    S.ops = [];
    var run = function () {
      return adapter.transact(ops).then(function () { S.commits++; S.lastWriteError = null; }, function (err) {
        S.ops = ops.concat(S.ops);
        S.lastWriteError = err;
        throw err;
      });
    };
    var p = S.chain.then(run, run);
    S.chain = p.then(function () {}, function () {});           // the chain itself never rejects
    return p;
  };

  /** REVOKED or re-enroll: the phone forgets everything, including the device token. The outbox is lost by design. */
  store.wipe = function () {
    S.ops = [];
    S.items = []; S.customers = []; S.ledger = []; S.outbox = []; S.chat = []; S.errors = []; S.media = []; S.thumbs = {};
    S.settings = {}; S.messages = {}; S.cacheData = {}; S.stock = {}; S.measurements = {};
    var prefs = S.meta.prefs || {};
    S.meta = appFreshMeta();
    S.meta.prefs = { fontSize: prefs.fontSize };                  // eyesight is not a secret
    rebuildIndexes();
    S.rev++;
    var run = function () { return adapter.clearAll().then(function () { S.commits++; }); };
    var p = S.chain.then(run, run);
    S.chain = p.then(function () {}, function () {});
    return p;
  };

  return store;
}
