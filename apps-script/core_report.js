/**
 * core_report.js — report and receipt content, platform-free.
 * A report is {kind, fileName, title, subtitle, sections:[{heading, columns, rows, totals}], footer}.
 * gas_pdf.js turns it into a PDF through a Sheet export; the simulator shows it as a table.
 */
var TX_LABEL = {
  SALE: 'ရောင်း', RESTOCK: 'ကုန်ရောက်', RETURN: 'ပြန်အမ်း', EXPENSE: 'ကုန်ကျ', TRANSFER_OUT: 'ပြောင်းထွက်',
  TRANSFER_IN: 'ပြောင်းဝင်', ADJUST: 'ပြင်', PAYMENT: 'ငွေလက်ခံ', DEPOSIT: 'စရံ', DEPOSIT_APPLIED: 'စရံသုံး', FEE: 'ပယ်ဖျက်ခ'
};

function txLabel(type) { return TX_LABEL[type] || type; }

/** The header of the promised-date column in the three credit tables (round 5); a code constant, not a Messages key. */
var DUE_COL_HEADER = 'ပေးမည့်ရက်';

/** The promised-date cell of a credit row: the day, prefixed ⏰ once overdue; '' when undated. */
function creditDueCell(c) {
  if (!c.dueDay) return '';
  return (c.overdue ? '⏰ ' : '') + fmtDayShortMy(c.dueDay);
}

/** True when the custom-order module (core_orders.js) is loaded and the store has its tabs. */
function ordersEnabled(ports) {
  return typeof openOrders === 'function' && !!(ports && ports.store && ports.store.listOrders);
}

function buildReport(ports, kind, o) {
  o = o || {};
  var now = o.now || ports.clock.now();
  var shops = o.shop ? [o.shop] : CFG.SHOP_IDS;
  if (kind === 'year') return closingReport(ports, o.year || dayKey(now).slice(0, 4), shops, now);
  if (kind === 'today' || kind === 'day') return dayReport(ports, o.day || dayKey(now), shops, now);
  if (kind === 'month') return monthReport(ports, o.month || monthKey(now), shops, now);
  if (kind === 'last') return monthReport(ports, prevMonthKey(now), shops, now);
  if (kind === 'stock') return stockReport(ports, shops, now);
  if (kind === 'owed') return owedReport(ports, shops, now);
  if (kind === 'exp') return expenseReport(ports, o.month || monthKey(now), shops, now);
  if (kind === 'customer') return customerReport(ports, o.customerId, shops, now);
  // Custom orders (core_orders.js): the open-orders list, one measurement sheet, one voucher.
  if (kind === 'orders' && ordersEnabled(ports)) return ordersReport(ports, shops, now);
  if (kind === 'meas' && ordersEnabled(ports)) return measurementReport(ports, o, now);
  if (kind === 'voucher' && ordersEnabled(ports)) return voucherReport(ports, o.orderId, now);
  throw new Error('Unknown report ' + kind);
}

function reportFooter(now) {
  return 'ထုတ်သည့်အချိန် ' + fmtDayMy(dayKey(now)) + ' ' + timeKey(now);
}

/** ငွေသား + ဘဏ် = ငွေလက်ခံ (gross cash in by channel); the daily text line shows net movement instead. */
function summaryRow(ports, shop, s) {
  return [shopName(ports, shop), s.revenue, s.pieces, s.cashIn, s.drawerIn, s.bankIn, s.expenses, s.cogs, s.profit, s.samplesSold];
}
var SUMMARY_COLS = ['ဆိုင်', 'ရောင်းရငွေ', 'ထည်', 'ငွေလက်ခံ', 'ငွေသား', 'ဘဏ်', 'ကုန်ကျစရိတ်', 'ပစ္စည်းကုန်ကျ', 'အမြတ်', 'နမူနာ ရောင်း'];

function sumRows(rows, label, from) {
  var tot = rows.length ? rows[0].map(function (_, i) { return i < from ? '' : 0; }) : [];
  rows.forEach(function (r) { for (var i = from; i < r.length; i++) tot[i] += Number(r[i]) || 0; });
  if (tot.length) tot[0] = label;
  return tot;
}

function shopList(ports, shops) {
  return shops.map(function (s) { return shopName(ports, s); }).join(' · ');
}

/** Item name, or the expense category, or the note. Without the customer. */
function itemLabel(ports, r) {
  if (r.itemId) {
    var it = ports.store.getItem(r.itemId);
    if (it && it.name) return it.name;
    // A delivered voucher line (V1-2532-1) has no Items row: the Note holds fabric + design + description.
    if (isOrderLineId(r.itemId) && r.note && r.note !== 'deposit' && r.note !== 'delivery') return r.note;
    return r.itemId;
  }
  if (r.type === CFG.TX.EXPENSE) return categoryLabel(ports, r.category);
  return r.note || '';
}

