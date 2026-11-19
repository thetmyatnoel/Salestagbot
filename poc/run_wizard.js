/**
 * poc/run_wizard.js — round 6, step 1 ("Core"), rewritten in place from round 5's guided sale (SPEC-round-6.md 10.1): the
 * Telegram sale review card (Settings sale_flow = form; round 5's steps reads as form), the basket write commitBasket,
 * the counted new piece and its review card, the restock group, the readers on a basket, the app hooks of the core, the
 * shared Save, round 6's texts; revision 3 (13.15): the app's pages in the core, the buyer checks, the view hints, the
 * measurement core, the AI switch and its texts. Same harness as poc/run_round4.js: the real core over in-memory ports,
 * a world seeded with seedSimWorld + simSeedLists with sale_flow set to steps (it reads as form; bench({quick: true})
 * leaves the seed's quick), a fixed clock (10:30 in Yangon, today) moved by hand, dates relative to that clock. Each
 * round-5 check is kept verbatim (V), re-asserted on the review card by a successor (W, the same label where the rule
 * survives) or dropped with the step machine (O), per the disposition table of SPEC-round-6.md 10.1. Every new check is
 * phrased so that it is red without its feature.
 *
 *   node poc/run_wizard.js
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
/** Run one numbered step: an exception (a helper that finds no button, a screen that is not there) is one failed check and the file goes on. */
function runStep(fn) {
  try { fn(); } catch (e) { check(false, 'this step ran to its end', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const U = SIM_USERS;
const BASE = new Date(dayKey(new Date()) + 'T04:00:00.000Z');   // 10:30 in Yangon, today
const today = dayKey(BASE);
const ITEM = 'S1-0002';   // the SKU of the examples: 18,000, 5 in stock
const bytes = s => Buffer.byteLength(String(s || ''), 'utf8');
const txt = (key, vars) => fill(MSG[key], vars || {});
const head = key => MSG[key].split('{')[0].trim();   // the label rule: a key's text up to its first placeholder
/** 'yyyy-mm-dd' as a seller types it: 'd.m.yy' and 'd.m' (no year). */
const dmy = key => { const p = key.split('-'); return Number(p[2]) + '.' + Number(p[1]) + '.' + p[0].slice(2); };
const dm = key => { const p = key.split('-'); return Number(p[2]) + '.' + Number(p[1]); };
const Q = s => 'SS|S1-0002|' + s;   // a review-card callback of the example piece

/**
 * core_sync.js and the server twin in a vm context of their own (the worlds of this file never load them), so the step-1
 * rules of the core's sync (spec 6.3, 13.7, 13.11, 13.12) are pinned here; run_sync R6f-R6i (step 2) drive them end to
 * end. extraShop adds a shop id to CFG.SHOP_IDS before core_sync.js loads (amendment F10b: nothing assumes two shops).
 */
const syncBoxes = {};
function syncSandbox(extraShop) {
  const k = extraShop || '-';
  if (syncBoxes[k]) return syncBoxes[k];
  const box = vm.createContext({ console, setTimeout, clearTimeout, Buffer });
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), box, { filename: f });
  load('apps-script/core_config.js');
  if (extraShop) vm.runInContext('CFG.SHOP_IDS.push(' + JSON.stringify(extraShop) + ');', box);
  ['apps-script/core_burmese.js', 'apps-script/core_messages.js', 'apps-script/core_ai_prompt.js', 'apps-script/core_ledger.js',
    'apps-script/core_report.js', 'apps-script/core_bot.js', 'apps-script/core_sync.js',
    'poc/sim_mock_ai.js', 'poc/sim_ports.js', 'poc/sim_seed.js', 'poc/sim_phone.js', 'poc/sim_sync.js'].forEach(load);
  syncBoxes[k] = box;
  return box;
}
/** A spreadsheet of poc/fake_gas.js running the bundle of tools/bundle_gas.js (as run_gas.js builds it), after one setupSheet().
 * extraShop adds a shop id to CFG.SHOP_IDS right after core_config.js (amendment F10b: nothing assumes two shops). */
function setupBook(extraShop) {
  const { createFakeGas } = require('./fake_gas.js');
  const list = /const FILES = (\[[\s\S]*?\]);/.exec(fs.readFileSync(path.join(ROOT, 'tools', 'bundle_gas.js'), 'utf8'));
  const files = Array.from(vm.runInNewContext('(' + list[1] + ')'));
  const source = files.map(f => '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8').trim() + '\n' +
    (extraShop && f === 'core_config.js' ? 'CFG.SHOP_IDS.push(' + JSON.stringify(extraShop) + ');\n' : '')).join('\n');
  const fake = createFakeGas({ source, filename: 'Code.gs' });
  fake.newExecution().setupSheet();
  return fake;
}

// Telegram rejects callback_data over 64 bytes. Watch every button every world of this file ever emits (sent or edited).
let maxCb = { len: 0, data: '' }, buttonsSeen = 0;
const worlds = [];
// Every edit of every world: {world, chatId, messageId, isCaption} (step 24 compares the flag with the target message).
const edits = [];

/**
 * A fresh world (seedSimWorld, then simSeedLists, then sale_flow = steps, which reads as form) with a fixed clock and the
 * helpers the steps use. bench({quick: true}) keeps the seed's quick; bench({legacy: true}) leaves the Lists tab empty.
 */
function bench(opts) {
  const world = createSimWorld();
  world.nowOverride = new Date(BASE.getTime());
  const editCount = {};
  world.listeners.push(evt => {
    if (evt.type !== 'chat' || !evt.message) return;
    if (evt.edited === true) editCount[evt.message.id] = (editCount[evt.message.id] || 0) + 1;
    if (!evt.message.keyboard) return;
    evt.message.keyboard.forEach(row => row.forEach(b => {
      buttonsSeen++;
      const len = bytes(b.callback_data);
      if (len > maxCb.len) maxCb = { len, data: b.callback_data };
    }));
  });
  const realEdit = world.ports.chat.editMessage;
  world.ports.chat.editMessage = function (chatId, messageId, text, keyboard, isCaption) {
    edits.push({ world, chatId, messageId, isCaption });
    return realEdit.call(this, chatId, messageId, text, keyboard, isCaption);
  };
  seedSimWorld(world);
  if (!(opts && opts.legacy)) simSeedLists(world);
  if (!(opts && opts.quick)) world.settings.sale_flow = 'steps';
  worlds.push(world);
  const { ports, sim } = world;
  const b = {
    world, ports, sim,
    last: u => sim.lastBot(u),
    lastText: u => (sim.lastBot(u) || {}).text || '',
    lastRow: () => world.ledger[world.ledger.length - 1],
    ledgerLen: () => world.ledger.length,
    state: u => getState(ports, String(u.id)),
    liveOf: g => liveRows(world.ledger.filter(r => r.groupId === g), world.ledger),
    rowsOf: g => world.ledger.filter(r => r.groupId === g),
    bots: u => (world.chats[u.id] || []).filter(m => m.from === 'bot'),
    datas: m => ((m && m.keyboard) || []).map(row => row.map(x => x.callback_data)),
    texts: m => ((m && m.keyboard) || []).map(row => row.map(x => x.text)),
    flat: m => ((m && m.keyboard) || []).reduce((a, row) => a.concat(row.map(x => x.callback_data)), []),
    tick: min => { world.nowOverride = new Date(world.nowOverride.getTime() + min * 60000); },
    tapData: (u, data) => sim.tap(u, sim.lastBot(u).id, data),
    tapKey: (u, key) => sim.tapLastByKey(u, key),
    editsOf: id => editCount[id] || 0,
    aiCalls: () => world.log.filter(e => e.kind === 'ai').length,
    errorsOf: where => world.errors.filter(e => !where || e.where === where),
    stats: shop => dayStats(ports, shop, today),
    net: (stats, key) => (stats.byMethod[key] ? stats.byMethod[key].in - stats.byMethod[key].out : 0),
    option: (list, key) => world.lists.filter(r => r.list === list && r.key === key)[0] || null,
    /** {text, datas, texts, id, message} of the last bot message. */
    screen(u) {
      const m = sim.lastBot(u);
      return { text: (m && m.text) || '', datas: b.datas(m), texts: b.texts(m), flat: b.flat(m), id: m && m.id, message: m };
    },
    /** Replace the pay_method rows of the Lists tab: CASH plus the given accounts (with their kind), in that order. */
    setAccounts(list) {
      const rows = [{ list: 'pay_method', key: 'CASH', label: MSG.method_CASH, active: true, order: 1, shop: '', detail: '', note: '' }];
      list.forEach((a, i) => {
        const row = { list: 'pay_method', key: a.key, label: a.label, active: a.active !== false, order: i + 2, shop: a.shop || '', detail: a.detail || '', note: '' };
        if (a.kind) row.kind = a.kind;
        rows.push(row);
      });
      world.lists = rows.concat(world.lists.filter(r => r.list !== 'pay_method'));
    },
    /** Scan the tag: the card is the last message. */
    scan(u, itemId) { sim.start(u, itemId); return sim.lastBot(u); },
    /**
     * Scan, tap the card's sell button (S|<id>|1: the card becomes the review card), then each answer: a string starting
     * with a callback prefix is tapped by data on the last bot message, a MSG key by the label rule (sim.buttonByKey),
     * {type} is typed, {voice} spoken. Returns the scanned card message.
     */
    card(u, itemId, answers) {
      const card = b.scan(u, itemId);
      sim.tap(u, card.id, sim.button(card, MSG.btn_sold) || sim.button(card, MSG.btn_sell_one));
      (answers || []).forEach(a => b.answer(u, a));
      return card;
    },
    answer(u, a) {
      if (a && typeof a === 'object' && a.type !== undefined) return sim.text(u, String(a.type));
      if (a && typeof a === 'object' && a.voice !== undefined) return sim.voice(u, String(a.voice));
      if (/^(SS|SC|LA|S|Q|QN|D|CD|U|RC|V|M|Z|NI|NC|P|C|PS|R|RQ|T|K|PA|PY|PL|DC|DA|DN|EM|EC|EA|CH|MM|MF|MK|MP|MS)\|/.test(a) || a === 'Z') return b.tapData(u, a);
      return sim.tapLastByKey(u, a);
    },
    answers(u, list) { list.forEach(a => b.answer(u, a)); }
  };
  return b;
}

const CARD_SOLD_ROWS = g => [['U|' + g, 'RC|' + g]];
/** The review card's rows of a basket of these item ids, paid in full (the 💳 row) or part (💳 now, 📅). */
const CARD_ROWS = (a, ids, part) => {
  const rows = [];
  for (let i = 0; i < ids.length; i += 2) rows.push(ids.slice(i, i + 2).map(id => 'SS|' + a + '|l|' + id));
  if (ids.length < CFG.BASKET_MAX_LINES) rows.push(['SS|' + a + '|add']);
  rows.push(['SS|' + a + '|o|buyer', 'SS|' + a + '|o|method']);
  rows.push(part ? ['SS|' + a + '|o|paid', 'SS|' + a + '|o|due'] : ['SS|' + a + '|o|paid']);
  rows.push(['SC|' + a + '|ok']);
  rows.push(['SS|' + a + '|z']);
  return rows;
};

/* ============================== 1. nothing before ✅ ============================== */

step('W1. Nothing before ✅: scan, ✅ ရောင်း ၁ shows the review card, ✅ သိမ်း writes one SALE row');
runStep(() => {
  const A = bench(), u = U.sister, n0 = A.ledgerLen(), c0 = A.world.customers.length;
  const card = A.scan(u, ITEM);
  A.answer(u, 'btn_sell_one');
  const s1 = A.screen(u);
  check(s1.id === card.id && card.edited === true && A.ledgerLen() === n0 && A.world.customers.length === c0,
    'the card itself is edited into the review card (same message id); nothing written', { id: s1.id, card: card.id, rows: A.ledgerLen() - n0 });
  const want = [txt('basket_title', { n: '၁' }), '1. 🧣 S1-0002 · လုံချည် ကချင် အပြာ × ၁ · 18,000', txt('basket_total', { total: '18,000' }), MSG.btn_no_name,
    txt('sale_line_method', { method: 'ငွေသား' }), txt('sale_line_paid', { paid: '18,000', owed: '0' })].join('\n');
  check(s1.text === want, 'the review card reads like its receipt: the title, the line, the total, 🚫 no name, 💰 cash, paid and owed (sale_line_paid last)', s1.text);
  check(same(s1.datas, CARD_ROWS(ITEM, [ITEM])) && s1.texts[s1.texts.length - 2][0] === MSG.btn_save && same(s1.texts[s1.texts.length - 1], [MSG.btn_cancel]),
    'the card rows: [1. line] [➕] [👤, 💰] [💳 မကျေသေး] [✅ သိမ်း] then ✖️ alone on its own row below Save', s1.datas);
  check(s1.flat.filter(d => /^SC\|/.test(d)).length === 1 && s1.texts.reduce((a, r) => a.concat(r), []).filter(x => x.indexOf('✅') === 0).length === 1,
    'the only ✅ on the card is Save (SC|S1-0002|ok)', s1.texts);
  const st = A.state(u);
  check(!!st && st.kind === 'sale' && st.step === 'card' && st.item === ITEM && st.msgId === card.id && st.cap === true && st.line === '' &&
    same(st.draft, { lines: [{ id: ITEM, qty: 1, unitPrice: 18000, priceChanged: false }] }) && st.hist === undefined,
    'state: kind sale, step card, the anchor S1-0002, msgId = the card (a photo: cap true), draft.lines [{S1-0002, 1, 18000}], no hist', st);
  A.answer(u, Q('o|buyer'));
  const sb = A.screen(u);
  check(sb.id === card.id && sb.text.endsWith(MSG.credit_ask_customer + '\n' + MSG.cust_find) && sb.text.indexOf(txt('basket_title', { n: '၁' }) + '\n' + txt('basket_total', { total: '18,000' })) === 0 &&
    A.ledgerLen() === n0, 'o|buyer opens the buyer sub-screen on the card\'s message: the basket head, then "who bought it" and the typing hint; nothing written', sb.text);
  const custRows = sb.datas.slice(1, -2);
  check(same(sb.datas[0], [Q('b|none')]) && custRows.length >= 1 && custRows.length <= 4 && custRows.every(r => r.length === 1 && /^SS\|S1-0002\|b\|C-/.test(r[0])) &&
    same(sb.datas[sb.datas.length - 2], [Q('b|new')]) && same(sb.datas[sb.datas.length - 1], [Q('back|buyer')]),
    'buyer rows: [🚫] [👤 ...] (up to four) [✏️ new name] [⏮ back|buyer] ALONE (no ✖️ on a sub-screen)', sb.datas);
  check(same(sb.texts[0], [MSG.btn_no_name]) && same(sb.texts[sb.texts.length - 1], [MSG.btn_back]), 'the texts are btn_no_name and btn_back alone', sb.texts);
  A.answer(u, Q('b|none'));
  check(A.screen(u).id === card.id && A.state(u).step === 'card' && A.screen(u).text === want, '🚫 returns to the card (nothing owed: basketNext goes straight back)', A.state(u));
  A.answer(u, 'SC|S1-0002|ok');
  const row = A.lastRow(), g = row.groupId;
  check(A.ledgerLen() === n0 + 1 && row.type === 'SALE' && row.qty === -1 && row.cash === 18000 && row.amount === 18000 && row.method === 'CASH' && row.customerId === '' && row.dueDay === '' && row.note === '',
    '✅ သိမ်း writes exactly one SALE row: qty -1, cash 18,000, CASH, no customer, no DueDay, no note', row);
  const s4 = A.screen(u);
  check(s4.id === card.id && s4.text.indexOf(txt('sold_done', { qty: '၁', amount: '18,000', stock: '၄' })) >= 0 && same(s4.datas, CARD_SOLD_ROWS(g)),
    'the card reads ရောင်းပြီး with [undo, receipt] only (no 💳 👤 🏦 💵+🏦 ➕)', s4.datas);
  check(A.state(u) === null && A.ports.cache.get('lg:' + u.id) === g && A.world.customers.length === c0, 'the state is cleared, lg:<uid> holds the group, no customer was created');
  // A typed amount never commits: the whole total typed after ✏️ အခြား returns to the card; a part goes to basketNext.
  const T = bench(), nT = T.ledgerLen();
  T.card(u, ITEM, [Q('o|paid'), Q('p|other')]);
  const sOther = T.screen(u);
  check(sOther.text.endsWith(MSG.ask_number) && same(sOther.datas, [[Q('back|paid')]]) && T.state(u).kind === 'await_number' && T.state(u).purpose === 'sale_step',
    '✏️ အခြား edits the paid sub-screen into ask_number with [⏮ back|paid] alone; a number state waits around the basket', sOther.datas);
  T.answer(u, { type: '18000' });
  const sAll = T.screen(u);
  check(sAll.id !== sOther.id && T.ledgerLen() === nT && T.state(u).kind === 'sale' && T.state(u).step === 'card' && !T.state(u).draft.part &&
    same(sAll.datas, CARD_ROWS(ITEM, [ITEM])),
    'typed 18000 (the whole total) → the card again as a new message, paid in full; a typed amount never commits', { text: sAll.text, datas: sAll.datas, rows: T.ledgerLen() - nT });
  T.answers(u, [Q('o|paid'), Q('p|other'), { type: '5000' }]);
  check(T.ledgerLen() === nT && T.state(u).step === 'buyer' && T.state(u).draft.part === true && T.state(u).draft.paid === 5000,
    'typed 5000 → a part payment: basketNext opens the buyer sub-screen (nobody named yet); still nothing written', T.state(u));
});

/* ============================== 2. the count ============================== */

step('W2. The count: the card\'s 🔢 grid (quick\'s), the line sub-screen, a typed count, a UNIQUE line');
runStep(() => {
  const A = bench(), Qk = bench({ quick: true }), u = U.sister;
  const item = A.ports.store.getItem(ITEM);
  check(same(cardKeyboard(A.ports, item), cardKeyboard(Qk.ports, item)) && same(A.datas(A.scan(u, ITEM))[0], ['S|S1-0002|1', 'Q|S1-0002']),
    'the SKU card keeps S|id|1 and Q|id: cardKeyboard is byte-identical in both modes', A.datas(A.last(u)));
  const card = A.last(u);
  A.answer(u, 'Q|S1-0002');
  const grid = A.screen(u);
  check(grid.id !== card.id && same(grid.datas, [['S|S1-0002|2', 'S|S1-0002|3', 'S|S1-0002|4', 'S|S1-0002|5'], ['S|S1-0002|6', 'S|S1-0002|7', 'S|S1-0002|8', 'S|S1-0002|9'], ['QN|S1-0002', 'Z']]) &&
    grid.text === MSG.ask_qty + '\n' + ITEM + ' · ' + item.name && A.state(u) === null,
    'Q|id in form mode is quick\'s askQty: a new message with S|id|2..9 and [✏️ QN, ✖️ Z], its text unchanged, no state', grid.datas);
  A.answer(u, 'S|S1-0002|3');
  let s = A.screen(u), st = A.state(u);
  check(s.id === grid.id && st.step === 'card' && same(st.draft.lines, [{ id: ITEM, qty: 3, unitPrice: 18000, priceChanged: false }]) && s.text.indexOf('× ၃ · 54,000') >= 0,
    'its ၃ (S|S1-0002|3) turns the grid into the review card with the line × ၃ · 54,000', { text: s.text, st });
  A.answer(u, Q('l|S1-0002'));
  s = A.screen(u);
  check(s.id === grid.id && A.state(u).step === 'line' && A.state(u).line === ITEM && s.text.endsWith('1. 🧣 S1-0002 · လုံချည် ကချင် အပြာ × ၃ · 54,000\n' + MSG.ask_qty) &&
    same(s.datas, [[Q('q|1'), Q('q|2'), Q('q|3'), Q('q|4')], [Q('q|5'), Q('q|6'), Q('q|7'), Q('q|8')], [Q('q|9')], [Q('qn'), Q('pr')], [Q('back|line')]]) &&
    same(s.texts[3], [MSG.btn_type_qty, MSG.btn_discount]),
    'l|S1-0002 opens the line sub-screen: its line, ask_qty, ၁..၉ (q|1..q|9), [✏️ qn, 💬 pr], [⏮ back|line] (no 🗑 on a one-line basket)', { text: s.text, datas: s.datas });
  A.answer(u, Q('q|2'));
  check(A.state(u).step === 'card' && A.state(u).draft.lines[0].qty === 2 && A.screen(u).id === grid.id, '၂ sets the line\'s count and returns to the card', A.state(u));
  const C = bench();
  C.card(u, ITEM, [Q('l|S1-0002'), Q('qn')]);
  s = C.screen(u);
  check(s.text.endsWith(MSG.ask_qty_number) && same(s.datas, [[Q('back|line')]]) && C.state(u).kind === 'await_number' && C.state(u).purpose === 'sale_qty' && C.state(u).saved.step === 'line',
    '✏️ edits the line sub-screen into ask_qty_number with [⏮ back|line] alone; the count state keeps the basket in saved', { text: s.text, datas: s.datas, st: C.state(u) });
  const promptId = s.id, ai0 = C.aiCalls();
  C.answer(u, { type: '4' });
  s = C.screen(u);
  check(s.id !== promptId && C.state(u).step === 'card' && C.state(u).draft.lines[0].qty === 4 && s.text.indexOf('× ၄ · 72,000') >= 0 && C.state(u).msgId === s.id && C.aiCalls() === ai0,
    'typed 4 after ✏️ → the card as a NEW message with the line × ၄ (no AI call)', s.text);
  const D = bench(), nD = D.ledgerLen();
  D.card(u, ITEM, [Q('l|S1-0002'), Q('qn'), { type: '0' }]);
  s = D.screen(u);
  check(s.text === txt('bad_qty', { max: '၉၉၉' }) && same(s.datas, [[Q('back|line')]]) && D.state(u) && D.state(u).purpose === 'sale_qty' && D.state(u).saved.msgId === s.id && D.ledgerLen() === nD,
    'typed 0 → bad_qty with the line\'s back row, the count state kept (its saved screen is now that message), nothing written', { text: s.text, st: D.state(u) });
  const B = bench();
  B.card(u, ITEM, [Q('l|S1-0002'), { type: '3' }]);
  check(B.state(u).step === 'card' && B.state(u).draft.lines[0].qty === 3, 'typed 3 on the line sub-screen (no ✏️) is its count too', B.state(u));
  const E = bench();
  E.card(u, 'S1-0001', ['SS|S1-0001|l|S1-0001']);
  s = E.screen(u);
  check(E.state(u).step === 'line' && s.flat.every(d => !/\|q\|/.test(d) && !/\|qn$/.test(d)) && same(s.datas, [['SS|S1-0001|pr'], ['SS|S1-0001|back|line']]) && s.text.indexOf(MSG.ask_qty) < 0,
    'a one-of-a-kind line (S1-0001) has no grid: only 💬 and ⏮', s.datas);
});

/* ============================== 3. a changed price ============================== */

step('W3. A changed price: 💬 on the item card (quick\'s prompt) opens the card with the bargained line; 💬 on a line');
runStep(() => {
  const A = bench(), u = U.sister, n0 = A.ledgerLen();
  const card = A.scan(u, ITEM);
  A.answer(u, 'btn_discount');
  let s = A.screen(u);
  check(s.id !== card.id && s.text === MSG.ask_sale_price && same(s.datas, [['Z']]) && A.state(u).kind === 'await_number' && A.state(u).purpose === 'sale_price' && !A.state(u).saved,
    '💬 on the card: quick\'s price prompt as a new message with [✖️ Z]; the price state waits', { text: s.text, datas: s.datas, st: A.state(u) });
  A.answer(u, { type: '15000' });
  s = A.screen(u);
  check(A.state(u).step === 'card' && same(A.state(u).draft.lines, [{ id: ITEM, qty: 1, unitPrice: 15000, priceChanged: true }]) && s.text.indexOf('× ၁ · 15,000 💬') >= 0 && A.ledgerLen() === n0,
    'typed 15000 → the review card (a new message) with the line at 15,000 marked 💬; nothing written', s.text);
  A.answers(u, [Q('l|S1-0002'), Q('q|2'), 'SC|S1-0002|ok']);
  const row = A.lastRow();
  check(A.ledgerLen() === n0 + 1 && row.qty === -2 && row.unitPrice === 15000 && row.amount === 30000 && row.cash === 30000 && row.note === 'price',
    '၂ on the line, ✅ → qty -2, unitPrice 15,000, amount 30,000, note price on that row', row);
  const B = bench();
  B.scan(u, 'S1-0001');
  B.answer(u, 'btn_discount');
  B.answer(u, { type: '20000' });
  check(B.state(u).step === 'card' && B.state(u).draft.lines[0].unitPrice === 20000 && B.screen(u).text.indexOf(txt('basket_total', { total: '20,000' })) >= 0,
    'on a UNIQUE piece the typed price opens the card at once (one piece at 20,000)', B.screen(u).text);
  const C = bench(), nC = C.ledgerLen();
  C.scan(u, ITEM);
  C.answer(u, 'btn_discount');
  C.answer(u, { type: '0' });
  s = C.screen(u);
  check(s.text === MSG.ask_sale_price && same(s.datas, [['Z']]) && C.state(u).purpose === 'sale_price' && C.ledgerLen() === nC,
    'typed 0 after 💬 → ask_sale_price again as a new message, the state set again, nothing written', { text: s.text, st: C.state(u) });
  const D = bench();
  D.card(u, ITEM, [Q('l|S1-0002'), Q('pr')]);
  s = D.screen(u);
  check(s.text.endsWith(MSG.ask_sale_price) && same(s.datas, [[Q('back|line')]]) && D.state(u).purpose === 'sale_price' && D.state(u).saved.step === 'line',
    '💬 on a line edits the line sub-screen into ask_sale_price with [⏮ back|line] (the basket rides in saved)', { text: s.text, datas: s.datas });
  D.answer(u, Q('back|line'));
  check(D.state(u).kind === 'sale' && D.state(u).step === 'line' && D.screen(u).text.endsWith(MSG.ask_qty), '⏮ there brings the line sub-screen back on the same message', D.state(u));
  D.answers(u, [Q('pr'), { type: '0' }]);
  check(D.screen(u).text === MSG.ask_sale_price && D.state(u).purpose === 'sale_price' && D.state(u).saved.draft.lines[0].unitPrice === 18000, 'a typed 0 there asks again; the line keeps its price', D.state(u));
  D.answer(u, { type: '16000' });
  check(D.state(u).step === 'card' && same(D.state(u).draft.lines[0], { id: ITEM, qty: 1, unitPrice: 16000, priceChanged: true }), 'a typed 16000 is the line\'s price; the card comes back', D.state(u).draft.lines);
});

/* ============================== 4. the buyer ============================== */

step('W4. Buyer (o|buyer): a typed name, look-alikes, a phone hint, a new name with a phone; every exit is basketNext');
runStep(() => {
  const u = U.sister, c0 = () => A.world.customers.length;
  let A = bench();
  A.card(u, ITEM, [Q('o|buyer'), { type: 'ဒေါ်မြင့်' }]);
  let s = A.screen(u);
  check(A.state(u).step === 'card' && s.text.indexOf(customerLabel(A.ports.store.getCustomer('C-0001'))) >= 0 && A.state(u).draft.customerId === 'C-0001' && A.world.customers.length === 2,
    'typed ဒေါ်မြင့် (exact) picks C-0001 (no new row) and returns to the card with her label', { text: s.text, st: A.state(u) });
  A = bench();
  A.card(u, ITEM, [Q('o|buyer'), { type: 'ဒေါ်မြ' }]);
  s = A.screen(u);
  check(s.text.endsWith(txt('cust_pick', { name: 'ဒေါ်မြ' })) && same(s.datas[0], [Q('b|C-0001')]) && same(s.datas[1], [Q('b|create')]) && same(s.texts[1], [txt('btn_create_named', { name: 'ဒေါ်မြ' })]) && same(s.datas[2], [Q('back|buyer')]),
    'typed ဒေါ်မြ → cust_pick with ဒေါ်မြင့် and "create ဒေါ်မြ", back|buyer alone', { text: s.text, datas: s.datas });
  A.answer(u, Q('b|create'));
  s = A.screen(u);
  check(s.text.endsWith(txt('ord_ask_phone', { customer: 'ဒေါ်မြ' })) && same(s.datas, [[Q('ph|skip')], [Q('back|phone')]]) && A.state(u).draft.newName === 'ဒေါ်မြ' && c0() === 2,
    'create keeps the name and asks the phone with [⏭ SS|ph|skip] (not Z); no Customers row yet', { text: s.text, datas: s.datas });
  A = bench();
  A.card(u, ITEM, [Q('o|buyer'), { type: '09 777 123456' }]);
  s = A.screen(u);
  check(s.text.indexOf(MSG.cust_none) === 0 && s.text.endsWith(MSG.cust_find) && A.state(u).step === 'buyer' && A.state(u).draft.newName === undefined && c0() === 2,
    'a phone nobody has → cust_none + the buyer screen again, nothing created, no name', { text: s.text, st: A.state(u) });
  A.answer(u, { type: '12' });
  s = A.screen(u);
  check(s.text.indexOf(MSG.cust_none) === 0 && A.state(u).draft.newName === undefined && c0() === 2, 'typed 12 → cust_none, nothing created and no newName (digits are never a name)', A.state(u));
  A.answer(u, { type: '5678' });
  s = A.screen(u);
  check(s.text.endsWith(txt('cust_pick', { name: '5678' })) && same(s.datas[0], [Q('b|C-0001')]) && s.flat.indexOf(Q('b|create')) < 0 && same(s.datas[1], [Q('back|buyer')]),
    'typed 5678 (the last four digits of ဒေါ်မြင့်\'s number) → cust_pick offering her and NO create button', { text: s.text, datas: s.datas });
  A.answer(u, { type: '09 123 456 78' });
  check(A.state(u).step === 'card' && A.state(u).draft.customerId === 'C-0001', 'typed 09 123 456 78 (her number) picks her → the card', A.state(u));
  A = bench();
  A.card(u, ITEM, [Q('o|buyer'), { type: 'ဦးသန့်' }]);
  s = A.screen(u);
  check(s.text.endsWith(txt('ord_ask_phone', { customer: 'ဦးသန့်' })) && A.state(u).step === 'phone' && A.state(u).draft.newName === 'ဦးသန့်' && c0() === 2, 'a new name ဦးသန့် → ord_ask_phone, nothing created', s.text);
  A.answer(u, { type: '123' });
  s = A.screen(u);
  check(s.text.endsWith(txt('ord_ask_phone', { customer: 'ဦးသန့်' })) && A.state(u).step === 'phone', 'typed 123 (too short) → ord_ask_phone again', s.text);
  A.answer(u, { type: '09 123 456 78' });
  s = A.screen(u);
  check(s.text.endsWith(txt('cust_pick', { name: 'ဦးသန့်' })) && same(s.datas[0], [Q('b|C-0001')]) && same(s.datas[1], [Q('b|create')]) && A.state(u).draft.newPhone === '0912345678',
    'ဒေါ်မြင့်\'s number typed for ဦးသန့် → cust_pick offering her and "create ဦးသန့်" (a known number is never duplicated)', { text: s.text, datas: s.datas });
  A.answer(u, Q('b|create'));
  s = A.screen(u);
  check(A.state(u).step === 'card' && A.state(u).draft.newName === 'ဦးသန့်' && A.state(u).draft.newPhone === '0912345678' && s.text.indexOf('👤 ဦးသန့် · +95 912 345 678') >= 0,
    'create → the card with newName and newPhone kept (no second phone question); its buyer line shows both', { text: s.text, st: A.state(u) });
  A = bench();
  const n0 = A.ledgerLen();
  A.card(u, ITEM, [Q('o|buyer'), { type: 'ဦးသန့်' }, { type: '09 555 000 111' }]);
  check(A.state(u).step === 'card' && A.state(u).draft.newPhone === '09555000111' && c0() === 2, 'a new name and a valid phone → the card; the Customers tab is untouched until ✅', A.state(u));
  A.answer(u, 'SC|S1-0002|ok');
  const created = A.world.customers[2], row = A.lastRow();
  check(c0() === 3 && created.name === 'ဦးသန့်' && created.phone === '09555000111' && row.customerId === created.id && A.ledgerLen() === n0 + 1,
    '✅ creates ဦးသန့် with phone 09555000111 and the SALE row carries the new id', { created, row });
  check(A.screen(u).text.indexOf(txt('cust_attached', { customer: 'ဦးသန့်' })) >= 0 && A.screen(u).flat.indexOf('CF|' + created.id) < 0, 'the sold card names the buyer (cust_attached) and offers no 📱 (she has a phone)', A.screen(u).datas);
  A = bench();
  A.card(u, ITEM, [Q('o|buyer'), { type: 'ဦးသန့်' }, Q('ph|skip')]);
  check(A.state(u).kind === 'sale' && A.state(u).step === 'card' && A.state(u).draft.newPhone === '', 'skip leaves the phone blank and returns to the card (still a sale state)', A.state(u));
  A.answer(u, 'SC|S1-0002|ok');
  const c2 = A.world.customers[2];
  check(c2 && c2.name === 'ဦးသန့်' && c2.phone === '' && same(A.screen(u).datas, CARD_SOLD_ROWS(A.lastRow().groupId).concat([['CF|' + c2.id]])), 'after skip the sold card carries the 📱 row for the new buyer without a phone', A.screen(u).datas);
  A = bench();
  A.card(u, ITEM, [{ type: 'ဒေါ်မြင့်' }]);
  check(A.state(u).step === 'card' && A.state(u).draft.customerId === 'C-0001', 'typed on the card itself (no o|buyer) the text is a buyer search too: ဒေါ်မြင့် is picked', A.state(u));
});

/* ============================== 5. how paid ============================== */

step('W5. How paid (o|method): the seed lists, one bank, two banks, no bank, the six-answer rule, the account screen');
runStep(() => {
  const u = U.sister;
  let A = bench();
  A.card(u, ITEM, [Q('o|method')]);
  let s = A.screen(u);
  check(same(s.datas, [[Q('m|CASH')], [Q('m|KBZ')], [Q('m|WAVE')], [Q('m|bank')], [Q('m|mix')], ['LA|pm|SSA|S1-0002'], [Q('back|method')]]),
    'seed lists: [💵] [KBZ] [WAVE] [bank] [mix] [➕] [back]', s.datas);
  check(same(s.texts.slice(0, 6).map(r => r[0]), [MSG.btn_cash, '📲 KBZPay', '📲 WavePay', MSG.btn_bank_transfer, MSG.btn_split, MSG.btn_add_bank]),
    'the texts: 💵 ငွေသား, 📲 KBZPay, 📲 WavePay, 🏛 ဘဏ်, 💵+🏦 ခွဲပေး, ➕ ဘဏ်အသစ် (six answers)', s.texts);
  A.answer(u, Q('m|bank'));
  s = A.screen(u);
  check(A.state(u).step === 'card' && A.state(u).draft.method === 'BANK' && s.text.indexOf(txt('sale_line_method', { method: 'ဘဏ်လွှဲ' })) >= 0,
    'bank with one bank (BANK by name) skips the account screen → the card with method BANK', { text: s.text, st: A.state(u) });
  A = bench();
  A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'AYA', label: 'AYA', kind: 'bank' }, { key: 'CB', label: 'CB Bank', kind: 'bank' }]);
  A.card(u, ITEM, [Q('o|method'), Q('m|bank')]);
  s = A.screen(u);
  check(s.text.endsWith(MSG.sale_ask_account) && same(s.datas, [[Q('a|AYA')], [Q('a|CB')], ['LA|pm|SSA|S1-0002'], [Q('back|account')]]) && same(s.texts.slice(0, 2).map(r => r[0]), ['🏦 AYA', '🏦 CB Bank']),
    'two bank-kind accounts → sale_ask_account with two 🏦 rows, ➕ and the back row', { text: s.text, datas: s.datas, texts: s.texts });
  A = bench();
  A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'WAVE', label: 'WavePay' }]);
  A.card(u, ITEM, [Q('o|method')]);
  s = A.screen(u);
  check(s.flat.indexOf(Q('m|bank')) < 0 && same(s.datas, [[Q('m|CASH')], [Q('m|KBZ')], [Q('m|WAVE')], [Q('m|mix')], ['LA|pm|SSA|S1-0002'], [Q('back|method')]]),
    'with no bank-kind account the 🏛 ဘဏ် button is absent', s.datas);
  A = bench();
  A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'WAVE', label: 'WavePay' }, { key: 'AYAP', label: 'AYA Pay' }, { key: 'BANK', label: 'ဘဏ်လွှဲ' }]);
  A.card(u, ITEM, [Q('o|method')]);
  s = A.screen(u);
  check(same(s.datas, [[Q('m|CASH')], [Q('m|more')], [Q('m|bank')], [Q('m|mix')], ['LA|pm|SSA|S1-0002'], [Q('back|method')]]) && s.texts[1][0] === MSG.btn_kind_wallet,
    'three wallets and a bank: [💵] [📲 Pay အကောင့် → more] [bank] [mix] [➕] [back] (five answers, never seven)', { datas: s.datas, texts: s.texts });
  A = bench();
  A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'WAVE', label: 'WavePay' }, { key: 'AYAP', label: 'AYA Pay' }, { key: 'CBP', label: 'CB Pay' }]);
  A.card(u, ITEM, [Q('o|method')]);
  s = A.screen(u);
  check(same(s.datas, [[Q('m|CASH')], [Q('m|more')], [Q('m|mix')], ['LA|pm|SSA|S1-0002'], [Q('back|method')]]), 'four wallets and no bank: [💵] [more] [mix] [➕] [back]', s.datas);
  A.answer(u, Q('m|more'));
  s = A.screen(u);
  check(s.text.endsWith(MSG.sale_ask_account) && same(s.datas.slice(0, 4), [[Q('a|KBZ')], [Q('a|WAVE')], [Q('a|AYAP')], [Q('a|CBP')]]) && s.texts.slice(0, 4).every(r => r[0].indexOf('📲 ') === 0) && same(s.datas[4], ['LA|pm|SSA|S1-0002']),
    'more → sale_ask_account listing the wallets as 📲 rows, then ➕', { text: s.text, datas: s.datas, texts: s.texts });
  A = bench();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix')]);
  s = A.screen(u);
  check(s.text.endsWith(MSG.sale_ask_split_account) && s.text.indexOf('(ပေးငွေ') < 0 && same(s.datas.slice(0, 3), [[Q('a|KBZ')], [Q('a|WAVE')], [Q('a|BANK')]]) && same(s.texts.slice(0, 3).map(r => r[0]), ['📲 KBZPay', '📲 WavePay', '🏦 ဘဏ်လွှဲ']) && A.state(u).draft.mixed === true,
    'mix on the seed lists KBZ, WAVE and BANK (🏦 for BANK) under sale_ask_split_account (no "(ပေးငွေ")', { text: s.text, datas: s.datas, texts: s.texts });
  const six = [['K1', 'Pay 1'], ['K2', 'Pay 2'], ['K3', 'Pay 3'], ['K4', 'Pay 4'], ['K5', 'Pay 5'], ['K6', 'Pay 6']].map(x => ({ key: x[0], label: x[1] }));
  A = bench();
  A.setAccounts(six);
  A.card(u, ITEM, [Q('o|method'), Q('m|more')]);
  s = A.screen(u);
  check(same(s.datas, [[Q('a|K1')], [Q('a|K2')], [Q('a|K3')], [Q('a|K4')], [Q('a|p1')], ['LA|pm|SSA|S1-0002'], [Q('back|account')]]) && s.texts[4][0] === MSG.btn_more,
    'six wallets: four 📲 rows, [▶️ → a|p1], [➕] (six answers)', { datas: s.datas, texts: s.texts });
  A.answer(u, Q('a|p1'));
  s = A.screen(u);
  check(same(s.datas, [[Q('a|K5')], [Q('a|K6')], ['LA|pm|SSA|S1-0002'], [Q('back|account')]]) && A.state(u).step === 'account',
    'a|p1 → the remaining two, ➕, no ▶️; the step is still account', s.datas);
  A = bench();
  A.setAccounts(six);
  A.card(u, ITEM, [Q('o|method'), Q('m|mix')]);
  s = A.screen(u);
  check(s.text.endsWith(MSG.sale_ask_split_account) && same(s.datas[4], [Q('a|p1')]) && s.datas.length === 7, 'a mix on those six → the same paging', s.datas);
  A.answer(u, Q('a|K2'));
  check(A.state(u).kind === 'await_number' && A.state(u).saved.step === 'bank' && A.state(u).saved.draft.method === 'K2', 'an account of the mix → the transfer part', A.state(u));
  A = bench();
  A.card(u, ITEM, [Q('o|method'), Q('m|KBZ')]);
  check(A.state(u).step === 'card' && A.state(u).draft.method === 'KBZ' && A.screen(u).text.indexOf(txt('sale_line_method', { method: 'KBZPay' })) >= 0, 'a wallet by name is the method at once; the card shows it', A.state(u));
});

/* ============================== 6. mixed ============================== */

step('W6. Mixed: the account, the transfer part, the card, the two rows, undo; a part without a buyer is refused at Save');
runStep(() => {
  const u = U.sister;
  let A = bench(), n0 = A.ledgerLen();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ')]);
  let s = A.screen(u), st = A.state(u);
  check(s.text.endsWith(txt('split_ask_amount', { method: 'KBZPay', cash: '18,000' })) && same(s.datas, [[Q('x|half')], [Q('back|bank')]]) && same(s.texts[0], [txt('btn_half', { amount: '9,000' })]) &&
    st.kind === 'await_number' && st.purpose === 'sale_step' && st.saved.step === 'bank' && st.saved.draft.method === 'KBZ',
    'mix → KBZ (three candidates: the account screen) → split_ask_amount with [တစ်ဝက် 9,000] and back|bank alone; the state waits for a number around the basket', { text: s.text, datas: s.datas, st });
  A.answer(u, { type: '10000' });
  s = A.screen(u);
  check(A.state(u).step === 'card' && same(s.datas, CARD_ROWS(ITEM, [ITEM])) && s.text.indexOf(txt('sale_line_mixed', { cashMethod: 'ငွေသား', cash: '8,000', method: 'KBZPay', bank: '10,000' })) >= 0,
    'typed 10000 of 18,000 → the card again; its how-paid line splits 8,000 · 10,000', { text: s.text, datas: s.datas });
  A.answer(u, 'SC|S1-0002|ok');
  const rows = A.world.ledger.slice(n0), g = rows[0].groupId;
  check(rows.length === 2 && rows[0].type === 'SALE' && rows[0].cash === 8000 && rows[0].method === 'CASH' && rows[0].note === 'split' && rows[0].amount === 18000 &&
    rows[1].type === 'PAYMENT' && rows[1].amount === 10000 && rows[1].cash === 10000 && rows[1].method === 'KBZ' && rows[1].refGroupId === g && rows[1].groupId === g && rows[1].note === 'split',
    '✅ writes SALE (cash 8,000, CASH, split) then PAYMENT (10,000, KBZ, refGroupId = group, split) in one group', rows);
  const info = saleGroupInfo(A.ports, g), gm = groupMethods(A.ports, g), stats = A.stats('S1');
  check(info.owed === 0 && gm.length === 2 && A.net(stats, 'CASH') === 8000 && A.net(stats, 'KBZ') === 10000, 'saleGroupInfo.owed 0; groupMethods two entries; dayStats CASH +8,000 and KBZ +10,000', { owed: info.owed, gm, cash: A.net(stats, 'CASH'), kbz: A.net(stats, 'KBZ') });
  check(receiptText(A.ports, buildReceipt(A.ports, g)).indexOf(' (ငွေသား 8,000 · KBZPay 10,000)') >= 0 && rewriteCheck(A.ports, g).reason === 'complex', 'the receipt prints (ငွေသား 8,000 · KBZPay 10,000); rewriteCheck answers complex');
  check(A.screen(u).text.indexOf(txt('split_done', { cashMethod: 'ငွေသား', cash: '8,000', method: 'KBZPay', bank: '10,000' })) >= 0 && same(A.screen(u).datas, CARD_SOLD_ROWS(g)), 'the sold card prints split_done and the plain rows', A.screen(u).text);
  const stock0 = A.ports.store.getItem(ITEM).stock;
  A.tick(20);
  A.answer(u, 'U|' + g);
  const after = A.stats('S1');
  check(A.liveOf(g).length === 0 && A.net(after, 'CASH') === 0 && A.net(after, 'KBZ') === 0 && A.ports.store.getItem(ITEM).stock === stock0 + 1 && saleGroupInfo(A.ports, g).owed === 0,
    'undo within 30 min mirrors both rows: every bucket nets to 0, stock is back, nothing owed', { live: A.liveOf(g).length, cash: A.net(after, 'CASH'), kbz: A.net(after, 'KBZ') });
  A = bench(); n0 = A.ledgerLen();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '18000' }]);
  check(A.state(u).step === 'card' && A.state(u).draft.mixed === false && A.state(u).draft.method === 'KBZ' && A.screen(u).text.indexOf(txt('sale_line_method', { method: 'KBZPay' })) >= 0,
    'typed 18000 (all of what is paid now) as the transfer part → not mixed: the whole payment on KBZ', { st: A.state(u) });
  A.answer(u, 'SC|S1-0002|ok');
  check(A.ledgerLen() === n0 + 1 && A.lastRow().method === 'KBZ' && A.lastRow().cash === 18000 && A.lastRow().note === '', 'one row, method KBZ', A.lastRow());
  A = bench();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '0' }]);
  s = A.screen(u); st = A.state(u);
  check(s.text === txt('sale_bad_amount', { min: '1', max: '17,999' }) && same(s.datas, [[Q('back|bank')]]) && st.purpose === 'sale_step' && st.saved.step === 'bank' && st.saved.msgId === s.id,
    'typed 0 → sale_bad_amount (1 .. 17,999) with [⏮ back|bank] alone, the state kept on that message', { text: s.text, datas: s.datas, st });
  A = bench(); n0 = A.ledgerLen();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '5000' }]);
  check(A.state(u).step === 'card' && A.state(u).draft.bankPart === 5000, 'typed 5000 → the card with the transfer part 5,000');
  A.answers(u, [Q('o|paid'), Q('p|other'), { type: '9000' }]);
  s = A.screen(u);
  check(s.text.indexOf(MSG.sale_need_buyer) >= 0 && s.text.endsWith(MSG.cust_find) && s.flat.indexOf(Q('b|none')) < 0 && A.state(u).draft.paid === 9000 && A.state(u).draft.part === true,
    'typed 9000 now (a part) → the buyer screen with sale_need_buyer and no 🚫', { text: s.text, datas: s.datas });
  A.answer(u, Q('back|buyer'));
  const nBack = A.ledgerLen();
  A.answer(u, 'SC|S1-0002|ok');
  s = A.screen(u);
  check(A.ledgerLen() === nBack && A.state(u).step === 'card' && s.text.indexOf(MSG.sale_need_buyer) === 0 && A.state(u).draft.paid === 9000,
    'back to the card with nobody named, ✅ is refused: sale_need_buyer on top of the card, nothing written, the basket kept', { text: s.text.split('\n')[0], st: A.state(u) });
  A.answers(u, [Q('o|buyer'), { type: 'ဒေါ်မြင့်' }]);
  s = A.screen(u);
  check(s.text.endsWith(txt('sale_ask_due', { owed: '9,000' })) && same(s.texts[0], ['၇ ရက်', '၁၄ ရက်', '၃၀ ရက်']), 'ဒေါ်မြင့် → when is the rest paid (9,000 owed)', { text: s.text, texts: s.texts });
  A.answers(u, [Q('d|14'), 'SC|S1-0002|ok']);
  const rows2 = A.world.ledger.slice(n0), g2 = rows2[0].groupId, info2 = saleGroupInfo(A.ports, g2);
  check(rows2.length === 2 && rows2[0].cash === 4000 && rows2[0].method === 'CASH' && rows2[0].customerId === 'C-0001' && rows2[0].dueDay === addDaysKey(today, 14) && rows2[1].amount === 5000 && rows2[1].method === 'KBZ' && rows2[1].dueDay === '' && info2.owed === 9000,
    '✅ → SALE (cash 4,000, DueDay today + 14) + PAYMENT (5,000), owed 9,000', rows2);
  check(A.screen(u).text.indexOf(txt('credit_done', { customer: 'ဒေါ်မြင့်', paid: '9,000', owed: '9,000' })) >= 0, 'the card\'s credit_done says ပေးပြီး 9,000 (cash + payments, not 4,000)', A.screen(u).text);
  A = bench();
  // poc/sim_mock_ai.js names the method on a NEW_ITEM_INFO answer only while ctx.awaiting is 'split_bank' (:159); the
  // transfer-part screen waits as 'sale_step'. Until the mock learns that purpose this bench adds the CASH the real model
  // answers for "ငွေသား ...", so the check exercises the bot's conversion line, not the mock.
  const realVoice = A.ports.ai.parseVoice;
  A.ports.ai.parseVoice = function (file, ctx) {
    const out = realVoice.call(this, file, ctx);
    if (ctx && ctx.awaiting === 'sale_step' && /ငွေသား/.test(file.text) && !out.method) out.method = 'CASH';
    return out;
  };
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { voice: 'ငွေသား ငါးထောင်' }]);
  check(A.state(u).kind === 'sale' && A.state(u).step === 'card' && A.state(u).draft.bankPart === 13000, 'a spoken ငွေသား ငါးထောင် (method CASH) at the transfer part stores bankPart 13,000 (18,000 − the cash part)', A.state(u));
});

/* ============================== 7. the seven outcomes ============================== */

step('7. The seven outcomes of commitSaleGroup (section 2.2)');
runStep(() => {
  const A = bench(), ports = A.ports, staff = ports.store.getStaff('1001'), item = ports.store.getItem(ITEM);
  const run = p => { const n = A.ledgerLen(); const r = commitSaleGroup(ports, Object.assign({ item, staff, source: 'BUTTON' }, p)); return { r, rows: A.world.ledger.slice(n) }; };
  let o = run({ qty: 1 });
  check(o.rows.length === 1 && o.rows[0].cash === 18000 && o.rows[0].method === 'CASH' && o.rows[0].note === '' && o.rows[0].dueDay === '' && o.r.owed === 0, '1. cash, full, no buyer: one SALE, cash 18,000, CASH, no note, no DueDay', o.rows);
  o = run({ qty: 1, method: 'KBZ', priceChanged: true, unitPrice: 15000 });
  check(o.rows.length === 1 && o.rows[0].cash === 15000 && o.rows[0].method === 'KBZ' && o.rows[0].note === 'price' && o.rows[0].dueDay === '', '2. wallet, full, bargained: one SALE, method KBZ, note price', o.rows);
  o = run({ qty: 1, method: 'KBZ', paid: 0, customerId: 'C-0001', dueDay: addDaysKey(today, 7) });
  check(o.rows.length === 1 && o.rows[0].cash === 0 && o.rows[0].method === '' && o.rows[0].note === 'credit' && o.rows[0].dueDay === addDaysKey(today, 7) && o.r.owed === 18000, '3a. one method, nothing now: cash 0 → method blank, note credit, the chosen day', o.rows);
  o = run({ qty: 1, method: 'KBZ', paid: 9000, customerId: 'C-0001' });
  check(o.rows.length === 1 && o.rows[0].cash === 9000 && o.rows[0].method === 'KBZ' && o.rows[0].note === 'credit' && o.rows[0].dueDay === '' && o.r.owed === 9000, '3b. one method, half now: method KBZ, note credit, no day', o.rows);
  o = run({ qty: 1, method: 'KBZ', mixed: true, bankPart: 10000 });
  check(o.rows.length === 2 && o.rows[0].cash === 8000 && o.rows[0].method === 'CASH' && o.rows[0].note === 'split' && o.rows[1].type === 'PAYMENT' && o.rows[1].amount === 10000 && o.rows[1].method === 'KBZ' && o.rows[1].note === 'split' && o.rows[0].dueDay === '' && o.r.payment !== null,
    '4. mixed, full: SALE (8,000 CASH split) then PAYMENT (10,000 KBZ split)', o.rows);
  o = run({ qty: 1, method: 'KBZ', mixed: true, bankPart: 5000, paid: 9000, customerId: 'C-0001', dueDay: addDaysKey(today, 10) });
  check(o.rows.length === 2 && o.rows[0].cash === 4000 && o.rows[0].method === 'CASH' && o.rows[0].dueDay === addDaysKey(today, 10) && o.rows[1].amount === 5000 && o.rows[1].dueDay === '' && o.r.owed === 9000,
    '5. mixed, part now: SALE (4,000, DueDay on it) then PAYMENT (5,000, no DueDay)', o.rows);
  o = run({ qty: 1, method: 'KBZ', mixed: true, bankPart: 9000, paid: 9000, customerId: 'C-0001' });
  check(o.rows.length === 1 && o.rows[0].cash === 9000 && o.rows[0].method === 'KBZ' && o.rows[0].note === 'credit' && o.r.payment === null, '6. mixed with the cash part 0 (bank = paid): one row, method KEY, note credit', o.rows);
  o = run({ qty: 1, method: 'KBZ', mixed: true, bankPart: 0 });
  check(o.rows.length === 1 && o.rows[0].cash === 18000 && o.rows[0].method === 'CASH' && o.rows[0].note === '', '7. mixed with the bank part 0: one row, method CASH by payKey (not KBZ)', o.rows);
  o = run({ qty: 1, method: 'KBZ', mixed: true, bankPart: 0, paid: 0, customerId: 'C-0001' });
  check(o.rows.length === 1 && o.rows[0].method === '' && o.rows[0].note === 'credit', '7b. the same with nothing paid: method blank, note credit', o.rows);
  o = run({ qty: 1, dueDay: addDaysKey(today, 10) });
  check(o.rows[0].dueDay === '' && o.rows[0].note === '', 'a date chosen with a full payment is dropped (dueDay blank)', o.rows);
  o = run({ qty: 2, unitPrice: 15000, priceChanged: true, paid: 10000, customerId: 'C-0001' });
  check(o.rows[0].note === 'credit' && o.rows[0].amount === 30000 && o.rows[0].cash === 10000, 'a bargained part sale carries credit, not price', o.rows);
});

/* ============================== 8. part without a buyer ============================== */

step('W8. Part without a buyer: the card says so and Save writes nothing; the paid answer opens the buyer, then the day; the deposit question');
runStep(() => {
  const u = U.sister, due14 = addDaysKey(today, 14);
  let A = bench(), n0 = A.ledgerLen();
  const card = A.card(u, 'S1-0004', ['SS|S1-0004|o|paid', 'SS|S1-0004|p|half']);
  let s = A.screen(u);
  check(s.id === card.id && s.flat.indexOf('SS|S1-0004|b|none') < 0 && s.text.indexOf(MSG.sale_need_buyer) >= 0 && s.text.endsWith(MSG.credit_ask_customer + '\n' + MSG.cust_find) && A.state(u).draft.paid === 22500 && A.state(u).draft.part === true,
    'half → the buyer screen (basketNext) without 🚫 and with sale_need_buyer; paid 22,500, part in the draft', { datas: s.datas, text: s.text });
  A.answer(u, 'SS|S1-0004|back|buyer');
  s = A.screen(u);
  check(A.state(u).step === 'card' && s.text.endsWith(txt('sale_ask_due', { owed: '22,500' }) + '\n' + MSG.sale_need_buyer) && same(s.datas, CARD_ROWS('S1-0004', ['S1-0004'], true)),
    'the card of a part payment with nobody named ends with sale_ask_due and sale_need_buyer; its payment row is [💳 ယခု ပေးငွေ, 📅 ပေးမည့်ရက်]', { text: s.text, datas: s.datas });
  A.answer(u, 'SC|S1-0004|ok');
  check(A.ledgerLen() === n0 && A.screen(u).text.indexOf(MSG.sale_need_buyer) === 0 && A.state(u).step === 'card', 'its ✅ writes nothing and puts sale_need_buyer on top', A.screen(u).text.split('\n')[0]);
  A.answers(u, ['SS|S1-0004|o|buyer', { type: 'ဒေါ်ခင်' }]);
  s = A.screen(u);
  check(s.text.endsWith(txt('sale_ask_due', { owed: '22,500' })) && s.text.indexOf(MSG.sale_ask_method) < 0 && A.state(u).draft.customerId === 'C-0002' &&
    same(s.datas, [['SS|S1-0004|d|7', 'SS|S1-0004|d|14', 'SS|S1-0004|d|30'], ['SS|S1-0004|d|type', 'SS|S1-0004|d|none'], ['SS|S1-0004|back|due']]) &&
    same(s.texts, [['၇ ရက်', '၁၄ ရက်', '၃၀ ရက်'], [MSG.btn_due_type, MSG.btn_due_unknown], [MSG.btn_back]]),
    'ဒေါ်ခင် → sale_ask_due with [7 14 30] [✏️ ❓] [back] (basketNext: the day is next)', { text: s.text, datas: s.datas, texts: s.texts });
  A.answer(u, 'SS|S1-0004|d|14');
  s = A.screen(u);
  check(A.state(u).step === 'card' && s.text.indexOf(txt('sale_line_paid', { paid: '22,500', owed: '22,500' })) >= 0 && s.text.indexOf(txt('sale_due_set', { owed: '22,500', date: fmtDayMy(due14) })) >= 0 &&
    s.text.indexOf(MSG.sale_need_buyer) < 0 && A.ledgerLen() === n0,
    '၁၄ ရက် → the card with sale_line_paid and sale_due_set (today + 14); nothing written yet', { text: s.text, datas: s.datas });
  A.answer(u, 'SC|S1-0004|ok');
  const row = A.lastRow(), g = row.groupId;
  check(A.ledgerLen() === n0 + 1 && row.type === 'SALE' && row.cash === 22500 && row.amount === 45000 && row.customerId === 'C-0002' && row.dueDay === due14 && row.note === 'credit' && row.method === 'CASH',
    '✅ သိမ်း → one SALE row: cash 22,500 of 45,000, ဒေါ်ခင်, DueDay today + 14, note credit', row);
  s = A.screen(u);
  const soldId = s.id;
  check(s.text.indexOf(txt('credit_done', { customer: 'ဒေါ်ခင်', paid: '22,500', owed: '22,500' })) >= 0 && s.text.indexOf(txt('sale_due_set', { owed: '22,500', date: fmtDayMy(due14) })) >= 0 &&
    s.text.indexOf(txt('credit_use_deposit', { customer: 'ဒေါ်ခင်', deposit: '300,000' })) >= 0 && same(s.datas, [['CD|' + g + '|yes|p', 'CD|' + g + '|no|p']]) && same(s.texts[0], [MSG.btn_use_deposit, MSG.btn_no_deposit]),
    'the card has credit_done, sale_due_set and, ဒေါ်ခင် holding 300,000, the deposit question with [CD yes p, CD no p] only', { text: s.text, datas: s.datas });
  A.answer(u, 'CD|' + g + '|yes|p');
  s = A.screen(u);
  const applied = A.rowsOf(g).filter(r => r.type === 'DEPOSIT_APPLIED');
  check(applied.length === 1 && applied[0].amount === 22500 && s.text.indexOf(txt('deposit_applied', { amount: '22,500', owed: '0' })) >= 0 && s.id === soldId &&
    s.flat.every(d => !/^(CR|CU|PM|SX|LA|CD)\|/.test(d)) && same(s.datas, CARD_SOLD_ROWS(g).concat([['CF|C-0002']])) && s.text.indexOf(txt('cust_attached', { customer: 'ဒေါ်ခင်' })) >= 0,
    'yes → one DEPOSIT_APPLIED row in the group, deposit_applied, the card redrawn with the plain rows (no CR CU PM SX LA) plus 📱 for ဒေါ်ခင်', { rows: applied.length, datas: s.datas, text: s.text });
  A = bench(); n0 = A.ledgerLen();
  A.card(u, 'S1-0004', ['SS|S1-0004|o|paid', 'SS|S1-0004|p|half', { type: 'ဒေါ်ခင်' }, 'SS|S1-0004|d|14', 'SC|S1-0004|ok']);
  const g2 = A.lastRow().groupId;
  A.answer(u, 'CD|' + g2 + '|no|p');
  s = A.screen(u);
  check(A.ledgerLen() === n0 + 1 && same(s.datas, [['U|' + g2, 'RC|' + g2], ['PY|' + g2], ['CF|C-0002']]) && s.text.indexOf(txt('credit_done', { customer: 'ဒေါ်ခင်', paid: '22,500', owed: '22,500' })) >= 0 && s.text.indexOf(MSG.btn_use_deposit) < 0 && s.text.indexOf(head('credit_use_deposit')) < 0,
    'no → the plain rows ([undo, receipt] [💰] [📱]) and no write; the question is gone', { datas: s.datas, text: s.text });
  A = bench(); n0 = A.ledgerLen();
  const c0 = A.world.customers.length;
  A.card(u, 'S1-0004', ['SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'btn_new_customer', { type: 'ဒေါ်စန်း' }, { type: '09 777 123 456' }]);
  s = A.screen(u);
  check(s.text.endsWith(txt('sale_ask_due', { owed: '22,500' })) && A.world.customers.length === c0 && A.state(u).draft.newName === 'ဒေါ်စန်း' && A.state(u).draft.newPhone === '09777123456',
    'the buyer-needed screen answered with ✏️ new name, ဒေါ်စန်း, a phone → sale_ask_due (the typed path exits through basketNext); no row yet', { text: s.text, st: A.state(u) });
  A.answers(u, ['SS|S1-0004|d|7', 'SC|S1-0004|ok']);
  const made = A.world.customers[A.world.customers.length - 1];
  check(A.world.customers.length === c0 + 1 && made.name === 'ဒေါ်စန်း' && made.phone === '09777123456' && A.lastRow().customerId === made.id && A.lastRow().dueDay === addDaysKey(today, 7) &&
    same(A.screen(u).datas, [['U|' + A.lastRow().groupId, 'RC|' + A.lastRow().groupId], ['PY|' + A.lastRow().groupId]]) && A.screen(u).text.indexOf(head('credit_use_deposit')) < 0,
    '✅ creates ဒေါ်စန်း and no deposit question is asked (she is new)', { made, datas: A.screen(u).datas });
  // Every answer a tap: the whole card, the deposit question and its answer stay on the scanned PHOTO card.
  A = bench(); n0 = A.ledgerLen();
  const pcard = A.card(u, 'S1-0004', ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0002', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|14', 'SC|S1-0004|ok']);
  const g3 = A.lastRow().groupId, before = edits.length;
  check(!!pcard.photo && A.screen(u).id === pcard.id && same(A.screen(u).datas, [['CD|' + g3 + '|yes|p', 'CD|' + g3 + '|no|p']]),
    'all taps: the deposit question sits on the scanned photo card itself', A.screen(u).datas);
  A.answer(u, 'CD|' + g3 + '|yes|p');
  const cdEdits = edits.slice(before).filter(e => e.world === A.world && e.messageId === pcard.id);
  check(cdEdits.length === 1 && cdEdits[0].isCaption === true && A.screen(u).id === pcard.id && A.screen(u).text.indexOf(txt('deposit_applied', { amount: '22,500', owed: '0' })) >= 0 &&
    same(A.screen(u).datas, CARD_SOLD_ROWS(g3).concat([['CF|C-0002']])),
    'CD yes on the photo card edits it as a caption (isCaption true), with deposit_applied and the plain rows', { cdEdits: cdEdits.map(e => e.isCaption), datas: A.screen(u).datas });
  // p|all on a part draft with a buyer and a day: back to paid in full, the amount and the day cleared.
  A = bench();
  A.card(u, 'S1-0004', ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0002', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|14', 'SS|S1-0004|o|paid']);
  s = A.screen(u);
  const fullBtn = A.sim.buttonByKey(s.message, 'btn_paid_full');
  check(fullBtn === 'SS|S1-0004|p|all' && same(s.texts[0], [txt('btn_paid_full', { amount: '45,000' })]) && same(s.datas[1], ['SS|S1-0004|p|0', 'SS|S1-0004|p|half', 'SS|S1-0004|p|other']) &&
    same(s.datas[2], ['SS|S1-0004|back|paid']), 'the paid sub-screen: [💯 အကုန် ပေးပြီး 45,000 → p|all] [0, half, ✏️] [⏮]', { datas: s.datas, texts: s.texts });
  A.answer(u, 'SS|S1-0004|p|all');
  const stAll = A.state(u);
  check(stAll.step === 'card' && stAll.draft.part === false && stAll.draft.paid === undefined && stAll.draft.dueDay === undefined && stAll.draft.customerId === 'C-0002' &&
    A.screen(u).text.indexOf(txt('sale_line_paid', { paid: '45,000', owed: '0' })) >= 0, 'p|all → the card with part false, paid and dueDay cleared (the buyer kept), paid 45,000 · owed 0', stAll.draft);
});

/* ============================== 9. due typed and unknown ============================== */

step('W9. Due typed and unknown: the typed date, its limits, yyyy-mm-dd, a date typed on the due screen, not sure');
runStep(() => {
  const u = U.sister, due10 = addDaysKey(today, 10), part = ['SS|S1-0004|o|paid', 'SS|S1-0004|p|half', { type: 'ဒေါ်ခင်' }];
  let A = bench();
  A.card(u, 'S1-0004', part);
  const dueScreen = A.screen(u);
  A.answer(u, 'btn_due_type');
  let s = A.screen(u);
  check(s.id === dueScreen.id && s.text.endsWith(MSG.ord_ask_due_text) && same(s.datas, [['SS|S1-0004|back|due_text']]) && A.state(u).step === 'due_text',
    '✏️ ရက်စွဲ ရိုက် edits the due screen into ord_ask_due_text with [⏮ back|due_text] alone', { text: s.text, datas: s.datas });
  A.answer(u, { type: '32.13.26' });
  s = A.screen(u);
  check(s.text === MSG.ord_bad_date && same(s.datas, [['SS|S1-0004|back|due_text']]) && A.state(u).step === 'due_text' && A.state(u).draft.dueDay === undefined,
    'typed 32.13.26 → ord_bad_date with the back row, the state kept', { text: s.text, st: A.state(u) });
  const yesterday = addDaysKey(today, -1);
  A.answer(u, { type: dmy(yesterday) });
  const t1 = A.screen(u).text;
  A.answer(u, { type: dm(yesterday) });
  const t2 = A.screen(u).text;
  check(t1 === MSG.ord_bad_date && t2 === MSG.ord_bad_date && A.state(u).step === 'due_text', 'yesterday typed as d.m.yy and as d.m (no year: noRoll keeps it in this year) → ord_bad_date both times', { t1, t2 });
  A.answer(u, { type: dmy(addDaysKey(today, 400)) });
  check(A.screen(u).text === MSG.ord_bad_date && A.state(u).step === 'due_text', 'a date 400 days ahead → ord_bad_date', A.screen(u).text);
  const before = A.screen(u).id;
  A.answer(u, { type: dmy(due10) });
  s = A.screen(u);
  check(s.id !== before && s.text.indexOf(txt('sale_due_set', { owed: '22,500', date: fmtDayMy(due10) })) >= 0 && A.state(u).step === 'card' && A.state(u).draft.dueDay === due10,
    'ten days ahead typed as d.m.yy → the card as a new message with that date (basketNext)', { text: s.text, st: A.state(u) });
  A = bench();
  A.card(u, 'S1-0004', part.concat(['btn_due_type', { type: due10 }]));
  check(A.state(u).step === 'card' && A.state(u).draft.dueDay === due10, 'the same day typed as yyyy-mm-dd → the same key', A.state(u));
  A = bench();
  A.card(u, 'S1-0004', part.concat([{ type: dmy(due10) }]));
  check(A.state(u).step === 'card' && A.state(u).draft.dueDay === due10 && A.screen(u).text.indexOf(fmtDayMy(due10)) >= 0, 'ten days ahead typed on the DUE screen (buttons, no ✏️) → the card too', A.state(u));
  A = bench();
  A.card(u, 'S1-0004', part.concat(['btn_due_unknown']));
  s = A.screen(u);
  check(A.state(u).step === 'card' && A.state(u).draft.dueDay === '' && s.text.indexOf(MSG.sale_due_none) >= 0 && s.text.indexOf(head('sale_due_set')) < 0, '❓ မသေချာ → dueDay blank and sale_due_none on the card', { text: s.text, st: A.state(u) });
  A.answer(u, 'SC|S1-0004|ok');
  check(A.lastRow().dueDay === '' && A.lastRow().note === 'credit' && A.screen(u).text.indexOf(head('sale_due_set')) < 0, '✅ writes the credit without a DueDay and the card prints no due line', A.lastRow());
  A = bench();
  A.card(u, 'S1-0004', part.concat([{ type: '14' }]));
  check(A.state(u).step === 'card' && A.state(u).draft.dueDay === addDaysKey(today, 14), 'a number typed on the due screen is that many days (saleDueKey keeps one rule for days and dates)', A.state(u));
});

/* ============================== 10. overdue by DueDay ============================== */

step('10. Overdue by DueDay: the dated credit, the 21:00 line, the undated rule unchanged');
runStep(() => {
  const u = U.sister, due7 = addDaysKey(today, 7);
  const A = bench(), R = bench();
  A.card(u, 'S1-0004', ['SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|b|C-0001', 'SS|S1-0004|d|7', 'SC|S1-0004|ok']);
  const g = A.lastRow().groupId;
  let c = openCredits(A.ports, null).filter(x => x.groupId === g)[0];
  check(!!c && c.dueDay === due7 && c.overdue === false && c.daysOver === -7 && c.days === 0, 'a part sale due in 7 days: openCredits carries dueDay, overdue false, daysOver -7', c);
  A.tick(8 * 1440);
  R.tick(8 * 1440);
  c = openCredits(A.ports, null).filter(x => x.groupId === g)[0];
  check(c.overdue === true && c.daysOver === 1 && c.days === 8 && c.days < CFG.OVERDUE_DAYS, 'eight days later: overdue true, daysOver 1, while days (8) is below OVERDUE_DAYS', c);
  const day = dayKey(A.world.nowOverride), summary = buildDailySummary(A.ports, day), ref = buildDailySummary(R.ports, day);
  const lineOf = (text, prefix) => text.split('\n').filter(l => l.indexOf(prefix) === 0)[0] || null;
  const dueLine = lineOf(summary, head('summary_due_overdue'));
  check(dueLine === txt('summary_due_overdue', { list: 'ဒေါ်မြင့် 22,500 (' + fmtDayShortMy(due7) + ' · ၁ ရက် လွန်)' }), 'the 21:00 summary has summary_due_overdue naming ဒေါ်မြင့် with the date and ၁ ရက် လွန်', dueLine);
  check(lineOf(summary, head('summary_overdue')) === lineOf(ref, head('summary_overdue')) && lineOf(ref, head('summary_due_overdue')) === null,
    'the seeded undated 500,000 credit stays under summary_overdue with the very text a world without the dated sale prints; that world has no dated line',
    { line: lineOf(summary, head('summary_overdue')), ref: lineOf(ref, head('summary_overdue')) });
  const B = bench();
  B.card(u, 'S1-0004', ['SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|b|C-0001', 'btn_due_unknown', 'SC|S1-0004|ok']);
  const g2 = B.lastRow().groupId;
  B.tick(29 * 1440);
  const c29 = openCredits(B.ports, null).filter(x => x.groupId === g2)[0];
  B.tick(1440);
  const c30 = openCredits(B.ports, null).filter(x => x.groupId === g2)[0];
  check(c29.dueDay === '' && c29.overdue === false && c29.days === 29 && c30.overdue === true && c30.daysOver === 30, 'a part sale with no DueDay is not overdue at 29 days and is at 30 (the age rule)', { c29, c30 });
});

/* ============================== 11. back ============================== */

step('W11. Back: each sub-screen to its parent (SALE_PARENT), how paid to the card restores the payment, ➕ prompts, the same back twice');
runStep(() => {
  const u = U.sister;
  let A = bench();
  const card = A.card(u, ITEM, [Q('o|buyer'), Q('b|C-0001'), Q('o|paid'), Q('p|half'), Q('d|7'), Q('o|due')]);
  check(A.state(u).step === 'due' && A.screen(u).id === card.id, 'o|due (offered while something is owed) opens the due sub-screen on the card', A.state(u));
  A.answer(u, Q('back|due'));
  check(A.state(u).step === 'card' && A.screen(u).id === card.id && A.state(u).draft.dueDay === addDaysKey(today, 7) && A.screen(u).text.indexOf(fmtDayMy(addDaysKey(today, 7))) >= 0,
    'back from the due sub-screen → the card; the chosen day is kept (back moves, it never clears an answer)', A.state(u));
  const parents = [];
  [['o|method', 'method'], ['o|paid', 'paid'], ['o|buyer', 'buyer'], ['l|S1-0002', 'line'], ['add', 'add']].forEach(p => {
    A.answer(u, Q(p[0]));
    const opened = A.state(u).step;
    A.answer(u, Q('back|' + p[1]));
    parents.push([opened, A.state(u).step]);
  });
  check(same(parents, [['method', 'card'], ['paid', 'card'], ['buyer', 'card'], ['line', 'card'], ['add', 'card']]), 'how paid, paid now, buyer, a line and ➕ all go back to the card', parents);
  A.answers(u, [Q('o|buyer'), Q('b|new')]);
  A.answer(u, Q('back|name'));
  const fromName = A.state(u).step;
  A.answers(u, [Q('b|new'), { type: 'ဦးသန့်' }]);
  A.answer(u, Q('back|phone'));
  check(fromName === 'buyer' && A.state(u).step === 'buyer', 'name → buyer and phone → buyer', [fromName, A.state(u).step]);
  A.answer(u, Q('back|buyer'));
  A.answers(u, [Q('o|due'), Q('d|type')]);
  A.answer(u, Q('back|due_text'));
  check(A.state(u).step === 'due', 'due_text → due', A.state(u));
  A = bench();
  A.card(u, ITEM, [Q('o|method'), Q('m|KBZ')]);
  check(A.state(u).draft.method === 'KBZ', 'KBZ is the method on the card', A.state(u).draft);
  A.answers(u, [Q('o|method'), Q('m|mix'), Q('a|WAVE')]);
  A.answer(u, Q('back|bank'));
  const fromBank = A.state(u).step;
  A.answer(u, Q('back|method'));
  check(fromBank === 'method' && A.state(u).step === 'card' && A.state(u).draft.method === 'KBZ' && !A.state(u).draft.mixed && A.state(u).draft.bankPart === undefined && A.state(u).undo === undefined,
    'how paid → mix → WAVE → ⏮ (transfer part → how paid) → ⏮ (how paid → the card) restores the payment as it was (KBZ, not mixed)', A.state(u));
  A.answers(u, [Q('o|method'), Q('m|CASH')]);
  check(A.state(u).step === 'card' && A.state(u).draft.method === 'CASH' && A.state(u).undo === undefined, 'an answer that exits to the card drops the snapshot (💵 is now the method)', A.state(u));
  A = bench();
  A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }, { key: 'AYA', label: 'AYA', kind: 'bank' }, { key: 'CB', label: 'CB Bank', kind: 'bank' }]);
  A.card(u, ITEM, [Q('o|method'), Q('m|bank')]);
  A.answer(u, Q('back|account'));
  check(A.state(u).step === 'method' && A.screen(u).text.endsWith(MSG.sale_ask_method), 'account → how paid', A.state(u));
  A = bench();
  const card2 = A.card(u, ITEM, [Q('o|buyer')]);
  A.answer(u, Q('back|buyer'));
  check(A.state(u).step === 'card', 'one back to the card', A.state(u));
  const e0 = A.editsOf(card2.id), err0 = A.errorsOf().length;
  A.answer(u, Q('back|buyer'));
  check(A.state(u).step === 'card' && A.editsOf(card2.id) === e0 && A.errorsOf().length === err0, 'the SAME back button tapped twice moves one: the second carries a step the state has left (no edit, no Errors row)', { st: A.state(u), edits: A.editsOf(card2.id) - e0 });
  A.answer(u, Q('z'));
  const n0 = A.ledgerLen();
  check(A.state(u) === null && A.screen(u).text === cardText(A.ports, A.ports.store.getItem(ITEM)), '✖️ on the card is the item card');
  A.answer(u, 'S|S1-0002|1');
  check(A.ledgerLen() === n0 && A.state(u) && A.state(u).step === 'card' && A.screen(u).id === card2.id && A.screen(u).text.endsWith(txt('sale_line_paid', { paid: '18,000', owed: '0' })),
    'from that card S|id|1 again within 120 s opens the review card once more (nothing written: S is exempt from the tap guard in form mode)', { rows: A.ledgerLen() - n0, st: A.state(u) });
  A = bench();
  const card3 = A.card(u, ITEM, [Q('o|method'), 'LA|pm|SSA|S1-0002']);
  let s = A.screen(u);
  check(s.id === card3.id && s.text === MSG.add_ask_pm && same(s.datas, [[Q('back|method')]]) && A.state(u).purpose === 'add_option' && A.state(u).saved.step === 'method',
    'the ➕ prompt opened on how-paid carries [⏮ back|method] alone and keeps the basket in saved', { text: s.text, datas: s.datas });
  A.answer(u, Q('back|method'));
  check(A.state(u).kind === 'sale' && A.state(u).step === 'method' && A.screen(u).text.endsWith(MSG.sale_ask_method) && A.screen(u).id === card3.id, 'its back → how-paid with the basket state restored', A.state(u));
  A = bench();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), 'LA|pm|SSA|S1-0002']);
  s = A.screen(u);
  check(same(s.datas, [[Q('back|account')]]) && A.state(u).saved.step === 'account', 'the ➕ prompt opened on the account screen (after mix) carries back|account', s.datas);
  A.answer(u, Q('back|account'));
  check(A.state(u).step === 'account' && A.screen(u).text.endsWith(MSG.sale_ask_split_account), 'its back → the account screen');
  A.answer(u, Q('a|KBZ'));
  check(A.state(u) && A.state(u).kind === 'await_number' && A.state(u).saved.step === 'bank' && A.state(u).saved.draft.method === 'KBZ', 'where a|KBZ is still live (rule (c) passes): the transfer-part screen', A.state(u));
  A = bench();
  const lists0 = A.world.lists.length;
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), 'LA|pm|SSA|S1-0002', { type: 'CB ဦးကျော်' }]);
  check(A.state(u).step === 'kind' && A.state(u).draft.addLabel === 'CB ဦးကျော်', 'a name typed from the account screen → the kind screen', A.state(u));
  A.answer(u, Q('back|kind'));
  check(A.state(u).step === 'method' && A.state(u).draft.addLabel === undefined && A.world.lists.length === lists0 && A.screen(u).text.endsWith(MSG.sale_ask_method), 'back|kind → how paid (its parent), addLabel dropped, no row', A.state(u));
});

/* ============================== 12. cancel ============================== */

step('W12. Cancel: ✖️ on the card (its own row below Save) is the item card; on an older card it is expired; Z elsewhere is cancelled');
runStep(() => {
  const u = U.sister, item = () => A.ports.store.getItem(ITEM);
  let A = bench(), n0 = A.ledgerLen();
  const card = A.card(u, ITEM, [Q('o|method'), Q('m|KBZ')]);
  const rows = A.screen(u).datas;
  check(same(rows[rows.length - 1], [Q('z')]) && same(rows[rows.length - 2], ['SC|S1-0002|ok']), '✖️ sits on a row of its own below ✅ သိမ်း', rows);
  A.answer(u, Q('z'));
  check(A.screen(u).id === card.id && A.screen(u).text === cardText(A.ports, item()) && same(A.screen(u).message.keyboard, cardKeyboard(A.ports, item())) && A.state(u) === null && A.ledgerLen() === n0,
    '✖️ on the card → the message is cardText + cardKeyboard, state null, no row', A.screen(u).text);
  A = bench();
  A.card(u, ITEM, []);
  const subs = [];
  [['o|buyer'], ['o|method'], ['o|paid'], ['l|S1-0002'], ['add'], ['o|method', 'm|mix'], ['o|method', 'm|mix', 'a|KBZ']].forEach(path => {
    path.forEach(p => A.answer(u, Q(p)));
    subs.push(A.screen(u).flat.filter(d => /\|z$/.test(d) || d === 'Z').length);
    const st = saleStateOf(A.ports, String(u.id));
    A.answer(u, Q('back|' + st.step));
    if (saleStateOf(A.ports, String(u.id)).step !== 'card') A.answer(u, Q('back|' + saleStateOf(A.ports, String(u.id)).step));
  });
  check(subs.every(n => n === 0), 'no sub-screen carries ✖️ (buyer, how paid, paid now, a line, ➕, the accounts, the transfer part): ⏮ is the way out', subs);
  A = bench();
  A.scan(u, ITEM);
  A.answer(u, 'btn_discount');
  const prompt = A.screen(u);
  A.answer(u, 'Z');
  check(A.screen(u).id === prompt.id && prompt.message.text === MSG.cancelled && A.state(u) === null, '✖️ (Z) on the price prompt from the card → cancelled, state null');
  A = bench();
  const card2 = A.card(u, ITEM, [{ type: 'ဒေါ်မြင့်' }]);
  const live = JSON.stringify(A.state(u));
  check(A.screen(u).id !== card2.id, 'a typed answer moved the card to a new message');
  A.sim.tap(u, card2.id, Q('z'));
  check(card2.text === MSG.expired && JSON.stringify(A.state(u)) === live, '✖️ on the older card left behind → that message says expired, the live state unchanged', { text: card2.text, st: A.state(u) });
  A = bench();
  const card3 = A.card(u, ITEM, [Q('o|method')]);
  A.sim.start(u, '');
  A.answer(u, 'M|exp');
  check(A.state(u).kind === 'exp', 'M|exp mid-card opens the expense flow');
  A.sim.tap(u, card3.id, Q('z'));
  check(card3.text === MSG.expired && A.state(u).kind === 'exp' && A.state(u).step === 'cat', '✖️ on the old card → expired; the expense state is intact', { text: card3.text, st: A.state(u) });
  A = bench();
  const card4 = A.card(u, ITEM, []);
  A.ports.cache.remove('st:' + u.id);
  const err0 = A.errorsOf().length;
  A.sim.tap(u, card4.id, Q('z'));
  check(card4.text === cardText(A.ports, item()) && A.state(u) === null && A.errorsOf().length === err0, '✖️ on a card with no state at all → the item card, no Errors row', card4.text);
  A.sim.start(u, '');
  A.answer(u, 'M|find');
  const findPrompt = A.screen(u);
  A.answer(u, 'Z');
  check(findPrompt.message.text === MSG.cancelled && A.state(u) === null, 'Z elsewhere still answers cancelled', findPrompt.message.text);
});

/* ============================== 13. stale, double, expired ============================== */

step('W13. Stale, double, expired taps; a scan without ➕ pauses the card');
runStep(() => {
  const u = U.sister;
  let A = bench(), n0 = A.ledgerLen();
  const card = A.card(u, ITEM, []);
  const snap = JSON.stringify([card.text, card.keyboard]), e0 = A.editsOf(card.id), st0 = JSON.stringify(A.state(u));
  A.sim.tap(u, card.id, 'S|S1-0002|1');
  check(A.ledgerLen() === n0 && A.editsOf(card.id) === e0 && JSON.stringify([card.text, card.keyboard]) === snap && JSON.stringify(A.state(u)) === st0,
    'a second S|id|1 on the message that already shows this one-line card neither writes nor edits and keeps the state', { edits: A.editsOf(card.id) - e0 });
  A = bench();
  const card2 = A.card(u, ITEM, [Q('add')]);
  const addScreen = A.screen(u);
  A.sim.start(u, 'S1-0005');
  const newCard = A.screen(u), moved = addScreen.message.text, live2 = JSON.stringify(A.state(u));
  A.sim.tap(u, addScreen.id, Q('back|add'));
  check(moved === MSG.basket_moved && newCard.id !== addScreen.id && addScreen.message.text === MSG.expired && JSON.stringify(A.state(u)) === live2 && A.state(u).msgId === newCard.id &&
    A.state(u).draft.lines.length === 2, 'a tap on the add screen left behind after the scan moved the card down (it read basket_moved) → that message says expired, the live card with its two lines untouched',
    { moved, text: addScreen.message.text, st: A.state(u) });
  A = bench();
  const card3 = A.card(u, ITEM, [{ type: 'ဒေါ်မြင့်' }]);
  const screen2 = A.screen(u), stBefore = JSON.stringify(A.state(u));
  check(screen2.id !== card3.id && A.state(u).step === 'card', 'a typed answer moved the card to a new message');
  A.sim.tap(u, card3.id, Q('o|buyer'));
  check(card3.text === MSG.expired && JSON.stringify(A.state(u)) === stBefore && screen2.message.text.endsWith(txt('sale_line_paid', { paid: '18,000', owed: '0' })),
    'a tap on the earlier card → that message says expired, the live state unchanged', { text: card3.text });
  A = bench();
  const card4 = A.card(u, ITEM, [Q('o|buyer'), Q('b|C-0001'), Q('o|paid'), Q('p|half')]);
  check(A.state(u).step === 'due', 'the card is at the due sub-screen');
  const e4 = A.editsOf(card4.id), err4 = A.errorsOf().length, st4 = JSON.stringify(A.state(u));
  A.sim.tap(u, card4.id, Q('m|CASH'));
  check(A.editsOf(card4.id) === e4 && A.errorsOf().length === err4 && JSON.stringify(A.state(u)) === st4, 'SS|m|CASH on the live message while the state is at due → nothing changes (no edit, no Errors row)');
  A = bench(); n0 = A.ledgerLen();
  const card5 = A.card(u, ITEM, []);
  A.sim.tap(u, card5.id, 'SC|S1-0002|ok');
  A.sim.tap(u, card5.id, 'SC|S1-0002|ok');
  const g5 = A.lastRow().groupId;
  check(A.ledgerLen() === n0 + 1 && A.world.ledger.filter(r => r.groupId === g5).length === 1, 'two ✅ on the same message within 120 s write one group');
  A.tick(3);
  const bots5 = A.bots(u).length, soldText5 = card5.text;
  A.sim.tap(u, card5.id, 'SC|S1-0002|ok');
  check(A.ledgerLen() === n0 + 1 && A.bots(u).length === bots5 + 1 && A.screen(u).text === MSG.expired && card5.text === soldText5 && same(A.datas(card5), CARD_SOLD_ROWS(g5)),
    'tick(3) (past the 120 s guard) then SC replayed on the sold card → a new expired message, the card kept (isCommittedCard)', { last: A.screen(u).text });
  A.tick(11);
  A.sim.tap(u, card5.id, 'SC|S1-0002|ok');
  check(A.ledgerLen() === n0 + 1 && A.bots(u).length === bots5 + 2 && A.screen(u).text === MSG.expired && card5.text === soldText5, 'tick(11) (past the 600 s of isCommittedCard) then SC again → still a new expired message, the sold card kept (the sold_done text rule)');
  A = bench(); n0 = A.ledgerLen();
  const card6 = A.card(u, ITEM, [Q('o|buyer'), Q('b|C-0001'), Q('o|paid'), Q('p|half'), Q('d|7')]);
  A.tick(31);
  A.sim.tap(u, card6.id, 'SC|S1-0002|ok');
  const lastCard = A.screen(u);
  check(A.ledgerLen() === n0 && card6.text === MSG.expired && lastCard.id !== card6.id && lastCard.text === cardText(A.ports, A.ports.store.getItem(ITEM)) && same(lastCard.message.keyboard, cardKeyboard(A.ports, A.ports.store.getItem(ITEM))) && lastCard.message.photo,
    '✅ after tick(31) → expired on the message and a fresh item card as the last message, nothing written', { text: card6.text, last: lastCard.text });
  A = bench();
  const card7 = A.card(u, ITEM, [Q('o|method')]);
  A.scan(u, 'S1-0003');
  const st7 = A.state(u), item3 = A.screen(u);
  check(st7 && st7.kind === 'sale' && st7.paused === true && st7.step === 'method' && card7.text === txt('basket_paused', { n: '၁' }) && same(A.datas(card7), [[Q('go')]]) &&
    same(card7.keyboard.map(r => r.map(x => x.text)), [[MSG.btn_resume]]) && st7.resume === item3.id && same(item3.datas[0], ['SS|S1-0002|i|S1-0003']) && same(item3.texts[0], [MSG.btn_add_to_list]),
    'a scan of another tag without ➕ PAUSES the card: basket_paused with [↪️ → SS|<a>|go], the state kept (paused, resume = the new item card), and that card\'s first row is ➕ စာရင်းထဲ ထည့်', { st: st7, text: card7.text, datas: item3.datas });
  A.sim.tap(u, card7.id, Q('m|CASH'));
  check(card7.text === txt('basket_paused', { n: '၁' }) && A.state(u).paused === true, 'the paused card\'s old buttons do nothing while paused', A.state(u));
});

/* ============================== 14. sold meanwhile ============================== */

step('W14. Sold meanwhile: the card keeps the basket with basket_line_gone on top; the first tap still answers sale_gone; a SKU below zero still writes');
runStep(() => {
  const u = U.sister, o = U.owner;
  let A = bench(), n0;
  const card = A.card(u, 'S1-0001', ['SS|S1-0001|o|buyer', 'SS|S1-0001|b|C-0002', 'SS|S1-0001|o|paid', 'SS|S1-0001|p|half', 'SS|S1-0001|d|7']);
  A.card(o, 'S1-0001', ['SS|S1-0001|o|buyer', 'SS|S1-0001|b|C-0001', 'SC|S1-0001|ok']);
  n0 = A.ledgerLen();
  const fresh = A.ports.store.getItem('S1-0001');
  check(fresh.stock === 0 && A.lastRow().customerId === 'C-0001', 'the owner sells it first on the same world');
  A.sim.tap(u, card.id, 'SC|S1-0001|ok');
  check(A.ledgerLen() === n0 && card.text.indexOf(txt('basket_line_gone', { id: 'S1-0001' })) === 0 && A.state(u) && A.state(u).step === 'card' && A.state(u).draft.lines.length === 1 &&
    same(A.datas(card), CARD_ROWS('S1-0001', ['S1-0001'], true)),
    'the sister\'s ✅ keeps her card with basket_line_gone on top, writes nothing and keeps the basket (she removes the line or cancels)', { text: card.text, datas: A.datas(card) });
  A = bench();
  const card2 = A.scan(u, 'S1-0004');
  A.card(o, 'S1-0004', ['SC|S1-0004|ok']);
  n0 = A.ledgerLen();
  A.sim.tap(u, card2.id, A.sim.button(card2, MSG.btn_sold));
  const fresh2 = A.ports.store.getItem('S1-0004');
  check(A.ledgerLen() === n0 && card2.text === cardText(A.ports, fresh2) + '\n' + MSG.sale_gone && same(card2.keyboard, cardKeyboard(A.ports, fresh2)) && A.state(u) === null,
    'the owner sells S1-0004 first: the sister\'s FIRST tap (✅ ရောင်းပြီး on her stale card) answers sale_gone at once with no state', { text: card2.text });
  A = bench(); n0 = A.ledgerLen();
  A.card(u, 'S1-0003', ['SS|S1-0003|l|S1-0003', 'SS|S1-0003|q|9', 'SC|S1-0003|ok']);
  check(A.ledgerLen() === n0 + 1 && A.lastRow().qty === -9 && A.ports.store.getItem('S1-0003').stock === -6, 'a SKU below zero still writes (nine of three: stock -6)', A.lastRow());
});

/* ============================== 15. ➕ inside the sale ============================== */

step('W15. ➕ inside the card: the name, then the kind; nothing written before the kind; then how paid exits');
runStep(() => {
  const u = U.sister;
  let A = bench(), n0 = A.ledgerLen(), lists0 = A.world.lists.length;
  const card = A.card(u, ITEM, [Q('o|method'), 'LA|pm|SSA|S1-0002']);
  let s = A.screen(u), st = A.state(u);
  check(s.id === card.id && s.text === MSG.add_ask_pm && same(s.datas, [[Q('back|method')]]) && st.kind === 'await_text' && st.purpose === 'add_option' && st.resume.a === 'SSA' && st.saved.kind === 'sale' && st.saved.step === 'method',
    'LA|pm|SSA on how-paid edits it to add_ask_pm with [⏮ back|method] alone and keeps the basket in saved', { text: s.text, datas: s.datas, st });
  A.answer(u, { type: 'AYA ဦးမောင်' });
  s = A.screen(u); st = A.state(u);
  check(s.text.endsWith(txt('sale_ask_kind', { label: 'AYA ဦးမောင်' })) && same(s.datas, [[Q('k|wallet'), Q('k|bank')], [Q('back|kind')]]) && same(s.texts[0], [MSG.btn_kind_wallet, MSG.btn_kind_bank]) &&
    st.kind === 'sale' && st.step === 'kind' && st.draft.addLabel === 'AYA ဦးမောင်' && A.world.lists.length === lists0,
    'typed AYA ဦးမောင် → sale_ask_kind with [📲 Pay အကောင့်, 🏛 ဘဏ်အကောင့်] and NO Lists row yet', { text: s.text, datas: s.datas, lists: A.world.lists.length - lists0 });
  A.answer(u, Q('k|bank'));
  s = A.screen(u); st = A.state(u);
  const added = A.world.lists.filter(r => r.list === 'pay_method' && r.label === 'AYA ဦးမောင်')[0];
  check(!!added && added.kind === 'bank' && A.world.lists.length === lists0 + 1 && s.text.indexOf(txt('add_done', { label: 'AYA ဦးမောင်' })) === 0 && st.step === 'card' &&
    st.draft.method === added.key && st.draft.addedKey === added.key && st.draft.addLabel === undefined,
    '🏛 ဘဏ်အကောင့် → one Lists row with kind bank; the card comes back prefixed add_done; draft.method is the new key', { s: s.text, st, added });
  A.answer(u, 'SC|S1-0002|ok');
  s = A.screen(u);
  const g = A.lastRow().groupId;
  check(A.ledgerLen() === n0 + 1 && A.lastRow().method === added.key && s.text.indexOf(txt('acct_detail_hint', { label: 'AYA ဦးမောင်' })) >= 0 && same(s.datas, [['U|' + g, 'RC|' + g], ['LD|pm|' + added.key]]),
    'the sold card carries acct_detail_hint and [🔢 LD|pm|<key>]; the row is on the new account', { datas: s.datas, text: s.text });
  A.card(u, ITEM, [Q('o|method')]);
  s = A.screen(u);
  check(s.flat.indexOf(Q('m|' + added.key)) < 0 && s.flat.indexOf(Q('m|bank')) >= 0, 'the next sale\'s how-paid shows the new account behind 🏛 ဘဏ် only', s.datas);
  A.answer(u, Q('m|bank'));
  s = A.screen(u);
  check(s.text.endsWith(MSG.sale_ask_account) && same(s.datas.slice(0, 2), [[Q('a|BANK')], [Q('a|' + added.key)]]) && s.texts[1][0] === '🏦 AYA ဦးမောင်', 'and 🏛 ဘဏ် lists ဘဏ်လွှဲ and AYA ဦးမောင် as 🏦 rows', { datas: s.datas, texts: s.texts });
  A = bench();
  A.setAccounts([{ key: 'KBZ', label: 'KBZPay' }]);
  A.card(u, ITEM, [Q('o|method'), 'LA|pm|SSA|S1-0002', { type: 'Wave ဦးမောင်' }, Q('k|wallet'), 'SC|S1-0002|ok']);
  const wallet = A.world.lists.filter(r => r.list === 'pay_method' && r.label === 'Wave ဦးမောင်')[0];
  A.card(u, ITEM, [Q('o|method')]);
  s = A.screen(u);
  check(!!wallet && wallet.kind === 'wallet' && same(s.datas.slice(0, 3), [[Q('m|CASH')], [Q('m|KBZ')], [Q('m|' + wallet.key)]]) && s.texts[2][0] === '📲 Wave ဦးမောင်',
    'on another bench 📲 Pay အကောင့် → the next how-paid shows the new wallet by name', { datas: s.datas, texts: s.texts });
  A = bench(); lists0 = A.world.lists.length;
  A.card(u, ITEM, [Q('o|method'), 'LA|pm|SSA|S1-0002', { type: 'KBZPay' }]);
  s = A.screen(u); st = A.state(u);
  check(s.text.indexOf(txt('add_exists', { label: 'KBZPay' })) === 0 && st.step === 'card' && st.draft.method === 'KBZ' && A.world.lists.length === lists0 && s.text.indexOf(head('sale_ask_kind')) < 0,
    'typed an existing label (KBZPay) → add_exists, no kind question, no second row, the method chosen, the card', { text: s.text, st });
  A = bench(); lists0 = A.world.lists.length;
  A.card(u, ITEM, [Q('o|method'), 'LA|pm|SSA|S1-0002', { type: '5000' }]);
  s = A.screen(u); st = A.state(u);
  check(s.text === MSG.add_ask_pm && same(s.datas, [[Q('back|method')]]) && st.purpose === 'add_option' && st.saved.msgId === s.id && A.world.lists.length === lists0, 'typed 5000 → add_ask_pm again (the state kept on the new message), no row', { text: s.text, st });
  A.answer(u, { type: 'AYA ဦးမောင်' });
  A.answer(u, Q('back|kind'));
  st = A.state(u);
  check(st.kind === 'sale' && st.step === 'method' && st.draft.addLabel === undefined && A.world.lists.length === lists0 && A.screen(u).text.endsWith(MSG.sale_ask_method), 'back|kind → how-paid with addLabel dropped and no row', st);
  A = bench(); n0 = A.ledgerLen();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), 'LA|pm|SSA|S1-0002']);
  check(same(A.screen(u).datas, [[Q('back|account')]]), 'mix → the account screen → ➕: its prompt carries back|account');
  A.answer(u, { type: 'CB ဦးကျော်' });
  A.answer(u, Q('k|bank'));
  s = A.screen(u); st = A.state(u);
  const cb = A.world.lists.filter(r => r.list === 'pay_method' && r.label === 'CB ဦးကျော်')[0];
  check(!!cb && s.text.indexOf(txt('add_done', { label: 'CB ဦးကျော်' })) === 0 && s.text.endsWith(txt('split_ask_amount', { method: 'CB ဦးကျော်', cash: '18,000' })) && st.kind === 'await_number' && st.saved.step === 'bank' && st.saved.draft.method === cb.key,
    '🏛 → the next screen is split_ask_amount for the new account (never the card first)', { text: s.text, st });
  A.answer(u, { type: '6000' });
  A.answer(u, 'SC|S1-0002|ok');
  const rows = A.world.ledger.slice(n0);
  check(rows.length === 2 && rows[0].cash === 12000 && rows[0].method === 'CASH' && rows[0].note === 'split' && rows[1].amount === 6000 && rows[1].method === cb.key, 'typed 6000, ✅ → SALE (cash 12,000, CASH, split) + PAYMENT (6,000, the new key)', rows);
  A = bench();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), 'LA|pm|SSA|S1-0002', { type: 'WavePay' }]);
  s = A.screen(u); st = A.state(u);
  check(s.text.indexOf(txt('add_exists', { label: 'WavePay' })) === 0 && s.text.endsWith(txt('split_ask_amount', { method: 'WavePay', cash: '18,000' })) && st.saved.draft.method === 'WAVE' && st.saved.draft.mixed === true,
    'mix → ➕ → an EXISTING label → split_ask_amount as well', { text: s.text, st });
});

/* ============================== 16. menu survives, scan pauses ============================== */

step('W16. Menu taps keep the card; M|find replaces it; a scan pauses it');
runStep(() => {
  const u = U.sister;
  let A = bench();
  const card = A.card(u, ITEM, [Q('o|method')]);
  const st0 = JSON.stringify(A.state(u));
  A.sim.start(u, '');
  A.answer(u, 'M|today');
  check(JSON.stringify(A.state(u)) === st0 && A.screen(u).text.indexOf('📊') === 0, 'M|today mid-card keeps the basket state', A.state(u));
  A.sim.tap(u, card.id, Q('m|CASH'));
  check(A.state(u).step === 'card' && card.text.endsWith(txt('sale_line_paid', { paid: '18,000', owed: '0' })), 'and the card\'s buttons still work afterwards (💵 → the card)', card.text);
  A = bench();
  const card2 = A.card(u, ITEM, [Q('o|method')]);
  A.sim.start(u, '');
  A.answer(u, 'M|find');
  check(A.state(u).kind === 'find', 'M|find mid-card replaces the state (kind find)', A.state(u));
  A.sim.tap(u, card2.id, Q('m|CASH'));
  const last = A.screen(u);
  check(card2.text === MSG.expired && last.id !== card2.id && last.text === cardText(A.ports, A.ports.store.getItem(ITEM)), 'the card\'s next tap answers expired + a fresh item card', { text: card2.text, last: last.text });
  A = bench();
  A.card(u, ITEM, [Q('o|method')]);
  A.scan(u, 'S1-0001');
  check(A.state(u) && A.state(u).paused === true && A.state(u).draft.lines.length === 1, 'a scan pauses it (the basket is kept, never lost by a scan)', A.state(u));
});

/* ============================== 17. the quick switch ============================== */

step('17. Quick switch: sale_flow = quick keeps the one-tap card exactly; the value is read on every tap');
runStep(() => {
  const u = U.sister;
  const Q = bench({ quick: true }), n0 = Q.ledgerLen();
  check(Q.world.settings.sale_flow === 'quick' && saleFlow(Q.ports) === 'quick', 'seedSimWorld sets sale_flow quick and saleFlow reads it');
  const card = Q.scan(u, ITEM);
  Q.answer(u, 'btn_sell_one');
  const g = Q.lastRow().groupId;
  check(Q.ledgerLen() === n0 + 1 && Q.lastRow().cash === 18000 && same(Q.datas(card), [['U|' + g, 'RC|' + g], ['CR|' + g, 'CU|' + g], ['PM|' + g + '|KBZ', 'PM|' + g + '|WAVE', 'PM|' + g + '|BANK'], ['SX|' + g, 'LA|pm|PM|' + g]]),
    'scan + ✅ ရောင်း ၁ writes at once and the card has afterSaleKeyboard\'s rows exactly as run_round4 step 1', Q.datas(card));
  Q.scan(u, ITEM);
  Q.answer(u, 'btn_discount');
  Q.answer(u, { type: '15000' });
  check(Q.ledgerLen() === n0 + 2 && Q.lastRow().qty === -1 && Q.lastRow().unitPrice === 15000 && Q.lastRow().note === 'spoken price', '💬 + a price writes one piece at once', Q.lastRow());
  Q.scan(u, ITEM);
  Q.answer(u, 'Q|S1-0002');
  const grid = Q.screen(u);
  check(same(grid.datas, [['S|S1-0002|2', 'S|S1-0002|3', 'S|S1-0002|4', 'S|S1-0002|5'], ['S|S1-0002|6', 'S|S1-0002|7', 'S|S1-0002|8', 'S|S1-0002|9'], ['QN|S1-0002', 'Z']]) && grid.text === MSG.ask_qty + '\n' + ITEM + ' · ' + Q.ports.store.getItem(ITEM).name,
    'askQty has S|id|n digits and [QN, Z], its text unchanged', grid.datas);
  Q.answer(u, 'Z');
  const allData = (Q.world.chats[u.id] || []).reduce((a, m) => a.concat(Q.flat(m)), []);
  check(allData.length > 20 && allData.every(d => !/^(SS|SC|NI|NC)\|/.test(d) && d.indexOf('LA|pm|SSA') < 0 && !/^SS\|[^|]*\|o\|/.test(d)),
    'no SS| (no SS|…|o| card button), SC|, NI|, NC| or LA|pm|SSA button anywhere in the quick world', allData.filter(d => /^(SS|SC|NI|NC)\|/.test(d)));
  const modeOf = v => { const w = createSimWorld(); if (v !== undefined) w.settings.sale_flow = v; return saleFlow(w.ports); };
  check(modeOf('QUICK ') === 'quick' && modeOf('Quick') === 'quick' && modeOf('steps') === 'form' && modeOf('x') === 'form' && modeOf(undefined) === 'form' && modeOf('') === 'form' && modeOf('form') === 'form',
    "'QUICK ', 'Quick' read quick; 'steps', 'x', a blank and a missing key read form", [modeOf('QUICK '), modeOf('Quick'), modeOf('steps'), modeOf('x'), modeOf(undefined)]);
  Q.world.settings.sale_flow = 'form';
  const n1 = Q.ledgerLen();
  Q.scan(u, ITEM);
  Q.answer(u, 'btn_sell_one');
  check(Q.ledgerLen() === n1 && Q.state(u) && Q.state(u).kind === 'sale' && Q.state(u).step === 'card' && Q.screen(u).text.endsWith(txt('sale_line_paid', { paid: '18,000', owed: '0' })),
    'flipped to form between two sales: the next tap shows the review card instead of writing');
  Q.answer(u, 'SS|S1-0002|z');
  Q.world.settings.sale_flow = 'quick';
  Q.scan(u, ITEM);
  Q.answer(u, 'btn_sell_one');
  check(Q.ledgerLen() === n1 + 1 && Q.state(u) === null, 'flipped back to quick: the next tap writes again, without a restart');
});

/* ============================== 18. voice ============================== */

step('18. Voice: the spoken sale keeps the corrective card; spoken answers land in the open sub-screen');
runStep(() => {
  const u = U.sister;
  const A = bench(), n0 = A.ledgerLen();
  A.scan(u, ITEM);
  A.sim.voice(u, 'ဒါ ၂ ထည် ရောင်းရတယ်');
  const confirm = A.screen(u);
  check(confirm.text.indexOf(txt('confirm_sale', { qty: '၂', name: 'လုံချည် ကချင် အပြာ', amount: '36,000' })) >= 0 && A.ledgerLen() === n0 && same(confirm.texts[0], [MSG.btn_yes, MSG.btn_no]), 'the spoken sale shows the confirm card (nothing written)', confirm.text);
  A.answer(u, 'btn_yes');
  const g = A.lastRow().groupId, s = A.screen(u);
  check(A.ledgerLen() === n0 + 1 && A.lastRow().qty === -2 && same(s.datas, [['U|' + g, 'RC|' + g], ['CR|' + g, 'CU|' + g], ['PM|' + g + '|KBZ', 'PM|' + g + '|WAVE', 'PM|' + g + '|BANK'], ['SX|' + g, 'LA|pm|PM|' + g]]),
    '✅ writes as today and shows afterSaleKeyboard (the corrective rows) in steps mode too', s.datas);
  A.card(u, ITEM, [Q('o|buyer'), { voice: 'ဒေါ်မြင့်' }]);
  check(A.state(u).draft.customerId === 'C-0001' && A.state(u).step === 'card', 'a spoken ဒေါ်မြင့် on the buyer sub-screen picks her (back to the card)', A.state(u));
  A.answers(u, [Q('o|paid'), { voice: 'တစ်သောင်း' }]);
  check(A.state(u).draft.paid === 10000 && A.state(u).draft.part === true && A.state(u).step === 'due', 'a spoken တစ်သောင်း on the paid sub-screen stores 10,000 (and basketNext moves on: the buyer is known)', A.state(u));
  A.answer(u, Q('back|due'));
  A.answer(u, Q('z'));
  A.card(u, ITEM, [Q('l|S1-0002'), { voice: 'သုံး' }]);
  check(A.state(u).step === 'card' && A.state(u).draft.lines[0].qty === 3 && A.screen(u).text.indexOf('× ၃ · 54,000') >= 0, 'a spoken သုံး (qty 3) on the open line → its count 3, the card', A.state(u));
});

/* ============================== 19. the owner ============================== */

step('W19. Owner: the same card, shop-2 recents and accounts for a shop-2 piece, V|g on a mixed group');
runStep(() => {
  const o = U.owner, br = U.brother, si = U.sister;
  const A = bench(), n0 = A.ledgerLen();
  A.setAccounts([{ key: 'S2PAY', label: 'Wave ဆိုင်၂', shop: 'S2' }, { key: 'KBZ', label: 'KBZPay' }]);
  A.card(br, 'S2-0002', ['SS|S2-0002|o|buyer', 'SS|S2-0002|b|C-0002', 'SC|S2-0002|ok']);
  A.card(si, ITEM, [Q('o|buyer'), Q('b|C-0001'), 'SC|S1-0002|ok']);
  check(A.ledgerLen() === n0 + 2, 'a shop-2 sale to ဒေါ်ခင် and a shop-1 sale to ဒေါ်မြင့် were written by the sellers');
  A.card(o, 'S2-0001', ['SS|S2-0001|o|buyer']);
  let s = A.screen(o);
  check(s.text.endsWith(MSG.credit_ask_customer + '\n' + MSG.cust_find) && same(s.datas[1], ['SS|S2-0001|b|C-0002']), 'the owner\'s card is identical and the buyer sub-screen of a shop-2 piece lists ဒေါ်ခင် (the shop-2 buyer) first', s.datas);
  A.answers(o, ['SS|S2-0001|b|none', 'SS|S2-0001|o|method']);
  s = A.screen(o);
  check(same(s.datas.slice(0, 3), [['SS|S2-0001|m|CASH'], ['SS|S2-0001|m|S2PAY'], ['SS|S2-0001|m|KBZ']]) && s.texts[1][0] === '📲 Wave ဆိုင်၂', 'the how-paid sub-screen lists the shop-2 account first (keyed on the basket\'s shop, not staff.shop)', s.texts);
  A.answers(o, ['SS|S2-0001|m|mix', 'SS|S2-0001|a|KBZ', { type: '20000' }, 'SC|S2-0001|ok']);
  const g = A.lastRow().groupId, rows = A.rowsOf(g);
  check(rows.length === 2 && rows[0].shop === 'S2' && rows[1].method === 'KBZ', 'the owner\'s mixed sale of the shop-2 piece writes two rows in shop 2', rows);
  A.answer(o, 'V|' + g);
  const after = A.rowsOf(g);
  check(after.length === 4 && A.liveOf(g).length === 0 && after.slice(2).every(r => r.note === 'void by owner') && A.screen(o).text.indexOf(MSG.void_done) === 0, 'V|g voids the mixed group (both rows mirrored)', after.map(r => [r.type, r.note]));
  A.card(si, ITEM, [Q('o|method')]);
  check(A.screen(si).flat.indexOf(Q('m|S2PAY')) < 0 && A.screen(si).flat.indexOf(Q('m|KBZ')) >= 0, 'the shop-2 account is absent under a shop-1 sale', A.screen(si).datas);
  A.card(o, 'S2-0002', ['SS|S2-0002|add']);
  A.sim.start(o, 'S1-0003');
  check(A.screen(o).text.indexOf(txt('basket_other_shop', { id: 'S1-0003', shop: shopName(A.ports, 'S1') })) === 0 && A.state(o).draft.lines.length === 1,
    'the owner may sell either shop, but not both in one basket: a shop-1 tag at the add screen of a shop-2 basket is refused (basket_other_shop)', A.screen(o).text.split('\n')[0]);
});

/* ============================== 20. receipt and reports ============================== */

step('20. Receipt and reports: the due line, the ပေးမည့်ရက် column, a quick credit without a date');
runStep(() => {
  const u = U.sister, due10 = addDaysKey(today, 10);
  const datedPart = ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0001', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|type', { type: dmy(due10) }, 'SC|S1-0004|ok'];
  const A = bench();
  A.setAccounts([{ key: 'KBZ', label: 'KBZPay', detail: '09 777 123456 ဦးမောင်' }]);
  A.card(u, 'S1-0004', datedPart);
  const g = A.lastRow().groupId;
  A.answer(u, 'RC|' + g);
  const rc = A.screen(u).text, lines = rc.split('\n');
  const at = prefix => lines.findIndex(l => l.indexOf(prefix) === 0);
  const iTotal = at('စုစုပေါင်း'), iTransfer = at(head('receipt_transfer')), iDue = at(head('sale_due_set')), iCust = at(head('receipt_customer'));
  check(iTotal >= 0 && iTransfer > iTotal && iDue > iTransfer && iCust > iDue && lines[iDue] === txt('sale_due_set', { owed: '22,500', date: fmtDayMy(due10) }),
    'RC|g: receipt_total, then receipt_transfer, then sale_due_set, then receipt_customer', { iTotal, iTransfer, iDue, iCust, rc });
  const rep = receiptReport(A.ports, buildReceipt(A.ports, g), A.world.nowOverride), fl = rep.footer.split('\n');
  check(fl.indexOf(txt('sale_due_set', { owed: '22,500', date: fmtDayMy(due10) })) === fl.length - 2 && fl[fl.length - 1] === MSG.receipt_thanks && fl[0].indexOf(head('receipt_transfer')) === 0 && rep.subtitle.indexOf(head('sale_due_set')) < 0,
    'receiptReport: the due line sits in the footer below the account line and above receipt_thanks, never in the subtitle', rep.footer);
  const B = bench();
  B.card(u, 'S1-0004', datedPart);
  const gB = B.lastRow().groupId;
  const creditSection = report => report.sections.filter(s => s.columns.indexOf('ပေးမည့်ရက်') >= 0)[0];
  const cellOf = (report, nameIdx) => { const sec = creditSection(report); const row = sec.rows.filter(r => r[nameIdx] === 'ဒေါ်မြင့်' && r.indexOf(22500) >= 0)[0]; return { sec, row, cell: row ? row[row.length - 1] : null }; };
  const owed1 = cellOf(buildReport(B.ports, 'owed', { now: B.world.nowOverride }), 0);
  check(!!owed1.sec && owed1.sec.columns[owed1.sec.columns.length - 1] === 'ပေးမည့်ရက်' && owed1.cell === fmtDayShortMy(due10) && owed1.sec.totals[0].length === owed1.sec.columns.length,
    'the owed report has the ပေးမည့်ရက် column after ရက် with the date (no ⏰ yet); the totals row has one more cell', { cols: owed1.sec && owed1.sec.columns, cell: owed1.cell });
  B.tick(11 * 1440);
  const nowB = B.world.nowOverride;
  const owed2 = cellOf(buildReport(B.ports, 'owed', { now: nowB }), 0), month2 = cellOf(buildReport(B.ports, 'month', { now: nowB }), 0), cust2 = cellOf(buildReport(B.ports, 'customer', { customerId: 'C-0001', now: nowB }), -1);
  const custRow = cust2.sec && cust2.sec.rows.filter(r => r.indexOf(22500) >= 0)[0];
  check(owed2.cell === '⏰ ' + fmtDayShortMy(due10) && month2.cell === '⏰ ' + fmtDayShortMy(due10) && !!custRow && custRow[custRow.length - 1] === '⏰ ' + fmtDayShortMy(due10) && cust2.sec.columns[cust2.sec.columns.length - 1] === 'ပေးမည့်ရက်',
    'once overdue the owed report, the month report and the customer statement print ⏰ before the date', { owed: owed2.cell, month: month2.cell, cust: custRow && custRow[custRow.length - 1] });
  const Q = bench({ quick: true });
  Q.scan(u, ITEM);
  Q.answer(u, 'btn_sell_one');
  const gQ = Q.lastRow().groupId, staff = Q.ports.store.getStaff('1001');
  const r = convertSaleToCredit(Q.ports, gQ, 5000, 'C-0001', staff, 'u1');
  check(r.ok && r.txs[1].dueDay === '' && r.txs[1].note === 'credit' && saleGroupInfo(Q.ports, gQ).dueDay === '' && openCredits(Q.ports, null).filter(c => c.groupId === gQ)[0].dueDay === '',
    'convertSaleToCredit on a quick sale leaves dueDay blank on the replacement, in saleGroupInfo and in openCredits', r.txs[1]);
});

/* ============================== 21. ledger helpers ============================== */

step('21. Ledger helpers: newTx, rewriteRows, saleGroupInfo, CREDIT_COLS, creditOverdue');
runStep(() => {
  const u = U.sister, due10 = addDaysKey(today, 10);
  const A = bench(), staff = A.ports.store.getStaff('1001');
  const tx = newTx(A.ports, { shop: 'S1', itemId: ITEM, type: 'SALE', qty: -1, amount: 18000, cash: 18000 });
  check(Object.keys(tx).length === 27 && tx.dueDay === '' && Object.keys(tx)[26] === 'dueDay' && CFG.LEDGER_COLS.length === 27 && CFG.LEDGER_COLS[26] === 'DueDay',
    'newTx has 27 keys, dueDay last and blank; LEDGER_COLS has DueDay as its 27th name', Object.keys(tx));
  check(newTx(A.ports, { shop: 'S1', type: 'SALE', dueDay: due10 }).dueDay === due10, 'newTx keeps a given dueDay');
  A.card(u, 'S1-0004', ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0001', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|type', { type: dmy(due10) }, 'SC|S1-0004|ok']);
  const g = A.lastRow().groupId;
  const r1 = rewriteGroup(A.ports, g, { method: 'KBZ' }, staff, 'u1', { noteIfBlank: 'method' });
  check(r1.ok && r1.txs[0].dueDay === '' && r1.txs[1].dueDay === due10 && r1.row.method === 'KBZ', 'a method change keeps dueDay on the replacement and leaves the mirror blank', r1.txs.map(x => x.dueDay));
  const r2 = rewriteGroup(A.ports, g, { customerId: 'C-0002' }, staff, 'u2');
  const r3 = rewriteGroup(A.ports, g, { note: 'late' }, staff, 'u3');
  check(r2.ok && r2.row.dueDay === due10 && r3.ok && r3.row.dueDay === due10 && r3.row.note === 'late', 'a customer attach and a note change keep it too', [r2.row.dueDay, r3.row.dueDay]);
  const r4 = rewriteGroup(A.ports, g, { dueDay: addDaysKey(today, 20) }, staff, 'u4');
  check(r4.ok && r4.row.dueDay === addDaysKey(today, 20) && saleGroupInfo(A.ports, g).dueDay === addDaysKey(today, 20), 'changes.dueDay replaces it; saleGroupInfo reads the live row after the rewrites', saleGroupInfo(A.ports, g).dueDay);
  check(CFG.CREDIT_COLS.length === 15 && CFG.CREDIT_COLS[13] === 'DueDay' && CFG.CREDIT_COLS[14] === 'Overdue', 'CREDIT_COLS has 15 names, DueDay and Overdue last', CFG.CREDIT_COLS);
  check(creditOverdue(addDaysKey(today, 5), 40, today) === false && creditOverdue(today, 40, today) === false && creditOverdue(addDaysKey(today, -1), 0, today) === true && creditOverdue('', 29, today) === false && creditOverdue('', 30, today) === true,
    'creditOverdue: dated in the future with days 40 → no; dated today → no; dated yesterday → yes; undated 29 days → no; undated 30 → yes');
  const u5 = undoGroup(A.ports, g, staff, A.world.nowOverride, { force: true });
  check(u5.ok && A.rowsOf(g).slice(-1)[0].dueDay === '', 'an undo mirror leaves dueDay blank');
});

/* ============================== 22. Kind in the core ============================== */

step('22. Kind in the core: listNormRow, methodKind, payMethodsByKind, the compact row, listUpsert, addListOptionByLabel, listFindByLabel, the date helpers');
runStep(() => {
  const A = bench();
  const base = { list: 'pay_method', key: 'AYA', label: 'AYA', active: true, order: 5, shop: '', detail: '', note: '' };
  const plain = listNormRow('pay_method', base), banked = listNormRow('pay_method', Object.assign({}, base, { kind: 'Bank ' })), odd = listNormRow('pay_method', Object.assign({}, base, { kind: 'x' }));
  check(Object.keys(plain).length === 8 && Object.keys(banked).length === 9 && banked.kind === 'bank' && Object.keys(odd).length === 8 && odd.kind === undefined,
    'listNormRow: no kind → eight fields; "Bank " → nine with kind bank; "x" → eight', { plain: Object.keys(plain), banked, odd: Object.keys(odd) });
  check(methodKind(plain) === 'wallet' && methodKind(Object.assign({}, plain, { kind: 'wallet' })) === 'wallet' && methodKind(banked) === 'bank' && methodKind(listNormRow('pay_method', { key: 'BANK', label: 'ဘဏ်လွှဲ' })) === 'bank' &&
    methodKind(listNormRow('pay_method', { key: 'BANK', label: 'x', kind: 'wallet' })) === 'wallet', 'methodKind: blank → wallet, wallet, bank, the legacy BANK key → bank, BANK with an explicit wallet → wallet');
  check(same(payMethodsByKind(A.ports, 'S1'), { wallets: ['KBZ', 'WAVE'], banks: ['BANK'] }), 'payMethodsByKind on the seed = {wallets: [KBZ, WAVE], banks: [BANK]}', payMethodsByKind(A.ports, 'S1'));
  A.world.lists.push({ list: 'pay_method', key: 'THIRTEENBYTES', label: 'long', active: true, order: 9, shop: '', detail: '', note: '', kind: 'bank' });
  check(payMethodsByKind(A.ports, 'S1').banks.indexOf('THIRTEENBYTES') < 0 && payMethods(A.ports, 'S1').indexOf('THIRTEENBYTES') < 0, 'a 13-byte key is dropped as payMethods drops it');
  A.world.lists.pop();
  const c1 = listRowToCompact(plain), c2 = listRowToCompact(banked);
  check(same(Object.keys(c1), ['k', 'l', 'a', 'o', 's', 'd']) && c2.t === 'bank' && same(listRowFromCompact('pay_method', c2), banked) && same(listRowFromCompact('pay_method', c1), plain),
    'listRowToCompact adds t only when set; the round trip keeps the kind and the shape', { c1, c2 });
  const expected = {};
  CFG.LIST_NAMES.forEach(name => { expected[name] = listNormRows(null, name, A.ports.store.listOptions(name)).map(r => ({ k: r.key, l: r.label, a: r.active ? 1 : 0, o: r.order, s: r.shop, d: r.detail })); });
  check(listsJsonFor(A.ports) === JSON.stringify(expected) && listsJsonFor(A.ports).indexOf('"t"') < 0, 'listsJsonFor of the seeded lists is byte-identical to the round-4 string (no t)', listsJsonFor(A.ports).slice(0, 120));
  const up = listUpsert(A.ports.store.listOptions('pay_method'), { list: 'pay_method', key: 'AYA', label: 'AYA', kind: 'bank' }, []);
  const dup = listUpsert(up.rows, { list: 'pay_method', key: 'AYA', label: 'AYA', kind: 'wallet' }, []);
  check(up.status === 'ok' && up.ops[0].op === 'append' && up.ops[0].row.kind === 'bank' && up.rows.slice(-1)[0].kind === 'bank' && dup.status === 'dup' && dup.rows.slice(-1)[0].kind === 'bank',
    "listUpsert's append carries the kind; a later rec with another kind on the same key is dup and changes nothing", { up: up.ops, dup: dup.status });
  const recs = [], realAdd = A.ports.store.addListOption;
  A.ports.store.addListOption = function (rec, seed) { recs.push(Object.keys(rec).slice().sort()); return realAdd.call(this, rec, seed); };
  const staff = A.ports.store.getStaff('1001');
  const r1 = addListOptionByLabel(A.ports, 'pay_method', 'AYA ဦးမောင်', staff, { kind: 'bank' });
  const r2 = addListOptionByLabel(A.ports, 'pay_method', 'CB ဦးကျော်', staff);
  const r3 = addListOptionByLabel(A.ports, 'pay_method', 'Yoma ဦးစိုး', staff, { kind: '' });
  check(r1.created && A.option('pay_method', r1.key).kind === 'bank' && same(recs[0], ['key', 'kind', 'label', 'list', 'note', 'shop']) && r2.created && A.option('pay_method', r2.key).kind === undefined &&
    same(recs[1], ['key', 'label', 'list', 'note', 'shop']) && r3.created && same(recs[2], ['key', 'label', 'list', 'note', 'shop']),
    "addListOptionByLabel(…, {kind: 'bank'}) stores it and the rec has a kind key; without extra and with {kind: ''} the rec's keys are exactly key, label, list, note, shop", recs);
  A.ports.store.addListOption = realAdd;
  const zw = String.fromCharCode(0x200b);
  check(listFindByLabel(A.ports, 'pay_method', '5000').reason === 'empty' && listFindByLabel(A.ports, 'pay_method', 'တစ်သောင်း').reason === 'empty' && listFindByLabel(A.ports, 'pay_method', '  ').reason === 'empty',
    'listFindByLabel: digits, an amount in words and blanks are empty');
  const f1 = listFindByLabel(A.ports, 'pay_method', 'kbzpay'), f2 = listFindByLabel(A.ports, 'pay_method', 'KBZ Pay'), f3 = listFindByLabel(A.ports, 'pay_method', 'KBZ' + zw + 'Pay'), f4 = listFindByLabel(A.ports, 'pay_method', 'UAB ဦးမောင်');
  check(f1.existed === true && f1.key === 'KBZ' && f2.existed === true && f2.key === 'KBZ' && f3.existed === true && f3.key === 'KBZ' && f4.ok === true && f4.existed === false && f4.label === 'UAB ဦးမောင်' && f4.key === undefined,
    'existed by case, spacing and a zero-width space; a free name comes back clean with no key (nothing written)', { f1, f2, f3, f4 });
  check(listFindByLabel(A.ports, 'nothing', 'x').reason === 'unavailable', 'an unknown list is unavailable');
  const B = bench();
  check(B.ports.store.listOptions('pay_method').every(r => !Object.prototype.hasOwnProperty.call(r, 'kind')) && Object.keys(B.ports.store.listOptions('pay_method')[0]).length === 8, 'sim_ports.listOptions returns no kind for a raw row without one (eight fields)');
  B.ports.store.setListRow('pay_method', 'kbz', { kind: 'bank', active: false });
  check(B.ports.store.listOptions('pay_method').filter(r => r.key === 'KBZ')[0].kind === 'bank' && listOption(B.ports, 'pay_method', 'KBZ').active === false, 'setListRow (any key case) sets kind and active on the raw row');
  const now = A.world.nowOverride, past = addDaysKey(today, -7), pd = dm(past);
  check(parseDayText('2026-12-30', now) === '2026-12-30' && parseDayText('2026-13-30', now) === null && parseDayText('2026-02-30', now) === null, 'parseDayText reads yyyy-mm-dd and refuses an impossible one');
  check(parseDayText(pd, now, { noRoll: true }) === past && parseDayText(pd, now) === (Number(past.slice(0, 4)) + 1) + past.slice(4) && parseDayText(dmy(past), now, { noRoll: true }) === past,
    'a yearless past date stays in this year with noRoll and rolls to next year without opts; a dated past date stays', { noRoll: parseDayText(pd, now, { noRoll: true }), roll: parseDayText(pd, now) });
  check(addDaysKey('2026-12-30', 3) === '2027-01-02' && daysBetweenKeys('2026-12-30', '2027-01-02') === 3 && daysBetweenKeys('2027-01-02', '2026-12-30') === -3, 'addDaysKey and daysBetweenKeys work in this load set');
  const ctxB = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/core_burmese.js'), 'utf8'), ctxB);
  const ordersSrc = fs.readFileSync(path.join(ROOT, 'apps-script/core_orders.js'), 'utf8');
  check(vm.runInContext("typeof addDaysKey === 'function' && typeof daysBetweenKeys === 'function' && typeof parseDayText === 'function'", ctxB) === true &&
    !/function (addDaysKey|daysBetweenKeys|parseDayText)\b/.test(ordersSrc), 'the three date helpers live in core_burmese.js alone (defined there, not in core_orders.js)');
});

/* ============================== 22z. found by round 5's step-1 checker, on the review card ============================== */

step('W22z. The transfer part after a whole-amount answer, sold cards and late taps, back from the look-alikes, a racing ➕');
runStep(() => {
  const u = U.sister;
  // (1) mix → KBZ → the whole amount typed (the payment goes on KBZ alone) → how paid → mix → KBZ again → a real part: mixed again.
  const A = bench(), n0 = A.ledgerLen();
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '18000' }]);
  check(A.state(u).step === 'card' && A.state(u).draft.mixed === false, 'the whole amount typed as the transfer part puts the payment on KBZ alone (mixed false)', A.state(u));
  A.answers(u, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '10000' }]);
  const s1 = A.screen(u);
  check(A.state(u).step === 'card' && A.state(u).draft.mixed === true && A.state(u).draft.bankPart === 10000 &&
    s1.text.indexOf(txt('sale_line_mixed', { cashMethod: 'ငွေသား', cash: '8,000', method: 'KBZPay', bank: '10,000' })) >= 0,
    'back through how paid to the transfer part and typed 10000 → mixed again: the card splits 8,000 · 10,000', { st: A.state(u), text: s1.text });
  A.answer(u, 'SC|S1-0002|ok');
  const r1 = A.world.ledger.slice(n0);
  check(r1.length === 2 && r1[0].type === 'SALE' && r1[0].cash === 8000 && r1[0].method === 'CASH' && r1[1].type === 'PAYMENT' && r1[1].amount === 10000 && r1[1].method === 'KBZ',
    '✅ writes SALE (8,000 CASH) + PAYMENT (10,000 KBZ), not 18,000 on KBZ', r1.map(r => [r.type, r.cash, r.method]));
  const A2 = bench();
  A2.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '18000' }, Q('o|method'), Q('m|mix'), Q('a|KBZ'), Q('x|half')]);
  check(A2.state(u).draft.mixed === true && A2.state(u).draft.bankPart === 9000 && A2.state(u).step === 'card', 'the same way back, then တစ်ဝက် → mixed again with the transfer part 9,000', A2.state(u));

  // (2) A ✖️ that raced the ✅ on the same message never turns the sold card back into the item card (undo would be lost).
  const B = bench();
  const cB = B.card(u, ITEM, []);
  B.sim.tap(u, cB.id, 'SC|S1-0002|ok');
  const gB = B.lastRow().groupId, soldB = { text: cB.text, kb: JSON.stringify(cB.keyboard) };
  B.sim.tap(u, cB.id, Q('z'));
  check(cB.text === soldB.text && JSON.stringify(cB.keyboard) === soldB.kb && same(B.datas(cB), CARD_SOLD_ROWS(gB)) && B.lastText(u) === MSG.expired && B.state(u) === null,
    'a ✖️ racing the ✅ leaves the sold card as it is ([undo, receipt]); expired comes as a new message', { text: cB.text.split('\n').slice(-1)[0], datas: B.datas(cB) });
  const cB2 = B.scan(u, ITEM);
  B.sim.tap(u, cB2.id, 'S|S1-0002|1');
  const liveB = JSON.stringify(B.state(u)), eB = B.editsOf(cB.id);
  B.sim.tap(u, cB.id, Q('z'));
  B.sim.tap(u, cB.id, Q('o|method'));
  check(cB.text === soldB.text && JSON.stringify(cB.keyboard) === soldB.kb && B.editsOf(cB.id) === eB && JSON.stringify(B.state(u)) === liveB,
    'with a newer card live on another message, a late ✖️ or card tap on the sold card is ignored: the card is never edited to expired, the basket is untouched', { text: cB.text.split('\n').slice(-1)[0], edits: B.editsOf(cB.id) - eB });

  // (3) ⏮ on the look-alikes screen returns to the buyer screen.
  const C = bench();
  C.card(u, ITEM, [Q('o|buyer'), { type: 'ဒေါ်မြ' }]);
  const look = C.screen(u);
  C.answer(u, Q('back|buyer'));
  const sC = C.screen(u), stC = C.state(u);
  check(look.text.endsWith(txt('cust_pick', { name: 'ဒေါ်မြ' })) && !!stC && stC.kind === 'sale' && stC.step === 'card' && sC.id === look.id,
    '⏮ on the look-alikes of a typed name (the buyer step) → its parent, the card, on the same message (never the item card)', { st: stC, text: sC.text.split('\n').slice(-1)[0] });
  C.answers(u, [Q('o|buyer'), { type: '5678' }, Q('back|buyer')]);
  check(C.state(u) && C.state(u).step === 'card', '⏮ on the phone-form look-alikes (5678) → the card as well', C.state(u));
  C.answers(u, [Q('o|buyer'), { type: 'ဒေါ်မြ' }, Q('b|create')]);
  check(C.state(u).step === 'phone' && C.state(u).draft.newName === 'ဒေါ်မြ', 'a new name, create on its look-alikes → the phone question', C.state(u));

  // (4) Back from the phone question goes to the buyer screen, never to a phone question for a cleared name.
  const F = bench();
  F.card(u, ITEM, [Q('o|buyer'), Q('b|new'), { type: 'ဦးသန့်' }, { type: '09 123 456 78' }, Q('b|C-0001')]);
  check(F.state(u).step === 'card' && F.state(u).draft.customerId === 'C-0001' && F.state(u).draft.newName === undefined, 'a new name, a known phone, her picked → the card with her as the buyer (the typed name dropped)', F.state(u));
  F.answers(u, [Q('o|buyer'), Q('b|new'), { type: 'ဦးမင်း' }, Q('back|phone')]);
  const sF = F.screen(u);
  check(F.state(u).step === 'buyer' && sF.text.endsWith(MSG.credit_ask_customer + '\n' + MSG.cust_find) && sF.text.indexOf(txt('ord_ask_phone', { customer: '' })) < 0,
    '⏮ on the phone question → the buyer screen (its parent), never "📞  ၏ ဖုန်းနံပါတ်" for a cleared name', { st: F.state(u), text: sF.text.split('\n').slice(-1)[0] });

  // (5) A ➕ that raced a redraw (💵 tapped, then ➕ on the same message before the redraw arrived) is ignored: no edit.
  const G = bench();
  const cG = G.card(u, ITEM, [Q('o|method'), Q('m|CASH')]);
  const textG = cG.text, eG = G.editsOf(cG.id);
  G.sim.tap(u, cG.id, 'LA|pm|SSA|S1-0002');
  check(cG.text === textG && G.editsOf(cG.id) === eG && G.state(u).kind === 'sale' && G.state(u).step === 'card',
    'a ➕ arriving after the step moved on is ignored without an edit (rule (c)): the card stays', { text: cG.text.split('\n').slice(-1)[0], st: G.state(u) });
});

step('W22y. Rules round 5\'s mutants pinned, on the review card');
runStep(() => {
  const u = U.sister;
  // A typed amount below the transfer part is refused with min = the transfer part.
  const B = bench(), nB = B.ledgerLen();
  B.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '10000' }, Q('o|paid'), Q('p|other'), { type: '5000' }]);
  const sB = B.screen(u);
  check(sB.text === txt('sale_bad_amount', { min: '10,000', max: '17,999' }) && same(sB.datas, [[Q('back|paid')]]) && B.state(u).kind === 'await_number' &&
    B.state(u).saved.step === 'paid' && B.state(u).saved.draft.paid === undefined && B.ledgerLen() === nB,
    'typed 5000 on paid now below the 10,000 transfer part → sale_bad_amount 10,000 .. 17,999 with [⏮ back|paid], the state kept', { text: sB.text, st: B.state(u) });
  // Settings sale_due_presets: the first three positive numbers; nothing usable → 7, 14, 30.
  const C = bench();
  C.world.settings.sale_due_presets = '3, 10, x, 45, 60';
  C.card(u, ITEM, [Q('o|buyer'), Q('b|C-0001'), Q('o|paid'), Q('p|half')]);
  check(same(C.screen(u).datas[0], [Q('d|3'), Q('d|10'), Q('d|45')]) && same(C.screen(u).texts[0], ['၃ ရက်', '၁၀ ရက်', '၄၅ ရက်']),
    'sale_due_presets "3, 10, x, 45, 60" → the day buttons ၃ ၁၀ ၄၅ (the first three positive numbers)', C.screen(u).datas[0]);
  const C2 = bench();
  C2.world.settings.sale_due_presets = '0, -2, abc';
  C2.card(u, ITEM, [Q('o|buyer'), Q('b|C-0001'), Q('o|paid'), Q('p|half')]);
  check(same(C2.screen(u).datas[0], [Q('d|7'), Q('d|14'), Q('d|30')]), 'sale_due_presets with nothing usable → 7, 14, 30', C2.screen(u).datas[0]);
  // The buyer named on the card who was created meanwhile (another phone) is used at ✅, not duplicated.
  const D = bench();
  D.card(u, ITEM, [Q('o|buyer'), Q('b|new'), { type: 'ဦးသန့်' }, Q('ph|skip')]);
  const made = D.ports.store.addCustomer({ name: 'ဦးသန့်', phone: '' }), cD = D.world.customers.length;
  D.answer(u, 'SC|S1-0002|ok');
  check(D.world.customers.length === cD && D.lastRow().customerId === made.id, 'a new name that exists by ✅ (added meanwhile) is that customer, not a second row', { rows: D.world.customers.length - cD, cust: D.lastRow().customerId, made: made.id });
  // Cancel names the item: neither a live state of another item nor the price prompt of another item is cleared.
  const E = bench();
  const cE = E.card(u, ITEM, [Q('o|method')]);
  const cE2 = E.scan(u, 'S1-0003');
  E.sim.tap(u, cE2.id, 'D|S1-0003');
  const priceE = JSON.stringify(E.state(u));
  E.sim.tap(u, cE.id, Q('z'));
  check(cE.text === MSG.expired && JSON.stringify(E.state(u)) === priceE, '✖️ on an old card of S1-0002 while the price prompt of S1-0003 waits → that message expired, the prompt state untouched', E.state(u));
  const E2 = bench();
  const cE3 = E2.card(u, ITEM, [Q('o|method')]);
  const other = { kind: 'sale', step: 'card', item: 'S1-0003', msgId: null, cap: false, line: '', draft: { lines: [{ id: 'S1-0003', qty: 1, unitPrice: 12000, priceChanged: false }] } };
  setState(E2.ports, String(u.id), other);
  E2.sim.tap(u, cE3.id, Q('z'));
  check(cE3.text === MSG.expired && same(E2.state(u), other), '✖️ of S1-0002 never clears a live basket of S1-0003, even one whose card id is unknown', E2.state(u));
  // The deposit question only while something is owed.
  const F = bench();
  F.card(u, ITEM, [Q('o|buyer'), Q('b|C-0002'), 'SC|S1-0002|ok']);
  const gF = F.lastRow().groupId;
  check(same(F.screen(u).datas, [['U|' + gF, 'RC|' + gF], ['CF|C-0002']]) && F.screen(u).text.indexOf(head('credit_use_deposit')) < 0,
    'ဒေါ်ခင် (who holds a deposit) paying in full gets no deposit question: [undo, receipt] and her 📱 row', F.screen(u).datas);
  // A total of 1 offers no 💵+🏦 (nothing can be split).
  const G = bench();
  G.scan(u, 'S1-0001');
  G.answer(u, 'D|S1-0001');
  G.answer(u, { type: '1' });
  G.answer(u, 'SS|S1-0001|o|method');
  check(G.screen(u).text.endsWith(MSG.sale_ask_method) && G.screen(u).flat.indexOf('SS|S1-0001|m|mix') < 0 && G.screen(u).flat.indexOf('SS|S1-0001|m|CASH') >= 0,
    'a bargained total of 1: how-paid has no 💵+🏦 row', G.screen(u).datas);
  // The 21:00 dated line names five buyers at most.
  const H = bench();
  for (let i = 0; i < 6; i++) {
    const c = H.ports.store.addCustomer({ name: 'ဝယ်သူ' + i, phone: '' });
    commitSaleGroup(H.ports, { item: H.ports.store.getItem('S1-0003'), qty: 1, paid: 0, customerId: c.id, dueDay: addDaysKey(today, 1), staff: { id: '1001' }, source: 'BUTTON' });
  }
  H.tick(3 * 1440);
  const lineH = buildDailySummary(H.ports, dayKey(H.world.nowOverride)).split('\n').filter(l => l.indexOf(head('summary_due_overdue')) === 0)[0] || '';
  check(lineH.split(' ရက် လွန်)').length - 1 === 5, 'six dated overdue credits → the 21:00 line names five of them', lineH);
  // The simulator's demo clock is an offset on the real clock; nowOverride wins when set.
  const W = createSimWorld();
  W.clockOffsetMs = 3 * 86400000;
  const drift = W.ports.clock.now().getTime() - Date.now() - W.clockOffsetMs;
  W.nowOverride = new Date(BASE.getTime());
  check(Math.abs(drift) < 5000 && W.ports.clock.now().getTime() === BASE.getTime(), 'sim clock: now() = the real clock + world.clockOffsetMs; nowOverride wins when set', drift);
  // The label rule of sim.buttonByKey: a filled button is found by its key's text up to the first {; a key that starts with { throws.
  const K = bench();
  K.card(u, ITEM, [Q('o|paid')]);
  let threw = false;
  try { K.sim.buttonByKey(K.last(u), 'btn_days'); } catch (e) { threw = true; }
  check(K.sim.buttonByKey(K.last(u), 'btn_paid_full') === 'SS|S1-0002|p|all' && threw, 'sim.buttonByKey finds 💯 အကုန် ပေးပြီး 18,000 by btn_paid_full (cut at its first {) on the paid sub-screen and refuses btn_days (it starts with {)');
});

/* ============================== 22x. found by round 5's step-1 reviewer, on the review card ============================== */

step('W22x. Due presets, a sentence beside the card, refused typed answers, the look-alikes header, cash at ➕, an edit sent as a new message');
runStep(() => {
  const u = U.sister;
  const salesOf = (B, from, id) => B.world.ledger.slice(from).filter(r => r.type === 'SALE' && r.itemId === id && liveRows([r], B.world.ledger).length).length;
  const tapLive = (B, data) => { const st = saleStateOf(B.ports, String(u.id)); return st ? B.sim.tap(u, st.msgId, data) : B.tapData(u, data); };
  const yesOf = s => s.flat.filter(d => /^Y\|/.test(d))[0];
  const toDue = [Q('o|buyer'), Q('b|C-0001'), Q('o|paid'), Q('p|half')];

  // (1) sale_due_presets: whole days from 1 to SALE_DUE_MAX_DAYS only; a hand-built day outside that books nothing.
  const P = bench();
  P.world.settings.sale_due_presets = '0.4,7,500';
  P.card(u, ITEM, toDue);
  const pDue = P.screen(u);
  check(same(pDue.datas[0], [Q('d|7')]) && same(pDue.texts[0], ['၇ ရက်']), 'sale_due_presets "0.4,7,500" → only the ၇ ရက် button (no ၀.၄ ရက်, no ၅၀၀ ရက်)', pDue.datas[0]);
  const pEdits = P.editsOf(pDue.id);
  P.answer(u, Q('d|500'));
  P.answer(u, Q('d|0.4'));
  check(P.state(u).step === 'due' && P.state(u).draft.dueDay === undefined && P.editsOf(pDue.id) === pEdits,
    'a stale or hand-built SS|id|d|500 or d|0.4 writes no DueDay and leaves the due screen as it is (saleDueKey refuses those days)', P.state(u));
  const P2 = bench();
  P2.world.settings.sale_due_presets = '365, 366, 30';
  P2.card(u, ITEM, toDue);
  check(same(P2.screen(u).datas[0], [Q('d|365'), Q('d|30')]), 'sale_due_presets "365, 366, 30" → ၃၆၅ and ၃၀ (366 is past SALE_DUE_MAX_DAYS)', P2.screen(u).datas[0]);

  // (2) A spoken sale of the same piece while how paid waits: no proposal beside the card, one SALE in the end.
  const S = bench();
  S.card(u, ITEM, [Q('o|method')]);
  const s0 = S.ledgerLen(), q2 = S.screen(u);
  S.sim.voice(u, 'ငွေသား နဲ့ ရောင်းတယ်');
  const sV = S.screen(u), yes = yesOf(sV);
  check(!yes && sV.id !== q2.id && sV.text.indexOf('🎤') === 0 && sV.text.endsWith(MSG.sale_ask_method) && sV.flat.indexOf(Q('m|CASH')) >= 0 &&
    S.state(u).step === 'method' && S.state(u).msgId === sV.id && S.ledgerLen() === s0,
    'a spoken sale of the piece on how-paid → no ✅ proposal; the how-paid screen again as a new message (heard line first), nothing written', { text: sV.text, datas: sV.datas });
  if (yes) S.tapData(u, yes);
  tapLive(S, Q('m|CASH'));
  tapLive(S, 'SC|S1-0002|ok');
  check(salesOf(S, s0, ITEM) === 1 && S.state(u) === null, '…then 💵 and ✅ on the live card write exactly one SALE of the piece', S.world.ledger.slice(s0).map(r => [r.type, r.itemId, r.amount]));
  // A proposal spoken before the card and confirmed during it closes the basket: the card cannot book the piece again.
  const S2 = bench();
  const c2 = S2.scan(u, ITEM);
  S2.sim.voice(u, 'ဒါ ၂ ထည် ရောင်းရတယ်');
  const prop = S2.screen(u);
  S2.sim.tap(u, c2.id, 'S|S1-0002|1');
  const s20 = S2.ledgerLen();
  S2.sim.tap(u, prop.id, yesOf(prop));
  ['SC|S1-0002|ok'].forEach(d => S2.sim.tap(u, c2.id, d));
  check(salesOf(S2, s20, ITEM) === 1 && S2.ledgerLen() === s20 + 1 && saleStateOf(S2.ports, String(u.id)) === null,
    'a voice proposal confirmed while a basket holding the same piece is open writes once and closes the basket (its card answers expired, no second SALE)', S2.world.ledger.slice(s20).map(r => [r.type, r.qty, r.amount]));

  // (3) A method typed or spoken while the card is open is never a rewrite of the previous sale.
  const M = bench();
  M.card(u, 'S1-0003', ['SC|S1-0003|ok']);
  const gA = M.lastRow().groupId, m0 = M.ledgerLen();
  M.card(u, ITEM, [Q('o|method')]);
  M.sim.text(u, 'KBZPay နဲ့ ပေးတယ်');
  const mT = M.screen(u), yesM = yesOf(mT);
  if (yesM) M.tapData(u, yesM);
  check(!yesM && M.ledgerLen() === m0 && M.liveOf(gA).length === 1 && M.liveOf(gA)[0].method === 'CASH' && mT.text.endsWith(MSG.sale_ask_method) && M.state(u).step === 'method',
    'typed "KBZPay နဲ့ ပေးတယ်" on how-paid → no proposal against the last sale (S1-0003 stays cash), the how-paid screen again', { text: mT.text, live: M.liveOf(gA).map(r => r.method) });
  M.answers(u, [Q('m|CASH'), Q('o|paid')]);
  M.sim.voice(u, 'Wave နဲ့ ပေးသွားတယ်');
  const mV = M.screen(u);
  check(!yesOf(mV) && mV.datas[0][0] === Q('p|all') && M.state(u).step === 'paid' && M.ledgerLen() === m0,
    'a spoken method on the paid sub-screen → that screen again (💯 first), no proposal, nothing written', { text: mV.text.split('\n').slice(-2), datas: mV.datas });

  // (5) A typed answer refused on a screen of buttons brings that screen back with the error, not a bare error.
  const R = bench(), yesterday = addDaysKey(today, -1);
  R.card(u, ITEM, toDue);
  const rDue = R.screen(u);
  R.answer(u, { type: dm(yesterday) });
  const rBad = R.screen(u), rOk = rBad.id !== rDue.id && rBad.text === MSG.ord_bad_date + '\n' + rDue.text && same(rBad.datas, rDue.datas) && R.state(u).step === 'due' && R.state(u).msgId === rBad.id;
  R.answer(u, Q('d|7'));
  check(rOk && R.state(u).step === 'card' && R.state(u).draft.dueDay === addDaysKey(today, 7),
    'a past date typed on the due screen → the due screen again as a new message, ord_bad_date first, its day buttons and back row kept; ၇ ရက် there books the day', { text: rBad.text.split('\n')[0], datas: rBad.datas, st: R.state(u) });
  const G = bench();
  G.card(u, ITEM, [Q('l|S1-0002')]);
  const line = G.screen(u);
  G.answer(u, { type: '1000' });
  const gBad = G.screen(u), gOk = gBad.id !== line.id && gBad.text === txt('bad_qty', { max: '၉၉၉' }) + '\n' + line.text && same(gBad.datas, line.datas) && G.state(u).step === 'line' && G.state(u).msgId === gBad.id;
  G.answer(u, Q('q|3'));
  check(gOk && G.state(u).step === 'card' && G.state(u).draft.lines[0].qty === 3,
    'typed 1000 on the line sub-screen (no ✏️) → that screen again as a new message with bad_qty first, its digits kept; ၃ there goes on with qty 3', { text: gBad.text, datas: gBad.datas, st: G.state(u) });

  // (6) The look-alikes screen asks who the buyer is: its text is the basket's head and the question only.
  const L = bench();
  L.card(u, ITEM, [Q('o|buyer'), { type: 'ဒေါ်မြ' }]);
  const lText = L.screen(u).text;
  check(lText === txt('basket_title', { n: '၁' }) + '\n' + txt('basket_total', { total: '18,000' }) + '\n' + txt('cust_pick', { name: 'ဒေါ်မြ' }),
    'typed ဒေါ်မြ → the look-alikes screen is the basket head and the question only (no "👤 ဒေါ်မြ" line)', lText);
  const L2 = bench();
  L2.card(u, ITEM, [Q('o|buyer'), Q('b|new'), { type: 'ဒေါ်သီတာ' }, { type: '09 123 456 78' }]);
  const l2 = L2.screen(u);
  L2.answer(u, Q('b|create'));
  check(l2.text.split('\n').filter(x => x.indexOf('👤 ဒေါ်သီတာ') === 0).length === 0 && l2.text.endsWith(txt('cust_pick', { name: 'ဒေါ်သီတာ' })) &&
    L2.screen(u).text.indexOf('👤 ဒေါ်သီတာ · ' + fmtPhone('09 123 456 78')) >= 0 && L2.state(u).step === 'card',
    'a known phone for a new name → the look-alikes screen without the "👤 ဒေါ်သီတာ · phone" line; after ✏️ create the card shows her and the phone', { look: l2.text, after: L2.screen(u).text });

  // (7) Cash typed at ➕ is not an account: the name is asked again (from the split's account screen and from how-paid).
  const A = bench(), aLists = A.world.lists.length;
  A.card(u, ITEM, [Q('o|method'), Q('m|mix'), 'LA|pm|SSA|S1-0002', { type: MSG.method_CASH }]);
  const aS = A.screen(u), aSt = A.state(u);
  check(aS.text === MSG.add_ask_pm && same(aS.datas, [[Q('back|account')]]) && aSt.kind === 'await_text' && aSt.purpose === 'add_option' && aSt.saved.step === 'account' &&
    aSt.saved.draft.method === undefined && A.world.lists.length === aLists,
    '💵+🏦 → ➕ → "ငွေသား" typed → add_ask_pm again with [⏮ back|account], no method, nothing added', { text: aS.text, st: aSt });
  const A2 = bench();
  A2.card(u, ITEM, [Q('o|method'), 'LA|pm|SSA|S1-0002', { type: MSG.method_CASH }]);
  check(A2.screen(u).text === MSG.add_ask_pm && same(A2.screen(u).datas, [[Q('back|method')]]) && A2.state(u).saved.step === 'method',
    'how-paid → ➕ → "ငွေသား" typed → add_ask_pm again with [⏮ back|method]', A2.screen(u).text);

  // (8) An edit that cannot be made is sent as a new message (gas_telegram.js): the card goes on from that message.
  const failingEdits = B => {
    let failNext = false;
    const inner = B.world.ports.chat.editMessage;
    B.world.ports.chat.editMessage = function (chatId, messageId, text, keyboard, isCaption) {
      if (failNext) { failNext = false; return B.world.ports.chat.sendMessage(chatId, text, keyboard); }
      return inner.call(this, chatId, messageId, text, keyboard, isCaption);
    };
    return () => { failNext = true; };
  };
  const F = bench(), failF = failingEdits(F), f0 = F.ledgerLen();
  const fCard = F.card(u, ITEM, []);
  failF();
  F.sim.tap(u, fCard.id, Q('o|method'));
  const fNew = F.screen(u);
  check(fNew.id !== fCard.id && fNew.text.endsWith(MSG.sale_ask_method) && F.state(u).msgId === fNew.id && F.state(u).cap === false,
    'the edit to how-paid fails and is sent as a new message → the state remembers that message (a text message: cap false)', { id: fNew.id, card: fCard.id, st: F.state(u) });
  F.sim.tap(u, fNew.id, Q('m|CASH'));
  F.sim.tap(u, fNew.id, 'SC|S1-0002|ok');
  check(salesOf(F, f0, ITEM) === 1 && F.state(u) === null && fNew.message.text.indexOf(head('sold_done')) >= 0,
    '…💵 and ✅ on that new message sell the piece (not "expired")', fNew.message.text.split('\n').slice(-1)[0]);
  const F4 = bench(), failF4 = failingEdits(F4);
  const f4Card = F4.card(u, ITEM, [Q('o|method')]);
  failF4();
  F4.sim.tap(u, f4Card.id, 'LA|pm|SSA|S1-0002');
  const f4P = F4.screen(u);
  F4.sim.tap(u, f4P.id, Q('back|method'));
  check(f4P.id !== f4Card.id && F4.state(u) && F4.state(u).step === 'method' && F4.state(u).msgId === f4P.id && f4P.message.text.endsWith(MSG.sale_ask_method),
    '➕ on how-paid sent as a new message → ⏮ on it brings how-paid back there', { st: F4.state(u), text: f4P.message.text });
});

/* ============================== 23. texts, 64 bytes, no errors ============================== */

step('23. Texts, 64 bytes, no errors');
runStep(() => {
  const KEYS = ['btn_no_name', 'btn_wallet', 'btn_bank_transfer', 'btn_paid_all', 'btn_due_unknown', 'btn_kind_wallet', 'btn_kind_bank', 'sale_ask_qty_price', 'sale_ask_method',
    'sale_ask_account', 'sale_ask_split_account', 'sale_ask_paid', 'sale_ask_due', 'sale_ask_kind', 'sale_need_buyer', 'sale_line_method', 'sale_line_mixed', 'sale_line_paid',
    'sale_due_set', 'sale_due_none', 'sale_gone', 'sale_bad_amount', 'summary_due_overdue', 'lists_note_kind', 'settings_note_sale_flow'];
  check(KEYS.length === 25 && KEYS.every(k => typeof MSG[k] === 'string' && MSG[k].length > 0), 'every key of section 7 is in MSG and non-empty', KEYS.filter(k => typeof MSG[k] !== 'string'));
  const buttons = KEYS.filter(k => k.indexOf('btn_') === 0);
  check(buttons.length === 7 && buttons.every(k => ['ငွေသား', 'KBZPay', 'WavePay', 'ဘဏ်လွှဲ'].every(w => MSG[k].indexOf(w) < 0) && MSG[k].indexOf('🏦 ') !== 0),
    'no btn_* of section 7 contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ or starts with 🏦 + space');
  check(fill(MSG.sale_line_mixed, { cashMethod: 'ငွေသား', cash: '8,000', method: 'KBZPay', bank: '10,000' }) === '💰 ငွေသား 8,000 · KBZPay 10,000' && fill(MSG.sale_bad_amount, { min: '1', max: '17,999' }) === '❓ 1 မှ 17,999 အတွင်း ဂဏန်း ရိုက်ပေးပါ' &&
    fill(MSG.sale_ask_due, { owed: '9,000' }) === '📅 ကျန် 9,000 ကျပ် · ဘယ်တော့ ပေးလဲ?' && fill(MSG.sale_due_set, { owed: '9,000', date: 'x' }) === '📅 ကျန် 9,000 · x' && fill(MSG.sale_ask_paid, { total: '18,000' }) === '💰 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း 18,000 ကျပ်)',
    'the placeholders fill as the screens expect');
  check(CFG.LIST_COLS.length === 9 && CFG.LIST_COLS[8] === 'Kind' && CFG.LIST_COLS.every(c => typeof MSG['lists_note_' + c.toLowerCase()] === 'string' && MSG['lists_note_' + c.toLowerCase()].length > 0) && same(CFG.LIST_KINDS, ['wallet', 'bank']),
    'LIST_COLS has Kind ninth with a lists_note_kind; LIST_KINDS = [wallet, bank]');
  const specFile = path.join(ROOT, 'docs/design-round-5/SPEC-round-5.md'), spec6File = path.join(ROOT, 'docs/design-round-6/SPEC-round-6.md');
  if (fs.existsSync(specFile) && fs.existsSync(spec6File)) {
    const spec = fs.readFileSync(specFile, 'utf8').replace(/\r\n/g, '\n'), spec6 = fs.readFileSync(spec6File, 'utf8').replace(/\r\n/g, '\n');
    const from = spec.indexOf('```\n', spec.indexOf('core_messages.js `MSG`, step 1 adds all of them')) + 4;
    const pairs = spec.slice(from, spec.indexOf('\n```', from)).split('\n').map(l => l.match(/^(\w+): '(.*)'$/)).filter(Boolean);
    const from6 = spec6.indexOf('```\n', spec6.indexOf('### 9.2 Changed text')) + 4;
    const note6 = spec6.slice(from6, spec6.indexOf('\n```', from6)).split('\n').map(l => l.match(/^(\w+): '(.*)'$/)).filter(Boolean)[0];
    const textOf = m => (m[1] === 'settings_note_sale_flow' && note6 && note6[1] === m[1] ? note6[2] : m[2]);
    check(pairs.length === 25 && same(pairs.map(m => m[1]), KEYS) && pairs.every(m => MSG[m[1]] === textOf(m)) && !!note6 && MSG.settings_note_sale_flow === note6[2],
      'every text is exactly the one the specs give (settings_note_sale_flow compared with SPEC-round-6.md 9.2, the other 24 with docs/design-round-5/SPEC-round-5.md)',
      pairs.filter(m => MSG[m[1]] !== textOf(m)).map(m => m[1]));
  } else {
    console.log('  (the spec files are not here: the texts were not compared with them)');
  }
  check(bytes('SS|S1-0002|back|due_text') === 24 && bytes('CD|' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx' + '|yes|p|ABCDEFGHIJKL') === 58 && bytes('LA|pm|SSA|S1-0002') === 17 && bytes('SC|S1-0002|ok') === 13,
    'the spec\'s byte counts: back|due_text 24, CD yes p with a 12-byte key 58, LA|pm|SSA 17, SC ok 13');
  check(maxCb.len > 0 && maxCb.len <= 64 && buttonsSeen > 500, 'every callback_data emitted in this file (' + buttonsSeen + ' buttons) is within 64 bytes (longest ' + maxCb.len + ': ' + maxCb.data + ')');
  const M = bench(), n0 = M.ledgerLen();
  const card = M.scan(U.sister, 'S1-0005');
  M.answer(U.sister, 'btn_sell_one');
  check(M.ledgerLen() === n0 && card.edited && card.text.endsWith(txt('sale_line_paid', { paid: '22,000', owed: '0' })) && M.state(U.sister).kind === 'sale' && M.state(U.sister).step === 'card',
    'START + one tap shows the review card (its last line sale_line_paid); nothing is written before Save (the form mirror of run_round4\'s last check)');
  check(worlds.every(w => w.errors.filter(e => e.where === 'handleUpdate').length === 0), 'no update of any world failed with an exception',
    worlds.map(w => w.errors.filter(e => e.where === 'handleUpdate').map(e => e.message)).filter(x => x.length));
});

/* ============================== 24. caption-aware edits ============================== */

step('24. Caption-aware edits: every edit carries the isCaption of the message it lands on');
runStep(() => {
  const wrong = [];
  let sawTrue = 0, sawFalse = 0;
  edits.forEach(e => {
    const target = (e.world.chats[e.chatId] || []).filter(m => m.id === e.messageId)[0];
    if (!target) { wrong.push({ id: e.messageId, missing: true }); return; }
    if (!!e.isCaption !== !!target.photo) wrong.push({ id: e.messageId, isCaption: e.isCaption, photo: !!target.photo, text: String(target.text || '').slice(0, 40) });
    if (e.isCaption) sawTrue++; else sawFalse++;
  });
  check(edits.length > 100 && wrong.length === 0, 'over ' + edits.length + ' edits in every bench, isCaption === !!target.photo for each', wrong.slice(0, 5));
  check(sawTrue > 0 && sawFalse > 0, 'both kinds were seen: ' + sawTrue + ' caption edits (guided screens on photo cards) and ' + sawFalse + ' text edits (typed-path messages edited by a tap)');
});


/* ============================== W25. pure helpers ============================== */

step('W25. Pure helpers: basketAllocate, basketTotals, saleDueKey, itemMargin, itemPlaceholderName, aiRenameFields, basketAddItem, basketCheck');
runStep(() => {
  check(same(basketAllocate([36000, 22000, 25000], 30000), [30000, 0, 0]) && same(basketAllocate([36000, 22000, 25000], 40000), [36000, 4000, 0]) &&
    same(basketAllocate([36000, 22000, 25000], 73000), [36000, 22000, 15000]) && same(basketAllocate([36000, 22000, 25000], 0), [0, 0, 0]),
    'basketAllocate fills the lines in order: 30,000 → [30,000, 0, 0]; 40,000 → [36,000, 4,000, 0]; 73,000 → [36,000, 22,000, 15,000]');
  let seed = 7, bad = 0;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 200; k++) {
    const amounts = []; for (let i = 0, n = 1 + rnd(10); i < n; i++) amounts.push(rnd(5) === 0 ? 0 : (1 + rnd(50)) * 1000);
    const sum = amounts.reduce((a, x) => a + x, 0), A = rnd(sum + 1), cash = basketAllocate(amounts, A);
    if (cash.length !== amounts.length || cash.reduce((a, x) => a + x, 0) !== A || cash.some((c, i) => c < 0 || c > amounts[i])) bad++;
  }
  check(bad === 0, '200 seeded random baskets: Σ cash = the paid amount exactly, and every row keeps 0 ≤ cash ≤ amount', bad);
  // basketTotals of one line = the rows commitSaleGroup writes, on the seven outcomes' inputs.
  const A = bench(), staff = A.ports.store.getStaff('1001'), item = A.ports.store.getItem(ITEM);
  const inputs = [{}, { method: 'KBZ', priceChanged: true, unitPrice: 15000 }, { method: 'KBZ', paid: 0 }, { method: 'KBZ', paid: 9000 }, { method: 'KBZ', mixed: true, bankPart: 10000 },
    { method: 'KBZ', mixed: true, bankPart: 5000, paid: 9000 }, { method: 'KBZ', mixed: true, bankPart: 9000, paid: 9000 }, { method: 'KBZ', mixed: true, bankPart: 0 }];
  const diffs = [];
  inputs.forEach((p, k) => {
    const n = A.ledgerLen();
    const r = commitSaleGroup(A.ports, Object.assign({ item, qty: 1, staff, source: 'BUTTON', customerId: 'C-0001' }, p));
    const rows = A.world.ledger.slice(n);
    const T = basketTotals([{ qty: 1, unitPrice: nullish(p.unitPrice) ? 18000 : p.unitPrice }], { part: !nullish(p.paid), paid: p.paid, method: p.method, mixed: p.mixed, bankPart: p.bankPart });
    if (T.rowCash[0] !== rows[0].cash || T.rowMethod[0] !== rows[0].method || T.twoRows !== (rows.length === 2) || T.owed !== r.owed || (T.twoRows && T.bankPart !== rows[1].amount)) diffs.push(k);
  });
  check(diffs.length === 0, 'basketTotals of one line gives the cash, the method, the PAYMENT and the owed that commitSaleGroup writes on the seven outcomes\' inputs', diffs);
  const P = basketTotals([{ qty: 2, unitPrice: 18000 }, { qty: 1, unitPrice: null }, { qty: 1, unitPrice: '' }], {});
  check(P.total === 36000 && same(P.amounts, [36000, 0, 0]) && same(P.pending, [1, 2]), 'a price-pending line (null or \'\') counts 0 and is listed in pending', P);
  const now = A.world.nowOverride, y = addDaysKey(today, -1), toMy = s => s.replace(/\d/g, d => MY_DIGITS[Number(d)]);
  check(saleDueKey(now, 0) === today && saleDueKey(now, 14) === addDaysKey(today, 14) && saleDueKey(now, 365) === addDaysKey(today, 365) && saleDueKey(now, '14') === addDaysKey(today, 14) &&
    saleDueKey(now, 366) === null && saleDueKey(now, -1) === null && saleDueKey(now, 0.5) === null && saleDueKey(now, 'none') === '' && saleDueKey(now, '') === '' &&
    saleDueKey(now, dmy(y)) === null && saleDueKey(now, dmy(addDaysKey(today, 400))) === null && saleDueKey(now, addDaysKey(today, 10)) === addDaysKey(today, 10) &&
    saleDueKey(now, toMy(dmy(addDaysKey(today, 10)))) === addDaysKey(today, 10) && saleDueKey(now, toMy('14')) === addDaysKey(today, 14),
    'saleDueKey: 0, 14 and 365 days accepted; 366, -1 and 0.5 refused (null); none → \'\'; yesterday and +400 refused; yyyy-mm-dd and Burmese digits accepted');
  check(same(itemMargin(25000, 12000), { profit: 13000, pct: 108 }) && same(itemMargin(12000, 25000), { profit: -13000, pct: -52 }) && itemMargin(25000, '') === null && itemMargin(25000, 0) === null && itemMargin('', 12000) === null,
    'itemMargin: (25,000, 12,000) → 13,000 and 108% (markup on cost); (12,000, 25,000) → -13,000 and -52%; an empty or 0 cost → null');
  check(itemPlaceholderName('S1-0007') === 'ပစ္စည်း S1-0007', 'itemPlaceholderName(S1-0007) = ပစ္စည်း S1-0007');
  const ph = { id: 'S1-0007', name: 'ပစ္စည်း S1-0007', category: 'အခြား' }, desc = { name: 'ထမီ ပိုးထည် အစိမ်း', category: 'ထမီ' };
  check(same(aiRenameFields(ph, desc), { name: 'ထမီ ပိုးထည် အစိမ်း', category: 'ထမီ' }) && same(aiRenameFields(Object.assign({}, ph, { category: '' }), desc), { name: 'ထမီ ပိုးထည် အစိမ်း', category: 'ထမီ' }) &&
    same(aiRenameFields(Object.assign({}, ph, { category: 'လုံချည်' }), desc), { name: 'ထမီ ပိုးထည် အစိမ်း' }) && aiRenameFields(Object.assign({}, ph, { name: 'ထမီ ကျွန်မ' }), desc) === null &&
    aiRenameFields(Object.assign({}, ph, { name: '' }), desc) === null && aiRenameFields(ph, { name: '' }) === null && same(aiRenameFields(ph, { name: 'x', category: 'chair' }), { name: 'x' }),
    'aiRenameFields: a placeholder name → the AI name (and its category only over \'\' or the catch-all အခြား); a typed name or a BLANK item (name \'\') → null');
  const sis = A.ports.store.getStaff('1001'), own = A.ports.store.getStaff('1000');
  const add = (st, lines, id, q, o) => basketAddItem(A.ports, st, lines, id, q, o);
  const one = add(sis, [], 'S1-0002', 1);
  check(add(sis, [], 'S9-0001', 1).reason === 'missing' && add(sis, [], 'S1-0007', 1).reason === 'blank' && add(sis, [], 'S2-0002', 1).reason === 'other_shop' &&
    add(sis, one.lines, 'S2-0004', 1).reason === 'blank', 'basketAddItem refuses missing, blank and other_shop (a seller\'s basket is her shop) in that order');
  const withU = add(sis, one.lines, 'S1-0001', 1).lines;
  check(add(sis, withU, 'S1-0001', 1).reason === 'twice' && add(sis, [], 'S1-0001', 1, { restock: true }).reason === 'unique' && add(sis, one.lines, 'S1-0003', 1, { restock: true }).ok,
    'a one-of-a-kind piece already in → twice; with restock any one-of-a-kind piece → unique; a stock item → a restock line');
  let L = [];
  ['S1-0002', 'S1-0003', 'S1-0005', 'S1-0001', 'S1-0004'].forEach(id => { L = add(own, L, id, 1).lines; });
  check(L.length === 5 && add(own, L, 'S1-0006', 1).reason === 'gone', 'five lines in (the owner\'s S1 basket); the seed\'s sold S1-0006 is gone', L.length);
  A.ports.store.updateItem('S1-0004', { stock: 0 });
  const merged = add(sis, one.lines, 'S1-0002', 2);
  check(merged.ok && merged.merged && merged.index === 0 && merged.lines[0].qty === 3 && one.lines[0].qty === 1 && add(sis, [], 'S1-0001', 5).lines[0].qty === 1,
    'a stock item again raises its count (merged, the given lines untouched); a one-of-a-kind piece stays 1', merged);
  const ownS2 = add(own, [], 'S2-0002', 1);
  check(ownS2.ok && add(own, ownS2.lines, 'S1-0002', 1).reason === 'other_shop', 'the owner\'s basket takes its shop from the first line (S2), so an S1 piece is other_shop', ownS2);
  A.ports.store.updateItem('S1-0003', { price: '' });
  const pend = add(sis, [], 'S1-0003', 1);
  check(pend.ok && pend.lines[0].unitPrice === null, 'a price-pending piece is accepted with unitPrice null', pend);
  const B = bench(), sold = B.ports.store.getStaff('1001');
  B.card(U.owner, 'S1-0001', ['SC|S1-0001|ok']);
  check(basketAddItem(B.ports, sold, [], 'S1-0001', 1).reason === 'gone', 'a sold one-of-a-kind piece → gone');
  let L10 = [];
  for (let i = 0; i < 10; i++) L10.push({ id: 'X' + i, qty: 1, unitPrice: 1, priceChanged: false });
  L10[0] = { id: 'S1-0002', qty: 1, unitPrice: 18000, priceChanged: false };
  check(basketAddItem(B.ports, sold, L10, 'S1-0003', 1).reason === 'max' && basketAddItem(B.ports, sold, L10, 'S1-0002', 1).ok, 'the eleventh line → max (a stock item already in still merges)');
  // basketCheck, each code with its key, in the spec's order.
  const C = bench(), cs = C.ports.store.getStaff('1001');
  const line = (id, qty, unit) => ({ id, qty: qty === undefined ? 1 : qty, unitPrice: unit === undefined ? 18000 : unit, priceChanged: false });
  const codes = d => basketCheck(C.ports, cs, d).problems.map(p => p.code + ':' + p.key);
  check(same(codes({ lines: [] }), ['empty:scan_first']), 'no line → empty (scan_first)');
  check(same(codes({ lines: [line('S9-0001'), line('S1-0007'), line('S2-0002'), line('S1-0002', 1, null), line('S1-0003', 0, 12000), line('S1-0002')] }),
    ['missing:tag_not_found', 'blank:basket_blank', 'other_shop:basket_other_shop', 'need_price:basket_need_price', 'qty:bad_qty', 'twice:basket_twice']),
    'per line in line order: missing, blank, other_shop, need_price, qty, twice (each with its key)');
  C.card(U.owner, 'S1-0001', ['SC|S1-0001|ok']);
  check(same(codes({ lines: [line('S1-0001', 1, 25000)] }), ['gone:basket_line_gone']), 'a one-of-a-kind piece sold meanwhile → gone (basket_line_gone)');
  const ok = { lines: [line('S1-0002', 2)] };
  check(basketCheck(C.ports, cs, ok).ok && basketCheck(C.ports, cs, ok).totals.total === 36000, 'a plain cash basket passes; its totals come with the answer');
  check(same(codes(Object.assign({}, ok, { method: 'GONE' })), ['method:basket_method_gone']) && basketCheck(C.ports, cs, Object.assign({}, ok, { method: 'GONE' }), { pendingMethod: true }).ok,
    'an account no longer offered → method (basket_method_gone); skipped with pendingMethod');
  check(same(codes(Object.assign({}, ok, { needAccount: 'bank' })), ['account:sale_ask_account']) && same(codes(Object.assign({}, ok, { needAccount: 'all', mixed: true })).slice(0, 1), ['account:sale_ask_split_account']),
    '🏛 or 💵+🏦 chosen without an account → account (sale_ask_account / sale_ask_split_account)');
  check(same(codes(Object.assign({}, ok, { method: 'KBZ', mixed: true, bankPart: 40000 })), ['transfer:sale_bad_amount']) && basketCheck(C.ports, cs, Object.assign({}, ok, { method: 'KBZ', mixed: true, bankPart: 40000 })).problems[0].vars.max === '36,000',
    'a transfer part above what is paid now → transfer (sale_bad_amount, max = paid now)');
  check(same(codes(Object.assign({}, ok, { method: 'KBZ', mixed: true, bankPart: 0 })), ['transfer:sale_bad_amount']) && basketCheck(C.ports, cs, Object.assign({}, ok, { method: 'KBZ', mixed: true, bankPart: 0 })).problems[0].vars.min === '1' &&
    basketCheck(C.ports, cs, Object.assign({}, ok, { method: 'KBZ', mixed: true, bankPart: 36000 })).ok,
    'a transfer part of 0 → transfer (sale_bad_amount, min 1); one of the whole amount paid now passes');
  check(same(codes(Object.assign({}, ok, { part: true, customerId: 'C-0001', dueDay: '' })), ['paid_none:sale_ask_paid']) &&
    same(codes(Object.assign({}, ok, { part: true, paid: 36000, customerId: 'C-0001', dueDay: '' })), ['paid:sale_bad_amount']) &&
    same(codes(Object.assign({}, ok, { part: true, paid: 4000, method: 'KBZ', mixed: true, bankPart: 5000, customerId: 'C-0001', dueDay: '' })).slice(-1), ['paid:sale_bad_amount']),
    'part with no amount → paid_none; an amount of the whole total, or below the transfer part → paid');
  check(same(codes(Object.assign({}, ok, { part: true, paid: 0, dueDay: '' })), ['need_buyer:sale_need_buyer']) &&
    same(codes(Object.assign({}, ok, { part: true, paid: 0, newName: 'x', newPhone: '0912', dueDay: '' })), ['phone:basket_bad_phone']) &&
    same(codes(Object.assign({}, ok, { part: true, paid: 0, customerId: 'C-0001' })), ['due_none:sale_ask_due']) &&
    same(codes(Object.assign({}, ok, { part: true, paid: 0, customerId: 'C-0001', dueDay: addDaysKey(today, 400) })), ['due:ord_bad_date']),
    'owed and nobody named → need_buyer; a new buyer\'s phone of 4 digits → phone; owed and no day → due_none; a day past +365 → due');
  C.world.settings.sale_flow = 'quick';
  check(codes(ok)[0] === 'mode:expired', 'saleFlow quick → mode (expired) first');
});

/* ============================== W26. commitBasket ============================== */

step('W26. commitBasket: the three-line basket against the seven outcomes, B1-B9, one clock read');
runStep(() => {
  const D = addDaysKey(today, 10);
  const basket = (p) => {
    const A = bench(), staff = A.ports.store.getStaff('1001'), n = A.ledgerLen(), it = id => A.ports.store.getItem(id);
    const r = commitBasket(A.ports, Object.assign({ lines: [{ item: it('S1-0002'), qty: 2 }, { item: it('S1-0005'), qty: 1 }, { item: it('S1-0001'), qty: 1 }],
      customerId: 'C-0001', dueDay: D, staff, source: 'BUTTON' }, p));
    return { A, r, rows: A.world.ledger.slice(n) };
  };
  const sales = o => o.rows.filter(x => x.type === 'SALE'), pay = o => o.rows.filter(x => x.type === 'PAYMENT');
  const shape = (o, cash, methods, note, due, payment, owed) => {
    const s = sales(o), p = pay(o);
    return s.length === 3 && same(s.map(x => x.cash), cash) && same(s.map(x => x.method), methods) && s.every(x => x.note === note) && s.every(x => x.dueDay === due) &&
      same(s.map(x => x.itemId), ['S1-0002', 'S1-0005', 'S1-0001']) && same(s.map(x => x.qty), [-2, -1, -1]) && o.rows.every(x => x.customerId === 'C-0001') &&
      (payment ? p.length === 1 && o.rows[3] === p[0] && p[0].amount === payment && p[0].method === 'KBZ' && p[0].note === 'split' && p[0].refGroupId === o.r.groupId && p[0].dueDay === '' : p.length === 0) &&
      o.r.owed === owed && o.r.total === 83000 && o.rows.every(x => x.groupId === o.r.groupId);
  };
  let o = basket({});
  check(shape(o, [36000, 22000, 25000], ['CASH', 'CASH', 'CASH'], '', '', 0, 0), '1. cash, full: 36,000 · 22,000 · 25,000, CASH ×3, no note, no DueDay (the date dropped), owed 0', o.rows.map(x => [x.cash, x.method, x.note, x.dueDay]));
  o = basket({ method: 'KBZ' });
  check(shape(o, [36000, 22000, 25000], ['KBZ', 'KBZ', 'KBZ'], '', '', 0, 0), '2. KBZ, full: KBZ ×3', o.rows.map(x => [x.cash, x.method]));
  o = basket({ paid: 30000 });
  check(shape(o, [30000, 0, 0], ['CASH', '', ''], 'credit', D, 0, 53000), '3. part 30,000: 30,000 · 0 · 0, CASH · \'\' · \'\', credit, DueDay on EVERY SALE row, owed 53,000', o.rows.map(x => [x.cash, x.method, x.dueDay]));
  o = basket({ paid: 0 });
  check(shape(o, [0, 0, 0], ['', '', ''], 'credit', D, 0, 83000), '3b. nothing now: 0 ×3, \'\' ×3, credit, DueDay ×3, owed 83,000', o.rows.map(x => [x.cash, x.method]));
  o = basket({ method: 'KBZ', mixed: true, bankPart: 10000 });
  check(shape(o, [36000, 22000, 15000], ['CASH', 'CASH', 'CASH'], 'split', '', 10000, 0), '4. mixed full, KBZ 10,000: 36,000 · 22,000 · 15,000 CASH, split, then ONE PAYMENT of 10,000 KBZ last', o.rows.map(x => [x.type, x.cash, x.method]));
  o = basket({ method: 'KBZ', mixed: true, bankPart: 10000, paid: 50000 });
  check(shape(o, [36000, 4000, 0], ['CASH', 'CASH', ''], 'split', D, 10000, 33000), '5. mixed part 50,000 (KBZ 10,000): 36,000 · 4,000 · 0, DueDay on the SALE rows (not the PAYMENT), owed 33,000', o.rows.map(x => [x.type, x.cash, x.method, x.dueDay]));
  o = basket({ method: 'KBZ', mixed: true, bankPart: 30000, paid: 30000 });
  check(shape(o, [30000, 0, 0], ['KBZ', '', ''], 'credit', D, 0, 53000), '6. mixed with the cash part 0 (KBZ = paid = 30,000): 30,000 · 0 · 0 on KBZ, credit, no PAYMENT', o.rows.map(x => [x.cash, x.method]));
  o = basket({ method: 'KBZ', mixed: true, bankPart: 0 });
  const o7b = basket({ method: 'KBZ', mixed: true, bankPart: 0, paid: 30000 });
  check(shape(o, [36000, 22000, 25000], ['CASH', 'CASH', 'CASH'], '', '', 0, 0) && shape(o7b, [30000, 0, 0], ['CASH', '', ''], 'credit', D, 0, 53000),
    '7. mixed with the bank part 0: CASH by payKey, as 1 (full) or 3 (part)');

  // A bargained line alone carries 'price'; a group note wins over it.
  const A = bench(), staff = A.ports.store.getStaff('1001'), it = id => A.ports.store.getItem(id);
  let n = A.ledgerLen();
  commitBasket(A.ports, { lines: [{ item: it('S1-0002'), qty: 1, unitPrice: 15000, priceChanged: true }, { item: it('S1-0005'), qty: 1 }], staff, source: 'BUTTON' });
  const pr = A.world.ledger.slice(n);
  n = A.ledgerLen();
  commitBasket(A.ports, { lines: [{ item: it('S1-0002'), qty: 1, unitPrice: 15000, priceChanged: true }, { item: it('S1-0005'), qty: 1 }], paid: 1000, customerId: 'C-0001', staff, source: 'BUTTON' });
  const cr = A.world.ledger.slice(n);
  check(same(pr.map(x => x.note), ['price', '']) && same(cr.map(x => x.note), ['credit', 'credit']) && pr[0].unitPrice === 15000 && pr[0].amount === 15000,
    'a bargained line alone carries note price; a group note (credit) wins over it on every row (B5)', [pr.map(x => x.note), cr.map(x => x.note)]);
  // B8: a one-line basket writes commitSaleGroup's rows field by field.
  const X = bench(), Y = bench(), mask = r => Object.assign({}, r, { txId: '', groupId: '', refGroupId: r.refGroupId ? 'G' : '' });
  const pX = { method: 'KBZ', mixed: true, bankPart: 5000, paid: 9000, customerId: 'C-0001', dueDay: D, transcript: 't', updateId: 'u1' };
  const nX = X.ledgerLen(), nY = Y.ledgerLen();
  commitSaleGroup(X.ports, Object.assign({ item: X.ports.store.getItem(ITEM), qty: 1, staff: X.ports.store.getStaff('1001'), source: 'BUTTON' }, pX));
  commitBasket(Y.ports, Object.assign({ lines: [{ item: Y.ports.store.getItem(ITEM), qty: 1 }], staff: Y.ports.store.getStaff('1001'), source: 'BUTTON' }, pX));
  const rx = X.world.ledger.slice(nX).map(mask), ry = Y.world.ledger.slice(nY).map(mask);
  check(rx.length === 2 && same(rx, ry) && same(Object.keys(X.world.ledger[nX]), Object.keys(Y.world.ledger[nY])), 'a one-line basket writes commitSaleGroup\'s rows field by field (same fields, same order, same values; B8)', { rx, ry });
  // B7: one clock read.
  const C = bench(), start = Date.parse(addDaysKey(today, 0) + 'T17:29:59.999Z');
  let tick = 0;
  const P = Object.assign({}, C.ports, { clock: { now: () => new Date(start + (tick++)) } });
  const n2 = C.ledgerLen();
  commitBasket(P, { lines: [{ item: C.ports.store.getItem('S1-0002'), qty: 1 }, { item: C.ports.store.getItem('S1-0005'), qty: 1 }, { item: C.ports.store.getItem('S1-0003'), qty: 1 }],
    method: 'KBZ', mixed: true, bankPart: 1000, staff: C.ports.store.getStaff('1001'), source: 'BUTTON' });
  const rb = C.world.ledger.slice(n2);
  const n3 = C.ledgerLen();
  commitSaleGroup(P, { item: C.ports.store.getItem(ITEM), qty: 1, method: 'KBZ', mixed: true, bankPart: 1000, staff: C.ports.store.getStaff('1001'), source: 'BUTTON' });
  const rs = C.world.ledger.slice(n3);
  check(rb.length === 4 && rb.every(x => x.time === rb[0].time && x.day === rb[0].day) && rs.length === 2 && rs[0].time === rs[1].time && rs[0].day === rs[1].day,
    'a clock that advances 1 ms per now() across 23:59:59.999 Yangon: every row of a basket, and the SALE and PAYMENT of a mixed one-item sale, share one time and one day', { b: rb.map(x => x.time), s: rs.map(x => x.time) });
  let threw0 = false, threw11 = false;
  try { commitBasket(C.ports, { lines: [], staff: C.ports.store.getStaff('1001') }); } catch (e) { threw0 = true; }
  const eleven = []; for (let i = 0; i < 11; i++) eleven.push({ item: C.ports.store.getItem('S1-0002'), qty: 1 });
  try { commitBasket(C.ports, { lines: eleven, staff: C.ports.store.getStaff('1001') }); } catch (e) { threw11 = true; }
  check(threw0 && threw11, 'commitBasket throws on 0 lines and on 11 (a programming error: basketCheck refuses them first)');
  check(rewriteCheck(C.ports, rb[0].groupId).reason === 'complex', 'rewriteCheck answers complex for a basket (every corrective path refuses it)');
});

/* ============================== W27. readers on a basket ============================== */

step('W27. Readers on a basket: the sold card, the item card, Credits, undo, the customer card, saleGroupInfo, the receipt, describeGroup, deliveries, the owner\'s void');
runStep(() => {
  const u = U.sister, o = U.owner, D = addDaysKey(today, 14);
  // The outcome-5 basket through the review card: 83,000, KBZ 10,000 of 50,000 now, ဒေါ်မြင့်, 14 days.
  const sell5 = B => B.card(u, ITEM, [Q('l|S1-0002'), Q('q|2'), Q('add'), 'SS|S1-0002|i|S1-0005', Q('add'), 'SS|S1-0002|i|S1-0001', Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '10000' },
    Q('o|paid'), Q('p|other'), { type: '50000' }, { type: 'ဒေါ်မြင့်' }, Q('d|14'), 'SC|S1-0002|ok']);
  const A = bench();
  sell5(A);
  const g = A.lastRow().groupId, info = saleGroupInfo(A.ports, g), sold = A.screen(u);
  check(A.rowsOf(g).length === 4 && info.rows.length === 3 && basketGroup(info) && info.owed === 33000 && info.dueDay === D, 'the outcome-5 basket: three SALE rows and the PAYMENT, owed 33,000, the day', { rows: A.rowsOf(g).length, owed: info.owed });
  const wantSold = [txt('basket_sold', { n: '၃', qty: '၄', amount: '83,000' }), 'S1-0002 · လုံချည် ကချင် အပြာ × ၂ · 36,000 · လက်ကျန် ၃', 'S1-0005 · ထမီ ဇင်းမယ် အဝါ × ၁ · 22,000 · လက်ကျန် ၁', 'S1-0001 · ထမီ ချည်သား အနီ × ၁ · 25,000 · လက်ကျန် ၀'].join('\n');
  check(saleCardText(A.ports, g).indexOf(wantSold) === 0 && sold.text.indexOf(wantSold) === 0 && saleSoldCard(saleCtx(u.id, String(u.id), null, null, A.ports, null, false), { text: sold.text }),
    '(a) the sold card = basket_sold + one basket_sold_line per SALE row, and saleSoldCard recognises it', sold.text);
  check(sold.text.indexOf(txt('credit_done', { customer: 'ဒေါ်မြင့်', paid: '50,000', owed: '33,000' })) >= 0 && sold.text.indexOf(txt('sale_due_set', { owed: '33,000', date: fmtDayMy(D) })) >= 0,
    '…then the group lines as today (credit_done 50,000 / 33,000, the day)', sold.text);
  const c1 = cardText(A.ports, A.ports.store.getItem('S1-0001'));
  check(c1.indexOf(txt('card_buyer_basket', { customer: 'ဒေါ်မြင့်', n: '၃', paid: '50,000', method: 'ငွေသား 40,000 · KBZPay 10,000' })) >= 0 && c1.indexOf(head('card_buyer') + ' · ပေးပြီး') < 0,
    '(b) the sold-out S1-0001 card shows card_buyer_basket: the figure is said to be the basket\'s (🛍 ၃ ခု)', c1);
  const cr = openCredits(A.ports, null).filter(c => c.groupId === g)[0];
  check(cr && cr.item === basketName(A.ports, info) && cr.item === txt('basket_name', { n: '၃', names: 'လုံချည် ကချင် အပြာ, ထမီ ဇင်းမယ် အဝါ, ထမီ ချည်သား အနီ' }) && cr.itemId === 'S1-0002' && cr.dueDay === D,
    '(c) openCredits names the basket by basketName (ItemID stays the first item\'s)', cr);
  const S1 = bench();
  S1.card(u, 'S1-0004', ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0001', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|7', 'SC|S1-0004|ok']);
  const one = openCredits(S1.ports, null).filter(c => c.groupId === S1.lastRow().groupId)[0];
  check(one && one.item === 'ဝတ်စုံ ပိုးထည် အစိမ်း', '…while a one-line credit keeps its item name', one);
  const long = bench(), lid = 'S1-0003';
  long.ports.store.updateItem(lid, { name: 'အင်္ကျီ ရင်ဖုံး အဖြူ ပိုးထည် ရွှေချည်ထိုး' });
  long.card(u, ITEM, [Q('add'), 'SS|S1-0002|i|' + lid, Q('add'), 'SS|S1-0002|i|S1-0005', Q('add'), 'SS|S1-0002|i|S1-0001', Q('o|paid'), Q('p|0'), Q('o|buyer'), Q('b|C-0001'), Q('d|7'), 'SC|S1-0002|ok']);
  const ln = openCredits(long.ports, null).filter(c => c.groupId === long.lastRow().groupId)[0];
  check(ln && ln.item === txt('basket_name', { n: '၄', names: 'လုံချည် ကချင် အပြာ, ' + 'အင်္ကျီ ရင်ဖုံး အဖြူ ပိုးထည် ရွှေချည်ထိုး'.slice(0, CFG.BASKET_NAME_MAX - 1) + '…, ထမီ ဇင်းမယ် အဝါ, …' }),
    'basketName cuts a name to BASKET_NAME_MAX with …, joins three, then ", …"', ln && ln.item);
  // (d) the U| reply lists the three items with their stock back; a mixed one-item sale's reply is today's.
  const Ud = bench();
  sell5(Ud);
  const gd = Ud.lastRow().groupId;
  Ud.answer(u, 'U|' + gd);
  const ud = Ud.screen(u).text, it = id => Ud.ports.store.getItem(id);
  check(ud === [MSG.undo_done, txt('group_item_line', { id: 'S1-0002', name: it('S1-0002').name, stock: '၅' }), txt('group_item_line', { id: 'S1-0005', name: it('S1-0005').name, stock: '၂' }),
    txt('group_item_line', { id: 'S1-0001', name: it('S1-0001').name, stock: '၁' })].join('\n') && Ud.liveOf(gd).length === 0,
    '(d) U|g of the basket mirrors its four rows and lists the three items with their stock back (group_item_line)', ud);
  const Um = bench();
  Um.card(u, ITEM, [Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '5000' }, 'SC|S1-0002|ok']);
  const gm = Um.lastRow().groupId;
  Um.answer(u, 'U|' + gm);
  check(Um.screen(u).text === MSG.undo_done + '\n' + cardText(Um.ports, Um.ports.store.getItem(ITEM)), '…a mixed one-item sale\'s undo reply is today\'s (undo_done + the item card)', Um.screen(u).text);
  const Ux = bench();
  sell5(Ux);
  const gx = Ux.lastRow().groupId;
  Ux.world.items = Ux.world.items.filter(x => x.id !== 'S1-0005');
  Ux.answer(u, 'U|' + gx);
  check(Ux.screen(u).text === [MSG.undo_done, txt('group_item_line', { id: 'S1-0002', name: Ux.ports.store.getItem('S1-0002').name, stock: '၅' }),
    txt('group_item_line', { id: 'S1-0001', name: Ux.ports.store.getItem('S1-0001').name, stock: '၁' })].join('\n') && Ux.liveOf(gx).length === 0 && Ux.errorsOf('handleUpdate').length === 0,
    '…an item of the basket that has no Items row any more is left out of that list (no throw), as the old reply skipped it', Ux.screen(u).text);
  // (e) the customer card: one line for the basket, the later PAYMENT as its own line; a one-row group's line is customerLine's.
  const E = bench();
  sell5(E);
  const ge = E.lastRow().groupId;
  E.tick(60);
  commitPayment(E.ports, { groupId: ge, amount: 3000, staff: E.ports.store.getStaff('1001'), source: 'BUTTON' });
  const lines = customerLines(E.ports, 'C-0001', 0), hist = customerHistory(E.ports, 'C-0001', 0);
  const basketLine = txt('cust_line', { day: fmtDayShortMy(today), desc: txLabel('SALE') + ' ' + txt('basket_count', { n: '၃' }), amount: '83,000', paid: txt('cust_line_paid', { paid: '40,000' }), method: ' · ငွေသား' });
  check(lines[0] === customerLine(E.ports, hist[0]) && hist[0].type === 'PAYMENT' && lines.filter(l => l === basketLine).length === 1 &&
    lines.length === hist.length - 2 && lines.indexOf(customerLine(E.ports, hist.filter(r => r.type === 'PAYMENT' && r.note === 'split')[0])) >= 0,
    '(e) the customer card has ONE line for the basket ("ရောင်း 🛍 ၃ ခု · 83,000 · ပေး 40,000 · ငွေသား": the amount once), its split PAYMENT and the later payment as their own lines, any one-row group as customerLine', { lines: lines.slice(0, 4), basketLine });
  // (f) saleGroupInfo takes the first dated row; +15 days the 21:00 summary names the buyer.
  const F = bench(), fs1 = F.ports.store.getStaff('1001');
  const r1 = newTx(F.ports, { shop: 'S1', itemId: 'S1-0002', type: 'SALE', qty: -1, amount: 18000, cash: 0, customerId: 'C-0001', note: 'credit', staffId: '1001' });
  const r2 = newTx(F.ports, { groupId: r1.groupId, shop: 'S1', itemId: 'S1-0005', type: 'SALE', qty: -1, amount: 22000, cash: 0, customerId: 'C-0001', note: 'credit', staffId: '1001', dueDay: D });
  writeGroup(F.ports, [r1, r2]);
  check(saleGroupInfo(F.ports, r1.groupId).dueDay === D, '(f) a hand-built group whose row 1 is undated and row 2 dated: saleGroupInfo gives row 2\'s date', saleGroupInfo(F.ports, r1.groupId).dueDay);
  const F2 = bench();
  sell5(F2);
  F2.tick(15 * 1440);
  const sum = buildDailySummary(F2.ports, dayKey(F2.world.nowOverride)).split('\n').filter(l => l.indexOf(head('summary_due_overdue')) === 0)[0] || '';
  check(sum.indexOf('ဒေါ်မြင့် 33,000') >= 0, '+15 days the 21:00 summary names the basket\'s buyer under summary_due_overdue', sum);
  // (g) the receipt has three lines, the total and the method; dayStats sums.
  const rc = receiptText(A.ports, buildReceipt(A.ports, g)), st = A.stats('S1');
  check(rc.indexOf('83,000') >= 0 && rc.indexOf('KBZPay 10,000') >= 0 && ['လုံချည် ကချင် အပြာ', 'ထမီ ဇင်းမယ် အဝါ', 'ထမီ ချည်သား အနီ'].every(n => rc.indexOf(n) >= 0) && st.revenue >= 83000,
    '(g) receiptText lists the three lines, the total and the method; dayStats counts the basket', rc);
  // (h) describeGroup; a later commitPayment caps at the basket's owed.
  const rows = A.rowsOf(g);
  check(describeGroup(A.ports, rows) === txLabel('SALE') + ' ' + txt('basket_line', { n: '၃', amount: '83,000' }) + ' · 👤 ဒေါ်မြင့်', '(h) describeGroup of the basket: ရောင်း 🛍 ၃ ခု · 83,000 ကျပ် · 👤 ဒေါ်မြင့်', describeGroup(A.ports, rows));
  const R = bench(), rs = R.ports.store.getStaff('1001');
  const rg = commitRestockGroup(R.ports, { lines: [{ item: R.ports.store.getItem('S1-0002'), qty: 5 }, { item: R.ports.store.getItem('S1-0003'), qty: 2 }], staff: rs, source: 'BUTTON' });
  const single = R.world.ledger.filter(x => x.groupId !== rg.groupId && x.type === 'RESTOCK').slice(-1);
  check(describeGroup(R.ports, rg.txs) === txt('restock_group_done', { n: '၂', qty: '၇' }) && describeGroup(R.ports, single) === describeRow(R.ports, single[0]),
    '…of a two-line restock group: restock_group_done; of a one-row group: describeRow', describeGroup(R.ports, rg.txs));
  const pay = commitPayment(A.ports, { groupId: g, amount: 99999, staff: A.ports.store.getStaff('1001'), source: 'BUTTON' });
  check(pay.txs[0].amount === 33000 && saleGroupInfo(A.ports, g).owed === 0, '…and a later commitPayment caps at the basket\'s owed (33,000)', pay.txs[0].amount);
  // (i) a two-line custom-order delivery keeps today's texts everywhere.
  const V = bench(), vs = V.ports.store.getStaff('1001'), vg = 'V1-2533';
  const v1 = newTx(V.ports, { groupId: vg, shop: 'S1', itemId: vg + '-1', type: 'SALE', qty: -1, amount: 120000, cash: 0, customerId: 'C-0001', note: 'ပိုး ဝမ်းဆက်', staffId: '1001' });
  const v2 = newTx(V.ports, { groupId: vg, shop: 'S1', itemId: vg + '-2', type: 'SALE', qty: -1, amount: 60000, cash: 0, customerId: 'C-0001', note: 'ချည် ရင်ဖုံး', staffId: '1001' });
  writeGroup(V.ports, [v1, v2]);
  const vinfo = saleGroupInfo(V.ports, vg), vcr = openCredits(V.ports, null).filter(c => c.groupId === vg)[0], vlines = customerLines(V.ports, 'C-0001', 0), vhist = customerHistory(V.ports, 'C-0001', 0);
  check(!basketGroup(vinfo) && vcr.item === fmtCount(2) + ' ကြောင်း · ပိုး ဝမ်းဆက်' && same(vlines, vhist.map(r => customerLine(V.ports, r))) && describeGroup(V.ports, [v1, v2]) === describeRow(V.ports, v1),
    '(i) a two-line delivery (V1-2533) is no basket: its Credits name, its customer-card lines (one per voucher row) and describeGroup are today\'s', { item: vcr.item, d: describeGroup(V.ports, [v1, v2]) });
  V.sim.start(u, '');
  V.answer(u, 'U|' + vg);
  const vu = V.screen(u).text;
  check(vu === MSG.undo_done && V.liveOf(vg).length === 0 && V.errorsOf('handleUpdate').length === 0,
    '…and its U| reply is today\'s (no group_item_line for V1-2533-1, no throw)', vu);
  // (j) the owner's 🧾 of a basket offers 🚫 void, two hours later; a seller's does not; the owner's item card carries 🧾.
  const J = bench();
  sell5(J);
  const gj = J.lastRow().groupId;
  J.tick(120);
  J.sim.start(o, '');
  J.answer(o, 'RC|' + gj);
  const rco = J.screen(o);
  check(same(rco.datas, [['RCP|' + gj], ['V|' + gj]]) && same(rco.texts[1], [MSG.btn_void]), '(j) two hours later the owner\'s RC|g of the basket carries [📄 PDF] and [🚫 → V|g]', rco.datas);
  J.answer(u, 'RC|' + gj);
  check(same(J.screen(u).datas, [['RCP|' + gj]]), '…a seller\'s RC|g has no void button', J.screen(u).datas);
  J.scan(o, 'S1-0001');
  const oc = J.screen(o);
  J.scan(u, 'S1-0001');
  check(same(oc.datas.slice(-1), [['RC|' + gj]]) && same(J.screen(u).datas, [['T|S1-0001']]), '…the owner\'s item card of S1-0001 ends with 🧾 RC|g; the seller\'s card is today\'s', { owner: oc.datas, seller: J.screen(u).datas });
  J.sim.tap(o, rco.id, 'V|' + gj);
  const vo = rco.message.text;
  check(J.liveOf(gj).length === 0 && vo.indexOf(MSG.void_done) === 0 && vo.indexOf(txt('group_item_line', { id: 'S1-0001', name: 'ထမီ ချည်သား အနီ', stock: '၁' })) >= 0,
    '…that 🚫 voids every row and its reply lists the three items', vo);
  const K = bench();
  K.card(u, ITEM, ['SC|S1-0002|ok']);
  const gk = K.lastRow().groupId;
  K.sim.start(o, '');
  K.answer(o, 'RC|' + gk);
  const ko = K.screen(o).datas;
  K.answer(u, 'RC|' + gk);
  check(same(ko, [['RCP|' + gk]]) && same(K.screen(u).datas, [['RCP|' + gk]]), '…a one-line sale\'s receipt is today\'s for both', ko);
});


/* ============================== W28. new piece and restock writes ============================== */

step('W28. commitNewItem (a counted new piece), commitRestockGroup, and the undo of a new piece');
runStep(() => {
  const A = bench(), sis = A.ports.store.getStaff('1001'), own = A.ports.store.getStaff('1000'), it = id => A.ports.store.getItem(id);
  const restocks = id => A.world.ledger.filter(r => r.itemId === id && r.type === 'RESTOCK');
  let n = A.ledgerLen();
  const r1 = commitNewItem(A.ports, { itemId: 'S1-0007', name: 'ထမီ အသစ်', category: 'ထမီ', price: 25000, cost: 12000, count: 1, staff: sis });
  check(r1.ok && it('S1-0007').type === 'UNIQUE' && Number(it('S1-0007').stock) === 1 && restocks('S1-0007').length === 1 && restocks('S1-0007')[0].qty === 1 && restocks('S1-0007')[0].note === 'new item' &&
    restocks('S1-0007')[0].source === 'PHOTO' && A.ledgerLen() === n + 1 && r1.groupId === restocks('S1-0007')[0].groupId && r1.pending === false,
    'count 1 → a one-of-a-kind piece (UNIQUE), stock 1, one RESTOCK of 1 noted new item (source PHOTO)', { item: it('S1-0007'), rows: restocks('S1-0007') });
  n = A.ledgerLen();
  const r3 = commitNewItem(A.ports, { itemId: 'S1-0008', name: 'လုံချည် အသစ်', category: 'လုံချည်', price: 25000, cost: '', count: 3, sample: true, staff: sis });
  check(r3.ok && it('S1-0008').type === 'SKU' && Number(it('S1-0008').stock) === 3 && restocks('S1-0008').length === 1 && restocks('S1-0008')[0].qty === 3 && restocks('S1-0008')[0].note === 'new sample' &&
    A.ledgerLen() === n + 1 && it('S1-0008').cost === '' && it('S1-0008').sample === true,
    'count 3 → a stock item (SKU) with stock 3 by ONE RESTOCK of 3; the sample toggle notes it new sample; an unknown cost stays \'\'', { item: it('S1-0008'), rows: restocks('S1-0008') });
  const r0 = commitNewItem(A.ports, { itemId: 'S1-0009', name: '', category: 'chair', price: 0, count: 1, staff: sis });
  check(r0.ok && r0.pending === true && it('S1-0009').price === '' && it('S1-0009').name === 'ပစ္စည်း S1-0009' && it('S1-0009').category === 'အခြား',
    'a price of 0 is stored \'\' (pending); an empty name becomes the placeholder; an unknown category the catch-all အခြား', it('S1-0009'));
  n = A.ledgerLen();
  const items0 = JSON.stringify(A.world.items);
  const refusals = [
    commitNewItem(A.ports, { itemId: 'S9-0009', price: 1, staff: sis }).reason, commitNewItem(A.ports, { itemId: 'S1-0002', price: 1, staff: sis }).reason,
    commitNewItem(A.ports, { itemId: 'S1-0010', price: 1, count: 0, staff: sis }).reason, commitNewItem(A.ports, { itemId: 'S1-0010', price: 1, count: 1000, staff: sis }).reason,
    commitNewItem(A.ports, { itemId: 'S1-0010', count: 1, staff: sis }).reason, commitNewItem(A.ports, { itemId: 'S1-0010', price: -1, staff: sis }).reason,
    commitNewItem(A.ports, { itemId: 'S1-0010', price: 1.5, staff: sis }).reason, commitNewItem(A.ports, { itemId: 'S1-0010', price: 1, cost: 'x', staff: sis }).reason,
    commitNewItem(A.ports, { itemId: 'S2-0004', price: 1, staff: sis }).reason];
  check(same(refusals, ['missing', 'not_blank', 'count', 'count', 'price', 'price', 'price', 'cost', 'other_shop']) && A.ledgerLen() === n && JSON.stringify(A.world.items) === items0,
    'refused, writing nothing: missing, not_blank, count (0, 1000), price (absent, -1, 1.5), cost (x), and other_shop for a seller\'s S2 blank tag', refusals);
  check(commitNewItem(A.ports, { itemId: 'S2-0004', price: 1, staff: own }).ok, 'the owner may register a blank tag of either shop');
  // commitRestockGroup
  n = A.ledgerLen();
  const s2 = Number(it('S1-0002').stock), s3 = Number(it('S1-0003').stock);
  const rg = commitRestockGroup(A.ports, { lines: [{ item: it('S1-0002'), qty: 5 }, { item: it('S1-0003'), qty: 2 }], staff: sis, source: 'BUTTON' });
  const grows = A.rowsOf(rg.groupId);
  check(rg.ok && grows.length === 2 && grows.every(r => r.type === 'RESTOCK' && r.note === '' && r.source === 'BUTTON' && r.time === grows[0].time) && same(grows.map(r => r.qty), [5, 2]) &&
    Number(it('S1-0002').stock) === s2 + 5 && Number(it('S1-0003').stock) === s3 + 2 && A.ledgerLen() === n + 2,
    'two lines → ONE group of two RESTOCK rows (5 and 2, one time), stock up by both', grows.map(r => [r.itemId, r.qty]));
  A.sim.start(U.sister, '');
  A.answer(U.sister, 'U|' + rg.groupId);
  check(A.liveOf(rg.groupId).length === 0 && Number(it('S1-0002').stock) === s2 && A.screen(U.sister).text === [MSG.undo_done, txt('group_item_line', { id: 'S1-0002', name: it('S1-0002').name, stock: fmtCount(s2) }),
    txt('group_item_line', { id: 'S1-0003', name: it('S1-0003').name, stock: fmtCount(s3) })].join('\n'),
    'one undo mirrors both rows and its reply lists both items with their stock (the types-based reply)', A.screen(U.sister).text);
  n = A.ledgerLen();
  const eleven = []; for (let i = 0; i < 11; i++) eleven.push({ item: it('S1-0002'), qty: 1 });
  const rr = [commitRestockGroup(A.ports, { lines: [], staff: sis }).reason, commitRestockGroup(A.ports, { lines: eleven, staff: sis }).reason,
    commitRestockGroup(A.ports, { lines: [{ item: it('S1-0002'), qty: 0 }], staff: sis }).reason, commitRestockGroup(A.ports, { lines: [{ item: it('S1-0001'), qty: 1 }], staff: sis }).reason,
    commitRestockGroup(A.ports, { lines: [{ item: it('S1-0011'), qty: 1 }], staff: sis }).reason, commitRestockGroup(A.ports, { lines: [{ item: it('S1-0002'), qty: 1 }, { item: it('S2-0002'), qty: 1 }], staff: own }).reason,
    commitRestockGroup(A.ports, { lines: [{ item: it('S2-0002'), qty: 1 }], staff: sis }).reason];
  check(same(rr, ['empty', 'max', 'qty', 'unique', 'blank', 'other_shop', 'other_shop']) && A.ledgerLen() === n,
    'refused, writing nothing: empty, max (11 lines), qty (0), unique, blank, other_shop (two shops; a seller\'s line of another shop)', rr);
  // The undo of a new piece: within 30 minutes the tag is blank again; once a piece of it moved, refused.
  const B = bench(), bs = B.ports.store.getStaff('1001');
  const nb = commitNewItem(B.ports, { itemId: 'S1-0007', name: 'ထမီ အသစ်', category: 'ထမီ', price: 25000, count: 3, staff: bs });
  B.tick(10);
  B.sim.start(U.sister, '');
  const n2 = B.ledgerLen();
  B.answer(U.sister, 'U|' + nb.groupId);
  const blank = B.ports.store.getItem('S1-0007');
  check(B.ledgerLen() === n2 + 1 && B.liveOf(nb.groupId).length === 0 && blank.status === 'BLANK' && blank.name === '' && blank.type === '' && Number(blank.stock) === 0 && blank.price === '' &&
    B.screen(U.sister).text === MSG.undo_done + '\n' + txt('item_unregistered', { id: 'S1-0007' }),
    'U|g of a new piece within 30 minutes mirrors the RESTOCK and leaves the tag BLANK (name \'\', type \'\', stock 0): undo_done + item_unregistered, no card', { item: blank, text: B.screen(U.sister).text });
  const C = bench(), cs = C.ports.store.getStaff('1001');
  const nc = commitNewItem(C.ports, { itemId: 'S1-0007', name: 'ထမီ အသစ်', category: 'ထမီ', price: 25000, count: 3, staff: cs });
  C.card(U.sister, 'S1-0007', ['SC|S1-0007|ok']);
  const n3 = C.ledgerLen();
  C.answer(U.sister, 'U|' + nc.groupId);
  check(C.ledgerLen() === n3 && C.liveOf(nc.groupId).length === 1 && C.screen(U.sister).text === txt('undo_new_used', { id: 'S1-0007' }) && C.ports.store.getItem('S1-0007').name === 'ထမီ အသစ်',
    'after a sale of one of its pieces the same U|g answers undo_new_used and writes nothing', C.screen(U.sister).text);
});

/* ============================== W29. the Telegram new-piece card ============================== */

step('W29. The Telegram new-piece review card (form mode): the card, its sub-screens, ✅ သိမ်း, the refusals');
runStep(() => {
  const u = U.sister, PH = SIM_PHOTOS[0];
  const A = bench(), n0 = A.ledgerLen();
  let described = 0;
  const realDescribe = A.ports.ai.describePhoto;
  A.ports.ai.describePhoto = function (file, ctx) { described++; return realDescribe.call(this, file, ctx); };
  A.scan(u, 'S1-0007');
  check(A.screen(u).text === txt('new_tag', { id: 'S1-0007' }) && A.state(u).kind === 'new_item' && A.state(u).form === true && A.state(u).step === 'photo', 'a blank tag answers new_tag; the new-piece state is marked form');
  A.sim.photo(u, PH);
  let s = A.screen(u), st = A.state(u);
  const want = [txt('photo_seen', { name: PH.name, category: 'ထမီ' }), MSG.ask_price, MSG.item_lbl_cost_none, txt('item_lbl_count', { count: '၁' })].join('\n');
  check(s.text === want && st.step === 'card' && st.form === true && st.draft.count === 1 && A.ledgerLen() === n0 && described === 1 && !s.message.photo,
    'the photo → the new-piece card as a TEXT message: photo_seen, ask_price (neither a price nor pending yet), the cost unknown, ၁ ထည်; nothing written', s.text);
  check(same(s.datas.slice(1), [['P|S1-0007|other', 'P|S1-0007|pending'], ['C|S1-0007|other', 'NI|S1-0007|n'], ['NI|S1-0007|c', 'PS|S1-0007'], ['NI|S1-0007|q|-', 'NI|S1-0007|qn', 'NI|S1-0007|q|+'], ['NC|S1-0007|ok'], ['Z']]) &&
    s.datas[0].every(d => /^P\|S1-0007\|\d+$/.test(d)) && s.flat.indexOf('C|S1-0007|skip') < 0, 'its rows: the price presets, [✏️ other, ⏳ pending], [🪙 cost, ✏️ name], [🏷 category, 🎨 sample], [➖ 🔢 ➕], [✅ သိမ်း], [✖️] (no ⏭ skip-cost)', s.datas);
  const cardId = s.id;
  A.answer(u, 'P|S1-0007|25000');
  s = A.screen(u);
  check(s.id === cardId && A.state(u).step === 'card' && A.state(u).draft.price === 25000 && s.text.indexOf(txt('item_lbl_price', { price: '25,000' })) >= 0 && s.text.indexOf(MSG.ask_cost) < 0 && A.ledgerLen() === n0,
    'P|id|25000 sets the price and redraws the card in place (no ask_cost, no write)', s.text);
  A.answer(u, 'C|S1-0007|other');
  s = A.screen(u);
  check(s.id === cardId && A.state(u).step === 'cost' && s.text.endsWith(MSG.item_ask_cost) && same(s.datas, [['NI|S1-0007|back']]) && same(s.texts, [[MSG.btn_skip]]),
    '🪙 opens the cost sub-screen: item_ask_cost and [⏭ ကျော် → NI|id|back]', { text: s.text, datas: s.datas });
  A.answer(u, { type: '12000' });
  s = A.screen(u);
  check(s.id !== cardId && A.state(u).step === 'card' && A.state(u).draft.cost === 12000 && s.text.indexOf(txt('item_lbl_profit', { profit: '13,000', pct: '108' })) >= 0 && A.state(u).msgId === s.id,
    'typed 12000 → the card as a new message with 📈 13,000 · 108% (markup on cost)', s.text);
  A.answer(u, 'NI|S1-0007|q|+');
  A.answer(u, 'NI|S1-0007|q|+');
  check(A.screen(u).text.indexOf(txt('item_lbl_count', { count: '၃' })) >= 0 && A.state(u).draft.count === 3, '➕ twice → 🔢 ၃ ထည်', A.screen(u).text);
  A.answer(u, 'NI|S1-0007|n');
  s = A.screen(u);
  check(A.state(u).step === 'name' && s.text.endsWith(MSG.ask_name) && same(s.datas, [['NI|S1-0007|back']]), '✏️ နာမည် → ask_name with ⏮', s.text);
  A.answer(u, 'NI|S1-0007|back');
  check(A.state(u).step === 'card', '⏮ → the card');
  A.answer(u, 'NI|S1-0007|c');
  s = A.screen(u);
  check(A.state(u).step === 'cat' && s.text === MSG.item_ask_cat && same(s.datas, CFG.ITEM_CATEGORY_KEYS.map(k => ['NI|S1-0007|c|' + k]).concat([['LA|ic|NIC|S1-0007'], ['NI|S1-0007|back']])), '🏷 → item_ask_cat with the five categories by key, ➕ and ⏮ (round 6b, G2)', s.datas);
  A.answer(u, 'NI|S1-0007|c|1');
  check(A.state(u).step === 'card' && A.state(u).draft.category === 'လုံချည်', 'c|1 → လုံချည်, the card', A.state(u).draft);
  A.answer(u, 'PS|S1-0007');
  check(A.state(u).draft.sample === true && A.screen(u).text.indexOf(txt('item_lbl_count', { count: '၃' }) + MSG.sample_mark) >= 0, 'the 🎨 toggle marks the sample on the count line (round 6b)', A.screen(u).text);
  A.answer(u, 'PS|S1-0007');
  const ncMsg = A.last(u);
  A.answer(u, 'NC|S1-0007|ok');
  const item = A.ports.store.getItem('S1-0007'), rows = A.world.ledger.slice(n0);
  check(item.type === 'SKU' && Number(item.stock) === 3 && item.price === 25000 && item.cost === 12000 && item.category === 'လုံချည်' && rows.length === 1 && rows[0].type === 'RESTOCK' && rows[0].qty === 3 && rows[0].note === 'new item',
    '✅ သိမ်း → SKU, stock 3, ONE RESTOCK of 3 noted new item', { item, rows: rows.map(r => [r.type, r.qty, r.note]) });
  const done = A.bots(u).filter(m => m.text === MSG.item_created + ' · S1-0007')[0], last = A.screen(u);
  check(!!done && same(last.datas[0], ['U|' + rows[0].groupId]) && last.text === cardText(A.ports, item) && A.state(u) === null,
    'the card reads item_created · S1-0007, then the new piece\'s card follows with ↩️ U|<g> as its first row', last.datas);
  const bN = A.bots(u).length, lN = A.ledgerLen();
  A.sim.tap(u, ncMsg.id, 'NC|S1-0007|ok');
  check(A.bots(u).length === bN && A.ledgerLen() === lN && ncMsg.text === MSG.item_created + ' · S1-0007', 'a second ✅ on the same card within 120 s is swallowed by the tap guard (NC is a committing tap): no message, no row', A.bots(u).length - bN);
  // A pending price pings the owner with the SP| buttons.
  const B = bench();
  B.scan(u, 'S1-0007'); B.sim.photo(u, PH);
  B.answer(u, 'P|S1-0007|pending');
  check(B.screen(u).text.indexOf(MSG.btn_pending) >= 0 && B.state(u).draft.price === '', '⏳ marks the price pending on the card');
  B.answer(u, 'NC|S1-0007|ok');
  const ping = B.bots(U.owner).filter(m => m.text === txt('price_ask_owner', { id: 'S1-0007', name: PH.name }))[0];
  check(!!ping && ping.keyboard[0].every(b => /^SP\|S1-0007\|\d+$/.test(b.callback_data)) && B.ports.store.getItem('S1-0007').price === '', 'a pending price sends the owner price_ask_owner with the SP| buttons', ping && ping.keyboard);
  // Save with neither a price nor pending: ask_price on top, nothing written; the guard key is freed.
  const C = bench(), nC = C.ledgerLen();
  C.scan(u, 'S1-0007'); C.sim.photo(u, PH);
  const cc = C.screen(u);
  C.sim.tap(u, cc.id, 'NC|S1-0007|ok');
  check(C.ledgerLen() === nC && cc.message.text.indexOf(MSG.ask_price + '\n' + txt('photo_seen', { name: PH.name, category: 'ထမီ' })) === 0 && C.state(u).step === 'card', 'NC with neither a price nor pending → the card with ask_price on top, nothing written', cc.message.text);
  C.sim.tap(u, cc.id, 'P|S1-0007|22000');
  C.sim.tap(u, cc.id, 'NC|S1-0007|ok');
  check(C.ledgerLen() === nC + 1 && C.ports.store.getItem('S1-0007').price === 22000, 'a second NC on the same message within 120 s then works (the refused tap freed its guard key)', C.ledgerLen() - nC);
  const D = bench();
  D.scan(u, 'S1-0007'); D.sim.photo(u, PH);
  const dc = D.screen(u);
  D.scan(u, 'S1-0008');
  D.sim.tap(u, dc.id, 'NC|S1-0007|ok');
  check(D.screen(u).text === MSG.expired && D.ports.store.getItem('S1-0007').name === '', 'an NC after another tag replaced the state answers expired (nothing written)', D.screen(u).text);
  const Qk = bench({ quick: true });
  Qk.scan(u, 'S1-0007'); Qk.sim.photo(u, PH);
  Qk.answer(u, 'P|S1-0007|25000');
  check(Qk.screen(u).text.endsWith(MSG.ask_cost) && Qk.state(u).step === 'cost' && !Qk.state(u).form, 'under quick P| still asks ask_cost (the chain of before)', Qk.screen(u).text);
  // Typed text on the card.
  const T = bench();
  let tdesc = 0;
  const td = T.ports.ai.describePhoto;
  T.ports.ai.describePhoto = function (f, c) { tdesc++; return td.call(this, f, c); };
  T.scan(u, 'S1-0007'); T.sim.photo(u, PH);
  const ai0 = T.aiCalls(), d0 = tdesc;
  T.answer(u, { type: '25000' });
  check(T.state(u).draft.price === 25000 && T.screen(u).text.indexOf(txt('item_lbl_price', { price: '25,000' })) >= 0 && T.aiCalls() === ai0 && tdesc === d0, 'a typed 25000 at the card is the price, the card redrawn (no AI call)', T.state(u).draft);
  T.answer(u, { type: '300' });
  check(T.screen(u).text.indexOf(MSG.ask_price) === 0 && T.state(u).draft.price === 25000, 'a typed 300 (below 500) answers the card with ask_price on top', T.screen(u).text.split('\n')[0]);
  T.answer(u, { type: 'ထမီ အသစ်' });
  check(T.state(u).draft.name === 'ထမီ အသစ်' && T.screen(u).text.indexOf(txt('photo_seen', { name: 'ထမီ အသစ်', category: 'ထမီ' })) === 0 && T.aiCalls() === ai0, 'a typed ထမီ အသစ် becomes the name (no AI call)', T.state(u).draft);
  T.answers(u, ['NI|S1-0007|c|2', 'NI|S1-0007|q|+']);
  T.sim.photo(u, SIM_PHOTOS[1]);
  const dr = T.state(u).draft;
  check(dr.name === 'ထမီ အသစ်' && dr.category === 'အင်္ကျီ' && dr.count === 2 && dr.price === 25000 && dr.photoFileId !== '' && tdesc === d0 && T.state(u).step === 'card',
    'a second photo keeps the typed name, the category, the count and the price, replaces only the photo (no second describe)', dr);
});

/* ============================== W30. the app hooks in the core ============================== */

step('W30. The app hooks in the core (ports.ui.openForm): every way into a job opens its form; the item card where it must');
runStep(() => {
  const u = U.sister;
  const appWorld = () => {
    const A = bench(), calls = [];
    A.ports.ui = { openForm: (kind, req) => { calls.push({ kind, req }); return true; } };
    A.calls = calls;
    return A;
  };
  const A = appWorld();
  const card = A.scan(u, 'S1-0003');
  check(A.calls.length === 1 && A.calls[0].kind === 'sale' && A.calls[0].req.itemId === 'S1-0003' && A.calls[0].req.qty === 1 && A.state(u) === null && A.bots(u).length === 0,
    'openTag of a sellable piece in the app → openForm(sale, {itemId, qty 1}), no message, no state', A.calls);
  sendItemCard(u.id, A.ports.store.getItem(ITEM), A.ports.store.getStaff('1001'), A.ports);
  const ic = A.last(u), n0 = A.ledgerLen(), e0 = A.editsOf(ic.id);
  A.calls.length = 0;
  A.sim.tap(u, ic.id, 'S|S1-0002|3');
  check(same(A.calls.map(c => [c.kind, c.req.itemId, c.req.qty]), [['sale', ITEM, 3]]) && A.editsOf(ic.id) === e0 && A.state(u) === null && A.ledgerLen() === n0,
    'S|S1-0002|3 (the stepper) → openForm(sale, {itemId S1-0002, qty 3}); no edit, no state, nothing written', A.calls);
  A.calls.length = 0;
  ['Q|S1-0002', 'QN|S1-0002', 'D|S1-0002', 'R|S1-0002'].forEach(d => A.sim.tap(u, ic.id, d));
  check(same(A.calls.map(c => [c.kind, c.req.itemId, c.req.qty, c.req.focus]), [['sale', ITEM, 1, ''], ['sale', ITEM, 1, ''], ['sale', ITEM, 1, 'price'], ['restock', ITEM, undefined, undefined]]) &&
    A.state(u) === null && A.ledgerLen() === n0, 'Q| and QN| → sale with qty 1; D| → sale with focus price; R| → restock; nothing written, no state', A.calls.map(c => [c.kind, c.req.qty, c.req.focus]));
  A.calls.length = 0;
  A.sim.start(u, '');
  A.answer(u, 'M|exp');
  check(same(A.calls.map(c => c.kind), ['expense']) && A.state(u) === null, '☰ M|exp → openForm(expense)', A.calls);
  A.calls.length = 0;
  A.scan(u, 'S1-0007');
  check(same(A.calls.map(c => [c.kind, c.req.itemId]), [['newitem', 'S1-0007']]) && A.state(u) === null, 'a blank tag → openForm(newitem, {itemId})', A.calls);
  A.calls.length = 0;
  A.ports.store.updateItem('S1-0005', { price: '' });
  A.scan(u, 'S1-0005');
  check(same(A.calls.map(c => [c.kind, c.req.itemId]), [['sale', 'S1-0005']]), 'a price-pending piece → the sale form', A.calls);
  A.calls.length = 0;
  A.ports.store.updateItem('S1-0005', { price: 22000 });
  commitSale(A.ports, { item: A.ports.store.getItem('S1-0001'), qty: 1, staff: A.ports.store.getStaff('1001'), source: 'BUTTON' });
  const b0 = A.bots(u).length;
  A.scan(u, 'S1-0001');
  A.scan(u, 'S2-0002');
  check(A.calls.length === 0 && A.bots(u).length === b0 + 2 && A.last(u).text === cardText(A.ports, A.ports.store.getItem('S2-0002')), 'a sold piece and another shop\'s tag (a seller) → the item card, no form', A.calls);
  const other = A.last(u);
  A.sim.tap(u, other.id, 'S|S2-0002|1');
  check(A.calls.length === 0 && other.text === cardText(A.ports, A.ports.store.getItem('S2-0002')) + '\n' + txt('basket_other_shop', { id: 'S2-0002', shop: shopName(A.ports, 'S2') }),
    'S|S2-0002|1 by a seller → the card with basket_other_shop under it, no hook', other.text);
  A.sim.tap(u, other.id, 'K|S1-0002');
  check(A.calls.length === 0 && A.last(u).text === cardText(A.ports, A.ports.store.getItem(ITEM)), 'K|S1-0002 (☰ 🕘 / 🔍) → the item card, never the form', A.calls);
  A.scan(u, 'S2-0004');
  check(A.calls.length === 0 && A.last(u).text === txt('basket_other_shop', { id: 'S2-0004', shop: shopName(A.ports, 'S2') }) && A.state(u) === null,
    'a seller\'s blank S2 tag in form mode → basket_other_shop, no hook and no state', A.last(u).text);
  const Qk = bench({ quick: true }), qcalls = [];
  Qk.ports.ui = { openForm: (k, r) => qcalls.push(k) };
  const qcard = Qk.scan(u, ITEM), nq = Qk.ledgerLen();
  Qk.sim.tap(u, qcard.id, 'S|S1-0002|1');
  Qk.scan(u, 'S2-0004');
  check(qcalls.length === 0 && Qk.ledgerLen() === nq + 1 && Qk.last(u).text === txt('new_tag', { id: 'S2-0004' }), 'under quick: the item card and the one-tap commit; a seller\'s blank S2 tag gets today\'s new_tag', qcalls);
});

/* ============================== W31. the ➕ rule and the shared Save ============================== */

step('W31. The ➕ rule (add, pause, resume, close) and the shared Save');
runStep(() => {
  const u = U.sister;
  let A = bench();
  const card = A.card(u, ITEM, [Q('add')]);
  A.sim.start(u, 'S1-0005');
  let s = A.screen(u);
  check(card.text === MSG.basket_moved && same(A.datas(card), []) && s.id !== card.id && A.state(u).msgId === s.id && same(A.state(u).draft.lines.map(l => l.id), [ITEM, 'S1-0005']) && same(s.datas, CARD_ROWS(ITEM, [ITEM, 'S1-0005'])),
    '➕ then /start S1-0005: the add screen reads basket_moved (no buttons) and the card comes back as a NEW message with two lines', { moved: card.text, datas: s.datas });
  A.answers(u, [Q('add'), { type: 'S1-0003' }]);
  check(same(A.state(u).draft.lines.map(l => l.id), [ITEM, 'S1-0005', 'S1-0003']), 'a typed id at the add screen adds the line', A.state(u).draft.lines.map(l => l.id));
  A.answers(u, [Q('add'), { type: 'ဇင်းမယ်' }]);
  s = A.screen(u);
  check(A.state(u).step === 'add' && same(s.datas[s.datas.length - 1], [Q('back|add')]) && s.flat.indexOf('SS|S1-0002|i|S1-0005') < 0 && s.text.indexOf(MSG.find_none + '\n' + MSG.basket_add_ask) >= 0,
    'a typed name that only matches pieces already in the basket → find_none above the question (the recent rows stay)', { text: s.text, datas: s.datas });
  A = bench();
  A.card(u, ITEM, [Q('add'), { type: 'ဇင်းမယ်' }]);
  s = A.screen(u);
  check(A.state(u).step === 'add' && same(s.datas, [['SS|S1-0002|i|S1-0005'], [Q('back|add')]]), 'a typed ဇင်းမယ် at the add screen lists i|S1-0005 (a name search, revision 2 U25)', s.datas);
  A.answer(u, 'SS|S1-0002|i|S1-0005');
  check(A.state(u).step === 'card' && same(A.state(u).draft.lines.map(l => l.id), [ITEM, 'S1-0005']) && A.screen(u).id === s.id, 'i|S1-0005 adds it and redraws the card on the tapped message', A.state(u).draft.lines);
  A.answers(u, [Q('add'), 'SS|S1-0002|i|S1-0001']);
  const refusals = [];
  [['S1-0001', 'basket_twice'], ['S2-0002', 'basket_other_shop'], ['S1-0007', 'basket_blank'], ['S1-9999', 'tag_not_found']].forEach(p => {
    A.answers(u, [Q('add')]);
    A.sim.start(u, p[0]);
    refusals.push(A.screen(u).text.indexOf(fill(MSG[p[1]], { id: p[0], shop: shopName(A.ports, 'S2') })) === 0 && A.state(u).draft.lines.length === 3);
  });
  const sold = bench();
  sold.card(U.owner, 'S1-0004', ['SC|S1-0004|ok']);
  sold.card(u, ITEM, [Q('add')]);
  sold.sim.start(u, 'S1-0004');
  refusals.push(sold.screen(u).text.indexOf(txt('basket_gone', { id: 'S1-0004' })) === 0 && sold.state(u).draft.lines.length === 1);
  check(refusals.every(Boolean) && refusals.length === 5, 'S1-0001 twice, S2-0002, a blank tag, an unknown tag, a sold piece → their refusal lines on top of the card, the basket kept', refusals);
  // The pause (revision 2, U10).
  A = bench();
  const c1 = A.card(u, ITEM, [Q('l|S1-0002'), Q('q|2')]);
  const before = edits.length;
  A.scan(u, 'S1-0005');
  const pe = edits.slice(before).filter(e => e.world === A.world && e.messageId === c1.id);
  let st = A.state(u);
  const ic = A.screen(u);
  check(c1.text === txt('basket_paused', { n: '၁' }) && pe.length === 1 && pe[0].isCaption === true && same(A.datas(c1), [[Q('go')]]) && st.paused === true && st.resume === ic.id &&
    same(st.draft.lines, [{ id: ITEM, qty: 2, unitPrice: 18000, priceChanged: false }]) && same(ic.datas[0], ['SS|S1-0002|i|S1-0005']) && same(ic.datas.slice(1), cardKeyboard(A.ports, A.ports.store.getItem('S1-0005')).map(r => r.map(b => b.callback_data))),
    'a scan without ➕ edits the card (as a caption) to basket_paused with [↪️ → SS|<a>|go], keeps the basket (paused, resume = the new item card), whose first row is ➕ စာရင်းထဲ ထည့်', { text: c1.text, st, datas: ic.datas });
  A.sim.tap(u, ic.id, 'SS|S1-0002|i|S1-0005');
  st = A.state(u);
  check(!st.paused && st.resume === undefined && st.msgId === ic.id && same(st.draft.lines.map(l => l.id), [ITEM, 'S1-0005']) && ic.message.text.indexOf(txt('basket_title', { n: '၂' })) === 0 && st.cap === true,
    'that tap turns the item card into the card with both lines (state.msgId moves to it, unpaused)', st);
  A.sim.tap(u, c1.id, Q('go'));
  check(c1.text === MSG.expired && A.state(u).msgId === ic.id, 'the older paused card\'s ↪️ after that answers expired', c1.text);
  A.scan(u, 'S1-0003');
  const ic2 = A.screen(u);
  A.sim.tap(u, ic.id, Q('go'));
  check(!A.state(u).paused && A.state(u).msgId === ic.id && ic.message.text.indexOf(txt('basket_title', { n: '၂' })) === 0 && same(A.datas(ic.message), CARD_ROWS(ITEM, [ITEM, 'S1-0005'])),
    'go on the paused card redraws the card there, unpaused', A.state(u));
  A.sim.tap(u, ic2.id, 'S|S1-0003|1');
  st = A.state(u);
  check(ic.message.text === MSG.basket_closed && same(A.datas(ic.message), []) && st.item === 'S1-0003' && st.msgId === ic2.id && same(st.draft.lines.map(l => l.id), ['S1-0003']),
    '✅ on another item card while a basket is live closes the old card (basket_closed, no buttons) and starts a fresh one', { old: ic.message.text, st });
  A.scan(u, 'S1-0005');
  const ic3 = A.screen(u);
  A.sim.tap(u, ic3.id, 'S|S1-0005|1');
  check(ic2.message.text === MSG.basket_closed && A.state(u).item === 'S1-0005', 'the same while it is paused: the paused card reads basket_closed', ic2.message.text);
  const Pz = bench();
  Pz.card(u, ITEM, []);
  Pz.scan(u, ITEM);
  const again = Pz.screen(u);
  Pz.sim.tap(u, again.id, 'SS|S1-0002|i|S1-0002');
  check(same(again.datas[0], ['SS|S1-0002|i|S1-0002']) && Pz.state(u).msgId === again.id && !Pz.state(u).paused && same(Pz.state(u).draft.lines.map(l => [l.id, l.qty]), [[ITEM, 2]]),
    'a scan without ➕ of a stock item already a line: its item card also offers ➕ စာရင်းထဲ ထည့် (basketAddItem accepts it), and that tap raises the line to 2', { first: again.datas[0], lines: Pz.state(u).draft.lines });
  [['D|S1-0005', 'ask_sale_price', '20000'], ['QN|S1-0005', 'ask_qty_number', '2']].forEach(p => {
    const Cz = bench();
    const cz = Cz.card(u, ITEM, []);
    const iz = Cz.scan(u, 'S1-0005');
    Cz.sim.tap(u, iz.id, p[0]);
    const closed = cz.text === MSG.basket_closed && same(Cz.datas(cz), []) && Cz.state(u).kind === 'await_number';
    Cz.sim.text(u, p[2]);
    check(closed && Cz.state(u).kind === 'sale' && same(Cz.state(u).draft.lines.map(l => l.id), ['S1-0005']) && cz.text === MSG.basket_closed,
      p[0].split('|')[0] + ' on another item card while a basket is live (paused): the old card reads basket_closed at once (another sale starts), and the answer opens a fresh card', { old: cz.text, st: Cz.state(u) });
  });
  const Mz = bench();
  const mz = Mz.card(u, ITEM, []);
  const stz = Mz.state(u), ten = [];
  for (let i = 0; i < CFG.BASKET_MAX_LINES; i++) ten.push({ id: i ? 'S1-99' + (10 + i) : ITEM, qty: 1, unitPrice: 1000, priceChanged: false });
  stz.draft.lines = ten;
  setState(Mz.ports, String(u.id), stz);
  Mz.sim.tap(u, mz.id, Q('add'));
  const nine = Object.assign({}, stz, { draft: { lines: ten.slice(0, CFG.BASKET_MAX_LINES - 1) } });
  check(basketCardKeyboard(Mz.ports, stz).every(r => r.every(b => b.callback_data !== Q('add'))) && basketCardKeyboard(Mz.ports, nine).some(r => r.some(b => b.callback_data === Q('add'))) &&
    Mz.state(u).step === 'card', 'a card at CFG.BASKET_MAX_LINES lines has no ➕ (one line fewer has it), and a stale add there opens nothing', Mz.state(u).step);
  // The shared Save: a refused Save frees its tap key; the mode and method refusals.
  const S = bench(), nS = S.ledgerLen();
  const sc = S.card(u, ITEM, [Q('o|paid'), Q('p|0'), Q('back|buyer')]);
  S.sim.tap(u, sc.id, 'SC|S1-0002|ok');
  S.sim.tap(u, sc.id, Q('o|buyer'));
  S.sim.tap(u, sc.id, Q('b|C-0001'));
  S.sim.tap(u, sc.id, Q('d|none'));
  S.sim.tap(u, sc.id, 'SC|S1-0002|ok');
  check(S.ledgerLen() === nS + 1 && S.lastRow().customerId === 'C-0001', 'SC refused (no buyer), then fixed, then SC on the same message within 120 s writes one group (the refused tap freed its key)', S.ledgerLen() - nS);
  const M = bench(), nM = M.ledgerLen();
  const mc = M.card(u, ITEM, []);
  M.world.settings.sale_flow = 'quick';
  M.sim.tap(u, mc.id, 'SC|S1-0002|ok');
  check(M.ledgerLen() === nM && M.state(u) === null && mc.text === MSG.expired + '\n' + cardText(M.ports, M.ports.store.getItem(ITEM)) && same(mc.keyboard, cardKeyboard(M.ports, M.ports.store.getItem(ITEM))),
    'the owner flips sale_flow to quick while a card is open: SC answers expired and the message becomes the item card, nothing written', mc.text);
  const R = bench(), nR = R.ledgerLen();
  const rc = R.card(u, ITEM, [Q('o|method'), Q('m|KBZ')]);
  R.ports.store.setListRow('pay_method', 'KBZ', { active: false });
  R.sim.tap(u, rc.id, 'SC|S1-0002|ok');
  check(R.ledgerLen() === nR && rc.text.indexOf(MSG.basket_method_gone) === 0 && R.state(u).draft.method === 'CASH', 'a retired account at Save → basket_method_gone on top, nothing written, the method back to cash (the next Save is a checked choice)', R.state(u).draft);
  R.sim.tap(u, rc.id, 'SC|S1-0002|ok');
  check(R.ledgerLen() === nR + 1 && R.lastRow().method === 'CASH', 'and the next ✅ writes a cash sale', R.lastRow().method);
  // The app form and the card both write through basketCommitDraft: the same draft gives the same rows.
  const X = bench(), Y = bench(), nX = X.ledgerLen(), nY = Y.ledgerLen();
  X.card(u, ITEM, [Q('add'), 'SS|S1-0002|i|S1-0005', Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '5000' }, Q('o|paid'), Q('p|other'), { type: '20000' }, Q('b|C-0001'), Q('d|14'), 'SC|S1-0002|ok']);
  const draft = { lines: [{ id: ITEM, qty: 1, unitPrice: 18000, priceChanged: false }, { id: 'S1-0005', qty: 1, unitPrice: 22000, priceChanged: false }],
    method: 'KBZ', mixed: true, bankPart: 5000, part: true, paid: 20000, customerId: 'C-0001', dueDay: addDaysKey(today, 14) };
  const ry = basketCommitDraft(Y.ports, Y.ports.store.getStaff('1001'), draft, { source: 'BUTTON', updateId: X.lastRow().updateId });
  const mask = r => Object.assign({}, r, { txId: '', groupId: '', refGroupId: r.refGroupId ? 'G' : '', updateId: '' });
  check(ry.ok && same(X.world.ledger.slice(nX).map(mask), Y.world.ledger.slice(nY).map(mask)) && X.world.ledger.slice(nX).length === 3,
    'the review card and a direct basketCommitDraft of the same draft (what the app form calls) write identical rows', { x: X.world.ledger.slice(nX).map(r => [r.type, r.cash]), y: Y.world.ledger.slice(nY).map(r => [r.type, r.cash]) });
});

/* ============================== W32. round-6 texts and bytes ============================== */

step('W32. Round-6 texts and bytes');
runStep(() => {
  const specFile = path.join(ROOT, 'docs/design-round-6/SPEC-round-6.md');
  const spec = fs.existsSync(specFile) ? fs.readFileSync(specFile, 'utf8').replace(/\r\n/g, '\n') : '';
  const block = after => { const i = spec.indexOf(after); if (i < 0) return []; const a = spec.indexOf('```\n', i) + 4; return spec.slice(a, spec.indexOf('\n```', a)).split('\n').map(l => l.match(/^(\w+): '(.*)'$/)).filter(Boolean); };
  const b91 = block('### 9.1 core_messages.js'), b92 = block('### 9.2 Changed text');
  check(b91.length === 50 && b91.every(m => typeof MSG[m[1]] === 'string' && MSG[m[1]].length > 0 && MSG[m[1]] === m[2]), 'every key of SPEC-round-6.md 9.1 (fifty) is in MSG, non-empty and equal to the spec\'s text', b91.filter(m => MSG[m[1]] !== m[2]).map(m => m[1]));
  check(b92.length === 1 && b92[0][1] === 'settings_note_sale_flow' && MSG.settings_note_sale_flow === b92[0][2], 'settings_note_sale_flow equals SPEC-round-6.md 9.2', MSG.settings_note_sale_flow);
  const SX = syncSandbox(), bStock = block('Revision 2 (M2) adds ONE key');
  check(bStock.length === 1 && bStock[0][1] === 'ping_stock_short' && SX.SYNC_MSG.ping_stock_short === bStock[0][2] && SX.MSG.ping_stock_short === bStock[0][2],
    'ping_stock_short (core_sync.js SYNC_MSG, merged into MSG) equals SPEC-round-6.md 9.2', SX.MSG.ping_stock_short);
  const flagPorts = type => ({ store: { getItem: id => ({ id, name: 'N', type, stock: -1 }) } });
  const stockFlag = id => ({ kind: SX.SYNC.FLAG.STOCK_NEGATIVE, itemId: id, stock: -1, groupId: 'g-1' });
  const pSku = SX.syncFlagPing(flagPorts('SKU'), stockFlag('S1-0002')), pUni = SX.syncFlagPing(flagPorts('UNIQUE'), stockFlag('S1-0001'));
  check(pSku.text === SX.fill(bStock.length ? bStock[0][2] : '?', { name: 'N', id: 'S1-0002', stock: SX.fmtCount(-1) }) && pSku.kb.length === 0 &&
    pUni.text === SX.fill(SX.MSG.ping_stock_negative, { name: 'N', id: 'S1-0001', stock: SX.fmtCount(-1) }) && same(pUni.kb, [[{ text: MSG.btn_void, callback_data: 'V|g-1' }]]),
    'a stock_negative flag on a stock item pings ping_stock_short with no button; a one-of-a-kind piece keeps ping_stock_negative and V|<group> (spec 6.3)', { sku: pSku, uni: pUni });
  const btns = b91.map(m => m[1]).filter(k => k.indexOf('btn_') === 0);
  check(btns.length > 5 && btns.every(k => ['ငွေသား', 'KBZPay', 'WavePay', 'ဘဏ်လွှဲ'].every(w => MSG[k].indexOf(w) < 0) && MSG[k].indexOf('🏦 ') !== 0),
    'no new btn_* contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ, and none starts with 🏦 + space', btns.filter(k => MSG[k].indexOf('🏦 ') === 0));
  check(bytes('SS|S1-0002|rm|S1-0005') === 21 && bytes('SS|S1-0002|back|due_text') === 24 && bytes('SS|S1-0002|go') === 13 && bytes('NI|S1-0007|back') === 15 && bytes('NC|S1-0007|ok') === 13,
    'PINS (literal constants of spec 2.1 and 2.3): rm|S1-0005 21, back|due_text 24, go 13, NI|…|back 15, NC|…|ok 13 bytes');
  check(maxCb.len > 0 && maxCb.len <= 64 && buttonsSeen > 1000, 'every callback_data emitted by every bench so far (' + buttonsSeen + ' buttons) is within 64 bytes (longest ' + maxCb.len + ': ' + maxCb.data + ')');
  check(worlds.every(w => w.errors.filter(e => e.where === 'handleUpdate').length === 0), 'no update of any world failed with an exception',
    worlds.map(w => w.errors.filter(e => e.where === 'handleUpdate').map(e => e.message)).filter(x => x.length));
});

/* ============================== W33. returns on credit ============================== */

step('W33. Returns on credit: T| on a piece whose sale still owes writes nothing (ret_credit_open)');
runStep(() => {
  const u = U.sister, o = U.owner;
  const A = bench();
  A.card(u, ITEM, [Q('add'), 'SS|S1-0002|i|S1-0005', Q('add'), 'SS|S1-0002|i|S1-0001', Q('l|S1-0002'), Q('q|2'), Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '10000' },
    Q('o|paid'), Q('p|other'), { type: '50000' }, { type: 'ဒေါ်မြင့်' }, Q('d|14'), 'SC|S1-0002|ok']);
  const g = A.lastRow().groupId;
  check(saleGroupInfo(A.ports, g).owed === 33000, 'the outcome-5 basket owes 33,000');
  const n0 = A.ledgerLen();
  const c5 = A.scan(u, 'S1-0005');
  A.sim.tap(u, c5.id, 'T|S1-0005');
  const line = txt('ret_credit_open', { customer: 'ဒေါ်မြင့်', owed: '33,000' }), fresh5 = A.ports.store.getItem('S1-0005');
  check(A.ledgerLen() === n0 && c5.text === cardText(A.ports, fresh5) + '\n' + line && same(c5.keyboard, cardKeyboard(A.ports, fresh5)),
    'T|S1-0005 by the sister: nothing written, the card shows ret_credit_open with ဒေါ်မြင့် and 33,000', c5.text);
  const co = A.scan(o, 'S1-0005');
  A.sim.tap(o, co.id, 'T|S1-0005');
  check(A.ledgerLen() === n0 && co.text.endsWith(line) && same(A.datas(co).slice(-1), [['RC|' + g]]), 'the same by the owner: nothing written, the owner\'s 🧾 row shows (its receipt offers 🚫)', A.datas(co));
  A.sim.start(u, '');
  A.answer(u, 'PY|' + g);
  A.answer(u, 'PA|' + g + '|all');
  check(saleGroupInfo(A.ports, g).owed === 0, 'paid up (PA|g|all)', saleGroupInfo(A.ports, g).owed);
  const c5b = A.scan(u, 'S1-0005'), n1 = A.ledgerLen();
  A.sim.tap(u, c5b.id, 'T|S1-0005');
  check(A.ledgerLen() === n1 + 1 && A.lastRow().type === 'RETURN' && A.lastRow().itemId === 'S1-0005', 'after that T|S1-0005 writes today\'s RETURN', A.lastRow().type);
  const B = bench();
  B.card(u, 'S1-0004', ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0001', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|7', 'SC|S1-0004|ok']);
  const nb = B.ledgerLen(), cb = B.scan(u, 'S1-0004');
  B.sim.tap(u, cb.id, 'T|S1-0004');
  check(B.ledgerLen() === nb && cb.text.endsWith(txt('ret_credit_open', { customer: 'ဒေါ်မြင့်', owed: '22,500' })), 'a one-line credit sale\'s piece is refused the same way', cb.text);
  const C = bench(), Ref = bench({ quick: true });
  C.card(u, ITEM, ['SC|S1-0002|ok']);
  const cc = C.scan(u, ITEM), nc = C.ledgerLen();
  C.sim.tap(u, cc.id, 'T|S1-0002');
  const rr = Ref.scan(u, ITEM);
  Ref.answer(u, 'btn_sell_one');
  const rr2 = Ref.scan(u, ITEM);
  Ref.sim.tap(u, rr2.id, 'T|S1-0002');
  const gid = m => A.datas(m).map(r => r.map(d => d.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'G')));
  check(C.ledgerLen() === nc + 1 && C.lastRow().type === 'RETURN' && cc.text === rr2.text && cc.text.indexOf(head('return_done')) >= 0 && same(gid(cc), gid(rr2)) && gid(cc).length > 0,
    'a paid one-line sale\'s T| is today\'s reply byte for byte (compared with the same tap on a quick world)', { form: cc.text, quick: rr2.text });
  const V = bench(), vg = 'V1-2533';
  V.ports.store.updateItem('S1-0003', { alias: vg + '-1' });
  const v1 = newTx(V.ports, { groupId: vg, shop: 'S1', itemId: 'S1-0003', type: 'SALE', qty: -1, amount: 12000, cash: 0, customerId: 'C-0001', note: 'ပိုး', staffId: '1001' });
  writeGroup(V.ports, [v1]);
  check(creditOpenFor(V.ports, 'S1-0003') === null && saleGroupInfo(V.ports, vg).owed === 12000, 'a delivery\'s tagged piece is not refused by this rule (isOrderId)', creditOpenFor(V.ports, 'S1-0003'));
});


/* ============================== W34. the app's pages in the core ============================== */

step('W34. The app\'s pages in the core (ports.ui.openScreen): buyers, a buyer, the receipt; the menu\'s 📦 in the app');
runStep(() => {
  const u = U.sister;
  const appWorld = withForms => {
    const A = bench(), screens = [], forms = [];
    A.ports.ui = { openScreen: (name, req) => { screens.push({ name, req }); return true; } };
    if (withForms) A.ports.ui.openForm = (kind, req) => { forms.push({ kind, req }); return true; };
    A.screens = screens; A.forms = forms;
    return A;
  };
  const A = appWorld(false);
  A.card(u, ITEM, ['SC|S1-0002|ok']);
  const g = A.lastRow().groupId;
  A.sim.start(u, '');
  const b0 = A.bots(u).length;
  A.answer(u, 'M|cust');
  A.answer(u, 'CH|C-0001');
  A.answer(u, 'RC|' + g);
  check(same(A.screens.map(x => x.name), ['buyers', 'buyer', 'receipt']) && A.screens[1].req.customerId === 'C-0001' && A.screens[2].req.groupId === g && A.screens[0].req.uid === String(u.id) &&
    A.bots(u).length === b0 && A.state(u) === null, 'M|cust → openScreen(buyers); CH|C-0001 → openScreen(buyer, {customerId}); RC|g → openScreen(receipt, {groupId}); no message, no state', A.screens);
  const T = bench();
  T.card(u, ITEM, ['SC|S1-0002|ok']);
  const gT = T.lastRow().groupId;
  T.sim.start(u, '');
  T.answer(u, 'M|cust');
  const tl = T.screen(u);
  T.answer(u, 'CH|C-0001');
  const tc = T.screen(u);
  T.answer(u, 'RC|' + gT);
  const tr = T.screen(u);
  check(tl.text === MSG.cust_list && tl.flat.indexOf('CH|C-0001') >= 0 && tc.text.indexOf(fill(MSG.cust_card, { name: 'ဒေါ်မြင့်' }).split('\n')[0].split('{')[0]) === 0 &&
    tr.text === receiptText(T.ports, buildReceipt(T.ports, gT)) && same(tr.datas, [['RCP|' + gT]]),
    'without ports.ui (Telegram) the three answer today\'s texts: cust_list with CH| rows, the customer card, the receipt with [📄 PDF]', { list: tl.text, card: tc.text.split('\n')[0], rc: tr.datas });
  const F = appWorld(true);
  F.sim.start(u, '');
  const menuF = F.flat(F.last(u)), iR = menuF.indexOf('M|restock');
  T.sim.start(u, '');
  const menuT = T.flat(T.last(u));
  check(iR > 0 && menuF[iR - 1] === 'M|ord' && menuT.indexOf('M|restock') === menuT.indexOf('M|ord') + 1, 'the menu of a form-mode app world has M|restock right after the orders button; the Telegram menu has it too, right after the orders button (round 6b, G3)', { app: menuF, tg: menuT });
  const P = Object.assign({}, F.ports, { store: Object.assign({}, F.ports.store, { listOrders: undefined }), ui: Object.assign({ measureForm: () => true }, F.ports.ui) });
  showMenu(u.id, F.ports.store.getStaff('1001'), P);
  const menuM = F.flat(F.last(u)), iM = menuM.indexOf('M|restock');
  check(iM > 0 && menuM[iM - 1] === 'M|meas', '…and right after 📏 M|meas where the app has the measurement form and no order module', menuM);
  F.answer(u, 'M|restock');
  check(same(F.forms.map(x => x.kind), ['restock']) && F.forms[0].req.itemId === undefined && F.state(u) === null, 'M|restock → openForm(restock) with no item (the empty form, its camera on)', F.forms);
  T.sim.start(u, '');
  const bT = T.bots(u).length;
  T.answer(u, 'M|restock');
  check(T.bots(u).length === bT + 1 && T.screen(u).text === MSG.restock_ask_tag && same(T.screen(u).datas, [['Z']]) && T.state(u).kind === 'restock_loop' && T.state(u).step === 'tag',
    'in Telegram M|restock asks for the tag (restock_ask_tag, ✖️) and waits (round 6b, G3)', T.bots(u).length - bT);
});

/* ============================== W35. customerCheck / commitCustomer ============================== */

step('W35. customerCheck and commitCustomer (the app\'s buyer form)');
runStep(() => {
  const A = bench(), P = A.ports;
  const codes = (v, self) => customerCheck(P, v, self).problems.map(p => p.code);
  check(same(codes({ name: '  ', phone: '' }), ['name']) && customerCheck(P, { name: '' }).problems[0].key === 'ask_name', 'an empty name → name (ask_name)');
  check(same(codes({ name: 'ဦးသန့်', phone: '09123' }), ['phone']) && customerCheck(P, { name: 'x', phone: '09123' }).problems[0].key === 'basket_bad_phone', '5 digits → phone (basket_bad_phone)');
  const kp = customerCheck(P, { name: 'ဦးသန့်', phone: '09 123 456 78' }).problems[0];
  check(kp.code === 'known_phone' && kp.customerId === 'C-0001' && kp.key === 'ui_buyer_known_phone' && kp.vars.customer === 'ဒေါ်မြင့်', 'another customer\'s phone → known_phone with her id', kp);
  const sn = customerCheck(P, { name: 'ဒေါ်မြင့်', phone: '' }).problems[0];
  check(sn.code === 'same_name' && sn.customerId === 'C-0001' && customerCheck(P, { name: 'ဒေါ်မြင့်', phone: '', forceNew: true }).ok, 'an exact name for a new buyer → same_name (her id); forceNew passes', sn);
  check(customerCheck(P, { name: 'ဒေါ်မြင့်', phone: '09 123 456 78' }, 'C-0001').ok && same(codes({ name: '', phone: '0912' }), ['name', 'phone']),
    'the edited buyer\'s own phone and name pass; the codes come in order (name, phone)');
  const n0 = A.world.customers.length;
  const c1 = commitCustomer(P, { name: '  ဦးသန့်  ', phone: '09 777 123 456', note: 'ok' });
  const c2 = commitCustomer(P, { name: 'x'.repeat(70), phone: '+44 20 7946 0958 ext 12345', note: 'n'.repeat(150) });
  check(A.world.customers.length === n0 + 2 && c1.name === 'ဦးသန့်' && c1.phone === '09777123456' && c1.note === 'ok' && c2.name.length === CFG.CUST_NAME_MAX && c2.note.length === CFG.CUST_NOTE_MAX &&
    c2.phone === '+44 20 7946 0958 ext 12345'.slice(0, 20), 'commitCustomer normalises a valid phone, keeps an odd one as typed (cut to 20), cuts the name at 60 and the note at 100', { c1, c2 });
  const calls = [], real = P.store.updateCustomer;
  P.store.updateCustomer = function (id, ch) { calls.push([id, Object.keys(ch).sort()]); return real.call(this, id, ch); };
  const e1 = commitCustomer(P, { name: 'ဦးသန့်', phone: '09 111 222 333', note: 'ok' }, c1.id);
  const e2 = commitCustomer(P, { name: 'ဦးသန့်', phone: '09111222333', note: 'ok' }, c1.id);
  P.store.updateCustomer = real;
  check(same(calls, [[c1.id, ['phone']]]) && e1.phone === '09111222333' && e2.phone === '09111222333' && A.world.customers.length === n0 + 2,
    'an edit writes only the changed fields (the phone); an edit with nothing changed writes nothing', calls);
});

/* ============================== W36. view hints ============================== */

step('W36. View hints for the app (13.9): item, sold, today, the refusal line, the group replies; Telegram gets no extra argument');
runStep(() => {
  const u = U.sister;
  const recorder = A => {
    const rec = [];
    ['sendMessage', 'sendPhoto', 'editMessage'].forEach(fn => {
      const orig = A.ports.chat[fn];
      A.ports.chat[fn] = function () { rec.push({ fn, args: Array.prototype.slice.call(arguments) }); return orig.apply(this, arguments); };
    });
    return rec;
  };
  const viewOfCall = c => { const at = c.fn === 'sendMessage' ? 3 : c.fn === 'sendPhoto' ? 4 : 5; return c.args.length > at ? c.args[at] : undefined; };
  const A = bench();
  A.ports.ui = { openScreen: () => true };
  const rec = recorder(A);
  A.scan(u, ITEM);
  const item = rec[rec.length - 1];
  check(item.fn === 'sendPhoto' && same(viewOfCall(item), { view: { kind: 'item', id: ITEM, extra: [] } }), 'sendItemCard passes {view: {kind: item, id}}', viewOfCall(item));
  A.card(u, ITEM, [Q('o|buyer'), Q('b|C-0001'), 'SC|S1-0002|ok']);
  const g = A.lastRow().groupId, sold = rec[rec.length - 1];
  check(same(viewOfCall(sold), { view: { kind: 'sold', id: g, extra: [] } }), 'the sold card passes {view: {kind: sold, id: <group>}}', viewOfCall(sold));
  A.sim.start(u, '');
  A.answer(u, 'M|today');
  check(same(viewOfCall(rec[rec.length - 1]), { view: { kind: 'today' } }), 'answerToday passes {view: {kind: today}}', viewOfCall(rec[rec.length - 1]));
  A.card(u, 'S1-0004', ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0001', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|7', 'SC|S1-0004|ok']);
  const c4 = A.scan(u, 'S1-0004');
  A.sim.tap(u, c4.id, 'T|S1-0004');
  const line = txt('ret_credit_open', { customer: 'ဒေါ်မြင့်', owed: '22,500' });
  check(same(viewOfCall(rec[rec.length - 1]), { view: { kind: 'item', id: 'S1-0004', extra: [line] } }), 'case T\'s refusal passes the item view with its ret_credit_open line in extra', viewOfCall(rec[rec.length - 1]));
  const rq = A.scan(u, ITEM);
  A.sim.tap(u, rq.id, 'R|S1-0002');
  A.answer(u, 'RQ|S1-0002|5');
  const rqRow = A.lastRow();
  check(rqRow.type === 'RESTOCK' && same(viewOfCall(rec[rec.length - 1]), { view: { kind: 'group', id: rqRow.groupId } }), 'R| then +5 (a committed restock) passes {view: {kind: group, id}}', viewOfCall(rec[rec.length - 1]));
  A.sim.start(u, '');
  A.answer(u, 'PY|' + A.world.ledger.filter(r => r.itemId === 'S1-0004' && r.type === 'SALE').slice(-1)[0].groupId);
  A.answer(u, 'PA|' + A.world.ledger.filter(r => r.itemId === 'S1-0004' && r.type === 'SALE').slice(-1)[0].groupId + '|all');
  const payRow = A.lastRow();
  check(payRow.type === 'PAYMENT' && same(viewOfCall(rec[rec.length - 1]), { view: { kind: 'group', id: payRow.groupId } }), 'a payment (PA|) passes the group view', viewOfCall(rec[rec.length - 1]));
  A.sim.start(u, '');
  A.answer(u, 'DC|C-0001');
  A.answer(u, 'DA|C-0001|50000');
  A.answer(u, 'DN|C-0001|50000');
  const depRow = A.lastRow();
  check(depRow.type === 'DEPOSIT' && same(viewOfCall(rec[rec.length - 1]), { view: { kind: 'group', id: depRow.groupId } }), 'a deposit (DN|) passes the group view', viewOfCall(rec[rec.length - 1]));
  A.sim.start(u, '');
  A.answer(u, 'M|exp');
  A.tapData(u, A.flat(A.last(u)).filter(d => /^EC\|/.test(d))[0]);
  A.tapData(u, A.flat(A.last(u)).filter(d => /^EA\|/.test(d))[0]);
  A.tapData(u, A.flat(A.last(u)).filter(d => /^EM\|/.test(d))[0]);
  const expRow = A.lastRow();
  check(expRow.type === 'EXPENSE' && same(viewOfCall(rec[rec.length - 1]), { view: { kind: 'group', id: expRow.groupId } }), 'an expense (EM|) passes the group view', viewOfCall(rec[rec.length - 1]));
  const T = bench();
  const trec = recorder(T);
  T.scan(u, ITEM);
  T.card(u, ITEM, [Q('o|buyer'), Q('b|C-0001'), 'SC|S1-0002|ok']);
  T.sim.start(u, '');
  T.answer(u, 'M|today');
  const rq2 = T.scan(u, ITEM);
  T.sim.tap(u, rq2.id, 'R|S1-0002');
  T.answer(u, 'RQ|S1-0002|5');
  check(trec.length > 6 && trec.every(c => viewOfCall(c) === undefined), 'without ports.ui no chat call carries an extra argument at all (Telegram is byte for byte today\'s)', trec.filter(c => viewOfCall(c) !== undefined).map(c => c.fn));
});

/* ============================== W37. measurement core ============================== */

step('W37. Measurement core: the Sketch column, the sketch passed through, the PDF\'s rows, the copy, the Telegram line');
runStep(() => {
  const u = U.sister;
  check(CFG.MEAS_FIXED_COLS[CFG.MEAS_FIXED_COLS.length - 1] === 'Sketch' && CFG.MEAS_NOTE_KEY === 'note' && CFG.MEAS_NOTE_MAX === 300, 'CFG.MEAS_FIXED_COLS ends with Sketch; the note key and its 300 characters', CFG.MEAS_FIXED_COLS);
  const A = bench(), P = A.ports, staff = P.store.getStaff('1001'), sk = '1F:AAEC.BQYH';
  const adds = [], real = P.store.addMeasurement;
  P.store.addMeasurement = function (rec) { adds.push(JSON.parse(JSON.stringify(rec))); return real.call(this, rec); };
  saveMeasurement(P, { customerId: 'C-0002', values: { neck: '14' }, sketch: sk, photoUrl: 'drive://x' }, staff);
  saveMeasurement(P, { customerId: 'C-0002', values: { neck: '15' } }, staff);
  check(adds[0].sketch === sk && adds[0].photoUrl === 'drive://x' && !('sketch' in adds[1]), 'saveMeasurement passes the sketch (and only for a session that has one)', adds.map(a => a.sketch));
  const saved = P.store.listMeasurements('C-0002').filter(m => m.sketch === sk)[0];
  A.sim.start(u, '');
  A.answer(u, 'MF|' + saved.id);
  const tok = getState(P, String(u.id)).token;
  adds.length = 0;
  A.answer(u, 'MK|' + tok);
  check(adds.length === 1 && adds[0].sketch === sk && adds[0].photoUrl === 'drive://x' && adds[0].notes === 'fix of ' + saved.id, 'MF|<saved id> then MK keeps the sketch and the photoUrl in the fix', adds[0]);
  // measurementReport rules.
  const rep = id => measurementReport(P, { measId: id }, P.clock.now());
  const rows = r => r.sections.reduce((a, s) => a.concat(s.rows), []);
  const withSk = real.call(P.store, { customerId: 'C-0002', orderId: '', day: today, staffId: '1001', source: 'FORM', photoUrl: 'drive://fig', notes: '', fields: { neck: '14', note: 'ok note' }, sketch: sk });
  const r1 = rep(withSk.id), rr1 = rows(r1);
  check(same(r1.image, { url: 'drive://fig', caption: 'ကိုယ်ပုံ' }) && rr1.every(x => x[0] !== 'စာရွက် ဓာတ်ပုံ') && rr1.filter(x => x[1] === 'ok note').length === 1,
    'a session with a sketch and a photoUrl: report.image (the figure), no စာရွက် ဓာတ်ပုံ row, its note once', { image: r1.image, rows: rr1.filter(x => x[1] === 'ok note' || x[0] === 'စာရွက် ဓာတ်ပုံ') });
  const photo = real.call(P.store, { customerId: 'C-0002', orderId: '', day: today, staffId: '1001', source: 'PHOTO', photoUrl: 'drive://sheet', notes: 'No Bra', fields: { neck: '14' } });
  const rr2 = rows(rep(photo.id));
  check(rep(photo.id).image === undefined && rr2.some(x => x[0] === 'စာရွက် ဓာတ်ပုံ' && x[1] === 'drive://sheet') && rr2.some(x => x[0] === 'မှတ်ချက်' && x[1] === 'No Bra'),
    'a PHOTO session (no sketch) keeps its စာရွက် ဓာတ်ပုံ row and its margin note under မှတ်ချက်', rr2.slice(-3));
  const fixed = real.call(P.store, { customerId: 'C-0002', orderId: '', day: today, staffId: '1001', source: 'CHAT', photoUrl: '', notes: 'tight · fix of M-00041', fields: { neck: '14' } });
  const rr3 = rows(rep(fixed.id));
  check(rr3.some(x => x[0] === 'ပြင်ဆင်ချက်' && x[1] === 'fix of M-00041') && rr3.some(x => x[0] === 'မှတ်ချက်' && x[1] === 'tight') && rr3.every(x => x[1] !== 'tight · fix of M-00041'),
    'notes holding fix of M-…: that part prints as ပြင်ဆင်ချက်, the rest as မှတ်ချက်', rr3.slice(-3));
  const pre = real.call(P.store, { customerId: 'C-0002', orderId: '', day: today, staffId: '1001', source: 'PHOTO', photoUrl: '', notes: 'prefix of the hem', fields: { neck: '14' } });
  const lead = real.call(P.store, { customerId: 'C-0002', orderId: '', day: today, staffId: '1001', source: 'CHAT', photoUrl: '', notes: 'fix of M-00007', fields: { neck: '14' } });
  const rr4 = rows(rep(pre.id)), rr5 = rows(rep(lead.id));
  check(rr4.some(x => x[0] === 'မှတ်ချက်' && x[1] === 'prefix of the hem') && rr4.every(x => x[0] !== 'ပြင်ဆင်ချက်') &&
    rr5.some(x => x[0] === 'ပြင်ဆင်ချက်' && x[1] === 'fix of M-00007') && rr5.every(x => !(x[0] === 'မှတ်ချက်' && x[1] !== '')),
    'the split is at what saveMeasurement appends (\' · fix of \' or a leading \'fix of \'): a margin note "prefix of the hem" stays whole under မှတ်ချက်; a leading fix of M-… is ပြင်ဆင်ချက် alone', { pre: rr4.slice(-2), lead: rr5.slice(-2) });
  // MM|copy and the Telegram line.
  const B = bench(), BP = B.ports;
  BP.store.addMeasurement({ customerId: 'C-0002', orderId: '', day: today, staffId: '1001', source: 'FORM', photoUrl: 'drive://fig', notes: '', fields: { neck: '14' }, sketch: sk });
  const newest = latestMeasurement(BP, 'C-0002');
  B.sim.start(u, '');
  B.answer(u, 'MS|C-0002');
  const ms = B.screen(u);
  check(ms.text.indexOf(MSG.ms_sketch_line) >= 0 && ms.flat.indexOf('MP|' + newest.id) >= 0, 'startMeasureFor with a newest session that has a drawing shows ms_sketch_line and [📏 PDF → MP|<id>]', { text: ms.text, datas: ms.datas });
  const badds = [], breal = BP.store.addMeasurement;
  BP.store.addMeasurement = function (rec) { badds.push(JSON.parse(JSON.stringify(rec))); return breal.call(this, rec); };
  B.answer(u, B.flat(B.last(u)).filter(d => /\|copy$/.test(d))[0]);
  B.tapData(u, B.flat(B.last(u)).filter(d => /^MK\|/.test(d))[0]);
  check(badds.length === 1 && badds[0].sketch === sk && badds[0].photoUrl === 'drive://fig' && badds[0].source === 'COPY', 'MM|copy of a session with a drawing keeps the sketch and the photoUrl', badds[0]);
  const C = bench();
  C.sim.start(u, '');
  C.answer(u, 'MS|C-0001');
  check(C.screen(u).text.indexOf(MSG.ms_sketch_line) < 0, 'a customer whose newest session has no drawing gets no such line');
});

/* ============================== W38. the AI switch ============================== */

step('W38. The AI switch (Settings ai): aiOn, and every gate in the core');
runStep(() => {
  const u = U.sister;
  const on = v => { const w = createSimWorld(); if (v !== undefined) w.settings.ai = v; return aiOn(w.ports); };
  check(on(undefined) && on('TRUE') && on('yes') && on(true) && !on('FALSE') && !on('false ') && !on(0) && !on(false) && !on('off') && !on('No'),
    'aiOn: a missing row, TRUE, yes and true read ON; FALSE, "false ", 0, false, off and No read OFF');
  const A = bench();
  A.world.settings.ai = 'FALSE';
  const ai0 = A.aiCalls();
  A.sim.voice(u, 'ဒါ ၂ ထည် ရောင်းရတယ်');
  const v = A.screen(u).text;
  A.sim.text(u, 'ဒါ ၂ ထည် ရောင်းရတယ်');
  const tx = A.screen(u).text;
  check(v === MSG.ai_off && tx === MSG.ai_off && A.aiCalls() === ai0, 'with ai FALSE a voice note and a typed sentence answer ai_off; the mock AI is never called', { v, tx, calls: A.aiCalls() - ai0 });
  let described = 0;
  const realD = A.ports.ai.describePhoto;
  A.ports.ai.describePhoto = function (f, c) { described++; return realD.call(this, f, c); };
  A.scan(u, 'S1-0007');
  A.sim.photo(u, SIM_PHOTOS[0]);
  check(described === 0 && A.state(u).draft.name === 'ပစ္စည်း S1-0007' && A.screen(u).text.indexOf(txt('photo_seen', { name: 'ပစ္စည်း S1-0007', category: 'အခြား' })) === 0,
    'a photo of a blank tag gives the card with ပစ္စည်း S1-0007 and no describePhoto call', A.screen(u).text.split('\n')[0]);
  A.answer(u, 'Z');
  A.sim.start(u, '');
  const menu = A.flat(A.last(u));
  A.answer(u, 'M|nb');
  check(A.world.settings.notebook_import === true && menu.indexOf('M|nb') < 0 && A.screen(u).text === MSG.nb_off && A.state(u) === null,
    'the menu has no M|nb although notebook_import is TRUE, and M|nb answers nb_off', menu);
  const row = measMethodRow(A.ports, 'tok');
  check(row[0].every(b => !/\|photo$/.test(b.callback_data)) && row[0].some(b => /\|chat$/.test(b.callback_data)), 'the measurement method row has no photo button (only typing)', row);
  A.world.settings.ai = 'TRUE';
  const F = bench(), forms = [];
  F.ports.ui = { openForm: (k, r) => forms.push(k), openScreen: () => true };
  F.sim.start(u, '');
  check(F.flat(F.last(u)).indexOf('M|nb') >= 0 && F.world.settings.notebook_import === true, 'with ai TRUE and notebook_import TRUE the app\'s menu has M|nb (the notebook stays in the app)', F.flat(F.last(u)));
  const B = bench();
  B.sim.start(u, '');
  check(B.flat(B.last(u)).indexOf('M|nb') >= 0 && measMethodRow(B.ports, 't')[0].some(b => /\|photo$/.test(b.callback_data)), 'a world without the ai row keeps 📒 and the photo button (a missing row reads ON)');
  const N = bench();
  N.sim.start(u, '');
  N.answer(u, 'M|nb');
  let readNb = 0;
  const realNb = N.ports.ai.readNotebook;
  N.ports.ai.readNotebook = function () { readNb++; return realNb.apply(this, arguments); };
  N.world.settings.ai = 'FALSE';
  N.sim.photo(u, SIM_PHOTOS[0]);
  check(readNb === 0 && N.screen(u).text === MSG.nb_off && N.state(u) === null, 'with 📒 waiting and the switch turned off since, the notebook photo is not read: nb_off, the state cleared', { calls: readNb, text: N.screen(u).text });
  const Mw = bench();
  Mw.sim.start(u, '');
  Mw.answer(u, 'MS|C-0001');
  const mtok = Mw.state(u).token;
  Mw.answer(u, 'MM|' + mtok + '|photo');
  let readMs = 0;
  const realMs = Mw.ports.ai.readMeasurementSheet;
  Mw.ports.ai.readMeasurementSheet = function () { readMs++; return realMs.apply(this, arguments); };
  Mw.world.settings.ai = 'FALSE';
  Mw.sim.photo(u, SIM_PHOTOS[0]);
  check(readMs === 0 && Mw.screen(u).text === MSG.ai_off && same(Mw.screen(u).datas, measMethodRow(Mw.ports, mtok).map(r => r.map(b => b.callback_data))) && Mw.state(u).token === mtok,
    'with the sheet photo waiting and the switch turned off since, the photo is not read: ai_off with the typing choice, the session kept', { calls: readMs, text: Mw.screen(u).text });
});

/* ============================== W39. revision-3 texts ============================== */

step('W40. Step-1 rules whose end-to-end suites are step 2\'s: core_sync.js (the setting entry, the drawing on the wire, the jobs) and setupSheet (sale_flow, ai, the Shops block)');
runStep(() => {
  const SX = syncSandbox(), S3 = syncSandbox('S3');
  const own = { id: 'd-own', role: 'owner', staffId: '1000', status: 'active' }, sis = { id: 'd-sis', role: 'staff', staffId: '1001', status: 'active' };
  // The setting entry (13.12): the whitelist built from CFG.SHOP_IDS, the reasons, the apply, the phone's ack.
  check(same(Array.from(SX.SYNC.SETTING_KEYS), ['shop_name_S1', 'shop_name_S2', 'shop_address_S1', 'shop_address_S2', 'shop_phone_S1', 'shop_phone_S2', 'ai', 'notebook_import', 'app_voice']) &&
    SX.SYNC.ENTRY_KINDS.setting === 8 && same(Array.from(S3.SYNC.SETTING_KEYS), ['shop_name_S1', 'shop_name_S2', 'shop_name_S3', 'shop_address_S1', 'shop_address_S2', 'shop_address_S3',
      'shop_phone_S1', 'shop_phone_S2', 'shop_phone_S3', 'ai', 'notebook_import', 'app_voice']),
    'SYNC.SETTING_KEYS is the nine keys of spec 13.12 and is built from CFG.SHOP_IDS: a third id there adds its name, address and phone (F10b); ENTRY_KINDS.setting = 8', Array.from(SX.SYNC.SETTING_KEYS));
  const why = (dev, key, value) => SX.syncSettingReason(dev, { kind: 'setting', key, value });
  const okWhy = [why(own, 'shop_name_S1', 'ဆိုင် ၁ (ရန်ကုန်)'), why(own, 'shop_address_S2', ''), why(own, 'shop_phone_S1', '09 123 456 / 09 789'),
    why(own, 'shop_name_S2', 'n'.repeat(40)), why(own, 'shop_address_S1', 'a'.repeat(80)), why(own, 'ai', 'FALSE'), why(own, 'app_voice', 'TRUE'), S3.syncSettingReason(own, { kind: 'setting', key: 'shop_address_S3', value: 'x' })];
  const badWhy = [why(own, 'shop_brand_S1', 'x'), why(own, 'sale_flow', 'quick'), why(own, 'shop_name_S1', 'n'.repeat(41)), why(own, 'shop_name_S1', '  '),
    why(own, 'shop_address_S1', 'a'.repeat(81)), why(own, 'shop_phone_S1', 'p'.repeat(41)), why(own, 'ai', 'maybe'), why(own, 'ai', 'true'), why(own, 'ai', true), why(own, 'shop_name_S3', 'x')];
  check(okWhy.every(r => r === null) && badWhy.every(r => r === 'malformed') && why(sis, 'shop_name_S1', 'x') === 'staff' && why(sis, 'ai', 'FALSE') === 'staff',
    'syncSettingReason: the owner\'s keys pass (an empty address too); another key (a brand, sale_flow, S3 while CFG.SHOP_IDS has no S3; with it S3 passes), a name over 40 or blank, an address over 80, a phone over 40, an ai other than TRUE / FALSE are malformed; a seller\'s entry is staff', { okWhy, badWhy });
  const batch = { entries: [{ kind: 'setting', entryId: 'e1', key: 'ai', value: 'FALSE' }] };
  check(SX.syncValidateBatch({ store: { getItem: () => null } }, own, batch).entries[0].reason === 'bad_kind' && SX.syncValidateBatch({ store: { getItem: () => null, setSetting: () => null } }, own, batch).entries[0].ok,
    'a server store without setSetting refuses a setting entry bad_kind; with it the entry passes');
  const sw = SX.seedSimWorld(SX.createSimWorld()), srv = SX.createFakeServer(sw), sp = srv.ports, wrote = [];
  sp.store.setSetting = (k, v) => { wrote.push(k + '=' + v); sw.settings[k] = v; };
  let bn = 0;
  const push = (dev, key, value) => SX.syncApplyPush(sp, dev, { batchId: 'w40-' + (++bn), entries: [{ kind: 'setting', entryId: 'w40e-' + bn, key, value }] }).results[0];
  const r1 = push(own, 'shop_name_S1', 'ဆိုင် ၁ (ရန်ကုန် အသစ်)'), r2 = push(own, 'shop_name_S1', 'ဆိုင် ၁ (ရန်ကုန် အသစ်)');
  sw.settings.ai = 'true';
  const r3 = push(own, 'ai', 'TRUE'), r4 = push(sis, 'shop_phone_S1', '09 1');
  check(r1.status === 'ok' && r1.kind === 'setting' && sw.settings.shop_name_S1 === 'ဆိုင် ၁ (ရန်ကုန် အသစ်)' && r2.status === 'dup' && r3.status === 'dup' &&
    r4.status === 'quarantined' && r4.reason === 'staff' && same(wrote, ['shop_name_S1=ဆိုင် ၁ (ရန်ကုန် အသစ်)']),
    'applied on the server twin: the owner\'s entry is written (ok), the same value again is dup, a stored "true" meets TRUE as dup (no case), a seller\'s entry is quarantined staff; one write in all', { r1, r2, r3, r4, wrote });
  const local = () => { const l = { removed: [], cursor: { settingsHash: 'h1' } }; l.removeEntry = id => l.removed.push(id); l.removeRows = () => null; l.markSynced = () => null; l.getCursor = () => l.cursor; l.setCursor = c => { l.cursor = c; }; return l; };
  const ack = res => { const l = local(); SX.syncApplyPushResults(l, [{ kind: 'setting', entryId: 'e1', key: 'ai', value: 'FALSE' }], [Object.assign({ entryId: 'e1', kind: 'setting' }, res)], '', ''); return [l.removed.length, l.cursor.settingsHash]; };
  check(same(ack({ status: 'quarantined', reason: 'bad_kind' }), [0, 'h1']) && same(ack({ status: 'quarantined', reason: 'bad_kind', kindKnown: true }), [1, '']) &&
    same(ack({ status: 'quarantined', reason: 'staff' }), [1, '']) && same(ack({ status: 'ok' }), [1, 'h1']) && same(ack({ status: 'retry' }), [0, 'h1']),
    'the phone\'s ack of a setting: bad_kind without kindKnown (an older server) keeps it; bad_kind with kindKnown or any quarantine drops it and clears the settings hash (the next pull brings the server\'s value back); ok drops it alone; retry keeps it');
  // The drawing on the wire (13.7): the note's 300 characters, the sketch's pattern and length, the apply and the pull.
  const mdev = { id: 'd-sis', role: 'staff', staffId: '1001' }, sk = '1F:AAEC.BQYH';
  const mrec = x => Object.assign({ customerId: 'C-0002', day: today, staffId: '1001', fields: { neck: '14' } }, x);
  const mr = x => SX.syncMeasRecReason(mdev, mrec(x));
  check([mr({}), mr({ sketch: sk }), mr({ sketch: '' }), mr({ sketch: '1M:' + 'A'.repeat(3997) }), mr({ fields: { note: 'n'.repeat(300) } })].every(r => r === null) &&
    [mr({ sketch: '1F:' + 'A'.repeat(3998) }), mr({ sketch: '2F:AAEC' }), mr({ sketch: '1F:AA=C' }), mr({ sketch: 12 }), mr({ fields: { note: 'n'.repeat(301) } }), mr({ fields: { neck: 'n'.repeat(61) } })].every(r => r === 'malformed'),
    'syncMeasRecReason: a sketch absent, \'\' or of the pattern within 4,000 characters passes; 4,001 characters, a bad pattern or a number is malformed; the note field keeps 300 characters (301 refused), every other value 60');
  const page = SX.syncMeasPage([{ id: 'M-00001', customerId: 'C-0002', day: today, notes: '', fields: { neck: '14' }, sketch: sk }, { id: 'M-00002', customerId: 'C-0002', day: today, notes: '', fields: { neck: '15' }, sketch: '' }], 0, 10).list;
  const adds = [], msp = { store: { getCustomer: id => ({ id }), listMeasurements: () => [], addMeasurement: r => { adds.push(r); return { id: 'M-0000' + adds.length }; } } };
  SX.syncApplyMeasurementEntry(msp, mdev, mrec({ sketch: sk }), 'w40-m1');
  SX.syncApplyMeasurementEntry(msp, mdev, mrec({ fields: { neck: '16' } }), 'w40-m2');
  check(page.length === 2 && page[0].sketch === sk && !('sketch' in page[1]) && adds.length === 2 && adds[0].sketch === sk && !('sketch' in adds[1]),
    'a session with a drawing is stored with it and pulled with it; one without is stored and pulled without the key', { page, adds: adds.map(a => a.sketch) });
  // The jobs (13.7.2, 13.11): the switch refuses an AI job without calling the hook; a sketch or pic job always runs.
  const jobs = {}, logged = [];
  let aiVal = 'FALSE', hookCalls = 0, hookFail = null, jn = 0;
  const jsp = { store: { getSetting: (k, d) => (k === 'ai' ? aiVal : d), logError: where => logged.push(where) }, sync: { aiJob: (id, rec) => (rec === undefined ? (jobs[id] || null) : (jobs[id] = rec)) } };
  const hooks = { ai: j => { hookCalls++; if (hookFail) throw new Error(hookFail); return j.kind === 'photo' ? { desc: { name: 'n' }, photoUrl: 'drive://p' } : { photoUrl: 'drive://' + j.kind }; } };
  const job = kind => SX.syncHandle(jsp, 'ai', { device: 'd-own', token: 't', job: { id: 'w40j' + (++jn), kind, itemId: 'S1-0007', entryId: 'e-1' } }, BASE, hooks).job;
  const realAuth = SX.syncAuthenticate;
  SX.syncAuthenticate = () => ({ ok: true, device: own });
  try {
    const off = job('photo'), offCalls = hookCalls, skOff = job('sketch'), picOff = job('pic');
    aiVal = 'TRUE';
    const on = job('photo');
    check(off.status === 'failed' && off.error === 'ai_off' && offCalls === 0 && skOff.status === 'done' && skOff.photoUrl === 'drive://sketch' && picOff.status === 'done' && picOff.photoUrl === 'drive://pic' &&
      on.status === 'done' && hookCalls === 3,
      'the server\'s ai API: with ai FALSE a photo job is refused ai_off without calling the hook, while a sketch and a pic job run and answer their photoUrl; with ai TRUE the photo job runs', { off, skOff, picOff, on });
    hookFail = 'no_session';
    const ns = job('sketch');
    hookFail = 'no_item';
    const ni = job('pic');
    hookFail = 'boom';
    const bm = job('photo');
    check(ns.status === 'failed' && ns.error === 'no_session' && ni.status === 'failed' && ni.error === 'no_item' && bm.status === 'failed' && same(logged, ['ai']),
      'a sketch\'s no_session and a pic\'s no_item fail with no Errors row (the phone tries again); any other failure is logged as before', { ns, ni, logged });
  } finally {
    SX.syncAuthenticate = realAuth;
  }
  // setupSheet (6.1, 13.11, 13.12) on poc/fake_gas.js: a new book, a round-5 book, a book the family typed into.
  const G = setupBook(), GS = () => G.sheet('Settings'), grow = k => GS().rows().find(o => String(o.Key) === k);
  const errs = fake => (fake.sheet('Errors') ? fake.sheet('Errors').rows() : []);
  const shopKeys = [], notesOk = [];
  CFG.SHOP_IDS.forEach((id, i) => ['name', 'brand', 'address', 'phone'].forEach(f => {
    const k = 'shop_' + f + '_' + id, r = grow(k);
    shopKeys.push(k);
    notesOk.push(!!r && GS().note(r._row, 1) === txt('settings_note_shop_' + f, { n: myDigits(i + 1) }));
  }));
  const rules = GS().rules(), m = rules.length === 1 ? /REGEXMATCH\(\$A2,"([^"]+)"\)/.exec(rules[0].formula) : null, re = m ? new RegExp(m[1]) : null;
  check(!!grow('ai') && /^true$/i.test(String(grow('ai').Value)) && GS().note(grow('ai')._row, 1) === MSG.settings_note_ai && notesOk.length === 4 * CFG.SHOP_IDS.length && notesOk.every(Boolean) &&
    !!re && shopKeys.every(k => re.test(k)) && ['sale_flow', 'ai', 'shop_name_S9', 'shop_x_S1', 'pay_methods'].every(k => !re.test(k)) && rules[0].background === '#e3e7f7' &&
    /^A2:B\d+$/.test(rules[0].ranges[0]) && errs(G).length === 0,
    'setupSheet: the ai row TRUE with settings_note_ai; each shop of CFG.SHOP_IDS has its name, brand, address and phone rows noted (settings_note_shop_*, n = its number); ONE conditional-format rule over A:B colours exactly those keys #e3e7f7; no Errors row',
    { ai: grow('ai'), notesOk, rules });
  const ss = G.newExecution().SpreadsheetApp.getActiveSpreadsheet();
  const setCell = (tab, key, v) => { const r = G.sheet(tab).rows().find(o => String(o.Key) === key); ss.getSheetByName(tab).getRange(r._row, 2).setValue(v); };
  setCell('Settings', 'sale_flow', ' Steps ');
  setCell('Messages', 'settings_note_sale_flow', 'steps = တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက် ရောင်း');
  G.hand.deleteRow('Settings', grow('ai')._row);
  G.newExecution().setupSheet();
  const noteRow = G.sheet('Messages').rows().find(o => String(o.Key) === 'settings_note_sale_flow');
  check(String(grow('sale_flow').Value) === 'form' && String(noteRow.Text) === MSG.settings_note_sale_flow && GS().note(grow('sale_flow')._row, 1) === MSG.settings_note_sale_flow &&
    /^true$/i.test(String(grow('ai').Value)) && GS().rules().length === 1 && errs(G).length === 0,
    'a round-5 book (sale_flow steps, round 5\'s default note, no ai row): setupSheet rewrites steps to form and the note to round 6\'s, appends ai TRUE, and leaves ONE colour rule', { flow: grow('sale_flow'), note: noteRow, rules: GS().rules().length });
  setCell('Settings', 'sale_flow', 'quick');
  setCell('Settings', 'ai', 'FALSE');
  setCell('Messages', 'settings_note_sale_flow', 'ကျွန်မတို့ မှတ်ချက်');
  G.newExecution().setupSheet();
  check(String(grow('sale_flow').Value) === 'quick' && /^false$/i.test(String(grow('ai').Value)) && String(G.sheet('Messages').rows().find(o => String(o.Key) === 'settings_note_sale_flow').Text) === 'ကျွန်မတို့ မှတ်ချက်' &&
    GS().rules().length === 1 && errs(G).length === 0,
    'what the family typed is kept: sale_flow quick, ai FALSE and a retyped note stay as they are', { flow: grow('sale_flow'), ai: grow('ai') });
  check(saleFlow({ store: { getSetting: () => 'steps' } }) === 'form', 'a phone\'s older steps (pulled before the rewrite) still reads form');
  // Amendment F10b: a third id in CFG.SHOP_IDS gets its own shop rows from setupSheet (name, voucher number, letterhead), noted.
  const G3 = setupBook('S3'), S3s = G3.sheet('Settings'), k3 = ['shop_name_S3', 'order_next_no_S3', 'shop_brand_S3', 'shop_address_S3', 'shop_phone_S3'];
  const once3 = k3.map(k => S3s.rows().filter(o => String(o.Key) === k).length), row3 = f => S3s.rows().find(o => String(o.Key) === 'shop_' + f + '_S3');
  const note3 = ['name', 'brand', 'address', 'phone'].map(f => !!row3(f) && S3s.note(row3(f)._row, 1) === txt('settings_note_shop_' + f, { n: myDigits(3) }));
  check(once3.every(n => n === 1) && !!row3('name') && String(row3('name').Value) === 'S3' && note3.every(Boolean) && errs(G3).length === 0,
    'F10b: with a third id in CFG.SHOP_IDS, setupSheet appends that shop\'s name, voucher-number, brand, address and phone rows once each and notes its four Key cells (n = ၃)', { once3, note3 });
});

/* ============================== W41. review fixes on the core ============================== */

step('W41. Review fixes on the core: an item\'s own Rev in one batch, the job\'s Rev, shop text compared exactly, the views of the undo, quick\'s sold card, the method and the deposit question');
runStep(() => {
  const SX = syncSandbox();
  const own = { id: 'd-own', role: 'owner', staffId: '1000', status: 'active' }, sis = { id: 'd-sis', role: 'staff', staffId: '1001', status: 'active', shop: 'S1' };
  // (1) One phone's two entries of one piece in one batch (a new piece Saved and undone offline): both carry the Rev the
  // phone knew; the second meets the Rev the first just got, which is no conflict. A real change by another phone still is.
  const sw = SX.seedSimWorld(SX.createSimWorld()), srv = SX.createFakeServer(sw), sp = srv.ports;
  let bn = 0;
  const batch = (dev, list) => SX.syncApplyPush(sp, dev, { batchId: 'w41-' + (++bn), entries: list.map((x, i) => Object.assign({ kind: 'item', entryId: 'w41e-' + bn + '-' + i, id: 'S1-0003' }, x)) });
  const conflicts = () => sw.errors.filter(e => e.where === 'sync_conflict').length;
  const r0 = Number(sp.store.getItem('S1-0003').rev), c0 = conflicts();
  const b1 = batch(own, [{ fields: { name: 'ထမီ စိမ်း' }, baseRev: r0 }, { fields: { name: '', price: '' }, baseRev: r0 }]);
  const r1 = Number(sp.store.getItem('S1-0003').rev);
  check(b1.results.every(r => r.status === 'ok' && r.conflict === false) && b1.flags.length === 0 && b1.pings.length === 0 && conflicts() === c0 && sp.store.getItem('S1-0003').name === '',
    'two entries of one piece in one batch, both on the Rev the phone knew: the second meets the Rev the first just got and is no conflict (no flag, no ping, no Errors row); the piece ends as the second says',
    { results: b1.results, flags: b1.flags });
  const b2 = batch(own, [{ fields: { name: '', price: '' }, baseRev: r0 }, { fields: { category: 'ထမီ' }, baseRev: r0 }]);
  check(b2.results[0].status === 'dup' && b2.results[1].status === 'ok' && b2.results[1].conflict === false && b2.flags.length === 0 && conflicts() === c0,
    'the batch sent again after a lost answer: the first entry is dup, and the Rev it found is the base of the phone\'s next entry of the piece (no conflict)', b2.results);
  const rOther = Number(sp.store.getItem('S1-0003').rev);
  batch(sis, [{ fields: { price: 21000 }, baseRev: rOther }]);
  const b3 = batch(own, [{ fields: { price: 19000 }, baseRev: rOther }]);
  check(r1 > r0 && b3.results[0].status === 'ok' && b3.results[0].conflict === true && b3.flags.length === 1 && conflicts() === c0 + 1,
    'a change by another phone in between is still a conflict (flag, ping and Errors row): the rule only counts this batch\'s own Revs', b3.results);
  // (2) A photo or pic job raises the piece's Rev on the server: the answer says the Rev before and after, the cache does not.
  const items = { 'S1-0007': { id: 'S1-0007', rev: 4 } }, jobs = {};
  const jsp = { store: { getSetting: (k, d) => (k === 'ai' ? 'TRUE' : d), logError: () => null, getItem: id => items[id] || null },
    sync: { aiJob: (id, rec) => (rec === undefined ? (jobs[id] || null) : (jobs[id] = JSON.parse(JSON.stringify(rec)))) } };
  const hooks = { ai: j => { if (items[j.itemId]) items[j.itemId].rev += 5; return j.kind === 'photo' ? { desc: { name: 'n' }, photoUrl: 'drive://p' } : j.kind === 'pic' ? { photoUrl: 'drive://pic' } : { intent: {} }; } };
  const ask = (sp2, id, kind, itemId) => SX.syncHandle(sp2, 'ai', { device: 'd-own', token: 't', job: { id, kind, itemId } }, BASE, hooks);
  const realAuth = SX.syncAuthenticate;
  SX.syncAuthenticate = () => ({ ok: true, device: own });
  try {
    const pic = ask(jsp, 'w41-pic', 'pic', 'S1-0007').job, photo = ask(jsp, 'w41-photo', 'photo', 'S1-0007').job;
    const again = ask(jsp, 'w41-pic', 'pic', 'S1-0007'), voice = ask(jsp, 'w41-voice', 'voice', '').job;
    const bare = ask({ store: { getSetting: () => 'TRUE', logError: () => null }, sync: jsp.sync }, 'w41-bare', 'pic', 'S1-0007').job;
    check(pic.status === 'done' && pic.itemRev === 9 && pic.itemRevWas === 4 && photo.itemRev === 14 && photo.itemRevWas === 9 && !('itemRev' in jobs['w41-pic']) &&
      again.cached === true && !('itemRev' in again.job) && !('itemRev' in voice) && bare.status === 'done' && !('itemRev' in bare),
      'a pic or photo job answers the piece\'s Rev before (itemRevWas) and after (itemRev) its own write; the cached record and its cached answer carry neither; a voice job and a store without getItem answer without them',
      { pic, photo, again, voice, bare });
  } finally {
    SX.syncAuthenticate = realAuth;
  }
  // (3) A shop's text is compared exactly (a fix of capitals is written), an AI key without case; a setting's dup clears the hash.
  sp.store.setSetting = (k, v) => { sw.settings[k] = v; };
  const set = (key, value) => SX.syncApplyPush(sp, own, { batchId: 'w41-' + (++bn), entries: [{ kind: 'setting', entryId: 'w41s-' + bn, key, value }] }).results[0];
  const s1 = set('shop_address_S1', 'no. 12, bogyoke road, yangon'), s2 = set('shop_address_S1', 'No. 12, Bogyoke Road, Yangon'), s3 = set('shop_address_S1', 'No. 12, Bogyoke Road, Yangon');
  sw.settings.ai = 'true';
  const s4 = set('ai', 'TRUE');
  check(s1.status === 'ok' && s2.status === 'ok' && sw.settings.shop_address_S1 === 'No. 12, Bogyoke Road, Yangon' && s3.status === 'dup' && s4.status === 'dup',
    'a shop address that differs only in capitals is written (ok), the same text again is dup; a stored "true" still meets TRUE as dup', { s1, s2, s3, s4, stored: sw.settings.shop_address_S1 });
  const ackDup = () => {
    const l = { removed: [], cursor: { settingsHash: 'h1' } };
    l.removeEntry = id => l.removed.push(id); l.markSynced = () => null; l.removeRows = () => null; l.getCursor = () => l.cursor; l.setCursor = c => { l.cursor = c; };
    SX.syncApplyPushResults(l, [{ kind: 'setting', entryId: 'e1', key: 'shop_name_S1', value: 'x' }], [{ entryId: 'e1', kind: 'setting', status: 'dup' }], '', '');
    return [l.removed.length, l.cursor.settingsHash];
  };
  check(same(ackDup(), [1, '']), 'the phone\'s ack of a setting answered dup drops it and clears the settings hash, so the next pull brings the server\'s value whatever the phone holds', ackDup());

  // The app's views (13.9, F7): a recorder of the chat port; the view is the extra argument.
  const recorder = B => {
    const rec = [];
    ['sendMessage', 'sendPhoto', 'editMessage'].forEach(fn => {
      const orig = B.ports.chat[fn];
      B.ports.chat[fn] = function () { rec.push({ fn, args: Array.prototype.slice.call(arguments) }); return orig.apply(this, arguments); };
    });
    return rec;
  };
  const viewOfCall = c => { const at = c.fn === 'sendMessage' ? 3 : c.fn === 'sendPhoto' ? 4 : 5; return c.args.length > at ? c.args[at] : undefined; };
  const lastView = rec => viewOfCall(rec[rec.length - 1]);
  const u = U.sister;
  const undoFlows = (B, out) => {
    B.card(u, 'S1-0003', ['SC|S1-0003|ok']);
    const g1 = B.lastRow().groupId;
    B.answer(u, 'U|' + g1);
    out.one = { view: lastView(B.rec), text: B.rec[B.rec.length - 1].args[2] };
    B.card(u, ITEM, [Q('add'), 'SS|S1-0002|i|S1-0005', 'SC|S1-0002|ok']);
    const g2 = B.lastRow().groupId;
    B.answer(u, 'U|' + g2);
    out.basket = { view: lastView(B.rec), g: g2, n: B.rowsOf(g2).length };
    const rg = commitRestockGroup(B.ports, { lines: [{ item: B.ports.store.getItem('S1-0002'), qty: 5 }, { item: B.ports.store.getItem('S1-0003'), qty: 2 }], staff: B.ports.store.getStaff('1001'), source: 'BUTTON' });
    B.sim.start(u, '');
    B.answer(u, 'U|' + rg.groupId);
    out.restock = { view: lastView(B.rec), g: rg.groupId, n: B.rowsOf(rg.groupId).length };
    B.sim.start(u, '');
    B.answer(u, 'M|exp');
    B.tapData(u, B.flat(B.last(u)).filter(d => /^EC\|/.test(d))[0]);
    B.tapData(u, B.flat(B.last(u)).filter(d => /^EA\|/.test(d))[0]);
    B.tapData(u, B.flat(B.last(u)).filter(d => /^EM\|/.test(d))[0]);
    const g3 = B.lastRow().groupId;
    B.tapData(u, 'PM|' + g3 + '|KBZ');
    out.expMethod = { view: lastView(B.rec), g: g3 };
    B.answer(u, 'U|' + g3);
    out.exp = { view: lastView(B.rec), g: g3 };
    return out;
  };
  const A = bench();
  A.ports.ui = { openScreen: () => true };
  A.rec = recorder(A);
  const a = undoFlows(A, {});
  const card3 = cardText(A.ports, A.ports.store.getItem('S1-0003'));
  check(same(a.one.view, { view: { kind: 'item', id: 'S1-0003', extra: [MSG.undo_done] } }) && a.one.text === MSG.undo_done + '\n' + card3,
    'the undo of a one-piece sale in the app: the piece\'s item view with undo_done as its extra line (the text is the one of before)', a.one);
  check(a.restock.n === 4 && same(a.restock.view, { view: { kind: 'group', id: a.restock.g } }) && same(a.exp.view, { view: { kind: 'group', id: a.exp.g } }) &&
    a.basket.n === 4 && same(a.basket.view, { view: { kind: 'group', id: a.basket.g } }),
    'the undo of a restock of two lines, of an expense and of a basket of two lines in the app: the group view (drawn under ui_hist_undone)',
    { restock: a.restock, exp: a.exp.view, basket: a.basket });
  check(same(a.expMethod.view, { view: { kind: 'group', id: a.expMethod.g } }), 'a 🏦 tap under the expense reply keeps its group view in the app (the edit of the method)', a.expMethod.view);
  // The deposit question after a part-paid sale to a buyer who holds a deposit: the sold view, the question as its last line.
  A.card(u, 'S1-0004', ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0002', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|7', 'SC|S1-0004|ok']);
  const gq = A.lastRow().groupId, question = txt('credit_use_deposit', { customer: 'ဒေါ်ခင်', deposit: '300,000' }), qs = A.screen(u);
  check(same(lastView(A.rec), { view: { kind: 'sold', id: gq, extra: [question] } }) && same(qs.datas, [['CD|' + gq + '|yes|p', 'CD|' + gq + '|no|p']]) && qs.text.endsWith('\n' + question),
    'the deposit question in the app: the sold view with credit_use_deposit as its extra line, the two CD| buttons kept, the text as before', { view: lastView(A.rec), datas: qs.datas });
  // quick (the mode the app follows when the owner sets it): every sold card carries the sold view.
  const quickFlows = (B, out) => {
    B.scan(u, ITEM);
    B.answer(u, 'S|S1-0002|1');
    out.tap = { view: lastView(B.rec), g: B.lastRow().groupId };
    B.scan(u, ITEM);
    B.answer(u, 'QN|S1-0002');
    B.sim.text(u, '2');
    out.qty = { view: lastView(B.rec), g: B.lastRow().groupId, fn: B.rec[B.rec.length - 1].fn };
    B.scan(u, ITEM);
    B.answer(u, 'D|S1-0002');
    B.sim.text(u, '15000');
    out.price = { view: lastView(B.rec), g: B.lastRow().groupId, fn: B.rec[B.rec.length - 1].fn };
    B.scan(u, ITEM);
    B.sim.voice(u, 'ဒါ ၂ ထည် ရောင်းရတယ်');
    B.answer(u, 'btn_yes');
    out.voice = { view: lastView(B.rec), g: B.lastRow().groupId };
    B.tapData(u, 'PM|' + out.voice.g + '|KBZ');
    out.method = { view: lastView(B.rec), g: out.voice.g, method: methodOf(B.liveOf(out.voice.g)[0]) };
    // quick's corrective buttons on a paid sale: 💳 not fully paid (with and without a held deposit), 👤 the buyer.
    const sellOne = () => { B.scan(u, 'S1-0003'); B.answer(u, 'S|S1-0003|1'); return B.lastRow().groupId; };
    const gc = sellOne();
    ['CR|' + gc, 'CP|' + gc + '|0', 'CC|' + gc + '|C-0001'].forEach(d => B.tapData(u, d));
    out.credit = { view: lastView(B.rec), g: gc, owed: saleGroupInfo(B.ports, gc).owed };
    const gd = sellOne();
    ['CR|' + gd, 'CP|' + gd + '|0', 'CC|' + gd + '|C-0002'].forEach(d => B.tapData(u, d));
    out.depAsk = { view: lastView(B.rec), g: gd, datas: B.screen(u).datas };
    B.tapData(u, 'CD|' + gd + '|yes');
    out.depYes = { view: lastView(B.rec), g: gd, applied: B.rowsOf(gd).filter(r => r.type === 'DEPOSIT_APPLIED').length };
    const ga = sellOne();
    ['CU|' + ga, 'CUP|' + ga + '|C-0001'].forEach(d => B.tapData(u, d));
    out.attach = { view: lastView(B.rec), g: ga, customerId: saleGroupInfo(B.ports, ga).customerId };
    return out;
  };
  const QA = bench({ quick: true });
  QA.ports.ui = { openScreen: () => true };
  QA.rec = recorder(QA);
  const q = quickFlows(QA, {});
  const soldV = g => ({ view: { kind: 'sold', id: g, extra: [] } });
  check(same(q.tap.view, soldV(q.tap.g)) && same(q.qty.view, soldV(q.qty.g)) && q.qty.fn === 'sendMessage' && same(q.price.view, soldV(q.price.g)) && q.price.fn === 'sendMessage',
    'quick in the app: the one-tap sale, a typed count and a typed price each end on the sold card with the sold view', q);
  check(same(q.voice.view, soldV(q.voice.g)) && same(q.method.view, soldV(q.method.g)) && q.method.method === 'KBZ',
    'a spoken sale confirmed (✅) ends on the sold view, and a 🏦 tap on that card keeps it (the method is rewritten to KBZ)', { voice: q.voice.view, method: q.method });
  const depQ = txt('credit_use_deposit', { customer: 'ဒေါ်ခင်', deposit: '300,000' });
  check(same(q.credit.view, soldV(q.credit.g)) && q.credit.owed === 12000 && same(q.depAsk.view, { view: { kind: 'sold', id: q.depAsk.g, extra: [depQ] } }) &&
    same(q.depAsk.datas, [['CD|' + q.depAsk.g + '|yes', 'CD|' + q.depAsk.g + '|no']]) && same(q.depYes.view, soldV(q.depYes.g)) && q.depYes.applied === 1 &&
    same(q.attach.view, soldV(q.attach.g)) && q.attach.customerId === 'C-0001',
    'quick in the app, the corrective buttons: 💳 not fully paid ends on the sold view (its deposit question with the question as the extra line, then စရံ သုံးမယ် on the sold view) and 👤 the buyer too',
    { credit: q.credit, depAsk: q.depAsk, depYes: q.depYes, attach: q.attach });
  // Telegram: the same taps, no extra argument on any chat call, and the same undo text.
  const T = bench(), TQ = bench({ quick: true });
  T.rec = recorder(T);
  TQ.rec = recorder(TQ);
  const t1 = undoFlows(T, {});
  T.card(u, 'S1-0004', ['SS|S1-0004|o|buyer', 'SS|S1-0004|b|C-0002', 'SS|S1-0004|o|paid', 'SS|S1-0004|p|half', 'SS|S1-0004|d|7', 'SC|S1-0004|ok']);
  quickFlows(TQ, {});
  const all = T.rec.concat(TQ.rec);
  check(all.length > 20 && all.every(c => viewOfCall(c) === undefined) && t1.one.text === a.one.text,
    'without ports.ui (Telegram) none of these chat calls carries an extra argument, and the undo reads as before', all.filter(c => viewOfCall(c) !== undefined).map(c => c.fn));
});

/* ============================== W42. cross-step fixes on the core ============================== */

step('W42. Cross-step fixes on the core: a sale a later payment was taken against is neither undone nor voided (rewrite_locked); a basket\'s undo and void carry the group view');
runStep(() => {
  const u = U.sister, o = U.owner;
  // The part-paid basket of W27: 83,000, KBZ 10,000 of 50,000 now (the split's PAYMENT row is the sale's own), ဒေါ်မြင့်, 14 days.
  const sell = B => {
    B.card(u, ITEM, [Q('l|S1-0002'), Q('q|2'), Q('add'), 'SS|S1-0002|i|S1-0005', Q('add'), 'SS|S1-0002|i|S1-0001', Q('o|method'), Q('m|mix'), Q('a|KBZ'), { type: '10000' },
      Q('o|paid'), Q('p|other'), { type: '50000' }, { type: 'ဒေါ်မြင့်' }, Q('d|14'), 'SC|S1-0002|ok']);
    return B.lastRow().groupId;
  };
  const stocks = B => ['S1-0002', 'S1-0005', 'S1-0001'].map(id => B.ports.store.getItem(id).stock);
  const owner = B => B.ports.store.getStaff(String(o.id)), seller = B => B.ports.store.getStaff(String(u.id));
  // (1) A payment taken later (💵 ငွေရ: PY|g, then 10,000 of the 33,000 owed): its row is another group's, RefGroupID = the sale.
  const A = bench();
  const g = sell(A);
  A.answer(u, 'PY|' + g);
  A.answer(u, 'PA|' + g + '|10000');
  const pay = A.lastRow(), n0 = A.ledgerLen(), st0 = stocks(A), owed0 = saleGroupInfo(A.ports, g).owed;
  A.answer(u, 'U|' + g);
  const uText = A.screen(u).text;
  A.sim.start(o, '');
  A.answer(o, 'V|' + g);
  const vText = A.screen(o).text;
  check(pay.type === CFG.TX.PAYMENT && pay.refGroupId === g && pay.groupId !== g && owed0 === 23000 && uText === MSG.rewrite_locked && vText === MSG.rewrite_locked &&
    A.ledgerLen() === n0 && A.liveOf(g).length === 4 && same(stocks(A), st0) && saleGroupInfo(A.ports, g).owed === 23000 && A.errorsOf('handleUpdate').length === 0,
    'a basket part-paid, then a payment taken later (another group, RefGroupID = the sale): the seller\'s U|g and the owner\'s V|g both answer rewrite_locked and write nothing (no row; the stock and the 23,000 still owed kept)',
    { pay: [pay.type, pay.refGroupId === g, pay.groupId !== g], owed0, uText, vText, added: A.ledgerLen() - n0, live: A.liveOf(g).length, stocks: stocks(A) });
  const du = undoGroup(A.ports, g, seller(A)), dv = voidGroup(A.ports, g, owner(A));
  check(du.ok === false && du.reason === 'locked' && dv.ok === false && dv.reason === 'locked' && A.ledgerLen() === n0,
    'undoGroup and voidGroup themselves answer {ok: false, reason: locked} on that sale (the owner\'s force does not pass it) and write nothing', { du, dv, added: A.ledgerLen() - n0 });
  // (2) The owner voids that payment first: the sale is no longer locked, and its undo mirrors every row of the basket.
  A.sim.start(o, '');
  A.answer(o, 'V|' + pay.groupId);
  const pv = A.screen(o).text;
  A.answer(u, 'U|' + g);
  check(pv.indexOf(MSG.void_done) === 0 && A.liveOf(pay.groupId).length === 0 && A.screen(u).text.indexOf(MSG.undo_done) === 0 && A.liveOf(g).length === 0 && same(stocks(A), [5, 2, 1]),
    'once the owner voids that payment (V| on the payment\'s own group, not locked), the sale\'s U|g mirrors its four rows and the stock comes back', { pv: pv.split('\n')[0], u: A.screen(u).text.split('\n')[0], live: A.liveOf(g).length });
  // (3) Without a later payment (only the split's own PAYMENT row) both still work.
  const B = bench();
  const gb = sell(B);
  B.answer(u, 'U|' + gb);
  const C = bench();
  const gc = sell(C);
  C.tick(120);
  C.sim.start(o, '');
  C.answer(o, 'V|' + gc);
  check(B.screen(u).text.indexOf(MSG.undo_done) === 0 && B.liveOf(gb).length === 0 && B.rowsOf(gb).length === 8 &&
    C.screen(o).text.indexOf(MSG.void_done) === 0 && C.liveOf(gc).length === 0 && C.rowsOf(gc).filter(r => r.note === 'void by owner').length === 4,
    'without a later payment (the split\'s PAYMENT row is the sale\'s own) the seller\'s U|g and the owner\'s V|g two hours later still mirror the basket\'s four rows',
    { undo: B.screen(u).text.split('\n')[0], void: C.screen(o).text.split('\n')[0], b: B.liveOf(gb).length, c: C.liveOf(gc).length });
  // (4) The app's view of a basket's undo and void reply (13.9): the group view (drawn under ui_hist_undone), no longer the plain text.
  const rec = Bx => {
    const r = [];
    const orig = Bx.ports.chat.editMessage;
    Bx.ports.chat.editMessage = function () { r.push(Array.prototype.slice.call(arguments)); return orig.apply(this, arguments); };
    return r;
  };
  const D = bench();
  D.ports.ui = { openScreen: () => true };
  const dr = rec(D);
  const gd = sell(D);
  D.answer(u, 'U|' + gd);
  const dView = dr[dr.length - 1][5];
  const E = bench();
  E.ports.ui = { openScreen: () => true };
  const er = rec(E);
  const ge = sell(E);
  E.sim.start(o, '');
  E.answer(o, 'V|' + ge);
  const eView = er[er.length - 1][5];
  check(same(dView, { view: { kind: 'group', id: gd } }) && same(eView, { view: { kind: 'group', id: ge } }) && D.liveOf(gd).length === 0 && E.liveOf(ge).length === 0 &&
    same(undoReplyView(D.ports, gd, { types: ['SALE', 'SALE', 'SALE', 'PAYMENT'] }, [MSG.undo_done]), { kind: 'group', id: gd }),
    'in the app the undo and the owner\'s void of a basket of three lines carry the group view of the basket (kind group, its group id), not null', { dView, eView });
});

/* ============================== W43-W46. round 6b ============================== */

step('W43. The sample sign (round 6b, G1): 🎨 on the toggle, on a sample\'s card and on its item rows; the reports keep text');
runStep(() => {
  const u = U.sister, PH = SIM_PHOTOS[0];
  check(MSG.btn_sample_on.indexOf('🎨 ') === 0 && MSG.btn_sample_off.indexOf('🎨 ') === 0 && CFG.SAMPLE_EMOJI !== CFG.CATEGORY_EMOJI['အခြား'],
    'btn_sample_on and btn_sample_off start with 🎨, and the sample sign is not the အခြား category\'s emoji', [MSG.btn_sample_on, MSG.btn_sample_off]);
  const A = bench();
  A.scan(u, 'S1-0007');
  A.sim.photo(u, PH);
  const toggleText = s => { let x = ''; s.datas.forEach((r, i) => r.forEach((d, j) => { if (d === 'PS|S1-0007') x = s.texts[i][j]; })); return x; };
  const off = toggleText(A.screen(u));
  A.tapData(u, 'PS|S1-0007');
  const sOn = A.screen(u), on = toggleText(sOn);
  const allTexts = sOn.texts.reduce((a, r) => a.concat(r), []);
  check(off === MSG.btn_sample_off && on === MSG.btn_sample_on && A.state(u).draft.sample === true && allTexts.every(x => x.indexOf('🧵 ') !== 0),
    'form mode: the new-piece card\'s PS|S1-0007 reads btn_sample_off, after the tap btn_sample_on; no button of the card starts with 🧵', { off, on, allTexts });
  const Qk = bench({ quick: true });
  Qk.scan(u, 'S1-0007');
  Qk.sim.photo(u, PH);
  check(Qk.state(u).step === 'price' && toggleText(Qk.screen(u)) === MSG.btn_sample_off, 'quick: priceScreen\'s toggle reads btn_sample_off', Qk.screen(u).texts);
  // A sample of category အခြား and a non-sample အခြား piece of the same name stem.
  const B = bench(), bs = B.ports.store.getStaff('1001');
  const smp = commitNewItem(B.ports, { itemId: 'S1-0008', name: 'ဒီဇိုင်းသစ် နီ', category: 'အခြား', price: 25000, count: 1, sample: true, staff: bs });
  const oth = commitNewItem(B.ports, { itemId: 'S1-0009', name: 'ဒီဇိုင်းသစ် ပြာ', category: 'အခြား', price: 25000, count: 1, sample: false, staff: bs });
  const cs = cardText(B.ports, smp.item), co = cardText(B.ports, oth.item);
  check(smp.ok && oth.ok && cs.indexOf('🎨 S1-0008') === 0 && cs.indexOf(MSG.sample_mark) >= 0 && co.indexOf('🧵 S1-0009') === 0 && co.indexOf(MSG.sample_mark) < 0,
    'cardText: the sample (category အခြား) leads with 🎨 and keeps sample_mark; the non-sample အခြား piece leads with 🧵', [cs.split('\n')[0], co.split('\n')[0]]);
  B.sim.start(u, '');
  B.tapData(u, 'M|find');
  B.sim.text(u, 'ဒီဇိုင်းသစ်');
  const fs1 = B.screen(u), rowOf = (s, data) => { let x = ''; s.datas.forEach((r, i) => r.forEach((d, j) => { if (d === data) x = s.texts[i][j]; })); return x; };
  check(rowOf(fs1, 'K|S1-0008').indexOf('🎨 ') === 0 && rowOf(fs1, 'K|S1-0009').indexOf('🧵 ') === 0, 'M|find (showChoices): the sample\'s row starts with 🎨, the other\'s with 🧵', fs1.texts);
  const line = basketCardLine(B.ports, { id: 'S1-0008', qty: 1, unitPrice: 25000 }, 0);
  check(line.indexOf('🎨') >= 0 && line.indexOf('🧵') < 0, 'the review card\'s line of the sample (basketCardLine) holds 🎨', line);
  presentNotebookLine(u.id, String(u.id), { raw: 'ဒီဇိုင်းသစ် ၁ ထည်', item_hint: 'ဒီဇိုင်းသစ်', qty: 1 }, 1, bs, 'w43-nb', B.ports);
  const nb = B.screen(u), nbS = nb.datas.map((r, i) => (/^NB\|.*\|S1-0008$/.test(r[0]) ? nb.texts[i][0] : null)).filter(Boolean), nbO = nb.datas.map((r, i) => (/^NB\|.*\|S1-0009$/.test(r[0]) ? nb.texts[i][0] : null)).filter(Boolean);
  check(nbS.length === 1 && nbS[0].indexOf('🎨 ') === 0 && nbO.length === 1 && nbO[0].indexOf('🧵 ') === 0, 'presentNotebookLine (a line matching both equally): the NB| rows, the sample\'s starting with 🎨 and the other\'s with 🧵', nb.texts);
  B.card(u, ITEM, []);
  const add = saleScreenAdd(B.ports, bs, B.ports.store.getItem(ITEM), B.state(u), { found: [B.ports.store.getItem('S1-0008')] });
  const addRow = add.kb.filter(r => /\|i\|S1-0008$/.test(r[0].callback_data))[0];
  check(!!addRow && addRow[0].text.indexOf('🎨 ') === 0, 'saleScreenAdd with the sample among the found pieces: its row starts with 🎨', add.kb.map(r => r[0].text));
  const rep = stockReport(B.ports, ['S1'], B.ports.clock.now()), srow = rep.sections[0].rows.filter(r => r[0] === 'S1-0008')[0];
  check(!!srow && String(srow[1]).endsWith(MSG.sample_mark) && srow[2] === 'အခြား' && rep.sections[0].rows.every(r => r.every(c => String(c).indexOf('🎨') < 0)),
    'the stock report: the sample\'s name cell ends with sample_mark, its category cell is အခြား, no cell holds 🎨', srow);
  // The step-1 checker's addition (1.3, gas_setup.js on poc/fake_gas.js): the live Sheet's round-3 toggle texts become the 🎨 ones.
  const G = setupBook(), GM = () => G.sheet('Messages'), mrow = k => GM().rows().find(o => String(o.Key) === k);
  const gErrs = () => (G.sheet('Errors') ? G.sheet('Errors').rows() : []);
  const gss = G.newExecution().SpreadsheetApp.getActiveSpreadsheet();
  const setMsg = (k, v) => gss.getSheetByName('Messages').getRange(mrow(k)._row, 2).setValue(v);
  setMsg('btn_sample_on', '🧵 နမူနာ: ဟုတ်');
  setMsg('btn_sample_off', 'ကျွန်မတို့ ခလုတ် စာ');
  G.newExecution().setupSheet();
  const onAfter = String(mrow('btn_sample_on').Text), offAfter = String(mrow('btn_sample_off').Text);
  const from2 = G.log.length;
  G.newExecution().setupSheet();
  const msgWrites2 = G.calls(from2, c => c.sheet === 'Messages' && c.write === 'value').length;
  check(onAfter === MSG.btn_sample_on && offAfter === 'ကျွန်မတို့ ခလုတ် စာ' && msgWrites2 === 0 && gErrs().length === 0,
    'setupSheet: a Messages btn_sample_on still holding round 3\'s exact 🧵 text is rewritten to the 🎨 one, a btn_sample_off the family typed is kept; a second run writes nothing there; no Errors row',
    { onAfter, offAfter, msgWrites2, errors: gErrs().length });
  setMsg('btn_sample_off', '🧵 နမူနာ: မဟုတ်');
  G.failNext(c => c.sheet === 'Messages' && c.call === 'Range.setValue', 'Service error (checker)');
  let thrown = null;
  try { G.newExecution().setupSheet(); } catch (e) { thrown = e; }
  check(!thrown && gErrs().some(r => String(r.Where) === 'setup' && String(r.Message).indexOf('Messages sample texts: ') === 0) && G.faultsLeft === 0,
    'a failing rewrite is logged (setup, "Messages sample texts: …") and never thrown: the rest of setupSheet runs', { thrown: thrown && thrown.message, errors: gErrs().map(r => r.Message) });
});

step('W44. Item categories in Telegram (round 6b, G2): the card\'s 🏷 by key, ➕ on it, a photo during the prompt, the AI\'s list, a tag on a voucher line');
runStep(() => {
  const u = U.sister, PH = SIM_PHOTOS[0], SILK = 'ပိုးအင်္ကျီ', id = 'S1-0007';
  const NI = s => 'NI|' + id + '|' + s, BACK = [[NI('back')]];
  const A = bench();
  A.scan(u, id);
  A.sim.photo(u, PH);
  A.tapData(u, NI('c'));
  let s = A.screen(u);
  const catId = s.id;
  check(s.text === MSG.item_ask_cat && same(s.datas, CFG.ITEM_CATEGORY_KEYS.map(k => [NI('c|' + k)]).concat([['LA|ic|NIC|' + id], [NI('back')]])) &&
    CFG.CATEGORIES.every((c, i) => s.texts[i][0] === CFG.CATEGORY_EMOJI[c] + ' ' + c) && s.texts[5][0] === MSG.btn_add_cat,
    '🏷 → item_ask_cat: one row per built-in key (NI|id|c|<key>, its emoji), then ➕ LA|ic|NIC|id, then ⏮', { datas: s.datas, texts: s.texts });
  A.tapData(u, NI('c|longyi'));
  const pickLongyi = A.state(u).draft.category;
  A.tapData(u, NI('c'));
  A.tapData(u, NI('c|htamein'));
  const pickHt = A.state(u).draft.category;
  A.tapData(u, NI('c'));
  A.tapData(u, NI('c|1'));
  check(pickLongyi === 'လုံချည်' && pickHt === 'ထမီ' && A.state(u).step === 'card' && A.state(u).draft.category === 'လုံချည်',
    'c|longyi → လုံချည်; c|htamein → ထမီ; the legacy c|1 of a card drawn before round 6b → လုံချည်', [pickLongyi, pickHt, A.state(u).draft.category]);
  A.tapData(u, NI('c'));
  const cat2 = A.screen(u).id;
  A.tapData(u, 'LA|ic|NIC|' + id);
  s = A.screen(u);
  let st = A.state(u);
  check(s.id === cat2 && s.text === MSG.add_ask_ic && same(s.datas, BACK) && st.kind === 'await_text' && st.purpose === 'add_option' && st.list === 'item_category' && st.saved && st.saved.kind === 'new_item',
    '➕ → the same message reads add_ask_ic with ONLY [⏮ NI|id|back]; the state is await_text / add_option / item_category with the card in saved', { text: s.text, datas: s.datas, st });
  A.tapData(u, NI('back'));
  check(A.screen(u).id === cat2 && A.state(u).kind === 'new_item' && A.state(u).step === 'card' && A.screen(u).text.indexOf(txt('photo_seen', { name: PH.name, category: 'လုံချည်' })) === 0,
    '⏮ from the prompt → the card in place, the state new_item at card', A.state(u));
  A.tapData(u, NI('c'));
  A.tapData(u, 'LA|ic|NIC|' + id);
  const n0 = A.world.lists.length;
  A.sim.text(u, '12');
  s = A.screen(u);
  check(s.text === MSG.add_ask_ic && same(s.datas, BACK) && A.state(u).kind === 'await_text' && A.state(u).list === 'item_category',
    'typed 12 → add_ask_ic again with ⏮ (no ✖️ Z), the state kept', { text: s.text, datas: s.datas });
  A.sim.text(u, 'နမူနာ');
  s = A.screen(u);
  check(s.text === MSG.add_ic_sample + '\n' + MSG.add_ask_ic && same(s.datas, BACK) && A.state(u).kind === 'await_text', 'typed နမူနာ → add_ic_sample on top of add_ask_ic, the state kept', s.text);
  A.option('item_category', 'wutsone').active = false;
  A.sim.text(u, 'ဝတ်စုံ');
  s = A.screen(u);
  check(s.text === txt('add_ic_closed', { label: 'ဝတ်စုံ' }) + '\n' + MSG.add_ask_ic && same(s.datas, BACK) && A.state(u).kind === 'await_text' && A.world.lists.length === n0,
    'the ဝတ်စုံ row unticked, typed ဝတ်စုံ → add_ic_closed (ဝတ်စုံ) on top of add_ask_ic with ⏮, the state kept, no row written', s.text);
  A.option('item_category', 'wutsone').active = true;
  A.tapData(u, NI('back'));

  // B2: a photo while the prompt waits is the card's, never the last scanned item's.
  const C = bench();
  C.scan(u, 'S1-0002');
  const photo2Before = C.ports.store.getItem('S1-0002').photoUrl;
  C.scan(u, id);
  C.sim.photo(u, PH);
  const firstCard = C.screen(u).id;
  C.tapData(u, NI('c'));
  C.tapData(u, 'LA|ic|NIC|' + id);
  const promptId = C.screen(u).id;
  C.sim.photo(u, SIM_PHOTOS[1]);
  s = C.screen(u);
  const fid = C.world.chats[u.id].filter(m => m.from === 'user' && m.photo).slice(-1)[0].photo;
  check(s.id !== promptId && C.state(u).kind === 'new_item' && C.state(u).step === 'card' && C.state(u).draft.photoFileId === fid && C.ports.store.getItem('S1-0002').photoUrl === photo2Before &&
    s.text.indexOf(txt('photo_seen', { name: PH.name, category: 'ထမီ' })) === 0,
    'B2: S1-0002 scanned first, a photo sent while the ➕ prompt waits → the card comes back as a new message with that photo in its draft, the state new_item at card; S1-0002\'s photo unchanged',
    { st: C.state(u), fid, s2: C.ports.store.getItem('S1-0002').photoUrl });
  C.tapData(u, NI('c'));
  C.tapData(u, 'LA|ic|NIC|' + id);
  C.sim.tap(u, firstCard, 'PS|' + id);
  check(C.state(u).kind === 'new_item' && C.state(u).draft.sample === true && C.bots(u).every(m => m.text !== MSG.expired),
    'B2: ➕ again, then PS|id tapped on the older card message → the card\'s sample flips (no expired)', C.state(u));
  C.tapData(u, 'PS|' + id);
  C.tapData(u, NI('c'));
  C.tapData(u, 'LA|ic|NIC|' + id);
  const nC = C.world.lists.length, lC = C.ledgerLen();
  C.sim.text(u, SILK);
  s = C.screen(u);
  const lines = s.text.split('\n'), icC = C.world.lists.filter(r => r.list === 'item_category'), silkRow = icC[icC.length - 1];
  check(lines[0] === txt('add_done', { label: SILK }) && lines[1] === txt('photo_seen', { name: PH.name, category: SILK }) && C.state(u).draft.category === SILK &&
    same(s.datas[0], pricePresets(C.ports, SILK, 'S1').map(p => 'P|' + id + '|' + p)) && same(pricePresets(C.ports, SILK, 'S1'), CFG.DEFAULT_PRICE_PRESETS.slice(0, 4)),
    'typed ' + SILK + ' → a NEW message: add_done with that label, photo_seen naming it, the default price chips', { lines, chips: s.datas[0] });
  check(C.world.lists.length === nC + 1 && icC.length === 6 && same(icC.slice(0, 5).map(r => r.key), CFG.ITEM_CATEGORY_KEYS) && silkRow.label === SILK && C.ledgerLen() === lC,
    'the world\'s Lists hold the five then the new row, written at the name (before ✅; no ledger row yet)', icC.map(r => r.key));
  C.tapData(u, 'P|' + id + '|25000');
  C.tapData(u, 'NC|' + id + '|ok');
  const reg = C.ports.store.getItem(id);
  check(reg.status === 'ACTIVE' && reg.category === SILK && C.screen(u).text.indexOf('🔖 ' + id) === 0, '✅ → the item\'s category is ' + SILK + ' and its card starts with 🔖', { cat: reg.category, card: C.screen(u).text.split('\n')[0] });
  C.scan(u, 'S1-0008');
  C.sim.photo(u, PH);
  C.tapData(u, 'NI|S1-0008|c');
  const keys8 = C.screen(u).datas.map(r => r[0]);
  check(keys8.indexOf('NI|S1-0008|c|' + silkRow.key) === 4 && keys8[5] === 'NI|S1-0008|c|other', 'a second blank tag\'s 🏷 screen lists the new key before other', keys8);
  C.tapData(u, 'LA|ic|NIC|S1-0008');
  const n8 = C.world.lists.length;
  C.sim.text(u, 'ထမီ');
  check(C.screen(u).text.split('\n')[0] === txt('add_exists', { label: 'ထမီ' }) && C.world.lists.length === n8 && C.state(u).draft.category === 'ထမီ', 'typed ထမီ after ➕ → add_exists, no new row, the card takes ထမီ', C.screen(u).text.split('\n')[0]);

  // Rows 6-7 and B7: the AI is given the shop's list.
  C.world.lists.push({ list: 'item_category', key: 'mdy1', label: 'မန္တလေး ထည်', active: true, order: 9, shop: 'S2', detail: '', note: '' });
  let photoCtx = null, nbCtx = null;
  const realDescribe = C.ports.ai.describePhoto, realNb = C.ports.ai.readNotebook;
  C.ports.ai.describePhoto = function (file, ctx) { photoCtx = ctx; return realDescribe.call(this, file, ctx); };
  C.ports.ai.readNotebook = function (file, ctx) { nbCtx = ctx; return realNb.call(this, file, ctx); };
  C.scan(u, 'S1-0009');
  C.sim.photo(u, { key: 'silk', name: 'ပိုးထည် အင်္ကျီ အပြာ', category: SILK, visual: { emoji: '👚', bg: '#1565c0' } });
  check(!!photoCtx && photoCtx.categories.indexOf(SILK) >= 0 && photoCtx.categories[photoCtx.categories.length - 1] === 'အခြား' && C.screen(u).text.indexOf(txt('photo_seen', { name: 'ပိုးထည် အင်္ကျီ အပြာ', category: SILK })) === 0,
    'row 6: a third blank tag\'s photo whose AI answer names ' + SILK + ': describePhoto\'s ctx.categories holds it and ends with အခြား; the card\'s photo_seen names it', photoCtx);
  check(photoCtx.categories.indexOf('မန္တလေး ထည်') < 0, 'B7: a row with Shop S2 is not in the list given for an S1 tag\'s photo', photoCtx.categories);
  C.tapData(u, 'NI|S1-0009|c');
  check(C.screen(u).flat.indexOf('NI|S1-0009|c|mdy1') < 0 && C.screen(u).flat.indexOf('NI|S1-0009|c|' + silkRow.key) >= 0, 'B7: … nor on that S1 tag\'s 🏷 screen', C.screen(u).flat);
  const aiCtx = buildAiContext(C.ports, C.ports.store.getStaff('1001'), String(u.id));
  C.sim.start(u, '');
  C.tapData(u, 'M|nb');
  C.sim.photo(u, { key: 'nbpage', name: '', visual: { emoji: '📒', bg: '#fff' }, lines: [] });
  check(aiCtx.categories.indexOf(SILK) >= 0 && aiCtx.categories.indexOf('မန္တလေး ထည်') < 0 && !!nbCtx && nbCtx.categories.indexOf(SILK) >= 0 && nbCtx.categories.indexOf('မန္တလေး ထည်') < 0,
    'row 7: buildAiContext\'s categories and the notebook photo\'s ctx hold ' + SILK + ' (not the S2 row)', { ai: aiCtx.categories, nb: nbCtx && nbCtx.categories });

  // Row 14: a tag attached to a voucher line takes the design's category by the list.
  const D = bench(), own = D.ports.store.getStaff('1000');
  D.world.designs.filter(d => d.code === 'TSL-0018')[0].category = SILK;
  addItemCategory(D.ports, SILK, own, 'S1');
  const o1 = createOrder(D.ports, { shop: 'S1', customerId: 'C-0001', staff: own });
  addOrderLine(D.ports, o1.id, { designCode: 'TSL-0018', qty: 1, unitPrice: 150000 });
  D.sim.start(u, '');
  D.tapData(u, 'OT|' + o1.id);
  D.scan(u, 'S1-0010');
  const t1 = D.ports.store.getItem('S1-0010');
  D.option('item_category', 'htamein').label = 'ထမိန်';
  D.world.designs.filter(d => d.code === 'TSL-0025')[0].category = 'ထမီ';
  const o2 = createOrder(D.ports, { shop: 'S1', customerId: 'C-0002', staff: own });
  addOrderLine(D.ports, o2.id, { designCode: 'TSL-0025', qty: 1, unitPrice: 50000 });
  D.tapData(u, 'OT|' + o2.id);
  D.scan(u, 'S1-0011');
  const t2 = D.ports.store.getItem('S1-0011');
  check(t1.alias === o1.id + '-1' && t1.category === SILK && t2.alias === o2.id + '-1' && t2.category === 'ထမိန်',
    'row 14: 🏷 Tag တပ် and a blank tag: the design\'s category ' + SILK + ' is kept; a design of ထမီ after the htamein row is relabelled ထမိန် gives ထမိန်', [t1.category, t2.category, t1.alias, t2.alias]);

  // A store without addListOption, quick, the bytes, a long hand-typed key.
  const E = bench();
  E.scan(u, id);
  E.sim.photo(u, PH);
  E.tapData(u, NI('c'));
  const eCat = E.screen(u), eBots = E.bots(u).length, realAdd = E.ports.store.addListOption;
  delete E.ports.store.addListOption;
  E.tapData(u, 'LA|ic|NIC|' + id);
  check(E.bots(u).length === eBots + 1 && E.screen(u).text === MSG.add_unavailable && E.world.chats[u.id].filter(m => m.id === eCat.id)[0].text === MSG.item_ask_cat && E.state(u).kind === 'new_item',
    'a store without addListOption: ➕ → add_unavailable as a new message, the card (its 🏷 screen) kept', E.screen(u).text);
  E.ports.store.addListOption = realAdd;
  const eBots2 = E.bots(u).length;
  E.tapData(u, 'LA|pm|NIC|' + id);
  check(E.bots(u).length === eBots2 + 1 && E.screen(u).text === MSG.expired && E.state(u).kind === 'new_item' && E.state(u).step === 'cat',
    'the ➕ of the card carries its own list (ADD_RESUME_LIST.NIC = item_category): LA|pm|NIC|id answers expired as a new message, the card kept', E.screen(u).text);
  const Qk = bench({ quick: true });
  Qk.scan(u, id);
  Qk.sim.photo(u, PH);
  check(Qk.bots(u).every(m => (m.keyboard || []).every(r => r.every(x => !/^NI\|/.test(x.callback_data) && !/^LA\|ic\|/.test(x.callback_data)))), 'under quick no NI| button (and no ➕ of a category)');
  check(bytes('LA|ic|NIC|S1-0007') === 17 && bytes('NI|S1-0007|c|htamein') === 20, 'the bytes: LA|ic|NIC|S1-0007 is 17, NI|S1-0007|c|htamein 20');
  const F = bench();
  F.world.lists.push({ list: 'item_category', key: 'abcdefghijklm', label: 'ရှည်', active: true, order: 7, shop: '', detail: '', note: '' });
  Object.keys(PAY_METHOD_WARNED).forEach(k => delete PAY_METHOD_WARNED[k]);
  F.scan(u, id);
  F.sim.photo(u, PH);
  F.tapData(u, NI('c'));
  const fl1 = F.screen(u).flat;
  F.tapData(u, NI('back'));
  F.tapData(u, NI('c'));
  const longLogs = F.errorsOf('lists').filter(e => e.message.indexOf('abcdefghijklm') >= 0);
  check(bytes('abcdefghijklm') === 13 && fl1.every(d => d.indexOf('abcdefghijklm') < 0) && F.screen(u).flat.every(d => d.indexOf('abcdefghijklm') < 0) && longLogs.length === 1,
    'a hand-typed key of 13 bytes is left out of the 🏷 screen and logged once (two screens, one Errors row)', { fl1, logs: longLogs.length });

  // The step-1 checker's additions: the card's other readers during the prompt, rule (c), no card, unavailable at the name,
  // the piece's shop (not the staff's), a 12-byte key, the catch-all of a design with no list name.
  const msgText = (W, mid) => (W.world.chats[u.id].filter(m => m.id === mid)[0] || {}).text;
  const H = bench();
  H.scan(u, id);
  H.sim.photo(u, PH);
  const hCard = H.screen(u).id;
  H.tapData(u, NI('c'));
  H.tapData(u, 'LA|ic|NIC|' + id);
  H.sim.tap(u, hCard, 'P|' + id + '|30000');
  const hPrice = H.state(u);
  H.tapData(u, NI('c'));
  H.tapData(u, 'LA|ic|NIC|' + id);
  H.sim.tap(u, hCard, 'C|' + id + '|other');
  const hCost = H.state(u);
  check(!!hPrice && hPrice.kind === 'new_item' && hPrice.draft.price === 30000 && !!hCost && hCost.kind === 'new_item' && hCost.step === 'cost' && H.bots(u).every(m => m.text !== MSG.expired),
    'B2: a price (P|) and 🪙 (C|) tapped on the older card message while the ➕ prompt waits act on the card (newItemPrice, newItemCost; no expired)', { hPrice, hCost });
  const K = bench();
  K.scan(u, id);
  K.sim.photo(u, PH);
  K.tapData(u, NI('c'));
  const kCat = K.screen(u).id;
  K.sim.photo(u, SIM_PHOTOS[1]);
  const kBefore = msgText(K, kCat), kBots = K.bots(u).length;
  K.sim.tap(u, kCat, 'LA|ic|NIC|' + id);
  check(msgText(K, kCat) === kBefore && kBefore === MSG.item_ask_cat && K.bots(u).length === kBots && K.state(u).kind === 'new_item' && K.state(u).step === 'card',
    'rule (c): ➕ on an older 🏷 screen after the card came back (step card) is ignored: no edit, no prompt, the card\'s state kept', { text: msgText(K, kCat), st: K.state(u) });
  K.tapData(u, 'Z');
  K.sim.tap(u, kCat, 'LA|ic|NIC|' + id);
  check(msgText(K, kCat) === MSG.expired && K.state(u) === null, 'with no card (✖️ tapped): ➕ on the old 🏷 screen reads expired, no prompt', msgText(K, kCat));
  const V = bench();
  V.scan(u, id);
  V.sim.photo(u, PH);
  V.tapData(u, NI('c'));
  V.tapData(u, 'LA|ic|NIC|' + id);
  const vReal = V.ports.store.addListOption, vBots = V.bots(u).length, vRows = V.world.lists.length;
  delete V.ports.store.addListOption;
  V.sim.text(u, SILK);
  V.ports.store.addListOption = vReal;
  const vs = V.screen(u);
  check(V.bots(u).length === vBots + 1 && vs.text.split('\n')[0] === MSG.add_unavailable && vs.datas.some(r => r.indexOf('NC|' + id + '|ok') >= 0) && V.state(u).kind === 'new_item' && V.world.lists.length === vRows,
    'unavailable at the name (the store lost addListOption after the prompt): the card comes back as ONE new message with add_unavailable on top, its state restored, no row', { first: vs.text.split('\n')[0], st: V.state(u).kind });
  const O = bench(), ow = U.owner, MDY = 'မန္တလေး ထည်';
  O.world.lists.push({ list: 'item_category', key: 'mdy1', label: MDY, active: true, order: 9, shop: 'S2', detail: '', note: '' });
  let oCtx = null;
  const oReal = O.ports.ai.describePhoto;
  O.ports.ai.describePhoto = function (file, ctx) { oCtx = ctx; return oReal.call(this, file, ctx); };
  O.scan(ow, 'S2-0004');
  O.sim.photo(ow, PH);
  check(!!oCtx && oCtx.categories.indexOf(MDY) >= 0 && oCtx.categories[oCtx.categories.length - 1] === 'အခြား',
    'row 6, the piece\'s shop: the owner (staff shop S1) registering an S2 blank tag gives the photo AI the S2 list (the S2-only row in it)', oCtx && oCtx.categories);
  O.tapData(ow, 'NI|S2-0004|c');
  check(O.screen(ow).flat.indexOf('NI|S2-0004|c|mdy1') === 4 && O.screen(ow).flat[5] === 'NI|S2-0004|c|other', 'the 🏷 screen of that S2 tag offers the S2-only row (the item\'s shop, not the owner\'s)', O.screen(ow).flat);
  O.tapData(ow, 'LA|ic|NIC|S2-0004');
  const oRows = O.world.lists.length;
  O.sim.text(ow, MDY);
  check(O.screen(ow).text.split('\n')[0] === txt('add_exists', { label: MDY }) && O.state(ow).kind === 'new_item' && O.state(ow).draft.category === MDY && O.world.lists.length === oRows,
    'typed at that card\'s ➕, the S2-only name is that row (add_exists, the card takes it), not closed: the name is checked for the item\'s shop', O.screen(ow).text.split('\n')[0]);
  const T12 = bench();
  T12.world.lists.push({ list: 'item_category', key: 'abcdefghijkl', label: 'ရှည်', active: true, order: 7, shop: '', detail: '', note: '' });
  T12.scan(u, id);
  T12.sim.photo(u, PH);
  T12.tapData(u, NI('c'));
  check(bytes('abcdefghijkl') === 12 && T12.screen(u).flat.indexOf(NI('c|abcdefghijkl')) === 4 && bytes(NI('c|abcdefghijkl')) === 25,
    'a hand-typed key of exactly 12 bytes stays on the 🏷 screen (the longest callback, 25 bytes)', T12.screen(u).flat);
  const D2 = bench(), own2 = D2.ports.store.getStaff('1000');
  D2.option('item_category', 'other').label = 'တခြား';
  D2.world.designs.filter(d => d.code === 'TSL-0025')[0].category = 'chair';
  const o3 = createOrder(D2.ports, { shop: 'S1', customerId: 'C-0001', staff: own2 });
  addOrderLine(D2.ports, o3.id, { designCode: 'TSL-0025', qty: 1, unitPrice: 50000 });
  D2.sim.start(u, '');
  D2.tapData(u, 'OT|' + o3.id);
  D2.scan(u, 'S1-0010');
  const t3 = D2.ports.store.getItem('S1-0010');
  check(t3.alias === o3.id + '-1' && t3.category === 'တခြား', 'row 14: a design whose category is no list name (chair) gives the catch-all\'s current label (the other row relabelled တခြား)', [t3.alias, t3.category]);
  // Round-6b review fixes (core, after the build): an old built-in name at ➕, a name of emoji only, a tap on an older card
  // while the prompt waits, the chosen row kept by its key through a rename, the prompt's own window inside the card's.
  const G1 = bench();
  G1.option('item_category', 'htamein').label = 'ထမိန်';
  G1.scan(u, id);
  G1.sim.photo(u, PH);
  G1.tapData(u, NI('c'));
  G1.tapData(u, 'LA|ic|NIC|' + id);
  const g1Rows = G1.world.lists.length;
  G1.sim.text(u, 'ထမီ');
  check(G1.screen(u).text.split('\n')[0] === txt('add_exists', { label: 'ထမိန်' }) && G1.world.lists.length === g1Rows && G1.state(u).kind === 'new_item' && G1.state(u).draft.category === 'ထမိန်' &&
    G1.state(u).draft.categoryKey === 'htamein' && same(itemCategoryOptions(G1.ports, 'S1').map(r => r.key), CFG.ITEM_CATEGORY_KEYS),
    'fix: the htamein row relabelled ထမိန်, its old name ထမီ typed at ➕ → add_exists (ထမိန်): that row (key htamein), no second row of the old name, the chips unchanged',
    { first: G1.screen(u).text.split('\n')[0], rows: G1.world.lists.length - g1Rows, cat: G1.state(u).draft.category });
  G1.option('item_category', 'other').label = 'တခြား';
  G1.tapData(u, NI('c'));
  G1.tapData(u, 'LA|ic|NIC|' + id);
  G1.sim.text(u, 'အခြား');
  check(G1.screen(u).text.split('\n')[0] === txt('add_exists', { label: 'တခြား' }) && G1.world.lists.length === g1Rows && G1.state(u).draft.category === 'တခြား',
    'fix: the catch-all relabelled တခြား, its old name အခြား typed at ➕ → add_exists (တခြား), no custom အခြား row before it', G1.screen(u).text.split('\n')[0]);
  G1.tapData(u, NI('c'));
  G1.tapData(u, 'LA|ic|NIC|' + id);
  const g1Emoji = [];
  ['👗', '👗 ၁၂', '🎨🎨'].forEach(x => { G1.sim.text(u, x); g1Emoji.push(G1.screen(u).text === MSG.add_ask_ic && same(G1.screen(u).datas, BACK) && G1.state(u).kind === 'await_text'); });
  check(g1Emoji.every(Boolean) && G1.world.lists.length === g1Rows, 'fix: a name of emoji only (👗, 👗 ၁၂, 🎨🎨) typed at ➕ → add_ask_ic again with ⏮, the prompt kept, no row (its app chip would be blank)', g1Emoji);
  G1.sim.text(u, '👗 ပိုးထည်');
  check(G1.screen(u).text.split('\n')[0] === txt('add_done', { label: '👗 ပိုးထည်' }) && G1.world.lists.length === g1Rows + 1, 'a name with letters beside its emoji is still a name (add_done)', G1.screen(u).text.split('\n')[0]);

  const G2 = bench();
  G2.scan(u, id);
  G2.sim.photo(u, PH);
  const g2m1 = G2.screen(u).id, g2m1Text = G2.screen(u).text;
  G2.sim.text(u, '25000');
  const g2m2 = G2.screen(u).id;
  G2.tapData(u, NI('c'));
  G2.tapData(u, 'LA|ic|NIC|' + id);
  const g2Asks = msgText(G2, g2m2) === MSG.add_ask_ic;
  G2.sim.tap(u, g2m1, 'PS|' + id);
  const g2Card = () => { const st2 = G2.state(u); return !!st2 && st2.kind === 'new_item' && st2.step === 'card' && st2.msgId === g2m2 && msgText(G2, g2m2).indexOf(txt('photo_seen', { name: st2.draft.name, category: st2.draft.category })) === 0; };
  const g2a = g2Card() && G2.state(u).draft.sample === true;
  G2.tapData(u, NI('c'));
  G2.tapData(u, 'LA|ic|NIC|' + id);
  G2.sim.tap(u, g2m1, 'P|' + id + '|30000');
  const g2b = g2Card() && G2.state(u).draft.price === 30000;
  G2.tapData(u, NI('c'));
  G2.tapData(u, 'LA|ic|NIC|' + id);
  G2.sim.tap(u, g2m1, NI('q|+'));
  const g2c = g2Card() && G2.state(u).draft.count === 2;
  G2.tapData(u, NI('c'));
  G2.tapData(u, 'LA|ic|NIC|' + id);
  G2.sim.tap(u, g2m1, 'C|' + id + '|other');
  const g2d = G2.state(u).step === 'cost' && G2.state(u).msgId === g2m2 && msgText(G2, g2m2).indexOf(MSG.item_ask_cost) >= 0;
  check(g2Asks && g2a && g2b && g2c && g2d && msgText(G2, g2m1) === g2m1Text,
    'fix: while ➕ asks on the newer card message, 🎨, a price, ➕ of the count and 🪙 tapped on the OLDER card redraw the PROMPT message (the card, its 🪙 screen), never the older one: no question is left asking on screen after its state is gone',
    { g2Asks, g2a, g2b, g2c, g2d, m2: msgText(G2, g2m2).split('\n')[0], m1same: msgText(G2, g2m1) === g2m1Text });

  const G3 = bench(), MISS = 'ပိုးထည် အင်္ကျီ';
  G3.scan(u, id);
  G3.sim.photo(u, PH);
  G3.tapData(u, NI('c'));
  G3.tapData(u, 'LA|ic|NIC|' + id);
  G3.sim.text(u, SILK);
  const g3Row = G3.world.lists.filter(r => r.list === 'item_category').slice(-1)[0];
  const g3Key = G3.state(u).draft.categoryKey;
  g3Row.label = MISS;
  G3.tapData(u, 'P|' + id + '|25000');
  G3.tapData(u, 'NC|' + id + '|ok');
  G3.scan(u, 'S1-0008');
  G3.sim.photo(u, PH);
  G3.tapData(u, 'NI|S1-0008|c');
  G3.tapData(u, 'NI|S1-0008|c|' + g3Row.key);
  const g3Pick = G3.state(u).draft.categoryKey;
  g3Row.label = SILK + ' ၂';
  G3.tapData(u, 'P|S1-0008|25000');
  G3.tapData(u, 'NC|S1-0008|ok');
  check(g3Key === g3Row.key && g3Pick === g3Row.key && G3.ports.store.getItem(id).category === MISS && G3.ports.store.getItem('S1-0008').category === SILK + ' ၂',
    'fix: a category added at ➕ (or picked on 🏷) and renamed on the laptop before ✅ is stored under its new label (the card keeps the row\'s key), never the catch-all',
    { g3Key, g3Pick, a: G3.ports.store.getItem(id).category, b: G3.ports.store.getItem('S1-0008').category });

  const G4 = bench(), g4sec = n => { G4.world.nowOverride = new Date(G4.world.nowOverride.getTime() + n * 1000); };
  G4.scan(u, id);
  G4.sim.photo(u, PH);
  G4.tapData(u, 'P|' + id + '|25000');
  G4.tapData(u, NI('c'));
  G4.tapData(u, 'LA|ic|NIC|' + id);
  const g4p = G4.screen(u).id, g4Exp = G4.world.cacheData['st:' + u.id].exp - G4.world.nowOverride.getTime(), g4Rows = G4.world.lists.length;
  g4sec(601);
  G4.sim.tap(u, g4p, NI('back'));
  const g4st = G4.state(u);
  check(g4Exp === CFG.STATE_TTL_SEC * 1000 && !!g4st && g4st.kind === 'new_item' && g4st.draft.price === 25000 && !!g4st.draft.photoFileId &&
    msgText(G4, g4p).indexOf(txt('photo_seen', { name: g4st.draft.name, category: g4st.draft.category })) === 0,
    'fix: the ➕ prompt keeps the card\'s lifetime (STATE_TTL_SEC): 601 s later ⏮ on the prompt gives the card back with its photo and price, not expired', { g4Exp, st: g4st && g4st.kind });
  G4.tapData(u, NI('c'));
  G4.tapData(u, 'LA|ic|NIC|' + id);
  g4sec(601);
  G4.sim.text(u, SILK);
  check(G4.world.lists.length === g4Rows && !!G4.state(u) && G4.state(u).kind === 'new_item' && G4.state(u).draft.category !== SILK,
    '… while the prompt itself still lapses after ADD_STATE_TTL_SEC: a name typed 601 s after ➕ adds no category, the card is still there', { rows: G4.world.lists.length - g4Rows, st: G4.state(u) });
});

step('W45. Restock from Telegram\'s menu (round 6b, G3): ☰ 📦, a tag, a count, the next tag, ✅; ✏️, ✖️, 🛒, refusals, the 180 s window');
runStep(() => {
  const u = U.sister, o = U.owner;
  const R = bench();
  const tap = data => R.tapData(u, data);
  const presets = id => CFG.RESTOCK_PRESETS.map(n => 'RQ|' + id + '|' + n);
  const countText = id => { const it = R.ports.store.getItem(id); return txt('group_item_line', { id, name: it.name, stock: fmtCount(it.stock) }) + '\n' + MSG.ask_restock_qty; };
  const restocks = () => R.world.ledger.filter(r => r.type === 'RESTOCK').length;
  const msgById = mid => R.world.chats[u.id].filter(m => m.id === mid)[0];
  R.sim.start(u, '');
  check(same(R.datas(R.last(u))[3], ['M|ord', 'M|restock', 'M|nb', 'M|acct']), 'the Telegram menu\'s fourth row is [🧵 M|ord, 📦 M|restock, 📒 M|nb, 🏛 M|acct]', R.datas(R.last(u)));
  tap('M|restock');
  let s = R.screen(u);
  check(s.text === MSG.restock_ask_tag && same(s.datas, [['Z']]) && R.state(u).kind === 'restock_loop' && R.state(u).step === 'tag' && R.state(u).n === 0 &&
    R.world.cacheData['st:' + u.id].exp === R.world.nowOverride.getTime() + CFG.RESTOCK_LOOP_TTL_SEC * 1000,
    'M|restock → restock_ask_tag with [✖️ Z], the state restock_loop / tag, its cache entry expires CFG.RESTOCK_LOOP_TTL_SEC s ahead', { text: s.text, st: R.state(u) });
  R.sim.start(u, 'S1-0002');
  s = R.screen(u);
  const cnt1 = s.id;
  check(s.text === countText('S1-0002') && same(s.datas, [presets('S1-0002'), ['RQ|S1-0002|other', 'RT|skip'], ['K|S1-0002']]) && R.state(u).step === 'qty' && R.state(u).itemId === 'S1-0002',
    'scan S1-0002 → group_item_line + ask_restock_qty, [presets], [✏️ RQ other, ✖️ RT|skip], [🛒 K|S1-0002]; the state at qty', { text: s.text, datas: s.datas });
  const r0 = restocks(), l0 = R.ledgerLen();
  tap('RQ|S1-0002|5');
  const cm = msgById(cnt1), lastRow = R.lastRow();
  s = R.screen(u);
  check(cm.text === 'S1-0002 · ' + txt('restock_done', { qty: '၅', stock: '၁၀' }) && same(R.datas(cm), [['U|' + lastRow.groupId]]) && s.id !== cnt1 && s.text === MSG.restock_more && same(s.datas, [['RT|done']]) &&
    R.state(u).step === 'tag' && R.state(u).n === 1 && R.ledgerLen() === l0 + 1 && lastRow.type === 'RESTOCK' && lastRow.qty === 5 && lastRow.itemId === 'S1-0002',
    'RQ|S1-0002|5 → that message reads S1-0002 · restock_done with ↩️, then a NEW restock_more with [✅ RT|done]; n 1; ONE RESTOCK of +5', { cm: cm.text, s: s.text, st: R.state(u) });
  // B9: a typed count at the count screen; out-of-range numbers.
  R.sim.start(u, 'S1-0005');
  R.sim.text(u, '7');
  const b9 = R.bots(u).slice(-2);
  check(b9[0].text === 'S1-0005 · ' + txt('restock_done', { qty: '၇', stock: '၉' }) && b9[1].text === MSG.restock_more && R.state(u).n === 2 && R.lastRow().qty === 7 && restocks() === r0 + 2,
    'B9: scan S1-0005, typed 7 → a new S1-0005 · restock_done (+7) and restock_more; n 2', b9.map(m => m.text));
  R.sim.start(u, 'S1-0005');
  const l9 = R.ledgerLen();
  R.sim.text(u, '0');
  const z = R.bots(u).slice(-2);
  R.sim.text(u, '1000');
  const k = R.bots(u).slice(-2);
  check(z[0].text === txt('bad_qty', { max: '၉၉၉' }) && z[1].text === countText('S1-0005') && k[0].text === txt('bad_qty', { max: '၉၉၉' }) && k[1].text === countText('S1-0005') &&
    R.ledgerLen() === l9 && R.state(u).kind === 'restock_loop' && R.state(u).step === 'qty',
    'B9: typed 0 and then 1000 → bad_qty and the count screen again each time; nothing written, the state at qty', [z.map(m => m.text), k.map(m => m.text)]);
  // m4: ✏️ inside the loop.
  const otherMsg = R.screen(u).id;
  tap('RQ|S1-0005|other');
  s = R.screen(u);
  check(s.id === otherMsg && s.text === MSG.restock_type_qty && same(s.datas, [['RT|skip']]) && R.state(u).kind === 'await_number' && R.state(u).purpose === 'restock_qty' && R.state(u).loop === 2 &&
    R.world.cacheData['st:' + u.id].exp === R.world.nowOverride.getTime() + CFG.RESTOCK_LOOP_TTL_SEC * 1000,
    'm4: RQ|S1-0005|other → that message reads restock_type_qty with [✖️ RT|skip]; the state await_number / restock_qty / loop 2 (the loop\'s TTL)', { text: s.text, st: R.state(u) });
  const l4 = R.ledgerLen();
  R.sim.text(u, '25000');
  check(R.screen(u).text === txt('bad_qty', { max: '၉၉၉' }) && same(R.screen(u).datas, [['RT|skip']]) && R.ledgerLen() === l4 && R.state(u).loop === 2, 'm4: typed 25000 → bad_qty with [✖️ RT|skip], nothing written', R.screen(u).text);
  R.sim.text(u, '3');
  check(R.bots(u).slice(-2)[0].text === 'S1-0005 · ' + txt('restock_done', { qty: '၃', stock: '၁၂' }) && R.screen(u).text === MSG.restock_more && R.state(u).n === 3 && R.lastRow().qty === 3,
    'm4: typed 3 → +3 and restock_more; n 3', R.bots(u).slice(-2).map(m => m.text));
  // B8: ✅ while ✏️ waits ends the loop.
  R.sim.start(u, 'S1-0005');
  tap('RQ|S1-0005|other');
  tap('RT|done');
  const r8 = restocks();
  check(R.screen(u).text === MSG.restock_loop_done && R.state(u) === null, 'B8: scan, ✏️, then RT|done → restock_loop_done, the state null', R.screen(u).text);
  R.sim.text(u, '4');
  check(restocks() === r8, 'B8: a typed 4 afterwards writes no RESTOCK', restocks() - r8);
  // m3: ✖️ in the loop skips the tag and keeps the loop.
  tap('M|restock');
  R.sim.start(u, 'S1-0002');
  tap('RQ|S1-0002|1');
  R.sim.start(u, 'S1-0002');
  const skipMsg = R.screen(u).id, l3 = R.ledgerLen();
  tap('RT|skip');
  check(R.screen(u).id === skipMsg && R.screen(u).text === MSG.restock_more && same(R.screen(u).datas, [['RT|done']]) && R.state(u).kind === 'restock_loop' && R.state(u).step === 'tag' && R.state(u).n === 1 && R.ledgerLen() === l3,
    'm3: armed with n 1, scan S1-0002, RT|skip → that message becomes restock_more with [✅ RT|done], the state at tag, nothing written', R.screen(u).text);
  tap('RT|done');
  tap('M|restock');
  R.sim.start(u, 'S1-0002');
  tap('RT|skip');
  check(R.screen(u).text === MSG.restock_ask_tag && same(R.screen(u).datas, [['Z']]) && R.state(u).n === 0, 'm3: armed with n 0, the same → restock_ask_tag with [✖️ Z]', R.screen(u).text);
  // B10: 🛒 opens the item card and ends the loop.
  R.sim.start(u, 'S1-0002');
  tap('K|S1-0002');
  check(R.screen(u).text === cardText(R.ports, R.ports.store.getItem('S1-0002')) && R.state(u) === null, 'B10: scan S1-0002, K|S1-0002 → the item card, the state null', R.screen(u).text.split('\n')[0]);
  // M1: a one-of-a-kind piece ends the loop.
  tap('M|restock');
  R.sim.start(u, 'S1-0002');
  tap('RQ|S1-0002|1');
  const l1 = R.ledgerLen();
  R.sim.start(u, 'S1-0001');
  const m1 = R.bots(u).slice(-2);
  check(m1[0].text === txt('basket_unique', { id: 'S1-0001' }) + '\n' + MSG.restock_loop_done && m1[1].text === cardText(R.ports, R.ports.store.getItem('S1-0001')) && R.state(u) === null && R.ledgerLen() === l1,
    'M1: armed, one save, scan S1-0001 (one of a kind) → basket_unique + restock_loop_done, then S1-0001\'s item card; the state null, no row', m1.map(m => m.text.split('\n')[0]));
  // m15: refusals keep the loop, the ask names ✅ after a save.
  tap('M|restock');
  R.sim.start(u, 'S1-0002');
  tap('RQ|S1-0002|1');
  const l15 = R.ledgerLen();
  R.sim.start(u, 'S1-0007');
  const rBlank = R.screen(u);
  R.sim.start(u, 'S9-9999');
  const rMissing = R.screen(u);
  R.sim.start(u, 'S2-0003');
  const rOther = R.screen(u);
  check(rBlank.text === txt('basket_blank', { id: 'S1-0007' }) + '\n' + MSG.restock_more && same(rBlank.datas, [['RT|done']]) && rMissing.text === txt('tag_not_found', { id: 'S9-9999' }) + '\n' + MSG.restock_more &&
    rOther.text === txt('basket_other_shop', { id: 'S2-0003', shop: shopName(R.ports, 'S2') }) + '\n' + MSG.restock_more && R.state(u).kind === 'restock_loop' && R.state(u).step === 'tag' && R.state(u).n === 1 && R.ledgerLen() === l15,
    'm15: armed, one save: a blank S1-0007 → basket_blank on top of restock_more with [✅]; S9-9999 → tag_not_found; the sister\'s S2-0003 → basket_other_shop; the loop kept each time', [rBlank.text, rMissing.text, rOther.text]);
  R.sim.text(u, '5');
  check(R.screen(u).text === countText('S1-0005') && R.state(u).itemId === 'S1-0005', 'typed 5 at the ask → S1-0005\'s count screen (the shop and four digits)', R.screen(u).text);
  tap('RT|done');
  check(R.screen(u).text === MSG.restock_loop_done && R.state(u) === null, 'RT|done → restock_loop_done, the state null');
  R.sim.start(u, 'S1-0002');
  check(R.screen(u).text === cardText(R.ports, R.ports.store.getItem('S1-0002')), 'a later scan of S1-0002 → the item card, not the count screen', R.screen(u).text.split('\n')[0]);
  tap('M|restock');
  tap('M|today');
  check(R.state(u) === null, 'armed again, M|today → the loop is gone (a menu tap ends it)', R.state(u));
  tap('M|restock');
  R.world.nowOverride = new Date(R.world.nowOverride.getTime() + 181000);
  R.sim.start(u, 'S1-0002');
  check(R.screen(u).text === cardText(R.ports, R.ports.store.getItem('S1-0002')) && R.state(u) === null, 'armed again, the clock moved 181 s → a scan of S1-0002 gives the item card (the TTL)', R.screen(u).text.split('\n')[0]);
  // The owner restocks any shop's stock item.
  R.sim.start(o, '');
  R.tapData(o, 'M|restock');
  R.sim.start(o, 'S2-0003');
  check(R.screen(o).text === countText('S2-0003') && R.state(o).step === 'qty', 'the owner restocks S2-0003 (no refusal)', R.screen(o).text);
  R.tapData(o, 'RT|done');
  // Outside the loop the item card's 📦 is today's.
  R.sim.start(u, 'S1-0002');
  tap('R|S1-0002');
  s = R.screen(u);
  const rq = s.id;
  check(s.text === MSG.ask_restock_qty && same(s.datas, [presets('S1-0002'), ['RQ|S1-0002|other', 'Z']]), 'an item card\'s R|S1-0002 → today\'s screen: its second row [✏️, ✖️ Z], no 🛒 row', s.datas);
  const stockNow = Number(R.ports.store.getItem('S1-0002').stock);
  tap('RQ|S1-0002|1');
  check(R.screen(u).id === rq && R.screen(u).text === txt('restock_done', { qty: '၁', stock: fmtCount(stockNow + 1) }) && R.state(u) === null,
    'its RQ reply is today\'s text (no prefix, no next-tag offer)', R.screen(u).text);

  // The step-1 checker's additions: the re-armed count screen, the last item, the loop's guards, F10b and the digits.
  const X = bench(), xs = U.sister;
  const xt = data => X.tapData(xs, data);
  const sec = n => { X.world.nowOverride = new Date(X.world.nowOverride.getTime() + n * 1000); };
  const xRest = () => X.world.ledger.filter(r => r.type === 'RESTOCK').length;
  const xMsg = mid => X.world.chats[xs.id].filter(m => m.id === mid)[0];
  const xExp = k => X.world.cacheData[k + ':' + xs.id].exp - X.world.nowOverride.getTime();
  X.sim.start(xs, '');
  xt('M|restock');
  X.scan(xs, 'S1-0002');
  sec(170);
  X.sim.text(xs, '0');
  const reArm = xExp('st');
  sec(170);
  const xr0 = xRest();
  X.sim.text(xs, '5');
  check(reArm === CFG.RESTOCK_LOOP_TTL_SEC * 1000 && xRest() === xr0 + 1 && X.lastRow().qty === 5 && X.lastRow().itemId === 'S1-0002' && X.screen(xs).text === MSG.restock_more,
    'B9: the count screen shown again after bad_qty re-arms the loop (180 s from that prompt): a count typed 170 s later still saves', { reArm, rows: xRest() - xr0, st: X.state(xs) });
  X.scan(xs, 'S1-0005');
  const li = getLastItem(X.ports, String(xs.id));
  sec(100);
  xt('RQ|S1-0005|1');
  check(!!li && li.id === 'S1-0005' && xExp('li') === CFG.LAST_ITEM_TTL_SEC * 1000 && getLastItem(X.ports, String(xs.id)).id === 'S1-0005',
    'a tag accepted in the loop becomes the last item (a photo or a voice note refers to it), and a save sets it again (its window starts at the save)', { li: li && li.id, exp: xExp('li') });
  X.scan(xs, 'S1-0002');
  const olderScreen = X.screen(xs).id;
  X.scan(xs, 'S1-0005');
  const xr18 = xRest(), stock18 = Number(X.ports.store.getItem('S1-0002').stock);
  X.sim.tap(xs, olderScreen, 'RQ|S1-0002|2');
  check(xMsg(olderScreen).text === txt('restock_done', { qty: '၂', stock: fmtCount(stock18 + 2) }) && xRest() === xr18 + 1 && X.state(xs).kind === 'restock_loop' && X.state(xs).step === 'qty' && X.state(xs).itemId === 'S1-0005' && X.state(xs).n === 2,
    'a preset tapped on the older count screen of S1-0002 after S1-0005 replaced it saves as an R| screen always did (today\'s reply); the loop stays at S1-0005\'s count screen', { text: xMsg(olderScreen).text, st: X.state(xs) });
  xt('RT|skip');
  X.sim.text(xs, '၅');
  check(X.state(xs).step === 'qty' && X.state(xs).itemId === 'S1-0005' && X.screen(xs).text.indexOf(txt('group_item_line', { id: 'S1-0005', name: X.ports.store.getItem('S1-0005').name, stock: fmtCount(X.ports.store.getItem('S1-0005').stock) })) === 0,
    'a bare tag number in Burmese digits (၅) at the ask → S1-0005\'s count screen', X.state(xs));
  xt('RQ|S1-0005|other');
  const vState = X.state(xs), xr15 = xRest();
  applyAwaitedNumber(xs.id, String(xs.id), vState, 2.5, X.ports.store.getStaff('1001'), 'w45-voice', X.ports, CFG.SOURCE.VOICE, 'နှစ်ထည်ခွဲ');
  check(X.screen(xs).text === txt('bad_qty', { max: '၉၉၉' }) && same(X.screen(xs).datas, [['RT|skip']]) && xRest() === xr15 && X.state(xs).kind === 'await_number' && X.state(xs).loop === vState.loop,
    'm4: a spoken 2.5 after ✏️ (the model\'s count, as handleIntent passes it) → bad_qty with [✖️ RT|skip], nothing written, the prompt kept', { text: X.screen(xs).text, st: X.state(xs) });
  xt('RT|done');
  const doneMsg = X.screen(xs).id;
  X.sim.tap(xs, doneMsg, 'RT|skip');
  const skipNoLoop = xMsg(doneMsg).text, stSkip = X.state(xs);
  X.sim.tap(xs, doneMsg, 'RT|done');
  check(skipNoLoop === MSG.expired && stSkip === null && xMsg(doneMsg).text === MSG.restock_loop_done && X.state(xs) === null,
    'with no loop: RT|skip reads expired and arms nothing; RT|done reads restock_loop_done again (idempotent)', { skipNoLoop, stSkip });
  xt('M|restock');
  X.scan(xs, 'S1-0001');
  const u0 = X.bots(xs).slice(-2);
  check(u0[0].text === txt('basket_unique', { id: 'S1-0001' }) && u0[1].text === cardText(X.ports, X.ports.store.getItem('S1-0001')) && X.state(xs) === null,
    'M1 before any save: a one-of-a-kind scan → basket_unique alone (no restock_loop_done: nothing was recorded), then its item card', u0.map(m => m.text.split('\n')[0]));
  X.scan(xs, 'S1-0002');
  xt('R|S1-0002');
  xt('RQ|S1-0002|other');
  const cardPromptTtl = xExp('st');
  X.scan(xs, 'S1-0005');
  check(cardPromptTtl === CFG.STATE_TTL_SEC * 1000 && X.screen(xs).text === cardText(X.ports, X.ports.store.getItem('S1-0005')),
    'an item card\'s own ✏️ restock prompt is not the loop: it keeps STATE_TTL_SEC and the next scan shows the item card', { cardPromptTtl, text: X.screen(xs).text.split('\n')[0] });
  const br = U.brother;
  X.sim.start(br, '');
  X.tapData(br, 'M|restock');
  X.sim.text(br, '3');
  check(X.state(br).kind === 'restock_loop' && X.state(br).step === 'qty' && X.state(br).itemId === 'S2-0003',
    'F10b: the S2 seller types 3 at the ask → S2-0003\'s count screen (the tag of the seller\'s own shop)', X.state(br));
  X.tapData(br, 'RT|done');
  // Round-6b review fixes (core, after the build): only a number on its own is a count; a typed tag at the count screen;
  // a spoken count, a spoken tag number, a confirmed restock proposal; a count screen tapped after the loop's window; RT on
  // an older message.
  const Y = bench(), ys = U.sister;
  const yt = data => Y.tapData(ys, data);
  const ySec = n => { Y.world.nowOverride = new Date(Y.world.nowOverride.getTime() + n * 1000); };
  const yRest = () => Y.world.ledger.filter(r => r.type === 'RESTOCK');
  const ySales = () => Y.world.ledger.filter(r => r.type === 'SALE').length;
  const yMsg = mid => Y.world.chats[ys.id].filter(m => m.id === mid)[0];
  const yCount = cid => { const it = Y.ports.store.getItem(cid); return txt('group_item_line', { id: cid, name: it.name, stock: fmtCount(it.stock) }) + '\n' + MSG.ask_restock_qty; };
  const yAt = cid => !!Y.state(ys) && Y.state(ys).kind === 'restock_loop' && Y.state(ys).step === 'qty' && Y.state(ys).itemId === cid;
  Y.sim.start(ys, '');
  yt('M|restock');
  Y.scan(ys, 'S1-0002');
  const y0 = yRest().length, ySale0 = ySales();
  Y.sim.text(ys, 'S1-5');
  const yS15 = yAt('S1-0005') && Y.screen(ys).text === yCount('S1-0005');
  Y.sim.text(ys, 's1 0002');
  check(yS15 && yAt('S1-0002') && Y.screen(ys).text === yCount('S1-0002') && yRest().length === y0,
    'fix: at S1-0002\'s count screen a typed S1-5 is the next tag (S1-0005\'s count screen) and s1 0002 opens S1-0002 again: no RESTOCK of the piece on screen', { yS15, st: Y.state(ys) });
  ['tag 5', 'S9-0001', 'လုံချည် ၂ ထည် ရောင်းတယ် ၃၆၀၀၀', '09 777 123 456'].forEach(x => Y.sim.text(ys, x));
  check(yRest().length === y0 && ySales() === ySale0 && yAt('S1-0002'),
    'fix: at the count screen tag 5, S9-0001 (no shop of CFG.SHOP_IDS), a sale sentence and a phone number are no count: no RESTOCK (and no SALE), the loop still at S1-0002', yRest().length - y0);
  Y.sim.text(ys, '၂ ထည်');
  check(yRest().length === y0 + 1 && yRest()[yRest().length - 1].qty === 2 && yRest()[yRest().length - 1].itemId === 'S1-0002' && Y.screen(ys).text === MSG.restock_more,
    'a number on its own with ထည် after it (၂ ထည်) is the count: +2 and restock_more', Y.screen(ys).text);
  Y.scan(ys, 'S1-0002');
  yt('RQ|S1-0002|other');
  const y1 = yRest().length;
  Y.sim.text(ys, 'tag 5');
  const yEdit = !!Y.state(ys) && Y.state(ys).kind === 'await_number' && yRest().length === y1;
  Y.sim.text(ys, 'S1-5');
  check(yEdit && yAt('S1-0005') && yRest().length === y1, 'fix: at the ✏️ prompt the same rule: tag 5 is no count (the prompt kept), S1-5 is the next tag; no RESTOCK', { yEdit, st: Y.state(ys) });
  // Voice: a spoken count at the count screen and at ✏️, a spoken tag number at the ask, a spoken sale is no count.
  Y.sim.voice(ys, 'ငါးထည်');
  const yv = yRest()[yRest().length - 1];
  check(yRest().length === y1 + 1 && yv.itemId === 'S1-0005' && yv.qty === 5 && yv.source === CFG.SOURCE.VOICE && Y.screen(ys).text === MSG.restock_more && !!Y.state(ys) && Y.state(ys).step === 'tag',
    'fix: a spoken count (ငါးထည်) at S1-0005\'s count screen is its count: +5 VOICE, restock_more, the loop at the next tag', { row: yv, text: Y.screen(ys).text });
  Y.sim.voice(ys, 'နံပါတ် နှစ်');
  const yvTag = yAt('S1-0002');
  Y.sim.voice(ys, 'လုံချည် ၂ ထည် ရောင်းတယ် ၃၆၀၀၀');
  const yvSale = yRest().length === y1 + 1 && yAt('S1-0002');
  yt('RQ|S1-0002|other');
  Y.sim.voice(ys, 'သုံးထည်');
  check(yvTag && yvSale && yRest().length === y1 + 2 && yRest()[yRest().length - 1].qty === 3 && yRest()[yRest().length - 1].itemId === 'S1-0002' && !!Y.state(ys) && Y.state(ys).kind === 'restock_loop' && Y.state(ys).step === 'tag',
    'fix: a spoken number at the ask (နံပါတ် နှစ်) opens S1-0002; a spoken sale there is no count; after ✏️ a spoken သုံးထည် is +3 and the loop goes on', { yvTag, yvSale, st: Y.state(ys) });
  // A typed restock sentence at the count screen is proposed; its ✅ is the loop's count, so a bare number next is a tag.
  Y.scan(ys, 'S1-0005');
  const yn = (Y.state(ys) || {}).n;
  Y.sim.text(ys, 'ငါးထည် ရောက်တယ်');
  const yProp = Y.screen(ys).id;
  yt(Y.screen(ys).datas[0][0]);
  const yAfterY = yMsg(yProp).text, yStY = Y.state(ys);
  Y.sim.text(ys, '3');
  check(yAfterY.indexOf('S1-0005 · ') === 0 && Y.screen(ys).text === yCount('S1-0003') && !!yStY && yStY.step === 'tag' && yStY.n === yn + 1 && yRest().filter(r => r.itemId === 'S1-0005').slice(-1)[0].qty === 5 && yAt('S1-0003'),
    'fix: a typed ငါးထည် ရောက်တယ် at S1-0005\'s count screen → the proposal; ✅ saves +5 as the loop\'s count (S1-0005 · …) and asks the next tag, so a typed 3 opens S1-0003 (no second count of S1-0005)', { yAfterY, st: yStY });
  // The loop's window ran out while the seller counted at its latest count screen.
  const yLate = Y.screen(ys).id, yn2 = (Y.state(ys) || {}).n;
  ySec(200);
  yt('RQ|S1-0003|20');
  const yStock3 = Number(Y.ports.store.getItem('S1-0003').stock);
  check(yMsg(yLate).text === 'S1-0003 · ' + txt('restock_done', { qty: '၂၀', stock: fmtCount(yStock3) }) && Y.screen(ys).text === MSG.restock_more && same(Y.screen(ys).datas, [['RT|done']]) &&
    !!Y.state(ys) && Y.state(ys).kind === 'restock_loop' && Y.state(ys).step === 'tag' && Y.state(ys).n === yn2 + 1,
    'fix: 200 s after S1-0003\'s count screen (past the loop\'s 180 s) +20 tapped on it saves with its tag line and opens the loop again for the next tag', { text: yMsg(yLate).text, st: Y.state(ys) });
  Y.scan(ys, 'S1-0002');
  const yOldA = Y.screen(ys).id;
  Y.scan(ys, 'S1-0005');
  ySec(200);
  Y.sim.tap(ys, yOldA, 'RQ|S1-0002|1');
  const yOldTxt = yMsg(yOldA).text, yOldSt = Y.state(ys);
  Y.sim.start(ys, '');
  yt('M|restock');
  Y.scan(ys, 'S1-0005');
  const yMenu = Y.screen(ys).id;
  yt('M|today');
  Y.sim.tap(ys, yMenu, 'RQ|S1-0005|1');
  check(yOldTxt.indexOf('S1-0002 · ') !== 0 && yOldTxt.indexOf(MSG.restock_done.split('{')[0]) === 0 && yOldSt === null && yMsg(yMenu).text.indexOf('S1-0005 · ') !== 0 && Y.state(ys) === null,
    'only the latest count screen of a loop that ran out carries on: an older one\'s tap, or one after a menu tap ended the loop, is an item card\'s restock (today\'s reply, no loop)', { yOldTxt, yMenu: yMsg(yMenu).text });
  yt('M|restock');
  Y.scan(ys, 'S1-0002');
  const yTyped = Y.screen(ys).id;
  Y.sim.text(ys, '1');
  ySec(200);
  Y.sim.tap(ys, yTyped, 'RQ|S1-0002|1');
  check(yMsg(yTyped).text.indexOf('S1-0002 · ') !== 0 && yMsg(yTyped).text.indexOf(MSG.restock_done.split('{')[0]) === 0 && Y.state(ys) === null,
    '… nor does a count screen already answered by a typed count: its later tap is an item card\'s restock (no loop opened again)', { text: yMsg(yTyped).text, st: Y.state(ys) });
  // RT on an older message: it loses its buttons, the loop the seller is in goes on.
  yt('M|restock');
  Y.scan(ys, 'S1-0002');
  const yA = Y.screen(ys).id, yAText = yMsg(yA).text;
  Y.scan(ys, 'S1-0005');
  const yB = Y.screen(ys).id;
  Y.sim.tap(ys, yA, 'RT|skip');
  const ySkipOld = yMsg(yA).text === yAText && (yMsg(yA).keyboard || []).length === 0 && yAt('S1-0005');
  Y.sim.tap(ys, yB, 'RQ|S1-0005|5');
  const yMore = Y.screen(ys).id;
  Y.scan(ys, 'S1-0002');
  Y.sim.tap(ys, yMore, 'RT|done');
  const yDoneOld = (yMsg(yMore).keyboard || []).length === 0 && yMsg(yMore).text === MSG.restock_more && yAt('S1-0002');
  yt('RT|done');
  check(ySkipOld && yMsg(yB).text.indexOf('S1-0005 · ') === 0 && yDoneOld && Y.screen(ys).text === MSG.restock_loop_done && Y.state(ys) === null,
    'fix: ✖️ on an older count screen (after a second scan) only drops its buttons and the newer screen still saves as the loop\'s; ✅ on an older restock_more does the same; ✅ on the live prompt ends the loop',
    { ySkipOld, yB: yMsg(yB).text, yDoneOld });
});

step('W46. Round-6b texts');
runStep(() => {
  const specFile = path.join(ROOT, 'docs/design-round-6/SPEC-round-6b.md');
  const spec = fs.existsSync(specFile) ? fs.readFileSync(specFile, 'utf8').replace(/\r\n/g, '\n') : '';
  const block = title => {
    const i = spec.indexOf(title), a = spec.indexOf('```\n', i) + 4;
    return i < 0 ? [] : spec.slice(a, spec.indexOf('\n```', a)).split('\n').map(l => l.match(/^(\w+): '(.*)'$/)).filter(Boolean);
  };
  const b1 = block('### 4.1 core_messages.js `MSG`, round 6b'), b2 = block('### 4.2 Changed texts');
  check(b1.length === 10 && b1.every(m => typeof MSG[m[1]] === 'string' && MSG[m[1]].length > 0 && MSG[m[1]] === m[2]), 'every key of section 4.1\'s block (ten) is in MSG, non-empty and equal to the spec\'s text', b1.filter(m => MSG[m[1]] !== m[2]).map(m => m[1]));
  check(b2.length === 2 && b2.every(m => MSG[m[1]] === m[2]) && same(b2.map(m => m[1]).sort(), ['btn_sample_off', 'btn_sample_on']), 'the two changed keys of 4.2 equal their block', b2.map(m => m[1]));
});

step('W39. Revision-3 texts');
runStep(() => {
  const specFile = path.join(ROOT, 'docs/design-round-6/SPEC-round-6.md');
  const spec = fs.existsSync(specFile) ? fs.readFileSync(specFile, 'utf8').replace(/\r\n/g, '\n') : '';
  const i = spec.indexOf('### 13.14 Messages of revision 3'), a = spec.indexOf('```\n', i) + 4;
  const pairs = i < 0 ? [] : spec.slice(a, spec.indexOf('\n```', a)).split('\n').map(l => l.match(/^(\w+): '(.*)'$/)).filter(Boolean);
  check(pairs.length === 7 && pairs.every(m => typeof MSG[m[1]] === 'string' && MSG[m[1]].length > 0 && MSG[m[1]] === m[2]), 'every key of 13.14\'s MSG block (seven) is in MSG, non-empty and equal to the spec\'s text', pairs.filter(m => MSG[m[1]] !== m[2]).map(m => m[1]));
  check(worlds.every(w => w.errors.filter(e => e.where === 'handleUpdate').length === 0) && maxCb.len <= 64, 'no update of any world failed with an exception, and every callback stayed within 64 bytes, to the end of the file',
    worlds.map(w => w.errors.filter(e => e.where === 'handleUpdate').map(e => e.message)).filter(x => x.length));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
