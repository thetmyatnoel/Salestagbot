/**
 * core_ledger.js — append-only ledger operations and reporting.
 * Nothing here edits or deletes a row. Undo appends reversing rows.
 *
 * Amount = value of the event (SALE +, RETURN -, EXPENSE -, PAYMENT +, DEPOSIT +).
 * Cash   = money that actually moved on this row (SALE: paid now; PAYMENT/DEPOSIT: all;
 *          DEPOSIT_APPLIED: 0; EXPENSE: negative).
 * Qty    = signed stock movement: SALE -, RESTOCK +, RETURN +.
 * Method = how the cash moved: CASH, or the key of a pay_method option (KBZ, WAVE, BANK, or an account
 *          the family added to the Lists tab). The commit functions default it to CASH
 *          whenever Cash != 0; readers treat a blank Method with Cash != 0 as CASH (rows written
 *          before the column existed). Mirrors copy the Method so per-method totals net out.
 * A sale's open balance = Amount - Cash - its DEPOSIT_APPLIED rows - PAYMENT rows that reference it.
 *
 * Corrections come in two shapes, both append-only:
 *   undoGroup    - mirror rows that reverse every live row of a group (the group is then "voided").
 *   rewriteGroup - mirror row + replacement row inside the SAME group (method, customer, credit,
 *                  note), so receipt numbers, RefGroupIDs and the buttons on the card stay valid.
 *   splitSale    - a rewrite of the SALE row to its cash part plus a PAYMENT row for the part paid into
 *                  one account, in the sale's own group (the shape a custom-order delivery already has).
 * "Live rows" of a group are the rows that neither reverse another row nor are reversed by one.
 *
 * Option lists (pay_method, expense_category, fabric) are read through listRows(): the Lists tab when
 * the store has one with rows, the phone's synced copy (Settings lists_json), else the Settings rows
 * of version 3 (legacyListRows). This file calls nothing defined in core_orders.js, core_sync.js or
 * core_bot.js (the test runners and the simulator load different sets of files).
 */

function nullish(v) { return v === null || v === undefined; }

function newTx(ports, f) {
  var when = f.when instanceof Date ? f.when : ports.clock.now();
  var tx = {
    txId: ports.uuid(),
    groupId: f.groupId || '',
    time: when.toISOString(),
    day: dayKey(when),
    shop: f.shop,
    itemId: f.itemId || '',
    type: f.type,
    qty: Number(f.qty) || 0,
    unitPrice: nullish(f.unitPrice) ? '' : Number(f.unitPrice),
    amount: Number(f.amount) || 0,
    cash: Number(f.cash) || 0,
    costAtSale: (nullish(f.costAtSale) || f.costAtSale === '') ? '' : Number(f.costAtSale),
    customerId: f.customerId || '',
    refGroupId: f.refGroupId || '',
    note: f.note || '',
    source: f.source || CFG.SOURCE.SYSTEM,
    transcript: f.transcript || '',
    staffId: f.staffId || '',
    updateId: f.updateId || '',
    reversesTxId: f.reversesTxId || '',
    method: f.method || '',          // CASH, KBZ, WAVE, BANK on rows where cash moved
    category: f.category || '',      // expense category key
    seq: f.seq || '',                // server-assigned on arrival
    receivedAt: f.receivedAt || '',
    deviceId: f.deviceId || '',
    receiptNo: f.receiptNo || '',    // per-device receipt number on SALE rows (app); server derives for Telegram rows
    dueDay: f.dueDay || ''           // yyyy-mm-dd on the SALE row of a guided sale that still owes and has a promised date (round 5)
  };
  if (!tx.groupId) tx.groupId = tx.txId;
  return tx;
}

/** Append one or more rows atomically. Returns {groupId, txs}. */
function writeGroup(ports, txs) {
  var groupId = txs[0].groupId;
  txs.forEach(function (tx) { tx.groupId = groupId; });
  ports.lock.run(function () {
    txs.forEach(function (tx) { ports.store.appendLedger(tx); });
  });
  afterWrite(ports, txs);
  return { groupId: groupId, txs: txs };
}

/**
 * Refresh the Credits, Deposits and Customers views when a write could have changed them.
 * refreshViews(credits, deposits, customers): the third argument is the per-customer summary
 * (customerSummaries) that fills columns F:K of the Customers tab. gas_main.js rebuildViews()
 * should pass the same three arguments.
 */
function afterWrite(ports, txs) {
  if (!ports.store.refreshViews) return;
  var T = CFG.TX;
  var needs = txs.some(function (tx) {
    if (tx.customerId) return true;
    if (tx.type === T.PAYMENT || tx.type === T.DEPOSIT || tx.type === T.DEPOSIT_APPLIED) return true;
    if ((tx.type === T.SALE || tx.type === T.RETURN) && tx.cash !== tx.amount) return true;
    return !!tx.reversesTxId;
  });
  if (needs) ports.store.refreshViews(openCredits(ports, null), depositsHeldList(ports), customerSummaries(ports));
}

/* ----------------------------- payment method helpers ----------------------------- */

/** Method of a row for reading: blank with cash moved counts as CASH (rows older than the column). */
function methodOf(r) {
  if (r.method) return String(r.method).toUpperCase();
  return r.cash ? CFG.METHOD.CASH : '';
}

/** The method to store on a new row: the given key, or CASH when cash moved, or '' when it did not. */
function methodFor(method, cash) {
  if (!cash) return '';
  return method ? String(method).toUpperCase() : CFG.METHOD.CASH;
}

/**
 * The method keys offered as buttons: CASH first, then the active accounts of the pay_method list for
 * that shop (every shop's when no shop is given), in list order. On a sheet without Lists rows this is
 * Settings pay_methods ("CASH,KBZ,WAVE,BANK") exactly as before. A key longer than CFG.LIST_KEY_MAX_BYTES
 * (UTF-8) would push PM|<group id>|<KEY> past Telegram's 64-byte limit and make it reject the whole
 * keyboard under every sale, so such a key is left out and logged once; so are the accounts beyond
 * CFG.MAX_BANK_BUTTONS.
 */
function payMethods(ports, shop) {
  var keys = [CFG.METHOD.CASH], dropped = [];
  listOptions(ports, 'pay_method', shop).forEach(function (r) {
    if (r.key === CFG.METHOD.CASH) return;
    if (utf8ByteLength(r.key) > CFG.LIST_KEY_MAX_BYTES) { warnPayMethodKey(ports, r.key); return; }
    if (keys.length > CFG.MAX_BANK_BUTTONS) { dropped.push(r.key); return; }
    keys.push(r.key);
  });
  if (dropped.length) {
    listWarnOnce(ports, 'pmcap:' + listHash((shop || '') + ':' + dropped.join(',')), 'pay_methods',
      'More than ' + CFG.MAX_BANK_BUTTONS + ' active accounts' + (shop ? ' for ' + shop : '') + ': ' + dropped.join(', ') +
      ' are left out of the 🏦 buttons. Untick Active in the Lists tab on the accounts that are no longer used.');
  }
  return keys;
}

/**
 * The keys payMethods(ports, shop) returns (CASH first, the 12-byte drop, the MAX_BANK_BUTTONS cap), without CASH, split
 * into {wallets: [KEY], banks: [KEY]} by methodKind of each key's row; a key with no row (legacy Settings) is a wallet
 * unless it is BANK. The guided sale lists wallets by name and offers one 🏛 ဘဏ် button for the banks (round 5).
 */
function payMethodsByKind(ports, shop) {
  var out = { wallets: [], banks: [] };
  payMethods(ports, shop).forEach(function (k) {
    if (k === CFG.METHOD.CASH) return;
    var row = listOption(ports, 'pay_method', k);
    var kind = row ? methodKind(row) : (k === CFG.METHOD.BANK ? 'bank' : 'wallet');
    if (kind === 'bank') out.banks.push(k); else out.wallets.push(k);
  });
  return out;
}

/** UTF-8 byte length without Buffer or TextEncoder (Apps Script, old browsers). */
function utf8ByteLength(s) {
  s = String(s || '');
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }   // surrogate pair (emoji)
    else n += 3;
  }
  return n;
}

var PAY_METHOD_WARNED = {};
/**
 * One Errors row per cache key ck: per execution, and per 6 hours when the ports have a cache. Never throws.
 * Without ports (the pure list functions) nothing is logged and nothing is remembered.
 */
function listWarnOnce(ports, ck, where, message) {
  if (!ports || PAY_METHOD_WARNED[ck]) return;
  PAY_METHOD_WARNED[ck] = true;
  if (ports.cache && ports.cache.get) {
    try {
      if (ports.cache.get(ck)) return;
      ports.cache.put(ck, '1', 21600);
    } catch (ignore) {}
  }
  if (!ports.store || !ports.store.logError) return;
  try { ports.store.logError(where, message, '', ''); } catch (ignore) {}
}

/** One Errors row per oversize account key (Lists tab or Settings pay_methods). */
function warnPayMethodKey(ports, key) {
  listWarnOnce(ports, 'pmwarn:' + key, 'pay_methods', 'Pay method key "' + key + '" (Lists tab or Settings pay_methods) is longer than ' +
    CFG.LIST_KEY_MAX_BYTES + ' bytes and is left out of the 🏦 buttons (Telegram allows 64 bytes of callback data). Use a short ASCII key such as AYA; ' +
    'the Burmese name goes in the Label column of the Lists tab (on a sheet without that tab: Messages method_<KEY>).');
}

/** True for CASH and for every key of the pay_method list, a retired (inactive) account included: old cards and rows stay valid. */
function methodKnown(ports, key) {
  key = String(key === null || key === undefined ? '' : key).trim().toUpperCase();
  if (!key) return false;
  if (key === CFG.METHOD.CASH) return true;
  return !!listOption(ports, 'pay_method', key);
}

/** The account's label (a retired account included), else Messages method_<KEY>, else the key itself. */
function methodLabel(ports, key) {
  key = String(key || '').toUpperCase();
  if (!key) return '';
  var row = listOption(ports, 'pay_method', key);
  if (row) return row.label;
  var s = t(ports, 'method_' + key);
  return s === 'method_' + key ? key : s;
}

/** The account number and holder of a pay_method key (Lists.Detail), or ''. */
function accountDetail(ports, key) {
  var row = listOption(ports, 'pay_method', key);
  return row ? row.detail : '';
}

/**
 * A spoken or typed method (what the AI answered) as a key: CASH, or the exact key of an account that is a
 * button of that shop; else the active account of that shop whose label is the same name, or contains the
 * text, or is contained in it (the longest label first; a name shorter than 2 characters never matches by
 * containment); else an exact key the lists still know (a retired or another shop's account: old cards);
 * else ''. So "KBZ" goes to the shop's own "KBZ ဦးမောင်" once the family has unticked the generic KBZ row.
 */
function methodKeyFor(ports, text, shop) {
  var raw = String(text === null || text === undefined ? '' : text).trim();
  if (!raw) return '';
  var exact = raw.toUpperCase();
  if (exact === CFG.METHOD.CASH || payMethods(ports, shop).indexOf(exact) >= 0) return exact;
  var byLabel = methodKeyByLabel(ports, raw, shop);
  if (byLabel) return byLabel;
  return methodKnown(ports, exact) ? exact : '';
}

/** methodKeyFor's label match over the active accounts of that shop, or ''. */
function methodKeyByLabel(ports, raw, shop) {
  var want = listNameKey(raw), i;
  if (!want) return '';
  var cands = listOptions(ports, 'pay_method', shop).map(function (r, idx) { return { key: r.key, name: listNameKey(r.label), idx: idx }; })
    .filter(function (c) { return c.name.length > 0; });
  cands.sort(function (a, b) { return (b.name.length - a.name.length) || (a.idx - b.idx); });
  for (i = 0; i < cands.length; i++) if (cands[i].name === want) return cands[i].key;
  if (want.length < 2) return '';
  for (i = 0; i < cands.length; i++) {
    var n = cands[i].name;
    if (n.length >= 2 && (want.indexOf(n) >= 0 || n.indexOf(want) >= 0)) return cands[i].key;
  }
  return '';
}

/**
 * Where a customer can transfer money: 'label detail' for the active accounts of that shop that carry an
 * account number (Lists.Detail), the first four in list order. Printed on receipts and vouchers with a balance.
 */
function transferLines(ports, shop) {
  var out = [];
  listOptions(ports, 'pay_method', shop).forEach(function (r) {
    if (r.key === CFG.METHOD.CASH || !r.detail || out.length >= 4) return;
    out.push(r.label + ' ' + r.detail);
  });
  return out;
}

/** The same accounts as one chat line (Messages receipt_transfer, the accounts joined with ' · '), or '' when no account has a number. */
function transferLine(ports, shop) {
  var lines = transferLines(ports, shop);
  return lines.length ? t(ports, 'receipt_transfer', { accounts: lines.join(' · ') }) : '';
}

/* ----------------------------- expense category helpers ----------------------------- */

/**
 * The expense categories offered as buttons: [[key, label], ...] of the active expense_category options
 * (every shop's when no shop is given), 'other' always present. On a sheet without Lists rows this is
 * Settings expense_categories ("key:label,...") or the defaults with Messages labels, exactly as before.
 */
function expenseCategories(ports, shop) {
  var list = listOptions(ports, 'expense_category', shop).map(function (r) { return [r.key, r.label]; });
  if (!list.some(function (c) { return c[0] === 'other'; })) list.push(['other', t(ports, 'cat_other')]);
  return list;
}

/** The label of a category key; a retired (inactive) category still resolves, an unknown key shows itself. */
function categoryLabel(ports, key) {
  key = String(key || 'other').toLowerCase();
  var row = listOption(ports, 'expense_category', key);
  if (row) return row.label;
  return key === 'other' ? t(ports, 'cat_other') : key;
}

/**
 * The emoji in front of an expense category button: the option's Detail when it has one, else the built-in
 * one for the key, else the box. (categoryEmoji(category) in core_config.js is the ITEM category emoji.)
 */
function expenseEmoji(ports, key) {
  key = String(key || 'other').toLowerCase();
  var row = listOption(ports, 'expense_category', key);
  if (row && row.detail) return row.detail;
  return (Object.prototype.hasOwnProperty.call(CFG.EXPENSE_EMOJI, key) && CFG.EXPENSE_EMOJI[key]) || '📦';
}

/** The fabrics offered on an order line: the active fabric options (normalised rows; the label is the fabric's name). */
function fabricOptions(ports, shop) {
  return listOptions(ports, 'fabric', shop);
}

/** Map a spoken or typed category (key, label, or a phrase containing a label) to a key; unknown -> 'other'. */
function expenseCategoryKey(ports, text) {
  var s = String(text || '').trim();
  if (!s) return 'other';
  var list = expenseCategories(ports), low = s.toLowerCase(), i;
  for (i = 0; i < list.length; i++) if (list[i][0] === low) return list[i][0];
  var compact = normName(s);
  for (i = 0; i < list.length; i++) {
    var lab = normName(list[i][1]);
    if (lab && (compact.indexOf(lab) >= 0 || lab.indexOf(compact) >= 0)) return list[i][0];
  }
  return 'other';
}

/** Up to four amount buttons for an expense category: most common past amounts, padded from Settings. */
function expensePresets(ports, category) {
  var counts = {};
  liveRows(ports.store.ledgerRows()).forEach(function (r) {
    if (r.type !== CFG.TX.EXPENSE) return;
    if (category && (r.category || 'other') !== category) return;
    var a = Math.abs(r.amount);
    if (a > 0) counts[a] = (counts[a] || 0) + 1;
  });
  var amounts = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a] || a - b; }).slice(0, 4);
  var defaults = (ports.store.getSetting('expense_presets', '') || '').toString().split(',').map(Number).filter(function (x) { return x > 0; });
  if (!defaults.length) defaults = CFG.EXPENSE_PRESETS;
  for (var i = 0; i < defaults.length && amounts.length < 4; i++) {
    if (amounts.indexOf(defaults[i]) < 0) amounts.push(defaults[i]);
  }
  return amounts;
}

/* ----------------------------- option lists: rows and sources ----------------------------- */

/*
 * A normalised list row, the only shape the helpers work with:
 *   {list, key, label, active (boolean), order (number, 0 = no order), shop ('' | 'S1' | 'S2'), detail, note}
 * shop '' = both shops. detail = account number and holder (pay_method), emoji (expense_category).
 * Keys never change once used: Ledger.Method and Ledger.Category store them.
 */