function rowDescription(ports, r) {
  if (r.itemId) {
    var name = itemLabel(ports, r);
    if (r.customerId) name += ' · ' + customerName(ports, r.customerId);
    return name;
  }
  if (r.type === CFG.TX.EXPENSE) return itemLabel(ports, r);
  if (r.customerId) return customerName(ports, r.customerId);
  return r.note || '';
}

/** One line for a ledger row: 'ရောင်း ၂ ထည် · လုံချည် ကချင် အပြာ · 36,000 ကျပ်'. Used by proposals and cards. */
function describeRow(ports, r) {
  if (!r) return '';
  var parts = [txLabel(r.type) + (r.qty ? ' ' + fmtCount(Math.abs(r.qty)) + ' ထည်' : '')];
  var label = itemLabel(ports, r);
  if (label && (r.itemId || r.type === CFG.TX.EXPENSE)) parts.push(label);
  if (r.customerId) parts.push('👤 ' + customerName(ports, r.customerId));
  parts.push(fmtMoney(Math.abs(r.amount)) + ' ကျပ်');
  return parts.join(' · ');
}

/**
 * One line for a group's rows (round 6): a basket (more than one live SALE row, not a custom-order delivery) reads
 * 'ရောင်း 🛍 ၃ ခု · 83,000 ကျပ်' (+ ' · 👤 ' + the buyer); a restock of several lines (more than one live RESTOCK row, the
 * same guard) restock_group_done; anything else describeRow of its first live row, so a one-row group and a delivery read
 * as before. The app's pending lines use it.
 */
function describeGroup(ports, txs) {
  if (!txs || !txs.length) return '';
  var live = liveRows(txs), order = isOrderId(txs[0].groupId);
  var of = function (type) { return live.filter(function (r) { return r.type === type; }); };
  var sales = of(CFG.TX.SALE), restocks = of(CFG.TX.RESTOCK);
  if (!order && sales.length > 1) {
    var sum = 0;
    sales.forEach(function (r) { sum += r.amount; });
    return txLabel(CFG.TX.SALE) + ' ' + t(ports, 'basket_line', { n: fmtCount(sales.length), amount: fmtMoney(sum) }) +
      (sales[0].customerId ? ' · 👤 ' + customerName(ports, sales[0].customerId) : '');
  }
  if (!order && restocks.length > 1) {
    var qty = 0;
    restocks.forEach(function (r) { qty += Number(r.qty) || 0; });
    return t(ports, 'restock_group_done', { n: fmtCount(restocks.length), qty: fmtCount(qty) });
  }
  return describeRow(ports, live[0] || txs[0]);
}

function byTime(a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; }

/**
 * Rows for printing. A rewrite (mirror with Note 'rewrite' + replacement in the same group) is one
 * event, so the original row and its rewrite mirror are dropped and the replacement is marked (ပြင်).
 * Undo mirrors stay visible as (ပြန်ဖျက်) lines next to the row they reverse, as before.
 * `all` is the whole ledger (the mirror may be outside `rows`). Returns [{row, mark}] in time order.
 */
function printableRows(ports, all, rows) {
  var reversedBy = {}, rewrittenTypes = {};
  all.forEach(function (r) {
    if (!r.reversesTxId) return;
    reversedBy[r.reversesTxId] = r;
    if (r.note === 'rewrite') (rewrittenTypes[r.groupId] = rewrittenTypes[r.groupId] || {})[r.type] = true;
  });
  var out = [];
  rows.forEach(function (r) {
    if (r.reversesTxId && r.note === 'rewrite') return;
    var rev = reversedBy[r.txId];
    if (rev && rev.note === 'rewrite') return;
    var mark = '';
    if (r.reversesTxId) mark = t(ports, 'rep_undo_mark');
    else if (rewrittenTypes[r.groupId] && rewrittenTypes[r.groupId][r.type]) mark = t(ports, 'rep_rewrite_mark');
    out.push({ row: r, mark: mark });
  });
  out.sort(function (a, b) { return byTime(a.row, b.row); });
  return out;
}

/** 'ငွေသား 134,000 · KBZPay 36,000': net cash movement per method. */
function methodNetText(ports, s) {
  return Object.keys(s.byMethod).filter(function (k) { return s.byMethod[k]['in'] || s.byMethod[k].out; })
    .map(function (k) { return methodLabel(ports, k) + ' ' + fmtMoney(s.byMethod[k]['in'] - s.byMethod[k].out); }).join(' · ');
}

function methodSection(ports, shop, s, withShop) {
  var rows = Object.keys(s.byMethod).filter(function (k) { return s.byMethod[k]['in'] || s.byMethod[k].out; })
    .map(function (k) { var m = s.byMethod[k]; return [methodLabel(ports, k), m['in'], m.out, m['in'] - m.out]; });
  return {
    heading: t(ports, 'rep_by_method') + (withShop ? ' · ' + shopName(ports, shop) : ''),
    columns: ['နည်းလမ်း', 'ဝင်', 'ထွက်', 'ကျန်'], rows: rows, totals: rows.length ? [sumRows(rows, 'စုစုပေါင်း', 1)] : []
  };
}

