/**
 * poc/run_lists.js — round 4, step 1 ("Model"): option lists (Lists tab, lists_json, legacy Settings),
 * the upsert rule, key derivation, add-by-label, account details, the split sale, the transfer line on
 * receipts and the report changes. Same harness as poc/run_scenario.js: the real core over in-memory ports.
 * No network, no keys. core_sync.js is not loaded (core_ledger.js must not need it).
 *
 *   node poc/run_lists.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
[
  'apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js',
  'apps-script/core_ai_prompt.js', 'apps-script/core_ledger.js', 'apps-script/core_report.js', 'apps-script/core_bot.js',
  'apps-script/core_orders.js',
  'poc/sim_mock_ai.js', 'poc/sim_ports.js', 'poc/sim_seed.js'
].forEach(f => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }));

let pass = 0, fail = 0;
function check(cond, label, detail) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✘ ' + label + (detail === undefined ? '' : ' | got: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); }
}
const step = title => console.log('\n── ' + title);

/* ------------------------------------------------------------------------------------------------------
 * The functions of core_ledger.js / core_orders.js exactly as they were BEFORE round 4 (copied from the
 * pre-round-4 files before core_ledger.js was edited; only the names changed). The checks below compare
 * the list-backed helpers and the refactored rewriteGroup against them.
 * ---------------------------------------------------------------------------------------------------- */

/** core_ledger.js rewriteGroup as of 2026-11-09 (pre-round-4), verbatim. */
function legacyRewriteGroup(ports, groupId, changes, staff, updateId, opts) {
  opts = opts || {};
  changes = changes || {};
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return chk;
  var row = chk.row, now = ports.clock.now();
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
    staffId: staff.id, updateId: updateId, receiptNo: row.receiptNo, when: new Date(row.time)
  });
  var r = writeGroup(ports, [mirror, replacement]);
  return { ok: true, groupId: r.groupId, txs: r.txs, row: replacement };
}

/** core_ledger.js payMethods as of 2026-11-09 (the Errors-row side effect left out: only the value is compared). */
function legacyPayMethods(ports) {
  var raw = (ports.store.getSetting('pay_methods', '') || '').toString();
  var keys = raw.split(',').map(function (k) { return k.trim().toUpperCase(); }).filter(function (k) { return k.length > 0; });
  keys = keys.filter(function (k) { return utf8ByteLength(k) <= CFG.METHOD_KEY_MAX_BYTES; });
  if (!keys.length) keys = CFG.DEFAULT_PAY_METHODS.slice();
  var i = keys.indexOf(CFG.METHOD.CASH);
  if (i > 0) keys.splice(i, 1);
  if (i !== 0) keys.unshift(CFG.METHOD.CASH);
  return keys.filter(function (k, idx) { return keys.indexOf(k) === idx; });
}

/** core_ledger.js methodLabel as of 2026-11-09, verbatim. */
function legacyMethodLabel(ports, key) {
  key = String(key || '').toUpperCase();
  if (!key) return '';
  var s = t(ports, 'method_' + key);
  return s === 'method_' + key ? key : s;
}

/** core_ledger.js expenseCategories as of 2026-11-09, verbatim. */
function legacyExpenseCategories(ports) {
  var raw = (ports.store.getSetting('expense_categories', '') || '').toString();
  var list = [];
  raw.split(',').forEach(function (pair) {
    var p = pair.split(':');
    var key = String(p[0] || '').trim().toLowerCase();
    if (!key) return;
    list.push([key, String(p[1] || '').trim() || key]);
  });
  if (!list.length) {
    list = CFG.EXPENSE_CATEGORIES.map(function (c) {
      var label = t(ports, 'cat_' + c[0]);
      return [c[0], label === 'cat_' + c[0] ? c[1] : label];
    });
  }
  if (!list.some(function (c) { return c[0] === 'other'; })) list.push(['other', t(ports, 'cat_other')]);
  return list;
}

/** core_ledger.js categoryLabel as of 2026-11-09, verbatim (over the legacy list). */
function legacyCategoryLabel(ports, key) {
  key = String(key || 'other').toLowerCase();
  var list = legacyExpenseCategories(ports);
  for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1];
  return key === 'other' ? t(ports, 'cat_other') : key;
}

/** core_orders.js fabricPresets (through settingList) as of 2026-11-09, verbatim. */
function legacyFabricPresets(ports) {
  var raw = (ports.store.getSetting('fabric_presets', '') || '').toString();
  var list = raw.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 0; });
  return list.length ? list : CFG.FABRIC_PRESETS.slice();
}

/* ------------------------------ helpers ------------------------------ */

const U = SIM_USERS;
const sister = { id: '1001', name: 'Sister (S1)', shop: 'S1', role: 'staff' };
const brother = { id: '1002', name: 'Brother (S2)', shop: 'S2', role: 'staff' };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const allTrue = o => Object.keys(o).every(k => o[k] === true);
// Invisible characters, built from codes so this file holds none: zero-width space, non-joiner, byte-order mark, no-break space.
const ZWSP = String.fromCharCode(0x200B), ZWNJ = String.fromCharCode(0x200C), BOM = String.fromCharCode(0xFEFF), NBSP = String.fromCharCode(0xA0);
/** The "logged once" memo of core_ledger.js lives as long as the process: start a logging check from a clean one. */
const resetWarned = () => Object.keys(PAY_METHOD_WARNED).forEach(k => delete PAY_METHOD_WARNED[k]);
const errorsOf = (w, where) => w.errors.filter(e => e.where === where);
/** A seeded simulator world; {lists: true} also seeds the Lists tab (simSeedLists). */
function newWorld(o) {
  const w = seedSimWorld(createSimWorld());
  if (o && o.lists) simSeedLists(w);
  return w;
}
const row = (list, key, label, extra) => Object.assign({ list, key, label }, extra || {});
const acct = (key, label, extra) => row('pay_method', key, label, extra);
/** Does every list-backed helper return what the pre-round-4 function returns on these ports? */
function agreesWithLegacy(p) {
  const keys = legacyPayMethods(p).concat(['AYA', 'NOPE', '', 'kbz']);
  const cats = legacyExpenseCategories(p).map(c => c[0]).concat(['nope', '', 'OTHER', 'Food']);
  return {
    payMethods: same(payMethods(p), legacyPayMethods(p)),
    methodLabel: keys.every(k => methodLabel(p, k) === legacyMethodLabel(p, k)),
    expenseCategories: same(expenseCategories(p), legacyExpenseCategories(p)),
    categoryLabel: cats.every(k => categoryLabel(p, k) === legacyCategoryLabel(p, k)),
    fabricPresets: same(fabricPresets(p), legacyFabricPresets(p))
  };
}
/**
 * Ports as a phone has them: no store.listOptions (the lists arrive in Settings lists_json) and an
 * addListOption that works the way spec section 8 describes it (listsJsonUpsert on the local value, an
 * outbox entry only when something changed).
 */
function phoneLikePorts(settings, messages) {
  const outbox = [], errors = [];
  const store = {
    getSetting: (k, d) => (Object.prototype.hasOwnProperty.call(settings, k) ? settings[k] : d),
    getMessage: k => (messages && messages[k]) || null,
    logError: (where, err) => errors.push({ where, message: err && err.message ? err.message : String(err) }),
    addListOption: (rec, seedRows) => {
      const r = listsJsonUpsert(settings.lists_json || '', rec.list, seedRows, rec);
      settings.lists_json = r.raw;
      if (r.status === 'ok') outbox.push({ kind: 'list', rec: Object.assign({}, rec) });
      return { status: r.status, key: r.key };
    }
  };
  return { store, clock: { now: () => new Date() }, uuid: simUuid, cache: null, settings, outbox, errors };
}

/* ------------------------------ A. the legacy lists ------------------------------ */

step('A. legacyListRows: the lists exactly as version 3 gives them');
{
  const w = newWorld(), p = w.ports;
  let pm = legacyListRows(p, 'pay_method');
  check(same(pm.map(r => r.key), ['CASH', 'KBZ', 'WAVE', 'BANK']) && same(pm.map(r => r.key), legacyPayMethods(p)), 'pay_method: the keys of today\'s payMethods, CASH first', pm.map(r => r.key));
  check(pm.every(r => r.label === legacyMethodLabel(p, r.key)) && pm[0].label === MSG.method_CASH && pm[1].label === MSG.method_KBZ, 'pay_method: the labels are the Messages method_<KEY> texts');
  check(pm.every((r, i) => r.list === 'pay_method' && r.active === true && r.order === i + 1 && r.shop === '' && r.detail === '' && r.note === ''), 'the rows are normalised: active, Order 1..n, Shop blank');
  let ec = legacyListRows(p, 'expense_category');
  check(same(ec.map(r => [r.key, r.label]), legacyExpenseCategories(p)) && ec[ec.length - 1].key === 'other' && ec.length === CFG.EXPENSE_CATEGORIES.length, 'expense_category: today\'s keys and labels, other last', ec.map(r => r.key));
  check(ec.every((r, i) => r.detail === (CFG.EXPENSE_EMOJI[r.key] || '') && r.order === i + 1) && ec.filter(r => r.key === 'food')[0].detail === '🍚', 'expense_category: the detail is the built-in emoji');
  let fb = legacyListRows(p, 'fabric');
  check(same(fb.map(r => r.label), legacyFabricPresets(p)) && same(fb.map(r => r.key), ['f1', 'f2', 'f3']) && same(fb.map(r => r.label), ['ပိုး', 'ချည်', 'ပုဝါ']), 'fabric: Settings fabric_presets in order, keys f1, f2, f3', fb);
  check(allTrue(agreesWithLegacy(p)), 'payMethods, methodLabel, expenseCategories, categoryLabel and fabricPresets return today\'s values on a sheet without Lists rows', agreesWithLegacy(p));
  check(legacyListRows(p, 'nope').length === 0 && listRows(p, 'nope').length === 0, 'an unknown list name has no rows');

  w.settings.pay_methods = 'kbz, AYA ,cash,AYA,,wave';
  w.messages.method_AYA = 'AYA ဘဏ်';
  w.settings.expense_categories = 'Rent:ဆိုင်ခ, water : ရေဖိုး ,tips,:x,';
  w.settings.fabric_presets = ' ဂျာစီ , ပိုး ,,';
  pm = legacyListRows(p, 'pay_method');
  ec = legacyListRows(p, 'expense_category');
  fb = legacyListRows(p, 'fabric');
  check(same(pm.map(r => r.key), ['CASH', 'KBZ', 'AYA', 'WAVE']) && same(pm.map(r => r.key), legacyPayMethods(p)) && pm[2].label === 'AYA ဘဏ်' && pm.every(r => r.label === legacyMethodLabel(p, r.key)),
    'custom Settings pay_methods and a Messages label for AYA: the same keys and labels as today', pm.map(r => [r.key, r.label]));
  check(same(ec.map(r => [r.key, r.label]), [['rent', 'ဆိုင်ခ'], ['water', 'ရေဖိုး'], ['tips', 'tips'], ['other', MSG.cat_other]]) && same(ec.map(r => [r.key, r.label]), legacyExpenseCategories(p)) && ec[0].detail === '🏠' && ec[1].detail === '',
    'custom Settings expense_categories (key:label, a key without a label, other appended): the same as today', ec.map(r => [r.key, r.label]));
  check(same(fb.map(r => r.label), ['ဂျာစီ', 'ပိုး']) && same(fb.map(r => r.label), legacyFabricPresets(p)) && same(fb.map(r => r.key), ['f1', 'f2']), 'custom Settings fabric_presets: the same as today');
  check(allTrue(agreesWithLegacy(p)), 'and the public helpers agree with today\'s code for those Settings', agreesWithLegacy(p));
  delete w.settings.pay_methods; delete w.settings.expense_categories; delete w.settings.fabric_presets; delete w.messages.method_AYA;
  w.messages.cat_food = 'စားစရိတ်';
  check(legacyListRows(p, 'expense_category').filter(r => r.key === 'food')[0].label === 'စားစရိတ်' && same(legacyListRows(p, 'fabric').map(r => r.label), CFG.FABRIC_PRESETS) && allTrue(agreesWithLegacy(p)),
    'no Settings rows at all: the CFG defaults, a Messages cat_<key> label included');
  delete w.messages.cat_food;

  resetWarned();
  w.settings.pay_methods = 'CASH,KBZ,LONG_ACCOUNT_KEY_1,ဘဏ်လွှဲငွေအကောင့်';
  const e0 = w.errors.length;
  pm = legacyListRows(p, 'pay_method');
  legacyListRows(p, 'pay_method');
  const viaPay = payMethods(p);
  check(same(pm.map(r => r.key), ['CASH', 'KBZ']) && same(viaPay, legacyPayMethods(p)) && w.errors.length === e0 + 2 && w.errors.slice(e0).every(e => e.where === 'pay_methods'),
    'the 12-byte rule: an oversize Settings key is left out and logged once per key', w.errors.slice(e0));
  w.settings.pay_methods = 'LONG_ACCOUNT_KEY_2';
  check(same(legacyListRows(p, 'pay_method').map(r => r.key), CFG.DEFAULT_PAY_METHODS) && same(payMethods(p), legacyPayMethods(p)), 'only oversize keys: the default methods, as today');
  w.settings.pay_methods = 'CASH,a|b,KBZ';
  check(same(payMethods(p), ['CASH', 'KBZ']), 'a Settings key with | (it would break the callback data) is skipped');
  w.settings.expense_categories = 'food:စား,food:ထပ်,drink:သောက်';
  check(same(expenseCategories(p), [['food', 'စား'], ['drink', 'သောက်'], ['other', MSG.cat_other]]), 'a Settings category key written twice is offered once (the first label)');
  delete w.settings.pay_methods; delete w.settings.expense_categories;

  const before = JSON.stringify(CFG.LIST_NAMES.map(n => legacyListRows(p, n)));
  w.lists.push(acct('AYA', 'AYA'), row('fabric', 'x1', 'ဂျာစီ'), row('expense_category', 'water', 'ရေဖိုး'));
  w.settings.lists_json = JSON.stringify({ pay_method: [{ k: 'CB', l: 'CB', a: 1, o: 1, s: '', d: '' }] });
  check(JSON.stringify(CFG.LIST_NAMES.map(n => legacyListRows(p, n))) === before, 'legacyListRows never reads the Lists tab or lists_json');
}

/* ------------------------------ B. sources ------------------------------ */

step('B. listRows: the Lists tab first, then lists_json, then the legacy rows; per list; a read-only memo');
{
  const w = newWorld(), p = w.ports;
  const legacy = n => JSON.stringify(legacyListRows(p, n));
  check(CFG.LIST_NAMES.every(n => JSON.stringify(listRows(p, n)) === legacy(n)), 'no Lists rows and no lists_json: the legacy rows');
  const raw = JSON.stringify({
    pay_method: [{ k: 'CASH', l: 'ငွေသား', a: 1, o: 1, s: '', d: '' }, { k: 'AYA', l: 'AYA ဦးမောင်', a: 1, o: 2, s: 'S1', d: '001 ဦးမောင်' }, { k: 'OLD', l: 'Old', a: 0, o: 3, s: '', d: '' }],
    expense_category: [], fabric: []
  });
  w.settings.lists_json = raw;
  let rows = listRows(p, 'pay_method');
  check(same(rows.map(r => r.key), ['CASH', 'AYA', 'OLD']) && rows[1].label === 'AYA ဦးမောင်' && rows[1].shop === 'S1' && rows[1].detail === '001 ဦးမောင်' && rows[1].note === '' && rows[2].active === false,
    'Settings lists_json (compact rows) is the second source', rows);
  check(JSON.stringify(listRows(p, 'expense_category')) === legacy('expense_category') && JSON.stringify(listRows(p, 'fabric')) === legacy('fabric'), 'a list with no rows in lists_json falls back on its own (per-list fallback)');
  w.lists.push(acct('CB', 'CB Bank'));
  check(same(listRows(p, 'pay_method').map(r => r.key), ['CB']) && JSON.stringify(listRows(p, 'fabric')) === legacy('fabric'), 'store.listOptions wins as soon as the Lists tab has a row of that list; the other lists keep their source');
  w.lists = [];
  [['not valid JSON', '{oops'], ['a JSON array', '[1,2]'], ['a JSON string', '"x"'], ['a number', 5], ['an empty string', ''],
   ['rows without a key', JSON.stringify({ pay_method: [{ l: 'no key' }, null, 'x'] })], ['another shape', JSON.stringify({ pay_method: { k: 'A' } })]].forEach(([what, v]) => {
    w.settings.lists_json = v;
    check(JSON.stringify(listRows(p, 'pay_method')) === legacy('pay_method'), 'lists_json that is ' + what + ' counts as absent: the legacy rows');
  });
  w.settings.lists_json = raw;
  rows = listRows(p, 'pay_method');
  rows[0].label = 'changed';
  rows[1].active = false;
  rows.push({ key: 'X' });
  rows.splice(0, 1);
  const again = listRows(p, 'pay_method');
  check(same(again.map(r => r.key), ['CASH', 'AYA', 'OLD']) && again[0].label === 'ငွေသား' && again[1].active === true, 'mutating the rows one call returned never changes the next call (the memo is read-only)');
  const w2 = newWorld(), p2 = w2.ports;
  w2.settings.lists_json = raw;
  listRows(p, 'pay_method');
  listRows(p2, 'pay_method');
  const up = listsJsonUpsert(w.settings.lists_json, 'pay_method', [], { key: 'CBNEW', label: 'CB ဒေါ်လှ' });
  w.settings.lists_json = up.raw;
  check(up.status === 'ok' && listRows(p, 'pay_method').some(r => r.key === 'CBNEW') && !listRows(p2, 'pay_method').some(r => r.key === 'CBNEW') && w2.settings.lists_json === raw && listRows(p2, 'pay_method').length === 3,
    'two worlds holding the same lists_json string stay independent: an add on one is not seen by the other');
}

/* ------------------------------ C. normalisation ------------------------------ */

