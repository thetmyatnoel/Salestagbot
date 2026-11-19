# Map: every reader of a sale group, and what a basket does to it (round 5b)

Date 2026-11-12. Mapper's report for `BRIEF-basket.md` (B1-B11). Tree: the current one (round 5 built, revision 2.1),
line numbers as of today. Scope: `apps-script/core_*.js`, `gas_*.js`, `app/app_*.js`, `poc/sim_*.js`. No code or test
was changed.

**Words used below.** A *basket* is what B1 asks for: ONE group, one SALE row per basket line (line order = the order
the seller added them), the buyer on every row, at most one PAYMENT row for the transfer part of a mixed payment, later
PAYMENT / DEPOSIT_APPLIED rows referencing the group as today. Verdicts:

- **works**: reads the whole group (or each row on its own) and gives the right answer for a basket with no change;
- **first row**: works, but a field comes from the first live SALE row only, so a basket shows as if it were its
  first item;
- **depends**: works only if the basket is WRITTEN by a rule named in section 3 (customer on every row, DueDay rule,
  row order, the allocation rule);
- **breaks**: gives a wrong number or a wrong record.

Short answer: the money core already sums groups (the custom-order delivery proved it), so totals, owed, receipts,
undo, the 21:00 summary, the Sheet Dashboard and the sync server all hold. What does not hold: names and cards that
show "the item" of a group (sold card, undo card, Credits item name, item-card buyer line, the app's pending line,
the customer card's history), the phone's receipt counter (one number burnt per SALE row), and two write rules the
spec must fix (DueDay must be on the FIRST row that `saleGroupInfo` reads; a PAYMENT must come after ALL SALE rows).

---

## 1. How cash and DueDay are stored per row today

**SALE rows.** `Cash` = money paid at the sale on THIS row (header, core_ledger.js:5-6, and the balance rule :13:
"Amount - Cash - its DEPOSIT_APPLIED rows - PAYMENT rows that reference it"). Every writer keeps `0 <= Cash <= Amount`
on a SALE row: `commitSale` (:806), `commitSaleGroup` (:829), `rewriteRows` clamps a rewritten SALE row (:1058). The
server checks only magnitudes (`syncValidateTx`, core_sync.js:381-382), never `Cash <= Amount`. `Method` = how that
row's cash moved; `methodFor(key, cash)` stores `''` when cash is 0 (core_ledger.js:104-107) and readers treat a blank
with cash as CASH (`methodOf`, :98-101).

**The guided write (`commitSaleGroup`, core_ledger.js:824-855).** One SALE row with `cash = paid` and
`method = methodFor(payKey, paid)` (:838-843); for a mixed payment with both parts > 0 (`twoRows`, :835) the SALE row
carries the cash part with method CASH and a PAYMENT row follows with `amount = cash = bankPart`, method KEY,
`refGroupId = groupId`, customer copied, note `'split'` (:846-851), written AFTER the SALE row in one `writeGroup`
(:853). Note: `'split'` / `'credit'` / `'price'` / `''` (:836).

**DueDay.** `newTx` puts `dueDay` on every row (:60, `''` by default). `commitSaleGroup` sets it on the SALE row only,
by a GROUP-level condition: `dueDay = owed > 0 ? p.dueDay : ''` where `owed = amount - paid` of the whole sale (:833,
:837); the PAYMENT row gets none. `rewriteRows` copies it (:1074); undo mirrors drop it (the mirror literal
:1005-1011 passes no dueDay). The server stores a missing one as `''` (core_sync.js:795) and refuses a non-date
(:390). Exactly one reader decides a group's date: `saleGroupInfo` returns `first.dueDay` with
`first = live[0] || saleRows[0]` (core_ledger.js:1166, :1170), i.e. **the first live SALE row in ledger order**.
Everything downstream (openCredits :1264, creditOverdue :1214-1216, the receipt :356, the sold card :3214, the
reports, the 21:00 summary :1653-1666) takes `info.dueDay` / `c.dueDay` from there.

**The delivery precedent (`deliverOrder`, core_orders.js:257-302).** One group per voucher; one SALE row per line with
`cash: 0` (:270); the customer on every row through `base` (:264-265); the money lives in group rows only:
DEPOSIT_APPLIED for the earmark (:277) and the free pool (:283), one PAYMENT with Method for the cash handed over,
`refGroupId = order id`, all AFTER the SALE rows (:289), one `writeGroup` (:292). Their `itemId` is the first line's
(`txs[0].itemId`). A voucher's promised date lives on the Orders tab, never on Ledger rows. So the precedent proves
that the GROUP-summing readers accept several SALE rows; it never exercised (a) cash allocated over several SALE rows,
(b) DueDay on a multi-row group, (c) a multi-SALE-row group written on a phone (the app has no `listOrders`, so
`ordersEnabled` is false there and no phone ever pushed such a group), (d) a multi-row group whose first line is a
stocked tag in `openCredits` (see 2.2).

---

## 2. The readers, one by one

### 2.1 `saleGroupInfo` (core_ledger.js:1152-1176) - works for sums; first row for the rest

Sums over every SALE row of the group (mirrors included, so undo nets out): `total`, `cash`, `qty` (:1163); every
DEPOSIT_APPLIED in the group (:1164); every PAYMENT whose `refGroupId` is the group (:1165). `owed = total - cash -
applied - payments`. From the first live row (:1166-1170): `itemId`, `unitPrice`, `method`, `customerId`, `dueDay`,
`shop`, `day`, `time`. `rows` = the live SALE rows (`info.rows.length > 1` is how a reader can tell a basket or a
delivery; a rewrite leaves one live replacement, a mixed one-item sale has one live SALE row), `voidedRows` = the SALE
rows an undo reversed.

Basket: totals and owed are right whatever the per-row split. `qty` is the sum of pieces over DIFFERENT items.
`customerId` and `dueDay` are right only under the write rules of section 3 (customer on row 1; DueDay on row 1).
Consumers of the first-row fields are few: `saleCardText` (core_bot.js:3197, itemId), `commitPayment` (:916) and
`applyDeposit` (:954) copy `itemId` onto the new row, `openCredits` (:1253-1260), `orderMoney` (core_orders.js:194,
method; orders only); `info.customerId` is read by the sold card, the pay and deposit screens, the receipt and the
server's OVERPAID flag.

### 2.2 `openCredits` (core_ledger.js:1219-1270), the Credits view, `CREDIT_COLS`, `creditOverdue`, DueDay

- Sums: the pre-pass sums SALE `amount`/`cash` per group, PAYMENT per `refGroupId`, DEPOSIT_APPLIED per group
  (:1229-1239), then `saleGroupInfo` for the groups that owe (:1251). One entry per group: **works** (one entry in
  Credits, as B1 wants), `owed`, `total`, `cash`, `payments`, `applied`, `qty` are group sums.
- Item name: `item ? item.name : …` from `info.itemId` (:1253-1255): **first row**. The "N ကြောင်း · …" prefix
  (hard-coded, not an MSG key) applies only when there is NO Items row AND the group id is a voucher id (:1256), so a
  basket of tags shows its first item's name only; so does a delivery whose first line is a stocked tag (an existing
  gap of the precedent).
