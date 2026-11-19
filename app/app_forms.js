/**
 * app/app_forms.js — the sellers' forms (round 6: docs/design-round-6/SPEC-round-6.md 1, 7.2, 7.3, 7.8; revision 3, 13).
 *
 * Four app-native pages on document.body (the #measForm precedent): the sale form #saleForm (1.3), the new-piece form
 * #newForm (1.5), the restock form #restockForm (1.6) and the expense form #expenseForm (1.7). Revision 3 adds the buyer
 * and shop forms (app_screens.js registers them in APP_FORM_KINDS). Each kind is {init, set, view, save, render}:
 *   - the PURE part (no DOM; Node-tested on an enrolled phone, as the measurement form's appMeas* helpers): the values
 *     of a fresh or restored form (the draft rule of 1.0), one state change per control name (data-f, 7.8), the view the
 *     screen and the checks share, and the Save that calls the core (basketCommitDraft, commitNewItem,
 *     commitRestockGroup, commitExpense) and pushes the core's reply card to the phone's own chat;
 *   - the DOM part: the page, its regions, the camera strip, the keypads, the draft, the nav layer (13.4).
 * Labels go through APP.tt (plain, 13.1); the core's texts (t) are made plain where they are drawn.
 * Plain ES5: var and function only. No DOM access at load time.
 */
var APP_FORM_DRAFT_MS = 400;          // debounce of the draft's durable write
var APP_FORM_RESCAN_MS = 700;         // the strip's camera starts again this long after a read
var APP_NEW_DRAFT_TTL = 86400;        // a new-piece draft is kept one day (the others CFG.STATE_TTL_SEC)
var APP_FORM_SAME_TAG_MS = 8000;      // a tag held in view is read once (app_scan.js holdMs, revision 2 U2)

/* ============================== the pure part ============================== */

function appFormCopy(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
function appFormStaff(phone) { return phone.store.meta.staff || { id: '0', role: 'staff', shop: CFG.SHOP_IDS[0] }; }

/* ---------- drafts: formdraft:<kind>:<key> in the persisted cache ---------- */
function appFormDraftKey(kind, key) { return 'formdraft:' + kind + ':' + key; }
function appFormDraftRead(store, kind, key) {
  if (!key) return null;
  var raw = store.cacheGet(appFormDraftKey(kind, key)), d = null;
  if (!raw) return null;
  try { d = JSON.parse(raw); } catch (ignore) { return null; }
  return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
}
function appFormDraftWrite(store, kind, key, values) {
  if (!key) return;
  var v = appFormCopy(values) || {};
  delete v.notice;
  delete v.found;
  delete v.attempted;
  store.cachePut(appFormDraftKey(kind, key), JSON.stringify(v), kind === 'newitem' ? APP_NEW_DRAFT_TTL : CFG.STATE_TTL_SEC);
}
function appFormDraftDrop(store, kind, key) { if (key) store.cacheRemove(appFormDraftKey(kind, key)); }

/** The home's job tiles: the four forms while forms are on (formsInApp), else none (quick: today's home). */
function appHomeJobs(ports) { return formsInApp(ports) ? ['sell', 'new', 'restock', 'expense'] : []; }

/** The line kept by 🔄 / restored:clear: the opener's line when the form was opened with an item. */
function appFormOpenerLines(values) {
  var keep = [];
  (values.lines || []).forEach(function (l) { if (values.opener && l.id === values.opener) keep.push(l); });
  return keep;
}
/** restored:merge: the older lines first, then the current ones, each id once. */
function appFormMergeLines(older, lines) {
  var out = [], seen = {};
  (older || []).concat(lines || []).forEach(function (l) { if (!seen['i:' + l.id]) { seen['i:' + l.id] = true; out.push(l); } });
  return out;
}
/** A restored draft's lines without the one-of-a-kind pieces sold meanwhile; gone collects their ids. */
function appFormLiveLines(ports, lines, gone) {
  return (lines || []).filter(function (l) {
    var it = ports.store.getItem(l.id);
    var ok = !!it && !(it.type === CFG.ITEM_TYPE.UNIQUE && Number(it.stock) <= 0) && it.status !== CFG.STATUS.BLANK;
    if (!ok) gone.push(l.id);
    return ok;
  });
}
/** The draft rule of 1.0 (revision 2, U3) for a form with lines (sale, restock). add(values, id) -> {ok, values, text}. */
function appFormInitLines(phone, kind, req, fresh, add) {
  var ports = phone.ports, d = appFormDraftRead(phone.store, kind, phone.staffId()), gone = [], values;
  if (d && d.lines) d.lines = appFormLiveLines(ports, d.lines, gone);
  if (d && !(d.lines || []).length) d = null;                // a draft without a line holds nothing to bring back
  var has = function (id) { return !!d && d.lines.some(function (l) { return l.id === id; }); };
  if (!req.itemId || has(req.itemId)) {
    values = fresh;
    if (d) { for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) values[k] = d[k]; values.restored = true; values.older = values.older || []; }
  } else {
    values = fresh;
    var r = add(values, req.itemId);
    if (r.ok) values = r.values; else values.notice = r.text;
    if (d && d.lines && d.lines.length) values.older = d.lines;
  }
  values.opener = req.itemId ? String(req.itemId) : '';
  if (gone.length && !values.notice) values.notice = t(ports, 'basket_gone', { id: gone[0] });
  return values;
}

/* ---------- the sale form (1.3) ---------- */
function appSaleFresh() {
  return { lines: [], method: CFG.METHOD.CASH, part: false, paid: null, dueDay: null, mixed: false, bankPart: null, payMode: '',
    acctAdd: false, addLabel: '', addKind: '', customerId: '', buyerText: '', newBuyer: false, newName: '', newPhone: '', forceNew: false,
    find: '', older: [], restored: false, opener: '' };
}
/** The shop of the basket: the first line's item's shop; with no line the seller's own (the owner: the first shop). */
function appSaleShop(phone, values) {
  var ports = phone.ports, staff = appFormStaff(phone), l = (values.lines || [])[0], it = l ? ports.store.getItem(l.id) : null;
  if (it) return it.shop;
  return staff.role === 'owner' ? (staff.shop || CFG.SHOP_IDS[0]) : staff.shop;
}
function appSaleInit(phone, req) {
  req = req || {};
  var values = appFormInitLines(phone, 'sale', req, appSaleFresh(), function (v, id) {
    var r = appSaleAdd(phone, v, id, req.qty || 1);
    if (r.ok && !nullish(req.unitPrice) && req.unitPrice !== '') {
      var line = r.values.lines[r.values.lines.length - 1];
      line.unitPrice = Number(req.unitPrice);
      line.priceChanged = req.priceChanged !== false;
    }
    return r;
  });
  return values;
}
/**
 * A piece into the sale form: an id already a line changes nothing (0.3 rule 14: the stepper is the count) and answers
 * ui_form_twice (a stock item) or basket_twice (a one-of-a-kind piece); else basketAddItem's rule. {ok, values} or
 * {ok: false, twice?, reason, text}.
 */
function appSaleAdd(phone, values, itemId, qty) {
  var ports = phone.ports, lines = values.lines || [], id = String(itemId || '');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].id === id) {
      var it = ports.store.getItem(id);
      return { ok: false, twice: true, reason: 'twice', text: t(ports, it && it.type === CFG.ITEM_TYPE.UNIQUE ? 'basket_twice' : 'ui_form_twice', { id: id }) };
    }
  }
  var r = basketAddItem(ports, appFormStaff(phone), lines, id, qty || 1);
  if (!r.ok) return { ok: false, reason: r.reason, text: t(ports, BASKET_REASON_KEY[r.reason] || 'expired', r.vars) };
  var v = appFormCopy(values);
  v.lines = r.lines;
  return { ok: true, values: v, index: r.index };
}
function appSaleLine(values, id) {
  for (var i = 0; i < (values.lines || []).length; i++) if (values.lines[i].id === id) return values.lines[i];
  return null;
}
/** The total of the basket and what is paid now (the part amount, or everything). */
function appSalePaidNow(phone, values) {
  var T = basketTotals(values.lines, { part: false });
  return values.part && !nullish(values.paid) && values.paid !== '' ? Math.round(Number(values.paid)) : T.total;
}
/** Digits and phone punctuation only (a phone typed into the buyer search). */
function appIsPhoneText(s) { return /^[0-9၀-၉\s+().\-]+$/.test(String(s || '').trim()) && /[0-9၀-၉]/.test(String(s || '')); }

/** The one state change of a control name (7.8). Returns NEW values; values.notice carries a toast for the screen. */
function appSaleSet(phone, values, f, v) {
  var ports = phone.ports, x = appFormCopy(values), parts = String(f).split(':'), name = parts[0], arg = parts.slice(1).join(':');
  var line = arg ? appSaleLine(x, arg) : null, item = arg ? ports.store.getItem(arg) : null;
  var num = function (n) { var q = Math.round(Number(n)); return isFinite(q) ? q : null; };
  delete x.notice;
  switch (name) {
    case 'qty+': case 'qty-': case 'qty':
      if (!line) break;
      if (item && item.type === CFG.ITEM_TYPE.UNIQUE) { line.qty = 1; break; }
      var q = name === 'qty+' ? (Number(line.qty) || 1) + 1 : name === 'qty-' ? (Number(line.qty) || 1) - 1 : num(v);
      if (q === null) break;
      line.qty = Math.max(1, Math.min(CFG.MAX_SALE_QTY, q));
      break;
    case 'price':
      var p = num(v);
      if (!line || p === null || p < 1) break;
      line.unitPrice = p;
      line.priceChanged = !(item && Number(item.price) === p);
      break;
    case 'remove':
      x.lines = (x.lines || []).filter(function (l) { return l.id !== arg; });
      break;
    case 'find': x.find = String(v === undefined || v === null ? '' : v); break;
    case 'find:go':
    case 'find_go': break;
    case 'found': case 'recent':
      var r = appSaleAdd(phone, x, arg, 1);
      if (r.ok) x = r.values; else x.notice = r.text;
      break;
    case 'buyer':
      if (!arg) { x.buyerText = String(v === undefined || v === null ? '' : v); break; }
      if (arg === 'new') {
        var s = String(x.buyerText || '').trim();
        x.newBuyer = true; x.customerId = ''; x.forceNew = false;
        if (s) { if (appIsPhoneText(s)) x.newPhone = s; else x.newName = s; }
        x.buyerText = '';
      } else if (arg === 'create') x.forceNew = true;
      else if (arg === 'clear') { x.customerId = ''; x.newBuyer = false; x.newName = ''; x.newPhone = ''; x.forceNew = false; x.buyerText = ''; }
      else if (ports.store.getCustomer(arg)) { x.customerId = arg; x.newBuyer = false; x.newName = ''; x.newPhone = ''; x.forceNew = false; x.buyerText = ''; }
      break;
    case 'name': x.newName = String(v || ''); x.forceNew = false; break;
    case 'phone': x.newPhone = String(v || ''); break;
    case 'pay':
      x.acctAdd = false; x.mixed = false; x.bankPart = null;
      if (arg === 'wallets') { x.payMode = 'wallets'; x.method = CFG.METHOD.CASH; }
      else if (arg === 'bank') {
        var banks = payMethodsByKind(ports, appSaleShop(phone, x)).banks;
        x.payMode = 'bank'; x.method = banks.length === 1 ? banks[0] : CFG.METHOD.CASH;
      } else if (arg === 'mix') {
        var all = payMethods(ports, appSaleShop(phone, x)).filter(function (k) { return k !== CFG.METHOD.CASH; });
        x.payMode = 'mix'; x.mixed = true; x.method = all.length === 1 ? all[0] : CFG.METHOD.CASH;
      } else if (arg === 'add') { x.payMode = 'add'; x.method = CFG.METHOD.CASH; x.acctAdd = true; }
      else { x.payMode = ''; x.method = String(arg || CFG.METHOD.CASH).toUpperCase(); }
      break;
    case 'acct':
      if (arg === 'add') { x.acctAdd = true; break; }
      x.acctAdd = false;
      x.method = String(arg).toUpperCase();
      break;
    case 'acctname': x.addLabel = String(v || ''); break;
    case 'acctkind': x.addKind = arg === 'bank' ? 'bank' : 'wallet'; break;
    case 'transfer':
      if (arg === 'half') { x.bankPart = Math.floor(appSalePaidNow(phone, x) / 2); break; }
      var b = num(v);
      if (b !== null && b >= 1) x.bankPart = Math.min(b, appSalePaidNow(phone, x));
      break;
    case 'paid':
      if (arg === 'full') { x.part = false; x.paid = null; x.dueDay = null; }
      else if (arg === 'part') x.part = true;
      break;
    case 'amount':
      var T = basketTotals(x.lines, { part: false }), a = arg === '0' ? 0 : arg === 'half' ? Math.round(T.total / 2) : num(v);
      if (a === null || a < 0) break;
      x.paid = Math.min(a, T.total);
      x.part = true;
      if (T.total > 0 && x.paid >= T.total) { x.part = false; x.paid = null; x.dueDay = null; }
      break;
    case 'due':
      if (arg === 'none') x.dueDay = '';
      else if (arg !== 'date') { var dk = saleDueKey(ports.clock.now(), Number(arg)); if (dk !== null) x.dueDay = dk; }
      break;
    case 'date':
      var dd = saleDueKey(ports.clock.now(), String(v || ''));
      if (dd !== null && dd !== '') x.dueDay = dd;
      break;
    case 'restored':
      if (arg === 'clear') { x.lines = appFormOpenerLines(x); x.older = []; x.restored = false; x.part = false; x.paid = null; x.dueDay = null; x.customerId = ''; x.newBuyer = false; x.buyerText = ''; }
      else if (arg === 'merge') { x.lines = appFormMergeLines(x.older, x.lines).slice(0, CFG.BASKET_MAX_LINES); x.older = []; }
      break;
  }
  return x;
}

