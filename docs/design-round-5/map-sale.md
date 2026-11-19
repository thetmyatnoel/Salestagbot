# map-sale.md: today's selling and money flows (round 5 mapper, 2026-11-11)

Scope: `apps-script/core_bot.js`, `core_ledger.js`, `core_messages.js`, `core_config.js` as they stand after
round 4 (built, unpublished). Every claim cites `file:line`. Burmese labels are copied from `MSG`
(core_messages.js) and `APP_MSG` (app/app_i18n.js); nothing is translated here. This is a map of what exists,
written so the round-5 spec can name what the guided sale reuses and what it must add. The last section lists
exactly that.

Conventions used below: "state" = the per-user JSON in cache key `st:<uid>` (core_bot.js:2160-2170);
"card" = a bot message with an inline keyboard; "group" = the ledger rows sharing one `GroupID`
(core_ledger.js:894-898); "live row" = a row that neither reverses another nor is reversed
(core_ledger.js:888-891).

---

## 1. Entry points into a sale

| Entry | Where | What happens |
|---|---|---|
| Scan (QR deep link `/start S1-0042`) | `handleMessage` core_bot.js:83-91 | payload matching `/^[A-Z0-9_-]{1,64}$/` goes to `openTag` (line 88); a voucher id (`isOrderId`) opens the order card instead (86); a bare `/start` calls `dropAddState` then `showMenu` (89-90). |
| Typed tag id or pasted `t.me/...?start=` link | `tagIdFromText` core_bot.js:168-173, called first in `handleText` (652-653) | `/^S[12]-\d{4}$/i` opens the card with no state and no AI. |
| `K\|<id>` button (from "which item" choosers, `showChoices` 938-941) | `handleCallback` case `'K'` core_bot.js:525 | `openTag`. |
| Voice or free text ("ဒါ ၂ ထည် ရောင်းရတယ်") | `handleVoice` 635-647 / `handleText` 699-707 → `handleIntent` 755-919 → `propose` 970-975 | A confirm card `confirm_sale` + `confirm_ask` with `btn_yes`/`btn_no` (Y/N tokens, cache `cf:<token>`, TTL `CFG.CONFIRM_TTL_SEC` = 1800 s, core_config.js:13). Nothing is written until Y (`confirmProposal` 1012-1079). |
| Notebook photo import | `presentNotebookLine` 2123-2139 → `propose` | Same confirm card per line (Settings `notebook_import` must be on, 2102). |
| The app (an enrolled phone) | `enrolledInApp` 3402-3404, `sendAppCard` 3407-3411 | The Telegram bot shows the card with `app_sell_hint` ('📲 ဒီဖုန်းက အက်ပ် သုံးနေပါသည် · ရောင်းရန် အက်ပ်ထဲမှာ scan လုပ်ပါ') and a url button `btn_sell_in_app` to Settings `app_url`; the sale itself happens in the app, which runs the same `handleCallback` through its ports. |

`openTag` (core_bot.js:101-125): unknown id → `tag_not_found`; an `order_tag` state turns the scan into
`attachTagToItem` (107); a tag whose `alias` is a voucher line opens the order card while the order is open
(109-115); a `BLANK` tag starts the new-item flow (`new_item` state, step `photo`, 118-121); otherwise
`clearState`, `setLastItem` (cache `li:<uid>`, TTL `LAST_ITEM_TTL_SEC` 600 s, core_config.js:10) and
`sendItemCard` (122-124). So a scan always wipes whatever flow was open.

---

## 2. The item card

### 2.1 Text: `cardText(ports, item)` core_bot.js:181-205
- `isPricePending` (177-179: price blank, null or <= 0) → `card_pending` ('{emoji} {id} · {name}\n⏳ စျေး မသတ်မှတ်ရသေးပါ · ဆိုင်ရှင်ကို မေးပါ · 📦 လက်ကျန် {stock}', core_messages.js:12).
- UNIQUE with stock <= 0 → `card_sold_out` (line 11) plus, when the last live sale has a customer, one `card_buyer`
  line ('👤 {customer} · ပေးပြီး {paid} · {method}', line 156) built from `lastLiveSale` (core_ledger.js:1115-1119),
  `saleGroupInfo` and `groupMethods` (core_bot.js:189-201).
- Otherwise `card` ('{emoji} {id} · {name}\n💰 {price} ကျပ် · 📦 လက်ကျန် {stock}', line 10). `sample_mark`
  (' (နမူနာ)') is appended to the name for samples (182).
- Emoji from `categoryEmoji` (core_config.js:186-188).

### 2.2 Keyboard: `cardKeyboard(ports, item)` core_bot.js:207-230

| Item | Row 1 | Row 2 | Row 3 |
|---|---|---|---|
| price pending | `btn_sell_at` '💬 စျေးပြောပြီး ရောင်း' → `D\|id` | `btn_set_price` '💰 စျေးသတ်မှတ်' → `SP\|id\|ask`, transfer | — |
| UNIQUE, stock > 0 | `btn_sold` '✅ ရောင်းပြီး' → `S\|id\|1` | `btn_discount` '💬 စျေးလျှော့' → `D\|id`, `btn_return` '↩️ ပြန်အမ်း' → `T\|id` | transfer |
| UNIQUE, stock <= 0 | `btn_return` → `T\|id` | — | — |
| SKU | `btn_sell_one` '✅ ရောင်း ၁' → `S\|id\|1`, `btn_qty` '🔢 အရေအတွက်' → `Q\|id` | `btn_discount` → `D\|id`, `btn_restock` '📦 ကုန်ရောက်' → `R\|id` | `btn_return` → `T\|id`, transfer |

transfer = `btn_transfer` '🔁 {shop} သို့' → `X|id` with `shopName(otherShop)` (209). `ITEM_TYPE` is
`{UNIQUE, SKU}` (core_config.js:33); `STATUS` `{BLANK, ACTIVE, SOLD}` (34). The only "stock check" in the core
for a sale is this keyboard rule: a UNIQUE piece with stock <= 0 gets no sell button. `commitSale` itself never
reads stock (see 3.3).

### 2.3 Sending: `sendItemCard` core_bot.js:232-239
Photo card (`chat.sendPhoto`) when the item has `photoFileId`/`photoUrl` and Settings `text_cards` is off
(`settingOn`, core_config.js:190-193); else `chat.sendMessage`. A photo card means later edits are caption
edits (`isCaption`, 425).

