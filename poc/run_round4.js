/**
 * poc/run_round4.js — round 4, step 2 ("Bot"): bank accounts as the method buttons, one sale part cash and part
 * bank (the split), ➕ adding a missing option where it is needed, the accounts screen and an account's number,
 * the "where to transfer" line on receipts and vouchers, fabrics by key, design codes created on the spot, and
 * voice by an account's label. Same harness as poc/run_scenario.js: the real core over in-memory ports, on a
 * world seeded with seedSimWorld and then simSeedLists (the Lists tab has rows, as after setupSheet); step 9c
 * alone runs on a world without Lists rows (the sheet before setupSheet made the tab).
 * The clock is fixed (10:30 in Yangon, today) and moved by hand, so "40 minutes later" and "the next day" never
 * depend on when the suite runs. No network, no keys.
 * Mutation-tested: 223 single breaks of core_bot.js, core_orders.js and core_messages.js (one feature removed
 * or bent at a time, in a scratch copy, never in the project) each turn this file red.
 *
 *   node poc/run_round4.js
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const U = SIM_USERS;
const BASE = new Date(dayKey(new Date()) + 'T04:00:00.000Z');   // 10:30 in Yangon, today
const today = dayKey(BASE);

// Telegram rejects callback_data over 64 bytes. Watch every button every world of this file ever emits (sent or edited).
let maxCb = { len: 0, data: '' }, buttonsSeen = 0;
const worlds = [];

/**
 * A fresh world (seedSimWorld, then simSeedLists) with a fixed clock, and the helpers the steps use.
 * bench({ legacy: true }) leaves the Lists tab empty: the sheet as it is before setupSheet() created the tab.
 */
function bench(opts) {
  const world = createSimWorld();
  world.nowOverride = new Date(BASE.getTime());
  world.listeners.push(evt => {
    if (evt.type !== 'chat' || !evt.message || !evt.message.keyboard) return;
    evt.message.keyboard.forEach(row => row.forEach(b => {
      buttonsSeen++;
      const len = Buffer.byteLength(String(b.callback_data || ''), 'utf8');
      if (len > maxCb.len) maxCb = { len, data: b.callback_data };
    }));
  });
  seedSimWorld(world);
  if (!(opts && opts.legacy)) simSeedLists(world);
  worlds.push(world);
  const { ports, sim } = world;
  const b = {
    world, ports, sim,
    last: u => sim.lastBot(u),
    lastText: u => (sim.lastBot(u) || {}).text || '',
    lastRow: () => world.ledger[world.ledger.length - 1],
    state: u => getState(ports, String(u.id)),
    liveOf: g => liveRows(world.ledger.filter(r => r.groupId === g), world.ledger),
    bots: u => (world.chats[u.id] || []).filter(m => m.from === 'bot'),
    datas: m => ((m && m.keyboard) || []).map(row => row.map(x => x.callback_data)),
    texts: m => ((m && m.keyboard) || []).map(row => row.map(x => x.text)),
    flat: m => ((m && m.keyboard) || []).reduce((a, row) => a.concat(row.map(x => x.callback_data)), []),
    tick: min => { world.nowOverride = new Date(world.nowOverride.getTime() + min * 60000); },
    tapData: (u, data) => sim.tap(u, sim.lastBot(u).id, data),
    stats: shop => dayStats(ports, shop, today),
    net: (stats, key) => (stats.byMethod[key] ? stats.byMethod[key].in - stats.byMethod[key].out : 0),
    accounts: () => world.lists.filter(r => r.list === 'pay_method' && r.key !== 'CASH'),
    option: (list, key) => world.lists.filter(r => r.list === list && r.key === key)[0] || null,
    /** Replace the pay_method rows of the Lists tab: CASH plus the given accounts, in that order. */
    setAccounts(list) {
      const rows = [{ list: 'pay_method', key: 'CASH', label: MSG.method_CASH, active: true, order: 1, shop: '', detail: '', note: '' }];
      list.forEach((a, i) => rows.push({ list: 'pay_method', key: a.key, label: a.label, active: a.active !== false, order: i + 2, shop: a.shop || '', detail: a.detail || '', note: '' }));
      world.lists = rows.concat(world.lists.filter(r => r.list !== 'pay_method'));
    },
    /** Scan + one tap: {card, g, row}. The card object is the message itself, so later edits show on it. */
    sell(u, itemId) {
      sim.start(u, itemId);
      const card = sim.lastBot(u);
      sim.tap(u, card.id, 'S|' + itemId + '|1');
      return { card, g: b.lastRow().groupId, row: b.lastRow() };
    },
    /** Scan, 💬, a typed price: a one-piece sale of any total (the card is a new message). */
    sellAt(u, itemId, price) {
      sim.start(u, itemId);
      sim.tapLast(u, MSG.btn_discount);
      sim.text(u, String(price));
      return { card: sim.lastBot(u), g: b.lastRow().groupId, row: b.lastRow() };
    },
    /** Sale, 💳, paid now, the customer: a credit sale with something owed. Returns {g, reply}. */
    creditSale(u, itemId, paidNow, customerLabel) {
      const s = b.sell(u, itemId);
      sim.tap(u, s.card.id, 'CR|' + s.g);
      b.tapData(u, 'CP|' + s.g + '|' + paidNow);
      sim.tapLast(u, customerLabel);
      return { g: s.g, reply: sim.lastBot(u), card: s.card };
    },
    /** Menu, 💸, a category, an amount: the expense method screen is the last message. */
    expenseToMethod(u, catKey, amount) {
      sim.start(u, '');
      sim.tapLast(u, MSG.btn_expense);
      if (b.flat(sim.lastBot(u)).indexOf('ES|S1') >= 0) b.tapData(u, 'ES|S1');
      b.tapData(u, 'EC|' + catKey);
      b.tapData(u, 'EA|' + amount);
      return sim.lastBot(u);
    },
    /** Menu, 🧵, ➕, the customer, a design, (a price), one piece: the due screen is the last message. Returns the order id. */
    newOrder(u, customerLabel, designLabel) {
      sim.start(u, '');
      sim.tapLast(u, MSG.btn_orders);
      sim.tapLast(u, MSG.btn_order_new);
      sim.tapLast(u, customerLabel);
      const id = world.orders[world.orders.length - 1].id;
      sim.tapLast(u, designLabel);
      if (/^OP\|/.test(b.flat(sim.lastBot(u))[0])) b.tapData(u, b.flat(sim.lastBot(u))[0]);
      b.tapData(u, 'OQ|' + id + '|1');
      return id;
    },
    /** A complete order: due in the design's days, the given advance (0 = none). The voucher reply is the last message. */
    orderWithAdvance(u, customerLabel, advance) {
      const id = b.newOrder(u, customerLabel, 'TSL-0018');
      sim.tapLast(u, '✨');
      b.tapData(u, 'ODA|' + id + '|' + advance);
      return id;
    }
  };
  return b;
}

/* ============================== 1. the method rows (section 2) ============================== */

step('1. Method rows under a sale: three accounts in one row; split and ➕ in their own last row');
const A = bench();
let s1 = A.sell(U.sister, 'S1-0002');
check(same(A.datas(s1.card), [['U|' + s1.g, 'RC|' + s1.g], ['CR|' + s1.g, 'CU|' + s1.g],
  ['PM|' + s1.g + '|KBZ', 'PM|' + s1.g + '|WAVE', 'PM|' + s1.g + '|BANK'], ['SX|' + s1.g, 'LA|pm|PM|' + s1.g]]),
  'sale card: undo/receipt, credit/customer, one row of three 🏦 buttons, then [split, ➕] alone', A.datas(s1.card));
check(same(A.texts(s1.card)[3], [MSG.btn_split, MSG.btn_add_bank]) && A.texts(s1.card)[2].every(x => x.indexOf('🏦 ') === 0),
  'the last row reads 💵+🏦 ခွဲပေး and ➕ ဘဏ်အသစ်; the method buttons start with 🏦', A.texts(s1.card));
check(A.sim.button(s1.card, MSG.method_CASH) === null && MSG.btn_split.indexOf('🏦') !== 0 && MSG.btn_add_bank.indexOf(MSG.method_BANK) < 0,
  'no button text contains ငွေသား while the sale is cash; the split button does not start with 🏦');

step('1b. Two accounts: one row of two');
A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'WAVE', label: 'WavePay' }]);
s1 = A.sell(U.sister, 'S1-0002');
check(same(A.datas(s1.card).slice(2), [['PM|' + s1.g + '|KBZ', 'PM|' + s1.g + '|WAVE'], ['SX|' + s1.g, 'LA|pm|PM|' + s1.g]]),
  '2 accounts: [KBZ, WAVE] then [split, ➕]', A.datas(s1.card));

step('1c. Four accounts: rows of two');
A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'WAVE', label: 'WavePay' }, { key: 'BANK', label: 'ဘဏ်လွှဲ' }, { key: 'AYA', label: 'AYA' }]);
s1 = A.sell(U.sister, 'S1-0002');
check(same(A.datas(s1.card).slice(2), [['PM|' + s1.g + '|KBZ', 'PM|' + s1.g + '|WAVE'], ['PM|' + s1.g + '|BANK', 'PM|' + s1.g + '|AYA'], ['SX|' + s1.g, 'LA|pm|PM|' + s1.g]]),
  '4 accounts: two rows of two, then [split, ➕]', A.datas(s1.card));

step('1d. Seven accounts: rows of two, the odd one alone, nothing dropped');
A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'WAVE', label: 'WavePay' }, { key: 'BANK', label: 'ဘဏ်လွှဲ' }, { key: 'AYA', label: 'AYA' },
  { key: 'CB', label: 'CB' }, { key: 'UAB', label: 'UAB' }, { key: 'YOMA', label: 'Yoma' }]);
s1 = A.sell(U.sister, 'S1-0002');
check(same(A.datas(s1.card).slice(2).map(r => r.length), [2, 2, 2, 1, 2]) && A.flat(s1.card).filter(d => /^PM\|/.test(d)).length === 7 &&
  same(A.datas(s1.card).slice(-1)[0], ['SX|' + s1.g, 'LA|pm|PM|' + s1.g]), '7 accounts: 2 + 2 + 2 + 1, then [split, ➕]', A.datas(s1.card));
check(A.flat(s1.card).every(d => Buffer.byteLength(d, 'utf8') <= 64), 'every callback of that card is within 64 bytes');

step('1e. A long label: three accounts no longer share one row');
A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'WAVE', label: 'WavePay' }, { key: 'AYAMM', label: 'AYA ဒေါ်စန်းစန်းမြင့်' }]);
s1 = A.sell(U.sister, 'S1-0002');
check(same(A.datas(s1.card).slice(2), [['PM|' + s1.g + '|KBZ', 'PM|' + s1.g + '|WAVE'], ['PM|' + s1.g + '|AYAMM'], ['SX|' + s1.g, 'LA|pm|PM|' + s1.g]]) &&
  A.sim.button(s1.card, 'AYA ဒေါ်စန်းစန်းမြင့်') === 'PM|' + s1.g + '|AYAMM', 'a label over ten characters: rows of two ([KBZ, WAVE], [AYA ...])', A.datas(s1.card));

step('1f. A per-shop account shows only under that shop\'s sales');
A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'S2PAY', label: 'Wave ဆိုင်၂', shop: 'S2' }]);
s1 = A.sell(U.sister, 'S1-0002');
const s1b = A.sell(U.brother, 'S2-0002');
check(same(A.datas(s1.card)[2], ['PM|' + s1.g + '|KBZ']) && same(A.datas(s1b.card)[2], ['PM|' + s1b.g + '|KBZ', 'PM|' + s1b.g + '|S2PAY']),
  'shop 1 sale: KBZ only; shop 2 sale: KBZ and the shop-2 account', [A.datas(s1.card), A.datas(s1b.card)]);

step('1g. After a 🏦 tap the row offers 💵 and the other accounts; split and ➕ stay');
const A2 = bench();
s1 = A2.sell(U.sister, 'S1-0002');
A2.sim.tap(U.sister, s1.card.id, 'PM|' + s1.g + '|KBZ');
check(same(A2.datas(s1.card).slice(2), [['PM|' + s1.g + '|CASH', 'PM|' + s1.g + '|WAVE', 'PM|' + s1.g + '|BANK'], ['SX|' + s1.g, 'LA|pm|PM|' + s1.g]]) &&
  s1.card.text.indexOf(t(A2.ports, 'method_done', { method: 'KBZPay' })) >= 0, 'marked KBZPay: [💵, WavePay, ဘဏ်လွှဲ] then [split, ➕]', A2.datas(s1.card));

step('1h. Payment, deposit, expense and return replies: the 🏦 rows and ➕, no split');
let cr = A2.creditSale(U.sister, 'S1-0003', 0, 'ဒေါ်မြင့်');
check(A2.flat(cr.reply).every(d => !/^(PM|SX|LA)\|/.test(d)) && A2.flat(cr.reply).indexOf('PY|' + cr.g) >= 0,
  'a credit sale with nothing paid has no method row and no split (no cash moved)', A2.datas(cr.reply));
A2.sim.tap(U.sister, cr.reply.id, 'PY|' + cr.g);
A2.tapData(U.sister, 'PA|' + cr.g + '|all');
let payG = A2.lastRow().groupId;
check(A2.lastRow().type === 'PAYMENT' && same(A2.datas(A2.last(U.sister)), [['U|' + payG, 'RC|' + cr.g], ['PM|' + payG + '|KBZ', 'PM|' + payG + '|WAVE', 'PM|' + payG + '|BANK'], ['LA|pm|PM|' + payG]]),
  'payment reply: undo/receipt, the 🏦 row, then ➕ alone (no split)', A2.datas(A2.last(U.sister)));
A2.sim.start(U.sister, '');
A2.sim.tapLast(U.sister, MSG.btn_deposit);
A2.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
A2.sim.tapLast(U.sister, '100,000');
A2.sim.tapLast(U.sister, MSG.btn_skip);
let depG = A2.lastRow().groupId;
check(A2.lastRow().type === 'DEPOSIT' && same(A2.datas(A2.last(U.sister)), [['U|' + depG], ['PM|' + depG + '|KBZ', 'PM|' + depG + '|WAVE', 'PM|' + depG + '|BANK'], ['LA|pm|PM|' + depG]]),
  'deposit reply: undo, the 🏦 row, ➕', A2.datas(A2.last(U.sister)));
let methodScreen = A2.expenseToMethod(U.sister, 'phone', 10000);
check(same(A2.datas(methodScreen), [['EM|CASH', 'EM|KBZ'], ['EM|WAVE', 'EM|BANK'], ['LA|pm|EM'], ['Z']]) && methodScreen.keyboard[0][0].text === MSG.btn_cash,
  'expense method screen: 💵 first, rows of two, ➕ alone, and its cancel row last', A2.datas(methodScreen));
A2.tapData(U.sister, 'EM|CASH');
let expG = A2.lastRow().groupId;
check(A2.lastRow().type === 'EXPENSE' && same(A2.datas(A2.last(U.sister)), [['U|' + expG, 'EN|' + expG], ['PM|' + expG + '|KBZ', 'PM|' + expG + '|WAVE', 'PM|' + expG + '|BANK'], ['LA|pm|PM|' + expG]]),
  'expense reply: undo/note, the 🏦 row, ➕', A2.datas(A2.last(U.sister)));
A2.sim.start(U.sister, 'S1-0002');
A2.sim.tapLast(U.sister, MSG.btn_return);
let retG = A2.lastRow().groupId;
check(A2.lastRow().type === 'RETURN' && same(A2.datas(A2.last(U.sister)), [['U|' + retG], ['PM|' + retG + '|KBZ', 'PM|' + retG + '|WAVE', 'PM|' + retG + '|BANK'], ['LA|pm|PM|' + retG]]),
  'return reply: undo, the 🏦 row, ➕', A2.datas(A2.last(U.sister)));

step('1i. A retired account: the button of an old card still works (methodKnown), new cards do not offer it');
s1 = A2.sell(U.sister, 'S1-0002');
A2.option('pay_method', 'BANK').active = false;
const s1c = A2.sell(U.sister, 'S1-0002');
check(A2.flat(s1c.card).indexOf('PM|' + s1c.g + '|BANK') < 0, 'a new sale card no longer offers the retired account');
A2.sim.tap(U.sister, s1.card.id, 'PM|' + s1.g + '|BANK');
check(A2.liveOf(s1.g)[0].method === 'BANK' && s1.card.text.indexOf(t(A2.ports, 'method_done', { method: 'ဘဏ်လွှဲ' })) >= 0, 'the old card\'s BANK button still marks the sale (label of the retired row)');
A2.option('pay_method', 'BANK').active = true;
const n1i = A2.world.ledger.length;
A2.sim.tap(U.sister, s1c.card.id, 'PM|' + s1c.g + '|NOPE');
check(A2.world.ledger.length === n1i && s1c.card.text.indexOf(MSG.expired) >= 0, 'a key no list knows is refused and nothing is written');
methodScreen = A2.expenseToMethod(U.sister, 'food', 5000);
A2.tapData(U.sister, 'EM|NOPE');
check(A2.world.ledger.length === n1i && methodScreen.text === MSG.expired, 'EM with an unknown key: expired, no expense written');

step('1j. The method screens follow the shop of the entry, not of the person: the owner (shop 1) working for shop 2');
const A3 = bench();
A3.world.lists.push({ list: 'pay_method', key: 'S2PAY', label: 'Wave ဆိုင်၂', active: true, order: 9, shop: 'S2', detail: '', note: '' });
[['S2', true], ['S1', false]].forEach(c => {
  A3.sim.start(U.owner, '');
  A3.sim.tapLast(U.owner, MSG.btn_expense);
  A3.tapData(U.owner, 'ES|' + c[0]);
  A3.tapData(U.owner, 'EC|phone');
  A3.tapData(U.owner, 'EA|10000');
  check((A3.flat(A3.last(U.owner)).indexOf('EM|S2PAY') >= 0) === c[1] && A3.flat(A3.last(U.owner)).indexOf('EM|KBZ') >= 0,
    'an expense of ' + c[0] + ': the shop-2 account is ' + (c[1] ? 'offered' : 'not offered'), A3.datas(A3.last(U.owner)));
  A3.tapData(U.owner, 'Z');
});
const so1j = A3.sell(U.owner, 'S2-0002');
check(so1j.row.shop === 'S2' && A3.flat(so1j.card).indexOf('PM|' + so1j.g + '|S2PAY') >= 0, 'a shop-2 piece sold by the owner: the card offers the shop-2 account', A3.datas(so1j.card));
A3.sim.tap(U.owner, so1j.card.id, 'SX|' + so1j.g);
check(A3.flat(A3.last(U.owner)).indexOf('SXM|' + so1j.g + '|S2PAY') >= 0, 'and so does its split account screen', A3.datas(A3.last(U.owner)));
A3.tapData(U.owner, 'Z');
const oid1j = A3.orderWithAdvance(U.brother, 'ဒေါ်မြင့်', 50000);
A3.sim.text(U.owner, oid1j);
A3.sim.tapLast(U.owner, MSG.btn_deliver);
A3.tapData(U.owner, 'ODP|' + oid1j + '|all|0');
check(A3.flat(A3.last(U.owner)).indexOf('ODM|' + oid1j + '|S2PAY|100000|0') >= 0 && same(A3.datas(A3.last(U.owner)).slice(-1)[0], ['Z']), 'a shop-2 order delivered by the owner: the shop-2 account is offered', A3.datas(A3.last(U.owner)));
A3.tapData(U.owner, 'Z');
A3.sim.text(U.owner, oid1j);
A3.tapData(U.owner, 'OX|' + oid1j);
A3.tapData(U.owner, 'OXR|' + oid1j + '|refund');
check(A3.flat(A3.last(U.owner)).indexOf('OXM|' + oid1j + '|S2PAY') >= 0 && same(A3.datas(A3.last(U.owner)).slice(-1)[0], ['Z']), 'and on its refund method screen', A3.datas(A3.last(U.owner)));
A3.tapData(U.owner, 'Z');
A3.setAccounts([{ key: 'S2PAY', label: 'Wave ဆိုင်၂', shop: 'S2' }]);         // shop 2 has one account, shop 1 has none
const so1j2 = A3.sell(U.owner, 'S2-0002');
A3.sim.tap(U.owner, so1j2.card.id, 'SX|' + so1j2.g);
check(A3.lastText(U.owner) === t(A3.ports, 'split_ask_amount', { method: 'Wave ဆိုင်၂', cash: '22,000' }) && A3.flat(A3.last(U.owner)).indexOf('SXA|' + so1j2.g + '|S2PAY|half') >= 0,
  'the split counts the accounts of the SALE\'s shop: one account of shop 2, straight to its amount screen (the owner\'s own shop has none)', A3.lastText(U.owner));
A3.tapData(U.owner, 'Z');

step('1k. methodRows itself: current as an array, no opts, a callback that would be too long');
const A4 = bench();
const cb1k = rows1k => rows1k.map(r => r.map(b => b.callback_data));
check(same(cb1k(methodRows(A4.ports, 'S1', ['CASH', 'kbz'], k => 'T|' + k)), [['T|WAVE', 'T|BANK']]), 'current = [CASH, kbz] (any case): neither gets a button; without opts there is no extra row', cb1k(methodRows(A4.ports, 'S1', ['CASH', 'kbz'], k => 'T|' + k)));
check(same(cb1k(methodRows(A4.ports, 'S1', null, k => 'T|' + k, {})), [['T|CASH', 'T|KBZ'], ['T|WAVE', 'T|BANK']]) && methodRows(A4.ports, 'S1', null, k => 'T|' + k, {})[0][0].text === MSG.btn_cash,
  'current = null: 💵 first, four buttons in rows of two');
const long1k = new Array(60).join('x');
check(same(cb1k(methodRows(A4.ports, 'S1', 'CASH', k => (k === 'WAVE' ? long1k : '') + 'T|' + k, { split: long1k + long1k, add: 'A' })), [['T|KBZ', 'T|BANK'], ['A']]),
  'a method button and a split button whose callback data would exceed 64 bytes are left out; the rest of the keyboard stays');
check(same(cb1k(methodRows(A4.ports, 'S1', 'CASH', k => 'T|' + k, { split: 'S', add: long1k + long1k })), [['T|KBZ', 'T|WAVE', 'T|BANK'], ['S']]) &&
  same(cb1k(methodRows(A4.ports, 'S1', 'CASH', k => 'T|' + k, { split: long1k + long1k, add: long1k + long1k })), [['T|KBZ', 'T|WAVE', 'T|BANK']]),
  'the same for the ➕ button; with both left out there is no empty last row');
const free1k = commitReturn(A4.ports, { item: A4.ports.store.getItem('S1-0002'), qty: 1, unitPrice: 0, staff: A4.ports.store.getStaff(String(U.sister.id)), source: CFG.SOURCE.BUTTON });
check(same(cb1k(replyKeyboard(A4.ports, free1k.groupId)), [['U|' + free1k.groupId]]), 'a reply whose row moved no money (a return at 0) has no method row and no ➕: there is nothing to mark', cb1k(replyKeyboard(A4.ports, free1k.groupId)));

/* ============================== 2. one sale, part cash and part bank (section 3.2) ============================== */

step('2. Split by buttons: 💵+🏦, the account, half');
const B = bench();
const st2 = B.stats('S1'), credits2 = openCredits(B.ports, null).length;
let x = B.sell(U.sister, 'S1-0002');
const sale2 = x.row, cardText2 = x.card.text, cardKb2 = JSON.stringify(B.datas(x.card)), rcpt2 = receiptNumber(B.ports, x.g);
let n2 = B.world.ledger.length;
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
let q = B.last(U.sister);
check(q.id !== x.card.id && !q.edited && q.text === t(B.ports, 'split_ask_bank', { cash: '18,000' }), 'the question is a NEW message naming the cash paid', q.text);
check(x.card.text === cardText2 && JSON.stringify(B.datas(x.card)) === cardKb2 && B.sim.button(x.card, MSG.btn_undo) === 'U|' + x.g,
  'the sale card is not edited: same text, same buttons, undo still there');