/** The buyer of the form for the checks: a picked customer, the new buyer's fields, or the search text left behind. */
function appSaleBuyer(values) {
  if (values.customerId) return { customerId: values.customerId, newName: '', newPhone: '' };
  if (values.newBuyer) return { customerId: '', newName: String(values.newName || '').trim(), newPhone: String(values.newPhone || '').trim() };
  var s = String(values.buyerText || '').trim();
  if (!s) return { customerId: '', newName: '', newPhone: '' };
  return appIsPhoneText(s) ? { customerId: '', newName: '', newPhone: s } : { customerId: '', newName: s, newPhone: '' };
}
/** Every customer whose phone is this one (7 digits or more). */
function appSaleKnownPhone(ports, phoneText) {
  var d = normPhone(phoneText);
  if (d.length < 7) return [];
  return ports.store.listCustomers().filter(function (c) { return normPhone(c.phone) === d; });
}
/** The draft of 2.1 for basketCheck / basketCommitDraft (7.2). */
function appSaleDraftOf(phone, values) {
  var b = appSaleBuyer(values), pendingAcct = !!values.acctAdd && !!String(values.addLabel || '').trim();
  var d = {
    lines: appFormCopy(values.lines || []), method: values.method || CFG.METHOD.CASH, mixed: !!values.mixed,
    bankPart: values.mixed ? values.bankPart : null, part: !!values.part, paid: values.part ? values.paid : null,
    dueDay: values.part ? values.dueDay : '', customerId: b.customerId, newName: b.newName, newPhone: b.newPhone,
    forceNew: !!values.forceNew, needAccount: ''
  };
  if (!pendingAcct && String(d.method).toUpperCase() === CFG.METHOD.CASH) {
    if (values.payMode === 'mix') d.needAccount = 'all';
    else if (values.payMode === 'bank' || values.payMode === 'wallets') d.needAccount = 'one';
  }
  if (pendingAcct) { d.addLabel = String(values.addLabel).trim(); d.addKind = values.addKind || ''; }
  return d;
}
/** The data-f of the field a problem outlines. */
function appSaleProblemField(p) {
  switch (p.code) {
    case 'buyer_pick': case 'need_buyer': return 'buyer';
    case 'need_name': case 'same_name': return 'name';
    case 'known_phone': case 'phone': return 'phone';
    case 'acct_name': return 'acctname';
    case 'missing': case 'blank': case 'other_shop': case 'gone': case 'twice': case 'qty': return 'line:' + p.id;
    case 'need_price': return 'price:' + p.id;
    case 'method': return 'pay';
    case 'account': return 'acct';
    case 'transfer': return 'transfer';
    case 'paid_none': case 'paid': return 'amount';
    case 'due_none': case 'due': return 'due';
  }
  return '';
}
/** The app's own checks (U8, U9, the typed account), then basketCheck: [{code, key, vars, field, id, customerIds}]. */
function appSaleProblems(phone, values) {
  var ports = phone.ports, staff = appFormStaff(phone), out = [], text = String(values.buyerText || '').trim();
  var add = function (p) { p.field = p.field || appSaleProblemField(p); out.push(p); };
  if (!values.customerId && !values.newBuyer && text) {
    if (findCustomers(ports, text).length) add({ code: 'buyer_pick', key: 'ui_buyer_pick_first', vars: {} });
    else if (appIsPhoneText(text)) add({ code: 'need_name', key: 'ask_name', vars: {} });
  }
  if (values.newBuyer && !String(values.newName || '').trim() && String(values.newPhone || '').trim()) add({ code: 'need_name', key: 'ask_name', vars: {} });
  var b = appSaleBuyer(values);
  if (!b.customerId && (b.newName || b.newPhone)) {
    var known = appSaleKnownPhone(ports, b.newPhone);
    if (known.length) add({ code: 'known_phone', key: 'ui_buyer_known_phone', vars: { customer: known.map(function (c) { return c.name; }).join(', ') }, customerIds: known.map(function (c) { return c.id; }) });
    var same = b.newName && !values.forceNew ? matchCustomers(ports, b.newName).exact : null;
    if (same && normName(same.name) === normName(b.newName)) add({ code: 'same_name', key: 'ui_buyer_same_name', vars: {}, customerIds: [same.id] });
  }
  if (values.acctAdd) {
    var lf = listFindByLabel(ports, 'pay_method', values.addLabel);
    if (!lf.ok) add({ code: 'acct_name', key: lf.reason === 'unavailable' ? 'add_unavailable' : 'add_ask_pm', vars: {} });
  }
  var chk = basketCheck(ports, staff, appSaleDraftOf(phone, values), { pendingMethod: !!values.acctAdd && !!String(values.addLabel || '').trim() });
  chk.problems.forEach(function (p) { add({ code: p.code, key: p.key, vars: p.vars, id: p.id }); });
  return out;
}

/** What the sale form shows (1.3), the same for the screen and the Node checks. */
function appSaleView(phone, values) {
  var ports = phone.ports, staff = appFormStaff(phone), shop = appSaleShop(phone, values), now = ports.clock.now();
  var lines = (values.lines || []).map(function (l) {
    var it = ports.store.getItem(l.id) || { id: l.id, name: l.id, type: CFG.ITEM_TYPE.UNIQUE, stock: 0, price: '' };
    var unique = it.type === CFG.ITEM_TYPE.UNIQUE, qty = unique ? 1 : (Number(l.qty) || 1);
    var pending = nullish(l.unitPrice) || l.unitPrice === '';
    var listPrice = Number(it.price) || 0;
    return { id: l.id, name: it.name, sample: !!it.sample, unique: unique, qty: qty, unitPrice: pending ? null : Number(l.unitPrice), listPrice: listPrice,
      priceChanged: !!l.priceChanged && !pending && Number(l.unitPrice) !== listPrice, pending: pending, amount: pending ? 0 : qty * Number(l.unitPrice),
      stock: Number(it.stock) || 0, stockOver: !unique && qty > (Number(it.stock) || 0), priceFar: !pending && listPrice > 0 && Number(l.unitPrice) > 10 * listPrice };
  });
  var paidNow = appSalePaidNow(phone, values);
  var T = basketTotals(values.lines || [], { part: !!values.part && !nullish(values.paid) && values.paid !== '', paid: values.paid, method: values.method, mixed: values.mixed, bankPart: values.bankPart });
  var kinds = payMethodsByKind(ports, shop), nonCash = payMethods(ports, shop).filter(function (k) { return k !== CFG.METHOD.CASH; });
  var choices = 1 + kinds.wallets.length + (kinds.banks.length ? 1 : 0) + (nonCash.length && T.total >= 2 ? 1 : 0);
  var collapse = choices > 6;
  var accounts = values.payMode === 'bank' ? kinds.banks : values.payMode === 'wallets' ? kinds.wallets : values.payMode === 'mix' ? nonCash : [];
  var b = appSaleBuyer(values), buyer = values.customerId ? ports.store.getCustomer(values.customerId) : null;
  var text = String(values.buyerText || '').trim();
  var matches = text ? findCustomers(ports, text).slice(0, 6) : recentCustomers(ports, staff.role === 'owner' ? shop : staff.shop, 3);
  var known = !values.customerId && values.newBuyer ? appSaleKnownPhone(ports, values.newPhone) : [];
  var same = !values.customerId && values.newBuyer && !values.forceNew && String(values.newName || '').trim() ? matchCustomers(ports, values.newName).exact : null;
  if (same && normName(same.name) !== normName(values.newName)) same = null;
  var owed = values.part ? Math.max(0, T.total - paidNow) : 0;
  var problems = values.attempted ? appSaleProblems(phone, values) : [];
  var inBasket = {};
  (values.lines || []).forEach(function (l) { inBasket[l.id] = true; });
  var recentTiles = recentItems(ports, shop, 12).filter(function (it) {
    return it.shop === shop && !inBasket[it.id] && !(it.type === CFG.ITEM_TYPE.UNIQUE && Number(it.stock) <= 0);
  }).slice(0, 2);
  var found = values.find && values.foundFor === values.find ? (values.found || []) : null;
  return {
    shop: shop, lines: lines, totals: T, total: T.total, paidNow: paidNow, owed: owed, wallets: kinds.wallets, banks: kinds.banks,
    collapseWallets: collapse, canMix: nonCash.length > 0 && T.total >= 2, accounts: accounts, showAccounts: !!values.payMode && values.payMode !== 'add',
    showAdd: !!values.acctAdd, showTransfer: !!values.mixed && (values.method !== CFG.METHOD.CASH || !!values.acctAdd),
    buyer: buyer, newBuyer: !!values.newBuyer, matches: matches, knownPhone: known, sameName: same, buyerText: text,
    needAmount: !!values.part && (nullish(values.paid) || values.paid === ''), needDue: !!values.part && nullish(values.dueDay),
    needBuyer: !!values.part && !b.customerId && !b.newName,
    duePresets: saleDuePresets(ports).slice(0, 3), dueMax: addDaysKey(dayKey(now), CFG.SALE_DUE_MAX_DAYS),
    recent: recentTiles, found: found, older: (values.older || []).length, restored: !!values.restored, problems: problems
  };
}

/**
 * Save the sale form (7.2): busy while saving; the app's checks and basketCheck (refused: {ok: false, reason, problems},
 * F.values marked attempted; a method problem puts the method back to cash, a need_name problem opens the new buyer's
 * fields); a typed account's Lists row right before the ledger write (basketCommitDraft's beforeWrite, the same commit);
 * basketCommitDraft; the sold card pushed to the phone's own chat; the draft dropped. Writes nothing durable itself.
 */
function appSaleSave(phone, F) {
  if (F.saving) return { ok: false, reason: 'busy' };
  var ports = phone.ports, store = phone.store, staff = appFormStaff(phone), uid = phone.staffId(), values = F.values;
  var probs = appSaleProblems(phone, values);
  if (probs.length) {
    var first = probs[0], v = appFormCopy(values);
    v.attempted = true;
    if (first.code === 'method') { v.method = CFG.METHOD.CASH; v.mixed = false; v.payMode = ''; v.bankPart = null; v.acctAdd = false; }
    if (first.code === 'need_name' && !v.newBuyer) { v.newBuyer = true; v.newPhone = v.buyerText; v.buyerText = ''; }
    F.values = v;
    return { ok: false, reason: first.code, problems: probs };
  }
  var draft = appSaleDraftOf(phone, values), pending = !!draft.addLabel;
  var res = basketCommitDraft(ports, staff, draft, {
    uid: uid, source: CFG.SOURCE.BUTTON, updateId: store.nextUpdateId(), pendingMethod: pending,
    beforeWrite: function (d) {
      if (!pending) return;
      var a = addListOptionByLabel(ports, 'pay_method', d.addLabel, staff, d.addKind ? { kind: d.addKind } : undefined);
      if (a.ok) { d.method = a.key; if (a.created) d.addedKey = a.key; }
    }
  });
  if (!res.ok) {
    var w = appFormCopy(values);
    w.attempted = true;
    F.values = w;
    return { ok: false, reason: res.problems[0].code, problems: res.problems };
  }
  F.saving = true;
  clearState(ports, uid);
  basketSoldReply(ports, uid, null, false, res.r, draft, res.customer);
  appFormDraftDrop(store, 'sale', uid);
  return { ok: true, groupId: res.r.groupId };
}

/* ---------- the new-piece form (1.5) ---------- */
// Round 6b (SPEC-round-6b.md 2.5): category is the chosen item category's NAME ('' = none, Save stores the catch-all);
// catKey is the chosen chip's row key ('' = none: an older draft, or no chip): an owner's relabel of that row while the
// form or its draft is open keeps the choice. catAdd / catName are the plus chip and its typed name.
function appNewItemFresh(tag) {
  return { tag: tag || '', photo: '', name: '', category: '', catKey: '', catAdd: false, catName: '', cost: null, price: null, pending: false, count: 1, sample: false, restored: false };
}
function appNewItemInit(phone, req) {
  req = req || {};
  var values = appNewItemFresh(req.itemId ? String(req.itemId) : '');
  var d = req.itemId ? appFormDraftRead(phone.store, 'newitem', String(req.itemId)) : null;
  if (d) {
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) values[k] = d[k];
    values.tag = String(req.itemId);
    values.restored = true;
  }
  // A round-6 draft holds cat as an index of CFG.CATEGORIES: its name (the view decides whether a chip still offers it).
  if (typeof values.cat === 'number') values.category = values.cat >= 0 && values.cat < CFG.CATEGORIES.length ? CFG.CATEGORIES[values.cat] : '';
  delete values.cat;
  if (typeof values.category !== 'string') values.category = '';
  if (typeof values.catKey !== 'string') values.catKey = '';
  values.catAdd = !!values.catAdd;
  if (typeof values.catName !== 'string') values.catName = '';
  if (values.photo && !phone.store.getMedia(values.photo)) values.photo = '';
  return values;
}
/** A tag into the new-piece form: BLANK only, and for a seller a tag of the own shop. {ok, values} or {ok: false, text}. */
function appNewItemTag(phone, values, id) {
  var ports = phone.ports, staff = appFormStaff(phone), it = ports.store.getItem(id);
  if (!it) return { ok: false, reason: 'missing', text: t(ports, 'tag_not_found', { id: id }) };
  if (it.status !== CFG.STATUS.BLANK) return { ok: false, reason: 'not_blank', text: t(ports, 'tag_not_blank', { id: id }) };
  if (staff.role !== 'owner' && it.shop !== staff.shop) return { ok: false, reason: 'other_shop', text: t(ports, 'basket_other_shop', { id: id, shop: shopName(ports, it.shop) }) };
  var v = appFormCopy(values);
  v.tag = it.id;
  delete v.attempted;
  return { ok: true, values: v };
}
function appNewItemSet(phone, values, f, v) {
  // arg: everything after the first ':' (a hand-typed category key may hold ':'); undefined without one.
  var x = appFormCopy(values), parts = String(f).split(':'), name = parts[0], arg = parts.length > 1 ? parts.slice(1).join(':') : undefined;
  var num = function (n) { var q = Math.round(Number(n)); return isFinite(q) ? q : null; };
  delete x.notice;
  switch (name) {
    case 'tag': var r = appNewItemTag(phone, x, String(v || '')); if (r.ok) x = r.values; else x.notice = r.text; break;
    case 'name': x.name = String(v || '').slice(0, 60); break;
    case 'cat':
      // cat:add toggles the typed name; cat:<key> picks from the rows the chips came from (itemCategoryOptions) and keeps
      // the row's key; a second tap on the chosen chip (its kept key, else its name's row) clears it.
      if (arg === 'add') { x.catAdd = !x.catAdd; if (x.catAdd) { x.category = ''; x.catKey = ''; } break; }
      var cports = phone.ports, cit = x.tag ? cports.store.getItem(x.tag) : null, copts = itemCategoryOptions(cports, cit ? cit.shop : appFormStaff(phone).shop);
      var ckey = listNormKey('item_category', arg), crow = null, ci;
      for (ci = 0; ci < copts.length; ci++) if (copts[ci].key === ckey) { crow = copts[ci]; break; }
      if (!crow) break;
      var ccur = appNewItemCatRow(cports, copts, x);
      if (ccur && ccur.key === crow.key) { x.category = ''; x.catKey = ''; }
      else { x.category = crow.label; x.catKey = crow.key; x.catAdd = false; }
      break;
    case 'catname': x.catName = String(v || '').slice(0, CFG.LIST_LABEL_MAX); break;
    case 'cost': var c = num(v); x.cost = c === null || c < 1 ? null : c; break;
    case 'price':
      var p = arg !== undefined ? num(arg) : num(v);
      if (p !== null && p >= 1) { x.price = p; x.pending = false; }
      break;
    case 'pending': x.pending = !x.pending; if (x.pending) x.price = null; break;
    case 'count-': x.count = Math.max(1, (Number(x.count) || 1) - 1); break;
    case 'count+': x.count = Math.min(CFG.MAX_SALE_QTY, (Number(x.count) || 1) + 1); break;
    case 'count': var n = num(v); if (n !== null) x.count = Math.max(1, Math.min(CFG.MAX_SALE_QTY, n)); break;
    case 'sample': x.sample = !x.sample; break;
  }
  return x;
}
/**
 * The chip that is on, as its entry of opts (the offered rows, or the view's {key, label} copies of them), or null: none
 * while the plus chip is on; else the kept catKey's entry (an owner's relabel keeps the choice), else the chosen name's row
 * (itemCategoryOf: a renamed built-in's old name finds its row) when opts holds it. A retired or other-shop one has none
 * (B11), and Save then stores the catch-all. The view, a second tap and Save all decide with it.
 */
