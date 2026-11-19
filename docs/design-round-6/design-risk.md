# Design (risk and build first): round 6, one-screen forms for the sellers, Telegram for the owner

Date 2026-11-12. Designer's report for `docs/design-round-6/BRIEF.md` (R1-R9). Angle: the smallest safe change that
delivers R1-R9. It covers what core code is reused and what is removed, how each removed test is replaced without a gap,
which existing checks change, and a build order with disjoint files. Tree: the current one (rounds 4 and 5 built,
unpublished); every `file:line` is today's. Maps used: `map-app-forms.md`, `map-core-commits.md`, `map-sim-tests.md`
(this folder) and `docs/design-round-5/map-basket-readers.md` ("the basket map").

Suite counts measured today, before this round (`node poc/<suite>.js`): run_scenario 327, run_round4 345,
run_lists 236, run_gas 295, run_app 265, run_sync 333, run_wizard 290, check_simulator 68. All end `0 failed`.

---

## 0. The approach in twelve rules, and the risk register

1. **One switch.** `saleFlow(ports)` returns `'form'` or `'quick'`. `'steps'`, a blank and anything else read as `form`
   (R6). Every round-6 behaviour, in the app and in Telegram, runs only under `form`. `quick` is round 4 byte for byte.
   `seedSimWorld` keeps `sale_flow: 'quick'` (poc/sim_seed.js:72), so run_scenario, run_lists, run_round4 1-9l and 10,
   run_app 1-31, run_sync 0-M11 and run_gas 1-17 never meet round 6 (map-sim-tests 5.6).
2. **One write per job, in core_ledger.js, shared by both channels.** `commitBasket` (sale), `commitNewItem` (new
   piece), `commitRestockGroup` (restock). `commitExpense` stays as it is. `commitSaleGroup` becomes a one-line wrapper
   of `commitBasket` that writes exactly today's rows, so the seven-outcome checks (poc/run_wizard.js:520-549) pin the
   wrapper.
3. **One set of rules per job, pure and shared:** `basketAddItem`, `basketCheck`, `saleDueKey`, `itemMargin`. Today
   the commits clamp and never refuse, and every refusal sits in a Telegram handler (map-core-commits 0.3). These
   helpers give the app form and the review card the same refusals.
4. **One reply.** After Save, both channels show the core-rendered sold card (`basketSoldReply`). In the app it is the
   latest bot message on home, with its U|, RC| and CD| buttons working through `phone.sim.tap`, as they do today
   (app_ui.js:810-818).
5. **Every reader change is guarded by `info.rows.length > 1`.** A one-line group renders byte for byte as today, so no
   existing reader check moves (basket map 3.3 rule 7).
6. **The app forms follow `#measForm`:** a pure model, save and commit (Node-testable), a draft in the persisted cache,
   and a thin DOM on `document.body`. The new file `app/app_forms.js` holds them. Its render step (`appFormRender`,
   which builds the tree with `APP.doc.createElement`) is split from its mount step (`appFormMount`, the only line that
   touches `document.body`), so `fakeDocument` (run_app.js:850-888) can render a form and inspect it.
7. **One form slot, `APP.form`**, beside `APP.measForm`. It joins every lifecycle hook once: revoked, the service
   worker, visibility, the scanner, `appOnChange`, the simulator snapshot (map-app-forms 7).
8. **One tag router.** `appOpenTagId` (app_ui.js:563-568) hands a tag to the open form when that form takes tags.
   Otherwise it goes to the core's `openTag`, which in the app and in `form` mode calls `ports.ui.saleForm` or
   `ports.ui.newItemForm` (the `ports.ui.measureForm` precedent, core_bot.js:4183, :4198-4199; app_ports.js:181-183).
   The scanner, the tag keypad, the recent tiles and the simulator's `{op: 'open'}` all go through `appOpenTagId`.
9. **The Telegram review card reuses round 5's state and guard.** The state kind stays `'sale'`, the prefixes stay
   `SS|`/`SC|`, the sub-screen step names stay `buyer`, `name`, `phone`, `method`, `account`, `bank`, `paid`, `due`,
   `due_text` and `kind`, and slot 1 of every callback is the item the card opened on (the *anchor*). So
   `saleGuard`'s stale-tap rules (a)-(c) (core_bot.js:2359-2377), `ITEM_ACTIONS` (:431), the ➕ resume (`SSA`), the
   sub-screens, the app's input modes (app_ui.js:76-81) and the caption-aware edits keep working. Only the step
   machine dies: `hist`, `saleGo`'s push, `saleNext`, `saleBack`'s pop with `SALE_BACK_CLEARS`, the summary step, and
   the commit button on the how-much-now screen.
10. **No new sync cap.** Rounds 4-6 ship together (BRIEF line 3). A pull without `dueDay` already sends a phone to
    `quick` (core_sync.js:1454-1468), and `quick` turns every form off. `SYNC.CAPS` stays `['dueDay']`
    (core_sync.js:85), so run_gas.js:1771 and the caps part of run_sync.js:1734 stay as they are.
11. **run_wizard.js is rewritten in place.** It was round 5's suite for a mode R5 removes. Its V checks are carried
    over verbatim, each RC/AF check gets a named successor, and each O check is dropped with its feature (section 8.1).
    The name stays, because apps-script/README.md:363 and :374 run it.
12. **What is left out is named** (section 10): the "could" forms, per-line undo, restocking a one-of-a-kind piece, a
    synchronous photo AI, and two photo defects that already exist today.

| # | Risk | Where | Mitigation | Pinned by |
|---|---|---|---|---|
| K1 | Hundreds of existing checks break | every suite | rule 1 (the quick seed), rule 2 (the wrapper), rule 5 (row guards) | the counts in 8.9 |
| K2 | A basket written in the wrong shape (DueDay not on row 1, PAYMENT before a SALE, one receipt number per row, rows on two Days) | commitBasket, app_store.js:296-299, sim_phone.js:123-125 | the rules B1-B9 of 2.2, one clock read, the receipt copy (2.4) | W26, run_app 43-45, R6a, gas 26 |
| K3 | The review card's state goes wrong (stale taps, double Save, scan routing) | core_bot.js | reuse `saleGuard`, the anchor id, `SC` in `MUTATING_ACTIONS`, ➕ before a scan adds (1.6) | W1-W16 |
| K4 | Form lifecycle: the camera behind a form, a keypad under it, a service-worker reload mid-form, revoked | app_ui.js:307, :346-349, :533, :1254, :1263, app.css:136 | one `APP.form` slot and one hook list (6.3), overlay z-index 34 | run_app 52 |
| K5 | The photo AI renames the blank tag behind an open form, so Save is refused as `not_blank` | app_sync.js:388-395 | the `ctx.form` guard (6.5) | run_app 49 |
| K6 | Save tapped twice | app forms, `SC`, `NC` | `F.saving` plus a disabled button; `SC`/`NC` in `MUTATING_ACTIONS` | run_app 48, W13 |
| K7 | Tours cannot see or drive a form | sim_ui.js, build_simulator.js | a `form` snapshot, the frame ops `form`/`set`/`photo`/`close`, a target kind `f` (7.2) | check_simulator new 5b, 6b; SIM.smoke |
| K8 | A Telegram caption over 1024 characters | the card on the scanned photo message | `BASKET_MAX_LINES` 10, names cut to 24 characters, `saleShownId` follows the new message on a failed edit | W24, W2 |
| K9 | A new app file is missing from a load list | build_app, build_simulator, run_app, dev page | one named line in each (6.1); check_simulator.js:87 compares two of them | check_simulator 87 |
| K10 | Coverage lost when run_wizard is rewritten | poc/run_wizard.js | a disposition table per round-5 step (8.1) | the table |

---

## 1. Screens

### 1.1 The app home in `form` mode (R1)

Scanner state, top to bottom (`appRenderHome`, app_ui.js:484-495, gains one row above the scanner):

```
[ 🛒 ရောင်းမယ် ] [ 🆕 ပစ္စည်းအသစ် ]        ui_home_sell (NEW) · ui_home_new (NEW)
[ 📦 ကုန်ရောက်  ] [ 💸 ကုန်ကျ       ]        btn_restock · btn_expense (MSG, as they are)
(the scanner panel as today, appScannerPanel :507-531)
[ ⌨️ နံပါတ် ရိုက်မယ် ]                         ui_btn_keypad
🕘 မကြာသေးမီ · 6 tiles                       appRecentPanel :570-577 (a tap goes to the router)
🔍 find                                      appFindPanel :591-609
```

Card state (after a Save, or any bot card): the same four job buttons as one compact row of 56 px, then the latest card
large as today (:497-504). Under `quick` no job row is drawn and home is exactly as today. The job tiles reuse the
`.kb.grid` buttons (app.css:94-95). Labels go through `APP.tt`.

The scan route. A scan with no form open goes to `appOpenTagId`, then `phone.sim.start(id)`, then `openTag`
(core_bot.js:105-129):

| Scanned | Today | `form` mode in the app |
|---|---|---|
| a blank tag | `new_tag` prompt (:122-124) | `ports.ui.newItemForm({itemId})`: the new-piece form for that tag |
| an item of the seller's shop (any shop for the owner) with a price, not sold out | the item card | `ports.ui.saleForm({itemId, qty: 1})`: the sale form with that line |
| a pending-price item | card (`D\|`, `SP\|`) | the card, unchanged (the owner sets the price there) |
| a one-of-a-kind piece already sold | the card with `card_buyer` | the card, unchanged |
| another shop's item (a seller) | the card | the card, unchanged; its sell button answers `basket_other_shop` (NEW) |
| unknown | `tag_not_found` | the same |
| any tag while a sale or restock form is open | n/a | the open form takes it (`appFormTag`); the core is not called |

Tap counts (R2): one cash piece = scan, ✅ သိမ်း (2 taps). Three pieces in cash = 3 scans and Save. A part payment
to a recent buyer = scan, the buyer chip, 💳 မကျေသေး, the amount, ၁၄ ရက်, Save.

### 1.2 The sale form `#saleForm` (R2, must)

```
┌ 🛒 ရောင်းမယ်                                          ✖️ ပိတ် ┐  ui_home_sell · ui_btn_close
│ [ live camera strip ] 🔦 မီး   [⌨️ နံပါတ် ရိုက်မယ်]          │  ui_torch · ui_btn_keypad (camera off: ui_scan_start)
│ 🕘 recent: 6 small tiles of the basket's shop                │  recentItems(ports, shop, 6)
│ 🧣 S1-0002 · လုံချည် ကချင် အပြာ                     🗑 ဖယ်   │  btn_remove_line (NEW)
│    [ 18000 ] ကျပ်          [−]  ၂  [+]          36,000     │  price input · .stepper
│ 👗 S1-0005 · ထမီ ဇင်းမယ် အဝါ                        🗑 ဖယ်   │
│    [ 22000 ]               [−]  ၁  [+]          22,000     │
│ 👗 S1-0001 · ထမီ ချည်သား အနီ                         🗑 ဖယ်   │  one piece: no stepper, count ၁
│    [ 25000 ]                    ၁              25,000     │
│ စုစုပေါင်း 83,000 ကျပ်                                      │  ui_sale_total (NEW)
│ 👤 [ ဝယ်သူ · နာမည် (သို့) ဖုန်း ရိုက်ပါ ]                    │  ui_buyer_find (NEW)
│    ( ဒေါ်မြင့် ) ( ဒေါ်ခင် ) …   ( ✏️ နာမည်အသစ် )               │  .bchip (NEW) · btn_new_customer
│ 💰 ဘယ်လိုပေးလဲ?                                              │  sale_ask_method
│ [💵 ငွေသား][📲 KBZPay][📲 WavePay][🏛 ဘဏ်][💵+🏦 ခွဲပေး][➕ အသစ် ထည့်] │  btn_cash · btn_wallet · btn_bank_transfer · btn_split · btn_add_option
│ [✅ အကုန် 83,000] [💳 မကျေသေး]                                │  btn_paid_all · btn_credit
│   (part)  💵 ယခု ပေးငွေ [ 30000 ]                             │  ui_sale_paid_now (NEW)
│           📅 ကျန်ငွေ ပေးမည့်ရက်                                 │  ui_sale_due (NEW)
│           [၇ ရက်][၁၄ ရက်][၃၀ ရက်][📅 ရက်စွဲ ရွေးပါ][❓ မသေချာ]  │  btn_days · ui_btn_pick_date · btn_due_unknown
│           ပေးပြီး 30,000 · ကျန် 53,000                          │  sale_line_paid
│           ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်                   │  sale_need_buyer (no buyer yet)
└ .fmsg ……                                        [✅ သိမ်း]   ┘  btn_save
```

- **Defaults:** count 1, the item's price, no buyer, 💵 cash, ✅ paid in full, and ❓ not sure once part is chosen. So
  a normal sale is scan, then Save.
- **Lines:** they come from a scan (the strip's own scanner), the keypad, a recent tile, or a `saleform` request. Each
  addition goes through `basketAddItem` (3.2). A refused tag shows its reason in a toast and in `.fmsg`, and no line is
  added: `basket_twice`, `basket_other_shop`, `basket_gone`, `basket_blank`, `basket_max` (all NEW). The same SKU again
  raises its count (basket map rule 5). A one-of-a-kind piece is count 1 with no stepper. The stepper runs from 1 to
  999 (`CFG.MAX_SALE_QTY`), and tapping the number opens the number keypad (`appOpenNumberKeypad`, :940-970), which
  now draws above the form (6.6). A changed price input marks `priceChanged`. A pending-price item is added with an
  empty price and Save refuses it with `basket_need_price` (NEW), which closes the trap of a zero-total group read as
  voided (map-core-commits 0.6b).
- **The basket's shop** is the first line's. For a seller it must be `staff.shop`. The owner may sell either shop, but
  not both in one basket (rule B6, 2.2). The account lists, the recent buyers and the recent tiles all key on it (as
  run_wizard step 19 pins for round 5).
- **Progressive disclosure**, each rule a pure function of the values:
  (a) typing in the buyer field filters the chips through `findCustomers` (core_ledger.js:1446-1468; four or more
  digits search by phone); ✏️ နာမည်အသစ် reveals a name field and a phone field (`inputmode=tel`); a picked buyer
  replaces the chips with one chip `👤 name · phone ✖️`.
  (b) 🏛 ဘဏ် reveals the bank accounts (`btn_bank` '🏦 {method}'); with one bank, it is picked for you (the round-5
  rule, core_bot.js:2471).
  (c) 💵+🏦 ခွဲပေး is offered only when the total is at least 2 (:2618). It reveals every non-cash account and the
  transfer field `ui_sale_transfer` (NEW). A transfer equal to the amount paid now books everything on the account; a
  transfer of 0 books it all as cash (outcomes 6 and 7, run_wizard.js:539-543).
  (d) 💳 မကျေသေး reveals "paid now" (blank = 0) and the promised day (default ❓; the days come from `saleDuePresets`,
  core_bot.js:2331-2337, the first three). It shows `sale_need_buyer` while no buyer is set.
  (e) ➕ အသစ် ထည့် reveals an account name field (placeholder `add_ask_pm`) and the kind (`btn_kind_wallet` /
  `btn_kind_bank`). The Lists row is written at Save, never before (the round-5 D6 rule).
- **Save** is disabled while saving or while the basket is empty (`.fmsg` then shows `ui_form_empty`, NEW). On a
  refusal, `.fmsg` shows the first problem from `basketCheck`, the line concerned gets the class `.bad`, and nothing is
  written. On success, `phone.commit('sale')` resolves, then the form closes, the home shows the sold card
  (`APP.showScanner = false`), and `sync.scheduleSync()` runs. The order fixes map-app-forms surprise 5: the measurement
  form closes before its commit resolves.

### 1.3 The new-piece form `#itemForm` (R3, must)

```
┌ 🆕 ပစ္စည်းအသစ် · S1-0007                                   ✖️ ┐
│ (opened from the tile: 🏷 Tag အသစ်ကို ဖတ်ပါ … + camera strip + ⌨️)  ui_newitem_tag (NEW)
│ [ 📸 ဓာတ်ပုံ ]        after the photo: the picture (tap = take again) ui_btn_photo
│ ⏳ ဓာတ်ပုံကို စစ်နေသည် · အမည်ကို ကိုယ်တိုင် ရိုက်လည်း ရပါသည်       ui_form_ai_wait (NEW), while the AI job is out
│ ✏️ နာမည်     [ ပစ္စည်း S1-0007 ]                                btn_item_name (NEW) · placeholder = itemPlaceholderName
│ 🏷 အမျိုးအစား [ထမီ][လုံချည်][အင်္ကျီ][ဝတ်စုံ][အခြား]               btn_item_cat (NEW) · CFG.CATEGORIES (core_config.js:23)
│ 🧵 အရင်း     [ 12000 ]                                         btn_item_cost (NEW)
│ 💰 ရောင်းဈေး  [ 25000 ]  (25,000)(30,000)(35,000)                btn_item_price (NEW) · pricePresets chips
│ 📈 အမြတ် 13,000 ကျပ် · အရင်းပေါ် 108%                           item_lbl_profit (NEW)
│ ⏳ စျေး မသတ်မှတ်ရသေး        (shown while the price is empty)        btn_pending
│ 🔢 အရေအတွက်  [−]  ၁  [+]                                       btn_qty
│ ( 🧵 နမူနာ: မဟုတ် )                                              btn_sample_off / btn_sample_on
└ .fmsg                                           [✅ သိမ်း]    ┘
```

- **The photo comes first.** A browser opens the camera only from a tap: `input.click()` without a user gesture is
  blocked, and a QR decode is not a gesture. So the form opens with the big 📸 button at the top and every field visible
  below it. This is one tap more than R3's "opens the camera", and it cannot be avoided. Save works without a photo (a
  broken camera must not stop registration).