/** A key as rows and callback data carry it: trimmed, upper case for pay_method, lower case for the other lists. */
function listNormKey(name, key) {
  var k = String(key === null || key === undefined ? '' : key).trim();
  return name === 'pay_method' ? k.toUpperCase() : k.toLowerCase();
}

function listText(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** One source row (a Lists tab row, a compact row, a legacy value) as a normalised row; null when it has no key. */
function listNormRow(name, r) {
  if (!r || typeof r !== 'object') return null;
  var key = listNormKey(name, r.key);
  if (!key) return null;
  var a = r.active, order = typeof r.order === 'boolean' ? 0 : Number(r.order), shop = listText(r.shop).toUpperCase();
  var off = a === false || a === 0 || (typeof a === 'string' && /^(false|0|no)$/i.test(a.trim()));
  var row = {
    list: name, key: key, label: listText(r.label) || key, active: !off,
    order: isFinite(order) && order > 0 ? order : 0,
    shop: CFG.SHOP_IDS.indexOf(shop) >= 0 ? shop : '',
    detail: listText(r.detail), note: listText(r.note)
  };
  // Kind (round 5): present ONLY when the cell holds a known kind, so a row without one keeps the eight-field shape.
  var kind = listText(r.kind).toLowerCase();
  if (CFG.LIST_KINDS.indexOf(kind) >= 0) row.kind = kind;
  return row;
}

/** 'wallet' or 'bank' for a pay_method row: its Kind when set, else the legacy BANK key is a bank by name and everything else a wallet. */
function methodKind(row) {
  return row.kind || (row.key === CFG.METHOD.BANK ? 'bank' : 'wallet');
}

/**
 * Normalisation, applied to every source: a row without a key is skipped, so is a key containing '|' (it would
 * break the parts of a button's callback data; logged once) and a later row whose key repeats an earlier one.
 * Always returns new row objects. The ports may be null (nothing is logged then).
 */
function listNormRows(ports, name, rows) {
  var out = [], seen = {}, list = rows || [];
  for (var i = 0; i < list.length; i++) {
    var r = listNormRow(name, list[i]);
    if (!r) continue;
    if (r.key.indexOf('|') >= 0) {
      listWarnOnce(ports, 'listkey:' + listHash(name + ':' + r.key), 'lists', 'Lists: the ' + name + ' key "' + r.key +
        '" contains "|" and is ignored (the bar separates the parts of a button). Change the Key in the Lists tab.');
      continue;
    }
    if (seen['k:' + r.key]) continue;
    seen['k:' + r.key] = true;
    out.push(r);
  }
  return out;
}

/**
 * The lists as version 3 holds them, as normalised rows with Order 1..n: Settings pay_methods with the
 * Messages method_<KEY> labels, Settings expense_categories (or the CFG defaults with cat_<key> labels),
 * Settings fabric_presets (or CFG.FABRIC_PRESETS, keys f1, f2, ...), and (round 6b) the five built-in item
 * categories: CFG.CATEGORIES under the fixed keys CFG.ITEM_CATEGORY_KEYS with CFG.CATEGORY_EMOJI in Detail (no
 * Settings read, so every device builds the same five). Never reads the Lists tab or lists_json.
 * It is the fallback of listRows, the seed of a new Lists tab and the seed a phone uses for a pending add.
 */
function legacyListRows(ports, name) {
  var rows = [];
  if (name === 'pay_method') {
    var rawM = (ports.store.getSetting('pay_methods', '') || '').toString();
    var keys = rawM.split(',').map(function (k) { return k.trim().toUpperCase(); }).filter(function (k) { return k.length > 0; });
    keys = keys.filter(function (k) {
      if (utf8ByteLength(k) <= CFG.LIST_KEY_MAX_BYTES) return true;
      warnPayMethodKey(ports, k);
      return false;
    });
    if (!keys.length) keys = CFG.DEFAULT_PAY_METHODS.slice();
    var at = keys.indexOf(CFG.METHOD.CASH);
    if (at > 0) keys.splice(at, 1);
    if (at !== 0) keys.unshift(CFG.METHOD.CASH);
    keys.forEach(function (k) {
      var s = t(ports, 'method_' + k);
      rows.push({ key: k, label: s === 'method_' + k ? k : s });
    });
  } else if (name === 'expense_category') {
    var rawC = (ports.store.getSetting('expense_categories', '') || '').toString(), cats = [];
    rawC.split(',').forEach(function (pair) {
      var p = pair.split(':');
      var key = String(p[0] || '').trim().toLowerCase();
      if (!key) return;
      cats.push([key, String(p[1] || '').trim() || key]);
    });
    if (!cats.length) {
      cats = CFG.EXPENSE_CATEGORIES.map(function (c) {
        var label = t(ports, 'cat_' + c[0]);
        return [c[0], label === 'cat_' + c[0] ? c[1] : label];
      });
    }
    if (!cats.some(function (c) { return c[0] === 'other'; })) cats.push(['other', t(ports, 'cat_other')]);
    cats.forEach(function (c) {
      rows.push({ key: c[0], label: c[1], detail: Object.prototype.hasOwnProperty.call(CFG.EXPENSE_EMOJI, c[0]) ? CFG.EXPENSE_EMOJI[c[0]] : '' });
    });
  } else if (name === 'fabric') {
    var rawF = (ports.store.getSetting('fabric_presets', '') || '').toString();
    var fabrics = rawF.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 0; });
    if (!fabrics.length) fabrics = CFG.FABRIC_PRESETS.slice();
    fabrics.forEach(function (label, idx) { rows.push({ key: 'f' + (idx + 1), label: label }); });
  } else if (name === 'item_category') {
    CFG.CATEGORIES.forEach(function (label, idx) {
      rows.push({ key: CFG.ITEM_CATEGORY_KEYS[idx], label: label,
        detail: Object.prototype.hasOwnProperty.call(CFG.CATEGORY_EMOJI, label) ? CFG.CATEGORY_EMOJI[label] : '' });
    });
  }
  var out = listNormRows(ports, name, rows);
  out.forEach(function (r, idx) { r.order = idx + 1; });
  return out;
}

/** Settings lists_json as an object {pay_method: [...], expense_category: [...], fabric: [...], item_category: [...]}, or null when it is not one. */
function listsJsonParse(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    var data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (err) {
    return null;
  }
}

// The last lists_json string parsed (a phone reads its lists on every screen). Read-only: listRows builds new
// row objects from it on every call and listsJsonUpsert parses its string itself.
var LISTS_JSON_MEMO = { raw: null, data: null };

/**
 * The normalised rows of one list (active or not, in source order) from the first source that has any:
 * 1. store.listOptions(name): the Lists tab (server, simulator);
 * 2. Settings lists_json: the copy the sync server derives for the phones (compact rows);
 * 3. legacyListRows: the Settings and Messages rows of version 3.
 * The fallback is per list: a Lists tab with accounts but no fabric rows still offers the old fabrics.
 */
function listRows(ports, name) {
  var store = ports.store, rows;
  if (store.listOptions) {
    rows = listNormRows(ports, name, store.listOptions(name));
    if (rows.length) return rows;
  }
  var raw = store.getSetting ? store.getSetting('lists_json', '') : '';
  if (raw && typeof raw === 'string') {
    if (LISTS_JSON_MEMO.raw !== raw) LISTS_JSON_MEMO = { raw: raw, data: listsJsonParse(raw) };
    var compact = LISTS_JSON_MEMO.data ? LISTS_JSON_MEMO.data[name] : null;
    if (compact && compact.length) {
      rows = listNormRows(ports, name, Array.prototype.map.call(compact, function (c) { return listRowFromCompact(name, c); }));
      if (rows.length) return rows;
    }
  }
  return legacyListRows(ports, name);
}

/**
 * The filter and sort of listOptions, on rows already read (pure; round 6b took it out so the item categories can
 * use it on their merged rows): active rows (all rows with includeInactive), for that shop when one is given (a row
 * with a blank Shop belongs to every shop), sorted by Order; rows without an Order come last, in source order.
 */
function listPick(rows, shop, includeInactive) {
  var want = shop ? String(shop).toUpperCase() : '';
  var picked = [];
  (rows || []).forEach(function (r, idx) {
    if (!includeInactive && !r.active) return;
    if (want && r.shop && r.shop !== want) return;
    picked.push({ r: r, idx: idx });
  });
  picked.sort(function (a, b) {
    var ao = a.r.order > 0 ? a.r.order : Infinity, bo = b.r.order > 0 ? b.r.order : Infinity;
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.idx - b.idx;
  });
  return picked.map(function (x) { return x.r; });
}

/**
 * The options of a list as the buttons show them: active rows (all rows with includeInactive), for that
 * shop when one is given (a row with a blank Shop belongs to both), sorted by Order; rows without an Order
 * come last, in source order.
 */
function listOptions(ports, name, shop, includeInactive) {
  return listPick(listRows(ports, name), shop, includeInactive);
}

/** The row with that key (any case), a retired one included, or null. */
function listOption(ports, name, key) {
  var k = listNormKey(name, key);
  if (!k) return null;
  var rows = listRows(ports, name);
  for (var i = 0; i < rows.length; i++) if (rows[i].key === k) return rows[i];
  return null;
}

/* ----------------------------- option lists: how they reach a phone ----------------------------- */

/** A row as lists_json carries it: {k, l, a (1|0), o, s, d} plus t (the Kind) only when the row has one. The Note stays on the server. */
function listRowToCompact(row) {
  var c = { k: row.key, l: row.label, a: row.active ? 1 : 0, o: row.order, s: row.shop, d: row.detail };
  if (row.kind) c.t = row.kind;
  return c;
}

/** A compact row back as a normalised row of the list called name (null when it has no key). */
function listRowFromCompact(name, c) {
  if (!c || typeof c !== 'object') return null;
  return listNormRow(name, { key: c.k, label: c.l, active: c.a, order: c.o, shop: c.s, detail: c.d, note: '', kind: c.t });
}

/**
 * The Settings value the sync server sends to the phones: every Lists row (active or not, sheet order) of every
 * list of CFG.LIST_NAMES as compact rows, or '' when the store has no listOptions or every list is empty.
 */
function listsJsonFor(ports) {
  var store = ports && ports.store;
  if (!store || !store.listOptions) return '';
  var out = {}, any = false;
  CFG.LIST_NAMES.forEach(function (name) {
    var rows = listNormRows(ports, name, store.listOptions(name));
    if (rows.length) any = true;
    out[name] = rows.map(listRowToCompact);
  });
  return any ? JSON.stringify(out) : '';
}

/**
 * The phone's side of an add: apply rec to the list called name inside a lists_json string. Parses raw itself
 * (never the memo; a missing or unparseable value counts as empty), runs listUpsert and returns
 * {raw: <the new JSON, or the old string when nothing changed>, status, key}.
 */
function listsJsonUpsert(raw, name, seedRows, rec) {
  var data = listsJsonParse(raw) || {}, r2 = {}, k;
  for (k in rec) if (Object.prototype.hasOwnProperty.call(rec, k)) r2[k] = rec[k];
  r2.list = name;
  var cur = data[name] && data[name].length ? Array.prototype.map.call(data[name], function (c) { return listRowFromCompact(name, c); }) : [];
  var res = listUpsert(cur, r2, seedRows);
  if (!res.ops.length) return { raw: typeof raw === 'string' ? raw : '', status: res.status, key: res.key };
  var out = {};
  for (k in data) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
  CFG.LIST_NAMES.forEach(function (n) { if (!Array.isArray(out[n])) out[n] = []; });
  out[name] = res.rows.map(listRowToCompact);
  return { raw: JSON.stringify(out), status: res.status, key: res.key };
}

/* ----------------------------- option lists: the upsert rule ----------------------------- */

/**
 * The one rule every store follows when an option is added or an account number is set. Pure.
 * rows = the rows of rec.list now stored; rec = {list, key, label?, detail?, detailWas?, shop?, note?};
 * seedRows = what the user sees today (legacyListRows or the phone's copy), used only when rows is empty.
 * Returns {rows: <the new state>, ops, status: 'ok' | 'dup', key: <the stored key>} where ops is what the
 * store has to persist, in order: {op: 'append', row} and {op: 'set', key, field: 'label' | 'detail', value}.
 *  - No row stored yet: the seed rows are appended first, so adding one option never hides the old ones.
 *  - Key absent and a label given: append it, active, Order = the largest Order + 1. 'ok'.
 *  - Key absent and no label (an account number for an unknown key): nothing. 'dup'.
 *  - Key present: the label is set only while the stored one is blank (= the key); the detail is set when it
 *    differs and either none is stored or rec.detailWas is the stored one (the user replaced the value they
 *    were looking at: a stale edit from an offline phone never overwrites a newer one). Active, Order and
 *    Shop are never touched. 'ok' when something was set, else 'dup'.
 * Keys compare after normalisation (any case); op.key and the returned key are the normalised stored key
 * (a store finds its row with listNormKey(list, <its Key cell>) === op.key).
 */
function listUpsert(rows, rec, seedRows) {
  rec = rec || {};
  var name = String(rec.list || ''), out = listNormRows(null, name, rows), ops = [];
  var key = listNormKey(name, rec.key), i;
  if (!key || key.indexOf('|') >= 0) return { rows: out, ops: ops, status: 'dup', key: key };
  if (!out.length) {
    listNormRows(null, name, seedRows).forEach(function (s) {
      out.push(s);
      ops.push({ op: 'append', row: listNormRow(name, s) });
    });
  }
  var found = null, maxOrder = 0;
  for (i = 0; i < out.length; i++) {
    if (out[i].key === key) found = out[i];
    if (out[i].order > maxOrder) maxOrder = out[i].order;
  }
  var label = typeof rec.label === 'string' ? rec.label.trim() : '';
  var detail = typeof rec.detail === 'string' ? rec.detail.trim() : '';
  var changed = false;
  if (!found) {
    if (!label) return { rows: out, ops: ops, status: 'dup', key: key };
    var row = listNormRow(name, { key: key, label: label, active: true, order: maxOrder + 1, shop: rec.shop, detail: detail, note: rec.note, kind: rec.kind });
    out.push(row);
    ops.push({ op: 'append', row: listNormRow(name, row) });
    changed = true;
  } else {
    if (label && found.label === found.key && label !== found.label) {
      found.label = label;
      ops.push({ op: 'set', key: key, field: 'label', value: label });
      changed = true;
    }
    if (detail && detail !== found.detail &&
        (found.detail === '' || (typeof rec.detailWas === 'string' && rec.detailWas.trim() === found.detail))) {
      found.detail = detail;
      ops.push({ op: 'set', key: key, field: 'detail', value: detail });
      changed = true;
    }
  }
  return { rows: out, ops: ops, status: changed ? 'ok' : 'dup', key: key };
}

/* ----------------------------- option lists: adding one where it is needed ----------------------------- */

