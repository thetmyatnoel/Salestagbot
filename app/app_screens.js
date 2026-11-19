/**
 * app/app_screens.js — the app's own pages and its one navigation stack (round 6, revision 3:
 * docs/design-round-6/SPEC-round-6.md 13.4, 13.6, 13.8-13.12).
 *
 *   nav      one stack of layers (card, screen, form, meas, sheet) mirrored in history state: every entry carries its
 *            depth ({salestag: d}), popstate closes the layers above the depth it landed on, and the history is brought
 *            to the stack with pushState or ONE history.go(-n); the header's ←, every form's ← and Android back agree
 *   pages    the history (this phone's own records by day), an entry, the buyers list, a buyer, the receipt
 *   views    the item, sold, today and group cards as clean label/value lists and tables (13.9)
 *   forms    the buyer form and the shop form (registered in APP_FORM_KINDS of app_forms.js)
 *   settings the owner's AI switch and Shops section
 * Every nav function reads APP.nav || [], (APP.opts || {}).noHistory and APP.win && APP.win.history, so a stub APP
 * without them works (review r3, M-11). Plain ES5: var and function only. No DOM access at load time.
 */
var APP_BUYERS_MAX = 60;              // rows of the buyers page; beyond it ui_buyers_more
var APP_HIST_DAYS = 7;                // days of the history page; ui_hist_more adds as many again
var APP_BACK_AGAIN_MS = 3000;         // ui_back_again at most once in this time

/* ============================== the navigation stack (13.4) ============================== */

function appNavList() { return (APP && APP.nav) || []; }
function appNavHistory() { return APP && !(APP.opts || {}).noHistory && APP.win && APP.win.history ? APP.win.history : null; }
function appNavTop() { var n = appNavList(); return n.length ? n[n.length - 1] : null; }
function appNavPush(layer) {
  if (!APP) return;
  if (!APP.nav) APP.nav = [];
  APP.nav.push(layer);
  appNavSync();
}
/** The top layer replaced by this one: same depth, no history call (pushed when the stack is empty). */
function appNavReplace(layer) {
  if (!APP) return;
  if (!APP.nav) APP.nav = [];
  if (APP.nav.length) APP.nav[APP.nav.length - 1] = layer;
  else appNavPush(layer);
}
/** A close that did not come from back: the topmost layer of that kind removed; nothing when there is none. */
function appNavDrop(kind) {
  var nav = APP && APP.nav;
  if (!nav) return;
  for (var i = nav.length - 1; i >= 0; i--) {
    if (nav[i].kind === kind) { nav.splice(i, 1); appNavSync(); return; }
  }
}
/** Bring the history to APP.nav.length: pushState per missing level, or ONE go(-n) (a walk recognised by navBusy). */
function appNavSync() {
  var h = appNavHistory();
  if (!h || APP.navBusy) return;
  var len = appNavList().length, d = APP.navDepth || 0;
  if (len > d) {
    try {
      for (var i = d + 1; i <= len; i++) h.pushState({ salestag: i }, '');
      APP.navHist = true;
    } catch (ignore) { APP.navHist = false; }
    APP.navDepth = len;
  } else if (len < d) {
    APP.navBusy = true;
    try { h.go(len - d); } catch (ignore2) { APP.navBusy = false; APP.navDepth = len; }
  }
}
/** The popstate listener. */
function appOnPop(e) {
  if (!APP) return;
  var st = e && e.state, H = st && typeof st.salestag === 'number' ? st.salestag : 0;
  if (APP.navBusy) {                                         // the app's own walk
    APP.navBusy = false;
    APP.navDepth = H;
    appNavSync();
    return;
  }
  var had = appNavList().length;
  APP.navDepth = H;
  appNavPopTo(H);
  appNavSync();
  if (!had) {                                                // nothing was open: the next back leaves the app
    var now = Date.now();
    if (!APP.backAgainAt || now - APP.backAgainAt > APP_BACK_AGAIN_MS) { APP.backAgainAt = now; appToast(APP.tt('ui_back_again')); }
  }
}
function appNavPopTo(H) {
  while (appNavList().length > H) { if (!appNavPop()) break; }
}
function appNavCanBack() { return appNavList().length > 0 && !!APP && APP.screen !== 'enroll'; }
/** The ← of the header and of every form. */
function appNavBack() {
  if (!appNavCanBack()) return;
  var h = appNavHistory();
  if (APP.navHist && h) h.back();
  else appNavPopTo(appNavList().length - 1);
}
/** What the app shows once the top layer is gone: the screen layer on top, the home's card state, or the bottom. */
function appNavLand() {
  var nav = appNavList(), restart = false;
  for (var i = nav.length - 1; i >= -1; i--) {
    var l = i >= 0 ? nav[i] : null;
    if (l && (l.kind === 'form' || l.kind === 'meas' || l.kind === 'sheet')) continue;
    if (l && l.kind === 'screen') { APP.screen = l.name; APP.screenArg = l.arg === undefined ? null : l.arg; break; }
    if (l && l.kind === 'card') { APP.screen = 'home'; APP.screenArg = null; APP.showScanner = false; break; }
    APP.screenArg = null;
    if (APP.store.meta.deviceId) { APP.screen = 'home'; APP.showScanner = true; restart = true; }
    else APP.screen = 'enroll';
  }
  appRender();
  if (restart && APP.store.getPref('cameraOk')) appStartScanner();
}
/** Close the top layer; false when it stays (a changed form whose user stays). */
function appNavPop() {
  var top = appNavTop();
  if (!top) return false;
  if (top.kind === 'sheet') { appCloseOverlay({ fromNav: true }); APP.nav.pop(); return true; }
  if (top.kind === 'form') { if (!appCloseForm({ ask: true, pop: true })) return false; APP.nav.pop(); appNavLand(); return true; }
  if (top.kind === 'meas') { if (!appCloseMeasForm({ ask: true, pop: true })) return false; APP.nav.pop(); appNavLand(); return true; }
  if (top.kind === 'card') {
    APP.nav.pop();
    if (appState()) clearState(APP.phone.ports, appUid());       // the same as the card's ✖️
    appNavLand();
    return true;
  }
  APP.nav.pop();
  appNavLand();
  return true;
}
/** The capture listener of pointerdown and keydown: a guard entry under the stack, pushed with the seller's first tap. */
function appNavGuard() {
  var h = appNavHistory();
  if (!h || appNavList().length || APP.navDepth) return;
  var st = h.state;
  if (st && typeof st.salestag === 'number') return;
  try { h.pushState({ salestag: 0, guard: true }, ''); APP.navHist = true; APP.navGuard = true; } catch (ignore) {}
}
/** The card rule (UX-M1): a card layer on top exactly while the home shows a card. appRender calls it. */
function appNavCardSync() {
  if (!APP || !APP.nav || APP.form || APP.measForm || APP.formPending || APP.screen !== 'home') return;
  var shows = !APP.showScanner && !!appLatestBot(), top = appNavTop();
  // A form or meas layer left on top is being closed by appNavPop right now: never a card over it.
  if (top && (top.kind === 'form' || top.kind === 'meas')) return;
  if (shows) { if (!top || (top.kind !== 'card' && top.kind !== 'sheet')) appNavPush({ kind: 'card' }); }
  else if (top && top.kind === 'card') { APP.nav.pop(); appNavSync(); }
}
/** Every layer closed without asking (a form's draft kept); the scanner state, or the enrol screen without deviceId. */
function appNavReset() {
  if (!APP) return;
  if (APP.form) appCloseForm({ keep: true, pop: true, reset: true });
  if (APP.measForm) appCloseMeasForm({ pop: true });
  if (APP.$ && APP.$('overlay')) appCloseOverlay({ fromNav: true });
  APP.nav = [];
  appNavSync();
  APP.screenArg = null;
  APP.screen = APP.store && APP.store.meta.deviceId ? 'home' : 'enroll';
  APP.showScanner = true;
}
/** At boot (UX-m2, m-9): a reload keeps the entries pushed before it while APP.nav starts empty: one walk back to depth 0. */
function appNavBoot() {
  var h = appNavHistory();
  if (!h) return;
  try {
    var st = h.state;
    if (st && typeof st.salestag === 'number' && st.salestag > 0) { APP.navDepth = st.salestag; appNavSync(); }
  } catch (ignore) {}
}
/** Open one of the app's pages: a screen layer pushed, or the top screen layer replaced when it has the same name. */
function appOpenScreen(name, arg) {
  if (!APP) return;
  var top = appNavTop(), again = !!top && top.kind === 'screen' && top.name === name;
  // The buyers page opened anew starts with an empty search; ← back to it (appNavLand) keeps what was typed.
  if (name === 'buyers' && !again) APP.buyersText = '';
  APP.screen = name;
  APP.screenArg = arg === undefined ? null : arg;
  var layer = { kind: 'screen', name: name, arg: APP.screenArg };
  if (again) appNavReplace(layer); else appNavPush(layer);
  appRender();
}
/** 'openscreen' (app_ports.js ui.openScreen): opened after the core's run, as the measurement form is. */
function appOnOpenScreen(evt) {
  if (!APP || !APP.doc || !evt || !evt.name) return;
  var req = evt.req || {}, arg = evt.name === 'buyer' ? req.customerId : evt.name === 'receipt' ? req.groupId : null;
  var open = function () { appOpenScreen(evt.name, arg === undefined ? null : arg); };
  if (APP.win && APP.win.setTimeout) APP.win.setTimeout(open, 0); else open();
}
/** The header's title of a page (13.3). */
function appScreenTitle(screen) {
  var key = { history: 'ui_history_title', sync: 'ui_sync_title', settings: 'ui_w_settings', buyers: 'ui_buyers_title', buyer: 'ui_buyer_title',
    receipt: 'ui_receipt_title', entry: 'ui_entry_title' }[screen];
  return key ? APP.tt(key) : '';
}

