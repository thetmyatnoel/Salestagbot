/**
 * poc/run_sync.js — two shops, several phones and a fake server over the same in-memory sheet.
 * Drives the sync scenarios S1-S12 and S15-S22 of docs/design-round-3/sync-and-server.md (the
 * window/fold ones S13-S14 are replaced by whole-year bootstrap equality, per SPEC-offline-first.md),
 * plus accept-and-flag, Transport B, clock skew, revoke wipe and checksum repair. No network, no keys.
 *
 *   node poc/run_sync.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CORE_FILES = [
  'apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js',
  'apps-script/core_ai_prompt.js', 'apps-script/core_ledger.js', 'apps-script/core_report.js', 'apps-script/core_bot.js',
  'apps-script/core_sync.js'
];
const SIM_FILES = ['poc/sim_mock_ai.js', 'poc/sim_ports.js', 'poc/sim_seed.js', 'poc/sim_phone.js', 'poc/sim_sync.js'];
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
CORE_FILES.concat(SIM_FILES).forEach(f => vm.runInThisContext(src(f), { filename: f }));

let pass = 0, fail = 0;
function check(cond, label, detail) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✘ ' + label + (detail === undefined ? '' : ' | got: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); }
}
const step = title => console.log('\n── ' + title);

/* ------------------------------ world, server, phones ------------------------------ */

const world = seedSimWorld(createSimWorld());
const server = createFakeServer(world);
const U = SIM_USERS;
const sister = U.sister, brother = U.brother, owner = U.owner;
const wnow = () => world.ports.clock.now();
const sItem = id => world.ports.store.getItem(id);
const sStock = id => server.stock(id);
const rowsOf = txId => world.ledger.filter(r => r.txId === txId);
const lastLocal = phone => { for (let i = phone.ledger.length - 1; i >= 0; i--) if (!phone.ledger[i].synced) return phone.ledger[i]; return null; };
const lastRow = phone => phone.ledger[phone.ledger.length - 1];
const creds = phone => ({ device: phone.meta.deviceId, token: phone.meta.token, appVersion: 1, clientTime: phone.wallClock().toISOString() });
const ownerChat = () => world.chats[owner.id] || [];
let voidPath = null;

/** The owner voids a group through the Telegram route; falls back to voidGroup() until core_bot handles V|. */
function ownerVoid(groupId) {
  const ping = world.sim.lastBotWith(owner, 'ပယ်ဖျက်');
  const data = ping && world.sim.button(ping, 'ပယ်ဖျက်');
  const live = () => groupRows(world.ports, groupId).live.length;
  if (data === 'V|' + groupId) {
    world.sim.tap(owner, ping.id, data);
    if (live() === 0) { voidPath = voidPath || 'telegram'; return 'telegram'; }
  }
  // TODO(agent A): core_bot.js does not handle the owner-only V|groupId callback yet; simulate it with voidGroup(force).
  voidGroup(world.ports, groupId, { id: String(owner.id), name: owner.name, shop: 'S1', role: 'owner' });
  voidPath = voidPath || 'fallback';
  return 'fallback';
}
function enrolledPhone(user, name, extra) {
  const phone = createPhone(Object.assign({ name, world, server }, extra || {}));
  const minted = server.mintEnrollCode(user, name);
  phone.enrollResult = phone.enroll(minted.code);
  return phone;
}

step('0. Primitives: SHA-256, push planning, checksums');
check(simSha256Hex('abc') === crypto.createHash('sha256').update('abc').digest('hex'), 'sim SHA-256 matches Node on "abc"');
check(simSha256Hex('') === crypto.createHash('sha256').update('').digest('hex'), 'sim SHA-256 matches Node on the empty string');
check(simSha256Hex('ဒေါ်မြင့် ငါးသိန်း') === crypto.createHash('sha256').update('ဒေါ်မြင့် ငါးသိန်း', 'utf8').digest('hex'), 'sim SHA-256 matches Node on Burmese text');
{
  const g = (id, n) => ({ kind: 'group', entryId: id, groupId: id, txs: Array.from({ length: n }, (_, i) => ({ txId: id + i })) });
  const plan = syncPlanPush([g('g1', 2), { kind: 'notice', entryId: 'n1' }, { kind: 'customer', entryId: 'c1' }, g('g2', 1), { kind: 'item', entryId: 'i1' }], 2);
  check(plan.entries.map(e => e.kind).join(',') === 'customer,item,group' && plan.rows === 2, 'syncPlanPush: customers, items, then groups in commit order, never past the row cap');
  const big = syncPlanPush([g('g9', 300)], 200);
  check(big.entries.length === 1 && big.rows === 300, 'a single oversize group still goes (never split)');
  const cs = syncChecksums([{ day: '2026-11-02', shop: 'S1', amount: 10, cash: 5 }, { day: '2026-11-02', shop: 'S1', amount: 20, cash: 0 }, { day: '2026-11-01', shop: 'S2', amount: 7, cash: 7 }], ['2026-11-02']);
  check(cs['2026-11-02'].S1.n === 2 && cs['2026-11-02'].S1.amount === 30 && cs['2026-11-02'].S1.cash === 5 && cs['2026-11-02'].S2.n === 0, 'per-day per-shop checksums count rows, amount and cash');
  check(syncChecksumsDiff({ '2026-11-02': { S1: { n: 1, amount: 30, cash: 5 }, S2: { n: 0, amount: 0, cash: 0 } } }, cs).join() === '2026-11-02', 'a differing day is reported');
}

step('0b. Enrollment by typed code: 8 characters, 15 minutes, 5 attempts, token hashed');
{
  const minted = server.mintEnrollCode(sister, 'A phone');
  check(minted.code.length === 8 && /^[A-Z2-9]{8}$/.test(minted.code) && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(minted.display), 'code is 8 characters from the unambiguous alphabet, shown as XXXX-XXXX');
  const pending = server.devices.find(d => d.id === minted.deviceId);
  check(pending && pending.status === 'PENDING' && pending.enrollCodeHash === simSha256Hex(minted.code) && pending.tokenHash === '', 'PENDING Devices row holds only the code hash');
  const trial = createPhone({ name: 'trial', world, server });
  const bad = trial.enroll('AAAA-AAAA');
  check(!bad.ok && bad.error === 'enroll_bad' && bad.attemptsLeft === 4, 'a wrong code is refused and counts an attempt (4 left)');
  const okRes = trial.enroll(minted.display.toLowerCase());
  check(okRes.ok && okRes.device.token.length === 64 && okRes.device.staff.id === '1001' && okRes.device.receiptLetter === 'A', 'the right code (typed in lower case with the dash) enrolls: 32-byte token, staff bound, receipt letter A');
  const row = server.devices.find(d => d.id === minted.deviceId);
  check(row.status === 'ACTIVE' && row.tokenHash === simSha256Hex(okRes.device.token) && row.enrollCodeHash === '' && !('token' in row), 'server keeps the SHA-256 of the token, never the token; the code hash is cleared');
  const again = createPhone({ name: 'again', world, server }).enroll(minted.code);
  check(!again.ok, 'the same code cannot be used twice');
  const burn = server.mintEnrollCode(sister, 'burn');
  for (let i = 0; i < 5; i++) createPhone({ name: 'x', world, server }).enroll('ZZZZZZZ' + (i + 2));
  check(!createPhone({ name: 'x', world, server }).enroll(burn.code).ok, 'after 5 wrong attempts the code is dead');
  const late = server.mintEnrollCode(sister, 'late');
  world.nowOverride = new Date(Date.now() + 16 * 60000);
  const lateRes = createPhone({ name: 'late', world, server }).enroll(late.code);
  world.nowOverride = null;
  check(!lateRes.ok && lateRes.error === 'enroll_expired', 'a code older than 15 minutes is expired');
  check(trial.ledger.length === world.ledger.length && trial.ledger.every(r => r.synced && r.seq > 0), 'enrollment bootstraps the whole ledger with Seq on every row');
  server.ports.devices.update(minted.deviceId, { status: 'REVOKED', note: 'test device' });   // keep later letters readable
}

const A = enrolledPhone(sister, 'A phone');
const B = enrolledPhone(sister, 'B phone');
const O = enrolledPhone(owner, 'Owner phone');
const B2 = enrolledPhone(brother, 'S2 phone');
check([A, B, O, B2].every(p => p.enrollResult.ok) && A.meta.receiptLetter === 'B' && B.meta.receiptLetter === 'C' && O.meta.receiptLetter === 'D' && B2.meta.receiptLetter === 'E',
  'four phones enrolled (two in shop 1, the owner, shop 2); letters are never reused');
{
  // Defect 12: refused calls are logged 20 per hour per kind, then one summary row, then only counted.
  const denied0 = world.errors.filter(e => e.where === 'device_denied').length;
  for (let i = 0; i < 40; i++) server.handle('sync', { device: 'nope' + i, token: 'bad', pull: { ledgerSeq: 0 } });
  const denied = world.errors.filter(e => e.where === 'device_denied');
  check(denied.length - denied0 <= SYNC.DENIED_LOG_PER_HOUR + 1 && denied.length > denied0 && denied[denied.length - 1].message.indexOf('more than ' + SYNC.DENIED_LOG_PER_HOUR) === 0,
    '40 bad-token calls: at most ' + (SYNC.DENIED_LOG_PER_HOUR + 1) + ' Errors rows this hour, the last one a summary');
}

