/**
 * poc/sim_seed.js — demo data shared by the Node scenario and the browser simulator.
 */
var SIM_USERS = {
  sister: { id: 1001, name: 'Sister (S1)', shop: 'S1', role: 'staff' },
  brother: { id: 1002, name: 'Brother (S2)', shop: 'S2', role: 'staff' },
  owner: { id: 1000, name: 'You (owner)', shop: 'S1', role: 'owner' },
  customer: { id: 9999, name: 'Customer (not staff)', shop: null, role: null }
};

/** Sample photos the sister can "send". visual is only used by the browser UI. */
var SIM_PHOTOS = [
  { key: 'htamein_green', name: 'ထမီ ပိုးထည် အစိမ်း', category: 'ထမီ', color: 'အစိမ်း', description: 'အစိမ်းရောင် ပိုးထည် ထမီ၊ လက်ချုပ်', visual: { emoji: '👗', bg: '#2e7d32' } },
  { key: 'blouse_pink', name: 'အင်္ကျီ ရင်ဖုံး ပန်းရောင်', category: 'အင်္ကျီ', color: 'ပန်းရောင်', description: 'ပန်းရောင် ရင်ဖုံး အင်္ကျီ', visual: { emoji: '👚', bg: '#d81b60' } },
  { key: 'longyi_navy', name: 'လုံချည် ပိုး အပြာနက်', category: 'လုံချည်', color: 'အပြာနက်', description: 'အမျိုးသား ပိုးလုံချည်', visual: { emoji: '🧣', bg: '#1a237e' } },
  { key: 'set_gold', name: 'ဝတ်စုံ ရိုးရာ ရွှေရောင်', category: 'ဝတ်စုံ', color: 'ရွှေရောင်', description: 'မင်္ဂလာ ဝတ်စုံ', visual: { emoji: '🧥', bg: '#b8860b' } },
  { key: 'chair', name: '', category: 'အခြား', color: '', description: '', visual: { emoji: '🪑', bg: '#8d6e63' } },
  { key: 'notebook', name: '', category: '', label: 'notebook page', visual: { emoji: '📒', bg: '#5d4037' },
    lines: [
      { raw: 'ထမီ အနီ ၁ ထည် ၂၅၀၀၀', item_hint: 'ထမီ အနီ', qty: 1, unit_price: 25000 },
      { raw: 'လုံချည် ကချင် ၂ ထည် ၃၆၀၀၀', item_hint: 'လုံချည် ကချင်', qty: 2, amount: 36000 },
      { raw: 'ထမီ ၁ ထည် ၂၂၀၀၀', item_hint: 'ထမီ', qty: 1, unit_price: 22000 }
    ] },
  // Two filled measurement sheets (the paper form of the tailoring book). Values as written: multi-value cells
  // with slashes, decimals, one cell the reader is unsure about (low_confidence), a margin note.
  { key: 'meas_sheet_myint', name: '', category: '', label: 'measurement sheet', visual: { emoji: '📏', bg: '#6a1b9a' },
    measure: { name: 'ဒေါ်မြင့်', notes: 'No Bra',
      fields: { neck: '32', shoulder: '14.5', bust: '34', bust_height: '17.5', sleeve_round: '36/30/20', sleeve_length: '7/3/20',
                waist: '28', hip: '38', htamein_length: '40', htamein_side: 'ဘယ်' },
      low_confidence: ['bust_height'] } },
  { key: 'meas_sheet_other', name: '', category: '', label: 'measurement sheet (another name)', visual: { emoji: '📐', bg: '#4527a0' },
    measure: { name: 'မခင်ခင်', notes: '',
      fields: { neck: '30', bust: '33', waist: '26', hip: '36' },
      low_confidence: ['waist'] } }
];