- **Defaults:** the name is empty, which means `itemPlaceholderName(id)` (shown as the placeholder). The category is the
  AI's if it is listed, else အခြား. Count 1, no sample, an empty price (= pending), an empty cost (= unknown).
- **The AI name** fills the name field when the job comes back while the form is open, but only if the seller has not
  typed one (6.5).
- **Profit** is `itemMargin(price, cost)`: markup on cost, said in the label as "အရင်းပေါ်" (on cost). The brief left
  the base open (map-core-commits surprise 6). Markup is how a shop that "bought at 12,000 and sells at 25,000" talks.
  It is shown only when both are at least 1; a loss shows a minus.
- **A count above 1** makes the item a stock item (SKU) with that many pieces (2.5).
- **Save** calls `commitNewItem`. Then, if the price is pending, `notifyOwners` (an outbox notice on the phone,
  app_ports.js:95-98). The reply is `item_created` · id and then the item card, as `newItemCost` does
  (core_bot.js:2190-2194).
- **Refusals:** `ui_newitem_not_blank` (NEW: the tag was registered meanwhile), `bad_qty`, `ask_number` (a negative or
  non-whole price or cost).

### 1.4 The restock form `#restockForm` (R4, should)

Title `btn_restock` '📦 ကုန်ရောက်'. The camera strip, the keypad and the recent tiles as in the sale form. Each line
shows `{emoji} {id} · {name} · လက်ကျန် {stock}` and a stepper (default 1). Refusals when a tag is added: `basket_blank`,
`basket_unique` (NEW: a one-of-a-kind piece has no restock, as today, core_bot.js:219-224), `basket_other_shop`,
`basket_max`. The same SKU again adds 1. Save calls `commitRestockGroup`: one group, so one undo. The reply is one line
per item, `<id> · ` + `restock_done` '📦 ကုန်ရောက် {qty} ထည် · လက်ကျန် {stock}', with `undoRow` (core_bot.js:367).

### 1.5 The expense form `#expenseForm` (R4, should)

Title `btn_expense` '💸 ကုန်ကျ'.

- For the owner only: a shop choice, `ui_form_shop` (NEW) + `.seg` S1/S2 (default `staff.shop`). This is today's
  `exp_ask_shop` choice.
- The category chips from `expenseCategories(ports, shop)` with `expenseEmoji`. `btn_add_cat` '➕ အမျိုးအစားအသစ်'
  reveals a name field (placeholder `add_ask_ec`); the category is created at Save through
  `addListOptionByLabel(ports, 'expense_category', label, staff)` (core_ledger.js:762-780; it works offline).
- An amount field, `ui_expense_amount` (NEW), with the `expensePresets` chips (core_ledger.js:316-331).
- How paid: cash, the wallets, the banks (no mixed). A note field with the placeholder `exp_ask_note`.
- Save calls `commitExpense` with the note in the row at once. The reply is `expense_done` with `note: ' · ' + note`,
  as `attachExpenseNote` formats it (core_bot.js:2057-2058), plus `replyKeyboard(ports, groupId)` (:354).
- Refusals: amount below 1 shows `ask_number` (as `expenseAmount` does, core_bot.js:2008-2011); no category shows
  `exp_ask_cat`; a refused new category shows the reason from `addListOptionByLabel`.

### 1.6 The Telegram sale review card (R5, the sellers' backup)