- `itemId` column: first item's id.
- `dueDay`, `overdue`, `daysOver` (:1264-1265): from `info.dueDay`, so **depends** on DueDay being on row 1.
- `creditOverdue(dueDay, days, today)` (:1214-1216): pure, **works**.
- The Sheet's Credits tab (`gasStore.refreshViews`, gas_store.js:710-716) writes `c.itemId`, `c.item` and the 15
  `CREDIT_COLS` (core_config.js:169): follows `openCredits`; no column change is needed for a basket.
- The Dashboard's `Still owed` / `Overdue` cells sum the Credits tab (`owed(shop)` gas_setup.js:423, the `Overdue` SUMIF :452-453):
  **works**.

### 2.3 `buildReceipt` / `receiptText` / `receiptReport` (the PDF) (core_report.js:331-409) - works

One line per live SALE row (:336, :341-343: `itemLabel`, qty, unitPrice, amount), so a basket prints one line per
item with `receipt_line '{name} × {qty} · {amount}'` (core_messages.js:121); a voided basket lists every row the undo
reversed (`voidedRows`). `total` = sum of the printed rows (:339); `paid`/`owed` from the group (:349); methods from
`groupMethods` (:350) → `receiptMethodText` (:366-371) prints ' (ငွေသား 8,000 · KBZPay 10,000)' over the whole basket.
First-row parts: `customer` from the first printed row (`origin.customerId || info.customerId`, :340: needs the buyer
on row 1), `dueDay` (:356, row 1), the number (`receiptNumber`, 2.11). The PDF (`receiptReport`, :393-409) maps the
same `r.lines` into rows; `gas_pdf.js:20` prints any number of rows. The server's `api=report kind=receipt`
(core_sync.js:1290-1293) calls the same two functions. This is the reference reader: **works** with no change.

### 2.4 `undoGroup` and `voidGroup` (core_ledger.js:992-1022) - works; the reply shows the first item

