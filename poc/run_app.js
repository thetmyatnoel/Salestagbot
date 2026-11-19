/**
 * poc/run_app.js — the phone app's data layer and sync client against the fake server, in Node with the
 * memory adapter. Enrollment by typed code, a sale offline (the ✅ waits for the adapter write), the
 * outbox pushed on sync, a Telegram-route row pulled, the stepper's S|id|N, the clock offset applied to
 * Day, the AI queue replayed, a restart from the adapter, Transport B export parsed back by core_sync,
 * the sync chip state machine, debounce and one-in-flight, DRAIN and REVOKE (wipe). The core's own checks
 * (poc/run_scenario.js, poc/run_sync.js) are not rerun here.
 *
 *   node poc/run_app.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CORE_FIRST = ['core_config.js', 'core_burmese.js', 'core_messages.js', 'core_ai_prompt.js', 'core_ledger.js', 'core_report.js', 'core_bot.js', 'core_sync.js'];
// Same order as tools/build_app.js: the named core files, then any other core_*.js alphabetically (core_orders.js).
const CORE_REST = fs.readdirSync(path.join(ROOT, 'apps-script')).filter(f => /^core_.*\.js$/.test(f) && !CORE_FIRST.includes(f)).sort();
const FILES = CORE_FIRST.concat(CORE_REST).map(f => 'apps-script/' + f).concat([
  'poc/sim_mock_ai.js', 'poc/sim_ports.js', 'poc/sim_seed.js', 'poc/sim_sync.js',
  'app/app_i18n.js', 'app/app_store.js', 'app/app_ports.js', 'app/app_sync.js', 'app/app_scan.js', 'app/app_media.js', 'app/app_icons.js', 'app/app_ui.js',
  'app/app_forms.js', 'app/app_sketch.js', 'app/app_screens.js'
]);
FILES.forEach(f => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }));

let pass = 0, fail = 0;
function check(cond, label, detail) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✘ ' + label + (detail === undefined ? '' : ' | got: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); }
}
const step = title => console.log('\n── ' + title);
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

/* ------------------------------ world, server, network, timers ------------------------------ */

const world = seedSimWorld(createSimWorld());
const server = createFakeServer(world);
const U = SIM_USERS;
const sister = U.sister, brother = U.brother;
const net = { offline: false };
function transport(api, body) {
  if (net.offline) throw new Error('offline (test switch)');
  return server.handle(api, body);           // synchronous, like the fake server; app_sync wraps it in a Promise
}
const timers = {
  queue: [], n: 0,
  setTimeout(fn, ms) { const h = { fn, ms, id: ++timers.n }; timers.queue.push(h); return h; },
  clearTimeout(h) { const i = timers.queue.indexOf(h); if (i >= 0) timers.queue.splice(i, 1); },
  async fire() { const h = timers.queue.shift(); if (h) await h.fn(); }
};
const sStock = id => server.stock(id);
const rowsOf = txId => world.ledger.filter(r => r.txId === txId);
const lastLocal = phone => { const l = phone.store.ledger; for (let i = l.length - 1; i >= 0; i--) if (!l[i].synced) return l[i]; return null; };

async function makePhone(name, extra) {
  const adapter = (extra && extra.adapter) || createMemoryAdapter();
  const phone = createAppPhone(Object.assign({ adapter, name, transport, clock: () => world.ports.clock.now(), platform: 'android' }, extra || {}));
  const sync = createAppSync(phone, { transport, timers, platform: 'android', label: name });
  await phone.load();
  return { phone, sync, adapter, store: phone.store, ports: phone.ports };
}

async function main() {
  step('1. Tag links: the printed t.me QR, tg://, a bare id, the app\'s own link');
  check(appParseTagLink('https://t.me/ShopTagBot?start=S1-0042') === 'S1-0042', 't.me/<bot>?start=ID');
  check(appParseTagLink('tg://resolve?domain=ShopTagBot&start=s2-0007') === 'S2-0007', 'tg://resolve?...&start=ID (upper-cased)');
  check(appParseTagLink(' s1-0042 ') === 'S1-0042' && appParseTagLink('S1 0042') === 'S1-0042', 'a bare id, trimmed, with or without the dash');
  check(appParseTagLink('https://salestag.web.app/?start=S1-0042&src=tag') === 'S1-0042', 'the app\'s own ?start=ID link');
  check(appParseTagLink('hello') === null && appParseTagLink('') === null && appParseTagLink('S3-0001') === null, 'anything else is null');

  step('2. Enrollment by typed code against the fake server, bootstrap with paging and progress');
  const minted = server.mintEnrollCode(sister, 'A phone');
  const A = await makePhone('A');
  check(A.store.loaded && !A.store.meta.deviceId && A.sync.chipState().kind === 'never', 'a fresh phone loads empty and the chip says not enrolled');
  const bad = await A.sync.enroll('AAAA-AAAA');
  check(!bad.ok && bad.error === 'enroll_bad' && bad.attemptsLeft === 4 && A.store.meta.lastSyncError === 'enroll_bad', 'a wrong code is refused with the attempts left, and the error is remembered');
  const progress = [];
  A.sync.progress = p => progress.push(p);
  const enr = await A.sync.enroll(minted.display.toLowerCase());
  check(enr.ok && A.store.meta.deviceId === minted.deviceId && A.store.meta.token.length === 64 && A.store.meta.staff.id === '1001' && A.store.meta.receiptLetter === 'A', 'the right code (typed with the dash, lower case) enrolls: device, 32-byte token, staff, letter A');
  const metaOnDisk = A.adapter.data.meta.meta && A.adapter.data.meta.meta.value;
  check(metaOnDisk && metaOnDisk.deviceId === minted.deviceId && metaOnDisk.token === A.store.meta.token && metaOnDisk.cursor.ledgerSeq === server.props.LEDGER_SEQ, 'device, token and cursor are persisted through the adapter');
  check(progress.length >= 1 && progress[progress.length - 1].done && progress[progress.length - 1].rows === world.ledger.length, 'the progress callback reported every page and the end');
  check(A.store.ledger.length === world.ledger.length && A.adapter.count('ledger') === world.ledger.length && A.store.ledger.every(r => r.synced && r.seq > 0), 'the whole ledger is on the phone and on disk, every row synced with its Seq');
  check(world.items.every(it => A.phone.stockOf(it.id) === sStock(it.id)) && A.store.items.length === world.items.length, 'incremental stock map equals the server for every item; both shops\' items mirrored');
  check(A.ports.store.getStaff('1001').role === 'staff' && A.ports.store.listStaff().some(s => s.id === '1000' && s.role === 'owner'), 'the phone knows itself and the owner (notifyOwners)');
  check(A.store.settings.shop_name_S1 === 'ဆိုင် ၁ (ရန်ကုန်)' && A.adapter.count('settings') > 0, 'settings arrived and are persisted');
  check(A.sync.chipState().kind === 'synced' && A.store.meta.lastSyncOk, 'chip: synced');

  step('3. A sale offline: ✅ only after the adapter write resolves; ledger row and outbox entry in one transaction');
  net.offline = true;
  const painted = [];
  A.phone.on('change', e => painted.push(e));
  A.adapter.holdWrites = true;
  const pStart = A.phone.sim.start('S1-0002');
  await tick();
  check(painted.length === 0 && A.adapter.heldCount() === 1 && A.phone.lastText().indexOf('S1-0002') >= 0, 'the card exists in memory but the UI is not told while the write is held');
  A.adapter.release();
  await pStart;
  check(painted.length === 1 && painted[0].durable === true, 'after the write resolves the UI hears one durable change');
  const ledgerBefore = A.adapter.count('ledger'), txBefore = A.adapter.transactions.length;
  A.adapter.holdWrites = true;
  const pSale = A.phone.sim.tapLast('ရောင်း ၁');
  await tick();
  check(A.phone.lastText().indexOf('ရောင်းပြီး ၁ ထည်') >= 0 && painted.length === 1 && A.adapter.count('ledger') === ledgerBefore, 'the core wrote the sale in memory; nothing painted, nothing on disk yet');
  A.adapter.release();
  await pSale;
  const sale = lastLocal(A.phone);
  check(painted.length === 2 && painted[1].durable === true, 'the ✅ is painted once the transaction completed');
  const txn = A.adapter.transactions[A.adapter.transactions.length - 1];
  const stores = {};
  txn.ops.forEach(op => { stores[op.store] = true; });
  check(A.adapter.transactions.length === txBefore + 1 && stores.ledger && stores.outbox && stores.chat && stores.cache && stores.meta, 'one transaction carried the ledger row, the outbox entry, the chat card, the state and the meta', Object.keys(stores));
  check(A.adapter.data.ledger[sale.txId] && A.adapter.data.ledger[sale.txId].synced === 0 && A.adapter.count('outbox') === 1 && A.store.outbox[0].txs[0].txId === sale.txId, 'the row is on disk as unsynced and the outbox entry carries it');
  check(A.phone.stockOf('S1-0002') === 4 && sStock('S1-0002') === 5 && sale.receiptNo === 'R1-A-000001', 'local stock 4 (incremental map), server still 5, receipt R1-A-000001');
  check(!('synced' in A.store.outbox[0].txs[0]) && !('localSeq' in A.store.outbox[0].txs[0]), 'the outbox row carries no local bookkeeping fields');
  A.phone.online = false;                     // what navigator.onLine === false looks like to the app
  const soft = await A.sync.syncNow('test');
  check(!soft.ok && soft.error === 'offline' && A.store.outbox.length === 1 && A.sync.chipState().kind === 'waiting', 'syncNow while offline fails softly, keeps the outbox, chip says waiting');

  A.phone.online = true;                      // the browser says online, but the request itself fails
  const softNet = await A.sync.syncNow('test');
  check(!softNet.ok && softNet.error === 'network' && A.store.outbox.length === 1 && A.sync.chipState().kind === 'waiting', 'online per the browser but the request fails: network error, outbox kept, chip waiting', softNet.error);
  timers.queue.length = 0;

  step('4. The outbox is pushed on sync; results marked on disk');
  net.offline = false;
  const s4 = await A.sync.syncNow('test');
  check(s4.ok && s4.acked === 1 && A.store.outbox.length === 0 && A.adapter.count('outbox') === 0, 'one group acked, outbox empty in memory and on disk');
  check(rowsOf(sale.txId).length === 1 && rowsOf(sale.txId)[0].seq > 0 && rowsOf(sale.txId)[0].deviceId === A.store.meta.deviceId, 'the server has the row with the phone\'s TxID, a Seq and DeviceID');
  check(A.adapter.data.ledger[sale.txId].synced === 1 && A.adapter.data.ledger[sale.txId].seq === rowsOf(sale.txId)[0].seq, 'the local row is synced on disk with the server\'s Seq');
  check(A.sync.chipState().kind === 'synced' && A.store.meta.lastSyncOk && A.adapter.data.meta.meta.value.lastSyncOk === A.store.meta.lastSyncOk, 'chip synced; last success persisted');
  const again = await A.sync.syncNow('test');
  check(again.ok && again.pushed === 0 && world.ledger.filter(r => r.txId === sale.txId).length === 1, 'a second sync pushes nothing and the server keeps one copy');

  step('5. A row made through the Telegram route (world.ports) is pulled, stock updated incrementally');
  world.sim.start(brother, 'S2-0003');
  world.sim.tapLast(brother, 'ကုန်ရောက်');
  world.sim.tapLast(brother, '+၅');
  const tgRow = world.ledger[world.ledger.length - 1];
  const before5 = A.phone.stockOf('S2-0003');
  const s5 = await A.sync.syncNow('test');
  check(s5.ok && s5.pulled === 1 && A.store.local.hasRow(tgRow.txId) && A.adapter.data.ledger[tgRow.txId], 'the Telegram-route row arrived and is on disk');
  check(A.phone.stockOf('S2-0003') === before5 + 5 && A.phone.stockOf('S2-0003') === sStock('S2-0003'), 'stock map updated on the applied pull');
  check(A.store.ledger[A.store.ledger.length - 1].txId === tgRow.txId && A.store.ledger.every((r, i) => i === 0 || !r.synced || (A.store.ledger[i - 1].synced ? r.seq > A.store.ledger[i - 1].seq : true)), 'synced rows stay in Seq order');

  step('6. The stepper commits S|id|N; the UI helpers recognise cards and inputs');
  await A.phone.sim.start('S1-0002');
  const card = A.phone.sim.lastBot();
  const info = appCardInfo(card);
  check(info && info.sku && info.itemId === 'S1-0002' && info.sellData === 'S|S1-0002|1' && info.qtyData === 'Q|S1-0002', 'a SKU card is recognised by its S|id|1 and Q|id buttons');
  check(appStepperData('S1-0002', 3) === 'S|S1-0002|3' && appStepperData('S1-0002', 0) === 'S|S1-0002|1' && appStepperData('S1-0002', 5000) === 'S|S1-0002|999', 'stepper data is the core\'s own S|id|N, clamped to 1..999');
  const kbRest = appKeyboardForCard(card.keyboard, info);
  const flat = kbRest.reduce((a, r) => a.concat(r), []);
  check(flat.every(b => !/^S\|S1-0002|^Q\|S1-0002/.test(b.callback_data)) && flat.some(b => b.callback_data === 'D|S1-0002'), 'the remaining keyboard keeps discount/restock/return/transfer and drops the sell and 🔢 buttons');
  const stock6 = A.phone.stockOf('S1-0002');
  await A.phone.sim.tap(card.id, appStepperData('S1-0002', 3));
  const sale6 = lastLocal(A.phone);
  check(sale6.type === 'SALE' && sale6.qty === -3 && A.phone.lastText().indexOf('ရောင်းပြီး ၃ ထည်') >= 0 && A.phone.stockOf('S1-0002') === stock6 - 3, 'S|id|3 from the stepper sells three pieces');
  await A.phone.sim.start('S1-0001');
  const uniq = appCardInfo(A.phone.sim.lastBot());
  check(uniq && !uniq.sku && uniq.itemId === 'S1-0001', 'a UNIQUE card keeps its single Sold button (no stepper)');
  check(appInputModeFor({ kind: 'await_number', purpose: 'sale_price' }) === 'number' && appInputModeFor({ kind: 'find' }) === 'text' && appInputModeFor({ kind: 'new_item', step: 'photo' }) === 'photo' && appInputModeFor({ kind: 'new_item', step: 'price' }) === 'number' && appInputModeFor(null) === null, 'input mode: keypad for numbers, text for names and search, photo for a blank tag');
  check(appReportApiKind({ kind: 'month', fileName: 'monthly-' + monthKey(world.ports.clock.now()) }, world.ports.clock.now()) === 'month' && appReportApiKind({ kind: 'month', fileName: 'monthly-2020-01' }, world.ports.clock.now()) === 'last' && appReportApiKind({ kind: 'day' }, new Date()) === 'today', 'report kinds map to the api=report kinds');
  check(appItemIdFromText('👗 S1-0042 · ထမီ') === 'S1-0042' && appIsIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)') && !appIsIos('Mozilla/5.0 (Linux; Android 13)'), 'item id from a card text; iOS detection');
  await A.sync.syncNow('test');

  step('7. Clock offset learned at sync and applied to Day: a phone 40 minutes ahead past midnight');
  const now7 = world.ports.clock.now();
  const yangonDay = dayKey(now7);
  // 23:50 Yangon today = 17:20 UTC the same calendar date in Yangon terms
  const p = yangonDay.split('-').map(Number);
  world.nowOverride = new Date(Date.UTC(p[0], p[1] - 1, p[2], 17, 20, 0));
  const C = await makePhone('C clock', { clockErrorMs: 40 * 60000 });
  const mintedC = server.mintEnrollCode(sister, 'C phone');
  const enrC = await C.sync.enroll(mintedC.code);
  check(enrC.ok && Math.abs(C.store.meta.offsetMs + 40 * 60000) < 2000 && C.adapter.data.meta.meta.value.offsetMs === C.store.meta.offsetMs, 'enrollment measured the offset (-40 min) and persisted it');
  check(dayKey(C.phone.wallClock()) !== dayKey(world.ports.clock.now()) && dayKey(C.phone.now()) === dayKey(world.ports.clock.now()), 'the wall clock is already tomorrow; the corrected clock is still today');
  await C.phone.sim.start('S1-0003');
  await C.phone.sim.tapLast('ရောင်း ၁');
  const row7 = lastLocal(C.phone);
  check(row7.day === dayKey(world.ports.clock.now()) && row7.day !== dayKey(C.phone.wallClock()), 'the sale lands on the server\'s business day, not the phone\'s');
  check(C.phone.chatHas('⏰'), 'the phone was warned about its clock');
  world.nowOverride = null;
  const s7 = await C.sync.syncNow('test');
  check(s7.ok && Math.abs(C.store.meta.offsetMs + 40 * 60000) < 2000, 'every sync learns the offset again');

  step('8. Voice offline: queued with ⏳, no row; online: the job is sent, the proposal appears, confirm commits');
  net.offline = true;
  await A.phone.sim.start('S1-0002');
  const rows8 = A.store.ledger.length;
  await A.phone.sim.voice('ဒါ ၂ ထည် ရောင်းရတယ်');
  check(A.phone.chatHas(MSG.app_wait_server) && !A.phone.chatHas(MSG.ai_down) && A.store.queuedMedia().length === 1 && A.store.ledger.length === rows8, 'offline: ⏳ instead of ai_down, one queued job, no ledger row');
  check(A.adapter.data.media[A.store.queuedMedia()[0].id].status === 'queued' && A.sync.chipState().kind === 'waiting', 'the job is persisted as queued and counts in the chip');
  net.offline = false;
  const aiCalls = server.aiCalls;
  await A.sync.syncNow('test');
  const prop = A.phone.sim.lastBot();
  check(server.aiCalls === aiCalls + 1 && A.phone.sim.button(prop, MSG.btn_yes) && prop.text.indexOf('36,000') >= 0 && A.store.queuedMedia().length === 0, 'after sync the job was sent once and the proposal (2 x 18,000) is on screen');
  await A.phone.sim.tapLast(MSG.btn_yes);
  const row8 = lastLocal(A.phone);
  check(row8 && row8.type === 'SALE' && row8.amount === 36000 && row8.source === 'VOICE', 'confirming commits the voice sale locally');
  await A.sync.syncNow('test');

  step('9. Restart: a new phone over the same adapter finds everything, including a half-finished flow');
  await A.phone.sim.start('S1-0002');
  await A.phone.sim.tapLast(MSG.btn_discount);
  check(getState(A.ports, '1001') && getState(A.ports, '1001').purpose === 'sale_price', 'the core is waiting for a price');
  const A2 = await makePhone('A again', { adapter: A.adapter });
  check(A2.store.meta.deviceId === A.store.meta.deviceId && A2.store.meta.token === A.store.meta.token && A2.store.meta.receiptLetter === 'A', 'device and token survive the restart');
  check(A2.store.ledger.length === A.store.ledger.length && A2.store.chat.length === A.store.chat.length && A2.store.items.length === A.store.items.length && world.items.every(it => A2.phone.stockOf(it.id) === A.phone.stockOf(it.id)), 'ledger, chat, items and the stock map are rebuilt from disk');
  check(A2.ports.store.ledgerRows() === A2.ports.store.ledgerRows(), 'ledgerRows() returns the same array reference until a write');
  const st9 = getState(A2.ports, '1001');
  check(st9 && st9.purpose === 'sale_price' && st9.itemId === 'S1-0002', 'the persisted cache still holds the half-finished flow');
  await A2.phone.sim.text('15000');
  const row9 = lastLocal(A2.phone);
  check(row9 && row9.unitPrice === 15000 && A2.phone.lastText().indexOf('15,000') >= 0, 'typing the price after the restart completes the sale');
  check(A2.store.meta.receiptCounter === A.store.meta.receiptCounter + 1 && /^R1-A-00000\d$/.test(row9.receiptNo), 'the receipt counter continued (gap-free per phone)');
  await A2.sync.syncNow('test');

  step('10. Transport B: the outbox as a .json document, parsed back by core_sync and ingested by the server');
  net.offline = true;
  await A2.phone.sim.start('S1-0003'); await A2.phone.sim.tapLast('ရောင်း ၁');
  await A2.phone.sim.start('S1-0005'); await A2.phone.sim.tapLast('ရောင်း ၁');
  const doc = A2.sync.exportDocument();
  const parsed = syncParseDocument(doc.text);
  check(!parsed.error && parsed.doc.entries.length === 2 && parsed.doc.device === A2.store.meta.deviceId && parsed.doc.format === SYNC.DOC_FORMAT, 'the export parses back through syncParseDocument with both groups and the device id');
  check(/^salestag-outbox-S1-A-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(doc.name) && doc.rows === 2, 'file name carries shop, letter, day and time');
  const ing = server.ingestDocument(doc.text, sister);
  check(ing.ok && ing.counts.ok === 2 && A2.store.outbox.every(e => rowsOf(e.txs[0].txId).length === 1), 'the server ingests the document: both rows on the server');
  net.offline = false;
  const s10 = await A2.sync.syncNow('test');
  check(s10.ok && s10.acked === 2 && A2.store.outbox.length === 0 && A2.store.outbox.length === A2.adapter.count('outbox'), 'the later push answers dup for both and empties the outbox');

  step('11. The chip: synced, n waiting, not sent for h hours (export suggested after 4 h), red after 2 days');
  check(A2.sync.chipState().kind === 'synced', 'nothing pending: synced');
  net.offline = true;
  await A2.phone.sim.start('S1-0002'); await A2.phone.sim.tapLast('ရောင်း ၁');
  const at = A2.phone.now();
  const c1 = A2.sync.chipState(at);
  check(c1.kind === 'waiting' && c1.text.indexOf('၁') >= 0, 'one pending entry: ⏳ ၁ waiting');
  const c2 = A2.sync.chipState(new Date(at.getTime() + 2 * 3600000));
  check(c2.kind === 'stale' && c2.text.indexOf('၂') >= 0 && !c2.suggestExport, 'two hours: not sent for ၂ hours, no export suggestion yet');
  const c3 = A2.sync.chipState(new Date(at.getTime() + 5 * 3600000));
  check(c3.kind === 'stale' && c3.suggestExport, 'five hours: Transport B suggested');
  const c4 = A2.sync.chipState(new Date(at.getTime() + 3 * 86400000));
  check(c4.kind === 'red' && c4.text.indexOf('၃') >= 0, 'three days: red');
  const lines = A2.sync.pendingLines(5);
  check(lines.length === 1 && lines[0].kind === 'group' && lines[0].text.indexOf('ရောင်း') >= 0 && lines[0].text.indexOf('လုံချည်') >= 0, 'the pending list says what is waiting in words');

  step('12. Debounced sync after a commit; one request in flight');
  A2.sync.attach(null, null);
  timers.queue.length = 0;
  await A2.phone.sim.start('S1-0002'); await A2.phone.sim.tapLast('ရောင်း ၁');
  await A2.phone.sim.start('S1-0003'); await A2.phone.sim.tapLast('ရောင်း ၁');
  check(timers.queue.length === 1 && timers.queue[0].ms === APP_SYNC_DEBOUNCE_MS, 'two commits scheduled one debounced sync');
  net.offline = false;
  const pA = A2.sync.syncNow('a'), pB = A2.sync.syncNow('b');
  check(pA === pB && A2.sync.inFlight === pA, 'a second syncNow while one is in flight returns the same promise');
  const r12 = await pA;
  check(r12.ok && A2.store.outbox.length === 0, 'the in-flight sync pushed everything');
  timers.queue.length = 0;
  A2.sync.detach();

  step('13. Transport failure backs off; DRAIN keeps pushes, REVOKE wipes the phone');
  net.offline = true;
  A2.phone.online = true;
  const f1 = await A2.sync.syncNow('t');
  check(!f1.ok && A2.sync.failures === 1 && timers.queue.length === 1 && timers.queue[0].ms === APP_SYNC_BACKOFF_MS[0], 'a network failure schedules a retry after 5 s');
  timers.queue.length = 0;
  net.offline = false;
  server.deviceAction(A2.store.meta.deviceId, 'drain');
  await A2.phone.sim.start('S1-0005'); await A2.phone.sim.tapLast('ရောင်း ၁');
  const s13 = await A2.sync.syncNow('t');
  check(s13.ok && s13.acked === 1 && s13.drain && s13.pulled === 0 && A2.phone.chatHas(MSG.app_drain), 'DRAIN: the push is accepted, the pull refused, the phone told');
  server.deviceAction(A2.store.meta.deviceId, 'revoke');
  const serverRows = world.ledger.length;
  const s13b = await A2.sync.syncNow('t');
  check(!s13b.ok && s13b.error === 'revoked' && A2.store.meta.deviceId === null && A2.store.ledger.length === 0 && A2.store.items.length === 0, 'REVOKED: the phone wiped its memory');
  check(A2.adapter.count('items') === 0 && A2.adapter.count('ledger') === 0 && A2.adapter.count('meta') === 0 && A2.adapter.count('outbox') === 0 && A2.adapter.count('chat') === 0, 'and its adapter (every store cleared)');
  check(world.ledger.length === serverRows && A2.sync.chipState().kind === 'never', 'the server keeps its rows; the chip says not enrolled');

  step('14. fetch transport: POST text/plain to <url>?api=…, JSON back, network errors as transport failures');
  const calls = [];
  const fakeFetch = (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true,"version":1}') }); };
  const tr = appFetchTransport('https://script.google.com/macros/s/X/exec', fakeFetch);
  const r14 = await tr('ping', { clientTime: 'now' });
  check(r14.ok && r14.version === 1 && calls[0].url === 'https://script.google.com/macros/s/X/exec?api=ping' && calls[0].init.method === 'POST' && calls[0].init.headers['Content-Type'] === 'text/plain;charset=utf-8' && calls[0].init.redirect === 'follow' && JSON.parse(calls[0].init.body).clientTime === 'now', 'the request shape is what Apps Script expects (no preflight, redirect followed)');
  const r14b = await appFetchTransport('https://x/exec', () => Promise.reject(new TypeError('Failed to fetch')))('sync', {});
  check(!r14b.ok && r14b.transportFailure && r14b.error === 'network', 'a failed fetch is a transport failure (retried later, outbox kept)');
  const r14c = await appFetchTransport('https://x/exec', () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html>login</html>') }))('sync', {});
  check(!r14c.ok && r14c.transportFailure && r14c.error === 'bad_response', 'a non-JSON body (a login page) is a transport failure, never applied');
  const r14d = await appFetchTransport('', fakeFetch)('ping', {});
  check(!r14d.ok && r14d.error === 'config', 'no API URL: a config error, not a network error');

  await round4();
  await round5();
  await round6();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

/* ============================== round 4, step 4 (SPEC-round-4.md 9.1 to 9.3, section 12) ============================== */

/**
 * A minimal IndexedDB for createIdbAdapter: open with onupgradeneeded (oldVersion), objectStoreNames.contains,
 * createObjectStore(+createIndex), transaction(names).objectStore(n).getAll/put/delete/clear, oncomplete fired after
 * the ops. Records the stores each upgrade created. Values are JSON-cloned like structured clone would for plain data.
 */
function fakeIndexedDB() {
  const dbs = {};
  const clone = v => JSON.parse(JSON.stringify(v));
  function handle(db) {
    return {
      objectStoreNames: { contains: n => !!db.stores[n] },
      createObjectStore(n, o) { db.created.push(n); db.stores[n] = { keyPath: o.keyPath, rows: new Map(), indexes: [] }; return { createIndex: ix => db.stores[n].indexes.push(ix) }; },
      transaction(names) {
        [].concat(names).forEach(n => { if (!db.stores[n]) throw new Error('NotFoundError: ' + n); });
        const tx = {
          oncomplete: null, onerror: null, onabort: null, abort() {},
          objectStore(n) {
            const s = db.stores[n];
            return {
              getAll() { const r = {}; setTimeout(() => { r.result = [...s.rows.values()].map(clone); if (r.onsuccess) r.onsuccess(); }, 0); return r; },
              put(v) { s.rows.set(String(v[s.keyPath]), clone(v)); },
              delete(k) { s.rows.delete(String(k)); },
              clear() { s.rows.clear(); }
            };
          }
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
        return tx;
      },
      close() {}
    };
  }
  return {
    dbs,
    open(name, version) {
      const req = {};
      setTimeout(() => {
        const db = dbs[name] || (dbs[name] = { version: 0, stores: {}, created: [] });
        req.result = handle(db);
        if (version > db.version) {
          const old = db.version;
          db.version = version;
          db.created = [];
          if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion: old, newVersion: version });
        }
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }
  };
}

async function round4() {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const flat = m => ((m && m.keyboard) || []).reduce((a, r) => a.concat(r.map(b => b.callback_data)), []);
  const datas = m => ((m && m.keyboard) || []).map(r => r.map(b => b.callback_data));
  const today = () => dayKey(world.ports.clock.now());
  const C1 = world.customers.filter(c => c.name === 'ဒေါ်မြင့်')[0].id, C2 = world.customers.filter(c => c.name === 'ဒေါ်ခင်')[0].id;
  const serverSessions = cid => world.measurements.filter(m => m.customerId === cid);
  // Pieces on the shelf for the sales below (the earlier steps sold most of them): restocked in Telegram.
  ['S1-0002', 'S1-0002', 'S1-0003', 'S1-0005'].forEach(id => { world.sim.start(sister, id); world.sim.tapLast(sister, 'ကုန်ရောက်'); world.sim.tapLast(sister, '+၅'); });

  step('15. DB version 2: the measurements store in APP_STORES, load() and wipe(); a version-1 phone upgrades and keeps its data');
  check(APP_DB_VERSION === 2 && appStoreDef('measurements') && appStoreDef('measurements').keyPath === 'customerId' && APP_STORES[APP_STORES.length - 1].name === 'measurements',
    'APP_DB_VERSION 2 and {name: measurements, keyPath: customerId} in APP_STORES');
  const mem = createMemoryAdapter();
  check(mem.data.measurements && mem.count('measurements') === 0 && appFreshMeta().cursor.measAfter === 0, 'the memory adapter has the store; a fresh cursor starts with measAfter 0');
  // A version-1 database: every store of v1, an unsynced sale with its outbox entry, a setting, a cursor without measAfter.
  const fidb = fakeIndexedDB();
  const v1 = fidb.dbs.salestag = { version: 1, stores: {}, created: [] };
  APP_STORES.filter(s => s.name !== 'measurements').forEach(s => { v1.stores[s.name] = { keyPath: s.keyPath, rows: new Map(), indexes: s.indexes || [] }; });
  const v1put = (st, v) => v1.stores[st].rows.set(String(v[v1.stores[st].keyPath]), v);
  const v1tx = { txId: 'tx-v1', groupId: 'g-v1', day: '2026-11-01', time: '2026-11-01T04:00:00.000Z', shop: 'S1', type: 'SALE', itemId: 'S1-0002', qty: -1, unitPrice: 18000, amount: 18000, cash: 18000, method: 'CASH', staffId: '1001', source: 'BUTTON', seq: '' };
  v1put('meta', { key: 'meta', value: Object.assign(appFreshMeta(), { deviceId: 'dev-v1', token: 'x'.repeat(64), staff: { id: '1001', name: 'Sister (S1)', shop: 'S1', role: 'staff' }, receiptLetter: 'Z',
    cursor: { ledgerSeq: 7, masterRev: 2, settingsHash: 'sh', messagesHash: 'mh' }, nextLocalSeq: 9 }) });
  v1put('ledger', Object.assign({}, v1tx, { synced: 0, localSeq: 7 }));
  v1put('outbox', { entryId: 'e-v1', kind: 'group', groupId: 'g-v1', txs: [v1tx], at: '2026-11-01T04:00:01.000Z', localSeq: 8 });
  v1put('settings', { key: 'shop_name_S1', value: 'ဆိုင် ၁ (v1)' });
  const V = createAppPhone({ adapter: createIdbAdapter({ indexedDB: fidb }), name: 'v1 phone', transport, clock: () => world.ports.clock.now(), platform: 'android' });
  await V.load();
  check(v1.version === 2 && same(v1.created, ['measurements']) && Object.keys(v1.stores).length === APP_STORES.length, 'the upgrade to v2 created only the missing measurements store', v1.created);
  check(V.store.outbox.length === 1 && V.store.outbox[0].entryId === 'e-v1' && V.store.ledger.length === 1 && V.store.ledger[0].txId === 'tx-v1' && !V.store.ledger[0].synced &&
    V.store.settings.shop_name_S1 === 'ဆိုင် ၁ (v1)' && V.store.meta.deviceId === 'dev-v1' && V.stockOf('S1-0002') === -1, 'its outbox, unsynced ledger row, settings and device survive the upgrade');
  const v1meta = v1.stores.meta.rows.get('meta').value;
  check(V.store.meta.cursor.measAfter === 0 && v1meta.cursor.measAfter === 0 && v1meta.cursor.ledgerSeq === 7 && v1meta.cursor.settingsHash === 'sh',
    'the old cursor gets measAfter 0 at load, in memory and on disk, and keeps its other fields', v1meta.cursor);
  V.store.local.saveMeasurementLocal({ customerId: C1, fields: { neck: '14' } });
  await V.commit('t');
  check(v1.stores.measurements.rows.get(C1) && v1.stores.measurements.rows.get(C1).pending === true && v1.stores.outbox.rows.size === 2, 'a session saved after the upgrade lands in the new store and the outbox');
  const V2 = createAppPhone({ adapter: createIdbAdapter({ indexedDB: fidb }), name: 'v1 again', transport, clock: () => world.ports.clock.now(), platform: 'android' });
  await V2.load();
  check(same(v1.created, ['measurements']) && V2.store.measurements[C1] && V2.store.measurements[C1].fields.neck === '14' && latestMeasurement(V2.ports, C1).pending === true,
    'a second open at v2 upgrades nothing and load() brings the measurement record back');
  await V2.store.wipe();
  check(Object.keys(V2.store.measurements).length === 0 && Object.keys(v1.stores).every(n => v1.stores[n].rows.size === 0), 'wipe() empties the measurements store with every other store');

  step('16. A fresh phone: bootstrap, then ONE scheduled sync (scheduleSync(0)) pages the server\'s sessions in');
  const early = world.ports.store.addMeasurement({ customerId: C1, orderId: '', day: '2026-10-01', staffId: '1000', source: 'CHAT', photoUrl: '', notes: 'Telegram',
    fields: { neck: '13', sleeve_round: '36/30/20', htamein_side: 'ဘယ်', bust: '' } });
  world.ports.store.addMeasurement({ customerId: C2, orderId: '', day: '2026-10-02', staffId: '1000', source: 'CHAT', photoUrl: '', notes: '', fields: { waist: '26' } });
  timers.queue.length = 0;
  const P = await makePhone('P round4');
  const enrP = await P.sync.enroll(server.mintEnrollCode(sister, 'P phone').code);
  check(enrP.ok && enrP.bootstrapResult && enrP.bootstrapResult.ok && timers.queue.length === 1 && timers.queue[0].ms === 0 && Object.keys(P.store.measurements).length === 0,
    'the bootstrap brought no sessions and scheduled one sync at once (0 ms)', timers.queue.map(h => h.ms));
  await timers.fire();
  await P.sync.inFlight;
  check(P.store.measurements[C1] && P.store.measurements[C1].id === early.id && !P.store.measurements[C1].pending && same(P.store.measurements[C1].fields, { neck: '13', sleeve_round: '36/30/20', htamein_side: 'ဘယ်' }) &&
    P.store.meta.cursor.measAfter === syncMeasNo(serverSessions(C2)[0].id) && P.adapter.data.measurements[C1] && P.adapter.data.meta.meta.value.cursor.measAfter === P.store.meta.cursor.measAfter,
    'after that sync the sessions are on the phone and on disk (blank fields left out), measAfter advanced and persisted', P.store.meta.cursor);
  check(same(P.ports.store.listMeasurements(C1).map(m => m.id), [early.id]) && same(P.ports.store.listMeasurements('C-nobody'), []) && latestMeasurement(P.ports, C1).id === early.id &&
    latestMeasurement(P.ports, C2).id === serverSessions(C2)[0].id && latestMeasurement(P.ports, 'C-nobody') === null, 'listMeasurements gives [record] or [] and feeds latestMeasurement');
  P.ports.store.listMeasurements(C1)[0].fields.neck = '99';
  check(P.store.measurements[C1].fields.neck === '13' && !('listOptions' in P.ports.store) && typeof P.ports.store.addListOption === 'function', 'listMeasurements returns a copy; the store port has addListOption and no listOptions');

  step('17. measureFields reads the store, then Settings meas_fields_json (the phone), then CFG');
  world.settings.meas_fields_json = '[{"key":"typed","labelMy":"typed"}]';
  check(measureFields(world.ports, false).length === world.measureFields.length && measureFields(world.ports, false)[0].key === 'neck', 'a store with listMeasureFields wins over any Settings row (the Telegram bot: nothing changes)');
  delete world.settings.meas_fields_json;
  check(typeof P.store.settings.meas_fields_json === 'string' && JSON.parse(P.store.settings.meas_fields_json).length === CFG.MEASURE_FIELDS.length && !P.ports.store.listMeasureFields &&
    same(measureFields(P.ports, true).map(f => f.key), measureFields(world.ports, true).map(f => f.key)), 'the phone reads the MeasureFields rows from meas_fields_json');
  const savedFields = JSON.parse(JSON.stringify(world.measureFields));
  world.measureFields[0].labelMy = 'လည်ပင်း (ပြင်)';
  world.measureFields[1].active = false;
  await P.sync.syncNow('t');
  check(measureFields(P.ports, true)[0].labelMy === 'လည်ပင်း (ပြင်)' && measureFields(P.ports, true).length === CFG.MEASURE_FIELDS.length - 1 &&
    appMeasModel(P.ports, P.store, { customerId: C1, orderId: '', staff: P.store.meta.staff }).fields.length === CFG.MEASURE_FIELDS.length - 1,
    'a renamed and a hidden field in the tab reach the phone\'s form at its next sync');
  world.measureFields = savedFields;
  await P.sync.syncNow('t');
  const mfj = P.store.settings.meas_fields_json;
  P.store.settings.meas_fields_json = 'not json';
  const fromCfg1 = measureFields(P.ports, false);
  P.store.settings.meas_fields_json = '[]';
  const fromCfg2 = measureFields(P.ports, false);
  P.store.settings.meas_fields_json = '[{"labelMy":"no key"}]';
  const fromCfg3 = measureFields(P.ports, false);
  P.store.settings.meas_fields_json = mfj;
  check([fromCfg1, fromCfg2, fromCfg3].every(l => l.length === CFG.MEASURE_FIELDS.length && l[0].labelMy === CFG.MEASURE_FIELDS[0][1]) && measureFields(P.ports, false)[0].labelMy === world.measureFields[0].labelMy,
    'an unreadable value, an empty array or rows without a key fall back to CFG.MEASURE_FIELDS');

  step('18. The local measurement record: upsertMeasurement, saveMeasurementLocal, measurementSynced, measurementRejected');
  const R = await makePhone('rules');
  const L = R.store.local, rec = cid => R.store.measurements[cid];
  L.upsertMeasurement({ id: 'M-00005', n: 5, customerId: 'C-x', orderId: '', day: '2026-10-01', notes: 'a', fields: { neck: '1' } });
  L.upsertMeasurement({ id: 'M-00003', n: 3, customerId: 'C-x', day: '2026-09-01', notes: 'old', fields: { neck: '0' } });
  L.upsertMeasurement({ id: 'M-00005', n: 5, customerId: 'C-x', day: '2026-10-01', notes: 'same n', fields: { neck: '5' } });
  check(rec('C-x').id === 'M-00005' && rec('C-x').fields.neck === '1' && rec('C-x').pending === false && rec('C-x').notes === 'a', 'a session with a lower or equal n does not replace the record');
  L.upsertMeasurement({ id: 'M-00009', customerId: 'C-x', day: '2026-10-09', notes: '', fields: { neck: '9' } });
  check(rec('C-x').n === 9 && rec('C-x').fields.neck === '9', 'a higher n wins; without n the number comes from the id (syncMeasNo)');
  L.upsertMeasurement({ id: 'M-00010', n: 10, day: '2026-10-10', fields: { neck: '7' } });
  check(!rec('') && !rec('undefined'), 'a session without a customer is ignored');
  const saved18 = L.saveMeasurementLocal({ customerId: 'C-x', fields: { neck: '10' } });
  L.upsertMeasurement({ id: 'M-00020', n: 20, customerId: 'C-x', day: '2026-10-20', notes: '', fields: { neck: '20' } });
  check(saved18.pending && rec('C-x').pending && rec('C-x').fields.neck === '10' && rec('C-x').id === '' && rec('C-x').n === 0, 'a pending local record is kept over any pulled session');
  await R.phone.commit('t');
  check(R.adapter.data.measurements['C-x'] && R.adapter.data.measurements['C-x'].pending === true && R.adapter.data.measurements['C-x'].fields.neck === '10', 'the record is persisted in the measurements store');
  L.saveMeasurementLocal({ customerId: 'C-y', fields: { neck: '1' } });
  L.saveMeasurementLocal({ customerId: 'C-y', fields: { neck: '2' } });
  const ys = R.store.outbox.filter(e => e.kind === 'measurement' && e.rec.customerId === 'C-y');
  L.removeEntry(ys[0].entryId);
  L.measurementSynced('C-y', 'M-00030');
  check(rec('C-y').pending && rec('C-y').id === '' && rec('C-y').fields.neck === '2', 'measurementSynced while another save of the customer is in the outbox: still pending');
  L.removeEntry(ys[1].entryId);
  L.measurementSynced('C-y', 'M-00031');
  check(!rec('C-y').pending && rec('C-y').id === 'M-00031' && rec('C-y').n === 31, 'the last acknowledgement: the record takes the id and its number');
  L.saveMeasurementLocal({ customerId: 'C-z', fields: { neck: '3' } });
  L.saveMeasurementLocal({ customerId: 'C-z', fields: { neck: '4' } });
  R.store.meta.cursor.measAfter = 40;
  const zs = R.store.outbox.filter(e => e.kind === 'measurement' && e.rec.customerId === 'C-z');
  L.removeEntry(zs[0].entryId);
  L.measurementRejected('C-z');
  check(rec('C-z') && R.store.meta.cursor.measAfter === 40, 'measurementRejected while another save is in the outbox: nothing changes');
  L.removeEntry(zs[1].entryId);
  const cursorObj = L.getCursor();
  L.measurementRejected('C-z');
  await R.phone.commit('t');
  check(!rec('C-z') && cursorObj.measAfter === 0 && L.getCursor() === cursorObj && !R.adapter.data.measurements['C-z'] && R.adapter.data.meta.meta.value.cursor.measAfter === 0,
    'the last one rejected: the record is deleted (also on disk) and measAfter is 0 on the object getCursor() returns');

  step('19. The hooks on the real app store: menu, customer card, M|meas, MS|new + a typed name, MS|create, MS|<customerId>');
  const forms = [];
  P.phone.on('measureform', req => forms.push(req));
  const errs19 = P.store.errors.length;
  check(!ordersEnabled(P.ports) && measureFormEnabled(P.ports) && measureEnabled(P.ports) && typeof P.ports.ui.measureForm === 'function', 'the app: no order module, the form hook (ports.ui.measureForm)');
  await P.phone.sim.start('');
  let m = P.phone.sim.lastBot();
  check(m.keyboard.slice(0, 3).every(r => r.length === 3) && m.keyboard[3][0].callback_data === 'M|meas' && m.keyboard[3][0].text === MSG.btn_measure && flat(m).indexOf('M|ord') < 0 && flat(m).indexOf('M|acct') >= 0,
    'the menu\'s fourth row starts with 📏 = M|meas (no orders button), the accounts button stays', datas(m));
  await P.phone.sim.tapLast(MSG.btn_customers);
  const screens19 = [], chat19 = P.store.chat.length;
  P.phone.on('openscreen', e => screens19.push(e));
  await P.phone.sim.tap(P.phone.sim.lastBot().id, 'CH|' + C1);
  const custCard = P.phone.sim.lastBot();
  check(screens19.length === 1 && screens19[0].name === 'buyer' && screens19[0].req.customerId === C1 && P.store.chat.length === chat19 && measureEnabled(P.ports),
    'the CH| tap in the app emits one openscreen request for the buyer page (C1) and sends no message; the buyer page offers 📏 (measureEnabled)', screens19);
  await P.phone.sim.tap(custCard.id, 'MS|' + C1);
  check(forms.length === 1 && same(Object.keys(forms[0]).sort(), ['chatId', 'customerId', 'orderId', 'staff', 'uid']) && forms[0].customerId === C1 && forms[0].orderId === '' && forms[0].uid === '1001' &&
    forms[0].staff.id === '1001' && P.phone.sim.lastBot().id === custCard.id && getState(P.ports, '1001') === null && !Object.keys(P.store.S.cacheData).some(k => /^ms:/.test(k)),
    'MS|<customerId>: one measureForm call {chatId, uid, customerId, orderId: \'\', staff}; no message, no state, no Telegram measurement token', forms[0]);
  await P.phone.sim.start('');
  await P.phone.sim.tapLast(MSG.btn_measure);
  const pick = P.phone.sim.lastBot();
  check(pick.text === MSG.credit_ask_customer && flat(pick).indexOf('MS|new') >= 0 && flat(pick).indexOf('Z') >= 0 && flat(pick).some(d => /^MS\|C-/.test(d)) && same(getState(P.ports, '1001'), { kind: 'meas_pick' }) &&
    appInputModeFor(getState(P.ports, '1001')) === 'text', 'M|meas: who is measured (recent customers, a new name, cancel); the app shows the text bar', datas(pick));
  await P.phone.sim.tap(pick.id, 'MS|' + C2);
  check(forms.length === 2 && forms[1].customerId === C2 && getState(P.ports, '1001') === null, 'a recent customer\'s button opens the form for that customer');
  await P.phone.sim.start('');
  await P.phone.sim.tapLast(MSG.btn_measure);
  await P.phone.sim.tapLast(MSG.btn_new_customer);
  check(P.phone.lastText() === MSG.ask_name && same(getState(P.ports, '1001'), { kind: 'meas_pick', step: 'name' }) && appInputModeFor(getState(P.ports, '1001')) === 'text', 'MS|new asks the name; the text bar stays');
  await P.phone.sim.text('ဒေါ်နီနီ');
  const nini = P.store.customers.filter(c => c.name === 'ဒေါ်နီနီ')[0];
  check(forms.length === 3 && nini && forms[2].customerId === nini.id && P.store.outbox.some(e => e.kind === 'customer' && e.rec.id === nini.id) && getState(P.ports, '1001') === null,
    'MS|new with a typed name nobody has: the customer is created (and queued) and the form opens for them');
  await P.phone.sim.start('');
  await P.phone.sim.tapLast(MSG.btn_measure);
  await P.phone.sim.tapLast(MSG.btn_new_customer);
  await P.phone.sim.text('မြင့်');
  const chooser = P.phone.sim.lastBot();
  check(forms.length === 3 && chooser.text === t(P.ports, 'cust_pick', { name: 'မြင့်' }) && flat(chooser).indexOf('MS|' + C1) >= 0 && flat(chooser).indexOf('MS|create') >= 0, 'a name like an existing one: the look-alike and "create" are offered', datas(chooser));
  await P.phone.sim.tap(chooser.id, 'MS|create');
  const myint2 = P.store.customers.filter(c => c.name === 'မြင့်')[0];
  check(forms.length === 4 && myint2 && forms[3].customerId === myint2.id && myint2.id !== C1, 'MS|create: a new customer of that name, and the form for them');
  // A spoken name while the customer is asked for (handleIntent's transcript section): queued, replayed at the sync.
  await P.phone.sim.start('');
  await P.phone.sim.tapLast(MSG.btn_measure);
  await P.phone.sim.voice('ဒေါ်ခင်');
  await P.sync.syncNow('t');
  check(forms.length === 5 && forms[4].customerId === C2, 'a voice note naming the customer, replayed after the sync: the form opens for that customer',
    forms.slice(4).map(f => [f.customerId, (P.ports.store.getCustomer(f.customerId) || {}).name]));
  const pVoice = P.store.media.filter(x => x.kind === 'voice').slice(-1)[0];
  const aiKeys = Object.keys(server.aiJobs);
  check(pVoice && pVoice.id === 'voice_1' && /^j-[0-9a-f]{16}$/.test(pVoice.jobId) && server.aiJobs[pVoice.jobId] && server.aiJobs[pVoice.jobId].deviceId === P.store.meta.deviceId &&
    aiKeys.length >= 2 && aiKeys.every(k => /^j-[0-9a-f]{16}$/.test(k)) && aiKeys.some(k => server.aiJobs[k].deviceId !== P.store.meta.deviceId),
    'AI jobs go out under their own unique ids: this phone\'s first voice note (media voice_1, as on phone A) never gets phone A\'s cached result', aiKeys);
  await P.phone.sim.start('');
  const menu19 = P.phone.sim.lastBot();
  await P.phone.sim.tap(menu19.id, 'MS|V1-2532');
  const exp1 = P.phone.lastText();
  await P.phone.sim.tap(menu19.id, 'MM|abcdef|copy');
  const exp2 = menu19.text;
  check(forms.length === 5 && exp1 === MSG.expired && exp2 === MSG.expired, 'MS|<orderId> (needs the order module) and every other measurement action answer expired; no form', [exp1, exp2]);
  // (A queued voice note leaves its local PendingAi line, as before round 4; it is never sent to the server.)
  const errs19b = P.store.errors.slice(errs19).filter(e => !/^PendingAi/.test(e.message));
  check(errs19b.length === 0 && !P.store.outbox.some(e => e.kind === 'error'), 'no error was logged on the way', errs19b);

  step('20. The form\'s logic: boxes joined and split, the voucher id, the side toggle, the pre-fill, the draft');
  check(appMeasJoin(['36', '30', '20']) === '36/30/20' && appMeasJoin(['36', '', '20']) === '36//20' && appMeasJoin(['36', '', '']) === '36' && appMeasJoin(['', '30', '']) === '/30' &&
    appMeasJoin(['', '', '']) === '' && appMeasJoin([' 36 ', '30 ']) === '36/30', 'join: "/" between the boxes, trailing empty boxes dropped, an empty middle box kept as an empty position');
  check(same(appMeasSplit('36/30/20', 3), ['36', '30', '20']) && same(appMeasSplit('36', 3), ['36', '', '']) && same(appMeasSplit('36//20', 3), ['36', '', '20']) && same(appMeasSplit('', 3), ['', '', '']) &&
    same(appMeasSplit('1/2/3/4', 3), ['1', '2', '3/4']) && same(appMeasSplit('17.5', 1), ['17.5']), 'split fills the boxes back (an extra part stays in the last box)');
  check([['36/30/20', 3], ['36//20', 3], ['/30', 3], ['7/3', 3]].every(([v, n]) => appMeasJoin(appMeasSplit(v, n)) === v), 'split then join gives the stored value back');
  check(same(appMeasVoucher('2532', 'S1'), { id: 'V1-2532', bad: false }) && appMeasVoucher('25', 'S2').id === 'V2-0025' && appMeasVoucher('၂၅၃၂', 'S1').id === 'V1-2532' &&
    same(appMeasVoucher(' v1-2532 ', 'S2'), { id: 'V1-2532', bad: false }) && same(appMeasVoucher('', 'S1'), { id: '', bad: false }) && appMeasVoucher('abc', 'S1').bad &&
    appMeasVoucher('0', 'S1').bad && appMeasVoucher('123456789', 'S1').bad && appMeasVoucher('V1-', 'S1').bad, 'voucher: digits become the shop\'s id (Burmese digits too), an id is kept, anything else is bad');
  check(appMeasSide(P.ports, MSG.btn_left) === 'L' && appMeasSide(P.ports, MSG.btn_right) === 'R' && appMeasSide(P.ports, '') === '' && appMeasSide(P.ports, 'အလယ်') === 'text', 'the htamein_side toggle: left, right, nothing, or a stored value shown as text');
  const fieldsAll = measureFields(P.ports, true);
  check(appMeasFormFields(fieldsAll.concat([{ key: 'neck size', group: 'general', multi: 1, type: 'number', active: true }, { key: 'လည်ပင်း', group: 'general', multi: 1, type: 'number', active: true }])).length === fieldsAll.length &&
    appMeasFormFields(new Array(90).fill(0).map((x, i) => ({ key: 'f' + i }))).length === 80, 'the form leaves out a field whose key the server would refuse, and shows at most 80');
  const req20 = { chatId: 1001, uid: '1001', customerId: C1, orderId: '', staff: P.store.meta.staff };
  let model = appMeasModel(P.ports, P.store, req20);
  check(model.prev && model.prev.id === early.id && same(model.values, { neck: '13', sleeve_round: '36/30/20', htamein_side: 'ဘယ်' }) && !model.restored && model.notes === '' && model.voucher === '' &&
    model.customer === 'ဒေါ်မြင့်' && model.shop === 'S1', 'the form opens pre-filled from latestMeasurement (the newest session), notes empty', model.values);
  check(appMeasModel(P.ports, P.store, { customerId: C1, orderId: 'V1-0042', staff: P.store.meta.staff }).voucher === 'V1-0042' && appMeasModel(P.ports, P.store, { customerId: nini.id, staff: P.store.meta.staff }).prev === null &&
    same(appMeasModel(P.ports, P.store, { customerId: nini.id, staff: P.store.meta.staff }).values, {}), 'a request\'s order id starts the voucher; a customer without a session starts empty');
  appMeasDraftWrite(P.store, C1, { values: { neck: '14', sleeve_round: '36//20' }, notes: 'ပထမ', voucher: '25' });
  await P.phone.commit('measdraft');
  const draftDisk = P.adapter.data.cache[appMeasDraftKey(C1)];
  check(draftDisk && JSON.parse(draftDisk.v).values.neck === '14' && Math.abs(draftDisk.exp - (P.phone.now().getTime() + 86400000)) < 5000, 'every change is kept in the persisted cache as measdraft:<customerId> for one day');
  const P2 = await makePhone('P restart', { adapter: P.adapter });
  const restored = appMeasModel(P2.ports, P2.store, req20);
  check(restored.restored && same(restored.values, { neck: '14', sleeve_round: '36//20' }) && restored.notes === 'ပထမ' && restored.voucher === '25' && restored.prev.id === early.id,
    'the draft survives a restart and wins over the pre-fill when the form opens again for that customer');
  check(appMeasModel(P.ports, P.store, { customerId: C2, staff: P.store.meta.staff }).restored === false, 'a draft belongs to its customer only');
  P.store.cachePut(appMeasDraftKey(C2), '{broken', 60);
  check(appMeasDraftRead(P.store, C2) === null && appMeasModel(P.ports, P.store, { customerId: C2, staff: P.store.meta.staff }).restored === false, 'an unreadable draft is ignored');
  P.store.cacheRemove(appMeasDraftKey(C2));

  step('21. Save: normMeasValue, the empty refusal, saveMeasurementLocal, the outbox entry, the server row, measurementSynced');
  const out21 = P.store.outbox.length;
  check(same(appMeasSave(P.phone, req20, { values: {}, notes: 'x', voucher: '' }), { ok: false, reason: 'empty' }) && same(appMeasSave(P.phone, req20, { values: { neck: '  ', bust: '' }, notes: '', voucher: '25' }), { ok: false, reason: 'empty' }) &&
    P.store.outbox.length === out21 && P.store.measurements[C1].id === early.id && P.store.cacheGet(appMeasDraftKey(C1)), 'nothing filled in: refused (ui_meas_empty), nothing queued, the draft kept');
  const bots21 = P.store.chat.filter(x => x.from === 'bot').length;
  const r21 = appMeasSave(P.phone, req20, { values: { neck: '၁၄.၅', sleeve_round: appMeasJoin(['36', '', '20']), sleeve_length: appMeasJoin(['7', '3', '']), htamein_side: MSG.btn_right, not_a_field: '5', hip: '' },
    notes: ' ပထမ ', voucher: '2532' });
  const e21 = P.store.outbox[P.store.outbox.length - 1];
  const fields21 = { neck: '14.5', sleeve_round: '36//20', sleeve_length: '7/3', htamein_side: MSG.btn_right };
  check(r21.ok && r21.n === 4 && r21.orderId === 'V1-2532' && !r21.badVoucher && r21.record.pending && same(P.store.measurements[C1].fields, fields21) && latestMeasurement(P.ports, C1).pending,
    'saved: Burmese digits normalised, the boxes joined, an unknown key and empty values left out; the newest record at once, pending', P.store.measurements[C1]);
  check(P.store.outbox.length === out21 + 1 && e21.kind === 'measurement' && same(e21.rec, { customerId: C1, orderId: 'V1-2532', day: today(), staffId: '1001', source: 'FORM', notes: 'ပထမ', fields: fields21 }),
    'one {kind: measurement} entry: customer, the voucher id, the day, the enrolled staff, source FORM, notes, the values as text', e21.rec);
  check(P.phone.sim.lastBot().text === t(P.ports, 'meas_saved_form', { customer: 'ဒေါ်မြင့်', n: '၄' }) && P.store.chat.filter(x => x.from === 'bot').length === bots21 + 1 && !P.store.cacheGet(appMeasDraftKey(C1)),
    'the bot line meas_saved_form ("📏 ဒေါ်မြင့် · အတိုင်းအတာ ၄ ခု သိမ်းပြီး") is the last message; the draft is removed', P.phone.lastText());
  check(P.sync.pendingLines().some(l => l.kind === 'measurement' && l.text === t(P.ports, 'ui_pending_meas', { customer: 'ဒေါ်မြင့်' })), 'the sync screen lists it: "📏 အတိုင်းအတာ · ဒေါ်မြင့်"');
  timers.queue.length = 0;
  const ok21 = await appMeasCommit(P.phone, P.sync);
  check(ok21 === true && P.adapter.data.measurements[C1].pending === true && P.adapter.data.outbox[e21.entryId] && !P.adapter.data.cache[appMeasDraftKey(C1)] && timers.queue.length === 1 && timers.queue[0].ms === APP_SYNC_DEBOUNCE_MS,
    'phone.commit(\'meas\') made it durable (record, entry, draft gone), then APP.sync.scheduleSync()');
  timers.queue.length = 0;
  const n21 = world.measurements.length;
  const s21 = await P.sync.syncNow('t');
  const row21 = world.measurements[world.measurements.length - 1];
  check(s21.ok && world.measurements.length === n21 + 1 && row21.customerId === C1 && row21.source === 'FORM' && row21.staffId === '1001' && row21.day === today() && row21.orderId === '' && row21.notes === 'ပထမ' &&
    row21.fields.sleeve_round === '36//20' && row21.fields.htamein_side === MSG.btn_right, 'the server stored the session (the voucher is no order of this customer, so orderId is blank there)', row21);
  check(!P.store.measurements[C1].pending && P.store.measurements[C1].id === row21.id && P.store.measurements[C1].n === syncMeasNo(row21.id) && !P.store.outbox.some(e => e.kind === 'measurement') &&
    P.adapter.data.measurements[C1].id === row21.id, 'measurementSynced: the record takes the server\'s id and number, no longer pending, on disk too');
  const r21b = appMeasSave(P.phone, { customerId: C2, orderId: '', staff: P.store.meta.staff }, { values: { waist: '27' }, notes: '', voucher: 'abc' });
  check(r21b.ok && r21b.badVoucher && r21b.orderId === '' && P.store.outbox[P.store.outbox.length - 1].rec.orderId === '', 'a bad voucher is dropped before saving (orderId \'\'), the session is saved');
  await appMeasCommit(P.phone, null);
  await P.sync.syncNow('t');
  check(P.store.measurements[C2].id === serverSessions(C2).slice(-1)[0].id && serverSessions(C2).slice(-1)[0].fields.waist === '27', 'and it reaches the server like the first');

  step('22. A quarantined measurement leaves no pending record; the earlier server session is back after the next sync');
  const fwd22 = server.ports.store.addMeasurement;
  delete server.ports.store.addMeasurement;
  appMeasSave(P.phone, req20, { values: { neck: '15' }, notes: '', voucher: '' });
  check(latestMeasurement(P.ports, C1).fields.neck === '15' && P.store.measurements[C1].pending, 'the session shows at once');
  const s22 = await P.sync.syncNow('t');
  server.ports.store.addMeasurement = fwd22;
  check(s22.ok && s22.quarantined.length === 1 && s22.quarantined[0].reason === 'bad_kind' && !P.store.measurements[C1] && latestMeasurement(P.ports, C1) === null && !P.adapter.data.measurements[C1] &&
    P.store.meta.cursor.measAfter === 0 && !P.store.outbox.some(e => e.kind === 'measurement') && P.phone.chatHas('❌'), 'quarantined: no record left (memory and disk), measAfter 0, the phone says why', P.store.meta.cursor);
  await P.sync.syncNow('t');
  check(latestMeasurement(P.ports, C1) && latestMeasurement(P.ports, C1).id === row21.id && !P.store.measurements[C1].pending && P.store.meta.cursor.measAfter === Math.max.apply(null, world.measurements.map(x => syncMeasNo(x.id))),
    'the next sync brings the server\'s newest session of that customer back');

  step('23. ➕ bank from the sale card (store.addListOption), a pull before the push (setSettings with the seed), then the server');
  check(!world.lists || world.lists.length === 0, 'this world has no Lists rows (the sheet before setupSheet): the phones use the old methods');
  check(same(payMethods(P.ports, 'S1'), ['CASH', 'KBZ', 'WAVE', 'BANK']) && !P.store.settings.lists_json, 'the phone offers today\'s methods, no lists_json');
  await P.phone.sim.start('S1-0002');
  await P.phone.sim.tapLast('ရောင်း ၁');
  const card23 = P.phone.sim.lastBot(), g23 = lastLocal(P.phone).groupId;
  server.dropResponse = true;
  const lost23 = await P.sync.syncNow('t');
  check(!lost23.ok && lost23.error === 'lost' && P.sync.pendingBatch && P.sync.pendingBatch.entries.length === 1, 'a sale whose reply is lost: the batch stays planned (it is resent as it was)');
  check(P.phone.sim.button(card23, MSG.btn_add_bank) === 'LA|pm|PM|' + g23, 'the sale card offers ➕ bank');
  await P.phone.sim.tap(card23.id, 'LA|pm|PM|' + g23);
  check(P.phone.lastText() === MSG.add_ask_pm && appInputModeFor(getState(P.ports, '1001')) === 'text' && getState(P.ports, '1001').purpose === 'add_option', 'the name prompt; the app shows the text bar (add_option is await_text)');
  await P.phone.sim.text('AYA ဒေါ်စန်း');
  const res23 = P.phone.sim.lastBot(), aya = listOptions(P.ports, 'pay_method').filter(r => r.label === 'AYA ဒေါ်စန်း')[0];
  check(aya && res23.id !== card23.id && P.phone.sim.lastBot().id === res23.id && P.phone.sim.button(res23, MSG.btn_undo) === 'U|' + g23 && P.phone.sim.button(res23, MSG.btn_receipt) === 'RC|' + g23 &&
    same(datas(res23).slice(-1)[0], ['LD|pm|' + aya.key]) && liveRows(P.store.ledger.filter(r => r.groupId === g23)).every(r => r.method === aya.key),
    'the resumed sale card is the last bot message: undo, receipt, the method rows and the 🔢 number button; the sale is marked with the new account', datas(res23));
  const listEntries = P.store.outbox.filter(e => e.kind === 'list');
  check(listEntries.length === 1 && listEntries[0].rec.key === aya.key && listEntries[0].rec.label === 'AYA ဒေါ်စန်း' && listEntries[0].rec.list === 'pay_method' && !('seedRows' in listEntries[0].rec) &&
    same(Object.keys(listEntries[0].rec).sort(), ['key', 'label', 'list', 'note', 'shop']), 'one {kind: list} entry, its rec without the seed', listEntries[0] && listEntries[0].rec);
  check(same(payMethods(P.ports, 'S1'), ['CASH', 'KBZ', 'WAVE', 'BANK', aya.key]) && typeof P.store.settings.lists_json === 'string', 'offline the account is a button at once, next to the old ones (seeded from the legacy lists)');
  const lj23 = P.store.settings.lists_json, dup23 = P.ports.store.addListOption({ list: 'pay_method', key: aya.key, label: 'AYA ဒေါ်စန်း' }, listRows(P.ports, 'pay_method'));
  check(same(dup23, { status: 'dup', key: aya.key }) && P.store.outbox.filter(e => e.kind === 'list').length === 1 && P.store.settings.lists_json === lj23, 'an add that changes nothing answers dup and queues nothing');
  check(P.sync.pendingLines().some(l => l.kind === 'list' && l.text === t(P.ports, 'ui_pending_list', { label: 'AYA ဒေါ်စန်း' })) &&
    appPendingListLabel(P.ports, { list: 'pay_method', key: 'KBZ', detail: '09 777 123456', detailWas: '' }) === methodLabel(P.ports, 'KBZ') + ' · 09 777 123456',
    'the sync screen lists "➕ စာရင်းအသစ် · AYA ဒေါ်စန်း"; an account-number entry (no label) takes the account\'s label');
  await P.phone.commit('t');
  check(P.adapter.data.settings.lists_json && P.adapter.data.settings.lists_json.value === lj23, 'the new lists_json is persisted');
  await P.phone.sim.start('S1-0005');
  await P.phone.sim.tapLast('ရောင်း ၁');
  const g23b = lastLocal(P.phone).groupId;
  world.settings.summary_hour = 20;                     // the owner changes a setting meanwhile: the next pull carries the Settings map
  let seen23 = null;
  const onSync = s => { if (!seen23 && s && s.ok) seen23 = { outbox: P.store.outbox.map(e => e.kind), methods: payMethods(P.ports, 'S1'), kb: flat({ keyboard: afterSaleKeyboard(P.ports, g23b) }), hour: P.store.settings.summary_hour }; };
  P.phone.on('sync', onSync);
  const q23 = server.quarantine.length;
  const s23 = await P.sync.syncNow('t');
  P.phone.off('sync', onSync);
  check(seen23 && seen23.hour === 20 && seen23.outbox.indexOf('list') >= 0 && same(seen23.methods, ['CASH', 'KBZ', 'WAVE', 'BANK', aya.key]) &&
    ['KBZ', 'WAVE', 'BANK', aya.key].every(k => seen23.kb.indexOf('PM|' + g23b + '|' + k) >= 0),
    'the pull that came before the push replaced the Settings map; the phone\'s method buttons still show the old accounts and the pending one', seen23);
  const ayaRow = (world.lists || []).filter(r => r.list === 'pay_method' && r.key === aya.key)[0];
  check(s23.ok && P.store.outbox.length === 0 && ayaRow && same(world.lists.filter(r => r.list === 'pay_method').map(r => r.key), ['CASH', 'KBZ', 'WAVE', 'BANK', aya.key]) &&
    liveRows(world.ledger.filter(r => r.groupId === g23), world.ledger).every(r => r.method === aya.key) && server.quarantine.length === q23,
    'the push then follows: the server seeds its list from the old methods and appends the account; the marked sale is there', world.lists && world.lists.map(r => r.key));
  check(P.store.settings.lists_json === listsJsonFor(server.ports) && same(payMethods(P.ports, 'S1'), payMethods(world.ports, 'S1')), 'the phone then holds the server\'s own lists_json');
  delete world.settings.summary_hour;

  step('24. A spoken name queued offline, the same name then typed, the job replayed: one expense');
  net.offline = true;
  await P.phone.sim.start('');
  await P.phone.sim.tapLast(MSG.btn_expense);
  await P.phone.sim.tap(P.phone.sim.lastBot().id, 'EC|phone');
  await P.phone.sim.tap(P.phone.sim.lastBot().id, 'EA|10000');
  const ms24 = P.phone.sim.lastBot();
  check(flat(ms24).indexOf('LA|pm|EM') >= 0, 'the expense method screen offers ➕ bank');
  await P.phone.sim.tap(ms24.id, 'LA|pm|EM');
  const rows24 = P.store.ledger.length;
  await P.phone.sim.voice('MAB ဦးကျော်');
  check(P.store.queuedMedia().length === 1 && P.store.ledger.length === rows24 && getState(P.ports, '1001').purpose === 'add_option', 'offline: the voice note is queued, nothing written, the add state still waits');
  await P.phone.sim.text('MAB ဦးကျော်');
  const mab = listOptions(P.ports, 'pay_method').filter(r => r.label === 'MAB ဦးကျော်')[0];
  const exp24 = P.store.ledger.slice(rows24).filter(r => r.type === 'EXPENSE');
  check(mab && exp24.length === 1 && exp24[0].amount === -10000 && exp24[0].method === mab.key && getState(P.ports, '1001') === null, 'typed: the account is added and ONE expense is written with it');
  net.offline = false;
  const srvRows24 = world.ledger.length;
  await P.sync.syncNow('t');
  const expAll = P.store.ledger.slice(rows24).filter(r => r.type === 'EXPENSE');
  check(P.store.queuedMedia().length === 0 && expAll.length === 1 && world.ledger.slice(srvRows24).filter(r => r.type === 'EXPENSE').length === 1 &&
    world.lists.filter(r => r.label === 'MAB ဦးကျော်').length === 1 && P.phone.lastText() === t(P.ports, 'add_exists', { label: 'MAB ဦးကျော်' }),
    'the job replayed after the sync finds the name: no second account, no second expense (on the phone and on the server)', P.phone.lastText());

  step('25. A split with a typed amount on the real app store');
  await P.phone.sim.start('S1-0003');
  await P.phone.sim.tapLast('ရောင်း ၁');
  const card25 = P.phone.sim.lastBot(), g25 = lastLocal(P.phone).groupId, n25 = P.store.ledger.length;
  check(P.phone.sim.button(card25, MSG.btn_split) === 'SX|' + g25, 'the sale card offers 💵+🏦');
  await P.phone.sim.tap(card25.id, 'SX|' + g25);
  check(flat(P.phone.sim.lastBot()).indexOf('SXM|' + g25 + '|KBZ') >= 0, 'the account screen');
  await P.phone.sim.tap(P.phone.sim.lastBot().id, 'SXM|' + g25 + '|KBZ');
  const st25 = getState(P.ports, '1001');
  check(st25 && st25.kind === 'await_number' && st25.purpose === 'split_bank' && appInputModeFor(st25) === 'number', 'the amount screen: the app opens the number keypad (split_bank is await_number)', st25);
  await P.phone.sim.text('5000');
  const rows25 = P.store.ledger.slice(n25);
  check(rows25.length === 3 && rows25[1].type === 'SALE' && rows25[1].cash === 7000 && rows25[1].method === 'CASH' && rows25[2].type === 'PAYMENT' && rows25[2].cash === 5000 && rows25[2].method === 'KBZ' &&
    rows25.every(r => r.groupId === g25) && P.phone.lastText().indexOf(t(P.ports, 'split_done', { cash: '7,000', cashMethod: methodLabel(P.ports, 'CASH'), bank: '5,000', method: methodLabel(P.ports, 'KBZ') })) >= 0,
    'typed 5000 of 12,000: mirror, cash part 7,000, PAYMENT 5,000 KBZ, one group; the result says so', rows25.map(r => [r.type, r.cash, r.method]));
  const s25 = await P.sync.syncNow('t');
  check(s25.ok && s25.quarantined.length === 0 && s25.flagged.length === 0 && rows25.every(r => world.ledger.filter(w => w.txId === r.txId).length === 1) && P.store.outbox.length === 0,
    'pushed: the three rows on the server, nothing quarantined, no flag');

  step('26. appInputModeFor for the new states');
  check(appInputModeFor({ kind: 'meas_pick' }) === 'text' && appInputModeFor({ kind: 'meas_pick', step: 'name' }) === 'text' && appInputModeFor({ kind: 'await_text', purpose: 'add_option', list: 'pay_method' }) === 'text' &&
    appInputModeFor({ kind: 'await_text', purpose: 'list_detail', list: 'pay_method', key: 'KBZ' }) === 'text' && appInputModeFor({ kind: 'await_number', purpose: 'split_bank', groupId: 'g' }) === 'number',
    'meas_pick (with or without a step), add_option and list_detail: text; split_bank: the number pad');
  check(Object.keys(world.errors.filter(e => e.where === 'handleUpdate')).length === 0 && !P.store.errors.some(e => e.where === 'deliver' || /^listener:/.test(e.where)), 'no update failed with an exception on the phone or the server',
    P.store.errors.map(e => e.where + ': ' + e.message));

  /* ---------- the app fixer (review findings of the finished build) ---------- */
  step('27. A typed order id is made canonical (v1-77 is V1-0077), so the session links to that order on the server');
  check(same(appMeasVoucher('v1-25', 'S2'), { id: 'V1-0025', bad: false }) && same(appMeasVoucher('V2-0025', 'S1'), { id: 'V2-0025', bad: false }) && appMeasVoucher('V1-00002532', 'S2').id === 'V1-2532' &&
    appMeasVoucher('v1-12345', 'S1').id === 'V1-12345' && appMeasVoucher('V1-၂၅', 'S2').id === 'V1-0025' && appMeasVoucher('V1-0', 'S1').bad && appMeasVoucher('V1-000', 'S1').bad && appMeasVoucher('V1-123456789', 'S1').bad,
    'an id typed short or with extra zeros becomes the id orderIdFor gives (the server matches it exactly); zero and nine digits stay bad');
  const ord27 = 'V1-0077';
  check(!world.orders.some(o => o.id === ord27), 'the world has no order V1-0077 yet');
  world.ports.store.addOrder({ id: ord27, shop: 'S1', customerId: C2, status: 'OPEN', day: today(), staffId: '1001', measId: '' });
  const r27 = appMeasSave(P.phone, { customerId: C2, orderId: '', staff: P.store.meta.staff }, { values: { waist: '28' }, notes: 'typed v1-77', voucher: 'v1-77' });
  await appMeasCommit(P.phone, null);
  await P.sync.syncNow('t');
  const row27 = serverSessions(C2).slice(-1)[0];
  check(r27.ok && !r27.badVoucher && r27.orderId === ord27 && row27.notes === 'typed v1-77' && row27.orderId === ord27 && world.orders.filter(o => o.id === ord27)[0].measId === row27.id,
    'typed "v1-77": the session is stored with orderId V1-0077 and the order gets its measId', { r27: r27.orderId, row: row27.orderId, order: world.orders.filter(o => o.id === ord27)[0] });

  step('28. A multi-value field is normalised box by box: a letter or 14½ in one box no longer turns the value into its first number');
  const f28 = appMeasFormFields(measureFields(P.ports, true));
  const c28 = appMeasCollect(f28, { sleeve_round: appMeasJoin(['36', '14½', '20']), sleeve_length: appMeasJoin(['36', '30', 'ခ']), neck: '၁၃' });
  check(c28.fields.sleeve_round === '36/14/20' && c28.fields.sleeve_length === '36/30/ခ' && c28.fields.neck === '13' && c28.n === 3, 'boxes [36, 14½, 20] save 36/14/20 and [36, 30, ခ] save 36/30/ခ (both were saved as 36)', c28.fields);
  const c28b = appMeasCollect(f28, { sleeve_round: appMeasJoin(['36', '၃၀', '']), sleeve_length: appMeasJoin(['', ' 7 ', '20']) });
  check(c28b.fields.sleeve_round === '36/30' && c28b.fields.sleeve_length === '/7/20', 'Burmese digits per box, trailing empty boxes dropped, an empty first box kept as a position', c28b.fields);
  const r28 = appMeasSave(P.phone, { customerId: C2, orderId: '', staff: P.store.meta.staff }, { values: { sleeve_round: appMeasJoin(['36', '30', 'ခ']) }, notes: '', voucher: '' });
  check(r28.ok && P.store.measurements[C2].fields.sleeve_round === '36/30/ခ' && same(appMeasSplit(appMeasPrefill(f28, latestMeasurement(P.ports, C2)).sleeve_round, 3), ['36', '30', 'ခ']),
    'saved as 36/30/ခ, and the next pre-fill shows all three boxes', P.store.measurements[C2].fields);
  await appMeasCommit(P.phone, null);
  await P.sync.syncNow('t');

  step('29. A service-worker update that waited for the form: closing the form reloads only after its commit succeeded');
  const savedAPP = APP;
  const reloads29 = [];
  const win29 = { location: { reload() { reloads29.push(1); } }, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h) };
  const form29 = values => ({ req: { customerId: C2, orderId: '', staff: P.store.meta.staff }, values, notesEl: { value: '' }, voucherEl: { value: '' }, el: null, timer: null, msgEl: null, dirty: false });
  APP = { win: win29, phone: P.phone, store: P.store, sync: { scheduleSync() {} }, tt: k => k, $: () => null, measForm: form29({ waist: '29' }), reloadAfterForm: true };
  try {
    P.adapter.failNext = true;
    appMeasFormSave();
    await tick(20);
    const e29 = P.store.outbox.filter(e => e.kind === 'measurement' && e.rec.fields.waist === '29')[0];
    check(reloads29.length === 0 && APP.reloadAfterForm === true && APP.measForm === null && e29 && !P.adapter.data.outbox[e29.entryId] && P.store.pendingOps > 0 &&
      P.phone.sim.lastBot().text === t(P.ports, 'meas_saved_form', { customer: customerName(P.ports, C2), n: fmtCount(1) }),
      'the write failed: no reload; the save, its outbox entry and the bot line wait in memory and the update keeps waiting', { reloads: reloads29.length, pendingOps: P.store.pendingOps, wait: APP.reloadAfterForm });
    APP.measForm = form29({});
    appCloseMeasForm({});
    await tick(20);
    check(reloads29.length === 1 && APP.reloadAfterForm === false && e29 && P.adapter.data.outbox[e29.entryId] && P.store.pendingOps === 0,
      'the next form close writes them, then reloads', { reloads: reloads29.length, pendingOps: P.store.pendingOps });
  } finally { APP = savedAPP; }
  await P.sync.syncNow('t');

  step('30. A newer app opens the database at a higher version in another tab: this tab lets go and reloads after the write in flight');
  const fidb30 = fakeIndexedDB();
  let req30 = null;
  const ad30 = createIdbAdapter({ indexedDB: { open(n, v) { req30 = fidb30.open(n, v); return req30; } }, name: 'vc30' });
  await ad30.open();
  const conn30 = req30.result;
  let closed30 = 0, replaced30 = 0, err30 = null;
  conn30.close = () => { closed30++; };
  ad30.onreplaced = () => { replaced30++; };
  check(typeof conn30.onversionchange === 'function', 'the adapter listens for versionchange on its connection');
  conn30.onversionchange({ oldVersion: APP_DB_VERSION, newVersion: APP_DB_VERSION + 1 });
  try { await ad30.transact([{ store: 'meta', type: 'put', value: { key: 'k30', value: 1 } }]); } catch (e) { err30 = e; }
  check(closed30 === 1 && replaced30 === 1 && err30 && /database not open/.test(err30.message), 'versionchange closes the connection (the upgrade is not blocked) and calls adapter.onreplaced once; a write after it fails',
    { closed30, replaced30, err: err30 && err30.message });
  check(/adapter\.onreplaced\s*=\s*function\s*\(\)\s*\{\s*appOnDbReplaced\(\);\s*\}/.test(bootApp.toString()), 'bootApp wires adapter.onreplaced to appOnDbReplaced');
  const reloads30 = [];
  APP = { win: { location: { reload() { reloads30.push(1); } } }, store: P.store };
  try {
    P.adapter.holdWrites = true;
    P.store.cachePut('k30', 'v', 60);
    const held30 = P.phone.commit('t30');
    appOnDbReplaced();
    await tick(20);
    check(reloads30.length === 0 && P.adapter.heldCount() === 1, 'no reload while a write is still in flight');
    P.adapter.release();
    await held30;
    await tick(5);
    check(reloads30.length === 1 && P.adapter.data.cache.k30, 'the write landed, then one reload');
  } finally { P.adapter.holdWrites = false; APP = savedAPP; }

  step('31. A server older than the new kinds answers bad_kind without kindKnown: the app store keeps the list and measurement entries, then sends them');
  const OLD_KINDS = { customer: 1, item: 2, group: 3, notice: 4, error: 5 };
  let rolled31 = true;
  const tr31 = (api, body) => {
    const kinds = SYNC.ENTRY_KINDS;
    if (rolled31) SYNC.ENTRY_KINDS = OLD_KINDS;
    try { const r = server.handle(api, JSON.parse(JSON.stringify(body))); return r === null ? null : JSON.parse(JSON.stringify(r)); } finally { SYNC.ENTRY_KINDS = kinds; }
  };
  const adQ = createMemoryAdapter();
  const Q = createAppPhone({ adapter: adQ, name: 'Q old server', transport: tr31, clock: () => world.ports.clock.now(), platform: 'android' });
  const QS = createAppSync(Q, { transport: tr31, timers, platform: 'android', label: 'Q old server' });
  await Q.load();
  const enrQ = await QS.enroll(server.mintEnrollCode(sister, 'Q phone').code);
  timers.queue.length = 0;
  await QS.syncNow('t');
  const add31 = addListOptionByLabel(Q.ports, 'pay_method', 'CB ဦးလှ', Q.store.meta.staff);
  const r31 = appMeasSave(Q, { customerId: C1, orderId: '', staff: Q.store.meta.staff }, { values: { neck: '12' }, notes: 'old server', voucher: '' });
  await Q.commit('t');
  const q31 = server.quarantine.length, chat31 = Q.store.chat.length;
  const s31 = await QS.syncNow('t');
  check(enrQ.ok && add31.ok && add31.created && r31.ok && s31.ok && server.quarantine.length === q31 + 2 && server.quarantine.slice(q31).every(x => x.reason === 'bad_kind') && s31.quarantined.length === 0,
    'the old server answers bad_kind for the option and the session; the phone counts nothing as quarantined', { add: add31, q: server.quarantine.slice(q31).map(x => x.reason), mine: s31.quarantined });
  const kept31 = () => same(Q.store.outbox.map(e => e.kind), ['list', 'measurement']) && Q.store.measurements[C1] && Q.store.measurements[C1].pending && latestMeasurement(Q.ports, C1).notes === 'old server' &&
    payMethods(Q.ports, 'S1').indexOf(add31.key) >= 0 && !Q.store.chat.slice(chat31).some(m => m.from === 'bot' && /❌/.test(m.text || ''));
  check(kept31() && Object.keys(adQ.data.outbox).length === 2 && adQ.data.measurements[C1].pending &&
    QS.pendingLines().some(l => l.kind === 'list' && l.text === t(Q.ports, 'ui_pending_list', { label: 'CB ဦးလှ' })) && QS.pendingLines().some(l => l.kind === 'measurement'),
    'kept: both entries in the outbox (memory and disk), the session pending and shown, the account still a button, no ❌ line; the sync screen lists them', Q.store.outbox.map(e => e.kind));
  await QS.syncNow('t');
  check(kept31(), 'a second sync to the old server: still kept');
  rolled31 = false;                                     // the new bot is published again over the same sheet
  const s31b = await QS.syncNow('t');
  const newest31 = latestMeasurement(world.ports, C1);
  check(s31b.ok && Q.store.outbox.length === 0 && world.lists.some(x => x.list === 'pay_method' && x.key === add31.key && x.label === 'CB ဦးလှ') && newest31 && newest31.notes === 'old server' &&
    !Q.store.measurements[C1].pending && Q.store.measurements[C1].id === newest31.id && !adQ.data.measurements[C1].pending,
    'once the server knows the kinds: the account is in its Lists and the session is stored; the phone takes its id', { outbox: Q.store.outbox.map(e => e.kind), newest: newest31 && newest31.id });
  check(!Q.store.errors.some(e => e.where === 'deliver' || /^listener:/.test(e.where)) && !P.store.errors.some(e => e.where === 'deliver' || /^listener:/.test(e.where)), 'no exception on either phone in these steps',
    Q.store.errors.concat(P.store.errors).map(e => e.where + ': ' + e.message));
}

/* ============================== round 5, step 3 (SPEC-round-5.md 5 and 8.5): the guided sale on the phone ============================== */

/**
 * A minimal DOM for the few rendering helpers the checks below call (appRenderMsg, appStepper, appInputBar,
 * appOpenDateSheet, appOpenNumberKeypad): elements with attributes, class, text, children, listeners and click().
 */
function fakeDocument() {
  function el(tag) {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], attrs: {}, className: '', textContent: '', listeners: {}, hidden: false, value: '', parentNode: null,
      setAttribute(k, v) { e.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
      addEventListener(type, fn) { (e.listeners[type] = e.listeners[type] || []).push(fn); },
      appendChild(c) { e.children.push(c); c.parentNode = e; return c; },
      removeChild(c) { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); return c; },
      get firstChild() { return e.children[0] || null; },
      click() { if (!e.attrs.disabled) (e.listeners.click || []).forEach(fn => fn({ target: e })); }
    };
    return e;
  }
  return { createElement: el, createTextNode: text => ({ nodeType: 3, textContent: String(text), children: [] }) };
}
/** Every element under a node (depth first). */
function fakeWalk(node, out) {
  out = out || [];
  (node && node.children || []).forEach(c => { if (c.tagName) { out.push(c); fakeWalk(c, out); } });
  return out;
}
/** Run fn with the app's APP singleton pointed at a real test phone and a fake DOM; restores both (fn may be async). */
async function withFakeApp(P, extra, fn) {
  const savedAPP = APP, hadDoc = Object.prototype.hasOwnProperty.call(global, 'document'), savedDoc = global.document;
  const doc = fakeDocument();
  const els = { overlay: doc.createElement('div') };
  els.overlay.hidden = true;
  const scheduled = [];
  global.document = doc;
  APP = Object.assign({
    win: { setTimeout(f) { scheduled.push(f); return scheduled.length; } }, doc, phone: P.phone, store: P.store, sync: P.sync,
    tt: (k, v) => t(P.ports, k, v), qty: { msgId: null, n: 1 }, keypadAutoFor: null, thumbAsked: {}, tapStart: 0, $: id => els[id] || null
  }, extra || {});
  try { return await fn({ els, scheduled, doc }); } finally {
    APP = savedAPP;
    if (hadDoc) global.document = savedDoc; else delete global.document;
  }
}

async function round5() {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const flat = m => ((m && m.keyboard) || []).reduce((a, r) => a.concat(r.map(b => b.callback_data)), []);
  const prefixOf = key => msgTemplate(world.ports, key).split('{')[0].trim();     // the label rule: a key's text up to its first '{'
  const today = () => dayKey(world.ports.clock.now());
  const noErrors = P => !P.store.errors.some(e => e.where === 'deliver' || /^listener:/.test(e.where));
  // Pieces on the shelf for the sales below, restocked in Telegram while the server still says quick.
  ['S1-0002', 'S1-0002', 'S1-0003', 'S1-0003'].forEach(id => { world.sim.start(sister, id); world.sim.tapLast(sister, 'ကုန်ရောက်'); world.sim.tapLast(sister, '+၅'); });

  step('32. appKeypadKeyFor (pure)');
  const k32a = appKeypadKeyFor({ id: 7 }, { purpose: 'sale_step', saved: { step: 'bank' } }), k32b = appKeypadKeyFor({ id: 7 }, { purpose: 'sale_step', saved: { step: 'paid' } });
  check(k32a === '7|sale_step|bank' && k32b !== k32a && appKeypadKeyFor({ id: 7 }, { purpose: 'sale_price' }) === '7|sale_price|',
    'appKeypadKeyFor: message id, purpose and the saved step, so a second prompt on one message gets a new key', [k32a, k32b]);

  step('33. A guided mixed sale on the real app store: scan, the stepper\'s S|S1-0002|2, 🚫, mix, KBZ, typed 5000, ✅ အကုန်');
  timers.queue.length = 0;
  const G = await makePhone('G round5');
  const enrG = await G.sync.enroll(server.mintEnrollCode(sister, 'G phone').code);
  timers.queue.length = 0;
  const uid = G.phone.staffId();
  check(enrG.ok && saleFlow(G.ports) === 'quick', 'a phone enrolled against the seeded world sells in quick mode (the suites\' default)');
  world.settings.sale_flow = 'steps';
  const pull33 = await G.sync.syncNow('t');
  check(pull33.ok && G.store.settings.sale_flow === 'steps' && saleFlow(G.ports) === 'form', 'the server says steps, which reads as form: the next pull carries it to the phone');

  step('35. The guided state survives a restart over the same adapter mid-flow; the next tap continues');
  const G2 = await makePhone('G again', { adapter: G.adapter });

  step('36. The per-device pref setting:sale_flow = quick makes the next S|id|1 commit at once while the server says steps');
  G2.store.setPref('setting:sale_flow', 'quick');
  await G2.phone.commit('t');
  check(saleFlow(G2.ports) === 'quick' && world.settings.sale_flow === 'steps' && G2.store.settings.sale_flow === 'steps', 'the pref wins over the pulled Settings on this phone only');
  await G2.phone.sim.start('S1-0003');
  const card36 = G2.phone.sim.lastBot(), n36 = G2.store.ledger.length;
  await G2.phone.sim.tap(card36.id, 'S|S1-0003|1');
  const rows36 = G2.store.ledger.slice(n36);
  check(rows36.length === 1 && rows36[0].type === 'SALE' && rows36[0].qty === -1 && getState(G2.ports, uid) === null && G2.phone.sim.lastBot().text.indexOf(prefixOf('sold_done')) >= 0 &&
    G2.phone.sim.button(G2.phone.sim.lastBot(), MSG.btn_undo) === 'U|' + rows36[0].groupId, 'S|S1-0003|1 commits at once (the one-tap card with its after-sale buttons)', rows36.length);
  const w36 = world.ledger.length;
  world.sim.start(sister, 'S1-0003');
  world.sim.tapLast(sister, 'ရောင်း ၁');
  const tg36 = getState(world.ports, '1001');
  check(tg36 && tg36.kind === 'sale' && tg36.step === 'card' && world.ledger.length === w36, 'the same tap in Telegram (the server says form) shows the review card and writes nothing', tg36);
  world.sim.tapLastByKey(sister, 'btn_cancel');
  delete G2.store.meta.prefs['setting:sale_flow'];
  await G2.phone.commit('t');
  check(saleFlow(G2.ports) === 'form' && getState(world.ports, '1001') === null, 'without the pref the phone follows the server again; the Telegram flow was cancelled');
  await G2.sync.syncNow('t');

  step('37. The tour hooks and the keypad reopening on one message (a fake DOM), and the source checks of the offline-safe boot');
  sendItemCard(uid, G2.ports.store.getItem('S1-0002'), G2.store.meta.staff, G2.ports);
  await G2.phone.commit('t');
  const card37 = G2.phone.sim.lastBot(), bare = m => Object.assign({}, m, { photo: null });
  await withFakeApp(G2, null, async () => {
    const plain = appRenderMsg(bare(card37), { big: true });
    const sell = fakeWalk(plain).filter(e => e.tagName === 'BUTTON' && /\bsell\b/.test(e.className))[0];
    check(sell && sell.getAttribute('data-cb') === 'S|S1-0002|1' && !/\bhot\b/.test(sell.className), 'the stepper\'s sell button carries data-cb = S|S1-0002|1; no highlight without SIM_HOT', sell && [sell.className, sell.attrs]);
    APP.win.SIM_HOT = 'S|S1-0002|1';
    const lit = appRenderMsg(bare(card37), { big: true });
    const sell2 = fakeWalk(lit).filter(e => e.tagName === 'BUTTON' && /\bsell\b/.test(e.className))[0];
    check(sell2 && /\bhot\b/.test(sell2.className), 'SIM_HOT = S|S1-0002|… highlights the stepper\'s sell button', sell2 && sell2.className);
  });
  sendItemCard(uid, G2.ports.store.getItem('S1-0001'), G2.store.meta.staff, G2.ports);
  await G2.phone.commit('t');
  const q1 = G2.phone.sim.lastBot();
  await withFakeApp(G2, null, async () => {
    const kbBtns = node => fakeWalk(node).filter(e => e.tagName === 'BUTTON' && e.parentNode && e.parentNode.className === 'row');
    const n0 = appRenderMsg(bare(q1), { big: true }), b0 = kbBtns(n0);
    check(b0.length === flat(q1).length && b0.every((b, i) => b.getAttribute('data-cb') === flat(q1)[i]) && !b0.some(b => /\bhot\b/.test(b.className)),
      'every keyboard button carries data-cb = its callback; none is hot without SIM_HOT', b0.map(b => b.getAttribute('data-cb')));
    APP.win.SIM_HOT = 'D|S1-0001';
    const b1 = kbBtns(appRenderMsg(bare(q1), { big: true })), hot = b1.filter(b => /\bhot\b/.test(b.className));
    check(hot.length === 1 && hot[0].getAttribute('data-cb') === 'D|S1-0001' && hot[0].textContent === appPlain(MSG.btn_discount), 'SIM_HOT marks exactly the button with that callback', hot.map(b => b.textContent));
  });
  const uiSrc = fs.readFileSync(path.join(ROOT, 'app/app_ui.js'), 'utf8'), cssSrc = fs.readFileSync(path.join(ROOT, 'app/app.css'), 'utf8');
  const devSrc = fs.readFileSync(path.join(ROOT, 'app/dev/index.html'), 'utf8');
  check(bootApp.toString().indexOf('opts.online ||') >= 0 && uiSrc.indexOf('opts.online ||') >= 0, 'bootApp takes opts.online (the simulator frame\'s in-page server)');
  check(appDoEnroll.toString().indexOf('navigator.onLine') < 0 && appDoEnroll.toString().indexOf('APP.sync.online()') >= 0, 'appDoEnroll asks APP.sync.online(), not navigator.onLine');
  check(appRenderMsg.toString().indexOf("'data-cb'") >= 0 && appRenderMsg.toString().indexOf('SIM_HOT') >= 0 && appStepper.toString().indexOf("'data-cb'") >= 0,
    'appRenderMsg sets data-cb and reads SIM_HOT; appStepper sets data-cb');
  check(/\.sell\.hot\b/.test(cssSrc) && /\.sheet input\[type=date\]/.test(cssSrc), 'app.css highlights .sell.hot and sizes the date input');
  check(APP_MSG.ui_btn_pick_date === MSG.ui_btn_pick_date && APP_MSG.ui_date_title === MSG.ui_date_title && !!APP_MSG.ui_btn_pick_date && !!APP_MSG.ui_date_title,
    'the two keys of the date sheet are in APP_MSG (and merged into MSG)');
  const devUi = devSrc.indexOf('<script src="../app_ui.js"></script>'), devForms = devSrc.indexOf('<script src="../app_forms.js"></script>');
  check(/world\.settings\.sale_flow\s*=\s*'form'/.test(devSrc) && /id="saleFlow"/.test(devSrc) && /syncNow\('settings'\)/.test(devSrc.slice(devSrc.indexOf("$('saleFlow')"))) &&
    devUi > 0 && devForms > devUi,
    'the dev page starts in form, loads app_forms.js after app_ui.js and has the sale_flow checkbox that syncs the settings');

  step('38. No exception on the phones of this round');
  check(noErrors(G) && noErrors(G2) && !world.errors.some(e => e.where === 'handleUpdate'), 'no update failed with an exception',
    G.store.errors.concat(G2.store.errors).map(e => e.where + ': ' + e.message));

  step('39. The highlight keeps the card\'s own class and matches the item only, data-cb follows the count, the bar\'s keypad is titled too, a prompt shown again opens the keypad again');
  const at39 = Date.now();
  const uniq39 = { id: 9901, from: 'bot', text: '👗 S1-0001 · card', ts: at39, photo: null, keyboard: [[{ text: MSG.btn_sold, callback_data: 'S|S1-0001|1' }], [{ text: MSG.btn_discount, callback_data: 'D|S1-0001' }]] };
  const sku39 = { id: 9902, from: 'bot', text: '🧣 S1-0002 · card', ts: at39, photo: null,
    keyboard: [[{ text: MSG.btn_sell_one, callback_data: 'S|S1-0002|1' }, { text: MSG.btn_qty, callback_data: 'Q|S1-0002' }], [{ text: MSG.btn_discount, callback_data: 'D|S1-0002' }]] };
  await withFakeApp(G2, null, async () => {
    const sellOf = node => fakeWalk(node).filter(e => e.tagName === 'BUTTON' && /\bsell\b/.test(e.className))[0];
    const cbBtn = (node, cb) => fakeWalk(node).filter(e => e.tagName === 'BUTTON' && e.getAttribute('data-cb') === cb)[0];
    APP.win.SIM_HOT = 'S|S1-0001|1';
    const u39 = cbBtn(appRenderMsg(uniq39, { big: true }), 'S|S1-0001|1');
    check(u39 && /\bgood\b/.test(u39.className) && /\bhot\b/.test(u39.className), 'a UNIQUE card\'s sell button keeps its good class when the tour highlights it', u39 && u39.className);
    APP.qty = { msgId: sku39.id, n: 1 };
    APP.win.SIM_HOT = 'S|S1-0002|2';
    const s39a = sellOf(appRenderMsg(sku39, { big: true }));
    APP.win.SIM_HOT = 'S|S1-0003|1';
    const s39b = sellOf(appRenderMsg(sku39, { big: true }));
    APP.win.SIM_HOT = 'D|S1-0002';
    const n39c = appRenderMsg(sku39, { big: true }), s39c = sellOf(n39c), d39c = cbBtn(n39c, 'D|S1-0002');
    check(s39a && /\bhot\b/.test(s39a.className) && s39b && !/\bhot\b/.test(s39b.className) && s39c && !/\bhot\b/.test(s39c.className) && d39c && /\bhot\b/.test(d39c.className),
      'the stepper\'s sell button is hot for any S|S1-0002|… (the tour does not know the count), never for another item or another action', [s39a && s39a.className, s39b && s39b.className, s39c && s39c.className]);
    APP.win.SIM_HOT = undefined;
    APP.qty = { msgId: sku39.id, n: 3 };
    const s39d = sellOf(appRenderMsg(sku39, { big: true }));
    check(s39d && s39d.getAttribute('data-cb') === 'S|S1-0002|3' && s39d.textContent === APP.tt('ui_sell_n', { n: fmtCount(3) }), 'the stepper\'s data-cb follows the count: S|S1-0002|3 at 3', s39d && s39d.attrs);
  });
  const two39 = { id: 9903, from: 'bot', text: '📝 the header line\n✏️ the question line', ts: at39, keyboard: [] };
  await withFakeApp(G2, null, async ({ els, scheduled }) => {
    const titles = st => {
      setState(G2.ports, uid, st);
      APP.keypadAutoFor = null; scheduled.length = 0;
      const bar = appInputBar(two39), h3 = () => (fakeWalk(els.overlay).filter(e => e.tagName === 'H3')[0] || {}).textContent;
      if (scheduled[0]) scheduled[0]();
      const auto = scheduled.length ? h3() : null;
      appCloseOverlay();
      const open = bar ? fakeWalk(bar).filter(e => e.tagName === 'BUTTON' && e.textContent === APP.tt('ui_type_number_bar'))[0] : null;
      if (open) open.click();
      const typed = open ? h3() : null;
      appCloseOverlay();
      return [auto, typed];
    };
    const r39 = titles({ kind: 'await_number', purpose: 'sale_price', itemId: 'S1-0002' });
    clearState(G2.ports, uid);
    check(same(r39, ['the header line', 'the header line']), 'the other number prompts (sale_price here) keep the first line as the title', r39);
  });
  world.settings.sale_flow = 'quick';

  step('40. A server older than DueDay (its pull names no caps: the bot rolled back, or the app published before it): the real app store sells with the one-tap card until a pull names dueDay');
  world.settings.sale_flow = 'steps';
  const st40 = { old: true, pages: 0 };
  const t40 = (api, body) => { const r = transport(api, body); if (api === 'sync' && r && r.pull) { st40.pages++; if (st40.old) delete r.pull.caps; } return r; };
  const ad40 = createMemoryAdapter();
  const H = createAppPhone({ adapter: ad40, name: 'H older server', transport: t40, clock: () => world.ports.clock.now(), platform: 'android' });
  const Hs = createAppSync(H, { transport: t40, timers, platform: 'android', label: 'H older server' });
  await H.load();
  const enr40 = await Hs.enroll(server.mintEnrollCode(sister, 'H phone').code);
  timers.queue.length = 0;
  const boot40 = H.store.settings.sale_flow;
  st40.pages = 0;
  const s40 = await Hs.syncNow('t');
  check(enr40.ok && boot40 === 'steps' && s40.ok && st40.pages === 2 && s40.pages === 2 && H.store.settings.sale_flow === 'quick' && saleFlow(H.ports) === 'quick' &&
    H.store.meta.cursor.quickForced === true && world.settings.sale_flow === 'steps',
    'enrolled on an older server: the first sync asks for one more page, stores the Settings with sale_flow quick and the phone sells with the one-tap card (the server says steps)', { pages: st40.pages, cursor: H.store.meta.cursor });
  const H2 = createAppPhone({ adapter: ad40, name: 'H again', transport: t40, clock: () => world.ports.clock.now(), platform: 'android' });
  const H2s = createAppSync(H2, { transport: t40, timers, platform: 'android', label: 'H again' });
  await H2.load();
  check(saleFlow(H2.ports) === 'quick' && H2.store.meta.cursor.quickForced === true, 'a restart over the same adapter keeps the one-tap card (the stored map and the cursor survive)');
  await H2.sim.start('S1-0003');
  const card40 = H2.sim.lastBot(), n40 = H2.store.ledger.length;
  await H2.sim.tap(card40.id, 'S|S1-0003|1');
  const rows40 = H2.store.ledger.slice(n40);
  check(rows40.length === 1 && rows40[0].type === 'SALE' && rows40[0].qty === -1 && !rows40[0].dueDay && getState(H2.ports, H2.staffId()) === null,
    'S|S1-0003|1 commits one SALE at once, without a due day', rows40.map(r => [r.type, r.qty, r.dueDay]));
  st40.old = false;
  st40.pages = 0;
  const s40b = await H2s.syncNow('t');
  check(s40b.ok && s40b.acked === 1 && st40.pages === 2 && H2.store.settings.sale_flow === 'steps' && saleFlow(H2.ports) === 'form' && !('quickForced' in H2.store.meta.cursor) &&
    world.ledger.filter(w => w.txId === rows40[0].txId).length === 1,
    'the bot published again (caps name dueDay): the sale is pushed and the next page brings the Settings as they are; form again', { pages: st40.pages, cursor: H2.store.meta.cursor });
  sendItemCard(H2.staffId(), H2.ports.store.getItem('S1-0003'), H2.store.meta.staff, H2.ports);
  await H2.commit('t');
  const card40b = H2.sim.lastBot(), n40b = H2.store.ledger.length, forms40 = [];
  H2.on('openform', e => forms40.push(e));
  await H2.sim.tap(card40b.id, appStepperData('S1-0003', 1));
  const st40b = getState(H2.ports, H2.staffId());
  check(forms40.length === 1 && forms40[0].kind === 'sale' && forms40[0].req.itemId === 'S1-0003' && forms40[0].req.qty === 1 && st40b === null && H2.store.ledger.length === n40b,
    'the stepper\'s S|S1-0003|1 asks for the sale form (one openform request) and writes nothing', forms40);
  await H2.sim.tap(H2.sim.lastBot().id, 'SS|S1-0003|z');
  check(getState(H2.ports, H2.staffId()) === null && noErrors(H2), '✖️ ends it; no exception on that phone');
  world.settings.sale_flow = 'quick';
}

/* ============================== round 6, step 3 (docs/design-round-6/SPEC-round-6.md 10.3, 13.15): the app's forms and pages ============================== */

/**
 * A fuller fake app than withFakeApp: the fake document with a body and the shell's elements, APP built as bootApp builds
 * it (the nav fields, plain tt, ttRaw), the phone's openform / openscreen / measureform / change listeners wired, and the
 * page timers collected (flush() runs them). o.history: a stubbed win.history (13.15 step 59). Restores APP and document.
 */
async function app6(P, o, fn) {
  o = o || {};
  const savedAPP = APP, hadDoc = Object.prototype.hasOwnProperty.call(global, 'document'), savedDoc = global.document;
  const base = fakeDocument();
  const doc = { createElement: base.createElement, createTextNode: base.createTextNode, documentElement: base.createElement('html'),
    body: base.createElement('body'), activeElement: null, listeners: {}, addEventListener(type, f) { (doc.listeners[type] = doc.listeners[type] || []).push(f); } };
  const els = {};
  ['back', 'shopName', 'chip', 'gear', 'banner', 'main', 'bottom', 'btnScan', 'btnVoice', 'btnMenu', 'overlay', 'toast', 'photoInput'].forEach(id => { els[id] = base.createElement(id === 'main' ? 'main' : 'div'); els[id].attrs.id = id; });
  els.overlay.hidden = true; els.back.hidden = true; els.toast.hidden = true;
  const sched = [], toasts = [];
  const win = Object.assign({ setTimeout(f) { sched.push(f); return sched.length; }, clearTimeout() {}, listeners: {},
    addEventListener(type, f) { (win.listeners[type] = win.listeners[type] || []).push(f); }, removeEventListener() {} }, o.win || {});
  global.document = doc;
  APP = { config: { appName: 'test' }, opts: o.opts || { noHistory: true }, win, doc, phone: P.phone, sync: P.sync, store: P.store, platform: 'android',
    screen: o.screen || 'home', showScanner: true, qty: { msgId: null, n: 1 }, keypadAutoFor: null, scanner: o.scanner || null, videoEl: null, scanState: 'idle', scanError: null,
    thumbAsked: {}, tapStart: 0, measForm: null, reloadAfterForm: false, form: null, formPending: null, nav: [], navDepth: 0, navBusy: false, navHist: false,
    navGuard: false, screenArg: null, histDays: 7, buyersText: '', backAgainAt: 0, $: id => els[id] || null };
  APP.tt = (k, v) => appPlain(t(P.ports, k, v));
  APP.ttRaw = (k, v) => t(P.ports, k, v);
  const toastOf = () => els.toast.textContent;
  const offs = [['openform', appOnOpenForm], ['openscreen', appOnOpenScreen], ['measureform', appOnMeasureForm], ['change', appOnChange]].map(p => [p[0], P.phone.on(p[0], p[1])]);
  const flush = async (n) => { for (let k = 0; k < (n || 4); k++) { const q = sched.splice(0); for (const f of q) await f(); await tick(3); } };
  try { return await fn({ els, sched, flush, doc, win, toastOf, toasts }); }
  finally {
    offs.forEach(p => P.phone.off(p[0], p[1]));
    APP = savedAPP;
    if (hadDoc) global.document = savedDoc; else delete global.document;
  }
}
/** The elements of a node carrying data-f (or a given name). */
const fOf = (node, name) => fakeWalk(node).filter(e => e.getAttribute && e.getAttribute('data-f') !== null && (name === undefined || e.getAttribute('data-f') === name));
/** Run an element's listeners of one type (input, blur, pointerdown ...). */
const fire = (el, type, ev) => (el.listeners[type] || []).forEach(f => f(ev || { target: el, preventDefault() {} }));
/** Every text under a node, joined. */
const textOf = node => fakeWalk(node).map(e => e.textContent || '').concat([node.textContent || '']).join('\n');

async function round6() {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const flat = m => ((m && m.keyboard) || []).reduce((a, r) => a.concat(r.map(b => b.callback_data)), []);
  const noErrors = P => !P.store.errors.some(e => e.where === 'deliver' || (e.where === 'form' && e.message !== 'boom') || e.where === 'view' || /^listener:/.test(e.where));
  // A world of its own (the seed, its Lists rows, the server says form), restocked in Telegram before any phone enrols.
  const W6 = seedSimWorld(createSimWorld());
  simSeedLists(W6);
  W6.settings.sale_flow = 'form';
  ['S1-0002', 'S1-0003', 'S1-0005'].forEach(id => { for (let k = 0; k < 4; k++) { W6.sim.start(sister, id); W6.sim.tapLast(sister, 'ကုန်ရောက်'); W6.sim.tapLast(sister, '+၅'); } });
  const S6 = createFakeServer(W6);
  const net6 = { offline: false, holdApi: null, held: [] };
  const tr6 = (api, body) => {
    if (net6.offline) throw new Error('offline (test switch)');
    const res = S6.handle(api, JSON.parse(JSON.stringify(body)));
    const out = res === null ? null : JSON.parse(JSON.stringify(res));
    if (net6.holdApi === api) return new Promise(r => net6.held.push(() => r(out)));
    return out;
  };
  const phone6 = async (name, who, extra) => {
    extra = extra || {};
    const adapter = extra.adapter || createMemoryAdapter(), tr = extra.transport || tr6;
    const phone = createAppPhone({ adapter, name, transport: tr, clock: () => W6.ports.clock.now(), platform: 'android' });
    const sync = createAppSync(phone, { transport: tr, timers, platform: 'android', label: name });
    await phone.load();
    if (who) { await sync.enroll(S6.mintEnrollCode(who, name).code); timers.queue.length = 0; }
    return { phone, sync, adapter, store: phone.store, ports: phone.ports };
  };
  const today6 = () => dayKey(W6.ports.clock.now());
  const lastBotOf = P => P.phone.sim.lastBot();
  const card = async (P, id) => { sendItemCard(P.phone.staffId(), P.ports.store.getItem(id), P.store.meta.staff, P.ports); await P.phone.commit('t'); return lastBotOf(P); };
  const F6 = await phone6('F6 sister', sister), uid6 = F6.phone.staffId();
  const F6b = await phone6('F6b sister', sister);
  const O6 = await phone6('O6 owner', U.owner);
  const ctx = { W6, S6, net6, tr6, phone6, F6, F6b, O6, uid6, same, flat, noErrors, today6, card };

  step('41. Home and route: four jobs under form, none under quick; a scan routes to the sale form, a blank tag to the new-piece form');
  check(saleFlow(F6.ports) === 'form' && formsInApp(F6.ports) && screensInApp(F6.ports) && same(appHomeJobs(F6.ports), ['sell', 'new', 'restock', 'expense']) &&
    same(appHomeJobs(world.ports), []), 'appHomeJobs: the four jobs on a form-mode app phone, none in Telegram (no ports.ui)');
  const ev41 = [], on41 = F6.phone.on('openform', e => ev41.push(e));
  let chat41 = F6.store.chat.length, led41 = F6.store.ledger.length;
  await F6.phone.sim.start('S1-0002');
  const new41 = F6.store.chat.slice(chat41);
  check(ev41.length === 1 && ev41[0].kind === 'sale' && ev41[0].req.itemId === 'S1-0002' && ev41[0].req.qty === 1 && new41.length === 1 && new41[0].from === 'user' &&
    new41[0].scan === 'S1-0002' && getState(F6.ports, uid6) === null && F6.store.ledger.length === led41,
    'a home scan of S1-0002 emits ONE openform sale {itemId S1-0002, qty 1}: the /start user line only (no bot message), no state, no ledger row', ev41.map(e => [e.kind, e.req.itemId, e.req.qty]));
  await F6.phone.sim.start('S1-0007');
  check(ev41.length === 2 && ev41[1].kind === 'newitem' && ev41[1].req.itemId === 'S1-0007', 'a blank tag of the own shop (S1-0007) emits openform newitem', ev41.slice(1));
  await F6.phone.sim.start('S2-0004');
  check(ev41.length === 2 && F6.phone.lastText() === t(F6.ports, 'basket_other_shop', { id: 'S2-0004', shop: shopName(F6.ports, 'S2') }), 'a seller\'s blank tag of the other shop: basket_other_shop and no openform (m7)', F6.phone.lastText());
  W6.ports.store.updateItem('S1-0004', { price: '' });
  await F6.sync.syncNow('t');
  await F6.phone.sim.start('S1-0004');
  check(ev41.length === 3 && ev41[2].kind === 'sale' && ev41[2].req.itemId === 'S1-0004', 'a price-pending piece opens the sale form too (its line flagged ⏳)', ev41.slice(2));
  W6.ports.store.updateItem('S1-0004', { price: 45000 });
  await F6.sync.syncNow('t');
  await F6.phone.sim.start('S1-0006');
  const sold41 = lastBotOf(F6);
  await F6.phone.sim.start('S2-0002');
  const other41 = lastBotOf(F6);
  check(ev41.length === 3 && /S1-0006/.test(sold41.text) && flat(sold41).indexOf('S|S1-0006|1') < 0 && /S2-0002/.test(other41.text) && flat(other41).indexOf('S|S2-0002|1') >= 0,
    'a sold one-of-a-kind piece (S1-0006) and another shop\'s piece (S2-0002) show the item card, no openform', [sold41.text, flat(other41)]);
  await F6.phone.sim.tap(lastBotOf(F6).id, 'K|S1-0002');
  check(ev41.length === 3 && /S1-0002/.test(lastBotOf(F6).text) && flat(lastBotOf(F6)).indexOf('S|S1-0002|1') >= 0, 'K|S1-0002 (☰ 🕘 / 🔍) always shows the item card');
  F6.store.setPref('setting:sale_flow', 'quick');
  await F6.phone.sim.start('S1-0002');
  const q41 = lastBotOf(F6);
  check(ev41.length === 3 && same(appHomeJobs(F6.ports), []) && flat(q41).indexOf('S|S1-0002|1') >= 0 && flat(q41).indexOf('Q|S1-0002') >= 0,
    'with the pref setting:sale_flow = quick: no jobs and the stepper card as today', flat(q41));
  delete F6.store.meta.prefs['setting:sale_flow'];
  await F6.phone.commit('t');

  step('42. Entry points: S|, Q|, QN|, D|, R|, M|exp open the forms and write nothing');
  const c42 = await card(F6, 'S1-0002'), n42 = F6.store.ledger.length;
  ev41.length = 0;
  await F6.phone.sim.tap(c42.id, 'S|S1-0002|3');
  await F6.phone.sim.tap(c42.id, 'Q|S1-0002');
  await F6.phone.sim.tap(c42.id, 'QN|S1-0002');
  await F6.phone.sim.tap(c42.id, 'D|S1-0002');
  await F6.phone.sim.tap(c42.id, 'R|S1-0002');
  await F6.phone.sim.start('');
  await F6.phone.sim.tap(lastBotOf(F6).id, 'M|exp');
  const k42 = ev41.map(e => [e.kind, e.req.itemId || '', e.req.qty || '', e.req.focus || '']);
  check(same(k42, [['sale', 'S1-0002', 3, ''], ['sale', 'S1-0002', 1, ''], ['sale', 'S1-0002', 1, ''], ['sale', 'S1-0002', 1, 'price'], ['restock', 'S1-0002', '', ''], ['expense', '', '', '']]),
    'S|…|3 → sale qty 3; Q| and QN| → qty 1; D| → focus price; R| → restock; M|exp → expense', k42);
  check(F6.store.ledger.length === n42 && getState(F6.ports, uid6) === null, 'none of them writes a row or leaves a state');
  F6.phone.off('openform', on41);

  step('43. The sale model (pure): lines, refusals, the stepper is the count, how paid, part, the new buyer');
  let v = appSaleInit(F6.phone, {});
  check(same(v.lines, []) && v.method === 'CASH' && v.part === false && !v.customerId && !v.restored, 'a fresh sale form: no line, cash, paid in full, no buyer');
  let r = appSaleAdd(F6.phone, v, 'S1-0002', 1); v = r.values;
  v = appSaleSet(F6.phone, v, 'qty+:S1-0002');
  v = appSaleAdd(F6.phone, v, 'S1-0005', 1).values;
  v = appSaleAdd(F6.phone, v, 'S1-0001', 1).values;
  let view = appSaleView(F6.phone, v);
  check(view.lines.length === 3 && view.lines[0].qty === 2 && view.total === 83000 && view.paidNow === 83000 && view.owed === 0, 'S1-0002 × 2, S1-0005, S1-0001: three lines, total 83,000', [view.total, view.lines.map(l => [l.id, l.qty])]);
  const twiceU = appSaleAdd(F6.phone, v, 'S1-0001', 1), twiceS = appSaleAdd(F6.phone, v, 'S1-0002', 1);
  check(!twiceU.ok && twiceU.twice && twiceU.text === t(F6.ports, 'basket_twice', { id: 'S1-0001' }) && !twiceS.ok && twiceS.twice && twiceS.text === t(F6.ports, 'ui_form_twice', { id: 'S1-0002' }) &&
    appSaleLine(v, 'S1-0002').qty === 2, 'a second read: basket_twice for the one-of-a-kind piece, ui_form_twice for the stock item, whose count stays 2 (0.3 rule 14)');
  const dec43 = [], dec43b = [];
  const sc43 = createAppScanner({ video: null, canvas: {}, onDecode: x => dec43.push(x) }), sc43b = createAppScanner({ video: null, canvas: {}, onDecode: x => dec43b.push(x) });
  sc43.holdMs = APP_FORM_SAME_TAG_MS;
  sc43.decoded('S1-0002'); sc43.lastDecodeAt = Date.now() - 3000; sc43.decoded('S1-0002');
  sc43b.decoded('S1-0002'); sc43b.lastDecodeAt = Date.now() - 3000; sc43b.decoded('S1-0002');
  check(dec43.length === 1 && dec43b.length === 2 && sc43.lastDecodeAt > Date.now() - 1000, 'with holdMs a repeat of the same text 3 s later reaches no onDecode (and refreshes the window); without it today\'s 2000 ms rule lets it through (U2)', [dec43.length, dec43b.length]);
  const ref43 = id => appSaleAdd(F6.phone, v, id, 1);
  const lines10 = { lines: [{ id: 'S1-0002', qty: 1, unitPrice: 18000 }].concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => ({ id: 'ZZ-' + i, qty: 1, unitPrice: 1 }))) };
  check(ref43('S2-0002').text === t(F6.ports, 'basket_other_shop', { id: 'S2-0002', shop: shopName(F6.ports, 'S2') }) && ref43('S1-0007').text === t(F6.ports, 'basket_blank', { id: 'S1-0007' }) &&
    ref43('S1-9999').text === t(F6.ports, 'tag_not_found', { id: 'S1-9999' }) && appSaleAdd(F6.phone, lines10, 'S1-0004', 1).text === t(F6.ports, 'basket_max', { max: myDigits(CFG.BASKET_MAX_LINES) }),
    'refused: another shop\'s piece, a blank tag, an unknown tag, the eleventh line', [ref43('S2-0002').text, ref43('S1-0007').text]);
  check(findItemsByName(F6.ports, 'S1', 'ကချင်').some(it => it.id === 'S1-0002'), 'find ကချင် lists S1-0002 (the basket\'s shop)');
  let w = appSaleSet(F6.phone, v, 'found:S1-0003');
  check(w.lines.length === 4 && w.lines[3].id === 'S1-0003' && !w.notice, 'found:S1-0003 adds a line like a scan (U25)');
  w = appSaleSet(F6.phone, v, 'qty:S1-0005', 99);
  view = appSaleView(F6.phone, w);
  const l5 = view.lines.filter(l => l.id === 'S1-0005')[0];
  check(view.lines.filter(l => !l.unique).every(l => typeof l.stock === 'number') && l5.stockOver && !view.lines[0].stockOver, 'every stock-item line has its stock; a count above it is stockOver', [l5.qty, l5.stock]);
  w = appSaleSet(F6.phone, v, 'price:S1-0002', 200000);
  view = appSaleView(F6.phone, w);
  check(view.lines[0].priceFar && view.lines[0].priceChanged && !appSaleProblems(F6.phone, w).length, 'a price of 200,000 on S1-0002 is priceFar (ui_price_far) and Save still finds no problem (U4)');
  w = appSaleSet(F6.phone, v, 'pay:bank');
  check(w.payMode === 'bank' && w.method === 'BANK', 'pay:bank with one bank picks it');
  w = appSaleSet(F6.phone, v, 'pay:mix');
  view = appSaleView(F6.phone, w);
  check(w.mixed && w.method === 'CASH' && same(view.accounts, ['KBZ', 'WAVE', 'BANK']) && !view.showTransfer && appSaleView(F6.phone, appSaleSet(F6.phone, w, 'acct:KBZ')).showTransfer,
    'pay:mix lists every non-cash account and shows the transfer once one is picked', view.accounts);
  const Z6 = await phone6('Z6 scratch', sister);
  addListOptionByLabel(Z6.ports, 'pay_method', 'AYA Pay', Z6.store.meta.staff, { kind: 'wallet' });
  addListOptionByLabel(Z6.ports, 'pay_method', 'CB Pay', Z6.store.meta.staff, { kind: 'wallet' });
  const z = appSaleView(Z6.phone, appSaleAdd(Z6.phone, appSaleInit(Z6.phone, {}), 'S1-0002', 1).values);
  check(z.collapseWallets && !appSaleView(F6.phone, v).collapseWallets, 'with seven how-paid choices the wallets collapse into one pay:wallets choice (U6)', [z.wallets.length, z.collapseWallets]);
  w = appSaleSet(F6.phone, v, 'paid:part');
  view = appSaleView(F6.phone, w);
  check(view.needAmount && view.needDue && view.needBuyer, 'paid:part: the amount, the promised day and the buyer are needed (outlined)');
  w = appSaleSet(F6.phone, appSaleSet(F6.phone, v, 'buyer', '09 777 12'), 'buyer:new');
  const w2 = appSaleSet(F6.phone, appSaleSet(F6.phone, v, 'buyer', 'ဒေါ်နီ'), 'buyer:new');
  check(w.newBuyer && w.newPhone === '09 777 12' && !w.newName && w2.newName === 'ဒေါ်နီ' && !w2.newPhone, 'buyer:new sends typed digits to the phone and a name to the name', [w.newPhone, w2.newName]);

  step('44. Save on the real store: one transaction, one group, one receipt number, the sold card, one scheduled sync');
  await app6(F6, {}, async h => {
    const F = appOpenForm('sale', { itemId: 'S1-0002', qty: 1 });
    appFormDo(F, 'qty+:S1-0002');
    appFormTag(F, 'S1-0005');
    appFormTag(F, 'S1-0001');
    const tx0 = F6.adapter.transactions.length, rc0 = F6.store.meta.receiptCounter, chat0 = F6.store.chat.length;
    timers.queue.length = 0;
    F6.adapter.holdWrites = true;
    const p = appFormSave(F);
    await tick();
    check(APP.form === F && F6.adapter.heldCount() === 1 && !h.els.main.children.some(c => /viewcard/.test(c.className)), 'while the write is held the form stays open and the sold card is not painted');
    F6.adapter.release();
    await p;
    await tick();
    const txn = F6.adapter.transactions[tx0], ops = txn ? txn.ops : [];
    const rowOf = key => F6.store.ledger.filter(z => z.txId === key)[0], entryOf = key => F6.store.outbox.filter(e => e.entryId === key)[0];
    const sales = ops.filter(o => o.store === 'ledger' && o.type === 'put' && rowOf(o.key) && rowOf(o.key).type === 'SALE');
    const groups = ops.filter(o => o.store === 'outbox' && o.type === 'put' && entryOf(o.key) && entryOf(o.key).kind === 'group');
    check(F6.adapter.transactions.length === tx0 + 1 && sales.length === 3 && groups.length === 1 && entryOf(groups[0].key).txs.length === 3 && ops.some(o => o.store === 'chat') &&
      ops.some(o => o.store === 'cache' && o.type === 'delete' && o.key === 'formdraft:sale:' + uid6), 'ONE adapter transaction: the three SALE rows, ONE outbox group, the sold card and the draft removal', ops.map(o => o.store + ':' + o.type));
    const rows = F6.store.ledger.slice(-3);
    check(rows.every(x => x.receiptNo && x.receiptNo === rows[0].receiptNo) && F6.store.meta.receiptCounter === rc0 + 1, 'the three SALE rows carry ONE receiptNo and the counter grew by 1', rows.map(x => x.receiptNo));
    const sold = lastBotOf(F6);
    check(APP.form === null && sold.text.indexOf(prefixOf6(F6, 'basket_sold')) === 0 && sold.view && sold.view.kind === 'sold' && F6.store.chat.length > chat0 && APP.showScanner === false &&
      h.els.main.children.some(c => /viewcard/.test(c.className)), 'then the form closes and the home shows the sold card (basket_sold, a sold view)', sold.text.split('\n')[0]);
    const sc = timers.queue.filter(x => x.ms === APP_SYNC_DEBOUNCE_MS);
    check(sc.length === 1 && timers.queue.length === 1, 'scheduleSync once, at APP_SYNC_DEBOUNCE_MS', timers.queue.map(x => x.ms));
    timers.queue.length = 0;
    const q0 = S6.quarantine.length, s44 = await F6.sync.syncNow('t');
    const srv = W6.ledger.filter(x => x.groupId === rows[0].groupId);
    check(s44.ok && srv.length === 3 && srv.every(x => x.type === 'SALE') && S6.quarantine.length === q0 && !s44.flagged.length, 'after the sync the server has the three rows in one group, no quarantine, no flag', [srv.length, s44.flagged]);
    ctx.basket44 = rows[0].groupId;
  });

  step('45. A part payment with a new buyer: each missing answer refused, then the customer and the group; U8 and U9');
  const base45 = () => { let x = appSaleInit(F6.phone, {}); ['S1-0002', 'S1-0003', 'S1-0005'].forEach(id => { x = appSaleAdd(F6.phone, x, id, 1).values; }); return x; };
  const save45 = vals => { const F = { values: vals, saving: false }; const res = appSaleSave(F6.phone, F); return { res, F }; };
  const n45 = F6.store.ledger.length, o45 = F6.store.outbox.length, c45 = F6.store.customers.length;
  let a = save45(appSaleSet(F6.phone, base45(), 'paid:part'));
  const b = save45(appSaleSet(F6.phone, appSaleSet(F6.phone, base45(), 'paid:part'), 'amount', 30000));
  let x45 = appSaleSet(F6.phone, appSaleSet(F6.phone, base45(), 'paid:part'), 'amount', 30000);
  x45 = appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleSet(F6.phone, x45, 'buyer:new'), 'name', 'ဒေါ်လှလှ'), 'phone', '09777123456');
  const c = save45(x45);
  check(a.res.problems[0].key === 'sale_ask_paid' && b.res.problems[0].key === 'sale_need_buyer' && c.res.problems[0].key === 'sale_ask_due' &&
    F6.store.ledger.length === n45 && F6.store.outbox.length === o45 && F6.store.customers.length === c45, 'part without an amount: sale_ask_paid; with it and no buyer: sale_need_buyer; with a buyer and no day: sale_ask_due; nothing written',
    [a.res.problems[0].key, b.res.problems[0].key, c.res.problems[0].key]);
  const d45 = save45(appSaleSet(F6.phone, c.F.values, 'due:14'));
  const rows45 = F6.store.ledger.slice(-3), lhla = F6.store.customers.filter(z => z.name === 'ဒေါ်လှလှ')[0];
  check(d45.res.ok && same(F6.store.outbox.slice(o45).map(e => e.kind), ['customer', 'group']) && same(rows45.map(z => z.cash), [18000, 12000, 0]) &&
    rows45.every(z => z.dueDay === addDaysKey(today6(), 14) && z.customerId === lhla.id), 'then the outbox is [customer, group]; cash 18,000 / 12,000 / 0 in line order; DueDay +14 and the buyer on all three',
    rows45.map(z => [z.cash, z.dueDay, z.customerId]));
  const cr45 = openCredits(F6.ports, 'S1').filter(z => z.groupId === rows45[0].groupId);
  check(cr45.length === 1 && cr45[0].item === basketName(F6.ports, saleGroupInfo(F6.ports, rows45[0].groupId)), 'openCredits gives one entry for the basket, named basketName', cr45.map(z => z.item));
  const one45 = () => appSaleAdd(F6.phone, appSaleInit(F6.phone, {}), 'S1-0003', 1).values;
  a = save45(appSaleSet(F6.phone, one45(), 'buyer', 'ဒေါ်နီနီ'));
  const nini = F6.store.customers.filter(z => z.name === 'ဒေါ်နီနီ')[0];
  check(a.res.ok && nini && F6.store.ledger[F6.store.ledger.length - 1].customerId === nini.id, 'search text that matches nobody, left without a pick, is a new buyer at Save (U8)');
  const n45b = F6.store.ledger.length;
  a = save45(appSaleSet(F6.phone, one45(), 'buyer', 'ဒေါ်'));
  check(!a.res.ok && a.res.reason === 'buyer_pick' && a.res.problems[0].key === 'ui_buyer_pick_first' && F6.store.ledger.length === n45b, 'search text that matches customers, none picked: buyer_pick, nothing written (U8)');
  let k = appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleSet(F6.phone, one45(), 'buyer:new'), 'name', 'ဦးဘ'), 'phone', '09 123 456 78');
  a = save45(k);
  check(!a.res.ok && a.res.reason === 'known_phone' && a.res.problems[0].customerIds[0] === 'C-0001' && appSaleView(F6.phone, k).knownPhone[0].id === 'C-0001' && F6.store.ledger.length === n45b,
    'a new buyer with ဒေါ်မြင့်\'s phone: known_phone with her chip, nothing written (U9)');
  const c45b = F6.store.customers.length;
  a = save45(appSaleSet(F6.phone, k, 'buyer:C-0001'));
  check(a.res.ok && F6.store.customers.length === c45b && F6.store.ledger[F6.store.ledger.length - 1].customerId === 'C-0001', 'tapping her chip uses C-0001 (no new Customers row)');
  k = appSaleSet(F6.phone, appSaleSet(F6.phone, one45(), 'buyer:new'), 'name', 'ဒေါ်မြင့်');
  a = save45(k);
  const n45c = F6.store.ledger.length;
  check(!a.res.ok && a.res.reason === 'same_name' && appSaleView(F6.phone, k).sameName.id === 'C-0001', '✏️ new ဒေါ်မြင့် (an exact name): same_name, the customer offered as a chip');
  a = save45(appSaleSet(F6.phone, k, 'buyer:create'));
  check(a.res.ok && F6.store.customers.filter(z => z.name === 'ဒေါ်မြင့်').length === 2 && F6.store.ledger.length === n45c + 1, 'buyer:create then Save: a SECOND Customers row ဒေါ်မြင့် (forceNew)');
  await F6.sync.syncNow('t');

  step('46. Mixed payment and a new account: the PAYMENT last, one receipt number, canMix, the Lists row at Save only');
  const base46 = () => { let x = appSaleInit(F6.phone, {}); ['S1-0002', 'S1-0003', 'S1-0005'].forEach(id => { x = appSaleAdd(F6.phone, x, id, 1).values; }); return x; };
  let m46 = appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleSet(F6.phone, base46(), 'pay:mix'), 'acct:KBZ'), 'transfer', 20000);
  const F46 = { values: m46, saving: false };
  const r46 = appSaleSave(F6.phone, F46);
  const g46 = F6.store.ledger.filter(z => z.groupId === r46.groupId);
  check(r46.ok && same(g46.map(z => z.type), ['SALE', 'SALE', 'SALE', 'PAYMENT']) && g46[3].amount === 20000 && g46[3].method === 'KBZ' && same(g46.slice(0, 3).map(z => z.cash), [18000, 12000, 2000]),
    'KBZ 20,000 of 52,000 in full: three SALE rows (32,000 cash in line order) and the PAYMENT last', g46.map(z => [z.type, z.cash, z.method]));
  check(g46.slice(0, 3).every(z => z.receiptNo && z.receiptNo === g46[0].receiptNo) && !g46[3].receiptNo, 'the three SALE rows carry ONE receiptNo, the PAYMENT none (B11)');
  const s46 = await F6.sync.syncNow('t');
  check(s46.ok && !s46.quarantined.length && !s46.flagged.some(f => f.flags.indexOf('overpaid') >= 0) && W6.ledger.filter(z => z.groupId === r46.groupId).length === 4, 'the server takes the four rows: no quarantine, no OVERPAID');
  check(!appSaleView(F6.phone, { lines: [{ id: 'S1-0002', qty: 1, unitPrice: 1 }] }).canMix && appSaleView(F6.phone, base46()).canMix, 'a total of 1 offers no 💵+🏦');
  const lists46 = F6.store.outbox.filter(e => e.kind === 'list').length, l46 = F6.store.ledger.length;
  let a46 = appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleSet(F6.phone, base46(), 'pay:bank'), 'acct:add'), 'acctname', 'AYA ဘဏ်'), 'acctkind:bank');
  const ref46 = appSaleSave(F6.phone, { values: appSaleSet(F6.phone, a46, 'paid:part'), saving: false });
  check(!ref46.ok && F6.store.outbox.filter(e => e.kind === 'list').length === lists46 && F6.store.ledger.length === l46 && listFindByLabel(F6.ports, 'pay_method', 'AYA ဘဏ်').existed !== true,
    'a typed account and a refused Save: no Lists row, no ledger row', ref46.reason);
  const t46 = F6.adapter.transactions.length, ob46 = F6.store.outbox.length;
  const ok46 = appSaleSave(F6.phone, { values: a46, saving: false });
  await F6.phone.commit('sale');
  const aya = listFindByLabel(F6.ports, 'pay_method', 'AYA ဘဏ်');
  const tops = (F6.adapter.transactions[t46] || { ops: [] }).ops.filter(o => o.store === 'outbox' && o.type === 'put').map(o => (F6.store.outbox.filter(e => e.entryId === o.key)[0] || {}).kind);
  check(ok46.ok && same(F6.store.outbox.slice(ob46).map(e => e.kind), ['list', 'group']) && F6.adapter.transactions.length === t46 + 1 && same(tops, ['list', 'group']) && aya.existed &&
    F6.store.ledger.filter(z => z.groupId === ok46.groupId).every(z => z.method === aya.key || !z.cash), 'the accepted Save writes [list, group] in ONE transaction and the new account is the method', tops);
  check(flat(lastBotOf(F6)).indexOf('LD|pm|' + aya.key) >= 0 && lastBotOf(F6).view.extra.length === 1, 'the sold card carries 🔢 btn_acct_number (LD|pm|<key>) and the number hint', flat(lastBotOf(F6)));
  const p46 = appSaleSave(F6.phone, { values: appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleSet(F6.phone, base46(), 'pay:add'), 'acctname', 'MAB Pay'), 'acctkind:wallet'), saving: false });
  const mab = listFindByLabel(F6.ports, 'pay_method', 'MAB Pay');
  check(p46.ok && mab.existed && F6.store.ledger.filter(z => z.groupId === p46.groupId).every(z => z.method === mab.key) && (listOption(F6.ports, 'pay_method', mab.key) || {}).kind === 'wallet',
    'pay:add + a typed wallet makes it the method (U7)', mab.key);
  await F6.sync.syncNow('t');

  step('47. The draft: restored after a restart, gone after 1801 s, the draft rule of U3 (restore, older, merge, 🔄)');
  await app6(F6, {}, async h => {
    const F = appOpenForm('sale', { itemId: 'S1-0002', qty: 1 });
    appFormDo(F, 'qty+:S1-0002');
    await h.flush();
    appCloseForm({ keep: true });
    const before = h.els.main.children[0];
    appOnChange({ kind: 'formdraft', durable: true });
    check(h.els.main.children[0] === before, 'a formdraft change does not repaint the home');
  });
  const F6r = await phone6('F6 again', null, { adapter: F6.adapter });
  const r47 = appSaleInit(F6r.phone, {});
  check(r47.restored && r47.lines.length === 1 && r47.lines[0].id === 'S1-0002' && r47.lines[0].qty === 2, 'a restart over the same adapter: 🛒 restores the sale draft (ui_form_restored)', r47.lines);
  const r47b = appSaleInit(F6r.phone, { itemId: 'S1-0002', qty: 1 });
  check(r47b.restored && r47b.lines.length === 1 && r47b.lines[0].qty === 2 && !r47b.older.length, 'an openform for S1-0002, already a line: the draft restored, its count still 2 (U3)');
  const r47c = appSaleInit(F6r.phone, { itemId: 'S1-0005', qty: 1 });
  check(!r47c.restored && same(r47c.lines.map(z => z.id), ['S1-0005']) && same(r47c.older.map(z => [z.id, z.qty]), [['S1-0002', 2]]), 'an openform for S1-0005: ONE line S1-0005, the old lines in older (ui_form_older)', r47c);
  const m47 = appSaleSet(F6r.phone, r47c, 'restored:merge'), cl47 = appSaleSet(F6r.phone, r47c, 'restored:clear');
  check(same(m47.lines.map(z => [z.id, z.qty]), [['S1-0002', 2], ['S1-0005', 1]]) && !m47.older.length && same(cl47.lines.map(z => z.id), ['S1-0005']) && !cl47.older.length,
    'restored:merge gives S1-0002 × 2 then S1-0005; 🔄 keeps S1-0005 only');
  const n47 = F6r.store.ledger.length, sv47 = appSaleSave(F6r.phone, { values: r47c, saving: false });
  const g47 = F6r.store.ledger.slice(n47);
  check(sv47.ok && g47.length === 1 && g47[0].itemId === 'S1-0005' && appFormDraftRead(F6r.store, 'sale', uid6) === null, 'Save writes only S1-0005 and drops the draft', g47.map(z => z.itemId));
  await F6r.phone.commit('t');
  appFormDraftWrite(F6r.store, 'sale', uid6, { lines: [{ id: 'S1-0003', qty: 1, unitPrice: 12000 }] });
  W6.nowOverride = new Date(W6.ports.clock.now().getTime() + 1801000);
  check(appFormDraftRead(F6r.store, 'sale', uid6) === null && !appSaleInit(F6r.phone, {}).restored, '1801 s later the draft is gone (TTL CFG.STATE_TTL_SEC)');
  W6.nowOverride = null;
  await F6r.sync.syncNow('t');

  step('48. Sold meanwhile, an older server, a retired account: Save refuses and writes nothing');
  await F6.sync.syncNow('t');
  let v48 = appSaleAdd(F6.phone, appSaleInit(F6.phone, {}), 'S1-0004', 1).values;
  appFormDraftWrite(F6.store, 'sale', uid6, v48);
  const sv48b = appSaleSave(F6b.phone, { values: appSaleAdd(F6b.phone, appSaleInit(F6b.phone, {}), 'S1-0004', 1).values, saving: false });
  await F6b.phone.commit('t');
  await F6b.sync.syncNow('t');
  await F6.sync.syncNow('t');
  const n48 = F6.store.ledger.length, r48 = appSaleSave(F6.phone, { values: v48, saving: false });
  check(sv48b.ok && !r48.ok && r48.reason === 'gone' && r48.problems[0].key === 'basket_line_gone' && F6.store.ledger.length === n48, 'F6b sold S1-0004 and synced; F6\'s Save: basket_line_gone, nothing written', r48.reason);
  const i48 = appSaleInit(F6.phone, {});
  check(!i48.lines.some(z => z.id === 'S1-0004') && i48.notice === t(F6.ports, 'basket_gone', { id: 'S1-0004' }), 'a restored line whose one-of-a-kind piece was sold meanwhile is dropped with basket_gone');
  appFormDraftDrop(F6.store, 'sale', uid6);
  const st48 = { old: true };
  const t48 = (api, body) => { const res = tr6(api, body); if (api === 'sync' && res && res.pull && st48.old) delete res.pull.caps; return res; };
  const Q6 = await phone6('Q6 older server', sister, { transport: t48 });
  await Q6.sync.syncNow('t');
  check(saleFlow(Q6.ports) === 'quick' && Q6.store.meta.cursor.quickForced === true, 'setup: an older server forces quick (quickForced)');
  await app6(Q6, {}, async h => {
    const F = { kind: 'sale', values: appSaleAdd(Q6.phone, appSaleInit(Q6.phone, {}), 'S1-0002', 1).values };
    const G = appOpenForm('sale', {});
    G.values = F.values;
    const n = Q6.store.ledger.length;
    await appFormSave(G);
    check(APP.form === null && h.toastOf() === appPlain(MSG.expired) && Q6.store.ledger.length === n, 'Save on a phone now quick: the form closes with the toast expired, nothing written (U17)', h.toastOf());
  });
  W6.lists.forEach(z => { if (z.list === 'pay_method' && z.key === 'WAVE') z.active = false; });
  let k48 = appSaleSet(F6.phone, appSaleAdd(F6.phone, appSaleInit(F6.phone, {}), 'S1-0002', 1).values, 'pay:WAVE');
  await F6.sync.syncNow('t');
  const F48 = { values: k48, saving: false }, n48b = F6.store.ledger.length, r48b = appSaleSave(F6.phone, F48);
  check(payMethods(F6.ports, 'S1').indexOf('WAVE') < 0 && !r48b.ok && r48b.problems[0].key === 'basket_method_gone' && F48.values.method === 'CASH' && F6.store.ledger.length === n48b,
    'a WavePay draft whose account a pull retired: basket_method_gone, the method back to cash, nothing written (U21h)', r48b.reason);
  W6.lists.forEach(z => { if (z.list === 'pay_method' && z.key === 'WAVE') z.active = true; });
  await F6.sync.syncNow('t');

  step('49. A double Save and two openform requests within one tick');
  const F49 = { values: appSaleAdd(F6.phone, appSaleInit(F6.phone, {}), 'S1-0003', 1).values, saving: false }, n49 = F6.store.ledger.length;
  const a49 = appSaleSave(F6.phone, F49), b49 = appSaleSave(F6.phone, F49);
  check(a49.ok && !b49.ok && b49.reason === 'busy' && F6.store.ledger.length === n49 + 1, 'a second appSaleSave while F.saving answers busy; one group');
  await F6.phone.commit('t');
  await app6(F6, {}, async h => {
    F6.phone.emit('openform', { kind: 'sale', req: { itemId: 'S1-0002', qty: 3 } });
    F6.phone.emit('openform', { kind: 'sale', req: { itemId: 'S1-0002', qty: 3 } });
    await h.flush();
    check(APP.form && same(APP.form.values.lines.map(z => [z.id, z.qty]), [['S1-0002', 3]]), 'two openform sale requests for S1-0002 × 3 within one tick give ONE line of 3 (U23)', APP.form && APP.form.values.lines);
    const F49b = APP.form;
    F6.phone.emit('openform', { kind: 'sale', req: { itemId: 'S1-0002', qty: 3 } });
    F6.phone.emit('openform', { kind: 'sale', req: { itemId: 'S1-0005', qty: 1 } });
    await h.flush();
    check(APP.form === F49b && same(F49b.values.lines.map(z => [z.id, z.qty]), [['S1-0002', 3], ['S1-0005', 1]]), 'while the sale form is open: the same id again changes nothing, another id joins as a line (U23)', F49b.values.lines);
    appCloseForm({});
  });
  await F6.sync.syncNow('t');
  await round6b(ctx);
}
/** A key's text up to its first '{' (the label rule). */
function prefixOf6(P, key) { return msgTemplate(P.ports, key).split('{')[0].trim(); }

async function round6b(ctx) {
  const { W6, S6, net6, phone6, F6, O6, uid6, same, flat, noErrors, today6, card } = ctx;
  const lastBotOf = P => P.phone.sim.lastBot();

  step('50. The new piece: the photo at Save, the counted piece, the queue after the item entry (M1), the undo (M5), not_blank (U13)');
  const N6 = await phone6('N6 sister', sister), uidN = N6.phone.staffId();
  let v50 = appNewItemInit(N6.phone, { itemId: 'S1-0007' });
  v50 = appNewItemPhoto(N6.phone, v50, { sim: { meta: SIM_PHOTOS[0], visual: SIM_PHOTOS[0].visual, mimeType: 'image/jpeg' } });
  const m50 = N6.store.getMedia(v50.photo);
  check(m50 && m50.status === 'file' && !N6.store.queuedMedia().length && !N6.store.outbox.length, 'a photo in the form: one media record of status file, no job queued, nothing in the outbox');
  check(appNewItemView(N6.phone, v50).nameLater, 'photo taken, name empty, AI on: the hint ui_form_name_later shows');
  v50 = appNewItemSet(N6.phone, v50, 'count', 3);
  v50 = appNewItemSet(N6.phone, v50, 'price:25000');
  v50 = appNewItemSet(N6.phone, v50, 'cost', 12000);
  const view50 = appNewItemView(N6.phone, v50);
  check(view50.margin && view50.margin.profit === 13000 && view50.margin.pct === 108 && view50.skuHint && !view50.loss, 'price 25,000 over cost 12,000: profit 13,000, 108% on cost; count 3 is a stock item (the hint)', view50.margin);
  let F50 = { kind: 'newitem', values: v50, saving: false };
  const r50 = appNewItemSave(N6.phone, F50);
  const it50 = N6.ports.store.getItem('S1-0007'), ob50 = N6.store.outbox;
  check(r50.ok && same(ob50.map(e => e.kind), ['item', 'group']) && ob50[0].fields.type === 'SKU' && ob50[0].fields.name === itemPlaceholderName('S1-0007') &&
    ob50[0].fields.photoUrl === 'local://' + v50.photo && ob50[0].fields.photoFileId === v50.photo, 'Save: the outbox is [item, group]: SKU, the placeholder name, photoUrl local://<media>, photoFileId the media id', ob50[0].fields);
  const rs50 = N6.store.ledger.filter(z => z.itemId === 'S1-0007');
  check(it50.stock === 3 && rs50.length === 1 && rs50[0].type === 'RESTOCK' && rs50[0].qty === 3 && rs50[0].note === 'new item', 'stock 3 from ONE RESTOCK +3 noted new item');
  const job50 = N6.store.queuedMedia();
  check(job50.length === 1 && job50[0].kind === 'photo' && job50[0].itemId === 'S1-0007', 'the photo job is queued at Save, for S1-0007', job50.map(j => [j.kind, j.itemId]));
  const card50 = lastBotOf(N6), items50 = N6.store.chat.slice(-2);
  check(items50[0].text === t(N6.ports, 'item_created') + ' · S1-0007' && flat(card50)[0] === 'U|' + r50.groupId && card50.view && card50.view.kind === 'item',
    'the reply: item_created · S1-0007, then the piece\'s card with U|<g> first (M5) and its item view', flat(card50));
  await N6.phone.commit('t');
  // M1: the Save happens while a sync is in flight (its response held): that sync's flush sends no job; the again sync acks the item entry first.
  const N6b = await phone6('N6b sister', sister);
  let w50 = appNewItemPhoto(N6b.phone, appNewItemInit(N6b.phone, { itemId: 'S1-0008' }), { sim: { meta: SIM_PHOTOS[1], visual: SIM_PHOTOS[1].visual, mimeType: 'image/jpeg' } });
  w50 = appNewItemSet(N6b.phone, w50, 'price:15000');
  appFormDraftWrite(N6b.store, 'newitem', 'S1-0008', w50);
  await N6b.phone.commit('t');
  net6.holdApi = 'sync';
  const ai0 = S6.aiCalls, flight = N6b.sync.syncNow('t');
  await tick(5);
  const rb50 = appNewItemSave(N6b.phone, { kind: 'newitem', values: w50, saving: false });
  await N6b.phone.commit('t');
  N6b.sync.wanted = true;
  net6.holdApi = null;
  while (net6.held.length) net6.held.shift()();
  await flight;
  await tick(20);
  const srv50 = W6.ports.store.getItem('S1-0008');
  check(rb50.ok && !N6b.store.queuedMedia().length && S6.aiCalls === ai0 + 1 && srv50 && /^drive:\/\//.test(srv50.photoUrl) && srv50.name === 'အင်္ကျီ ရင်ဖုံး ပန်းရောင်' &&
    !W6.errors.some(e => /sync_conflict/.test(e.message || '')), 'M1: the held sync sent no job; the again sync acked the item entry, then ONE ai call: the Drive photoUrl, the AI name, no sync_conflict', [S6.aiCalls - ai0, srv50 && srv50.photoUrl]);
  check(N6b.ports.store.getItem('S1-0008').name === 'အင်္ကျီ ရင်ဖုံး ပန်းရောင်' && /aiRenameFields\(item, j\.desc, itemCategoryCats\(job\.ctx, phone\.ports, item\.shop\)\)/.test(createAppSync.toString()), 'the phone\'s replay renamed the placeholder through aiRenameFields (the server\'s rule)');
  // U14: the photo_seen line goes before the latest card with buttons.
  const lastN6b = lastBotOf(N6b);
  check(lastN6b && lastN6b.keyboard.length && lastN6b.view && lastN6b.view.kind === 'item' && N6b.store.chat.some(m => m.text && m.text.indexOf(prefixOf6(N6b, 'photo_seen')) === 0),
    'U14: the replay\'s photo_seen line sits before the card, which stays the latest (appLatestBot is still the card)', lastN6b && lastN6b.text);
  // A pending price: the owner's notice with SP| buttons.
  let p50 = appNewItemSet(N6.phone, appNewItemInit(N6.phone, { itemId: 'S1-0009' }), 'pending');
  const rp50 = appNewItemSave(N6.phone, { kind: 'newitem', values: p50, saving: false });
  const nt50 = N6.store.outbox.filter(e => e.kind === 'notice').slice(-1)[0];
  check(rp50.ok && nt50 && nt50.text === t(N6.ports, 'price_ask_owner', { id: 'S1-0009', name: itemPlaceholderName('S1-0009') }) && nt50.kb.some(row => row.some(b => /^SP\|S1-0009\|/.test(b.callback_data))),
    'a pending price: an outbox notice to the owner (price_ask_owner) with the SP| buttons', nt50 && nt50.text);
  check(appNewItemSave(N6.phone, { kind: 'newitem', values: appNewItemInit(N6.phone, { itemId: 'S1-0010' }), saving: false }).problems[0].key === 'ask_price', 'neither a price nor pending: ask_price');
  await N6.phone.commit('t');
  // ✖️ after a photo: the media goes, the tag stays BLANK; a non-blank tag into the waiting form; a seller's S2 blank tag.
  await app6(N6, {}, async h => {
    const F = appOpenForm('newitem', { itemId: 'S1-0010' });
    appFormPhoto({ sim: { meta: SIM_PHOTOS[2], visual: SIM_PHOTOS[2].visual, mimeType: 'image/jpeg' } });
    const mid = F.values.photo;
    check(!!N6.store.getMedia(mid) && F.dirty, 'setup: a photo in the open form');
    appNavBack();
    const askL = fakeWalk(h.els.overlay).filter(e => e.attrs['data-f'] === 'ask:yes')[0];
    check(!h.els.overlay.hidden && askL && APP.form === F && h.els.overlay.children[0].attrs['data-ask'] === 'leave' && !!N6.store.getMedia(mid),
      '← on the changed form opens the app\'s own question (data-ask leave) and the form stays meanwhile (UX review)');
    askL.click();
    check(APP.form === null && h.els.overlay.hidden && !N6.store.getMedia(mid) && N6.ports.store.getItem('S1-0010').status === 'BLANK', 'its leave button: the unsaved photo is removed and the tag stays BLANK');
    const G = appOpenForm('newitem', {});
    appFormTag(G, 'S1-0002');
    const t1 = h.toastOf();
    appFormTag(G, 'S2-0004');
    const t2 = h.toastOf();
    check(!G.values.tag && t1 === appPlain(t(N6.ports, 'tag_not_blank', { id: 'S1-0002' })) && t2 === appPlain(t(N6.ports, 'basket_other_shop', { id: 'S2-0004', shop: shopName(N6.ports, 'S2') })),
      'a non-blank tag into the waiting form: tag_not_blank; a seller\'s blank S2 tag: basket_other_shop (m7)', [t1, t2]);
    appFormTag(G, 'S1-0011');
    check(G.values.tag === 'S1-0011' && !appFormWantsScan(G) && !G.scan, 'an accepted blank tag becomes the form\'s tag and stops the form\'s scanner (U16)');
    appFormPhoto({ sim: { meta: SIM_PHOTOS[3], visual: SIM_PHOTOS[3].visual, mimeType: 'image/jpeg' } });
    appFormDo(G, 'price:22000');
    appFormDo(G, 'cost', 9000);
    appFormDo(G, 'count', 2);
    W6.ports.store.updateItem('S1-0011', { name: 'somebody else', type: 'UNIQUE', price: 1000 });
    await N6.sync.syncNow('t');
    await appFormSave(G);
    check(APP.form === G && !G.values.tag && G.values.photo && G.values.price === 22000 && G.values.cost === 9000 && G.values.count === 2 && appFormWantsScan(G) &&
      textOf(G.bar).indexOf(appPlain(t(N6.ports, 'tag_not_blank', { id: 'S1-0011' }))) >= 0, 'U13: a Save refused not_blank keeps the photo, price, cost and count, clears the tag, shows tag_not_blank and the strip again', G.values);
    let stopped = 0, clicked = 0;
    APP.scanner = { running: true, stop() { stopped++; this.running = false; }, start() { return Promise.resolve('jsqr'); } };
    h.els.photoInput.click = () => { clicked = stopped; };
    appFormClick(G, 'photo');
    check(clicked === 1 && !G.scan, 'U16: the Photo tap stops the scanner BEFORE the photo input\'s click', [stopped, clicked]);
    APP.scanner = null;
    appCloseForm({});
  });
  // M5: U| within 30 minutes leaves S1-0007 BLANK with stock 0.
  await N6.sync.syncNow('t');
  const c50 = await card(N6, 'S1-0007');
  await N6.phone.sim.tap(lastBotOf(N6).id, 'U|' + r50.groupId);
  const after50 = N6.ports.store.getItem('S1-0007');
  check(after50.status === 'BLANK' && after50.stock === 0 && N6.store.outbox.slice(-2).map(e => e.kind).join() === 'group,item', 'M5: the undo within 30 minutes leaves S1-0007 BLANK with stock 0 (the mirror group and one item entry of blanks)',
    N6.store.outbox.map(e => e.kind));
  await N6.sync.syncNow('t');
  check(noErrors(N6) && noErrors(N6b), 'no exception on the new-piece phones');

  step('51. Restock: one group of two RESTOCK rows, the reply with its group view, basket_unique, the undo mirrors both');
  let v51 = appRestockAdd(F6.phone, appRestockInit(F6.phone, {}), 'S1-0002').values;
  v51 = appRestockSet(F6.phone, v51, 'qtyset:S1-0002:5');
  v51 = appRestockAdd(F6.phone, v51, 'S1-0003').values;
  v51 = appRestockSet(F6.phone, appRestockSet(F6.phone, v51, 'qty+:S1-0003'), 'qty+:S1-0003');
  const u51 = appRestockAdd(F6.phone, v51, 'S1-0001'), tw51 = appRestockAdd(F6.phone, v51, 'S1-0002');
  check(!u51.ok && u51.text === t(F6.ports, 'basket_unique', { id: 'S1-0001' }) && !tw51.ok && tw51.text === t(F6.ports, 'ui_form_twice', { id: 'S1-0002' }),
    'refused: a one-of-a-kind piece (basket_unique); the same stock item again (ui_form_twice, the stepper is the count)');
  const vw51 = appRestockView(F6.phone, v51), st51 = F6.phone.stockOf('S1-0002');
  check(vw51.lines[0].qty === 5 && vw51.lines[0].after === st51 + 5 && vw51.lines[1].qty === 3, 'the chip sets 5, the stepper gives 3; the line reads now → after', vw51.lines);
  const r51 = appRestockSave(F6.phone, { values: v51, saving: false });
  const g51 = F6.store.ledger.filter(z => z.groupId === r51.groupId), rep51 = lastBotOf(F6);
  check(r51.ok && g51.length === 2 && g51.every(z => z.type === 'RESTOCK') && same(g51.map(z => z.qty), [5, 3]) && g51[0].time === g51[1].time, 'ONE group of two RESTOCK rows (+5, +3), one clock read');
  check(rep51.text.split('\n')[0] === t(F6.ports, 'restock_group_done', { n: fmtCount(2), qty: fmtCount(8) }) && rep51.text.split('\n').length === 3 && same(flat(rep51), ['U|' + r51.groupId]) &&
    rep51.view && rep51.view.kind === 'group' && rep51.view.id === r51.groupId, 'the reply: restock_group_done, two group_item_line lines, the undo row, a group view', rep51.text);
  await F6.phone.sim.tap(rep51.id, 'U|' + r51.groupId);
  check(F6.store.ledger.filter(z => z.groupId === r51.groupId && z.reversesTxId).length === 2 && F6.phone.stockOf('S1-0002') === st51, 'the undo mirrors both rows');
  await F6.phone.commit('t');

  step('52. Expense: one EXPENSE row with its note, a new category in the same commit, the amount refused at 0, the owner\'s shop');
  let v52 = appExpenseSet(F6.phone, appExpenseSet(F6.phone, appExpenseSet(F6.phone, appExpenseInit(F6.phone, {}), 'cat:fabric'), 'amount:20000'), 'note', 'ပိုးထည် ၂ ကိုက်');
  const n52 = F6.store.ledger.length, r52 = appExpenseSave(F6.phone, { values: v52, saving: false });
  const e52 = F6.store.ledger.slice(n52), rp52 = lastBotOf(F6);
  check(r52.ok && e52.length === 1 && e52[0].type === 'EXPENSE' && e52[0].amount === -20000 && e52[0].category === 'fabric' && e52[0].method === 'CASH' && e52[0].note === 'ပိုးထည် ၂ ကိုက်',
    'fabric, 20,000, cash, a note: ONE EXPENSE row with the note in it (no rewrite row)', e52.map(z => [z.type, z.amount, z.note]));
  check(rp52.text === t(F6.ports, 'expense_done', { amount: fmtMoney(20000), cat: categoryLabel(F6.ports, 'fabric'), note: ' · ပိုးထည် ၂ ကိုက်', method: methodLabel(F6.ports, 'CASH') }) &&
    same(flat(rp52), ['U|' + r52.groupId]) && rp52.view.kind === 'group', 'the reply: expense_done with the note, undoRow, a group view (U20)', rp52.text);
  const z52 = appExpenseSave(F6.phone, { values: appExpenseSet(F6.phone, v52, 'amount', 0), saving: false });
  check(!z52.ok && z52.problems[0].key === 'ask_number' && F6.store.ledger.length === n52 + 1, 'an amount of 0: ask_number, nothing written');
  const ob52 = F6.store.outbox.length;
  const nc52 = appExpenseSave(F6.phone, { values: appExpenseSet(F6.phone, appExpenseSet(F6.phone, v52, 'cat:add'), 'catname', 'ရေဖိုး'), saving: false });
  check(nc52.ok && same(F6.store.outbox.slice(ob52).map(e => e.kind), ['list', 'group']) && expenseCategories(F6.ports, 'S1').some(cx => cx[1] === 'ရေဖိုး'), 'a new category typed: the outbox [list, group]');
  const ov = appExpenseView(O6.phone, appExpenseInit(O6.phone, {}));
  const ro52 = appExpenseSave(O6.phone, { values: appExpenseSet(O6.phone, appExpenseSet(O6.phone, appExpenseSet(O6.phone, appExpenseInit(O6.phone, {}), 'shop:S2'), 'cat:transport'), 'amount:5000'), saving: false });
  check(ov.owner && same(ov.shops, CFG.SHOP_IDS) && !appExpenseView(F6.phone, v52).owner && ro52.ok && O6.store.ledger.slice(-1)[0].shop === 'S2', 'the owner\'s form offers the shops (CFG.SHOP_IDS) and books S2 when chosen; a seller\'s has no shop control');
  await F6.phone.commit('t');
  await O6.phone.commit('t');

  step('53. The glue on a fake app: Save waits for the commit, failNext, a throw, the camera owner (U1), U5, the keypad and the date sheet (B5)');
  await app6(F6, {}, async h => {
    let F = appOpenForm('sale', { itemId: 'S1-0002', qty: 1 });
    F6.adapter.holdWrites = true;
    const p = appFormSave(F);
    await tick();
    check(APP.form === F && F.saving, 'appFormSave: the form stays open until phone.commit resolves');
    F6.adapter.release();
    await p;
    check(APP.form === null, 'and closes after it');
    F = appOpenForm('sale', { itemId: 'S1-0003', qty: 1 });
    F6.adapter.failNext = true;
    await appFormSave(F);
    await tick(5);
    check(APP.form === null && h.toastOf() === appPlain(t(F6.ports, 'ui_not_saved')) && F6.store.pendingOps > 0, 'failNext: ui_not_saved, the form closes, the ops kept for the next commit', h.toastOf());
    await F6.phone.commit('t');
    F = appOpenForm('sale', { itemId: 'S1-0003', qty: 1 });
    const realCommit = basketCommitDraft, errs0 = F6.store.errors.length;
    global.basketCommitDraft = () => { throw new Error('boom'); };
    try { await appFormSave(F); } finally { global.basketCommitDraft = realCommit; }
    const save53 = fOf(F.bar, 'save')[0];
    check(APP.form === F && !F.saving && textOf(F.bar).indexOf(appPlain(MSG.expired)) >= 0 && save53 && !save53.attrs.disabled && F6.store.errors.slice(errs0).some(e => e.where === 'form'),
      'a save that throws: expired in .fmsg, Save enabled again, logError(form) called (U18)');
    // U1: the form owns the camera.
    const sc = { running: false, start() { this.running = true; return Promise.resolve('jsqr'); }, stop() { this.running = false; }, holdMs: null, hasTorch: true, toggleTorch() {} };
    APP.scanner = sc;
    APP.store.setPref('cameraOk', true);
    appFormScanStart(F);
    await tick();
    APP.showScanner = false;
    appRender();
    check(sc.running && sc.holdMs === APP_FORM_SAME_TAG_MS && appScannerWanted(), 'with the form\'s scan set and showScanner false, appRender does NOT stop the scanner; holdMs is set (U1, U2)');
    appOnChange({ kind: 'update', durable: true });
    check(APP.showScanner === false && sc.running, 'a delivered update leaves showScanner and the form\'s camera alone');
    APP.scanState = 'starting'; appFormStripState(F);
    const s1 = textOf(F.stripEl).indexOf(appPlain(t(F6.ports, 'ui_scan_starting'))) >= 0;
    APP.scanState = 'running'; appFormStripState(F);
    const s2 = fakeWalk(F.stripEl).some(e => e.attrs['aria-label'] === APP.tt('ui_torch')) && fakeWalk(F.stripEl).some(e => e.attrs['aria-label'] === APP.tt('ui_btn_close'));
    APP.scanState = 'idle'; APP.scanError = 'denied'; appFormStripState(F);
    const s3 = textOf(F.stripEl).indexOf(appPlain(t(F6.ports, 'ui_camera_denied'))) >= 0;
    check(s1 && s2 && s3 && F.stripEl.children[0] === APP.videoEl, 'the strip shows ui_scan_starting, then the running tools (torch, stop), then ui_camera_denied; the video stays its first child', [s1, s2, s3]);
    APP.scanError = null;
    appFormScanStop(F);
    check(!F.scan && !sc.running && sc.holdMs === null && !appScannerWanted(), 'appFormScanStop: the scan off, holdMs cleared');
    let started = 0;
    sc.start = function () { started++; this.running = true; return Promise.resolve('jsqr'); };
    appStartScanner();
    check(started === 0, 'appStartScanner refuses while a form without scan is open');
    F.scan = true;
    appStartScanner();
    check(started === 1, 'and starts for a form whose scan is set (visibility uses the same predicate)');
    // U5: typing in the buyer search redraws only the chips; a sync while it has focus waits for blur.
    const input = fOf(F.body, 'buyer')[0], chips0 = F.regions.buyer.el;
    input.value = 'ဒေါ်';
    fire(input, 'input');
    check(fOf(F.body, 'buyer')[0] === input && input.value === 'ဒေါ်' && F.regions.buyer.el === chips0 && fOf(chips0, 'buyer:C-0001').length === 1, 'an input on buyer redraws the chips region and leaves the input node and its value (U5)');
    APP.doc.activeElement = input;
    input.tagName = 'INPUT';
    F.el.contains = node => fakeWalk(F.el).indexOf(node) >= 0;
    appOnSync({ ok: true, quarantined: [] });
    check(F.stale && fOf(F.body, 'buyer')[0] === input, 'a sync while the input has focus does not repaint (F.stale)');
    fire(input, 'blur');
    check(!F.stale && fOf(F.body, 'buyer')[0] !== input, 'its blur does');
    APP.doc.activeElement = null;
    // B5: the keypad above the form, empty, titled with the label and the current value; the date sheet.
    appFormClick(F, 'price:S1-0003');
    const keypad = () => fakeWalk(h.els.overlay);
    check(!h.els.overlay.hidden && keypad().filter(e => e.tagName === 'H3')[0].textContent === APP.tt('btn_discount') + ' · ' + fmtMoney(12000) && keypad().some(e => e.className === 'display' && e.textContent === '0') &&
      APP.nav[APP.nav.length - 1].kind === 'sheet', 'a .fnum tap opens the keypad (a sheet layer over the form) titled label · current value, starting EMPTY (U4)', keypad().filter(e => e.tagName === 'H3').map(e => e.textContent));
    const press = k => keypad().filter(e => e.tagName === 'BUTTON' && e.textContent === k)[0].click();
    const okBtn = () => keypad().filter(e => e.tagName === 'BUTTON' && e.textContent === APP.tt('ui_w_ok'))[0];
    check(okBtn().attrs.disabled !== undefined, 'OK is disabled at 0');
    ['2', '0', '000'].forEach(press);
    okBtn().click();
    check(h.els.overlay.hidden && appSaleLine(F.values, 'S1-0003').unitPrice === 20000 && APP.nav[APP.nav.length - 1].kind === 'form', '2, 0, 000, OK sets 20,000 and the sheet layer goes');
    appFormDo(F, 'paid:part');
    appFormClick(F, 'due:date');
    const dateIn = keypad().filter(e => e.tagName === 'INPUT')[0];
    check(dateIn && dateIn.attrs.type === 'date' && dateIn.attrs.min === today6() && dateIn.attrs.max === addDaysKey(today6(), 365) && keypad().filter(e => e.tagName === 'H3')[0].textContent === APP.tt('ui_date_title'),
      'due:date opens the sheet titled ui_date_title with an input type=date, min today and max today + 365 (U21a)', dateIn && dateIn.attrs);
    okBtn().click();
    check(!h.els.overlay.hidden && F.values.dueDay === null, 'OK with no date does nothing');
    dateIn.value = addDaysKey(today6(), 20);
    okBtn().click();
    check(h.els.overlay.hidden && F.values.dueDay === addDaysKey(today6(), 20) && textOf(F.body).indexOf(APP.tt('sale_due_set', { owed: fmtMoney(20000), date: fmtDayMy(addDaysKey(today6(), 20)) })) >= 0,
      'OK with a date sets it (yyyy-mm-dd) and the row reads sale_due_set', F.values.dueDay);
    // The router and the line's name.
    appOpenTagId('S1-0005');
    check(APP.form === F && appSaleLine(F.values, 'S1-0005'), 'appOpenTagId routes to the open form');
    appFormClick(F, 'line:S1-0003');
    check(APP.form === null && appFormDraftRead(F6.store, 'sale', uid6) && /S1-0003/.test(lastBotOf(F6).text) && APP.nav[APP.nav.length - 1].kind === 'card' && !APP.showScanner,
      'the line\'s name closes the form keeping its draft and shows the item card (a card layer)');
    APP.store.setPref('cameraOk', false);
    APP.scanner = null;
    appFormDraftDrop(F6.store, 'sale', uid6);
    const saved = appOpenForm('sale', { itemId: 'S1-0003', qty: 1 });
    let home = 0;
    APP.scanner = { running: false, start() { home++; this.running = true; return Promise.resolve(); }, stop() { this.running = false; } };
    APP.store.setPref('cameraOk', true);
    await appFormSave(saved);
    check(home === 0 && APP.showScanner === false, 'a saved close never starts the home scanner (U17)');
    APP.scanner = null;
    APP.store.setPref('cameraOk', false);
  });
  check(/canApply[\s\S]{0,200}!APP\.form/.test(appSetupServiceWorker.toString()) && /appCloseForm\(\{\}\)/.test(bootApp.toString()) && /reloadAfterForm = true/.test(appSetupServiceWorker.toString()),
    'the SW update waits while a form is open (canApply needs !APP.form); revoked closes the form');
  await F6.phone.commit('t');
  await F6.sync.syncNow('t');

  step('54. Render (fakeDocument): data-f everywhere, SIM_HOT, the reveals, the job rows, the CSS');
  await app6(F6, {}, async h => {
    const F = appOpenForm('sale', { itemId: 'S1-0002', qty: 1 });
    const buttons = fakeWalk(F.el).filter(e => e.tagName === 'BUTTON' || e.tagName === 'INPUT' || e.tagName === 'TEXTAREA');
    check(buttons.length > 10 && buttons.every(e => e.getAttribute('data-f') !== null), 'every control of the sale form carries data-f', buttons.filter(e => e.getAttribute('data-f') === null).map(e => e.tagName + ':' + e.textContent));
    APP.win.SIM_HOT = 'f:save';
    appFormRepaint(F);
    const hot = fakeWalk(F.el).filter(e => /\bhot\b/.test(e.className));
    check(hot.length === 1 && hot[0].getAttribute('data-f') === 'save', 'SIM_HOT = f:save marks exactly Save');
    APP.win.SIM_HOT = undefined;
    appFormDo(F, 'paid:part');
    const amt = fOf(F.body, 'amount')[0];
    check(amt && /\bfneed\b/.test(amt.className) && fakeWalk(F.body).some(e => /\bfdue\b/.test(e.className) && /\bfneed\b/.test(e.className)), 'part reveals the amount and the promised day, both outlined (.fneed)');
    appFormDo(F, 'paid:full');
    appFormDo(F, 'pay:mix');
    appFormDo(F, 'acct:KBZ');
    check(fOf(F.body, 'acct:KBZ').length === 1 && fOf(F.body, 'acct:BANK').length === 1 && fOf(F.body, 'transfer').length === 1, 'mix reveals the accounts and the transfer');
    appFormDo(F, 'pay:CASH');
    appFormDo(F, 'buyer:new');
    const ph = fOf(F.body, 'phone')[0];
    check(fOf(F.body, 'name').length === 1 && ph && ph.attrs.inputmode === 'tel', 'new reveals the name and the phone, the phone with inputmode=tel (B12)');
    const full = fOf(F.body, 'paid:full')[0], paySeg = fOf(F.body).filter(e => /^pay:/.test(e.getAttribute('data-f')));
    check(full.textContent === appPlain(t(F6.ports, 'btn_paid_full', { amount: fmtMoney(18000) })) && paySeg[paySeg.length - 1].getAttribute('data-f') === 'pay:add', 'paid:full reads btn_paid_full with the total (B4); pay:add is the last how-paid choice (U7)', full.textContent);
    check(!fakeWalk(F.el).some(e => e.tagName === 'BUTTON' && /✅/.test(e.textContent)), 'no control carries a ✅ (the only Save reads Save)');
    appCloseForm({});
    APP.showScanner = true;
    appRender();
    const grid = fakeWalk(h.els.main).filter(e => /\bjobs\b/.test(e.className))[0];
    check(grid && !/compact/.test(grid.className) && grid.children.length === 4 && grid.children[0].textContent === t(F6.ports, 'ui_home_sell') && fakeWalk(h.els.main).some(e => /\bhandle\b/.test(e.className)),
      'the home under form: the 2 × 2 job grid (emojis kept) in the scanner state, with the history handle', grid && grid.children.map(b => b.textContent));
    await card(F6, 'S1-0002');
    APP.showScanner = false;
    appRender();
    const cmp = fakeWalk(h.els.main).filter(e => /\bjobs\b/.test(e.className))[0];
    check(cmp && /compact/.test(cmp.className) && cmp.children[0].textContent === t(F6.ports, 'ui_home_sell') &&
      cmp.children.slice(1).every(b => b.attrs['aria-label'] && b.children.length === 2 && b.children[0].className === 'em' && b.children[0].textContent.length <= 4 && b.children[1].className === 'lb' && b.children[1].textContent === b.attrs['aria-label']),
      'the card state: the compact row (🛒 with its label; 🆕 📦 💸 as the emoji over its word in small type, with an aria-label; U22, UX review)', cmp && cmp.children.map(b => [b.textContent, b.attrs['aria-label'], b.children.length]));
  });
  const css = fs.readFileSync(path.join(ROOT, 'app/app.css'), 'utf8');
  check(/\.overlay \{[^}]*z-index: 34/.test(css) && /\[data-f\]\.hot/.test(css) && /\.formpage \.seg, \.formpage \.toggle \{ flex-wrap: wrap; \}/.test(css) && /\.fcol \{[^}]*var\(--fbar-h/.test(css),
    'app.css: .overlay z-index 34, [data-f].hot, the wrapping .seg and .toggle of forms, --fbar-h in the .fcol padding (U6)');

  step('55. Pending lines: a basket entry is one describeGroup line, a restock of two lines restock_group_done');
  const P55 = await phone6('P55 sister', sister);
  let b55 = appSaleInit(P55.phone, {});
  ['S1-0002', 'S1-0003', 'S1-0005'].forEach(id => { b55 = appSaleAdd(P55.phone, b55, id, 1).values; });
  appSaleSave(P55.phone, { values: b55, saving: false });
  let rs55 = appRestockAdd(P55.phone, appRestockAdd(P55.phone, appRestockInit(P55.phone, {}), 'S1-0002').values, 'S1-0003').values;
  appRestockSave(P55.phone, { values: rs55, saving: false });
  appRestockSave(P55.phone, { values: appRestockAdd(P55.phone, appRestockInit(P55.phone, {}), 'S1-0005').values, saving: false });
  const pl55 = P55.sync.pendingLines().filter(l => l.kind === 'group');
  check(pl55.length === 3 && pl55[0].text.indexOf(describeGroup(P55.ports, P55.store.outbox[0].txs)) === 0 && pl55[0].text.indexOf(t(P55.ports, 'basket_line', { n: fmtCount(3), amount: fmtMoney(52000) })) >= 0 &&
    pl55[1].text.indexOf(t(P55.ports, 'restock_group_done', { n: fmtCount(2), qty: fmtCount(2) })) === 0 && pl55[2].text.indexOf(describeRow(P55.ports, P55.store.outbox[2].txs[0])) === 0,
    'a three-line basket entry: one describeGroup line; a two-line restock: restock_group_done; a one-line entry keeps its describeRow line', pl55.map(l => l.text));
  await P55.sync.syncNow('t');

  step('56. An older server, the deletions, the texts of 9.3');
  const st56 = { old: true };
  const t56 = (api, body) => { const res = ctx.tr6(api, body); if (api === 'sync' && res && res.pull && st56.old) delete res.pull.caps; return res; };
  const Q56 = await phone6('Q56 older', sister, { transport: t56 });
  await Q56.sync.syncNow('t');
  const c56 = await card(Q56, 'S1-0002'), n56 = Q56.store.ledger.length, ev56 = [];
  Q56.phone.on('openform', e => ev56.push(e));
  await Q56.phone.sim.tap(c56.id, 'S|S1-0002|1');
  check(same(appHomeJobs(Q56.ports), []) && Q56.store.ledger.length === n56 + 1 && !ev56.length, 'quickForced: no jobs and S| commits at once (step 40 extended)');
  check(appInputModeFor({ kind: 'sale', step: 'buyer' }) === null && typeof appQuestionLine === 'undefined' && appInputModeFor({ kind: 'await_text', purpose: 'phone' }) === 'tel' &&
    ['buyer', 'name', 'phone', 'due_text'].every(s => appInputModeFor({ kind: 'sale', step: s }) !== 'date'), 'the sale branch and appQuestionLine are gone; await_text purpose phone is tel; no state gives date (U24, B12)');
  const spec = fs.readFileSync(path.join(ROOT, 'docs/design-round-6/SPEC-round-6.md'), 'utf8');
  const blockOf = after => { const i = spec.indexOf(after), a = spec.indexOf('```', i) + 3, b = spec.indexOf('```', a); return spec.slice(a, b).split('\n').map(l => /^(\w+): '(.*)'$/.exec(l.trim())).filter(Boolean); };
  const b93 = blockOf('### 9.3 app/app_i18n.js');
  // 13.14 (revision 3 wins over 9.3): ui_photo_retake's draft is 'Photo ပြန်ရိုက်'.
  const want93 = b93.map(m => [m[1], m[1] === 'ui_photo_retake' ? 'Photo ပြန်ရိုက်' : m[2]]);
  const bad93 = want93.filter(p => APP_MSG[p[0]] !== p[1] || !APP_MSG[p[0]]);
  check(b93.length === 26 && !bad93.length, 'every key of 9.3 is in APP_MSG, non-empty and equal to the block (ui_photo_retake as 13.14 redrafts it)', bad93);
  check(noErrors(F6) && noErrors(ctx.F6b) && noErrors(O6) && noErrors(Q56), 'no deliver or listener error on the round-6 phones', F6.store.errors.slice(-3));
  await round6c(ctx);
}

/** A stubbed win.history (13.15 step 59): pushState, back and go recorded; popstate fired later by pump(). */
function stubHistory() {
  const h = { entries: [{ state: null }], at: 0, calls: [], pending: [] };
  Object.defineProperty(h, 'state', { get: () => h.entries[h.at].state });
  h.pushState = st => { h.entries = h.entries.slice(0, h.at + 1); h.entries.push({ state: st }); h.at++; h.calls.push(['push', st]); };
  const walk = n => { h.at = Math.max(0, Math.min(h.entries.length - 1, h.at + n)); h.pending.push(h.entries[h.at].state); };
  h.go = n => { h.calls.push(['go', n]); walk(n); };
  h.back = () => { h.calls.push(['back']); walk(-1); };
  h.pump = () => { let n = 0; while (h.pending.length) { if (++n > 40) throw new Error('popstate loop: ' + JSON.stringify(h.calls.slice(-12)) + ' nav ' + JSON.stringify(APP.nav)); appOnPop({ state: h.pending.shift() }); } };
  return h;
}

async function round6c(ctx) {
  const { W6, S6, phone6, F6, O6, uid6, same, flat, noErrors, today6, card } = ctx;
  const lastBotOf = P => P.phone.sim.lastBot();
  const spec = fs.readFileSync(path.join(ROOT, 'docs/design-round-6/SPEC-round-6.md'), 'utf8');

  step('57. Icons and plain text');
  const iconTable = spec.slice(spec.indexOf('### 13.2 The icon set'), spec.indexOf('### 13.3 The header'));
  const names57 = [];
  iconTable.replace(/^\| `([a-z0-9-]+)` \|/gm, (a, n) => { names57.push(n); return a; });
  check(names57.length === 26 && names57.every(n => APP_ICONS[n] && APP_ICONS[n].length), 'every name of 13.2\'s table (26) is in APP_ICONS', names57.filter(n => !APP_ICONS[n]));
  const svg = appIconSvg('arrow-left');
  check(svg.indexOf('viewBox="0 0 24 24"') > 0 && svg.indexOf('stroke="currentColor"') > 0 && (svg.match(/<path /g) || []).length === 3 && appIconSvg('nope') === '', 'appIconSvg: viewBox 0 0 24 24, stroke currentColor, one path per entry; an unknown name gives \'\'');
  const cases57 = [['💵+🏦 ခွဲပေး', 'ခွဲပေး'], ['✓ ပို့ပြီး', 'ပို့ပြီး'], ['⌃ မှတ်တမ်း', 'မှတ်တမ်း'], ['1. S1-0002 × ၂', '1. S1-0002 × ၂'], ['💰 ယခု\n📅 ရက်', 'ယခု\nရက်'],
    ['💰 👤 {customer} · ကျန် {owed} ကျပ် · x', '{customer} · ကျန် {owed} ကျပ် · x'], ['ကျေးဇူးတင်ပါသည် 🙏', 'ကျေးဇူးတင်ပါသည်'], ['🎤/📸 စစ်ရန် ကျန် {n} ခု', 'စစ်ရန် ကျန် {n} ခု'],
    [' (⏰ {n} ရက် လွန်)', ' ({n} ရက် လွန်)'], [' (နမူနာ)', ' (နမူနာ)'], ['PDF → Telegram', 'PDF → Telegram'], ['↩️ မှားသွားတယ်', 'မှားသွားတယ်']];
  const badCases = cases57.filter(c => appPlain(c[0]) !== c[1]);
  check(!badCases.length, 'appPlain: the cases of 13.1 rule 2 (the leading run, an emoji inside a line, two lines, arrows kept, a leading space kept)', badCases.map(c => [c[0], appPlain(c[0])]));
  const VS16 = String.fromCharCode(0xFE0F), keys57 = Object.keys(MSG).concat(Object.keys(APP_MSG));
  const left57 = keys57.filter(k => { const p = appPlain(MSG[k] !== undefined ? MSG[k] : APP_MSG[k]); APP_EMOJI_ANY.lastIndex = 0; return APP_EMOJI_ANY.test(p) || p.indexOf(VS16) >= 0; });
  check(keys57.length > 600 && !left57.length, 'for EVERY key of MSG and APP_MSG, appPlain of its text holds no emoji (APP_EMOJI_ANY) and no U+FE0F (UX-M6)', left57.slice(0, 5));
  await app6(F6, {}, async () => {
    const jr = appJobRow(false);
    check(APP.tt('btn_undo') === appPlain(MSG.btn_undo) && APP.tt('btn_undo').indexOf('↩') < 0 && jr.children[0].textContent === MSG.ui_home_sell, 'APP.tt is plain; appJobRow keeps \'🛒 ရောင်းမယ်\' (APP.ttRaw)');
  });

  step('58. The header and the bottom bar (fakeDocument)');
  await app6(F6, {}, async h => {
    appPaintChrome();
    appRender();
    check(h.els.back.hidden === true && h.els.gear.attrs['aria-label'] === 'Settings' && h.els.btnScan.textContent === 'Scan' && h.els.btnScan.children.some(c => /\bic\b/.test(c.className)) &&
      h.els.btnMenu.textContent === 'Menu' && h.els.btnMenu.children.some(c => /\bic\b/.test(c.className)) && h.els.back.attrs['aria-label'] === APP.tt('ui_aria_back'),
      'the home\'s scanner state: #back hidden; #gear aria-label Settings; Scan and Menu with their icons');
    appOpenScreen('history');
    check(h.els.back.hidden === false && h.els.shopName.textContent === APP.tt('ui_history_title') && h.els.bottom.hidden === true, 'the history screen: #back shown, the title မှတ်တမ်း, no bottom bar');
    const realChip = APP.sync.chipState;
    const chips = {};
    [['synced', { kind: 'synced', text: t(F6.ports, 'ui_sync_synced'), entries: 0, offline: false }, 'cloud-check'],
     ['waiting', { kind: 'waiting', text: t(F6.ports, 'ui_sync_waiting', { n: fmtCount(3) }), entries: 3, offline: false }, 'cloud-upload'],
     ['offline', { kind: 'synced', text: t(F6.ports, 'ui_sync_synced'), entries: 0, offline: true }, 'cloud-off'],
     ['red', { kind: 'red', text: t(F6.ports, 'ui_sync_stale_days', { d: myDigits(2) }), entries: 4, offline: false }, 'alert-triangle']].forEach(c => {
      APP.sync.chipState = () => c[1];
      appRenderHeader();
      chips[c[0]] = { icon: h.els.chip.innerHTML.indexOf(appIconSvg(c[2])) === 0, badge: (h.els.chip.children.filter(x => /badge/.test(x.className))[0] || {}).textContent || '', aria: h.els.chip.attrs['aria-label'] };
    });
    check(chips.synced.icon && chips.waiting.icon && chips.offline.icon && chips.red.icon, 'the chip\'s icon by state: cloud-check, cloud-upload, cloud-off, alert-triangle', chips);
    check(chips.waiting.badge === myDigits(3) && !chips.synced.badge && !chips.red.badge && !chips.offline.badge && chips.waiting.aria === appPlain(t(F6.ports, 'ui_sync_waiting', { n: fmtCount(3) })) &&
      chips.offline.aria === APP.tt('ui_sync_offline') && Object.keys(chips).every(k => { APP_EMOJI_ANY.lastIndex = 0; return !APP_EMOJI_ANY.test(chips[k].aria); }), 'the badge ၃ only while waiting; aria-label = the state\'s text, plain', chips);
    APP.sync.chipState = () => ({ kind: 'red', text: t(F6.ports, 'ui_sync_stale_days', { d: myDigits(2) }), entries: 4, offline: false });
    appNavReset();
    appRender();
    const view = fakeWalk(h.els.banner).filter(e => e.tagName === 'BUTTON')[0];
    view.click();
    check(APP.screen === 'sync' && h.els.back.hidden === false && appNavTop().name === 'sync', 'the red banner\'s ကြည့်မယ် opens the sync screen with #back shown (UX-M3)');
    APP.sync.chipState = realChip;
    appRender();
    const syncText = textOf(h.els.main);
    APP_EMOJI_ANY.lastIndex = 0;
    check(!APP_EMOJI_ANY.test(syncText) && fakeWalk(h.els.main).some(e => /\bkv\b/.test(e.className)), 'the sync screen: label/value rows, no emoji');
    appNavReset();
    APP.showScanner = true;
    appRender();
    const tiles = fakeWalk(h.els.main).filter(e => e.className === 'id');
    check(tiles.length && tiles.every(e => /^S\d-\d{4}$/.test(e.textContent)), 'the recent tiles show the id alone (no category emoji)', tiles.map(e => e.textContent));
  });
  const E6 = await phone6('E6 not enrolled', null);
  await app6(E6, { screen: 'enroll' }, async h => {
    appPaintChrome();
    appRender();
    const hid = h.els.back.hidden;
    let threw = null;
    try { appOpenScreen('settings'); const shown = !h.els.back.hidden; appNavBack(); check(hid && shown && APP.screen === 'enroll' && h.els.back.hidden, 'the enrol screen hides #back; gear → Settings → ← returns to the enrol screen'); } catch (e) { threw = e; }
    check(!threw, 'without a throw', threw && threw.message);
  });

  step('59. The nav stack: history entries carry their depth; back, skips, walks, the guard, the card rule');
  await app6(F6, { opts: {} }, async h => {
    const H = stubHistory();
    APP.win.history = H;
    APP.win.confirm = () => true;
    appOpenScreen('buyers'); appOpenScreen('buyer', 'C-0001'); appOpenScreen('receipt', ctx.basket44);
    check(same(APP.nav.map(l => l.kind + ':' + l.name), ['screen:buyers', 'screen:buyer', 'screen:receipt']) && same(H.calls.map(c => c[1] && c[1].salestag), [1, 2, 3]) && APP.navDepth === 3,
      'buyers → buyer → receipt: three screen layers and history entries salestag 1, 2, 3', H.calls);
    appNavBack(); H.pump();
    const s1 = APP.screen;
    appNavBack(); H.pump();
    const s2 = APP.screen;
    appNavBack(); H.pump();
    check(s1 === 'buyer' && s2 === 'buyers' && APP.screen === 'home' && !APP.nav.length && APP.navDepth === 0 && H.at === 0, 'back three times walks back to the home', [s1, s2, APP.screen]);
    const F = appOpenForm('sale', { itemId: 'S1-0002', qty: 1 });
    appFormClick(F, 'qty:S1-0002');
    check(same(APP.nav.map(l => l.kind), ['form', 'sheet']) && H.at === 2, 'a keypad over a form: form and sheet layers');
    appNavBack(); H.pump();
    check(h.els.overlay.hidden && APP.form === F && same(APP.nav.map(l => l.kind), ['form']) && H.at === 1, 'back closes the sheet first');
    appFormDo(F, 'qty+:S1-0002');
    appNavBack(); H.pump();
    const askN = fakeWalk(h.els.overlay).filter(e => e.attrs['data-f'] === 'ask:no')[0];
    check(askN && !h.els.overlay.hidden && APP.form === F && same(APP.nav.map(l => l.kind), ['form', 'sheet']) && H.at === 2 && APP.navDepth === 2,
      'a dirty form asks with the app\'s own sheet (a sheet layer over the form, its entries pushed again), never window.confirm (UX review)', H.calls.slice(-3));
    askN.click(); H.pump();
    check(h.els.overlay.hidden && APP.form === F && same(APP.nav.map(l => l.kind), ['form']) && H.at === 1 && APP.navDepth === 1, 'its stay button keeps the form and its layer: ONE go(-1) for the sheet', H.calls.slice(-2));
    appCloseForm({ keep: true });
    H.pump();
    // UX-B1: two layers, Scan (ONE go(-2)), a scan opens a form, one back closes it.
    appOpenScreen('buyers'); appOpenScreen('buyer', 'C-0001');
    const go0 = H.calls.filter(c => c[0] === 'go').length;
    appNavReset();
    const gos = H.calls.filter(c => c[0] === 'go').slice(go0);
    H.pump();
    appOpenForm('sale', { itemId: 'S1-0003', qty: 1 });
    appNavBack(); H.pump();
    check(gos.length === 1 && gos[0][1] === -2 && APP.form === null && !APP.nav.length && H.at === 0, 'two layers, Scan: ONE go(-2) (one popstate); then a scan opens a form and ONE back closes it (UX-B1)', gos);
    appOpenScreen('buyers'); appOpenScreen('buyer', 'C-0001');
    H.at = 0;
    appOnPop({ state: null });
    check(!APP.nav.length && APP.screen === 'home' && APP.navDepth === 0, 'a popstate that lands two entries down (a skipped entry) closes both layers');
    H.entries = [{ state: null }]; H.at = 0; H.pending.length = 0;
    // UX-M2: the tag keypad's 4th digit: the sheet dropped (a walk), the form opened before its popstate.
    appOpenTagKeypad();
    ['0', '0', '0', '3'].forEach(k => fakeWalk(h.els.overlay).filter(e => e.tagName === 'BUTTON' && e.textContent === k)[0].click());
    await h.flush();
    H.pump();
    check(APP.form && APP.form.kind === 'sale' && same(APP.nav.map(l => l.kind), ['form']) && H.at === 1 && APP.navDepth === 1, 'the tag keypad\'s 4th digit: the history ends at the stack\'s depth (UX-M2)', [APP.nav, H.at]);
    appCloseForm({});
    H.pump();
    appOpenScreen('buyers');
    const c0 = H.calls.length;
    appCloseOverlay();
    check(H.calls.length === c0, 'appCloseOverlay() with no sheet open calls no back');
    const B = appOpenForm('buyer', {});
    const c1 = H.calls.length;
    appFormDo(B, 'name', 'ဦးနေ');
    await appFormSave(B);
    check(APP.screen === 'buyer' && same(APP.nav.map(l => l.kind + ':' + (l.name || l.form)), ['screen:buyers', 'screen:buyer']) && !H.calls.slice(c1).some(c => c[0] !== 'push' || c[1].salestag !== 2) && H.at === 2,
      'the buyer form\'s Save replaces its layer by the new buyer\'s page with no history call (UX-M2)', H.calls.slice(c1));
    appNavReset(); H.pump();
    // UX-M1: a home scan, Save: ← shown (a card layer); the receipt from the sold card returns to it; back again: the scanner.
    await F6.phone.sim.start('S1-0003');
    await h.flush();
    await appFormSave(APP.form);
    appRender();
    check(same(APP.nav.map(l => l.kind), ['card']) && h.els.back.hidden === false && lastBotOf(F6).view.kind === 'sold', 'a home scan and Save: the sold card on a card layer, #back shown (UX-M1)');
    const soldId = lastBotOf(F6).id;
    await F6.phone.sim.tap(soldId, 'RC|' + lastBotOf(F6).view.id);
    await h.flush();
    check(APP.screen === 'receipt' && same(APP.nav.map(l => l.kind), ['card', 'screen']), 'its ဘောက်ချာ opens the receipt page over the card layer');
    appNavBack(); H.pump();
    check(APP.screen === 'home' && !APP.showScanner && lastBotOf(F6).id === soldId, '← from the receipt returns to the sold card');
    appNavBack(); H.pump();
    check(APP.screen === 'home' && APP.showScanner && !APP.nav.length, 'back again gives the scanner');
    const ic = await card(F6, 'S1-0002');
    APP.showScanner = false; appRender();
    await F6.phone.sim.tap(ic.id, 'R|S1-0002');
    await h.flush();
    appNavBack(); H.pump();
    check(APP.form === null && APP.screen === 'home' && !APP.showScanner && lastBotOf(F6).id === ic.id && same(APP.nav.map(l => l.kind), ['card']), 'a form opened from an item card and closed without Save shows that card');
    appNavReset(); H.pump();
    // UX-m2, UX-M4, the toast, noHistory.
    const H3 = stubHistory();
    H3.entries = [{ state: null }, { state: { salestag: 1 } }, { state: { salestag: 2 } }, { state: { salestag: 3 } }]; H3.at = 3;
    APP.win.history = H3; APP.navDepth = 0; APP.nav = [];
    appNavBoot();
    check(same(H3.calls, [['go', -3]]), 'boot on an entry {salestag: 3}: go(-3) once (UX-m2)', H3.calls);
    H3.pump();
    const H4 = stubHistory();
    APP.win.history = H4;
    appNavGuard(); appNavGuard();
    check(H4.calls.length === 1 && same(H4.calls[0][1], { salestag: 0, guard: true }), 'the first pointerdown on the first entry pushes {salestag: 0, guard: true} once (UX-M4)', H4.calls);
    APP.backAgainAt = 0;
    appOnPop({ state: null });
    check(h.toastOf() === APP.tt('ui_back_again'), 'a back with nothing open toasts ui_back_again');
    APP.opts = { noHistory: true };
    const H5 = stubHistory();
    APP.win.history = H5;
    appNavGuard();
    appOpenScreen('buyers');
    appNavBack();
    check(!H5.calls.length && !APP.nav.length && APP.screen === 'home', 'with noHistory: no guard pushed, back pops directly');
    appOpenMenu();
    await tick(5);
    appRender();
    const menu = lastBotOf(F6);
    await F6.phone.sim.tap(menu.id, 'M|find');
    appRender();
    check(same(APP.nav.map(l => l.kind), ['card']) && getState(F6.ports, uid6) && getState(F6.ports, uid6).kind === 'find', 'a menu tap pushes a card layer; M|find waits for text');
    appNavBack();
    check(getState(F6.ports, uid6) === null && !APP.nav.length && APP.showScanner, 'back from it clears the waiting state');
    appOpenScreen('buyers'); appOpenScreen('settings');
    appNavReset();
    check(!APP.nav.length && APP.screen === 'home' && APP.showScanner, 'Scan clears every layer');
  });
  const saved59 = APP;
  APP = { win: { setTimeout: f => setTimeout(f, 0), clearTimeout: x => clearTimeout(x) }, phone: F6.phone, store: F6.store, sync: { scheduleSync() {} }, tt: k => k, $: () => null,
    measForm: { req: { customerId: 'C-0002', orderId: '', staff: F6.store.meta.staff }, values: { neck: '13' }, notesEl: { value: '' }, voucherEl: { value: '' }, el: null, timer: null, msgEl: null, dirty: false }, reloadAfterForm: false };
  let threw59 = null;
  try { appMeasFormSave(); } catch (e) { threw59 = e; } finally { APP = saved59; }
  check(!threw59 && F6.store.measurements['C-0002'] && F6.store.measurements['C-0002'].fields.neck === '13', 'M-11: the stub APP of step 29 (no nav, no opts) saves and closes the measurement form without a throw', threw59 && threw59.message);
  await F6.phone.commit('t');
  await F6.sync.syncNow('t');

  step('60. No chat box: a search field, a labelled field with OK, no bar under a report or a view');
  await app6(F6, {}, async h => {
    await F6.phone.sim.start('');
    await F6.phone.sim.tap(lastBotOf(F6).id, 'M|find');
    APP.showScanner = false; appRender();
    const bar = fakeWalk(h.els.main).filter(e => e.className === 'inbar')[0], inp = bar && fakeWalk(bar).filter(e => e.tagName === 'INPUT')[0];
    check(inp && inp.attrs.type === 'search' && fakeWalk(bar).some(e => e.tagName === 'BUTTON' && e.attrs['aria-label'] === APP.tt('ui_aria_search')) && textOf(bar).indexOf(t(F6.ports, 'ui_btn_send')) < 0,
      'M|find: the bar is an input[type=search] with a search icon button, no ပို့');
    setState(F6.ports, uid6, { kind: 'await_text', purpose: 'acct_name' });
    F6.phone.botSay('✏️ the question\nmore');
    appRender();
    const ask = fakeWalk(h.els.main).filter(e => e.className === 'askbar')[0];
    check(ask && ask.children[0].tagName === 'LABEL' && ask.children[0].textContent === 'the question' && fakeWalk(ask).some(e => e.tagName === 'BUTTON' && e.textContent === 'OK'),
      'an await_text state: a label holding the question (plain) and an OK button');
    F6.phone.botSay('report', [], { document: { name: 'x.pdf', report: { title: 'x', sections: [], fileName: 'x' } } });
    appRender();
    const noBar1 = !fakeWalk(h.els.main).some(e => e.className === 'inbar' || e.className === 'askbar');
    await card(F6, 'S1-0002');
    setState(F6.ports, uid6, { kind: 'await_text', purpose: 'acct_name' });
    appRender();
    const noBar2 = !fakeWalk(h.els.main).some(e => e.className === 'inbar' || e.className === 'askbar');
    check(noBar1 && noBar2, 'a report card with a waiting state: no bar; an item card with a view and a waiting state: no bar');
    clearState(F6.ports, uid6);
    check(!textOf(h.els.main).includes(t(F6.ports, 'ui_btn_send')) && appInputBar.toString().indexOf('ui_btn_send') < 0, 'no element carries ui_btn_send\'s text');
  });
  await F6.phone.commit('t');

  step('61. History: this phone\'s own records by day, newest first; a row opens its receipt or its entry; the undo while allowed');
  const H6 = await phone6('H6 sister', sister), uidH = H6.phone.staffId();
  W6.nowOverride = new Date(Date.now() - 8 * 86400000);
  appSaleSave(H6.phone, { values: appSaleAdd(H6.phone, appSaleInit(H6.phone, {}), 'S1-0003', 1).values, saving: false });
  await H6.phone.commit('t');
  W6.nowOverride = null;
  let hb = appSaleInit(H6.phone, {});
  ['S1-0002', 'S1-0003', 'S1-0005'].forEach(id => { hb = appSaleAdd(H6.phone, hb, id, 1).values; });
  const s61 = appSaleSave(H6.phone, { values: hb, saving: false });
  const r61 = appRestockSave(H6.phone, { values: appRestockAdd(H6.phone, appRestockInit(H6.phone, {}), 'S1-0005').values, saving: false });
  const n61 = appNewItemSave(H6.phone, { values: appNewItemSet(H6.phone, appNewItemSet(H6.phone, appNewItemInit(H6.phone, { itemId: 'S1-0012' }), 'count', 3), 'price:15000'), saving: false });
  const e61 = appExpenseSave(H6.phone, { values: appExpenseSet(H6.phone, appExpenseSet(H6.phone, appExpenseInit(H6.phone, {}), 'cat:food'), 'amount:5000'), saving: false });
  const u61 = appSaleSave(H6.phone, { values: appSaleAdd(H6.phone, appSaleInit(H6.phone, {}), 'S1-0002', 1).values, saving: false });
  await H6.phone.commit('t');
  await H6.phone.sim.tap(lastBotOf(H6).id, 'U|' + u61.groupId);
  W6.sim.start(sister, 'S1-0005'); W6.sim.tapLast(sister, 'ရောင်း ၁'); W6.sim.tapLastByKey(sister, 'btn_save');
  const tg61 = W6.ledger[W6.ledger.length - 1];
  let hr = appHistoryRows(H6.phone, 7);
  const ids61 = hr.rows.map(x => x.groupId);
  check(same(ids61, [u61.groupId, e61.groupId, n61.groupId, r61.groupId, s61.groupId]) && hr.more === 1, 'the rows are this phone\'s five, newest first; the 8-day-old group is not among them', hr.rows.map(x => [x.kind, x.name]));
  const byId = id => hr.rows.filter(x => x.groupId === id)[0];
  check(byId(s61.groupId).name === 'လုံချည် ကချင် အပြာ +' + myDigits(2) && byId(s61.groupId).tag === txLabel('SALE') && byId(n61.groupId).amount === '+' + myDigits(3) + ' ထည်' && byId(n61.groupId).tag === appPlain(MSG.ui_home_new) &&
    byId(r61.groupId).tag === txLabel('RESTOCK') && byId(e61.groupId).name === categoryLabel(H6.ports, 'food') && byId(u61.groupId).undone && hr.rows.every(x => x.pending),
    'the basket … +၂ (tag ရောင်း), the new piece +၃ ထည်, the restock, the expense by its category; the undone one undone; all pending', hr.rows.map(x => [x.name, x.tag, x.amount, x.undone]));
  await H6.sync.syncNow('t');
  hr = appHistoryRows(H6.phone, 7);
  check(hr.rows.length === 5 && hr.rows.every(x => !x.pending) && !hr.rows.some(x => x.groupId === tg61.groupId) && H6.store.ledger.some(z => z.groupId === tg61.groupId),
    'after a sync no row is pending; the Telegram sale by the same staff is pulled but not listed');
  check(appHistoryRows(H6.phone, 14).rows.length === 6 && appHistoryRows(H6.phone, 14).more === 0, 'the 8-day-old group appears only after ui_hist_more (14 days)');
  await app6(H6, {}, async h => {
    appOpenScreen('history');
    const undone = fOf(h.els.main, 'hist:' + u61.groupId)[0];
    check(/\bundone\b/.test(undone.className) && textOf(undone).indexOf(APP.tt('ui_hist_undone')) >= 0 && fOf(h.els.main, 'hist:more').length === 1, 'the undone row is struck and reads ui_hist_undone; နောက်ထပ် ကြည့်မယ် is offered');
    fOf(h.els.main, 'hist:' + s61.groupId)[0].click();
    check(APP.screen === 'receipt' && APP.screenArg === s61.groupId, 'a sale row opens the receipt page');
    appNavBack();
    fOf(h.els.main, 'hist:' + r61.groupId)[0].click();
    const undoBtn = fOf(h.els.main, 'undo')[0];
    check(APP.screen === 'entry' && undoBtn && textOf(h.els.main).indexOf(appPlain(t(H6.ports, 'ui_undo_until', { time: '' })).trim()) >= 0, 'a restock row opens the entry page with the undo button and ui_undo_until');
    await appScreenAct('U|' + r61.groupId);
    check(H6.store.ledger.filter(z => z.groupId === r61.groupId && z.reversesTxId).length === 1 && APP.screen === 'home' && lastBotOf(H6).text.indexOf(MSG.undo_done) === 0 && appNavTop().kind === 'card',
      'the undo button\'s act writes the mirror and the home shows undo_done on a card layer', lastBotOf(H6).text);
    W6.nowOverride = new Date(Date.now() + 31 * 60000);
    appOpenScreen('entry', e61.groupId);
    check(!fOf(h.els.main, 'undo').length, '31 minutes later no undo button');
    W6.nowOverride = null;
  });
  await H6.sync.syncNow('t');
  ctx.H6 = H6;
  ctx.u61 = u61.groupId;

  step('62. The buyers list: recent buyers of this shop first, the search, the 60-row cap, the owed marker, +');
  const b62 = appBuyersRows(F6.phone, '');
  const recentIds = []; F6.store.ledger.slice().reverse().forEach(z => { if (z.customerId && z.shop === 'S1' && recentIds.indexOf(z.customerId) < 0) recentIds.push(z.customerId); });
  check(same(b62.rows.slice(0, recentIds.length).map(x => x.id), recentIds.filter(id => F6.ports.store.getCustomer(id))) && b62.rows.length === F6.store.customers.length, 'no text: this shop\'s recent buyers first (ledger order), then every other buyer', b62.rows.map(x => x.name));
  const rest62 = b62.rows.slice(recentIds.length).map(x => normName(x.name));
  check(same(rest62, rest62.slice().sort()), 'the others by name');
  const myint = b62.rows.filter(x => x.id === 'C-0001')[0];
  check(myint.owed > 0 && myint.phone === fmtPhone('09 123 456 78') && appBuyersRows(F6.phone, 'ဒေါ်မြင့်').rows.some(x => x.id === 'C-0001') && appBuyersRows(F6.phone, '5678').rows[0].id === 'C-0001',
    'the owed marker (ကျန်) on ဒေါ်မြင့်; a search by name and by four digits finds her', [myint.owed, appBuyersRows(F6.phone, '5678').rows.map(x => x.name)]);
  const Z62 = await phone6('Z62 scratch', sister);
  for (let i = 0; i < 65; i++) Z62.ports.store.addCustomer({ name: 'ဝယ်သူ ' + i });
  const cap = appBuyersRows(Z62.phone, '');
  check(cap.rows.length === APP_BUYERS_MAX && cap.more === Z62.store.customers.length - APP_BUYERS_MAX, 'at most 60 rows; more = how many more (ui_buyers_more)', [cap.rows.length, cap.more]);
  await app6(F6, {}, async h => {
    appOpenScreen('buyers');
    const own = fOf(h.els.main, 'buyer:C-0001')[0];
    check(own && fakeWalk(own).some(e => /owed/.test(e.className)) && textOf(own).indexOf(APP.tt('ui_lbl_owed')) >= 0, 'the page: a row per buyer, the owed one marked ကျန်');
    const s = fOf(h.els.main, 'bsearch')[0];
    s.value = '5678'; fire(s, 'input');
    check(fOf(h.els.main, 'bsearch')[0] === s && fOf(h.els.main).filter(e => /^buyer:C-/.test(e.getAttribute('data-f'))).length === 1, 'typing redraws only the list (the input stays)');
    fOf(h.els.main, 'buyer:new')[0].click();
    check(APP.form && APP.form.kind === 'buyer' && APP.form.el.attrs.id === 'buyerForm', '+ opens the buyer form');
    appCloseForm({});
  });

  step('63. The buyer form: each refusal, a new buyer and its page, an edit, the Rev after the sync, the known-phone chip');
  await app6(F6, {}, async h => {
    appOpenScreen('buyers');
    let B = appOpenForm('buyer', {});
    const tryIt = async (f, v) => { appFormDo(B, f, v); await appFormSave(B); return textOf(B.bar); };
    const m1 = await tryIt('name', '');
    appFormDo(B, 'name', 'ဒေါ်သီ');
    const m2 = await tryIt('phone', '09123');
    const m3 = await tryIt('phone', '09 123 456 78');
    const chip = fOf(B.body, 'buyer:C-0001')[0];
    appFormDo(B, 'phone', '');
    const m4 = await tryIt('name', 'ဒေါ်ခင်');
    check(m1.indexOf(appPlain(MSG.ask_name)) >= 0 && m2.indexOf(appPlain(MSG.basket_bad_phone)) >= 0 && m3.indexOf(appPlain(t(F6.ports, 'ui_buyer_known_phone', { customer: 'ဒေါ်မြင့်' }))) >= 0 &&
      m4.indexOf(APP.tt('ui_buyer_same_name')) >= 0 && !!chip, 'each refusal in .fmsg: ask_name, basket_bad_phone, ui_buyer_known_phone (with her chip), ui_buyer_same_name', [m1, m2, m3, m4].map(x => x.split('\n').filter(Boolean)[0]));
    const ob = F6.store.outbox.length;
    appFormDo(B, 'buyer:create');
    appFormDo(B, 'name', 'ဒေါ်သီသီ');
    appFormDo(B, 'phone', '09 765 432 100');
    await appFormSave(B);
    const thi = F6.store.customers.filter(c => c.name === 'ဒေါ်သီသီ')[0];
    check(thi && same(F6.store.outbox.slice(ob).map(e => e.kind), ['customer']) && APP.screen === 'buyer' && APP.screenArg === thi.id && APP.form === null && normPhone(thi.phone) === '09765432100',
      'a new buyer queues one customer entry and opens its page', thi);
    B = appOpenForm('buyer', { customerId: thi.id });
    appFormDo(B, 'phone', '09 765 432 111');
    await appFormSave(B);
    const ed = F6.store.outbox.slice(-1)[0];
    check(ed.kind === 'customer' && ed.rec.id === thi.id && normPhone(ed.rec.phone) === '09765432111' && APP.screen === 'buyer' && appNavTop().kind === 'screen', 'an edit queues a customer entry with the new phone and returns to that buyer\'s page');
    const rev0 = (W6.customers.filter(c => c.id === thi.id)[0] || {}).rev || 0;
    await F6.sync.syncNow('t');
    const srv = W6.customers.filter(c => c.id === thi.id)[0];
    check(srv && normPhone(srv.phone) === '09765432111' && srv.rev > 0 && F6.ports.store.getCustomer(thi.id).rev === srv.rev, 'after the sync the server holds the edit with a Rev and the phone kept it (setCustomerRev)', [rev0, srv && srv.rev, F6.ports.store.getCustomer(thi.id).rev]);
    B = appOpenForm('buyer', {});
    appFormDo(B, 'name', 'ဦးဘ'); appFormDo(B, 'phone', '09 123 456 78');
    await appFormSave(B);
    fOf(B.body, 'buyer:C-0001')[0].click();
    check(APP.form === null && APP.screen === 'buyer' && APP.screenArg === 'C-0001', 'the known-phone chip opens that buyer\'s page');
  });

  step('64. The buyer page: the rows, the history table, the actions on a card layer and back to the page');
  commitDeposit(F6.ports, { customerId: 'C-0001', amount: 50000, note: '', shop: 'S1', method: 'CASH', staff: F6.store.meta.staff, source: CFG.SOURCE.BUTTON });
  await F6.phone.commit('t');
  await app6(F6, {}, async h => {
    appOpenScreen('buyer', 'C-0001');
    const txt = textOf(h.els.main), s = customerSummary(F6.ports, 'C-0001');
    check(txt.indexOf(fmtMoney(s.bought)) >= 0 && txt.indexOf(fmtMoney(s.owed)) >= 0 && txt.indexOf(APP.tt('ui_lbl_deposit')) >= 0 && txt.indexOf(fmtMoney(s.depositHeld)) >= 0 &&
      fakeWalk(h.els.main).some(e => /\bowed\b/.test(e.className)) && fakeWalk(h.els.main).some(e => e.tagName === 'A' && /^tel:/.test(e.attrs.href)), 'the .kv rows: bought, paid, owed (warn), the deposit (above 0), the phone as a tel: link');
    check(fOf(h.els.main).some(e => /^PY\|/.test(e.getAttribute('data-f'))) && fOf(h.els.main, 'DC|C-0001').length && fOf(h.els.main, 'MS|C-0001').length && fOf(h.els.main, 'CS|C-0001').length,
      'the actions: PY| (one open credit), DC|, MS|, CS|', fOf(h.els.main).map(e => e.getAttribute('data-f')));
  });
  const lhla = F6.store.customers.filter(c => c.name === 'ဒေါ်လှလှ')[0];
  appSaleSave(F6.phone, { values: appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleSet(F6.phone, appSaleAdd(F6.phone, appSaleInit(F6.phone, {}), 'S1-0003', 1).values, 'buyer:' + lhla.id), 'paid:part'), 'amount', 2000), 'due:none'), saving: false });
  await F6.phone.commit('t');
  await app6(F6, {}, async h => {
    appOpenScreen('buyer', lhla.id);
    check(fOf(h.els.main, 'PL|' + lhla.id).length === 1, 'two open credits: PL|<customerId>');
    const rows = customerRows(F6.ports, lhla.id, CFG.CUST_HISTORY_LINES), basketRow = rows.filter(r => r.n === 3)[0];
    const tr = fOf(h.els.main, 'row:' + basketRow.groupId)[0], cells = tr.children;
    const pairs = fakeWalk(cells[1]).filter(e => e.className === 'kvs');
    check(rows.filter(r => r.groupId === basketRow.groupId).length === 1 && fakeWalk(cells[1]).filter(e => e.className === 'nm')[0].textContent === basketRow.name + ' +' + myDigits(2) &&
      fakeWalk(cells[1]).some(e => e.className === 'tag' && e.textContent === txLabel('SALE')) && pairs.length === 2 && pairs[0].children[0].textContent === APP.tt('ui_lbl_paid') &&
      pairs[1].children[0].textContent === APP.tt('ui_lbl_method') && !cells.some(c => fakeWalk(c).concat([c]).some(e => (e.textContent || '').indexOf('·') >= 0)),
      'the history table: the basket is ONE row: the item on its first line, the tag ရောင်း, the pairs ပေးပြီး / ပေးနည်း, no · in its cells (UX-M8)', textOf(tr));
    tr.click();
    check(APP.screen === 'receipt' && APP.screenArg === basketRow.groupId, 'a SALE row opens the receipt page');
    appNavBack();
    const forms = [];
    const off = F6.phone.on('measureform', r => forms.push(r));
    const navLen = APP.nav.length;
    await appScreenAct('MS|' + lhla.id);
    await h.flush();
    check(APP.measForm && APP.nav.length === navLen + 1 && appNavTop().kind === 'meas' && APP.screen === 'buyer' && !lastBotOf(F6).carrier && F6.store.chat.slice(-1)[0].carrier,
      'MS| opens the measurement form (a meas layer) and pushes no card layer; its unanswered carrier is never the latest card (lastBot skips it)');
    APP.measForm.values.neck = '14';
    appMeasFormSave();
    check(!APP.measForm && APP.screen === 'buyer' && appNavTop().kind === 'screen' && h.toastOf() === appPlain(t(F6.ports, 'meas_saved_form', { customer: lhla.name, n: fmtCount(1) })),
      'a measurement saved from MS| toasts meas_saved_form (plain) and returns to the buyer page (UX-m3)', h.toastOf());
    F6.phone.off('measureform', off);
    await appScreenAct('DC|' + lhla.id);
    check(APP.screen === 'home' && appNavTop().kind === 'card' && getState(F6.ports, uid6) && lastBotOf(F6).text, 'DC| shows the deposit prompt on a card layer');
    appNavBack();
    check(APP.screen === 'buyer' && APP.screenArg === lhla.id && getState(F6.ports, uid6) === null, 'back returns to the buyer page (the waiting state cleared)');
  });
  await F6.phone.commit('t');
  await F6.sync.syncNow('t');
  await round6d(ctx);
}

async function round6d(ctx) {
  const { W6, S6, phone6, F6, O6, uid6, same, flat, noErrors, today6, card } = ctx;
  const lastBotOf = P => P.phone.sim.lastBot();
  const lhla = F6.store.customers.filter(c => c.name === 'ဒေါ်လှလှ')[0];
  const basket45 = customerRows(F6.ports, lhla.id, 20).filter(r => r.n === 3)[0].groupId;

  step('65. The receipt page: its rows, the letterhead, the plain text, Share, PDF / Print, the void and the undo, an undone sale');
  const rv = appReceiptView(F6.phone, basket45);
  const want65 = [shopName(F6.ports, 'S1'), 'ရန်ကုန်', '09 111 222 333', appPlain(MSG.ui_lbl_receipt) + '  ' + rv.no, appPlain(MSG.ui_lbl_date) + '  ' + rv.date + ' ' + rv.time,
    appPlain(MSG.ui_lbl_buyer) + '  ဒေါ်လှလှ', 'လုံချည် ကချင် အပြာ  ၁ × 18,000  18,000', 'အင်္ကျီ ရင်ဖုံး အဖြူ  ၁ × 12,000  12,000', 'ထမီ ဇင်းမယ် အဝါ  ၁ × 22,000  22,000',
    appPlain(MSG.ui_lbl_total) + '  52,000', appPlain(MSG.ui_lbl_paid) + '  30,000', appPlain(MSG.ui_lbl_owed) + '  22,000', appPlain(MSG.ui_lbl_due) + '  ' + fmtDayMy(addDaysKey(today6(), 14))]
    .concat(rv.transfer.map(l => appPlain(MSG.ui_lbl_transfer) + '  ' + l)).concat([appPlain(MSG.receipt_thanks)]);
  const txt65 = appReceiptText(F6.phone, rv);
  APP_EMOJI_ANY.lastIndex = 0;
  check(txt65 === want65.join('\n') && !APP_EMOJI_ANY.test(txt65), 'appReceiptText: the page\'s lines, label  value, the letterhead (address, phone), no emoji', txt65.split('\n'));
  await app6(F6, {}, async h => {
    const shared = [], copied = [];
    let printed = 0;
    APP.win.navigator = { share: o => { shared.push(o); return Promise.resolve(); } };
    APP.win.print = () => { printed++; };
    appOpenScreen('receipt', basket45);
    const acts = fakeWalk(h.els.main).filter(e => e.className === 'rc-actions')[0];
    const inActs = f => fOf(acts, f).length === 1;
    check(textOf(h.els.main).indexOf('ရန်ကုန်') >= 0 && textOf(h.els.main).indexOf(fmtMoney(22000)) >= 0 && inActs('rc:share') && inActs('rc:print') && inActs('undo') && !fOf(h.els.main, 'void').length,
      'the page: the letterhead, the owed; Share, PDF / Print and the undo (within 30 minutes) inside .rc-actions; no void for a seller');
    fOf(h.els.main, 'rc:share')[0].click();
    fOf(h.els.main, 'rc:print')[0].click();
    check(shared.length === 1 && shared[0].text === txt65 && printed === 1, 'Share hands appReceiptText to navigator.share; PDF / Print calls win.print');
    delete APP.win.print;
    const asked = [];
    const realReq = APP.sync.requestReport, realOnline = APP.sync.online;
    APP.sync.requestReport = (k, g) => { asked.push([k, g]); return Promise.resolve({ ok: true }); };
    APP.sync.online = () => true;
    fOf(h.els.main, 'rc:print')[0].click();
    await tick();
    APP.sync.requestReport = realReq; APP.sync.online = realOnline;
    check(same(asked, [['receipt', basket45]]) && h.toastOf() === APP.tt('app_report_sent'), 'without print: the server\'s PDF to Telegram (requestReport receipt)', asked);
    APP.win.navigator = { clipboard: { writeText: x => { copied.push(x); return Promise.resolve(); } } };
    fOf(h.els.main, 'rc:share')[0].click();
    await tick();
    check(copied[0] === txt65 && h.toastOf() === APP.tt('ui_copied'), 'without navigator.share Share copies and toasts ui_copied');
    W6.nowOverride = new Date(Date.now() + 31 * 60000);
    appRender();
    check(!fOf(h.els.main, 'undo').length && fOf(h.els.main, 'rc:share').length, 'after 30 minutes no undo row (Share stays)');
    W6.nowOverride = null;
  });
  await O6.sync.syncNow('t');
  check(appReceiptView(O6.phone, basket45).canVoid && !appReceiptView(F6.phone, basket45).canVoid, 'the void row only for the owner\'s basket (btn_void → V|)');
  await app6(ctx.H6, {}, async h => {
    appOpenScreen('receipt', ctx.u61);
    check(textOf(h.els.main).indexOf(APP.tt('ui_hist_undone')) >= 0 && !['rc:share', 'rc:print', 'undo', 'void'].some(f => fOf(h.els.main, f).length), 'an undone sale\'s receipt shows ui_hist_undone and no Share, Print, undo or void (UX-m4)');
  });

  step('66. Views: the item, sold, today and group cards as clean lists; plain buttons; the menu keeps its emojis');
  const iv = appItemView(F6.phone, 'S1-0002'), sold = appItemView(F6.phone, 'S1-0006');
  check(iv.title === 'လုံချည် ကချင် အပြာ' && iv.rows[0].k === APP_MSG.ui_lbl_price && iv.rows[1].k === APP_MSG.ui_lbl_stock && iv.rows[1].v === fmtCount(F6.ports.store.getItem('S1-0002').stock),
    'the item view of a stock item: the price and the stock, one fact per row');
  check(sold.rows.some(r => r.k === APP_MSG.ui_lbl_buyer && r.v === 'ဒေါ်မြင့်') && sold.rows.some(r => r.k === APP_MSG.ui_lbl_stock && r.v === APP_MSG.ui_val_sold) && sold.rows.some(r => r.k === APP_MSG.ui_lbl_paid),
    'the item view of a sold one-of-a-kind piece: ရောင်းပြီး, its buyer, the paid', sold.rows);
  await ctx.F6b.sync.syncNow('t');
  const pend = appItemView(ctx.F6b.phone, 'S1-0009');
  check(pend && pend.rows[0].cls === 'warn' && pend.rows[0].v === appPlain(MSG.btn_pending), 'the item view of a pending price: စျေး မသတ်မှတ်ရသေး in the warn colour', pend && pend.rows[0]);
  const sv = appSoldView(F6.phone, ctx.basket44);
  check(sv.title === appPlain(MSG.ui_sold_title) && sv.table.rows.length === 3 && sv.table.cols.length === 3 && sv.rows[0].v === fmtMoney(83000) &&
    sv.rows.some(r => r.k === APP_MSG.ui_lbl_method && r.v === methodLabel(F6.ports, 'CASH')) && sv.table.rows.some(r => r.note === appPlain(t(F6.ports, 'ui_line_stock', { stock: fmtCount(F6.ports.store.getItem('S1-0002').stock) }))),
    'the sold view of a three-line basket: a table of the lines (a stock item\'s stock under it), the total, the method', sv.rows);
  const tv = appTodayView(O6.phone);
  check(tv.sections.length === CFG.SHOP_IDS.length && tv.sections.every((s, i) => s.heading === shopName(O6.ports, CFG.SHOP_IDS[i]) && s.rows.length === 7), 'the today view of the owner: one section per shop of CFG.SHOP_IDS, seven rows each');
  await app6(F6, {}, async h => {
    const m = F6.store.chat.filter(x => x.view && x.view.kind === 'sold').slice(-1)[0];
    const node = appRenderMsg(m, { big: true });
    const kb = fakeWalk(node).filter(e => e.tagName === 'BUTTON' && e.parentNode && e.parentNode.className === 'row');
    check(fakeWalk(node).some(e => /\bview\b/.test(e.className)) && kb.length && kb.every(b => b.getAttribute('data-cb')) && kb.every(b => { APP_EMOJI_ANY.lastIndex = 0; return !APP_EMOJI_ANY.test(b.textContent); }),
      'a card with a view: the view instead of the text, its keyboard under it with data-cb on .kb .row button, the labels plain');
    const zc = appRenderMsg({ id: 991, from: 'bot', text: '❓ x', ts: Date.now(), keyboard: [[{ text: MSG.btn_cancel, callback_data: 'Z' }, { text: MSG.btn_cancel, callback_data: 'SS|abc|z' }]] }, { big: true });
    check(fakeWalk(zc).filter(e => e.tagName === 'BUTTON').every(b => b.textContent === 'Cancel'), 'a Z button and an SS|…|z button both read Cancel (UX-m1)');
    await F6.phone.sim.start('');
    const menu = appRenderMsg(lastBotOf(F6), { big: true }), mb = fakeWalk(menu).filter(e => e.tagName === 'BUTTON');
    check(mb.length > 6 && mb.every((b, i) => b.textContent === flatTexts(lastBotOf(F6))[i]), 'the menu card keeps its emojis (the raw button texts)');
    const sku = appRenderMsg(await card(F6, 'S1-0002'), { big: true }), sell = fakeWalk(sku).filter(e => /\bsell\b/.test(e.className))[0];
    APP_EMOJI_ANY.lastIndex = 0;
    check(sell && sell.textContent === appPlain(MSG.btn_sell_one) && !APP_EMOJI_ANY.test(sell.textContent), 'the stepper\'s label at a count of 1 has no emoji (m-14)', sell && sell.textContent);
  });
  let r66 = appRestockInit(F6.phone, {});
  ['S1-0002', 'S1-0003', 'S1-0005'].forEach(id => { r66 = appRestockAdd(F6.phone, r66, id).values; });
  const rg66 = appRestockSave(F6.phone, { values: r66, saving: false }).groupId, gv = appGroupView(F6.phone, rg66);
  check(gv.title === appPlain(MSG.btn_restock) && gv.table.rows.length === 3 && gv.table.rows.every(r => r.qty === '+' + myDigits(1)), 'the group view of a three-line restock: a table (item | pieces | stock)', gv.table.rows);
  const eg66 = appExpenseSave(F6.phone, { values: appExpenseSet(F6.phone, appExpenseSet(F6.phone, appExpenseInit(F6.phone, {}), 'cat:rent'), 'amount:30000'), saving: false }).groupId, ev = appGroupView(F6.phone, eg66);
  check(ev.title === appPlain(MSG.btn_expense) && same(ev.rows.map(r => r.k), [APP_MSG.ui_lbl_amount, APP_MSG.ui_lbl_cat, APP_MSG.ui_lbl_method]) && ev.rows[1].v === categoryLabel(F6.ports, 'rent'),
    'an expense: amount, category, method (a seller: no shop row)', ev.rows);
  const pg66 = commitPayment(F6.ports, { groupId: basket45, amount: 5000, method: 'CASH', staff: F6.store.meta.staff, source: CFG.SOURCE.BUTTON }).groupId, pv = appGroupView(F6.phone, pg66);
  check(pv.title === appPlain(MSG.btn_pay) && pv.rows.some(r => r.k === APP_MSG.ui_lbl_owed && r.v === fmtMoney(17000)) && pv.rows[0].v === 'ဒေါ်လှလှ', 'a payment: the buyer, the amount, the method and what the sale still owes after it (17,000)', pv.rows);
  const dg66 = F6.store.ledger.filter(z => z.type === 'DEPOSIT' && z.customerId === 'C-0001').slice(-1)[0].groupId, dv = appGroupView(F6.phone, dg66);
  check(dv.title === appPlain(MSG.btn_deposit) && dv.rows.some(r => r.k === APP_MSG.ui_lbl_held && r.v === fmtMoney(depositsFor(F6.ports, 'C-0001'))), 'a deposit: the held total (depositsFor)', dv.rows);
  const mixId = F6.store.ledger.filter(z => z.type === 'PAYMENT' && z.note === 'split').slice(-1)[0].groupId, mv = appSoldView(F6.phone, mixId);
  const mi = mv.rows.map(r => r.k).indexOf(APP_MSG.ui_lbl_method);
  check(mv.rows[mi].v === appPlain(MSG.btn_split) && mv.rows[mi + 1].indent && mv.rows[mi + 2].indent && mv.rows.slice(mi + 1, mi + 3).map(r => r.k).sort().join() === [methodLabel(F6.ports, 'CASH'), methodLabel(F6.ports, 'KBZ')].sort().join(),
    'a mixed sale\'s sold view: ခွဲပေး and one indented row per method (UX-M8)', mv.rows);
  appNewItemSave(F6.phone, { values: appNewItemSet(F6.phone, appNewItemInit(F6.phone, { itemId: 'S1-0013' }), 'price:30000'), saving: false });
  let bk66 = appSaleAdd(F6.phone, appSaleAdd(F6.phone, appSaleInit(F6.phone, {}), 'S1-0013', 1).values, 'S1-0002', 1).values;
  appSaleSave(F6.phone, { values: appSaleSet(F6.phone, bk66, 'buyer:C-0002'), saving: false });
  const bv = appItemView(F6.phone, 'S1-0013'), bi = bv.rows.map(r => r.k);
  check(bi.indexOf(APP_MSG.ui_lbl_basket) >= 0 && bi.indexOf(APP_MSG.ui_lbl_basket) < bi.indexOf(APP_MSG.ui_lbl_paid) && bv.rows.filter(r => r.k === APP_MSG.ui_lbl_basket)[0].v === appPlain(t(F6.ports, 'basket_count', { n: fmtCount(2) })),
    'the item view of a piece sold in a basket: အတူ ဝယ်သည် {n} ခု before ပေးပြီး (no joined tail)', bv.rows);
  await F6.phone.commit('t');
  await F6.sync.syncNow('t');

  step('67. One note: one 300-character box, appMeasNoteMerge, a restored draft\'s notes moved into it, the hidden row');
  const fields67 = appMeasFormFields(measureFields(F6.ports, true));
  check(same(appMeasNoteMerge(fields67, { neck: '1' }, ''), { neck: '1' }) && same(appMeasNoteMerge(fields67, {}, ' n1 '), { note: 'n1' }) && same(appMeasNoteMerge(fields67, { note: 'a' }, 'b'), { note: 'a · b' }) &&
    appMeasNoteMerge(fields67, { note: 'x'.repeat(290) }, 'yyyyyyyyyyyyyyyyyyyy').note.length === 300 && same(appMeasNoteMerge(fields67.filter(f => f.key !== 'note'), { neck: '1' }, 'n'), { neck: '1' }),
    'appMeasNoteMerge: empty notes, notes only, both joined with ·, cut at 300, no active note field');
  await app6(F6, {}, async h => {
    appMeasDraftWrite(F6.store, 'C-0002', { values: { neck: '12' }, notes: 'old note', voucher: '' });
    appOpenMeasForm({ customerId: 'C-0002', orderId: '', staff: F6.store.meta.staff });
    const tas = fakeWalk(APP.measForm.el).filter(e => e.tagName === 'TEXTAREA');
    check(tas.length === 1 && tas[0].getAttribute('data-f') === 'note' && tas[0].attrs.maxlength === '300' && tas[0].value === 'old note', 'the form draws ONE textarea, the note (maxlength 300), with a restored draft\'s notes in it; no second box');
    appMeasFormSave();
    const rec = F6.store.measurements['C-0002'], e = F6.store.outbox.filter(x => x.kind === 'measurement').slice(-1)[0];
    check(rec.fields.note === 'old note' && rec.fields.neck === '12' && e.rec.notes === '', 'saved in fields.note with notes \'\'');
  });
  const hidden = CFG.MEASURE_FIELDS.map((f, i) => ({ key: f[0], labelMy: f[1], labelEn: f[2], group: f[3], multi: f[4], type: f[5], order: i + 1, active: f[0] !== 'note' }));
  F6.store.S.settings.meas_fields_json = JSON.stringify(hidden);
  await app6(F6, {}, async h => {
    appMeasDraftWrite(F6.store, 'C-0002', { values: { neck: '13' }, notes: 'kept as notes', voucher: '' });
    appOpenMeasForm({ customerId: 'C-0002', orderId: '', staff: F6.store.meta.staff });
    check(!fakeWalk(APP.measForm.el).some(e => e.tagName === 'TEXTAREA'), 'with the note row hidden the form has no note box');
    appMeasFormSave();
    check(F6.store.outbox.filter(x => x.kind === 'measurement').slice(-1)[0].rec.notes === 'kept as notes', 'and a restored draft\'s notes are saved as notes (UX-m3)');
  });
  delete F6.store.S.settings.meas_fields_json;
  await F6.sync.syncNow('t');

  step('68. The figure (pure): encode / decode, the 2-unit rule, erase, undo, the limits');
  const st68 = [[[10, 20], [40, 60], [100, 150]], [[150, 280], [160, 290]]];
  const e68 = appSketchEncode('F', st68), d68 = appSketchDecode(e68), m68 = appSketchDecode(appSketchEncode('M', st68));
  check(/^1F:/.test(e68) && SYNC.MEAS_SKETCH_RE.test(e68) && d68.fig === 'F' && d68.strokes.length === 2 && appSketchEncode('F', d68.strokes) === e68 && m68.fig === 'M' &&
    Math.abs(d68.strokes[0][2][0] - 100) < 1 && Math.abs(d68.strokes[1][1][1] - 290) < 1.5, 'encode / decode round trip for F and M (bytes on the 200 × 300 box)', e68);
  check(appSketchEncode('F', []) === '' && appSketchDecode('') === null && appSketchDecode('2F:AA') === null && appSketchDecode('1F:A') === null && appSketchDecode(5) === null, 'no stroke is \'\'; a bad text decodes to null');
  const p68 = appSketchAddPoint(appSketchAddPoint([[10, 10]], 11, 11), 13, 10);
  check(p68.length === 2 && p68[1][0] === 13, 'a point is kept only 2 grid units or more from the last kept one');
  check(same(appSketchErase(st68, 155, 285), [st68[0]]) && same(appSketchErase(st68, 0, 299), st68) && same(appSketchUndo(st68), [st68[0]]) && same(appSketchUndo([]), []), 'erase removes the touched stroke only; undo drops the last stroke only (UX-M5)');
  const many = []; for (let i = 0; i < 61; i++) many.push([[i, i], [i + 3, i + 3]]);
  const long = [[]]; for (let i = 0; i < 400; i++) long[0].push([i % 200, (i * 7) % 300]);
  const big = []; for (let i = 0; i < 6; i++) big.push(long[0].slice());
  check(!appSketchFits('F', many) && appSketchFits('F', many.slice(0, 60)) && appSketchEncode('F', big).length > SYNC.MEAS_SKETCH_MAX && !appSketchFits('F', big), '61 strokes, or more than 4000 characters, are refused');

  step('69. The figure saved and synced: the drawing alone refused, draw mode, the PNG job after its session, the failure rules');
  const aiCalls69 = [];
  const tr69 = (api, body) => { if (api === 'ai') aiCalls69.push(body.job.kind); return ctx.tr6(api, body); };
  const M6 = await phone6('M6 sister', sister, { transport: tr69 }), req69 = { customerId: 'C-0002', orderId: '', staff: M6.store.meta.staff };
  const ob69 = M6.store.outbox.length;
  const alone = appMeasSave(M6.phone, req69, { values: {}, sketch: e68, makeCanvas: () => null });
  check(!alone.ok && alone.reason === 'empty' && !M6.store.queuedMedia().length && M6.store.outbox.length === ob69, 'a drawing alone is refused empty and nothing is queued (B-1)');
  await app6(M6, { win: { devicePixelRatio: 1 } }, async h => {
    appOpenMeasForm(req69);
    const F = APP.measForm;
    F.skCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300 });
    const stroke = () => { fire(F.skCanvas, 'mousedown', { clientX: 50, clientY: 50, preventDefault() {} }); fire(F.skCanvas, 'mousemove', { clientX: 60, clientY: 70, preventDefault() {} }); fire(F.skCanvas, 'mousemove', { clientX: 80, clientY: 90, preventDefault() {} }); fire(F.skCanvas, 'mouseup', {}); };
    stroke();
    const before = F.sketch.strokes.length;
    fOf(F.el, 'sk:draw')[0].click();
    stroke();
    check(before === 0 && F.sketch.strokes.length === 1 && F.sketch.strokes[0].length === 3 && /\bdrawing\b/.test(F.skPad.className) && F.dirty, 'outside draw mode a pointer sequence adds no stroke; ဆွဲ then the same sequence adds one (UX-M5)');
    fOf(F.el, 'sk:undo')[0].click();
    stroke();
    fOf(F.el, 'sk:done')[0].click();
    check(F.sketch.strokes.length === 1 && !/\bdrawing\b/.test(F.skPad.className), 'undo, a stroke again, OK leaves draw mode');
    F.values.note = 'drawn';
    const drawn = appSketchEncode(F.sketch.fig, F.sketch.strokes);
    const calls = [];
    global.Path2D = function (d) { this.d = d; };
    const ctx2d = { fillRect() {}, save() {}, restore() {}, scale() {}, stroke() { calls.push('stroke'); }, beginPath() {}, moveTo() {}, lineTo() {}, clearRect() {} };
    const realCanvas = appSketchCanvas;
    try {
      global.appSketchCanvas = (w, hh) => ({ width: w, height: hh, getContext: () => ctx2d, toDataURL: () => 'data:image/png;base64,iVBORw0KGgo' });
      appMeasFormSave();
    } finally { global.appSketchCanvas = realCanvas; delete global.Path2D; }
    const job = M6.store.queuedMedia().filter(m => m.kind === 'sketch')[0], ent = M6.store.outbox.filter(e => e.kind === 'measurement').slice(-1)[0];
    check(job && job.entryId === ent.entryId && job.customerId === 'C-0002' && job.data === 'iVBORw0KGgo' && job.mime === 'image/png' && ent.rec.sketch === drawn && M6.store.measurements['C-0002'].sketch === drawn && calls.length >= 6,
      'with a canvas factory and Path2D: ONE queued sketch job with the entry\'s id; the outbox rec.sketch and the local record carry the drawing', job && { e: job.entryId === ent.entryId, d: job.data });
  });
  W6.settings.ai = 'FALSE';
  await M6.sync.flushAiJobs();
  check(!aiCalls69.length && M6.store.queuedMedia().length === 1, 'flushAiJobs sends no call while the measurement entry waits (M1 hold)');
  await M6.sync.syncNow('t');
  const meas69 = W6.measurements.filter(m => m.customerId === 'C-0002').slice(-1)[0];
  check(same(aiCalls69, ['sketch']) && !M6.store.queuedMedia().length && meas69 && meas69.photoUrl === 'sim://figure/' + meas69.id && meas69.sketch, 'after the ack the sketch job goes, also with AI off: the server\'s session has its photoUrl and its drawing', aiCalls69);
  W6.settings.ai = 'TRUE';
  await M6.sync.syncNow('t');
  // The failure rules on a stub server: no_session five times, a rejected session, no ai_down line; a voice job's ⏳ line kept.
  const answers = { sketch: { status: 'failed', error: 'no_session' }, voice: { status: 'quota', retryAfterSec: 60 } };
  const trT6 = (api, body) => api === 'ai' ? { ok: true, job: Object.assign({ id: body.job.id }, answers[body.job.kind] || { status: 'failed' }) } : ctx.tr6(api, body);
  const T6 = await phone6('T6 sister', sister, { transport: trT6 });
  const sk = T6.store.addMedia({ kind: 'sketch', status: 'queued', jobId: 'j-sk1', data: 'AAAA', mime: 'image/png', entryId: 'gone-entry', customerId: 'C-0002', queuedAt: new Date().toISOString() });
  const tries = [];
  for (let i = 0; i < 5; i++) { await T6.sync.flushAiJobs(); const m = T6.store.getMedia(sk.id); tries.push([m.status, m.tries, !!m.retryAfterUntil]); T6.store.updateMedia(sk.id, { retryAfterUntil: 0 }); }
  check(same(tries.slice(0, 4).map(x => x[0]), ['queued', 'queued', 'queued', 'queued']) && tries[0][2] && tries[4][0] === 'failed' && tries[4][1] === 5, 'no_session keeps the job queued with retryAfterUntil; the fifth makes it failed (M-2)', tries);
  check(!T6.store.chat.some(m => m.text === t(T6.ports, 'ai_down')), 'a sketch failure adds no ai_down line');
  T6.store.local.saveMeasurementLocal({ customerId: 'C-0001', fields: { neck: '10' } });
  const ent6 = T6.store.outbox.filter(e => e.kind === 'measurement').slice(-1)[0];
  const sk2 = T6.store.addMedia({ kind: 'sketch', status: 'queued', jobId: 'j-sk2', data: 'AAAA', mime: 'image/png', entryId: ent6.entryId, customerId: 'C-0001', queuedAt: new Date().toISOString() });
  T6.store.local.removeEntry(ent6.entryId);
  T6.store.local.measurementRejected('C-0001');
  check(T6.store.getMedia(sk2.id).status === 'failed' && T6.store.getMedia(sk2.id).lastError === 'rejected', 'a quarantined measurement entry fails that customer\'s sketch job at once (M-2)');
  net6Offline(ctx, true);
  await T6.phone.sim.voice('ထမီ အနီ တစ်ထည် ရောင်းတယ်');
  net6Offline(ctx, false);
  answers.sketch = { status: 'done', photoUrl: 'sim://figure/x' };
  T6.store.addMedia({ kind: 'sketch', status: 'queued', jobId: 'j-sk3', data: 'AAAA', mime: 'image/png', entryId: 'x', customerId: 'C-0002', queuedAt: new Date().toISOString() });
  await T6.sync.flushAiJobs();
  check(T6.store.chat.some(m => m.pending) && T6.store.queuedMedia().some(m => m.kind === 'voice') && !T6.store.queuedMedia().some(m => m.kind === 'sketch') &&
    T6.sync.pendingLines().some(l => l.kind === 'ai'), 'a finished sketch job leaves a waiting voice job\'s ⏳ line (m-5)');
  const model69 = appMeasModel(M6.ports, M6.store, req69);
  const M6b = await phone6('M6b sister', sister);
  await M6b.sync.syncNow('t');
  check(model69.sketch && model69.sketch === M6.store.measurements['C-0002'].sketch && appMeasModel(M6b.ports, M6b.store, req69).sketch === meas69.sketch, 'the form opened again shows the drawing, also on a phone that pulled the session');

  step('70. Shops: the owner\'s Settings list every shop, a seller\'s none; the shop form writes only the changed keys; the header at once');
  await app6(O6, { screen: 'settings' }, async h => {
    appOpenScreen('settings');
    check(CFG.SHOP_IDS.every(id => fOf(h.els.main, 'shop:' + id).length === 1) && textOf(h.els.main).indexOf('ရန်ကုန်') >= 0, 'the owner\'s Settings: a Shops row per shop of CFG.SHOP_IDS, the address under the name');
    fOf(h.els.main, 'shop:S1')[0].click();
    const S = APP.form;
    check(S && S.kind === 'shop' && S.el.attrs.id === 'shopForm', 'a row opens the shop form');
    const ob = O6.store.outbox.length;
    appFormDo(S, 'address', 'အမှတ် ၁၂၃ ဗိုလ်ချုပ်လမ်း');
    appFormDo(S, 'name', '');
    await appFormSave(S);
    check(APP.form === S && textOf(S.bar).indexOf(APP.tt('ui_shop_name_needed')) >= 0 && O6.store.outbox.length === ob, 'a blank name: ui_shop_name_needed, nothing queued');
    appFormDo(S, 'name', 'ဆိုင် ၁ (ရန်ကုန် မြို့)');
    await appFormSave(S);
    const ents = O6.store.outbox.slice(ob);
    check(same(ents.map(e => e.kind + ':' + e.key), ['setting:shop_name_S1', 'setting:shop_address_S1']) && APP.form === null && h.els.shopName.textContent === appScreenTitle('settings') &&
      shopName(O6.ports, 'S1') === 'ဆိုင် ၁ (ရန်ကုန် မြို့)', 'Save: one setting entry per changed field only (name, address; the phone unchanged)', ents.map(e => e.key));
    appNavReset();
    appRender();
    check(h.els.shopName.textContent === 'ဆိုင် ၁ (ရန်ကုန် မြို့)' && h.toastOf() === APP.tt('ui_shop_saved'), 'the header shows the new name before any sync; the toast ui_shop_saved');
  });
  const pulled70 = Object.assign({}, O6.store.settings, { shop_name_S1: 'ဆိုင် ၁ (ရန်ကုန်)' });
  O6.store.local.setSettings(pulled70);
  check(shopName(O6.ports, 'S1') === 'ဆိုင် ၁ (ရန်ကုန် မြို့)', 'a pull made while the entries wait does not undo the local value (the outbox\'s settings re-applied)');
  await O6.sync.syncNow('t');
  check(W6.settings.shop_name_S1 === 'ဆိုင် ၁ (ရန်ကုန် မြို့)' && W6.settings.shop_address_S1 === 'အမှတ် ၁၂၃ ဗိုလ်ချုပ်လမ်း', 'the sync carries them to the Settings');
  await app6(F6, {}, async h => {
    F6.store.local.setSettingLocal('shop_phone_S1', '09 000 000');
    const s70 = await F6.sync.syncNow('t');
    appOnSync(s70);
    check(s70.quarantined.some(q => q.entry.kind === 'setting' && q.reason === 'staff') && h.toastOf() === appPlain(t(F6.ports, 'app_rejected', { reason: syncReasonText(F6.ports, 'staff') })),
      'a setting the server refuses (a seller\'s) toasts app_rejected with its reason (13.12)', h.toastOf());
    await F6.sync.syncNow('t');
    check(shopPhone(F6.ports, 'S1') === W6.settings.shop_phone_S1, 'and the next pull brings the server\'s value back');
  });
  await app6(F6, {}, async h => {
    appOpenScreen('settings');
    check(!fOf(h.els.main).some(e => /^shop:/.test(e.getAttribute('data-f'))), 'a seller\'s Settings screen has no Shops section');
  });

  step('71. The AI switch on the phone: OFF and ON as setting entries, what shows at once, the seller\'s disabled switch, the jobs');
  await O6.sync.syncNow('t');
  await app6(O6, {}, async h => {
    appOpenScreen('settings');
    const ob = O6.store.outbox.length;
    fOf(h.els.main, 'ai')[0].click();
    const off = O6.store.outbox.slice(ob);
    await O6.phone.sim.start('');
    check(same(off.map(e => e.key + '=' + e.value), ['ai=FALSE']) && !aiOn(O6.ports) && h.els.btnVoice.hidden && flat(lastBotOf(O6)).indexOf('M|nb') < 0, 'OFF: one setting (ai FALSE); 🎤 hidden and no 📒 at once', off.map(e => e.key));
    const v71 = appNewItemPhoto(O6.phone, appNewItemSet(O6.phone, appNewItemInit(O6.phone, { itemId: 'S1-0010' }), 'price:9000'), { sim: { meta: SIM_PHOTOS[4], visual: SIM_PHOTOS[4].visual, mimeType: 'image/jpeg' } });
    const ai0 = S6.aiCalls;
    appNewItemSave(O6.phone, { values: v71, saving: false });
    const q = O6.store.queuedMedia();
    check(q.length === 1 && q[0].kind === 'pic' && q[0].itemId === 'S1-0010' && !appNewItemView(O6.phone, v71).nameLater, 'with AI off a new-piece Save with a photo queues ONE pic job (no photo job) and no name hint (M-1)', q.map(m => m.kind));
    await O6.sync.syncNow('t');
    check(W6.ports.store.getItem('S1-0010').photoUrl === 'sim://photo/S1-0010' && S6.aiCalls === ai0 && !O6.store.queuedMedia().length, 'after the item\'s ack the pic job sets the item\'s photoUrl on the server twin, without an AI call');
    appOpenScreen('settings');
    const ob2 = O6.store.outbox.length;
    fOf(h.els.main, 'ai')[0].click();
    const on = O6.store.outbox.slice(ob2);
    await O6.phone.sim.start('');
    appRender();
    check(same(on.map(e => e.key + '=' + e.value), ['ai=TRUE', 'notebook_import=TRUE', 'app_voice=TRUE']) && aiOn(O6.ports) && !h.els.btnVoice.hidden && flat(lastBotOf(O6)).indexOf('M|nb') >= 0,
      'ON: three settings (ai, notebook_import, app_voice TRUE); 🎤 and 📒 shown at once (m-13)', on.map(e => e.key));
  });
  await O6.sync.syncNow('t');
  await app6(F6, {}, async h => {
    await F6.sync.syncNow('t');
    appOpenScreen('settings');
    const sw = fOf(h.els.main, 'ai')[0];
    check(sw.attrs.disabled && textOf(h.els.main).indexOf(APP.tt('ui_ai_owner_only')) >= 0, 'a seller\'s switch is disabled with ui_ai_owner_only');
  });
  const calls71 = [];
  const trV6 = (api, body) => { if (api === 'ai') calls71.push(body.job.kind); return ctx.tr6(api, body); };
  const V6 = await phone6('V6 sister', sister, { transport: trV6 });
  net6Offline(ctx, true);
  await V6.phone.sim.voice('ထမီ အနီ တစ်ထည် ရောင်းတယ်');
  net6Offline(ctx, false);
  W6.settings.ai = 'FALSE';
  await V6.sync.syncNow('t');
  const vj = V6.store.media.filter(m => m.kind === 'voice')[0];
  check(!aiOn(V6.ports) && vj.status === 'skipped' && !calls71.length && V6.sync.chipState().kind === 'synced' && !V6.store.queuedMedia().length && !V6.store.chat.some(m => m.pending),
    'M-12: a voice job queued before the switch went off becomes skipped (no call); the chip reads synced with no badge; its ⏳ line cleared', [vj.status, V6.sync.chipState().kind]);
  W6.settings.ai = 'TRUE';
  await V6.sync.syncNow('t');

  step('72. The menu in the app: 📦 M|restock opens the restock form; with AI off no 📒');
  await app6(F6, {}, async h => {
    await F6.phone.sim.start('');
    const m = lastBotOf(F6), d = flat(m);
    check(d.indexOf('M|restock') === d.indexOf('M|meas') + 1, 'form mode: M|restock right after M|meas on the menu', d);
    await F6.phone.sim.tap(m.id, 'M|restock');
    await h.flush();
    check(APP.form && APP.form.kind === 'restock' && !APP.form.values.lines.length, 'its tap opens the restock form, empty');
    appCloseForm({});
  });
  W6.settings.ai = 'FALSE';
  await F6.sync.syncNow('t');
  await F6.phone.sim.start('');
  check(flat(lastBotOf(F6)).indexOf('M|nb') < 0 && flat(lastBotOf(F6)).indexOf('M|restock') >= 0, 'with AI off no M|nb (the notebook needs the switch)');
  W6.settings.ai = 'TRUE';
  await F6.sync.syncNow('t');
  check(noErrors(F6) && noErrors(O6) && noErrors(M6) && noErrors(T6) && noErrors(V6), 'no deliver, form or listener error on the phones of steps 57-72',
    [F6, O6, M6, T6, V6].map(P => P.store.errors.filter(e => e.where === 'deliver' || e.where === 'view' || /^listener:/.test(e.where)).map(e => e.where + ': ' + e.message)));
  await round6e(ctx);
}
/** The test switch of round 6's network (the world's own transport). */
function net6Offline(ctx, off) { ctx.net6.offline = off; }
/** A message's button texts in order. */
function flatTexts(m) { return ((m && m.keyboard) || []).reduce((a, r) => a.concat(r.map(b => b.text)), []); }


main().catch(err => {
  console.error('\nrun_app crashed: ' + (err && err.stack || err));
  console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed');
  process.exit(1);
});

/**
 * Step 3's independent checker (SPEC-round-6.md 13.15, F10b): rules of steps 41-72 that a mutation of the code left green,
 * each pinned here by a check that fails without its rule, and the checker's three fixes (the figure's outline box, the
 * strip kept in place, no English 'edited' marker).
 */
async function round6e(ctx) {
  const { W6, S6, phone6, F6, O6, uid6, same, card } = ctx;
  const lastBotOf = P => P.phone.sim.lastBot();

  step('73. The checker\'s pins: the nav rules, the pages, the AI switch, F10b (every shop of CFG.SHOP_IDS), the figure\'s box, the strip, no English marker');
  // The nav stack (13.4).
  await app6(F6, { opts: {} }, async h => {
    const H = stubHistory();
    APP.win.history = H;
    APP.backAgainAt = 0;
    appOnPop({ state: null });
    const t1 = h.toastOf();
    h.els.toast.textContent = '';
    appOnPop({ state: null });
    const t2 = h.toastOf();
    APP.backAgainAt = Date.now() - APP_BACK_AGAIN_MS - 1;
    appOnPop({ state: null });
    check(t1 === APP.tt('ui_back_again') && t2 === '' && h.toastOf() === APP.tt('ui_back_again'), 'ui_back_again at most once in 3 s (13.4)', [t1, t2, h.toastOf()]);
    APP.nav = [{ kind: 'card' }];
    APP.screen = 'enroll';
    const enrollBack = appNavCanBack();
    APP.screen = 'home';
    check(!enrollBack && appNavCanBack(), 'appNavCanBack is false on the enrol screen whatever the stack holds (UX-M3)');
    APP.nav = []; APP.navDepth = 0;
    H.entries = [{ state: null }]; H.at = 0; H.calls.length = 0;
    appOpenScreen('settings');
    appOpenScreen('settings');
    check(same(APP.nav.map(l => l.kind + ':' + l.name), ['screen:settings']) && H.calls.length === 1, 'appOpenScreen of the screen already on top replaces it: one layer, one history entry', [APP.nav, H.calls]);
    const c0 = H.calls.length;
    appNavDrop('sheet'); appNavDrop('form');
    check(same(APP.nav.map(l => l.kind), ['screen']) && H.calls.length === c0, 'appNavDrop does nothing when the stack holds no layer of that kind (UX-M2)', APP.nav);
    appNavReset(); H.pump();
    appOpenNumberKeypad({ title: 'x', initial: 0, onOk() {} });
    ['1', '2', '3'].forEach(k => fakeWalk(h.els.overlay).filter(e => e.tagName === 'BUTTON' && e.textContent === k)[0].click());
    appOpenDateSheet(() => {}, {});
    check(same(APP.nav.map(l => l.kind), ['sheet']) && H.at === 1, 'a keypad redrawn on every key, then another sheet drawn over it, keeps ONE sheet layer (one history entry)', [APP.nav, H.at]);
    appNavBack(); H.pump();
    check(!APP.nav.length && h.els.overlay.hidden && H.at === 0, 'and one back closes it');
    const F = appOpenForm('sale', { itemId: 'S1-0002', qty: 1 });
    appFormDo(F, 'qty+:S1-0002');
    appNavReset(); H.pump();
    const d73 = appFormDraftRead(F6.store, 'sale', uid6);
    check(APP.form === null && !APP.nav.length && d73 && same(d73.lines.map(l => [l.id, l.qty]), [['S1-0002', 2]]), 'Scan (appNavReset) closes a form without asking and keeps its draft (13.4)', d73 && d73.lines);
    appFormDraftDrop(F6.store, 'sale', uid6);
  });
  await app6(F6, {}, async h => {
    appOpenMenu();
    await tick(5);
    appRender();
    await F6.phone.sim.tap(lastBotOf(F6).id, 'M|restock');
    await h.flush();
    const R = APP.form;
    appFormTag(R, 'S1-0003');
    await appFormSave(R);
    appRender();
    check(R && APP.form === null && same(APP.nav.map(l => l.kind), ['card']) && lastBotOf(F6).view && lastBotOf(F6).view.kind === 'group',
      'a form opened from a card (the menu) and saved leaves ONE card layer: the reply card (13.4, one card layer for the home)', APP.nav);
    appNavReset();
  });
  // The buyers pages (13.6).
  await app6(F6, {}, async h => {
    const din = F6.store.customers.filter(c => c.phone)[0];
    appOpenScreen('buyers');
    const B = appOpenForm('buyer', {});
    appFormDo(B, 'name', 'ဦးစစ်ဆေး');
    appFormDo(B, 'phone', din.phone);
    await appFormSave(B);
    const chip = fOf(B.el, 'buyer:' + din.id)[0];
    check(APP.form === B && !!chip, 'a new buyer with a known phone: refused, the customer\'s chip shown');
    chip.click();
    check(APP.form === null && APP.screen === 'buyer' && APP.screenArg === din.id && same(APP.nav.map(l => l.kind + ':' + l.name), ['screen:buyers', 'screen:buyer']),
      'the known-phone chip: that buyer\'s page takes the form\'s layer (appNavReplace), no layer left over', APP.nav);
    const E = appOpenForm('buyer', { customerId: din.id });
    appFormDo(E, 'note', 'ပြင်ဆင်စစ်');
    await appFormSave(E);
    check(APP.form === null && APP.screen === 'buyer' && same(APP.nav.map(l => l.kind + ':' + l.name), ['screen:buyers', 'screen:buyer']) && F6.ports.store.getCustomer(din.id).note === 'ပြင်ဆင်စစ်',
      'an edit\'s Save drops the form\'s layer: back on that buyer\'s page, no second buyer layer', APP.nav);
    appNavReset();
  });
  // The receipt (13.10).
  const sales73 = {};
  F6.store.ledger.forEach(r => { if (r.type === CFG.TX.SALE && !r.reversesTxId) (sales73[r.groupId] = sales73[r.groupId] || []).push(r); });
  const nonCash = Object.keys(sales73).filter(g => { const v = appReceiptView(F6.phone, g); return v && !v.voided && !v.undone && v.method; })[0];
  const vnc = nonCash ? appReceiptView(F6.phone, nonCash) : null;
  check(vnc && appReceiptText(F6.phone, vnc).split('\n').indexOf(appPlain(MSG.ui_lbl_paid) + appPlain(receiptMethodText(F6.ports, buildReceipt(F6.ports, nonCash))) + '  ' + fmtMoney(vnc.paid)) >= 0,
    'the receipt\'s Share text names a non-cash method on its paid line (receiptMethodText)', vnc && appReceiptText(F6.phone, vnc));
  const oneLine = Object.keys(sales73).filter(g => sales73[g].length === 1 && !isOrderId(g) && appReceiptView(O6.phone, g) && !appReceiptView(O6.phone, g).voided)[0];
  check(oneLine && appReceiptView(O6.phone, oneLine).canVoid === false, 'the owner\'s receipt of a one-line sale has no void row (a basket only, M6)', oneLine);
  await app6(F6, {}, async h => {
    const realOnline = APP.sync.online, realReq = APP.sync.requestReport;
    let asked = 0;
    APP.sync.online = () => false;
    APP.sync.requestReport = () => { asked++; return Promise.resolve({ ok: true }); };
    delete APP.win.print;
    appReceiptPrint(nonCash);
    await tick(3);
    check(asked === 0 && h.toastOf() === APP.tt('app_need_online'), 'PDF / Print without print() and offline: the toast app_need_online, no report asked');
    APP.sync.online = realOnline; APP.sync.requestReport = realReq;
  });
  // The group view of a deposit (13.9), the buyers list of the owner (13.6), the AI switch (13.11).
  const staffO = O6.store.meta.staff;
  const zaw = commitCustomer(O6.ports, { name: 'ဦးဇော်စစ်', phone: '', note: '' }, '');
  commitDeposit(O6.ports, { shop: CFG.SHOP_IDS[1], customerId: zaw.id, amount: 1000, method: CFG.METHOD.CASH, staff: staffO, source: CFG.SOURCE.BUTTON, updateId: O6.store.nextUpdateId() });
  const dep2 = commitDeposit(O6.ports, { shop: CFG.SHOP_IDS[1], customerId: zaw.id, amount: 2000, method: CFG.METHOD.CASH, staff: staffO, source: CFG.SOURCE.BUTTON, updateId: O6.store.nextUpdateId() });
  const gv73 = appGroupView(O6.phone, dep2.groupId), held73 = (gv73.rows.filter(r => r.k === appPlain(MSG.ui_lbl_held))[0] || {}).v;
  check(held73 === fmtMoney(3000), 'a deposit\'s group view: the held total of every deposit of that buyer (3,000), not this one alone', gv73.rows);
  const br73 = appBuyersRows(O6.phone, '');
  check(br73.rows[0] && br73.rows[0].id === zaw.id, 'the owner\'s buyers list starts with the newest buyer of ANY shop (a deposit in ' + CFG.SHOP_IDS[1] + ')', br73.rows.slice(0, 3).map(r => r.name));
  await O6.phone.commit('t');
  await app6(F6, {}, async h => {
    const ob = F6.store.outbox.length;
    appAiToggle();
    check(F6.store.outbox.length === ob && aiOn(F6.ports) && h.toastOf() === APP.tt('ui_ai_owner_only'), 'a seller\'s appAiToggle writes nothing and toasts ui_ai_owner_only (13.11)');
  });
  // F10b: nothing new assumes two shops. A scratch owner phone with a third id in CFG.SHOP_IDS (the server is not asked).
  const O7 = await phone6('O7 owner F10b', U.owner);
  const ids0 = CFG.SHOP_IDS.slice(), extra = 'S' + (ids0.length + 1);
  CFG.SHOP_IDS.push(extra);
  try {
    O7.store.local.setSettingLocal('shop_name_' + extra, 'ဆိုင် စစ်');
    const pend73 = O7.sync.pendingLines().filter(l => l.kind === 'setting');
    check(pend73.some(l => l.text === t(O7.ports, 'ui_pending_setting', { label: 'ဆိုင် စစ်' })), 'F10b: a pending shop setting is named by that shop\'s name, for any id of CFG.SHOP_IDS (' + extra + ')', pend73);
    await app6(O7, {}, async h => {
      appOpenScreen('settings');
      const rows = fOf(h.els.main).map(e => e.getAttribute('data-f')).filter(f => /^shop:/.test(f));
      check(same(rows, CFG.SHOP_IDS.map(id => 'shop:' + id)), 'F10b: the owner\'s Shops section has one row per id of CFG.SHOP_IDS (' + CFG.SHOP_IDS.join(', ') + ')', rows);
      const ev = appExpenseView(O7.phone, appExpenseSet(O7.phone, appExpenseInit(O7.phone, {}), 'shop:' + extra));
      check(same(ev.shops, CFG.SHOP_IDS) && ev.shop === extra, 'F10b: the owner\'s expense form offers every id of CFG.SHOP_IDS and books the one chosen', ev.shops);
    });
  } finally { CFG.SHOP_IDS.length = 0; ids0.forEach(id => CFG.SHOP_IDS.push(id)); }
  // The sale form's keypads (1.0): paid now is capped at the total.
  await app6(F6, {}, async h => {
    const S = appOpenForm('sale', { itemId: 'S1-0003', qty: 1 });
    appFormDo(S, 'paid:part');
    const spec73 = appFormNumSpec(S, 'amount'), tot = appSaleView(F6.phone, S.values).total;
    check(spec73 && spec73.max === tot && tot > 0, 'the paid-now keypad\'s max is the total (1.0)', spec73);
    appCloseForm({});
  });
  // The labelled field of a phone question (13.5): the phone keyboard.
  await app6(F6, {}, async h => {
    setState(F6.ports, uid6, { kind: 'await_text', purpose: 'phone' });
    F6.ports.chat.sendMessage(uid6, 'ဖုန်းနံပါတ် ရိုက်ပါ', []);
    const bar = appInputBar(lastBotOf(F6)), inp = bar && fakeWalk(bar).filter(e => e.tagName === 'INPUT')[0];
    check(inp && inp.attrs.inputmode === 'tel' && fakeWalk(bar).some(e => e.tagName === 'LABEL'), 'a phone question\'s labelled field has inputmode=tel (13.5, U24)', inp && inp.attrs);
    clearState(F6.ports, uid6);
  });
  // The chat port (13.9): an edit without a view drops the old one.
  const vm73 = F6.ports.chat.sendMessage(uid6, 'x', [], { view: { kind: 'today' } });
  F6.ports.chat.editMessage(uid6, vm73.messageId, 'y', []);
  check(!F6.store.chatById(vm73.messageId).view, 'an edit without a view drops the message\'s old view (13.9)');
  // The note keeps 300 characters, every other value 60 (13.7.1).
  const col73 = appMeasCollect([{ key: CFG.MEAS_NOTE_KEY, type: 'text' }, { key: 'x1', type: 'text' }], { note: 'န'.repeat(350), x1: 'a'.repeat(70) });
  check(col73.fields.note.length === CFG.MEAS_NOTE_MAX && col73.fields.x1.length === 60, 'appMeasCollect keeps 300 characters of the note and 60 of any other value', [col73.fields.note.length, col73.fields.x1.length]);
  // A pic job waits for its item's entry (13.11, M-1 with the M1 hold).
  const calls73 = [];
  const trP7 = (api, body) => { if (api === 'ai') calls73.push(body.job.kind); return ctx.tr6(api, body); };
  W6.settings.ai = 'FALSE';
  const P7 = await phone6('P7 sister', sister, { transport: trP7 });
  await P7.sync.syncNow('t');
  const blank73 = P7.ports.store.listItems().filter(it => it.status === CFG.STATUS.BLANK && it.shop === P7.store.meta.staff.shop && !it.name)[0];
  let v73 = appNewItemSet(P7.phone, appNewItemInit(P7.phone, { itemId: blank73.id }), 'price:9000');
  v73 = appNewItemPhoto(P7.phone, v73, { sim: { meta: SIM_PHOTOS[2], visual: SIM_PHOTOS[2].visual, mimeType: 'image/jpeg' } });
  appNewItemSave(P7.phone, { values: v73, saving: false });
  await P7.phone.commit('t');
  await P7.sync.flushAiJobs();
  const held = calls73.length;
  await P7.sync.syncNow('t');
  check(held === 0 && calls73.indexOf('pic') >= 0 && W6.ports.store.getItem(blank73.id).photoUrl === 'sim://photo/' + blank73.id, 'with AI off the pic job waits while its item entry is in the outbox, and goes after the ack (M-1, M1)', [held, calls73]);
  W6.settings.ai = 'TRUE';
  // The checker's fixes.
  const rect73 = { left: 10, top: 20, width: 298, height: 398 }, b73 = appSketchBox(298, 398);
  const Fk = { skCanvas: { getBoundingClientRect: () => rect73 } };
  const at49 = appSketchPoint(Fk, { clientX: rect73.left + b73.ox + 49 * b73.s, clientY: rect73.top + b73.oy + 176 * b73.s });
  const drawn = [];
  const ctx73 = { beginPath() {}, stroke() {}, moveTo(x, y) { drawn.push([x, y]); }, lineTo(x, y) { drawn.push([x, y]); } };
  appSketchStrokes(ctx73, [[[0, 0], [200, 300]]], 298, 398, 3);
  check(Math.abs(at49[0] - 49) < 0.01 && Math.abs(at49[1] - 176) < 0.01 && Math.abs(drawn[0][0] - b73.ox) < 0.01 && b73.ox > 10 && Math.abs(drawn[1][0] - (298 - b73.ox)) < 0.01,
    'the figure on a pad that is not 2:3 (298 × 398): a touch on the outline\'s edge (x 49) is stored as 49, and a stroke is drawn where the letterboxed outline is (checker\'s fix)', [at49, drawn]);
  const css73 = fs.readFileSync(path.join(ROOT, 'app/app.css'), 'utf8'), sk73 = (css73.match(/\n\.sketch \{[^}]*\}/) || [''])[0];
  check(/aspect-ratio: 2 \/ 3/.test(sk73) && /\(100vh - 240px\) \* 2 \/ 3/.test(sk73) && !/max-height/.test(sk73), 'app.css: the pad stays a 2:3 box, its width following the calc(100vh - 240px) cap (13.13; checker\'s fix)', sk73);
  await app6(F6, {}, async h => {
    const S = appOpenForm('sale', { itemId: 'S1-0003', qty: 1 });
    const strip = S.stripEl, host = S.stripHost;
    let removed = 0;
    const rm = host.removeChild;
    host.removeChild = c => { if (c === strip) removed++; return rm(c); };
    appFormDo(S, 'paid:part');
    appFormDo(S, 'qty+:S1-0003');
    appOnSync({});
    check(strip && host.firstChild === strip && removed === 0, 'a repaint never takes the camera strip out of the page (U5: the video is not re-parented; checker\'s fix)', removed);
    appCloseForm({});
    const node = appRenderMsg({ id: 'x73', from: 'bot', text: 'ကတ်', keyboard: [], edited: true, ts: F6.phone.now().toISOString() }, { big: true });
    const all = n => (n.textContent || '') + '|' + (n.children || []).map(all).join('');
    check(all(node).indexOf('edited') < 0 && all(node).indexOf(timeKey(F6.phone.now())) >= 0 && all(node).indexOf('ကတ်') >= 0, 'an edited card shows its time with no English \'edited\' marker (F8\'s word list; checker\'s fix)', all(node));
  });
  await round6f(ctx);
}

/**
 * Step 3's fixer (the review of step 3): a photo job that meets AI off goes up as a pic job; no undo or void of a sale a
 * later payment was taken against; Menu and Scan drop the waiting question; the figure before the note at phone width;
 * the buyers search's magnifier, its square + and its fresh start; the buyer page's day labels; the dev page's layers
 * over a form; the tag keypad's label at laptop width. A world of its own, so the earlier steps' blank tags stay theirs.
 */
async function round6f(ctx) {
  const { same } = ctx;
  const lastBotOf = P => P.phone.sim.lastBot();
  const W7 = seedSimWorld(createSimWorld());
  simSeedLists(W7);
  W7.settings.sale_flow = 'form';
  ['S1-0002', 'S1-0005'].forEach(id => { for (let k = 0; k < 2; k++) { W7.sim.start(sister, id); W7.sim.tapLast(sister, 'ကုန်ရောက်'); W7.sim.tapLast(sister, '+၅'); } });
  const S7 = createFakeServer(W7);
  const net7 = { offline: false };
  const tr7 = (api, body) => {
    if (net7.offline) throw new Error('offline (test switch)');
    const res = S7.handle(api, JSON.parse(JSON.stringify(body)));
    return res === null ? null : JSON.parse(JSON.stringify(res));
  };
  const phone7 = async (name, who, transport) => {
    const tr = transport || tr7, adapter = createMemoryAdapter();
    const phone = createAppPhone({ adapter, name, transport: tr, clock: () => W7.ports.clock.now(), platform: 'android' });
    const sync = createAppSync(phone, { transport: tr, timers, platform: 'android', label: name });
    await phone.load();
    await sync.enroll(S7.mintEnrollCode(who, name).code); timers.queue.length = 0;
    return { phone, sync, adapter, store: phone.store, ports: phone.ports };
  };
  const blanks7 = () => W7.ports.store.listItems().filter(it => it.status === CFG.STATUS.BLANK && it.shop === 'S1' && !it.name).map(it => it.id);

  step('74. The fixer\'s pins: a photo job meeting AI off goes up as a pic; no undo or void after a later payment; Menu and Scan drop the waiting question; the figure before the note; the buyers search; the day labels; the dev page\'s layers; the tag keypad at laptop width');
  // A new piece saved offline with AI on (a photo job queued), then the owner switches AI off before the phone syncs:
  // (a) the phone pulls the switch first, (b) the server answers ai_off (a phone that has not pulled it).
  for (const how of ['the phone pulled AI off', 'the server answered ai_off']) {
    W7.settings.ai = 'TRUE';
    const calls = [];
    const tr = (api, body) => {
      if (api === 'ai') calls.push(body.job.kind);
      const out = tr7(api, body);
      if (how === 'the server answered ai_off' && api === 'sync' && out && out.pull && out.pull.settings) delete out.pull.settings.ai;
      return out;
    };
    const P = await phone7('P74 ' + how, sister, tr);
    await P.sync.syncNow('t');
    const id = blanks7()[0];
    net7.offline = true;
    let v = appNewItemInit(P.phone, { itemId: id });
    v = appNewItemPhoto(P.phone, v, { sim: { meta: SIM_PHOTOS[0], visual: SIM_PHOTOS[0].visual, mimeType: 'image/jpeg' } });
    v = appNewItemSet(P.phone, v, 'name', 'ထမီ စစ်ဆေး');
    v = appNewItemSet(P.phone, v, 'price:25000');
    const r = appNewItemSave(P.phone, { kind: 'newitem', values: v, saving: false });
    await P.phone.commit('t');
    const queued = P.store.queuedMedia().map(m => m.kind);
    W7.settings.ai = 'FALSE';
    net7.offline = false;
    await P.sync.syncNow('t');
    await P.sync.syncNow('t');
    const media = P.store.media.filter(m => m.itemId === id), it = W7.ports.store.getItem(id);
    check(r.ok && same(queued, ['photo']) && media.length === 1 && media[0].kind === 'pic' && media[0].status === 'done' && it.photoUrl === 'sim://photo/' + id && calls.indexOf('pic') >= 0 &&
      !P.store.queuedMedia().length, 'a new piece\'s photo job meeting AI off (' + how + ') goes up as a pic job: the server item has its photo (13.11, M-1), nothing left queued',
      [queued, media.map(m => [m.kind, m.status, m.lastError]), it.photoUrl, calls]);
  }
  W7.settings.ai = 'TRUE';
  // A basket with an open credit (part paid, ဒေါ်မြင့်), the rest taken later on the seller's phone (a PAYMENT of another group).
  const P7 = await phone7('P74 sister', sister), O7 = await phone7('O74 owner', U.owner);
  await P7.sync.syncNow('t'); await O7.sync.syncNow('t');
  let b = appSaleInit(P7.phone, { itemId: 'S1-0002', qty: 2 });
  b = appSaleAdd(P7.phone, b, 'S1-0005', 1).values;
  b = appSaleSet(P7.phone, b, 'paid:part'); b = appSaleSet(P7.phone, b, 'amount', 10000); b = appSaleSet(P7.phone, b, 'buyer:C-0001');
  b = appSaleSet(P7.phone, b, 'due:7');
  const sold = appSaleSave(P7.phone, { kind: 'sale', values: b, saving: false });
  await P7.phone.commit('t');
  const g74 = sold.groupId, histOf = () => appHistoryRows(P7.phone, 7).rows.filter(r => r.groupId === g74)[0];
  await P7.sync.syncNow('t'); await O7.sync.syncNow('t');
  const before74 = { undo: appReceiptView(P7.phone, g74).canUndo, hist: !!histOf().undoUntil, canVoid: appReceiptView(O7.phone, g74).canVoid };
  commitPayment(P7.ports, { groupId: g74, amount: 5000, method: 'CASH', staff: P7.store.meta.staff, source: CFG.SOURCE.BUTTON, updateId: P7.store.nextUpdateId() });
  await P7.phone.commit('t');
  await P7.sync.syncNow('t'); await O7.sync.syncNow('t');
  const ov74 = appReceiptView(O7.phone, g74), sv74 = appReceiptView(P7.phone, g74);
  check(sold.ok && before74.undo && before74.hist && before74.canVoid && ov74.canVoid === false && ov74.paidLater === true && sv74.canUndo === false && !histOf().undoUntil && appEntryView(P7.phone, g74).undo === false,
    'a sale a later payment was taken against: no void on the owner\'s receipt, no undo on the seller\'s receipt, history or entry page (the payment would be left without its credit)', [sold.ok, before74, ov74.canVoid, sv74.canUndo]);
  await app6(O7, {}, async h => {
    appOpenScreen('receipt', g74);
    const line = fOf(h.els.main, 'paid-later')[0];
    check(!fOf(h.els.main, 'void').length && !fOf(h.els.main, 'undo').length && line && line.textContent === appPlain(t(O7.ports, 'rewrite_locked')) && fOf(h.els.main, 'rc:share').length,
      'the receipt page says why (rewrite_locked, plain) and keeps Share; no void row', line && line.textContent);
    appNavReset();
  });
  // Menu and Scan leave the card as its ✖️ and ← do: the question it waited for is dropped (no field over a later card).
  await app6(P7, { scanner: { running: false, start: () => Promise.resolve('none'), stop() {} } }, async h => {
    const uid = P7.phone.staffId();
    appOpenMenu(); await tick(5); appRender();
    await P7.phone.sim.tap(lastBotOf(P7).id, 'M|dep'); await h.flush();
    await P7.phone.sim.tap(lastBotOf(P7).id, 'DC|new'); await h.flush();
    const asked = getState(P7.ports, uid);
    appOpenMenu(); await tick(5); appRender();
    const afterMenu = getState(P7.ports, uid);
    await P7.phone.sim.tap(lastBotOf(P7).id, 'M|pay'); await h.flush(); appRender();
    check(asked && asked.kind === 'dep' && appInputModeFor(asked) === 'text' && afterMenu === null && appInputBar(lastBotOf(P7)) === null && !fakeWalk(h.els.main).some(e => /\baskbar\b/.test(e.className)),
      'Menu while a deposit asks for a name: the question is dropped, so the payment list gets no field that would book a deposit', [asked, afterMenu]);
    setState(P7.ports, uid, { kind: 'await_number', purpose: 'pay_amount' });
    APP.keypadAutoFor = null;
    const sched0 = h.sched.length;
    appOpenMenu(); await tick(5); appRender();
    check(getState(P7.ports, uid) === null && h.sched.length === sched0 && appInputBar(lastBotOf(P7)) === null, 'Menu while a number is asked: no keypad opens over the menu', h.sched.length - sched0);
    await P7.phone.sim.tap(lastBotOf(P7).id, 'M|find'); await h.flush();
    const find = getState(P7.ports, uid);
    appOnScanButton();
    check(find && find.kind === 'find' && getState(P7.ports, uid) === null && APP.showScanner && !APP.nav.length, 'Scan while the item search waits: the search is dropped (no search field under a later card)', find);
    setState(P7.ports, uid, { kind: 'order_tag', orderId: 'V1-0001', line: 1 });
    appOnScanButton();
    const kept = getState(P7.ports, uid);
    appOpenMenu(); await tick(5);
    check(kept && kept.kind === 'order_tag' && getState(P7.ports, uid) === null, 'a state that waits for the scan itself (order_tag, no field) stays through Scan; Menu drops it', kept);
    appNavReset();
  });
  // The figure between the last measurement group and the note, in page order (the one column of a phone).
  await app6(P7, {}, async h => {
    appOpenMeasForm({ customerId: 'C-0002', orderId: '', staff: P7.store.meta.staff });
    const F = APP.measForm, walk = fakeWalk(F.el), at = pred => walk.findIndex(pred);
    const fields = appMeasFormFields(measureFields(P7.ports, true)), noteAt = fields.findIndex(f => f.key === CFG.MEAS_NOTE_KEY), lastField = fields[noteAt - 1];
    const iLast = at(e => e.tagName === 'INPUT' && String(e.getAttribute('aria-label') || '').indexOf(lastField.labelMy) === 0);
    const iSketch = at(e => /\bfsketch\b/.test(e.className)), iNote = at(e => e.getAttribute('data-f') === 'note');
    const iHead = at(e => e.tagName === 'H3' && e.textContent === measGroupLabel(P7.ports, fields[noteAt].group));
    check(noteAt > 0 && iLast >= 0 && iLast < iSketch && iSketch < iHead && iHead < iNote, 'the measurement form in page order: the last measurement field, the figure (ကိုယ်ပုံ), then the note\'s group heading and the note (13.7.2, mockup 8)', [iLast, iSketch, iHead, iNote]);
    appCloseMeasForm({});
  });
  const css74 = fs.readFileSync(path.join(ROOT, 'app/app.css'), 'utf8'), wide74 = (css74.match(/@media \(min-width: 700px\) \{\n  \.fsplit[\s\S]*?\n\}/) || [''])[0];
  check(/\.msplit > \.fgrid2 \{ grid-row: 2; \}/.test(wide74) && /\.fsketchbox \{[^}]*grid-column: 2; grid-row: 1 \/ span 2;/.test(wide74) && /\.fgrid2:empty \{ display: none; \}/.test(css74),
    'app.css: at 700 px and wider the figure stays the sticky right column beside both parts of the fields', wide74);
  // The buyers page: the magnifier inside the field, a square +, a fresh search when opened anew, kept on ←.
  await app6(P7, {}, async h => {
    appOpenScreen('buyers');
    const inp = fOf(h.els.main, 'bsearch')[0], wrap = inp && inp.parentNode, plus = fOf(h.els.main, 'buyer:new')[0];
    check(wrap && /\bsfield\b/.test(wrap.className) && wrap.children[0].innerHTML === appIconSvg('search') && wrap.children[0].attrs['aria-hidden'] === 'true' && /\biconbtn\b/.test(plus.className) &&
      /\n\.inbar \.iconbtn \{ min-width: var\(--tap\); \}/.test(css74), 'the buyers search has its magnifier inside the field (13.6, F4) and the + is square (.inbar .iconbtn)', wrap && wrap.className);
    inp.value = 'ဒေါ်';
    fire(inp, 'input');
    appOpenScreen('buyer', 'C-0001');
    appNavBack();
    const kept = fOf(h.els.main, 'bsearch')[0].value;
    appNavReset();
    appOpenScreen('buyers');
    check(kept === 'ဒေါ်' && APP.buyersText === '' && fOf(h.els.main, 'bsearch')[0].value === '', 'the buyers search: kept on ← from a buyer, empty when the page is opened anew', [kept, APP.buyersText]);
    appNavReset();
  });
  check(APP_MSG.ui_lbl_last === 'နောက်ဆုံး လာချိန်' && APP_MSG.ui_lbl_visits === 'လာသည့် အကြိမ်' && !/ဝယ်/.test(APP_MSG.ui_lbl_last + APP_MSG.ui_lbl_visits),
    'the buyer page\'s last day and count say came (customerSummary counts every day: payments and deposits too), not bought', [APP_MSG.ui_lbl_last, APP_MSG.ui_lbl_visits]);
  // The dev page: #overlay and #toast move to <body> while a form is open (above it), back into the frame after.
  const dev74 = fs.readFileSync(path.join(ROOT, 'app/dev/index.html'), 'utf8'), fn74 = (dev74.match(/function devFormLayers\(doc\) \{[\s\S]*?\n    \}/) || [''])[0];
  const mk = (cls, id) => ({ className: cls || '', id: id || '', parentNode: null, children: [],
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; } });
  const body = mk('', 'body'), frame = body.appendChild(mk('frame')), ov = frame.appendChild(mk('overlay', 'overlay')), toast = frame.appendChild(mk('toast', 'toast'));
  let observed = null;
  const fakeDoc = { body, getElementById: id => [ov, toast].filter(e => e.id === id)[0] || null,
    querySelector: sel => sel === '.frame' ? frame : sel === 'body > .formpage' ? (body.children.filter(c => /\bformpage\b/.test(c.className))[0] || null) : null };
  const sandbox = { MutationObserver: function (cb) { this.observe = (node, o) => { observed = { node, o, cb }; }; } };
  let placed = null;
  try { placed = fn74 ? vm.runInNewContext('(' + fn74 + ')', sandbox)(fakeDoc) : null; } catch (e) { placed = null; }
  const atStart = ov.parentNode === frame && toast.parentNode === frame;
  const form = body.appendChild(mk('formpage'));
  if (observed) observed.cb();
  const withForm = ov.parentNode === body && toast.parentNode === body;
  body.removeChild(form);
  if (observed) observed.cb();
  check(typeof placed === 'function' && !!observed && observed.node === body && observed.o.childList && atStart && withForm && ov.parentNode === frame && toast.parentNode === frame,
    'the dev page: a form open moves #overlay and #toast to <body> (its keypads, sheets and toasts over the form); closed, they go back into the frame', { atStart, withForm });
  check(/\.formpage \.scanrow button \{ white-space: nowrap; \}/.test(wide74) && /\.formpage \.scanrow button:not\(:only-child\) \{ flex: none; \}/.test(wide74) && /\.formpage \.scanrow input \{ flex: 1; width: auto; min-width: 0; \}/.test(wide74),
    'app.css: at 700 px and wider the tag keypad button keeps its label on one line beside the typed-tag box', wide74);
  await round6g(ctx);
}

/**
 * The app fixer of round 6's cross-step items: a done photo or pic answer's Rev taken by the phone (A1, the app half of
 * the false sync_conflict), an undone basket's group view (A2, with the core's undoReplyView), the Help's step numbers
 * (A3), the tag ids of every shop of CFG.SHOP_IDS (A4, F10b), the draft of a sale form opened with a scanned piece (A5).
 * Worlds of their own.
 */
async function round6g(ctx) {
  const { same } = ctx;
  const lastBotOf = P => P.phone.sim.lastBot();
  const world8 = () => {
    const W = seedSimWorld(createSimWorld());
    simSeedLists(W);
    W.settings.sale_flow = 'form';
    const S = createFakeServer(W), net = { offline: false, before: null };
    const tr = (api, body) => {
      if (net.offline) throw new Error('offline (test switch)');
      if (net.before) net.before(api, body);
      const res = S.handle(api, JSON.parse(JSON.stringify(body)));
      return res === null ? null : JSON.parse(JSON.stringify(res));
    };
    const phone = async (name, who) => {
      const adapter = createMemoryAdapter();
      const p = createAppPhone({ adapter, name, transport: tr, clock: () => W.ports.clock.now(), platform: 'android' });
      const sync = createAppSync(p, { transport: tr, timers, platform: 'android', label: name });
      await p.load();
      await sync.enroll(S.mintEnrollCode(who, name).code); timers.queue.length = 0;
      return { phone: p, sync, adapter, store: p.store, ports: p.ports };
    };
    return { W, S, net, phone };
  };
  const conflictsOf = (W, from) => W.errors.slice(from).filter(e => e.where === 'sync_conflict' || /sync_conflict/.test(e.message || ''));
  const pingsOf = W => (W.chats[U.owner.id] || []).length;
  const photo8 = (P, v, k) => appNewItemPhoto(P.phone, v, { sim: { meta: SIM_PHOTOS[k], visual: SIM_PHOTOS[k].visual, mimeType: 'image/jpeg' } });

  step('75. A done photo or pic answer\'s Rev (itemRev, when the phone\'s Rev is its itemRevWas): the undo of a new piece and a later piece on the same tag sync with no sync_conflict and no owner ping');
  for (const mode of ['AI on, a typed name', 'AI off', 'AI on, the placeholder name', 'offline: Save, the undo, then one sync']) {
    const { W, S, net, phone } = world8();
    if (mode === 'AI off') W.settings.ai = 'FALSE';
    const P = await phone('P75 ' + mode, sister), id = 'S1-0007', offline = /^offline/.test(mode), placeholder = /placeholder/.test(mode);
    await P.sync.syncNow('t');
    const errs0 = W.errors.length, pings0 = pingsOf(W);
    if (offline) net.offline = true;
    let v = photo8(P, appNewItemInit(P.phone, { itemId: id }), 0);
    if (!placeholder) v = appNewItemSet(P.phone, v, 'name', 'ထမီ စိမ်း');
    v = appNewItemSet(P.phone, v, 'price:25000');
    const r = appNewItemSave(P.phone, { kind: 'newitem', values: v, saving: false });
    await P.phone.commit('t');
    if (!offline) { await P.sync.syncNow('t'); await tick(20); }
    const job = P.store.media.filter(m => m.itemId === id)[0] || {}, revAfterJob = [W.ports.store.getItem(id).rev, P.ports.store.getItem(id).rev];
    const rename = P.store.outbox.filter(e => e.kind === 'item' && e.id === id).map(e => e.baseRev);
    await P.phone.sim.tap(lastBotOf(P).id, 'U|' + r.groupId);
    await P.phone.commit('t');
    net.offline = false;
    await P.sync.syncNow('t'); await tick(20);
    const srv = W.ports.store.getItem(id), revAfterUndo = [srv.rev, P.ports.store.getItem(id).rev], stockAfterUndo = S.stock(id);
    const c1 = conflictsOf(W, errs0).map(e => e.message), p1 = pingsOf(W) - pings0;
    // Later the blank tag is registered again (a second piece on the same tag), then synced.
    let w = appNewItemSet(P.phone, appNewItemInit(P.phone, { itemId: id }), 'name', 'ထမီ နီ');
    w = appNewItemSet(P.phone, w, 'price:30000');
    const r2 = appNewItemSave(P.phone, { kind: 'newitem', values: w, saving: false });
    await P.phone.commit('t');
    await P.sync.syncNow('t'); await tick(20);
    const c2 = conflictsOf(W, errs0).map(e => e.message), p2 = pingsOf(W) - pings0;
    const took = offline ? revAfterUndo[0] === revAfterUndo[1] : revAfterJob[0] === revAfterJob[1] && revAfterJob[0] > 2;
    check(r.ok && job.status === 'done' && took && (!placeholder || same(rename, [revAfterJob[0]])),
      mode + ': the phone takes the job\'s Rev (' + (offline ? 'after the one sync' : 'right after the job') + ', the server\'s)' + (placeholder ? '; the AI rename\'s item entry carries it' : ''),
      { job: [job.kind, job.status], revAfterJob, revAfterUndo, rename });
    check(srv.status === 'BLANK' && stockAfterUndo === 0 && !c1.length && !p1 && r2.ok && W.ports.store.getItem(id).name === 'ထမီ နီ' && !c2.length && !p2 &&
      W.ports.store.getItem(id).rev === P.ports.store.getItem(id).rev && (!placeholder || same(rename, [revAfterJob[0]])),
      mode + ': the undo synced leaves the tag BLANK with no sync_conflict Errors row and no owner ping' + (placeholder ? ' (the AI rename went up on the job\'s Rev, not a stale one)' : '') +
      '; the same tag registered again later syncs clean too', { c1, p1, c2, p2, rename });
  }
  {
    // The guard: the owner renamed the piece on the server between the phone's sync and the job. The phone's Rev is not the
    // answer's itemRevWas, so it keeps its own, and the undo's real conflict with the owner's rename is logged and pinged.
    const { W, net, phone } = world8();
    const P = await phone('P75 guard', sister), id = 'S1-0007';
    await P.sync.syncNow('t');
    let v = appNewItemSet(P.phone, photo8(P, appNewItemInit(P.phone, { itemId: id }), 1), 'name', 'ထမီ စိမ်း');
    const r = appNewItemSave(P.phone, { kind: 'newitem', values: appNewItemSet(P.phone, v, 'price:25000'), saving: false });
    await P.phone.commit('t');
    let renamed = false;
    net.before = api => { if (api === 'ai' && !renamed) { renamed = true; W.ports.store.updateItem(id, { name: 'ထမီ ပြာ' }); } };
    const errs0 = W.errors.length, pings0 = pingsOf(W);
    await P.sync.syncNow('t'); await tick(20);
    net.before = null;
    const kept = [W.ports.store.getItem(id).rev, P.ports.store.getItem(id).rev];
    await P.phone.sim.tap(lastBotOf(P).id, 'U|' + r.groupId);
    await P.phone.commit('t');
    await P.sync.syncNow('t'); await tick(20);
    const c = conflictsOf(W, errs0).map(e => e.message);
    check(renamed && kept[1] < kept[0] && c.length === 1 && /^S1-0007\.name: ထမီ ပြာ -> /.test(c[0]) && pingsOf(W) - pings0 === 1,
      'another writer between the sync and the job: the phone keeps its own Rev, so the undo\'s real conflict with the owner\'s rename is still logged and pinged', { kept, c });
  }

  step('76. An undone basket in the app: the group view is a table of the basket\'s own SALE rows (item | qty | stock now) under ui_hist_undone, for the seller\'s U| and the owner\'s V|');
  {
    const { W, phone } = world8();
    const P = await phone('P76 sister', sister), O = await phone('O76 owner', U.owner);
    await P.sync.syncNow('t'); await O.sync.syncNow('t');
    const basket = (Q, lines) => {
      let b = appSaleInit(Q.phone, { itemId: lines[0][0], qty: lines[0][1] });
      lines.slice(1).forEach(l => { b = appSaleAdd(Q.phone, b, l[0], l[1]).values; });
      return appSaleSave(Q.phone, { kind: 'sale', values: b, saving: false });
    };
    const stocks = (Q, ids) => ids.map(id => Q.ports.store.getItem(id).stock);
    const ids = ['S1-0002', 'S1-0003', 'S1-0005'], before = stocks(P, ids);
    const s1 = basket(P, [['S1-0002', 2], ['S1-0003', 1], ['S1-0005', 1]]);
    await P.phone.commit('t');
    await P.phone.sim.tap(lastBotOf(P).id, 'U|' + s1.groupId);
    await P.phone.commit('t');
    const m1 = lastBotOf(P), gv1 = appGroupView(P.phone, s1.groupId);
    const names = ids.map(id => P.ports.store.getItem(id).name);
    check(s1.ok && m1.view && m1.view.kind === 'group' && m1.view.id === s1.groupId && gv1 && gv1.undone && gv1.title === appPlain(txLabel('SALE')) && !gv1.rows.length &&
      !!gv1.table && same(gv1.table.cols, [APP_MSG.ui_lbl_item, APP_MSG.ui_lbl_qty, APP_MSG.ui_lbl_stock]) &&
      same(gv1.table.rows.map(r => [r.name, r.note, r.qty, r.amount]), ids.map((id, i) => [names[i], id, fmtCount([2, 1, 1][i]), fmtCount(before[i])])) && same(stocks(P, ids), before),
      'the seller\'s U| of a basket of three lines: the reply\'s view is the group view, a table item | qty | stock now of its SALE rows (the stock back), no single amount', { view: m1.view, gv1 });
    await app6(P, {}, async () => {
      const node = appRenderMsg(m1, { big: true }), walk = fakeWalk(node), view = walk.filter(e => /\bv-group\b/.test(e.className))[0];
      const kids = view ? view.children : [], tbl = walk.filter(e => e.tagName === 'TABLE')[0];
      const body = tbl ? fakeWalk(tbl).filter(e => e.tagName === 'TBODY')[0] : null;
      check(view && kids.length >= 3 && /\bmark\b/.test(kids[0].className) && kids[0].textContent === APP.tt('ui_hist_undone') && /\bvtitle\b/.test(kids[1].className) && !!tbl && /\btbl\b/.test(tbl.className) &&
        body && body.children.length === 3 && !walk.some(e => /\bkv\b/.test(e.className)),
        'drawn: ui_hist_undone on top, the title, then the .tbl of three rows; no amount row', view && kids.map(k => k.className));
    });
    await O.sync.syncNow('t');
    const s2 = basket(O, [['S1-0002', 1], ['S1-0005', 1]]);
    await O.phone.commit('t');
    await O.phone.sim.tap(lastBotOf(O).id, 'V|' + s2.groupId);
    await O.phone.commit('t');
    const m2 = lastBotOf(O), gv2 = appGroupView(O.phone, s2.groupId);
    check(s2.ok && m2.view && m2.view.kind === 'group' && m2.view.id === s2.groupId && gv2 && gv2.undone && !!gv2.table && same(gv2.table.rows.map(r => [r.note, r.qty]), [['S1-0002', fmtCount(1)], ['S1-0005', fmtCount(1)]]) && !gv2.rows.length,
      'the owner\'s V| of a basket of two lines: the same group view (its two SALE rows, under ui_hist_undone)', { view: m2.view, gv2 });
  }

  step('77. The Help in the app keeps its step numbers: a digit keycap that starts a line reads 1. 2. 3., no leading space; Telegram\'s text keeps its keycaps');
  {
    const { W, phone } = world8();
    const P = await phone('P77 sister', sister);
    await app6(P, {}, async h => {
      appOpenMenu(); await tick(5);
      await P.phone.sim.tap(lastBotOf(P).id, 'M|help'); await h.flush();
      const m = lastBotOf(P), node = appRenderMsg(m, { big: true }), NL = String.fromCharCode(10);
      const lines = node.children.filter(c => c.nodeType === 3).map(c => c.textContent).join(NL).split(NL).filter(Boolean);
      const want = MSG.help.split('\n').slice(0, 3).map((l, i) => String(i + 1) + '. ' + l.slice(l.indexOf(' ') + 1));
      check(m.text === t(P.ports, 'help') && want.every(l => lines.indexOf(l) >= 0) && !lines.some(l => /^ /.test(l)),
        'the help card in the app: its first three lines read 1. 2. 3. (no keycap, no leading space)', lines.slice(0, 4));
      appNavReset();
    });
    const K = d => d + String.fromCharCode(0xFE0F, 0x20E3), K0 = d => d + String.fromCharCode(0x20E3);
    const cases = [[K('1') + ' a\n' + K('2') + ' b', '1. a\n2. b'], [K0('3') + ' c', '3. c'], [K('4') + ' ' + String.fromCharCode(0xD83D, 0xDCF7) + ' d', '4. d'], ['x ' + K('2') + ' y', 'x y'], ['1. S1-0002', '1. S1-0002']];
    const bad = cases.filter(c => appPlain(c[0]) !== c[1]);
    check(!bad.length && MSG.help.indexOf(K('1')) === 0 && t(W.ports, 'help') === MSG.help,
      'appPlain: a leading digit keycap (with or without U+FE0F, before another emoji) is its number; a keycap inside a line still goes; Telegram\'s help is unchanged', bad.map(c => [c[0], appPlain(c[0])]));
  }

  step('78. Tag ids from CFG.SHOP_IDS (F10b): S1 and S2 parse as before; a third shop added to CFG.SHOP_IDS parses too');
  const tagCases = [['https://t.me/ShopTagBot?start=S1-0042', 'S1-0042'], [' s2-0007 ', 'S2-0007'], ['S1 0042', 'S1-0042'], ['s2 - 0001', 'S2-0001'], ['S10042', 'S1-0042'], ['S3-0001', null], ['S1-00421', null], ['hello', null]];
  const cardCases = [['👗 S1-0042 · ထမီ', 'S1-0042'], ['x S2-0003 · S1-0001', 'S2-0003'], ['S3-0004 · y', null], ['S1-004', null]];
  const tagBad = tagCases.filter(c => appParseTagLink(c[0]) !== c[1]).concat(cardCases.filter(c => appItemIdFromText(c[0]) !== c[1]));
  check(!tagBad.length && !/S\[12\]/.test(appParseTagLink.toString() + appItemIdFromText.toString()), 'S1 and S2: appParseTagLink and appItemIdFromText give what they gave (S3 is no shop: null), and neither names S[12] any more', tagBad);
  const shops78 = CFG.SHOP_IDS.slice();
  let third = null;
  try {
    CFG.SHOP_IDS.push('S3');
    third = [appParseTagLink('S3-0001'), appParseTagLink(' s3 0002 '), appParseTagLink('tg://resolve?domain=ShopTagBot&start=s3-0003'), appItemIdFromText('👗 S3-0004 · ထမီ'), appItemIdFromText('S3-0005 · S1-0001'), appParseTagLink('S1-0042')];
  } finally { CFG.SHOP_IDS.length = 0; shops78.forEach(s => CFG.SHOP_IDS.push(s)); }
  check(same(third, ['S3-0001', 'S3-0002', 'S3-0003', 'S3-0004', 'S3-0005', 'S1-0042']) && appParseTagLink('S3-0001') === null && same(CFG.SHOP_IDS, shops78),
    'S3 added to CFG.SHOP_IDS (a test context): its bare, spaced and linked ids and a card\'s text parse; taken out again, S3 is null', third);

  step('79. A sale form opened with a scanned piece writes its draft at once: an untouched one-line basket left through the line\'s name comes back under the sell button with ui_form_restored');
  {
    const { phone } = world8();
    const P = await phone('P79 sister', sister), uid = P.phone.staffId();
    await P.sync.syncNow('t');
    await app6(P, {}, async h => {
      appOnDecoded('https://t.me/ShopTagBot?start=S1-0002'); await tick(5); await h.flush();
      const F = APP.form, atOpen = appFormDraftRead(P.store, 'sale', uid);
      check(F && F.kind === 'sale' && same(F.values.lines.map(l => l.id), ['S1-0002']) && !F.dirty && atOpen && same(atOpen.lines.map(l => [l.id, l.qty]), [['S1-0002', 1]]),
        'the scan opens the sale form with its line, not changed, and its draft is in the cache already', atOpen);
      appFormClick(F, 'line:S1-0002'); await h.flush();
      const card = lastBotOf(P);
      appJobTap('sell'); await h.flush();
      const G = APP.form;
      check(APP.form && G !== F && G.kind === 'sale' && G.values.restored && same(G.values.lines.map(l => [l.id, l.qty]), [['S1-0002', 1]]) && textOf(G.el).indexOf(APP.tt('ui_form_restored')) >= 0 &&
        card && card.view && card.view.kind === 'item',
        'left through the line\'s name (the item card), the basket comes back under the sell button with ui_form_restored', G && G.values.lines);
      appCloseForm({});
      appOnDecoded('S1-0003'); await tick(5); await h.flush();
      const H = APP.form, held = !!appFormDraftRead(P.store, 'sale', uid);
      appNavBack(); await h.flush();
      const asked = !h.els.overlay.hidden;
      appJobTap('sell'); await h.flush();
      check(held && H && !asked && APP.form && !APP.form.values.restored && !APP.form.values.lines.length && !appFormDraftRead(P.store, 'sale', uid),
        'the ← of an untouched scanned basket asks nothing and drops the draft written at open: the sell button opens an empty form', { held, asked });
      appCloseForm({});
      appNavReset();
    });
  }
  await round6h(ctx);
}

/**
 * Round 6b, step 3 (docs/design-round-6/SPEC-round-6b.md 5.6): the new-piece form's sample switch and a sample's badge
 * (G1), the item category chips with their + (G2: validation, the live hint, the Save order, the AI's list, the replay,
 * a restored draft), the round-6b app texts, and Telegram's 📦 loop in the app under quick (G3). Worlds of their own.
 */
async function round6h(ctx) {
  const { same, flat } = ctx;
  const lastBotOf = P => P.phone.sim.lastBot();
  const kbOf = m => ((m && m.keyboard) || []).map(r => r.map(b => b.callback_data));
  const SILK = 'ပိုးအင်္ကျီ', OTHER = CFG.CATEGORIES[CFG.CATEGORIES.length - 1], MARK = appPlain(MSG.sample_mark).trim();
  const worldH = flow => {
    const W = seedSimWorld(createSimWorld());
    simSeedLists(W);
    if (flow) W.settings.sale_flow = flow;
    const S = createFakeServer(W), net = { offline: false, pushes: [] };
    const tr = (api, body) => {
      if (net.offline) throw new Error('offline (test switch)');
      const res = S.handle(api, JSON.parse(JSON.stringify(body)));
      const out = res === null ? null : JSON.parse(JSON.stringify(res));
      if (api === 'sync' && out && out.push) net.pushes.push(out.push);
      return out;
    };
    const phone = async (name, who) => {
      const adapter = createMemoryAdapter();
      const p = createAppPhone({ adapter, name, transport: tr, clock: () => W.ports.clock.now(), platform: 'android' });
      const sync = createAppSync(p, { transport: tr, timers, platform: 'android', label: name });
      await p.load();
      await sync.enroll(S.mintEnrollCode(who, name).code); timers.queue.length = 0;
      return { phone: p, sync, adapter, store: p.store, ports: p.ports };
    };
    const blanks = () => W.ports.store.listItems().filter(it => it.status === CFG.STATUS.BLANK && it.shop === 'S1' && !it.name).map(it => it.id);
    return { W, S, net, phone, blanks };
  };
  const plain = (P, k, v) => appPlain(t(P.ports, k, v));
  const icOf = P => ((listsJsonParse(P.store.settings.lists_json || '') || {}).item_category || []);
  const icRow = (W, key) => W.lists.filter(r => r.list === 'item_category' && r.key === key)[0];
  const badgesIn = n => fakeWalk(n).filter(e => /\bsbadge\b/.test(e.className));
  const nmOf = n => fakeWalk(n).filter(e => e.className === 'nm')[0];
  const catChips = F => fOf(F.el).filter(e => /^cat:/.test(e.getAttribute('data-f')));
  const isOn = e => !!e && /(^| )on( |$)/.test(e.className);
  const hasEmoji = s => { APP_EMOJI_ANY.lastIndex = 0; const r = APP_EMOJI_ANY.test(String(s || '')); APP_EMOJI_ANY.lastIndex = 0; return r; };
  const shown = n => (n.textContent || '') + '|' + (n.children || []).map(shown).join('');   // every text of a rendered card, text nodes included
  const noErrorsH = P => !P.store.errors.some(e => e.where === 'deliver' || e.where === 'form' || e.where === 'view' || /^listener:/.test(e.where));

  const H = worldH('form');
  const P = await H.phone('P80 sister', sister);
  await P.sync.syncNow('t');
  const tags = H.blanks();

  step('80. The sample switch and badge (round 6b, G1): the new-piece form\'s sample is a real switch named နမူနာ with its hint; a sample shows a small text badge on the tiles, the sale form\'s line and the item view; no emoji');
  await app6(P, {}, async h => {
    const F = appOpenForm('newitem', { itemId: tags[0] });
    const sw0 = fOf(F.el, 'sample')[0], kv = sw0 && sw0.parentNode, sec = kv && kv.parentNode;
    check(sw0 && sw0.tagName === 'BUTTON' && sw0.attrs.role === 'switch' && sw0.attrs['aria-checked'] === 'false' && sw0.attrs['aria-label'] === APP_MSG.ui_lbl_sample &&
      /(^| )switch( |$)/.test(sw0.className) && !isOn(sw0) && sw0.textContent === APP_MSG.ui_off,
      'the sample control is a switch: role switch, aria-checked false, aria-label ui_lbl_sample, the class switch, the text ui_off (ပိတ်)', sw0 && [sw0.attrs, sw0.className, sw0.textContent]);
    check(kv && /(^| )kv( |$)/.test(kv.className) && kv.children[0].textContent === APP_MSG.ui_lbl_sample && /(^| )k( |$)/.test(kv.children[0].className) && kv.children[1] === sw0 &&
      sec && /\bfswitch\b/.test(sec.className) && /\bfsec\b/.test(sec.className) && sec.children.length === 2 && sec.children[1].textContent === APP_MSG.ui_sample_hint && /\bmuted\b/.test(sec.children[1].className),
      'its row: the label ui_lbl_sample beside the switch, and the hint ui_sample_hint on the line under it (.fsec.fswitch)', sec && sec.children.map(c => [c.className, c.textContent]));
    sw0.click();
    const sw1 = fOf(F.el, 'sample')[0];
    check(F.values.sample === true && sw1 !== sw0 && sw1.attrs['aria-checked'] === 'true' && /(^| )switch( |$)/.test(sw1.className) && isOn(sw1) && sw1.textContent === APP_MSG.ui_on,
      'after a tap: aria-checked true, the classes switch on, the text ui_on (ဖွင့်)', sw1 && [sw1.attrs, sw1.className, sw1.textContent]);
    appFormDo(F, 'name', 'ထမီ နမူနာ ပန်း');
    appFormDo(F, 'price:25000');
    fOf(F.el, 'cat:add')[0].click();
    const said = fakeWalk(F.el).map(e => [e.textContent || '', e.attrs['aria-label'] || '', e.attrs.placeholder || ''].join(' | ')).concat([textOf(F.bar)]).filter(hasEmoji);
    check(!said.length, 'no text, aria-label or placeholder of the new-piece form holds an emoji, the plus chip\'s name field open (F7)', said.slice(0, 3));
    fOf(F.el, 'cat:add')[0].click();
    await appFormSave(F);
  });
  const sampleId = tags[0], sIt = P.ports.store.getItem(sampleId);
  const css80 = fs.readFileSync(path.join(ROOT, 'app/app.css'), 'utf8');
  const root80 = (css80.match(/\n:root \{[^}]*\}/) || [''])[0], darkM80 = (css80.match(/:root:not\(\[data-theme="light"\]\) \{[^}]*\}/) || [''])[0], darkA80 = (css80.match(/\n:root\[data-theme="dark"\] \{[^}]*\}/) || [''])[0];
  check(sIt && sIt.status === CFG.STATUS.ACTIVE && sIt.sample === true && /--good-ink: #FFFFFF;/.test(root80) && /--good-ink: #13151D;/.test(darkM80) && /--good-ink: #13151D;/.test(darkA80) &&
    /\n\.switch\.on \{[^}]*color: var\(--good-ink\);/.test(css80),
    'the piece is saved as a sample; app.css: --good-ink on :root and in both dark blocks, and .switch.on uses it (review m8)', [sIt && sIt.sample, root80.indexOf('--good-ink') >= 0, darkM80.indexOf('--good-ink') >= 0, darkA80.indexOf('--good-ink') >= 0]);
  // Step-3 checker: the badge's and the switch row's own rules (1.2), each declaration the spec gives, existing tokens only.
  const sb80 = (css80.match(/\n\.sbadge \{([^}]*)\}/) || ['', ''])[1];
  const sbWant80 = ['display: inline-block', 'margin-left: 6px', 'padding: 0 8px', 'border: 1px solid var(--accent)', 'border-radius: 999px', 'color: var(--accent)',
    'font-size: 13px', 'line-height: 20px', 'font-weight: 600', 'vertical-align: middle', 'white-space: nowrap'];
  check(sbWant80.every(d => sb80.indexOf(d + ';') >= 0) && !/#[0-9a-fA-F]{3,6}/.test(sb80) && /\n\.fswitch \.kv \{ border-bottom: 0; \}/.test(css80),
    'app.css: .sbadge holds the spec\'s declarations (a pill in var(--accent), 13 px, no wrap, no fixed colour) and .fswitch .kv has no bottom border (1.2; step-3 checker)', sb80);
  await app6(P, {}, async h => {
    const nIt = P.ports.store.getItem('S1-0002');
    const home = appTiles([sIt, nIt]), hn0 = nmOf(home.children[0]), hn1 = nmOf(home.children[1]);
    check(hn0 && textOf(hn0).indexOf(sIt.name) >= 0 && badgesIn(hn0).length === 1 && badgesIn(hn0)[0].textContent === APP_MSG.ui_lbl_sample && textOf(home).indexOf(MARK) < 0 && hn1 && !badgesIn(home.children[1]).length,
      'a sample\'s home tile: .nm holds the name and ONE .sbadge နမူနာ, no ' + MARK + '; the other tile has no badge', textOf(home));
    const S = appOpenForm('sale', { itemId: sampleId, qty: 1 });
    const ft = appFormTiles(S, [sIt, nIt], 'recent'), fn0 = nmOf(ft.children[0]);
    check(fn0 && textOf(fn0).indexOf(sIt.name) >= 0 && badgesIn(fn0).length === 1 && badgesIn(fn0)[0].textContent === APP_MSG.ui_lbl_sample && textOf(ft).indexOf(MARK) < 0 && !badgesIn(ft.children[1]).length,
      'a sample\'s form tile: the same (the name, one .sbadge, no ' + MARK + ')', textOf(ft));
    const line = fOf(S.el, 'line:' + sampleId)[0];
    check(line && textOf(line).indexOf(' · ' + sIt.name) >= 0 && badgesIn(line).length === 1 && badgesIn(line)[0].textContent === APP_MSG.ui_lbl_sample && textOf(line).indexOf(MARK) < 0,
      'the sale form\'s line of the sample: \' · \' + the name, then one .sbadge နမူနာ, no ' + MARK, line && textOf(line));
    appCloseForm({});
    const iv = appItemView(P.phone, sampleId), nv = appItemView(P.phone, 'S1-0002');
    const vt = fakeWalk(appViewNode({ kind: 'item', id: sampleId })).filter(e => /\bvtitle\b/.test(e.className))[0];
    const nNode = appViewNode({ kind: 'item', id: 'S1-0002' }), vt2 = fakeWalk(nNode).filter(e => /\bvtitle\b/.test(e.className))[0];
    check(iv.title === sIt.name && iv.badge === APP_MSG.ui_lbl_sample && nv.title === nIt.name && nv.badge === '' && vt && vt.children.length === 2 && vt.children[0].textContent === sIt.name &&
      /\bsbadge\b/.test(vt.children[1].className) && vt.children[1].textContent === APP_MSG.ui_lbl_sample && vt2 && vt2.textContent === nIt.name && !badgesIn(nNode).length,
      'appItemView of a sample: title = the name, badge = နမူနာ; appViewNode draws .vtitle as the name and the .sbadge; a non-sample has neither', [iv.title, iv.badge, nv.badge]);
  });
  H.W.ports.store.updateItem('S1-0003', { category: '🥻 ပိုးထည်' });
  await P.sync.syncNow('t');
  const sub80 = appItemView(P.phone, 'S1-0003').sub;
  check(P.ports.store.getItem('S1-0003').category === '🥻 ပိုးထည်' && sub80 === 'S1-0003 · ပိုးထည်' && !hasEmoji(sub80),
    'the item view\'s sub of a piece whose category label holds an emoji holds none (appPlain, review m6)', sub80);

  step('81. Category chips and + (round 6b, G2): the shop\'s categories by key (the catch-all last) and the plus chip; a typed name added at Save in the same commit; the snapshot; a round-6 draft');
  let silkKey = '';
  await app6(P, {}, async h => {
    const F = appOpenForm('newitem', { itemId: tags[1] });
    const c0 = catChips(F), plus = c0[c0.length - 1];
    check(same(c0.map(e => e.getAttribute('data-f')), CFG.ITEM_CATEGORY_KEYS.map(k => 'cat:' + k).concat(['cat:add'])) && same(c0.slice(0, -1).map(e => e.textContent), CFG.CATEGORIES) &&
      plus.textContent === appPlain(MSG.btn_add_cat) && /\bwi\b/.test(plus.className) && plus.children.some(c => /\bic\b/.test(c.className) && c.innerHTML === appIconSvg('plus')) && !c0.some(isOn),
      'the chips: the five cat:<key> with plain labels (cat:other the last of them), then cat:add with the plus icon and btn_add_cat\'s plain text; none on', c0.map(e => [e.getAttribute('data-f'), e.textContent]));
    fOf(F.el, 'cat:longyi')[0].click();
    const chose = [F.values.category, isOn(fOf(F.el, 'cat:longyi')[0]), F.values.catAdd];
    fOf(F.el, 'cat:longyi')[0].click();
    check(same(chose, ['လုံချည်', true, false]) && F.values.category === '' && !isOn(fOf(F.el, 'cat:longyi')[0]), 'cat:longyi chooses လုံချည် (its chip on); a second tap clears it', [chose, F.values.category]);
    const focused = [], seq81 = [];
    F.el.querySelector = sel => {
      const m = /^\[data-f="([^"]+)"\]$/.exec(sel), el = m ? fOf(F.el, m[1])[0] : null;
      if (el) el.focus = () => focused.push(m[1]);
      // Round-6b fix: the call order and arguments of focus and scrollIntoView on the queried element.
      if (el) { const f0 = el.focus; el.focus = o => { seq81.push(['focus', m[1], o || null]); f0(o); }; el.scrollIntoView = o => seq81.push(['scroll', m[1], o || null]); }
      return el || null;
    };
    fOf(F.el, 'cat:longyi')[0].click();
    const catKey81 = F.values.catKey;
    fOf(F.el, 'cat:add')[0].click();
    const inp = fOf(F.el, 'catname')[0];
    check(F.values.catAdd === true && F.values.category === '' && isOn(fOf(F.el, 'cat:add')[0]) && !isOn(fOf(F.el, 'cat:longyi')[0]) && inp && inp.tagName === 'INPUT' && inp.attrs.maxlength === '40' &&
      inp.attrs.placeholder === appPlain(MSG.add_ask_ic) && inp.attrs['aria-label'] === appPlain(MSG.add_ask_ic) && same(focused, ['catname']),
      'cat:add turns the plus chip on (the chosen chip off), opens the name field (add_ask_ic, at most 40) and focuses it once after the repaint (review m12)', [F.values.catAdd, focused, inp && inp.attrs]);
    check(same(seq81, [['focus', 'catname', { preventScroll: true }], ['scroll', 'catname', { block: 'center' }]]),
      'cat:add turned on: the name field is focused without the browser\'s own scroll, then scrolled ONCE to the middle (block center), so it is never left under the fixed Save bar (round-6b fix)', seq81);
    check(catKey81 === 'longyi' && F.values.catKey === '', 'cat:longyi keeps its row key (catKey longyi); cat:add turned on clears it (round-6b fix)', [catKey81, F.values.catKey]);
    inp.value = SILK;
    fire(inp, 'input');
    appFormDo(F, 'price:25000');
    const snap = appFormSnap();
    check(snap && snap.kind === 'newitem' && snap.category === SILK && snap.catAdd === true && snap.cat === '', 'before Save the snapshot reads the typed name as category and catAdd true', snap && [snap.category, snap.catAdd, snap.cat]);
    const out0 = P.store.outbox.length;
    const ok = await appFormSave(F);
    const added = P.store.outbox.slice(out0), le = added.filter(e => e.kind === 'list')[0] || { rec: {} };
    silkKey = le.rec.key || '';
    check(ok && P.ports.store.getItem(tags[1]).category === SILK && same(added.map(e => e.kind), ['list', 'item', 'group']) && le.rec.list === 'item_category' && le.rec.label === SILK && /^i[0-9a-f]{4}$/.test(silkKey) &&
      same(icOf(P).map(c => [c.k, c.l]), CFG.ITEM_CATEGORY_KEYS.map((k, i) => [k, CFG.CATEGORIES[i]]).concat([[silkKey, SILK]])),
      'Save: the piece\'s category is ' + SILK + '; the outbox holds ONE list entry {item_category, ' + SILK + '} with the item and the group; lists_json holds the five and the new row',
      { kinds: added.map(e => e.kind), rec: le.rec, ic: icOf(P).map(c => [c.k, c.l]) });
    const G = appOpenForm('newitem', { itemId: tags[2] });
    check(same(catChips(G).map(e => e.getAttribute('data-f')), CFG.ITEM_CATEGORY_KEYS.slice(0, 4).map(k => 'cat:' + k).concat(['cat:' + silkKey, 'cat:other', 'cat:add'])) &&
      fOf(G.el, 'cat:' + silkKey)[0].textContent === SILK, 'a second form shows the new chip before cat:other', catChips(G).map(e => e.getAttribute('data-f')));
    appCloseForm({});
    appFormDraftWrite(P.store, 'newitem', tags[3], { tag: tags[3], photo: '', name: 'လုံချည် ဟောင်း', cat: 1, cost: null, price: null, pending: false, count: 1, sample: false, restored: false });
    const D = appOpenForm('newitem', { itemId: tags[3] });
    check(D.values.restored && D.values.category === 'လုံချည်' && !('cat' in D.values) && D.values.catAdd === false && D.values.catName === '' && isOn(fOf(D.el, 'cat:longyi')[0]) && catChips(D).filter(isOn).length === 1,
      'a restored round-6 draft with cat: 1 opens with လုံချည် chosen (its chip on)', [D.values.category, D.values.cat]);
    appCloseForm({});
  });
  check(/\n\.formpage \.toggle button\[data-f\^="cat:"\] \{ white-space: normal; overflow-wrap: anywhere; \}/.test(css80), 'app.css: the category chips wrap (a 40-character label never widens a phone column, review m7)');
  // Step-3 checker: set's own clamp (2.5 'catname'), so a pasted or simulator-filled name never exceeds CFG.LIST_LABEL_MAX.
  const long81 = appNewItemSet(P.phone, appNewItemSet(P.phone, appNewItemFresh(tags[4]), 'cat:add'), 'catname', 'ab'.repeat(30));
  check(long81.catAdd === true && long81.catName === 'ab'.repeat(20) && long81.catName.length === CFG.LIST_LABEL_MAX,
    'catname: a 60-character name is held as its first ' + CFG.LIST_LABEL_MAX + ' characters (set clamps to CFG.LIST_LABEL_MAX; step-3 checker)', long81.catName.length);

  step('82. The typed category refused, used or not written (round 6b, G2): empty, digits and amounts; the sample word; a name the owner closed; an offered name; a closed form; a store without addListOption');
  await P.sync.syncNow('t');
  await app6(P, {}, async h => {
    const id = tags[4], F = appOpenForm('newitem', { itemId: id });
    appFormDo(F, 'price:25000');
    fOf(F.el, 'cat:add')[0].click();
    const type = s => { const inp = fOf(F.el, 'catname')[0]; inp.value = s; fire(inp, 'input'); };
    const msgOf = () => { const m = fakeWalk(F.bar).filter(e => /\bfmsg\b/.test(e.className))[0]; return m && !m.attrs.hidden ? m.textContent : ''; };
    const hintOf = () => (F.regions.cathint ? textOf(F.regions.cathint.el).trim() : '');
    const out0 = P.store.outbox.length, lj0 = P.store.settings.lists_json, still = () => P.store.outbox.length === out0 && P.store.settings.lists_json === lj0 && P.ports.store.getItem(id).status === CFG.STATUS.BLANK;
    const bad1 = [];
    for (const s of ['', '123', '5000 ကျပ်']) {
      type(s);
      const ok = await appFormSave(F), inp = fOf(F.el, 'catname')[0], sec = inp && inp.parentNode;
      const pr = appNewItemProblems(P.phone, F.values)[0] || {};
      if (!(ok === false && APP.form === F && pr.key === 'add_ask_ic' && pr.field === 'catname' && msgOf() === plain(P, 'add_ask_ic') && /\bfbad\b/.test(inp.className) && /\bfbad\b/.test(sec.className) && still())) bad1.push([s, pr.key, msgOf(), inp && inp.className]);
    }
    check(!bad1.length, 'catname \'\', \'123\', \'5000 ကျပ်\': the form\'s first problem is add_ask_ic on catname; Save refused, .fmsg = plain add_ask_ic, the field and its section .fbad, nothing queued, lists_json unchanged, the tag still BLANK', bad1);
    const bad2 = [];
    for (const s of [CFG.SAMPLE_WORD, CFG.SAMPLE_WORD + ' ထမီ']) {
      type(s);
      const hint = hintOf(), ok = await appFormSave(F);
      if (!(hint === plain(P, 'add_ic_sample') && ok === false && (appNewItemProblems(P.phone, F.values)[0] || {}).key === 'add_ic_sample' && msgOf() === plain(P, 'add_ic_sample') && still())) bad2.push([s, hint, msgOf()]);
    }
    check(!bad2.length, '\'နမူနာ\' and \'နမူနာ ထမီ\': the cathint region shows plain add_ic_sample while typing, and Save is refused with it, nothing written', bad2);
    icRow(H.W, 'wutsone').active = false;
    await P.sync.syncNow('t');
    const offered = itemCategoryOptions(P.ports, 'S1').map(r => r.key);
    type('ဝတ်စုံ');
    const hint3 = hintOf(), ok3 = await appFormSave(F), msg3 = msgOf(), pr3 = appNewItemProblems(P.phone, F.values)[0] || {};
    const want3 = plain(P, 'add_ic_closed', { label: 'ဝတ်စုံ' });
    check(offered.indexOf('wutsone') < 0 && !catChips(F).some(e => e.getAttribute('data-f') === 'cat:wutsone') && hint3 === want3 && ok3 === false && pr3.key === 'add_ic_closed' && pr3.vars.label === 'ဝတ်စုံ' && msg3 === want3 && P.store.outbox.length === out0 &&
      P.ports.store.getItem(id).status === CFG.STATUS.BLANK && !P.store.outbox.some(e => e.kind === 'list'),
      'the ဝတ်စုံ row unticked on the laptop and pulled: no chip; typed \'ဝတ်စုံ\' → cathint and Save show plain add_ic_closed (ဝတ်စုံ), no list entry (review M6)', [offered, hint3, msg3]);
    type('ထမီ ');
    const hint4 = hintOf(), ok4 = await appFormSave(F), added4 = P.store.outbox.slice(out0);
    check(hint4 === plain(P, 'add_exists', { label: 'ထမီ' }) && ok4 && APP.form === null && P.ports.store.getItem(id).category === 'ထမီ' && same(added4.map(e => e.kind), ['item', 'group']),
      '\'ထမီ \': cathint shows plain add_exists; Save stores ထမီ and queues no list entry', [hint4, added4.map(e => e.kind)]);
    const G = appOpenForm('newitem', { itemId: tags[5] }), out5 = P.store.outbox.length, lj5 = P.store.settings.lists_json;
    fOf(G.el, 'cat:add')[0].click();
    const inp5 = fOf(G.el, 'catname')[0];
    inp5.value = 'ပုဆိုး';
    fire(inp5, 'input');
    appCloseForm({});
    check(APP.form === null && P.store.outbox.length === out5 && P.store.settings.lists_json === lj5 && !itemCategoryOptions(P.ports, 'S1').some(r => r.label === 'ပုဆိုး'),
      'a form closed after typing a new name writes no Lists row and queues nothing', P.store.outbox.slice(out5).map(e => e.kind));
    const K = appOpenForm('newitem', { itemId: tags[5] }), keep = P.ports.store.addListOption;
    appFormDo(K, 'price:25000');
    fOf(K.el, 'cat:add')[0].click();
    const inp6 = fOf(K.el, 'catname')[0];
    inp6.value = 'ပုဆိုး';
    fire(inp6, 'input');
    let ok6 = null, msg6 = '';
    delete P.ports.store.addListOption;
    try { ok6 = await appFormSave(K); msg6 = (fakeWalk(K.bar).filter(e => /\bfmsg\b/.test(e.className))[0] || {}).textContent; } finally { P.ports.store.addListOption = keep; }
    check(ok6 === false && msg6 === plain(P, 'add_unavailable') && P.store.outbox.length === out5 && P.ports.store.getItem(tags[5]).status === CFG.STATUS.BLANK,
      'a store without addListOption: Save refused with add_unavailable, nothing written', [ok6, msg6]);
    appCloseForm({});
    // Step-3 checker: the same refusal with a photo in the form: the category step runs before the photo is saved, so the
    // photo's media record stays the form's own (no itemId) and nothing else is written (2.5 Save: 'nothing else written').
    let v7 = appNewItemPhoto(P.phone, appNewItemFresh(tags[5]), { sim: { meta: { key: 'x7', name: 'x', category: OTHER, color: '', description: '' }, visual: { emoji: '👘', bg: '#000' }, mimeType: 'image/jpeg' } });
    v7 = appNewItemSet(P.phone, appNewItemSet(P.phone, appNewItemSet(P.phone, v7, 'cat:add'), 'catname', 'ပုဆိုး'), 'price:25000');
    const media7 = v7.photo, out7 = P.store.outbox.length;
    let r7 = null;
    delete P.ports.store.addListOption;
    try { r7 = appNewItemSave(P.phone, { kind: 'newitem', values: v7, saving: false }); } finally { P.ports.store.addListOption = keep; }
    const m7 = P.store.getMedia(media7) || {};
    check(r7 && r7.ok === false && r7.problems[0].key === 'add_unavailable' && m7.status === 'file' && !m7.itemId && P.store.outbox.length === out7 &&
      !P.store.media.some(m => m.itemId === tags[5]) && P.ports.store.getItem(tags[5]).status === CFG.STATUS.BLANK,
      'with a photo in the form, the add_unavailable refusal leaves the photo unsaved (its media has no itemId, no job) and writes nothing (step-3 checker)', [r7 && r7.problems, m7.status, m7.itemId]);
    P.store.removeMedia(media7);
  });

  step('83. The AI\'s list, the replay and a restored draft (round 6b, 2.8 rows 8 and 12, B3, B11)');
  await P.sync.syncNow('t');
  const silkPhoto = { key: 'silk_red', name: 'ပိုးအင်္ကျီ အနီ', category: SILK, color: 'အနီ', description: '', visual: { emoji: '👘', bg: '#b71c1c' } };
  const pings83 = () => (H.W.chats[U.owner.id] || []).length, conflicts83 = from => H.W.errors.slice(from).filter(e => e.where === 'sync_conflict' || /sync_conflict/.test(e.message || ''));
  const resultOf83 = (from, entryId) => { let r = null; H.net.pushes.slice(from).forEach(p => (p.results || []).forEach(x => { if (x && x.entryId === entryId) r = x; })); return r || {}; };
  const photoSave = id => {
    let v = appNewItemPhoto(P.phone, appNewItemInit(P.phone, { itemId: id }), { sim: { meta: silkPhoto, visual: silkPhoto.visual, mimeType: 'image/jpeg' } });
    v = appNewItemSet(P.phone, v, 'price:25000');
    return appNewItemSave(P.phone, { kind: 'newitem', values: v, saving: false });
  };
  const late = async (id, between) => {
    const r = photoSave(id);
    await P.phone.commit('t');
    const job = P.store.media.filter(m => m.itemId === id && m.kind === 'photo')[0] || { ctx: {} }, want = itemCategoryAi(P.ports, 'S1').names, before = P.ports.store.getItem(id);
    if (between) between();
    const errs0 = H.W.errors.length, pings0 = pings83(), push0 = H.net.pushes.length;
    await P.sync.syncNow('t'); await tick(20);
    const offersAtReplay = itemCategoryOptions(P.ports, 'S1').some(r2 => r2.label === SILK);
    const replay = P.store.outbox.filter(e => e.kind === 'item' && e.id === id)[0] || {};
    await P.sync.syncNow('t'); await tick(20);
    return { r, job: P.store.media.filter(m => m.itemId === id && m.kind === 'photo')[0] || job, ctx: job.ctx || {}, want, before, offersAtReplay, replay, res: resultOf83(push0, replay.entryId),
      sv: H.W.ports.store.getItem(id), ph: P.ports.store.getItem(id), conflicts: conflicts83(errs0), pings: pings83() - pings0 };
  };
  const a83 = await late(tags[6]);
  check(a83.r.ok && same(a83.ctx.categories, a83.want) && a83.want.indexOf(SILK) >= 0 && a83.want[a83.want.length - 1] === OTHER && a83.before.category === OTHER && a83.before.name === itemPlaceholderName(tags[6]),
    'a Save with a photo queues a job whose ctx.categories is itemCategoryAi(ports, S1).names (' + SILK + ' in it, the catch-all last); the piece waits at its placeholder and the catch-all', { ctx: a83.ctx, want: a83.want });
  check(a83.job.status === 'done' && a83.sv.name === silkPhoto.name && a83.sv.category === SILK && a83.ph.name === silkPhoto.name && a83.ph.category === SILK &&
    same(a83.replay.fields, { name: silkPhoto.name, category: SILK }) && a83.res.status === 'dup' && !a83.conflicts.length && !a83.pings && !P.store.outbox.length,
    'the server twin renames the placeholder to the AI\'s name and the custom category; the phone\'s replay pushes the same fields, answered dup; no sync_conflict, no owner ping',
    { sv: [a83.sv.name, a83.sv.category], fields: a83.replay.fields, res: a83.res, conflicts: a83.conflicts.map(e => e.message), pings: a83.pings });
  // B3 on the phone: the owner unticks the category after the Save and before the sync, so the phone pulls the untick in the
  // same sync that brings the job's answer; the replay still decides against the job's own list, as the server does.
  const b83 = await late(tags[2], () => { icRow(H.W, silkKey).active = false; });
  check(b83.offersAtReplay === false && b83.ctx.categories.indexOf(SILK) >= 0 && b83.sv.category === SILK && b83.ph.category === SILK && same(b83.replay.fields, { name: silkPhoto.name, category: SILK }) &&
    b83.res.status === 'dup' && !b83.conflicts.length && !b83.pings,
    'the category unticked and pulled before the replay: the phone no longer offers it, yet its replay decides against the job\'s list like the server: the same fields, dup, no conflict',
    { offers: b83.offersAtReplay, fields: b83.replay.fields, res: b83.res, conflicts: b83.conflicts.map(e => e.message) });
  icRow(H.W, silkKey).active = true;
  await P.sync.syncNow('t');
  // B11: a restored draft of a category the owner retired (ဝတ်စုံ, unticked in step 82): no chip on, Save stores the catch-all.
  appFormDraftWrite(P.store, 'newitem', tags[3], { tag: tags[3], photo: '', name: 'ဝတ်စုံ ဟောင်း', category: 'ဝတ်စုံ', catAdd: false, catName: '', cost: null, price: 30000, pending: false, count: 1, sample: false, restored: false });
  const v11 = appNewItemInit(P.phone, { itemId: tags[3] }), w11 = appNewItemView(P.phone, v11);
  let on11 = null;
  await app6(P, {}, async h => { const F = appOpenForm('newitem', { itemId: tags[3] }); on11 = catChips(F).filter(isOn).map(e => e.getAttribute('data-f')); appCloseForm({ keep: true }); });
  const r11 = appNewItemSave(P.phone, { kind: 'newitem', values: v11, saving: false });
  check(v11.restored && v11.category === 'ဝတ်စုံ' && w11.catKey === '' && !w11.categories.some(c => c.key === 'wutsone') && same(on11, []) && r11.ok && P.ports.store.getItem(tags[3]).category === OTHER,
    'B11: a restored draft whose category ဝတ်စုံ was unticked and pulled: no chip on (view.catKey \'\'), Save stores ' + OTHER, [w11.catKey, on11, P.ports.store.getItem(tags[3]).category]);
  // A restored round-6 draft (cat: 0) after the htamein row is relabelled ထမိန် on the laptop and pulled.
  icRow(H.W, 'htamein').label = 'ထမိန်';
  await P.sync.syncNow('t');
  appFormDraftWrite(P.store, 'newitem', tags[5], { tag: tags[5], photo: '', name: 'ထမီ ဟောင်း', cat: 0, cost: null, price: 30000, pending: false, count: 1, sample: false, restored: false });
  let on12 = null, txt12 = '';
  await app6(P, {}, async h => {
    const F = appOpenForm('newitem', { itemId: tags[5] });
    on12 = catChips(F).filter(isOn).map(e => e.getAttribute('data-f'));
    txt12 = (fOf(F.el, 'cat:htamein')[0] || {}).textContent;
    await appFormSave(F);
  });
  check(same(on12, ['cat:htamein']) && txt12 === 'ထမိန်' && P.ports.store.getItem(tags[5]).category === 'ထမိန်',
    'a restored round-6 draft with cat: 0 after the htamein row is relabelled ထမိန် and pulled: the cat:htamein chip (ထမိန်) is on and Save stores ထမိန်', [on12, txt12, P.ports.store.getItem(tags[5]).category]);
  check(noErrorsH(P), 'no exception on the round-6b form phone', P.store.errors.slice(-3).map(e => e.where + ': ' + e.message));
  // Step-3 checker (2.5 'the shop below is the tag's shop, else the staff's'; F10b): the owner (staff shop S1) registers S2
  // tags. A row limited to S2 is a chip, a pick, an offered typed name, a Save and in the photo job's list for the S2 tag,
  // and closed for an S1 tag; a hand-typed key holding ':' and a label typed with an emoji work as chips (plain text).
  {
    const R83 = worldH('form');
    R83.W.lists.push({ list: 'item_category', key: 's2only', label: 'မန္တလေး ပိုး', active: true, order: 9, shop: 'S2', detail: '', note: '' });
    R83.W.lists.push({ list: 'item_category', key: 'p:1', label: 'ပုဆိုး', active: true, order: 10, shop: '', detail: '', note: '' });
    R83.W.lists.push({ list: 'item_category', key: 'emo1', label: '🥻 ပိုးထည်', active: true, order: 11, shop: '', detail: '', note: '' });
    const O = await R83.phone('P83 owner', U.owner);
    await O.sync.syncNow('t');
    const s2 = R83.W.ports.store.listItems().filter(it => it.status === CFG.STATUS.BLANK && it.shop === 'S2').map(it => it.id);
    const out83 = O.store.outbox.length;
    let chips2 = [], chips1 = [], picked = '', pickedColon = '', emoText = '', hint1 = '', prob1 = '', hint2 = '', prob2 = null, nochange = null;
    await app6(O, {}, async h => {
      const F = appOpenForm('newitem', { itemId: s2[0] });
      chips2 = catChips(F).map(e => e.getAttribute('data-f'));
      emoText = (fOf(F.el, 'cat:emo1')[0] || {}).textContent;
      const tap = f => { const b = fOf(F.el, f)[0]; if (b) b.click(); return F.values.category; };
      picked = tap('cat:s2only');
      pickedColon = tap('cat:p:1');
      nochange = appNewItemSet(O.phone, F.values, 'cat:nosuch').category === pickedColon;
      fOf(F.el, 'cat:add')[0].click();
      const inp = fOf(F.el, 'catname')[0]; inp.value = 'မန္တလေး ပိုး'; fire(inp, 'input');
      hint2 = F.regions.cathint ? textOf(F.regions.cathint.el).trim() : '';
      prob2 = appNewItemProblems(O.phone, F.values).filter(p => p.code === 'cat');
      appCloseForm({});
      const G = appOpenForm('newitem', { itemId: 'S1-0007' });
      chips1 = catChips(G).map(e => e.getAttribute('data-f'));
      fOf(G.el, 'cat:add')[0].click();
      const inp1 = fOf(G.el, 'catname')[0]; inp1.value = 'မန္တလေး ပိုး'; fire(inp1, 'input');
      hint1 = G.regions.cathint ? textOf(G.regions.cathint.el).trim() : '';
      prob1 = (appNewItemProblems(O.phone, G.values).filter(p => p.code === 'cat')[0] || {}).key;
      appCloseForm({});
    });
    check(chips2.indexOf('cat:s2only') >= 0 && chips2.indexOf('cat:p:1') >= 0 && chips2[chips2.length - 2] === 'cat:other' && chips1.indexOf('cat:s2only') < 0 && chips1.indexOf('cat:p:1') >= 0 &&
      picked === 'မန္တလေး ပိုး' && pickedColon === 'ပုဆိုး' && nochange === true && emoText === 'ပိုးထည်' && !hasEmoji(emoText),
      'the owner\'s S2 tag shows and picks the S2-only chip (an S1 tag does not show it); a key holding \':\' picks its row; an unknown key changes nothing; an emoji label\'s chip is plain (step-3 checker)',
      { chips2, chips1, picked, pickedColon, nochange, emoText });
    check(hint2 === plain(O, 'add_exists', { label: 'မန္တလေး ပိုး' }) && !prob2.length && hint1 === plain(O, 'add_ic_closed', { label: 'မန္တလေး ပိုး' }) && prob1 === 'add_ic_closed',
      'the S2-only name typed for the S2 tag is offered (add_exists, no problem); for an S1 tag it is closed (add_ic_closed): the tag\'s shop decides, not the owner\'s (step-3 checker)', { hint2, prob2, hint1, prob1 });
    const sv1 = appNewItemSave(O.phone, { kind: 'newitem', values: appNewItemSet(O.phone, appNewItemSet(O.phone, appNewItemSet(O.phone, appNewItemFresh(s2[1]), 'cat:add'), 'catname', 'မန္တလေး ပိုး'), 'price:25000'), saving: false });
    let v2 = appNewItemPhoto(O.phone, appNewItemFresh(s2[2]), { sim: { meta: { key: 'x83', name: 'x', category: OTHER, color: '', description: '' }, visual: { emoji: '👘', bg: '#000' }, mimeType: 'image/jpeg' } });
    v2 = appNewItemSet(O.phone, appNewItemSet(O.phone, v2, 'cat:s2only'), 'price:25000');
    const sv2 = appNewItemSave(O.phone, { kind: 'newitem', values: v2, saving: false });
    const job2 = O.store.media.filter(m => m.itemId === s2[2] && m.kind === 'photo')[0] || { ctx: {} };
    check(sv1.ok && O.ports.store.getItem(s2[1]).category === 'မန္တလေး ပိုး' && sv2.ok && O.ports.store.getItem(s2[2]).category === 'မန္တလေး ပိုး' &&
      same(job2.ctx.categories, itemCategoryAi(O.ports, 'S2').names) && job2.ctx.categories.indexOf('မန္တလေး ပိုး') >= 0 && !O.store.outbox.slice(out83).some(e => e.kind === 'list'),
      'Save on the S2 tags: the typed S2-only name and its chip store it with no list entry, and the photo job\'s list is the S2 list (itemCategoryAi(ports, S2), the piece\'s shop; step-3 checker)',
      { c1: O.ports.store.getItem(s2[1]).category, c2: O.ports.store.getItem(s2[2]).category, ctx: job2.ctx });
    // A chip tapped while the plus chip's name is typed: the chip wins (catAdd off, the field closed), Save stores the chip's
    // category and writes no Lists row (2.5 set: 'x.category = row.label; x.catAdd = false').
    let mid = null, sv3 = null;
    await app6(O, {}, async h => {
      const F = appOpenForm('newitem', { itemId: s2[3] });
      appFormDo(F, 'price:25000');
      fOf(F.el, 'cat:add')[0].click();
      const inp = fOf(F.el, 'catname')[0]; inp.value = 'ပုဆိုး အသစ်'; fire(inp, 'input');
      fOf(F.el, 'cat:longyi')[0].click();
      mid = { catAdd: F.values.catAdd, field: fOf(F.el, 'catname').length, on: catChips(F).filter(isOn).map(e => e.getAttribute('data-f')), snap: appFormSnap() };
      sv3 = await appFormSave(F);
    });
    check(mid.catAdd === false && mid.field === 0 && same(mid.on, ['cat:longyi']) && mid.snap.category === 'လုံချည်' && mid.snap.catAdd === false && sv3 &&
      O.ports.store.getItem(s2[3]).category === 'လုံချည်' && !O.store.outbox.slice(out83).some(e => e.kind === 'list'),
      'a chip tapped while a new name is typed: the plus chip turns off and its field closes, the chip is on, Save stores လုံချည် and writes no Lists row (step-3 checker)',
      { mid: mid && [mid.catAdd, mid.field, mid.on], cat: O.ports.store.getItem(s2[3]).category });
    // The item view's sub of a piece with no category is its id alone (no trailing ' · ', as before round 6b).
    const blankIt = O.ports.store.getItem(s2[4]), blankSub = appItemView(O.phone, s2[4]).sub;
    check(blankIt && !blankIt.category && blankSub === s2[4], 'the item view\'s sub of a piece with no category is its id alone, no trailing · (step-3 checker)', [blankIt && blankIt.category, blankSub]);
    check(noErrorsH(O), 'no exception on the owner\'s phone (step-3 checker)', O.store.errors.slice(-3).map(e => e.where + ': ' + e.message));
  }
  // Round-6b fix (the review's finding 5, the app half; finding 9's fallback; the plus chip's scroll): the chosen chip keeps
  // its row's key, so an owner's relabel on the laptop while the form or its draft is open keeps the choice, and Save hands
  // that key to commitNewItem. A hand-typed label with nothing left once plain shows its key. Its own world.
  {
    const K83 = worldH('form'), SILK2 = 'ပိုးထည် အသစ်', SILK3 = 'ပိုးထည် သုံး', ZW = String.fromCharCode(0x200b);
    K83.W.lists.push({ list: 'item_category', key: 'silk1', label: SILK, active: true, order: 9, shop: '', detail: '', note: '' });
    K83.W.lists.push({ list: 'item_category', key: 'emo2', label: '🥻', active: true, order: 10, shop: '', detail: '', note: '' });
    K83.W.lists.push({ list: 'item_category', key: 'zw1', label: ZW, active: true, order: 11, shop: '', detail: '', note: '' });
    const Q = await K83.phone('P83k sister', sister);
    await Q.sync.syncNow('t');
    const kt = K83.blanks();
    let k1 = null, k2 = null, k3 = null, k4 = null, k5 = null;
    await app6(Q, {}, async h => {
      // A: pick the custom chip, the owner relabels its row and the phone pulls it, then Save.
      const F = appOpenForm('newitem', { itemId: kt[0] });
      const txt = f => (fOf(F.el, f)[0] || {}).textContent;
      k1 = { emo: txt('cat:emo2'), zw: txt('cat:zw1'), silk: txt('cat:silk1') };
      appFormDo(F, 'price:25000');
      fOf(F.el, 'cat:silk1')[0].click();
      k2 = { key: F.values.catKey, cat: F.values.category };
      icRow(K83.W, 'silk1').label = SILK2;
      await Q.sync.syncNow('t');
      appFormDo(F, 'price:30000');
      k2.after = { on: catChips(F).filter(isOn).map(e => e.getAttribute('data-f')), text: txt('cat:silk1'), cat: F.values.category, viewKey: appNewItemView(Q.phone, F.values).catKey };
      k2.ok = await appFormSave(F);
      // B: the chosen chip after a relabel still clears on a second tap; its key is in the draft.
      const G = appOpenForm('newitem', { itemId: kt[1] });
      fOf(G.el, 'cat:silk1')[0].click();
      const draftKey = (appFormDraftRead(Q.store, 'newitem', kt[1]) || {}).catKey;
      icRow(K83.W, 'silk1').label = SILK3;
      await Q.sync.syncNow('t');
      appFormDo(G, 'price:25000');
      const onB = catChips(G).filter(isOn).map(e => e.getAttribute('data-f'));
      fOf(G.el, 'cat:silk1')[0].click();
      k3 = { draftKey, onB, cleared: [G.values.category, G.values.catKey, catChips(G).filter(isOn).length] };
      fOf(G.el, 'cat:silk1')[0].click();
      k3.again = [G.values.category, G.values.catKey];
      // The plus chip turned on and off again: one focus, one scroll.
      const seq = [];
      G.el.querySelector = sel => {
        const m = /^\[data-f="([^"]+)"\]$/.exec(sel), el = m ? fOf(G.el, m[1])[0] : null;
        if (el) { el.focus = o => seq.push('focus:' + m[1]); el.scrollIntoView = o => seq.push('scroll:' + m[1]); }
        return el || null;
      };
      fOf(G.el, 'cat:add')[0].click();
      fOf(G.el, 'cat:add')[0].click();
      k3.seq = seq;
      appCloseForm({});
    });
    // A restored draft holding the row's OLD name and its key: the chip is on under the current label, Save stores that.
    appFormDraftWrite(Q.store, 'newitem', kt[2], { tag: kt[2], photo: '', name: 'ပိုး ဟောင်း', category: SILK, catKey: 'silk1', catAdd: false, catName: '', cost: null, price: 30000, pending: false, count: 1, sample: false, restored: false });
    await app6(Q, {}, async h => {
      const D = appOpenForm('newitem', { itemId: kt[2] });
      k4 = { restored: D.values.restored, cat: D.values.category, key: D.values.catKey, on: catChips(D).filter(isOn).map(e => e.getAttribute('data-f')), text: (fOf(D.el, 'cat:silk1')[0] || {}).textContent };
      k4.ok = await appFormSave(D);
    });
    // The invisible-label row picked and saved: its key reaches commitNewItem (the name alone matches no row).
    let vz = appNewItemSet(Q.phone, appNewItemSet(Q.phone, appNewItemFresh(kt[3]), 'cat:zw1'), 'price:25000');
    k5 = { key: vz.catKey, view: appNewItemView(Q.phone, vz).catKey, r: appNewItemSave(Q.phone, { kind: 'newitem', values: vz, saving: false }) };
    const it = id => (Q.ports.store.getItem(id) || {});
    check(k1.emo === 'emo2' && k1.zw === 'zw1' && k1.silk === SILK,
      'a row whose label is only an emoji (🥻) or only an invisible character shows its key (emo2, zw1) as the chip\'s text, not a blank chip; a normal label shows itself (round-6b fix, finding 9)', k1);
    check(k2.key === 'silk1' && k2.cat === SILK && same(k2.after.on, ['cat:silk1']) && k2.after.text === SILK2 && k2.after.cat === SILK && k2.after.viewKey === 'silk1' && k2.ok &&
      it(kt[0]).category === SILK2,
      'a custom chip picked (catKey silk1), then its row relabelled ' + SILK2 + ' on the laptop and pulled: the chip stays on under the new label, and Save stores ' + SILK2 + ', not the catch-all (round-6b fix, finding 5)',
      { k2, saved: it(kt[0]).category });
    check(k3.draftKey === 'silk1' && same(k3.onB, ['cat:silk1']) && same(k3.cleared, ['', '', 0]) && same(k3.again, [SILK3, 'silk1']) && same(k3.seq, ['focus:catname', 'scroll:catname']),
      'the draft keeps the chip\'s key; after a relabel the chosen chip is still on and a second tap clears it, a third picks it under the new label; the plus chip on then off focuses and scrolls once (round-6b fix)', k3);
    check(k4.restored && k4.cat === SILK && k4.key === 'silk1' && same(k4.on, ['cat:silk1']) && k4.text === SILK3 && k4.ok && it(kt[2]).category === SILK3,
      'a restored draft holding the row\'s old name ' + SILK + ' and catKey silk1, after two relabels: the cat:silk1 chip (' + SILK3 + ') is on and Save stores ' + SILK3 + ' (round-6b fix, finding 5)', { k4, saved: it(kt[2]).category });
    check(k5.key === 'zw1' && k5.view === 'zw1' && k5.r.ok && it(kt[3]).category === ZW,
      'the invisible-label row picked: catKey zw1, its chip on, and Save stores that row\'s label (commitNewItem gets categoryKey zw1; the name alone matches no row and would give the catch-all) (round-6b fix)',
      { key: k5.key, view: k5.view, ok: k5.r.ok, saved: JSON.stringify(it(kt[3]).category) });
    check(noErrorsH(Q), 'no exception on the relabel phone (round-6b fix)', Q.store.errors.slice(-3).map(e => e.where + ': ' + e.message));
  }

  step('84. Round-6b app texts: the two APP_MSG keys of 4.3 equal their block; the ten new and two changed MSG texts read without emoji in the app');
  const spec6b = fs.readFileSync(path.join(ROOT, 'docs/design-round-6/SPEC-round-6b.md'), 'utf8');
  const block6b = after => { const i = spec6b.indexOf(after), a = spec6b.indexOf('```', i) + 3, b = spec6b.indexOf('```', a); return i < 0 ? [] : spec6b.slice(a, b).split('\n').map(l => /^(\w+): '(.*)'$/.exec(l.trim())).filter(Boolean); };
  const b43 = block6b('### 4.3 app/app_i18n.js'), bad43 = b43.filter(m => !APP_MSG[m[1]] || APP_MSG[m[1]] !== m[2]);
  check(b43.length === 2 && same(b43.map(m => m[1]), ['ui_lbl_sample', 'ui_sample_hint']) && !bad43.length, 'every key of 4.3 (two) is in APP_MSG, non-empty and equal to the block', bad43.map(m => [m[1], APP_MSG[m[1]]]));
  const b41 = block6b('### 4.1 core_messages.js'), b42 = block6b('### 4.2 Changed texts'), VS16 = String.fromCharCode(0xFE0F);
  const emo84 = b41.concat(b42).filter(m => !MSG[m[1]] || hasEmoji(appPlain(MSG[m[1]])) || appPlain(MSG[m[1]]).indexOf(VS16) >= 0 || !appPlain(MSG[m[1]]).trim());
  check(b41.length === 10 && b42.length === 2 && !emo84.length, 'appPlain of each of the ten new MSG texts (4.1) and the two changed ones (4.2) holds no emoji and no U+FE0F', emo84.map(m => [m[1], appPlain(MSG[m[1]] || '')]));

  step('85. Telegram\'s 📦 loop in the app under quick (round 6b, G3, review M4): Menu → 📦 asks for the tag; Scan keeps the loop; a tag opens its count card; a preset saves and offers the next tag; ✏ is a number prompt; Menu ends it; 🛒 opens the item card');
  {
    const Q8 = worldH(null), Q = await Q8.phone('Q85 sister', sister), uid = Q.phone.staffId();
    await Q.sync.syncNow('t');
    await app6(Q, { scanner: { running: false, start: () => Promise.resolve('none'), stop() {} } }, async h => {
      appOpenMenu(); await tick(5); await h.flush();
      const menu = lastBotOf(Q);
      await Q.phone.sim.tap(menu.id, 'M|restock'); await h.flush();
      const ask = lastBotOf(Q), st0 = getState(Q.ports, uid), askTxt = shown(appRenderMsg(ask, { big: true }));
      check(saleFlow(Q.ports) === 'quick' && !formsInApp(Q.ports) && flat(menu).indexOf('M|restock') >= 0 && ask.text === t(Q.ports, 'restock_ask_tag') && askTxt.indexOf(plain(Q, 'restock_ask_tag')) >= 0 &&
        !hasEmoji(appPlain(ask.text)) && same(kbOf(ask), [['Z']]) && st0 && st0.kind === 'restock_loop' && st0.step === 'tag',
        'quick: Menu, then M|restock → the last card reads restock_ask_tag (plain in the app), its datas [[Z]], the state restock_loop at tag', { text: ask.text, kb: kbOf(ask), st0 });
      appOnScanButton(); await h.flush();
      const st1 = getState(Q.ports, uid);
      check(appInputModeFor(st0) === null && st1 && st1.kind === 'restock_loop' && st1.step === 'tag', 'Scan keeps the loop (restock_loop has no input mode, so appDropWaiting(true) leaves it)', st1);
      appOpenTagId('S1-0002'); await tick(5); await h.flush();
      const cnt = lastBotOf(Q), it2 = Q.ports.store.getItem('S1-0002'), head = t(Q.ports, 'group_item_line', { id: 'S1-0002', name: it2.name, stock: fmtCount(it2.stock) });
      const cntTxt = shown(appRenderMsg(cnt, { big: true }));
      check(cnt.text === head + '\n' + t(Q.ports, 'ask_restock_qty') && cntTxt.indexOf(appPlain(head)) >= 0 && cntTxt.indexOf(plain(Q, 'ask_restock_qty')) >= 0 &&
        same(kbOf(cnt), [CFG.RESTOCK_PRESETS.map(n => 'RQ|S1-0002|' + n), ['RQ|S1-0002|other', 'RT|skip'], ['K|S1-0002']]) && getState(Q.ports, uid).step === 'qty',
        'appOpenTagId(S1-0002) → the count card: group_item_line + ask_restock_qty (plain), the four RQ presets, RQ|S1-0002|other, RT|skip and K|S1-0002', { text: cnt.text, kb: kbOf(cnt) });
      const out0 = Q.store.outbox.length, stock0 = Number(it2.stock) || 0;
      await Q.phone.sim.tap(cnt.id, 'RQ|S1-0002|5'); await h.flush();
      const edited = Q.store.chat.filter(m => m.id === cnt.id)[0] || {}, more = lastBotOf(Q);
      const rs = Q.store.outbox.slice(out0).filter(e => e.kind === 'group').reduce((a, e) => a.concat(e.txs || []), []).filter(x => x.type === CFG.TX.RESTOCK);
      const done85 = t(Q.ports, 'restock_done', { qty: fmtCount(5), stock: fmtCount(stock0 + 5) }), st85 = getState(Q.ports, uid) || {};
      check(edited.text === 'S1-0002 · ' + done85 && appPlain(edited.text) === 'S1-0002 · ' + appPlain(done85) && same(kbOf(edited), [['U|' + rs.map(x => x.groupId)[0]]]) &&
        more.id !== cnt.id && more.text === t(Q.ports, 'restock_more') && shown(appRenderMsg(more, { big: true })).indexOf(plain(Q, 'restock_more')) >= 0 && same(kbOf(more), [['RT|done']]) &&
        rs.length === 1 && rs[0].itemId === 'S1-0002' && Number(rs[0].qty) === 5 && st85.kind === 'restock_loop' && st85.step === 'tag' && st85.n === 1,
        'RQ|S1-0002|5 → the count card reads \'S1-0002 · \' + restock_done (plain in the app) with its ↩, then the restock_more card with [[RT|done]]; ONE RESTOCK +5 in the outbox; the loop at tag, n 1',
        { edited: [edited.text, kbOf(edited)], more: [more.text, kbOf(more)], rs: rs.map(x => [x.itemId, x.qty, x.groupId]), st85 });
      appOpenTagId('S1-0002'); await tick(5); await h.flush();
      await Q.phone.sim.tap(lastBotOf(Q).id, 'RQ|S1-0002|other'); await h.flush();
      const st2 = getState(Q.ports, uid);
      check(st2 && st2.kind === 'await_number' && st2.purpose === 'restock_qty' && st2.loop === 1 && appInputModeFor(st2) === 'number', '✏ (RQ|S1-0002|other) in the loop → a number prompt (appInputModeFor: number)', st2);
      appOpenMenu(); await tick(5); await h.flush();
      check(getState(Q.ports, uid) === null, 'Menu ends the loop (appDropWaiting(false))', getState(Q.ports, uid));
      await Q.phone.sim.tap(lastBotOf(Q).id, 'M|restock'); await h.flush();
      appOpenTagId('S1-0002'); await tick(5); await h.flush();
      const cnt2 = lastBotOf(Q);
      await Q.phone.sim.tap(cnt2.id, 'K|S1-0002'); await h.flush();
      const card = lastBotOf(Q);
      check(same(kbOf(cnt2).slice(-1), [['K|S1-0002']]) && getState(Q.ports, uid) === null && card.view && card.view.kind === 'item' && card.view.id === 'S1-0002' && flat(card).indexOf('S|S1-0002|1') >= 0,
        'armed again, the tag, then 🛒 (K|S1-0002) → the item card with its sell buttons; the state is gone', { view: card.view, kb: kbOf(card) });
      appOpenMenu(); await tick(5); await h.flush();
      await Q.phone.sim.tap(lastBotOf(Q).id, 'M|restock'); await h.flush();
      const armed = getState(Q.ports, uid);
      appOpenMenu(); await tick(5); await h.flush();
      check(armed && armed.kind === 'restock_loop' && armed.step === 'tag' && getState(Q.ports, uid) === null && lastBotOf(Q).text === t(Q.ports, 'menu'),
        'armed at the ask (no field), Menu ends the loop too and shows the menu', armed);
      appNavReset();
    });
    check(noErrorsH(Q), 'no exception on the quick phone', Q.store.errors.slice(-3).map(e => e.where + ': ' + e.message));
  }

  step('86. The UX review for first-time phone users (docs/design-round-6/REVIEW-ux-zero-tech.md): the app\'s own question sheet (never confirm()) for a changed form, undo, void, the drawing and the re-enrol; the camera notes; toasts that stay; the optional cost; the two-column menu');
  {
    const U8 = worldH('form'), U = await U8.phone('U86 sister', sister), uid = U.phone.staffId();
    await U.sync.syncNow('t');
    const askOf = h => h.els.overlay.hidden ? null : h.els.overlay.children[0];
    const askBtn = (h, f) => fakeWalk(h.els.overlay).filter(e => e.attrs['data-f'] === f)[0];
    check(appToastMs('abc', false) === APP_TOAST_MS && appToastMs('abc', true) === APP_TOAST_BAD_MS && appToastMs('x'.repeat(80), false) === 1500 + 55 * 80 && appToastMs('x'.repeat(200), true) === APP_TOAST_MAX_MS,
      'appToastMs: 2.6 s for a short note, 4.5 s at least for a refusal, 55 ms per character over a 1.5 s base, never past 7 s', [appToastMs('abc', false), appToastMs('abc', true), appToastMs('x'.repeat(80), false)]);
    const appSrc86 = ['app_ui.js', 'app_forms.js', 'app_screens.js', 'app_sketch.js', 'app_scan.js', 'app_media.js', 'app_sync.js', 'app_store.js', 'app_ports.js'].map(f => fs.readFileSync(path.join(ROOT, 'app', f), 'utf8')).join('\n');
    check(!/\bconfirm\s*\((?!\))/.test(appSrc86), 'no app file calls confirm(): every question goes through appAsk', (/[^\n]*\bconfirm\s*\((?!\))[^\n]*/.exec(appSrc86) || [''])[0].trim());
    check(/\bဆိုင်ရှင်\b|ဆိုင်ရှင်/.test(APP_MSG.ui_enroll_hint) && /Telegram/.test(APP_MSG.ui_enroll_hint) && /ကုဒ်/.test(APP_MSG.ui_enroll_hint), 'the enrol hint says where the code comes from and to ask the owner without one');
    const css86 = fs.readFileSync(path.join(ROOT, 'app/app.css'), 'utf8');
    check(/\n\.kb\.grid \{ display: grid; grid-template-columns: repeat\(2, 1fr\); \}/.test(css86) && /\n\.sheet \.askacts \{ flex-direction: column; \}/.test(css86) && /\n\.sheet \.askacts button\.danger \{ background: var\(--bad\); color: #fff;/.test(css86) &&
      /\n\.scan \.note \{ color: #fff; font-size: 14px;/.test(css86) && /\n\.jobs\.compact button \.lb \{ font-size: 11px;/.test(css86) && /\n\.fnum\.empty \{ color: var\(--muted\);/.test(css86),
      'app.css: the menu grid has two columns; the question sheet stacks its buttons with the risky one in red; the camera note; the compact row\'s small word; the empty number box reads as a hint');
    await app6(U, { scanner: { running: false, start: () => Promise.resolve('none'), stop() {} } }, async h => {
      // The toast's timer gets the computed time.
      let ms = null;
      const setT = APP.win.setTimeout;
      APP.win.setTimeout = (f, m) => { ms = m; return setT(f); };
      appToast('⚠️ ' + 'က'.repeat(40), true);
      const msBad40 = ms;
      appToast('⚠️ ' + 'က'.repeat(80), true);
      const msBad80 = ms;
      appToast('ok');
      APP.win.setTimeout = setT;
      check(msBad40 === APP_TOAST_BAD_MS && msBad80 === 1500 + 55 * 80 && ms === APP_TOAST_MS, 'appToast hides a 40-character refusal after 4.5 s (the floor), an 80-character one after 5.9 s and a short note after 2.6 s', [msBad40, msBad80, ms]);
      // appAsk: the sheet, its two buttons, the safe answer, the risky one; Android back is the safe one.
      let yes = 0, no = 0;
      const spec = { kind: 't', title: 'q', text: 'why', yes: 'y', no: 'n', danger: true, onYes: () => yes++, onNo: () => no++ };
      appAsk(spec);
      const sheet = askOf(h), btns = fakeWalk(sheet).filter(e => e.tagName === 'BUTTON');
      check(sheet && sheet.attrs['data-ask'] === 't' && sheet.attrs.role === 'alertdialog' && fakeWalk(sheet).filter(e => e.tagName === 'H3')[0].textContent === 'q' && fakeWalk(sheet).some(e => /\basktext\b/.test(e.className) && e.textContent === 'why') &&
        btns.length === 2 && btns[0].attrs['data-f'] === 'ask:yes' && /\bdanger\b/.test(btns[0].className) && btns[0].textContent === 'y' && btns[1].attrs['data-f'] === 'ask:no' && btns[1].textContent === 'n' && appNavTop().kind === 'sheet' && appAsking() === 't',
        'appAsk: a sheet [data-ask] with role alertdialog, the question, its line, the risky button (red) on top and the safe one under it; a sheet layer; appAsking() names it', sheet && sheet.attrs);
      btns[1].click();
      check(h.els.overlay.hidden && !yes && no === 1 && !APP.nav.length && appAsking() === '', 'the safe button: the sheet and its layer go, onNo runs, nothing else');
      appAsk(spec);
      askBtn(h, 'ask:yes').click();
      check(h.els.overlay.hidden && yes === 1 && no === 1 && !APP.nav.length, 'the risky button: onYes runs once');
      appAsk(spec);
      appNavBack();
      check(h.els.overlay.hidden && yes === 1 && no === 1 && !APP.nav.length, 'back while the sheet is open is the safe answer (the sheet layer pops, no callback)');
      // Undo on the sold card asks first; the receipt page and the entry page too; the owner's void too.
      const F = appOpenForm('sale', { itemId: 'S1-0002', qty: 1 });
      await appFormSave(F); await h.flush();
      const sold = lastBotOf(U), gid = sold.view.id, n0 = U.store.ledger.length;
      const card = appRenderMsg(sold, { big: true }), undoBtn = fakeWalk(card).filter(e => e.tagName === 'BUTTON' && /^U\|/.test(e.attrs['data-cb'] || ''))[0];
      undoBtn.click(); await h.flush();
      check(appAsking() === 'undo' && U.store.ledger.length === n0 && fakeWalk(askOf(h)).filter(e => e.tagName === 'H3')[0].textContent === APP.tt('ui_ask_undo') && askBtn(h, 'ask:yes').textContent === APP.tt('ui_ask_undo_yes') && askBtn(h, 'ask:no').textContent === APP.tt('ui_ask_keep'),
        'မှားသွားတယ် on the sold card asks first (ui_ask_undo, ပြန်ဖျက်မယ် / မဖျက်ပါ); nothing is written yet', appAsking());
      askBtn(h, 'ask:no').click(); await h.flush();
      check(U.store.ledger.length === n0 && h.els.overlay.hidden && lastBotOf(U).id === sold.id, 'မဖျက်ပါ: nothing written, the sold card stays');
      fakeWalk(appRenderMsg(sold, { big: true })).filter(e => e.tagName === 'BUTTON' && /^U\|/.test(e.attrs['data-cb'] || ''))[0].click(); await h.flush();
      askBtn(h, 'ask:yes').click(); await h.flush(); await tick(5); await h.flush();
      check(U.store.ledger.filter(r => r.groupId === gid && r.reversesTxId).length === 1 && lastBotOf(U).text.indexOf(MSG.undo_done) === 0, 'ပြန်ဖျက်မယ်: the undo runs (one reversing row, undo_done)', lastBotOf(U).text);
      appNavReset();
      const G = appOpenForm('sale', { itemId: 'S1-0003', qty: 1 });
      await appFormSave(G); await h.flush();
      const gid2 = lastBotOf(U).view.id;
      appOpenScreen('receipt', gid2);
      fOf(h.els.main, 'undo')[0].click();
      const askedR = appAsking();
      askBtn(h, 'ask:no').click();
      appOpenScreen('history');
      appNavReset();
      check(askedR === 'undo' && !U.store.ledger.some(r => r.groupId === gid2 && r.reversesTxId), 'the receipt page\'s undo asks first too; မဖျက်ပါ writes nothing', askedR);
      // The re-enrol always asks, names what would be lost, and the safe answer keeps the phone enrolled.
      appOpenScreen('settings');
      const re = fakeWalk(h.els.main).filter(e => e.tagName === 'BUTTON' && e.textContent === APP.tt('ui_btn_reenroll'))[0];
      re.click();
      const reText = fakeWalk(askOf(h)).filter(e => /\basktext\b/.test(e.className))[0];
      const pending = U.store.outbox.length;
      check(appAsking() === 'reenroll' && reText && reText.textContent.indexOf(APP.tt('ui_ask_reenroll_text')) >= 0 && (pending ? reText.textContent.indexOf(APP.tt('ui_confirm_wipe', { n: fmtCount(pending) })) >= 0 : reText.textContent.indexOf('ပျက်သွား') < 0) &&
        askBtn(h, 'ask:yes').textContent === APP.tt('ui_ask_reenroll_yes'),
        'ဖုန်း ပြန်ချိတ်ဆက် asks every time (ui_ask_reenroll), names the unsent entries when there are any and says to ask the owner', { pending, text: reText && reText.textContent });
      askBtn(h, 'ask:no').click();
      check(!!U.store.meta.deviceId && APP.screen === 'settings', 'Cancel keeps the phone enrolled');
      appNavReset();
      // The camera note: before the first permission, after a refusal, and nothing once the camera has run.
      APP.scanState = 'idle'; APP.scanError = null;
      const note1 = fakeWalk(appScannerPanel()).filter(e => /\bnote\b/.test(e.className))[0];
      APP.scanError = 'denied';
      const note2 = fakeWalk(appScannerPanel()).filter(e => /\bnote\b/.test(e.className))[0];
      APP.scanError = null;
      U.store.setPref('cameraOk', true);
      const note3 = fakeWalk(appScannerPanel()).filter(e => /\bnote\b/.test(e.className))[0];
      U.store.setPref('cameraOk', false);
      check(note1 && note1.textContent === APP.tt('ui_camera_first') && note2 && note2.textContent === APP.tt('ui_camera_denied_hint') && !note3,
        'under the Scan button: ui_camera_first before the first permission, ui_camera_denied_hint after a refusal, nothing once the camera has run', [note1 && note1.textContent, note2 && note2.textContent, !!note3]);
      const S = appOpenForm('sale', {});
      const noteS = fakeWalk(S.stripEl).filter(e => /\bnote\b/.test(e.className))[0];
      check(noteS && noteS.textContent === APP.tt('ui_camera_first'), 'a form\'s camera strip carries the same note', noteS && noteS.textContent);
      appCloseForm({});
      // The optional cost: its empty box says so; a value replaces the hint.
      const blank = U8.blanks()[0], N = appOpenForm('newitem', { itemId: blank });
      const costBtn = () => fOf(N.el, 'cost')[0];
      const hint = costBtn().textContent, cls = costBtn().className;
      appFormDo(N, 'cost', 9000);
      check(hint === APP.tt('ui_cost_optional') && /\bempty\b/.test(cls) && costBtn().textContent === fmtMoney(9000) && !/\bempty\b/.test(costBtn().className), 'the new-piece form\'s cost box reads ui_cost_optional while empty (class empty) and the amount once typed', [hint, costBtn().textContent]);
      appCloseForm({});
      // A changed measurement form asks the same way; the drawing's clear too.
      appOpenMeasForm({ customerId: 'C-0001', orderId: '', staff: U.store.meta.staff });
      const M = APP.measForm;
      M.values.neck = '14';
      appMeasChanged(M);
      appNavBack();
      const askedM = appAsking();
      askBtn(h, 'ask:no').click();
      const stayed = APP.measForm === M;
      M.sketch.strokes = [[[10, 10], [20, 20]]];
      appSketchAct(M, 'sk:clear');
      const askedS = appAsking(), kept = M.sketch.strokes.length;
      askBtn(h, 'ask:yes').click();
      const cleared = M.sketch.strokes.length;
      appNavBack();
      askBtn(h, 'ask:yes').click();
      check(askedM === 'leave' && stayed && askedS === 'sketch' && kept === 1 && cleared === 0 && APP.measForm === null && !appMeasDraftRead(U.store, 'C-0001'),
        'the measurement form: ← asks (leave) and ဆက်ဖြည့်မယ် keeps it; the drawing\'s clear asks (sketch) and အကုန် ဖျက်မယ် empties it; ← then မသိမ်းဘဲ ထွက်မယ် closes it and drops the draft', [askedM, stayed, askedS, kept, cleared]);
      appNavReset();
    });
    check(noErrorsH(U), 'no exception on the phone', U.store.errors.slice(-3).map(e => e.where + ': ' + e.message));
  }
}
