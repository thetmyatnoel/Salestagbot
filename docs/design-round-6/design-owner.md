# design-owner.md — round 6, owner-and-books first: what every form writes, who reads it, and Telegram as the owner's channel

Date 2026-11-12. Designer's report for `docs/design-round-6/BRIEF.md` (R1-R9), angle **owner and books first**: the
ledger shape of every form outcome, the one cash-allocation rule and where DueDay goes, the proof that every reader
agrees, the Telegram review card as the sellers' backup and the owner's channel, `sale_flow` form/quick and the
migration from `steps`, and what the laptop shows. Inputs: the brief, `map-app-forms.md`, `map-core-commits.md`,
`map-sim-tests.md` (this folder) and `docs/design-round-5/map-basket-readers.md` (called "the basket map"). Every
file:line is the current tree (rounds 4 and 5 built, unpublished). No code or test was changed. Burmese labels are
quoted verbatim from `apps-script/core_messages.js` (MSG) and `app/app_i18n.js` (APP_MSG); new ones are marked NEW
with a proposed text for a native speaker to confirm.

---

## 0. Top decisions (the ones the orchestrator should weigh first)

1. **One write for a basket: `commitBasket` in core_ledger.js, and `commitSaleGroup` becomes a one-line wrapper.**
   ONE group, one SALE row per line in the order the seller added them, the buyer on every row, at most one PAYMENT
   (the transfer part of a mixed payment) AFTER all SALE rows, the clock read ONCE. The derivations are
   `commitSaleGroup`'s (core_ledger.js:824-837) applied to the basket total, so a one-line basket writes exactly
   today's rows and the seven-outcome checks (poc/run_wizard.js:520-549) stay green unchanged.
2. **Allocation rule: fill in line order** (the basket map 3.2). The at-sale cash `A = twoRows ? cashPart : paid`
   goes on the SALE rows as `cash_i = min(amount_i, A − Σ cash_<i)`. A pure `basketAllocate` is the only code that
   splits money; the form's preview, the Telegram card and the write all call it. **DueDay goes on EVERY SALE row**
   of a basket that still owes after the write (the group-level condition of core_ledger.js:837), never on the
   PAYMENT. `saleGroupInfo` additionally takes the first non-blank dueDay of the live rows (one line of insurance).
3. **One receipt number per basket on a phone.** `appendLedger` (app/app_store.js:294-299, and its twin
   poc/sim_phone.js:121-126) stamps the first SALE row of a collector run and COPIES that number onto the group's
   later SALE rows. The counter moves by one per basket; the Sheet's ReceiptNo column shows the same number on every
   line of it, which is what `backfillSync` would write anyway (gas_sync.js:460-467).
4. **Readers that show "the item" learn the basket** (R7), with three NEW MSG keys from the basket map
   (`basket_line`, `basket_name`, `card_buyer_basket`) and a basket sold card that keeps the prefix `✅ ရောင်းပြီး`,
   so `saleSoldCard` (core_bot.js:2383-2387) still recognises it. Every reader keeps today's output for a group with
   one SALE row (`info.rows.length > 1` is the switch), so no existing reader check moves.
5. **`sale_flow` = `form` | `quick`.** `form` (the code default and the setupSheet seed) = the app's forms and the
   Telegram review cards. `quick` = everything exactly as round 4 built it, in BOTH channels: the one-tap card with
   its corrective buttons, today's app home, today's photo chain (price, then cost). Any value other than `quick`
   (`steps` included, a blank, a typo) reads as `form`. `seedSimWorld` keeps `quick` (poc/sim_seed.js:72), so every
   quick-seeded suite stays green without a touch. A server older than DueDay still forces `quick`
   (core_sync.js:1454), so a form never writes to a rolled-back bot. **No new sync cap**: caps stays `['dueDay']`
   (run_gas.js:1771 and run_sync.js:1734 keep their exact list).
6. **The scan router is the core's `openTag`** (core_bot.js:105-129), for both channels. In `form` mode with the
   app's NEW hook `ports.ui.form(req)` (beside `ports.ui.measureForm`, app/app_ports.js:179-183) a blank tag opens the
   new-piece form and a known own-shop tag opens (or joins) the sale form. Telegram has no `ports.ui`: there a blank
   tag starts the photo and then the new-piece card, a scan during a live basket adds a line, and any other scan shows
   the item card as today (✅ on it opens the review card). Because the app's scan still passes through `/start <id>`,
   the simulator's `scanned(id)` predicate (poc/sim_tours.js:50-52) keeps working (map-sim-tests trap T2 closed).
7. **A counted new piece is one Items update plus ONE RESTOCK row**: `type: count > 1 ? SKU : UNIQUE`, RESTOCK
   `qty: count` (the `importProducts` precedent, core_ledger.js:1803-1813), through a NEW `commitNewItem` shared by the
   app form and the Telegram card. Profit is `price − cost` with its percentage **on cost** (mark-up), and the label
   says so in words (`အရင်းပေါ်`), so nobody reads it as a margin.
8. **Restock of several tags is one group** (`commitRestockGroup`, one RESTOCK row per line, one undo). **An expense
   is today's one EXPENSE row**, with the note passed at once (no rewrite). The R4 "could" jobs (payment, deposit,
   return) are NOT forms this round: they keep their ☰ chat flows, which already work in the app through `deliver`.
9. **Telegram is the owner's channel and the sellers' backup.** Nothing the owner uses moves: the 21:00 summary,
   reports and PDFs, receipts, pings (price pending with `SP|`, server flags with `V|`), 📲 the enrolment code, 📱
   devices, 🏛 accounts, customers, orders, measurements. The ☰ menu is unchanged for both roles. A seller's Telegram
   sale is scan → ✅ on the card → the review card → ✅ သိမ်း. The round-5 step machine is deleted with its tests;
   about two thirds of its screens are reused as the card's edit screens (map-core-commits 7.3).
10. **The laptop shows a basket as a basket.** The real Sheet needs no new column (GroupID, ReceiptNo, DueDay and
    CustomerID are on every row already; the Credits tab's Item follows `openCredits`). The simulator's Ledger tab gains
    a `Group` column (`🛍 1/3`) and its laptop a read-only Items tab, so the owner can judge R3 (type, count, price,
    cost) at a glance.

---

## 1. Screens

Only what the owner and the books need from each screen is fixed here; the seller-first design owns the layout.
Every screen writes through the core functions of section 3 and nothing else.

### 1.1 The app in `form` mode: the seller's home

`appRenderHome` (app/app_ui.js:484-505) gains a job row above the scanner, only when `saleFlow(ports) === 'form'`
(in `quick` the home is today's, byte for byte):

| Tile | Label | Opens | Writes |
|---|---|---|---|
| Sell | `ui_home_sell` NEW '🛒 ရောင်းမယ်' | the sale form, empty, its scanner running | `commitBasket` |
| New piece | `ui_home_new` NEW '🆕 ပစ္စည်းအသစ်' | the new-piece form at "scan the new tag" | `commitNewItem` |
| Restock | `btn_restock` '📦 ကုန်ရောက်' (core_messages.js:24) | the restock form, empty | `commitRestockGroup` |
| Expense | `btn_expense` '💸 ကုန်ကျ' (:160) | the expense form | `commitExpense` |

Below them, as today: the scanner, `ui_btn_keypad` '⌨️ နံပါတ် ရိုက်မယ်' (app_i18n.js:31), the six recent tiles
(`recentItems`, core_ledger.js:1708-1724; a tap goes through the same router), find, and the latest bot message (after
a Save: the sold card with undo and receipt). The ☰ menu stays for customers, reports, payments, deposits, accounts,
📏 and 📲 (core_bot.js:131-153). The shell ids stay (check_simulator.js:93 pins them).

**The router** (one path for the scanner, the tag keypad, a recent tile, a find result and the simulator's
`{op: 'open'}`): `appOpenTagId(id)` (app_ui.js:563-568) is unchanged and still sends `/start <id>` to the core; the
core's `openTag` decides (section 3.4) and, in `form` mode, calls `ports.ui.form(req)`. The app then:

- a form that takes tags is open (sale, restock): hand it the id (`basketAddItem` decides; a refusal is a toast and the
  form's message line);
- no form and `req.kind === 'newitem'` (a blank tag): open the new-piece form for that tag, camera next;
- no form and `req.kind === 'tag'` (a known own-shop tag): open the sale form with that line;
- the core itself shows the item card (no hook call) for a seller scanning another shop's tag, and answers
  `tag_not_found` '❓ Tag {id} ကို မတွေ့ပါ။' (:8) for an unknown one, as today.

### 1.2 The sale form (R2): the receipt it becomes

One screen, top to bottom: the lines (id · name, price, a count stepper for a SKU, the price editable, remove; a UNIQUE
line has no stepper), ➕ scan another, the buyer (one search field, recent buyers as chips, "new" reveals name and
phone), how paid (segmented: 💵 cash, each wallet, 🏛 bank, 💵+🏦 mixed; bank and mixed reveal the account, mixed the
transfer part), paid now (full / part; part reveals the amount and the promised day: the first three `saleDuePresets`
(core_bot.js:2331-2337), a date, ❓ not sure), the total, ONE ✅ သိမ်း. Defaults: count 1, cash, paid in full, no buyer;
a plain cash sale is scan, then Save.

What the form must show so the owner's books cannot be surprised (each is a `basketCheck` or `basketAddItem` code,
section 3.2):

| The form shows | Because | Code |
|---|---|---|
| the total = Σ line amounts, live | `basketTotals` is the function the write uses | — |
| a part payment needs a buyer: `sale_need_buyer` 'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်' (:438) | a nameless credit cannot be collected, and the server would accept it | `buyer` |
| a line with no price (a ⏳ pending piece) asks its price before Save | a zero line can make a total-0 group, which `saleGroupInfo` reads as voided (core_ledger.js:1171) | `price` |
| one-of-a-kind twice, another shop's tag, a blank tag, the 11th line: refused at the scan | one row per distinct item (basket map 3.3 rule 5); another shop's row quarantines the whole group as `scope` (core_sync.js:361-370, :419) | `twice`, `other_shop`, `blank`, `max` |
| a piece sold meanwhile: `sale_gone` '⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ' (:444) on its line, nothing written | Save re-reads every line | `gone` |
| how the cash will be booked when part-paid (a grey line under the total, from `basketAllocate`) | the day report and the customer card show cash per row | — |

After Save the form closes once `phone.commit` has resolved, and the home shows the core-rendered sold card (1.5). When
the buyer holds a free deposit and still owes, that card carries today's question (`credit_use_deposit`
'📥 {customer} ၏ စရံ {deposit} ကျပ် ရှိပါသည်။ သုံးမလား?', :100) with `CD|<g>|yes|p` / `CD|<g>|no|p`: the form never
decides about deposits, the core's existing `creditDeposit` does (it reads the group's owed, so a basket works).

### 1.3 The new-piece form (R3)

