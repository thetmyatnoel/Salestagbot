/**
 * core_orders.js — custom tailoring (made-to-measure) orders, platform-free.
 * Plan 13.4, docs/design-round-2/design-B-tailoring.md with every fix of critique.md applied.
 *
 * Tabs (ports.store): Orders, OrderItems, Measurements, MeasureFields, Designs. No money is stored on an
 * order; orderMoney() reads it from the ledger with these conventions:
 *   advance        DEPOSIT with RefGroupID = order id (earmarked to that voucher; core_ledger depositEarmark)
 *   delivery       one group whose GroupID = order id: SALE per line (Cash 0, ItemID = tag or line id
 *                  V1-2532-1, Note = fabric + design + description), DEPOSIT_APPLIED for the earmark first
 *                  (the customer's free pool only after an explicit yes), PAYMENT with Method for cash handed over
 *   balance        an ordinary credit (openCredits, 💰 ငွေလက်ခံ, the 21:00 summary) because the group is a sale group
 *   cancel         refund = negative DEPOSIT with Method (GroupID = RefGroupID = order id); kept = FEE + DEPOSIT_APPLIED
 *                  in group = order id (revenue on the day the order dies, no stock, no receipt number)
 *   undo           undoGroup(order id) mirrors the whole delivery; orderAfterUndo() sets the status back to READY
 * Status moves forward only (ORDER_FLOW); DELIVERED and CANCELLED are set by deliverOrder/cancelOrder alone.
 * Voucher numbers continue each shop's paper series: store.nextOrderNo(shop) under the lock -> V1-2532, V2-0101.
 * Measurements: one row per session, values kept as text ('36/30/20', '17.5'); a fix appends a new row.
 */

/* ------------------------------ settings ------------------------------ */

function settingList(ports, key, defaults) {
  var raw = (ports.store.getSetting(key, '') || '').toString();
  var list = raw.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 0; });
  return list.length ? list : defaults.slice();
}

function duePresets(ports) {
  var list = settingList(ports, 'due_presets', []).map(Number).filter(function (n) { return n > 0; });
  return list.length ? list : CFG.DUE_PRESETS.slice();
}

/** The fabric names offered as buttons: the labels of the active fabric options (core_ledger.js fabricOptions; Settings fabric_presets on a sheet without Lists rows). */
function fabricPresets(ports) { return fabricOptions(ports).map(function (f) { return f.label; }); }

function orderRemindDays(ports) {
  var n = Number(ports.store.getSetting('order_remind_days', CFG.ORDER_REMIND_DAYS));
  return n > 0 ? n : CFG.ORDER_REMIND_DAYS;
}

/** The letterhead of a shop for vouchers and measurement sheets (Settings shop_brand_S1, shop_address_S1, shop_phone_S1). */
function shopBrand(ports, shop) { return ports.store.getSetting('shop_brand_' + shop, '') || shopName(ports, shop); }
function shopAddress(ports, shop) { return String(ports.store.getSetting('shop_address_' + shop, '') || ''); }
function shopPhone(ports, shop) { return String(ports.store.getSetting('shop_phone_' + shop, '') || ''); }

/* ------------------------------ dates ------------------------------ */

/* addDaysKey, daysBetweenKeys and parseDayText live in core_burmese.js (round 5): the guided sale's due date needs
 * them in core_ledger.js and core_bot.js, which load without this file (run_sync.js, the app without orders). */

/* ------------------------------ designs ------------------------------ */

/* normDesignCode (TSL-18 == TSL-0018) lives in core_config.js: the stores use it in getDesign. */

function listActiveDesigns(ports) {
  return ports.store.listDesigns().filter(function (d) { return d.active !== false && d.active !== 'FALSE'; });
}

/** A design by code or alias (TSL-18 == TSL-0018), by number alone when unique, or by name. Null when nothing fits. */
function findDesign(ports, text) {
  var raw = String(text || '').trim();
  if (!raw) return null;
  var designs = ports.store.listDesigns();
  var want = normDesignCode(raw), i;
  if (want && want.indexOf('-') > 0) {
    for (i = 0; i < designs.length; i++) if (normDesignCode(designs[i].code) === want) return designs[i];
  }
  if (want && want.charAt(0) === '-') {
    var byNo = designs.filter(function (d) { return normDesignCode(d.code).split('-')[1] === want.slice(1); });
    if (byNo.length === 1) return byNo[0];
  }
  var h = normName(raw);
  if (!h) return null;
  var byName = designs.filter(function (d) { var n = normName(d.name); return n && (n === h || n.indexOf(h) >= 0 || h.indexOf(n) >= 0); });
  return byName.length ? byName[0] : null;
}

function designLabel(d) {
  if (!d) return '';
  return d.code + (d.name ? ' · ' + d.name : '');
}

/** Active designs for the new-order buttons: most ordered first, then by code. */
function designsForButtons(ports, n) {
  var counts = {};
  ports.store.listOrderItems(null).forEach(function (l) { if (l.designCode) counts[l.designCode] = (counts[l.designCode] || 0) + 1; });
  return listActiveDesigns(ports).sort(function (a, b) {
    return (counts[b.code] || 0) - (counts[a.code] || 0) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  }).slice(0, n || CFG.ORDER_DESIGN_BUTTONS);
}

