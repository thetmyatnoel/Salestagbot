'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const files = [
  'apps-script/core_config', 'apps-script/core_burmese', 'apps-script/core_messages',
  'apps-script/core_ai_prompt', 'apps-script/core_ledger', 'apps-script/core_report',
  'apps-script/core_orders', 'apps-script/core_bot', 'apps-script/core_sync',
  'poc/sim_mock_ai', 'poc/sim_ports', 'poc/sim_seed', 'poc/sim_sync'
];
for (const file of files) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', file + '.js'), 'utf8'), { filename: file });
}
const world = seedSimWorld(createSimWorld());
const server = createFakeServer(world);
const ports = server.ports;
function login(id) {
  const staff = ports.store.getStaff(id);
  const code = syncMintCode(ports, staff, staff.name, ports.clock.now()).code;
  const enrolled = server.handle('enroll', { code });
  assert.equal(enrolled.ok, true);
  return { device: enrolled.device.id, token: enrolled.device.token };
}
function office(actor, action, params = {}) {
  return server.handle('office', { ...actor, ...params, action });
}
function person(id, role, shops = ['S1']) {
  return { id, role, shop: shops[0], shops, active: true, name: 'Worker ' + id };
}
const owner = login(SIM_USERS.owner.id);
assert.ok(office(owner, 'shop', { shop: 'S10', name: 'Hill Road', address: '18 Hill Road', phone: '09123', create: true }).ok);
const shop = office(owner, 'shops').shops.find(s => s.id === 'S10');
assert.equal(shop.phone, '09123');
assert.equal(shop.address, '18 Hill Road');
assert.equal(ports.store.listItems('S10').length, 20);
assert.ok(office(owner, 'person', { person: person('12301', 'access') }).ok);
const admin = login('12301');
for (const p of [person('12302', 'viewer'), person('W-003', 'bookkeeper'), person('12304', 'staff+designer', ['S10', 'S1']), person('12305', 'tailor')]) {
  assert.ok(office(admin, 'person', { person: p }).ok);
}
assert.equal(office(admin, 'person', { person: person('12301', 'viewer') }).ok, false);
assert.equal(office(admin, 'person', { person: person('12307', 'access') }).ok, false);
assert.equal(office(admin, 'invite', { target: SIM_USERS.owner.id }).ok, false);
assert.match(office(admin, 'invite', { target: '12302' }).code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
const viewer = login('12302'), book = login('W-003'), designer = login('12304'), tailor = login('12305');
const day = dayKey(ports.clock.now());
for (const period of [day, day.slice(0, 7), day.slice(0, 4)]) {
  const close = office(viewer, 'close', { period });
  assert.ok(close.ok);
  assert.deepEqual(close.shops.map(s => s.id), ['S1']);
  assert.ok(close.report.sections.length > 7);
}
assert.equal(office(viewer, 'close', { period: day, shop: 'S2' }).ok, false);
assert.equal(server.handle('bootstrap', viewer).ok, false);
assert.equal(office(viewer, 'expenseBook').ok, false);
assert.equal(office(admin, 'close').ok, false);
const expense = { slip: 'BOOK-expense123', shop: 'S1', amount: 500, category: 'other', method: 'CASH', note: 'Transport' };
assert.ok(office(book, 'recordExpense', expense).ok);
assert.ok(office(book, 'recordExpense', expense).ok);
assert.equal(world.ledger.filter(r => r.groupId === expense.slip).length, 1);
assert.equal(office(book, 'recordExpense', { ...expense, amount: 700 }).ok, false);
assert.equal(office(book, 'recordExpense', { ...expense, shop: 'S2' }).ok, false);
const boot = server.handle('bootstrap', designer);
assert.ok(boot.items.length && boot.items.every(i => i.shop !== 'S2'));
assert.ok(boot.ledger.every(i => i.shop !== 'S2'));
const delta = server.handle('sync', { ...designer, pull: { fullMasters: true, ledgerSeq: 0 } }).pull;
assert.ok(delta.items.every(i => i.shop !== 'S2'));
const slip = { slip: 'SHIP-partial123', tag: 'S1-0002', to: 'S10', qty: 2 };
const before = ports.store.getItem(slip.tag).stock;
assert.ok(office(designer, 'sendStock', slip).ok);
assert.ok(office(designer, 'sendStock', slip).ok);
assert.equal(ports.store.getItem(slip.tag).stock, before - 2);
assert.equal(office(designer, 'stock').incoming.length, 1);
const receiver = { slip: slip.slip, tag: 'S10-0001' };
assert.equal(office(book, 'receiveStock', receiver).ok, false);
assert.ok(office(designer, 'receiveStock', receiver).ok);
assert.ok(office(designer, 'receiveStock', receiver).ok);
assert.equal(ports.store.getItem(receiver.tag).stock, 2);
assert.equal(ports.store.getItem(receiver.tag).name, ports.store.getItem(slip.tag).name);
assert.equal(office(designer, 'stock').incoming.length, 0);
assert.ok(office(designer, 'piece', { tag: 'S10-0002', name: 'Sample', qty: 1, price: '', cost: 500, sample: true }).ok);
assert.ok(office(designer, 'designs').items.some(it => it.id === 'S10-0002' && it.pending));
assert.equal(office(tailor, 'designs').ok, false);
const order = createOrder(world.ports, { shop: 'S1', customerId: 'C-0001', staff: SIM_USERS.owner });
assert.ok(office(tailor, 'orders').orders.some(o => o.id === order.id));
const card = office(tailor, 'order', { id: order.id });
assert.ok(card.fields.length > 0);
assert.ok(office(tailor, 'measure', { id: order.id, values: { [card.fields[0].key]: '30' } }).ok);
assert.ok(ports.store.getOrder(order.id).measId);
assert.ok(office(tailor, 'orderStep', { id: order.id, status: card.next[0].id }).ok);
assert.equal(office(tailor, 'close').ok, false);
assert.ok(office(owner, 'shop', { shop: 'S10', name: 'Hill Road', active: false }).ok);
assert.equal(office(designer, 'piece', { tag: 'S10-0003', name: 'Sample', qty: 1, price: '', cost: 500 }).ok, false);
assert.ok(office(owner, 'close', { period: day, shop: 'S10' }).report.sections.some(s => s.rows.some(r => r.includes('Hill Road'))));
assert.ok(office(admin, 'person', { person: { ...person('12302', 'viewer'), active: false } }).ok);
assert.equal(office(viewer, 'close').ok, false);
assert.ok(office(admin, 'people').people.some(p => p.id === '12302' && !p.active));
const row = world.ports.store.getItem('S1-0003');
const beforeProfit = dayStats(world.ports, 'S1', day).profit;
commitSale(world.ports, { item: row, qty: 1, unitPrice: 10000, staff: SIM_USERS.owner });
world.ports.store.updateItem(row.id, { cost: 9900 });
commitReturn(world.ports, { item: world.ports.store.getItem(row.id), qty: 1, unitPrice: 10000, staff: SIM_USERS.owner });
assert.equal(dayStats(world.ports, 'S1', day).profit, beforeProfit);
console.log('Shop workflows passed');