function categorySection(ports, shop, s, withShop) {
  var rows = Object.keys(s.expensesByCategory).map(function (k) {
    var c = s.expensesByCategory[k];
    return [categoryLabel(ports, k), c.count, c.total, c.bank];
  }).filter(function (r) { return r[1] || r[2]; }).sort(function (a, b) { return b[2] - a[2]; });
  return {
    heading: t(ports, 'rep_by_cat') + (withShop ? ' · ' + shopName(ports, shop) : ''),
    columns: ['အမျိုးအစား', 'အကြိမ်', 'စုစုပေါင်း', 'ဘဏ်မှ'], rows: rows, totals: rows.length ? [sumRows(rows, 'စုစုပေါင်း', 1)] : []
  };
}

/**
 * A label lookup (methodLabel, categoryLabel) that asks once per key while one report is built: every
 * lookup reads the option lists, and a report prints one label per ledger row.
 */
function labelMemo(ports, lookup) {
  var known = {};
  return function (key) {
    var k = 'k:' + key;
    if (!Object.prototype.hasOwnProperty.call(known, k)) known[k] = lookup(ports, key);
    return known[k];
  };
}

function dayReport(ports, day, shops, now) {
  var all = ports.store.ledgerRows(), sections = [], method = labelMemo(ports, methodLabel);
  shops.forEach(function (shop) {
    var rows = all.filter(function (r) { return r.day === day && r.shop === shop; });
    var table = printableRows(ports, all, rows).map(function (x) {
      var r = x.row;
      // The two rows of a split sale (cash part, account part) carry the note 'split': printed in Burmese.
      var note = r.reversesTxId ? '' : (r.note === 'split' ? t(ports, 'note_split') : (r.note || ''));
      return [timeKey(new Date(r.time)), txLabel(r.type) + x.mark, rowDescription(ports, r),
              r.qty ? -r.qty : '', r.amount, r.cash, method(methodOf(r)), note];
    });
    var s = dayStats(ports, shop, day);
    sections.push({
      heading: shopName(ports, shop),
      columns: ['အချိန်', 'အမျိုးအစား', 'ပစ္စည်း / ဝယ်သူ', 'ထည်', 'ငွေ', 'ငွေလက်ခံ', 'နည်းလမ်း', 'မှတ်ချက်'],
      rows: table,
      totals: [['စုစုပေါင်း', '', '', s.pieces, s.revenue, s.cashNet, methodNetText(ports, s), '']]
    });
  });
  sections.push({
    heading: 'အနှစ်ချုပ်',
    columns: SUMMARY_COLS,
    rows: shops.map(function (shop) { return summaryRow(ports, shop, dayStats(ports, shop, day)); })
  });
  return {
    kind: 'day', fileName: 'daily-' + day, title: 'နေ့စဉ် အရောင်းစာရင်း · ' + fmtDayMy(day),
    subtitle: shopList(ports, shops), sections: sections, footer: reportFooter(now)
  };
}