/* ------------------------------ orders ------------------------------ */

function orderIsOpen(order) {
  return !!order && order.status !== CFG.ORDER_STATUS.DELIVERED && order.status !== CFG.ORDER_STATUS.CANCELLED;
}

/** Owners handle every order; staff only their shop's. */
function canEditOrder(staff, order) {
  return !!order && (staff.role === 'owner' || staff.shop === order.shop);
}

/** A new voucher: the next number of the shop's series, status ORDERED, no lines yet. */
function createOrder(ports, p) {
  var now = ports.clock.now();
  var id = ports.store.nextOrderNo(p.shop);
  var rec = {
    id: id, shop: p.shop, customerId: p.customerId, orderedDay: dayKey(now), dueDay: p.dueDay || '', deliveredDay: '',
    status: CFG.ORDER_STATUS.ORDERED, statusAt: now.toISOString(), statusBy: p.staff.id, total: 0, measId: '',
    notes: p.notes || '', createdBy: p.staff.id, createdAt: now.toISOString(), voucherSentAt: '', cancelNote: '', prevStatus: ''
  };
  ports.store.addOrder(rec);
  return ports.store.getOrder(id) || rec;
}

function orderLines(ports, orderId) {
  return ports.store.listOrderItems(orderId).filter(function (l) { return Number(l.qty) > 0; })
    .sort(function (a, b) { return Number(a.line) - Number(b.line); });
}

function orderTotal(ports, orderId) {
  return orderLines(ports, orderId).reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0);
}

function refreshOrderTotal(ports, orderId) {
  var total = orderTotal(ports, orderId);
  ports.store.updateOrder(orderId, { total: total });
  return total;
}

/** Append a numbered line; Amount = Qty x UnitPrice; the order's Total snapshot follows. */
function addOrderLine(ports, orderId, l) {
  var all = ports.store.listOrderItems(orderId);
  var n = all.reduce(function (m, x) { return Math.max(m, Number(x.line) || 0); }, 0) + 1;
  var qty = Math.max(1, Math.round(Number(l.qty) || 1));
  var unitPrice = Math.max(0, Math.round(Number(l.unitPrice) || 0));
  var rec = {
    orderId: orderId, line: n, designCode: l.designCode || '', fabric: l.fabric || '', description: l.description || '',
    qty: qty, unitPrice: unitPrice, amount: qty * unitPrice, cost: l.cost === undefined || l.cost === null ? '' : l.cost, itemId: l.itemId || ''
  };
  ports.store.addOrderItem(rec);
  refreshOrderTotal(ports, orderId);
  return rec;
}

/** Remove the last line while the order is still being written (OrderItems is master data, not the ledger). */
function popOrderLine(ports, orderId) {
  var lines = orderLines(ports, orderId);
  if (!lines.length) return null;
  var last = lines[lines.length - 1];
  ports.store.removeOrderItem(orderId, last.line);
  refreshOrderTotal(ports, orderId);
  return last;
}

/** 'ပိုး + TSL-0018 ဝမ်းဆက် · ရင်ဖုံး': fabric + design + description, the ledger Note and the voucher line. */
function orderLineDesc(ports, l) {
  var parts = [];
  if (l.fabric) parts.push(l.fabric);
  if (l.designCode) {
    var d = ports.store.getDesign(l.designCode);
    parts.push(l.designCode + (d && d.name ? ' ' + d.name : ''));
  }
  var s = parts.join(' + ');
  if (l.description) s = s ? s + ' · ' + l.description : l.description;
  return s || t(ports, 'ord_no_code');
}

function orderLinesText(ports, orderId) {
  return orderLines(ports, orderId).map(function (l) {
    return t(ports, 'ord_line', { n: myDigits(l.line), desc: orderLineDesc(ports, l), qty: fmtCount(l.qty), amount: fmtMoney(l.amount) });
  }).join('\n');
}

/**
 * Money of one order from the ledger. Before delivery: deposit = the advance still earmarked to this voucher,
 * owed = total - deposit. After delivery (a sale group with the order id): applied, payments and owed from
 * saleGroupInfo, paid = everything received. {total, deposit, depositsReceived, applied, payments, paid, owed, delivered}
 */
function orderMoney(ports, orderId, order) {
  order = order || ports.store.getOrder(orderId);
  var total = order ? (Number(order.total) || orderTotal(ports, orderId)) : orderTotal(ports, orderId);
  var customerId = order ? order.customerId : '';
  var received = 0, payments = 0;
  ports.store.ledgerRows().forEach(function (r) {
    if (r.refGroupId !== orderId) return;
    if (r.type === CFG.TX.DEPOSIT) received += r.amount;
    if (r.type === CFG.TX.PAYMENT) payments += r.amount;
  });
  var earmark = customerId ? depositEarmark(ports, customerId, orderId) : 0;
  var info = saleGroupInfo(ports, orderId);
  if (info && !info.voided) {
    return { total: info.total, deposit: info.applied, depositsReceived: received, applied: info.applied, payments: info.payments,
             paid: info.cash + info.payments + info.applied, owed: Math.max(0, info.owed), delivered: true, method: info.method };
  }
  return { total: total, deposit: earmark, depositsReceived: received, applied: 0, payments: payments,
           paid: earmark + payments, owed: Math.max(0, total - earmark - payments), delivered: false, method: '' };
}