/** 32-bit FNV-1a of the text's UTF-8 bytes as 8 lower-case hex digits (shift-add form: no Math.imul in ES5). */
function listHash(text) {
  var s = String(text === null || text === undefined ? '' : text), h = 0x811c9dc5;
  function mix(b) {
    h ^= b;
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) mix(c);
    else if (c < 0x800) { mix(0xc0 | (c >> 6)); mix(0x80 | (c & 63)); }
    else if (c < 0x10000) { mix(0xe0 | (c >> 12)); mix(0x80 | ((c >> 6) & 63)); mix(0x80 | (c & 63)); }
    else { mix(0xf0 | (c >> 18)); mix(0x80 | ((c >> 12) & 63)); mix(0x80 | ((c >> 6) & 63)); mix(0x80 | (c & 63)); }
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// The invisible characters Burmese keyboards and pasted text insert between words: zero-width space (200B),
// non-joiner (200C), joiner (200D), word joiner (2060), byte-order mark (FEFF). Built from character codes
// so that this source file itself never holds an invisible character.
var LIST_ZW_NAME = new RegExp('[' + String.fromCharCode(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff) + ']', 'g');
var LIST_ZW_TEXT = new RegExp('[' + String.fromCharCode(0x200b, 0xfeff) + ']', 'g');

/**
 * A label reduced to what makes it the same name: no spaces, lower case, and none of the invisible characters
 * above. Two labels are the same name when their listNameKey is equal.
 */
function listNameKey(label) {
  return normName(String(label === null || label === undefined ? '' : label).replace(LIST_ZW_NAME, ''));
}

/**
 * The key of a new option, derived from its name so every device makes the same key for the same name and
 * the upsert merges them: the first 7 ASCII letters and digits of the label plus the first 4 hex digits of
 * listHash(listNameKey(label)); upper case for pay_method, lower case otherwise. A slug that is empty or starts
 * with a digit gets the list's prefix letter (and is cut to 6), so a key always starts with a letter and a
 * Sheet never reads it as a number. Only when another option already holds that key the 4 hex digits come
 * from ports.uuid() (at most 5 draws). At most 11 bytes; never CASH, never other.
 */
function listKeyFor(ports, name, label, existingKeys) {
  var upper = name === 'pay_method', taken = {};
  var slug = String(label === null || label === undefined ? '' : label).replace(/[^A-Za-z0-9]/g, '').slice(0, 7);
  slug = upper ? slug.toUpperCase() : slug.toLowerCase();
  if (!slug || /^[0-9]/.test(slug)) slug = (CFG.LIST_PREFIX[name] || 'x') + slug.slice(0, 6);
  (existingKeys || []).forEach(function (k) { taken['k:' + listNormKey(name, k)] = true; });
  function make(hex) {
    var h = String(hex).slice(0, 4);
    return slug + (upper ? h.toUpperCase() : h.toLowerCase());
  }
  function free(k) { return !taken['k:' + k] && k !== CFG.METHOD.CASH && k !== 'other'; }
  var key = make(listHash(listNameKey(label)));
  for (var n = 0; n < 5 && !free(key); n++) {
    var hex = String(ports && ports.uuid ? ports.uuid() : '').replace(/[^0-9a-fA-F]/g, '');
    key = make(hex.length >= 4 ? hex : listHash(key + ':' + n));
  }
  return key;
}

/**
 * Typed or spoken text as one clean line of at most max characters: zero-width spaces and byte-order marks
 * removed, line breaks and runs of spaces turned into one space, trimmed.
 */
function listCleanText(text, max) {
  var s = String(text === null || text === undefined ? '' : text).replace(LIST_ZW_TEXT, '').replace(/\s+/g, ' ').trim();
  if (s.length > max) {
    s = s.slice(0, max);
    var last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);   // never half of an emoji
    s = s.trim();
  }
  return s;
}

// Currency and unit words that may follow an amount ("5000 ကျပ်", "10k", "5,000 ks"); the number words themselves
// (တစ်, ငါး, ထောင်, သောင်း, သိန်း, ရာ ...) are found by parseBurmeseNumbers, all but the joined form ထောင့်
// (သုံးထောင့်ငါးရာ) and ခွဲ (a half: တစ်သိန်းခွဲ), listed here.
var LIST_AMOUNT_WORDS = ['ကျပ်', 'ကျပ', 'k', 'ks', 'kyat', 'kyats', 'mmk', 'lakh', 'lakhs', 'ထောင့်', 'ခွဲ'];

/**
 * True when a name is only an amount written some other way than plain digits: numbers (digits, Burmese digits,
 * number words such as တစ်သောင်း or ငါးထောင်) with nothing left beside them but separators and currency words.
 * "5000 ကျပ်", "10k", "၅၀၀၀ ကျပ်" and "တစ်သောင်း" are amounts; "KBZ 2" and "ငါးမျိုး" are names.
 */
function listLooksLikeAmount(clean) {
  var s = String(clean || ''), nums = parseBurmeseNumbers(s);
  if (!nums.length) return false;
  var rest = '', at = 0;
  nums.forEach(function (n) {
    if (n.index < at) return;
    rest += s.slice(at, n.index) + ' ';
    at = n.end;
  });
  rest += s.slice(at);
  var words = rest.toLowerCase().split(/[\s.,\-+()\/]+/);
  for (var i = 0; i < words.length; i++) {
    if (words[i] && LIST_AMOUNT_WORDS.indexOf(words[i]) < 0) return false;
  }
  return true;
}

/**
 * The first half of ➕: is the typed name usable, and does an option of that name exist already? Nothing is written.
 *   {ok: false, reason: 'empty'}             nothing usable (also digits only: a mistyped amount must not become an option)
 *   {ok: false, reason: 'unavailable'}       not one of the lists
 *   {ok: true, existed: true, key, label}    an option (active or retired) already has that name
 *   {ok: true, existed: false, label}        free: label is the clean text; the caller decides when to write it
 */
function listFindByLabel(ports, name, label) {
  if (CFG.LIST_NAMES.indexOf(name) < 0) return { ok: false, reason: 'unavailable' };
  var clean = listCleanText(label, CFG.LIST_LABEL_MAX), want = listNameKey(clean);
  if (!want || /^[0-9၀-၉\s.,\-+()\/]*$/.test(clean) || listLooksLikeAmount(clean)) return { ok: false, reason: 'empty' };
  // item_category (round 6b): its merged rows, so the always-there catch-all is found and a left-out row is not matched.
  var rows = name === 'item_category' ? itemCategoryRows(ports) : listRows(ports, name);
  for (var i = 0; i < rows.length; i++) {
    if (listNameKey(rows[i].label) === want) return { ok: true, existed: true, key: rows[i].key, label: rows[i].label };
  }
  return { ok: true, existed: false, label: clean };
}

/**
 * The ➕ of every pick list: add an option by the name the seller typed or said.
 *   {ok: false, reason: 'empty'}        nothing usable (also digits only: a mistyped amount must not become an option)
 *   {ok: true, existed: true, key, label}  an option (active or retired) already has that name; nothing is written
 *   {ok: false, reason: 'unavailable'}  this store cannot add options
 *   {ok: true, created: true, key, label}  written through store.addListOption; shared by both shops
 * extra.kind ('wallet' | 'bank', round 5) is stored on the new pay_method row; anything else adds no kind.
 */
function addListOptionByLabel(ports, name, label, staff, extra) {
  var found = listFindByLabel(ports, name, label);
  if (!found.ok || found.existed) return found;
  var clean = found.label;
  var rows = listRows(ports, name);
  if (!ports.store.addListOption) return { ok: false, reason: 'unavailable' };
  var key = listKeyFor(ports, name, clean, rows.map(function (r) { return r.key; }));
  var who = staff && (staff.name || staff.id) ? String(staff.name || staff.id) : '?';
  var rec = { list: name, key: key, label: clean, shop: '', note: 'added by ' + who + ' ' + dayKey(ports.clock.now()) };
  if (extra && CFG.LIST_KINDS.indexOf(extra.kind) >= 0) rec.kind = extra.kind;
  var res = ports.store.addListOption(rec, rows);
  if (res && res.key) key = res.key;
  if (res && res.status === 'dup') {
    // Somebody added the same name a moment ago (the key is derived from the name): use that option.
    var have = listOption(ports, name, key);
    return { ok: true, existed: true, key: key, label: have ? have.label : clean };
  }
  return { ok: true, created: true, key: key, label: clean };
}

/**
 * Set the Detail of an option (the account number and holder of a pay_method key).
 *   {ok: false, reason: 'empty' | 'unavailable' | 'missing'}  nothing typed, a store without addListOption, no such key
 *   {ok: true, saved, detail}  saved = the store took it; detail = what is stored now (the older value when a
 *                              newer one was already there and this edit was stale)
 */
function setListDetail(ports, name, key, detail) {
  var clean = listCleanText(detail, CFG.LIST_DETAIL_MAX);
  if (!clean) return { ok: false, reason: 'empty' };
  if (!ports.store.addListOption) return { ok: false, reason: 'unavailable' };
  var row = listOption(ports, name, key);
  if (!row) return { ok: false, reason: 'missing' };
  var res = ports.store.addListOption({ list: name, key: row.key, detail: clean, detailWas: row.detail }, listRows(ports, name));
  var now = listOption(ports, name, row.key);
  return { ok: true, saved: !!res && res.status === 'ok', detail: now ? now.detail : '' };
}

/* ----------------------------- item categories (round 6b, G2) ----------------------------- */

/*
 * The Lists tab's item_category list. An item stores the category's NAME (its Category cell, as before round 6b); a
 * piece and a row match by listNameKey, and a built-in's old name also finds its row by key after a rename. The row
 * keyed 'other' is the catch-all: always there, always offered, always the last option, the category of a piece with
 * none chosen and the one category the photo AI may replace. A name containing CFG.SAMPLE_WORD is never a category
 * (a sample is the switch of the new-piece screens).
 */

/**
 * The item_category rows every reader uses (active or not, in source order, new row objects): listRows' rows (the
 * Lists tab, lists_json, or the five built-ins), plus the built-in 'other' row when no row has that key (merged by
 * KEY only). Left out, each logged once: a row whose name contains the sample word, and a row whose name an earlier
 * row already has (the row keyed 'other' counts as earlier than every row). The row keyed 'other' is never left out.
 */
function itemCategoryRows(ports) {
  var rows = listRows(ports, 'item_category'), i, other = null;
  for (i = 0; i < rows.length; i++) if (rows[i].key === 'other') { other = rows[i]; break; }
  if (!other) {
    var legacy = legacyListRows(ports, 'item_category');
    for (i = 0; i < legacy.length; i++) if (legacy[i].key === 'other') { other = legacy[i]; rows.push(other); break; }
  }
  var sample = listNameKey(CFG.SAMPLE_WORD), seen = {}, out = [];
  var otherName = other ? listNameKey(other.label) : '';
  if (otherName) seen['n:' + otherName] = 'other';
  rows.forEach(function (r) {
    if (r === other) { out.push(r); return; }
    var n = listNameKey(r.label);
    if (sample && n.indexOf(sample) >= 0) {
      listWarnOnce(ports, 'icsample:' + listHash(r.key + ':' + n), 'lists', 'Lists: the item_category row "' + r.label +
        '" holds the word ' + CFG.SAMPLE_WORD + ' and is not offered; a sample is the ' + CFG.SAMPLE_EMOJI + ' switch');
      return;
    }
    if (n && seen['n:' + n]) {
      listWarnOnce(ports, 'icdup:' + listHash(r.key + ':' + n), 'lists', 'Lists: the item_category name "' + r.label +
        '" is on two rows; the first (key ' + seen['n:' + n] + ') is used');
      return;
    }
    if (n) seen['n:' + n] = r.key;
    out.push(r);
  });
  return out;
}

/**
 * The item categories offered for that shop: the active rows of itemCategoryRows for the shop, by Order, then the
 * catch-all LAST whatever its Active, Shop and Order. Every chip, every Telegram button, every pick and the AI's list
 * come from this one function.
 */
function itemCategoryOptions(ports, shop) {
  var rows = itemCategoryRows(ports), other = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].key === 'other') other = rows[i];
  var out = listPick(rows.filter(function (r) { return r.key !== 'other'; }), shop, false);
  if (other) out.push(other);
  return out;
}

/**
 * The item_category row of a stored or typed name (active or retired), or null: the row of that name; else, for an
 * old built-in name (CFG.CATEGORIES), the row with that built-in's key (a renamed built-in).
 */
function itemCategoryOf(ports, name) {
  var n = listNameKey(name), i, j;
  if (!n) return null;
  var rows = itemCategoryRows(ports);
  for (i = 0; i < rows.length; i++) if (listNameKey(rows[i].label) === n) return rows[i];
  for (i = 0; i < CFG.CATEGORIES.length; i++) {
    if (listNameKey(CFG.CATEGORIES[i]) !== n) continue;
    for (j = 0; j < rows.length; j++) if (rows[j].key === CFG.ITEM_CATEGORY_KEYS[i]) return rows[j];
  }
  return null;
}

/** The catch-all's current label (the row keyed 'other', always there). */
function itemCategoryFallback(ports) {
  var rows = itemCategoryRows(ports);
  for (var i = 0; i < rows.length; i++) if (rows[i].key === 'other') return rows[i].label;
  return CFG.CATEGORIES[CFG.CATEGORIES.length - 1];
}

/** The entry of names that is the same name as name (listNameKey), else ''. Pure. */
function itemCategoryPick(names, name) {
  var n = listNameKey(name);
  if (!n || !names) return '';
  for (var i = 0; i < names.length; i++) if (listNameKey(names[i]) === n) return String(names[i]);
  return '';
}

/** The photo AI's list for a piece of that shop: {names (the offered labels, the catch-all last), other (its label)}. */
function itemCategoryAi(ports, shop) {
  return {
    names: itemCategoryOptions(ports, shop || '').map(function (r) { return r.label; }),
    other: itemCategoryFallback(ports)
  };
}

/**
 * The list a photo job decides against: the job's own ctx.categories when it carries one (a copy; the catch-all is its
 * last entry), else itemCategoryAi(ports, shop). The server's late rename and a phone's replay both read the job's ctx,
 * so they decide alike whatever each side's list holds now.
 */
function itemCategoryCats(ctx, ports, shop) {
  if (ctx && Array.isArray(ctx.categories) && ctx.categories.length) {
    var names = ctx.categories.map(function (c) { return String(c); });
    return { names: names, other: names[names.length - 1] };
  }
  return itemCategoryAi(ports, shop);
}

/** Telegram's emoji of an item category: its row's Detail, else the built-in emoji of a built-in name, else the neutral one. */
function itemCategoryEmoji(ports, name) {
  var r = itemCategoryOf(ports, name), s = String(name === null || name === undefined ? '' : name);
  if (r && r.detail) return r.detail;
  if (Object.prototype.hasOwnProperty.call(CFG.CATEGORY_EMOJI, s)) return CFG.CATEGORY_EMOJI[s];
  return CFG.ITEM_CATEGORY_NEUTRAL;
}

/** The emoji an item leads with in Telegram (G1): the sample sign for a sample, else its category's emoji. */
function itemEmoji(ports, item) {
  return item && item.sample ? CFG.SAMPLE_EMOJI : itemCategoryEmoji(ports, item ? item.category : '');
}

/**
 * The first half of the item categories' add (Telegram's ➕, the app's plus chip). Nothing is written.
 *   {ok: false, reason: 'sample'}                 the name contains the sample word (a sample is the switch)
 *   {ok: false, reason: 'empty' | 'unavailable'}  as listFindByLabel; also a name with no letter at all (only emoji,
 *                                                 signs or digits: the app would draw its chip blank)
 *   {ok: false, reason: 'closed', key, label}     a category of that name exists but the shop is not offered it
 *                                                 (the owner unticked it, or gave it another shop): typing it never reopens it
 *   {ok: true, existed: true, key, label}         an offered category has that name, or it is the old name of a renamed
 *                                                 built-in (itemCategoryOf: that row, under its current label)
 *   {ok: true, existed: false, label}             free
 */
function itemCategoryFind(ports, label, shop) {
  var clean = listCleanText(label, CFG.LIST_LABEL_MAX), sample = listNameKey(CFG.SAMPLE_WORD);
  if (sample && listNameKey(clean).indexOf(sample) >= 0) return { ok: false, reason: 'sample' };
  // A letter of any script (Latin, Myanmar and the rest below the emoji planes), Burmese digits and ၊ ။ aside.
  if (!/[A-Za-z\u00C0-\u103F\u104C-\u1FFF\u2C00-\uD7FF\uF900-\uFDFF]/.test(clean)) return { ok: false, reason: 'empty' };
  var f = listFindByLabel(ports, 'item_category', label);
  if (f.ok && !f.existed) {
    // The old name of a built-in the owner renamed reads as that row (as itemCategoryOf reads a stored name): typed at ➕
    // or the plus chip it is that row, never a second row that would take the old name over from the renamed one.
    var old = itemCategoryOf(ports, f.label);
    if (old) f = { ok: true, existed: true, key: old.key, label: old.label };
  }
  if (!f.ok || !f.existed) return f;
  var opts = itemCategoryOptions(ports, shop);
  for (var i = 0; i < opts.length; i++) if (opts[i].key === f.key) return f;
  return { ok: false, reason: 'closed', key: f.key, label: f.label };
}

/**
 * The item categories' add: itemCategoryFind, then addListOptionByLabel for a free name. Answers as
 * addListOptionByLabel, plus the reasons 'sample' and 'closed'. Shared by every shop (Shop ''), noted
 * 'added by <name> <day>' as every ➕.
 */
function addItemCategory(ports, label, staff, shop) {
  var f = itemCategoryFind(ports, label, shop);
  if (!f.ok || f.existed) return f;
  return addListOptionByLabel(ports, 'item_category', f.label, staff);
}

/* ----------------------------- commits ----------------------------- */