function appNewItemCatRow(ports, opts, values) {
  if (values.catAdd) return null;
  var k = listNormKey('item_category', values.catKey), i;
  for (i = 0; k && i < opts.length; i++) if (opts[i].key === k) return opts[i];
  var row = values.category ? itemCategoryOf(ports, values.category) : null;
  for (i = 0; row && i < opts.length; i++) if (opts[i].key === row.key) return opts[i];
  return null;
}
/** The category the form holds now: the typed name while the plus chip is on, else the chosen name ('' = none). */
function appNewItemCategory(values) {
  return values.catAdd ? String(values.catName || '').trim() : String(values.category || '');
}
function appNewItemProblems(phone, values) {
  var ports = phone.ports, staff = appFormStaff(phone), out = [];
  var tagIt = values.tag ? ports.store.getItem(values.tag) : null, shop = tagIt ? tagIt.shop : staff.shop;
  if (!values.tag) out.push({ code: 'tag', key: 'ui_tag_scan_new', vars: {}, field: 'tag' });
  else {
    var it = tagIt;
    if (!it || it.status !== CFG.STATUS.BLANK) out.push({ code: 'not_blank', key: 'tag_not_blank', vars: { id: values.tag }, field: 'tag' });
    else if (staff.role !== 'owner' && it.shop !== staff.shop) out.push({ code: 'other_shop', key: 'basket_other_shop', vars: { id: values.tag, shop: shopName(ports, it.shop) }, field: 'tag' });
  }
  // Round 6b: a typed category name (itemCategoryFind: empty, digits or an amount, the sample word, a name the owner closed).
  if (values.catAdd) {
    var f = itemCategoryFind(ports, values.catName, shop);
    if (!f.ok) {
      out.push({ code: 'cat', key: f.reason === 'unavailable' ? 'add_unavailable' : f.reason === 'sample' ? 'add_ic_sample' : f.reason === 'closed' ? 'add_ic_closed' : 'add_ask_ic',
        vars: f.reason === 'closed' ? { label: f.label } : {}, field: 'catname' });
    }
  }
  if (!values.pending && !(Number(values.price) >= 1)) out.push({ code: 'price', key: 'ask_price', vars: {}, field: 'price' });
  var c = Number(values.count);
  if (!(c >= 1 && c <= CFG.MAX_SALE_QTY && c === Math.round(c))) out.push({ code: 'count', key: 'bad_qty', vars: { max: myDigits(CFG.MAX_SALE_QTY) }, field: 'count' });
  return out;
}
function appNewItemView(phone, values) {
  var ports = phone.ports, staff = appFormStaff(phone), it = values.tag ? ports.store.getItem(values.tag) : null;
  var category = appNewItemCategory(values), shop = it ? it.shop : staff.shop;
  var margin = !values.pending ? itemMargin(values.price, values.cost) : null;
  // Round 6b (2.5): the shop's offered categories (the catch-all last); catKey = the chip that is on (appNewItemCatRow).
  var categories = itemCategoryOptions(ports, shop).map(function (r) { return { key: r.key, label: r.label }; });
  var onRow = appNewItemCatRow(ports, categories, values), catKey = onRow ? onRow.key : '';
  // The live hint under the typed name: an offered name is used (add_exists), the sample word and a closed name refused.
  var catHint = null;
  if (values.catAdd && String(values.catName || '').trim()) {
    var f = itemCategoryFind(ports, values.catName, shop);
    if (f.ok && f.existed) catHint = { key: 'add_exists', vars: { label: f.label } };
    else if (!f.ok && f.reason === 'sample') catHint = { key: 'add_ic_sample', vars: {} };
    else if (!f.ok && f.reason === 'closed') catHint = { key: 'add_ic_closed', vars: { label: f.label } };
  }
  return {
    tag: values.tag, item: it, category: category, catKey: catKey, catAdd: !!values.catAdd, catHint: catHint, categories: categories,
    presets: pricePresets(ports, category || null, shop), margin: margin, loss: !!margin && margin.profit < 0,
    skuHint: Number(values.count) > 1, nameLater: !!values.photo && !String(values.name || '').trim() && aiOn(ports),
    photo: values.photo ? phone.store.getMedia(values.photo) : null,
    problems: values.attempted ? appNewItemProblems(phone, values) : []
  };
}
/** A photo taken in the form: one media record (status file, no job yet); the form's earlier unsaved photo removed. */
function appNewItemPhoto(phone, values, rec) {
  var store = phone.store, x = appFormCopy(values), m;
  if (x.photo) { var old = store.getMedia(x.photo); if (old && old.status === 'file') store.removeMedia(x.photo); }
  if (rec && rec.sim) m = store.addMedia({ kind: 'photo', sim: rec.sim, mime: rec.sim.mimeType || 'image/jpeg', status: 'file', visual: rec.sim.visual || rec.visual || null });
  else m = store.addMedia({ kind: 'photo', blob: rec && rec.blob ? rec.blob : null, dataUrl: rec && rec.dataUrl ? rec.dataUrl : '', mime: (rec && rec.mime) || 'image/jpeg', status: 'file' });
  x.photo = m.id;
  return x;
}
/** The form closed without Save: its unsaved photo goes; the tag stays BLANK. */
function appNewItemAbandon(phone, values) {
  if (!values || !values.photo) return;
  var m = phone.store.getMedia(values.photo);
  if (m && m.status === 'file' && !m.itemId) phone.store.removeMedia(values.photo);
}
/**
 * Save the new piece (7.2): the tag re-read (not BLANK: refused not_blank and the tag cleared, every other value kept,
 * U13); commitNewItem; the photo's job queued (AI on: describePhoto's photo job, which waits for the item entry, M1; AI
 * off: a pic job, review r3 M-1); the owner pinged while the price is pending; item_created · id and the piece's card with
 * ↩️ first (M5) in the phone's chat; the draft dropped.
 */
function appNewItemSave(phone, F) {
  if (F.saving) return { ok: false, reason: 'busy' };
  var ports = phone.ports, store = phone.store, staff = appFormStaff(phone), uid = phone.staffId(), v = F.values;
  var probs = appNewItemProblems(phone, v);
  if (probs.length) {
    var x = appFormCopy(v);
    // not_blank (U13): the tag cleared, every other value kept; its text stays in .fmsg until the next change (F.forced).
    if (probs[0].code === 'not_blank') { appFormDraftDrop(store, 'newitem', x.tag); x.tag = ''; }
    else x.attempted = true;
    F.values = x;
    return { ok: false, reason: probs[0].code, problems: probs };
  }
  // Round 6b (2.5): the category. A typed name is added now (addItemCategory: an offered name gives its row's label and
  // writes nothing; a new one is a Lists row in this same commit, through the phone store's addListOption); else the
  // chosen chip's current label (its kept key's row, else its name's row, when the shop is offered it), or '' (commitNewItem
  // stores the catch-all). The row's key goes with it (commitNewItem prefers it to the name). A refusal writes nothing.
  var tagItem = ports.store.getItem(v.tag), shop = tagItem ? tagItem.shop : staff.shop, category = '', keyOut = '';
  if (v.catAdd) {
    var a = addItemCategory(ports, v.catName, staff, shop);
    if (!a.ok) {
      var z = appFormCopy(v);
      z.attempted = true;
      F.values = z;
      return { ok: false, reason: 'cat', problems: [{ code: 'cat', key: a.reason === 'unavailable' ? 'add_unavailable' : a.reason === 'sample' ? 'add_ic_sample' : a.reason === 'closed' ? 'add_ic_closed' : 'add_ask_ic',
        vars: a.reason === 'closed' ? { label: a.label } : {}, field: 'catname' }] };
    }
    category = a.label;
    keyOut = a.key || '';
  } else {
    var crow = appNewItemCatRow(ports, itemCategoryOptions(ports, shop), v);
    if (crow) { category = crow.label; keyOut = crow.key; }
  }
  var itemId = v.tag, mediaId = v.photo && store.getMedia(v.photo) ? v.photo : '', photoUrl = '';
  if (mediaId) photoUrl = ports.chat.savePhoto(mediaId, itemId);
  var r = commitNewItem(ports, { itemId: itemId, name: String(v.name || '').trim(), category: category, categoryKey: keyOut, price: v.pending ? '' : Number(v.price),
    cost: nullish(v.cost) ? '' : Number(v.cost), count: Number(v.count) || 1, sample: !!v.sample, photoUrl: photoUrl, photoFileId: mediaId,
    staff: staff, source: CFG.SOURCE.PHOTO, updateId: store.nextUpdateId() });
  if (!r.ok) {
    var y = appFormCopy(v);
    y.attempted = true;
    if (r.reason === 'not_blank' || r.reason === 'missing') { appFormDraftDrop(store, 'newitem', y.tag); y.tag = ''; }
    F.values = y;
    var key = r.reason === 'other_shop' ? 'basket_other_shop' : r.reason === 'count' ? 'bad_qty' : r.reason === 'price' ? 'ask_price' : r.reason === 'cost' ? 'item_ask_cost' : 'tag_not_blank';
    return { ok: false, reason: r.reason === 'missing' ? 'not_blank' : r.reason, problems: [{ code: r.reason, key: key, vars: { id: itemId, shop: '', max: myDigits(CFG.MAX_SALE_QTY) }, field: r.reason === 'count' ? 'count' : r.reason === 'price' ? 'price' : 'tag' }] };
  }
  F.saving = true;
  if (mediaId) {
    // The AI is given the piece's shop's current list (round 6b, 2.8 row 8); the server and the replay decide against it.
    if (aiOn(ports)) { try { ports.ai.describePhoto(store.getMedia(mediaId), { categories: itemCategoryAi(ports, r.item.shop).names }); } catch (ignore) {} }
    else phone.queuePic(mediaId, itemId);
  }
  if (r.pending) notifyOwners(ports, t(ports, 'price_ask_owner', { id: itemId, name: r.item.name }), priceButtons(ports, r.item));
  clearState(ports, uid);
  setLastItem(ports, uid, itemId);
  ports.chat.sendMessage(uid, t(ports, 'item_created') + ' · ' + itemId);
  sendItemCard(uid, r.item, staff, ports, { undo: r.groupId });
  appFormDraftDrop(store, 'newitem', itemId);
  return { ok: true, item: r.item, groupId: r.groupId };
}