Mirrors EVERY live row of the group (:1004-1013: SALE rows, the PAYMENT, a DEPOSIT_APPLIED), each mirror carrying its
own `itemId` and `-qty`, so every line's stock comes back and owed nets to 0. The 30-min window is measured from
`rows[0].time` (:999; all rows share the time). Returns `itemId: rows[0].itemId` (:1016): the bot's `U|g` reply is
`undo_done '↩️ ပြန်ဖျက်ပြီးပါပြီ'` (core_messages.js:57) + `cardText` of that ONE item (core_bot.js:549-550); `V|g`
the same with `void_done '🚫 ဆိုင်ရှင် ပယ်ဖျက်ပြီးပါပြီ'` (:558-559). The undo itself **works**; the reply is
**first row** (the other items' cards and stocks are not shown). There is no per-line undo: an undo or void is always
the whole basket.

### 2.5 `rewriteCheck` (core_ledger.js:1029-1044) - works (refuses, by design)

`g.live.length !== 1 → 'complex'` (:1034). A basket has N live SALE rows, so every corrective path refuses it:
`rewriteGroup`, `splitSale`, `convertSaleToCredit`, the 👤/💳/🏦/💵+🏦/➕ rows of the non-plain `afterSaleKeyboard`
(core_bot.js:289-296), `moneyKeyboard` (:346), the note (:2044). That is D3's intent (no corrective buttons on a
guided sale; the spec already relies on `complex` for the mixed one-item sale, SPEC 2.2). One wording point: the voice
"Wave နဲ့ ပေးသွားတယ်" (`I.METHOD`, core_bot.js:979-987) on a basket answers `rewriteRefusal('complex')` =
`rewrite_locked 'ℹ️ ဒီအရောင်းမှာ ငွေလက်ခံ/စရံ ပါပြီးလို့ ပြင်လို့ မရတော့ပါ။'` (core_messages.js:138, core_bot.js:388),
whose reason (a payment or deposit is attached) is untrue for a plain cash basket; the mixed one-item guided sale
already gets the same wording.

### 2.6 `groupMethods` (core_ledger.js:1189-1201) - works

Sums `cash` per `methodOf(row)` over the live SALE rows of the group and the live PAYMENT rows that reference it,
skipping rows with no cash (:1191-1199). Any per-row split gives the same per-method totals as long as each row's
Method says how ITS cash moved. Readers: the receipt, the sold card (:3205-3212), the item card's buyer line (:197).

### 2.7 `dayStats` / `monthStats` / `buildDailySummary` (core_ledger.js:1534-1682)

`statsWhere` (:1534-1600) is a per-row sum: revenue, pieces, COGS (`costAtSale` per row), cash in/out and
`byMethod` per row method. A basket is N rows of the same day and shop: **works** for every figure. `s.sales` counts
SALE rows (:1559), so a basket counts N; it is read only as an emptiness test (:1623) and never printed. `s.payments`
would include the transfer PAYMENT (as it already does for a mixed one-item sale); never printed either.
`buildDailySummary` (:1617-1682): shop lines from `dayStats` (works); the overdue lines from `openCredits` (customer,
owed, `c.dueDay`, `c.daysOver`, :1653-1666): **depends** on DueDay on row 1. `answerToday` (`today_query`,
core_bot.js:1051-1061) and the monthly per-day table (core_report.js:205-219): row sums, **works**.

### 2.8 The three credit reports (core_report.js:227-230, :280-282, :311-320)

Month report "အကြွေး ကျန်", customer statement "အကြွေး ကျန်", owed report: each row is one `openCredits` entry
(`c.customer`, `c.item`, `c.total`, `c.cash + c.payments + c.applied`, `c.owed`, `c.days`, `creditDueCell(c)`
:17-20). Sums **work**; the `ပစ္စည်း` cell is **first row** (via `c.item`); the due cell **depends** on DueDay on
row 1. They follow `openCredits` automatically.

### 2.9 `customerSummary` / `customerHistory` / the customer card