/**
 * A page's action button (13.6): the core's callback runs against a carrier message; when the core answered with a bot
 * message the home's card state shows it (the card rule pushes its layer, so back returns to the page); when it opened a
 * page instead (MS| opens the measurement form) nothing more. Resolves to true when it answered with a card.
 */
function appScreenAct(data) {
  var P = APP.phone;
  APP.tapStart = APP.win && APP.win.performance ? APP.win.performance.now() : 0;
  return P.sim.act(data).then(function (r) {
    var c = r.carrier, answered = !!c.edited, list = APP.store.chat;
    for (var i = list.length - 1; !answered && i >= 0 && list[i].id > c.id; i--) {
      if (list[i].from === 'bot' && !(list[i].carrier && !list[i].edited)) answered = true;
    }
    if (answered) { APP.screen = 'home'; APP.screenArg = null; APP.showScanner = false; appRender(); }
    return answered;
  });
}

/* ============================== small builders ============================== */

/** A label/value row (.kv). o.cls on the value (owed, num), o.indent for a sub-row. */
function appKv(label, value, o) {
  o = o || {};
  return appH('div', { class: 'kv' + (o.indent ? ' sub' : '') + (o.rowCls ? ' ' + o.rowCls : '') }, [appH('span', { class: 'k', text: label }),
    appH('span', { class: 'v' + (o.cls ? ' ' + o.cls : ''), text: value === null || value === undefined ? '' : String(value) })]);
}
function appKvh(text) { return appH('div', { class: 'kvh', text: text }); }
/** A small label/value pair inside a table cell (.kvs). */
function appKvs(label, value) { return appH('span', { class: 'kvs' }, [appH('span', { class: 'k', text: label }), appH('span', { class: 'v num', text: value })]); }
/** A tappable row's chevron. */
function appChevron() { return appIcon('chevron-right'); }
/** A page button wired to a data-f name (hot per SIM_HOT). */
function appPageBtn(f, text, o, onclick) {
  o = o || {};
  var hot = APP.win ? APP.win.SIM_HOT : undefined;
  var a = { type: 'button', 'data-f': f, text: text, class: (o.cls || '') + (hot === 'f:' + f ? ' hot' : ''), 'aria-label': o.aria || null, onclick: onclick };
  if (o.iconOnly) { delete a.text; a.html = appIconSvg(o.iconOnly); a['class'] = (a['class'] + ' iconbtn').replace(/^ /, ''); return appH('button', a); }
  return o.icon ? appHi('button', a, o.icon) : appH('button', a);
}
/** The first item name of a group's rows, ' +{n-1}' for several (13.8). */
function appGroupName(ports, rows) {
  var r = rows[0], it = r && r.itemId ? ports.store.getItem(r.itemId) : null, name = it ? it.name : (r ? r.itemId : '');
  return rows.length > 1 ? name + ' +' + myDigits(rows.length - 1) : name;
}
/**
 * A live PAYMENT of another group taken against this sale (refGroupId): undoing or voiding the sale mirrors only its own
 * rows, so that payment would be left with no credit to pay (the buyer's owed and the Credits tab would disagree, the
 * drawer would keep cash of a sale that is gone). The app offers neither while one is live (fixer, review of step 3).
 */
function appGroupPaidLater(ports, groupId) {
  var all = ports.store.ledgerRows(), reversed = reversedIdSet(all);
  return all.some(function (r) {
    return r.type === CFG.TX.PAYMENT && r.refGroupId === groupId && r.groupId !== groupId && !r.reversesTxId && !reversed[r.txId];
  });
}
/**
 * The undo of 13.8: allowed while every row of the group is live, the first is at most 30 minutes old and no later
 * payment was taken against it (appGroupPaidLater).
 */
function appUndoInfo(ports, groupId) {
  var g = groupRows(ports, groupId), own = g.rows.filter(function (r) { return !r.reversesTxId; });
  if (!own.length || g.live.length !== own.length || own.length !== g.rows.length) return { allowed: false, until: '' };
  if (appGroupPaidLater(ports, groupId)) return { allowed: false, until: '', paidLater: true };
  var t0 = new Date(own[0].time).getTime(), until = t0 + CFG.UNDO_WINDOW_MIN * 60000;
  return { allowed: ports.clock.now().getTime() <= until, until: timeKey(new Date(until)) };
}

/* ============================== history (13.8) ============================== */