/* ---------- the restock form (1.6) ---------- */
function appRestockFresh() { return { lines: [], find: '', older: [], restored: false, opener: '' }; }
function appRestockShop(phone, values) {
  var ports = phone.ports, staff = appFormStaff(phone), l = (values.lines || [])[0], it = l ? ports.store.getItem(l.id) : null;
  return it ? it.shop : (staff.role === 'owner' ? (staff.shop || CFG.SHOP_IDS[0]) : staff.shop);
}
function appRestockInit(phone, req) {
  req = req || {};
  return appFormInitLines(phone, 'restock', req, appRestockFresh(), function (v, id) { return appRestockAdd(phone, v, id); });
}
/** A stock item into the restock form (count 1). An id already a line changes nothing (ui_form_twice). */
function appRestockAdd(phone, values, itemId) {
  var ports = phone.ports, lines = values.lines || [], id = String(itemId || '');
  for (var i = 0; i < lines.length; i++) if (lines[i].id === id) return { ok: false, twice: true, reason: 'twice', text: t(ports, 'ui_form_twice', { id: id }) };
  var r = basketAddItem(ports, appFormStaff(phone), lines, id, 1, { restock: true });
  if (!r.ok) return { ok: false, reason: r.reason, text: t(ports, r.reason === 'max' ? 'restock_max' : (BASKET_REASON_KEY[r.reason] || 'expired'), r.vars) };
  var v = appFormCopy(values);
  v.lines = r.lines.map(function (l) { return { id: l.id, qty: Number(l.qty) || 1 }; });
  return { ok: true, values: v, index: r.index };
}
function appRestockSet(phone, values, f, v) {
  var x = appFormCopy(values), parts = String(f).split(':'), name = parts[0], arg = parts[1];
  var line = arg ? appSaleLine(x, arg) : null, num = function (n) { var q = Math.round(Number(n)); return isFinite(q) ? q : null; };
  delete x.notice;
  switch (name) {
    case 'qty+': if (line) line.qty = Math.min(CFG.MAX_SALE_QTY, (Number(line.qty) || 1) + 1); break;
    case 'qty-': if (line) line.qty = Math.max(1, (Number(line.qty) || 1) - 1); break;
    case 'qty': var q = num(v); if (line && q !== null) line.qty = Math.max(1, Math.min(CFG.MAX_SALE_QTY, q)); break;
    case 'qtyset': var s = num(parts[2]); if (line && s !== null && s >= 1) line.qty = Math.min(CFG.MAX_SALE_QTY, s); break;
    case 'remove': x.lines = (x.lines || []).filter(function (l) { return l.id !== arg; }); break;
    case 'find': x.find = String(v === undefined || v === null ? '' : v); break;
    case 'found': case 'recent':
      var r = appRestockAdd(phone, x, arg);
      if (r.ok) x = r.values; else x.notice = r.text;
      break;
    case 'restored':
      if (arg === 'clear') { x.lines = appFormOpenerLines(x); x.older = []; x.restored = false; }
      else if (arg === 'merge') { x.lines = appFormMergeLines(x.older, x.lines).slice(0, CFG.BASKET_MAX_LINES); x.older = []; }
      break;
  }
  return x;
}
function appRestockView(phone, values) {
  var ports = phone.ports, shop = appRestockShop(phone, values), inForm = {};
  (values.lines || []).forEach(function (l) { inForm[l.id] = true; });
  var lines = (values.lines || []).map(function (l) {
    var it = ports.store.getItem(l.id) || { id: l.id, name: l.id, stock: 0 };
    return { id: l.id, name: it.name, qty: Number(l.qty) || 1, stock: Number(it.stock) || 0, after: (Number(it.stock) || 0) + (Number(l.qty) || 1) };
  });
  var tiles = recentItems(ports, shop, 20).filter(function (it) { return it.shop === shop && it.type !== CFG.ITEM_TYPE.UNIQUE && !inForm[it.id]; }).slice(0, 2);
  var qty = 0;
  lines.forEach(function (l) { qty += l.qty; });
  return { shop: shop, lines: lines, qty: qty, presets: CFG.RESTOCK_PRESETS.slice(), recent: tiles,
    found: values.find && values.foundFor === values.find ? (values.found || []) : null, older: (values.older || []).length, restored: !!values.restored,
    problems: values.attempted && !lines.length ? [{ code: 'empty', key: 'scan_first', vars: {}, field: '' }] : [] };
}
/** Save the restock (1.6): ONE group, one RESTOCK row per line, one undo; the reply with its group view. */
function appRestockSave(phone, F) {
  if (F.saving) return { ok: false, reason: 'busy' };
  var ports = phone.ports, store = phone.store, staff = appFormStaff(phone), uid = phone.staffId(), v = F.values;
  var refuse = function (code, key, vars, field) { var x = appFormCopy(v); x.attempted = true; F.values = x; return { ok: false, reason: code, problems: [{ code: code, key: key, vars: vars || {}, field: field || '' }] }; };
  if (!(v.lines || []).length) return refuse('empty', 'scan_first');
  var lines = v.lines.map(function (l) { return { item: ports.store.getItem(l.id) || { id: l.id, shop: '', type: '', status: CFG.STATUS.BLANK }, qty: Number(l.qty) || 1 }; });
  var r = commitRestockGroup(ports, { lines: lines, note: '', staff: staff, source: CFG.SOURCE.BUTTON, updateId: store.nextUpdateId() });
  if (!r.ok) {
    var keys = { empty: 'scan_first', max: 'restock_max', qty: 'bad_qty', unique: 'basket_unique', blank: 'basket_blank', other_shop: 'basket_other_shop' };
    return refuse(r.reason, keys[r.reason] || 'expired', { id: v.lines[0].id, shop: shopName(ports, appRestockShop(phone, v)), max: myDigits(r.reason === 'max' ? CFG.BASKET_MAX_LINES : CFG.MAX_SALE_QTY) });
  }
  F.saving = true;
  var text, n = 0;
  if (v.lines.length === 1) {
    var it = ports.store.getItem(v.lines[0].id);
    text = it.id + ' · ' + t(ports, 'restock_done', { qty: fmtCount(v.lines[0].qty), stock: fmtCount(it.stock) });
  } else {
    v.lines.forEach(function (l) { n += Number(l.qty) || 0; });
    text = [t(ports, 'restock_group_done', { n: fmtCount(v.lines.length), qty: fmtCount(n) })].concat(v.lines.map(function (l) {
      var it2 = ports.store.getItem(l.id);
      return t(ports, 'group_item_line', { id: it2.id, name: it2.name, stock: fmtCount(it2.stock) });
    })).join('\n');
  }
  clearState(ports, uid);
  setLastItem(ports, uid, v.lines[0].id);
  setLastGroup(ports, uid, r.groupId);
  ports.chat.sendMessage(uid, text, undoRow(ports, r.groupId), { view: { kind: 'group', id: r.groupId } });
  appFormDraftDrop(store, 'restock', uid);
  return { ok: true, groupId: r.groupId };
}

/* ---------- the expense form (1.7) ---------- */
function appExpenseInit(phone, req) {
  var staff = appFormStaff(phone), d = appFormDraftRead(phone.store, 'expense', phone.staffId());
  var values = { shop: staff.role === 'owner' ? (staff.shop || CFG.SHOP_IDS[0]) : staff.shop, cat: '', catAdd: false, catName: '', amount: null,
    method: CFG.METHOD.CASH, note: '', restored: false };
  if (d) { for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) values[k] = d[k]; values.restored = true; }
  if (staff.role !== 'owner') values.shop = staff.shop;
  return values;
}
function appExpenseSet(phone, values, f, v) {
  var x = appFormCopy(values), parts = String(f).split(':'), name = parts[0], arg = parts.slice(1).join(':'), staff = appFormStaff(phone);
  delete x.notice;
  switch (name) {
    case 'shop': if (staff.role === 'owner' && CFG.SHOP_IDS.indexOf(arg) >= 0) { x.shop = arg; x.method = CFG.METHOD.CASH; } break;
    case 'cat': if (arg === 'add') { x.catAdd = true; x.cat = ''; } else { x.cat = String(arg).toLowerCase(); x.catAdd = false; } break;
    case 'catname': x.catName = String(v || ''); break;
    case 'amount':
      var a = arg ? Number(arg) : Math.round(Number(v));
      if (isFinite(a) && a >= 0) x.amount = a;
      break;
    case 'pay': x.method = String(arg || CFG.METHOD.CASH).toUpperCase(); break;
    case 'note': x.note = String(v || '').slice(0, 100); break;
    case 'restored': if (arg === 'clear') { var s = x.shop; x = appExpenseInit(phone, {}); x.shop = s; x.cat = ''; x.amount = null; x.note = ''; x.method = CFG.METHOD.CASH; x.catAdd = false; x.catName = ''; x.restored = false; } break;
  }
  return x;
}
function appExpenseCatLabel(phone, values) {
  if (values.catAdd) return String(values.catName || '').trim();
  return values.cat ? categoryLabel(phone.ports, values.cat) : '';
}
function appExpenseProblems(phone, values) {
  var ports = phone.ports, out = [];
  if (values.catAdd) {
    var lf = listFindByLabel(ports, 'expense_category', values.catName);
    if (!lf.ok) out.push({ code: 'cat', key: lf.reason === 'unavailable' ? 'add_unavailable' : 'add_ask_ec', vars: {}, field: 'catname' });
  } else if (!values.cat) out.push({ code: 'cat', key: 'exp_ask_cat', vars: {}, field: 'cat' });
  if (!(Number(values.amount) >= 1)) out.push({ code: 'amount', key: 'ask_number', vars: {}, field: 'amount' });
  if (payMethods(ports, values.shop).indexOf(String(values.method || '').toUpperCase()) < 0) out.push({ code: 'method', key: 'basket_method_gone', vars: {}, field: 'pay' });
  return out;
}
function appExpenseView(phone, values) {
  var ports = phone.ports, staff = appFormStaff(phone);
  return { owner: staff.role === 'owner', shops: CFG.SHOP_IDS.slice(), shop: values.shop, categories: expenseCategories(ports, values.shop),
    catLabel: appExpenseCatLabel(phone, values), presets: values.cat ? expensePresets(ports, values.cat) : expensePresets(ports, 'other'),
    methods: payMethods(ports, values.shop), problems: values.attempted ? appExpenseProblems(phone, values) : [] };
}
/** Save the expense (1.7): a typed category made at Save (same commit), commitExpense with the note, the reply with undo. */
function appExpenseSave(phone, F) {
  if (F.saving) return { ok: false, reason: 'busy' };
  var ports = phone.ports, store = phone.store, staff = appFormStaff(phone), uid = phone.staffId(), v = F.values;
  var probs = appExpenseProblems(phone, v);
  if (probs.length) {
    var x = appFormCopy(v);
    x.attempted = true;
    if (probs[0].code === 'method') x.method = CFG.METHOD.CASH;
    F.values = x;
    return { ok: false, reason: probs[0].code, problems: probs };
  }
  var cat = v.cat;
  if (v.catAdd) {
    var a = addListOptionByLabel(ports, 'expense_category', v.catName, staff);
    if (!a.ok) { var y = appFormCopy(v); y.attempted = true; F.values = y; return { ok: false, reason: 'cat', problems: [{ code: 'cat', key: a.reason === 'unavailable' ? 'add_unavailable' : 'add_ask_ec', vars: {}, field: 'catname' }] }; }
    cat = a.key;
  }
  var amount = Math.round(Number(v.amount)), note = String(v.note || '').trim().slice(0, 100), method = String(v.method || CFG.METHOD.CASH).toUpperCase();
  var r = commitExpense(ports, { shop: v.shop, category: cat, amount: amount, method: method, note: note, staff: staff, source: CFG.SOURCE.BUTTON, updateId: store.nextUpdateId() });
  F.saving = true;
  clearState(ports, uid);
  setLastGroup(ports, uid, r.groupId);
  ports.chat.sendMessage(uid, t(ports, 'expense_done', { amount: fmtMoney(amount), cat: categoryLabel(ports, cat), note: note ? ' · ' + note : '', method: methodLabel(ports, method) }),
    undoRow(ports, r.groupId), { view: { kind: 'group', id: r.groupId } });
  appFormDraftDrop(store, 'expense', uid);
  return { ok: true, groupId: r.groupId };
}

/** The save made durable, then a sync soon. Resolves to true when written (the appMeasCommit shape). */
function appFormCommit(phone, sync, kind) {
  return phone.commit(kind).then(function (ok) { if (ok && sync) sync.scheduleSync(); return ok; });
}

/* ============================== the kinds ============================== */
var APP_FORM_KINDS = {
  sale: { init: appSaleInit, set: appSaleSet, view: appSaleView, save: appSaleSave, render: function (F, body) { appSaleRender(F, body); }, title: 'ui_home_sell', scan: true, lines: true },
  newitem: { init: appNewItemInit, set: appNewItemSet, view: appNewItemView, save: appNewItemSave, render: function (F, body) { appNewItemRender(F, body); }, title: 'ui_home_new', scan: true,
    // Round 6b (review m12): the plus chip turned on focuses the name field once after the repaint (the keyboard opens),
    // then scrolls it to the middle: on first open the field sits under the fixed Save bar, where focus alone leaves it.
    click: function (F, f) {
      if (f !== 'cat:add') return false;
      appFormDo(F, f, undefined);
      if (F.values.catAdd && F.el && F.el.querySelector) {
        try {
          var inp = F.el.querySelector('[data-f="catname"]');
          if (inp && inp.focus) inp.focus({ preventScroll: true });
          if (inp && inp.scrollIntoView) inp.scrollIntoView({ block: 'center' });
        } catch (ignore) {}
      }
      return true;
    } },
  restock: { init: appRestockInit, set: appRestockSet, view: appRestockView, save: appRestockSave, render: function (F, body) { appRestockRender(F, body); }, title: 'btn_restock', scan: true, lines: true },
  expense: { init: appExpenseInit, set: appExpenseSet, view: appExpenseView, save: appExpenseSave, render: function (F, body) { appExpenseRender(F, body); }, title: 'btn_expense' }
};
var APP_FORM_ELEMENT_ID = { sale: 'saleForm', newitem: 'newForm', restock: 'restockForm', expense: 'expenseForm', buyer: 'buyerForm', shop: 'shopForm' };

/** Does this form own the camera now (the sale and restock forms, a new-piece form still without its tag)? */
function appFormWantsScan(F) {
  var K = APP_FORM_KINDS[F.kind];
  return !!K && !!K.scan && (F.kind !== 'newitem' || !F.values.tag);
}
/** The draft key of a form: the staff id (sale, restock, expense), the tag (new piece); none for the buyer and shop forms. */
function appFormKey(F) {
  if (F.kind === 'newitem') return F.values.tag || '';
  if (F.kind === 'sale' || F.kind === 'restock' || F.kind === 'expense') return APP.phone.staffId();
  return '';
}

/** For the simulator (8.2): what the open form holds, or null. error is the first problem's KEY. */
function appFormSnap() {
  var F = APP && APP.form;
  if (!F) return null;
  var v = F.values || {}, K = APP_FORM_KINDS[F.kind], view = null;
  try { view = K && K.view ? K.view(APP.phone, v) : null; } catch (ignore) { view = null; }
  var probs = F.problems || [];
  var b = F.kind === 'sale' ? appSaleBuyer(v) : null, c = b && b.customerId ? APP.phone.ports.store.getCustomer(b.customerId) : null;
  return {
    kind: F.kind, itemId: (F.req && F.req.itemId) || v.tag || '', lines: (v.lines || []).map(function (l) { return { id: l.id, qty: l.qty, price: nullish(l.unitPrice) ? null : l.unitPrice }; }),
    buyer: b ? { id: b.customerId, name: c ? c.name : b.newName, phone: c ? c.phone : b.newPhone } : null,
    pay: v.payMode === 'mix' ? 'mix' : (v.method || ''), acct: v.payMode ? v.method : '', transfer: nullish(v.bankPart) ? null : v.bankPart, part: !!v.part,
    amount: nullish(v.paid) ? null : v.paid, due: nullish(v.dueDay) ? null : v.dueDay, total: view && view.total !== undefined ? view.total : null,
    error: probs.length ? probs[0].key : '', saved: !!F.saving, name: v.name || v.newName || '', category: F.kind === 'newitem' ? appNewItemCategory(v) : '', catAdd: F.kind === 'newitem' ? !!v.catAdd : false,
    cost: nullish(v.cost) ? null : v.cost, price: F.kind === 'newitem' ? (nullish(v.price) ? null : v.price) : null, pending: !!v.pending,
    count: v.count || null, sample: !!v.sample, photo: v.photo || '', shop: v.shop || (view && view.shop) || '', cat: v.cat === undefined ? '' : v.cat,
    note: v.note || '', older: (v.older || []).length, last: { f: F.last.f, n: F.last.n }
  };
}

/* ============================== the DOM part ============================== */

function appFormHot(name) { var h = APP && APP.win ? APP.win.SIM_HOT : undefined; return typeof h === 'string' && h === 'f:' + name; }
function appFormBad(F, name) {
  var probs = F.problems || [];
  return !!probs.length && probs[0].field === name;
}
/**
 * A button of a form: data-f, the hot class, .on, .fbad / .fneed, an optional leading glyph or an icon only. o.role sets
 * role and o.checked (when given) aria-checked 'true' / 'false' (round 6b: the sample switch); without them the markup is
 * as before.
 */
