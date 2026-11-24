/**
 * poc/sim_ui.js — the simulator page, v2 (round 5, spec section 6). Drives the shared core through sim_ports and the
 * fake sync server of sim_sync, and shows one world on three devices: Telegram (the phone pane), the real app (one
 * <iframe srcdoc> per login, built by poc/build_simulator.js) and the owner's laptop (the Sheet, Lists editable, and
 * the app at laptop width). A login screen picks who holds the devices; the "what can I do" panel runs the tours of
 * poc/sim_tours.js with the next tap highlighted as part of every render. ?autorun=smoke runs SIM.smoke() and writes
 * its result into <pre id="smoke">; ?login=sister&device=app&tour=sell&latency=0 runs a tour unattended; &transport=post
 * makes every frame take its postMessage path (the one a host that isolates the srcdoc child would force).
 * Round 6 (spec section 8): the page boots with sale_flow = form, a seller logs in on 📱, the sellers' tours run on the
 * app's forms (a target {f: <data-f name>} is tapped or set inside the frame), tgsale shows the Telegram review card,
 * the Ledger tab marks a basket's lines, and SIM.smoke sells a three-item basket with a part payment.
 */
(function () {
  'use strict';
  var BOT = 'ShopTagBot';
  var ZWJ = String.fromCharCode(0x200d);   // the emoji joiner: never written into a source file as a raw character
  var PHRASES = [
    { my: 'ဒါ ၂ ထည် ရောင်းရတယ်', en: 'Sold 2 of these' },
    { my: 'တစ်ထည် တစ်သောင်းငါးထောင်နဲ့ ရောင်းလိုက်တယ်', en: 'Sold one at 15,000 (bargained price)' },
    { my: 'ဒါ ၁၀ ထည် ရောက်တယ်', en: '10 of these arrived (restock)' },
    { my: 'ဒါ တစ်ထည် ပြန်အမ်းတယ်', en: 'A customer returned one' },
    { my: 'အထည်ဖိုး သုံးသောင်း ပေးလိုက်တယ်', en: 'Paid 30,000 for fabric (expense)' },
    { my: 'ဒေါ်မြင့် ငါးသိန်း ပေးသွားတယ်', en: 'Daw Myint paid 500,000 she owed (payment)' },
    { my: 'ဒေါ်ခင် စရံ သုံးသိန်း ပေးသွားတယ်', en: 'Daw Khin paid a 300,000 deposit for an order' },
    { my: 'ဒီနေ့ ဘယ်လောက်ရောင်းရလဲ', en: 'How much did we sell today?' },
    { my: 'ဒါ ဘယ်နှစ်ထည် ကျန်လဲ', en: 'How many of these are left?' },
    { my: 'ထမီ အဝါ ၁ ထည် ရောင်းရတယ်', en: 'Sold 1 yellow htamein (names the item, no scan)' },
    { my: 'ဒါကို ဆိုင် ၂ ကို ပို့မယ်', en: 'Send this one to shop 2' },
    { my: 'ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်', en: 'Sold 2 of these, paid by KBZPay' },
    { my: 'Wave နဲ့ ပေးသွားတယ်', en: 'The last sale was paid by WavePay (method only)' },
    { my: 'ဖုန်းဘေလ် တစ်သောင်းခွဲ KBZ နဲ့ ပေးလိုက်တယ်', en: 'Paid the 15,000 phone bill by KBZPay (expense with category)' },
    { my: 'ဒါ ၁ ထည် ဘဏ်လွှဲ နဲ့ ရောင်းရတယ်', en: 'Sold 1, paid into the account whose label is ဘဏ်လွှဲ (an account named by its label)' },
    { my: 'မနက်ဖြန် မိုးရွာမလား', en: 'Will it rain tomorrow? (not understood)' }
  ];
  /** The three logins of the login screen (SIM_USERS keys) and the stranger of one tour step. */
  var LOGINS = {
    owner: { icon: '👩' + ZWJ + '💼', my: 'ဆိုင်ရှင်', en: 'Owner', devices: '✈️ Telegram · 📱 App · 💻 Laptop', note: 'the shared admin login, both shops' },
    sister: { icon: '🧵', my: 'ဆိုင် ၁', en: 'Seller shop 1', devices: '✈️ Telegram · 📱 App', note: 'staff of shop 1' },
    brother: { icon: '🧵', my: 'ဆိုင် ၂', en: 'Seller shop 2', devices: '✈️ Telegram · 📱 App', note: 'staff of shop 2' },
    customer: { icon: '👤', my: 'ဝယ်သူ', en: 'Customer (not staff)', devices: '✈️ Telegram', note: 'not in the Staff tab' }
  };
  var DEV_NAMES = {
    tg: { icon: '✈️', my: 'Telegram', en: 'Telegram' }, app: { icon: '📱', my: 'အက်ပ်', en: 'App' },
    laptop: { icon: '💻', my: 'Laptop', en: 'Laptop' }, floor: { icon: '🏷', my: 'ဆိုင်', en: 'Shop floor' }
  };
  var LATENCY = 250;
  var world = null, server = null, S = null, tagNodes = {}, raf = null, autoTimer = null, snapAsks = 0;
  var $ = function (id) { return document.getElementById(id); };
  var Q = parseQuery(window.location ? window.location.search : '');

  /* ------------------------------ page errors: window.SIM_ERRORS ------------------------------ */
  window.SIM_ERRORS = [];
  function simError(text) { window.SIM_ERRORS.push(String(text)); }
  window.addEventListener('error', function (e) { simError(String(e.message || 'error') + (e.lineno ? ' (line ' + e.lineno + ')' : '')); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; simError('unhandled rejection: ' + String((r && r.stack) || r)); });

  function parseQuery(search) {
    var q = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      try { q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (ignore) {}
    });
    return q;
  }
  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function hhmm(iso) { return timeKey(new Date(iso)); }
  function money(n) { return fmtMoney(n); }
  function cell(v) { return typeof v === 'number' ? money(v) : (v === undefined || v === null ? '' : String(v)); }
  function itemView(id) {
    var list = world.ports.store.listItems(null);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function note(text) {
    S.note = text;
    S.noteAt = Date.now();
    setTimeout(function () { if (S && S.note === text) { S.note = ''; renderAll(); } }, 6000);
  }

  /* ------------------------------ boot ------------------------------ */
  function boot() {
    // The Lists tab is seeded the way setupSheet() seeds it (accounts, expense categories, fabrics), so ➕, the 🏛
    // accounts screen and the laptop's edits write real rows; the fake server makes the 📲 app row real in Telegram.
    world = simSeedLists(seedSimWorld(createSimWorld()));
    world.settings.sale_flow = 'form';    // the demo shows the forms (app) and the review card (Telegram); seedSimWorld says quick for the suites
    server = createFakeServer(world);
    S = {
      login: null, user: null, device: 'tg', wide: false, tab: 'dash', pendingStart: null, groupPosts: [], flash: {}, lastScan: null,
      listSeen: null, listFlash: {}, tour: null, frames: {}, frameEls: {}, note: '', noteAt: 0, addNote: '', sheetDirty: false
    };
    window.SIM = { world: world, server: server, latency: LATENCY, frameReady: frameReady, smoke: smoke, ping: ping, frameEvent: frameEvent, frameError: frameError };
    world.listeners.push(onWorldEvent);
    markListChanges();
    S.listFlash = {};
    $('outage').checked = false;
    buildRacks();
    renderAll();
  }
  /** Reset: every frame leaves the document BEFORE the new world (a kept frame would hold a token the new server denies). */
  function reset() {
    closePop();
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    Array.prototype.slice.call(document.querySelectorAll('iframe')).forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    if (S) { S.frames = {}; S.frameEls = {}; }
    boot();
  }

  function onWorldEvent(evt) {
    if (evt.type === 'ledger' && evt.row) S.flash[evt.row.txId] = true;
    if (evt.type === 'lists') { markListChanges(); framesSync('settings'); }   // a phone pulls lists_json at its next sync
    if (evt.type === 'update') {
      framesSync('sim');                                                        // a Telegram write reaches the phones
      tourEvent(updateEvent('tg', evt.update));
    } else if (evt.type !== 'synclog' && evt.type !== 'chat') {
      tourEvent({ src: 'world', kind: evt.type });
    }
    scheduleRender();
  }
  function updateEvent(src, u) {
    if (u.callback_query) return { src: src, kind: 'tap', data: String(u.callback_query.data), uid: u.callback_query.from ? u.callback_query.from.id : undefined };
    var m = u.message || {}, e = { src: src, uid: m.from ? m.from.id : undefined };
    if (m.photo) e.kind = 'photo';
    else if (m.voice) e.kind = 'voice';
    else if (typeof m.text === 'string') { e.kind = 'text'; e.text = m.text; }
    else e.kind = 'update';
    return e;
  }

  function scheduleRender() {
    if (raf) return;
    raf = true;
    var run = function () { if (!raf) return; raf = null; renderAll(); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    setTimeout(run, 60);
  }
  function renderAll() {
    if (!S) return;
    computeHot();
    renderLogin();
    renderWho();
    renderClock();
    renderFlow();
    renderDevices();
    renderTours();
    updateRacks();
    $('tgPane').hidden = S.device !== 'tg';
    $('appPane').hidden = S.device !== 'app';
    $('laptopPane').hidden = S.device !== 'laptop';
    $('stage').className = 'stage' + (S.device === 'laptop' ? ' wide' : '');
    if (S.device === 'tg') { renderPhone(); renderParser(); }
    else Array.prototype.slice.call(document.querySelectorAll('#chat .hot, #inputbar.hot')).forEach(function (el) { el.className = el.className.replace(/\s*\bhot\b/g, ''); });
    if (S.device === 'app') renderAppPane();
    if (S.device === 'laptop') renderLaptop();
    markUiHot();
    syncFrameHot();
  }

  /* ------------------------------ login, header ------------------------------ */
  function buildLogin() {
    var box = $('loginOpts');
    clear(box);
    ['owner', 'sister', 'brother'].forEach(function (k) {
      var L = LOGINS[k];
      box.appendChild(h('button', { 'data-login': k, onclick: function () { doLogin(k); } }, [
        h('span', { class: 'ic', text: L.icon }), h('span', { class: 'my', text: L.my }), h('span', { class: 'en', text: L.en + ' · ' + L.note }),
        h('span', { class: 'dv', text: L.devices })
      ]));
    });
  }
  function doLogin(key) {
    if (!SIM_USERS[key] || key === 'customer') return;
    S.login = key;
    S.user = SIM_USERS[key];
    S.pendingStart = null;
    // Round 6 (8.1): a seller lands on 📱 (the frame is not enrolled for her: the enrol screen and ⚡ show); the owner keeps the open device.
    if (S.user.role === 'staff') S.device = 'app';
    else if (S.device === 'laptop' && key !== 'owner') S.device = 'tg';
    if (S.device === 'app') ensureFrame(key);
    closePop();
    tourEvent({ src: 'page', kind: 'ui', name: 'login', login: key });
    renderAll();
  }
  function logout() {
    if (S.tour) tourLeave();
    S.login = null;
    S.user = null;
    S.pendingStart = null;
    renderAll();
  }
  function renderLogin() { $('login').hidden = !!S.login; }
  function renderWho() {
    var box = $('who');
    clear(box);
    if (!S.login) return;
    var who = S.user && S.user.id === SIM_USERS.customer.id ? 'customer' : S.login, L = LOGINS[who];
    box.appendChild(h('span', { class: 'chip-who', text: L.icon + ' ' + L.my + ' / ' + L.en + (who === 'customer' ? ' (tour step)' : '') }));
    box.appendChild(h('button', { class: 'btn small', id: 'logout', text: '🚪 Log out', onclick: logout }));
  }
  function renderClock() {
    var now = world.ports.clock.now(), off = world.clockOffsetMs || 0, txt = fmtDayMy(dayKey(now)) + ' · ' + timeKey(now);
    if (off > 0) {
      var d = Math.floor(off / 86400000), m = Math.round((off % 86400000) / 60000);
      txt += '  (demo clock +' + (d ? d + ' d ' : '') + Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60) + ')';
    }
    $('clockNow').textContent = '🕘 ' + txt;
  }
  function renderFlow() {
    var f = saleFlow(world.ports);
    $('flowForm').className = f === 'form' ? 'on' : '';
    $('flowQuick').className = f === 'quick' ? 'on' : '';
  }

  /* ------------------------------ device bar ------------------------------ */
  function setDevice(d) {
    if (!S.login || !DEV_NAMES[d] || d === 'floor') return;
    if (d === 'laptop' && S.login !== 'owner') return;
    S.device = d;
    if (d !== 'tg') S.pendingStart = null;
    if (d === 'app') ensureFrame(S.login);
    if (d === 'laptop' && S.wide) ensureFrame('owner_wide');
    closePop();
    tourEvent({ src: 'page', kind: 'ui', name: 'device', device: d });
    renderAll();
  }
  function frameStateText(key) {
    var rec = S.frames[key], s = snapOf(rec);
    if (!S.frameEls[key]) return '';
    if (!rec || !s || !s.ready) return 'the app is starting…';
    if (!s.deviceId) return s.busy ? 'enrolling…' : 'not enrolled';
    return 'enrolled · ' + s.label + (s.letter ? ' (' + s.letter + ')' : '') + ' · ' + s.chipText;
  }
  function renderDevices() {
    Array.prototype.slice.call(document.querySelectorAll('#devices .dev')).forEach(function (b) {
      var d = b.getAttribute('data-dev');
      b.className = 'dev ' + d + (S.device === d ? ' on' : '');
      if (d === 'laptop') b.hidden = S.login !== 'owner';
    });
    var x = $('devExtra');
    clear(x);
    if (S.login && S.device === 'app') {
      var s = snapOf(S.frames[S.login]);
      x.appendChild(h('span', { class: 'state', text: frameStateText(S.login) }));
      if (S.frames[S.login] && s && s.ready && !s.deviceId) x.appendChild(h('button', { class: 'btn small', id: 'enrolShortcut', text: '⚡ enrol (shortcut)', onclick: function () { enrolShortcut(S.login); } }));
      if (s && s.deviceId) x.appendChild(h('button', { class: 'btn small', id: 'frameSync', text: '🔄 sync now', onclick: function () { frameCmd(S.frames[S.login], { op: 'sync', why: 'manual' }); } }));
    }
    if (S.login === 'owner' && S.device === 'laptop') {
      var box = h('input', { type: 'checkbox', id: 'wideToggle' });
      box.checked = !!S.wide;
      box.addEventListener('change', function () { S.wide = box.checked; if (S.wide) ensureFrame('owner_wide'); tourEvent({ src: 'page', kind: 'ui', name: 'wide' }); renderAll(); });
      x.appendChild(h('label', { class: 'switch' }, [box, document.createTextNode('📱 app at laptop width')]));
      if (S.wide) {
        var ws = snapOf(S.frames.owner_wide);
        x.appendChild(h('span', { class: 'state', text: frameStateText('owner_wide') }));
        if (S.frames.owner_wide && ws && ws.ready && !ws.deviceId) x.appendChild(h('button', { class: 'btn small', id: 'enrolWide', text: '⚡ enrol (shortcut)', onclick: function () { enrolShortcut('owner_wide'); } }));
      }
    }
    $('pageNote').textContent = S.note && Date.now() - S.noteAt < 6000 ? S.note : '';
  }

  /* ------------------------------ shop floor ------------------------------ */
  function makeQr(container, text) {
    if (window.QRCode) {
      try { new window.QRCode(container, { text: text, width: 84, height: 84, correctLevel: window.QRCode.CorrectLevel.M }); return; } catch (e) { /* fall through */ }
    }
    container.className += ' qr-fallback';
    container.textContent = 'QR';
  }
  function buildRacks() {
    tagNodes = {};
    ['S1', 'S2'].forEach(function (shop) {
      var box = $('tags' + shop);
      clear(box);
      world.ports.store.listItems(shop).forEach(function (it) {
        var qr = h('div', { class: 'qr' });
        makeQr(qr, 'https://t.me/' + BOT + '?start=' + it.id);
        var node = h('button', { class: 'tag', title: 'Scan ' + it.id, 'data-tag': it.id, onclick: function () { scan(it.id); } }, [
          qr,
          h('div', { class: 'meta' }, [h('div', { class: 'id', text: it.id }), h('div', { class: 'nm' }), h('span', { class: 'st' })])
        ]);
        tagNodes[it.id] = node;
        box.appendChild(node);
      });
    });
  }
  function updateRacks() {
    var counts = { S1: { active: 0, blank: 0 }, S2: { active: 0, blank: 0 } };
    var st = curStep(), hotTag = st && !S.tour.pre && st.target && st.target.tag ? st.target.tag : '';
    world.ports.store.listItems(null).forEach(function (it) {
      var node = tagNodes[it.id];
      if (!node) return;
      node.querySelector('.nm').textContent = it.name ? it.name + (it.sample ? ' 🎨 sample' : '') + ' · ' + (it.price === '' ? 'price pending' : money(it.price)) : 'blank tag';
      var stEl = node.querySelector('.st');
      stEl.textContent = it.status === 'BLANK' ? 'blank' : it.status === 'SOLD' ? 'sold' : it.type === 'UNIQUE' ? '1 piece' : 'stock ' + it.stock;
      stEl.className = 'st ' + it.status;
      node.className = 'tag' + (S.lastScan === it.id ? ' scanned' : '') + (hotTag === it.id ? ' hot' : '');
      if (it.shop !== node.parentNode.id.slice(4)) $('tags' + it.shop).appendChild(node);   // a transferred tag moves racks
      if (it.status === 'BLANK') counts[it.shop].blank++; else counts[it.shop].active++;
    });
    $('s1count').textContent = counts.S1.active + ' items · ' + counts.S1.blank + ' blank';
    $('s2count').textContent = counts.S2.active + ' items · ' + counts.S2.blank + ' blank';
  }
  /** A click on a tag = a scan on the active device: Telegram shows START, the app opens its form (form) or the card (quick). */
  function scan(id) {
    S.lastScan = id;
    closePop();
    if (!S.login) { renderAll(); return; }
    if (S.device === 'app') {
      var rec = S.frames[S.login], s = snapOf(rec);
      if (!rec || !s || !s.deviceId) note('📱 Enrol this phone first (⚡ on the device bar).');
      else frameCmd(rec, { op: 'open', id: id });
    } else if (S.device === 'laptop') {
      note('Choose ✈️ Telegram or 📱 App to scan a tag.');
    } else {
      S.pendingStart = id;
      tourEvent({ src: 'page', kind: 'scan', id: id });
    }
    renderAll();
  }
  function pressStart() {
    var id = S.pendingStart;
    if (!id) return;
    S.pendingStart = null;
    world.sim.start(S.user, id);
    renderAll();
  }

  /* ------------------------------ Telegram ------------------------------ */
  function renderPhone() {
    var chat = $('chat');
    clear(chat);
    if (!S.user) return;
    var list = world.chats[S.user.id] || [], lastBot = world.sim.lastBot(S.user);
    var st = curStep(), hotTg = S.tour && S.tour.hotDev === 'tg' ? S.tour.hot : '';
    if (!list.length && !S.pendingStart) {
      chat.appendChild(h('div', { class: 'empty', text: 'Scan a tag on the rack to open the bot, or type /start for the menu.' }));
    }
    list.forEach(function (m) { chat.appendChild(renderMsg(m, m === lastBot ? hotTg : '')); });
    chat.scrollTop = chat.scrollHeight;
    $('holder').textContent = '📱 ' + S.user.name.replace(/\s*\(.*\)/, '');

    var sb = $('startbar'), ib = $('inputbar');
    if (S.pendingStart) {
      clear(sb);
      sb.appendChild(h('button', { text: 'START', onclick: pressStart }));
      sb.appendChild(h('span', { class: 'link', text: 'https://t.me/' + BOT + '?start=' + S.pendingStart }));
      sb.hidden = false;
      ib.hidden = true;
    } else {
      sb.hidden = true;
      ib.hidden = false;
    }
    var typing = st && !S.tour.pre && stepDev(st) === 'tg' && st.target && st.target.type ? String(st.target.type) : '';
    ib.className = 'bar' + (typing ? ' hot' : '');
    if (typing && S.tour.filledFor !== S.tour.i) { $('textIn').value = typing; S.tour.filledFor = S.tour.i; }
  }
  function visualFor(fileId) {
    var f = world.files[fileId];
    return f && f.visual ? f.visual : { emoji: '🧵', bg: '#777' };
  }
  function renderReport(rep) {
    var wrap = h('div', { class: 'repbody' });
    if (rep.subtitle) wrap.appendChild(h('div', { class: 'sub', text: rep.subtitle }));
    rep.sections.forEach(function (sec) {
      if (sec.heading) wrap.appendChild(h('h4', { text: sec.heading }));
      var thead = h('thead', {}, [h('tr', {}, sec.columns.map(function (c) { return h('th', { text: c }); }))]);
      var tbody = h('tbody', {}, sec.rows.map(function (r) { return h('tr', {}, r.map(function (v) { return h('td', { class: typeof v === 'number' ? 'num r' : '', text: cell(v) }); })); }));
      (sec.totals || []).forEach(function (r) { tbody.appendChild(h('tr', { class: 'tot' }, r.map(function (v) { return h('td', { class: typeof v === 'number' ? 'num r' : '', text: cell(v) }); }))); });
      if (!sec.rows.length && !(sec.totals || []).length) tbody.appendChild(h('tr', {}, [h('td', { colspan: sec.columns.length, text: '—' })]));
      wrap.appendChild(h('div', { class: 'repwrap' }, [h('table', {}, [thead, tbody])]));
    });
    // A footer can hold line breaks: a receipt or voucher with a balance prints one account per line above its last line.
    if (rep.footer) wrap.appendChild(h('div', { class: 'sub foot', text: rep.footer }));
    return wrap;
  }
  /** One message. Every button carries data-cb; the one the tour expects next (hot, on the latest bot message) is marked. */
  function renderMsg(m, hot) {
    var node = h('div', { class: 'msg ' + (m.from === 'bot' ? 'bot' : 'user') });
    if (m.from === 'user') {
      if (m.voice) {
        node.appendChild(h('div', { class: 'voice' }, [h('span', { text: '🎤' }), h('span', { class: 'wave', text: '▂▃▅▇▅▃▂▃▅▃▂' }), h('span', { text: '0:03' })]));
        node.appendChild(h('div', { class: 'spoken', text: 'says: “' + m.voice + '”' }));
      } else if (m.photo) {
        var v = visualFor(m.photo);
        node.appendChild(h('div', { class: 'pic', style: 'background:' + v.bg, text: v.emoji }));
        if (m.text) node.appendChild(document.createTextNode(m.text));
      } else {
        node.appendChild(document.createTextNode(m.text));
      }
    } else {
      if (m.photo) {
        var pv = visualFor(m.photo);
        node.appendChild(h('div', { class: 'pic', style: 'background:' + pv.bg, text: pv.emoji }));
      }
      if (m.document) {
        node.appendChild(h('div', { class: 'doc' }, [h('span', { class: 'ico', text: '📄' }), h('span', { text: m.document.name })]));
        if (m.text) node.appendChild(h('div', { text: m.text }));
        node.appendChild(h('details', { class: 'rep' }, [h('summary', { text: 'Preview the PDF' }), renderReport(m.document.report)]));
      } else {
        node.appendChild(document.createTextNode(m.text || ''));
      }
      if (m.keyboard && m.keyboard.length) {
        var kb = h('div', { class: 'kb' });
        m.keyboard.forEach(function (row) {
          var r = h('div', { class: 'row' });
          row.forEach(function (b) {
            r.appendChild(h('button', { text: b.text, 'data-cb': b.callback_data, class: hot && b.callback_data === hot ? 'hot' : null,
              onclick: function () { world.sim.tap(S.user, m.id, b.callback_data); renderAll(); } }));
          });
          kb.appendChild(r);
        });
        node.appendChild(kb);
      }
    }
    node.appendChild(h('span', { class: 'time' }, [m.edited ? h('span', { class: 'edited', text: 'edited ' }) : null, hhmm(m.ts)]));
    return node;
  }
  function sendText() {
    var v = $('textIn').value.trim();
    if (!v || !S.user) return;
    $('textIn').value = '';
    world.sim.text(S.user, v);
    renderAll();
  }
  function sendPhoto(key) {
    for (var i = 0; i < SIM_PHOTOS.length; i++) if (SIM_PHOTOS[i].key === key) { world.sim.photo(S.user, SIM_PHOTOS[i]); renderAll(); return true; }
    return false;
  }

  /* ------------------------------ popovers and the voice box ------------------------------ */
  function openPop(anchor, title, content) {
    var pop = $('pop');
    clear(pop);
    pop.appendChild(h('h3', {}, [document.createTextNode(title), h('button', { text: '✕', title: 'Close', onclick: closePop })]));
    pop.appendChild(content);
    pop.hidden = false;
    var r = anchor.getBoundingClientRect();
    var left = Math.max(10, Math.min(window.innerWidth - pop.offsetWidth - 10, r.left - pop.offsetWidth / 2 + r.width / 2));
    var top = r.top - pop.offsetHeight - 10;
    if (top < 10) top = r.bottom + 10;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function closePop() { $('pop').hidden = true; }
  function photoPop() {
    if (!S.user) return;
    var grid = h('div', { class: 'photos' });
    SIM_PHOTOS.forEach(function (p) {
      grid.appendChild(h('button', { onclick: function () { closePop(); world.sim.photo(S.user, p); renderAll(); } }, [
        h('div', { class: 'sw', style: 'background:' + p.visual.bg, text: p.visual.emoji }),
        h('div', { class: 'cap', text: p.label || p.name || 'not a garment' })
      ]));
    });
    openPop($('photoBtn'), 'Send a photo', grid);
  }
  /** D7: the 16 phrases and the parser box sit in one collapsed <details> under the Telegram phone. */
  function buildPhrases() {
    var list = $('phrases');
    clear(list);
    PHRASES.forEach(function (p) {
      list.appendChild(h('button', { onclick: function () { if (S.user) { world.sim.voice(S.user, p.my); renderAll(); } } }, [
        h('span', { class: 'my', text: p.my }), h('span', { class: 'en', text: p.en })
      ]));
    });
  }
  function sendVoice() {
    var v = $('voiceIn').value.trim();
    if (!v || !S.user) return;
    $('voiceIn').value = '';
    world.sim.voice(S.user, v);
    renderAll();
  }
  function renderParser() {
    var last = null;
    for (var i = world.log.length - 1; i >= 0; i--) if (world.log[i].kind === 'ai') { last = world.log[i]; break; }
    $('parserOut').textContent = last ? 'input: ' + last.input + '\n' + JSON.stringify(last.output, null, 1) : '—';
  }

  /* ------------------------------ the app frames ------------------------------ */
  /** One <iframe srcdoc> per login ('owner_wide' = the owner's app at laptop width): its own APP, memory adapter and CSS. */
  function ensureFrame(key) {
    if (!key || key === 'customer') return null;
    if (S.frameEls[key]) return S.frameEls[key];
    var el = document.createElement('iframe');
    el.className = 'appframe' + (key === 'owner_wide' ? ' wide' : '');
    el.setAttribute('title', 'SalesTag app · ' + key);
    el.setAttribute('data-key', key);
    el.srcdoc = SIM_APP_SRCDOC;
    (key === 'owner_wide' ? $('wideHolder') : $('appHolder')).appendChild(el);
    S.frameEls[key] = el;
    return el;
  }
  function keyOfWin(win) {
    for (var k in S.frameEls) if (Object.prototype.hasOwnProperty.call(S.frameEls, k) && S.frameEls[k].contentWindow === win) return k;
    return null;
  }
  /** The frame's probe of parent.SIM (the PRELUDE of build_simulator.js); ?transport=post answers otherwise, so every frame takes the postMessage path. */
  function ping() { return Q.transport === 'post' ? 'post' : 'pong'; }
  /** The frame's bootApp resolved: from now on the page talks to it through S.frames only. */
  function frameReady(win, app) {
    var key = keyOfWin(win);
    if (!key) return;   // a frame of an earlier world
    S.frames[key] = { key: key, win: win, app: app, direct: true, remote: null, hot: null, markSig: '', snapCache: null, labels: null };
    tourEvent({ src: 'app', key: key, kind: 'ready' });
    scheduleRender();
  }
  function frameEvent(win, e) { var key = keyOfWin(win); if (key && S.frames[key]) onFrameEvent(key, e || {}); }
  function frameError(win, text) { simError('app frame ' + (keyOfWin(win) || '?') + ': ' + text); }
  function onFrameEvent(key, e) {
    var rec = S.frames[key];
    if (!rec) return;
    if (e.snap) rec.snapCache = e.snap;
    if (e.labels) rec.labels = e.labels;
    var T = S.tour;
    // The fresh snapshot the step asked for (enterStep): a phone that left its chat screen just before is seen now.
    if (e.kind === 'snap' && e.id && T && T.ask === e.id) {
      T.ask = 0;
      if (!T.pre && !T.finished && !T.blocked && key === S.login) { T.pre = framePre(key); if (T.pre) { T.want = ''; T.hot = ''; } }
    }
    tourEvent(e.ev ? { src: 'app', key: key, kind: e.ev, data: e.data, text: e.text } : { src: 'app', key: key, kind: e.kind });
    scheduleRender();
  }
  function snapOf(rec) {
    if (!rec) return null;
    if (!rec.direct) return rec.snapCache;
    try { return rec.win.SIM_FRAME.snap(); } catch (err) { simError('app frame ' + rec.key + ' snapshot: ' + ((err && err.message) || err)); return null; }
  }
  /** Every page-side call into a frame goes through here: try/catch into SIM_ERRORS, or a message when the frame is not reachable. */
  function frameCmd(rec, c) {
    if (!rec) return false;
    if (rec.direct) {
      try { return rec.win.SIM_FRAME.cmd(c); } catch (err) { simError('app frame ' + rec.key + ' ' + c.op + ': ' + ((err && err.message) || err)); return false; }
    }
    try {
      rec.remote.postMessage({ simPage: 'cmd', c: c }, '*');
      // The page knows the screen it just set: the snapshot says so until the frame's own answer replaces it.
      if (c.op === 'screen' && rec.snapCache) {
        var s2 = {};
        for (var f in rec.snapCache) if (Object.prototype.hasOwnProperty.call(rec.snapCache, f)) s2[f] = rec.snapCache[f];
        s2.screen = String(c.screen || 'home');
        rec.snapCache = s2;
      }
      return true;
    } catch (err2) { simError('app frame ' + rec.key + ' ' + c.op + ': ' + ((err2 && err2.message) || err2)); return false; }
  }
  function frameEnrolled(key) { var s = snapOf(S.frames[key]); return !!(s && s.deviceId); }
  function frameHome(key) { var s = snapOf(S.frames[key]); return !!(s && s.deviceId && s.screen === 'home' && !s.busy); }
  /**
   * What a tour step on the app waits for first: 'enrol' (not enrolled yet, or enrolling), 'home' (enrolled, but the
   * phone shows one of its pages, the history, a buyer, a receipt, sync or settings: the header's ← brings the home
   * back; or, at a tour's first step, a form left open: its own ← closes it and keeps its draft), or null.
   */
  function framePre(key) {
    var s = snapOf(S.frames[key]);
    if (s && s.deviceId && !s.busy) {
      if (s.screen !== 'home') return 'home';
      return S.tour && S.tour.i === 0 && (s.form || s.measForm) ? 'home' : null;
    }
    return 'enrol';
  }
  /** syncNow on the ready, enrolled frames only (an un-enrolled frame answers not_enrolled: harmless but noisy). */
  function framesSync(why) {
    if (!S) return;
    for (var k in S.frames) if (Object.prototype.hasOwnProperty.call(S.frames, k) && frameEnrolled(k)) frameCmd(S.frames[k], { op: 'sync', why: why });
  }
  function framesClock() {
    for (var k in S.frames) if (Object.prototype.hasOwnProperty.call(S.frames, k) && !S.frames[k].direct) frameCmd(S.frames[k], { op: 'clock', offset: world.clockOffsetMs || 0 });
  }
  /** The device bar's shortcut: a code minted for this login, typed into the frame's own box, the app's own enrol. */
  function enrolShortcut(key) {
    var rec = S.frames[key];
    if (!rec) { note('The app is still starting…'); renderAll(); return false; }
    if (frameEnrolled(key)) return true;
    var who = key === 'owner_wide' ? 'owner' : key;
    var minted = server.mintEnrollCode(SIM_USERS[who], LOGINS[who].en + (key === 'owner_wide' ? ' · laptop' : ' · phone'));
    var done = frameCmd(rec, { op: 'enroll', code: minted.display });
    tourEvent({ src: 'page', kind: 'ui', name: 'enrol', key: key });
    renderAll();
    return done !== false;
  }
  // The postMessage transport and channel, used when a frame cannot reach parent.SIM (chosen by the frame at boot).
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!S || !d || typeof d !== 'object' || !d.simFrame) return;
    var key = null;
    for (var k in S.frameEls) if (Object.prototype.hasOwnProperty.call(S.frameEls, k) && S.frameEls[k].contentWindow === e.source) key = k;
    if (!key) return;
    var src = e.source;
    if (d.simFrame === 'call') {
      setTimeout(function () {
        var out = { simPage: 'reply', id: d.id }, jump = (world.clockOffsetMs || 0) - (Number(d.o) || 0);
        // A jump of the demo clock during the flight: as in the frame's direct transport, neither side sees a skew.
        if (jump && d.body && typeof d.body.clientTime === 'string') d.body.clientTime = new Date(new Date(d.body.clientTime).getTime() + jump).toISOString();
        try {
          out.res = server.handle(d.api, d.body);
          if (jump && out.res && typeof out.res.serverTime === 'string') out.res.serverTime = new Date(new Date(out.res.serverTime).getTime() - jump).toISOString();
        } catch (err) { out.error = String((err && err.message) || err); }
        try { src.postMessage(out, '*'); } catch (ignore) {}
      }, LATENCY);
    } else if (d.simFrame === 'ready') {
      S.frames[key] = { key: key, win: null, app: null, direct: false, remote: src, hot: null, markSig: '', snapCache: d.snap || null };
      frameCmd(S.frames[key], { op: 'clock', offset: world.clockOffsetMs || 0 });
      tourEvent({ src: 'app', key: key, kind: 'ready' });
      scheduleRender();
    } else if (d.simFrame === 'event') {
      onFrameEvent(key, d.e || {});
    } else if (d.simFrame === 'error') {
      simError('app frame ' + key + ': ' + d.message);
    }
  });
  function renderAppPane() {
    if (S.login) ensureFrame(S.login);
    for (var k in S.frameEls) if (Object.prototype.hasOwnProperty.call(S.frameEls, k) && k !== 'owner_wide') S.frameEls[k].style.display = k === S.login ? '' : 'none';
    var s = snapOf(S.frames[S.login]);
    $('appHint').textContent = !s || !s.ready ? 'The app is starting…'
      : !s.deviceId ? 'Not enrolled yet: in Telegram open the menu (/start) → 📲 အက်ပ်, type the code here and tap ချိတ်ဆက်; or ⚡ enrol (shortcut) on the device bar.'
      : 'Click a tag on the rack: this phone scans it. The app works offline and syncs with the Sheet.';
  }
  /** The tour's highlight inside a frame: SIM_HOT (keyboard buttons and the stepper, drawn by the app) and a mark for the rest. */
  function syncFrameHot() {
    var st = curStep(), dev = st ? stepDev(st) : null;
    for (var k in S.frames) {
      if (!Object.prototype.hasOwnProperty.call(S.frames, k)) continue;
      var rec = S.frames[k], mine = !!st && dev === 'app' && k === S.login, pre = mine ? S.tour.pre : null;
      var want = mine && !pre ? (S.tour.hot || '') : '';
      if (rec.hot !== want) { rec.hot = want; frameCmd(rec, { op: 'hot', hot: want }); }
      var mk = !mine ? null : pre === 'home' ? homeMark(k) : pre ? null : frameMark(st);
      var sig = mk ? (mk.sel || '') + '|' + (mk.text || '') : '';
      if (sig || rec.markSig) { frameCmd(rec, { op: 'mark', sel: mk ? mk.sel : '', text: mk ? mk.text : '' }); rec.markSig = sig; }
    }
  }
  /** The back the pre-step 'home' asks for: the header's #back (revision 3, 13.3), or the open form's own ←. */
  function homeMark(key) {
    var s = snapOf(S.frames[key]);
    return { sel: s && (s.form || s.measForm) ? '.formpage [data-f="close"]' : '#back' };
  }
  function frameMark(st) {
    var t = st.target || {};
    if (t.ui && t.ui.indexOf('frame:') === 0) return { sel: t.ui.slice(6) };
    if (t.type) return { sel: '#codeInput, .inbar input' };
    if (t.label && !S.tour.hot) return { text: labelText(t.label) };
    return null;
  }

  /* ------------------------------ laptop: the Sheet ------------------------------ */
  function setTab(name) {
    S.tab = name;
    tourEvent({ src: 'page', kind: 'ui', name: 'tab', tab: name });
    renderAll();
  }
  function renderLaptop() {
    renderSheet();
    $('wideHolder').hidden = !S.wide;
    if (S.wide) ensureFrame('owner_wide');
  }
  function renderSheet() {
    var tabs = $('tabs');
    clear(tabs);
    var defs = [
      ['dash', 'Dashboard', null],
      ['lists', 'Lists', (world.lists || []).length],
      ['ledger', 'Ledger', world.ledger.length],
      ['customers', 'Customers', world.customers.length],
      ['credits', 'Credits', openCredits(world.ports, null).length],
      ['deposits', 'Deposits', depositsHeldList(world.ports).length],
      ['orders', 'Orders', (world.orders || []).length],
      ['meas', 'Measurements', (world.measurements || []).length],
      ['errors', 'Errors', world.errors.length],
      ['group', 'Family group', S.groupPosts.length]
    ];
    defs.forEach(function (d) {
      tabs.appendChild(h('button', { class: S.tab === d[0] ? 'on' : '', 'data-tab': d[0], onclick: function () { setTab(d[0]); } }, [
        document.createTextNode(d[1]), d[2] !== null ? h('span', { class: 'cnt', text: String(d[2]) }) : null
      ]));
    });
    var body = $('sheetBody'), ae = document.activeElement;
    // An edit in progress keeps its cell: the body is redrawn when the focus leaves it.
    if (ae && body.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) { S.sheetDirty = true; return; }
    S.sheetDirty = false;
    clear(body);
    if (S.tab === 'dash') body.appendChild(dashboard());
    if (S.tab === 'lists') body.appendChild(listsTab());
    if (S.tab === 'ledger') body.appendChild(ledgerTable());
    if (S.tab === 'customers') body.appendChild(customersTable());
    if (S.tab === 'credits') body.appendChild(creditsTable());
    if (S.tab === 'deposits') body.appendChild(depositsTable());
    if (S.tab === 'orders') body.appendChild(ordersTable());
    if (S.tab === 'meas') body.appendChild(measTable());
    if (S.tab === 'errors') body.appendChild(errorsTable());
    if (S.tab === 'group') body.appendChild(groupView());
    if (S.tab === 'ledger') body.scrollTop = body.scrollHeight;
  }
  function table(headers, rows) {
    var thead = h('thead', {}, [h('tr', {}, headers.map(function (x) { return h('th', { class: x.r ? 'r' : '', text: x.t || x, title: x.title || null }); }))]);
    return h('table', {}, [thead, h('tbody', {}, rows)]);
  }
  function td(text, cls) { return h('td', { class: cls || '', text: text === undefined || text === null ? '' : String(text) }); }
  function chip(text, cls) { return h('td', {}, [h('span', { class: 'chip ' + cls, text: text })]); }
  function empty(text) { return h('div', { class: 'empty-tab', text: text }); }

  /** Which route wrote a row: ✈️ for Telegram, 📱 and the receipt letter for an enrolled phone. */
  function routeOf(r) {
    if (!r.deviceId) return '';
    if (r.deviceId === 'TG') return '✈️';
    for (var i = 0; i < server.devices.length; i++) if (server.devices[i].id === r.deviceId) return '📱 ' + (server.devices[i].receiptLetter || '');
    return '📱';
  }
  function ledgerTable() {
    // Round 6 (8.1): the SALE rows of one group with two or more (a basket) read '🛍 i/n' in a narrow Basket column.
    var basket = {};
    world.ledger.forEach(function (r) { if (r.type === 'SALE' && !r.reversesTxId && r.groupId) (basket[r.groupId] = basket[r.groupId] || []).push(r.txId); });
    var basketMark = function (r) {
      var g = r.type === 'SALE' && !r.reversesTxId ? basket[r.groupId] : null;
      return g && g.length > 1 ? '🛍 ' + (g.indexOf(r.txId) + 1) + '/' + g.length : '';
    };
    var rows = world.ledger.map(function (r) {
      return h('tr', { class: (S.flash[r.txId] ? 'flash ' : '') + (r.reversesTxId ? 'undo' : '') }, [
        td(r.day.slice(5) + ' ' + hhmm(r.time), 'num'), td(r.shop), td(r.itemId, 'num'), chip(r.type, r.type), td(basketMark(r), 'num'),
        td(r.qty || '', 'num r'), td(money(r.amount), 'num r'), td(money(r.cash), 'num r'),
        td(r.method || (r.cash ? '(blank → CASH)' : ''), 'num'), td(r.category || ''),
        td(r.customerId ? customerName(world.ports, r.customerId) : ''), td(r.dueDay || '', 'num'), td(r.source), td(routeOf(r)),
        td(r.reversesTxId ? (r.note === 'rewrite' ? '↩ rewrite: replaced by the next row' : '↩ reverses an earlier row') : (r.transcript ? '🎤 ' + r.transcript : r.note), 'wrap')
      ]);
    });
    // A tap draws twice: at once, and again in the frame the listener scheduled. The marks are dropped by the last
    // of the two draws; dropped by the first, the second would redraw the rows without their flash before any paint.
    if (!raf) S.flash = {};
    if (!rows.length) return empty('No rows yet.');
    return table(['Time', 'Shop', 'ItemID', 'Type', { t: 'Basket', title: 'the lines of one sale of several pieces (round 6): 🛍 line / lines' }, { t: 'Qty', r: 1 }, { t: 'Amount', r: 1 }, { t: 'Cash', r: 1 }, 'Method', 'Category', 'Customer',
      { t: 'DueDay', title: 'the promised day of a part-paid sale (SALE rows only)' }, 'Source', { t: 'Route', title: '✈️ Telegram, or 📱 the phone app with its receipt letter' },
      'Note / transcript'], rows);
  }

  /** The Orders tab (core_orders.js): one row per voucher with its lines; money comes from the ledger (orderMoney), never from the row. */
  function ordersTable() {
    var list = world.orders || [];
    if (!list.length || typeof orderMoney !== 'function') return empty('No orders yet. 🧵 အော်ဒါ in the Telegram menu starts one; the row exists as soon as the customer is picked.');
    var rows = list.map(function (o) {
      var m = orderMoney(world.ports, o.id, o);
      var lines = orderLines(world.ports, o.id).map(function (l) { return l.line + '. ' + orderLineDesc(world.ports, l) + ' × ' + l.qty + (l.itemId ? ' 🏷 ' + l.itemId : ''); }).join(' · ');
      return h('tr', {}, [
        td(o.id, 'num'), td(o.shop), td(customerName(world.ports, o.customerId)), td(o.orderedDay.slice(5), 'num'), td(o.dueDay ? o.dueDay.slice(5) : '', 'num'),
        chip(o.status, o.status), td(lines, 'wrap'), td(money(m.total), 'num r'), td(money(m.paid), 'num r'), td(money(m.owed), 'num r'), td(o.measId || '', 'num')
      ]);
    });
    rows.push(h('tr', {}, [h('td', { colspan: 11, class: 'wrap', text: 'Paid / owed are computed from the Ledger. The Measurements tab holds one row per session.' })]));
    return table(['OrderID', 'Shop', 'Customer', 'Ordered', 'Due', 'Status', 'Lines', { t: 'Total', r: 1 }, { t: 'Paid', r: 1 }, { t: 'Owed', r: 1 }, 'MeasID'], rows);
  }

  /** The Measurements tab: the fixed columns, then one column per field key, every value as text ('36/30/20'). */
  function measTable() {
    var list = world.measurements || [];
    if (!list.length) return empty('No measurements yet. 📏 in Telegram (from a voucher or the orders menu) or the app\'s form adds one row per session.');
    var fieldRows = (world.measureFields || []).filter(function (f) { return f.active !== false && String(f.active).toUpperCase() !== 'FALSE'; })
      .slice().sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
    var keys = fieldRows.map(function (f) { return f.key; }), titles = {};
    fieldRows.forEach(function (f) { titles[f.key] = f.labelMy + (f.labelEn ? ' · ' + f.labelEn : ''); });
    list.forEach(function (m) { Object.keys(m.fields || {}).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    var fixed = CFG.MEAS_FIXED_COLS.map(function (c) {
      var p = c === 'MeasID' ? 'id' : c.replace(/ID$/, 'Id').replace(/URL$/, 'Url');
      return { head: c, prop: p.charAt(0).toLowerCase() + p.slice(1) };
    });
    var rows = list.map(function (m) {
      var cells = fixed.map(function (f) {
        var v = m[f.prop];
        if (f.prop === 'customerId' && v) v = v + ' · ' + customerName(world.ports, v);
        return td(v === undefined || v === null ? '' : v, f.prop === 'notes' ? 'wrap' : (f.prop === 'id' || f.prop === 'day' ? 'num' : ''));
      });
      keys.forEach(function (k) { cells.push(td((m.fields || {})[k] || '', 'num')); });
      return h('tr', {}, cells);
    });
    return table(fixed.map(function (f) { return f.head; }).concat(keys.map(function (k) { return { t: k, title: titles[k] || k }; })), rows);
  }

  /** What a Lists row looks like for change detection: a row whose text differs from the last draw flashes once. */
  function listRowSig(r) {
    return [r.label, r.active, r.order, r.shop, r.detail, r.note, r.kind].join('|');
  }
  /** Called on every 'lists' event (and once at boot): remember which rows are new or changed since the last look. */
  function markListChanges() {
    var seen = {}, first = !S.listSeen;
    (world.lists || []).forEach(function (r) {
      var id = r.list + '|' + r.key, sig = listRowSig(r);
      if (!first && S.listSeen[id] !== sig) S.listFlash[id] = true;
      seen[id] = sig;
    });
    S.listSeen = seen;
  }
  function cellId(r, field) { return (r.list === 'pay_method' ? '' : r.list + ':') + r.key + '.' + field; }
  function listEdit(r, fields) {
    world.ports.store.setListRow(r.list, r.key, fields);   // a hand edit of the cells; emits 'lists'
    tourEvent({ src: 'page', kind: 'ui', name: 'lists' });
  }
  function textCell(r, field, prop, allowEmpty) {
    var input = h('input', { class: 'cell-in', 'data-cell': cellId(r, field), 'aria-label': field + ' of ' + r.key });
    input.value = r[prop] === undefined || r[prop] === null ? '' : String(r[prop]);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('change', function () {
      var v = input.value.trim(), was = r[prop] === undefined || r[prop] === null ? '' : String(r[prop]);
      if ((!v && !allowEmpty) || v === was) { input.value = was; return; }
      var f = {};
      f[prop] = v;
      listEdit(r, f);
    });
    return h('td', {}, [input]);
  }
  /**
   * The Lists tab (rounds 4 and 5): the columns of the real tab, editable the way the owner edits cells on the laptop:
   * Label, Active, Detail and (pay_method rows) Kind, through store.setListRow; a new row through addListOptionByLabel,
   * the bot's own rule. Telegram reads the lists on every screen; a phone pulls them at its next sync.
   * Round 6b (SPEC-round-6b.md 5.7): item_category is counted in the footnote, and its new rows go through
   * addItemCategory (the sample word and a closed name are refused, as on a phone and in Telegram).
   */
  function listsTab() {
    var list = world.lists || [], wrap = h('div');
    if (!list.length) wrap.appendChild(empty('No Lists rows: the bot reads the old Settings rows (pay_methods, expense_categories, fabric_presets) and the five built-in item categories.'));
    else {
      var names = { pay_method: 'pay_method · bank / Pay accounts', expense_category: 'expense_category', fabric: 'fabric', item_category: 'item_category · item categories' };
      var rows = list.map(function (r) {
        var id = r.list + '|' + r.key, active = r.active === '' || r.active === null || r.active === undefined ? true : (r.active === true || /^(true|1|yes)$/i.test(String(r.active)));
        var box = h('input', { type: 'checkbox', 'data-cell': cellId(r, 'Active'), 'aria-label': 'Active ' + r.key });
        box.checked = active;
        box.addEventListener('change', function () { listEdit(r, { active: box.checked }); });
        var kindCell = td('');
        if (r.list === 'pay_method') {
          var sel = h('select', { class: 'cell-in', 'data-cell': cellId(r, 'Kind'), 'aria-label': 'Kind of ' + r.key },
            ['', 'wallet', 'bank'].map(function (k) { return h('option', { value: k, text: k || '(blank)' }); }));
          sel.value = r.kind === undefined || r.kind === null ? '' : String(r.kind).toLowerCase();
          sel.addEventListener('change', function () { listEdit(r, { kind: sel.value }); });
          kindCell = h('td', {}, [sel]);
        }
        return h('tr', { class: (S.listFlash[id] ? 'flash ' : '') + (active ? '' : 'undo') }, [
          chip(r.list, r.list), td(r.key, 'num'), textCell(r, 'Label', 'label', false), h('td', {}, [box]), td(r.order || '', 'num r'), td(r.shop || 'both'),
          textCell(r, 'Detail', 'detail', true), kindCell, td(r.note || '', 'wrap')
        ]);
      });
      if (!raf) S.listFlash = {};   // as in ledgerTable: the marks live until the scheduled draw
      rows.push(h('tr', {}, [h('td', { colspan: 9, class: 'wrap', text: t(world.ports, 'lists_note_kind') + '. ' +
        'Key is what the Ledger stores (Method, Category) and never changes; Label is what the buttons show. ' +
        'Detail = account number and holder (printed on receipts and vouchers that still carry a balance), or the emoji of an expense category, or the emoji Telegram shows for an item category. ' +
        Object.keys(names).map(function (k) { return list.filter(function (r) { return r.list === k; }).length + ' ' + names[k]; }).join(' · ') })]));
      wrap.appendChild(table(['List', 'Key', 'Label', 'Active', { t: 'Order', r: 1 }, 'Shop', 'Detail', 'Kind', 'Note'], rows));
    }
    wrap.appendChild(addRowForm());
    return wrap;
  }
  function addRowForm() {
    var listSel = h('select', { class: 'cell-in', 'data-cell': 'add-list', 'aria-label': 'list' }, CFG.LIST_NAMES.map(function (n) { return h('option', { value: n, text: n }); }));
    var label = h('input', { class: 'cell-in', 'data-cell': 'add', placeholder: 'Label (e.g. AYA Pay)', 'aria-label': 'label of the new row' });
    var kind = h('select', { class: 'cell-in', 'data-cell': 'add-kind', 'aria-label': 'kind' }, ['', 'wallet', 'bank'].map(function (k) { return h('option', { value: k, text: k || 'Kind (blank)' }); }));
    listSel.addEventListener('change', function () { kind.hidden = listSel.value !== 'pay_method'; });
    var add = h('button', { class: 'btn small primary', text: 'Add', onclick: function () { addListRow(listSel.value, label.value, kind.value); } });
    label.addEventListener('keydown', function (e) { if (e.key === 'Enter') add.click(); });
    return h('div', { class: 'addrow' }, [h('span', { class: 'lbl', text: 'Add a row:' }), listSel, label, kind, add, h('span', { class: 'lbl', text: S.addNote })]);
  }
  function addListRow(list, label, kind) {
    var res = list === 'item_category' ? addItemCategory(world.ports, label, SIM_USERS.owner, '')
      : addListOptionByLabel(world.ports, list, label, SIM_USERS.owner, { kind: list === 'pay_method' ? kind : '' });
    S.addNote = !res.ok ? (res.reason === 'empty' ? 'Type a name first (digits alone are not a name).' : 'Not added: ' + res.reason)
      : res.existed ? '"' + res.label + '" is already there (key ' + res.key + ').' : 'Added "' + res.label + '" (key ' + res.key + ').';
    tourEvent({ src: 'page', kind: 'ui', name: 'lists' });
    if (document.activeElement && $('sheetBody').contains(document.activeElement)) document.activeElement.blur();
    renderAll();
    return res;
  }

  /** A:E as typed (name, phone, note) plus the F:K view the script rewrites (customerSummaries). */
  function customersTable() {
    if (!world.customers.length) return empty('No customers yet. One is created when a sale names a buyer, a deposit is taken, or an order is started.');
    var rows = customerSummaries(world.ports).map(function (c) {
      return h('tr', {}, [td(c.id, 'num'), td(c.name), td(c.phone ? fmtPhone(c.phone) : '', 'num'),
        td(money(c.bought), 'num r'), td(money(c.paid), 'num r'), td(money(c.owed), 'num r'), td(money(c.depositHeld), 'num r'),
        td(c.lastDay, 'num'), td(c.visits, 'num r'), td(c.note, 'wrap')]);
    });
    return table(['CustomerID', 'Name', 'Phone', { t: 'Bought', r: 1 }, { t: 'Paid', r: 1 }, { t: 'Owed', r: 1 }, { t: 'Deposit held', r: 1 }, 'Last visit', { t: 'Visits', r: 1 }, 'Note'], rows);
  }
  function creditsTable() {
    var credits = openCredits(world.ports, null);
    if (!credits.length) return empty('Nothing owed. Open credits appear here with the day, the item, what was paid, what is still owed and the promised day.');
    var rows = credits.map(function (c) {
      return h('tr', {}, [td(c.day, 'num'), td(c.shop), td(c.customer), td(c.item), td(money(c.total), 'num r'), td(money(c.cash), 'num r'),
        td(money(c.payments), 'num r'), td(money(c.applied), 'num r'), td(money(c.owed), 'num r'), td(c.days, 'num r'),
        td(c.dueDay || '', 'num'), td(c.overdue ? '⏰' : '')]);
    });
    return table(['Day', 'Shop', 'Customer', 'Item', { t: 'Total', r: 1 }, { t: 'Cash at sale', r: 1 }, { t: 'Payments', r: 1 }, { t: 'Deposit used', r: 1 },
      { t: 'Owed', r: 1 }, { t: 'Days', r: 1 }, 'DueDay', { t: 'Overdue', title: 'past DueDay, or past ' + CFG.OVERDUE_DAYS + ' days when no day was promised' }], rows);
  }
  function depositsTable() {
    var list = depositsHeldList(world.ports);
    if (!list.length) return empty('No deposits held.');
    var rows = list.map(function (d) { return h('tr', {}, [td(d.customer), td(money(d.received), 'num r'), td(money(d.used), 'num r'), td(money(d.held), 'num r'), td(d.lastDay, 'num')]); });
    return table(['Customer', { t: 'Received', r: 1 }, { t: 'Used', r: 1 }, { t: 'Held', r: 1 }, 'Last'], rows);
  }
  function dashboard() {
    var day = dayKey(world.ports.clock.now());
    var box = h('div', { class: 'dash' });
    box.appendChild(h('div', { class: 'eyebrow', text: 'Today · ' + fmtDayMy(day) + ' · Asia/Yangon' }));
    CFG.SHOP_IDS.forEach(function (shop) {
      var s = dayStats(world.ports, shop, day);
      var low = lowStockList(world.ports, shop);
      var owed = openCredits(world.ports, shop).reduce(function (a, c) { return a + c.owed; }, 0);
      var tiles = [['Revenue', s.revenue], ['Pieces', s.pieces], ['Cash in', s.cashIn], ['Drawer (net)', s.drawerNet], ['Bank (net)', s.bankNet],
                   ['Expenses', s.expenses], ['COGS', s.cogs], ['Operating profit', s.profit]].map(function (tp) {
        var isPieces = tp[0] === 'Pieces';
        var cls = tp[0] === 'Operating profit' ? (tp[1] < 0 ? 'neg' : tp[1] > 0 ? 'pos' : '') : '';
        return h('div', { class: 'tile' }, [h('div', { class: 'k', text: tp[0] }), h('div', { class: 'v ' + cls, text: isPieces ? String(tp[1]) : money(tp[1]) })]);
      });
      var card = h('div', { class: 'shop' }, [h('h3', { text: shopName(world.ports, shop) }), h('div', { class: 'tiles six' }, tiles)]);
      if (s.unknownCostPieces) card.appendChild(h('div', { class: 'note', text: s.unknownCostPieces + ' piece(s) sold without a known cost, so gross profit is understated.' }));
      card.appendChild(h('div', { class: 'low' }, [h('span', { class: 'eyebrow', text: 'Still owed by customers ' }), h('span', { class: 'num', text: money(owed) })]));
      var lowRow = h('div', { class: 'low' }, [h('span', { class: 'eyebrow', text: 'Low stock ' })]);
      if (low.length) low.forEach(function (it) { lowRow.appendChild(h('span', { class: 'chip ' + (it.stock <= 0 ? 'err' : 'RETURN'), text: it.name + ' · ' + it.stock })); });
      else lowRow.appendChild(h('span', { text: 'none', style: 'color:var(--muted)' }));
      card.appendChild(lowRow);
      box.appendChild(card);
    });
    var deposits = depositsHeldList(world.ports);
    var depTotal = deposits.reduce(function (a, d) { return a + d.held; }, 0);
    box.appendChild(h('div', { class: 'low' }, [h('span', { class: 'eyebrow', text: 'Deposits held ' }), h('span', { class: 'num', text: money(depTotal) }),
      h('span', { style: 'color:var(--muted)', text: deposits.length ? ' · ' + deposits.map(function (d) { return d.customer + ' ' + money(d.held); }).join(', ') : '' })]));
    box.appendChild(h('div', { class: 'note', text: 'In the real Sheet these are SUMIFS formulas over the Ledger tab; the Credits and Deposits tabs are rewritten by the script after every credit-related row and at 21:00.' }));
    return box;
  }
  function errorsTable() {
    if (!world.errors.length) return empty('Empty. This tab is your inbox: unknown users who pressed START, AI failures, and the family group id appear here.');
    var rows = world.errors.map(function (e) {
      return h('tr', {}, [td(hhmm(e.time), 'num'), chip(e.where, e.where === 'unknown_user' || e.where === 'group_chat' ? 'info' : 'err'), td(e.message, 'wrap')]);
    });
    return table(['Time', 'Where', 'Message'], rows);
  }
  function groupView() {
    var box = h('div', { class: 'group' });
    var family = '👨' + ZWJ + '👩' + ZWJ + '👧';
    box.appendChild(h('div', { class: 'eyebrow', text: family + ' Family group · the bot posts here at 21:00 every day' }));
    if (!S.groupPosts.length) box.appendChild(empty('Nothing posted yet. Use “Post 21:00 summary” in the header to run the trigger now.'));
    S.groupPosts.forEach(function (p) {
      box.appendChild(h('div', { class: 'post' }, [h('div', { class: 'from', text: 'ShopTagBot · ' + hhmm(p.time) }), document.createTextNode(p.text)]));
    });
    return box;
  }

  /* ------------------------------ header actions ------------------------------ */
  /** The demo clock is an offset: every button adds to world.clockOffsetMs, so time keeps moving after the jump. */
  function clockAdd(ms, name) {
    world.clockOffsetMs = (world.clockOffsetMs || 0) + ms;
    framesClock();
    tourEvent({ src: 'page', kind: 'ui', name: name });
    renderAll();
  }
  function clockTo2100() {
    var now = world.ports.clock.now();
    var at = new Date(dayKey(now) + 'T21:00:00.000Z').getTime() - YANGON_OFFSET_MS;
    if (at <= now.getTime()) at += 86400000;   // past 21:00 already: the next 21:00 (the demo clock never runs backwards)
    clockAdd(at - now.getTime(), 'clock2100');
  }
  function postSummary() {
    var now = world.ports.clock.now();
    var text = buildDailySummary(world.ports, dayKey(now)) + '\n' + server.summaryLines().join('\n');
    S.groupPosts.push({ time: now.toISOString(), text: text.replace(/\s+$/, '') });
    if (S.login === 'owner') { S.device = 'laptop'; S.tab = 'group'; } else note('Posted to the Family group (the owner sees it on 💻 › Family group).');
    tourEvent({ src: 'page', kind: 'ui', name: 'summary' });
    renderAll();
  }
  /** Settings sale_flow from the laptop: Telegram reads it at once, the ready frames pull it now (the settings hash changed). */
  function setFlow(v) {
    world.settings.sale_flow = v;
    framesSync('settings');
    tourEvent({ src: 'page', kind: 'ui', name: 'flow', value: v });
    renderAll();
  }
  function printSheet() {
    var ps = $('printSheet');
    clear(ps);
    ps.appendChild(h('div', { class: 'ptop' }, [
      h('button', { class: 'btn primary', text: 'Print', onclick: function () { window.print(); } }),
      h('button', { class: 'btn', text: 'Close', onclick: function () { ps.hidden = true; } }),
      h('span', { style: 'color:var(--muted);font-size:12px', text: 'A4, 4 × 8 tags. Registered tags show the item name; blank tags are ready for new pieces. tools/make_tags.py makes the same sheet as a PDF.' })
    ]));
    var grid = h('div', { class: 'ptags' });
    world.ports.store.listItems(null).forEach(function (it) {
      var qr = h('div', { class: 'qr' });
      makeQr(qr, 'https://t.me/' + BOT + '?start=' + it.id);
      grid.appendChild(h('div', { class: 'ptag' }, [qr, h('div', {}, [h('div', { class: 'id', text: it.id }), h('div', { class: 'nm', text: it.name || 'scan → START' })])]));
    });
    ps.appendChild(grid);
    ps.hidden = false;
  }

  /* ------------------------------ tours ("what can I do") ------------------------------ */
  function findTour(id) { for (var i = 0; i < SIM_TOURS.length; i++) if (SIM_TOURS[i].id === id) return SIM_TOURS[i]; return null; }
  function curStep() { return S && S.tour && !S.tour.finished && !S.tour.blocked ? S.tour.steps[S.tour.i] || null : null; }
  function stepDev(st) { return st.device || S.tour.dev; }
  function stepLogin(st) { return st.login || S.tour.login; }
  /** Why a tour with need.ai does not start while the owner's AI switch is off (the panel shows it with Reset). */
  var AI_OFF_TOUR = 'AI is off in this demo (the owner\'s app Settings): turn it on, or press Reset, to run this tour.';
  function tourBlocked(tour) {
    var n = tour.need || {};
    if (n.item) { var it = itemView(n.item); if (!it || it.stock <= 0) return n.item + ' is already sold in this demo: press Reset to run this tour again.'; }
    if (n.blank) { var b = itemView(n.blank); if (!b || b.status !== 'BLANK') return 'Tag ' + n.blank + ' is no longer blank: press Reset to run this tour again.'; }
    if (n.unenrolled && frameEnrolled(tour.login)) return 'This phone is already enrolled: press Reset to see the enrolment again.';
    // Round 6 (13.11): with the owner's AI switch off the bot drops its AI buttons (the sheet photo), so a tour that
    // taps one would wait on a button that never comes; the bot reads the switch from the world's Settings.
    if (n.ai && !aiOn(world.ports)) return AI_OFF_TOUR;
    return '';
  }
  function tourStart(id) {
    var tour = findTour(id);
    if (!tour) return false;
    var dev = tour.devices && tour.devices.indexOf(S.device) >= 0 ? S.device : tour.device;
    S.tour = { id: id, tour: tour, login: tour.login, dev: dev, i: 0, hot: '', hotDev: '', want: '', finished: false, pre: null, ask: 0, switched: '', mark: {}, filledFor: -1,
      steps: tour.steps.filter(function (s) { var d = s.device || dev; return !s.only || s.only === d; }) };
    S.tour.blocked = tourBlocked(tour);
    if (!S.tour.blocked) enterStep();
    renderAll();
    return true;
  }
  function switchText(login, dev) {
    var L = LOGINS[login] || LOGINS.owner, D = DEV_NAMES[dev] || DEV_NAMES.tg;
    return { my: '🔁 ' + L.icon + ' ' + L.my + ' · ' + D.icon + ' ' + D.my + ' သို့ ပြောင်းပြီး', en: 'Switched to ' + L.en + ' · ' + D.icon + ' ' + D.en };
  }
  /** A step begins: the pane and the login switch when the step says so; a phone that is not enrolled is enrolled first. */
  function enterStep() {
    var T = S.tour, st = T.steps[T.i];
    if (!st) { finishTour(); return; }
    var login = stepLogin(st), dev = stepDev(st), moved = false;
    if (login === 'customer') {
      if (!S.user || S.user.id !== SIM_USERS.customer.id) { S.user = SIM_USERS.customer; S.pendingStart = null; moved = true; }
    } else if (S.login !== login || !S.user || S.user.id !== SIM_USERS[login].id) {
      S.login = login; S.user = SIM_USERS[login]; S.pendingStart = null; moved = true;
    }
    if (dev !== 'floor' && S.device !== dev) { S.device = dev; moved = true; }
    if (S.device === 'app') ensureFrame(S.login);
    if (S.device === 'laptop' && S.wide) ensureFrame('owner_wide');
    T.switched = moved ? switchText(login, dev) : '';
    var snap0 = dev === 'app' ? snapOf(S.frames[S.login]) : null;
    // formN: the open form's last control count when the step began (spec 8.3): a control used earlier never completes this step.
    T.mark = { meas: (world.measurements || []).length, ledger: world.ledger.length, formN: snap0 && snap0.form && snap0.form.last ? snap0.form.last.n : 0 };
    T.filledFor = -1;
    T.pre = dev === 'app' && !T.tour.noAutoEnrol ? framePre(S.login) : null;
    T.ask = 0;
    // Over postMessage the snapshot can be older than a screen the user just opened in the app: the frame is asked for
    // a fresh one, and its answer (onFrameEvent) sets the pre-step this snapshot missed.
    var rec = dev === 'app' && !T.tour.noAutoEnrol ? S.frames[S.login] : null;
    if (rec && !rec.direct) { T.ask = ++snapAsks; frameCmd(rec, { op: 'snap', id: T.ask }); }
    T.want = resolveWant(st);
    if (!T.pre) checkStep({ src: 'page', kind: 'enter' });
  }
  function checkStep(e) {
    var T = S.tour, st = T.steps[T.i], ok = false;
    if (!st) return;
    try { ok = !!st.done(e, makeCtx()); } catch (err) { simError('tour ' + T.id + ' step ' + (T.i + 1) + ': ' + ((err && err.message) || err)); }
    if (ok) advance();
    else { var w = resolveWant(st); if (w) T.want = w; }
  }
  function advance() {
    var T = S.tour;
    T.i++;
    T.want = '';
    T.hot = '';
    if (T.i >= T.steps.length) finishTour(); else enterStep();
    scheduleRender();
  }
  function finishTour() {
    var T = S.tour;
    T.finished = true;
    T.hot = '';
    if (S.user && S.login && S.user.id !== SIM_USERS[S.login].id) S.user = SIM_USERS[S.login];   // the previous login comes back
  }
  function tourLeave() {
    if (!S.tour) return;
    if (S.user && S.login && S.user.id !== SIM_USERS[S.login].id) S.user = SIM_USERS[S.login];
    S.tour = null;
    renderAll();
  }
  function tourSkip() {
    var T = S.tour;
    if (!T || T.finished || T.blocked) return;
    T.ask = 0;   // a skipped pre-step stays skipped when the frame's fresh snapshot comes in
    if (T.pre) T.pre = null; else advance();
    renderAll();
  }
  /** Every event of the world, a frame or the page: is the current step done? */
  function tourEvent(e) {
    var T = S && S.tour;
    if (!T || T.finished || T.blocked) return;
    if (e.src === 'tg' && e.uid !== undefined && S.user && Number(e.uid) !== Number(S.user.id)) return;
    if (e.src === 'app' && e.key && e.key !== S.login) return;
    if (T.pre) {
      T.pre = framePre(S.login);   // enrolled meanwhile, or the phone left its chat screen: the caption follows
      if (!T.pre) { T.want = resolveWant(T.steps[T.i]); checkStep({ src: 'page', kind: 'enter' }); }
      scheduleRender();
      return;
    }
    checkStep(e);
  }
  function lastBotFor(dev) {
    if (dev === 'app') { var s = snapOf(S.frames[S.login]); return s ? s.last : null; }
    return S.user ? world.sim.lastBot(S.user) : null;
  }
  function buttonWhere(m, test) {
    var rows = (m && m.keyboard) || [];
    for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) if (test(rows[r][c])) return String(rows[r][c].callback_data);
    return '';
  }
  /**
   * The label rule (spec 6.4): a key's text up to its first '{', trimmed. MSG keys from the world's ports, APP_MSG keys
   * from a frame: asked directly, or (postMessage, no parent.SIM) the labels it posted when ready and at each sync.
   */
  function labelText(key) {
    if (MSG[key] !== undefined) return msgTemplate(world.ports, key).split('{')[0].trim();
    var k, rec, s;
    for (k in S.frames) {
      if (!Object.prototype.hasOwnProperty.call(S.frames, k) || !S.frames[k].direct) continue;
      try { s = S.frames[k].win.SIM_FRAME.label(key); if (s && s !== key) return s; } catch (ignore) {}
    }
    for (k in S.frames) {
      if (!Object.prototype.hasOwnProperty.call(S.frames, k)) continue;
      rec = S.frames[k];
      s = rec.labels && Object.prototype.hasOwnProperty.call(rec.labels, key) ? String(rec.labels[key]) : '';
      if (s && s !== key) return s;
    }
    return '';
  }
  /** The callback the step's target names on the screen now ('' while it is not there). */
  function resolveWant(st) {
    var t = (st && st.target) || {}, dev = stepDev(st);
    if (t.cb) return t.cb;
    if (!t.label && !t.re) return '';
    var m = lastBotFor(dev);
    if (!m) return '';
    if (t.re) { var rx = new RegExp(t.re); return buttonWhere(m, function (b) { return rx.test(String(b.callback_data)); }); }
    if (dev === 'tg' && MSG[t.label] !== undefined) { try { return world.sim.buttonByKey(m, t.label) || ''; } catch (err) { return ''; } }
    var text = labelText(t.label);
    return text ? buttonWhere(m, function (b) { return String(b.text).indexOf(text) >= 0; }) : '';
  }
  function computeHot() {
    var T = S.tour;
    if (!T) return;
    var st = curStep();
    if (!st || T.pre) { T.hot = ''; T.hotDev = ''; return; }
    var w = resolveWant(st);
    if (w) T.want = w;
    var t = st.target || {};
    T.hot = t.f ? 'f:' + t.f : t.cb || t.label || t.re ? (T.want || '') : '';   // an f target: the frame marks [data-f] by SIM_HOT 'f:<name>'
    T.hotDev = stepDev(st);
  }
  /** Page chrome the step names (a header button, a device, a tab, a Lists cell) carries the highlight after each render. */
  function markUiHot() {
    Array.prototype.slice.call(document.querySelectorAll('.hot-ui')).forEach(function (el) { el.className = el.className.replace(/\s*\bhot-ui\b/g, '').replace(/\s*\bhot\b/g, ''); });
    var T = S.tour, st = curStep(), sel = '';
    if (T && T.pre && !T.finished) sel = '#enrolShortcut';
    else if (st) {
      var t = st.target || {};
      if (t.ui && t.ui.indexOf('frame:') !== 0) sel = t.ui;
      else if (t.tab) sel = t.cell && S.tab === t.tab ? '[data-cell="' + t.cell + '"]' : '#tabs [data-tab="' + t.tab + '"]';
    }
    var el = sel ? document.querySelector(sel) : null;
    if (el && (' ' + el.className + ' ').indexOf(' hot ') < 0) el.className += ' hot hot-ui';
  }
  function lastEnrolCode() {
    var login = S.login && S.login !== 'customer' ? S.login : 'sister', list = world.chats[SIM_USERS[login].id] || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m.from !== 'bot' || String(m.text || '').indexOf('🔑') < 0) continue;
      var hit = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(m.text);
      if (hit) return hit[1];
    }
    return '';
  }
  /** What a step's done() and act() see. */
  function makeCtx() {
    var T = S.tour;
    return {
      world: world, server: server, login: S.login, user: S.user, device: S.device, tab: S.tab, groupPosts: S.groupPosts,
      frame: snapOf(S.frames[S.login]), want: T ? T.want : '', mark: T ? T.mark : {}, code: lastEnrolCode(),
      tapData: function (d) { tapOn(S.device, d); }, text: function (v) { typeOn(S.device, v); }, scan: scan, start: pressStart, photo: sendPhoto,
      click: function (sel) { var el = document.querySelector(sel); if (el) el.click(); return !!el; }, openTab: setTab,
      setListRow: function (l, k, f) { world.ports.store.setListRow(l, k, f); tourEvent({ src: 'page', kind: 'ui', name: 'lists' }); },
      addList: addListRow, frameCmd: function (c) { return frameCmd(S.frames[S.login], c); }
    };
  }
  function lastBotHaving(user, data) {
    var list = world.chats[user.id] || [];
    for (var i = list.length - 1; i >= 0; i--) if (list[i].from === 'bot' && buttonWhere(list[i], function (b) { return b.callback_data === data; })) return list[i];
    return null;
  }
  /** Telegram: press the rendered button that carries this data-cb (the newest one), else tap the newest message that has it. */
  function tapOn(dev, data) {
    if (dev === 'app') { frameCmd(S.frames[S.login], { op: 'tap', data: data }); return; }
    if (S.device === 'tg') renderPhone();
    var btns = document.querySelectorAll('#chat .kb button');
    for (var i = btns.length - 1; i >= 0; i--) if (btns[i].getAttribute('data-cb') === data) { btns[i].click(); return; }
    var m = lastBotHaving(S.user, data);
    if (!m) throw new Error('no button ' + data + ' in the chat');
    world.sim.tap(S.user, m.id, data);
  }
  function typeOn(dev, v) {
    if (dev === 'app') { frameCmd(S.frames[S.login], { op: 'text', text: v }); return; }
    $('textIn').value = '';
    world.sim.text(S.user, v);
  }
  /** ⏭ do it for me. */
  function tourDoIt() {
    var T = S.tour;
    if (!T || T.finished || T.blocked) return;
    if (T.pre === 'home') { frameCmd(S.frames[S.login], { op: 'screen', screen: 'home' }); tourEvent({ src: 'page', kind: 'ui', name: 'home' }); renderAll(); return; }
    if (T.pre) { enrolShortcut(S.login); return; }
    var st = curStep();
    if (!st) return;
    try {
      if (st.act) st.act(makeCtx());
      else doTarget(st);
    } catch (err) { simError('do it for me, tour ' + T.id + ' step ' + (T.i + 1) + ': ' + ((err && err.message) || err)); }
    renderAll();
  }
  function doTarget(st) {
    var t = st.target || {}, dev = stepDev(st);
    if (t.tag) { scan(t.tag); return; }
    if (t.ui === '#startbar button') { pressStart(); return; }
    if (t.f) {   // a control of the app's form (8.3): a value through the frame's set op, a tap through its click op
      if (t.value !== undefined) frameCmd(S.frames[S.login], { op: 'set', f: t.f, value: t.value });
      else frameCmd(S.frames[S.login], { op: 'click', sel: '[data-f="' + t.f + '"]' });
      return;
    }
    if (t.cb || t.label || t.re) {
      var d = resolveWant(st) || S.tour.want;
      if (!d) { note('The button is not on the screen yet.'); return; }
      tapOn(dev, d);
      return;
    }
    if (t.type) {
      var v = t.type === '@code' ? lastEnrolCode() : String(t.type);
      if (v) typeOn(dev, v);
      return;
    }
    if (t.tab) { setTab(t.tab); return; }
    if (t.ui && t.ui.indexOf('frame:') === 0) { frameCmd(S.frames[S.login], { op: 'click', sel: t.ui.slice(6) }); return; }   // inside the app frame (8.1)
    if (t.ui) { var el = document.querySelector(t.ui); if (el) el.click(); }
  }
  function fmtCaption(s) {
    return String(s || '').replace(/\{(k|f|l|v|c):([^}]+)\}/g, function (all, kind, arg) {
      if (kind === 'v') return SIM_TOUR_MSG[arg] || arg;
      if (kind === 'c') return lastEnrolCode() || '…';
      if (kind === 'k') return labelText(arg) || arg;
      if (kind === 'f') {
        var p = arg.split('|'), vars = {};
        p.slice(1).forEach(function (kv) { var q = kv.split('='); vars[q[0]] = q[1]; });
        return t(world.ports, p[0], vars);
      }
      var q2 = arg.split('.'), o = listOption(world.ports, q2[0], q2[1]);
      return o ? o.label : q2[1];
    });
  }
  function renderTours() {
    var box = $('toursBody');
    clear(box);
    if (!S.login) { box.appendChild(h('p', { class: 'intro', text: 'Log in first: owner, seller shop 1 or seller shop 2.' })); return; }
    var T = S.tour;
    if (!T) {
      box.appendChild(h('p', { class: 'intro', text: 'Pick a job: the panel says what to tap next and highlights it. ⏭ does a step for you. The sellers\' jobs run on the app\'s forms (📱); the Telegram review card has its own tour; a payment and a deposit run on the device that is open (✈️ or 📱).' }));
      var list = h('div', { class: 'list' });
      SIM_TOURS.forEach(function (tour) {
        var icon = DEV_NAMES[tour.device].icon + (tour.devices ? '📱' : '');
        list.appendChild(h('button', { 'data-tour': tour.id, onclick: function () { tourStart(tour.id); } }, [
          h('span', { class: 'ic', text: tour.devices ? '✈️' : DEV_NAMES[tour.device].icon, title: icon }), h('span', { class: 'my', text: tour.title.my }), h('span', { class: 'en', text: tour.title.en })
        ]));
      });
      box.appendChild(list);
      return;
    }
    box.appendChild(h('h3', { text: T.tour.title.my + ' · ' + T.tour.title.en }));
    var acts = h('div', { class: 'acts' });
    if (T.blocked) {
      box.appendChild(h('div', { class: 'warn', text: T.blocked }));
      acts.appendChild(h('button', { class: 'btn primary', text: 'Reset', onclick: reset }));
      acts.appendChild(h('button', { class: 'btn', text: '← all tours', onclick: tourLeave }));
      box.appendChild(acts);
      return;
    }
    if (T.finished) {
      box.appendChild(h('div', { class: 'done', text: '✅ ပြီးပါပြီ · Done' }));
      box.appendChild(h('p', { class: 'cap-en', text: 'Every step of this tour happened. Look at the Sheet on the owner\'s 💻, or pick another job.' }));
      acts.appendChild(h('button', { class: 'btn primary', id: 'tourBack', text: '← all tours', onclick: tourLeave }));
      box.appendChild(acts);
      return;
    }
    var st = curStep();
    box.appendChild(h('div', { class: 'step', text: 'Step ' + (T.i + 1) + ' / ' + T.steps.length + ' · ' + DEV_NAMES[stepDev(st)].icon + ' ' + DEV_NAMES[stepDev(st)].en }));
    if (T.switched) box.appendChild(h('div', { class: 'switched', text: T.switched.my + ' · ' + T.switched.en }));
    if (T.pre === 'home') {
      box.appendChild(h('div', { class: 'cap-my', text: '📱 ' + fmtCaption('{k:ui_btn_back} {v:tap}') }));
      box.appendChild(h('p', { class: 'cap-en', text: fmtCaption('First back to the app\'s home: tap {k:ui_btn_back} at the top left of the phone.') }));
    } else if (T.pre) {
      box.appendChild(h('div', { class: 'cap-my', text: '📱 ဒီဖုန်းကို အရင် ချိတ်ဆက်ပါ' }));
      box.appendChild(h('p', { class: 'cap-en', text: 'First enrol this phone: ⚡ enrol (shortcut) on the device bar does it (the "Enrol a phone" tour shows the honest way, with the code from Telegram).' }));
    } else {
      box.appendChild(h('div', { class: 'cap-my', text: fmtCaption(st.my) }));
      box.appendChild(h('p', { class: 'cap-en', text: fmtCaption(st.en) }));
    }
    acts.appendChild(h('button', { class: 'btn primary', id: 'tourDo', text: '⏭ do it for me', onclick: tourDoIt }));
    acts.appendChild(h('button', { class: 'btn', id: 'tourSkip', text: 'skip', onclick: tourSkip }));
    acts.appendChild(h('button', { class: 'btn', id: 'tourLeave', text: '✖ leave the tour', onclick: tourLeave }));
    box.appendChild(acts);
  }

  /* ------------------------------ SIM.smoke() (spec 6.6) ------------------------------ */
  function waitFor(fn, ms) {
    var until = Date.now() + (ms || 15000);
    return new Promise(function (res) {
      (function poll() {
        var ok = false;
        try { ok = !!fn(); } catch (ignore) {}
        if (ok) { res(true); return; }
        if (Date.now() > until) { res(false); return; }
        setTimeout(poll, 40);
      })();
    });
  }
  /**
   * The page-side autorun the browser check reads: {passed, failed, errors, checks}. Taps name exact callback data
   * except where a placeholder-free label is given (the label rule); Telegram taps press the rendered buttons.
   */
  function smoke() {
    var R = { passed: 0, failed: 0, errors: [], checks: [] }, errAt = window.SIM_ERRORS.length, worldErrAt = world.errors.length;
    function ok(cond, label, got) {
      if (cond) R.passed++; else R.failed++;
      var why = '';
      if (!cond && got !== undefined) { try { why = ' | got: ' + JSON.stringify(got).slice(0, 400); } catch (ignore) { why = ' | got: ?'; } }
      R.checks.push((cond ? 'ok   ' : 'FAIL ') + label + why);
      return !!cond;
    }
    function tgTap(data) { renderAll(); tapOn('tg', data); }
    function tgKey(key) { var d = world.sim.buttonByKey(world.sim.lastBot(S.user), key); if (!d) throw new Error('no button for ' + key); tgTap(d); }
    function tgStart(id) {
      scan(id);
      renderAll();
      var b = $('startbar').querySelector('button');
      if (!ok(!!b && !$('startbar').hidden, 'a scan of ' + id + ' shows the START bar')) throw new Error('no START');
      b.click();
    }
    /** The sister's open form as her frame's snapshot shows it (appFormSnap), or null: every wait below reads it. */
    function formOf() { var s = snapOf(S.frames.sister); return s ? s.form : null; }
    function lineIds() { var f = formOf(); return f ? f.lines.map(function (l) { return l.id; }).join(',') : ''; }
    function lineOf(id) { var f = formOf(), out = null; ((f && f.lines) || []).forEach(function (l) { if (l.id === id) out = l; }); return out; }
    /** The form closed and the home shows the reply card whose text holds this MSG key's label. */
    function soldShown(key) {
      var head = labelText(key);
      return function () { var s = snapOf(S.frames.sister); return !!s && !s.form && !!s.last && !!head && s.last.text.indexOf(head) >= 0; };
    }
    function step(label, fn) {
      return function () { return Promise.resolve().then(fn).then(null, function (err) { ok(false, label + ': ' + ((err && err.message) || err)); }); };
    }
    var today = dayKey(world.ports.clock.now()), n0 = 0;
    if (S.tour) tourLeave();
    var seq = [
      step('login', function () {
        doLogin('sister');
        setDevice('tg');
        ok(S.login === 'sister' && $('login').hidden, 'logged in as Seller shop 1, the login screen closed');
      }),
      // Step-4 checker (spec 8.1): the header switch writes Settings sale_flow and lights its own half.
      step('the form/quick switch', function () {
        var lit = function () { return ($('flowForm').className === 'on' ? 'form' : '') + ($('flowQuick').className === 'on' ? 'quick' : ''); };
        var at0 = saleFlow(world.ports) + ':' + lit();
        $('flowQuick').click();
        var atQ = saleFlow(world.ports) + ':' + lit();
        $('flowForm').click();
        ok(at0 === 'form:form' && atQ === 'quick:quick' && saleFlow(world.ports) + ':' + lit() === 'form:form',
          'the page boots on form with form lit; quick sets Settings sale_flow quick and lights quick alone; form sets it back', [at0, atQ, lit()]);
      }),
      step('the simplest sale', function () {
        n0 = world.ledger.length;
        tgStart('S1-0002');
        tgKey('btn_sell_one');
        tgTap('SC|S1-0002|ok');
        var rows = world.ledger.slice(n0);
        ok(rows.length === 1 && rows[0].type === 'SALE' && rows[0].itemId === 'S1-0002' && Number(rows[0].cash) === 18000, 'Telegram: START, ✅ ရောင်း ၁, ✅ သိမ်း write one SALE row, cash 18,000');
      }),
      step('the deposit sale', function () {
        n0 = world.ledger.length;
        var c0 = world.customers.length;
        tgStart('S1-0004');
        tgKey('btn_sold');
        tgTap('SS|S1-0004|o|buyer');
        tgKey('btn_new_customer');
        typeOn('tg', 'ဒေါ်စန်း');
        typeOn('tg', '09777123456');
        tgTap('SS|S1-0004|o|paid');
        tgTap('SS|S1-0004|p|half');   // basketNext opens the promised-day sub-screen
        tgTap('SS|S1-0004|d|14');
        tgTap('SC|S1-0004|ok');
        var rows = world.ledger.slice(n0), cr = null;
        openCredits(world.ports, null).forEach(function (c) { if (c.customer === 'ဒေါ်စန်း') cr = c; });
        ok(rows.length === 1 && rows[0].type === 'SALE' && rows[0].itemId === 'S1-0004' && Number(rows[0].cash) === 22500, 'the deposit sale: one SALE row, cash 22,500');
        ok(!!cr && cr.owed === 22500, 'ဒေါ်စန်း owes 22,500');
        ok(world.customers.length === c0 + 1 && world.customers[world.customers.length - 1].name === 'ဒေါ်စန်း', 'one new customer, ဒေါ်စန်း');
        ok(!!rows[0] && rows[0].dueDay === addDaysKey(today, 14), 'DueDay = today + 14');
      }),
      step('app: enrol', function () {
        setDevice('app');
        return waitFor(function () { return !!S.frames.sister && !!snapOf(S.frames.sister); }, 30000).then(function (r) {
          if (!ok(r, 'app: the frame booted and called SIM.frameReady')) throw new Error('no frame');
          ok(enrolShortcut('sister'), 'app: the enrol shortcut filled the code and called appDoEnroll');
          return waitFor(function () { return frameHome('sister'); }, 30000);
        }).then(function (r) { if (!ok(r, 'app: enrolled, home screen')) throw new Error('not enrolled'); });
      }),
      step('app: a mixed sale of two', function () {
        n0 = world.ledger.length;
        var F = S.frames.sister;
        frameCmd(F, { op: 'open', id: 'S1-0003' });
        return waitFor(function () { var f = formOf(); return !!f && f.kind === 'sale' && lineIds() === 'S1-0003'; }, 10000)
          .then(function (r) {
            if (!ok(r, 'app: S1-0003 opens the sale form with its line')) throw new Error('no form');
            frameCmd(F, { op: 'set', f: 'qty+:S1-0003' });
            frameCmd(F, { op: 'set', f: 'pay:mix' });
            frameCmd(F, { op: 'set', f: 'acct:KBZ' });
            frameCmd(F, { op: 'set', f: 'transfer', value: 5000 });
            return waitFor(function () { var f = formOf(), l = lineOf('S1-0003'); return !!f && !!l && l.qty === 2 && f.total === 24000 && f.pay === 'mix' && f.acct === 'KBZ' && f.transfer === 5000; }, 10000);
          })
          .then(function (r) {
            if (!ok(r, 'app: the form reads 24,000 with KBZ 5,000')) throw new Error('the form was not filled');
            frameCmd(F, { op: 'click', sel: '[data-f="save"]' });
            return waitFor(soldShown('sold_done'), 10000);
          })
          .then(function (r) {
            ok(r, 'app: Save closes the form and the home shows the sold card');
            frameCmd(S.frames.sister, { op: 'sync', why: 'smoke' });
            return waitFor(function () { return world.ledger.slice(n0).filter(function (x) { return x.itemId === 'S1-0003' || x.type === 'PAYMENT'; }).length >= 2; }, 15000);
          })
          .then(function () {
            var rows = world.ledger.slice(n0).filter(function (x) { return x.deviceId && x.deviceId !== 'TG'; });
            var sale = rows.filter(function (x) { return x.type === 'SALE'; })[0], pay = rows.filter(function (x) { return x.type === 'PAYMENT'; })[0];
            ok(rows.length === 2 && !!sale && !!pay && sale.groupId === pay.groupId, 'app: two rows in one group reached the Ledger after syncNow');
            ok(!!sale && sale.itemId === 'S1-0003' && Number(sale.qty) === -2 && Number(sale.cash) === 19000 && (sale.method || 'CASH') === 'CASH', 'app: the SALE of two, cash 19,000 CASH');
            ok(!!pay && Number(pay.amount) === 5000 && pay.method === 'KBZ', 'app: the PAYMENT of 5,000 KBZ');
          });
      }),
      // Round 6 (8.5): one basket of three pieces with a part payment, built the way a seller does it: the sale tile,
      // rack scans, a scan of a piece already in the basket and one of the other shop, the part, the buyer, the day.
      step('app: a three-item basket with a part payment', function () {
        var F = S.frames.sister, q0 = server.quarantine.length;
        var ownerChat0 = (world.chats[SIM_USERS.owner.id] || []).length;
        var st0 = { a: itemView('S1-0002').stock, b: itemView('S1-0005').stock };
        n0 = world.ledger.length;
        frameCmd(F, { op: 'form', kind: 'sale' });
        return waitFor(function () { var f = formOf(); return !!f && f.kind === 'sale' && f.lines.length === 0; }, 10000)
          .then(function (r) {
            if (!ok(r, 'app: the sale tile opens an empty sale form')) throw new Error('no form');
            scan('S1-0002');
            frameCmd(F, { op: 'set', f: 'qty+:S1-0002' });
            scan('S1-0005');
            scan('S1-0001');
            return waitFor(function () { var a = lineOf('S1-0002'); return lineIds() === 'S1-0002,S1-0005,S1-0001' && !!a && a.qty === 2; }, 10000);
          })
          .then(function (r) {
            if (!ok(r, 'app: three rack scans and + make three lines in scan order (S1-0002 × 2, S1-0005, S1-0001)')) throw new Error('no lines');
            var f = formOf();
            ok(f.total === 83000 && f.pay === 'CASH' && !f.part && !(f.buyer && (f.buyer.id || f.buyer.name || f.buyer.phone)) && f.amount === null && f.due === null, 'app: the total is 83,000 with the defaults: cash, paid in full, no buyer', f);
            scan('S1-0001');   // a one-of-a-kind piece already in the basket: basket_twice
            scan('S2-0002');   // a piece of the other shop: basket_other_shop
            scan('S1-0002');   // a stock item already a line: ui_form_twice, the stepper is the count (0.3 rule 14)
            frameCmd(F, { op: 'set', f: 'paid:part' });
            frameCmd(F, { op: 'set', f: 'amount', value: 30000 });
            return waitFor(function () { var g = formOf(); return !!g && g.part && g.amount === 30000; }, 10000);
          })
          .then(function (r) {
            var a = lineOf('S1-0002');
            ok(r && lineIds() === 'S1-0002,S1-0005,S1-0001' && !!a && a.qty === 2, 'app: S1-0001 again and S2-0002 are refused (still three lines), S1-0002 again keeps its count at 2');
            frameCmd(F, { op: 'click', sel: '[data-f="save"]' });
            return waitFor(function () { var g = formOf(); return !!g && !!g.last && g.last.f === 'save' && !!g.error; }, 10000);
          })
          .then(function (r) {
            var g = formOf();
            ok(r && !!g && g.error === 'sale_need_buyer' && world.ledger.length === n0, 'app: a part payment without a buyer is refused (sale_need_buyer), the form stays open and nothing is written', g && g.error);
            frameCmd(F, { op: 'set', f: 'buyer', value: 'ဒေါ်မြင့်' });
            frameCmd(F, { op: 'click', sel: '[data-f="buyer:C-0001"]' });
            frameCmd(F, { op: 'click', sel: '[data-f="due:14"]' });
            frameCmd(F, { op: 'click', sel: '[data-f="save"]' });
            return waitFor(soldShown('basket_sold'), 10000);
          })
          .then(function (r) {
            ok(r, 'app: the buyer ဒေါ်မြင့်, 14 days and Save: the form closes on the sold card (basket_sold)');
            frameCmd(F, { op: 'sync', why: 'smoke' });
            return waitFor(function () { return world.ledger.slice(n0).filter(function (x) { return x.type === 'SALE' && x.deviceId && x.deviceId !== 'TG'; }).length >= 3; }, 15000);
          })
          .then(function (r) {
            var rows = world.ledger.slice(n0).filter(function (x) { return x.deviceId && x.deviceId !== 'TG'; }), sales = rows.filter(function (x) { return x.type === 'SALE'; });
            var g = sales.length ? sales[0].groupId : '', due = addDaysKey(today, 14);
            var col = function (k) { return sales.map(function (x) { return x[k] === undefined || x[k] === null ? '' : String(x[k]); }).join(' · '); };
            ok(r && sales.length === 3 && sales.every(function (x) { return x.groupId === g; }) && col('itemId') === 'S1-0002 · S1-0005 · S1-0001', 'app: three SALE rows of one group, in line order S1-0002, S1-0005, S1-0001', col('itemId'));
            ok(col('qty') === '-2 · -1 · -1', 'app: their qty −2, −1, −1', col('qty'));
            ok(col('amount') === '36000 · 22000 · 25000', 'app: their amounts 36,000, 22,000, 25,000', col('amount'));
            ok(col('cash') === '30000 · 0 · 0' && col('method') === 'CASH ·  · ', 'app: the cash 30,000 on the first line only, method CASH there and blank on the others', [col('cash'), col('method')]);
            ok(sales.every(function (x) { return x.customerId === 'C-0001' && x.dueDay === due; }), 'app: C-0001 and DueDay today + 14 on every row', [col('customerId'), col('dueDay')]);
            ok(sales.every(function (x) { return x.note === 'credit'; }), 'app: every row noted credit', col('note'));
            ok(!!sales[0] && !!sales[0].receiptNo && sales.every(function (x) { return x.receiptNo === sales[0].receiptNo; }), 'app: ONE receipt number on all three', col('receiptNo'));
            ok(rows.filter(function (x) { return x.type === 'PAYMENT'; }).length === 0, 'app: no PAYMENT row');
            ok(server.quarantine.length === q0 && (world.chats[SIM_USERS.owner.id] || []).length === ownerChat0, 'app: no quarantine and no server flag (no ping to the owner, no OVERPAID)');
            var cr = openCredits(world.ports, null).filter(function (c) { return c.groupId === g; }), head = labelText('basket_name');
            ok(cr.length === 1 && cr[0].owed === 53000 && !!head && String(cr[0].item).indexOf(head) === 0, 'app: openCredits holds ONE entry for the basket, owed 53,000, its item basket_name', cr);
            ok(itemView('S1-0002').stock === st0.a - 2 && itemView('S1-0005').stock === st0.b - 1 && itemView('S1-0001').status === 'SOLD', 'app: the stock of S1-0002 −2, S1-0005 −1, S1-0001 SOLD');
            // Step-4 checker (spec 8.1, T10): the laptop's Ledger tab marks the basket's lines '🛍 i/n' and no other row.
            var tbl = ledgerTable(), heads = Array.prototype.slice.call(tbl.querySelectorAll('thead th')).map(function (x) { return x.textContent; }), bi = heads.indexOf('Basket');
            var cells = Array.prototype.slice.call(tbl.querySelectorAll('tbody tr')).map(function (tr) { return bi >= 0 && tr.children[bi] ? tr.children[bi].textContent : '?'; });
            var want = world.ledger.map(function (x) { var k = sales.indexOf(x); return k >= 0 ? '🛍 ' + (k + 1) + '/3' : ''; });
            ok(bi >= 0 && sales.length === 3 && cells.join('|') === want.join('|'),
              'laptop: the Ledger\'s Basket column reads 🛍 1/3, 2/3, 3/3 on the basket\'s lines and is empty on every other row', cells.filter(function (x) { return !!x; }));
          });
      }),
      // Step-4 checker (spec 8.3): ⏭ drives a tour on the app's form: a form left open is closed first (the pre-step
      // home, the mark on its own ←), a value step goes through the set op, a tap step through a click on [data-f].
      step('app: ⏭ drives a tour on the form', function () {
        var F = S.frames.sister;
        frameCmd(F, { op: 'form', kind: 'expense' });
        return waitFor(function () { var f = formOf(); return !!f && f.kind === 'expense'; }, 10000)
          .then(function (r) {
            if (!r) throw new Error('the expense form did not open');
            tourStart('price');
            return waitFor(function () { return !!S.tour && S.tour.pre === 'home'; }, 5000);
          })
          .then(function (r) {
            ok(r && S.tour.i === 0 && homeMark('sister').sel === '.formpage [data-f="close"]',
              'a tour started over a form left open waits for that form\'s ← first (pre-step home, the mark on its close)');
            tourDoIt();
            return waitFor(function () { return !!S.tour && !S.tour.pre && !formOf(); }, 10000);
          })
          .then(function (r) {
            ok(r && S.tour.i === 0, '⏭ closes the form left open and the tour starts at its first step');
            tourDoIt();   // the tag step: a rack scan on the app opens the sale form with the piece
            return waitFor(function () { return !!S.tour && S.tour.i === 1 && lineIds() === 'S1-0002'; }, 10000);
          })
          .then(function (r) {
            if (!r) throw new Error('the tag step did not open the sale form with S1-0002');
            tourDoIt();   // fset('price:S1-0002', 15000)
            return waitFor(function () { var l = lineOf('S1-0002'); return !!S.tour && S.tour.i === 2 && !!l && l.price === 15000; }, 10000);
          })
          .then(function (r) {
            ok(r, '⏭ on a value step sets the value in the form (the line\'s price 15,000) and the step is done by the control used');
            var f2 = formOf(), last2 = (f2 && f2.last) || {};
            ok(!!S.tour && last2.f === 'price:S1-0002' && last2.n > 0 && S.tour.mark.formN === last2.n && makeCtx().mark.formN === last2.n,
              'the next step begins with the form\'s control count as its mark (formN), which its done reads: a control used before never ends it', [last2, S.tour && S.tour.mark]);
            tourDoIt();   // ff('qty+:S1-0002')
            return waitFor(function () { var l = lineOf('S1-0002'); return !!S.tour && S.tour.i === 3 && !!l && l.qty === 2; }, 10000);
          })
          .then(function (r) {
            renderAll();
            ok(r && S.tour.hot === 'f:save', '⏭ on a tap step clicks its [data-f] control (+: a count of 2), and the Save step is hot as f:save', S.tour && S.tour.hot);
            tourLeave();
            frameCmd(F, { op: 'close' });
            return waitFor(function () { return !formOf(); }, 10000);
          })
          .then(function (r) { if (!r) throw new Error('the price form did not close'); });
      }),
      // The UX review: the ← of a changed form opens the app's own question sheet (never confirm(), which a host sandboxed
      // without allow-modals ignores); its top button leaves without saving, and nothing is written.
      step('app: the ← of a changed form asks in the app, and its leave button closes it', function () {
        var F = S.frames.sister, n1 = world.ledger.length;
        frameCmd(F, { op: 'form', kind: 'expense' });
        return waitFor(function () { var f = formOf(); return !!f && f.kind === 'expense'; }, 10000)
          .then(function (r) {
            if (!r) throw new Error('the expense form did not open');
            frameCmd(F, { op: 'set', f: 'note', value: 'smoke' });
            return waitFor(function () { var f = formOf(); return !!f && f.note === 'smoke'; }, 10000);
          })
          .then(function (r) {
            if (!r) throw new Error('the note was not typed into the expense form');
            frameCmd(F, { op: 'click', sel: '.formpage [data-f="close"]' });
            return waitFor(function () { var s = snapOf(F); return !!s && s.ask === 'leave' && !!s.form; }, 10000);
          })
          .then(function (r) {
            if (!r) throw new Error('the ← of the changed form did not open the question sheet');
            frameCmd(F, { op: 'click', sel: '#overlay [data-f="ask:yes"]' });
            return waitFor(function () { var s = snapOf(F); return !!s && !s.form && s.nav.indexOf('form') < 0 && !s.ask; }, 10000);
          })
          .then(function (r) {
            ok(r && world.ledger.length === n1, 'app: the ← of a changed form asks with the app\'s own sheet (no confirm()); its leave button closes the form, nothing written');
          });
      }),
      step('app: a tour waits for the chat screen', function () {
        frameCmd(S.frames.sister, { op: 'screen', screen: 'history' });
        tourStart('sell');
        ok(!!S.tour && S.tour.dev === 'app' && S.tour.pre === 'home' && $('toursBody').textContent.indexOf(labelText('ui_btn_back')) >= 0,
          'a sale tour on an enrolled phone that shows its history asks for the back button (not for an enrolment)');
        tourDoIt();
        return waitFor(function () { return !!S.tour && !S.tour.pre; }, 5000).then(function (r) {
          ok(r && frameHome('sister') && S.tour.i === 0, '⏭ brings the phone back to its chat screen and the tour starts at step 1');
          tourLeave();
        });
      }),
      // The same through the app's own buttons, and a tour picked at once: without parent.SIM (?transport=post) the page
      // has not heard of the new screen when the tour starts, so the step asks the frame for a fresh snapshot, and the
      // frame posts the next one by itself when its own back button brings the chat back.
      step('app: a tour started right after a tap inside the app', function () {
        var back = labelText('ui_btn_back');
        ok(['ui_btn_back', 'ui_btn_enroll', 'ui_meas_save'].every(function (k) { var s = labelText(k); return !!s && s !== k && s.indexOf('{') < 0; }),
          'APP_MSG keys have their label on the page (ui_btn_back, ui_btn_enroll, ui_meas_save), the text the app shows');
        frameCmd(S.frames.sister, { op: 'click', sel: 'button.handle', key: 'ui_history' });
        tourStart('sell');
        return waitFor(function () { return !!S.tour && S.tour.pre === 'home' && !!back && $('toursBody').textContent.indexOf(back) >= 0; }, 5000).then(function (r) {
          ok(r && $('toursBody').textContent.indexOf('ui_btn_back') < 0,
            'a tour picked right after the app\'s own history button asks for its back button (' + back + ') once the frame answers');
          frameCmd(S.frames.sister, { op: 'click', sel: '#back' });   // the header's icon-only ← (revision 3, 13.3): no label to match
          return waitFor(function () { return !!S.tour && !S.tour.pre; }, 5000);
        }).then(function (r) {
          ok(r && frameHome('sister') && S.tour.i === 0, 'the app\'s own back button (not ⏭) brings the chat back and the tour starts at step 1');
          tourLeave();
        });
      }),
      // Review fix (step 4, 13.11): with the owner's AI switch off the bot offers no sheet-photo button (measMethodRow),
      // so the order tour, which taps it, does not start: the panel says why and offers Reset instead of a step that
      // never comes. The world's Settings ai is what the bot reads (the owner's app writes it there at its sync).
      step('a tour that needs the AI, with the AI off', function () {
        var had = Object.prototype.hasOwnProperty.call(world.settings, 'ai'), was = world.settings.ai, at = S.login + '|' + S.device;
        try {
          world.settings.ai = 'FALSE';
          tourStart('order');
          var T = S.tour;
          ok(!!T && T.id === 'order' && T.blocked === AI_OFF_TOUR && T.i === 0 && T.hot === '' && curStep() === null && S.login + '|' + S.device === at
            && $('toursBody').textContent.indexOf(AI_OFF_TOUR) >= 0 && !!$('toursBody').querySelector('.warn'),
            'with AI off (Settings ai FALSE) the order tour does not start: the panel says the AI is off and offers Reset, no step and no pane switch', T && T.blocked);
          tourLeave();
        } finally {
          if (had) world.settings.ai = was; else delete world.settings.ai;
        }
        ok(aiOn(world.ports) && tourBlocked(findTour('order')) === '', 'with AI on again the order tour is not blocked');
      }),
      step('owner: Lists on the laptop', function () {
        doLogin('owner');
        setDevice('laptop');
        setTab('lists');
        ok(!!document.querySelector('[data-cell="WAVE.Active"]'), 'laptop: the Lists tab draws the Active cell of WAVE');
        world.ports.store.setListRow('pay_method', 'WAVE', { active: false });
        setDevice('tg');
        tgStart('S1-0002');
        tgTap('S|S1-0002|1');
        tgTap('SS|S1-0002|o|method');
        var m = world.sim.lastBot(S.user);
        ok(!buttonWhere(m, function (b) { return b.callback_data === 'SS|S1-0002|m|WAVE'; }) && !!buttonWhere(m, function (b) { return b.callback_data === 'SS|S1-0002|m|KBZ'; }),
          'the next Telegram how-paid screen has no WavePay (KBZPay stays)');
        tgTap('SS|S1-0002|back|method');   // a sub-screen ends with ⏮ alone (revision 2, U11); ✖️ is on the review card
        tgTap('SS|S1-0002|z');
      }),
      step('the clock and the 21:00 post', function () {
        setDevice('laptop');
        var at = [$('clockDay').getBoundingClientRect().left, $('clock2100').getBoundingClientRect().left];
        for (var i = 0; i < 15; i++) $('clockDay').click();
        ok($('clockDay').getBoundingClientRect().left === at[0] && $('clock2100').getBoundingClientRect().left === at[1],
          'the clock buttons stay where they were while the clock text grows (⏩ can be pressed 15 times in one place)');
        $('clock2100').click();
        ok(timeKey(world.ports.clock.now()) === '21:00' || timeKey(world.ports.clock.now()) === '21:01', 'the demo clock reads 21:00 in Yangon');
        ok(dayKey(world.ports.clock.now()) >= addDaysKey(today, 15), 'the demo clock is 15 days ahead');
        $('postSummary').click();
        var post = S.groupPosts[S.groupPosts.length - 1], head = labelText('summary_due_overdue');
        ok(!!post && !!head && post.text.indexOf(head) >= 0 && post.text.indexOf('ဒေါ်စန်း') >= 0, 'the Family group post carries summary_due_overdue naming ဒေါ်စန်း');
        var dueLine = post ? (post.text.split('\n').filter(function (l) { return !!head && l.indexOf(head) >= 0; })[0] || '') : '';
        ok(dueLine.indexOf('ဒေါ်မြင့်') >= 0 && dueLine.indexOf('ဒေါ်စန်း') >= 0, 'the same line names ဒေါ်မြင့် next to ဒေါ်စန်း (the basket\'s day has passed too)', dueLine);
        ok(server.quarantine.length === 0, 'no push was quarantined');
      })
    ];
    return seq.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()).then(function () {
      R.errors = window.SIM_ERRORS.slice(errAt).concat(world.errors.slice(worldErrAt).filter(function (e) { return e.where === 'handleUpdate'; })
        .map(function (e) { return 'handleUpdate: ' + e.message; }));
      R.transport = S.frames.sister ? (S.frames.sister.direct ? 'direct' : 'post') : '';   // which path the app frame took (?transport=post)
      renderAll();
      return R;
    });
  }

  /* ------------------------------ autopilot (?autorun=smoke, ?tour=…) ------------------------------ */
  function writeResult(obj) {
    var pre = $('smoke');
    pre.textContent = JSON.stringify(obj);
    pre.hidden = false;
  }
  function runTourUnattended() {
    var lastKey = '', since = 0, tries = 0;
    autoTimer = setInterval(function () {
      var T = S.tour;
      if (!T || T.finished || T.blocked) {
        clearInterval(autoTimer);
        autoTimer = null;
        writeResult({ tour: T ? T.id : Q.tour, finished: !!(T && T.finished), blocked: T ? T.blocked || '' : 'left', steps: T ? T.steps.length : 0, errors: window.SIM_ERRORS.slice() });
        return;
      }
      var key = T.i + '|' + (T.pre ? 'pre' : ''), now = Date.now();
      if (key !== lastKey) { lastKey = key; since = now; tries = 0; }
      if (tries === 0 || now - since > 4000 * tries) {
        if (tries >= 3) { simError('autopilot: tour ' + T.id + ' step ' + (T.i + 1) + ' did not complete'); tourSkip(); return; }
        tries++;
        tourDoIt();
      }
    }, 150);
  }
  function autopilot() {
    if (Q.autorun === 'smoke') {
      smoke().then(writeResult, function (err) { writeResult({ passed: 0, failed: 1, errors: [String((err && err.stack) || err)] }); });
      return;
    }
    if (Q.login && SIM_USERS[Q.login] && Q.login !== 'customer') doLogin(Q.login);
    if (Q.device && S.login) setDevice(Q.device);
    var tour = Q.tour ? findTour(Q.tour) : null;
    if (tour) {
      if (!S.login) doLogin(tour.login);
      tourStart(tour.id);
      runTourUnattended();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (Q.latency !== undefined && Q.latency !== '') LATENCY = Math.max(0, Number(Q.latency) || 0);
    buildLogin();
    buildPhrases();
    boot();
    Array.prototype.slice.call(document.querySelectorAll('#devices .dev')).forEach(function (b) {
      b.addEventListener('click', function () { setDevice(b.getAttribute('data-dev')); });
    });
    $('photoBtn').addEventListener('click', photoPop);
    $('micBtn').addEventListener('click', function () { var v = $('voice'); v.open = true; if (v.scrollIntoView) v.scrollIntoView({ block: 'nearest' }); });
    $('textIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendText(); });
    $('voiceSend').addEventListener('click', sendVoice);
    $('voiceIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendVoice(); });
    $('outage').addEventListener('change', function (e) { world.aiFail = e.target.checked; });
    $('clock31').addEventListener('click', function () { clockAdd(31 * 60000, 'clock31'); });
    $('clockDay').addEventListener('click', function () { clockAdd(86400000, 'clockDay'); });
    $('clock2100').addEventListener('click', clockTo2100);
    $('flowForm').addEventListener('click', function () { setFlow('form'); });
    $('flowQuick').addEventListener('click', function () { setFlow('quick'); });
    $('postSummary').addEventListener('click', postSummary);
    $('printTags').addEventListener('click', printSheet);
    $('reset').addEventListener('click', reset);
    $('sheetBody').addEventListener('focusout', function () { setTimeout(function () { if (S && S.sheetDirty) renderAll(); }, 0); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
    document.addEventListener('click', function (e) {
      var pop = $('pop');
      if (pop.hidden) return;
      if (!pop.contains(e.target) && e.target !== $('photoBtn')) closePop();
    });
    // The clock keeps moving (an offset, not a frozen instant); a step that waits on state is looked at again.
    setInterval(function () { if (!S) return; renderClock(); if (S.tour && !S.tour.finished) tourEvent({ src: 'page', kind: 'tick' }); }, 1000);
    autopilot();
  });
})();