function monthReport(ports, ym, shops, now) {
  var sections = [], stats = {};
  shops.forEach(function (shop) { stats[shop] = monthStats(ports, shop, ym); });
  var summary = shops.map(function (shop) { return summaryRow(ports, shop, stats[shop]); });
  sections.push({ heading: 'အနှစ်ချုပ်', columns: SUMMARY_COLS, rows: summary, totals: shops.length > 1 ? [sumRows(summary, 'စုစုပေါင်း', 1)] : [] });

  var days = {};
  ports.store.ledgerRows().forEach(function (r) {
    if (String(r.day).slice(0, 7) !== ym || shops.indexOf(r.shop) < 0) return;
    var d = days[r.day] || (days[r.day] = { revenue: 0, pieces: 0, cashIn: 0, cashOut: 0, expenses: 0, byMethod: {} });
    if (r.type === CFG.TX.SALE || r.type === CFG.TX.RETURN) { d.revenue += r.amount; d.pieces -= r.qty; }
    if (r.type === CFG.TX.EXPENSE) d.expenses -= r.amount;
    addCash(d, r);
    addMethodCash(d, r);
  });
  var dayRows = Object.keys(days).sort().map(function (k) {
    var d = finishMethodTotals(days[k]);
    return [fmtDayShortMy(k), d.revenue, d.pieces, d.cashIn, d.drawerIn, d.bankIn, d.expenses];
  });
  sections.push({ heading: 'နေ့အလိုက်', columns: ['ရက်', 'ရောင်းရငွေ', 'ထည်', 'ငွေလက်ခံ', 'ငွေသား', 'ဘဏ်', 'ကုန်ကျ'], rows: dayRows,
    totals: dayRows.length ? [sumRows(dayRows, 'စုစုပေါင်း', 1)] : [] });

  // Drawer and each wallet, line by line, so the owner can reconcile the cash count and the app statements.
  shops.forEach(function (shop) { sections.push(methodSection(ports, shop, stats[shop], shops.length > 1)); });
  shops.forEach(function (shop) { sections.push(categorySection(ports, shop, stats[shop], shops.length > 1)); });

  var credits = [];
  shops.forEach(function (shop) { credits = credits.concat(openCredits(ports, shop)); });
  credits.sort(byTime);
  sections.push({ heading: 'အကြွေး ကျန်', columns: ['ဝယ်သူ', 'ပစ္စည်း', 'ရက်စွဲ', 'စုစုပေါင်း', 'ပေးပြီး', 'ကျန်', 'ရက်', DUE_COL_HEADER],
    rows: credits.map(function (c) { return [c.customer, c.item, fmtDayShortMy(c.day), c.total, c.cash + c.payments + c.applied, c.owed, c.days, creditDueCell(c)]; }),
    totals: credits.length ? [['စုစုပေါင်း', '', '', 0, 0, credits.reduce(function (a, c) { return a + c.owed; }, 0), '', '']] : [] });

  var deposits = depositsHeldList(ports);
  sections.push({ heading: 'စရံ လက်ခံထား', columns: ['ဝယ်သူ', 'လက်ခံ', 'သုံးပြီး', 'ကျန်', 'နောက်ဆုံး', 'ဘောက်ချာ အတွက်'],
    rows: deposits.map(function (d) { return [d.customer, d.received, d.used, d.held, fmtDayShortMy(d.lastDay), d.earmarked || '']; }) });

  // Custom orders this month (plan 13.4): delivered, revenue, fees, advances, open vouchers' deposits, cancelled.
  if (ordersEnabled(ports)) sections.push(orderMonthSection(ports, ym, shops, stats));

  return {
    kind: 'month', fileName: 'monthly-' + ym, title: 'လစဉ် စာရင်း · ' + fmtMonthMy(ym),
    subtitle: shopList(ports, shops), sections: sections, footer: reportFooter(now)
  };
}

/** This month's expenses: live EXPENSE rows per shop with category and method, then the by-category totals. */
function expenseReport(ports, ym, shops, now) {
  var all = ports.store.ledgerRows(), sections = [], method = labelMemo(ports, methodLabel), category = labelMemo(ports, categoryLabel);
  shops.forEach(function (shop) {
    var rows = liveRows(all.filter(function (r) {
      return r.type === CFG.TX.EXPENSE && String(r.day).slice(0, 7) === ym && r.shop === shop;
    }), all).sort(byTime);
    var table = rows.map(function (r) { return [fmtDayShortMy(r.day), category(r.category), -r.amount, method(methodOf(r)), r.note || '']; });
    var total = rows.reduce(function (a, r) { return a - r.amount; }, 0);
    sections.push({ heading: shopName(ports, shop), columns: ['ရက်', 'အမျိုးအစား', 'ငွေ', 'နည်းလမ်း', 'မှတ်ချက်'], rows: table,
      totals: [['စုစုပေါင်း', '', total, '', '']] });
  });
  shops.forEach(function (shop) { sections.push(categorySection(ports, shop, monthStats(ports, shop, ym), shops.length > 1)); });
  return {
    kind: 'exp', fileName: 'expenses-' + ym, title: t(ports, 'rep_expense_title', { month: fmtMonthMy(ym) }),
    subtitle: shopList(ports, shops), sections: sections, footer: reportFooter(now)
  };
}