function orderMoneyText(ports, orderId, order) {
  var m = orderMoney(ports, orderId, order);
  if (m.delivered) return t(ports, 'ord_money_delivered', { total: fmtMoney(m.total), paid: fmtMoney(m.paid), owed: fmtMoney(m.owed) });
  return t(ports, 'ord_money', { total: fmtMoney(m.total), deposit: fmtMoney(m.deposit), owed: fmtMoney(m.owed) });
}

function orderStatusLabel(ports, status) {
  var s = t(ports, 'ord_status_' + status);
  return s === 'ord_status_' + status ? status : s;
}

/** Open orders of a shop (null = all), due date first (blank last), then order date. */
function openOrders(ports, shop) {
  return ports.store.listOrders(shop, null).filter(orderIsOpen).sort(function (a, b) {
    var da = a.dueDay || '9999', db = b.dueDay || '9999';
    if (da !== db) return da < db ? -1 : 1;
    if (a.orderedDay !== b.orderedDay) return a.orderedDay < b.orderedDay ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Open orders due from `day` up to day + days (inclusive). */
function ordersDue(ports, shop, day, days) {
  var until = addDaysKey(day, days);
  return openOrders(ports, shop).filter(function (o) { return o.dueDay && o.dueDay >= day && o.dueDay <= until; });
}

function ordersOverdue(ports, shop, day) {
  return openOrders(ports, shop).filter(function (o) { return o.dueDay && o.dueDay < day; });
}

/**
 * Forward-only status change by button (ORDERED -> CUTTING -> SEWING -> READY; any earlier step may be skipped).
 * DELIVERED and CANCELLED come only from deliverOrder/cancelOrder. {ok, order} or {ok:false, reason}.
 */
function setOrderStatus(ports, orderId, status, staff) {
  var order = ports.store.getOrder(orderId);
  if (!order) return { ok: false, reason: 'missing' };
  if (!orderIsOpen(order)) return { ok: false, reason: 'closed' };
  var from = CFG.ORDER_FLOW.indexOf(order.status), to = CFG.ORDER_FLOW.indexOf(status);
  if (to < 0) return { ok: false, reason: 'type' };
  if (to <= from) return { ok: false, reason: 'backward' };
  ports.store.updateOrder(orderId, { status: status, statusAt: ports.clock.now().toISOString(), statusBy: staff.id });
  return { ok: true, order: ports.store.getOrder(orderId) };
}

/** The next forward statuses a card may offer. */
function nextStatuses(order) {
  var i = CFG.ORDER_FLOW.indexOf(order.status);
  return i < 0 ? [] : CFG.ORDER_FLOW.slice(i + 1);
}

/**
 * Delivery: one ledger group whose id is the order id. SALE per line (Cash 0), DEPOSIT_APPLIED for the
 * earmarked advance, DEPOSIT_APPLIED from the customer's free pool only when p.usePool, PAYMENT with Method
 * for the cash handed over (capped at what is left). Then Status DELIVERED. {ok, groupId, info, applied, paid}.
 */
function deliverOrder(ports, p) {
  var order = ports.store.getOrder(p.orderId);
  if (!order) return { ok: false, reason: 'missing' };
  if (!orderIsOpen(order)) return { ok: false, reason: 'closed' };
  var lines = orderLines(ports, order.id);
  if (!lines.length) return { ok: false, reason: 'no_lines' };
  var when = p.when || ports.clock.now();
  var base = { groupId: order.id, shop: order.shop, customerId: order.customerId, refGroupId: order.id,
               source: p.source || CFG.SOURCE.BUTTON, staffId: p.staff.id, updateId: p.updateId, when: when };
  var txs = [], total = 0;
  lines.forEach(function (l) {
    total += Number(l.amount) || 0;
    txs.push(newTx(ports, merge(base, {
      itemId: l.itemId || (order.id + '-' + l.line), type: CFG.TX.SALE, qty: -Number(l.qty), unitPrice: l.unitPrice, amount: l.amount, cash: 0,
      costAtSale: l.cost === '' || l.cost === null || l.cost === undefined ? '' : l.cost, refGroupId: '', note: orderLineDesc(ports, l)
    })));
  });
  var earmark = depositEarmark(ports, order.customerId, order.id);
  var applied = Math.min(earmark, total), remaining = total - applied;
  if (applied > 0) {
    txs.push(newTx(ports, merge(base, { itemId: txs[0].itemId, type: CFG.TX.DEPOSIT_APPLIED, qty: 0, unitPrice: null, amount: applied, cash: 0, note: 'deposit' })));
  }
  var pooled = 0;
  if (p.usePool && remaining > 0) {
    pooled = Math.min(depositsFree(ports, order.customerId), remaining);
    if (pooled > 0) {
      txs.push(newTx(ports, merge(base, { itemId: txs[0].itemId, type: CFG.TX.DEPOSIT_APPLIED, qty: 0, unitPrice: null, amount: pooled, cash: 0, note: 'deposit pool' })));
      remaining -= pooled;
    }
  }
  var paid = Math.min(Math.max(0, Math.round(Number(p.paid) || 0)), remaining);
  if (paid > 0) {
    txs.push(newTx(ports, merge(base, { itemId: txs[0].itemId, type: CFG.TX.PAYMENT, qty: 0, unitPrice: null, amount: paid, cash: paid,
      note: 'delivery', method: methodFor(p.method, paid) })));
  }
  writeGroup(ports, txs);
  ports.store.updateOrder(order.id, {
    status: CFG.ORDER_STATUS.DELIVERED, deliveredDay: dayKey(when), statusAt: when.toISOString(), statusBy: p.staff.id, prevStatus: order.status
  });
  return { ok: true, groupId: order.id, info: saleGroupInfo(ports, order.id), applied: applied + pooled, paid: paid, total: total };
}

/**
 * Cancel (owner only, checked by the bot). mode 'refund': the earmarked advance goes back as a negative DEPOSIT
 * row with Method; 'keep': it becomes a FEE (revenue, no stock) plus DEPOSIT_APPLIED in group = order id;
 * 'none' when nothing was paid. {ok, amount, groupId} or {ok:false, reason}.
 */
function cancelOrder(ports, p) {
  var order = ports.store.getOrder(p.orderId);
  if (!order) return { ok: false, reason: 'missing' };
  if (!orderIsOpen(order)) return { ok: false, reason: 'closed' };
  var when = p.when || ports.clock.now();
  var amount = depositEarmark(ports, order.customerId, order.id), groupId = '';
  var base = { shop: order.shop, customerId: order.customerId, refGroupId: order.id, source: p.source || CFG.SOURCE.BUTTON,
               staffId: p.staff.id, updateId: p.updateId, when: when };
  if (amount > 0 && p.mode === 'refund') {
    // Group = order id (like the kept fee), so undoing the refund also gives the order its status back (orderAfterUndo).
    var r = writeGroup(ports, [newTx(ports, merge(base, { groupId: order.id, itemId: '', type: CFG.TX.DEPOSIT, qty: 0, unitPrice: null, amount: -amount, cash: -amount,
      note: 'refund ' + order.id, method: methodFor(p.method, -amount) }))]);
    groupId = r.groupId;
  } else if (amount > 0 && p.mode === 'keep') {
    var kept = writeGroup(ports, [
      newTx(ports, merge(base, { groupId: order.id, itemId: '', type: CFG.TX.FEE, qty: 0, unitPrice: null, amount: amount, cash: 0, note: 'cancellation fee ' + order.id })),
      newTx(ports, merge(base, { groupId: order.id, itemId: '', type: CFG.TX.DEPOSIT_APPLIED, qty: 0, unitPrice: null, amount: amount, cash: 0, note: 'deposit' }))
    ]);
    groupId = kept.groupId;
  } else {
    amount = 0;
  }
  ports.store.updateOrder(order.id, {
    status: CFG.ORDER_STATUS.CANCELLED, statusAt: when.toISOString(), statusBy: p.staff.id, prevStatus: order.status,
    cancelNote: (p.mode || 'none') + (p.note ? ' · ' + p.note : '')
  });
  return { ok: true, amount: amount, groupId: groupId, mode: amount > 0 ? p.mode : 'none' };
}

/**
 * After undoGroup/voidGroup of a group whose id is an order id: a reversed delivery puts the order back to READY
 * (the piece exists, the money is back where it was); a reversed kept-deposit cancellation restores the status
 * the order had before. Returns the new status or null when the group was not an order's.
 */
function orderAfterUndo(ports, groupId, staff) {
  if (!isOrderId(groupId) || !ports.store.getOrder) return null;
  var order = ports.store.getOrder(groupId);
  if (!order) return null;
  var status = null;
  if (order.status === CFG.ORDER_STATUS.DELIVERED) status = CFG.ORDER_STATUS.READY;
  else if (order.status === CFG.ORDER_STATUS.CANCELLED) status = order.prevStatus || CFG.ORDER_STATUS.ORDERED;
  if (!status) return null;
  ports.store.updateOrder(groupId, { status: status, deliveredDay: '', statusAt: ports.clock.now().toISOString(), statusBy: staff.id, cancelNote: '' });
  return status;
}

/* ------------------------------ texts: card, voucher, ready, list ------------------------------ */

function orderCustomerText(ports, order) {
  var c = ports.store.getCustomer(order.customerId);
  if (!c) return customerName(ports, order.customerId);
  var s = c.name;
  if (c.phone) s += t(ports, 'voucher_phone', { phone: fmtPhone(c.phone) }) + (/viber/i.test(c.note || '') ? t(ports, 'voucher_viber') : '');
  return s;
}

function orderDueText(ports, order, today) {
  if (!order.dueDay) return t(ports, 'ord_no_due');
  var left = daysBetweenKeys(today, order.dueDay), tail = '';
  if (orderIsOpen(order)) {
    if (left > 0) tail = t(ports, 'ord_days_left', { n: myDigits(left) });
    else if (left === 0) tail = t(ports, 'ord_due_today');
    else tail = t(ports, 'ord_days_over', { n: myDigits(-left) });
  }
  return t(ports, 'ord_card_dates', { ordered: fmtDayShortMy(order.orderedDay), due: fmtDayShortMy(order.dueDay), left: tail });
}

/** The order card: header, dates, lines, money, status, measurements. */
function orderCardText(ports, order) {
  var today = dayKey(ports.clock.now());
  var lines = [t(ports, 'ord_head', { no: orderNo(order.id), customer: orderCustomerText(ports, order) })];
  lines.push(orderDueText(ports, order, today));
  var lt = orderLinesText(ports, order.id);
  if (lt) lines.push(lt);
  lines.push(orderMoneyText(ports, order.id, order));
  var status = orderStatusLabel(ports, order.status);
  var meas = order.measId ? t(ports, 'ord_meas_have', { id: order.measId }) : t(ports, 'ord_meas_none');
  lines.push(status + ' · ' + meas);
  return lines.join('\n');
}

/**
 * Where the customer can transfer the balance of a voucher: 'label number' of the shop's accounts that carry a
 * number (core_ledger.js transferLines), only while something is owed and the order is not cancelled; [] otherwise.
 */
function voucherTransferLines(ports, order, m) {
  if (!order || !m || !(m.owed > 0) || order.status === CFG.ORDER_STATUS.CANCELLED) return [];
  return transferLines(ports, order.shop);
}

/** The voucher the seller forwards to the customer (Telegram) or screenshots into Viber. */
function voucherText(ports, orderId) {
  var order = ports.store.getOrder(orderId);
  if (!order) return '';
  var m = orderMoney(ports, orderId, order);
  var money = [t(ports, 'ord_total', { total: fmtMoney(m.total) })];
  if (m.delivered) {
    money.push(t(ports, 'receipt_total', { total: fmtMoney(m.total), paid: fmtMoney(m.paid), owed: fmtMoney(m.owed), method: '' }).split('\n').slice(1).join('\n'));
  } else {
    var methods = depositMethods(ports, orderId);
    money.push(t(ports, 'voucher_deposit', { deposit: fmtMoney(m.deposit), method: methods ? ' (' + methods + ')' : '' }));
    money.push('ကျန် ' + fmtMoney(m.owed));
  }
  // With a balance: where to transfer it, directly after the balance line (delivered or not). The line does not
  // start with 🏦: a method tap under the voucher reply rebuilds the message without such lines (stripMethodLines).
  if (voucherTransferLines(ports, order, m).length) money.push(transferLine(ports, order.shop));
  var c = ports.store.getCustomer(order.customerId);
  var phone = c && c.phone ? t(ports, 'voucher_phone', { phone: fmtPhone(c.phone) }) + (/viber/i.test(c.note || '') ? t(ports, 'voucher_viber') : '') : '';
  var text = t(ports, 'voucher_text', {
    brand: shopBrand(ports, order.shop), no: orderNo(order.id), date: fmtDayMy(order.orderedDay), customer: c ? c.name : customerName(ports, order.customerId),
    phone: phone, lines: orderLinesText(ports, order.id), money: money.join('\n'), due: order.dueDay ? fmtDayMy(order.dueDay) : '-'
  });
  var address = shopAddress(ports, order.shop), phones = shopPhone(ports, order.shop);
  if (address || phones) text += '\n' + t(ports, 'voucher_footer', { address: address, phones: phones ? (address ? '\n' : '') + '📞 ' + phones : '' });
  return text;
}

/** 'ငွေသား' or 'ငွေသား 50,000 · KBZPay 50,000': how the earmarked advance arrived. */
function depositMethods(ports, orderId) {
  var all = ports.store.ledgerRows(), reversed = reversedIdSet(all), sums = {}, order = [];
  all.forEach(function (r) {
    if (r.type !== CFG.TX.DEPOSIT || r.refGroupId !== orderId || r.reversesTxId || reversed[r.txId] || r.amount <= 0) return;
    var k = methodOf(r);
    if (!(k in sums)) { sums[k] = 0; order.push(k); }
    sums[k] += r.amount;
  });
  if (!order.length) return '';
  if (order.length === 1) return methodLabel(ports, order[0]);
  return order.map(function (k) { return methodLabel(ports, k) + ' ' + fmtMoney(sums[k]); }).join(' · ');
}

function readyMessage(ports, order) {
  return t(ports, 'ord_ready_msg', { brand: shopBrand(ports, order.shop), customer: customerName(ports, order.customerId), no: orderNo(order.id) });
}

/** One line of the open-orders list: '✂️ 2532 · ဒေါ်မြင့် · ၃၀ အောက်တိုဘာ'. */
function orderListLabel(ports, order, today) {
  var due = order.dueDay ? fmtDayShortMy(order.dueDay) : '-';
  if (order.dueDay && order.dueDay < today) due = '⏰ ' + due;
  return t(ports, 'ord_list_item', { status: CFG.ORDER_STATUS_EMOJI[order.status] || '', no: orderNo(order.id), customer: customerName(ports, order.customerId), due: due });
}

/** The 21:00 summary lines: orders due within order_remind_days and overdue, open ones only, 5 each. */
function orderSummaryLines(ports, day) {
  var out = [], days = orderRemindDays(ports);
  var due = ordersDue(ports, null, day, days);
  if (due.length) {
    out.push(t(ports, 'summary_orders_due', { days: myDigits(days), list: due.slice(0, 5).map(function (o) {
      return orderNo(o.id) + ' ' + customerName(ports, o.customerId) + ' (' + fmtDayShortMy(o.dueDay) + ')';
    }).join(', ') }));
  }
  var over = ordersOverdue(ports, null, day);
  if (over.length) {
    out.push(t(ports, 'summary_orders_overdue', { list: over.slice(0, 5).map(function (o) {
      return orderNo(o.id) + ' ' + customerName(ports, o.customerId) + ' (' + myDigits(daysBetweenKeys(o.dueDay, day)) + ' ရက် လွန်)';
    }).join(', ') }));
  }
  return out;
}

/* ------------------------------ reports ------------------------------ */

/** Open orders per shop, sorted by due date: voucher, customer, phone, lines, dates, status, total, paid, owed. */
function ordersReport(ports, shops, now) {
  var today = dayKey(now), sections = [];
  shops.forEach(function (shop) {
    var rows = openOrders(ports, shop).map(function (o) {
      var c = ports.store.getCustomer(o.customerId), m = orderMoney(ports, o.id, o);
      return [orderNo(o.id), c ? c.name : o.customerId, c && c.phone ? fmtPhone(c.phone) : '',
              orderLines(ports, o.id).map(function (l) { return orderLineDesc(ports, l) + ' × ' + fmtCount(l.qty); }).join('; '),
              fmtDayShortMy(o.orderedDay), o.dueDay ? fmtDayShortMy(o.dueDay) + (o.dueDay < today ? ' ⏰' : '') : '',
              orderStatusLabel(ports, o.status), m.total, m.paid, m.owed];
    });
    sections.push({
      heading: shopName(ports, shop),
      columns: ['ဘောက်ချာ', 'ဝယ်သူ', 'ဖုန်း', 'ပစ္စည်း', 'အပ်ရက်', 'ရွေးရက်', 'အခြေအနေ', 'စုစုပေါင်း', 'ပေးပြီး', 'ကျန်'],
      rows: rows, totals: rows.length ? [sumRows(rows, 'စုစုပေါင်း', 7)] : []
    });
  });
  return { kind: 'orders', fileName: 'orders-' + today, title: t(ports, 'rep_orders_title', { date: fmtDayMy(today) }),
           subtitle: shopList(ports, shops), sections: sections, footer: reportFooter(now) };
}

/**
 * The voucher as an A5 document (gas_pdf reads pageSize when it supports it; A4 otherwise). With a balance, the
 * accounts to transfer to go into the footer ONE PER LINE, above the text that is there today: gas_pdf.js sizes
 * column A to its longest cell and exports fit-to-width, so one long line (or the subtitle) would shrink the page.
 */
function voucherReport(ports, orderId, now) {
  var order = ports.store.getOrder(orderId);
  if (!order) return null;
  var m = orderMoney(ports, orderId, order), c = ports.store.getCustomer(order.customerId);
  var rows = orderLines(ports, orderId).map(function (l) { return [l.line, orderLineDesc(ports, l), l.qty, l.unitPrice, l.amount]; });
  var totals = [['စုစုပေါင်း', '', '', '', m.total], [m.delivered ? 'ပေးပြီး' : 'စရံ', '', '', '', m.paid], ['ကျန်', '', '', '', m.owed]];
  var sub = [fmtDayMy(order.orderedDay), 'ဝယ်သူ ' + (c ? c.name : order.customerId) + (c && c.phone ? ' · ' + fmtPhone(c.phone) + (/viber/i.test(c.note || '') ? ' (Viber)' : '') : ''),
             'ရွေးမည့်ရက် ' + (order.dueDay ? fmtDayMy(order.dueDay) : '-')];
  var footer = [shopAddress(ports, order.shop), shopPhone(ports, order.shop) ? '📞 ' + shopPhone(ports, order.shop) : ''].filter(Boolean).join(' · ');
  var foot = [footer || reportFooter(now)], accounts = voucherTransferLines(ports, order, m);
  if (accounts.length) foot = [t(ports, 'receipt_transfer', { accounts: accounts[0] })].concat(accounts.slice(1)).concat(foot);
  return { kind: 'voucher', pageSize: 'A5', fileName: 'voucher-' + orderId, title: t(ports, 'rep_voucher_title', { brand: shopBrand(ports, order.shop), no: orderNo(orderId) }),
           subtitle: sub.join(' · '), sections: [{ heading: '', columns: ['No', 'ပစ္စည်း', 'ထည်', 'စျေး', 'ငွေ'], rows: rows, totals: totals }],
           footer: foot.join('\n') };
}

/* ------------------------------ measurements ------------------------------ */

/**
 * MeasureFields as {key, labelMy, labelEn, group, multi, type, order, active}, in group order then Order. Sources, the
 * first that has a field (spec 9.1): store.listMeasureFields() (the server, the simulator); Settings meas_fields_json,
 * the JSON array the sync server derives from that tab (the phone, which has no MeasureFields tab); the CFG seed.
 */
function measureFields(ports, activeOnly) {
  var list = ports.store.listMeasureFields ? ports.store.listMeasureFields() : [];
  if (!list || !list.length) {
    var raw = ports.store.getSetting ? ports.store.getSetting('meas_fields_json', '') : '', parsed = null;
    if (raw && typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch (ignore) { parsed = null; } }
    else if (raw && typeof raw === 'object') parsed = raw;
    list = Array.isArray(parsed) ? parsed.filter(function (f) { return f && typeof f === 'object' && f.key !== undefined && f.key !== null && String(f.key) !== ''; }) : [];
  }
  if (!list.length) {
    list = CFG.MEASURE_FIELDS.map(function (f, i) { return { key: f[0], labelMy: f[1], labelEn: f[2], group: f[3], multi: f[4], type: f[5], order: i + 1, active: true }; });
  }
  list = list.map(function (f, i) {
    var active = f.active === undefined || f.active === '' || f.active === true || String(f.active).toUpperCase() === 'TRUE' || String(f.active) === '1';
    return { key: String(f.key), labelMy: f.labelMy || f.key, labelEn: f.labelEn || '', group: f.group || 'general', multi: Number(f.multi) || 1,
             type: f.type === 'text' ? 'text' : 'number', order: Number(f.order) || (i + 1), active: active, _i: i };
  });
  list.sort(function (a, b) {
    var ga = CFG.MEAS_GROUPS.indexOf(a.group), gb = CFG.MEAS_GROUPS.indexOf(b.group);
    if (ga < 0) ga = 99;
    if (gb < 0) gb = 99;
    return ga - gb || a.order - b.order || a._i - b._i;
  });
  return activeOnly ? list.filter(function (f) { return f.active; }) : list;
}

function measGroupLabel(ports, group) {
  var s = t(ports, 'mg_' + group);
  return s === 'mg_' + group ? group : s;
}

/** A typed or spoken value as it is stored: Burmese digits to Arabic, trimmed, otherwise exactly as written ('36/30/20', '17.5', 'ဘယ်'). */
function normMeasValue(field, text) {
  var s = String(text || '').replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); }).trim();
  if (field.type === 'number') {
    var compact = s.replace(/\s*\/\s*/g, '/').replace(/,/g, '');
    if (/^[\d.\/ ]+$/.test(compact)) return compact.replace(/\s+/g, '');
    var n = parseNumberText(s);
    if (n !== null && !/^[\d.\/ ]+$/.test(compact)) return String(n);
  }
  return s;
}