- `customerSummaryMap` (core_ledger.js:1347-1367): per row, and only rows that carry the customer (:1350): `bought +=
  amount`, `paid += cash` (:1353), PAYMENT and DEPOSIT_APPLIED add to paid. **Depends**: a basket row without
  `customerId` silently drops out of bought/paid (owed stays right only if the dropped row's amount = its cash). With
  the buyer on every row (B1): **works**. Visits count days (one per basket).
- `customerHistory` (:1384-1389): the last n live rows of the customer, newest first; the card shows
  `CFG.CUST_HISTORY_LINES` = 8 (core_config.js:129). A basket is N lines of the 8.
- `customerLine` (core_bot.js:1672-1678): one line per ROW, `cust_line '{day} · {desc} · {amount}{paid}{method}'`
  with `cust_line_paid ' · ပေး {paid}'` whenever the row's cash ≠ its amount (:1675) and the row's own method
  (core_messages.js:153-154). **This reader shows the per-row allocation** (section 3). Verdict: works (each item
  visible), but not "one sale with N lines" as B6 asks.
- The customer card (`customerCard`, core_bot.js:1681-1702): head `cust_card` from `customerSummary` (works); the 💰
  button goes to `PY|<g>` when the customer has one open credit, else `PL|<custId>` (:1692-1695): group-level,
  **works**.
- The statement PDF (`customerReport`, core_report.js:265-290): "စာရင်း" lists each live row with `r.amount`,
  `r.cash`, method (:275; allocation visible, fine for a statement); "အကြွေး ကျန်" via `openCredits` (2.8).

### 2.10 The item card's buyer line (`card_buyer`, core_bot.js:185-207) and `lastLiveSale` (core_ledger.js:1204-1208)

Only on a sold-out UNIQUE card (:189-191). `lastLiveSale(item)` returns the live SALE row of THIS item (works for a
basket line). Then `saleGroupInfo(sale.groupId)` and `groupMethods(sale.groupId)` (:195-197), and the line
`card_buyer '👤 {customer} · ပေးပြီး {paid} · {method}'` (core_messages.js:156) prints `paid = info.cash +
info.payments + info.applied` (core_bot.js:203): **the whole basket's money under one piece**, and the basket's
methods. Verdict: **breaks** (the paid figure is overstated for that piece; a seller reading "ပေးပြီး 54,000" on a
25,000 piece). The customer name comes from the row itself (`sale.customerId`, :194), so it needs the buyer on every
row. SKU lines never show a buyer line.

### 2.11 `receiptNumber` (core_ledger.js:1729-1752) and the app's per-device ReceiptNo

- Telegram rows: no `receiptNo`; the number is derived by counting SALE GROUPS per shop (`seen[r.groupId]`,
  :1734, :1747): a basket is one group, one number. **works**.
- A phone (and the old phone simulator): `appendLedger` stamps a NEW number on EVERY SALE row that is not a mirror
  and has none (app/app_store.js:294-299; poc/sim_phone.js:121-126), incrementing `receiptCounter`. A 3-line basket
  burns three numbers (R1-A-000231, 232, 233). `receiptNumber` returns the receiptNo of the group's FIRST SALE row in
  ledger order (:1736), so the receipt prints 231, and 232/233 are never printed: gaps in the "gap-free per phone"
  series (the comment at app_store.js:295). Verdict: **breaks** (numbers wasted, the paper series gets holes; no wrong
  receipt). The receipt lookup of the app (`appReceiptGroupFor`, app/app_ui.js:757-764) finds the group by any row's
  number: works. `backfillSync` (gas_sync.js:460-467) marks a group seen only at a row WITHOUT ReceiptNo, so a re-run
  would write the first row's number onto a basket's blank rows 2..N (harmless: the same number).
- The PAYMENT row of a mixed group never carries a number (run_app.js:967 pins this for the one-item mixed sale).

### 2.12 `lastLiveSale`, recents and the stock view - works

- Stock is derived per item from every ledger row: `stockOf` (poc/sim_ports.js:27-31), `addStock` per row
  (app/app_store.js:241-244, poc/sim_phone.js:86-89), the Items tab's Stock formula (gas_setup.js:359). Each basket
  row moves its own item: **works**. `stockReport` (core_report.js:292-309) and `lowStockList` (core_ledger.js:1610)
  read `item.stock`: **works**.
- `recentItems` (core_ledger.js:1708-1724) walks rows: every basket item becomes recent (useful for B3's "pick from
  recent items"). `recentCustomers` (:1398-1413): works.

### 2.13 The sold card: `saleCardText` / `saleCardKeyboard` / `saleSoldCard` (core_bot.js:3194-3224, :2383-2387)

- `saleCardText`: `cardText` of `info.itemId` only (:3197-3198), then `sold_done '✅ ရောင်းပြီး {qty} ထည် · {amount}
  ကျပ် · လက်ကျန် {stock}'` (core_messages.js:52) with `qty` = pieces over all items, `amount` = basket total and
  `stock` of the FIRST item (:3199). Verdict: **first row** (reads as "3 pieces of item 1, stock of item 1").
  `credit_done` / `cust_attached` (:3200-3204), the split/method line (:3205-3212) and `sale_due_set` (:3214) are
  group-level and right (DueDay **depends**).
- `saleCardKeyboard` → `afterSaleKeyboard(..., {plain: true})` (:283-288): undo, receipt, 💰 while owed: **works**.
- `saleSoldCard`: a message is a sold card when it shows `sold_done` up to its first `{` ('✅ ရောင်းပြီး') or was
  committed within 600 s (:2383-2387). A basket sold card must keep that prefix (or the test must learn the new
  key's), or a late tap could edit it into `expired`.
- The deposit question (S+) and `creditDeposit(..., plain)` (:1791-1807) rebuild from `saleCardText` and use
  `applyDeposit`'s group owed: follow the above.
- Telegram limit (not a ledger reader, a risk for the card): the flow and the sold card live on the first item's PHOTO
  message (`isCaption`), and a caption is limited by Telegram to 1024 characters; `editMessageCaption` failing falls
  back to a NEW text message (gas_telegram.js:52-60), leaving the old photo screen with its buttons. A 10-line basket
  header or sold card must be kept short (B4 already says "short when long").

### 2.14 The other group consumers in core_bot.js - works

`afterSaleKeyboard` (owed > 0 → 💰, :286), `replyKeyboard` (live[0] is a SALE → `afterSaleKeyboard`, :354-357),
`payPick` / `payAmount` / `commitPaymentAndReply` (:1827-1860, group owed, `pay_ask_amount`, `pay_done`),
`showPayList` / `creditButtons` (:1813-1825: customer, owed, day), voice `I.PAYMENT` (:964-972), `describeProposal`
PAYMENT (:1090-1093): all group-level. `commitPayment` (core_ledger.js:910-925) caps at the group's owed and copies
`info.itemId` (the first item) onto the new PAYMENT; `applyDeposit` (:945-962) the same on DEPOSIT_APPLIED: those
later rows read "ငွေလက်ခံ <first item>" on the customer card and in the day report (`itemLabel`, core_report.js:67-78);
the delivery does the same (`txs[0].itemId`, core_orders.js:277, :289). `describeProposal` METHOD reads
`live[0]` (:1101) but is only reached when `rewriteCheck` passed, never for a basket.

### 2.15 The sync server: group validation and flags (core_sync.js)

- `syncValidateBatch` (:399-445), group entry (:409-421): 1..`SYNC.PUSH_MAX_ROWS` (200, :43) rows; every row valid
  (`syncValidateTx`, :372-397, includes the dueDay rule :390), same staff, item exists, same `groupId` (:420);
  `syncGroupInScope` (:361-370): for a staff phone every row must be in the phone's shop unless it has a
  `refGroupId` (:365-366). A basket of ≤ 10 lines + 1 PAYMENT passes. An item of the OTHER shop in a basket would
  quarantine the WHOLE group as `scope` (its SALE row has no refGroupId): B3's refusal is required, not cosmetic.
  `syncPlanPush` sends a group whole, even a lone big one (:1371). **works**.
- `stock_negative` (:807-809): per row, against the shadow stock of THAT row's item, updated row by row (:827):
  each basket line is checked on its own (**works**). The flag carries the group id and the ping's only button is
  `V|<group>` (:634-637), and `ping_stock_negative '… · တစ်ခုကို ပယ်ဖျက်ပါ'` (core_messages.js:126): voiding it
  reverses the WHOLE basket, not the oversold line.
- `overpaid` (:811-815): a PAYMENT row with `refGroupId` is compared with `saleGroupInfo(shadow, refGroupId).owed`,
  where the shadow holds only the rows already applied in push order (`rows.push(row)`, :823). **Depends on row
  order**: with the PAYMENT after ALL SALE rows the owed is the basket's (total - cash part ≥ bank part, no flag);
  a PAYMENT placed after the first SALE row only would see `owed = amount1 - cash1` and raise a false
  `ping_overpaid '⚠️ 👤 {customer} · ကျန်ငွေ {owed} ကျပ် ထက် {amount} ကျပ် ပိုလက်ခံထားပါသည် · စစ်ပါ'` (:127) with a void
  button. `writeGroup` keeps array order everywhere (core_ledger.js:67-75, app collector app/app_store.js:657-662).
- `deposit_over` (:816-819): unchanged. The view refresh once per batch (:856-859): works.

### 2.16 The app store and the pending lines (app/)

- `appendLedger` (app/app_store.js:294-310) + the lock collector (app/app_ports.js:166-172, app_store.js:657-662):
  every row written inside one `lock.run` becomes ONE outbox `group` entry: a basket syncs as one entry, atomically.
  **works**, except the receipt stamping of 2.11 (**breaks**).
- `sync.pendingLines` (app/app_sync.js:496-503): one line per group entry, `describeRow` of the FIRST live row
  (:501-502; `describeRow`, core_report.js:91-99: 'ရောင်း ၁ ထည် · <item 1> · 👤 … · <amount of line 1> ကျပ်').
  **first row**: the sync screen under-reports a basket (one item, one line's amount). run_app.js:248-249 checks the
  one-item wording only.
- The app shows the latest bot message; its photo is found from the FIRST tag id in the text (`appItemIdFromText`,
  app/app_ui.js:96, used at :615-617): a basket sold card shows the first item's photo (cosmetic).

### 2.17 The simulator's Ledger and Credits tables (poc/sim_ui.js)

- Ledger (`ledgerTable`, :707-724): one table row per ledger row with Time, Shop, ItemID, Type, Qty, Amount, Cash,
  Method, Customer, DueDay, Source, Route, Note; there is NO GroupID column, so a basket reads as N unrelated rows
  with the same time and buyer. Data **works**; B10's "the Ledger view showing the basket group" needs a marker.
- Credits (`creditsTable`, :866-878): one row per `openCredits` entry, `td(c.item)` (:870): follows 2.2
  (**first row** until `openCredits` changes). Dashboard (`dashboard`, :883+) sums `dayStats`/`openCredits`: works.
  The smoke step reads `openCredits` by customer (sim_ui.js:1353) and the tours' `creditOf` likewise
  (poc/sim_tours.js:72-76): works.

### 2.18 Day report and the Sheet - works

`dayReport` (core_report.js:169-198): one printed row per ledger row (`printableRows`), with its amount, `ငွေလက်ခံ`
= the row's cash, its method and note (:173-178); totals from `dayStats` (:185). A basket prints N lines at one time
(allocation visible, totals right). The Sheet's Ledger tab is the raw rows; the Dashboard formulas are SUMIFS over
rows (gas_setup.js:398-430): works for any allocation.

---

## 3. The write rules every reader needs, and the allocation rule

### 3.1 Which readers sum the group, which read a row

| Reader | Sums the group | Reads the FIRST live SALE row | Reads EACH row |
|---|---|---|---|
| `saleGroupInfo` | total, cash, qty, applied, payments, owed | itemId, unitPrice, method, customerId, dueDay, shop, day, time | - |
| `openCredits` (+ Credits tab, sim Credits, 3 credit reports) | amount, cash, payments, applied, owed | item name, itemId, customer, dueDay | - |
| `buildReceipt` / `receiptText` / `receiptReport` | total, paid, owed, methods | number, customer, dueDay | the item lines |
| `groupMethods` | cash per method (SALE + PAYMENT) | - | each row's method decides its bucket |
| `undoGroup` / `voidGroup` | - | the reply's itemId, the time window | mirrors every row |
| `dayStats` / `monthStats` / Sheet Dashboard / `answerToday` | per shop and day | - | amount, qty, cash, method, cost of each row |
| `customerSummaryMap` | per customer | - | each row (needs customerId on it) |
| `customerHistory` / `customerLine` / statement "စာရင်း" / `dayReport` | - | - | amount, cash ("ပေး"), method of each row |
| `card_buyer` | paid and methods of the whole group | - | the item's own row (to find the group, the buyer) |
| `saleCardText` | total, qty, paid, owed | item card, stock | - |
| `receiptNumber` | Telegram: counts groups | the first SALE row's receiptNo | - |
| app `appendLedger` | - | - | stamps every SALE row (the bug) |
| app `pendingLines` | - | `describeRow` of it | - |
| server `overpaid` | owed on the shadow | - | evaluated per PAYMENT row, in push order |
| server `stock_negative` | - | - | each row against its item |
| `commitPayment` / `applyDeposit` | the owed cap | copies its itemId | - |

Only the rows' CASH split is visible to readers that read each row (customer card lines, statement, day report, the
Ledger tab and the simulator's Ledger); every money total sums.

### 3.2 The allocation rule for a part payment (recommended): fill in line order

The at-sale cash to put on SALE rows is `A = twoRows ? cashPart : paid` (the same quantities `commitSaleGroup`
computes, core_ledger.js:829-835). Walk the basket lines in their order (the receipt order, the ledger order):
`rowCash_i = min(amount_i, A - Σ rowCash_<i)`. Each row's method: `twoRows ? (rowCash_i ? CASH : '') :
methodFor(payKey, rowCash_i)`. The transfer part (mixed, both parts > 0) is ONE PAYMENT row for `bankPart`, method
KEY, `refGroupId = group`, after all SALE rows (B5, "as today").

Why every reader agrees with it:

- every row keeps `0 <= Cash <= Amount`, the invariant all writers keep (:806, :829, :1058), so no row ever reads as
  overpaid on its own;
- `Σ rowCash = A` exactly, whole numbers, no rounding remainder to place;
- a full payment gives `rowCash_i = amount_i` on every row: per-row readers see N fully paid lines, exactly as N
  one-item sales today (no "ပေး" on the customer card);
- a part payment reads naturally on the per-row readers: the first lines fully paid, one line `ပေး X`, the rest
  `ပေး 0`; zero-cash rows store method `''`, which `groupMethods` (:1191) and `addMethodCash` (:1502-1504) skip, as a
  pure credit row does today;
- `saleGroupInfo.method` (`methodOf(first)`) is the paying method whenever anything was paid, `''` when nothing was,
  as for a one-item credit today;
- group readers (owed, receipt totals, Credits, the summary, OVERPAID) are indifferent to the split.

Rejected: proportional shares (every line shows an odd `ပေး 6,667` and needs a remainder rule); the delivery shape
(`Cash 0` on every SALE row + one PAYMENT for all money, core_orders.js:270, :289) - the group readers accept it, but
every basket, even fully paid in cash, would show `ပေး 0` lines plus a separate "ငွေလက်ခံ" line on the customer card and
in the day report, it differs from the round-5 one-item shape (the SALE row carries the cash, SPEC 2.2) and from B5.

### 3.3 The other write rules (the "depends" verdicts above)

1. **DueDay on EVERY SALE row of a group that owes after the write**, the same date; `''` on the PAYMENT (SPEC 2.1,
   10). The condition stays group-level, as `commitSaleGroup` computes it today (:837). NOT "on every owing row": under
   fill-in-order the FIRST row is the one most likely to be fully paid, `saleGroupInfo` reads the first row
   (:1166, :1170), and the credit would lose its date everywhere (Credits DueDay blank, `creditOverdue` falls back to
   the 30-day rule, no `sale_due_set` on the receipt and the sold card, no `summary_due_overdue` line). Optional
   hardening: `saleGroupInfo` takes the first non-blank `dueDay` among the live rows (one line), so a row order
   surprise cannot drop a date.
2. **The buyer on every SALE row and on the PAYMENT** (B1; `customerSummaryMap` skips rows without it, :1350;
   `customerHistory`, `card_buyer` (:194) and the receipt (:340) read it per row; the delivery precedent does it,
   core_orders.js:264).
3. **Row order: all SALE rows in line order, then the PAYMENT** (the server's OVERPAID check, core_sync.js:811-815,
   :823; `receiptNumber` and `saleGroupInfo` take the first SALE row).
4. **One receipt number per basket**: a phone stamps only the first SALE row of a group, or copies that same number
   onto the group's later SALE rows (app/app_store.js:296-298 and poc/sim_phone.js:123-125 inside one collector run;
   copying matches what `backfillSync` would write anyway, gas_sync.js:460-467).
5. **One row per distinct item.** Adding a SKU that is already in the basket changes that line's count instead of
   adding a second row (B3 already forbids a UNIQUE twice). Then `lastLiveSale`, `card_buyer`, the receipt lines and
   the stock flags never meet two rows of one item in one group.
6. **Note:** the group-level note on every SALE row (`'split'` when there is a PAYMENT, else `'credit'` while owed),
   `'price'` on a line whose price was changed and nothing else applies, the PAYMENT `'split'` (core_ledger.js:836,
   :849). `dayReport` prints it per row (core_report.js:176).
7. **A one-line basket is today's write, byte for byte** (`commitSaleGroup`'s rows), so `info.rows.length > 1` is a
   safe "basket" test for every reader change below and the round-5 checks stay green.

---

## 4. Reader → change needed for a basket

| Reader (file:line) | Today on a basket | Change needed |
|---|---|---|
| `saleGroupInfo` (core_ledger.js:1152-1176) | sums right; itemId/dueDay/customer from row 1 | none if 3.3 rules 1-2 hold; optional: dueDay = first non-blank among live rows; optional `lines` = `rows.length` for callers |
| `openCredits` item name (core_ledger.js:1253-1256) | first item's name | when `info.rows.length > 1` and not an order: a basket name, NEW `basket_name '🛍 {n} ခု · {names}'` (names: the item names joined by ', ', cut short); fix the same for a delivery whose first line is a tag (optional) |
| Credits tab / `CREDIT_COLS` (gas_store.js:710-716, core_config.js:169) | ItemID/Item of row 1 | none beyond `openCredits` (Item follows; ItemID stays the first item's id); no new column |
| `creditOverdue` (core_ledger.js:1214) | right | none |
| DueDay readers (openCredits :1264, receipt :356, sold card :3214, summary :1653-1666, credit reports) | right only if row 1 carries it | none, given 3.3 rule 1 |
| `buildReceipt` / `receiptText` / `receiptReport` (core_report.js:331-409) | one line per item, totals right | none (customer and dueDay need rules 1-2) |
| `undoGroup` / `voidGroup` (core_ledger.js:992-1022) | mirrors everything | none in the ledger |
| `U|g` / `V|g` replies (core_bot.js:541-560) | `undo_done` + the FIRST item's card | for a basket: `undo_done` + the basket line (NEW `basket_line '🛍 {n} ခု · {amount}'`, B6's "🛍 ၃ ခု · 54,000") and each item's id · name · stock, or no card |
| `rewriteCheck` (core_ledger.js:1034) | `complex`: every corrective refused | none (D3); optional basket wording instead of `rewrite_locked` for the voice method path (core_bot.js:983-985) |
| `groupMethods` (core_ledger.js:1189) | right | none |
| `receiptNumber` (core_ledger.js:1729) | Telegram right; phone: row 1's number | none in the core |
| app `appendLedger` (app/app_store.js:294-299) and its twin `poc/sim_phone.js:121-126` | a number burnt per SALE row | stamp once per group (or copy the first row's number onto the group's later SALE rows); the spec names whether run_app.js / run_sync.js gain checks |
| `dayStats` / `monthStats` / `buildDailySummary` (core_ledger.js:1534-1682) | right (`sales` counts rows, unused) | none |
| three credit reports (core_report.js:229, :281, :315) | item = row 1 | none beyond `openCredits` |
| `customerSummary` (core_ledger.js:1347-1382) | right with the buyer on every row | none, given rule 2 |
| `customerHistory` / `customerLine` / customer card (core_ledger.js:1384, core_bot.js:1672-1695) | N lines of the 8, each with its own `ပေး` | B6: collapse a basket's SALE rows into ONE `cust_line` with `desc` = 'ရောင်း 🛍 {n} ခု' (txLabel + the NEW `🛍 {n} ခု` fragment), amount = basket total, `ပေး` = the basket's at-sale cash, method from its rows; the PAYMENT keeps its own line |
| statement PDF `customerReport` (core_report.js:265-290) | one row per item, credits via openCredits | none (a statement lists items); optional |
| `card_buyer` (core_bot.js:185-207) | the whole basket's paid under one piece | for `info.rows.length > 1`: NEW `card_buyer_basket '👤 {customer} · 🛍 {n} ခု · ပေးပြီး {paid} · {method}'` (the basket's figures, said to be the basket's) |
| `lastLiveSale` (core_ledger.js:1204) | right | none (rule 5) |
| stock view (`stockReport`, `lowStockList`, item.stock everywhere) | right | none |
| sold card `saleCardText` (core_bot.js:3194-3218) | item 1's card, qty summed, stock of item 1 | a basket card: `basket_line` (NEW) + one line per item (the `receipt_line` shape '{name} × {qty} · {amount}' plus the item's stock) + the group lines as today; keep the '✅ ရောင်းပြီး' prefix for `saleSoldCard` (core_bot.js:2385) or teach it the new key; keep it under Telegram's 1024-character caption limit |
| `saleCardKeyboard` / `afterSaleKeyboard` plain (core_bot.js:3220, :283) | right | none |
| `creditDeposit` plain / S+ (core_bot.js:1791-1807), `applyDeposit` | right (group owed) | none (text follows `saleCardText`) |
| pay flows (`payPick`, `showPayList`, `creditButtons`, `commitPayment`) | right | none (the later PAYMENT's itemId = item 1, as for a delivery) |
| server validation (core_sync.js:399-445, :361-370) | accepts; another shop's line quarantines the whole basket | none (B3 refuses other-shop items) |
| server `stock_negative` (core_sync.js:807-809) | per line, right; its void undoes the whole basket | none required; the spec may note the coarse void |
| server `overpaid` (core_sync.js:811-815) | right if the PAYMENT is last | none, given rule 3 |
| app outbox grouping (app/app_ports.js:166-172) | one entry per basket | none |
| app `pendingLines` (app/app_sync.js:496-503) | the first item and the first line's amount | for a group with more than one SALE row: one basket line, e.g. 'ရောင်း 🛍 {n} ခု · 👤 {customer} · {total} ကျပ်' (NEW wording, through a core helper such as a `describeGroup` beside `describeRow`) |
| app photo of the card (app/app_ui.js:96, :615) | the first item's photo | none (cosmetic) |
| simulator Ledger (poc/sim_ui.js:707-724) | N unrelated-looking rows | a group marker per row (a 'Group' column, or '🛍 1/3' in the Note cell; page copy, not MSG) |
| simulator Credits (poc/sim_ui.js:866-878) | item = row 1 | none beyond `openCredits` |
| `dayReport` (core_report.js:169-198), Sheet Ledger tab and Dashboard (gas_setup.js:398-430) | right, one line per item | none |
| `deliverOrder` (core_orders.js:257-302) | the precedent | none; it is NOT a precedent for cash on several SALE rows, DueDay, or a phone-written group |

New labels proposed above (all NEW, drafts for the spec; the `{n} ခု` count is MSG's own, `ord_list_title`
core_messages.js:289, and 🛍 is the `cust_card` glyph for bought, :152):

- `basket_line` '🛍 {n} ခု · {amount}' (B6's example "🛍 ၃ ခု · 54,000")
- `basket_name` '🛍 {n} ခု · {names}' (Credits item, credit reports)
- `card_buyer_basket` '👤 {customer} · 🛍 {n} ခု · ပေးပြီး {paid} · {method}'
- the pending-line wording 'ရောင်း 🛍 {n} ခု · 👤 {customer} · {total} ကျပ်'

Existing checks that pin readers a basket change touches (for D9's list): run_app.js:248-249 (`pendingLines`, one
item), run_app.js:115, :218, :967, :1055 (receipt numbers on a phone), run_wizard.js:468 (`complex` and the mixed
receipt text). None of them builds a multi-SALE-row group, so the changes above can keep them green if a one-line
basket stays today's shape (3.3 rule 7).