/** One customer's statement: summary, live rows with method, open credits, deposits. Shop-scoped for staff. */
function customerReport(ports, customerId, shops, now) {
  var c = ports.store.getCustomer(customerId);
  var name = c ? c.name : String(customerId || '');
  var all = ports.store.ledgerRows();
  var rows = liveRows(all.filter(function (r) { return r.customerId === customerId && shops.indexOf(r.shop) >= 0; }), all).sort(byTime);
  var s = customerSummary(ports, customerId), method = labelMemo(ports, methodLabel);
  var sections = [
    { heading: 'အနှစ်ချုပ်', columns: ['ဝယ်ပြီး', 'ပေးပြီး', 'ကျန်', 'စရံ လက်ခံထား', 'နောက်ဆုံး', 'အကြိမ်'],
      rows: [[s.bought, s.paid, s.owed, s.depositHeld, s.lastDay ? fmtDayShortMy(s.lastDay) : '', s.visits]] },
    { heading: 'စာရင်း', columns: ['ရက်', 'အမျိုးအစား', 'ပစ္စည်း', 'ငွေ', 'ငွေလက်ခံ', 'နည်းလမ်း'],
      rows: rows.map(function (r) { return [fmtDayShortMy(r.day), txLabel(r.type), itemLabel(ports, r), r.amount, r.cash, method(methodOf(r))]; }),
      totals: rows.length ? [['စုစုပေါင်း', '', '', rows.reduce(function (a, r) { return a + (r.type === CFG.TX.SALE || r.type === CFG.TX.RETURN ? r.amount : 0); }, 0),
                               rows.reduce(function (a, r) { return a + r.cash; }, 0), '']] : [] }
  ];
  var credits = openCredits(ports, null).filter(function (x) { return x.customerId === customerId && shops.indexOf(x.shop) >= 0; });
  sections.push({ heading: 'အကြွေး ကျန်', columns: ['ပစ္စည်း', 'ရက်စွဲ', 'စုစုပေါင်း', 'ပေးပြီး', 'ကျန်', 'ရက်', DUE_COL_HEADER],
    rows: credits.map(function (x) { return [x.item, fmtDayShortMy(x.day), x.total, x.cash + x.payments + x.applied, x.owed, x.days, creditDueCell(x)]; }),
    totals: credits.length ? [['စုစုပေါင်း', '', 0, 0, credits.reduce(function (a, x) { return a + x.owed; }, 0), '', '']] : [] });
  var dep = depositsHeldMap(ports)[customerId];
  sections.push({ heading: 'စရံ', columns: ['လက်ခံ', 'သုံးပြီး', 'ကျန်', 'နောက်ဆုံး'],
    rows: dep ? [[dep.received, dep.used, dep.held, fmtDayShortMy(dep.lastDay)]] : [] });
  return {
    kind: 'customer', fileName: 'customer-' + customerId + '-' + dayKey(now), title: t(ports, 'rep_customer_title', { name: name }),
    subtitle: (c && c.phone ? fmtPhone(c.phone) + ' · ' : '') + shopList(ports, shops), sections: sections, footer: reportFooter(now)
  };
}

function stockReport(ports, shops, now) {
  var sections = [];
  shops.forEach(function (shop) {
    var items = ports.store.listItems(shop).filter(function (it) { return it.status === CFG.STATUS.ACTIVE; });
    items.sort(function (a, b) { return (a.category + a.id) < (b.category + b.id) ? -1 : 1; });
    var rows = items.map(function (it) {
      return [it.id, it.name + (it.sample ? t(ports, 'sample_mark') : ''), it.category, it.price === '' ? 'စျေး မသတ်မှတ်ရသေး' : it.price,
              it.cost === '' ? '' : it.cost, it.stock];
    });
    var pieces = items.reduce(function (a, it) { return a + Number(it.stock); }, 0);
    var atPrice = items.reduce(function (a, it) { return a + Number(it.stock) * (Number(it.price) || 0); }, 0);
    var atCost = items.reduce(function (a, it) { return a + Number(it.stock) * (Number(it.cost) || 0); }, 0);
    sections.push({ heading: shopName(ports, shop), columns: ['Tag', 'အမည်', 'အမျိုးအစား', 'စျေး', 'ကုန်ကျ', 'လက်ကျန်'], rows: rows,
      totals: [['စုစုပေါင်း ' + items.length + ' မျိုး', '', '', 'တန်ဖိုး ' + fmtMoney(atPrice), 'ကုန်ကျ ' + fmtMoney(atCost), pieces]] });
  });
  return { kind: 'stock', fileName: 'stock-' + dayKey(now), title: 'ကုန်စာရင်း · ' + fmtDayMy(dayKey(now)),
    subtitle: shopList(ports, shops), sections: sections, footer: reportFooter(now) };
}

function owedReport(ports, shops, now) {
  var credits = [];
  shops.forEach(function (shop) { credits = credits.concat(openCredits(ports, shop)); });
  credits.sort(byTime);
  var rows = credits.map(function (c) { return [c.customer, shopName(ports, c.shop), c.item, fmtDayShortMy(c.day), c.total, c.cash + c.payments + c.applied, c.owed, c.days, creditDueCell(c)]; });
  return { kind: 'owed', fileName: 'owed-' + dayKey(now), title: 'အကြွေးစာရင်း · ' + fmtDayMy(dayKey(now)),
    subtitle: shopList(ports, shops),
    sections: [{ heading: '', columns: ['ဝယ်သူ', 'ဆိုင်', 'ပစ္စည်း', 'ရက်စွဲ', 'စုစုပေါင်း', 'ပေးပြီး', 'ကျန်', 'ရက်', DUE_COL_HEADER], rows: rows,
      totals: [['စုစုပေါင်း', '', '', '', 0, 0, credits.reduce(function (a, c) { return a + c.owed; }, 0), '', '']] }],
    footer: reportFooter(now) };
}

/* ------------------------------ receipts ------------------------------ */

/**
 * A voided (undone) sale still has its receipt: the number is never reused, the text says ပယ်ဖျက်.
 * Methods: how the cash arrived (sale cash plus later payments), for the "ပေးပြီး" line.
 * transfer / transferLines: where to transfer the balance (the shop's accounts that carry a number), only
 * while something is still owed on a live group; '' and [] otherwise.
 */