### 2.4 Quantity: `askQty` core_bot.js:246-255, `QTY_GRID` core_config.js:107
`Q|id` sends a NEW message `ask_qty` ('🔢 ဘယ်နှစ်ထည် ရောင်းလဲ?') + `id · name` with `CFG.QTY_GRID`
= [2..9] as Burmese digits (`myDigits`), four per row, each button `S|id|N`; last row `btn_type_qty`
('✏️ ရိုက်မယ်') → `QN|id` and `btn_cancel` ('✖️ မလုပ်တော့') → `Z`. `QN` sets state
`{kind:'await_number', purpose:'sale_qty', itemId}` and edits the question to `ask_qty_number` (453-456).
The typed number goes through `applyAwaitedNumber` case `sale_qty` (722-734): outside 1..`MAX_SALE_QTY`
(999, core_config.js:108) or non-integer → state is set again and `bad_qty` ('❓ ၁ မှ {max} အတွင်း ဂဏန်း
ရိုက်ပေးပါ') with a cancel button; else `commitSale` and a NEW sold card. `clampQty` (257-261) clamps the
`S|id|N` argument to 1..999 on the button path (445).

### 2.5 Discount / changed price: `D|id` core_bot.js:457-460
Sets `{kind:'await_number', purpose:'sale_price', itemId}` and sends a NEW message `ask_sale_price`
('💬 ဘယ်စျေးနဲ့ ရောင်းလဲ? ဂဏန်း ရိုက်ပါ (ဥပမာ 18000)') with cancel. The number is read in
`applyAwaitedNumber` case `sale_price` (713-721): `commitSale(ports, {item, qty: 1, unitPrice: n, note:
'spoken price', ...})`. Note: the discount path always sells **one** piece; there is no "price for N pieces"
screen. A spoken price while the state waits also lands here (`handleIntent` 823-831, `spokenMoney`).

### 2.6 Other card actions (for completeness)
`R|id` → restock presets `RESTOCK_PRESETS` [1,5,10,20] as `RQ|id|n` plus `btn_other` → `RQ|id|other`
(await_number `restock_qty`) (461-475); `T|id` → `commitReturn` qty 1 at once (476-483); `X|id` →
`commitTransfer` at once (484-488); `SP|id|ask|other|<price>` → `setPrice`/`applyPrice` (2073-2090).

---

## 3. How a sale is committed

### 3.1 The button path: `handleCallback` case `'S'` core_bot.js:444-450
```
qty = clampQty(arg)
r = commitSale(ports, merge(base, {item, qty}))      // base = {staff, source: BUTTON, updateId} (435)
fresh = store.getItem(id); setLastItem; setLastGroup(r.groupId)
edit(soldText(ports, fresh, qty, r), afterSaleKeyboard(ports, r.groupId))   // the card is edited in place
```
`S` is in `MUTATING_ACTIONS` (417-418): a second tap of the same data on the same message within 120 s is
dropped (`tap:<chat>:<msg>:<data>` cache key, 428-432).

### 3.2 The money: `commitSale(ports, p)` core_ledger.js:755-768
- `qty = max(1, round(p.qty || 1))`; `unitPrice = p.unitPrice ?? round(p.amount / qty) ?? item.price`;
  `amount = qty * unitPrice`; `cash = p.paid == null ? amount : clamp(round(p.paid), 0, amount)`.
- One `newTx` with `type SALE, qty: -qty, costAtSale: item.cost, customerId: p.customerId || '', note,
  method: methodFor(p.method, cash)` (`methodFor` 103-106: CASH when cash moved and no key, '' when cash is 0).
- `writeGroup([tx])`.
So `commitSale` already accepts `paid` (a part payment), `customerId` and `method` in one write: the voice
confirm path uses exactly that (`confirmProposal` core_bot.js:1023-1024 with `resolveOrCreateCustomer`). The
button path passes none of them: every button sale is a full-cash sale, corrected afterwards.

### 3.3 Rows and groups: `newTx` core_ledger.js:31-63, `writeGroup` 66-74
`newTx` fills every `LEDGER_COLS` field (core_config.js:132-134: TxID, GroupID, Time, Day, Shop, ItemID, Type,
Qty, UnitPrice, Amount, Cash, CostAtSale, CustomerID, RefGroupID, Note, Source, Transcript, StaffID, UpdateID,
ReversesTxID, Method, Category, Seq, ReceivedAt, DeviceID, ReceiptNo); `groupId` defaults to `txId` (61);
`time`/`day` come from `ports.clock.now()` unless `f.when` (32). `writeGroup` forces every tx onto the first
tx's `groupId`, appends them inside `ports.lock.run` (69-71), then `afterWrite` (82-92) calls
`store.refreshViews(openCredits, depositsHeldList, customerSummaries)` when any row has a customer, is a
PAYMENT/DEPOSIT/DEPOSIT_APPLIED, is a SALE/RETURN with cash != amount, or reverses a row. A group may hold
several rows written at once: `commitTransfer` writes two (806-820), `splitSale` three (1039-1045).

Stock is **derived**, never checked at commit time: the Sheet's Items.Stock is a formula over Ledger.Qty
(gas_setup.js:315-316, Status formula 325); the phone keeps an incremental map on every append
(app_store.js:243, 306) and derives `SOLD` for a UNIQUE piece at stock <= 0 (259-262); the sync server
flags, never refuses, a push that takes stock below zero (`SYNC.FLAG.STOCK_NEGATIVE`, core_sync.js:83,
799-800; owner ping `ping_stock_negative` 123).

### 3.4 Receipt numbers
`receiptNumber(ports, groupId)` core_ledger.js:1621-1643: a SALE row carrying `receiptNo` wins (the app
writes `R1-A-000231` per device letter, app_store.js:294-299 via `syncReceiptNo`); otherwise the number is the
1-based index of the group among that shop's sale groups in ledger order, `R<shopdigit>-000NNN`. Numbers are
never reassigned: a voided group keeps its number, a rewrite keeps the GroupID. `buildReceipt`
(core_report.js:322-348) and `receiptText` (358-369) print `receipt_header`, one `receipt_line` per live SALE
row, `voucher_deposit` for applied deposits, `receipt_total` with `receiptMethodText` (351-356: '' for cash,
' (KBZPay)' for one account, ' (ငွေသား 6,000 · KBZPay 6,000)' when mixed), `receipt_transfer` while owed > 0
(`transferLines`, core_ledger.js:232-239), `receipt_customer`, `receipt_thanks`. `RC|group` sends it with a
`btn_pdf` → `RCP|group` button (core_bot.js:1951-1962).

### 3.5 Undo window
`U|group` → `undoGroup(ports, groupId, staff)` core_ledger.js:905-930: refuses `missing`, `already` (no live
rows) or `expired` when the first live row is older than `CFG.UNDO_WINDOW_MIN` (30 min, core_config.js:9);
otherwise appends one mirror per live row **in the same group** (negated qty/amount/cash, same method and
category, `note 'undo'`, `source UNDO`, `reversesTxId`), and moves a transferred item back. `V|group`
(`voidGroup`, 933-935) is the owner-only version with `force` and note `'void by owner'` (core_bot.js:500-508,
`void_owner_only`). The U handler (489-499) edits the card to `undo_done` + the fresh `cardText` and calls
`clearLastGroup`. `setLastGroup` (`lg:<uid>`, 2187) lives exactly `UNDO_WINDOW_MIN * 60` s and is what the
spoken "Wave နဲ့ ပေးသွားတယ်" (`I.METHOD`, 885-893) refers to.

### 3.6 `soldText` core_bot.js:241-243
`cardText(fresh) + '\n' + sold_done` ('✅ ရောင်းပြီး {qty} ထည် · {amount} ကျပ် · လက်ကျန် {stock}'). The amount is
`r.txs[0].amount`. The voice path writes a shorter card: `sold_done` alone, plus `credit_done` when a customer
was named, plus `methodLine` (1027-1029).

---

## 4. The after-sale card

### 4.1 `afterSaleKeyboard(ports, groupId)` core_bot.js:270-287, row by row
1. `btn_undo` '↩️ မှားသွားတယ်' → `U|g`, `btn_receipt` '🧾 ဘောက်ချာ' → `RC|g` (always).
2. `btn_pay` '💰 ငွေလက်ခံ' → `PY|g` while `info.owed > 0` (274).
3. While `rewriteCheck(g).ok` (see 5.1): `btn_credit` '💳 မကျေသေး' → `CR|g` when owed <= 0, and
   `btn_customer` '👤 ဝယ်သူ' → `CU|g` when no customer is attached (276-280).
4. While the live row has cash > 0: `methodRows(...)` for the sale's shop, current method skipped, buttons
   `PM|g|KEY` (`groupMethodData` 290-292), with the extra last row `btn_split` '💵+🏦 ခွဲပေး' → `SX|g` (SALE
   rows only) and `btn_add_bank` '➕ ဘဏ်အသစ်' → `LA|pm|PM|g` (281-284).
A voided or non-sale group gets row 1 only (273). The credit state is read from the ledger (`owed > 0`),
never from whether a customer is attached (comment 268).

### 4.2 `methodRows(ports, shop, current, mk, opts)` core_bot.js:303-327
One button per key of `payMethods(ports, shop)` (core_ledger.js:116-130: CASH first, then the active
`pay_method` list rows of that shop in list order, keys over `LIST_KEY_MAX_BYTES` 12 bytes dropped and
logged, at most `MAX_BANK_BUTTONS` 12). `current` (a key or an array) gets no button. CASH shows `btn_cash`
'💵 ငွေသား'; every other key shows `btn_bank` '🏦 {method}' with `methodLabel` (core_ledger.js:180-187: the
list row's Label, else Messages `method_<KEY>`, else the key). Layout: one row while <= 3 buttons and no
label longer than 10 characters, else rows of two (318-322). A button whose data exceeds 64 bytes is skipped
(312). `opts.split` and `opts.add` form one extra last row, split first (323-325). The caller adds its own
cancel row. There is no notion of wallet vs bank here: every non-cash key is a 🏦 button.

### 4.3 `moneyKeyboard` core_bot.js:330-337 and `replyKeyboard` 340-351
`moneyKeyboard`: undo (or a given first row) plus `methodRows` with `add: 'LA|pm|PM|g'` while the group's one
cash row can still be rewritten. `replyKeyboard` picks by the live row's type: SALE → `afterSaleKeyboard`;
PAYMENT → undo + receipt of the referenced sale; EXPENSE → undo + `btn_note` → `EN|g`; else `moneyKeyboard`.
Every corrective reply ends with `replyKeyboard(ports, groupId)` so the buttons always reflect the ledger now.

### 4.4 Redrawing a committed card
`refuseOnCard` (406-410) edits the tapped card to its own text minus earlier 🏦 lines (`stripMethodLines`,
1102-1104, drops lines starting with '🏦 ') plus the refusal line, with `replyKeyboard`. `changeMethod`
(1084-1099) edits the same way and appends `method_done` ('🏦 {method} နဲ့ ပေးတယ်လို့ မှတ်ပြီး'). Rule from the
file header (33-34): a committed card is never edited into a question; a follow-up question is a new message,
and the actionable screen is always the last message of a reply (the app shows only that one, 390-394).

---

## 5. Corrections on the after-sale card

### 5.1 The gate: `rewriteCheck(ports, groupId)` core_ledger.js:942-957
`{ok, row}` only when the group has exactly one live row, of a `REWRITABLE_TX` type (SALE, RETURN, PAYMENT,
DEPOSIT, EXPENSE; core_config.js:123), no live PAYMENT references the group (`locked`), and the row's Day is
today (`expired`). Other reasons: `missing`, `already`, `complex`. `rewriteRefusal` (core_bot.js:372-377) maps
them: `expired` → `rewrite_refused` ('⏱ ဒီနေ့အတွင်းသာ ပြင်လို့ ရပါသည်။ မနေ့က စာရင်းကို ဆိုင်ရှင်ကို ပြောပါ။');
`locked`/`complex`/`type` → `rewrite_locked`; `already` → `undo_already`; else `expired` message.
`rewriteGroup` (998-1004) appends `[mirror, replacement]` from `rewriteRows` (965-990): the replacement copies
every field, applies `method`, `customerId`, `cash` (clamped to 0..amount on a SALE), `note`, `category`, keeps
the original Time/Day and `receiptNo`, and takes `opts.noteIfBlank` when the note was blank.

### 5.2 Method: `PM|g|KEY` → `changeMethod` core_bot.js:1084-1099
Unknown key (`methodKnown`, core_ledger.js:172-177: CASH or any list row, retired included) → `expired`;
`rewriteCheck` failure → refusal; otherwise `rewriteGroup({method: KEY}, noteIfBlank 'method')`, `setLastGroup`,
card redrawn with `method_done`. `resumeMethod` (1111-1128) is the same after ➕ added the account (no tapped
message: one new message with `describeRow` + `method_done`, prefix and the 🔢 hint row).

### 5.3 Not fully paid: `CR|g` → credit flow core_bot.js:1596-1680
- `startCredit` (1596-1607): guards `saleGroupInfo` and `rewriteCheck`; state `{kind:'credit', groupId,
  step:'paid'}`; NEW message `credit_ask_paid` ('💳 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)') with buttons
  `0`, half (`fmtMoney(total/2)`), `btn_other` '✏️ အခြား' as `CP|g|0|half|other`, then cancel.
- `creditPaid` (1609-1618): `other` → `{kind:'await_number', purpose:'credit_paid', groupId}` and edit to
  `ask_number`; a number → `askCreditCustomer`.
- `askCreditCustomer` (1620-1627): state `{kind:'credit', groupId, step:'customer', paidNow}`; edits (or sends)
  `credit_ask_customer` ('👤 ဝယ်သူ ဘယ်သူလဲ?') with four `recentCustomers(shop, 4)` as `'👤 ' + name` →
  `CC|g|custId`, then `btn_new_customer` '✏️ နာမည်အသစ်' → `CC|g|new` and cancel.
- `creditCustomer` (1629-1643): requires the matching state; `new` → step `name` and `ask_name`
  ('✏️ နာမည် ရိုက်ပေးပါ'); `create` → `addCustomer({name: state.name})`; an id → `finishCredit`.
- `creditNamed` (1645-1649): typed/spoken name through `pickCustomer` (see 7.3) with `mk = 'CC|g|' + x`.
- `finishCredit` (1651-1668): `convertSaleToCredit` (core_ledger.js:1053-1059 = `rewriteGroup({cash: paidNow,
  customerId, note: 'credit'})`); reply `credit_done` ('💳 👤 {customer} · ပေးပြီး {paid} · ကျန် {owed} ကျပ်');
  if the customer holds a deposit and still owes, the question `credit_use_deposit` with `btn_use_deposit`
  '✅ စရံ သုံးမယ်' → `CD|g|yes` / `btn_no_deposit` '❌ မသုံးဘူး' → `CD|g|no`; else `afterSaleKeyboard` +
  `phoneRow` (a `btn_phone` '📱 ဖုန်း ထည့်' → `CF|custId` row when the customer has no phone, 363-365).
- `creditDeposit` (1670-1680): `yes` → `applyDeposit` (core_ledger.js:858-873: a `DEPOSIT_APPLIED` row in the
  sale's group, cash 0, amount = min(free pool, owed)) and `deposit_applied` line.

### 5.4 Who bought it: `CU|g` → attach flow core_bot.js:1479-1520
`startAttachCustomer`: `rewriteCheck` gate, state `{kind:'cu', groupId, step:'customer'}`, the same recent
customer picker as 5.3 with `CUP|g|custId|new` and the text `credit_ask_customer`. `attachCustomerPick`
(1488-1502) rebuilds a default state when none matches (so a stale tap still works), `new` → step `name`,
`create` → `addCustomer`. `attachNamed` (1504-1508) via `pickCustomer`. `finishAttach` (1510-1520):
`rewriteGroup({customerId}, noteIfBlank 'customer')`, reply `describeRow(row) + cust_attached`
('👤 ဝယ်သူ {customer} · မှတ်ပြီး'), keyboard `afterSaleKeyboard + phoneRow`.

### 5.5 Phone: `CF|custId` → `askPhone` 1523-1528, `savePhone` 1531-1540
State `{kind:'await_text', purpose:'phone', customerId}`; `ask_phone` ('📱 {customer} ၏ ဖုန်းနံပါတ် (Viber)
ရိုက်ပါ') with `btn_skip` '⏭ ကျော်' → `Z`. `savePhone`: `isValidPhone` (core_ledger.js:1327, `/^09\d{7,9}$/`
after `normPhone` 1320-1325) → store `normPhone(text)` and `phone_saved`; anything else is stored as typed with
`phone_odd` ('… (09 နဲ့ စရမယ်၊ ပြင်ချင်ရင် ထပ်ရိုက်ပါ)') and the 📱 button again. Spoken digits: `handleIntent`
781-786 accepts >= 7 digits. The phone is "never asked inside a money flow" (comment 362); the order flow is
the exception that asks it right after a new name (`orderAskPhone` 2417-2422, `ord_ask_phone`, then
`ord_ask_viber` 2424-2434).

### 5.6 Split: `SX|g` core_bot.js:1136-1268
- `splitGuard` (1136-1141): `rewriteCheck` plus the live row must be a SALE with cash > 0 (`type`).
- `startSplit` (1159-1173): refusal via `refuseOnCard`; a sale already marked with an account → straight to
  `sendSplitAmount` with that key; no non-cash account → `split_no_bank` with `btn_add_bank` → `LA|pm|SXM|g`;
  exactly one account → straight to the amount screen; several → NEW message `split_ask_bank`
  ('💵+🏦 ဘယ်အကောင့်နဲ့ ခွဲပေးလဲ? (ပေးငွေ {cash})') with `methodRows(current CASH, mk 'SXM|g|KEY', add
  'LA|pm|SXM|g')` and cancel.
- `sendSplitAmount` (1180-1199): state `{kind:'await_number', purpose:'split_bank', groupId, method}`;
  `split_ask_amount` ('💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ? ဂဏန်း ရိုက်ပါ (ပေးငွေ {cash} · ကျန်တာ ငွေသား)') with
  `btn_all` 'အကုန် {amount}' → `SXA|g|KEY|all` and `btn_half` 'တစ်ဝက် {amount}' → `SXA|g|KEY|half` (each only
  if <= 64 bytes), then cancel; `editOrSend`.
- `finishSplit` (1208-1245): resolves `all|half|number`; a number outside 1..cash keeps the state and answers
  `split_bad`; `splitSale` (core_ledger.js:1020-1047) writes `[mirror, replacement(cash - bank, CASH, note
  'split'), PAYMENT(bank, method KEY, refGroupId g, note 'split')]` in the sale's own group; bank >= cash is a
  plain method rewrite (`full`). Reply: `describeRow(sale)`, `split_done` ('💵 {cashMethod} {cash} · 🏦 {method}
  {bank} · မှတ်ပြီး') or `method_done`, then `split_hint` ('ℹ️ ပြင်ချင်ရင် ↩️ မှားသွားတယ် နှိပ်ပြီး ပြန်ရောင်းပါ')
  within the undo window or `split_hint_late`; `replyKeyboard`.
- `clearSplitState` (1252-1255) clears only this group's split state; `splitBankFromCash` (1262-1268) turns a
  spoken cash part into the bank part.
The resulting shape (SALE row with the cash part + a PAYMENT row with the account part, same group) is
exactly "the shape a custom-order delivery already has" (core_ledger.js:1011-1013): owed, credits, by-method
totals, receipts, undo and the sync server already read it.

### 5.7 ➕ add an option in place: `LA|<code>|<resume>|<args>` core_bot.js:1330-1451
`ADD_RESUME_LIST` (1334-1335) names what each resume code goes back to: PM, EM, SXM, ODM, OXM, AC →
`pay_method`; EC → `expense_category`; OF → `fabric`. `askAddOption` (1373-1395): unknown code → `expired`;
store without `addListOption` → `add_unavailable` as a new message (tapped screen untouched); PM/SXM under a
card that can no longer be rewritten → `refuseOnCard`; a question screen already turned into a committed card
(`isCommittedCard`, 1405-1407) → `expired`; then state `{kind:'await_text', purpose:'add_option', list,
resume:{a, args}, saved: <the state the user was in>}` and the prompt `add_ask_pm` ('✏️ ဘဏ်/အကောင့် နာမည်
ရိုက်ပါ (ဥပမာ KBZ ဦးမောင်)') / `add_ask_ec` / `add_ask_fb`: a new message for PM, an edit for every other
resume. `finishAddOption` (1417-1451): `addListOptionByLabel` (core_ledger.js:715-734; key derived by
`listKeyFor` 647-664, at most 11 bytes), prefix `add_done` ('➕ "{label}" ထည့်ပြီး') or `add_exists`, restore
`state.saved`, resume with the key already chosen (PM → `resumeMethod`, EM → `expenseMethod`, EC →
`expenseCategory`, SXM → `sendSplitAmount`, ODM/OXM → order commits, OF → `resumeFabric`, AC → `sendAccounts`),
and for a newly created account on PM/EM/ODM/OXM a hint line `acct_detail_hint` with a `btn_acct_number`
'🔢 နံပါတ် ထည့်' → `LD|pm|KEY` row (1435-1437). `markCommittedCard` (1401-1403, cache `card:<chat>:<msg>`,
600 s) is set by the committing screens (`expenseMethod` 1908, `deliverCommit` 2970, `cancelCommit` 3023).

---

## 6. The state machine

### 6.1 Helpers core_bot.js:2160-2191
- `getState(ports, uid)` → JSON from cache `st:<uid>`; `setState` writes it with TTL `CFG.STATE_TTL_SEC`
  (1800 s) except the two prompts `await_text/add_option` and `await_text/list_detail`, which get
  `CFG.ADD_STATE_TTL_SEC` (600 s) (2164-2169; core_config.js:11-12); `clearState` removes it.
- `dropAddState` (2175-2180): on `/start` (89) and every `M|*` menu tap (527) an open ➕ prompt gives way to its
  `saved` state (or none) and a 🔢 prompt is cleared; every other state survives the menu.
- `setLastItem`/`getLastItem` (`li:<uid>`, 600 s), `setLastGroup`/`getLastGroup`/`clearLastGroup` (`lg:<uid>`,
  30 min).
- Measurement sessions keep their draft under a token: `ms:<token>` (`measToken`/`getMeas`/`putMeas`/`dropMeas`
  3081-3084, TTL `STATE_TTL_SEC`), and the state only holds `{kind:'meas', token, step}`. The confirm cards
  do the same with `cf:<token>` (970-975). This is today's only "draft in the cache, token in the buttons"
  pattern.

### 6.2 Every state kind today

| kind | steps / purposes | fields | set at | consumed at |
|---|---|---|---|---|
| `new_item` | `photo` → `price` → `cost` | `itemId`, `draft{name, category, description, sample, photoUrl, photoFileId, price}` | `openTag` 119, `handlePhoto` 1997-1999, `newItemPrice` 2029/2034 | `handlePhoto`, `handleText` 677-680, `handleIntent` 816-822, P/C/PS callbacks |
| `await_number` | `sale_qty`, `sale_price`, `restock_qty`, `credit_paid`, `pay_amount`, `dep_amount`, `exp_amount`, `set_price`, `split_bank`, `order_price`, `order_qty`, `order_advance`, `deliver_paid` | `itemId` / `groupId` / `customerId` / `draft` / `method` / `orderId` + `saved` / `usePool` | QN 454, D 458, RQ 468, `creditPaid` 1613, `payPick` 1701, `payAmount` 1712, `askDepositAmount` 1771, `depAmount` 1781, `expenseAmountTap` 1869, `expenseAmount` 1880, `setPrice` 2078, `sendSplitAmount` 1187, orders 2563/2587/2780/2944 | `handleText` 681-683 → `applyAwaitedNumber` 710-753; voice `handleIntent` 823-831 |
| `await_text` | `phone`, `exp_note`, `add_option`, `list_detail` | `customerId` / `groupId` / `list, resume{a,args}, saved` / `list, key` | `askPhone` 1526, `askExpenseNote` 1917, `askAddOption` 1391, `askListDetail` 1310 | `handleText` 660-665 (before the number path: "a phone number parses as a number", 658-659); voice 766-789 |
| `find` | — | — | `menuAction` 584 | `handleText` 669-672 → `showFindResults` |
| `find_customer` | — | — | `menuAction` 592 | `handleText` 673-676, voice 790-793 |
| `credit` | `paid` → `customer` → `name` | `groupId`, `paidNow`, `name` | `startCredit` 1601, `askCreditCustomer` 1621, `creditCustomer` 1633, `pickCustomer` 1466-1467 | CC callbacks; `handleText` 685; voice 794 |
| `cu` | `customer` → `name` | `groupId`, `name` | `startAttachCustomer` 1482, `attachCustomerPick` 1492 | CUP; `handleText` 690; voice 796 |
| `dep` | `customer` → `name` → `note` | `amount` (preset or null), `customerId`, `name` | `startDeposit` 1735, `depCustomer` 1746, `askDepositNote` 1788 | DC/DA/DN; `handleText` 686-689; voice 795, 797-800 |
| `exp` | `shop` → `cat` → `amount` → `method` | `draft{shop, cat, amount}` | `startExpense` 1812/1816, `expenseShop` 1847, `expenseCategory` 1858, `expenseAmount` 1884 | ES/EC/EA/EM; `handleText` 684; voice 832-834 |
| `notebook` | — | — | `startNotebook` 2103 | `handlePhoto` 1971 |
| `order` | `customer`, `name`, `phone`, `viber`, `design`, `code`, `price`, `qty`, `due`, `due_text`, `fabric`, `desc`, `advance` | `orderId`, `draft`, `pending`, `lastLine`, `uid` | core_bot.js:2366-2769 | `orderStateText` 2270-2290, `orderTextInput` 2808-2826 |
| `order_tag` | — | `orderId`, `line` | `attachTagLine` 3051 | `openTag` 107 |
| `meas` | `method`, `photo`, `q`, `summary`, `fix_group`, `fix` | `token` | 3134-3329 | `measTextInput` 3237-3244, `measPhoto` |
| `meas_pick` | (none) / `name` | `name` | `startMeasure` 3089/3095 | `handleText` 692, voice 802 |

There is no `back` anywhere: every question has `btn_cancel` → `Z`, which `clearState`s the whole flow and
edits the message to `cancelled` (530-533). The only "back" label in MSG is the measurement flow's `btn_back`
'⏮ နောက်ပြန်' (core_messages.js:335), which steps `s.i` down one question (3208-3213). The app's chrome has
`ui_btn_back` '← နောက်သို့' (app_i18n.js:38).

### 6.3 Where `handleText` dispatches (core_bot.js:649-708), in order
1. typed tag id → `openTag`; typed voucher id → `openOrderCard` (652-655);
2. `await_text` states: `phone` → `savePhone`, `exp_note` → `attachExpenseNote`, `add_option` →
   `finishAddOption`, `list_detail` → `saveListDetail` (660-665);
3. `n = parseNumberText(text)` (core_burmese.js:130-133: Arabic or Burmese digits or number words);
4. `find`, `find_customer`; `new_item` price/cost with a number; `await_number` with a number →
   `applyAwaitedNumber`; `exp/amount` with a number → `expenseAmount`; `credit/name`, `dep/name`, `dep/note`,
   `cu/name`; `meas_pick`; `orderStateText` (669-696);
5. otherwise the AI: `buildAiContext` (615-633, `awaiting` = the step or purpose) → `ports.ai.parseText` →
   `handleIntent` (699-707).

### 6.4 `applyAwaitedNumber(chatId, uid, state, n, ...)` core_bot.js:710-753
Clears the state first (711), then by `purpose`: `sale_price` → `commitSale` qty 1 at price n (NEW sold
card); `sale_qty` → range check, `commitSale`; `restock_qty` → `commitRestock`; `credit_paid` →
`askCreditCustomer`; `pay_amount` → `commitPaymentAndReply`; `dep_amount` → `askDepositNote`; `exp_amount` →
`expenseAmount`; `set_price` → `applyPrice`; `split_bank` → `finishSplit`; the order purposes →
`orderAwaitedNumber`. A rejected value re-sets the state (`sale_qty` 726, `split_bank` via `finishSplit` 1221).

---

## 7. Callback parsing and in-place editing

### 7.1 `handleCallback(cq, staff, updateId, ports)` core_bot.js:423-577
`answerCallback` first (424); `parts = data.split('|')`, `action = parts[0]`, `id = parts[1]`, `arg = parts[2]`
(427); `MUTATING_ACTIONS` double-tap guard (428-432); `edit(text, kb)` closure edits the tapped message with
`isCaption = !!cq.message.photo` (433); `ITEM_ACTIONS` (414: S Q QN D R RQ T X K P C PS SP) load the item and
answer `tag_not_found` when it is gone (434-436); `ORDER_ACTIONS` (420-421) go to `orderCallback` when the
module is on (437-441). The legend at the file head (20-31) lists every prefix; the sale-relevant ones:

| Prefix | Handler | Mutating |
|---|---|---|
| `S\|id\|n` | commit sale | yes |
| `Q\|id`, `QN\|id` | quantity grid / typed | no |
| `D\|id` | changed price (typed) | no |
| `U\|g`, `V\|g` | undo / owner void | U no (idempotent by `already`), V yes |
| `Y\|tok`, `N\|tok` | confirm / reject a proposal | no (token removed) |
| `K\|id`, `M\|which`, `Z` | open card / menu / cancel | no |
| `CR\|g`, `CP\|g\|x`, `CC\|g\|x`, `CD\|g\|yes\|no` | credit flow | CC, CD yes |
| `CU\|g`, `CUP\|g\|x`, `CF\|cust` | attach customer / phone | CUP yes |
| `PM\|g\|KEY` | method rewrite | yes |
| `SX\|g`, `SXM\|g\|KEY`, `SXA\|g\|KEY\|all\|half` | split | SXA yes |
| `LA\|code\|resume\|args`, `LD\|pm\|KEY` | add option / account number | no |
| `PY\|g`, `PL\|cust`, `PA\|g\|all\|other\|n` | receive payment | PA yes |
| `DC\|x`, `DA\|cust\|x`, `DN\|cust\|amount` | deposit | DA, DN yes |
| `ES\|shop`, `EC\|key`, `EA\|x`, `EM\|KEY`, `EN\|g` | expense | EM yes |
| `RC\|g`, `RCP\|g`, `RP\|kind` | receipt, receipt PDF, report | no |

### 7.2 The 64-byte rule
Telegram rejects a whole keyboard when one button's data exceeds 64 bytes (comment core_bot.js:299-300). The
code guards it in two ways: short keys (`METHOD_KEY_MAX_BYTES` and `LIST_KEY_MAX_BYTES` = 12, core_config.js:
100, 117; `payMethods` drops and logs longer keys, core_ledger.js:120, 165-169; `listKeyFor` makes keys of at
most 11 bytes) and `utf8ByteLength` checks before each risky button (`methodRows` 312, 323-324;
`sendSplitAmount` 1195; `accountsScreen` 1289; `expenseCatScreen` 1829; `customerCard` 1583; `sendDesignScreen`
2455; `orderFabric` 2664). `PM|<36-char uuid>|<KEY>` is 40 bytes + key (core_config.js:98). Customer ids
(`C-0001`) and item ids (`S1-0042`) are short; group ids are 36-byte uuids, so a prefix + group + two short
args is the practical ceiling (`SXA|g|KEY|half` = 4+36+1+12+1+4 = 58 at the longest key).

### 7.3 In-place editing conventions
- Question screens are edited into the next question (`expenseShop` 1850, `expenseCategory`/`editOrSend`
  1862, `askCreditCustomer` 1625, `askDepositAmount` 1775, `sendSplitAmount` 1198, `creditPaid` 1614, order
  screens).
- A typed or spoken answer has no tapped message: `editOrSend(ports, chatId, msgId, text, kb)` (380-383) sends
  a new message when `msgId` is null; `withPrefix` (386-388) puts the ➕ "added" line in front;
  `withHintLine`/`withHintRow` (395-400) add the 🔢 hint to the ONE resumed message.
- A committing tap edits the question into the committed card (`expenseMethod` 1910, `deliverCommit`,
  `payAmount` → `commitPaymentAndReply` 1728) and `markCommittedCard`s it.
- A committed card is never edited into a question: `startCredit`, `startAttachCustomer`, `startSplit`,
  `payPick`, `askPhone`, `askExpenseNote`, `askAddOption` (PM) all `sendMessage` (1603, 1485, 1172, 1705, 1527,
  1918, 1394). Refusals on a card go through `refuseOnCard`.
- `S|id|n` edits the item card into the sold card (450); the typed paths (`sale_price`, `sale_qty`) send a new
  sold card (720, 733).

---

## 8. Customers

| Function | Where | Behaviour |
|---|---|---|
| `findCustomers(ports, hint)` | core_ledger.js:1345-1367 | 4+ digits and no letters → phone match (exact first, then containing); else exact `normName` matches then partial (name contains hint or vice versa). Never merges. |
| `matchCustomers(ports, hint)` | 1370-1374 | `{exact, partial}`; exact = same normalised name or same `normPhone`. |
| `resolveOrCreateCustomer(ports, name)` | 1377-1381 | exact match or `addCustomer({name})`; used by the voice/notebook confirm path only (core_bot.js:1023, 1056). |
| `pickCustomer(chatId, uid, state, name, ports, mk)` | core_bot.js:1460-1472 | empty → `ask_name`; exact → that customer; no look-alike → created silently; look-alikes → `state.name = name`, `setState`, a `cust_pick` ('👤 "{name}" · ဘယ်သူလဲ?') screen with up to four `customerLabel` buttons (`mk(id)`), `btn_create_named` ('✏️ "{name}" အသစ် ဖန်တီး') → `mk('create')`, cancel; returns null after asking. Used by `creditNamed`, `attachNamed`, `depositNamed`, `measPickNamed`; the order flow has its own copy `orderNamed` (2403-2415) that also asks the phone. |
| `customerLabel(c)` | 1474-1476 | `'👤 ' + name` + ` · ` + `fmtPhone(phone)` when there is one. The credit/attach pickers use `'👤 ' + c.name` without the phone (1483, 1622). |
| `recentCustomers(ports, shop, n)` | core_ledger.js:1297-1312 | customers of the latest ledger rows of that shop (owner: any), padded with the newest `createdAt`. `CUST_MENU_RECENT` = 6 for the menu (core_config.js:120), 4 inside flows. |
| `normPhone` / `isValidPhone` / `fmtPhone` | 1320-1339 | Burmese digits → Arabic, `+959…`/`959…`/`9…` → `09…`; valid = `/^09\d{7,9}$/`; shown as `+95 977 712 3456`. |
| `customerName(ports, id)` | 1290-1294 | name or the id, '?' when blank. |
| `customerSummaryMap/Summary/Summaries` | 1246-1280 | bought/paid/owed/depositHeld/lastDay/visits; feeds `Customers` columns F:K through `refreshViews`. `CUSTOMER_COLS` core_config.js:138. |
| `customerHistory` | 1283-1288 | last n live rows, newest first; `customerLine` (core_bot.js:1556-1562) prints `cust_line`. |
| `showCustomers` / `showCustomerFind` / `customerCard` | core_bot.js:1543-1585 | `M\|cust` → six recent + `btn_find` → `M\|cfind` + cancel; `CH\|id` → `cust_card` + history + row 1 `btn_pay` (`PY\|g` when one credit, else `PL\|cust`) and `btn_deposit` → `DC\|id`; row 2 `btn_phone` → `CF\|id`, `btn_statement` → `CS\|id`; `btn_measure` → `MS\|id` when measurements are enabled. |

Store methods: `getCustomer`, `listCustomers`, `addCustomer({name})` (returns the row with `id`),
`updateCustomer(id, {phone | note})` (core_bot.js header 6; uses at 1465, 1499, 1537, 2395, 2430).

---

## 9. Credits and deposits

### 9.1 Reading a sale: `saleGroupInfo(ports, groupId)` core_ledger.js:1064-1086
Sums the group's SALE rows (mirrors net out) → `total`, `cash`, `qty`; `applied` = DEPOSIT_APPLIED rows in the
group; `payments` = PAYMENT rows whose `refGroupId` is the group; `owed = total - cash - applied - payments`;
`voided = total <= 0`; `customerId`/`method`/`shop`/`day`/`time`/`itemId` from the first live row;
`voidedRows` for receipts. `groupMethods` (1100-1112) lists `{method, amount}` over live SALE cash and
referencing PAYMENT rows.

### 9.2 `openCredits(ports, shop)` core_ledger.js:1122-1169
One pass over the ledger to find groups that can still owe, then `saleGroupInfo` for those; returns
`{groupId, shop, day, time, customerId, customer, itemId, item, qty, total, cash, payments, applied, owed,
days: daysSince(time, now)}` oldest first. `CREDIT_COLS` (core_config.js:157): GroupID, Day, Shop,
CustomerID, Customer, ItemID, Item, Total, Cash, Payments, DepositUsed, Owed, Days: no due date. The 21:00
summary flags `c.days >= CFG.OVERDUE_DAYS` (30, core_config.js:16) with `summary_overdue` ('⏰ {days} ရက်ကျော်
အကြွေး: {list}') (core_ledger.js:1551-1557). Nothing today stores or reads a promised date on a sale; only
orders have `DueDay` (`ORDER_COLS` core_config.js:148, `openOrders` sorts by it core_orders.js:241-248,
`ordersDue`/`ordersOverdue` 251-258, `orderSummaryLines` 476-491).

### 9.3 Deposits held: `depositsHeldMap` core_ledger.js:1178-1205 and friends
Per customer: `received` (DEPOSIT amounts), `used` (DEPOSIT_APPLIED), `held`, `earmarks{orderId: left}` for
advances whose `refGroupId` is a voucher id, `free = held - earmarked`. `depositsFor` (1208) = held;
`depositsFree` (1214) = free; `depositEarmark` (1220); `depositsAvailable` (1226) = free + that order's earmark;
`depositsHeldList` (1232-1237) for the Deposits view (`DEPOSIT_COLS` core_config.js:159). `applyDeposit`
(858-873) consumes the free pool (or the earmark with `p.orderId`) into the sale's group.

### 9.4 Taking a deposit: `M|dep` → core_bot.js:1734-1805
`startDeposit(…, presetAmount, prefix)`: state `{kind:'dep', step:'customer', amount}`; `dep_ask_customer`
('📥 စရံ · ဘယ်သူလဲ?') with four recent `'👤 ' + name` → `DC|custId`, `btn_new_customer` → `DC|new`, cancel.
`depCustomer` (new → step `name` + `ask_name`; create → `addCustomer`) → `depositForCustomer` → with a preset
amount straight to `askDepositNote`, else `askDepositAmount`: state `{await_number, dep_amount, customerId}`,
`dep_ask_amount` with `depositPresets` (Settings `deposit_presets` or `CFG.DEPOSIT_PRESETS` [50000, 100000,
200000, 300000]) as `DA|cust|a`, `btn_other` → `DA|cust|other`, cancel. `askDepositNote`: state `{dep, note,
customerId, amount}`, `dep_ask_note` ('📝 ဘာအတွက်လဲ? (ရိုက်ပါ၊ ဒါမှမဟုတ် ကျော်ပါ)') with `btn_skip` →
`DN|cust|amount`. `finishDeposit` → `commitDeposit` (core_ledger.js:841-850: DEPOSIT, amount = cash, method via
`methodFor`), `dep_done`, `replyKeyboard` (undo + 🏦 rows) + `phoneRow`. A spoken deposit with a method passes
`methodKeyFor(intent.method)` (798-799).

### 9.5 Receiving a payment: `M|pay`, `PY|g`, `PL|cust` core_bot.js:1684-1730
`showPayList`: `openCredits` of the staff's shop (owner: all), filtered by customer when given; none →
`pay_none`; else up to eight `creditButtons` ('👤 {customer} · {owed} · {day}' → `PY|g`) + cancel under
`pay_list` ('💰 ဘယ်သူ ပေးတာလဲ?'). `payPick`: state `{await_number, pay_amount, groupId}`; NEW message
`pay_ask_amount` ('💰 👤 {customer} · ကျန် {owed} ကျပ် · ဘယ်လောက် ပေးလဲ?') with `btn_all` 'အကုန် {amount}' →
`PA|g|all`, `btn_other` → `PA|g|other`, cancel. `payAmount` → `commitPaymentAndReply` → `commitPayment`
(core_ledger.js:823-835: PAYMENT capped at owed, `refGroupId` = the sale group, customer from the sale),
`pay_done` + `methodLine`, `replyKeyboard` (undo, receipt of the sale, 🏦 rows for the payment row).

---

## 10. The expense flow: the existing one-question-per-screen pattern

This is the closest thing today to what D1 asks for; the guided sale can copy its shape.

| Screen | Function | State after | Text (MSG) | Buttons |
|---|---|---|---|---|
| 0 (owner only) | `startExpense` core_bot.js:1810-1815 | `{exp, shop, draft{}}` | `exp_ask_shop` '💸 ဘယ်ဆိုင် အတွက်လဲ?' | `shopName(S1)`, `shopName(S2)` → `ES\|S1\|S2`; cancel |
| 1 | `startExpense` 1816-1818 (seller) / `expenseShop` 1843-1851 (owner, edits in place) | `{exp, cat, draft{shop}}` | `exp_ask_cat` '💸 ဘာ ကုန်ကျစရိတ်လဲ?' | `expenseCatScreen` 1825-1836: `expenseEmoji + label` → `EC\|key`, three per row; last row `btn_add_cat` '➕ အမျိုးအစားအသစ်' → `LA\|ec\|EC`, cancel |
| 2 | `expenseCategory` 1854-1863 (edit, or new message with prefix after ➕) | `{exp, amount, draft{shop, cat}}` | `exp_ask_amount` '💸 {cat} · ဘယ်လောက်လဲ?' | `expensePresets(cat)` (most common past amounts padded from Settings `expense_presets`/`CFG.EXPENSE_PRESETS`, core_ledger.js:299-314) → `EA\|a`; `btn_other` → `EA\|other`; cancel |
| 2b | `expenseAmountTap` 1865-1873 `other` | `{await_number, exp_amount, draft}` | `ask_number` '✏️ ဂဏန်း ရိုက်ပေးပါ (ဥပမာ 25000)' | none (typed) |
| 3 | `expenseAmount` 1876-1890 (edit or send) | `{exp, method, draft{shop, cat, amount}}` | `exp_ask_method` '💸 {cat} {amount} ကျပ် · ဘယ်လိုပေးလဲ?' | `methodRows(shop, null, 'EM\|KEY', add 'LA\|pm\|EM')`; cancel |
| commit | `expenseMethod` 1896-1911 | cleared | `expense_done` '💸 ကုန်ကျစရိတ် {amount} ကျပ် · {cat}{note} · {method} မှတ်ပြီးပါပြီ' | `replyKeyboard` (undo, `btn_note` → `EN\|g`, 🏦 rows); `markCommittedCard` |
| after | `askExpenseNote` 1914-1919 → `attachExpenseNote` 1921-1931 | `{await_text, exp_note, groupId}` | `exp_ask_note` | rewrite of the note within `rewriteCheck` |

What makes it work: one state object carries the whole draft (`draft{shop, cat, amount}`); each handler
checks `expenseState(ports, uid, step)` (1838-1841) and answers `expired` on a stale tap; each screen edits the
previous one in place; typed and spoken numbers feed the same `expenseAmount`; nothing is written before the
last tap (`commitExpense`, core_ledger.js:795-803); ➕ returns to the same step through `finishAddOption`. What it
lacks for the sale: no back button, no summary screen before the write, no skips.

---

## 11. The menu per role: `showMenu(chatId, staff, ports)` core_bot.js:127-147

Row 1: `btn_today` '📊 ဒီနေ့' → `M|today`, `btn_recent` '🕘 မကြာသေးမီ' → `M|recent`, `btn_find` '🔍 ရှာ' → `M|find`.
Row 2: `btn_pay` '💰 ငွေလက်ခံ' → `M|pay`, `btn_deposit` '📥 စရံ' → `M|dep`, `btn_expense` '💸 ကုန်ကျ' → `M|exp`.
Row 3: `btn_customers` '👤 ဝယ်သူများ' → `M|cust`, `btn_reports` '🖨 စာရင်း' → `M|rep`, `btn_help` '❓ အကူအညီ' → `M|help`.
Row 4 (`extra`): `btn_orders` '🧵 အော်ဒါ' → `M|ord` when `ordersEnabled`, else `btn_measure` '📏 အတိုင်းအတာ' →
`M|meas` when the app's form is present (`measureFormEnabled`, 3115); `btn_notebook` '📒 စာအုပ်' → `M|nb` when
Settings `notebook_import`; `btn_accounts` '🏛 အကောင့်' → `M|acct` always.
Row 5 (only with `ports.sync`): `btn_app` '📲 အက်ပ်' → `M|app`; owner adds `btn_devices` '📱 ဖုန်းများ' →
`M|devices`.
Text `menu` ('👋 ပစ္စည်း Tag ကို scan လုပ်ပါ။ ဒါမှမဟုတ် အောက်က ခလုတ် နှိပ်ပါ။'). The seller and the owner see the
same first four rows; the role differences are `btn_devices`, the owner's shop question in the expense flow
(1811), owner-only `V|g` void (502), `OX` order cancel (2358, 2987), `/devices`, and "all shops" in
`showPayList`/`showCustomers`/`showRecent`/`answerToday`/`openCredits` (`staff.role === 'owner' ? null :
staff.shop`). There is no "sell" button on the menu: selling starts with a scan or a typed id.

---

## 12. Settings read by the sale and money code

| Key | Read at | Meaning |
|---|---|---|
| `text_cards` | core_bot.js:235 (`settingOn`) | cards without photo |
| `notebook_import` | 137, 2102 | the 📒 button and flow |
| `app_url` | 3409 | url button into the app |
| `shop_name_S1/S2` | core_config.js:178 (`shopName`) | shop labels on buttons and cards |
| `pay_methods` | core_ledger.js:381 (`legacyListRows`) | fallback account keys when the Lists tab has no rows |
| `expense_categories`, `expense_presets` | 397, 308 | fallback categories; amount presets |
| `lists_json` | 453 (`listRows`) | the phone's synced copy of the Lists tab |
| `price_presets`, `deposit_presets` | 1654, 1664 | preset buttons |
| `low_stock_threshold` | 1510 | the summary's low-stock line |
| `fabric_presets`, `due_presets`, `order_remind_days`, `order_next_no_<shop>`, `shop_brand_/address_/phone_<shop>` | core_orders.js (415; 48-49 of core_config.js; 42-44) | orders only |
`settingOn` (core_config.js:190-193) accepts `true`, `1`, `'TRUE'`, `'1'`. A `sale_flow` key does not exist
yet (grep over apps-script, app and poc finds none).

---

## 13. Messages: `t(ports, key, vars)` core_messages.js:426-432
Sheet override first (`ports.store.getMessage(key)`), then `MSG[key]`, then the key itself; `fill`
(core_burmese.js:136-140) replaces `{placeholders}`. `MSG` holds every family-facing string (6-423); the app
merges `APP_MSG` into `MSG` at load so `t()` finds its chrome strings too (app_i18n.js:149-153), and
`appT` works before a store exists (156-162). Method labels are `method_<KEY>` (`method_CASH` 'ငွေသား',
`method_KBZ` 'KBZPay', `method_WAVE` 'WavePay', `method_BANK` 'ဘဏ်လွှဲ', 127-130) only on a sheet without
Lists rows; with rows the Label column wins (`methodLabel`). Order-flow strings that a promised-date step could
reuse verbatim: `ord_ask_due` '📅 ရွေးမည့်ရက် ဘယ်တော့လဲ?' (236), `ord_due_set` '📅 ရွေးမည့်ရက် {date}' (237),
`btn_days` '{n} ရက်' (238), `btn_due_type` '✏️ ရက်စွဲ ရိုက်' (240), `ord_ask_due_text` '✏️ ရက်စွဲ ရိုက်ပါ (ဥပမာ
30.10.26)' (251), `ord_bad_date` (252); they say "collection date", so the sale wording would need new keys.

---

## 14. The ports the bot and ledger use

From the calls in core_bot.js and core_ledger.js (counts are call sites):
- `chat`: `sendMessage(chatId, text, kb)` ×234, `editMessage(chatId, msgId, text, kb, isCaption)` ×77,
  `answerCallback` ×2, `typing` ×9, `sendPhoto` ×1, `sendDocument` ×5, `getFile` ×4, `savePhoto` ×3.
  `sendMessage` returns `{messageId}` (used by `askMeasQuestion`, 3188-3189).
- `cache`: `get`/`put(key, value, ttlSec)`/`remove`. Keys: `upd:<id>` (21600 s), `tap:<chat>:<msg>:<data>`
  (120 s), `st:<uid>`, `li:<uid>`, `lg:<uid>`, `cf:<token>`, `nb:<token>`, `ms:<token>`, `card:<chat>:<msg>`
  (600 s), `pmwarn:`/`pmcap:`/`listkey:` (21600 s, core_ledger.js:151-162).
- `clock.now()` → Date (×17 bot, ×7 ledger); `uuid()` (×3 each; `newTx` txIds, proposal and measurement
  tokens). `lock.run(fn)` only in `writeGroup` (core_ledger.js:69) and the stores' own adds.
- `store`: `getItem`, `listItems`, `updateItem`, `appendLedger`, `ledgerRows`, `getStaff`, `listStaff`,
  `getCustomer`, `listCustomers`, `addCustomer`, `updateCustomer`, `getSetting(key, default)`, `getMessage`,
  `logError(where, err, updateId, payload)`, `logUnknownUser`, optional `refreshViews`, optional
  `listOptions`/`addListOption`, optional order/measurement methods (header 5-12).
- `ai`: `parseVoice`, `parseText`, `describePhoto`, `readNotebook`, `readMeasurementSheet`; `pdf.make`;
  optional `sync` (`mintCode`, `devicesText`, `deviceAction`, `isEnrolled`); optional `ui.measureForm` (the app
  only, 3115, 3131); optional `dedupe`.
The simulator's ports: an in-memory cache with TTL (poc/sim_ports.js:327-335), `lock.run = fn()` (375),
`clock.now` with `nowOverride` (376), `simUuid` (377, 472), `getMessage` from `world.messages` (277). The
Sheet store stamps Seq/ReceivedAt/DeviceID `'TG'` in `appendLedger` and writes `CFG.LEDGER_COLS` by header name
(gas_store.js:371-388); the phone store assigns the receipt number and updates stock in its `appendLedger`
(app_store.js:294-308).

---

## 15. How the app shows a sale today (app/app_ui.js)
`appCardInfo` (37-46) recognises an item card by its `S|<id>|1` button and a SKU card by `Q|<id>`;
`appKeyboardForCard` (55-66) drops those two buttons and `appStepper` (696-712) draws `[−] n [+]` plus one big
sell button whose data is `appStepperData` = `S|id|n` (48-53); the quantity keypad is `ui_keypad_qty`
'🔢 အရေအတွက်'. `appInputModeFor(state)` (68-78) decides the input bar from the core's state: `await_number` →
`'number'` (the keypad opens by itself once per message, 757-761, bar `ui_type_number_bar` '⌨️ ဂဏန်း ရိုက်မယ်');
`await_text`, `find`, `find_customer`, `credit/dep/cu` at step `name`, `dep/note`, `meas_pick` → `'text'`;
`new_item/photo`, `notebook` → `'photo'`. Every tap goes through `appOnTap` → `APP.phone.sim.tap(msgId, data)`
(779-787), i.e. the same `handleCallback`. Any new state kind or step that waits for a number or a name must be
added to `appInputModeFor`, or the app shows no keypad for it.

---

## 16. Tests that touch today's after-sale card (for D5)
Callback strings `CR|`, `CU|`, `CUP|`, `CC|`, `CP|`, `SX|`, `SXM|`, `SXA|`, `PM|`, `CD|` appear 121 times in
poc/run_round4.js, 6 times in poc/run_scenario.js (lines 437, 439, 464, 493, 572, 870: the 🏦 and
👤/`btn_credit` buttons of card 35, the `CUP` picker of step 39, the 🏦 row under a payment, the 🏦 row under a
voucher's advance), 5 in poc/run_app.js (666, 703-706: `PM` buttons after ➕, the split on the real app store)
and 2 in poc/run_lists.js (898, 900). poc/run_scenario.js has 410 `step`/`check` lines in all. These suites
expect `afterSaleKeyboard` exactly as in section 4.1 after an `S|id|n` tap, so they are the ones a `quick`
default must keep green.

---

## 17. What a one-write guided sale would touch

### 17.1 Reusable as is
- **Entry and item**: `openTag`/`tagIdFromText`/`K|id`, `cardText`, `isPricePending`, `sendItemCard`
  (`text_cards`), `clampQty`, `QTY_GRID`, `MAX_SALE_QTY`, `bad_qty`, `ask_qty`, `ask_qty_number`,
  `ask_sale_price`; the UNIQUE/SKU distinction that already skips the count for a one-of-a-kind piece
  (cardKeyboard 215-222).
- **The write**: `commitSale` already takes `qty`, `unitPrice`, `paid`, `customerId`, `method`, `note`,
  `source`, `transcript` and writes one SALE row (core_ledger.js:755-768); `newTx` + `writeGroup([...])`
  accept several rows in one group under one lock (66-74); the mixed shape (SALE with the cash part, method
  CASH, plus a PAYMENT row with the account part, `refGroupId` = group, note `'split'`) is `splitSale`'s
  output (1039-1045), which every reader, the receipt, the by-method totals, undo and the sync server already
  understand. A new `commitSaleGroup`-style function can build `[sale, payment]` from those two constructors
  without a mirror. `methodFor` for the stored key; `afterWrite` refreshes Credits/Deposits/Customers when a
  customer or a part payment is on the row.
- **After the write**: `soldText`/`describeRow`, `btn_undo` → `U|g` (`undoGroup`, 30-min window), `btn_receipt`
  → `RC|g` (`buildReceipt` prints mixed methods and `receipt_transfer`), `setLastGroup`/`setLastItem`,
  `btn_pay` → `PY|g` while owed, `saleGroupInfo`, `openCredits`, `credit_done` wording, `applyDeposit` and
  `credit_use_deposit` for a buyer who holds a deposit.
- **Buyer**: `recentCustomers(shop, n)`, `customerLabel`, `matchCustomers`/`findCustomers` (name or phone),
  `pickCustomer`'s look-alike screen (`cust_pick`, `btn_create_named`), `addCustomer`, `ask_name`,
  `btn_new_customer`, `credit_ask_customer`; `normPhone`/`isValidPhone`/`fmtPhone`, `ask_phone`, `phone_saved`,
  `phone_odd`, `btn_skip`, `updateCustomer({phone})`; `phoneRow`.
- **How paid**: `payMethods(shop)`, `listOptions('pay_method', shop)`, `methodLabel`, `methodKnown`,
  `methodKeyFor` (spoken account names), `methodRows` layout rules (3-per-row / 2-per-row, 64-byte skip,
  extra last row), `btn_cash`, `btn_bank`, `btn_split` text '💵+🏦 ခွဲပေး', `split_ask_amount`-style amount
  question with `btn_all`/`btn_half`, `split_bad`, `startSplit`'s "one account → skip the account screen"
  rule (1169) and its `split_no_bank` + ➕ path, `askAddOption`/`finishAddOption` with a new resume code in
  `ADD_RESUME_LIST` (a `pay_method` resume gets the 🔢 hint for free, 1435-1437).
- **Part now**: `credit_ask_paid`-style buttons `0 / half / other`, `btn_all`, `depositPresets`,
  `ask_number`, the `await_number` + `applyAwaitedNumber` path with the app's auto-keypad.
- **Pattern**: the `exp` state's `draft{}` + `expenseState(uid, step)` stale-tap guard + edit-in-place per step
  + `editOrSend`/`withPrefix` for typed answers + `markCommittedCard` on the committing tap; the `ms:<token>`
  cache-draft pattern when the draft must not ride in callback data; `Z` cancel; `MUTATING_ACTIONS` for the
  one committing action; `settingOn(ports, key)` for the `sale_flow` switch; `buildAiContext.awaiting` for
  voice answers inside a step; `dropAddState` semantics on `/start` and `M|*`.
- **Date**: `parseDayText(text, now)` ('30.10.26', '30/10', Burmese digits; core_orders.js:66-78),
  `addDaysKey` (49-54), `daysBetweenKeys` (57-60), `fmtDayMy`/`fmtDayShortMy`, `CFG.DUE_PRESETS` [7,14,21,30]
  and `duePresets` (Settings `due_presets`), `btn_days` '{n} ရက်', `btn_due_type`, `ord_ask_due_text`,
  `ord_bad_date`. Caveat: `parseDayText`, `addDaysKey` and `daysBetweenKeys` live in core_orders.js, an
  optional module (`ordersEnabled`, core_report.js:14-16; "This file calls nothing defined in core_orders.js"
  core_ledger.js:25-26), so a sale-side due date either moves them to core_burmese.js/core_ledger.js or
  guards with `typeof`.

### 17.2 No equivalent today
1. **A promised date on a sale.** No ledger column, no `newTx` field, no reader: `LEDGER_COLS`
   (core_config.js:132-134) ends at `ReceiptNo`; `newTx` (core_ledger.js:31-63) has no field for it; the
   three hand-written header maps drop any field they do not name: `gasStore.appendLedger` (gas_store.js:
   377-385, the Telegram route), `gasSyncLedgerValues` (gas_sync.js:160-170, the phones' pushes) and the
   `ledgerRows` reader (gas_store.js:389-401, which is also what a pull sends to the phones whole,
   core_sync.js:1047-1056, 1007-1008). The phone's own store copies every field (`rowToDisk`,
   app_store.js:237) and `syncValidateTx` only checks the fields it lists (core_sync.js:381-385), so neither
   rejects a new one. `rewriteRows` must copy it onto the replacement (965-990); `undoGroup` mirrors (918-925)
   may leave it blank; `openCredits`' output and `CREDIT_COLS`, `buildDailySummary`'s overdue test
   (`c.days >= OVERDUE_DAYS`, 1551), the Credits view writer (`refreshViews`), the owed report, and
   `setupSheet`'s `ensureColumns` (gas_setup.js:257-265 appends missing headers at the right-hand end, which
   is what D4 relies on) all know nothing of it.
2. **A buyer step inside the sale.** Every customer question today runs **after** the row exists and rewrites
   it (`finishCredit`, `finishAttach`), or comes from the AI (`confirmProposal`). The only pre-write customer
   picker is the order flow's (`startNewOrder` → `orderCustomer`/`orderNamed` → `orderAskPhone`), and it
   creates the Customers row the moment a new name is typed (2390, 2408), before the order exists. A guided
   sale that writes nothing until the summary must either accept that an abandoned flow may leave a new
   Customers row (as orders do), or keep `{name, phone}` in the draft and `addCustomer` at commit; `pickCustomer`
   creates immediately (1465), so a variant that returns "create later" is needed. There is no "no name" button
   anywhere today (the buyer is optional only by not tapping 👤).
3. **A kind for accounts (wallet vs bank).** `LIST_COLS` (core_config.js:116) has no `Kind`; `listNormRow`
   (core_ledger.js:336-348) keeps only `list, key, label, active, order, shop, detail, note` and drops any
   other column; `listRowToCompact`/`listRowFromCompact` (498-506) carry `{k,l,a,o,s,d}` only, so the phones'
   `lists_json` would lose it; `listUpsert` (561-600) has no `kind` in `rec`; `gasStore.addListOption` and
   the Lists tab seed know no such column; `methodRows` and `payMethods` treat every non-cash key alike and
   `btn_bank` prefixes all of them with 🏦. `btn_add_bank`/`add_ask_pm` ask for a name only; a two-button
   "which kind" screen after ➕ does not exist.
4. **A back button and a step history.** Flows store only the current step; `Z` cancels everything. The
   measurement flow's `btn_back` '⏮ နောက်ပြန်' is the only backwards move and it is index arithmetic on
   `s.i`. D1's '↩️ back' must not collide with `btn_undo` '↩️ မှားသွားတယ်' on the summary card.
5. **A summary-and-confirm screen before the write.** `propose`/`confirmProposal` is the nearest shape
   (`confirm_sale` + `confirm_sale_credit` + `method_mark` + `confirm_ask`, `btn_yes`/`btn_no`), but it is
   built from an AI intent, holds the draft in `cf:<token>`, and its SALE branch writes through
   `commitSale` alone (no PAYMENT row for a mixed payment, no date).
6. **"Full now or part now" as a yes/no screen.** Today the part payment is reached only by `btn_credit` after
   the sale (`credit_ask_paid` asks the amount directly) or by a spoken `paid`.
7. **A `sale_flow` setting and a second keyboard for the card.** `cardKeyboard` has one shape per item type;
   the app's `appCardInfo` keys on `S|<id>|1` and `Q|<id>` to draw its stepper, so a `steps` card whose first
   button is not `S|id|1` either keeps that data (and lets `S` start the flow instead of committing) or the app
   must learn the new button.
8. **Mixed payment asked before the write.** `startSplit`/`finishSplit` need a committed group
   (`splitGuard` → `rewriteCheck`). The amount question and the `all/half` buttons are reusable text, the
   functions are not.
9. **State kinds in the app's input map.** `appInputModeFor` (app_ui.js:68-78) lists today's kinds explicitly;
   a `sale` kind with number or text steps needs entries there, or the phone shows no keypad or text field.
10. **Owner-side wording for the Credits view and the 21:00 line.** `summary_overdue` counts days since the
    sale; there is no "due on {date}" or "past due since {date}" string.

### 17.3 Figures the spec can take from this map
- Undo window 30 min (`UNDO_WINDOW_MIN`); state TTL 30 min (`STATE_TTL_SEC`); ➕ prompt 10 min; last item
  10 min; proposal 30 min; double-tap guard 120 s; committed-card memory 10 min.
- Button capacity: 64 bytes of data; group id 36 bytes; key <= 12 bytes; `MAX_BANK_BUTTONS` 12; `methodRows`
  wraps to two per row above three buttons or a label over ten characters.
- Presets: `QTY_GRID` 2..9; `DEPOSIT_PRESETS` 50k/100k/200k/300k; `DUE_PRESETS` 7/14/21/30 days;
  `OVERDUE_DAYS` 30; `CUST_MENU_RECENT` 6, in-flow pickers 4.