/** This phone's own records as rows, newest group first: {rows, more} for the last `days` days. */
function appHistoryRows(phone, days) {
  var ports = phone.ports, store = phone.store, me = store.meta.deviceId, all = store.ledger, seen = {}, order = [];
  var today = dayKey(ports.clock.now()), from = addDaysKey(today, -((days || APP_HIST_DAYS) - 1));
  all.forEach(function (r) {
    if (r.reversesTxId || seen['g:' + r.groupId]) return;
    if (r.synced && r.deviceId !== me) return;
    seen['g:' + r.groupId] = true;
    order.push(r.groupId);
  });
  var rows = [], more = 0;
  order.forEach(function (gid, k) {
    var g = groupRows(ports, gid), own = g.rows.filter(function (r) { return !r.reversesTxId; }), first = own[0];
    if (!first) return;
    if (first.day < from) { more++; return; }
    var row = appHistoryRow(phone, gid, g, own);
    row.k = k;
    rows.push(row);
  });
  // Newest first by the first row's time; groups of one instant keep their ledger order, the later first.
  rows.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : b.k - a.k; });
  return { rows: rows, more: more };
}
function appHistoryRow(phone, gid, g, own) {
  var ports = phone.ports, T = CFG.TX, first = own[0], tt = function (k, v) { return appPlain(t(ports, k, v)); };
  var of = function (type) { return own.filter(function (r) { return r.type === type; }); };
  var sales = of(T.SALE), restocks = of(T.RESTOCK), out = { groupId: gid, day: first.day, at: first.time, time: timeKey(new Date(first.time)), name: '', tag: '',
    amount: '', unit: 'kyat', pending: own.some(function (r) { return !r.synced; }), undone: !g.live.length, undoUntil: '', kind: '' };
  var u = appUndoInfo(ports, gid);
  if (u.allowed) out.undoUntil = u.until;
  var pcs = function (n) { return '+' + myDigits(n) + ' ထည်'; };
  if (sales.length) {
    var sum = 0;
    sales.forEach(function (r) { sum += r.amount; });
    out.kind = 'sale'; out.name = appGroupName(ports, sales); out.tag = txLabel(T.SALE); out.amount = fmtMoney(sum);
  } else if (restocks.length === 1 && (restocks[0].note === 'new item' || restocks[0].note === 'new sample')) {
    var it = ports.store.getItem(restocks[0].itemId);
    out.kind = 'new'; out.name = it ? it.name : restocks[0].itemId; out.tag = tt('ui_home_new'); out.amount = pcs(restocks[0].qty); out.unit = 'pcs';
  } else if (restocks.length) {
    var q = 0;
    restocks.forEach(function (r) { q += Number(r.qty) || 0; });
    var it2 = ports.store.getItem(restocks[0].itemId);
    out.kind = 'restock'; out.name = restocks.length > 1 ? myDigits(restocks.length) + ' မျိုး' : (it2 ? it2.name : restocks[0].itemId);
    out.tag = txLabel(T.RESTOCK); out.amount = pcs(q); out.unit = 'pcs';
  } else if (first.type === T.EXPENSE) {
    out.kind = 'expense'; out.name = categoryLabel(ports, first.category); out.tag = txLabel(T.EXPENSE); out.amount = fmtMoney(Math.abs(first.amount));
  } else if (first.type === T.PAYMENT || first.type === T.DEPOSIT) {
    out.kind = first.type === T.PAYMENT ? 'payment' : 'deposit'; out.name = first.customerId ? customerName(ports, first.customerId) : '';
    out.tag = txLabel(first.type); out.amount = fmtMoney(Math.abs(first.amount));
  } else {
    var it3 = first.itemId ? ports.store.getItem(first.itemId) : null;
    out.kind = 'other'; out.name = it3 ? it3.name : (first.customerId ? customerName(ports, first.customerId) : txLabel(first.type)); out.tag = txLabel(first.type);
    out.amount = first.type === T.TRANSFER_OUT || first.type === T.TRANSFER_IN ? myDigits(Math.abs(Number(first.qty) || 0)) + ' ထည်' : fmtMoney(Math.abs(first.amount));
    out.unit = first.type === T.TRANSFER_OUT || first.type === T.TRANSFER_IN ? 'pcs' : 'kyat';
  }
  return out;
}
function appHistoryScreen(main) {
  var tt = APP.tt, days = APP.histDays || APP_HIST_DAYS, res = appHistoryRows(APP.phone, days), today = dayKey(APP.phone.now());
  var yesterday = addDaysKey(today, -1), box = appH('div', { class: 'page' });
  if (!res.rows.length) box.appendChild(appH('div', { class: 'muted center', text: tt('ui_history_empty') }));
  var byDay = [], at = {};
  res.rows.forEach(function (r) { if (!at[r.day]) { at[r.day] = []; byDay.push(r.day); } at[r.day].push(r); });
  byDay.forEach(function (day) {
    var head = (day === today ? tt('ui_hist_today') + ' · ' : day === yesterday ? tt('ui_hist_yesterday') + ' · ' : '') + fmtDayShortMy(day);
    box.appendChild(appKvh(head));
    var tbl = appH('table', { class: 'tbl hist' });
    tbl.appendChild(appH('thead', {}, [appH('tr', {}, [appH('th', { text: tt('ui_lbl_time') }), appH('th', { text: tt('ui_lbl_what') }), appH('th', { class: 'r', text: tt('ui_lbl_amount') }), appH('th', {})])]));
    var tb = appH('tbody');
    at[day].forEach(function (r) {
      var what = appH('td', {}, [appH('div', { class: 'nm', text: r.name }), appH('div', { class: 'tag' }, [r.tag].concat(r.pending ? [appH('span', { class: 'ic pend', 'aria-label': tt('ui_hist_pending'), title: tt('ui_hist_pending'), html: appIconSvg('cloud-upload') })] : []))]);
      var hot = APP.win ? APP.win.SIM_HOT : undefined;
      var tr = appH('tr', { class: 'lrow' + (r.undone ? ' undone' : '') + (hot === 'f:hist:' + r.groupId ? ' hot' : ''), 'data-f': 'hist:' + r.groupId, role: 'button', tabindex: '0',
        onclick: function () { appHistoryOpen(r); } }, [appH('td', { class: 'num', text: r.time }), what, appH('td', { class: 'r num', text: r.undone ? tt('ui_hist_undone') : r.amount }), appH('td', { class: 'chev' }, [appChevron()])]);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.appendChild(tbl);
  });
  if (res.more) box.appendChild(appPageBtn('hist:more', tt('ui_hist_more'), { cls: 'ghost' }, function () { APP.histDays = days + APP_HIST_DAYS; appRender(); }));
  main.appendChild(box);
}
function appHistoryOpen(r) { appOpenScreen(r.kind === 'sale' ? 'receipt' : 'entry', r.groupId); }

/** The entry page (13.8): the group's facts, its rows, and the undo while it is allowed. */
function appEntryView(phone, groupId) {
  var ports = phone.ports, g = groupRows(ports, groupId), own = g.rows.filter(function (r) { return !r.reversesTxId; }), first = own[0];
  if (!first) return null;
  var tt = function (k, v) { return appPlain(t(ports, k, v)); }, rows = [], money = own.filter(function (r) { return r.cash; })[0];
  rows.push({ k: tt('ui_lbl_time'), v: fmtDayShortMy(first.day) + ' ' + timeKey(new Date(first.time)) });
  rows.push({ k: tt('ui_lbl_what'), v: txLabel(first.type) });
  if (first.customerId) rows.push({ k: tt('ui_lbl_buyer'), v: customerName(ports, first.customerId) });
  if (money) rows.push({ k: tt('ui_lbl_method'), v: methodLabel(ports, methodOf(money) || CFG.METHOD.CASH) });
  if (first.type === CFG.TX.EXPENSE) rows.push({ k: tt('ui_lbl_cat'), v: categoryLabel(ports, first.category) });
  var userNote = first.note && !/^(new item|new sample|split|credit|price|undo|rewrite)$/.test(first.note) ? first.note : '';
  if (userNote) rows.push({ k: tt('ui_lbl_note'), v: userNote });
  var lines = own.map(function (r) {
    var it = r.itemId ? ports.store.getItem(r.itemId) : null;
    return { name: it ? it.name : (r.type === CFG.TX.EXPENSE ? categoryLabel(ports, r.category) : txLabel(r.type)), id: r.itemId || '', qty: r.qty ? myDigits(Math.abs(r.qty)) : '',
      amount: r.amount ? fmtMoney(Math.abs(r.amount)) : '' };
  });
  var u = appUndoInfo(ports, groupId);
  return { rows: rows, lines: lines, undone: !g.live.length, undo: u.allowed, until: u.until };
}
function appEntryScreen(main) {
  var tt = APP.tt, g = APP.screenArg, v = appEntryView(APP.phone, g), box = appH('div', { class: 'page' });
  if (!v) { box.appendChild(appH('div', { class: 'muted', text: tt('expired') })); main.appendChild(box); return; }
  if (v.undone) box.appendChild(appH('div', { class: 'mark muted', text: tt('ui_hist_undone') }));
  v.rows.forEach(function (r) { box.appendChild(appKv(r.k, r.v)); });
  var tbl = appH('table', { class: 'tbl' });
  tbl.appendChild(appH('thead', {}, [appH('tr', {}, [appH('th', { text: tt('ui_lbl_item') }), appH('th', { class: 'r', text: tt('ui_lbl_qty') }), appH('th', { class: 'r', text: tt('ui_lbl_amount') })])]));
  tbl.appendChild(appH('tbody', {}, v.lines.map(function (l) {
    return appH('tr', {}, [appH('td', {}, [appH('div', { text: l.name })].concat(l.id ? [appH('div', { class: 'tag', text: l.id })] : [])), appH('td', { class: 'r num', text: l.qty }), appH('td', { class: 'r num', text: l.amount })]);
  })));
  box.appendChild(tbl);
  if (v.undo) {
    var acts = appH('div', { class: 'rc-actions' });
    acts.appendChild(appPageBtn('undo', tt('btn_undo'), { icon: 'arrow-back-up' }, function () { appAskUndo(false, function () { appScreenAct('U|' + g); }); }));
    acts.appendChild(appH('div', { class: 'muted small', text: tt('ui_undo_until', { time: v.until }) }));
    box.appendChild(acts);
  }
  main.appendChild(box);
}

/* ============================== buyers (13.6) ============================== */

/** The buyers list: {rows: [{id, name, phone, owed}], more}. No text: this shop's recent buyers first, then by name. */
function appBuyersRows(phone, text) {
  var ports = phone.ports, staff = phone.store.meta.staff || {}, list, s = String(text || '').trim();
  if (s) list = findCustomers(ports, s);
  else {
    var shop = staff.role === 'owner' ? null : staff.shop, rows = ports.store.ledgerRows(), seen = {}, recent = [];
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      if (!r.customerId || seen[r.customerId] || (shop && r.shop !== shop)) continue;
      var c = ports.store.getCustomer(r.customerId);
      seen[r.customerId] = true;
      if (c) recent.push(c);
    }
    var rest = ports.store.listCustomers().filter(function (c) { return !seen[c.id]; }).sort(function (a, b) {
      var x = normName(a.name), y = normName(b.name);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    list = recent.concat(rest);
  }
  var sum = customerSummaryMap(ports);
  var out = list.slice(0, APP_BUYERS_MAX).map(function (c) {
    var m = sum[c.id];
    return { id: c.id, name: c.name, phone: c.phone ? fmtPhone(c.phone) : '', owed: m && m.owed > 0 ? m.owed : 0 };
  });
  return { rows: out, more: Math.max(0, list.length - APP_BUYERS_MAX) };
}
function appBuyersScreen(main) {
  var tt = APP.tt, box = appH('div', { class: 'page' });
  var input = appH('input', { type: 'search', 'data-f': 'bsearch', placeholder: tt('cust_find'), 'aria-label': tt('cust_find'), autocomplete: 'off' });
  input.value = APP.buyersText || '';
  var listBox = appH('div', { class: 'list' });
  var draw = function () {
    appClear(listBox);
    var res = appBuyersRows(APP.phone, APP.buyersText || '');
    if (!res.rows.length) listBox.appendChild(appH('div', { class: 'muted center', text: appPlain(t(APP.phone.ports, 'cust_none')) }));
    res.rows.forEach(function (r) {
      var hot = APP.win ? APP.win.SIM_HOT : undefined;
      var left = appH('div', { class: 'lmain' }, [appH('div', { class: 'nm', text: r.name })].concat(r.phone ? [appH('div', { class: 'tag num', text: r.phone })] : []));
      var right = r.owed ? appH('div', { class: 'lval owed' }, [appH('span', { class: 'k', text: tt('ui_lbl_owed') + ' ' }), appH('span', { class: 'num', text: fmtMoney(r.owed) })]) : appH('div', { class: 'lval' });
      listBox.appendChild(appH('button', { type: 'button', class: 'lrow' + (hot === 'f:buyer:' + r.id ? ' hot' : ''), 'data-f': 'buyer:' + r.id,
        onclick: function () { appOpenScreen('buyer', r.id); } }, [left, right, appChevron()]));
    });
    if (res.more) listBox.appendChild(appH('div', { class: 'muted center small', text: tt('ui_buyers_more', { n: fmtCount(res.more) }) }));
  };
  input.addEventListener('input', function () { APP.buyersText = input.value; draw(); });
  // The search field with its magnifier inside it (13.6, F4), then the square + (fixer, review of step 3).
  var field = appH('label', { class: 'sfield' }, [appH('span', { class: 'ic', 'aria-hidden': 'true', html: appIconSvg('search') }), input]);
  box.appendChild(appH('div', { class: 'inbar' }, [field, appPageBtn('buyer:new', '', { iconOnly: 'plus', aria: tt('ui_aria_new_buyer'), cls: 'primary' }, function () {
    appOpenForm('buyer', {});
  })]));
  box.appendChild(listBox);
  draw();
  main.appendChild(box);
}

/** The buyer page's data: the record, its summary, the actions and the history rows (customerRows). */
function appBuyerView(phone, customerId) {
  var ports = phone.ports, c = ports.store.getCustomer(customerId);
  if (!c) return null;
  var s = customerSummary(ports, customerId), acts = [];
  if (s.owed > 0) {
    var credits = openCredits(ports, null).filter(function (x) { return x.customerId === customerId; });
    acts.push({ f: credits.length === 1 ? 'PY|' + credits[0].groupId : 'PL|' + customerId, key: 'btn_pay' });
  }
  acts.push({ f: 'DC|' + customerId, key: 'btn_deposit' });
  if (measureEnabled(ports)) acts.push({ f: 'MS|' + customerId, key: 'btn_measure' });
  acts.push({ f: 'CS|' + customerId, key: 'btn_statement' });
  return { customer: c, summary: s, actions: acts, history: customerRows(ports, customerId, CFG.CUST_HISTORY_LINES) };
}
function appBuyerScreen(main) {
  var tt = APP.tt, ports = APP.phone.ports, id = APP.screenArg, v = appBuyerView(APP.phone, id), box = appH('div', { class: 'page' });
  if (!v) { box.appendChild(appH('div', { class: 'muted', text: appPlain(t(ports, 'cust_none')) })); main.appendChild(box); return; }
  var c = v.customer, s = v.summary;
  box.appendChild(appH('div', { class: 'phead' }, [appH('h2', { text: c.name }), appPageBtn('edit', tt('ui_btn_edit'), { icon: 'pencil', cls: 'ghost' }, function () { appOpenForm('buyer', { customerId: c.id }); })]));
  if (c.phone) box.appendChild(appH('div', { class: 'kv' }, [appH('span', { class: 'k', text: tt('ui_lbl_phone') }), appH('a', { class: 'v num', href: 'tel:' + normPhone(c.phone), text: fmtPhone(c.phone) })]));
  if (c.note) box.appendChild(appKv(tt('ui_lbl_note'), c.note));
  box.appendChild(appKvh(tt('ui_lbl_money')));
  box.appendChild(appKv(tt('ui_lbl_bought'), fmtMoney(s.bought), { cls: 'num' }));
  box.appendChild(appKv(tt('ui_lbl_paid'), fmtMoney(s.paid), { cls: 'num' }));
  box.appendChild(appKv(tt('ui_lbl_owed'), fmtMoney(s.owed), { cls: 'num' + (s.owed > 0 ? ' owed' : '') }));
  if (s.depositHeld > 0) box.appendChild(appKv(tt('ui_lbl_deposit'), fmtMoney(s.depositHeld), { cls: 'num' }));
  if (s.lastDay) box.appendChild(appKv(tt('ui_lbl_last'), fmtDayShortMy(s.lastDay)));
  box.appendChild(appKv(tt('ui_lbl_visits'), myDigits(s.visits)));
  var acts = appH('div', { class: 'pacts' });
  v.actions.forEach(function (a) { acts.appendChild(appPageBtn(a.f, tt(a.key), {}, function () { appScreenAct(a.f); })); });
  box.appendChild(acts);
  box.appendChild(appKvh(tt('ui_buyer_history')));
  if (!v.history.length) box.appendChild(appH('div', { class: 'muted', text: appPlain(t(ports, 'cust_no_rows')) }));
  else {
    var tbl = appH('table', { class: 'tbl' });
    tbl.appendChild(appH('thead', {}, [appH('tr', {}, [appH('th', { text: tt('ui_lbl_date') }), appH('th', { text: tt('ui_lbl_what') }), appH('th', { class: 'r', text: tt('ui_lbl_amount') }), appH('th', {})])]));
    var tb = appH('tbody');
    v.history.forEach(function (e) {
      var first = e.name ? (e.n > 1 ? e.name + ' +' + myDigits(e.n - 1) : e.name) : txLabel(e.type);
      var what = [appH('div', { class: 'nm', text: first })];
      if (e.name) what.push(appH('div', { class: 'tag', text: txLabel(e.type) }));
      if (e.cash !== e.amount && e.type === CFG.TX.SALE) what.push(appH('div', { class: 'pairs' }, [appKvs(tt('ui_lbl_paid'), fmtMoney(e.cash))].concat(e.method ? [appKvs(tt('ui_lbl_method'), methodLabel(ports, e.method))] : [])));
      var hot = APP.win ? APP.win.SIM_HOT : undefined;
      tb.appendChild(appH('tr', { class: 'lrow' + (hot === 'f:row:' + e.groupId ? ' hot' : ''), 'data-f': 'row:' + e.groupId, role: 'button', tabindex: '0',
        onclick: function () { appOpenScreen(e.type === CFG.TX.SALE ? 'receipt' : 'entry', e.groupId); } },
        [appH('td', { class: 'date', text: fmtDayShortMy(e.day) }), appH('td', {}, what), appH('td', { class: 'r num', text: fmtMoney(e.amount) }), appH('td', { class: 'chev' }, [appChevron()])]));
    });
    tbl.appendChild(tb);
    box.appendChild(tbl);
  }
  main.appendChild(box);
}

/* ---------- the buyer form (13.6): kind 'buyer' of APP_FORM_KINDS ---------- */
function appBuyerInit(phone, req) {
  var c = req && req.customerId ? phone.ports.store.getCustomer(req.customerId) : null;
  return { selfId: c ? c.id : '', name: c ? c.name : '', phone: c ? (c.phone || '') : '', note: c ? (c.note || '') : '', forceNew: false };
}
function appBuyerSet(phone, values, f, v) {
  var x = appFormCopy(values);
  delete x.notice;
  if (f === 'name') { x.name = String(v || '').slice(0, CFG.CUST_NAME_MAX); x.forceNew = false; }
  else if (f === 'phone') x.phone = String(v || '').slice(0, 20);
  else if (f === 'note') x.note = String(v || '').slice(0, CFG.CUST_NOTE_MAX);
  else if (f === 'buyer:create') x.forceNew = true;
  return x;
}
function appBuyerView2(phone, values) {
  if (!values.attempted) return { problems: [] };
  var chk = customerCheck(phone.ports, { name: values.name, phone: values.phone, note: values.note, forceNew: values.forceNew }, values.selfId);
  return { problems: chk.problems };
}
/** Save the buyer form: customerCheck (the first problem in .fmsg), then commitCustomer (the customer entry, its Rev on the server). */
function appBuyerSave(phone, F) {
  if (F.saving) return { ok: false, reason: 'busy' };
  var v = F.values, chk = customerCheck(phone.ports, { name: v.name, phone: v.phone, note: v.note, forceNew: v.forceNew }, v.selfId);
  if (!chk.ok) {
    var x = appFormCopy(v);
    x.attempted = true;
    F.values = x;
    return { ok: false, reason: chk.problems[0].code, problems: chk.problems };
  }
  var c = commitCustomer(phone.ports, { name: v.name, phone: v.phone, note: v.note }, v.selfId);
  F.saving = true;
  return { ok: true, customer: c, created: !v.selfId };
}
function appBuyerRender(F, body) {
  var tt = APP.tt, v = F.values;
  body.appendChild(appFormSection(tt('ui_lbl_name'), [appFormInput(F, 'name', v.name, { maxlength: String(CFG.CUST_NAME_MAX), 'aria-label': tt('ui_lbl_name') }, [])]));
  body.appendChild(appFormSection(tt('ui_lbl_phone'), [appFormInput(F, 'phone', v.phone, { inputmode: 'tel', maxlength: '20', 'aria-label': tt('ui_lbl_phone') }, [])]));
  body.appendChild(appFormSection(tt('ui_lbl_note'), [appFormInput(F, 'note', v.note, { tag: 'textarea', rows: '2', maxlength: String(CFG.CUST_NOTE_MAX), 'aria-label': tt('ui_lbl_note') }, [])]));
  var probs = F.problems || [], ports = APP.phone.ports;
  probs.forEach(function (p) {
    var c = p.customerId ? ports.store.getCustomer(p.customerId) : null;
    if (!c || (p.code !== 'known_phone' && p.code !== 'same_name')) return;
    var row = appH('div', { class: 'fsec' }, [appH('div', { class: 'muted small', text: appPlain(t(ports, p.key, p.vars)) })]);
    var chips = appH('div', { class: 'chips' }, [appFormBtn(F, 'buyer:' + c.id, c.name + (c.phone ? ' · ' + fmtPhone(c.phone) : ''), { cls: 'bchip' })]);
    if (p.code === 'same_name') chips.appendChild(appFormBtn(F, 'buyer:create', tt('btn_create_named', { name: String(v.name || '').trim() }), { cls: 'bchip ghost' }));
    row.appendChild(chips);
    body.appendChild(row);
  });
}
/** A known-phone or same-name chip: the form closes and that buyer's page takes its layer (no history call, UX-M2). */
function appBuyerClick(F, f) {
  var m = /^buyer:(.+)$/.exec(f);
  if (!m || m[1] === 'create') return false;
  appCloseForm({ keep: true, pop: true, reset: true });
  appNavReplace({ kind: 'screen', name: 'buyer', arg: m[1] });
  APP.screen = 'buyer';
  APP.screenArg = m[1];
  appRender();
  return true;
}
/** After the Save: a new buyer's page replaces the form's layer; an edit goes back to that buyer's page. */
function appBuyerAfterSave(F, res) {
  if (res.created && res.customer) {
    appNavReplace({ kind: 'screen', name: 'buyer', arg: res.customer.id });
    APP.screen = 'buyer';
    APP.screenArg = res.customer.id;
  } else appNavDrop('form');
  appRender();
}

/* ---------- the shop form (13.12): kind 'shop' ---------- */
var APP_SHOP_FIELDS = ['name', 'address', 'phone'];
function appShopInit(phone, req) {
  var ports = phone.ports, id = String((req && req.id) || CFG.SHOP_IDS[0]);
  var cur = { name: shopName(ports, id), address: shopAddress(ports, id), phone: shopPhone(ports, id) };
  return { id: id, name: cur.name, address: cur.address, phone: cur.phone, orig: cur };
}
function appShopSet(phone, values, f, v) {
  var x = appFormCopy(values);
  delete x.notice;
  if (APP_SHOP_FIELDS.indexOf(f) >= 0) x[f] = String(v || '').slice(0, CFG.SHOP_TEXT_MAX[f]);
  return x;
}
function appShopView(phone, values) {
  return { problems: values.attempted && !String(values.name || '').trim() ? [{ code: 'name', key: 'ui_shop_name_needed', vars: {}, field: 'name' }] : [] };
}
/** Save the shop form: a blank name refused; each changed field one setting entry (the local Settings change at once). */
function appShopSave(phone, F) {
  if (F.saving) return { ok: false, reason: 'busy' };
  var v = F.values;
  if (!String(v.name || '').trim()) {
    var x = appFormCopy(v);
    x.attempted = true;
    F.values = x;
    return { ok: false, reason: 'name', problems: appShopView(phone, x).problems };
  }
  var changed = [];
  APP_SHOP_FIELDS.forEach(function (f) {
    var val = String(v[f] || '').trim().slice(0, CFG.SHOP_TEXT_MAX[f]);
    if (val !== String(v.orig[f] || '')) { phone.store.local.setSettingLocal('shop_' + f + '_' + v.id, val); changed.push(f); }
  });
  F.saving = true;
  return { ok: true, changed: changed };
}
function appShopRender(F, body) {
  var tt = APP.tt, v = F.values;
  body.appendChild(appFormSection(tt('ui_lbl_shop_name'), [appFormInput(F, 'name', v.name, { maxlength: String(CFG.SHOP_TEXT_MAX.name), 'aria-label': tt('ui_lbl_shop_name') }, [])]));
  body.appendChild(appFormSection(tt('ui_lbl_address'), [appFormInput(F, 'address', v.address, { maxlength: String(CFG.SHOP_TEXT_MAX.address), 'aria-label': tt('ui_lbl_address') }, [])]));
  body.appendChild(appFormSection(tt('ui_lbl_phone'), [appFormInput(F, 'phone', v.phone, { inputmode: 'tel', maxlength: String(CFG.SHOP_TEXT_MAX.phone), 'aria-label': tt('ui_lbl_phone') }, [])]));
}
function appShopAfterSave(F) {
  appNavDrop('form');
  appToast(APP.tt('ui_shop_saved'));
  appRender();
}
APP_FORM_KINDS.buyer = { init: appBuyerInit, set: appBuyerSet, view: appBuyerView2, save: appBuyerSave, render: function (F, body) { appBuyerRender(F, body); },
  click: appBuyerClick, afterSave: appBuyerAfterSave };
APP_FORM_KINDS.shop = { init: appShopInit, set: appShopSet, view: appShopView, save: appShopSave, render: function (F, body) { appShopRender(F, body); },
  afterSave: appShopAfterSave };

/* ============================== the receipt (13.10) ============================== */

/** The receipt page's data from buildReceipt and the letterhead; null for a group that is not a sale. */
function appReceiptView(phone, groupId) {
  var ports = phone.ports, r = buildReceipt(ports, groupId);
  if (!r) return null;
  var staff = phone.store.meta.staff || {}, g = groupRows(ports, groupId), info = saleGroupInfo(ports, groupId);
  var voidedByOwner = g.rows.some(function (x) { return x.reversesTxId && x.note === 'void by owner'; });
  var undone = !!r.voided && !voidedByOwner, u = appUndoInfo(ports, groupId), paidLater = appGroupPaidLater(ports, groupId);
  return {
    groupId: groupId, shopName: r.shopName, address: shopAddress(ports, r.shop), phone: shopPhone(ports, r.shop), no: r.no, date: r.date, time: r.time,
    customer: r.customer, lines: r.lines, total: r.total, paid: r.paid, method: appPlain(receiptMethodText(ports, r)), owed: r.owed,
    due: r.owed > 0 && r.dueDay ? fmtDayMy(r.dueDay) : '', transfer: r.transferLines.map(function (l) { return appPlain(l); }),
    thanks: appPlain(t(ports, 'receipt_thanks')), voided: !!r.voided && voidedByOwner, undone: undone,
    canUndo: !r.voided && u.allowed, until: u.until, canVoid: staff.role === 'owner' && !r.voided && basketGroup(info) && !paidLater,
    paidLater: !r.voided && paidLater
  };
}
/** The receipt as plain text for the phone's share sheet: the page's lines, 'label  value', no emoji. */
function appReceiptText(phone, v) {
  var ports = phone.ports, tt = function (k, x) { return appPlain(t(ports, k, x)); }, out = [v.shopName];
  if (v.address) out.push(v.address);
  if (v.phone) out.push(v.phone);
  if (v.undone) out.push(tt('ui_hist_undone'));
  else if (v.voided) out.push(tt('receipt_void'));
  out.push(tt('ui_lbl_receipt') + '  ' + v.no);
  out.push(tt('ui_lbl_date') + '  ' + v.date + ' ' + v.time);
  if (v.customer) out.push(tt('ui_lbl_buyer') + '  ' + v.customer);
  v.lines.forEach(function (l) { out.push(l.name + '  ' + myDigits(l.qty) + ' × ' + fmtMoney(l.unit) + '  ' + fmtMoney(l.amount)); });
  out.push(tt('ui_lbl_total') + '  ' + fmtMoney(v.total));
  out.push(tt('ui_lbl_paid') + v.method + '  ' + fmtMoney(v.paid));
  if (v.owed > 0) out.push(tt('ui_lbl_owed') + '  ' + fmtMoney(v.owed));
  if (v.due) out.push(tt('ui_lbl_due') + '  ' + v.due);
  v.transfer.forEach(function (l) { out.push(tt('ui_lbl_transfer') + '  ' + l); });
  out.push(v.thanks);
  return out.join('\n');
}
function appReceiptScreen(main) {
  var tt = APP.tt, g = APP.screenArg, v = appReceiptView(APP.phone, g), box = appH('div', { class: 'page receipt' });
  if (!v) { box.appendChild(appH('div', { class: 'muted', text: tt('expired') })); main.appendChild(box); return; }
  box.appendChild(appH('div', { class: 'rhead' }, [appH('div', { class: 'shop', text: v.shopName })].concat(v.address ? [appH('div', { class: 'muted', text: v.address })] : [])
    .concat(v.phone ? [appH('div', { class: 'muted num', text: v.phone })] : [])));
  if (v.undone) box.appendChild(appH('div', { class: 'mark', text: tt('ui_hist_undone') }));
  else if (v.voided) box.appendChild(appH('div', { class: 'mark', text: appPlain(t(APP.phone.ports, 'receipt_void')) }));
  box.appendChild(appKv(tt('ui_lbl_receipt'), v.no, { cls: 'num' }));
  box.appendChild(appKv(tt('ui_lbl_date'), v.date + ' ' + v.time));
  if (v.customer) box.appendChild(appKv(tt('ui_lbl_buyer'), v.customer));
  var tbl = appH('table', { class: 'tbl' });
  tbl.appendChild(appH('thead', {}, [appH('tr', {}, [appH('th', { text: tt('ui_lbl_item') }), appH('th', { class: 'r', text: tt('ui_lbl_qty') }), appH('th', { class: 'r', text: tt('ui_lbl_unit') }), appH('th', { class: 'r', text: tt('ui_lbl_amount') })])]));
  tbl.appendChild(appH('tbody', {}, v.lines.map(function (l) {
    return appH('tr', {}, [appH('td', { text: l.name }), appH('td', { class: 'r num', text: myDigits(l.qty) }), appH('td', { class: 'r num', text: fmtMoney(l.unit) }), appH('td', { class: 'r num', text: fmtMoney(l.amount) })]);
  })));
  box.appendChild(tbl);
  box.appendChild(appKv(tt('ui_lbl_total'), fmtMoney(v.total), { cls: 'num', rowCls: 'strong' }));
  box.appendChild(appKv(tt('ui_lbl_paid') + v.method, fmtMoney(v.paid), { cls: 'num' }));
  if (v.owed > 0) box.appendChild(appKv(tt('ui_lbl_owed'), fmtMoney(v.owed), { cls: 'num owed' }));
  if (v.due) box.appendChild(appKv(tt('ui_lbl_due'), v.due));
  v.transfer.forEach(function (l) { box.appendChild(appKv(tt('ui_lbl_transfer'), l)); });
  box.appendChild(appH('div', { class: 'thanks center', text: v.thanks }));
  var acts = appH('div', { class: 'rc-actions' });
  if (!v.undone) {
    acts.appendChild(appPageBtn('rc:share', tt('ui_receipt_share'), { icon: 'share', cls: 'primary' }, function () { appShareText(appReceiptText(APP.phone, v), v.no); }));
    acts.appendChild(appPageBtn('rc:print', tt('ui_receipt_print'), { icon: 'printer' }, function () { appReceiptPrint(g); }));
    // Undo and the owner's void ask first (appAskUndo, the UX review): they reverse money records.
    if (v.canUndo) {
      acts.appendChild(appPageBtn('undo', tt('btn_undo'), { icon: 'arrow-back-up' }, function () { appAskUndo(false, function () { appScreenAct('U|' + g); }); }));
      acts.appendChild(appH('div', { class: 'muted small', text: tt('ui_undo_until', { time: v.until }) }));
    }
    if (v.canVoid) acts.appendChild(appPageBtn('void', appPlain(t(APP.phone.ports, 'btn_void')), { cls: 'danger' }, function () { appAskUndo(true, function () { appScreenAct('V|' + g); }); }));
    // A payment taken later against this sale: no undo or void here; the line says why (the owner voids that payment first).
    if (v.paidLater) acts.appendChild(appH('div', { class: 'muted small', 'data-f': 'paid-later', text: appPlain(t(APP.phone.ports, 'rewrite_locked')) }));
  }
  box.appendChild(acts);
  main.appendChild(box);
}
/** PDF / Print: the phone's print dialog (the print stylesheet prints the receipt alone); else the server's PDF to Telegram. */
function appReceiptPrint(groupId) {
  if (APP.win && typeof APP.win.print === 'function') { APP.win.print(); return; }
  if (!APP.sync.online()) { appToast(APP.tt('app_need_online')); return; }
  APP.sync.requestReport('receipt', groupId, false).then(function (res) {
    appToast(res && res.ok ? APP.tt('app_report_sent') : APP.tt('ui_pdf_failed'), !(res && res.ok));
  });
}

/* ============================== views: cards as clean lists (13.9) ============================== */

/** The item card: {title, badge (the sample's word, round 6b, or ''), sub, rows, extra}. */
function appItemView(phone, id, extra) {
  var ports = phone.ports, it = ports.store.getItem(id), tt = function (k, v) { return appPlain(t(ports, k, v)); };
  if (!it) return null;
  var rows = [], unique = it.type === CFG.ITEM_TYPE.UNIQUE;
  rows.push(isPricePending(it) ? { k: tt('ui_lbl_price'), v: tt('btn_pending'), cls: 'warn' } : { k: tt('ui_lbl_price'), v: fmtMoney(it.price) + ' ကျပ်', cls: 'num' });
  if (!unique) rows.push({ k: tt('ui_lbl_stock'), v: fmtCount(it.stock), cls: 'num' });
  else rows.push({ k: tt('ui_lbl_stock'), v: Number(it.stock) > 0 ? tt('ui_val_have') : tt('ui_val_sold') });
  if (unique && Number(it.stock) <= 0) {
    var sale = lastLiveSale(ports, it.id);
    if (sale && sale.customerId) {
      var info = saleGroupInfo(ports, sale.groupId), ms = groupMethods(ports, sale.groupId);
      rows.push({ k: tt('ui_lbl_buyer'), v: customerName(ports, sale.customerId) });
      if (basketGroup(info)) rows.push({ k: tt('ui_lbl_basket'), v: tt('basket_count', { n: fmtCount(info.rows.length) }) });
      rows.push({ k: tt('ui_lbl_paid'), v: fmtMoney(info ? info.cash + info.payments + info.applied : sale.cash), cls: 'num' });
      rows.push({ k: tt('ui_lbl_method'), v: ms.length > 1 ? tt('btn_split') : methodLabel(ports, ms.length ? ms[0].method : (methodOf(sale) || CFG.METHOD.CASH)) });
    }
  }
  // Round 6b: a sample's mark is the badge (appViewNode draws it), and a category label typed with an emoji shows none.
  var catPlain = it.category ? appPlain(String(it.category)) : '';
  return { title: it.name, badge: it.sample ? tt('ui_lbl_sample') : '', sub: it.id + (catPlain ? ' · ' + catPlain : ''), rows: rows,
    extra: (extra || []).map(function (l) { return appPlain(l); }) };
}
/** The sold card: {title, sub, table, rows, extra}. */
function appSoldView(phone, groupId, extra) {
  var ports = phone.ports, info = saleGroupInfo(ports, groupId), tt = function (k, v) { return appPlain(t(ports, k, v)); };
  if (!info) return null;
  var table = { cols: [tt('ui_lbl_item'), tt('ui_lbl_qty'), tt('ui_lbl_amount')], rows: info.rows.map(function (r) {
    var it = ports.store.getItem(r.itemId);
    return { name: it ? it.name : r.itemId, qty: fmtCount(-r.qty), amount: fmtMoney(r.amount), note: it && it.type !== CFG.ITEM_TYPE.UNIQUE ? tt('ui_line_stock', { stock: fmtCount(it.stock) }) : '' };
  }) };
  var rows = [{ k: tt('ui_lbl_total'), v: fmtMoney(info.total), cls: 'num' }, { k: tt('ui_lbl_paid'), v: fmtMoney(info.cash + info.payments + info.applied), cls: 'num' }];
  if (info.owed > 0) rows.push({ k: tt('ui_lbl_owed'), v: fmtMoney(info.owed), cls: 'num owed' });
  var ms = groupMethods(ports, groupId);
  if (ms.length > 1) {
    rows.push({ k: tt('ui_lbl_method'), v: tt('btn_split') });
    ms.forEach(function (m) { rows.push({ k: methodLabel(ports, m.method), v: fmtMoney(m.amount), cls: 'num', indent: true }); });
  } else rows.push({ k: tt('ui_lbl_method'), v: methodLabel(ports, ms.length ? ms[0].method : CFG.METHOD.CASH) });
  if (info.customerId) rows.push({ k: tt('ui_lbl_buyer'), v: customerName(ports, info.customerId) });
  if (info.owed > 0 && info.dueDay) rows.push({ k: tt('ui_lbl_due'), v: fmtDayMy(info.dueDay) });
  var when = new Date(info.time);
  return { title: tt('ui_sold_title'), sub: receiptNumber(ports, groupId) + ' · ' + timeKey(when), table: table, rows: rows,
    extra: (extra || []).map(function (l) { return appPlain(l); }) };
}
/** The today card: per shop of the staff (the owner: every shop) a heading and dayStats' rows. */
function appTodayView(phone) {
  var ports = phone.ports, staff = phone.store.meta.staff || {}, day = dayKey(ports.clock.now()), tt = function (k) { return appPlain(t(ports, k)); };
  var shops = staff.role === 'owner' ? CFG.SHOP_IDS : [staff.shop];
  return { title: appPlain(t(ports, 'btn_today')), sections: shops.map(function (shop) {
    var s = dayStats(ports, shop, day);
    return { heading: shopName(ports, shop), rows: [
      { k: tt('ui_lbl_revenue'), v: fmtMoney(s.revenue), cls: 'num' }, { k: tt('ui_lbl_pieces'), v: fmtCount(s.pieces), cls: 'num' },
      { k: tt('ui_lbl_cash_in'), v: fmtMoney(s.cashIn), cls: 'num' }, { k: tt('ui_lbl_expenses'), v: fmtMoney(s.expenses), cls: 'num' },
      { k: tt('ui_lbl_profit'), v: fmtMoney(s.profit), cls: 'num' }, { k: tt('ui_lbl_drawer'), v: fmtMoney(s.drawerNet), cls: 'num' },
      { k: tt('ui_lbl_bank'), v: fmtMoney(s.bankNet), cls: 'num' }] };
  }) };
}
/** The reply of a committed restock, expense, payment or deposit (review r3, UX-M8), or of an undone basket: {title, sub, rows, table, undone}. */
function appGroupView(phone, groupId) {
  var ports = phone.ports, staff = phone.store.meta.staff || {}, g = groupRows(ports, groupId), T = CFG.TX, tt = function (k, v) { return appPlain(t(ports, k, v)); };
  var own = g.rows.filter(function (r) { return !r.reversesTxId; }), first = own[0];
  if (!first) return null;
  var out = { title: '', sub: timeKey(new Date(first.time)), rows: [], table: null, undone: !g.live.length };
  var method = function (r) { return methodLabel(ports, methodOf(r) || CFG.METHOD.CASH); };
  if (first.type === T.RESTOCK) {
    out.title = tt('btn_restock');
    out.table = { cols: [tt('ui_lbl_item'), tt('ui_lbl_pieces'), tt('ui_lbl_stock')], rows: own.map(function (r) {
      var it = ports.store.getItem(r.itemId);
      return { name: it ? it.name : r.itemId, note: r.itemId, qty: '+' + myDigits(r.qty), amount: fmtCount(it ? it.stock : 0) };
    }) };
  } else if (first.type === T.SALE) {
    // An undone or voided basket (the core's undoReplyView gives a group of more than one SALE row the group view): the
    // group's own SALE rows as a table (item | qty | stock now), drawn under ui_hist_undone; never one line's amount.
    out.title = appPlain(txLabel(T.SALE));
    out.table = { cols: [tt('ui_lbl_item'), tt('ui_lbl_qty'), tt('ui_lbl_stock')], rows: own.filter(function (r) { return r.type === T.SALE; }).map(function (r) {
      var it = ports.store.getItem(r.itemId);
      return { name: it ? it.name : r.itemId, note: r.itemId, qty: fmtCount(-r.qty), amount: fmtCount(it ? it.stock : 0) };
    }) };
  } else if (first.type === T.EXPENSE) {
    out.title = tt('btn_expense');
    out.rows.push({ k: tt('ui_lbl_amount'), v: fmtMoney(Math.abs(first.amount)), cls: 'num' });
    out.rows.push({ k: tt('ui_lbl_cat'), v: categoryLabel(ports, first.category) });
    out.rows.push({ k: tt('ui_lbl_method'), v: method(first) });
    if (first.note) out.rows.push({ k: tt('ui_lbl_note'), v: first.note });
    if (staff.role === 'owner') out.rows.push({ k: tt('ui_lbl_shop'), v: shopName(ports, first.shop) });
  } else if (first.type === T.PAYMENT) {
    out.title = tt('btn_pay');
    var info = first.refGroupId ? saleGroupInfo(ports, first.refGroupId) : null;
    out.rows.push({ k: tt('ui_lbl_buyer'), v: first.customerId ? customerName(ports, first.customerId) : '' });
    out.rows.push({ k: tt('ui_lbl_amount'), v: fmtMoney(first.amount), cls: 'num' });
    out.rows.push({ k: tt('ui_lbl_method'), v: method(first) });
    if (info) out.rows.push({ k: tt('ui_lbl_owed'), v: fmtMoney(Math.max(0, info.owed)), cls: 'num' + (info.owed > 0 ? ' owed' : '') });
  } else if (first.type === T.DEPOSIT) {
    out.title = tt('btn_deposit');
    out.rows.push({ k: tt('ui_lbl_buyer'), v: first.customerId ? customerName(ports, first.customerId) : '' });
    out.rows.push({ k: tt('ui_lbl_amount'), v: fmtMoney(first.amount), cls: 'num' });
    out.rows.push({ k: tt('ui_lbl_method'), v: method(first) });
    if (first.customerId) out.rows.push({ k: tt('ui_lbl_held'), v: fmtMoney(depositsFor(ports, first.customerId)), cls: 'num' });
    if (first.note) out.rows.push({ k: tt('ui_lbl_note'), v: first.note });
  } else {
    out.title = txLabel(first.type);
    out.rows.push({ k: tt('ui_lbl_amount'), v: fmtMoney(Math.abs(first.amount)), cls: 'num' });
  }
  return out;
}
/** A view as DOM (appRenderMsg draws it instead of the text). */
function appViewNode(view) {
  var phone = APP.phone, v = null, kind = view && view.kind;
  try {
    if (kind === 'item') v = appItemView(phone, view.id, view.extra);
    else if (kind === 'sold') v = appSoldView(phone, view.id, view.extra);
    else if (kind === 'today') v = appTodayView(phone);
    else if (kind === 'group') v = appGroupView(phone, view.id);
  } catch (err) { v = null; try { phone.ports.store.logError('view', err, '', String(kind)); } catch (ignore) {} }
  if (!v) return null;
  var box = appH('div', { class: 'view v-' + kind });
  if (v.undone) box.appendChild(appH('div', { class: 'mark muted', text: APP.tt('ui_hist_undone') }));
  if (v.title && v.badge) box.appendChild(appH('div', { class: 'vtitle' }, [appH('span', { text: v.title }), appH('span', { class: 'sbadge', text: v.badge })]));
  else if (v.title) box.appendChild(appH('div', { class: 'vtitle', text: v.title }));
  if (v.sub) box.appendChild(appH('div', { class: 'vsub num', text: v.sub }));
  if (v.table) {
    var tbl = appH('table', { class: 'tbl' });
    tbl.appendChild(appH('thead', {}, [appH('tr', {}, v.table.cols.map(function (c, i) { return appH('th', { class: i ? 'r' : '', text: c }); }))]));
    tbl.appendChild(appH('tbody', {}, v.table.rows.map(function (r) {
      return appH('tr', {}, [appH('td', {}, [appH('div', { text: r.name })].concat(r.note ? [appH('div', { class: 'tag', text: r.note })] : [])),
        appH('td', { class: 'r num', text: r.qty }), appH('td', { class: 'r num', text: r.amount })]);
    })));
    box.appendChild(tbl);
  }
  (v.rows || []).forEach(function (r) { box.appendChild(appKv(r.k, r.v, { cls: r.cls, indent: r.indent })); });
  (v.sections || []).forEach(function (s) {
    box.appendChild(appKvh(s.heading));
    s.rows.forEach(function (r) { box.appendChild(appKv(r.k, r.v, { cls: r.cls })); });
  });
  (v.extra || []).forEach(function (l) { box.appendChild(appH('div', { class: 'muted small', text: l })); });
  return box;
}

/* ============================== Settings: the AI switch and the Shops (13.11, 13.12) ============================== */

/** The AI parts as the phone allows them now: {ai, nb, voice, photo}. */
function appAiParts(ports) {
  var ai = aiOn(ports);
  return { ai: ai, nb: ai && settingOn(ports, 'notebook_import'), voice: ai && settingOn(ports, 'app_voice'), photo: ai };
}
/** The owner's switch: ON writes ai, notebook_import and app_voice TRUE; OFF writes ai FALSE (m-13). */
function appAiToggle() {
  var staff = APP.store.meta.staff || {};
  if (staff.role !== 'owner') { appToast(APP.tt('ui_ai_owner_only'), true); return; }
  var on = !aiOn(APP.phone.ports), L = APP.store.local;
  if (on) { L.setSettingLocal('ai', 'TRUE'); L.setSettingLocal('notebook_import', 'TRUE'); L.setSettingLocal('app_voice', 'TRUE'); }
  else L.setSettingLocal('ai', 'FALSE');
  appFormCommit(APP.phone, APP.sync, 'setting').then(function () { appRender(); });
  appRender();
}
function appSettingsAi(panel) {
  var tt = APP.tt, ports = APP.phone.ports, staff = APP.store.meta.staff || {}, p = appAiParts(ports), owner = staff.role === 'owner';
  var hot = APP.win ? APP.win.SIM_HOT : undefined;
  var sw = appH('button', { type: 'button', 'data-f': 'ai', role: 'switch', 'aria-checked': p.ai ? 'true' : 'false', class: 'switch' + (p.ai ? ' on' : '') + (hot === 'f:ai' ? ' hot' : ''),
    text: p.ai ? tt('ui_on') : tt('ui_off'), disabled: owner ? null : 'disabled', onclick: function () { appAiToggle(); } });
  panel.appendChild(appH('div', { class: 'kv' }, [appH('span', { class: 'k strong', text: tt('ui_ai_title') }), sw]));
  if (!owner) panel.appendChild(appH('div', { class: 'muted small', text: tt('ui_ai_owner_only') }));
  panel.appendChild(appH('div', { class: 'muted small', text: p.ai ? tt('ui_ai_hint') : tt('ui_ai_off_hint') }));
  panel.appendChild(appKv(tt('ui_ai_nb'), p.nb ? tt('ui_on') : tt('ui_off'), { indent: true }));
  panel.appendChild(appKv(tt('ui_ai_voice'), p.voice ? tt('ui_on') : tt('ui_off'), { indent: true }));
  panel.appendChild(appKv(tt('ui_ai_photo'), p.photo ? tt('ui_on') : tt('ui_off'), { indent: true }));
}
/** The owner's Shops section: one row per shop of CFG.SHOP_IDS (name, then the address and the phone on lines of their own). */
function appSettingsShops(main) {
  var tt = APP.tt, ports = APP.phone.ports, staff = APP.store.meta.staff || {};
  if (staff.role !== 'owner') return;
  var box = appH('div', { class: 'panel' }, [appH('h3', { text: tt('ui_shops_title') })]);
  CFG.SHOP_IDS.forEach(function (id) {
    var addr = shopAddress(ports, id), ph = shopPhone(ports, id), hot = APP.win ? APP.win.SIM_HOT : undefined;
    var lines = [appH('div', { class: 'nm', text: shopName(ports, id) }), appH('div', { class: 'tag', text: addr || tt('ui_shop_no_address') })];
    if (ph) lines.push(appH('div', { class: 'tag num', text: ph }));
    box.appendChild(appH('button', { type: 'button', class: 'lrow' + (hot === 'f:shop:' + id ? ' hot' : ''), 'data-f': 'shop:' + id, onclick: function () { appOpenForm('shop', { id: id }); } },
      [appH('div', { class: 'lmain' }, lines), appChevron()]));
  });
  main.appendChild(box);
}
