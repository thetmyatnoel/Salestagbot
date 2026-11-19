/**
 * core_bot.js — the conversation. Entry point: processUpdate(update, ports).
 *
 * ports = {
 *   store: getItem, listItems, updateItem, appendLedger, ledgerRows, getStaff, listStaff,
 *          getCustomer, listCustomers, addCustomer, updateCustomer, getSetting, getMessage, logError, logUnknownUser,
 *          refreshViews (optional)
 *          option lists (optional, core_ledger.js listRows): listOptions, addListOption. Without addListOption the ➕
 *          buttons and the account-number entry answer add_unavailable.
 *          custom tailoring (optional, core_orders.js): getOrder, listOrders, addOrder, updateOrder, nextOrderNo,
 *          listOrderItems, addOrderItem, updateOrderItem, removeOrderItem, listDesigns, getDesign, listMeasureFields,
 *          addMeasurement, getMeasurement, listMeasurements, addDesign (optional: a typed new design code can be created)
 *   chat:  sendMessage, sendPhoto, sendDocument, editMessage, answerCallback, typing, getFile, savePhoto
 *   ai:    parseVoice, parseText, describePhoto, readNotebook, readMeasurementSheet
 *   pdf:   make(report) -> document handle for chat.sendDocument
 *   cache: get, put, remove        lock: run(fn)       clock: now()       uuid()
 *   sync (optional, plan 14.2): mintCode(staff, label) -> {text}, devicesText() -> {text, kb},
 *          deviceAction(deviceId, action) -> {text, kb}. Without it the 📲 button and /devices are absent.
 * }
 * Callback data (max 64 bytes): ACTION|arg|arg
 *   S sale  Q quantity grid  QN typed quantity  D sell at a price  R restock-ask  RQ restock-commit  T return  X transfer
 *   U undo  V owner void  Y/N confirm proposal  P price  C cost  PS sample toggle  SP set price  K open card  M menu  Z cancel
 *   M|restock the app's restock form (forms), else Telegram's 📦 restock loop (round 6b): RT|done ends the 📦 restock loop of
 *     the menu, RT|skip drops the tag at its count screen (round 6b)
 *   CR credit start  CP credit paid-now  CC credit customer  CD credit use-deposit
 *   PY payment pick  PL pay list of one customer  PA payment amount  DC deposit customer  DA deposit amount  DN deposit note skip
 *   PM payment method of a group  CU attach customer  CUP customer pick  CF phone  CH customer card  CS customer statement
 *   ES expense shop  EC expense category  EA expense amount  EM expense method (commits)  EN note on an expense
 *   RP report  RC receipt  RCP receipt pdf  NB notebook line item  DV device drain/revoke/activate (owner)
 *   SX split a sale (cash + one account)  SXM split account -> the amount screen  SXA split amount all/half (commits)
 *   LA|<list code>|<resume>|<args> add an option to a pick list (➕), then resume the flow it was tapped in
 *   LD|pm|<KEY> the number of an account (typed)
 *   SS|<a>|<letter>|<arg> the sale review card (round 6, Telegram in Settings sale_flow = form; <a> = the item the card was
 *     opened on): o|<buyer|method|paid|due> open a sub-screen, l|<id> a line, add ➕ another piece, i|<id> add that piece
 *     (the add screen, or the item card of a paused basket), go resume a paused card, q|<n> qn pr rm|<id> a line's count,
 *     typed count, typed price and removal, b buyer, ph phone, m how paid, a account (a|p<n> = page n), x transfer part,
 *     p how much now (p|all = paid in full), d due day, k kind of a new account, back|<step> to the parent, z cancel into
 *     the item card  SC|<a>|ok saves the card (the one write of the basket)
 *   NI|<id>|<q|qn|n|c|back>|<arg> the new-piece review card (form mode): count -/+, typed count, name, category, back
 *     (round 6b: c|<key> picks an item_category row by its key; LA|ic|NIC|<id> is the ➕ of the category screen)
 *     NC|<id>|ok registers the piece (the one write)
 *   LA|pm|SSA|<a> ➕ an account inside the review card  CD|<g>|yes|p[|<KEY>] the deposit question on the sold card (plain rows)
 *   O... and M[SMQKFGLP] custom tailoring orders and measurements (see the order section below; ORDER_ACTIONS)
 * Per-user cache keys: st:<uid> state, li:<uid> last scanned item, lg:<uid> last committed money group (for "Wave နဲ့ ပေးသွားတယ်"),
 *   rl:<uid> the ☰ 📦 loop's latest count screen (round 6b: a tap there after the loop's 180 s still counts as the loop's).
 * A committed card (sale, payment, deposit, expense, return, voucher reply) is never edited into a question: a
 * follow-up question from it is a new message. The actionable screen is always the last message of a reply.
 */

/**
 * Dedupe + error guard. Mirrors what doPost does in production; the simulator calls it too.
 * Telegram re-delivers an update until it is satisfied with the response, sometimes for
 * hours, so an update id is remembered twice: in the cache (6 h) and in a durable list
 * (ports.dedupe) that survives cache expiry.
 */
function processUpdate(update, ports) {
  var id = String(update.update_id);
  var key = 'upd:' + id;
  if (ports.cache.get(key)) return 'duplicate';
  if (ports.dedupe && ports.dedupe.seen(id)) return 'duplicate';
  ports.cache.put(key, '1', 21600);
  if (ports.dedupe) ports.dedupe.remember(id);
  try {
    handleUpdate(update, ports);
    return 'ok';
  } catch (err) {
    ports.store.logError('handleUpdate', err, update.update_id, safeJson(update));
    return 'error';
  }
}

function handleUpdate(update, ports) {
  var src = update.message || update.callback_query;
  if (!src || !src.from) return;
  // Group chats are only used for the daily summary. Log the id once so it can be configured.
  if (update.message && update.message.chat && update.message.chat.type !== 'private') {
    ports.store.logError('group_chat', 'Seen in group "' + (update.message.chat.title || '') +
      '". Put this chat id in Script Property GROUP_CHAT_ID: ' + update.message.chat.id, update.update_id, '');
    return;
  }
  var staff = ports.store.getStaff(String(src.from.id));
  if (!staff) {
    ports.store.logUnknownUser(src.from, update.update_id);
    if (update.message && update.message.chat) ports.chat.sendMessage(update.message.chat.id, t(ports, 'staff_only'));
    if (update.callback_query) ports.chat.answerCallback(update.callback_query.id);
    return;
  }
  if (update.callback_query) return handleCallback(update.callback_query, staff, update.update_id, ports);
  if (update.message) return handleMessage(update.message, staff, update.update_id, ports);
}

/* ------------------------------ messages ------------------------------ */

function handleMessage(msg, staff, updateId, ports) {
  var chatId = msg.chat.id, uid = String(msg.from.id);
  if (msg.text && /^\/start/.test(msg.text)) {
    var payload = (msg.text.split(/\s+/)[1] || '').trim().toUpperCase();
    // The voucher's link (?start=V1-2532) opens the order card.
    if (payload && isOrderId(payload) && ordersEnabled(ports)) { dropAddState(ports, uid); return openOrderCard(chatId, payload, staff, uid, ports); }
    // A scan: openTag decides the state as before (a known tag replaces or clears any prompt).
    if (payload && /^[A-Z0-9_-]{1,64}$/.test(payload)) return openTag(chatId, payload, staff, uid, ports);
    dropAddState(ports, uid);
    return showMenu(chatId, staff, ports);
  }
  if (msg.text === '/today') return answerToday(chatId, staff, ports);
  if (msg.text === '/help') return ports.chat.sendMessage(chatId, t(ports, 'help'));
  if (msg.text === '/report' || msg.text === '/reports') return showReportMenu(chatId, staff, ports);
  if (msg.text === '/devices') return showDevices(chatId, staff, ports);
  if (msg.voice || msg.audio) return handleVoice(msg, staff, updateId, ports);
  if (msg.photo) return handlePhoto(msg, staff, updateId, ports);
  if (msg.text) return handleText(msg, staff, updateId, ports);
}

/**
 * A scanned or typed tag (and K|, opts.card: always the item card). After the custom-order branches: (1) a Telegram basket
 * waiting at its add screen takes the piece; (2) a blank tag: in form mode a seller's tag of another shop is refused, in the
 * app the new-piece form opens, else the new-piece chat (form mode: its review card); (3) in the app with forms a sellable
 * piece of the basket's shop opens the sale form; (4) another tag while a Telegram basket is live pauses it; (5) else the
 * item card. quick: (2)'s form parts and (4) never apply.
 */
function openTag(chatId, itemId, staff, uid, ports, opts) {
  opts = opts || {};
  // Telegram's ☰ 📦 restock loop (round 6b, G3) takes every scanned or typed tag first (K|, opts.card, keeps the item card).
  var lp = opts.card ? null : restockLoopOf(getState(ports, uid));
  if (lp) return restockLoopTag(chatId, uid, lp, itemId, staff, ports);
  var item = ports.store.getItem(itemId);
  var form = saleFlow(ports) === CFG.SALE_FLOW.FORM, live = form && !formsInApp(ports) ? saleStateOf(ports, uid) : null;
  if (!item) {
    // An unknown tag at a basket's add screen comes back as the card with tag_not_found on top (the basket kept).
    if (live && live.step === 'add' && !live.paused && !opts.card) return basketAddScanned(saleCtx(chatId, uid, staff, null, ports), live, { id: itemId }, {});
    return ports.chat.sendMessage(chatId, t(ports, 'tag_not_found', { id: itemId }));
  }
  if (ordersEnabled(ports)) {
    // 🏷 Tag တပ် on an order card: the next scanned blank tag becomes that voucher line's piece.
    var st = getState(ports, uid);
    if (st && st.kind === 'order_tag') return attachTagToItem(chatId, uid, st, item, staff, ports);
    // A tag attached to a voucher line (Alias V1-2532-1) opens the order card while the order is open.
    if (isOrderLineId(item.alias)) {
      var tagged = ports.store.getOrder(orderIdOfLine(item.alias));
      if (tagged && orderIsOpen(tagged)) {
        clearState(ports, uid);
        setLastItem(ports, uid, itemId);
        return sendOrderCard(chatId, null, tagged.id, staff, ports);
      }
    }
  }
  if (live && live.step === 'add' && !live.paused && !opts.card) {
    return basketAddScanned(saleCtx(chatId, uid, staff, null, ports), live, item, {});
  }
  if (item.status === CFG.STATUS.BLANK) {
    if (form && staff.role !== 'owner' && item.shop !== staff.shop) {
      return ports.chat.sendMessage(chatId, t(ports, 'basket_other_shop', { id: itemId, shop: shopName(ports, item.shop) }));
    }
    if (formsInApp(ports)) {
      clearState(ports, uid);
      return ports.ui.openForm('newitem', { chatId: chatId, uid: uid, staff: staff, itemId: itemId });
    }
    basketClose(ports, chatId, uid);
    var ns = { kind: 'new_item', itemId: itemId, step: 'photo', draft: {} };
    if (form) ns.form = true;
    setState(ports, uid, ns);
    return ports.chat.sendMessage(chatId, t(ports, 'new_tag', { id: itemId }), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
  }
  if (formsInApp(ports) && !opts.card && basketAddItem(ports, staff, [], itemId, 1).ok) {
    clearState(ports, uid);
    setLastItem(ports, uid, itemId);
    return ports.ui.openForm('sale', { chatId: chatId, uid: uid, staff: staff, itemId: itemId, qty: 1 });
  }
  if (live && !opts.card) {
    setLastItem(ports, uid, itemId);
    return basketPause(saleCtx(chatId, uid, staff, null, ports), live, item);
  }
  clearState(ports, uid);
  setLastItem(ports, uid, itemId);
  return sendItemCard(chatId, item, staff, ports);
}

function showMenu(chatId, staff, ports) {
  var rows = [
    [btn(t(ports, 'btn_today'), 'M|today'), btn(t(ports, 'btn_recent'), 'M|recent'), btn(t(ports, 'btn_find'), 'M|find')],
    [btn(t(ports, 'btn_pay'), 'M|pay'), btn(t(ports, 'btn_deposit'), 'M|dep'), btn(t(ports, 'btn_expense'), 'M|exp')],
    [btn(t(ports, 'btn_customers'), 'M|cust'), btn(t(ports, 'btn_reports'), 'M|rep'), btn(t(ports, 'btn_help'), 'M|help')]
  ];
  // Orders, the notebook import and the bank accounts share one row below the three everyday rows (the sale paths are unchanged).
  var extra = [];
  if (ordersEnabled(ports)) extra.push(btn(t(ports, 'btn_orders'), 'M|ord'));
  else if (measureFormEnabled(ports)) extra.push(btn(t(ports, 'btn_measure'), 'M|meas'));   // the app: no orders, the measurement form
  // 📦 in every channel and both sale modes (round 6b, G3): the app's restock form with forms, else the restock loop.
  extra.push(btn(t(ports, 'btn_restock'), 'M|restock'));
  // The notebook needs the owner's AI switch too (round 6, F9b), in both channels.
  if (aiOn(ports) && settingOn(ports, 'notebook_import')) extra.push(btn(t(ports, 'btn_notebook'), 'M|nb'));
  extra.push(btn(t(ports, 'btn_accounts'), 'M|acct'));
  rows.push(extra);
  if (ports.sync) {
    // The app (plan 14.2): a typed one-time code for everyone, the phone list for the owner. Below the sale paths.
    var app = [btn(t(ports, 'btn_app'), 'M|app')];
    if (staff.role === 'owner') app.push(btn(t(ports, 'btn_devices'), 'M|devices'));
    rows.push(app);
  }
  return ports.chat.sendMessage(chatId, t(ports, 'menu'), rows);
}

/** 📲: a typed one-time enrollment code for the app, bound to this staff member (never inside a link). */
function sendEnrollCode(chatId, staff, ports) {
  if (!ports.sync) return ports.chat.sendMessage(chatId, t(ports, 'app_not_ready'));
  var minted = ports.sync.mintCode(staff, staff.name);
  return ports.chat.sendMessage(chatId, minted.text);
}

/** Owner-only 📱: the enrolled phones with ⏸ drain / 🟢 activate / ❌ revoke buttons (DV|<id>|action). */
function showDevices(chatId, staff, ports) {
  if (!ports.sync) return ports.chat.sendMessage(chatId, t(ports, 'app_not_ready'));
  if (staff.role !== 'owner') return ports.chat.sendMessage(chatId, t(ports, 'devices_owner_only'));
  var r = ports.sync.devicesText();
  return ports.chat.sendMessage(chatId, r.text, r.kb || []);
}

/**
 * PC / USB-scanner path (plan 13.5): a bare tag id typed into Telegram Desktop, or a pasted
 * t.me/<bot>?start=<id> link, opens the card without an AI call. Returns the id or null.
 */
function tagIdFromText(text) {
  var s = String(text || '').trim();
  if (/^S[12]-\d{4}$/i.test(s)) return s.toUpperCase();
  var m = s.match(/t\.me\/[^?\s]+\?start=([A-Za-z0-9_-]{1,64})/i);
  return m ? m[1].toUpperCase() : null;
}

/* ------------------------------ item card ------------------------------ */

function isPricePending(item) {
  return item.price === '' || item.price === null || item.price === undefined || Number(item.price) <= 0;
}

function cardText(ports, item) {
  var name = item.name + (item.sample ? t(ports, 'sample_mark') : '');
  var vars = { emoji: itemEmoji(ports, item), id: item.id, name: name, price: fmtMoney(item.price), stock: fmtCount(item.stock) };
  if (isPricePending(item)) return t(ports, 'card_pending', vars);
  var soldOut = item.type === CFG.ITEM_TYPE.UNIQUE && Number(item.stock) <= 0;
  var text = t(ports, soldOut ? 'card_sold_out' : 'card', vars);
  if (soldOut) {
    // "Which customer bought this piece" from the item side (plan 13.2).
    var sale = lastLiveSale(ports, item.id);
    if (sale && sale.customerId) {
      var info = saleGroupInfo(ports, sale.groupId);
      // How it was paid: one method by its label; a split or a later payment as "label amount · label amount".
      var ms = groupMethods(ports, sale.groupId), how;
      if (ms.length === 1) how = methodLabel(ports, ms[0].method);
      else if (ms.length > 1) how = ms.map(function (m) { return methodLabel(ports, m.method) + ' ' + fmtMoney(m.amount); }).join(' · ');
      else how = methodLabel(ports, methodOf(sale) || CFG.METHOD.CASH);
      var buyerVars = {
        customer: customerName(ports, sale.customerId),
        paid: fmtMoney(info ? info.cash + info.payments + info.applied : sale.cash),
        method: how
      };
      // A piece sold in a basket (round 6): the figure is the basket's, and the line says so.
      if (basketGroup(info)) buyerVars.n = fmtCount(info.rows.length);
      text += '\n' + t(ports, basketGroup(info) ? 'card_buyer_basket' : 'card_buyer', buyerVars);
    }
  }
  return text;
}

function cardKeyboard(ports, item) {
  var id = item.id, rows = [];
  var transfer = btn(t(ports, 'btn_transfer', { shop: shopName(ports, otherShop(item.shop)) }), 'X|' + id);
  if (isPricePending(item)) {
    rows.push([btn(t(ports, 'btn_sell_at'), 'D|' + id)]);
    rows.push([btn(t(ports, 'btn_set_price'), 'SP|' + id + '|ask'), transfer]);
    return rows;
  }
  if (item.type === CFG.ITEM_TYPE.UNIQUE) {
    if (Number(item.stock) > 0) {
      rows.push([btn(t(ports, 'btn_sold'), 'S|' + id + '|1')]);
      rows.push([btn(t(ports, 'btn_discount'), 'D|' + id), btn(t(ports, 'btn_return'), 'T|' + id)]);
      rows.push([transfer]);
    } else {
      rows.push([btn(t(ports, 'btn_return'), 'T|' + id)]);
    }
  } else {
    // One tap sells one piece (most sales); the 🔢 button opens a 2..9 grid plus "type it" (plan 14.3b).
    rows.push([btn(t(ports, 'btn_sell_one'), 'S|' + id + '|1'), btn(t(ports, 'btn_qty'), 'Q|' + id)]);
    rows.push([btn(t(ports, 'btn_discount'), 'D|' + id), btn(t(ports, 'btn_restock'), 'R|' + id)]);
    rows.push([btn(t(ports, 'btn_return'), 'T|' + id), transfer]);
  }
  return rows;
}

/**
 * The item card. opts (round 6): undo = a group id (the form-mode new piece: ↩️ as the first row), addTo = {anchor} (a
 * paused basket: ➕ စာရင်းထဲ ထည့် as the first row), extra = lines under the card in the app's view. The owner's card of a
 * piece last sold in a basket ends with 🧾 (ownerBasketRow). Without opts and for a seller: the card of before, byte for byte.
 */
function sendItemCard(chatId, item, staff, ports, opts) {
  opts = opts || {};
  var text = cardText(ports, item), kb = cardKeyboard(ports, item);
  if (opts.addTo) kb = [[btn(t(ports, 'btn_add_to_list'), 'SS|' + opts.addTo.anchor + '|i|' + item.id)]].concat(kb);
  if (opts.undo) kb = undoRow(ports, opts.undo).concat(kb);
  kb = kb.concat(ownerBasketRow(ports, staff, item));
  var x = viewOf(ports, { kind: 'item', id: item.id, extra: opts.extra || [] });
  // Settings text_cards = TRUE sends cards without the photo: faster on a slow connection.
  if ((item.photoFileId || item.photoUrl) && !settingOn(ports, 'text_cards')) {
    return x ? ports.chat.sendPhoto(chatId, item.photoFileId || item.photoUrl, text, kb, x) : ports.chat.sendPhoto(chatId, item.photoFileId || item.photoUrl, text, kb);
  }
  return x ? ports.chat.sendMessage(chatId, text, kb, x) : ports.chat.sendMessage(chatId, text, kb);
}

function soldText(ports, item, qty, r) {
  return cardText(ports, item) + '\n' + t(ports, 'sold_done', { qty: fmtCount(qty), amount: fmtMoney(r.txs[0].amount), stock: fmtCount(item.stock) });
}

/**
 * The 🔢 grid: ၂..၉ sell that many through the same S|id|N action (in Telegram's form mode S opens the review card with that
 * count); ✏️ asks for a typed number. Returns sendMessage's {messageId}.
 */
function askQty(chatId, uid, item, ports) {
  var rows = [], row = [];
  CFG.QTY_GRID.forEach(function (n) {
    row.push(btn(myDigits(n), 'S|' + item.id + '|' + n));
    if (row.length === 4) { rows.push(row); row = []; }
  });
  if (row.length) rows.push(row);
  rows.push([btn(t(ports, 'btn_type_qty'), 'QN|' + item.id), btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, t(ports, 'ask_qty') + '\n' + item.id + ' · ' + item.name, rows);
}

function clampQty(v) {
  var q = Math.round(Number(v));
  if (!(q >= 1)) q = 1;
  return Math.min(q, CFG.MAX_SALE_QTY);
}

/**
 * Buttons under a committed sale. Undo and receipt always; "receive payment" while money is owed;
 * while the group can still be rewritten (one live row, today, no payment attached): "not fully paid"
 * when it is paid, 👤 when no customer is attached, and, while cash was paid, one 🏦 button per other
 * account of the sale's shop with a last row "💵+🏦 split" and "➕ new bank".
 * The credit state comes from the ledger (owed > 0), never from whether a customer is attached.
 * opts.plain (the guided sale's sold card): the undo/receipt row and the 💰 row only, no corrective buttons.
 */
function afterSaleKeyboard(ports, groupId, opts) {
  var rows = [[btn(t(ports, 'btn_undo'), 'U|' + groupId), btn(t(ports, 'btn_receipt'), 'RC|' + groupId)]];
  var info = saleGroupInfo(ports, groupId);
  if (!info || info.voided) return rows;
  if (info.owed > 0) rows.push([btn(t(ports, 'btn_pay'), 'PY|' + groupId)]);
  if (opts && opts.plain) return rows;
  var chk = rewriteCheck(ports, groupId);
  if (chk.ok) {
    var extra = [];
    if (info.owed <= 0) extra.push(btn(t(ports, 'btn_credit'), 'CR|' + groupId));
    if (!info.customerId) extra.push(btn(t(ports, 'btn_customer'), 'CU|' + groupId));
    if (extra.length) rows.push(extra);
    if (chk.row.cash > 0) {
      rows = rows.concat(methodRows(ports, chk.row.shop, methodOf(chk.row), groupMethodData(groupId),
        { split: chk.row.type === CFG.TX.SALE ? 'SX|' + groupId : '', add: 'LA|pm|PM|' + groupId }));
    }
  }
  return rows;
}

/** mk(key) of the method buttons under a committed group: PM|<group>|<KEY>. */
function groupMethodData(groupId) {
  return function (key) { return 'PM|' + groupId + '|' + key; };
}

/**
 * The method buttons of a screen, as keyboard rows. One button per key of payMethods(ports, shop): 💵 for CASH,
 * 🏦 + the account's label for the others, callback data mk(key). current (a key, an array of keys, or null)
 * gets no button. Layout: one row while there are at most three buttons and no label is longer than ten
 * characters, otherwise rows of two. opts.split and opts.add (callback data) add "💵+🏦 split" and "➕ new bank":
 * they never share a row with method buttons, they form one extra last row, split first. A button whose callback
 * data would exceed Telegram's 64 bytes is skipped (one oversize button makes it reject the whole keyboard).
 * The caller appends its own cancel row on the screens that have one.
 */
function methodRows(ports, shop, current, mk, opts) {
  opts = opts || {};
  var skip = {}, buttons = [], wide = false, rows = [], last = [], i;
  var cur = current === null || current === undefined ? []
    : (Object.prototype.toString.call(current) === '[object Array]' ? current : [current]);
  for (i = 0; i < cur.length; i++) if (cur[i]) skip['k:' + String(cur[i]).toUpperCase()] = true;
  payMethods(ports, shop).forEach(function (k) {
    if (skip['k:' + k]) return;
    var data = mk(k);
    if (utf8ByteLength(data) > 64) return;
    if (k === CFG.METHOD.CASH) { buttons.push(btn(t(ports, 'btn_cash'), data)); return; }
    var label = methodLabel(ports, k);
    if (label.length > 10) wide = true;
    buttons.push(btn(t(ports, 'btn_bank', { method: label }), data));
  });
  if (buttons.length <= 3 && !wide) {
    if (buttons.length) rows.push(buttons);
  } else {
    for (i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  }
  if (opts.split && utf8ByteLength(opts.split) <= 64) last.push(btn(t(ports, 'btn_split'), opts.split));
  if (opts.add && utf8ByteLength(opts.add) <= 64) last.push(btn(t(ports, 'btn_add_bank'), opts.add));
  if (last.length) rows.push(last);
  return rows;
}

/** Undo (or the given first row) plus the 🏦 rows and "➕ new bank" while the group's one cash row can still be rewritten. */
function moneyKeyboard(ports, groupId, firstRow) {
  var rows = [firstRow || [btn(t(ports, 'btn_undo'), 'U|' + groupId)]];
  var chk = rewriteCheck(ports, groupId);
  if (chk.ok && chk.row.cash) {
    rows = rows.concat(methodRows(ports, chk.row.shop, methodOf(chk.row), groupMethodData(groupId), { add: 'LA|pm|PM|' + groupId }));
  }
  return rows;
}

/** The keyboard that belongs under a committed group, by the type of its live row. */
function replyKeyboard(ports, groupId) {
  var live = groupRows(ports, groupId).live, row = live[0];
  if (!row) return undoRow(ports, groupId);
  if (row.type === CFG.TX.SALE) return afterSaleKeyboard(ports, groupId);
  if (row.type === CFG.TX.PAYMENT) {
    return moneyKeyboard(ports, groupId, [btn(t(ports, 'btn_undo'), 'U|' + groupId), btn(t(ports, 'btn_receipt'), 'RC|' + (row.refGroupId || groupId))]);
  }
  if (row.type === CFG.TX.EXPENSE) {
    return moneyKeyboard(ports, groupId, [btn(t(ports, 'btn_undo'), 'U|' + groupId), btn(t(ports, 'btn_note'), 'EN|' + groupId)]);
  }
  return moneyKeyboard(ports, groupId);
}

function undoRow(ports, groupId) {
  return [[btn(t(ports, 'btn_undo'), 'U|' + groupId)]];
}

/** The owner-only void button, for conflict pings and anything else that needs to reverse a group at any age. */
function voidButton(ports, groupId) {
  return btn(t(ports, 'btn_void'), 'V|' + groupId);
}

/** The 📱 button when a customer has no phone yet. Never asked inside a money flow. */
function phoneRow(ports, customer) {
  return customer && !customer.phone ? [[btn(t(ports, 'btn_phone'), 'CF|' + customer.id)]] : [];
}

function methodLine(ports, method) {
  var m = String(method || '').toUpperCase();
  return m && m !== CFG.METHOD.CASH ? '\n' + t(ports, 'method_done', { method: methodLabel(ports, m) }) : '';
}

function rewriteRefusal(ports, reason) {
  if (reason === 'expired') return t(ports, 'rewrite_refused');
  if (reason === 'locked' || reason === 'complex' || reason === 'type') return t(ports, 'rewrite_locked');
  if (reason === 'already') return t(ports, 'undo_already');
  return t(ports, 'expired');
}

/**
 * Edit the tapped message, or send a new one when there is none (typed or spoken input, a flow resumed after ➕).
 * isCaption: the tapped message is a photo card (its caption is edited); the callers before round 5 pass nothing.
 */
function editOrSend(ports, chatId, msgId, text, kb, isCaption, view) {
  // view (round 6): the app's view hint of the message (spec 13.9); Telegram gets the call of before, without it.
  var x = viewOf(ports, view);
  if (msgId) return x ? ports.chat.editMessage(chatId, msgId, text, kb || [], !!isCaption, x) : ports.chat.editMessage(chatId, msgId, text, kb || [], !!isCaption);
  return x ? ports.chat.sendMessage(chatId, text, kb || [], x) : ports.chat.sendMessage(chatId, text, kb || []);
}

/** A reply with the line a resumed flow puts in front of it ("➕ ... added"), or the text alone. */
function withPrefix(prefix, text) {
  return prefix ? prefix + '\n' + text : text;
}

/**
 * hint = {line, row} or null: one more text line and one more last keyboard row on the ONE message a resumed flow
 * sends (after a new account: "add its number" with the 🔢 button). Never a message of its own: the resumed
 * card must stay the last bot message (the app shows only that one).
 */
function withHintLine(text, hint) {
  return hint && hint.line ? text + '\n' + hint.line : text;
}
function withHintRow(kb, hint) {
  return hint && hint.row ? (kb || []).concat([hint.row]) : (kb || []);
}

/**
 * The refusal of a tap on a committed card, the way a refused method tap answers: the card keeps its own text
 * (earlier 🏦 lines dropped), the reason is added once, and the buttons that still apply are redrawn.
 */
function refuseOnCard(chatId, msgId, isCaption, groupId, line, ports, message) {
  var base = stripMethodLines((message && (message.caption || message.text)) || '');
  var text = !base ? line : (base.split('\n').indexOf(line) >= 0 ? base : base + '\n' + line);
  return ports.chat.editMessage(chatId, msgId, text, replyKeyboard(ports, groupId), isCaption);
}

/* ------------------------------ callbacks ------------------------------ */

var ITEM_ACTIONS = { S: 1, Q: 1, QN: 1, D: 1, R: 1, RQ: 1, T: 1, X: 1, K: 1, P: 1, C: 1, PS: 1, SP: 1, SS: 1, SC: 1, NI: 1, NC: 1 };
// Actions that write money or stock. On a slow connection the same button can be tapped
// twice before the card is redrawn; the second tap within two minutes is ignored.
// S is exempt in form mode (sale_flow = form: it writes nothing there, it opens the review card or the app's form).
var MUTATING_ACTIONS = { S: 1, RQ: 1, T: 1, X: 1, PA: 1, DN: 1, CC: 1, CD: 1, DA: 1, PM: 1, CUP: 1, EM: 1, V: 1, DV: 1,
  OC: 1, ODA: 1, ODP: 1, ODM: 1, OXR: 1, OXM: 1, OS: 1, MK: 1, SXA: 1, SC: 1, NC: 1 };
// Custom tailoring callbacks (core_orders.js); without the module they answer "expired".
var ORDER_ACTIONS = { O: 1, OL: 1, ON: 1, OC: 1, OI: 1, OP: 1, OQ: 1, OA: 1, OF: 1, OE: 1, OD: 1, ODA: 1, OS: 1, OV: 1, OVP: 1, ORM: 1,
  ODL: 1, ODU: 1, ODP: 1, ODM: 1, OX: 1, OXR: 1, OXM: 1, OT: 1, OTL: 1, MS: 1, MM: 1, MQ: 1, MK: 1, MF: 1, MG: 1, ML: 1, MP: 1 };

function handleCallback(cq, staff, updateId, ports) {
  ports.chat.answerCallback(cq.id);
  var chatId = cq.message.chat.id, msgId = cq.message.message_id, isCaption = !!cq.message.photo;
  var uid = String(cq.from.id);
  var parts = String(cq.data || '').split('|'), action = parts[0], id = parts[1], arg = parts[2];
  if (MUTATING_ACTIONS[action] && !(action === 'S' && saleFlow(ports) === CFG.SALE_FLOW.FORM)) {
    var tapKey = 'tap:' + chatId + ':' + msgId + ':' + cq.data;
    if (ports.cache.get(tapKey)) return;
    ports.cache.put(tapKey, '1', 120);
  }
  var edit = function (text, kb) { ports.chat.editMessage(chatId, msgId, text, kb || [], isCaption); };
  var editV = function (text, kb, view) {
    var x = viewOf(ports, view);
    return x ? ports.chat.editMessage(chatId, msgId, text, kb || [], isCaption, x) : edit(text, kb);
  };
  var item = ITEM_ACTIONS[action] && id ? ports.store.getItem(id) : null;
  var base = { staff: staff, source: CFG.SOURCE.BUTTON, updateId: updateId };
  var sctx = saleCtx(chatId, uid, staff, updateId, ports, msgId, isCaption);   // the review card's view of this tap
  if (ITEM_ACTIONS[action] && !item && action !== 'K') return edit(t(ports, 'tag_not_found', { id: id }));
  if (ORDER_ACTIONS[action]) {
    // MS also opens the app's measurement form where the order module is off (spec 9.2); every other order action needs the module.
    if (!ordersEnabled(ports) && !(action === 'MS' && measureEnabled(ports))) return edit(t(ports, 'expired'));
    return orderCallback(action, parts, chatId, msgId, uid, staff, updateId, ports);
  }

  switch (action) {
    case 'S': {
      // Form mode: nothing is written here; the app opens its sale form, Telegram turns the card into the review card.
      if (saleFlow(ports) === CFG.SALE_FLOW.FORM) return startSaleFor(sctx, item, clampQty(arg), {});
      var qty = clampQty(arg);
      var r = commitSale(ports, merge(base, { item: item, qty: qty }));
      var fresh = ports.store.getItem(id);
      setLastItem(ports, uid, id);
      setLastGroup(ports, uid, r.groupId);
      return editV(soldText(ports, fresh, qty, r), afterSaleKeyboard(ports, r.groupId), saleSoldView(ports, r.groupId, ''));
    }
    case 'Q': {
      // The app's forms: the sale form with a count of 1 (its stepper is the count). Telegram (both modes): quick's grid,
      // whose digits are S|id|n (in form mode they open the review card with that count).
      if (formsInApp(ports)) return startSaleFor(sctx, item, 1, {});
      return askQty(chatId, uid, item, ports);
    }
    case 'QN': {
      if (formsInApp(ports)) return startSaleFor(sctx, item, 1, {});
      // Form mode: another sale starts, so a live Telegram basket ends here (its card reads basket_closed), as ✅ ends it.
      if (saleFlow(ports) === CFG.SALE_FLOW.FORM) basketClose(ports, chatId, uid, msgId);
      setState(ports, uid, { kind: 'await_number', purpose: 'sale_qty', itemId: id });
      return edit(t(ports, 'ask_qty_number'));
    }
    case 'D': {
      if (formsInApp(ports)) return startSaleFor(sctx, item, 1, { price: true });
      if (saleFlow(ports) === CFG.SALE_FLOW.FORM) basketClose(ports, chatId, uid, msgId);
      setState(ports, uid, { kind: 'await_number', purpose: 'sale_price', itemId: id });
      return ports.chat.sendMessage(chatId, t(ports, 'ask_sale_price'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
    }
    case 'SS': return basketCallback(sctx, parts, item, cq.message);
    case 'SC': return basketSave(sctx, item, cq.message);
    case 'NI': return newItemCallback(chatId, msgId, uid, parts, staff, ports);
    case 'NC': return newItemSave(chatId, msgId, uid, id, staff, updateId, ports);
    case 'R': {
      if (formsInApp(ports)) {
        clearState(ports, uid);
        return ports.ui.openForm('restock', { chatId: chatId, uid: uid, staff: staff, itemId: id });
      }
      return restockQtyScreen(chatId, item, ports, '', false);
    }
    case 'RQ': {
      // Inside the ☰ 📦 loop (round 6b) at this item's count screen: a count saves and offers the next tag; ✏️ asks a count.
      var rqState = getState(ports, uid), lpq = restockLoopOf(rqState), inLoop = !!lpq && lpq.step === 'qty' && lpq.itemId === id;
      if (!rqState) {
        // The loop ran out (its RESTOCK_LOOP_TTL_SEC) while the seller counted at its latest count screen (the rl: mark):
        // a tap there is still the loop's, so the count keeps its tag line and the loop opens again for the next tag.
        var rqRaw = ports.cache.get('rl:' + uid), rqMark = rqRaw ? JSON.parse(rqRaw) : null;
        if (rqMark && rqMark.id === id && String(rqMark.m) === String(msgId)) {
          lpq = { n: Number(rqMark.n) || 0, step: 'qty', itemId: id, msgId: msgId };
          inLoop = true;
        }
      }
      if (arg === 'other') {
        if (inLoop) {
          setState(ports, uid, { kind: 'await_number', purpose: 'restock_qty', itemId: id, loop: lpq.n, msgId: msgId });
          return edit(t(ports, 'restock_type_qty'), [[btn(t(ports, 'btn_cancel'), 'RT|skip')]]);
        }
        setState(ports, uid, { kind: 'await_number', purpose: 'restock_qty', itemId: id });
        return edit(t(ports, 'ask_number'));
      }
      if (inLoop) return restockLoopSave(chatId, msgId, uid, lpq.n, merge(base, { item: item, qty: Number(arg) }), isCaption, staff, ports);
      var r2 = commitRestock(ports, merge(base, { item: item, qty: Number(arg) }));
      var fresh2 = ports.store.getItem(id);
      setLastItem(ports, uid, id);
      return editOrSend(ports, chatId, msgId, t(ports, 'restock_done', { qty: fmtCount(arg), stock: fmtCount(fresh2.stock) }), undoRow(ports, r2.groupId), isCaption,
        { kind: 'group', id: r2.groupId });
    }
    case 'T': {
      // A piece whose last sale still owes is not taken back here (round 6, spec 1.10): the refund would leave the credit open.
      var open = creditOpenFor(ports, id);
      if (open) {
        var openLine = t(ports, 'ret_credit_open', { customer: customerName(ports, open.customerId), owed: fmtMoney(open.owed) });
        return editOrSend(ports, chatId, msgId, cardText(ports, item) + '\n' + openLine, cardKeyboard(ports, item).concat(ownerBasketRow(ports, staff, item)),
          isCaption, { kind: 'item', id: id, extra: [openLine] });
      }
      var r3 = commitReturn(ports, merge(base, { item: item, qty: 1 }));
      var fresh3 = ports.store.getItem(id);
      setLastGroup(ports, uid, r3.groupId);
      return edit(cardText(ports, fresh3) + '\n' + t(ports, 'return_done', {
        qty: fmtCount(1), amount: fmtMoney(-r3.txs[0].amount), stock: fmtCount(fresh3.stock)
      }), replyKeyboard(ports, r3.groupId));
    }
    case 'X': {
      var to = otherShop(item.shop);
      var r4 = commitTransfer(ports, merge(base, { item: item, toShop: to }));
      return edit(t(ports, 'transfer_done', { id: id, shop: shopName(ports, to) }), undoRow(ports, r4.groupId));
    }
    case 'U': {
      // A new piece (round 6): once one of its pieces moved, its group cannot be undone; else the undo blanks the tag again.
      var ni = newItemUndoInfo(ports, id);
      if (ni && ni.used) return edit(t(ports, 'undo_new_used', { id: ni.itemId }));
      var u = undoGroup(ports, id, staff);
      if (!u.ok) {
        var why = u.reason === 'expired' ? t(ports, 'undo_expired', { min: myDigits(CFG.UNDO_WINDOW_MIN) })
          : u.reason === 'already' ? t(ports, 'undo_already') : u.reason === 'locked' ? t(ports, 'rewrite_locked') : t(ports, 'expired');
        return edit(why);
      }
      clearLastGroup(ports, uid, id);
      if (ni) {
        unregisterItem(ports, ni.itemId);
        return edit(t(ports, 'undo_done') + '\n' + t(ports, 'item_unregistered', { id: ni.itemId }));
      }
      var uHead = t(ports, 'undo_done') + orderUndoLine(ports, id, staff);
      return editV(uHead + groupUndoTail(ports, id, u), [], undoReplyView(ports, id, u, uHead.split('\n')));
    }
    case 'V': {
      // Owner-only: reverse a group at any age (Source UNDO, note 'void by owner'). Attached to conflict pings.
      if (staff.role !== 'owner') return ports.chat.sendMessage(chatId, t(ports, 'void_owner_only'));
      var v = voidGroup(ports, id, staff);
      // A later payment taken against the group locks it (undoGroup's 'locked'): the owner voids that payment first.
      if (!v.ok) return edit(v.reason === 'already' ? t(ports, 'undo_already') : v.reason === 'locked' ? t(ports, 'rewrite_locked') : t(ports, 'expired'));
      clearLastGroup(ports, uid, id);
      var vHead = t(ports, 'void_done') + orderUndoLine(ports, id, staff);
      return editV(vHead + groupUndoTail(ports, id, v), [], undoReplyView(ports, id, v, vHead.split('\n')));
    }
    case 'Y': return confirmProposal(chatId, msgId, isCaption, id, staff, uid, updateId, ports);
    case 'N': {
      var pj = ports.cache.get('cf:' + id);
      ports.cache.remove('cf:' + id);
      edit(t(ports, 'rejected'));
      if (pj) {
        var p = JSON.parse(pj);
        var it = p.itemId ? ports.store.getItem(p.itemId) : null;
        if (it) sendItemCard(chatId, it, staff, ports);
      }
      return;
    }
    case 'P': return newItemPrice(chatId, msgId, uid, id, arg, staff, ports);
    case 'C': return newItemCost(chatId, msgId, uid, id, arg, staff, ports);
    case 'PS': return toggleSample(chatId, msgId, uid, id, staff, ports);
    case 'SP': return setPrice(chatId, msgId, uid, id, arg, staff, ports);
    case 'K': {
      // 🛒 ရောင်းမယ် on the loop's count screen (and any K| while the loop is open) ends the loop, its count screen included.
      if (restockLoopOf(getState(ports, uid))) restockLoopEnd(ports, uid);
      return openTag(chatId, id, staff, uid, ports, { card: true });
    }
    case 'RT': {
      // The ☰ 📦 loop (round 6b): skip -> the tapped message becomes the ask again (nothing saved); done -> the loop ends.
      var lpt = restockLoopOf(getState(ports, uid));
      // Only the loop's live prompt acts (its msgId in the state): ✖️ or ✅ on an older count screen or ask only loses its
      // buttons (its text kept), so it never resets or ends the loop the seller is in now.
      if (lpt && lpt.msgId && String(lpt.msgId) !== String(msgId)) return edit(cq.message.text || cq.message.caption || t(ports, 'expired'));
      if (id === 'skip') return lpt ? restockAsk(chatId, msgId, uid, staff, ports, lpt.n, '') : edit(t(ports, 'expired'));
      if (lpt) clearState(ports, uid);
      return edit(t(ports, 'restock_loop_done'));
    }
    case 'M': {
      dropAddState(ports, uid);
      return menuAction(chatId, uid, id, staff, ports);
    }
    case 'Z': {
      clearState(ports, uid);
      return edit(t(ports, 'cancelled'));
    }
    case 'CR': return startCredit(chatId, uid, id, staff, ports);
    case 'CP': return creditPaid(chatId, msgId, uid, id, arg, staff, ports);
    case 'CC': return creditCustomer(chatId, msgId, uid, id, arg, staff, updateId, ports);
    case 'CD': return creditDeposit(chatId, msgId, isCaption, id, arg, staff, updateId, ports, parts[3] === 'p', parts[4]);
    case 'PY': return payPick(chatId, msgId, uid, id, staff, ports);
    case 'PL': return showPayList(chatId, staff, ports, '', id);
    case 'PA': return payAmount(chatId, msgId, uid, id, arg, staff, updateId, ports);
    case 'DC': return depCustomer(chatId, msgId, uid, id, staff, ports);
    case 'DA': return depAmount(chatId, msgId, uid, id, arg, staff, ports);
    case 'DN': return finishDeposit(chatId, msgId, uid, id, Number(arg), '', staff, updateId, ports, CFG.SOURCE.BUTTON, '', null);
    case 'PM': return changeMethod(chatId, msgId, isCaption, id, arg, staff, uid, updateId, ports, cq.message);
    case 'SX': return startSplit(chatId, msgId, isCaption, uid, id, staff, ports, cq.message);
    case 'SXM': return sendSplitAmount(chatId, msgId, uid, id, arg, ports, '');
    case 'SXA': {
      var splitState = { kind: 'await_number', purpose: 'split_bank', groupId: id, method: String(arg || '').toUpperCase() };
      return finishSplit(chatId, msgId, uid, splitState, parts[3] === 'all' || parts[3] === 'half' ? parts[3] : '', staff, updateId, ports, CFG.SOURCE.BUTTON);
    }
    case 'LA': return askAddOption(chatId, msgId, isCaption, uid, parts, staff, ports, cq.message);
    case 'LD': return askListDetail(chatId, uid, id, arg, staff, ports);
    case 'CU': return startAttachCustomer(chatId, uid, id, staff, ports);
    case 'CUP': return attachCustomerPick(chatId, msgId, uid, id, arg, staff, updateId, ports);
    case 'CF': return askPhone(chatId, uid, id, ports);
    case 'CH': return customerCard(chatId, id, staff, ports);
    case 'CS': return sendCustomerStatement(chatId, id, staff, ports);
    case 'ES': return expenseShop(chatId, msgId, uid, id, staff, ports);
    case 'EC': return expenseCategory(chatId, msgId, uid, id, staff, ports);
    case 'EA': return expenseAmountTap(chatId, msgId, uid, id, staff, ports);
    case 'EM': return expenseMethod(chatId, msgId, uid, id, staff, updateId, ports);
    case 'EN': return askExpenseNote(chatId, uid, id, ports);
    case 'RP': return sendReport(chatId, id, staff, ports);
    case 'RC': return sendReceipt(chatId, id, staff, ports);
    case 'RCP': return sendReceiptPdf(chatId, id, staff, ports);
    case 'NB': return notebookPick(chatId, msgId, uid, id, arg, staff, updateId, ports);
    case 'DV': {
      // Owner-only: drain, revoke or re-activate an enrolled phone; the list is redrawn in place.
      if (!ports.sync) return edit(t(ports, 'app_not_ready'));
      if (staff.role !== 'owner') return ports.chat.sendMessage(chatId, t(ports, 'devices_owner_only'));
      var dv = ports.sync.deviceAction(id, arg);
      return edit(dv.text, dv.kb || []);
    }
    default:
      return;
  }
}

/**
 * The lines under an undo or void reply: a basket or a restock of several lines (more than one SALE, or more than one
 * RESTOCK, and not a custom-order delivery) lists every item of the group that has an Items row with its stock now
 * (group_item_line); any other group shows the first item's card as before (none when it has no Items row).
 */
function groupUndoTail(ports, groupId, u) {
  var types = u.types || [], sales = 0, restocks = 0;
  types.forEach(function (k) { if (k === CFG.TX.SALE) sales++; if (k === CFG.TX.RESTOCK) restocks++; });
  if (!isOrderId(groupId) && (sales > 1 || restocks > 1)) {
    var seen = {}, lines = [];
    groupRows(ports, groupId).rows.forEach(function (r) {
      if (r.reversesTxId || !r.itemId || seen['i:' + r.itemId]) return;
      seen['i:' + r.itemId] = true;
      var it = ports.store.getItem(r.itemId);
      if (it) lines.push(t(ports, 'group_item_line', { id: it.id, name: it.name, stock: fmtCount(it.stock) }));
    });
    return lines.length ? '\n' + lines.join('\n') : '';
  }
  var after = u.itemId ? ports.store.getItem(u.itemId) : null;
  return after ? '\n' + cardText(ports, after) : '';
}

/**
 * The app's view of an undo or void reply (spec 13.9; F7: no joined lines): a basket or a restock of several lines (the
 * list of groupUndoTail) and an expense, a payment or a deposit → the group view, drawn under ui_hist_undone (for a
 * basket the app's group view lists the group's own SALE rows: item, qty, stock now); any other group with an Items row
 * → that item's view with the reply's own lines (head: undo_done, an order's line) in extra; else null (the text).
 * Telegram never reads it.
 */
function undoReplyView(ports, groupId, u, head) {
  var types = u.types || [], sales = 0, restocks = 0, T = CFG.TX;
  types.forEach(function (k) { if (k === T.SALE) sales++; if (k === T.RESTOCK) restocks++; });
  if (!isOrderId(groupId) && (sales > 1 || restocks > 1)) return { kind: 'group', id: groupId };
  var after = u.itemId ? ports.store.getItem(u.itemId) : null;
  if (after) return { kind: 'item', id: after.id, extra: head };
  if (!isOrderId(groupId) && (types[0] === T.EXPENSE || types[0] === T.PAYMENT || types[0] === T.DEPOSIT)) return { kind: 'group', id: groupId };
  return null;
}

function menuAction(chatId, uid, which, staff, ports) {
  switch (which) {
    case 'restock':
      // The app's restock form, empty, its camera running (round 6, F12); Telegram and the app under quick ask for the tag
      // and run the restock loop (round 6b, G3).
      if (!formsInApp(ports)) return restockAsk(chatId, null, uid, staff, ports, 0, '');
      clearState(ports, uid);
      return ports.ui.openForm('restock', { chatId: chatId, uid: uid, staff: staff });
    case 'today': return answerToday(chatId, staff, ports);
    case 'help': return ports.chat.sendMessage(chatId, t(ports, 'help'));
    case 'find':
      setState(ports, uid, { kind: 'find' });
      return ports.chat.sendMessage(chatId, t(ports, 'find_prompt'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
    case 'recent': return showRecent(chatId, uid, staff, ports);
    case 'pay': return showPayList(chatId, staff, ports, '');
    case 'dep': return startDeposit(chatId, uid, staff, ports, null);
    case 'exp': return startExpense(chatId, uid, staff, ports);
    case 'cust': return showCustomers(chatId, uid, staff, ports);
    case 'cfind':
      setState(ports, uid, { kind: 'find_customer' });
      return ports.chat.sendMessage(chatId, t(ports, 'cust_find'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
    case 'rep': return showReportMenu(chatId, staff, ports);
    case 'acct': return sendAccounts(chatId, staff, ports, '');
    case 'nb': return startNotebook(chatId, uid, staff, ports);
    case 'app': return sendEnrollCode(chatId, staff, ports);
    case 'devices': return showDevices(chatId, staff, ports);
    case 'ord': return ordersEnabled(ports) ? orderMenu(chatId, staff, ports) : undefined;
    case 'meas': return measureEnabled(ports) ? startMeasure(chatId, uid, 'pick', staff, ports) : undefined;
    default: return;
  }
}

function showRecent(chatId, uid, staff, ports) {
  var items = recentItems(ports, staff.role === 'owner' ? null : staff.shop, 5);
  var last = getLastItem(ports, uid);
  if (last && !items.some(function (it) { return it.id === last.id; })) items.unshift(last);
  if (!items.length) return ports.chat.sendMessage(chatId, t(ports, 'recent_none'));
  return showChoices(chatId, items.slice(0, 6), t(ports, 'recent_title') + '\n', ports);
}

/* ------------------------------ ☰ 📦 the restock loop (round 6b, G3) ------------------------------ */

/**
 * The loop inside a state, or null (pure): {n (counts saved so far), step ('tag' | 'qty'), itemId, msgId (the loop's
 * live prompt: the ask, the count screen or its ✏️ prompt; null in a state written before it was kept)}. Two shapes: the
 * restock_loop state itself, and the ✏️ count prompt of its count screen (await_number / restock_qty with loop = n).
 */
function restockLoopOf(state) {
  if (!state) return null;
  if (state.kind === 'restock_loop') return { n: state.n || 0, step: state.step, itemId: state.itemId || '', msgId: state.msgId || null };
  if (state.kind === 'await_number' && state.purpose === 'restock_qty' && !nullish(state.loop)) {
    return { n: state.loop, step: 'qty', itemId: state.itemId, msgId: state.msgId || null };
  }
  return null;
}

/**
 * The loop ends where the seller moved on (a menu tap, 🛒, a one-of-a-kind scan): the state and the rl: mark of its
 * latest count screen both go, so a later tap on that screen is an item card's restock again.
 */
function restockLoopEnd(ports, uid) {
  clearState(ports, uid);
  ports.cache.remove('rl:' + uid);
}

/**
 * A typed count at the loop's count screen or its ✏️ prompt (pure): the text is a number on its own (digits or Burmese
 * digits, with thousands commas or a decimal point, or number words such as ငါး), with ထည် after it or not; else null.
 * A text with anything else in it (a tag such as S1-5, a sentence, a phone number) is never the count.
 */
function restockCountOf(text) {
  var s = String(text === null || text === undefined ? '' : text).trim().replace(/\s*ထည်$/, '');
  if (!s) return null;
  if (/^[0-9၀-၉][0-9၀-၉,]*(\.[0-9၀-၉]+)?$/.test(s)) {
    var v = Number(s.replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); }).replace(/,/g, ''));
    return isNaN(v) ? null : v;
  }
  var nums = parseBurmeseNumbers(s);
  return nums.length === 1 && nums[0].index === 0 && nums[0].end >= s.length ? nums[0].value : null;
}

/**
 * A typed tag inside the loop (pure): a shop id of CFG.SHOP_IDS and one to four digits ('S1-5', 's1 0005'; F10b: any
 * configured shop) -> that tag id; with digitsOk (the ask), bare digits too: the staff's shop (else the first shop) and
 * four digits, as the app's tag keypad composes it. Else ''. At the count screen bare digits are the count, never a tag.
 */
function restockTagOf(text, staff, digitsOk) {
  var s = String(text === null || text === undefined ? '' : text).trim();
  var num = function (x) { return Number(String(x).replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); })); };
  var pad = function (x) { return ('0000' + num(x)).slice(-4); };
  var shops = CFG.SHOP_IDS.slice().sort(function (a, b) { return String(b).length - String(a).length; });
  for (var i = 0; i < shops.length; i++) {
    var sid = String(shops[i]);
    if (s.slice(0, sid.length).toUpperCase() !== sid.toUpperCase()) continue;
    var rest = s.slice(sid.length).replace(/^[\s-]+/, '');
    if (/^[0-9၀-၉]{1,4}$/.test(rest)) return sid + '-' + pad(rest);
  }
  if (digitsOk && /^[0-9၀-၉]{1,4}$/.test(s)) return ((staff && staff.shop) || CFG.SHOP_IDS[0]) + '-' + pad(s);
  return '';
}

/**
 * Ask for the next tag: the loop armed at step tag with n counts saved. Before any save the way out is ✖️ (Z); after a
 * save it is ✅ ပြီးပြီ (RT|done), and the text names it exactly then. prefix (a refusal) goes on top. msgId -> that
 * message is edited into the ask, else a new message. The ask is the loop's live prompt (state.msgId).
 */
function restockAsk(chatId, msgId, uid, staff, ports, n, prefix) {
  n = n || 0;
  var text = withPrefix(prefix, t(ports, n > 0 ? 'restock_more' : 'restock_ask_tag'));
  var kb = n > 0 ? [[btn(t(ports, 'btn_restock_done'), 'RT|done')]] : [[btn(t(ports, 'btn_cancel'), 'Z')]];
  var r = msgId ? ports.chat.editMessage(chatId, msgId, text, kb, false) : ports.chat.sendMessage(chatId, text, kb);
  setState(ports, uid, { kind: 'restock_loop', step: 'tag', n: n, msgId: (r && r.messageId) || msgId || null });
  return r;
}

/**
 * The loop at an item's count screen (a new message, group_item_line on top): the state restock_loop / qty with that
 * screen as its live prompt, and the rl: mark (CFG.STATE_TTL_SEC) that lets a tap on this screen carry on as the loop's
 * after the loop's own window ran out (counting a big bundle takes time).
 */
function restockLoopQty(chatId, uid, item, n, ports) {
  var r = restockQtyScreen(chatId, item, ports, t(ports, 'group_item_line', { id: item.id, name: item.name, stock: fmtCount(item.stock) }), true);
  var mid = (r && r.messageId) || null;
  setState(ports, uid, { kind: 'restock_loop', step: 'qty', itemId: item.id, n: n, msgId: mid });
  if (mid) ports.cache.put('rl:' + uid, JSON.stringify({ m: mid, id: item.id, n: n }), CFG.STATE_TTL_SEC);
  return r;
}

/**
 * A count at the loop's count screen (state restock_loop / qty), typed (restockCountOf) or spoken (handleIntent): a whole
 * 1..CFG.MAX_SALE_QTY saves (restockLoopSave); another number answers bad_qty and the count screen comes again, the loop
 * re-armed (180 s from that prompt); the item gone -> the ask with tag_not_found on top.
 */
function restockLoopCount(chatId, uid, state, n, staff, updateId, ports, source, transcript) {
  var item = ports.store.getItem(state.itemId);
  if (!item) return restockAsk(chatId, null, uid, staff, ports, state.n || 0, t(ports, 'tag_not_found', { id: state.itemId }));
  if (n >= 1 && n <= CFG.MAX_SALE_QTY && n === Math.round(n)) {
    return restockLoopSave(chatId, null, uid, state.n || 0, { item: item, qty: n, staff: staff, source: source, transcript: transcript,
      updateId: updateId }, false, staff, ports);
  }
  ports.chat.sendMessage(chatId, t(ports, 'bad_qty', { max: myDigits(CFG.MAX_SALE_QTY) }));
  return restockLoopQty(chatId, uid, item, state.n || 0, ports);
}

/**
 * The restock count screen of an item (a new message): the presets, ✏️ and ✖️. head goes on top. Outside the loop (an
 * item card's 📦, loop false) it is the screen of before round 6b byte for byte; in the loop ✖️ skips this tag (RT|skip)
 * and a last row 🛒 ရောင်းမယ် opens the item card (K|).
 */
function restockQtyScreen(chatId, item, ports, head, loop) {
  var id = item.id;
  var presets = CFG.RESTOCK_PRESETS.map(function (n) { return btn('+' + myDigits(n), 'RQ|' + id + '|' + n); });
  var kb = [presets, [btn(t(ports, 'btn_other'), 'RQ|' + id + '|other'), btn(t(ports, 'btn_cancel'), loop ? 'RT|skip' : 'Z')]];
  if (loop) kb.push([btn(t(ports, 'btn_restock_sell'), 'K|' + id)]);
  return ports.chat.sendMessage(chatId, withPrefix(head, t(ports, 'ask_restock_qty')), kb);
}

/**
 * A tag scanned or typed while the loop waits (openTag; lp from restockLoopOf). Refused (missing, blank, another shop's
 * tag of a seller): the refusal on top of the ask, the loop kept, nothing written. A one-of-a-kind piece ends the loop
 * and its item card comes (a scan for a sale or a look). Else the loop waits at that item's count screen.
 */
function restockLoopTag(chatId, uid, lp, itemId, staff, ports) {
  var add = basketAddItem(ports, staff, [], itemId, 1, { restock: true });
  if (!add.ok && add.reason === 'unique') {
    restockLoopEnd(ports, uid);
    ports.chat.sendMessage(chatId, t(ports, 'basket_unique', add.vars) + (lp.n > 0 ? '\n' + t(ports, 'restock_loop_done') : ''));
    return openTag(chatId, itemId, staff, uid, ports);
  }
  if (!add.ok) return restockAsk(chatId, null, uid, staff, ports, lp.n, t(ports, BASKET_REASON_KEY[add.reason] || 'expired', add.vars));
  var item = ports.store.getItem(itemId);
  setLastItem(ports, uid, item.id);
  return restockLoopQty(chatId, uid, item, lp.n, ports);
}

/**
 * A count of the loop (a preset tap, a number typed or spoken at the count screen or after ✏️, a confirmed restock
 * proposal of that piece): ONE RESTOCK group with its own ↩️ (commitRestock; p = its params). A tap edits the tapped
 * message into 'id · restock_done', a typed count (msgId null) is a new message; then the next ask as a new message,
 * n + 1 counts saved.
 */
function restockLoopSave(chatId, msgId, uid, n, p, isCaption, staff, ports) {
  var r = commitRestock(ports, p);
  var fresh = ports.store.getItem(p.item.id);
  setLastItem(ports, uid, p.item.id);
  ports.cache.remove('rl:' + uid);   // this count screen is answered: a later tap on it is an R| screen's again
  editOrSend(ports, chatId, msgId, p.item.id + ' · ' + t(ports, 'restock_done', { qty: fmtCount(p.qty), stock: fmtCount(fresh.stock) }),
    undoRow(ports, r.groupId), isCaption, { kind: 'group', id: r.groupId });
  return restockAsk(chatId, null, uid, staff, ports, n + 1, '');
}

/* ------------------------------ voice / text ------------------------------ */

function buildAiContext(ports, staff, uid) {
  var state = getState(ports, uid);
  var awaiting = null;
  if (state) {
    if (state.kind === 'new_item') awaiting = state.step;
    else if (state.kind === 'await_number' || state.kind === 'await_text') awaiting = state.purpose;
    else if (state.kind === 'notebook') awaiting = 'notebook_photo';
    else if (state.kind === 'find' || state.kind === 'find_customer') awaiting = state.kind;
    else if (state.step) awaiting = state.kind + '_' + state.step;     // credit_name, dep_note, exp_amount, cu_name
  }
  // The accounts of this staff member's shop as [KEY, label] pairs, CASH first (the shape expenseCategories has):
  // the model answers with the KEY of the account whose label it heard (core_ai_prompt.js aiContextText).
  var methods = payMethods(ports, staff.shop).map(function (k) { return [k, methodLabel(ports, k)]; });
  return {
    shop: staff.shop, staff: staff.name, item: getLastItem(ports, uid),
    awaiting: awaiting, categories: itemCategoryAi(ports, staff.shop).names, state: state,
    payMethods: methods, expenseCategories: expenseCategories(ports)
  };
}

function handleVoice(msg, staff, updateId, ports) {
  var chatId = msg.chat.id, uid = String(msg.from.id);
  // The owner's AI switch is off (round 6, F9b): no AI call; the buttons instead.
  if (!aiOn(ports)) return fallbackToButtons(chatId, uid, staff, ports, 'ai_off', '');
  ports.chat.typing(chatId);
  var ctx = buildAiContext(ports, staff, uid), intent;
  try {
    var file = ports.chat.getFile((msg.voice || msg.audio).file_id);
    intent = ports.ai.parseVoice(file, ctx);
  } catch (err) {
    ports.store.logError('voice', err, updateId, '');
    return fallbackToButtons(chatId, uid, staff, ports, 'ai_down', '');
  }
  return handleIntent(intent, msg, staff, updateId, ports, CFG.SOURCE.VOICE, ctx);
}

function handleText(msg, staff, updateId, ports) {
  var chatId = msg.chat.id, uid = String(msg.from.id), text = String(msg.text || '').trim();
  // A typed tag id or a pasted tag link (PC, USB scanner, torn tag) opens the card. No state, no AI.
  var tagId = tagIdFromText(text);
  if (tagId) return openTag(chatId, tagId, staff, uid, ports);
  // A typed voucher id (V1-2532) opens the order card the same way.
  if (ordersEnabled(ports) && isOrderId(text.toUpperCase())) return openOrderCard(chatId, text.toUpperCase(), staff, uid, ports);

  var state = getState(ports, uid);
  // Free-text states come before the number path: a phone number parses as a number and would become a price,
  // "AYA 2" would become the number 2, an account number would become an amount.
  if (state && state.kind === 'await_text') {
    if (state.purpose === 'phone') return savePhone(chatId, uid, state.customerId, text, staff, ports);
    if (state.purpose === 'exp_note') return attachExpenseNote(chatId, uid, state.groupId, text, staff, updateId, ports, CFG.SOURCE.TEXT, '');
    if (state.purpose === 'add_option') return finishAddOption(chatId, uid, state, text, staff, updateId, ports, CFG.SOURCE.TEXT);
    if (state.purpose === 'list_detail') return saveListDetail(chatId, uid, state, text, staff, ports);
  }
  var n = parseNumberText(text);

  if (state) {
    // Telegram's ☰ 📦 loop (round 6b): a typed tag (a shop id and digits; at the ask also bare digits, the shop and four
    // digits) opens that tag, the loop taking it as the next one; at the count screen and its ✏️ prompt only a number on
    // its own is the count (restockCountOf), and any other text (a mistyped tag, a sentence, a phone number) goes on to
    // the model as today's text does, never as a count of the piece on screen.
    var lpx = restockLoopOf(state);
    if (lpx) {
      var lTag = restockTagOf(text, staff, lpx.step === 'tag');
      if (lTag) return openTag(chatId, lTag, staff, uid, ports);
      if (lpx.step === 'qty') {
        var lCount = restockCountOf(text);
        if (lCount !== null && state.kind === 'await_number') return applyAwaitedNumber(chatId, uid, state, lCount, staff, updateId, ports, CFG.SOURCE.TEXT, text);
        if (lCount !== null) return restockLoopCount(chatId, uid, state, lCount, staff, updateId, ports, CFG.SOURCE.TEXT, text);
        n = null;
      }
    }
    // The review card or a sub-screen that takes a typed answer (a buyer search, a name, a phone, a date, a count, an
    // amount, a piece's name): before the number path, because a phone number parses as a number.
    if (state.kind === 'sale' && saleText(saleCtx(chatId, uid, staff, updateId, ports), state, text)) return true;
    // The new-piece card (form mode): a name before the number path; a price, cost or count as a number.
    if (state.kind === 'new_item' && state.form && state.step !== 'photo' && newItemText(chatId, uid, state, text, n, staff, ports)) return true;
    if (state.kind === 'find') {
      clearState(ports, uid);
      return showFindResults(chatId, staff, text, ports);
    }
    if (state.kind === 'find_customer') {
      clearState(ports, uid);
      return showCustomerFind(chatId, staff, text, ports);
    }
    if (n !== null && state.kind === 'new_item' && (state.step === 'price' || state.step === 'cost')) {
      return state.step === 'price' ? newItemPrice(chatId, null, uid, state.itemId, n, staff, ports)
        : newItemCost(chatId, null, uid, state.itemId, n, staff, ports);
    }
    if (n !== null && state.kind === 'await_number') {
      return applyAwaitedNumber(chatId, uid, state, n, staff, updateId, ports, CFG.SOURCE.TEXT, text);
    }
    if (n !== null && state.kind === 'exp' && state.step === 'amount') return expenseAmount(chatId, null, uid, state, n, staff, ports);
    if (state.kind === 'credit' && state.step === 'name') return creditNamed(chatId, uid, state, text, staff, updateId, ports);
    if (state.kind === 'dep' && state.step === 'name') return depositNamed(chatId, uid, state, text, staff, ports);
    if (state.kind === 'dep' && state.step === 'note') {
      return finishDeposit(chatId, null, uid, state.customerId, state.amount, text, staff, updateId, ports, CFG.SOURCE.TEXT, text, null);
    }
    if (state.kind === 'cu' && state.step === 'name') return attachNamed(chatId, uid, state, text, staff, updateId, ports);
    // Who is measured: a typed name (orderStateText does the same where the order module is on; the app has the form only).
    if (text && state.kind === 'meas_pick' && measureEnabled(ports)) return measPickNamed(chatId, uid, state, text, staff, ports) || true;
    if (ordersEnabled(ports)) {
      var handled = orderStateText(chatId, uid, state, text, n, null, staff, updateId, ports);
      if (handled) return handled;
    }
  }

  // The owner's AI switch is off (round 6, F9b): free text reaches no AI; the buttons instead.
  if (!aiOn(ports)) return fallbackToButtons(chatId, uid, staff, ports, 'ai_off', '');
  ports.chat.typing(chatId);
  var ctx = buildAiContext(ports, staff, uid), intent;
  try {
    intent = ports.ai.parseText(text, ctx);
  } catch (err) {
    ports.store.logError('text', err, updateId, text);
    return fallbackToButtons(chatId, uid, staff, ports, 'ai_down', '');
  }
  return handleIntent(intent, msg, staff, updateId, ports, CFG.SOURCE.TEXT, ctx);
}

function applyAwaitedNumber(chatId, uid, state, n, staff, updateId, ports, source, transcript) {
  clearState(ports, uid);
  var sctx = saleCtx(chatId, uid, staff, updateId, ports);   // the review card: a typed answer has no tapped message
  switch (state.purpose) {
    case 'sale_price': {
      if (state.saved) return basketLineNumber(sctx, state, 'price', n);
      var item = ports.store.getItem(state.itemId);
      if (!item) return ports.chat.sendMessage(chatId, t(ports, 'tag_not_found', { id: state.itemId }));
      if (saleFlow(ports) === CFG.SALE_FLOW.FORM) {
        if (!(Math.round(n) >= 1)) {
          setState(ports, uid, state);
          return ports.chat.sendMessage(chatId, t(ports, 'ask_sale_price'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
        }
        return startSaleFor(sctx, item, 1, { unitPrice: Math.round(n), priceChanged: true });
      }
      var r = commitSale(ports, { item: item, qty: 1, unitPrice: n, note: 'spoken price', staff: staff, source: source, transcript: transcript, updateId: updateId });
      var fresh = ports.store.getItem(item.id);
      setLastItem(ports, uid, item.id);
      setLastGroup(ports, uid, r.groupId);
      return sendView(ports, chatId, soldText(ports, fresh, 1, r), afterSaleKeyboard(ports, r.groupId), saleSoldView(ports, r.groupId, ''));
    }
    case 'sale_qty': {
      if (state.saved) return basketLineNumber(sctx, state, 'qty', n);
      var itq = ports.store.getItem(state.itemId);
      if (!itq) return ports.chat.sendMessage(chatId, t(ports, 'tag_not_found', { id: state.itemId }));
      if (n < 1 || n > CFG.MAX_SALE_QTY || n !== Math.round(n)) {
        setState(ports, uid, state);
        return ports.chat.sendMessage(chatId, t(ports, 'bad_qty', { max: myDigits(CFG.MAX_SALE_QTY) }), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
      }
      if (saleFlow(ports) === CFG.SALE_FLOW.FORM) return startSaleFor(sctx, itq, n, {});
      var rq = commitSale(ports, { item: itq, qty: n, staff: staff, source: source, transcript: transcript, updateId: updateId });
      var fq = ports.store.getItem(itq.id);
      setLastItem(ports, uid, itq.id);
      setLastGroup(ports, uid, rq.groupId);
      return sendView(ports, chatId, soldText(ports, fq, n, rq), afterSaleKeyboard(ports, rq.groupId), saleSoldView(ports, rq.groupId, ''));
    }
    case 'restock_qty': {
      var item2 = ports.store.getItem(state.itemId);
      if (!nullish(state.loop)) {
        // ✏️ inside the ☰ 📦 loop (round 6b): a whole 1..999 saves and offers the next tag; another number is asked again.
        if (!item2) return restockAsk(chatId, null, uid, staff, ports, state.loop, t(ports, 'tag_not_found', { id: state.itemId }));
        if (n >= 1 && n <= CFG.MAX_SALE_QTY && n === Math.round(n)) {
          return restockLoopSave(chatId, null, uid, state.loop, { item: item2, qty: n, staff: staff, source: source, transcript: transcript,
            updateId: updateId }, false, staff, ports);
        }
        // The re-ask is the loop's live prompt now: its ✖️ (RT|skip) is the one that acts.
        var bq = ports.chat.sendMessage(chatId, t(ports, 'bad_qty', { max: myDigits(CFG.MAX_SALE_QTY) }), [[btn(t(ports, 'btn_cancel'), 'RT|skip')]]);
        state.msgId = (bq && bq.messageId) || state.msgId || null;
        setState(ports, uid, state);
        return bq;
      }
      if (!item2) return ports.chat.sendMessage(chatId, t(ports, 'tag_not_found', { id: state.itemId }));
      var r2 = commitRestock(ports, { item: item2, qty: n, staff: staff, source: source, transcript: transcript, updateId: updateId });
      var fresh2 = ports.store.getItem(item2.id);
      return sendView(ports, chatId, t(ports, 'restock_done', { qty: fmtCount(n), stock: fmtCount(fresh2.stock) }), undoRow(ports, r2.groupId), { kind: 'group', id: r2.groupId });
    }
    case 'credit_paid': return askCreditCustomer(chatId, null, uid, state.groupId, n, staff, ports);
    case 'pay_amount': return commitPaymentAndReply(chatId, null, state.groupId, n, staff, updateId, ports, source, transcript, null, uid);
    case 'dep_amount': return askDepositNote(chatId, null, uid, state.customerId, n, staff, ports);
    case 'exp_amount': return expenseAmount(chatId, null, uid, state, n, staff, ports);
    case 'set_price': return applyPrice(chatId, null, state.itemId, n, staff, ports);
    // The account part of a split sale, typed or spoken (the state was cleared above; a bad amount sets it again).
    case 'split_bank': return finishSplit(chatId, null, uid, state, n, staff, updateId, ports, source);
    // The review card's transfer part (step bank) or amount now (step paid), typed or spoken; the basket rides in saved.
    case 'sale_step': return state.saved ? saleNumber(sctx, state.saved, n, source, transcript) : undefined;
    case 'order_price': case 'order_qty': case 'order_advance': case 'deliver_paid':
      return ordersEnabled(ports) ? orderAwaitedNumber(chatId, uid, state, n, staff, updateId, ports) : undefined;
    default: return;
  }
}

/**
 * A typed or spoken count or price for the open line of the review card (the prompt of qn / pr; the state was cleared by
 * applyAwaitedNumber). Refused (a count outside 1..999, a price below 1): the prompt again with the line's ⏮, the state set
 * again. Accepted: the line takes it and the card comes back as a new message.
 */
function basketLineNumber(ctx, prompt, what, n) {
  var ports = ctx.ports, state = prompt.saved, item = ports.store.getItem(state.item);
  var l = state.draft.lines[basketLineIndex(state.draft, state.line)];
  if (!item || !l) return ports.chat.sendMessage(ctx.chatId, t(ports, 'expired'));
  var v = Math.round(Number(n));
  var bad = what === 'qty' ? !(Number(n) === v && v >= 1 && v <= CFG.MAX_SALE_QTY) : !(v >= 1);
  if (bad) {
    var m = ports.chat.sendMessage(ctx.chatId, what === 'qty' ? t(ports, 'bad_qty', { max: myDigits(CFG.MAX_SALE_QTY) }) : t(ports, 'ask_sale_price'),
      [saleBackRow(ports, item, 'line')]);
    state.msgId = m && m.messageId ? m.messageId : state.msgId;
    state.cap = false;
    setState(ports, ctx.uid, prompt);
    return;
  }
  if (what === 'qty') l.qty = v;
  else { l.unitPrice = v; l.priceChanged = true; }
  return saleGo(ctx, state, 'card', '');
}

function handleIntent(intent, msg, staff, updateId, ports, source, ctx) {
  var chatId = msg.chat.id, uid = String(msg.from.id);
  var heard = intent && intent.transcript ? t(ports, 'heard', { transcript: intent.transcript }) + '\n' : '';
  var I = CFG.INTENT, state = ctx.state;
  var transcript = intent && intent.transcript ? String(intent.transcript) : '';
  var spokenName = intent ? (intent.customer || intent.item_hint || transcript) : '';

  // ➕ is waiting for the name of a new option: the transcript is the name, whatever the model made of it. Unless the
  // note clearly is a sale, an expense, a payment, a deposit, a transfer or an order: then the add state gives way
  // (the state it was tapped in comes back) and the note is handled as if ➕ had not been tapped, so a spoken sale
  // is never turned into an account name.
  if (state && transcript && state.kind === 'await_text' && state.purpose === 'add_option') {
    if (!isMoneyIntent(intent)) return finishAddOption(chatId, uid, state, transcript, staff, updateId, ports, source);
    if (sameAddState(getState(ports, uid), state)) {
      if (state.saved) setState(ports, uid, state.saved); else clearState(ports, uid);
    }
    state = state.saved || null;
  }

  // States that wait for free text take the transcript as it is, whatever the model made of it.
  if (state && transcript) {
    // The review card's text steps: a spoken name, phone or date lands in the sub-screen it was spoken in.
    if (state.kind === 'sale' && !state.paused) {
      var sctxT = saleCtx(chatId, uid, staff, updateId, ports), sItemT = ports.store.getItem(state.item);
      if (sItemT && (state.step === 'buyer' || state.step === 'name')) return saleBuyerNamed(sctxT, state, sItemT, intent.customer || transcript) || true;
      if (sItemT && state.step === 'phone' && normPhone(transcript).length >= 7) return salePhoneTyped(sctxT, state, sItemT, normPhone(transcript)) || true;
      if (sItemT && state.step === 'due_text') return saleDueTyped(sctxT, state, sItemT, transcript) || true;
    }
    if (state.kind === 'await_text' && state.purpose === 'list_detail') {
      // An account number is typed, never spoken (a spoken number arrives as words): ask again, save nothing.
      var acct = listOption(ports, state.list, state.key);
      return ports.chat.sendMessage(chatId, heard + t(ports, 'acct_ask_detail', { label: acct ? acct.label : state.key }), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
    }
    if (state.kind === 'await_text' && state.purpose === 'phone') {
      var digits = normPhone(transcript);
      if (digits.length >= 7) return savePhone(chatId, uid, state.customerId, digits, staff, ports);
      var cph = ports.store.getCustomer(state.customerId);
      return ports.chat.sendMessage(chatId, heard + t(ports, 'ask_phone', { customer: cph ? cph.name : '' }), [[btn(t(ports, 'btn_skip'), 'Z')]]);
    }
    if (state.kind === 'await_text' && state.purpose === 'exp_note') {
      return attachExpenseNote(chatId, uid, state.groupId, intent.note || transcript, staff, updateId, ports, source, transcript);
    }
    if (state.kind === 'find_customer') {
      clearState(ports, uid);
      return showCustomerFind(chatId, staff, intent.customer || transcript, ports);
    }
    if (state.kind === 'credit' && state.step === 'name') return creditNamed(chatId, uid, state, spokenName, staff, updateId, ports);
    if (state.kind === 'dep' && state.step === 'name') return depositNamed(chatId, uid, state, spokenName, staff, ports);
    if (state.kind === 'cu' && state.step === 'name') return attachNamed(chatId, uid, state, spokenName, staff, updateId, ports);
    if (state.kind === 'dep' && state.step === 'note') {
      return finishDeposit(chatId, null, uid, state.customerId, state.amount, intent.note || transcript, staff, updateId, ports, source, transcript,
        methodKeyFor(ports, intent.method, staff.shop) || null);
    }
    // Who is measured: a spoken name (as orderStateText does where the order module is on).
    if (state.kind === 'meas_pick' && measureEnabled(ports)) return measPickNamed(chatId, uid, state, intent.customer || transcript, staff, ports) || true;
    // Orders and measurements: a spoken name, design, fabric, description, date or measurement value.
    if (ordersEnabled(ports)) {
      var heardOrder = orderStateText(chatId, uid, state, transcript, null, intent, staff, updateId, ports);
      if (heardOrder) return heardOrder;
    }
  }

  if (!intent || !intent.intent || intent.intent === I.UNKNOWN || Number(intent.confidence || 0) < CFG.MIN_CONFIDENCE) {
    return fallbackToButtons(chatId, uid, staff, ports, 'not_understood', heard);
  }
  var spokenMoney = firstNumber([intent.unit_price, intent.amount]);

  // Telegram's ☰ 📦 loop (round 6b), by voice as by typing: at its count screen (or the ✏️ prompt) a spoken count is that
  // tag's count, at its ask a spoken number is a tag number (the shop and four digits). Only a restock or a bare number
  // (RESTOCK, NEW_ITEM_INFO) reads so, and a restock naming another piece does not (it is proposed as before). Typed text
  // reaches the model here only when it was no count (handleText), so it is never made one.
  var lpv = source === CFG.SOURCE.VOICE ? restockLoopOf(state) : null;
  if (lpv && (intent.intent === I.RESTOCK || intent.intent === I.NEW_ITEM_INFO)) {
    if (lpv.step === 'qty') {
      var lvItem = ports.store.getItem(lpv.itemId), lvq = firstNumber([intent.qty, intent.amount]), lvOther = false;
      if (lvItem && intent.item_hint) {
        var lvRes = resolveItem(ports, staff, lvItem, intent.item_hint);
        lvOther = !lvRes.item || lvRes.item.id !== lvItem.id;
      }
      if (lvq !== null && !lvOther) {
        if (state.kind === 'await_number') return applyAwaitedNumber(chatId, uid, state, lvq, staff, updateId, ports, source, transcript);
        return restockLoopCount(chatId, uid, state, lvq, staff, updateId, ports, source, transcript);
      }
    } else if (lpv.step === 'tag' && intent.intent === I.NEW_ITEM_INFO && !intent.item_hint) {
      var lvt = firstNumber([intent.qty, intent.unit_price, intent.amount]);
      if (lvt !== null && lvt >= 1 && lvt <= 9999 && lvt === Math.round(lvt)) return openTag(chatId, restockTagOf(String(lvt), staff, true), staff, uid, ports);
    }
  }

  // Multi-step flows waiting for a number accept it from voice too.
  if (state && state.kind === 'new_item' && (state.step === 'price' || state.step === 'cost')) {
    var v = state.step === 'cost' ? firstNumber([intent.amount, intent.unit_price]) : spokenMoney;
    if (v !== null) {
      return state.step === 'price' ? newItemPrice(chatId, null, uid, state.itemId, v, staff, ports)
        : newItemCost(chatId, null, uid, state.itemId, v, staff, ports);
    }
  }
  // (The loop's ✏️ prompt took its count above; another kind of note there is not read as a count.)
  if (state && state.kind === 'await_number' && !restockLoopOf(state)) {
    var wantsQty = state.purpose === 'restock_qty' || state.purpose === 'sale_qty';
    var w = wantsQty ? firstNumber([intent.qty, intent.amount, intent.unit_price]) : spokenMoney;
    // The split asks for the account part; "ငွေသား ငါးထောင်" (the model says CASH) is the cash part.
    if (w !== null && state.purpose === 'split_bank' && intent.method && methodKeyFor(ports, intent.method, staff.shop) === CFG.METHOD.CASH) {
      w = splitBankFromCash(ports, state.groupId, w);
    }
    // The review card's transfer part (step bank): a spoken cash part is converted to the account part the same way.
    if (w !== null && state.purpose === 'sale_step' && state.saved && state.saved.step === 'bank' && intent.method &&
        methodKeyFor(ports, intent.method, staff.shop) === CFG.METHOD.CASH) {
      w = saleBankFromCash(ports, state.saved, w);
    }
    if (w !== null) return applyAwaitedNumber(chatId, uid, state, w, staff, updateId, ports, source, transcript);
  }
  // The review card's number steps: a spoken count goes to the open line, a spoken amount to the how-much-now screen.
  if (state && state.kind === 'sale' && !state.paused && (state.step === 'line' || state.step === 'paid')) {
    var sctxN = saleCtx(chatId, uid, staff, updateId, ports), sItemN = ports.store.getItem(state.item);
    var sn = state.step === 'line' ? firstNumber([intent.qty, intent.amount]) : spokenMoney;
    if (sItemN && sn !== null) {
      return (state.step === 'line' ? saleQtyTyped(sctxN, state, sItemN, sn) : saleNumber(sctxN, state, sn, source, transcript)) || true;
    }
  }
  if (state && state.kind === 'exp' && state.step === 'amount' && spokenMoney !== null) {
    return expenseAmount(chatId, null, uid, state, spokenMoney, staff, ports);
  }
  // A spoken price, quantity or advance while an order screen waits for one.
  if (state && state.kind === 'order' && ORDER_NUMBER_STEPS[state.step] && ordersEnabled(ports)) {
    var on = state.step === 'qty' ? firstNumber([intent.qty, intent.amount, intent.unit_price]) : spokenMoney;
    if (on !== null) return orderAwaitedNumber(chatId, uid, { purpose: ORDER_NUMBER_STEPS[state.step], orderId: state.orderId, saved: state }, on, staff, updateId, ports);
  }

  // A basket is live: a spoken or typed sale (restock, return, transfer) of one of its pieces would be a second entry
  // beside the card, and a method would rewrite the previous committed sale, not this one. Neither is proposed: the live
  // screen comes back as a new message, so the answer is a tap (voice in the card stays the routing lines above).
  var liveSale = saleStateOf(ports, uid);
  if (liveSale && saleIntentClashes(ports, staff, ctx.item, intent, liveSale)) {
    return saleResend(saleCtx(chatId, uid, staff, updateId, ports), liveSale, heard);
  }

  // The model answers with a KEY of pay_methods, or with the name it heard: both become the key of an account the
  // lists know (core_ledger.js methodKeyFor). A method nobody knows is dropped: the row is then cash, as before.
  var method = intent.method ? (methodKeyFor(ports, intent.method, staff.shop) || null) : null;
  var common = { source: source, transcript: transcript, updateId: updateId, note: intent.note || '', method: method };

  switch (intent.intent) {
    case I.SALE: case I.RESTOCK: case I.RETURN: case I.TRANSFER: {
      var res = resolveItem(ports, staff, ctx.item, intent.item_hint);
      if (res.choices) return showChoices(chatId, res.choices, heard, ports);
      if (!res.item) return ports.chat.sendMessage(chatId, heard + t(ports, 'scan_first'));
      var p = merge(common, { kind: intent.intent, itemId: res.item.id, qty: intent.qty || 1,
        unitPrice: nullish(intent.unit_price) ? null : intent.unit_price,
        amount: nullish(intent.amount) ? null : intent.amount,
        paid: intent.intent === I.SALE && !nullish(intent.paid) ? intent.paid : null,
        customer: intent.intent === I.SALE && intent.customer ? intent.customer : null });
      return propose(chatId, uid, p, heard, ports);
    }
    case I.EXPENSE: {
      var eAmount = firstNumber([intent.amount, intent.unit_price]);
      if (!eAmount) return ports.chat.sendMessage(chatId, heard + t(ports, 'need_amount'));
      // The spoken category maps to a key; unknown words keep the reason in the note so nothing is lost.
      var catKey = expenseCategoryKey(ports, intent.category || intent.note || '');
      var eNote = String(intent.note || '').trim();
      if (eNote && normName(eNote) === normName(categoryLabel(ports, catKey))) eNote = '';
      if (!eNote && catKey === 'other' && intent.category) eNote = String(intent.category);
      var pe = merge(common, { kind: I.EXPENSE, amount: eAmount, shop: staff.shop, category: catKey, note: eNote });
      return propose(chatId, uid, pe, heard, ports);
    }
    case I.PAYMENT: {
      var amount = firstNumber([intent.amount, intent.unit_price]);
      if (!amount) return ports.chat.sendMessage(chatId, heard + t(ports, 'need_amount'));
      var cands = openCredits(ports, staff.role === 'owner' ? null : staff.shop);
      if (intent.customer) cands = cands.filter(function (c) { return nameMatch(c.customer, intent.customer); });
      if (!cands.length) return showPayList(chatId, staff, ports, heard + t(ports, 'pay_no_credit', { customer: intent.customer || '?' }) + '\n');
      var pick = cands.length === 1 ? cands[0] : (cands.filter(function (c) { return c.owed === amount; })[0] || null);
      if (!pick) return ports.chat.sendMessage(chatId, heard + t(ports, 'pay_list'), creditButtons(cands.slice(0, 5)));
      return propose(chatId, uid, merge(common, { kind: I.PAYMENT, groupId: pick.groupId, amount: Math.min(amount, pick.owed), customerId: pick.customerId }), heard, ports);
    }
    case I.DEPOSIT: {
      var dAmount = firstNumber([intent.amount, intent.unit_price]);
      if (!dAmount) return ports.chat.sendMessage(chatId, heard + t(ports, 'need_amount'));
      if (!intent.customer) return startDeposit(chatId, uid, staff, ports, dAmount, heard);
      return propose(chatId, uid, merge(common, { kind: I.DEPOSIT, customer: intent.customer, amount: dAmount, note: intent.note || '' }), heard, ports);
    }
    case I.METHOD: {
      // "Wave နဲ့ ပေးသွားတယ်": how the last committed money row was paid.
      if (!method || !methodKnown(ports, method)) return fallbackToButtons(chatId, uid, staff, ports, 'not_understood', heard);
      var lg = getLastGroup(ports, uid);
      if (!lg) return ports.chat.sendMessage(chatId, heard + t(ports, 'method_nothing', { method: methodLabel(ports, method) }));
      var chk = rewriteCheck(ports, lg);
      if (!chk.ok) return ports.chat.sendMessage(chatId, heard + rewriteRefusal(ports, chk.reason));
      return propose(chatId, uid, merge(common, { kind: I.METHOD, groupId: lg }), heard, ports);
    }
    case I.QUERY: {
      if (intent.note === 'stock') {
        var rq = resolveItem(ports, staff, ctx.item, intent.item_hint);
        if (rq.item) return ports.chat.sendMessage(chatId, heard + t(ports, 'stock_query', { name: rq.item.name, stock: fmtCount(rq.item.stock) }));
        if (rq.choices) return showChoices(chatId, rq.choices, heard, ports);
        return ports.chat.sendMessage(chatId, heard + t(ports, 'scan_first'));
      }
      return answerToday(chatId, staff, ports, heard);
    }
    case I.ORDER: {
      // "ဒေါ်မြင့် ဝမ်းဆက် တစ်ထည် အော်ဒါ၊ စရံ တစ်သိန်း": confirm, then the new-order flow pre-filled (nothing is written before the tap).
      if (!ordersEnabled(ports)) return fallbackToButtons(chatId, uid, staff, ports, 'not_understood', heard);
      var draft = { designHint: intent.item_hint || '', qty: intent.qty || null, unitPrice: nullish(intent.unit_price) ? null : intent.unit_price,
                    advance: firstNumber([intent.amount]) };
      if (!intent.customer) return startNewOrder(chatId, uid, staff, ports, draft, heard);
      return propose(chatId, uid, merge(common, { kind: I.ORDER, customer: intent.customer, draft: draft }), heard, ports);
    }
    case I.NEW_ITEM_INFO: {
      if (!(state && state.kind === 'new_item')) return fallbackToButtons(chatId, uid, staff, ports, 'not_understood', heard);
      if (state.form && state.step !== 'photo') {
        // The new-piece card (form mode): a spoken name is the name; the card comes back.
        if (intent.item_hint) state.draft.name = String(intent.item_hint).trim().slice(0, 60);
        return newItemCardShow(chatId, null, uid, state, staff, ports, heard.replace(/\n+$/, ''));
      }
      if (intent.item_hint) { state.draft.name = intent.item_hint; setState(ports, uid, state); }
      return ports.chat.sendMessage(chatId, heard + t(ports, state.step === 'photo' ? 'new_tag' : 'ask_' + state.step, { id: state.itemId }));
    }
    default:
      return fallbackToButtons(chatId, uid, staff, ports, 'not_understood', heard);
  }
}

function nameMatch(a, b) {
  var x = normName(a), y = normName(b);
  return !!x && !!y && (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0);
}

function resolveItem(ports, staff, lastItem, hint) {
  var h = String(hint || '').trim();
  if (lastItem && (!h || String(lastItem.name).indexOf(h) >= 0 || h.indexOf(String(lastItem.category)) >= 0)) return { item: lastItem };
  if (h) {
    var ranked = rankItemsByName(ports, staff.shop, h);
    if (ranked.length === 1 || (ranked.length > 1 && ranked[0].score > ranked[1].score)) return { item: ranked[0].it };
    if (ranked.length > 1) return { choices: ranked.slice(0, 5).map(function (x) { return x.it; }) };
  }
  if (lastItem) return { item: lastItem };
  return {};
}

function showChoices(chatId, items, heard, ports) {
  var rows = items.map(function (it) { return [btn(itemEmoji(ports, it) + ' ' + it.id + ' · ' + it.name, 'K|' + it.id)]; });
  return ports.chat.sendMessage(chatId, heard + t(ports, 'which_item'), rows);
}

function showFindResults(chatId, staff, text, ports) {
  var found = findItemsByName(ports, staff.shop, text);
  if (!found.length && staff.role === 'owner') found = findItemsByName(ports, null, text);
  if (!found.length) return ports.chat.sendMessage(chatId, t(ports, 'find_none'));
  return showChoices(chatId, found.slice(0, 5), '', ports);
}

function fallbackToButtons(chatId, uid, staff, ports, key, prefix) {
  ports.chat.sendMessage(chatId, (prefix || '') + t(ports, key));
  var last = getLastItem(ports, uid);
  if (last) sendItemCard(chatId, last, staff, ports);
}

function answerToday(chatId, staff, ports, prefix) {
  var day = dayKey(ports.clock.now());
  var shops = staff.role === 'owner' ? CFG.SHOP_IDS : [staff.shop];
  var lines = shops.map(function (shop) {
    var s = dayStats(ports, shop, day);
    return t(ports, 'today_query', { shop: shopName(ports, shop), revenue: fmtMoney(s.revenue), pieces: fmtCount(s.pieces),
      cash: fmtMoney(s.cashIn), expenses: fmtMoney(s.expenses), profit: fmtMoney(s.profit),
      drawer: fmtMoney(s.drawerNet), bank: fmtMoney(s.bankNet) });
  });
  var todayText = (prefix || '') + lines.join('\n\n'), tx = viewOf(ports, { kind: 'today' });
  return tx ? ports.chat.sendMessage(chatId, todayText, [], tx) : ports.chat.sendMessage(chatId, todayText);
}

/* ------------------------------ proposals ------------------------------ */

function propose(chatId, uid, p, heard, ports) {
  var token = ports.uuid().replace(/-/g, '').slice(0, 10);
  ports.cache.put('cf:' + token, JSON.stringify(p), CFG.CONFIRM_TTL_SEC);
  return ports.chat.sendMessage(chatId, heard + describeProposal(ports, p) + '\n' + t(ports, 'confirm_ask'),
    [[btn(t(ports, 'btn_yes'), 'Y|' + token), btn(t(ports, 'btn_no'), 'N|' + token)]]);
}

function describeProposal(ports, p) {
  var I = CFG.INTENT, item = p.itemId ? ports.store.getItem(p.itemId) : null;
  var qty = Math.max(1, Number(p.qty) || 1);
  var mark = p.method && String(p.method).toUpperCase() !== CFG.METHOD.CASH ? t(ports, 'method_mark', { method: methodLabel(ports, p.method) }) : '';
  if (p.kind === I.SALE || p.kind === I.RETURN) {
    var unit = !nullish(p.unitPrice) ? p.unitPrice : (!nullish(p.amount) ? Math.round(p.amount / qty) : (Number(item.price) || 0));
    var text = t(ports, p.kind === I.SALE ? 'confirm_sale' : 'confirm_return', { qty: fmtCount(qty), name: item.name, amount: fmtMoney(qty * unit) });
    if (p.kind === I.SALE && (p.customer || !nullish(p.paid))) {
      text += t(ports, 'confirm_sale_credit', { paid: fmtMoney(nullish(p.paid) ? qty * unit : p.paid), customer: p.customer || '?' });
    }
    return text + mark;
  }
  if (p.kind === I.RESTOCK) return t(ports, 'confirm_restock', { qty: fmtCount(qty), name: item.name });
  if (p.kind === I.TRANSFER) return t(ports, 'confirm_transfer', { name: item.name, shop: shopName(ports, otherShop(item.shop)) });
  if (p.kind === I.EXPENSE) {
    return t(ports, 'confirm_expense', { amount: fmtMoney(p.amount), cat: categoryLabel(ports, p.category), note: p.note ? ' · ' + p.note : '',
      method: methodLabel(ports, p.method || CFG.METHOD.CASH), shop: shopName(ports, p.shop) });
  }
  if (p.kind === I.PAYMENT) {
    var info = saleGroupInfo(ports, p.groupId);
    return t(ports, 'confirm_payment', { customer: customerName(ports, p.customerId), amount: fmtMoney(p.amount), owed: fmtMoney(info ? info.owed - p.amount : 0) }) + mark;
  }
  if (p.kind === I.DEPOSIT) return t(ports, 'confirm_deposit', { customer: p.customer, amount: fmtMoney(p.amount), note: p.note ? ' · ' + p.note : '' }) + mark;
  if (p.kind === I.ORDER) {
    var dr = p.draft || {};
    return t(ports, 'confirm_order', { customer: p.customer, design: dr.designHint ? ' · 🎨 ' + dr.designHint : '',
      qty: dr.qty ? ' × ' + fmtCount(dr.qty) : '', advance: dr.advance ? ' · 📥 ' + fmtMoney(dr.advance) : '' });
  }
  if (p.kind === I.METHOD) {
    var live = groupRows(ports, p.groupId).live[0];
    return t(ports, 'method_voice', { method: methodLabel(ports, p.method), desc: describeRow(ports, live) });
  }
  return '';
}

function confirmProposal(chatId, msgId, isCaption, token, staff, uid, updateId, ports) {
  var edit = function (text, kb) { ports.chat.editMessage(chatId, msgId, text, kb || [], isCaption); };
  var pj = ports.cache.get('cf:' + token);
  if (!pj) return edit(t(ports, 'expired'));
  ports.cache.remove('cf:' + token);
  var p = JSON.parse(pj), I = CFG.INTENT;
  var base = { staff: staff, source: p.source, transcript: p.transcript, updateId: updateId, note: p.note, method: p.method || null };
  var item = p.itemId ? ports.store.getItem(p.itemId) : null;
  if ((p.kind === I.SALE || p.kind === I.RESTOCK || p.kind === I.RETURN || p.kind === I.TRANSFER) && !item) return edit(t(ports, 'tag_not_found', { id: p.itemId }));
  var r, fresh, text, kb, view = null;
  if (p.kind === I.SALE) {
    var customer = p.customer ? resolveOrCreateCustomer(ports, p.customer) : null;
    r = commitSale(ports, merge(base, { item: item, qty: p.qty, unitPrice: p.unitPrice, amount: p.amount, paid: p.paid, customerId: customer ? customer.id : '' }));
    fresh = ports.store.getItem(item.id);
    var info = saleGroupInfo(ports, r.groupId);
    text = t(ports, 'sold_done', { qty: fmtCount(p.qty || 1), amount: fmtMoney(r.txs[0].amount), stock: fmtCount(fresh.stock) });
    if (customer) text += '\n' + t(ports, 'credit_done', { customer: customer.name, paid: fmtMoney(info.cash), owed: fmtMoney(info.owed) });
    text += methodLine(ports, p.method);
    kb = afterSaleKeyboard(ports, r.groupId).concat(phoneRow(ports, customer));
    view = saleSoldView(ports, r.groupId, '');
    setLastGroup(ports, uid, r.groupId);
    // A basket holding this piece was live beside the proposal (spoken before the card started): it is closed, so its
    // card answers expired and the piece is never booked twice.
    var liveSale = saleStateOf(ports, uid);
    if (liveSale && basketHasItem(liveSale, item.id)) clearState(ports, uid);
  } else if (p.kind === I.RESTOCK) {
    // Said or typed at the ☰ 📦 loop's count screen of this very piece (round 6b): it is that tag's count, so the reply
    // carries the tag line and the loop goes on to the next tag (a bare number typed next is a tag, never a second count).
    var lpc = restockLoopOf(getState(ports, uid));
    if (lpc && lpc.step === 'qty' && lpc.itemId === item.id) {
      return restockLoopSave(chatId, msgId, uid, lpc.n, merge(base, { item: item, qty: p.qty || 1 }), isCaption, staff, ports);
    }
    r = commitRestock(ports, merge(base, { item: item, qty: p.qty }));
    fresh = ports.store.getItem(item.id);
    text = t(ports, 'restock_done', { qty: fmtCount(p.qty || 1), stock: fmtCount(fresh.stock) });
    kb = undoRow(ports, r.groupId);
    view = { kind: 'group', id: r.groupId };
  } else if (p.kind === I.RETURN) {
    r = commitReturn(ports, merge(base, { item: item, qty: p.qty, unitPrice: p.unitPrice, amount: p.amount }));
    fresh = ports.store.getItem(item.id);
    text = t(ports, 'return_done', { qty: fmtCount(p.qty || 1), amount: fmtMoney(-r.txs[0].amount), stock: fmtCount(fresh.stock) }) + methodLine(ports, p.method);
    kb = replyKeyboard(ports, r.groupId);
    setLastGroup(ports, uid, r.groupId);
  } else if (p.kind === I.TRANSFER) {
    r = commitTransfer(ports, merge(base, { item: item }));
    text = t(ports, 'transfer_done', { id: item.id, shop: shopName(ports, otherShop(item.shop)) });
    kb = undoRow(ports, r.groupId);
  } else if (p.kind === I.EXPENSE) {
    r = commitExpense(ports, merge(base, { amount: p.amount, shop: p.shop || staff.shop, category: p.category }));
    text = t(ports, 'expense_done', { amount: fmtMoney(p.amount), cat: categoryLabel(ports, p.category), note: p.note ? ' · ' + p.note : '',
      method: methodLabel(ports, methodOf(r.txs[0])) });
    kb = replyKeyboard(ports, r.groupId);
    setLastGroup(ports, uid, r.groupId);
    view = { kind: 'group', id: r.groupId };
  } else if (p.kind === I.PAYMENT) {
    return commitPaymentAndReply(chatId, msgId, p.groupId, p.amount, staff, updateId, ports, p.source, p.transcript, p.method, uid);
  } else if (p.kind === I.DEPOSIT) {
    var c = resolveOrCreateCustomer(ports, p.customer);
    return finishDeposit(chatId, msgId, uid, c.id, p.amount, p.note || '', staff, updateId, ports, p.source, p.transcript, p.method);
  } else if (p.kind === I.ORDER) {
    if (!ordersEnabled(ports)) return edit(t(ports, 'not_understood'));
    edit(describeProposal(ports, p));
    var os = { kind: 'order', step: 'customer', draft: p.draft || {}, uid: uid };
    setState(ports, uid, os);
    return orderNamed(chatId, uid, os, p.customer, staff, ports);
  } else if (p.kind === I.METHOD) {
    var liveRow = groupRows(ports, p.groupId).live[0];
    if (liveRow && methodOf(liveRow) !== String(p.method).toUpperCase()) {
      var rm = rewriteGroup(ports, p.groupId, { method: p.method }, staff, updateId, { source: p.source, transcript: p.transcript, noteIfBlank: 'method' });
      if (!rm.ok) return edit(rewriteRefusal(ports, rm.reason));
      liveRow = rm.row;
    }
    if (!liveRow) return edit(t(ports, 'expired'));
    setLastGroup(ports, uid, p.groupId);
    return edit(describeRow(ports, liveRow) + '\n' + t(ports, 'method_done', { method: methodLabel(ports, p.method) }), replyKeyboard(ports, p.groupId));
  } else {
    return edit(t(ports, 'not_understood'));
  }
  if (item) setLastItem(ports, uid, item.id);
  if (view) return editOrSend(ports, chatId, msgId, text, kb, isCaption, view);
  return edit(text, kb);
}

/* ------------------------------ payment method ------------------------------ */

/** PM|group|KEY: rewrite the group's one cash row with the new method; the card keeps its text and buttons. */
function changeMethod(chatId, msgId, isCaption, groupId, key, staff, uid, updateId, ports, message) {
  var edit = function (text, kb) { ports.chat.editMessage(chatId, msgId, text, kb || [], isCaption); };
  var base = stripMethodLines((message && (message.caption || message.text)) || '');
  var join = function (line) { return base ? base + '\n' + line : line; };
  key = String(key || '').toUpperCase();
  // Any account the lists know, a retired one included: the button of an old card stays valid.
  if (!methodKnown(ports, key)) return edit(join(t(ports, 'expired')), replyKeyboard(ports, groupId));
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return edit(join(rewriteRefusal(ports, chk.reason)), replyKeyboard(ports, groupId));
  if (methodOf(chk.row) !== key) {
    var r = rewriteGroup(ports, groupId, { method: key }, staff, updateId, { noteIfBlank: 'method' });
    if (!r.ok) return edit(join(rewriteRefusal(ports, r.reason)), replyKeyboard(ports, groupId));
  }
  setLastGroup(ports, uid, groupId);
  var mText = join(t(ports, 'method_done', { method: methodLabel(ports, key) })), mKb = replyKeyboard(ports, groupId);
  var mx = viewOf(ports, methodReplyView(ports, groupId));
  return mx ? ports.chat.editMessage(chatId, msgId, mText, mKb, isCaption, mx) : edit(mText, mKb);
}

/**
 * The view a card keeps in the app after its method changed (13.9): a sale's sold view, an expense's, a payment's or a
 * deposit's group view; any other group none (its text, as before).
 */
function methodReplyView(ports, groupId) {
  var live = groupRows(ports, groupId).live[0], T = CFG.TX;
  if (!live) return null;
  if (live.type === T.SALE) return saleSoldView(ports, groupId, '');
  if (live.type === T.EXPENSE || live.type === T.PAYMENT || live.type === T.DEPOSIT) return { kind: 'group', id: groupId };
  return null;
}

/** Drop an earlier "🏦 ... မှတ်ပြီး" line so a second method tap does not stack them. */
function stripMethodLines(text) {
  return String(text || '').split('\n').filter(function (l) { return l.indexOf('🏦 ') !== 0; }).join('\n');
}

/**
 * The method of a committed group after ➕ added (or found) the account key: the PM tap without a tapped
 * message. One new message: prefix, the row, "paid with ...", the buttons of the group (plus the hint row).
 * A refusal is the same one message with the reason instead.
 */
function resumeMethod(chatId, uid, groupId, key, staff, updateId, ports, source, prefix, hint) {
  var refuse = function (reason) {
    return ports.chat.sendMessage(chatId, withHintLine(withPrefix(prefix, rewriteRefusal(ports, reason)), hint), withHintRow(replyKeyboard(ports, groupId), hint));
  };
  key = String(key || '').toUpperCase();
  if (!methodKnown(ports, key)) return refuse('method');
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return refuse(chk.reason);
  var row = chk.row;
  if (methodOf(row) !== key) {
    var r = rewriteGroup(ports, groupId, { method: key }, staff, updateId, { source: source, noteIfBlank: 'method' });
    if (!r.ok) return refuse(r.reason);
    row = r.row;
  }
  setLastGroup(ports, uid, groupId);
  var text = describeRow(ports, row) + '\n' + t(ports, 'method_done', { method: methodLabel(ports, key) });
  return ports.chat.sendMessage(chatId, withHintLine(withPrefix(prefix, text), hint), withHintRow(replyKeyboard(ports, groupId), hint));
}

/* ------------------------------ one sale, part cash and part into one account ------------------------------ */

/**
 * Can this group be split? {ok, row} for a rewritable group whose live row is a SALE with cash paid;
 * {ok: false, reason} otherwise (the rewriteCheck reasons, or 'type').
 */
function splitGuard(ports, groupId) {
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return { ok: false, reason: chk.reason };
  if (chk.row.type !== CFG.TX.SALE || !(chk.row.cash > 0)) return { ok: false, reason: 'type' };
  return { ok: true, row: chk.row };
}

/**
 * A split question (or its typed answer) that cannot go on: the row it was about, when one is still live, and
 * the reason, with the buttons the group still has. Edits the question, or sends when there is none.
 */
function splitRefuse(chatId, msgId, groupId, reason, ports, prefix) {
  var live = groupRows(ports, groupId).live;
  var row = live.filter(function (r) { return r.type === CFG.TX.SALE; })[0] || live[0] || null;
  var text = (row ? describeRow(ports, row) + '\n' : '') + rewriteRefusal(ports, reason);
  return editOrSend(ports, chatId, msgId, withPrefix(prefix, text), replyKeyboard(ports, groupId));
}

/**
 * SX|group on a sale card. The card is a committed entry and stays as it is (text, undo, receipt): the question
 * is a new message, so its cancel button only cancels the question. A sale already marked with an account is
 * split with that account; otherwise one account is used at once and several are offered as buttons.
 */
function startSplit(chatId, msgId, isCaption, uid, groupId, staff, ports, message) {
  var g = splitGuard(ports, groupId);
  if (!g.ok) return refuseOnCard(chatId, msgId, isCaption, groupId, rewriteRefusal(ports, g.reason), ports, message);
  var row = g.row, was = methodOf(row);
  if (was !== CFG.METHOD.CASH) return sendSplitAmount(chatId, null, uid, groupId, was, ports, '');
  var banks = payMethods(ports, row.shop).filter(function (k) { return k !== CFG.METHOD.CASH; });
  if (!banks.length) {
    return ports.chat.sendMessage(chatId, t(ports, 'split_no_bank'),
      [[btn(t(ports, 'btn_add_bank'), 'LA|pm|SXM|' + groupId), btn(t(ports, 'btn_cancel'), 'Z')]]);
  }
  if (banks.length === 1) return sendSplitAmount(chatId, null, uid, groupId, banks[0], ports, '');
  var rows = methodRows(ports, row.shop, CFG.METHOD.CASH, function (k) { return 'SXM|' + groupId + '|' + k; }, { add: 'LA|pm|SXM|' + groupId });
  rows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, t(ports, 'split_ask_bank', { cash: fmtMoney(row.cash) }), rows);
}

/**
 * SXM|group|KEY, and the amount screen wherever it is reached from: how much of the payment went into the account
 * KEY (the rest is cash). The state waits for a number (in the app the keypad opens by itself); "all" and "half"
 * are buttons. Edits the question it was tapped on; a new message when there is none (SX straight to it, ➕ resumed).
 */
function sendSplitAmount(chatId, msgId, uid, groupId, key, ports, prefix) {
  key = String(key || '').toUpperCase();
  var g = splitGuard(ports, groupId), reason = g.ok ? '' : g.reason;
  // Cash plus ONE account: a sale already marked with an account can only be split with that account.
  if (g.ok && (key === CFG.METHOD.CASH || !methodKnown(ports, key) ||
               (methodOf(g.row) !== CFG.METHOD.CASH && methodOf(g.row) !== key))) reason = 'method';
  if (reason) return splitRefuse(chatId, msgId, groupId, reason, ports, prefix);
  setState(ports, uid, { kind: 'await_number', purpose: 'split_bank', groupId: groupId, method: key });
  var cash = g.row.cash, half = Math.round(cash / 2);
  var text = t(ports, 'split_ask_amount', { method: methodLabel(ports, key), cash: fmtMoney(cash) });
  // A button whose callback data would exceed 64 bytes is skipped (a sale marked by voice with an account whose
  // hand-typed key is very long): the amount can still be typed.
  var amounts = [];
  [['all', 'btn_all', cash], ['half', 'btn_half', half]].forEach(function (a) {
    var data = 'SXA|' + groupId + '|' + key + '|' + a[0];
    if (utf8ByteLength(data) <= 64) amounts.push(btn(t(ports, a[1], { amount: fmtMoney(a[2]) }), data));
  });
  var kb = (amounts.length ? [amounts] : []).concat([[btn(t(ports, 'btn_cancel'), 'Z')]]);
  return editOrSend(ports, chatId, msgId, withPrefix(prefix, text), kb);
}

/**
 * The split is known: SXA|group|KEY|all or half (msgId = the tapped question), or a typed or spoken amount
 * (msgId null; applyAwaitedNumber cleared the state before calling). state = the split_bank state.
 * amount = 'all', 'half' or a number. A number outside 1..cash keeps the state and asks again.
 * The reply names the row from the ledger (never the text of the tapped message): the sale, the two parts,
 * how to correct it, and the buttons the group has now (undo and receipt; 💰 while something is owed).
 */
function finishSplit(chatId, msgId, uid, state, amount, staff, updateId, ports, source) {
  var groupId = state.groupId, key = String(state.method || '').toUpperCase();
  var g = splitGuard(ports, groupId);
  if (!g.ok) {
    clearSplitState(ports, uid, groupId);
    return splitRefuse(chatId, msgId, groupId, g.reason, ports, '');
  }
  var cash = g.row.cash, bank;
  if (amount === 'all') bank = cash;
  else if (amount === 'half') bank = Math.round(cash / 2);
  else if (typeof amount === 'number') {
    bank = amount;
    if (!(bank >= 1) || bank > cash || bank !== Math.round(bank)) {
      setState(ports, uid, state);
      return ports.chat.sendMessage(chatId, t(ports, 'split_bad', { max: fmtMoney(cash) }), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
    }
  } else {
    clearSplitState(ports, uid, groupId);
    return splitRefuse(chatId, msgId, groupId, 'amount', ports, '');
  }
  clearSplitState(ports, uid, groupId);
  var r = splitSale(ports, groupId, bank, key, staff, updateId, source);
  if (!r.ok) return splitRefuse(chatId, msgId, groupId, r.reason, ports, '');
  var sale = groupRows(ports, groupId).live.filter(function (x) { return x.type === CFG.TX.SALE; })[0] || null;
  var lines = [];
  if (sale) lines.push(describeRow(ports, sale));
  if (r.full) {
    lines.push(t(ports, 'method_done', { method: methodLabel(ports, key) }));
  } else {
    lines.push(t(ports, 'split_done', { cash: fmtMoney(r.cashPart), cashMethod: methodLabel(ports, r.cashMethod),
      bank: fmtMoney(r.bankPart), method: methodLabel(ports, key) }));
    // Undo counts from the sale's own time (the rewritten row keeps it): later only the owner can reverse it.
    var ageMin = sale ? (ports.clock.now().getTime() - new Date(sale.time).getTime()) / 60000 : 0;
    lines.push(t(ports, ageMin <= CFG.UNDO_WINDOW_MIN ? 'split_hint' : 'split_hint_late'));
  }
  setLastGroup(ports, uid, groupId);
  return editOrSend(ports, chatId, msgId, lines.join('\n'), replyKeyboard(ports, groupId));
}

/**
 * The split of this group is answered: its waiting state goes. Only that state: an SXA tapped on an older amount
 * screen while the seller is in another flow (an expense, an order) leaves that flow alone. On the typed and spoken
 * path applyAwaitedNumber has already cleared it.
 */
function clearSplitState(ports, uid, groupId) {
  var cur = getState(ports, uid);
  if (cur && cur.kind === 'await_number' && cur.purpose === 'split_bank' && cur.groupId === groupId) clearState(ports, uid);
}

/**
 * The split question asks for the ACCOUNT part. A spoken answer that names cash ("ငွေသား ငါးထောင်": the model
 * answers method CASH) gives the cash part instead: the account part is the rest. A cash part that leaves nothing
 * for the account (or is all of it) is no split: -1, which finishSplit answers with split_bad, the state kept.
 */
function splitBankFromCash(ports, groupId, cashPart) {
  var g = splitGuard(ports, groupId);
  if (!g.ok) return cashPart;   // finishSplit refuses it anyway
  var n = Math.round(Number(cashPart));
  if (!(n >= 1) || n >= g.row.cash || n !== Number(cashPart)) return -1;
  return g.row.cash - n;
}

/* ------------------------------ bank accounts: the list and an account's number ------------------------------ */

/** The accounts a staff member works with: the active pay_method options of their shop (owner: every shop), CASH left out. */
function accountRows(ports, staff) {
  return listOptions(ports, 'pay_method', staff.role === 'owner' ? null : staff.shop)
    .filter(function (r) { return r.key !== CFG.METHOD.CASH; });
}

/**
 * M|acct: every account with its number (— while none is stored). One 🔢 button per account, those without a
 * number first, then the others (to correct a wrong number), eight in all; then ➕ new bank and cancel.
 */
function accountsScreen(ports, staff) {
  var rows = accountRows(ports, staff), lines = [t(ports, 'acct_title')], kb = [];
  if (!rows.length) lines.push(t(ports, 'acct_none'));
  rows.forEach(function (r) { lines.push(t(ports, 'acct_line', { label: r.label, detail: r.detail || '—' })); });
  var ordered = rows.filter(function (r) { return !r.detail; }).concat(rows.filter(function (r) { return !!r.detail; }));
  ordered.forEach(function (r) {
    var data = 'LD|pm|' + r.key;
    if (kb.length >= 8 || utf8ByteLength(data) > 64) return;
    kb.push([btn(t(ports, 'btn_acct_detail', { label: r.label }), data)]);
  });
  kb.push([btn(t(ports, 'btn_add_bank'), 'LA|pm|AC'), btn(t(ports, 'btn_cancel'), 'Z')]);
  return { text: lines.join('\n'), kb: kb };
}

function sendAccounts(chatId, staff, ports, prefix) {
  var scr = accountsScreen(ports, staff);
  return ports.chat.sendMessage(chatId, withPrefix(prefix, scr.text), scr.kb);
}

/**
 * LD|pm|KEY (any staff member): ask for the account's number. A new message with a cancel button (the button may
 * sit under a committed card). The answer is typed: it is read before the number path in handleText.
 */
function askListDetail(chatId, uid, code, key, staff, ports) {
  var list = Object.prototype.hasOwnProperty.call(CFG.LIST_CODES, String(code)) ? CFG.LIST_CODES[code] : '';
  var row = list === 'pay_method' ? listOption(ports, list, key) : null;
  if (!row || row.key === CFG.METHOD.CASH) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  if (!ports.store.addListOption) return ports.chat.sendMessage(chatId, t(ports, 'add_unavailable'));
  setState(ports, uid, { kind: 'await_text', purpose: 'list_detail', list: list, key: row.key });
  return ports.chat.sendMessage(chatId, t(ports, 'acct_ask_detail', { label: row.label }), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
}

/** The typed number of an account: stored through setListDetail; the reply shows what is stored now, then the accounts. */
function saveListDetail(chatId, uid, state, text, staff, ports) {
  var row = listOption(ports, state.list, state.key);
  var r = setListDetail(ports, state.list, state.key, text);
  if (!r.ok) {
    if (r.reason === 'empty' && row) {
      return ports.chat.sendMessage(chatId, t(ports, 'acct_ask_detail', { label: row.label }), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
    }
    clearState(ports, uid);
    return ports.chat.sendMessage(chatId, t(ports, r.reason === 'unavailable' ? 'add_unavailable' : 'expired'));
  }
  clearState(ports, uid);
  ports.chat.sendMessage(chatId, t(ports, 'acct_detail_saved', { label: row ? row.label : state.key, detail: r.detail }));
  return sendAccounts(chatId, staff, ports, '');
}

/* ------------------------------ ➕ adding a missing option where it is needed ------------------------------ */

// What a ➕ button resumes once the name is known, and the list its option goes to. PM is tapped under the card
// of a committed entry (never edited); every other one sits on a question screen, which becomes the prompt.
var ADD_RESUME_LIST = { PM: 'pay_method', EM: 'pay_method', SXM: 'pay_method', ODM: 'pay_method', OXM: 'pay_method',
  AC: 'pay_method', EC: 'expense_category', OF: 'fabric', SSA: 'pay_method', NIC: 'item_category' };
// Intents that are money or stock, never the name of an option.
var ADD_YIELD_INTENTS = { SALE: 1, RETURN: 1, RESTOCK: 1, EXPENSE: 1, PAYMENT: 1, DEPOSIT: 1, TRANSFER: 1, ORDER: 1 };

/**
 * Does the note clearly make an entry, so the add state gives way? A money intent the model is sure about AND that
 * carries what the entry needs: a number for a sale, return, restock, expense, payment or deposit, a number or an
 * item for a transfer, a customer for an order. A category name such as "ရေဖိုး" or "မီးဖိုး" reads like an
 * expense but has no amount: it stays the name of the new option.
 */
function isMoneyIntent(intent) {
  if (!intent || ADD_YIELD_INTENTS[intent.intent] !== 1 || Number(intent.confidence || 0) < CFG.MIN_CONFIDENCE) return false;
  var hasNumber = firstNumber([intent.amount, intent.unit_price, intent.qty]) !== null;
  if (intent.intent === CFG.INTENT.ORDER) return !!intent.customer;
  if (intent.intent === CFG.INTENT.TRANSFER) return hasNumber || !!intent.item_hint;
  return hasNumber;
}

/** The short code of a list inside callback data and message keys (pay_method -> pm). */
function listCodeOf(list) {
  for (var c in CFG.LIST_CODES) if (Object.prototype.hasOwnProperty.call(CFG.LIST_CODES, c) && CFG.LIST_CODES[c] === list) return c;
  return '';
}

/** Is cur (the state now in the cache) the add state that state was read from? Same list and same resume. */
function sameAddState(cur, state) {
  return !!cur && !!state && cur.kind === 'await_text' && cur.purpose === 'add_option' && state.purpose === 'add_option' &&
    cur.list === state.list && !!cur.resume && !!state.resume && cur.resume.a === state.resume.a;
}

/**
 * LA|<list code>|<resume>|<args...>: ask for the name of a new option. Not a committing action. In this order,
 * before anything is edited: an unknown code says expired; a store that cannot add options says so in a new
 * message (the tapped screen keeps its buttons, the state is untouched); a ➕ under a card that can no longer be
 * rewritten is refused like a method tap and asks no name. Then the state the user was in is kept inside the add
 * state (a second tap never nests an add state in an add state) and the prompt is shown: a new message for a
 * committed card (PM), an edit of the question screen for every other resume.
 */
function askAddOption(chatId, msgId, isCaption, uid, parts, staff, ports, message) {
  var code = String(parts[1] || ''), a = String(parts[2] || ''), args = parts.slice(3);
  var list = Object.prototype.hasOwnProperty.call(CFG.LIST_CODES, code) ? CFG.LIST_CODES[code] : '';
  var known = Object.prototype.hasOwnProperty.call(ADD_RESUME_LIST, a);
  if (!list || (known && ADD_RESUME_LIST[a] !== list)) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  if (!ports.store.addListOption) return ports.chat.sendMessage(chatId, t(ports, 'add_unavailable'));
  if (a === 'PM' || a === 'SXM') {
    var g = a === 'SXM' ? splitGuard(ports, args[0]) : rewriteCheck(ports, args[0]);
    if (!g.ok) return refuseOnCard(chatId, msgId, isCaption, args[0], rewriteRefusal(ports, g.reason), ports, message);
  }
  if ((a === 'OF' || a === 'ODM' || a === 'OXM') && !ordersEnabled(ports)) {
    return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], isCaption);
  }
  // The question screen this ➕ sits on was already turned into a committed card (🏦 tapped, then ➕ before the redraw
  // reached the phone): the card is never edited into a question. Expired, as a new message; the card stays.
  if (known && a !== 'PM' && isCommittedCard(ports, chatId, msgId)) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var cur = getState(ports, uid);
  var saved = cur && cur.kind === 'await_text' && cur.purpose === 'add_option' ? (cur.saved || null) : (cur || null);
  var text = t(ports, 'add_ask_' + code), kb = [[btn(t(ports, 'btn_cancel'), 'Z')]];
  if (a === 'SSA') {
    // ➕ inside the guided sale (round 5): the prompt replaces the how-paid or account screen and carries that screen's
    // back row (never Z, which would cancel the sale); the sale state rides in saved. A stale screen reads expired.
    // The flow's stale-tap rules: no state, or an older screen -> expired (saleGuard answers); a ➕ that raced a redraw on
    // the live screen (the step moved on) -> ignored without an edit, as every other step tap (rule (c)).
    var sItem = ports.store.getItem(args[0]);
    if (!sItem) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], isCaption);
    var sCtx = saleCtx(chatId, uid, staff, null, ports, msgId, isCaption);
    var sLive = saleGuard(sCtx, sItem, null, message);
    if (!sLive || (sLive.step !== 'method' && sLive.step !== 'account')) return;
    var se = ports.chat.editMessage(chatId, msgId, text, [saleBackRow(ports, sItem, sLive.step)], isCaption);
    sLive.msgId = saleShownId(sCtx, se);
    setState(ports, uid, { kind: 'await_text', purpose: 'add_option', list: list, resume: { a: a, args: args }, saved: sLive });
    return se;
  }
  if (a === 'NIC') {
    // ➕ on the new-piece card's category screen (round 6b, G2): the prompt replaces that screen and carries the card's
    // back row (never Z, which would drop the card); the card's state rides in saved. No card -> expired; a ➕ that raced
    // a redraw (the card left its category screen) -> ignored without an edit (rule (c)).
    var ns = newItemFormState(ports, uid, args[0]);
    if (!ns) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], isCaption);
    if (ns.step !== 'cat') return;
    var ne = ports.chat.editMessage(chatId, msgId, text, [[btn(t(ports, 'btn_back'), 'NI|' + args[0] + '|back')]], false);
    ns.msgId = (ne && ne.messageId) || msgId || null;
    setState(ports, uid, { kind: 'await_text', purpose: 'add_option', list: list, resume: { a: a, args: args }, saved: ns });
    return ne;
  }
  setState(ports, uid, { kind: 'await_text', purpose: 'add_option', list: list, resume: { a: a, args: args }, saved: saved });
  if (known && a !== 'PM') return ports.chat.editMessage(chatId, msgId, text, kb, isCaption);
  return ports.chat.sendMessage(chatId, text, kb);
}

/**
 * A question screen (expense, delivery or refund method) that a committing tap has just edited into the card of the
 * entry. Remembered for ten minutes: a ➕ of the old screen can only be tapped before the redraw reaches the phone.
 */
function markCommittedCard(ports, chatId, msgId) {
  if (msgId) ports.cache.put('card:' + chatId + ':' + msgId, '1', 600);
}

function isCommittedCard(ports, chatId, msgId) {
  return !!msgId && !!ports.cache.get('card:' + chatId + ':' + msgId);
}

/**
 * The name of the new option arrived, typed (handleText) or spoken (handleIntent). state = the add state it was
 * read in. The option is added (or an option of that name is found), the state the user was in comes back and
 * the flow goes on with the option already chosen: ONE new message, "➕ ... added" in front of the usual reply
 * of that step (or of its refusal). When the add state is no longer the waiting one (in the app a voice note is
 * replayed later; the entry may have been finished by typing meanwhile) the option is still added but nothing
 * is restored and nothing is resumed.
 */
function finishAddOption(chatId, uid, state, text, staff, updateId, ports, source) {
  // Inside the guided sale nothing is written before the kind is known: the name is only looked up here.
  if (state.resume && state.resume.a === 'SSA') return saleAddNamed(chatId, uid, state, text, staff, updateId, ports);
  var waiting = sameAddState(getState(ports, uid), state), cancel = [[btn(t(ports, 'btn_cancel'), 'Z')]];
  // The new-piece card's ➕ (round 6b): its re-ask keeps the card's back row; the name goes through addItemCategory for the
  // item's shop (a name containing the sample word and a name the owner closed are refused, nothing written).
  var nic = !!state.resume && state.resume.a === 'NIC', nicId = nic ? String((state.resume.args || [])[0] || '') : '';
  if (nic) cancel = [[btn(t(ports, 'btn_back'), 'NI|' + nicId + '|back')]];
  var r;
  if (state.list === 'item_category') {
    var icItem = nicId ? ports.store.getItem(nicId) : null;
    r = addItemCategory(ports, text, staff, icItem ? icItem.shop : staff.shop);
  } else r = addListOptionByLabel(ports, state.list, text, staff);
  if (!r.ok) {
    if (r.reason === 'empty' || r.reason === 'sample' || r.reason === 'closed') {
      // Nothing usable (also a mistyped amount): ask again, the state stays. Without a waiting state there is nothing to ask for.
      if (!waiting) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
      var why = r.reason === 'sample' ? t(ports, 'add_ic_sample') : r.reason === 'closed' ? t(ports, 'add_ic_closed', { label: r.label }) : '';
      return ports.chat.sendMessage(chatId, withPrefix(why, t(ports, 'add_ask_' + listCodeOf(state.list))), cancel);
    }
    if (waiting) clearState(ports, uid);
    if (nic && waiting && state.saved && state.saved.kind === 'new_item') {
      return newItemCardShow(chatId, null, uid, state.saved, staff, ports, t(ports, 'add_unavailable'));
    }
    return ports.chat.sendMessage(chatId, t(ports, 'add_unavailable'));
  }
  var prefix = t(ports, r.created ? 'add_done' : 'add_exists', { label: r.label });
  if (!waiting) return ports.chat.sendMessage(chatId, prefix);
  if (state.saved) setState(ports, uid, state.saved); else clearState(ports, uid);
  var a = state.resume.a, args = state.resume.args || [], key = r.key, hint = null;
  // A new account has no number yet: the resumed message says where it will be printed and offers the 🔢 button.
  // Not on the split amount screen (the state waits for an amount) nor on the accounts screen (it has the button).
  if (r.created && state.list === 'pay_method' && (a === 'PM' || a === 'EM' || a === 'ODM' || a === 'OXM')) {
    hint = { line: t(ports, 'acct_detail_hint', { label: r.label }), row: [btn(t(ports, 'btn_acct_number'), 'LD|pm|' + key)] };
  }
  var orderResume = a === 'OF' || a === 'ODM' || a === 'OXM';
  if (orderResume && !ordersEnabled(ports)) return ports.chat.sendMessage(chatId, withPrefix(prefix, t(ports, 'expired')));
  switch (a) {
    case 'PM': return resumeMethod(chatId, uid, args[0], key, staff, updateId, ports, source, prefix, hint);
    case 'EM': return expenseMethod(chatId, null, uid, key, staff, updateId, ports, prefix, hint);
    case 'EC': return expenseCategory(chatId, null, uid, key, staff, ports, prefix);
    case 'SXM': return sendSplitAmount(chatId, null, uid, args[0], key, ports, prefix);
    case 'ODM': return deliverCommit(chatId, null, uid, args[0], Math.max(0, Math.round(Number(args[1]) || 0)), key, args[2], staff, updateId, ports, prefix, hint);
    case 'OXM': return cancelCommit(chatId, null, uid, args[0], 'refund', key, staff, updateId, ports, prefix, hint);
    case 'OF': return resumeFabric(chatId, uid, args[0], r.label, ports, prefix);
    case 'AC': return sendAccounts(chatId, staff, ports, prefix);
    case 'NIC': return newItemCatAdded(chatId, uid, args[0], r.label, staff, ports, prefix, r.key);
    default: return ports.chat.sendMessage(chatId, prefix);
  }
}

/* ------------------------------ customers ------------------------------ */

/**
 * A typed or spoken customer name: an exact name (or phone) match is used; a name nobody resembles
 * is created; look-alikes are offered as buttons together with "create this name", never merged
 * silently. mk(idOrCreate) builds the callback data. Returns the customer, or null after asking.
 */
function pickCustomer(chatId, uid, state, name, ports, mk) {
  name = String(name || '').trim();
  if (!name) { ports.chat.sendMessage(chatId, t(ports, 'ask_name')); return null; }
  var m = matchCustomers(ports, name);
  if (m.exact) return m.exact;
  if (!m.partial.length) return ports.store.addCustomer({ name: name });
  state.name = name;
  setState(ports, uid, state);
  var rows = m.partial.slice(0, 4).map(function (c) { return [btn(customerLabel(c), mk(c.id))]; });
  rows.push([btn(t(ports, 'btn_create_named', { name: name }), mk('create')), btn(t(ports, 'btn_cancel'), 'Z')]);
  ports.chat.sendMessage(chatId, t(ports, 'cust_pick', { name: name }), rows);
  return null;
}

function customerLabel(c) {
  return '👤 ' + c.name + (c.phone ? ' · ' + fmtPhone(c.phone) : '');
}

/** CU|group on a paid sale: pick who bought it. */
function startAttachCustomer(chatId, uid, groupId, staff, ports) {
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return ports.chat.sendMessage(chatId, rewriteRefusal(ports, chk.reason));
  setState(ports, uid, { kind: 'cu', groupId: groupId, step: 'customer' });
  var rows = recentCustomers(ports, staff.shop, 4).map(function (c) { return [btn('👤 ' + c.name, 'CUP|' + groupId + '|' + c.id)]; });
  rows.push([btn(t(ports, 'btn_new_customer'), 'CUP|' + groupId + '|new'), btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, t(ports, 'credit_ask_customer'), rows);
}

function attachCustomerPick(chatId, msgId, uid, groupId, arg, staff, updateId, ports) {
  var state = getState(ports, uid);
  if (!state || state.kind !== 'cu' || state.groupId !== groupId) state = { kind: 'cu', groupId: groupId, step: 'customer' };
  if (arg === 'new') {
    state.step = 'name';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ask_name'));
  }
  var customerId = arg;
  if (arg === 'create') {
    if (!state.name) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
    customerId = ports.store.addCustomer({ name: state.name }).id;
  }
  return finishAttach(chatId, msgId, uid, groupId, customerId, staff, updateId, ports);
}

function attachNamed(chatId, uid, state, name, staff, updateId, ports) {
  var c = pickCustomer(chatId, uid, state, name, ports, function (x) { return 'CUP|' + state.groupId + '|' + x; });
  if (!c) return;
  return finishAttach(chatId, null, uid, state.groupId, c.id, staff, updateId, ports);
}

function finishAttach(chatId, msgId, uid, groupId, customerId, staff, updateId, ports) {
  clearState(ports, uid);
  var customer = ports.store.getCustomer(customerId);
  if (!customer) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var r = rewriteGroup(ports, groupId, { customerId: customerId }, staff, updateId, { noteIfBlank: 'customer' });
  if (!r.ok) return ports.chat.sendMessage(chatId, rewriteRefusal(ports, r.reason));
  var text = describeRow(ports, r.row) + '\n' + t(ports, 'cust_attached', { customer: customer.name });
  var kb = afterSaleKeyboard(ports, groupId).concat(phoneRow(ports, customer));
  var x = viewOf(ports, saleSoldView(ports, groupId, ''));   // the app: the sale's sold card again (13.9)
  if (msgId) return x ? ports.chat.editMessage(chatId, msgId, text, kb, false, x) : ports.chat.editMessage(chatId, msgId, text, kb, false);
  return x ? ports.chat.sendMessage(chatId, text, kb, x) : ports.chat.sendMessage(chatId, text, kb);
}

/** CF|custId: ask for the phone; the answer is read before the number path in handleText. */
function askPhone(chatId, uid, customerId, ports) {
  var c = ports.store.getCustomer(customerId);
  if (!c) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  setState(ports, uid, { kind: 'await_text', purpose: 'phone', customerId: customerId });
  return ports.chat.sendMessage(chatId, t(ports, 'ask_phone', { customer: c.name }), [[btn(t(ports, 'btn_skip'), 'Z')]]);
}

/** Normalised to 09... when it looks like a Myanmar number; anything else is kept as typed, never refused. */
function savePhone(chatId, uid, customerId, text, staff, ports) {
  clearState(ports, uid);
  var c = ports.store.getCustomer(customerId);
  if (!c) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var valid = isValidPhone(text);
  var phone = valid ? normPhone(text) : String(text || '').trim();
  ports.store.updateCustomer(customerId, { phone: phone });
  if (valid) return ports.chat.sendMessage(chatId, t(ports, 'phone_saved', { customer: c.name, phone: fmtPhone(phone) }));
  return ports.chat.sendMessage(chatId, t(ports, 'phone_odd', { customer: c.name, phone: phone }), [[btn(t(ports, 'btn_phone'), 'CF|' + customerId)]]);
}

/** M|cust: the six most recent customers, search, cancel. In the app (round 6, revision 3): the buyers page. */
function showCustomers(chatId, uid, staff, ports) {
  if (screensInApp(ports)) {
    clearState(ports, uid);
    return ports.ui.openScreen('buyers', { chatId: chatId, uid: uid, staff: staff });
  }
  var list = recentCustomers(ports, staff.role === 'owner' ? null : staff.shop, CFG.CUST_MENU_RECENT);
  var rows = list.map(function (c) { return [btn(customerLabel(c), 'CH|' + c.id)]; });
  rows.push([btn(t(ports, 'btn_find'), 'M|cfind'), btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, t(ports, 'cust_list'), rows);
}

function showCustomerFind(chatId, staff, text, ports) {
  var found = findCustomers(ports, text);
  if (!found.length) return ports.chat.sendMessage(chatId, t(ports, 'cust_none'));
  return ports.chat.sendMessage(chatId, t(ports, 'cust_list'), found.slice(0, 6).map(function (c) { return [btn(customerLabel(c), 'CH|' + c.id)]; }));
}

function customerLine(ports, r) {
  var desc = txLabel(r.type), label = itemLabel(ports, r);
  if (label && (r.itemId || r.type === CFG.TX.EXPENSE)) desc += ' ' + label;
  var paid = r.type === CFG.TX.SALE && r.cash !== r.amount ? t(ports, 'cust_line_paid', { paid: fmtMoney(r.cash) }) : '';
  var m = methodOf(r);
  return t(ports, 'cust_line', { day: fmtDayShortMy(r.day), desc: desc, amount: fmtMoney(r.amount), paid: paid, method: m ? ' · ' + methodLabel(ports, m) : '' });
}

/**
 * A customer's ledger history as entries, newest first, the first n (0 = all): {groupId, day, type, desc, name, amount,
 * cash, method, n, row}. The SALE rows of a basket (a group with more than one live SALE row, not a custom-order delivery)
 * are ONE entry (n = its lines, amount and cash summed, desc 'ရောင်း 🛍 {n} ခု', name = its first item's name, method = that
 * of the rows that carry cash); every other row is its own entry (n 1, row = the ledger row; name = its item's name, '' for
 * a row without an item). The structured twin of customerLines (the app's buyer page draws it).
 */
function customerRows(ports, customerId, n) {
  var rows = customerHistory(ports, customerId, 0), all = ports.store.ledgerRows(), out = [], done = {}, saleCount = {};
  var reversed = reversedIdSet(all);
  all.forEach(function (r) {
    if (r.type === CFG.TX.SALE && !r.reversesTxId && !reversed[r.txId]) saleCount[r.groupId] = (saleCount[r.groupId] || 0) + 1;
  });
  rows.forEach(function (r) {
    var basket = r.type === CFG.TX.SALE && saleCount[r.groupId] > 1 && !isOrderId(r.groupId);
    if (basket) {
      if (done['g:' + r.groupId]) return;
      done['g:' + r.groupId] = true;
      var lines = liveRows(all.filter(function (x) { return x.groupId === r.groupId && x.type === CFG.TX.SALE; }), all);
      var amount = 0, cash = 0, method = '';
      lines.forEach(function (x) { amount += x.amount; cash += x.cash; if (!method && x.cash) method = methodOf(x); });
      var first = ports.store.getItem(lines[0].itemId);
      out.push({ groupId: r.groupId, day: r.day, type: CFG.TX.SALE, desc: txLabel(CFG.TX.SALE) + ' ' + t(ports, 'basket_count', { n: fmtCount(lines.length) }),
        name: first ? first.name : lines[0].itemId, amount: amount, cash: cash, method: method, n: lines.length, row: null });
      return;
    }
    var desc = txLabel(r.type), label = itemLabel(ports, r);
    if (label && (r.itemId || r.type === CFG.TX.EXPENSE)) desc += ' ' + label;
    var it = r.itemId && r.type !== CFG.TX.PAYMENT && r.type !== CFG.TX.DEPOSIT_APPLIED ? ports.store.getItem(r.itemId) : null;
    out.push({ groupId: r.groupId, day: r.day, type: r.type, desc: desc, name: it ? it.name : '', amount: r.amount, cash: r.cash,
      method: methodOf(r), n: 1, row: r });
  });
  return n ? out.slice(0, n) : out;
}

/** customerRows as the customer card's lines (cust_line): a one-row entry is exactly customerLine of its row. */
function customerLines(ports, customerId, n) {
  return customerRows(ports, customerId, n).map(function (e) {
    if (e.row) return customerLine(ports, e.row);
    return t(ports, 'cust_line', { day: fmtDayShortMy(e.day), desc: e.desc, amount: fmtMoney(e.amount),
      paid: e.cash !== e.amount ? t(ports, 'cust_line_paid', { paid: fmtMoney(e.cash) }) : '', method: e.method ? ' · ' + methodLabel(ports, e.method) : '' });
  });
}

/** CH|custId: bought, paid, owed, deposit held, last visit, visits, the last lines, and the four actions. In the app: the buyer page. */
function customerCard(chatId, customerId, staff, ports) {
  if (screensInApp(ports)) return ports.ui.openScreen('buyer', { chatId: chatId, customerId: customerId, staff: staff });
  var c = ports.store.getCustomer(customerId);
  if (!c) return ports.chat.sendMessage(chatId, t(ports, 'cust_none'));
  var s = customerSummary(ports, customerId);
  var head = t(ports, 'cust_card', {
    name: c.name, phone: c.phone ? ' · ' + fmtPhone(c.phone) : '', bought: fmtMoney(s.bought), paid: fmtMoney(s.paid), owed: fmtMoney(s.owed),
    deposit: fmtMoney(s.depositHeld), last: s.lastDay ? fmtDayShortMy(s.lastDay) : '-', visits: myDigits(s.visits)
  });
  var lines = customerLines(ports, customerId, CFG.CUST_HISTORY_LINES);
  var text = head + '\n──────────\n' + (lines.length ? lines.join('\n') : t(ports, 'cust_no_rows'));
  var row1 = [];
  if (s.owed > 0) {
    var credits = openCredits(ports, null).filter(function (x) { return x.customerId === customerId; });
    row1.push(btn(t(ports, 'btn_pay'), credits.length === 1 ? 'PY|' + credits[0].groupId : 'PL|' + customerId));
  }
  row1.push(btn(t(ports, 'btn_deposit'), 'DC|' + customerId));
  var rows = [row1, [btn(t(ports, 'btn_phone'), 'CF|' + customerId), btn(t(ports, 'btn_statement'), 'CS|' + customerId)]];
  // 📏 the customer's measurements: the Telegram flow where the order module is on, the app's form there (spec 9.2).
  if (measureEnabled(ports) && utf8ByteLength('MS|' + customerId) <= 64) rows.push([btn(t(ports, 'btn_measure'), 'MS|' + customerId)]);
  return ports.chat.sendMessage(chatId, text, rows);
}

function sendCustomerStatement(chatId, customerId, staff, ports) {
  ports.chat.typing(chatId);
  var report = buildReport(ports, 'customer', { customerId: customerId, shop: staff.role === 'owner' ? null : staff.shop, now: ports.clock.now() });
  var doc = ports.pdf.make(report);
  return ports.chat.sendDocument(chatId, doc, t(ports, 'rep_caption', { title: report.title }));
}

/* ------------------------------ credit sales ------------------------------ */

function startCredit(chatId, uid, groupId, staff, ports) {
  var info = saleGroupInfo(ports, groupId);
  if (!info || info.voided) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return ports.chat.sendMessage(chatId, rewriteRefusal(ports, chk.reason));
  setState(ports, uid, { kind: 'credit', groupId: groupId, step: 'paid' });
  var half = Math.round(info.total / 2);
  return ports.chat.sendMessage(chatId, t(ports, 'credit_ask_paid', { total: fmtMoney(info.total) }), [
    [btn('0', 'CP|' + groupId + '|0'), btn(fmtMoney(half), 'CP|' + groupId + '|' + half), btn(t(ports, 'btn_other'), 'CP|' + groupId + '|other')],
    [btn(t(ports, 'btn_cancel'), 'Z')]
  ]);
}

function creditPaid(chatId, msgId, uid, groupId, arg, staff, ports) {
  var info = saleGroupInfo(ports, groupId);
  if (!info || info.voided) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'credit_paid', groupId: groupId });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_number'), [], false);
  }
  var paidNow = Math.max(0, Math.min(info.total, Number(arg) || 0));
  return askCreditCustomer(chatId, msgId, uid, groupId, paidNow, staff, ports);
}

function askCreditCustomer(chatId, msgId, uid, groupId, paidNow, staff, ports) {
  setState(ports, uid, { kind: 'credit', groupId: groupId, step: 'customer', paidNow: paidNow });
  var rows = recentCustomers(ports, staff.shop, 4).map(function (c) { return [btn('👤 ' + c.name, 'CC|' + groupId + '|' + c.id)]; });
  rows.push([btn(t(ports, 'btn_new_customer'), 'CC|' + groupId + '|new'), btn(t(ports, 'btn_cancel'), 'Z')]);
  var text = t(ports, 'credit_ask_customer');
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, rows, false);
  return ports.chat.sendMessage(chatId, text, rows);
}

function creditCustomer(chatId, msgId, uid, groupId, arg, staff, updateId, ports) {
  var state = getState(ports, uid);
  if (!state || state.kind !== 'credit' || state.groupId !== groupId) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  if (arg === 'new') {
    state.step = 'name';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ask_name'));
  }
  var customerId = arg;
  if (arg === 'create') {
    if (!state.name) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
    customerId = ports.store.addCustomer({ name: state.name }).id;
  }
  return finishCredit(chatId, msgId, uid, groupId, state.paidNow, customerId, staff, updateId, ports);
}

function creditNamed(chatId, uid, state, name, staff, updateId, ports) {
  var c = pickCustomer(chatId, uid, state, name, ports, function (x) { return 'CC|' + state.groupId + '|' + x; });
  if (!c) return;
  return finishCredit(chatId, null, uid, state.groupId, state.paidNow, c.id, staff, updateId, ports);
}

function finishCredit(chatId, msgId, uid, groupId, paidNow, customerId, staff, updateId, ports) {
  clearState(ports, uid);
  var customer = ports.store.getCustomer(customerId);
  if (!customer) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var r = convertSaleToCredit(ports, groupId, paidNow, customerId, staff, updateId);
  if (!r.ok) return ports.chat.sendMessage(chatId, rewriteRefusal(ports, r.reason));
  var info = saleGroupInfo(ports, r.groupId);
  var held = depositsFor(ports, customerId);
  var text = t(ports, 'credit_done', { customer: customer.name, paid: fmtMoney(info.cash), owed: fmtMoney(info.owed) });
  // view: the app's sold card of the sale (13.9); Telegram gets the calls of before.
  var send = function (txt, kb, view) {
    var x = viewOf(ports, view);
    if (msgId) { if (x) ports.chat.editMessage(chatId, msgId, txt, kb, false, x); else ports.chat.editMessage(chatId, msgId, txt, kb, false); }
    else if (x) ports.chat.sendMessage(chatId, txt, kb, x);
    else ports.chat.sendMessage(chatId, txt, kb);
  };
  var soldView = saleSoldView(ports, r.groupId, '');
  if (held > 0 && info.owed > 0) {
    var question = t(ports, 'credit_use_deposit', { customer: customer.name, deposit: fmtMoney(held) });
    soldView.extra = [question];
    return send(text + '\n' + question,
      [[btn(t(ports, 'btn_use_deposit'), 'CD|' + r.groupId + '|yes'), btn(t(ports, 'btn_no_deposit'), 'CD|' + r.groupId + '|no')]], soldView);
  }
  return send(text, afterSaleKeyboard(ports, r.groupId).concat(phoneRow(ports, customer)), soldView);
}

/**
 * CD|<g>|yes|no: use (or not) the buyer's held deposit against the credit. isCaption = the tapped message is a photo card
 * (the guided sale's sold card is one). plain (CD|<g>|yes|p[|<KEY>], the guided sale): the card is redrawn from the ledger
 * (saleCardText) with the plain rows, the 🔢 hint row for addedKey and the 📱 row; without it today's credit card.
 */
function creditDeposit(chatId, msgId, isCaption, groupId, arg, staff, updateId, ports, plain, addedKey) {
  var edit = function (text, kb) { ports.chat.editMessage(chatId, msgId, text, kb || [], !!isCaption); };
  var info = saleGroupInfo(ports, groupId);
  if (!info || info.voided) return edit(t(ports, 'expired'));
  var customer = customerName(ports, info.customerId);
  if (plain) {
    var cust = ports.store.getCustomer(info.customerId);
    // The sold card again (with the app's sold view, round 6, revision 3).
    var soldView = saleSoldView(ports, groupId, addedKey);
    if (arg !== 'yes') return editOrSend(ports, chatId, msgId, saleCardText(ports, groupId, addedKey), saleCardKeyboard(ports, groupId, addedKey, cust), isCaption, soldView);
    var rp = applyDeposit(ports, { groupId: groupId, customerId: info.customerId, staff: staff, source: CFG.SOURCE.BUTTON, updateId: updateId });
    var afterP = saleGroupInfo(ports, groupId);
    return editOrSend(ports, chatId, msgId, saleCardText(ports, groupId, addedKey) + '\n' + t(ports, 'deposit_applied', { amount: fmtMoney(rp ? rp.amount : 0), owed: fmtMoney(afterP.owed) }),
      saleCardKeyboard(ports, groupId, addedKey, cust), isCaption, soldView);
  }
  // The app: the sale's sold card again (13.9); Telegram: the edit of before.
  var editSold = function (text, kb) {
    var x = viewOf(ports, saleSoldView(ports, groupId, ''));
    return x ? ports.chat.editMessage(chatId, msgId, text, kb || [], !!isCaption, x) : edit(text, kb);
  };
  if (arg !== 'yes') return editSold(t(ports, 'credit_done', { customer: customer, paid: fmtMoney(info.cash), owed: fmtMoney(info.owed) }), afterSaleKeyboard(ports, groupId));
  var r = applyDeposit(ports, { groupId: groupId, customerId: info.customerId, staff: staff, source: CFG.SOURCE.BUTTON, updateId: updateId });
  var after = saleGroupInfo(ports, groupId);
  return editSold(t(ports, 'credit_done', { customer: customer, paid: fmtMoney(after.cash), owed: fmtMoney(after.owed) }) + '\n' +
    t(ports, 'deposit_applied', { amount: fmtMoney(r ? r.amount : 0), owed: fmtMoney(after.owed) }), afterSaleKeyboard(ports, groupId));
}

/* ------------------------------ payments ------------------------------ */

function creditButtons(credits) {
  return credits.map(function (c) { return [btn('👤 ' + c.customer + ' · ' + fmtMoney(c.owed) + ' · ' + fmtDayShortMy(c.day), 'PY|' + c.groupId)]; });
}

/** Open credits as buttons; customerId narrows the list to one person (from the customer card). */
function showPayList(chatId, staff, ports, prefix, customerId) {
  var credits = openCredits(ports, staff.role === 'owner' ? null : staff.shop);
  if (customerId) credits = credits.filter(function (c) { return c.customerId === customerId; });
  if (!credits.length) return ports.chat.sendMessage(chatId, (prefix || '') + t(ports, 'pay_none'));
  var rows = creditButtons(credits.slice(0, 8));
  rows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, (prefix || '') + t(ports, 'pay_list'), rows);
}

function payPick(chatId, msgId, uid, groupId, staff, ports) {
  var info = saleGroupInfo(ports, groupId);
  if (!info || info.owed <= 0) return ports.chat.editMessage(chatId, msgId, t(ports, 'pay_none'), [], false);
  setState(ports, uid, { kind: 'await_number', purpose: 'pay_amount', groupId: groupId });
  var text = t(ports, 'pay_ask_amount', { customer: customerName(ports, info.customerId), owed: fmtMoney(info.owed) });
  var kb = [[btn(t(ports, 'btn_all', { amount: fmtMoney(info.owed) }), 'PA|' + groupId + '|all'), btn(t(ports, 'btn_other'), 'PA|' + groupId + '|other')],
            [btn(t(ports, 'btn_cancel'), 'Z')]];
  return ports.chat.sendMessage(chatId, text, kb);
}

function payAmount(chatId, msgId, uid, groupId, arg, staff, updateId, ports) {
  var info = saleGroupInfo(ports, groupId);
  if (!info || info.owed <= 0) return ports.chat.editMessage(chatId, msgId, t(ports, 'pay_none'), [], false);
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'pay_amount', groupId: groupId });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_number'), [], false);
  }
  clearState(ports, uid);
  var amount = arg === 'all' ? info.owed : Number(arg);
  return commitPaymentAndReply(chatId, msgId, groupId, amount, staff, updateId, ports, CFG.SOURCE.BUTTON, '', null, uid);
}

function commitPaymentAndReply(chatId, msgId, groupId, amount, staff, updateId, ports, source, transcript, method, uid) {
  var info = saleGroupInfo(ports, groupId);
  if (!info || info.owed <= 0) return ports.chat.sendMessage(chatId, t(ports, 'pay_none'));
  var r = commitPayment(ports, { groupId: groupId, amount: amount, method: method, staff: staff, source: source, transcript: transcript, updateId: updateId });
  var after = saleGroupInfo(ports, groupId);
  if (uid) setLastGroup(ports, uid, r.groupId);
  var text = t(ports, 'pay_done', { customer: customerName(ports, after.customerId), amount: fmtMoney(r.txs[0].amount), owed: fmtMoney(after.owed) }) + methodLine(ports, method);
  var kb = replyKeyboard(ports, r.groupId), view = { kind: 'group', id: r.groupId };
  if (msgId) return editOrSend(ports, chatId, msgId, text, kb, false, view);
  return sendView(ports, chatId, text, kb, view);
}

/* ------------------------------ deposits ------------------------------ */

function startDeposit(chatId, uid, staff, ports, presetAmount, prefix) {
  setState(ports, uid, { kind: 'dep', step: 'customer', amount: presetAmount || null });
  var rows = recentCustomers(ports, staff.shop, 4).map(function (c) { return [btn('👤 ' + c.name, 'DC|' + c.id)]; });
  rows.push([btn(t(ports, 'btn_new_customer'), 'DC|new'), btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, (prefix || '') + t(ports, 'dep_ask_customer'), rows);
}

function depCustomer(chatId, msgId, uid, arg, staff, ports) {
  var state = getState(ports, uid);
  if (!state || state.kind !== 'dep') state = { kind: 'dep', step: 'customer', amount: null };
  if (arg === 'new') {
    state.step = 'name';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ask_name'));
  }
  var customerId = arg;
  if (arg === 'create') {
    if (!state.name) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
    customerId = ports.store.addCustomer({ name: state.name }).id;
  }
  return depositForCustomer(chatId, msgId, uid, customerId, state, staff, ports);
}

function depositNamed(chatId, uid, state, name, staff, ports) {
  var c = pickCustomer(chatId, uid, state, name, ports, function (x) { return 'DC|' + x; });
  if (!c) return;
  return depositForCustomer(chatId, null, uid, c.id, state, staff, ports);
}

function depositForCustomer(chatId, msgId, uid, customerId, state, staff, ports) {
  if (state && state.amount) return askDepositNote(chatId, msgId, uid, customerId, state.amount, staff, ports);
  return askDepositAmount(chatId, msgId, uid, customerId, staff, ports);
}

function askDepositAmount(chatId, msgId, uid, customerId, staff, ports) {
  var c = ports.store.getCustomer(customerId);
  if (!c) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  setState(ports, uid, { kind: 'await_number', purpose: 'dep_amount', customerId: customerId });
  var presets = depositPresets(ports).map(function (a) { return btn(fmtMoney(a), 'DA|' + customerId + '|' + a); });
  var kb = [presets, [btn(t(ports, 'btn_other'), 'DA|' + customerId + '|other'), btn(t(ports, 'btn_cancel'), 'Z')]];
  var text = t(ports, 'dep_ask_amount', { customer: c.name });
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

function depAmount(chatId, msgId, uid, customerId, arg, staff, ports) {
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'dep_amount', customerId: customerId });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_number'), [], false);
  }
  return askDepositNote(chatId, msgId, uid, customerId, Number(arg), staff, ports);
}

function askDepositNote(chatId, msgId, uid, customerId, amount, staff, ports) {
  setState(ports, uid, { kind: 'dep', step: 'note', customerId: customerId, amount: amount });
  var kb = [[btn(t(ports, 'btn_skip'), 'DN|' + customerId + '|' + amount), btn(t(ports, 'btn_cancel'), 'Z')]];
  var text = t(ports, 'dep_ask_note');
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

function finishDeposit(chatId, msgId, uid, customerId, amount, note, staff, updateId, ports, source, transcript, method) {
  clearState(ports, uid);
  var c = ports.store.getCustomer(customerId);
  if (!c) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var r = commitDeposit(ports, { customerId: customerId, amount: amount, note: note, method: method, shop: staff.shop, staff: staff, source: source, transcript: transcript, updateId: updateId });
  setLastGroup(ports, uid, r.groupId);
  var text = t(ports, 'dep_done', { customer: c.name, amount: fmtMoney(amount), held: fmtMoney(depositsFor(ports, customerId)) }) + methodLine(ports, method);
  var kb = replyKeyboard(ports, r.groupId).concat(phoneRow(ports, c)), view = { kind: 'group', id: r.groupId };
  if (msgId) return editOrSend(ports, chatId, msgId, text, kb, false, view);
  return sendView(ports, chatId, text, kb, view);
}

/* ------------------------------ expenses by buttons ------------------------------ */

/** M|exp: owners pick the shop first; staff go straight to the category grid. Three taps commit. */
function startExpense(chatId, uid, staff, ports) {
  // The app with its forms (round 6): the expense form, one screen.
  if (formsInApp(ports)) {
    clearState(ports, uid);
    return ports.ui.openForm('expense', { chatId: chatId, uid: uid, staff: staff });
  }
  if (staff.role === 'owner') {
    setState(ports, uid, { kind: 'exp', step: 'shop', draft: {} });
    var shops = CFG.SHOP_IDS.map(function (s) { return btn(shopName(ports, s), 'ES|' + s); });
    return ports.chat.sendMessage(chatId, t(ports, 'exp_ask_shop'), [shops, [btn(t(ports, 'btn_cancel'), 'Z')]]);
  }
  setState(ports, uid, { kind: 'exp', step: 'cat', draft: { shop: staff.shop } });
  var scr = expenseCatScreen(ports, staff.shop);
  return ports.chat.sendMessage(chatId, scr.text, scr.kb);
}

/**
 * The category grid: the active expense categories of that shop with their emoji, three per row; the last row
 * adds a category on the spot (➕) or cancels. A button whose callback data would exceed 64 bytes is skipped.
 */
function expenseCatScreen(ports, shop) {
  var rows = [], row = [];
  expenseCategories(ports, shop).forEach(function (c) {
    var data = 'EC|' + c[0];
    if (utf8ByteLength(data) > 64) return;
    row.push(btn(expenseEmoji(ports, c[0]) + ' ' + c[1], data));
    if (row.length === 3) { rows.push(row); row = []; }
  });
  if (row.length) rows.push(row);
  rows.push([btn(t(ports, 'btn_add_cat'), 'LA|ec|EC'), btn(t(ports, 'btn_cancel'), 'Z')]);
  return { text: t(ports, 'exp_ask_cat'), kb: rows };
}

function expenseState(ports, uid, step) {
  var s = getState(ports, uid);
  return s && s.kind === 'exp' && s.draft && (!step || s.step === step) ? s : null;
}

function expenseShop(chatId, msgId, uid, shop, staff, ports) {
  var state = expenseState(ports, uid, 'shop');
  if (!state || CFG.SHOP_IDS.indexOf(shop) < 0) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  state.draft.shop = shop;
  state.step = 'cat';
  setState(ports, uid, state);
  var scr = expenseCatScreen(ports, shop);
  return ports.chat.editMessage(chatId, msgId, scr.text, scr.kb, false);
}

/** EC|<key>: the amount screen. prefix (and no msgId): resumed after ➕ added the category, as one new message. */
function expenseCategory(chatId, msgId, uid, cat, staff, ports, prefix) {
  var state = expenseState(ports, uid, 'cat');
  if (!state) return editOrSend(ports, chatId, msgId, withPrefix(prefix, t(ports, 'expired')), []);
  state.draft.cat = String(cat || 'other').toLowerCase();
  state.step = 'amount';
  setState(ports, uid, state);
  var presets = expensePresets(ports, state.draft.cat).map(function (a) { return btn(fmtMoney(a), 'EA|' + a); });
  var kb = [presets, [btn(t(ports, 'btn_other'), 'EA|other'), btn(t(ports, 'btn_cancel'), 'Z')]];
  return editOrSend(ports, chatId, msgId, withPrefix(prefix, t(ports, 'exp_ask_amount', { cat: categoryLabel(ports, state.draft.cat) })), kb);
}

function expenseAmountTap(chatId, msgId, uid, arg, staff, ports) {
  var state = expenseState(ports, uid, 'amount');
  if (!state) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'exp_amount', draft: state.draft });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_number'), [], false);
  }
  return expenseAmount(chatId, msgId, uid, state, Number(arg), staff, ports);
}

/** The amount is known (tap, typed or spoken): ask how it was paid. 💵 first, then one 🏦 per account of the shop, ➕, cancel. */
function expenseAmount(chatId, msgId, uid, state, amount, staff, ports) {
  amount = Math.abs(Math.round(Number(amount) || 0));
  var draft = state.draft || {};
  if (!amount) {
    setState(ports, uid, { kind: 'await_number', purpose: 'exp_amount', draft: draft });
    return ports.chat.sendMessage(chatId, t(ports, 'ask_number'));
  }
  draft.amount = amount;
  setState(ports, uid, { kind: 'exp', step: 'method', draft: draft });
  var text = t(ports, 'exp_ask_method', { cat: categoryLabel(ports, draft.cat), amount: fmtMoney(amount) });
  var kb = methodRows(ports, draft.shop || staff.shop, null, function (k) { return 'EM|' + k; }, { add: 'LA|pm|EM' });
  kb.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

/**
 * EM|METHOD commits at once (category, amount, method = three taps); a note can be added afterwards.
 * prefix and hint (and no msgId): resumed after ➕ added the account, as one new message.
 */
function expenseMethod(chatId, msgId, uid, method, staff, updateId, ports, prefix, hint) {
  var state = expenseState(ports, uid, 'method');
  method = String(method || CFG.METHOD.CASH).toUpperCase();
  // A stale screen, or a key the lists do not know (a retired account still counts): nothing is written.
  if (!state || !state.draft.amount || !methodKnown(ports, method)) {
    return editOrSend(ports, chatId, msgId, withHintLine(withPrefix(prefix, t(ports, 'expired')), hint), withHintRow([], hint));
  }
  clearState(ports, uid);
  var d = state.draft;
  var r = commitExpense(ports, { amount: d.amount, shop: d.shop || staff.shop, category: d.cat, method: method, note: '',
    staff: staff, source: CFG.SOURCE.BUTTON, updateId: updateId });
  setLastGroup(ports, uid, r.groupId);
  markCommittedCard(ports, chatId, msgId);
  var text = t(ports, 'expense_done', { amount: fmtMoney(d.amount), cat: categoryLabel(ports, d.cat), note: '', method: methodLabel(ports, method) });
  return editOrSend(ports, chatId, msgId, withHintLine(withPrefix(prefix, text), hint), withHintRow(replyKeyboard(ports, r.groupId), hint), false,
    { kind: 'group', id: r.groupId });
}

/** EN|group: the optional note, attached to the expense within the state TTL as a rewrite of its row. */
function askExpenseNote(chatId, uid, groupId, ports) {
  var chk = rewriteCheck(ports, groupId);
  if (!chk.ok) return ports.chat.sendMessage(chatId, rewriteRefusal(ports, chk.reason));
  setState(ports, uid, { kind: 'await_text', purpose: 'exp_note', groupId: groupId });
  return ports.chat.sendMessage(chatId, t(ports, 'exp_ask_note'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
}

function attachExpenseNote(chatId, uid, groupId, note, staff, updateId, ports, source, transcript) {
  clearState(ports, uid);
  note = String(note || '').trim();
  if (!note) return askExpenseNote(chatId, uid, groupId, ports);
  var r = rewriteGroup(ports, groupId, { note: note }, staff, updateId, { source: source, transcript: transcript });
  if (!r.ok) return ports.chat.sendMessage(chatId, rewriteRefusal(ports, r.reason));
  var row = r.row;
  var text = t(ports, 'exp_note_saved') + '\n' + t(ports, 'expense_done', { amount: fmtMoney(-row.amount), cat: categoryLabel(ports, row.category),
    note: ' · ' + note, method: methodLabel(ports, methodOf(row)) });
  return ports.chat.sendMessage(chatId, text, replyKeyboard(ports, groupId));
}

/* ------------------------------ reports and receipts ------------------------------ */

function showReportMenu(chatId, staff, ports) {
  var rows = [
    [btn(t(ports, 'rep_today'), 'RP|today'), btn(t(ports, 'rep_month'), 'RP|month'), btn(t(ports, 'rep_last'), 'RP|last')],
    [btn(t(ports, 'rep_stock'), 'RP|stock'), btn(t(ports, 'rep_owed'), 'RP|owed'), btn(t(ports, 'rep_expense'), 'RP|exp')]
  ];
  if (ordersEnabled(ports)) rows.push([btn(t(ports, 'rep_orders'), 'RP|orders')]);
  return ports.chat.sendMessage(chatId, t(ports, 'rep_menu'), rows);
}

function sendReport(chatId, kind, staff, ports) {
  ports.chat.typing(chatId);
  var report = buildReport(ports, kind, { shop: staff.role === 'owner' ? null : staff.shop, now: ports.clock.now() });
  var doc = ports.pdf.make(report);
  return ports.chat.sendDocument(chatId, doc, t(ports, 'rep_caption', { title: report.title }));
}

/**
 * RC|g: the receipt as a text with [📄 PDF]; the owner's receipt of a basket that is not voided adds 🚫 void (round 6: the
 * owner can always reach a basket). In the app (revision 3): the receipt page.
 */
function sendReceipt(chatId, groupId, staff, ports) {
  if (screensInApp(ports)) return ports.ui.openScreen('receipt', { chatId: chatId, groupId: groupId, staff: staff });
  var r = buildReceipt(ports, groupId);
  if (!r) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var kb = [[btn(t(ports, 'btn_pdf'), 'RCP|' + groupId)]], info = staff.role === 'owner' ? saleGroupInfo(ports, groupId) : null;
  if (basketGroup(info) && !info.voided) kb.push([voidButton(ports, groupId)]);
  return ports.chat.sendMessage(chatId, receiptText(ports, r), kb);
}

function sendReceiptPdf(chatId, groupId, staff, ports) {
  var r = buildReceipt(ports, groupId);
  if (!r) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var doc = ports.pdf.make(receiptReport(ports, r, ports.clock.now()));
  return ports.chat.sendDocument(chatId, doc, '🧾 ' + r.no);
}

/* ------------------------------ new item by photo ------------------------------ */

function handlePhoto(msg, staff, updateId, ports) {
  var chatId = msg.chat.id, uid = String(msg.from.id);
  var best = msg.photo[msg.photo.length - 1];
  var state = getState(ports, uid);

  // The notebook page and the measurement sheet are read by the AI: with the owner's switch turned off since 📒 or 📷 was
  // tapped, the photo is not read (round 6, F9b: no AI call anywhere).
  if (state && state.kind === 'notebook') {
    if (!aiOn(ports)) { clearState(ports, uid); return ports.chat.sendMessage(chatId, t(ports, 'nb_off')); }
    return handleNotebookPhoto(chatId, uid, best.file_id, staff, updateId, ports);
  }
  if (state && state.kind === 'meas' && ordersEnabled(ports)) {
    if (!aiOn(ports)) return ports.chat.sendMessage(chatId, t(ports, 'ai_off'), measMethodRow(ports, state.token));
    return measPhoto(chatId, uid, state, best.file_id, staff, updateId, ports);
  }

  // The new-piece card's state, also while its ➕ prompt waits (round 6b): that photo is the card's, never the last item's.
  var ns = newItemStateOf(state);
  if (!ns) {
    var last = getLastItem(ports, uid);
    if (!last) return ports.chat.sendMessage(chatId, t(ports, 'scan_first'));
    var url0 = ports.chat.savePhoto(best.file_id, last.id);
    ports.store.updateItem(last.id, { photoUrl: url0, photoFileId: best.file_id });
    return ports.chat.sendMessage(chatId, t(ports, 'photo_saved', { id: last.id }));
  }
  state = ns;

  var form = saleFlow(ports) === CFG.SALE_FLOW.FORM;
  if (form && state.form && state.step !== 'photo') {
    // A second photo while the new-piece card is live (round 6): only the photo changes; the card comes again.
    state.draft = state.draft || {};
    state.draft.photoUrl = ports.chat.savePhoto(best.file_id, state.itemId);
    state.draft.photoFileId = best.file_id;
    return newItemCardShow(chatId, null, uid, state, staff, ports, '');
  }
  ports.chat.typing(chatId);
  var draft = state.draft || {};
  draft.photoUrl = ports.chat.savePhoto(best.file_id, state.itemId);
  draft.photoFileId = best.file_id;
  var desc = null;
  // The item categories the piece's shop is offered (round 6b): the AI picks one of them, else the catch-all.
  var it6 = ports.store.getItem(state.itemId), cats = itemCategoryAi(ports, it6 ? it6.shop : staff.shop);
  // The owner's AI switch (round 6, F9b): with AI off there is no AI call and the piece keeps the placeholder name.
  if (aiOn(ports)) {
    try {
      desc = ports.ai.describePhoto(ports.chat.getFile(best.file_id), { categories: cats.names });
    } catch (err) {
      ports.store.logError('photo', err, updateId, '');
    }
  }
  draft.name = (desc && desc.name) || draft.name || itemPlaceholderName(state.itemId);
  draft.category = (desc && itemCategoryPick(cats.names, desc.category)) || cats.other;
  var aiRow = itemCategoryOf(ports, draft.category);
  draft.categoryKey = aiRow ? aiRow.key : '';   // the row the photo named (commitNewItem prefers it to the name)
  draft.description = (desc && desc.description) || '';
  draft.sample = !!draft.sample;
  var captionNumber = parseNumberText(msg.caption || '');
  state.draft = draft;
  if (form) {
    // The new-piece review card (spec 2.3): a caption number of 500 or more is the price; nothing is written before ✅.
    state.form = true;
    draft.count = 1;
    if (captionNumber !== null && captionNumber >= 500) draft.price = captionNumber;
    return newItemCardShow(chatId, null, uid, state, staff, ports, '');
  }
  state.step = 'price';
  setState(ports, uid, state);
  if (captionNumber !== null && captionNumber >= 500) return newItemPrice(chatId, null, uid, state.itemId, captionNumber, staff, ports);
  var screen = priceScreen(ports, state, staff);
  return ports.chat.sendMessage(chatId, screen.text, screen.kb);
}

function priceScreen(ports, state, staff) {
  var d = state.draft, id = state.itemId;
  var presets = pricePresets(ports, d.category, staff.shop).map(function (p) { return btn(fmtMoney(p), 'P|' + id + '|' + p); });
  return {
    text: t(ports, 'photo_seen', { name: d.name, category: d.category }) + '\n' + t(ports, 'ask_price'),
    kb: [presets,
         [btn(t(ports, 'btn_other'), 'P|' + id + '|other'), btn(t(ports, 'btn_pending'), 'P|' + id + '|pending')],
         [btn(t(ports, d.sample ? 'btn_sample_on' : 'btn_sample_off'), 'PS|' + id), btn(t(ports, 'btn_cancel'), 'Z')]]
  };
}

function toggleSample(chatId, msgId, uid, itemId, staff, ports) {
  var raw = getState(ports, uid), state = newItemStateOf(raw);
  if (!state || state.itemId !== itemId) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  msgId = newItemTapMsg(raw, state, msgId);
  state.draft.sample = !state.draft.sample;
  if (state.form && state.step !== 'photo') return newItemCardShow(chatId, msgId, uid, state, staff, ports, '');
  setState(ports, uid, state);
  var screen = priceScreen(ports, state, staff);
  return ports.chat.editMessage(chatId, msgId, screen.text, screen.kb, false);
}

function newItemPrice(chatId, msgId, uid, itemId, arg, staff, ports) {
  var raw = getState(ports, uid), state = newItemStateOf(raw);
  if (!state || state.itemId !== itemId) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  msgId = newItemTapMsg(raw, state, msgId);
  if (state.form && state.step !== 'photo') {
    // The new-piece card (round 6): a price sets the field and the card comes back; ✏️ opens the price sub-screen.
    if (arg === 'other') {
      return newItemScreen(chatId, msgId, uid, state, ports, 'price', newItemSeen(ports, state.draft) + '\n' + t(ports, 'ask_price'),
        [btn(t(ports, 'btn_back'), 'NI|' + itemId + '|back')]);
    }
    var pn = Math.round(Number(arg));
    state.draft.price = arg !== 'pending' && pn > 0 ? pn : '';
    return newItemCardShow(chatId, msgId, uid, state, staff, ports, '');
  }
  if (arg === 'other') {
    state.step = 'price';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ask_number'));
  }
  state.draft.price = arg === 'pending' ? '' : Number(arg);
  state.step = 'cost';
  setState(ports, uid, state);
  var priceLine = arg === 'pending' ? t(ports, 'btn_pending') : '💰 ' + fmtMoney(state.draft.price) + ' ကျပ်';
  var text = t(ports, 'photo_seen', { name: state.draft.name, category: state.draft.category }) + '\n' + priceLine + '\n' + t(ports, 'ask_cost');
  var kb = [[btn(t(ports, 'btn_skip'), 'C|' + itemId + '|skip'), btn(t(ports, 'btn_other'), 'C|' + itemId + '|other')]];
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

function newItemCost(chatId, msgId, uid, itemId, arg, staff, ports) {
  var raw = getState(ports, uid), state = newItemStateOf(raw);
  if (!state || state.itemId !== itemId) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  msgId = newItemTapMsg(raw, state, msgId);
  if (state.form && state.step !== 'photo') {
    // The new-piece card (round 6): 🪙 opens the cost sub-screen (⏭ leaves the cost unknown); a cost sets the field.
    if (arg === 'other') {
      return newItemScreen(chatId, msgId, uid, state, ports, 'cost', newItemSeen(ports, state.draft) + '\n' + t(ports, 'item_ask_cost'),
        [btn(t(ports, 'btn_skip'), 'NI|' + itemId + '|back')]);
    }
    var cn = Math.round(Number(arg));
    state.draft.cost = arg !== 'skip' && cn >= 1 ? cn : '';
    return newItemCardShow(chatId, msgId, uid, state, staff, ports, '');
  }
  if (arg === 'other') {
    state.step = 'cost';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ask_number'));
  }
  var d = state.draft;
  var cost = arg === 'skip' ? '' : Number(arg);
  ports.store.updateItem(itemId, {
    name: d.name, category: d.category, type: CFG.ITEM_TYPE.UNIQUE, price: d.price === undefined ? '' : d.price, cost: cost,
    sample: !!d.sample, photoUrl: d.photoUrl || '', photoFileId: d.photoFileId || '', createdAt: ports.clock.now().toISOString(), createdBy: staff.id
  });
  var item = ports.store.getItem(itemId);
  commitRestock(ports, { item: item, qty: 1, staff: staff, source: CFG.SOURCE.PHOTO, note: d.sample ? 'new sample' : 'new item' });
  clearState(ports, uid);
  setLastItem(ports, uid, itemId);
  if (msgId) ports.chat.editMessage(chatId, msgId, t(ports, 'item_created') + ' · ' + itemId, [], false);
  else ports.chat.sendMessage(chatId, t(ports, 'item_created') + ' · ' + itemId);
  var fresh = ports.store.getItem(itemId);
  if (isPricePending(fresh)) notifyOwners(ports, t(ports, 'price_ask_owner', { id: itemId, name: fresh.name }), priceButtons(ports, fresh));
  return sendItemCard(chatId, fresh, staff, ports);
}

function priceButtons(ports, item) {
  var presets = pricePresets(ports, item.category, item.shop).map(function (p) { return btn(fmtMoney(p), 'SP|' + item.id + '|' + p); });
  return [presets, [btn(t(ports, 'btn_other'), 'SP|' + item.id + '|other')]];
}

function setPrice(chatId, msgId, uid, itemId, arg, staff, ports) {
  var item = ports.store.getItem(itemId);
  if (!item) return ports.chat.sendMessage(chatId, t(ports, 'tag_not_found', { id: itemId }));
  if (arg === 'ask') return ports.chat.sendMessage(chatId, t(ports, 'price_ask_owner', { id: itemId, name: item.name }), priceButtons(ports, item));
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'set_price', itemId: itemId });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_number'), [], false);
  }
  return applyPrice(chatId, msgId, itemId, Number(arg), staff, ports);
}

function applyPrice(chatId, msgId, itemId, price, staff, ports) {
  ports.store.updateItem(itemId, { price: price });
  var item = ports.store.getItem(itemId);
  var text = t(ports, 'price_set', { id: itemId, price: fmtMoney(price) });
  if (msgId) ports.chat.editMessage(chatId, msgId, text, [], false); else ports.chat.sendMessage(chatId, text);
  return sendItemCard(chatId, item, staff, ports);
}

function notifyOwners(ports, text, kb) {
  ports.store.listStaff().forEach(function (s) {
    if (s.role !== 'owner') return;
    try { ports.chat.sendMessage(s.id, text, kb); } catch (err) { ports.store.logError('notifyOwners', err, '', s.id); }
  });
}

/* ------------------------------ notebook photo import ------------------------------ */

function startNotebook(chatId, uid, staff, ports) {
  if (!aiOn(ports) || !settingOn(ports, 'notebook_import')) return ports.chat.sendMessage(chatId, t(ports, 'nb_off'));
  setState(ports, uid, { kind: 'notebook' });
  return ports.chat.sendMessage(chatId, t(ports, 'nb_ask_photo'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
}

function handleNotebookPhoto(chatId, uid, fileId, staff, updateId, ports) {
  clearState(ports, uid);
  ports.chat.typing(chatId);
  var lines;
  try {
    var itemNames = ports.store.listItems(staff.shop).filter(function (it) { return it.status !== CFG.STATUS.BLANK; })
      .map(function (it) { return it.name; }).slice(0, 150);
    lines = ports.ai.readNotebook(ports.chat.getFile(fileId), { shop: staff.shop, itemNames: itemNames, categories: itemCategoryAi(ports, staff.shop).names });
  } catch (err) {
    ports.store.logError('notebook', err, updateId, '');
    return ports.chat.sendMessage(chatId, t(ports, 'ai_down'));
  }
  if (!lines || !lines.length) return ports.chat.sendMessage(chatId, t(ports, 'nb_none'));
  lines.slice(0, CFG.NOTEBOOK_MAX_LINES).forEach(function (line, i) { presentNotebookLine(chatId, uid, line, i + 1, staff, updateId, ports); });
}

function presentNotebookLine(chatId, uid, line, n, staff, updateId, ports) {
  var raw = line.raw || '';
  var heard = t(ports, 'nb_line', { n: myDigits(n), raw: raw }) + '\n';
  if (!line.item_hint && !line.qty && !line.amount && !line.unit_price) return ports.chat.sendMessage(chatId, heard + t(ports, 'not_understood'));
  var ranked = rankItemsByName(ports, staff.shop, line.item_hint || raw);
  if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
    return propose(chatId, uid, notebookProposal(line, ranked[0].it.id, updateId), heard, ports);
  }
  if (ranked.length) {
    var token = ports.uuid().replace(/-/g, '').slice(0, 10);
    ports.cache.put('nb:' + token, JSON.stringify(line), CFG.CONFIRM_TTL_SEC);
    var rows = ranked.slice(0, 4).map(function (x) { return [btn(itemEmoji(ports, x.it) + ' ' + x.it.id + ' · ' + x.it.name, 'NB|' + token + '|' + x.it.id)]; });
    rows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
    return ports.chat.sendMessage(chatId, t(ports, 'nb_which', { n: myDigits(n), raw: raw }), rows);
  }
  return ports.chat.sendMessage(chatId, heard + t(ports, 'find_none'));
}

function notebookProposal(line, itemId, updateId) {
  return {
    kind: CFG.INTENT.SALE, itemId: itemId, qty: line.qty || 1,
    unitPrice: nullish(line.unit_price) ? null : line.unit_price, amount: nullish(line.amount) ? null : line.amount,
    paid: null, customer: line.customer || null, source: CFG.SOURCE.NOTEBOOK, transcript: line.raw || '', updateId: updateId, note: line.note || ''
  };
}

function notebookPick(chatId, msgId, uid, token, itemId, staff, updateId, ports) {
  var lj = ports.cache.get('nb:' + token);
  if (!lj) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  ports.cache.remove('nb:' + token);
  var line = JSON.parse(lj);
  ports.chat.editMessage(chatId, msgId, t(ports, 'nb_line', { n: '', raw: line.raw || '' }), [], false);
  return propose(chatId, uid, notebookProposal(line, itemId, updateId), '', ports);
}

/* ------------------------------ the sale review card and the new-piece card (round 6) ------------------------------ */
/*
 * Settings sale_flow = form. In the app (ports.ui.openForm: formsInApp) every way into a sale, a new piece, a restock or
 * an expense opens the app's form (startSaleFor, openTag, case 'R', startExpense, menuAction 'restock'); the core clears
 * its state and sends nothing. In Telegram (no ports.ui) a sale is ONE message, the review card (basketCardText /
 * basketCardKeyboard): the lines of the basket, the buyer, how paid, what is paid now and the promised day, each with its
 * default filled in; its buttons open sub-screens drawn on the card's own message (with its isCaption), every sub-screen
 * ends with ⏮ alone, and ✅ သိမ်း (SC|<a>|ok) is the one write (basketCommitDraft -> commitBasket, shared with the app).
 * The state (st:<uid>, CFG.STATE_TTL_SEC):
 *   { kind: 'sale', step: 'card' | 'line' | 'add' | 'buyer' | 'name' | 'phone' | 'method' | 'account' | 'bank' | 'paid' |
 *     'due' | 'due_text' | 'kind', item: <the anchor: the item the card was opened on>, msgId, cap: <msgId is a photo
 *     message>, line: <the open line's item id>, acct: 'bank' | 'wallet' | 'all', undo: {method, mixed, bankPart} (the payment
 *     when o|method opened how paid; ⏮ from there to the card restores it), paused, resume: <the item card that carries
 *     ➕ စာရင်းထဲ ထည့်>, draft: {lines: [{id, qty, unitPrice, priceChanged}], customerId, newName, newPhone, method, mixed,
 *     bankPart, part, paid, dueDay, addLabel, addedKey} }
 * The typed prompts wrap it ({kind: 'await_number', purpose: 'sale_step' | 'sale_qty' | 'sale_price', saved}) and ➕ wraps it
 * with resume SSA; saleStateOf reads through them. A typed answer has no tapped message: the next screen is a new message
 * and state.msgId moves to it (saleShow). Stale taps (saleGuard): (a) no basket state for this anchor -> the message reads
 * expired and a fresh item card follows (a sold card is never edited: expired is a new message); (b) an older message than
 * the live card -> expired, the basket untouched (while paused, i|<id> on state.resume and go on state.msgId are the
 * exceptions); (c) a letter that does not belong to the open sub-screen -> ignored, no edit. A scan without ➕ pauses the
 * card (basketPause); only a new sale closes it (basketClose). Settings sale_flow = quick keeps the one-tap card exactly.
 */

var SALE_STEP_OF = { q: 'line', qn: 'line', pr: 'line', rm: 'line', o: 'card', l: 'card', add: 'card', i: 'add',
  b: 'buyer', ph: 'phone', m: 'method', a: 'account', x: 'bank', p: 'paid', d: 'due', k: 'kind' };
// Where ⏮ goes from each sub-screen: the card, or the sub-screen above it.
var SALE_PARENT = { line: 'card', add: 'card', buyer: 'card', name: 'buyer', phone: 'buyer', method: 'card',
  account: 'method', bank: 'method', kind: 'method', paid: 'card', due: 'card', due_text: 'due' };

/** The app with its forms: Settings sale_flow = form and a phone whose ports carry ui.openForm (Telegram has no ports.ui). */
function formsInApp(ports) {
  return saleFlow(ports) === CFG.SALE_FLOW.FORM && !!(ports.ui && ports.ui.openForm);
}

/** The app's own pages (buyers, receipt, history), in both sale modes: a phone whose ports carry ui.openScreen. */
function screensInApp(ports) {
  return !!(ports.ui && ports.ui.openScreen);
}

/** The view hint of an app message (spec 13.9) as the chat port's extra argument, or null (Telegram gets no extra argument). */
function viewOf(ports, view) {
  return view && screensInApp(ports) ? { view: view } : null;
}

/** sendMessage with the view hint in the app; in Telegram exactly the call of before. */
function sendView(ports, chatId, text, kb, view) {
  var x = viewOf(ports, view);
  return x ? ports.chat.sendMessage(chatId, text, kb || [], x) : ports.chat.sendMessage(chatId, text, kb);
}

/** What a tap or a typed answer knows: the chat, the tapped message (null when typed) and whether it is a photo card. */
function saleCtx(chatId, uid, staff, updateId, ports, msgId, isCaption) {
  return { chatId: chatId, msgId: msgId || null, isCaption: !!isCaption, uid: uid, staff: staff, updateId: updateId, ports: ports };
}

/**
 * The message a screen now sits on, from what editOrSend (or editMessage) returned: a new message's id; an edit that could
 * not be made and was sent as a new message instead (gas_telegram.js, a 429 or a network error) returns that message's id
 * too; a plain edit returns nothing and the screen is still the tapped message.
 */
function saleShownId(ctx, r) {
  return (r && r.messageId) || ctx.msgId || null;
}

/** Where the card now is: state.msgId, and state.cap (a new message is a text message; an edit keeps the tapped one's kind). */
function saleShow(state, ctx, r) {
  state.msgId = saleShownId(ctx, r);
  state.cap = !(r && r.messageId) && !!ctx.isCaption;
}

/**
 * Settings sale_due_presets ("7,14,30"): whole numbers of days from 1 to CFG.SALE_DUE_MAX_DAYS only (the bound a typed
 * date has), else CFG.SALE_DUE_PRESETS. Parsed here (run_sync loads no core_orders).
 */
function saleDuePresets(ports) {
  var raw = String(ports.store.getSetting('sale_due_presets', '') || '');
  var list = raw.split(',').map(function (x) { return Number(String(x).trim()); }).filter(function (n) {
    return isFinite(n) && n === Math.round(n) && n >= 1 && n <= CFG.SALE_DUE_MAX_DAYS;
  });
  return list.length ? list : CFG.SALE_DUE_PRESETS.slice();
}

/** The basket state behind the cached state: the state itself, or the saved one of a prompt opened from the card; else null. */
function saleStateOf(ports, uid) {
  var s = getState(ports, uid);
  if (!s) return null;
  if (s.kind === 'sale') return s;
  var nested = (s.kind === 'await_number' && (s.purpose === 'sale_step' || s.purpose === 'sale_qty' || s.purpose === 'sale_price')) ||
    (s.kind === 'await_text' && s.purpose === 'add_option' && !!s.resume && s.resume.a === 'SSA');
  return nested && s.saved && s.saved.kind === 'sale' ? s.saved : null;
}

/** basketTotals of a basket state's draft. */
function basketTotalsOf(state) {
  var d = state.draft || {};
  return basketTotals(d.lines || [], { part: !!d.part, paid: d.paid, method: d.method, mixed: d.mixed, bankPart: d.bankPart });
}

/** The index of an item's line in a draft, or -1. */
function basketLineIndex(draft, id) {
  var lines = (draft && draft.lines) || [];
  for (var i = 0; i < lines.length; i++) if (lines[i].id === id) return i;
  return -1;
}

/** Is the piece a line of the basket? */
function basketHasItem(state, id) {
  return !!state && basketLineIndex(state.draft, id) >= 0;
}

/** Something is owed and nobody is named: the buyer sub-screen shows its need-buyer view and the card its hint line. */
function basketNeedBuyer(state) {
  var d = state.draft || {};
  return basketTotalsOf(state).owed > 0 && !d.customerId && !d.newName;
}

/**
 * The stale-tap rules (a)-(c) above. step null skips (c); message = cq.message (its text or caption tells a sold card).
 * Answers expired itself and returns null, or returns the basket state (the saved one behind a prompt).
 */
function saleGuard(ctx, item, step, message) {
  var ports = ctx.ports, state = saleStateOf(ports, ctx.uid);
  if (!state || state.item !== item.id) {
    if (saleSoldCard(ctx, message)) {
      ports.chat.sendMessage(ctx.chatId, t(ports, 'expired'));
      return null;
    }
    ports.chat.editMessage(ctx.chatId, ctx.msgId, t(ports, 'expired'), [], ctx.isCaption);
    sendItemCard(ctx.chatId, ports.store.getItem(item.id) || item, ctx.staff, ports);
    return null;
  }
  if (state.msgId && ctx.msgId && state.msgId !== ctx.msgId) {
    // A sold card is never edited: a late tap on it (one that raced the commit) while a newer basket is live is ignored.
    if (!saleSoldCard(ctx, message)) ports.chat.editMessage(ctx.chatId, ctx.msgId, t(ports, 'expired'), [], ctx.isCaption);
    return null;
  }
  if (step && state.step !== step) return null;
  return state;
}

/**
 * Is the tapped message a sold card: committed within 600 s (isCommittedCard), or its text or caption shows sold_done up
 * to its first '{' (for ever; basket_sold starts with the same words)? A late tap never edits it (saleGuard, saleCancel).
 */
function saleSoldCard(ctx, message) {
  var shown = String((message && (message.caption || message.text)) || '');
  var soldMark = msgTemplate(ctx.ports, 'sold_done').split('{')[0].trim();
  return isCommittedCard(ctx.ports, ctx.chatId, ctx.msgId) || (!!soldMark && shown.indexOf(soldMark) >= 0);
}

/**
 * S|<id>|n, Q|, QN|, D| and their typed answers in form mode: the first line of a sale. Refused by basketAddItem (a UNIQUE
 * sold meanwhile answers sale_gone, another shop's tag basket_other_shop, ...): the tapped message (or a new one) becomes
 * the item card with the reason under it, no state. opts = {unitPrice, priceChanged, price}: a bargained price for the
 * line, price = open the line's price keypad (the app). In the app the sale form opens; in Telegram the review card.
 */
function startSaleFor(ctx, item, qty, opts) {
  opts = opts || {};
  var ports = ctx.ports, add = basketAddItem(ports, ctx.staff, [], item.id, qty);
  if (!add.ok) {
    var fresh = ports.store.getItem(item.id) || item;
    var line = add.reason === 'gone' ? t(ports, 'sale_gone') : t(ports, BASKET_REASON_KEY[add.reason], add.vars);
    clearState(ports, ctx.uid);
    return editOrSend(ports, ctx.chatId, ctx.msgId, cardText(ports, fresh) + '\n' + line, cardKeyboard(ports, fresh), ctx.isCaption,
      { kind: 'item', id: fresh.id, extra: [line] });
  }
  var lines = add.lines;
  if (!nullish(opts.unitPrice)) {
    lines[0].unitPrice = Number(opts.unitPrice);
    lines[0].priceChanged = opts.priceChanged !== false;
  }
  if (formsInApp(ports)) {
    clearState(ports, ctx.uid);
    setLastItem(ports, ctx.uid, item.id);
    return ports.ui.openForm('sale', { chatId: ctx.chatId, uid: ctx.uid, staff: ctx.staff, itemId: item.id, qty: lines[0].qty,
      unitPrice: nullish(opts.unitPrice) ? null : Number(opts.unitPrice), priceChanged: !nullish(opts.unitPrice) && opts.priceChanged !== false,
      focus: opts.price ? 'price' : '' });
  }
  return startBasket(ctx, item, lines);
}

/**
 * The review card of a new basket. A second identical tap on the message that already shows this one-line card makes no
 * edit. Another live basket (paused or not) is closed first (basketClose): a new sale replaces it.
 */
function startBasket(ctx, item, lines) {
  var ports = ctx.ports, cur = saleStateOf(ports, ctx.uid);
  if (cur && cur.item === item.id && cur.step === 'card' && !cur.paused && ctx.msgId && cur.msgId === ctx.msgId &&
      JSON.stringify(cur.draft.lines) === JSON.stringify(lines)) return;
  if (cur) basketClose(ports, ctx.chatId, ctx.uid, ctx.msgId);
  var state = { kind: 'sale', step: 'card', item: item.id, msgId: ctx.msgId, cap: !!ctx.isCaption, line: '', draft: { lines: lines } };
  setLastItem(ports, ctx.uid, item.id);
  return saleRedraw(ctx, state, {}, '');
}

/**
 * A live Telegram basket ends without a write: its card's message reads basket_closed with no buttons (isCaption =
 * state.cap) and the state is cleared. Called when another sale starts (and before a blank tag's new-piece state); a scan
 * of another piece never closes it (basketPause). keepMsgId: the message about to show the new card is not edited first.
 */
function basketClose(ports, chatId, uid, keepMsgId) {
  if (formsInApp(ports)) return;
  var st = saleStateOf(ports, uid);
  if (!st) return;
  if (st.msgId && st.msgId !== keepMsgId) ports.chat.editMessage(chatId, st.msgId, t(ports, 'basket_closed'), [], !!st.cap);
  clearState(ports, uid);
}

/**
 * A scan (or a typed tag) without ➕ while a basket card is live (spec 2.2): the card's message reads basket_paused with one
 * button ↪️ (SS|<a>|go), every line, the buyer and the payment are kept, and the scanned piece's item card comes as today,
 * with a first row ➕ စာရင်းထဲ ထည့် (SS|<a>|i|<id>) when basketAddItem accepts the piece (a stock item already a line too:
 * its tap raises that line by one, the add screen's merge); that card is remembered as state.resume.
 */
function basketPause(ctx, state, item) {
  var ports = ctx.ports, a = state.item;
  if (state.msgId && !state.paused) {
    ports.chat.editMessage(ctx.chatId, state.msgId, t(ports, 'basket_paused', { n: fmtCount(state.draft.lines.length) }),
      [[btn(t(ports, 'btn_resume'), 'SS|' + a + '|go')]], !!state.cap);
  }
  state.paused = true;
  var can = basketAddItem(ports, ctx.staff, state.draft.lines, item.id, 1).ok;
  var r = sendItemCard(ctx.chatId, item, ctx.staff, ports, can ? { addTo: { anchor: a } } : {});
  state.resume = r && r.messageId ? r.messageId : null;
  setState(ports, ctx.uid, state);
  return r;
}

/** The owner's 🧾 row on the card of a piece whose last live sale is a basket (its receipt offers 🚫 void); else none. */
function ownerBasketRow(ports, staff, item) {
  if (!staff || staff.role !== 'owner' || !item) return [];
  var s = lastLiveSale(ports, item.id), info = s ? saleGroupInfo(ports, s.groupId) : null;
  return basketGroup(info) && !info.voided ? [[btn(t(ports, 'btn_receipt'), 'RC|' + info.groupId)]] : [];
}

/** The two lines on top of every sub-screen: the basket's title and its total (opts.paid: the paid-now line of a part payment). */
function basketHead(ports, state, opts) {
  var d = state.draft || {}, T = basketTotalsOf(state);
  var lines = [t(ports, 'basket_title', { n: fmtCount((d.lines || []).length) }), t(ports, 'basket_total', { total: fmtMoney(T.total) })];
  if (opts && opts.paid && d.part) lines.push(t(ports, 'sale_line_paid', { paid: fmtMoney(T.paid), owed: fmtMoney(T.owed) }));
  return lines.join('\n');
}

/** One line of the card: '1. 🧣 S1-0002 · name × ၂ · 36,000' (' 💬' when bargained; a pending price shows btn_pending). */
function basketCardLine(ports, l, i) {
  var it = ports.store.getItem(l.id), name = it ? String(it.name || l.id) : String(l.id);
  if (name.length > CFG.BASKET_NAME_MAX) name = name.slice(0, CFG.BASKET_NAME_MAX - 1) + '…';
  var pending = nullish(l.unitPrice) || l.unitPrice === '';
  var amount = pending ? t(ports, 'btn_pending') : fmtMoney(Math.max(1, Math.round(Number(l.qty) || 1)) * Number(l.unitPrice));
  return t(ports, 'basket_card_line', { n: String(i + 1), emoji: itemEmoji(ports, it || {}), id: l.id, name: name,
    qty: fmtCount(l.qty), amount: amount }) + (l.priceChanged && !pending ? ' 💬' : '');
}

/** The buyer line of the card: the customer, a typed new name (and phone), or btn_no_name. */
function basketBuyerLine(ports, d) {
  if (d.customerId) {
    var c = ports.store.getCustomer(d.customerId);
    if (c) return customerLabel(c);
  }
  if (d.newName) return '👤 ' + d.newName + (d.newPhone ? ' · ' + fmtPhone(d.newPhone) : '');
  return t(ports, 'btn_no_name');
}

/** The review card's text (spec 2.1); prefix = a refusal line on top. */
function basketCardText(ports, state, prefix) {
  var d = state.draft || {}, T = basketTotalsOf(state), lines = [];
  lines.push(t(ports, 'basket_title', { n: fmtCount((d.lines || []).length) }));
  (d.lines || []).forEach(function (l, i) { lines.push(basketCardLine(ports, l, i)); });
  lines.push(t(ports, 'basket_total', { total: fmtMoney(T.total) }));
  lines.push(basketBuyerLine(ports, d));
  if (d.mixed && T.bankPart > 0) {
    lines.push(t(ports, 'sale_line_mixed', { cashMethod: methodLabel(ports, CFG.METHOD.CASH), cash: fmtMoney(T.paid - T.bankPart),
      method: methodLabel(ports, d.method), bank: fmtMoney(T.bankPart) }));
  } else {
    lines.push(t(ports, 'sale_line_method', { method: methodLabel(ports, T.payKey) }));
  }
  lines.push(t(ports, 'sale_line_paid', { paid: fmtMoney(T.paid), owed: fmtMoney(T.owed) }));
  if (T.owed > 0) {
    if (nullish(d.dueDay)) lines.push(t(ports, 'sale_ask_due', { owed: fmtMoney(T.owed) }));
    else if (d.dueDay === '') lines.push(t(ports, 'sale_due_none'));
    else lines.push(t(ports, 'sale_due_set', { owed: fmtMoney(T.owed), date: fmtDayMy(d.dueDay) }));
    if (!d.customerId && !d.newName) lines.push(t(ports, 'sale_need_buyer'));
  }
  return withPrefix(prefix, lines.join('\n'));
}

/** The review card's buttons (spec 2.1): the lines two per row, ➕, buyer and how paid, the payment row, ✅, then ✖️ alone. */
function basketCardKeyboard(ports, state) {
  var a = state.item, d = state.draft || {}, kb = [], row = [];
  (d.lines || []).forEach(function (l, i) {
    row.push(btn(t(ports, 'btn_card_line', { n: String(i + 1), id: l.id, qty: fmtCount(l.qty) }), 'SS|' + a + '|l|' + l.id));
    if (row.length === 2) { kb.push(row); row = []; }
  });
  if (row.length) kb.push(row);
  if ((d.lines || []).length < CFG.BASKET_MAX_LINES) kb.push([btn(t(ports, 'btn_add_item'), 'SS|' + a + '|add')]);
  kb.push([btn(t(ports, 'btn_customer'), 'SS|' + a + '|o|buyer'), btn(t(ports, 'sale_ask_method'), 'SS|' + a + '|o|method')]);
  if (!d.part) kb.push([btn(t(ports, 'btn_credit'), 'SS|' + a + '|o|paid')]);
  else kb.push([btn(t(ports, 'btn_paid_now'), 'SS|' + a + '|o|paid'), btn(t(ports, 'btn_due'), 'SS|' + a + '|o|due')]);
  kb.push([btn(t(ports, 'btn_save'), 'SC|' + a + '|ok')]);
  kb.push([btn(t(ports, 'btn_cancel'), 'SS|' + a + '|z')]);
  return kb;
}

/** Into a step: the step is set and its screen drawn; back on the card the how-paid snapshot and the open line are dropped. */
function saleGo(ctx, state, step, prefix, opts) {
  state.step = step;
  if (step === 'card') { delete state.undo; state.line = ''; }
  return saleRedraw(ctx, state, opts || {}, prefix);
}

/**
 * Draw the screen of state.step on the tapped message (or as a new message), remember where it is (saleShow), store the
 * state: a screen that takes a typed number at entry (the transfer part) is stored as the number prompt around it.
 */
function saleRedraw(ctx, state, opts, prefix) {
  var ports = ctx.ports, item = ports.store.getItem(state.item);
  if (!item) {
    clearState(ports, ctx.uid);
    return editOrSend(ports, ctx.chatId, ctx.msgId, t(ports, 'tag_not_found', { id: state.item }), [], ctx.isCaption);
  }
  var scr = saleScreenFor(ports, ctx.staff, item, state, opts || {});
  var r = editOrSend(ports, ctx.chatId, ctx.msgId, withPrefix(prefix, scr.text), scr.kb, ctx.isCaption);
  saleShow(state, ctx, r);
  if (scr.await) setState(ports, ctx.uid, { kind: 'await_number', purpose: scr.await, saved: state });
  else setState(ports, ctx.uid, state);
  return true;
}

/**
 * After the paid, buyer and due answers (spec 2.1): while something is owed and nobody is named, the buyer sub-screen in its
 * need-buyer view; then, while owed and no promised day is chosen, the due sub-screen; else the card.
 */
function basketNext(ctx, state, prefix) {
  var d = state.draft || {}, T = basketTotalsOf(state);
  if (T.owed > 0 && !d.customerId && !d.newName) return saleGo(ctx, state, 'buyer', prefix);
  if (T.owed > 0 && nullish(d.dueDay)) return saleGo(ctx, state, 'due', prefix);
  return saleGo(ctx, state, 'card', prefix);
}

/** The account step's exit (also after ➕ named an account or x|half): the transfer part when mixed and not yet set, else the card. */
function saleAfterAccount(ctx, state, prefix) {
  var d = state.draft;
  return saleGo(ctx, state, d.mixed && !(Number(d.bankPart) >= 1) ? 'bank' : 'card', prefix);
}

/** The last row of every sub-screen and of a typed prompt opened from one: ⏮ back from this step, alone (no ✖️ here). */
function saleBackRow(ports, item, step) {
  return [btn(t(ports, 'btn_back'), 'SS|' + item.id + '|back|' + step)];
}

/** The screens, one per step: {text, kb, await}. opts.page (accounts), opts.look (the buyer's look-alikes), opts.found / opts.none (add). */
function saleScreenFor(ports, staff, item, state, opts) {
  switch (state.step) {
    case 'line': return saleScreenLine(ports, staff, item, state, opts);
    case 'add': return saleScreenAdd(ports, staff, item, state, opts);
    case 'buyer': return opts.look ? saleScreenLookalikes(ports, staff, item, state, opts) : saleScreenBuyer(ports, staff, item, state, opts);
    case 'name': return saleScreenName(ports, staff, item, state, opts);
    case 'phone': return saleScreenPhone(ports, staff, item, state, opts);
    case 'method': return saleScreenMethod(ports, staff, item, state, opts);
    case 'account': return saleScreenAccount(ports, staff, item, state, opts);
    case 'bank': return saleScreenBankPart(ports, staff, item, state, opts);
    case 'paid': return saleScreenPaid(ports, staff, item, state, opts);
    case 'due': return saleScreenDue(ports, staff, item, state, opts);
    case 'due_text': return saleScreenDueText(ports, staff, item, state, opts);
    case 'kind': return saleScreenKind(ports, staff, item, state, opts);
    default: return { text: basketCardText(ports, state), kb: basketCardKeyboard(ports, state) };
  }
}

/** A line (l|<id>): its card line; a stock item asks its count (1..9, ✏️); every line has 💬 a price and, with 2+ lines, 🗑. */
function saleScreenLine(ports, staff, item, state, opts) {
  var d = state.draft, i = basketLineIndex(d, state.line), l = d.lines[i];
  if (!l) return { text: basketCardText(ports, state), kb: basketCardKeyboard(ports, state) };
  var it = ports.store.getItem(l.id), sku = !!it && it.type !== CFG.ITEM_TYPE.UNIQUE, a = item.id, kb = [], row = [];
  var text = basketHead(ports, state) + '\n' + basketCardLine(ports, l, i) + (sku ? '\n' + t(ports, 'ask_qty') : '');
  if (sku) {
    [1].concat(CFG.QTY_GRID).forEach(function (n) {
      row.push(btn(myDigits(n), 'SS|' + a + '|q|' + n));
      if (row.length === 4) { kb.push(row); row = []; }
    });
    if (row.length) kb.push(row);
  }
  var tools = sku ? [btn(t(ports, 'btn_type_qty'), 'SS|' + a + '|qn')] : [];
  tools.push(btn(t(ports, 'btn_discount'), 'SS|' + a + '|pr'));
  kb.push(tools);
  if (d.lines.length > 1) kb.push([btn(t(ports, 'btn_remove_line'), 'SS|' + a + '|rm|' + l.id)]);
  kb.push(saleBackRow(ports, item, 'line'));
  return { text: text, kb: kb };
}

/**
 * ➕ (add): scan the next tag or type its number; up to four recent pieces of the basket's shop that can join (not already
 * a line) as i|<id> rows; after a typed name, up to four of its matches (opts.found) or find_none above the question (opts.none).
 */
function saleScreenAdd(ports, staff, item, state, opts) {
  var d = state.draft, a = item.id, kb = [];
  var list = opts.found || recentItems(ports, item.shop, 6);
  list.forEach(function (it) {
    if (kb.length >= 4 || basketHasItem(state, it.id) || !basketAddItem(ports, staff, d.lines, it.id, 1).ok) return;
    kb.push([btn(itemEmoji(ports, it) + ' ' + it.id + ' · ' + it.name, 'SS|' + a + '|i|' + it.id)]);
  });
  kb.push(saleBackRow(ports, item, 'add'));
  return { text: basketHead(ports, state) + '\n' + (opts.none ? t(ports, 'find_none') + '\n' : '') + t(ports, 'basket_add_ask'), kb: kb };
}

/** The buyer: 🚫 (not in the need-buyer view), up to four recent buyers of the basket's shop, ✏️ a new name; typing searches. */
function saleScreenBuyer(ports, staff, item, state, opts) {
  var need = basketNeedBuyer(state), lines = [basketHead(ports, state)], kb = [];
  if (need) lines.push(t(ports, 'sale_need_buyer'));
  lines.push(t(ports, 'credit_ask_customer'));
  lines.push(t(ports, 'cust_find'));
  if (!need) kb.push([btn(t(ports, 'btn_no_name'), 'SS|' + item.id + '|b|none')]);
  recentCustomers(ports, item.shop, 4).forEach(function (c) {
    var data = 'SS|' + item.id + '|b|' + c.id;
    if (utf8ByteLength(data) <= 64) kb.push([btn(customerLabel(c), data)]);
  });
  kb.push([btn(t(ports, 'btn_new_customer'), 'SS|' + item.id + '|b|new')]);
  kb.push(saleBackRow(ports, item, 'buyer'));
  return { text: lines.join('\n'), kb: kb };
}

/** The look-alikes of a typed name (or the partial matches of a typed phone: opts.look.phoneForm, no create button). */
function saleScreenLookalikes(ports, staff, item, state, opts) {
  var look = opts.look || {}, name = look.name || state.draft.newName || '';
  var kb = (look.matches || []).slice(0, 4).map(function (c) { return [btn(customerLabel(c), 'SS|' + item.id + '|b|' + c.id)]; });
  if (!look.phoneForm) kb.push([btn(t(ports, 'btn_create_named', { name: name }), 'SS|' + item.id + '|b|create')]);
  kb.push(saleBackRow(ports, item, 'buyer'));
  return { text: basketHead(ports, state) + '\n' + t(ports, 'cust_pick', { name: name }), kb: kb };
}

function saleScreenName(ports, staff, item, state, opts) {
  return { text: basketHead(ports, state) + '\n' + t(ports, 'ask_name'), kb: [saleBackRow(ports, item, 'name')] };
}

/** The phone of a new buyer; skip is a step answer. */
function saleScreenPhone(ports, staff, item, state, opts) {
  return { text: basketHead(ports, state) + '\n' + t(ports, 'ord_ask_phone', { customer: state.draft.newName || '' }),
    kb: [[btn(t(ports, 'btn_skip'), 'SS|' + item.id + '|ph|skip')], saleBackRow(ports, item, 'phone')] };
}

/**
 * How paid: 💵, the wallets by name while the screen fits six answers (else one 📲 Pay အကောင့် row that opens the wallets
 * list), 🏛 ဘဏ် when a bank-kind account exists, 💵+🏦 when any non-cash account exists and the total can be split, ➕.
 */
function saleScreenMethod(ports, staff, item, state, opts) {
  var total = basketTotals(state.draft.lines, {}).total, id = item.id;
  var byKind = payMethodsByKind(ports, item.shop);
  var W = byKind.wallets.length, B = byKind.banks.length ? 1 : 0, X = (W + byKind.banks.length > 0 && total >= 2) ? 1 : 0;
  var kb = [[btn(t(ports, 'btn_cash'), 'SS|' + id + '|m|CASH')]];
  if (W) {
    if (1 + W + B + X + 1 <= 6) {
      byKind.wallets.forEach(function (k) {
        var data = 'SS|' + id + '|m|' + k;
        if (utf8ByteLength(data) <= 64) kb.push([btn(t(ports, 'btn_wallet', { method: methodLabel(ports, k) }), data)]);
      });
    } else {
      kb.push([btn(t(ports, 'btn_kind_wallet'), 'SS|' + id + '|m|more')]);
    }
  }
  if (B) kb.push([btn(t(ports, 'btn_bank_transfer'), 'SS|' + id + '|m|bank')]);
  if (X) kb.push([btn(t(ports, 'btn_split'), 'SS|' + id + '|m|mix')]);
  kb.push([btn(t(ports, 'btn_add_bank'), 'LA|pm|SSA|' + id)]);
  kb.push(saleBackRow(ports, item, 'method'));
  return { text: basketHead(ports, state) + '\n' + t(ports, 'sale_ask_method'), kb: kb };
}

/** The keys the account screen lists: the banks, the wallets, or every non-cash account (mixed), in payMethods order. */
function saleAccountCandidates(ports, shop, acct) {
  var byKind = payMethodsByKind(ports, shop);
  if (acct === 'bank') return byKind.banks;
  if (acct === 'wallet') return byKind.wallets;
  return payMethods(ports, shop).filter(function (k) { return k !== CFG.METHOD.CASH; });
}

/** One account per row (🏦 banks, 📲 wallets), five at most, else pages of four with ▶️; then ➕. */
function saleScreenAccount(ports, staff, item, state, opts) {
  var d = state.draft, id = item.id, page = Math.max(0, Math.round(Number(opts.page) || 0));
  var byKind = payMethodsByKind(ports, item.shop), cands = saleAccountCandidates(ports, item.shop, state.acct);
  var kb = [], slice = cands, more = false;
  if (cands.length > 5) {
    slice = cands.slice(page * 4, page * 4 + 4);
    more = cands.length > (page + 1) * 4;
  }
  slice.forEach(function (k) {
    var data = 'SS|' + id + '|a|' + k;
    if (utf8ByteLength(data) > 64) return;
    var bank = byKind.banks.indexOf(k) >= 0;
    kb.push([btn(t(ports, bank ? 'btn_bank' : 'btn_wallet', { method: methodLabel(ports, k) }), data)]);
  });
  if (more) kb.push([btn(t(ports, 'btn_more'), 'SS|' + id + '|a|p' + (page + 1))]);
  kb.push([btn(t(ports, 'btn_add_bank'), 'LA|pm|SSA|' + id)]);
  kb.push(saleBackRow(ports, item, 'account'));
  return { text: basketHead(ports, state) + '\n' + t(ports, d.mixed ? 'sale_ask_split_account' : 'sale_ask_account'), kb: kb };
}

/** What is paid now: the amount of a part payment, else the total. */
function basketPaidNow(state) {
  var d = state.draft, T = basketTotalsOf(state);
  return d.part ? T.paid : T.total;
}

/** The transfer part of a mixed payment (at most what is paid now); the screen waits for a typed number, half is a button. */
function saleScreenBankPart(ports, staff, item, state, opts) {
  var d = state.draft, paid = basketPaidNow(state), half = Math.round(paid / 2), kb = [];
  var text = basketHead(ports, state) + '\n' + t(ports, 'split_ask_amount', { method: methodLabel(ports, d.method), cash: fmtMoney(paid) });
  if (half >= 1 && half < paid) kb.push([btn(t(ports, 'btn_half', { amount: fmtMoney(half) }), 'SS|' + item.id + '|x|half')]);
  kb.push(saleBackRow(ports, item, 'bank'));
  return { text: text, kb: kb, await: 'sale_step' };
}

/** What is paid now: 💯 the whole total (back to the card); 0 / half / ✏️ (mixed: the transfer part / half while larger / ✏️). */
function saleScreenPaid(ports, staff, item, state, opts) {
  var d = state.draft, total = basketTotals(d.lines, {}).total, half = Math.round(total / 2), id = item.id;
  var text = basketHead(ports, state) + '\n' + t(ports, 'sale_ask_paid', { total: fmtMoney(total) });
  var kb = [[btn(t(ports, 'btn_paid_full', { amount: fmtMoney(total) }), 'SS|' + id + '|p|all')]], row = [];
  if (d.mixed && Number(d.bankPart) > 0) {
    row.push(btn(fmtMoney(d.bankPart), 'SS|' + id + '|p|bank'));
    if (half > d.bankPart && half < total) row.push(btn(t(ports, 'btn_half', { amount: fmtMoney(half) }), 'SS|' + id + '|p|half'));
  } else {
    row.push(btn('0', 'SS|' + id + '|p|0'));
    if (half >= 1 && half < total) row.push(btn(t(ports, 'btn_half', { amount: fmtMoney(half) }), 'SS|' + id + '|p|half'));
  }
  row.push(btn(t(ports, 'btn_other'), 'SS|' + id + '|p|other'));
  kb.push(row);
  kb.push(saleBackRow(ports, item, 'paid'));
  return { text: text, kb: kb };
}

/** When is the rest paid: the first three presets as days, a typed date, not sure. */
function saleScreenDue(ports, staff, item, state, opts) {
  var owed = basketTotalsOf(state).owed, id = item.id;
  var text = basketHead(ports, state, { paid: true }) + '\n' + t(ports, 'sale_ask_due', { owed: fmtMoney(owed) });
  var days = saleDuePresets(ports).slice(0, 3).map(function (n) { return btn(t(ports, 'btn_days', { n: myDigits(n) }), 'SS|' + id + '|d|' + n); });
  var kb = [days, [btn(t(ports, 'btn_due_type'), 'SS|' + id + '|d|type'), btn(t(ports, 'btn_due_unknown'), 'SS|' + id + '|d|none')], saleBackRow(ports, item, 'due')];
  return { text: text, kb: kb };
}

function saleScreenDueText(ports, staff, item, state, opts) {
  return { text: basketHead(ports, state, { paid: true }) + '\n' + t(ports, 'ord_ask_due_text'), kb: [saleBackRow(ports, item, 'due_text')] };
}

/** The kind of the account named through ➕ (nothing is written before this answer). */
function saleScreenKind(ports, staff, item, state, opts) {
  var id = item.id;
  return { text: basketHead(ports, state) + '\n' + t(ports, 'sale_ask_kind', { label: state.draft.addLabel || '' }),
    kb: [[btn(t(ports, 'btn_kind_wallet'), 'SS|' + id + '|k|wallet'), btn(t(ports, 'btn_kind_bank'), 'SS|' + id + '|k|bank')], saleBackRow(ports, item, 'kind')] };
}

/**
 * SS|<a>|<letter>|<arg>: z cancels, back goes to the parent, go resumes a paused card, i adds a piece (on the add screen,
 * or from the item card a pause offered); every other letter passes the stale-tap rules with SALE_STEP_OF, then its handler.
 */
function basketCallback(ctx, parts, item, message) {
  var letter = String(parts[2] || ''), arg = parts[3];
  if (letter === 'z') return saleCancel(ctx, item, message);
  if (letter === 'go') return basketResume(ctx, item, message);
  if (letter === 'i') return basketPick(ctx, item, String(arg || ''), message);
  if (letter === 'back') {
    var bs = saleGuard(ctx, item, String(arg || ''), message);
    return bs && !bs.paused ? saleBack(ctx, bs, String(arg || '')) : undefined;
  }
  var step = SALE_STEP_OF[letter];
  if (!step) return;
  var state = saleGuard(ctx, item, step, message);
  if (!state || state.paused) return;
  var d = state.draft;
  switch (letter) {
    case 'o': return basketOpen(ctx, state, String(arg || ''));
    case 'l':
      if (basketLineIndex(d, String(arg || '')) < 0) return;
      state.line = String(arg);
      return saleGo(ctx, state, 'line', '');
    case 'add': return d.lines.length < CFG.BASKET_MAX_LINES ? saleGo(ctx, state, 'add', '') : undefined;
    case 'q': return saleQtyPick(ctx, state, item, arg);
    case 'qn': return basketLinePrompt(ctx, state, item, 'sale_qty', 'ask_qty_number');
    case 'pr': return basketLinePrompt(ctx, state, item, 'sale_price', 'ask_sale_price');
    case 'rm': {
      var at = basketLineIndex(d, String(arg || ''));
      if (at < 0 || d.lines.length < 2) return;
      d.lines.splice(at, 1);
      return saleGo(ctx, state, 'card', '');
    }
    case 'b': return saleBuyerPick(ctx, state, item, arg);
    case 'ph': return arg === 'skip' ? salePhoneSkip(ctx, state, item) : undefined;
    case 'm': return saleMethodPick(ctx, state, item, arg);
    case 'a':
      if (/^p\d+$/.test(String(arg || ''))) return saleRedraw(ctx, state, { page: Number(String(arg).slice(1)) });
      return saleAccountPick(ctx, state, item, arg);
    case 'x': return arg === 'half' ? saleBankHalf(ctx, state, item) : undefined;
    case 'p': return salePaidPick(ctx, state, item, arg);
    case 'd': return saleDuePick(ctx, state, item, arg);
    case 'k': return saleKindPick(ctx, state, item, arg);
    default: return;
  }
}

/** o|<buyer|method|paid|due> on the card: the sub-screen (how paid remembers the payment as it was, for ⏮). */
function basketOpen(ctx, state, what) {
  var d = state.draft;
  if (what === 'buyer') return saleGo(ctx, state, 'buyer', '');
  if (what === 'method') {
    state.undo = { method: d.method || '', mixed: !!d.mixed, bankPart: nullish(d.bankPart) ? null : d.bankPart, acct: state.acct || '' };
    return saleGo(ctx, state, 'method', '');
  }
  if (what === 'paid') return saleGo(ctx, state, 'paid', '');
  if (what === 'due' && d.part) return saleGo(ctx, state, 'due', '');
}

/** qn / pr on a line: the typed count or price prompt replaces the line screen in place, with the line's ⏮. */
function basketLinePrompt(ctx, state, item, purpose, key) {
  var ports = ctx.ports, l = state.draft.lines[basketLineIndex(state.draft, state.line)];
  if (!l) return;
  var it = ports.store.getItem(l.id);
  if (purpose === 'sale_qty' && (!it || it.type === CFG.ITEM_TYPE.UNIQUE)) return;
  var r = editOrSend(ports, ctx.chatId, ctx.msgId, basketHead(ports, state) + '\n' + t(ports, key), [saleBackRow(ports, item, 'line')], ctx.isCaption);
  saleShow(state, ctx, r);
  setState(ports, ctx.uid, { kind: 'await_number', purpose: purpose, itemId: l.id, saved: state });
  return r;
}

/** go on the paused card: the card is drawn there again, unpaused (an older paused card's ↪️ answers expired by rule (b)). */
function basketResume(ctx, item, message) {
  var state = saleGuard(ctx, item, null, message);
  if (!state || !state.paused) return;
  delete state.paused;
  delete state.resume;
  return saleGo(ctx, state, 'card', '');
}

/**
 * i|<id>: on the add screen (its recent or found rows), or on the item card a pause offered (state.resume; an older one
 * answers expired). The tapped message becomes the card with the piece added (or the refusal on top).
 */
function basketPick(ctx, item, id, message) {
  var ports = ctx.ports, live = saleStateOf(ports, ctx.uid), it = ports.store.getItem(id);
  if (live && live.item === item.id && live.paused && live.resume && ctx.msgId === live.resume) {
    return it ? basketAddScanned(ctx, live, it, { tapped: true }) : undefined;
  }
  var state = saleGuard(ctx, item, 'add', message);
  if (!state || state.paused || !it) return;
  return basketAddScanned(ctx, state, it, { tapped: true });
}

/**
 * A piece into the basket (spec 2.2): a scan or a typed id at the add screen, or an i|<id> tap. Accepted or refused (its
 * reason on top of the card, the basket kept): after a tap the tapped message becomes the card; after a scan or a typed id
 * the add screen's message reads basket_moved with no buttons and the card comes back as a new message.
 */
function basketAddScanned(ctx, state, item, opts) {
  var ports = ctx.ports, prefix = '';
  var add = basketAddItem(ports, ctx.staff, state.draft.lines, item.id, 1);
  if (add.ok) state.draft.lines = add.lines;
  else prefix = t(ports, BASKET_REASON_KEY[add.reason], add.vars);
  delete state.paused;
  delete state.resume;
  if (opts && opts.tapped) return saleGo(ctx, state, 'card', prefix);
  if (state.msgId) ports.chat.editMessage(ctx.chatId, state.msgId, t(ports, 'basket_moved'), [], !!state.cap);
  return saleGo(saleCtx(ctx.chatId, ctx.uid, ctx.staff, ctx.updateId, ports), state, 'card', prefix);
}

/**
 * A name typed at the add screen (a tag id is caught earlier by tagIdFromText): up to four pieces of the basket's shop
 * whose name matches and that can join, as the same i|<id> rows on a new add screen, or find_none above the question.
 */
function basketFindTyped(ctx, state, item, text) {
  var ports = ctx.ports, found = findItemsByName(ports, item.shop, text).filter(function (it) {
    return !basketHasItem(state, it.id) && basketAddItem(ports, ctx.staff, state.draft.lines, it.id, 1).ok;
  }).slice(0, 4);
  return saleRedraw(saleCtx(ctx.chatId, ctx.uid, ctx.staff, ctx.updateId, ports), state, found.length ? { found: found } : { none: true }, '');
}

/**
 * ⏮ from fromStep. A prompt opened FROM the screen (✏️, 💬, ➕) is live: the screen comes back as it was. Otherwise the
 * parent of SALE_PARENT is drawn; from how paid to the card the payment comes back as it was when o|method opened it.
 */
function saleBack(ctx, state, fromStep) {
  var ports = ctx.ports, cur = getState(ports, ctx.uid), prompt = !!cur && cur.kind !== 'sale';
  var isScreen = prompt && cur.kind === 'await_number' && cur.purpose === 'sale_step' && state.step === 'bank';
  if (prompt && !isScreen) return saleRedraw(ctx, state, {});
  var parent = SALE_PARENT[state.step] || 'card';
  delete state.draft.addLabel;
  if (parent === 'card' && state.step === 'method' && state.undo) {
    var u = state.undo, d = state.draft;
    if (u.method) d.method = u.method; else delete d.method;
    if (u.mixed) d.mixed = true; else delete d.mixed;
    if (nullish(u.bankPart)) delete d.bankPart; else d.bankPart = u.bankPart;
    if (u.acct) state.acct = u.acct; else delete state.acct;
  }
  return saleGo(ctx, state, parent, '');
}

/**
 * ✖️ on the card: when the live state belongs to this message and anchor (or is the price prompt opened from this item's
 * card, or there is no state at all) it is cleared and the message becomes the item card: nothing was written. A ✖️ on an
 * older card, or while another flow is live, marks that message expired and leaves the live state alone. A sold card is
 * never touched (a ✖️ that raced the ✅): expired as a new message when nothing is live, else ignored.
 */
function saleCancel(ctx, item, message) {
  var ports = ctx.ports, cur = getState(ports, ctx.uid), live = saleStateOf(ports, ctx.uid), owns = false;
  if (!cur) owns = true;
  else if (live && live.item === item.id && (!live.msgId || live.msgId === ctx.msgId)) owns = true;
  else if (cur.kind === 'await_number' && cur.purpose === 'sale_price' && cur.itemId === item.id && !cur.saved) owns = true;
  if ((!cur || !owns) && saleSoldCard(ctx, message)) {
    if (!cur) ports.chat.sendMessage(ctx.chatId, t(ports, 'expired'));
    return;
  }
  if (!owns) return ports.chat.editMessage(ctx.chatId, ctx.msgId, t(ports, 'expired'), [], ctx.isCaption);
  clearState(ports, ctx.uid);
  var fresh = ports.store.getItem(item.id) || item;
  return ports.chat.editMessage(ctx.chatId, ctx.msgId, cardText(ports, fresh), cardKeyboard(ports, fresh), ctx.isCaption);
}

/** q|<n> on a stock item's line: its count; back to the card. */
function saleQtyPick(ctx, state, item, arg) {
  var n = Math.round(Number(arg)), l = state.draft.lines[basketLineIndex(state.draft, state.line)];
  var it = l ? ctx.ports.store.getItem(l.id) : null;
  if (!l || !it || it.type === CFG.ITEM_TYPE.UNIQUE || !(n >= 1) || n > CFG.MAX_SALE_QTY) return;
  l.qty = n;
  return saleGo(ctx, state, 'card', '');
}

/**
 * A typed or spoken count for the open line: outside 1..MAX_SALE_QTY the line screen comes back as a new message with
 * bad_qty as its first line (the state kept); else the count, and the card as a new message.
 */
function saleQtyTyped(ctx, state, item, n) {
  var ports = ctx.ports, typed = saleCtx(ctx.chatId, ctx.uid, ctx.staff, ctx.updateId, ports);
  var l = state.draft.lines[basketLineIndex(state.draft, state.line)];
  if (!l) return saleGo(typed, state, 'card', '');
  if (n < 1 || n > CFG.MAX_SALE_QTY || n !== Math.round(n)) {
    state.step = 'line';
    saleRedraw(typed, state, {}, t(ports, 'bad_qty', { max: myDigits(CFG.MAX_SALE_QTY) }));
    return true;
  }
  l.qty = n;
  return saleGo(typed, state, 'card', '');
}

/** SS|<a>|b|<none|new|create|custId>. Every exit goes through basketNext. */
function saleBuyerPick(ctx, state, item, arg) {
  var ports = ctx.ports, d = state.draft;
  if (arg === 'none') {
    if (basketNeedBuyer(state)) return;
    delete d.customerId; delete d.newName; delete d.newPhone;
    return basketNext(ctx, state, '');
  }
  if (arg === 'new') return saleGo(ctx, state, 'name', '');
  if (arg === 'create') {
    if (!d.newName) return;
    delete d.customerId;
    if (d.newPhone === undefined) return saleGo(ctx, state, 'phone', '');
    return basketNext(ctx, state, '');
  }
  var c = ports.store.getCustomer(arg);
  if (!c) return;
  return saleBuyerChosen(ctx, state, c);
}

function saleBuyerChosen(ctx, state, c) {
  var d = state.draft;
  d.customerId = c.id;
  delete d.newName;
  delete d.newPhone;
  return basketNext(ctx, state, '');
}

/**
 * A typed or spoken text on the card, the buyer or the name screen. Digits and phone punctuation only are a PHONE hint,
 * never a name: an exact number picks that buyer, partial matches (four or more digits) are offered without a create
 * button, nobody re-asks (nothing created). Otherwise an exact name picks, look-alikes are offered with "create", a
 * stranger goes to the phone screen with the name kept in the draft (the Customers row is written at ✅).
 */
function saleBuyerNamed(ctx, state, item, text) {
  var ports = ctx.ports, d = state.draft, s = String(text || '').trim();
  if (!s) return saleRedraw(ctx, state, {});
  var m = matchCustomers(ports, s);
  if (/^[0-9၀-၉\s.,\-+()\/]*$/.test(s)) {
    var digits = s.replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); }).replace(/\D/g, '');
    if (digits.length >= 4 && m.exact) return saleBuyerChosen(ctx, state, m.exact);
    if (digits.length >= 4 && m.partial.length) return saleGo(ctx, state, 'buyer', '', { look: { matches: m.partial, phoneForm: true, name: s } });
    if (state.step === 'name') return saleRedraw(ctx, state, {}, t(ports, 'cust_none'));
    return saleGo(ctx, state, 'buyer', t(ports, 'cust_none'));
  }
  if (m.exact) return saleBuyerChosen(ctx, state, m.exact);
  d.newName = s;
  delete d.customerId;
  if (m.partial.length) return saleGo(ctx, state, 'buyer', '', { look: { matches: m.partial, name: s } });
  return saleGo(ctx, state, 'phone', '');
}

/**
 * The phone of a new buyer, typed or spoken: fewer than seven digits asks again; a number somebody already has offers
 * that buyer (never duplicated); a valid number is kept normalised, anything else as typed. Then basketNext.
 */
function salePhoneTyped(ctx, state, item, text) {
  var ports = ctx.ports, d = state.draft, digits = normPhone(text);
  if (digits.length < 7) return saleRedraw(ctx, state, {});
  var same = ports.store.listCustomers().filter(function (c) { return normPhone(c.phone) === digits; });
  d.newPhone = isValidPhone(text) || same.length ? digits : String(text || '').trim();
  if (same.length) return saleGo(ctx, state, 'buyer', '', { look: { matches: same, name: d.newName || '' } });
  return basketNext(ctx, state, '');
}

function salePhoneSkip(ctx, state, item) {
  state.draft.newPhone = '';
  return basketNext(ctx, state, '');
}

/**
 * SS|<a>|m|<CASH|KEY|bank|mix|more>: a key is the method, back to the card; a category (lower case) goes to the account
 * screen, or straight on when it leaves one account (never skipped for the wallets list).
 */
function saleMethodPick(ctx, state, item, arg) {
  var ports = ctx.ports, d = state.draft, a = String(arg || '');
  if (a === 'bank' || a === 'mix' || a === 'more') {
    state.acct = a === 'bank' ? 'bank' : (a === 'more' ? 'wallet' : 'all');
    if (a === 'mix') d.mixed = true; else delete d.mixed;
    delete d.method;
    delete d.bankPart;
    var cands = saleAccountCandidates(ports, item.shop, state.acct);
    if (cands.length === 1 && state.acct !== 'wallet') { d.method = cands[0]; return saleAfterAccount(ctx, state, ''); }
    return saleGo(ctx, state, 'account', '');
  }
  var key = a.toUpperCase();
  if (!methodKnown(ports, key)) return;
  d.method = key;
  delete d.mixed;
  delete d.bankPart;
  return saleGo(ctx, state, 'card', '');
}

/** SS|<a>|a|<KEY>: the account; then the transfer part when mixed, else the card. */
function saleAccountPick(ctx, state, item, arg) {
  var key = String(arg || '').toUpperCase();
  if (!methodKnown(ctx.ports, key) || key === CFG.METHOD.CASH) return;
  state.draft.method = key;
  delete state.draft.bankPart;
  return saleAfterAccount(ctx, state, '');
}

/** SS|<a>|x|half on the transfer-part screen: half of what is paid now. */
function saleBankHalf(ctx, state, item) {
  var paid = basketPaidNow(state), half = Math.round(paid / 2);
  if (!(half >= 1) || half >= paid) return;
  state.draft.mixed = true;
  state.draft.bankPart = half;
  return saleAfterAccount(ctx, state, '');
}

/**
 * A typed or spoken number for saved.step: the transfer part (bank: 1..paid now - 1; the whole amount puts the payment on
 * the account alone; then the card) or the amount now (paid: the total means paid in full and the card; less is a part
 * payment and basketNext; below the transfer part or 0 is refused). A bad value sends sale_bad_amount with the screen's
 * back row and sets the number state again.
 */
function saleNumber(ctx, saved, n, source, transcript) {
  var ports = ctx.ports, state = saved, item = ports.store.getItem(state.item);
  if (!item) return ports.chat.sendMessage(ctx.chatId, t(ports, 'tag_not_found', { id: state.item }));
  var d = state.draft, total = basketTotals(d.lines, {}).total;
  var bad = function (min, max) {
    var m = ports.chat.sendMessage(ctx.chatId, t(ports, 'sale_bad_amount', { min: fmtMoney(min), max: fmtMoney(max) }), [saleBackRow(ports, item, state.step)]);
    state.msgId = m && m.messageId ? m.messageId : state.msgId;
    state.cap = false;
    setState(ports, ctx.uid, { kind: 'await_number', purpose: 'sale_step', saved: state });
    return true;
  };
  if (state.step === 'bank') {
    var paid = basketPaidNow(state);
    if (n >= paid) { d.mixed = false; d.bankPart = 0; return saleGo(ctx, state, 'card', ''); }
    if (!(n >= 1) || n !== Math.round(n)) return bad(1, paid - 1);
    // This screen is the mixed payment's: a part below what is paid now makes it mixed again.
    d.mixed = true;
    d.bankPart = n;
    return saleGo(ctx, state, 'card', '');
  }
  if (state.step === 'paid') {
    var min = d.mixed ? (Number(d.bankPart) || 0) : 0;
    if (n >= total) { d.part = false; delete d.paid; delete d.dueDay; return saleGo(ctx, state, 'card', ''); }
    if (!(n >= min) || n !== Math.round(n)) return bad(min, total - 1);
    d.part = true;
    d.paid = n;
    return basketNext(ctx, state, '');
  }
  return saleRedraw(ctx, state, {});
}

/** A spoken CASH part on the transfer-part screen ("ငွေသား ငါးထောင်") becomes the account part: paid now - cash; -1 when nothing is left. */
function saleBankFromCash(ports, saved, cashPart) {
  var paid = basketPaidNow(saved), n = Math.round(Number(cashPart));
  if (!(n >= 1) || n >= paid || n !== Number(cashPart)) return -1;
  return paid - n;
}

/** SS|<a>|p|<all|0|half|bank|other>: paid in full (the card), a part payment (basketNext), or the typed-number prompt. */
function salePaidPick(ctx, state, item, arg) {
  var ports = ctx.ports, d = state.draft, total = basketTotals(d.lines, {}).total, half = Math.round(total / 2), a = String(arg || '');
  if (a === 'all') {
    d.part = false;
    delete d.paid;
    delete d.dueDay;
    return saleGo(ctx, state, 'card', '');
  }
  if (a === 'other') {
    var r = editOrSend(ports, ctx.chatId, ctx.msgId, basketHead(ports, state) + '\n' + t(ports, 'ask_number'), [saleBackRow(ports, item, 'paid')], ctx.isCaption);
    saleShow(state, ctx, r);
    setState(ports, ctx.uid, { kind: 'await_number', purpose: 'sale_step', saved: state });
    return;
  }
  var mixed = !!d.mixed && Number(d.bankPart) > 0, paid;
  if (a === '0') { if (mixed) return; paid = 0; }
  else if (a === 'half') { paid = half; if ((mixed && paid <= d.bankPart) || !(half >= 1) || half >= total) return; }
  else if (a === 'bank') { if (!mixed) return; paid = Number(d.bankPart); }
  else return;
  if (paid >= total) return;
  d.part = true;
  d.paid = paid;
  return basketNext(ctx, state, '');
}

/** SS|<a>|d|<n|type|none>: the promised day (saleDueKey keeps the bounds), a typed date, or not sure. */
function saleDuePick(ctx, state, item, arg) {
  var ports = ctx.ports, d = state.draft, a = String(arg || '');
  if (a === 'type') return saleGo(ctx, state, 'due_text', '');
  if (a === 'none') { d.dueDay = ''; return basketNext(ctx, state, ''); }
  // A whole number of days within the typed date's bound: a stale or hand-built callback cannot book a day the card refuses.
  if (!/^\d+$/.test(a)) return;
  var key = saleDueKey(ports.clock.now(), Number(a));
  if (!key) return;
  d.dueDay = key;
  return basketNext(ctx, state, '');
}

/**
 * A typed or spoken date (30.10.26, 30/10, 2026-10-30, a number of days, Burmese digits) through saleDueKey: a day before
 * today or more than SALE_DUE_MAX_DAYS ahead is refused, the state kept. Refused on the due screen (its buttons wait), the
 * due screen comes back as a new message with ord_bad_date as its first line; refused on the typed-date prompt,
 * ord_bad_date with its back row.
 */
function saleDueTyped(ctx, state, item, text) {
  var ports = ctx.ports, d = state.draft, key = saleDueKey(ports.clock.now(), text);
  if (!key) {
    if (state.step === 'due') {
      saleRedraw(saleCtx(ctx.chatId, ctx.uid, ctx.staff, ctx.updateId, ports), state, {}, t(ports, 'ord_bad_date'));
      return true;
    }
    var m = ports.chat.sendMessage(ctx.chatId, t(ports, 'ord_bad_date'), [saleBackRow(ports, item, state.step)]);
    state.msgId = m && m.messageId ? m.messageId : state.msgId;
    state.cap = false;
    setState(ports, ctx.uid, state);
    return true;
  }
  d.dueDay = key;
  return basketNext(saleCtx(ctx.chatId, ctx.uid, ctx.staff, ctx.updateId, ports), state, '');
}

/**
 * SS|<a>|k|<wallet|bank>: the account named through ➕ gets its one Lists row (shared by both shops) with that kind and is
 * the sale's method (round 5's rule: the row is written at this tap); then how paid's exit (saleAfterAccount).
 */
function saleKindPick(ctx, state, item, arg) {
  var ports = ctx.ports, d = state.draft, kind = String(arg || '');
  if (CFG.LIST_KINDS.indexOf(kind) < 0 || !d.addLabel) return;
  var r = addListOptionByLabel(ports, 'pay_method', d.addLabel, ctx.staff, { kind: kind });
  if (!r.ok) return ports.chat.sendMessage(ctx.chatId, t(ports, r.reason === 'empty' ? 'expired' : 'add_unavailable'));
  var prefix = t(ports, r.created ? 'add_done' : 'add_exists', { label: r.label });
  delete d.addLabel;
  d.method = r.key;
  delete d.bankPart;
  if (r.created) d.addedKey = r.key;
  state.step = 'method';
  return saleAfterAccount(ctx, state, prefix);
}

/**
 * The name typed (or spoken) at the ➕ prompt of how paid (finishAddOption, resume SSA): looked up, never written yet.
 * Digits or an amount ask again (the state kept); an existing label is used at once; a new one asks its kind.
 */
function saleAddNamed(chatId, uid, state, text, staff, updateId, ports) {
  var waiting = sameAddState(getState(ports, uid), state);
  var saved = state.saved, item = saved && saved.kind === 'sale' ? ports.store.getItem(saved.item) : null;
  if (!waiting || !item) {
    if (waiting) { if (saved) setState(ports, uid, saved); else clearState(ports, uid); }
    return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  }
  var found = listFindByLabel(ports, 'pay_method', text);
  // Cash is not an account (the account screen refuses it too): the name is asked again, as for digits or an amount.
  if (found.ok && String(found.key || '').toUpperCase() === CFG.METHOD.CASH) found = { ok: false, reason: 'empty' };
  if (!found.ok) {
    if (found.reason === 'empty') {
      var m = ports.chat.sendMessage(chatId, t(ports, 'add_ask_pm'), [saleBackRow(ports, item, saved.step)]);
      saved.msgId = m && m.messageId ? m.messageId : saved.msgId;
      saved.cap = false;
      setState(ports, uid, state);
      return;
    }
    setState(ports, uid, saved);
    return ports.chat.sendMessage(chatId, t(ports, 'add_unavailable'));
  }
  setState(ports, uid, saved);
  return saleAccountResume(chatId, uid, item, found, staff, updateId, ports);
}

/** After ➕ found the name: an existing account is the method and how paid exits; a new name asks its kind (a new message). */
function saleAccountResume(chatId, uid, item, found, staff, updateId, ports) {
  var ctx = saleCtx(chatId, uid, staff, updateId, ports), state = saleStateOf(ports, uid);
  if (!state || state.item !== item.id) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  if (found.existed) {
    state.draft.method = found.key;
    delete state.draft.bankPart;
    state.step = 'method';
    return saleAfterAccount(ctx, state, t(ports, 'add_exists', { label: found.label }));
  }
  state.draft.addLabel = found.label;
  return saleGo(ctx, state, 'kind', '');
}

/**
 * Would this intent run beside the live basket? A method correction always (it targets the last committed group, never
 * the basket on screen); a sale, restock, return or transfer when it resolves to any piece of the basket.
 */
function saleIntentClashes(ports, staff, lastItem, intent, live) {
  var I = CFG.INTENT, k = intent && intent.intent;
  if (k === I.METHOD) return true;
  if (k !== I.SALE && k !== I.RESTOCK && k !== I.RETURN && k !== I.TRANSFER) return false;
  var res = resolveItem(ports, staff, lastItem, intent.item_hint);
  return !!res.item && basketHasItem(live, res.item.id);
}

/** The live screen of the basket again, as a new message (prefix = the heard line); the state is kept. */
function saleResend(ctx, live, prefix) {
  var p = String(prefix || '').replace(/\n+$/, '');
  if (live.paused) { delete live.paused; delete live.resume; live.step = 'card'; }
  return saleRedraw(ctx, live, {}, p) || true;
}

/**
 * A typed text while the basket waits: a buyer search on the card, a name or phone on the buyer screens, a date on the due
 * screens, a count on a stock item's line, a name search on the add screen, an amount on the how-much-now screen. Returns
 * true when handled (an edit returns nothing in every chat port, so the answer is explicit), false to let the text reach
 * today's paths.
 */
function saleText(ctx, state, text) {
  var ports = ctx.ports, item = ports.store.getItem(state.item), s = String(text || '').trim();
  if (!item || !s || state.paused) return false;
  switch (state.step) {
    case 'card': case 'buyer': case 'name': saleBuyerNamed(ctx, state, item, s); return true;
    case 'phone': salePhoneTyped(ctx, state, item, s); return true;
    case 'due_text': saleDueTyped(ctx, state, item, s); return true;
    case 'add': basketFindTyped(ctx, state, item, s); return true;
    case 'line': {
      var l = state.draft.lines[basketLineIndex(state.draft, state.line)], it = l ? ports.store.getItem(l.id) : null;
      var n = parseNumberText(s);
      if (n === null || !it || it.type === CFG.ITEM_TYPE.UNIQUE) return false;
      saleQtyTyped(ctx, state, item, n);
      return true;
    }
    case 'paid': {
      var a = parseNumberText(s);
      if (a === null) return false;
      saleNumber(ctx, state, a, CFG.SOURCE.TEXT, s);
      return true;
    }
    case 'due': {
      if (saleDueKey(ports.clock.now(), s) === null && !parseDayText(s, ports.clock.now(), { noRoll: true })) return false;
      saleDueTyped(ctx, state, item, s);
      return true;
    }
    default: return false;
  }
}

/**
 * The buyer of the draft at ✅: a picked customer, or the typed name (an exact match meanwhile is used, unless
 * draft.forceNew: the app's seller saw that customer and chose to create another), else the row is created now.
 */
function saleResolveBuyer(ports, draft) {
  if (draft.customerId) return ports.store.getCustomer(draft.customerId) || null;
  if (draft.newName) {
    if (!draft.forceNew) {
      var m = matchCustomers(ports, draft.newName);
      if (m.exact) return m.exact;
    }
    return ports.store.addCustomer({ name: draft.newName, phone: draft.newPhone || '' });
  }
  return null;
}

/** The text of a Save refusal: its key filled with its vars. */
function basketProblemText(ports, problem) {
  return t(ports, problem.key, problem.vars);
}

/**
 * THE Save of both channels (the app's sale form and the review card): basketCheck; then the buyer (the Customers row is
 * written here, at Save only); then commitBasket with every item re-read; then the last item and the last group of uid.
 * opts = {uid, updateId, source, pendingMethod, beforeWrite}: beforeWrite(draft) runs after the checks passed, right before
 * the writes (the app writes the Lists row of an account typed in the form there, in the same commit).
 * Returns {ok: true, r, customer} or {ok: false, problems}.
 */
function basketCommitDraft(ports, staff, draft, opts) {
  opts = opts || {};
  var chk = basketCheck(ports, staff, draft, { pendingMethod: opts.pendingMethod });
  if (!chk.ok) return { ok: false, problems: chk.problems };
  if (opts.beforeWrite) opts.beforeWrite(draft);
  var customer = saleResolveBuyer(ports, draft);
  var lines = draft.lines.map(function (l) {
    return { item: ports.store.getItem(l.id), qty: l.qty, unitPrice: l.unitPrice, priceChanged: !!l.priceChanged };
  });
  var r = commitBasket(ports, {
    lines: lines, paid: draft.part ? draft.paid : null, method: draft.method, bankPart: draft.bankPart, mixed: !!draft.mixed,
    customerId: customer ? customer.id : '', dueDay: draft.dueDay || '', staff: staff, source: opts.source || CFG.SOURCE.BUTTON,
    updateId: opts.updateId
  });
  if (opts.uid) {
    setLastItem(ports, opts.uid, draft.lines[0].id);
    setLastGroup(ports, opts.uid, r.groupId);
  }
  return { ok: true, r: r, customer: customer };
}

/**
 * After a Save: the sold card on the tapped message (msgId null sends it as a new message: the app's sold card), or the
 * deposit question when the buyer holds a free deposit and still owes (CD|<g>|yes|p, plain rows).
 */
function basketSoldReply(ports, chatId, msgId, isCaption, r, draft, customer) {
  if (msgId) markCommittedCard(ports, chatId, msgId);
  var text = saleCardText(ports, r.groupId, draft.addedKey), kb, view = null;
  var free = customer ? depositsFree(ports, customer.id) : 0;
  if (customer && r.owed > 0 && free > 0) {
    var tail = '|p' + (draft.addedKey ? '|' + draft.addedKey : '');
    var question = t(ports, 'credit_use_deposit', { customer: customer.name, deposit: fmtMoney(free) });
    text += '\n' + question;
    kb = [[btn(t(ports, 'btn_use_deposit'), 'CD|' + r.groupId + '|yes' + tail), btn(t(ports, 'btn_no_deposit'), 'CD|' + r.groupId + '|no' + tail)]];
    // The app (F7): the sold card's view with the question as its last line, above the two buttons.
    view = saleSoldView(ports, r.groupId, draft.addedKey);
    view.extra = view.extra.concat([question]);
  } else {
    kb = saleCardKeyboard(ports, r.groupId, draft.addedKey, customer);
    view = saleSoldView(ports, r.groupId, draft.addedKey);
  }
  return editOrSend(ports, chatId, msgId, text, kb, isCaption, view);
}

/** The app's view of a sold card: {kind: 'sold', id, extra} (the number hint of an account created in the sale). */
function saleSoldView(ports, groupId, addedKey) {
  return { kind: 'sold', id: groupId, extra: addedKey ? [t(ports, 'acct_detail_hint', { label: methodLabel(ports, addedKey) })] : [] };
}

/**
 * SC|<a>|ok at the card: basketCommitDraft. Refused: the card again with the first problem on top, nothing written, the
 * state kept, and this tap's guard key removed so the corrected ✅ is not swallowed; a 'mode' refusal (the owner switched
 * to quick) clears the state and turns the message into the anchor's item card with expired on top; a 'method' refusal
 * (a retired account) puts the method back to cash first. Accepted: clearState and basketSoldReply on the tapped message.
 */
function basketSave(ctx, item, message) {
  var ports = ctx.ports, state = saleGuard(ctx, item, 'card', message);
  if (!state || state.paused) return;
  var res = basketCommitDraft(ports, ctx.staff, state.draft, { uid: ctx.uid, updateId: ctx.updateId, source: CFG.SOURCE.BUTTON });
  if (!res.ok) {
    ports.cache.remove('tap:' + ctx.chatId + ':' + ctx.msgId + ':SC|' + item.id + '|ok');
    var first = res.problems[0];
    if (first.code === 'mode') {
      clearState(ports, ctx.uid);
      var fresh = ports.store.getItem(item.id) || item;
      return editOrSend(ports, ctx.chatId, ctx.msgId, t(ports, 'expired') + '\n' + cardText(ports, fresh), cardKeyboard(ports, fresh), ctx.isCaption);
    }
    if (first.code === 'method') {
      state.draft.method = CFG.METHOD.CASH;
      delete state.draft.mixed;
      delete state.draft.bankPart;
    }
    return saleGo(ctx, state, 'card', basketProblemText(ports, first));
  }
  clearState(ports, ctx.uid);
  return basketSoldReply(ports, ctx.chatId, ctx.msgId, ctx.isCaption, res.r, state.draft, res.customer);
}

/**
 * The sold card's text, from the ledger (so the deposit answer can rebuild it). A basket (basketGroup): basket_sold and one
 * basket_sold_line per live SALE row; one line: the item card and sold_done (round 5's card). Then the buyer line
 * (credit_done while owed, paid = cash + payments + deposit used; cust_attached otherwise), how it was paid (one account,
 * or the two parts), the promised date while owed, the number hint for an account created inside this sale.
 */
function saleCardText(ports, groupId, addedKey) {
  var info = saleGroupInfo(ports, groupId);
  if (!info) return t(ports, 'expired');
  var lines = [];
  if (basketGroup(info)) {
    lines.push(t(ports, 'basket_sold', { n: fmtCount(info.rows.length), qty: fmtCount(info.qty), amount: fmtMoney(info.total) }));
    info.rows.forEach(function (r) {
      var it = ports.store.getItem(r.itemId);
      lines.push(t(ports, 'basket_sold_line', { id: r.itemId, name: it ? it.name : r.itemId, qty: fmtCount(-r.qty), amount: fmtMoney(r.amount),
        stock: fmtCount(it ? it.stock : 0) }));
    });
  } else {
    var fresh = ports.store.getItem(info.itemId);
    if (fresh) lines.push(cardText(ports, fresh));
    lines.push(t(ports, 'sold_done', { qty: fmtCount(info.qty), amount: fmtMoney(info.total), stock: fmtCount(fresh ? fresh.stock : 0) }));
  }
  if (info.customerId) {
    var name = customerName(ports, info.customerId);
    if (info.owed > 0) lines.push(t(ports, 'credit_done', { customer: name, paid: fmtMoney(info.cash + info.payments + info.applied), owed: fmtMoney(info.owed) }));
    else lines.push(t(ports, 'cust_attached', { customer: name }));
  }
  var ms = groupMethods(ports, groupId);
  if (ms.length >= 2) {
    var cashM = ms.filter(function (m) { return m.method === CFG.METHOD.CASH; })[0] || { amount: 0 };
    var bankM = ms.filter(function (m) { return m.method !== CFG.METHOD.CASH; })[0];
    lines.push(t(ports, 'split_done', { cashMethod: methodLabel(ports, CFG.METHOD.CASH), cash: fmtMoney(cashM.amount),
      method: methodLabel(ports, bankM.method), bank: fmtMoney(bankM.amount) }));
  } else if (ms.length === 1 && ms[0].method !== CFG.METHOD.CASH) {
    lines.push(t(ports, 'method_done', { method: methodLabel(ports, ms[0].method) }));
  }
  if (info.dueDay && info.owed > 0) lines.push(t(ports, 'sale_due_set', { owed: fmtMoney(info.owed), date: fmtDayMy(info.dueDay) }));
  if (addedKey) lines.push(t(ports, 'acct_detail_hint', { label: methodLabel(ports, addedKey) }));
  return lines.join('\n');
}

/** The sold card's rows: undo and receipt, 💰 while owed, the 🔢 number hint for an account created inside the sale, 📱 for a buyer without a phone. */
function saleCardKeyboard(ports, groupId, addedKey, customer) {
  var kb = afterSaleKeyboard(ports, groupId, { plain: true });
  if (addedKey && utf8ByteLength('LD|pm|' + addedKey) <= 64) kb.push([btn(t(ports, 'btn_acct_number'), 'LD|pm|' + addedKey)]);
  return kb.concat(phoneRow(ports, customer));
}

/* ------------------------------ the new-piece review card (round 6, Telegram in form mode) ------------------------------ */

/** The 'name · category' line of the new-piece screens. */
function newItemSeen(ports, d) {
  return t(ports, 'photo_seen', { name: d.name, category: d.category });
}

/** The new-piece card's text (spec 2.3): the name and category, the price, the cost, the profit, the count; prefix on top. */
function newItemCardText(ports, state, prefix) {
  var d = state.draft || {}, lines = [newItemSeen(ports, d)];
  if (d.price === '') lines.push(t(ports, 'btn_pending'));
  else if (nullish(d.price)) lines.push(t(ports, 'ask_price'));
  else lines.push(t(ports, 'item_lbl_price', { price: fmtMoney(d.price) }));
  lines.push(Number(d.cost) >= 1 ? t(ports, 'item_lbl_cost', { cost: fmtMoney(d.cost) }) : t(ports, 'item_lbl_cost_none'));
  var m = itemMargin(d.price, d.cost);
  if (m) lines.push(m.profit >= 0 ? t(ports, 'item_lbl_profit', { profit: fmtMoney(m.profit), pct: String(m.pct) }) : t(ports, 'item_lbl_loss'));
  lines.push(t(ports, 'item_lbl_count', { count: fmtCount(d.count || 1) }) + (d.sample ? t(ports, 'sample_mark') : ''));
  return withPrefix(prefix, lines.join('\n'));
}

/** The new-piece card's buttons (spec 2.3). */
function newItemCardKeyboard(ports, state, staff) {
  var d = state.draft || {}, id = state.itemId;
  var presets = pricePresets(ports, d.category, staff.shop).map(function (p) { return btn(fmtMoney(p), 'P|' + id + '|' + p); });
  return [presets,
    [btn(t(ports, 'btn_other'), 'P|' + id + '|other'), btn(t(ports, 'btn_pending'), 'P|' + id + '|pending')],
    [btn(t(ports, 'btn_item_cost'), 'C|' + id + '|other'), btn(t(ports, 'btn_item_name'), 'NI|' + id + '|n')],
    [btn(t(ports, 'btn_item_cat'), 'NI|' + id + '|c'), btn(t(ports, d.sample ? 'btn_sample_on' : 'btn_sample_off'), 'PS|' + id)],
    [btn('➖', 'NI|' + id + '|q|-'), btn(t(ports, 'item_lbl_count', { count: fmtCount(d.count || 1) }), 'NI|' + id + '|qn'), btn('➕', 'NI|' + id + '|q|+')],
    [btn(t(ports, 'btn_save'), 'NC|' + id + '|ok')],
    [btn(t(ports, 'btn_cancel'), 'Z')]];
}

/** The card on msgId (a text message), or as a new message when msgId is null; state.msgId follows; the state is stored. */
function newItemCardShow(chatId, msgId, uid, state, staff, ports, prefix) {
  state.step = 'card';
  var text = newItemCardText(ports, state, prefix), kb = newItemCardKeyboard(ports, state, staff);
  var r = msgId ? ports.chat.editMessage(chatId, msgId, text, kb, false) : ports.chat.sendMessage(chatId, text, kb);
  state.msgId = (r && r.messageId) || msgId || null;
  setState(ports, uid, state);
  return r;
}

/** A sub-screen of the new-piece card on msgId (or a new message): its question and its last row. */
function newItemScreen(chatId, msgId, uid, state, ports, step, text, row) {
  state.step = step;
  var r = msgId ? ports.chat.editMessage(chatId, msgId, text, [row], false) : ports.chat.sendMessage(chatId, text, [row]);
  state.msgId = (r && r.messageId) || msgId || null;
  setState(ports, uid, state);
  return r;
}

/**
 * The new-piece state inside a state (round 6b): the state itself when it is new_item; the card it was tapped in when the
 * state is the ➕ prompt of the card's category screen (await_text / add_option / item_category with a new_item saved);
 * else null. Every reader of the new-piece state goes through it, so a photo, a toggle or a price during the prompt acts
 * on the card. Pure.
 */
function newItemStateOf(state) {
  if (!state) return null;
  if (state.kind === 'new_item') return state;
  if (state.kind === 'await_text' && state.purpose === 'add_option' && state.list === 'item_category' && state.saved &&
      state.saved.kind === 'new_item') return state.saved;
  return null;
}

/**
 * The new-piece card's live state for this tag (also while its ➕ prompt waits), or null (form mode only). raw: the state
 * already read (getState), else it is read here.
 */
function newItemFormState(ports, uid, itemId, raw) {
  var s = newItemStateOf(raw === undefined ? getState(ports, uid) : raw);
  return s && s.itemId === itemId && s.form ? s : null;
}

/**
 * The message a tap on the new-piece card redraws (pure; raw = the state read, ns = newItemStateOf(raw)): the tapped one,
 * except while the card's ➕ prompt waits (raw is the add state): then the PROMPT message (askAddOption pointed the card's
 * msgId at it), so a tap on an older card message never leaves the prompt asking on screen after its state is gone.
 */
function newItemTapMsg(raw, ns, msgId) {
  return msgId && raw && ns && raw.kind !== 'new_item' && ns.msgId ? ns.msgId : msgId;
}

/**
 * The category typed at the card's ➕ prompt was added or found (finishAddOption, resume NIC; the add state is gone):
 * the card takes it (its label, and key, its row's key) and comes back as a NEW message with prefix (add_done /
 * add_exists) on top; no card -> expired.
 */
function newItemCatAdded(chatId, uid, itemId, label, staff, ports, prefix, key) {
  var st = newItemFormState(ports, uid, itemId);
  if (!st) return ports.chat.sendMessage(chatId, withPrefix(prefix, t(ports, 'expired')));
  st.draft = st.draft || {};
  st.draft.category = label;
  st.draft.categoryKey = key || '';
  return newItemCardShow(chatId, null, uid, st, staff, ports, prefix);
}

/** NI|<id>|<q|qn|n|c|back>|<arg>: the count, the name, the category, back to the card. Never writes. */
function newItemCallback(chatId, msgId, uid, parts, staff, ports) {
  var id = parts[1], letter = String(parts[2] || ''), arg = parts[3];
  var raw = getState(ports, uid), state = newItemFormState(ports, uid, id, raw);
  if (!state) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  msgId = newItemTapMsg(raw, state, msgId);
  var d = state.draft = state.draft || {}, back = [btn(t(ports, 'btn_back'), 'NI|' + id + '|back')];
  switch (letter) {
    case 'q': {
      var n = Math.round(Number(d.count) || 1) + (arg === '+' ? 1 : arg === '-' ? -1 : 0);
      if (n < 1 || n > CFG.MAX_SALE_QTY) return;
      d.count = n;
      return newItemCardShow(chatId, msgId, uid, state, staff, ports, '');
    }
    case 'qn': return newItemScreen(chatId, msgId, uid, state, ports, 'count', t(ports, 'item_ask_count'), back);
    case 'n': return newItemScreen(chatId, msgId, uid, state, ports, 'name', newItemSeen(ports, d) + '\n' + t(ports, 'ask_name'), back);
    case 'c': {
      // Round 6b: the item_category rows offered for the piece's shop, by key (the catch-all last), then ➕ and ⏮.
      var cItem = ports.store.getItem(id), cOpts = itemCategoryOptions(ports, cItem ? cItem.shop : staff.shop);
      if (arg === undefined || arg === '') {
        state.step = 'cat';
        var rows = [];
        cOpts.forEach(function (o) {
          if (utf8ByteLength(o.key) > CFG.LIST_KEY_MAX_BYTES) {
            listWarnOnce(ports, 'ickey:' + listHash(o.key), 'lists', 'Lists: the item_category key "' + o.key + '" is longer than ' +
              CFG.LIST_KEY_MAX_BYTES + ' bytes and is left out of Telegram\'s buttons; give it a shorter Key');
            return;
          }
          rows.push([btn(itemCategoryEmoji(ports, o.label) + ' ' + o.label, 'NI|' + id + '|c|' + o.key)]);
        });
        rows.push([btn(t(ports, 'btn_add_cat'), 'LA|ic|NIC|' + id)]);
        rows.push(back);
        var r = ports.chat.editMessage(chatId, msgId, t(ports, 'item_ask_cat'), rows, false);
        state.msgId = (r && r.messageId) || msgId;
        setState(ports, uid, state);
        return r;
      }
      // A pick resolves against the rows the buttons came from; a card drawn before round 6b taps a digit 0..4 (the index).
      var want = listNormKey('item_category', arg), row = null, k;
      for (k = 0; k < cOpts.length && !row; k++) if (cOpts[k].key === want) row = cOpts[k];
      if (!row && /^[0-9]$/.test(String(arg)) && Number(arg) < CFG.ITEM_CATEGORY_KEYS.length) {
        for (k = 0; k < cOpts.length && !row; k++) if (cOpts[k].key === CFG.ITEM_CATEGORY_KEYS[Number(arg)]) row = cOpts[k];
      }
      if (!row) return;
      d.category = row.label;
      d.categoryKey = row.key;   // the row itself: an owner's rename before ✅ keeps the choice (commitNewItem)
      return newItemCardShow(chatId, msgId, uid, state, staff, ports, '');
    }
    case 'back': return newItemCardShow(chatId, msgId, uid, state, staff, ports, '');
    default: return;
  }
}

/**
 * NC|<id>|ok: commitNewItem. Refused: price (neither a price nor pending) -> the card with ask_price on top; not_blank
 * (registered meanwhile) -> the message reads expired and the item card follows; other_shop -> basket_other_shop, the state
 * cleared; every refusal frees the tap guard key. Accepted: the card reads item_created · id, the owner is pinged while the
 * price is pending, and the new piece's card follows with ↩️ as its first row.
 */
function newItemSave(chatId, msgId, uid, itemId, staff, updateId, ports) {
  var state = newItemFormState(ports, uid, itemId);
  if (!state) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var d = state.draft || {};
  var r = commitNewItem(ports, { itemId: itemId, name: d.name, category: d.category, categoryKey: d.categoryKey || '', price: d.price, cost: nullish(d.cost) ? '' : d.cost,
    count: d.count || 1, sample: !!d.sample, photoUrl: d.photoUrl || '', photoFileId: d.photoFileId || '', staff: staff,
    source: CFG.SOURCE.PHOTO, updateId: updateId });
  if (!r.ok) {
    ports.cache.remove('tap:' + chatId + ':' + msgId + ':NC|' + itemId + '|ok');
    if (r.reason === 'price' || r.reason === 'count' || r.reason === 'cost') {
      return newItemCardShow(chatId, msgId, uid, state, staff, ports, t(ports, r.reason === 'price' ? 'ask_price' : r.reason === 'count' ? 'bad_qty' : 'item_ask_cost',
        { max: myDigits(CFG.MAX_SALE_QTY) }));
    }
    clearState(ports, uid);
    var it = ports.store.getItem(itemId);
    if (r.reason === 'other_shop') {
      return ports.chat.editMessage(chatId, msgId, t(ports, 'basket_other_shop', { id: itemId, shop: shopName(ports, it ? it.shop : '') }), [], false);
    }
    ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
    return it ? sendItemCard(chatId, it, staff, ports) : undefined;
  }
  setLastItem(ports, uid, itemId);
  clearState(ports, uid);
  ports.chat.editMessage(chatId, msgId, t(ports, 'item_created') + ' · ' + itemId, [], false);
  if (r.pending) notifyOwners(ports, t(ports, 'price_ask_owner', { id: itemId, name: r.item.name }), priceButtons(ports, r.item));
  return sendItemCard(chatId, r.item, staff, ports, { undo: r.groupId });
}

/**
 * Typed text while the new-piece card waits (handleText, form mode). name: any text (trimmed, 60 characters) is the name;
 * price: a number (0 or below is pending); cost: a whole number >= 1; count: 1..999 (else bad_qty with the back row, the
 * state kept); card: a number of 500 or more is the price, a smaller one answers the card with ask_price on top, any other
 * text is the name. Each answer comes back as the card in a new message. Returns true when handled.
 */
function newItemText(chatId, uid, state, text, n, staff, ports) {
  var d = state.draft = state.draft || {}, back = [btn(t(ports, 'btn_back'), 'NI|' + state.itemId + '|back')];
  var asName = function () { d.name = String(text).trim().slice(0, 60); return newItemCardShow(chatId, null, uid, state, staff, ports, ''); };
  switch (state.step) {
    case 'name': return String(text || '').trim() ? asName() || true : false;
    case 'card':
      if (n !== null) {
        if (n >= 500) { d.price = n; return newItemCardShow(chatId, null, uid, state, staff, ports, '') || true; }
        return newItemCardShow(chatId, null, uid, state, staff, ports, t(ports, 'ask_price')) || true;
      }
      return String(text || '').trim() ? asName() || true : false;
    case 'price':
      if (n === null) return false;
      d.price = n > 0 ? n : '';
      return newItemCardShow(chatId, null, uid, state, staff, ports, '') || true;
    case 'cost':
      if (n === null) return false;
      if (!(n >= 1) || n !== Math.round(n)) {
        return newItemScreen(chatId, null, uid, state, ports, 'cost', newItemSeen(ports, d) + '\n' + t(ports, 'item_ask_cost'),
          [btn(t(ports, 'btn_skip'), 'NI|' + state.itemId + '|back')]) || true;
      }
      d.cost = n;
      return newItemCardShow(chatId, null, uid, state, staff, ports, '') || true;
    case 'count':
      if (n === null) return false;
      if (!(n >= 1 && n <= CFG.MAX_SALE_QTY && n === Math.round(n))) {
        return newItemScreen(chatId, null, uid, state, ports, 'count', t(ports, 'bad_qty', { max: myDigits(CFG.MAX_SALE_QTY) }), back) || true;
      }
      d.count = n;
      return newItemCardShow(chatId, null, uid, state, staff, ports, '') || true;
    default: return false;
  }
}

/* ------------------------------ state helpers ------------------------------ */

function getState(ports, uid) {
  var s = ports.cache.get('st:' + uid);
  var st = s ? JSON.parse(s) : null;
  // The new-piece card's ➕ prompt past its own short window (promptUntil, setState): the prompt is over, the card it
  // rides on lives on (round 6b), so the card's state is read as if ➕ had not been tapped.
  if (st && st.promptUntil && ports.clock.now().getTime() > Number(st.promptUntil)) return st.saved || null;
  return st;
}
function setState(ports, uid, state) {
  // A ➕ name prompt and a 🔢 account-number prompt wait a short time only (CFG.ADD_STATE_TTL_SEC): typed text that
  // arrives long after the prompt was left open would become a bank account or the number printed on receipts.
  // The ☰ 📦 restock loop (round 6b) ends CFG.RESTOCK_LOOP_TTL_SEC after its last prompt, in both of its shapes.
  var prompt = !!state && state.kind === 'await_text' && (state.purpose === 'add_option' || state.purpose === 'list_detail');
  // The new-piece card's ➕ prompt (round 6b) carries the card (its photo, name and price): the entry keeps the card's
  // lifetime, and the prompt itself still lapses CFG.ADD_STATE_TTL_SEC after it was asked (promptUntil, read by getState).
  var cardPrompt = prompt && state.list === 'item_category' && !!state.saved && state.saved.kind === 'new_item';
  if (cardPrompt && !state.promptUntil) state.promptUntil = ports.clock.now().getTime() + CFG.ADD_STATE_TTL_SEC * 1000;
  ports.cache.put('st:' + uid, JSON.stringify(state), cardPrompt ? CFG.STATE_TTL_SEC : prompt ? CFG.ADD_STATE_TTL_SEC
    : restockLoopOf(state) ? CFG.RESTOCK_LOOP_TTL_SEC : CFG.STATE_TTL_SEC);
}
function clearState(ports, uid) { ports.cache.remove('st:' + uid); }
/**
 * /start and the menu buttons (M|*) close a ➕ or 🔢 prompt that was left open: the state the ➕ was tapped in comes
 * back (or none), a 🔢 prompt is cleared. The ☰ 📦 restock loop (round 6b, both shapes) ends: the seller moved on.
 * Every other state is kept through the menu, as before.
 */
function dropAddState(ports, uid) {
  var st = getState(ports, uid);
  if (restockLoopOf(st)) return restockLoopEnd(ports, uid);
  if (!st || st.kind !== 'await_text') return;
  if (st.purpose === 'add_option') { if (st.saved) setState(ports, uid, st.saved); else clearState(ports, uid); }
  else if (st.purpose === 'list_detail') clearState(ports, uid);
}
function setLastItem(ports, uid, itemId) { ports.cache.put('li:' + uid, itemId, CFG.LAST_ITEM_TTL_SEC); }
function getLastItem(ports, uid) {
  var id = ports.cache.get('li:' + uid);
  return id ? ports.store.getItem(id) : null;
}
/** The last money group this user committed, so "Wave နဲ့ ပေးသွားတယ်" knows what it refers to. Lives as long as Undo. */
function setLastGroup(ports, uid, groupId) { ports.cache.put('lg:' + uid, groupId, CFG.UNDO_WINDOW_MIN * 60); }
function getLastGroup(ports, uid) { return ports.cache.get('lg:' + uid) || null; }
function clearLastGroup(ports, uid, groupId) {
  if (!groupId || getLastGroup(ports, uid) === groupId) ports.cache.remove('lg:' + uid);
}

function btn(text, data) { return { text: text, callback_data: data }; }
function merge(a, b) {
  var o = {}, k;
  for (k in a) o[k] = a[k];
  for (k in b) o[k] = b[k];
  return o;
}
function firstNumber(list) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] !== null && list[i] !== undefined && !isNaN(Number(list[i])) && Number(list[i]) > 0) return Number(list[i]);
  }
  return null;
}
function safeJson(o) {
  try { return JSON.stringify(o).slice(0, 2000); } catch (e) { return ''; }
}

/* ======================= custom tailoring orders (plan 13.4, core_orders.js) ======================= */
/*
 * Callback data: O card  OL list  ON new  OC customer  OI design  OP price  OQ qty  OA add/same/pop  OD due  ODA advance
 * OF fabric  OE description  OS status  OV voucher  OVP voucher pdf  ORM ready message  ODL deliver  ODU use pool
 * ODP paid now  ODM method (commits)  OX cancel  OXR refund/keep  OXM refund method (commits)  OT/OTL attach a tag
 * MS measurements  MM method  MQ question step  MK save  MF fix  MG fix group  ML fix field  MP measurement pdf
 * States: {kind:'order', step, orderId, draft}  {kind:'meas', token, step}  {kind:'meas_pick'}  {kind:'order_tag', orderId, line}
 * await_number purposes: order_price, order_qty, order_advance, deliver_paid (saved = the order state to restore).
 * The module is optional: every entry point checks ordersEnabled(ports) (core_orders.js loaded, store has the tabs).
 */

/** The O... and M[SMQKFGLP] callbacks. parts = data split on '|'. */
function orderCallback(action, parts, chatId, msgId, uid, staff, updateId, ports) {
  var id = parts[1], arg = parts[2];
  switch (action) {
    case 'O': return openOrderCard(chatId, id, staff, uid, ports);
    case 'OL': return showOrderList(chatId, Number(arg) > 0 ? msgId : null, staff, arg, ports);
    case 'ON': return startNewOrder(chatId, uid, staff, ports, null, '');
    case 'OC': return orderCustomer(chatId, msgId, uid, id, staff, updateId, ports);
    case 'OI': return orderDesign(chatId, msgId, uid, id, arg, staff, ports);
    case 'OP': return orderPrice(chatId, msgId, uid, id, arg, staff, ports);
    case 'OQ': return orderQty(chatId, msgId, uid, id, arg, staff, ports);
    case 'OA': return orderMore(chatId, msgId, uid, id, arg, staff, ports, parts[3]);
    case 'OF': return orderFabric(chatId, msgId, uid, id, arg, staff, ports, parts[3]);
    case 'OE': return orderAskDesc(chatId, uid, id, ports);
    case 'OD': return orderDue(chatId, msgId, uid, id, arg, staff, ports);
    case 'ODA': return orderAdvance(chatId, msgId, uid, id, arg, staff, updateId, ports);
    case 'OS': return orderStatusTap(chatId, msgId, uid, id, arg, staff, ports);
    case 'OV': return sendVoucher(chatId, id, staff, ports);
    case 'OVP': return sendVoucherPdf(chatId, id, staff, ports);
    case 'ORM': return sendReadyMessage(chatId, id, staff, ports);
    case 'ODL': return startDeliver(chatId, uid, id, staff, ports);
    case 'ODU': return deliverPool(chatId, msgId, id, arg, staff, ports);
    case 'ODP': return deliverPaid(chatId, msgId, uid, id, arg, parts[3], staff, updateId, ports);
    // ODM|<orderId>|<KEY>|<amount>|<pool>
    case 'ODM': return deliverCommit(chatId, msgId, uid, id, Math.max(0, Math.round(Number(parts[3]) || 0)), arg, parts[4], staff, updateId, ports);
    case 'OX': return startCancel(chatId, uid, id, staff, ports);
    case 'OXR': return cancelMode(chatId, msgId, uid, id, arg, staff, updateId, ports);
    case 'OXM': return cancelCommit(chatId, msgId, uid, id, 'refund', arg, staff, updateId, ports);
    case 'OT': return startAttachTag(chatId, uid, id, staff, ports);
    case 'OTL': return attachTagLine(chatId, msgId, uid, id, arg, ports);
    case 'MS': return startMeasure(chatId, uid, id, staff, ports);
    case 'MM': return measMode(chatId, msgId, uid, id, arg, staff, ports);
    case 'MQ': return measStep(chatId, msgId, uid, id, arg, staff, ports);
    case 'MK': return measSave(chatId, msgId, uid, id, staff, ports);
    case 'MF': return measFix(chatId, msgId, uid, id, staff, ports);
    case 'MG': return measFixGroup(chatId, msgId, uid, id, arg, ports);
    case 'ML': return measFixField(chatId, msgId, uid, id, arg, ports);
    case 'MP': return sendMeasPdf(chatId, id, staff, ports);
    default: return;
  }
}

/** Order steps whose screen waits for a number, and the await_number purpose that takes it. */
var ORDER_NUMBER_STEPS = { price: 'order_price', qty: 'order_qty', advance: 'order_advance' };

/**
 * Typed (n = the parsed number or null) or spoken (intent given) text while an order or measurement state is
 * open. Returns a truthy result when it handled the text, null to let the caller go on (AI, fallback).
 */
function orderStateText(chatId, uid, state, text, n, intent, staff, updateId, ports) {
  if (!state || !text) return null;
  if (state.kind === 'meas') {
    // A voice note feeds only an open question or a fix; on the method or summary screen it goes on to the AI (a sale is not swallowed).
    if (intent && state.step !== 'q' && state.step !== 'fix') return null;
    return measTextInput(chatId, uid, state, text, staff, ports) || true;
  }
  if (state.kind === 'meas_pick') return measPickNamed(chatId, uid, state, intent ? (intent.customer || text) : text, staff, ports) || true;
  if (state.kind !== 'order') return null;
  if (!intent && n !== null && ORDER_NUMBER_STEPS[state.step]) {
    return orderAwaitedNumber(chatId, uid, { purpose: ORDER_NUMBER_STEPS[state.step], orderId: state.orderId, saved: state }, n, staff, updateId, ports) || true;
  }
  if (state.step === 'due' && parseDayText(text, ports.clock.now())) return orderDueTyped(chatId, uid, state, text, ports) || true;
  var said = text, name = null;
  if (intent) {
    name = intent.customer || intent.item_hint || text;
    if (state.step === 'design' || state.step === 'code') said = intent.item_hint || text;
    if (state.step === 'fabric' || state.step === 'desc') said = intent.note || text;
  }
  return orderTextInput(chatId, uid, state, said, name, staff, updateId, ports);
}

/** After an undo or void of a group whose id is an order id: the status goes back (READY, or what it was before a cancel). */
function orderUndoLine(ports, groupId, staff) {
  if (!isOrderId(groupId) || !ordersEnabled(ports)) return '';
  var status = orderAfterUndo(ports, groupId, staff);
  return status ? '\n' + t(ports, 'dlv_undone', { status: orderStatusLabel(ports, status) }) : '';
}

function orderMenu(chatId, staff, ports) {
  return ports.chat.sendMessage(chatId, t(ports, 'ord_menu'), [
    [btn(t(ports, 'btn_order_new'), 'ON'), btn(t(ports, 'btn_order_list'), 'OL|open|0')],
    [btn(t(ports, 'btn_measure'), 'MS|pick'), btn(t(ports, 'btn_cancel'), 'Z')]
  ]);
}

/** OL|open|<offset>: open orders of the staff's shop (owner: all), due date first, 8 per page. */
function showOrderList(chatId, msgId, staff, offset, ports) {
  var list = openOrders(ports, staff.role === 'owner' ? null : staff.shop), today = dayKey(ports.clock.now());
  var send = function (text, kb) { if (msgId) ports.chat.editMessage(chatId, msgId, text, kb || [], false); else ports.chat.sendMessage(chatId, text, kb || []); };
  if (!list.length) return send(t(ports, 'ord_list_none'));
  offset = Math.max(0, Number(offset) || 0);
  var rows = list.slice(offset, offset + CFG.ORDERS_PAGE).map(function (o) { return [btn(orderListLabel(ports, o, today), 'O|' + o.id)]; });
  if (offset + CFG.ORDERS_PAGE < list.length) rows.push([btn(t(ports, 'btn_more'), 'OL|open|' + (offset + CFG.ORDERS_PAGE))]);
  return send(t(ports, 'ord_list_title', { n: fmtCount(list.length) }), rows);
}

function openOrderCard(chatId, orderId, staff, uid, ports) {
  clearState(ports, uid);
  return sendOrderCard(chatId, null, orderId, staff, ports);
}

/** O|<orderId>: the card, with the buttons the status allows; staff of the other shop see it read-only. */
function sendOrderCard(chatId, msgId, orderId, staff, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  var canEdit = canEditOrder(staff, order);
  var text = orderCardText(ports, order);
  if (!canEdit) text += '\n' + t(ports, 'ord_other_shop', { shop: shopName(ports, order.shop) });
  var kb = orderCardKeyboard(ports, order, staff, canEdit);
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

function orderCardKeyboard(ports, order, staff, canEdit) {
  var id = order.id, S = CFG.ORDER_STATUS, rows = [];
  var measRow = [btn(t(ports, 'btn_measure'), 'MS|' + id), btn(t(ports, 'btn_voucher'), 'OV|' + id)];
  if (order.measId) measRow.push(btn(t(ports, 'btn_meas_pdf'), 'MP|' + id));
  if (order.status === S.DELIVERED) {
    var row = [btn(t(ports, 'btn_receipt'), 'RC|' + id)];
    if (orderMoney(ports, id, order).owed > 0 && canEdit) row.push(btn(t(ports, 'btn_pay'), 'PY|' + id));
    rows.push(row);
    if (order.measId) rows.push([btn(t(ports, 'btn_meas_pdf'), 'MP|' + id)]);
    return rows;
  }
  if (order.status === S.CANCELLED) return [[btn(t(ports, 'btn_voucher'), 'OV|' + id)]];
  if (!canEdit) return [measRow.slice(1)];
  if (order.status === S.READY) {
    rows.push([btn(t(ports, 'btn_deliver'), 'ODL|' + id)]);
    rows.push([btn(t(ports, 'btn_ready_msg'), 'ORM|' + id), btn(t(ports, 'btn_voucher'), 'OV|' + id)]);
    rows.push([btn(t(ports, 'btn_measure'), 'MS|' + id), btn(t(ports, 'btn_more_advance'), 'ODA|' + id + '|ask')]);
    if (order.measId) rows[rows.length - 1].push(btn(t(ports, 'btn_meas_pdf'), 'MP|' + id));
  } else {
    rows.push(nextStatuses(order).slice(0, 3).map(function (s) { return btn(orderStatusLabel(ports, s), 'OS|' + id + '|' + s); }));
    rows.push(measRow);
    rows.push([btn(t(ports, 'btn_more_advance'), 'ODA|' + id + '|ask'), btn(t(ports, 'btn_deliver'), 'ODL|' + id)]);
  }
  var last = [btn(t(ports, 'btn_attach_tag'), 'OT|' + id)];
  if (staff.role === 'owner') last.push(btn(t(ports, 'btn_cancel_order'), 'OX|' + id));
  rows.push(last);
  return rows;
}

/* ------------------------------ new order ------------------------------ */

/** ON: who is the customer? Recent customers as buttons, a new name, cancel. draft may carry spoken hints. */
function startNewOrder(chatId, uid, staff, ports, draft, prefix) {
  setState(ports, uid, { kind: 'order', step: 'customer', draft: draft || {} });
  var rows = recentCustomers(ports, staff.shop, 4).map(function (c) { return [btn(customerLabel(c), 'OC|' + c.id)]; });
  rows.push([btn(t(ports, 'btn_new_customer'), 'OC|new'), btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, (prefix || '') + t(ports, 'ord_ask_customer'), rows);
}

function orderState(ports, uid, orderId) {
  var s = getState(ports, uid);
  if (s && s.kind === 'order' && (!orderId || s.orderId === orderId)) { s.uid = uid; return s; }
  if (orderId) return { kind: 'order', step: 'design', orderId: orderId, draft: {}, uid: uid };
  return { kind: 'order', step: 'customer', draft: {}, uid: uid };
}

/** OC|<customerId|new|create|nophone|viber|noviber>. */
function orderCustomer(chatId, msgId, uid, arg, staff, updateId, ports) {
  var state = orderState(ports, uid, null);
  if (arg === 'new') {
    state.step = 'name';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ask_name'));
  }
  if (arg === 'create') {
    if (!state.draft.name) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
    return orderAskPhone(chatId, uid, state, ports.store.addCustomer({ name: state.draft.name }), ports);
  }
  if (arg === 'nophone') return orderBegin(chatId, uid, state.draft.customerId, staff, ports, state.draft);
  if (arg === 'viber' || arg === 'noviber') {
    var c = ports.store.getCustomer(state.draft.customerId);
    if (c && arg === 'viber' && !/viber/i.test(c.note || '')) ports.store.updateCustomer(c.id, { note: (c.note ? c.note + ' · ' : '') + 'Viber' });
    return orderBegin(chatId, uid, state.draft.customerId, staff, ports, state.draft);
  }
  if (!ports.store.getCustomer(arg)) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  return orderBegin(chatId, uid, arg, staff, ports, state.draft);
}

/** A typed or spoken name: exact match proceeds, a stranger is created and asked for a phone, look-alikes are offered. */
function orderNamed(chatId, uid, state, name, staff, ports) {
  name = String(name || '').trim();
  if (!name) return ports.chat.sendMessage(chatId, t(ports, 'ask_name'));
  var m = matchCustomers(ports, name);
  if (m.exact) return orderBegin(chatId, uid, m.exact.id, staff, ports, state.draft);
  if (!m.partial.length) return orderAskPhone(chatId, uid, state, ports.store.addCustomer({ name: name }), ports);
  state.draft.name = name;
  state.step = 'customer';
  setState(ports, uid, state);
  var rows = m.partial.slice(0, 4).map(function (c) { return [btn(customerLabel(c), 'OC|' + c.id)]; });
  rows.push([btn(t(ports, 'btn_create_named', { name: name }), 'OC|create'), btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, t(ports, 'cust_pick', { name: name }), rows);
}

function orderAskPhone(chatId, uid, state, customer, ports) {
  state.step = 'phone';
  state.draft.customerId = customer.id;
  setState(ports, uid, state);
  return ports.chat.sendMessage(chatId, t(ports, 'ord_ask_phone', { customer: customer.name }), [[btn(t(ports, 'btn_skip'), 'OC|nophone'), btn(t(ports, 'btn_cancel'), 'Z')]]);
}

function orderPhoneTyped(chatId, uid, state, text, staff, ports) {
  var c = ports.store.getCustomer(state.draft.customerId);
  if (!c) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  var digits = normPhone(text);
  if (digits.length < 7) return ports.chat.sendMessage(chatId, t(ports, 'ord_ask_phone', { customer: c.name }), [[btn(t(ports, 'btn_skip'), 'OC|nophone'), btn(t(ports, 'btn_cancel'), 'Z')]]);
  var phone = isValidPhone(text) ? digits : String(text).trim();
  ports.store.updateCustomer(c.id, { phone: phone });
  state.step = 'viber';
  setState(ports, uid, state);
  return ports.chat.sendMessage(chatId, t(ports, 'ord_ask_viber', { phone: fmtPhone(phone) }), [[btn(t(ports, 'btn_viber_yes'), 'OC|viber'), btn(t(ports, 'btn_viber_no'), 'OC|noviber')]]);
}

/** The order row exists from here on (a half-finished order is never lost); then the design screen. */
function orderBegin(chatId, uid, customerId, staff, ports, draft) {
  draft = draft || {};
  var order = createOrder(ports, { shop: staff.shop, customerId: customerId, staff: staff });
  var state = { kind: 'order', step: 'design', orderId: order.id, draft: { advance: draft.advance || null }, uid: uid };
  setState(ports, uid, state);
  if (draft.designHint) {
    var d = findDesign(ports, draft.designHint);
    if (d) return orderPickDesign(chatId, null, uid, state, d, ports, draft);
  }
  return sendDesignScreen(chatId, null, state, ports);
}

function sendDesignScreen(chatId, msgId, state, ports) {
  var order = ports.store.getOrder(state.orderId), id = state.orderId;
  var lines = orderLinesText(ports, id);
  var text = t(ports, 'ord_head', { no: orderNo(id), customer: customerName(ports, order.customerId) }) + (lines ? '\n' + lines : '') + '\n' + t(ports, 'ord_ask_design');
  var rows = [], row = [];
  designsForButtons(ports).forEach(function (d) {
    if (utf8ByteLength('OI|' + id + '|' + d.code) > 64) return;   // typed codes still find it (findDesign)
    row.push(btn(designLabel(d) + (d.basePrice ? ' · ' + fmtMoney(d.basePrice) : ''), 'OI|' + id + '|' + d.code));
    if (row.length === 2) { rows.push(row); row = []; }
  });
  if (row.length) rows.push(row);
  rows.push([btn(t(ports, 'btn_design_type'), 'OI|' + id + '|type'), btn(t(ports, 'btn_design_none'), 'OI|' + id + '|none')]);
  rows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  state.step = 'design';
  delete state.pending;
  setState(ports, state.uid, state);
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, rows, false);
  return ports.chat.sendMessage(chatId, text, rows);
}

/** OI|<orderId>|<code|type|none|create>. */
function orderDesign(chatId, msgId, uid, orderId, code, staff, ports) {
  var state = orderState(ports, uid, orderId);
  if (code === 'type') {
    state.step = 'code';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ord_ask_design_code'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
  }
  if (code === 'none') return orderPickDesign(chatId, msgId, uid, state, null, ports, null);
  if (code === 'create') return orderCreateDesign(chatId, msgId, uid, state, staff, ports);
  var d = ports.store.getDesign(code);
  if (!d) return ports.chat.sendMessage(chatId, t(ports, 'ord_design_unknown', { code: code }));
  return orderPickDesign(chatId, msgId, uid, state, d, ports, null);
}

function orderCodeTyped(chatId, uid, state, text, staff, ports) {
  var d = findDesign(ports, text);
  if (!d) {
    if (offerNewDesign(chatId, uid, state, text, ports)) return true;
    ports.chat.sendMessage(chatId, t(ports, 'ord_design_unknown', { code: String(text).trim() }));
    return sendDesignScreen(chatId, null, state, ports);
  }
  return orderPickDesign(chatId, null, uid, state, d, ports, null);
}

/**
 * A typed or spoken design nobody knows. When it has the shape of a code (letters, then digits: "tsl 31",
 * "TSL-0031") and the store can add designs, ONE message offers to create it, or to go on without a code; the
 * design screen is not sent again and the step stays, so a retyped code is looked up again. The code is kept as
 * typed ("tsl 31" -> TSL-31, TSL-0031 stays TSL-0031). Returns true when it asked; false for anything else
 * (a name, digits alone, TSL-31A, a store without addDesign): the caller answers as before.
 */
function offerNewDesign(chatId, uid, state, text, ports) {
  var m = String(text).toUpperCase().replace(/[^A-Z0-9-]/g, '').match(/^([A-Z]{1,8})-?(\d{1,6})$/);
  if (!m || !ports.store.addDesign) return false;
  var code = m[1] + '-' + m[2], id = state.orderId;
  if (!state.draft) state.draft = {};
  state.draft.newCode = code;
  setState(ports, uid, state);
  ports.chat.sendMessage(chatId, t(ports, 'ord_design_unknown', { code: code }), [
    [btn(t(ports, 'btn_create_design', { code: code }), 'OI|' + id + '|create'), btn(t(ports, 'btn_design_none'), 'OI|' + id + '|none')],
    [btn(t(ports, 'btn_cancel'), 'Z')]
  ]);
  return true;
}

/**
 * OI|<orderId>|create (every staff member): a Designs row for the code just typed, name and price left for later.
 * The code stays in the draft, so a second tap repeats the same screen and writes no second row (the store
 * answers the existing design). The tapped message says it was created; the next screen is a new message.
 */
function orderCreateDesign(chatId, msgId, uid, state, staff, ports) {
  var code = state.draft ? state.draft.newCode : '';
  if (!code || !ports.store.addDesign) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  var d = ports.store.addDesign({ code: code, name: '', category: '', basePrice: '', daysToMake: '', active: true,
    note: 'added by ' + (staff.name || staff.id) + ' ' + dayKey(ports.clock.now()) });
  ports.chat.editMessage(chatId, msgId, t(ports, 'design_created', { code: d.code }), [], false);
  return orderPickDesign(chatId, null, uid, state, d, ports, null);
}

/** A design (or none) is chosen: the price is asked only when the design has no base price, then the quantity. */
function orderPickDesign(chatId, msgId, uid, state, d, ports, spoken) {
  state.uid = uid;
  state.pending = { designCode: d ? d.code : '', designName: d ? d.name : '', category: d ? d.category : '',
                    unitPrice: spoken && spoken.unitPrice ? Number(spoken.unitPrice) : (d && Number(d.basePrice) > 0 ? Number(d.basePrice) : null) };
  if (spoken && spoken.qty && state.pending.unitPrice) {
    setState(ports, uid, state);
    return orderQty(chatId, msgId, uid, state.orderId, spoken.qty, null, ports);
  }
  if (state.pending.unitPrice) return sendQtyScreen(chatId, msgId, uid, state, ports);
  return sendPriceScreen(chatId, msgId, uid, state, ports);
}

function pendingLabel(ports, state) {
  var p = state.pending || {};
  return p.designCode ? p.designCode + (p.designName ? ' · ' + p.designName : '') : t(ports, 'ord_no_code');
}

function sendPriceScreen(chatId, msgId, uid, state, ports) {
  state.step = 'price';
  setState(ports, uid, state);
  var id = state.orderId;
  var presets = pricePresets(ports, state.pending.category || null, null).map(function (p) { return btn(fmtMoney(p), 'OP|' + id + '|' + p); });
  var kb = [presets, [btn(t(ports, 'btn_other'), 'OP|' + id + '|other'), btn(t(ports, 'btn_cancel'), 'Z')]];
  var text = t(ports, 'ord_ask_price', { design: pendingLabel(ports, state) });
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

/** OP|<orderId>|<price|other>. */
function orderPrice(chatId, msgId, uid, orderId, arg, staff, ports) {
  var state = orderState(ports, uid, orderId);
  if (!state.pending) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'order_price', orderId: orderId, saved: state });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_number'), [], false);
  }
  state.pending.unitPrice = Math.max(0, Math.round(Number(arg) || 0));
  return sendQtyScreen(chatId, msgId, uid, state, ports);
}

function sendQtyScreen(chatId, msgId, uid, state, ports) {
  state.step = 'qty';
  setState(ports, uid, state);
  var id = state.orderId;
  var kb = [[btn(myDigits(1), 'OQ|' + id + '|1'), btn(myDigits(2), 'OQ|' + id + '|2'), btn(myDigits(3), 'OQ|' + id + '|3'), btn(t(ports, 'btn_other'), 'OQ|' + id + '|other')],
            [btn(t(ports, 'btn_cancel'), 'Z')]];
  var text = t(ports, 'ord_ask_qty', { design: pendingLabel(ports, state) + (state.pending.unitPrice ? ' · ' + fmtMoney(state.pending.unitPrice) : '') });
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

/** OQ|<orderId>|<n|other>: the line is written; then the due-date screen (with another-line, fabric and description buttons). */
function orderQty(chatId, msgId, uid, orderId, arg, staff, ports) {
  var state = orderState(ports, uid, orderId);
  if (!state.pending && state.step === 'due') return null;   // a second tap on the same quantity: the line exists already
  if (!state.pending) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'order_qty', orderId: orderId, saved: state });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_qty_number'), [], false);
  }
  var qty = clampQty(arg), p = state.pending;
  var line = addOrderLine(ports, orderId, { designCode: p.designCode, fabric: p.fabric || '', description: p.description || '', qty: qty, unitPrice: p.unitPrice || 0 });
  state.lastLine = { designCode: line.designCode, fabric: line.fabric, description: line.description, qty: line.qty, unitPrice: line.unitPrice };
  delete state.pending;
  return sendDueScreen(chatId, msgId, uid, state, ports);
}

/**
 * The running card with the due-date buttons; another line, fabric and description are optional buttons here.
 * prefix: the line a flow resumed after ➕ puts in front (a new fabric was added and set on the last line).
 */
function sendDueScreen(chatId, msgId, uid, state, ports, prefix) {
  var order = ports.store.getOrder(state.orderId), id = state.orderId;
  state.step = 'due';
  setState(ports, uid, state);
  var text = t(ports, 'ord_head', { no: orderNo(id), customer: customerName(ports, order.customerId) }) + '\n' + orderLinesText(ports, id) + '\n' +
             t(ports, 'ord_total', { total: fmtMoney(orderTotal(ports, id)) }) + '\n' + (order.dueDay ? t(ports, 'ord_due_set', { date: fmtDayMy(order.dueDay) }) : t(ports, 'ord_ask_due'));
  text = withPrefix(prefix, text);
  var rows = [], dayRow = [];
  var suggested = 0, suggestedCode = '';
  orderLines(ports, id).forEach(function (l) {
    var d = l.designCode ? ports.store.getDesign(l.designCode) : null;
    if (d && Number(d.daysToMake) > suggested) { suggested = Number(d.daysToMake); suggestedCode = d.code; }
  });
  if (suggested) dayRow.push(btn(t(ports, 'btn_days_design', { n: myDigits(suggested), code: suggestedCode }), 'OD|' + id + '|' + suggested));
  duePresets(ports).forEach(function (n) { if (n !== suggested) dayRow.push(btn(t(ports, 'btn_days', { n: myDigits(n) }), 'OD|' + id + '|' + n)); });
  rows.push(dayRow.slice(0, 4));
  var nLines = orderLines(ports, id).length;
  rows.push([btn(t(ports, 'btn_due_type'), 'OD|' + id + '|type'), btn(t(ports, 'btn_add_line'), 'OA|' + id + '|add'), btn(t(ports, 'btn_same_line'), 'OA|' + id + '|same|' + nLines)]);
  rows.push([btn(t(ports, 'btn_fabric'), 'OF|' + id + '|ask'), btn(t(ports, 'btn_desc'), 'OE|' + id), btn(t(ports, 'btn_pop_line'), 'OA|' + id + '|pop|' + nLines)]);
  rows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, rows, false);
  return ports.chat.sendMessage(chatId, text, rows);
}

/** OA|<orderId>|<add|same|pop>|<lines on screen>: a repeated tap (the count no longer matches) only redraws the screen. */
function orderMore(chatId, msgId, uid, orderId, arg, staff, ports, seen) {
  var state = orderState(ports, uid, orderId);
  if (arg === 'add') return sendDesignScreen(chatId, msgId, state, ports);
  if (seen !== undefined && seen !== '' && Number(seen) !== orderLines(ports, orderId).length) return sendDueScreen(chatId, msgId, uid, state, ports);
  if (arg === 'same') {
    var last = state.lastLine || orderLines(ports, orderId).slice(-1)[0];
    if (!last) return sendDesignScreen(chatId, msgId, state, ports);
    addOrderLine(ports, orderId, last);
    return sendDueScreen(chatId, msgId, uid, state, ports);
  }
  if (arg === 'pop') {
    popOrderLine(ports, orderId);
    if (!orderLines(ports, orderId).length) return sendDesignScreen(chatId, msgId, state, ports);
    return sendDueScreen(chatId, msgId, uid, state, ports);
  }
  return sendDueScreen(chatId, msgId, uid, state, ports);
}

function lastOrderLine(ports, orderId) {
  var lines = orderLines(ports, orderId);
  return lines.length ? lines[lines.length - 1] : null;
}

/**
 * OF|<orderId>|<ask|k|own|type>|<key>: the fabric of the last line. The screen offers the active fabric options of
 * the order's shop, three per row, by KEY (OF|<id>|k|<key>: reordering the list never changes what a button means),
 * then "customer's own" and "other" (typed), then ➕ (add a fabric to the list) and cancel. A button of an older
 * screen (OF|<id>|<index>) still works: the index is read on the list as it is now.
 */
function orderFabric(chatId, msgId, uid, orderId, arg, staff, ports, key) {
  var state = orderState(ports, uid, orderId), last = lastOrderLine(ports, orderId);
  if (!last) return sendDesignScreen(chatId, msgId, state, ports);
  var order = ports.store.getOrder(orderId);
  var options = fabricOptions(ports, order ? order.shop : null);
  if (arg === 'ask') {
    var rows = [], row = [];
    options.forEach(function (f) {
      var data = 'OF|' + orderId + '|k|' + f.key;
      if (utf8ByteLength(data) > 64) return;
      row.push(btn(f.label, data));
      if (row.length === 3) { rows.push(row); row = []; }
    });
    if (row.length) rows.push(row);
    rows.push([btn(t(ports, 'btn_own_fabric'), 'OF|' + orderId + '|own'), btn(t(ports, 'btn_other'), 'OF|' + orderId + '|type')]);
    rows.push([btn(t(ports, 'btn_add_option'), 'LA|fb|OF|' + orderId), btn(t(ports, 'btn_cancel'), 'Z')]);
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ord_ask_fabric') + '\n' + orderLineDesc(ports, last), rows, false);
  }
  if (arg === 'type') {
    state.step = 'fabric';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ord_ask_fabric_text'));
  }
  var fabric = '';
  if (arg === 'own') fabric = t(ports, 'ord_own_fabric');
  else if (arg === 'k') {
    var picked = listOption(ports, 'fabric', key);       // a retired fabric still resolves: the button was valid when shown
    fabric = picked ? picked.label : '';
  } else if (/^\d+$/.test(String(arg))) {
    fabric = options[Number(arg)] ? options[Number(arg)].label : '';
  }
  if (!fabric) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  ports.store.updateOrderItem(orderId, last.line, { fabric: fabric });
  return sendDueScreen(chatId, msgId, uid, state, ports);
}

/**
 * The fabric screen after ➕ added (or found) the fabric called label: it is set on the last line and the due screen
 * comes back as one new message. The order must still be open with a line, and the state that came back must be
 * this order's (or none); otherwise prefix + expired.
 */
function resumeFabric(chatId, uid, orderId, label, ports, prefix) {
  var order = ports.store.getOrder(orderId);
  var last = order && orderIsOpen(order) ? lastOrderLine(ports, orderId) : null;
  var cur = getState(ports, uid);
  if (!last || (cur && !(cur.kind === 'order' && cur.orderId === orderId))) {
    return ports.chat.sendMessage(chatId, withPrefix(prefix, t(ports, 'expired')));
  }
  ports.store.updateOrderItem(orderId, last.line, { fabric: label });
  return sendDueScreen(chatId, null, uid, orderState(ports, uid, orderId), ports, prefix);
}

function orderFabricTyped(chatId, uid, state, text, ports) {
  var last = lastOrderLine(ports, state.orderId);
  if (last) ports.store.updateOrderItem(state.orderId, last.line, { fabric: String(text).trim() });
  return sendDueScreen(chatId, null, uid, state, ports);
}

/** OE|<orderId>: the description of the last line is typed (or spoken). */
function orderAskDesc(chatId, uid, orderId, ports) {
  var state = orderState(ports, uid, orderId);
  state.step = 'desc';
  setState(ports, uid, state);
  return ports.chat.sendMessage(chatId, t(ports, 'ord_ask_desc'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
}

function orderDescTyped(chatId, uid, state, text, ports) {
  var last = lastOrderLine(ports, state.orderId);
  if (last) ports.store.updateOrderItem(state.orderId, last.line, { description: String(text).trim() });
  return sendDueScreen(chatId, null, uid, state, ports);
}

/** OD|<orderId>|<days|type>. */
function orderDue(chatId, msgId, uid, orderId, arg, staff, ports) {
  var state = orderState(ports, uid, orderId);
  if (!orderLines(ports, orderId).length) return ports.chat.sendMessage(chatId, t(ports, 'ord_no_lines'));
  if (arg === 'type') {
    state.step = 'due_text';
    setState(ports, uid, state);
    return ports.chat.sendMessage(chatId, t(ports, 'ord_ask_due_text'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
  }
  var due = addDaysKey(dayKey(ports.clock.now()), Math.max(0, Number(arg) || 0));
  ports.store.updateOrder(orderId, { dueDay: due });
  return sendAdvanceScreen(chatId, msgId, uid, orderId, ports);
}

function orderDueTyped(chatId, uid, state, text, ports) {
  var key = parseDayText(text, ports.clock.now());
  if (!key) return ports.chat.sendMessage(chatId, t(ports, 'ord_bad_date'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
  ports.store.updateOrder(state.orderId, { dueDay: key });
  ports.chat.sendMessage(chatId, t(ports, 'ord_due_set', { date: fmtDayMy(key) }));
  return sendAdvanceScreen(chatId, null, uid, state.orderId, ports);
}

/** The advance: all, half, the deposit presets under the total, 0, other. A spoken advance comes first. */
function sendAdvanceScreen(chatId, msgId, uid, orderId, ports) {
  var state = orderState(ports, uid, orderId);
  state.step = 'advance';
  setState(ports, uid, state);
  var m = orderMoney(ports, orderId), left = m.owed, id = orderId;
  var amounts = [], seen = {};
  function add(a) { a = Math.round(a); if (a > 0 && a <= left && !seen[a]) { seen[a] = true; amounts.push(a); } }
  if (state.draft && state.draft.advance) add(state.draft.advance);
  add(left);
  add(left / 2);
  depositPresets(ports).forEach(add);
  var row = amounts.slice(0, 4).map(function (a) {
    var label = a === left ? t(ports, 'btn_all', { amount: fmtMoney(a) }) : (a === Math.round(left / 2) ? t(ports, 'btn_half', { amount: fmtMoney(a) }) : fmtMoney(a));
    return btn(label, 'ODA|' + id + '|' + a);
  });
  var kb = [row, [btn('0', 'ODA|' + id + '|0'), btn(t(ports, 'btn_other'), 'ODA|' + id + '|other'), btn(t(ports, 'btn_cancel'), 'Z')]];
  var text = t(ports, 'ord_ask_advance', { total: fmtMoney(m.total) }) + (m.deposit ? '\n' + t(ports, 'voucher_deposit', { deposit: fmtMoney(m.deposit), method: '' }) : '');
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

/** ODA|<orderId>|<amount|0|other|ask>: the advance is an ordinary DEPOSIT earmarked to the voucher (RefGroupID = order id). */
function orderAdvance(chatId, msgId, uid, orderId, arg, staff, updateId, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  if (arg === 'ask') {
    if (!orderIsOpen(order)) return ports.chat.sendMessage(chatId, t(ports, 'ord_closed'));
    return sendAdvanceScreen(chatId, null, uid, orderId, ports);
  }
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'order_advance', orderId: orderId });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_number'), [], false);
  }
  var amount = Math.max(0, Math.round(Number(arg) || 0));
  if (!amount) return sendVoucherReply(chatId, msgId, uid, orderId, null, staff, ports);
  var r = commitDeposit(ports, { customerId: order.customerId, amount: amount, note: orderId, refGroupId: orderId, method: null, shop: order.shop,
    staff: staff, source: CFG.SOURCE.BUTTON, updateId: updateId });
  setLastGroup(ports, uid, r.groupId);
  return sendVoucherReply(chatId, msgId, uid, orderId, r.groupId, staff, ports);
}

/** The voucher message after the order is complete: forward it, PDF, measurements, the card; 🏦 and undo for the advance. */
function sendVoucherReply(chatId, msgId, uid, orderId, depositGroupId, staff, ports) {
  clearState(ports, uid);
  ports.store.updateOrder(orderId, { voucherSentAt: ports.clock.now().toISOString() });
  var text = t(ports, 'ord_created', { no: orderNo(orderId) }) + '\n' + voucherText(ports, orderId);
  var kb = [[btn(t(ports, 'btn_measure'), 'MS|' + orderId), btn(t(ports, 'btn_voucher_pdf'), 'OVP|' + orderId), btn(t(ports, 'btn_card'), 'O|' + orderId)]];
  if (depositGroupId) {
    // The advance was written as cash: one 🏦 button per account of the order's shop, ➕ for a new one.
    var order = ports.store.getOrder(orderId);
    kb = kb.concat(methodRows(ports, order ? order.shop : staff.shop, CFG.METHOD.CASH, groupMethodData(depositGroupId), { add: 'LA|pm|PM|' + depositGroupId }));
    kb.push([btn(t(ports, 'btn_undo'), 'U|' + depositGroupId)]);
  }
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

/** Typed or spoken text while an order is being written. Returns a truthy result when handled. */
function orderTextInput(chatId, uid, state, text, name, staff, updateId, ports) {
  state.uid = uid;
  switch (state.step) {
    case 'customer': case 'name': return orderNamed(chatId, uid, state, name || text, staff, ports) || true;
    case 'phone': return orderPhoneTyped(chatId, uid, state, text, staff, ports) || true;
    case 'code': return orderCodeTyped(chatId, uid, state, text, staff, ports) || true;
    case 'design': {
      var d = findDesign(ports, text);
      if (d) return orderPickDesign(chatId, null, uid, state, d, ports, null) || true;
      if (offerNewDesign(chatId, uid, state, text, ports)) return true;
      ports.chat.sendMessage(chatId, t(ports, 'ord_design_unknown', { code: String(text).trim() }));
      return sendDesignScreen(chatId, null, state, ports) || true;
    }
    case 'fabric': return orderFabricTyped(chatId, uid, state, text, ports) || true;
    case 'desc': return orderDescTyped(chatId, uid, state, text, ports) || true;
    case 'due_text': return orderDueTyped(chatId, uid, state, text, ports) || true;
    default: return null;
  }
}

/** The numbers typed during an order (await_number purposes order_price, order_qty, order_advance, deliver_paid). */
function orderAwaitedNumber(chatId, uid, state, n, staff, updateId, ports) {
  if (state.purpose === 'order_price') {
    var sp = state.saved || orderState(ports, uid, state.orderId);
    sp.uid = uid;
    if (!sp.pending) sp.pending = { designCode: '', designName: '', unitPrice: null };
    sp.pending.unitPrice = Math.max(0, Math.round(n));
    return sendQtyScreen(chatId, null, uid, sp, ports);
  }
  if (state.purpose === 'order_qty') {
    var sq = state.saved || orderState(ports, uid, state.orderId);
    if (n < 1 || n > CFG.MAX_SALE_QTY || n !== Math.round(n)) {
      setState(ports, uid, state);
      return ports.chat.sendMessage(chatId, t(ports, 'bad_qty', { max: myDigits(CFG.MAX_SALE_QTY) }), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
    }
    sq.uid = uid;
    setState(ports, uid, sq);
    return orderQty(chatId, null, uid, state.orderId, n, staff, ports);
  }
  if (state.purpose === 'order_advance') return orderAdvance(chatId, null, uid, state.orderId, n, staff, updateId, ports);
  if (state.purpose === 'deliver_paid') return deliverPaid(chatId, null, uid, state.orderId, n, state.usePool ? '1' : '0', staff, updateId, ports);
  return null;
}

/* ------------------------------ card actions: status, voucher, ready ------------------------------ */

/** OS|<orderId>|<STATUS>: forward only; READY pings the shop and the owner so the customer can be told. */
function orderStatusTap(chatId, msgId, uid, orderId, status, staff, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  if (!canEditOrder(staff, order)) return ports.chat.sendMessage(chatId, t(ports, 'ord_other_shop', { shop: shopName(ports, order.shop) }));
  var r = setOrderStatus(ports, orderId, status, staff);
  if (!r.ok) {
    if (r.reason === 'closed') return ports.chat.sendMessage(chatId, t(ports, 'ord_closed'));
    if (r.reason === 'backward') return ports.chat.sendMessage(chatId, t(ports, 'ord_status_back'));
    return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  }
  sendOrderCard(chatId, msgId, orderId, staff, ports);
  if (status === CFG.ORDER_STATUS.READY) {
    var text = t(ports, 'ord_ready_ping', { no: orderNo(orderId), customer: customerName(ports, order.customerId) });
    var kb = [[btn(t(ports, 'btn_ready_msg'), 'ORM|' + orderId), btn(t(ports, 'btn_card'), 'O|' + orderId)]];
    ports.store.listStaff().forEach(function (s) {
      if (s.id === String(uid)) return;
      if (s.role !== 'owner' && s.shop !== order.shop) return;
      try { ports.chat.sendMessage(s.id, text, kb); } catch (err) { ports.store.logError('ready_ping', err, '', s.id); }
    });
  }
}

/** OV|<orderId>: the voucher as text to forward; OVP: the same as an A5 PDF document. */
function sendVoucher(chatId, orderId, staff, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  ports.store.updateOrder(orderId, { voucherSentAt: ports.clock.now().toISOString() });
  return ports.chat.sendMessage(chatId, voucherText(ports, orderId), [[btn(t(ports, 'btn_voucher_pdf'), 'OVP|' + orderId), btn(t(ports, 'btn_card'), 'O|' + orderId)]]);
}

function sendVoucherPdf(chatId, orderId, staff, ports) {
  var report = buildReport(ports, 'voucher', { orderId: orderId, now: ports.clock.now() });
  if (!report) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  ports.chat.typing(chatId);
  return ports.chat.sendDocument(chatId, ports.pdf.make(report), t(ports, 'voucher_caption', { no: orderNo(orderId) }));
}

/** ORM|<orderId>: a short "ready, come and collect" message to forward to the customer. */
function sendReadyMessage(chatId, orderId, staff, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  return ports.chat.sendMessage(chatId, readyMessage(ports, order), [[btn(t(ports, 'btn_card'), 'O|' + orderId)]]);
}

/* ------------------------------ delivery ------------------------------ */

/** ODL|<orderId>: the earmarked advance is applied by itself; a free pooled deposit is used only after a yes. */
function startDeliver(chatId, uid, orderId, staff, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  if (!canEditOrder(staff, order)) return ports.chat.sendMessage(chatId, t(ports, 'ord_other_shop', { shop: shopName(ports, order.shop) }));
  if (!orderIsOpen(order)) return ports.chat.sendMessage(chatId, t(ports, 'ord_closed'));
  if (!orderLines(ports, orderId).length) return ports.chat.sendMessage(chatId, t(ports, 'ord_no_lines'));
  clearState(ports, uid);
  var m = orderMoney(ports, orderId, order), pool = depositsFree(ports, order.customerId);
  if (pool > 0 && m.owed > 0) {
    return ports.chat.sendMessage(chatId, t(ports, 'dlv_ask_pool', { customer: customerName(ports, order.customerId), pool: fmtMoney(pool) }),
      [[btn(t(ports, 'btn_pool_yes'), 'ODU|' + orderId + '|yes'), btn(t(ports, 'btn_pool_no'), 'ODU|' + orderId + '|no')], [btn(t(ports, 'btn_cancel'), 'Z')]]);
  }
  return sendDeliverPaidScreen(chatId, null, orderId, '0', staff, ports);
}

/** ODU|<orderId>|<yes|no>. */
function deliverPool(chatId, msgId, orderId, arg, staff, ports) {
  return sendDeliverPaidScreen(chatId, msgId, orderId, arg === 'yes' ? '1' : '0', staff, ports);
}

function deliverRemaining(ports, order, usePool) {
  var m = orderMoney(ports, order.id, order), left = m.owed, pooled = 0;
  if (usePool === '1') { pooled = Math.min(depositsFree(ports, order.customerId), left); left -= pooled; }
  return { total: m.total, deposit: m.deposit + pooled, owed: Math.max(0, left) };
}

function sendDeliverPaidScreen(chatId, msgId, orderId, usePool, staff, ports) {
  var order = ports.store.getOrder(orderId);
  var r = deliverRemaining(ports, order, usePool), id = orderId;
  var text = t(ports, 'dlv_ask_paid', { no: orderNo(id), customer: customerName(ports, order.customerId),
    money: t(ports, 'ord_money', { total: fmtMoney(r.total), deposit: fmtMoney(r.deposit), owed: fmtMoney(r.owed) }) });
  var kb = [[btn(t(ports, 'btn_all', { amount: fmtMoney(r.owed) }), 'ODP|' + id + '|all|' + usePool), btn('0', 'ODP|' + id + '|0|' + usePool), btn(t(ports, 'btn_other'), 'ODP|' + id + '|other|' + usePool)],
            [btn(t(ports, 'btn_cancel'), 'Z')]];
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

/** ODP|<orderId>|<all|0|amount|other>|<pool>: 0 commits at once; a positive amount asks how it was paid. */
function deliverPaid(chatId, msgId, uid, orderId, arg, usePool, staff, updateId, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order || !orderIsOpen(order)) return ports.chat.sendMessage(chatId, t(ports, 'ord_closed'));
  if (arg === 'other') {
    setState(ports, uid, { kind: 'await_number', purpose: 'deliver_paid', orderId: orderId, usePool: usePool === '1' });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ask_number'), [], false);
  }
  var r = deliverRemaining(ports, order, usePool);
  var paid = arg === 'all' ? r.owed : Math.min(r.owed, Math.max(0, Math.round(Number(arg) || 0)));
  if (!paid) return deliverCommit(chatId, msgId, uid, orderId, 0, null, usePool, staff, updateId, ports);
  var text = t(ports, 'dlv_ask_method', { no: orderNo(orderId), amount: fmtMoney(paid) });
  var kb = methodRows(ports, order.shop, null, function (k) { return 'ODM|' + orderId + '|' + k + '|' + paid + '|' + usePool; },
    { add: 'LA|pm|ODM|' + orderId + '|' + paid + '|' + usePool });
  kb.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

/**
 * ODM|<orderId>|<KEY>|<amount>|<pool> and the paid-0 path: one ledger group, the receipt, the credit hand-off.
 * prefix and hint (and no msgId): resumed after ➕ added the account, as one new message.
 */
function deliverCommit(chatId, msgId, uid, orderId, paid, method, usePool, staff, updateId, ports, prefix, hint) {
  var r = deliverOrder(ports, { orderId: orderId, paid: paid, method: method, usePool: usePool === '1', staff: staff, updateId: updateId, source: CFG.SOURCE.BUTTON });
  if (!r.ok) {
    var why = r.reason === 'closed' ? t(ports, 'ord_closed') : r.reason === 'no_lines' ? t(ports, 'ord_no_lines') : t(ports, 'expired');
    return editOrSend(ports, chatId, msgId, withHintLine(withPrefix(prefix, why), hint), withHintRow([], hint));
  }
  clearState(ports, uid);
  setLastGroup(ports, uid, orderId);
  markCommittedCard(ports, chatId, msgId);
  var receipt = buildReceipt(ports, orderId);
  var text = t(ports, 'dlv_done', { no: orderNo(orderId) }) + '\n' + receiptText(ports, receipt) + methodLine(ports, method);
  var kb = [[btn(t(ports, 'btn_undo'), 'U|' + orderId), btn(t(ports, 'btn_pdf'), 'RCP|' + orderId)]];
  if (r.info && r.info.owed > 0) {
    text += '\n' + t(ports, 'dlv_owed', { owed: fmtMoney(r.info.owed) });
    kb.push([btn(t(ports, 'btn_pay'), 'PY|' + orderId)]);
  }
  return editOrSend(ports, chatId, msgId, withHintLine(withPrefix(prefix, text), hint), withHintRow(kb, hint));
}

/* ------------------------------ cancel (owner) ------------------------------ */

/** OX|<orderId>: refund the advance, keep it as a fee, or just close an unpaid order. */
function startCancel(chatId, uid, orderId, staff, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  if (staff.role !== 'owner') return ports.chat.sendMessage(chatId, t(ports, 'ord_owner_only'));
  if (!orderIsOpen(order)) return ports.chat.sendMessage(chatId, t(ports, 'ord_closed'));
  var earmark = depositEarmark(ports, order.customerId, orderId);
  var text = t(ports, 'cx_ask', { no: orderNo(orderId), deposit: earmark ? t(ports, 'cx_deposit', { amount: fmtMoney(earmark) }) : '' });
  var row = earmark ? [btn(t(ports, 'btn_refund'), 'OXR|' + orderId + '|refund'), btn(t(ports, 'btn_keep'), 'OXR|' + orderId + '|keep')]
                    : [btn(t(ports, 'btn_cancel_confirm'), 'OXR|' + orderId + '|none')];
  return ports.chat.sendMessage(chatId, text, [row, [btn(t(ports, 'btn_cancel'), 'Z')]]);
}

/** OXR|<orderId>|<refund|keep|none>: a refund asks the method first. */
function cancelMode(chatId, msgId, uid, orderId, mode, staff, updateId, ports) {
  if (staff.role !== 'owner') return ports.chat.sendMessage(chatId, t(ports, 'ord_owner_only'));
  var order = ports.store.getOrder(orderId);
  if (!order || !orderIsOpen(order)) return ports.chat.editMessage(chatId, msgId, t(ports, 'ord_closed'), [], false);
  if (mode === 'refund') {
    var amount = depositEarmark(ports, order.customerId, orderId);
    var kb = methodRows(ports, order.shop, null, function (k) { return 'OXM|' + orderId + '|' + k; }, { add: 'LA|pm|OXM|' + orderId });
    kb.push([btn(t(ports, 'btn_cancel'), 'Z')]);
    return ports.chat.editMessage(chatId, msgId, t(ports, 'cx_ask_method', { amount: fmtMoney(amount) }), kb, false);
  }
  return cancelCommit(chatId, msgId, uid, orderId, mode, null, staff, updateId, ports);
}

/**
 * OXM|<orderId>|<KEY> and the keep/none path.
 * prefix and hint (and no msgId): resumed after ➕ added the account, as one new message.
 */
function cancelCommit(chatId, msgId, uid, orderId, mode, method, staff, updateId, ports, prefix, hint) {
  if (staff.role !== 'owner') {
    return ports.chat.sendMessage(chatId, withHintLine(withPrefix(prefix, t(ports, 'ord_owner_only')), hint), withHintRow([], hint));
  }
  var r = cancelOrder(ports, { orderId: orderId, mode: mode, method: method, staff: staff, updateId: updateId, source: CFG.SOURCE.BUTTON });
  if (!r.ok) {
    var why = r.reason === 'closed' ? t(ports, 'ord_closed') : t(ports, 'expired');
    return editOrSend(ports, chatId, msgId, withHintLine(withPrefix(prefix, why), hint), withHintRow([], hint));
  }
  markCommittedCard(ports, chatId, msgId);
  var text = t(ports, 'cx_done', { no: orderNo(orderId) });
  if (r.mode === 'refund') text += '\n' + t(ports, 'cx_refunded', { amount: fmtMoney(r.amount), method: methodLabel(ports, method || CFG.METHOD.CASH) });
  if (r.mode === 'keep') text += '\n' + t(ports, 'cx_kept', { amount: fmtMoney(r.amount) });
  var kb = r.groupId ? [[btn(t(ports, 'btn_undo'), 'U|' + r.groupId)]] : [];
  if (r.groupId) setLastGroup(ports, uid, r.groupId);
  return editOrSend(ports, chatId, msgId, withHintLine(withPrefix(prefix, text), hint), withHintRow(kb, hint));
}

/* ------------------------------ a tag on the finished piece ------------------------------ */

/** OT|<orderId>: the next blank tag scanned becomes the Items row of one line (Alias = line id). Before delivery only. */
function startAttachTag(chatId, uid, orderId, staff, ports) {
  var order = ports.store.getOrder(orderId);
  if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: orderId }));
  if (!orderIsOpen(order)) return ports.chat.sendMessage(chatId, t(ports, 'ord_closed'));
  var open = orderLines(ports, orderId).filter(function (l) { return !l.itemId; });
  if (!open.length) return ports.chat.sendMessage(chatId, t(ports, 'tag_all_attached'));
  if (open.length === 1) return attachTagLine(chatId, null, uid, orderId, open[0].line, ports);
  var rows = open.map(function (l) { return [btn(myDigits(l.line) + '. ' + orderLineDesc(ports, l), 'OTL|' + orderId + '|' + l.line)]; });
  rows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.sendMessage(chatId, t(ports, 'tag_which_line'), rows);
}

/** OTL|<orderId>|<line>. */
function attachTagLine(chatId, msgId, uid, orderId, line, ports) {
  var l = orderLines(ports, orderId).filter(function (x) { return Number(x.line) === Number(line); })[0];
  if (!l) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  setState(ports, uid, { kind: 'order_tag', orderId: orderId, line: Number(line) });
  var text = t(ports, 'tag_ask_scan', { no: orderNo(orderId), line: myDigits(l.line) + '. ' + orderLineDesc(ports, l) });
  var kb = [[btn(t(ports, 'btn_cancel'), 'Z')]];
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, kb, false);
  return ports.chat.sendMessage(chatId, text, kb);
}

/** The blank tag just scanned while an order_tag state is open: register the piece and RESTOCK it once. */
function attachTagToItem(chatId, uid, state, item, staff, ports) {
  if (item.status !== CFG.STATUS.BLANK) return ports.chat.sendMessage(chatId, t(ports, 'tag_not_blank', { id: item.id }), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
  var order = ports.store.getOrder(state.orderId);
  var l = order ? orderLines(ports, order.id).filter(function (x) { return Number(x.line) === Number(state.line); })[0] : null;
  if (!order || !l) { clearState(ports, uid); return ports.chat.sendMessage(chatId, t(ports, 'expired')); }
  var lineId = order.id + '-' + l.line;
  var d = l.designCode ? ports.store.getDesign(l.designCode) : null;
  // The design's category (round 6b: by the item_category list, a built-in's old name getting its row's label), else the catch-all.
  var crow = d ? itemCategoryOf(ports, d.category) : null;
  ports.store.updateItem(item.id, {
    name: orderLineDesc(ports, l) + ' · ' + customerName(ports, order.customerId),
    category: crow ? crow.label : itemCategoryFallback(ports),
    type: CFG.ITEM_TYPE.UNIQUE, price: l.unitPrice, cost: l.cost === undefined ? '' : l.cost, sample: false, alias: lineId,
    createdAt: ports.clock.now().toISOString(), createdBy: staff.id
  });
  commitRestock(ports, { item: ports.store.getItem(item.id), qty: 1, staff: staff, source: CFG.SOURCE.SYSTEM, note: 'custom order ' + lineId });
  ports.store.updateOrderItem(order.id, l.line, { itemId: item.id });
  clearState(ports, uid);
  ports.chat.sendMessage(chatId, t(ports, 'tag_attached', { id: item.id, no: orderNo(order.id), line: myDigits(l.line) + '. ' + orderLineDesc(ports, l) }));
  return sendOrderCard(chatId, null, order.id, staff, ports);
}

/* ------------------------------ measurements ------------------------------ */

function measToken(ports) { return ports.uuid().replace(/-/g, '').slice(0, 10); }
function getMeas(ports, tok) { var s = ports.cache.get('ms:' + tok); return s ? JSON.parse(s) : null; }
function putMeas(ports, s) { ports.cache.put('ms:' + s.token, JSON.stringify(s), CFG.STATE_TTL_SEC); }
function dropMeas(ports, tok) { ports.cache.remove('ms:' + tok); }

/** MS|<orderId|customerId|pick|new|create>: from a card, a customer, or the menu (which asks who first). */
function startMeasure(chatId, uid, arg, staff, ports) {
  if (arg === 'pick') {
    setState(ports, uid, { kind: 'meas_pick' });
    var rows = recentCustomers(ports, staff.shop, 4).map(function (c) { return [btn(customerLabel(c), 'MS|' + c.id)]; });
    rows.push([btn(t(ports, 'btn_new_customer'), 'MS|new'), btn(t(ports, 'btn_cancel'), 'Z')]);
    return ports.chat.sendMessage(chatId, t(ports, 'credit_ask_customer'), rows);
  }
  if (arg === 'new') {
    setState(ports, uid, { kind: 'meas_pick', step: 'name' });
    return ports.chat.sendMessage(chatId, t(ports, 'ask_name'));
  }
  if (arg === 'create') {
    var st = getState(ports, uid);
    if (!st || !st.name) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
    return startMeasureFor(chatId, uid, ports.store.addCustomer({ name: st.name }).id, null, staff, ports);
  }
  if (isOrderId(arg)) {
    // An order id needs the order module (getOrder); the app's form alone answers expired.
    if (!ordersEnabled(ports)) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
    var order = ports.store.getOrder(arg);
    if (!order) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: arg }));
    return startMeasureFor(chatId, uid, order.customerId, order.id, staff, ports);
  }
  if (!ports.store.getCustomer(arg)) return ports.chat.sendMessage(chatId, t(ports, 'expired'));
  return startMeasureFor(chatId, uid, arg, null, staff, ports);
}

/** The app's measurement form (ports.ui.measureForm, app/app_ports.js); the Telegram bot has no ports.ui (spec 9.2). */
function measureFormEnabled(ports) { return !!(ports.ui && ports.ui.measureForm); }

/** Measurements can be taken here: the Telegram flow (the order module) or the app's form. */
function measureEnabled(ports) { return ordersEnabled(ports) || measureFormEnabled(ports); }

function measPickNamed(chatId, uid, state, name, staff, ports) {
  var c = pickCustomer(chatId, uid, state, name, ports, function (x) { return 'MS|' + x; });
  if (!c) return;
  return startMeasureFor(chatId, uid, c.id, null, staff, ports);
}

/**
 * The entry screen: use the previous session or measure anew; without a previous one, straight to the method row.
 * In the app (ports.ui.measureForm) the form opens instead, before any token or latestMeasurement (spec 9.2).
 */
function startMeasureFor(chatId, uid, customerId, orderId, staff, ports) {
  if (measureFormEnabled(ports)) { clearState(ports, uid); return ports.ui.measureForm({ chatId: chatId, uid: uid, customerId: customerId, orderId: orderId || '', staff: staff }); }
  var s = { token: measToken(ports), customerId: customerId, orderId: orderId || '', shop: staff.shop, values: {}, low: [], i: 0, source: '', notes: '', fixOf: '', photoUrl: '' };
  putMeas(ports, s);
  setState(ports, uid, { kind: 'meas', token: s.token, step: 'method' });
  var text = t(ports, 'ms_title', { customer: customerName(ports, customerId) });
  var prev = latestMeasurement(ports, customerId);
  if (prev) {
    text += '\n' + t(ports, 'ms_previous', { date: fmtDayShortMy(prev.day), id: prev.id });
    var prevRows = [[btn(t(ports, 'btn_meas_copy'), 'MM|' + s.token + '|copy'), btn(t(ports, 'btn_meas_new'), 'MM|' + s.token + '|new')]];
    // The newest session has a drawing on the figure (round 6, revision 3): Telegram shows it inside the measurement PDF.
    if (prev.sketch) {
      text += '\n' + t(ports, 'ms_sketch_line');
      prevRows.push([btn(t(ports, 'btn_meas_pdf'), 'MP|' + prev.id)]);
    }
    prevRows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
    return ports.chat.sendMessage(chatId, text, prevRows);
  }
  return ports.chat.sendMessage(chatId, text + '\n' + t(ports, 'ms_ask_method'), measMethodRow(ports, s.token));
}

function measMethodRow(ports, tok) {
  // The sheet photo is read by the AI: with the owner's AI switch off it is not offered (round 6, F9b).
  var row = aiOn(ports) ? [btn(t(ports, 'btn_meas_photo'), 'MM|' + tok + '|photo')] : [];
  row.push(btn(t(ports, 'btn_meas_chat'), 'MM|' + tok + '|chat'));
  return [row, [btn(t(ports, 'btn_cancel'), 'Z')]];
}

/** MM|<token>|<copy|new|photo|chat>. */
function measMode(chatId, msgId, uid, tok, mode, staff, ports) {
  var s = getMeas(ports, tok);
  if (!s) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  if (mode === 'copy') {
    var prev = latestMeasurement(ports, s.customerId);
    if (!prev) return ports.chat.editMessage(chatId, msgId, t(ports, 'ms_none'), [], false);
    measureFields(ports, true).forEach(function (f) { if (prev.fields[f.key] !== undefined && prev.fields[f.key] !== '') s.values[f.key] = String(prev.fields[f.key]); });
    s.source = CFG.MEAS_SOURCE.COPY;
    s.copyOf = prev.id;
    // A drawing on the figure is copied with its picture (round 6, revision 3).
    if (prev.sketch) { s.sketch = prev.sketch; s.photoUrl = prev.photoUrl || ''; }
    putMeas(ports, s);
    return sendMeasSummary(chatId, msgId, uid, s, ports);
  }
  if (mode === 'new') return ports.chat.editMessage(chatId, msgId, t(ports, 'ms_title', { customer: customerName(ports, s.customerId) }) + '\n' + t(ports, 'ms_ask_method'), measMethodRow(ports, tok), false);
  if (mode === 'photo') {
    if (!aiOn(ports)) return ports.chat.editMessage(chatId, msgId, t(ports, 'ai_off'), measMethodRow(ports, tok), false);
    s.source = CFG.MEAS_SOURCE.PHOTO;
    putMeas(ports, s);
    setState(ports, uid, { kind: 'meas', token: tok, step: 'photo' });
    return ports.chat.editMessage(chatId, msgId, t(ports, 'ms_ask_photo'), [[btn(t(ports, 'btn_cancel'), 'Z')]], false);
  }
  if (mode === 'chat') {
    s.source = CFG.MEAS_SOURCE.CHAT;
    s.i = 0;
    putMeas(ports, s);
    ports.chat.editMessage(chatId, msgId, t(ports, 'ms_title', { customer: customerName(ports, s.customerId) }), [], false);
    return askMeasQuestion(chatId, uid, s, ports);
  }
  return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
}

/** One field per message; the answer is typed or spoken; skip / back / finish as buttons. */
function askMeasQuestion(chatId, uid, s, ports) {
  var fields = measureFields(ports, true);
  if (s.i >= fields.length) return sendMeasSummary(chatId, null, uid, s, ports);
  var f = fields[s.i];
  var text = t(ports, 'ms_question', { i: myDigits(s.i + 1), n: myDigits(fields.length), label: f.labelMy, hint: f.multi > 1 ? t(ports, 'ms_multi_hint') : '' });
  var rows = [];
  if (f.key === 'htamein_side') rows.push([btn(t(ports, 'btn_left'), 'MQ|' + s.token + '|L'), btn(t(ports, 'btn_right'), 'MQ|' + s.token + '|R')]);
  rows.push([btn(t(ports, 'btn_skip'), 'MQ|' + s.token + '|s'), btn(t(ports, 'btn_back'), 'MQ|' + s.token + '|b'), btn(t(ports, 'btn_finish'), 'MQ|' + s.token + '|f')]);
  rows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  var m = ports.chat.sendMessage(chatId, text, rows);
  s.qMsgId = m && m.messageId ? m.messageId : null;
  putMeas(ports, s);
  setState(ports, uid, { kind: 'meas', token: s.token, step: 'q' });
}

/** MQ|<token>|<s|b|f|L|R>. */
function measStep(chatId, msgId, uid, tok, arg, staff, ports) {
  var s = getMeas(ports, tok);
  if (!s) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  var fields = measureFields(ports, true), state = getState(ports, uid) || {};
  if (arg === 'L' || arg === 'R') {
    var value = t(ports, arg === 'L' ? 'btn_left' : 'btn_right');
    if (state.step === 'fix' && s.fieldKey) return measFixValue(chatId, uid, state, s, value, ports);
    return measRecord(chatId, uid, s, fields, value, ports);
  }
  if (arg === 'f') {
    ports.chat.editMessage(chatId, msgId, t(ports, 'ms_skipped', { label: fields[s.i] ? fields[s.i].labelMy : '' }), [], false);
    return sendMeasSummary(chatId, null, uid, s, ports);
  }
  if (arg === 'b') {
    ports.chat.editMessage(chatId, msgId, t(ports, 'ms_skipped', { label: fields[s.i] ? fields[s.i].labelMy : '' }), [], false);
    s.i = Math.max(0, s.i - 1);
    putMeas(ports, s);
    return askMeasQuestion(chatId, uid, s, ports);
  }
  // skip
  var f = fields[s.i];
  if (f) { delete s.values[f.key]; ports.chat.editMessage(chatId, msgId, t(ports, 'ms_skipped', { label: f.labelMy }), [], false); }
  s.i++;
  putMeas(ports, s);
  return askMeasQuestion(chatId, uid, s, ports);
}

/** The current question's answer (typed, spoken or a button): store it, mark the question message, ask the next. */
function measRecord(chatId, uid, s, fields, text, ports) {
  var f = fields[s.i];
  if (!f) return sendMeasSummary(chatId, null, uid, s, ports);
  var v = normMeasValue(f, text);
  if (!v) return askMeasQuestion(chatId, uid, s, ports);
  s.values[f.key] = v;
  s.low = (s.low || []).filter(function (k) { return k !== f.key; });
  if (s.qMsgId) ports.chat.editMessage(chatId, s.qMsgId, t(ports, 'ms_answered', { label: f.labelMy, value: v }), [], false);
  s.i++;
  putMeas(ports, s);
  return askMeasQuestion(chatId, uid, s, ports);
}

/** Typed or spoken text while a measurement session is open. */
function measTextInput(chatId, uid, state, text, staff, ports) {
  var s = getMeas(ports, state.token);
  if (!s) { clearState(ports, uid); return ports.chat.sendMessage(chatId, t(ports, 'expired')); }
  if (state.step === 'fix' && s.fieldKey) return measFixValue(chatId, uid, state, s, text, ports);
  if (state.step === 'q') return measRecord(chatId, uid, s, measureFields(ports, true), text, ports);
  if (state.step === 'photo') return ports.chat.sendMessage(chatId, t(ports, 'ms_ask_photo'), [[btn(t(ports, 'btn_cancel'), 'Z')]]);
  return ports.chat.sendMessage(chatId, t(ports, 'ms_ask_method'), measMethodRow(ports, s.token));
}

/** The grouped summary with ✅ save (or "all correct" after a photo), ✏️ fix, cancel. */
function sendMeasSummary(chatId, msgId, uid, s, ports) {
  var fields = measureFields(ports, true);
  var lines = [t(ports, 'ms_summary_title', { customer: customerName(ports, s.customerId), id: s.fixOf ? ' · ' + s.fixOf : '' })];
  lines = lines.concat(measurementSummaryLines(ports, fields, s.values, s.low, false));
  lines.push(t(ports, 'ms_summary_count', { n: fmtCount(measurementCount(fields, s.values)) }));
  if (s.low && s.low.length) lines.push(t(ports, 'ms_low_hint'));
  if (s.sheetName && normName(s.sheetName) !== normName(customerName(ports, s.customerId))) lines.push(t(ports, 'ms_name_warn', { name: s.sheetName }));
  var kb = [[btn(t(ports, s.source === CFG.MEAS_SOURCE.PHOTO && !s.fixOf ? 'btn_all_correct' : 'btn_save'), 'MK|' + s.token), btn(t(ports, 'btn_fix'), 'MF|' + s.token)],
            [btn(t(ports, 'btn_cancel'), 'Z')]];
  putMeas(ports, s);
  setState(ports, uid, { kind: 'meas', token: s.token, step: 'summary' });
  if (msgId) return ports.chat.editMessage(chatId, msgId, lines.join('\n'), kb, false);
  return ports.chat.sendMessage(chatId, lines.join('\n'), kb);
}

/** MK|<token>: a new Measurements row (never an edit), the order points at it. */
function measSave(chatId, msgId, uid, tok, staff, ports) {
  var s = getMeas(ports, tok);
  if (!s) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  var rec = saveMeasurement(ports, s, staff);
  dropMeas(ports, tok);
  clearState(ports, uid);
  var fields = measureFields(ports, true);
  var text = t(ports, 'ms_saved', { customer: customerName(ports, s.customerId), id: rec.id, n: fmtCount(measurementCount(fields, rec.fields)) });
  var row = [btn(t(ports, 'btn_fix'), 'MF|' + rec.id), btn(t(ports, 'btn_meas_pdf'), 'MP|' + rec.id)];
  if (s.orderId) row.push(btn(t(ports, 'btn_card'), 'O|' + s.orderId));
  return ports.chat.editMessage(chatId, msgId, text, [row], false);
}

/** MF|<token or M-00041>: the groups to fix. A saved session is loaded into a new session that names it (fix of). */
function measFix(chatId, msgId, uid, arg, staff, ports) {
  var s;
  if (/^M-\d+$/.test(arg)) {
    var saved = ports.store.getMeasurement(arg);
    if (!saved) return ports.chat.sendMessage(chatId, t(ports, 'ms_none'));
    s = { token: measToken(ports), customerId: saved.customerId, orderId: saved.orderId || '', shop: staff.shop, values: {}, low: [], i: 0,
          source: saved.source || CFG.MEAS_SOURCE.CHAT, notes: saved.notes || '', fixOf: saved.id, photoUrl: saved.photoUrl || '',
          sketch: saved.sketch || '' };
    Object.keys(saved.fields || {}).forEach(function (k) { if (saved.fields[k] !== '' && saved.fields[k] !== null && saved.fields[k] !== undefined) s.values[k] = String(saved.fields[k]); });
    putMeas(ports, s);
    msgId = null;
  } else {
    s = getMeas(ports, arg);
    if (!s) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  }
  var fields = measureFields(ports, true), groups = [];
  fields.forEach(function (f) { if (groups.indexOf(f.group) < 0) groups.push(f.group); });
  var rows = [], row = [];
  groups.forEach(function (g) {
    row.push(btn(measGroupLabel(ports, g), 'MG|' + s.token + '|' + g));
    if (row.length === 3) { rows.push(row); row = []; }
  });
  if (row.length) rows.push(row);
  rows.push([btn(t(ports, 'btn_save'), 'MK|' + s.token), btn(t(ports, 'btn_cancel'), 'Z')]);
  setState(ports, uid, { kind: 'meas', token: s.token, step: 'fix_group' });
  var text = t(ports, 'ms_fix_group');
  if (msgId) return ports.chat.editMessage(chatId, msgId, text, rows, false);
  return ports.chat.sendMessage(chatId, text, rows);
}

/** MG|<token>|<group>: the fields of one group with their current values. */
function measFixGroup(chatId, msgId, uid, tok, group, ports) {
  var s = getMeas(ports, tok);
  if (!s) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  var rows = [], row = [];
  measureFields(ports, true).filter(function (f) { return f.group === group; }).forEach(function (f) {
    var v = s.values[f.key];
    row.push(btn(f.labelMy + ' · ' + (v === undefined || v === '' ? '—' : v) + ((s.low || []).indexOf(f.key) >= 0 ? ' ❓' : ''), 'ML|' + tok + '|' + f.key));
    if (row.length === 2) { rows.push(row); row = []; }
  });
  if (row.length) rows.push(row);
  rows.push([btn(t(ports, 'btn_back'), 'MF|' + tok), btn(t(ports, 'btn_save'), 'MK|' + tok)]);
  return ports.chat.editMessage(chatId, msgId, t(ports, 'ms_fix_field', { group: measGroupLabel(ports, group) }), rows, false);
}

/** ML|<token>|<key>: type (or say) the new value. */
function measFixField(chatId, msgId, uid, tok, key, ports) {
  var s = getMeas(ports, tok);
  if (!s) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  var f = measureFields(ports, false).filter(function (x) { return x.key === key; })[0];
  if (!f) return ports.chat.editMessage(chatId, msgId, t(ports, 'expired'), [], false);
  s.fieldKey = key;
  putMeas(ports, s);
  setState(ports, uid, { kind: 'meas', token: tok, step: 'fix' });
  var rows = [];
  if (key === 'htamein_side') rows.push([btn(t(ports, 'btn_left'), 'MQ|' + tok + '|L'), btn(t(ports, 'btn_right'), 'MQ|' + tok + '|R')]);
  rows.push([btn(t(ports, 'btn_cancel'), 'Z')]);
  return ports.chat.editMessage(chatId, msgId, t(ports, 'ms_fix_ask', { label: f.labelMy, hint: f.multi > 1 ? t(ports, 'ms_multi_hint') : '' }), rows, false);
}

function measFixValue(chatId, uid, state, s, text, ports) {
  var f = measureFields(ports, false).filter(function (x) { return x.key === s.fieldKey; })[0];
  if (!f) return sendMeasSummary(chatId, null, uid, s, ports);
  var v = normMeasValue(f, text);
  if (v) s.values[f.key] = v; else delete s.values[f.key];
  s.low = (s.low || []).filter(function (k) { return k !== f.key; });
  delete s.fieldKey;
  putMeas(ports, s);
  ports.chat.sendMessage(chatId, t(ports, 'ms_fixed', { label: f.labelMy, value: v || '—' }));
  return sendMeasSummary(chatId, null, uid, s, ports);
}

/** A photo of the filled paper sheet: Gemini reads the cells, low-confidence ones are marked ❓, nothing is saved before ✅. */
function measPhoto(chatId, uid, state, fileId, staff, updateId, ports) {
  var s = getMeas(ports, state.token);
  if (!s) { clearState(ports, uid); return ports.chat.sendMessage(chatId, t(ports, 'expired')); }
  ports.chat.typing(chatId);
  var fields = measureFields(ports, true), res;
  var photoUrl = ports.chat.savePhoto(fileId, 'meas-' + s.customerId + '-' + dayKey(ports.clock.now()));
  try {
    res = ports.ai.readMeasurementSheet(ports.chat.getFile(fileId), {
      fields: fields.map(function (f) { return { key: f.key, labelMy: f.labelMy, labelEn: f.labelEn, multi: f.multi, type: f.type }; }),
      customer: customerName(ports, s.customerId)
    });
  } catch (err) {
    ports.store.logError('meas_photo', err, updateId, '');
    ports.chat.sendMessage(chatId, t(ports, 'ai_down'));
    return ports.chat.sendMessage(chatId, t(ports, 'ms_ask_method'), measMethodRow(ports, s.token));
  }
  var got = res && res.fields ? res.fields : {}, count = 0;
  fields.forEach(function (f) {
    var raw = got[f.key];
    if (raw === undefined || raw === null || String(raw).trim() === '') return;
    var v = normMeasValue(f, raw);
    if (v) { s.values[f.key] = v; count++; }
  });
  if (!count) return ports.chat.sendMessage(chatId, t(ports, 'ms_photo_bad'), measMethodRow(ports, s.token));
  s.low = (res.low_confidence || []).filter(function (k) { return s.values[k] !== undefined; });
  s.source = CFG.MEAS_SOURCE.PHOTO;
  s.photoUrl = photoUrl;
  s.sheetName = res.name || '';
  if (res.notes && !s.notes) s.notes = String(res.notes);
  putMeas(ports, s);
  return sendMeasSummary(chatId, null, uid, s, ports);
}

/** MP|<M-00041|orderId|customerId>: the measurement sheet in the paper layout as a PDF for the tailor. */
function sendMeasPdf(chatId, arg, staff, ports) {
  var p = { now: ports.clock.now() };
  if (/^M-\d+$/.test(arg)) p.measId = arg;
  else if (isOrderId(arg)) {
    var o = ports.store.getOrder(arg);
    if (!o) return ports.chat.sendMessage(chatId, t(ports, 'ord_not_found', { id: arg }));
    p.orderId = arg;
    p.customerId = o.customerId;
    p.measId = o.measId || '';
  } else p.customerId = arg;
  var report = buildReport(ports, 'meas', p);
  if (!report) return ports.chat.sendMessage(chatId, t(ports, 'ms_none'));
  ports.chat.typing(chatId);
  return ports.chat.sendDocument(chatId, ports.pdf.make(report), t(ports, 'rep_caption', { title: report.title }));
}

/* ------------------------------ the app: enrolled phones sell in the app ------------------------------ */

/** Once this Telegram user's phone is enrolled, the bot shows a scanned tag but never sells it (plan 14.2). */
function enrolledInApp(ports, staff) {
  return !!(ports.sync && typeof ports.sync.isEnrolled === 'function' && ports.sync.isEnrolled(staff.id));
}

/** The item card text plus one url button into the app (Settings app_url). Without app_url the hint alone. */
function sendAppCard(chatId, item, staff, ports) {
  var text = cardText(ports, item) + '\n' + t(ports, 'app_sell_hint');
  var appUrl = String(ports.store.getSetting('app_url', '') || '');
  var kb = appUrl ? [[{ text: t(ports, 'btn_sell_in_app'), url: appUrl + (appUrl.indexOf('#') >= 0 ? '&' : '#') + 'item=' + item.id }]] : [];
  return ports.chat.sendMessage(chatId, text, kb);
}