step('0d. Telegram side: 📲 mints a typed code that enrolls a phone; /devices is owner-only with DV| buttons');
{
  world.sim.start(sister, '');
  const menu = world.sim.lastBot(sister);
  check(world.sim.button(menu, MSG.btn_app) === 'M|app' && world.sim.button(menu, MSG.btn_devices) === null, 'the staff menu has the 📲 button (below the sale paths) and no phone list');
  world.sim.tapLast(sister, MSG.btn_app);
  const codeMsg = world.sim.lastBot(sister).text;
  const m = /🔑 ([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(codeMsg);
  check(!!m && !/#enroll=/.test(codeMsg) && !/https?:\/\//.test(codeMsg), 'the reply carries the typed code XXXX-XXXX and no link with the code in it');
  const TG = createPhone({ name: 'TG phone', world, server });
  const tgRes = TG.enroll(m ? m[1] : '');
  check(tgRes.ok && tgRes.device.staff.id === '1001' && tgRes.device.receiptLetter === 'F', 'that code enrolls a phone bound to the sister (letter F)');
  world.sim.text(sister, '/devices');
  check(world.sim.lastBot(sister).text === MSG.devices_owner_only, '/devices from staff: owner-only refusal');
  world.sim.start(owner, '');
  const ownerMenu = world.sim.lastBot(owner);
  check(world.sim.button(ownerMenu, MSG.btn_devices) === 'M|devices', 'the owner menu adds the 📱 phone list button');
  world.sim.text(owner, '/devices');
  const list = world.sim.lastBot(owner);
  const drainData = 'DV|' + TG.meta.deviceId + '|drain';
  const allDv = (list.keyboard || []).reduce((a, row) => a.concat(row), []);
  check(list.text.includes(MSG.devices_title) && allDv.some(b => b.callback_data === drainData) && allDv.every(b => /^DV\|[0-9a-f]{16}\|(drain|revoke|activate)$/.test(b.callback_data) && Buffer.byteLength(b.callback_data, 'utf8') <= 28),
    '/devices for the owner lists the phones with DV|<id>|drain and DV|<id>|revoke buttons, 28 bytes at most');
  world.sim.tap(owner, list.id, drainData);
  const afterDrain = world.sim.lastBot(owner);
  check(afterDrain.id === list.id && server.devices.find(d => d.id === TG.meta.deviceId).status === 'DRAIN' && world.sim.button(afterDrain, MSG.btn_device_activate + ' F') === 'DV|' + TG.meta.deviceId + '|activate',
    'tapping ⏸ drains that phone and redraws the list in place with a 🟢 activate button for it');
  world.sim.tap(owner, afterDrain.id, 'DV|' + TG.meta.deviceId + '|activate');
  check(server.devices.find(d => d.id === TG.meta.deviceId).status === 'ACTIVE', '🟢 re-activates it');
  world.sim.tap(owner, afterDrain.id, 'DV|' + TG.meta.deviceId + '|revoke');
  const afterRevoke = world.sim.lastBot(owner);
  check(server.devices.find(d => d.id === TG.meta.deviceId).status === 'REVOKED' && !(afterRevoke.keyboard || []).some(row => row.some(b => b.callback_data.indexOf(TG.meta.deviceId) >= 0)),
    '❌ revokes it: no more buttons for that phone');
  const n0 = world.ledger.length;
  world.sim.start(brother, 'S2-0003'); world.sim.tapLast(brother, 'ကုန်ရောက်'); world.sim.tapLast(brother, '+၁');
  const tgRow = world.ledger[world.ledger.length - 1];
  check(world.ledger.length === n0 + 1 && tgRow.seq === server.props.LEDGER_SEQ && tgRow.deviceId === 'TG' && !!tgRow.receivedAt,
    'a Telegram-route row is stamped Seq/ReceivedAt/DeviceID=TG as it is appended (no later cell edit)');
  const pulled0d = [A, B, O, B2].map(p => p.syncNow().pulled);
  check(pulled0d.every(n => n === 1) && A.ledger[A.ledger.length - 1].txId === tgRow.txId, 'the four phones pull exactly that row on their next sync (phones equal the server again)');
}

step('0c. Whole-year bootstrap equals the server (replaces S13/S14: no window, no fold)');
function equalToServer(phone, label) {
  const items = world.items.map(i => i.id);
  const stockOk = items.every(id => phone.stockOf(id) === sStock(id) && phone.ports.store.getItem(id).status === sItem(id).status);
  const key = c => c.groupId + ':' + c.owed;
  const creditsOk = JSON.stringify(openCredits(phone.ports, null).map(key)) === JSON.stringify(openCredits(world.ports, null).map(key));
  const dep = l => l.map(d => d.customerId + ':' + d.held).join(',');
  const depositsOk = dep(depositsHeldList(phone.ports)) === dep(depositsHeldList(world.ports));
  check(stockOk, label + ': stock and status of every item equal the server');
  check(creditsOk && depositsOk, label + ': openCredits and deposits held equal the server');
  check(phone.ledger.length === world.ledger.length && phone.customers.length === world.customers.length, label + ': row and customer counts equal the server');
}
equalToServer(A, 'A after bootstrap');
check(A.ports.store.getStaff('1001').role === 'staff' && A.ports.store.listStaff().some(s => s.id === '1000' && s.role === 'owner'), 'phone knows itself and the owner (for notifyOwners)');
check(A.meta.cursor.ledgerSeq === Math.max(...world.ledger.map(r => r.seq)), 'cursor sits at the last Seq');
check(A.items.some(i => i.id === 'S2-0002') && A.items.find(i => i.id === 'S1-0002').cost === 9000, 'both shops\' items are mirrored, Cost included');

step('S1. Offline sale then sync (idempotent by TxID)');
A.online = false;
A.sim.start(sister, 'S1-0002');
A.sim.tapLast(sister, 'အရေအတွက်');
A.sim.tapLast(sister, '၂');
let s1row = lastLocal(A);
check(A.stockOf('S1-0002') === 3 && sStock('S1-0002') === 5 && A.outbox.length === 1 && A.outbox[0].kind === 'group', 'offline: local stock 3, server still 5, outbox holds one group');
check(A.lastText().includes('ရောင်းပြီး ၂ ထည်'), 'the ✅ card answered without any network');
const s1entry = JSON.parse(JSON.stringify(A.outbox[0]));
check(!A.syncNow().ok, 'syncNow while offline fails softly and keeps the outbox');
A.online = true;
let r1 = A.syncNow();
check(r1.ok && r1.acked === 1 && A.outbox.length === 0, 'online: one group acked, outbox empty');
check(rowsOf(s1row.txId).length === 1 && rowsOf(s1row.txId)[0].seq > 0 && rowsOf(s1row.txId)[0].deviceId === A.meta.deviceId && rowsOf(s1row.txId)[0].receivedAt, 'server has the row with the phone\'s TxID, a Seq, ReceivedAt and DeviceID = A');
check(A.ledger.find(r => r.txId === s1row.txId).synced && A.ledger.find(r => r.txId === s1row.txId).seq === rowsOf(s1row.txId)[0].seq, 'the local row is marked synced with the server\'s Seq');
const before1 = world.ledger.length;
const dupRes = server.handle('sync', Object.assign(creds(A), { push: { batchId: 'retry', entries: [s1entry] } }));
check(dupRes.ok && dupRes.push.results[0].status === 'dup' && world.ledger.length === before1, 'the same batch again answers dup and writes nothing');
check(A.syncNow().ok && world.ledger.length === before1, 'a second sync adds no rows');

step('S2. Lost response: the retry carries the same batch, the server already has the row');
B.online = false;
B.sim.start(sister, 'S1-0003');
B.sim.tapLast(sister, 'ရောင်း ၁');
const s2row = lastLocal(B);
B.online = true;
server.dropResponse = true;
const r2a = B.syncNow();
check(!r2a.ok && r2a.error === 'lost' && B.outbox.length === 1 && rowsOf(s2row.txId).length === 1, 'reply lost: the server wrote the row, the phone keeps the entry');
const r2b = B.syncNow();
check(r2b.ok && r2b.acked === 1 && B.outbox.length === 0 && rowsOf(s2row.txId).length === 1, 'retry acked as dup: exactly one copy on the server, outbox empty');

step('S3. Server down for three ticks: five groups arrive later in commit order');
server.down = true;
A.sim.start(sister, 'S1-0005');
A.sim.tapLast(sister, 'ကုန်ရောက်');
A.sim.tapLast(sister, '+၅');
for (let i = 0; i < 4; i++) { A.sim.start(sister, 'S1-0005'); A.sim.tapLast(sister, 'ရောင်း ၁'); }
const s3ids = A.outbox.map(e => e.txs[0].txId);
let downFailures = 0;
for (let i = 0; i < 3; i++) if (A.syncNow().error === 'network') downFailures++;
check(downFailures === 3 && A.outbox.length === 5, 'three failed ticks, five groups waiting');
server.down = false;
const r3 = A.syncNow();
const s3seqs = s3ids.map(id => rowsOf(id)[0] && rowsOf(id)[0].seq);
check(r3.ok && r3.acked === 5 && s3seqs.every(s => s > 0) && s3seqs.every((s, i) => i === 0 || s > s3seqs[i - 1]), 'all five on the server, Seq strictly increasing in commit order');
check(A.stockOf('S1-0005') === sStock('S1-0005'), 'stock agrees after the burst');

step('S4. Two phones sell the last UNIQUE piece offline: both accepted, stock -1, flag, owner void');
B.syncNow();
check(A.stockOf('S1-0001') === 1 && B.stockOf('S1-0001') === 1, 'both phones see the one piece');
A.online = false; B.online = false;
A.sim.start(sister, 'S1-0001'); A.sim.tapLast(sister, 'ရောင်းပြီး');
B.sim.start(sister, 'S1-0001'); B.sim.tapLast(sister, 'ရောင်းပြီး');
const s4b = lastLocal(B).groupId;
check(A.stockOf('S1-0001') === 0 && B.stockOf('S1-0001') === 0 && A.lastText().includes('ရောင်းပြီး') && B.lastText().includes('ရောင်းပြီး'), 'each phone shows its own sale as done');
A.online = true; B.online = true;
const pingsBefore = ownerChat().length;
const r4a = A.syncNow(), r4b = B.syncNow();
check(r4a.ok && r4a.flagged.length === 0 && r4b.ok && r4b.acked === 1 && r4b.quarantined.length === 0 && r4b.flagged.length === 1 && r4b.flagged[0].flags[0].kind === 'stock_negative', 'both rows accepted; the second is flagged stock_negative, never dropped');
check(sStock('S1-0001') === -1 && world.ledger.filter(r => r.itemId === 'S1-0001' && r.type === 'SALE').length === 2, 'server stock -1 with two SALE rows');
const ping4 = world.sim.lastBot(owner);
check(ownerChat().length > pingsBefore && ping4.text.includes('S1-0001') && world.sim.button(ping4, 'ပယ်ဖျက်') === 'V|' + s4b, 'owner pinged in Telegram with the item and a void button for the conflicting group');
check(B.chatHas('⚠️'), 'the second phone sees the flag notice');
ownerVoid(s4b);
check(sStock('S1-0001') === 0 && saleGroupInfo(world.ports, s4b).voided, 'owner void reverses the later sale: server stock 0');
A.syncNow(); B.syncNow();
check(A.stockOf('S1-0001') === 0 && B.stockOf('S1-0001') === 0 && B.ledger.some(r => r.groupId === s4b && r.reversesTxId), 'both phones pulled the reversal: stock 0 everywhere');

step('S5. Double undo race: the second is quarantined as a duplicate (end state already holds)');
A.sim.start(sister, 'S1-0002'); A.sim.tapLast(sister, 'ရောင်း ၁');
const g5 = lastLocal(A).groupId;
A.syncNow(); B.syncNow();
const stock5 = sStock('S1-0002');
check(B.ledger.some(r => r.groupId === g5 && r.synced), 'B pulled A\'s sale');
A.online = false; B.online = false;
A.sim.tapLast(sister, 'မှားသွားတယ်');
B.sim.start(sister, '');
B.sim.tap(sister, B.sim.lastBot().id, 'U|' + g5);
check(A.lastText().includes(MSG.undo_done) && B.lastText().includes(MSG.undo_done) && A.stockOf('S1-0002') === stock5 + 1 && B.stockOf('S1-0002') === stock5 + 1, 'both phones undid the same group offline');
A.online = true; B.online = true;
const r5a = A.syncNow(), r5b = B.syncNow();
check(r5a.ok && r5a.acked === 1 && r5b.ok && r5b.quarantined.length === 1 && r5b.quarantined[0].reason === 'already_reversed', 'first undo accepted, second quarantined already_reversed');
const g5tx = world.ledger.find(r => r.groupId === g5 && !r.reversesTxId).txId;
check(world.ledger.filter(r => r.reversesTxId === g5tx).length === 1 && B.ledger.filter(r => r.reversesTxId === g5tx).length === 1 && B.ledger.filter(r => r.reversesTxId === g5tx)[0].deviceId === A.meta.deviceId, 'one mirror on the server and on B (A\'s); B\'s own mirror rows are gone');
check(B.chatHas(MSG.app_already_undone) && server.quarantine.some(q => q.reason === 'already_reversed' && q.deviceId === B.meta.deviceId), 'B shows app_already_undone; Quarantine tab has the row');
check(A.stockOf('S1-0002') === sStock('S1-0002') && B.stockOf('S1-0002') === sStock('S1-0002') && sStock('S1-0002') === stock5 + 1, 'stock equal on A, B and the server');

step('S6. Over-payment race: 500,000 owed, both phones take 500,000 → accepted and flagged, never dropped');
const credit6 = openCredits(world.ports, 'S1')[0];
check(credit6 && credit6.owed === 500000, 'Daw Myint owes 500,000 on the wedding set');
A.online = false; B.online = false;
[A, B].forEach(p => { p.sim.start(sister, ''); p.sim.tapLast(sister, 'ငွေလက်ခံ'); p.sim.tapLast(sister, '500,000'); p.sim.tapLast(sister, 'အကုန်'); });
const pay6b = lastLocal(B).groupId;
check(lastLocal(A).type === 'PAYMENT' && lastLocal(A).amount === 500000 && lastLocal(B).amount === 500000 && openCredits(A.ports, 'S1').length === 0 && openCredits(B.ports, 'S1').length === 0, 'each phone shows the credit paid');
A.online = true; B.online = true;
const r6a = A.syncNow(), r6b = B.syncNow();
check(r6a.ok && r6a.flagged.length === 0 && r6b.ok && r6b.acked === 1 && r6b.quarantined.length === 0 && r6b.flagged.length === 1 && r6b.flagged[0].flags[0].kind === 'overpaid' && r6b.flagged[0].flags[0].owed === 0, 'second payment accepted and flagged overpaid (owed was 0)');
check(world.ledger.filter(r => r.type === 'PAYMENT' && r.refGroupId === credit6.groupId && !r.reversesTxId).length === 2 && saleGroupInfo(world.ports, credit6.groupId).owed === -500000, 'both PAYMENT rows are on the server (cash really moved); the group is over-settled by 500,000');
check(world.sim.lastBot(owner).text.includes('ဒေါ်မြင့်') && world.sim.button(world.sim.lastBot(owner), 'ပယ်ဖျက်') === 'V|' + pay6b, 'owner pinged with the customer and a void button for the second payment');
ownerVoid(pay6b);
check(saleGroupInfo(world.ports, credit6.groupId).owed === 0 && openCredits(world.ports, null).length === 0, 'void of the second payment: owed 0, nothing open');
A.syncNow(); B.syncNow();
check(openCredits(A.ports, null).length === 0 && openCredits(B.ports, null).length === 0 && B.ledger.some(r => r.groupId === pay6b && r.reversesTxId), 'both phones pulled the void');

step('S7. Master LWW: owner 20,000 then sister 22,000 offline → 22,000 everywhere, conflict logged');
const rev7 = sItem('S1-0002').rev;
O.online = false; A.online = false;
O.sim.start(owner, 'S1-0002'); O.sim.tap(owner, O.sim.lastBot().id, 'SP|S1-0002|20000');
A.sim.start(sister, 'S1-0002'); A.sim.tap(sister, A.sim.lastBot().id, 'SP|S1-0002|22000');
check(O.ports.store.getItem('S1-0002').price === 20000 && A.ports.store.getItem('S1-0002').price === 22000 && O.outbox.some(e => e.kind === 'item') && A.outbox.some(e => e.kind === 'item'), 'each phone shows its own price and queued an item entry');
O.online = true; A.online = true;
O.syncNow();
const rev7a = sItem('S1-0002').rev;
check(sItem('S1-0002').price === 20000 && rev7a > rev7, 'owner syncs first: 20,000, Rev bumped');
const errBefore7 = world.errors.length;
A.syncNow();
check(sItem('S1-0002').price === 22000 && sItem('S1-0002').rev > rev7a && world.errors.slice(errBefore7).some(e => e.where === 'sync_conflict'), 'sister syncs: 22,000 wins by receipt order, Rev bumped again, sync_conflict in Errors');
check(world.sim.lastBot(owner).text.includes('20000') && world.sim.lastBot(owner).text.includes('22000'), 'owner pinged with both values');
O.syncNow();
check(O.ports.store.getItem('S1-0002').price === 22000 && A.ports.store.getItem('S1-0002').price === 22000, 'both phones show 22,000 after the pull');

step('S8. Price pending across devices: blank tag by photo offline, owner sets the price in Telegram');
A.online = false;
A.sim.start(sister, 'S1-0011');
check(A.lastText().includes('Tag အသစ်'), 'blank tag opens the new-item flow offline');
A.sim.photo(sister, SIM_PHOTOS[2]);
check(A.chatHas(MSG.app_wait_server) && A.lastText().includes('ပစ္စည်း S1-0011') && A.sim.button(A.sim.lastBot(), 'စျေး မသတ်မှတ်ရသေး') !== null, 'photo queued (⏳), placeholder name, price screen still on top');
A.sim.tapLast(sister, 'စျေး မသတ်မှတ်ရသေး');
A.sim.tapLast(sister, 'ကျော်');
check(A.ports.store.getItem('S1-0011').status === 'ACTIVE' && A.ports.store.getItem('S1-0011').price === '' && A.stockOf('S1-0011') === 1, 'item registered offline with RESTOCK +1 and no price');
check(A.outbox.some(e => e.kind === 'notice' && e.to === '1000' && e.text.includes('S1-0011')), 'the owner ping waits in the outbox as a notice');
A.online = true;
const ownerMsgs8 = ownerChat().length;
const r8 = A.syncNow();
check(r8.ok && sItem('S1-0011').name === 'ပစ္စည်း S1-0011' && sItem('S1-0011').price === '' && sStock('S1-0011') === 1, 'server has the item and its RESTOCK row');
const ping8 = world.sim.lastBot(owner);
check(ownerChat().length > ownerMsgs8 && ping8.text.includes('S1-0011') && world.sim.button(ping8, '25,000') === 'SP|S1-0011|25000', 'notice relayed to the owner\'s Telegram with SP price buttons');
world.sim.tapLast(owner, '25,000');
check(sItem('S1-0011').price === 25000, 'owner set 25,000 through the Telegram route');
A.syncNow(); B2.syncNow();
check(A.ports.store.getItem('S1-0011').price === 25000 && B2.ports.store.getItem('S1-0011').price === 25000, 'designer and shop-2 phones pulled the price');
A.sim.start(sister, 'S1-0011');
check(!A.lastText().includes('ဆိုင်ရှင်ကို မေးပါ') && A.sim.button(A.sim.lastBot(), 'ရောင်းပြီး') !== null, 'the card no longer says pending and offers Sold');
const done8 = A.applyAiResults();
check(done8.length === 1 && done8[0].kind === 'photo' && A.ports.store.getItem('S1-0011').name === 'လုံချည် ပိုး အပြာနက်', 'the queued photo job came back as the AI name');
A.syncNow();
check(sItem('S1-0011').name === 'လုံချည် ပိုး အပြာနက်' && sItem('S1-0011').photoUrl.indexOf('drive://') === 0, 'server has the AI name and the Drive photo URL');

step('S9. Receipt numbers per device letter, gap-free, never renumbered; legacy rows derive the old way');
A.sim.start(sister, 'S1-0005'); A.sim.tapLast(sister, 'ရောင်း ၁');
const sale9 = lastLocal(A);
check(/^R1-B-\d{6}$/.test(sale9.receiptNo), 'A\'s sale carries R1-B-nnnnnn (shop 1, device letter B)');
A.sim.tapLast(sister, 'ဘောက်ချာ');
check(A.lastText().includes(sale9.receiptNo), 'receipt text shows the row\'s number');
A.sim.tapAny(sister, 'မှားသွားတယ်');
A.sim.start(sister, 'S1-0005'); A.sim.tapLast(sister, 'ရောင်း ၁');
const sale9b = lastLocal(A);
check(Number(sale9b.receiptNo.slice(-6)) === Number(sale9.receiptNo.slice(-6)) + 1, 'a voided sale leaves its number unused; the next sale continues the sequence');
B.sim.start(sister, 'S1-0005'); B.sim.tapLast(sister, 'ရောင်း ၁');
const sale9c = lastLocal(B);
check(/^R1-C-\d{6}$/.test(sale9c.receiptNo), 'B\'s sale carries letter C');
A.syncNow(); B.syncNow();
check(receiptNumber(world.ports, sale9b.groupId) === sale9b.receiptNo && receiptNumber(A.ports, sale9b.groupId) === sale9b.receiptNo && receiptNumber(B.ports, sale9c.groupId) === sale9c.receiptNo, 'receiptNumber() on the server and on both phones returns the row\'s ReceiptNo');
const receipts = world.ledger.filter(r => r.type === 'SALE' && !r.reversesTxId && r.receiptNo).map(r => r.receiptNo);
check(receipts.length > 3 && new Set(receipts).size === receipts.length, 'every ReceiptNo on the server is unique');
const legacyGroup = world.ledger.find(r => r.type === 'SALE' && r.itemId === 'S1-0006').groupId;
check(/^R1-\d{6}$/.test(receiptNumber(world.ports, legacyGroup)) && receiptNumber(A.ports, legacyGroup) === receiptNumber(world.ports, legacyGroup), 'the seeded (Telegram-route) sale still derives R1-nnnnnn, identically on phone and server');

step('S10. Voice offline: queued, then the proposal appears when the job comes back; results are cached');
A.online = false;
A.sim.start(sister, 'S1-0002');
const rows10 = A.ledger.length;
A.sim.voice(sister, 'ဒါ ၂ ထည် ရောင်းရတယ်');
check(A.chatHas(MSG.app_wait_server) && !A.chatHas(MSG.ai_down) && A.ledger.length === rows10 && A.aiQueue.filter(j => j.status === 'queued').length === 1, 'chat shows ⏳ (not ai_down), no row, one job queued');
A.online = true;
const aiCalls10 = server.aiCalls;
A.applyAiResults();
const price10 = A.ports.store.getItem('S1-0002').price;
check(A.lastText().includes(fmtMoney(2 * price10)) && A.sim.button(A.sim.lastBot(), 'မှန်တယ်') !== null, 'proposal for 2 pieces at ' + fmtMoney(2 * price10) + ' appeared with ✅/❌');
A.sim.tapLast(sister, 'မှန်တယ်');
const voiceRow = lastLocal(A);
check(voiceRow.type === 'SALE' && voiceRow.qty === -2 && voiceRow.source === 'VOICE' && voiceRow.transcript === 'ဒါ ၂ ထည် ရောင်းရတယ်', 'local commit with source VOICE and the transcript');
A.syncNow();
check(rowsOf(voiceRow.txId).length === 1, 'and it synced');
const job10 = A.aiQueue.find(j => j.kind === 'voice');
job10.status = 'queued';
A.applyAiResults();
check(server.aiCalls === aiCalls10 + 1 && server.aiJobs[job10.id] && server.aiJobs[job10.id].status === 'done', 'the same job id again is answered from the AiJobs cache: the mock AI ran once');

step('S12. Transfers and both shops mirrored: the TRANSFER group reaches every phone, the UI still filters by shop');
world.sim.start(sister, 'S1-0003');
world.sim.tapLast(sister, 'သို့');
check(sItem('S1-0003').shop === 'S2', 'Telegram route moved S1-0003 to shop 2');
A.syncNow(); B2.syncNow(); O.syncNow();
check(B2.stockOf('S1-0003') === sStock('S1-0003') && B2.ports.store.getItem('S1-0003').shop === 'S2' && A.ports.store.getItem('S1-0003').shop === 'S2', 'both phones pulled the pair and the item\'s new shop');
check(B2.ledger.some(r => r.shop === 'S1' && r.type === 'SALE'), 'shop-2 phone mirrors shop-1 rows (a shop-1 debtor can pay in shop 2)');
B2.sim.text(brother, '/today');
check(B2.lastText().includes('မန္တလေး') && !B2.lastText().includes('ရန်ကုန်'), 'but the staff UI shows only its own shop');
O.sim.text(owner, '/today');
check(O.lastText().includes('မန္တလေး') && O.lastText().includes('ရန်ကုန်'), 'the owner\'s phone shows both');

step('S15. Devices: owner lists, DRAIN accepts pushes but refuses pulls, REVOKE wipes the phone');
const list15 = server.handle('devices', Object.assign(creds(O), { action: 'list' }));
check(list15.ok && list15.devices.some(d => d.id === B.meta.deviceId && d.status === 'ACTIVE' && d.staff === sister.name) && !list15.devices.some(d => 'tokenHash' in d), 'owner lists devices (no hashes in the list)');
check(server.handle('devices', Object.assign(creds(A), { action: 'list' })).error === 'auth', 'a staff device cannot list devices');
check(server.handle('devices', Object.assign(creds(O), { action: 'drain', target: B.meta.deviceId })).devices.find(d => d.id === B.meta.deviceId).status === 'DRAIN', 'B set to DRAIN');
B.online = false;
B.sim.start(sister, 'S1-0005'); B.sim.tapLast(sister, 'ရောင်း ၁');
B.sim.start(sister, 'S1-0005'); B.sim.tapLast(sister, 'ရောင်း ၁');
B.online = true;
const rows15 = world.ledger.length;
const r15 = B.syncNow();
check(r15.ok && r15.acked === 2 && r15.drain && r15.pulled === 0 && world.ledger.length === rows15 + 2 && B.chatHas('⏸'), 'draining phone: two queued groups accepted, pull refused, phone told');
check(server.handle('bootstrap', creds(B)).error === 'drain' && server.handle('ai', Object.assign(creds(B), { job: { id: 'j', kind: 'voice' } })).error === 'drain', 'bootstrap and AI are refused while draining');
server.handle('devices', Object.assign(creds(O), { action: 'revoke', target: B.meta.deviceId }));
const rows15b = world.ledger.length;
const r15b = B.syncNow();
check(!r15b.ok && r15b.error === 'revoked' && B.meta.deviceId === null && B.ledger.length === 0 && B.items.length === 0 && B.chatHas('🔒'), 'revoked: the phone wiped itself (meta, ledger, items) and says so');
check(world.ledger.length === rows15b && world.errors.some(e => e.where === 'device_denied'), 'server rows intact; the denied call is logged');
check(server.summaryLines(wnow()).join(' ').indexOf(' C ') < 0, 'a revoked device never appears in the summary line');

step('S16. Clock skew: the phone is 40 minutes ahead; rows keep its time, the offset is learned, the phone is warned');
const C = enrolledPhone(sister, 'C clock', { clockErrorMs: 40 * 60000 });
check(C.enrollResult.ok && Math.abs(C.meta.offsetMs + 40 * 60000) < 2000, 'enrollment already measured the offset (-40 min)');
C.meta.offsetMs = 0;                          // the clock drifts after enrollment
C.online = false;
C.sim.start(sister, 'S1-0005'); C.sim.tapLast(sister, 'ရောင်း ၁');
const row16 = lastLocal(C);
check(Math.abs(new Date(row16.time).getTime() - (wnow().getTime() + 40 * 60000)) < 5000, 'the row carries the phone\'s own (wrong) time');
C.online = true;
const errBefore16 = world.errors.length;
const r16 = C.syncNow();
check(r16.ok && r16.acked === 1 && rowsOf(row16.txId)[0].time === row16.time, 'accepted with the phone\'s Time and Day');
const skew16 = server.handle('ping', { clientTime: C.wallClock().toISOString() }).clockSkewSec;
check(skew16 < -2000 && world.errors.slice(errBefore16).some(e => e.where === 'clock_skew'), 'response carries clockSkewSec ≈ -2400; Errors has clock_skew');
check(C.chatHas('⏰') && Math.abs(C.now().getTime() - wnow().getTime()) < 2000, 'phone shows app_clock and its corrected clock now matches the server');
C.sim.start(sister, 'S1-0005'); C.sim.tapLast(sister, 'ရောင်း ၁');
check(Math.abs(new Date(lastLocal(C).time).getTime() - wnow().getTime()) < 2000, 'the next row carries server-corrected time even before it syncs');
C.syncNow();

step('S17. The same new customer name on two phones offline: two ids, no silent merge');
A.online = false; B2.online = false;
[[A, sister], [B2, brother]].forEach(([p, u]) => {
  p.sim.start(u, ''); p.sim.tapLast(u, 'စရံ'); p.sim.tapLast(u, 'နာမည်အသစ်'); p.sim.text(u, 'ဒေါ်စန်း'); p.sim.tapLast(u, '100,000'); p.sim.tapLast(u, 'ကျော်');
});
const cA = A.customers.find(c => c.name === 'ဒေါ်စန်း'), cB = B2.customers.find(c => c.name === 'ဒေါ်စန်း');
check(cA && cB && cA.id !== cB.id && /^C-[0-9a-f]{8}$/.test(cA.id) && lastLocal(A).type === 'DEPOSIT' && lastLocal(B2).type === 'DEPOSIT', 'each phone created its own C-xxxxxxxx customer and deposit');
A.online = true; B2.online = true;
A.syncNow(); B2.syncNow(); A.syncNow();
const sann = world.customers.filter(c => c.name === 'ဒေါ်စန်း');
check(sann.length === 2 && sann.map(c => c.id).sort().join() === [cA.id, cB.id].sort().join(), 'server holds both customers with the phones\' ids');
check(A.customers.filter(c => c.name === 'ဒေါ်စန်း').length === 2 && B2.customers.filter(c => c.name === 'ဒေါ်စန်း').length === 2, 'after the pull both phones list both');
check(recentCustomers(A.ports, null, 10).some(c => c.id === cB.id) && depositsFor(A.ports, cB.id) === 100000, 'recentCustomers and deposits on A include the other phone\'s customer');

step('S19. Daily summary stale line');
server.ports.devices.update(B2.meta.deviceId, { lastSeen: new Date(wnow().getTime() - 3 * 3600000).toISOString(), pendingCount: 2 });
const stale19 = server.summaryLines(wnow());
check(stale19.length === 1 && stale19[0].startsWith(MSG.summary_stale.slice(0, 12)) && stale19[0].includes('မန္တလေး') && stale19[0].includes('၂ ခု'), 'a phone silent for 3 h with 2 pending rows is named with its shop and count');
B2.syncNow();
check(!server.summaryLines(wnow()).join(' ').includes('မန္တလေး'), 'after it syncs the line no longer names it');
{
  const day = dayKey(wnow());
  const yangon = h => new Date(new Date(day + 'T00:00:00.000Z').getTime() - YANGON_OFFSET_MS + h * 3600000).toISOString();
  const active = server.devices.filter(d => d.status === 'ACTIVE' || d.status === 'DRAIN');
  const saved = active.map(d => ({ id: d.id, lastSeen: d.lastSeen, pendingCount: d.pendingCount }));
  active.forEach(d => server.ports.devices.update(d.id, { lastSeen: yangon(19), pendingCount: 0 }));
  server.ports.devices.update(A.meta.deviceId, { lastSeen: yangon(17) });
  const evening = server.summaryLines(new Date(yangon(21)));
  check(evening.length === 1 && evening[0].includes('ဖုန်း B') && evening[0].includes('17:00') && !evening[0].includes('ဖုန်း D'), 'at 21:00 a phone that has not synced since 18:00 is named with its letter and last time');
  check(server.summaryLines(new Date(yangon(17.5))).join() === '' || server.summaryLines(new Date(yangon(17.5)))[0] === MSG.summary_synced, 'before 18:00 the same state is not stale');
  server.ports.devices.update(A.meta.deviceId, { lastSeen: yangon(19) });
  check(server.summaryLines(new Date(yangon(21)))[0] === MSG.summary_synced, 'all phones synced: the ✅ line');
  saved.forEach(s => server.ports.devices.update(s.id, { lastSeen: s.lastSeen, pendingCount: s.pendingCount }));
}

step('S20. CostAtSale backfill: a row that arrives without a cost gets the item\'s cost at receipt');
const month20 = monthKey(wnow());
const stats20 = monthStats(world.ports, 'S1', month20);
A.items.find(i => i.id === 'S1-0005').cost = '';
A.sim.start(sister, 'S1-0005'); A.sim.tapLast(sister, 'ရောင်း ၁');
const row20 = lastLocal(A);
check(row20.costAtSale === '', 'the phone wrote the row with a blank CostAtSale');
A.syncNow();
const stats20b = monthStats(world.ports, 'S1', month20);
check(rowsOf(row20.txId)[0].costAtSale === 11000 && stats20b.cogs === stats20.cogs + 11000 && stats20b.unknownCostPieces === stats20.unknownCostPieces, 'server filled 11,000 from Items; monthly COGS grew by 11,000 and no piece is counted as unknown cost');
A.items.find(i => i.id === 'S1-0005').cost = 11000;

step('S21. Structural rejection: a shop-2 device pushes a shop-1 sale → quarantined, removed from the phone, logged');
B2.sim.start(brother, 'S1-0002'); B2.sim.tapLast(brother, 'ရောင်း ၁');
const row21 = lastLocal(B2);
check(row21.shop === 'S1' && B2.stockOf('S1-0002') === sStock('S1-0002') - 1, 'the phone accepted the sale locally (the core does not know about device scope)');
const q21 = server.quarantine.length, e21 = world.errors.length;
const r21 = B2.syncNow();
check(r21.ok && r21.quarantined.length === 1 && r21.quarantined[0].reason === 'scope' && rowsOf(row21.txId).length === 0, 'server quarantined it as a scope mismatch and wrote nothing');
check(!B2.ledger.some(r => r.txId === row21.txId) && B2.stockOf('S1-0002') === sStock('S1-0002') && B2.chatHas('❌ ဒီမှတ်တမ်းကို') && B2.chatHas('ဆိုင် မမှန်'), 'B2 dropped the row, stock agrees again, chat shows app_rejected with the reason');
check(server.quarantine.length === q21 + 1 && server.quarantine[q21].deviceId === B2.meta.deviceId && world.errors.slice(e21).some(e => e.where === 'sync_reject'), 'Quarantine tab and Errors have it');
const malformed = server.handle('sync', Object.assign(creds(A), { push: { batchId: 'bad', entries: [{ kind: 'group', entryId: 'x', groupId: 'g', txs: [{ txId: 't', groupId: 'g', type: 'SALE', shop: 'S9', time: 'now', day: 'x', qty: 'a', amount: 1, cash: 1, staffId: '1001' }] }, { kind: 'wat' }] } }));
check(malformed.ok && malformed.push.results.every(r => r.status === 'quarantined') && malformed.push.results[0].reason === 'malformed' && malformed.push.results[1].reason === 'bad_kind', 'malformed rows and unknown entry kinds are quarantined, the call still answers ok');
check(server.handle('sync', Object.assign(creds(A), { push: { batchId: 'stf', entries: [{ kind: 'group', entryId: 'y', groupId: 'g2', txs: [Object.assign({}, row21, { staffId: '1002', shop: 'S1', txId: 'other', groupId: 'g2' })] }] } })).push.results[0].reason === 'staff', 'a row claiming another staff id is quarantined as staff');
{
  // An undo mirror pushed into a different group than the row it reverses: structural, never written.
  const reversed21 = new Set(world.ledger.filter(r => r.reversesTxId).map(r => r.reversesTxId));
  const orig = world.ledger.filter(r => r.type === 'SALE' && !r.reversesTxId && r.shop === 'S1' && r.staffId === '1001' && r.seq > 0 && !reversed21.has(r.txId)).pop();
  const stray = Object.assign({}, orig, { txId: 'stray-mirror', groupId: 'not-' + orig.groupId, qty: -orig.qty, amount: -orig.amount, cash: -orig.cash, reversesTxId: orig.txId, note: 'undo', source: 'UNDO' });
  delete stray.seq; delete stray.receivedAt; delete stray.deviceId; delete stray.receiptNo;
  const n21 = world.ledger.length;
  const r21s = server.handle('sync', Object.assign(creds(A), { push: { batchId: 'stray', entries: [{ kind: 'group', entryId: 'z', groupId: stray.groupId, txs: [stray] }] } }));
  check(r21s.push.results[0].status === 'quarantined' && r21s.push.results[0].reason === 'malformed' && world.ledger.length === n21 && !world.ledger.some(r => r.reversesTxId === orig.txId),
    'an undo mirror pushed outside the group it reverses is quarantined as malformed and nothing is written');
  const inGroup = Object.assign({}, stray, { txId: 'stray-mirror-2', groupId: orig.groupId });
  const r21g = server.handle('sync', Object.assign(creds(A), { push: { batchId: 'ingroup', entries: [{ kind: 'group', entryId: 'z2', groupId: orig.groupId, txs: [inGroup] }] } }));
  check(r21g.push.results[0].status === 'ok' && world.ledger.length === n21 + 1 && saleGroupInfo(world.ports, orig.groupId).voided, 'the same mirror inside its group is accepted (the sale is voided)');
  A.syncNow();
}

step('S22. Idempotent item change: the same entry twice bumps Rev once');
A.sim.start(sister, 'S1-0005'); A.sim.tap(sister, A.sim.lastBot().id, 'SP|S1-0005|23000');
const rev22 = sItem('S1-0005').rev;
server.dropResponse = true;
const masterRev22 = server.props.MASTER_REV;
const r22a = A.syncNow();
const rev22a = sItem('S1-0005').rev;
check(r22a.error === 'lost' && sItem('S1-0005').price === 23000 && rev22a > rev22 && rev22a === masterRev22 + 1, 'first delivery applied: price 23,000, Rev stamped from MASTER_REV (one bump), reply lost',
  { error: r22a.error, price: sItem('S1-0005').price, rev: rev22a, rev22, masterRev22, outbox: A.outbox.map(e => e.kind) });
const r22 = A.syncNow();
check(r22.ok && r22.acked === 1 && sItem('S1-0005').rev === rev22a && server.props.MASTER_REV === masterRev22 + 1 && sItem('S1-0005').price === 23000 && server.syncLog[server.syncLog.length - 1].note.includes('dup 1'), 'the retry answers dup: fields unchanged, no second Rev bump',
  { ok: r22.ok, acked: r22.acked, rev: sItem('S1-0005').rev, masterRev: server.props.MASTER_REV, note: server.syncLog[server.syncLog.length - 1].note });
check(A.ports.store.getItem('S1-0005').rev === rev22a, 'the phone learned the server Rev from the ack');

step('T-B. Transport B: the outbox as a .json document through the bot, same apply path');
if (A.stockOf('S1-0005') < 3) { A.sim.start(sister, 'S1-0005'); A.sim.tapLast(sister, 'ကုန်ရောက်'); A.sim.tapLast(sister, '+၁၀'); A.syncNow(); }
A.online = false;
for (let i = 0; i < 3; i++) { A.sim.start(sister, 'S1-0005'); A.sim.tapLast(sister, 'ရောင်း ၁'); }
const docText = A.exportOutbox();
const doc = JSON.parse(docText);
check(doc.format === 'salestag-outbox' && doc.version === 1 && doc.device === A.meta.deviceId && doc.entries.length === 3 && !('token' in doc) && docText.indexOf(A.meta.token) < 0, 'the exported document names the device, carries 3 entries and no token');
const rowsTB = world.ledger.length;
const ing = server.ingestDocument(docText, sister);
check(ing.ok && ing.counts.ok === 3 && world.ledger.length === rowsTB + 3 && ing.text.includes('၃'), 'ingested: 3 rows, Burmese reply names 3');
check(server.syncLog[server.syncLog.length - 1].transport === 'B' && server.syncLog[server.syncLog.length - 1].rowsPushed === 3, 'SyncLog says transport B');
const ing2 = server.ingestDocument(docText, sister);
check(ing2.ok && ing2.counts.dup === 3 && ing2.counts.ok === 0 && world.ledger.length === rowsTB + 3, 'the same file again: 3 duplicates, no new rows');
check(!server.ingestDocument(docText, brother).ok && server.ingestDocument(docText, brother).error === 'wrong_device', 'a file from another staff member\'s device is refused');
check(!server.ingestDocument('not json', sister).ok && server.ingestDocument('{"format":"x"}', sister).text === MSG.ingest_bad_file, 'garbage is refused politely');
A.online = true;
const rTB = A.syncNow();
check(rTB.ok && rTB.acked === 3 && A.outbox.length === 0 && world.ledger.length === rowsTB + 3 && A.ledger.filter(r => doc.entries.some(e => e.txs[0].txId === r.txId)).every(r => r.synced && r.seq > 0), 'the next online sync gets dup for the three and clears the outbox; rows marked synced');

step('CS. Checksums: a hand edit in the Sheet is detected and the day re-pulled');
const today = dayKey(wnow());
const edited = world.ledger.filter(r => r.day === today && r.shop === 'S1' && r.type === 'SALE' && A.ledger.some(l => l.txId === r.txId && l.synced)).pop();
edited.amount += 1000;                      // the sister "fixes" an amount by hand
const eBefore = A.errors.length;
const rCS = A.syncNow();
check(rCS.ok && rCS.repaired.indexOf(today) >= 0, 'the pull reported a checksum mismatch for today and repaired it');
check(A.ledger.find(r => r.txId === edited.txId).amount === edited.amount && A.errors.slice(eBefore).some(e => e.where === 'checksum_repair') && A.chatHas('🔧'), 'A\'s copy now matches the server; checksum_repair logged; the phone said so');
check(A.syncNow().repaired.length === 0 && A.stockOf('S1-0005') === sStock('S1-0005'), 'the next sync is clean');

step('S18. doPost routing (gas_main.js with stubbed Google services, real gas_sync.js handler, fake server behind it)');
{
  const calls = { processUpdate: [], api: [], ingest: [], sent: [], errors: [] };
  const props = { WEBHOOK_SECRET: 'secret-1' }, cacheMap = {};
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, isNaN, isFinite, parseInt, parseFloat,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props[k] === undefined ? null : props[k]), setProperty: (k, v) => { props[k] = v; } }) },
    HtmlService: { createHtmlOutput: s => ({ kind: 'html', body: s }) },
    ContentService: { createTextOutput: s => ({ kind: 'json', body: s, setMimeType() { return this; } }), MimeType: { JSON: 'application/json' } },
    CacheService: { getScriptCache: () => ({ get: k => (cacheMap[k] === undefined ? null : cacheMap[k]), put: (k, v) => { cacheMap[k] = v; }, remove: k => { delete cacheMap[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => simUuid() },
    SpreadsheetApp: {}, DriveApp: {}, ScriptApp: {}, UrlFetchApp: {}, Logger: { log() {} },
    gasStore: { logError: w => calls.errors.push(w), getStaff: id => (String(id) === '1001' ? { id: '1001', name: 'Sister', shop: 'S1', role: 'staff' } : null), getSetting: (k, d) => d, listStaff: () => [] },
    gasChat: { getFile: () => ({ getDataAsString: () => docText }), sendMessage: (chatId, text) => { calls.sent.push({ chatId, text }); return { messageId: 1 }; } },
    gasAi: {}, gasPdf: {}
  };
  vm.createContext(ctx);
  CORE_FILES.concat(['apps-script/gas_sync.js', 'apps-script/gas_main.js']).forEach(f => vm.runInContext(src(f), ctx, { filename: f }));
  // Stubs that replace functions the loaded files declare must come after the load.
  ctx.processUpdate = u => { calls.processUpdate.push(u.update_id); return 'ok'; };
  ctx.gasSyncServerPorts = () => server.ports;
  ctx.gasSyncHooks = () => server.hooks;
  ctx.gasSyncIngestDocument = (blob, staff) => { calls.ingest.push(String(staff.id)); return server.ingestDocument(blob.getDataAsString(), staff); };
  const post = (parameter, body) => ctx.doPost({ parameter, postData: { contents: JSON.stringify(body) } });
  const tgUpdate = { update_id: 5001, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, text: '/start S1-0002' } };
  const r1 = post({ token: 'secret-1' }, tgUpdate);
  check(r1.kind === 'html' && r1.body === 'ok' && calls.processUpdate.length === 1, 'Telegram update with the right token → processUpdate, HtmlService "ok"');
  const rowsBefore = world.ledger.length;
  const r2 = post({ api: 'sync' }, { device: 'nope', token: 'bad', pull: { ledgerSeq: 0 } });
  const j2 = JSON.parse(r2.body);
  check(r2.kind === 'json' && j2.ok === false && j2.error === 'auth' && j2.serverTime && calls.processUpdate.length === 1 && world.ledger.length === rowsBefore, 'same body with api=sync and a bad token → JSON {ok:false, error:auth} through ContentService, nothing written, no processUpdate');
  const r2b = post({ api: 'ping' }, {});
  check(JSON.parse(r2b.body).ok === true && JSON.parse(r2b.body).version === 1, 'api=ping answers JSON without the webhook secret');
  const r2c = post({ api: 'sync' }, Object.assign(creds(A), { pull: A.meta.cursor }));
  check(JSON.parse(r2c.body).ok === true && JSON.parse(r2c.body).pull && JSON.parse(r2c.body).device.status === 'ACTIVE', 'a real device syncs through the gas handler against the fake server');
  const r3 = post({}, Object.assign({}, tgUpdate, { update_id: 5002 }));
  check(r3.kind === 'html' && calls.processUpdate.length === 1 && calls.errors.includes('webhook_token'), 'Telegram update without the token → nothing processed, webhook_token logged, still 200');
  const r4 = post({ token: 'secret-1' }, { probe: 1 });
  check(r4.kind === 'html' && calls.processUpdate.length === 1, 'probe → ok() and no processUpdate');
  const docUpdate = { update_id: 5003, message: { message_id: 2, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, document: { file_id: 'f1', file_name: 'outbox-2026-11-02.json', mime_type: 'application/json' } } };
  const r5 = post({ token: 'secret-1' }, docUpdate);
  check(r5.kind === 'html' && calls.ingest.length === 1 && calls.processUpdate.length === 1 && calls.sent.length === 1 && calls.sent[0].chatId === 1001 && calls.sent[0].text.includes('📥'), 'a staff member\'s .json document → gasSyncIngestDocument, reply sent, no processUpdate');
  post({ token: 'secret-1' }, docUpdate);
  check(calls.ingest.length === 1 && calls.sent.length === 1, 'the same document update re-delivered is ignored (dedupe)');
  const r6 = post({ token: 'secret-1' }, { update_id: 5004, message: { message_id: 3, from: { id: 9999 }, chat: { id: 9999, type: 'private' }, date: 1, document: { file_id: 'f2', file_name: 'x.json' } } });
  check(r6.kind === 'html' && calls.ingest.length === 1 && calls.processUpdate.length === 2, 'a .json document from a non-staff user goes to the normal Telegram branch');
  const r7 = post({ token: 'secret-1' }, { update_id: 5005, message: { message_id: 4, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, document: { file_id: 'f3', file_name: 'photo.pdf' } } });
  check(r7.kind === 'html' && calls.ingest.length === 1 && calls.processUpdate.length === 3, 'a non-.json document goes to the normal Telegram branch');
  const r8 = ctx.doPost({ parameter: { api: 'sync' }, postData: { contents: '{not json' } });
  check(r8.kind === 'json' && JSON.parse(r8.body).error === 'bad_request', 'a body that is not JSON answers bad_request, never a 500');
}

step('S11. Delta paging: 1,500 more rows, a fresh phone bootstraps in 500-row pages, no duplicates');
{
  const setup = { id: 'setup', name: 'setup', shop: 'S1', role: 'owner' };
  const s1 = ['S1-0002', 'S1-0003', 'S1-0005'], s2 = ['S2-0002', 'S2-0003'];
  for (let i = 0; i < 1200; i++) commitRestock(world.ports, { item: sItem(s1[i % 3]), qty: 1, staff: setup, source: CFG.SOURCE.SYSTEM, note: 'bulk' });
  for (let i = 0; i < 300; i++) commitRestock(world.ports, { item: sItem(s2[i % 2]), qty: 1, staff: setup, source: CFG.SOURCE.SYSTEM, note: 'bulk' });
  const P = enrolledPhone(sister, 'P paging');
  const boot = P.syncLog[P.syncLog.length - 1];
  check(boot.ok && boot.pages === Math.ceil(world.ledger.length / 500) && P.ledger.length === world.ledger.length, 'bootstrap took ' + boot.pages + ' pages of 500 for ' + world.ledger.length + ' rows');
  check(new Set(P.ledger.map(r => r.txId)).size === P.ledger.length && P.ledger.every(r => r.synced && r.seq > 0), 'no duplicate TxIDs, every row synced with a Seq');
  check(P.meta.cursor.ledgerSeq === Math.max(...world.ledger.map(r => r.seq)), 'cursor advanced to the last Seq');
  equalToServer(P, 'P after a 1,500-row bootstrap');
  world.sim.start(brother, 'S2-0002'); world.sim.tapLast(brother, 'ကုန်ရောက်'); world.sim.tapLast(brother, '+၁');
  check(P.ledger.length === world.ledger.length - 1, 'a new Telegram-route row is not on the phone yet');
  const rP = P.syncNow();
  check(rP.ok && rP.pulled === 1 && P.ledger.length === world.ledger.length && P.stockOf('S2-0002') === sStock('S2-0002'), 'the next sync pulls exactly that row');
  const rA = A.syncNow();
  check(rA.ok && rA.pages === 4 && A.ledger.length === world.ledger.length, 'an older phone pulls the 1,500 rows in 4 pages');
  equalToServer(A, 'A after paging');
}

step('Final. A fresh owner phone equals the server after everything');
const Z = enrolledPhone(owner, 'Z final');
equalToServer(Z, 'Z after bootstrap');
check(Z.ports.store.getItem('S1-0011').name === 'လုံချည် ပိုး အပြာနက်' && Z.ports.store.getItem('S1-0002').price === 22000, 'masters on the fresh phone carry every change made along the way');
check(server.quarantine.length >= 2 && server.syncLog.length > 20 && server.syncLog.every(l => l.deviceId && l.transport && typeof l.durationMs === 'number'), 'SyncLog has every call with device, transport and duration; Quarantine holds the rejected rows');
check(world.ledger.every(r => r.seq > 0 && r.deviceId) && new Set(world.ledger.map(r => r.seq)).size === world.ledger.length, 'every server row has a unique Seq and a DeviceID (TG for Telegram-route rows)');
check(!world.ledger.some(r => r.deviceId === 'TG' && r.receiptNo), 'Telegram-route rows keep the plain per-shop receipt series (no letter)');

/* ---------------- round 4, step 1: the option lists reach the phones as Settings lists_json ---------------- */

step('L1. Lists: lists_json in the bootstrap and in a pull only when the hash changed; a hand-typed row is not passed on');
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pullOf = phone => server.handle('sync', Object.assign(creds(phone), { pull: Object.assign({}, phone.meta.cursor) }));
  const sameLists = phone => eq(payMethods(phone.ports, 'S1'), payMethods(world.ports, 'S1')) && eq(payMethods(phone.ports, 'S2'), payMethods(world.ports, 'S2'))
    && eq(expenseCategories(phone.ports), expenseCategories(world.ports)) && eq(listOptions(phone.ports, 'fabric').map(f => f.label), listOptions(world.ports, 'fabric').map(f => f.label));
  check(typeof server.ports.store.listOptions === 'function' && typeof server.ports.store.addListOption === 'function' && typeof server.ports.store.addDesign === 'function' && !Z.ports.store.listOptions,
    'the fake server forwards listOptions, addListOption and addDesign to the simulator store; a phone\'s store has no listOptions');
  check(world.lists.length === 0 && listsJsonFor(server.ports) === '' && !('lists_json' in syncSettingsFor(server.ports)) && !Z.settings.lists_json && eq(payMethods(Z.ports), ['CASH', 'KBZ', 'WAVE', 'BANK']),
    'a sheet without Lists rows derives no lists_json: the phone bootstrapped from it offers today\'s methods (legacy path)');

  const hash0 = Z.meta.cursor.settingsHash;
  world.settings.lists_json = JSON.stringify({ pay_method: [{ k: 'FAKE', l: 'typed by hand', a: 1, o: 1, s: '', d: '' }] });
  world.settings.meas_fields_json = '[{"key":"typed"}]';
  const sent = syncSettingsFor(server.ports);
  // meas_fields_json is the second derived name: step 1 only deletes it, step 3 derives it from the MeasureFields tab
  // (spec 9.1). So these two checks ask what holds before and after step 3: the HAND-TYPED value never reaches a phone
  // (the name is absent, or carries the derived value), and every other Settings row is passed on as it is. On the
  // phone "no lists_json" is tested as falsy: a store may keep the missing value as undefined or as ''.
  const plainKeys = map => Object.keys(map).filter(k => k !== 'lists_json' && k !== 'meas_fields_json').sort();
  check(!('lists_json' in sent) && sent.meas_fields_json !== world.settings.meas_fields_json && sent.shop_name_S1 === world.settings.shop_name_S1
    && eq(plainKeys(sent), plainKeys(world.settings)) && plainKeys(sent).length === Object.keys(world.settings).length - 2 && plainKeys(sent).every(k => sent[k] === world.settings[k]),
    'a hand-typed lists_json (or meas_fields_json) Settings row is not passed on; every other setting is');
  const pHand = pullOf(Z);
  const fresh = enrolledPhone(sister, 'L hand');
  check(pHand.ok && pHand.pull.settings === null && pHand.pull.settingsHash === hash0 && fresh.enrollResult.ok && !fresh.settings.lists_json && fresh.settings.meas_fields_json !== world.settings.meas_fields_json && fresh.settings.shop_name_S1 === world.settings.shop_name_S1,
    'it does not move the Settings hash (no settings in the pull) and is not in a bootstrap either');

  simSeedLists(world);
  const derived = listsJsonFor(server.ports);
  check(derived !== '' && syncSettingsFor(server.ports).lists_json === derived && derived !== world.settings.lists_json && derived.indexOf('FAKE') < 0, 'once the Lists tab has rows the derived value replaces the hand-typed one');
  delete world.settings.lists_json;
  delete world.settings.meas_fields_json;
  const p1 = pullOf(Z);
  check(p1.ok && p1.pull.settings !== null && p1.pull.settings.lists_json === derived && p1.pull.settingsHash !== hash0, 'seeding the Lists tab changes the Settings hash: the next pull carries the settings with lists_json');
  const z1 = Z.syncNow();
  check(z1.ok && Z.settings.lists_json === derived && Z.meta.cursor.settingsHash === p1.pull.settingsHash && sameLists(Z), 'the phone stores it and reads its lists from it: the same methods, categories and fabrics as the server');
  const p2 = pullOf(Z);
  check(p2.ok && p2.pull.settings === null && p2.pull.settingsHash === Z.meta.cursor.settingsHash, 'nothing changed: the next pull carries no settings (only when the hash changed)');

  const added = addListOptionByLabel(world.ports, 'pay_method', 'AYA ဦးမောင်', { id: '1001', name: 'Sister (S1)' });
  const p3 = pullOf(Z);
  check(added.created && p3.pull.settings !== null && p3.pull.settingsHash !== p1.pull.settingsHash && p3.pull.settings.lists_json.indexOf(added.key) > 0, 'a Lists edit (an account added in Telegram) changes the hash');
  Z.syncNow();
  check(payMethods(Z.ports, 'S1').indexOf(added.key) === 4 && methodLabel(Z.ports, added.key) === 'AYA ဦးမောင်' && sameLists(Z), 'after its next sync the phone offers the new account with its label');

  const wave = world.lists.filter(r => r.list === 'pay_method' && r.key === 'WAVE')[0], kbz = world.lists.filter(r => r.list === 'pay_method' && r.key === 'KBZ')[0];
  wave.active = false;                                   // the laptop: untick Active, type a number, rename
  kbz.detail = '09 777 123456 ဒေါ်လှ';
  kbz.label = 'KBZ ဒေါ်လှ';
  const hashBeforeEdit = Z.meta.cursor.settingsHash;
  Z.syncNow();
  check(Z.meta.cursor.settingsHash !== hashBeforeEdit && payMethods(Z.ports, 'S1').indexOf('WAVE') < 0 && methodLabel(Z.ports, 'WAVE') === MSG.method_WAVE && methodKnown(Z.ports, 'WAVE') && methodLabel(Z.ports, 'KBZ') === 'KBZ ဒေါ်လှ'
    && eq(transferLines(Z.ports, 'S1'), ['KBZ ဒေါ်လှ 09 777 123456 ဒေါ်လှ']) && eq(transferLines(Z.ports, 'S1'), transferLines(world.ports, 'S1')) && sameLists(Z),
    'hand edits in the Lists tab (Active unticked, a Detail, a new Label) reach the phone at its next sync; the retired account keeps its label');

  const N = enrolledPhone(brother, 'L lists');
  check(N.enrollResult.ok && N.settings.lists_json === listsJsonFor(server.ports) && N.meta.cursor.settingsHash === Z.meta.cursor.settingsHash && sameLists(N) && payMethods(N.ports, 'S2').indexOf(added.key) >= 0,
    'a bootstrap carries lists_json: a new phone starts with the accounts, categories and fabrics of the Lists tab');
  A.syncNow();
  check(A.settings.lists_json === N.settings.lists_json && sameLists(A), 'a phone enrolled long before pulls the same value');

  const forward = server.ports.store.listOptions;
  delete server.ports.store.listOptions;
  const older = syncSettingsFor(server.ports);
  server.ports.store.listOptions = forward;
  check(!('lists_json' in older) && syncSettingsFor(server.ports).lists_json === listsJsonFor(server.ports), 'a server store without listOptions sends no lists_json (the phones stay on the legacy Settings)');
  // What this block leaves behind for the checks appended after it: world.lists is seeded (simSeedLists) and also holds the
  // account 'AYA ဦးမောင်'; WAVE is retired; KBZ is renamed 'KBZ ဒေါ်လှ' and carries a Detail; no hand-typed lists_json or
  // meas_fields_json row is left in world.settings; the phones Z, N ('L lists') and A have pulled that state, the phone
  // 'L hand' was enrolled before the seed and has not synced since. A check that needs a sheet WITHOUT Lists rows empties
  // world.lists (and syncs its phone) or builds its own world and server.
}