function appFormBtn(F, f, text, o) {
  o = o || {};
  var cls = [o.cls || '', o.on ? 'on' : '', appFormHot(f) ? 'hot' : '', o.need ? 'fneed' : '', appFormBad(F, f) ? 'fbad' : ''].join(' ').replace(/\s+/g, ' ').replace(/^ | $/g, '');
  var a = { type: 'button', 'data-f': f, class: cls, 'aria-label': o.aria || null, disabled: o.disabled ? 'disabled' : null };
  if (o.role) a.role = o.role;
  if (o.checked !== undefined) a['aria-checked'] = o.checked ? 'true' : 'false';
  a.onclick = function () { appFormClick(F, f); };
  var b;
  if (o.iconOnly) { a.html = appIconSvg(o.iconOnly); a.class = (cls + ' iconbtn').replace(/^ /, ''); b = appH('button', a); }
  else { a.text = text; b = o.icon ? appHi('button', a, o.icon) : appH('button', a); }
  return b;
}
/** A text input of a form: writes values on input, redraws only its dependent regions (U5), never during an IME composition. */
function appFormInput(F, f, value, attrs, regions) {
  attrs = attrs || {};
  var tag = attrs.tag || 'input', a = { type: 'text', 'data-f': f, autocomplete: 'off' };
  for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && k !== 'tag' && k !== 'class') a[k] = attrs[k];
  if (tag === 'textarea') delete a.type;
  a['class'] = [attrs['class'] || '', appFormHot(f) ? 'hot' : '', appFormBad(F, f) ? 'fbad' : ''].join(' ').replace(/\s+/g, ' ').replace(/^ | $/g, '');
  var el = appH(tag, a);
  el.value = value === null || value === undefined ? '' : String(value);
  var run = function () {
    if (F.composing || APP.form !== F || f === 'tag') return;
    F.values = APP_FORM_KINDS[F.kind].set(APP.phone, F.values, f, el.value);
    F.dirty = true;
    F.last = { f: f, n: F.last.n + 1 };
    (regions || []).forEach(function (r) { appFormRegion(F, r); });
    appFormRegion(F, 'bar');
    appFormChanged(F);
  };
  el.addEventListener('input', run);
  el.addEventListener('compositionstart', function () { F.composing = true; });
  el.addEventListener('compositionend', function () { F.composing = false; run(); });
  el.addEventListener('blur', function () { if (F.stale && APP.form === F) { F.stale = false; appFormRepaint(F); } });
  el.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || tag === 'textarea') return;
    if (e.preventDefault) e.preventDefault();
    if (f === 'find') appFormClick(F, 'find:go');
    else if (f === 'tag') { var id = appParseTagLink(el.value); el.value = ''; if (id) appFormTag(F, id); else appToast(APP.tt('tag_not_found', { id: '' }), true); }
    else if (el.blur) el.blur();
  });
  return el;
}
/** A number field: looks like an input, opens the 64 px keypad EMPTY, titled '{label} · {current}' (1.0, U4). */
function appFormNum(F, f, label, current, o) {
  o = o || {};
  var shown = nullish(current) || current === '' ? (o.placeholder || '') : (o.fmt ? o.fmt(current) : fmtMoney(current));
  return appFormBtn(F, f, shown, { cls: 'fnum' + (nullish(current) ? ' empty' : ''), need: o.need, aria: label });
}
/** The keypad of a .fnum control (null for another name). */
function appFormNumSpec(F, f) {
  var tt = APP.tt, v = F.values, parts = String(f).split(':'), name = parts[0], arg = parts[1];
  if (F.kind === 'sale') {
    var view = appSaleView(APP.phone, v), line = null;
    view.lines.forEach(function (l) { if (l.id === arg) line = l; });
    if (name === 'price' && line) return { title: line.pending ? tt('ask_sale_price') : tt('btn_discount') + ' · ' + fmtMoney(line.unitPrice) };
    if (name === 'qty' && line) return { title: tt('ui_keypad_qty') + ' · ' + fmtCount(line.qty), max: CFG.MAX_SALE_QTY };
    if (name === 'transfer' && !arg) return { title: tt('ui_transfer_part', { method: methodLabel(APP.phone.ports, v.method) }) + (nullish(v.bankPart) ? '' : ' · ' + fmtMoney(v.bankPart)), max: view.paidNow };
    if (name === 'amount' && !arg) return { title: tt('btn_paid_now') + (nullish(v.paid) ? '' : ' · ' + fmtMoney(v.paid)), max: view.total };
  }
  if (F.kind === 'newitem') {
    if (f === 'cost') return { title: tt('btn_item_cost') + (nullish(v.cost) ? '' : ' · ' + fmtMoney(v.cost)) };
    if (f === 'price') return { title: tt('btn_item_price') + (nullish(v.price) ? '' : ' · ' + fmtMoney(v.price)) };
    if (f === 'count') return { title: tt('ui_keypad_qty') + ' · ' + fmtCount(v.count), max: CFG.MAX_SALE_QTY };
  }
  if (F.kind === 'restock' && name === 'qty' && arg) {
    var l2 = appSaleLine(v, arg);
    return l2 ? { title: tt('ui_keypad_qty') + ' · ' + fmtCount(l2.qty), max: CFG.MAX_SALE_QTY } : null;
  }
  if (F.kind === 'expense' && f === 'amount') return { title: tt('exp_ask_amount', { cat: appExpenseCatLabel(APP.phone, v) }) + (nullish(v.amount) ? '' : ' · ' + fmtMoney(v.amount)) };
  return null;
}

/** 'openform' (app_ports.js ui.openForm): opened after the core's run (setTimeout 0), as the measurement form is. */
function appOnOpenForm(evt) {
  if (!APP || !APP.doc || !evt || !APP_FORM_KINDS[evt.kind]) return;
  var req = evt.req || {}, F = APP.form;
  // U23: a second tap on the card's sell button that lands while (or before) the sale form opens never adds +1 or +3.
  if (F && F.kind === 'sale' && evt.kind === 'sale') {
    if (req.itemId && !appSaleLine(F.values, String(req.itemId))) appFormTag(F, String(req.itemId));
    return;
  }
  if (APP.formPending) {
    var p = APP.formPending;
    if (p.kind === 'sale' && evt.kind === 'sale' && req.itemId) p.more.push(String(req.itemId));
    return;
  }
  APP.formPending = { kind: evt.kind, req: req, more: [] };
  var open = function () {
    var pend = APP.formPending;
    APP.formPending = null;
    if (!pend) return;
    var G = appOpenForm(pend.kind, pend.req);
    if (G && G.kind === 'sale') pend.more.forEach(function (id) { if (!appSaleLine(G.values, id)) appFormTag(G, id); });
  };
  if (APP.win && APP.win.setTimeout) APP.win.setTimeout(open, 0); else open();
}

/**
 * Open a form (7.3): another form and #measForm closed, the overlay closed, the home scanner stopped, the core's state
 * cleared; the kind's init (a sale opened with a piece writes its draft at once); the page mounted; a form layer pushed
 * (13.4); the strip's camera started when the pref cameraOk is set; req.focus === 'price' opens the line's price keypad.
 */
function appOpenForm(kind, req) {
  var K = APP_FORM_KINDS[kind];
  if (!APP || !K) return null;
  req = req || {};
  var replace = false;
  if (APP.form) { appCloseForm({ keep: true, pop: true, reset: true }); replace = true; }
  if (APP.measForm) appCloseMeasForm({});
  appCloseOverlay();
  appStopScanner();
  var uid = APP.phone.staffId();
  if (uid) clearState(APP.phone.ports, uid);
  var values = K.init(APP.phone, req);
  var F = { kind: kind, req: req, values: values, dirty: !!values.restored, saving: false, scan: false, el: null, timer: null, stripEl: null,
    stripHost: null, body: null, bar: null, title: null, regions: {}, stale: false, composing: false, last: { f: '', n: 0 }, openedAt: Date.now(),
    problems: [], forced: null, msg: '', flash: '', draftKey: '' };
  APP.form = F;
  F.draftKey = appFormKey(F);
  // A sale form opened with a scanned piece holds a line before any change: its draft is written at once, so a basket
  // left untouched through the line's name (the draft kept) comes back under the sell button with ui_form_restored (10.7).
  if (kind === 'sale' && req.itemId && (values.lines || []).length) appFormDraftWrite(APP.store, kind, F.draftKey, values);
  appFormMount(F);
  var top = appNavTop();
  if (replace && top && top.kind === 'form') appNavReplace({ kind: 'form', form: kind });
  else appNavPush({ kind: 'form', form: kind });
  if (appFormWantsScan(F) && APP.store.getPref('cameraOk')) appFormScanStart(F);
  if (values.notice) { appToast(values.notice, true); delete values.notice; }
  if (req.focus === 'price' && kind === 'sale' && req.itemId && appSaleLine(values, String(req.itemId))) appFormClick(F, 'price:' + req.itemId);
  return F;
}

/** The page (7.3): the whole div#<kind>Form.formpage[role=dialog] built with createElement only (the Node checks' fake document renders it). */
function appFormRender(F) {
  var tt = APP.tt;
  var page = appH('div', { id: APP_FORM_ELEMENT_ID[F.kind] || (F.kind + 'Form'), class: 'formpage', role: 'dialog', 'aria-modal': 'true' });
  var col = appH('div', { class: 'fcol' });
  var back = appH('button', { type: 'button', class: 'iconbtn back' + (appFormHot('close') ? ' hot' : ''), 'data-f': 'close', 'aria-label': tt('ui_aria_back'), html: appIconSvg('arrow-left'),
    onclick: function () { appFormClick(F, 'close'); } });
  F.title = appH('h2', { text: appFormTitle(F) });
  col.appendChild(appH('div', { class: 'fhead' }, [back, F.title]));
  F.stripHost = appH('div', { class: 'fstriphost' });
  col.appendChild(F.stripHost);
  F.body = appH('div', { class: 'fbody' });
  col.appendChild(F.body);
  page.appendChild(col);
  F.bar = appH('div', { class: 'fbar' });
  page.appendChild(F.bar);
  F.el = page;
  appFormRepaint(F);
  return page;
}
/** The page mounted once on document.body (the only line that touches document.body). */
function appFormMount(F) {
  var page = appFormRender(F);
  APP.doc.body.appendChild(page);
  return page;
}
function appFormTitle(F) {
  var tt = APP.tt;
  if (F.kind === 'newitem' && F.values.tag) return tt('ui_new_title', { id: F.values.tag });
  if (F.kind === 'buyer') return tt(F.values.selfId ? 'ui_buyer_edit_title' : 'ui_buyer_new_title');
  if (F.kind === 'shop') return tt('ui_shop_title', { shop: shopName(APP.phone.ports, F.values.id), id: F.values.id });
  var K = APP_FORM_KINDS[F.kind];
  return tt(K && K.title ? K.title : 'ui_home_sell');
}

/** Every section between the strip and the bar redrawn (the strip node and the video are never rebuilt, U5). */
function appFormRepaint(F) {
  if (!F || !F.body) return;
  var K = APP_FORM_KINDS[F.kind], focused = null;
  try { var act = APP.doc.activeElement; focused = act && act.getAttribute ? act.getAttribute('data-f') : null; } catch (ignore) {}
  F.problems = [];
  try { var view = K.view(APP.phone, F.values); F.problems = view.problems && view.problems.length ? view.problems : (F.forced || []); } catch (ignore) {}
  if (F.title) F.title.textContent = appFormTitle(F);
  appFormStripPlace(F);
  appClear(F.body);
  F.regions = {};
  K.render(F, F.body);
  F.flash = '';
  appFormRegion(F, 'bar');
  if (focused && F.el && F.el.querySelector) {
    var again = F.el.querySelector('[data-f="' + focused + '"]');
    if (again && again.tagName !== 'BUTTON' && again.focus) { try { again.focus(); } catch (ignore) {} }
  }
}
/** A region drawn again without touching the inputs (U5): its container is kept, its children replaced. */
function appFormRegion(F, name) {
  if (!F) return;
  if (name === 'bar') return appFormBar(F);
  var r = F.regions[name];
  if (!r) return;
  appClear(r.el);
  r.draw(r.el);
}
/** Register a region and draw it once. */
function appFormRegionNode(F, name, cls, draw) {
  var el = appH('div', { class: cls || '' });
  F.regions[name] = { el: el, draw: draw };
  draw(el);
  return el;
}

/** The fixed bar: the sale's label/value cells (UX-M8), .fmsg and ONE green Save; the form pads by its height (1.0). */
function appFormBar(F) {
  if (!F.bar) return;
  var tt = APP.tt, K = APP_FORM_KINDS[F.kind];
  var view = null;
  try { view = K.view(APP.phone, F.values); F.problems = view.problems && view.problems.length ? view.problems : (F.forced || []); } catch (ignore) {}
  appClear(F.bar);
  var inner = appH('div', { class: 'fbar-in' });
  if (F.kind === 'sale' && view) {
    var cells = [appH('div', { class: 'fsum' }, [appH('span', { class: 'k', text: tt('ui_lbl_total') }), appH('span', { class: 'v num', text: fmtMoney(view.total) })])];
    if (F.values.part) {
      cells.push(appH('div', { class: 'fsum' }, [appH('span', { class: 'k', text: tt('ui_lbl_paid') }), appH('span', { class: 'v num', text: fmtMoney(view.needAmount ? 0 : view.paidNow) })]));
      cells.push(appH('div', { class: 'fsum owed' }, [appH('span', { class: 'k', text: tt('ui_lbl_owed') }), appH('span', { class: 'v num', text: fmtMoney(view.needAmount ? view.total : view.owed) })]));
    }
    inner.appendChild(appH('div', { class: 'fsums' }, cells));
  }
  var msg = F.msg || (F.problems.length ? appPlain(t(APP.phone.ports, F.problems[0].key, F.problems[0].vars)) : '');
  inner.appendChild(appH('div', { class: 'fmsg', hidden: msg ? null : 'hidden', text: msg }));
  var empty = F.kind === 'sale' && view && !view.lines.length;
  inner.appendChild(appH('button', { type: 'button', class: 'good' + (appFormHot('save') ? ' hot' : ''), 'data-f': 'save', disabled: F.saving || empty ? 'disabled' : null,
    text: F.saving ? tt('ui_form_saving') : tt('ui_w_save'), onclick: function () { appFormClick(F, 'save'); } }));
  F.bar.appendChild(inner);
  try { if (F.el && F.el.style && F.el.style.setProperty && F.bar.offsetHeight) F.el.style.setProperty('--fbar-h', F.bar.offsetHeight + 'px'); } catch (ignore) {}
}

