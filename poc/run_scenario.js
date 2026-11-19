/**
 * poc/run_scenario.js — drives the real bot logic through every flow with
 * in-memory ports and asserts the ledger, stock and replies. No network, no keys.
 *
 *   node poc/run_scenario.js          # run and print transcript + tables
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

const world = seedSimWorld(createSimWorld());
const { ports, sim } = world;
const U = SIM_USERS;
let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✘ ' + label); }
}
const item = id => ports.store.getItem(id);
const lastText = user => (sim.lastBot(user) || {}).text || '';
const lastRow = () => world.ledger[world.ledger.length - 1];
const liveOf = groupId => liveRows(world.ledger.filter(r => r.groupId === groupId), world.ledger);
const num = s => Number(String(s).replace(/,/g, ''));
const step = title => console.log('\n── ' + title);
const today = dayKey(ports.clock.now());
const ym = monthKey(ports.clock.now());

// Telegram rejects callback_data over 64 bytes. Watch every button the bot ever emits (sent or edited).
let maxCb = { len: 0, data: '' };
world.listeners.push(evt => {
  if (evt.type !== 'chat' || !evt.message || !evt.message.keyboard) return;
  evt.message.keyboard.forEach(row => row.forEach(b => {
    const len = Buffer.byteLength(String(b.callback_data || ''), 'utf8');
    if (len > maxCb.len) maxCb = { len, data: b.callback_data };
  }));
});

step('0. Seed: one September credit sale and one October deposit');
check(openCredits(ports, 'S1').length === 1 && openCredits(ports, 'S1')[0].owed === 500000, 'Daw Myint owes 500,000 on the 1,000,000 wedding set');
check(depositsFor(ports, 'C-0002') === 300000, 'Daw Khin has a 300,000 deposit held');

step('1. A customer scans a tag: allowlist blocks them');
sim.start(U.customer, 'S1-0002');
check(lastText(U.customer) === MSG.staff_only, 'customer gets the staff-only line');
check(world.errors.some(e => e.where === 'unknown_user' && e.message.includes('9999')), 'unknown id 9999 logged for you to approve');

step('2. Sister scans a SKU tag, opens the quantity grid and taps ၂');
sim.start(U.sister, 'S1-0002');
let card = sim.lastBot(U.sister);
check(card.text.includes('S1-0002') && card.text.includes('18,000'), 'item card shows id and price');
check(sim.button(card, 'ရောင်း ၁') === 'S|S1-0002|1' && sim.button(card, 'အရေအတွက်') === 'Q|S1-0002' && sim.button(card, 'ရောင်း ၂') === null, 'card has one Sold button and a quantity button (no Sold 2/3)');
sim.tapLast(U.sister, 'အရေအတွက်');
sim.tapLast(U.sister, '၂');
let sale = lastRow();
check(sale.type === 'SALE' && sale.qty === -2 && sale.amount === 36000 && sale.cash === 36000 && sale.costAtSale === 9000, 'ledger: SALE qty -2, amount 36,000, cash 36,000, cost snapshot 9,000');
check(item('S1-0002').stock === 3, 'stock 5 -> 3');
check(sim.button(sim.lastBot(U.sister), 'မှားသွားတယ်') !== null && sim.button(sim.lastBot(U.sister), 'ဘောက်ချာ') !== null && sim.button(sim.lastBot(U.sister), 'မကျေသေး') !== null, 'edited card offers Undo, Receipt and Not-fully-paid');

step('3. Undo, then sell 1 again');
sim.tapLast(U.sister, 'မှားသွားတယ်');
check(item('S1-0002').stock === 5, 'undo restores stock to 5 by a reversing row, not a delete');
check(world.ledger.filter(r => r.itemId === 'S1-0002').length === 3, 'ledger keeps opening + sale + reversal (3 rows)');
sim.start(U.sister, 'S1-0002');
sim.tapLast(U.sister, 'ရောင်း ၁');
check(item('S1-0002').stock === 4, 'stock 4 after selling 1');

step('4. Voice: "ဒါ ၂ ထည် ရောင်းရတယ်" -> confirm -> commit');
sim.voice(U.sister, 'ဒါ ၂ ထည် ရောင်းရတယ်');
let confirm = sim.lastBot(U.sister);
check(confirm.text.includes('ရောင်း ၂ ထည်') && confirm.text.includes('36,000'), 'confirm screen echoes 2 pieces, 36,000');
sim.tapLast(U.sister, 'မှန်တယ်');
check(item('S1-0002').stock === 2, 'stock 2 after voice sale of 2');
check(lastRow().source === 'VOICE' && lastRow().transcript === 'ဒါ ၂ ထည် ရောင်းရတယ်', 'row records source VOICE and transcript');

step('5. Voice with a bargained price: "တစ်ထည် တစ်သောင်းငါးထောင်နဲ့ ရောင်းလိုက်တယ်"');
sim.voice(U.sister, 'တစ်ထည် တစ်သောင်းငါးထောင်နဲ့ ရောင်းလိုက်တယ်');
check(lastText(U.sister).includes('15,000'), 'number words parsed to 15,000');
sim.tapLast(U.sister, 'မှန်တယ်');
check(lastRow().unitPrice === 15000 && lastRow().amount === 15000 && item('S1-0002').stock === 1, 'sold 1 at 15,000, stock 1');

step('6. Voice: reject a wrong parse');
sim.voice(U.sister, 'ဒါ ၃ ထည် ရောင်းရတယ်');
sim.tapLast(U.sister, 'မဟုတ်ဘူး');
check(item('S1-0002').stock === 1, 'nothing written after ❌');
check(lastText(U.sister).includes('S1-0002'), 'button card re-sent after ❌');

step('7. Voice expense: "အထည်ဖိုး သုံးသောင်း ပေးလိုက်တယ်"');
sim.voice(U.sister, 'အထည်ဖိုး သုံးသောင်း ပေးလိုက်တယ်');
check(lastText(U.sister).includes('30,000') && lastText(U.sister).includes('အထည်ဖိုး'), 'expense proposal 30,000 fabric');
sim.tapLast(U.sister, 'မှန်တယ်');
check(lastRow().type === 'EXPENSE' && lastRow().amount === -30000 && lastRow().cash === -30000 && lastRow().shop === 'S1', 'EXPENSE row -30,000 cash out on S1');
check(lastRow().category === 'fabric' && lastRow().method === 'CASH', 'voice expense carries category fabric and Method CASH');

step('8. Voice query: "ဒီနေ့ ဘယ်လောက်ရောင်းရလဲ"');
sim.voice(U.sister, 'ဒီနေ့ ဘယ်လောက်ရောင်းရလဲ');
let todayText = lastText(U.sister);
check(todayText.includes('69,000') && todayText.includes('30,000'), 'today: revenue 69,000 (18k+36k+15k), expenses 30,000');

step('9. Voice the bot cannot understand');
sim.voice(U.sister, 'မနက်ဖြန် မိုးရွာမလား');
check(world.chats[U.sister.id].slice(-2)[0].text.includes(MSG.not_understood), 'says it did not understand');
check(lastText(U.sister).includes('S1-0002'), 'and falls back to the button card of the last scanned item');

step('10. Gemini outage: buttons keep working');
world.aiFail = true;
sim.voice(U.sister, 'ဒါ ၁ ထည် ရောင်းရတယ်');
check(world.chats[U.sister.id].slice(-2)[0].text.includes(MSG.ai_down), 'AI error becomes a polite fallback');
check(world.errors.some(e => e.where === 'voice' && e.message.includes('503')), 'error logged to Errors tab');
sim.tapLast(U.sister, 'ရောင်း ၁');
check(item('S1-0002').stock === 0, 'button sale still works during the outage');
world.aiFail = false;

step('11. New hand-sewn piece: blank tag + photo + price preset + skip cost');
sim.start(U.sister, 'S1-0007');
check(lastText(U.sister).includes('Tag အသစ်'), 'blank tag starts the new-item flow');
sim.photo(U.sister, SIM_PHOTOS[0]);
let priceMsg = sim.lastBot(U.sister);
check(priceMsg.text.includes('ထမီ ပိုးထည် အစိမ်း'), 'photo described: name proposed by the model');
check(sim.button(priceMsg, '25,000') !== null, 'price presets come from existing ထမီ prices');
check(sim.button(priceMsg, 'စျေး မသတ်မှတ်ရသေး') !== null && sim.button(priceMsg, 'နမူနာ') !== null, 'price screen also offers "price pending" and a sample toggle');
sim.tapLast(U.sister, '25,000');
check(lastText(U.sister).includes(MSG.ask_cost.slice(0, 6)), 'asks for cost next');
sim.tapLast(U.sister, 'ကျော်');
let created = item('S1-0007');
check(created.status === 'ACTIVE' && created.type === 'UNIQUE' && created.price === 25000 && created.stock === 1, 'item S1-0007 created ACTIVE, UNIQUE, 25,000, stock 1');
check(lastText(U.sister).includes('S1-0007') && sim.button(sim.lastBot(U.sister), 'ရောင်းပြီး') !== null, 'card for a unique piece shows one Sold button');
sim.tapLast(U.sister, 'ရောင်းပြီး');
check(item('S1-0007').stock === 0 && item('S1-0007').status === 'SOLD', 'sold: stock 0, status SOLD');
sim.start(U.sister, 'S1-0007');
check(lastText(U.sister).includes('ရောင်းပြီးသား'), 're-scan shows "already sold"');

step('12. Cost typed as text during the flow');
sim.start(U.sister, 'S1-0008');
sim.photo(U.sister, SIM_PHOTOS[1]);
sim.text(U.sister, '၁၈၀၀၀');
check(lastText(U.sister).includes('18,000'), 'Burmese digits typed as price');
sim.text(U.sister, '7000');
check(item('S1-0008').cost === 7000 && item('S1-0008').price === 18000, 'cost 7,000 and price 18,000 stored');

step('13. Brother restocks in shop 2 with buttons');
sim.start(U.brother, 'S2-0002');
sim.tapLast(U.brother, 'ကုန်ရောက်');
sim.tapLast(U.brother, '+၁၀');
check(item('S2-0002').stock === 14, 'restock +10: stock 4 -> 14');

step('14. Brother voice return: "ဒါ ၂ ထည် ပြန်အမ်းတယ်"');
sim.voice(U.brother, 'ဒါ ၂ ထည် ပြန်အမ်းတယ်');
sim.tapLast(U.brother, 'မှန်တယ်');
let ret = lastRow();
check(ret.type === 'RETURN' && ret.qty === 2 && ret.amount === -44000 && ret.cash === -44000 && item('S2-0002').stock === 16, 'RETURN +2 pieces, -44,000 refund');

step('15. Transfer a tag to the other shop, then undo');
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'သို့');
check(item('S1-0003').shop === 'S2', 'S1-0003 now belongs to S2');
check(world.ledger.slice(-2).map(r => r.type).join(',') === 'TRANSFER_OUT,TRANSFER_IN', 'ledger has OUT + IN rows');
sim.tapLast(U.sister, 'မှားသွားတယ်');
check(item('S1-0003').shop === 'S1' && item('S1-0003').stock === 3, 'undo moves it back, stock intact');

step('16. Duplicate webhook delivery is ignored');
const before = world.ledger.length;
sim.start(U.sister, 'S1-0005');
const cardMsg = sim.lastBot(U.sister);
const upd = { update_id: 777, callback_query: { id: 'cq777', from: { id: U.sister.id, first_name: 'Sister' }, message: { message_id: cardMsg.id, chat: { id: U.sister.id }, text: cardMsg.text }, data: 'S|S1-0005|1' } };
sim.replay(upd);
const r2 = sim.replay(upd);
check(world.ledger.length === before + 1 && r2 === 'duplicate', 'same update_id twice writes one row');

step('16b. Slow connection: the same button tapped twice records one sale');
sim.start(U.sister, 'S1-0005');
const slowCard = sim.lastBot(U.sister);
const stockBefore16b = item('S1-0005').stock;
sim.tap(U.sister, slowCard.id, 'S|S1-0005|1');
sim.tap(U.sister, slowCard.id, 'S|S1-0005|1');   // second tap arrives before the card was redrawn
check(item('S1-0005').stock === stockBefore16b - 1, 'two taps on the same Sold button within two minutes sell once');
sim.start(U.sister, 'S1-0005');
sim.tapLast(U.sister, 'ရောင်း ၁');
check(item('S1-0005').stock === stockBefore16b - 2, 'a fresh card sells again normally');
sim.tapLast(U.sister, 'မှားသွားတယ်');                                   // undo both test sales so later totals hold
sim.tap(U.sister, slowCard.id, sim.button(slowCard, 'မှားသွားတယ်'));
check(item('S1-0005').stock === stockBefore16b, 'both test sales undone');
world.settings.text_cards = true;
sim.start(U.sister, 'S1-0001');
check(!sim.lastBot(U.sister).photo && lastText(U.sister).includes('S1-0001'), 'text_cards setting sends the card without a photo');
world.settings.text_cards = false;

step('17. Unknown tag, menu, find');
sim.start(U.sister, 'S9-9999');
check(lastText(U.sister).includes('S9-9999') && lastText(U.sister).includes('မတွေ့'), 'unknown tag message');
sim.start(U.sister, '');
const menu = sim.lastBot(U.sister);
check(sim.button(menu, 'ရှာ') === 'M|find' && sim.button(menu, 'ငွေလက်ခံ') === 'M|pay' && sim.button(menu, 'စရံ') === 'M|dep' && sim.button(menu, 'စာရင်း') === 'M|rep', 'menu has find, receive payment, deposit, reports');
check(sim.button(menu, 'ကုန်ကျ') === 'M|exp' && sim.button(menu, 'ဝယ်သူများ') === 'M|cust' && menu.keyboard.slice(0, 3).every(r => r.length === 3), 'menu adds expenses and customers, three rows of three');
sim.tapLast(U.sister, 'ရှာ');
sim.text(U.sister, 'ထမီ');
check((sim.lastBot(U.sister).keyboard || []).length >= 2, 'find lists the shop\'s ထမီ items as buttons');

step('18. Owner asks for today');
sim.text(U.owner, '/today');
check(lastText(U.owner).includes('ဆိုင် ၁') && lastText(U.owner).includes('ဆိုင် ၂') && lastText(U.owner).includes('ငွေလက်ခံ'), 'owner sees both shops with a cash line');
check(lastText(U.owner).includes('ငွေသား') && lastText(U.owner).includes('ဘဏ်'), 'today answer shows drawer and bank');
const s1 = dayStats(ports, 'S1', dayKey(ports.clock.now()));
check(s1.revenue === 134000, 'S1 revenue = 134,000 (18k+36k+15k+18k on S1-0002, 25k on S1-0007, 22k on S1-0005)');
check(s1.cogs === 5 * 9000 + 11000 && s1.unknownCostPieces === 1, 'COGS 56,000 from cost snapshots; 1 piece sold without a known cost');
check(s1.cashIn === 134000 && s1.cashOut === 30000, 'cash in 134,000, cash out 30,000');

step('19. Undo window expires after 30 minutes');
sim.start(U.brother, 'S2-0003');
sim.tapLast(U.brother, 'ရောင်း ၁');
world.nowOverride = new Date(Date.now() + 31 * 60000);
sim.tapLast(U.brother, 'မှားသွားတယ်');
check(lastText(U.brother).includes('မိနစ်'), 'late undo is refused with the 30-minute message');
world.nowOverride = null;

/* ======================= shop requirements, section 12 ======================= */