function buildReceipt(ports, groupId) {
  var info = saleGroupInfo(ports, groupId);
  if (!info) return null;
  var voided = info.voided;
  // One line per live SALE row (a delivered voucher has one per garment); a voided group lists the rows the undo reversed.
  var rows = voided ? (info.voidedRows.length ? info.voidedRows : [info.origin]) : info.rows;
  var origin = rows[0] || info.origin;
  var when = new Date(info.time);
  var total = rows.reduce(function (a, r) { return a + r.amount; }, 0);
  var customerId = origin.customerId || info.customerId;
  var lines = rows.map(function (r) {
    return { name: itemLabel(ports, r), qty: -r.qty, unit: r.unitPrice === '' ? 0 : Number(r.unitPrice), amount: r.amount };
  });
  var r = {
    no: receiptNumber(ports, groupId), groupId: groupId, shop: info.shop, shopName: shopName(ports, info.shop),
    day: info.day, date: fmtDayMy(info.day), time: timeKey(when),
    customer: customerId ? customerName(ports, customerId) : '',
    lines: lines,
    total: total, paid: voided ? 0 : info.cash + info.payments + info.applied, owed: voided ? 0 : info.owed,
    voided: voided, methods: voided ? [] : groupMethods(ports, groupId), applied: voided ? 0 : info.applied
  };
  if (isOrderId(groupId)) r.voucherNo = orderNo(groupId);
  var owes = !voided && r.owed > 0;
  r.transferLines = owes ? transferLines(ports, r.shop) : [];
  r.transfer = owes ? transferLine(ports, r.shop) : '';
  r.dueDay = info.dueDay || '';   // the promised date of a guided credit sale (round 5), printed while something is owed
  return r;
}

/** 'sale_due_set' for a receipt that still owes and carries a promised date, else ''. */
function receiptDueLine(ports, r) {
  return r.owed > 0 && r.dueDay ? t(ports, 'sale_due_set', { owed: fmtMoney(r.owed), date: fmtDayMy(r.dueDay) }) : '';
}

/** '' when everything was cash, ' (KBZPay)' for one non-cash method, ' (ငွေသား 6,000 · KBZPay 6,000)' when mixed. */
function receiptMethodText(ports, r) {
  var ms = (r.methods || []).filter(function (m) { return m.amount > 0; });
  if (!ms.length) return '';
  if (ms.length === 1) return ms[0].method === CFG.METHOD.CASH ? '' : ' (' + methodLabel(ports, ms[0].method) + ')';
  return ' (' + ms.map(function (m) { return methodLabel(ports, m.method) + ' ' + fmtMoney(m.amount); }).join(' · ') + ')';
}

function receiptText(ports, r) {
  var out = [t(ports, 'receipt_header', { shop: r.shopName, no: r.no + (r.voucherNo ? ' · ' + t(ports, 'btn_voucher').replace(/^\S+\s*/, '') + ' ' + r.voucherNo : ''), date: r.date, time: r.time })];
  if (r.voided) out.push(t(ports, 'receipt_void'));
  r.lines.forEach(function (l) { out.push(t(ports, 'receipt_line', { name: l.name, qty: fmtCount(l.qty), amount: fmtMoney(l.amount) })); });
  out.push('──────────');
  if (r.applied) out.push(t(ports, 'voucher_deposit', { deposit: fmtMoney(r.applied), method: '' }));
  out.push(t(ports, 'receipt_total', { total: fmtMoney(r.total), paid: fmtMoney(r.paid), owed: fmtMoney(r.owed), method: receiptMethodText(ports, r) }));
  if (r.transfer) out.push(r.transfer);
  var due = receiptDueLine(ports, r);
  if (due) out.push(due);
  if (r.customer) out.push(t(ports, 'receipt_customer', { customer: r.customer }));
  out.push(t(ports, 'receipt_thanks'));
  return out.join('\n');
}

/**
 * The receipt as PDF data. With a balance, the accounts to transfer to go into the footer ONE PER LINE, above
 * the thanks line: gas_pdf.js sizes column A to its longest cell and exports fit-to-width, so one long line
 * (or the subtitle) would shrink the whole receipt.
 */