function commitSale(ports, p) {
  var qty = Math.max(1, Math.round(Number(p.qty) || 1));
  var unitPrice = !nullish(p.unitPrice) ? Number(p.unitPrice)
    : (!nullish(p.amount) ? Math.round(Number(p.amount) / qty) : (Number(p.item.price) || 0));
  var amount = qty * unitPrice;
  var cash = nullish(p.paid) ? amount : Math.max(0, Math.min(amount, Math.round(Number(p.paid) || 0)));
  var tx = newTx(ports, {
    shop: p.item.shop, itemId: p.item.id, type: CFG.TX.SALE, qty: -qty, unitPrice: unitPrice,
    amount: amount, cash: cash, costAtSale: p.item.cost, customerId: p.customerId || '', note: p.note,
    method: methodFor(p.method, cash),
    source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  return writeGroup(ports, [tx]);
}

/**
 * The one-item sale of round 5, now a wrapper of commitBasket (round 6, spec 3.2): p = {item, qty, unitPrice, paid,
 * method, bankPart, mixed, customerId, dueDay, note, priceChanged, staff, source, transcript, updateId, when}. One SALE
 * row, or SALE then PAYMENT when the payment is mixed (cash part > 0 and account part > 0), in one group under one lock;
 * the rows are exactly those of round 5 (the SALE and the PAYMENT now share one time: one clock read). Returns
 * {groupId, txs, sale, payment (or null), owed}.
 */
function commitSaleGroup(ports, p) {
  var r = commitBasket(ports, {
    lines: [{ item: p.item, qty: p.qty, unitPrice: p.unitPrice, priceChanged: p.priceChanged }],
    paid: p.paid, method: p.method, bankPart: p.bankPart, mixed: p.mixed, customerId: p.customerId, dueDay: p.dueDay,
    note: p.note, staff: p.staff, source: p.source, transcript: p.transcript, updateId: p.updateId, when: p.when
  });
  return { groupId: r.groupId, txs: r.txs, sale: r.sales[0], payment: r.payment, owed: r.owed };
}

/* ----------------------------- baskets: several pieces in one sale (round 6) ----------------------------- */

/**
 * The cash of a group spread over its lines in line order (spec 3.4): cash_i = min(amount_i, max(0, cash - Σ cash_<i)).
 * Σ cash_i = cash whenever cash <= Σ amounts, and every row keeps 0 <= cash_i <= amount_i.
 */
function basketAllocate(amounts, cash) {
  var left = Math.max(0, Math.round(Number(cash) || 0)), out = [];
  for (var i = 0; i < amounts.length; i++) {
    var c = Math.min(Math.max(0, Number(amounts[i]) || 0), left);
    out.push(c);
    left -= c;
  }
  return out;
}

/**
 * Steps 2-5 of commitBasket without rows, so the app's running line, the Telegram card, basketCheck and the write all
 * agree. lines = [{qty, unitPrice}] (unitPrice null, undefined or '' = a price-pending line: amount 0, listed in
 * pending); pay = {part, paid, method, mixed, bankPart}: paid now = part ? paid : the total.
 */
function basketTotals(lines, pay) {
  pay = pay || {};
  var amounts = [], pending = [], total = 0;
  (lines || []).forEach(function (l, i) {
    var qty = Math.max(1, Math.round(Number(l.qty) || 1));
    var none = l.unitPrice === null || l.unitPrice === undefined || l.unitPrice === '';
    if (none) pending.push(i);
    var amount = none ? 0 : qty * Number(l.unitPrice);
    amounts.push(amount);
    total += amount;
  });
  var paid = pay.part ? Math.max(0, Math.min(total, Math.round(Number(pay.paid) || 0))) : total;
  var KEY = String(pay.method || CFG.METHOD.CASH).toUpperCase();
  var bankPart = (KEY === CFG.METHOD.CASH || !pay.mixed) ? 0 : Math.max(0, Math.min(paid, Math.round(Number(pay.bankPart) || 0)));
  var cashPart = paid - bankPart, owed = total - paid;
  var payKey = (pay.mixed && bankPart === 0) ? CFG.METHOD.CASH : KEY;
  var twoRows = bankPart > 0 && cashPart > 0;
  var rowCash = basketAllocate(amounts, twoRows ? cashPart : paid);
  var rowMethod = rowCash.map(function (c) { return twoRows ? (c ? CFG.METHOD.CASH : '') : methodFor(payKey, c); });
  return { amounts: amounts, total: total, paid: paid, bankPart: bankPart, cashPart: cashPart, owed: owed, payKey: payKey,
           twoRows: twoRows, rowCash: rowCash, rowMethod: rowMethod, pending: pending };
}

/**
 * The promised day of a sale that still owes, from a choice: a whole number of days 0..CFG.SALE_DUE_MAX_DAYS (a number or
 * a digit string, Burmese digits too) is that many days from today; 'none' or '' is ''; any other text is a typed date
 * (parseDayText, a yearless past date not rolled), kept only from today to today + SALE_DUE_MAX_DAYS. Else null (refused).
 */
function saleDueKey(now, choice) {
  if (choice === null || choice === undefined) return null;
  var today = dayKey(now);
  if (typeof choice === 'number') {
    return choice >= 0 && choice === Math.round(choice) && choice <= CFG.SALE_DUE_MAX_DAYS ? addDaysKey(today, choice) : null;
  }
  var s = String(choice).replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); }).trim();
  if (s === '' || s.toLowerCase() === 'none') return '';
  if (/^\d+$/.test(s)) return Number(s) <= CFG.SALE_DUE_MAX_DAYS ? addDaysKey(today, Number(s)) : null;
  var key = parseDayText(s, now, { noRoll: true });
  if (!key || key < today || daysBetweenKeys(today, key) > CFG.SALE_DUE_MAX_DAYS) return null;
  return key;
}

/** The profit of a price over a cost and its markup on the cost in percent; null unless both are whole numbers >= 1. */
function itemMargin(price, cost) {
  if (price === '' || cost === '' || nullish(price) || nullish(cost)) return null;
  var p = Number(price), c = Number(cost);
  if (!(p >= 1) || !(c >= 1) || p !== Math.round(p) || c !== Math.round(c)) return null;
  return { profit: p - c, pct: Math.round((p - c) * 100 / c) };
}

/** The name a new piece gets when nobody typed one: the one name the photo AI may replace (aiRenameFields). */
function itemPlaceholderName(id) {
  return 'ပစ္စည်း ' + id;
}

/**
 * Is this sale group a basket (more than one live SALE row) and not a custom-order delivery (which writes one SALE row per
 * voucher line into the order's group)? info = saleGroupInfo(...). The guard of every basket reader branch.
 */
function basketGroup(info) {
  return !!info && !!info.rows && info.rows.length > 1 && !isOrderId(info.groupId);
}

/**
 * The photo AI's late rename (spec 6.2), one rule on the server and the phones: null unless the item still carries its
 * placeholder name (a BLANK item, name '', and a typed name are never renamed). Pure. cats (round 6b, optional) =
 * {names, other} from itemCategoryCats: the list the AI was given and its catch-all. The category is set to the entry of
 * names that is the AI's answer (listNameKey) only when the item's category is '', the catch-all (cats.other) or the
 * word of the last of CFG.CATEGORIES (old pieces keep it after a rename). Without cats, names is CFG.CATEGORIES and the
 * catch-all its last entry: the rule of before round 6b.
 */
function aiRenameFields(item, desc, cats) {
  if (!item || !desc || !desc.name || String(item.name) !== itemPlaceholderName(item.id)) return null;
  var out = { name: String(desc.name) }, last = CFG.CATEGORIES[CFG.CATEGORIES.length - 1];
  var names = (cats && cats.names) || CFG.CATEGORIES, other = (cats && cats.other) || last;
  var hit = desc.category ? itemCategoryPick(names, desc.category) : '';
  var cur = listNameKey(item.category);
  if (hit && (!cur || cur === listNameKey(other) || cur === listNameKey(last))) out.category = hit;
  return out;
}

/**
 * A piece into a basket's lines (new arrays; lines is never changed). The basket's shop is the first line's item's shop;
 * with no line, staff.shop for a seller and the item's shop for the owner. Refusals, in this order: missing, blank,
 * other_shop, then without opts.restock gone (a UNIQUE at stock <= 0) and twice (a UNIQUE already in), with opts.restock
 * unique (any UNIQUE); then max (a new line past CFG.BASKET_MAX_LINES). A stock item already in gets qty more (merged).
 * Returns {ok: true, lines, index, merged} or {ok: false, reason, vars: {id, shop, max}}; BASKET_REASON_KEY names the key.
 */
function basketAddItem(ports, staff, lines, itemId, qty, opts) {
  opts = opts || {};
  lines = lines || [];
  var n = Math.min(CFG.MAX_SALE_QTY, Math.max(1, Math.round(Number(qty) || 1)));
  var item = ports.store.getItem(itemId), shop = '';
  if (lines.length) { var first = ports.store.getItem(lines[0].id); shop = first ? first.shop : ''; }
  else shop = staff && staff.role !== 'owner' ? staff.shop : (item ? item.shop : '');
  var vars = { id: String(itemId), shop: shopName(ports, item ? item.shop : shop), max: myDigits(CFG.BASKET_MAX_LINES) };
  var refuse = function (reason) { return { ok: false, reason: reason, vars: vars }; };
  if (!item) return refuse('missing');
  if (item.status === CFG.STATUS.BLANK) return refuse('blank');
  if (item.shop !== shop) return refuse('other_shop');
  var at = -1, i;
  for (i = 0; i < lines.length; i++) if (lines[i].id === item.id) at = i;
  var unique = item.type === CFG.ITEM_TYPE.UNIQUE;
  if (!opts.restock) {
    if (unique && Number(item.stock) <= 0) return refuse('gone');
    if (unique && at >= 0) return refuse('twice');
  } else if (unique) return refuse('unique');
  if (at < 0 && lines.length >= CFG.BASKET_MAX_LINES) return refuse('max');
  var out = lines.map(function (l) { return { id: l.id, qty: l.qty, unitPrice: l.unitPrice, priceChanged: !!l.priceChanged }; });
  if (at >= 0) {
    out[at].qty = Math.min(CFG.MAX_SALE_QTY, (Math.round(Number(out[at].qty)) || 1) + n);
    return { ok: true, lines: out, index: at, merged: true };
  }
  out.push({ id: item.id, qty: unique ? 1 : n, unitPrice: Number(item.price) > 0 ? Number(item.price) : null, priceChanged: false });
  return { ok: true, lines: out, index: out.length - 1, merged: false };
}

/** The message key of each basketAddItem reason. */
var BASKET_REASON_KEY = { missing: 'tag_not_found', blank: 'basket_blank', other_shop: 'basket_other_shop', gone: 'basket_gone',
  twice: 'basket_twice', unique: 'basket_unique', max: 'basket_max' };

/**
 * The Save-time check shared by the app's sale form and the Telegram review card (spec 4.2). draft = {lines: [{id, qty,
 * unitPrice, priceChanged}], customerId, newName, newPhone, method, mixed, bankPart, part, paid, dueDay, needAccount};
 * every line is re-read. Returns {ok, problems: [{code, id, key, vars}], totals} with the problems in the order of the
 * spec (the first is what the seller sees). opts.pendingMethod skips the method check (an account typed in the form, written
 * at Save).
 */
function basketCheck(ports, staff, draft, opts) {
  opts = opts || {};
  draft = draft || {};
  var problems = [], lines = draft.lines || [], today = dayKey(ports.clock.now());
  var add = function (code, key, vars, id) { problems.push({ code: code, id: id || '', key: key, vars: vars || {} }); };
  if (saleFlow(ports) !== CFG.SALE_FLOW.FORM) add('mode', 'expired');
  if (!lines.length) add('empty', 'scan_first');
  var first = lines.length ? ports.store.getItem(lines[0].id) : null;
  var shop = staff && staff.role !== 'owner' ? staff.shop : (first ? first.shop : '');
  var seen = {};
  lines.forEach(function (l) {
    var it = ports.store.getItem(l.id), q = Number(l.qty);
    var vars = { id: String(l.id), shop: shopName(ports, it ? it.shop : shop), max: myDigits(CFG.MAX_SALE_QTY) };
    if (!it) add('missing', 'tag_not_found', vars, l.id);
    else if (it.status === CFG.STATUS.BLANK) add('blank', 'basket_blank', vars, l.id);
    else if (it.shop !== shop) add('other_shop', 'basket_other_shop', vars, l.id);
    else if (it.type === CFG.ITEM_TYPE.UNIQUE && Number(it.stock) <= 0) add('gone', 'basket_line_gone', vars, l.id);
    else if (seen['i:' + l.id]) add('twice', 'basket_twice', vars, l.id);
    else if (nullish(l.unitPrice) || l.unitPrice === '' || !(Number(l.unitPrice) >= 1)) add('need_price', 'basket_need_price', vars, l.id);
    else if (!(q >= 1 && q <= CFG.MAX_SALE_QTY && q === Math.round(q))) add('qty', 'bad_qty', vars, l.id);
    seen['i:' + l.id] = true;
  });
  if (lines.length > CFG.BASKET_MAX_LINES) add('max', 'basket_max', { max: myDigits(CFG.BASKET_MAX_LINES) });
  var key = String(draft.method || CFG.METHOD.CASH).toUpperCase();
  // A retired account (a pull made it inactive) is offered no more: payMethods lists the shop's active accounts only.
  if (!opts.pendingMethod && key !== CFG.METHOD.CASH && payMethods(ports, shop).indexOf(key) < 0) add('method', 'basket_method_gone');
  if (draft.needAccount && key === CFG.METHOD.CASH) add('account', draft.needAccount === 'all' ? 'sale_ask_split_account' : 'sale_ask_account');
  var noPaid = !!draft.part && (nullish(draft.paid) || draft.paid === '');
  var T = basketTotals(lines, { part: !!draft.part && !noPaid, paid: draft.paid, method: draft.method, mixed: draft.mixed, bankPart: draft.bankPart });
  var paidNow = draft.part && !noPaid ? Math.round(Number(draft.paid)) : T.total, bank = Number(draft.bankPart);
  if (draft.mixed && !(bank >= 1 && bank <= paidNow && bank === Math.round(bank))) add('transfer', 'sale_bad_amount', { min: fmtMoney(1), max: fmtMoney(paidNow) });
  var owed = noPaid ? T.total : T.owed;
  if (noPaid) add('paid_none', 'sale_ask_paid', { total: fmtMoney(T.total) });
  else if (draft.part) {
    var min = draft.mixed ? (Number(draft.bankPart) || 0) : 0, p = Number(draft.paid);
    if (!(p >= min && p <= T.total - 1 && p === Math.round(p))) add('paid', 'sale_bad_amount', { min: fmtMoney(min), max: fmtMoney(T.total - 1) });
  }
  if (owed > 0 && !draft.customerId && !draft.newName) add('need_buyer', 'sale_need_buyer');
  if (!draft.customerId && draft.newName) {
    var digits = normPhone(draft.newPhone);
    if (digits.length >= 1 && digits.length <= 6) add('phone', 'basket_bad_phone');
  }
  if (owed > 0 && nullish(draft.dueDay)) add('due_none', 'sale_ask_due', { owed: fmtMoney(owed) });
  else if (owed > 0 && draft.dueDay !== '') {
    var d = String(draft.dueDay);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today || daysBetweenKeys(today, d) > CFG.SALE_DUE_MAX_DAYS) add('due', 'ord_bad_date');
  }
  return { ok: !problems.length, problems: problems, totals: T };
}

/**
 * The Credits name of a basket: basket_name with the item names of its live SALE rows in row order, each cut to
 * CFG.BASKET_NAME_MAX characters (with '…'), the first three joined by ', ', then ', …' when there are more.
 */
function basketName(ports, info) {
  var names = info.rows.map(function (r) {
    var it = ports.store.getItem(r.itemId), n = it ? String(it.name || r.itemId) : String(r.itemId);
    return n.length > CFG.BASKET_NAME_MAX ? n.slice(0, CFG.BASKET_NAME_MAX - 1) + '…' : n;
  });
  return t(ports, 'basket_name', { n: fmtCount(names.length), names: names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '') });
}

/**
 * The open credit a returned piece would leave behind (spec 1.10): its last live SALE's group, when that is not a custom
 * order, not voided and still owes. {groupId, customerId, owed} or null. case 'T' refuses a return while it is set.
 */
