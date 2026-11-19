/**
 * app/app_ports.js — the ports object core_bot.js expects, on the phone.
 *
 * createAppPhone(opts) -> phone. phone.ports runs the unchanged core (processUpdate) against the
 * durable store of app_store.js:
 *   store  the LOCAL STORE CONTRACT (items, customers, ledger with an incremental stock map, outbox)
 *   chat   renders into the persisted local message list; a message to any other chat id (notifyOwners)
 *          becomes an outbox notice the server relays through Telegram
 *   ai     a queue: parseVoice/parseText/describePhoto/readNotebook record a job and throw a PendingAi
 *          error, so the core falls back to buttons while the chat shows ⏳ instead of ai_down
 *   pdf    a server job: make(report) returns the on-screen table at once; the PDF itself is made by
 *          api=report on the server (app_sync.requestReport) and sent to Telegram
 *   cache  persisted with TTL (per-user state survives an app restart)
 *   lock   collects the rows appended inside one run() into one outbox group
 *   clock  the phone's wall clock plus the offset learned from the server, so Day is right offline
 *   uuid   crypto.randomUUID with a fallback;  dedupe over the local synthetic update ids
 *   ui     screens the app draws itself: ui.measureForm(req) emits 'measureform' (the measurement form, app_ui.js);
 *          round 6: ui.openForm(kind, req) emits 'openform' (the sale, new-piece, restock and expense forms,
 *          app_forms.js) and ui.openScreen(name, req) emits 'openscreen' (the buyers, buyer and receipt pages,
 *          app_screens.js). The core sends nothing when it calls them.
 *   The chat port takes an optional last argument extra (round 6, revision 3, spec 13.9): the stored message gets
 *   m.view = extra.view (the app draws that view instead of the text); an edit without one drops it.
 *
 * deliver(update) runs the core synchronously, then commits every write in one transaction and only
 * then emits 'change', so the UI paints the ✅ after the write is durable. Deliveries are serialized.
 * sim.* helpers build the same Telegram-shaped updates poc/sim_ports.js builds (adapted from
 * poc/sim_phone.js, same project), for the UI, the dev page and the Node tests.
 * Plain ES5: var and function only.
 */