var SIM_SEED_ITEMS = [
  { id: 'S1-0001', shop: 'S1', name: 'ထမီ ချည်သား အနီ', category: 'ထမီ', type: 'UNIQUE', price: 25000, cost: 12000, photo: { emoji: '👗', bg: '#c62828' }, stock: 1 },
  { id: 'S1-0002', shop: 'S1', name: 'လုံချည် ကချင် အပြာ', category: 'လုံချည်', type: 'SKU', price: 18000, cost: 9000, photo: { emoji: '🧣', bg: '#1565c0' }, stock: 5 },
  { id: 'S1-0003', shop: 'S1', name: 'အင်္ကျီ ရင်ဖုံး အဖြူ', category: 'အင်္ကျီ', type: 'SKU', price: 12000, cost: 6000, photo: { emoji: '👚', bg: '#9e9e9e' }, stock: 3 },
  { id: 'S1-0004', shop: 'S1', name: 'ဝတ်စုံ ပိုးထည် အစိမ်း', category: 'ဝတ်စုံ', type: 'UNIQUE', price: 45000, cost: '', photo: { emoji: '🧥', bg: '#00695c' }, stock: 1 },
  { id: 'S1-0005', shop: 'S1', name: 'ထမီ ဇင်းမယ် အဝါ', category: 'ထမီ', type: 'SKU', price: 22000, cost: 11000, photo: { emoji: '👗', bg: '#f9a825' }, stock: 2 },
  { id: 'S1-0006', shop: 'S1', name: 'မင်္ဂလာ ဝတ်စုံ ရွှေရောင်', category: 'ဝတ်စုံ', type: 'UNIQUE', price: 1000000, cost: 450000, photo: { emoji: '👑', bg: '#8d6e00' }, stock: 1 },
  { id: 'S2-0001', shop: 'S2', name: 'ဝတ်စုံ ရိုးရာ အနီ', category: 'ဝတ်စုံ', type: 'UNIQUE', price: 45000, cost: 20000, photo: { emoji: '🧥', bg: '#ad1457' }, stock: 1 },
  { id: 'S2-0002', shop: 'S2', name: 'ထမီ ချည်သား အပြာ', category: 'ထမီ', type: 'SKU', price: 22000, cost: 11000, photo: { emoji: '👗', bg: '#283593' }, stock: 4 },
  { id: 'S2-0003', shop: 'S2', name: 'လုံချည် ပိုး အနက်', category: 'လုံချည်', type: 'SKU', price: 30000, cost: 15000, photo: { emoji: '🧣', bg: '#212121' }, stock: 1 }
];

/** The tailoring catalogue (Designs tab): a code with a base price and making time, a code without a price. */
var SIM_SEED_DESIGNS = [
  { code: 'TSL-0018', name: 'ဝမ်းဆက်', category: 'ဝတ်စုံ', photoUrl: '', photoFileId: '', basePrice: 150000, daysToMake: 14, active: true, note: '' },
  { code: 'TSL-0025', name: 'ရင်ဖုံး', category: 'အင်္ကျီ', photoUrl: '', photoFileId: '', basePrice: '', daysToMake: 7, active: true, note: '' }
];

/** One customer with a phone (as the sister would type it), one without, so the 📱 button shows up. */
var SIM_SEED_CUSTOMERS = [
  { name: 'ဒေါ်မြင့်', phone: '09 123 456 78', note: '' },
  { name: 'ဒေါ်ခင်', phone: '', note: 'မင်္ဂလာ ဝတ်စုံ အော်ဒါ' }
];