check(same(B.datas(q), [['SXM|' + x.g + '|KBZ', 'SXM|' + x.g + '|WAVE', 'SXM|' + x.g + '|BANK'], ['LA|pm|SXM|' + x.g], ['Z']]),
  'split account screen: one 🏦 per account (no 💵), ➕ alone, the cancel row last', B.datas(q));
B.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|KBZ');
check(q.edited && q.text === t(B.ports, 'split_ask_amount', { method: 'KBZPay', cash: '18,000' }) &&
  same(B.datas(q), [['SXA|' + x.g + '|KBZ|all', 'SXA|' + x.g + '|KBZ|half'], ['Z']]) &&
  same(B.texts(q)[0], [t(B.ports, 'btn_all', { amount: '18,000' }), t(B.ports, 'btn_half', { amount: '9,000' })]),
  'the amount screen edits the question: account named, all 18,000 / half 9,000, cancel', [q.text, B.datas(q)]);
check(same(B.state(U.sister), { kind: 'await_number', purpose: 'split_bank', groupId: x.g, method: 'KBZ' }) && B.world.ledger.length === n2,
  'the state waits for a number (the app opens its keypad); nothing written yet', B.state(U.sister));
B.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|half');
let rows = B.world.ledger.slice(n2);
check(rows.length === 3 && rows.every(r => r.groupId === x.g && r.staffId === '1001') &&
  rows[0].reversesTxId === sale2.txId && rows[0].note === 'rewrite' && rows[0].cash === -18000 && rows[0].method === 'CASH' &&
  rows[1].type === 'SALE' && rows[1].amount === 18000 && rows[1].cash === 9000 && rows[1].method === 'CASH' && rows[1].note === 'split' && rows[1].time === sale2.time &&
  rows[2].type === 'PAYMENT' && rows[2].amount === 9000 && rows[2].cash === 9000 && rows[2].method === 'KBZ' && rows[2].refGroupId === x.g && rows[2].note === 'split',
  'three rows in the sale\'s group: mirror, the cash part (SALE 9,000 CASH), PAYMENT 9,000 KBZ; every row carries the staff id', rows.map(r => [r.type, r.cash, r.method, r.note]));
const live2 = B.liveOf(x.g).filter(r => r.type === 'SALE')[0];
check(q.text === describeRow(B.ports, live2) + '\n' + t(B.ports, 'split_done', { cash: '9,000', cashMethod: 'ငွေသား', bank: '9,000', method: 'KBZPay' }) + '\n' + MSG.split_hint &&
  q.text.indexOf('လုံချည် ကချင် အပြာ') >= 0 && q.text.indexOf('18,000') >= 0,
  'the result names the item and the total, the two parts, and how to correct it (button path)', q.text);
check(same(B.datas(q), [['U|' + x.g, 'RC|' + x.g]]) && B.state(U.sister) === null, 'after a split the card shows undo and receipt only; the state is cleared', B.datas(q));
const st2b = B.stats('S1'), info2 = saleGroupInfo(B.ports, x.g);
check(B.net(st2b, 'CASH') === B.net(st2, 'CASH') + 9000 && B.net(st2b, 'KBZ') === B.net(st2, 'KBZ') + 9000 && st2b.revenue === st2.revenue + 18000,
  'day stats: CASH +9,000, KBZ +9,000, revenue +18,000');
check(info2.owed === 0 && info2.total === 18000 && openCredits(B.ports, null).length === credits2 && receiptNumber(B.ports, x.g) === rcpt2,
  'nothing owed, no credit opened, the receipt number unchanged');
B.sim.tap(U.sister, q.id, 'RC|' + x.g);
check(B.lastText(U.sister).indexOf('(ငွေသား 9,000 · KBZPay 9,000)') >= 0 && B.lastText(U.sister).indexOf(rcpt2) >= 0, 'the receipt says how it was paid: cash 9,000 · KBZPay 9,000', B.lastText(U.sister));
check(same(groupMethods(B.ports, x.g), [{ method: 'CASH', amount: 9000 }, { method: 'KBZ', amount: 9000 }]) && !rewriteCheck(B.ports, x.g).ok, 'groupMethods is mixed; the group can no longer be rewritten');

step('2b. A split 💵+🏦 tap on a group that is already split: refused on the card like a method tap');
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
check(x.card.text === cardText2 + '\n' + MSG.rewrite_locked && same(B.datas(x.card), [['U|' + x.g, 'RC|' + x.g]]) && B.world.ledger.length === n2 + 3,
  'the card keeps its text, the "already has a payment" line is added, the buttons are redrawn', x.card.text);
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
check(x.card.text === cardText2 + '\n' + MSG.rewrite_locked, 'a second tap does not stack the line');

step('2c. Undo of a split sale nets every bucket to zero and restores the stock');
const stock2 = B.ports.store.getItem('S1-0002').stock;
B.sim.tap(U.sister, q.id, 'U|' + x.g);
const st2c = B.stats('S1');
check(saleGroupInfo(B.ports, x.g).voided && B.net(st2c, 'CASH') === B.net(st2, 'CASH') && B.net(st2c, 'KBZ') === B.net(st2, 'KBZ') && B.ports.store.getItem('S1-0002').stock === stock2 + 1,
  'undo: the group is voided, CASH and KBZ are back where they were, the piece is back in stock');

step('2d. "All": the whole payment goes to the account, a plain method change');
x = B.sell(U.sister, 'S1-0003');
n2 = B.world.ledger.length;
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
B.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|WAVE');
B.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|WAVE|all');
rows = B.world.ledger.slice(n2);
check(rows.length === 2 && rows[1].type === 'SALE' && rows[1].method === 'WAVE' && rows[1].cash === 12000 && B.liveOf(x.g).length === 1 && !rows.some(r => r.type === 'PAYMENT'),
  'all: mirror + replacement marked WAVE, one live row, no PAYMENT', rows.map(r => [r.type, r.cash, r.method]));
check(q.text === describeRow(B.ports, B.liveOf(x.g)[0]) + '\n' + t(B.ports, 'method_done', { method: 'WavePay' }) &&
  B.flat(q).indexOf('PM|' + x.g + '|CASH') >= 0 && B.flat(q).indexOf('SX|' + x.g) >= 0 && B.state(U.sister) === null,
  'the reply says "paid with WavePay" (no split line) and the card is still rewritable', [q.text, B.datas(q)]);

step('2e. A typed amount');
x = B.sellAt(U.sister, 'S1-0002', 30000);
n2 = B.world.ledger.length;
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
B.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|BANK');
const qText2e = q.text;
B.sim.text(U.sister, '5000');
let res = B.last(U.sister);
rows = B.world.ledger.slice(n2);
check(rows.length === 3 && rows[1].cash === 25000 && rows[1].method === 'CASH' && rows[2].type === 'PAYMENT' && rows[2].cash === 5000 && rows[2].method === 'BANK' && rows[2].source === 'TEXT' && rows[1].source === 'TEXT',
  'typed 5000: cash part 25,000, PAYMENT 5,000 BANK, Source TEXT', rows.map(r => [r.type, r.cash, r.method, r.source]));
check(res.id !== q.id && q.text === qText2e && res.text === describeRow(B.ports, B.liveOf(x.g).filter(r => r.type === 'SALE')[0]) + '\n' +
  t(B.ports, 'split_done', { cash: '25,000', cashMethod: 'ငွေသား', bank: '5,000', method: 'ဘဏ်လွှဲ' }) + '\n' + MSG.split_hint &&
  res.text.indexOf('လုံချည် ကချင် အပြာ') >= 0 && res.text.indexOf('30,000') >= 0 && same(B.datas(res), [['U|' + x.g, 'RC|' + x.g]]),
  'the result is a new message that names the item and the total (typed path), with undo and receipt', res.text);
check(B.state(U.sister) === null && B.sim.lastBot(U.sister).id === res.id, 'the state is cleared and the result is the last bot message');

step('2f. A spoken amount');
x = B.sellAt(U.sister, 'S1-0002', 30000);
n2 = B.world.ledger.length;
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
B.tapData(U.sister, 'SXM|' + x.g + '|KBZ');
B.sim.voice(U.sister, 'တစ်သောင်း');
rows = B.world.ledger.slice(n2);
check(rows.length === 3 && rows[1].cash === 20000 && rows[2].type === 'PAYMENT' && rows[2].cash === 10000 && rows[2].method === 'KBZ' && rows[2].source === 'VOICE',
  'spoken "တစ်သောင်း": cash part 20,000, PAYMENT 10,000 KBZ, Source VOICE', rows.map(r => [r.type, r.cash, r.method, r.source]));
check(B.lastText(U.sister).indexOf(t(B.ports, 'split_done', { cash: '20,000', cashMethod: 'ငွေသား', bank: '10,000', method: 'KBZPay' })) >= 0, 'the reply shows 20,000 cash · 10,000 KBZPay', B.lastText(U.sister));

step('2g. The sale was marked with an account first: no account screen, the amount screen names that account');
const st2g = B.stats('S1');
x = B.sellAt(U.sister, 'S1-0002', 30000);
B.sim.tap(U.sister, x.card.id, 'PM|' + x.g + '|KBZ');
check(B.liveOf(x.g)[0].method === 'KBZ' && B.flat(x.card).indexOf('SX|' + x.g) >= 0, 'the sale is KBZ and its card still offers the split');
n2 = B.world.ledger.length;
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
check(q.id !== x.card.id && q.text === t(B.ports, 'split_ask_amount', { method: 'KBZPay', cash: '30,000' }) && B.flat(q).indexOf('SXA|' + x.g + '|KBZ|half') >= 0 &&
  !B.flat(q).some(d => /^SXM\|/.test(d)), 'straight to the amount screen for KBZPay (a new message, no account buttons)', [q.text, B.datas(q)]);
B.sim.text(U.sister, '20000');
rows = B.world.ledger.slice(n2);
check(rows.length === 3 && rows[0].method === 'KBZ' && rows[0].cash === -30000 && rows[1].type === 'SALE' && rows[1].cash === 10000 && rows[1].method === 'CASH' &&
  rows[2].type === 'PAYMENT' && rows[2].cash === 20000 && rows[2].method === 'KBZ', 'the KBZ row is mirrored; the replacement is CASH 10,000; PAYMENT KBZ 20,000', rows.map(r => [r.type, r.cash, r.method]));
const st2g2 = B.stats('S1');
check(B.net(st2g2, 'CASH') === B.net(st2g, 'CASH') + 10000 && B.net(st2g2, 'KBZ') === B.net(st2g, 'KBZ') + 20000, 'day stats: CASH +10,000 and KBZ +20,000');
x = B.sellAt(U.sister, 'S1-0002', 30000);
B.sim.tap(U.sister, x.card.id, 'PM|' + x.g + '|KBZ');
n2 = B.world.ledger.length;
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
B.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|WAVE');
check(B.world.ledger.length === n2 && q.text === describeRow(B.ports, B.liveOf(x.g)[0]) + '\n' + MSG.expired && B.flat(q).indexOf('U|' + x.g) >= 0,
  'another account than the one the sale is marked with is refused (cash plus ONE account); nothing written', q.text);

step('2h. A typed amount out of range keeps the state and asks again');
x = B.sell(U.sister, 'S1-0003');
n2 = B.world.ledger.length;
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
B.tapData(U.sister, 'SXM|' + x.g + '|KBZ');
B.sim.text(U.sister, '0');
check(B.lastText(U.sister) === t(B.ports, 'split_bad', { max: '12,000' }) && same(B.datas(B.last(U.sister)), [['Z']]) && B.world.ledger.length === n2 &&
  same(B.state(U.sister), { kind: 'await_number', purpose: 'split_bank', groupId: x.g, method: 'KBZ' }), '0: "1 to 12,000", cancel button, the state is kept, nothing written', B.lastText(U.sister));
B.sim.text(U.sister, '12001');
check(B.lastText(U.sister) === t(B.ports, 'split_bad', { max: '12,000' }) && B.world.ledger.length === n2 && B.state(U.sister) && B.state(U.sister).purpose === 'split_bank', 'more than the cash paid: asked again, state kept');
B.sim.text(U.sister, '4000');
rows = B.world.ledger.slice(n2);
check(rows.length === 3 && rows[1].cash === 8000 && rows[2].cash === 4000 && rows[2].method === 'KBZ' && B.state(U.sister) === null, 'a valid amount then commits the split: 8,000 cash + 4,000 KBZ');

step('2i. A stale tap (the next day) and a double tap');
x = B.sell(U.sister, 'S1-0003');
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
B.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|KBZ');
n2 = B.world.ledger.length;
B.tick(24 * 60);
B.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|half');
check(B.world.ledger.length === n2 && q.text === describeRow(B.ports, B.liveOf(x.g)[0]) + '\n' + MSG.rewrite_refused && same(B.datas(q), [['U|' + x.g, 'RC|' + x.g]]),
  'next day: the question becomes the row + the "today only" line, nothing written', q.text);
check(B.state(U.sister) === null, 'and the waiting state is cleared (the app closes its keypad)', B.state(U.sister));
B.tick(-24 * 60);
x = B.sell(U.sister, 'S1-0003');
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
B.tapData(U.sister, 'SXM|' + x.g + '|KBZ');
B.sim.tap(U.sister, x.card.id, 'U|' + x.g);                              // the sale is undone while the amount is awaited
n2 = B.world.ledger.length;
B.sim.text(U.sister, '5000');
check(B.world.ledger.length === n2 && B.lastText(U.sister) === MSG.undo_already && same(B.datas(B.last(U.sister)), [['U|' + x.g]]) && B.state(U.sister) === null,
  'a typed amount for a sale that was undone meanwhile: "already undone" as a new message, nothing written, the state is cleared', B.lastText(U.sister));
x = B.sell(U.sister, 'S1-0003');
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
B.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|KBZ');
B.sim.tap(U.sister, x.card.id, 'U|' + x.g);
n2 = B.world.ledger.length;
B.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|half');                    // the clock did not move: only finishSplit can clear the state
check(B.world.ledger.length === n2 && q.text === MSG.undo_already && B.state(U.sister) === null, 'the amount button of a sale that was undone meanwhile: refused on the question, the waiting state is cleared', [q.text, B.state(U.sister)]);
x = B.sellAt(U.sister, 'S1-0002', 30000);
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
B.tapData(U.sister, 'SXM|' + x.g + '|KBZ');
n2 = B.world.ledger.length;
handleIntent({ intent: 'NEW_ITEM_INFO', amount: 2500.5, transcript: 'x', confidence: 0.9 }, { chat: { id: U.sister.id, type: 'private' }, from: { id: U.sister.id }, message_id: 0 },
  B.ports.store.getStaff(String(U.sister.id)), 'ai-frac', B.ports, CFG.SOURCE.VOICE, { state: B.state(U.sister) });
check(B.world.ledger.length === n2 && B.lastText(U.sister) === t(B.ports, 'split_bad', { max: '30,000' }) && !!B.state(U.sister) && B.state(U.sister).purpose === 'split_bank',
  'a spoken amount that is not a whole number (2500.5): asked again, the state kept, nothing written', B.lastText(U.sister));
B.sim.tap(U.sister, B.last(U.sister).id, 'Z');
x = B.sell(U.sister, 'S1-0003');
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
B.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|KBZ');
n2 = B.world.ledger.length;
B.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|half');
B.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|half');   // the second tap arrives before the message was redrawn
check(B.world.ledger.length === n2 + 3 && B.liveOf(x.g).length === 2, 'two taps on "half" split once (three rows)');
check(q.text.indexOf(t(B.ports, 'split_done', { cash: '6,000', cashMethod: 'ငွေသား', bank: '6,000', method: 'KBZPay' })) >= 0 && q.text.indexOf(MSG.rewrite_locked) < 0,
  'the second tap is ignored (SXA is a committing action): the result stays on the screen, no refusal replaces it', q.text);
B.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|all');
check(B.world.ledger.length === n2 + 3 && q.text.indexOf(MSG.rewrite_locked) >= 0 && q.text.indexOf(describeRow(B.ports, B.liveOf(x.g)[0])) === 0,
  'a later tap on the other amount of the same question is refused (the group is split), nothing written', q.text);

step('2j. 💵+🏦 then cancel: only the question is cancelled');
x = B.sell(U.sister, 'S1-0002');
const cardText2j = x.card.text, kb2j = JSON.stringify(B.datas(x.card));
n2 = B.world.ledger.length;
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
B.sim.tap(U.sister, q.id, 'Z');
check(q.text === MSG.cancelled && q.keyboard.length === 0 && x.card.text === cardText2j && JSON.stringify(B.datas(x.card)) === kb2j &&
  B.sim.button(x.card, MSG.btn_undo) === 'U|' + x.g && B.sim.button(x.card, MSG.btn_receipt) === 'RC|' + x.g && B.world.ledger.length === n2,
  'the question reads "cancelled"; the sale card still has its text, undo and receipt; nothing written');
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
B.tapData(U.sister, 'SXM|' + x.g + '|KBZ');
B.sim.tap(U.sister, B.last(U.sister).id, 'Z');
check(B.state(U.sister) === null && B.lastText(U.sister) === MSG.cancelled, 'cancel on the amount screen clears the waiting state');

step('2k. More than 30 minutes after the sale the hint names the owner (undo is no longer possible)');
x = B.sell(U.sister, 'S1-0002');
B.tick(40);
B.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B.last(U.sister);
B.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|KBZ');
B.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|half');
check(q.text.split('\n').pop() === MSG.split_hint_late && q.text.indexOf(MSG.split_hint) < 0 && B.liveOf(x.g).length === 2, 'a split 40 minutes after the sale ends with the "tell the owner" hint', q.text);
B.sim.tap(U.sister, q.id, 'U|' + x.g);
check(q.text === t(B.ports, 'undo_expired', { min: myDigits(CFG.UNDO_WINDOW_MIN) }) && B.liveOf(x.g).length === 2, 'and undo is indeed refused by the 30-minute rule');
B.tick(-40);

step('2l. A split on a credit sale keeps what is owed and the customer');
cr = B.creditSale(U.sister, 'S1-0003', 6000, 'ဒေါ်မြင့်');
check(B.liveOf(cr.g)[0].cash === 6000 && same(B.datas(cr.reply).slice(-2), [['PM|' + cr.g + '|KBZ', 'PM|' + cr.g + '|WAVE', 'PM|' + cr.g + '|BANK'], ['SX|' + cr.g, 'LA|pm|PM|' + cr.g]]),
  'a credit sale with 6,000 paid offers the 🏦 row and the split for the paid part', B.datas(cr.reply));
n2 = B.world.ledger.length;
B.sim.tap(U.sister, cr.reply.id, 'SX|' + cr.g);
check(B.lastText(U.sister) === t(B.ports, 'split_ask_bank', { cash: '6,000' }), 'the question names the 6,000 that was paid');
B.tapData(U.sister, 'SXM|' + cr.g + '|KBZ');
B.sim.text(U.sister, '2000');
rows = B.world.ledger.slice(n2);
const info2l = saleGroupInfo(B.ports, cr.g);
check(rows.length === 3 && rows[1].cash === 4000 && rows[1].customerId === 'C-0001' && rows[2].cash === 2000 && rows[2].customerId === 'C-0001' && info2l.owed === 6000 && info2l.customerId === 'C-0001',
  '4,000 cash + 2,000 KBZ; 6,000 still owed by Daw Myint', [rows.map(r => [r.type, r.cash, r.customerId]), info2l.owed]);
check(same(B.datas(B.last(U.sister)), [['U|' + cr.g, 'RC|' + cr.g], ['PY|' + cr.g]]), 'the card then shows undo, receipt and 💰 (something is still owed)', B.datas(B.last(U.sister)));

step('2m. One account only: no account screen');
const C = bench();
C.setAccounts([{ key: 'KBZ', label: 'KBZPay' }]);
x = C.sell(U.sister, 'S1-0002');
check(same(C.datas(x.card).slice(2), [['PM|' + x.g + '|KBZ'], ['SX|' + x.g, 'LA|pm|PM|' + x.g]]), 'one account: one 🏦 button, then [split, ➕]', C.datas(x.card));
n2 = C.world.ledger.length;
C.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = C.last(U.sister);
check(q.id !== x.card.id && !q.edited && q.text === t(C.ports, 'split_ask_amount', { method: 'KBZPay', cash: '18,000' }) && same(C.datas(q), [['SXA|' + x.g + '|KBZ|all', 'SXA|' + x.g + '|KBZ|half'], ['Z']]) &&
  C.state(U.sister).purpose === 'split_bank', 'straight to the amount screen for the only account (a new message)', [q.text, C.datas(q)]);
C.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|half');
check(C.world.ledger.length === n2 + 3 && C.lastRow().method === 'KBZ' && C.lastRow().cash === 9000, 'half: 9,000 KBZ');

step('2n. No account yet: the split leads to ➕, the name, then the amount');
C.setAccounts([]);
x = C.sell(U.sister, 'S1-0002');
check(same(C.datas(x.card).slice(2), [['SX|' + x.g, 'LA|pm|PM|' + x.g]]), 'no account: no 🏦 button, the [split, ➕] row alone', C.datas(x.card));
C.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = C.last(U.sister);
check(q.text === MSG.split_no_bank && same(C.datas(q), [['LA|pm|SXM|' + x.g, 'Z']]) && same(C.texts(q), [[MSG.btn_add_bank, MSG.btn_cancel]]), '"no bank account yet" with ➕ and cancel', [q.text, C.datas(q)]);
C.sim.tap(U.sister, q.id, 'LA|pm|SXM|' + x.g);
check(q.edited && q.text === MSG.add_ask_pm && same(C.datas(q), [['Z']]) &&
  same(C.state(U.sister), { kind: 'await_text', purpose: 'add_option', list: 'pay_method', resume: { a: 'SXM', args: [x.g] }, saved: null }),
  'the question becomes the name prompt; the add state remembers what to resume', C.state(U.sister));
const lists2n = C.world.lists.length, bots2n = C.bots(U.sister).length;
n2 = C.world.ledger.length;
C.sim.text(U.sister, 'AYA ဒေါ်စန်း');
const aya2n = C.accounts().filter(r => r.label === 'AYA ဒေါ်စန်း')[0];
res = C.last(U.sister);
check(C.world.lists.length === lists2n + 1 && !!aya2n && aya2n.active === true && aya2n.shop === '' && /^[A-Z][A-Z0-9]{1,10}$/.test(aya2n.key) && aya2n.note === 'added by Sister (S1) ' + today,
  'the account is a new Lists row: active, both shops, a short ASCII key, the note says who added it', aya2n);
check(C.bots(U.sister).length === bots2n + 1 && res.text === t(C.ports, 'add_done', { label: 'AYA ဒေါ်စန်း' }) + '\n' + t(C.ports, 'split_ask_amount', { method: 'AYA ဒေါ်စန်း', cash: '18,000' }) &&
  same(C.datas(res), [['SXA|' + x.g + '|' + aya2n.key + '|all', 'SXA|' + x.g + '|' + aya2n.key + '|half'], ['Z']]),
  'ONE new message: "➕ added" + the amount screen for the new account; no number hint, no number button here', [res.text, C.datas(res)]);