/* ---------------- round 4, step 3: option lists and measurement sessions from the phones (spec 8 and 9.1) ---------------- */
// Every block below builds its own world and server (seedSimWorld: no Lists rows unless simSeedLists is called), so it
// depends on nothing above. core_orders.js is loaded from here on for latestMeasurement (the core_sync.js code under test
// calls nothing of it; the runners load different sets, spec section 0).
vm.runInThisContext(src('apps-script/core_orders.js'), { filename: 'apps-script/core_orders.js' });
const same3 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function freshWorld(withLists) {
  const w = seedSimWorld(createSimWorld());
  if (withLists) simSeedLists(w);
  return { w, s: createFakeServer(w) };
}
function phoneOf(s, w, user, name) {
  const phone = createPhone({ name, world: w, server: s });
  phone.enrollResult = phone.enroll(s.mintEnrollCode(user, name).code);
  return phone;
}
const credsOf = phone => ({ device: phone.meta.deviceId, token: phone.meta.token, appVersion: 1, clientTime: phone.wallClock().toISOString() });
/** Every reply the phone receives from now on, kept for the checks (the phone itself keeps only a summary). */
function spyOn(phone, s) {
  const replies = [];
  phone.transport = (api, body) => { const r = s.handle(api, body); replies.push({ api, r }); return r; };
  return replies;
}
const lastPush = replies => { for (let i = replies.length - 1; i >= 0; i--) if (replies[i].r && replies[i].r.push) return replies[i].r.push; return null; };
const resultOf = (push, entryId) => (push && push.results.find(r => r && r.entryId === entryId)) || {};
const pushAs = (s, phone, entries, batchId) => s.handle('sync', Object.assign(credsOf(phone), { push: { batchId: batchId || simUuid(), entries } }));
const rowsIn = (w, txId) => w.ledger.filter(r => r.txId === txId);
const nonBlank = f => { const o = {}; Object.keys(f || {}).sort().forEach(k => { if (f[k] !== '' && f[k] !== null && f[k] !== undefined) o[k] = String(f[k]); }); return o; };

step('L3a. The list kind on the server: ok, dup, every malformed variant, a server without addListOption, a store that throws');
{
  check(syncPlanPush([{ kind: 'measurement', entryId: 'm' }, { kind: 'group', entryId: 'g', txs: [{ txId: 't' }] }, { kind: 'list', entryId: 'l' }, { kind: 'customer', entryId: 'c' }, { kind: 'notice', entryId: 'n' }], 200)
    .entries.map(e => e.kind).join(',') === 'customer,list,group,measurement,notice', 'the new kinds take their place in the batch: customer, list, group, measurement, notice');
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'L3 list');
  const le = (rec, entryId) => ({ kind: 'list', entryId: entryId || simUuid(), rec });
  const pm = () => w.lists.filter(r => r.list === 'pay_method');
  const first = le({ list: 'pay_method', key: 'AYA1A2B', label: 'AYA ဘဏ်', shop: '', note: 'added by Sister 2026-11-11' }, 'e-ok');
  const r1 = pushAs(s, P, [first]);
  const aya = pm().find(r => r.key === 'AYA1A2B');
  check(r1.ok && same3(r1.push.results[0], { kind: 'list', entryId: 'e-ok', status: 'ok', key: 'AYA1A2B' }) && r1.push.counts.ok === 1,
    'a list entry is answered {kind, entryId, status: ok, key} and counted as ok', r1.push);
  check(same3(pm().map(r => r.key), ['CASH', 'KBZ', 'WAVE', 'BANK', 'AYA1A2B']) && aya.label === 'AYA ဘဏ်' && aya.order === 5 && aya.active === true && aya.note === 'added by Sister 2026-11-11',
    'on a sheet without Lists rows the list is seeded from the legacy methods first, then the option is appended (its note kept)', pm().map(r => r.key));
  const r2 = pushAs(s, P, [first]);
  check(r2.push.results[0].status === 'dup' && r2.push.results[0].key === 'AYA1A2B' && r2.push.counts.dup === 1 && pm().length === 5, 'the same entry again is a dup and writes nothing');
  const r3 = pushAs(s, P, [le({ list: 'expense_category', key: 'cwater1', label: 'ရေဖိုး' }, 'e-cat'), le({ list: 'pay_method', key: 'KBZ', detail: '09 777 123456', detailWas: '' }, 'e-det'),
    le({ list: 'pay_method', key: 'NOSUCH1', detail: '09 1' }, 'e-nolabel')]);
  const cat = w.lists.find(r => r.list === 'expense_category' && r.key === 'cwater1');
  check(resultOf(r3.push, 'e-cat').status === 'ok' && cat && cat.note === 'device ' + P.meta.deviceId && w.lists.filter(r => r.list === 'expense_category').length === legacyListRows(w.ports, 'expense_category').length + 1,
    'a list entry without a note gets "device <id>"; the category list is seeded from the legacy categories (other included) too', cat);
  check(resultOf(r3.push, 'e-det').status === 'ok' && pm().find(r => r.key === 'KBZ').detail === '09 777 123456' && resultOf(r3.push, 'e-nolabel').status === 'dup' && !pm().some(r => r.key === 'NOSUCH1'),
    'a detail for a stored key is set (ok); a detail for an unknown key without a label appends nothing (dup)');
  const long = n => new Array(n + 1).join('x');
  const variants = [
    ['no rec', undefined], ['rec an array', []], ['unknown list', { list: 'colour', key: 'X1', label: 'x' }],
    ['no key', { list: 'pay_method', label: 'x' }], ['key not a string', { list: 'pay_method', key: 12, label: 'x' }], ['empty key', { list: 'pay_method', key: '', label: 'x' }],
    ['key over 12 bytes', { list: 'pay_method', key: 'ABCDEFGHIJKLM', label: 'x' }], ['Burmese key over 12 bytes', { list: 'pay_method', key: 'ကေဘီဇက်', label: 'x' }],
    ['key with |', { list: 'pay_method', key: 'A|B', label: 'x' }], ['key with a comma', { list: 'pay_method', key: 'A,B', label: 'x' }],
    ['key with a colon', { list: 'pay_method', key: 'A:B', label: 'x' }], ['key with a space the server does not hold', { list: 'pay_method', key: 'NEW KEY', label: 'x' }],
    ['key with a tab', { list: 'pay_method', key: 'A\tB', label: 'x' }], ['key with a control character', { list: 'pay_method', key: 'A' + String.fromCharCode(1) + 'B', label: 'x' }],
    ['empty label', { list: 'pay_method', key: 'L1', label: '' }], ['label over 40', { list: 'pay_method', key: 'L2', label: long(41) }], ['label not a string', { list: 'pay_method', key: 'L3', label: 5 }],
    ['neither label nor detail', { list: 'pay_method', key: 'L4' }], ['detail over 80', { list: 'pay_method', key: 'KBZ', detail: long(81) }],
    ['detailWas over 80', { list: 'pay_method', key: 'KBZ', detail: '1', detailWas: long(81) }], ['detail not a string', { list: 'pay_method', key: 'KBZ', detail: 9 }],
    ['unknown shop', { list: 'pay_method', key: 'L5', label: 'x', shop: 'S9' }], ['note over 100', { list: 'pay_method', key: 'L6', label: 'x', note: long(101) }],
    ['note not a string', { list: 'pay_method', key: 'L7', label: 'x', note: 1 }]
  ];
  const q0 = s.quarantine.length, rows0 = w.lists.length;
  const rv = pushAs(s, P, variants.map((v, i) => le(v[1], 'bad-' + i)));
  const notMalformed = variants.filter((v, i) => { const r = resultOf(rv.push, 'bad-' + i); return r.status !== 'quarantined' || r.reason !== 'malformed'; }).map(v => v[0]);
  check(rv.ok && notMalformed.length === 0 && rv.push.counts.quarantined === variants.length && s.quarantine.length === q0 + variants.length && w.lists.length === rows0 && pm().find(r => r.key === 'KBZ').detail === '09 777 123456',
    'each of ' + variants.length + ' malformed list entries is quarantined as malformed and nothing is written', notMalformed);
  const forward = s.ports.store.addListOption;
  delete s.ports.store.addListOption;
  const rk = pushAs(s, P, [le({ list: 'pay_method', key: 'OLDSRV1', label: 'x' }, 'e-old')]);
  s.ports.store.addListOption = forward;
  check(rk.push.results[0].status === 'quarantined' && rk.push.results[0].reason === 'bad_kind' && !pm().some(r => r.key === 'OLDSRV1'), 'a server store without addListOption answers bad_kind');

  // A store that throws (a lock timeout, a missing column): the entry is answered retry, the sale of the batch is applied.
  P.online = false;
  P.sim.start(sister, 'S1-0002'); P.sim.tapLast(sister, 'ရောင်း ၁');
  const sale = lastLocal(P);
  const added = addListOptionByLabel(P.ports, 'pay_method', 'Wave ဒေါ်စု', P.meta.staff);
  P.online = true;
  check(added.created && same3(P.outbox.map(e => e.kind), ['group', 'list']), 'offline: a sale, then an account added on the phone (two entries)');
  s.ports.store.addListOption = () => { throw new Error('Lists tab: the column Detail is missing'); };
  const entries = JSON.parse(JSON.stringify(P.outbox)), e0 = w.errors.length;
  const rt = pushAs(s, P, entries, 'b-retry');
  s.ports.store.addListOption = forward;
  const listEntry = entries.find(e => e.kind === 'list');
  check(rt.ok && same3(resultOf(rt.push, listEntry.entryId), { kind: 'list', entryId: listEntry.entryId, status: 'retry' }) && rt.push.counts.retry === 1 && rt.push.counts.quarantined === 0,
    'the throwing store call is caught: the list entry is answered {kind, entryId, status: retry}', rt.push);
  check(resultOf(rt.push, entries[0].entryId).status === 'ok' && rowsIn(w, sale.txId).length === 1 && w.errors.slice(e0).some(e => e.where === 'sync_apply' && /Detail is missing/.test(e.message)) && s.syncLog[s.syncLog.length - 1].note.indexOf('retry 1') >= 0,
    'the sale group of the same batch is applied (although list sorts before group); sync_apply is logged; SyncLog notes the retry');
  const ar = syncApplyPushResults(P.local, entries, rt.push.results, rt.serverTime, P.meta.deviceId);
  check(ar.acked.length === 1 && ar.quarantined.length === 0 && P.outbox.length === 1 && P.outbox[0].kind === 'list' && P.ledger.find(r => r.txId === sale.txId).synced,
    'syncApplyPushResults: the sale is acked, the list entry answered retry stays in the outbox');
  const ar2 = syncApplyPushResults(P.local, [P.outbox[0]], [{ kind: 'list', entryId: P.outbox[0].entryId, status: 'later' }], rt.serverTime, P.meta.deviceId);
  check(ar2.acked.length === 0 && ar2.quarantined.length === 0 && P.outbox.length === 1, 'a status this version does not know is ignored the same way: the entry is kept');
  const rn = P.syncNow();
  check(rn.ok && rn.acked === 1 && P.outbox.length === 0 && pm().some(r => r.key === added.key && r.label === 'Wave ဒေါ်စု') && methodLabel(P.ports, added.key) === 'Wave ဒေါ်စု',
    'the next sync sends it again and it is applied');
}

step('L3b. An account added offline: a button at once, still there after a pull that comes before the push, then on the server and a second phone');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'L3 add'), Q = phoneOf(s, w, sister, 'L3 second');
  check(w.lists.length === 0 && !P.settings.lists_json && same3(payMethods(P.ports, 'S1'), ['CASH', 'KBZ', 'WAVE', 'BANK']), 'a world without Lists rows: the phone offers today\'s methods');
  P.sim.start(sister, 'S1-0002'); P.sim.tapLast(sister, 'ရောင်း ၁');
  s.dropResponse = true;
  const lost = P.syncNow();
  check(!lost.ok && lost.error === 'lost' && P.pendingBatch && P.pendingBatch.entries.length === 1, 'a sale whose reply is lost: the batch stays planned as it was (it will be resent without what comes after it)');
  P.online = false;
  const add = addListOptionByLabel(P.ports, 'pay_method', 'AYA ဦးမောင်', P.meta.staff);
  const entry = P.outbox.find(e => e.kind === 'list');
  check(add.ok && add.created && same3(payMethods(P.ports, 'S1'), ['CASH', 'KBZ', 'WAVE', 'BANK', add.key]) && methodLabel(P.ports, add.key) === 'AYA ဦးမောင်' && methodKnown(P.ports, add.key),
    'offline: the new account is a method button at once, next to the old ones', payMethods(P.ports, 'S1'));
  check(!!entry && same3(Object.keys(entry.rec).sort(), ['key', 'label', 'list', 'note', 'shop']) && entry.rec.key === add.key && P.outbox.length === 2,
    'one {kind: list} entry is queued, its rec without the seed rows', entry && entry.rec);
  check(addListOptionByLabel(P.ports, 'pay_method', 'aya  ဦးမောင်', P.meta.staff).existed && P.outbox.length === 2, 'the same name again is the existing option: nothing more is queued');
  const dupAdd = P.ports.store.addListOption({ list: 'pay_method', key: add.key, label: 'AYA ဦးမောင်' }, listRows(P.ports, 'pay_method'));
  const lj = P.settings.lists_json;
  check(dupAdd.status === 'dup' && dupAdd.key === add.key && P.outbox.length === 2 && P.settings.lists_json === lj,
    'the phone store answers dup for an add that changes nothing, and queues nothing for it', dupAdd);
  w.settings.summary_hour = 20;                         // the owner changes a setting meanwhile: the next pull carries the Settings
  P.online = true;
  const r1 = P.syncNow();
  check(r1.ok && r1.entries === 1 && P.settings.summary_hour === 20 && w.lists.length === 0 && P.outbox.some(e => e.kind === 'list') &&
    same3(payMethods(P.ports, 'S1'), ['CASH', 'KBZ', 'WAVE', 'BANK', add.key]) && methodLabel(P.ports, add.key) === 'AYA ဦးမောင်',
    'a pull that arrives before the push replaces the Settings map; the phone still offers KBZ, WAVE and BANK together with the account it added', payMethods(P.ports, 'S1'));
  const r2 = P.syncNow();
  const row = w.lists.find(r => r.list === 'pay_method' && r.key === add.key);
  check(r2.ok && P.outbox.length === 0 && same3(w.lists.filter(r => r.list === 'pay_method').map(r => r.key), ['CASH', 'KBZ', 'WAVE', 'BANK', add.key]) && row.label === 'AYA ဦးမောင်' && /^added by Sister/.test(row.note),
    'the next sync pushes it: the server seeds its list from the old methods and appends the account', w.lists.map(r => r.key));
  check(P.settings.lists_json === listsJsonFor(s.ports) && same3(payMethods(P.ports, 'S1'), payMethods(w.ports, 'S1')), 'and the phone then holds the server\'s own lists_json');
  Q.syncNow();
  check(same3(payMethods(Q.ports, 'S1'), payMethods(w.ports, 'S1')) && methodLabel(Q.ports, add.key) === 'AYA ဦးမောင်' && same3(payMethods(Q.ports, 'S2'), payMethods(w.ports, 'S2')),
    'a second phone offers it after its next sync (in both shops: an option added in a flow is shared)');
}

step('L3c. Two phones add the same name offline: one row on the server');
{
  const { w, s } = freshWorld(true);
  const P = phoneOf(s, w, sister, 'L3 one'), Q = phoneOf(s, w, brother, 'L3 two');
  P.online = false; Q.online = false;
  const a = addListOptionByLabel(P.ports, 'pay_method', 'KBZ ဒေါ်စု', P.meta.staff);
  const b = addListOptionByLabel(Q.ports, 'pay_method', 'kbz  ဒေါ်စု', Q.meta.staff);
  check(a.created && b.created && a.key === b.key, 'each phone creates it locally, with the same key (derived from the name)', [a.key, b.key]);
  P.online = true; Q.online = true;
  const qr = spyOn(Q, s), qEntry = Q.outbox.find(e => e.kind === 'list').entryId;
  P.syncNow(); Q.syncNow(); P.syncNow();
  const rows = w.lists.filter(r => r.list === 'pay_method' && r.key === a.key);
  check(rows.length === 1 && rows[0].label === 'KBZ ဒေါ်စု' && resultOf(lastPush(qr), qEntry).status === 'dup' && P.outbox.length === 0 && Q.outbox.length === 0,
    'one row (the first label); the second phone\'s entry is answered dup and leaves its outbox', rows);
  Q.syncNow();
  check(same3(payMethods(P.ports, 'S1'), payMethods(w.ports, 'S1')) && same3(payMethods(Q.ports, 'S2'), payMethods(w.ports, 'S2')) && methodLabel(Q.ports, a.key) === 'KBZ ဒေါ်စု' && payMethods(Q.ports, 'S2').filter(k => k === a.key).length === 1,
    'both phones end with the one option');
}

step('L3d. A stale account number from an offline phone does not overwrite a newer one');
{
  const { w, s } = freshWorld(true);
  const P = phoneOf(s, w, sister, 'L3 fresh'), Q = phoneOf(s, w, sister, 'L3 stale');
  Q.online = false;
  const dp = setListDetail(P.ports, 'pay_method', 'KBZ', '09 777 111111 ဒေါ်လှ');
  P.syncNow();
  const kbz = () => w.lists.find(r => r.list === 'pay_method' && r.key === 'KBZ');
  check(dp.ok && dp.saved && kbz().detail === '09 777 111111 ဒေါ်လှ', 'one phone sets the KBZ number and syncs');
  const dq = setListDetail(Q.ports, 'pay_method', 'KBZ', '09 999 222222');
  check(dq.ok && dq.saved && accountDetail(Q.ports, 'KBZ') === '09 999 222222' && Q.outbox.some(e => e.kind === 'list' && e.rec.detailWas === ''), 'the other phone, offline, still saw no number and types its own (detailWas blank)');
  Q.online = true;
  const qr = spyOn(Q, s);
  Q.syncNow();
  check(lastPush(qr).results[0].status === 'dup' && kbz().detail === '09 777 111111 ဒေါ်လှ' && accountDetail(Q.ports, 'KBZ') === '09 777 111111 ဒေါ်လှ' && Q.outbox.length === 0,
    'its entry is a dup: the server keeps the newer number, and the phone shows it after the pull', lastPush(qr));
  setListDetail(Q.ports, 'pay_method', 'KBZ', '09 999 333333');
  Q.syncNow();
  check(kbz().detail === '09 999 333333', 'an edit made over the number now stored replaces it');
}