/* ---------- the camera strip (U1) ---------- */
function appFormStrip(F) {
  if (F.stripEl) return F.stripEl;
  if (!APP.videoEl) {
    APP.videoEl = appH('video', { playsinline: 'true', muted: 'true', autoplay: 'true' });
    APP.videoEl.muted = true;
  }
  F.stripEl = appH('div', { class: 'scan scanstrip' });
  F.stripEl.appendChild(APP.videoEl);
  appFormStripState(F);
  return F.stripEl;
}
/** The strip shown while the form owns the camera; the scan helpers (keypad, typed id) under it. */
function appFormStripPlace(F) {
  if (!F.stripHost) return;
  var want = appFormWantsScan(F);
  // Placed already: a repaint never takes the strip (and its video) out of the page (U5; checker's fix of step 3).
  if (want && F.stripEl && F.stripHost.firstChild === F.stripEl) return;
  appClear(F.stripHost);
  if (!want) return;
  F.stripHost.appendChild(appFormStrip(F));
  if (F.kind === 'newitem') F.stripHost.appendChild(appH('div', { class: 'muted small center', text: APP.tt('ui_tag_scan_new') }));
}
/** The strip's non-video children from the scanner's state, with appScannerPanel's labels and iOS replay rule. */
function appFormStripState(F) {
  if (!F || !F.stripEl) return;
  var tt = APP.tt, box = F.stripEl, kids = [];
  for (var i = 0; i < box.children.length; i++) if (box.children[i] !== APP.videoEl) kids.push(box.children[i]);
  kids.forEach(function (c) { box.removeChild(c); });
  if (APP.scanState === 'running' && F.scan) {
    box.appendChild(appH('div', { class: 'guide' }));
    var tools = appH('div', { class: 'tools' });
    if (APP.scanner && APP.scanner.hasTorch) tools.appendChild(appH('button', { type: 'button', class: 'iconbtn', 'aria-label': tt('ui_torch'), html: appIconSvg('bulb'), onclick: function () { APP.scanner.toggleTorch(); } }));
    tools.appendChild(appH('button', { type: 'button', class: 'iconbtn', 'aria-label': tt('ui_btn_close'), html: appIconSvg('x'), onclick: function () { appFormScanStop(F); } }));
    box.appendChild(tools);
    if (APP.videoEl && APP.videoEl.paused && APP.videoEl.srcObject) { try { APP.videoEl.play(); } catch (ignore) {} }
  } else {
    var label = APP.scanState === 'starting' ? tt('ui_scan_starting')
      : APP.scanError === 'denied' ? tt('ui_camera_denied') : APP.scanError === 'none' ? tt('ui_camera_none') : APP.scanError === 'error' ? tt('ui_camera_error') : tt('ui_w_scan');
    var start = appH('div', { class: 'start' });
    start.appendChild(appHi('button', { type: 'button', class: 'primary' + (appFormHot('scan') ? ' hot' : ''), 'data-f': 'scan', text: label, disabled: APP.scanState === 'starting' ? 'disabled' : null,
      onclick: function () { appFormScanStart(F); } }, APP.scanState === 'starting' || APP.scanError ? null : 'scan'));
    var note = appScanNote();   // what to answer the phone's camera question, or where a refused permission is put back
    if (note) start.appendChild(appH('div', { class: 'note', text: note }));
    box.appendChild(start);
  }
}
function appFormScanStart(F) {
  if (!F || APP.form !== F) return;
  F.scan = true;
  appStartScanner();
  if (APP.scanner) APP.scanner.holdMs = APP_FORM_SAME_TAG_MS;
  appFormStripState(F);
}
function appFormScanStop(F) {
  if (F) F.scan = false;
  if (APP.scanner) APP.scanner.holdMs = null;
  appStopScanner();
  if (F) appFormStripState(F);
}

/** The router target of 1.2 rule 1: a scan, a typed id, a tile or a find result while a form is open. */
function appFormTag(F, id) {
  if (!F || APP.form !== F) return;
  var phone = APP.phone, r = null;
  F.last = { f: 'tag', n: F.last.n + 1 };
  if (F.kind === 'sale') r = appSaleAdd(phone, F.values, id, 1);
  else if (F.kind === 'restock') r = appRestockAdd(phone, F.values, id);
  else if (F.kind === 'newitem' && !F.values.tag) r = appNewItemTag(phone, F.values, id);
  if (!r) { appToast(APP.tt('ui_form_no_scan'), true); return; }
  if (r.ok) {
    F.values = r.values;
    F.dirty = true;
    F.flash = id;
    if (F.kind === 'newitem') { appFormScanStop(F); appFormDraftMove(F); }
    appFormRepaint(F);
    appFormChanged(F);
  } else {
    appToast(r.text, true);
    if (r.twice) { F.flash = id; appFormRepaint(F); }
  }
  if (F.scan && appFormWantsScan(F) && APP.win && APP.win.setTimeout) {
    APP.win.setTimeout(function () { if (APP.form === F && F.scan) appStartScanner(); }, APP_FORM_RESCAN_MS);
  }
}
/** A new-piece form's tag changed (U13): the draft moves to the new tag's key. */
function appFormDraftMove(F) {
  var key = appFormKey(F);
  if (F.draftKey && F.draftKey !== key) appFormDraftDrop(APP.store, F.kind, F.draftKey);
  F.draftKey = key;
}

/** The photo input's target while a new-piece form is open: downscaled in the browser, a sim record in the frame or Node. */
function appFormPhoto(file) {
  var F = APP.form;
  if (!F || F.kind !== 'newitem' || !file) return;
  var apply = function (rec) {
    if (APP.form !== F) return;
    F.values = appNewItemPhoto(APP.phone, F.values, rec);
    F.dirty = true;
    appFormRepaint(F);
    appFormChanged(F);
  };
  if (file.sim || typeof file.dataUrl === 'string') { apply(file); return; }
  appDownscalePhoto(file, APP_PHOTO_MAX_PX).then(apply, function () { appToast(APP.tt('ui_camera_error'), true); });
}

/** Every change: the draft in the persisted cache at once, made durable shortly after (debounced phone.commit('formdraft')). */
function appFormChanged(F) {
  if (!F || APP.form !== F) return;
  F.msg = '';
  F.forced = null;
  var key = appFormKey(F);
  if (key) appFormDraftWrite(APP.store, F.kind, key, F.values);
  if (F.timer && APP.win && APP.win.clearTimeout) APP.win.clearTimeout(F.timer);
  F.timer = APP.win && APP.win.setTimeout ? APP.win.setTimeout(function () { F.timer = null; APP.phone.commit('formdraft'); }, APP_FORM_DRAFT_MS) : null;
}

/**
 * Save (1.0, 7.3): the kind's pure save inside try/catch (U18). Refused: the first problem in .fmsg, its field outlined
 * and scrolled into view (a not_blank new piece gets its strip back, U13; a mode refusal closes the form with the toast
 * expired, U17). Accepted: appFormCommit, then (only then) the form closes and the home shows the reply card.
 */
function appFormSave(F) {
  if (!F || APP.form !== F || F.saving) return Promise.resolve(false);
  var K = APP_FORM_KINDS[F.kind], res;
  try { res = K.save(APP.phone, F); }
  catch (err) {
    try { APP.phone.ports.store.logError('form', err, '', F.kind); } catch (ignore) {}
    F.saving = false;
    F.msg = APP.tt('expired');
    appFormRegion(F, 'bar');
    return Promise.resolve(false);
  }
  if (!res.ok) {
    if (res.reason === 'busy') return Promise.resolve(false);
    if (res.reason === 'mode') { appCloseForm({ keep: true, mode: true }); appToast(APP.tt('expired'), true); return Promise.resolve(false); }
    F.saving = false;
    F.msg = '';
    F.forced = res.problems || null;
    appFormRepaint(F);
    if (F.kind === 'newitem' && res.reason === 'not_blank') {
      appFormDraftMove(F);
      if (APP.store.getPref('cameraOk')) appFormScanStart(F);
    }
    appFormScrollToBad(F);
    return Promise.resolve(false);
  }
  appFormRegion(F, 'bar');
  return appFormCommit(APP.phone, APP.sync, F.kind === 'buyer' ? 'customer' : F.kind === 'shop' ? 'setting' : F.kind).then(function (ok) {
    if (APP.form === F) appCloseForm({ saved: true, result: res });
    return ok;
  });
}
function appFormScrollToBad(F) {
  if (!F.el || !F.el.querySelector) return;
  var bad = F.el.querySelector('.fbad');
  if (bad && bad.scrollIntoView) { try { bad.scrollIntoView({ block: 'center' }); } catch (ignore) {} }
}

/**
 * Close the form (7.3, 13.4). opts.ask: a changed form asks ui_meas_close_ask (false when the seller stays). opts.keep:
 * the draft stays (the line-name card, a reset). opts.saved / opts.card: the home shows the reply card (its card layer
 * replaces the form layer, or the form layer is dropped when a card layer is below). opts.pop: appNavPop removes the
 * layer. opts.reset: appNavReset closes everything (no render, no camera). Otherwise the home shows the layer below.
 */
function appCloseForm(opts) {
  opts = opts || {};
  var F = APP && APP.form;
  if (!F) return true;
  // A changed form asks with the app's own sheet (appAskLeave, the UX review): the form stays until the seller chooses to
  // leave without saving; then the back runs again with F.leaveOk set.
  if (opts.ask && F.dirty && !F.saving && !F.leaveOk) {
    appAskLeave(function () { if (APP.form === F) { F.leaveOk = true; appNavPopTo(appNavList().length - 1); } });
    return false;
  }
  var K = APP_FORM_KINDS[F.kind];
  if (!opts.keep && !opts.saved) {
    var key = appFormKey(F);
    if (key) appFormDraftDrop(APP.store, F.kind, key);
    if (F.kind === 'newitem') appNewItemAbandon(APP.phone, F.values);
    if (key || F.kind === 'newitem') APP.phone.commit('formdraft');
  }
  if (F.timer && APP.win && APP.win.clearTimeout) APP.win.clearTimeout(F.timer);
  F.timer = null;
  F.scan = false;
  if (APP.scanner) APP.scanner.holdMs = null;
  appStopScanner();
  if (F.el && F.el.parentNode) F.el.parentNode.removeChild(F.el);
  APP.form = null;
  // The layer below the form's layer: a card layer means the home's card state.
  var nav = APP.nav || [], at = -1, i;
  for (i = nav.length - 1; i >= 0; i--) if (nav[i].kind === 'form') { at = i; break; }
  var below = at > 0 ? nav[at - 1] : null, belowCard = !!below && below.kind === 'card';
  if (!opts.pop && !opts.reset) {
    if (opts.saved && K && K.afterSave) K.afterSave(F, opts.result || {});
    else if ((opts.saved || opts.card) && !belowCard) appNavReplace({ kind: 'card' });
    else appNavDrop('form');
  }
  if (APP.reloadAfterForm && !APP.measForm) {
    APP.reloadAfterForm = false;
    APP.phone.commit('reload').then(function (ok) { if (ok && APP.win && APP.win.location) APP.win.location.reload(); else APP.reloadAfterForm = true; });
  }
  if (opts.reset || opts.pop) return true;               // appNavPop lands on the layer below once the form's layer is gone
  var restart = false;
  if (APP.screen === 'home') {
    if (opts.saved || opts.card || belowCard) APP.showScanner = false;
    else { APP.showScanner = true; restart = true; }
  }
  if (!(opts.saved && K && K.afterSave)) appRender();
  if (restart && APP.store.getPref('cameraOk')) appStartScanner();
  return true;
}

/** A line's name (1.3): the form closes keeping its draft and the core shows the item card (a card layer, 13.4). */
function appFormLineCard(F, id) {
  var uid = APP.phone.staffId(), staff = APP.store.meta.staff;
  appCloseForm({ keep: true, card: true });
  openTag(uid, id, staff, uid, APP.phone.ports, { card: true });
  APP.showScanner = false;
  APP.phone.commit('card');
  appRender();
}

/** A tap on a form control (the DOM handler) and the simulator's set op without a value. */
function appFormClick(F, f) {
  if (!F || APP.form !== F) return;
  var parts = String(f).split(':'), name = parts[0], arg = parts.slice(1).join(':');
  F.last = { f: f, n: F.last.n + 1 };
  if (f === 'close') { appNavBack(); return; }
  if (f === 'save') { appFormSave(F); return; }
  if (f === 'photo') { appFormScanStop(F); appPickPhoto(); return; }
  if (f === 'keypad') { appOpenTagKeypad(); return; }
  if (f === 'scan') { appFormScanStart(F); return; }
  if (name === 'line') { appFormLineCard(F, arg); return; }
  if ((name === 'found' || name === 'recent') && F.kind !== 'buyer') { appFormTag(F, arg); return; }
  if (f === 'find:go') { appFormFind(F); return; }
  if (f === 'due:date') {
    appOpenDateSheet(function (v) { appFormDo(F, 'date', v); }, { max: addDaysKey(dayKey(APP.phone.now()), CFG.SALE_DUE_MAX_DAYS) });
    return;
  }
  var K = APP_FORM_KINDS[F.kind];
  if (K && K.click && K.click(F, f) === true) return;
  var spec = appFormNumSpec(F, f);
  if (spec) {
    appOpenNumberKeypad({ title: spec.title, initial: 0, max: spec.max, onOk: function (v) { appFormDo(F, f, v); } });
    return;
  }
  appFormDo(F, f, undefined);
}
/** The search of the sale and restock forms (U25): the basket's shop only, eight at most, as tiles. */
function appFormFind(F) {
  var v = F.values, text = String(v.find || '').trim();
  if (!text) return;
  var shop = F.kind === 'sale' ? appSaleShop(APP.phone, v) : appRestockShop(APP.phone, v);
  var found = findItemsByName(APP.phone.ports, shop, text).filter(function (it) {
    if (F.kind === 'restock') return it.type !== CFG.ITEM_TYPE.UNIQUE;
    return !(it.type === CFG.ITEM_TYPE.UNIQUE && Number(it.stock) <= 0);
  }).slice(0, 8);
  F.values = appFormCopy(v);
  F.values.found = found.map(function (it) { return it.id; });
  F.values.foundFor = F.values.find;
  if (!found.length) appToast(APP.tt('ui_find_none'));
  if (F.regions.find) appFormRegion(F, 'find'); else appFormRepaint(F);
}
/** One state change through the kind's set, then the screen and the draft. */
function appFormDo(F, f, v) {
  if (!F || APP.form !== F) return;
  var K = APP_FORM_KINDS[F.kind];
  F.values = K.set(APP.phone, F.values, f, v);
  F.dirty = true;
  var note = F.values.notice;
  if (note) { delete F.values.notice; appToast(note, true); }
  appFormRepaint(F);
  appFormChanged(F);
}
/** The simulator's set op (8.3): a value fills a .fnum, an input or the date; without one it is a tap. */
function appFormSet(f, v) {
  var F = APP && APP.form;
  if (!F) return false;
  if (v === undefined || v === null) { appFormClick(F, f); return true; }
  F.last = { f: f, n: F.last.n + 1 };
  if (f === 'tag') { appFormTag(F, String(v)); return true; }
  if (f === 'due:date' || f === 'date') { appFormDo(F, 'date', v); return true; }
  appFormDo(F, f, v);
  return true;
}