step('20. Credit sale by buttons: sold, "not fully paid", 0 now, pick Daw Myint');
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ရောင်း ၁');
const paidFullGroup = lastRow().groupId;
const paidFullTx = lastRow().txId;
sim.tapLast(U.sister, 'မကျေသေး');
let askPaid = sim.lastBot(U.sister);
check(askPaid.text.includes('12,000') && sim.button(askPaid, '6,000') !== null, 'asks how much was paid now, with 0 / half / other');
sim.tapLast(U.sister, '0');
let askWho = sim.lastBot(U.sister);
check(sim.button(askWho, 'ဒေါ်မြင့်') !== null && sim.button(askWho, 'နာမည်အသစ်') !== null, 'asks who, with recent customers and "new name"');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const creditSale = lastRow();
check(creditSale.type === 'SALE' && creditSale.cash === 0 && creditSale.amount === 12000 && creditSale.customerId === 'C-0001', 'new SALE row: amount 12,000, cash 0, customer C-0001');
check(world.ledger.some(r => r.groupId === paidFullGroup && r.reversesTxId === paidFullTx && r.amount === -12000 && r.note === 'rewrite') &&
  creditSale.groupId === paidFullGroup && liveOf(paidFullGroup).length === 1 && creditSale.time === world.ledger.find(r => r.txId === paidFullTx).time,
  'the fully-paid sale was rewritten inside its own group (mirror + replacement, same GroupID and time), not edited');
check(item('S1-0003').stock === 2, 'stock still 2 (one piece out)');
const credits1 = openCredits(ports, 'S1');
check(credits1.length === 2 && credits1.some(c => c.owed === 12000) && credits1.some(c => c.owed === 500000), 'open credits: 12,000 and 500,000, both Daw Myint');
check(sim.button(sim.lastBot(U.sister), 'ငွေလက်ခံ') !== null && sim.button(sim.lastBot(U.sister), 'မကျေသေး') === null, 'reply offers Receive payment, no second "not fully paid"');

step('21. Reports as documents: owed list, this month, stock, today');
sim.start(U.owner, '');
sim.tapLast(U.owner, 'စာရင်း');
sim.tapLast(U.owner, 'အကြွေးစာရင်း');
let doc = sim.lastBot(U.owner).document;
check(doc && doc.name.startsWith('owed-') && doc.report.sections[0].rows.length === 2, 'owed PDF lists both open credits');
check(doc.report.sections[0].totals[0][6] === 512000, 'owed total 512,000');
sim.tapAny(U.owner, 'ဒီလ');
doc = sim.lastBot(U.owner).document;
check(doc.report.kind === 'month' && doc.report.sections[0].rows[0][0].includes('ဆိုင် ၁') && doc.report.sections[0].rows[0][1] === 146000, 'month PDF: S1 revenue this month 146,000 (today 134,000 + credit sale 12,000)');
check(doc.report.sections.some(s => s.heading === 'စရံ လက်ခံထား' && s.rows.length === 1 && s.rows[0][3] === 300000), 'month PDF shows 300,000 deposit held');
sim.tapAny(U.owner, 'ပြီးခဲ့တဲ့လ');
doc = sim.lastBot(U.owner).document;
check(doc.report.kind === 'month' && doc.report.sections[0].rows[0][1] === 1000000 && doc.report.sections[0].rows[0][3] === 500000, 'last month PDF: sales 1,000,000, cash received 500,000 (the September credit sale)');
sim.tapAny(U.owner, 'ကုန်စာရင်း');
doc = sim.lastBot(U.owner).document;
check(doc.report.kind === 'stock' && doc.report.sections.length === 2 && doc.report.sections[0].rows.length >= 4, 'stock PDF has a section per shop');
sim.tapAny(U.owner, 'ဒီနေ့');
doc = sim.lastBot(U.owner).document;
check(doc.report.kind === 'day' && doc.report.sections[0].rows.length > 5, 'today PDF lists the day\'s rows');

step('22. Receive payment by buttons: the 12,000 credit, pay all');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'ငွေလက်ခံ');
let payList = sim.lastBot(U.sister);
check((payList.keyboard || []).length === 3 && sim.button(payList, '12,000') !== null && sim.button(payList, '500,000') !== null, 'lists both credits as buttons');
sim.tapLast(U.sister, '12,000');
check(lastText(U.sister).includes('ကျန် 12,000'), 'asks the amount, showing what is owed');
sim.tapLast(U.sister, 'အကုန်');
const pay1 = lastRow();
check(pay1.type === 'PAYMENT' && pay1.amount === 12000 && pay1.cash === 12000 && pay1.refGroupId === creditSale.groupId && pay1.customerId === 'C-0001', 'PAYMENT row 12,000 referencing the sale');
check(lastText(U.sister).includes('ကျန် 0'), 'reply shows remaining 0');
check(openCredits(ports, 'S1').length === 1 && openCredits(ports, 'S1')[0].owed === 500000, 'only the 500,000 credit remains open');

step('23. Voice payment: "ဒေါ်မြင့် ငါးသိန်း ပေးသွားတယ်", then undo it');
sim.voice(U.sister, 'ဒေါ်မြင့် ငါးသိန်း ပေးသွားတယ်');
check(lastText(U.sister).includes('500,000') && lastText(U.sister).includes('ဒေါ်မြင့်') && sim.button(sim.lastBot(U.sister), 'မှန်တယ်') !== null, 'proposal: Daw Myint pays 500,000');
sim.tapLast(U.sister, 'မှန်တယ်');
check(lastRow().type === 'PAYMENT' && lastRow().amount === 500000 && lastRow().source === 'VOICE', 'PAYMENT 500,000 from voice');
check(openCredits(ports, null).length === 0, 'no open credits anywhere');
sim.tapLast(U.sister, 'မှားသွားတယ်');
check(openCredits(ports, 'S1').length === 1 && openCredits(ports, 'S1')[0].owed === 500000, 'undo of the payment reopens the credit');
sim.voice(U.sister, 'ဒေါ်မြင့် ငါးသိန်း ပေးသွားတယ်');
sim.tapLast(U.sister, 'မှန်တယ်');
check(openCredits(ports, null).length === 0, 'paid again: closed');

step('24. Deposit by buttons: Daw Khin, 100,000, skip note');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'စရံ');
check(sim.button(sim.lastBot(U.sister), 'ဒေါ်ခင်') !== null, 'asks who, with Daw Khin as a button');
sim.tapLast(U.sister, 'ဒေါ်ခင်');
check(sim.button(sim.lastBot(U.sister), '100,000') !== null, 'amount presets shown');
sim.tapLast(U.sister, '100,000');
check(lastText(U.sister).includes(MSG.dep_ask_note.slice(0, 8)), 'asks what the deposit is for');
sim.tapLast(U.sister, 'ကျော်');
check(lastRow().type === 'DEPOSIT' && lastRow().amount === 100000 && lastRow().customerId === 'C-0002' && depositsFor(ports, 'C-0002') === 400000, 'DEPOSIT 100,000: Daw Khin now holds 400,000');

step('25. Delivery of the order: sell, not fully paid, 0 now, Daw Khin, use deposit');
sim.start(U.sister, 'S1-0004');
sim.tapLast(U.sister, 'ရောင်းပြီး');
sim.tapLast(U.sister, 'မကျေသေး');
sim.tapLast(U.sister, '0');
sim.tapAny(U.sister, 'ဒေါ်ခင်');
check(lastText(U.sister).includes('400,000') && sim.button(sim.lastBot(U.sister), 'စရံ သုံးမယ်') !== null, 'bot offers to use the 400,000 deposit');
sim.tapLast(U.sister, 'စရံ သုံးမယ်');
const applied = lastRow();
check(applied.type === 'DEPOSIT_APPLIED' && applied.amount === 45000 && applied.cash === 0, 'DEPOSIT_APPLIED 45,000, no cash moved');
check(saleGroupInfo(ports, applied.groupId).owed === 0 && depositsFor(ports, 'C-0002') === 355000, 'sale fully settled, deposit held drops to 355,000');
check(openCredits(ports, 'S1').length === 0, 'nothing owed');

step('26. Voice deposit from a new customer: "ဒေါ်စန်း စရံ နှစ်သိန်း ပေးသွားတယ်"');
sim.voice(U.sister, 'ဒေါ်စန်း စရံ နှစ်သိန်း ပေးသွားတယ်');
check(lastText(U.sister).includes('ဒေါ်စန်း') && lastText(U.sister).includes('200,000'), 'proposal names the new customer and 200,000');
sim.tapLast(U.sister, 'မှန်တယ်');
check(world.customers.length === 3 && world.customers[2].name === 'ဒေါ်စန်း' && depositsFor(ports, 'C-0003') === 200000, 'customer created on confirm, deposit held 200,000');

step('27. Receipt after a sale, as text and as PDF');
sim.start(U.sister, 'S1-0005');
sim.tapLast(U.sister, 'ရောင်း ၁');
sim.tapLast(U.sister, 'ဘောက်ချာ');
let receipt = sim.lastBot(U.sister);
check(/R1-\d{6}/.test(receipt.text) && receipt.text.includes('22,000') && receipt.text.includes('ထမီ ဇင်းမယ်'), 'receipt text has a number, the item and the amount');
sim.tapLast(U.sister, 'PDF');
check(/^R1-\d{6}\.pdf$/.test(sim.lastBot(U.sister).document.name), 'receipt PDF document sent');

step('28. Price pending: designer registers a sample without a price, owner is pinged and sets it');
const ownerMsgsBefore = (world.chats[U.owner.id] || []).length;
sim.start(U.sister, 'S1-0009');
sim.photo(U.sister, SIM_PHOTOS[2]);
sim.tapLast(U.sister, 'စျေး မသတ်မှတ်ရသေး');
sim.tapLast(U.sister, 'ကျော်');
check(item('S1-0009').status === 'ACTIVE' && item('S1-0009').price === '', 'item created with no price');
let pendingCard = sim.lastBot(U.sister);
check(pendingCard.text.includes('ဆိုင်ရှင်ကို မေးပါ') && sim.button(pendingCard, 'ရောင်းပြီး') === null && sim.button(pendingCard, 'စျေးသတ်မှတ်') !== null, 'card says ask the owner, has no Sold button, offers Set price');
let ownerPing = sim.lastBot(U.owner);
check((world.chats[U.owner.id] || []).length > ownerMsgsBefore && ownerPing.text.includes('S1-0009') && sim.button(ownerPing, '30,000') !== null, 'owner got a message with price buttons');
sim.tapLast(U.owner, '30,000');
check(item('S1-0009').price === 30000, 'owner set the price to 30,000');
sim.start(U.sister, 'S1-0009');
check(sim.button(sim.lastBot(U.sister), 'ရောင်းပြီး') !== null, 'sister now sees a Sold button');

step('29. Sample flag: toggle on the price screen, shows in the card and the monthly report');
sim.start(U.sister, 'S1-0010');
sim.photo(U.sister, SIM_PHOTOS[3]);
sim.tapLast(U.sister, 'နမူနာ: မဟုတ်');
check(sim.button(sim.lastBot(U.sister), 'နမူနာ: ဟုတ်') !== null, 'toggle flips to sample: yes');
sim.tapLast(U.sister, '45,000');
sim.tapLast(U.sister, 'ကျော်');
check(item('S1-0010').sample === true && lastText(U.sister).includes('(နမူနာ)'), 'item flagged as sample, card shows the mark');
sim.tapLast(U.sister, 'ရောင်းပြီး');
check(monthStats(ports, 'S1', monthKey(ports.clock.now())).samplesSold === 1, 'monthly stats count 1 sample sold');