step('C. Normalisation of every source row; listOptions filters and order');
{
  resetWarned();
  const w = newWorld(), p = w.ports;
  w.lists = [
    acct(' aya ', '  AYA ဦးမောင် ', { active: true, order: 2, shop: 's1', detail: ' 001 ', note: ' n ' }),
    acct('', 'blank key'),
    acct('AYA', 'a repeated key'),
    acct('A|B', 'a bar in the key'),
    acct('kbz', ''),
    acct('WAVE', 'Wave', { order: '' }),
    acct('CB', 'CB', { order: 1, shop: 'S3' }),
    acct('OFF', 'Off', { active: false, order: 3 }),
    row('expense_category', 'Water', 'ရေဖိုး', { detail: '💧' }),
    row('expense_category', 'WATER', 'again')
  ];
  const e0 = w.errors.length;
  const rows = listRows(p, 'pay_method');
  listRows(p, 'pay_method');
  listOptions(p, 'pay_method');
  check(same(rows.map(r => r.key), ['AYA', 'KBZ', 'WAVE', 'CB', 'OFF']), 'pay_method keys are trimmed and upper-cased; a blank key, a repeated key and a key with | are skipped', rows.map(r => r.key));
  check(errorsOf(w, 'lists').length === 1 && w.errors.length === e0 + 1 && w.errors[e0].message.includes('A|B'), 'the key with | is logged once', w.errors.slice(e0));
  check(rows[0].label === 'AYA ဦးမောင်' && rows[0].shop === 'S1' && rows[0].detail === '001' && rows[0].note === 'n' && rows[0].order === 2 && rows[0].active === true, 'label, detail and note are trimmed; the shop is upper-cased', rows[0]);
  check(rows[1].label === 'KBZ' && rows[2].order === 0 && rows[3].shop === '' && rows[4].active === false, 'a blank label shows the key; a blank Order is 0; an unknown shop is blank (both shops); Active false stays false');
  check(same(listRows(p, 'expense_category').map(r => r.key), ['water']) && categoryLabel(p, 'Water') === 'ရေဖိုး' && categoryLabel(p, 'WATER') === 'ရေဖိုး',
    'the other lists lower-case their keys: a hand-typed "Water" is the category "water" the ledger stores');
  check(same(listOptions(p, 'pay_method').map(r => r.key), ['CB', 'AYA', 'KBZ', 'WAVE']), 'listOptions: the active rows by Order, rows without an Order last in sheet order', listOptions(p, 'pay_method').map(r => r.key));
  check(same(listOptions(p, 'pay_method', null, true).map(r => r.key), ['CB', 'AYA', 'OFF', 'KBZ', 'WAVE']), 'includeInactive adds the retired rows');
  check(same(listOptions(p, 'pay_method', 'S2').map(r => r.key), ['CB', 'KBZ', 'WAVE']) && same(listOptions(p, 'pay_method', 'S1').map(r => r.key), ['CB', 'AYA', 'KBZ', 'WAVE']) && same(listOptions(p, 'pay_method', 's1').map(r => r.key), ['CB', 'AYA', 'KBZ', 'WAVE']),
    'a shop sees its own rows and the rows with a blank Shop');
  check(listOption(p, 'pay_method', 'off').label === 'Off' && listOption(p, 'pay_method', ' Aya ').key === 'AYA' && listOption(p, 'pay_method', 'nope') === null && listOption(p, 'pay_method', '') === null && listOption(p, 'pay_method', null) === null,
    'listOption finds a row by its key in any case, a retired one included');
  const odd = listNormRows(null, 'fabric', [{ key: 'A', order: 'abc' }, { key: 'B', order: -3 }, { key: 'C', order: Infinity }, { key: 'D', order: true }, { key: 'E', order: '2.5' },
    { key: 'F', active: 'FALSE' }, { key: 'G', active: 0 }, { key: 'H', active: '' }, { key: 'I', active: null }, { key: 'J', active: 'no' }, { key: 5, label: 7 }, null, 'x']);
  check(same(odd.map(r => r.order), [0, 0, 0, 0, 2.5, 0, 0, 0, 0, 0, 0]) && same(odd.map(r => r.active), [true, true, true, true, true, false, false, true, true, false, true]) && odd[10].key === '5' && odd[10].label === '7' && odd[0].key === 'a',
    'Order is a finite number above 0, else 0; Active is a boolean (blank = true); a number typed as key or label becomes text', odd);
}

/* ------------------------------ D. accounts as methods ------------------------------ */

step('D. payMethods, methodKnown, methodLabel: per shop, the 12-byte rule, the cap');
{
  resetWarned();
  const w = newWorld(), p = w.ports;
  w.lists = [acct('CASH', 'ငွေသား', { order: 9, active: false }), acct('KBZ', 'KBZPay', { order: 2 }), acct('S1ONLY', 'ဆိုင် ၁ အကောင့်', { order: 3, shop: 'S1' }),
             acct('S2ONLY', 'ဆိုင် ၂ အကောင့်', { order: 1, shop: 'S2' }), acct('GONE', 'Retired', { order: 4, active: false })];
  check(same(payMethods(p, 'S1'), ['CASH', 'KBZ', 'S1ONLY']) && same(payMethods(p, 'S2'), ['CASH', 'S2ONLY', 'KBZ']) && same(payMethods(p), ['CASH', 'S2ONLY', 'KBZ', 'S1ONLY']),
    'CASH first (whatever its own row says), then the active accounts of that shop by Order; no shop = every shop\'s', [payMethods(p, 'S1'), payMethods(p, 'S2'), payMethods(p)]);
  check(methodKnown(p, 'GONE') && methodKnown(p, 'CASH') && methodKnown(p, 'kbz') && methodKnown(p, 'S2ONLY') && !methodKnown(p, 'NOPE') && !methodKnown(p, '') && !methodKnown(p, null),
    'methodKnown: CASH and every pay_method row, a retired account included');
  check(methodLabel(p, 'GONE') === 'Retired' && methodLabel(p, 'gone') === 'Retired' && methodLabel(p, 'CASH') === 'ငွေသား' && methodLabel(p, '') === '', 'methodLabel resolves a retired account');
  w.messages.method_AYA = 'AYA (Messages)';
  check(methodLabel(p, 'AYA') === 'AYA (Messages)' && methodLabel(p, 'WAVE') === MSG.method_WAVE && methodLabel(p, 'ZZZ') === 'ZZZ' && !methodKnown(p, 'AYA'), 'a key with only a Messages label uses it; an unknown key shows itself');
  check(accountDetail(p, 'KBZ') === '' && accountDetail(p, 'NOPE') === '', 'accountDetail is blank until a number is set');
  w.lists.push(acct('AYA_BANK_TRANSFER', 'too long', { order: 5 }), acct('ဘဏ်လွှဲငွေ', 'Burmese key', { order: 6 }));
  const e0 = w.errors.length;
  const got = payMethods(p, 'S1');
  payMethods(p, 'S1');
  payMethods(p);
  check(same(got, ['CASH', 'KBZ', 'S1ONLY']) && w.errors.length === e0 + 2 && w.errors.slice(e0).every(e => e.where === 'pay_methods'), 'a Lists key over 12 bytes is left out of the buttons and logged once', w.errors.slice(e0));
  check(methodKnown(p, 'AYA_BANK_TRANSFER') && methodLabel(p, 'AYA_BANK_TRANSFER') === 'too long', 'but it stays a known method with its label (old rows keep reading)');

  w.lists = [acct('CASH', 'ငွေသား', { order: 1 })].concat(Array.from({ length: 14 }, (_, i) => acct('ACC' + (i + 1), 'Account ' + (i + 1), { order: i + 2 })));
  const e1 = w.errors.length;
  const capped = payMethods(p);
  payMethods(p);
  payMethods(p, 'S1');
  payMethods(p, 'S1');
  check(CFG.MAX_BANK_BUTTONS === 12 && capped.length === 13 && capped[0] === 'CASH' && capped[12] === 'ACC12' && capped.indexOf('ACC13') < 0, 'at most CFG.MAX_BANK_BUTTONS (12) accounts are offered', capped);
  check(w.errors.length === e1 + 2 && w.errors.slice(e1).every(e => e.where === 'pay_methods' && e.message.includes('ACC13') && e.message.includes('ACC14')), 'the accounts beyond the cap are logged once (once for every shop, once for S1)', w.errors.slice(e1));
  check(methodKnown(p, 'ACC14') && methodLabel(p, 'ACC14') === 'Account 14', 'and stay known methods');
}

/* ------------------------------ E. categories and fabrics ------------------------------ */

step('E. A seeded Lists tab; expense categories, their emoji, fabrics');
{
  const w = newWorld({ lists: true }), p = w.ports;
  check(w.lists.length === 4 + CFG.EXPENSE_CATEGORIES.length + 3 + CFG.CATEGORIES.length && w.lists.every(r => r.active === true && r.shop === '' && r.order >= 1), 'simSeedLists wrote the four lists (item_category last, round 6b): every row active, ordered, for both shops', w.lists.length);
  check(allTrue(agreesWithLegacy(p)) && same(payMethods(p, 'S1'), legacyPayMethods(p)) && same(payMethods(p, 'S2'), legacyPayMethods(p)), 'a freshly seeded Lists tab offers exactly what version 3 offered', agreesWithLegacy(p));
  w.lists.push(row('expense_category', 'water', 'ရေဖိုး', { order: 20, detail: '💧' }), row('expense_category', 'gift', 'လက်ဆောင်', { order: 21 }), row('expense_category', 'old', 'အဟောင်း', { order: 22, active: false }));
  const cats = expenseCategories(p);
  check(cats.some(c => c[0] === 'water' && c[1] === 'ရေဖိုး') && cats.some(c => c[0] === 'gift') && !cats.some(c => c[0] === 'old') && cats.filter(c => c[0] === 'other').length === 1,
    'expenseCategories: the active rows as [key, label]; a retired category is not offered; other is there once', cats.map(c => c[0]));
  check(categoryLabel(p, 'old') === 'အဟောင်း' && categoryLabel(p, 'water') === 'ရေဖိုး' && categoryLabel(p, 'nope') === 'nope' && categoryLabel(p, '') === MSG.cat_other, 'categoryLabel resolves a retired category; an unknown key shows itself');
  check(expenseEmoji(p, 'water') === '💧' && expenseEmoji(p, 'food') === '🍚' && expenseEmoji(p, 'FOOD') === '🍚' && expenseEmoji(p, 'gift') === '📦' && expenseEmoji(p, 'nope') === '📦' && expenseEmoji(p, 'constructor') === '📦',
    'expenseEmoji: the row\'s Detail, else the built-in emoji of the key, else the box');
  w.lists.filter(r => r.list === 'expense_category' && r.key === 'food')[0].detail = '';
  check(expenseEmoji(p, 'food') === '🍚', 'a category row without a Detail still gets its built-in emoji');
  check(categoryEmoji('dress') === '🧵' && categoryEmoji('ထမီ') === '👗' && categoryEmoji.length === 1, 'the existing categoryEmoji(category) is untouched: it still returns the ITEM category emoji');
  check(expenseCategoryKey(p, 'ရေဖိုး ပေးလိုက်တယ်') === 'water' && expenseCategoryKey(p, 'WATER') === 'water' && expenseCategoryKey(p, 'အဟောင်း') === 'other', 'expenseCategoryKey maps a spoken label to the key of an active category');
  w.lists.filter(r => r.list === 'expense_category' && r.key === 'other')[0].active = false;
  const cats2 = expenseCategories(p);
  check(cats2[cats2.length - 1][0] === 'other' && cats2[cats2.length - 1][1] === MSG.cat_other && cats2.filter(c => c[0] === 'other').length === 1, 'other cannot be retired: it is appended when no active row has it');
  w.lists.push(row('fabric', 'jersey', 'ဂျာစီ', { order: 0 }), row('fabric', 'lace', 'ဇာ', { order: 1.5 }), row('fabric', 'gone', 'မရှိတော့', { active: false }));
  check(same(fabricPresets(p), ['ပိုး', 'ဇာ', 'ချည်', 'ပုဝါ', 'ဂျာစီ']) && same(fabricOptions(p).map(f => f.key), ['f1', 'lace', 'f2', 'f3', 'jersey']) && fabricOptions(p).every(f => f.list === 'fabric' && f.active),
    'fabricOptions: the active fabric rows by Order; fabricPresets (core_orders.js) is their labels', fabricPresets(p));
}

/* ------------------------------ F. the upsert rule ------------------------------ */

step('F. listUpsert: the one rule for adding an option and setting a detail');
{
  const seed = legacyListRows(newWorld().ports, 'pay_method');
  let r = listUpsert([], { list: 'pay_method', key: 'aya', label: ' AYA ဦးမောင် ', note: 'by test' }, seed);
  check(r.status === 'ok' && r.key === 'AYA' && r.ops.length === 5 && r.ops.every(o => o.op === 'append') && same(r.ops.slice(0, 4).map(o => o.row.key), ['CASH', 'KBZ', 'WAVE', 'BANK']) && r.rows.length === 5,
    'an empty list is seeded first: the four old methods, then the new account', r.ops.map(o => o.row && o.row.key));
  check(same(r.ops[4].row, { list: 'pay_method', key: 'AYA', label: 'AYA ဦးမောင်', active: true, order: 5, shop: '', detail: '', note: 'by test' }), 'the appended row: active, Order = the largest + 1, Shop blank', r.ops[4].row);
  const stored = r.rows, snapshot = JSON.stringify(stored);
  r = listUpsert(stored, { list: 'pay_method', key: 'CB', label: 'CB Bank', shop: 'S2', detail: '0099', note: 'n' }, seed);
  check(r.status === 'ok' && same(r.ops, [{ op: 'append', row: { list: 'pay_method', key: 'CB', label: 'CB Bank', active: true, order: 6, shop: 'S2', detail: '0099', note: 'n' } }]) && r.rows.length === 6, 'a list that has rows is not seeded again: one append', r.ops);
  check(JSON.stringify(stored) === snapshot && r.rows !== stored && r.rows[0] !== stored[0] && r.ops[0].row !== r.rows[5], 'pure: the rows passed in are not touched, the result holds new objects');
  r = listUpsert(stored, { list: 'pay_method', key: 'ZZZ', detail: '123' }, seed);
  check(r.status === 'dup' && r.ops.length === 0 && r.key === 'ZZZ' && r.rows.length === 5, 'an absent key without a label is dup: an account number alone never creates an option');
  r = listUpsert(stored, { list: 'pay_method', key: 'aya', detail: ' 001 ' }, seed);
  check(r.status === 'ok' && same(r.ops, [{ op: 'set', key: 'AYA', field: 'detail', value: '001' }]) && r.key === 'AYA' && r.rows[4].detail === '001', 'detail: set while none is stored (keys compare in any case; the stored key comes back)', r.ops);
  const withDetail = r.rows;
  r = listUpsert(withDetail, { list: 'pay_method', key: 'AYA', detail: '001' }, seed);
  check(r.status === 'dup' && r.ops.length === 0, 'detail: the same value again is dup');
  r = listUpsert(withDetail, { list: 'pay_method', key: 'AYA', detail: '002', detailWas: '001' }, seed);
  check(r.status === 'ok' && same(r.ops, [{ op: 'set', key: 'AYA', field: 'detail', value: '002' }]), 'detail: replaced when detailWas is the stored value (the user replaced what they were looking at)');
  r = listUpsert(withDetail, { list: 'pay_method', key: 'AYA', detail: '003', detailWas: '000' }, seed);
  const noWas = listUpsert(withDetail, { list: 'pay_method', key: 'AYA', detail: '003' }, seed), blankWas = listUpsert(withDetail, { list: 'pay_method', key: 'AYA', detail: '003', detailWas: '' }, seed);
  check(r.status === 'dup' && r.ops.length === 0 && r.rows[4].detail === '001' && noWas.status === 'dup' && blankWas.status === 'dup', 'detail: a stale edit (detailWas is not the stored value, or missing) never overwrites a newer one');
  const blank = listNormRows(null, 'pay_method', [{ key: 'KBZ', label: '' }, { key: 'WAVE', label: 'WavePay', order: 3, shop: 'S1', active: false }]);
  r = listUpsert(blank, { list: 'pay_method', key: 'kbz', label: 'KBZ ဒေါ်လှ' }, seed);
  check(r.status === 'ok' && same(r.ops, [{ op: 'set', key: 'KBZ', field: 'label', value: 'KBZ ဒေါ်လှ' }]), 'label: set while the stored label is blank');
  r = listUpsert(blank, { list: 'pay_method', key: 'WAVE', label: 'Wave new name', shop: 'S2', detail: '' }, seed);
  check(r.status === 'dup' && r.ops.length === 0 && r.rows[1].label === 'WavePay' && r.rows[1].shop === 'S1' && r.rows[1].active === false && r.rows[1].order === 3, 'label: a stored label is never replaced; Active, Order and Shop are never touched', r.rows[1]);
  r = listUpsert(blank, { list: 'pay_method', key: 'WAVE', label: 'x', detail: '0911' }, seed);
  check(r.status === 'ok' && same(r.ops, [{ op: 'set', key: 'WAVE', field: 'detail', value: '0911' }]), 'a rec with a label and a detail sets only what the rule allows');
  const orders = listNormRows(null, 'fabric', [{ key: 'a', order: 3 }, { key: 'b' }, { key: 'c', order: 7 }]);
  check(listUpsert(orders, { list: 'fabric', key: 'D', label: 'd' }).ops[0].row.order === 8 && listUpsert(listNormRows(null, 'fabric', [{ key: 'a' }]), { list: 'fabric', key: 'd', label: 'd' }).ops[0].row.order === 1,
    'the Order of a new row is the largest Order + 1 (1 when no row has one)');
  const named = listNormRows(null, 'fabric', [{ key: 'silk', label: 'ပိုး' }]);
  check(listUpsert(named, { list: 'fabric', key: 'SILK', label: 'x' }).key === 'silk' && listUpsert(named, { list: 'fabric', key: 'SILK', label: 'x' }).status === 'dup' && listUpsert(orders, { list: 'fabric', key: 'D', label: 'd' }).key === 'd',
    'the other lists compare and store their keys in lower case');
  const relabel = listUpsert(orders, { list: 'fabric', key: 'B', label: 'ချည်' });
  check(relabel.status === 'ok' && same(relabel.ops, [{ op: 'set', key: 'b', field: 'label', value: 'ချည်' }]), 'a stored label that is just the key counts as blank and takes the label');
  const bad1 = listUpsert([], { list: 'fabric', key: '', label: 'x' }, orders), bad2 = listUpsert([], { list: 'fabric', key: 'a|b', label: 'x' }, orders);
  check(bad1.status === 'dup' && bad1.ops.length === 0 && bad2.status === 'dup' && bad2.ops.length === 0, 'a blank key or a key with | writes nothing');
  const noSeed = listUpsert([], { list: 'fabric', key: 'x1', label: 'ဇာ' });
  check(noSeed.status === 'ok' && noSeed.ops.length === 1 && noSeed.ops[0].row.order === 1 && noSeed.rows.length === 1, 'no seed rows given: just the new row');
  const seeded = listUpsert([], { list: 'pay_method', key: 'KBZ', detail: '0977', detailWas: '' }, seed);
  check(seeded.status === 'ok' && seeded.ops.length === 5 && seeded.ops[4].op === 'set' && seeded.rows.filter(x => x.key === 'KBZ')[0].detail === '0977' && seed[1].detail === '', 'a number for an old method on an empty list: the seed is written, then the detail is set (the seed rows passed in stay as they were)');
}