/** The four job buttons (1.1, 7.3): the 2 x 2 grid of the scanner state, or the compact row of the card state (U22). */
function appJobRow(compact) {
  var raw = APP.ttRaw || APP.tt, names = [['sell', 'ui_home_sell'], ['new', 'ui_home_new'], ['restock', 'btn_restock'], ['expense', 'btn_expense']];
  var box = appH('div', { class: 'jobs' + (compact ? ' compact' : '') });
  names.forEach(function (n, i) {
    var label = raw(n[1]), plain = appPlain(label), f = 'job:' + n[0];
    var emoji = label.slice(0, label.length - plain.length).replace(/\s+$/, '');
    var b = appH('button', { type: 'button', 'data-f': f, class: (compact && i === 0 ? 'wide' : '') + (appFormHot(f) ? ' hot' : ''),
      'aria-label': compact && i > 0 ? plain : null, onclick: function () { appJobTap(n[0]); } });
    // The compact row (U22): the emoji with its word under it in small type, so a first-time user still reads what each
    // button does (the UX review); the full row keeps the whole label.
    if (compact && i > 0) { b.appendChild(appH('span', { class: 'em', text: emoji })); b.appendChild(appH('span', { class: 'lb', text: plain })); }
    else b.textContent = label;
    box.appendChild(b);
  });
  return box;
}
function appJobTap(job) {
  var uid = APP.phone.staffId(), req = { chatId: uid, uid: uid, staff: APP.store.meta.staff };
  appOpenForm(job === 'sell' ? 'sale' : job === 'new' ? 'newitem' : job, req);
}

/* ---------- renderers ---------- */
function appFormSection(title, children, cls) {
  var sec = appH('div', { class: 'fsec' + (cls ? ' ' + cls : '') });
  if (title) sec.appendChild(appH('div', { class: 'flabel', text: title }));
  (children || []).forEach(function (c) { if (c) sec.appendChild(c); });
  return sec;
}
function appFormStripRow(F, text, f, label) {
  return appH('div', { class: 'fstrip' }, [appH('span', { text: text }), appFormBtn(F, f, label)]);
}
/** The restored / older strips (the draft rule of 1.0). */
function appFormDraftStrips(F, body, view) {
  var tt = APP.tt;
  if (view.restored) body.appendChild(appFormStripRow(F, tt('ui_form_restored'), 'restored:clear', tt('ui_form_clear')));
  if (view.older) body.appendChild(appFormStripRow(F, tt('ui_form_older', { n: fmtCount(view.older) }), 'restored:merge', tt('ui_form_merge')));
}
/** The scan helpers under the strip: the tag keypad, a typed id at 700 px and wider, the search row and its tiles. */
function appFormScanHelpers(F, body, view, withFind) {
  var tt = APP.tt;
  body.appendChild(appH('div', { class: 'scanrow' }, [
    appFormBtn(F, 'keypad', tt('ui_btn_keypad'), { icon: 'keyboard' }),
    appFormInput(F, 'tag', '', { class: 'wideonly', placeholder: tt('ui_keypad_title'), 'aria-label': tt('ui_keypad_title') }, [])
  ]));
  if (!withFind) return;
  var input = appFormInput(F, 'find', F.values.find || '', { type: 'search', placeholder: tt('ui_find_placeholder'), 'aria-label': tt('ui_find_placeholder') }, []);
  body.appendChild(appH('div', { class: 'inbar' }, [input, appFormBtn(F, 'find:go', '', { iconOnly: 'search', aria: tt('ui_aria_search') })]));
  body.appendChild(appFormRegionNode(F, 'find', 'ffound', function (el) {
    var v = F.values, ids = v.find && v.foundFor === v.find ? (v.found || []) : [];
    if (!ids.length) return;
    el.appendChild(appFormTiles(F, ids.map(function (id) { return APP.phone.ports.store.getItem(id); }).filter(Boolean), 'found'));
  }));
  if (view.recent && view.recent.length) body.appendChild(appFormSection(tt('ui_recent_title'), [appFormTiles(F, view.recent, 'recent')], 'frecent'));
}
function appFormTiles(F, items, prefix) {
  var ports = APP.phone.ports, box = appH('div', { class: 'tiles' });
  items.forEach(function (it) {
    var st = it.status === CFG.STATUS.SOLD ? APP.tt('ui_val_sold') : (isPricePending(it) ? appPlain(t(ports, 'btn_pending')) : fmtMoney(it.price) + ' · ' + fmtCount(it.stock));
    var b = appFormBtn(F, prefix + ':' + it.id, '');
    b.textContent = '';
    b.appendChild(appH('span', { class: 'id', text: it.id }));
    b.appendChild(appH('span', { class: 'nm' }, [appH('span', { text: it.name })].concat(it.sample ? [appSampleBadge()] : [])));   // the badge, round 6b
    b.appendChild(appH('span', { class: 'st', text: st }));
    box.appendChild(b);
  });
  return box;
}
function appFormStepper(F, minus, mid, plus, n) {
  return appH('div', { class: 'stepper' }, [
    appFormBtn(F, minus, '−', { aria: '−' }),
    appFormBtn(F, mid, fmtCount(n), { cls: 'n' }),
    appFormBtn(F, plus, '+', { aria: '+' })
  ]);
}

/** The sale form's sections (1.3). */
function appSaleRender(F, body) {
  var tt = APP.tt, ports = APP.phone.ports, v = F.values, view = appSaleView(APP.phone, v);
  appFormDraftStrips(F, body, view);
  var split = appH('div', { class: 'fsplit' }), left = appH('div', { class: 'fleft' }), right = appH('div', { class: 'fright' });
  split.appendChild(left);
  split.appendChild(right);
  body.appendChild(split);
  appFormScanHelpers(F, left, view, true);
  // the lines
  var linesBox = appH('div', { class: 'flines' });
  view.lines.forEach(function (l) {
    var bad = appFormBad(F, 'line:' + l.id) || appFormBad(F, 'price:' + l.id);
    var row = appH('div', { class: 'fline' + (F.flash === l.id ? ' flash' : '') + (bad ? ' fbad' : '') });
    var nameBtn = appFormBtn(F, 'line:' + l.id, '', { cls: 'lname', aria: tt('ui_line_card') });
    nameBtn.textContent = '';
    nameBtn.appendChild(appH('span', { class: 'id', text: l.id }));
    nameBtn.appendChild(appH('span', { text: ' · ' + l.name }));
    if (l.sample) nameBtn.appendChild(appSampleBadge());   // a sample's badge (round 6b)
    row.appendChild(appH('div', { class: 'r1' }, [nameBtn, appFormBtn(F, 'remove:' + l.id, '', { iconOnly: 'trash', aria: tt('btn_remove_line') })]));
    var price = l.pending ? appFormBtn(F, 'price:' + l.id, appPlain(t(ports, 'btn_pending')), { cls: 'fnum warn', need: true, aria: tt('ask_sale_price') })
      : appFormBtn(F, 'price:' + l.id, fmtMoney(l.unitPrice) + ' ကျပ်', { cls: 'fnum', aria: tt('btn_discount') });
    var r2 = [price];
    if (l.priceChanged) r2.push(appH('s', { class: 'muted small', text: fmtMoney(l.listPrice) }));
    r2.push(appH('span', { class: 'amt num', text: fmtMoney(l.amount) }));
    row.appendChild(appH('div', { class: 'r2' }, r2));
    if (l.unique) row.appendChild(appH('div', { class: 'r3' }, [appH('span', { class: 'muted', text: tt('ui_line_one') })]));
    else row.appendChild(appH('div', { class: 'r3' }, [appFormStepper(F, 'qty-:' + l.id, 'qty:' + l.id, 'qty+:' + l.id, l.qty), appH('span', { class: 'stock', text: tt('ui_line_stock', { stock: fmtCount(l.stock) }) })]));
    if (l.stockOver) row.appendChild(appH('div', { class: 'over', text: tt('ui_stock_over', { stock: fmtCount(l.stock) }) }));
    if (l.priceFar) row.appendChild(appH('div', { class: 'over', text: tt('ui_price_far', { price: fmtMoney(l.unitPrice), list: fmtMoney(l.listPrice) }) }));
    linesBox.appendChild(row);
  });
  left.appendChild(linesBox);
  // the buyer
  var buyerSec = appFormSection(tt('btn_customer'), [], 'fbuyer' + (view.needBuyer && !view.buyer && !view.newBuyer ? ' fneed' : '') + (appFormBad(F, 'buyer') ? ' fbad' : ''));
  if (view.buyer) {
    var chip = appH('div', { class: 'bchip on' }, [appH('span', { text: view.buyer.name + (view.buyer.phone ? ' · ' + fmtPhone(view.buyer.phone) : '') }),
      appFormBtn(F, 'buyer:clear', '', { iconOnly: 'x', aria: tt('ui_btn_close') })]);
    buyerSec.appendChild(chip);
  } else if (view.newBuyer) {
    buyerSec.appendChild(appH('label', { class: 'fl', text: tt('ask_name') }));
    buyerSec.appendChild(appFormInput(F, 'name', v.newName, { maxlength: '60', 'aria-label': tt('ask_name') }, ['buyer', 'phone']));
    buyerSec.appendChild(appFormRegionNode(F, 'phone', 'fl', function (el) {
      el.appendChild(appH('label', { text: tt('ask_phone', { customer: String(F.values.newName || '').trim() || '…' }) }));
    }));
    buyerSec.appendChild(appFormInput(F, 'phone', v.newPhone, { inputmode: 'tel', maxlength: '20', 'aria-label': tt('ui_lbl_phone') }, ['buyer']));
    buyerSec.appendChild(appFormRegionNode(F, 'buyer', 'fchips', function (el) { appSaleBuyerChips(F, el); }));
    buyerSec.appendChild(appFormBtn(F, 'buyer:clear', tt('ui_w_cancel'), { cls: 'ghost small' }));
  } else {
    buyerSec.appendChild(appH('div', { class: 'inbar' }, [appFormInput(F, 'buyer', v.buyerText, { type: 'search', placeholder: tt('cust_find'), 'aria-label': tt('cust_find') }, ['buyer'])]));
    buyerSec.appendChild(appFormRegionNode(F, 'buyer', 'fchips', function (el) { appSaleBuyerChips(F, el); }));
  }
  if (view.needBuyer && !view.buyer) buyerSec.appendChild(appH('div', { class: 'muted small', text: tt('sale_need_buyer') }));
  right.appendChild(buyerSec);
  // how paid
  var seg = appH('div', { class: 'seg' + (appFormBad(F, 'pay') ? ' fbad' : '') });
  seg.appendChild(appFormBtn(F, 'pay:CASH', tt('btn_cash'), { on: !v.payMode && v.method === CFG.METHOD.CASH }));
  if (view.collapseWallets) seg.appendChild(appFormBtn(F, 'pay:wallets', tt('btn_kind_wallet'), { on: v.payMode === 'wallets' }));
  else view.wallets.forEach(function (k) { seg.appendChild(appFormBtn(F, 'pay:' + k, tt('btn_wallet', { method: methodLabel(ports, k) }), { on: !v.payMode && v.method === k })); });
  if (view.banks.length) seg.appendChild(appFormBtn(F, 'pay:bank', tt('btn_bank_transfer'), { on: v.payMode === 'bank' }));
  if (view.canMix) seg.appendChild(appFormBtn(F, 'pay:mix', tt('btn_split'), { on: v.payMode === 'mix' }));
  seg.appendChild(appFormBtn(F, 'pay:add', tt('btn_add_bank'), { icon: 'plus', on: v.payMode === 'add' }));
  var paySec = appFormSection(tt('sale_ask_method'), [seg], 'fpay');
  if (view.showAccounts) {
    var aseg = appH('div', { class: 'seg' + (appFormBad(F, 'acct') ? ' fbad' : '') });
    view.accounts.forEach(function (k) {
      var bank = view.banks.indexOf(k) >= 0;
      aseg.appendChild(appFormBtn(F, 'acct:' + k, bank ? tt('btn_bank', { method: methodLabel(ports, k) }) : tt('btn_wallet', { method: methodLabel(ports, k) }), { on: !v.acctAdd && v.method === k }));
    });
    aseg.appendChild(appFormBtn(F, 'acct:add', tt('btn_add_bank'), { icon: 'plus', on: !!v.acctAdd }));
    paySec.appendChild(appH('div', { class: 'flabel', text: tt(v.payMode === 'mix' ? 'sale_ask_split_account' : 'sale_ask_account') }));
    paySec.appendChild(aseg);
  }
  if (view.showAdd) {
    paySec.appendChild(appFormInput(F, 'acctname', v.addLabel, { placeholder: tt('add_ask_pm'), 'aria-label': tt('add_ask_pm'), maxlength: '40' }, []));
    paySec.appendChild(appH('div', { class: 'seg' }, [appFormBtn(F, 'acctkind:wallet', tt('btn_kind_wallet'), { on: v.addKind === 'wallet' }), appFormBtn(F, 'acctkind:bank', tt('btn_kind_bank'), { on: v.addKind === 'bank' })]));
  }
  if (view.showTransfer) {
    var mLabel = v.acctAdd ? String(v.addLabel || '').trim() : methodLabel(ports, v.method);
    paySec.appendChild(appH('div', { class: 'flabel', text: tt('ui_transfer_part', { method: mLabel }) }));
    paySec.appendChild(appH('div', { class: 'frow' }, [appFormNum(F, 'transfer', tt('ui_transfer_part', { method: mLabel }), v.bankPart, { need: nullish(v.bankPart) }),
      appFormBtn(F, 'transfer:half', tt('btn_half', { amount: fmtMoney(Math.floor(view.paidNow / 2)) }), { cls: 'chip2' })]));
    if (!nullish(v.bankPart)) paySec.appendChild(appH('div', { class: 'muted small', text: tt('sale_line_mixed', { cashMethod: methodLabel(ports, CFG.METHOD.CASH), cash: fmtMoney(Math.max(0, view.paidNow - v.bankPart)), method: mLabel, bank: fmtMoney(v.bankPart) }) }));
  }
  right.appendChild(paySec);
  // paid now and the promised day
  var pseg = appH('div', { class: 'seg' }, [appFormBtn(F, 'paid:full', tt('btn_paid_full', { amount: fmtMoney(view.total) }), { on: !v.part }), appFormBtn(F, 'paid:part', tt('btn_credit'), { on: !!v.part })]);
  var paidSec = appFormSection('', [pseg], 'fpaid');
  if (v.part) {
    paidSec.appendChild(appH('div', { class: 'flabel', text: tt('btn_paid_now') }));
    paidSec.appendChild(appH('div', { class: 'frow' + (view.needAmount ? ' fneed' : '') + (appFormBad(F, 'amount') ? ' fbad' : '') }, [
      appFormNum(F, 'amount', tt('btn_paid_now'), v.paid, { need: view.needAmount }),
      appFormBtn(F, 'amount:0', '0', { cls: 'chip2' }),
      appFormBtn(F, 'amount:half', tt('btn_half', { amount: fmtMoney(Math.round(view.total / 2)) }), { cls: 'chip2' })
    ]));
    var dueBox = appH('div', { class: 'fdue' + (view.needDue ? ' fneed' : '') + (appFormBad(F, 'due') ? ' fbad' : '') });
    dueBox.appendChild(appH('div', { class: 'flabel', text: tt('sale_ask_due', { owed: fmtMoney(view.needAmount ? view.total : view.owed) }) }));
    var dseg = appH('div', { class: 'seg' });
    view.duePresets.forEach(function (n) {
      dseg.appendChild(appFormBtn(F, 'due:' + n, tt('btn_days', { n: myDigits(n) }), { on: !nullish(v.dueDay) && v.dueDay !== '' && v.dueDay === saleDueKey(APP.phone.now(), n) }));
    });
    dueBox.appendChild(dseg);
    dueBox.appendChild(appH('div', { class: 'seg' }, [appFormBtn(F, 'due:date', tt('ui_btn_pick_date'), { icon: 'calendar' }), appFormBtn(F, 'due:none', tt('btn_due_unknown'), { on: v.dueDay === '' })]));
    if (!nullish(v.dueDay)) dueBox.appendChild(appH('div', { class: 'vid', text: v.dueDay === '' ? tt('sale_due_none') : tt('sale_due_set', { owed: fmtMoney(view.needAmount ? view.total : view.owed), date: fmtDayMy(v.dueDay) }) }));
    paidSec.appendChild(dueBox);
  }
  right.appendChild(paidSec);
}
/** The buyer chips region: the matches or recent buyers and ✏️ new; the known-phone and same-name chips of a new buyer. */
function appSaleBuyerChips(F, el) {
  var tt = APP.tt, v = F.values, view = appSaleView(APP.phone, v), chips = appH('div', { class: 'chips' });
  if (view.newBuyer) {
    if (view.knownPhone.length) {
      el.appendChild(appH('div', { class: 'muted small', text: tt('ui_buyer_known_phone', { customer: view.knownPhone.map(function (c) { return c.name; }).join(', ') }) }));
      view.knownPhone.forEach(function (c) { chips.appendChild(appFormBtn(F, 'buyer:' + c.id, c.name + (c.phone ? ' · ' + fmtPhone(c.phone) : ''), { cls: 'bchip' })); });
    }
    if (view.sameName) {
      el.appendChild(appH('div', { class: 'muted small', text: tt('ui_buyer_same_name') }));
      chips.appendChild(appFormBtn(F, 'buyer:' + view.sameName.id, view.sameName.name + (view.sameName.phone ? ' · ' + fmtPhone(view.sameName.phone) : ''), { cls: 'bchip' }));
      chips.appendChild(appFormBtn(F, 'buyer:create', tt('btn_create_named', { name: String(v.newName || '').trim() }), { cls: 'bchip ghost' }));
    }
    if (chips.children && chips.children.length) el.appendChild(chips);
    return;
  }
  view.matches.forEach(function (c) { chips.appendChild(appFormBtn(F, 'buyer:' + c.id, appPlain(customerLabel(c)), { cls: 'bchip' })); });
  chips.appendChild(appFormBtn(F, 'buyer:new', tt('btn_new_customer'), { cls: 'bchip ghost' }));
  el.appendChild(chips);
}