function creditOpenFor(ports, itemId) {
  var s = lastLiveSale(ports, itemId), info = s ? saleGroupInfo(ports, s.groupId) : null;
  if (!info || isOrderId(info.groupId) || info.voided || !(info.owed > 0)) return null;
  return { groupId: info.groupId, customerId: info.customerId, owed: info.owed };
}

/**
 * A new piece's group (one live RESTOCK row noted 'new item' or 'new sample'): {itemId, used} where used = the piece has a
 * live row in any other group (sold, moved, restocked, returned); null for any other group.
 */
function newItemUndoInfo(ports, groupId) {
  var g = groupRows(ports, groupId);
  if (g.live.length !== 1) return null;
  var r = g.live[0];
  if (r.type !== CFG.TX.RESTOCK || (r.note !== 'new item' && r.note !== 'new sample')) return null;
  var others = liveRows(g.all.filter(function (x) { return x.itemId === r.itemId && x.groupId !== groupId; }), g.all);
  return { itemId: r.itemId, used: others.length > 0 };
}

/**
 * The one write of a sale of one or more pieces (spec 3.2): p = {lines: [{item, qty, unitPrice, priceChanged}], paid,
 * method, bankPart, mixed, customerId, dueDay, note, staff, source, transcript, updateId, when}. One clock read; one SALE
 * row per line in line order (cash filled in line order, the buyer on every row, DueDay on every SALE row while the group
 * owes), then at most one PAYMENT (the transfer part of a mixed payment, after every SALE row); one writeGroup. Throws on
 * no line or more than CFG.BASKET_MAX_LINES (a programming error: basketCheck refuses them first).
 * Returns {groupId, txs, sales, payment (or null), owed, total}.
 */
function commitBasket(ports, p) {
  var lines = p.lines || [];
  if (!lines.length || lines.length > CFG.BASKET_MAX_LINES) throw new Error('commitBasket: ' + lines.length + ' lines');
  var when = p.when instanceof Date ? p.when : ports.clock.now();
  var units = lines.map(function (l) {
    return { qty: Math.max(1, Math.round(Number(l.qty) || 1)), unitPrice: nullish(l.unitPrice) ? (Number(l.item.price) || 0) : Number(l.unitPrice) };
  });
  var T = basketTotals(units, { part: !nullish(p.paid), paid: p.paid, method: p.method, mixed: p.mixed, bankPart: p.bankPart });
  var KEY = String(p.method || CFG.METHOD.CASH).toUpperCase();
  var groupNote = p.note || (T.twoRows ? 'split' : T.owed > 0 ? 'credit' : '');
  var dueDay = T.owed > 0 ? (p.dueDay || '') : '';
  var sales = [], groupId = '';
  lines.forEach(function (l, i) {
    var tx = newTx(ports, {
      groupId: groupId, shop: l.item.shop, itemId: l.item.id, type: CFG.TX.SALE, qty: -units[i].qty, unitPrice: units[i].unitPrice,
      amount: T.amounts[i], cash: T.rowCash[i], costAtSale: l.item.cost, customerId: p.customerId || '', refGroupId: '',
      note: groupNote || (l.priceChanged ? 'price' : ''), method: T.rowMethod[i], dueDay: dueDay,
      source: p.source, transcript: i === 0 ? p.transcript : '', staffId: p.staff.id, updateId: p.updateId, when: when
    });
    if (!groupId) groupId = tx.groupId;
    sales.push(tx);
  });
  var payment = null;
  if (T.twoRows) {
    // After every SALE row: the server checks a PAYMENT against what the shadow ledger says is owed.
    payment = newTx(ports, {
      groupId: groupId, shop: lines[0].item.shop, itemId: lines[0].item.id, type: CFG.TX.PAYMENT, qty: 0, unitPrice: null,
      amount: T.bankPart, cash: T.bankPart, customerId: p.customerId || '', refGroupId: groupId, note: 'split', method: KEY,
      source: p.source, staffId: p.staff.id, updateId: p.updateId, when: when
    });
  }
  var r = writeGroup(ports, sales.concat(payment ? [payment] : []));
  return { groupId: r.groupId, txs: r.txs, sales: sales, payment: payment, owed: T.owed, total: T.total };
}

/**
 * A blank tag registered as a new piece of `count` (spec 3.6): p = {itemId, name, category, categoryKey, price, cost, count, sample,
 * photoUrl, photoFileId, staff, source, updateId, when}. Refusals (nothing written): missing, not_blank (registered
 * meanwhile), other_shop (a seller's tag of another shop), count (not a whole 1..999), price (absent, or neither '' nor a
 * whole number >= 0), cost (neither ''/absent nor a whole number >= 0). A price of 0 is stored '' (pending); an empty name
 * becomes the placeholder. The category (round 6b): p.categoryKey (optional), the key of the row the seller chose, is
 * stored with that row's current label (an owner's rename while the card was open keeps the choice); else a name that
 * matches an item_category row, active or retired (a built-in's old name included, itemCategoryOf), is stored with the
 * row's current label; '' or an unknown name gets the catch-all (itemCategoryFallback). The channels offer no retired
 * category; a card drawn before an untick may still pass one, and it is stored. One clock read; the Items fields of the chat
 * flow (count > 1: SKU, else UNIQUE) and ONE RESTOCK of count. The caller pings the owner while the price is pending.
 * Returns {ok: true, item, groupId, pending} or {ok: false, reason}.
 */
function commitNewItem(ports, p) {
  var item = ports.store.getItem(p.itemId);
  if (!item) return { ok: false, reason: 'missing' };
  if (item.status !== CFG.STATUS.BLANK) return { ok: false, reason: 'not_blank' };
  if (p.staff.role !== 'owner' && item.shop !== p.staff.shop) return { ok: false, reason: 'other_shop' };
  var count = nullish(p.count) ? 1 : Number(p.count);
  if (!(count >= 1 && count <= CFG.MAX_SALE_QTY && count === Math.round(count))) return { ok: false, reason: 'count' };
  var whole = function (v) { var n = Number(v); return v !== '' && typeof v !== 'boolean' && !nullish(v) && n >= 0 && n === Math.round(n); };
  if (nullish(p.price) || (p.price !== '' && !whole(p.price))) return { ok: false, reason: 'price' };
  if (!nullish(p.cost) && p.cost !== '' && !whole(p.cost)) return { ok: false, reason: 'cost' };
  var price = p.price === '' || Number(p.price) === 0 ? '' : Number(p.price);
  var cost = nullish(p.cost) || p.cost === '' ? '' : Number(p.cost);
  var name = String(p.name || '').trim() || itemPlaceholderName(item.id);
  var catRow = null, catKey = listNormKey('item_category', p.categoryKey), catRows = catKey ? itemCategoryRows(ports) : [];
  for (var ck = 0; ck < catRows.length && !catRow; ck++) if (catRows[ck].key === catKey) catRow = catRows[ck];
  if (!catRow) catRow = itemCategoryOf(ports, p.category);
  var category = catRow ? catRow.label : itemCategoryFallback(ports);
  var when = p.when instanceof Date ? p.when : ports.clock.now();
  ports.store.updateItem(item.id, {
    name: name, category: category, type: count > 1 ? CFG.ITEM_TYPE.SKU : CFG.ITEM_TYPE.UNIQUE, price: price, cost: cost,
    sample: !!p.sample, photoUrl: p.photoUrl || '', photoFileId: p.photoFileId || '', createdAt: when.toISOString(), createdBy: p.staff.id
  });
  var r = commitRestock(ports, { item: ports.store.getItem(item.id), qty: count, note: p.sample ? 'new sample' : 'new item',
    source: p.source || CFG.SOURCE.PHOTO, staff: p.staff, updateId: p.updateId, when: when });
  return { ok: true, item: ports.store.getItem(item.id), groupId: r.groupId, pending: price === '' };
}

/**
 * A restock of several stock items in one group (spec 3.7): p = {lines: [{item, qty}], note, staff, source, updateId,
 * when}. Refusals (nothing written): empty, max, qty (not a whole 1..999), unique, blank, other_shop (two shops, or a
 * seller's line of another shop). One clock read, one RESTOCK row per line in commitRestock's shape, one writeGroup.
 * Returns {ok: true, groupId, txs} or {ok: false, reason}.
 */
function commitRestockGroup(ports, p) {
  var lines = p.lines || [];
  if (!lines.length) return { ok: false, reason: 'empty' };
  if (lines.length > CFG.BASKET_MAX_LINES) return { ok: false, reason: 'max' };
  var items = lines.map(function (l) { return ports.store.getItem(l.item.id) || l.item; });
  var shop = items[0].shop, i, q;
  for (i = 0; i < lines.length; i++) {
    q = Number(lines[i].qty);
    if (!(q >= 1 && q <= CFG.MAX_SALE_QTY && q === Math.round(q))) return { ok: false, reason: 'qty' };
  }
  for (i = 0; i < items.length; i++) if (items[i].type === CFG.ITEM_TYPE.UNIQUE) return { ok: false, reason: 'unique' };
  for (i = 0; i < items.length; i++) if (items[i].status === CFG.STATUS.BLANK) return { ok: false, reason: 'blank' };
  for (i = 0; i < items.length; i++) {
    if (items[i].shop !== shop || (p.staff.role !== 'owner' && items[i].shop !== p.staff.shop)) return { ok: false, reason: 'other_shop' };
  }
  var when = p.when instanceof Date ? p.when : ports.clock.now(), groupId = '', txs = [];
  items.forEach(function (it, k) {
    var tx = newTx(ports, {
      groupId: groupId, shop: it.shop, itemId: it.id, type: CFG.TX.RESTOCK, qty: Number(lines[k].qty), unitPrice: null, amount: 0, cash: 0,
      note: p.note, source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: when
    });
    if (!groupId) groupId = tx.groupId;
    txs.push(tx);
  });
  var r = writeGroup(ports, txs);
  return { ok: true, groupId: r.groupId, txs: r.txs };
}

/**
 * The tag of an undone new piece blank again (spec 3.6): ONE updateItem that empties every column a blank tag has empty,
 * so its status reads BLANK and it can be registered again. Only case 'U' calls it, after the mirror of an unused new piece.
 */
function unregisterItem(ports, itemId) {
  ports.store.updateItem(itemId, { name: '', category: '', type: '', price: '', cost: '', sample: false, photoUrl: '', photoFileId: '',
    createdAt: '', createdBy: '' });
}

