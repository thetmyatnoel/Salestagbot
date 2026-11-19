/**
 * poc/sim_sync.js — a fake sync server over the simulator's in-memory sheet.
 *
 * createFakeServer(world) wraps world.items / ledger / customers / settings / messages / staff with the
 * serverPorts object core_sync.js expects, plus in-memory Devices, SyncLog, Quarantine and AiJobs.
 * handle(api, body) answers exactly what gas_sync.js would, because both call syncHandle(). The world's
 * own ports (the Telegram route, processUpdate(update, world.ports)) and the phones share the same
 * arrays, so a sale made in Telegram is visible to phones after a pull and a phone's push shows up in
 * the simulator's Sheet pane. Flags: server.down (handle throws like a dead network), server.dropResponse
 * (the next call is processed but its reply is lost), server.latencyMs (recorded on each call).
 * Runs in Node and the browser; no platform API, SHA-256 is implemented below.
 */
function createFakeServer(world, opts) {
  opts = opts || {};
  var server = {
    world: world, down: false, dropResponse: false, latencyMs: 0,
    devices: [], syncLog: [], quarantine: [], aiJobs: {}, aiCalls: 0, calls: [],
    props: { LEDGER_SEQ: 0, MASTER_REV: 0 }, cacheData: {}
  };
  var base = world.ports.store;
  function now() { return world.ports.clock.now(); }
  function copy(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
  function emit(evt) { (world.listeners || []).forEach(function (fn) { fn(evt); }); }
  function nextRev() { return ++server.props.MASTER_REV; }

  // The real gas_store stamps Rev/UpdatedAt in updateItem/addCustomer and Seq/ReceivedAt/DeviceID in
  // appendLedger; here the fake server does the same for the Telegram route, so phones learn about
  // owner edits made in Telegram and pull Telegram-route rows, and no row is ever edited afterwards.
  var origUpdateItem = base.updateItem, origAddCustomer = base.addCustomer, origAppendLedger = base.appendLedger;
  base.appendLedger = function (tx) {
    if (tx.seq === '' || tx.seq === null || tx.seq === undefined) {
      tx.seq = ++server.props.LEDGER_SEQ;
      tx.receivedAt = tx.receivedAt || now().toISOString();
      tx.deviceId = tx.deviceId || 'TG';
    }
    return origAppendLedger.call(base, tx);
  };
  base.updateItem = function (id, fields) {
    var f = copy(fields || {});
    if (f.rev === undefined) { f.rev = nextRev(); f.updatedAt = now().toISOString(); }
    return origUpdateItem.call(base, id, f);
  };
  base.addCustomer = function (c) {
    if (c && c.id) {
      var rec = { id: String(c.id), name: String(c.name || '').trim() || String(c.id), phone: c.phone || '', note: c.note || '',
                  createdAt: c.createdAt || now().toISOString(), rev: c.rev || nextRev(), updatedAt: c.updatedAt || now().toISOString() };
      world.customers.push(rec);
      emit({ type: 'customers' });
      return rec;
    }
    var made = origAddCustomer.call(base, c);
    made.rev = nextRev();
    made.updatedAt = now().toISOString();
    return made;
  };
  // Backfill at start, like backfillSync(): Rev 1 on masters without one.
  world.items.forEach(function (it) { if (!it.rev) { it.rev = 1; it.updatedAt = it.updatedAt || now().toISOString(); } });
  world.customers.forEach(function (c) { if (!c.rev) { c.rev = 1; c.updatedAt = c.updatedAt || now().toISOString(); } });
  if (server.props.MASTER_REV < 1) server.props.MASTER_REV = 1;

  var store = {
    ledgerRows: function () { return world.ledger; },
    getItem: function (id) { return base.getItem(id); },
    listItems: function (shop) { return base.listItems(shop); },
    updateItem: function (id, fields) { return base.updateItem(id, fields); },
    getCustomer: function (id) { return base.getCustomer(id); },
    listCustomers: function () { return base.listCustomers(); },
    addCustomer: function (c) { return base.addCustomer(c); },
    updateCustomer: function (id, fields) {
      for (var i = 0; i < world.customers.length; i++) {
        if (world.customers[i].id !== String(id)) continue;
        for (var k in fields) world.customers[i][k] = fields[k];
        emit({ type: 'customers' });
        return;
      }
    },
    getStaff: function (uid) { return base.getStaff(uid); },
    listStaff: function () { return base.listStaff(); },
    getSetting: function (k, d) { return base.getSetting(k, d); },
    getMessage: function (k) { return base.getMessage(k); },
    allSettings: function () { return copy(world.settings); },
    allMessages: function () { return copy(world.messages); },
    logError: function (where, err, updateId, payload) { return base.logError(where, err, updateId, payload); },
    logUnknownUser: function (from, updateId) { return base.logUnknownUser(from, updateId); }
    // refreshViews: absent, as in the simulator (no Credits tab to rewrite)
  };
  // The real server's sync store copies every gasStore method (gas_sync.js); this wrapper is written by hand, so
  // the round-4 methods are forwarded one by one, each only when the simulator store has it. A check that needs
  // a server without a method deletes the forward on server.ports.store and restores it afterwards.
  if (base.listOptions) store.listOptions = function (name) { return base.listOptions(name); };
  if (base.addListOption) store.addListOption = function (rec, seedRows) { return base.addListOption(rec, seedRows); };
  if (base.addDesign) store.addDesign = function (rec) { return base.addDesign(rec); };
  // Step 3 (spec 9.1): the measurement book. listMeasureFields gives the Settings their meas_fields_json, listAllMeasurements
  // feeds the measAfter pages of a pull, and a phone's measurement entry is applied with listMeasurements (the duplicate
  // rule), addMeasurement, and getOrder / updateOrder (the voucher link). getCustomer is forwarded above.
  if (base.listMeasureFields) store.listMeasureFields = function () { return base.listMeasureFields(); };
  if (base.listAllMeasurements) store.listAllMeasurements = function () { return base.listAllMeasurements(); };
  if (base.listMeasurements) store.listMeasurements = function (customerId) { return base.listMeasurements(customerId); };
  if (base.addMeasurement) store.addMeasurement = function (rec) { return base.addMeasurement(rec); };
  if (base.getOrder) store.getOrder = function (id) { return base.getOrder(id); };
  if (base.updateOrder) store.updateOrder = function (id, fields) { return base.updateOrder(id, fields); };
  // Round 6, revision 3: the owner's setting entry (Shops, the AI switch) writes one Settings value, like gasStore.setSetting.
  if (base.setSetting) store.setSetting = function (key, value) { return base.setSetting(key, value); };

  function findDevice(id) {
    for (var i = 0; i < server.devices.length; i++) if (server.devices[i].id === String(id)) return server.devices[i];
    return null;
  }
  var devices = {
    list: function () { return server.devices.map(copy); },
    get: function (id) { var d = findDevice(id); return d ? copy(d) : null; },
    create: function (rec) { server.devices.push(copy(rec)); emit({ type: 'devices' }); },
    update: function (id, fields) {
      var d = findDevice(id);
      if (!d) throw new Error('no device ' + id);
      for (var k in fields) d[k] = fields[k];
      emit({ type: 'devices' });
    },
    counters: function () { return { seq: server.props.LEDGER_SEQ, rev: server.props.MASTER_REV }; },
    setCounters: function (c) {
      if (c.seq !== undefined) server.props.LEDGER_SEQ = c.seq;
      if (c.rev !== undefined) server.props.MASTER_REV = c.rev;
    },
    nextSeq: function () { return ++server.props.LEDGER_SEQ; },
    nextRev: nextRev,
    nextLetter: function () { return syncNextLetter(server.devices); },
    mintCode: function (rec) { devices.create(rec); },
    verifyCode: function (codeHash, at) {
      var r = syncMatchEnrollCode(server.devices, codeHash, at);
      if (!r.match) (r.bump || []).forEach(function (id) {
        var d = findDevice(id);
        if (d) d.note = 'attempts=' + (syncAttemptsOf(d) + 1);
      });
      return r;
    }
  };

  var syncTabs = {
    appendRows: function (rows) {
      rows.forEach(function (r) { var c = copy(r); world.ledger.push(c); emit({ type: 'ledger', row: c }); });
    },
    stampSeq: function (list) {
      var byTx = {};
      list.forEach(function (s) { byTx[s.txId] = s; });
      world.ledger.forEach(function (r) {
        var s = byTx[r.txId];
        if (!s) return;
        r.seq = s.seq;
        r.receivedAt = s.receivedAt || r.receivedAt || '';
        r.deviceId = s.deviceId || r.deviceId || 'TG';
      });
    },
    quarantine: function (q) { server.quarantine.push(copy(q)); emit({ type: 'quarantine', row: q }); },
    log: function (l) { server.syncLog.push(copy(l)); emit({ type: 'synclog', row: l }); },
    aiJob: function (id, rec) {
      if (rec === undefined) return server.aiJobs[id] ? copy(server.aiJobs[id]) : null;
      server.aiJobs[id] = copy(rec);
    }
  };

  var sp = {
    store: store, devices: devices, sync: syncTabs,
    cache: {
      get: function (k) { var e = server.cacheData[k]; if (!e) return null; if (e.exp < now().getTime()) { delete server.cacheData[k]; return null; } return e.v; },
      put: function (k, v, ttl) { server.cacheData[k] = { v: v, exp: now().getTime() + (ttl || 600) * 1000 }; },
      remove: function (k) { delete server.cacheData[k]; }
    },
    hash: simSha256Hex,
    clock: { now: now },
    uuid: simUuid,
    lock: { run: function (fn) { return fn(); } }
  };

  // Platform work: the mock AI stands in for Gemini, the world's chat for Telegram, the sim pdf for the export.
  var hooks = {
    ai: function (job, device) {
      // Round 6, revision 3, as gas_sync.js: two kinds that are not AI come first (no Gemini call, no outage, not counted in
      // aiCalls). sketch: the drawing's picture, for the session the phone's entry became (else no_session), written into
      // its photoUrl; pic: a new piece's photo while AI is off (an unknown item: no_item), written into the item's photoUrl.
      if (job.kind === 'sketch') {
        var meas = null;
        world.measurements.forEach(function (m) { if (job.entryId && String(m.entryId || '') === String(job.entryId)) meas = m; });
        if (!meas) throw new Error('no_session');
        meas.photoUrl = 'sim://figure/' + meas.id;
        emit({ type: 'measurements' });
        return { photoUrl: meas.photoUrl };
      }
      if (job.kind === 'pic') {
        if (!job.itemId || !base.getItem(job.itemId)) throw new Error('no_item');
        var pic = 'sim://photo/' + job.itemId;
        base.updateItem(job.itemId, { photoUrl: pic });
        return { photoUrl: pic };
      }
      server.aiCalls++;
      if (world.aiFail) throw new Error('Gemini 503: simulated outage');
      var file = job.sim || { text: job.text !== undefined ? job.text : job.data };
      if (job.kind === 'voice' || job.kind === 'text') {
        var out = mockParseIntent(file.text !== undefined ? file.text : job.text, job.ctx || {});
        world.log.push({ kind: 'ai', input: file.text, output: out, device: device.id });
        return { intent: out };
      }
      if (job.kind === 'photo') {
        var url = 'drive://POS Photos/' + (job.itemId || job.id) + '.jpg', desc = mockDescribePhoto(file, job.ctx || {});
        var cur = job.itemId ? base.getItem(job.itemId) : null;
        if (cur) {
          // As gas_sync saves to Drive: the URL and, for a piece still named by its placeholder, the AI's name and category,
          // in ONE write (one Rev bump), so the phone's own rename reaches this server as a dup (spec 6.2).
          // Round 6b: the job's own list decides the category, as on the phone that replays it.
          var f = { photoUrl: url }, ren = aiRenameFields(cur, desc, itemCategoryCats(job.ctx, sp, cur.shop));
          if (ren) { f.name = ren.name; if (ren.category) f.category = ren.category; }
          base.updateItem(job.itemId, f);
        }
        return { desc: desc, photoUrl: url, thumb: '' };
      }
      if (job.kind === 'notebook') return { lines: mockReadNotebook(file, job.ctx || {}) };
      throw new Error('unknown ai job kind ' + job.kind);
    },
    photo: function (ids) {
      var out = {};
      ids.forEach(function (id) { var it = base.getItem(id); out[id] = it && it.photoFileId ? 'thumb:' + id : null; });
      return out;
    },
    report: function (report, device, inline) {
      var doc = world.ports.pdf.make(report);
      if (inline) return { sentTo: 'inline', pdf: 'base64:' + doc.name, fileName: doc.name };
      var r = world.ports.chat.sendDocument(device.staffId, doc, t(world.ports, 'rep_caption', { title: report.title }));
      return { sentTo: 'telegram', messageId: r.messageId };
    },
    relay: function (n) { world.ports.chat.sendMessage(n.to, n.text, n.kb || []); },
    ping: function (ownerId, text, kb) { world.ports.chat.sendMessage(ownerId, text, kb || []); }
  };

  function wire(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }   // like a network: no shared references

  /** What gasSyncHandle would answer, as a plain object (null when the reply was dropped). */
  server.handle = function (api, body) {
    server.calls.push({ api: api, at: now().toISOString(), latencyMs: server.latencyMs, device: body && body.device });
    if (server.down) throw new Error('network: server unreachable');
    var res = syncHandle(sp, api, wire(body), now(), hooks);
    if (server.dropResponse) { server.dropResponse = false; return null; }
    return wire(res);
  };
  /** transport(api, body) for phones. */
  server.transport = function (api, body) { return server.handle(api, body); };
  /** The Telegram side's 📲 button: a one-time code for a staff member. */
  server.mintEnrollCode = function (staff, label) {
    return syncMintCode(sp, { id: String(staff.id), shop: staff.shop || 'S1', role: staff.role || 'staff' }, label || staff.name || '', now());
  };
  /** Transport B: the exported outbox document shared to the bot by `staff`. */
  server.ingestDocument = function (text, staff) {
    return syncIngestDocument(sp, text, { id: String(staff.id) }, now(), hooks);
  };
  server.summaryLines = function (at) { return syncSummaryLines(sp, at || now()); };
  server.devicesText = function () {
    return syncDevicesText(world.ports, server.devices.map(function (d) { return syncSanitizeDevice(sp, d); }));
  };
  /** {text, kb} as the owner sees it in Telegram, and a DV| button applied; same core functions as gas_sync.js. */
  server.devicesReply = function () { return syncDevicesReply(sp, world.ports); };
  server.deviceAction = function (deviceId, action) { syncDeviceAction(sp, deviceId, action, now()); return syncDevicesReply(sp, world.ports); };
  // ports.sync for the Telegram route (what gasSyncBotPort() is in gas_main.js): 📲 button, /devices, DV| buttons.
  world.ports.sync = {
    mintCode: function (staff, label) {
      var minted = server.mintEnrollCode(staff, label);
      minted.text = t(world.ports, 'app_enroll_code', { code: minted.display });
      return minted;
    },
    devicesText: server.devicesReply,
    deviceAction: server.deviceAction
  };
  server.stock = function (itemId) {
    var s = 0;
    world.ledger.forEach(function (r) { if (r.itemId === itemId) s += Number(r.qty) || 0; });
    return s;
  };
  server.ports = sp;
  server.hooks = hooks;
  syncStampMissingSeq(sp, now(), 'TG');   // the seed rows, as backfillSync() does once after the paste
  return server;
}

/* ------------------------------ SHA-256 (sync, ES5) so the sim needs no crypto library ------------------------------ */

var SIM_SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function simUtf8Bytes(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      var c2 = s.charCodeAt(++i), cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function simSha256Hex(text) {
  var bytes = simUtf8Bytes(String(text)), len = bytes.length;
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  var hi = Math.floor(len / 0x20000000), lo = (len * 8) >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  var w = new Array(64);
  for (var i = 0; i < bytes.length; i += 64) {
    var j;
    for (j = 0; j < 16; j++) w[j] = (bytes[i + 4 * j] << 24) | (bytes[i + 4 * j + 1] << 16) | (bytes[i + 4 * j + 2] << 8) | bytes[i + 4 * j + 3];
    for (j = 16; j < 64; j++) {
      var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (j = 0; j < 64; j++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + SIM_SHA_K[j] + w[j]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map(function (x) { var s = (x >>> 0).toString(16); while (s.length < 8) s = '0' + s; return s; }).join('');
}