/** The new-piece form's sections (1.5). */
function appNewItemRender(F, body) {
  var tt = APP.tt, ports = APP.phone.ports, v = F.values, view = appNewItemView(APP.phone, v);
  var split = appH('div', { class: 'fsplit' }), left = appH('div', { class: 'fleft' }), right = appH('div', { class: 'fright' });
  split.appendChild(left);
  split.appendChild(right);
  if (v.restored && v.tag) body.appendChild(appFormStripRow(F, tt('ui_form_restored'), 'restored:clear', tt('ui_form_clear')));
  body.appendChild(split);
  if (!v.tag) left.appendChild(appH('div', { class: 'scanrow' }, [appFormBtn(F, 'keypad', tt('ui_btn_keypad'), { icon: 'keyboard', cls: appFormBad(F, 'tag') ? 'fbad' : '' })]));
  var pic = appH('div', { class: 'fphoto' });
  var m = view.photo;
  if (m && m.dataUrl) pic.appendChild(appH('img', { src: m.dataUrl, alt: '' }));
  else if (m && m.visual) { pic.setAttribute('style', 'background:' + m.visual.bg + ';color:#fff'); pic.appendChild(appH('span', { class: 'big', text: m.visual.emoji || '' })); }
  else if (m && m.blob && typeof URL !== 'undefined' && URL.createObjectURL) { try { pic.appendChild(appH('img', { src: URL.createObjectURL(m.blob), alt: '' })); } catch (ignore) {} }
  pic.appendChild(appFormBtn(F, 'photo', m ? tt('ui_photo_retake') : tt('ui_w_photo'), { icon: 'camera', cls: m ? 'retake' : 'primary' }));
  left.appendChild(pic);
  left.appendChild(appFormSection(tt('ui_form_name'), [appFormInput(F, 'name', v.name, { maxlength: '60', 'aria-label': tt('ui_form_name') }, ['later'])]));
  left.appendChild(appFormRegionNode(F, 'later', '', function (el) {
    var w = appNewItemView(APP.phone, F.values);
    if (w.nameLater) el.appendChild(appH('div', { class: 'muted small', text: tt('ui_form_name_later') }));
  }));
  // Round 6b (2.5): the shop's categories as plain chips (the catch-all last), then the plus chip; on, a name field with
  // its live hint (redrawn on input, U5). A hand-typed label with nothing left once plain (only emoji or invisible
  // characters) shows its row's key rather than a blank chip.
  var cats = appH('div', { class: 'toggle' });
  view.categories.forEach(function (c) {
    var lab = appPlain(c.label);
    cats.appendChild(appFormBtn(F, 'cat:' + c.key, listNameKey(lab) ? lab : c.key, { on: !v.catAdd && view.catKey === c.key }));
  });
  cats.appendChild(appFormBtn(F, 'cat:add', tt('btn_add_cat'), { icon: 'plus', on: !!v.catAdd }));
  var catSec = appFormSection(tt('btn_item_cat'), [cats], appFormBad(F, 'catname') ? 'fbad' : '');
  if (v.catAdd) {
    catSec.appendChild(appFormInput(F, 'catname', v.catName, { placeholder: tt('add_ask_ic'), 'aria-label': tt('add_ask_ic'), maxlength: '40' }, ['cathint']));
    catSec.appendChild(appFormRegionNode(F, 'cathint', '', function (el) {
      var w = appNewItemView(APP.phone, F.values);
      if (w.catHint) el.appendChild(appH('div', { class: 'muted small', text: tt(w.catHint.key, w.catHint.vars) }));
    }));
  }
  left.appendChild(catSec);
  // The cost is optional: its empty box says so (ui_cost_optional), so a seller who does not know it is not held up.
  right.appendChild(appFormSection(tt('btn_item_cost'), [appFormNum(F, 'cost', tt('btn_item_cost'), v.cost, { placeholder: tt('ui_cost_optional') })]));
  var chips = appH('div', { class: 'chips' });
  view.presets.forEach(function (p) { chips.appendChild(appFormBtn(F, 'price:' + p, fmtMoney(p), { cls: 'chip2', on: !v.pending && Number(v.price) === p })); });
  var priceSec = appFormSection(tt('btn_item_price'), [appFormNum(F, 'price', tt('btn_item_price'), v.pending ? null : v.price, { placeholder: v.pending ? appPlain(t(ports, 'btn_pending')) : '' }), chips], appFormBad(F, 'price') ? 'fbad' : '');
  priceSec.appendChild(appFormBtn(F, 'pending', tt('btn_pending'), { cls: 'toggle1', on: !!v.pending }));
  right.appendChild(priceSec);
  if (view.margin) right.appendChild(appH('div', { class: view.loss ? 'over' : 'vid', text: view.loss ? tt('item_lbl_loss') : tt('item_lbl_profit', { profit: fmtMoney(view.margin.profit), pct: view.margin.pct }) }));
  var countSec = appFormSection(tt('ui_lbl_qty'), [appFormStepper(F, 'count-', 'count', 'count+', Number(v.count) || 1)], appFormBad(F, 'count') ? 'fbad' : '');
  if (view.skuHint) countSec.appendChild(appH('div', { class: 'muted small', text: tt('ui_form_count_sku', { n: fmtCount(v.count) }) }));
  right.appendChild(countSec);
  // Round 6b (1.2): the sample is a real switch named နမူနာ (ဖွင့် / ပိတ်, as the AI switch), with its one-line hint.
  var sw = appFormBtn(F, 'sample', tt(v.sample ? 'ui_on' : 'ui_off'), { cls: 'switch', on: !!v.sample, role: 'switch', checked: !!v.sample, aria: tt('ui_lbl_sample') });
  right.appendChild(appH('div', { class: 'fsec fswitch' }, [appH('div', { class: 'kv' }, [appH('span', { class: 'k', text: tt('ui_lbl_sample') }), sw]),
    appH('div', { class: 'muted small', text: tt('ui_sample_hint') })]));
}

/** The restock form's sections (1.6). */
function appRestockRender(F, body) {
  var tt = APP.tt, v = F.values, view = appRestockView(APP.phone, v);
  appFormDraftStrips(F, body, view);
  appFormScanHelpers(F, body, view, true);
  view.lines.forEach(function (l) {
    var row = appH('div', { class: 'fline' + (F.flash === l.id ? ' flash' : '') });
    var nm = appH('div', { class: 'lname' }, [appH('span', { class: 'id', text: l.id }), appH('span', { text: ' · ' + l.name })]);
    row.appendChild(appH('div', { class: 'r1' }, [nm, appFormBtn(F, 'remove:' + l.id, '', { iconOnly: 'trash', aria: tt('btn_remove_line') })]));
    row.appendChild(appH('div', { class: 'stock', text: tt('ui_restock_after', { now: fmtCount(l.stock), after: fmtCount(l.after) }) }));
    var chips = appH('div', { class: 'chips' });
    view.presets.forEach(function (n) { chips.appendChild(appFormBtn(F, 'qtyset:' + l.id + ':' + n, myDigits(n), { cls: 'chip2', on: l.qty === n })); });
    row.appendChild(appH('div', { class: 'r3' }, [appFormStepper(F, 'qty-:' + l.id, 'qty:' + l.id, 'qty+:' + l.id, l.qty), chips]));
    body.appendChild(row);
  });
}

/** The expense form's sections (1.7). */
function appExpenseRender(F, body) {
  var tt = APP.tt, ports = APP.phone.ports, v = F.values, view = appExpenseView(APP.phone, v);
  if (v.restored) body.appendChild(appFormStripRow(F, tt('ui_form_restored'), 'restored:clear', tt('ui_form_clear')));
  if (view.owner) {
    var sseg = appH('div', { class: 'seg' });
    view.shops.forEach(function (s) { sseg.appendChild(appFormBtn(F, 'shop:' + s, shopName(ports, s), { on: v.shop === s })); });
    body.appendChild(appFormSection(tt('exp_ask_shop'), [sseg]));
  }
  var cseg = appH('div', { class: 'seg' + (appFormBad(F, 'cat') ? ' fbad' : '') });
  view.categories.forEach(function (c) { cseg.appendChild(appFormBtn(F, 'cat:' + c[0], appPlain(c[1]), { on: !v.catAdd && v.cat === c[0] })); });
  cseg.appendChild(appFormBtn(F, 'cat:add', tt('btn_add_cat'), { icon: 'plus', on: !!v.catAdd }));
  var catSec = appFormSection(tt('exp_ask_cat'), [cseg]);
  if (v.catAdd) catSec.appendChild(appFormInput(F, 'catname', v.catName, { placeholder: tt('add_ask_ec'), 'aria-label': tt('add_ask_ec'), maxlength: '40' }, []));
  body.appendChild(catSec);
  var chips = appH('div', { class: 'chips' });
  view.presets.forEach(function (p) { chips.appendChild(appFormBtn(F, 'amount:' + p, fmtMoney(p), { cls: 'chip2', on: Number(v.amount) === p })); });
  body.appendChild(appFormSection(tt('exp_ask_amount', { cat: view.catLabel || '…' }), [appFormNum(F, 'amount', tt('exp_ask_amount', { cat: view.catLabel || '' }), v.amount), chips], appFormBad(F, 'amount') ? 'fbad' : ''));
  var mseg = appH('div', { class: 'seg' });
  view.methods.forEach(function (k) { mseg.appendChild(appFormBtn(F, 'pay:' + k, k === CFG.METHOD.CASH ? tt('btn_cash') : tt('btn_bank', { method: methodLabel(ports, k) }), { on: v.method === k })); });
  body.appendChild(appFormSection(tt('sale_ask_method'), [mseg]));
  body.appendChild(appFormSection(tt('btn_note'), [appFormInput(F, 'note', v.note, { tag: 'textarea', rows: '2', maxlength: '100', placeholder: tt('exp_ask_note'), 'aria-label': tt('btn_note') }, [])]));
}