step('30. Recent items without a tag');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'မကြာသေးမီ');
let recent = sim.lastBot(U.sister);
check(sim.button(recent, 'S1-0010') === 'K|S1-0010' && sim.button(recent, 'S1-0005') !== null, 'recent list offers the last sold items as buttons');
sim.tapLast(U.sister, 'S1-0005');
check(lastText(U.sister).includes('S1-0005') && sim.button(sim.lastBot(U.sister), 'ရောင်း ၁') !== null, 'tapping one opens its card');

step('31. Notebook photo import: three handwritten lines, one ambiguous');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'စာအုပ်');
check(lastText(U.sister).includes(MSG.nb_ask_photo.slice(0, 6)), 'asks for the page photo');
const msgsBefore = world.chats[U.sister.id].length;
sim.photo(U.sister, SIM_PHOTOS[5]);
const nbMsgs = world.chats[U.sister.id].slice(msgsBefore + 1);
check(nbMsgs.length === 3, 'one message per line');
check(nbMsgs[0].text.includes('ထမီ ချည်သား အနီ') && sim.button(nbMsgs[0], 'မှန်တယ်') !== null, 'line 1 matched the red htamein uniquely');
check(nbMsgs[1].text.includes('လုံချည် ကချင်') && nbMsgs[1].text.includes('36,000'), 'line 2 matched the Kachin longyi with the written total');
check(nbMsgs[2].text.includes('ဘယ်ပစ္စည်းလဲ') && (nbMsgs[2].keyboard || []).length >= 3, 'line 3 ("ထမီ") is ambiguous and asks which item');
const stockBefore = item('S1-0002').stock;
sim.tap(U.sister, nbMsgs[0].id, sim.button(nbMsgs[0], 'မှန်တယ်'));
sim.tap(U.sister, nbMsgs[1].id, sim.button(nbMsgs[1], 'မှန်တယ်'));
sim.tap(U.sister, nbMsgs[2].id, sim.button(nbMsgs[2], 'S1-0005'));
sim.tapLast(U.sister, 'မှန်တယ်');
const nbRows = world.ledger.slice(-3);
check(nbRows.every(r => r.type === 'SALE' && r.source === 'NOTEBOOK') && item('S1-0002').stock === stockBefore - 2, 'three SALE rows with source NOTEBOOK, stock moved');

step('32. Import the product list from the old software');
const imp = importProducts(ports, [
  { Code: 'S2-0004', Name: 'ထမီ ပိုး အစိမ်း', Category: 'ထမီ', Type: 'SKU', Price: 28000, Cost: 14000, Stock: 6, Shop: 'S2' },
  { Code: 'LG-77', Name: 'လုံချည် ချည် အညို', Category: 'လုံချည်', Type: 'SKU', Price: 15000, Cost: 7000, Stock: 4, Shop: 'S2' },
  { Code: 'X-1', Name: '', Category: 'ထမီ', Price: 1, Stock: 1, Shop: 'S2' }
], { id: 'owner', name: 'owner', shop: 'S1', role: 'owner' });
check(imp.done.length === 2 && imp.skipped.length === 1, '2 imported, 1 skipped (no name)');
check(item('S2-0004').name === 'ထမီ ပိုး အစိမ်း' && item('S2-0004').stock === 6, 'code that matches a blank tag is used directly');
check(item('S2-0005').alias === 'LG-77' && item('S2-0005').stock === 4 && findItemsByName(ports, 'S2', 'LG-77')[0].id === 'S2-0005', 'other code becomes an alias on the next blank tag and is searchable');

step('33. Daily summary carries the new lines');
const summary = buildDailySummary(ports, dayKey(ports.clock.now()));
console.log('\n' + summary.split('\n').map(l => '    ' + l).join('\n'));
check(summary.includes('ငွေသား') && summary.includes('ဘဏ်') && summary.includes('စရံ လက်ခံထား 555,000'), 'summary shows drawer, bank and 555,000 deposits held');
check(summary.includes('လက်ကျန်နည်း'), 'summary flags low stock');

step('34. Undo of a credit sale closes the credit; undo of a delivery returns the deposit');
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ရောင်း ၁');
sim.tapLast(U.sister, 'မကျေသေး');
sim.tapLast(U.sister, '0');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const g34 = lastRow().groupId;
check(openCredits(ports, 'S1').some(c => c.groupId === g34), 'credit sale is open');
sim.tapLast(U.sister, 'မှားသွားတယ်');
check(!openCredits(ports, 'S1').some(c => c.groupId === g34) && saleGroupInfo(ports, g34).voided, 'undo closes the credit and voids the group');
check(lastRow().groupId === g34 && lastRow().reversesTxId, 'mirror rows stay in the group they reverse');
const heldBefore34 = depositsFor(ports, 'C-0002');
const u34 = undoGroup(ports, applied.groupId, { id: '1001' });
check(u34.ok && depositsFor(ports, 'C-0002') === heldBefore34 + 45000 && saleGroupInfo(ports, applied.groupId).voided, 'undoing the delivery group returns the applied deposit');
check(item('S1-0004').stock === 1, 'and the piece is back in stock');

/* ============ round two: customers, payment method, expenses, PC, void (design A, tests 34-56) ============ */

step('35. Quantity grid and the default payment method: a button sale is CASH and offers 🏦 buttons');
sim.start(U.sister, 'S1-0002');
sim.tapLast(U.sister, 'ကုန်ရောက်');
sim.tapLast(U.sister, '+၂၀');                                              // S1-0002 went negative through the notebook import; refill
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ကုန်ရောက်');
sim.tapLast(U.sister, '+၁၀');
sim.start(U.sister, 'S1-0002');
sim.tapLast(U.sister, 'အရေအတွက်');
const grid = sim.lastBot(U.sister);
check(sim.button(grid, '၂') === 'S|S1-0002|2' && sim.button(grid, '၉') === 'S|S1-0002|9' && sim.button(grid, 'ရိုက်မယ်') === 'QN|S1-0002' && sim.button(grid, 'မလုပ်တော့') === 'Z',
  'quantity grid: ၂..၉ sell through the same S|id|N action, plus "type it" and cancel');
sim.tapLast(U.sister, '၂');
const sale35 = lastRow(), g35 = sale35.groupId;
check(sale35.type === 'SALE' && sale35.qty === -2 && sale35.amount === 36000 && sale35.method === 'CASH', 'grid sale of 2: Method CASH by default');
const card35 = sim.lastBot(U.sister);
check(sim.button(card35, 'KBZPay') === 'PM|' + g35 + '|KBZ' && sim.button(card35, 'WavePay') === 'PM|' + g35 + '|WAVE' && sim.button(card35, 'ဘဏ်လွှဲ') === 'PM|' + g35 + '|BANK',
  'one 🏦 button per non-cash method, PM|group|KEY');
check(sim.button(card35, 'ဝယ်သူ') === 'CU|' + g35 && sim.button(card35, 'မကျေသေး') === 'CR|' + g35 && sim.button(card35, 'ငွေသား') === null, 'card also offers 👤 customer and "not fully paid", no 💵 while it is cash');
sim.start(U.sister, 'S1-0002');
sim.tapLast(U.sister, 'အရေအတွက်');
sim.tapLast(U.sister, 'ရိုက်မယ်');
sim.text(U.sister, '၄');
check(lastRow().type === 'SALE' && lastRow().qty === -4 && lastRow().amount === 72000, 'typed quantity ၄ sells four through the same action');
sim.tapLast(U.sister, 'မှားသွားတယ်');
check(item('S1-0002').stock === 16, 'undone: stock back to 16');

step('36. Mark the sale as KBZPay: the rewrite keeps the GroupID');
const n36 = world.ledger.length, rcpt36 = receiptNumber(ports, g35), stock36 = item('S1-0002').stock;
const stats36a = dayStats(ports, 'S1', today);
sim.tap(U.sister, card35.id, sim.button(card35, 'KBZPay'));
check(world.ledger.length === n36 + 2 && world.ledger.slice(-2).every(r => r.groupId === g35), 'two rows appended (mirror + replacement), both in the original group');
const mir36 = world.ledger[world.ledger.length - 2], rep36 = world.ledger[world.ledger.length - 1];
check(mir36.reversesTxId === sale35.txId && mir36.cash === -36000 && mir36.qty === 2 && mir36.method === 'CASH' && mir36.note === 'rewrite' && mir36.source === 'UNDO',
  'mirror: reverses the original, cash -36,000, method CASH, note rewrite');
check(rep36.method === 'KBZ' && rep36.cash === 36000 && rep36.qty === -2 && rep36.time === sale35.time && rep36.day === sale35.day && !rep36.reversesTxId,
  'replacement: KBZ, 36,000, keeps the original Time and Day');
const info36 = saleGroupInfo(ports, g35);
check(info36.total === 36000 && info36.cash === 36000 && info36.owed === 0 && liveOf(g35).length === 1 && info36.method === 'KBZ', 'group: one live row, total 36,000, nothing owed, method KBZ');
const stats36b = dayStats(ports, 'S1', today);
check(stats36b.byMethod.KBZ.in === 36000 && stats36b.byMethod.CASH.in === stats36a.byMethod.CASH.in - 36000 && stats36b.cashIn === stats36a.cashIn,
  'day stats: KBZ in +36,000, CASH in -36,000, cash in unchanged');
check(receiptNumber(ports, g35) === rcpt36 && card35.text.includes('KBZPay') && item('S1-0002').stock === stock36, 'receipt number stable, card says KBZPay, stock unchanged');
check(sim.button(card35, 'KBZPay') === null && sim.button(card35, 'ငွေသား') === 'PM|' + g35 + '|CASH' && sim.button(card35, 'WavePay') !== null, 'buttons now offer 💵 ငွေသား and the other wallets');
sim.tap(U.sister, card35.id, sim.button(card35, 'ဘောက်ချာ'));
check(lastText(U.sister).includes('(KBZPay)') && lastText(U.sister).includes(rcpt36), 'receipt says how it was paid');
check(printableRows(ports, world.ledger, world.ledger.filter(r => r.groupId === g35)).length === 1 &&
  printableRows(ports, world.ledger, world.ledger.filter(r => r.groupId === g35))[0].mark === MSG.rep_rewrite_mark, 'reports print the rewrite as one line marked (ပြင်)');

step('37. Undo after a method change voids the sale once');
sim.tap(U.sister, card35.id, 'U|' + g35);
check(saleGroupInfo(ports, g35).voided && item('S1-0002').stock === stock36 + 2 && dayStats(ports, 'S1', today).byMethod.KBZ.in === 0, 'undo voids the KBZ sale: stock back, KBZ bucket 0');
const n37 = world.ledger.length;
sim.tap(U.sister, card35.id, 'U|' + g35);
check(card35.text === MSG.undo_already && world.ledger.length === n37, 'a second Undo tap writes nothing and says already undone');
const printed37 = printableRows(ports, world.ledger, world.ledger.filter(r => r.groupId === g35));
check(printed37.length === 2 && printed37[0].mark === MSG.rep_rewrite_mark && printed37[1].mark === MSG.rep_undo_mark, 'the group prints as the sale (ပြင်) and its undo (ပြန်ဖျက်)');

step('38. Rewrite refused on another day');
sim.start(U.sister, 'S1-0002');
sim.tapLast(U.sister, 'ရောင်း ၁');
const g38 = lastRow().groupId, n38 = world.ledger.length;
world.nowOverride = new Date(Date.now() + 24 * 3600 * 1000);
sim.tapLast(U.sister, 'KBZPay');
check(lastText(U.sister).includes(MSG.rewrite_refused) && world.ledger.length === n38, 'next day: method change refused with the "today only" line, nothing written');
world.nowOverride = null;

step('39. Attach a customer to a fully paid sale');
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ရောင်း ၁');
const g39 = lastRow().groupId, credits39 = openCredits(ports, 'S1').length, sum39 = customerSummary(ports, 'C-0001');
sim.tapLast(U.sister, 'ဝယ်သူ');
check(sim.button(sim.lastBot(U.sister), 'ဒေါ်မြင့်') === 'CUP|' + g39 + '|C-0001' && sim.button(sim.lastBot(U.sister), 'နာမည်အသစ်') === 'CUP|' + g39 + '|new', 'picker: recent customers and "new name"');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const live39 = liveOf(g39);
check(live39.length === 1 && live39[0].customerId === 'C-0001' && live39[0].cash === live39[0].amount && live39[0].amount === 12000, 'live SALE row carries C-0001 and stays fully paid');
check(openCredits(ports, 'S1').length === credits39, 'no credit opened');
const reply39 = sim.lastBot(U.sister);
check(sim.button(reply39, 'မကျေသေး') !== null && sim.button(reply39, 'ငွေလက်ခံ') === null && sim.button(reply39, 'ဝယ်သူ') === null, 'reply keeps "not fully paid" and has no "receive payment" (credit state comes from owed)');
const sum39b = customerSummary(ports, 'C-0001');
check(sum39b.bought === sum39.bought + 12000 && sum39b.paid === sum39.paid + 12000 && sum39b.owed === sum39.owed, 'customer summary: bought and paid +12,000, owed unchanged');

step('40. New customer with a phone, typed with Burmese digits and spaces');
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ရောင်း ၁');
sim.tapLast(U.sister, 'ဝယ်သူ');
sim.tapLast(U.sister, 'နာမည်အသစ်');
sim.text(U.sister, 'မစုစု');
const su = world.customers.filter(c => c.name === 'မစုစု')[0];
check(!!su && liveOf(lastRow().groupId)[0].customerId === su.id, 'customer created and attached');
check(sim.button(sim.lastBot(U.sister), 'ဖုန်း ထည့်') === 'CF|' + su.id, 'reply offers 📱 add phone');
sim.tapLast(U.sister, 'ဖုန်း ထည့်');
const rows40 = world.ledger.length;
sim.text(U.sister, '09 ၇၇၇ 123 456');
check(ports.store.getCustomer(su.id).phone === '09777123456' && world.ledger.length === rows40, 'phone stored as 09777123456, no ledger row (not taken as a price)');
check(lastText(U.sister).includes('+95 977 712 3456'), 'reply shows the tappable international form');