check(same(C.state(U.sister), { kind: 'await_number', purpose: 'split_bank', groupId: x.g, method: aya2n.key }) && C.world.ledger.length === n2, 'the state now waits for the amount');
C.sim.text(U.sister, '10000');
rows = C.world.ledger.slice(n2);
check(rows.length === 3 && rows[2].type === 'PAYMENT' && rows[2].cash === 10000 && rows[2].method === aya2n.key && rows[1].cash === 8000,
  'typed 10000: 8,000 cash + 10,000 on the new account', rows.map(r => [r.type, r.cash, r.method]));
check(C.lastText(U.sister).indexOf(t(C.ports, 'split_done', { cash: '8,000', cashMethod: 'ငွေသား', bank: '10,000', method: 'AYA ဒေါ်စန်း' })) >= 0, 'the result names the new account by its label');

step('2o. The amount screen refuses CASH, a key no list knows and an amount word it does not know; nothing is written');
const B2 = bench();
x = B2.sell(U.sister, 'S1-0002');
n2 = B2.world.ledger.length;
const cardKb2o = JSON.stringify(B2.datas(x.card));
[['CASH', 'CASH (not an account)'], ['NOPE', 'a key no list knows']].forEach(c => {
  B2.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
  const asked = B2.last(U.sister);
  B2.sim.tap(U.sister, asked.id, 'SXM|' + x.g + '|' + c[0]);
  check(asked.text === describeRow(B2.ports, B2.liveOf(x.g)[0]) + '\n' + MSG.expired && JSON.stringify(B2.datas(asked)) === cardKb2o && B2.state(U.sister) === null && B2.world.ledger.length === n2,
    'SXM with ' + c[1] + ': the question becomes the row + "expired" with the sale\'s buttons; no waiting state', asked.text);
});
B2.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B2.last(U.sister);
B2.sim.tap(U.sister, q.id, 'SXM|' + x.g + '|KBZ');
B2.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|KBZ|third');
check(q.text === describeRow(B2.ports, B2.liveOf(x.g)[0]) + '\n' + MSG.expired && B2.state(U.sister) === null && B2.world.ledger.length === n2,
  'SXA with anything but all or half: refused, the waiting state is cleared, nothing written', q.text);
B2.sim.tap(U.sister, x.card.id, 'PM|' + x.g + '|KBZ');                    // the sale is on KBZ now
n2 = B2.world.ledger.length;
B2.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B2.last(U.sister);
B2.sim.tap(U.sister, q.id, 'SXA|' + x.g + '|WAVE|half');                  // a stale amount button for another account
check(q.text === describeRow(B2.ports, B2.liveOf(x.g)[0]) + '\n' + MSG.expired && B2.state(U.sister) === null && B2.world.ledger.length === n2 && B2.liveOf(x.g)[0].method === 'KBZ',
  'SXA for another account than the one the sale is marked with: the ledger refuses it (cash plus ONE account), nothing written', q.text);

step('2p. 💵+🏦 where no cash was paid: refused on the card, also through ➕');
cr = B2.creditSale(U.sister, 'S1-0003', 0, 'ဒေါ်မြင့်');
const replyText2p = cr.reply.text, bots2p = B2.bots(U.sister).length;
B2.sim.tap(U.sister, cr.reply.id, 'SX|' + cr.g);
check(cr.reply.text === replyText2p + '\n' + MSG.rewrite_locked && B2.bots(U.sister).length === bots2p && B2.state(U.sister) === null,
  'a stale 💵+🏦 on a sale with nothing paid: the refusal on the card, no question', cr.reply.text);
B2.sim.tap(U.sister, cr.reply.id, 'LA|pm|SXM|' + cr.g);
check(cr.reply.text === replyText2p + '\n' + MSG.rewrite_locked && B2.bots(U.sister).length === bots2p && B2.state(U.sister) === null,
  '➕ for a split that cannot happen asks no name (the whole split guard, not only the rewrite check)', [cr.reply.text, B2.state(U.sister)]);

step('2q. The split makes that sale the "last group" (what a later spoken method refers to)');
const xa2 = B2.sell(U.sister, 'S1-0002'), xb2 = B2.sell(U.sister, 'S1-0005');
check(B2.ports.cache.get('lg:' + U.sister.id) === xb2.g, 'two sales: the last group is the second one');
B2.sim.tap(U.sister, xa2.card.id, 'SX|' + xa2.g);
q = B2.last(U.sister);
B2.sim.tap(U.sister, q.id, 'SXM|' + xa2.g + '|KBZ');
B2.sim.tap(U.sister, q.id, 'SXA|' + xa2.g + '|KBZ|half');
check(B2.liveOf(xa2.g).length === 2 && B2.ports.cache.get('lg:' + U.sister.id) === xa2.g, 'after the first sale was split it is the last group');

step('2r. ➕ on the split account screen: the name, then the amount screen for the new account');
x = B2.sell(U.sister, 'S1-0002');
B2.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B2.last(U.sister);
n2 = B2.world.ledger.length;
B2.sim.tap(U.sister, q.id, 'LA|pm|SXM|' + x.g);
check(q.edited && q.text === MSG.add_ask_pm && same(B2.datas(q), [['Z']]) && same(B2.state(U.sister).resume, { a: 'SXM', args: [x.g] }), 'the account question becomes the name prompt', B2.state(U.sister));
const bots2r = B2.bots(U.sister).length;
B2.sim.text(U.sister, 'CB ဘဏ်');
const cb2r = B2.accounts().filter(r => r.label === 'CB ဘဏ်')[0];
res = B2.last(U.sister);
check(!!cb2r && B2.bots(U.sister).length === bots2r + 1 && res.text === t(B2.ports, 'add_done', { label: 'CB ဘဏ်' }) + '\n' + t(B2.ports, 'split_ask_amount', { method: 'CB ဘဏ်', cash: '18,000' }) &&
  same(B2.datas(res), [['SXA|' + x.g + '|' + cb2r.key + '|all', 'SXA|' + x.g + '|' + cb2r.key + '|half'], ['Z']]) && B2.world.ledger.length === n2,
  'one new message: "➕ added" + the amount screen for the new account (no number hint while an amount is awaited)', [res.text, B2.datas(res)]);
B2.sim.tap(U.sister, res.id, 'SXA|' + x.g + '|' + cb2r.key + '|half');
check(B2.world.ledger.length === n2 + 3 && B2.lastRow().type === 'PAYMENT' && B2.lastRow().method === cb2r.key && B2.lastRow().cash === 9000, 'half: 9,000 on the new account');

step('2s. A sale marked with an account whose key is too long for a button: the amount buttons are left out, the amount is typed');
B2.world.lists.push({ list: 'pay_method', key: 'AVERYLONGACCOUNTKEY01', label: 'Long Bank', active: true, order: 30, shop: '', detail: '', note: '' });
x = B2.sell(U.sister, 'S1-0002');
check(B2.flat(x.card).every(d => d.indexOf('AVERYLONGACCOUNTKEY01') < 0), 'a 21-byte key gets no 🏦 button');
rewriteGroup(B2.ports, x.g, { method: 'AVERYLONGACCOUNTKEY01' }, B2.ports.store.getStaff(String(U.sister.id)), 'u-long', { noteIfBlank: 'method' });   // as a spoken method would
n2 = B2.world.ledger.length;
B2.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
q = B2.last(U.sister);
check(q.id !== x.card.id && q.text === t(B2.ports, 'split_ask_amount', { method: 'Long Bank', cash: '18,000' }) && same(B2.datas(q), [['Z']]) && B2.state(U.sister).method === 'AVERYLONGACCOUNTKEY01',
  'the amount screen has only cancel: SXA|<group>|<21-byte key>|half would be ' + Buffer.byteLength('SXA|' + x.g + '|AVERYLONGACCOUNTKEY01|half', 'utf8') + ' bytes', B2.datas(q));
B2.sim.text(U.sister, '8000');
rows = B2.world.ledger.slice(n2);
check(rows.length === 3 && rows[1].cash === 10000 && rows[1].method === 'CASH' && rows[2].type === 'PAYMENT' && rows[2].cash === 8000 && rows[2].method === 'AVERYLONGACCOUNTKEY01',
  'typed 8000: 10,000 cash + 8,000 on that account', rows.map(r => [r.type, r.cash, r.method]));

/* ============================== 3. ➕ where it is needed (section 5) ============================== */

step('3. ➕ bank from the sale card: the sale is marked, the resumed card is the last message');
const D = bench();
x = D.sell(U.sister, 'S1-0002');
const cardText3 = x.card.text, kb3 = JSON.stringify(D.datas(x.card));
let n3 = D.world.ledger.length, lists3 = D.world.lists.length;
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
let prompt = D.last(U.sister);
check(prompt.id !== x.card.id && prompt.text === MSG.add_ask_pm && same(D.datas(prompt), [['Z']]) && x.card.text === cardText3 && JSON.stringify(D.datas(x.card)) === kb3,
  'the name prompt is a NEW message with cancel; the committed card is not edited');
check(same(D.state(U.sister), { kind: 'await_text', purpose: 'add_option', list: 'pay_method', resume: { a: 'PM', args: [x.g] }, saved: null }), 'state: add_option for pay_method, resume PM', D.state(U.sister));
let bots3 = D.bots(U.sister).length;
D.sim.text(U.sister, 'AYA ဒေါ်စန်း');
const aya = D.accounts().filter(r => r.label === 'AYA ဒေါ်စန်း')[0];
res = D.last(U.sister);
rows = D.world.ledger.slice(n3);
check(D.world.lists.length === lists3 + 1 && !!aya && aya.note === 'added by Sister (S1) ' + today && aya.order === 5, 'a seller (not the owner) added the account: one new row, Order after the others', aya);
check(rows.length === 2 && rows[1].type === 'SALE' && rows[1].method === aya.key && rows[1].source === 'TEXT' && D.liveOf(x.g).length === 1 && D.liveOf(x.g)[0].method === aya.key,
  'the sale is rewritten with the new account (mirror + replacement)', rows.map(r => [r.type, r.cash, r.method, r.source]));
check(D.bots(U.sister).length === bots3 + 1 && D.sim.lastBot(U.sister).id === res.id &&
  res.text === t(D.ports, 'add_done', { label: 'AYA ဒေါ်စန်း' }) + '\n' + describeRow(D.ports, D.liveOf(x.g)[0]) + '\n' + t(D.ports, 'method_done', { method: 'AYA ဒေါ်စန်း' }) + '\n' +
    t(D.ports, 'acct_detail_hint', { label: 'AYA ဒေါ်စန်း' }),
  'ONE new message, the last one: "➕ added", the row, "paid with AYA ...", and the hint about its number', res.text);
check(D.sim.button(res, MSG.btn_undo) === 'U|' + x.g && D.sim.button(res, MSG.btn_receipt) === 'RC|' + x.g && same(D.datas(res).slice(-1)[0], ['LD|pm|' + aya.key]) &&
  same(D.texts(res).slice(-1)[0], [MSG.btn_acct_number]) && D.flat(res).indexOf('PM|' + x.g + '|CASH') >= 0,
  'the resumed card carries undo, receipt, the method rows and, as its last row, 🔢 နံပါတ် ထည့်', D.datas(res));
check(D.state(U.sister) === null && D.ports.cache.get('lg:' + U.sister.id) === x.g, 'the add state is gone; the group is the "last group" for voice');

step('3b. An existing name is reused (any spacing, any case); nothing is written to the list');
x = D.sell(U.sister, 'S1-0002');
lists3 = D.world.lists.length;
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
D.sim.text(U.sister, 'kbz  pay');
res = D.last(U.sister);
check(D.world.lists.length === lists3 && D.liveOf(x.g)[0].method === 'KBZ' &&
  res.text === t(D.ports, 'add_exists', { label: 'KBZPay' }) + '\n' + describeRow(D.ports, D.liveOf(x.g)[0]) + '\n' + t(D.ports, 'method_done', { method: 'KBZPay' }) &&
  D.flat(res).every(d => !/^LD\|/.test(d)), '"kbz  pay" is KBZPay: used, no new row, no number hint (the account is not new)', res.text);

step('3c. A name made of digits asks again (a mistyped amount never becomes an account)');
x = D.sell(U.sister, 'S1-0002');
n3 = D.world.ledger.length;
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
D.sim.text(U.sister, '20000');
check(D.lastText(U.sister) === MSG.add_ask_pm && same(D.datas(D.last(U.sister)), [['Z']]) && D.world.lists.length === lists3 && D.world.ledger.length === n3 &&
  D.state(U.sister) && D.state(U.sister).purpose === 'add_option', '"20000": the prompt again, the state kept, no row anywhere', D.lastText(U.sister));
D.sim.text(U.sister, '၂၀,၀၀၀');
check(D.lastText(U.sister) === MSG.add_ask_pm && D.world.lists.length === lists3, 'Burmese digits too');
D.sim.text(U.sister, 'CB ဘဏ်');
check(D.world.lists.length === lists3 + 1 && D.liveOf(x.g)[0].method === D.accounts().filter(r => r.label === 'CB ဘဏ်')[0].key, 'a real name then goes through');

step('3d. ➕ on a sale card, then cancel: the card is unchanged');
x = D.sell(U.sister, 'S1-0002');
const cardText3d = x.card.text, kb3d = JSON.stringify(D.datas(x.card));
n3 = D.world.ledger.length; lists3 = D.world.lists.length;
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
prompt = D.last(U.sister);
D.sim.tap(U.sister, prompt.id, 'Z');
check(prompt.text === MSG.cancelled && x.card.text === cardText3d && JSON.stringify(D.datas(x.card)) === kb3d && D.state(U.sister) === null &&
  D.world.ledger.length === n3 && D.world.lists.length === lists3, 'only the prompt reads "cancelled"; card, ledger and list untouched');

step('3e. ➕ on yesterday\'s sale card: the "today only" refusal, no name is asked');
x = D.sell(U.sister, 'S1-0002');
const cardText3e = x.card.text;
bots3 = D.bots(U.sister).length;
D.tick(24 * 60);
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
check(x.card.text === cardText3e + '\n' + MSG.rewrite_refused && D.bots(U.sister).length === bots3 && D.state(U.sister) === null && same(D.datas(x.card), [['U|' + x.g, 'RC|' + x.g]]),
  'the card gets the refusal a method tap gets; no prompt, no add state', x.card.text);
D.tick(-24 * 60);

step('3f. A store without addListOption: said at the tap, the tapped screen keeps its buttons');
const addFn = D.ports.store.addListOption;
delete D.ports.store.addListOption;
methodScreen = D.expenseToMethod(U.sister, 'phone', 10000);
const msText3f = methodScreen.text, msKb3f = JSON.stringify(D.datas(methodScreen)), state3f = JSON.stringify(D.state(U.sister));
D.sim.tap(U.sister, methodScreen.id, 'LA|pm|EM');
check(D.lastText(U.sister) === MSG.add_unavailable && D.last(U.sister).id !== methodScreen.id && methodScreen.text === msText3f && JSON.stringify(D.datas(methodScreen)) === msKb3f &&
  JSON.stringify(D.state(U.sister)) === state3f, '"cannot add from here" as a new message; the method screen and the expense state are untouched');
D.sim.tap(U.sister, methodScreen.id, 'EM|CASH');
check(D.lastRow().type === 'EXPENSE' && D.lastRow().method === 'CASH', 'and the expense can still be finished with an existing button');
x = D.sell(U.sister, 'S1-0002');
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
check(D.lastText(U.sister) === MSG.add_unavailable && D.state(U.sister) === null, 'the same under a sale card: no prompt, no state');
D.sim.tap(U.sister, x.card.id, 'LD|pm|KBZ');
check(D.lastText(U.sister) === MSG.add_unavailable && D.state(U.sister) === null, 'and for an account number');
D.ports.store.addListOption = addFn;

step('3g. ➕ bank on the expense method screen commits ONE expense with the new account');
methodScreen = D.expenseToMethod(U.sister, 'phone', 10000);
n3 = D.world.ledger.length; lists3 = D.world.lists.length;
D.sim.tap(U.sister, methodScreen.id, 'LA|pm|EM');
check(methodScreen.edited && methodScreen.text === MSG.add_ask_pm && same(D.datas(methodScreen), [['Z']]) && D.state(U.sister).saved && D.state(U.sister).saved.kind === 'exp' &&
  D.state(U.sister).saved.step === 'method' && D.state(U.sister).saved.draft.amount === 10000, 'the method screen (a question) becomes the prompt; the expense draft is kept inside the add state', D.state(U.sister));
D.sim.text(U.sister, 'UAB မမ');
const uab = D.accounts().filter(r => r.label === 'UAB မမ')[0];
res = D.last(U.sister);
rows = D.world.ledger.slice(n3);
check(D.world.lists.length === lists3 + 1 && rows.length === 1 && rows[0].type === 'EXPENSE' && rows[0].amount === -10000 && rows[0].category === 'phone' && rows[0].method === uab.key && rows[0].shop === 'S1',
  'one EXPENSE row: -10,000, phone, the new account', rows.map(r => [r.type, r.amount, r.category, r.method]));
check(res.text === t(D.ports, 'add_done', { label: 'UAB မမ' }) + '\n' + t(D.ports, 'expense_done', { amount: '10,000', cat: 'ဖုန်းဘေလ်', note: '', method: 'UAB မမ' }) + '\n' + t(D.ports, 'acct_detail_hint', { label: 'UAB မမ' }) &&
  same(D.datas(res)[0], ['U|' + rows[0].groupId, 'EN|' + rows[0].groupId]) && same(D.datas(res).slice(-1)[0], ['LD|pm|' + uab.key]) && D.state(U.sister) === null,
  'one message: "➕ added" + the expense line + the number hint; undo/note first, the 🔢 row last', [res.text, D.datas(res)]);

step('3h. The add button tapped twice, then the name: exactly one option and one expense');
methodScreen = D.expenseToMethod(U.sister, 'food', 7000);
n3 = D.world.ledger.length; lists3 = D.world.lists.length;
D.sim.tap(U.sister, methodScreen.id, 'LA|pm|EM');
D.sim.tap(U.sister, methodScreen.id, 'LA|pm|EM');
check(D.state(U.sister).purpose === 'add_option' && D.state(U.sister).saved && D.state(U.sister).saved.kind === 'exp', 'the second tap does not nest an add state inside an add state', D.state(U.sister));
D.sim.text(U.sister, 'Yoma ဦးလှ');
rows = D.world.ledger.slice(n3);
check(D.world.lists.length === lists3 + 1 && rows.length === 1 && rows[0].type === 'EXPENSE' && rows[0].amount === -7000 && rows[0].method === D.accounts().filter(r => r.label === 'Yoma ဦးလှ')[0].key &&
  D.state(U.sister) === null, 'one new account, one expense, no state left');
D.sim.text(U.sister, 'CB ဦးအောင်');
check(D.world.lists.length === lists3 + 1 && D.world.ledger.length === n3 + 1, 'whatever is typed next is not taken as another account name');

step('3i. A resume whose state is gone: expired after the prefix, nothing written to the ledger');
methodScreen = D.expenseToMethod(U.sister, 'food', 7000);
D.ports.cache.remove('st:' + U.sister.id);                       // the 30-minute state expired while the screen stayed on the phone
n3 = D.world.ledger.length;
D.sim.tap(U.sister, methodScreen.id, 'LA|pm|EM');
D.sim.text(U.sister, 'AGD ဘဏ်');
res = D.last(U.sister);
check(D.world.ledger.length === n3 && res.text.indexOf(t(D.ports, 'add_done', { label: 'AGD ဘဏ်' }) + '\n' + MSG.expired) === 0 && D.state(U.sister) === null,
  'the reply is "➕ added" then "expired" (never the prefix alone); no expense', res.text);

step('3j. A new expense category continues to the amount screen');
D.sim.start(U.sister, '');
D.sim.tapLast(U.sister, MSG.btn_expense);
let grid = D.last(U.sister);
check(same(D.datas(grid).slice(-1)[0], ['LA|ec|EC', 'Z']) && same(D.texts(grid).slice(-1)[0], [MSG.btn_add_cat, MSG.btn_cancel]) && D.datas(grid).slice(0, -1).every(r => r.length <= 3) &&
  D.sim.button(grid, '📱 ဖုန်းဘေလ်') === 'EC|phone', 'category grid: three per row with their emoji; the last row is [➕ new category, cancel]', D.datas(grid));
lists3 = D.world.lists.length;
D.sim.tap(U.sister, grid.id, 'LA|ec|EC');
check(grid.edited && grid.text === MSG.add_ask_ec && D.state(U.sister).list === 'expense_category' && D.state(U.sister).saved.step === 'cat', 'the grid becomes the prompt for a category name');
D.sim.text(U.sister, 'ရေဖိုး');
const water = D.world.lists.filter(r => r.list === 'expense_category' && r.label === 'ရေဖိုး')[0];
res = D.last(U.sister);
check(D.world.lists.length === lists3 + 1 && !!water && /^c[a-z0-9]{1,10}$/.test(water.key) &&
  res.text === t(D.ports, 'add_done', { label: 'ရေဖိုး' }) + '\n' + t(D.ports, 'exp_ask_amount', { cat: 'ရေဖိုး' }) && D.flat(res).indexOf('EA|other') >= 0,
  'a new category row (a key that starts with a letter) and the amount screen for it, as one new message', [water, res.text]);
check(same(D.state(U.sister), { kind: 'exp', step: 'amount', draft: { shop: 'S1', cat: water.key } }), 'the expense draft is back, with the new category', D.state(U.sister));
D.tapData(U.sister, 'EA|5000');
D.tapData(U.sister, 'EM|CASH');
check(D.lastRow().type === 'EXPENSE' && D.lastRow().category === water.key && D.lastRow().amount === -5000 && D.lastText(U.sister).indexOf('ရေဖိုး') >= 0, 'the expense is recorded under the new category');
D.sim.start(U.sister, '');
D.sim.tapLast(U.sister, MSG.btn_expense);
check(D.sim.button(D.last(U.sister), '📦 ရေဖိုး') === 'EC|' + water.key, 'the grid now offers the new category (📦 until it gets an emoji in the Lists tab)');
D.tapData(U.sister, 'Z');

step('3k. A spoken name; a spoken sale or expense in the add state is handled as what it is');
x = D.sell(U.sister, 'S1-0002');
lists3 = D.world.lists.length;
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
D.sim.voice(U.sister, 'MAB ဦးကျော်');
const mab = D.accounts().filter(r => r.label === 'MAB ဦးကျော်')[0];
check(D.world.lists.length === lists3 + 1 && !!mab && D.liveOf(x.g)[0].method === mab.key && D.liveOf(x.g)[0].source === 'VOICE' && D.world.customers.every(c => c.name !== 'ဦးကျော်'),
  'a voice note in the add state is the name: account created, the sale marked (Source VOICE), no customer made of the holder');
methodScreen = D.expenseToMethod(U.sister, 'phone', 10000);
D.sim.tap(U.sister, methodScreen.id, 'LA|pm|EM');
n3 = D.world.ledger.length; lists3 = D.world.lists.length;
D.sim.voice(U.sister, 'အထည်ဖိုး သုံးသောင်း ပေးလိုက်တယ်');
check(D.world.lists.length === lists3 && D.sim.button(D.last(U.sister), MSG.btn_yes) !== null && D.lastText(U.sister).indexOf('30,000') >= 0 && D.lastText(U.sister).indexOf('အထည်ဖိုး') >= 0,
  'a spoken expense is proposed as an expense, not turned into an account name', D.lastText(U.sister));