step('L3e. A split made offline: its three rows are one entry, answered ok, not quarantined, no OVERPAID flag');
{
  const { w, s } = freshWorld(true);
  const P = phoneOf(s, w, sister, 'L3 split');
  P.online = false;
  P.sim.start(sister, 'S1-0002'); P.sim.tapLast(sister, 'ရောင်း ၁');
  const sale = lastLocal(P);
  const sp = splitSale(P.ports, sale.groupId, 12000, 'KBZ', P.meta.staff, 'u-split', CFG.SOURCE.BUTTON);
  const entry = P.outbox[P.outbox.length - 1];
  check(sp.ok && !sp.full && P.outbox.length === 2 && entry.kind === 'group' && same3(entry.txs.map(t => t.type), ['SALE', 'SALE', 'PAYMENT']) && entry.txs[0].reversesTxId === sale.txId,
    'the mirror, the cash part and the account part are one outbox entry', entry && entry.txs.map(t => t.type));
  P.online = true;
  const pr = spyOn(P, s);
  const r = P.syncNow();
  const res = resultOf(lastPush(pr), entry.entryId);
  check(r.ok && r.acked === 2 && res.status === 'ok' && same3(res.flags, []) && r.quarantined.length === 0 && r.flagged.length === 0 && !s.quarantine.length,
    'answered ok with no flag; nothing quarantined', res);
  check(saleGroupInfo(w.ports, sale.groupId).owed === 0 && same3(groupMethods(w.ports, sale.groupId), [{ method: 'CASH', amount: sale.cash - 12000 }, { method: 'KBZ', amount: 12000 }]),
    'the server sees nothing owed, cash and KBZ parts as on the phone', groupMethods(w.ports, sale.groupId));
}

step('L3f. A legacy key with a space (Settings pay_methods "K PAY"): its number set on a phone is applied, never left in quarantine');
{
  const { w, s } = freshWorld(false);
  w.settings.pay_methods = 'CASH,KBZ,K PAY';
  const P = phoneOf(s, w, sister, 'L3 kpay');
  check(same3(payMethods(P.ports, 'S1'), ['CASH', 'KBZ', 'K PAY']), 'the phone offers the legacy key "K PAY"');
  const d = setListDetail(P.ports, 'pay_method', 'K PAY', '09 444 555666 ဦးဘ');
  check(d.ok && d.saved && P.outbox.some(e => e.kind === 'list' && e.rec.key === 'K PAY'), 'its account number set offline queues a list entry for the key with a space');
  const pr = spyOn(P, s);
  const r = P.syncNow();
  const kpay = w.lists.find(x => x.list === 'pay_method' && x.key === 'K PAY');
  check(r.ok && r.quarantined.length === 0 && lastPush(pr).results[0].status === 'ok' && kpay && kpay.detail === '09 444 555666 ဦးဘ' && P.outbox.length === 0,
    'answered ok: a key the server holds exactly (here its legacy seed) passes the key rule; the Lists tab gets the number', lastPush(pr));
  const other = pushAs(s, P, [{ kind: 'list', entryId: 'sp', rec: { list: 'pay_method', key: 'NO SUCH', detail: '1' } }]);
  check(other.push.results[0].status === 'quarantined' && other.push.results[0].reason === 'malformed', 'a key with a space that the server does not hold stays malformed');
}

step('L3g. ➕ from a sale card on the phone, offline (the real bot over the phone store): the account and the re-marked sale reach the server in one sync');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'L3 bot');
  P.online = false;
  P.sim.start(sister, 'S1-0002'); P.sim.tapLast(sister, 'ရောင်း ၁');
  const g = lastLocal(P).groupId;
  P.sim.tapLast(sister, MSG.btn_add_bank);
  const asked = P.lastText();
  P.sim.text(sister, 'AYA ဦးမောင်');
  const key = payMethods(P.ports, 'S1')[4];
  check(asked === MSG.add_ask_pm && !!key && methodLabel(P.ports, key) === 'AYA ဦးမောင်' && methodOf(groupRows(P.ports, g).live[0]) === key && same3(P.outbox.map(e => e.kind), ['group', 'list', 'group']),
    'offline: the bot asks for the name, adds the account to the phone\'s lists and marks the sale with it (outbox: sale, list, re-mark)', P.outbox.map(e => e.kind));
  P.online = true;
  const r = P.syncNow();
  check(r.ok && r.acked === 3 && r.quarantined.length === 0 && w.lists.some(x => x.list === 'pay_method' && x.key === key) && methodOf(groupRows(w.ports, g).live[0]) === key &&
    same3(payMethods(P.ports, 'S1'), payMethods(w.ports, 'S1')), 'one sync: the server has the account (the list entry goes before the groups) and the sale marked with it');
}

step('M1. meas_fields_json: the MeasureFields rows reach the phones as a setting');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'M fields');
  const shape = f => ({ key: f.key, labelMy: f.labelMy, labelEn: f.labelEn, group: f.group, multi: f.multi, type: f.type, order: f.order, active: f.active });
  const sent = () => JSON.parse(P.settings.meas_fields_json || '[]');
  check(typeof P.settings.meas_fields_json === 'string' && same3(sent(), w.measureFields.map(shape)) && sent().length === CFG.MEASURE_FIELDS.length,
    'a bootstrap carries meas_fields_json: every MeasureFields row as {key, labelMy, labelEn, group, multi, type, order, active}');
  w.measureFields[0].labelMy = 'လည်ပင်း (ပြင်)';
  w.measureFields[1].active = false;
  const hash = P.meta.cursor.settingsHash;
  P.syncNow();
  check(P.meta.cursor.settingsHash !== hash && sent()[0].labelMy === 'လည်ပင်း (ပြင်)' && sent()[1].active === false && same3(sent(), w.measureFields.map(shape)),
    'a rename and a hidden field in the tab change the Settings hash and reach the phone at its next sync');
  w.settings.meas_fields_json = '[{"key":"typed"}]';
  check(syncSettingsFor(s.ports).meas_fields_json === P.settings.meas_fields_json, 'a hand-typed meas_fields_json Settings row is replaced by the derived value');
  const saved = w.measureFields;
  w.measureFields = [];
  check(!('meas_fields_json' in syncSettingsFor(s.ports)), 'an empty MeasureFields tab: no meas_fields_json at all (not even the hand-typed one)');
  w.measureFields = saved;
  const forward = s.ports.store.listMeasureFields;
  delete s.ports.store.listMeasureFields;
  check(!('meas_fields_json' in syncSettingsFor(s.ports)), 'a server store without listMeasureFields sends none');
  s.ports.store.listMeasureFields = forward;
  delete w.settings.meas_fields_json;
}

step('M2. The measurement kind: ok, dup on a retry, dup against an older session, staff, unknown customer, bad fields, the voucher link, a store that throws');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'M form');
  const C1 = w.customers[0].id, C2 = w.customers[1].id, today = dayKey(w.ports.clock.now());
  const pr = spyOn(P, s);
  P.online = false;
  const rec1 = P.local.saveMeasurementLocal({ customerId: C1, orderId: '', notes: 'ပထမ', fields: { neck: '14', sleeve_round: '36/30/20', bust: '' } });
  const e1 = P.outbox[P.outbox.length - 1];
  check(rec1.pending && latestMeasurement(P.ports, C1).fields.sleeve_round === '36/30/20' && e1.kind === 'measurement' &&
    same3(e1.rec, { customerId: C1, orderId: '', day: today, staffId: '1001', source: 'FORM', notes: 'ပထမ', fields: { neck: '14', sleeve_round: '36/30/20', bust: '' } }),
    'the form saves offline: the session is the customer\'s newest on the phone at once (pending) and one measurement entry is queued', e1.rec);
  P.online = true;
  const n0 = w.measurements.length;
  P.syncNow();
  const s1 = w.measurements[w.measurements.length - 1];
  check(resultOf(lastPush(pr), e1.entryId).status === 'ok' && resultOf(lastPush(pr), e1.entryId).id === s1.id && w.measurements.length === n0 + 1,
    'answered {kind: measurement, entryId, status: ok, id}', lastPush(pr));
  check(s1.customerId === C1 && s1.orderId === '' && s1.day === today && s1.staffId === '1001' && s1.source === 'FORM' && s1.photoUrl === '' && s1.notes === 'ပထမ' && s1.fields.sleeve_round === '36/30/20',
    'the stored session: source FORM, no photo, the phone\'s day, staff, notes and values as text', s1);
  check(!P.measurements[C1].pending && P.measurements[C1].id === s1.id && P.measurements[C1].n === syncMeasNo(s1.id) && P.outbox.length === 0, 'measurementSynced: the record takes the id and its number and is no longer pending');

  P.local.saveMeasurementLocal({ customerId: C1, notes: 'ဒုတိယ', fields: { neck: '14.5' } });
  s.dropResponse = true;
  const lost = P.syncNow();
  const s2 = w.measurements[w.measurements.length - 1];
  check(!lost.ok && w.measurements.length === n0 + 2 && s2.notes === 'ဒုတိယ' && P.measurements[C1].pending, 'a lost reply: the server stored the session, the phone still shows it pending');
  const again = P.syncNow();
  check(again.ok && lastPush(pr).results[0].status === 'dup' && lastPush(pr).results[0].id === s2.id && w.measurements.length === n0 + 2 && P.measurements[C1].id === s2.id && !P.measurements[C1].pending,
    'the resent entry is a dup answered with that session\'s id: no second row', lastPush(pr));
  const me = (rec, entryId) => ({ kind: 'measurement', entryId: entryId || simUuid(), rec: Object.assign({ customerId: C1, orderId: '', day: today, staffId: '1001', source: 'FORM', notes: '' }, rec) });
  // Changed in the fix round (review finding sync/major, core_sync.js:553): the duplicate rule goes by the entry (its entryId),
  // not by the values, so "an older session" is the entry of an older session sent again (a Transport B file exported before
  // the first sync and ingested late). A NEW entry with an older session's values is a new session: step M8 below.
  const older = pushAs(s, P, [me({ notes: 'ပထမ', fields: { sleeve_round: '36/30/20', neck: '14' } }, e1.entryId)]);
  check(older.push.results[0].status === 'dup' && older.push.results[0].id === s1.id && w.measurements.length === n0 + 2,
    'the entry of an OLDER session sent again (its entryId) is a dup with that session\'s id', older.push.results[0]);
  const near = pushAs(s, P, [me({ notes: 'ပထမ', source: 'CHAT', fields: { neck: '14', sleeve_round: '36/30/21' } }, 'm-near')]);
  check(near.push.results[0].status === 'ok' && w.measurements.length === n0 + 3 && w.measurements[w.measurements.length - 1].source === 'FORM',
    'one value different: a new session (stored with source FORM whatever the entry says)');
  const staff = pushAs(s, P, [me({ staffId: '1002', fields: { neck: '1' } }, 'm-staff')]);
  check(staff.push.results[0].status === 'quarantined' && staff.push.results[0].reason === 'staff', 'a session claiming another staff id is quarantined as staff');
  const unknown = pushAs(s, P, [me({ customerId: 'C-ffff0000', fields: { neck: '1' } }, 'm-unknown')]);
  check(unknown.push.results[0].status === 'quarantined' && unknown.push.results[0].reason === 'malformed' && !w.measurements.some(m => m.customerId === 'C-ffff0000'),
    'a session of a customer the server does not know is malformed, nothing stored');
  const withCustomer = pushAs(s, P, [me({ customerId: 'C-0a0b0c0d', fields: { neck: '2' } }, 'm-new-cust'), { kind: 'customer', entryId: 'c-new', rec: { id: 'C-0a0b0c0d', name: 'ဒေါ်နု', phone: '', note: '' } }]);
  check(resultOf(withCustomer.push, 'm-new-cust').status === 'ok' && resultOf(withCustomer.push, 'c-new').status === 'ok' && w.measurements.some(m => m.customerId === 'C-0a0b0c0d'),
    'a customer created offline, sent in the same batch, is applied first: its session is stored');
  const many = {};
  for (let i = 0; i < 81; i++) many['f' + i] = '1';
  const badFields = [
    ['no rec', undefined], ['customerId empty', { customerId: '', fields: { neck: '1' } }], ['customerId not a string', { customerId: 7, fields: { neck: '1' } }],
    ['no fields', { fields: undefined }], ['fields an array', { fields: ['1'] }], ['no field at all', { fields: {} }], ['81 fields', { fields: many }],
    ['a key with a space', { fields: { 'neck size': '1' } }], ['a key over 40', { fields: { ['k' + new Array(41).join('x')]: '1' } }], ['a key in Burmese', { fields: { 'လည်ပင်း': '1' } }],
    ['a number value', { fields: { neck: 14 } }], ['a value over 60', { fields: { neck: new Array(62).join('1') } }],
    ['notes over 300', { notes: new Array(302).join('n'), fields: { neck: '1' } }], ['notes not a string', { notes: 3, fields: { neck: '1' } }],
    ['no day', { day: undefined, fields: { neck: '1' } }], ['a day that does not exist', { day: '2026-02-30', fields: { neck: '1' } }], ['a day in another format', { day: '11/11/2026', fields: { neck: '1' } }],
    ['an orderId that is not a voucher id', { orderId: 'abc', fields: { neck: '1' } }]
  ];
  const nb = w.measurements.length;
  const rb = pushAs(s, P, badFields.map((v, i) => (v[1] === undefined ? { kind: 'measurement', entryId: 'bf-' + i } : me(v[1], 'bf-' + i))));
  const notBad = badFields.filter((v, i) => { const r = resultOf(rb.push, 'bf-' + i); return r.status !== 'quarantined' || r.reason !== 'malformed'; }).map(v => v[0]);
  check(notBad.length === 0 && w.measurements.length === nb, 'each of ' + badFields.length + ' malformed measurement entries is quarantined as malformed, nothing stored', notBad);

  w.ports.store.addOrder({ id: 'V1-2600', shop: 'S1', customerId: C1, status: 'OPEN', measId: '' });
  const link = pushAs(s, P, [me({ orderId: 'V1-2600', fields: { neck: '3' } }, 'v-same'), me({ customerId: C2, orderId: 'V1-2600', fields: { neck: '4' } }, 'v-other'),
    me({ orderId: 'V1-9999', fields: { neck: '5' } }, 'v-none')]);
  const byNeck = v => w.measurements.find(m => m.fields.neck === v);
  check(resultOf(link.push, 'v-same').status === 'ok' && byNeck('3').orderId === 'V1-2600' && w.ports.store.getOrder('V1-2600').measId === byNeck('3').id,
    'a voucher of the same customer: the session keeps it and the order gets measId');
  check(resultOf(link.push, 'v-other').status === 'ok' && byNeck('4').orderId === '' && resultOf(link.push, 'v-none').status === 'ok' && byNeck('5').orderId === '' && w.ports.store.getOrder('V1-2600').measId === byNeck('3').id,
    'a voucher of another customer, or one that does not exist: the session is stored with orderId blank and no order changes');

  const forward = s.ports.store.addMeasurement;
  delete s.ports.store.addMeasurement;
  const old = pushAs(s, P, [me({ fields: { neck: '6' } }, 'm-oldsrv')]);
  s.ports.store.addMeasurement = forward;
  check(old.push.results[0].status === 'quarantined' && old.push.results[0].reason === 'bad_kind', 'a server store without addMeasurement answers bad_kind');

  // A store that throws: retry, and the sale of the same batch is applied; the phone keeps the session pending.
  P.online = false;
  P.sim.start(sister, 'S1-0003'); P.sim.tapLast(sister, 'ရောင်း ၁');
  const sale = lastLocal(P);
  P.local.saveMeasurementLocal({ customerId: C2, fields: { waist: '28' } });
  P.online = true;
  s.ports.store.addMeasurement = () => { throw new Error('Measurements tab: cell limit'); };
  const e0 = w.errors.length;
  const rt = P.syncNow();
  s.ports.store.addMeasurement = forward;
  check(rt.ok && rowsIn(w, sale.txId).length === 1 && same3(P.outbox.map(e => e.kind), ['measurement']) && P.measurements[C2].pending && lastPush(pr).results.some(r => r.kind === 'measurement' && r.status === 'retry') &&
    w.errors.slice(e0).some(e => e.where === 'sync_apply'), 'a throwing addMeasurement: the entry is answered retry and kept, the sale of the batch is applied, sync_apply logged');
  P.syncNow();
  check(P.outbox.length === 0 && !P.measurements[C2].pending && P.measurements[C2].id === w.measurements[w.measurements.length - 1].id, 'the next sync stores it');

  // Two saves for one customer: the first acknowledgement leaves the record pending (the second save is still on its way).
  P.online = false;
  P.local.saveMeasurementLocal({ customerId: C2, fields: { waist: '29' } });
  P.local.saveMeasurementLocal({ customerId: C2, fields: { waist: '30' } });
  const firstOnly = [P.outbox[0]];
  const r1 = pushAs(s, P, JSON.parse(JSON.stringify(firstOnly)));
  syncApplyPushResults(P.local, firstOnly, r1.push.results, r1.serverTime, P.meta.deviceId);
  check(r1.push.results[0].status === 'ok' && P.outbox.length === 1 && P.measurements[C2].pending && P.measurements[C2].fields.waist === '30', 'the first of two saves acknowledged: the record (the second save) stays pending');
  P.online = true;
  P.syncNow();
  const last = w.measurements[w.measurements.length - 1];
  check(P.outbox.length === 0 && !P.measurements[C2].pending && P.measurements[C2].id === last.id && last.fields.waist === '30', 'the second acknowledged: the record takes its id');
}

step('M3. A quarantined measurement leaves no pending record; the earlier server session is back after the next sync');
{
  const { w, s } = freshWorld(false);
  const C1 = w.customers[0].id;
  const early = w.ports.store.addMeasurement({ customerId: C1, orderId: '', day: '2026-10-01', staffId: '1000', source: 'CHAT', photoUrl: '', notes: 'Telegram', fields: { neck: '13', bust: '' } });
  const P = phoneOf(s, w, sister, 'M reject');
  check(P.measurements[C1] && P.measurements[C1].id === early.id && same3(P.measurements[C1].fields, { neck: '13' }) && P.meta.cursor.measAfter === syncMeasNo(early.id),
    'a fresh phone holds the server\'s session (bootstrap, then one sync); blank fields are left out');
  const forward = s.ports.store.addMeasurement;
  delete s.ports.store.addMeasurement;                  // a server that does not take sessions yet (bad_kind)
  P.local.saveMeasurementLocal({ customerId: C1, fields: { neck: '15' } });
  check(latestMeasurement(P.ports, C1).fields.neck === '15' && P.measurements[C1].pending, 'a session saved on the phone shows at once');
  const r = P.syncNow();
  s.ports.store.addMeasurement = forward;
  check(r.ok && r.quarantined.length === 1 && r.quarantined[0].reason === 'bad_kind' && !P.measurements[C1] && latestMeasurement(P.ports, C1) === null && P.outbox.length === 0 && P.meta.cursor.measAfter === 0 && P.chatHas('❌'),
    'quarantined: no pending record is left, measAfter is back to 0 (the same reply did not move it again), the phone says why', P.meta.cursor);
  P.syncNow();
  check(latestMeasurement(P.ports, C1) && latestMeasurement(P.ports, C1).id === early.id && !P.measurements[C1].pending && P.meta.cursor.measAfter === syncMeasNo(early.id),
    'after the next sync the earlier server session is back');
  P.local.saveMeasurementLocal({ customerId: 'C-ffff0000', fields: { neck: '16' } });
  const ru = P.syncNow();
  check(ru.quarantined.length === 1 && ru.quarantined[0].reason === 'malformed' && !P.measurements['C-ffff0000'] && P.outbox.length === 0, 'an unknown customer: quarantined, no pending record left');
}

step('M4. 250 sessions on the server: one sync of a fresh phone pages them all in; latestMeasurement equals the server\'s');
{
  const { w, s } = freshWorld(false);
  for (let c = 0; c < 48; c++) w.ports.store.addCustomer({ name: 'ဖောက်သည် ' + c });
  const custs = w.customers.map(c => c.id);
  for (let i = 0; i < 250; i++) {
    w.ports.store.addMeasurement({ customerId: custs[i % 50], orderId: '', day: '2026-10-' + ('0' + (1 + (i % 28))).slice(-2), staffId: '1001', source: 'CHAT', photoUrl: '',
      notes: i % 7 ? '' : 'n' + i, fields: { neck: String(13 + (i % 5)), bust: i % 3 ? String(30 + (i % 9)) : '', sleeve_round: '36/30/' + (i % 20) } });
  }
  const P = phoneOf(s, w, sister, 'M paging');
  const boot = P.syncLog[P.syncLog.length - 1], follow = P.syncLog[P.syncLog.length - 2];
  check(P.enrollResult.ok && boot.api === 'bootstrap' && boot.followUp === follow && follow.api === 'sync' && follow.ok && follow.pages === 3 && follow.measurements === 250,
    'enrolment: the bootstrap, then ONE sync that pages the 250 sessions in (100, 100, 50); the bootstrap stays the last syncLog entry', follow);
  check(P.meta.cursor.measAfter === 250 && Object.keys(P.measurements).length === 50, 'the cursor stands at the last session; one record per customer');
  const differs = custs.filter(cid => {
    const a = latestMeasurement(P.ports, cid), b = latestMeasurement(w.ports, cid);
    return !(a && b && a.id === b.id && a.day === b.day && a.notes === b.notes && same3(nonBlank(a.fields), nonBlank(b.fields)));
  });
  check(differs.length === 0, 'latestMeasurement on the phone equals the server\'s for all 50 customers', differs);
  const pull = after => s.handle('sync', Object.assign(credsOf(P), { pull: Object.assign({}, P.meta.cursor, { measAfter: after }) })).pull;
  const p1 = pull(0), p3 = pull(200), p4 = pull(250);
  check(p1.measurements.length === 100 && p1.more === true && p1.measNext === 100 && p1.measFrom === 0 && p1.measurements.every((m, i) => m.n === i + 1 && m.id === 'M-' + ('0000' + (i + 1)).slice(-5)) &&
    p1.measurements.every(m => same3(Object.keys(m), ['id', 'n', 'customerId', 'orderId', 'day', 'notes', 'fields']) && Object.keys(m.fields).every(k => m.fields[k] !== '')) && p1.ledger.length === 0,
    'on the wire: measAfter 0 gives the first 100 ascending as {id, n, customerId, orderId, day, notes, fields} without blank fields, measNext 100, and more: true although no ledger row is left');
  check(p3.measurements.length === 50 && p3.more === false && p3.measNext === 250 && p4.measurements.length === 0 && p4.measNext === 250 && p4.more === false,
    'the last page has 50 and more: false; after it nothing, measNext stays');
  const fresh = w.ports.store.addMeasurement({ customerId: custs[3], orderId: '', day: '2026-11-01', staffId: '1002', source: 'CHAT', photoUrl: '', notes: '', fields: { neck: '17' } });
  const rs = P.syncNow();
  check(rs.ok && rs.measurements === 1 && latestMeasurement(P.ports, custs[3]).id === fresh.id && P.meta.cursor.measAfter === 251, 'a session taken in Telegram reaches the phone at its next sync');
}

step('M5. Compatibility: a phone that runs the core of before step 3 syncs against this server exactly as before');
{
  const { w, s } = freshWorld(false);
  w.ports.store.addMeasurement({ customerId: w.customers[0].id, orderId: '', day: '2026-10-01', staffId: '1000', source: 'CHAT', photoUrl: '', notes: '', fields: { neck: '13' } });
  const N = phoneOf(s, w, sister, 'M5 new');
  const bare = { ledgerSeq: 0, masterRev: 0, settingsHash: '', messagesHash: '' };
  const raw = s.handle('sync', Object.assign(credsOf(N), { pull: bare })).pull;
  const rawText = s.handle('sync', Object.assign(credsOf(N), { pull: Object.assign({}, bare, { measAfter: '0' }) })).pull;
  check(!('measurements' in raw) && !('measNext' in raw) && !('measFrom' in raw) && raw.more === false && raw.ledger.length === w.ledger.length && !('measurements' in rawText),
    'a pull without measAfter (or with one that is not a number) carries no measurements, no measNext, and more is the ledger\'s alone');
  // The old phone: the same simulator phone in a context of its own whose client functions and entry kinds are those of the
  // core before step 3 (copied verbatim below) and whose store has none of the round-4 methods (an app built before step 3).
  const LEGACY_CLIENT = `
SYNC.ENTRY_KINDS = { customer: 1, item: 2, group: 3, notice: 4, error: 5 };
function syncApplyPushResults(localStore, entries, results, serverTime, deviceId) {
  var acked = [], quarantined = [], flagged = [], byId = {};
  (entries || []).forEach(function (e) { byId[e.entryId] = e; });
  (results || []).forEach(function (r) {
    if (!r) return;
    var e = byId[r.entryId];
    if (!e) return;
    if (r.status === 'ok' || r.status === 'dup') {
      if (e.kind === 'group') {
        e.txs.forEach(function (tx, k) {
          var seq = r.seqByTx && r.seqByTx[tx.txId] !== undefined ? r.seqByTx[tx.txId] : (r.seq && r.seq[k] !== undefined ? r.seq[k] : null);
          localStore.markSynced(tx.txId, seq, serverTime || '', deviceId || '');
        });
      }
      if (e.kind === 'item' && r.rev && localStore.setItemRev) localStore.setItemRev(e.id, r.rev);
      if (e.kind === 'customer' && r.rev && localStore.setCustomerRev) localStore.setCustomerRev(e.id, r.rev);
      localStore.removeEntry(e.entryId);
      acked.push(e.entryId);
      if (r.flags && r.flags.length) flagged.push({ entry: e, flags: r.flags });
    } else if (r.status === 'quarantined') {
      if (e.kind === 'group') localStore.removeRows(e.txs.map(function (tx) { return tx.txId; }));
      localStore.removeEntry(e.entryId);
      quarantined.push({ entry: e, reason: r.reason });
    }
  });
  return { acked: acked, quarantined: quarantined, flagged: flagged };
}
function syncApplyDelta(localStore, delta) {
  var added = 0, repaired = [];
  if (!delta) return { added: 0, items: 0, customers: 0, repairDays: [], repaired: [] };
  (delta.items || []).forEach(function (it) { localStore.upsertItem(it); });
  (delta.customers || []).forEach(function (c) { localStore.upsertCustomer(c); });
  (delta.ledger || []).forEach(function (row) {
    if (localStore.hasRow(row.txId)) localStore.markSynced(row.txId, row.seq, row.receivedAt, row.deviceId);
    else { localStore.appendSynced(row); added++; }
  });
  if (delta.settings) localStore.setSettings(delta.settings);
  if (delta.messages) localStore.setMessages(delta.messages);
  if (delta.repair) {
    Object.keys(delta.repair).forEach(function (day) { localStore.replaceDay(day, delta.repair[day]); repaired.push(day); });
  }
  var cursor = localStore.getCursor();
  if (delta.nextLedgerSeq !== undefined && delta.nextLedgerSeq > (cursor.ledgerSeq || 0)) cursor.ledgerSeq = delta.nextLedgerSeq;
  if (delta.masterRev !== undefined) cursor.masterRev = Math.max(cursor.masterRev || 0, delta.masterRev);
  if (delta.settingsHash) cursor.settingsHash = delta.settingsHash;
  if (delta.messagesHash) cursor.messagesHash = delta.messagesHash;
  localStore.setCursor(cursor);
  var repairDays = [];
  if (!delta.more && delta.checksums) {
    var local = syncChecksums(localStore.syncedRows(), Object.keys(delta.checksums));
    repairDays = syncChecksumsDiff(local, delta.checksums).filter(function (d) { return repaired.indexOf(d) < 0; });
  }
  return { added: added, items: (delta.items || []).length, customers: (delta.customers || []).length, repairDays: repairDays, repaired: repaired };
}
function setLegacySettings(phone) { phone.local.setSettings = function (map) { var c = {}; for (var k in map) c[k] = map[k]; phone.settings = c; }; }`;
  const oldCtx = vm.createContext({ console });
  CORE_FILES.concat(SIM_FILES).forEach(f => vm.runInContext(src(f), oldCtx, { filename: 'old/' + f }));
  vm.runInContext(LEGACY_CLIENT, oldCtx, { filename: 'old/legacy-client.js' });
  const replies = [], oldJSON = vm.runInContext('JSON', oldCtx);   // a reply as the old phone's own realm would parse it
  const OLD = oldCtx.createPhone({ name: 'old core', clock: () => w.ports.clock.now(),
    transport: (api, body) => { const r = s.handle(api, body); replies.push(r); return oldJSON.parse(JSON.stringify(r)); } });
  ['upsertMeasurement', 'saveMeasurementLocal', 'measurementSynced', 'measurementRejected'].forEach(k => { delete OLD.local[k]; });
  delete OLD.ports.store.addListOption;
  delete OLD.ports.store.listMeasurements;
  oldCtx.setLegacySettings(OLD);
  delete OLD.meta.cursor.measAfter;
  const pulls = () => replies.filter(r => r && r.pull).map(r => r.pull);
  const en = OLD.enroll(s.mintEnrollCode(sister, 'old core').code);
  check(en.ok && OLD.ledger.length === w.ledger.length && !('measAfter' in OLD.meta.cursor) && pulls().length > 0 && pulls().every(p => !('measurements' in p) && !('measNext' in p)) && !OLD.local.upsertMeasurement,
    'an old phone enrolls and bootstraps; its pulls carry no measurements (it never sends measAfter)');
  OLD.online = false;
  OLD.sim.start(sister, 'S1-0002'); OLD.sim.tapLast(sister, 'ရောင်း ၁');
  OLD.sim.start(sister, ''); OLD.sim.tapLast(sister, 'စရံ'); OLD.sim.tapLast(sister, 'နာမည်အသစ်'); OLD.sim.text(sister, 'ဒေါ်စန်း'); OLD.sim.tapLast(sister, '100,000'); OLD.sim.tapLast(sister, 'ကျော်');
  const kinds = Array.from(OLD.outbox, e => e.kind);
  OLD.online = true;
  const r = OLD.syncNow();
  check(kinds.filter(k => k === 'group').length === 2 && kinds.indexOf('customer') >= 0 && r.ok && r.acked === kinds.length && r.quarantined.length === 0 && OLD.outbox.length === 0 && OLD.ledger.length === w.ledger.length &&
    OLD.stockOf('S1-0002') === s.stock('S1-0002') && w.customers.some(c => c.name === 'ဒေါ်စန်း') && OLD.errors.length === 0,
    'its offline sale, new customer and deposit sync as before: acked, on the server, the phone equal to the server', { kinds, r });
  w.sim.start(brother, 'S2-0002'); w.sim.tapLast(brother, 'ကုန်ရောက်'); w.sim.tapLast(brother, '+၁');
  w.ports.store.addMeasurement({ customerId: w.customers[1].id, orderId: '', day: '2026-11-01', staffId: '1000', source: 'CHAT', photoUrl: '', notes: '', fields: { neck: '12' } });
  const r2 = OLD.syncNow();
  check(r2.ok && r2.pulled === 1 && r2.pages === 1 && OLD.ledger.length === w.ledger.length && OLD.errors.length === 0 && typeof OLD.settings.meas_fields_json === 'string' && pulls().every(p => !('measurements' in p)),
    'it pulls the Telegram row in one page as before; the sessions never reach it, and the new meas_fields_json setting is simply stored');
}