/* ------------------------------ G. hash and keys ------------------------------ */

step('G. listHash, listNameKey and listKeyFor');
{
  const ref = s => { let h = 0x811c9dc5; for (const b of Buffer.from(s, 'utf8')) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); };
  const samples = ['', 'a', 'foobar', 'KBZ ဦးမောင်', 'ရေဖိုး', '😀 emoji', 'x'.repeat(500)];
  check(listHash('') === '811c9dc5' && listHash('a') === 'e40c292c' && listHash('foobar') === 'bf9cf968', 'listHash is 32-bit FNV-1a (the published test vectors)');
  check(samples.every(s => listHash(s) === ref(s) && /^[0-9a-f]{8}$/.test(listHash(s))) && listHash('abc') === listHash('abc') && listHash(null) === listHash(''),
    'stable, 8 lower-case hex digits, equal to a Math.imul reference over the UTF-8 bytes (Burmese, emoji, long text)');
  check(listNameKey(' KBZ  ဦးမောင် ') === listNameKey('kbz' + ZWSP + 'ဦး' + ZWNJ + 'မောင်' + BOM) && listNameKey('KBZ' + NBSP + 'Pay') === 'kbzpay' && listNameKey(null) === '' && listNameKey('KBZ ဦးမောင်') !== listNameKey('KBZ ဦးမောင်း'),
    'listNameKey ignores spaces, letter case and the invisible characters, nothing else');
  const w = newWorld(), p = w.ports, p2 = newWorld().ports;
  const k1 = listKeyFor(p, 'pay_method', 'KBZ ဦးမောင်', []);
  check(/^KBZ[0-9A-F]{4}$/.test(k1) && k1 === 'KBZ' + listHash(listNameKey('KBZ ဦးမောင်')).slice(0, 4).toUpperCase(), 'pay_method key: the ASCII letters of the label + 4 hex digits of the name hash, upper case', k1);
  check(k1 === listKeyFor(p2, 'pay_method', 'kbz  ဦးမောင်' + ZWSP, ['CASH', 'KBZ']) && k1 !== listKeyFor(p2, 'pay_method', 'KBZ ဒေါ်လှ', []), 'two devices derive the same key for the same name (spacing, case and zero-width characters aside), another name gives another key');
  const kNum = listKeyFor(p, 'pay_method', '09 777 123456', []), kBur = listKeyFor(p, 'expense_category', 'ရေဖိုး', []), kFab = listKeyFor(p, 'fabric', 'ဂျာစီ', []),
        kLong = listKeyFor(p, 'pay_method', 'AYA Bank Special Account', []), kMix = listKeyFor(p, 'expense_category', 'Water Bill 2', []);
  check(/^B097771[0-9A-F]{4}$/.test(kNum), 'a label that starts with digits ("09 777 123456") gets the list prefix: the key starts with a letter', kNum);
  check(/^c[0-9a-f]{4}$/.test(kBur) && /^f[0-9a-f]{4}$/.test(kFab), 'a Burmese-only label: prefix + hash (c for a category, f for a fabric), lower case', [kBur, kFab]);
  check(/^AYABANK[0-9A-F]{4}$/.test(kLong) && /^waterbi[0-9a-f]{4}$/.test(kMix), 'the slug is the first 7 ASCII letters and digits', [kLong, kMix]);
  check([k1, kNum, kBur, kFab, kLong, kMix].every(k => Buffer.byteLength(k, 'utf8') <= 11 && /^[A-Za-z][A-Za-z0-9]*$/.test(k)), 'every key is at most 11 bytes of letters and digits and starts with a letter');
  check(listKeyFor(p, 'pay_method', 'CASH', []) !== 'CASH' && /^CASH[0-9A-F]{4}$/.test(listKeyFor(p, 'pay_method', 'cash', [])) && listKeyFor(p, 'expense_category', 'other', []) !== 'other' && /^other[0-9a-f]{4}$/.test(listKeyFor(p, 'expense_category', 'Other', [])),
    'never CASH, never other');
  let draws = 0;
  const seq = ['aaaa1111-0000', 'bbbb2222-0000', 'cccc3333-0000'];
  const p3 = Object.assign({}, p, { uuid: () => seq[Math.min(draws++, seq.length - 1)] });
  const kClash = listKeyFor(p3, 'pay_method', 'KBZ ဦးမောင်', [k1.toLowerCase(), 'KBZAAAA', 'kbzbbbb']);
  check(kClash === 'KBZCCCC' && draws === 3, 'a clash with another option takes 4 hex digits from ports.uuid(), drawing again while that key is taken too (existing keys compare in any case)', [kClash, draws]);
  draws = 0;
  const p4 = Object.assign({}, p, { uuid: () => { draws++; return 'aaaa1111-0000'; } });
  listKeyFor(p4, 'pay_method', 'KBZ ဦးမောင်', [k1, 'KBZAAAA']);
  check(draws === 5, 'at most 5 draws');
  draws = 0;
  listKeyFor(p4, 'pay_method', 'KBZ ဦးမောင်', []);
  check(draws === 0, 'no clash: ports.uuid() is not used at all (the key depends on the name only)');
}

/* ------------------------------ H. add by label ------------------------------ */

step('H. addListOptionByLabel: the ➕ of every pick list');
{
  const w = newWorld({ lists: true }), p = w.ports;
  let events = 0;
  w.listeners.push(e => { if (e.type === 'lists') events++; });
  const n0 = w.lists.length, today = dayKey(p.clock.now());
  const a = addListOptionByLabel(p, 'pay_method', '  AYA\n ဦးမောင်  ' + ZWSP, sister);
  const stored = w.lists[w.lists.length - 1];
  check(a.ok && a.created === true && !a.existed && a.label === 'AYA ဦးမောင်' && /^AYA[0-9A-F]{4}$/.test(a.key) && w.lists.length === n0 + 1 && events === 1, 'a new name is created: a cleaned label, a derived key, one Lists row, a lists event', a);
  check(same(stored, { list: 'pay_method', key: a.key, label: 'AYA ဦးမောင်', active: true, order: 5, shop: '', detail: '', note: 'added by Sister (S1) ' + today }), 'the row: active, Order after the old ones, both shops, the note says who and when', stored);
  check(payMethods(p, 'S1').indexOf(a.key) === 4 && payMethods(p, 'S2').indexOf(a.key) === 4 && methodLabel(p, a.key) === 'AYA ဦးမောင်' && methodKnown(p, a.key), 'it is a method button for both shops at once');
  const variants = ['aya ဦးမောင်', 'AYA  ဦးမောင်', 'AYAဦးမောင်', 'AYA ဦး' + ZWSP + 'မောင်', BOM + 'AYA ဦးမောင်', 'AYA' + NBSP + 'ဦး' + ZWNJ + 'မောင်'];
  const again = variants.map(v => addListOptionByLabel(p, 'pay_method', v, brother));
  check(again.every(x => x.ok && x.existed === true && !x.created && x.key === a.key && x.label === 'AYA ဦးမောင်') && w.lists.length === n0 + 1 && events === 1,
    'the same name again (letter case, spacing, a zero-width space) is the existing option: nothing is written', again);
  stored.active = false;
  const retired = addListOptionByLabel(p, 'pay_method', 'AYA ဦးမောင်', sister);
  check(retired.existed === true && retired.key === a.key && w.lists.length === n0 + 1, 'a retired option with that name is reused, not duplicated');
  stored.active = true;
  check(addListOptionByLabel(p, 'pay_method', MSG.method_KBZ, sister).key === 'KBZ' && addListOptionByLabel(p, 'pay_method', MSG.method_KBZ, sister).existed === true, 'the label of an old method gives its old key');
  const empties = ['', '   ', ZWSP + BOM, '\n', '20000', '၂၀,၀၀၀', '09 777-123 (456)', '1.5', '+95 9 777 / 888', ZWNJ, null, undefined];
  check(empties.every(v => same(addListOptionByLabel(p, 'pay_method', v, sister), { ok: false, reason: 'empty' })) && w.lists.length === n0 + 1,
    'nothing usable, or digits only (a mistyped amount must not become an option), is refused as empty', empties.map(v => addListOptionByLabel(p, 'pay_method', v, sister).reason));
  const long = addListOptionByLabel(p, 'expense_category', 'စာရေးကိရိယာ နှင့် ရုံးသုံးပစ္စည်းများ ဝယ်ယူခြင်း အတွက် ကုန်ကျစရိတ် အားလုံး', sister);
  check(long.created && long.label.length <= CFG.LIST_LABEL_MAX && long.label.length > 30 && long.label === long.label.trim() && /^c[0-9a-f]{4}$/.test(long.key) && categoryLabel(p, long.key) === long.label,
    'a long name is cut to ' + CFG.LIST_LABEL_MAX + ' characters', long);
  const fab = addListOptionByLabel(p, 'fabric', 'ဂျာစီ', sister);
  check(fab.created && same(fabricPresets(p), ['ပိုး', 'ချည်', 'ပုဝါ', 'ဂျာစီ']) && w.lists[w.lists.length - 1].order === 4, 'a fabric is added after the old ones', fabricPresets(p));
  check(same(addListOptionByLabel(p, 'nope', 'x y', sister), { ok: false, reason: 'unavailable' }), 'an unknown list name is refused');

  const p2 = Object.assign({}, p, { store: Object.assign({}, p.store) });
  delete p2.store.addListOption;
  check(same(addListOptionByLabel(p2, 'pay_method', 'CB ဒေါ်လှ', sister), { ok: false, reason: 'unavailable' }) && addListOptionByLabel(p2, 'pay_method', 'aya ဦးမောင်', sister).existed === true,
    'a store without addListOption: unavailable for a new name, an existing name is still found');

  const p5 = Object.assign({}, p, { store: Object.assign({}, p.store) });
  p5.store.addListOption = (rec, seed) => { p.store.addListOption(Object.assign({}, rec, { note: 'the other seller' }), seed); return p.store.addListOption(rec, seed); };
  const m0 = w.lists.length;
  const race = addListOptionByLabel(p5, 'pay_method', 'CB ဒေါ်လှ', sister);
  check(race.ok && race.existed === true && !race.created && w.lists.length === m0 + 1 && methodLabel(p, race.key) === 'CB ဒေါ်လှ' && race.label === 'CB ဒေါ်လှ',
    'two sellers adding the same name in the same moment end with one row (the same derived key; the second is told it exists)', race);

  const w3 = newWorld(), p6 = w3.ports;
  const oldCats = expenseCategories(p6).map(c => c[0]), oldPay = payMethods(p6), oldFab = fabricPresets(p6);
  const wat = addListOptionByLabel(p6, 'expense_category', 'ရေဖိုး', sister);
  const nowCats = expenseCategories(p6).map(c => c[0]);
  check(wat.created && w3.lists.length === oldCats.length + 1 && oldCats.every(k => nowCats.indexOf(k) >= 0) && nowCats.indexOf(wat.key) >= 0 && nowCats.length === oldCats.length + 1,
    'seed on the first add: adding one category on a sheet without Lists rows keeps every old category next to the new one', nowCats);
  check(w3.lists.every(r => r.list === 'expense_category') && same(payMethods(p6), oldPay) && same(fabricPresets(p6), oldFab) && expenseEmoji(p6, 'food') === '🍚' && categoryLabel(p6, 'food') === MSG.cat_food,
    'only that list was seeded (labels and emoji kept); accounts and fabrics still come from the old Settings');
}

/* ------------------------------ I. account numbers ------------------------------ */

step('I. setListDetail: the number of an account');
{
  const w = newWorld({ lists: true }), p = w.ports;
  const a = addListOptionByLabel(p, 'pay_method', 'AYA ဦးမောင်', sister);
  let r = setListDetail(p, 'pay_method', a.key.toLowerCase(), '  09 777 123456\n ဦးမောင်  ');
  check(same(r, { ok: true, saved: true, detail: '09 777 123456 ဦးမောင်' }) && accountDetail(p, a.key) === '09 777 123456 ဦးမောင်' && w.lists[w.lists.length - 1].detail === '09 777 123456 ဦးမောင်', 'saved as one clean line (the leading 0 kept as text); accountDetail reads it', r);
  r = setListDetail(p, 'pay_method', a.key, '09 777 123456 ဦးမောင်');
  check(same(r, { ok: true, saved: false, detail: '09 777 123456 ဦးမောင်' }), 'the same number again: nothing to save');
  r = setListDetail(p, 'pay_method', a.key, '09 888 000111 ဦးမောင်');
  check(r.ok && r.saved === true && r.detail === '09 888 000111 ဦးမောင်' && accountDetail(p, a.key) === '09 888 000111 ဦးမောင်', 'a wrong number is corrected by typing the right one');
  const p2 = Object.assign({}, p, { store: Object.assign({}, p.store) });
  p2.store.addListOption = (rec, seed) => { w.lists.filter(x => x.key === a.key)[0].detail = '0012345 (laptop)'; return p.store.addListOption(rec, seed); };
  r = setListDetail(p2, 'pay_method', a.key, '09 999 999999');
  check(same(r, { ok: true, saved: false, detail: '0012345 (laptop)' }) && accountDetail(p, a.key) === '0012345 (laptop)', 'stale: a newer value written meanwhile (on the laptop) is kept and comes back as the stored detail', r);
  check(same(setListDetail(p, 'pay_method', a.key, ' \n '), { ok: false, reason: 'empty' }) && same(setListDetail(p, 'pay_method', 'NOPE', '123'), { ok: false, reason: 'missing' }), 'nothing typed: empty; an unknown key: missing (nothing is written)');
  const p3 = Object.assign({}, p, { store: Object.assign({}, p.store) });
  delete p3.store.addListOption;
  check(same(setListDetail(p3, 'pay_method', a.key, '123'), { ok: false, reason: 'unavailable' }), 'a store without addListOption: unavailable');
  r = setListDetail(p, 'pay_method', 'KBZ', '9'.repeat(200));
  check(r.saved && r.detail.length === CFG.LIST_DETAIL_MAX, 'cut to ' + CFG.LIST_DETAIL_MAX + ' characters');
  check(same(w.lists.filter(x => x.key === a.key).map(x => [x.active, x.order, x.shop, x.label]), [[true, 5, '', 'AYA ဦးမောင်']]), 'label, Active, Order and Shop of the row are untouched');
  const w2 = newWorld(), p4 = w2.ports;
  r = setListDetail(p4, 'pay_method', 'kbz', '09 777 000000 ဒေါ်လှ');
  check(r.saved && w2.lists.length === 4 && accountDetail(p4, 'KBZ') === '09 777 000000 ဒေါ်လှ' && same(payMethods(p4), ['CASH', 'KBZ', 'WAVE', 'BANK']) && methodLabel(p4, 'KBZ') === MSG.method_KBZ,
    'on a sheet without Lists rows the old methods are seeded and the number lands on KBZ');
}

/* ------------------------------ J. voice method ------------------------------ */

step('J. methodKeyFor: what the voice answered, as a key');
{
  const w = newWorld({ lists: true }), p = w.ports;
  w.lists.push(acct('AYAX', 'AYA', { order: 10 }), acct('AYAU', 'AYA ဦးမောင်', { order: 11 }), acct('KPLUS', 'KBZPay ဒေါ်လှ', { order: 12 }),
    acct('S2ACC', 'CB မန္တလေး', { order: 13, shop: 'S2' }), acct('GONE', 'Yoma ဟောင်း', { order: 14, active: false }));
  check(methodKeyFor(p, 'kbz', 'S1') === 'KBZ' && methodKeyFor(p, ' Wave ', 'S1') === 'WAVE' && methodKeyFor(p, 'CASH') === 'CASH' && methodKeyFor(p, 'gone', 'S1') === 'GONE' && methodKeyFor(p, 's2acc', 'S1') === 'S2ACC',
    'an exact key in any case (a retired or other-shop account too: the key is known)');
  check(methodKeyFor(p, 'KBZPay', 'S1') === 'KBZ' && methodKeyFor(p, 'kbz pay', 'S1') === 'KBZ' && methodKeyFor(p, MSG.method_BANK, 'S1') === 'BANK' && methodKeyFor(p, MSG.method_CASH, 'S1') === 'CASH',
    'a label said as it is gives its key; the same name wins over a longer label that contains it');
  check(methodKeyFor(p, 'AYA ဦးမောင် အကောင့်နဲ့', 'S1') === 'AYAU' && methodKeyFor(p, 'ဦးမောင်', 'S1') === 'AYAU' && methodKeyFor(p, 'ဒေါ်လှ', 'S1') === 'KPLUS' && methodKeyFor(p, 'ဘဏ်', 'S1') === 'BANK',
    'containment either way, the longest label first (the holder\'s name finds the account)');
  check(methodKeyFor(p, 'AYA', 'S1') === 'AYAX', 'the short account "AYA" is found by its own name');
  check(methodKeyFor(p, 'CB မန္တလေး', 'S1') === '' && methodKeyFor(p, 'CB မန္တလေး', 'S2') === 'S2ACC' && methodKeyFor(p, 'CB မန္တလေး') === 'S2ACC' && methodKeyFor(p, 'Yoma ဟောင်း', 'S1') === '',
    'labels are matched among the active accounts of that shop only');
  check(methodKeyFor(p, 'x', 'S1') === '' && methodKeyFor(p, 'မသိ', 'S1') === '' && methodKeyFor(p, '', 'S1') === '' && methodKeyFor(p, null, 'S1') === '' && methodKeyFor(p, undefined) === '',
    'one character, an unknown word or nothing: no method');
}

/* ------------------------------ K. where to transfer ------------------------------ */