step('41. Customers menu, history card, statement PDF, search by digits');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'ဝယ်သူများ');
const custList = sim.lastBot(U.sister);
check(sim.button(custList, 'ဒေါ်မြင့်') === 'CH|C-0001' && sim.button(custList, 'ရှာ') === 'M|cfind', 'customers menu lists recent customers plus search');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const cardC = sim.lastBot(U.sister);
check(['ဝယ်ပြီး', 'ပေးပြီး', 'ကျန်', 'စရံ', 'နောက်ဆုံး', 'ကြိမ်'].every(w => cardC.text.includes(w)) && cardC.text.includes('+95 912'), 'customer card: bought, paid, owed, deposit, last visit, visits, phone');
check(cardC.text.split('\n').some(l => l.includes('ရောင်း') && (l.includes('ငွေသား') || l.includes('KBZPay'))), 'history lines carry the method');
const owed41 = customerSummary(ports, 'C-0001').owed;
check(sim.button(cardC, 'စာရင်း PDF') === 'CS|C-0001' && sim.button(cardC, 'စရံ') === 'DC|C-0001' && sim.button(cardC, 'ဖုန်း') === 'CF|C-0001' &&
  ((sim.button(cardC, 'ငွေလက်ခံ') !== null) === (owed41 > 0)), 'buttons: statement PDF, deposit, phone; receive payment only when owed');
sim.tapLast(U.sister, 'စာရင်း PDF');
const stmt = sim.lastBot(U.sister).document;
check(stmt && stmt.name.startsWith('customer-C-0001') && stmt.report.kind === 'customer' && stmt.report.sections[1].columns.includes('နည်းလမ်း') && stmt.report.title.includes('ဒေါ်မြင့်'),
  'statement PDF for Daw Myint with a method column');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'ဝယ်သူများ');
sim.tapLast(U.sister, 'ရှာ');
sim.text(U.sister, '0977');
check(sim.button(sim.lastBot(U.sister), 'မစုစု') === 'CH|' + su.id, 'search by phone digits finds the new customer');

step('42. Voice sale with method: "ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်"');
sim.start(U.sister, 'S1-0002');
sim.voice(U.sister, 'ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်');
check(lastText(U.sister).includes('KBZPay') && lastText(U.sister).includes('36,000'), 'proposal shows 36,000 and KBZPay');
sim.tapLast(U.sister, 'မှန်တယ်');
check(lastRow().method === 'KBZ' && lastRow().source === 'VOICE' && lastRow().qty === -2, 'voice sale committed with Method KBZ');

step('43. Voice method-only after a button sale: "Wave နဲ့ ပေးသွားတယ်"');
sim.start(U.sister, 'S1-0002');
sim.tapLast(U.sister, 'ရောင်း ၁');
const g43 = lastRow().groupId;
sim.voice(U.sister, 'Wave နဲ့ ပေးသွားတယ်');
check(lastText(U.sister).includes('WavePay') && lastText(U.sister).includes('18,000') && sim.button(sim.lastBot(U.sister), 'မှန်တယ်') !== null, 'proposal: WavePay for the last sale (18,000)');
sim.tapLast(U.sister, 'မှန်တယ်');
const live43 = liveOf(g43);
check(live43.length === 1 && live43[0].method === 'WAVE' && live43[0].source === 'VOICE' && lastRow().groupId === g43, 'the sale group now reads WAVE, same GroupID');
sim.voice(U.owner, 'Wave နဲ့ ပေးသွားတယ်');
check(lastText(U.owner).includes(MSG.method_nothing.slice(0, 8)), 'with nothing recent to refer to, the bot says so instead of guessing');

step('44. Payment and deposit by bank');
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ရောင်း ၁');
sim.tapLast(U.sister, 'မကျေသေး');
sim.tapLast(U.sister, '0');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const gCredit44 = lastRow().groupId;
check(openCredits(ports, 'S1').some(c => c.groupId === gCredit44 && c.owed === 12000), 'a 12,000 credit for Daw Myint is open');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'ငွေလက်ခံ');
sim.tapLast(U.sister, '12,000');
sim.tapLast(U.sister, 'အကုန်');
const pay44 = lastRow();
check(pay44.type === 'PAYMENT' && pay44.method === 'CASH' && sim.button(sim.lastBot(U.sister), 'KBZPay') === 'PM|' + pay44.groupId + '|KBZ', 'payment recorded as cash, 🏦 buttons under the reply');
sim.tapLast(U.sister, 'KBZPay');
const livePay = liveOf(pay44.groupId);
check(livePay.length === 1 && livePay[0].method === 'KBZ' && livePay[0].refGroupId === gCredit44 && openCredits(ports, 'S1').length === 0, 'payment now KBZ, still references the sale, credit closed');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'စရံ');
sim.tapLast(U.sister, 'ဒေါ်ခင်');
sim.tapLast(U.sister, '100,000');
sim.tapLast(U.sister, 'ကျော်');
const dep44 = lastRow(), held44 = depositsFor(ports, 'C-0002');
check(dep44.type === 'DEPOSIT' && dep44.method === 'CASH' && sim.button(sim.lastBot(U.sister), 'ဖုန်း ထည့်') === 'CF|C-0002', 'deposit recorded as cash; Daw Khin has no phone so 📱 is offered');
sim.tapLast(U.sister, 'ဘဏ်လွှဲ');
const liveDep = liveOf(dep44.groupId);
check(liveDep.length === 1 && liveDep[0].method === 'BANK' && depositsFor(ports, 'C-0002') === held44, 'deposit now BANK, held amount unchanged by the rewrite');

step('45. Expense by buttons, cash: category -> amount -> method, three taps');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'ကုန်ကျ');
const catMsg = sim.lastBot(U.sister);
check(sim.button(catMsg, 'ဖုန်းဘေလ်') === 'EC|phone' && sim.button(catMsg, 'ထမင်းဖိုး') === 'EC|food' && sim.button(catMsg, 'ဆိုင် ၁') === null, 'staff: category grid at once, no shop question');
sim.tapLast(U.sister, 'ဖုန်းဘေလ်');
check(sim.button(sim.lastBot(U.sister), '10,000') === 'EA|10000' && sim.button(sim.lastBot(U.sister), 'အခြား') === 'EA|other', 'amount presets and "other"');
sim.tapLast(U.sister, '10,000');
const methMsg = sim.lastBot(U.sister);
check(methMsg.keyboard[0][0].text.includes('ငွေသား') && sim.button(methMsg, 'KBZPay') === 'EM|KBZ', 'method buttons, cash first');
const exp45 = dayStats(ports, 'S1', today).expenses;
sim.tapLast(U.sister, 'ငွေသား');
const e45 = lastRow();
check(e45.type === 'EXPENSE' && e45.amount === -10000 && e45.cash === -10000 && e45.category === 'phone' && e45.method === 'CASH' && e45.shop === 'S1' && e45.itemId === '',
  'EXPENSE row: -10,000 cash, category phone, Method CASH, S1, no item');
check(sim.button(sim.lastBot(U.sister), 'မှားသွားတယ်') === 'U|' + e45.groupId && sim.button(sim.lastBot(U.sister), 'မှတ်ချက်') === 'EN|' + e45.groupId, 'done message offers Undo and an optional note');
const s45 = dayStats(ports, 'S1', today);
check(s45.expenses === exp45 + 10000 && s45.expensesByCategory.phone.total === 10000 && s45.expensesByCategory.phone.count === 1, 'day stats: expenses +10,000, phone category 10,000');

step('46. Expense with typed amount, bank, then a note');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'ကုန်ကျ');
sim.tapLast(U.sister, 'ထမင်းဖိုး');
sim.tapLast(U.sister, 'အခြား');
sim.text(U.sister, '၁၂၅၀၀');
check(lastText(U.sister).includes('12,500') && sim.button(sim.lastBot(U.sister), 'KBZPay') === 'EM|KBZ', 'typed Burmese digits become the amount; asks the method');
sim.tapLast(U.sister, 'KBZPay');
const e46 = lastRow();
check(e46.amount === -12500 && e46.category === 'food' && e46.method === 'KBZ' && e46.note === '', 'EXPENSE -12,500 food by KBZPay');
sim.tapLast(U.sister, 'မှတ်ချက်');
sim.text(U.sister, 'နေ့လယ်စာ ၃ ယောက်');
const live46 = liveOf(e46.groupId);
check(live46.length === 1 && live46[0].note === 'နေ့လယ်စာ ၃ ယောက်' && live46[0].method === 'KBZ' && live46[0].amount === -12500 && live46[0].category === 'food',
  'note attached by a rewrite inside the same group');
check(dayStats(ports, 'S1', today).byMethod.KBZ.out === 12500 && lastText(U.sister).includes('နေ့လယ်စာ ၃ ယောက်'), 'KBZ out 12,500 (the mirror nets out); reply echoes the note');

step('47. Owner expense asks the shop first');
sim.start(U.owner, '');
sim.tapLast(U.owner, 'ကုန်ကျ');
const shopMsg = sim.lastBot(U.owner);
check(sim.button(shopMsg, 'ဆိုင် ၁') === 'ES|S1' && sim.button(shopMsg, 'ဆိုင် ၂') === 'ES|S2', 'owner is asked which shop');
sim.tapLast(U.owner, 'ဆိုင် ၂');
sim.tapLast(U.owner, 'ကားခ');
sim.tapLast(U.owner, '5,000');
sim.tapLast(U.owner, 'ငွေသား');
check(lastRow().type === 'EXPENSE' && lastRow().shop === 'S2' && lastRow().category === 'transport' && lastRow().amount === -5000, 'owner expense lands on S2, category transport');

step('48. Voice expense with category and method: "ဖုန်းဘေလ် တစ်သောင်းခွဲ KBZ နဲ့ ပေးလိုက်တယ်"');
sim.voice(U.sister, 'ဖုန်းဘေလ် တစ်သောင်းခွဲ KBZ နဲ့ ပေးလိုက်တယ်');
check(lastText(U.sister).includes('ဖုန်းဘေလ်') && lastText(U.sister).includes('KBZPay') && lastText(U.sister).includes('15,000'), 'proposal: phone bill 15,000 by KBZPay');
sim.tapLast(U.sister, 'မှန်တယ်');
const e48 = lastRow();
check(e48.type === 'EXPENSE' && e48.category === 'phone' && e48.method === 'KBZ' && e48.amount === -15000 && e48.source === 'VOICE', 'EXPENSE -15,000 phone KBZ from voice');

step('49. Expense presets learn from history');
const presets49 = expensePresets(ports, 'phone');
check(presets49[0] === 10000 && presets49[1] === 15000 && presets49.length === 4, 'phone presets start with 10,000 and 15,000 (the amounts used), padded from Settings');

step('50. Reports carry method and category');
const m50 = buildReport(ports, 'month', { shop: null });
const methodSecs = m50.sections.filter(s => s.heading.indexOf(MSG.rep_by_method) === 0);
const s1Method = methodSecs.filter(s => s.heading.includes(shopName(ports, 'S1')))[0];
const kbzRow = s1Method && s1Method.rows.filter(r => r[0] === 'KBZPay')[0];
check(methodSecs.length === 2 && kbzRow && kbzRow[1] === monthStats(ports, 'S1', ym).byMethod.KBZ.in && kbzRow[3] === kbzRow[1] - kbzRow[2],
  'month PDF: cash-by-method section per shop; KBZPay in matches the stats, net = in - out');
const catSec = m50.sections.filter(s => s.heading.indexOf(MSG.rep_by_cat) === 0 && s.heading.includes(shopName(ports, 'S1')))[0];
const phoneRow50 = catSec && catSec.rows.filter(r => r[0] === 'ဖုန်းဘေလ်')[0];
check(phoneRow50 && phoneRow50[1] === 2 && phoneRow50[2] === 25000 && phoneRow50[3] === 15000, 'expenses by category: phone bill twice, 25,000, of which 15,000 from the bank');
const sumCols = m50.sections[0].columns, sumRow = m50.sections[0].rows[0];
check(sumCols.includes('ငွေသား') && sumCols.includes('ဘဏ်') && sumRow[sumCols.indexOf('ငွေသား')] + sumRow[sumCols.indexOf('ဘဏ်')] === sumRow[sumCols.indexOf('ငွေလက်ခံ')],
  'summary row: ငွေသား + ဘဏ် = ငွေလက်ခံ');
const d50 = buildReport(ports, 'today');
check(d50.sections[0].columns.includes('နည်းလမ်း') && d50.sections[0].rows.some(r => r[1].includes(MSG.rep_rewrite_mark)) && !d50.sections[0].rows.some(r => r[7] === 'rewrite'),
  'day report: method column, rewrites collapsed to one (ပြင်) line');
const e50 = buildReport(ports, 'exp');
const liveExp = liveRows(world.ledger, world.ledger).filter(r => r.type === 'EXPENSE' && String(r.day).slice(0, 7) === ym);
const expRows = e50.sections.filter(s => s.columns[0] === 'ရက်').reduce((a, s) => a + s.rows.length, 0);
check(e50.kind === 'exp' && e50.fileName === 'expenses-' + ym && expRows === liveExp.length && e50.sections.some(s => s.heading.indexOf(MSG.rep_by_cat) === 0),
  'expense report lists every live EXPENSE row of the month plus the by-category section');