step('M6. Edges of step 3 (independent check): the duplicate fields, a rejection while a later save waits, upsert order, a store that cannot keep sessions, page edges, valid limits');
{
  // The duplicate rule compares day, staff and notes as well as the non-empty fields: change any one and it is a new session.
  const { w, s } = freshWorld(false);
  const C1 = w.customers[0].id;
  w.ports.store.addMeasurement({ customerId: C1, orderId: '', day: '2026-11-10', staffId: '1000', source: 'CHAT', photoUrl: '', notes: 'x', fields: { neck: '13' } });
  const P = phoneOf(s, w, sister, 'M6 edges');
  const me6 = (rec, entryId) => ({ kind: 'measurement', entryId, rec: Object.assign({ customerId: C1, orderId: '', day: '2026-11-10', staffId: '1001', source: 'FORM', notes: 'x', fields: { neck: '13' } }, rec) });
  const trio = () => [me6({}, 'd-staff'), me6({ notes: 'y' }, 'd-notes'), me6({ day: '2026-11-09' }, 'd-day')];
  const n0 = w.measurements.length;
  const r1 = pushAs(s, P, trio()).push;
  check(r1.results.every(r => r.status === 'ok') && new Set(r1.results.map(r => r.id)).size === 3 && w.measurements.length === n0 + 3,
    'the same fields as a stored session but another staff member, other notes or another day: three new sessions', r1.results);
  const r2 = pushAs(s, P, trio()).push;
  check(r2.results.every((r, i) => r.status === 'dup' && r.id === r1.results[i].id) && w.measurements.length === n0 + 3, 'the same three entries again: three dups with the same ids', r2.results);

  // measurementRejected while a later save of the same customer still waits in the outbox: the record is that later save.
  P.online = false;
  P.local.saveMeasurementLocal({ customerId: C1, fields: { neck: '14' } });
  P.local.saveMeasurementLocal({ customerId: C1, fields: { neck: '15' } });
  const firstEntry = [P.outbox[0]], cursorBefore = P.meta.cursor.measAfter;
  syncApplyPushResults(P.local, firstEntry, [{ kind: 'measurement', entryId: firstEntry[0].entryId, status: 'quarantined', reason: 'malformed' }], '', P.meta.deviceId);
  check(P.measurements[C1] && P.measurements[C1].pending && P.measurements[C1].fields.neck === '15' && P.meta.cursor.measAfter === cursorBefore && P.outbox.length === 1,
    'the first of two saves quarantined: the record (the second save) stays pending and the cursor is not reset', [P.measurements[C1], P.meta.cursor.measAfter]);
  P.online = true;
  P.syncNow();
  check(P.outbox.length === 0 && !P.measurements[C1].pending && P.measurements[C1].fields.neck === '15' && P.measurements[C1].id === w.measurements[w.measurements.length - 1].id,
    'the second save then reaches the server and the record takes its id');

  // upsertMeasurement keeps the higher number; n comes from the id when a session carries none.
  P.local.upsertMeasurement({ id: 'M-00905', n: 905, customerId: 'C-0e0e0e0e', day: '2026-10-05', notes: '', fields: { neck: '5' } });
  P.local.upsertMeasurement({ id: 'M-00903', n: 903, customerId: 'C-0e0e0e0e', day: '2026-10-03', notes: '', fields: { neck: '3' } });
  const kept = P.measurements['C-0e0e0e0e'].n;
  P.local.upsertMeasurement({ id: 'M-00907', customerId: 'C-0e0e0e0e', day: '2026-10-07', notes: '', fields: { neck: '7' } });
  check(kept === 905 && P.measurements['C-0e0e0e0e'].n === 907 && P.measurements['C-0e0e0e0e'].fields.neck === '7', 'a lower number never replaces a higher one; a higher one does (its n read from the id)');
  delete P.measurements['C-0e0e0e0e'];

  // A local store without upsertMeasurement: no measAfter is added, one it carries anyway is dropped, so a sync ends.
  const bare = () => {
    const cur = { ledgerSeq: 0 };
    return { cur, upsertItem() {}, upsertCustomer() {}, hasRow() { return false; }, appendSynced() {}, markSynced() {}, setSettings() {}, setMessages() {},
      getCursor() { return cur; }, setCursor() {}, syncedRows() { return []; }, replaceDay() {} };
  };
  const page1 = { ledger: [], more: true, measurements: [{ id: 'M-00001', n: 1, customerId: C1, orderId: '', day: '2026-10-01', notes: '', fields: { neck: '1' } }], measNext: 1, measFrom: 0 };
  const b1 = bare(), a1 = syncApplyDelta(b1, page1);
  const b2 = bare(); b2.cur.measAfter = 0;
  syncApplyDelta(b2, page1);
  check(!('measAfter' in b1.cur) && a1.measurements === 0 && !('measAfter' in b2.cur), 'syncApplyDelta on a store without upsertMeasurement: no measAfter added, a carried one dropped, no session counted', [b1.cur, b2.cur]);
  const { w: w2, s: s2 } = freshWorld(false);
  for (let i = 0; i < 230; i++) w2.ports.store.addMeasurement({ customerId: w2.customers[i % 2].id, orderId: '', day: '2026-10-01', staffId: '1001', source: 'CHAT', photoUrl: '', notes: '', fields: { neck: String(i) } });
  const N = phoneOf(s2, w2, sister, 'M6 no upsert');
  delete N.local.upsertMeasurement;
  N.meta.cursor.measAfter = 0;
  let calls = 0;
  const viaServer = N.transport;
  N.transport = (api, body) => { if (++calls > 20) throw new Error('paging never ends'); return viaServer(api, body); };
  const rn = N.syncNow();
  check(rn.ok && !rn.incomplete && calls <= 3 && !('measAfter' in N.meta.cursor), 'such a phone with 230 sessions on the server: the sync ends (it stops asking for sessions)', { calls, rn });

  // Checksums are compared on the last page only, also while sessions remain.
  const sums = { '2026-11-10': { S1: { n: 3, amount: 10, cash: 10 } } };
  const keeper = bare(); keeper.cur.measAfter = 0; keeper.upsertMeasurement = () => {};
  const early = syncApplyDelta(keeper, { ledger: [], more: true, checksums: sums, measurements: [], measNext: 0, measFrom: 0 });
  const lastPage = syncApplyDelta(keeper, { ledger: [], more: false, checksums: sums, measurements: [], measNext: 0, measFrom: 0 });
  check(early.repairDays.length === 0 && same3(lastPage.repairDays, ['2026-11-10']), 'a page with more: true never asks for a repair; the last page does', [early.repairDays, lastPage.repairDays]);

  // Page edges: 0, 1, 100 and 101 sessions reach a fresh phone exactly once each, then as many again in a delta.
  const edges = [0, 1, 100, 101].map(count => {
    const { w: we, s: se } = freshWorld(false);
    const add = (k, day) => { for (let i = 0; i < k; i++) we.ports.store.addMeasurement({ customerId: we.customers[i % 2].id, orderId: '', day, staffId: '1001', source: 'CHAT', photoUrl: '', notes: '', fields: { neck: day + i } }); };
    add(count, '2026-10-01');
    const E = createPhone({ name: 'M6 edge ' + count, world: we, server: se });
    const got = [], up = E.local.upsertMeasurement;
    E.local.upsertMeasurement = function (m) { got.push(m.id); return up.call(this, m); };
    E.enroll(se.mintEnrollCode(sister, 'M6 edge').code);
    const first = got.length, firstUnique = new Set(got).size, pages1 = E.syncLog[E.syncLog.length - 2].pages, at1 = E.meta.cursor.measAfter;
    got.length = 0;
    add(count, '2026-10-02');
    const r = E.syncNow();
    return { count, ok: first === count && firstUnique === count && at1 === count && pages1 === (count > 100 ? 2 : 1) && r.ok && got.length === count && new Set(got).size === count &&
      E.meta.cursor.measAfter === 2 * count && r.pages === (count > 100 ? 2 : 1), first, pages1, at1, delta: got.length, pages2: r.pages };
  });
  check(edges.every(e => e.ok), 'page edges 0, 1, 100, 101: each session arrives once, in 1, 1, 1, 2 pages, the cursor at the last one, and the same for a delta', edges);

  // Values at their limits are well formed (nothing valid is quarantined).
  const x = k => new Array(k + 1).join('x');
  const many = {};
  for (let i = 0; i < 80; i++) many['f' + i] = String(i);
  const limits = [
    { kind: 'list', entryId: 'lim-key', rec: { list: 'pay_method', key: 'ABCDEFGHIJKL', label: 'x' } },
    { kind: 'list', entryId: 'lim-label', rec: { list: 'pay_method', key: 'LABEL40', label: x(40) } },
    { kind: 'list', entryId: 'lim-detail', rec: { list: 'pay_method', key: 'KBZ', detail: x(80), detailWas: x(80) } },
    { kind: 'list', entryId: 'lim-note', rec: { list: 'fabric', key: 'fnote', label: 'n', note: x(100), shop: 'S2' } },
    me6({ notes: x(300), fields: many }, 'lim-80'),
    me6({ notes: '', fields: { ['k' + x(39)]: x(60) } }, 'lim-key40'),
    me6({ notes: undefined, orderId: undefined, day: '2028-02-29', fields: { neck: '9' } }, 'lim-leap')
  ];
  const rl = pushAs(s, P, limits).push;
  check(rl.results.every(r => r.status === 'ok' || r.status === 'dup') && rl.counts.quarantined === 0, 'values at their limits (a 12-byte key, 40, 80 and 100 characters; 80 fields, a 40-character key, a 60-character value, 300 characters of notes, no orderId, a leap day) are accepted', rl.results);
}

step('M7. An entry answered retry holds the later entries that depend on it (same list and key, same customer) until the next sync');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'M7 hold');
  const C1 = w.customers[0].id, C2 = w.customers[1].id;
  const pr = spyOn(P, s);
  P.online = false;
  const add = addListOptionByLabel(P.ports, 'pay_method', 'AYA ဦးမောင်', P.meta.staff);
  const det = setListDetail(P.ports, 'pay_method', add.key, '09 777 123456 ဦးမောင်');
  const other = addListOptionByLabel(P.ports, 'expense_category', 'ရေဖိုး', P.meta.staff);
  P.local.saveMeasurementLocal({ customerId: C1, fields: { neck: '14' } });
  P.local.saveMeasurementLocal({ customerId: C1, fields: { neck: '15' } });
  P.local.saveMeasurementLocal({ customerId: C2, fields: { waist: '28' } });
  check(add.created && det.ok && other.created && same3(P.outbox.map(e => e.kind), ['list', 'list', 'list', 'measurement', 'measurement', 'measurement']),
    'offline: an account, its number, a category and three sessions (two of one customer)', P.outbox.map(e => e.kind));
  const addFwd = s.ports.store.addListOption, measFwd = s.ports.store.addMeasurement;
  let listFails = 1, measFails = 1;
  s.ports.store.addListOption = (rec, seed) => { if (rec.label && rec.key === add.key && listFails-- > 0) throw new Error('Service Spreadsheets timed out'); return addFwd(rec, seed); };
  s.ports.store.addMeasurement = rec => { if (rec.customerId === C1 && measFails-- > 0) throw new Error('Service Spreadsheets timed out'); return measFwd(rec); };
  P.online = true;
  const r1 = P.syncNow();
  const res1 = lastPush(pr).results;
  check(r1.ok && same3(res1.map(r => r.status), ['retry', 'retry', 'ok', 'retry', 'retry', 'ok']) && same3(P.outbox.map(e => e.kind), ['list', 'list', 'measurement', 'measurement']),
    'the account fails once: its number waits with it (never a dup against the missing row); the first session of C1 fails: the second waits; the category and C2 go through', res1.map(r => r.status));
  check(P.measurements[C1].pending && P.measurements[C1].fields.neck === '15' && accountDetail(P.ports, add.key) === '09 777 123456 ဦးမောင်' && methodLabel(P.ports, add.key) === 'AYA ဦးမောင်',
    'the phone still shows the account with its number, and the newest session pending, after the pull of that sync');
  const r2 = P.syncNow();
  s.ports.store.addListOption = addFwd; s.ports.store.addMeasurement = measFwd;
  const row = w.lists.find(x => x.list === 'pay_method' && x.key === add.key);
  const newest = latestMeasurement(w.ports, C1);
  check(r2.ok && P.outbox.length === 0 && row && row.detail === '09 777 123456 ဦးမောင်' && accountDetail(P.ports, add.key) === '09 777 123456 ဦးမောင်',
    'the next sync applies the account and then its number: the number is on the server and stays on the phone', row);
  check(newest.fields.neck === '15' && !P.measurements[C1].pending && P.measurements[C1].id === newest.id && P.measurements[C1].fields.neck === '15',
    'the two sessions of C1 are stored in the order they were saved: the newest on the server is the one the phone shows, under its id', [newest, P.measurements[C1]]);
}

/* ---------------- fix round after the review of the finished build (core_sync.js) ---------------- */

step('M8. The duplicate rule goes by the entry, not by the values: a save back to older values is the newest session everywhere; a resend, a lost reply and a Transport B file stay dups; a dup links its voucher');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'M8 revert');
  const Q = phoneOf(s, w, sister, 'M8 second');
  const C1 = w.customers[0].id, C2 = w.customers[1].id, today = dayKey(w.ports.clock.now());
  const pr = spyOn(P, s);
  const A8 = { neck: '14', waist: '30' }, B8 = { neck: '14', waist: '28' };
  P.local.saveMeasurementLocal({ customerId: C1, fields: A8 }); P.syncNow();
  P.local.saveMeasurementLocal({ customerId: C1, fields: B8 }); P.syncNow();
  P.local.saveMeasurementLocal({ customerId: C1, fields: A8 });
  const e3 = P.outbox[P.outbox.length - 1];
  const r3 = P.syncNow();
  Q.syncNow();
  const mine = w.measurements.filter(m => m.customerId === C1);
  const srv = latestMeasurement(w.ports, C1), ph = latestMeasurement(P.ports, C1), q = latestMeasurement(Q.ports, C1);
  check(r3.ok && resultOf(lastPush(pr), e3.entryId).status === 'ok' && mine.length === 3 && srv.id === mine[2].id && srv.fields.waist === '30' && srv.entryId === e3.entryId,
    'waist 30, corrected to 28, then back to 30 (same day, staff, notes): the third save is a new session and the newest on the server, with the values saved last', mine.map(m => m.id + ' waist ' + m.fields.waist));
  check(ph.id === srv.id && ph.fields.waist === '30' && !P.measurements[C1].pending && q.id === srv.id && q.fields.waist === '30',
    'this phone and a second phone show that newest session under its id (Telegram, the voucher PDF and the tailor see 30)', { phone: ph, second: q, server: srv.id });
  P.syncNow(); P.syncNow();
  check(latestMeasurement(P.ports, C1).id === srv.id && P.meta.cursor.measAfter === syncMeasNo(srv.id), 'and still after two more syncs (measAfter stands at that session)', P.meta.cursor);

  P.local.saveMeasurementLocal({ customerId: C1, notes: 'lost', fields: A8 });
  const e4 = P.outbox[P.outbox.length - 1];
  s.dropResponse = true;
  const lost = P.syncNow();
  const n4 = w.measurements.length;
  const resent = P.syncNow();
  check(!lost.ok && resent.ok && resultOf(lastPush(pr), e4.entryId).status === 'dup' && w.measurements.length === n4 && P.measurements[C1].id === w.measurements[n4 - 1].id && !P.measurements[C1].pending,
    'a lost reply: the entry sent again is a dup by its entryId, no second row, the phone takes the id', lastPush(pr));

  P.online = false;
  P.local.saveMeasurementLocal({ customerId: C1, notes: 'file', fields: B8 });
  const doc8 = P.exportOutbox();
  const nB = w.measurements.length;
  const ing1 = s.ingestDocument(doc8, sister), ing2 = s.ingestDocument(doc8, sister);
  P.online = true;
  P.syncNow();
  check(ing1.ok && ing1.counts.ok === 1 && ing2.ok && ing2.counts.dup === 1 && w.measurements.length === nB + 1 && P.outbox.length === 0 && !P.measurements[C1].pending && P.measurements[C1].id === w.measurements[nB].id,
    'a Transport B file ingested twice, then the same entry over Transport A: one session, the phone takes its id', [ing1.counts, ing2.counts]);

  const me8 = (rec, entryId) => ({ kind: 'measurement', entryId, rec: Object.assign({ customerId: C1, orderId: '', day: today, staffId: '1001', source: 'FORM', notes: '' }, rec) });
  const nF = w.measurements.length;
  const noId = pushAs(s, P, [me8({ fields: { waist: '30', neck: '14' } }, undefined)]).push.results[0];
  const longId = pushAs(s, P, [me8({ fields: { neck: '14', waist: '30', bust: '' } }, new Array(SYNC.MEAS_ENTRY_ID_MAX + 2).join('x'))]).push.results[0];
  check(noId.status === 'dup' && noId.id === srv.id && longId.status === 'dup' && longId.id === srv.id && w.measurements.length === nF,
    'an entry without a usable entryId (none, or over 64 characters) falls back to the values rule: equal to a stored session, a dup with the newest such', [noId, longId]);

  w.ports.store.addOrder({ id: 'V1-2700', shop: 'S1', customerId: C1, status: 'OPEN', measId: '' });
  const upd = s.ports.store.updateOrder, e0 = w.errors.length;
  s.ports.store.updateOrder = () => { throw new Error('Orders tab: timed out'); };
  const v1 = me8({ orderId: 'V1-2700', fields: { neck: '15' } }, 'v8-link');
  const first = pushAs(s, P, [v1]).push.results[0];
  s.ports.store.updateOrder = upd;
  const stored8 = w.measurements[w.measurements.length - 1];
  check(first.status === 'ok' && stored8.orderId === 'V1-2700' && w.ports.store.getOrder('V1-2700').measId === '' && w.errors.slice(e0).some(e => e.where === 'sync_apply'),
    'the voucher link fails once: the session is stored with the voucher, the order has no measId yet, sync_apply logged');
  const second = pushAs(s, P, [JSON.parse(JSON.stringify(v1))]).push.results[0];
  check(second.status === 'dup' && second.id === stored8.id && w.ports.store.getOrder('V1-2700').measId === stored8.id,
    'the same entry sent again: a dup, and the order gets its measId then', second);
  w.ports.store.addOrder({ id: 'V1-2701', shop: 'S1', customerId: C1, status: 'OPEN', measId: 'M-00001' });
  w.ports.store.addOrder({ id: 'V1-2702', shop: 'S1', customerId: C1, status: 'OPEN', measId: '' });
  w.ports.store.addOrder({ id: 'V1-2703', shop: 'S1', customerId: C2, status: 'OPEN', measId: '' });
  const dups = pushAs(s, P, ['V1-2701', 'V1-2702', 'V1-2703'].map(o => me8({ orderId: o, fields: { neck: '15' } }, undefined))).push.results;
  check(dups.every(r => r.status === 'dup' && r.id === stored8.id) && w.ports.store.getOrder('V1-2701').measId === 'M-00001' && w.ports.store.getOrder('V1-2702').measId === stored8.id && w.ports.store.getOrder('V1-2703').measId === '',
    'a dup gives the order it names that session only while the order is the same customer\'s and has no measId', dups);
  w.ports.store.addOrder({ id: 'V1-2704', shop: 'S1', customerId: C1, status: 'OPEN', measId: '' });
  w.ports.store.addOrder({ id: 'V1-2705', shop: 'S1', customerId: C1, status: 'OPEN', measId: '' });
  const two = pushAs(s, P, [me8({ orderId: 'V1-2704', fields: { neck: '16' } }, 'v8-a'), me8({ orderId: 'V1-2705', fields: { neck: '16' } }, 'v8-b')]).push;
  const ra = resultOf(two, 'v8-a'), rb = resultOf(two, 'v8-b');
  check(ra.status === 'ok' && rb.status === 'ok' && ra.id !== rb.id && w.ports.store.getOrder('V1-2704').measId === ra.id && w.ports.store.getOrder('V1-2705').measId === rb.id,
    'the form saved for two vouchers of the customer with the same pre-filled values: a session each, and each voucher gets its measId', [ra, rb]);
}

step('M9. A server older than the new kinds (a rollback, or the app published before the bot) answers bad_kind: the phone keeps the entries and sends them once the server knows them');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'M9 rollback');
  const C1 = w.customers[0].id;
  // The server of before round 4 differs here only by its entry kinds: list and measurement are unknown to it, and it
  // answers {kind, entryId, status: 'quarantined', reason: 'bad_kind'} for them (no kindKnown).
  const OLD_KINDS = { customer: 1, item: 2, group: 3, notice: 4, error: 5 };
  let rolledBack = true;
  P.transport = (api, body) => {
    const kinds = SYNC.ENTRY_KINDS;
    if (rolledBack) SYNC.ENTRY_KINDS = OLD_KINDS;
    try { const r = s.handle(api, JSON.parse(JSON.stringify(body))); return r === null ? null : JSON.parse(JSON.stringify(r)); } finally { SYNC.ENTRY_KINDS = kinds; }
  };
  P.online = false;
  P.sim.start(sister, 'S1-0002'); P.sim.tapLast(sister, 'ရောင်း ၁');
  const sale = lastLocal(P);
  const add = addListOptionByLabel(P.ports, 'pay_method', 'AYA ဦးမောင်', P.meta.staff);
  rewriteGroup(P.ports, sale.groupId, { method: add.key }, P.meta.staff, 'u-m9', CFG.SOURCE.BUTTON);
  P.local.saveMeasurementLocal({ customerId: C1, notes: 'rollback', fields: { neck: '14' } });
  const chat0 = P.chat.length, q0 = s.quarantine.length;
  P.online = true;
  const r1 = P.syncNow();
  const live = groupRows(w.ports, sale.groupId).live;
  check(r1.ok && s.quarantine.length === q0 + 2 && s.quarantine.slice(q0).every(x => x.reason === 'bad_kind') && live.length === 1 && live[0].method === add.key,
    'the old server takes the sale and its re-mark and answers bad_kind for the option and the session', s.quarantine.slice(q0).map(x => x.reason));
  check(r1.quarantined.length === 0 && same3(P.outbox.map(e => e.kind), ['list', 'measurement']) && P.measurements[C1] && P.measurements[C1].pending && latestMeasurement(P.ports, C1).notes === 'rollback' &&
    payMethods(P.ports, 'S1').indexOf(add.key) >= 0 && !P.chat.slice(chat0).some(m => m.from === 'bot' && /❌/.test(m.text || '')),
    'the phone keeps both entries (pending, no ❌ line): the session shows, the account is still a button', { outbox: P.outbox.map(e => e.kind), q: r1.quarantined });
  const r2 = P.syncNow();
  check(r2.ok && same3(P.outbox.map(e => e.kind), ['list', 'measurement']) && P.measurements[C1].pending, 'a second sync to the old server: still kept');
  rolledBack = false;                                   // the new server is published again over the same sheet
  const r3 = P.syncNow();
  const newest = latestMeasurement(w.ports, C1);
  check(r3.ok && P.outbox.length === 0 && w.lists.some(x => x.list === 'pay_method' && x.key === add.key && x.label === 'AYA ဦးမောင်') && methodKnown(w.ports, add.key) && methodLabel(w.ports, add.key) === 'AYA ဦးမောင်' &&
    newest && newest.notes === 'rollback' && !P.measurements[C1].pending && P.measurements[C1].id === newest.id,
    'once the server knows the kinds: the account is in its Lists (the sale shows its label) and the session is stored; the phone takes its id', { lists: w.lists.length, newest });
  // This server's own bad_kind (a store without the method) is final, as spec 8 and 9.1 say: it carries kindKnown.
  const fwd = s.ports.store.addMeasurement;
  delete s.ports.store.addMeasurement;
  const fin = pushAs(s, P, [{ kind: 'measurement', entryId: 'm9-final', rec: { customerId: C1, orderId: '', day: dayKey(w.ports.clock.now()), staffId: '1001', source: 'FORM', notes: '', fields: { neck: '1' } } },
    { kind: 'nonsense', entryId: 'm9-kind' }]).push;
  s.ports.store.addMeasurement = fwd;
  check(resultOf(fin, 'm9-final').status === 'quarantined' && resultOf(fin, 'm9-final').reason === 'bad_kind' && resultOf(fin, 'm9-final').kindKnown === true &&
    resultOf(fin, 'm9-kind').reason === 'bad_kind' && !('kindKnown' in resultOf(fin, 'm9-kind')), 'a store without the method answers bad_kind with kindKnown (final); an unknown kind gets no kindKnown', fin.results);
  const store9 = { removed: [], rejected: [], removeEntry(id) { this.removed.push(id); }, removeRows() {}, markSynced() {}, measurementRejected(c) { this.rejected.push(c); } };
  const ents = [{ kind: 'measurement', entryId: 'a', rec: { customerId: C1 } }, { kind: 'list', entryId: 'b', rec: { list: 'fabric', key: 'f9' } }, { kind: 'group', entryId: 'c', txs: [{ txId: 't9' }] }];
  const ar = syncApplyPushResults(store9, ents, ents.map(e => ({ kind: e.kind, entryId: e.entryId, status: 'quarantined', reason: 'bad_kind' })), '', 'd');
  check(same3(store9.removed, ['c']) && store9.rejected.length === 0 && ar.quarantined.length === 1 && ar.quarantined[0].entry.entryId === 'c',
    'syncApplyPushResults: bad_kind without kindKnown keeps a list or measurement entry (no measurementRejected); any other kind leaves as before', store9);
}

step('M10. A list entry quarantined for good: the next pull brings the Settings again and the option the server never stored leaves the phone');
{
  const { w, s } = freshWorld(true);
  const P = phoneOf(s, w, sister, 'M10 option');
  P.online = false;
  const add = addListOptionByLabel(P.ports, 'pay_method', 'AYA ဦးမောင်', P.meta.staff);
  const entry = P.outbox.find(e => e.kind === 'list');
  entry.rec.label = new Array(CFG.LIST_LABEL_MAX + 2).join('x');   // a label the server refuses (malformed)
  const hash0 = P.meta.cursor.settingsHash;
  check(add.created && payMethods(P.ports, 'S1').indexOf(add.key) >= 0 && !!hash0, 'offline: the account is a button on the phone');
  P.online = true;
  const r1 = P.syncNow();
  check(r1.ok && r1.quarantined.length === 1 && r1.quarantined[0].reason === 'malformed' && P.outbox.length === 0 && P.meta.cursor.settingsHash === '',
    'quarantined malformed: the entry leaves the outbox and the settings hash is cleared (the pull of the same request did not set it back)', P.meta.cursor);
  const r2 = P.syncNow();
  check(r2.ok && payMethods(P.ports, 'S1').indexOf(add.key) < 0 && P.settings.lists_json === listsJsonFor(s.ports) && !w.lists.some(x => x.key === add.key) && P.meta.cursor.settingsHash !== '',
    'the next pull brings the Settings: the phone shows the server\'s accounts again, without the one it never stored', payMethods(P.ports, 'S1'));
}

