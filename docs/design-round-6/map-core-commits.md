# Map: the core write API a seller form calls (round 6)

Date 2026-11-12. Mapper's report for `docs/design-round-6/BRIEF.md` (R1-R9). Tree: the current one (rounds 4 and 5
built, not published); line numbers as of today. Scope: `apps-script/core_ledger.js` and `core_bot.js`, plus the
helpers they lean on (`core_burmese.js`, `core_config.js`), the two store ports (`apps-script/gas_store.js`,
`app/app_store.js`) and the app bridge (`app/app_ports.js`). No code or test was changed.

The readers of a group with several SALE rows are not repeated here. `docs/design-round-5/map-basket-readers.md`
(called "the basket map" below) is still the reference for them, for the allocation rule (its 3.2: fill in line order)
and for the write rules a basket must keep (its 3.3, rules 1-7).

**Verdict words used in section 7:** **REUSE** (works for a review card as it is), **ADAPT** (the body is right,
but its exit, its back row or its key changes), **DEAD** (exists only because the sale was one question per screen).

---

## 0. Short answer

1. **Every commit function writes for ONE item, or for none.** `writeGroup` (core_ledger.js:67-75) is the only
   N-row writer. Only two commit functions write more than one row: `commitSaleGroup` (SALE then PAYMENT) and
   `commitTransfer` (OUT then IN). The one precedent for N SALE rows in a group is `deliverOrder`
   (core_orders.js:257-302, basket map section 1). None of the commit functions takes a list of lines.
2. **`commitSaleGroup` is the right base for a basket.** It already writes the round-5 shapes (the seven outcomes,
   section 2.1). A basket version must follow the same rules, applied per line with the cash allocated in line order.
   A one-line basket must write exactly today's rows, byte for byte. Then `commitSaleGroup` becomes a wrapper and
   the seven-outcome checks (poc/run_wizard.js:520-549) stay green.
3. **Validation lives in the Telegram handlers, not in the commit functions.** The commits clamp but never refuse.
   A count of 0 becomes 1. A price of 0 is written. A UNIQUE piece already sold is written again. An item of the other
   shop is written. `commitExpense` writes 0. `commitReturn` accepts a refund bigger than the return. `commitPayment`
   is uncapped when nothing is owed. All of the refusals are in core_bot.js (sections 2.1-2.9 list them). An app form
   that calls the commits directly (R1) must get the same rules from new pure helpers (section 8). Otherwise each
   form re-implements them.
4. **No core function creates an item.** The photo flow does it inline, in `newItemCost` (core_bot.js:2172-2195), and
   it is tied to the Telegram state. It always writes `type: UNIQUE` (:2184) and one RESTOCK of 1 (:2187). Two more
   inline creators exist: `attachTagToItem` (:4127-4145, custom orders) and `importProducts` (core_ledger.js:1783-1818).
   `importProducts` is the only writer of `type: SKU` with an opening stock above 1, so it is the precedent for a
   counted new piece.
5. **The app has never called a commit function directly.** Every write on the phone today goes through
   `processUpdate` inside `phone.deliver` (app/app_ports.js:217-238), and `deliver` then runs `store.commit()`. A
   form that calls `commitSaleGroup` and the others must make the write durable itself: write, then `phone.commit`,
   then `sync.scheduleSync`. The measurement form already does exactly this (`appMeasSave` + `appMeasCommit`,
   app/app_ui.js:244-259).
6. **Three traps a basket walks into.**
   (a) `newTx` reads the clock per row (`f.when instanceof Date ? f.when : ports.clock.now()`, core_ledger.js:32).
   `saleCommit` passes no `when` (core_bot.js:3168-3172). A basket written at 23:59:59 can therefore put its rows
   on two different Days. Fix: take the clock once per write.
   (b) A line with no price: `unitPrice` falls back to `Number(item.price) || 0` (:827). A pending-price piece sold
   without a typed price makes a group with total 0, and `saleGroupInfo` reads that as `voided: total <= 0`
   (:1171): an undone sale.
   (c) The phone uses up one receipt number per SALE row (app/app_store.js:294-299; basket map 2.11).
7. **Rounds 4 and 5 never shipped** (BRIEF, line 3). No real chat holds a round-5 `SS|`/`SC|` button. The guided
   sale's callback prefixes can be reused or retired with no compatibility path.
8. **The guided sale is about 940 lines** (core_bot.js:2287-3224). Roughly two thirds of it can serve a review card
   as its edit sub-screens: the screens, the answer handlers, the stale-tap guard and the sold card. The step
   machine dies: `hist`, `saleGo`'s push, `saleNext`, `saleBack` with `SALE_BACK_CLEARS`, the summary step, and the
   commit button on the how-much-now screen. One catch: `SS` and `SC` are in `ITEM_ACTIONS` (:431). Slot 1 of their
   callback must therefore be an existing item id, or the dispatcher answers `tag_not_found` before the handler runs
   (:452-454).

---

## 1. Shared plumbing

### 1.1 `newTx(ports, f)` (core_ledger.js:31-64)

- It builds the 27-field row. `groupId` defaults to the row's own `txId` (:62). `time`/`day` come from
  `f.when`, else from `ports.clock.now()` read once per call (:32). `day` is `dayKey(when)` in Yangon time
  (core_burmese.js:30-34).
- Coercions: `qty`, `amount` and `cash` become `Number(...) || 0`. `unitPrice`/`costAtSale` become `''` when nullish.
  `method`, `category`, `dueDay`, `receiptNo`, `seq`, `deviceId` and `receivedAt` default to `''`.
- It validates nothing. The server is the backstop: `syncValidateTx` (core_sync.js:376-392) wants whole-number
  qty/amount/cash, a `dueDay` that is blank or `yyyy-mm-dd`, and an `itemId` on SALE/RESTOCK/RETURN/TRANSFER rows.
  `SYNC.PUSH_MAX_ROWS` 200 rows per group entry (core_sync.js:43, :410). A basket needs a line cap well below that.

### 1.2 `writeGroup(ports, txs)` (core_ledger.js:67-75)

- It forces `txs[0].groupId` onto every row (:69). Then it appends every row, in array order, inside ONE
  `ports.lock.run`, and calls `afterWrite` after the lock (:73). It returns `{groupId, txs}`. It takes any number of
  rows.
- Telegram/GAS: `lock.run` is `gasLocked(fn, 15000)` (gas_main.js:156, :67-73). `appendLedger` does one `appendRow`
  plus `flush` per row and stamps `Seq` per row (gas_store.js:391-410). An N-line basket costs N sheet appends under
  one lock.
- App: `lock.run` opens a collector, so the rows appended inside it become ONE outbox `group` entry
  (app/app_ports.js:166-171, app/app_store.js:657-663). `appendLedger` updates the stock map. It also stamps a
  `receiptNo` on every SALE row that is not a mirror and has none yet (app/app_store.js:294-299): trap 6c.

### 1.3 `afterWrite(ports, txs)` (core_ledger.js:83-93)

It refreshes the Credits/Deposits/Customers views only when the store has `refreshViews`. GAS has it. The app store
does not, so on a phone this does nothing. It runs when a row has a customer, is a PAYMENT/DEPOSIT/DEPOSIT_APPLIED,
is a SALE/RETURN whose cash differs from its amount, or is a mirror.

### 1.4 Which ports each write needs