sim.start(U.owner, '');
sim.tapLast(U.owner, 'စာရင်း');
sim.tapLast(U.owner, 'ကုန်ကျစရိတ်');
check(sim.lastBot(U.owner).document && sim.lastBot(U.owner).document.name === 'expenses-' + ym + '.pdf', 'report menu sends this month\'s expense PDF');

step('51. Daily summary reconciles drawer and bank (net movement)');
const sum51 = buildDailySummary(ports, today);
const m51 = sum51.match(/ငွေသား (-?[\d,]+) · 🏦 ဘဏ် (-?[\d,]+)/);
const st51 = dayStats(ports, 'S1', today);
check(!!m51 && num(m51[1]) === st51.drawerNet && num(m51[2]) === st51.bankNet && st51.drawerNet + st51.bankNet === st51.cashNet,
  'shop 1 line: net drawer ' + (m51 && m51[1]) + ' + net bank ' + (m51 && m51[2]) + ' = net cash');

step('52. Legacy row without Method counts as cash');
const legacy = world.ledger.filter(r => r.type === 'EXPENSE' && !r.method)[0];
check(!!legacy && legacy.shop === 'S2' && monthStats(ports, 'S2', ym).byMethod.CASH.out >= 5000 && methodOf(legacy) === 'CASH', 'seeded legacy EXPENSE row (blank Method) reads as CASH');
const dLegacy = buildReport(ports, 'day', { day: legacy.day, shop: 'S2' });
const legacyRow = dLegacy.sections[0].rows.filter(r => r[4] === -5000)[0];
check(legacyRow && legacyRow[6] === MSG.method_CASH && legacyRow[2] === MSG.cat_other, 'day report shows ငွေသား and the "other" category for it');

step('53. Settings override of pay methods');
world.settings.pay_methods = 'CASH,BANK';
sim.start(U.sister, 'S1-0002');
sim.tapLast(U.sister, 'ရောင်း ၁');
const card53 = sim.lastBot(U.sister);
const bankBtns = card53.keyboard.reduce((a, row) => a.concat(row.filter(b => b.text.indexOf('🏦') === 0)), []);
check(bankBtns.length === 1 && bankBtns[0].text.includes('ဘဏ်လွှဲ') && sim.button(card53, 'KBZPay') === null, 'pay_methods = CASH,BANK shows exactly one 🏦 button');
delete world.settings.pay_methods;
sim.tapLast(U.sister, 'မှားသွားတယ်');

step('54. PC / scanner path: a typed tag id or pasted link opens the card without AI');
const aiCalls = () => world.log.filter(l => l.kind === 'ai').length;
const ai54 = aiCalls();
sim.text(U.sister, 's1-0002');
check(lastText(U.sister).includes('S1-0002') && sim.button(sim.lastBot(U.sister), 'ရောင်း ၁') === 'S|S1-0002|1' && aiCalls() === ai54, 'typed "s1-0002" opens the card, no AI call');
sim.text(U.sister, 'https://t.me/SalesTagBot?start=S1-0005');
check(lastText(U.sister).includes('S1-0005') && aiCalls() === ai54, 'pasted tag link opens the card, no AI call');
check(MSG.help.includes('S1-0042'), 'help text tells the family they can type the tag id on a computer');

step('55. Credit conversion keeps the group id (regression for the rewrite refactor)');
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ရောင်း ၁');
const g55 = lastRow().groupId, rcpt55 = receiptNumber(ports, g55);
sim.tapLast(U.sister, 'မကျေသေး');
sim.tapLast(U.sister, '0');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const cr55 = openCredits(ports, 'S1').filter(c => c.groupId === g55)[0];
check(!!cr55 && cr55.owed === 12000 && receiptNumber(ports, g55) === rcpt55, 'credit conversion keeps the GroupID and the receipt number');
check(sim.button(sim.lastBot(U.sister), 'ငွေလက်ခံ') === 'PY|' + g55, 'receive-payment button points at the same group (no re-rendered id)');
sim.tapLast(U.sister, 'မှားသွားတယ်');
check(saleGroupInfo(ports, g55).voided && !openCredits(ports, 'S1').some(c => c.groupId === g55), 'undo voids the group and closes the credit');

step('56. Customers view columns and the view refresh');
const cs56 = customerSummaries(ports), m56 = cs56.filter(c => c.id === 'C-0001')[0];
const bought56 = world.ledger.filter(r => r.customerId === 'C-0001' && (r.type === 'SALE' || r.type === 'RETURN')).reduce((a, r) => a + r.amount, 0);
const owed56 = openCredits(ports, null).filter(c => c.customerId === 'C-0001').reduce((a, c) => a + c.owed, 0);
check(m56.bought === bought56 && m56.owed === owed56 && m56.lastDay === today && m56.visits >= 2, 'Daw Myint: bought = Σ SALE/RETURN, owed = Σ open credits, last visit today, 2+ visits');
check(world.views && world.views.argc === 3 && world.views.customers.some(c => c.id === su.id && c.phone === '09777123456') && ports.store.getCustomer(su.id).phone === '09777123456',
  'refreshViews got three arguments (credits, deposits, customers) and the phone survived every refresh');

step('57. Expired expense state');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'ကုန်ကျ');
sim.tapLast(U.sister, 'ကားခ');
ports.cache.remove('st:' + U.sister.id);
const n57 = world.ledger.length;
sim.tapLast(U.sister, '5,000');
check(lastText(U.sister) === MSG.expired && world.ledger.length === n57, 'a stale expense tap says expired and writes nothing');

step('58. Owner void: any group, any age; staff are refused');
const stock58 = item('S1-0002').stock;
const sisterMsg = sim.lastBot(U.sister);
sim.tap(U.sister, sisterMsg.id, 'V|' + g38);
check(lastText(U.sister) === MSG.void_owner_only && !saleGroupInfo(ports, g38).voided, 'staff get a short refusal, nothing changes');
world.nowOverride = new Date(Date.now() + 2 * 3600 * 1000);          // long after the 30-minute undo window
sim.start(U.owner, '');
const ownerMenu = sim.lastBot(U.owner);
sim.tap(U.owner, ownerMenu.id, 'V|' + g38);
world.nowOverride = null;
const vRow = lastRow();
check(saleGroupInfo(ports, g38).voided && vRow.groupId === g38 && vRow.source === 'UNDO' && vRow.note === 'void by owner' && item('S1-0002').stock === stock58 + 1,
  'owner void reverses the old sale: mirror in the group, Source UNDO, note "void by owner", stock back');
check(lastText(U.owner).includes(MSG.void_done) && lastText(U.owner).includes('S1-0002'), 'owner sees the void confirmation with the card');
check(voidButton(ports, g38).callback_data === 'V|' + g38 && voidButton(ports, g38).text === MSG.btn_void, 'voidButton() builds the button other code attaches to conflict pings');

step('59. Callback data size and the two-tap sale');
check(maxCb.len > 0 && maxCb.len < 64, 'every callback_data emitted during the scenario is under 64 bytes (longest ' + maxCb.len + ': ' + maxCb.data + ')');
sim.start(U.sister, 'S1-0002');
const n59 = world.ledger.length;
sim.tapLast(U.sister, 'ရောင်း ၁');
check(world.ledger.length === n59 + 1 && lastRow().type === 'SALE' && lastRow().qty === -1 && lastRow().method === 'CASH', 'START + one tap still records a one-piece cash sale');

step('59b. Settings pay_methods: a key too long for callback data is left out of the 🏦 buttons and logged once');
{
  const saved = world.settings.pay_methods, errs = world.errors.length;
  world.settings.pay_methods = 'CASH,KBZ,AYA_BANK_TRANSFER_ACCOUNT,ဘဏ်လွှဲငွေ';
  const keys = payMethods(ports);
  payMethods(ports);
  check(keys.join() === 'CASH,KBZ' && world.errors.length === errs + 2 && world.errors.slice(errs).every(e => e.where === 'pay_methods'),
    'AYA_BANK_TRANSFER_ACCOUNT (25 bytes) and a Burmese key (30 bytes) are dropped, one Errors row each, not repeated');
  sim.start(U.sister, 'S1-0002');
  sim.tapLast(U.sister, 'ရောင်း ၁');
  const kb59 = sim.lastBot(U.sister).keyboard.reduce((a, row) => a.concat(row), []);
  check(kb59.some(b => b.callback_data.endsWith('|KBZ')) && kb59.every(b => Buffer.byteLength(b.callback_data, 'utf8') < 64), 'the sale reply keeps the KBZ button and every callback stays under 64 bytes');
  sim.tapLast(U.sister, 'မှားသွားတယ်');
  if (saved === undefined) delete world.settings.pay_methods; else world.settings.pay_methods = saved;
}

step('60. Customer matching: an exact name is picked, a look-alike name asks instead of merging');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'စရံ');
sim.tapLast(U.sister, 'နာမည်အသစ်');
const custCount60 = world.customers.length;
sim.text(U.sister, 'ဒေါ်မြင့်');
check(world.customers.length === custCount60 && lastText(U.sister).includes('ဒေါ်မြင့်') && sim.button(sim.lastBot(U.sister), '100,000') === 'DA|C-0001|100000',
  'exact name: Daw Myint picked, no duplicate created, deposit amount asked');
sim.tapLast(U.sister, 'မလုပ်တော့');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'စရံ');
sim.tapLast(U.sister, 'နာမည်အသစ်');
sim.text(U.sister, 'ဒေါ်မြင့်စု');
const chooser = sim.lastBot(U.sister);
check(world.customers.length === custCount60 && chooser.keyboard[0][0].callback_data === 'DC|C-0001' && sim.button(chooser, 'အသစ် ဖန်တီး') === 'DC|create',
  'look-alike "ဒေါ်မြင့်စု": chooser offers Daw Myint and "create this name", nothing merged');
sim.tapLast(U.sister, 'အသစ် ဖန်တီး');
const created60 = world.customers[world.customers.length - 1];
check(world.customers.length === custCount60 + 1 && created60.name === 'ဒေါ်မြင့်စု' && sim.button(sim.lastBot(U.sister), '100,000') === 'DA|' + created60.id + '|100000',
  'create: new customer ဒေါ်မြင့်စု, deposit amount asked');
sim.tapLast(U.sister, 'မလုပ်တော့');

step('61. Customer card with two open credits routes "receive payment" to a filtered list');
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ရောင်း ၁');
sim.tapLast(U.sister, 'မကျေသေး');
sim.tapLast(U.sister, '0');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const gA = lastRow().groupId;
sim.start(U.sister, 'S1-0003');
sim.tapLast(U.sister, 'ရောင်း ၁');
sim.tapLast(U.sister, 'မကျေသေး');
sim.tapLast(U.sister, '0');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const gB = lastRow().groupId;
sim.start(U.sister, '');
sim.tapLast(U.sister, 'ဝယ်သူများ');
sim.tapAny(U.sister, 'ဒေါ်မြင့်');
const card61 = sim.lastBot(U.sister);
check(sim.button(card61, 'ငွေလက်ခံ') === 'PL|C-0001' && card61.text.includes('💳 ကျန် 24,000'), 'two open credits: card shows owed 24,000 and routes to her own pay list');
sim.tapLast(U.sister, 'ငွေလက်ခံ');
const list61 = sim.lastBot(U.sister);
check(list61.keyboard.length === 3 && list61.keyboard.every(row => row.every(b => b.callback_data === 'Z' || (b.text.includes('ဒေါ်မြင့်') && b.text.includes('12,000')))),
  'pay list filtered to Daw Myint: her two 12,000 credits plus cancel');
sim.tapLast(U.sister, 'မလုပ်တော့');
undoGroup(ports, gA, { id: '1001' });
undoGroup(ports, gB, { id: '1001' });
check(openCredits(ports, 'S1').length === 0 && customerSummary(ports, 'C-0001').owed === 0, 'both test credits undone; nothing owed');

/* ---------------- custom tailoring (plan 13.4, design B with the critic's fixes) ---------------- */
const order = id => ports.store.getOrder(id);
const groupLive = g => liveRows(world.ledger.filter(r => r.groupId === g), world.ledger);
const kbData = m => ((m && m.keyboard) || []).reduce((a, row) => a.concat(row.map(b => b.callback_data)), []);
const tapData = (user, data) => sim.tap(user, sim.lastBot(user).id, data);
let taps = 0;
world.listeners.push(evt => { if (evt.type === 'update' && evt.update.callback_query) taps++; });
/** Menu -> 🧵 -> ➕ -> customer button -> design button -> (first price preset when the design has none) -> qty 1: the order id. */
function newOrder(user, customerLabel, designLabel) {
  sim.start(user, '');
  sim.tapLast(user, '🧵 အော်ဒါ');
  sim.tapLast(user, 'အော်ဒါအသစ်');
  sim.tapLast(user, customerLabel);
  const id = world.orders[world.orders.length - 1].id;
  sim.tapLast(user, designLabel);
  if (/^OP\|/.test(kbData(sim.lastBot(user))[0])) tapData(user, kbData(sim.lastBot(user))[0]);
  sim.tapLast(user, '၁');
  return id;
}

step('62. Tailoring: a new order for a known customer, 7 taps from the menu to the voucher');
const ledger62 = world.ledger.length;
sim.start(U.sister, '');
check(sim.button(sim.lastBot(U.sister), '🧵 အော်ဒါ') === 'M|ord', 'the menu has the 🧵 orders button (below the everyday rows)');
const t62 = taps;
sim.tapLast(U.sister, '🧵 အော်ဒါ');
sim.tapLast(U.sister, 'အော်ဒါအသစ်');
sim.tapLast(U.sister, 'ဒေါ်မြင့်');
check(world.orders.length === 1 && order('V1-2532') && order('V1-2532').status === 'ORDERED' && order('V1-2532').customerId === 'C-0001',
  'the order row exists once the customer is picked: V1-2532 continues shop 1\'s paper book (Settings order_next_no_S1 2532)');