/** Grouped 'label · value' lines of a session; low = keys the sheet reader was unsure about (❓). allFields shows blanks as —. */
function measurementSummaryLines(ports, fields, values, low, allFields) {
  var lines = [], lastGroup = null, lowSet = {};
  (low || []).forEach(function (k) { lowSet[k] = true; });
  fields.forEach(function (f) {
    var v = values[f.key];
    var has = v !== undefined && v !== null && String(v) !== '';
    if (!has && !allFields) return;
    if (f.group !== lastGroup) { lines.push('▫️ ' + measGroupLabel(ports, f.group)); lastGroup = f.group; }
    lines.push(f.labelMy + ' · ' + (has ? String(v) : '—') + (lowSet[f.key] ? t(ports, 'ms_low_mark') : ''));
  });
  return lines;
}

function measurementCount(fields, values) {
  return fields.filter(function (f) { var v = values[f.key]; return v !== undefined && v !== null && String(v) !== ''; }).length;
}

/** The newest measurement session of a customer, or null. */
function latestMeasurement(ports, customerId) {
  var list = ports.store.listMeasurements(customerId);
  return list.length ? list[list.length - 1] : null;
}

/**
 * Save a session as a new Measurements row (rows are never edited; a fix is a new row that names the one it
 * corrects) and point the order at it. Returns the stored record.
 */
