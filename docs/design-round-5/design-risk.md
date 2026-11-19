# design-risk.md: the step-by-step sale and simulator v2, designed risk-first (round 5, 2026-11-11)

Angle: what can break and how the design avoids it. Every mechanism below is the smallest one that satisfies
D1-D9 (BRIEF.md:26-76); where an existing function already does the job it is reused by name. Line numbers are
those of the tree on 2026-11-11 (round 4 built, unpublished). Burmese labels are copied from `MSG`
(apps-script/core_messages.js) and `APP_MSG` (app/app_i18n.js); the few new strings are composed from words that
already appear in MSG and are marked `draft` for the owner's review, as the MSG header asks for every string
(core_messages.js:3).

## Top decisions (the ten that carry the risk)

T1. **One state kind `sale` holds the whole draft; callbacks carry only the item id, a step letter and a short
    argument** (`SS|S1-0042|b|C-0001`, at most 25 bytes). No group id and no date ever rides in a button, so the
    64-byte rule (core_bot.js:299-300) cannot be hit by a customer id or a date. The draft lives in the cache key
    `st:<uid>` like every flow (core_bot.js:2160-2169), not in a token (no second cache key to expire).
T2. **The item card and the quantity grid are not changed: they ARE the count step.** In `steps` mode
    `S|<id>|<n>` means "the count is n" and starts the guided flow instead of writing (core_bot.js:444-451).
    `cardKeyboard` (207-230), `askQty` (246-255), the app's `appCardInfo`/stepper (app_ui.js:37-53, 696-712) and
    every check that pins them stay exactly as they are. A one-of-a-kind piece has one button, so its count is
    skipped (D2) with no code.
T3. **One write at ✅: `commitSaleGroup` writes `[SALE, PAYMENT?]` in one `writeGroup`** (core_ledger.js:66-74),
    the SALE row first (the server checks a PAYMENT against what is owed on the shadow state, core_sync.js:802-805),
    in the shape `splitSale` already produces (1039-1045) so owed, receipts, undo and sync need no new reader. A new
    buyer is created at ✅ too, never while answering (D3).
T4. **Back reuses `btn_back` '⏮ နောက်ပြန်'** (core_messages.js:335); no new glyph, no collision with
    `btn_undo` '↩️ မှားသွားတယ်' (:27). D1 is refined: the back row is `[⏮ နောက်ပြန်, ✖️ မလုပ်တော့]`.
T5. **`DueDay` is the 27th Ledger column, present on every row** (`newTx`, core_ledger.js:31-63); both Sheet
    writers grow the grid before a 27-wide write (`gasEnsureWidth`, gas_store.js:114-117), so the window between
    "publish server" and "run setupSheet" cannot throw; `rewriteRows` copies it onto a replacement (965-990);
    `openCredits` adds `dueDay` and `overdue`, the Credits view gains two columns, the Dashboard sums `Overdue`.
T6. **`sale_flow` defaults to `steps` in code and in setupSheet; `seedSimWorld` sets `quick`** (poc/sim_seed.js:67-74)
    so run_scenario, run_round4, run_sync, run_app and run_lists stay green without one edit; run_round5.js, the
    simulator page and the dev page set `steps` on their worlds.
T7. **`Kind` is present on a list row only when it is set** (`kind` on normalised rows, `t` in compact rows), so
    the exact-shape checks run_lists.js:592/:869/:1003 and run_gas.js:1094-1098 stay green; the legacy key `BANK`
    is a bank by name. Only the Lists tab's column count changes (run_gas.js:421-427, :456 are named in section 7).
T8. **Stale and double taps never write**: `SC|<item>|ok` is the one mutating action (120 s guard,
    core_bot.js:428-432); every `SS|…` tap checks that the state is for that item, at the step letter it carries and on
    the message it was tapped (`state.msgId`), and is otherwise ignored (no edit, no error row); an expired state answers
    `expired` and re-sends the item card. In `steps` mode `S|<id>|<n>` writes nothing, so it leaves the 120 s guard
    (`MUTATING_ACTIONS` lists `S`, :417): otherwise "back to the card, then ✅ ရောင်း ၁ again" within two minutes would be
    dropped in silence.
T9. **The app changes are four small ones, all in app_ui.js**: `appInputModeFor` learns the `sale` kind (text and a new
    `date` mode), `appRenderMsg` adds `data-cb` on buttons (the tour hook), `bootApp` honours `opts.online` and
    `appDoEnroll` asks `APP.sync.online()` instead of `navigator.onLine` (app_ui.js:265, 444: without this the in-page app
    refuses every call when the single-file simulator is opened with the network off, app_sync.js:90), and the dev page
    sets `sale_flow`. Number steps use `await_number` with `saved`, so the keypad auto-opens as today (app_ui.js:758-760)
    with no new app code.