step('M11. Transport B: the reply and the SyncLog note count the entries answered retry');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'M11 file');
  const C1 = w.customers[0].id;
  P.online = false;
  addListOptionByLabel(P.ports, 'pay_method', 'AYA ဦးမောင်', P.meta.staff);
  P.local.saveMeasurementLocal({ customerId: C1, fields: { neck: '14' } });
  P.sim.start(sister, 'S1-0002'); P.sim.tapLast(sister, 'ရောင်း ၁');
  const doc = P.exportOutbox();
  const fwd = s.ports.store.addMeasurement;
  s.ports.store.addMeasurement = () => { throw new Error('Measurements tab: timed out'); };
  const ing = s.ingestDocument(doc, sister);
  s.ports.store.addMeasurement = fwd;
  const note = s.syncLog[s.syncLog.length - 1].note;
  check(ing.ok && ing.counts.retry === 1 && ing.text === t(s.ports, 'ingest_done', { ok: fmtCount(2), dup: fmtCount(0), bad: fmtCount(0) }) + ' · ' + t(s.ports, 'ingest_retry', { retry: fmtCount(1) }) &&
    / retry 1$/.test(note), 'a store error on the session: the reply says one entry is not in yet (⏳ ၁), and so does the SyncLog note', { text: ing.text, note });
  const ing2 = s.ingestDocument(doc, sister);
  check(ing2.ok && ing2.counts.retry === 0 && ing2.text === t(s.ports, 'ingest_done', { ok: fmtCount(1), dup: fmtCount(2), bad: fmtCount(0) }) && !/retry/.test(s.syncLog[s.syncLog.length - 1].note),
    'the file again: the session goes in, the reply is the one of before (no ⏳ part)', ing2.text);
}

/* ---------------- round 5, step 2: DueDay and Kind through the sync, the guided sale on the reference phone (SPEC-round-5.md 8.3) ---------------- */
// Every block builds its own world and server. Where the guided sale is driven, sale_flow is set to steps before the phone
// enrolls (seedSimWorld seeds quick). Dates are relative to the world's clock; a date is typed as d.m.yy.
const r5Dmy = key => { const p = key.split('-'); return Number(p[2]) + '.' + Number(p[1]) + '.' + p[0].slice(2); };
const r5Tap = (phone, data) => phone.sim.tap(sister, phone.sim.lastBot().id, data);
function r5StepsWorld(withLists) {
  const ws = freshWorld(withLists);
  ws.w.settings.sale_flow = 'steps';
  return ws;
}

step('R5a. A mixed guided sale on the reference phone (SALE with DueDay ten days ahead, then PAYMENT): ok, no OVERPAID flag, both rows on the server; its undo nets every bucket to 0');
{
  const { w, s } = r5StepsWorld(true);
  const P = phoneOf(s, w, sister, 'R5 mixed');
  const today = dayKey(P.now()), due10 = addDaysKey(today, 10);
  const nets = () => { const st = dayStats(w.ports, 'S1', today), n = k => (st.byMethod[k] ? st.byMethod[k].in - st.byMethod[k].out : 0); return { CASH: n('CASH'), KBZ: n('KBZ') }; };
  const before = nets();
  P.online = false;
  P.sim.start(sister, 'S1-0002');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  ['SS|S1-0002|o|method', 'SS|S1-0002|m|mix', 'SS|S1-0002|a|KBZ'].forEach(d => r5Tap(P, d));
  P.sim.text(sister, '5000');                     // the transfer part
  ['SS|S1-0002|o|paid', 'SS|S1-0002|p|other'].forEach(d => r5Tap(P, d));
  P.sim.text(sister, '9000');                     // paid now: the buyer is asked, then the day
  P.sim.text(sister, 'ဒေါ်မြင့်');
  P.sim.text(sister, r5Dmy(due10));
  r5Tap(P, 'SC|S1-0002|ok');
  const entry = P.outbox[P.outbox.length - 1] || {}, txs = entry.txs || [];
  check(P.outbox.length === 1 && entry.kind === 'group' && same3(txs.map(t => t.type), ['SALE', 'PAYMENT']) && txs[0].dueDay === due10 && txs[0].cash === 4000 && txs[0].customerId === 'C-0001' &&
    txs[1].dueDay === '' && txs[1].amount === 5000 && txs[1].method === 'KBZ' && txs[1].refGroupId === txs[0].groupId,
    'offline: one outbox group, SALE (cash 4,000, DueDay ten days ahead, ဒေါ်မြင့်) then PAYMENT (5,000 KBZ, no DueDay)', txs);
  P.online = true;
  const pr = spyOn(P, s);
  const r = P.syncNow();
  const res = resultOf(lastPush(pr), entry.entryId), sale = rowsIn(w, txs[0] && txs[0].txId)[0], pay = rowsIn(w, txs[1] && txs[1].txId)[0];
  check(r.ok && r.acked === 1 && r.quarantined.length === 0 && r.flagged.length === 0 && res.status === 'ok' && same3(res.flags, []) &&
    !!sale && sale.dueDay === due10 && typeof sale.seq === 'number' && !!pay && pay.dueDay === '' && pay.seq === sale.seq + 1 && saleGroupInfo(w.ports, sale.groupId).owed === 9000,
    'pushed: ok with no flag (the SALE is on the shadow before its PAYMENT); both rows on the server with their dueDay and a Seq; 9,000 owed', { res, sale, pay });
  const credit = openCredits(w.ports, null).find(c => c.groupId === (sale && sale.groupId));
  check(!!credit && credit.dueDay === due10 && credit.overdue === false && P.ledger.find(x => x.txId === sale.txId).synced, 'the server\'s credit carries the DueDay (not overdue yet); the phone\'s row is synced', credit);
  r5Tap(P, 'U|' + sale.groupId);
  const undo = P.outbox[P.outbox.length - 1] || {};
  const r2 = P.syncNow();
  check(undo.kind === 'group' && undo.txs.length === 2 && undo.txs.every(t => !!t.reversesTxId) && r2.ok && r2.quarantined.length === 0 && P.outbox.length === 0 &&
    liveRows(w.ledger.filter(x => x.groupId === sale.groupId), w.ledger).length === 0 && same3(nets(), before) && saleGroupInfo(w.ports, sale.groupId).owed === 0,
    'the undo group (two mirrors) is ok too: nothing live, every bucket (CASH, KBZ) back where it was, nothing owed', { nets: nets(), before });
}

step('R5b. syncValidateTx and dueDay: absent, null, blank and a yyyy-mm-dd string are fine; any other string and a number are malformed');
{
  const base = { txId: 't', groupId: 'g', type: 'SALE', shop: 'S1', time: new Date().toISOString(), day: '2026-11-12', itemId: 'S1-0002', qty: -1, amount: 1000, cash: 1000, unitPrice: 1000, costAtSale: '', staffId: '1001' };
  const v = extra => syncValidateTx(Object.assign({}, base, extra));
  check(v({}) === null && v({ dueDay: null }) === null && v({ dueDay: '' }) === null && v({ dueDay: '2026-12-30' }) === null && v({ dueDay: '30.12.26' }) === 'malformed' && v({ dueDay: 20261230 }) === 'malformed',
    'dueDay absent, null, "" and "2026-12-30" pass; "30.12.26" and the number 20261230 are malformed', [v({}), v({ dueDay: null }), v({ dueDay: '' }), v({ dueDay: '2026-12-30' }), v({ dueDay: '30.12.26' }), v({ dueDay: 20261230 })]);
}

step('R5c. An older phone: a row without dueDay is stored with ""; a fresh phone bootstraps every row with its dueDay (appendSynced keeps the field)');
{
  const { w, s } = r5StepsWorld(true);
  const P = phoneOf(s, w, sister, 'R5 older');
  P.online = false;
  P.sim.start(sister, 'S1-0002');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  ['SS|S1-0002|o|buyer', 'SS|S1-0002|b|C-0001', 'SS|S1-0002|o|paid', 'SS|S1-0002|p|half'].forEach(d => r5Tap(P, d));
  r5Tap(P, 'SS|S1-0002|d|' + saleDuePresets(P.ports)[0]);
  r5Tap(P, 'SC|S1-0002|ok');
  const dated = P.outbox[P.outbox.length - 1].txs[0];
  P.online = true;
  P.syncNow();
  P.online = false;
  P.sim.start(sister, 'S1-0005');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  ['SC|S1-0005|ok'].forEach(d => r5Tap(P, d));
  const old = JSON.parse(JSON.stringify(P.outbox[P.outbox.length - 1]));
  old.txs.forEach(tx => { delete tx.dueDay; });            // as a phone of before round 5 sends it
  const r = pushAs(s, P, [old]);
  const row = rowsIn(w, old.txs[0].txId)[0];
  check(!!dated.dueDay && r.ok && r.push.results[0].status === 'ok' && r.push.counts.quarantined === 0 && !!row && row.dueDay === '' && !('dueDay' in old.txs[0]),
    'a group whose rows have no dueDay (an older phone) is accepted and its row is stored with dueDay ""', row);
  const Q = phoneOf(s, w, sister, 'R5 fresh');
  const qd = Q.ledger.find(x => x.txId === dated.txId), qo = Q.ledger.find(x => x.txId === old.txs[0].txId);
  check(!!qd && qd.dueDay === dated.dueDay && !!qo && qo.dueDay === '' && Q.ledger.length === w.ledger.length, 'a fresh phone\'s bootstrap carries dueDay: the dated credit with its day, the older phone\'s row with ""', { qd: qd && qd.dueDay, qo: qo && qo.dueDay });
}

step('R5d. The list kind from a phone: bank is applied and reaches lists_json as t; a blank kind is applied (a wallet) and never quarantined; card is malformed; an older shape and an older server still work');
{
  const { w, s } = freshWorld(true);
  const P = phoneOf(s, w, sister, 'R5 kind');
  const pm = () => w.lists.filter(r => r.list === 'pay_method');
  const le = (rec, entryId) => ({ kind: 'list', entryId, rec });
  P.online = false;
  const bank = addListOptionByLabel(P.ports, 'pay_method', 'AYA ဦးမောင်', P.meta.staff, { kind: 'bank' });
  const entry = P.outbox.find(e => e.kind === 'list') || { rec: {} };
  check(bank.created && entry.rec.kind === 'bank' && same3(Object.keys(entry.rec).sort(), ['key', 'kind', 'label', 'list', 'note', 'shop']) && methodKind(listOption(P.ports, 'pay_method', bank.key)) === 'bank',
    'offline: an account added with kind bank is a bank on the phone at once and queues one list entry whose rec carries kind: bank', entry.rec);
  P.online = true;
  const r1 = P.syncNow();
  const row = pm().find(x => x.key === bank.key), compact = JSON.parse(listsJsonFor(s.ports)).pay_method.find(c => c.k === bank.key);
  check(r1.ok && r1.quarantined.length === 0 && !!row && row.kind === 'bank' && !!compact && compact.t === 'bank' && JSON.parse(P.settings.lists_json).pay_method.find(c => c.k === bank.key).t === 'bank',
    'applied: the server row has kind bank, and the next lists_json (on the server and on the phone after the pull) carries t: bank', { row, compact });
  P.online = false;
  const blank = addListOptionByLabel(P.ports, 'pay_method', 'Wave ဒေါ်စု', P.meta.staff);
  const blankEntry = P.outbox.find(e => e.kind === 'list');
  blankEntry.rec.kind = '';                                  // a phone that sends an empty kind
  P.online = true;
  const r2 = P.syncNow();
  const bad = pushAs(s, P, [le({ list: 'pay_method', key: 'CARD1A2B', label: 'card account', kind: 'card' }, 'e-card'), le({ list: 'pay_method', key: 'NUM1A2B', label: 'x', kind: 1 }, 'e-num')]);
  const row2 = pm().find(x => x.key === blank.key);
  check(r2.ok && r2.quarantined.length === 0 && !!row2 && !('kind' in row2) && methodKind(listOption(w.ports, 'pay_method', blank.key)) === 'wallet' && P.meta.cursor.settingsHash !== '' &&
    resultOf(bad.push, 'e-card').reason === 'malformed' && resultOf(bad.push, 'e-num').reason === 'malformed' && !pm().some(x => x.key === 'CARD1A2B' || x.key === 'NUM1A2B'),
    'kind "" is applied (the server row has no kind: a wallet) and the phone\'s settings hash is not cleared; kind "card" or a number is quarantined malformed and writes nothing', { row2, bad: bad.push.results });
  const fwd = s.ports.store.addListOption;
  s.ports.store.addListOption = (rec, seed) => { const c = {}; Object.keys(rec).forEach(k => { if (k !== 'kind') c[k] = rec[k]; }); return fwd(c, seed); };
  const older = pushAs(s, P, [le({ list: 'pay_method', key: 'OLDS1A2B', label: 'CB ဦးဘ', kind: 'bank', shop: '', note: 'x' }, 'e-oldsrv')]);
  s.ports.store.addListOption = fwd;
  const shape = pushAs(s, P, [le({ list: 'pay_method', key: 'SHP1A2B', label: 'KBZ ဦးလှ', shop: '', note: 'added by Sister' }, 'e-shape'), le({ list: 'pay_method', key: 'BNK1A2B', label: 'AYA ဒေါ်မြ', shop: '', note: 'y', kind: 'bank' }, 'e-bank2')]);
  const o = pm().find(x => x.key === 'OLDS1A2B'), sh = pm().find(x => x.key === 'SHP1A2B'), b2 = pm().find(x => x.key === 'BNK1A2B');
  check(resultOf(older.push, 'e-oldsrv').status === 'ok' && !!o && !('kind' in o) && methodKind(listOption(w.ports, 'pay_method', 'OLDS1A2B')) === 'wallet' &&
    resultOf(shape.push, 'e-shape').status === 'ok' && !!sh && !('kind' in sh) && resultOf(shape.push, 'e-bank2').status === 'ok' && !!b2 && b2.kind === 'bank',
    'a server whose store forward ignores kind stores a wallet, no quarantine; an entry of the older shape (no kind) is applied as before, next to one with kind bank', { o, sh, b2 });
}

step('R5e. The buyer of a guided sale on the reference phone: a customer entry before the group, none after 🚫; one sync resolves the sale\'s customerId on the server');
{
  const { w, s } = r5StepsWorld(false);
  const P = phoneOf(s, w, sister, 'R5 buyer');
  P.online = false;
  P.sim.start(sister, 'S1-0002');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  P.sim.text(sister, 'ဦးသန့်');
  ['SS|S1-0002|ph|skip', 'SC|S1-0002|ok'].forEach(d => r5Tap(P, d));
  const kinds1 = P.outbox.map(e => e.kind), sale1 = lastLocal(P), made = (P.outbox[0] || {}).rec || {};
  P.sim.start(sister, 'S1-0002');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  ['SC|S1-0002|ok'].forEach(d => r5Tap(P, d));
  const kinds2 = P.outbox.map(e => e.kind), sale2 = lastLocal(P);
  check(same3(kinds1, ['customer', 'group']) && made.name === 'ဦးသန့်' && sale1.customerId === made.id && same3(kinds2, ['customer', 'group', 'group']) && sale2.customerId === '',
    'a typed new buyer: the outbox holds the customer entry, then the group whose SALE names it; after 🚫 only a group is added', { kinds1, kinds2 });
  P.online = true;
  const r = P.syncNow();
  const cust = w.customers.filter(c => c.name === 'ဦးသန့်'), row = rowsIn(w, sale1.txId)[0];
  check(r.ok && r.acked === 3 && r.quarantined.length === 0 && cust.length === 1 && cust[0].id === made.id && !!row && row.customerId === made.id && w.ports.store.getCustomer(row.customerId).name === 'ဦးသန့်',
    'one sync: the server has the customer once and the sale\'s customerId resolves to her', { cust, row: row && row.customerId });
}

step('R5f. sale_flow typed into the Settings after bootstrap reaches the phone at the next pull, and saleFlow reads it');
{
  const { w, s } = freshWorld(false);
  const P = phoneOf(s, w, sister, 'R5 flow');
  const h0 = P.meta.cursor.settingsHash;
  check(P.settings.sale_flow === 'quick' && saleFlow(P.ports) === 'quick', 'the phone bootstraps with the seed\'s sale_flow quick');
  w.settings.sale_flow = 'steps';
  const r = P.syncNow();
  const n0 = P.ledger.length;
  P.sim.start(sister, 'S1-0002');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  check(r.ok && P.settings.sale_flow === 'steps' && saleFlow(P.ports) === 'form' && P.meta.cursor.settingsHash !== h0 && P.ledger.length === n0 &&
    P.lastText().endsWith(t(P.ports, 'sale_line_paid', { paid: '18,000', owed: '0' })),
    'after the pull (the hash changed) saleFlow(phone) is form (the Sheet\'s steps reads as form): the sell button opens the review card and writes nothing', { flow: P.settings.sale_flow, text: P.lastText() });
}

step('R5g. (checker) The two validation lines read exactly: a dueDay with anything after the date is malformed; wallet and bank are kinds, a capitalised word is not; the kind the store gets');
{
  const base = { txId: 't', groupId: 'g', type: 'SALE', shop: 'S1', time: new Date().toISOString(), day: '2026-11-12', itemId: 'S1-0002', qty: -1, amount: 1000, cash: 1000, unitPrice: 1000, costAtSale: '', staffId: '1001' };
  const v = extra => syncValidateTx(Object.assign({}, base, extra));
  check(v({ dueDay: '2026-12-30T00:00:00.000Z' }) === 'malformed' && v({ dueDay: '2026-12-30 ' }) === 'malformed' && v({ dueDay: ' 2026-12-30' }) === 'malformed' && v({ dueDay: '2026-12-30' }) === null,
    'dueDay "2026-12-30T00:00:00.000Z", "2026-12-30 " and " 2026-12-30" are malformed (the whole string is the date or nothing)');
  const rr = kind => syncListRecReason({ list: 'pay_method', key: 'K1A2B', label: 'x', kind });
  check(rr('wallet') === null && rr('bank') === null && rr('') === null && rr(undefined) === null && rr('Wallet') === 'malformed' && rr('BANK') === 'malformed',
    'syncListRecReason: wallet, bank, "" and no kind pass; Wallet and BANK are malformed', [rr('wallet'), rr('bank'), rr(''), rr('Wallet'), rr('BANK')]);
  const { w, s } = freshWorld(true);
  const P = phoneOf(s, w, sister, 'R5g kinds');
  const handed = [], fwd = s.ports.store.addListOption;
  s.ports.store.addListOption = (rec, seed) => { handed.push(JSON.parse(JSON.stringify(rec))); return fwd(rec, seed); };
  const le = (id, rec) => ({ kind: 'list', entryId: id, rec: Object.assign({ list: 'pay_method', shop: '', note: 'x' }, rec) });
  const r = pushAs(s, P, [le('g-w', { key: 'WLT1A2B', label: 'Wave ဒေါ်ခင်', kind: 'wallet' }), le('g-e', { key: 'BLK1A2B', label: 'KBZ ဦးမြ', kind: '' })]);
  s.ports.store.addListOption = fwd;
  const hw = handed.find(x => x.key === 'WLT1A2B') || {}, he = handed.find(x => x.key === 'BLK1A2B') || {};
  const rw = w.lists.find(x => x.key === 'WLT1A2B'), re = w.lists.find(x => x.key === 'BLK1A2B');
  check(resultOf(r.push, 'g-w').status === 'ok' && hw.kind === 'wallet' && !!rw && rw.kind === 'wallet' && resultOf(r.push, 'g-e').status === 'ok' && !!he.key && !('kind' in he) && !!re && !('kind' in re),
    'the store gets kind wallet for the wallet entry and NO kind key for the blank one; the server rows are a wallet with kind and one without', { hw, he });
}

step('R5h. A server older than DueDay (its pull names no caps dueDay: the bot rolled back, or the app published before it): the phone sells with the one-tap card; a pull that names dueDay brings the guided sale back');
{
  const { w, s } = r5StepsWorld(false);
  // An older server in front of this one: no caps in its pull. 'same': its Settings hash matches the phone's (a phone enrolled
  // on it, or two maps alike); 'other': its map hashes differently (the rollback: a round-3 server sends no lists_json);
  // 'new': this server as it is.
  const older = st => (api, body) => {
    let b = body;
    if (api === 'sync' && st.mode === 'other' && body.pull) { b = JSON.parse(JSON.stringify(body)); const h = String(b.pull.settingsHash || ''); b.pull.settingsHash = h.indexOf('r3:') === 0 ? h.slice(3) : ''; }
    const r = s.handle(api, b);
    if (api === 'sync' && r && r.pull) { st.pages++; if (st.mode !== 'new') delete r.pull.caps; if (st.mode === 'other') r.pull.settingsHash = 'r3:' + r.pull.settingsHash; }
    return r;
  };
  const P = phoneOf(s, w, sister, 'R5 old server');
  const wire = s.handle('sync', Object.assign(credsOf(P), { pull: Object.assign({}, P.meta.cursor) })).pull;
  check(P.enrollResult.ok && saleFlow(P.ports) === 'form' && same3(wire.caps, ['dueDay']) && !('quickForced' in P.meta.cursor),
    'this server\'s pull names caps [dueDay]; the phone sells with the form', wire.caps);
  const st = { mode: 'same', pages: 0 };
  P.transport = older(st);
  const r1 = P.syncNow();
  check(r1.ok && st.pages === 2 && P.settings.sale_flow === 'quick' && saleFlow(P.ports) === 'quick' && P.meta.cursor.quickForced === true && w.settings.sale_flow === 'steps',
    'the older server with the same Settings hash: the phone asks for the next page in the same sync, stores the map with sale_flow quick and sells with the one-tap card (the Sheet still says steps)', { pages: st.pages, cursor: P.meta.cursor });
  const n1 = P.ledger.length;
  P.sim.start(sister, 'S1-0002');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  const sold = lastLocal(P), entry = P.outbox[P.outbox.length - 1] || {};
  check(P.ledger.length === n1 + 1 && !!sold && sold.type === 'SALE' && sold.dueDay === '' && entry.kind === 'group' && entry.txs[0].txId === sold.txId,
    'ရောင်း ၁ commits at once (the one-tap card): a SALE without a due day goes to the outbox', sold);
  st.pages = 0;
  const r2 = P.syncNow();
  check(r2.ok && r2.acked === 1 && st.pages === 1 && saleFlow(P.ports) === 'quick' && rowsIn(w, sold.txId).length === 1,
    'the next sync with that server: the sale is pushed, one page, no Settings asked again; still the one-tap card', { pages: st.pages });
  st.mode = 'new'; st.pages = 0;
  const r3 = P.syncNow();
  check(r3.ok && st.pages === 2 && P.settings.sale_flow === 'steps' && saleFlow(P.ports) === 'form' && !('quickForced' in P.meta.cursor),
    'the bot published again (caps name dueDay, the hash matched): the next page brings the Settings as they are; form again', { pages: st.pages, cursor: P.meta.cursor });
  st.mode = 'other'; st.pages = 0;
  const r4 = P.syncNow();
  check(r4.ok && st.pages === 1 && P.settings.sale_flow === 'quick' && P.meta.cursor.quickForced === true && P.meta.cursor.settingsHash.indexOf('r3:') === 0,
    'a rollback to a server whose map hashes differently: its first page carries the Settings and they are stored quick', { pages: st.pages, cursor: P.meta.cursor });
  st.mode = 'new'; st.pages = 0;
  const r5 = P.syncNow();
  const n5 = P.ledger.length;
  P.sim.start(sister, 'S1-0002');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  check(r5.ok && st.pages === 1 && saleFlow(P.ports) === 'form' && !('quickForced' in P.meta.cursor) && P.ledger.length === n5 &&
    P.lastText().endsWith(t(P.ports, 'sale_line_paid', { paid: '18,000', owed: '0' })),
    'published again: one page brings the Settings back and the sell button opens the review card (writes nothing)', { pages: st.pages, text: P.lastText() });
  const st2 = { mode: 'same', pages: 0 };
  const Q = createPhone({ name: 'R5 enrolled on an older server', world: w, server: s, transport: older(st2) });
  Q.enrollResult = Q.enroll(s.mintEnrollCode(sister, 'R5 enrolled on an older server').code);
  check(Q.enrollResult.ok && Q.settings.sale_flow === 'quick' && saleFlow(Q.ports) === 'quick' && Q.meta.cursor.quickForced === true,
    'a phone enrolled on an older server sells with the one-tap card from the sync that follows its bootstrap', { flow: Q.settings.sale_flow, cursor: Q.meta.cursor });
}

/* ---------------- round 6, step 2 (docs/design-round-6/SPEC-round-6.md 10.4 and 13.15): baskets, the new piece, the late rename, the setting entry, the drawing, the jobs ---------------- */
// Every block builds its own world and server; the reference phone has no ports.ui, so it sells through the Telegram review card.
function r6FormWorld(withLists) {
  const ws = freshWorld(withLists);
  ws.w.settings.sale_flow = 'form';
  return ws;
}
const r6Net = (w, shop, day) => { const st = dayStats(w.ports, shop, day), n = k => (st.byMethod[k] ? st.byMethod[k].in - st.byMethod[k].out : 0); return { CASH: n('CASH'), KBZ: n('KBZ') }; };
const r6Owner = w => (w.chats[owner.id] || []).filter(m => m.from === 'bot');

step('R6a. A basket on the reference phone through the review card (outcome 5): one outbox group, one receipt number, no OVERPAID flag, one credit named by basketName; its undo puts every bucket back');
{
  const { w, s } = r6FormWorld(true);
  const P = phoneOf(s, w, sister, 'R6a basket');
  const today = dayKey(P.now()), D = addDaysKey(today, 14), ids = ['S1-0002', 'S1-0005', 'S1-0001'];
  const before = r6Net(w, 'S1', today), stock0 = ids.map(id => s.stock(id)), counter0 = P.meta.receiptCounter;
  P.online = false;
  P.sim.start(sister, 'S1-0002');
  P.sim.tapLast(sister, MSG.btn_sell_one);
  ['SS|S1-0002|l|S1-0002', 'SS|S1-0002|q|2', 'SS|S1-0002|add'].forEach(d => r5Tap(P, d));
  P.sim.start(sister, 'S1-0005');                 // ➕ then the scan: the piece joins the basket
  r5Tap(P, 'SS|S1-0002|add');
  P.sim.start(sister, 'S1-0001');
  ['SS|S1-0002|o|method', 'SS|S1-0002|m|mix', 'SS|S1-0002|a|KBZ'].forEach(d => r5Tap(P, d));
  P.sim.text(sister, '10000');                    // the transfer part
  ['SS|S1-0002|o|paid', 'SS|S1-0002|p|other'].forEach(d => r5Tap(P, d));
  P.sim.text(sister, '50000');                    // paid now: the buyer is asked, then the day
  P.sim.text(sister, 'ဒေါ်မြင့်');
  r5Tap(P, 'SS|S1-0002|d|14');
  r5Tap(P, 'SC|S1-0002|ok');
  const entry = P.outbox[0] || {}, txs = entry.txs || [], sales = txs.filter(t => t.type === 'SALE');
  check(P.outbox.length === 1 && entry.kind === 'group' && same3(txs.map(t => t.type), ['SALE', 'SALE', 'SALE', 'PAYMENT']) && same3(txs.map(t => t.itemId), ['S1-0002', 'S1-0005', 'S1-0001', 'S1-0002']) &&
    same3(txs.map(t => t.cash), [36000, 4000, 0, 10000]) && same3(txs.map(t => t.dueDay), [D, D, D, '']) && txs.every(t => t.customerId === 'C-0001' && t.groupId === entry.groupId) &&
    txs[3].method === 'KBZ' && txs[3].amount === 10000 && txs[3].refGroupId === entry.groupId,
    'offline: ONE outbox group [SALE, SALE, SALE, PAYMENT], cash 36,000 / 4,000 / 0 then 10,000 KBZ, the day on the three SALE rows only, ဒေါ်မြင့် on all four', txs.map(t => [t.type, t.itemId, t.cash, t.dueDay, t.customerId]));
  check(sales.length === 3 && !!sales[0].receiptNo && sales.every(t => t.receiptNo === sales[0].receiptNo) && !txs[3].receiptNo && P.meta.receiptCounter === counter0 + 1,
    'the three SALE rows carry ONE receipt number and the PAYMENT none; the phone\'s counter grew by one (spec 3.5)', { receipts: txs.map(t => t.receiptNo || ''), counter: [counter0, P.meta.receiptCounter] });
  P.online = true;
  const pr = spyOn(P, s);
  const r = P.syncNow();
  const res = resultOf(lastPush(pr), entry.entryId), srv = txs.map(t => rowsIn(w, t.txId)[0] || {});
  check(r.ok && r.acked === 1 && r.quarantined.length === 0 && r.flagged.length === 0 && res.status === 'ok' && same3(res.flags, []) && srv.every(x => typeof x.seq === 'number') &&
    srv.every((x, i) => i === 0 || x.seq === srv[i - 1].seq + 1) && srv.every(x => x.groupId === entry.groupId),
    'pushed: ok with no flag (no OVERPAID: the PAYMENT comes after the three SALE rows); the four rows are on the server in order with consecutive Seq', { res, seq: srv.map(x => x.seq) });
  const info = saleGroupInfo(w.ports, entry.groupId), credits = openCredits(w.ports, null).filter(c => c.groupId === entry.groupId);
  check(credits.length === 1 && credits[0].item === basketName(w.ports, info) && credits[0].dueDay === D && credits[0].owed === 33000 && info.owed === 33000,
    'the server\'s openCredits gives ONE entry for the basket: named by basketName, with the day, owing 33,000', credits);
  r5Tap(P, 'U|' + entry.groupId);
  const undo = P.outbox[P.outbox.length - 1] || {};
  const r2 = P.syncNow();
  check(undo.kind === 'group' && undo.txs.length === 4 && undo.txs.every(t => !!t.reversesTxId) && r2.ok && r2.quarantined.length === 0 && P.outbox.length === 0 &&
    liveRows(w.ledger.filter(x => x.groupId === entry.groupId), w.ledger).length === 0 && same3(r6Net(w, 'S1', today), before) && saleGroupInfo(w.ports, entry.groupId).owed === 0 &&
    same3(ids.map(id => s.stock(id)), stock0) && openCredits(w.ports, null).filter(c => c.groupId === entry.groupId).length === 0,
    'the undo (four mirrors in one group) is ok too: nothing live, CASH and KBZ back where they were, the three stocks back, no credit left', { nets: r6Net(w, 'S1', today), before });
}