function saveMeasurement(ports, s, staff) {
  var now = ports.clock.now(), values = {};
  measureFields(ports, false).forEach(function (f) {
    var v = s.values[f.key];
    values[f.key] = v === undefined || v === null ? '' : String(v);
  });
  var notes = s.notes || '';
  if (s.fixOf) notes = (notes ? notes + ' · ' : '') + 'fix of ' + s.fixOf;
  var add = {
    customerId: s.customerId, orderId: s.orderId || '', day: dayKey(now), staffId: staff.id, source: s.source || CFG.MEAS_SOURCE.CHAT,
    photoUrl: s.photoUrl || '', notes: notes, fields: values
  };
  // The drawing on the figure (round 6, revision 3) goes with a session that has one (a Telegram fix or copy keeps it).
  if (s.sketch) add.sketch = s.sketch;
  var rec = ports.store.addMeasurement(add);
  if (s.orderId && ports.store.getOrder(s.orderId)) ports.store.updateOrder(s.orderId, { measId: rec.id });
  return rec;
}

/** The measurement sheet in the paper layout: header block, one section per group (label | value), notes, photo, order lines. */
function measurementReport(ports, p, now) {
  var meas = p.measId ? ports.store.getMeasurement(p.measId) : null;
  var customerId = p.customerId || (meas && meas.customerId);
  if (!meas && customerId) meas = latestMeasurement(ports, customerId);
  if (!meas) return null;
  var c = ports.store.getCustomer(meas.customerId), name = c ? c.name : meas.customerId;
  var orderId = p.orderId || meas.orderId, order = orderId ? ports.store.getOrder(orderId) : null;
  var fields = measureFields(ports, true), sections = [];
  var head = [['အမည်', name], ['ဖုန်းနံပါတ်', c && c.phone ? fmtPhone(c.phone) : ''],
              ['အပ်သည့်ရက်', order ? fmtDayMy(order.orderedDay) : fmtDayMy(meas.day)], ['ရွေးမည့်ရက်', order && order.dueDay ? fmtDayMy(order.dueDay) : ''],
              ['အရေအတွက်', order ? fmtCount(orderLines(ports, order.id).reduce(function (a, l) { return a + Number(l.qty); }, 0)) : ''],
              ['အတိုင်း မှတ်တမ်း', meas.id + ' · ' + fmtDayMy(meas.day)]];
  sections.push({ heading: '', columns: ['', ''], rows: head });
  CFG.MEAS_GROUPS.forEach(function (g) {
    var rows = fields.filter(function (f) { return f.group === g; }).map(function (f) { var v = meas.fields[f.key]; return [f.labelMy, v === undefined || v === null ? '' : String(v)]; });
    if (rows.length) sections.push({ heading: measGroupLabel(ports, g), columns: ['အတိုင်း', 'တန်ဖိုး (cm)'], rows: rows });
  });
  var extra = [];
  // The session's Notes (round 6, revision 3): the 'fix of M-…' part that saveMeasurement appends (' · fix of ' or a
  // leading 'fix of ') prints as its own row; the rest (a PHOTO session's margin note) prints only when it is not
  // already the note field's value.
  var notes = String(meas.notes || ''), fixPart = '', fixAt = /(^| · )fix of /.exec(notes);
  if (fixAt) {
    fixPart = notes.slice(fixAt.index + fixAt[1].length);
    notes = notes.slice(0, fixAt.index);
  }
  var noteField = meas.fields ? String(meas.fields[CFG.MEAS_NOTE_KEY] === undefined || meas.fields[CFG.MEAS_NOTE_KEY] === null ? '' : meas.fields[CFG.MEAS_NOTE_KEY]) : '';
  if (notes && notes !== noteField) extra.push(['မှတ်ချက်', notes]);
  if (fixPart) extra.push(['ပြင်ဆင်ချက်', fixPart]);
  // A drawing's picture is the session's PhotoURL: never printed as a sheet photo.
  if (meas.photoUrl && !meas.sketch) extra.push(['စာရွက် ဓာတ်ပုံ', meas.photoUrl]);
  if (order) extra.push(['ဘောက်ချာ ' + orderNo(order.id), orderLines(ports, order.id).map(function (l) { return orderLineDesc(ports, l) + ' × ' + fmtCount(l.qty); }).join('; ')]);
  if (extra.length) sections.push({ heading: '', columns: ['', ''], rows: extra });
  var shop = order ? order.shop : (p.shop || CFG.SHOP_IDS[0]);
  var report = { kind: 'meas', fileName: 'measure-' + meas.id, title: t(ports, 'rep_meas_title', { name: name }),
           subtitle: shopBrand(ports, shop) + (order ? ' · ဘောက်ချာ ' + orderNo(order.id) : ''), sections: sections, footer: reportFooter(now) };
  // The figure with the tailor's drawing (its PNG reached the server as the session's PhotoURL): gas_pdf.js places it.
  if (meas.sketch && meas.photoUrl) report.image = { url: meas.photoUrl, caption: 'ကိုယ်ပုံ' };
  return report;
}