step('K. transferLines and transferLine');
{
  const w = newWorld({ lists: true }), p = w.ports;
  check(same(transferLines(p, 'S1'), []) && transferLine(p, 'S1') === '', 'no account has a number: nothing to print');
  const set = (key, detail) => { w.lists.filter(r => r.list === 'pay_method' && r.key === key)[0].detail = detail; };
  set('CASH', 'drawer');
  set('KBZ', '09 777 123456 ဒေါ်လှ');
  set('BANK', '0012 3456 789');
  w.lists.push(acct('S2ACC', 'CB မန္တလေး', { order: 2.5, shop: 'S2', detail: '555' }), acct('GONE', 'Yoma', { order: 1.5, active: false, detail: '999' }),
    acct('A5', 'Acc 5', { order: 5, detail: '5' }), acct('A6', 'Acc 6', { order: 6, detail: '6' }), acct('A7', 'Acc 7', { order: 7, detail: '7' }));
  check(same(transferLines(p, 'S1'), ['KBZPay 09 777 123456 ဒေါ်လှ', MSG.method_BANK + ' 0012 3456 789', 'Acc 5 5', 'Acc 6 6']),
    'label + detail of the active non-cash accounts of the shop that carry a number, the first four by Order', transferLines(p, 'S1'));
  check(same(transferLines(p, 'S2'), ['KBZPay 09 777 123456 ဒေါ်လှ', 'CB မန္တလေး 555', MSG.method_BANK + ' 0012 3456 789', 'Acc 5 5']), 'the other shop sees its own account in its place', transferLines(p, 'S2'));
  check(transferLine(p, 'S1') === 'ငွေလွှဲရန် · KBZPay 09 777 123456 ဒေါ်လှ · ' + MSG.method_BANK + ' 0012 3456 789 · Acc 5 5 · Acc 6 6', 'transferLine joins them with " · " behind ငွေလွှဲရန်', transferLine(p, 'S1'));
  check(MSG.receipt_transfer.indexOf('🏦') !== 0 && MSG.summary_accounts.indexOf('🏦 ') !== 0 && MSG.acct_title.indexOf('🏦 ') !== 0 && MSG.acct_line.indexOf('🏦 ') !== 0 && MSG.btn_accounts.indexOf('🏦 ') !== 0,
    'none of these lines starts with the bank emoji + space (stripMethodLines in core_bot.js drops such lines)');
}

/* ------------------------------ L. lists_json ------------------------------ */

step('L. lists_json: how the lists reach a phone');
{
  const w = newWorld(), p = w.ports;
  check(listsJsonFor(p) === '' && listsJsonFor({ store: { getSetting: () => '' } }) === '', 'no Lists rows, or a store without listOptions: no lists_json');
  simSeedLists(w);
  w.lists.push(acct('AYAU', 'AYA ဦးမောင်', { order: 9, shop: 'S1', detail: '001 ဦးမောင်', note: 'server only' }), acct('GONE', 'Yoma', { active: false, order: 10 }), row('expense_category', 'water', 'ရေဖိုး', { order: 30, detail: '💧' }));
  const raw = listsJsonFor(p), data = JSON.parse(raw);
  check(same(Object.keys(data), CFG.LIST_NAMES) && data.pay_method.length === 6 && data.pay_method.every(c => same(Object.keys(c), ['k', 'l', 'a', 'o', 's', 'd'])) && same(data.pay_method[4], { k: 'AYAU', l: 'AYA ဦးမောင်', a: 1, o: 9, s: 'S1', d: '001 ဦးမောင်' }) && data.pay_method[5].a === 0 && raw.indexOf('server only') < 0,
    'listsJsonFor: every Lists row of the three lists as compact rows {k, l, a, o, s, d}; the Note stays on the server', data.pay_method[4]);
  check(listsJsonFor(p) === raw, 'the value is stable while the rows are (the Settings hash does not move)');
  const phone = phoneLikePorts({ lists_json: raw, shop_name_S1: 'x' });
  const strip = rows => rows.map(r => Object.assign({}, r, { note: '' }));
  check(CFG.LIST_NAMES.every(n => same(listRows(phone, n), strip(listRows(p, n)))), 'round trip: a phone reading lists_json sees the rows the server has');
  check(same(payMethods(phone, 'S1'), payMethods(p, 'S1')) && same(payMethods(phone, 'S2'), payMethods(p, 'S2')) && same(expenseCategories(phone), expenseCategories(p)) && same(fabricPresets(phone), fabricPresets(p))
    && methodLabel(phone, 'GONE') === 'Yoma' && accountDetail(phone, 'AYAU') === '001 ဦးမောင်' && expenseEmoji(phone, 'water') === '💧' && same(transferLines(phone, 'S1'), transferLines(p, 'S1')),
    'and offers the same buttons, labels, emoji and transfer lines');
  check(same(listRowFromCompact('pay_method', listRowToCompact(listRows(p, 'pay_method')[4])), strip(listRows(p, 'pay_method'))[4]) && listRowFromCompact('pay_method', { l: 'no key' }) === null && listRowFromCompact('pay_method', null) === null,
    'listRowToCompact and listRowFromCompact undo each other (but for the note)');

  const added = addListOptionByLabel(phone, 'pay_method', 'CB ဒေါ်လှ', sister);
  check(added.created && payMethods(phone, 'S1').indexOf(added.key) >= 0 && methodLabel(phone, added.key) === 'CB ဒေါ်လှ' && phone.outbox.length === 1 && phone.outbox[0].rec.key === added.key && payMethods(p, 'S1').indexOf(added.key) < 0,
    'a phone-style store (lists_json + outbox, as spec section 8 describes it) adds an option offline and offers it at once', added);
  check(added.key === listKeyFor(p, 'pay_method', 'CB ဒေါ်လှ', []), 'with the key the server derives for that name');
  const d1 = setListDetail(phone, 'pay_method', added.key, '0911 222 333'), d2 = setListDetail(phone, 'pay_method', added.key, '0911 222 333');
  check(d1.saved && !d2.saved && accountDetail(phone, added.key) === '0911 222 333' && phone.outbox.length === 2, 'and sets its number; an unchanged value queues nothing');
  const bare = phoneLikePorts({ pay_methods: 'CASH,KBZ,AYA' }, { method_AYA: 'AYA ဘဏ်' });
  const first = addListOptionByLabel(bare, 'pay_method', 'CB ဒေါ်လှ', sister);
  check(first.created && same(payMethods(bare), ['CASH', 'KBZ', 'AYA', first.key]) && methodLabel(bare, 'AYA') === 'AYA ဘဏ်', 'a phone that only has the old Settings keeps its old methods next to the one it added (the seed)', payMethods(bare));

  const legacySeed = legacyListRows(newWorld().ports, 'pay_method');
  const u = listsJsonUpsert('', 'pay_method', legacySeed, { list: 'pay_method', key: 'AYA', label: 'AYA ဦးမောင်', note: 'not stored on the phone' });
  const parsed = JSON.parse(u.raw);
  check(u.status === 'ok' && u.key === 'AYA' && same(parsed.pay_method.map(c => c.k), ['CASH', 'KBZ', 'WAVE', 'BANK', 'AYA']) && same(parsed.expense_category, []) && same(parsed.fabric, []) && u.raw.indexOf('not stored') < 0,
    'listsJsonUpsert on an empty value: the seed, then the new row; the other lists stay empty', parsed);
  const u2 = listsJsonUpsert(u.raw, 'pay_method', legacySeed, { key: 'aya', label: 'again' });
  check(u2.status === 'dup' && u2.raw === u.raw && u2.key === 'AYA', 'the same key again is dup and the string comes back unchanged');
  const u3 = listsJsonUpsert('{broken', 'fabric', [], { key: 'x1', label: 'ဇာ' });
  check(u3.status === 'ok' && same(JSON.parse(u3.raw), { pay_method: [], expense_category: [], fabric: [{ k: 'x1', l: 'ဇာ', a: 1, o: 1, s: '', d: '' }], item_category: [] }), 'an unparseable value counts as empty', u3.raw);
  const u4 = listsJsonUpsert(u.raw, 'pay_method', [], { key: 'AYA', detail: '001', detailWas: '' });
  const u5 = listsJsonUpsert(u4.raw, 'pay_method', [], { key: 'AYA', detail: '002', detailWas: 'stale' });
  check(u4.status === 'ok' && JSON.parse(u4.raw).pay_method[4].d === '001' && u5.status === 'dup' && u5.raw === u4.raw, 'details follow the same rule (a stale detailWas does not overwrite)');
  const u6 = listsJsonUpsert(raw, 'fabric', [], { key: 'lace', label: 'ဇာ' });
  check(same(JSON.parse(u6.raw).pay_method, data.pay_method) && same(JSON.parse(u6.raw).expense_category, data.expense_category) && JSON.parse(u6.raw).fabric.length === data.fabric.length + 1, 'an upsert on one list leaves the other lists as they were');
}

/* ------------------------------ M. voice ------------------------------ */

