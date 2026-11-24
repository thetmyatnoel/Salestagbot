/**
 * poc/sim_ports.js — in-memory implementations of every port the core needs,
 * plus helpers that build Telegram-shaped updates. Runs in Node and the browser.
 * Replace with gas_*.js in production; the core never knows the difference.
 */
function createSimWorld() {
  var world = {
    items: [], ledger: [], staff: [], customers: [], settings: {}, messages: {}, errors: [], chats: {}, files: {},
    cacheData: {}, listeners: [], nextMsgId: 1, nextUpdateId: 1, nextFileId: 1, nowOverride: null,
    // The demo clock of the simulator page is an OFFSET on the real clock (⏩ +1 ရက်, 🕘 21:00 add to it), so later
    // rows, TTLs and the frames' learned server offset keep moving; the suites freeze time with nowOverride instead.
    clockOffsetMs: 0,
    aiFail: false, log: [], views: null,
    // Custom tailoring tabs (gas_store.js keeps the same shapes): Orders, OrderItems, Measurements, Designs, and
    // MeasureFields seeded from the CFG list the way setupSheet() seeds the tab (the family renames or hides rows there).
    orders: [], orderItems: [], measurements: [], designs: [],
    measureFields: CFG.MEASURE_FIELDS.map(function (f, i) {
      return { key: f[0], labelMy: f[1], labelEn: f[2], group: f[3], multi: f[4], type: f[5], order: i + 1, active: true };
    }),
    // The Lists tab (round 4): one row per option {list, key, label, active, order, shop, detail, note}. Empty until
    // simSeedLists(world) fills it the way setupSheet() seeds the tab; while it is empty the core reads the old
    // Settings rows (legacyListRows), which is the path poc/run_scenario.js keeps testing.
    lists: []
  };
  function now() { return world.nowOverride ? new Date(world.nowOverride.getTime()) : new Date(Date.now() + (world.clockOffsetMs || 0)); }
  function emit(evt) { world.listeners.forEach(function (fn) { fn(evt); }); }
  function stockOf(id) {
    var s = 0;
    world.ledger.forEach(function (r) { if (r.itemId === id) s += Number(r.qty) || 0; });
    return s;
  }
  function viewItem(raw) {
    var stock = stockOf(raw.id);
    var status = !raw.name ? CFG.STATUS.BLANK
      : (raw.type === CFG.ITEM_TYPE.UNIQUE && stock <= 0 ? CFG.STATUS.SOLD : CFG.STATUS.ACTIVE);
    var v = {};
    for (var k in raw) v[k] = raw[k];
    v.stock = stock;
    v.status = status;
    v.sample = !!raw.sample;
    v.alias = raw.alias || '';
    return v;
  }
  function rawItem(id) {
    for (var i = 0; i < world.items.length; i++) if (world.items[i].id === id) return world.items[i];
    return null;
  }
  function copyOf(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
  function rawOrder(id) {
    for (var i = 0; i < world.orders.length; i++) if (world.orders[i].id === String(id)) return world.orders[i];
    return null;
  }
  function rawOrderItem(orderId, line) {
    for (var i = 0; i < world.orderItems.length; i++) {
      var l = world.orderItems[i];
      if (l.orderId === String(orderId) && Number(l.line) === Number(line)) return l;
    }
    return null;
  }
  /** A measurement as gas_store reads it back: every value a string ('36/30/20', '17.5'), blanks ''. */
  function measView(m) {
    var c = copyOf(m), f = {};
    Object.keys(m.fields || {}).forEach(function (k) { var v = m.fields[k]; f[k] = v === undefined || v === null ? '' : String(v); });
    c.fields = f;
    return c;
  }

  var store = {
    getItem: function (id) { var r = rawItem(String(id)); return r ? viewItem(r) : null; },
    listItems: function (shop) {
      return world.items.filter(function (r) { return !shop || r.shop === shop; }).map(viewItem);
    },
    updateItem: function (id, fields) {
      var r = rawItem(id);
      if (!r) throw new Error('updateItem: no item ' + id);
      for (var k in fields) r[k] = fields[k];
      emit({ type: 'items' });
    },
    appendLedger: function (tx) {
      var copy = {};
      for (var k in tx) copy[k] = tx[k];
      world.ledger.push(copy);
      emit({ type: 'ledger', row: copy });
    },
    ledgerRows: function () { return world.ledger.slice(); },
    getStaff: function (uid) {
      for (var i = 0; i < world.staff.length; i++) {
        var s = world.staff[i];
        if (String(s.id) === String(uid) && s.active !== false) return { id: String(s.id), name: s.name, shop: s.shop, shops: s.shops, active: s.active !== false, role: s.role || 'staff' };
      }
      return null;
    },
    listStaff: function (includeInactive) {
      return world.staff.filter(function (s) { return includeInactive || s.active !== false; })
        .map(function (s) { return { id: String(s.id), name: s.name, shop: s.shop, shops: s.shops, active: s.active !== false, role: s.role || 'staff' }; });
    },
    getCustomer: function (id) {
      for (var i = 0; i < world.customers.length; i++) if (world.customers[i].id === String(id)) return world.customers[i];
      return null;
    },
    listCustomers: function () { return world.customers.slice(); },
    addCustomer: function (c) {
      var id = 'C-' + ('0000' + (world.customers.length + 1)).slice(-4);
      var rec = { id: id, name: String(c.name || '').trim() || id, phone: c.phone || '', note: c.note || '', createdAt: now().toISOString() };
      world.customers.push(rec);
      emit({ type: 'customers' });
      return rec;
    },
    /** Master data in place (phone, note, name), like gasStore.updateCustomer. */
    updateCustomer: function (id, fields) {
      var c = store.getCustomer(id);
      if (!c) throw new Error('updateCustomer: no customer ' + id);
      for (var k in fields) c[k] = fields[k];
      emit({ type: 'customers' });
    },
    /**
     * The Credits, Deposits and Customers F:K views as the Sheet would hold them. Only the summary
     * part of a customer is a view; A:E (name, phone, note) is never touched here.
     */
    refreshViews: function (credits, deposits, customers) {
      world.views = { credits: credits, deposits: deposits, customers: customers || [], argc: arguments.length, at: now().toISOString() };
      emit({ type: 'views' });
    },
    /* ---------- custom tailoring (core_orders.js); same shapes and behaviour as gas_store.js ---------- */
    getOrder: function (id) { var o = rawOrder(id); return o ? copyOf(o) : null; },
    /** Orders of a shop (null = all) and status (null = any), in the order they were written. */
    listOrders: function (shop, status) {
      return world.orders.filter(function (o) { return (!shop || o.shop === shop) && (!status || o.status === status); }).map(copyOf);
    },
    addOrder: function (rec) {
      var o = copyOf(rec);
      o.id = String(o.id);
      world.orders.push(o);
      emit({ type: 'orders' });
      return copyOf(o);
    },
    updateOrder: function (id, fields) {
      var o = rawOrder(id);
      if (!o) throw new Error('updateOrder: no order ' + id);
      for (var k in fields) if (k !== 'id') o[k] = fields[k] === null || fields[k] === undefined ? '' : fields[k];
      emit({ type: 'orders' });
    },
    /**
     * The next voucher of the shop's paper series, under the lock: Settings order_next_no_<shop> is the number to
     * issue (never below an id already used), written back + 1. V1-2532, V2-0101.
     */
    nextOrderNo: function (shop) {
      return world.ports.lock.run(function () {
        var key = 'order_next_no_' + shop, n = Math.round(Number(world.settings[key])) || 0, max = 0;
        world.orders.forEach(function (o) {
          var m = o.shop === shop && String(o.id).match(/^V\d-(\d+)$/);
          if (m) max = Math.max(max, Number(m[1]));
        });
        if (n <= max) n = max + 1;
        if (n < 1) n = 1;
        world.settings[key] = n + 1;
        emit({ type: 'settings' });
        return orderIdFor(shop, n);
      });
    },
    /** Lines of one order (null = every order's), in the order they were written. */
    listOrderItems: function (orderId) {
      return world.orderItems.filter(function (l) { return !orderId || l.orderId === String(orderId); }).map(copyOf);
    },
    addOrderItem: function (rec) {
      var l = copyOf(rec);
      l.orderId = String(l.orderId);
      l.line = Number(l.line);
      world.orderItems.push(l);
      emit({ type: 'orders' });
      return copyOf(l);
    },
    updateOrderItem: function (orderId, line, fields) {
      var l = rawOrderItem(orderId, line);
      if (!l) throw new Error('updateOrderItem: no line ' + orderId + '-' + line);
      for (var k in fields) if (k !== 'orderId' && k !== 'line') l[k] = fields[k] === null || fields[k] === undefined ? '' : fields[k];
      emit({ type: 'orders' });
    },
    /** OrderItems is master data (like Items), not the ledger: a line removed while the order is written is gone. */
    removeOrderItem: function (orderId, line) {
      var l = rawOrderItem(orderId, line);
      if (l) world.orderItems.splice(world.orderItems.indexOf(l), 1);
      emit({ type: 'orders' });
    },
    listDesigns: function () { return world.designs.map(copyOf); },
    /** By code, or by alias: TSL-18, tsl18 and TSL-0018 are the same design. */
    getDesign: function (code) {
      var want = String(code || '').trim(), key = normDesignCode(want), i;
      for (i = 0; i < world.designs.length; i++) if (world.designs[i].code === want) return copyOf(world.designs[i]);
      if (!key) return null;
      for (i = 0; i < world.designs.length; i++) if (normDesignCode(world.designs[i].code) === key) return copyOf(world.designs[i]);
      return null;
    },
    listMeasureFields: function () { return world.measureFields.map(copyOf); },
    /**
     * A new row (never an edit): MeasID M-00001, values kept as text. Returns the stored record. Every field of rec is
     * kept, entryId among them (a session from a phone's form: the sync server's duplicate rule, like gasStore's EntryID)
     * and sketch (round 6, revision 3: the drawing on the figure, like gasStore's Sketch column).
     */
    addMeasurement: function (rec) {
      return world.ports.lock.run(function () {
        var m = copyOf(rec);
        var maxNo = 0;
        world.measurements.forEach(function (x) { var n = String(x.id).match(/^M-(\d+)$/); if (n) maxNo = Math.max(maxNo, Number(n[1])); });
        m.id = 'M-' + ('00000' + (maxNo + 1)).slice(-5);
        m.fields = {};
        Object.keys(rec.fields || {}).forEach(function (k) { var v = rec.fields[k]; m.fields[k] = v === undefined || v === null ? '' : String(v); });
        world.measurements.push(m);
        emit({ type: 'measurements' });
        return measView(m);
      });
    },
    getMeasurement: function (id) {
      for (var i = 0; i < world.measurements.length; i++) if (world.measurements[i].id === String(id)) return measView(world.measurements[i]);
      return null;
    },
    /** One customer's sessions, oldest first (the newest is the last). */
    listMeasurements: function (customerId) {
      return world.measurements.filter(function (m) { return !customerId || m.customerId === String(customerId); }).map(measView);
    },
    /** Every session of every customer, oldest first, like gasStore.listAllMeasurements (the sync server pages them by MeasID). */
    listAllMeasurements: function () { return world.measurements.map(measView); },
    /**
     * A new Designs row {code, name, category, basePrice, daysToMake, active, note}, like gasStore.addDesign. When
     * getDesign already finds the code (TSL-18, tsl18 and TSL-0018 are one design) nothing is written. Returns the
     * stored design in the shape getDesign returns, for a new row and for an existing code alike.
     */
    addDesign: function (rec) {
      return world.ports.lock.run(function () {
        var code = String((rec && rec.code) || '').trim();
        if (!code) throw new Error('addDesign: no code');
        var have = store.getDesign(code);
        if (have) return have;
        var num = function (v) { var n = Number(v); return v === '' || v === null || v === undefined || isNaN(n) ? '' : n; };
        world.designs.push({
          code: code, name: String(rec.name || ''), category: String(rec.category || ''), photoUrl: '', photoFileId: '',
          basePrice: num(rec.basePrice), daysToMake: num(rec.daysToMake), active: rec.active !== false, note: String(rec.note || '')
        });
        emit({ type: 'designs' });
        return store.getDesign(code);
      });
    },
    /* ---------- option lists (core_ledger.js listRows, listUpsert); the contract gas_store.js follows ---------- */
    /**
     * Every row of one list (active or not) in sheet order, as the Lists tab gives it: a row with a blank Key is
     * skipped, a blank Active counts as true, a blank or non-numeric Order is 0 (never '', NaN or Infinity),
     * Key, Label, Detail and Note are strings. [] when the list has no rows.
     */
    listOptions: function (name) {
      var str = function (v) { return v === null || v === undefined ? '' : String(v); };
      return world.lists.filter(function (r) { return r && r.list === name && str(r.key) !== ''; }).map(function (r) {
        var a = r.active, o = typeof r.order === 'number' || typeof r.order === 'string' ? Number(r.order) : 0;
        var row = {
          list: name, key: str(r.key), label: str(r.label),
          active: a === '' || a === null || a === undefined ? true : (a === true || /^(true|1|yes)$/i.test(String(a))),
          order: isFinite(o) ? o : 0, shop: str(r.shop), detail: str(r.detail), note: str(r.note)
        };
        // Kind (round 5) only when the raw row has one: a row without it keeps the eight-field shape, like the Sheet's.
        if (str(r.kind) !== '') row.kind = str(r.kind);
        return row;
      });
    },
    /**
     * A hand edit of one Lists row from the simulator's laptop (sim-only): label, active (boolean), order, shop, detail
     * and kind as given, the row found by its normalised key; a no-op on an unknown key. Emits {type: 'lists'}.
     */
    setListRow: function (name, key, fields) {
      var want = listNormKey(name, key), allowed = ['label', 'active', 'order', 'shop', 'detail', 'kind'];
      for (var i = 0; i < world.lists.length; i++) {
        var r = world.lists[i];
        if (!r || r.list !== name || listNormKey(name, r.key) !== want) continue;
        allowed.forEach(function (f) { if (fields && Object.prototype.hasOwnProperty.call(fields, f)) r[f] = fields[f]; });
        emit({ type: 'lists' });
        return;
      }
    },
    /**
     * Add an option, or set an account's detail, by the one upsert rule (core_ledger.js listUpsert): read the rows of
     * rec.list, persist the ops the rule answers, return {status: 'ok' | 'dup', key}. seedRows (what the user sees
     * today) is written first while the list is still empty. Under the lock, like gasStore.addListOption.
     */
    addListOption: function (rec, seedRows) {
      return world.ports.lock.run(function () {
        var name = String((rec && rec.list) || '');
        var res = listUpsert(store.listOptions(name), rec, seedRows);
        res.ops.forEach(function (op) {
          if (op.op === 'append') { world.lists.push(copyOf(op.row)); return; }
          for (var i = 0; i < world.lists.length; i++) {
            var r = world.lists[i];
            if (r && r.list === name && listNormKey(name, r.key) === op.key) { r[op.field] = op.value; break; }
          }
        });
        if (res.ops.length) emit({ type: 'lists' });
        return { status: res.status, key: res.key };
      });
    },
    getSetting: function (k, d) { return Object.prototype.hasOwnProperty.call(world.settings, k) ? world.settings[k] : d; },
    /**
     * One Settings value, as gasStore.setSetting writes it (round 6, revision 3: the owner's Shops screen and AI switch
     * through a phone's setting entry): stored as text, the way the Sheet's plain-text cell keeps it. Emits {type: 'settings'}.
     */
    setSetting: function (k, v) {
      world.settings[String(k)] = String(v === null || v === undefined ? '' : v);
      emit({ type: 'settings' });
    },
    getMessage: function (k) { return world.messages[k] || null; },
    logError: function (where, err, updateId, payload) {
      world.errors.push({ time: now().toISOString(), where: where, message: err && err.message ? err.message : String(err), updateId: updateId || '', payload: payload || '' });
      emit({ type: 'errors' });
    },
    logUnknownUser: function (from, updateId) {
      world.errors.push({ time: now().toISOString(), where: 'unknown_user', message: 'Not in Staff tab: ' + from.id + ' (' + (from.first_name || '') + ')', updateId: updateId || '', payload: JSON.stringify(from) });
      emit({ type: 'errors' });
    }
  };

  function pushMsg(chatId, m) {
    m.id = world.nextMsgId++;
    m.chatId = chatId;
    m.ts = now().toISOString();
    (world.chats[chatId] = world.chats[chatId] || []).push(m);
    emit({ type: 'chat', chatId: chatId, message: m });
    return m;
  }
  var chat = {
    sendMessage: function (chatId, text, keyboard) {
      var m = pushMsg(chatId, { from: 'bot', text: text, keyboard: keyboard || [] });
      return { messageId: m.id };
    },
    sendPhoto: function (chatId, photo, caption, keyboard) {
      var m = pushMsg(chatId, { from: 'bot', text: caption, photo: photo, keyboard: keyboard || [] });
      return { messageId: m.id };
    },
    sendDocument: function (chatId, doc, caption) {
      var m = pushMsg(chatId, { from: 'bot', text: caption || '', document: doc, keyboard: [] });
      return { messageId: m.id };
    },
    editMessage: function (chatId, messageId, text, keyboard) {
      var list = world.chats[chatId] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === messageId) {
          list[i].text = text;
          list[i].keyboard = keyboard || [];
          list[i].edited = true;
          emit({ type: 'chat', chatId: chatId, message: list[i], edited: true });
          return;
        }
      }
    },
    answerCallback: function (id) { world.lastCallbackAnswered = id; },
    typing: function () {},
    getFile: function (fileId) { return world.files[fileId] || {}; },
    savePhoto: function (fileId, name) { return 'drive://POS Photos/' + name + '.jpg'; }
  };

  var cache = {
    get: function (k) {
      var e = world.cacheData[k];
      if (!e) return null;
      if (e.exp < now().getTime()) { delete world.cacheData[k]; return null; }
      return e.v;
    },
    put: function (k, v, ttl) { world.cacheData[k] = { v: v, exp: now().getTime() + (ttl || 600) * 1000 }; },
    remove: function (k) { delete world.cacheData[k]; }
  };
  var ai = {
    parseVoice: function (file, ctx) {
      if (world.aiFail) throw new Error('Gemini 503: simulated outage');
      var out = mockParseIntent(file.text, ctx);
      world.log.push({ kind: 'ai', input: file.text, output: out });
      return out;
    },
    parseText: function (text, ctx) {
      if (world.aiFail) throw new Error('Gemini 503: simulated outage');
      var out = mockParseIntent(text, ctx);
      world.log.push({ kind: 'ai', input: text, output: out });
      return out;
    },
    describePhoto: function (file, ctx) {
      if (world.aiFail) throw new Error('Gemini 503: simulated outage');
      return mockDescribePhoto(file, ctx);
    },
    readNotebook: function (file, ctx) {
      if (world.aiFail) throw new Error('Gemini 503: simulated outage');
      var out = mockReadNotebook(file, ctx);
      world.log.push({ kind: 'ai', input: 'notebook photo', output: out });
      return out;
    },
    /** A filled measurement sheet: {fields: {key: 'text'}, low_confidence: [keys], name, notes} like gasAi.readMeasurementSheet. */
    readMeasurementSheet: function (file, ctx) {
      if (world.aiFail) throw new Error('Gemini 503: simulated outage');
      var out = mockReadMeasurementSheet(file, ctx);
      world.log.push({ kind: 'ai', input: 'measurement sheet photo', output: out });
      return out;
    }
  };
  var pdf = {
    make: function (report) { return { name: report.fileName + '.pdf', report: report }; }
  };

  var processed = [];
  world.ports = {
    store: store, chat: chat, cache: cache, ai: ai, pdf: pdf,
    lock: { run: function (fn) { return fn(); } },
    clock: { now: now },
    uuid: simUuid,
    // The app's 📲 / /devices / DV| port: null here (the bot then says app_not_ready); createFakeServer (sim_sync.js)
    // replaces it with the fake sync server's port when a test or page creates one.
    sync: null,
    dedupe: {
      seen: function (id) { return processed.indexOf(String(id)) >= 0; },
      remember: function (id) { processed.push(String(id)); if (processed.length > 400) processed.shift(); }
    }
  };

  /* ---------- helpers that act like a person using Telegram ---------- */
  function from(user) { return { id: user.id, first_name: user.name, is_bot: false }; }
  function deliver(update) {
    var res = processUpdate(update, world.ports);
    emit({ type: 'update', update: update, result: res });
    return res;
  }
  function unix() { return Math.floor(now().getTime() / 1000); }
  function userMsg(user, fields) {
    var m = { from: 'user', user: user.name };
    for (var k in fields) m[k] = fields[k];
    return pushMsg(user.id, m);
  }
  world.sim = {
    start: function (user, payload) {
      var text = '/start' + (payload ? ' ' + payload : '');
      var m = userMsg(user, { text: text, scan: payload || null });
      return deliver({ update_id: world.nextUpdateId++, message: { message_id: m.id, from: from(user), chat: { id: user.id, type: 'private' }, date: unix(), text: text } });
    },
    text: function (user, text) {
      var m = userMsg(user, { text: text });
      return deliver({ update_id: world.nextUpdateId++, message: { message_id: m.id, from: from(user), chat: { id: user.id, type: 'private' }, date: unix(), text: text } });
    },
    voice: function (user, spoken) {
      var fid = 'voice_' + world.nextFileId++;
      world.files[fid] = { text: spoken, mimeType: 'audio/ogg' };
      var m = userMsg(user, { voice: spoken });
      return deliver({ update_id: world.nextUpdateId++, message: { message_id: m.id, from: from(user), chat: { id: user.id, type: 'private' }, date: unix(), voice: { file_id: fid, duration: 3, mime_type: 'audio/ogg' } } });
    },
    photo: function (user, preset, caption) {
      var fid = 'photo_' + world.nextFileId++;
      world.files[fid] = { meta: preset, visual: preset.visual, mimeType: 'image/jpeg' };
      var m = userMsg(user, { photo: fid, text: caption || '' });
      var msg = { message_id: m.id, from: from(user), chat: { id: user.id, type: 'private' }, date: unix(), photo: [{ file_id: fid, width: 320, height: 320 }, { file_id: fid, width: 1280, height: 1280 }] };
      if (caption) msg.caption = caption;
      return deliver({ update_id: world.nextUpdateId++, message: msg });
    },
    tap: function (user, messageId, data) {
      var list = world.chats[user.id] || [], target = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === messageId) target = list[i];
      if (!target) throw new Error('tap: no message ' + messageId);
      var message = { message_id: messageId, chat: { id: user.id, type: 'private' }, date: unix(), text: target.text };
      if (target.photo) message.photo = [{ file_id: target.photo }];
      return deliver({ update_id: world.nextUpdateId++, callback_query: { id: 'cq' + world.nextUpdateId, from: from(user), message: message, data: data } });
    },
    replay: function (update) { return deliver(update); },
    lastBot: function (user) {
      var list = world.chats[user.id] || [];
      for (var i = list.length - 1; i >= 0; i--) if (list[i].from === 'bot') return list[i];
      return null;
    },
    /** Last bot message whose text or buttons contain the label. */
    lastBotWith: function (user, label) {
      var list = world.chats[user.id] || [];
      for (var i = list.length - 1; i >= 0; i--) {
        var m = list[i];
        if (m.from !== 'bot') continue;
        if ((m.text || '').indexOf(label) >= 0 || world.sim.button(m, label)) return m;
      }
      return null;
    },
    /** Find a button whose label contains `label` on a message; returns callback_data. */
    button: function (message, label) {
      var rows = (message && message.keyboard) || [];
      for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c].text.indexOf(label) >= 0) return rows[r][c].callback_data;
      }
      return null;
    },
    /** Tap the button containing `label` on the last bot message for this user. */
    tapLast: function (user, label) {
      var m = world.sim.lastBot(user), data = world.sim.button(m, label);
      if (!data) throw new Error('no button "' + label + '" on: ' + (m && m.text));
      return world.sim.tap(user, m.id, data);
    },
    /**
     * The label rule (round 5): a MSG key names a button whose text contains t(key) up to its first '{', trimmed
     * ('✅ အကုန် {amount}' -> '✅ အကုန်'), because an unfilled template never matches a filled button. Throws when that
     * prefix is empty (btn_days '{n} ရက်' starts with '{': such a key can only be a callback target). Returns callback_data or null.
     */
    buttonByKey: function (message, key) {
      var prefix = msgTemplate(world.ports, key).split('{')[0].trim();
      if (!prefix) throw new Error('buttonByKey: the text of ' + key + ' starts with a placeholder');
      return world.sim.button(message, prefix);
    },
    /** Tap the button the MSG key names (the label rule) on the last bot message for this user. */
    tapLastByKey: function (user, key) {
      var m = world.sim.lastBot(user), data = world.sim.buttonByKey(m, key);
      if (!data) throw new Error('no button for key "' + key + '" on: ' + (m && m.text));
      return world.sim.tap(user, m.id, data);
    },
    /** Tap the button containing `label` on the most recent bot message that has it. */
    tapAny: function (user, label) {
      var m = world.sim.lastBotWith(user, label), data = m && world.sim.button(m, label);
      if (!data) throw new Error('no recent button "' + label + '"');
      return world.sim.tap(user, m.id, data);
    }
  };
  return world;
}

function simUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}