/* ------------------------------ monthly section ------------------------------ */

/** 'အော်ဒါ ချုပ်' rows for the month report: delivered, revenue, fees, advances received, held for open orders, cancelled. */
function orderMonthSection(ports, ym, shops, stats) {
  var rows = shops.map(function (shop) {
    var s = stats[shop];
    var held = openOrders(ports, shop).reduce(function (a, o) { return a + depositEarmark(ports, o.customerId, o.id); }, 0);
    var cancelled = ports.store.listOrders(shop, null).filter(function (o) {
      return o.status === CFG.ORDER_STATUS.CANCELLED && String(o.statusAt || '').slice(0, 7) === ym;
    }).length;
    return [shopName(ports, shop), s.ordersDelivered, s.orderRevenue - s.fees, s.fees, s.orderDeposits, held, cancelled];
  });
  return { heading: t(ports, 'rep_orders_section'), columns: ['ဆိုင်', 'ပေးအပ်ပြီး', 'အော်ဒါ ရောင်းရငွေ', 'ပယ်ဖျက်ခ', 'စရံ လက်ခံ', 'စရံ ကျန် (ဖွင့်ထား)', 'ပယ်ဖျက်'],
           rows: rows, totals: rows.length > 1 ? [sumRows(rows, 'စုစုပေါင်း', 1)] : [] };
}