Opened by a blank tag (router) or the 🆕 tile then a scan. Camera first (`#photoInput`, routed to the form), then ONE
form: the photo, name (pre-filled with the AI name once the queued job has come back, else the placeholder
`'ပစ္စည်း ' + id` today's code writes, core_bot.js:2122), category chips (`CFG.CATEGORIES`, core_config.js:23), cost,
selling price (or ⏳ `btn_pending` '⏳ စျေး မသတ်မှတ်ရသေး', :48), the profit line, count (stepper, default 1), the
sample toggle (`btn_sample_on` '🧵 နမူနာ: ဟုတ်' / `btn_sample_off` '🧵 နမူနာ: မဟုတ်', :49-50), ✅ သိမ်း.

The profit line, shown whenever price ≥ 1 and cost is known: `item_lbl_profit` NEW
'📈 အမြတ် {profit} ကျပ် (အရင်းပေါ် {pct}%)' (25,000 on a cost of 12,000 reads "အမြတ် 13,000 ကျပ် (အရင်းပေါ် 108%)"). A
price below the cost adds `item_loss_warn` NEW '⚠️ ရောင်းစျေး က အရင်း ထက် နည်းနေပါသည်' and does not refuse (the owner
may sell at a loss). Count > 1 shows `item_lbl_count` NEW '🔢 {count} ထည်' and makes the piece a stock item.

### 1.4 Restock form and expense form (R4 "should")

- **Restock**: scan one or many tags (own shop, SKU only; a UNIQUE answers `restock_unique` NEW
  'ℹ️ {id} က တစ်ထည်တည်း ပစ္စည်းပါ · ကုန်ရောက် မမှတ်နိုင်ပါ', the rule of `cardKeyboard`, core_bot.js:219-224, which
  offers `R|` on a SKU only), a count each (stepper; `CFG.RESTOCK_PRESETS` [1, 5, 10, 20], core_config.js:20, as
  chips), ✅ သိမ်း. One group.
- **Expense**: the shop (owner only, `exp_ask_shop` '💸 ဘယ်ဆိုင် အတွက်လဲ?', :161), category chips from
  `expenseCategories` (core_ledger.js:271-275) with ➕ (`btn_add_cat` '➕ အမျိုးအစားအသစ်', :386; offline through
  `addListOptionByLabel`), the amount (`expensePresets` chips or typed), how paid (the sale's segmented control without
  mixed), the note (`exp_ask_note` '📝 မှတ်ချက် ရိုက်ပါ (ဥပမာ နေ့လယ်စာ ၃ ယောက်)', :165), ✅ သိမ်း. An amount of 0 is
  refused (today's `expenseAmount` rule, core_bot.js:2005-2011).

### 1.5 After Save: the sold card (one function for the app form and the Telegram card)

`basketReply(ports, groupId, customer, addedKey)` → `{text, kb}` in core_bot.js:

- **one line** (`info.rows.length === 1`): exactly today's `saleCardText` / `saleCardKeyboard`
  (core_bot.js:3194-3225), so every round-5 sold-card check that survives stays green, and so does the deposit
  question built from `saleCardText` (`creditDeposit`, core_bot.js:1791-1807);
- **a basket**: `basket_sold` NEW '✅ ရောင်းပြီး 🛍 {n} ခု · {qty} ထည် · {amount} ကျပ်', one line per row
  `basket_stock_line` NEW '{id} · {name} × {qty} · {amount} · လက်ကျန် {stock}', then the group lines exactly as
  `saleCardText` builds them (:3200-3216: `credit_done` / `cust_attached`, `split_done` / `method_done`,
  `sale_due_set`, `acct_detail_hint`). Keyboard: `saleCardKeyboard` unchanged (undo `U|g`, receipt `RC|g`, 💰 `PY|g`
  while owed, the 🔢 hint, 📱 for a buyer without a phone), or the deposit question of 1.2.

`saleCardText` itself gains the basket branch (it is what `creditDeposit` rebuilds the card from), and `basketReply`
adds the deposit question exactly as `saleCommit`'s tail does (core_bot.js:3177-3185). `basket_sold` keeps the
`sold_done` text up to its first `{` ('✅ ရောင်းပြီး'), which is what `saleSoldCard` tests (core_bot.js:2385-2386), so a
late tap never edits a basket's sold card into `expired`.

### 1.6 Telegram: the sale review card (R5, the sellers' backup)

Entry: the item card's ✅ (`S|<id>|n`, core_bot.js:211-234; `Q|` and `D|` too, 3.4). The card is ONE message showing
the whole sale with the defaults. It is edited in place on the tapped message while it has one line (a photo card:
caption edits, as in round 5), and sent as a NEW text message once a scan or a typed id adds a line (the scan is a user
message, and the actionable screen must stay the last bot message: a round-5 ground rule). A tap on an older card
message answers `expired` (round-5 `saleGuard` rule (b), reused).

The method line and the paid line are always shown, defaults included (💰 ငွေသား, paid in full): the card is the whole
sale. Text (three lines, part paid, mixed):

```
🛍 ၃ ခု · 83,000 ကျပ်                              basket_line NEW (a one-line card shows confirm_sale, :61, as round 5)
1. S1-0002 · လုံချည် ကချင် အပြာ × ၂ · 36,000      basket_card_line NEW
2. S1-0005 · ထမီ ဇင်းမယ် အဝါ × ၁ · 22,000
3. S1-0001 · ထမီ ချည်သား အနီ × ၁ · 25,000
👤 ဒေါ်မြင့် · +95 9 123 456 78                   customerLabel (core_bot.js:1590-1592)
💰 ငွေသား 40,000 · KBZPay 10,000                   sale_line_mixed (:440) / sale_line_method (:439)
ပေးပြီး 50,000 · ကျန် 33,000                       sale_line_paid (:441)
📅 ကျန် 33,000 · <date>                             sale_due_set (:442) / sale_due_none (:443), only while owed
ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်                 a basketCheck problem line, only after a refused Save
```

Keyboard (anchor `<a>` = the first item put in the basket; it stays the anchor if that line is removed, so slot 1 is
always an existing item and `ITEM_ACTIONS` keeps passing, core_bot.js:431, :452-454):

```
[1. S1-0002 × ၂] [2. S1-0005 × ၁] [3. S1-0001 × ၁]   SS|<a>|l|<itemId>               btn_line NEW '{n}. {id} × {qty}'
[➕ ပစ္စည်း ထပ်ထည့်]                                  SS|<a>|add                      btn_add_item NEW
[👤 ဝယ်သူ] [💰 ဘယ်လိုပေးလဲ]                           SS|<a>|b|open, SS|<a>|m|open    btn_customer (:140), btn_pay_how NEW
[💵 ယခု ပေးငွေ] [📅 ပေးမည့်ရက်]                       SS|<a>|p|open, SS|<a>|d|open    btn_paid_now NEW, btn_due NEW (📅 only while owed)
[✅ သိမ်း] [✖️ မလုပ်တော့]                             SC|<a>|ok, SS|<a>|z             btn_save (:344), btn_cancel (:32)
```

Sub-screens (each returns to the card; their last row is `[⏮ နောက်ပြန် → SS|<a>|card] [✖️ မလုပ်တော့ → SS|<a>|z]`):

| Sub-screen | Reused from round 5 (map-core-commits 7.3) | Returns |
|---|---|---|
| a line: SKU grid ၁..၉ `SS\|<a>\|q\|<id>\|<n>`, ✏️ `SS\|<a>\|qn\|<id>`, 💬 price `SS\|<a>\|pr\|<id>`, 🗑 `SS\|<a>\|rm\|<id>` | `saleQtyGrid` (:2534-2547), the `saleQtyTyped` bound, the `saleFromPrice` bound (price ≥ 1) | the card |
| ➕: "scan or type the next tag" | `basket_ask_tag` NEW | the card, as a new message after the scan |
| buyer, look-alikes, new name, phone | `saleScreenBuyer` / `Lookalikes` / `Name` / `Phone` (:2572-2609), the answers (:2827-2894) | the card |
| how paid, account, transfer part, a new account's kind | `saleScreenMethod` / `Account` / `BankPart` / `Kind` (:2615-2711), ➕ (:3031-3082) | the card |
| paid now: [✅ အကုန် {total}] [တစ်ဝက်] [၀] [✏️ အခြား] | `saleScreenPaid` (:2676-2691), its first button no longer committing | the card |
| the promised day: the presets, ✏️ a date, ❓ | `saleScreenDue` / `DueText` (:2694-2704), the `saleDuePick` / `saleDueTyped` bounds | the card |

Tap counts: a plain cash sale in Telegram is START + ✅ on the card + ✅ သိမ်း (`quick` keeps one tap). Byte budget: the
longest is `SS|S1-0002|m|<12-byte KEY>` = 25 bytes; `SS|S1-0002|q|S1-0005|9` = 22; `SS|S1-0002|b|C-1a2b3c4d` = 23.

### 1.7 Telegram: the new-piece review card (R5)

Blank tag → `new_tag` '🆕 Tag အသစ်ပါ ({id})။ ပစ္စည်းရဲ့ ဓာတ်ပုံ ပို့ပေးပါ။' (:9) as today → the photo → `handlePhoto`
builds the draft with `newItemDraft` (3.4) and, in `form` mode, sends the card as a TEXT message (the photo is the
user's, so no caption limit):

```
📸 ထမီ ပိုးထည် အစိမ်း · ထမီ                 photo_seen (:83)
💰 ရောင်းစျေး 25,000 ကျပ်                    item_lbl_price NEW     (or btn_pending '⏳ စျေး မသတ်မှတ်ရသေး')
🧵 အရင်း 12,000 ကျပ်                          item_lbl_cost NEW      (or item_lbl_cost_none NEW '🧵 အရင်း မသိသေး')
📈 အမြတ် 13,000 ကျပ် (အရင်းပေါ် 108%)        item_lbl_profit NEW    (only when both are known)
🔢 ၁ ထည်                                       item_lbl_count NEW
[18,000] [20,000] [25,000] [30,000]           P|<id>|<n>                 pricePresets (core_ledger.js:1754-1769), reused
[✏️ အခြား] [⏳ စျေး မသတ်မှတ်ရသေး]             P|<id>|other, P|<id>|pending    reused
[🧵 အရင်း] [⏭ ကျော်]                          C|<id>|other, C|<id>|skip       reused (skip = cost unknown)
[✏️ နာမည်] [🏷 အမျိုးအစား] [🔢 အရေအတွက်]     NI|<id>|n, NI|<id>|c, NI|<id>|q   btn_item_name / btn_item_cat NEW, btn_qty (:16)
[🧵 နမူနာ: မဟုတ်]                             PS|<id>                    reused
[✅ သိမ်း] [✖️ မလုပ်တော့]                     NS|<id>, Z
```

`P|`, `C|` and `PS|` keep their handlers; in a card state (`state.form === true`) they set the field and redraw the card
instead of moving to the next step. ✅ (`NS|<id>`, mutating) runs `commitNewItem` and then today's tail (`item_created`
'🆕 မှတ်ပြီးပါပြီ' + ' · ' + id, `notifyOwners` with `price_ask_owner` '⏳ {id} · {name} · စျေး သတ်မှတ်ပေးပါ' while the
price is pending, the item card; core_bot.js:2188-2194).

### 1.8 Telegram as the owner's channel; the seller menu

| Stays in Telegram for the owner | Where | Round 6 change |
|---|---|---|
| the 21:00 family summary | `sendDailySummary` (gas_main.js), `buildDailySummary` (core_ledger.js:1617-1682) | none in code: a basket counts as its rows (4.7) |
| reports and PDFs (day, month, stock, owed, customer statement) | `showReportMenu` (core_bot.js:2064), core_report.js | the ပစ္စည်း cell of the credit tables says `basket_name` (follows `openCredits`) |
| receipts `RC\|g`, `RCP\|g` | core_report.js:331-409 | none: already one line per basket line |
| price-pending pings with `SP\|` buttons | `notifyOwners` (core_bot.js:2221-2226); from a phone as outbox notices (app_ports.js:93-98) | the app's new-piece form sends them too, same text and buttons |
| server flags with the owner's `V\|` (stock below zero, overpaid, deposit over, conflict) | `syncFlagPing` (core_sync.js:634-637) | a flag on a basket adds `ping_basket_note` NEW (`V\|` voids every line) |
| 📲 the code that connects a phone, 📱 the phone list | `sendEnrollCode` / `showDevices` (core_bot.js:154-166) | none |
| 🏛 accounts, 👤 customers, 💰 payments, 📥 deposits, 🧵 orders, 📏 measurements | the ☰ menu (core_bot.js:131-153) | none |

**The seller's Telegram in `form` mode**: the ☰ menu is unchanged (the nine everyday buttons, then orders, notebook and
accounts, then 📲); the item card is unchanged; ✅ on it opens the review card; a blank tag ends in the new-piece card;
📦 `R|` restock and 💸 `M|exp` keep their chat flows (they are short, and they are the owner's too). `enrolledInApp` /
`sendAppCard` (core_bot.js:4470-4480, no caller) stay unwired: a seller whose phone has the app must still be able to
sell in Telegram when the app is down, which is the point of the backup.

### 1.9 What each mode shows where

| Job | `form`, app | `form`, Telegram | `quick`, both (round 4 as built) |
|---|---|---|---|
| sale | scan → the sale form → Save | card ✅ → review card → ✅ သိမ်း | card ✅ commits at once; corrective buttons |
| new piece | blank tag → camera → the new-piece form | photo → the new-piece card | photo → price → cost (core_bot.js:2134-2195) |
| restock | 📦 tile, or `R\|` on a card → the restock form | `R\|` → `RQ\|` presets | `R\|` → `RQ\|` |
| expense | 💸 tile, or ☰ `M\|exp` → the expense form | the three-tap chat flow | the three-tap chat flow |
| payment, deposit, return, transfer, orders, 📏 | the existing chat flows and screens | unchanged | unchanged |

---

## 2. Ledger and data

No column, tab or Settings key is added. The Ledger stays append-only; every write below is ONE `writeGroup`
(core_ledger.js:67-75: one lock, one outbox `group` entry on a phone, app/app_store.js:657-663).

### 2.1 `commitBasket(ports, p)`: the one write of a sale

`p = {lines: [{item, qty, unitPrice, priceChanged}], paid, method, bankPart, mixed, customerId, dueDay, note, staff,
source, transcript, updateId, when}`. In this order:

1. `when = p.when instanceof Date ? p.when : ports.clock.now()`, read once and passed to every `newTx` (today each
   `newTx` reads the clock, core_ledger.js:32, so a sale at 23:59:59 can put its rows on two Days).
2. Per line: `qty_i = max(1, round(qty_i || 1))`; `unit_i = nullish(unitPrice_i) ? Number(item.price) || 0 :
   Number(unitPrice_i)`; `amount_i = qty_i × unit_i`. `total = Σ amount_i`. An empty `lines` throws (a programming
   error; the checks of 3.2 never let it through).
3. The group: `paid = nullish(p.paid) ? total : clamp(round(p.paid), 0, total)`; `KEY = upper(p.method || CASH)`;
   `bankPart = (KEY === CASH || !p.mixed) ? 0 : clamp(round(p.bankPart), 0, paid)`; `cashPart = paid − bankPart`;
   `owed = total − paid`; `payKey = (p.mixed && bankPart === 0) ? CASH : KEY`; `twoRows = bankPart > 0 && cashPart > 0`.
   These are core_ledger.js:829-835 with `amount` replaced by `total`.
4. Allocation: `A = twoRows ? cashPart : paid`; `cash = basketAllocate([amount_i], A)` (2.3).
5. Per SALE row: `method_i = twoRows ? (cash_i ? CASH : '') : methodFor(payKey, cash_i)`;
   `groupNote = p.note || (twoRows ? 'split' : owed > 0 ? 'credit' : '')`; `note_i = groupNote || (priceChanged_i ?
   'price' : '')`; `dueDay_i = owed > 0 ? (p.dueDay || '') : ''`; `customerId` on every row; `costAtSale = item.cost`;
   `qty: −qty_i`; `refGroupId ''`; the transcript on the first row only.
6. When `twoRows`: ONE PAYMENT after all SALE rows: `itemId` = line 1's item, `qty 0`, `amount = cash = bankPart`,
   `method KEY`, `customerId`, `refGroupId = group`, note `'split'`, no dueDay (core_ledger.js:844-851's shape).
7. `writeGroup(ports, sales.concat(payment ? [payment] : []))`. Returns `{groupId, txs, sales, payment, owed, total}`.

`commitSaleGroup(ports, p)` becomes `commitBasket` with one line built from `p.item, p.qty, p.unitPrice,
p.priceChanged`, returning `{groupId, txs, sale: r.sales[0], payment, owed}` as today (core_ledger.js:854). For one line
every field of every row is the same as today's write except that the SALE and the PAYMENT now share one `time`
(they could differ by a millisecond before); no check compares them.

### 2.2 A basket × the seven round-5 outcomes

Example, from the seed (poc/sim_seed.js:38-46): line 1 S1-0002 × 2 at 18,000 = 36,000 (cost 9,000); line 2 S1-0005 × 1
= 22,000 (cost 11,000); line 3 S1-0001, one of a kind, 25,000 (cost 12,000). Total 83,000; buyer ဒေါ်မြင့် (C-0001);
promised day D. Rows in this order; cash and method per SALE row.

| # | Outcome (round-5 table, SPEC-round-5 2.2) | SALE cash 1 · 2 · 3 | SALE method 1 · 2 · 3 | Note (every SALE row) | DueDay | PAYMENT | Owed |
|---|---|---|---|---|---|---|---|
| 1 | cash, full | 36,000 · 22,000 · 25,000 | CASH ×3 | '' (a bargained line alone: 'price') | '' ×3 | — | 0 |
| 2 | wallet or bank (KBZ), full | 36,000 · 22,000 · 25,000 | KBZ ×3 | '' / 'price' per line | '' | — | 0 |
| 3 | one method, part now 30,000 | 30,000 · 0 · 0 | CASH · '' · '' | credit | D ×3 | — | 53,000 |
| 3b | one method, nothing now | 0 · 0 · 0 | '' ×3 | credit | D ×3 | — | 83,000 |
| 4 | mixed, full, KBZ 10,000 | 36,000 · 22,000 · 15,000 | CASH ×3 | split | '' | 10,000 KBZ, split | 0 |
| 5 | mixed, part 50,000 of which KBZ 10,000 | 36,000 · 4,000 · 0 | CASH · CASH · '' | split | D ×3 (not the PAYMENT) | 10,000 KBZ, split | 33,000 |
| 6 | mixed with cash part 0 (KBZ = paid = 30,000) | 30,000 · 0 · 0 | KBZ · '' · '' | credit | D ×3 | — | 53,000 |
| 7 | mixed with bank part 0 | as 1 (full) or 3 (part) | CASH by `payKey` | as 1 / 3 | as 1 / 3 | — | as 1 / 3 |

Pinned as in round 5: a date chosen with a full payment is dropped (rows 1, 2, 4); a bargained part sale carries
'credit', not 'price' (the group note wins). A one-line basket is the round-5 row of each outcome exactly.

### 2.3 The allocation rule and where DueDay goes

`basketAllocate(amounts, A)` (pure): walk the lines in order, `cash_i = min(amount_i, max(0, A − Σ cash_<i))`. It keeps
`Σ cash_i = A` exactly (whole kyat, no remainder to place) and `0 ≤ cash_i ≤ amount_i` (the invariant every writer keeps,
core_ledger.js:806, :829, :1058), so no row ever reads as overpaid on its own. Why this rule and not another, and why
every reader agrees with it: section 4. Rejected: proportional shares (every row an odd figure plus a remainder rule);
the delivery shape (cash 0 on every SALE row plus one PAYMENT for all money, core_orders.js:270, :289), which would turn
every fully paid cash basket into `ပေး 0` lines plus a separate ငွေလက်ခံ line on the customer card and the day report.

DueDay: the condition is group-level (`owed > 0` after the write) and the date goes on EVERY SALE row of the group.
"Only on the rows that owe" would leave the first row, the one `saleGroupInfo` reads (core_ledger.js:1166, :1170), dated
blank under fill-in-order, and the credit would lose its date in Credits, the 21:00 line, the receipt and the sold card.
`saleGroupInfo` also returns the first non-blank dueDay of its live rows (then of all its SALE rows), so a future writer
that dates one row only still keeps the date; for every group written so far the result is the same (one SALE row, or a
rewrite whose replacement copies the date, core_ledger.js:1074).

### 2.4 Receipt numbers

- Telegram rows carry no ReceiptNo; `receiptNumber` counts SALE groups per shop (core_ledger.js:1729-1752): a basket
  is one group, one number, already.
- A phone: `appendLedger` stamps a SALE row that is not a mirror and has no number; inside a collector run (one
  `lock.run`, app/app_store.js:655-663) a later SALE row of the same group copies the first one's number instead of
  taking `++receiptCounter`. Same rule in poc/sim_phone.js:121-126. The PAYMENT never carries one (run_app.js:967 still
  holds). The counter stays gap-free per phone (the comment at app_store.js:295).

### 2.5 A counted new piece

`commitNewItem` (3.2) writes, for tag S1-0007 registered with count 3, price 25,000, cost 12,000:

| Where | Written |
|---|---|
| Items (`updateItem`, one outbox `item` entry on a phone, app/app_store.js:286-293) | name, category, **type SKU** (count 1: UNIQUE), price 25000 ('' when ⏳), cost 12000 ('' when unknown), sample, photoUrl, photoFileId, createdAt, createdBy |
| Ledger: one group, ONE row | RESTOCK, itemId S1-0007, **qty +3**, amount 0, cash 0, note 'new item' ('new sample' with the sample toggle), source PHOTO |
| Owner (only while the price is pending) | `notifyOwners(price_ask_owner, priceButtons)` (core_bot.js:2193, :2197-2200); on a phone an outbox notice, relayed after the item and the group (push order customer, item, list, group, measurement, notice: core_sync.js:75) |

Readers: the stock is the sum of the rows (3); `lowStockList` (core_ledger.js:1610-1615) may list it the same evening
when 3 ≤ `low_stock_threshold`, which is right; the card offers `S|id|1` plus 🔢 and `R|` (a SKU card,
core_bot.js:227-231); every later sale writes `costAtSale = item.cost` (core_ledger.js:840), so the 21:00 profit is
right from the first sale; with cost unknown it counts in `summary_nocost` '   (ကုန်ကျစရိတ် မသိသေးသော {n} ထည် ပါ)'
(:206) as today.

### 2.6 Restock of several tags

`commitRestockGroup` writes one RESTOCK row per line in line order (qty +n, amount 0, cash 0, note '', source FORM) in
ONE group: one undo (`undoGroup` mirrors every live row, core_ledger.js:1004-1013), one outbox entry. Every reader of a
RESTOCK row reads it per row (stock, `recentItems`, `dayReport`); none sums RESTOCK by group, so nothing else changes.

### 2.7 An expense

`commitExpense` as today (core_ledger.js:882-890): one EXPENSE row, amount and cash `−|amount|`, category key, method,
**the note in the same write** (the Telegram path adds it later as a rewrite, core_bot.js:2050-2062), source FORM.

### 2.8 Customers

A buyer typed as new in a form or on the card becomes a Customers row only at Save (`saleResolveBuyer`,
core_bot.js:3140-3148: an exact name match meanwhile is used, never duplicated). On a phone the `customer` entry is
queued before the group (push order, core_sync.js:75); on the Sheet it is its own `gasLocked` write just before the
group, the window round 5 accepted (SPEC-round-5 2.6).

### 2.9 Settings, CFG, sources

| Item | Today | Round 6 |
|---|---|---|
| Settings `sale_flow` | `steps` \| `quick`, default `steps` (core_config.js:208-210; seed gas_setup.js:76) | `form` \| `quick`, default `form`; any value but `quick` reads `form` |
| `CFG.SALE_FLOW` (core_config.js:111) | `{ STEPS: 'steps', QUICK: 'quick' }` | `{ FORM: 'form', QUICK: 'quick' }` (no code outside gas_setup.js:76 and core_config.js:209 names `STEPS`; grep) |
| `CFG.BASKET_MAX_LINES` | — | NEW `10`: the lines of one sale or one restock (11 sheet appends under one 15 s lock on GAS, gas_main.js:67-73; ten line buttons fit four keyboard rows) |
| `CFG.SOURCE` (core_config.js:35) | BUTTON, VOICE, PHOTO, TEXT, UNDO, SYSTEM, NOTEBOOK, IMPORT | + `FORM: 'FORM'` for the app's sale, restock and expense forms (the server accepts any string, core_sync.js:384; nothing enumerates `CFG.SOURCE`). The new-piece form writes PHOTO, as Telegram does; the review card writes BUTTON |
| the per-device pref `setting:sale_flow` | app_store.js:341-344 | unchanged: a phone can still be put on `quick` alone |

---

## 3. Core functions

Every new global below was grepped across `apps-script/`, `app/`, `poc/`, `tools/` (dist excluded) on 2026-11-12 and is
free: `basketAllocate, basketTotals, basketAddItem, basketCheck, saleDueKey, commitBasket, newItemDraft, itemMargin,
commitNewItem, commitRestockGroup, describeGroup, startBasket, basketCardText, basketCardKeyboard, basketCallback,
basketText, basketSave, basketReply, newItemCardText, newItemCardKeyboard, newItemCallback, newItemSave, customerLines,
formUi, BASKET_MAX_LINES`, the app's `appOpenForm, appOnForm, appSale*, appItem*, appRestock*, appExpense*,
appFormDraft*`, the CSS classes `.bchip`, `.over-form`, the ids `saleForm, itemForm, restockForm, expenseForm`, the
callback prefixes `NI|`, `NS|`, and every key of 3.6. ES5, one global scope, no new apps-script file (R9).

### 3.1 core_config.js

- `CFG.SALE_FLOW`, `CFG.BASKET_MAX_LINES`, `CFG.SOURCE.FORM` (2.9).
- `saleFlow(ports)` (:207-210): `return String(ports.store.getSetting('sale_flow', CFG.SALE_FLOW.FORM) ||
  '').trim().toLowerCase() === CFG.SALE_FLOW.QUICK ? CFG.SALE_FLOW.QUICK : CFG.SALE_FLOW.FORM;` (its comment: "'quick'
  for the word quick in any case, else 'form' (the default; the round-5 value steps reads as form)").

### 3.2 core_ledger.js (it calls nothing of core_bot.js, :25-26)

New:

```
basketAllocate(amounts, atSaleCash) -> [cash_i]                                   // pure, 2.3
basketTotals(lines, pay) -> {amounts, total, paid, cashPart, bankPart, owed, twoRows, payKey, cash: [..], methods: [..], note}
   // pure: 2.1 steps 2-5 without rows; lines = [{qty, unitPrice, priceChanged, price}], pay = {paid, method, mixed, bankPart}
   // (price = the item's price, used when unitPrice is null). The form's total, the card's text and commitBasket all call it.
basketAddItem(ports, staff, lines, itemId, qty) -> {ok: true, lines, index} | {ok: false, reason, index}
   // reads only; reason 'missing' | 'blank' | 'other_shop' | 'gone' | 'twice' | 'max'. The basket's shop = line 1's shop
   // (a seller: staff.shop); a UNIQUE with stock <= 0 is 'gone'; a UNIQUE already in the basket 'twice'; the same SKU raises
   // that line's count (capped at CFG.MAX_SALE_QTY); the 11th distinct item 'max'. A pending-price item is ACCEPTED with
   // unitPrice null and needPrice true.
basketCheck(ports, staff, draft) -> {ok, problems: [{code, itemId}]}
   // the Save-time re-check shared by the app form and the Telegram card: every line re-read ('missing', 'gone' for a sold
   // UNIQUE, 'other_shop'); unitPrice resolved >= 1 ('price'); qty 1..MAX_SALE_QTY ('qty'); a part payment needs
   // customerId or newName ('buyer'); mixed: 1 <= bankPart <= paid ('bank'); paid 0..total ('paid'); methodKnown ('method');
   // dueDay '' or today..today+SALE_DUE_MAX_DAYS ('due'). Nothing is written.
saleDueKey(today, choice) -> 'yyyy-mm-dd' | '' | null
   // pure: a number of days 0..SALE_DUE_MAX_DAYS -> addDaysKey(today, n); 'none' -> ''; a typed text ->
   // parseDayText(text, <noon of today>, {noRoll: true}) within today..+SALE_DUE_MAX_DAYS; else null (refused). The bounds
   // of saleDuePick / saleDueTyped (core_bot.js:2997-3001, :3012-3013) in one place; both handlers call it.
commitBasket(ports, p) -> {groupId, txs, sales, payment, owed, total}             // 2.1
itemMargin(price, cost) -> {profit, pct} | null
   // pure: null unless price >= 1 and cost is a number >= 0; profit = price - cost; pct = cost > 0 ? round(100 * profit / cost)
   // : null (on cost: the label says အရင်းပေါ်).
commitNewItem(ports, p) -> {ok: true, item, groupId} | {ok: false, reason}
   // p = {itemId, name, category, price ('' = pending), cost ('' = unknown), count, sample, photoUrl, photoFileId, staff,
   // source, updateId, when}; reason 'missing' | 'not_blank' | 'count' | 'price' | 'cost' (count 1..MAX_SALE_QTY; price
   // and cost '' or whole numbers >= 0; a price of 0 is stored as '' = pending, as isPricePending reads it). An empty name
   // becomes 'ပစ္စည်း ' + id (the app's AI replay renames only that, app/app_sync.js:390); a category outside CFG.CATEGORIES
   // becomes the last one. Writes 2.5 (updateItem, then ONE commitRestock with qty = count) and returns the fresh item;
   // the caller (core_bot.js newItemSave, the app's appItemSave) tests isPricePending (core_bot.js:181-183, which
   // core_ledger.js may not call) and sends notifyOwners.
commitRestockGroup(ports, p) -> {groupId, txs} | {ok: false, reason}
   // p = {lines: [{item, qty}], note, staff, source, updateId, when}; refuses an empty list, a qty outside 1..MAX_SALE_QTY,
   // a UNIQUE line, more than BASKET_MAX_LINES lines; one clock read; one RESTOCK row per line; one writeGroup.
```

Changed:

| Function (line) | Change |
|---|---|
| `commitSaleGroup` (:824-855) | the wrapper of 2.1; its doc comment says so |
| `saleGroupInfo` (:1152-1176) | `dueDay` = the first non-blank of `live`, then of `saleRows` (2.3); NEW field `lines: live.length` (callers may read `rows.length` already) |
| `openCredits` (:1253-1256) | when `info.rows.length > 1` and `!isOrderId(groupId)`: `itemName = t(ports, 'basket_name', {n: fmtCount(n), names})` with `names` = the live rows' item names joined by ', ', cut at 40 characters with '…' (a delivery keeps its 'N ကြောင်း' prefix) |
| `customerHistory` (:1384-1389) | unchanged (it keeps returning rows; its one caller is the customer card, core_bot.js:1689); the collapsing is the NEW core_bot.js helper `customerLines` (3.4) |
| `undoGroup` (:992-1017) | unchanged (mirrors every live row; returns `itemId: rows[0].itemId` and `types`); the reply changes in core_bot.js |

Unchanged and why: `writeGroup`, `newTx` (the single read is `commitBasket`'s `when`), `groupMethods` (sums per row
method), `receiptNumber` (2.4), `rewriteCheck` (a basket is `complex`, every corrective path refuses it, as D3 of round 5
wants), `commitPayment` / `applyDeposit` (group owed; they copy line 1's itemId, as the delivery does), `dayStats` /
`monthStats` / `buildDailySummary`, `customerSummaryMap` (the buyer is on every row), `lastLiveSale`, `recentItems`,
`importProducts`, `commitSale`, `commitRestock`, `commitExpense`.

### 3.3 core_report.js

- NEW `describeGroup(ports, txs) -> string` beside `describeRow` (:91-99): with more than one live SALE row:
  `txLabel(SALE) + ' ' + t(ports, 'basket_line', {n, amount})` + (customer ? ' · 👤 ' + name : ''); with more than
  one live RESTOCK row: `t(ports, 'restock_basket_done', {n, qty})`; else `describeRow(ports, live[0] || txs[0])`
  (so a one-row group's wording is today's; run_app.js:248-249 stays green).
- `buildReceipt` / `receiptText` / `receiptReport` (:331-409), `dayReport` (:169-198), the three credit tables (:227-230,
  :280-282, :311-320), `customerReport` (:265-290): unchanged (they print one line per row and sum the group; the
  credit tables follow `openCredits`).

### 3.4 core_bot.js

**Mode and hook**

```
formUi(ports) -> boolean      // !!(ports.ui && typeof ports.ui.form === 'function') && saleFlow(ports) === CFG.SALE_FLOW.FORM
```

`ports.ui.form(req)`: `req = {kind: 'tag' | 'newitem' | 'restock' | 'expense', itemId, qty, chatId, uid, staff}`. The
core calls it and sends nothing itself; the app opens or feeds the form (the `startMeasureFor` precedent, :4198-4199,
which also clears the core state first).

**Entry points that change**

| Where (line) | Today | Round 6 |
|---|---|---|
| `openTag` (:105-129) | order_tag, order line, BLANK → `new_item` state + `new_tag`; else clear the state and the card | after the two order branches: (a) a live basket of this user (`saleStateOf(ports, uid)` with `form: true`) and Telegram: `basketAddItem` → the card as a NEW message (a refusal line above it, the basket kept; a blank tag answers `basket_blank` and keeps the basket); (b) `formUi`: BLANK → `clearState`, `ports.ui.form({kind: 'newitem', itemId})`; a known item that a seller may sell (own shop, or the owner) → `ports.ui.form({kind: 'tag', itemId})`; (c) BLANK in Telegram: the state gains `form: saleFlow(ports) === 'form'`, text as today; (d) everything else as today |
| `handleCallback` tap guard (:446) | `S` exempt while `steps` | `S` exempt while not `quick` (S writes nothing in `form`) |
| case `S` (:463-471) | `steps` → `startGuidedSale` | `form`: `formUi` → `ports.ui.form({kind: 'tag', itemId, qty})`, else `startBasket(sctx, item, clampQty(arg))`; `quick` as today |
| case `Q` (:472-480) | `steps` → the grid as a flow screen | `form`: `startBasket` then the line's count sub-screen (Telegram), or the hook (app) |
| case `QN` (:482-491), case `D` (:493-506) | `steps` branches | `form`: `startBasket` then the typed count / the price prompt of that line; the `steps` branches are deleted |
| case `R` (:513-517) | the presets | `formUi` → `ports.ui.form({kind: 'restock', itemId})`; else as today |
| `startExpense` (:1939-1949) | the chat flow | `formUi` → `ports.ui.form({kind: 'expense'})`; else as today |
| case `SS` / `SC` (:511-512) | `saleCallback` / `saleCommit` | `basketCallback` / `basketSave` |
| NEW cases `NI`, `NS` | — | `newItemCallback` / `newItemSave`; `NI` and `NS` join `ITEM_ACTIONS` (:431), `NS` joins `MUTATING_ACTIONS` (:435-436) |
| case `P`, `C`, `PS` (via `newItemPrice` :2154-2170, `newItemCost` :2172-2195, `toggleSample` :2145-2152) | move the step on | with `state.form`: set the field, redraw the card (`editOrSend` on the tapped message; a typed answer: a new message) |
| `handlePhoto` (:2095-2132) | the draft, then `priceScreen` | the draft from `newItemDraft`; `state.form` → `newItemCardText`/`Keyboard` as a new message; else `priceScreen` as today |
| `applyAwaitedNumber` (:765-820) | `sale_price`, `sale_qty`, `sale_step` purposes | the same purposes, keyed on the basket line (`state.line`) and returning to the card; NEW purposes `item_name` (text), `item_count`, `item_price`, `item_cost` for the new-piece card |
| `handleText` (:701-735) | `saleText` first | `basketText` first (the same rule: a phone number parses as a number); a typed tag id while a basket lives goes to `openTag`'s branch (a) |
| `handleIntent` (:822-934) | six routing lines into the guided steps | the same lines into the open sub-screen; the clash rule (`saleIntentClashes`) checks every basket line |
| `confirmProposal` (:1129-1130) | a spoken sale of the piece clears the live flow | the same, for a piece that is a line of the live basket |
| `askAddOption` / `finishAddOption` (:1491-1500, :1533) | resume `SSA` | resume `SSA` returns to the how-paid sub-screen of the card |

**The basket state** (`st:<uid>`, `STATE_TTL_SEC` 1800 s, core_config.js:11):

```
{ kind: 'sale', form: true, item: <anchor id>, msgId, step: 'card' | 'line' | 'buyer' | 'name' | 'phone' | 'method' | 'account'
  | 'bank' | 'paid' | 'due' | 'due_text' | 'kind' | 'add', line: <itemId of the open line>, acct,
  draft: { lines: [{id, qty, unitPrice (null = the item's price), priceChanged}], customerId, newName, newPhone, method, mixed,
           bankPart, paid (null = all), dueDay, addLabel, addedKey } }
```

`hist` is gone. The typed prompts keep wrapping it as `{kind: 'await_number', purpose, saved}` and ➕ as
`{kind: 'await_text', purpose: 'add_option', resume: {a: 'SSA', args: [<anchor>]}, saved}`, so `saleStateOf`
(:2340-2347) reads through them unchanged.

**The new-piece card state**: today's `{kind: 'new_item', itemId, step, draft}` (:123) plus `form: true` and
`draft.count` (default 1), `step: 'card'` after the photo.

**Callbacks** (64-byte rule; `<a>` = the anchor, `<id>` = a line's item, both like `S1-0002`):

| Data | Bytes (max) | Does | Commits |
|---|---|---|---|
| `SS\|<a>\|card` | 15 | back to the card from any sub-screen | no |
| `SS\|<a>\|l\|<id>` | 21 | a line's sub-screen | no |
| `SS\|<a>\|q\|<id>\|<1..9>` · `qn\|<id>` · `pr\|<id>` · `rm\|<id>` | 22 | the line's count, typed count, price prompt, remove | no |
| `SS\|<a>\|add` | 14 | the "scan or type the tag" prompt | no |
| `SS\|<a>\|b\|open` · `none` · `new` · `create` · `<custId>` | 23 | buyer (round-5 letters, exits to the card) | no |
| `SS\|<a>\|ph\|skip`, `m\|…`, `a\|…`, `x\|half`, `p\|open` · `all` · `half` · `0` · `other`, `d\|open` · `<n>` · `type` · `none`, `k\|…` | 25 | round-5 letters, exits to the card | no |
| `SS\|<a>\|z` | 12 | cancel: the anchor's item card (round-5 `saleCancel`) | no |
| `SC\|<a>\|ok` | 13 | Save (`basketSave`) | **yes** (already in `MUTATING_ACTIONS`) |
| `NI\|<id>\|n` · `c` · `c\|<0..4>` · `q` · `q\|<1..9>` · `q\|t` · `card` | 15 | the new-piece card: name prompt, category sub-screen and pick, count grid / typed, back | no |
| `NS\|<id>` | 10 | Save the new piece | **yes** |
| `P\|<id>\|…`, `C\|<id>\|…`, `PS\|<id>` | existing | as today; in a card state they redraw the card | no |

**Functions**

| Function | Verdict | Does |
|---|---|---|
| `startBasket(ctx, item, qty)` | NEW (replaces `startGuidedSale` :2393-2406; keeps its sold-meanwhile and identical-tap rules) | `basketAddItem` on an empty basket; the state; the card edited onto the tapped message (`editOrSend` with `ctx.isCaption`) |
| `basketCardText(ports, state)` / `basketCardKeyboard(ports, state)` | NEW (the body of `saleHeader` :2506-2526 generalised) | 1.6 |
| `basketCallback(ctx, parts, item, message)` | NEW (replaces `saleCallback` :2723-2748) | `saleGuard` (adapted: rule (c) compares the open sub-screen), then the letter's handler; every exit redraws the card |
| `basketText(ctx, state, text)` | ADAPT of `saleText` (:3111-3137) | typed answers by the open sub-screen |
| `basketSave(ctx, item, message)` | NEW (replaces `saleCommit` :3155-3187) | `saleGuard`; `basketCheck` (refused: the card again with the problem lines, nothing written); `saleResolveBuyer`; `commitBasket`; `setLastItem` (line 1), `setLastGroup`, `clearState`, `markCommittedCard`; `basketReply` edited onto the tapped message |
| `basketReply(ports, groupId, customer, addedKey)` | NEW (the tail of `saleCommit` :3177-3185) | 1.5; used by `basketSave` and by the app |
| `saleCardText(ports, groupId, addedKey)` (:3194-3217) | ADAPT | the basket branch of 1.5 when `info.rows.length > 1`; one row: unchanged |
| `newItemDraft(ports, itemId, desc, draft)` | NEW (the lines :2122-2125 of `handlePhoto`) | `{name, category, price, cost, count: 1, sample, photoUrl, photoFileId}` |
| `newItemCardText(ports, state)` / `newItemCardKeyboard(ports, state, staff)` / `newItemCallback(ctx, parts, item)` / `newItemSave(ctx, item)` | NEW | 1.7; `newItemSave` = `commitNewItem`, then the tail of `newItemCost` (:2188-2194) |
| `newItemCost` (:2172-2195) | ADAPT | its write becomes `commitNewItem(count 1)` (quick: the same Items fields and the same RESTOCK row as today) |
| `cardText` (:180-210) | ADAPT | the buyer line of a sold UNIQUE: `card_buyer_basket` when the group has more than one live SALE row (4.10) |
| `case 'U'`, `case 'V'` replies (:541-560) | ADAPT | when `u.types` (core_ledger.js:1016) holds more than one SALE, or more than one RESTOCK: `undo_done` / `void_done` + one `basket_undo_line` per item ('{id} · {name} · လက်ကျန် {stock}') instead of the first item's card; a mixed one-item sale (SALE + PAYMENT) keeps today's reply |
| `customerCard` (:1681-1702) | ADAPT | the lines come from NEW `customerLines(ports, customerId, n)`: `customerHistory(ports, id, 0)`, SALE rows of one group with more than one SALE row collapsed into ONE `cust_line` (desc `txLabel(SALE) + ' 🛍 ' + n + ' ခု'`, amount Σ, `cust_line_paid` with Σ cash when it differs, the method of the rows that carry cash), a PAYMENT or DEPOSIT_APPLIED that references such a group described 'ငွေလက်ခံ 🛍 {n} ခု' / its own type label; then the first n entries (`CFG.CUST_HISTORY_LINES` 8) |
| `saleDuePick` / `saleDueTyped` (:2993-3025) | ADAPT | call `saleDueKey`; exit to the card |
| `saleGo`, `saleNext`, `saleBuyerScreen`, `saleBack`, `SALE_BACK_CLEARS`, `SALE_STEP_OF`'s `back`, `saleScreenSummary` as a step, the committing button of `saleScreenPaid`, the `steps` branches of `Q`/`QN`/`D` and their `applyAwaitedNumber` twins, `startGuidedSale` | DEAD | deleted with their checks (section 8) |
| `saleCtx`, `saleShownId`, `saleDuePresets`, `saleStateOf`, `saleTotal`→`basketTotals`, `saleSoldCard`, `saleRedraw`, the screens of 1.6, `saleCancel`, `saleResolveBuyer`, `saleKindPick` / `saleAddNamed` / `saleAccountResume`, `saleCardKeyboard` | REUSE / ADAPT as map-core-commits 7.3 says | — |

The header legend (:20-31) replaces its `SS|`/`SC|` lines with the card's letters and adds `NI|`, `NS|`.

### 3.5 core_sync.js

- `syncFlagText` (:616-631): when `flag.groupId` names a group with more than one live SALE row on the server
  (`saleGroupInfo(ports, flag.groupId)`), append `'\n' + t(ports, 'ping_basket_note', {n})`. Nothing else: the
  validation, the scope rule, the flags and `syncSettingsQuick` (:1489-1494, it already writes `CFG.SALE_FLOW.QUICK`)
  are unchanged; `SYNC.CAPS` stays `['dueDay']` (:85).
- `SYNC_MSG` (:92-130) gains `ping_basket_note`.

### 3.6 Messages

core_messages.js `MSG`, added in step 1 (drafts composed from words already in MSG; the source key is given):

```
basket_line: '🛍 {n} ခု · {amount} ကျပ်'
basket_name: '🛍 {n} ခု · {names}'
basket_card_line: '{n}. {id} · {name} × {qty} · {amount}'
basket_sold: '✅ ရောင်းပြီး 🛍 {n} ခု · {qty} ထည် · {amount} ကျပ်'
basket_stock_line: '{id} · {name} × {qty} · {amount} · လက်ကျန် {stock}'
basket_undo_line: '{id} · {name} · လက်ကျန် {stock}'
basket_ask_tag: '📷 နောက် Tag ကို scan လုပ်ပါ · ဒါမှမဟုတ် နံပါတ် ရိုက်ပါ (ဥပမာ S1-0042)'
basket_twice: 'ℹ️ {id} ထည့်ပြီးသားပါ'
basket_other_shop: '⚠️ {id} · {shop} ၏ ပစ္စည်းပါ · မထည့်ပါ'
basket_blank: '❓ {id} က Tag အသစ်ပါ · အရင် ပစ္စည်းအသစ် မှတ်ပါ'
basket_max: 'ℹ️ တစ်ကြိမ်မှာ ပစ္စည်း {max} ခု အထိ'
basket_need_price: '⏳ {id} · စျေး ရိုက်ပါ'
card_buyer_basket: '👤 {customer} · 🛍 {n} ခု · ပေးပြီး {paid} · {method}'
btn_line: '{n}. {id} × {qty}'
btn_add_item: '➕ ပစ္စည်း ထပ်ထည့်'
btn_remove_line: '🗑 ဖယ်'
btn_pay_how: '💰 ဘယ်လိုပေးလဲ'
btn_paid_now: '💵 ယခု ပေးငွေ'
btn_due: '📅 ပေးမည့်ရက်'
btn_item_name: '✏️ နာမည်'
btn_item_cat: '🏷 အမျိုးအစား'
btn_item_cost: '🧵 အရင်း'
item_lbl_price: '💰 ရောင်းစျေး {price} ကျပ်'
item_lbl_cost: '🧵 အရင်း {cost} ကျပ်'
item_lbl_cost_none: '🧵 အရင်း မသိသေး'
item_lbl_profit: '📈 အမြတ် {profit} ကျပ် (အရင်းပေါ် {pct}%)'
item_lbl_count: '🔢 {count} ထည်'
item_loss_warn: '⚠️ ရောင်းစျေး က အရင်း ထက် နည်းနေပါသည်'
item_ask_count: '🔢 ဘယ်နှစ်ထည် ရှိလဲ?'
restock_basket_done: '📦 ကုန်ရောက် {n} မျိုး · {qty} ထည်'
restock_unique: 'ℹ️ {id} က တစ်ထည်တည်း ပစ္စည်းပါ · ကုန်ရောက် မမှတ်နိုင်ပါ'
settings_note_sale_flow: 'form = တစ်မျက်နှာတည်း ဖြည့်ပြီး သိမ်း · quick = ခလုတ်တစ်ချက် ရောင်း'      (REWORDED; today :448)
```

| Key | Source words |
|---|---|
| `basket_line`, `basket_name`, `card_buyer_basket` | the basket map section 4; `ord_list_title` :289 ('{n} ခု'), the 🛍 of `cust_card` :152, `card_buyer` :156 |
| `basket_card_line`, `btn_line` | `ord_line` '{n}. {desc} × {qty} · {amount}' :231, `receipt_line` :121 |
| `basket_sold` | `sold_done` :52 (its prefix is kept for `saleSoldCard`) |
| `basket_stock_line`, `basket_undo_line` | `receipt_line` :121, `card` :10 ('လက်ကျန်') |
| `basket_ask_tag` | `scan_first` :74 ('scan လုပ်'), `help` :90 ('ဥပမာ S1-0042'), `menu` :89 ('ဒါမှမဟုတ်') |
| `basket_twice` | `add_exists` :392 ('ရှိပြီးသား'), `ord_line_popped`; `basket_other_shop`: `ord_other_shop` 'ℹ️ {shop} ၏ အော်ဒါပါ · ကြည့်ရှုသာ' :286 |
| `basket_blank` | `new_tag` :9 ('Tag အသစ်ပါ'), `tag_not_blank` :322 |
| `basket_max`, `basket_need_price` | `bad_qty` :20 ('အတွင်း'), `card_pending` :12, `ask_sale_price` :82 |
| `btn_pay_how` | `sale_ask_method` :432 without '?' |
| `btn_paid_now` | `sale_ask_paid` :435 ('ယခု ပေးငွေ') |
| `btn_due` | the round-5 report column header `ပေးမည့်ရက်` (core_report.js) |
| `item_lbl_*`, `item_loss_warn`, `btn_item_*` | R3's words အရင်း, ရောင်းစျေး, အမြတ် (as in `today_query` :87); `photo_seen` :83; `ask_name` :80; `btn_add_cat` :386 ('အမျိုးအစား') |
| `item_ask_count` | `ask_restock_qty` '📦 ဘယ်နှစ်ထည် ရောက်လဲ?' :81 |
| `restock_basket_done` | `restock_done` :53 |
| `restock_unique` | `tag_not_blank` :322 ('မဟုတ်ပါ'), 'တစ်ထည်တည်း' NEW word for the owner to confirm |

Rule check (round-5 ground rule; run_lists.js:919-921 and run_wizard.js step 23 check it over their own keys): no
`btn_*` above contains `ငွေသား`, `KBZPay`, `WavePay` or `ဘဏ်လွှဲ`, and none starts with `🏦 `. `basket_name` is
cut by the code, not by the template.

core_sync.js `SYNC_MSG`: `ping_basket_note: 'ℹ️ 🛍 {n} ခု ပါသော အရောင်းပါ · 🚫 ပယ်ဖျက်ရင် အကုန် ပြန်ဖျက်ပါမည်'`
(`ping_stock_negative` :126, `btn_void` '🚫 ပယ်ဖျက် (ဆိုင်ရှင်)' :189).

app/app_i18n.js `APP_MSG` (app chrome; the seller-first design may rename): `ui_home_sell` '🛒 ရောင်းမယ်',
`ui_home_new` '🆕 ပစ္စည်းအသစ်', `ui_sale_add` '➕ Tag ထပ်ဖတ်', `ui_sale_total` 'စုစုပေါင်း {total} ကျပ်'
(`ord_total` :233), `ui_sale_alloc` NEW 'ပေးငွေ: {list}' (the grey allocation line of 1.2, e.g. 'ပေးငွေ: S1-0002 36,000 · S1-0005 4,000'; optional, the seller design decides),
`ui_form_name` 'ပစ္စည်း အမည်', `ui_form_ai_wait` '⏳ ဓာတ်ပုံကို စစ်နေသည် · အမည်ကို ကိုယ်တိုင် ရိုက်လည်း ရပါသည်',
`ui_form_saving` '⏳ သိမ်းနေသည်…' (map-app-forms 12). Reused verbatim: `ui_meas_save` '✅ သိမ်း' (:147),
`ui_btn_close` '✖️ ပိတ်' (:37), `ui_meas_close_ask` 'ရိုက်ထားတာတွေ မသိမ်းဘဲ ပိတ်မလား?' (:149), `ui_btn_photo`
'📸 ဓာတ်ပုံ' (:65), `ui_keypad_qty` '🔢 အရေအတွက်' (:33), `ui_not_saved` (:58).

No MSG key is deleted: run_gas.js:1498 (the Messages tab holds the 25 round-5 keys, `R5_KEYS` :1441-1444) and
run_wizard.js:1619 still require them; a round-5 key the card no longer shows stays a harmless Messages row.

---

## 4. Readers: why every reader agrees with a basket

The verdicts of the basket map (section 2 there) for a group written by 2.1 (buyer on every row, DueDay on every SALE
row, PAYMENT last, one receipt number, one row per distinct item), with the example of 2.2 row 5 (83,000; paid 50,000
= 40,000 cash on rows 1-2 and 10,000 KBZ; owed 33,000; date D; ဒေါ်မြင့်).

| # | Reader (file:line) | What it reads | The example basket gives | Change |
|---|---|---|---|---|
| 4.1 | `saleGroupInfo` (core_ledger.js:1152-1176) | sums all SALE rows, the group's DEPOSIT_APPLIED, PAYMENT by refGroupId; row 1 for itemId, customer, dueDay, method | total 83,000, cash 40,000, payments 10,000, owed 33,000, customer C-0001, dueDay D, method CASH, `rows.length` 3 | dueDay insurance + `lines` (3.2) |
| 4.2 | `openCredits` + the Credits tab (gas_store.js:710-716) + the simulator's Credits (poc/sim_ui.js:866-878) | the pre-pass sums per group, then `saleGroupInfo` | ONE entry: owed 33,000, dueDay D, overdue after D, item '🛍 ၃ ခု · လုံချည် ကချင် အပြာ, ထမီ ဇင်းမယ် အဝါ, …', ItemID S1-0002 | `basket_name` (3.2); the Sheet's 15 columns unchanged |
| 4.3 | `creditOverdue` (:1214-1216) | dueDay, days, today | D-based | none |
| 4.4 | `buildReceipt` / `receiptText` / `receiptReport` (core_report.js:331-409), the server's `api=report kind=receipt` (core_sync.js:1290-1293) | one line per live SALE row; total = Σ printed rows; paid/owed from the group; methods from `groupMethods` | three `receipt_line`s, 'စုစုပေါင်း 83,000 ကျပ် / ပေးပြီး 50,000 (ငွေသား 40,000 · KBZPay 10,000) / ကျန် 33,000', `receipt_transfer`, `sale_due_set`, 'ဝယ်သူ: ဒေါ်မြင့်'; the PDF has three item rows (gas_pdf.js:20 prints any number) | none |
| 4.5 | `groupMethods` (core_ledger.js:1189-1201) | cash per row method over live SALE rows and PAYMENTs | CASH 40,000 (rows 1, 2; row 3 has no cash and is skipped), KBZ 10,000 | none: the method rule of 2.1 step 5 puts each row's cash in its own bucket |
| 4.6 | `undoGroup` / `voidGroup` (:992-1022) | every live row; the window from `rows[0].time` | four mirrors (3 SALE + PAYMENT), stock back +2/+1/+1, owed 0, every `dayStats` bucket back to before; one time for all rows (single clock read) so the window is the same for every line | reply wording only (3.4) |
| 4.7 | `dayStats` / `monthStats` / `buildDailySummary` (:1534-1682), `answerToday` (core_bot.js:1051-1061), the Sheet Dashboard (gas_setup.js:398-430) | per-row sums | revenue 83,000 · 4 ထည် · COGS 41,000 → profit ~42,000 (before expenses); 💵 +40,000, 🏦 +10,000, 💳 33,000 owed; after D: `summary_due_overdue` '⏰ ရက်လွန် အကြွေး: ဒေါ်မြင့် 33,000 (… · ၁ ရက် လွန်)' | none |
| 4.8 | the three credit reports (core_report.js:227-230, :280-282, :311-320) | `openCredits` entries | the ပစ္စည်း cell `basket_name`, the due column D | none beyond 4.2 |
| 4.9 | `customerSummaryMap` / the Customers tab F:K (:1347-1382) | every row carrying the customer | bought 83,000, paid 40,000 + 10,000 = 50,000, owed 33,000, one visit | none (the buyer is on every row) |
| 4.10 | `card_buyer` on a sold UNIQUE (core_bot.js:185-207) | `lastLiveSale` of THIS item, then the group's paid and methods | today: '👤 ဒေါ်မြင့် · ပေးပြီး 50,000 · …' under a 25,000 piece (the basket map's one **breaks**) | `card_buyer_basket` '👤 ဒေါ်မြင့် · 🛍 ၃ ခု · ပေးပြီး 50,000 · ငွေသား 40,000 · KBZPay 10,000': the figure is said to be the basket's |
| 4.11 | the customer card (core_bot.js:1672-1702), `customerHistory` (:1384-1389) | per row | today: three of the eight lines for one sale, each with its own cash (see below) | `customerLines`: ONE line 'ရောင်း 🛍 ၃ ခု · 83,000 · ပေး 40,000 · ငွေသား' + 'ငွေလက်ခံ 🛍 ၃ ခု · 10,000 · KBZPay'; the 💰 button logic is group-level already (:1692-1695) |
| 4.12 | the statement PDF `customerReport` (core_report.js:265-290), `dayReport` (:169-198), the Sheet's Ledger tab | per row | three item rows with their own cash (36,000 · 4,000 · 0), the PAYMENT row; totals right | none: a statement and a day report list items; the allocation is visible and reads naturally (first lines paid) |
| 4.13 | the sold card `saleCardText` (core_bot.js:3194-3217) | row 1's item card, summed qty, item 1's stock | today '✅ ရောင်းပြီး ၄ ထည် · 83,000 ကျပ် · လက်ကျန် ၃' under item 1's card (**first row**) | `basket_sold` + three `basket_stock_line`s (1.5) |
| 4.14 | `receiptNumber` (core_ledger.js:1729-1752) | Telegram: counts groups; a phone: row 1's ReceiptNo | one number | the phone copy rule (2.4) |
| 4.15 | `rewriteCheck` (:1029-1044) and every corrective path | `live.length !== 1 → 'complex'` | refused (no corrective buttons on a basket; the voice "Wave နဲ့ ပေးသွားတယ်" answers `rewrite_locked`, as a mixed one-item guided sale already does) | none |
| 4.16 | `commitPayment` / `applyDeposit` / `payPick` / `showPayList` (core_ledger.js:910-960, core_bot.js:1813-1860) | the group's owed; line 1's itemId copied | a later payment caps at 33,000; its row says ItemID S1-0002 (as a delivery says its first line) | none (the customer card describes it as the basket's, 4.11) |
| 4.17 | the sync server: `syncValidateBatch` (core_sync.js:399-445), `syncGroupInScope` (:361-370) | every row valid, one staff, one group, own shop unless refGroupId | four rows ≤ `PUSH_MAX_ROWS` 200, all S1 | none (other-shop lines are refused at the scan) |
| 4.18 | server flag `overpaid` (:811-815) | the PAYMENT against the shadow's owed, rows applied in push order | after three SALE rows the shadow owes 83,000 − 40,000 = 43,000 ≥ 10,000: no flag. Outcome 4: 83,000 − 73,000 = 10,000, not more than owed: no flag. (A PAYMENT after row 1 would see 36,000 − 36,000 = 0 and raise a false `ping_overpaid`: why rule 2.1 step 7 puts it last) | none |
| 4.19 | server flag `stock_negative` (:807-809) | each row against its own item's shadow stock | per line; its `V\|` voids the whole basket | `ping_basket_note` says so (3.5) |
| 4.20 | the server's costAtSale fill (:799-805) | per SALE row with a blank cost | per line | none |
| 4.21 | the app: outbox grouping (app/app_ports.js:166-172), `pendingLines` (app/app_sync.js:496-503) | one entry per group; `describeRow` of its first live row | one entry; today 'ရောင်း ၂ ထည် · လုံချည် … · 36,000 ကျပ်' (**first row**) | `describeGroup` (3.3): 'ရောင်း 🛍 ၃ ခု · 83,000 ကျပ် · 👤 ဒေါ်မြင့်' |
| 4.22 | the app's card photo (`appItemIdFromText`, app/app_ui.js:96, :615-617) | the first tag id in the text | the first line's photo | none (cosmetic) |
| 4.23 | the simulator's Ledger (poc/sim_ui.js:707-724) | one table row per ledger row, no GroupID | three rows that look unrelated | the `Group` column (section 7) |
| 4.24 | **old phones** | a phone that has not yet taken this app update pulls the basket's rows (`appendSynced` keeps every field, SPEC-round-5 4.3) and runs the round-5 core | sums, owed, Credits entry, receipt lines and the due date are right (all written per row or summed); names show the first item (the round-5 first-row behaviour); its own receipt counter is untouched by pulled rows | none needed. In practice the phone app has never been published (project notes), so at the round 4+5+6 publish every phone starts on round 6 |
| 4.25 | **an older server** (a rolled-back bot) | caps without `dueDay` | the phone stores Settings with `sale_flow quick` (`syncSettingsQuick`, core_sync.js:1489-1494) and `cursor.quickForced`: no form opens, no basket is written | none (run_app.js step 40, run_sync.js R5h keep proving it) |

The 4.11 row's "today" text, for the record: three per-row lines '… · ရောင်း လုံချည် ကချင် အပြာ · 36,000 · ငွေသား',
'… · ရောင်း ထမီ ဇင်းမယ် အဝါ · 22,000 · ပေး 4,000 · ငွေသား', '… · ရောင်း ထမီ ချည်သား အနီ · 25,000 · ပေး 0', and the
PAYMENT line. Only the per-row readers (4.11 today, 4.12) can see the split at all; every money total sums.

---

## 5. Glue and sync

### 5.1 setupSheet (apps-script/gas_setup.js)

- `defaults` (:76): `['sale_flow', CFG.SALE_FLOW.FORM]` (appended only when missing, :78-79). The comment above it
  (:74-75) and the file header (:15) say `form` / `quick`.
- The `sale_flow` Key-cell note (:85-92) carries the reworded `settings_note_sale_flow`.
- The Messages loop (:82-84) appends every new key of 3.6 (it appends missing keys only, so a Sheet that already has
  a key keeps its text).
- No tab, column, dropdown or Dashboard cell changes. A Settings row a round-5 setupSheet seeded as `steps` (only on a
  test book; nothing was published) reads as `form` and is not rewritten.

### 5.2 gas_store.js, gas_sync.js, gas_main.js, gas_telegram.js

No change. A Telegram basket costs one `appendRow` + `flush` per row under one `gasLocked` (gas_store.js:391-410):
eleven appends at most (`BASKET_MAX_LINES` + the PAYMENT). The review card on a photo card is edited with
`editMessageCaption` only while it has one line; a failed edit falls back to a new message (gas_telegram.js:52-60),
which `saleShownId` already follows.

### 5.3 core_sync.js

3.5 only. Push order (customer, item, list, group, measurement, notice, error; core_sync.js:75) already puts a new
buyer and a new piece before the group that uses them, and the owner's price ping after both.

### 5.4 The exact migration (for the README; replaces SPEC-round-5 4.5 steps 2-3 where they name `steps`)

1. All suites green (section 8); `node tools/bundle_gas.js`, `node tools/build_app.js`, `node poc/build_simulator.js`.
2. To open the shops on the one-tap card instead of the forms, type the row `sale_flow | quick` into the Settings tab
   before the publish (the code default is `form` when the row is missing). Then publish the bot.
3. Right after, in the same sitting, run `setupSheet` once (the round-4/5 work: Lists with Kind, the Ledger at 27
   columns with DueDay as text, Credits at 15, the Dashboard's Overdue cell; and the Settings rows `sale_flow = form`
   unless typed, `sale_due_presets`, the Messages keys of rounds 4-6), then `rebuildViews`.
4. Publish the app. Phones load round 6 at first open (none runs an older app).
5. The owner may flip `sale_flow` at any time: the bot obeys at the next tap, each phone at its next pull; one phone
   alone can be put on `quick` with the pref `setting:sale_flow`.
6. Rebuild and publish the simulator artifact last.

---

## 6. App (app/)

### 6.1 Files

| File | Change |
|---|---|
| `app/app_forms.js` (NEW) | the four forms: pure helpers + thin DOM (6.2). Listed in `tools/build_app.js` `APP_FIRST` after `app_ui.js` (:30), `poc/build_simulator.js` `FRAME_FILES` (:28), `poc/run_app.js` `FILES` (:17-24) and the dev page's script tags (app/dev/index.html:110-130); check_simulator.js:87 compares FRAME_FILES with APP_FIRST, so both lists change together and the check stays green |
| `app/app_ports.js` | `ui.form: function (req) { emit('form', req); }` beside `measureForm` (:181-183) |
| `app/app_store.js` | the receipt copy rule in `appendLedger` (:294-299) |
| `app/app_sync.js` | `pendingLines` (:496-503) calls `describeGroup(phone.ports, e.txs)`; `replayJob` (:388-395) does not rename an item whose status is BLANK (the result stays on the media record, `store.updateMedia(job.id, {status: 'done', result})`, :419, where the new-piece form reads it) |
| `app/app_ui.js` | the job row in `appRenderHome` (form mode only), `phone.on('form', appOnForm)` (beside :308, deferred with `setTimeout(0)` as `appOnMeasureForm` :995-999), the hooks of map-app-forms 7 joined for `APP.form` (the `'revoked'` close :307, `appOnChange` ignoring the draft kind :354-357, the service-worker `canApply` / reload-on-close :1254, :1263, :1170-1175, the `visibilitychange` scanner guard :346-349), `appOpenTagId` emits `phone.emit('scan', {id})` |
| `app/app_i18n.js` | the APP_MSG keys of 3.6 |
| `app/app.css` | `.formpage .line` (a basket line), `.bchip` (recent-buyer chips; `.chip` is the header's sync chip, :61-67), `[data-f].hot` next to `.kb button.hot, .sell.hot` (:97), the overlay raised above an open form (`.overlay.over-form { z-index: 34 }`, so the keypads of app_ui.js:940-970 can serve a form; today 30 under 32, :136, :171) |
| `app/dev/index.html` | the checkbox "Settings sale_flow = form (off: quick)" and `world.settings.sale_flow = 'form'` (:70, :136, :207-214) |
| `app/index.html`, `app/config.js`, `app/sw.js` | unchanged |

### 6.2 Pure helpers (Node-testable, the `appMeas*` pattern of app_ui.js:117-259)

```
appSaleModel(ports, store, req, draft) -> {lines, total, alloc, buyers: recentCustomers(ports, shop, 6), methods: payMethodsByKind,
                                           duePresets, defaults, restored}
appSaleSave(phone, draft) -> {ok: true, groupId} | {ok: false, problems}
   // basketCheck; saleResolveBuyer; commitBasket(phone.ports, {..., staff: store.meta.staff, source: CFG.SOURCE.FORM,
   // updateId: store.nextUpdateId()}); setLastItem / setLastGroup; basketReply -> ports.chat.sendMessage(uid, text, kb);
   // the draft dropped in the same op batch. Writes nothing durable itself.
appSaleCommit(phone, sync) -> Promise<boolean>     // phone.commit('sale') then sync.scheduleSync() (appMeasCommit, app_ui.js:257-259)
appItemModel / appItemSave / appItemCommit         // commitNewItem; notifyOwners when pending; the media's AI result for the name
appRestockModel / appRestockSave / appRestockCommit   // commitRestockGroup; the reply restock_basket_done + lines
appExpenseModel / appExpenseSave / appExpenseCommit   // commitExpense with the note; the reply expense_done (:55)
appFormDraftKey(kind, staffId) / appFormDraftRead / appFormDraftWrite / appFormDraftDrop   // '<kind>draft:<staffId>', TTL one day
```

The app never re-implements a rule of 3.2: every refusal comes from `basketAddItem`, `basketCheck`, `commitNewItem`
or `commitRestockGroup`, and the DOM only shows the code's message key.

### 6.3 DOM

`appOpenForm(kind, req)`: close any open form, `appCloseOverlay`, stop the home scanner, `clearState(ports, uid)`, one
`div#saleForm` / `#itemForm` / `#restockForm` / `#expenseForm` `.formpage[role=dialog]` on `document.body` (so it
survives `appRender` and `APP.screen` stays `'home'`, map-sim-tests trap T3), every control with `data-f`
(map-sim-tests 7.1), ONE `.good` Save that disables itself while saving; Save → `appXxxSave` → refusal: `.fmsg` +
toast; ok: `appXxxCommit`, then close and `APP.showScanner = false; appRender()` once it resolves (a `false` keeps the
ops queued and `appOnChange` toasts `ui_not_saved`, as for the measurement form).

---

## 7. Simulator (poc/)

What the owner judges the round by, first:

- **Laptop, Ledger tab** (`ledgerTable`, poc/sim_ui.js:707-724): a `Group` column after Type: `🛍 i/n` on the SALE rows
  of a group with n > 1 SALE rows (and `🛍 +` on its PAYMENT), blank otherwise; its header title 'one sale of several
  pieces: the row's place in it'. Page copy, not MSG.
- **Laptop, Credits tab** (:866-878): nothing to change (`c.item` is `basket_name` once `openCredits` returns it).
- **Laptop, a read-only Items tab** (NEW, beside Customers in the tab list :658-669): ID, Shop, Name, Category, Type,
  Price, Cost, Stock, Status, Sample; a new piece flashes like a new ledger row. It mirrors the Sheet's Items tab and is
  where R3's count, type and pending price show.
- **The `sale_flow` switch**: `#flowForm` 'form' / `#flowQuick` 'quick' (simulator.template.html:318-321, title 'form =
  one screen and Save, quick = the one-tap card'); `boot` sets `world.settings.sale_flow = 'form'` (:96); `renderFlow`
  lights `#flowForm` for `form` (:216-220); `setFlow('form')` (:954-959, listeners :1524-1525).
- **Sellers land on 📱** (R8): `doLogin` (:181-191) sets `S.device = 'app'` for a seller login and `'tg'` for the owner,
  un-enrolled (the hint and ⚡ shortcut, :252, :620): the enrol tour keeps its `need.unenrolled` (trap T6).
- **The 21:00 post** (:945-952) needs nothing: `buildDailySummary` reads the basket credit.
- **Frame**: `SIM_FRAME.snap()` (build_simulator.js:141-147) gains `form: null | {kind, lines: [{id, qty, price}],
  buyer, pay, paid, amount, due, total, error, saved}`; new ops `form` (`appOpenForm(kind)`) and `set`
  (`{f, value}`, through the control's own handler) next to `click` (:170); `{op: 'hot'}` repaints an open form
  (:152); the frame forwards the app's `scan` event as `{ev: 'scan', id}`.
- **Tours** (poc/sim_tours.js): `sell`, `deposit`, `mixed`, `price` run on the app form (device app, targets the
  rack tag then NEW `f` targets, ⏭ through `set` / `click`); `back` becomes `remove` (two tags, 🗑 one, ✖️ with the ask);
  NEW `basket` (three tags, part paid, ဒေါ်မြင့် chip, 14 days, Save, then the owner's laptop: Ledger `Group` and
  Credits); `restock`, `newitem`, `expense` on the app forms; NEW `tgsell` (the Telegram review card as the backup:
  START S1-0002, ✅ ရောင်း ၁, scan S1-0005, ✅ သိမ်း) and NEW `newitem_tg` (photo, `P|`, `C|other` typed, `NS|`); `reports`
  logs in as the owner (R8); `lists` keeps its laptop half and ends on the card's how-paid sub-screen; `quick` toggles
  `#flowQuick` and back to `#flowForm`; `return`, `payment`, `takedeposit`, `order`, `enrol`, `stranger` unchanged.
- **`SIM.smoke()`** (:1283-1466): "the simplest sale" and "the deposit sale" drive the review card (the same four
  assertions each, :1338, :1354-1357); "app: a mixed sale of two" drives the app form (:1393-1395 stand); a NEW
  "app: a basket of three with a part payment" (map-sim-tests section 8, with the receipt-number and Credits checks);
  "owner: Lists" ends on the card's how-paid sub-screen (:1439 stands); the 21:00 step also finds ဒေါ်မြင့် (the basket's
  credit) in `summary_due_overdue`. Every new check is made on both transports (check_simulator_browser.js:91).

---

## 8. Tests

Conventions as SPEC-round-5 8: plain Node, `check(cond, label, detail)`, labels from MSG, relative dates, the 64-byte
listener, every new check red without its feature. The existing checks that change are named here (R9).

### 8.1 poc/run_wizard.js — replaced by the round-6 Telegram and books suite (step 1)

Kept verbatim: the harness (`bench`, :55-130, with `world.settings.sale_flow = 'steps'` at :76, which now also proves
that `steps` reads as `form`), step 7 (the seven outcomes, :520-549), step 21 (:1165-1186), step 22 (:1191-1243).
Kept with the setup changed and the assertions unchanged: step 10 (:663-689, `A.guided(…)` at :667 → `commitSaleGroup`
on `A.ports`), step 20 (:1124-1159, the setup at :1128). Step 23 (:1614-1645): 1619, 1621, 1623, 1626, 1639, 1645
kept; **1633** compares the 24 unchanged keys with SPEC-round-5.md and `settings_note_sale_flow` with the round-6 spec;
**1637** becomes the round-6 byte counts ('SS|S1-0002|m|<12 bytes> 25, SS|<a>|q|<id>|9 22, NI|<id>|q|9 14, SC ok 13');
**1643** becomes 'START + one tap shows the review card (sale_line_paid last); nothing is written before ✅ သိမ်း'.
Step 17's **1051-1052** become "'QUICK ', 'Quick' read quick; 'steps', 'form', 'x', a blank and a missing key read
form" and **1057** 'flipped to form between two sales: the next tap shows the review card and writes nothing'. Step 24
(:1651-1662) kept (its "guided screens on photo cards" are now the card's caption edits). Every other step (1-6, 8, 9,
11-16, 18, 19, 22x, 22y, 22z) is deleted and replaced by the steps below, which re-assert each rule map-sim-tests 5.1
marks RC or RC+AF on the review card's edit screens.

New steps (books first):

1. **A one-line basket is the round-5 write**: the seven p's of step 7 written through `commitBasket` with one line give
   exactly the rows step 7 asserts (the same field checks), and `commitSaleGroup` returns `sale === txs[0]` and
   `payment === txs[1] || null` as before.
2. **A basket × the seven outcomes**: the table of 2.2 row by row (rows, order, cash, method, note, dueDay, customer,
   PAYMENT shape, owed); a bargained line alone gets 'price', a bargained part sale 'credit'; a date with a full
   payment dropped.
3. **basketAllocate / basketTotals** (pure): Σ = A, 0 ≤ cash_i ≤ amount_i, line order; A = 0, A = total, A = one
   amount; `basketTotals` equals what `commitBasket` wrote for each outcome.
4. **One clock read**: a clock port whose `now()` advances 1 ms per call across 23:59:59.999 → every row of one basket,
   and the SALE and PAYMENT of a mixed one-item `commitSaleGroup`, share one day and one time (the second is red
   today: `newTx` reads the clock per row, core_ledger.js:32).
5. **DueDay on every SALE row**; `saleGroupInfo` on a hand-built group whose row 1 is undated and row 2 dated → D (red
   today).
6. **The readers on the example (2.2 row 5)**: `saleGroupInfo`; `openCredits` (one entry, `basket_name`, dueDay); the
   receipt text and PDF rows; `groupMethods`; `dayStats` (revenue, pieces, COGS, CASH, KBZ); `customerSummary`; the
   customer card lines (one basket line + one payment line); `cardText` of S1-0001 (`card_buyer_basket`); the basket
   sold card (`basket_sold` prefix = `sold_done` prefix, three lines, `saleSoldCard` true on it); `U|g` (four mirrors,
   stock back, `undo_done` + three lines); `describeGroup`; the owed report's cells; after +15 days
   `buildDailySummary` names ဒေါ်မြင့် in `summary_due_overdue`. Each of these reads a one-line group exactly as before
   (the same calls on a one-line sale compared with today's texts).
7. **basketAddItem / basketCheck** codes: missing, blank, other_shop (seller) and owner of shop 1 adding a shop-2 tag to
   a shop-1 basket, gone, twice (UNIQUE), SKU twice raises the count, max at 11, pending accepted then 'price' at
   Save, buyer, bank, paid, method (a retired key still known), due bounds; nothing written by either.
8. **saleDueKey**: 0, 7, 365 days; 366 null; 'none' ''; '30.12.26', a yearless past date (noRoll → null), yyyy-mm-dd;
   `sale_due_presets` rules of 22y/22x (1364, 1369, 1441, 1450) re-asserted on the card's due screen.
9. **commitNewItem / itemMargin**: count 1 → UNIQUE + RESTOCK 1; count 3 → SKU + ONE RESTOCK +3; not blank, count 0 and
   1000, price −1 / 1.5, cost 'x' refused with nothing written; empty name → placeholder; unknown category → 'အခြား';
   sample → 'new sample'; `itemMargin(25000, 12000)` = {13000, 108}; cost '' → null; cost 0 → pct null; price 0 → null.
10. **commitRestockGroup**: two lines → one group of two RESTOCK rows; `U|g` mirrors both; qty 0 and a UNIQUE refused.
11. **The review card**: S|S1-0002|1 edits the photo card into the card (caption, nothing written, state `{kind:
    'sale', form: true, step: 'card'}`); ✅ သိမ်း writes one SALE (18,000 CASH, no customer, no DueDay, no note) and the
    sold card has [undo, receipt] only; a scan of S1-0005 sends the card as a new message with two lines and the older
    card answers expired; a scan of S1-0001 twice → `basket_twice`; a shop-2 tag → `basket_other_shop`; a blank tag →
    `basket_blank`, the basket kept; a typed id adds a line; the line sub-screen (grid 2 → qty 2; 💬 15,000 → 'price';
    🗑); buyer (exact, partial, digits as a phone, a known phone never duplicated, create at Save only); how paid (the
    six-answer rules of round-5 step 5, ➕ an account inside the card with the kind asked after the name); paid now
    (all, half, 0, typed; a typed amount never commits); the due screen; part without a buyer → Save refused with
    `sale_need_buyer` on the card, nothing written; stale, double and expired taps (two ✅ within 120 s write one
    group); ✖️ → the anchor's item card; sold meanwhile at Save → `sale_gone` on its line, nothing written; the deposit
    question after Save for ဒေါ်ခင်; `SS|`/`SC|` never emitted in `quick` (bench({quick: true})).
12. **The new-piece card**: blank S1-0007 + photo → the card (photo_seen, ⏳, count ၁); `P|…|25000` and typed cost
    12000 redraw it with the profit line; `NI|…|q|3` → '🔢 ၃ ထည်'; `NS|` → SKU stock 3, one RESTOCK +3, `item_created`;
    ⏳ pending → the owner's `price_ask_owner` with `SP|` buttons; in `quick` the same scan still goes price → cost.
13. **Texts and limits**: every key of 3.6 in MSG and non-empty; the button rule over the new `btn_*`; every callback
    within 64 bytes; no update failed with an exception.

### 8.2 poc/run_round4.js (step 1)

- :1938 label only: '(…; the code default is form)'.
- :1954 also excludes `NI|` and `NS|` ('quick: no SS|, SC|, NI|, NS| or LA|pm|SSA button was ever emitted …').
- :1959-1967: `Y.world.settings.sale_flow = 'steps'` stays (it reads as form); **1964** becomes 'form: sell() returns no
  row of its own; the card is edited into the review card (sale_line_paid last) and a sale state with form true waits'
  (condition: `sy.card.text.endsWith(t(Y.ports, 'sale_line_paid', {paid: '18,000', owed: '0'}))` and `state.form`);
  **1967** unchanged (✖️ `SS|S1-0002|z` brings the item card back).
- Step 10 (:2002, :2007, :2008) unchanged (quick seed).

### 8.3 poc/run_sync.js (step 2)

Named edits: R5a (:1548-1583) setup through `commitSaleGroup` on the reference phone's ports (`P.ports`, the app form's
write) instead of the `SS|`/`SC|` taps at :1557-1563, assertions 1565, 1572, 1576, 1580 unchanged; R5c (:1600-1609) the
same; R5e (:1660-1678) through the review card's buyer taps on the reference phone (assertions 1673, 1678 unchanged);
R5f **1693** 'after the pull … saleFlow(phone) is form (the Sheet's steps reads as form): the sell button opens the
review card and writes nothing'; R5h **1734**, **1753**, **1764**: `saleFlow(P.ports) === 'form'` and the review card
instead of `cust_find` (`same3(wire.caps, ['dueDay'])` unchanged).

New: **R6a** a three-line basket with a mixed part payment written on the reference phone through `commitBasket`
(offline: ONE outbox group, 3 SALE + PAYMENT in that order, the buyer on all four, DueDay on the three SALE rows only,
ONE receipt number on the three SALE rows and none on the PAYMENT, the counter +1); pushed: ok, no OVERPAID, the
server's `openCredits` has one entry with `basket_name`; **R6b** the same basket with outcome 4 (no flag at owed =
payment); **R6c** two phones offline sell the same UNIQUE, one inside a basket: `stock_negative` flagged, the ping
carries `ping_basket_note`, `V|` voids every line of the basket; **R6d** a counted new piece offline (item entry, then
the RESTOCK group, then the notice) arrives in that order and the server's stock is the count.

### 8.4 poc/run_gas.js (step 2)

Named: **1495** 'Settings: sale_flow = form, its Key cell carrying settings_note_sale_flow, and sale_due_presets =
7,14,30'; **1540** 'Settings got sale_flow = form and sale_due_presets; nothing in the Errors tab'. Kept: 1498 (the 25
round-5 keys are still in MSG), 1771 (caps). New: 19d a round-5 book whose Settings say `steps` reads as form after
setupSheet (the row kept); 26 a review-card basket through the fake GAS: one Ledger block of 3 SALE + 1 PAYMENT rows ×
27 cells with one GroupID, DueDay text on the three SALE rows, a blank ReceiptNo (derived), the Credits tab one row
with `basket_name`, the Customers tab bought/paid; 27 a counted new piece on the Sheet (Type SKU, one RESTOCK row).

### 8.5 poc/run_app.js (step 3)

`round5()` steps 32, 33 (:928-957), 34 (:985-1023), 35 (:1045-1051), 37 (:1103-1132), 39 (:1194, :1213, :1224, :1227)
are deleted as obsolete (the chat-step input bars) and replaced by `round6()`; kept: 32's 906 and 909, 33's 918, 36's
1062 and 1067, 37's 1086, 1090, 1135-1140, 38, 39's 1159, 1167, 1172, 1196, 40's 1249, 1254,
1268. Named: **921** 'the server says steps (read as form): the next pull carries it to the phone' (`saleFlow === 'form'`);
**1073** 'the same tap in Telegram (the server says form) shows the review card and writes nothing'; **1077**
`saleFlow(G2.ports) === 'form'`; **1097** and **1101** draw a quick sold card's keyboard (the pref `setting:sale_flow =
quick` on G2) and mark its `U|<g>` button, since a form-mode tap on the app opens a form, not a keyboard; **1142** 'the dev page starts
in form and has the sale_flow checkbox that syncs the settings'; **1243** (`boot40` is the server's value, unchanged)
and **1259**, **1266** read form, the scan opening the sale form (`'form'` event) and writing nothing. The steps of 962,
965, 967, 970, 973, 1028, 1030, 1032, 1036, 1054, 1057 are re-asserted in `round6()` on the form (AF).

`round6()` (books-relevant checks; the seller design adds the UI ones): the sale form's model and save on an enrolled
phone: one adapter transaction carrying the rows, the outbox entry, the sold card and the draft removal; the three-line
basket's receipt number on all three SALE rows and the counter +1 (red today: +3); `pendingLines` shows `describeGroup`;
a new buyer queues the customer entry before the group; the new-piece form writes the item entry before the RESTOCK
group and a notice for a pending price; the AI replay leaves a BLANK item alone and the form's Save takes the result's
name over the placeholder; the restock form's one group; the expense form's one row with its note; in `quick` no form
opens (`'form'` never emitted) and a scan shows the card; with `quickForced` no form opens.

### 8.6 The simulator checks (step 4)

poc/check_simulator.js: **120-122** the id list names `flowForm` instead of `flowSteps`; **140** 'the page boots with
sale_flow = form'; **156** the tour list (`remove` instead of `back`, plus `basket`, `tgsell`, `newitem_tg`); **160** /
**193** `KINDS` gains `f` (an `f` target names a `data-f` that app/app_forms.js emits); **217** 'the sell tour runs from
the tag S1-0002 to the form's Save (f:save)'; **223** moves to the `quick` tour's `S|S1-0002|1` target. New step-5
siblings: app_forms.js sets `data-f` and reads `SIM_HOT`; the snapshot carries `form`. check_simulator_browser.js: no
edit (91 binds the new smoke step to both transports).

### 8.7 What stays green without a touch, and why

run_scenario (327 at round 5), run_lists, run_round4 1-9l and 10, run_app 1-31, run_sync 0-S22/L*/M*, run_gas 1-17 and
20-25: `seedSimWorld` seeds `quick` and `quick` is round 4 exactly (1.9), including the photo chain run_scenario steps 11
and 12 drive (run_scenario.js:121-145); `commitSaleGroup`'s rows are unchanged; a one-row group reads as before in every
reader; caps is unchanged; no MSG key is deleted.

---

## 9. Build steps and ownership

Nobody edits a file outside their step; each step's checker: the named suites end `0 failed`, `npx acorn@8 --ecma5` on
every changed ES5 file, the new globals grepped first, `node tools/bundle_gas.js` and `node tools/build_app.js` run.

1. **Core** (first, alone): `apps-script/core_config.js`, `core_ledger.js`, `core_report.js`, `core_bot.js`,
   `core_messages.js`; `poc/run_wizard.js` (8.1), `poc/run_round4.js` (8.2's lines only). Checker: run_wizard,
   run_round4, run_scenario, run_lists green. Expected RED until their own step: run_sync R5a-R5h and run_app round5()
   (they pin the round-5 steps; steps 2 and 3 replace them); nothing is published in between.
2. **Glue and sync** (after 1, parallel with 3): `apps-script/gas_setup.js`, `core_sync.js`, `poc/sim_phone.js`
   (the receipt copy rule), `poc/run_sync.js` (8.3), `poc/run_gas.js` (8.4), `poc/fake_gas.js` (no change expected).
3. **App** (after 1, parallel with 2): `app/app_forms.js` (new), `app_ui.js`, `app_ports.js`, `app_store.js`,
   `app_sync.js`, `app_i18n.js`, `app.css`, `app/dev/index.html`, `tools/build_app.js` (`APP_FIRST` only),
   `poc/build_simulator.js` (the `FRAME_FILES` line only, so check_simulator.js:87 stays green), `poc/run_app.js` (8.5).
   Not `app/config.js`, not `tools/publish*.js`.
4. **Simulator** (after 2 and 3): `poc/build_simulator.js` (snapshot, ops), `poc/sim_ui.js`, `poc/sim_tours.js`,
   `poc/simulator.template.html`, `poc/check_simulator.js` (8.6). Then the browser checks and the artifact.
5. **Docs** (last): `apps-script/README.md` (sale_flow form/quick, the basket rows, the receipt number, the migration of
   5.4), `app/README.md`, `docs/USER-GUIDE.html`, `POS-PROJECT-PLAN.md`.

---

## 10. Deliberately not built

- The R4 "could" forms (receive a payment, take a deposit, a return) and `commitCustomerPayment`: the ☰ chat flows
  (`M|pay`, `M|dep`, `T|`) work in the app through `deliver` today; a later round can add them on the same helpers.
- Editing or partly undoing a saved basket: undo within 30 minutes and sell again (round-5 D3); a per-line void (the
  owner's `V|` voids the whole basket and the ping says so); corrective buttons on a basket (`rewriteCheck` answers
  `complex`); rewording `rewrite_locked` for a basket.
- A basket across shops, a basket-level discount or a discount in percent (a line's price is the bargain), two
  accounts in one mixed payment, a DueDay on a PAYMENT.
- Restocking a UNIQUE piece, or turning a UNIQUE into a stock item later (refused in the restock form; Telegram has no
  `R|` for it, core_bot.js:219-224).
- Storing the photo AI's `description` (computed at core_bot.js:2124, no Items column, gas_store.js:354-357).
- Fixing the missing Telegram photo of a piece registered on a phone: the server keeps the phone's local media id as
  `photoFileId` (core_sync.js:721-739) and `sendItemCard` prefers it (core_bot.js:239-240), so Telegram falls back to
  text (gas_telegram.js:39-46). It predates round 6; the fix belongs to the sync server.
- A new sync cap, a raised `app_min_version`, any new Sheet column or tab.
- Wiring `enrolledInApp` / `sendAppCard` (a backup must sell), deleting a round-5 MSG key, rewriting a `steps` cell.
- Review cards for restock and expense in Telegram (the chat flows stay); a "sell" button in the Telegram ☰ menu (a
  sale starts from a scanned tag); opening the review card straight from a Telegram scan (the item card stays the
  entry: the owner and sellers also scan to look).
- Changing the 21:00 summary's format, the reports' layout, or the quick card.