function seedSimWorld(world) {
  var ports = world.ports;
  Object.keys(SIM_USERS).forEach(function (k) {
    var u = SIM_USERS[k];
    if (u.role) world.staff.push({ id: u.id, name: u.name, shop: u.shop, role: u.role, active: true });
  });
  world.settings = {
    shop_name_S1: 'ဆိုင် ၁ (ရန်ကုန်)', shop_name_S2: 'ဆိုင် ၂ (မန္တလေး)', low_stock_threshold: 2, summary_hour: 21,
    notebook_import: true, deposit_presets: '50000,100000,200000,300000',
    // The one-tap sale card (round 5 D5): every existing suite, the dev page and today's simulator keep it; the code's
    // default is form (round 6), and poc/run_wizard.js and the simulator set it.
    sale_flow: 'quick',
    // Custom tailoring: each shop continues its own paper voucher book; letterheads for vouchers and measurement sheets.
    order_next_no_S1: 2532, order_next_no_S2: 101, fabric_presets: 'ပိုး,ချည်,ပုဝါ', due_presets: '7,14,21,30', order_remind_days: 3,
    shop_brand_S1: 'ဆိုင် ၁ · အပ်ချုပ်', shop_address_S1: 'ရန်ကုန်', shop_phone_S1: '09 111 222 333',
    shop_brand_S2: 'ဆိုင် ၂ · အပ်ချုပ်', shop_address_S2: 'မန္တလေး', shop_phone_S2: '09 444 555 666'
  };
  SIM_SEED_DESIGNS.forEach(function (d) { var c = {}; for (var k in d) c[k] = d[k]; world.designs.push(c); });
  var setupStaff = { id: 'setup', name: 'setup', shop: 'S1', role: 'owner' };
  // Demo dates are relative to today: opening stock and one credit sale last month, one deposit this month.
  var nowDate = ports.clock.now();
  var lastMonth = prevMonthKey(nowDate), thisMonth = monthKey(nowDate);
  var opening = new Date(lastMonth + '-01T03:00:00.000Z');
  var creditSaleDate = new Date(lastMonth + '-12T07:30:00.000Z');
  var depositDate = new Date(thisMonth + '-01T06:00:00.000Z');
  SIM_SEED_ITEMS.forEach(function (s, i) {
    var fid = 'seed_' + i;
    world.files[fid] = { visual: s.photo, meta: { name: s.name, category: s.category } };
    world.items.push({ id: s.id, shop: s.shop, name: s.name, category: s.category, type: s.type, price: s.price, cost: s.cost,
      photoUrl: 'drive://POS Photos/' + s.id + '.jpg', photoFileId: fid, createdAt: opening.toISOString(), createdBy: 'setup', sample: false, alias: '' });
    var item = ports.store.getItem(s.id);
    commitRestock(ports, { item: item, qty: s.stock, staff: setupStaff, source: CFG.SOURCE.SYSTEM, note: 'opening stock', when: opening });
  });
  ['S1', 'S2'].forEach(function (shop) {
    var from = shop === 'S1' ? 7 : 4;
    for (var n = from; n <= from + 6; n++) {
      var id = shop + '-' + String(n).padStart(4, '0');
      world.items.push({ id: id, shop: shop, name: '', category: '', type: '', price: '', cost: '', photoUrl: '', photoFileId: '', createdAt: '', createdBy: '', sample: false, alias: '' });
    }
  });
  // Customers, one credit sale from last month (half paid, cash) and one deposit from the 1st of this month (cash).
  var seedCustomers = SIM_SEED_CUSTOMERS.map(function (c) { return ports.store.addCustomer(c); });
  world.customers.forEach(function (c) { c.createdAt = lastMonth + '-10T04:00:00.000Z'; });
  var sister = { id: '1001', name: 'Sister (S1)', shop: 'S1', role: 'staff' };
  var brother = { id: '1002', name: 'Brother (S2)', shop: 'S2', role: 'staff' };
  commitSale(ports, { item: ports.store.getItem('S1-0006'), qty: 1, paid: 500000, customerId: seedCustomers[0].id, note: 'credit', method: CFG.METHOD.CASH,
    staff: sister, source: CFG.SOURCE.BUTTON, when: creditSaleDate });
  commitDeposit(ports, { customerId: seedCustomers[1].id, amount: 300000, note: 'မင်္ဂလာ ဝတ်စုံ အော်ဒါ', shop: 'S1', method: CFG.METHOD.CASH,
    staff: sister, source: CFG.SOURCE.BUTTON, when: depositDate });
  // One EXPENSE row written before the Method and Category columns existed (shop 2, the 1st of this month):
  // Method and Category blank, Note holds the reason. Readers must count it as cash and as "other".
  writeGroup(ports, [newTx(ports, {
    shop: 'S2', itemId: '', type: CFG.TX.EXPENSE, qty: 0, unitPrice: null, amount: -5000, cash: -5000, note: 'ဖုန်းဘေလ် (legacy row)',
    source: CFG.SOURCE.VOICE, transcript: 'ဖုန်းဘေလ် ငါးထောင် ပေးလိုက်တယ်', staffId: brother.id, when: depositDate
  })]);
  return world;
}

/**
 * Fill the Lists tab (world.lists) the way setupSheet() seeds it on a version-3 sheet: the four lists from
 * what Settings and Messages hold today (legacyListRows; item_category last, its five built-in rows, round 6b),
 * every row active, Order 1..n, Shop blank.
 * seedSimWorld does NOT call it: poc/run_scenario.js keeps testing a sheet without the tab (the legacy path).
 * The round-4 test files, the simulator page and the app's dev page call it after seedSimWorld.
 */
function simSeedLists(world) {
  var rows = [];
  CFG.LIST_NAMES.forEach(function (name) {
    legacyListRows(world.ports, name).forEach(function (r) { rows.push(r); });
  });
  world.lists = rows;
  (world.listeners || []).forEach(function (fn) { fn({ type: 'lists' }); });
  return world;
}