check(same(D.state(U.sister), { kind: 'exp', step: 'method', draft: { shop: 'S1', cat: 'phone', amount: 10000 } }), 'the add state gave way to the state it was tapped in', D.state(U.sister));
D.sim.tapLast(U.sister, MSG.btn_yes);
check(D.world.ledger.length === n3 + 1 && D.lastRow().type === 'EXPENSE' && D.lastRow().amount === -30000 && D.lastRow().category === 'fabric', 'confirmed: the spoken expense is recorded');
D.ports.cache.remove('st:' + U.sister.id);
x = D.sell(U.sister, 'S1-0002');
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
lists3 = D.world.lists.length; n3 = D.world.ledger.length;
D.sim.voice(U.sister, 'ဒါ ၂ ထည် ရောင်းရတယ်');
check(D.world.lists.length === lists3 && D.world.ledger.length === n3 && D.state(U.sister) === null && D.sim.button(D.last(U.sister), MSG.btn_yes) !== null && D.lastText(U.sister).indexOf('36,000') >= 0,
  'a spoken sale after ➕ under a sale card (no state to go back to): the add state is cleared and the sale is proposed, no account is made of the sentence', D.lastText(U.sister));
D.sim.tapLast(U.sister, MSG.btn_no);

step('3l. A voice note replayed later (the app) with an add state that is no longer waiting: added, nothing resumed');
methodScreen = D.expenseToMethod(U.sister, 'phone', 10000);
D.sim.tap(U.sister, methodScreen.id, 'LA|pm|EM');
const oldAdd = D.state(U.sister);
D.sim.text(U.sister, 'KBZ ဦးမောင်');                                // the seller typed the name instead of waiting
n3 = D.world.ledger.length; lists3 = D.world.lists.length;
const kbzU = D.accounts().filter(r => r.label === 'KBZ ဦးမောင်')[0];
check(D.lastRow().type === 'EXPENSE' && D.lastRow().method === kbzU.key && D.state(U.sister) === null, 'typed: one expense with the new account');
const fakeMsg = { chat: { id: U.sister.id, type: 'private' }, from: { id: U.sister.id }, message_id: 0 };
const staffSister = D.ports.store.getStaff(String(U.sister.id));
handleIntent({ intent: 'UNKNOWN', transcript: 'KBZ ဦးမောင်', confidence: 0.2 }, fakeMsg, staffSister, 'ai-1', D.ports, CFG.SOURCE.VOICE, { state: oldAdd });
check(D.world.ledger.length === n3 && D.world.lists.length === lists3 && D.lastText(U.sister) === t(D.ports, 'add_exists', { label: 'KBZ ဦးမောင်' }) && D.state(U.sister) === null,
  'the replayed note finds the name, writes no second expense and answers the prefix alone', D.lastText(U.sister));
methodScreen = D.expenseToMethod(U.sister, 'food', 3000);
const draft3l = JSON.stringify(D.state(U.sister));
handleIntent({ intent: 'UNKNOWN', transcript: 'A bank ဒေါ်နု', confidence: 0.2 }, fakeMsg, staffSister, 'ai-2', D.ports, CFG.SOURCE.VOICE, { state: oldAdd });
check(D.world.ledger.length === n3 && D.world.lists.length === lists3 + 1 && D.lastText(U.sister) === t(D.ports, 'add_done', { label: 'A bank ဒေါ်နု' }) && JSON.stringify(D.state(U.sister)) === draft3l,
  'a replayed new name is still added, but another flow\'s state is neither replaced nor resumed', D.lastText(U.sister));
D.ports.cache.remove('st:' + U.sister.id);

step('3m. Unknown list code; a typed tag id drops the add state');
x = D.sell(U.sister, 'S1-0002');
D.sim.tap(U.sister, x.card.id, 'LA|zz|PM|' + x.g);
check(D.lastText(U.sister) === MSG.expired && D.state(U.sister) === null, 'LA with an unknown list code: expired, no state');
D.sim.tap(U.sister, x.card.id, 'LA|ec|PM|' + x.g);
check(D.lastText(U.sister) === MSG.expired && D.state(U.sister) === null, 'a list that does not belong to the resume: expired');
D.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
lists3 = D.world.lists.length;
D.sim.text(U.sister, 's1-0003');
check(D.world.lists.length === lists3 && D.lastText(U.sister).indexOf('S1-0003') >= 0 && D.state(U.sister) === null, 'a typed tag id opens that card and drops the add state (no account called s1-0003)');

step('3n. ➕, cancel, ➕ again: the prompt comes back (➕ is not a committing action; only SXA of the new callbacks is)');
const D2 = bench();
x = D2.sell(U.sister, 'S1-0002');
D2.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
D2.sim.tap(U.sister, D2.last(U.sister).id, 'Z');
bots3 = D2.bots(U.sister).length;
D2.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
check(D2.bots(U.sister).length === bots3 + 1 && D2.lastText(U.sister) === MSG.add_ask_pm && !!D2.state(U.sister) && D2.state(U.sister).purpose === 'add_option',
  'the same ➕ tapped again within two minutes asks again', D2.lastText(U.sister));
check(MUTATING_ACTIONS.SXA === 1 && !MUTATING_ACTIONS.LA && !MUTATING_ACTIONS.LD && !MUTATING_ACTIONS.SX && !MUTATING_ACTIONS.SXM,
  'MUTATING_ACTIONS: SXA (it commits) is in; LA, LD, SX and SXM (they only ask) are not');

step('3o. The name arrives after the sale was undone: the refusal follows the prefix, never the prefix alone');
n3 = D2.world.ledger.length;
D2.sim.tap(U.sister, x.card.id, 'U|' + x.g);
D2.sim.text(U.sister, 'AYA ဒေါ်စန်း');
const aya3o = D2.accounts().filter(r => r.label === 'AYA ဒေါ်စန်း')[0];
res = D2.last(U.sister);
check(!!aya3o && D2.world.ledger.length === n3 + 1 && D2.state(U.sister) === null &&
  res.text === [t(D2.ports, 'add_done', { label: 'AYA ဒေါ်စန်း' }), MSG.undo_already, t(D2.ports, 'acct_detail_hint', { label: 'AYA ဒေါ်စန်း' })].join('\n') &&
  same(D2.datas(res), [['U|' + x.g], ['LD|pm|' + aya3o.key]]),
  'the account is added; the reply is "➕ added" + "already undone" + the number hint; only the undo mirror was written', [res.text, D2.datas(res)]);

step('3p. The resumed method tap makes that sale the "last group"; a later 🏦 tap on the resumed card keeps its lines');
const xa3 = D2.sell(U.sister, 'S1-0002'), xb3 = D2.sell(U.sister, 'S1-0005');
check(D2.ports.cache.get('lg:' + U.sister.id) === xb3.g, 'two sales: the last group is the second one');
D2.sim.tap(U.sister, xa3.card.id, 'LA|pm|PM|' + xa3.g);
D2.sim.text(U.sister, 'UAB မမ');
const uab3p = D2.accounts().filter(r => r.label === 'UAB မမ')[0];
res = D2.last(U.sister);
check(D2.liveOf(xa3.g)[0].method === uab3p.key && D2.ports.cache.get('lg:' + U.sister.id) === xa3.g, 'after ➕ on the first sale\'s card it is the last group');
const row3p = describeRow(D2.ports, D2.liveOf(xa3.g)[0]);
D2.sim.tap(U.sister, res.id, 'PM|' + xa3.g + '|KBZ');
check(D2.liveOf(xa3.g)[0].method === 'KBZ' && res.text === [t(D2.ports, 'add_done', { label: 'UAB မမ' }), row3p, t(D2.ports, 'acct_detail_hint', { label: 'UAB မမ' }), t(D2.ports, 'method_done', { method: 'KBZPay' })].join('\n') &&
  D2.sim.button(res, MSG.btn_undo) === 'U|' + xa3.g && D2.flat(res).indexOf('PM|' + xa3.g + '|' + uab3p.key) >= 0,
  'a 🏦 tap on the resumed card replaces only the "paid with" line: the row line and the other lines stay', res.text);

step('3q. A new category whose expense state is gone: expired after the prefix');
D2.sim.start(U.sister, '');
D2.sim.tapLast(U.sister, MSG.btn_expense);
grid = D2.last(U.sister);
D2.ports.cache.remove('st:' + U.sister.id);
D2.sim.tap(U.sister, grid.id, 'LA|ec|EC');
lists3 = D2.world.lists.length; n3 = D2.world.ledger.length;
D2.sim.text(U.sister, 'လိုင်စင်ကြေး');
check(D2.world.lists.length === lists3 + 1 && D2.world.ledger.length === n3 && D2.lastText(U.sister) === t(D2.ports, 'add_done', { label: 'လိုင်စင်ကြေး' }) + '\n' + MSG.expired && D2.state(U.sister) === null,
  'the category is added; the reply is "➕ added" then "expired"', D2.lastText(U.sister));

step('3r. A spoken money sentence the model is not sure about is still the name');
x = D2.sell(U.sister, 'S1-0002');
D2.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
lists3 = D2.world.lists.length;
handleIntent({ intent: 'SALE', qty: 1, transcript: 'Sale Bank ဦးဘ', confidence: 0.4 }, fakeMsg, staffSister, 'ai-3', D2.ports, CFG.SOURCE.VOICE, { state: D2.state(U.sister) });
const sale3r = D2.accounts().filter(r => r.label === 'Sale Bank ဦးဘ')[0];
check(D2.world.lists.length === lists3 + 1 && !!sale3r && D2.liveOf(x.g)[0].method === sale3r.key && D2.state(U.sister) === null,
  'a SALE intent below MIN_CONFIDENCE does not push the add state aside: the transcript is the account name', D2.lastText(U.sister));

step('3s. Another seller added the same name at the same moment: that option is used, "exists" not "added"');
x = D2.sell(U.sister, 'S1-0002');
D2.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
lists3 = D2.world.lists.length;
const addFn3s = D2.ports.store.addListOption;
D2.ports.store.addListOption = function (rec, seed) { addFn3s(rec, seed); return addFn3s(rec, seed); };   // the row is there when ours arrives: the store answers dup
D2.sim.text(U.sister, 'MAB ဦးကျော်');
D2.ports.store.addListOption = addFn3s;
const mab3s = D2.accounts().filter(r => r.label === 'MAB ဦးကျော်');
res = D2.last(U.sister);
check(D2.world.lists.length === lists3 + 1 && mab3s.length === 1 && D2.liveOf(x.g)[0].method === mab3s[0].key &&
  res.text === t(D2.ports, 'add_exists', { label: 'MAB ဦးကျော်' }) + '\n' + describeRow(D2.ports, D2.liveOf(x.g)[0]) + '\n' + t(D2.ports, 'method_done', { method: 'MAB ဦးကျော်' }) &&
  D2.flat(res).every(d => !/^LD\|/.test(d)), 'one row; the sale is marked with it; the prefix says it exists already; no number hint', res.text);

step('3t. The category grid takes its emoji from the Lists tab and shows a per-shop category only in that shop');
D2.option('expense_category', 'phone').detail = '☎️';
D2.world.lists.push({ list: 'expense_category', key: 's2tax', label: 'ဆိုင်၂ အခွန်', active: true, order: 30, shop: 'S2', detail: '', note: '' });
D2.sim.start(U.sister, '');
D2.sim.tapLast(U.sister, MSG.btn_expense);
grid = D2.last(U.sister);
check(D2.sim.button(grid, '☎️ ဖုန်းဘေလ်') === 'EC|phone' && D2.flat(grid).indexOf('EC|s2tax') < 0 && D2.sim.button(grid, '🧵 အထည်ဖိုး') === 'EC|fabric',
  'shop 1: ☎️ from the Detail column, the built-in emoji elsewhere, no shop-2 category', D2.texts(grid));
D2.tapData(U.sister, 'Z');
D2.sim.start(U.brother, '');
D2.sim.tapLast(U.brother, MSG.btn_expense);
check(D2.sim.button(D2.last(U.brother), '📦 ဆိုင်၂ အခွန်') === 'EC|s2tax' && D2.sim.button(D2.last(U.brother), '☎️ ဖုန်းဘေလ်') === 'EC|phone', 'shop 2 sees its own category too', D2.texts(D2.last(U.brother)));
D2.tapData(U.brother, 'Z');

step('3u. Small cases of ➕: a digits-only category name, a store that stops writing, a resume nobody knows, a replayed empty name');
D2.sim.start(U.sister, '');
D2.sim.tapLast(U.sister, MSG.btn_expense);
grid = D2.last(U.sister);
D2.sim.tap(U.sister, grid.id, 'LA|ec|EC');
lists3 = D2.world.lists.length;
D2.sim.text(U.sister, '5,000');
check(D2.lastText(U.sister) === MSG.add_ask_ec && same(D2.datas(D2.last(U.sister)), [['Z']]) && D2.world.lists.length === lists3 && D2.state(U.sister).purpose === 'add_option',
  'a mistyped amount on the category prompt: the CATEGORY prompt again, the state kept, no option', D2.lastText(U.sister));
const addFn3u = D2.ports.store.addListOption;
delete D2.ports.store.addListOption;
D2.sim.text(U.sister, 'ရေဖိုး');
check(D2.lastText(U.sister) === MSG.add_unavailable && D2.world.lists.length === lists3 && D2.state(U.sister) === null, 'the store can no longer add when the name arrives: said so, the state is cleared', D2.lastText(U.sister));
D2.ports.store.addListOption = addFn3u;
x = D2.sell(U.sister, 'S1-0002');
const cardText3u = x.card.text;
D2.sim.tap(U.sister, x.card.id, 'LA|pm|ZZ|' + x.g);
check(D2.lastText(U.sister) === MSG.add_ask_pm && D2.last(U.sister).id !== x.card.id && x.card.text === cardText3u && same(D2.state(U.sister).resume, { a: 'ZZ', args: [x.g] }),
  'a resume code this build does not know: the name is asked in a new message, the tapped message is left alone', D2.state(U.sister));
n3 = D2.world.ledger.length; lists3 = D2.world.lists.length; bots3 = D2.bots(U.sister).length;
D2.sim.text(U.sister, 'Yoma ဦးလှ');
check(D2.world.lists.length === lists3 + 1 && D2.world.ledger.length === n3 && D2.bots(U.sister).length === bots3 + 1 && D2.lastText(U.sister) === t(D2.ports, 'add_done', { label: 'Yoma ဦးလှ' }) && D2.state(U.sister) === null,
  'the option is added and the reply is the prefix alone (nothing to resume)', D2.lastText(U.sister));
handleIntent({ intent: 'UNKNOWN', transcript: '၁၂၃', confidence: 0.2 }, fakeMsg, staffSister, 'ai-4', D2.ports, CFG.SOURCE.VOICE,
  { state: { kind: 'await_text', purpose: 'add_option', list: 'pay_method', resume: { a: 'PM', args: [x.g] }, saved: null } });
check(D2.lastText(U.sister) === MSG.expired && D2.world.lists.length === lists3 + 1 && D2.state(U.sister) === null, 'a replayed note with no usable name and no waiting state: "expired", no prompt for a name nobody waits for', D2.lastText(U.sister));

/* ============================== 4. the accounts screen and an account's number (section 2) ============================== */

step('4. Menu and accounts screen');
const E = bench();
E.sim.start(U.sister, '');
let menu = E.last(U.sister);
check(menu.keyboard.slice(0, 3).every(r => r.length === 3) && same(E.datas(menu)[3], ['M|ord', 'M|restock', 'M|nb', 'M|acct']) && E.sim.button(menu, MSG.btn_accounts) === 'M|acct',
  'the menu keeps three rows of three; the fourth row gains 📦 ကုန်ရောက် (round 6b) and 🏛 အကောင့်', E.datas(menu));
E.sim.tapLast(U.sister, MSG.btn_accounts);
let acct = E.last(U.sister);
check(acct.text === [MSG.acct_title, t(E.ports, 'acct_line', { label: 'KBZPay', detail: '—' }), t(E.ports, 'acct_line', { label: 'WavePay', detail: '—' }), t(E.ports, 'acct_line', { label: 'ဘဏ်လွှဲ', detail: '—' })].join('\n'),
  'the accounts with — where no number is stored yet', acct.text);
check(same(E.datas(acct), [['LD|pm|KBZ'], ['LD|pm|WAVE'], ['LD|pm|BANK'], ['LA|pm|AC', 'Z']]) && same(E.texts(acct)[0], [t(E.ports, 'btn_acct_detail', { label: 'KBZPay' })]) &&
  acct.text.split('\n').every(l => l.indexOf('🏦 ') !== 0), 'one 🔢 button per account, then [➕, cancel]; no line starts with 🏦', E.datas(acct));

step('4b. The number of an account: typed, stored as text, shown at once');
const n4 = E.world.ledger.length;
E.sim.tap(U.sister, acct.id, 'LD|pm|KBZ');
let ask = E.last(U.sister);
check(ask.id !== acct.id && ask.text === t(E.ports, 'acct_ask_detail', { label: 'KBZPay' }) && same(E.datas(ask), [['Z']]) &&
  same(E.state(U.sister), { kind: 'await_text', purpose: 'list_detail', list: 'pay_method', key: 'KBZ' }), 'asked in a new message with a cancel button', E.state(U.sister));
const bots4 = E.bots(U.sister).length;
E.sim.text(U.sister, '09 777 123456 ဦးမောင်');
let after = E.bots(U.sister).slice(bots4);
check(E.option('pay_method', 'KBZ').detail === '09 777 123456 ဦးမောင်' && E.world.ledger.length === n4 && E.state(U.sister) === null,
  'Lists.Detail holds the number as typed (leading zero kept); not taken as a price', E.option('pay_method', 'KBZ').detail);
check(after.length === 2 && after[0].text === t(E.ports, 'acct_detail_saved', { label: 'KBZPay', detail: '09 777 123456 ဦးမောင်' }) &&
  after[1].text.indexOf(t(E.ports, 'acct_line', { label: 'KBZPay', detail: '09 777 123456 ဦးမောင်' })) >= 0 &&
  same(E.datas(after[1]), [['LD|pm|WAVE'], ['LD|pm|BANK'], ['LD|pm|KBZ'], ['LA|pm|AC', 'Z']]),
  '"saved", then the accounts screen as the last message: accounts without a number first, then the others', after.map(m => m.text));

step('4c. Cancel saves nothing; a voice note in the detail state saves nothing');
acct = E.last(U.sister);
E.sim.tap(U.sister, acct.id, 'LD|pm|WAVE');
E.sim.tap(U.sister, E.last(U.sister).id, 'Z');
E.sim.text(U.sister, '09 111 222333');
check(E.option('pay_method', 'WAVE').detail === '' && E.state(U.sister) === null, 'after cancel the next typed number is not stored as WavePay\'s number');
E.sim.tap(U.sister, acct.id, 'LD|pm|WAVE');
E.sim.voice(U.sister, 'သုည ကိုး ခုနစ် ခုနစ် ခုနစ်');
check(E.option('pay_method', 'WAVE').detail === '' && E.lastText(U.sister).indexOf(t(E.ports, 'acct_ask_detail', { label: 'WavePay' })) >= 0 && same(E.datas(E.last(U.sister)), [['Z']]) &&
  E.state(U.sister) && E.state(U.sister).purpose === 'list_detail', 'a spoken number is not saved: the question is repeated and the state stays', E.lastText(U.sister));
// A text made of a zero-width space and a space (built from its character code: this file holds no invisible character).
E.sim.text(U.sister, String.fromCharCode(0x200b) + ' ');
check(E.option('pay_method', 'WAVE').detail === '' && E.lastText(U.sister) === t(E.ports, 'acct_ask_detail', { label: 'WavePay' }) && E.state(U.sister).purpose === 'list_detail', 'an empty text asks again');
check(same(E.datas(E.last(U.sister)), [['Z']]), 'and the question asked again still has its cancel button', E.datas(E.last(U.sister)));
E.sim.tap(U.sister, E.last(U.sister).id, 'Z');

step('4d. A wrong number is retyped from the accounts screen; the receipt of a credit sale shows the new one');
E.sim.start(U.sister, '');
E.sim.tapLast(U.sister, MSG.btn_accounts);
E.sim.tapLast(U.sister, t(E.ports, 'btn_acct_detail', { label: 'KBZPay' }));
E.sim.text(U.sister, '09 888 000111 ဦးမောင်');
check(E.option('pay_method', 'KBZ').detail === '09 888 000111 ဦးမောင်' && E.lastText(U.sister).indexOf('09 888 000111 ဦးမောင်') >= 0, 'the number the seller was looking at is replaced', E.option('pay_method', 'KBZ').detail);
cr = E.creditSale(U.sister, 'S1-0003', 0, 'ဒေါ်မြင့်');
E.sim.tap(U.sister, cr.reply.id, 'RC|' + cr.g);
const transfer4 = t(E.ports, 'receipt_transfer', { accounts: 'KBZPay 09 888 000111 ဦးမောင်' });
let rc = E.lastText(U.sister).split('\n');
check(rc.indexOf(transfer4) >= 0 && rc[rc.indexOf(transfer4) - 1] === 'ကျန် 12,000' && transfer4.indexOf('🏦') !== 0, 'credit receipt: "where to transfer" directly after the balance line, with the new number', rc);
x = E.sell(U.sister, 'S1-0003');
E.sim.tap(U.sister, x.card.id, 'RC|' + x.g);
check(E.lastText(U.sister).indexOf('ငွေလွှဲရန်') < 0, 'a fully paid sale\'s receipt has no transfer line');

step('4e. LD guards: an unknown key, CASH, another list');
const bad4 = [['LD|pm|NOPE', 'unknown key'], ['LD|pm|CASH', 'CASH'], ['LD|ec|phone', 'not an account list']];
bad4.forEach(c => {
  E.sim.tap(U.sister, x.card.id, c[0]);
  check(E.lastText(U.sister) === MSG.expired && E.state(U.sister) === null, c[1] + ': expired, no state');
});

step('4f. ➕ from the accounts screen; owner sees every shop, staff their own');
E.world.lists.push({ list: 'pay_method', key: 'S2PAY', label: 'Wave ဆိုင်၂', active: true, order: 9, shop: 'S2', detail: '', note: '' });
E.sim.start(U.sister, '');
E.sim.tapLast(U.sister, MSG.btn_accounts);
acct = E.last(U.sister);
check(acct.text.indexOf('Wave ဆိုင်၂') < 0, 'shop 1 staff do not see the shop-2 account');
E.sim.start(U.brother, '');
E.sim.tapLast(U.brother, MSG.btn_accounts);
check(E.lastText(U.brother).indexOf('Wave ဆိုင်၂') >= 0 && E.flat(E.last(U.brother)).indexOf('LD|pm|S2PAY') >= 0, 'shop 2 staff do');
E.sim.start(U.owner, '');
E.sim.tapLast(U.owner, MSG.btn_accounts);
check(E.lastText(U.owner).indexOf('Wave ဆိုင်၂') >= 0 && E.lastText(U.owner).indexOf('KBZPay') >= 0, 'the owner sees the accounts of both shops');
const lists4 = E.world.lists.length;
E.sim.tap(U.sister, acct.id, 'LA|pm|AC');
check(acct.edited && acct.text === MSG.add_ask_pm, 'the accounts screen becomes the name prompt');
E.sim.text(U.sister, 'AYA ဒေါ်စန်း');
const aya4 = E.accounts().filter(r => r.label === 'AYA ဒေါ်စန်း')[0];
res = E.last(U.sister);
check(E.world.lists.length === lists4 + 1 && res.text.indexOf(t(E.ports, 'add_done', { label: 'AYA ဒေါ်စန်း' }) + '\n' + MSG.acct_title) === 0 &&
  res.text.indexOf(t(E.ports, 'acct_line', { label: 'AYA ဒေါ်စန်း', detail: '—' })) >= 0 && E.flat(res).indexOf('LD|pm|' + aya4.key) >= 0 && res.text.indexOf(MSG.acct_detail_hint.slice(0, 3) + ' AYA') < 0 &&
  E.flat(res).filter(d => d === 'LD|pm|' + aya4.key).length === 1, '"➕ added" + the accounts screen with the new account and its 🔢 button (no extra hint)', [res.text, E.datas(res)]);