T10. **Simulator v2 keeps `poc/build_simulator.js` as the one builder**; the real app runs in one `srcdoc` iframe
    per device over the shared `createFakeServer(world)` (the dev page's three lines, app/dev/index.html:133-150),
    because `APP` is a singleton (app_ui.js:16) and app.css redefines the template's globals (map-sim CSS note).

---

## 1. Screens

Conventions: "edit" = `ports.chat.editMessage` on the tapped message (`edit` closure, core_bot.js:433, caption-aware);
a typed answer has no tapped message, so the next screen is a NEW message through `editOrSend(ports, chatId, null, …)`
(380-383) and later taps edit that one. The back row is always the last row: `[btn_back '⏮ နောက်ပြန်' → SS|<item>|back|<step>,
btn_cancel '✖️ မလုပ်တော့' → Z]`. `Z` keeps today's meaning (clear the state, edit to `cancelled`, 530-533). In the app
every keyboard row is a `div.row` of flex-1 buttons (app_ui.js:678-687), so one answer per row gives full-width buttons.

### 1.0 Mode switch
`saleFlow(ports)` reads Settings `sale_flow` (`steps` unless the value is `quick`, case-insensitive; `settingOn` is
not used because the value is a word, core_config.js:190-193). `quick` = today's one-tap path untouched. Everything
below is `steps`.

### 1.1 Scan: the item card (unchanged text and buttons)
`openTag` (core_bot.js:101-125) → `sendItemCard` with `cardText`/`cardKeyboard` exactly as today. In `steps` mode the
labels mean:
- UNIQUE: `btn_sold` '✅ ရောင်းပြီး' → `S|id|1` = count 1, the count screen is skipped (D2).
- SKU: `btn_sell_one` '✅ ရောင်း ၁' → `S|id|1` = count 1; `btn_qty` '🔢 အရေအတွက်' → `Q|id` → `askQty` (the ၂..၉ grid,
  `S|id|N` = count N, `btn_type_qty` → `QN|id` → typed count through `await_number sale_qty`). The app's stepper sends
  `S|id|N` (app_ui.js:48-53, 709): the stepper is the count step there.
- `btn_discount` '💬 စျေးလျှော့' / `btn_sell_at` '💬 စျေးပြောပြီး ရောင်း' → `D|id` → `ask_sale_price` (typed) as today
  (457-460); in `steps` mode the typed price does not sell one piece (713-721) but enters the flow: UNIQUE → buyer screen
  with qty 1; SKU → the count screen 1.2. D2's "changed price as a secondary row on the count screen" is therefore met
  by the card's existing row 2 with no card change.
- Price pending: `btn_sell_at` → `D|id` as above; `btn_set_price` unchanged.
Refinement of D1 (why): the digit grids are one question ("how many"), not "various options"; keeping `askQty` keeps
run_scenario :431/:443 and the app stepper untouched. The six-button rule applies to choice screens.

### 1.2 Count after a changed price (SKU only): `saleScreenQty`
Text: `sale_ask_qty_price` (draft) '🔢 ဘယ်နှစ်ထည် ရောင်းလဲ? ({price} ကျပ် နဲ့)' + '\n' + `item.id · item.name`.
Buttons: `[၁ ၂ ၃ ၄] [၅ ၆ ၇ ၈]` → `SS|<item>|q|<n>`; back row. State: `{kind:'await_number', purpose:'sale_step',
saved: <sale state at step 'qty'>}` so a typed count works and the app keypad opens (section 5). Range 1..`CFG.MAX_SALE_QTY`
(999); out of range → `bad_qty` '❓ ၁ မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ' with the back row, state kept (as 722-728).

### 1.3 Buyer: `saleScreenBuyer(forPart)`
Text: `credit_ask_customer` '👤 ဝယ်သူ ဘယ်သူလဲ?' (core_messages.js:98).
Buttons (at most six answers, D1):
1. `btn_no_name` (draft) '🚫 နာမည် မရှိ' → `SS|<item>|b|none` (absent when `forPart`: a part payment needs a buyer, D2)
2.-5. up to four `recentCustomers(ports, staff.shop, 4)` (core_ledger.js:1297-1312) as `'👤 ' + c.name` → `SS|<item>|b|<custId>`
6. `btn_new_customer` '✏️ နာမည်အသစ်' → `SS|<item>|b|new`
Back row.
Typing on this screen (name or phone): `saleBuyerNamed` with `matchCustomers` (1370-1374): exact → that buyer; no
look-alike → `draft.newName = text`, then 1.4; look-alikes → NEW message `cust_pick` '👤 "{name}" · ဘယ်သူလဲ?' with up to
four `customerLabel(c)` → `SS|<item>|b|<id>`, `btn_create_named` '✏️ "{name}" အသစ် ဖန်တီး' → `SS|<item>|b|create`, back row
(the `pickCustomer` screen 1460-1472 minus its immediate `addCustomer` at 1465: nothing is created before ✅, D3).
`SS|<item>|b|new` edits the screen to `ask_name` '✏️ နာမည် ရိုက်ပေးပါ' with the back row; the typed name goes the same way.

### 1.4 Phone of a new buyer (optional): `saleScreenPhone`
Only after a NEW name. Text: `ord_ask_phone` '📞 {customer} ၏ ဖုန်းနံပါတ် ရိုက်ပါ (မရှိရင် ကျော်ပါ)' (:219, reused verbatim).
Buttons: `[btn_skip '⏭ ကျော်' → SS|<item>|ph|skip]`, back row. Note the skip is NOT `Z` (today's phone prompt skips with `Z`,
core_bot.js:1527, which would cancel the sale: map-app 16.4). Typed: `isValidPhone` → `normPhone`, else kept as typed
(the `savePhone` rule, 1531-1540); stored in `draft.newPhone`, written at ✅ with `updateCustomer({phone})`.
An existing buyer without a phone is not asked here; the sold card offers `phoneRow` (363-365) afterwards, as today.

### 1.5 How paid: `saleScreenMethod`
Text: `exp_ask_method`-style wording is wrong (it names an expense); use `sale_ask_method` (draft) '💰 {total} ကျပ် · ဘယ်လိုပေးလဲ?'
('ဘယ်လိုပေးလဲ?' is from `exp_ask_method` :164 and `dlv_ask_method` :304; {total} = qty × unit price).
Buttons from `payMethodsByKind(ports, shop)` (section 3.3):
1. `btn_cash` '💵 ငွေသား' → `SS|<item>|m|CASH`
2.-4. up to three wallets, one per row, `btn_wallet` (draft) '📱 {method}' with `methodLabel` → `SS|<item>|m|<KEY>`; a
   fourth and later wallet are reached through `btn_more` '▶️ နောက်ထပ်' (:217) → `SS|<item>|m|more` (the account screen
   filtered to wallets)
5. `btn_bank_transfer` (draft) '🏧 ဘဏ်' → `SS|<item>|m|bank` (shown only when the shop has at least one bank or the store
   can add one; when there is none the next screen says `acct_none` 'ℹ️ ဘဏ်အကောင့် မရှိသေးပါ။ ➕ နဲ့ ထည့်ပါ။' :398 with ➕)
6. `btn_split` '💵+🏦 ခွဲပေး' (:376) → `SS|<item>|m|mix`
Last row before the back row: `btn_add_bank` '➕ ဘဏ်အသစ်' → `LA|pm|SSA|<item>` (section 1.10). Back row.
Lower-case arguments are categories, upper-case ones are account keys (pay_method keys are upper-cased by
`listNormKey`, core_ledger.js:326-329), so `bank`/`mix`/`more` never collide with the legacy key `BANK`.
A `CASH` or wallet answer sets `draft.method` and goes to 1.8.

### 1.6 Which account: `saleScreenAccount(filter)`
Reached after `bank` (banks only), `mix` (every non-cash account) or `more` (wallets only). Skipped when the filter
leaves exactly one account (D2; `startSplit`'s rule, core_bot.js:1169) except for `more`.
Text: `split_ask_bank`-style: for `bank` `sale_ask_account` (draft) '🏧 ဘယ်အကောင့်လဲ?' ('ဘယ်အကောင့်' from `split_ask_bank` :377);
for `mix` `split_ask_bank` '💵+🏦 ဘယ်အကောင့်နဲ့ ခွဲပေးလဲ? (ပေးငွေ {cash})' with {cash} = total.
Buttons: one per account, `btn_bank` '🏦 {method}' for banks and `btn_wallet` for wallets → `SS|<item>|a|<KEY>` (layout as
`methodRows`: one row while ≤ 3 and no label over ten characters, else rows of two, 303-322); `btn_add_bank` → `LA|pm|SSA|<item>`;
back row. A button whose data would exceed 64 bytes is skipped (`utf8ByteLength`, 312); with keys ≤ 12 bytes
(`LIST_KEY_MAX_BYTES`) the longest is `SS|S1-0042|a|` + 12 = 25 bytes, so none is.
Sets `draft.method = KEY`; `bank`/`more` → 1.8; `mix` → 1.7.

### 1.7 Transfer part of a mixed payment: `saleScreenBankPart`
Text: `split_ask_amount` '💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ? ဂဏန်း ရိုက်ပါ (ပေးငွေ {cash} · ကျန်တာ ငွေသား)' (:378) with {cash} = total.
Buttons: `btn_half` 'တစ်ဝက် {amount}' (:254) → `SS|<item>|x|half`; back row. State: `await_number sale_step` (saved step `bank`).
Range 1..total−1 (a bank part equal to the total is not a mix: the seller should pick the account on 1.5/1.6); out of range →
`sale_bad_amount` (draft) '❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ' (from `split_bad` :382 plus {min}), state kept. Sets `draft.bankPart`.

### 1.8 Full now or part now: `saleScreenFull`
Text: `sale_ask_full` (draft) '💰 စုစုပေါင်း {total} ကျပ် · ဘယ်လောက် ပေးလဲ?' ('စုစုပေါင်း' :97, 'ဘယ်လောက် ပေးလဲ?' :104).
Buttons: `[btn_all 'အကုန် {amount}' (:44, amount = total) → SS|<item>|f|all]`, `[btn_credit '💳 မကျေသေး' (:41) → SS|<item>|f|part]`; back row.
`all` → `draft.paid = total` → 1.11. `part` → if no buyer yet (`none`) → 1.3 with `forPart` (then 1.9); else 1.9.

### 1.9 How much now (part): `saleScreenPaid`
Text: `credit_ask_paid` '💳 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)' (:97), the `startCredit` screen (1596-1607).
Buttons: `0` → `SS|<item>|p|0` (absent when mixed: the bank part is already paid), `fmtMoney(half)` → `SS|<item>|p|half`
(absent when half < bankPart), `btn_other` '✏️ အခြား' → `SS|<item>|p|other` (edits the text to `ask_number`, state unchanged);
back row. State: `await_number sale_step` (saved step `paid`). Range `bankPart`..total−1; out of range → `sale_bad_amount`.
Sets `draft.paid` → 1.10.

### 1.10 When the rest is paid: `saleScreenDue`
Text: `sale_ask_due` (draft) '📅 ကျန် {owed} ကျပ် · ဘယ်တော့ ပေးလဲ?' ('ကျန်' :99, 'ဘယ်တော့' :236).
Buttons: `btn_days '{n} ရက်'` (:238) for `saleDuePresets(ports)` (Settings `sale_due_presets`, default `CFG.SALE_DUE_PRESETS`
[7, 14, 30]: a week, two weeks, a month) → `SS|<item>|d|<n>`; `btn_due_type '✏️ ရက်စွဲ ရိုက်'` (:240) → `SS|<item>|d|type`;
`btn_due_unknown` (draft) '🤷 မသေချာ' ('မသေချာ' :342) → `SS|<item>|d|none`; back row (six answers at most with three presets).
`type` → state step `due_text`, text `ord_ask_due_text` '✏️ ရက်စွဲ ရိုက်ပါ (ဥပမာ 30.10.26)' (:251) with the back row; a typed
date through `parseDayText` (also `yyyy-mm-dd`, section 3.2); bad → `ord_bad_date` (:252), state kept. Sets `draft.dueDay`
(`addDaysKey(today, n)`, the typed key, or '').

### 1.11 Summary: `saleScreenSummary`
Text, line by line:
1. `confirm_sale` '📝 ရောင်း {qty} ထည် · {name} · {amount} ကျပ်' (:61) + `confirm_sale_credit` ' · ပေး {paid} · 👤 {customer}' (:62)
   when a buyer or a part payment (customer = the picked name or `draft.newName`; with no buyer and a full payment: nothing).
2. One account: `method_mark` ' · 🏦 {method}' (:134) appended to line 1 (as `describeProposal` does, core_bot.js:980). Mixed:
   `sale_sum_mixed` (draft) '💵 {cashMethod} {cash} · 🏦 {method} {bank}' (= `split_done` :379 without ' · မှတ်ပြီး').
3. Part: `dlv_owed` '💳 ကျန် {owed} · အကြွေး' (:306), then `sale_due_set` (draft) '📅 {date} ပေးမယ်' with `fmtDayMy` or
   `sale_due_none` (draft) '📅 မသေချာ'.
4. `confirm_ask` 'မှန်ပါသလား?' (:69).
Buttons: `[btn_yes '✅ မှန်တယ်' (:28) → SC|<item>|ok]`, back row (`SS|<item>|back|summary`).
Nothing has been written up to here (D3). The state TTL is `STATE_TTL_SEC` 1800 s; a tap after that answers `expired`
'⏱ သက်တမ်းကုန်သွားပါပြီ။ ထပ်ပြောပေးပါ။' and re-sends the item card (section 3.4 `saleExpired`).

### 1.12 ✅: the sold card (edit of the summary message)
`saleCommit` re-reads the item; a UNIQUE piece with stock ≤ 0 (sold meanwhile on another phone) edits the message to
`cardText` (`card_sold_out` + `card_buyer`, core_bot.js:185-203) with `cardKeyboard` and writes nothing. Otherwise: the new
buyer (if any) through `addCustomer` + `updateCustomer({phone})`, then `commitSaleGroup` (section 3.3), then the edit:
`soldText(fresh, qty, r)` (241-243) + `cust_attached` '👤 ဝယ်သူ {customer} · မှတ်ပြီး' (:142, buyer and no owed) or
`credit_done` '💳 👤 {customer} · ပေးပြီး {paid} · ကျန် {owed} ကျပ်' (:99, owed) + `methodLine` (367-370, one account) or
`split_done` (mixed) + `sale_due_set`/`sale_due_none` when owed. Keyboard: `afterSaleKeyboard(ports, g, {plain: true})` =
`[btn_undo, btn_receipt]` + `[btn_pay]` while owed (D3: no corrective rows) + `phoneRow(customer)` (363-365). When the buyer holds
a free deposit and still owes, the existing `credit_use_deposit` question with `CD|g|yes|no` is appended instead (`finishCredit`'s
rule, 1663-1666; `creditDeposit` 1670-1680 works on any committed group). `setLastItem`, `setLastGroup`, `markCommittedCard`,
`clearState`.

### 1.13 Back
Every screen's back row pops the step stack `hist` (section 3.4): skipped screens were never pushed, so back never lands
on one. Back on the first guided screen edits the message back into the item card (`cardText` + `cardKeyboard`) and clears the
state: the count is chosen again, on the same `S|id|1` button, which must therefore work again within 120 s (in `steps` mode
`S` is exempt from the mutating-tap guard, 3.4). Fields a step owns are deleted when it is left backwards (e.g. back from 1.10
to 1.9 clears `draft.dueDay`), so a changed answer never carries a stale later answer into the summary.

### 1.14 Telegram vs app
Same core, same screens. Telegram: in-place edits of the tapped message (caption edits on photo cards); typed answers start a
new message. App: identical, plus the number keypad opens by itself on `await_number` steps (app_ui.js:758-760), the text bar for
`sale` steps `buyer`/`name`/`phone`, and a date field for `due_text` (section 5). The home screen shows only the latest bot
message (app_ui.js:352, 468), which is always the current question because every step edits it or sends the next one.

### 1.15 Everything else on the menu
`showMenu` (core_bot.js:127-147), restock, return, transfer, expense, deposit, payment, orders, measurements, reports, 📲 and
📱 are unchanged. The owner/seller differences stay those of 127-147 and 1811.

---

## 2. Data model

### 2.1 Ledger: `DueDay`
- `CFG.LEDGER_COLS` gains `'DueDay'` as the 27th and last name (after `ReceiptNo`, core_config.js:132-134): both Sheet writers
  are positional by CFG order (gas_store.js:385, gas_sync.js:169-180) and `ensureColumns` appends at the right-hand end
  (gas_setup.js:257-265), so the Sheet order equals CFG order. Seq/ReceivedAt/DeviceID stay adjacent for `stampSeq` (gas_sync.js:193-197).
- Value: `yyyy-mm-dd` (text, like `Day`) on a SALE row that still owes at commit time and whose seller chose a date; `''`
  otherwise (full payment, "not sure", every other row type, mirrors, rows older than the column).
- `newTx` adds `dueDay: f.dueDay || ''` (27 keys on every row). `rewriteRows` copies `row.dueDay` onto the replacement
  (`changes.dueDay` when given) and leaves the mirror blank (core_ledger.js:975-988). `undoGroup` mirrors blank (918-925).
- Readers: `saleGroupInfo` exposes `dueDay` of the first live SALE row (1078-1085); `openCredits` returns `dueDay` and
  `overdue` (1160-1165); the Credits view, the owed report, the 21:00 summary and the simulator's Credits tab read them.
- Overdue rule (D4): `creditOverdue(c, today) = c.dueDay ? today > c.dueDay : c.days >= CFG.OVERDUE_DAYS`.
- Sync: `syncValidateTx` lists `dueDay` among the optional string fields and, when non-blank, requires `^\d{4}-\d{2}-\d{2}$`
  (core_sync.js:381-385). Checksums hash only n/amount/cash (876-903): a date can never cause a repair loop.

### 2.2 Credits view
`CFG.CREDIT_COLS` gains `'DueDay', 'Overdue'` at the end (13 → 15, core_config.js:157); `gasStore.refreshViews` writes
`c.dueDay || ''` and the boolean `!!c.overdue` (gas_store.js:684-686). The Dashboard's overdue cell becomes
`=SUMIF(<Credits Overdue>, TRUE, <Credits Owed>)` labelled `Overdue` (gas_setup.js:405-406), so the Sheet, the summary and the
simulator agree on one rule. The Credits tab is rewritten whole (clearContents + setValues) so an older 13-header tab needs no migration.

### 2.3 Lists: `Kind`
- `CFG.LIST_COLS` gains `'Kind'` at the end (core_config.js:116); `CFG.LIST_KINDS = ['wallet', 'bank']`.
- Normalised row: `kind` is present only when the source has a non-empty value in `LIST_KINDS` (lower-cased, trimmed); anything
  else drops the field. `methodKind(row)` = `row.kind || (row.key === CFG.METHOD.BANK ? 'bank' : 'wallet')`: a row without a
  Kind is a wallet (D6), except the legacy key `BANK` (`method_BANK` 'ဘဏ်လွှဲ', core_messages.js:130), which the version-3 seed
  made for bank transfers (`legacyListRows`, core_ledger.js:378-395) and must sit behind '🏧 ဘဏ်'.
- Compact row: `listRowToCompact` adds `t: row.kind` only when set; `listRowFromCompact` maps `kind: c.t`. A sheet without a
  Kind anywhere produces byte-identical `lists_json` (no needless Settings-hash change on every phone at publish).
- Upsert: `listUpsert` carries `rec.kind` onto an appended row (core_ledger.js:582); Kind is never `set` afterwards (the laptop
  edits the cell; `gasListsPersist` keeps its two set fields, gas_store.js:319-323).
- Sheet: `gasListRows` reads `kind: text(o.Kind)` (gas_store.js:244-249), `listOptions` passes it (629-633), `gasListValues` maps
  `Kind: r.kind || ''` (276-282), `ensureListsTab` adds a `Kind` dropdown over `LIST_KINDS` (allow blank) and the header note
  `lists_note_kind` (gas_setup.js:183-196).
- Sync from a phone: `syncListRecReason` accepts an absent or `LIST_KINDS` `kind` (core_sync.js:469-481); `syncApplyListEntry`
  copies it (519-520). An older server ignores the field (no unknown-field rule) and stores the row as a wallet.

### 2.4 Settings
| Key | Values | Default (code and setupSheet) | Read by |
|---|---|---|---|
| `sale_flow` | `steps` \| `quick` | `steps` | `saleFlow(ports)` in `handleCallback` 'S', `applyAwaitedNumber` 'sale_price'/'sale_qty', `afterSaleKeyboard` callers |
| `sale_due_presets` | days, comma list | `7,14,30` (`CFG.SALE_DUE_PRESETS`) | `saleDuePresets(ports)` |
Both reach phones like every key (`syncSettingsFor` copies all rows, core_sync.js:915-929; pulled on a hash change, 1010; bootstrap
always, 1062-1067). A phone that has not pulled since the owner changed `sale_flow` follows at its next sync (every push also
pulls); until then it uses the code default `steps`, the same default the server has. The per-device override `setting:sale_flow`
(app_store.js:341-344) is not surfaced in the app (section 9).

### 2.5 Customers
Unchanged shape. A new buyer typed in the flow becomes a Customers row only at ✅ (`addCustomer({name})`, then
`updateCustomer(id, {phone})` when a valid or odd phone was typed). On the phone this queues a `customer` outbox entry, applied
before the sale group by `ENTRY_KINDS` order (core_sync.js:75, 1352-1356); the id matches `^C-[0-9a-zA-Z]{4,12}$` (424;
app ids are `C-` + 8 hex, app_store.js:326).

---

## 3. Core functions

### 3.1 core_config.js
- `LEDGER_COLS`: `+ 'DueDay'` (last). `CREDIT_COLS`: `+ 'DueDay', 'Overdue'` (last). `LIST_COLS`: `+ 'Kind'` (last).
- New: `LIST_KINDS: ['wallet', 'bank']`, `SALE_DUE_PRESETS: [7, 14, 30]`, `SALE_FLOW: { STEPS: 'steps', QUICK: 'quick' }`,
  `SALE_QTY_GRID: [1, 2, 3, 4, 5, 6, 7, 8]` (the price-path count screen).

### 3.2 core_burmese.js and core_orders.js
`addDaysKey(day, n)`, `daysBetweenKeys(dayA, dayB)` and `parseDayText(text, now)` MOVE from core_orders.js:49-78 to
core_burmese.js (its header already says "numbers, dates and text helpers", :2-4; `MY_DIGITS` lives there). They are removed from
core_orders.js (one global scope: a second definition would silently win; D9). `parseDayText` additionally accepts
`^\d{4}-\d{2}-\d{2}$` (what the app's date field sends) and returns it as the key after the same month/day validity check.
Every loader loads core_burmese before core_orders (run_scenario.js:13-18, bundle_gas FILES, build_app CORE_FIRST), and
run_lists (which never loads core_orders) gains the date helpers for free.

### 3.3 core_ledger.js
```
saleFlow(ports) -> 'steps' | 'quick'                      // String(getSetting('sale_flow', 'steps')).toLowerCase() === 'quick' ? 'quick' : 'steps'
methodKind(row) -> 'wallet' | 'bank'                      // section 2.3
payMethodsByKind(ports, shop) -> { wallets: [KEY], banks: [KEY] }
   // the keys payMethods(ports, shop) returns (116-130: CASH first, 12-byte drop, MAX_BANK_BUTTONS cap), without CASH, split by methodKind of listOption(ports, 'pay_method', key)
creditOverdue(c, today) -> boolean                        // section 2.1
commitSaleGroup(ports, p) -> { groupId, txs, sale, payment }
   // p = { item, qty, unitPrice, paid, method, bankPart, customerId, dueDay, note, staff, source, transcript, updateId, when }
   // amount = qty * unitPrice; paid clamped 0..amount; bankPart clamped 0..paid (0 when method is CASH)
   // sale = newTx(SALE, qty -qty, unitPrice, amount, cash = paid - bankPart, costAtSale item.cost, customerId,
   //              method = bankPart > 0 ? CASH : methodFor(method, cash), note = p.note || (bankPart ? 'split' : owed > 0 ? 'credit' : ''),
   //              dueDay = owed > 0 ? p.dueDay || '' : '')
   // payment (only when bankPart > 0) = newTx(PAYMENT, amount = cash = bankPart, method, refGroupId = sale.groupId, customerId, note 'split')
   // writeGroup(ports, payment ? [sale, payment] : [sale])   // SALE first: core_sync.js:802-805; the shape of splitSale 1039-1045
listFindByLabel(ports, name, label) -> { ok: false, reason: 'empty' | 'unavailable' } | { ok: true, existed: true, key, label } | { ok: true, existed: false, label: <clean> }
   // the first half of addListOptionByLabel (715-724: listCleanText, the digits/amount refusal, the lookup by listNameKey), split out so the
   // ➕ inside the sale can ask the kind BEFORE anything is written (D3, D6); addListOptionByLabel itself calls it and is otherwise unchanged
```
Changed: `newTx` (+`dueDay`), `rewriteRows` (replacement copies `dueDay`), `commitSale` passes `dueDay: p.dueDay` (so the
voice path could carry one later; it passes none today), `saleGroupInfo` (+`dueDay`), `openCredits` (+`dueDay`, `overdue`),
`listNormRow` (+`kind` when set), `listRowToCompact`/`listRowFromCompact` (`t`), `listUpsert` (append carries `kind`),
`addListOptionByLabel(ports, name, label, staff, extra)` (`extra.kind` onto the rec; the 4-argument calls are unchanged; its
first half becomes `listFindByLabel`),
`buildDailySummary`: `overdue = openCredits(ports, null).filter(c => c.overdue)`; those with a `dueDay` print one line
`summary_due_overdue` '⏰ ရက်လွန် အကြွေး: {list}' with `name amount (date)`, those without print today's `summary_overdue` line
unchanged (1551-1557).

### 3.4 core_bot.js
State shapes:
```
sale state   = { kind: 'sale', step: <step>, item: <itemId>, hist: [<steps left behind>],
                 msgId: <the message the current question is on: the tapped message, or the id sendMessage returned for a typed answer
                         (sim_ports.js:299, app_ports.js:98 return {messageId}); null when the port returned none>,
                 draft: { qty, unitPrice, customerId, newName, newPhone, method, mixed, bankPart, paid, dueDay, forPart, addLabel } }
number step  = { kind: 'await_number', purpose: 'sale_step', saved: <sale state> }     // steps qty, bank, paid
steps        : 'qty' | 'buyer' | 'name' | 'phone' | 'method' | 'account' | 'bank' | 'full' | 'paid' | 'due' | 'due_text' | 'kind' | 'summary'
```
TTL: `STATE_TTL_SEC` (setState, 2164-2169; `sale_step` is not a prompt, so 1800 s). `openTag` clears any state (122): a scan
always starts over; `dropAddState` (2175-2180) leaves a sale state alone, so the menu does not lose a draft.

Callbacks (all under 26 bytes; `SS` and `SC` join `ITEM_ACTIONS` (414) so `item` is loaded and a vanished tag answers `tag_not_found`;
`SC` joins `MUTATING_ACTIONS` (417-418), `SS` does not: a second `back` within 120 s must work):
```
SS|<item>|q|<1..8>          count (price path)          SS|<item>|b|none|new|create|<custId>   buyer
SS|<item>|ph|skip           no phone                    SS|<item>|m|CASH|<KEY>|bank|mix|more   how paid
SS|<item>|a|<KEY>           account                     SS|<item>|x|half                       transfer part preset
SS|<item>|f|all|part        full or part                SS|<item>|p|0|half|other               paid now presets
SS|<item>|d|<n>|type|none   due                         SS|<item>|k|wallet|bank                kind of a ➕ account
SS|<item>|back|<step>       back from <step>            SC|<item>|ok                           commit
LA|pm|SSA|<item>            ➕ account inside the sale (ADD_RESUME_LIST.SSA = 'pay_method', 1334-1335)
```
Functions:
```
saleStateOf(ports, uid) -> sale state | null             // kind 'sale', or await_number/sale_step -> saved
saleGuard(ports, uid, itemId, step, msgId) -> state | null   // same item, (step null or equal), (state.msgId null or equal to the tapped message); never edits
startGuidedSale(chatId, msgId, isCaption, uid, item, qty, unitPrice, staff, ports)
   // called by handleCallback 'S' (steps mode), applyAwaitedNumber 'sale_qty' (steps), and saleFromPrice; builds the state and calls saleGo
saleFromPrice(chatId, uid, item, price, staff, ports)    // applyAwaitedNumber 'sale_price' in steps mode: UNIQUE -> buyer, SKU -> qty screen
saleGo(ctx, state, step)                                 // sets state.step, pushes the old step on hist (unless skipped), setState, draws the screen
   // ctx = { chatId, msgId (null after typed input), isCaption, uid, staff, ports, prefix }
saleScreenQty / saleScreenBuyer / saleScreenPhone / saleScreenMethod / saleScreenAccount / saleScreenBankPart /
saleScreenFull / saleScreenPaid / saleScreenDue / saleScreenKind / saleScreenSummary (ctx, state)   // section 1 texts and buttons
saleNext(ctx, state)                                     // the step after the current one, with the skips of section 1 (no bank -> acct_none, one account -> skip)
saleBack(ctx, state, fromStep)                           // ignored unless state.step === fromStep; pops hist, deletes the fields of the left step, saleGo
saleCallback(chatId, msgId, isCaption, uid, parts, item, staff, updateId, ports)   // SS dispatcher: saleGuard, then by step letter
saleText(chatId, uid, state, text, n, staff, updateId, ports) -> handled?          // steps buyer/name (saleBuyerNamed), phone, due_text
saleNumber(chatId, uid, saved, n, staff, updateId, ports, source, transcript)       // applyAwaitedNumber 'sale_step': range per step, re-set state on a bad value
saleSummaryText(ports, state, item) -> text              // section 1.11
saleCommit(chatId, msgId, isCaption, uid, item, staff, updateId, ports)             // SC: section 1.12
saleExpired(chatId, msgId, isCaption, item, staff, ports)                           // edit expired, sendItemCard, nothing else
saleAccountResume(chatId, uid, itemId, key, created, label, staff, ports, prefix)    // finishAddOption case 'SSA': created -> saleScreenKind (asks wallet|bank, then
                                                                                    // addListOptionByLabel with {kind}); existed -> draft.method = key, saleNext
saleDuePresets(ports) -> [n]                             // Settings sale_due_presets or CFG.SALE_DUE_PRESETS, positive numbers only
afterSaleKeyboard(ports, groupId, opts)                  // opts.plain: rows 1-2 only (270-287 otherwise unchanged)
```
Wiring: `handleCallback` case `'S'`: `if (saleFlow(ports) === 'steps') return startGuidedSale(chatId, msgId, isCaption, uid, item, clampQty(arg), null, staff, ports);`
before today's commit (444-451); the double-tap guard (428-432) becomes
`if (MUTATING_ACTIONS[action] && !(action === 'S' && saleFlow(ports) === 'steps'))` (`S` writes nothing in `steps` mode, and the
card reached by back must sell again within 120 s); `startGuidedSale` returns without editing when the state is already this item's
first guided step on this message with the same count (a double tap on ✅ ရောင်း ၁ or on the app's stepper produces no identical
edit and no Errors row); cases `'SS'` → `saleCallback`, `'SC'` → `saleCommit`. `applyAwaitedNumber`: `sale_price` and
`sale_qty` branch on `saleFlow` (steps → `saleFromPrice` / `startGuidedSale` with a new message, since msgId is null); new case
`sale_step` → `saleNumber`. `handleText`: inside `if (state)` (668), FIRST: `if (state.kind === 'sale') { var h = saleText(…); if (h) return h; }`
(a typed phone or name parses as a number, 658-659, so it must come before the number paths). `finishAddOption`: case `'SSA'` →
`saleAccountResume`; for `SSA` the add is deferred until the kind is known (D6: the two-button kind screen after the name), so
`finishAddOption` calls `listFindByLabel` (3.3) instead of `addListOptionByLabel` when `state.resume.a === 'SSA'`: `empty` asks again
as today (1422-1426), an existing label resumes at once with `add_exists` and `draft.method = key`, a new label goes into `draft.addLabel`
and `saleGo(…, 'kind')`; the `SS|<item>|k|wallet|bank` tap then calls `addListOptionByLabel(ports, 'pay_method', draft.addLabel, staff,
{ kind })` and continues with `add_done` in front of the next screen (`withPrefix`, 386-388). Nothing is written while the kind is asked. `buildAiContext.awaiting` = `'sale_' + step` (615-624).

Stale and double taps (T8): `saleCallback` with no state for that item → `saleExpired` (edit + card), except when
`isCommittedCard(ports, chatId, msgId)` (1405-1407): then nothing. A state at another step, or on another message (`state.msgId`:
the ၂..၉ grid left behind after the card itself was tapped again) → `return` (the current screen is already on the phone; no edit,
so no "message is not modified" error row). `SC` after the commit cleared the state → the card was
`markCommittedCard`ed → nothing. The 120 s `tap:` guard drops a second ✅ on the same message before the redraw (428-432).

Typed text at a button-only step (method, full, due, summary, kind) is not consumed by `saleText` and falls through to today's
paths (a tag id opens its card and clears the state, 652-653; anything else reaches the AI as in the expense flow). Voice inside
the flow: a spoken number at a number step works through `handleIntent` 823-831 as today; nothing else is built (D7).

### 3.5 core_sync.js, core_report.js
- `syncValidateTx`: `'dueDay'` added to `strings` (381) plus the format rule of 2.1. `syncListRecReason`/`syncApplyListEntry`: `kind` (2.3).
- `owedReport` (core_report.js:302-312): one more column `ပေးမည့်ရက်` (draft, parallel to `ရွေးမည့်ရက်` :236) with `fmtDayShortMy(c.dueDay)`
  or '', and ' ⏰' after `c.days` when `c.overdue`. The month report and the customer statement (220, 272) are unchanged.
- `describeRow`, `buildReceipt`, `receiptText` unchanged: the receipt already prints mixed methods and `receipt_transfer` while owed (322-369).

### 3.6 Messages: new keys (core_messages.js, step 1 adds all of them)
All drafts; composed from words already in MSG (the source key is given); the owner may rewrite any of them in the Messages tab.
```
btn_no_name: '🚫 နာမည် မရှိ'                                     // btn_design_none :226, ask_name :80
btn_wallet: '📱 {method}'                                        // btn_bank :131 pattern
btn_bank_transfer: '🏧 ဘဏ်'                                      // summary_cash :205 ('ဘဏ်'); not '🏦 ' + text and not ဘဏ်လွှဲ (SPEC-round-4 §0 rule)
btn_due_unknown: '🤷 မသေချာ'                                     // ms_low_hint :342
btn_kind_wallet: '📱 Pay'                                        // lists_note_list :415 ('Pay အကောင့်')
btn_kind_bank: '🏧 ဘဏ်'
sale_ask_qty_price: '🔢 ဘယ်နှစ်ထည် ရောင်းလဲ? ({price} ကျပ် နဲ့)'      // ask_qty :18, split_ask_amount :378 ('နဲ့')
sale_ask_method: '💰 {total} ကျပ် · ဘယ်လိုပေးလဲ?'                  // exp_ask_method :164
sale_ask_account: '🏧 ဘယ်အကောင့်လဲ?'                              // split_ask_bank :377
sale_ask_full: '💰 စုစုပေါင်း {total} ကျပ် · ဘယ်လောက် ပေးလဲ?'        // credit_ask_paid :97, pay_ask_amount :104
sale_ask_due: '📅 ကျန် {owed} ကျပ် · ဘယ်တော့ ပေးလဲ?'               // credit_done :99, ord_ask_due :236
sale_due_set: '📅 {date} ပေးမယ်'                                 // btn_use_deposit :46 ('သုံးမယ်' pattern)
sale_due_none: '📅 မသေချာ'
sale_sum_mixed: '💵 {cashMethod} {cash} · 🏦 {method} {bank}'      // split_done :379 minus ' · မှတ်ပြီး'
sale_bad_amount: '❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ'          // split_bad :382
sale_ask_kind: '➕ "{label}" · ဘဏ် လား၊ Pay လား?'                  // ord_ask_viber :220 ('လား?'), lists_note_list :415
summary_due_overdue: '⏰ ရက်လွန် အကြွေး: {list}'                   // summary_orders_overdue :369, summary_overdue :208
lists_note_kind: 'wallet = Pay အကောင့် (KBZPay, WavePay, QR) · bank = ဘဏ်လွှဲ · ကွက်လပ် = wallet'   // lists_note_shop :420 ('ကွက်လပ်')
```
Reused verbatim (no new key): `btn_back`, `btn_cancel`, `btn_skip`, `btn_other`, `btn_all`, `btn_half`, `btn_yes`, `btn_credit`,
`btn_cash`, `btn_bank`, `btn_split`, `btn_add_bank`, `btn_more`, `btn_new_customer`, `btn_create_named`, `btn_days`, `btn_due_type`,
`credit_ask_customer`, `cust_pick`, `ask_name`, `ord_ask_phone`, `split_ask_bank`, `split_ask_amount`, `credit_ask_paid`, `ask_number`,
`ord_ask_due_text`, `ord_bad_date`, `confirm_sale`, `confirm_sale_credit`, `method_mark`, `dlv_owed`, `confirm_ask`, `cust_attached`,
`credit_done`, `method_done`, `split_done`, `credit_use_deposit`, `acct_none`, `add_done`, `add_exists`, `expired`, `cancelled`,
`bad_qty`, `card_sold_out`, `tag_not_found`.
No new button text contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ or starts with '🏦 ' (the round-4 rule, SPEC-round-4.md:99-102;
run_lists.js:919-921 checks the 40 round-4 keys; run_round5 repeats the check over the keys above).

---

## 4. Glue and sync

### 4.1 setupSheet (gas_setup.js)
Order inside `setupSheet` (14-88): `var ledger = ensureTab(ss, 'Ledger', CFG.LEDGER_COLS)` is preceded by growing the grid, because a
fresh tab has 26 columns and the header is now 27 wide (`ensureTab` writes `header.length` cells, 247-253): take the sheet first
(`ss.getSheetByName('Ledger') || ss.insertSheet('Ledger')`), `gasEnsureWidth(sh, CFG.LEDGER_COLS.length)`, then `ensureTab` and
`ensureColumns(ledger, CFG.LEDGER_COLS)` (the `setupTailoringTabs` precedent, 118-125). Then `textColumn(ledger, CFG.LEDGER_COLS, 'DueDay')`
(next to Day/Time, 36-39). `defaults` gains `['sale_flow', 'steps']` and `['sale_due_presets', CFG.SALE_DUE_PRESETS.join(',')]` (44-66;
added only when missing, 67-68). Credits: `ensureTab(ss, 'Credits', CFG.CREDIT_COLS)` is fine on a new tab; an existing tab is rewritten
whole by `refreshViews`. `writeDashboard`: the overdue cell of 2.2. `ensureListsTab`: `ensureColumns(sh, CFG.LIST_COLS)` appends `Kind` at the
right-hand end of an existing tab (154); new nicety: a `Kind` dropdown `requireValueInList(CFG.LIST_KINDS, true).setAllowInvalid(false)` from
row 2 (a blank stays allowed, like Shop, 189-190; it is a third `list` validation, so run_gas.js:463-464 is named in 7.6); the header-note
loop (192-196) needs `lists_note_kind`; the seed rows (164-174) need no change (`gasListValues` writes '' for a missing `kind`; the legacy
BANK row is a bank by name, 2.3; nothing is typed into the seed, so run_gas's seed expectations change only by the ninth, blank, cell).

### 4.2 The write path and the publish window (gas_store.js, gas_sync.js)
`gasStore.appendLedger` (371-388) and `gasSyncTabs.appendRows` (174-183) both call `gasLedgerWidth(sh)` first: once per execution
(a module flag like `GAS_LEDGER_MEMO`), `if (sh.getMaxColumns() < CFG.LEDGER_COLS.length) gasEnsureWidth(sh, CFG.LEDGER_COLS.length)`.
Cost: one `getMaxColumns()` per execution. Effect: between "publish server" and "run setupSheet" a 27-value write no longer hits a
26-column grid (map-glue GAP 1); the value lands under a blank header and becomes readable as `o.DueDay` the moment `setupSheet`
writes the header (`gasTable` keys by header, 36-51). The README keeps the order "publish server, run setupSheet once, publish the
app" (SPEC-round-4.md:942-943); the guard is the belt, the order the braces. `fake_gas` models `getMaxColumns` and `insertColumnsAfter`
(run_gas.js:201-203), so run_gas can prove it. Maps: `appendLedger` and `gasSyncLedgerValues` add `DueDay: tx.dueDay || ''`;
`ledgerRows` adds `dueDay: o.DueDay === undefined ? '' : gasDay(o.DueDay)` (389-404).

### 4.3 Validation and old phones
- New server, old phone (no `dueDay` on its rows): `syncValidateTx` treats an absent optional field as valid (381-385); the server stores
  `''`; overdue falls back to `OVERDUE_DAYS`. Pulled rows carry `dueDay`; `appendSynced` copies the row as given (app_store.js:444-452) and
  the old app ignores the key.
- New phone, old server: the tx passes (no unknown-field rule), `gasSyncLedgerValues` of the old server drops the value silently; the sale is
  never quarantined. The date is lost only in this inverted order, which the publish order forbids (rounds 4 and 5 ship together; server first).
- `kind` on a list entry: an old server ignores it (`syncApplyListEntry` copies named fields only, 519-520): the account becomes a wallet
  until the laptop sets Kind. No `bad_kind`, no retry loop.
- A new buyer created at ✅ on a phone: `customer` entry before the `group` (ENTRY_KINDS 75; `syncPlanPush` 1352-1356), so the
  group's `customerId` resolves on the server.
- The mixed group from a phone: SALE first, PAYMENT second inside one `lock.run` → one outbox entry (app_ports.js:166-172); the
  OVERPAID check sees the SALE on the shadow before the PAYMENT (802-805): no flag, as run_sync already proves for the split
  (SPEC-round-4.md §12 "the split's three rows in one entry answered ok, not quarantined, with no OVERPAID flag").
- Undo of the one-write group: `undoGroup` mirrors every live row of the group, the PAYMENT included (905-930); `openCredits` sums the
  negative PAYMENT mirror into `paid[refGroupId]` (1130); the receipt lists the voided rows; the phone pushes the mirrors as one group.
  Identical to undoing a split today (run_lists "undoGroup nets every bucket to 0 and restores stock").
- `app_min_version` (core_sync.js:339-340) is not raised: nothing new is required of a phone.

### 4.4 Messages and Settings reach the laptop
`setupSheet` appends the new MSG keys to Messages (71-73) and the two Settings rows (67-68); phones receive both by hash (4.3).

---

## 5. App

### 5.1 Input modes (app_ui.js:68-78)
Add before the final `return null`:
```
if (state.kind === 'sale') {
  if (state.step === 'buyer' || state.step === 'name' || state.step === 'phone') return 'text';
  if (state.step === 'due_text') return 'date';
  return null;
}
```
Number steps are `await_number` (purpose `sale_step`) and already return `'number'` (70) with the auto-open keypad (758-760); the
preset buttons stay tappable under the closed keypad as on today's split amount screen (run_app.js:707-708 proves `split_bank` the same way).

### 5.2 The date field (`appInputBar`, 754-771)
New branch `mode === 'date'`: `appH('input', { type: 'date' })` + the `ui_btn_send` 'ပို့' button; sending the value (`yyyy-mm-dd`)
through `appSendText` (773-776); `parseDayText` accepts it (3.2). Title keys for the bar are not needed (the question text is the
card). One i18n key: none. On a browser without a date picker the input is a text field and `30.10.26` still parses.

### 5.3 Tour hook
`appRenderMsg` (646-694) sets `data-cb` = `b.callback_data` on every keyboard button it draws (682). `.kb button.hot` (app.css:97) is
then set by the simulator from outside the frame; no app behaviour changes.

### 5.4 Offline-safe boot (the simulator opened with the network off)
`bootApp` keeps today's `online` unless the caller gives one: `var online = opts.online || function () { … }` (app_ui.js:265), and
`appDoEnroll` asks `!APP.sync.online()` instead of `APP.win.navigator.onLine === false` (444). Why: `sync.call` answers
`{ok: false, error: 'offline', transportFailure: true}` to every request while `online()` is false (app_sync.js:90), and `online()`
trusts `navigator.onLine === false`; a srcdoc frame inside a file the owner opened without a connection could therefore neither enrol
nor sync against the in-page fake server, and the enrol button would say `ui_enroll_offline`. The frame passes
`online: function () { return true; }` (6.2); the real app passes nothing and behaves exactly as today (`createAppSync` already
takes `opts.online`, app_sync.js:79).

### 5.5 Nothing else changes
The sold card's `btn_undo`/`btn_receipt`/`btn_pay`/`btn_phone` render as plain rows; the stepper, scanner, enrol, sync, settings and the
measurement form are untouched. `app/dev/index.html` sets `world.settings.sale_flow = 'steps'` after `simSeedLists(world)` (134) so the
bench shows the guided sale; `tools/build_app.js` is unchanged (no new app file; `FILES` 55-58 stays).

---

## 6. Simulator v2

### 6.1 Shape
One self-contained page `poc/dist/pos-simulator.html` built by `poc/build_simulator.js` (D8). Panes: a **login** screen first
(👑 Owner = `SIM_USERS.owner`, 🧵 Seller shop 1 = `sister`, 🧵 Seller shop 2 = `brother`; page state `S.login`), then the stage:
left the **shop floor** (racks as today, sim_ui.js:95-127; clicking a tag = the camera reading the QR) and the **"what can I do"**
panel; centre the **device** chosen in a device bar (✈️ Telegram, 📱 App; the owner adds 💻 Laptop); right nothing (the laptop is a
device, not a permanent pane). Header: login name and a switch button, the clock controls (6.6), Reset. Voice (🎤, the 16 `PHRASES`,
the parser box) moves into one collapsed `<details>` under the Telegram phone (D7).

### 6.2 Devices
- ✈️ Telegram: today's phone pane (sim_ui.js:137-225) bound to `world.chats[SIM_USERS[S.login].id]`; START bar and input bar as today;
  `renderMsg` adds `data-cb` on buttons (the tour hook, 6.5).
- 📱 App: one `<iframe srcdoc>` per login, created on first open and kept (switching login hides it; its memory adapter keeps its
  data). The frame boots `bootApp({ apiUrl: 'fake://sim-server', botUsername: 'ShopTagBot', appName: 'SalesTag', version: 'sim' },
  { adapter: createMemoryAdapter(), transport: <Promise over parent.SIM.server.handle(api, body) after parent.SIM.latency ms>,
  online: function () { return true; }, noServiceWorker: true })` — the dev page's call (app/dev/index.html:138-150) with `parent.` in
  front and the `online` of 5.4 (the fake server is in the page, so "offline" never applies) — and reports `parent.SIM.frameReady(login, window, app)`.
  Enrolment, the honest way, is the first tour: Telegram menu → `btn_app` '📲 အက်ပ်' → the code message → type it into the frame's
  `#codeInput` and tap `ui_btn_enroll` 'ချိတ်ဆက်' (app_ui.js:440-464). A shortcut button "paste the code" fills the field from
  `server.mintEnrollCode(SIM_USERS[login], label).display` and calls the frame's `appDoEnroll()` (dev page 186-191).
  A frame is 390 × 780 (dev page). Scan in the frame = the floor click calling the frame's `appOpenTagId(id)` (app_ui.js:546-551): no jsQR.
- 💻 Laptop (owner only): the Sheet pane with tabs Dashboard, Lists (editable, 6.4), Ledger, Customers, Credits (Due and ⏰ by `overdue`),
  Deposits, Orders, Measurements (new: `world.measurements` rows, values as text), Errors, Family group; plus a toggle "app at laptop width":
  a second frame for the owner at 820 px (the form goes two-column from 700 px, app.css:193). D8's list has no Devices tab; the owner's
  📱 ဖုန်းများ in Telegram shows the phones (sim_sync.js:233-242).
- The stranger case ("Customer (not staff)" today, sim_ui.js:72-85) is a tour step, not a login.

### 6.3 One world, two routes
`world = simSeedLists(seedSimWorld(createSimWorld())); world.settings.sale_flow = 'steps'; server = createFakeServer(world);`
(dev page 133-135). Telegram writes through `world.ports`; the frames through `server.handle` into the same arrays
(sim_sync.js:13-59, 137-139). After every Telegram `update` event the page calls `frame.APP.sync.syncNow('sim')` on the open frames so a
phone follows at once (the dev page relies on a 2 s refresh); after a frame commit the server's `appendRows` already emits `ledger`
(sim_sync.js:137-139) and the Sheet redraws through the one listener (sim_ui.js:53-57). `world.listeners` also carries `devices`,
`quarantine`, `synclog` for the owner's views.

### 6.4 Editable Lists tab
New sim-only store method in poc/sim_ports.js: `setListRow(name, key, fields)`: finds the raw row by `listNormKey(name, key)`, assigns
`label | active | detail | kind | order | shop` as given (strings as the Sheet holds them, `active` boolean), emits `{type: 'lists'}`;
no-op on an unknown key. The tab draws inputs for Label (text), Active (checkbox), Detail (text) and Kind (select '', wallet, bank; pay_method
rows only); `change` → `setListRow`; the existing `listRowSig`/`markListChanges` flash (359-372) shows the edit landed (`kind` joins the
signature). "Add row" uses `addListOptionByLabel(world.ports, name, label, SIM_USERS.owner, { kind })` so a duplicate name is refused the
bot's way. Propagation needs nothing: the bot reads `store.listOptions` first (core_ledger.js:447-451); the frames pull `lists_json` when
the Settings hash changes (core_sync.js:908-921); the page triggers `syncNow('settings')` on the open frames after a `lists` event.

### 6.5 Tours
`SIM_TOURS` in sim_ui.js: `{ id, login, device, title: {en, my}, steps: [{ en, my, target(ctx) -> {kind, …}, done(evt, ctx) -> bool }] }`.
Targets: `{kind:'tag', id}` (floor), `{kind:'tg', cb | label}` (the Telegram keyboard: highlight `[data-cb="…"]`, the data found with
`world.sim.button(world.sim.lastBot(user), t(world.ports, key))` as every test does), `{kind:'tgtext'}` (the input bar),
`{kind:'app', cb | sel}` (inside the frame: `frame.contentWindow.document.querySelector('[data-cb="…"]')` gets `.hot`; same-origin srcdoc),
`{kind:'sheet', tab, sel}`, `{kind:'device', which}`, `{kind:'login', who}`. Progress is observed on `world.listeners` events (`update`
carries `evt.update.callback_query.data` / `message.text`, sim_ports.js:449-455), on each frame's `APP.phone.on('change')`, and on page
events (login, device, tab). The panel shows the current step in Burmese and English and a "skip" link; a tour ends with the Sheet row
or card it produced highlighted. Burmese step texts are built from the labels they point at (`t(world.ports, key)`) and a small
`SIM_TOUR_MSG` table of verbs taken from MSG: 'Tag ကို scan လုပ်ပါ' (`menu` :89), 'START နှိပ်ပါ' (`help` :90), '{button} နှိပ်ပါ'
(`menu`), '{thing} ရိုက်ပါ' (`ask_number` :79); anything beyond those is a draft for the owner (page copy, never shown to customers).
Tours (D8): sell step by step (cash full; a second run mixed + part + due date), restock, register a new piece by photo, return, expense,
receive a payment, take a deposit, custom order with voucher (Telegram) and measurements (the app form, 📏 on the app's menu),
reports and the 21:00 summary (clock → 21:00 → Post), enrol a phone, manage lists on the laptop (rename, retire, Kind, add), who may use it
(the stranger scans). Autopilot for headless screenshots: `?login=sister&device=app&tour=sell&latency=0` (dev page pattern, 156-184).

### 6.6 Clock
Buttons `⏩ +31 min`, `⏩ +1 day`, `🕘 21:00` set `world.nowOverride` (sim_ports.js:22; `bench()` does it, run_round4.js:49, 73); the fake
server and the frames read the same clock (sim_sync.js:21; `clock` on the phone learns the offset at sync). This makes the undo window,
an overdue credit, a passed DueDay and the summary demonstrable. "Post 21:00 summary" composes `buildDailySummary` + `server.summaryLines()`
as the dev page does (app/dev/index.html:208).

### 6.7 Files and build
`poc/build_simulator.js` FILES: `core_config, core_burmese, core_messages, core_ai_prompt, core_ledger, core_report, core_bot, core_sync,
core_orders` (the build_app order, tools/build_app.js:29-30), `sim_mock_ai, sim_ports, sim_seed, sim_sync, sim_ui`. The frame document is a
second string the builder makes: the `#app` shell of app/index.html:22-38 (ids unchanged: `appWireEvents` binds without null checks,
app_ui.js:316-333), the template's Google Fonts link (no woff2 inlining; offline falls back to the system Myanmar font as today), `app.css`
inlined in a `<style>`, the nine core files plus the seven app files in build_app order in one `<script>`, and the boot script of 6.2.
It is embedded as `var SIM_APP_SRCDOC = <JSON string>` with every `</script` inside the string written as `<\/script` (the inline rule,
build_simulator.js:21, applies to the outer page). `app/vendor/jsQR.js` is left out (app_scan.js tests `typeof jsQR` at runtime). Size:
today's 517 KB + core_sync/sim_sync (~110 KB) + the frame (688 KB bundle + 17 KB css) ≈ 1.35 MB: well under the 16 MB artifact limit
and still one file. The qrcodejs CDN tag stays for the racks. A new `poc/check_simulator.js` (Node) proves the build: the output exists,
contains every FILES banner and `SIM_APP_SRCDOC`, holds no raw `</script` inside the srcdoc string, is under 4 MB; browser checks are manual (7.7).

---

## 7. Tests

Rule (D9): no existing check is edited except the four named in 7.6; new checks fail without their feature. Labels come from `MSG`.

### 7.1 poc/run_round5.js (new; `bench()` copied from run_round4.js:47-137 with `world.settings.sale_flow = 'steps'` after `simSeedLists`; fixed BASE clock; the 64-byte watcher)
1. **Nothing before ✅**: scan S1-0002, tap `btn_sell_one`, `btn_no_name`, `btn_cash`, `btn_all`: `world.ledger.length` unchanged at every
   screen; `world.customers.length` unchanged; the card message was edited (same id) at every step; ✅ writes exactly one SALE row
   (qty −1, cash 18,000, method CASH, dueDay '', customerId '') and the card reads `sold_done` with buttons `[U, RC]` only (no CR/CU/PM/SX).
2. **The count step**: SKU card keeps `S|id|1` and `Q|id` (`appCardInfo`-shape); `Q|id` grid unchanged (၂..၉ as `S|id|N`); tapping ၃ opens
   the buyer screen with `draft.qty === 3`; UNIQUE S1-0005 goes from `btn_sold` straight to the buyer screen (no count screen).
3. **Changed price**: `btn_discount`, typed 15000 on SKU → `sale_ask_qty_price` with `SS|S1-0002|q|1..8`, ၂ → buyer; ✅ writes qty −2,
   unitPrice 15000, amount 30,000 (today's D path would have written one piece at once: `world.ledger.length` unchanged until ✅).
   On UNIQUE the typed price goes to the buyer screen at once.
4. **Buyer screen**: first button `btn_no_name`, four recent `'👤 ' + name`, `btn_new_customer`, then `[btn_back, btn_cancel]`; `btn_new_customer`
   edits to `ask_name`; typed 'ဒေါ်မြင့်' (exact) picks C-0001 with no new row; typed 'ဒေါ်မြ' (look-alike) shows `cust_pick` with `SS|…|b|C-0001`
   and `btn_create_named`; typed a stranger 'ဒေါ်စု' asks `ord_ask_phone` with `btn_skip` → `SS|…|ph|skip` (not Z); typed '09 777 123456' is
   stored normalised at ✅ only: `world.customers.length` grows by one at ✅, not before; the row has phone '09777123456'.
5. **Phone skip keeps the sale**: `SS|…|ph|skip` lands on `sale_ask_method`; `getState` is still a sale state (Z would have cleared it).
6. **How paid**: with the seed lists (CASH, KBZ, WAVE, BANK) the screen is `[btn_cash] [📱 KBZPay] [📱 WavePay] [🏧 ဘဏ်] [💵+🏦 ခွဲပေး] [➕] [back,cancel]`;
   `SS|…|m|bank` with one bank skips the account screen (BANK is a bank by name); with `setAccounts` adding `AYA` kind bank the account
   screen lists two `btn_bank` buttons; `setAccounts` with four wallets shows three and `btn_more`; `more` lists the wallets.
7. **Mixed**: `mix` → account screen (KBZ, WAVE, BANK) → KBZ → `split_ask_amount` with `btn_half`; typed 5000 of 18,000 → `sale_ask_full`;
   `btn_all` → summary line `sale_sum_mixed` with 'ငွေသား 13,000' and 'KBZPay 5,000'; ✅ writes two rows in one group in the order
   SALE (cash 13,000, method CASH, note 'split') then PAYMENT (5,000, KBZ, refGroupId = group); `saleGroupInfo.owed === 0`;
   `dayStats` CASH +13,000, KBZ +5,000; `receiptText` shows ' (ငွေသား 13,000 · KBZPay 5,000)'; `rewriteCheck` refuses with `complex`
   (two live rows, core_ledger.js:947, which comes before the PAYMENT rule at 953) so no corrective button could ever apply;
   `undoGroup` within 30 min nets every bucket to 0 and restores stock. Typed 18000 → `sale_bad_amount` with max 17,999, state kept.
8. **Part without a buyer**: `btn_no_name`, cash, `btn_credit` → the buyer screen WITHOUT `btn_no_name`; pick ဒေါ်ခင် → `credit_ask_paid`
   with `0`, half, `btn_other`; `0` → `sale_ask_due` with `[7 ရက်, 14 ရက်, 30 ရက်] [btn_due_type] [btn_due_unknown] [back, cancel]`;
   `14 ရက်` → summary shows `dlv_owed` and `sale_due_set` with `fmtDayMy(addDaysKey(today, 14))`; ✅ writes one SALE row with cash 0,
   customerId C-0002, dueDay = that key, note 'credit'; `openCredits` lists it with `dueDay` and `overdue === false`; the card offers
   `btn_pay` and (ဒေါ်ခင် holds 300,000) the `credit_use_deposit` question; `CD|g|yes` applies the deposit as today.
9. **Due typed and unknown**: `btn_due_type` → `ord_ask_due_text`; typed '32.13.26' → `ord_bad_date`, state kept; typed '30.12.26' →
   summary with that date; typed '2026-12-30' (the app's field) parses to the same key; `btn_due_unknown` → dueDay '' and `sale_due_none`.
10. **Overdue by DueDay**: a part sale due in 7 days; `tick(8 * 1440)` (bench's tick is in minutes): `openCredits(...).overdue === true` while `days < OVERDUE_DAYS`;
    `buildDailySummary` has `summary_due_overdue` naming ဒေါ်ခင် with the date and the seeded 500,000 credit (no dueDay, 30+ days) still
    under `summary_overdue`; a part sale with dueDay '' and 29 days is not overdue.
11. **Back**: from the summary back → due → paid → full → method → buyer → the item card (`cardText`, `cardKeyboard`, state null); from
    `due` back then forward again shows no stale `sale_due_set`; back from the account screen returns to how-paid; the back buttons of two
    successive screens tapped within 120 s move two screens (not deduped), while the SAME back button tapped twice moves one (the second
    carries a step the state has left); from the item card reached by back, `S|id|1` again within 120 s starts the flow once more
    (`S` is not dropped by the mutating-tap guard in `steps` mode: `world.ledger.length` unchanged, the card edited into the buyer screen);
    `SS|…|back|method` while the state is at `due` is ignored (text unchanged, no Errors row).
12. **Stale, double, expired**: tapping `SS|…|m|CASH` after the screen moved on changes nothing (no edit, no ledger row, no Errors row);
    a second `S|id|1` on the same card within 120 s (the app's double tap) neither writes nor edits and keeps the state (no identical
    edit: `card.edited` count unchanged); a tap on an OLDER guided screen of the same item (the ၂..၉ grid left behind after the card was
    tapped again) changes nothing (the `msgId` rule); two ✅ taps on the same message within 120 s write one group; ✅ after `tick(31)`
    (STATE_TTL) answers `expired` on the message and sends
    the item card as a new message, writing nothing; a tap on the sold card's old `SC` data (replayed) changes nothing; a scan of another tag
    mid-flow clears the state (`openTag`) and the old screen's buttons answer `expired` + card.
13. **Sold meanwhile**: UNIQUE S1-0005 reaches the summary on the sister's chat; on the same world the owner's chat sells it first
    (`sim.start(U.owner, 'S1-0005')`, then the owner's own guided flow to ✅, or `world.settings.sale_flow = 'quick'` for that one tap and
    back to `steps`); the sister's ✅ edits her message to `card_sold_out` with `card_buyer` and writes nothing (`world.ledger.length` unchanged).
14. **➕ inside the sale**: `LA|pm|SSA|S1-0002` on the how-paid screen asks `add_ask_pm`; typed 'AYA ဦးမောင်' → `sale_ask_kind` with
    `btn_kind_bank`/`btn_kind_wallet`; `bank` → one Lists row with `kind: 'bank'` and the flow continues at `sale_ask_full` with
    `draft.method === <key>`; `add_done` prefix on that message; the account appears behind 🏧 ဘဏ် on the next sale and not by name;
    typed an existing label → `add_exists`, no kind question, no second row; typed '5000' → asked again (`empty`).
15. **Menu survives, scan does not**: `M|today` mid-flow keeps the sale state (`dropAddState`); the screen's buttons still work afterwards.
16. **Quick switch**: `world.settings.sale_flow = 'quick'`: scan + `btn_sell_one` writes at once and the card has `afterSaleKeyboard`'s
    four rows exactly as run_round4 step 1 (:144-146); `'STEPS'`/`'Steps'`/missing all mean steps.
17. **Card plainness**: the ✅ card of a cash full sale with a buyer has `[U, RC]` + `phoneRow` and no `CR|`, `CU|`, `PM|`, `SX|`, `LA|`;
    the voice path (`sim.voice` 'ဒါ ၂ ထည် ရောင်းရတယ်' + `btn_yes`) still shows the corrective rows (D7).
18. **Texts**: every key of 3.6 is in MSG, non-empty; no `btn_*` of 3.6 contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ or starts with '🏦 ';
    the placeholders fill (`sale_sum_mixed`, `sale_bad_amount`, `sale_ask_due`); `CFG.LIST_COLS` has one `lists_note_*` each.
19. **64 bytes**: every callback the file emitted is ≤ 64 bytes and the longest `SS|`/`SC|` is ≤ 26; `no update of any world failed`.
20. **App-shape facts without the app**: `appInputModeFor` is not loaded here; instead the state shapes: at `buyer`/`name`/`phone` the state
    is `kind 'sale'`; at `qty`/`bank`/`paid` it is `await_number` with `purpose 'sale_step'` and a `saved.kind === 'sale'`.

### 7.2 poc/run_lists.js (appended steps; one named edit, 7.6)
- `newTx` has 27 keys with `dueDay: ''`; `commitSale({dueDay})` stores it; `commitSaleGroup` shapes: cash full (one row), one account
  (method = key), mixed (two rows, order, notes, refGroupId, `methodFor` CASH on the SALE), part (cash = paid − bankPart, dueDay only when
  owed > 0; a dueDay given with a full payment is dropped), clamping (paid > amount, bankPart > paid), `staffId` on both rows.
- `rewriteRows` keeps `dueDay` on the replacement for a method change, a customer attach and a note; the mirror has ''; `convertSaleToCredit`
  on a row with a dueDay keeps it; `splitSale` on a credit sale keeps it.
- `openCredits`: `dueDay`, `overdue` under the four cases of 2.1 (dueDay past, dueDay future with days ≥ 30, blank with days ≥ 30, blank young).
- `saleFlow` default/quick/case; `methodKind` (set wallet, set bank, blank → wallet, BANK → bank, a `kind` of 'Bank ' trimmed and lower-cased);
  `payMethodsByKind` with the seed and with a 13-byte key dropped as `payMethods` drops it; `listNormRow` without a kind has exactly the eight
  fields and with 'bank' has nine; `listRowToCompact` adds `t` only when set; `listsJsonFor` of the seeded lists is unchanged from round 4
  (byte-equal to the round-4 string); a row with kind round-trips through `lists_json`; `listUpsert` append carries kind, a later rec with
  a different kind on an existing key changes nothing (`dup`); `addListOptionByLabel(…, {kind:'bank'})` stores it; `parseDayText` ISO.

### 7.3 poc/run_sync.js (appended)
- A phone pushes a mixed guided group (SALE + PAYMENT with `dueDay`): `ok`, no OVERPAID flag, both rows on the server with `dueDay` and
  `seq`; the undo group of it: `ok`, every bucket nets to 0.
- `syncValidateTx`: `dueDay` '' ok, `'2026-12-30'` ok, `'30.12.26'` malformed, a number malformed; an absent field ok.
- An "old phone" row (no `dueDay`) is stored with ''; a pull to a fresh phone carries `dueDay` on the rows; `appendSynced` keeps it.
- A list entry with `kind: 'bank'` is applied and `lists_json` carries `t: 'bank'`; `kind: 'card'` is malformed; a server whose store ignores
  kind (the round-4 `sim_ports` shape stubbed) stores a wallet, no quarantine.
- `sale_flow` typed into `world.settings` after bootstrap reaches the phone at the next pull (hash change) and `saleFlow(phone.ports)` reads it.

### 7.4 poc/run_gas.js (appended; three named edits, 7.6)
- `setupSheet` on an empty spreadsheet: the Ledger tab has 27 columns and the header ends with `DueDay`; the `DueDay` column is '@';
  Settings has `sale_flow = steps` and `sale_due_presets = 7,14,30`; Messages has every key of 3.6; the Lists tab has nine columns, the
  ninth header `Kind` with its note and a `list` validation over `wallet, bank` from row 2 (a blank allowed); the Dashboard overdue cell is
  `=SUMIF(<Credits Overdue col>,TRUE,<Credits Owed col>)`.
- A version-4 spreadsheet (26 Ledger columns, 8 Lists columns, 13 Credits headers): `setupSheet` appends `DueDay` as column 27 and `Kind`
  as column 9 without moving a header; a second run changes nothing.
- The publish window: on a 26-column Ledger with no `DueDay` header, one Telegram `appendLedger` and one `gasSyncTabs.appendRows` succeed
  (the grid grew to 27; `getMaxColumns` called once per execution), the value sits in column 27, `ledgerRows().dueDay` is '' until
  `setupSheet` writes the header and the same value afterwards.
- `refreshViews` writes 15 Credits cells per row with `DueDay` text and a boolean `Overdue`; `gasStore.listOptions` carries `kind` for a row
  typed `bank` and no `kind` for a blank cell; `addListOption` with kind appends a row whose Kind cell is 'bank'; `gasListValues` on a
  9-header tab; `syncSettingsFor` over the real store still equals the round-4 compact rows for the seed (no `t`).

### 7.5 poc/run_app.js (appended)
- `appInputModeFor`: `{kind:'sale', step:'buyer'}` → 'text', `'name'`/`'phone'` → 'text', `'due_text'` → 'date', `'method'`/`'summary'` → null,
  `{kind:'await_number', purpose:'sale_step'}` → 'number'.
- On the real app store, offline, `sale_flow` steps (`world.settings.sale_flow = 'steps'` before enrol): scan, stepper `S|S1-0002|2`, `btn_no_name`,
  `mix` → KBZ → typed 5000 → `btn_all` → ✅: `store.ledger` gains two rows, ONE outbox `group` entry with SALE then PAYMENT, the receipt number
  on the SALE row only; `store.outbox` has no `customer` entry; the sync answers `ok` without flags.
- A new buyer typed on the phone: the outbox has a `customer` entry before the `group` (`syncPlanPush` order); after sync the server has the
  customer and the sale's `customerId` resolves.
- The guided state survives a restart over the same adapter mid-flow (the `sale_price` precedent, run_app.js:205-217) and the next tap continues.
- `appRenderMsg`, `bootApp` and `appDoEnroll` are not run (no DOM); the `data-cb` attribute and the offline boot are manual checks (7.7).
  One source check stands in for the latter (the way run_lists.js:932-938 reads a document): the text of `app/app_ui.js` contains
  `opts.online ||` and its `appDoEnroll` body does not contain `navigator.onLine` (a regex over the file, which fails if either line is lost).

### 7.6 Existing checks the spec names (the only edits allowed)
| Check | Why | Edit |
|---|---|---|
| poc/run_lists.js:703 `Object.keys(b.row).length === 26` | `newTx` now has `dueDay` | `=== 27` (the label keeps "equal in every field") |
| poc/run_gas.js:421-427 `defaultLists` builds 8-cell rows; :441 compares them to the seeded Lists tab | the tab has nine columns | push a ninth cell `''` in the three `rows.push` calls |
| poc/run_gas.js:456 `c.cols === 8` | the seed block is nine wide | `c.cols === 9` |
| poc/run_gas.js:463-464 `L.validations('list') === 2 * 999` | the `Kind` dropdown (4.1) is a third `list` validation from row 2 | `3 * 999`, and the label reads 'List, Shop and Kind are dropdowns from row 2 …' |
Everything else stays as it is (run_gas.js:1148 reads `CFG.LEDGER_COLS.length`, :439-440 and :466 read `CFG.LIST_COLS`, so they follow;
run_gas 16b taps only `M|acct`, `LA|pm|AC` and `LD|pm|<key>` (:1413-1434) and never sells, so setupSheet's `sale_flow = steps` row cannot
touch it; run_lists's one bot sale (:895) runs on a `seedSimWorld` world). With `seedSimWorld` setting `sale_flow: 'quick'` (T6): run_scenario.js (:60, :64, :66, :431-443, :750-755,
:757-771 and all 410 lines) is untouched and green; run_round4.js 1 (:144-148), every 2*, 3*, 9b/9c and 10 (:1965-1967 "nothing is asked before
the commit") green; run_app steps 6, 23, 25 and run_sync S1 green; run_lists.js:592 and run_gas.js:1094-1098 (compact `{k,l,a,o,s,d}`) green
because the seed has no kind (T7); run_gas.js:466 (one note per `CFG.LIST_COLS`) green once `lists_note_kind` exists; run_lists.js:918 the same.
Every suite still ends `0 failed`.

### 7.7 Manual browser checks (the step-4 builder lists them, the orchestrator runs them)
On `poc/dist/pos-simulator.html` opened from disk: login as Seller shop 1 → ✈️: a guided sale end to end with the tour highlighting each
next button; 📱: enrol through the Telegram code, then the same sale on the app with the keypad opening on the typed-amount step and the date
field on `due_text`; the Ledger tab shows the rows from both routes; Owner → 💻: edit a Label and a Kind on the Lists tab and see the next
how-paid screen (Telegram) and, after `syncNow`, the app follow; `⏩ +1 day` ×8 then `🕘 21:00` + Post: `summary_due_overdue` in the Family
group; the measurement form opens inside the frame at phone width and in two columns at laptop width; Reset returns to the login screen;
no console error. With the network OFF (airplane mode, the file opened from disk): the page loads (fonts fall back), the Telegram phone
works, and the 📱 frame still enrols through the code and syncs against the in-page server (5.4: no `ui_enroll_offline`, the chip reaches
`ui_sync_synced`). The buttons inside the frame carry `data-cb` and the tour's `.hot` outline lands on the right one. On `app/dev/index.html`:
the date field sends `yyyy-mm-dd` and the summary shows the day.

---

## 8. Build steps and file ownership

Nobody edits a file outside their step's list; a needed change elsewhere goes into the report. Checker = the commands the orchestrator
runs before the next step starts. Every changed `core_*.js` and `app_*.js` passes `npx acorn@8 --ecma5 <file>`; every new global name
is grepped across apps-script/, app/ and poc/ before it is added (`saleFlow, methodKind, payMethodsByKind, creditOverdue, commitSaleGroup,
saleStateOf, saleGuard, startGuidedSale, saleFromPrice, saleGo, saleNext, saleBack, saleCallback, saleText, saleNumber, saleSummaryText,
saleCommit, saleExpired, saleAccountResume, saleDuePresets, saleScreen*`, `gasLedgerWidth`, `setListRow`, `SIM_TOURS`, `SIM_TOUR_MSG`,
`SIM_APP_SRCDOC`).

1. **Model and columns** (first, alone): `core_config.js`, `core_burmese.js` (date helpers in), `core_orders.js` (date helpers out),
   `core_ledger.js`, `core_messages.js` (EVERY key of 3.6, so steps 2-4 only read it), `core_report.js`, `core_sync.js`, `gas_store.js`,
   `gas_sync.js`, `gas_setup.js`, `poc/sim_seed.js` (`sale_flow: 'quick'`), `poc/sim_ports.js` (`listOptions` kind, `setListRow`),
   `poc/run_lists.js` (append + :703), `poc/run_sync.js` (append), `poc/run_gas.js` (append + :421-427, :456), `poc/fake_gas.js` (no change
   expected; a newly needed member goes into both tables and the report, SPEC-round-4.md:872-873).
   Checker: `node poc/run_lists.js`, `run_sync.js`, `run_gas.js`, and, unchanged and green, `run_scenario.js`, `run_round4.js`, `run_app.js`;
   `node tools/bundle_gas.js`; acorn; the grep.
2. **Bot** (after 1): `core_bot.js`, `poc/run_round5.js` (new). `core_messages.js` only if a key was missed (additions only).
   Checker: `node poc/run_round5.js` 0 failed; run_scenario and run_round4 unchanged and green; the 64-byte watcher; acorn; `bundle_gas`.
3. **App** (after 2; may start in parallel with 2 on its own files, its checker runs once 2 has landed): `app/app_ui.js` (5.1-5.4:
   `appInputModeFor`, the date field, `data-cb`, `opts.online` in `bootApp`, `appDoEnroll`), `app/dev/index.html`, `poc/run_app.js` (append).
   Not `app/config.js`, not `tools/publish*.js` (D9); `tools/build_app.js` unchanged.
   Checker: `node poc/run_app.js`; `node tools/build_app.js` loads; acorn on app_ui.js; the dev-page checks of 7.7.
4. **Simulator v2** (after 3): `poc/sim_ui.js`, `poc/simulator.template.html`, `poc/build_simulator.js`, `poc/check_simulator.js` (new).
   `poc/sim_sync.js` only if a hook is missing (report it). Checker: `node poc/build_simulator.js`, `node poc/check_simulator.js`, the browser
   checks of 7.7, publish the artifact.
5. **Docs** (last, alone): `apps-script/README.md` (DueDay, Kind, sale_flow, the publish order), `app/README.md` (the guided sale on the phone,
   the date field), `docs/USER-GUIDE.html`, `POS-PROJECT-PLAN.md` Appendix F.
Deployment order for the README: publish the server, run `setupSheet` once, publish the app (SPEC-round-4.md:942-943); rounds 4 and 5 together.

---

## 9. Not built (and why)

- Voice inside the guided sale beyond a spoken number at a number step (D7); a spoken buyer name mid-flow falls to today's paths.
- A merged "full or part" into the summary (would save one tap on the common sale; the owner asked for the step).
- Editing one answer from the summary (only back); a draft that survives a scan of another tag (a scan always starts over, as today).
- An app date picker beyond `<input type="date">`; a `sale_flow` toggle on the app's Settings screen (the per-device pref exists, 2.4).
- DueDay on PAYMENT rows or reminders sent to customers; a due date on the pay list buttons (`creditButtons`, core_bot.js:1684-1685).
- Owner approval of buyers created by sellers; merging look-alike customers.
- Renaming a Key, reordering or deleting rows in the simulator's Lists tab (Label, Active, Detail, Kind, add only).
- A Telegram Desktop pane for the laptop (typing a tag id in the Telegram phone stands in, as today), a Devices/SyncLog tab, photos in the
  in-page app (the fake server's thumb hook returns strings the app ignores, sim_sync.js:191-194).
- Automated ES5 and invisible-character scans (still the orchestrator's conventions, map-glue L).

### Where this design refines a decision, and why
- D1: back reuses `btn_back` '⏮ နောက်ပြန်' (T4); the six-answer rule counts choices, so the digit grids stay (1.1).
- D2: the count step is the unchanged card and grid (T2); the changed price's count screen exists only on SKU after a typed price (1.2);
  the phone of a new buyer is asked inside the flow but skipped with its own callback (1.4).
- D4: `overdue` is decided once in `openCredits` and written to the Credits view, so the Sheet formula, the summary and the simulator cannot
  disagree (2.1-2.2).
- D6: a blank Kind is a wallet except the legacy `BANK` key (2.3), and the kind question is asked only for a NEW name typed inside the sale
  (an existing label needs no kind); the field is absent when blank so no phone's `lists_json` changes at publish.
- D8: the laptop is a device of the owner login, not a permanent pane; the app runs in iframes (T10).