| Function | store methods | other ports |
|---|---|---|
| `newTx` | none | `clock.now`, `uuid` |
| `writeGroup` | `appendLedger` | `lock.run` |
| `afterWrite` (GAS only) | `refreshViews`, plus what `openCredits`/`depositsHeldList`/`customerSummaries` read: `ledgerRows`, `getItem`, `getCustomer`, `listCustomers` | `clock.now` |
| `commitSale`, `commitSaleGroup`, `commitRestock`, `commitReturn`, `commitExpense`, `commitDeposit` | `writeGroup`'s only | |
| `commitTransfer` | plus `updateItem` (the shop, after the lock, :906) | |
| `commitPayment`, `applyDeposit` | plus `ledgerRows` (`saleGroupInfo`, `depositsFree`/`depositsAvailable`) | |
| `undoGroup` | `ledgerRows`, `appendLedger`, `updateItem` (a transfer's shop back, :1015-1016) | `clock.now` |
| `receiptNumber` | `ledgerRows` | |
| `addCustomer` (a store method) | itself (GAS: under its own `gasLocked`, gas_store.js:451-464) | |
| option lists | `listOptions` (optional), `getSetting`, `getMessage` (via `t`), `addListOption`, `logError` | `cache` (`listWarnOnce`) |
| item creation (photo) | `updateItem`, `getItem`, plus `writeGroup`'s; `listStaff` for `notifyOwners` | `chat.savePhoto`, `chat.getFile`, `ai.describePhoto`, `chat.sendMessage` to the owners |

On the phone, `chat.sendMessage` to another chat id becomes an outbox `notice` that the server relays through
Telegram (app/app_ports.js:93-98). So `notifyOwners` works from an app form unchanged.

---

## 2. The commit functions as built

### 2.1 `commitSaleGroup(ports, p)` (core_ledger.js:824-855; doc :816-823): the round-5 one write

**p** (doc :817):

| field | default / treatment | note |
|---|---|---|
| `item` | required: `{id, shop, price, cost}` | ONE item; no `lines` |
| `qty` | `max(1, round(qty or 1))` (:826) | 0 and negatives become 1; no upper bound here (`clampQty` caps at `MAX_SALE_QTY` 999 in the bot, core_bot.js:269-273) |
| `unitPrice` | nullish: `Number(item.price) or 0` (:827) | no minimum: 0 writes a total-0 sale (trap 6b) |
| `paid` | nullish: the whole amount; else `clamp(round, 0, amount)` (:829) | |
| `method` | `String(method or 'CASH').toUpperCase()` (:830) | not checked against the lists (callers check `methodKnown`) |
| `mixed`, `bankPart` | `bankPart = (KEY === CASH or !mixed) ? 0 : clamp(round, 0, paid)` (:831) | |
| `customerId` | `''` | on the SALE and the PAYMENT row |
| `dueDay` | kept only while `owed > 0` (:837) | format not checked here (the server refuses a non-date) |
| `note` | overrides the automatic note (:836) | |
| `priceChanged` | note `'price'` when nothing else applies | |
| `staff` | required (`staff.id`) | throws when missing |
| `source`, `transcript`, `updateId`, `when` | passed through; transcript on the SALE row only | `when` absent means one clock read per row |

**Derived** (:826-837): `amount = qty × unitPrice`; `cashPart = paid − bankPart`; `owed = amount − paid`;
`payKey = (mixed && bankPart === 0) ? CASH : KEY`; `twoRows = bankPart > 0 && cashPart > 0`;
`note = p.note || (twoRows ? 'split' : owed > 0 ? 'credit' : priceChanged ? 'price' : '')`.

**Rows, in this order** (:838-853): the SALE row, with `qty −qty`, `cash = twoRows ? cashPart : paid`,
`method = twoRows ? CASH : methodFor(payKey, paid)` (which is `''` when nothing was paid, :104-107),
`costAtSale = item.cost` and `dueDay`. When `twoRows`, a PAYMENT row follows: `amount = cash = bankPart`,
`method = KEY`, `refGroupId = sale.groupId`, note `'split'`, no dueDay, no transcript. It goes after the SALE row
because the server checks a PAYMENT against what the shadow ledger says is owed (comment :845). One `writeGroup`.

**Returns** `{groupId, txs, sale, payment (or null), owed}`.

**The seven outcomes** (SPEC-round-5 2.2; one check each in poc/run_wizard.js:520-549):

| # | Outcome | Rows | Cash | Method | Note | DueDay | check |
|---|---|---|---|---|---|---|---|
| 1 | cash, full, no buyer | SALE | amount | CASH | '' ('price' when bargained) | '' | run_wizard.js:525 |
| 2 | wallet or bank, full | SALE | amount | KEY | '' / 'price' | '' | :527 |
| 3 | one method, part now (0 allowed) | SALE | paid | `methodFor(KEY, paid)`: '' when 0 | 'credit' | the chosen day or '' | :529, :531 |
| 4 | mixed, full | SALE then PAYMENT | amount − bank, then bank | CASH, then KEY | 'split' · 'split' | '' | :533-534 |
| 5 | mixed, part now | SALE then PAYMENT | paid − bank, then bank | CASH, then KEY | 'split' · 'split' | day on the SALE only | :536-537 |
| 6 | mixed with cash part 0 (bank = paid) | SALE | paid | KEY | 'credit' if owed, else '' | as above | :539 |
| 7 | mixed with bank part 0 | SALE | paid | CASH by `payKey` ('' when 0) | 'credit' if owed, else '' | as above | :541, :543 |

Pinned too: a date chosen with a full payment is dropped (:545). A bargained part sale carries `'credit'`, not
`'price'` (:547).

**It does not validate:** the item's stock, its shop, its status (BLANK), a pending price, the qty upper bound, the
method's existence, the dueDay format or range, or "a part payment needs a buyer". **Validated by the guided flow
instead:**
- `saleCommit` (core_bot.js:3155-3187): the stale-tap guard (:3157); the step must be `paid` or `summary` (:3158);
  the item is re-read and a sold UNIQUE answers `sale_gone` '⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ' and writes nothing
  (:3161-3165).
- `saleQtyPick`/`saleQtyTyped`: 1..999 (:2805-2824).
- `saleFromPrice`: a price of at least 1 (:2412-2420).
- `saleNumber`: the transfer part 1..total−1, and the amount now from the transfer part to total−1 (:2936-2963).
- `saleDuePick`: 0..365 whole days (:2993-3002).
- `saleDueTyped`: today..+365, `noRoll` (:3010-3025).
- The buyer is needed for a part payment: `saleNext` (:2477-2478), and 🚫 is refused (:2830).
- `methodKnown` in `saleMethodPick`/`saleAccountPick` (:2908, :2917).

**Several items:** no. `qty` multiplies one item.
**Callers:** only `saleCommit` (core_bot.js:3168). Tests: run_wizard.js:523, :1408; run_gas.js:1454.

### 2.2 `commitSale(ports, p)` (core_ledger.js:801-814): the one-tap sale (quick, voice, notebook)

- p = `{item, qty, unitPrice | amount, paid, method, customerId, note, staff, source, transcript, updateId, when}`.
  `unitPrice` falls back to `round(amount / qty)`, then to `item.price` (:803-804).
- One SALE row: `cash = paid` clamped to 0..amount (:806); `method = methodFor(method, cash)`. No mixed payment, no
  dueDay, no automatic note.
- Several items: no.
- Callers: `S|` in quick (core_bot.js:463-471), the typed price and the typed count in quick (:773, :794), and voice
  `confirmProposal` (:1119) with `resolveOrCreateCustomer` (:1118). R6 `quick` keeps it.

### 2.3 `commitRestock(ports, p)` (core_ledger.js:857-864)

- p = `{item, qty, note, staff, source, transcript, updateId, when}`. `qty = max(1, round(qty or 1))`: a 0 or a
  negative becomes 1, never a refusal.
- One RESTOCK row: `qty +n`, amount/cash 0, no method. Several items: no (one group per item, so N undo buttons for a
  multi-tag restock).
- Callers: `RQ|` with presets `CFG.RESTOCK_PRESETS` [1, 5, 10, 20] (core_bot.js:513-527), the typed count (:803),
  voice (:1132), `newItemCost` (:2187), `attachTagToItem` (:4140), `importProducts` (core_ledger.js:1813).

### 2.4 `commitExpense(ports, p)` (core_ledger.js:882-890)

- p = `{amount, shop, category, method, note, staff, source, transcript, updateId, when}`.
- `amount = −|round(amount)|`; cash = amount. `category` is lower-cased (not checked against the list).
  `method = methodFor(method, amount)`.
- One EXPENSE row. **0 is written** (amount 0, method ''). `expenseAmount` refuses 0 before this
  (core_bot.js:2005-2011). Several items: n/a.
- Callers: `expenseMethod` (:2025-2040: `methodKnown` check :2029, then `markCommittedCard` and `setLastGroup`) and
  voice (:1147). The note is attached afterwards as a rewrite (`attachExpenseNote`, :2050-2062). A form passes it
  directly.

### 2.5 `commitPayment(ports, p)` (core_ledger.js:910-922)

- p = `{groupId, amount, method, customerId, shop, note, staff, source, transcript, updateId, when}`.
- `amount = round`. Capped at `info.owed` **only when `info.owed > 0`** (:913), so a fully paid group takes any
  amount. **It throws** when amount ≤ 0 (:914). `itemId`, `shop` and `customerId` are copied from `saleGroupInfo`;
  `refGroupId = groupId`.
- One PAYMENT row. Several items: one credit group per call (no "pay this buyer's balance" across credits).
- Caller: `commitPaymentAndReply` (core_bot.js:1849-1859), which refuses `owed <= 0` first (:1851). The button flow
  passes `method: null`, so the payment is CASH until a 🏦 rewrite (`replyKeyboard`, :354-365). A form passes the
  method directly.

### 2.6 `commitDeposit(ports, p)` (core_ledger.js:928-937)

- p = `{customerId, amount, method, shop, refGroupId (order id), note, staff, source, transcript, updateId, when}`.
- **It throws** when amount ≤ 0 (:930). `customerId` is not checked (a missing one writes `''`: money held for
  nobody).
- One DEPOSIT row. Callers: `finishDeposit` (core_bot.js:1924-1934, `shop: staff.shop`) and the order advance
  (:3853).

### 2.7 `applyDeposit(ports, p)` (core_ledger.js:945-960)

- p = `{groupId, customerId, orderId, amount, staff, source, updateId, when}`.
- It returns null when the group is unknown or voided, or when nothing can be applied. Amount =
  `min(free pool, or orderId's earmark plus free; info.owed; p.amount)`.
- One DEPOSIT_APPLIED row, written **into the sale's group** (`groupId: info.groupId`), so an undo of the sale also
  gives the deposit back. `itemId = info.itemId` (the first line's, for a basket).
- Callers: `creditDeposit` (core_bot.js:1791-1809), from the question that `saleCommit` asks when the buyer holds a
  free deposit and still owes (:3178-3182, `credit_use_deposit` '📥 {customer} ၏ စရံ {deposit} ကျပ် ရှိပါသည်။ သုံးမလား?').
  A basket works unchanged (it reads group owed).

### 2.8 `commitReturn(ports, p)` (core_ledger.js:866-879)

- p = `{item, qty, unitPrice | amount, refund, method, customerId, note, staff, source, transcript, updateId, when}`.
- `amount = −qty × unitPrice`. `cash = refund` nullish ? amount : `−|round(refund)|`. **The refund is not capped** at
  the return's value.
- One RETURN row (`qty +n`). Several items: no.
- Callers: `T|` (core_bot.js:528-535: qty 1, full refund, cash) and voice (:1137).

### 2.9 `commitTransfer(ports, p)` (core_ledger.js:893-907)

- p = `{item, toShop, staff, source, transcript, updateId, when}`. It moves the WHOLE stock: `qty = max(0, item.stock)`.
- Rows: TRANSFER_OUT (from-shop, −qty), then TRANSFER_IN (to-shop, +qty), one group. Then
  `updateItem(id, {shop: toShop})` **outside** the lock (:906).
- Not a seller form in R4. Callers: `X|` (core_bot.js:536-540) and voice (:1143).

### 2.10 `undoGroup(ports, groupId, staff, now, opts)` and the 30-minute window (core_ledger.js:992-1017)

- Reasons: `missing` (no rows), `already` (no live rows), `expired` when
  `(now − rows[0].time) / 60000 > CFG.UNDO_WINDOW_MIN` (30, core_config.js:9) and not `opts.force` (:998-999). The
  age is that of the FIRST live row in ledger order.
- It writes one mirror per live row, in the same group (:1004-1012), copying method and category and dropping
  dueDay. One `writeGroup`. A TRANSFER_OUT puts the item's shop back (:1014-1016).
- It returns `{ok, groupId, itemId: rows[0].itemId, types}`. For a basket, `itemId` is the first line's (the `U|`
  reply then shows that one item's card: basket map section 4).
- `voidGroup` (:1020-1022) is the owner's version with `force` and note `'void by owner'`.
- `U|g` (core_bot.js:541-551) answers `undo_expired` '⏱ {min} မိနစ် ကျော်သွားလို့ ပြန်ဖျက်လို့ မရတော့ပါ။',
  `undo_already` 'ℹ️ ပြန်ဖျက်ပြီးသားပါ။', or `undo_done` '↩️ ပြန်ဖျက်ပြီးပါပြီ', then `clearLastGroup`.
- Several items: yes, it mirrors every live row. An app form's sold card can call `undoGroup` directly, or send
  `U|g` through `deliver`.

### 2.11 `receiptNumber(ports, groupId)` (core_ledger.js:1729-1751)

- The first SALE row of the group that carries `receiptNo` wins (a phone's `R1-A-000231`). Otherwise the number is
  derived by counting SALE groups per shop (`'R' + shop digit + '-' + 6 digits`). Unknown: `'R?-000000'`.
- Group-level: one number per group whatever the row count, **except** that a phone has already used up one number
  per SALE row before this function runs (trap 6c).
- Callers: `buildReceipt` (core_report.js:345), gas_sync.js:431, :464, and the app's receipt lookup (app/app_ui.js:762).

### 2.12 `markCommittedCard` / `isCommittedCard` (core_bot.js:1515-1521)

- A cache key `card:<chat>:<msg>` kept for 600 s: "this message was just turned into the card of a committed entry".
- Read by `saleSoldCard` (:2383-2387, together with the `sold_done` prefix test, which never expires) and by
  `askAddOption` (:1487). Neither a late tap nor ➕ ever edits a sold card back into a question.
- Set by `saleCommit` (:3176), `expenseMethod` (:2037), and the delivery/cancel commits (:4038, :4091).
- Telegram only. An app form has no message id, so it needs nothing like this.

### 2.13 `setLastGroup` / `getLastGroup` / `clearLastGroup` / `setLastItem` (core_bot.js:3249-3259)

- `lg:<uid>`, with a TTL of `UNDO_WINDOW_MIN × 60` s: the group that a spoken "Wave နဲ့ ပေးသွားတယ်" (METHOD intent)
  rewrites. Set after every money commit (18 call sites, e.g. :470, :3174, :2036).
- `li:<uid>` (600 s): the "current" item for voice and for a bare photo (`handlePhoto` with no new-item state
  attaches the photo to it, :2103-2108).
- A basket should set `lg` to its group. `rewriteCheck` then answers `complex` (more than one live row,
  core_ledger.js:1029-1044), so a spoken method change on a basket is refused with `rewrite_locked`, as on a mixed
  guided sale today.

### 2.14 Summary

| Function | Rows written (order) | Refuses | Several items? |
|---|---|---|---|
| `commitSaleGroup` | SALE [, PAYMENT] | nothing (clamps) | no |
| `commitSale` | SALE | nothing | no |
| `commitRestock` | RESTOCK | nothing (0 becomes 1) | no |
| `commitExpense` | EXPENSE | nothing (0 is written) | n/a |
| `commitPayment` | PAYMENT | throws on ≤ 0 | one credit |
| `commitDeposit` | DEPOSIT | throws on ≤ 0 | n/a |
| `applyDeposit` | DEPOSIT_APPLIED (in the sale's group) | returns null | group-level, works |
| `commitReturn` | RETURN | nothing | no |
| `commitTransfer` | TRANSFER_OUT, TRANSFER_IN, then `updateItem` | nothing | no |
| `undoGroup` | mirrors of every live row | `missing`/`already`/`expired` | yes |

---

## 3. The item creation path of the photo flow (as built)

### 3.1 The sequence

1. **Scan of a blank tag.** `openTag` (core_bot.js:105-129) finds `status === BLANK` (:122) and sets the state
   `{kind: 'new_item', itemId, step: 'photo', draft: {}}` (:123), with the reply `new_tag`
   '🆕 Tag အသစ်ပါ ({id})။ ပစ္စည်းရဲ့ ဓာတ်ပုံ ပို့ပေးပါ။' plus ✖️ (`Z`).
2. **The photo.** `handlePhoto` (:2095-2132). It saves the photo with `chat.savePhoto(file_id, itemId)` (:2112) and
   calls `ai.describePhoto(file, {categories})` inside try/catch (:2116-2121). Then it fills the draft:
   `name = desc.name || draft.name || 'ပစ္စည်း ' + itemId` (:2122); `category` = the AI's if it is in
   `CFG.CATEGORIES` ['ထမီ', 'လုံချည်', 'အင်္ကျီ', 'ဝတ်စုံ', 'အခြား'], else the last one, 'အခြား' (:2123);
   `description` (:2124, **computed and never stored**: the Items tab has no such column, gas_store.js:354-357);
   `sample = !!draft.sample`. Then `step = 'price'`. A caption number of 500 or more skips the price screen
   (:2125, :2129).
3. **Price screen.** `priceScreen` (:2134-2143): `photo_seen` '📸 {name} · {category}' plus `ask_price`
   '💰 စျေး ဘယ်လောက်လဲ?'. Buttons: up to four `pricePresets(ports, category, staff.shop)` as `P|id|<n>`
   (core_ledger.js:1754-1769), `btn_other` '✏️ အခြား' (`P|id|other`), `btn_pending` '⏳ စျေး မသတ်မှတ်ရသေး'
   (`P|id|pending`), the sample toggle `PS|id` (`btn_sample_on` '🧵 နမူနာ: ဟုတ်' / `btn_sample_off`
   '🧵 နမူနာ: မဟုတ်'), and ✖️.
4. **`newItemPrice`** (:2154-2170). `other` sends `ask_number` '✏️ ဂဏန်း ရိုက်ပေးပါ (ဥပမာ 25000)'.
   `pending` stores `price ''`. Otherwise `price = Number(arg)`, with **no minimum** (a typed 0 is stored, and the
   item then reads as pending through `isPricePending`, :181-183). Then `step = 'cost'`, `ask_cost`
   '🧵 ကုန်ကျစရိတ် (အထည် + လက်ခ) ဘယ်လောက်လဲ? မသိရင် ကျော်ပါ။', with `C|id|skip` (`btn_skip` '⏭ ကျော်')
   and `C|id|other`.
5. **`newItemCost`** (:2172-2195) is the write. `skip` gives `cost ''`. Then:
   - `updateItem(itemId, {name, category, type: CFG.ITEM_TYPE.UNIQUE, price, cost, sample: !!sample, photoUrl,
     photoFileId, createdAt: now ISO, createdBy: staff.id})` (:2183-2186);
   - `commitRestock({item: getItem(id), qty: 1, staff, source: CFG.SOURCE.PHOTO, note: sample ? 'new sample' : 'new item'})`
     (:2187);
   - `clearState`, then `setLastItem` (:2188-2189);
   - `item_created` '🆕 မှတ်ပြီးပါပြီ' + ' · ' + id (:2190-2191);
   - when `isPricePending(fresh)`: `notifyOwners(ports, price_ask_owner, priceButtons)` (:2193), where
     `price_ask_owner` = '⏳ {id} · {name} · စျေး သတ်မှတ်ပေးပါ' and the `priceButtons` are `SP|id|<preset>` and
     `SP|id|other` (:2197-2200);
   - `sendItemCard` (:2194).
6. **Typed or spoken numbers** reach the same two functions: `handleText` (:732-735) and `handleIntent` (:890-896).

### 3.2 What the path does not do (the owner's complaint, R3)

- **No count.** `type` is hard-coded UNIQUE (:2184) and the RESTOCK is `qty: 1` (:2187). A pile of identical shirts
  must be created as one UNIQUE piece and then restocked from its card (`R|` and `RQ|`). Its type stays UNIQUE, so
  the card offers `S|id|1` and shows sold out after the first sale (`cardText` :190, `cardKeyboard` :219-226).
- **No name or category edit.** The AI's name (or the placeholder) is written as it is.
- **No profit display.** Price and cost are asked on two screens. Profit is never shown.
- **The state is per user** (`st:<uid>`, TTL `STATE_TTL_SEC` 1800 s). A second scan meanwhile replaces it.

### 3.3 Type: UNIQUE vs SKU

- UNIQUE: sold out at `stock <= 0`; `S|id|1` only; the app status becomes SOLD (app/app_store.js:260). SKU: the
  `S|id|1` plus 🔢 grid card, with restock and return.
- The only writer of SKU for a new item is `importProducts`: `type = Row.Type === 'UNIQUE' ? UNIQUE : SKU`, then
  `commitRestock(qty: stock)` when stock > 0 (core_ledger.js:1803-1813). This is the precedent for R3's "count > 1
  makes it a stock item with that many pieces": `type: count > 1 ? SKU : UNIQUE`, and ONE RESTOCK row of `qty: count`.
- `type` is a synced item field (`SYNC.ITEM_FIELDS`, core_sync.js:69), so a phone may write it.

### 3.4 Pending price and `notifyOwners` (core_bot.js:2221-2226)

- It loops over `store.listStaff()` with `role === 'owner'` and calls `chat.sendMessage(owner.id, text, kb)` inside
  try/catch, logging `notifyOwners`.
- On a phone each owner message becomes an outbox notice (app/app_ports.js:93-98). The `SP|` buttons then reach the
  owner's Telegram.
- A pending piece's card offers only `D|id` (`btn_sell_at` '💬 စျေးပြောပြီး ရောင်း') and `SP|id|ask`
  (`btn_set_price` '💰 စျေးသတ်မှတ်') (`cardKeyboard` :213-217). A basket line of a pending piece must therefore
  ask for a price, or trap 6b follows.

### 3.5 The sample flag

`PS|id` runs `toggleSample` (:2145-2152), which flips `draft.sample` and redraws the price screen. It is written as
`sample: !!d.sample` (GAS stores `TRUE` or `''`, gas_store.js:378). The RESTOCK note is `'new sample'`. The card adds
`sample_mark` ' (နမူနာ)' (:186).

### 3.6 On the phone (the app runs the same handlers through `deliver`)

- `ai.describePhoto` throws `PendingAi` and queues a job (app/app_ports.js:131-151). `handlePhoto` catches it, so the
  draft name is the placeholder `'ပစ္စည်း ' + id`.
- When the job comes back, `replayJob` writes the AI name (and category) **only while the item's name is still the
  placeholder** (app/app_sync.js:388-395). A name the seller typed in a form is never overwritten. R3's "pre-filled
  from the photo AI when available, editable" is therefore already safe offline, if the form saves the placeholder
  when nothing was typed.
- `updateItem` pushes an outbox `item` entry at once (app/app_store.js:286-293). The RESTOCK group follows as its own
  entry, so the item goes first in push order.

---

## 4. Customers

| Function | Where | What it does |
|---|---|---|
| `store.addCustomer({name, phone, note})` | gas_store.js:451-464 (`gasLocked`, id `'C-' + 4 digits` from the row count, Rev stamped); app/app_store.js:325-333 (id `'C-' + 8 hex`, outbox `customer` entry); sims poc/sim_ports.js:102, poc/sim_phone.js:151 | name `trim() or id`; phone stored as given |
| `resolveOrCreateCustomer(ports, name)` | core_ledger.js:1478-1482 | an exact name or phone match, else a new row with the name only; voice paths (core_bot.js:1118, :1155) |
| `matchCustomers(ports, hint)` | :1471-1475 | `{exact, partial}`; exact = same `normName` or same `normPhone` |
| `findCustomers(ports, hint)` | :1446-1468 | 4 or more digits and no letters: a phone search (exact number first, then contains). Otherwise exact name, then contains either way. This is R2's "one search field for name or phone" as it stands |
| `normPhone(s)` | :1421-1426 | Burmese digits to Arabic, non-digits dropped, `959…`/`+959…` and `9xxxxxxxx` become `09…` |
| `isValidPhone(s)` / `fmtPhone(s)` | :1428 / :1431-1442 | `^09\d{7,9}$`; `+95 977 712 3456` |
| `recentCustomers(ports, shop, n)` | :1398-1413 | the latest ledger activity of that shop, padded with the newest customers; R2's "recent buyers as chips" |
| `customerLabel(c)` | core_bot.js:1590-1592 | '👤 name · +95 …' |
| `saleResolveBuyer(ports, draft)` | core_bot.js:3140-3148 | at ✅: the picked customer, else the typed name (an exact match meanwhile is used), else `addCustomer({name, phone})`. **The Customers row is written only at Save**, so a cancelled sale leaves no stray customer |
| the new buyer's phone rule | `salePhoneTyped` core_bot.js:2882-2889 | under 7 digits: asked again; a number somebody already has offers that customer (never duplicated); a valid number is stored normalised, anything else as typed |

The app form needs `findCustomers` (the search field), `recentCustomers` (chips) and the phone rule plus
`saleResolveBuyer` (Save). All four are global functions the app already loads (it runs `core_bot.js`).

---

## 5. Option lists: how paid, expense categories

| Function | Where | Notes for a form |
|---|---|---|
| `listOptions(ports, name, shop, includeInactive)` | core_ledger.js:496-510 | active rows of that shop (a blank Shop means both shops), sorted by Order. Source per `listRows` (:473-489): the Lists tab, else Settings `lists_json` (the phone), else the version-3 Settings |
| `payMethods(ports, shop)` | :117-131 | `CASH` first, then the active pay_method keys. It **drops** keys over 12 bytes and caps at `MAX_BANK_BUTTONS` 12 (Telegram callback limits); an app form inherits the cap |
| `payMethodsByKind(ports, shop)` | :138-147 | `{wallets, banks}` without CASH, by `methodKind` |
| `methodKind(row)` | :372-374 | `row.kind` (`'wallet'`/`'bank'`), else `BANK` key means a bank, else a wallet |
| `methodKnown` / `methodLabel` / `accountDetail` | :189-194 / :197-204 / :207-210 | a retired key stays known; label from Lists, else Messages `method_<KEY>`; the account number (Detail) |
| `expenseCategories(ports, shop)` | :271-275 | `[[key, label]]`, `'other'` always present |
| `categoryLabel` / `expenseEmoji` / `expensePresets(ports, category)` | :278-283 / :289-294 / :316-331 | label; emoji (Detail, else built-in); four amount chips |
| `addListOptionByLabel(ports, name, label, staff, extra)` | :762-780 | "add an option on the fly": `{ok, existed, key, label}` or `{ok, created, …}`; `extra.kind` for a pay method. Refuses digits only and amount-looking text (`listFindByLabel`, :743-752). On a phone `store.addListOption` exists (app/app_store.js:353), so it works offline |

R2's payment segments map onto these directly. 💵 is `CASH`. Each wallet comes from `payMethodsByKind().wallets`
(the guided sale's `btn_wallet` '📲 {method}'). "Bank" opens `payMethodsByKind().banks` (`btn_bank_transfer`
'🏛 ဘဏ်', then `btn_bank` '🏦 {method}'). "Mixed" is `btn_split` '💵+🏦 ခွဲပေး', then any non-cash account and the
transfer part. The guided sale's screen offers mixed only when `total >= 2` (core_bot.js:2618).

---

## 6. Due dates

| Function | Where | Notes |
|---|---|---|
| `saleDuePresets(ports)` | core_bot.js:2331-2337 | Settings `sale_due_presets`: whole numbers 1..365, else `CFG.SALE_DUE_PRESETS` [7, 14, 30]. The screen uses the first three (:2697) |
| `addDaysKey(day, n)` | core_burmese.js:84-89 | `yyyy-mm-dd` + n |
| `daysBetweenKeys(a, b)` | :92-95 | whole days |
| `parseDayText(text, now, opts)` | :103-123 | `30.10.26`, `30/10`, `2026-10-30` (the app's date input), Burmese digits. Without `opts.noRoll` a yearless past date rolls to next year; the sale passes `noRoll` and then refuses it |
| `dayKey(date)` | :30-34 | Yangon day |

The bounds are inline in the bot, not in a helper. `saleDuePick` accepts 0..365 whole days and computes
`addDaysKey(dayKey(now), n)` (:2997-3001). `saleDueTyped` accepts a parsed date from today to today+365 (:3012-3013).
"Not sure" stores `dueDay ''`. An app form needs the same rules, so section 8 proposes `saleDueKey`.

---

## 7. The round-5 guided sale in core_bot.js

### 7.1 What it is

- **Mode.** `saleFlow(ports)` (core_config.js:208-210) returns `'quick'` for that word, else `'steps'`. Seeded as
  `steps` (gas_setup.js:76). A server older than DueDay forces `quick` on the phone (`syncSettingsQuick`,
  core_sync.js:1488-1493).
- **The state `st:<uid>`** (doc :2287-2305): `{kind: 'sale', step, item, msgId, hist, acct, draft: {qty, unitPrice,
  priceChanged, customerId, newName, newPhone, needBuyer, method, mixed, bankPart, paid, dueDay, addLabel, addedKey}}`.
  The typed prompts wrap it as `{kind: 'await_number', purpose: 'sale_step' | 'sale_qty' | 'sale_price', saved}`, and
  ➕ wraps it in `saved` with resume `SSA`. `saleStateOf` (:2340-2347) reads through all of these wrappers.
- **One item.** `state.item` is an item id, every callback carries it in slot 1, and `saleTotal(item, draft)`
  (:2349-2353) is one item × qty.

### 7.2 The callbacks

`SS|<item>|<letter>|<arg>` (dispatcher `saleCallback`, :2723-2748; letters `SALE_STEP_OF`, :2307) and
`SC|<item>|ok` (`saleCommit`, :3155-3187). Both are in `ITEM_ACTIONS` (:431). `SC` is in `MUTATING_ACTIONS` (the
two-minute double-tap guard, :435-436). `S` is exempt from that guard in steps mode (:446).

| letter | step | args | handler |
|---|---|---|---|
| `q` | qty | 2..9 | `saleQtyPick` :2805 |
| `b` | buyer | `none`, `new`, `create`, `<custId>` | `saleBuyerPick` :2827 |
| `ph` | phone | `skip` | `salePhoneSkip` :2891 |
| `m` | method | `CASH`, `<KEY>`, `bank`, `mix`, `more` | `saleMethodPick` :2897 |
| `a` | account | `<KEY>`, `p<n>` (page) | `saleAccountPick` :2915 / `saleRedraw` |
| `x` | bank (transfer part) | `half` | `saleBankHalf` :2923 |
| `p` | paid | `0`, `half`, `bank`, `other` | `salePaidPick` :2975 |
| `d` | due | `<n>`, `type`, `none` | `saleDuePick` :2993 |
| `k` | kind | `wallet`, `bank` | `saleKindPick` :3031 |
| `back` | (any) | `<step>` | `saleBack` :2754 |
| `z` | n/a | n/a | `saleCancel` :2790 |

Also `QN|`, `D|` and `LA|pm|SSA|<item>` open prompts inside the flow (:482-510, :1491-1500). Byte budget today:
`SS|S1-0001|b|C-1a2b3c4d` is 23 bytes.

### 7.3 Inventory, with the verdict for a Telegram review card

A review card (R5) is ONE message that shows the whole sale with its defaults, has edit buttons that open
sub-screens, and has a Save. Each sub-screen returns to the card.

| Function (lines) | Today | For the review card |
|---|---|---|
| `saleCtx` 2314-2316, `saleShownId` 2323-2325 | the tap's context; where a screen now sits | **REUSE** |
| `saleDuePresets` 2331-2337 | due chips | **REUSE** (the app form too) |
| `saleStateOf` 2340-2347 | the sale behind a prompt | **ADAPT**: the new state kind (a basket) |
| `saleTotal` 2349-2353 | one item × qty | **ADAPT**: the sum of the lines (section 8, `basketTotals`) |
| `saleGuard` 2359-2377 | stale-tap rules (a)-(c) keyed by `state.item` and `state.msgId` | **ADAPT**: key by the card's token or msgId; rule (c) "step letter" becomes "sub-screen open" |
| `saleSoldCard` 2383-2387 | sold-card test | **REUSE** (keep the `sold_done` prefix on the basket sold card) |
| `startGuidedSale` 2393-2406 | S\|id\|n: the S✖ check, double-tap no-op, then the buyer screen | **ADAPT**: becomes the card opener. Keep the sold-meanwhile check (`sale_gone`) and the "identical tap makes no edit" rule; drop `saleGo(... 'buyer')` |
| `saleFromPrice` 2412-2427 | typed price: UNIQUE goes to the buyer screen, SKU to the grid | **ADAPT**: sets one line's price, then back to the card |
| `saleGo` 2433-2437 | push the old step on `hist`, draw | **DEAD** (a sub-screen does not stack) |
| `saleRedraw` 2443-2455 | draw `state.step`'s screen on the tapped message, store the state, wrap a number prompt (`await`) | **REUSE** as "draw the card or the open sub-screen" |
| `saleNext` 2463-2482 | the skip chain (buyer, method, account, bank, paid, due, summary) | **DEAD**. Two of its rules survive as a Save-time check: "a part payment needs a buyer" (:2477) and "a single account is picked for you" (:2471) |
| `saleBuyerScreen` 2489-2494 | the hist trick for the look-alikes | **DEAD** (look-alikes go back to the buyer sub-screen) |
| `saleAfterAccount` 2497-2499 | account, then the transfer part when mixed, else paid | **ADAPT**: a small chain inside the "how paid" sub-screen; its end is the card |
| `saleHeader` 2506-2526 | the lines above every question: `confirm_sale`, the buyer, `sale_line_method`/`sale_line_mixed`, `sale_line_paid` | **ADAPT**: the card's body, one line per basket line (basket map: `basket_line` NEW plus `receipt_line`) |
| `saleBackRow` 2529-2531 | ⏮ `back|<step>` + ✖️ | **ADAPT**: ⏮ returns to the card; ✖️ only on the card |
| `saleQtyGrid` 2534-2547, `saleScreenQty` 2567-2569 | the 2..9 grid + ✏️ + 💬 | **REUSE** as one line's count sub-screen (SKU only) |
| `saleScreenFor` 2550-2565 | step to screen | **ADAPT** (the summary becomes the card) |
| `saleScreenBuyer` 2572-2585, `saleScreenLookalikes` 2591-2599, `saleScreenName` 2601-2603, `saleScreenPhone` 2606-2609 | the buyer sub-screens | **REUSE** with the new back row. Their `needBuyer` line (`sale_need_buyer` 'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်') moves to the card |
| `saleScreenMethod` 2615-2635, `saleAccountCandidates` 2638-2644, `saleScreenAccount` 2646-2664, `saleScreenBankPart` 2667-2673, `saleScreenKind` 2707-2711 | how paid, the account, the transfer part, a new account's kind | **REUSE** |
| `saleScreenPaid` 2676-2691 | how much now; its first button `btn_paid_all` '✅ အကုန် {amount}' **commits** (`SC|id|ok`, :2679) | **ADAPT**: "all" sets `paid = total` and returns to the card. Save lives on the card only |
| `saleScreenDue` 2694-2700, `saleScreenDueText` 2702-2704 | the due chips, a typed date | **REUSE** (shown only while something is owed) |
| `saleScreenSummary` 2714-2720 | header + due line + `confirm_ask` + `btn_yes` (`SC`) | **DEAD as a step**. Its body is the card's text |
| `saleCallback` 2723-2748 | dispatcher behind `saleGuard` | **ADAPT**: new letters for the card (add item, pick a line, a line's count, price, remove, Save) |
| `saleBack` 2754-2782 + `SALE_BACK_CLEARS` 2309-2312 | pop `hist`, clear the fields the re-shown step owns | **DEAD**. One rule survives: back from a prompt opened from a sub-screen redraws that sub-screen (:2757-2759) |
| `saleCancel` 2790-2803 | ✖️: clear the state; the message becomes the item card; a sold card is never touched | **REUSE** |
| `saleQtyPick` 2805-2810, `saleQtyTyped` 2816-2824 | count 1..999 | **ADAPT** (per line; exit to the card) |
| `saleBuyerPick` 2827-2844, `saleBuyerChosen` 2846-2852, `saleBuyerNamed` 2860-2876, `salePhoneTyped` 2882-2889, `salePhoneSkip` 2891-2894 | buyer answers, digits as a phone hint, look-alikes, the phone rule | **ADAPT** (exit `saleNext` becomes the card) |
| `saleMethodPick` 2897-2912, `saleAccountPick` 2915-2920, `saleBankHalf` 2923-2929, `saleNumber` 2936-2963, `saleBankFromCash` 2966-2972, `salePaidPick` 2975-2990 | the payment answers and their bounds | **ADAPT** (exits). The bounds are the rules a form needs too, so they move to section 8's pure helpers |
| `saleDuePick` 2993-3002, `saleDueTyped` 3010-3025 | due answers and bounds | **ADAPT** (exit). The bounds go to `saleDueKey` |
| `saleKindPick` 3031-3042, `saleAddNamed` 3048-3070, `saleAccountResume` 3073-3082 | ➕ an account inside the sale; nothing is written before the kind | **REUSE** (`hist.pop` :3040 becomes "return to the how-paid sub-screen") |
| `saleIntentClashes` 3088-3094, `saleResend` 3100-3104 | voice beside a live sale | **ADAPT**: a clash with ANY basket line; resend redraws the card |
| `saleText` 3111-3137 | typed text routed to the step | **ADAPT** (per sub-screen) |
| `saleResolveBuyer` 3140-3148 | the buyer at Save | **REUSE** (the app form too) |
| `saleCommit` 3155-3187 | re-read, sold check, `commitSaleGroup`, `setLastItem`/`setLastGroup`, `clearState`, `markCommittedCard`, the sold card or the deposit question | **ADAPT**: re-read and check EVERY line, then `commitBasket`. The tail (:3173-3186) is reused as is |
| `saleCardText` 3194-3217 | the sold card from the ledger | **ADAPT** for a basket (basket map section 4, row "sold card") |
| `saleCardKeyboard` 3220-3224 | undo/receipt, 💰 while owed, 🔢 number for a new account, 📱 phone | **REUSE** |

### 7.4 Entry points outside the section (they change with R6 `form`)

- `handleCallback`: the `S` exemption from the double-tap guard (:446); `S` steps branch to `startGuidedSale`
  (:465); `Q` steps branch, grid as the first screen (:474-480); `QN` steps branch (:483-491); `D` steps branch
  (:495-506); `SS`/`SC` (:511-512); `ITEM_ACTIONS` lists `SS`, `SC` (:431).
- `applyAwaitedNumber`: `sale_price` (:772), `sale_qty` (:783-790, :793), `sale_step` (:815).
- `handleText`: `saleText` before the number path (:723).
- `handleIntent`: spoken name/phone/date into the step (:843-849), the spoken transfer part (:904-908), spoken
  count/amount (:912-918), the clash rule (:931-934).
- `confirmProposal`: a spoken sale of the same piece clears the live flow (:1129-1130).
- `askAddOption` `SSA` (:1491-1500) and `finishAddOption`'s resume (:1533).
- `saleFlow` (core_config.js:208-210), `CFG.SALE_FLOW` (:111), the seed (gas_setup.js:76, its note :85-92),
  `settings_note_sale_flow` 'steps = တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက် ရောင်း' (core_messages.js:448),
  `syncSettingsQuick` (core_sync.js:1488-1493), and the simulator (poc/sim_ui.js:96, :217, :953-955;
  poc/sim_tours.js:330-336; poc/sim_seed.js:72 `quick` for the suites).
- **`openTag` clears the live state on any known tag** (:125-127; run_wizard.js step 16 "a scan clears it"). A
  review card's "add an item by scanning" therefore needs `openTag` to route the scan into the live basket first.
  The custom-order precedent is already in place: `st.kind === 'order_tag'` goes to `attachTagToItem` (:110). The
  same goes for a typed tag id (`tagIdFromText`, `handleText` :704-705).

### 7.5 A review card built from these parts (sketch for the spec, not a decision)

- **Text.** `saleHeader` generalised. The basket line `basket_line` (NEW, basket map) is followed by one
  `receipt_line` '{name} × {qty} · {amount}' per line, then the buyer (`customerLabel`, or '👤 name · phone' for a
  new one), how paid (`sale_line_method` '💰 {method}' / `sale_line_mixed` '💰 {cashMethod} {cash} · {method} {bank}'),
  paid now (`sale_line_paid` 'ပေးပြီး {paid} · ကျန် {owed}'), and while owed the due line (`sale_due_set`
  '📅 ကျန် {owed} · {date}' / `sale_due_none` '📅 မသေချာ'). A refusal reason is added (e.g. `sale_need_buyer`).
- **Keyboard.** ➕ add an item (NEW `btn_add_item`). One button per line, which opens that line's sub-screen: count
  grid (SKU), 💬 price (`btn_discount` '💬 စျေးလျှော့'), remove (NEW `btn_remove_line`). Then 👤 buyer
  (`saleScreenBuyer`), 💰 how paid (`saleScreenMethod`), paid now (`saleScreenPaid`, adapted), 📅 due (only while
  owed), Save (`btn_save` '✅ သိမ်း', core_messages.js:344), ✖️ (`btn_cancel` '✖️ မလုပ်တော့').
- **Defaults** (R2): count 1, cash, paid in full, no buyer. A plain sale is scan, then Save (two taps; quick stays one).
- **Callbacks.** Keep `SS`/`SC` with the first line's item id in slot 1 (it satisfies `ITEM_ACTIONS`), or move them
  out of `ITEM_ACTIONS` and carry a 10-character token (the `measToken` pattern, :4149). Budget:
  `SS|<10>|<letter>|<arg>` is about 32 bytes with a 12-byte KEY, or a line index plus a count.
- **Where it is drawn.** The scanned piece's card is a photo message, so editing it means a caption of at most 1024
  characters. A basket of several lines may need the card as a NEW text message (4096 characters). `isCaption` is
  carried already (`saleCtx`).
- **Save** = `saleCommit` adapted: re-read every line, `basketCheck`, `saleResolveBuyer`, `commitBasket`, then the
  tail at :3173-3186.

### 7.6 The new-piece review card in Telegram (R5), from the photo-flow parts

`handlePhoto` keeps building the draft (:2111-2124). `priceScreen` becomes a card that shows name, category, price,
cost, profit and count (NEW labels, section 8.6). Its buttons: ✏️ name (a typed prompt; `ask_name`
'✏️ နာမည် ရိုက်ပေးပါ'); the category chips (`CFG.CATEGORIES` with `categoryEmoji`); 💰 price (`P|` presets +
`other` + `pending`, reused); 🧵 cost (`C|` skip/other, reused); 🔢 count (`btn_qty` '🔢 အရေအတွက်', grid
`CFG.QTY_GRID` + typed); 🧵 sample (`PS|`, reused); Save. `newItemPrice`/`newItemCost` stop moving `step` forward and
only set the field before redrawing the card. The write part of `newItemCost` (:2181-2194) becomes `commitNewItem`
plus `notifyOwners`. The typed-number routing (`handleText` :732-735, `handleIntent` :890-896) keys on the open
sub-screen instead of `step`.

### 7.7 What dies if step-by-step is no longer a mode (R5: removed with its tests replaced)

- `saleGo`'s hist push; `state.hist`; `saleNext`; `saleBuyerScreen`; `saleBack`'s pop logic and `SALE_BACK_CLEARS`;
  `saleScreenSummary` as a step; the commit button on `saleScreenPaid`; the `needBuyer` detour (:2477-2478, :2574,
  :2830) as a flow step; the steps branches of `Q`/`QN`/`D` that make the grid or the price prompt the FIRST
  screen (:474-506), and their `applyAwaitedNumber` twins (:772, :783-793); `startGuidedSale`'s
  `saleGo(... 'buyer')`; the value `steps` in `CFG.SALE_FLOW` (R6: it reads as `form`).
- **Checks that pin it:** poc/run_wizard.js steps 1-24 (185 `SS|`/`SC|` references). Notably step 11 "Back"
  (:694), step 12 "Cancel" (:780), step 2 "The count" (:200), step 8 "Part without a buyer" (:552), and step 17
  "Quick switch" (:1028). Also run_app.js (37), run_sync.js (8) and run_round4.js (4) `SS|`/`SC|` references, and
  the tours at poc/sim_tours.js:330-336.
- **Checks that survive as they are:** step 7, the seven outcomes (:520-549), provided `commitSaleGroup` stays a
  byte-for-byte wrapper; step 21 the ledger helpers (:1165); step 22 Kind in the core (:1191).
- **Already dead before round 6:** `enrolledInApp` and `sendAppCard` (core_bot.js:4470-4480, with
  `app_sell_hint` '📲 ဒီဖုန်းက အက်ပ် သုံးနေပါသည် · ရောင်းရန် အက်ပ်ထဲမှာ scan လုပ်ပါ' and
  `btn_sell_in_app` '📲 အက်ပ်ထဲမှာ ရောင်းပါ') have no caller anywhere in the tree. They fit R5 (Telegram only as the
  backup for a seller whose phone has the app), or they can be removed.

---

## 8. New core functions a basket sale and a counted new piece need (proposed signatures)

Every name below is free in the tree (grep over apps-script, app, poc, tools; dist excluded). ES5, one global scope,
no new apps-script file (R9). "Pure" means no ports, so it can be tested in Node as the measurement helpers are
(app/app_ui.js:130-215, checked in poc/run_app.js:550-553).

### 8.1 Basket sale (core_ledger.js unless noted)

```
basketAllocate(amounts, atSaleCash) -> [cash_i]                                         // pure
```
The basket map's rule 3.2: `cash_i = min(amount_i, A − Σ cash_<i)`, line order, Σ = A, `0 <= cash_i <= amount_i`.
It is the ONE allocation rule R7 asks every reader to agree with (readers that show a per-line paid figure call it
too).

```
basketTotals(lines, pay) -> {total, paid, bankPart, cashPart, owed, twoRows, payKey, rowCash: [..], note}   // pure
  lines = [{qty, unitPrice, priceChanged}], pay = {paid (nullish = full), method, mixed, bankPart}
```
It applies `commitSaleGroup`'s derivations (:826-837) to the sum, then `basketAllocate` over `twoRows ? cashPart : paid`.
It gives the form's live total and the card text, and `commitBasket` uses it, so the screen and the ledger cannot
disagree.

```
basketAddItem(ports, staff, lines, item, qty) -> {ok: true, lines, index} | {ok: false, reason, index}
  reason: 'blank' | 'other_shop' | 'sold' | 'twice' | 'max'
```
It reads the store only (`getItem`), with no write. BLANK is refused. `item.shop !== staff.shop` is refused for a
seller (R2; today only the server refuses another shop, as a quarantine of the whole group, core_sync.js:357-370). A
UNIQUE with `stock <= 0` is refused. A UNIQUE already in the basket is refused (`twice`). The same SKU raises that
line's count instead of adding a row (basket map rule 5). It caps the line count at a new `CFG.BASKET_MAX_LINES`
(NEW; well under `PUSH_MAX_ROWS` 200 and under Telegram's caption/keyboard limits). A pending-price item is ACCEPTED
with `unitPrice: null` and flagged, so the form asks for its price.

```
basketCheck(ports, staff, draft) -> {ok, problems: [{code, index}]}
  draft = {lines, paid, method, mixed, bankPart, customerId, newName, dueDay}
```
The Save-time re-check, shared by the app form and the Telegram card. It re-reads every line (sold meanwhile,
`sale_gone`). Every `unitPrice` must be ≥ 1 (trap 6b) and every qty 1..`MAX_SALE_QTY`. A part payment needs a buyer
(`customerId` or `newName`; `sale_need_buyer`). A mixed transfer part must be 1..paid. The method must be
`methodKnown`. The dueDay must be blank or today..+`SALE_DUE_MAX_DAYS`.

```
saleDueKey(today, choice) -> 'yyyy-mm-dd' | '' | null                                   // pure
  choice: a number of days 0..SALE_DUE_MAX_DAYS | a typed date | 'none'
```
The bounds of `saleDuePick`/`saleDueTyped` (core_bot.js:2997-3001, :3012-3013) in one place (`parseDayText`
with `noRoll`). `null` means refused.

```
commitBasket(ports, p) -> {groupId, txs, sales: [tx], payment: tx | null, owed, total}
  p = {lines: [{item, qty, unitPrice, priceChanged}], paid, method, bankPart, mixed, customerId, dueDay, note,
       staff, source, transcript, updateId, when}
```
The one write:
- `when = p.when || ports.clock.now()` is taken ONCE and passed to every `newTx` (trap 6a).
- One SALE row per line, in line order, with `cash = rowCash_i`. The method is `twoRows ? (cash_i ? CASH : '') :
  methodFor(payKey, cash_i)`.
- The buyer goes on every row (rule 2). `dueDay` goes on EVERY SALE row while the group owes (rule 1).
- Note: the group note (`'split'`/`'credit'`) on every SALE row, `'price'` on a bargained line when nothing else
  applies (rule 6).
- Then at most one PAYMENT for `bankPart` (`itemId` = line 1's item, `refGroupId` = group, `'split'`), AFTER all
  SALE rows (rule 3). One `writeGroup`.
- A one-line basket writes `commitSaleGroup`'s rows exactly (rule 7).

```
commitSaleGroup(ports, p) := commitBasket(ports, merge(p, {lines: [{item: p.item, qty: p.qty,
    unitPrice: p.unitPrice, priceChanged: p.priceChanged}]})) plus {sale: r.sales[0]}
```
Kept as a wrapper, so step 7 of run_wizard.js and run_gas.js:1454 stay green. The one difference is the single
clock read, which changes no check.

**Not core but required for "one receipt number" (R2):** the phone's `appendLedger` stamps only the first SALE row
of a group, or copies its number onto the group's later SALE rows (app/app_store.js:294-299 and the twin
poc/sim_phone.js:121-126; basket map rule 4).

### 8.2 Counted new piece

```
newItemDraft(ports, staff, itemId, desc) -> {name, category, price: '', cost: '', count: 1, sample: false,
                                             photoUrl, photoFileId}
```
In core_bot.js or core_ledger.js. These are the defaults `handlePhoto` builds today (:2117-2124: the AI name, else
`'ပစ္စည်း ' + id`; the AI category if listed, else 'အခြား'). The app form and the Telegram card then start from the
same values.

```
itemMargin(price, cost) -> {profit, pct} | null                                          // pure
```
R3's "profit (အမြတ်) and its percentage shown automatically". `null` while price or cost is unknown. **The spec
must name the base**: profit/cost (markup) or profit/price (margin). The brief does not say. The 21:00 summary's
profit is revenue minus cost (core_messages.js:87, :203), which says nothing about a percentage.

```
commitNewItem(ports, p) -> {ok: true, item, groupId, pending} | {ok: false, reason}
  p = {itemId, name, category, price ('' = pending), cost ('' = unknown), count, sample, photoUrl, photoFileId,
       staff, source, updateId, when}
  reason: 'missing' | 'not_blank' | 'count' | 'price' | 'cost'
```
In core_ledger.js (it calls only `updateItem` and `commitRestock`; the header rule, :25-26, forbids calling core_bot).
- It refuses an unknown or non-BLANK item, a count outside 1..`MAX_SALE_QTY`, and a negative or non-integer price or
  cost.
- An empty name falls back to `'ပစ္စည်း ' + id` (keeping the app's AI-replay rule, app/app_sync.js:390). A category
  not in `CFG.CATEGORIES` becomes the last one.
- It writes `updateItem(id, {name, category, type: count > 1 ? SKU : UNIQUE, price, cost, sample, photoUrl,
  photoFileId, createdAt, createdBy})`, then ONE `commitRestock({qty: count, note: sample ? 'new sample' :
  'new item', source})`.
- `pending = isPricePending(item)`. The caller, in core_bot.js or the app, sends
  `notifyOwners(price_ask_owner, priceButtons)` when it is true, as `newItemCost` does (:2193).
- `newItemCost` becomes a caller. `attachTagToItem` and `importProducts` may stay as they are (orders are out of R4).

### 8.3 The R4 "should" and "could" jobs

```
commitRestockGroup(ports, p) -> {groupId, txs}      p = {lines: [{item, qty}], note, staff, source, updateId, when}
```
Should (restock form). One RESTOCK row per line, one group, one undo. It refuses (instead of clamping) a qty below 1.
`commitRestock` stays for the one-item paths.

Expense, deposit and return forms need no new write. `commitExpense` already takes `{amount, shop, category, method,
note}` in one call. `commitDeposit` takes `{customerId, amount, method, note, shop}`. `commitReturn` takes `{item,
qty, refund, method, customerId}`. They need only the form-side checks the bot does today: amount > 0
(:2008-2011); `methodKnown`; a customer for a deposit; the refund capped at the return's value (no check exists
today). A category added on the spot uses `addListOptionByLabel(ports, 'expense_category', label, staff)`.

```
commitCustomerPayment(ports, p) -> {groupId, txs, applied: [{groupId, amount}], left}
  p = {customerId, amount, method, shop, note, staff, source, updateId, when}
```
Could. "Receive a payment on a credit (buyer, amount, how paid)": `commitPayment` takes one credit group. A buyer with
several open credits needs the amount spread oldest first over `openCredits(ports, shop)` of that customer: one
PAYMENT row per credit (`refGroupId` = that credit), one group, refused when nothing is owed. Alternatively the form
lists the buyer's credits and calls `commitPayment` once. The spec chooses.

### 8.4 Telegram review card (core_bot.js; names free)

```
saleFlow(ports) -> 'form' | 'quick'            // core_config.js; 'steps' and anything else read as 'form' (R6);
                                               // CFG.SALE_FLOW gains FORM: 'form'
startBasket(ctx, item, qty)                    // S|id|n in form mode (replaces startGuidedSale; also when openTag
                                               // meets a live basket: add the line instead of clearing the state)
basketCardText(ports, draft) / basketCardKeyboard(ports, draft)
basketCallback(ctx, parts, message)            // the card's buttons and the sub-screens (section 7.3 REUSE/ADAPT parts)
basketSave(ctx, message)                       // basketCheck, saleResolveBuyer, commitBasket, then saleCommit's tail
newItemCardText(ports, state) / newItemCardKeyboard(ports, state) / newItemSave(ctx)   // the new-piece card (7.6)
```

### 8.5 The app's bridge (R1)

The precedent: `ports.ui.measureForm(req)` (app/app_ports.js:179-183) and `measureFormEnabled` (core_bot.js:4183).
The bot calls it where Telegram would draw screens, and the app draws its own form. The same shape gives
`ports.ui.saleForm({itemId, qty})` from `S|` in form mode and `ports.ui.newItemForm({itemId})` from `openTag` on a
blank tag. Telegram has no `ports.ui`, so it gets the review card. A form's Save calls `commitBasket` /
`commitNewItem` with `phone.ports` and `store.meta.staff`, then `phone.commit('form')` and `sync.scheduleSync()`
(the `appMeasCommit` pattern, app/app_ui.js:257-259). `source` stays `CFG.SOURCE.BUTTON`, or a new `FORM` value: the
server accepts any string (core_sync.js:384). No core double-tap guard covers a form (the `tap:` key is per Telegram
message, core_bot.js:447), so the form must disable its own Save.

### 8.6 New labels these functions need (NEW, drafts for the spec)

| key | proposed Burmese | use |
|---|---|---|
| `btn_add_item` | '➕ ပစ္စည်း ထပ်ထည့်' | the card's add-a-line button |
| `btn_remove_line` | '🗑 ဖယ်' | a line's sub-screen |
| `basket_twice` | 'ℹ️ {id} ထည့်ပြီးသားပါ' | `basketAddItem` reason `twice` |
| `basket_other_shop` | '⚠️ {id} · {shop} ဆိုင်က ပစ္စည်းပါ · မထည့်ပါ' | reason `other_shop` |
| `basket_line`, `basket_name`, `card_buyer_basket` | as in the basket map section 4 | readers |
| `item_lbl_cost` | '🧵 အရင်း {cost}' | new-piece card / form (R3's word အရင်း) |
| `item_lbl_price` | '💰 ရောင်းဈေး {price}' | idem (R3's word ရောင်းဈေး) |
| `item_lbl_profit` | '📈 အမြတ် {profit} · {pct}%' | idem (အမြတ် as in `today_query`, core_messages.js:87) |

Existing labels to reuse: `btn_save` '✅ သိမ်း', `btn_qty` '🔢 အရေအတွက်', `btn_pending` '⏳ စျေး မသတ်မှတ်ရသေး',
`btn_sample_on`/`btn_sample_off`, `ask_name`, `ask_number`, `ask_sale_price` '💬 ဘယ်စျေးနဲ့ ရောင်းလဲ? ဂဏန်း ရိုက်ပါ (ဥပမာ 18000)',
`sale_gone`, `sale_need_buyer`, `bad_qty` '❓ ၁ မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ', `sale_bad_amount`
'❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ', `ord_bad_date` '❓ ရက်စွဲ နားမလည်ပါ။ ဥပမာ 30.10.26 လို ရိုက်ပါ။'.
APP_MSG (app/app_i18n.js) already has `ui_meas_save` '✅ သိမ်း' (:147) and `ui_btn_photo` '📸 ဓာတ်ပုံ' (:65). The app
form's own `ui_*` keys are for the spec.