step('4g. At most eight 🔢 buttons');
const F0 = bench();
F0.setAccounts(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'].map(k => ({ key: k, label: 'Bank ' + k })));
F0.sim.start(U.sister, '');
F0.sim.tapLast(U.sister, MSG.btn_accounts);
check(F0.flat(F0.last(U.sister)).filter(d => /^LD\|/.test(d)).length === 8 && F0.lastText(U.sister).split('\n').length === 11 && same(F0.datas(F0.last(U.sister)).slice(-1)[0], ['LA|pm|AC', 'Z']),
  'ten accounts are listed; eight have a button; ➕ and cancel stay last');

step('4h. The 🔢 button under a resumed card leads to the number, then the accounts');
const G = bench();
x = G.sell(U.sister, 'S1-0002');
G.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
G.sim.text(U.sister, 'AYA ဒေါ်စန်း');
res = G.last(U.sister);
const resText4h = res.text;
const aya4h = G.accounts().filter(r => r.label === 'AYA ဒေါ်စန်း')[0];
G.sim.tapLast(U.sister, MSG.btn_acct_number);
check(G.lastText(U.sister) === t(G.ports, 'acct_ask_detail', { label: 'AYA ဒေါ်စန်း' }) && res.text === resText4h, 'asked in a new message; the committed card is not edited');
G.sim.text(U.sister, '0123 456 789 AYA ဒေါ်စန်း');
check(G.option('pay_method', aya4h.key).detail === '0123 456 789 AYA ဒေါ်စန်း' && G.lastText(U.sister).indexOf(MSG.acct_title) === 0 && G.lastText(U.sister).indexOf('0123 456 789') >= 0,
  'stored; the accounts screen is the last message', G.lastText(U.sister));

step('4i. No account yet: the accounts screen says so and offers ➕');
const F1 = bench();
F1.setAccounts([]);
F1.sim.start(U.sister, '');
F1.sim.tapLast(U.sister, MSG.btn_accounts);
check(F1.lastText(U.sister) === MSG.acct_title + '\n' + MSG.acct_none && same(F1.datas(F1.last(U.sister)), [['LA|pm|AC', 'Z']]), 'the title, "no bank account yet", then [➕, cancel]', F1.lastText(U.sister));

step('4j. The number entry when the row is gone, when the store cannot write, and when somebody else changed the number meanwhile');
const F2 = bench();
F2.sim.start(U.sister, '');
F2.sim.tapLast(U.sister, MSG.btn_accounts);
const acct4j = F2.last(U.sister);
F2.sim.tap(U.sister, acct4j.id, 'LD|pm|WAVE');
F2.world.lists = F2.world.lists.filter(r => !(r.list === 'pay_method' && r.key === 'WAVE'));   // the laptop deleted the row while the phone was asking
let bots4j = F2.bots(U.sister).length;
F2.sim.text(U.sister, '09 111 222333');
check(F2.bots(U.sister).length === bots4j + 1 && F2.lastText(U.sister) === MSG.expired && F2.state(U.sister) === null && F2.world.lists.every(r => r.detail !== '09 111 222333'),
  'the account is gone: "expired", nothing stored, no "saved" line, the state is cleared', F2.lastText(U.sister));
F2.sim.tap(U.sister, acct4j.id, 'LD|pm|KBZ');
const addFn4j = F2.ports.store.addListOption;
delete F2.ports.store.addListOption;
bots4j = F2.bots(U.sister).length;
F2.sim.text(U.sister, '09 111 222333');
check(F2.bots(U.sister).length === bots4j + 1 && F2.lastText(U.sister) === MSG.add_unavailable && F2.state(U.sister) === null && F2.option('pay_method', 'KBZ').detail === '',
  'a store that can no longer write: "cannot add from here", nothing stored', F2.lastText(U.sister));
F2.ports.store.addListOption = function (rec, seed) { F2.option('pay_method', 'KBZ').detail = '09 999 000000 ဒေါ်လှ'; return addFn4j(rec, seed); };   // another phone stored a number first
F2.sim.tap(U.sister, acct4j.id, 'LD|pm|KBZ');
F2.sim.text(U.sister, '09 111 222333');
F2.ports.store.addListOption = addFn4j;
let two4j = F2.bots(U.sister).slice(-2);
check(F2.option('pay_method', 'KBZ').detail === '09 999 000000 ဒေါ်လှ' && two4j[0].text === t(F2.ports, 'acct_detail_saved', { label: 'KBZPay', detail: '09 999 000000 ဒေါ်လှ' }) &&
  two4j[1].text.indexOf(MSG.acct_title) === 0 && F2.state(U.sister) === null, 'a number stored by somebody else meanwhile is not overwritten: the reply shows the stored one, then the accounts', two4j.map(m => m.text));
F2.sim.tap(U.sister, acct4j.id, 'LD|pm|BANK');
F2.sim.text(U.sister, 'AYA   0012 3456 789\nဒေါ်စန်း');
two4j = F2.bots(U.sister).slice(-2);
check(F2.option('pay_method', 'BANK').detail === 'AYA 0012 3456 789 ဒေါ်စန်း' && two4j[0].text === t(F2.ports, 'acct_detail_saved', { label: 'ဘဏ်လွှဲ', detail: 'AYA 0012 3456 789 ဒေါ်စန်း' }),
  'two lines and runs of spaces are stored as one clean line, and the reply shows what is stored', two4j[0].text);
const oid4j = F2.orderWithAdvance(U.sister, 'ဒေါ်မြင့်', 0);
F2.sim.tap(U.sister, acct4j.id, 'LD|pm|BANK');
F2.sim.text(U.sister, oid4j.toLowerCase());
check(F2.option('pay_method', 'BANK').detail === 'AYA 0012 3456 789 ဒေါ်စန်း' && F2.state(U.sister) === null &&
  F2.lastText(U.sister).indexOf(t(F2.ports, 'ord_head', { no: orderNo(oid4j), customer: 'ဒေါ်မြင့်' })) === 0 && F2.flat(F2.last(U.sister)).indexOf('OV|' + oid4j) >= 0,
  'a typed voucher id opens that order card and drops the detail state (it is not stored as the number)', F2.lastText(U.sister));

step('4k. A retired account is not listed; the menu keeps the accounts button when orders and the notebook import are off');
const F3 = bench();
F3.option('pay_method', 'WAVE').active = false;
F3.sim.start(U.sister, '');
F3.sim.tapLast(U.sister, MSG.btn_accounts);
check(F3.lastText(U.sister).indexOf('WavePay') < 0 && F3.flat(F3.last(U.sister)).indexOf('LD|pm|WAVE') < 0 && F3.flat(F3.last(U.sister)).indexOf('LD|pm|KBZ') >= 0,
  'the accounts screen lists the active accounts only', F3.lastText(U.sister));
F3.world.settings.notebook_import = false;
const listOrders4k = F3.ports.store.listOrders;
delete F3.ports.store.listOrders;
F3.sim.start(U.sister, '');
check(F3.datas(F3.last(U.sister)).length === 4 && same(F3.datas(F3.last(U.sister))[3], ['M|restock', 'M|acct']) && F3.last(U.sister).keyboard.slice(0, 3).every(r => r.length === 3),
  'without 🧵 and 📒 the fourth row is 📦 and 🏛', F3.datas(F3.last(U.sister)));
F3.ports.store.listOrders = listOrders4k;

/* ============================== 5. where to transfer (section 6) ============================== */

step('5. Order voucher with a balance: the transfer line, also after a method tap; none when nothing is owed or the order is cancelled');
const H = bench();
H.option('pay_method', 'KBZ').detail = '09 777 123456 ဦးမောင်';
H.option('pay_method', 'BANK').detail = 'AYA 0012 3456 789 ဒေါ်စန်း';
H.world.lists.push({ list: 'pay_method', key: 'S2PAY', label: 'Wave ဆိုင်၂', active: true, order: 9, shop: 'S2', detail: '09 222 333444', note: '' });   // shop 2 only: never on a shop-1 voucher
const lineH = t(H.ports, 'receipt_transfer', { accounts: 'KBZPay 09 777 123456 ဦးမောင် · ဘဏ်လွှဲ AYA 0012 3456 789 ဒေါ်စန်း' });
let oid = H.orderWithAdvance(U.sister, 'ဒေါ်မြင့်', 75000);
let v = H.last(U.sister), vl = v.text.split('\n');
const depGroup5 = H.lastRow().groupId;
check(vl.indexOf(lineH) >= 0 && vl[vl.indexOf(lineH) - 1] === 'ကျန် 75,000' && lineH.indexOf('🏦') !== 0, 'voucher reply: the transfer line directly after the balance line', vl);
check(same(H.datas(v), [['MS|' + oid, 'OVP|' + oid, 'O|' + oid], ['PM|' + depGroup5 + '|KBZ', 'PM|' + depGroup5 + '|WAVE', 'PM|' + depGroup5 + '|BANK'], ['LA|pm|PM|' + depGroup5], ['U|' + depGroup5]]),
  'voucher buttons: measure/PDF/card, the 🏦 row for the advance, ➕, undo', H.datas(v));
H.sim.tap(U.sister, v.id, 'PM|' + depGroup5 + '|KBZ');
check(v.text.split('\n').indexOf(lineH) >= 0 && v.text.indexOf(t(H.ports, 'method_done', { method: 'KBZPay' })) >= 0 && H.liveOf(depGroup5)[0].method === 'KBZ',
  'after a method tap on the voucher reply the transfer line is still there', v.text);
H.tapData(U.sister, 'OVP|' + oid);
let foot = H.last(U.sister).document.report.footer.split('\n');
check(foot.length === 3 && foot[0] === t(H.ports, 'receipt_transfer', { accounts: 'KBZPay 09 777 123456 ဦးမောင်' }) && foot[1] === 'ဘဏ်လွှဲ AYA 0012 3456 789 ဒေါ်စန်း' &&
  foot[2].indexOf(H.world.settings.shop_address_S1) >= 0 && H.last(U.sister).document.report.subtitle.indexOf('ငွေလွှဲရန်') < 0,
  'voucher PDF: one account per footer line, above the address line; nothing in the subtitle', foot);
const oidPaid = H.orderWithAdvance(U.sister, 'ဒေါ်မြင့်', 150000);
check(H.lastText(U.sister).indexOf('ငွေလွှဲရန်') < 0 && H.lastText(U.sister).indexOf('ကျန် 0') >= 0 && buildReport(H.ports, 'voucher', { orderId: oidPaid }).footer.indexOf('ငွေလွှဲရန်') < 0,
  'an order paid in full in advance: no transfer line (text and PDF)');
const oidCx = H.orderWithAdvance(U.owner, 'ဒေါ်မြင့်', 0);
check(voucherText(H.ports, oidCx).indexOf(lineH) >= 0, 'an open order with nothing paid shows the line');
H.sim.text(U.owner, oidCx);
H.tapData(U.owner, 'OX|' + oidCx);
H.tapData(U.owner, 'OXR|' + oidCx + '|none');
check(H.ports.store.getOrder(oidCx).status === 'CANCELLED' && voucherText(H.ports, oidCx).indexOf('ငွေလွှဲရန်') < 0 && buildReport(H.ports, 'voucher', { orderId: oidCx }).footer.indexOf('ငွေလွှဲရန်') < 0,
  'a cancelled order\'s voucher has no transfer line');
H.sim.text(U.sister, oid);
H.sim.tapLast(U.sister, MSG.btn_deliver);
H.tapData(U.sister, 'ODP|' + oid + '|0|0');
vl = voucherText(H.ports, oid).split('\n');
check(H.ports.store.getOrder(oid).status === 'DELIVERED' && vl.indexOf(lineH) >= 0 && vl[vl.indexOf(lineH) - 1] === 'ကျန် 75,000' && H.lastText(U.sister).split('\n').indexOf(lineH) >= 0,
  'delivered with a balance: the voucher and the delivery receipt both carry the line after the balance', vl);

step('5b. A shop-2 voucher lists the account of shop 2 too; a shop-1 voucher never does');
const oidS2 = H.orderWithAdvance(U.brother, 'ဒေါ်မြင့်', 0);
const lineS2 = t(H.ports, 'receipt_transfer', { accounts: 'KBZPay 09 777 123456 ဦးမောင် · ဘဏ်လွှဲ AYA 0012 3456 789 ဒေါ်စန်း · Wave ဆိုင်၂ 09 222 333444' });
vl = H.lastText(U.brother).split('\n');
check(orderShop(oidS2) === 'S2' && vl.indexOf(lineS2) >= 0 && vl[vl.indexOf(lineS2) - 1] === 'ကျန် 150,000' && voucherText(H.ports, oid).indexOf('Wave ဆိုင်၂') < 0,
  'shop 2: three accounts after the balance line; the shop-1 voucher still shows two', vl);
foot = buildReport(H.ports, 'voucher', { orderId: oidS2, now: H.ports.clock.now() }).footer.split('\n');
check(foot.length === 4 && foot[0] === t(H.ports, 'receipt_transfer', { accounts: 'KBZPay 09 777 123456 ဦးမောင်' }) && foot[2] === 'Wave ဆိုင်၂ 09 222 333444' && foot[3].indexOf(H.world.settings.shop_address_S2) >= 0,
  'its PDF: one account per footer line, the address line of shop 2 last', foot);

/* ============================== 6. bank at delivery and at refund (section 5) ============================== */

step('6. ➕ bank on the delivery method screen');
const I2 = bench();
oid = I2.orderWithAdvance(U.sister, 'ဒေါ်မြင့်', 0);
I2.sim.text(U.sister, oid);
I2.sim.tapLast(U.sister, MSG.btn_deliver);
I2.tapData(U.sister, 'ODP|' + oid + '|all|0');
let dm = I2.last(U.sister);
check(same(I2.datas(dm), [['ODM|' + oid + '|CASH|150000|0', 'ODM|' + oid + '|KBZ|150000|0'], ['ODM|' + oid + '|WAVE|150000|0', 'ODM|' + oid + '|BANK|150000|0'], ['LA|pm|ODM|' + oid + '|150000|0'], ['Z']]),
  'delivery method screen: 💵 first, rows of two, ➕, its cancel row', I2.datas(dm));
let n6 = I2.world.ledger.length;
I2.sim.tap(U.sister, dm.id, 'LA|pm|ODM|' + oid + '|150000|0');
check(dm.edited && dm.text === MSG.add_ask_pm && same(I2.state(U.sister).resume, { a: 'ODM', args: [oid, '150000', '0'] }), 'the method screen becomes the prompt; order id, amount and pool ride in the add state', I2.state(U.sister));
I2.sim.text(U.sister, 'CB ဘဏ်');
const cb6 = I2.accounts().filter(r => r.label === 'CB ဘဏ်')[0];
res = I2.last(U.sister);
const pay6 = I2.liveOf(oid).filter(r => r.type === 'PAYMENT')[0];
check(I2.ports.store.getOrder(oid).status === 'DELIVERED' && !!pay6 && pay6.cash === 150000 && pay6.method === cb6.key && saleGroupInfo(I2.ports, oid).owed === 0,
  'delivered: PAYMENT 150,000 on the new account, nothing owed', pay6);
check(res.text.indexOf(t(I2.ports, 'add_done', { label: 'CB ဘဏ်' }) + '\n' + t(I2.ports, 'dlv_done', { no: orderNo(oid) })) === 0 && res.text.split('\n').pop() === t(I2.ports, 'acct_detail_hint', { label: 'CB ဘဏ်' }) &&
  same(I2.datas(res), [['U|' + oid, 'RCP|' + oid], ['LD|pm|' + cb6.key]]) && I2.state(U.sister) === null,
  'one message: "➕ added", the delivery receipt, the number hint; undo/PDF and the 🔢 row', [res.text, I2.datas(res)]);

step('6b. ➕ bank on the refund method screen (owner)');
oid = I2.orderWithAdvance(U.owner, 'ဒေါ်မြင့်', 50000);
I2.sim.text(U.owner, oid);
I2.tapData(U.owner, 'OX|' + oid);
I2.tapData(U.owner, 'OXR|' + oid + '|refund');
let rm = I2.last(U.owner);
check(same(I2.datas(rm).slice(-2), [['LA|pm|OXM|' + oid], ['Z']]) && I2.flat(rm).indexOf('OXM|' + oid + '|CASH') >= 0 && I2.flat(rm).indexOf('OXM|' + oid + '|' + cb6.key) >= 0,
  'refund method screen: the accounts (the new one included), ➕, its cancel row', I2.datas(rm));
I2.sim.tap(U.owner, rm.id, 'LA|pm|OXM|' + oid);
I2.sim.text(U.owner, 'UAB မမ');
const uab6 = I2.accounts().filter(r => r.label === 'UAB မမ')[0];
res = I2.last(U.owner);
check(I2.lastRow().type === 'DEPOSIT' && I2.lastRow().amount === -50000 && I2.lastRow().method === uab6.key && I2.ports.store.getOrder(oid).status === 'CANCELLED',
  'refund: a negative DEPOSIT row on the new account; the order is cancelled', [I2.lastRow().type, I2.lastRow().amount, I2.lastRow().method]);
check(res.text === [t(I2.ports, 'add_done', { label: 'UAB မမ' }), t(I2.ports, 'cx_done', { no: orderNo(oid) }), t(I2.ports, 'cx_refunded', { amount: '50,000', method: 'UAB မမ' }), t(I2.ports, 'acct_detail_hint', { label: 'UAB မမ' })].join('\n') &&
  same(I2.datas(res), [['U|' + oid], ['LD|pm|' + uab6.key]]), 'one message: "➕ added", cancelled, refunded with the label, the hint; undo and 🔢', [res.text, I2.datas(res)]);
oid = I2.orderWithAdvance(U.owner, 'ဒေါ်မြင့်', 50000);
I2.sim.text(U.sister, oid);
n6 = I2.world.ledger.length;
I2.tapData(U.sister, 'LA|pm|OXM|' + oid);
I2.sim.text(U.sister, 'UAB မမ');
check(I2.world.ledger.length === n6 && I2.lastText(U.sister) === t(I2.ports, 'add_exists', { label: 'UAB မမ' }) + '\n' + MSG.ord_owner_only && I2.ports.store.getOrder(oid).status === 'ORDERED',
  'a seller cannot refund through ➕ either: the owner-only refusal follows the prefix, nothing written', I2.lastText(U.sister));

step('6c. The order was delivered by somebody else while the name was typed: the refusal follows the prefix');
oid = I2.orderWithAdvance(U.sister, 'ဒေါ်မြင့်', 0);
I2.sim.text(U.sister, oid);
I2.sim.tapLast(U.sister, MSG.btn_deliver);
I2.tapData(U.sister, 'ODP|' + oid + '|all|0');
dm = I2.last(U.sister);
I2.sim.tap(U.sister, dm.id, 'LA|pm|ODM|' + oid + '|150000|0');
deliverOrder(I2.ports, { orderId: oid, paid: 0, method: null, usePool: false, staff: I2.ports.store.getStaff(String(U.owner.id)), updateId: 'other-phone', source: CFG.SOURCE.BUTTON });
n6 = I2.world.ledger.length;
I2.sim.text(U.sister, 'AGD ဘဏ်');
const agd6 = I2.accounts().filter(r => r.label === 'AGD ဘဏ်')[0];
res = I2.last(U.sister);
check(!!agd6 && I2.world.ledger.length === n6 && I2.state(U.sister) === null &&
  res.text === [t(I2.ports, 'add_done', { label: 'AGD ဘဏ်' }), MSG.ord_closed, t(I2.ports, 'acct_detail_hint', { label: 'AGD ဘဏ်' })].join('\n') && same(I2.datas(res), [['LD|pm|' + agd6.key]]),
  'the account is added; "➕ added" + "already closed" + the number hint; no second delivery is written', [res.text, I2.datas(res)]);
oid = I2.orderWithAdvance(U.owner, 'ဒေါ်မြင့်', 50000);
I2.sim.text(U.owner, oid);
I2.tapData(U.owner, 'OX|' + oid);
I2.tapData(U.owner, 'OXR|' + oid + '|refund');
rm = I2.last(U.owner);
I2.sim.tap(U.owner, rm.id, 'LA|pm|OXM|' + oid);
cancelOrder(I2.ports, { orderId: oid, mode: 'keep', method: null, staff: I2.ports.store.getStaff(String(U.owner.id)), updateId: 'other-phone', source: CFG.SOURCE.BUTTON });   // cancelled elsewhere, the advance kept
n6 = I2.world.ledger.length;
I2.sim.text(U.owner, 'Yoma ဦးလှ');
const yoma6 = I2.accounts().filter(r => r.label === 'Yoma ဦးလှ')[0];
res = I2.last(U.owner);
check(!!yoma6 && I2.world.ledger.length === n6 && res.text === [t(I2.ports, 'add_done', { label: 'Yoma ဦးလှ' }), MSG.ord_closed, t(I2.ports, 'acct_detail_hint', { label: 'Yoma ဦးလှ' })].join('\n') &&
  same(I2.datas(res), [['LD|pm|' + yoma6.key]]), 'the same for a refund of an order that was cancelled meanwhile: no refund row, "already closed" after the prefix', [res.text, I2.datas(res)]);

/* ============================== 7. fabrics by key, ➕ fabric (section 5) ============================== */

step('7. Fabric by key, a stale index button, ➕ fabric');
const J = bench();
oid = J.newOrder(U.sister, 'ဒေါ်မြင့်', 'TSL-0018');
let due = J.last(U.sister);
J.sim.tap(U.sister, due.id, 'OF|' + oid + '|ask');
check(same(J.datas(due), [['OF|' + oid + '|k|f1', 'OF|' + oid + '|k|f2', 'OF|' + oid + '|k|f3'], ['OF|' + oid + '|own', 'OF|' + oid + '|type'], ['LA|fb|OF|' + oid, 'Z']]) &&
  same(J.texts(due)[0], ['ပိုး', 'ချည်', 'ပုဝါ']) && same(J.texts(due)[2], [MSG.btn_add_option, MSG.btn_cancel]),
  'fabric screen: the fabrics by key (three per row), own/other, then [➕, cancel]', J.datas(due));
const line7 = () => J.world.orderItems.filter(l => l.orderId === oid).slice(-1)[0];
// The laptop reorders the list while the screen is open: a button by key still means the same fabric.
J.option('fabric', 'f1').order = 9;
J.sim.tap(U.sister, due.id, 'OF|' + oid + '|k|f2');
check(line7().fabric === 'ချည်' && due.text.indexOf('ချည် + TSL-0018') >= 0 && J.flat(due).indexOf('OD|' + oid + '|type') >= 0, 'OF|k|f2 sets ချည် on the line and the due screen is back', due.text);
J.sim.tap(U.sister, due.id, 'OF|' + oid + '|1');
check(line7().fabric === 'ပုဝါ', 'a stale index button (OF|id|1) is read on the list as it is now: ချည်, ပုဝါ, ပိုး -> ပုဝါ', line7().fabric);
J.sim.tap(U.sister, due.id, 'OF|' + oid + '|9');
check(due.text === MSG.expired && line7().fabric === 'ပုဝါ', 'an index beyond the list: expired, the fabric is unchanged');
J.sim.text(U.sister, oid);
J.tapData(U.sister, 'OA|' + oid + '|x');                              // any OA redraws the due screen for this order
due = J.last(U.sister);
J.sim.tap(U.sister, due.id, 'OF|' + oid + '|ask');
const lists7 = J.world.lists.length;
J.sim.tap(U.sister, due.id, 'LA|fb|OF|' + oid);
check(due.text === MSG.add_ask_fb && same(J.datas(due), [['Z']]) && J.state(U.sister).list === 'fabric' && same(J.state(U.sister).resume, { a: 'OF', args: [oid] }), 'the fabric screen becomes the prompt for a fabric name', J.state(U.sister));
J.sim.text(U.sister, 'ဂျာစီ');
const jersey = J.world.lists.filter(r => r.list === 'fabric' && r.label === 'ဂျာစီ')[0];
res = J.last(U.sister);
check(J.world.lists.length === lists7 + 1 && !!jersey && /^f[a-z0-9]{1,10}$/.test(jersey.key) && line7().fabric === 'ဂျာစီ' &&
  res.text.indexOf(t(J.ports, 'add_done', { label: 'ဂျာစီ' }) + '\n' + t(J.ports, 'ord_head', { no: orderNo(oid), customer: 'ဒေါ်မြင့်' })) === 0 && res.text.indexOf('ဂျာစီ + TSL-0018') >= 0 &&
  J.flat(res).indexOf('OF|' + oid + '|ask') >= 0 && J.state(U.sister).kind === 'order' && J.state(U.sister).step === 'due',
  'a new fabric row; it is set on the line; "➕ added" + the due screen as one new message', [jersey, res.text]);
J.sim.tap(U.sister, res.id, 'OF|' + oid + '|ask');
check(J.sim.button(res, 'ဂျာစီ') === 'OF|' + oid + '|k|' + jersey.key && J.datas(res)[0].length === 3 && J.datas(res)[1].length === 1, 'the fabric screen now offers it (a fourth button, on a second row)', J.datas(res));
J.tapData(U.sister, 'Z');

step('7b. ➕ fabric when the flow has moved on: another flow\'s state, a closed order, the order module switched off');
const J2 = bench();
oid = J2.newOrder(U.sister, 'ဒေါ်မြင့်', 'TSL-0018');
due = J2.last(U.sister);
J2.sim.tap(U.sister, due.id, 'OF|' + oid + '|ask');
const fabricOf = id => J2.world.orderItems.filter(l => l.orderId === id).slice(-1)[0].fabric;
const hasFabric = label => J2.world.lists.some(r => r.list === 'fabric' && r.label === label);
J2.sim.start(U.sister, '');
J2.sim.tapLast(U.sister, MSG.btn_expense);                              // the seller went on to an expense ...
const exp7b = JSON.stringify(J2.state(U.sister));
J2.sim.tap(U.sister, due.id, 'LA|fb|OF|' + oid);                         // ... and came back to the old fabric screen
J2.sim.text(U.sister, 'ကတ္တီပါ');
check(hasFabric('ကတ္တီပါ') && J2.lastText(U.sister) === t(J2.ports, 'add_done', { label: 'ကတ္တီပါ' }) + '\n' + MSG.expired && fabricOf(oid) === '' && JSON.stringify(J2.state(U.sister)) === exp7b,
  'the state that came back is another flow\'s: the fabric is added to the list, the line is not touched, "expired" follows the prefix, the expense draft stays', J2.lastText(U.sister));
J2.sim.text(U.sister, oid);
J2.sim.tapLast(U.sister, MSG.btn_deliver);
J2.tapData(U.sister, 'ODP|' + oid + '|0|0');
J2.sim.tap(U.sister, due.id, 'LA|fb|OF|' + oid);
J2.sim.text(U.sister, 'ဖဲ');
check(J2.ports.store.getOrder(oid).status === 'DELIVERED' && hasFabric('ဖဲ') && J2.lastText(U.sister) === t(J2.ports, 'add_done', { label: 'ဖဲ' }) + '\n' + MSG.expired && fabricOf(oid) === '' && J2.state(U.sister) === null,
  'a delivered order: the fabric is added to the list, the line is not touched, "expired" follows the prefix', J2.lastText(U.sister));
const oid7b = J2.newOrder(U.sister, 'ဒေါ်မြင့်', 'TSL-0018');
const due7b = J2.last(U.sister);
J2.sim.tap(U.sister, due7b.id, 'OF|' + oid7b + '|ask');
J2.sim.tap(U.sister, due7b.id, 'LA|fb|OF|' + oid7b);
const listOrdersFn = J2.ports.store.listOrders;
delete J2.ports.store.listOrders;                                          // ordersEnabled(ports) is false from here
J2.sim.text(U.sister, 'ဇာ');
check(!ordersEnabled(J2.ports) && hasFabric('ဇာ') && J2.lastText(U.sister) === t(J2.ports, 'add_done', { label: 'ဇာ' }) + '\n' + MSG.expired && fabricOf(oid7b) === '',
  'the order module is off when the name arrives: "expired" follows the prefix, no order code runs', J2.lastText(U.sister));
const state7b = JSON.stringify(J2.state(U.sister));
[['LA|fb|OF|' + oid7b, 'fabric'], ['LA|pm|ODM|' + oid7b + '|1000|0', 'delivery account'], ['LA|pm|OXM|' + oid7b, 'refund account']].forEach(c => {
  J2.sim.start(U.sister, '');
  const tapped = J2.last(U.sister);
  J2.sim.tap(U.sister, tapped.id, c[0]);
  check(tapped.text === MSG.expired && tapped.keyboard.length === 0 && JSON.stringify(J2.state(U.sister)) === state7b, '➕ ' + c[1] + ' with the order module off: expired at the tap, no name is asked');
});
J2.ports.store.listOrders = listOrdersFn;

step('7c. A fabric of one shop is offered on that shop\'s orders only');
const J3 = bench();
J3.world.lists.push({ list: 'fabric', key: 'fs2', label: 'မန္တလေးပိုး', active: true, order: 9, shop: 'S2', detail: '', note: '' });
oid = J3.newOrder(U.sister, 'ဒေါ်မြင့်', 'TSL-0018');
J3.tapData(U.sister, 'OF|' + oid + '|ask');
check(J3.flat(J3.last(U.sister)).indexOf('OF|' + oid + '|k|fs2') < 0 && J3.flat(J3.last(U.sister)).indexOf('OF|' + oid + '|k|f1') >= 0, 'a shop-1 order: the shop-2 fabric is not offered', J3.datas(J3.last(U.sister)));
const oid7c = J3.newOrder(U.brother, 'ဒေါ်မြင့်', 'TSL-0018');
J3.tapData(U.brother, 'OF|' + oid7c + '|ask');
check(J3.sim.button(J3.last(U.brother), 'မန္တလေးပိုး') === 'OF|' + oid7c + '|k|fs2' && J3.datas(J3.last(U.brother))[1].length === 1, 'a shop-2 order: it is the fourth button, on a second row', J3.datas(J3.last(U.brother)));
J3.tapData(U.brother, 'OF|' + oid7c + '|3');
check(J3.world.orderItems.filter(l => l.orderId === oid7c).slice(-1)[0].fabric === 'မန္တလေးပိုး', 'and a stale index button counts on that shop\'s list (index 3 = the shop-2 fabric)');

/* ============================== 8. design codes (section 5) ============================== */

step('8. A typed design nobody knows: digits alone and a name offer no create button');
const K = bench();
K.sim.start(U.sister, '');
K.sim.tapLast(U.sister, MSG.btn_orders);
K.sim.tapLast(U.sister, MSG.btn_order_new);
K.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
oid = K.world.orders[K.world.orders.length - 1].id;
let bots8 = K.bots(U.sister).length;
K.sim.text(U.sister, '31');
let two = K.bots(U.sister).slice(bots8);
check(two.length === 2 && two[0].text === t(K.ports, 'ord_design_unknown', { code: '31' }) && two[0].keyboard.length === 0 && K.flat(two[1]).indexOf('OI|' + oid + '|type') >= 0 &&
  K.flat(two[1]).indexOf('OI|' + oid + '|create') < 0, '"31": the unknown line, then the design screen again, as before (no create button)', two.map(m => m.text));
bots8 = K.bots(U.sister).length;
K.sim.text(U.sister, 'ဂါဝန်ရှည်');
two = K.bots(U.sister).slice(bots8);
check(two.length === 2 && two[0].keyboard.length === 0 && K.flat(two[1]).indexOf('OI|' + oid + '|create') < 0, 'a Burmese name: the same, no create button');
bots8 = K.bots(U.sister).length;
K.sim.text(U.sister, 'TSL-31A');
check(K.bots(U.sister).slice(bots8).length === 2 && K.flat(K.last(U.sister)).indexOf('OI|' + oid + '|create') < 0, '"TSL-31A" is not a code shape: no create button');

step('8b. "tsl 31" can be created: ONE message, the step stays, a retyped code is looked up again');
bots8 = K.bots(U.sister).length;
const designs8 = K.world.designs.length;
K.sim.text(U.sister, 'tsl 31');
let offer = K.last(U.sister);
check(K.bots(U.sister).length === bots8 + 1 && offer.text === t(K.ports, 'ord_design_unknown', { code: 'TSL-31' }) &&
  same(K.datas(offer), [['OI|' + oid + '|create', 'OI|' + oid + '|none'], ['Z']]) && same(K.texts(offer)[0], [t(K.ports, 'btn_create_design', { code: 'TSL-31' }), MSG.btn_design_none]),
  'one message: unknown "TSL-31" with [➕ create, no code] and cancel; the design screen is not sent again', [offer.text, K.datas(offer)]);
check(K.state(U.sister).step === 'design' && K.state(U.sister).draft.newCode === 'TSL-31' && K.world.designs.length === designs8, 'the step is unchanged, the code waits in the draft, nothing created yet', K.state(U.sister));
K.sim.text(U.sister, 'tsl 25');
check(K.lastText(U.sister) === t(K.ports, 'ord_ask_price', { design: 'TSL-0025 · ရင်ဖုံး' }) && K.world.designs.length === designs8, 'a retyped known code is found (TSL-0025): the price is asked');
K.tapData(U.sister, 'Z');

step('8c. Create tapped twice: the price screen twice, one Designs row');
K.sim.start(U.sister, '');
K.sim.tapLast(U.sister, MSG.btn_orders);
K.sim.tapLast(U.sister, MSG.btn_order_new);
K.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
oid = K.world.orders[K.world.orders.length - 1].id;
K.tapData(U.sister, 'OI|' + oid + '|type');
K.sim.text(U.sister, 'tsl 31');
offer = K.last(U.sister);
check(K.state(U.sister).step === 'code' && offer.text === t(K.ports, 'ord_design_unknown', { code: 'TSL-31' }) && K.flat(offer).indexOf('OI|' + oid + '|create') >= 0, 'after ✏️ ကုဒ် ရိုက် too (step "code")');
bots8 = K.bots(U.sister).length;
K.sim.tap(U.sister, offer.id, 'OI|' + oid + '|create');
const made = K.world.designs.filter(d => d.code === 'TSL-31');
check(made.length === 1 && K.world.designs.length === designs8 + 1 && made[0].name === '' && made[0].basePrice === '' && made[0].active === true && made[0].note === 'added by Sister (S1) ' + today,
  'a Designs row TSL-31: no name, no price, active, the note says who added it', made[0]);
check(offer.text === t(K.ports, 'design_created', { code: 'TSL-31' }) && offer.keyboard.length === 0 && K.bots(U.sister).length === bots8 + 1 &&
  K.lastText(U.sister) === t(K.ports, 'ord_ask_price', { design: 'TSL-31' }) && K.flat(K.last(U.sister)).indexOf('OP|' + oid + '|other') >= 0,
  'the tapped message says "created"; the price screen is a new message', [offer.text, K.lastText(U.sister)]);
K.sim.tap(U.sister, offer.id, 'OI|' + oid + '|create');
check(K.world.designs.filter(d => d.code === 'TSL-31').length === 1 && K.world.designs.length === designs8 + 1 && K.bots(U.sister).length === bots8 + 2 &&
  K.lastText(U.sister) === t(K.ports, 'ord_ask_price', { design: 'TSL-31' }), 'a second tap shows the price screen again and writes no second row');
K.tapData(U.sister, 'OP|' + oid + '|40000');
K.tapData(U.sister, 'OQ|' + oid + '|1');
const line8 = K.world.orderItems.filter(l => l.orderId === oid)[0];
check(!!line8 && line8.designCode === 'TSL-31' && line8.amount === 40000 && K.lastText(U.sister).indexOf('TSL-31') >= 0, 'the order line carries the new code');
K.tapData(U.sister, 'Z');
K.sim.start(U.sister, '');
K.sim.tapLast(U.sister, MSG.btn_orders);
K.sim.tapLast(U.sister, MSG.btn_order_new);
K.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
oid = K.world.orders[K.world.orders.length - 1].id;
K.sim.text(U.sister, 'TSL-0031');
check(K.lastText(U.sister) === t(K.ports, 'ord_ask_price', { design: 'TSL-31' }), 'typed later with zeros (TSL-0031) the new design is found by its alias');
K.tapData(U.sister, 'Z');
const stale8 = K.last(U.sister);
K.sim.tap(U.sister, stale8.id, 'OI|' + oid + '|create');
check(stale8.text === MSG.expired && K.world.designs.length === designs8 + 1, 'create without a code waiting in the draft: expired');

step('8d. A store without addDesign: today\'s answer, no create button');
const addDesignFn = K.ports.store.addDesign;
delete K.ports.store.addDesign;
K.sim.start(U.sister, '');
K.sim.tapLast(U.sister, MSG.btn_orders);
K.sim.tapLast(U.sister, MSG.btn_order_new);
K.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
oid = K.world.orders[K.world.orders.length - 1].id;
bots8 = K.bots(U.sister).length;
K.sim.text(U.sister, 'ab 7');
two = K.bots(U.sister).slice(bots8);
check(two.length === 2 && two[0].text === t(K.ports, 'ord_design_unknown', { code: 'ab 7' }) && two[0].keyboard.length === 0 && K.flat(two[1]).indexOf('OI|' + oid + '|create') < 0,
  'unknown line + design screen, no create button', two.map(m => m.text));
K.ports.store.addDesign = addDesignFn;
K.tapData(U.sister, 'Z');

step('8e. The code is kept as typed: "abc-0042" becomes ABC-0042 (the zeros stay), spoken too');
K.sim.start(U.sister, '');
K.sim.tapLast(U.sister, MSG.btn_orders);
K.sim.tapLast(U.sister, MSG.btn_order_new);
K.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
oid = K.world.orders[K.world.orders.length - 1].id;
K.sim.text(U.sister, 'abc-0042');
offer = K.last(U.sister);
check(offer.text === t(K.ports, 'ord_design_unknown', { code: 'ABC-0042' }) && K.sim.button(offer, t(K.ports, 'btn_create_design', { code: 'ABC-0042' })) === 'OI|' + oid + '|create' &&
  K.state(U.sister).draft.newCode === 'ABC-0042', 'the offer names ABC-0042', offer.text);
K.sim.tap(U.sister, offer.id, 'OI|' + oid + '|create');
check(K.world.designs.filter(d => d.code === 'ABC-0042').length === 1 && offer.text === t(K.ports, 'design_created', { code: 'ABC-0042' }) &&
  K.lastText(U.sister) === t(K.ports, 'ord_ask_price', { design: 'ABC-0042' }), 'created as ABC-0042; the price is asked for it', K.lastText(U.sister));
K.tapData(U.sister, 'Z');
K.sim.start(U.sister, '');
K.sim.tapLast(U.sister, MSG.btn_orders);
K.sim.tapLast(U.sister, MSG.btn_order_new);
K.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
oid = K.world.orders[K.world.orders.length - 1].id;
bots8 = K.bots(U.sister).length;
K.sim.voice(U.sister, 'xy 7');
offer = K.last(U.sister);
check(K.bots(U.sister).length === bots8 + 1 && offer.text === t(K.ports, 'ord_design_unknown', { code: 'XY-7' }) && K.flat(offer).indexOf('OI|' + oid + '|create') >= 0,
  'a spoken code nobody knows gets the same one-message offer', offer.text);
K.tapData(U.sister, 'Z');

/* ============================== 9. voice (section 2), the item card (section 7) ============================== */

step('9. Voice: the method by the account\'s label, also a label that contains a holder\'s name');
const L = bench();
L.world.lists.push({ list: 'pay_method', key: 'KBZUM', label: 'KBZ ဦးမောင်', active: true, order: 5, shop: '', detail: '', note: '' });
const ctx9 = buildAiContext(L.ports, L.ports.store.getStaff(String(U.sister.id)), String(U.sister.id));
check(same(ctx9.payMethods, [['CASH', 'ငွေသား'], ['KBZ', 'KBZPay'], ['WAVE', 'WavePay'], ['BANK', 'ဘဏ်လွှဲ'], ['KBZUM', 'KBZ ဦးမောင်']]) &&
  aiContextText(ctx9).indexOf('"KBZUM:KBZ ဦးမောင်"') >= 0, 'the AI context lists the accounts as [KEY, label] pairs, CASH first; the prompt prints KEY:label', ctx9.payMethods);
L.sim.start(U.sister, 'S1-0002');
const customers9 = L.world.customers.length;
L.sim.voice(U.sister, 'ဒါ ၁ ထည် KBZ ဦးမောင် နဲ့ ရောင်းရတယ်');
check(L.lastText(U.sister).indexOf(t(L.ports, 'method_mark', { method: 'KBZ ဦးမောင်' })) >= 0 && L.sim.button(L.last(U.sister), MSG.btn_yes) !== null, 'the proposal names the account by its label', L.lastText(U.sister));
L.sim.tapLast(U.sister, MSG.btn_yes);
check(L.lastRow().type === 'SALE' && L.lastRow().method === 'KBZUM' && L.lastRow().customerId === '' && L.world.customers.length === customers9,
  'the sale is recorded on that account; the holder\'s name did not become a customer', [L.lastRow().method, L.lastRow().customerId]);
L.sim.start(U.sister, 'S1-0002');
L.sim.voice(U.sister, 'ဒါ ၁ ထည် ဘဏ်လွှဲ နဲ့ ရောင်းရတယ်');
L.sim.tapLast(U.sister, MSG.btn_yes);
check(L.lastRow().method === 'BANK', 'a plain label (ဘဏ်လွှဲ) gives its key');
x = L.sell(U.sister, 'S1-0002');
L.sim.voice(U.sister, 'KBZ ဦးမောင် နဲ့ ပေးသွားတယ်');
check(L.lastText(U.sister).indexOf(t(L.ports, 'method_voice', { method: 'KBZ ဦးမောင်', desc: describeRow(L.ports, L.liveOf(x.g)[0]) })) >= 0, 'method-only note after a button sale: proposed for the last sale', L.lastText(U.sister));
L.sim.tapLast(U.sister, MSG.btn_yes);
check(L.liveOf(x.g)[0].method === 'KBZUM', 'confirmed: the last sale is now on that account');
const fake9 = { chat: { id: U.sister.id, type: 'private' }, from: { id: U.sister.id }, message_id: 0 };
const staff9 = L.ports.store.getStaff(String(U.sister.id));
handleIntent({ intent: 'SALE', qty: 1, method: 'KBZ ဦးမောင်', transcript: 'x', confidence: 0.9 }, fake9, staff9, 'v1', L.ports, CFG.SOURCE.VOICE, buildAiContext(L.ports, staff9, String(U.sister.id)));
L.sim.tapLast(U.sister, MSG.btn_yes);
check(L.lastRow().method === 'KBZUM', 'a model that answers the spoken name instead of the KEY is mapped to the key (methodKeyFor)');
handleIntent({ intent: 'SALE', qty: 1, method: 'PAYPAL', transcript: 'x', confidence: 0.9 }, fake9, staff9, 'v2', L.ports, CFG.SOURCE.VOICE, buildAiContext(L.ports, staff9, String(U.sister.id)));
check(L.lastText(U.sister).indexOf('🏦') < 0, 'a method no list knows is dropped from the proposal');
L.sim.tapLast(U.sister, MSG.btn_yes);
check(L.lastRow().type === 'SALE' && L.lastRow().method === 'CASH', 'and the sale is cash, as before');
L.sim.start(U.sister, '');
L.sim.tapLast(U.sister, MSG.btn_deposit);
L.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
L.sim.tapLast(U.sister, '100,000');
L.sim.voice(U.sister, 'KBZ ဦးမောင် နဲ့ လွှဲတယ်');
check(L.lastRow().type === 'DEPOSIT' && L.lastRow().method === 'KBZUM', 'the deposit-note path maps the spoken account too', [L.lastRow().type, L.lastRow().method]);
L.sim.start(U.sister, '');
L.sim.tapLast(U.sister, MSG.btn_deposit);
L.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
L.sim.tapLast(U.sister, '100,000');
handleIntent({ intent: 'UNKNOWN', method: 'KBZ ဦးမောင်', note: 'အော်ဒါ', transcript: 'x', confidence: 0.2 }, fake9, staff9, 'v3', L.ports, CFG.SOURCE.VOICE, buildAiContext(L.ports, staff9, String(U.sister.id)));
check(L.lastRow().type === 'DEPOSIT' && L.lastRow().method === 'KBZUM' && L.lastRow().note === 'အော်ဒါ', 'also when the model answers the spoken name instead of the KEY (deposit note)', [L.lastRow().type, L.lastRow().method]);
handleIntent({ intent: 'UNKNOWN', method: 'PAYPAL', note: 'အော်ဒါ', transcript: 'x', confidence: 0.2 }, fake9, staff9, 'v4', L.ports, CFG.SOURCE.VOICE,
  { state: { kind: 'dep', step: 'note', customerId: 'C-0001', amount: 50000 } });
check(L.lastRow().type === 'DEPOSIT' && L.lastRow().amount === 50000 && L.lastRow().method === 'CASH', 'a method no list knows is dropped there too: the deposit is cash', [L.lastRow().type, L.lastRow().method]);

step('9a. The AI context lists the accounts of the speaker\'s shop; a retired account named by its exact key is still understood');
L.world.lists.push({ list: 'pay_method', key: 'S2PAY', label: 'Wave ဆိုင်၂', active: true, order: 9, shop: 'S2', detail: '', note: '' });
const staffBro = L.ports.store.getStaff(String(U.brother.id));
const keys9 = st => buildAiContext(L.ports, st, st.id).payMethods.map(p => p[0]);
check(keys9(staff9).indexOf('S2PAY') < 0 && same(keys9(staffBro), ['CASH', 'KBZ', 'WAVE', 'BANK', 'KBZUM', 'S2PAY']), 'shop 1 is not offered the shop-2 account; shop 2 is', [keys9(staff9), keys9(staffBro)]);
x = L.sell(U.sister, 'S1-0002');
handleIntent({ intent: 'SALE', qty: 1, method: 'Wave ဆိုင်၂', transcript: 'x', confidence: 0.9 }, fake9, staff9, 'v6', L.ports, CFG.SOURCE.VOICE, buildAiContext(L.ports, staff9, String(U.sister.id)));
check(L.sim.button(L.last(U.sister), MSG.btn_yes) !== null && L.lastText(U.sister).indexOf('🏦') < 0, 'a shop-1 seller naming the shop-2 account by its label: not used, the proposal has no method', L.lastText(U.sister));
L.sim.tapLast(U.sister, MSG.btn_no);
L.option('pay_method', 'BANK').active = false;
handleIntent({ intent: 'METHOD', method: 'bank', transcript: 'x', confidence: 0.9 }, fake9, staff9, 'v5', L.ports, CFG.SOURCE.VOICE, buildAiContext(L.ports, staff9, String(U.sister.id)));
check(L.lastText(U.sister).indexOf(t(L.ports, 'method_voice', { method: 'ဘဏ်လွှဲ', desc: describeRow(L.ports, L.liveOf(x.g)[0]) })) >= 0 && L.sim.button(L.last(U.sister), MSG.btn_yes) !== null,
  'METHOD with the key of a retired account: proposed for the last sale (methodKnown, as for a tapped button)', L.lastText(U.sister));
L.sim.tapLast(U.sister, MSG.btn_yes);
check(L.liveOf(x.g)[0].method === 'BANK', 'confirmed: the sale is on the retired account');
L.option('pay_method', 'BANK').active = true;

step('9b. The sold-out card says how the piece was paid, a split included');
const M = bench();
x = M.sell(U.sister, 'S1-0001');
M.sim.tap(U.sister, x.card.id, 'CU|' + x.g);
M.sim.tapLast(U.sister, 'ဒေါ်မြင့်');
M.sim.start(U.sister, 'S1-0001');
check(M.lastText(U.sister).split('\n').pop() === t(M.ports, 'card_buyer', { customer: 'ဒေါ်မြင့်', paid: '25,000', method: 'ငွေသား' }), 'one method: its label', M.lastText(U.sister));
M.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
M.tapData(U.sister, 'SXM|' + x.g + '|KBZ');
M.sim.text(U.sister, '10000');
M.sim.start(U.sister, 'S1-0001');
check(M.lastText(U.sister).split('\n').pop() === t(M.ports, 'card_buyer', { customer: 'ဒေါ်မြင့်', paid: '25,000', method: 'ငွေသား 15,000 · KBZPay 10,000' }), 'after a split: "ငွေသား 15,000 · KBZPay 10,000"', M.lastText(U.sister));
cr = M.creditSale(U.sister, 'S1-0004', 0, 'ဒေါ်မြင့်');
M.sim.start(U.sister, 'S1-0004');
check(M.lastText(U.sister).split('\n').pop() === t(M.ports, 'card_buyer', { customer: 'ဒေါ်မြင့်', paid: '0', method: 'ငွေသား' }), 'nothing paid yet: the cash label, as before', M.lastText(U.sister));

/* ============================== 9c. a sheet without Lists rows ============================== */

step('9c. A sheet without Lists rows (before setupSheet made the tab): the old accounts are offered, ➕ and 🔢 keep them all');
const P = bench({ legacy: true });
x = P.sell(U.sister, 'S1-0002');
check(P.world.lists.length === 0 && same(P.datas(x.card).slice(2), [['PM|' + x.g + '|KBZ', 'PM|' + x.g + '|WAVE', 'PM|' + x.g + '|BANK'], ['SX|' + x.g, 'LA|pm|PM|' + x.g]]),
  'no Lists rows: the sale card offers KBZ, WAVE and BANK from Settings, with split and ➕', P.datas(x.card));
P.sim.tap(U.sister, x.card.id, 'LA|pm|PM|' + x.g);
P.sim.text(U.sister, 'AYA ဒေါ်စန်း');
const ayaP = P.accounts().filter(r => r.label === 'AYA ဒေါ်စန်း')[0];
res = P.last(U.sister);
check(!!ayaP && same(P.world.lists.filter(r => r.list === 'pay_method').map(r => r.key), ['CASH', 'KBZ', 'WAVE', 'BANK', ayaP.key]) && P.world.lists.every(r => r.list === 'pay_method') &&
  P.liveOf(x.g)[0].method === ayaP.key && same(P.flat(res).filter(d => /^PM\|/.test(d)), ['CASH', 'KBZ', 'WAVE', 'BANK'].map(k => 'PM|' + x.g + '|' + k)),
  'the first ➕ seeds the pay_method list with today\'s accounts, then adds the new one: no button is lost', P.world.lists.map(r => r.list + ':' + r.key));
P.sim.start(U.sister, '');
P.sim.tapLast(U.sister, MSG.btn_expense);
check(P.sim.button(P.last(U.sister), '📱 ဖုန်းဘေလ်') === 'EC|phone' && same(P.datas(P.last(U.sister)).slice(-1)[0], ['LA|ec|EC', 'Z']), 'the other lists still come from Settings (the fallback is per list)');
P.tapData(U.sister, 'Z');
const Q = bench({ legacy: true });
Q.sim.start(U.sister, '');
Q.sim.tapLast(U.sister, MSG.btn_accounts);
check(Q.lastText(U.sister) === [MSG.acct_title, t(Q.ports, 'acct_line', { label: 'KBZPay', detail: '—' }), t(Q.ports, 'acct_line', { label: 'WavePay', detail: '—' }), t(Q.ports, 'acct_line', { label: 'ဘဏ်လွှဲ', detail: '—' })].join('\n'),
  'the accounts screen lists the Settings accounts', Q.lastText(U.sister));
Q.tapData(U.sister, 'LD|pm|WAVE');
Q.sim.text(U.sister, '09 444 555666');
check(same(Q.world.lists.map(r => r.key + ':' + r.detail), ['CASH:', 'KBZ:', 'WAVE:09 444 555666', 'BANK:']) && Q.lastText(U.sister).indexOf(t(Q.ports, 'acct_line', { label: 'WavePay', detail: '09 444 555666' })) >= 0,
  'the first number entry seeds the list too and stores the number on its row', Q.world.lists.map(r => r.key + ':' + r.detail));

/* ============================== 9d. fixes after the review of the build ============================== */

step('9d. ➕ tapped on a screen a 🏦 tap already committed: the card stays (expense, delivery, refund)');
{
  const R = bench();
  const scr = R.expenseToMethod(U.sister, 'rent', 50000);
  R.sim.tap(U.sister, scr.id, 'EM|KBZ');
  const gE = R.lastRow().groupId, textE = scr.text, kbE = JSON.stringify(R.datas(scr)), botsE = R.bots(U.sister).length, listsE = R.world.lists.length, rowsE = R.world.ledger.length;
  R.sim.tap(U.sister, scr.id, 'LA|pm|EM');            // the ➕ of the old screen, tapped before the redraw reached the phone
  check(R.lastRow().type === 'EXPENSE' && scr.text === textE && JSON.stringify(R.datas(scr)) === kbE && R.flat(scr).indexOf('U|' + gE) >= 0 && R.flat(scr).indexOf('EN|' + gE) >= 0,
    'the committed expense card keeps its text, undo and note buttons (never edited into the name prompt)', [scr.text, R.datas(scr)]);
  check(R.bots(U.sister).length === botsE + 1 && R.lastText(U.sister) === MSG.expired && R.state(U.sister) === null, 'the late ➕ answers "expired" as a new message and asks no name', R.lastText(U.sister));
  R.sim.text(U.sister, 'CB Bank');
  check(R.world.lists.length === listsE && R.world.ledger.length === rowsE, 'a name typed afterwards adds no account and writes no second expense');

  const oidD = R.orderWithAdvance(U.sister, 'ဒေါ်မြင့်', 0);
  R.sim.text(U.sister, oidD);
  R.sim.tapLast(U.sister, MSG.btn_deliver);
  R.tapData(U.sister, 'ODP|' + oidD + '|all|0');
  const dmD = R.last(U.sister);
  R.sim.tap(U.sister, dmD.id, 'ODM|' + oidD + '|KBZ|150000|0');
  const textD = dmD.text;
  R.sim.tap(U.sister, dmD.id, 'LA|pm|ODM|' + oidD + '|150000|0');
  check(R.ports.store.getOrder(oidD).status === 'DELIVERED' && dmD.text === textD && R.flat(dmD).indexOf('U|' + oidD) >= 0 && R.flat(dmD).indexOf('RCP|' + oidD) >= 0 &&
    R.lastText(U.sister) === MSG.expired && R.state(U.sister) === null, 'the delivery receipt keeps its undo and PDF buttons; the late ➕ says expired', [dmD.text.split('\n')[0], R.datas(dmD)]);

  const oidX = R.orderWithAdvance(U.owner, 'ဒေါ်မြင့်', 50000);
  R.sim.text(U.owner, oidX);
  R.tapData(U.owner, 'OX|' + oidX);
  R.tapData(U.owner, 'OXR|' + oidX + '|refund');
  const rmX = R.last(U.owner);
  R.sim.tap(U.owner, rmX.id, 'OXM|' + oidX + '|CASH');
  const textX = rmX.text;
  R.sim.tap(U.owner, rmX.id, 'LA|pm|OXM|' + oidX);
  check(R.ports.store.getOrder(oidX).status === 'CANCELLED' && rmX.text === textX && R.flat(rmX).some(d => /^U\|/.test(d)) && R.lastText(U.owner) === MSG.expired,
    'the refund card keeps its undo button; the late ➕ says expired', [rmX.text, R.datas(rmX)]);
  // The screens before the commit still become the prompt (the delivery paid screen turns into the method screen on the same message).
  const oidP = R.orderWithAdvance(U.sister, 'ဒေါ်မြင့်', 0);
  R.sim.text(U.sister, oidP);
  R.sim.tapLast(U.sister, MSG.btn_deliver);
  R.tapData(U.sister, 'ODP|' + oidP + '|all|0');
  const dmP = R.last(U.sister);
  R.sim.tap(U.sister, dmP.id, 'LA|pm|ODM|' + oidP + '|150000|0');
  check(dmP.text === MSG.add_ask_pm && R.state(U.sister).purpose === 'add_option', 'a method screen nobody committed is still edited into the prompt', dmP.text);
  R.tapData(U.sister, 'Z');
}

step('9e. An amount is never an account name: "5000 ကျပ်", "10k", a spoken "တစ်သောင်း" ask again');
{
  const R = bench();
  const s = R.sell(U.sister, 'S1-0002'), lists0 = R.world.lists.length;
  R.sim.tap(U.sister, s.card.id, 'LA|pm|PM|' + s.g);
  ['5000 ကျပ်', '10k', '၅၀၀၀ ကျပ်'].forEach(v => R.sim.text(U.sister, v));
  check(R.lastText(U.sister) === MSG.add_ask_pm && R.state(U.sister).purpose === 'add_option' && R.world.lists.length === lists0 && R.liveOf(s.g)[0].method === 'CASH',
    'typed amounts: the prompt again, the state kept, no option, the sale stays cash', [R.lastText(U.sister), R.liveOf(s.g)[0].method]);
  R.sim.voice(U.sister, 'တစ်သောင်း');
  check(R.lastText(U.sister) === MSG.add_ask_pm && R.state(U.sister).purpose === 'add_option' && R.world.lists.length === lists0 && R.liveOf(s.g)[0].method === 'CASH',
    'a spoken amount in words: the prompt again, nothing added, the sale stays cash', R.lastText(U.sister));
  R.sim.text(U.sister, 'KBZ ဦးမောင်');
  check(R.world.lists.length === lists0 + 1 && R.liveOf(s.g)[0].method === (R.accounts().filter(r => r.label === 'KBZ ဦးမောင်')[0] || {}).key, 'then the real name is added and the sale is marked with it');
}

step('9f. An SXA on an older amount screen does not wipe the flow the seller is in now');
{
  const R = bench();
  const s = R.sell(U.sister, 'S1-0002');
  R.sim.tap(U.sister, s.card.id, 'SX|' + s.g);
  R.tapData(U.sister, 'SXM|' + s.g + '|KBZ');
  const amountScr = R.last(U.sister);
  const expScr = R.expenseToMethod(U.sister, 'rent', 5000);
  const n0 = R.world.ledger.length;
  R.sim.tap(U.sister, amountScr.id, 'SXA|' + s.g + '|KBZ|half');
  const rows = R.world.ledger.slice(n0);
  check(rows.length === 3 && rows[2].type === 'PAYMENT' && rows[2].cash === 9000 && same(R.state(U.sister), { kind: 'exp', step: 'method', draft: { shop: 'S1', cat: 'rent', amount: 5000 } }),
    'the split is written and the expense draft waiting for its method is still there', R.state(U.sister));
  R.sim.tap(U.sister, expScr.id, 'EM|CASH');
  check(R.lastRow().type === 'EXPENSE' && R.lastRow().amount === -5000 && R.lastRow().category === 'rent', 'the expense screen still commits');
  // A refused SXA (the sale was undone meanwhile) leaves the current flow alone too.
  const s2 = R.sell(U.sister, 'S1-0005');
  R.sim.tap(U.sister, s2.card.id, 'SX|' + s2.g);
  R.tapData(U.sister, 'SXM|' + s2.g + '|KBZ');
  const amountScr2 = R.last(U.sister);
  R.sim.tap(U.sister, s2.card.id, 'U|' + s2.g);
  R.expenseToMethod(U.sister, 'food', 3000);
  const n1 = R.world.ledger.length;
  R.sim.tap(U.sister, amountScr2.id, 'SXA|' + s2.g + '|KBZ|all');
  check(R.world.ledger.length === n1 && amountScr2.text.indexOf(MSG.undo_already) >= 0 && same(R.state(U.sister), { kind: 'exp', step: 'method', draft: { shop: 'S1', cat: 'food', amount: 3000 } }),
    'a refused SXA (the sale was undone) edits its own question into the refusal, writes nothing and keeps the expense draft', [amountScr2.text, R.state(U.sister)]);
}

step('9g. A spoken new category name that sounds like an expense ("ရေဖိုး") is the name, not an expense without an amount');
{
  const R = bench();
  R.sim.start(U.sister, '');
  R.sim.tapLast(U.sister, MSG.btn_expense);
  const grid = R.last(U.sister), lists0 = R.world.lists.length;
  R.sim.tap(U.sister, grid.id, 'LA|ec|EC');
  R.sim.voice(U.sister, 'ရေဖိုး');
  const water = R.world.lists.filter(r => r.list === 'expense_category' && r.label === 'ရေဖိုး')[0];
  check(!!water && R.world.lists.length === lists0 + 1 && R.lastText(U.sister) === t(R.ports, 'add_done', { label: 'ရေဖိုး' }) + '\n' + t(R.ports, 'exp_ask_amount', { cat: 'ရေဖိုး' }) &&
    R.state(U.sister).kind === 'exp' && R.state(U.sister).step === 'amount' && R.state(U.sister).draft.cat === water.key,
    'the category is added and the amount screen for it follows', R.lastText(U.sister));
  R.tapData(U.sister, 'Z');
  const staffS = R.ports.store.getStaff(String(U.sister.id)), msgS = { chat: { id: U.sister.id, type: 'private' }, from: { id: U.sister.id }, message_id: 0 };
  const addState = { kind: 'await_text', purpose: 'add_option', list: 'expense_category', resume: { a: 'XX', args: [] }, saved: null };
  setState(R.ports, String(U.sister.id), addState);
  handleIntent({ intent: 'EXPENSE', amount: null, category: 'ဆိုင်ငှားခ', transcript: 'ဆိုင်ငှားခ', confidence: 0.9 }, msgS, staffS, 'r9g-1', R.ports, CFG.SOURCE.VOICE, { state: addState });
  check(R.world.lists.some(r => r.list === 'expense_category' && r.label === 'ဆိုင်ငှားခ') && R.lastText(U.sister) === t(R.ports, 'add_done', { label: 'ဆိုင်ငှားခ' }),
    'a model answer EXPENSE without an amount: the transcript is the new category', R.lastText(U.sister));
  check(isMoneyIntent({ intent: 'EXPENSE', amount: 30000, confidence: 0.9 }) && isMoneyIntent({ intent: 'SALE', qty: 1, confidence: 0.9 }) && !isMoneyIntent({ intent: 'SALE', confidence: 0.9 }) &&
    isMoneyIntent({ intent: 'TRANSFER', item_hint: 'ပိုးထည်', confidence: 0.9 }) && !isMoneyIntent({ intent: 'ORDER', item_hint: 'ဝမ်းဆက်', confidence: 0.9 }) &&
    isMoneyIntent({ intent: 'ORDER', customer: 'ဒေါ်မြင့်', confidence: 0.9 }) && !isMoneyIntent({ intent: 'PAYMENT', confidence: 0.9 }) && !isMoneyIntent({ intent: 'EXPENSE', amount: 5000, confidence: 0.5 }),
    'isMoneyIntent: sure AND carrying what the entry needs (a number; an item for a transfer; a customer for an order)');
}

step('9h. The split by voice: a spoken cash part ("ငွေသား ငါးထောင်") is the cash, the rest goes to the account');
{
  const R = bench();
  let s = R.sell(U.sister, 'S1-0002');
  let n0 = R.world.ledger.length;
  R.sim.tap(U.sister, s.card.id, 'SX|' + s.g);
  R.tapData(U.sister, 'SXM|' + s.g + '|KBZ');
  R.sim.voice(U.sister, 'ငွေသား ငါးထောင်');
  let rows = R.world.ledger.slice(n0);
  check(rows.length === 3 && rows[1].type === 'SALE' && rows[1].cash === 5000 && rows[1].method === 'CASH' && rows[2].type === 'PAYMENT' && rows[2].cash === 13000 && rows[2].method === 'KBZ' &&
    R.lastText(U.sister).indexOf(t(R.ports, 'split_done', { cash: '5,000', cashMethod: 'ငွေသား', bank: '13,000', method: 'KBZPay' })) >= 0,
    'cash 5,000 and KBZ 13,000 (not the other way round)', rows.map(r => [r.type, r.cash, r.method]));
  s = R.sell(U.sister, 'S1-0002');
  n0 = R.world.ledger.length;
  R.sim.tap(U.sister, s.card.id, 'SX|' + s.g);
  R.tapData(U.sister, 'SXM|' + s.g + '|KBZ');
  R.sim.voice(U.sister, 'KBZ နဲ့ ငါးထောင်');
  rows = R.world.ledger.slice(n0);
  check(rows.length === 3 && rows[1].cash === 13000 && rows[2].cash === 5000 && rows[2].method === 'KBZ', 'an amount said with the account (or with no method word) is the account part, as before', rows.map(r => [r.type, r.cash, r.method]));
  const staffS = R.ports.store.getStaff(String(U.sister.id)), msgS = { chat: { id: U.sister.id, type: 'private' }, from: { id: U.sister.id }, message_id: 0 };
  s = R.sell(U.sister, 'S1-0002');
  R.sim.tap(U.sister, s.card.id, 'SX|' + s.g);
  R.tapData(U.sister, 'SXM|' + s.g + '|KBZ');
  n0 = R.world.ledger.length;
  handleIntent({ intent: 'PAYMENT', amount: 18000, method: 'CASH', transcript: 'ငွေသား တစ်သောင်းရှစ်ထောင်', confidence: 0.9 }, msgS, staffS, 'r9h-1', R.ports, CFG.SOURCE.VOICE, buildAiContext(R.ports, staffS, String(U.sister.id)));
  check(R.world.ledger.length === n0 && R.lastText(U.sister) === t(R.ports, 'split_bad', { max: '18,000' }) && R.state(U.sister).purpose === 'split_bank',
    'a cash part that leaves nothing for the account: asked again, nothing written, the state kept', R.lastText(U.sister));
  handleIntent({ intent: 'PAYMENT', amount: 6000, method: 'CASH', transcript: 'ငွေသား ခြောက်ထောင်', confidence: 0.9 }, msgS, staffS, 'r9h-2', R.ports, CFG.SOURCE.VOICE, buildAiContext(R.ports, staffS, String(U.sister.id)));
  rows = R.world.ledger.slice(n0);
  check(rows.length === 3 && rows[1].cash === 6000 && rows[2].cash === 12000 && rows[2].method === 'KBZ', 'a model answer with method CASH: cash 6,000, KBZ 12,000', rows.map(r => [r.type, r.cash, r.method]));
}

/* ============================== 9i-9k. the measurement hooks (section 9.2, step 4) ============================== */

step('9i. Measurement hooks on the Telegram bot (no ports.ui): the menu, the customer card, MS, M|meas and a typed or spoken name work as before');
{
  const H = bench();
  const C1 = H.world.customers.filter(c => c.name === 'ဒေါ်မြင့်')[0].id, C2 = H.world.customers.filter(c => c.name === 'ဒေါ်ခင်')[0].id;
  const staffH = H.ports.store.getStaff(String(U.sister.id)), msgH = { chat: { id: U.sister.id, type: 'private' }, from: { id: U.sister.id }, message_id: 0 };
  check(!('ui' in H.ports) && !measureFormEnabled(H.ports) && ordersEnabled(H.ports) && measureEnabled(H.ports), 'the bot: no ports.ui, the order module on (measureEnabled = ordersEnabled)');
  H.sim.start(U.sister, '');
  let menu = H.last(U.sister);
  check(menu.keyboard.slice(0, 3).every(r => r.length === 3) && menu.keyboard[3][0].callback_data === 'M|ord' && H.flat(menu).indexOf('M|meas') < 0, 'the menu: orders in the fourth row, no separate measure button', H.datas(menu));
  H.sim.tapLast(U.sister, MSG.btn_customers);
  H.tapData(U.sister, 'CH|' + C1);
  const card = H.last(U.sister);
  check(same(H.datas(card).slice(-1)[0], ['MS|' + C1]) && same(H.datas(card).slice(0, 2).map(r => r.length), [H.datas(card)[0].length, 2]) && H.flat(card).indexOf('CF|' + C1) >= 0 && H.flat(card).indexOf('CS|' + C1) >= 0,
    'the customer card keeps its rows and gains 📏 = MS|<customerId> as its last row', H.datas(card));
  // Fix round (review finding: the check above compares the first row's length with itself). The two rows of before round 4,
  // built the way customerCard of the backup builds them: [💰 PY|<group> or PL|<customer> while something is owed, 📥 DC|<customer>], [CF, CS].
  const owedC1 = customerSummary(H.ports, C1).owed, creditsC1 = openCredits(H.ports, null).filter(x => x.customerId === C1);
  const row0C1 = (owedC1 > 0 ? [creditsC1.length === 1 ? 'PY|' + creditsC1[0].groupId : 'PL|' + C1] : []).concat(['DC|' + C1]);
  check(same(H.datas(card), [row0C1, ['CF|' + C1, 'CS|' + C1], ['MS|' + C1]]) && H.texts(card)[0].slice(-1)[0] === MSG.btn_deposit && (owedC1 <= 0 || H.texts(card)[0][0] === MSG.btn_pay),
    'the customer card\'s first two rows are exactly those of before round 4 (💰 while owed, 📥 deposit; 📞, 📄), then 📏', { rows: H.datas(card), owed: owedC1 });
  H.sim.tap(U.sister, card.id, 'MS|' + C1);
  let st = H.state(U.sister);
  check(st && st.kind === 'meas' && st.step === 'method' && H.lastText(U.sister).indexOf(t(H.ports, 'ms_title', { customer: 'ဒေါ်မြင့်' })) === 0 && H.flat(H.last(U.sister)).some(d => /^MM\|[0-9a-f]{10}\|(photo|copy)$/.test(d)),
    'MS|<customerId> starts the Telegram measurement flow (title, a token, the method row)', H.lastText(U.sister));
  H.tapData(U.sister, 'Z');
  H.sim.start(U.sister, '');
  H.tapData(U.sister, 'M|meas');
  check(H.lastText(U.sister) === MSG.credit_ask_customer && same(H.state(U.sister), { kind: 'meas_pick' }) && H.flat(H.last(U.sister)).indexOf('MS|new') >= 0, 'M|meas still asks who is measured');
  H.sim.text(U.sister, 'ဒေါ်ခင်');
  st = H.state(U.sister);
  check(st && st.kind === 'meas' && H.lastText(U.sister).indexOf(t(H.ports, 'ms_title', { customer: 'ဒေါ်ခင်' })) === 0, 'a typed name in meas_pick: the Telegram flow for that customer', H.lastText(U.sister));
  H.tapData(U.sister, 'Z');
  H.sim.start(U.sister, '');
  H.tapData(U.sister, 'M|meas');
  handleIntent({ intent: 'UNKNOWN', transcript: 'ဒေါ်မြင့်', confidence: 0.2 }, msgH, staffH, 'r9i-1', H.ports, CFG.SOURCE.VOICE, buildAiContext(H.ports, staffH, String(U.sister.id)));
  st = H.state(U.sister);
  check(st && st.kind === 'meas' && H.lastText(U.sister).indexOf(t(H.ports, 'ms_title', { customer: 'ဒေါ်မြင့်' })) === 0, 'a spoken name in meas_pick (handleIntent\'s transcript section): the same', H.lastText(U.sister));
  H.tapData(U.sister, 'Z');
  // A store without the order module and no form: nothing to measure with, as before.
  const listOrders = H.ports.store.listOrders;
  delete H.ports.store.listOrders;
  H.sim.start(U.sister, '');
  menu = H.last(U.sister);
  check(!ordersEnabled(H.ports) && !measureEnabled(H.ports) && H.flat(menu).indexOf('M|ord') < 0 && H.flat(menu).indexOf('M|meas') < 0 && H.flat(menu).indexOf('M|acct') >= 0, 'no order module, no form: neither orders nor a measure button in the menu', H.datas(menu));
  const bots0 = H.bots(U.sister).length;
  H.tapData(U.sister, 'M|meas');
  check(H.bots(U.sister).length === bots0 && H.state(U.sister) === null, 'M|meas does nothing there');
  H.sim.tapLast(U.sister, MSG.btn_customers);
  H.tapData(U.sister, 'CH|' + C1);
  const card2 = H.last(U.sister);
  check(H.flat(card2).every(d => !/^MS\|/.test(d)) && H.datas(card2).length === 2, 'the customer card has no measure button', H.datas(card2));
  H.sim.tap(U.sister, card2.id, 'MS|' + C1);
  check(card2.text === MSG.expired && H.state(U.sister) === null, 'MS answers expired, as every order action does without the module');
  H.ports.store.listOrders = listOrders;
}

step('9j. With ports.ui.measureForm (the app\'s hook) the form opens first: no token, no latestMeasurement, the state cleared; orders still win the menu');
{
  const H = bench();
  const C1 = H.world.customers.filter(c => c.name === 'ဒေါ်မြင့်')[0].id;
  const calls = [], put = H.ports.cache.put, msKeys = [];
  let lmCalls = 0;
  const lm = H.ports.store.listMeasurements;
  H.ports.store.listMeasurements = cid => { lmCalls++; return lm(cid); };
  H.ports.cache.put = (k, v, ttl) => { if (/^ms:/.test(k)) msKeys.push(k); return put(k, v, ttl); };
  H.ports.ui = { measureForm: req => { calls.push(req); return 'form'; } };
  check(measureFormEnabled(H.ports) && ordersEnabled(H.ports) && measureEnabled(H.ports), 'the order module and the form hook both present');
  H.sim.start(U.sister, '');
  check(H.last(U.sister).keyboard[3][0].callback_data === 'M|ord' && H.flat(H.last(U.sister)).indexOf('M|meas') < 0, 'with the order module on, the menu keeps the orders button (M|meas appears only without it)');
  H.sim.tapLast(U.sister, MSG.btn_customers);
  H.tapData(U.sister, 'CH|' + C1);
  const card = H.last(U.sister), bots0 = H.bots(U.sister).length;
  H.sim.tap(U.sister, card.id, 'MS|' + C1);
  check(calls.length === 1 && same(calls[0], { chatId: U.sister.id, uid: String(U.sister.id), customerId: C1, orderId: '', staff: H.ports.store.getStaff(String(U.sister.id)) }) &&
    msKeys.length === 0 && lmCalls === 0 && H.state(U.sister) === null && H.bots(U.sister).length === bots0,
    'MS|<customerId>: ONE measureForm call {chatId, uid, customerId, orderId: \'\', staff}; no ms: token, no latestMeasurement, no state, no message', calls[0]);
  const oid = H.newOrder(U.sister, 'ဒေါ်မြင့်', 'TSL-0018');
  H.tapData(U.sister, 'Z');
  H.sim.start(U.sister, '');
  H.tapData(U.sister, 'MS|' + oid);
  check(calls.length === 2 && calls[1].orderId === oid && calls[1].customerId === H.world.orders.filter(o => o.id === oid)[0].customerId && msKeys.length === 0, 'MS|<orderId> with the order module: the form for the order\'s customer, with the order id', calls[1]);
  H.sim.start(U.sister, '');
  H.tapData(U.sister, 'M|meas');
  H.sim.text(U.sister, 'ဒေါ်ခင်');
  check(calls.length === 3 && calls[2].customerId === H.world.customers.filter(c => c.name === 'ဒေါ်ခင်')[0].id && H.state(U.sister) === null, 'M|meas and a typed name end in the form too');
  delete H.ports.ui;
  H.ports.cache.put = put;
  H.ports.store.listMeasurements = lm;
  H.sim.start(U.sister, '');
  H.tapData(U.sister, 'MS|' + C1);
  check(calls.length === 3 && H.state(U.sister) && H.state(U.sister).kind === 'meas' && lmCalls === 0, 'the hook removed: the Telegram flow again');
  H.tapData(U.sister, 'Z');
}

step('9k. The form hook without the order module (the app): M|meas in the menu, MS|new / create / <customerId> open the form; order ids and other actions expire');
{
  const H = bench();
  const C1 = H.world.customers.filter(c => c.name === 'ဒေါ်မြင့်')[0].id, C2 = H.world.customers.filter(c => c.name === 'ဒေါ်ခင်')[0].id;
  const staffH = H.ports.store.getStaff(String(U.sister.id)), msgH = { chat: { id: U.sister.id, type: 'private' }, from: { id: U.sister.id }, message_id: 0 };
  const listOrders = H.ports.store.listOrders, calls = [];
  delete H.ports.store.listOrders;
  H.ports.ui = { measureForm: req => { calls.push(req); } };
  check(!ordersEnabled(H.ports) && measureFormEnabled(H.ports) && measureEnabled(H.ports), 'the app\'s situation: the form hook, no order module');
  H.sim.start(U.sister, '');
  const menu = H.last(U.sister);
  check(menu.keyboard.slice(0, 3).every(r => r.length === 3) && same(menu.keyboard[3].map(b => b.callback_data)[0], 'M|meas') && menu.keyboard[3][0].text === MSG.btn_measure && H.flat(menu).indexOf('M|acct') >= 0,
    'the menu\'s fourth row starts with 📏 = M|meas', H.datas(menu));
  H.sim.tapLast(U.sister, MSG.btn_measure);
  check(H.lastText(U.sister) === MSG.credit_ask_customer && same(H.state(U.sister), { kind: 'meas_pick' }), 'M|meas asks who is measured');
  H.sim.tapLast(U.sister, MSG.btn_new_customer);
  const parseText = H.ports.ai.parseText;
  let aiTexts = 0;
  H.ports.ai.parseText = (text, ctx) => { aiTexts++; return parseText(text, ctx); };
  H.sim.text(U.sister, 'ဒေါ်စုစု');
  H.ports.ai.parseText = parseText;
  const susu = H.world.customers.filter(c => c.name === 'ဒေါ်စုစု')[0];
  check(calls.length === 1 && susu && calls[0].customerId === susu.id && calls[0].orderId === '' && H.state(U.sister) === null && aiTexts === 0,
    'MS|new and a typed new name: the customer is created and the form opens, without asking the AI (the app queues AI calls)');
  H.sim.start(U.sister, '');
  H.sim.tapLast(U.sister, MSG.btn_measure);
  H.sim.tapLast(U.sister, MSG.btn_new_customer);
  H.sim.text(U.sister, 'မြင့်');
  check(calls.length === 1 && H.flat(H.last(U.sister)).indexOf('MS|create') >= 0 && H.flat(H.last(U.sister)).indexOf('MS|' + C1) >= 0, 'a look-alike name offers the existing customer and "create"');
  H.tapData(U.sister, 'MS|create');
  check(calls.length === 2 && H.world.customers.some(c => c.name === 'မြင့်' && c.id === calls[1].customerId), 'MS|create: a new customer, the form for them');
  H.sim.start(U.sister, '');
  H.sim.tapLast(U.sister, MSG.btn_measure);
  handleIntent({ intent: 'UNKNOWN', transcript: 'ဒေါ်ခင်', confidence: 0.2 }, msgH, staffH, 'r9k-1', H.ports, CFG.SOURCE.VOICE, buildAiContext(H.ports, staffH, String(U.sister.id)));
  check(calls.length === 3 && calls[2].customerId === C2, 'a spoken name in meas_pick: the form for that customer');
  H.sim.start(U.sister, '');
  H.sim.tapLast(U.sister, MSG.btn_customers);
  H.tapData(U.sister, 'CH|' + C1);
  check(same(H.datas(H.last(U.sister)).slice(-1)[0], ['MS|' + C1]), 'the customer card offers 📏');
  H.tapData(U.sister, 'MS|' + C1);
  check(calls.length === 4 && calls[3].customerId === C1, 'MS|<customerId>: the form');
  H.sim.start(U.sister, '');
  H.tapData(U.sister, 'MS|V1-2532');
  check(calls.length === 4 && H.lastText(U.sister) === MSG.expired, 'MS|<orderId> needs the order module: expired, no form');
  H.sim.start(U.sister, '');
  const m2 = H.last(U.sister);
  H.sim.tap(U.sister, m2.id, 'MM|abcdef1234|copy');
  check(m2.text === MSG.expired, 'any other measurement action: expired');
  H.sim.start(U.sister, '');
  const m3 = H.last(U.sister);
  H.sim.tap(U.sister, m3.id, 'O|V1-2532');
  check(m3.text === MSG.expired && calls.length === 4, 'an order action: expired');
  check(H.world.errors.filter(e => e.where === 'handleUpdate').length === 0, 'no exception on the way');
  delete H.ports.ui;
  H.ports.store.listOrders = listOrders;
}

/* ============================== 9l. fix round: a ➕ or 🔢 prompt left open ============================== */

step('9l. A ➕ or 🔢 prompt left open: /start and the menu buttons close it, it lasts 10 minutes, a typed payment sentence later is never an account');
{
  const L9 = bench();
  const accts9 = () => payMethods(L9.ports, 'S1').join(',');
  const sentence = 'ဒေါ်မြ ၅၀၀၀ ပေးတယ်';
  L9.sim.start(U.sister, '');
  const menu9 = L9.last(U.sister);
  let s9 = L9.sell(U.sister, 'S1-0002');
  L9.sim.tap(U.sister, s9.card.id, 'LA|pm|PM|' + s9.g);
  check(L9.state(U.sister).purpose === 'add_option', 'the ➕ name prompt of a cash sale card is open');
  const a9 = accts9(), n9 = L9.world.ledger.length, lists9 = L9.world.lists.length;
  L9.sim.start(U.sister, '');
  check(L9.state(U.sister) === null, '/start closes it (no state was open when ➕ was tapped)');
  L9.tapData(U.sister, 'M|today');
  L9.sim.text(U.sister, sentence);
  check(accts9() === a9 && L9.world.lists.length === lists9 && L9.world.ledger.length === n9 && L9.liveOf(s9.g)[0].method === 'CASH' && L9.lastText(U.sister).indexOf(t(L9.ports, 'add_done', { label: sentence })) < 0,
    'a payment sentence typed afterwards: no account, the sale stays cash, nothing written (the usual proposal instead)', L9.lastText(U.sister));
  s9 = L9.sell(U.sister, 'S1-0003');
  L9.sim.tap(U.sister, s9.card.id, 'LA|pm|PM|' + s9.g);
  L9.sim.tap(U.sister, menu9.id, 'M|cust');
  check(L9.state(U.sister) === null, 'a menu button (here on an older menu message) closes it too');
  // ➕ on the expense method screen keeps the draft in the add state: /start brings the draft back, as the menu always kept it.
  const em9 = L9.expenseToMethod(U.sister, 'phone', 3000);
  L9.sim.tap(U.sister, em9.id, 'LA|pm|EM');
  L9.sim.start(U.sister, '');
  const back9 = L9.state(U.sister);
  check(back9 && back9.kind === 'exp' && back9.step === 'method' && back9.draft.amount === 3000, 'from the expense method screen: /start gives the expense draft back', back9);
  L9.tapData(U.sister, 'Z');
  // Every other state is kept through the menu, as before round 4.
  L9.sim.start(U.sister, '');
  L9.tapData(U.sister, 'M|find');
  L9.sim.start(U.sister, '');
  check(same(L9.state(U.sister), { kind: 'find' }), 'any other state (here 🔍 find) still survives /start');
  L9.tapData(U.sister, 'Z');
  // 🔢 left open: a menu button closes it; a phone number typed later is not the account number.
  L9.sim.start(U.sister, '');
  L9.sim.tapLast(U.sister, MSG.btn_accounts);
  L9.tapData(U.sister, 'LD|pm|KBZ');
  check(L9.state(U.sister).purpose === 'list_detail', 'the 🔢 prompt is open');
  const kbz9 = accountDetail(L9.ports, 'KBZ');
  L9.sim.tap(U.sister, menu9.id, 'M|cust');
  L9.sim.text(U.sister, '09 7777 12345');
  check(L9.state(U.sister) === null && accountDetail(L9.ports, 'KBZ') === kbz9, 'after a menu button the typed number is not saved as the KBZ number', accountDetail(L9.ports, 'KBZ'));
  // The prompt lasts CFG.ADD_STATE_TTL_SEC (10 minutes), every other state CFG.STATE_TTL_SEC as before.
  s9 = L9.sell(U.sister, 'S1-0003');
  L9.sim.tap(U.sister, s9.card.id, 'LA|pm|PM|' + s9.g);
  L9.tick(9);
  check(L9.state(U.sister) && L9.state(U.sister).purpose === 'add_option', 'nine minutes later the ➕ prompt still waits');
  L9.tick(2);
  check(L9.state(U.sister) === null && CFG.ADD_STATE_TTL_SEC === 600 && CFG.STATE_TTL_SEC === 1800, 'eleven minutes later it is gone');
  L9.sim.start(U.sister, '');
  L9.tapData(U.sister, 'M|find');
  L9.tick(20);
  check(same(L9.state(U.sister), { kind: 'find' }), 'another state still lasts 30 minutes (20 minutes later it waits)');
  L9.tapData(U.sister, 'Z');
}

/* ============================== 10. callback sizes, the two-tap sale ============================== */

/* ============================== 9z. round 5: the quick/steps switch (SPEC-round-5.md 8.2) ============================== */

step('9z. Round 5: sale_flow = quick keeps the one-tap card, the split and the ➕ exactly as steps 1-3 assert; sale_flow = steps asks instead of writing');
{
  const Z = bench();
  // Every callback this world emits from here on, sent or edited (an edit replaces a keyboard, so the final chat alone cannot tell).
  const emittedZ = [];
  Z.world.listeners.push(evt => { if (evt.type === 'chat' && evt.message && evt.message.keyboard) evt.message.keyboard.forEach(row => row.forEach(x => emittedZ.push(String(x.callback_data || '')))); });
  check(Z.world.settings.sale_flow === 'quick' && saleFlow(Z.ports) === 'quick', 'bench() runs on sale_flow quick (seedSimWorld seeds it; the code default is form)');
  const sz = Z.sell(U.sister, 'S1-0002');
  check(same(Z.datas(sz.card), [['U|' + sz.g, 'RC|' + sz.g], ['CR|' + sz.g, 'CU|' + sz.g], ['PM|' + sz.g + '|KBZ', 'PM|' + sz.g + '|WAVE', 'PM|' + sz.g + '|BANK'], ['SX|' + sz.g, 'LA|pm|PM|' + sz.g]]) &&
    sz.row.type === 'SALE' && sz.row.itemId === 'S1-0002' && sz.row.cash === 18000 && sz.row.method === 'CASH',
    'quick: the sale card is exactly the one step 1 asserts (undo/receipt, credit/customer, three 🏦, [split, ➕]) and the SALE row is written at the tap', Z.datas(sz.card));
  Z.sim.tap(U.sister, sz.card.id, 'SX|' + sz.g);
  const qz = Z.last(U.sister);
  check(qz.id !== sz.card.id && qz.text === t(Z.ports, 'split_ask_bank', { cash: '18,000' }) && same(Z.datas(qz), [['SXM|' + sz.g + '|KBZ', 'SXM|' + sz.g + '|WAVE', 'SXM|' + sz.g + '|BANK'], ['LA|pm|SXM|' + sz.g], ['Z']]),
    'quick: the split path is exactly as step 2 asserts (a new split_ask_bank message with the SXM row, ➕ alone, Z)', Z.datas(qz));
  Z.tapData(U.sister, 'Z');
  const sz2 = Z.sell(U.sister, 'S1-0002');
  Z.sim.tap(U.sister, sz2.card.id, 'LA|pm|PM|' + sz2.g);
  const pz = Z.last(U.sister);
  check(pz.id !== sz2.card.id && pz.text === MSG.add_ask_pm && same(Z.datas(pz), [['Z']]) &&
    same(Z.state(U.sister), { kind: 'await_text', purpose: 'add_option', list: 'pay_method', resume: { a: 'PM', args: [sz2.g] }, saved: null }),
    'quick: the ➕ path is exactly as step 3 asserts (a new add_ask_pm message with Z; the add state resumes PM with no saved state)', Z.datas(pz));
  Z.tapData(U.sister, 'Z');
  check(emittedZ.length > 20 && emittedZ.indexOf('S|S1-0002|1') >= 0 && emittedZ.every(d => !/^(SS|SC)\|/.test(d) && !/^(NI|NC)\|/.test(d) && d.indexOf('LA|pm|SSA') < 0),
    'quick: no SS|, SC|, NI|, NC| or LA|pm|SSA button was ever emitted in this world (every keyboard sent or edited since the bench, the card button S|S1-0002|1 among them)',
    { count: emittedZ.length, guided: emittedZ.filter(d => /^(SS|SC)\|/.test(d) || d.indexOf('LA|pm|SSA') >= 0) });
  const Y = bench();
  Y.world.settings.sale_flow = 'steps';
  const nY = Y.world.ledger.length, lastY = Y.lastRow();
  const sy = Y.sell(U.sister, 'S1-0002');
  check(Y.world.ledger.length === nY && sy.row === lastY && sy.row.itemId !== 'S1-0002' && sy.card.edited === true &&
    sy.card.text.endsWith(t(Y.ports, 'sale_line_paid', { paid: '18,000', owed: '0' })) && Y.state(U.sister).kind === 'sale' && Y.state(U.sister).step === 'card',
    'form: sell() returns no row of its own (lastRow() is older than the tap); the card is edited into the review card and a sale state waits',
    { rows: Y.world.ledger.length - nY, text: sy.card.text });
  Y.tapData(U.sister, 'SS|S1-0002|z');
  check(Y.state(U.sister) === null && sy.card.text === cardText(Y.ports, Y.ports.store.getItem('S1-0002')) && Y.world.ledger.length === nY, 'form: ✖️ on the review card brings the item card back; still nothing written');
}

step('10. Every callback under 64 bytes; the two-tap sale unchanged');
const N = bench();
// The longest keys the lists allow (12 bytes for an account) under the longest ids: every screen of this file once more.
N.setAccounts([{ key: 'ABCDEFGHIJKL', label: 'Account with a twelve byte key' }, { key: 'KBZ', label: 'KBZPay' }]);
x = N.sell(U.sister, 'S1-0002');
N.sim.tap(U.sister, x.card.id, 'SX|' + x.g);
N.tapData(U.sister, 'SXM|' + x.g + '|ABCDEFGHIJKL');
check(N.flat(N.last(U.sister)).indexOf('SXA|' + x.g + '|ABCDEFGHIJKL|half') >= 0 && Buffer.byteLength('SXA|' + x.g + '|ABCDEFGHIJKL|half', 'utf8') === 58, 'the longest split callback (36-char group id, 12-byte key) is 58 bytes');
N.tapData(U.sister, 'Z');
N.world.lists.push({ list: 'pay_method', key: 'THIRTEENBYTES', label: 'too long a key', active: true, order: 20, shop: '', detail: '', note: '' });
x = N.sell(U.sister, 'S1-0002');
check(N.flat(x.card).every(d => d.indexOf('THIRTEENBYTES') < 0) && N.world.errors.some(e => e.where === 'pay_methods'), 'an account key over 12 bytes gets no button and is logged');
// Keys typed by hand in the Lists tab can be any length: a button whose callback data would pass 64 bytes is left out, the screen stays.
const key62 = new Array(63).join('k');
N.world.lists.push({ list: 'expense_category', key: key62, label: 'ကုဒ်ရှည်', active: true, order: 40, shop: '', detail: '', note: '' });
N.world.lists.push({ list: 'fabric', key: key62, label: 'ကုဒ်ရှည်အထည်', active: true, order: 40, shop: '', detail: '', note: '' });
N.world.lists.push({ list: 'pay_method', key: key62.toUpperCase(), label: 'ကုဒ်ရှည်ဘဏ်', active: true, order: 40, shop: '', detail: '', note: '' });
N.sim.start(U.sister, '');
N.sim.tapLast(U.sister, MSG.btn_expense);
check(N.flat(N.last(U.sister)).indexOf('EC|phone') >= 0 && N.flat(N.last(U.sister)).every(d => d.indexOf(key62) < 0) && same(N.datas(N.last(U.sister)).slice(-1)[0], ['LA|ec|EC', 'Z']),
  'a category key of 62 bytes: no button for it, the grid and its last row stay');
N.tapData(U.sister, 'Z');
const oid10 = N.newOrder(U.sister, 'ဒေါ်မြင့်', 'TSL-0018');
N.tapData(U.sister, 'OF|' + oid10 + '|ask');
check(N.flat(N.last(U.sister)).indexOf('OF|' + oid10 + '|k|f1') >= 0 && N.flat(N.last(U.sister)).every(d => d.indexOf(key62) < 0) && same(N.datas(N.last(U.sister)).slice(-1)[0], ['LA|fb|OF|' + oid10, 'Z']),
  'a fabric key of 62 bytes: no button for it, the fabric screen stays');
N.tapData(U.sister, 'Z');
N.sim.start(U.sister, '');
N.sim.tapLast(U.sister, MSG.btn_accounts);
check(N.lastText(U.sister).indexOf('ကုဒ်ရှည်ဘဏ်') >= 0 && N.flat(N.last(U.sister)).every(d => d.indexOf(key62.toUpperCase()) < 0) && N.flat(N.last(U.sister)).indexOf('LD|pm|KBZ') >= 0,
  'an account key of 62 bytes: listed, but without a 🔢 button (LD|pm|<key> would be 68 bytes)');
N.tapData(U.sister, 'Z');
check(maxCb.len > 0 && maxCb.len <= 64 && buttonsSeen > 500, 'every callback_data emitted in this file (' + buttonsSeen + ' buttons) is within 64 bytes (longest ' + maxCb.len + ': ' + maxCb.data + ')');
N.sim.start(U.sister, 'S1-0005');
const n10 = N.world.ledger.length, card10 = N.last(U.sister);
N.sim.tapLast(U.sister, MSG.btn_sell_one);
check(N.world.ledger.length === n10 + 1 && N.lastRow().type === 'SALE' && N.lastRow().qty === -1 && N.lastRow().cash === 22000 && N.lastRow().method === 'CASH' && card10.edited,
  'START + one tap still records a one-piece cash sale; nothing is asked before the commit');
check(worlds.every(w => w.errors.filter(e => e.where === 'handleUpdate').length === 0), 'no update of any world failed with an exception',
  worlds.map(w => w.errors.filter(e => e.where === 'handleUpdate').map(e => e.message)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