check(world.settings.order_next_no_S1 === 2533, 'Settings order_next_no_S1 moved on to 2533');
sim.tapLast(U.sister, 'TSL-0018');
check(lastText(U.sister).includes('ဘယ်နှစ်ထည်'), 'a design with a base price skips the price screen and asks the quantity');
sim.tapLast(U.sister, '၁');
const due62 = sim.lastBot(U.sister);
check(sim.button(due62, '✨') === 'OD|V1-2532|14' && due62.text.includes('150,000'), 'the due screen shows the line and offers the design\'s 14 making days first');
sim.tapLast(U.sister, '✨');
sim.tapLast(U.sister, 'တစ်ဝက်');
const v62 = sim.lastBot(U.sister);
check(taps - t62 === 7, '7 taps from the menu to the voucher (menu, new, customer, design, qty, due, advance): ' + (taps - t62));
check(v62.text.includes('ဘောက်ချာ 2532') && v62.text.includes('ဒေါ်မြင့်') && v62.text.includes('စုစုပေါင်း 150,000') && v62.text.includes('စရံ 75,000 (ငွေသား)') && v62.text.includes('ကျန် 75,000'),
  'voucher text: number, customer, total, the advance with its method, the balance');
check(v62.text.includes(world.settings.shop_brand_S1) && v62.text.includes(world.settings.shop_phone_S1), 'the voucher carries shop 1\'s letterhead (brand, phone)');
const o62 = order('V1-2532'), dep62 = lastRow();
check(o62.dueDay === addDaysKey(today, 14) && o62.total === 150000 && o62.voucherSentAt !== '', 'Orders row: due today + 14, Total snapshot 150,000, VoucherSentAt stamped');
check(world.ledger.length === ledger62 + 1 && dep62.type === 'DEPOSIT' && dep62.amount === 75000 && dep62.cash === 75000 && dep62.refGroupId === 'V1-2532' && dep62.customerId === 'C-0001' && dep62.method === 'CASH',
  'one ledger row: DEPOSIT 75,000 cash, RefGroupID V1-2532 (no money is stored on the order)');
check(depositEarmark(ports, 'C-0001', 'V1-2532') === 75000 && depositsFree(ports, 'C-0001') === 0, 'the advance is earmarked to the voucher, not in the customer\'s free pool');
check(kbData(v62).indexOf('MS|V1-2532') >= 0 && kbData(v62).indexOf('OVP|V1-2532') >= 0 && kbData(v62).indexOf('U|' + dep62.groupId) >= 0 && kbData(v62).some(d => d === 'PM|' + dep62.groupId + '|KBZ'),
  'voucher buttons: measure, PDF, card, 🏦 method of the advance, undo of the advance');

step('63. New customer with a Viber phone, two lines, a design typed by its alias, fabric, description, a typed date');
const ledger63 = world.ledger.length, cust63 = world.customers.length;
sim.start(U.sister, '');
sim.tapLast(U.sister, '🧵 အော်ဒါ');
sim.tapLast(U.sister, 'အော်ဒါအသစ်');
sim.tapLast(U.sister, 'နာမည်အသစ်');
sim.text(U.sister, 'မသီတာ');
check(world.customers.length === cust63 + 1 && lastText(U.sister).includes('မသီတာ') && lastText(U.sister).includes('ဖုန်း'), 'a new name is created at once and the phone is asked');
sim.text(U.sister, '09 7777 12345');
check(lastText(U.sister).includes('Viber'), 'the typed phone is echoed with "Viber?"');
sim.tapLast(U.sister, '✅ Viber');
const c63 = world.customers[world.customers.length - 1];
check(c63.name === 'မသီတာ' && c63.phone === '09777712345' && /viber/i.test(c63.note), 'customer saved with phone 09777712345 and Note Viber');
check(order('V1-2533') && order('V1-2533').customerId === c63.id && lastText(U.sister).includes('ဒီဇိုင်း'), 'order V1-2533 begun, design asked');
sim.tapLast(U.sister, 'ကုဒ် ရိုက်');
sim.text(U.sister, 'tsl 25');
check(lastText(U.sister).includes('TSL-0025') && lastText(U.sister).includes('စျေး'), 'typed "tsl 25" finds TSL-0025, which has no base price: the price is asked');
sim.tapLast(U.sister, 'အခြား');
sim.text(U.sister, '45000');
sim.tapLast(U.sister, '၂');
sim.tapLast(U.sister, '🧶 အထည်');
sim.tapLast(U.sister, 'ပိုး');
check(world.orderItems.filter(l => l.orderId === 'V1-2533').length === 1 && world.orderItems.filter(l => l.orderId === 'V1-2533')[0].fabric === 'ပိုး' &&
  world.orderItems.filter(l => l.orderId === 'V1-2533')[0].amount === 90000, 'line 1: TSL-0025 x 2 at 45,000 = 90,000, fabric ပိုး');
sim.tapLast(U.sister, 'နောက်တစ်ကြောင်း');
sim.text(U.sister, 'TSL-18');
check(lastText(U.sister).includes('ဘယ်နှစ်ထည်') && lastText(U.sister).includes('TSL-0018'), 'typed "TSL-18" on the design screen is the alias of TSL-0018');
sim.tapLast(U.sister, '၁');
sim.tapLast(U.sister, '📝 ဖော်ပြချက်');
sim.text(U.sister, 'လက်ရှည်');
const due63 = addDaysKey(today, 20);
sim.tapLast(U.sister, 'ရက်စွဲ ရိုက်');
sim.text(U.sister, Number(due63.slice(8)) + '.' + Number(due63.slice(5, 7)) + '.' + due63.slice(2, 4));
check(typeof MSG.ord_due_set === 'string' && order('V1-2533').dueDay === due63 &&
  world.chats[U.sister.id].some(m => m.from === 'bot' && m.text.indexOf(fmtDayMy(due63)) >= 0 && m.text.indexOf('ord_due_set') < 0),
  'a typed date d.m.yy is saved and echoed in Burmese');
check(lastText(U.sister).includes('240,000'), 'the advance screen shows the total 240,000');
tapData(U.sister, 'ODA|V1-2533|0');
const v63 = sim.lastBot(U.sister);
check(world.ledger.length === ledger63 && v63.text.includes('(Viber)') && v63.text.includes('ပိုး + TSL-0025 ရင်ဖုံး') && v63.text.includes('TSL-0018 ဝမ်းဆက် · လက်ရှည်') &&
  v63.text.includes('စရံ 0') && v63.text.includes('ကျန် 240,000'), 'advance 0: no ledger row; the voucher lists both lines (fabric, design, description), Viber, balance 240,000');
check(!kbData(v63).some(d => /^U\|/.test(d)), 'no undo button when no advance was taken');

step('64. Undo of the advance keeps the order; a later advance from the card');
sim.tap(U.sister, v62.id, 'U|' + dep62.groupId);
check(world.chats[U.sister.id].filter(m => m.id === v62.id)[0].text.includes(MSG.undo_done) && order('V1-2532').status === 'ORDERED' && depositEarmark(ports, 'C-0001', 'V1-2532') === 0,
  'undo reverses the DEPOSIT only: the order stays ORDERED with nothing earmarked');
check(groupLive(dep62.groupId).length === 0 && world.ledger.filter(r => r.groupId === dep62.groupId).length === 2, 'the deposit and its mirror stay in the ledger (append-only)');
sim.text(U.sister, 'V1-2532');
check(lastText(U.sister).includes('ဘောက်ချာ 2532') && lastText(U.sister).includes('စရံ 0'), 'a typed voucher id opens the card: deposit 0 now');
sim.tapLast(U.sister, 'စရံ ထပ်ပေး');
tapData(U.sister, 'ODA|V1-2532|100000');
check(lastRow().type === 'DEPOSIT' && lastRow().amount === 100000 && lastRow().refGroupId === 'V1-2532' && depositEarmark(ports, 'C-0001', 'V1-2532') === 100000,
  'more advance from the card: 100,000 earmarked to V1-2532');

step('65. Status moves forward only; READY pings the shop and the owner');
sim.text(U.sister, 'V1-2532');
const card65 = sim.lastBot(U.sister);
check(sim.button(card65, 'ဖြတ်နေ') === 'OS|V1-2532|CUTTING' && sim.button(card65, 'ချုပ်နေ') === 'OS|V1-2532|SEWING' && sim.button(card65, 'ရွေးနိုင်') === 'OS|V1-2532|READY',
  'the card offers the forward statuses');
check(sim.button(card65, 'ပယ်ဖျက်') === null, 'staff see no cancel button (owner only)');
sim.tap(U.sister, card65.id, 'OS|V1-2532|CUTTING');
check(order('V1-2532').status === 'CUTTING' && order('V1-2532').statusBy === '1001' && sim.button(world.chats[U.sister.id].filter(m => m.id === card65.id)[0], 'ဖြတ်နေ') === null,
  'CUTTING: status written, the card is redrawn without the passed step');
sim.tap(U.sister, card65.id, 'OS|V1-2532|ORDERED');
check(order('V1-2532').status === 'CUTTING' && lastText(U.sister) === MSG.ord_status_back, 'a backward move is refused');
const owner65 = (world.chats[U.owner.id] || []).length, brother65 = (world.chats[U.brother.id] || []).length;
sim.tap(U.sister, card65.id, 'OS|V1-2532|READY');
const ping65 = sim.lastBot(U.owner);
check(order('V1-2532').status === 'READY' && world.chats[U.owner.id].length === owner65 + 1 && ping65.text.includes('2532') && ping65.text.includes('ဒေါ်မြင့်') &&
  sim.button(ping65, 'အကြောင်းကြား') === 'ORM|V1-2532', 'READY (SEWING skipped): the owner gets a ping with the ready-message button');
check((world.chats[U.brother.id] || []).length === brother65, 'staff of the other shop are not pinged');
sim.tapLast(U.owner, 'အကြောင်းကြား');
check(lastText(U.owner).includes('လာရွေးနိုင်ပါပြီ') && lastText(U.owner).includes(world.settings.shop_brand_S1), 'the ready message to forward to the customer, with the shop brand');

step('66. Measurements by chat: answer, skip, Burmese digits, finish');
sim.text(U.sister, 'V1-2532');
sim.tapLast(U.sister, 'အတိုင်းအတာ');
check(lastText(U.sister).includes('ဒေါ်မြင့်') && sim.button(sim.lastBot(U.sister), 'တစ်ခုချင်း') !== null && sim.button(sim.lastBot(U.sister), 'ဓာတ်ပုံ') !== null,
  'no earlier session: straight to the method row (photo, one by one)');
sim.tapLast(U.sister, 'တစ်ခုချင်း');
const q1 = sim.lastBot(U.sister);
check(q1.text.includes('လည်ပင်း') && q1.text.includes(myDigits(CFG.MEASURE_FIELDS.length)), 'question 1/32: လည်ပင်း');
sim.text(U.sister, '32');
check(world.chats[U.sister.id].filter(m => m.id === q1.id)[0].text === '📏 လည်ပင်း · 32' && lastText(U.sister).includes('ပုခုံး'), 'the answered question is edited to "လည်ပင်း · 32"; ပုခုံး is next');
sim.tapLast(U.sister, 'ကျော်');
check(lastText(U.sister).includes('ရင်ကျယ်'), 'skip moves on to ရင်ကျယ်');
sim.voice(U.sister, '၁၄.၅');
check(lastText(U.sister).includes('ကျောကျယ်'), 'a spoken answer is taken as the value; ကျောကျယ် is next');
sim.tapLast(U.sister, 'ဒီလောက်ပဲ');
const sum66 = sim.lastBot(U.sister);
check(sum66.text.includes('လည်ပင်း · 32') && sum66.text.includes('ရင်ကျယ် · 14.5') && !sum66.text.includes('ပုခုံး') && sum66.text.includes('၂ ကွက်'),
  'finish: the summary lists the 2 answered fields (spoken Burmese digits stored as 14.5), the skipped one is absent');
const ledger66 = world.ledger.length;
sim.voice(U.sister, 'ဒါ ၂ ထည် ရောင်းရတယ်');
check(lastText(U.sister).includes('ရောင်း') && !lastText(U.sister).includes('📏') && world.ledger.length === ledger66, 'on the summary screen a spoken sale is not swallowed by the session (it reaches the AI)');
sim.tapAny(U.sister, 'သိမ်း');
const m66 = world.measurements[world.measurements.length - 1];
check(world.measurements.length === 1 && m66.id === 'M-00001' && m66.customerId === 'C-0001' && m66.orderId === 'V1-2532' && m66.source === 'CHAT' &&
  m66.fields.neck === '32' && m66.fields.chest_width === '14.5' && m66.fields.shoulder === '', 'saved as row M-00001 (CHAT), values as text, blanks empty');
check(order('V1-2532').measId === 'M-00001' && world.chats[U.sister.id].filter(m => m.id === sum66.id)[0].text.includes('M-00001'), 'the order points at M-00001; the summary turns into the saved line');