step('R6b. A counted new piece on the reference phone (the Telegram card, count 3, price pending): [item, group, notice]; the server\'s item is SKU with stock 3; the owner is asked for the price');
{
  const { w, s } = r6FormWorld(true);
  const P = phoneOf(s, w, sister, 'R6b new piece');
  P.online = false;
  P.sim.start(sister, 'S1-0007');
  P.sim.photo(sister, SIM_PHOTOS[0]);
  ['P|S1-0007|pending', 'NI|S1-0007|q|+', 'NI|S1-0007|q|+', 'NC|S1-0007|ok'].forEach(d => r5Tap(P, d));
  const kinds = P.outbox.map(e => e.kind), item = P.outbox.find(e => e.kind === 'item') || {}, grp = P.outbox.find(e => e.kind === 'group') || { txs: [] };
  check(same3(kinds, ['item', 'group', 'notice']) && item.fields.type === 'SKU' && item.fields.name === itemPlaceholderName('S1-0007') && item.fields.price === '' &&
    grp.txs.length === 1 && grp.txs[0].type === 'RESTOCK' && grp.txs[0].qty === 3 && grp.txs[0].note === 'new item' && P.stockOf('S1-0007') === 3,
    'offline: the outbox is [item, group, notice]: SKU named by its placeholder, price pending, ONE RESTOCK of 3 noted new item', { kinds, fields: item.fields });
  P.online = true;
  const pings0 = r6Owner(w).length;
  const r = P.syncNow();
  const sv = w.ports.store.getItem('S1-0007'), ping = r6Owner(w).slice(pings0).find(m => m.text === t(w.ports, 'price_ask_owner', { id: 'S1-0007', name: itemPlaceholderName('S1-0007') }));
  check(r.ok && r.acked === 3 && r.quarantined.length === 0 && sv.type === 'SKU' && sv.status === 'ACTIVE' && s.stock('S1-0007') === 3 && sv.price === '',
    'pushed: three entries acked, nothing quarantined; the server\'s item is an ACTIVE SKU with stock 3 and no price', { r: [r.acked, r.quarantined], sv });
  check(!!ping && ping.keyboard.length > 0 && ping.keyboard[0].every(b => /^SP\|S1-0007\|\d+$/.test(b.callback_data)),
    'the owner\'s Telegram gets price_ask_owner with the SP| price buttons (the notice relayed)', r6Owner(w).slice(pings0).map(m => m.text));
}

step('R6c. (pin) Another shop in a group: a hand-built group from a shop-1 phone with a shop-2 SALE row is quarantined scope (why basketAddItem refuses a piece of the other shop)');
{
  const { w, s } = r6FormWorld(false);
  const P = phoneOf(s, w, sister, 'R6c scope');
  const g = 'g-r6c', day = dayKey(P.now());
  const tx = (id, item, shop) => ({ txId: id, groupId: g, type: 'SALE', shop, time: P.now().toISOString(), day, itemId: item, qty: -1, amount: 18000, cash: 18000, unitPrice: 18000, costAtSale: '', staffId: '1001', method: 'CASH', note: '', source: 'BUTTON', customerId: '', refGroupId: '', reversesTxId: '' });
  const rows0 = w.ledger.length;
  const res = resultOf(pushAs(s, P, [{ kind: 'group', entryId: 'e-r6c', groupId: g, txs: [tx('t-r6c-1', 'S1-0002', 'S1'), tx('t-r6c-2', 'S2-0002', 'S2')] }]).push, 'e-r6c');
  check(res.status === 'quarantined' && res.reason === 'scope' && w.ledger.length === rows0, 'the group is quarantined scope and nothing of it is written (a pin of today\'s server)', res);
}

step('R6d. The alias: the server\'s steps reaches the phone as form; QUICK with a trailing space as quick');
{
  const { w, s } = r6FormWorld(false);
  const P = phoneOf(s, w, sister, 'R6d alias');
  w.settings.sale_flow = 'steps';
  const r1 = P.syncNow();
  const f1 = saleFlow(P.ports);
  w.settings.sale_flow = 'QUICK ';
  const r2 = P.syncNow();
  check(r1.ok && P.settings.sale_flow === 'QUICK ' && saleFlow(P.ports) === 'quick' && f1 === 'form' && r2.ok, 'steps on the server reads form on the phone; "QUICK " reads quick', { f1, f2: saleFlow(P.ports) });
}

step('R6e. The photo AI\'s late rename (spec 6.2, M1): the job waits for its item entry, the server renames in one write, the phone\'s replay is a dup; no conflict, no ping; a typed name and a chosen category stay');
{
  const { w, s } = r6FormWorld(true);
  const P = phoneOf(s, w, sister, 'R6e rename');
  const register = (id, extra) => {
    P.sim.start(sister, id);
    P.sim.photo(sister, SIM_PHOTOS[0]);
    (extra || []).forEach(a => (typeof a === 'string' ? r5Tap(P, a) : P.sim.text(sister, a.type)));
    ['P|' + id + '|25000', 'NC|' + id + '|ok'].forEach(d => r5Tap(P, d));
  };
  P.online = false;
  register('S1-0007');
  const job = P.aiQueue.find(j => j.kind === 'photo' && j.itemId === 'S1-0007') || {};
  check(job.status === 'queued' && P.ports.store.getItem('S1-0007').name === itemPlaceholderName('S1-0007') && P.outbox.some(e => e.kind === 'item' && e.id === 'S1-0007'),
    'offline: the piece is saved with its placeholder name and the photo job is queued; its item entry waits in the outbox', { job: job.status, kinds: P.outbox.map(e => e.kind) });
  P.online = true;
  const calls0 = s.aiCalls;
  const held = P.applyAiResults();
  check(held.length === 0 && s.aiCalls === calls0 && job.status === 'queued', 'applyAiResults while the item entry is still in the outbox sends no ai call and the job stays queued (M1)', { held: held.length, calls: s.aiCalls - calls0 });
  // Step-2 checker: the hold is the photo job's alone; a voice job queued while that item entry still waits is sent.
  P.sim.voice(sister, 'ဟယ်လို');
  const voice = P.aiQueue.find(j => j.kind === 'voice') || {};
  const sent = P.applyAiResults();
  check(voice.status === 'done' && sent.length === 1 && sent[0] === voice && s.aiCalls === calls0 + 1 && job.status === 'queued' && P.outbox.some(e => e.kind === 'item' && e.id === 'S1-0007'),
    'a voice job queued while that item entry still waits is sent at once (a voice or text job is never held); the photo job stays queued', { voice: voice.status, sent: sent.map(j => j.kind), photo: job.status });
  const errs0 = w.errors.length, pings0 = r6Owner(w).length;
  const r1 = P.syncNow();
  const rev1 = w.ports.store.getItem('S1-0007').rev;
  const pr = spyOn(P, s);
  const done = P.applyAiResults();
  const sv = w.ports.store.getItem('S1-0007');
  check(r1.ok && done.length === 1 && sv.name === SIM_PHOTOS[0].name && sv.category === SIM_PHOTOS[0].category && sv.photoUrl === 'drive://POS Photos/S1-0007.jpg' && sv.rev === rev1 + 1,
    'pushed first, then the job: the server\'s item has the AI name, its category and the Drive URL after the job alone (one Rev bump)', { sv: [sv.name, sv.category, sv.photoUrl, sv.rev], rev1 });
  const replay = P.outbox.find(e => e.kind === 'item' && e.id === 'S1-0007') || {};
  const r2 = P.syncNow();
  const rr = resultOf(lastPush(pr), replay.entryId);
  check(same3(replay.fields, { name: SIM_PHOTOS[0].name, category: SIM_PHOTOS[0].category }) && r2.ok && rr.status === 'dup' && P.outbox.length === 0 &&
    P.ports.store.getItem('S1-0007').photoUrl === sv.photoUrl && w.ports.store.getItem('S1-0007').photoUrl === sv.photoUrl,
    'the phone renamed by the same rule; its item entry is answered dup, and after the pull both hold the Drive URL', { fields: replay.fields, rr });
  const conflictHead = msgTemplate(w.ports, 'ping_conflict').replace('{id}', 'S1-0007').split(' {field}')[0];
  check(!w.errors.slice(errs0).some(e => e.where === 'sync_conflict') && !r6Owner(w).slice(pings0).some(m => (m.text || '').indexOf(conflictHead) >= 0),
    'no sync_conflict in the Errors tab and no conflict ping in the owner\'s chat', { errors: w.errors.slice(errs0).map(e => e.where), pings: r6Owner(w).slice(pings0).map(m => m.text) });
  // A typed name is never replaced; a chosen category other than the catch-all stays while the placeholder name is renamed.
  P.online = false;
  register('S1-0008', ['NI|S1-0008|n', { type: 'ထမီ ကျွန်မ' }]);
  const cat = CFG.CATEGORIES.indexOf('လုံချည်');
  register('S1-0009', ['NI|S1-0009|c', 'NI|S1-0009|c|' + cat]);
  P.online = true;
  P.syncNow();
  P.applyAiResults();
  P.syncNow();
  const a = w.ports.store.getItem('S1-0008'), b = w.ports.store.getItem('S1-0009'), pa = P.ports.store.getItem('S1-0008'), pb = P.ports.store.getItem('S1-0009');
  check(a.name === 'ထမီ ကျွန်မ' && pa.name === 'ထမီ ကျွန်မ' && a.photoUrl === 'drive://POS Photos/S1-0008.jpg' && b.name === SIM_PHOTOS[0].name && b.category === 'လုံချည်' && pb.category === 'လုံချည်' &&
    P.outbox.length === 0 && !w.errors.slice(errs0).some(e => /sync_conflict/.test(e.where + ' ' + e.message)),
    'a typed name is never replaced (only the Drive URL is written); a chosen category other than အခြား stays while the placeholder name becomes the AI name', { a: [a.name, a.photoUrl], b: [b.name, b.category] });
}

step('R6f. A stock_negative flag on a stock item pings ping_stock_short with no button; a one-of-a-kind piece keeps ping_stock_negative and its void button');
{
  const { w, s } = r6FormWorld(true);
  const P = phoneOf(s, w, sister, 'R6f over'), Q = phoneOf(s, w, sister, 'R6f second');
  const have = s.stock('S1-0002');
  P.online = false;
  commitBasket(P.ports, { lines: [{ item: P.ports.store.getItem('S1-0002'), qty: have + 1 }, { item: P.ports.store.getItem('S1-0005'), qty: 1 }], staff: P.meta.staff, source: 'BUTTON' });
  const g = P.outbox[0].groupId;
  P.online = true;
  const pings0 = r6Owner(w).length;
  const r = P.syncNow();
  const ping = r6Owner(w).slice(pings0).pop() || {}, it = w.ports.store.getItem('S1-0002');
  check(r.ok && r.flagged.length === 1 && r.flagged[0].flags[0].kind === SYNC.FLAG.STOCK_NEGATIVE && ping.text === t(w.ports, 'ping_stock_short', { name: it.name, id: 'S1-0002', stock: fmtCount(-1) }) &&
    (ping.keyboard || []).length === 0 && liveRows(w.ledger.filter(x => x.groupId === g), w.ledger).length === 2,
    'a basket line one over the stock of a stock item: accepted and flagged; the owner reads ping_stock_short (a restock may be missing) with no button; the basket stays', { text: ping.text, kb: ping.keyboard });
  P.online = false; Q.online = false;
  [P, Q].forEach(X => commitBasket(X.ports, { lines: [{ item: X.ports.store.getItem('S1-0001'), qty: 1 }], staff: X.meta.staff, source: 'BUTTON' }));
  P.online = true; Q.online = true;
  P.syncNow();
  const pings1 = r6Owner(w).length;
  const rq = Q.syncNow();
  const ping2 = r6Owner(w).slice(pings1).pop() || {}, gq = rq.flagged.length ? rq.flagged[0].entry.groupId : '';
  check(rq.ok && rq.flagged.length === 1 && ping2.text === t(w.ports, 'ping_stock_negative', { name: w.ports.store.getItem('S1-0001').name, id: 'S1-0001', stock: fmtCount(-1) }) &&
    same3(((ping2.keyboard || [])[0] || []).map(b => b.callback_data), ['V|' + gq]),
    'a one-of-a-kind piece sold on two phones: the owner reads ping_stock_negative with the V| void button, as before', { text: ping2.text, kb: ping2.keyboard });
}

step('R6g. The setting entry (13.12): the owner\'s offline edit, ok / dup, the second phone\'s pull, staff and malformed, the AI switch, the re-apply, an older server, a store without setSetting');
{
  const { w, s } = r6FormWorld(false);
  const O6 = phoneOf(s, w, owner, 'R6g owner'), Q = phoneOf(s, w, sister, 'R6g second'), S6 = phoneOf(s, w, sister, 'R6g seller');
  const NAME = 'ဆိုင် ၁ (ရန်ကုန် · ဗိုလ်ချုပ်လမ်း)';
  O6.online = false;
  const e1 = O6.local.setSettingLocal('shop_name_S1', NAME);
  check(O6.settings.shop_name_S1 === NAME && shopName(O6.ports, 'S1') === NAME && O6.outbox.length === 1 && same3(O6.outbox[0], e1) && e1.kind === 'setting' && e1.key === 'shop_name_S1' && e1.value === NAME && !!e1.entryId,
    'offline: the owner\'s phone shows the new shop name at once and queues ONE {kind: setting, key, value} entry', O6.outbox);
  O6.online = true;
  const pr = spyOn(O6, s);
  const r1 = O6.syncNow();
  check(r1.ok && resultOf(lastPush(pr), e1.entryId).status === 'ok' && resultOf(lastPush(pr), e1.entryId).kind === 'setting' && w.settings.shop_name_S1 === NAME && O6.outbox.length === 0 && shopName(w.ports, 'S1') === NAME,
    'pushed: ok, and the server\'s Settings hold it (the bot names the shop so at its next tap)', resultOf(lastPush(pr), e1.entryId));
  const rq = Q.syncNow();
  check(rq.ok && Q.settings.shop_name_S1 === NAME && shopName(Q.ports, 'S1') === NAME, 'a second phone\'s next pull carries it', Q.settings.shop_name_S1);
  const dup = resultOf(pushAs(s, O6, [{ kind: 'setting', entryId: 'r6g-dup', key: 'shop_name_S1', value: NAME }]).push, 'r6g-dup');
  check(dup.status === 'dup' && w.settings.shop_name_S1 === NAME, 'the same value again is a dup', dup);
  // Every shop of CFG.SHOP_IDS (F10b): its name, address and phone go through the same entry.
  const each = [];
  CFG.SHOP_IDS.forEach((id, i) => ['name', 'address', 'phone'].forEach(f => each.push({ kind: 'setting', entryId: 'r6g-' + f + '-' + id, key: 'shop_' + f + '_' + id, value: (f === 'phone' ? '09' : f + ' ') + (i + 7) + '0' + (i + 1) })));
  const all = pushAs(s, O6, each).push;
  check(each.length === 3 * CFG.SHOP_IDS.length && each.every(e => resultOf(all, e.entryId).status === 'ok' && w.settings[e.key] === e.value),
    'the name, address and phone of every shop in CFG.SHOP_IDS are written by the owner\'s entries (' + each.length + ' keys)', each.map(e => [e.key, resultOf(all, e.entryId).status]));
  // A seller's entry is quarantined staff; the seller's phone gets the server's value back.
  const before6 = w.settings.shop_name_S2;
  const se = S6.local.setSettingLocal('shop_name_S2', 'ငါ့ဆိုင်');
  const ps = spyOn(S6, s);
  const rs = S6.syncNow();
  const rs2 = S6.syncNow();
  check(rs.ok && resultOf(lastPush(ps), se.entryId).status === 'quarantined' && resultOf(lastPush(ps), se.entryId).reason === 'staff' && w.settings.shop_name_S2 === before6 &&
    S6.outbox.length === 0 && rs2.ok && S6.settings.shop_name_S2 === before6,
    'a seller\'s setting is quarantined staff and never written; it leaves the phone and the next pull brings the server\'s value back', { res: resultOf(lastPush(ps), se.entryId), local: S6.settings.shop_name_S2 });
  const bad = pushAs(s, O6, [{ kind: 'setting', entryId: 'b1', key: 'shop_brand_S1', value: 'x' }, { kind: 'setting', entryId: 'b2', key: 'shop_name_S1', value: 'n'.repeat(CFG.SHOP_TEXT_MAX.name + 1) },
    { kind: 'setting', entryId: 'b3', key: 'ai', value: 'maybe' }, { kind: 'setting', entryId: 'b4', key: 'shop_name_S1', value: '  ' }]).push;
  check(['b1', 'b2', 'b3', 'b4'].every(id => resultOf(bad, id).status === 'quarantined' && resultOf(bad, id).reason === 'malformed') && w.settings.shop_name_S1 === each[0].value && !('shop_brand_S1' in w.settings && w.settings.shop_brand_S1 === 'x'),
    'an unknown key (a brand), a 41-character name, ai = maybe and a blank name are malformed; nothing is written', ['b1', 'b2', 'b3', 'b4'].map(id => resultOf(bad, id).reason));
  // The AI switch: FALSE from the owner reaches every phone at its next pull.
  check(aiOn(Q.ports), 'before: the second phone reads AI on (no ai row)');
  const ea = O6.local.setSettingLocal('ai', 'FALSE');
  check(!aiOn(O6.ports) && aiOn(Q.ports), 'the owner\'s phone reads AI off at once, before any sync');
  const pa = spyOn(O6, s);
  O6.syncNow();
  Q.syncNow();
  check(resultOf(lastPush(pa), ea.entryId).status === 'ok' && w.settings.ai === 'FALSE' && !aiOn(w.ports) && Q.settings.ai === 'FALSE' && !aiOn(Q.ports),
    'ai = FALSE from the owner is ok; the server and the second phone read AI off after its pull', { server: w.settings.ai, second: Q.settings.ai });
  w.settings.ai = 'true';
  const tc = resultOf(pushAs(s, O6, [{ kind: 'setting', entryId: 'r6g-case', key: 'ai', value: 'TRUE' }]).push, 'r6g-case');
  check(tc.status === 'dup' && w.settings.ai === 'true', 'a stored "true" meets TRUE as a dup (compared as text without case)', tc);
  // The re-apply: a pull that comes before the push (the earlier batch's reply was lost) keeps the local value.
  commitBasket(O6.ports, { lines: [{ item: O6.ports.store.getItem('S1-0003'), qty: 1 }], staff: O6.meta.staff, source: 'BUTTON' });
  s.dropResponse = true;
  const lost = O6.syncNow();
  O6.local.setSettingLocal('shop_address_S1', 'အမှတ် ၁၂၃ ဗိုလ်ချုပ်လမ်း');
  w.settings.summary_hour = 20;                         // the Sheet changes meanwhile: the next pull carries the Settings
  const rp = O6.syncNow();
  check(!lost.ok && rp.ok && rp.entries === 1 && O6.settings.summary_hour === 20 && O6.settings.shop_address_S1 === 'အမှတ် ၁၂၃ ဗိုလ်ချုပ်လမ်း' && O6.outbox.some(e => e.kind === 'setting') &&
    w.settings.shop_address_S1 !== 'အမှတ် ၁၂၃ ဗိုလ်ချုပ်လမ်း',
    'a pull made while the entry waits replaces the Settings map, and the phone still shows its own address (the re-apply)', { local: O6.settings.shop_address_S1, server: w.settings.shop_address_S1 });
  const rp2 = O6.syncNow();
  check(rp2.ok && O6.outbox.length === 0 && w.settings.shop_address_S1 === 'အမှတ် ၁၂၃ ဗိုလ်ချုပ်လမ်း', 'the next sync pushes it');
  // An older server (setting not among its kinds, as M9 builds one): bad_kind without kindKnown, the entry stays.
  const OLD_KINDS = { customer: 1, item: 2, list: 3, group: 4, measurement: 5, notice: 6, error: 7 };
  let rolled = true;
  O6.transport = (api, body) => {
    const kinds = SYNC.ENTRY_KINDS;
    if (rolled) SYNC.ENTRY_KINDS = OLD_KINDS;
    try { const x = s.handle(api, JSON.parse(JSON.stringify(body))); return x === null ? null : JSON.parse(JSON.stringify(x)); } finally { SYNC.ENTRY_KINDS = kinds; }
  };
  const eo = O6.local.setSettingLocal('shop_phone_S1', '09 123 456 789');
  const q0 = s.quarantine.length;
  const ro = O6.syncNow();
  check(ro.ok && ro.quarantined.length === 0 && s.quarantine.length === q0 + 1 && s.quarantine[q0].reason === 'bad_kind' && O6.outbox.length === 1 && O6.outbox[0].entryId === eo.entryId &&
    O6.settings.shop_phone_S1 === '09 123 456 789' && w.settings.shop_phone_S1 !== '09 123 456 789',
    'an older server answers bad_kind without kindKnown: the entry stays in the outbox and the phone keeps showing its value', { outbox: O6.outbox.map(e => e.kind), q: s.quarantine.slice(q0).map(x => x.reason) });
  rolled = false;
  O6.syncNow();
  check(O6.outbox.length === 0 && w.settings.shop_phone_S1 === '09 123 456 789', 'once the server knows the kind the entry goes in');
  // A server store without setSetting: bad_kind WITH kindKnown, final; the entry is dropped and the settings hash cleared.
  const fwd = s.ports.store.setSetting;
  delete s.ports.store.setSetting;
  const ek = O6.local.setSettingLocal('shop_address_S2', 'မန္တလေး ၃၅ လမ်း');
  const pk = spyOn(O6, s);
  const rk = O6.syncNow();
  const hashAfter = O6.meta.cursor.settingsHash;
  s.ports.store.setSetting = fwd;
  const rk2 = O6.syncNow();
  check(rk.ok && resultOf(lastPush(pk), ek.entryId).reason === 'bad_kind' && resultOf(lastPush(pk), ek.entryId).kindKnown === true && O6.outbox.length === 0 && hashAfter === '' &&
    rk2.ok && O6.settings.shop_address_S2 === w.settings.shop_address_S2 && w.settings.shop_address_S2 !== 'မန္တလေး ၃၅ လမ်း',
    'a store without setSetting answers bad_kind with kindKnown: the entry is dropped, the settings hash cleared, and the next pull brings the server\'s value back', { res: resultOf(lastPush(pk), ek.entryId), hashAfter });
}