**Opened by** `S|<id>|<n>` on an item card (including the `Q|` grid's digits, which are `S|id|n`), a typed count
(`QN|`), or a typed price (`D|`). A tapped item card (a photo message) is edited into the review card (`isCaption`);
a typed opener sends the card as a new message. `S` stays exempt from the two-minute guard in `form` mode
(core_bot.js:446), because it writes nothing. An identical second tap on the same card makes no edit (the round-5
rule, :2402-2403).

**Text** (`basketCardText`, NEW):

```
🛍 ၂ ခု · 58,000                               basket_line (NEW)
🧣 S1-0002 · လုံချည် ကချင် အပြာ × ၂ · 36,000    basket_card_line (NEW), one per line, names cut to 24
👗 S1-0005 · ထမီ ဇင်းမယ် အဝါ × ၁ · 22,000
👤 ဒေါ်မြင့် · +95 9 777 123 456                  customerLabel (core_bot.js:1590), or '👤 ' + new name · phone
💰 ငွေသား                                      sale_line_method / sale_line_mixed
ပေးပြီး 30,000 · ကျန် 28,000                    sale_line_paid (only for a part payment)
📅 ကျန် 28,000 · ၂၆.၁၁.၂၆                       sale_due_set / sale_due_none (only while owed)
ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်             sale_need_buyer (only while owed with no buyer)
```

A pending-price line shows `btn_pending` in place of its amount.

**Keyboard** (`basketCardKeyboard`, NEW; `a` = the anchor id):

```
[🧣 S1-0002 × ၂] [👗 S1-0005 × ၁]          SS|a|l|<id>        btn_card_line (NEW), two per row
[➕ ပစ္စည်း ထပ်ထည့်]                          SS|a|add           btn_add_item (NEW)
[👤 ဝယ်သူ] [💰 ငွေသား]                       SS|a|o|buyer       btn_customer / btn_card_buyer (NEW)
                                            SS|a|o|method      btn_card_pay (NEW)
[✅ အကုန် 58,000] [📅 မသေချာ]                SS|a|o|paid        btn_paid_all / btn_card_paid (NEW)
                                            SS|a|o|due         sale_due_none / btn_card_due (NEW); only while owed
[✅ သိမ်း] [✖️ မလုပ်တော့]                     SC|a|ok            btn_save · SS|a|z  btn_cancel
```

**Sub-screens.** Each is drawn on the card's own message. Its back row is `[⏮ SS|a|back|card, ✖️ SS|a|z]`, and every
answer returns to the card. A typed answer has no tapped message, so the card comes back as a new message and
`state.msgId` moves to it (round 5's rule, core_bot.js:2290-2293).

| Sub-screen (opened by) | Text | Answers (reused letters) | Built from |
|---|---|---|---|
| line (`l\|<id>`) | that line's `basket_card_line`, then `ask_qty` (SKU) | SKU: `q\|1`..`q\|9`, ✏️ `qn` (typed, purpose `sale_qty`), 💬 `pr` (typed, purpose `sale_price`), 🗑 `rm\|<id>` (only with 2+ lines); a one-of-a-kind piece: 💬 and 🗑 only | `saleQtyGrid` (:2534) with 1 added to `CFG.QTY_GRID`; `saleQtyPick`/`saleQtyTyped` on `state.line` |
| buyer (`o\|buyer`) | `credit_ask_customer`, `cust_find` | `b\|none`, `b\|<custId>` (4 recent buyers of the basket's shop), `b\|new` then the name and phone prompts and the look-alikes (`b\|create`), `ph\|skip` | `saleScreenBuyer` :2572, `saleScreenLookalikes`, `saleScreenName`, `saleScreenPhone`, `saleBuyerPick`/`Named`, `salePhoneTyped` |
| how paid (`o\|method`) | `sale_ask_method` | `m\|CASH`, `m\|<wallet>`, `m\|bank` then `a\|<key>`, `m\|mix` then `a\|<key>` then the transfer part (`x\|half` or typed, purpose `sale_step`), `m\|more`, ➕ `LA\|pm\|SSA\|a` then the name and the kind (`k\|wallet`/`k\|bank`), which go back to how paid | `saleScreenMethod` :2615, `saleScreenAccount` :2646, `saleScreenBankPart` :2667, `saleScreenKind` :2707, `saleKindPick`, `saleAddNamed`, `saleAccountResume` |
| paid now (`o\|paid`) | `sale_ask_paid` | `p\|all` (NEW argument: the whole total), `p\|0`, `p\|half`, `p\|bank` (mixed), ✏️ `p\|other` (typed) | `saleScreenPaid` :2676 with its first button changed from `SC\|id\|ok` to `SS\|a\|p\|all`; `salePaidPick`, `saleNumber` |
| due (`o\|due`, only while owed) | `sale_ask_due` | `d\|<n>` (the first three presets), ✏️ `d\|type` (a typed date), ❓ `d\|none` | `saleScreenDue` :2694, `saleScreenDueText`, `saleDuePick`, `saleDueTyped` (bounds through `saleDueKey`) |
| add (`add`) | `basket_add_ask` (NEW) | the next `/start <id>` (a QR scan) or a typed tag id adds the line (`basketAddScanned`, through `openTag`); the card returns as a new message, a refusal as the card with its reason line on top | NEW |

In each sub-screen, `saleHeader(ports, item, d)` is replaced by the `basket_line` of the basket, and `saleTotal` by
`basketTotals(...).total`.

**Other inputs.**

- **Typed text on the card** (step `card`) is a buyer search (`saleBuyerNamed`), as round 5's first screen read it
  ("typing searches", run_wizard.js:151). Digits are a phone hint.
- **A scan without ➕** starts a fresh card for that tag, as today (`openTag` clears a live state, :125-127). The
  basket's card then reads expired on its next tap. Adding a tag only after ➕ guards against the stale basket of an
  earlier customer silently taking the new piece.
- **Save** `SC|a|ok` (`basketSave`, NEW) runs `basketCheck`. On a problem, the card is redrawn with the problem line
  on top and nothing is written. Otherwise it runs `basketCommitDraft`, then the sold card on the same message, or the
  deposit question when the buyer holds a free deposit and still owes (saleCommit's tail, :3173-3186, kept as
  `basketSoldReply`).
- **Cancel** `SS|a|z` is `saleCancel` (:2790-2803) as it is: the message becomes the anchor's item card and the state
  is cleared. A sold card is never touched.

### 1.7 The Telegram new-piece review card (R5)

A blank tag scanned on Telegram (`new_tag`, as today), then the photo (`handlePhoto`, :2095-2132, which builds the
draft as today), then, in `form` mode, the card below instead of `priceScreen` (`newItemCardText`/`Keyboard`, NEW):

```
📸 ထမီ ပိုးထည် အစိမ်း · ထမီ                                photo_seen
💰 ရောင်းဈေး 25,000          | ⏳ စျေး မသတ်မှတ်ရသေး          item_lbl_price (NEW) | btn_pending
🧵 အရင်း 12,000              | 🧵 အရင်း မသိ                  item_lbl_cost (NEW) | item_lbl_cost_none (NEW)
📈 အမြတ် 13,000 ကျပ် · အရင်းပေါ် 108%                       item_lbl_profit (NEW), when both are known
🔢 ၁ ထည်  (နမူနာ)                                         item_lbl_count (NEW) + sample_mark when set

[25,000][30,000][35,000][20,000]                          P|id|<n>      pricePresets (core_ledger.js:1754), up to 4
[✏️ အခြား] [⏳ စျေး မသတ်မှတ်ရသေး]                          P|id|other · P|id|pending
[🧵 အရင်း] [🔢 အရေအတွက်]                                  C|id|other · NI|id|o|count
[✏️ နာမည်] [🏷 အမျိုးအစား]                                 NI|id|n · NI|id|o|cat
[🧵 နမူနာ: မဟုတ်]                                          PS|id
[✅ သိမ်း] [✖️ မလုပ်တော့]                                  NC|id|ok · Z
```

- **The count sub-screen** (`ask_item_count`, NEW) has `NI|id|q|1`..`q|9`, ✏️ `NI|id|qn` (typed) and ⏮ `NI|id|back`.
- **The category sub-screen** (`ask_item_cat`, NEW) has five `NI|id|c|<0..4>` buttons (indexes into
  `CFG.CATEGORIES`: a Burmese label is up to 21 bytes, an index is 1) and ⏮.
- **Typed answers.** `P|other` takes a price, `C|other` a cost, `qn` a count, `n` a name (`ask_name`). Each comes back
  to the card as a new message. A typed number with no prompt open is the price, today's first question
  (core_bot.js:732-735). A caption number of 500 or more is the price, as today (:2125, :2129).
- `P|`, `C|` and `PS|` keep their handlers. In `form` mode `newItemPrice` and `newItemCost` only set the field and
  redraw the card; they never move a step forward and never write.
- **Save** `NC|id|ok` calls `commitNewItem`, then edits the message to `item_created` · id, sends the owner ping when
  pending (`price_ask_owner` + `priceButtons`) and sends the item card (as :2188-2194).

### 1.8 `quick` (R6, the owner's fallback)

`quick` is exactly round 4 and today's suites: the one-tap card and its corrective buttons, the chat new-piece chain
(price, then cost), no job row, no forms, no review card. The app follows `quick` from Settings, from the per-device
pref `setting:sale_flow` (app_store.js:341-344, pinned by run_app 36), or from an older server (`quickForced`).

---

## 2. Ledger and data

### 2.1 What does not change

There is no new Ledger column, row type, Items column or Settings key. `sale_flow` takes `form` | `quick` (a round-5
Sheet's `steps` reads as `form`). Nothing changes in the Credits, Deposits or Customers columns. The Sheet's Dashboard
formulas sum rows (gas_setup.js:398-430) and accept any number of rows per group (basket map 2.18).

### 2.2 The basket write (`commitBasket`): binding rules

This is the basket map's 3.2-3.3, made the contract.

- **B1.** One group. One SALE row per line, in line order (the order the lines were added). Then at most one PAYMENT
  for the transfer part of a mixed payment (`refGroupId` = the group). One `writeGroup` (core_ledger.js:67-75), so one
  lock on the Sheet (`gasLocked`, gas_main.js:67-73) and one outbox `group` entry on a phone (app_store.js:657-663).
- **B2.** The cash is filled in line order (`basketAllocate`). With `A = twoRows ? cashPart : paid`,
  `rowCash_i = min(amount_i, A - Σ rowCash_<i)`. The row's method is `twoRows ? (rowCash_i ? CASH : '') :
  methodFor(payKey, rowCash_i)`. Every row keeps `0 <= Cash <= Amount`.
- **B3.** DueDay goes on **every** SALE row while the group owes, and is `''` on the PAYMENT. `saleGroupInfo` reads
  the first live SALE row (:1166, :1170), which under B2 is the row most likely to be fully paid.
- **B4.** The buyer goes on every SALE row and on the PAYMENT.
- **B5.** The note on each SALE row is `p.note || (twoRows ? 'split' : owed > 0 ? 'credit' : line.priceChanged ?
  'price' : '')`. The PAYMENT's note is `'split'`.
- **B6.** One row per distinct item (a SKU scanned again raises its count). Every line is of one shop, the first
  line's. At most `CFG.BASKET_MAX_LINES` = 10 lines, far under `SYNC.PUSH_MAX_ROWS` 200 (core_sync.js:43) and under
  Telegram's caption.
- **B7.** One clock read. `when = p.when instanceof Date ? p.when : ports.clock.now()` is taken once and passed to
  every `newTx`, so the rows share one time and one Day. This closes map-core-commits trap 6a (core_ledger.js:32).
- **B8.** A one-line basket writes `commitSaleGroup`'s rows exactly: the same fields, the same order, and `uuid()`
  called SALE first then PAYMENT.
- **B9.** Every line has `unitPrice >= 1` and qty 1..999. `basketCheck` enforces this before the write. `commitBasket`
  clamps the way `commitSaleGroup` does, and throws only on an empty list or more than `BASKET_MAX_LINES` lines (a
  programming error, never a seller's).

### 2.3 Worked examples (the smoke basket of 8.7: S1-0002 × 2, S1-0005, S1-0001)

Part payment: paid 30,000 cash, ဒေါ်မြင့် (C-0001), due in 14 days.

| # | Type | Item | Qty | Amount | Cash | Method | Customer | DueDay | Note |
|---|---|---|---|---|---|---|---|---|---|
| 1 | SALE | S1-0002 | -2 | 36,000 | 30,000 | CASH | C-0001 | today+14 | credit |
| 2 | SALE | S1-0005 | -1 | 22,000 | 0 | '' | C-0001 | today+14 | credit |
| 3 | SALE | S1-0001 | -1 | 25,000 | 0 | '' | C-0001 | today+14 | credit |

`saleGroupInfo`: total 83,000, owed 53,000, dueDay = row 1's. `openCredits`: one entry, item
`basket_name` '🛍 ၃ ခု · လုံချည် ကချင် အပြာ, ထမီ ဇင်းမယ် အဝါ, …'.

Mixed and full: KBZ 20,000, the rest in cash.

| # | Type | Item | Amount | Cash | Method | Note |
|---|---|---|---|---|---|---|
| 1 | SALE | S1-0002 | 36,000 | 36,000 | CASH | split |
| 2 | SALE | S1-0005 | 22,000 | 22,000 | CASH | split |
| 3 | SALE | S1-0001 | 25,000 | 5,000 | CASH | split |
| 4 | PAYMENT | S1-0002 | 20,000 | 20,000 | KBZ | split (`refGroupId` = the group) |

The server's OVERPAID check sees the PAYMENT after all three SALE rows (core_sync.js:811-815, :823), so it raises no
flag.

### 2.4 One receipt number per basket

Today a phone stamps a fresh `receiptNo` on every SALE row (app/app_store.js:296-299; poc/sim_phone.js:123-125), which
uses up three numbers for a three-line basket (basket map 2.11). The rule now: inside a collector, a SALE row whose
group already has a stamped SALE row in that collector takes **the same number**. Otherwise it is stamped anew. The
counter grows by one per group. Copying (rather than leaving rows 2..N blank) matches what `rewriteRows` carries
(core_ledger.js:1074) and what `backfillSync` would write (gas_sync.js:460-467). `appReceiptGroupFor` finds the group
by any row (app_ui.js:760). Telegram rows are unchanged (`receiptNumber` counts groups, core_ledger.js:1729-1751).

### 2.5 The new piece (`commitNewItem`)

It does `updateItem(id, {name, category, type: count > 1 ? SKU : UNIQUE, price ('' = pending), cost ('' = unknown),
sample, photoUrl, photoFileId, createdAt, createdBy})`, then ONE RESTOCK row of `qty: count`, with note `'new item'` or
`'new sample'` and source `PHOTO`. These are the fields and the order of `newItemCost` (core_bot.js:2183-2187). The
precedent for SKU with a count is `importProducts` (core_ledger.js:1803-1813). `type` is a synced item field
(core_sync.js:69). The item entry is pushed before the group (`SYNC.ENTRY_KINDS`, core_sync.js:75).

### 2.6 Restock and expense

- **Restock group:** N RESTOCK rows of one shop, one group, one undo. Note `''`, source `BUTTON`.
- **Expense:** one EXPENSE row exactly as `commitExpense` writes it today (core_ledger.js:882-890). The note goes in the
  row at once, not as a later rewrite.

### 2.7 CFG (core_config.js)

- `SALE_FLOW: { FORM: 'form', QUICK: 'quick' }`. `STEPS` is removed; its only readers, core_config.js:209 and
  gas_setup.js:76, change.
- `BASKET_MAX_LINES: 10`, `BASKET_NAME_MAX: 24`.
- No new `SOURCE` value. Forms write `BUTTON` (sale, restock, expense) and `PHOTO` (the new piece's RESTOCK), as the
  chat flows do. `source` is read only by the Sheet column and the simulator's Ledger tab (sim_ui.js:713).

---

## 3. Core functions

All new names were grepped across `apps-script/`, `app/`, `poc/` and `tools/` (dist excluded): none is used today.
Everything is ES5 in one global scope. The load sets are kept: core_ledger.js calls nothing of core_bot.js,
core_orders.js or core_sync.js.

### 3.1 core_config.js

- `saleFlow(ports)` (:207-210): `'quick'` when the trimmed, lower-cased value is `quick`, else `'form'`. Its comment
  (:109-110) and the CFG block change as in 2.7.

### 3.2 core_ledger.js

Pure helpers (no ports):

```
basketAllocate(amounts, cash) -> [n]
  // B2; Σ = cash when cash <= Σ amounts; each 0..amount_i.
basketTotals(lines, pay) -> {amounts, total, paid, bankPart, cashPart, owed, payKey, twoRows, rowCash, pending}
  // lines = [{qty, unitPrice}] (unitPrice null/'' = pending: amount 0, index listed in pending);
  // pay = {paid (null = full), method, mixed, bankPart}; commitSaleGroup's derivations (:826-837) on the sum,
  // then basketAllocate. The app's live total, the card's text and commitBasket all use it.
saleDueKey(now, choice) -> 'yyyy-mm-dd' | '' | null
  // choice: a whole number of days 0..CFG.SALE_DUE_MAX_DAYS -> addDaysKey(dayKey(now), n); 'none' or '' -> '';
  // a typed date -> parseDayText(text, now, {noRoll: true}), kept only from today to today + 365; null = refused.
  // The bounds of saleDuePick / saleDueTyped (core_bot.js:2997-3001, :3012-3013) in one place.
itemMargin(price, cost) -> {profit, pct} | null
  // null unless both are numbers >= 1; profit = price - cost; pct = Math.round(profit * 100 / cost) (markup on cost).
itemPlaceholderName(id) -> 'ပစ္စည်း ' + id
  // the placeholder of handlePhoto (core_bot.js:2122) and of the AI replay (app_sync.js:390); those two literals stay.
```

Store readers (no writes):

```
basketAddItem(ports, staff, lines, itemId, qty) -> {ok: true, lines, index, merged} | {ok: false, reason, vars}
  // reason -> key: missing tag_not_found · blank basket_blank · other_shop basket_other_shop · gone basket_gone ·
  //               twice basket_twice · max basket_max. Returns new arrays, never mutates.
  // shop = lines[0]'s item shop, else (owner ? item.shop : staff.shop). A UNIQUE piece is count 1. A pending-price
  // item is accepted (unitPrice null).
basketCheck(ports, staff, draft) -> {ok, problems: [{code, id, key, vars}]}
  // draft = {lines: [{id, qty, unitPrice, priceChanged}], paid, method, mixed, bankPart, customerId, newName,
  //          newPhone, dueDay}
  // Each line is re-read from the store. The codes and their keys, in order:
  //   empty ui_form_empty · missing tag_not_found · blank basket_blank · other_shop basket_other_shop ·
  //   gone basket_line_gone · twice basket_twice · max basket_max · need_price basket_need_price · qty bad_qty ·
  //   paid sale_bad_amount{min 0, max total} · transfer sale_bad_amount{min 0, max paid} · method expired (not
  //   methodKnown) · need_buyer sale_need_buyer (owed > 0, no customerId and no newName) · phone ord_ask_phone
  //   (a new phone of 1-6 digits) · due ord_bad_date (dueDay not '' and not today..+365).
basketName(ports, info) -> fill(basket_name, {n, names})
  // for openCredits; the names of the live rows joined by ', ' and cut to BASKET_NAME_MAX each.
newItemDraft(ports, staff, itemId, desc) -> {itemId, name, category, price: '', cost: '', count: 1, sample: false}
  // handlePhoto's defaults (:2122-2124): the AI name or the placeholder; the AI category if listed, else the last.
```

Writes:

```
commitBasket(ports, p) -> {groupId, txs, sales: [tx], payment: tx | null, owed, total}
  // p = {lines: [{item, qty, unitPrice, priceChanged}], paid, method, bankPart, mixed, customerId, dueDay, note,
  //      staff, source, transcript, updateId, when}; the rules B1-B9; the transcript goes on the first SALE row only.
commitSaleGroup(ports, p)   // kept, its doc comment kept; the body becomes:
  //   var r = commitBasket(ports, {lines: [{item: p.item, qty: p.qty, unitPrice: p.unitPrice,
  //     priceChanged: p.priceChanged}], paid: p.paid, …every other field…});
  //   return {groupId: r.groupId, txs: r.txs, sale: r.sales[0], payment: r.payment, owed: r.owed};
  // (a field-by-field literal: merge() lives in core_bot.js:3262 and core_ledger may not call it)
commitNewItem(ports, p) -> {ok: true, item, groupId, pending} | {ok: false, reason}
  // p = {itemId, name, category, price, cost, count, sample, photoUrl, photoFileId, staff, source, updateId, when}
  // reason: 'missing' | 'not_blank' (status is not BLANK: registered meanwhile) | 'count' (not 1..999) |
  //         'price' | 'cost' (negative or not whole). An empty name becomes itemPlaceholderName(id); a category not
  //         in CFG.CATEGORIES becomes the last one. Then the writes of 2.5.
  //         pending = price === '' || !(Number(price) > 0)   (isPricePending lives in core_bot.js:181).
commitRestockGroup(ports, p) -> {ok: true, groupId, txs} | {ok: false, reason}
  // p = {lines: [{item, qty}], note, staff, source, updateId, when}; reason 'empty' | 'qty' | 'unique' |
  // 'other_shop'; one RESTOCK per line, one writeGroup, one clock read. commitRestock (:857-864) stays for the
  // one-item paths.
```

Reader change: `openCredits` (:1253-1256) sets `itemName = basketName(ports, info)` when `info.rows.length > 1 &&
!isOrderId(groupId)`. The voucher branch is unchanged.

### 3.3 core_bot.js

#### 3.3.1 Entry points (the only lines outside the review card that change)

| Where | Today | Round 6 |
|---|---|---|
| `ITEM_ACTIONS` :431 | … `SS`, `SC` | + `NI`, `NC` |
| `MUTATING_ACTIONS` :435-436 | … `SC` | + `NC` |
| the `S` exemption :446 | `saleFlow === 'steps'` | `=== 'form'` |
| `case 'S'` :463-471 | steps: `startGuidedSale` | form: `startSaleFor(sctx, item, clampQty(arg), {})`; quick unchanged |
| `case 'Q'` :473-481 | steps: the grid as a flow screen | the steps branch removed: both modes call `askQty` as quick does (its digits `S\|id\|n` open the card in form mode) |
| `case 'QN'` :482-492, `case 'D'` :494-507 | steps branches | removed: both modes set the `sale_qty` / `sale_price` prompt as quick does (:490-491, :505-506) |
| `case 'SS'`/`'SC'` :511-512 | `saleCallback` / `saleCommit` | `basketCallback` / `basketSave` |
| new `case 'NI'` / `'NC'` | none | `newItemCallback` / `newItemSave` |
| `P\|`, `C\|`, `PS\|` (`newItemPrice` :2154, `newItemCost` :2172, `toggleSample` :2145) | advance the chain | form: set the field and `newItemCardRedraw`; quick unchanged |
| `applyAwaitedNumber` :772, :783-793, :815 | steps branches | `sale_price` / `sale_qty` with a saved basket: that line's price / count, then the card (new message); with no saved state in form: `startSaleFor(item, n or 1, {unitPrice, priceChanged})`; `sale_step`: `saleNumber`, which now exits to the card |
| `handleText` :704-705, :723, :732-735 | tag id → `openTag`; `saleText`; new-item numbers by step | `saleText` adapted (a step-`card` text is a buyer search); new-item steps `price`, `cost`, `count` (number) and `name` (text) |
| `handleIntent` :843-849, :890-896, :904-918, :931-934 | spoken answers into the step | the same, into the open sub-screen (the step names are kept); a spoken count goes to the open line; the clash rule checks every line of the basket |
| `confirmProposal` :1129-1130 | a spoken sale of the same piece clears the flow | the same when the piece is any line of the basket |
| `openTag` :105-129 | clears a live state on any known tag | (1) state `kind 'sale', step 'add'`: `basketAddScanned`; (2) `form` in the app: blank → `ports.ui.newItemForm(req)` (`newItemFormEnabled`), a sellable item (1.1) → `ports.ui.saleForm(req)` (`saleFormEnabled`); the rest as today |
| `handlePhoto` :2125-2131 | `priceScreen` | form and not `newItemFormEnabled`: `newItemCardSend` |
| `cardText` buyer line :193-206 | `card_buyer` | `card_buyer_basket` when `info.rows.length > 1` |
| `U\|` / `V\|` replies :541-560 | `undo_done` + the first item's card | when the group had more than one SALE row: `undo_done` + `basket_line` + one `basket_card_line` with `basket_stock` per item |
| `customerCard` :1689 | one `customerLine` per row | `customerLines(ports, customerId, n)` (NEW): a basket's SALE rows make one line (`desc` = `txLabel(SALE) + ' ' + basket_short`, amount and cash summed, the first paying row's method); still at most 8 lines |
| `saleCardText` :3194-3218 | the first item's card + `sold_done` | when `info.rows.length > 1`: `basket_sold` (it starts with '✅ ရောင်းပြီး', the `sold_done` mark `saleSoldCard` looks for at :2385) + one `basket_card_line` with `basket_stock` per item; the group lines (credit_done, split_done, method_done, sale_due_set, acct_detail_hint) as today |

New predicates and the router: `saleFormEnabled(ports)` = `!!(ports.ui && ports.ui.saleForm)` and
`newItemFormEnabled(ports)` likewise (the `measureFormEnabled` shape, :4183).
`startSaleFor(ctx, item, qty, draft)` calls `ports.ui.saleForm({chatId, uid, staff, itemId, qty, unitPrice})` when
`saleFormEnabled`, else `startBasket(ctx, item, qty, draft)`. Telegram and the reference phone (poc/sim_phone.js) have
no `ports.ui`, so they get the card.

#### 3.3.2 The review card's state

`st:<uid>`, TTL `STATE_TTL_SEC` 1800 s (as round 5):

```
{ kind: 'sale', step: 'card' | 'line' | 'add' | 'buyer' | 'name' | 'phone' | 'method' | 'account' | 'bank' | 'paid' |
        'due' | 'due_text' | 'kind',
  item: <the anchor id>, msgId, acct: 'bank' | 'wallet' | 'all', line: <item id of the open line sub-screen> | '',
  draft: { lines: [{id, qty, unitPrice, priceChanged}], customerId, newName, newPhone, needBuyer, method, mixed,
           bankPart, paid, dueDay, addLabel, addedKey } }
```

There is no `hist`. `draft.qty`, `draft.unitPrice` and `draft.priceChanged` move into `lines[]`. The typed prompts
wrap it as today: `{kind: 'await_number', purpose: 'sale_step' | 'sale_qty' | 'sale_price', saved}`, and ➕ wraps it in
`saved` with resume `SSA`. `saleStateOf` (:2340-2347) reads through them unchanged.

#### 3.3.3 The round-5 section (core_bot.js:2287-3224), function by function

The verdicts follow map-core-commits 7.3, settled. DEAD code is deleted in step 1, together with the checks that pin
only it (8.1).

| Verdict | Functions |
|---|---|
| **REUSE as is** | `saleCtx`, `saleShownId`, `saleDuePresets`, `saleSoldCard`, `saleRedraw` (draws `step`'s screen; `card` is a new case of `saleScreenFor`), `saleScreenLookalikes`, `saleScreenName`, `saleScreenPhone`, `saleAccountCandidates`, `saleScreenAccount`, `saleScreenBankPart`, `saleScreenKind`, `saleScreenDueText`, `saleCancel`, `saleKindPick`, `saleAddNamed`, `saleResolveBuyer` (+1 rule below), `saleCardKeyboard`, `saleStateOf` |
| **ADAPT** | `saleGuard` (rule (c): `o`, `l` and `add` only at step `card`; `q`, `qn`, `pr` and `rm` only at step `line`); `saleScreenFor` (+ `card`, `line`, `add`); `saleBackRow` (⏮ is `back\|card`, or `back\|<sub>` from a prompt opened in that sub-screen); `saleScreenBuyer`, `saleScreenMethod`, `saleScreenPaid` (first button `p\|all`), `saleScreenDue`, `saleScreenQty`/`saleQtyGrid` (the line grid adds 1): the header becomes `basket_line` and the total `basketTotals`; `saleAfterAccount` (the end of the chain is the card); `saleCallback` (+ letters `o`, `l`, `add`, `rm`, `qn`, `pr`, `p\|all`, `back\|card`); `saleQtyPick`/`saleQtyTyped` (on `state.line`); `saleBuyerPick`, `saleBuyerChosen`, `saleBuyerNamed`, `salePhoneTyped`, `salePhoneSkip`, `saleMethodPick`, `saleAccountPick`, `saleBankHalf`, `saleNumber`, `salePaidPick`, `saleDuePick`, `saleDueTyped` (every exit that called `saleNext` now calls `saleRedraw` with step `card`; the bounds stay); `saleAccountResume` (back to the how-paid sub-screen); `saleText` (step `card` is a buyer search, step `add` is a tag id); `saleIntentClashes`, `saleResend` (any line; redraw the card); `saleCardText` (the basket branch); `startGuidedSale` becomes `startBasket` (the sold-meanwhile check, the identical-tap rule, then the card; no `saleGo`); `saleFromPrice` (sets the line price, then the card); `saleTotal` becomes a call to `basketTotals` |
| **DEAD, deleted** | `saleGo` (the `hist` push), `saleNext` (two of its rules survive in `basketCheck`: a part payment needs a buyer, :2477; one account is picked for you, :2471, now in the method sub-screen), `saleBuyerScreen` (the `hist` trick), `saleBack`'s pop and `SALE_BACK_CLEARS` (:2309-2312; the rule "back from a prompt redraws its sub-screen" survives in `saleBackRow`), `saleScreenSummary` (:2714-2720; its body is the card's text), `SALE_STEP_OF`'s `summary` entry, `saleCommit` (:3155-3187; its tail moves to `basketSoldReply`), the steps branches of 3.3.1 |
| **NEW** | `startSaleFor`, `startBasket`, `basketCardText(ports, state)`, `basketCardKeyboard(ports, state)`, `basketCallback(ctx, parts, item, message)` (the letters, then `saleCallback`'s answer letters), `basketAddScanned(ctx, state, itemId)`, `basketSave(ctx, item, message)`, `basketCommitDraft(ports, staff, draft, opts)`, `basketSoldReply(ports, chatId, msgId, isCaption, r, draft, customer)`, `customerLines`, `saleFormEnabled`, `newItemFormEnabled`, and the five new-piece functions of 3.3.5 |

`saleResolveBuyer` (:3140-3148) gains one rule: a `newPhone` that normalises (`normPhone`) to exactly one customer's
phone resolves to that customer. This is a backstop for the app form. Telegram's phone step already offers that
customer (`salePhoneTyped`'s rule, run_wizard.js:353).

#### 3.3.4 The shared save (both channels)

```
basketCommitDraft(ports, staff, draft, opts) -> {ok: true, r, customer} | {ok: false, problems}
  // 1. basketCheck(ports, staff, draft); refuse with its problems.
  // 2. customer = saleResolveBuyer(ports, draft) (the Customers row is written here, at Save only).
  // 3. r = commitBasket(ports, {lines (re-read items), paid, method, bankPart, mixed, customerId, dueDay,
  //        staff, source: opts.source || CFG.SOURCE.BUTTON, updateId: opts.updateId}).
  // 4. setLastItem(first line), setLastGroup(r.groupId) (core_bot.js:3249-3259).
basketSoldReply(ports, chatId, msgId, isCaption, r, draft, customer)
  // saleCommit's tail (:3176-3186): markCommittedCard when msgId; saleCardText(r.groupId, draft.addedKey);
  // the deposit question when customer && r.owed > 0 && depositsFree > 0 (CD| buttons), else saleCardKeyboard;
  // editOrSend: msgId null sends a new message, which is how the app gets its sold card.
basketSave(ctx, item, message)
  // saleGuard; step must be 'card'; basketCommitDraft; refusal -> the card again with the first problem's line on top;
  // ok -> clearState, basketSoldReply.
```

The app adds the Lists row of a new account just before `basketCommitDraft` (6.2). Telegram has already written it at
the kind step (round-5 D6).

#### 3.3.5 The new-piece review card

- State: `{kind: 'new_item', itemId, step: 'card' | 'price' | 'cost' | 'count' | 'name' | 'cat', draft, msgId}`. The
  `kind` and the steps `photo`, `price` and `cost` are today's, so `appInputModeFor` (app_ui.js:71) keeps mapping
  them. The app never draws this card (it has `ports.ui.newItemForm`), so app_ui.js:71 needs no change.
- `newItemCardText(ports, state)` and `newItemCardKeyboard(ports, state)` draw 1.7.
- `newItemCardSend` sends it after `handlePhoto`. `newItemCardRedraw` edits it after a tap, or sends it after a typed
  answer.
- `newItemCallback(ctx, parts)` handles the letters `o|count`, `o|cat`, `q|<n>`, `qn`, `n`, `c|<i>`, `back`. Its guard:
  `state.kind === 'new_item' && state.itemId === id`, else `expired` (as `newItemPrice`, :2156).
- `newItemSave(ctx)` calls `commitNewItem`. On `not_blank` the message says `expired` and the item card follows. On
  ok it runs the tail of `newItemCost` (:2188-2194). `newItemCost` keeps its `quick` body and, in `form`, only stores
  the cost.

#### 3.3.6 Callbacks (64 bytes; tag ids are `S\d-\d{4}`, 7 bytes)

| Callback | Bytes | Writes | In |
|---|---|---|---|
| `SS\|S1-0002\|l\|S1-0005` | 20 | no | ITEM_ACTIONS |
| `SS\|S1-0002\|rm\|S1-0005` | 21 | no | ITEM_ACTIONS |
| `SS\|S1-0002\|add` / `qn` / `pr` | 14 / 13 / 13 | no | ITEM_ACTIONS |
| `SS\|S1-0002\|q\|9` | 14 | no | ITEM_ACTIONS |
| `SS\|S1-0002\|o\|method` (the longest `o`) | 19 | no | ITEM_ACTIONS |
| `SS\|S1-0002\|p\|all` | 16 | no | ITEM_ACTIONS |
| `SS\|S1-0002\|back\|card` | 20 | no | ITEM_ACTIONS |
| `SS\|S1-0002\|a\|<12-byte key>` (as round 5) | 25 | no | ITEM_ACTIONS |
| `SC\|S1-0002\|ok` | 13 | yes | ITEM_ACTIONS, MUTATING |
| `NI\|S1-0007\|o\|count` / `o\|cat` | 18 / 16 | no | ITEM_ACTIONS |
| `NI\|S1-0007\|q\|9` / `c\|4` / `qn` / `n` / `back` | 14 / 14 / 13 / 12 / 15 | no | ITEM_ACTIONS |
| `NC\|S1-0007\|ok` | 13 | yes | ITEM_ACTIONS, MUTATING |
| `CD\|<g>\|yes\|p\|<12-byte key>` (as round 5) | 58 | yes | MUTATING |

#### 3.3.7 Stale, double and late taps

The rules are round 5's, kept by `saleGuard`:

- (a) No basket state for this anchor: the message reads `expired` and a fresh item card follows. A sold card is never
  edited (the reply is a new `expired` message).
- (b) A message older than the live card reads `expired`, and the basket is untouched.
- (c) A letter that does not belong to the open sub-screen (or to the card) is ignored, with no edit. Answer letters
  tapped while the card shows are therefore no-ops, never shortcuts. A second tap of an answer whose sub-screen has
  already returned to the card cannot redo it.

Further rules:

- `SC` and `NC` are in `MUTATING_ACTIONS`: a second tap within 120 s is ignored (:446-450).
- A late tap on a sold card never edits it (`saleSoldCard` with the `basket_sold` prefix, `isCommittedCard`).
- A scan without ➕ starts a fresh card (1.6).
- In the app the form disables its own Save. The tap guard covers callbacks only (map-app-forms 19.9).

### 3.4 core_report.js

`describeBasket(ports, txs)` (NEW, next to `describeRow` :91-99) returns
`txLabel(CFG.TX.SALE) + ' ' + basket_short + (customer ? ' · 👤 ' + name : '') + ' · ' + fmtMoney(total) + ' ကျပ်'`,
with the `' ကျပ်'` literal as `describeRow` has it. The app's pending line uses it (6.4). The receipt and the reports are
unchanged (basket map 2.3, 2.8).

### 3.5 Messages

#### 3.5.1 NEW keys in core_messages.js

These are drafts for a native speaker, as the file header asks. None contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ,
and none starts with '🏦 ' (the round-4 rule).

| Key | Burmese (proposed) | Used by |
|---|---|---|
| `basket_line` | 🛍 {n} ခု · {amount} | card head, sold card, undo reply |
| `basket_card_line` | {emoji} {id} · {name} × {qty} · {amount}{stock} | card and sold-card lines |
| `basket_stock` | ' · လက်ကျန် {stock}' | sold card and undo reply |
| `basket_sold` | ✅ ရောင်းပြီး 🛍 {n} ခု · {qty} ထည် · {amount} ကျပ် | the sold card of a basket |
| `basket_name` | 🛍 {n} ခု · {names} | Credits item, credit reports |
| `basket_short` | 🛍 {n} ခု | customer card line, pending line |
| `card_buyer_basket` | 👤 {customer} · 🛍 {n} ခု · ပေးပြီး {paid} · {method} | sold-out piece card |
| `basket_add_ask` | ➕ နောက်ထပ် Tag ကို scan လုပ်ပါ (သို့) နံပါတ် ရိုက်ပါ | the add sub-screen |
| `basket_twice` | ℹ️ {id} ထည့်ပြီးသားပါ | add refusal |
| `basket_other_shop` | ⚠️ {id} · {shop} က ပစ္စည်းပါ · မထည့်ပါ | add refusal, S| in form on another shop's item |
| `basket_gone` | ⚠️ {id} ရောင်းပြီးသားပါ · မထည့်ပါ | add refusal |
| `basket_line_gone` | ⚠️ {id} ရောင်းပြီးသားပါ · ဖယ်ပြီးမှ သိမ်းပါ | Save refusal (sold meanwhile) |
| `basket_blank` | ℹ️ {id} က Tag အသစ်ပါ · အရင် ဓာတ်ပုံနဲ့ မှတ်ပါ | add refusal |
| `basket_max` | ℹ️ တစ်ခါ ရောင်းရင် {max} ခု အထိပါ | add refusal |
| `basket_need_price` | 💬 {id} · ရောင်းဈေး ရိုက်ပါ | Save refusal |
| `basket_unique` | ℹ️ {id} က တစ်ထည်တည်း ပစ္စည်းပါ · ကုန်ရောက် မမှတ်နိုင်ပါ | restock refusal |
| `btn_add_item` | ➕ ပစ္စည်း ထပ်ထည့် | card |
| `btn_remove_line` | 🗑 ဖယ် | line sub-screen, app line |
| `btn_card_line` | {emoji} {id} × {qty} | card line buttons |
| `btn_card_buyer` | 👤 {customer} | card, once a buyer is set |
| `btn_card_pay` | 💰 {method} | card |
| `btn_card_paid` | 💳 ပေးပြီး {paid} | card (part payment) |
| `btn_card_due` | 📅 {date} | card (owed) |
| `item_lbl_price` | 💰 ရောင်းဈေး {price} | new-piece card |
| `item_lbl_cost` | 🧵 အရင်း {cost} | new-piece card |
| `item_lbl_cost_none` | 🧵 အရင်း မသိ | new-piece card |
| `item_lbl_profit` | 📈 အမြတ် {profit} ကျပ် · အရင်းပေါ် {pct}% | new-piece card and form |
| `item_lbl_count` | 🔢 {count} ထည် | new-piece card |
| `btn_item_name` | ✏️ နာမည် | card and form label |
| `btn_item_cat` | 🏷 အမျိုးအစား | card and form label |
| `btn_item_price` | 💰 ရောင်းဈေး | form label |
| `btn_item_cost` | 🧵 အရင်း | card and form label |
| `ask_item_count` | 🔢 ဘယ်နှစ်ထည် ရှိလဲ? | count sub-screen |
| `ask_item_cat` | 🏷 ဘာ အမျိုးအစားလဲ? | category sub-screen |

#### 3.5.2 Changed key (one)

`settings_note_sale_flow` (core_messages.js:448) changes from 'steps = တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက်
ရောင်း' to **'form = တစ်မျက်နှာတည်း ဖြည့်ပြီး သိမ်း · quick = ခလုတ်တစ်ချက် ရောင်း'**. run_wizard.js:1633 pins the
old text; its successor names this change (8.1).

#### 3.5.3 Kept and reused

No round-5 key is deleted (that would touch run_gas.js:1498, `R5_KEYS`, and run_wizard 1619/1623).
`sale_ask_paid`, `confirm_ask`, `btn_yes` and the other step texts stay in MSG; most are still drawn by the
sub-screens. The keys reused word for word are listed in map-app-forms 12 and map-core-commits 8.6.

---

## 4. Readers (R7)

Every change below applies only when the group has more than one live SALE row. A one-line group, a delivery and a
mixed one-item sale take today's path, byte for byte. The allocation rule every reader agrees with is B2 (fill in line
order). The readers that print each row's cash (the customer statement "စာရင်း", the day report, the Ledger tab) show
it as it is, which is the correct per-row money.

| Reader (file:line) | On a basket today (basket map) | Change | Pinned by |
|---|---|---|---|
| sold card `saleCardText` core_bot.js:3194-3218 | the first item's card; qty summed; the first item's stock | `basket_sold` + one `basket_card_line` + `basket_stock` per item; the group lines unchanged | W27a |
| item card buyer line `cardText` :193-206 | the whole basket's money under one piece | `card_buyer_basket` (says it is the basket's) | W27b |
| Credits item name `openCredits` core_ledger.js:1253-1256, so also the Credits tab (gas_store.js:710-716), the three credit reports (core_report.js:229, :281, :315) and the simulator's Credits | the first item's name | `basketName` | W27c, gas 26 |
| undo / void reply core_bot.js:541-560 | `undo_done` + the first item's card | `undo_done` + `basket_line` + each item with `basket_stock` | W27d |
| customer card `customerCard` :1681-1702 | N lines, each with its own `ပေး` | one line per basket (`customerLines`) | W27e |
| 21:00 summary overdue line core_ledger.js:1653-1666 | correct only if row 1 has the DueDay | none: B3 puts it on every row | W27f, SIM.smoke 21:00 |
| receipt / PDF core_report.js:331-409 | one line per item, correct | none | W27g |
| `dayStats`, `monthStats`, Dashboard, `answerToday` | per row, correct | none | W27g |
| `saleGroupInfo`, `groupMethods`, `undoGroup`, `rewriteCheck` (answers `complex`) | correct | none | W26 |
| app pending line `pendingLines` app_sync.js:496-503 | the first row only | `describeBasket` when the entry has 2+ SALE rows | run_app 54 |
| phone receipt counter app_store.js:296-299, sim_phone.js:123-125 | one number per row | one per group, copied (2.4) | run_app 43, R6a |
| simulator Ledger tab sim_ui.js:707-724 | N unrelated-looking rows | a narrow `Basket` column showing `🛍 i/n` on rows of a group with 2+ SALE rows (page copy) | 8.7 manual |
| server: validation, `stock_negative`, `overpaid` core_sync.js:361-421, :807-815 | accepts; correct when the PAYMENT is last | none (B1, B6) | R6a, R6c |

The `stock_negative` ping's void undoes the whole basket (basket map 2.15). This is kept: a basket has no per-line
undo (section 10).

---

## 5. Glue and sync

- **apps-script/gas_setup.js:76** seeds `['sale_flow', CFG.SALE_FLOW.FORM]`. The comment at :74-75 and the doc line at
  :15 say `form`. The note on the Key cell (:85-93) is unchanged in code; its text is the new
  `settings_note_sale_flow`. setupSheet still never overwrites a typed value (have/defaults, :78-79), so a Sheet where
  the owner typed `quick` keeps it.
- **apps-script/core_sync.js:** no change. `SYNC.CAPS` stays `['dueDay']`, and `syncSettingsQuick` (:1489-1494) still
  writes `quick`. A basket passes `syncValidateBatch` (:399-445): every row is of one shop (B6), 11 rows at most.
- **gas_store.js, gas_sync.js, gas_main.js, gas_telegram.js:** no change. A basket is N `appendRow` calls under one
  `gasLocked` (gas_store.js:391-410), at most 11, well inside the 15 s lock. A review card whose caption edit fails
  falls back to a new message (gas_telegram.js:52-60), and `saleShownId` follows it.
- **poc/sim_phone.js:121-126:** the receipt copy of 2.4, the twin of the app store.
- **poc/fake_gas.js, poc/sim_sync.js, poc/sim_ports.js:** no change expected.
- **Two photo defects that already exist today are named, not fixed** (map-app-forms surprise 2, 17):
  - A piece registered on a phone stores its local media id (`photo_3`) as `photoFileId` (core_sync.js:719-739).
    Telegram's `sendItemCard` prefers it (core_bot.js:240-242), so that piece shows as text in Telegram. Media ids are
    a per-phone counter, so another phone may show its own `photo_3`.
  - A photo job sent before the item write lets the later item entry overwrite the Drive URL with `local://`. The form
    reduces this second case: when the media already holds the job's result, `appNewItemSave` writes
    `photoUrl: media.result.photoUrl` (the Drive URL) instead of `local://<id>` (6.5).
- **Migration (for apps-script/README.md):** nothing new beyond round 5's list. The owner's fallback is to type
  `quick` in Settings `sale_flow`; the app follows at its next pull.

---

## 6. App

### 6.1 Files and the four load lists

There is one new file, `app/app_forms.js` (ES5). It goes last in `APP_FIRST` (tools/build_app.js:30) and last in
`FRAME_FILES` (poc/build_simulator.js:28). check_simulator.js:87 compares those two lists, so it stays green once both
change. It also goes last in `FILES` (poc/run_app.js:17-24), and gets a `<script src="../app_forms.js">` after
`app_ui.js` on the dev page (app/dev/index.html:130). app/index.html loads the bundle only, so it does not change. The
shell ids that check_simulator.js:93 pins are kept. `app/config.js` and `tools/publish*.js` are untouched.

### 6.2 app/app_forms.js

**The form object.**

```
APP.form = F = { kind: 'sale' | 'newitem' | 'restock' | 'expense', req, values, model, dirty, saving, restored,
                 takesTags: true | 'blank' | false, el, scanner, videoEl, timer, photoBusy }
```

**Pure part.** It uses no DOM. It reads `phone.ports` and `phone.store` and is tested in Node like `appMeas*`
(app_ui.js:117-259).

| Function | Does |
|---|---|
| `appFormDraftKey(kind, uid)` / `appFormDraftRead(store, kind, uid)` / `appFormDraftWrite(store, kind, uid, values)` / `appFormDraftDrop(store, kind, uid)` | the draft in the persisted cache, `formdraft:<kind>:<uid>`, TTL one day; unreadable means none (the `appMeasDraft*` shape, :200-215) |
| `appHomeJobs(ports)` | `['sell', 'new', 'restock', 'expense']` under `form`, `[]` under `quick` |
| `appSaleModel(phone, values)` | the lines with name, emoji, type, stock, price and amount; the basket shop; `basketTotals`; wallets and banks (`payMethodsByKind` of the shop); `canMix` (total >= 2); the recent buyers (`recentCustomers(ports, shop, 6)`); the matches (`findCustomers`, 6); the due presets; the live `problems` (`basketCheck`); the reveal flags of 1.2 (a)-(e) |
| `appSaleAdd(phone, values, itemId)` | `basketAddItem`; returns `{ok, values}` or `{ok: false, text}` (the problem key filled) |
| `appSaleSet(values, f, v)` | the one state change for a control name (`qty+:<id>`, `qty-:<id>`, `qty:<id>`, `price:<id>`, `remove:<id>`, `buyer`, `buyer:<id>`, `buyer:new`, `buyer:clear`, `name`, `phone`, `pay:<key>` (key = CASH, a wallet, `bank` or `mix`), `acct:<key>`, `transfer`, `paid:full`, `paid:part`, `amount`, `due:<n>` (n = a day count, `date` or `none`), `date`, `addacct`, `acctname`, `acctkind:<k>`); returns new values. The DOM and the simulator's `set` op both call it |
| `appSaleDraftOf(phone, values)` | the `basketCheck`/`basketCommitDraft` draft (`dueDay` by `saleDueKey`; `paid` null when full; `method` from the segment or the account) |
| `appSaleSave(phone, F)` | refuses with `{ok: false, reason: 'busy'}` while `F.saving`. A new account first goes through `addListOptionByLabel(ports, 'pay_method', label, staff, {kind})`, whose key becomes the method; a refusal is returned. Then `basketCommitDraft(ports, staff, draft, {source: BUTTON, updateId: store.nextUpdateId()})`, `clearState`, `basketSoldReply(ports, uid, null, false, r, draft, customer)` (the sold card pushed to the phone's own chat, app_ports.js:94-99), `appFormDraftDrop`. Returns `{ok, groupId}`. It writes nothing durable |
| `appNewItemModel(phone, values)` / `appNewItemSet` / `appNewItemPhoto(phone, F, rec)` / `appNewItemSave(phone, F)` / `appNewItemAbandon(phone, F)` | 1.3; the photo and the AI in 6.5; Save = `commitNewItem` (`photoUrl` per 5), then `notifyOwners(price_ask_owner, priceButtons)` when pending, then `item_created` · id and `sendItemCard` to the phone's chat |
| `appRestockModel` / `appRestockAdd` / `appRestockSet` / `appRestockSave` | 1.4; `commitRestockGroup`; the reply of 1.4 |
| `appExpenseModel` / `appExpenseSet` / `appExpenseSave` | 1.5; `addListOptionByLabel('expense_category')` when a new category is typed; `commitExpense`; the reply of 1.5 |
| `appFormCommit(phone, sync, kind)` | `phone.commit(kind)`, then `sync.scheduleSync()` when ok; resolves true or false (the `appMeasCommit` shape, :257-259) |
| `appFormSnap()` | `null`, or `{kind, lines: [{id, qty, price}], buyer: {id, name, phone}, pay, acct, transfer, paid: 'full' \| 'part', amount, due, total, error, saved, itemId, name, category, cost, count, sample, photo, aiName}` for the simulator (7.2) |

**DOM part.**

| Function | Does |
|---|---|
| `appOpenForm(req)` | closes another form, `appCloseOverlay()`, `appStopScanner()`, `clearState(ports, uid)` (map-app-forms 16), restores the draft, builds `F`, sets `APP.form`, then `appFormMount(appFormRender(F))`, then starts the form scanner when the pref `cameraOk` is set |
| `appFormRender(F)` | the whole `div#<kind>Form.formpage[role=dialog]`, built with `APP.doc.createElement` only. Every control carries `data-f="<name>"` (the names of `appSaleSet` and its twins) and the class `hot` when `APP.win.SIM_HOT === 'f:' + name`. Labels go through `APP.tt`, every input has an `aria-label`, amounts use `inputmode=numeric`, the phone uses `inputmode=tel`, a date is an inline `<input type=date min=today>` |
| `appFormMount(el)` / `appFormRepaint(F)` | `document.body.appendChild` (once), then a re-render that replaces `F.el`'s children and keeps focus on the same `data-f` |
| `appFormTag(F, id)` | the router target: the kind's `Add`, a toast and `.fmsg` on a refusal, a repaint, a draft write, and a scanner restart after 700 ms (the scanner stops itself after each decode, app_scan.js:45-53) |
| `appFormScanStart(F)` / `appFormScanStop(F)` | a second `createAppScanner({video: F.videoEl, onDecode, onError})` whose `onDecode` parses the text (`appParseTagLink`, app_scan.js:13-21) and calls `appOpenTagId`; only one camera runs at a time |
| `appFormPhoto(fileOrRec)` | the photo router target: in the browser `appDownscalePhoto(file, 1280)`, in the frame or in Node a sim rec; then `appNewItemPhoto`, then a repaint |
| `appFormChanged(F)` | writes the draft and debounces `phone.commit('formdraft')` by `APP_MEAS_DRAFT_MS` (400 ms) |
| `appFormSave(F)` | sets `F.saving`, disables the button, calls `<kind>Save`; on a refusal: `.fmsg` + `.bad` + toast, `F.saving = false`; on ok: `appFormCommit`, then (resolved) `appCloseForm({})`, `APP.showScanner = false`, `appRender()` |
| `appCloseForm({ask})` | a dirty form asks `ui_meas_close_ask`; drops the draft on yes; `appNewItemAbandon`; stops the scanner; removes the element; reloads after `phone.commit('reload')` when an update waits (as app_ui.js:1170-1175) |
| `appFormSet(f, v)` | the simulator's `set` op: the control's own state change, then repaint and draft |

### 6.3 app/app_ui.js: the hooks (map-app-forms 7 and 19)

| Hook | Line | Change |
|---|---|---|
| `APP` fields | :289 | + `form: null` |
| `phone.on` | :307-308 | `'revoked'` also `appCloseForm({})`; + `phone.on('saleform', appOnSaleForm)` and `phone.on('newitemform', appOnNewItemForm)` (a `setTimeout(0)` open, as `appOnMeasureForm` :995-999; a `saleform` while a sale form is open adds the line) |
| `appWireEvents` photo input | :340 | the change handler calls `appFormPhoto` when `APP.form && APP.form.kind === 'newitem'`, else `appOnPhotoPicked` as today |
| `visibilitychange` | :346-349 | hidden: also `appFormScanStop`; visible: an open form restarts its own scanner, and the home's only when no form is open |
| `appOnChange` | :353-365 | `formdraft` is handled like `measdraft` (:354-357); `ai` with a new-piece form open refreshes the AI name (6.5) |
| `appRenderHome` | :484-505 | the job row of 1.1 under `form` (`appHomeJobs`); each job button carries `data-f="job:<sell\|new\|restock\|expense>"` and the `hot` class when `SIM_HOT` names it, like a form control |
| `appStartScanner` | :532-533 | returns at once while `APP.form \|\| APP.measForm` |
| `appOpenTagId` | :563-568 | `if (APP.form && APP.form.takesTags) return appFormTag(APP.form, id);` before today's body |
| service worker `canApply` / `controllerchange` | :1254, :1263 | `&& !APP.form` / `if (APP.measForm \|\| APP.form) APP.reloadAfterForm = true` |

The round-5 chat-step glue is **kept**: the `sale` branch of `appInputModeFor` (:76-81), `appQuestionLine`,
`appKeypadKeyFor` and `appOpenDateSheet` (:972-988). They are generic (they map the core's state, and the review card
keeps the step names), they are tested as pure functions (run_app 32, 39 at :1194-1196), and they stay correct
should a review card ever reach the app chat. Section 10 says why they are not deleted.

### 6.4 app_ports.js, app_sync.js, app_store.js

- **app_ports.js:179-183:** `ui` gains `saleForm: function (req) { emit('saleform', req); }` and
  `newItemForm: function (req) { emit('newitemform', req); }`.
- **app_sync.js `replayJob` :388-395:** when `job.ctx && job.ctx.form` and the item is still BLANK, the rename is
  skipped (the form owns the name until Save; the result stays on the media record, :419). Otherwise today's rule
  applies.
- **app_sync.js `pendingLines` :499-502:** an entry with 2+ SALE rows shows `describeBasket(phone.ports, live)`.
- **app_store.js `appendLedger` :294-299:** the receipt copy of 2.4. Inside a collector, it looks for a SALE row of the
  same `groupId` with a `receiptNo` in `S.collector`.

### 6.5 Offline photo capture and the photo AI (map-app-forms 17)

1. The 📸 tap clicks `#photoInput` (`appPickPhoto`, :1225-1228; a tap is a gesture). The routed change handler calls
   `appDownscalePhoto(file, 1280)` (app_media.js:47-68), then `appNewItemPhoto(phone, F, rec)`:
   - `store.addMedia({kind: 'photo', blob, dataUrl, mime, status: 'file', itemId})`;
   - `chat.savePhoto(media.id, itemId)` (app_ports.js:119-122);
   - then `try { ports.ai.describePhoto(media, {categories: CFG.CATEGORIES, form: true}) } catch (pending) {}`. It
     always queues and throws `PendingAi` (:130-151); `itemId` comes from `file.itemId`, and the core state was
     cleared on open.
   - If online, `APP.sync.syncNow('photo')`: the job leaves only after a successful sync (app_sync.js:352-353).

   In Node, `rec = {kind: 'photo', sim: {meta, visual, mimeType}}`, as `phone.sim.photo` builds it (app_ports.js:285-288).
2. While the job is out, `ui_form_ai_wait` shows. On the `ai` change event (`phone.commit('ai')`, app_sync.js:421),
   `appNewItemModel` reads `media.result.desc`. The name field takes `desc.name` only while `values.nameTouched` is
   false, and the category takes the AI's while `catTouched` is false.
3. The replay guard (6.4) keeps the blank tag blank behind the form, so Save never meets `not_blank` from its own
   photo. Map-app-forms hazard 1 is closed.
4. Save: `photoFileId = media.id`; `photoUrl = media.result && media.result.photoUrl || 'local://' + media.id`.
5. Abandon (✖️ without Save): if the media job is still `file` or `queued` and the item is still BLANK, then
   `store.removeMedia(id)`: no orphan blob and no upload. A job already sent is harmless; the replay guard leaves the
   tag blank.
6. Offline: everything above works. The name stays what was typed, or the placeholder; after Save, the late result
   renames only a placeholder (today's rule, app_sync.js:390).

### 6.6 app/app.css

- `.overlay` z-index 30 → **34** (:136). The keypads and the tag keypad then draw above a `.formpage` (32) and its
  `.fbar` (33), and below `.rec` (35) and the toast (40). No check pins 30 (grep).
- NEW classes: `.jobs` (the 2×2 job grid; 56 px compact row in the card state), `.fline` (a basket line:
  emoji/id/name row, price input, stepper, amount, 🗑), `.fline.bad`, `.bchip` (buyer chips; `.chip` is the sync chip,
  :61-67), `.scanstrip` (a 160 px video strip), `[data-f].hot` (next to `.kb button.hot, .sell.hot`, :97).
- Reused: `.formpage`, `.fcol`, `.fhead`, `.fgrid` (two columns at 700 px, :194), `.ffield`, `.toggle`, `.vid` (the
  total and the profit line), `.fbar`, `.fmsg`, `.seg`, `.stepper`, `.tiles`, `.good`.

### 6.7 NEW keys in app/app_i18n.js (APP_MSG, app chrome only)

| Key | Burmese (proposed) |
|---|---|
| `ui_home_sell` | 🛒 ရောင်းမယ် |
| `ui_home_new` | 🆕 ပစ္စည်းအသစ် |
| `ui_sale_total` | စုစုပေါင်း {total} ကျပ် |
| `ui_buyer_find` | 👤 ဝယ်သူ · နာမည် (သို့) ဖုန်း ရိုက်ပါ |
| `ui_sale_paid_now` | 💵 ယခု ပေးငွေ |
| `ui_sale_transfer` | {method} နဲ့ ပေးငွေ |
| `ui_sale_due` | 📅 ကျန်ငွေ ပေးမည့်ရက် |
| `ui_form_empty` | 🛒 Tag ဖတ်ပါ (သို့) နံပါတ် ရိုက်ပါ |
| `ui_form_restored` | 📋 မသိမ်းရသေးတာ ပြန်ဖွင့်ထားသည် |
| `ui_form_clear` | 🔄 အသစ် |
| `ui_form_saving` | ⏳ သိမ်းနေသည်… |
| `ui_form_ai_wait` | ⏳ ဓာတ်ပုံကို စစ်နေသည် · အမည်ကို ကိုယ်တိုင် ရိုက်လည်း ရပါသည် |
| `ui_newitem_tag` | 🏷 Tag အသစ်ကို ဖတ်ပါ (သို့) နံပါတ် ရိုက်ပါ |
| `ui_newitem_not_blank` | ⚠️ {id} က မှတ်ပြီးသား ပစ္စည်းပါ · Tag အသစ် ဖတ်ပါ |
| `ui_expense_amount` | 💸 ပမာဏ (ကျပ်) |
| `ui_form_shop` | 🏪 ဆိုင် |

Reused word for word (verbatim):

- From APP_MSG: `ui_btn_close` '✖️ ပိတ်', `ui_meas_close_ask` 'ရိုက်ထားတာတွေ မသိမ်းဘဲ ပိတ်မလား?',
  `ui_btn_keypad` '⌨️ နံပါတ် ရိုက်မယ်', `ui_scan_start` '📷 ကင်မရာ ဖွင့်မယ်', `ui_torch` '🔦 မီး',
  `ui_recent_title` '🕘 မကြာသေးမီ', `ui_btn_photo` '📸 ဓာတ်ပုံ', `ui_btn_pick_date` '📅 ရက်စွဲ ရွေးပါ',
  `ui_keypad_qty` '🔢 အရေအတွက်', `ui_not_saved`.
- From MSG: `btn_save`, `btn_cash`, `btn_wallet`, `btn_bank_transfer`, `btn_bank`, `btn_split`, `btn_paid_all`,
  `btn_credit`, `btn_days`, `btn_due_unknown`, `btn_new_customer`, `sale_ask_method`, `sale_need_buyer`,
  `sale_line_paid`, `btn_add_option`, `add_ask_pm`, `btn_kind_wallet`, `btn_kind_bank`, `btn_add_cat`, `add_ask_ec`,
  `exp_ask_note`, `btn_pending`, `btn_sample_on`/`off`, `btn_qty`, `btn_restock`, `btn_expense`, and the NEW
  `btn_item_*`, `item_lbl_profit` and `basket_*` keys of 3.5.1.

### 6.8 The dev page (app/dev/index.html)

- :70 becomes `Settings sale_flow = form (off: quick)`.
- :136 becomes `world.settings.sale_flow = 'form'`.
- :207-210 writes `'form'` / `'quick'`.
- The `tgSell` bench button (:211-216) drives the review card: `S|S1-0002|1`, then `SC|S1-0002|ok`.
- `<script src="../app_forms.js">` is added after `app_ui.js` (:130).

A form on the dev page covers the browser window, not the 390 px frame (map-app-forms 6). This is cosmetic and kept
(section 10).

---

## 7. Simulator (R8)

### 7.1 The page (poc/sim_ui.js, poc/simulator.template.html)

- `boot` (sim_ui.js:96) becomes `world.settings.sale_flow = 'form'`. Its comment says the demo shows the forms and the
  review card, and that `seedSimWorld` says quick for the suites.
- The header switch: `#flowSteps` becomes **`#flowForm`**, labelled "form" (template :318-321; its title says
  "form = one-screen forms (app) and the review card (Telegram), quick = the one-tap card"). `renderFlow` (:216-220)
  lights `#flowForm` when `saleFlow(world.ports) === 'form'`. The listeners (:1524-1525) call `setFlow('form')` /
  `setFlow('quick')`. This closes trap T7.
- `doLogin` (:181-191): a login whose role is `staff` sets `S.device = 'app'` and calls `ensureFrame(key)`. The owner
  keeps the open device (Telegram first). The frame is **not** auto-enrolled. It shows the enrol screen and the
  ⚡ shortcut hint (:252, :620), so the `enrol` tour still finds an unenrolled frame (trap T6). A tour step on the app
  enrols through its `enrol` pre-step (`framePre`, :560-564; ⏭ runs the shortcut).
- `doTarget` (:1198-1215): a `ui` target starting with `frame:` sends `{op: 'click', sel: <the rest>}` instead of
  `document.querySelector` (trap T1). A new `f` target kind is handled as in 7.3.
- The Ledger tab (`ledgerTable`, :707-724) gains a narrow `Basket` column: `🛍 i/n` on the rows of a group with 2+ SALE
  rows, else empty (trap T10). The Credits tab follows `openCredits` (it shows `basket_name`).
- `SIM.smoke` changes as in 8.7.

### 7.2 The frame (poc/build_simulator.js)

- `FRAME_FILES` (:28) + `'app_forms'` (6.1).
- `SIM_FRAME.snap()` (:141-147) + `form: typeof appFormSnap === 'function' ? appFormSnap() : null`. `measForm` is kept.
- `SIM_FRAME.cmd` (:149-173) gains four ops (trap T4):
  - `form`: `{op: 'form', kind, itemId}` calls `appOpenForm(...)`, which is what the home's job buttons do.
  - `set`: `{op: 'set', f, value}` calls `appFormSet(f, value)` (the control's own state change, so the reveal rules run
    and the draft is written).
  - `photo`: `{op: 'photo', preset}` calls `appFormPhoto` with the sim photo rec of that preset, since the frame has
    no camera.
  - `close`: `{op: 'close'}` calls `appCloseForm({})` with no question (a `confirm()` would block an unattended run).
- `hot` (:152) also calls `appFormRepaint(APP.form)` when a form is open, so the highlight is drawn by the form's own
  renderer (trap T5).
- `click` (:170) already presses `[data-f="save"]`.
- A form's `phone.commit(kind)` already reaches the page as `{src: 'app', kind}` through `notify` (:189-195), and the
  200 ms watcher posts a changed snapshot in post mode (:206).

### 7.3 The tours engine (sim_ui.js) and vocabulary (sim_tours.js)

- **A new target kind `f`:** `{f: '<data-f name>'}` or `{f: '<name>', value: '<text>'}`.
  - `computeHot` (:1118-1129) sets `T.hot = 'f:' + f`; `syncFrameHot` ships it unchanged (:630).
  - `doTarget` maps an `f` target with a value to `{op: 'set'}` and one without to `{op: 'click', sel: '[data-f="…"]'}`.
  - Every `f` step therefore completes under ⏭ alone (`runTourUnattended`, :1473-1491).
- **New done predicates** in sim_tours.js:
  - `formIs(kind)`: the snapshot's form is of that kind;
  - `formHas(fn)`: `when(c => c.frame && c.frame.form && fn(c.frame.form))`;
  - `ledgerGrew(type, itemId)`: a row of that type and item arrived after `T.mark.ledger`;
  - `tagIn(id)`: `any(scanned(id), formHas(f => f.itemId === id || f.lines.some(l => l.id === id)))`. A scan into an
    open form never reaches the bot, so it is seen through the snapshot (trap T2). A scan from home still emits
    `/start <id>`.
- **Step makers:** `ff(name, my, en, more)` (a click) and `fset(name, value, my, en, more)` (a value). The verbs are
  the existing ones (check_simulator.js:198). Captions use `{k:key}` with APP_MSG or MSG keys.

### 7.4 The tours

The id list of check_simulator.js:156 is kept, and one tour is added.

| id | Login · device | Steps (targets) | done of the last step |
|---|---|---|---|
| sell | sister · app | `tag S1-0002` (`tagIn`; the form opens with the line), `f: save` | `ledgerGrew('SALE', 'S1-0002')` |
| deposit | sister · app, need S1-0001 | `tag S1-0001`, `f: buyer:new`, `f: name` = ဒေါ်နီနီ, `f: phone` = 09444555666, `f: paid:part`, `f: amount` = 12500, `f: due:14`, `f: save`; then the four laptop steps unchanged | `creditOf(c, 'ဒေါ်နီနီ')` for the sale part; the laptop steps as today |
| mixed | sister · app | `tag S1-0003`, `f: pay:mix`, `f: acct:KBZ`, `f: transfer` = 5000, `f: save` | a PAYMENT of 5,000 KBZ |
| price | sister · app | `tag S1-0002`, `f: price:S1-0002` = 15000, `f: qty+:S1-0002`, `f: save` | a SALE of 2 × 15,000 |
| back | sister · app | `tag S1-0002`, `tag S1-0003`, `f: remove:S1-0003`, `f: close` (act `{op: 'close'}`) | the form is closed; the ledger has not grown. Title 'ဖယ် · မလုပ်တော့' / 'Remove a line, then leave' |
| restock | brother · app | `f: job:restock` (act `{op: 'form', kind: 'restock'}`), `tag S2-0003`, `f: qty:S2-0003` = 5, `f: save` | a RESTOCK of +5 |
| newitem | sister · app, need blank S1-0007 | `tag S1-0007` (the new-piece form), `f: photo` (act `{op: 'photo', preset: 'htamein_green'}`), `f: price` = 25000, `f: cost` = 12000, `f: save` | the world's S1-0007 is ACTIVE with price 25,000 |
| expense | sister · app | `f: job:expense`, `f: cat:fabric`, `f: amount` = 20000, `f: save` | an EXPENSE of 20,000 |
| tgsale (NEW) | sister · tg | `tag S1-0002`, START, `cb S\|S1-0002\|1` (the review card), `cb SS\|S1-0002\|add`, `tag S1-0005`, START, `cb SC\|S1-0002\|ok` | two SALE rows in one group. Title 'Telegram · ရောင်းကတ် (အက်ပ် မရှိရင်)' / 'Telegram backup: the review card' |
| lists | owner · laptop, then tg | the laptop part unchanged; the Telegram part: `tag S1-0002`, START, `cb S\|S1-0002\|1`, `cb SS\|S1-0002\|o\|method` (the new KBZ label and AYA Pay show, no WavePay), `cb SS\|S1-0002\|z` | as today on the last step |
| quick | sister · tg | `#flowQuick`, tag, START, `S\|S1-0002\|1` (the one-tap card writes), then **`#flowForm`** | `saleFlow(c.world.ports) === 'form'`. Title 'quick ရောင်း ↔ form' |
| return, payment, takedeposit, order, reports, enrol, stranger | unchanged | unchanged (the chat flows, also on the app through ☰) | unchanged |

The owner's tours (reports, the 21:00 post, lists, enrol a phone) stay on Telegram and the laptop (R8).

---

## 8. Tests

Rule R9: every new check fails without its feature. The "fails without" column names the code whose absence turns it
red. Existing checks change only where 8.8 names them.

### 8.1 poc/run_wizard.js: rewritten in place (step 1)

The bench (:55-76) sets `sale_flow = 'form'`. `guided()` (:122-127) is replaced by `card(u, id, taps)`: scan, then
`S|id|1`, then each `{tap}` or `{text}` in turn. The helpers `same`, `txt`, `head`, `bytes`, `dmy`, `edits`, `worlds` and
`CARD_SOLD_ROWS` stay.

**Disposition of every round-5 check** (the line numbers and labels are today's; map-sim-tests 5.1 has each label in
full):

| Round-5 step | Kept verbatim (V) | Successor (RC/AF) | Dropped with the step machine (O) |
|---|---|---|---|
| 1 Nothing before ✅ (:143) | none | W1: 149 (the card is edited into the review card: same id, nothing written), 172 (Save = one SALE row: qty -1, cash 18,000, CASH, no customer, no DueDay, no note), 175 (the sold card has [undo, receipt] only), 177 (state cleared, `lg` holds the group, no customer); W4: 154, 157 (the buyer sub-screen's rows end with [⏮ `back\|card`, ✖️]); W8: 187 (a typed amount never commits: it returns to the card) | 151, 159, 163, 167, 169, 183, 192, 195 |
| 2 The count (:200) | 204 (cardKeyboard is byte-identical in both modes) | W2: 209, 211 (the `Q` grid is askQty's), 227, 248 (the line sub-screen's grid and its typed count), 253 (a one-of-a-kind line is count 1, no grid) | 213, 217, 236, 240 |
| 3 A changed price (:259) | none | W3: 265, 278 (qty -2 at 15,000, note `price` on that row), 285, 292 | 269, 273, 275, 300, 304, 307 |
| 4 Buyer (:312) | none | W4: 318, 323, 327, 332, 336, 339, 343, 347, 350, 353, 357, 363, 366, 368, 372, 375 (each through `o\|buyer`; the exit is the card) | none |
| 5 How paid (:380) | none | W5: 386, 388, 392, 398, 404, 410, 416, 420, 425, 432, 436, 442 (through `o\|method`) | none |
| 6 Mixed (:447) | none | W6: 453, 463, 469, 479, 482, 486, 493 (now a Save refusal), 501, 503, and the V\* 467, 468, 474 with the card as setup; W18: 515 | 458, 490, 497 |
| 7 The seven outcomes (:520) | **all**: 525, 527, 529, 531, 533, 536, 539, 541, 543, 545, 547 (these pin the wrapper, B8) | none | none |
| 8 Part without a buyer (:552) | none | W8: 558 (the card shows `sale_need_buyer`, Save writes nothing), 562, 573, 577, 583, 591, 601, 609, 613 | 568, 597 |
| 9 Due typed and unknown (:620) | none | W9: 628, 632, 639, 641, 645, 649, 652, 656, 658 | none |
| 10 Overdue by DueDay (:663) | the assertions 670, 674, 678, 679, 689 | setup through `card()` | none |
| 11 Back (:694) | none | W11: 742, 744 (`S` stays exempt), 749, 752, 756, 758, 760, 764, 766 | 702, 708, 710, 713, 715, 722, 730, 736, 739, 771, 774 |
| 12 Cancel (:780) | 829 | W12: 786, 793, 797, 810, 816, 818, 824 | 802 |
| 13 Stale, double, expired (:834) | none | W13: 841, 850, 857, 870 (two ✅ within 120 s write one group), 874, 878, 884, 889, 891 (a scan without ➕ starts a fresh card) | 855, 861, 864 |
| 14 Sold meanwhile (:896) | 922 | W14: 907 (**changed rule**: the card stays with `basket_line_gone`, nothing written, the state kept), 916 | none |
| 15 ➕ inside the sale (:928) | none | W15: 934, 938, 944, 950, 954, 957, 964, 969, 974, 978, 981, 986, 991, 995 | none |
| 16 Menu taps keep the flow (:1001) | none | W16: 1009, 1011, 1016, 1019, 1023 | none |
| 17 Quick switch (:1028) | 1032, 1036, 1041, 1045, 1062 | W17: 1049 (+ no `NI\|`/`NC\|` and no `SS\|…\|o\|` in the quick world), 1051 ('steps', 'x', a blank and a missing key read as **form**), 1057 (flipped to form: the next tap shows the card) | none |
| 18 Voice (:1067) | 1074, 1077 | W18: 1080, 1083, 1088 (a spoken answer lands in the open sub-screen) | none |
| 19 Owner (:1093) | none | W19: 1103, 1106, 1109, 1118, and the V\* 1100, 1112 | none |
| 20 Receipt and reports (:1124) | 1159; the assertions 1135, 1138, 1146, 1152 | setup through `card()` | none |
| 21 Ledger helpers (:1165) | **all** (1170-1186) | none | none |
| 22 Kind in the core (:1191) | **all** (1196-1243) | none | none |
| 22z (:1249) | none | W22z: 1256, 1265, 1269, 1277, 1285, 1294, 1299, 1303, 1322, 1326, 1334 | 1260, 1312, 1316 |
| 22y (:1338) | 1412, 1418, 1424 | W22y: 1357, 1364, 1369, 1375, 1383, 1389, 1394, 1402 | 1345, 1350 |
| 22x (:1429) | none | W22x: 1441, 1445, 1450, 1458, 1464, 1474, 1485, 1490, 1516, 1525, 1532, 1538, 1546, 1551, 1569, 1573, 1600 | 1498, 1506, 1583, 1592, 1608 |
| 23 Texts, 64 bytes, no errors (:1614) | 1619, 1621, 1623, 1626, 1637, 1639, 1645 | 1633 **changed**: `settings_note_sale_flow` is compared with SPEC-round-6.md, the other 24 still with SPEC-round-5.md; W23: 1643 (START + one tap shows the review card; nothing written before Save) | none |
| 24 Caption-aware edits (:1651) | **all** (1661, 1662; the edits now include the review card's) | none | none |

**New steps** (the W-numbers are new step titles in the same file):

| Step | Checks | Fails without |
|---|---|---|
| W25 Pure basket helpers | `basketAllocate` fills in order ([36000, 22000, 25000] with 30,000 gives [30000, 0, 0]; with 63,000 gives [36000, 22000, 5000]; 200 seeded random cases keep Σ = A and 0..amount); `basketTotals` of one line equals `commitSaleGroup`'s derivations on the seven outcomes' inputs; `saleDueKey` (0, 14 and 365 are accepted; 366, -1 and 0.5 are null; 'none' is ''; yesterday and +400 are null; yyyy-mm-dd is accepted); `itemMargin` ((25000, 12000) gives {13000, 108}; (12000, 25000) gives {-13000, -52}; an empty cost or 0 gives null); `basketAddItem` (each reason; a SKU again raises its count; a one-of-a-kind piece is count 1; the owner's shop is the first line's; a pending item is accepted); `basketCheck` (each code with its key, in the order of 3.2) | the helpers, the fill rule, the bounds |
| W26 commitBasket | 3 lines × {cash full, part, mixed full, mixed part}: the exact rows of 2.3 (type, order, cash, method, note, dueDay on every SALE row, customer on every row, the PAYMENT last with `refGroupId`); a clock that advances 1 s per read from 23:59:59 Yangon gives every row one `time` and one `day`; one group id; it throws on 0 and on 11 lines; `rewriteCheck` answers `complex` | B1-B7, the single clock read |
| W27 Readers on a basket | (a) `saleCardText` = `basket_sold` + 3 lines and `saleSoldCard` recognises it; (b) the sold-out S1-0001 card shows `card_buyer_basket` with the basket's paid; (c) `openCredits` item = `basketName` while a one-line credit keeps its item name; (d) the `U\|g` reply lists the 3 items with their stock back; (e) the customer card has one line for the basket and a later PAYMENT as its own line; (f) +15 days, `buildDailySummary` names the buyer in `summary_due_overdue`; (g) `receiptText` has 3 lines, the total and the method; `dayStats` sums; (h) the `describeBasket` wording | each reader change of section 4 |
| W28 New piece and restock writes | `commitNewItem`: count 1 gives UNIQUE, stock 1, RESTOCK 1, 'new item'; count 3 gives SKU, stock 3, ONE RESTOCK of 3; sample gives 'new sample'; the refusals `not_blank`, `count`, `price`; an empty name gives the placeholder; an unknown category gives အခြား; the `pending` flag. `commitRestockGroup`: 2 lines give one group and an undo mirrors both; the refusals | `commitNewItem`, `commitRestockGroup` |
| W29 The Telegram new-piece card | blank, then a photo, gives the card (state step `card`, nothing written); `P\|id\|25000` redraws the card (no `ask_cost`, no write); `C\|id\|other` + 12000 gives the line `item_lbl_profit` 13,000 · 108%; `NI` count 3, name, category 2, `PS` sample; `NC` ok writes SKU, stock 3, one RESTOCK; pending sends the owner `price_ask_owner` with `SP\|` buttons; a second `NC` within 120 s writes once; an `NC` after another tag replaced the state answers `expired`. Under quick, `P\|` still asks `ask_cost` | the card, `NC` in MUTATING |
| W30 The app hooks in the core | a world whose `ports.ui` has `saleForm`/`newItemForm` stubs: `S\|S1-0002\|1` calls `saleForm({itemId, qty: 1})` with no edit and no state; `openTag(S1-0002)` calls `saleForm`; a blank tag calls `newItemForm`; a pending item, a sold piece and another shop's item give the card; under quick, the card and the one-tap commit | `startSaleFor`, the `openTag` route |
| W31 Round-6 texts and bytes | every key of 3.5.1 is in MSG, non-empty and equal to SPEC-round-6.md section 7; every callback emitted by every bench is at most 64 bytes; no new `btn_*` text contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ, and none starts with '🏦 '; no update failed | the keys, the byte budget |

### 8.2 poc/run_round4.js 9z (step 1)

- **:1938** label only: '…seedSimWorld seeds it; the code default is form'.
- **:1964** condition: `Y.state(U.sister).step === 'card'` and `sy.card.text === basketCardText(…)` instead of the
  buyer question. Label: 'form: … the card is edited into the review card and a sale state waits'.
- **:1967** label only: 'form: ✖️ on the review card brings the item card back; still nothing written'.
- :1959 (`'steps'`) stays: it now also proves that steps reads as form. :1954 stays: no `SS|`/`SC|` in the quick world
  holds.

### 8.3 poc/run_app.js

**Step 1 edits inside `round5()`.** These touch only the core's behaviour.

- **Deleted** (O/AF; their successors are in `round6()`):
  - step 33's 924, 928, 933, 937, 941, 947, 950, 954, 957, 962, 965, 967, 970, 973 (the `G` creation and enrolment
    lines stay);
  - step 34 whole: 978, 985, 988, 993, 997, 1002, 1006, 1009, 1013, 1018, 1020, 1023, 1028, 1030, 1032, 1036;
  - step 35's checks 1045, 1048, 1051, 1054, 1057 (the `G2` creation and enrolment lines stay);
  - step 37's 1103, 1110, 1120, 1122, 1126, 1129, 1132 (the guided tap chain from :1107 to :1131);
  - step 39's guided block :1203-1229 (checks 1213, 1224, 1227).
  That is 45 checks.
- **Changed:**
  - 921: `saleFlow(G.ports) === 'form'`; label 'the server says steps, which reads as form'.
  - 1073: `tg36.kind === 'sale' && tg36.step === 'card'`; label 'the same tap in Telegram shows the review card and
    writes nothing'.
  - 1077: `saleFlow(G2.ports) === 'form'`.
  - 1081 (setup of step 37): the item card is pushed with `sendItemCard(uid, G2.ports.store.getItem('S1-0002'), staff,
    G2.ports)` instead of `G2.phone.sim.start` (in step 3 a scan opens the sale form, not the card). 1086 and 1090 then
    hold unchanged.
  - 1097, 1101: setup `G2.phone.sim.tap(card37.id, 'Q|S1-0002')`, with `q1` = the grid; `SIM_HOT = 'S|S1-0002|3'`, and
    the hot button's text is ၃.
  - 1259: `saleFlow(H2.ports) === 'form'`; label '…form again'.

**Step 3 edits.**

- `FILES` (:17-24) + `'app/app_forms.js'`.
- **1142**: `/world\.settings\.sale_flow\s*=\s*'form'/` and the label 'the dev page starts in form…'.
- **1262** (setup): the card comes from `sendItemCard` (as at :1081).
- **1266**: the tap emits one `saleform` request `{itemId: 'S1-0003', qty: 1}` (a listener records it), and no state
  and no ledger row follow; label '…the stepper's S|S1-0003|1 asks for the sale form again and writes nothing'. It is
  expected red from step 1 to step 3.

**Step 3, new `round6()`** (called after `round5()` at :297), steps 41-56. A phone `F` is enrolled against a world
with `sale_flow = 'form'`, restocked as round5() does. The helpers are `fakeWalk`, `findF(el, name)` (a `data-f`
walker) and the memory adapter's `transactions`, `holdWrites` and `failNext`.

| Step | Checks | Fails without |
|---|---|---|
| 41 Home and route | `appHomeJobs` gives 4 jobs under form and none under quick; `phone.sim.start('S1-0002')` emits `saleform` and writes nothing; a blank S1-0007 emits `newitemform`; a sold piece, a pending item and S2-0002 give the card; with the pref `setting:sale_flow = quick`, the stepper card as today | the core route, `ports.ui` |
| 42 Sale model | add S1-0002, `qty+`, S1-0005, S1-0001: 3 lines, total 83,000, defaults cash / full / no buyer; S1-0001 again gives `basket_twice`; S2-0002 gives `basket_other_shop`; S1-0007 gives `basket_blank`; 10 lines and then 1 more gives `basket_max`; a pending item, then Save, gives `basket_need_price` | `appSaleAdd`, `basketCheck` |
| 43 Save on the real store | ONE adapter transaction carries the 3 SALE rows, the outbox group entry, the sold card in chat and the draft removal; with `holdWrites`, nothing is painted before the release; all 3 SALE rows carry the same `receiptNo` and the counter grows by 1; `scheduleSync` once at `APP_SYNC_DEBOUNCE_MS`; after the sync the server has 3 rows in one group, no quarantine, no flag | `appSaleSave`, `appFormCommit`, the receipt copy |
| 44 Part with a new buyer | Save with part and no buyer writes nothing and gives `sale_need_buyer`; a new name and phone: the outbox is [customer, group], cash 30,000 / 0 / 0, DueDay +14 on all 3, the customer on all 3; `openCredits` gives one entry with `basketName` | B2-B4, `basketCommitDraft` |
| 45 Mixed | KBZ 20,000 full: 3 SALE + PAYMENT last, no OVERPAID on the server; a total of 1 offers no mix | B1, `canMix` |
| 46 Draft | a restart over the same adapter restores the sale draft (`ui_form_restored`); a `formdraft` change does not repaint; Save drops it; a draft older than a day is gone | the draft helpers, the `appOnChange` case |
| 47 Sold meanwhile | phone `G` sells S1-0001 and syncs; `F` pulls; `F`'s Save gives `basket_line_gone`, writes nothing and keeps the form | the Save-time re-read |
| 48 Double Save | a second `appSaleSave` while `F.saving` returns `busy`: one group | `F.saving` |
| 49 New piece | a sim photo makes the media plus a queued job with `ctx.form`; online sync: the job is done, the replay leaves S1-0007 BLANK, and the model offers the AI name; Save with count 3 gives the outbox [item, group], type SKU, stock 3, ONE RESTOCK of 3, `photoUrl` = the job's URL; a pending price gives a `notice` entry with `SP\|`; abandon removes the media and leaves the tag blank | the replay guard, `appNewItem*` |
| 50 Restock | S1-0002 +5 and S1-0003 +2 give one group with two RESTOCK rows; S1-0001 gives `basket_unique`; the undo mirrors both | `appRestock*`, `commitRestockGroup` |
| 51 Expense | fabric, 20,000, CASH, a note: one EXPENSE row with the note; a new category gives the outbox [list, group]; an amount of 0 gives `ask_number` and no write | `appExpense*` |
| 52 Glue (a stub APP, as step 29) | `appFormSave` closes only after `phone.commit` resolves; `failNext` gives `ui_not_saved` and keeps the ops; the SW `canApply` is false while a form is open; `revoked` closes the form; visibility restarts the form scanner, not the home one; `appStartScanner` refuses while a form is open; `appOpenTagId` and the photo input route to the form | each hook of 6.3 |
| 53 Render (fakeDocument) | `appFormRender` of the sale form gives every control a `data-f`; `SIM_HOT = 'f:save'` marks exactly Save; part reveals amount and due; mix reveals the accounts and the transfer; new reveals name and phone | the renderer, the reveal rules |
| 54 Pending line | a 3-line basket entry shows one `describeBasket` line; a 1-line entry keeps the `describeRow` line (run_app.js:248-249 stay) | the `pendingLines` branch |
| 55 Older server | `quickForced`: no jobs and `S\|` commits at once (step 40 extended) | `appHomeJobs` reading `saleFlow` |
| 56 No exception | no `deliver` or `listener:` errors on the round-6 phones | n/a |

### 8.4 poc/run_sync.js

**Step 1 edits (setup and four checks).** `r5StepsWorld` (:1542-1546) keeps `'steps'`, which now reads as form.

- R5a setup:
  - :1558 becomes `['SS|S1-0002|o|method', 'SS|S1-0002|m|mix', 'SS|S1-0002|a|KBZ']`;
  - :1559 (text 5000, the transfer part) stays;
  - one new tap line `['SS|S1-0002|o|paid', 'SS|S1-0002|p|other']` goes before :1560 (text 9000);
  - :1561 (text ဒေါ်မြင့်) stays: typed text on the card is a buyer search;
  - one new tap line `['SS|S1-0002|o|due', 'SS|S1-0002|d|type']` goes before :1562 (the typed date);
  - :1563 (`SC`) stays.

  Assertions 1565-1580 are unchanged.
- R5c setup: :1600 becomes `['SS|S1-0002|o|buyer', 'SS|S1-0002|b|C-0001', 'SS|S1-0002|o|paid', 'SS|S1-0002|p|half',
  'SS|S1-0002|o|due']`; :1601-1602 stay; :1609 becomes `['SC|S1-0005|ok']`. Assertions 1614-1618 are unchanged.
- R5e setup: :1666 (text ဦးသန့် on the card: a buyer search, then the phone prompt) stays; :1667 becomes
  `['SS|S1-0002|ph|skip', 'SC|S1-0002|ok']`; :1671 becomes `['SC|S1-0002|ok']`. Assertions 1673-1678 are unchanged.
- **1693**: `saleFlow(P.ports) === 'form'` and the last text starts with the `basket_line` head; label '…saleFlow is
  form: the sell button shows the review card and writes nothing'.
- **1734**: `saleFlow(P.ports) === 'form'` (the caps part stays); label '…the phone sells with the form'.
- **1753**: `saleFlow(P.ports) === 'form'`; label '…form again'.
- **1764**: `'form'` and the review-card head; label '…the sell button shows the review card (writes nothing)'.
- 1739's `w.settings.sale_flow === 'steps'` is the world's value and stays.

**Step 2, new steps after R5h.**

| Step | Checks | Fails without |
|---|---|---|
| R6a A basket on the reference phone through the review card | S1-0002 × 2, then ➕ /start S1-0005, then ➕ /start S1-0001; mixed KBZ 20,000 + paid 30,000 in all; ဒေါ်မြင့်; 14 days. Offline: ONE outbox group [SALE, SALE, SALE, PAYMENT], the same `receiptNo` on the 3 SALE rows, the counter +1; pushed: ok, no flag, Seq in order; `openCredits` gives one entry (`basketName`, dueDay); the undo's 4 mirrors put every bucket back | B1-B4, the sim_phone receipt copy |
| R6b A new piece with a count on the reference phone | the Telegram card with count 3 and pending: the outbox is [item, group, notice]; the server item is SKU, stock 3; the owner's Telegram gets `price_ask_owner` with `SP\|` | `commitNewItem`, the card |
| R6c Another shop in a group | a hand-built group from a shop-1 phone with a shop-2 SALE row is quarantined `scope` (pins why `basketAddItem` refuses it) | today's server (a pin) |
| R6d The alias | the server's `steps` gives `saleFlow(phone) === 'form'`; the server's `QUICK` gives quick | `saleFlow` |

### 8.5 poc/run_gas.js

- **Step 1 edits:** **1495** `flow.Value === 'form'`, label 'Settings: sale_flow = form…'; **1540** `r.Value ===
  'form'`, label 'Settings got sale_flow = form…'.
- **Step 2, new sections** (before section 17 "Over the whole run"):
  - **26** one sync through the real handler with [customer, a 3-line part-and-mixed basket, list entry]: one Ledger
    block of 4 rows × 27, the DueDay text on the 3 SALE rows, the Credits tab's Item = `basketName`, no OVERPAID, an
    empty Errors tab. Fails without B1/B3 and `basketName`.
  - **27** setupSheet on a book whose Settings hold `sale_flow | steps` (a round-5 Sheet): the row is kept, the note is
    the new `settings_note_sale_flow`, and `saleFlow` reads form. Fails without the alias.

### 8.6 poc/check_simulator.js (step 4)

**Changed:**

- **124**: in the id list (:120-122), `flowSteps` becomes `flowForm`.
- **140**: the regex becomes `world\.settings\.sale_flow = 'form'`; label 'the page boots with sale_flow = form'.
- **193**: `KINDS` (:160) gains `'f'`; label '…(tag, cb, label, re, type, ui, tab, f)…'.
- **217**: `sell` becomes `tgsale`; label 'the tgsale tour runs from S|S1-0002|1 to SC|S1-0002|ok'.
- **223**: `s3` is taken from `tgsale` (the `tap` predicate is the same function, sim_tours.js:38-45).

**New:**

- **5b**: app/app_forms.js sets `'data-f'` and reads `SIM_HOT`; BOOT has the ops `form`, `set`, `photo` and `close`,
  `snap` carries `form`, and `hot` repaints a form; app.css styles `[data-f].hot`.
- **6b**:
  - the tours sell, deposit, mixed, price, back, restock, newitem and expense have device `app` and end at an `f`
    target (`save`, or `close` for back);
  - every `f` name a tour uses, up to its first `:`, is a literal in app_forms.js (or app_ui.js for `job`);
  - tgsale is device `tg` and holds `SS|S1-0002|add`;
  - sim_ui.js's `doLogin` puts a `staff` login on `app`;
  - `doTarget` maps `frame:` to the `click` op.

**Unchanged:** the rest, and check_simulator_browser.js. Its :91 binds the new smoke step to the same count on both
transports (8.7).

### 8.7 SIM.smoke (sim_ui.js:1324-1456, step 4) and the manual checks

**Changed:**

- "The simplest sale" (:1330-1338) is Telegram START S1-0002, `btn_sell_one`, `SC|S1-0002|ok`. The 1338 condition is
  unchanged; its label becomes 'Telegram: START, ✅ ရောင်း ၁, ✅ သိမ်း write one SALE row, cash 18,000'.
- "The deposit sale" (:1340-1357) taps `btn_sold`, `o|buyer`, `btn_new_customer`, then ဒေါ်စန်း, 09777123456,
  `o|paid`, `p|half`, `o|due`, `d|14`, `SC`. Checks 1354-1357 unchanged.
- "App: a mixed sale of two" (:1367-1397):
  - `{op: 'open', id: 'S1-0003'}` opens the form with the line;
  - then `set qty+:S1-0003`, `set pay:mix`, `set acct:KBZ`, `set transfer 5000`, `click save`, sync;
  - 1371, 1378 and 1386 become 'app: S1-0003 opens the sale form with its line', 'app: the form reads 24,000 with
    KBZ 5,000', and 'app: Save closes the form and the home shows the sold card';
  - 1393-1395 are unchanged.
- "Owner: Lists" (:1428-1441) taps `SS|S1-0002|o|method` before reading the buttons. The 1439 condition is unchanged.

**New step** "App: a three-item basket with a part payment": map-sim-tests 8, with the keys of this design:

- set and click through the snapshot only;
- checks:
  - three SALE rows in line order;
  - qty, amounts, cash 30,000 / 0 / 0;
  - C-0001 on every row, DueDay +14 on every row, note `credit`;
  - one `receiptNo` on all three;
  - no PAYMENT, no quarantine;
  - `openCredits` gives one entry with `basketName` and owed 53,000;
  - stock S1-0002 −2, S1-0005 −1, S1-0001 SOLD;
- about 12 checks, the same on both transports.

The last step (+15 days, 21:00) now finds ဒေါ်မြင့် next to ဒေါ်စန်း; 1454 stays (ဒေါ်စန်း).

**Manual browser checks** (step 4 lists them, the orchestrator runs them), on poc/dist/pos-simulator.html:

- a seller lands on 📱, enrols with ⚡, sells by scan + Save;
- a three-tag basket with a buyer chip, part and 14 days; the sold card shows undo and receipt;
- the new-piece form with the preset photo, the AI name arriving, profit and %, count 3;
- the restock and expense forms;
- the keypad opens above a form;
- the Telegram review card: ➕, scan, Save; the new-piece card;
- the owner's 💻 Ledger shows the Basket column and Credits shows `basket_name`;
- the form at laptop width in two columns;
- the form/quick switch flips both devices;
- `?autorun=smoke` gives failed 0, and `&transport=post` gives the same count.

On app/dev/index.html: the sale form covers the window (expected), Save works, and the checkbox flips.

### 8.8 Every existing check that changes (the only edits allowed)

| File:line | Label (today, short) | Change | Step | Why |
|---|---|---|---|---|
| poc/run_wizard.js (whole file) | round-5 steps 1-24 | rewritten per 8.1 (V verbatim, RC/AF successors, O dropped) | 1 | R5 removes the step mode |
| poc/run_round4.js:1938 | 'bench() runs on sale_flow quick (… default is steps)' | label | 1 | R6 default |
| poc/run_round4.js:1964 | 'steps: sell() returns no row… buyer screen…' | condition + label (review card) | 1 | R5 |
| poc/run_round4.js:1967 | 'steps: ✖️ on that screen brings the item card back…' | label | 1 | R5 |
| poc/run_app.js:921 | 'the server says steps…' | saleFlow `form` | 1 | R6 |
| poc/run_app.js:924-973, 978-1036, 1045-1057, 1103-1132, 1213, 1224, 1227 | the app's guided chat steps (45 checks, 8.3) | deleted; successors in round6 41-53 | 1 | R1/R5: the app sells through forms |
| poc/run_app.js:1073 | 'the same tap in Telegram (the server says steps) asks the buyer…' | review card | 1 | R5 |
| poc/run_app.js:1077 | 'without the pref the phone follows the server again…' | `form` | 1 | R6 |
| poc/run_app.js:1081 (setup) | step 37's card | `sendItemCard` instead of a scan | 1 | a scan opens the form in step 3 |
| poc/run_app.js:1097, 1101 | 'every keyboard button carries data-cb…', 'SIM_HOT marks exactly…' | setup: the `Q` grid | 1 | the guided screen is gone from the app |
| poc/run_app.js:1259 | '…steps again' | `form` | 1 | R6 |
| poc/run_app.js:1142 | 'the dev page starts in steps…' | `form` | 3 | R6 |
| poc/run_app.js:1262 (setup), 1266 | '…opens the guided sale again and writes nothing' | `sendItemCard`; the `saleform` request | 3 | R1 |
| poc/run_sync.js:1558, 1600, 1609, 1667, 1671 + two lines before 1560 and 1562 (setup) | R5a, R5c, R5e taps | review-card taps; assertions unchanged | 1 | R5 |
| poc/run_sync.js:1693, 1734, 1753, 1764 | R5f, R5h 'steps…' | `form` + review card | 1 | R6 |
| poc/run_gas.js:1495, 1540 | 'Settings: sale_flow = steps…', 'Settings got sale_flow = steps…' | `form` | 1 | R6 seed |
| poc/check_simulator.js:124, 140, 193, 217, 223 | the ids, the boot value, KINDS, the sell tour, the S| predicate | 8.6 | 4 | R8 |
| poc/sim_ui.js:1338, the taps of :1330-1352, 1371, 1378, 1386, the taps of :1433-1438 | SIM.smoke | 8.7 | 4 | R5, R8 |

### 8.9 Why everything else stays green, and what to expect

- The quick seed (rule 1): run_scenario 327, run_lists 236, run_round4 1-9l and 10, run_app 1-31, run_sync 0-M11 and
  run_gas 1-17 never reach a round-6 path. `cardKeyboard`, `askQty`, `afterSaleKeyboard` and the chat new-piece chain
  under quick are byte for byte today's.
- The wrapper (B8) keeps run_wizard step 7, run_gas.js:1454 (`commitSaleGroup` direct) and every reader check (one-line
  groups).
- Reader branches are guarded by `rows.length > 1`. No existing suite builds a multi-SALE group from tags (basket map
  4). run_app.js:248-249, :115 and :218 stay as they are. :967 and :1054 go with steps 33 and 35, and round6 step 43
  succeeds them (one receipt number per basket).
- MSG only gains keys. The one changed text, `settings_note_sale_flow`, is compared through `MSG.` in run_gas.js:1495
  (the same variable), so only run_wizard 1633 needs its successor.
- `ITEM_ACTIONS` and `MUTATING_ACTIONS` only gain `NI` and `NC`. No existing check counts them.
- The overlay z-index, the new CSS classes and the new APP fields are pinned nowhere.
- check_simulator.js:87 compares `FRAME_FILES` with `APP_FIRST`, and both gain `app_forms.js`.
- **Expected after the round:** run_scenario 327, run_lists 236, run_round4 345, run_gas 295 + about 10, run_sync
  333 + about 16, run_app 265 − 45 + about 75, run_wizard about 330 (rewritten), check_simulator 68 + 2. Every builder
  reports the real counts.

---

## 9. Build steps and file ownership

Nobody edits a file outside their step's list, and inside a shared suite only the regions named in section 8. Each
step's checker:

- the named suites end `0 failed`;
- `npx acorn@8 --ecma5 <file>` passes on every changed `core_*.js`, `app_*.js` and `sim_*.js`;
- every new global was grepped first;
- `node tools/bundle_gas.js` and `node tools/build_app.js` run.

1. **Core** (first, alone).
   - **Files:**
     - `apps-script/core_config.js`, `core_ledger.js`, `core_messages.js`, `core_report.js`, `core_bot.js`;
     - `apps-script/gas_setup.js` (:15, :74-76 only);
     - `poc/run_wizard.js` (rewritten, 8.1);
     - `poc/run_round4.js` (8.2);
     - `poc/run_app.js` (the step-1 edits of 8.3 only);
     - `poc/run_sync.js` (the step-1 edits of 8.4 only);
     - `poc/run_gas.js` (1495, 1540 only).
   - **Checker:** run_wizard, run_scenario 327, run_lists 236, run_round4 345, run_gas 295, run_sync 333,
     check_simulator 68 all end `0 failed`; run_app holds 265 − 45 = 220 checks, of which exactly one is expected red,
     run_app.js:1266, until step 3.
2. **Glue and sync** (after 1, in parallel with 3).
   - **Files:** `poc/sim_phone.js` (the receipt copy); `poc/run_sync.js` (R6a-R6d appended after R5h, nothing else);
     `poc/run_gas.js` (26-27 appended before section 17, nothing else). No `gas_*.js` or `core_sync.js` change is
     expected; a needed one goes into the report.
   - **Checker:** run_sync and run_gas end `0 failed`; the step-1 suites stay green.
3. **App** (after 1, in parallel with 2).
   - **Files:**
     - `app/app_forms.js` (new), `app/app_ui.js`, `app/app_ports.js`, `app/app_sync.js`, `app/app_store.js`,
       `app/app_i18n.js`, `app/app.css`, `app/dev/index.html`;
     - `tools/build_app.js` (`APP_FIRST` only);
     - `poc/run_app.js` (`FILES`, 1142, 1262, 1266, `round6()` appended).
   - Not `app/config.js`, not `app/index.html`, not `tools/publish*.js`.
   - **Checker:** run_app ends `0 failed`; build_app runs; the dev-page checks of 8.7.
4. **Simulator** (after 2 and 3).
   - **Files:** `poc/build_simulator.js`, `poc/sim_ui.js`, `poc/sim_tours.js`, `poc/simulator.template.html`,
     `poc/check_simulator.js`.
   - **Checker:** build_simulator runs; check_simulator ends `0 failed`; check_simulator_browser ends `0 failed` or
     says skipped; the manual browser checks of 8.7. check_simulator.js:87 is red between steps 3 and 4 (`APP_FIRST`
     has `app_forms.js`, `FRAME_FILES` not yet), and nothing is built for publishing in between.
5. **Docs** (last, alone).
   - **Files:**
     - `apps-script/README.md` (:363 run_wizard's description; `sale_flow` form/quick; the basket; the new piece's
       count);
     - `app/README.md` (the forms, the job buttons, the photo, the AI wait);
     - `docs/USER-GUIDE.html` (selling on the app, the Telegram backup);
     - `POS-PROJECT-PLAN.md` (the appendix).

Parallelism: 2 and 3 touch disjoint files and both need only 1. Step 4 needs the bundle of 3 and the phone of 2.
Step 5 needs everything. Three files are shared in sequence, always in disjoint regions:

- `poc/run_app.js` (1 then 3);
- `poc/run_sync.js` and `poc/run_gas.js` (1 then 2).

Every report gives the suite counts and any file it needed but did not own.

---

## 10. Deliberately not built this round

- **The R4 "could" jobs as forms:** receive a payment, take a deposit, a return. They stay the chat flows (☰ `M|pay`,
  `M|dep`, the card's `T|`), on the app too. `commitCustomerPayment` (map-core-commits 8.3) is not added.
- **Custom orders and the measurement form:** unchanged (R4).
- **Per-line undo or edit of a saved basket:** the undo is the whole basket, within 30 minutes. So is the owner's void,
  including the void a `stock_negative` ping offers.
- **A basket in quick mode or from voice.** A spoken sale keeps its corrective card (round 5 D7).
- **Telegram extras:** several tags typed at once; a scan that adds to the card without ➕.
- **Restocking a one-of-a-kind piece, or changing a piece's type, name, category or count after Save** (the Items tab
  and the card's buttons do that today).
- **A basket over two shops**, and a transfer as a form.
- **A synchronous photo AI** in the app. Retrying a failed photo job (its Drive upload is lost, app_store.js:653).
  Fixing the phone's `photoFileId` shown as text in Telegram, and the per-phone media-id collision (both exist today,
  section 5).
- **Entering a profit or a percentage to compute the price.** Profit is shown, not typed.
- **Routing ☰ `M|exp` and the card's `R|` to the forms.** The chat flows stay; the home's job buttons open the forms.
- **Moving the bottom bar's hard-coded labels to `t()`** (app/index.html:30-34, map-app-forms 3).
- **Containing a form inside the dev page's 390 px frame.**
- **Deleting the app's chat-step glue** (the `sale` branch of `appInputModeFor`, `appOpenDateSheet`). It is generic,
  tested and correct for the review card's step names. Deleting it would edit run_app 32 and 39 for no seller-visible
  gain.
- **The round-4 dead `enrolledInApp` / `sendAppCard`** (core_bot.js:4470-4480). They are left as they are; a Telegram
  hint "this phone has the app" is a later round.
- **Not added:** a new sync cap, a new `CFG.SOURCE`, a description column. No round-5 MSG key is deleted.
- **Owner approval of new buyers, and merging look-alike customers** (as round 5).
- **Raising `app_min_version`:** nothing new is required of a phone.