step('M. Voice: the context text, the schema, the prompt and the mock');
{
  const parse = ctx => JSON.parse(aiContextText(Object.assign({ shop: 'S1', staff: 'x' }, ctx)).replace(/^Context: /, ''));
  check(same(parse({}).pay_methods, ['CASH', 'KBZ', 'WAVE', 'BANK']), 'aiContextText without ctx.payMethods: the default keys, as today');
  check(same(parse({ payMethods: [['CASH', 'ငွေသား'], ['AYA64ED', 'AYA ဦးမောင်']] }).pay_methods, ['CASH:ငွေသား', 'AYA64ED:AYA ဦးမောင်']), 'pairs [KEY, label] are printed as KEY:label');
  check(same(parse({ payMethods: ['CASH', 'KBZ', 'AYA:AYA Bank'] }).pay_methods, ['CASH', 'KBZ', 'AYA:AYA Bank']), 'plain strings (the context a phone queued with an older build) stay as they are');
  check(same(parse({ payMethods: [['CASH', 'ငွေသား'], 'KBZ'] }).pay_methods, ['CASH:ငွေသား', 'KBZ']) && same(parse({ payMethods: [] }).pay_methods, []), 'both shapes may be mixed');
  check(same(INTENT_SCHEMA.properties.method, { type: 'string', nullable: true }) && same(INTENT_SCHEMA.properties.method, INTENT_SCHEMA.properties.customer), 'INTENT_SCHEMA.method is a nullable string like customer (no enum): any account key fits');
  check(SYSTEM_PROMPT.includes('pay_methods lists KEY:label pairs') && SYSTEM_PROMPT.includes('is the account, not a customer') && SYSTEM_PROMPT.includes('"method":"KBZ"') && SYSTEM_PROMPT.includes('"method":"WAVE"') && SYSTEM_PROMPT.includes('"method":"BANK"'),
    'the prompt has the new method rule and keeps the KBZ, WAVE and BANK examples');
  const lone = vm.createContext({});
  ['apps-script/core_config.js', 'apps-script/core_ai_prompt.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), lone, { filename: f }));
  check(vm.runInContext('aiContextText({ shop: "S1", staff: "x", payMethods: [["CASH", "c"], "KBZ"] })', lone).includes('"pay_methods":["CASH:c","KBZ"]'), 'aiContextText runs with core_config.js alone (it uses nothing but CFG; tools/score_voice.js loads no ledger)');

  const ctx = { payMethods: [['CASH', 'ငွေသား'], ['KBZ', 'KBZPay'], ['WAVE', 'WavePay'], ['AYA64ED', 'AYA ဦးမောင်']] };
  let out = mockParseIntent('AYA ဦးမောင် နဲ့ ပေးသွားတယ်', ctx);
  check(out.intent === 'METHOD' && out.method === 'AYA64ED' && out.customer === null && out.transcript === 'AYA ဦးမောင် နဲ့ ပေးသွားတယ်', 'mock: a label with a holder\'s name is the account, not a customer', out);
  out = mockParseIntent('ဒေါ်မြင့် ငါးသိန်း aya  ဦးမောင် နဲ့ ပေးသွားတယ်', ctx);
  check(out.intent === 'PAYMENT' && out.customer === 'ဒေါ်မြင့်' && out.amount === 500000 && out.method === 'AYA64ED', 'mock: the real customer is still found next to the account label', out);
  out = mockParseIntent('ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်', ctx);
  const outOld = mockParseIntent('ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်', { payMethods: ['CASH', 'KBZ', 'WAVE', 'BANK'] }), outNone = mockParseIntent('ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်', {});
  check(out.intent === 'SALE' && out.qty === 2 && out.method === 'KBZ' && same(out, outOld) && same(out, outNone), 'mock: a key in the text gives that key; pairs, plain keys and no list at all agree for the old methods', out);
  check(mockParseIntent('Wave နဲ့ ပေးသွားတယ်', ctx).method === 'WAVE' && mockParseIntent('WavePay ကနေ လွှဲတယ်', ctx).intent === 'METHOD' && mockParseIntent('ဒေါ်မြင့် ငါးသိန်း ဘဏ်ကနေ လွှဲပေးတယ်', ctx).method === 'BANK' && mockParseIntent('ဒါ ၂ ထည် ရောင်းရတယ်', ctx).method === null,
    'mock: the built-in method words still work behind the listed accounts');
}

/* ------------------------------ N. rewriteGroup unchanged ------------------------------ */

step('N. rewriteGroup after the rewriteRows refactor equals the function it replaced');
{
  const twin = () => {
    const w = createSimWorld();
    w.nowOverride = new Date('2026-11-09T05:00:00.000Z');
    let n = 0;
    w.ports.uuid = () => 'tx-' + String(++n).padStart(6, '0');
    return seedSimWorld(w);
  };
  const A = twin(), B = twin();
  check(same(A.ledger, B.ledger) && A.ledger.length > 10 && A.ledger[0].txId === 'tx-000001', 'two identically seeded worlds (ids from a counter, a fixed clock) hold the same ledger');
  // The clock of both worlds is set by hand, in step: every row is made at a fixed minute and rewritten 7 minutes later.
  let minute = 0;
  const clock = m => { A.nowOverride = new Date(Date.parse('2026-11-09T05:00:00.000Z') + m * 60000); B.nowOverride = new Date(A.nowOverride.getTime()); };
  const sale = (w, o) => commitSale(w.ports, Object.assign({ item: w.ports.store.getItem('S1-0002'), qty: 2, staff: sister, source: 'BUTTON' }, o || {})).groupId;
  const expense = w => commitExpense(w.ports, { shop: 'S1', amount: 5000, category: 'food', method: 'CASH', staff: sister, source: 'BUTTON' }).groupId;
  const ret = w => commitReturn(w.ports, { item: w.ports.store.getItem('S1-0002'), qty: 1, staff: sister, source: 'BUTTON' }).groupId;
  // A SALE row as a phone writes it: stamped with its own receipt number (R1-B-000042).
  const stamped = w => writeGroup(w.ports, [newTx(w.ports, { shop: 'S1', itemId: 'S1-0002', type: 'SALE', qty: -1, unitPrice: 18000, amount: 18000, cash: 18000, costAtSale: 9000, method: 'CASH',
    staffId: '1001', source: 'BUTTON', receiptNo: 'R1-B-000042' })]).groupId;
  const cases = [
    ['a method change', sale, { method: 'KBZ' }, { noteIfBlank: 'method' }],
    ['a cash change on a SALE above the amount (clamped to it)', sale, { cash: 99999 }, undefined],
    ['a cash change on a SALE below zero (clamped to 0)', sale, { cash: -500 }, undefined],
    ['a credit conversion (cash, customer, note)', sale, { cash: 6000, customerId: 'C-0001', note: 'credit' }, undefined],
    ['a customer attach', sale, { customerId: 'C-0002' }, { noteIfBlank: 'customer' }],
    ['a note on an expense', expense, { note: 'နေ့လယ်စာ ၃ ယောက်' }, { source: 'TEXT', transcript: 'နေ့လယ်စာ ၃ ယောက်' }],
    ['a category', expense, { category: 'transport' }, {}],
    ['noteIfBlank on a row that already has a note (the note stays)', w => sale(w, { paid: 1000, customerId: 'C-0001', note: 'credit' }), { method: 'WAVE' }, { noteIfBlank: 'method' }],
    ['source and transcript in opts', w => sale(w, { source: 'VOICE', transcript: 'ဒါ ၂ ထည် ရောင်းရတယ်' }), { method: 'WAVE' }, { source: 'VOICE', transcript: 'Wave နဲ့ ပေးသွားတယ်', noteIfBlank: 'method' }],
    ['a row with a transcript and none in opts (the transcript stays)', w => sale(w, { source: 'VOICE', transcript: 'ဒါ ၂ ထည် ရောင်းရတယ်' }), { customerId: 'C-0001' }, { source: 'BUTTON' }],
    ['a cash change on a RETURN (not clamped)', ret, { cash: -7000, method: 'KBZ' }, undefined],
    ['changes with undefined values (ignored)', sale, { method: undefined, cash: undefined, note: undefined }, { noteIfBlank: 'x' }],
    ['cash 0 with a method (the method goes blank)', sale, { cash: 0, method: 'KBZ' }, undefined],
    ['a row stamped with a device receipt number (kept on the replacement)', stamped, { method: 'KBZ' }, { noteIfBlank: 'method' }],
    ['no changes and no opts at all', sale, undefined, undefined]
  ];
  cases.forEach(([label, make, changes, opts], i) => {
    clock(minute += 10);
    const gA = make(A), gB = make(B), nA = A.ledger.length, nB = B.ledger.length, made = B.ledger[nB - 1];
    clock(minute + 7);
    const a = legacyRewriteGroup(A.ports, gA, changes, sister, 'upd-' + i, opts);
    const b = rewriteGroup(B.ports, gB, changes, sister, 'upd-' + i, opts);
    check(gA === gB && a.ok === true && b.ok === true && same(a, b) && A.ledger.length === nA + 2 && B.ledger.length === nB + 2 && same(A.ledger.slice(nA), B.ledger.slice(nB)) && same(b.txs[1], b.row) && Object.keys(b.row).length === 27
      && b.row.time === made.time && b.txs[0].time !== made.time && b.row.receiptNo === made.receiptNo,
      label + ': the returned rows and the two appended ledger rows are equal in every field', { a, b });
  });
  check(B.ledger.filter(r => r.receiptNo === 'R1-B-000042').map(r => r.note).join() === ',method', 'the stamped receipt number is on the original and on its replacement, not on the mirror');
  const refA = legacyRewriteGroup(A.ports, 'no-such-group', { method: 'KBZ' }, sister, 'u'), refB = rewriteGroup(B.ports, 'no-such-group', { method: 'KBZ' }, sister, 'u');
  const oldA = legacyRewriteGroup(A.ports, A.ledger[0].groupId, { note: 'x' }, sister, 'u'), oldB = rewriteGroup(B.ports, B.ledger[0].groupId, { note: 'x' }, sister, 'u');
  check(same(refA, refB) && refB.reason === 'missing' && same(oldA, oldB) && oldB.ok === false && oldB.reason === 'type', 'refusals are the same too (a missing group, a row that cannot be rewritten)', [refB, oldB]);
  check(same(A.ledger, B.ledger), 'after every case the two ledgers are still identical');
  const target = B.ledger[B.ledger.length - 1], nB = B.ledger.length;
  const pair = rewriteRows(B.ports, target, { note: 'probe' }, sister, 'u', {});
  check(Array.isArray(pair) && pair.length === 2 && pair[0].note === 'rewrite' && pair[0].reversesTxId === target.txId && pair[0].cash === -target.cash && pair[1].note === 'probe' && pair[1].time === target.time && B.ledger.length === nB,
    'rewriteRows returns [mirror, replacement] and writes nothing');
}

/* ------------------------------ O. the split sale ------------------------------ */

step('O. splitSale: one sale, part cash and part into one account');
{
  const w = newWorld({ lists: true }), p = w.ports, today = dayKey(p.clock.now());
  // The clock is set by hand from here (noon in Yangon today), so a split can come some minutes after its sale.
  const noon = new Date(new Date(today + 'T00:00:00.000Z').getTime() - YANGON_OFFSET_MS + 12 * 3600000);
  const at = minutes => { w.nowOverride = new Date(noon.getTime() + minutes * 60000); };
  at(0);
  const item = () => p.store.getItem('S1-0002');
  const sell = o => commitSale(p, Object.assign({ item: item(), qty: 1, unitPrice: 30000, staff: sister, source: 'BUTTON' }, o || {})).groupId;
  const live = g => groupRows(p, g).live;
  const by = k => { const m = dayStats(p, 'S1', today).byMethod[k] || { in: 0, out: 0 }; return m.in - m.out; };
  const stock0 = item().stock, cash0 = by('CASH'), kbz0 = by('KBZ'), credits0 = JSON.stringify(openCredits(p, null));
  const g = sell(), no0 = receiptNumber(p, g), n0 = w.ledger.length, saleRow = w.ledger[n0 - 1];
  at(5);
  const r = splitSale(p, g, 20000, ' kbz ', brother, 'upd-7', 'TEXT');
  const added = w.ledger.slice(n0);
  check(same(r, { ok: true, full: false, groupId: g, cashPart: 10000, bankPart: 20000, method: 'KBZ', cashMethod: 'CASH' }), 'a 30,000 cash sale split with 20,000 KBZ: the result names both parts', r);
  check(added.length === 3 && added.every(x => x.groupId === g)
    && added[0].type === 'SALE' && added[0].reversesTxId === saleRow.txId && added[0].note === 'rewrite' && added[0].cash === -30000 && added[0].method === 'CASH'
    && added[1].type === 'SALE' && !added[1].reversesTxId && added[1].cash === 10000 && added[1].amount === 30000 && added[1].method === 'CASH' && added[1].qty === -1
    && added[2].type === 'PAYMENT' && !added[2].reversesTxId && added[2].amount === 20000 && added[2].cash === 20000 && added[2].method === 'KBZ' && added[2].refGroupId === g && added[2].qty === 0,
    'three rows appended in the sale\'s group, in the order mirror, replacement (the cash part), PAYMENT (the account part)', added.map(x => [x.type, x.cash, x.method, x.note]));
  check(added.every(x => x.staffId === '1002') && added[1].updateId === 'upd-7' && added[2].updateId === 'upd-7' && added[1].source === 'TEXT' && added[2].source === 'TEXT' && added[2].itemId === saleRow.itemId && added[2].shop === 'S1',
    'every row carries the staff id (the sync server quarantines a blank one); source and update id are on the new rows', added.map(x => [x.staffId, x.source, x.updateId]));
  check(added[1].time === saleRow.time && added[1].day === saleRow.day && added[1].receiptNo === saleRow.receiptNo && added[1].note === 'split' && added[2].note === 'split'
    && added[0].time !== saleRow.time && added[2].time === added[0].time && added[2].day === today,
    'the replacement keeps the sale\'s Time and Day (the mirror and the PAYMENT carry the time of the split); both new rows carry the note split');
  const info = saleGroupInfo(p, g);
  check(info.owed === 0 && info.total === 30000 && info.cash === 10000 && info.payments === 20000 && !info.voided && JSON.stringify(openCredits(p, null)) === credits0, 'saleGroupInfo: owed 0; openCredits unchanged', [info.owed, info.cash, info.payments]);
  check(by('CASH') === cash0 + 10000 && by('KBZ') === kbz0 + 20000, 'dayStats: CASH net +10,000 and KBZ +20,000', [by('CASH') - cash0, by('KBZ') - kbz0]);
  const rc = buildReceipt(p, g), text = receiptText(p, rc);
  check(same(groupMethods(p, g), [{ method: 'CASH', amount: 10000 }, { method: 'KBZ', amount: 20000 }]) && text.includes('(ငွေသား 10,000 · KBZPay 20,000)') && rc.paid === 30000 && rc.owed === 0 && rc.lines.length === 1,
    'groupMethods and the receipt text are mixed: ငွေသား 10,000 · KBZPay 20,000', text);
  check(receiptNumber(p, g) === no0 && rc.no === no0 && live(g).filter(x => x.type === 'SALE').length === 1, 'one receipt number: the group still has one live SALE row and the number it had');
  check(rewriteCheck(p, g).ok === false && rewriteCheck(p, g).reason === 'complex' && splitSale(p, g, 5000, 'KBZ', sister, 'u', 'BUTTON').reason === 'complex' && w.ledger.length === n0 + 3,
    'rewriteCheck now refuses the group, so a second split (a double tap) writes nothing');
  check(item().stock === stock0 - 1, 'stock moved once');
  const undo = undoGroup(p, g, sister);
  check(undo.ok && by('CASH') === cash0 && by('KBZ') === kbz0 && item().stock === stock0 && saleGroupInfo(p, g).voided && saleGroupInfo(p, g).owed === 0 && live(g).length === 0 && JSON.stringify(openCredits(p, null)) === credits0,
    'undoGroup reverses both live rows: every bucket nets to 0, the stock is back, the group is voided');

  const g2 = sell(), n2 = w.ledger.length;
  const full = splitSale(p, g2, 30000, 'WAVE', sister, 'u2', 'BUTTON');
  check(same(full, { ok: true, reason: '', full: true, groupId: g2, method: 'WAVE', bankPart: 30000, cashPart: 0 }) && w.ledger.length === n2 + 2 && live(g2).length === 1 && live(g2)[0].method === 'WAVE' && live(g2)[0].cash === 30000
    && live(g2)[0].note === 'method' && !w.ledger.slice(n2).some(x => x.type === 'PAYMENT'), 'the bank part covers the whole payment: a plain method rewrite (mirror and replacement appended, one live row, no PAYMENT)', full);
  const over = splitSale(p, g2, 99999, 'WAVE', sister, 'u3', 'BUTTON');
  check(over.ok && over.full && over.bankPart === 30000 && w.ledger.length === n2 + 2, 'already on that account and all of it asked again: nothing is written');

  const g3 = sell({ method: 'KBZ' }), n3 = w.ledger.length;
  check(same(splitSale(p, g3, 20000, 'WAVE', sister, 'u4', 'BUTTON'), { ok: false, reason: 'method' }) && w.ledger.length === n3, 'a sale marked KBZ cannot be split with another account (a split is cash plus ONE account)');
  const r3 = splitSale(p, g3, 20000, 'KBZ', sister, 'u5', 'BUTTON'), rows3 = w.ledger.slice(n3);
  check(r3.ok && !r3.full && r3.cashPart === 10000 && r3.bankPart === 20000 && r3.cashMethod === 'CASH' && rows3.length === 3 && rows3[0].method === 'KBZ' && rows3[0].cash === -30000 && rows3[1].method === 'CASH' && rows3[1].cash === 10000
    && rows3[2].type === 'PAYMENT' && rows3[2].method === 'KBZ' && rows3[2].cash === 20000, 'a sale marked KBZ, split 20,000 KBZ of 30,000: the replacement is CASH 10,000, the PAYMENT is KBZ 20,000', rows3.map(x => [x.type, x.cash, x.method]));
  check(same(groupMethods(p, g3), [{ method: 'CASH', amount: 10000 }, { method: 'KBZ', amount: 20000 }]) && saleGroupInfo(p, g3).owed === 0, 'and it reads as cash 10,000 + KBZ 20,000, nothing owed');

  const g4 = sell(), n4 = w.ledger.length;
  const refusals = [[0, 'KBZ', 'amount'], [-5, 'KBZ', 'amount'], ['abc', 'KBZ', 'amount'], [NaN, 'KBZ', 'amount'], [null, 'KBZ', 'amount'], [0.4, 'KBZ', 'amount'], [Infinity, 'KBZ', 'amount'],
                    [5000, 'CASH', 'method'], [5000, 'cash', 'method'], [5000, 'NOPE', 'method'], [5000, '', 'method'], [5000, null, 'method']];
  check(refusals.every(([amt, key, reason]) => same(splitSale(p, g4, amt, key, sister, 'u', 'BUTTON'), { ok: false, reason })) && w.ledger.length === n4,
    'refusals: amount (0, negative, not a number), method (CASH, an unknown key, none); nothing is written', refusals.map(([amt, key]) => splitSale(p, g4, amt, key, sister, 'u', 'BUTTON').reason));
  w.lists.filter(x => x.key === 'BANK')[0].active = false;
  check(splitSale(p, g4, 5000, 'BANK', sister, 'u', 'BUTTON').ok === true && live(g4).length === 2, 'a retired account is still a known method (a card sent before it was retired stays valid)');
  w.lists.filter(x => x.key === 'BANK')[0].active = true;

  const gCredit = sell({ paid: 10000, customerId: 'C-0001', note: 'credit' });
  commitPayment(p, { groupId: gCredit, amount: 5000, staff: sister, source: 'BUTTON' });
  const gReturn = commitReturn(p, { item: item(), qty: 1, staff: sister, source: 'BUTTON' }).groupId;
  const gDep = sell({ paid: 10000, customerId: 'C-0002', note: 'credit' });
  applyDeposit(p, { groupId: gDep, staff: sister, source: 'BUTTON' });
  const gOld = sell({ when: new Date(p.clock.now().getTime() - 26 * 3600000) });
  const gZero = sell({ paid: 0, customerId: 'C-0001', note: 'credit' });
  const gExp = commitExpense(p, { shop: 'S1', amount: 5000, category: 'food', method: 'CASH', staff: sister, source: 'BUTTON' }).groupId;
  const nR = w.ledger.length;
  const reasons = [[gCredit, 'locked'], [gReturn, 'type'], [gDep, 'complex'], [gOld, 'expired'], [gZero, 'type'], [gExp, 'type'], ['no-such-group', 'missing'], [g, 'already']];
  check(reasons.every(([grp, reason]) => same(splitSale(p, grp, 5000, 'KBZ', sister, 'u', 'BUTTON'), { ok: false, reason })) && w.ledger.length === nR,
    'refusals: a group with a payment (locked), a RETURN row, a deposit applied (complex), yesterday\'s sale, a sale with no cash, an expense, a missing group, an undone group',
    reasons.map(([grp]) => splitSale(p, grp, 5000, 'KBZ', sister, 'u', 'BUTTON').reason));

  const gC = sell({ paid: 18000, customerId: 'C-0001', note: 'credit' });
  const owedBefore = saleGroupInfo(p, gC).owed, custOwed = customerSummary(p, 'C-0001').owed, nC = w.ledger.length;
  const rC = splitSale(p, gC, 6000, 'KBZ', sister, 'u9', 'BUTTON'), rowsC = w.ledger.slice(nC);
  check(rC.ok && rC.cashPart === 12000 && rC.bankPart === 6000 && owedBefore === 12000 && saleGroupInfo(p, gC).owed === 12000 && saleGroupInfo(p, gC).customerId === 'C-0001' && customerSummary(p, 'C-0001').owed === custOwed
    && rowsC[1].customerId === 'C-0001' && rowsC[1].note === 'credit' && rowsC[2].customerId === 'C-0001' && openCredits(p, 'S1').some(c => c.groupId === gC && c.owed === 12000),
    'a split on a credit sale keeps what is owed, the customer and the note credit', rowsC.map(x => [x.type, x.cash, x.method, x.note, x.customerId]));

  const gStamp = writeGroup(p, [newTx(p, { shop: 'S1', itemId: 'S1-0002', type: 'SALE', qty: -1, unitPrice: 30000, amount: 30000, cash: 30000, costAtSale: 9000, method: 'CASH',
    staffId: '1001', source: 'BUTTON', receiptNo: 'R1-B-000042' })]).groupId;
  splitSale(p, gStamp, 20000, 'KBZ', sister, 'u', 'BUTTON');
  const liveStamp = live(gStamp);
  check(liveStamp.length === 2 && liveStamp[0].type === 'SALE' && liveStamp[0].receiptNo === 'R1-B-000042' && liveStamp[1].type === 'PAYMENT' && liveStamp[1].receiptNo === '' && receiptNumber(p, gStamp) === 'R1-B-000042',
    'a sale stamped with a phone\'s receipt number keeps it on the cash part; the PAYMENT row carries none (one number per sale)', liveStamp.map(x => [x.type, x.receiptNo]));
}

/* ------------------------------ P. receipts and reports ------------------------------ */

step('P. Where to transfer on a receipt with a balance; the summary\'s account line; the day report');
{
  const w = newWorld({ lists: true }), p = w.ports, today = dayKey(p.clock.now());
  const item = () => p.store.getItem('S1-0002');
  const sell = o => commitSale(p, Object.assign({ item: item(), qty: 1, unitPrice: 30000, staff: sister, source: 'BUTTON' }, o || {})).groupId;
  const gCredit = sell({ paid: 10000, customerId: 'C-0001', note: 'credit' }), gPaid = sell();
  let rc = buildReceipt(p, gCredit);
  check(rc.owed === 20000 && rc.transfer === '' && same(rc.transferLines, []) && !receiptText(p, rc).includes('ငွေလွှဲရန်') && receiptReport(p, rc, p.clock.now()).footer === MSG.receipt_thanks,
    'a balance but no account has a number yet: no transfer line, the PDF footer is the thanks line as before');
  setListDetail(p, 'pay_method', 'KBZ', '09 777 123456 ဒေါ်လှ');
  setListDetail(p, 'pay_method', 'BANK', 'AYA 0012 3456 789');
  rc = buildReceipt(p, gCredit);
  const text = receiptText(p, rc).split('\n');
  const line = 'ငွေလွှဲရန် · KBZPay 09 777 123456 ဒေါ်လှ · ' + MSG.method_BANK + ' AYA 0012 3456 789';
  check(rc.transfer === line && same(rc.transferLines, ['KBZPay 09 777 123456 ဒေါ်လှ', MSG.method_BANK + ' AYA 0012 3456 789']), 'owed > 0 and accounts with a number: r.transfer and r.transferLines', rc.transfer);
  const at = text.indexOf(line);
  check(at > 0 && text[at - 1] === 'ကျန် 20,000' && text[at + 1].indexOf('ဝယ်သူ') === 0 && text[text.length - 1] === MSG.receipt_thanks, 'receiptText: the line follows the total block (right after ကျန်)', text);
  const rep = receiptReport(p, rc, p.clock.now());
  check(same(rep.footer.split('\n'), ['ငွေလွှဲရန် · KBZPay 09 777 123456 ဒေါ်လှ', MSG.method_BANK + ' AYA 0012 3456 789', MSG.receipt_thanks]) && rep.subtitle.indexOf('09 777') < 0 && rep.title.indexOf('09 777') < 0,
    'PDF data: one account per footer line above the thanks line, nothing in the subtitle', rep.footer);
  const rp = buildReceipt(p, gPaid);
  check(rp.owed === 0 && rp.transfer === '' && same(rp.transferLines, []) && !receiptText(p, rp).includes('ငွေလွှဲရန်') && receiptReport(p, rp, p.clock.now()).footer === MSG.receipt_thanks, 'a fully paid sale prints no transfer line');
  undoGroup(p, gCredit, sister);
  const rv = buildReceipt(p, gCredit);
  check(rv.voided && rv.transfer === '' && same(rv.transferLines, []) && !receiptText(p, rv).includes('ငွေလွှဲရန်'), 'a voided receipt prints none');

  const summary = () => buildDailySummary(p, today).split('\n');
  const acctLines = () => summary().filter(l => l.indexOf('   🏦 ') === 0);
  sell({ method: 'KBZ' });
  check(acctLines().length === 0, 'one account moved money today: no account line in the daily summary');
  sell({ method: 'WAVE', unitPrice: 18000 });
  const lines = summary(), i = lines.findIndex(l => l.indexOf('   🏦 ') === 0);
  check(acctLines().length === 1 && lines[i] === '   🏦 KBZPay 30,000 · WavePay 18,000' && lines[i - 1].indexOf('   💵 ') === 0 && lines[i - 1].includes('🏦 ဘဏ် 48,000') && lines[i - 2].indexOf(shopName(p, 'S1')) === 0,
    'two accounts moved: one line with each label and its net, directly after that shop\'s cash line', lines);
  commitExpense(p, { shop: 'S1', amount: 5000, category: 'food', method: 'KBZ', staff: sister, source: 'BUTTON' });
  check(acctLines()[0] === '   🏦 KBZPay 25,000 · WavePay 18,000', 'the figure is the net movement of the account (in minus out)', acctLines());

  const gS = sell();
  splitSale(p, gS, 20000, 'KBZ', sister, 'u', 'BUTTON');
  const day = buildReport(p, 'day', { day: today, shop: 'S1' }).sections[0].rows;
  const splitRows = day.filter(r => r[7] === MSG.note_split);
  check(splitRows.length === 2 && splitRows.some(r => r[1].indexOf('ရောင်း') === 0 && r[5] === 10000 && r[6] === MSG.method_CASH) && splitRows.some(r => r[1] === 'ငွေလက်ခံ' && r[5] === 20000 && r[6] === 'KBZPay') && !day.some(r => r[7] === 'split'),
    'the day report prints a split as the sale line (cash part) and a payment line (account part), both marked ' + MSG.note_split, splitRows);
}

/* ------------------------------ Q. the simulator store ------------------------------ */

step('Q. The simulator store: listOptions, addListOption, addDesign');
{
  const w = newWorld(), p = w.ports;
  check(same(p.store.listOptions('pay_method'), []) && same(p.store.listOptions('nope'), []), 'listOptions: [] while the tab is empty');
  w.lists.push({ list: 'pay_method', key: 'AYA', label: 'AYA', active: '', order: '', shop: null, detail: 12345, note: undefined }, { list: 'pay_method', key: '', label: 'blank' },
    { list: 'pay_method', key: 'OFF', active: 'FALSE', order: 'x' }, { list: 'fabric', key: 'lace' });
  const rows = p.store.listOptions('pay_method');
  check(rows.length === 2 && same(rows[0], { list: 'pay_method', key: 'AYA', label: 'AYA', active: true, order: 0, shop: '', detail: '12345', note: '' }) && rows[1].active === false && rows[1].order === 0 && rows[1].label === '',
    'listOptions follows the store contract: a blank Key skipped, a blank Active = true, a blank or non-numeric Order = 0, text as strings', rows);
  const events = [];
  w.listeners.push(e => events.push(e.type));
  const r1 = p.store.addListOption({ list: 'pay_method', key: 'cb', label: 'CB Bank' }, legacyListRows(p, 'pay_method'));
  const r2 = p.store.addListOption({ list: 'pay_method', key: 'CB', label: 'again' }, []);
  const r3 = p.store.addListOption({ list: 'pay_method', key: 'aya', detail: '001', detailWas: '12345' }, []);
  const r4 = p.store.addListOption({ list: 'pay_method', key: 'aya', detail: '002' }, []);
  check(same(r1, { status: 'ok', key: 'CB' }) && same(r2, { status: 'dup', key: 'CB' }) && same(r3, { status: 'ok', key: 'AYA' }) && same(r4, { status: 'dup', key: 'AYA' }) && w.lists.filter(x => x.list === 'pay_method').length === 4
    && w.lists.filter(x => x.key === 'AYA')[0].detail === '001' && w.lists.filter(x => x.key === 'CB')[0].order === 1 && same(events, ['lists', 'lists']),
    'addListOption persists what listUpsert answers (no seed: the list had rows), returns {status, key} and emits a lists event per change', [r1, r2, r3, r4, events]);
  const d0 = w.designs.length;
  const d = p.store.addDesign({ code: 'TSL-31', name: '', category: '', basePrice: '', daysToMake: '', active: true, note: 'added by Sister (S1) 2026-11-09' });
  check(w.designs.length === d0 + 1 && same(d, p.store.getDesign('TSL-31')) && d.code === 'TSL-31' && d.basePrice === '' && d.daysToMake === '' && d.active === true && d.note.indexOf('added by') === 0 && d.photoUrl === '',
    'addDesign appends a Designs row and returns it in the shape getDesign returns', d);
  const d2 = p.store.addDesign({ code: 'tsl 31', name: 'other' }), d3 = p.store.addDesign({ code: 'TSL-18', name: 'x' });
  check(w.designs.length === d0 + 1 && same(d2, d) && d3.code === 'TSL-0018' && d3.name === 'ဝမ်းဆက်', 'a code that getDesign already finds (also by alias) writes nothing and returns the stored design', [d2, d3]);
}

/* ------------------------------ R. today's bot on the lists ------------------------------ */

step('R. The bot already reads the lists: an added account is a method button, an added category is in the grid');
{
  const w = newWorld({ lists: true }), p = w.ports, sim = w.sim;
  const a = addListOptionByLabel(p, 'pay_method', 'AYA ဦးမောင်', sister), c = addListOptionByLabel(p, 'expense_category', 'ရေဖိုး', sister);
  sim.start(U.sister, 'S1-0002');
  sim.tapLast(U.sister, 'ရောင်း ၁');
  const g = w.ledger[w.ledger.length - 1].groupId, card = sim.lastBot(U.sister);
  const buttons = card.keyboard.reduce((x, r) => x.concat(r), []);
  check(buttons.some(b => b.callback_data === 'PM|' + g + '|' + a.key && b.text.includes('AYA ဦးမောင်')) && buttons.every(b => Buffer.byteLength(b.callback_data, 'utf8') <= 64),
    'the sale card offers the added account as a method button (every callback within 64 bytes)', buttons.map(b => b.callback_data));
  sim.tap(U.sister, card.id, 'PM|' + g + '|' + a.key);
  check(groupRows(p, g).live[0].method === a.key && sim.lastBot(U.sister).text.includes('AYA ဦးမောင်'), 'tapping it marks the sale with that account');
  sim.start(U.sister, '');
  sim.tapLast(U.sister, 'ကုန်ကျ');
  const grid = sim.lastBot(U.sister).keyboard.reduce((x, r) => x.concat(r), []);
  check(grid.some(b => b.callback_data === 'EC|' + c.key && b.text.includes('ရေဖိုး')), 'the expense grid offers the added category', grid.map(b => b.callback_data));
  check(w.errors.length === 0, 'and nothing was logged as an error', w.errors);
}

/* ------------------------------ S. messages ------------------------------ */

step('S. The round-4 messages of spec section 11');
{
  const KEYS = ['btn_split', 'split_ask_bank', 'split_ask_amount', 'split_done', 'split_hint', 'split_hint_late', 'split_bad', 'split_no_bank', 'btn_add_bank', 'btn_add_cat', 'btn_add_option',
    'add_ask_pm', 'add_ask_ec', 'add_ask_fb', 'add_done', 'add_exists', 'add_unavailable', 'btn_accounts', 'acct_title', 'acct_line', 'acct_none', 'btn_acct_number', 'btn_acct_detail', 'acct_ask_detail',
    'acct_detail_saved', 'acct_detail_hint', 'receipt_transfer', 'summary_accounts', 'note_split', 'btn_create_design', 'design_created', 'meas_saved_form',
    'lists_note_list', 'lists_note_key', 'lists_note_label', 'lists_note_active', 'lists_note_order', 'lists_note_shop', 'lists_note_detail', 'lists_note_note'];
  check(KEYS.length === 40 && KEYS.every(k => typeof MSG[k] === 'string' && MSG[k].length > 0), 'all 40 keys are in MSG', KEYS.filter(k => typeof MSG[k] !== 'string'));
  check(CFG.LIST_COLS.every(c => typeof MSG['lists_note_' + c.toLowerCase()] === 'string'), 'one header note per column of the Lists tab (lists_note_<column in lower case>)');
  const buttons = KEYS.filter(k => k.indexOf('btn_') === 0);
  check(buttons.length === 8 && buttons.every(k => ['ငွေသား', 'KBZPay', 'WavePay', 'ဘဏ်လွှဲ'].every(word => MSG[k].indexOf(word) < 0) && MSG[k].indexOf('🏦 ') !== 0),
    'no new button text contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ, or starts with the bank emoji + space (existing checks find buttons by those texts)');
  check(fill(MSG.split_done, { cashMethod: 'ငွေသား', cash: '10,000', method: 'KBZPay', bank: '20,000' }) === '💵 ငွေသား 10,000 · 🏦 KBZPay 20,000 · မှတ်ပြီး' && fill(MSG.receipt_transfer, { accounts: 'A 1' }) === 'ငွေလွှဲရန် · A 1'
    && fill(MSG.summary_accounts, { list: 'x' }) === '   🏦 x' && fill(MSG.add_done, { label: 'AYA' }) === '➕ "AYA" ထည့်ပြီး', 'the placeholders fill as the flows expect');
  const specFile = path.join(ROOT, 'docs/design-round-4/SPEC-round-4.md');
  if (fs.existsSync(specFile)) {
    const spec = fs.readFileSync(specFile, 'utf8').replace(/\r\n/g, '\n');
    const from = spec.indexOf('```\n', spec.indexOf('core_messages.js `MSG` (step 1 adds all of them)')) + 4;
    const pairs = spec.slice(from, spec.indexOf('\n```', from)).split('\n').map(l => l.match(/^(\w+): '(.*)'$/)).filter(Boolean);
    check(pairs.length === 40 && same(pairs.map(m => m[1]), KEYS) && pairs.every(m => MSG[m[1]] === m[2]), 'every text is exactly the one the spec gives (compared with docs/design-round-4/SPEC-round-4.md)',
      pairs.filter(m => MSG[m[1]] !== m[2]).map(m => m[1]));
  } else {
    console.log('  (the spec file is not here: the texts were not compared with it)');
  }
}

/* ------------------------------ T. load sets ------------------------------ */

step('T. Load sets: core_ledger.js needs neither core_orders.js, core_report.js, core_bot.js nor core_sync.js');
{
  check(typeof syncHandle === 'undefined' && typeof syncSettingsFor === 'undefined', 'core_sync.js is not loaded in this run: every check above ran without it');
  const ctx = vm.createContext({ console });
  ['apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js', 'apps-script/core_ledger.js', 'poc/sim_ports.js', 'poc/sim_seed.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  const out = JSON.parse(vm.runInContext('(function () {' +
    'var w = simSeedLists(seedSimWorld(createSimWorld())), p = w.ports, staff = { id: "1001", name: "Sister (S1)", shop: "S1", role: "staff" };' +
    'var added = addListOptionByLabel(p, "pay_method", "AYA Bank", staff);' +
    'var detail = setListDetail(p, "pay_method", added.key, "001 234");' +
    'var sale = commitSale(p, { item: p.store.getItem("S1-0002"), qty: 1, unitPrice: 30000, staff: staff, source: "BUTTON" });' +
    'var split = splitSale(p, sale.groupId, 20000, added.key, staff, "u1", "BUTTON");' +
    'return JSON.stringify({ added: added, detail: detail, pay: payMethods(p, "S1"), cats: expenseCategories(p).length, emoji: expenseEmoji(p, "food"), fabrics: fabricOptions(p).length, split: split,' +
    '  owed: saleGroupInfo(p, sale.groupId).owed, transfer: transferLines(p, "S1"), json: listsJsonFor(p).length > 0, summary: buildDailySummary(p, dayKey(p.clock.now())).length > 0,' +
    '  key: methodKeyFor(p, "aya bank", "S1"), legacy: legacyListRows(p, "fabric").length });' +
    '})()', ctx));
  check(out.added.created && out.detail.saved && out.pay.length === 5 && out.cats === CFG.EXPENSE_CATEGORIES.length && out.emoji === '🍚' && out.fabrics === 3 && out.split.ok && out.split.cashPart === 10000 && out.owed === 0
    && same(out.transfer, ['AYA Bank 001 234']) && out.json && out.summary && out.key === out.added.key && out.legacy === 3,
    'lists, add, detail, split, transfer lines, lists_json and the daily summary run with core_config, core_burmese, core_messages and core_ledger alone', out);
}

/* ------------------------------ U. the independent check of step 1 ------------------------------ */

step('U. Independent check of step 1: what the next steps lean on and the checks above did not pin');
{
  // N compares SALE, EXPENSE and RETURN rows. The two other rewritable types, through the same comparison.
  const twin = () => {
    const w = createSimWorld();
    w.nowOverride = new Date('2026-11-09T05:00:00.000Z');
    let n = 0;
    w.ports.uuid = () => 'tx-' + String(++n).padStart(6, '0');
    return seedSimWorld(w);
  };
  const A = twin(), B = twin();
  const payment = w => {
    const g = commitSale(w.ports, { item: w.ports.store.getItem('S1-0002'), qty: 1, paid: 1000, customerId: 'C-0002', note: 'credit', staff: sister, source: 'BUTTON' }).groupId;
    return commitPayment(w.ports, { groupId: g, amount: 2000, staff: sister, source: 'BUTTON' }).groupId;
  };
  const deposit = w => commitDeposit(w.ports, { shop: 'S1', customerId: 'C-0001', amount: 30000, staff: sister, source: 'BUTTON' }).groupId;
  [['a method change on a PAYMENT row', 'PAYMENT', payment, { method: 'KBZ' }, { noteIfBlank: 'method' }],
   ['a method change on a DEPOSIT row (source and transcript in opts)', 'DEPOSIT', deposit, { method: 'WAVE' }, { noteIfBlank: 'method', source: 'VOICE', transcript: 'Wave နဲ့ ပေးသွားတယ်' }]].forEach(([label, type, make, changes, opts], i) => {
    const gA = make(A), gB = make(B), nA = A.ledger.length, nB = B.ledger.length;
    const a = legacyRewriteGroup(A.ports, gA, changes, sister, 'upd-u' + i, opts), b = rewriteGroup(B.ports, gB, changes, sister, 'upd-u' + i, opts);
    check(gA === gB && a.ok === true && b.ok === true && same(a, b) && B.ledger.length === nB + 2 && same(A.ledger.slice(nA), B.ledger.slice(nB)) && b.row.type === type && b.row.method === changes.method && b.txs[0].reversesTxId !== '',
      'rewriteGroup, ' + label + ': the returned rows and the two appended ledger rows equal the function it replaced', { a, b });
  });
  check(same(A.ledger, B.ledger), 'and the two ledgers are still identical');

  // gas_setup.js (ensureListsTab, writeDashboard) and the sync phone seed read the lists with ports that carry only a store.
  const w = newWorld(), p = w.ports, bare = { store: p.store }, e0 = w.errors.length;
  check(CFG.LIST_NAMES.every(n => same(legacyListRows(bare, n), legacyListRows(p, n)) && same(listRows(bare, n), listRows(p, n)) && same(listOptions(bare, n, null, true), listOptions(p, n, null, true)))
    && same(payMethods(bare), payMethods(p)) && same(expenseCategories(bare), expenseCategories(p)) && listsJsonFor(bare) === '' && transferLine(bare, 'S1') === '' && methodLabel(bare, 'KBZ') === MSG.method_KBZ
    && t(bare, 'lists_note_key') === MSG.lists_note_key && w.errors.length === e0,
    'ports that carry only a store ({store: gasStore}) serve every list reader on a sheet without Lists rows, and log nothing');
  simSeedLists(w);
  w.lists.filter(r => r.list === 'pay_method' && r.key === 'KBZ')[0].detail = '0977 123';
  check(same(listOptions(bare, 'pay_method', null, true), listOptions(p, 'pay_method', null, true)) && listsJsonFor(bare) === listsJsonFor(p) && listsJsonFor(bare) !== ''
    && same(transferLines(bare, 'S1'), [MSG.method_KBZ + ' 0977 123']) && transferLine(bare, 'S1') === 'ငွေလွှဲရန် · ' + MSG.method_KBZ + ' 0977 123' && w.errors.length === e0,
    'and on a seeded Lists tab (rows, lists_json, the transfer line)');

  // Source 1 is normalised by the core, whatever a store hands over (a Sheet gives text, numbers and booleans as they were typed).
  const raw = [{ list: 'pay_method', key: ' aya ', label: ' AYA ', active: 'TRUE', order: '2', shop: 's2', detail: 9777123456, note: null },
               { list: 'pay_method', key: 'Kbz', label: '', active: 'FALSE', order: '', shop: '' }, { list: 'pay_method', key: 'kbz', label: 'the same key again' }];
  const snapshot = JSON.stringify(raw);
  const pr = Object.assign({}, p, { store: Object.assign({}, p.store, { listOptions: n => (n === 'pay_method' ? raw : []) }) });
  check(same(listRows(pr, 'pay_method'), [{ list: 'pay_method', key: 'AYA', label: 'AYA', active: true, order: 2, shop: 'S2', detail: '9777123456', note: '' },
                                           { list: 'pay_method', key: 'KBZ', label: 'KBZ', active: false, order: 0, shop: '', detail: '', note: '' }])
    && JSON.stringify(raw) === snapshot && same(payMethods(pr, 'S2'), ['CASH', 'AYA']) && same(payMethods(pr, 'S1'), ['CASH']) && same(listRows(pr, 'fabric'), legacyListRows(pr, 'fabric')),
    'rows a store returns as they were typed (text TRUE / FALSE, a text Order, a lower-case Shop, a number as Detail, a key repeated in another case) come out normalised; the store\'s rows are not touched', listRows(pr, 'pay_method'));

  // A split leaves the numbers of the other receipts and the customer's totals alone.
  const w2 = newWorld({ lists: true }), p2 = w2.ports;
  const sell = o => commitSale(p2, Object.assign({ item: p2.store.getItem('S1-0002'), qty: 1, unitPrice: 30000, staff: sister, source: 'BUTTON' }, o || {})).groupId;
  const g1 = sell(), g2 = sell(), g3 = sell(), before = [g1, g2, g3].map(g => receiptNumber(p2, g));
  splitSale(p2, g1, 10000, 'KBZ', sister, 'u1', 'BUTTON');
  splitSale(p2, g2, 30000, 'WAVE', sister, 'u2', 'BUTTON');
  const g4 = sell();
  check(same([g1, g2, g3].map(g => receiptNumber(p2, g)), before) && new Set(before.concat([receiptNumber(p2, g4)])).size === 4,
    'a split and a full move leave every receipt number as it was; the next sale takes the next number', [before, [g1, g2, g3, g4].map(g => receiptNumber(p2, g))]);
  const gC = sell({ paid: 18000, customerId: 'C-0001', note: 'credit' });
  const sum0 = customerSummary(p2, 'C-0001');
  const rC = splitSale(p2, gC, 6000, 'KBZ', sister, 'u3', 'BUTTON');
  check(rC.ok && !rC.full && same(customerSummary(p2, 'C-0001'), sum0) && sum0.owed > 0, 'a split changes nothing in the customer\'s summary (bought, paid, owed, visits)', [sum0, customerSummary(p2, 'C-0001')]);
}

/* ------------------------------ V. fixes after the review of the build ------------------------------ */

step('V. Review fixes: openCredits stays cheap with many splits; "KBZ" goes to the shop\'s own account; an amount is never an option name');
{
  // openCredits: a split sale owes nothing (its account part is a PAYMENT), so it must not cost a saleGroupInfo
  // (a whole-ledger read) on every later call. Counted by the reads of the ledger: one for the call itself, one per open credit.
  const w = newWorld({ lists: true }), p = w.ports;
  const sell = o => commitSale(p, Object.assign({ item: p.store.getItem('S1-0002'), qty: 1, unitPrice: 30000, staff: sister, source: 'BUTTON' }, o || {})).groupId;
  for (let i = 0; i < 40; i++) splitSale(p, sell(), 10000 + i, i % 2 ? 'KBZ' : 'WAVE', sister, 'v' + i, 'BUTTON');
  const counted = (pp, fn) => {
    const orig = pp.store.ledgerRows;
    let reads = 0;
    pp.store.ledgerRows = function () { reads++; return orig.apply(this, arguments); };
    try { return { out: fn(), reads }; } finally { pp.store.ledgerRows = orig; }
  };
  const before = openCredits(p, null).map(c => c.groupId);   // the seeded world has its own open credits
  let oc = counted(p, () => openCredits(p, null));
  check(same(oc.out.map(c => c.groupId), before) && oc.reads === 1 + before.length, '40 split sales that owe nothing: openCredits reads the ledger once, plus once per open credit (no saleGroupInfo per split group)', [oc.reads, before.length]);
  const gc1 = sell({ paid: 10000, customerId: 'C-0001', note: 'credit' }), gc2 = sell({ paid: 0, customerId: 'C-0002', note: 'credit' });
  splitSale(p, gc1, 4000, 'KBZ', sister, 'v-c1', 'BUTTON');
  oc = counted(p, () => openCredits(p, 'S1'));
  check(oc.out.filter(c => c.groupId === gc1 && c.owed === 20000).length === 1 && oc.out.filter(c => c.groupId === gc2 && c.owed === 30000).length === 1 && oc.reads === 1 + oc.out.length,
    'two open credits (one of them split): both listed with what they owe; one read for the call and one per open credit', [oc.out.map(c => c.owed), oc.reads]);

  // The same list as a brute force over every sale group, on a world with credits, payments, splits, deposits
  // applied, undos, and rows of the older shape (a mirror written outside the group of the row it reverses).
  const brute = (pp, shop) => {
    const groups = [];
    pp.store.ledgerRows().forEach(r => { if (r.type === 'SALE' && (!shop || r.shop === shop) && groups.indexOf(r.groupId) < 0) groups.push(r.groupId); });
    return groups.map(g => saleGroupInfo(pp, g)).filter(i => i && !i.voided && i.owed > 0).map(i => i.groupId + ':' + i.owed).sort();
  };
  const w2 = newWorld({ lists: true }), p2 = w2.ports;
  const sell2 = o => commitSale(p2, Object.assign({ item: p2.store.getItem('S1-0002'), qty: 1, unitPrice: 30000, staff: sister, source: 'BUTTON' }, o || {})).groupId;
  commitDeposit(p2, { shop: 'S1', customerId: 'C-0001', amount: 50000, staff: sister, source: 'BUTTON' });
  for (let i = 0; i < 30; i++) {
    const credit = i % 3 === 0, g = sell2(credit ? { paid: 5000, customerId: 'C-0001', note: 'credit' } : {});
    if (i % 4 === 0) splitSale(p2, g, credit ? 2000 : 12000, 'KBZ', sister, 'b' + i, 'BUTTON');
    if (credit && i % 2 === 0) commitPayment(p2, { groupId: g, amount: 25000, staff: sister, source: 'BUTTON' });
    if (credit && i === 3) applyDeposit(p2, { groupId: g, staff: sister, source: 'BUTTON' });
    if (i % 7 === 5) undoGroup(p2, g, sister);
  }
  // Older shape 1: a deposit applied to a credit sale, its mirror written in another group: the sale owes again.
  const gOld1 = sell2({ paid: 10000, customerId: 'C-0002', note: 'credit' });
  const dep = writeGroup(p2, [newTx(p2, { groupId: gOld1, shop: 'S1', itemId: 'S1-0002', type: 'DEPOSIT_APPLIED', amount: 20000, cash: 0, customerId: 'C-0002', refGroupId: gOld1, note: 'deposit', staffId: sister.id })]).txs[0];
  writeGroup(p2, [newTx(p2, { groupId: 'OLD-UNDO-1', shop: 'S1', itemId: 'S1-0002', type: 'DEPOSIT_APPLIED', amount: -20000, cash: 0, customerId: 'C-0002', refGroupId: gOld1, note: 'undo', staffId: sister.id, reversesTxId: dep.txId })]);
  // Older shape 2: a paid sale rewritten into a credit, the mirror of the paid row written in another group.
  const gOld2 = sell2();
  const paidRow = p2.store.ledgerRows().filter(r => r.groupId === gOld2)[0];
  writeGroup(p2, [newTx(p2, { groupId: 'OLD-UNDO-2', shop: 'S1', itemId: 'S1-0002', type: 'SALE', qty: 1, unitPrice: 30000, amount: -30000, cash: -30000, note: 'rewrite', staffId: sister.id, reversesTxId: paidRow.txId, method: 'CASH' })]);
  writeGroup(p2, [newTx(p2, { groupId: gOld2, shop: 'S1', itemId: 'S1-0002', type: 'SALE', qty: -1, unitPrice: 30000, amount: 30000, cash: 8000, customerId: 'C-0002', note: 'credit', staffId: sister.id, method: 'CASH' })]);
  const fast = openCredits(p2, null).map(c => c.groupId + ':' + c.owed).sort(), slow = brute(p2, null);
  check(same(fast, slow) && fast.indexOf(gOld1 + ':20000') >= 0 && fast.indexOf(gOld2 + ':22000') >= 0 && same(openCredits(p2, 'S1').map(c => c.groupId + ':' + c.owed).sort(), brute(p2, 'S1')) && openCredits(p2, 'S2').length === 0,
    'openCredits equals saleGroupInfo over every sale group (credits, payments, splits, deposits, undos, mirrors of the older shape outside their group)', [fast.length, slow.length, fast.filter(x => slow.indexOf(x) < 0), slow.filter(x => fast.indexOf(x) < 0)]);

  // methodKeyFor: the family unticked the generic KBZ row and added its real KBZ account.
  const w3 = newWorld({ lists: true }), p3 = w3.ports;
  const real = addListOptionByLabel(p3, 'pay_method', 'KBZ ဦးမောင်', sister);
  w3.lists.filter(r => r.list === 'pay_method' && r.key === 'KBZ')[0].active = false;
  check(same(payMethods(p3, 'S1'), ['CASH', 'WAVE', 'BANK', real.key]) && methodKeyFor(p3, 'KBZ', 'S1') === real.key && methodKeyFor(p3, 'kbz', 'S1') === real.key,
    'a spoken or answered "KBZ" goes to the shop\'s active KBZ account, not to the retired generic row', [methodKeyFor(p3, 'KBZ', 'S1'), real.key]);
  check(methodKeyFor(p3, 'WAVE', 'S1') === 'WAVE' && methodKeyFor(p3, real.key, 'S1') === real.key && methodKeyFor(p3, 'CASH', 'S1') === 'CASH' && methodLabel(p3, 'KBZ') === MSG.method_KBZ && methodKnown(p3, 'KBZ'),
    'an active key still wins at once; the retired KBZ stays known (old cards) and keeps its label');
  w3.lists.push(acct('YOMA', 'Yoma ဟောင်း', { order: 30, active: false }));
  check(methodKeyFor(p3, 'YOMA', 'S1') === 'YOMA' && methodKeyFor(p3, 'Yoma ဟောင်း', 'S1') === '', 'a retired key that no active label matches is still returned as it is; its label is not offered');

  // An amount written with a currency word, a k, Burmese digits or number words is not an option name.
  const w4 = newWorld({ lists: true }), p4 = w4.ports, n4 = w4.lists.length;
  const amounts = ['5000 ကျပ်', '10k', '10K', '၅၀၀၀ ကျပ်', 'တစ်သောင်း', 'တစ်ငါးထောင်', 'ငါးထောင် ကျပ်', '5,000 Ks', '18000 MMK', '၁၀,၀၀၀ကျပ်', 'နှစ်သောင်းငါးထောင်', 'သုံးထောင့်ငါးရာ', 'တစ်သိန်းခွဲ', '5 သောင်း'];
  check(amounts.every(v => same(addListOptionByLabel(p4, 'pay_method', v, sister), { ok: false, reason: 'empty' })) && w4.lists.length === n4,
    'amounts in words or with a currency are refused as empty, like digits ("5000 ကျပ်", "10k", "တစ်သောင်း", ...)', amounts.map(v => addListOptionByLabel(p4, 'pay_method', v, sister).reason || 'created'));
  const names = ['KBZ 2', 'CB ဘဏ် 24', 'ငါးမျိုး', 'Kpay ဦးမောင်', 'k+'], n4b = w4.lists.length;
  const made = names.map(v => addListOptionByLabel(p4, 'pay_method', v, sister));
  check(made.every(r => r.ok && r.created) && w4.lists.length === n4b + names.length, 'a name that only carries a number (KBZ 2, CB ဘဏ် 24) is still a name', made);
  check(listLooksLikeAmount('5000 ကျပ်') && !listLooksLikeAmount('ကျပ်') && !listLooksLikeAmount('ရေဖိုး') && !listLooksLikeAmount(''), 'listLooksLikeAmount needs a number and nothing else but currency words');
}

/* ------------------------------ W. item categories (round 6b, G2) ------------------------------ */

step('W. Item categories (round 6b, G2)');
{
  const SILK = 'ပိုးအင်္ကျီ';
  const icRows = w => w.lists.filter(r => r.list === 'item_category');
  const labels = rows => rows.map(r => r.label);
  /** listOptions as it was before round 6b took its filter and sort out into listPick (verbatim, renamed). */
  const legacyListOptions = (ports, name, shop, includeInactive) => {
    const want = shop ? String(shop).toUpperCase() : '';
    const picked = [];
    listRows(ports, name).forEach((r, idx) => {
      if (!includeInactive && !r.active) return;
      if (want && r.shop && r.shop !== want) return;
      picked.push({ r: r, idx: idx });
    });
    picked.sort((a, b) => {
      const ao = a.r.order > 0 ? a.r.order : Infinity, bo = b.r.order > 0 ? b.r.order : Infinity;
      if (ao !== bo) return ao < bo ? -1 : 1;
      return a.idx - b.idx;
    });
    return picked.map(x => x.r);
  };

  // W1: the CFG members and the five built-in rows.
  const w1 = newWorld(), p1 = w1.ports, lg = legacyListRows(p1, 'item_category');
  check(CFG.LIST_NAMES[CFG.LIST_NAMES.length - 1] === 'item_category' && CFG.LIST_CODES.ic === 'item_category' && CFG.LIST_PREFIX.item_category === 'i' && !('LIST_LAZY' in CFG) &&
    CFG.ITEM_CATEGORY_KEYS.length === CFG.CATEGORIES.length && CFG.ITEM_CATEGORY_KEYS[CFG.ITEM_CATEGORY_KEYS.length - 1] === 'other' &&
    CFG.SAMPLE_WORD === 'နမူနာ' && CFG.SAMPLE_EMOJI === '🎨' && CFG.ITEM_CATEGORY_NEUTRAL === '🔖' && CFG.RESTOCK_LOOP_TTL_SEC === 180,
    'W1 CFG: item_category last in LIST_NAMES, code ic, prefix i, no LIST_LAZY; ITEM_CATEGORY_KEYS parallel to CATEGORIES ending with other; SAMPLE_WORD, SAMPLE_EMOJI 🎨, ITEM_CATEGORY_NEUTRAL 🔖, RESTOCK_LOOP_TTL_SEC 180',
    { names: CFG.LIST_NAMES, keys: CFG.ITEM_CATEGORY_KEYS });
  check(lg.length === 5 && same(lg.map(r => r.key), CFG.ITEM_CATEGORY_KEYS) && same(labels(lg), CFG.CATEGORIES) && lg.every((r, i) => r.detail === CFG.CATEGORY_EMOJI[CFG.CATEGORIES[i]] && r.order === i + 1 && r.shop === '' && r.active === true),
    'W1 legacyListRows(item_category): five rows, the fixed keys, the labels of CFG.CATEGORIES, Detail = CFG.CATEGORY_EMOJI, Order 1..5, Shop blank', lg);

  // W2: the first seed, lists_json and the per-list fallback.
  const w2 = newWorld({ lists: true }), p2 = w2.ports, ic2 = w2.lists.slice(-5);
  const firstLists = [];
  w2.lists.forEach(r => { if (firstLists.indexOf(r.list) < 0) firstLists.push(r.list); });
  check(same(firstLists, ['pay_method', 'expense_category', 'fabric', 'item_category']) && same(ic2.map(r => r.key), CFG.ITEM_CATEGORY_KEYS) && ic2.every((r, i) => r.list === 'item_category' && r.order === i + 1 && r.detail === CFG.CATEGORY_EMOJI[r.label] && r.active === true),
    'W2 simSeedLists: the three round-4 lists, then the five item_category rows (keys, Order 1..5, Detail emojis, active)', ic2);
  const lj = JSON.parse(listsJsonFor(p2));
  check(same(itemCategoryOptions(p2, 'S1').map(r => r.key), CFG.ITEM_CATEGORY_KEYS) && same(lj.item_category.map(c => c.k), CFG.ITEM_CATEGORY_KEYS) && same(lj.item_category.map(c => c.d), CFG.CATEGORIES.map(c => CFG.CATEGORY_EMOJI[c])),
    'W2 itemCategoryOptions(S1) = the five in built-in order; listsJsonFor carries item_category with its five rows', lj.item_category);
  const ph2 = phoneLikePorts({ lists_json: JSON.stringify({ pay_method: [{ k: 'CASH', l: 'ငွေသား', a: 1, o: 1, s: '', d: '' }], expense_category: [], fabric: [], item_category: [] }) });
  check(same(labels(itemCategoryOptions(p1, 'S1')), CFG.CATEGORIES) && same(labels(itemCategoryOptions(ph2, 'S1')), CFG.CATEGORIES) && same(itemCategoryOptions(ph2, 'S2').map(r => r.key), CFG.ITEM_CATEGORY_KEYS),
    'W2 a world with no Lists rows and a phone whose lists_json has item_category: [] both offer the five (the per-list fallback)', labels(itemCategoryOptions(ph2, 'S1')));

  // W3: the add writes the seed first on an empty list, one row on a seeded one; the catch-all stays last.
  const w3 = newWorld(), p3 = w3.ports;
  const a3 = addItemCategory(p3, SILK, sister, 'S1'), r3 = icRows(w3);
  check(a3.ok === true && a3.created === true && /^i[0-9a-f]{4}$/.test(a3.key) && a3.label === SILK, 'W3 addItemCategory on a world with no Lists rows: created, a key i + 4 hex digits', a3);
  check(r3.length === 6 && same(r3.slice(0, 5).map(r => r.key), CFG.ITEM_CATEGORY_KEYS) && r3.slice(0, 5).every((r, i) => r.order === i + 1 && r.detail === CFG.CATEGORY_EMOJI[CFG.CATEGORIES[i]]) &&
    r3[5].key === a3.key && r3[5].label === SILK && r3[5].order === 6 && r3[5].detail === '' && r3[5].shop === '' && /^added by Sister \(S1\) \d{4}-\d{2}-\d{2}$/.test(r3[5].note),
    'W3 the world\'s item_category rows: the five built-ins first (keys, Order 1..5, emojis), then the new one (Order 6, Detail blank, Shop blank, Note added by …)', r3);
  const w3b = newWorld({ lists: true }), p3b = w3b.ports, n3b = w3b.lists.length;
  const a3b = addItemCategory(p3b, SILK, sister, 'S1'), last3b = w3b.lists[w3b.lists.length - 1];
  check(a3b.created === true && w3b.lists.length === n3b + 1 && last3b.list === 'item_category' && last3b.order === 6 && a3b.key === a3.key &&
    same(labels(itemCategoryOptions(p3b, 'S1')), CFG.CATEGORIES.slice(0, 4).concat([SILK, CFG.CATEGORIES[4]])),
    'W3 on a seeded world the same add appends ONE row (Order 6); the options are the four garments, ' + SILK + ', then အခြား last; the same name gives the same key on another world', labels(itemCategoryOptions(p3b, 'S1')));

  // W4: itemCategoryFind: the same name, the sample word, empty, closed (unticked or another shop), the catch-all.
  const w4 = newWorld({ lists: true }), p4 = w4.ports;
  addItemCategory(p4, SILK, sister, 'S1');
  const n4 = w4.lists.length;
  const ex4 = ['ပိုး အင်္ကျီ', SILK + ZWSP, 'ထမီ'].map(v => addItemCategory(p4, v, sister, 'S1'));
  check(ex4[0].ok && ex4[0].existed && ex4[0].label === SILK && ex4[1].existed && ex4[1].label === SILK && ex4[2].existed && ex4[2].key === 'htamein' && ex4[2].label === 'ထမီ' && w4.lists.length === n4,
    'W4 a name already offered (spacing aside, a zero-width space aside, a built-in) is existed with the stored label; nothing written', ex4);
  const smp = ['နမူနာ', ' နမူနာ ', 'နမူနာ ထမီ'].map(v => itemCategoryFind(p4, v, 'S1'));
  const emp = ['', '123', '5000 ကျပ်'].map(v => itemCategoryFind(p4, v, 'S1'));
  check(smp.every(r => same(r, { ok: false, reason: 'sample' })) && emp.every(r => same(r, { ok: false, reason: 'empty' })) && same(addItemCategory(p4, 'နမူနာ ထမီ', sister, 'S1'), { ok: false, reason: 'sample' }) && w4.lists.length === n4,
    'W4 a name containing the sample word is refused as sample (also inside a longer name); empty, digits and an amount are empty', { smp, emp });
  w4.lists.filter(r => r.list === 'item_category' && r.key === 'wutsone')[0].active = false;
  const cl = itemCategoryFind(p4, 'ဝတ်စုံ', 'S1'), cla = addItemCategory(p4, 'ဝတ်စုံ', sister, 'S1');
  check(same(cl, { ok: false, reason: 'closed', key: 'wutsone', label: 'ဝတ်စုံ' }) && cla.ok === false && cla.reason === 'closed' && w4.lists.length === n4,
    'W4 the ဝတ်စုံ row unticked: itemCategoryFind answers closed (key wutsone), addItemCategory writes nothing', cl);
  w4.lists.push(row('item_category', 'mdy1', 'မန္တလေး ထည်', { order: 9, shop: 'S2' }));
  const s1 = itemCategoryFind(p4, 'မန္တလေး ထည်', 'S1'), s2 = itemCategoryFind(p4, 'မန္တလေး ထည်', 'S2');
  w4.lists.filter(r => r.list === 'item_category' && r.key === 'other')[0].active = false;
  const oth = itemCategoryFind(p4, 'အခြား', 'S1');
  check(s1.reason === 'closed' && s1.key === 'mdy1' && s2.ok && s2.existed && s2.key === 'mdy1' && oth.ok && oth.existed && oth.key === 'other',
    'W4 a row with Shop S2 is closed for S1 and existed for S2; အခြား is existed even with its row unticked (the catch-all is always offered)', { s1, s2, oth });

  // W5: hand-typed rows: the catch-all merged by key, the sample word filtered, a name on two rows shown once.
  resetWarned();
  const w5 = newWorld(), p5 = w5.ports;
  w5.lists = [row('item_category', 'pahsoe', 'ပုဆိုး')];
  const o5 = itemCategoryOptions(p5, 'S1');
  check(same(o5.map(r => [r.key, r.label]), [['pahsoe', 'ပုဆိုး'], ['other', 'အခြား']]), 'W5 a Lists tab with only a hand-typed ပုဆိုး: the options are ပုဆိုး and the catch-all အခြား (key other, merged by key), nothing else', o5);
  const add5 = addItemCategory(p5, 'အခြား', sister, 'S1');
  check(add5.ok && add5.existed && add5.key === 'other' && w5.lists.length === 1, 'W5 on that tab an add of အခြား finds the merged catch-all (key other) and writes nothing', { add5, rows: w5.lists.length });
  w5.lists = [row('item_category', 'misc', 'အခြား'), row('item_category', 'pahsoe', 'ပုဆိုး')];
  const o5b = itemCategoryOptions(p5, 'S1');
  check(same(o5b.map(r => [r.key, r.label]), [['pahsoe', 'ပုဆိုး'], ['other', 'အခြား']]) && o5b.filter(r => r.key === 'other').length === 1,
    'W5 with a hand-typed {misc, အခြား} before it: one အခြား option, keyed other (a cat:other lookup finds it)', o5b);
  w5.lists = [row('item_category', 'smp1', 'နမူနာ'), row('item_category', 'smp2', 'နမူနာ ထမီ'), row('item_category', 'pahsoe', 'ပုဆိုး')];
  const e5 = w5.errors.length;
  const o5c = itemCategoryOptions(p5, 'S1'), of5 = [itemCategoryOf(p5, 'နမူနာ'), itemCategoryOf(p5, 'နမူနာ ထမီ')];
  itemCategoryOptions(p5, 'S1');
  const e5s = w5.errors.slice(e5).filter(e => e.where === 'lists');
  check(same(o5c.map(r => r.key), ['pahsoe', 'other']) && of5.every(r => r === null) && e5s.length === 2 && e5s.every(e => e.message.indexOf(CFG.SAMPLE_WORD) >= 0),
    'W5 typed rows နမူနာ and နမူနာ ထမီ are neither offered nor found by itemCategoryOf; each is logged once (two Errors rows over several reads)', { o5c: o5c.map(r => r.key), e5s });
  w5.lists = [row('item_category', 'i3fa2', SILK), row('item_category', 'silk1', SILK)];
  const e5d = w5.errors.length;
  const o5d = itemCategoryOptions(p5, 'S1'), f5 = itemCategoryFind(p5, SILK, 'S1');
  itemCategoryOptions(p5, 'S2');
  const e5ds = w5.errors.slice(e5d).filter(e => e.where === 'lists');
  check(same(o5d.map(r => r.key), ['i3fa2', 'other']) && f5.existed && f5.key === 'i3fa2' && e5ds.length === 1 && e5ds[0].message.indexOf('i3fa2') >= 0,
    'W5 two rows ' + SILK + ' under keys i3fa2 and silk1: one option (the first), itemCategoryFind answers i3fa2, one log line', { o5d: o5d.map(r => r.key), e5ds });

  // W6: shops, the catch-all's place, its label, itemCategoryAi, itemCategoryCats, listOptions through listPick.
  const w6 = newWorld({ lists: true }), p6 = w6.ports, ic6 = k => w6.lists.filter(r => r.list === 'item_category' && r.key === k)[0];
  w6.lists.push(row('item_category', 'mdy1', 'မန္တလေး ထည်', { order: 6, shop: 'S2' }));
  check(itemCategoryOptions(p6, 'S2').some(r => r.key === 'mdy1') && !itemCategoryOptions(p6, 'S1').some(r => r.key === 'mdy1') &&
    itemCategoryAi(p6, 'S2').names.indexOf('မန္တလေး ထည်') >= 0 && itemCategoryAi(p6, 'S1').names.indexOf('မန္တလေး ထည်') < 0,
    'W6 a row with Shop S2 is offered for S2 only and is in itemCategoryAi(S2).names, not in (S1)', itemCategoryAi(p6, 'S2').names);
  ic6('other').active = false;
  const lastOff = itemCategoryOptions(p6, 'S1');
  ic6('other').active = true;
  ic6('other').order = 1;
  const lastFirst = itemCategoryOptions(p6, 'S2');
  check(lastOff[lastOff.length - 1].key === 'other' && lastFirst[lastFirst.length - 1].key === 'other' && lastFirst.filter(r => r.key === 'other').length === 1,
    'W6 the other row unticked, or given Order 1: still the last option', { off: lastOff.map(r => r.key), first: lastFirst.map(r => r.key) });
  ic6('other').label = 'တခြား';
  const ai6 = itemCategoryAi(p6, 'S1');
  check(itemCategoryFallback(p6) === 'တခြား' && ai6.names[ai6.names.length - 1] === 'တခြား' && ai6.other === 'တခြား', 'W6 relabelled တခြား: itemCategoryFallback, the end of itemCategoryAi(S1).names and its other are တခြား', ai6);
  const ctxList = ['ထမီ', 'x', 'တခြား'], cats6 = itemCategoryCats({ categories: ctxList }, p6, 'S1');
  check(same(cats6, { names: ['ထမီ', 'x', 'တခြား'], other: 'တခြား' }) && cats6.names !== ctxList && same(itemCategoryCats({}, p6, 'S1'), itemCategoryAi(p6, 'S1')) && same(itemCategoryCats(null, p6, 'S2'), itemCategoryAi(p6, 'S2')),
    'W6 itemCategoryCats: the job\'s ctx.categories (a copy, its last entry the catch-all); without one, itemCategoryAi', cats6);
  check(same(itemCategoryCats({ categories: [] }, p6, 'S1'), itemCategoryAi(p6, 'S1')) && itemCategoryCats({ categories: [] }, p6, 'S1').other === 'တခြား',
    'W6 itemCategoryCats with an empty ctx.categories: itemCategoryAi (never an empty list with no catch-all)', itemCategoryCats({ categories: [] }, p6, 'S1'));
  w6.lists.push(acct('AYA', 'AYA ဘဏ်', { order: 7, shop: 'S2' }), acct('OLD', 'old', { active: false }), row('expense_category', 'tea', 'လက်ဖက်ရည်', { order: 0 }), row('fabric', 'f9', 'ဇာ', { order: 2, shop: 'S1' }));
  const variants = [];
  ['pay_method', 'expense_category', 'fabric'].forEach(n => [undefined, 'S1', 'S2', 's2'].forEach(sh => [false, true].forEach(inc => variants.push(same(listOptions(p6, n, sh, inc), legacyListOptions(p6, n, sh, inc))))));
  check(variants.length === 24 && variants.every(Boolean), 'W6 listOptions (now through listPick) gives what it gave before for the three other lists, every shop, with and without inactive rows', variants);

  // W7: Telegram's emoji of a category and of an item.
  const w7 = newWorld({ lists: true }), p7 = w7.ports;
  w7.lists.push(row('item_category', 'silk1', SILK, { order: 6, detail: '🥻' }));
  const e7 = [itemCategoryEmoji(p7, SILK), itemCategoryEmoji(p7, 'ထမီ'), itemCategoryEmoji(p7, 'chair')];
  const ht = w7.lists.filter(r => r.list === 'item_category' && r.key === 'htamein')[0];
  ht.label = 'ထမိန်';
  ht.detail = '🥻';
  check(same(e7, ['🥻', '👗', '🔖']) && itemCategoryEmoji(p7, 'ထမီ') === '🥻' && itemEmoji(p7, { category: 'အခြား', sample: true }) === '🎨' && itemEmoji(p7, { category: 'အခြား', sample: false }) === '🧵' &&
    categoryEmoji('dress') === '🧵' && categoryEmoji.length === 1,
    'W7 itemCategoryEmoji: a Detail wins, a built-in name its emoji, an unknown name 🔖; the htamein row relabelled ထမိန် (Detail 🥻) still answers the old name ထမီ with 🥻; itemEmoji: 🎨 for a sample, 🧵 for an အခြား piece; categoryEmoji unchanged', e7);
  ht.detail = '';
  check(itemCategoryEmoji(p7, 'ထမီ') === '👗' && itemCategoryEmoji(p7, 'ထမိန်') === '🔖' && itemEmoji(p7, { category: 'ထမီ', sample: false }) === '👗',
    'W7 the htamein row (relabelled ထမိန်) with its Detail cleared: the old built-in name ထမီ shows the built-in 👗, the new label the neutral 🔖',
    [itemCategoryEmoji(p7, 'ထမီ'), itemCategoryEmoji(p7, 'ထမိန်')]);

  // W8: aiRenameFields with the job's list.
  const w8 = newWorld({ lists: true }), p8 = w8.ports;
  addItemCategory(p8, SILK, sister, 'S1');
  const ph8 = { id: 'S1-0007', name: itemPlaceholderName('S1-0007'), category: 'အခြား' }, d8 = { name: 'ပိုးထည် အင်္ကျီ အပြာ', category: 'ပိုး အင်္ကျီ' };
  const cats8 = itemCategoryAi(p8, 'S1');
  const at = c => aiRenameFields(Object.assign({}, ph8, { category: c }), d8, cats8);
  w8.lists.filter(r => r.list === 'item_category' && r.key === 'other')[0].label = 'တခြား';
  const cats8b = itemCategoryAi(p8, 'S1');
  check(same(at('အခြား'), { name: d8.name, category: SILK }) && same(aiRenameFields(Object.assign({}, ph8, { category: 'တခြား' }), d8, cats8b), { name: d8.name, category: SILK }) &&
    same(aiRenameFields(ph8, d8, cats8b), { name: d8.name, category: SILK }) && same(at('လုံချည်'), { name: d8.name }) && same(aiRenameFields(ph8, { name: 'x', category: 'chair' }, cats8), { name: 'x' }),
    'W8 aiRenameFields with the list: the AI\'s category as the list\'s label over the catch-all (also relabelled တခြား, and the old word အခြား); a garment category keeps; a category the list lacks → the name only', [at('အခြား'), at('လုံချည်')]);
  const ph = { id: 'S1-0007', name: 'ပစ္စည်း S1-0007', category: 'အခြား' }, desc = { name: 'ထမီ ပိုးထည် အစိမ်း', category: 'ထမီ' };
  check(same(aiRenameFields(ph, desc), { name: 'ထမီ ပိုးထည် အစိမ်း', category: 'ထမီ' }) && same(aiRenameFields(Object.assign({}, ph, { category: '' }), desc), { name: 'ထမီ ပိုးထည် အစိမ်း', category: 'ထမီ' }) &&
    same(aiRenameFields(Object.assign({}, ph, { category: 'လုံချည်' }), desc), { name: 'ထမီ ပိုးထည် အစိမ်း' }) && aiRenameFields(Object.assign({}, ph, { name: 'ထမီ ကျွန်မ' }), desc) === null &&
    aiRenameFields(Object.assign({}, ph, { name: '' }), desc) === null && aiRenameFields(ph, { name: '' }) === null && same(aiRenameFields(ph, { name: 'x', category: 'chair' }), { name: 'x' }) &&
    same(aiRenameFields(ph, d8), { name: d8.name }),
    'W8 without the third argument every W25 case is unchanged (and a custom category is not taken)');

  // W9: what commitNewItem and importProducts store.
  const w9 = newWorld({ lists: true }), p9 = w9.ports, own = { id: '1000', name: 'You (owner)', shop: 'S1', role: 'owner' };
  addItemCategory(p9, SILK, sister, 'S1');
  w9.lists.filter(r => r.list === 'item_category' && r.key === 'wutsone')[0].active = false;
  w9.lists.filter(r => r.list === 'item_category' && r.key === 'htamein')[0].label = 'ထမိန်';
  w9.lists.push(row('item_category', 'smp1', 'နမူနာ', { order: 9 }));
  const asked = ['ပိုး အင်္ကျီ', 'ဝတ်စုံ', 'chair', 'ထမီ', 'နမူနာ'], want9 = [SILK, 'ဝတ်စုံ', 'အခြား', 'ထမိန်', 'အခြား'];
  const got9 = asked.map((c, i) => { const r = commitNewItem(p9, { itemId: 'S1-00' + (i + 7 < 10 ? '0' : '') + (i + 7), name: 'x' + i, category: c, price: 10000, staff: own, source: 'PHOTO' }); return r.ok ? r.item.category : r.reason; });
  check(same(got9, want9), 'W9 commitNewItem stores: ပိုး အင်္ကျီ → ' + SILK + ', a retired ဝတ်စုံ as it is, chair → the catch-all, ထမီ → ထမိန် (the relabelled built-in), a hand-typed နမူနာ row → the catch-all', got9);
  const imp9 = importProducts(p9, asked.map((c, i) => ({ Code: 'S2-000' + (i + 4), Name: 'imp' + i, Category: c, Type: 'SKU', Price: 1000, Cost: '', Stock: 0, Shop: 'S2' })), own);
  const gotI = imp9.done.map(d => p9.store.getItem(d.id).category);
  check(imp9.done.length === 5 && same(gotI, want9), 'W9 importProducts stores the same five', { gotI, skipped: imp9.skipped });

  // W10: review fixes on the core (after the build): an old built-in name is its row at the add, a name of emoji only is
  // no name, and commitNewItem keeps the chosen row by its key through a rename.
  const w10 = newWorld({ lists: true }), p10 = w10.ports, own10 = { id: '1000', name: 'You (owner)', shop: 'S1', role: 'owner' };
  const ic10 = key => w10.lists.filter(r => r.list === 'item_category' && r.key === key)[0];
  ic10('htamein').label = 'ထမိန်';
  ic10('other').label = 'တခြား';
  const n10 = w10.lists.length;
  const f10 = [itemCategoryFind(p10, 'ထမီ', 'S1'), itemCategoryFind(p10, ' ထ မီ ', 'S2'), itemCategoryFind(p10, 'အခြား', 'S1')];
  const a10 = [addItemCategory(p10, 'ထမီ', sister, 'S1'), addItemCategory(p10, 'အခြား', sister, 'S1')];
  check(same(f10, [{ ok: true, existed: true, key: 'htamein', label: 'ထမိန်' }, { ok: true, existed: true, key: 'htamein', label: 'ထမိန်' }, { ok: true, existed: true, key: 'other', label: 'တခြား' }]) &&
    a10.every(r => r.ok && r.existed && !r.created) && w10.lists.length === n10 && same(labels(itemCategoryOptions(p10, 'S1')), ['ထမိန်', 'လုံချည်', 'အင်္ကျီ', 'ဝတ်စုံ', 'တခြား']),
    'W10 htamein relabelled ထမိန် and other relabelled တခြား: itemCategoryFind of the old names ထမီ (spacing aside) and အခြား is that row under its new label; addItemCategory writes no row; the chips unchanged', { f10, a10 });
  ic10('htamein').active = false;
  check(same(itemCategoryFind(p10, 'ထမီ', 'S1'), { ok: false, reason: 'closed', key: 'htamein', label: 'ထမိန်' }), 'W10 … and with that row unticked the old name is closed like the new one (typing it never reopens it)', itemCategoryFind(p10, 'ထမီ', 'S1'));
  ic10('htamein').active = true;
  const e10 = ['👗', '🎨🎨', '👗 ၁၂', '✂️ ✂️', '၊'].map(x => itemCategoryFind(p10, x, 'S1'));
  const e10add = addItemCategory(p10, '👗', sister, 'S1');
  const ok10 = [itemCategoryFind(p10, '👗 ပိုးထည်', 'S1'), itemCategoryFind(p10, 'Silk 👚', 'S1')];
  check(e10.every(r => same(r, { ok: false, reason: 'empty' })) && same(e10add, { ok: false, reason: 'empty' }) && w10.lists.length === n10 && ok10.every(r => r.ok && !r.existed),
    'W10 a name with no letter (emoji, emoji and digits, a sign) is empty at itemCategoryFind and addItemCategory writes nothing; a letter beside an emoji keeps it a name', { e10, ok10 });
  const s10 = addItemCategory(p10, SILK, sister, 'S1'), silk10 = ic10(s10.key);
  silk10.label = 'ပိုးထည် အင်္ကျီ';
  const c10 = [
    commitNewItem(p10, { itemId: 'S1-0007', name: 'a', category: SILK, categoryKey: s10.key, price: 10000, staff: own10, source: 'PHOTO' }),
    commitNewItem(p10, { itemId: 'S1-0008', name: 'b', category: SILK, price: 10000, staff: own10, source: 'PHOTO' }),
    commitNewItem(p10, { itemId: 'S1-0009', name: 'c', category: 'လုံချည်', categoryKey: 'nope1', price: 10000, staff: own10, source: 'PHOTO' }),
    commitNewItem(p10, { itemId: 'S1-0010', name: 'd', category: 'ထမီ', categoryKey: ' HTAMEIN ', price: 10000, staff: own10, source: 'PHOTO' })
  ].map(r => (r.ok ? r.item.category : r.reason));
  check(s10.ok && s10.created && same(c10, ['ပိုးထည် အင်္ကျီ', 'တခြား', 'လုံချည်', 'ထမိန်']),
    'W10 commitNewItem: a custom category renamed after it was chosen is stored under its new label when its key comes along (without the key the old name finds no row: the catch-all); an unknown key falls back to the name; a key is matched as listNormKey does', c10);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