function commitRestock(ports, p) {
  var qty = Math.max(1, Math.round(Number(p.qty) || 1));
  var tx = newTx(ports, {
    shop: p.item.shop, itemId: p.item.id, type: CFG.TX.RESTOCK, qty: qty, unitPrice: null, amount: 0, cash: 0,
    note: p.note, source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  return writeGroup(ports, [tx]);
}

function commitReturn(ports, p) {
  var qty = Math.max(1, Math.round(Number(p.qty) || 1));
  var unitPrice = !nullish(p.unitPrice) ? Number(p.unitPrice)
    : (!nullish(p.amount) ? Math.round(Number(p.amount) / qty) : (Number(p.item.price) || 0));
  var amount = -(qty * unitPrice);
  var cash = nullish(p.refund) ? amount : -Math.abs(Math.round(Number(p.refund) || 0));
  var tx = newTx(ports, {
    shop: p.item.shop, itemId: p.item.id, type: CFG.TX.RETURN, qty: qty, unitPrice: unitPrice,
    amount: amount, cash: cash, costAtSale: p.item.cost, customerId: p.customerId || '', note: p.note,
    method: methodFor(p.method, cash),
    source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  return writeGroup(ports, [tx]);
}

/** p.category = expense category key (Settings expense_categories), p.method = CASH/KBZ/WAVE/BANK. */
function commitExpense(ports, p) {
  var amount = -Math.abs(Math.round(Number(p.amount) || 0));
  var tx = newTx(ports, {
    shop: p.shop, itemId: '', type: CFG.TX.EXPENSE, qty: 0, unitPrice: null, amount: amount, cash: amount,
    note: p.note || '', category: p.category ? String(p.category).toLowerCase() : '', method: methodFor(p.method, amount),
    source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  return writeGroup(ports, [tx]);
}

/** Moves the tag (and all its stock) to the other shop. */
function commitTransfer(ports, p) {
  var fromShop = p.item.shop, toShop = p.toShop || otherShop(fromShop);
  var qty = Math.max(0, Number(p.item.stock) || 0);
  var out = newTx(ports, {
    shop: fromShop, itemId: p.item.id, type: CFG.TX.TRANSFER_OUT, qty: -qty, unitPrice: null, amount: 0, cash: 0,
    note: 'to ' + toShop, source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  var inn = newTx(ports, {
    shop: toShop, itemId: p.item.id, type: CFG.TX.TRANSFER_IN, qty: qty, unitPrice: null, amount: 0, cash: 0,
    note: 'from ' + fromShop, source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  var r = writeGroup(ports, [out, inn]);
  ports.store.updateItem(p.item.id, { shop: toShop });
  return r;
}

/** Cash received later against a credit sale (p.groupId). Capped at what is still owed. */
function commitPayment(ports, p) {
  var info = p.groupId ? saleGroupInfo(ports, p.groupId) : null;
  var amount = Math.round(Number(p.amount) || 0);
  if (info && info.owed > 0) amount = Math.min(amount, info.owed);
  if (amount <= 0) throw new Error('Payment amount must be positive');
  var tx = newTx(ports, {
    shop: p.shop || (info && info.shop), itemId: info ? info.itemId : '', type: CFG.TX.PAYMENT, qty: 0, unitPrice: null,
    amount: amount, cash: amount, customerId: p.customerId || (info && info.customerId) || '', refGroupId: p.groupId || '',
    note: p.note || '', method: methodFor(p.method, amount),
    source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  return writeGroup(ports, [tx]);
}

/**
 * Cash received in advance for an order. Held until a sale applies it. p.refGroupId = the voucher id
 * (V1-2532) earmarks the advance to that order; without it the money joins the customer's free pool.
 */
function commitDeposit(ports, p) {
  var amount = Math.round(Number(p.amount) || 0);
  if (amount <= 0) throw new Error('Deposit amount must be positive');
  var tx = newTx(ports, {
    shop: p.shop, itemId: '', type: CFG.TX.DEPOSIT, qty: 0, unitPrice: null, amount: amount, cash: amount,
    customerId: p.customerId, refGroupId: p.refGroupId || '', note: p.note || '', method: methodFor(p.method, amount),
    source: p.source, transcript: p.transcript, staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  return writeGroup(ports, [tx]);
}

/**
 * Consume a held deposit against a sale. The row joins the sale's group so that
 * undoing the sale also returns the deposit. Returns {amount, groupId} or null.
 * Only the customer's FREE pool is used (plus the earmark of p.orderId when given): an advance
 * earmarked to an open voucher (DEPOSIT with RefGroupID = order id) is never eaten by another sale.
 */
function applyDeposit(ports, p) {
  var info = saleGroupInfo(ports, p.groupId);
  if (!info || info.voided) return null;
  var customerId = p.customerId || info.customerId;
  var held = p.orderId ? depositsAvailable(ports, customerId, p.orderId) : depositsFree(ports, customerId);
  var amount = Math.min(held, info.owed, nullish(p.amount) ? Infinity : Number(p.amount));
  amount = Math.round(amount);
  if (amount <= 0) return null;
  var tx = newTx(ports, {
    groupId: info.groupId, shop: info.shop, itemId: info.itemId, type: CFG.TX.DEPOSIT_APPLIED, qty: 0, unitPrice: null,
    amount: amount, cash: 0, customerId: customerId, refGroupId: info.groupId, note: 'deposit', source: p.source,
    staffId: p.staff.id, updateId: p.updateId, when: p.when
  });
  writeGroup(ports, [tx]);
  return { amount: amount, groupId: info.groupId };
}

/* ----------------------------- live rows, undo, rewrite ----------------------------- */

/** Set of txIds that some row reverses. */
function reversedIdSet(all) {
  var s = {};
  all.forEach(function (r) { if (r.reversesTxId) s[r.reversesTxId] = true; });
  return s;
}

/**
 * Rows that neither reverse another row nor are reversed by one. `all` (the whole ledger)
 * is needed when the reversing rows may live outside `rows`; it defaults to `rows`.
 */
function liveRows(rows, all) {
  var reversed = reversedIdSet(all || rows);
  return rows.filter(function (r) { return !r.reversesTxId && !reversed[r.txId]; });
}

/** {all, rows, live} for one group. */
function groupRows(ports, groupId) {
  var all = ports.store.ledgerRows();
  var rows = all.filter(function (r) { return r.groupId === groupId; });
  return { all: all, rows: rows, live: liveRows(rows, all) };
}

/**
 * Reverse every live row of a group by appending mirror rows.
 * Returns {ok:true} or {ok:false, reason:'expired'|'already'|'missing'|'locked'}.
 * 'locked' (round 6): a later payment was taken against the group (a live PAYMENT row of ANOTHER group whose RefGroupID is
 * this one, as rewriteCheck's 'locked'); reversing it would leave that payment with no credit to pay, so neither the undo
 * nor the owner's void (opts.force) writes anything until that payment is voided. The group's own PAYMENT (a split) is not.
 * opts.force skips the time window (owner void, credit conversion); opts.note replaces 'undo'.
 */
function undoGroup(ports, groupId, staff, now, opts) {
  now = now || ports.clock.now();
  opts = opts || {};
  var g = groupRows(ports, groupId);
  if (!g.rows.length) return { ok: false, reason: 'missing' };
  var rows = g.live;
  if (!rows.length) return { ok: false, reason: 'already' };
  var reversed = reversedIdSet(g.all);
  var paidLater = g.all.some(function (r) {
    return r.type === CFG.TX.PAYMENT && r.refGroupId === groupId && r.groupId !== groupId && !r.reversesTxId && !reversed[r.txId];
  });
  if (paidLater) return { ok: false, reason: 'locked' };
  var ageMin = (now.getTime() - new Date(rows[0].time).getTime()) / 60000;
  if (!opts.force && ageMin > CFG.UNDO_WINDOW_MIN) return { ok: false, reason: 'expired' };

  // Mirrors stay in the group they reverse, so the group's own sums (total, cash, deposit
  // applied) net to zero and an undone credit sale no longer counts as owed. They copy the
  // Method and Category so the per-method and per-category totals net out as well.
  var mirrors = rows.map(function (r) {
    return newTx(ports, {
      groupId: r.groupId, shop: r.shop, itemId: r.itemId, type: r.type, qty: -r.qty, unitPrice: r.unitPrice === '' ? null : r.unitPrice,
      amount: -r.amount, cash: -r.cash, costAtSale: r.costAtSale, customerId: r.customerId, refGroupId: r.refGroupId,
      method: r.method, category: r.category,
      note: opts.note || 'undo', source: CFG.SOURCE.UNDO, staffId: staff.id, reversesTxId: r.txId, when: now
    });
  });
  var r0 = writeGroup(ports, mirrors);
  var outRow = rows.filter(function (r) { return r.type === CFG.TX.TRANSFER_OUT; })[0];
  if (outRow) ports.store.updateItem(outRow.itemId, { shop: outRow.shop });
  return { ok: true, groupId: r0.groupId, itemId: rows[0].itemId, types: rows.map(function (r) { return r.type; }) };
}

/** Owner-only: reverse a group at any age (not one a later payment locks: undoGroup's 'locked'). Source UNDO, note 'void by owner'. */
function voidGroup(ports, groupId, staff) {
  return undoGroup(ports, groupId, staff, null, { force: true, note: 'void by owner' });
}

/**
 * Can this group be rewritten (one field corrected in place)? {ok, row, reason}.
 * Conditions: exactly one live row, of a rewritable type, from today, with no live PAYMENT
 * referencing the group (a DEPOSIT_APPLIED row in the group already makes it 'complex').
 */
function rewriteCheck(ports, groupId, now) {
  now = now || ports.clock.now();
  var g = groupRows(ports, groupId);
  if (!g.rows.length) return { ok: false, reason: 'missing' };
  if (!g.live.length) return { ok: false, reason: 'already' };
  if (g.live.length !== 1) return { ok: false, reason: 'complex' };
  var row = g.live[0];
  if (!CFG.REWRITABLE_TX[row.type]) return { ok: false, reason: 'type' };
  var reversed = reversedIdSet(g.all);
  var attached = g.all.some(function (r) {
    return r.type === CFG.TX.PAYMENT && r.refGroupId === groupId && !r.reversesTxId && !reversed[r.txId];
  });
  if (attached) return { ok: false, reason: 'locked' };
  if (dayKey(now) !== row.day) return { ok: false, reason: 'expired' };
  return { ok: true, row: row, all: g.all };
}

/**
 * The two rows of a rewrite, not yet written: [mirror, replacement] for the given live row. The mirror
 * (Note 'rewrite') reverses the row; the replacement copies every field, applies the changes (method,
 * customerId, cash, note, category) and keeps the original Time/Day and receipt number.
 * opts: {source, transcript, noteIfBlank}. rewriteGroup and splitSale write them.
 */
function rewriteRows(ports, row, changes, staff, updateId, opts) {
  opts = opts || {};
  changes = changes || {};
  var now = ports.clock.now();
  var has = function (k) { return Object.prototype.hasOwnProperty.call(changes, k) && changes[k] !== undefined; };
  var cash = has('cash') ? Math.round(Number(changes.cash) || 0) : row.cash;
  if (row.type === CFG.TX.SALE) cash = Math.max(0, Math.min(row.amount, cash));
  var method = has('method') ? changes.method : row.method;
  var note = has('note') ? changes.note : row.note;
  if (!note && opts.noteIfBlank) note = opts.noteIfBlank;
  var mirror = newTx(ports, {
    groupId: row.groupId, shop: row.shop, itemId: row.itemId, type: row.type, qty: -row.qty, unitPrice: row.unitPrice === '' ? null : row.unitPrice,
    amount: -row.amount, cash: -row.cash, costAtSale: row.costAtSale, customerId: row.customerId, refGroupId: row.refGroupId,
    method: row.method, category: row.category,
    note: 'rewrite', source: CFG.SOURCE.UNDO, staffId: staff.id, reversesTxId: row.txId, when: now
  });
  var replacement = newTx(ports, {
    groupId: row.groupId, shop: row.shop, itemId: row.itemId, type: row.type, qty: row.qty, unitPrice: row.unitPrice === '' ? null : row.unitPrice,
    amount: row.amount, cash: cash, costAtSale: row.costAtSale,
    customerId: has('customerId') ? changes.customerId : row.customerId, refGroupId: row.refGroupId,
    method: methodFor(method, cash), category: has('category') ? changes.category : row.category,
    note: note, source: opts.source || CFG.SOURCE.BUTTON, transcript: opts.transcript || row.transcript,
    staffId: staff.id, updateId: updateId, receiptNo: row.receiptNo, dueDay: has('dueDay') ? changes.dueDay : row.dueDay,
    when: new Date(row.time)
  });
  return [mirror, replacement];
}

/**
 * Rewrite the one live row of a group: append a mirror (Note 'rewrite') and a replacement that
 * copies every field, applies `changes` (method, customerId, cash, note, category) and keeps the
 * original Time/Day, all in the SAME group. opts: {source, transcript, noteIfBlank}.
 * Returns {ok:true, groupId, txs:[mirror, replacement], row} or {ok:false, reason}.
 */
function rewriteGroup(ports, groupId, changes, staff, updateId, opts) {
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return chk;
  var pair = rewriteRows(ports, chk.row, changes, staff, updateId, opts);
  var r = writeGroup(ports, pair);
  return { ok: true, groupId: r.groupId, txs: r.txs, row: pair[1] };
}

/**
 * One sale, part cash and part into ONE account (a split is always cash plus one account). bankPart of
 * the sale's cash is recorded as paid with the account key in method; the rest stays (or becomes) cash.
 * One write, in the sale's own group, in this order: the mirror of the live SALE row, its replacement with
 * Cash = the cash part and Method CASH (same receipt number, Time and Day), and a PAYMENT row with
 * Amount = Cash = the bank part, Method = the account, RefGroupID = the group. That is the shape a
 * custom-order delivery has, so owed, credits, by-method totals, receipts, undo and the sync server
 * already read it; the PAYMENT must come after the SALE row (the server checks a payment against what is owed).
 * Returns {ok: true, full: false, groupId, cashPart, bankPart, method, cashMethod: 'CASH'};
 * when the bank part covers the whole payment it is a plain method change (nothing at all when the sale is
 * already on that account): {ok, reason, full: true, groupId, method, bankPart, cashPart: 0};
 * or {ok: false, reason}: the rewriteCheck reasons, 'type' (not a sale with cash), 'method' (CASH, an
 * unknown key, or another account than the one the sale is already marked with), 'amount'.
 */
function splitSale(ports, groupId, bankPart, method, staff, updateId, source) {
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return { ok: false, reason: chk.reason };
  var row = chk.row;
  if (row.type !== CFG.TX.SALE || !(row.cash > 0)) return { ok: false, reason: 'type' };
  var key = String(method === null || method === undefined ? '' : method).trim().toUpperCase(), was = methodOf(row);
  if (!key || key === CFG.METHOD.CASH || !methodKnown(ports, key) || (was !== CFG.METHOD.CASH && key !== was)) {
    return { ok: false, reason: 'method' };
  }
  var bank = Math.round(Number(bankPart));
  if (!isFinite(bank) || bank <= 0) return { ok: false, reason: 'amount' };
  if (bank >= row.cash) {
    var full = { ok: true, reason: '', full: true, groupId: groupId, method: key, bankPart: row.cash, cashPart: 0 };
    if (was === key) return full;
    var rw = rewriteGroup(ports, groupId, { method: key }, staff, updateId, { noteIfBlank: 'method', source: source });
    full.ok = rw.ok;
    full.reason = rw.ok ? '' : rw.reason;
    return full;
  }
  var pair = rewriteRows(ports, row, { cash: row.cash - bank, method: CFG.METHOD.CASH }, staff, updateId, { noteIfBlank: 'split', source: source });
  var payment = newTx(ports, {
    groupId: groupId, shop: row.shop, itemId: row.itemId, type: CFG.TX.PAYMENT, qty: 0, unitPrice: null, amount: bank, cash: bank,
    customerId: row.customerId, refGroupId: groupId, note: 'split', method: key, staffId: staff.id,
    source: source || CFG.SOURCE.BUTTON, updateId: updateId
  });
  writeGroup(ports, [pair[0], pair[1], payment]);
  return { ok: true, full: false, groupId: groupId, cashPart: row.cash - bank, bankPart: bank, method: key, cashMethod: CFG.METHOD.CASH };
}

/**
 * Rewrite a just-made sale as a credit sale: same group, cash = what was actually received,
 * customer attached. Time and Day stay those of the sale.
 */
function convertSaleToCredit(ports, groupId, paidNow, customerId, staff, updateId) {
  var info = saleGroupInfo(ports, groupId);
  if (!info || info.voided) return { ok: false, reason: 'missing' };
  var r = rewriteGroup(ports, groupId, { cash: paidNow, customerId: customerId, note: 'credit' }, staff, updateId);
  if (!r.ok) return r;
  return { ok: true, groupId: r.groupId, txs: r.txs };
}

/* ----------------------------- credit and deposit lookups ----------------------------- */

/** Everything about one sale group: total, cash, payments, deposit used, owed. Null if not a sale. */
function saleGroupInfo(ports, groupId) {
  var all = ports.store.ledgerRows();
  var rows = all.filter(function (r) { return r.groupId === groupId; });
  // Rows written before mirrors joined their group (older data) reverse group rows from outside; count them too.
  var ids = {};
  rows.forEach(function (r) { ids[r.txId] = true; });
  all.forEach(function (r) { if (r.reversesTxId && ids[r.reversesTxId] && r.groupId !== groupId) rows.push(r); });
  var saleRows = rows.filter(function (r) { return r.type === CFG.TX.SALE; });
  if (!saleRows.length) return null;
  var live = liveRows(saleRows, all);
  var total = 0, cash = 0, applied = 0, payments = 0, qty = 0;
  saleRows.forEach(function (r) { total += r.amount; cash += r.cash; qty -= r.qty; });
  rows.forEach(function (r) { if (r.type === CFG.TX.DEPOSIT_APPLIED) applied += r.amount; });
  all.forEach(function (r) { if (r.type === CFG.TX.PAYMENT && r.refGroupId === groupId) payments += r.amount; });
  var first = live[0] || saleRows[0];
  return {
    groupId: groupId, rows: live, origin: saleRows[0], shop: first.shop, day: first.day, time: first.time, itemId: first.itemId,
    customerId: first.customerId, qty: qty, unitPrice: first.unitPrice, total: total, cash: cash, method: methodOf(first),
    // The first dated live SALE row, then any dated SALE row (round 6: a basket dates every row; one line of insurance).
    dueDay: firstDueDay(live) || firstDueDay(saleRows),
    applied: applied, payments: payments, owed: total - cash - applied - payments, voided: total <= 0,
    // The SALE rows that were live before an undo voided the group (a receipt still lists them).
    voidedRows: saleRows.filter(function (r) { return !r.reversesTxId && undoneBy(all, r.txId); })
  };
}

/** The first non-blank dueDay of the rows, else ''. */
function firstDueDay(rows) {
  for (var i = 0; i < rows.length; i++) if (rows[i].dueDay) return rows[i].dueDay;
  return '';
}

/** The row that reverses txId through an undo or void (not a rewrite), or null. */
function undoneBy(all, txId) {
  for (var i = 0; i < all.length; i++) {
    if (all[i].reversesTxId === txId && all[i].note !== 'rewrite') return all[i];
  }
  return null;
}

/**
 * How a sale group was paid: [{method, amount}] over its live SALE rows (cash now) and the live
 * PAYMENT rows that reference it, so a receipt can say "ငွေသား 6,000 · KBZPay 6,000".
 */
function groupMethods(ports, groupId) {
  var all = ports.store.ledgerRows(), reversed = reversedIdSet(all), sums = {}, order = [];
  all.forEach(function (r) {
    if (r.reversesTxId || reversed[r.txId] || !r.cash) return;
    var isSale = r.type === CFG.TX.SALE && r.groupId === groupId;
    var isPay = r.type === CFG.TX.PAYMENT && r.refGroupId === groupId;
    if (!isSale && !isPay) return;
    var key = methodOf(r);
    if (!(key in sums)) { sums[key] = 0; order.push(key); }
    sums[key] += r.cash;
  });
  return order.map(function (k) { return { method: k, amount: sums[k] }; }).filter(function (m) { return m.amount > 0; });
}

/** The live SALE row that last moved an item out (who bought this piece), or null. */
function lastLiveSale(ports, itemId) {
  var all = ports.store.ledgerRows();
  var sales = liveRows(all.filter(function (r) { return r.type === CFG.TX.SALE && r.itemId === itemId; }), all);
  return sales.length ? sales[sales.length - 1] : null;
}

/**
 * Is a credit overdue? A dated credit (DueDay on its SALE row) is overdue the day after its date; an undated one
 * after CFG.OVERDUE_DAYS days. today = dayKey(now).
 */
function creditOverdue(dueDay, days, today) {
  return dueDay ? today > dueDay : days >= CFG.OVERDUE_DAYS;
}

/** Sales with money still owed, oldest first. shop null = all shops. */
function openCredits(ports, shop) {
  var all = ports.store.ledgerRows(), out = [], now = ports.clock.now(), today = dayKey(now);
  // One pass to find the groups that can owe anything: their SALE rows (mirrors and replacements net out), the
  // PAYMENT rows that reference them and the deposits applied in them, summed the way saleGroupInfo sums them.
  // A group that owes nothing (every split sale among them: its account part is a PAYMENT) is left out here, so
  // saleGroupInfo, which reads the whole ledger, runs only for the groups that really owe.
  var groups = {}, order = [], paid = {}, applied = {}, mirrors = [];
  all.forEach(function (r) {
    if (r.type === CFG.TX.PAYMENT && r.refGroupId) paid[r.refGroupId] = (paid[r.refGroupId] || 0) + r.amount;
    if (r.type === CFG.TX.DEPOSIT_APPLIED) applied[r.groupId] = (applied[r.groupId] || 0) + r.amount;
    if (r.reversesTxId && (r.type === CFG.TX.SALE || r.type === CFG.TX.DEPOSIT_APPLIED)) mirrors.push(r);
    if (r.type !== CFG.TX.SALE) return;
    if (shop && r.shop !== shop) return;
    var g = groups[r.groupId];
    if (!g) { g = groups[r.groupId] = { amount: 0, cash: 0 }; order.push(r.groupId); }
    g.amount += r.amount;
    g.cash += r.cash;
  });
  // Older data: a mirror written outside the group of the row it reverses counts for that group too, as in saleGroupInfo.
  if (mirrors.length) {
    var groupOf = {};
    all.forEach(function (r) { if (r.txId) groupOf['t:' + r.txId] = r.groupId; });
    mirrors.forEach(function (r) {
      var og = groupOf['t:' + r.reversesTxId];
      if (og === undefined || og === r.groupId) return;
      if (r.type === CFG.TX.DEPOSIT_APPLIED) applied[og] = (applied[og] || 0) + r.amount;
      else if (groups[og]) { groups[og].amount += r.amount; groups[og].cash += r.cash; }
    });
  }
  order.forEach(function (groupId) {
    var g = groups[groupId];
    if (g.amount <= 0 || g.amount - g.cash - (applied[groupId] || 0) - (paid[groupId] || 0) <= 0) return;
    var info = saleGroupInfo(ports, groupId);
    if (!info || info.voided || info.owed <= 0) return;
    var item = ports.store.getItem(info.itemId);
    // A delivered voucher line (ItemID V1-2532-1) has no Items row: its Note (fabric + design + description) is the name.
    var itemName = item ? item.name : (isOrderLineId(info.itemId) && info.rows[0] && info.rows[0].note ? info.rows[0].note : info.itemId);
    if (basketGroup(info)) itemName = basketName(ports, info);
    if (!item && isOrderId(groupId) && info.rows.length > 1) itemName = fmtCount(info.rows.length) + ' ကြောင်း · ' + itemName;
    var days = daysSince(info.time, now);
    out.push({
      groupId: info.groupId, shop: info.shop, day: info.day, time: info.time, customerId: info.customerId,
      customer: customerName(ports, info.customerId), itemId: info.itemId, item: itemName,
      qty: info.qty, total: info.total, cash: info.cash, payments: info.payments, applied: info.applied,
      owed: info.owed, days: days,
      // The promised date (round 5) and whether the credit is overdue by it (or by age when undated); daysOver = days past it.
      dueDay: info.dueDay, overdue: creditOverdue(info.dueDay, days, today),
      daysOver: info.dueDay ? daysBetweenKeys(info.dueDay, today) : days
    });
  });
  out.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  return out;
}

/**
 * Map customerId -> {received, used, held, lastDay, earmarks, free, earmarked} over all time.
 * An advance for a custom order is a DEPOSIT row whose RefGroupID is the order id (V1-2532); it stays
 * earmarked to that voucher until DEPOSIT_APPLIED rows in that order's group (the delivery, or the kept
 * cancellation fee) consume it, or a negative DEPOSIT row (refund) returns it. earmarks = {orderId: held},
 * free = held - sum(earmarks): what a credit sale or another order may use (only after an explicit yes).
 */
function depositsHeldMap(ports) {
  var map = {};
  ports.store.ledgerRows().forEach(function (r) {
    if (r.type !== CFG.TX.DEPOSIT && r.type !== CFG.TX.DEPOSIT_APPLIED) return;
    var m = map[r.customerId] || (map[r.customerId] = { customerId: r.customerId, received: 0, used: 0, held: 0, lastDay: '', earmarks: {}, free: 0, earmarked: '', byRef: {}, byGroup: {} });
    if (r.type === CFG.TX.DEPOSIT) {
      m.received += r.amount;
      if (isOrderId(r.refGroupId)) m.byRef[r.refGroupId] = (m.byRef[r.refGroupId] || 0) + r.amount;
    } else {
      m.used += r.amount;
      if (isOrderId(r.groupId)) m.byGroup[r.groupId] = (m.byGroup[r.groupId] || 0) + r.amount;
    }
    m.held = m.received - m.used;
    if (r.day > m.lastDay) m.lastDay = r.day;
  });
  Object.keys(map).forEach(function (k) {
    var m = map[k], sum = 0, parts = [];
    Object.keys(m.byRef).forEach(function (orderId) {
      var left = m.byRef[orderId] - (m.byGroup[orderId] || 0);
      if (left > 0) { m.earmarks[orderId] = left; sum += left; parts.push(orderId + ': ' + fmtMoney(left)); }
    });
    m.free = Math.max(0, m.held - sum);
    m.earmarked = parts.join(', ');
    delete m.byRef;
    delete m.byGroup;
  });
  return map;
}

/** Everything the customer has in advance (earmarked or not): the "deposit held" figure of cards and summaries. */
function depositsFor(ports, customerId) {
  var m = depositsHeldMap(ports)[customerId];
  return m ? m.held : 0;
}

/** The part of the held deposits that belongs to no open voucher: what a credit sale may consume. */
function depositsFree(ports, customerId) {
  var m = depositsHeldMap(ports)[customerId];
  return m ? m.free : 0;
}

/** The advance earmarked to one order (net of what its group already applied). */
function depositEarmark(ports, customerId, orderId) {
  var m = depositsHeldMap(ports)[customerId];
  return m && m.earmarks[orderId] ? m.earmarks[orderId] : 0;
}

/** What a delivery of `orderId` may apply at most: its own earmark plus the customer's free pool. */
function depositsAvailable(ports, customerId, orderId) {
  var m = depositsHeldMap(ports)[customerId];
  if (!m) return 0;
  return m.free + (m.earmarks[orderId] || 0);
}

function depositsHeldList(ports) {
  var map = depositsHeldMap(ports);
  return Object.keys(map).map(function (k) { return map[k]; }).filter(function (m) { return m.held > 0; })
    .map(function (m) { m.customer = customerName(ports, m.customerId); return m; })
    .sort(function (a, b) { return b.held - a.held; });
}

/* ----------------------------- customers ----------------------------- */

/**
 * Per-customer totals in one pass: {bought, paid, owed, depositHeld, lastDay, visits}.
 * Bought = SALE+RETURN amounts; Paid = their Cash + PAYMENT + DEPOSIT_APPLIED; Owed = Bought - Paid;
 * DepositHeld = DEPOSIT - DEPOSIT_APPLIED. Mirrors net out. LastDay and Visits count live rows only.
 */
function customerSummaryMap(ports) {
  var all = ports.store.ledgerRows(), reversed = reversedIdSet(all), map = {}, T = CFG.TX;
  all.forEach(function (r) {
    if (!r.customerId) return;
    var m = map[r.customerId] || (map[r.customerId] = { customerId: r.customerId, bought: 0, paid: 0, owed: 0, depositHeld: 0, lastDay: '', visits: 0, days: {} });
    switch (r.type) {
      case T.SALE: case T.RETURN: m.bought += r.amount; m.paid += r.cash; break;
      case T.FEE: m.bought += r.amount; break;   // a kept cancellation fee is paid by its DEPOSIT_APPLIED row
      case T.PAYMENT: m.paid += r.amount; break;
      case T.DEPOSIT_APPLIED: m.paid += r.amount; m.depositHeld -= r.amount; break;
      case T.DEPOSIT: m.depositHeld += r.amount; break;
      default: break;
    }
    if (!r.reversesTxId && !reversed[r.txId]) {
      if (!m.days[r.day]) { m.days[r.day] = true; m.visits++; }
      if (r.day > m.lastDay) m.lastDay = r.day;
    }
  });
  Object.keys(map).forEach(function (k) { map[k].owed = map[k].bought - map[k].paid; delete map[k].days; });
  return map;
}

function customerSummary(ports, customerId) {
  return customerSummaryMap(ports)[customerId] || { customerId: customerId, bought: 0, paid: 0, owed: 0, depositHeld: 0, lastDay: '', visits: 0 };
}

/** Every customer with its summary, for the Customers tab view (columns F:K). */
function customerSummaries(ports) {
  var map = customerSummaryMap(ports);
  return ports.store.listCustomers().map(function (c) {
    var m = map[c.id] || { bought: 0, paid: 0, owed: 0, depositHeld: 0, lastDay: '', visits: 0 };
    return { id: c.id, customerId: c.id, name: c.name, phone: c.phone || '', note: c.note || '', createdAt: c.createdAt || '',
             bought: m.bought, paid: m.paid, owed: m.owed, depositHeld: m.depositHeld, lastDay: m.lastDay, visits: m.visits };
  });
}

/** The last n live rows of a customer, newest first. */
function customerHistory(ports, customerId, n) {
  var all = ports.store.ledgerRows();
  var rows = liveRows(all.filter(function (r) { return r.customerId === customerId; }), all);
  rows.sort(function (a, b) { return a.time < b.time ? 1 : a.time > b.time ? -1 : 0; });
  return n ? rows.slice(0, n) : rows;
}

function customerName(ports, customerId) {
  if (!customerId) return '?';
  var c = ports.store.getCustomer(customerId);
  return c ? c.name : customerId;
}

/** Customers with the most recent ledger activity first, padded with the newest customers. */
function recentCustomers(ports, shop, n) {
  var rows = ports.store.ledgerRows(), seen = {}, out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < n; i--) {
    var r = rows[i];
    if (!r.customerId || seen[r.customerId]) continue;
    if (shop && r.shop !== shop) continue;
    seen[r.customerId] = true;
    var c = ports.store.getCustomer(r.customerId);
    if (c) out.push(c);
  }
  if (out.length < n) {
    ports.store.listCustomers().slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
      .forEach(function (c) { if (out.length < n && !seen[c.id]) { seen[c.id] = true; out.push(c); } });
  }
  return out;
}

function normName(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

/**
 * Phone digits for matching and storage: Burmese digits -> Arabic, everything but digits dropped,
 * +959... / 959... -> 09..., 9xxxxxxxx -> 09xxxxxxxx. Returns '' when there are no digits.
 */
function normPhone(s) {
  var d = String(s || '').replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); }).replace(/\D/g, '');
  if (/^959\d{6,}$/.test(d)) d = '0' + d.slice(2);
  else if (/^9\d{7,9}$/.test(d)) d = '0' + d;
  return d;
}

function isValidPhone(s) { return /^09\d{7,9}$/.test(normPhone(s)); }

/** '09777123456' -> '+95 977 712 3456' (international form, tappable in Telegram). Odd values come back as typed. */
function fmtPhone(s) {
  var d = normPhone(s);
  if (!/^09\d{7,9}$/.test(d)) return String(s || '');
  var rest = d.slice(1), groups = [];
  groups.push(rest.slice(0, 3));
  rest = rest.slice(3);
  while (rest.length > 4) { groups.push(rest.slice(0, 3)); rest = rest.slice(3); }
  if (rest) groups.push(rest);
  return '+95 ' + groups.join(' ');
}

/**
 * Customers matching a hint: phone digits first (4 or more digits typed), then exact name,
 * then names that contain the hint or vice versa. Never merges on its own; callers decide.
 */
function findCustomers(ports, hint) {
  var raw = String(hint || '').trim();
  if (!raw) return [];
  var list = ports.store.listCustomers(), out = [];
  var digits = raw.replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); }).replace(/\D/g, '');
  var letters = raw.replace(/[\d၀-၉\s+()\-\.]/g, '');
  if (digits.length >= 4 && !letters) {
    var want = normPhone(raw);
    list.forEach(function (c) {
      var p = normPhone(c.phone);
      if (!p) return;
      if (p === want) out.unshift(c); else if (p.indexOf(digits) >= 0 || p.indexOf(want) >= 0) out.push(c);
    });
    return out;
  }
  var h = normName(raw);
  var exact = list.filter(function (c) { return normName(c.name) === h; });
  var partial = list.filter(function (c) {
    var n = normName(c.name);
    return n !== h && n && (n.indexOf(h) >= 0 || h.indexOf(n) >= 0);
  });
  return exact.concat(partial);
}

/** {exact: customer|null, partial: [customers]} for a typed or spoken name. */
function matchCustomers(ports, hint) {
  var found = findCustomers(ports, hint), h = normName(hint);
  var exact = found.filter(function (c) { return normName(c.name) === h || (normPhone(hint) && normPhone(c.phone) === normPhone(hint)); })[0] || null;
  return { exact: exact, partial: found.filter(function (c) { return c !== exact; }) };
}

/** Auto-picks only an exact name (or exact phone) match; otherwise creates. Bot flows offer a chooser first. */
function resolveOrCreateCustomer(ports, name) {
  var m = matchCustomers(ports, name);
  if (m.exact) return m.exact;
  return ports.store.addCustomer({ name: String(name || '').trim() });
}

/**
 * The checks of the app's buyer form (round 6, revision 3): v = {name, phone, note, forceNew}; selfId = the edited
 * customer's id ('' for a new buyer). Problems in order: name (empty), phone (1-6 digits), known_phone (another customer
 * has that phone; its id rides along), same_name (a new buyer whose name a customer already has, unless forceNew).
 * Returns {ok, problems: [{code, field, key, vars, customerId?}]}. Reads the store only.
 */
function customerCheck(ports, v, selfId) {
  v = v || {};
  selfId = selfId || '';
  var problems = [], name = String(v.name || '').trim(), digits = normPhone(v.phone), list = ports.store.listCustomers();
  if (!name) problems.push({ code: 'name', field: 'name', key: 'ask_name', vars: {} });
  if (digits.length >= 1 && digits.length <= 6) problems.push({ code: 'phone', field: 'phone', key: 'basket_bad_phone', vars: {} });
  else if (digits.length) {
    var known = list.filter(function (c) { return c.id !== selfId && normPhone(c.phone) === digits; })[0];
    if (known) problems.push({ code: 'known_phone', field: 'phone', key: 'ui_buyer_known_phone', vars: { customer: known.name }, customerId: known.id });
  }
  if (!selfId && !v.forceNew && name) {
    var same = list.filter(function (c) { return normName(c.name) === normName(name); })[0];
    if (same) problems.push({ code: 'same_name', field: 'name', key: 'ui_buyer_same_name', vars: { customer: same.name }, customerId: same.id });
  }
  return { ok: !problems.length, problems: problems };
}

/**
 * The write of the app's buyer form: the name trimmed and cut to CFG.CUST_NAME_MAX, the note cut to CFG.CUST_NOTE_MAX, the
 * phone as savePhone stores it (normalised when it is a valid number, else the trimmed text), cut to 20. With selfId only
 * the changed fields among name, phone and note go to updateCustomer; else addCustomer. Returns the stored record.
 */
function commitCustomer(ports, v, selfId) {
  v = v || {};
  var name = String(v.name || '').trim().slice(0, CFG.CUST_NAME_MAX);
  var note = String(v.note || '').trim().slice(0, CFG.CUST_NOTE_MAX);
  var raw = String(v.phone || '').trim();
  var phone = (isValidPhone(raw) ? normPhone(raw) : raw).slice(0, 20);
  if (selfId) {
    var cur = ports.store.getCustomer(selfId) || {}, ch = {}, n = 0;
    if (String(cur.name || '') !== name) { ch.name = name; n++; }
    if (String(cur.phone || '') !== phone) { ch.phone = phone; n++; }
    if (String(cur.note || '') !== note) { ch.note = note; n++; }
    if (n) ports.store.updateCustomer(selfId, ch);
    return ports.store.getCustomer(selfId);
  }
  return ports.store.addCustomer({ name: name, phone: phone, note: note });
}

/* ----------------------------- reporting ----------------------------- */

/**
 * Add a row's cash to the in/out buckets. An undo mirror reduces the bucket its
 * original filled, so gross cash in and out stay honest after corrections.
 */
function addCash(bucket, r) {
  if (!r.cash) return;
  if (r.reversesTxId) {
    if (r.cash < 0) bucket.cashIn += r.cash; else bucket.cashOut -= r.cash;
  } else if (r.cash > 0) {
    bucket.cashIn += r.cash;
  } else {
    bucket.cashOut -= r.cash;
  }
}

/** Same as addCash, per payment method: bucket.byMethod[KEY] = {in, out}. Blank method with cash counts as CASH. */
function addMethodCash(bucket, r) {
  if (!r.cash) return;
  var key = methodOf(r);
  var b = bucket.byMethod[key] || (bucket.byMethod[key] = { 'in': 0, out: 0 });
  if (r.reversesTxId) {
    if (r.cash < 0) b['in'] += r.cash; else b.out -= r.cash;
  } else if (r.cash > 0) {
    b['in'] += r.cash;
  } else {
    b.out -= r.cash;
  }
}

/** Fill drawerIn/drawerOut/drawerNet and bankIn/bankOut/bankNet from bucket.byMethod. */
function finishMethodTotals(bucket) {
  var cash = bucket.byMethod[CFG.METHOD.CASH] || { 'in': 0, out: 0 };
  bucket.drawerIn = cash['in'];
  bucket.drawerOut = cash.out;
  bucket.drawerNet = cash['in'] - cash.out;
  bucket.bankIn = 0;
  bucket.bankOut = 0;
  Object.keys(bucket.byMethod).forEach(function (k) {
    if (k === CFG.METHOD.CASH) return;
    bucket.bankIn += bucket.byMethod[k]['in'];
    bucket.bankOut += bucket.byMethod[k].out;
  });
  bucket.bankNet = bucket.bankIn - bucket.bankOut;
  bucket.cashBank = bucket.bankIn;
  return bucket;
}

/** Totals over ledger rows of one shop whose Day passes pred. */
function statsWhere(ports, shop, pred) {
  var sampleMap = null;
  function isSample(itemId) {
    if (!sampleMap) {
      sampleMap = {};
      ports.store.listItems(null).forEach(function (it) { if (it.sample) sampleMap[it.id] = true; });
    }
    return !!sampleMap[itemId];
  }
  var T = CFG.TX;
  // Custom orders (plan 13.4) are split out the way samples are: orderRevenue = SALE rows of voucher groups,
  // ordersDelivered = voucher groups with revenue left after corrections, orderDeposits = advances earmarked
  // to vouchers, depositRefunds = negative DEPOSIT rows, fees = kept cancellation fees (FEE rows, revenue).
  var s = { revenue: 0, pieces: 0, expenses: 0, cogs: 0, unknownCostPieces: 0, sales: 0, cashIn: 0, cashOut: 0,
            payments: 0, deposits: 0, depositsApplied: 0, depositRefunds: 0, samplesSold: 0, byMethod: {}, expensesByCategory: {},
            orderRevenue: 0, ordersDelivered: 0, orderDeposits: 0, fees: 0, orderGroups: {} };
  ports.store.ledgerRows().forEach(function (r) {
    if (r.shop !== shop || !pred(r.day)) return;
    addCash(s, r);
    addMethodCash(s, r);
    switch (r.type) {
      case T.SALE:
        s.revenue += r.amount;
        s.pieces -= r.qty;
        // A row with Qty 0 (nothing left the shop) is neutral for the sales count.
        if (r.qty < 0) s.sales += 1; else if (r.qty > 0) s.sales -= 1;
        if (r.costAtSale === '' || r.costAtSale === null || r.costAtSale === undefined) s.unknownCostPieces -= r.qty;
        else s.cogs += -r.qty * Number(r.costAtSale);
        if (isSample(r.itemId)) s.samplesSold -= r.qty;
        if (isOrderId(r.groupId)) { s.orderRevenue += r.amount; s.orderGroups[r.groupId] = (s.orderGroups[r.groupId] || 0) + r.amount; }
        break;
      case T.FEE:
        // Cancellation fee kept from a deposit: revenue on the day the order died, no stock, no cash movement.
        s.revenue += r.amount;
        s.fees += r.amount;
        s.orderRevenue += r.amount;
        break;
      case T.RETURN: s.revenue += r.amount; s.pieces -= r.qty; break;
      case T.EXPENSE: {
        s.expenses -= r.amount;
        var key = r.category || 'other';
        var c = s.expensesByCategory[key] || (s.expensesByCategory[key] = { count: 0, total: 0, bank: 0 });
        c.count += r.reversesTxId ? -1 : 1;
        c.total -= r.amount;
        if (methodOf(r) !== CFG.METHOD.CASH) c.bank -= r.amount;
        break;
      }
      case T.PAYMENT: s.payments += r.amount; break;
      case T.DEPOSIT:
        // Refunds are negative DEPOSIT rows (not mirrors): shown on their own so "deposits received" stays gross.
        // A deposit's undo mirror is negative, a refund's undo mirror positive: each nets out its own figure.
        if (r.amount < 0 && !r.reversesTxId) s.depositRefunds -= r.amount;
        else if (r.amount > 0 && r.reversesTxId) s.depositRefunds -= r.amount;
        else s.deposits += r.amount;
        if (isOrderId(r.refGroupId)) s.orderDeposits += r.amount;
        break;
      case T.DEPOSIT_APPLIED: s.depositsApplied += r.amount; break;
      default: break;
    }
  });
  finishMethodTotals(s);
  s.profit = s.revenue - s.cogs - s.expenses;
  s.cashNet = s.cashIn - s.cashOut;
  Object.keys(s.orderGroups).forEach(function (g) { if (s.orderGroups[g] > 0) s.ordersDelivered++; });
  delete s.orderGroups;
  return s;
}

function dayStats(ports, shop, day) {
  return statsWhere(ports, shop, function (d) { return d === day; });
}

function monthStats(ports, shop, ym) {
  return statsWhere(ports, shop, function (d) { return String(d).slice(0, 7) === ym; });
}

function lowStockList(ports, shop) {
  var threshold = Number(ports.store.getSetting('low_stock_threshold', CFG.LOW_STOCK_DEFAULT));
  return ports.store.listItems(shop).filter(function (it) {
    return it.status === CFG.STATUS.ACTIVE && it.type === CFG.ITEM_TYPE.SKU && Number(it.stock) <= threshold;
  });
}

function buildDailySummary(ports, day) {
  var lines = [t(ports, 'summary_header', { date: fmtDayMy(day) })];
  CFG.SHOP_IDS.forEach(function (shop) {
    var s = dayStats(ports, shop, day);
    var credits = openCredits(ports, shop);
    var owedTotal = credits.reduce(function (a, c) { return a + c.owed; }, 0);
    if (s.sales === 0 && s.expenses === 0 && s.revenue === 0 && s.cashIn === 0) {
      lines.push(t(ports, 'summary_empty', { shop: shopName(ports, shop) }));
    } else {
      lines.push(t(ports, 'summary_shop', {
        shop: shopName(ports, shop), revenue: fmtMoney(s.revenue), pieces: fmtCount(s.pieces),
        expenses: fmtMoney(s.expenses), profit: fmtMoney(s.profit)
      }));
      // Net movement per channel: what the drawer count and the wallet balance should have moved by today.
      lines.push(t(ports, 'summary_cash', { cash: fmtMoney(s.drawerNet), bank: fmtMoney(s.bankNet), owed: fmtMoney(owedTotal) }));
      // On a day when two or more accounts moved money, the bank figure is broken down per account (net).
      var accounts = Object.keys(s.byMethod).filter(function (k) {
        return k !== CFG.METHOD.CASH && (s.byMethod[k]['in'] || s.byMethod[k].out);
      });
      if (accounts.length >= 2) {
        lines.push(t(ports, 'summary_accounts', { list: accounts.map(function (k) {
          return methodLabel(ports, k) + ' ' + fmtMoney(s.byMethod[k]['in'] - s.byMethod[k].out);
        }).join(' · ') }));
      }
      if (s.unknownCostPieces > 0) lines.push(t(ports, 'summary_nocost', { n: fmtCount(s.unknownCostPieces) }));
    }
  });
  var deposits = depositsHeldList(ports);
  if (deposits.length) {
    var total = deposits.reduce(function (a, d) { return a + d.held; }, 0);
    lines.push(t(ports, 'summary_deposits', {
      total: fmtMoney(total),
      list: deposits.slice(0, 5).map(function (d) { return d.customer + ' ' + fmtMoney(d.held); }).join(', ')
    }));
  }
  // Overdue credits: the undated ones by age (as before), the dated ones (a promised DueDay, round 5) on their own line.
  var overdue = openCredits(ports, null).filter(function (c) { return c.overdue; });
  var undated = overdue.filter(function (c) { return !c.dueDay; }), dated = overdue.filter(function (c) { return !!c.dueDay; });
  if (undated.length) {
    lines.push(t(ports, 'summary_overdue', {
      days: myDigits(CFG.OVERDUE_DAYS),
      list: undated.slice(0, 5).map(function (c) { return c.customer + ' ' + fmtMoney(c.owed) + ' (' + myDigits(c.days) + ' ရက်)'; }).join(', ')
    }));
  }
  if (dated.length) {
    lines.push(t(ports, 'summary_due_overdue', {
      list: dated.slice(0, 5).map(function (c) { return c.customer + ' ' + fmtMoney(c.owed) + ' (' + fmtDayShortMy(c.dueDay) + ' · ' + myDigits(c.daysOver) + ' ရက် လွန်)'; }).join(', ')
    }));
  }
  var low = [];
  CFG.SHOP_IDS.forEach(function (shop) {
    lowStockList(ports, shop).forEach(function (it) { low.push(it.name + ' (' + fmtCount(it.stock) + ')'); });
  });
  if (low.length) lines.push(t(ports, 'summary_low', { list: low.join(', ') }));
  // Custom orders due soon and overdue (core_orders.js; absent on a store without the Orders tab).
  if (typeof orderSummaryLines === 'function' && ports.store.listOrders) lines = lines.concat(orderSummaryLines(ports, day));
  // The app's stale-phone line (core_sync.js). The bot's ports carry no Devices tab, so this adds nothing
  // there; gas_main.js appends the server-side lines itself (summaryWithSyncLines).
  if (typeof syncSummaryLines === 'function') {
    try { lines = lines.concat(syncSummaryLines(ports)); } catch (err) { if (ports.store.logError) ports.store.logError('sync_summary', err, '', ''); }
  }
  return lines.join('\n');
}

/* ------------------------------ lookups ------------------------------ */

/** Fuzzy match on item names (and alias) within a shop. Best matches first. */
function findItemsByName(ports, shop, hint) {
  return rankItemsByName(ports, shop, hint).map(function (x) { return x.it; });
}

/** Same as findItemsByName but keeps the scores, so callers can tell a clear winner from a tie. */
function rankItemsByName(ports, shop, hint) {
  var h = String(hint || '').trim();
  if (!h) return [];
  var tokens = h.split(/\s+/).filter(function (x) { return x.length > 0 && !/^[\d၀-၉,]+$/.test(x) && x !== 'ထည်'; });
  var scored = ports.store.listItems(shop).filter(function (it) {
    return it.status !== CFG.STATUS.BLANK;
  }).map(function (it) {
    var name = String(it.name || '') + ' ' + String(it.category || '') + ' ' + String(it.alias || '');
    var score = 0;
    tokens.forEach(function (tk) { if (name.indexOf(tk) >= 0) score += tk.length; });
    if (String(it.id).toUpperCase() === h.toUpperCase()) score += 100;
    if (it.alias && String(it.alias).toUpperCase() === h.toUpperCase()) score += 100;
    return { it: it, score: score };
  }).filter(function (x) { return x.score > 0; });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored;
}

/** Items touched most recently in a shop (sold, restocked, returned), newest first. */
function recentItems(ports, shop, n) {
  var rows = ports.store.ledgerRows(), seen = {}, out = [];
  var T = CFG.TX;
  for (var i = rows.length - 1; i >= 0 && out.length < n; i--) {
    var r = rows[i];
    if (r.type !== T.SALE && r.type !== T.RESTOCK && r.type !== T.RETURN) continue;
    if (shop && r.shop !== shop) continue;
    if (!r.itemId || seen[r.itemId]) continue;
    seen[r.itemId] = true;
    var it = ports.store.getItem(r.itemId);
    if (it && it.status !== CFG.STATUS.BLANK) out.push(it);
  }
  return out;
}

/**
 * Receipt number of a sale group. A SALE row that carries ReceiptNo (written on a phone,
 * R1-A-000231) wins; otherwise the number is derived from the order of sale groups per shop.
 * Numbers are never reassigned: a voided group keeps its number and leaves a gap, and a
 * rewrite keeps the GroupID, so the number a customer was given stays valid.
 */
function receiptNumber(ports, groupId) {
  var rows = ports.store.ledgerRows(), seen = {}, shop = null, index = -1, count = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.type !== CFG.TX.SALE || r.reversesTxId || seen[r.groupId]) continue;
    seen[r.groupId] = true;
    if (r.groupId === groupId) {
      if (r.receiptNo) return r.receiptNo;
      shop = r.shop;
      break;
    }
  }
  if (!shop) return 'R?-000000';
  seen = {};
  for (var k = 0; k < rows.length; k++) {
    var row = rows[k];
    if (row.type !== CFG.TX.SALE || row.reversesTxId || row.shop !== shop || seen[row.groupId]) continue;
    seen[row.groupId] = true;
    count++;
    if (row.groupId === groupId) { index = count; break; }
  }
  return 'R' + shop.replace(/\D/g, '') + '-' + ('000000' + index).slice(-6);
}

/** Up to four price buttons for a category: the most common existing prices, padded with defaults. */
function pricePresets(ports, category, shop) {
  var counts = {};
  ports.store.listItems(null).forEach(function (it) {
    if (it.status === CFG.STATUS.BLANK || !it.price) return;
    if (category && it.category !== category) return;
    counts[it.price] = (counts[it.price] || 0) + 1;
  });
  var prices = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a] || a - b; }).slice(0, 4);
  var defaults = (ports.store.getSetting('price_presets', '') || '').toString().split(',').map(function (x) { return Number(x); })
    .filter(function (x) { return x > 0; });
  if (!defaults.length) defaults = CFG.DEFAULT_PRICE_PRESETS;
  for (var i = 0; i < defaults.length && prices.length < 4; i++) {
    if (prices.indexOf(defaults[i]) < 0) prices.push(defaults[i]);
  }
  return prices.sort(function (a, b) { return a - b; });
}

function depositPresets(ports) {
  var v = (ports.store.getSetting('deposit_presets', '') || '').toString().split(',').map(Number).filter(function (x) { return x > 0; });
  return v.length ? v : CFG.DEPOSIT_PRESETS;
}

/* ------------------------------ product import ------------------------------ */

/**
 * Import rows from the old software: [{Code, Name, Category, Type, Price, Cost, Stock, Shop}].
 * Codes that already match a blank tag id are used as-is; other codes become the Alias of the
 * next blank tag in that shop. Opening stock is written as RESTOCK rows. Returns a summary.
 */
function importProducts(ports, rows, staff) {
  var done = [], skipped = [];
  rows.forEach(function (row) {
    var code = String(row.Code || '').trim().toUpperCase();
    var name = String(row.Name || '').trim();
    var shop = String(row.Shop || 'S1').trim().toUpperCase();
    if (!name) { skipped.push({ code: code, reason: 'no name' }); return; }
    if (CFG.SHOP_IDS.indexOf(shop) < 0) { skipped.push({ code: code, reason: 'unknown shop ' + shop }); return; }
    var target = null, alias = '';
    if (/^S[12]-\d{4}$/.test(code)) {
      var existing = ports.store.getItem(code);
      if (existing && existing.status === CFG.STATUS.BLANK && existing.shop === shop) target = existing;
      else if (existing) { skipped.push({ code: code, reason: 'tag already in use' }); return; }
    }
    if (!target) {
      var blanks = ports.store.listItems(shop).filter(function (it) { return it.status === CFG.STATUS.BLANK; });
      if (!blanks.length) { skipped.push({ code: code, reason: 'no blank tags left in ' + shop }); return; }
      target = blanks[0];
      alias = code;
    }
    // Round 6b: a name of the item_category list (a built-in's old name finds its row) with its current label, else the catch-all.
    var catRow = itemCategoryOf(ports, String(row.Category || '')), category = catRow ? catRow.label : itemCategoryFallback(ports);
    var type = String(row.Type || '').toUpperCase() === CFG.ITEM_TYPE.UNIQUE ? CFG.ITEM_TYPE.UNIQUE : CFG.ITEM_TYPE.SKU;
    var price = Number(row.Price) || '';
    var cost = row.Cost === '' || row.Cost === null || row.Cost === undefined ? '' : Number(row.Cost);
    ports.store.updateItem(target.id, {
      name: name, category: category, type: type, price: price, cost: cost, alias: alias,
      createdAt: ports.clock.now().toISOString(), createdBy: staff.id
    });
    var stock = Math.max(0, Math.round(Number(row.Stock) || 0));
    if (stock > 0) {
      commitRestock(ports, { item: ports.store.getItem(target.id), qty: stock, staff: staff, source: CFG.SOURCE.IMPORT, note: 'import ' + (alias || code) });
    }
    done.push({ code: code, id: target.id, alias: alias, stock: stock });
  });
  return { done: done, skipped: skipped };
}