step('67. Measurements by photo of the paper sheet, a low-confidence cell fixed');
sim.text(U.sister, 'V1-2532');
sim.tapLast(U.sister, 'အတိုင်းအတာ');
check(lastText(U.sister).includes('M-00001') && sim.button(sim.lastBot(U.sister), 'အဟောင်း သုံး') !== null, 'an earlier session exists: use previous / measure anew');
sim.tapLast(U.sister, 'အသစ် တိုင်း');
sim.tapLast(U.sister, 'ဓာတ်ပုံ');
check(lastText(U.sister) === MSG.ms_ask_photo, 'asks for the photo of the filled sheet');
const ledger67 = world.ledger.length;
sim.photo(U.sister, SIM_PHOTOS.filter(p => p.key === 'meas_sheet_myint')[0]);
const sum67 = sim.lastBot(U.sister);
check(sum67.text.includes('ရင်မြင့် · 17.5 ❓') && sum67.text.includes('လက်ဝ · 36/30/20') && sum67.text.includes('လက်အရှည် · 7/3/20') && !sum67.text.includes('⚠️'),
  'the reading is shown with ❓ on the unsure cell; multi-values kept as written; the sheet name matches (no warning)');
check(sim.button(sum67, 'အကုန် မှန်') !== null && world.measurements.length === 1 && world.ledger.length === ledger67, 'nothing is saved before ✅');
sim.tapLast(U.sister, 'ပြင်');
sim.tapLast(U.sister, 'အပေါ်ပိုင်း');
check(sim.button(sim.lastBot(U.sister), 'ရင်မြင့် · 17.5 ❓') !== null, 'the field buttons show the values, the unsure one with ❓');
sim.tapLast(U.sister, 'ရင်မြင့်');
sim.text(U.sister, '18');
const sum67b = sim.lastBot(U.sister);
check(sum67b.text.includes('ရင်မြင့် · 18') && !sum67b.text.includes('❓'), 'fixed to 18: the ❓ is gone');
sim.tapLast(U.sister, 'အကုန် မှန်');
const m67 = world.measurements[world.measurements.length - 1];
check(m67.id === 'M-00002' && m67.source === 'PHOTO' && /^drive:/.test(m67.photoUrl) && m67.notes === 'No Bra' && m67.fields.bust_height === '18' &&
  m67.fields.sleeve_round === '36/30/20' && m67.fields.sleeve_length === '7/3/20' && m67.fields.htamein_side === 'ဘယ်' && typeof m67.fields.shoulder === 'string' && m67.fields.shoulder === '14.5',
  'M-00002 (PHOTO): photo link, margin note, "7/3/20" and "36/30/20" survive as text, 14.5 stays 14.5');
check(order('V1-2532').measId === 'M-00002' && world.measurements[0].fields.neck === '32', 'the order points at the newest session; M-00001 is untouched');
sim.start(U.sister, '');
sim.tapLast(U.sister, '🧵 အော်ဒါ');
sim.tapLast(U.sister, 'အတိုင်းအတာ');
sim.tapLast(U.sister, 'ဒေါ်ခင်');
sim.tapLast(U.sister, 'ဓာတ်ပုံ');
sim.photo(U.sister, SIM_PHOTOS.filter(p => p.key === 'meas_sheet_other')[0]);
check(lastText(U.sister).includes('⚠️') && lastText(U.sister).includes('မခင်ခင်'), 'a sheet with another name warns before saving');
sim.tapLast(U.sister, 'မလုပ်တော့');
check(world.measurements.length === 2, 'cancelled: nothing saved');

step('68. Copy the previous measurements; a fix of a saved row appends a new row');
sim.start(U.sister, '');
sim.tapLast(U.sister, '🧵 အော်ဒါ');
sim.tapLast(U.sister, 'အတိုင်းအတာ');
sim.tapLast(U.sister, 'ဒေါ်မြင့်');
sim.tapLast(U.sister, 'အဟောင်း သုံး');
check(lastText(U.sister).includes('လက်ဝ · 36/30/20') && lastText(U.sister).includes('ရင်မြင့် · 18'), 'the newest session (M-00002) is copied into the summary');
sim.tapLast(U.sister, 'သိမ်း');
const m68 = world.measurements[world.measurements.length - 1];
check(m68.id === 'M-00003' && m68.source === 'COPY' && m68.orderId === '' && JSON.stringify(m68.fields) === JSON.stringify(world.measurements[1].fields),
  'M-00003 (COPY) holds the same values, no order');
sim.tapLast(U.sister, 'ပြင်');
sim.tapLast(U.sister, 'ခါး · တင်');
sim.tapLast(U.sister, 'ခါး · 28');
sim.text(U.sister, '29');
sim.tapLast(U.sister, 'သိမ်း');
const m68b = world.measurements[world.measurements.length - 1];
check(m68b.id === 'M-00004' && m68b.fields.waist === '29' && m68b.notes.includes('fix of M-00003') && world.measurements[2].fields.waist === '28',
  'the fix is a new row M-00004 ("fix of M-00003"); M-00003 keeps 28');

step('69. Delivery paid in full in cash: one group = order id, the earmarked advance applied, status DELIVERED');
sim.text(U.sister, 'V1-2532');
check(sim.button(sim.lastBot(U.sister), 'ပေးအပ်') === 'ODL|V1-2532' && sim.button(sim.lastBot(U.sister), 'Tag တပ်') === 'OT|V1-2532', 'a READY card leads with deliver');
sim.tapLast(U.sister, 'ပေးအပ်');
check(lastText(U.sister).includes('စုစုပေါင်း 150,000') && lastText(U.sister).includes('စရံ 100,000') && lastText(U.sister).includes('ကျန် 50,000'), 'the delivery screen: total, advance, 50,000 left');
sim.tapLast(U.sister, 'အကုန် 50,000');
sim.tapLast(U.sister, 'ငွေသား');
const g69 = groupLive('V1-2532'), info69 = saleGroupInfo(ports, 'V1-2532');
check(g69.length === 3 && g69[0].type === 'SALE' && g69[0].qty === -1 && g69[0].amount === 150000 && g69[0].cash === 0 && g69[0].itemId === 'V1-2532-1' && g69[0].note === 'TSL-0018 ဝမ်းဆက်' &&
  g69[1].type === 'DEPOSIT_APPLIED' && g69[1].amount === 100000 && g69[2].type === 'PAYMENT' && g69[2].amount === 50000 && g69[2].cash === 50000 && g69[2].method === 'CASH',
  'ledger group V1-2532: SALE (line id, Cash 0, note = design) + DEPOSIT_APPLIED 100,000 + PAYMENT 50,000 cash');
check(info69.owed === 0 && info69.total === 150000 && depositEarmark(ports, 'C-0001', 'V1-2532') === 0 && depositsFor(ports, 'C-0001') === 0, 'owed 0; the earmark is consumed');
check(order('V1-2532').status === 'DELIVERED' && order('V1-2532').deliveredDay === today && order('V1-2532').prevStatus === 'READY', 'status DELIVERED, DeliveredDay today');
check(lastText(U.sister).includes('ပေးအပ်ပြီး') && lastText(U.sister).includes('TSL-0018 ဝမ်းဆက်') && sim.button(sim.lastBot(U.sister), 'မှားသွားတယ်') === 'U|V1-2532',
  'the reply is the receipt (line named by its design) with undo');
check(dayStats(ports, 'S1', today).orderRevenue >= 150000 && dayStats(ports, 'S1', today).ordersDelivered >= 1, 'day stats count the order revenue and one delivered order');

step('70. Undo of the delivery: status back to READY, the advance earmarked again; delivered again in the same group');
sim.tapLast(U.sister, 'မှားသွားတယ်');
check(lastText(U.sister).includes(MSG.undo_done) && lastText(U.sister).includes(MSG.ord_status_READY), 'undo says the status went back to READY');
check(order('V1-2532').status === 'READY' && order('V1-2532').deliveredDay === '' && depositEarmark(ports, 'C-0001', 'V1-2532') === 100000 && saleGroupInfo(ports, 'V1-2532').voided,
  'READY again, DeliveredDay cleared, 100,000 earmarked again, the sale voided by mirrors');
sim.text(U.sister, 'V1-2532');
sim.tapLast(U.sister, 'ပေးအပ်');
sim.tapLast(U.sister, 'အကုန် 50,000');
sim.tapLast(U.sister, 'ငွေသား');
check(order('V1-2532').status === 'DELIVERED' && saleGroupInfo(ports, 'V1-2532').owed === 0 && saleGroupInfo(ports, 'V1-2532').total === 150000 && groupLive('V1-2532').length === 3,
  're-delivery in the same group: 3 live rows, owed 0');

step('71. Delivery with a balance left as a credit, then paid by bank');
sim.text(U.sister, 'V1-2533');
sim.tapLast(U.sister, 'ပေးအပ်');
tapData(U.sister, 'ODP|V1-2533|0|0');
const info71 = saleGroupInfo(ports, 'V1-2533');
check(info71.owed === 240000 && order('V1-2533').status === 'DELIVERED' && lastText(U.sister).includes('ကျန် 240,000') && sim.button(sim.lastBot(U.sister), 'ငွေလက်ခံ') === 'PY|V1-2533',
  'paid 0: delivered, 240,000 owed, the receive-payment button');
const cr71 = openCredits(ports, 'S1').filter(c => c.groupId === 'V1-2533')[0];
check(cr71 && cr71.owed === 240000 && cr71.item.includes('ကြောင်း') && cr71.customer === 'မသီတာ', 'the balance is an ordinary credit (Credits view): 2 lines, owed 240,000');
sim.tapLast(U.sister, 'ငွေလက်ခံ');
sim.tapLast(U.sister, 'အကုန်');
sim.tapLast(U.sister, 'ဘဏ်လွှဲ');
const pay71 = world.ledger.filter(r => r.type === 'PAYMENT' && r.refGroupId === 'V1-2533' && !r.reversesTxId);
check(saleGroupInfo(ports, 'V1-2533').owed === 0 && pay71.length >= 1 && liveRows(pay71, world.ledger)[0].method === 'BANK', 'paid in full by bank transfer: owed 0, Method BANK');
sim.text(U.sister, 'V1-2533');
check(lastText(U.sister).includes('ပေးပြီး 240,000') && sim.button(sim.lastBot(U.sister), 'ငွေလက်ခံ') === null, 'the delivered card: paid 240,000, no payment button');

step('72. A tag attached to the finished piece opens the order card; delivery sells the tag');
const id72 = newOrder(U.sister, 'ဒေါ်ခင်', 'TSL-0018');
sim.tapLast(U.sister, '✨');
tapData(U.sister, 'ODA|' + id72 + '|0');
check(id72 === 'V1-2534', 'the next voucher is V1-2534');
sim.text(U.sister, id72);
sim.tapLast(U.sister, 'Tag တပ်');
check(lastText(U.sister).includes('scan'), 'one line without a tag: asks to scan the new tag');
const stock72 = world.ledger.length;
sim.start(U.sister, 'S1-0013');
const tag72 = item('S1-0013');
check(tag72.alias === 'V1-2534-1' && tag72.type === 'UNIQUE' && tag72.price === 150000 && tag72.stock === 1 && tag72.name.includes('ဒေါ်ခင်') &&
  world.ledger.length === stock72 + 1 && lastRow().type === 'RESTOCK' && lastRow().note === 'custom order V1-2534-1', 'the blank tag becomes the piece: Alias = line id, one RESTOCK');
check(world.orderItems.filter(l => l.orderId === id72)[0].itemId === 'S1-0013' && lastText(U.sister).includes('ဘောက်ချာ 2534'), 'OrderItems.ItemID = S1-0013; the card follows');
sim.start(U.sister, 'S1-0013');
check(lastText(U.sister).includes('ဘောက်ချာ 2534') && sim.button(sim.lastBot(U.sister), 'ပေးအပ်') === 'ODL|' + id72, 'scanning the tag later opens the order card, not the item card');
const pool72 = depositsFree(ports, 'C-0002');
sim.tapLast(U.sister, 'ပေးအပ်');
check(pool72 >= 150000 && lastText(U.sister).includes(fmtMoney(pool72)) && sim.button(sim.lastBot(U.sister), 'သုံးမယ်') === 'ODU|' + id72 + '|yes',
  'Daw Khin has a free deposit: the pool is used only after a yes');
sim.tapLast(U.sister, 'သုံးမယ်');
tapData(U.sister, 'ODP|' + id72 + '|0|1');
const g72 = groupLive(id72);
check(g72[0].itemId === 'S1-0013' && item('S1-0013').stock === 0 && g72.some(r => r.type === 'DEPOSIT_APPLIED' && r.amount === 150000 && r.note === 'deposit pool') &&
  saleGroupInfo(ports, id72).owed === 0 && depositsFree(ports, 'C-0002') === pool72 - 150000, 'delivery sells the tag (stock 0) and applies 150,000 from the pool');
sim.start(U.sister, 'S1-0013');
check(!lastText(U.sister).includes('ဘောက်ချာ 2534') && lastText(U.sister).includes('S1-0013'), 'after delivery the tag shows its item card again');

step('73. Cancel (owner): refund the advance, undo, then keep it as a fee');
const id73 = newOrder(U.owner, 'ဒေါ်မြင့်', 'TSL-0018');
sim.tapLast(U.owner, '✨');
tapData(U.owner, 'ODA|' + id73 + '|50000');
check(id73 === 'V1-2535' && depositEarmark(ports, 'C-0001', id73) === 50000, 'owner\'s order V1-2535 with a 50,000 advance');
sim.text(U.sister, id73);
tapData(U.sister, 'OX|' + id73);
check(lastText(U.sister) === MSG.ord_owner_only && order(id73).status === 'ORDERED', 'staff cannot cancel');
const before73 = dayStats(ports, 'S1', today), sum73 = customerSummary(ports, 'C-0001');
sim.text(U.owner, id73);
sim.tapLast(U.owner, 'ပယ်ဖျက်');
check(lastText(U.owner).includes('50,000') && sim.button(sim.lastBot(U.owner), 'ပြန်အမ်း') === 'OXR|' + id73 + '|refund', 'the cancel screen shows the advance with refund / keep');
sim.tapLast(U.owner, 'ပြန်အမ်း');
sim.tapLast(U.owner, 'ငွေသား');
const ref73 = lastRow();
check(ref73.type === 'DEPOSIT' && ref73.amount === -50000 && ref73.cash === -50000 && ref73.groupId === id73 && ref73.refGroupId === id73 && ref73.method === 'CASH',
  'refund: a negative DEPOSIT row with Method in group = order id');