function receiptReport(ports, r, now) {
  var totals = [['စုစုပေါင်း', '', '', r.total], ['ပေးပြီး' + receiptMethodText(ports, r), '', '', r.paid], ['ကျန်', '', '', r.owed]];
  var accounts = r.transferLines || [], footer = [t(ports, 'receipt_thanks')];
  // The promised date (one line, never in the subtitle) sits after the account lines and above the thanks line.
  var due = receiptDueLine(ports, r);
  if (due) footer = [due].concat(footer);
  if (accounts.length) footer = [t(ports, 'receipt_transfer', { accounts: accounts[0] })].concat(accounts.slice(1)).concat(footer);
  return {
    kind: 'receipt', fileName: r.no, title: r.shopName + ' · ဘောက်ချာ ' + r.no,
    subtitle: r.date + ' ' + r.time + (r.customer ? ' · ' + r.customer : '') + (r.voided ? ' · ' + t(ports, 'receipt_void') : ''),
    sections: [{ heading: '', columns: ['ပစ္စည်း', 'ထည်', 'စျေး', 'ငွေ'],
      rows: r.lines.map(function (l) { return [l.name, l.qty, l.unit, l.amount]; }),
      totals: totals }],
    footer: footer.join('\n')
  };
}

/** One period on paper or on screen. All totals use the same signed ledger rows as the daily close. */
function closingReport(ports, period, shops, now) {
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(period)) throw new Error('ရက်စွဲ ရွေးပါ');
  var matches = function (day) { return String(day).slice(0, period.length) === period; };
  var sections = [], summary = [], costsMissing = 0;
  var totals = { revenue: 0, cashIn: 0, cashOut: 0, expenses: 0, cogs: 0, profit: 0, pieces: 0 };
  var entries = ports.store.ledgerRows(), moves = {}, stock = {}, byCategory = {};
  var asOf = entries.filter(function (r) { return String(r.day).slice(0, period.length) <= period; });
  var closingPorts = Object.create(ports);
  closingPorts.store = Object.create(ports.store);
  closingPorts.store.ledgerRows = function () { return asOf; };
  var owed = openCredits(closingPorts, null).filter(function (c) { return shops.indexOf(c.shop) >= 0; });
  var moneyOwed = owed.reduce(function (n, c) { return n + c.owed; }, 0);
  var held = 0;
  var itemNames = {}, categories = {};
  ports.store.listItems(null).forEach(function (it) {
    itemNames[it.id] = it.name;
    categories[it.id] = it.category;
  });
  shops.forEach(function (shop) {
    var s = statsWhere(ports, shop, matches);
    Object.keys(totals).forEach(function (key) { totals[key] += s[key]; });
    costsMissing += Math.abs(s.unknownCostPieces);
    summary.push(summaryRow(ports, shop, s));
    sections.push(methodSection(ports, shop, s, true), categorySection(ports, shop, s, true));
  });
  var detail = [], receipts = [], sales = {}, months = {};
  entries.forEach(function (r) {
    var kind = r.type, T = CFG.TX, own = shops.indexOf(r.shop) >= 0;
    if (String(r.day).slice(0, period.length) > period) return;
    if (own) {
      if (kind === T.DEPOSIT) held += r.amount;
      if (kind === T.DEPOSIT_APPLIED) held -= r.amount;
      if (r.itemId && r.qty) {
        var stockKey = JSON.stringify([r.shop, r.itemId]);
        stock[stockKey] = (stock[stockKey] || 0) + r.qty;
      }
    }
    var name = shopName(ports, r.shop);
    var label = itemNames[r.itemId] || r.itemId || r.note || '';
    if (kind === T.TRANSFER_IN || kind === T.TRANSFER_OUT) {
      var move = moves[r.groupId] || (moves[r.groupId] = { day: r.day, item: label, qty: 0 });
      if (r.reversesTxId) move.undone = true;
      else {
        if (kind === T.TRANSFER_IN) { move.received = true; move.to = r.shop; move.from = String(r.note || '').replace(/^from /, '') || move.from; }
        if (kind === T.TRANSFER_OUT) { move.from = r.shop; move.to = String(r.note || '').replace(/^to /, '') || move.to; }
        move.qty = Math.abs(r.qty);
        if (matches(r.day)) { move.inPeriod = true; move.day = r.day; }
      }
    }
    if (!own || !matches(r.day)) return;
    if (kind === T.SALE || kind === T.RETURN || kind === T.FEE) {
      var cat = categories[r.itemId] || (isOrderId(r.groupId) ? 'အော်ဒါ' : txLabel(kind));
      var categoryKey = JSON.stringify([r.shop, cat]);
      byCategory[categoryKey] = (byCategory[categoryKey] || 0) + r.amount;
      var key = JSON.stringify([r.shop, cat, r.itemId || label]);
      var bucket = sales[key] || (sales[key] = [name, cat, label, 0, 0]);
      bucket[3] -= Number(r.qty) || 0;
      bucket[4] += Number(r.amount) || 0;
    }
    if (r.cash > 0 || r.cash < 0) receipts.push([r.day, name, txLabel(kind), methodLabel(ports, methodOf(r)), r.cash, r.receiptNo || r.groupId]);
    if (kind === T.EXPENSE) label = categoryLabel(ports, r.category) + ' ' + (r.note || '');
    detail.push([r.day, name, txLabel(kind), label, r.qty, r.amount, r.receiptNo || r.groupId]);
    months[String(r.day).slice(0, 7)] = true;
  });
  if (period.length === 4) {
    var byMonth = Object.keys(months).sort().map(function (ym) {
      var vals = [ym, 0, 0, 0, 0];
      shops.forEach(function (shop) {
        var m = monthStats(ports, shop, ym);
        vals[1] += m.revenue; vals[2] += m.cogs; vals[3] += m.expenses; vals[4] += m.profit;
      });
      return vals;
    });
    sections.unshift({ heading: 'လအလိုက်', columns: ['လ', 'ရောင်းရငွေ', 'ပစ္စည်းကုန်ကျ', 'စရိတ်', 'အမြတ် / အရှုံး'], rows: byMonth });
  }
  sections.unshift({ heading: 'ဆိုင်အလိုက်', columns: SUMMARY_COLS, rows: summary });
  sections.push({ heading: 'အမျိုးအစားအလိုက် ဝင်ငွေ', columns: ['ဆိုင်', 'အမျိုးအစား', 'ဝင်ငွေ'], rows: Object.keys(byCategory).sort().map(function (k) {
    var ids = JSON.parse(k); return [shopName(ports, ids[0]), ids[1], byCategory[k]];
  }) });
  sections.push({ heading: 'ကာလအဆုံး ရရန်ကျန်ငွေ', columns: ['ဆိုင်', 'ဝယ်သူ', 'ဘောက်ချာ', 'ကျန်ငွေ'], rows: owed.map(function (c) { return [shopName(ports, c.shop), c.customer, c.groupId, c.owed]; }) });
  sections.push({ heading: 'ကာလအဆုံး ဆိုင်ရှိပစ္စည်း', columns: ['ဆိုင်', 'Tag', 'ပစ္စည်း', 'လက်ကျန်'], rows: Object.keys(stock).sort().filter(function (k) { return stock[k] !== 0; }).map(function (k) {
    var ids = JSON.parse(k); return [shopName(ports, ids[0]), ids[1], itemNames[ids[1]] || ids[1], fmtCount(stock[k])];
  }) });
  sections.push({ heading: 'ပစ္စည်းအလိုက် အရောင်း', columns: ['ဆိုင်', 'အမျိုးအစား', 'ပစ္စည်း', 'ထည်', 'ရောင်းရငွေ'], rows: Object.keys(sales).sort().map(function (k) { return sales[k]; }) });
  sections.push({ heading: 'ငွေဝင် ငွေထွက်', columns: ['ရက်', 'ဆိုင်', 'အကြောင်း', 'နည်းလမ်း', 'ငွေ', 'ဘောက်ချာ'], rows: receipts });
  sections.push({ heading: 'ဆိုင်ပြောင်းစာရင်း', columns: ['ရက်', 'ပစ္စည်း', 'ပို့သည့်ဆိုင်', 'ရောက်သည့်ဆိုင်', 'ထည်', 'အခြေအနေ'], rows: Object.keys(moves).filter(function (k) { var m = moves[k]; return !m.undone && (m.inPeriod || !m.received) && (shops.indexOf(m.from) >= 0 || shops.indexOf(m.to) >= 0); }).map(function (k) {
    var m = moves[k]; return [m.day, m.item, shopName(ports, m.from), shopName(ports, m.to), m.qty, (m.received || k.indexOf('SHIP-') !== 0) ? 'လက်ခံပြီး' : 'ပို့ပြီး'];
  }) });
  sections.push({ heading: 'မှတ်တမ်း အပြည့်အစုံ', columns: ['ရက်', 'ဆိုင်', 'အကြောင်း', 'ပစ္စည်း', 'ထည်', 'ငွေ', 'ဘောက်ချာ'], rows: detail });
  var first = { heading: 'အနှစ်ချုပ်', columns: ['အကြောင်း', 'စုစုပေါင်း'], rows: [
    ['ရောင်းရငွေ (ပြန်အမ်းငွေ နုတ်ပြီး)', totals.revenue], ['ရောင်းထွက်သည့် အထည်', fmtCount(totals.pieces)],
    ['ငွေလက်ခံရရှိ', totals.cashIn], ['ငွေထွက်', totals.cashOut], ['ဝယ်သူများထံမှ ရရန်ကျန်', moneyOwed], ['လက်ကျန် စရန်ငွေ', held], ['ရောင်းပြီးပစ္စည်း အရင်း', totals.cogs], ['ဆိုင်ကုန်ကျစရိတ်', totals.expenses],
    [totals.profit < 0 ? 'အရှုံး' : 'အမြတ်', Math.abs(totals.profit)]
  ] };
  return { kind: 'close', title: 'ဆိုင်စာရင်း · ' + period, subtitle: shopList(ports, shops) + ' · ငွေပမာဏအားလုံး ကျပ်ဖြင့်', sections: [first].concat(sections),
    fileName: 'close-' + period, footer: reportFooter(now), missingCosts: costsMissing };
}