function appUuid() {
  var c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') { try { return c.randomUUID(); } catch (ignore) {} }
  var bytes = null;
  if (c && typeof c.getRandomValues === 'function' && typeof Uint8Array !== 'undefined') {
    try { bytes = new Uint8Array(16); c.getRandomValues(bytes); } catch (ignore) { bytes = null; }
  }
  if (!bytes) {
    bytes = [];
    for (var i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256));
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  var hex = '';
  for (var k = 0; k < 16; k++) hex += (bytes[k] < 16 ? '0' : '') + bytes[k].toString(16);
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function appPendingAiError(job) {
  var e = new Error('PendingAi: job ' + job.id + ' queued until the phone is online');
  e.name = 'PendingAi';
  e.pending = true;
  e.job = job;
  return e;
}

function createAppPhone(opts) {
  opts = opts || {};
  var adapter = opts.adapter || createMemoryAdapter();
  var baseClock = opts.clock || function () { return new Date(); };
  var phone = {
    name: opts.name || 'app', platform: opts.platform || 'web', adapter: adapter, online: true,
    clockErrorMs: opts.clockErrorMs || 0, transport: opts.transport || null, pendingAi: null, log: [],
    ready: false, listeners: {}, chain: Promise.resolve(), lastCallbackAnswered: null
  };
  /** The phone's own clock, possibly wrong. Sent as clientTime so the server can measure the skew. */
  function wallClock() { return new Date(baseClock().getTime() + phone.clockErrorMs); }
  /** What the core sees: wall clock plus the offset learned from the server. */
  function now() { return new Date(wallClock().getTime() + (store.meta.offsetMs || 0)); }
  var store = createAppStore(adapter, { now: now });
  phone.store = store;
  phone.now = now;
  phone.wallClock = wallClock;
  function staffId() { return store.meta.staff ? String(store.meta.staff.id) : null; }
  phone.staffId = staffId;
  function noop() {}

  /* ---------- events ---------- */
  phone.on = function (name, fn) { (phone.listeners[name] = phone.listeners[name] || []).push(fn); return fn; };
  phone.off = function (name, fn) {
    var list = phone.listeners[name] || [];
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  function emit(name, payload) {
    (phone.listeners[name] || []).slice().forEach(function (fn) {
      try { fn(payload); } catch (err) { try { store.ports.logError('listener:' + name, err, '', ''); } catch (ignore) {} }
    });
  }
  phone.emit = emit;

  /* ---------- chat ---------- */
  function botSay(text, kb, extra) {
    var m = { from: 'bot', text: text, keyboard: kb || [], system: true };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) m[k] = extra[k];
    return store.pushChat(m);
  }
  phone.botSay = botSay;
  /** A message as stored, with the app's view hint when the core passed one (round 6, spec 13.9). */
  function withView(m, extra) {
    if (extra && extra.view) m.view = extra.view;
    return m;
  }
  var chat = {
    sendMessage: function (chatId, text, keyboard, extra) {
      if (staffId() && String(chatId) !== staffId()) {
        phone.pushNotice(String(chatId), text, keyboard || []);   // notifyOwners: relayed through Telegram at the next push
        return { messageId: 0 };
      }
      return { messageId: store.pushChat(withView({ from: 'bot', text: text, keyboard: keyboard || [] }, extra)).id };
    },
    sendPhoto: function (chatId, photo, caption, keyboard, extra) {
      if (staffId() && String(chatId) !== staffId()) { phone.pushNotice(String(chatId), caption, keyboard || []); return { messageId: 0 }; }
      return { messageId: store.pushChat(withView({ from: 'bot', text: caption, photo: photo, keyboard: keyboard || [] }, extra)).id };
    },
    sendDocument: function (chatId, doc, caption) {
      return { messageId: store.pushChat({ from: 'bot', text: caption || '', document: doc, keyboard: [] }).id };
    },
    editMessage: function (chatId, messageId, text, keyboard, isCaption, extra) {
      var m = store.chatById(messageId);
      if (!m) return;
      m.text = text;
      m.keyboard = keyboard || [];
      m.edited = true;
      if (extra && extra.view) m.view = extra.view;
      else if (m.view) delete m.view;
      if (m.carrier) delete m.system;                       // a screen action's carrier now holds the core's answer
      store.saveChat(m);
    },
    answerCallback: function (id) { phone.lastCallbackAnswered = id; },
    typing: function () {},
    getFile: function (fileId) { return store.getMedia(fileId) || {}; },
    savePhoto: function (fileId, name) {
      if (store.getMedia(fileId)) store.updateMedia(fileId, { itemId: name });
      return 'local://' + fileId;
    }
  };
  /** An owner ping made offline: the server relays it through Telegram at the next push. */
  phone.pushNotice = function (to, text, kb) {
    return store.pushOutbox({ kind: 'notice', to: String(to), text: text, kb: kb || [] });
  };

  /* ---------- ai: a queue; the core sees its ai_down fallback, the phone shows ⏳ ---------- */
  function queueAi(kind, file, ctx, extra) {
    var state = null;
    try { var sj = store.cacheGet('st:' + staffId()); state = sj ? JSON.parse(sj) : null; } catch (ignore) {}
    var itemId = (extra && extra.itemId) || (state && state.kind === 'new_item' ? state.itemId : '') || (file && file.itemId) || '';
    // The server keeps AI results by job id for every device (a resent job gets its cached result): the id sent is
    // unique (jobId), not the media id, which is a per-phone counter (voice_1 on every phone, again after a wipe).
    var jobId = 'j-' + appUuid().replace(/-/g, '').slice(0, 16);
    var job;
    if (file && file.id && store.getMedia(file.id)) {
      job = store.updateMedia(file.id, { kind: kind, status: 'queued', ctx: ctx || {}, itemId: itemId, queuedAt: now().toISOString(), jobId: jobId });
    } else {
      job = store.addMedia({ kind: kind, status: 'queued', ctx: ctx || {}, itemId: itemId, text: (extra && extra.text) || '', jobId: jobId,
                             sim: file && file.sim ? file.sim : (file && file.text !== undefined ? { text: file.text, mimeType: file.mimeType } : null),
                             mime: file && file.mimeType ? file.mimeType : '', queuedAt: now().toISOString() });
    }
    phone.pendingAi = job;
    return job;
  }
  /**
   * A new piece's photo while the owner's AI switch is off (round 6, revision 3, review r3 M-1): the media record becomes
   * a pic job, which only uploads the photo (the server saves it to Drive and sets the item's photoUrl, no AI call).
   */
  phone.queuePic = function (mediaId, itemId) {
    return store.updateMedia(mediaId, { kind: 'pic', status: 'queued', itemId: String(itemId || ''), ctx: {},
      jobId: 'j-' + appUuid().replace(/-/g, '').slice(0, 16), queuedAt: now().toISOString() });
  };
  var ai = {
    parseVoice: function (file, ctx) { throw appPendingAiError(queueAi('voice', file, ctx)); },
    parseText: function (text, ctx) { throw appPendingAiError(queueAi('text', null, ctx, { text: text })); },
    describePhoto: function (file, ctx) { throw appPendingAiError(queueAi('photo', file, ctx)); },
    readNotebook: function (file, ctx) { throw appPendingAiError(queueAi('notebook', file, ctx)); }
  };
  /** The on-screen table at once; the real PDF is a server job (api=report), sent to Telegram. */
  var pdf = {
    make: function (report) { return { name: report.fileName + '.pdf', report: report, kind: report.kind, serverJob: true }; }
  };
  var cache = {
    get: function (k) { return store.cacheGet(k); },
    put: function (k, v, ttl) { store.cachePut(k, v, ttl); },
    remove: function (k) { store.cacheRemove(k); }
  };
  var processed = [];
  phone.ports = {
    store: store.ports, chat: chat, cache: cache, ai: ai, pdf: pdf,
    lock: {
      /** Rows appended inside one run() form one outbox group (writeGroup calls appendLedger per row). */
      run: function (fn) {
        var outer = store.openCollector();
        try { return fn(); } finally { store.closeCollector(outer); }
      }
    },
    clock: { now: now },
    uuid: appUuid,
    dedupe: {
      seen: function (id) { return processed.indexOf(String(id)) >= 0; },
      remember: function (id) { processed.push(String(id)); if (processed.length > 400) processed.shift(); }
    },
    // Screens the app draws itself (spec 9.2): core_bot.js startMeasureFor calls measureForm instead of the Telegram
    // measurement flow; app_ui.js listens with phone.on('measureform', ...) and opens the form. The bot has no ports.ui.
    ui: {
      measureForm: function (req) { emit('measureform', req); },
      // Round 6 (spec 4.4, 7.5, 13.0): the forms and the app's own pages. core_bot.js formsInApp / screensInApp read them.
      openForm: function (kind, req) { emit('openform', { kind: kind, req: req }); },
      openScreen: function (name, req) { emit('openscreen', { name: name, req: req }); }
    }
  };

  /* ---------- load ---------- */
  phone.load = function () {
    return store.load().then(function () {
      phone.ready = true;
      emit('ready', phone);
      return phone;
    });
  };

  /* ---------- deliver: the core runs, then one durable commit, then the UI hears about it ---------- */
  function markWaiting(before) {
    // The core answered with its ai_down fallback; on a phone that means "queued", so say ⏳ instead.
    var waiting = t(phone.ports, 'app_wait_server'), down = t(phone.ports, 'ai_down');
    var list = store.chat;
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m.id < before) break;
      if (m.from === 'bot' && m.text && m.text.indexOf(down) >= 0) {
        m.text = waiting;
        m.pending = true;
        store.saveChat(m);
        return;
      }
    }
    // No ai_down line to replace (a photo of a new item keeps going with a placeholder): slip the ⏳ in
    // before this update's replies so the last card and its buttons stay on top.
    var first = null;
    for (var k = 0; k < list.length; k++) if (list[k].id >= before && list[k].from === 'bot') { first = list[k]; break; }
    var wm = { from: 'bot', text: waiting, keyboard: [], system: true, pending: true };
    if (first) store.insertChatBefore(wm, first); else store.pushChat(wm);
  }
  phone.deliver = function (update) {
    var run = function () {
      phone.pendingAi = null;
      var before = store.meta.nextMsgId, res;
      try { res = processUpdate(update, phone.ports); } catch (err) {
        res = 'error';
        try { store.ports.logError('deliver', err, update && update.update_id, ''); } catch (ignore) {}
      }
      if (phone.pendingAi) markWaiting(before);
      phone.log.push({ update: update, result: res });
      if (phone.log.length > 50) phone.log.shift();
      return store.commit().then(function () {
        emit('change', { kind: 'update', result: res, durable: true, update: update });
        return res;
      }, function (err) {
        emit('change', { kind: 'update', result: res, durable: false, error: err, update: update });
        return res;
      });
    };
    var p = phone.chain.then(run, run);
    phone.chain = p.then(noop, noop);
    return p;
  };
  /** Commit outside a delivery (after sync applied a pull, after a settings change) and tell the UI. */
  phone.commit = function (why) {
    return store.commit().then(function () { emit('change', { kind: why || 'commit', durable: true }); return true; },
      function (err) { emit('change', { kind: why || 'commit', durable: false, error: err }); return false; });
  };

  /* ---------- sim helpers: the enrolled staff member using the app ---------- */
  function from() {
    var s = store.meta.staff || { id: '0', name: '' };
    var id = /^\d+$/.test(String(s.id)) ? Number(s.id) : s.id;
    return { id: id, first_name: s.name || '', is_bot: false };
  }
  function chatRef() { return { id: from().id, type: 'private' }; }
  function unix() { return Math.floor(now().getTime() / 1000); }
  function userMsg(fields) {
    var m = { from: 'user', user: store.meta.staff ? store.meta.staff.name : '' };
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) m[k] = fields[k];
    return store.pushChat(m);
  }
  function nextUpdateId() { return store.nextUpdateId(); }
  phone.sim = {
    start: function (payload) {
      var text = '/start' + (payload ? ' ' + payload : '');
      var m = userMsg({ text: text, scan: payload || null });
      return phone.deliver({ update_id: nextUpdateId(), message: { message_id: m.id, from: from(), chat: chatRef(), date: unix(), text: text } });
    },
    text: function (text) {
      var m = userMsg({ text: text });
      return phone.deliver({ update_id: nextUpdateId(), message: { message_id: m.id, from: from(), chat: chatRef(), date: unix(), text: text } });
    },
    /** Dev page and tests: a "spoken" phrase the mock AI understands. */
    voice: function (spoken) {
      var rec = store.addMedia({ kind: 'voice', sim: { text: spoken, mimeType: 'audio/ogg' }, mime: 'audio/ogg', text: '', status: 'file', durationMs: 3000 });
      var m = userMsg({ voice: spoken, fileId: rec.id });
      return phone.deliver({ update_id: nextUpdateId(), message: { message_id: m.id, from: from(), chat: chatRef(), date: unix(),
        voice: { file_id: rec.id, duration: 3, mime_type: 'audio/ogg' } } });
    },
    /** A real recording: {blob, mime, durationMs}. */
    voiceBlob: function (rec) {
      var media = store.addMedia({ kind: 'voice', blob: rec.blob, mime: rec.mime || 'audio/webm', status: 'file', durationMs: rec.durationMs || 0 });
      var secs = Math.max(1, Math.round((rec.durationMs || 0) / 1000));
      var m = userMsg({ voice: '', fileId: media.id, durationMs: rec.durationMs || 0 });
      return phone.deliver({ update_id: nextUpdateId(), message: { message_id: m.id, from: from(), chat: chatRef(), date: unix(),
        voice: { file_id: media.id, duration: secs, mime_type: media.mime } } });
    },
    photo: function (preset, caption) {
      var rec = store.addMedia({ kind: 'photo', sim: { meta: preset, visual: preset.visual, mimeType: 'image/jpeg' }, mime: 'image/jpeg', status: 'file', visual: preset.visual });
      return phone.sim.photoMessage(rec, caption);
    },
    /** A real capture: {blob, dataUrl, mime}. */
    photoBlob: function (rec, caption) {
      var media = store.addMedia({ kind: 'photo', blob: rec.blob, dataUrl: rec.dataUrl || '', mime: rec.mime || 'image/jpeg', status: 'file' });
      return phone.sim.photoMessage(media, caption);
    },
    photoMessage: function (media, caption) {
      var m = userMsg({ photo: media.id, text: caption || '' });
      var msg = { message_id: m.id, from: from(), chat: chatRef(), date: unix(), photo: [{ file_id: media.id, width: 320, height: 320 }, { file_id: media.id, width: 1280, height: 1280 }] };
      if (caption) msg.caption = caption;
      return phone.deliver({ update_id: nextUpdateId(), message: msg });
    },
    tap: function (messageId, data) {
      var target = store.chatById(messageId);
      if (!target) return Promise.reject(new Error('tap: no message ' + messageId));
      var message = { message_id: messageId, chat: chatRef(), date: unix(), text: target.text };
      if (target.photo) message.photo = [{ file_id: target.photo }];
      var uid = nextUpdateId();
      return phone.deliver({ update_id: uid, callback_query: { id: 'cq' + uid, from: from(), message: message, data: data } });
    },
    replay: function (update) { return phone.deliver(update); },
    /**
     * A page's action button (round 6, revision 3, spec 13.6): the core's callback runs against an empty carrier message,
     * which the core edits into its answer (or answers below it). Resolves to {carrier, result}. lastBot() skips a carrier
     * nobody answered, so the home never shows an empty card.
     */
    act: function (data) {
      var carrier = store.pushChat({ from: 'bot', text: '', keyboard: [], system: true, carrier: true });
      return phone.sim.tap(carrier.id, data).then(function (res) { return { carrier: carrier, result: res }; });
    },
    lastBot: function () {
      var list = store.chat;
      for (var i = list.length - 1; i >= 0; i--) if (list[i].from === 'bot' && !(list[i].carrier && !list[i].edited)) return list[i];
      return null;
    },
    lastBotWith: function (label) {
      var list = store.chat;
      for (var i = list.length - 1; i >= 0; i--) {
        var m = list[i];
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
    tapLast: function (label) {
      var m = phone.sim.lastBot(), data = phone.sim.button(m, label);
      if (!data) return Promise.reject(new Error(phone.name + ': no button "' + label + '" on: ' + (m && m.text)));
      return phone.sim.tap(m.id, data);
    },
    tapAny: function (label) {
      var m = phone.sim.lastBotWith(label), data = m && phone.sim.button(m, label);
      if (!data) return Promise.reject(new Error(phone.name + ': no recent button "' + label + '"'));
      return phone.sim.tap(m.id, data);
    }
  };
  phone.lastText = function () { var m = phone.sim.lastBot(); return (m && m.text) || ''; };
  phone.chatHas = function (text) {
    var list = store.chat;
    for (var i = list.length - 1; i >= 0; i--) if (list[i].from === 'bot' && (list[i].text || '').indexOf(text) >= 0) return true;
    return false;
  };
  phone.stockOf = function (itemId) { return store.stockOf(itemId); };
  phone.stats = function () { return store.stats(); };
  return phone;
}