check(order(id73).status === 'CANCELLED' && order(id73).cancelNote.indexOf('refund') === 0 && depositEarmark(ports, 'C-0001', id73) === 0 &&
  dayStats(ports, 'S1', today).depositRefunds === before73.depositRefunds + 50000, 'CANCELLED, nothing earmarked, the day shows a 50,000 refund');
sim.tapLast(U.owner, 'မှားသွားတယ်');
check(order(id73).status === 'ORDERED' && depositEarmark(ports, 'C-0001', id73) === 50000 && dayStats(ports, 'S1', today).depositRefunds === before73.depositRefunds &&
  lastText(U.owner).includes(MSG.ord_status_ORDERED), 'undo of the refund: the advance is earmarked again, the order ORDERED again, the refund figure nets out');
sim.text(U.owner, id73);
sim.tapLast(U.owner, 'ပယ်ဖျက်');
sim.tapLast(U.owner, 'စရံ သိမ်း');
const after73 = dayStats(ports, 'S1', today), fee73 = groupLive(id73).filter(r => r.type === 'FEE')[0];
check(fee73 && fee73.amount === 50000 && fee73.cash === 0 && groupLive(id73).some(r => r.type === 'DEPOSIT_APPLIED' && r.amount === 50000) && order(id73).status === 'CANCELLED',
  'keep: FEE 50,000 (Cash 0) + DEPOSIT_APPLIED in group = order id, CANCELLED');
check(after73.fees === before73.fees + 50000 && after73.revenue === before73.revenue + 50000 && after73.sales === before73.sales && after73.pieces === before73.pieces,
  'the fee is revenue on the day the order died; the sales count and pieces are unchanged');
check(receiptNumber(ports, id73) === 'R?-000000' && customerSummary(ports, 'C-0001').owed === sum73.owed && depositsFor(ports, 'C-0001') === 0,
  'no receipt number for the fee; the customer owes nothing more and holds no deposit');

step('74. Reminders in the 21:00 summary: due within the window and overdue');
const id74 = newOrder(U.sister, 'ဒေါ်ခင်', 'TSL-0025');
const line74 = world.orderItems.filter(l => l.orderId === id74)[0];
check(line74.designCode === 'TSL-0025' && line74.unitPrice === pricePresets(ports, 'အင်္ကျီ', null)[0], 'TSL-0025 has no base price: the first price preset of its category was tapped');
ports.store.updateOrder(id74, { dueDay: addDaysKey(today, 2) });
const id74b = newOrder(U.sister, 'မသီတာ', 'TSL-0018');
ports.store.updateOrder(id74b, { dueDay: addDaysKey(today, -3) });
const summary74 = buildDailySummary(ports, today);
check(summary74.includes(t(ports, 'summary_orders_due', { days: myDigits(3), list: '' }).slice(0, 12)) && summary74.includes(orderNo(id74) + ' ဒေါ်ခင်'),
  'due within 3 days: ' + orderNo(id74) + ' ဒေါ်ခင်');
check(summary74.includes('⏰') && summary74.includes(orderNo(id74b) + ' မသီတာ (' + myDigits(3) + ' ရက် လွန်)'), 'overdue: ' + orderNo(id74b) + ' မသီတာ, 3 days late');
check(!summary74.includes(orderNo('V1-2532') + ' ဒေါ်မြင့်'), 'delivered and cancelled orders are not reminded');

step('75. Open-orders list and report, measurement sheet and voucher PDFs, the month section');
sim.start(U.sister, '');
sim.tapLast(U.sister, '🧵 အော်ဒါ');
sim.tapLast(U.sister, 'အော်ဒါများ');
const list75 = sim.lastBot(U.sister);
check(list75.keyboard.length === 2 && list75.keyboard[0][0].callback_data === 'O|' + id74b && list75.keyboard[0][0].text.includes('⏰'), 'the open list: overdue first with ⏰, then the next due');
sim.start(U.sister, '');
sim.tapLast(U.sister, 'စာရင်း');
sim.tapLast(U.sister, 'အော်ဒါစာရင်း');
const rep75 = sim.lastBot(U.sister).document.report;
check(rep75.kind === 'orders' && rep75.sections.length === 1 && rep75.sections[0].rows.length === 2 && rep75.sections[0].rows[0][0] === orderNo(id74b),
  'staff get their shop\'s open-orders report, due date first');
sim.text(U.sister, 'V1-2532');
sim.tapLast(U.sister, '📏 PDF');
const meas75 = sim.lastBot(U.sister).document.report;
check(meas75.kind === 'meas' && meas75.title.includes('ဒေါ်မြင့်') && meas75.sections.some(s => s.rows.some(r => r[0] === 'လက်ဝ' && r[1] === '36/30/20')) &&
  meas75.sections.some(s => s.rows.some(r => r[0] === 'မှတ်ချက်' && r[1] === 'No Bra')), 'measurement sheet PDF of the order\'s session: groups, "36/30/20", the margin note');
tapData(U.sister, 'OVP|V1-2533');
const vou75 = sim.lastBot(U.sister).document.report;
check(vou75.kind === 'voucher' && vou75.pageSize === 'A5' && vou75.sections[0].rows.length === 2 && vou75.sections[0].totals[0][4] === 240000, 'the voucher as an A5 PDF with both lines');
const month75 = buildReport(ports, 'month', { now: ports.clock.now() });
const ordSec = month75.sections.filter(s => s.heading === MSG.rep_orders_section)[0];
check(ordSec && ordSec.rows[0][1] === 3 && ordSec.rows[0][3] === 50000 && ordSec.rows[0][6] === 1, 'month section: 3 delivered, 50,000 fees, 1 cancelled in shop 1');

step('76. MeasureFields: a deactivated field is not asked, a renamed one shows its new label');
const savedFields76 = world.measureFields.map(f => Object.assign({}, f));
world.measureFields.filter(f => f.key === 'neck')[0].active = false;
world.measureFields.filter(f => f.key === 'bust')[0].labelMy = 'ရင်ပတ်';
sim.tap(U.sister, sim.lastBot(U.sister).id, 'MS|C-0003');
sim.tapLast(U.sister, 'တစ်ခုချင်း');
check(lastText(U.sister).includes('ပုခုံး') && lastText(U.sister).includes(myDigits(CFG.MEASURE_FIELDS.length - 1)) && !lastText(U.sister).includes('လည်ပင်း'),
  'neck (Active FALSE) is skipped: the first question is ပုခုံး of 31');
for (let i = 0; i < 4; i++) sim.tapLast(U.sister, 'ကျော်');
check(lastText(U.sister).includes('ရင်ပတ်'), 'the renamed field is asked by its new label');
sim.text(U.sister, '35');
sim.tapLast(U.sister, 'ဒီလောက်ပဲ');
check(lastText(U.sister).includes('ရင်ပတ် · 35') && !lastText(U.sister).includes('လည်ပင်း'), 'the summary uses the new label');
sim.tapLast(U.sister, 'မလုပ်တော့');
world.measureFields = savedFields76;

step('77. Per-shop voucher numbering: shop 2 continues its own book');
const id77 = newOrder(U.brother, 'ဒေါ်မြင့်', 'TSL-0018');
check(id77 === 'V2-0101' && order(id77).shop === 'S2' && world.settings.order_next_no_S2 === 102, 'shop 2\'s first order is V2-0101 (Settings 101 -> 102)');
const next77 = world.settings.order_next_no_S1;
const id77b = newOrder(U.sister, 'ဒေါ်ခင်', 'TSL-0018');
check(id77b === orderIdFor('S1', next77) && world.settings.order_next_no_S1 === next77 + 1, 'shop 1 goes on with its own series: ' + id77b);
world.settings.order_next_no_S1 = 2530;
const id77c = createOrder(ports, { shop: 'S1', customerId: 'C-0002', staff: { id: '1001' } }).id;
check(id77c === orderIdFor('S1', next77 + 1), 'a Settings number below one already used never issues a duplicate: ' + id77c);
sim.text(U.brother, 'V1-2532');
check(lastText(U.brother).includes(t(ports, 'ord_other_shop', { shop: shopName(ports, 'S1') })) && !kbData(sim.lastBot(U.brother)).some(d => /^OS\|/.test(d)),
  'the other shop\'s card is read-only for staff');

step('78. Deep link /start V1-2532 opens the order; an unknown voucher says so');
sim.start(U.sister, 'V1-2532');
check(lastText(U.sister).includes('ဘောက်ချာ 2532') && lastText(U.sister).includes(MSG.ord_status_DELIVERED), '/start V1-2532 opens the delivered card');
sim.start(U.sister, 'v1-2533');
check(lastText(U.sister).includes('ဘောက်ချာ 2533'), 'the payload is case-insensitive');
sim.start(U.sister, 'V1-9999');
check(lastText(U.sister) === t(ports, 'ord_not_found', { id: 'V1-9999' }), 'an unknown voucher: "not found"');

step('79. Spoken order: confirm, then the flow pre-filled; the app button without a sync port');
sim.voice(U.sister, 'ဒေါ်မြင့် ဝမ်းဆက် တစ်ထည် အော်ဒါ၊ စရံ တစ်သိန်း');
const conf79 = sim.lastBot(U.sister), orders79 = world.orders.length;
check(conf79.text.includes('ဒေါ်မြင့်') && conf79.text.includes('ဝမ်းဆက်') && conf79.text.includes('100,000') && world.orders.length === orders79, 'the confirm screen echoes customer, design, advance; nothing written yet');
sim.tapLast(U.sister, 'မှန်တယ်');
const id79 = world.orders[world.orders.length - 1].id;
check(world.orders.length === orders79 + 1 && order(id79).customerId === 'C-0001' && world.orderItems.filter(l => l.orderId === id79).length === 1 &&
  world.orderItems.filter(l => l.orderId === id79)[0].designCode === 'TSL-0018', 'yes: the order is begun for Daw Myint with the spoken design and quantity');
sim.tapLast(U.sister, '✨');
check(sim.lastBot(U.sister).keyboard[0][0].callback_data === 'ODA|' + id79 + '|100000', 'the spoken advance is the first advance button');
sim.tapLast(U.sister, 'မလုပ်တော့');
check(world.ports.sync === null, 'the simulator\'s sync port is null without a fake server');
sim.start(U.sister, '');
check(sim.button(sim.lastBot(U.sister), '📲') === null, 'no 📲 button in the menu without a sync port');
let crashed79 = false;
try { tapData(U.sister, 'M|app'); } catch (e) { crashed79 = true; }
check(!crashed79 && lastText(U.sister) === MSG.app_not_ready, 'M|app answers the short "app not ready" line instead of failing');

step('80. Every callback_data emitted, the tailoring buttons included, is under 64 bytes');
check(maxCb.len > 0 && maxCb.len < 64, 'longest callback_data ' + maxCb.len + ' bytes: ' + maxCb.data);
check(world.errors.filter(e => e.where === 'handleUpdate').length === 0, 'no update failed with an exception');

/* ---------------- print what the family and the sheet would see ---------------- */
console.log('\n══ Sister\'s chat (last 10 messages) ══');
world.chats[U.sister.id].slice(-10).forEach(m => {
  const who = m.from === 'bot' ? 'BOT ' : 'HER ';
  const body = m.voice ? '🎤 ' + m.voice : (m.photo && m.from === 'user' ? '📷 photo' : m.document ? '📄 ' + m.document.name : m.text);
  const kb = (m.keyboard || []).map(row => '[' + row.map(b => b.text).join(' | ') + ']').join(' ');
  console.log('  ' + who + body.replace(/\n/g, ' ⏎ ') + (kb ? '\n       ' + kb : ''));
});

console.log('\n══ Ledger tab (' + world.ledger.length + ' rows, last 12) ══');
console.log('  ' + ['Day', 'Shop', 'ItemID', 'Type', 'Qty', 'Amount', 'Cash', 'Method', 'Category', 'Cust', 'Source', 'Rev'].join('\t'));
world.ledger.slice(-12).forEach(r => console.log('  ' + [r.day, r.shop, r.itemId, r.type, r.qty, r.amount, r.cash, r.method, r.category, r.customerId, r.source, r.reversesTxId ? 'yes' : ''].join('\t')));

console.log('\n══ Credits view ══');
openCredits(ports, null).forEach(c => console.log('  ' + [c.customer, c.item, c.day, c.total, c.owed, c.days + 'd'].join('\t')));
console.log('  (' + openCredits(ports, null).length + ' open)');
console.log('\n══ Deposits view ══');
depositsHeldList(ports).forEach(d => console.log('  ' + [d.customer, d.received, d.used, d.held].join('\t')));
console.log('\n══ Customers view (F:K) ══');
console.log('  ' + ['ID', 'Name', 'Phone', 'Bought', 'Paid', 'Owed', 'Deposit', 'LastVisit', 'Visits'].join('\t'));
customerSummaries(ports).forEach(c => console.log('  ' + [c.id, c.name, c.phone ? fmtPhone(c.phone) : '', c.bought, c.paid, c.owed, c.depositHeld, c.lastDay, c.visits].join('\t')));

console.log('\n══ Errors tab ══');
world.errors.forEach(e => console.log('  ' + e.where + ': ' + e.message));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