step('R6h. A drawing on the wire (13.7): a session with a sketch is stored and pulled with it; one without is pulled without the key; the sketch\'s limits; the note keeps 300 characters');
{
  const { w, s } = r6FormWorld(false);
  const P = phoneOf(s, w, sister, 'R6h meas'), Q = phoneOf(s, w, sister, 'R6h second');
  const C1 = w.customers[0].id, C2 = w.customers[1].id, SK = '1F:AAEC.BQYHCQo';
  P.online = false;
  const saved = P.local.saveMeasurementLocal({ customerId: C1, notes: '', fields: { neck: '14', note: 'ပခုံး နိမ့်' }, sketch: SK });
  const plainSave = P.local.saveMeasurementLocal({ customerId: C2, notes: '', fields: { neck: '13' } });
  const ent = P.outbox.filter(e => e.kind === 'measurement');
  check(ent.length === 2 && ent[0].rec.sketch === SK && !('sketch' in ent[1].rec) && P.measurements[C1].sketch === SK && !('sketch' in P.measurements[C2]) && saved.sketch === SK &&
    saved.entryId === ent[0].entryId && plainSave.entryId === ent[1].entryId,
    'the reference phone keeps the drawing in its record and its entry (only when there is one); the saved copy names its outbox entry', { recs: ent.map(e => Object.keys(e.rec)), entryIds: [saved.entryId, plainSave.entryId] });
  P.online = true;
  const r = P.syncNow();
  const m1 = latestMeasurement(w.ports, C1), m2 = latestMeasurement(w.ports, C2);
  check(r.ok && r.quarantined.length === 0 && m1 && m1.sketch === SK && m1.entryId === ent[0].entryId && m2 && !m2.sketch && m1.fields.note === 'ပခုံး နိမ့်',
    'pushed: both sessions are stored, the first with its sketch and entry id, the second without one', { m1: m1 && m1.sketch, m2: m2 && m2.sketch });
  const rq = Q.syncNow();
  check(rq.ok && Q.measurements[C1] && Q.measurements[C1].sketch === SK && Q.measurements[C2] && !('sketch' in Q.measurements[C2]),
    'a second phone pulls the first session with its sketch and the second without the key', { c1: Q.measurements[C1], c2: Q.measurements[C2] });
  const rec = x => Object.assign({ customerId: C1, orderId: '', day: dayKey(P.now()), staffId: '1001', source: 'FORM', notes: '', fields: { neck: '15' } }, x);
  const res = pushAs(s, P, [
    { kind: 'measurement', entryId: 'h1', rec: rec({ sketch: '1F:' + 'A'.repeat(SYNC.MEAS_SKETCH_MAX - 2) }) },
    { kind: 'measurement', entryId: 'h2', rec: rec({ sketch: '2F:AAEC' }) },
    { kind: 'measurement', entryId: 'h3', rec: rec({ sketch: 12 }) },
    { kind: 'measurement', entryId: 'h4', rec: rec({ fields: { note: 'n'.repeat(CFG.MEAS_NOTE_MAX) } }) },
    { kind: 'measurement', entryId: 'h5', rec: rec({ fields: { note: 'n'.repeat(CFG.MEAS_NOTE_MAX + 1) } }) },
    { kind: 'measurement', entryId: 'h6', rec: rec({ fields: { neck: 'n'.repeat(SYNC.MEAS_VALUE_MAX + 1) } }) },
    { kind: 'measurement', entryId: 'h7', rec: rec({ sketch: '1M:' + 'A'.repeat(SYNC.MEAS_SKETCH_MAX - 3), fields: { neck: '16' } }) }
  ]).push;
  const why = id => resultOf(res, id).status === 'quarantined' ? resultOf(res, id).reason : resultOf(res, id).status;
  check(why('h1') === 'malformed' && why('h2') === 'malformed' && why('h3') === 'malformed' && why('h4') === 'ok' && why('h5') === 'malformed' && why('h6') === 'malformed' && why('h7') === 'ok',
    'a sketch of 4,001 characters, a bad pattern and a number are malformed; a note of 300 characters is accepted and 301 refused; neck keeps its 60; a sketch of exactly 4,000 passes', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'].map(why));
}

step('R6i. Jobs on the server twin (13.7.2, 13.11): the drawing\'s picture, a photo without AI, the AI switch');
{
  const { w, s } = r6FormWorld(false);
  const P = phoneOf(s, w, sister, 'R6i jobs');
  const C1 = w.customers[0].id;
  P.local.saveMeasurementLocal({ customerId: C1, notes: '', fields: { neck: '14' }, sketch: '1F:AAEC' });
  const eid = P.outbox[0].entryId;
  P.syncNow();
  const meas = latestMeasurement(w.ports, C1);
  let hookCalls = 0, described = 0;
  const realHook = s.hooks.ai, realDescribe = global.mockDescribePhoto;
  s.hooks.ai = function (job, device) { hookCalls++; return realHook.call(this, job, device); };
  global.mockDescribePhoto = function (file, ctx) { described++; return realDescribe(file, ctx); };
  let n = 0;
  const job = j => s.handle('ai', Object.assign(credsOf(P), { job: Object.assign({ id: 'r6i-' + (++n), createdAt: P.now().toISOString() }, j) })).job;
  try {
    const errs0 = w.errors.length;
    const sk = job({ kind: 'sketch', entryId: eid, mime: 'image/png', data: 'iVBORw0KGgo' });
    const stored = latestMeasurement(w.ports, C1);
    check(sk.status === 'done' && sk.photoUrl === 'sim://figure/' + meas.id && stored.photoUrl === sk.photoUrl && stored.id === meas.id && s.aiJobs[sk.id] && s.aiJobs[sk.id].status === 'done',
      'a sketch job for a stored session sets that session\'s photoUrl and answers done with it (cached as done)', { sk, photoUrl: stored.photoUrl });
    const ns = job({ kind: 'sketch', entryId: 'not-an-entry', mime: 'image/png', data: 'x' });
    check(ns.status === 'failed' && ns.error === 'no_session' && w.errors.length === errs0, 'a sketch job whose entry the server has not got answers failed no_session and writes no Errors row (the phone tries again)', { ns, errors: w.errors.slice(errs0) });
    w.settings.ai = 'FALSE';
    const h0 = hookCalls, d0 = described;
    const ph = job({ kind: 'photo', itemId: 'S1-0002', sim: SIM_PHOTOS[0] });
    const sk2 = job({ kind: 'sketch', entryId: eid, mime: 'image/png', data: 'x' });
    check(ph.status === 'failed' && ph.error === 'ai_off' && hookCalls === h0 + 1 && sk2.status === 'done' && described === d0,
      'with ai FALSE a photo job answers failed ai_off without calling the hook, while a sketch job still runs', { ph, hook: hookCalls - h0 });
    const rev0 = w.ports.store.getItem('S1-0003').rev, calls0 = s.aiCalls;
    const pic = job({ kind: 'pic', itemId: 'S1-0003', mime: 'image/jpeg', data: '/9j/4AAQ' });
    const it = w.ports.store.getItem('S1-0003');
    check(pic.status === 'done' && pic.photoUrl === 'sim://photo/S1-0003' && it.photoUrl === pic.photoUrl && it.rev === rev0 + 1 && described === d0 && s.aiCalls === calls0,
      'a pic job (AI off) for a stored item sets its photoUrl (one Rev bump) and answers done with it, with no describe call and no AI call', { pic, photoUrl: it.photoUrl, described: described - d0 });
    const ni = job({ kind: 'pic', itemId: 'S1-9999', mime: 'image/jpeg', data: 'x' });
    check(ni.status === 'failed' && ni.error === 'no_item' && w.errors.length === errs0, 'a pic job for an unknown item answers failed no_item and writes no Errors row', { ni, errors: w.errors.slice(errs0).map(e => e.where) });
    w.settings.ai = 'TRUE';
    w.aiFail = true;
    const sk3 = job({ kind: 'sketch', entryId: eid, mime: 'image/png', data: 'x' }), ph2 = job({ kind: 'photo', itemId: 'S1-0002', sim: SIM_PHOTOS[0] });
    w.aiFail = false;
    check(sk3.status === 'done' && ph2.status === 'failed' && w.errors.slice(errs0).length === 1 && w.errors[w.errors.length - 1].where === 'ai',
      'a Gemini outage fails the photo job (one Errors row, as before) and not the sketch job, which calls no AI', { sk3: sk3.status, ph2: ph2.status });
  } finally {
    s.hooks.ai = realHook;
    global.mockDescribePhoto = realDescribe;
  }
}

step('R6j. A new piece undone after its photo went up (review r6, the false conflict): the photo job\'s answer gives the Rev before and after its write; the phone whose Rev was the one before takes the new one, so the undo carries no stale base; no sync_conflict, no owner ping');
{
  const { w, s } = r6FormWorld(true);
  const P = phoneOf(s, w, sister, 'R6j undo'), Q = phoneOf(s, w, owner, 'R6j owner');
  const register = id => {                       // with a photo and a typed name: the AI has nothing to rename
    P.sim.start(sister, id);
    P.sim.photo(sister, SIM_PHOTOS[0]);
    r5Tap(P, 'NI|' + id + '|n');
    P.sim.text(sister, 'ထမီ စိမ်း');
    ['P|' + id + '|25000', 'NC|' + id + '|ok'].forEach(d => r5Tap(P, d));
    const card = P.sim.lastBot();
    return { card, undo: ((((card.keyboard || [])[0] || [])[0]) || {}).callback_data || '' };
  };
  const a = register('S1-0007');
  const r1 = P.syncNow();
  const rev1 = w.ports.store.getItem('S1-0007').rev, mine1 = P.ports.store.getItem('S1-0007').rev;
  const pr = spyOn(P, s);
  const done = P.applyAiResults();
  const ans = ((pr.filter(x => x.api === 'ai').pop() || {}).r || {}).job || {}, sv = w.ports.store.getItem('S1-0007');
  check(r1.ok && mine1 === rev1 && done.length === 1 && ans.itemRevWas === rev1 && ans.itemRev === sv.rev && sv.rev > rev1 && sv.name === 'ထမီ စိမ်း' &&
    P.ports.store.getItem('S1-0007').rev === sv.rev && P.outbox.length === 0,
    'synced, then the photo job: its answer gives itemRevWas (the phone\'s own Rev) and itemRev (after the Drive URL); the phone takes itemRev and queues nothing', { rev1, mine1, ans: [ans.itemRevWas, ans.itemRev], server: sv.rev, phone: P.ports.store.getItem('S1-0007').rev });
  const errs0 = w.errors.length, pings0 = r6Owner(w).length;
  P.sim.tap(sister, a.card.id, a.undo);
  const ie = P.outbox.find(e => e.kind === 'item' && e.id === 'S1-0007') || {};
  const r2 = P.syncNow();
  check(/^U\|/.test(a.undo) && ie.baseRev === sv.rev && r2.ok && r2.quarantined.length === 0 && P.outbox.length === 0 && w.ports.store.getItem('S1-0007').name === '' &&
    !w.errors.slice(errs0).some(e => e.where === 'sync_conflict') && r6Owner(w).slice(pings0).length === 0,
    'the seller\'s undo of the piece carries that Rev: the piece is blank again on the server, no sync_conflict in the Errors tab, no ping in the owner\'s chat', { undo: a.undo, baseRev: ie.baseRev, errors: w.errors.slice(errs0).map(e => e.where + ': ' + e.message), pings: r6Owner(w).slice(pings0).map(m => m.text) });
  // Guard: another phone changed the piece between this phone's sync and its photo job. itemRevWas is then not this phone's
  // Rev, so it keeps its own, and the undo's real conflict still reaches the Errors tab and the owner.
  const b = register('S1-0008');
  P.syncNow();
  const base2 = w.ports.store.getItem('S1-0008').rev;
  const qr = resultOf(pushAs(s, Q, [{ kind: 'item', entryId: 'e-r6j-q', id: 'S1-0008', fields: { price: 30000 }, baseRev: base2 }]).push, 'e-r6j-q');
  P.applyAiResults();
  const mine2 = P.ports.store.getItem('S1-0008').rev, errs1 = w.errors.length, pings1 = r6Owner(w).length;
  P.sim.tap(sister, b.card.id, b.undo);
  const r3 = P.syncNow();
  check(qr.status === 'ok' && mine2 === base2 && w.ports.store.getItem('S1-0008').rev > base2 + 1 && r3.ok && w.errors.slice(errs1).some(e => e.where === 'sync_conflict') && r6Owner(w).length > pings1,
    'guard: a change from another phone between the sync and the photo job leaves the phone its own Rev (itemRevWas differs); the undo\'s real conflict is still logged and pinged', { qr: qr.status, mine2, base2, errors: w.errors.slice(errs1).map(e => e.where) });
}

step('R6k. A new piece\'s photo job that meets AI off goes up as a pic job (13.11, review r3 M-1; as app_sync.js aiOffJob): on the phone\'s own switch and on the server\'s ai_off answer; any other AI job is skipped; the waiting lines clear');
{
  const id = 'S1-0007', placeholder = itemPlaceholderName(id);
  const aiAsked = replies => replies.filter(x => x.api === 'ai').map(x => (x.r && x.r.job) || {});
  {
    const { w, s } = r6FormWorld(true);
    const O = phoneOf(s, w, owner, 'R6k owner');
    const tapO = d => O.sim.tap(owner, O.sim.lastBot().id, d);
    O.online = false;
    O.sim.start(owner, id);
    O.sim.photo(owner, SIM_PHOTOS[0]);
    ['P|' + id + '|25000', 'NC|' + id + '|ok'].forEach(tapO);
    O.sim.voice(owner, 'ဟယ်လို');
    const photo = O.aiQueue.find(j => j.itemId === id) || {}, voice = O.aiQueue.find(j => j.kind === 'voice') || {};
    const waits0 = O.chat.filter(m => m.pending).length;
    O.local.setSettingLocal('ai', 'FALSE');            // the owner turns the AI off on this phone, still offline
    O.online = true;
    const pr = spyOn(O, s), down = t(O.ports, 'ai_down'), lines0 = O.chat.length;
    const held = O.applyAiResults();
    check(photo.kind === 'pic' && photo.status === 'queued' && same3(photo.ctx, {}) && voice.status === 'skipped' && held.length === 0 && aiAsked(pr).length === 0 &&
      waits0 === 2 && O.chat.filter(m => m.pending).length === 0 && !O.chat.slice(lines0).some(m => (m.text || '').indexOf(down) >= 0),
      'AI off on the phone before its sync: the photo job becomes a pic job (no ctx) and waits for its item entry (M1); the voice job is skipped; no ai call, no ai_down line, and both ⏳ lines clear',
      { photo: [photo.kind, photo.status], voice: voice.status, held: held.length, calls: aiAsked(pr).length, waits: [waits0, O.chat.filter(m => m.pending).length] });
    const aiCalls0 = s.aiCalls;
    const r = O.syncNow(), sent = O.applyAiResults(), sv = w.ports.store.getItem(id);
    check(r.ok && !aiOn(w.ports) && sent.length === 1 && sent[0] === photo && photo.status === 'done' && same3(aiAsked(pr).map(j => [j.id, j.status]), [[photo.id, 'done']]) && s.aiCalls === aiCalls0 &&
      sv.photoUrl === 'sim://photo/' + id && sv.name === placeholder && O.ports.store.getItem(id).name === placeholder && voice.status === 'skipped' && O.outbox.length === 0,
      'after the sync (the item, the switch) the pic job goes once: the server keeps the photo, no AI call is made, the piece keeps its placeholder name; the voice job stays skipped',
      { r: r.ok, sent: sent.length, photo: photo.status, asked: aiAsked(pr).map(j => [j.id, j.status, j.error]), photoUrl: sv.photoUrl, ai: s.aiCalls - aiCalls0 });
  }
  {
    const { w, s } = r6FormWorld(true);
    const P = phoneOf(s, w, sister, 'R6k server');
    P.online = false;
    P.sim.start(sister, id);
    P.sim.photo(sister, SIM_PHOTOS[0]);
    ['P|' + id + '|25000', 'NC|' + id + '|ok'].forEach(d => r5Tap(P, d));
    const card = P.sim.lastBot(), undo = ((((card.keyboard || [])[0] || [])[0]) || {}).callback_data || '';
    const job = P.aiQueue.find(j => j.itemId === id) || {};
    P.online = true;
    const r1 = P.syncNow();                            // the piece is on the server; the phone still reads AI on
    w.settings.ai = 'FALSE';                           // then the owner types FALSE in the Settings tab
    const pr = spyOn(P, s), lines0 = P.chat.length, aiCalls0 = s.aiCalls, rev1 = w.ports.store.getItem(id).rev;
    const done = P.applyAiResults();
    const asked = aiAsked(pr), sv = w.ports.store.getItem(id);
    check(r1.ok && aiOn(P.ports) && done.length === 1 && job.kind === 'pic' && job.status === 'done' && same3(asked.map(j => [j.id, j.status, j.error || '']), [[job.id, 'failed', 'ai_off'], [job.id, 'done', '']]) &&
      sv.photoUrl === 'sim://photo/' + id && s.aiCalls === aiCalls0 && !P.chat.slice(lines0).some(m => (m.text || '').indexOf(t(P.ports, 'ai_down')) >= 0) && P.chat.filter(m => m.pending).length === 0,
      'the server heard of the switch first: its ai_off answer turns the photo job into a pic job, sent again at once with the same id; the server keeps the photo; no AI call, no ai_down line, the ⏳ line clears',
      { done: done.length, job: [job.kind, job.status], asked: asked.map(j => [j.id === job.id, j.status, j.error]), photoUrl: sv.photoUrl });
    const errs0 = w.errors.length, pings0 = r6Owner(w).length;
    P.sim.tap(sister, card.id, undo);
    const r2 = P.syncNow();
    check(sv.rev === rev1 + 1 && /^U\|/.test(undo) && r2.ok && P.outbox.length === 0 && w.ports.store.getItem(id).name === '' &&
      !w.errors.slice(errs0).some(e => e.where === 'sync_conflict') && r6Owner(w).slice(pings0).length === 0,
      'the AI-off case of the review: the pic job\'s write raised the Rev once and its answer gave the phone the new Rev, so the seller\'s undo is clean: no sync_conflict, no owner ping',
      { rev: [rev1, sv.rev], undo, errors: w.errors.slice(errs0).map(e => e.where + ': ' + e.message), pings: r6Owner(w).slice(pings0).map(m => m.text) });
  }
}

/* ---------------- round 6b, step 2 (docs/design-round-6/SPEC-round-6b.md 5.5): an item category from a phone, and the late rename with one ---------------- */
step('R6l. An item category from a phone (round 6b, G2): ➕ on the new-piece card offline reaches the server as a list entry (the five built-ins seeded first) and a second phone; the late rename to a custom category is a dup, also after the owner unticked it (B3)');
{
  const { w, s } = r6FormWorld(false);                 // no Lists rows: the phone and the server each seed item_category themselves
  const P = phoneOf(s, w, sister, 'R6l phone'), Q = phoneOf(s, w, brother, 'R6l second');
  const SILK = 'ပိုးအင်္ကျီ', other = CFG.CATEGORIES[CFG.CATEGORIES.length - 1];
  // A photo whose mock AI answer is the custom category (sim_mock_ai.js reads the preset as the photo's meta).
  const silkPhoto = { key: 'silk_red', name: 'ပိုးအင်္ကျီ အနီ', category: SILK, color: 'အနီ', description: '', visual: { emoji: '👘', bg: '#b71c1c' } };
  const icOf = lj => ((listsJsonParse(lj || '') || {}).item_category || []);
  const serverIc = () => w.lists.filter(r => r.list === 'item_category');
  const conflictOf = (from, id) => { const head = msgTemplate(w.ports, 'ping_conflict').replace('{id}', id).split(' {field}')[0]; return r6Owner(w).slice(from).filter(m => (m.text || '').indexOf(head) >= 0); };
  check(w.lists.length === 0 && !P.settings.lists_json && same3(itemCategoryOptions(P.ports, 'S1').map(r => r.key), CFG.ITEM_CATEGORY_KEYS),
    'a world without Lists rows: the phone offers the five built-in categories (the per-list fallback)', itemCategoryOptions(P.ports, 'S1').map(r => r.key));
  // 1. Offline: a blank tag through the new-piece card, 🏷 → ➕ → the typed name → a price → ✅.
  P.online = false;
  P.sim.start(sister, 'S1-0007');
  P.sim.photo(sister, SIM_PHOTOS[0]);
  ['NI|S1-0007|c', 'LA|ic|NIC|S1-0007'].forEach(d => r5Tap(P, d));
  P.sim.text(sister, SILK);
  const added = itemCategoryOptions(P.ports, 'S1').find(r => r.label === SILK) || {};
  ['P|S1-0007|25000', 'NC|S1-0007|ok'].forEach(d => r5Tap(P, d));
  const listE = P.outbox.find(e => e.kind === 'list') || { rec: {} }, itemE = P.outbox.find(e => e.kind === 'item') || { fields: {} };
  check(/^i[0-9a-f]{4}$/.test(added.key || '') && same3(icOf(P.settings.lists_json).map(c => [c.k, c.l]), CFG.ITEM_CATEGORY_KEYS.map((k, i) => [k, CFG.CATEGORIES[i]]).concat([[added.key, SILK]])) &&
    P.ports.store.getItem('S1-0007').category === SILK,
    'offline: the phone\'s lists_json holds the five built-ins and then the new category (its key i + 4 hex); the piece is saved with it', icOf(P.settings.lists_json).map(c => c.k));
  check(same3(P.outbox.map(e => e.kind), ['list', 'item', 'group']) && listE.rec.list === 'item_category' && listE.rec.label === SILK && listE.rec.key === added.key && itemE.fields.category === SILK,
    'its outbox: ONE list entry {list: item_category, label: ' + SILK + '} (written at the name), then the item and the group', P.outbox.map(e => [e.kind, e.rec || e.fields]));
  P.online = true;
  const pr1 = spyOn(P, s);
  const r1 = P.syncNow();
  const push1 = lastPush(pr1), sv7 = w.ports.store.getItem('S1-0007');
  check(r1.ok && r1.quarantined.length === 0 && !!push1 && push1.results.length === 3 && push1.results.every(x => x.status === 'ok') && P.outbox.length === 0 &&
    same3(serverIc().map(r => r.key), CFG.ITEM_CATEGORY_KEYS.concat([added.key])) && serverIc()[5].label === SILK && serverIc()[5].order === 6 && w.lists.length === 6 && sv7.category === SILK,
    'pushed: every entry ok; the world\'s Lists hold the five built-ins (seeded by syncApplyListEntry) and the new row with the phone\'s key; the server\'s item has the category',
    { results: push1 && push1.results.map(x => [x.kind, x.status, x.reason]), lists: serverIc().map(r => [r.key, r.label, r.order]), category: sv7.category });
  Q.syncNow();
  const qo = itemCategoryOptions(Q.ports, 'S2');
  check(same3(qo.map(r => r.key), CFG.ITEM_CATEGORY_KEYS.slice(0, 4).concat([added.key, 'other'])) && qo[4].label === SILK,
    'a second phone (the other shop) offers it after its pull, with the same key, before the catch-all', qo.map(r => [r.key, r.label]));
  const d7 = P.applyAiResults(), r7 = P.syncNow(), s7 = w.ports.store.getItem('S1-0007');
  check(d7.length === 1 && r7.ok && s7.name === SIM_PHOTOS[0].name && s7.category === SILK && P.ports.store.getItem('S1-0007').category === SILK && P.outbox.length === 0,
    'its photo job then renames the placeholder only: the category the seller added and chose stays (the AI said ' + SIM_PHOTOS[0].category + ')', [s7.name, s7.category]);
  // 2. The late rename with a custom category: a placeholder piece at the catch-all whose photo the AI calls ပိုးအင်္ကျီ.
  const lateRename = (id, between) => {
    P.online = false;
    P.sim.start(sister, id);
    P.sim.photo(sister, silkPhoto);
    ['P|' + id + '|25000', 'NC|' + id + '|ok'].forEach(d => r5Tap(P, d));
    const job = P.aiQueue.find(j => j.kind === 'photo' && j.itemId === id) || { ctx: {} };
    const before = P.ports.store.getItem(id);
    P.online = true;
    const errs0 = w.errors.length, pings0 = r6Owner(w).length;
    const ra = P.syncNow();
    if (between) between();
    const pr = spyOn(P, s);
    const done = P.applyAiResults();
    const sv = w.ports.store.getItem(id);
    const replay = P.outbox.find(e => e.kind === 'item' && e.id === id) || {};
    const rb = P.syncNow();
    return { job, before, ra, done, sv, replay, rb, res: resultOf(lastPush(pr), replay.entryId), errs: w.errors.slice(errs0), pings: r6Owner(w).slice(pings0), conflicts: conflictOf(pings0, id) };
  };
  const a = lateRename('S1-0008');
  check(a.job.status === 'done' && Array.isArray(a.job.ctx.categories) && a.job.ctx.categories.indexOf(SILK) >= 0 && a.job.ctx.categories[a.job.ctx.categories.length - 1] === other &&
    a.before.name === itemPlaceholderName('S1-0008') && a.before.category === other,
    'the photo job\'s ctx lists the phone\'s categories (' + SILK + ' among them, the catch-all last); the piece waits at its placeholder name and the catch-all', { ctx: a.job.ctx, before: [a.before.name, a.before.category] });
  check(a.ra.ok && a.done.length === 1 && a.sv.name === silkPhoto.name && a.sv.category === SILK,
    'after the job the server\'s item has the AI name and the custom category (decided against the job\'s list)', [a.sv.name, a.sv.category]);
  check(same3(a.replay.fields, { name: silkPhoto.name, category: SILK }) && a.rb.ok && a.res.status === 'dup' && P.outbox.length === 0 && P.ports.store.getItem('S1-0008').category === SILK &&
    !a.errs.some(e => e.where === 'sync_conflict') && a.conflicts.length === 0,
    'the phone\'s replay pushes the same fields, answered dup; no sync_conflict, no conflict ping', { fields: a.replay.fields, res: a.res, errors: a.errs.map(e => e.where), pings: a.pings.map(m => m.text) });
  // 3. B3: the owner unticks ပိုးအင်္ကျီ on the server after the phone's last pull and before the job (the job's ctx still names it).
  const b = lateRename('S1-0009', () => { serverIc().forEach(r => { if (r.key === added.key) r.active = false; }); });
  const stillThere = itemCategoryOptions(P.ports, 'S1').some(r => r.key === added.key), offered = itemCategoryOptions(w.ports, 'S1').some(r => r.key === added.key);
  check(!offered && b.job.ctx.categories.indexOf(SILK) >= 0 && b.done.length === 1 && b.sv.name === silkPhoto.name && b.sv.category === SILK &&
    same3(b.replay.fields, { name: silkPhoto.name, category: SILK }) && b.rb.ok && b.res.status === 'dup' && P.outbox.length === 0,
    'B3: with the category unticked on the server (no longer offered there), the server\'s rename and the phone\'s replay still agree on the job\'s list: the item entry is dup',
    { offered, sv: [b.sv.name, b.sv.category], fields: b.replay.fields, res: b.res });
  check(b.errs.length === 0 && b.pings.length === 0 && !stillThere,
    'no sync_conflict and no other Errors row, no owner ping; after its pull the phone no longer offers the unticked category', { errors: b.errs.map(e => e.where + ': ' + e.message), pings: b.pings.map(m => m.text) });
  // The step-2 checker's additions. 4. B3 the other way round: the phone pulls the untick BEFORE its replay, so its own list no
  // longer offers the category; the job's list (ctx) still decides on the phone, as on the server.
  serverIc().forEach(r => { if (r.key === added.key) r.active = true; });
  P.syncNow();
  const reOffered = itemCategoryOptions(P.ports, 'S1').some(r => r.key === added.key);
  let phoneOffersAtReplay = null;
  const c = lateRename('S1-0010', () => {
    serverIc().forEach(r => { if (r.key === added.key) r.active = false; });
    P.syncNow();
    phoneOffersAtReplay = itemCategoryOptions(P.ports, 'S1').some(r => r.key === added.key);
  });
  check(reOffered && phoneOffersAtReplay === false && c.job.ctx.categories.indexOf(SILK) >= 0 && c.done.length === 1 && c.sv.name === silkPhoto.name && c.sv.category === SILK &&
    same3(c.replay.fields, { name: silkPhoto.name, category: SILK }) && c.rb.ok && c.res.status === 'dup' && P.ports.store.getItem('S1-0010').category === SILK && P.outbox.length === 0 &&
    c.errs.length === 0 && c.pings.length === 0,
    'B3 with the untick pulled before the replay: the phone no longer offers the category, yet its replay decides against the job\'s list as the server did (the same fields, dup, the piece holds the category on both sides; no Errors row, no ping)',
    { reOffered, phoneOffersAtReplay, sv: [c.sv.name, c.sv.category], fields: c.replay.fields, res: c.res, phone: P.ports.store.getItem('S1-0010').category, errors: c.errs.map(e => e.where) });
  // 5. A job that carries no list (an older phone's job): the server twin and the phone each fall back to the PIECE's shop's list,
  // so an S1 piece whose AI answers an S2-only category gets the AI name only, on both sides, and the replay is a dup.
  w.ports.store.addListOption({ list: 'item_category', key: 'pahsoe', label: 'ပုဆိုး', shop: 'S2', note: 'checker' }, legacyListRows(w.ports, 'item_category'));
  P.syncNow();
  const s2Only = itemCategoryOptions(P.ports, 'S2').some(r => r.key === 'pahsoe') && !itemCategoryOptions(P.ports, 'S1').some(r => r.key === 'pahsoe');
  const pahsoePhoto = { key: 'pahsoe_blue', name: 'ပုဆိုး အပြာ', category: 'ပုဆိုး', color: 'အပြာ', description: '', visual: { emoji: '🧣', bg: '#1565c0' } };
  P.online = false;
  P.sim.start(sister, 'S1-0011');
  P.sim.photo(sister, pahsoePhoto);
  ['P|S1-0011|25000', 'NC|S1-0011|ok'].forEach(d => r5Tap(P, d));
  const oldJob = P.aiQueue.find(j => j.kind === 'photo' && j.itemId === 'S1-0011') || {};
  oldJob.ctx = {};
  P.online = true;
  const errs5 = w.errors.length, pings5 = r6Owner(w).length;
  const r5a = P.syncNow(), pr5 = spyOn(P, s), done5 = P.applyAiResults(), sv5 = w.ports.store.getItem('S1-0011');
  const replay5 = P.outbox.find(e => e.kind === 'item' && e.id === 'S1-0011') || {};
  const r5b = P.syncNow(), res5 = resultOf(lastPush(pr5), replay5.entryId);
  check(s2Only && r5a.ok && done5.length === 1 && sv5.name === pahsoePhoto.name && sv5.category === other && same3(replay5.fields, { name: pahsoePhoto.name }) && r5b.ok && res5.status === 'dup' &&
    P.ports.store.getItem('S1-0011').category === other && P.outbox.length === 0 && w.errors.length === errs5 && r6Owner(w).length === pings5,
    'a job without a list: the server twin and the phone each decide against the S1 piece\'s own list, so the S2-only answer gives the AI name only and the catch-all stays on both sides (dup)',
    { s2Only, sv: [sv5.name, sv5.category], fields: replay5.fields, res: res5, phone: P.ports.store.getItem('S1-0011').category, errors: w.errors.slice(errs5).map(e => e.where) });
}

/* ---------------- what the family and the sheet would see ---------------- */
console.log('\n══ A phone chat (last 8) ══');
A.chat.slice(-8).forEach(m => {
  const who = m.from === 'bot' ? 'APP ' : 'HER ';
  const body = m.voice ? '🎤 ' + m.voice : (m.photo && m.from === 'user' ? '📷 photo' : m.document ? '📄 ' + m.document.name : (m.text || ''));
  const kb = (m.keyboard || []).map(row => '[' + row.map(b => b.text).join(' | ') + ']').join(' ');
  console.log('  ' + who + body.replace(/\n/g, ' ⏎ ') + (kb ? '\n       ' + kb : ''));
});
console.log('\n══ Owner Telegram pings (last 4) ══');
ownerChat().slice(-4).forEach(m => console.log('  ' + (m.text || '').replace(/\n/g, ' ⏎ ') + ((m.keyboard || []).length ? '  ' + m.keyboard.map(r => '[' + r.map(b => b.text).join(' | ') + ']').join(' ') : '')));
console.log('\n══ Devices tab ══');
server.devices.forEach(d => console.log('  ' + [d.id.slice(0, 8), d.status, d.staffId, d.shop, d.role, d.receiptLetter || '-', d.label, 'pending ' + d.pendingCount].join('\t')));
console.log('\n══ Quarantine tab ══');
server.quarantine.forEach(q => console.log('  ' + [q.deviceId.slice(0, 8), q.reason, q.groupId.slice(0, 8)].join('\t')));
console.log('\n══ Summary sync line ══\n  ' + server.summaryLines(wnow()).join('\n  '));
console.log('\n══ Server errors (where) ══\n  ' + Array.from(new Set(world.errors.map(e => e.where))).join(', '));
if (voidPath === 'fallback') console.log('\nTODO(agent A): core_bot.js does not handle the owner-only V|groupId callback yet; the owner void was simulated with voidGroup(force).');
else console.log('\nOwner void ran through the Telegram route (V| callback handled by core_bot).');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
