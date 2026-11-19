# design-owner.md — round 5, the owner-first design: the books, the laptop, the simulator as the owner's judgement tool

Designer's report for the round-5 spec (2026-11-11). Angle: what each outcome of the guided sale writes into
the books, how the Credits view, the 21:00 summary, receipts and reports read it, the Lists tab with its new
`Kind`, the Customers tab, the `sale_flow` switch, the exact migration, and simulator v2 as the page the owner
judges the product with. Every claim about today's code cites `file:line` of the tree as it stands after round
4 (built, unpublished). Burmese labels are copied from `MSG` (apps-script/core_messages.js) and `APP_MSG`
(app/app_i18n.js); every NEW string is marked **draft** and built only from fragments that already exist in
MSG (the source key is named), for a native speaker to rewrite, as round 4 did (SPEC-round-4.md:99).

## 0. Top decisions (the ten the orchestrator should weigh first)

1. **The item card is the count screen; nothing else changes on it.** In `steps` mode the card keeps today's
   keyboard (`cardKeyboard`, core_bot.js:207-230): `✅ ရောင်း ၁` = count 1, `🔢 အရေအတွက်` = the 2..9 grid or a typed
   count, `💬 စျေးလျှော့` = the changed price. Only the `S|id|N` handler changes: in `quick` it commits as today
   (core_bot.js:444-451); in `steps` it starts the guided flow with the count already known. So the card, the
   grid (`askQty` 246-255), the app's stepper (`appCardInfo` keys on `S|<id>|1`, app_ui.js:37-46) and every
   existing card check stay as they are, and D2's "💬 as a secondary row on the count screen" is already true.
2. **One state object, short callbacks, no token.** The whole draft rides in `st:<uid>` (`{kind, step, draft, path}`),
   the way the expense flow carries `draft{shop,cat,amount}` (core_bot.js:1812-1884). Callbacks are `GS|<step>|<arg>`
   (never above 20 bytes); the one committing tap is `GSK|ok` and joins `MUTATING_ACTIONS`. A back row
   `[⏮ နောက်ပြန် = GS|back, ✖️ မလုပ်တော့ = Z]` sits under every screen; `btn_back` '⏮ နောက်ပြန်' already exists
   (core_messages.js:335) and does not collide with `btn_undo` '↩️ မှားသွားတယ်' (:27). Back pops `state.path`.
3. **Typed answers use today's `await_text` / `await_number` kinds**, with the draft inside the state and a
   `sale_*` purpose. The app therefore shows its text bar or keypad with no change to `appInputModeFor`
   (app_ui.js:68-78: `await_number` → keypad, `await_text` → text bar). The buyer screen is `await_text`
   (`sale_buyer`): buttons for recent customers plus typing a name or a phone number.
4. **One write: `commitSaleGroup` (core_ledger.js, new).** Builds `[SALE]` or `[SALE, PAYMENT]` in one group
   under one `ports.lock.run`, in `splitSale`'s shape (core_ledger.js:1039-1045: SALE cash part method CASH note
   'split', PAYMENT account part refGroupId = group note 'split'), SALE first (the server checks a PAYMENT against
   owed on the shadow ledger, core_sync.js:802-805). The buyer typed mid-flow is created at this moment, not
   before (the order flow's "customer row before the order exists", core_bot.js:2390/2408, is NOT copied).
5. **`DueDay` is the 27th Ledger column, always present on the row object** (`newTx` gets `dueDay: f.dueDay || ''`),
   so the spec names ONE existing check to change: run_lists.js:703 (`=== 26` → `=== CFG.LEDGER_COLS.length`).
   setupSheet grows the Ledger grid first (`gasEnsureWidth`, the Measurements precedent gas_setup.js:118-125),
   and BOTH Ledger writers grow it too, so a sale written between "publish" and "run setupSheet" never fails.
6. **Overdue is decided once, in `openCredits`**: `overdue = dueDay ? today > dueDay : days >= OVERDUE_DAYS`.
   The Credits view gains `DueDay` and `Overdue` columns (the tab is rewritten whole by `refreshViews`,
   gas_store.js:681-687, so no `ensureColumns` is needed), the Dashboard's overdue cell sums
   `Credits!Overdue = TRUE` instead of `Days >= 30` (gas_setup.js:405-406), the 21:00 summary, the three
   reports and the simulator's ⏰ all read the same flag. Undated credits behave exactly as today.
7. **`Kind` is an optional field on a normalised list row** (`listNormRow` adds `kind` only when the cell holds
   `wallet` or `bank`; the compact row adds `n` only then), read through one helper `listKind(row)` that
   treats a blank as `wallet` and the legacy key `BANK` (`method_BANK` 'ဘဏ်လွှဲ', core_messages.js:130) as `bank`.
   Rows without a kind keep today's exact shapes, so run_lists.js:592/:869/:1003 and run_gas.js:1094-1098 stay
   green; only the Lists seed width checks (run_gas.js:421-428 `defaultLists`, :456 `cols === 8`) are named.
8. **➕ on the how-paid screen asks the kind BEFORE writing the row** (name typed → two kind buttons → one
   append with `kind`), so no `set kind` op is needed in `listUpsert`/`gasListsPersist`; a Kind is otherwise a
   laptop cell edit (D6). `addListOptionByLabel` gets an optional fifth argument `{kind}`.
9. **`sale_flow` defaults to `steps` in code and in the setupSheet Settings row; `seedSimWorld` sets `quick`.**
   Every existing suite, the current simulator and the dev page seed through `seedSimWorld`
   (sim_seed.js:67-74), so they keep today's one-tap sale unchanged; `poc/run_round5.js` and simulator v2 set
   `steps` themselves. The owner flips the Settings row on the laptop; phones get it at their next pull
   (`syncSettingsFor` copies every Settings key, core_sync.js:915-929).
10. **Simulator v2 keeps `poc/sim_ui.js` as the page and `poc/build_simulator.js` as the build**, grows the FILES
    list to the dev page's set (dev/index.html:109-129) plus a new `poc/sim_tours.js`, and hosts the real app in
    `<iframe srcdoc>` per device (one `APP` per document, app_ui.js:16; app.css redefines the template's classes).
    The laptop pane edits Lists through a sim-only `store.setListRow` that emits `lists`, and the page gets a
    clock control so overdue, undo window and the 21:00 summary can be shown.

### Refinements to the brief (D1-D9), each with its reason

- **D1 "at most six answer buttons"**: kept for every fixed screen. The how-paid screen lists every active
  wallet of the shop by name (the family has two to four accounts); more than four wallets wrap two per row as
  `methodRows` does today (core_bot.js:318-322) rather than hiding accounts. Keeping the list short is the
  laptop's job (Active), as round 4 decided.
- **D1 "↩️ back"**: the glyph is `⏮` (`btn_back`, core_messages.js:335), because `↩️` is `btn_undo` on the sold
  card that follows the summary.
- **D2 "count (skipped for a one-of-a-kind piece)"**: the count is answered ON the card (`✅ ရောင်း ၁`, the grid,
  the stepper), so no separate count screen exists in either mode; UNIQUE cards have no count button at all
  (core_bot.js:215-219). The typed changed price (`D|id`) keeps today's rule "one piece at that price"
  (core_bot.js:713-721); a count-plus-price combination stays unbuilt (section 9).
- **D2 "buyer ... a new name may be followed by an optional phone with a skip"**: the skip is `GS|ph|skip`, never
  `Z`, because `Z` cancels the whole flow (core_bot.js:530-533; the existing phone prompt's skip IS `Z`, :1527).
- **D2 "which bank account (only after 🏦 bank transfer, and only when more than one)"**: the 🏦 button itself
  appears only when the shop has at least one bank-kind account; with none, ➕ on the same screen adds one
  (and asks the kind). The generic legacy `BANK` row counts as a bank (decision 7), so a sheet seeded by
  setupSheet shows `💵 ငွေသား · 📲 KBZPay · 📲 WavePay · 🏦 ဘဏ် · 💵+🏦 ခွဲပေး` from day one.
- **D2 "Mixed asks for the transfer part after the account"**: kept; the account list for mixed holds every
  non-cash account (wallets by name, banks with 🏦) because a mixed payment may be cash + KBZPay. Then
  full-or-part applies to the whole payment; a part amount must be at least the transfer part.
- **D3 "the corrective buttons ... are no longer needed on the summary card"**: the sold card after a guided
  sale carries `↩️ မှားသွားတယ်`, `🧾 ဘောက်ချာ`, `💰 ငွေလက်ခံ` while owed, and the `🔢 နံပါတ် ထည့်` hint row when an
  account was created inside the sale (the hint cannot sit mid-flow: `askListDetail` replaces the state,
  core_bot.js:1310). `afterSaleKeyboard` is untouched for `quick`, voice, orders and tests.
- **D4**: unchanged, plus the Credits `Overdue` column so the Sheet formula and the core agree (decision 6).
- **D5**: unchanged; the seed carries `quick` (decision 9), which is the only way the untouched run_scenario
  stays green (map-glue CONSTRAINTS).
- **D6 "➕ ... asks the kind with two buttons after the name"**: kept in that order for the seller; internally
  the row is written once, after the kind (decision 8).
- **D7**: voice is untouched; the four lines that let a spoken answer land inside a guided step are listed in
  3.1 so a voice note mid-flow never writes a sale behind the seller's back.
- **D8**: unchanged; section 6 gives the files. The "Customer (not staff)" login of today becomes a tour step.
- **D9**: respected; the checks the spec names are listed in 7.5 (three lines in two files).

---

## 1. Screens

### 1.1 Entry and the count (both modes)

| Entry | Today | `steps` |
|---|---|---|
| Scan `/start S1-0042`, typed id, `K\|id` | `openTag` → `sendItemCard` (core_bot.js:101-125, 232-239), state cleared | same (a scan still abandons any open flow: nothing was written, D3) |
| `✅ ရောင်း ၁` / `✅ ရောင်းပြီး` = `S\|id\|1`, grid `၂..၉` = `S\|id\|N`, app stepper `S\|id\|N` | `commitSale` + edit to `soldText` + `afterSaleKeyboard` (444-451) | `saleStart(chatId, msgId, isCaption, uid, item, {qty: clampQty(arg)}, staff, ports)`: the card is EDITED into the first question (it is not a committed card, so the rule of core_bot.js:33-34 is kept) |
| `✏️ ရိုက်မယ်` = `QN\|id` → typed count (`sale_qty`, 453-456, 722-734) | new sold card | `saleStart` with `qty: n`, as a NEW message (`editOrSend` with msgId null); `bad_qty` unchanged |
| `💬 စျေးလျှော့` / `💬 စျေးပြောပြီး ရောင်း` = `D\|id` → typed price (`sale_price`, 457-460, 713-721) | one piece at price n, new sold card | `saleStart` with `qty: 1, unitPrice: n, note: 'spoken price'`, a new message |
| voice / notebook confirm `Y\|tok` (1012-1031) | `commitSale` with paid/customer | unchanged in both modes (D7) |
| enrolled phone in Telegram (`sendAppCard` 3406-3412) | card + url button | unchanged |

`saleFlow(ports)` (core_config.js, next to `settingOn` :190-193): `String(ports.store.getSetting('sale_flow', 'steps')).trim().toLowerCase() === 'quick' ? 'quick' : 'steps'`.

### 1.2 The guided screens, in order

Every screen: one question, the answers, then the back row `[⏮ နောက်ပြန် (btn_back) = GS|back, ✖️ မလုပ်တော့ (btn_cancel) = Z]`.
A header line names the sale on every screen: `confirm_sale` '📝 ရောင်း {qty} ထည် · {name} · {amount} ကျပ်' (core_messages.js:61) so
the seller never loses the context. Screens are edited in place (`editOrSend`, core_bot.js:380-383); a typed answer sends a new message.
`→` = the next screen after the skip rules of 3.1.

| # | Step (`state.step`) | State kind | Text (MSG key, Burmese) | Answer buttons → callback | Typed / spoken | Skipped when | Back goes to |
|---|---|---|---|---|---|---|---|
| 1 | `buyer` | `await_text`, purpose `sale_buyer` | `credit_ask_customer` '👤 ဝယ်သူ ဘယ်သူလဲ?' (:98) + second line `cust_find` '🔍 နာမည် ဒါမှမဟုတ် ဖုန်းနံပါတ် ရိုက်ပါ' (:150) | row 1 `btn_no_name` (**draft** '🚫 နာမည် မရှိ', from `btn_design_none` :226 + `ask_name` :80) → `GS\|b\|none` — hidden when `draft.needBuyer`; then up to four `recentCustomers(ports, staff.shop, 4)` (core_ledger.js:1297) as `customerLabel(c)` (core_bot.js:1474) → `GS\|b\|<custId>` | a name or a phone: `matchCustomers` (core_ledger.js:1370) exact → chosen; phone digits (4+, no letters) → `findCustomers` exact phone → chosen, no match → the same question again (digits alone are never a name); look-alikes → `cust_pick` '👤 "{name}" · ဘယ်သူလဲ?' (:143) with `customerLabel` → `GS\|b\|<id>` and `btn_create_named` '✏️ "{name}" အသစ် ဖန်တီး' (:144) → `GS\|b\|create`; nobody → `draft.newName = name` (NOT created) → step 2 | never (D2: the buyer is the first question) | the item card (`sendItemCard` as an edit, state cleared) |
| 2 | `phone` | `await_text`, purpose `sale_phone` | `ord_ask_phone` '📞 {customer} ၏ ဖုန်းနံပါတ် ရိုက်ပါ (မရှိရင် ကျော်ပါ)' (:219) | `btn_skip` '⏭ ကျော်' (:30) → `GS\|ph\|skip` | `normPhone`/`isValidPhone` (core_ledger.js:1320-1327): valid → `draft.newPhone = normPhone(text)`; anything else with 7+ digits kept as typed (the `savePhone` rule, core_bot.js:1536); fewer digits → the same question again | `draft.newName` is empty (an existing customer, or no name) | 1 |
| 3 | `method` | `sale` | `sale_ask_method` (**draft** '💰 {amount} ကျပ် · ဘယ်လိုပေးလဲ?', from `dlv_ask_method` :304) | `btn_cash` '💵 ငွေသား' (:132) → `GS\|m\|CASH`; one `btn_wallet` (**draft** '📲 {method}', glyph of `btn_app` :184) per wallet key of `payMethodsByKind(ports, shop).wallets` → `GS\|m\|<KEY>`; `btn_bank_transfer` (**draft** '🏦 ဘဏ်', from `summary_cash` :205) → `GS\|mb` when `.banks.length > 0`; `btn_split` '💵+🏦 ခွဲပေး' (:376) → `GS\|mx` when any non-cash key exists; last row `btn_add_bank` '➕ ဘဏ်အသစ်' (:385) → `LA\|pm\|GS` | — (a voice note with a method word: section 3.1) | never | 1 or 2 |
| 4 | `account` | `sale` | `sale_ask_account` (**draft** '🏛 ဘယ်အကောင့်လဲ?', from `split_ask_bank` :377 + the `btn_accounts` glyph :395) | after `GS\|mb`: one `btn_bank` '🏦 {method}' (:131) per bank key → `GS\|a\|<KEY>`; after `GS\|mx`: every non-cash key, wallets as `btn_wallet`, banks as `btn_bank` → `GS\|a\|<KEY>`; layout as `methodRows` (one row ≤ 3 short labels, else two per row, core_bot.js:318-322) | — | exactly one candidate (chosen silently, as `startSplit` does, core_bot.js:1169) | 3 |
| 5 | `bank` (mixed only) | `sale`; `GS\|bp\|other` → `await_number`, purpose `sale_bank` | `split_ask_amount` '💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ? ဂဏန်း ရိုက်ပါ (ပေးငွေ {cash} · ကျန်တာ ငွေသား)' (:378) with cash = amount | `btn_half` 'တစ်ဝက် {amount}' (:254) → `GS\|bp\|half`; `btn_other` '✏️ အခြား' (:31) → `GS\|bp\|other` (then `ask_number` :79, keypad in the app) | a number 1..amount-1 → `draft.bankPart`; outside → `sale_bad_amount` (**draft** '❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ', from `split_bad` :382) and the state kept | method is not mixed | 4 (or 3 when 4 was skipped) |
| 6 | `paid` | `sale` | `sale_ask_paid` (**draft** '💰 {amount} ကျပ် · အကုန် ပေးပြီးလား?', from `btn_all` :44, `receipt_total` :122, the `လား` of `credit_use_deposit` :100) | `btn_paid_full` (**draft** '✅ အကုန် ပေးပြီး') → `GS\|f\|full`; `btn_credit` '💳 မကျေသေး' (:41) → `GS\|f\|part` | — | never | 3, 4 or 5 |
| 7 | `part` | `sale`; `GS\|p\|other` → `await_number`, purpose `sale_part` | `credit_ask_paid` '💳 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)' (:97) | `0` → `GS\|p\|0` (replaced by `fmtMoney(bankPart)` → `GS\|p\|<bankPart>` when mixed), `fmtMoney(round(amount/2))` → `GS\|p\|<half>` (only while > bankPart), `btn_other` → `GS\|p\|other` (`ask_number`) | a number `bankPart..amount-1` → `draft.paidNow`; outside → `sale_bad_amount` with min = bankPart | `GS\|f\|full` | 6 |
| 7b | `buyer` again, `draft.needBuyer = true` | as 1 | as 1 | as 1 without `btn_no_name` (D2: a part payment needs a buyer) | as 1 | a buyer is already in the draft | 7 |
| 8 | `due` | `sale`; `GS\|d\|type` → `await_text`, purpose `sale_due` | `sale_ask_due` (**draft** '📅 ကျန်ငွေ {owed} · ဘယ်တော့ ပေးလဲ?', from `ping_overpaid` core_sync.js:124, `ord_ask_due` :236, `pay_ask_amount` :104) | `btn_days` '{n} ရက်' (:238) for each `duePresets(ports)` (7, 14, 21, 30; Settings `due_presets`) → `GS\|d\|<n>`; `btn_due_type` '✏️ ရက်စွဲ ရိုက်' (:240) → `GS\|d\|type` (then `ord_ask_due_text` '✏️ ရက်စွဲ ရိုက်ပါ (ဥပမာ 30.10.26)' :251); `btn_skip` '⏭ ကျော်' → `GS\|d\|none` ("not sure") | `parseDayText(text, now)` (dd.mm.yy, dd/mm, Burmese digits); a date in the past or unreadable → `ord_bad_date` (:252), state kept | owed = 0 | 7 or 7b |
| 9 | `summary` | `sale` | lines: `confirm_sale`; `card_buyer` '👤 {customer} · ပေးပြီး {paid} · {method}' (:156) when a buyer or a method other than cash, else `method_CASH` line omitted; `sale_owed_line` (**draft** '💳 ကျန် {owed} ကျပ်', from `dlv_owed` :306) when owed > 0; `sale_due_line` (**draft** '📅 ကျန် {owed} · {date}', from `receipt_total` :122 + `ord_due_set` glyph :237) when a due day; then `confirm_ask` 'မှန်ပါသလား?' (:69) | `btn_yes` '✅ မှန်တယ်' (:28) → `GSK\|ok` | — | never | the last screen shown |

How a method shows on the summary and the sold card: `methodLabel(ports, key)` (core_ledger.js:180-187); mixed shows
`methodLabel(CASH) + ' ' + fmtMoney(cash) + ' · ' + methodLabel(account) + ' ' + fmtMoney(bank)`, the `receiptMethodText` form (core_report.js:355).

### 1.3 The sold card (after `GSK|ok`)

The summary message is edited into the sold card (`markCommittedCard`, core_bot.js:1401-1403):
1. `soldText(ports, fresh, qty, r)` (core_bot.js:241-243; `r.txs[0]` is the SALE row);
2. buyer + money: `credit_done` '💳 👤 {customer} · ပေးပြီး {paid} · ကျန် {owed} ကျပ်' (:99) when owed > 0; `cust_attached`
   '👤 ဝယ်သူ {customer} · မှတ်ပြီး' (:142) when paid in full with a buyer;
3. method: `method_done` '🏦 {method} နဲ့ ပေးတယ်လို့ မှတ်ပြီး' (:133) for one non-cash account; `split_done`
   '💵 {cashMethod} {cash} · 🏦 {method} {bank} · မှတ်ပြီး' (:379) for mixed; nothing for cash;
4. `sale_due_line` when a due day was kept;
5. `acct_detail_hint` 'ℹ️ {label} ရဲ့ နံပါတ် ထည့်ထားရင် ...' (:403) when an account was created inside this sale.

Keyboard `saleDoneKeyboard(ports, groupId, draft)`: `[btn_undo → U|g, btn_receipt → RC|g]`; `[btn_pay → PY|g]` while
`saleGroupInfo(...).owed > 0` (core_ledger.js:1064-1086); `[btn_acct_number '🔢 နံပါတ် ထည့်' → LD|pm|<KEY>]` when `draft.addedKey`.
`setLastItem`, `setLastGroup` as today (core_bot.js:448-449). Undo (`U|g`, `undoGroup` core_ledger.js:905-930) mirrors
every live row of the group, PAYMENT included; the receipt (`RC|g`) prints the mixed methods and `receipt_transfer`
while owed (core_report.js:322-369) and, new, the `sale_due_line` under the total when the SALE row carries a DueDay.

### 1.4 ➕ inside the how-paid screen (D6)

`LA|pm|GS` → `askAddOption` (core_bot.js:1373-1395) with the new resume code `GS` in `ADD_RESUME_LIST` (:1334-1335); the
how-paid screen is edited into `add_ask_pm` '✏️ ဘဏ်/အကောင့် နာမည် ရိုက်ပါ (ဥပမာ KBZ ဦးမောင်)' (:388) and the sale state is kept in
`saved` (:1390-1391; `/start` and `M|*` restore it, `dropAddState` :2175-2180). The typed name reaches `finishAddOption`
(:1417), which for `GS` branches BEFORE `addListOptionByLabel`:
- a name an option already has (`listNameKey` match, the rule of core_ledger.js:720-721) → `add_exists` 'ℹ️ "{label}" ရှိပြီးသား · အဲဒါကို သုံးပါမယ်' (:392)
  as prefix, the sale state restored, the account chosen (`draft.method = KEY` for a wallet, `draft.method = 'BANK'`, `draft.account = KEY` for a bank) → step 6;
- a new name → state `{kind:'sale', step:'kind', draft, path, pendingLabel}` and the screen `add_ask_kind` (**draft** '➕ "{label}" · ဘယ်လို အကောင့်လဲ?',
  from `add_done` :391, `exp_ask_method` :164, `btn_accounts` :395) with `btn_kind_wallet` (**draft** '📲 Pay အကောင့်', from `lists_note_list` :415) → `GS|k|wallet`
  and `btn_kind_bank` (**draft** '🏛 ဘဏ်အကောင့်', from `acct_title` :396) → `GS|k|bank`, plus the back row;
- `GS|k|<kind>` → `addListOptionByLabel(ports, 'pay_method', pendingLabel, staff, {kind})` → prefix `add_done` '➕ "{label}" ထည့်ပြီး' (:391),
  `draft.addedKey = key`, the account chosen as above → step 6. Nothing but the Lists row is written here; the sale is still unwritten.
A digits-only or amount-like name is refused as today (`listLooksLikeAmount`, core_ledger.js:691-706; `add_ask_pm` again).
The other ➕ resumes (PM, EM, SXM, ODM, OXM, AC) keep creating without a kind (= wallet), unchanged.

### 1.5 The owner's screens

**The laptop (the Sheet).**
- Lists tab: a ninth column `Kind` after `Note`, header note `lists_note_kind` (**draft** 'wallet = Pay အကောင့် (KBZPay, WavePay) · bank = ဘဏ်အကောင့် · ကွက်လပ်ထားရင် wallet',
  from `lists_note_list` :415 and `lists_note_shop` :420), a dropdown `wallet | bank` from row 2 (a blank stays allowed, the Shop-dropdown pattern gas_setup.js:189-191).
  The seed writes a blank Kind on every row; `listKind` reads the legacy `BANK` as a bank (decision 7).
- Ledger tab: a 27th column `DueDay` (text, like Day; `textColumn`), blank on every row but the SALE row of a part-paid or unpaid guided sale.
- Credits tab: `DueDay` and `Overdue` after `Days`; the Dashboard cell `Overdue (>30d)` becomes `Overdue` = `SUMIF(Credits!Overdue, TRUE, Credits!Owed)`.
- Customers tab: unchanged columns; the phone a buyer gave in the flow lands in `Phone`; the owner types missing phones here; phones reach the app phones
  at the daily full-masters pull (`fullMasters`, core_sync.js:990-992; app_sync.js:256) or at once if gas_main's `onEdit` learns to bump `Rev` on the Customers tab (section 9).
- Settings tab: a new row `sale_flow` = `steps` (seeded by setupSheet); typing `quick` restores today's one-tap card for every device at its next pull; the row carries the note text of section 3.5.

**The 21:00 summary** (`buildDailySummary`, core_ledger.js:1516-1571): the undated overdue line stays bit-identical (`summary_overdue` '⏰ {days} ရက်ကျော် အကြွေး: {list}', :208,
over credits with a blank DueDay and `days >= OVERDUE_DAYS`); a second line `summary_due_overdue` (**draft** '⏰ ရက်လွန် အကြွေး: {list}', from `summary_orders_overdue` :369) lists the
dated credits past their day as `{customer} {owed} ({date} · {n} ရက် လွန်)` (the `orderSummaryLines` form, core_orders.js:486-488), five names, oldest first.

**Receipts** (`buildReceipt`/`receiptText`, core_report.js:322-369): `r.dueDay` from `saleGroupInfo(...).dueDay`; `sale_due_line` printed after `receipt_total` while owed and dated.

**Reports** (core_report.js): the three credit tables (month report :219-221, customer statement :271-273, owed report :306-310) gain one column after `ရက်`: header
`ကျန်ငွေ ရက်` (**draft**, from `ping_overpaid` + the existing `ရက်`), value `fmtDayShortMy(dueDay)` or '' — and an `⏰` prefix on it when `overdue`.

**The simulator's laptop pane** mirrors all of this (section 6).

### 1.6 Refusals, stale taps, cancel, expiry

- A `GS|*` tap whose state is missing or at another step edits the tapped screen to `expired` '⏱ သက်တမ်းကုန်သွားပါပြီ။ ထပ်ပြောပေးပါ။' (:71), the `expenseState` guard (core_bot.js:1838-1845).
  `GS|back` works from any step of a live sale state. `GSK|ok` without a live state writes nothing and says `expired` (a second tap after the commit).
- `Z` on any screen: `clearState` and `cancelled` '✖️ ပယ်ဖျက်ပြီးပါပြီ။' (:86), as today (core_bot.js:530-533). Nothing was written.
- The whole flow lives `CFG.STATE_TTL_SEC` (1800 s, core_config.js:11); the ➕ prompt inside it `ADD_STATE_TTL_SEC` (600 s).
- A scan, a typed tag id or a voucher id abandons the flow (`openTag` clears the state, core_bot.js:122). The menu (`M|*`) and `/start` keep it (`dropAddState` only touches ➕ and 🔢 prompts).
- Validation before the write: the item still exists (`tag_not_found` :8 otherwise); `paidNow` is clamped to 0..amount and `bankPart` to 0..paidNow by `commitSaleGroup` (defensive; the screens already refuse).
- Stock is derived, never checked, as today (gas_setup.js:315-316; app_store.js:306; `SYNC.FLAG.STOCK_NEGATIVE` only flags, core_sync.js:798-800).

---

## 2. Data model

### 2.1 The Ledger: what each outcome writes (one group, one lock, one outbox entry on a phone)

All rows: `shop = item.shop`, `itemId`, `qty = -count` on the SALE, `unitPrice`, `amount = count × unitPrice`, `costAtSale = item.cost`, `staffId`, `source BUTTON`
(`TEXT` when the count or price was typed, as `applyAwaitedNumber` passes it today), `updateId`, `customerId` = the buyer or ''. `dueDay` on the SALE row only.

| Outcome | Rows | Cash | Method | Note | DueDay | Readers that already understand it |
|---|---|---|---|---|---|---|
| Cash, paid in full, no buyer | SALE | amount | CASH | '' | '' | identical to today's `commitSale` row (core_ledger.js:755-768) |
| Wallet or bank, full | SALE | amount | KEY | '' | '' | today's PM rewrite result, without the mirror pair (`changeMethod` core_bot.js:1084-1099) |
| Any single method, part now (deposit) | SALE | paidNow (0 allowed) | `methodFor(KEY, cash)`: '' when cash 0 | '' | chosen day or '' | today's `convertSaleToCredit` result (core_ledger.js:1053-1059); `openCredits` finds it (:1122-1169) |
| Mixed, full (cash part > 0 and bank part > 0) | SALE then PAYMENT | SALE cash = amount − bank, method CASH; PAYMENT amount = cash = bank, method KEY, `refGroupId` = group | 'split' on both | '' | `splitSale`'s shape (core_ledger.js:1039-1045): `saleGroupInfo` owed 0 (:1077), `groupMethods` mixed (:1100-1112), `dayStats` buckets (:1401-1412), receipt, undo, sync |
| Mixed, part now | SALE then PAYMENT | SALE cash = paidNow − bank, CASH; PAYMENT = bank | 'split' | chosen day or '' | as above with owed > 0; the PAYMENT ≤ owed after the SALE row (the server's check, core_sync.js:802-805) |
| Mixed where the cash part is 0 | SALE only | paidNow | KEY (the account) | '' | as above | `splitSale`'s `full` rule (:1031-1037) |
| Mixed where the bank part is 0 | SALE only | paidNow | CASH | '' | as above | — |

`GroupID` = the SALE's `txId` (`newTx`, core_ledger.js:61; `writeGroup` forces the PAYMENT onto it, :68). Receipt numbers: the phone stamps the SALE row
(`appendLedger`, app_store.js:296-299); Telegram rows get the derived number (`receiptNumber`, core_ledger.js:1621-1643). `afterWrite` (:82-92) refreshes the views
whenever a customer is on the row or cash ≠ amount, so every part payment and every named sale rewrites Credits/Deposits/Customers.

**Column.** `CFG.LEDGER_COLS` gains `'DueDay'` after `'ReceiptNo'` (27 names; both Sheet writers are positional by CFG order, gas_store.js:385, gas_sync.js:180).
Value: `'yyyy-mm-dd'` text or ''. Semantics: the day the customer promised to pay the rest, on the live SALE row of a group that owed money when it was written.
A rewrite copies it onto the replacement (`rewriteRows`, core_ledger.js:981-988); an undo mirror leaves it blank (netting needs no date). Quick-mode sales and voice sales never set it.

### 2.2 The Lists tab: `Kind`

`CFG.LIST_COLS` = `['List','Key','Label','Active','Order','Shop','Detail','Note','Kind']`. Values `wallet`, `bank` or blank (= wallet). Only `pay_method` rows use it;
other lists ignore it. Normalised row: `kind` present only when the cell holds a valid value (decision 7). Compact row (`lists_json`): `{k,l,a,o,s,d}` plus `n` only when
`kind` is set, so a sheet whose rows have no Kind sends exactly today's string (and today's hash). `listKind(row)` → `'bank'` when `row.kind === 'bank'` or
(`!row.kind && row.key === CFG.METHOD.BANK`), else `'wallet'`. `listUpsert`'s append carries `rec.kind` (core_ledger.js:582); its `set` ops stay label/detail only.
A phone's `list` entry may carry `kind` (section 4.2). The laptop and simulator v2 edit it as a cell.

### 2.3 Settings: `sale_flow`

Key `sale_flow`, values `steps` (default in code and in the setupSheet `defaults` list, gas_setup.js:44-66) or `quick`. Read through `saleFlow(ports)` on every
`S|id|N`, `QN` and `D` answer (never cached). Reaches phones with the Settings map (`syncSettingsFor`, core_sync.js:915-929; bootstrap :1062-1067); the app's
`getSetting` honours a per-device pref `setting:sale_flow` (app_store.js:341-344) should the app's settings screen ever offer it (not built, section 9).
`seedSimWorld` sets `sale_flow: 'quick'` (poc/sim_seed.js:67-74) so every round-3/4 suite, the current page and the dev page keep today's path.

### 2.4 Customers

No new column. A buyer named inside a guided sale is created at `GSK|ok` (`addCustomer({name})`, then `updateCustomer(id, {phone})` when a phone was typed), on
the same device and before the ledger rows, so the sync order customer < group (`SYNC.ENTRY_KINDS`, core_sync.js:75) holds. An abandoned flow leaves no row
(the order flow's early creation, core_bot.js:2390/2408, is not copied). An existing customer picked by button or matched by name/phone is attached by id.
Matching never merges silently: look-alikes always ask (`matchCustomers`, core_ledger.js:1370-1374; `cust_pick`). `recentCustomers` pads with the newest
(core_ledger.js:1307-1310), so a buyer created today is a button tomorrow.

### 2.5 The Credits view

`CFG.CREDIT_COLS` = today's 13 (core_config.js:157) + `'DueDay'`, `'Overdue'`. `openCredits` adds to each entry `dueDay` (from the live SALE row via `saleGroupInfo(...).dueDay`)
and `overdue` (section 3.2 `creditOverdue`). `gasStore.refreshViews` writes 15 cells per row (gas_store.js:684-687). The tab is cleared and rewritten on every refresh,
so the new header appears at the first credit-related write after publishing, or at once with `rebuildViews()` (gas_main.js:287-291).

---

## 3. Core functions, per file

Rules kept: ES5, one global scope (every new name below was grepped across apps-script/, app/, poc/, tools/ on 2026-11-11 and is free), core_ledger.js calls
nothing from core_bot/core_orders/core_sync, callback data under 64 bytes, append-only ledger, the lock through `ports.lock.run`.

### 3.1 apps-script/core_bot.js

New or changed functions (signatures in the file's own style):

| Function | What |
|---|---|
| `handleCallback` case `'S'` (:444-451) | `if (saleFlow(ports) === 'quick') { today's body } else return saleStart(chatId, msgId, isCaption, uid, item, { qty: clampQty(arg) }, staff, ports);` |
| `applyAwaitedNumber` cases `sale_price` (:713-721), `sale_qty` (:722-734) | after the existing guards, `if (saleFlow(ports) === 'steps') return saleStart(chatId, null, false, uid, item, {qty, unitPrice?, note: 'spoken price'?, source, transcript}, staff, ports);` else today's commit |
| `saleStart(chatId, msgId, isCaption, uid, item, p, staff, ports)` | builds `draft = {itemId, qty, unitPrice: p.unitPrice or item.price, amount, note, customerId:'', newName:'', newPhone:'', needBuyer:false, method:'', account:'', bankPart:0, paidNow:null, dueDay:'', addedKey:'', source, transcript}`, `path: []`, `setLastItem`, then `saleGoto(..., 'buyer')` |
| `saleState(ports, uid)` | the state when it is `{kind:'sale'}` or an `await_text`/`await_number` whose purpose matches `/^sale_(buyer\|phone\|due\|part\|bank)$/`, all with `draft`; else null |
| `saleGoto(chatId, msgId, uid, state, step, staff, ports, prefix)` | applies the skip rules (1.2) from `step` forward, pushes the shown step onto `state.path`, calls the screen builder, `editOrSend`; `prefix` carries a ➕ line |
| `saleScreen(ports, staff, draft, step)` → `{text, kb, kind, purpose}` | the nine screens of 1.2; every keyboard ends with `saleBackRow(ports)` |
| `saleBackRow(ports)` | `[btn(t(ports,'btn_back'),'GS\|back'), btn(t(ports,'btn_cancel'),'Z')]` |
| `saleCallback(chatId, msgId, isCaption, uid, parts, staff, updateId, ports)` | `GS\|<step>\|<arg>` dispatch with the stale-step guard; `GS\|back` pops `path`, clears that step's draft field (`saleClearStep`) and redraws the previous step; the first step's back redraws the item card and clears the state |
| `saleTextInput(chatId, uid, state, text, staff, updateId, ports, source)` | the typed answers of `sale_buyer` (name/phone, look-alikes), `sale_phone`, `sale_due` (`parseDayText`); called from `handleText` BEFORE `parseNumberText` (:666), next to the other `await_text` purposes (:660-665), because a phone number parses as a number (comment :658-659) |
| `applyAwaitedNumber` cases `sale_part`, `sale_bank` (new) | range check, `draft.paidNow` / `draft.bankPart`, `saleGoto` next; a bad value re-sets the state and answers `sale_bad_amount` with a cancel-only row (the `sale_qty` pattern :725-728) |
| `saleBuyerPick(chatId, msgId, uid, state, arg, staff, ports)` | `none` → `customerId=''`; a customer id → attach; `create` → `newName` from the look-alike screen (`state.pendingName`), no write |
| `saleCommit(chatId, msgId, isCaption, uid, state, staff, updateId, ports)` | `GSK\|ok`: `clearState`; create the buyer when `newName`; `commitSaleGroup(ports, {...})`; `setLastItem`, `setLastGroup`; `markCommittedCard`; edit the summary into the sold card (1.3) with `saleDoneKeyboard` |
| `saleDoneKeyboard(ports, groupId, draft)` | 1.3 |
| `saleMethodRows(ports, shop, draft)` | the how-paid buttons of step 3 from `payMethodsByKind`; the 64-byte skip of `methodRows` (:312) kept |
| `saleAccountRows(ports, shop, keys)` | step 4 buttons |
| `finishAddOption` (:1417-1451) | new early branch for `state.resume.a === 'GS'` (1.4): `saleAddNamed`; `ADD_RESUME_LIST.GS = 'pay_method'` |
| `saleAddNamed`, `saleAddKind(chatId, msgId, uid, state, kind, staff, updateId, ports)` | 1.4; `addListOptionByLabel(ports, 'pay_method', label, staff, {kind})` |
| `MUTATING_ACTIONS` (:417-418) | `+ GSK: 1` |
| file header legend (:20-31) | `GS sale steps (buyer, phone, method, account, bank part, full/part, part amount, due day, kind of a new account, back)  GSK sale commit` |
| `handleIntent` (:774-808, 823-831) | four lines so a voice note inside a step lands in the step: `await_text` + `sale_buyer` → `saleTextInput` with `intent.customer \|\| transcript`; `sale_phone` → digits as the `phone` purpose does (:781-786); `sale_due` → `saleTextInput(transcript)`; `await_number` `sale_part`/`sale_bank` already reach `applyAwaitedNumber` through :823-830 (`spokenMoney`) |
| `buildAiContext` (:615-633) | unchanged: `awaiting` becomes `sale_buyer`, `sale_part`, `sale_method`... by the existing rules (:620-623) |

Callback table (all under 64 bytes; the longest is `GS|b|C-xxxxxxxx` = 15):

| Data | Step | Mutating |
|---|---|---|
| `GS\|b\|none`, `GS\|b\|<custId>`, `GS\|b\|create` | buyer | no |
| `GS\|ph\|skip` | phone | no |
| `GS\|m\|<KEY>` (CASH or a wallet key), `GS\|mb`, `GS\|mx` | method | no |
| `GS\|a\|<KEY>` | account | no |
| `GS\|bp\|half`, `GS\|bp\|other` | bank part | no |
| `GS\|f\|full`, `GS\|f\|part` | full or part | no |
| `GS\|p\|<n>`, `GS\|p\|other` | part amount | no |
| `GS\|d\|<n>`, `GS\|d\|type`, `GS\|d\|none` | due day | no |
| `GS\|k\|wallet`, `GS\|k\|bank` | kind of a new account | no (writes a Lists row, as `LA` flows do) |
| `GS\|back`, `Z` | any | no |
| `GSK\|ok` | summary | yes (`MUTATING_ACTIONS`) |
| `LA\|pm\|GS` | how-paid ➕ | no |

States and steps (the full table of core_bot.js state kinds, map-sale 6.2, gains these rows):

| kind | step / purpose | fields | set at | consumed at |
|---|---|---|---|---|
| `sale` | `method`, `account`, `bank`, `paid`, `part`, `due`, `kind`, `summary` | `draft`, `path`, `pendingLabel` (kind) | `saleGoto`, `saleAddNamed` | `saleCallback` |
| `await_text` | `sale_buyer`, `sale_phone`, `sale_due` | `draft`, `path`, `step`, `pendingName` | `saleGoto` | `handleText` → `saleTextInput`; `GS\|*` taps; voice |
| `await_number` | `sale_part`, `sale_bank` | `draft`, `path`, `step` | `GS\|p\|other`, `GS\|bp\|other` | `applyAwaitedNumber`; voice `spokenMoney` |

### 3.2 apps-script/core_ledger.js

| Function | What |
|---|---|
| `newTx` (:31-63) | `dueDay: f.dueDay \|\| ''` as the 27th field (after `receiptNo`) |
| `rewriteRows` (:965-990) | the replacement copies `dueDay: row.dueDay`; the mirror leaves it '' |
| `commitSaleGroup(ports, p)` (new) | `p = {item, qty, unitPrice, note, customerId, method, account, bankPart, paidNow, dueDay, staff, source, transcript, updateId, when}`; the money rules of 2.1; returns `writeGroup(ports, rows)` with `rows[0]` the SALE. Pure ledger code, no chat |
| `saleGroupInfo` (:1064-1086) | `dueDay: first.dueDay \|\| ''` in the returned object |
| `creditOverdue(dueDay, days, today)` (new) | `dueDay ? today > dueDay : days >= CFG.OVERDUE_DAYS` |
| `openCredits` (:1122-1169) | each entry gains `dueDay` and `overdue: creditOverdue(info.dueDay, days, dayKey(now))`; sort unchanged |
| `buildDailySummary` (:1551-1557) | `overdue` line over `c.overdue && !c.dueDay` (bit-identical text), then `summary_due_overdue` over `c.overdue && c.dueDay` |
| `listNormRow` (:336-348) | `var kind = listText(r.kind).toLowerCase(); if (kind === 'wallet' \|\| kind === 'bank') row.kind = kind;` (no key otherwise) |
| `listRowToCompact` / `listRowFromCompact` (:498-506) | `if (row.kind) c.n = row.kind`; `kind: c.n` on the way back |
| `listKind(row)` (new) | decision 7 |
| `payMethodsByKind(ports, shop)` (new) | `{wallets: [...], banks: [...]}` over `payMethods(ports, shop)` (:116-130, so the 12-byte and cap rules hold) partitioned by `listKind(listOption(ports, 'pay_method', k))`; CASH left out |
| `listUpsert` (:561-600) | the appended row carries `kind: rec.kind` (:582); `set` ops unchanged |
| `addListOptionByLabel(ports, name, label, staff, extra)` (:715-734) | optional `extra = {kind}` merged into the `addListOption` rec (:726); otherwise unchanged |
| `settingList`, `duePresets` | moved here from core_orders.js:22-31, same names and bodies (core_orders.js keeps calling them; this file still calls nothing of core_orders) |

### 3.3 apps-script/core_burmese.js

`addDaysKey`, `daysBetweenKeys`, `parseDayText` move here from core_orders.js:48-78 (same names, same bodies; they use `MY_DIGITS` and `dayKey`, both in this file),
in the dates section after `fmtDayShortMy` (:50-54). core_orders.js loses the three definitions (a name is never redefined). tools/score_voice.js, which loads only
core_config, core_burmese and core_ai_prompt, is unaffected.

### 3.4 apps-script/core_config.js

`LEDGER_COLS` + `'DueDay'` (last). `LIST_COLS` + `'Kind'` (last). `CREDIT_COLS` + `'DueDay'`, `'Overdue'` (last). `LIST_KINDS: ['wallet', 'bank']`.
`saleFlow(ports)` next to `settingOn` (:190-193). Comment on `LEDGER_COLS` (:127-131) gains the DueDay sentence of 2.1.

### 3.5 apps-script/core_messages.js — the new keys (every one a **draft** built from existing fragments; source keys in brackets)

```
btn_no_name: '🚫 နာမည် မရှိ'                                      [btn_design_none :226, ask_name :80]
btn_wallet: '📲 {method}'                                          [btn_app :184 glyph, btn_bank :131 shape]
btn_bank_transfer: '🏦 ဘဏ်'                                        [summary_cash :205]
btn_paid_full: '✅ အကုန် ပေးပြီး'                                   [btn_all :44, receipt_total :122]
sale_ask_method: '💰 {amount} ကျပ် · ဘယ်လိုပေးလဲ?'                  [dlv_ask_method :304]
sale_ask_account: '🏛 ဘယ်အကောင့်လဲ?'                               [split_ask_bank :377, btn_accounts :395]
sale_ask_paid: '💰 {amount} ကျပ် · အကုန် ပေးပြီးလား?'                [btn_all :44, receipt_total :122, credit_use_deposit :100]
sale_ask_due: '📅 ကျန်ငွေ {owed} · ဘယ်တော့ ပေးလဲ?'                  [ping_overpaid core_sync.js:124, ord_ask_due :236, pay_ask_amount :104]
sale_due_line: '📅 ကျန် {owed} · {date}'                           [receipt_total :122, ord_due_set :237]
sale_owed_line: '💳 ကျန် {owed} ကျပ်'                               [dlv_owed :306]
sale_bad_amount: '❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ'          [split_bad :382]
add_ask_kind: '➕ "{label}" · ဘယ်လို အကောင့်လဲ?'                     [add_done :391, exp_ask_method :164, btn_accounts :395]
btn_kind_wallet: '📲 Pay အကောင့်'                                   [lists_note_list :415]
btn_kind_bank: '🏛 ဘဏ်အကောင့်'                                     [acct_title :396, btn_accounts :395]
lists_note_kind: 'wallet = Pay အကောင့် (KBZPay, WavePay) · bank = ဘဏ်အကောင့် · ကွက်လပ်ထားရင် wallet'   [lists_note_list :415, lists_note_shop :420]
summary_due_overdue: '⏰ ရက်လွန် အကြွေး: {list}'                     [summary_orders_overdue :369, summary_overdue :208]
settings_note_sale_flow: 'steps = တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက် ရောင်း'   [ms_question glyphs :333; a Settings-tab note only, never a button]
```
Reused verbatim (no new key): `btn_back`, `btn_cancel`, `btn_skip`, `btn_yes`, `confirm_ask`, `confirm_sale`, `credit_ask_customer`, `cust_find`, `cust_pick`,
`btn_create_named`, `ord_ask_phone`, `btn_cash`, `btn_bank`, `btn_split`, `btn_add_bank`, `add_ask_pm`, `add_done`, `add_exists`, `split_ask_amount`, `btn_half`,
`btn_other`, `ask_number`, `btn_credit`, `credit_ask_paid`, `btn_days`, `btn_due_type`, `ord_ask_due_text`, `ord_bad_date`, `card_buyer`, `sold_done`, `credit_done`,
`cust_attached`, `method_done`, `split_done`, `acct_detail_hint`, `btn_acct_number`, `btn_undo`, `btn_receipt`, `btn_pay`, `expired`, `cancelled`, `bad_qty`, `tag_not_found`.
Round-4 rule check (SPEC-round-4.md:99-102): no new BUTTON text contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ (`lists_note_kind` is a header note, not a button); the one
button that starts with `🏦 ` is `btn_bank_transfer`, a method button in the rule's own sense (it picks the bank method; `stripMethodLines` core_bot.js:1102-1104 acts on
message lines, never on buttons). `btn_kind_bank` and `sale_ask_account` deliberately use 🏛.

### 3.6 apps-script/core_report.js

`buildReceipt` (:322-348): `r.dueDay = info.dueDay`; `receiptText` (:358-369) prints `sale_due_line` after `receipt_total` while `r.owed > 0 && r.dueDay`; `receiptReport`
(the PDF) the same. The three credit tables (:219-221, :271-273, :306-310) add the due column of 1.5.

### 3.7 apps-script/core_sync.js

`syncValidateTx` (:369-388): `dueDay` joins the optional strings (:381) and, when present and non-blank, must match `/^\d{4}-\d{2}-\d{2}$/` (else `MALFORMED`).
`syncListRecReason` (:469-481): optional `kind`, absent or one of `CFG.LIST_KINDS` (else `MALFORMED`). `syncApplyListEntry` (:517-525): copies `kind` with the other
fields (:520). `syncSettingsFor`: unchanged (every Settings row already travels). The shadow-ledger PAYMENT check (:802-805) needs nothing: `commitSaleGroup` writes the SALE first.

### 3.8 apps-script/core_orders.js

Loses `settingList`, `duePresets` (→ core_ledger.js) and `addDaysKey`, `daysBetweenKeys`, `parseDayText` (→ core_burmese.js); nothing else changes.

---

## 4. Glue and sync

### 4.1 setupSheet and the Ledger width (gas_setup.js)

- `setupSheet` (:14-88): `var ledger = ss.getSheetByName('Ledger') || ss.insertSheet('Ledger'); gasEnsureWidth(ledger, CFG.LEDGER_COLS.length);` BEFORE
  `ensureTab(ss, 'Ledger', CFG.LEDGER_COLS)` and `ensureColumns(ledger, CFG.LEDGER_COLS)` (the Measurements precedent :120-124; a new tab has 26 columns and
  `ensureColumns` appends at the right-hand end :257-265, which is where `DueDay` must sit because both writers are positional). Then `textColumn(ledger, CFG.LEDGER_COLS, 'DueDay')`.
- `defaults` (:44-66) gains `['sale_flow', 'steps']`; the row's note (Settings column C is free) is `settings_note_sale_flow` — optional nicety in a try/catch like the Lists notes (:177-181).
- `ensureListsTab` (:150-210): `ensureColumns(sh, CFG.LIST_COLS)` already appends `Kind` on an existing tab (:154); the seed writes `header.length` cells (gas_store.js:297), so a blank Kind lands;
  new nicety: a `wallet | bank` dropdown from row 2 with `setAllowInvalid(false)`, a blank allowed (the Shop pattern :189-191); the header-note loop (:192-196) picks up `lists_note_kind` by itself.
- `writeDashboard` (:405-406): `'Overdue'` label and `'=SUMIF(' + CR('Overdue') + ',TRUE,' + CR('Owed') + ')'`.
- `GAS_LIST_TEXT_COLS` (gas_store.js:221) unchanged (`Kind` holds plain words; a text format is not needed).

### 4.2 gas_store.js and gas_sync.js

- `gasStore.appendLedger` (:371-388): `DueDay: tx.dueDay || ''` in the map; before `appendRow`, `gasEnsureWidth(gasSheet('Ledger'), CFG.LEDGER_COLS.length)` (one `getMaxColumns` call;
  `insertColumnsAfter` runs once in the sheet's life), so a Telegram sale between "publish" and "run setupSheet" never fails; its 27th value sits under a blank header until setupSheet
  writes `DueDay` there (`ensureColumns` starts at the first blank header :262), after which `gasTable` reads it by name (:36-51).
- `gasStore.ledgerRows` (:389-404): `dueDay: gasDay(o.DueDay)` (the `Day` treatment: a Date cell back to text; undefined → '').
- `gasSyncLedgerValues` (gas_sync.js:160-170): `DueDay: tx.dueDay || ''`; `gasSyncTabs.appendRows` (:174-183): `gasEnsureWidth(sh, CFG.LEDGER_COLS.length)` before the block write.
- `gasListRows` (gas_store.js:234-254): `kind: text(o.Kind).trim().toLowerCase()`; `gasStore.listOptions` (:629-633) copies it; `gasListValues` (:276-282): `Kind: r.kind || ''`;
  `gasListsPersist` (:305-332): the pending append row copies `kind` (:316); `set` ops unchanged.
- `gasStore.refreshViews` (:681-687): the Credits row gains `c.dueDay, c.overdue === true`.
- `gas_main.js onEdit` (:109-121): unchanged for round 5 (a Kind edit on Lists already rewrites the Dashboard through the existing branch; the Dashboard does not depend on Kind). Optional: section 9.

### 4.3 Validation and old devices

- A new phone pushing to the new server: `dueDay` validated as above; a `list` entry with `kind` accepted and persisted at append.
- An old (round-4) phone pushing to the new server: no `dueDay`, no `kind` → rows land with blanks, lists as wallets; behaviour as today. It pulls rows carrying `dueDay`
  and compact rows carrying `n`: `appendSynced` copies the extra key (app_store.js:444-452), `listRowFromCompact` ignores `n` (round-4 core_ledger.js:503-506). Its sale is the one-tap card
  (its core has no `saleFlow`), still a valid full-cash sale the server accepts. `Settings app_min_version` (core_sync.js:339-340) can force updates when the owner wants every phone on steps.
- A new phone pushing to an old server cannot happen (rounds 4 and 5 publish together); for the record, `syncValidateTx` has no unknown-field rule (core_sync.js:381-385) and the old
  `gasSyncLedgerValues` would drop `dueDay` silently.
- Day checksums hash only n/amount/cash (core_sync.js:876-887): the new column can never start a repair loop.

### 4.4 The exact migration

1. All suites green (section 7), then `node tools/bundle_gas.js`, `node tools/build_app.js`, `node poc/build_simulator.js`.
2. `node tools/publish.js bot "round 4 + 5: lists, accounts, split, measurement form, guided sale"` (apps-script/README.md:219, 249).
3. In the editor run `setupSheet` once: Lists tab created (round 4) with its ninth `Kind` column and dropdown; Ledger grown to 27 columns with `DueDay` as text; Settings
   `sale_flow = steps` appended; the new Messages keys appended (gas_setup.js:71-73); Dashboard rewritten with the `Overdue` cell. Then run `rebuildViews` so the Credits tab shows
   `DueDay`/`Overdue` at once (gas_main.js:287-291).
4. `node tools/publish.js app` (README:256). Phones update through the service worker (`ui_update_ready`); until then they sell with the one-tap card and all rows stay valid.
5. The owner may type `quick` into Settings `sale_flow` at any time; the bot obeys at the next tap, each phone at its next pull.
Between 2 and 3 a Telegram sale works (4.2); a phone's push works (`appendRows` grows the grid). The README's order remains the recommended path.

---

## 5. App (app/)

- **No change is required for the flow to run in the app.** Button screens render as full-width rows (app_ui.js:678-687); the buyer, phone and typed-date screens are
  `await_text` → text bar (app_ui.js:73, 767-770); the typed count, price, part and bank-part screens are `await_number` → the keypad opens once per message (:757-764, 909-939).
  The card's `S|<id>|1` and `Q|<id>` buttons are unchanged, so `appCardInfo` and the stepper (:37-53, 696-712) keep working and the stepper's `S|id|N` is the count answer.
  Home shows the last bot message (:352, 468): the card edited into a question, or the new message of a typed path.
- **Small additions (app step):**
  - `appInputBar` (:754-771): when `state.purpose === 'sale_due'`, an `<input type="date">` beside the text field whose change sends `dd.mm.yyyy` text (`parseDayText` accepts it,
    core_burmese.js after the move; it does not accept ISO). New APP_MSG key `ui_date_pick` (**draft** '📅 ရက်စွဲ ရွေး', from `btn_due_type` :240 and `ord_due_set` :237).
  - `app/README.md`: the guided sale paragraph and the `sale_flow` row.
- **Not changed:** `appInputModeFor` (the sale uses existing kinds), `app_store.js` (every row key is copied, :236-240, :294-312; one `lock.run` = one outbox group, app_ports.js:166-172),
  `app_sync.js` (`pendingLines` prints the group's first row with `describeRow`, :502), `tools/build_app.js`, `app/config.js`.
- **Receipt letters**: the SALE row of a mixed group is first in the array, so `appendLedger` stamps it (app_store.js:296-299) and the PAYMENT row gets none.

---

## 6. Simulator v2 (poc/) — the owner's judgement tool

### 6.1 What the owner sees

1. **Login** (replaces the 2×2 user switch of sim_ui.js:72-85): three cards from `SIM_USERS` (sim_seed.js:35-40) — Owner (the shared admin login, id 1000), Seller shop 1 (1001),
   Seller shop 2 (1002). Page state `S.login`. "Customer (not staff)" becomes the tour step "a stranger scans a tag" (`staff_only`, run_scenario.js:51-54).
2. **Device bar per login**: ✈️ Telegram (today's phone pane over `world.chats[user.id]`), 📱 the real app (an `<iframe srcdoc>` 390×780, enrolled as that staff member),
   and for the owner 💻 the laptop: the Sheet pane plus a second app frame at ≥ 700 px (the measurement form goes two-column there, app.css:193). Frames are created lazily and kept
   while the page lives (switching login hides them), one `createMemoryAdapter()` each.
3. **The laptop pane** (the Sheet, owner only), tabs: Dashboard, **Lists (editable)**, Ledger (+ `DueDay`), **Customers (Phone editable)**, Credits (+ Due, ⏰ by `c.overdue`),
   Deposits, Orders, **Measurements** (new: `world.measurements`), **Devices** (new: `server.devices`, status, letter, pending), **Settings** (new: every `world.settings` row,
   `sale_flow` as a two-button switch), Errors, Family group.
4. **"What can I do" panel** with one guided tour per function (D8's list: sell step by step, restock, register a new piece by photo, return, expense, receive a payment, take a
   deposit, custom order with voucher and measurements, reports and the 21:00 summary, enrol a phone, manage lists on the laptop, a stranger scans a tag, switch `sale_flow`).
   Each tour highlights the next thing to click and explains it in Burmese and English.
5. **Clock control**: `⏩ +1 ရက်` / `⏰ 21:00` set `world.nowOverride` (sim_ports.js:22; the fake server reads the same clock, sim_sync.js:21), so the undo window, an overdue credit
   with its due day and the 21:00 summary (`buildDailySummary` + `server.summaryLines()`, the dev page's composition dev/index.html:208) can be shown.
6. **Voice** behind a collapsed `<details>` (D7): the 16 `PHRASES` (sim_ui.js:8-25) and the parser box.

### 6.2 Editable Lists on the laptop (and the Customers phone)

- New sim-only store method in poc/sim_ports.js: `setListRow(name, key, fields)` — finds the raw row by `listNormKey(name, key)`, assigns `label | active | order | shop | detail | kind`
  as the Sheet would hold them (strings; `active` boolean), emits `{type:'lists'}`; `addRow` reuses `addListOption({list, key, label, detail, kind})` (the bot's own rule, so a duplicate
  label is refused the same way); `listOptions` (:245-255) returns `kind: str(r.kind)`.
- The Lists tab draws Label and Detail as inputs, Active as a tick box, Kind as a `blank | wallet | bank` select; `change` → `setListRow`; the existing flash (`listRowSig`,
  `markListChanges`, sim_ui.js:359-372) shows the edit landed. Propagation needs nothing: the bot reads `store.listOptions` on every screen (core_ledger.js:447-451); the app frame
  pulls `lists_json` when the Settings hash changes (core_sync.js:908-921) — a `🔄 sync now` button on the device bar calls `frame.contentWindow.APP.sync.syncNow('sim')`.
- Customers tab: the Phone cell is an input → `world.ports.store.updateCustomer(id, {phone})` (the fake server bumps nothing; the frame sees it at its daily full pull, or at the
  `🔄` button after the page sets `world.customers[i].rev = ++server.props.MASTER_REV`, which is what a real `onEdit` bump would do — section 9).
- Settings tab: `sale_flow` switch writes `world.settings.sale_flow` and calls each frame's `syncNow('settings')` (the dev page's `app_voice` mechanism, dev/index.html:201-204).

### 6.3 Tours

- `poc/sim_tours.js` (new, ES5, one global `SIM_TOURS`): each tour is `{id, title_my, title_en, steps: [{device: 'tg'|'app'|'laptop'|'floor', say_my, say_en, expect}]}` where `expect` is
  `{scan: 'S1-0002'}`, `{cb: <callback_data or a function(world, user) returning it>}`, `{text: /regex/}`, `{tab: 'lists'}` or `{edit: {list, key, field}}`. Button labels quoted in `say_*`
  are inserted at run time as `t(world.ports, key)` (the Messages tab may override them); only the explanatory sentences are the tour's own text (Burmese **drafts** to be rewritten).
- The engine (in sim_ui.js) highlights the target: Telegram buttons get `data-cb="<callback_data>"` in `renderMsg` (:211-219) and the tour sets `.hot` on `[data-cb="…"]`; the floor
  tag `[title="Scan S1-0002"]` (:103); in the app frame `frame.contentWindow.document.querySelector('.kb button[data-cb]')` with the unused `.kb button.hot` style (app.css:97) once
  `appRenderMsg` adds `data-cb` (one attribute, app step). Completion is observed on `world.listeners` `update` events (`evt.update.callback_query.data` / `message.text`,
  sim_ports.js:389-393) and, for the frame, `APP.phone.on('change')`.
- The sell tour walks exactly the screens of 1.2 and ends on the laptop: the Ledger row(s) flash, the Credits row shows the due day, the Customers row shows the buyer and phone.

### 6.4 Embedding the real app

- Per frame `srcdoc`: `app/index.html`'s shell (:22-38, the ids `appWireEvents` binds without null checks, app_ui.js:316-333), the inlined `app.css`, the same Google Fonts link the template
  uses (the app's `fonts/fonts.css` paths do not resolve in a srcdoc), the bundle in `tools/build_app.js` order (`CORE_FIRST` + other core + `APP_FIRST`, build_app.js:29-30, 55-58), no
  jsQR (a demo scan is `frame.contentWindow.appOpenTagId(id)` from the floor click, app_ui.js:546-551; `app_scan.js` checks `typeof jsQR` at run time), and a boot script
  `bootApp({apiUrl:'fake://sim-server', botUsername:'ShopTagBot', appName:'SalesTag (demo)', version:'demo'}, {adapter: createMemoryAdapter(), transport: parentTransport, noServiceWorker: true})`
  where `parentTransport(api, body)` resolves `parent.SIM.server.handle(api, body)` after `parent.SIM.latency` ms (the dev page's transport with `parent.` in front, dev/index.html:138-145).
- Enrolment: the honest path is a tour (Telegram `📲 အက်ပ်` → `app_enroll_code` → type it into the frame's `#codeInput` → `appDoEnroll`); a shortcut `server.mintEnrollCode(user, label).display`
  fills the field (dev/index.html:172-173, 186-191). The owner's `📱 ဖုန်းများ` then lists the frames with their receipt letters.
- `#measForm.formpage` is `position: fixed; inset: 0` inside the frame's document (app.css:170), so it covers the frame, not the page.

### 6.5 Files and build

- `poc/build_simulator.js` FILES (:12-18) becomes: `core_config, core_burmese, core_messages, core_ai_prompt, core_ledger, core_report, core_bot, core_sync, core_orders`,
  `poc/sim_mock_ai, sim_ports, sim_seed, sim_sync, sim_tours, sim_ui`; plus a second list (the frame bundle, `CORE_FIRST` + `core_orders` + `APP_FIRST`) and `app/app.css`, assembled
  into a JS string `SIM_APP_SRCDOC` injected at a new marker `<!-- @appframe -->`. The `</script` rule (:21) applies to every file (the srcdoc string escapes `</script` as `<\/script`).
  Size estimate: today's 517 KB + the 688 KB app bundle + sim_tours; under the artifact limit.
- `poc/simulator.template.html`: login screen, device bar, the laptop pane with the new tabs, the tour panel, the clock control, the collapsed voice `<details>`, Burmese labels on
  the page chrome beside English; the `<!-- @scripts -->` and `<!-- @appframe -->` markers.
- `poc/sim_ui.js`: boot `world = simSeedLists(seedSimWorld(createSimWorld())); world.settings.sale_flow = 'steps'; server = createFakeServer(world);` (so `world.ports.sync` is real and
  the menu shows `📲`/`📱`, sim_sync.js:234-242); the panes above; `S` gains `login, device, tour, frames`.
- Autopilot for a headless smoke: `?login=sister&device=app&tour=sell&latency=0`, errors collected in `window.SIM_ERRORS` (the dev page's `DEV_ERRORS` pattern, dev/index.html:96-107).
- Published as one artifact (`poc/dist/pos-simulator.html`), as today.

---

## 7. Tests

Conventions kept: plain Node, `vm.runInThisContext` loading in bundle order, `check(cond, label, detail)`, `step`, the 64-byte listener, `N passed, M failed` + exit code
(map-glue H). Each check below is phrased so that it is red without the feature.

### 7.1 poc/run_round5.js (new; the guided sale)

Loader: the eight core files + core_orders + sim_mock_ai, sim_ports, sim_seed (run_round4.js:21-26). `bench()` copied from run_round4.js:47-136 with two additions:
`world.settings.sale_flow = 'steps'` after `seedSimWorld` (and `bench({quick: true})` leaves `quick`), and `setAccounts(list)` copying each account's `kind`
onto the row it builds (run_round4.js:80-84 builds rows with a fixed field list and would drop it; without `kind` the rows read as wallets, decision 7). Helpers added: `guided(u, itemId, answers)` taps the card then each answer in
order and returns `{card, state, g}`; `screenOf(u)` = `{text, datas, texts}` of the last bot message; `ledgerLen()`.

1. **Entry**: `S|S1-0002|1` on a SKU card edits the card into the buyer screen (`card.edited`, text starts with `confirm_sale` for 1 piece 18,000), the ledger length unchanged,
   `getState` is `await_text`/`sale_buyer` with `draft.qty 1`; the grid's `S|S1-0002|3` starts with `qty 3`; `QN` + typed `4` starts with `qty 4` as a NEW message; `D` + typed `15000`
   starts with `qty 1, unitPrice 15000, note 'spoken price'`; a UNIQUE card's `✅ ရောင်းပြီး` starts the flow; `cardKeyboard` output is byte-identical in both modes.
2. **Buyer**: the first button is `btn_no_name` = `GS|b|none`, then four recent customers as `GS|b|C-…`, then `[GS|back, Z]`; the text holds `credit_ask_customer` and `cust_find`;
   typing `ဒေါ်မြင့်` (exact) attaches `C-0001` and goes to the method screen without a phone question; typing `ဒေါ်မြ` (a look-alike) shows `cust_pick` with `GS|b|C-0001` and
   `GS|b|create`; typing `09 777 123456` (a number nobody has) re-asks with `credit_ask_customer` + `cust_find` and creates nothing (digits alone are never a name);
   typing `ဦးသန့်` (new) asks `ord_ask_phone` and
   `world.customers.length` is unchanged; `GS|ph|skip` goes on; typed `09123456789` is kept in `draft.newPhone` as `09123456789`; `Z` on the phone screen leaves no customer row.
3. **How paid** (seeded lists): buttons exactly `[GS|m|CASH]`, `[GS|m|KBZ, GS|m|WAVE]` with texts `📲 KBZPay`, `📲 WavePay` (`btn_wallet`), `[GS|mb]` text `btn_bank_transfer`,
   `[GS|mx]` text `btn_split`, `[LA|pm|GS]`, `[GS|back, Z]`; with `setAccounts([{key:'AYA', label:'AYA', kind:'bank'}, {key:'CB', label:'CB', kind:'bank'}])` the `GS|mb` tap shows
   `GS|a|AYA`, `GS|a|CB` with `btn_bank` texts; with one bank the account screen is skipped (next text is `sale_ask_paid`); with no bank there is no `GS|mb` button; with a
   label of 12 characters the rows wrap two per row; `GS|mx` lists `KBZ`, `WAVE`, `BANK` (the legacy BANK as `btn_bank`).
4. **Mixed**: `GS|mx` → `GS|a|KBZ` → `split_ask_amount` with `btn_half` = `GS|bp|half` and `GS|bp|other`; `GS|bp|other` sets `await_number`/`sale_bank` and the typed `20000`
   stores `draft.bankPart 20000` (sale of 36,000); typed `40000` answers `sale_bad_amount` with max 35,999 and the state is kept; typed `0` the same with min 1.
5. **Full or part, part amount**: `GS|f|full` goes to the summary (no due question); `GS|f|part` shows `credit_ask_paid` with `GS|p|0`, `GS|p|18000`, `GS|p|other`; after a mixed
   bank part of 20,000 the first button is `GS|p|20000` and there is no half button below it; `GS|p|other` + typed `5000` is refused (min 20,000); a part payment with
   `GS|b|none` earlier shows the buyer screen again WITHOUT `GS|b|none`.
6. **Due**: `GS|d|14` sets `draft.dueDay = addDaysKey(today, 14)`; `GS|d|type` + typed `30.10.26`-style future date is kept, a past date answers `ord_bad_date` and keeps the state;
   `GS|d|none` leaves `dueDay ''`; the due screen is not shown when paid in full.
7. **Summary and commit**: the summary text holds `confirm_sale`, `card_buyer` with the method label, `sale_owed_line`, `sale_due_line` (fmtDayMy) and `confirm_ask`; the keyboard is
   `[[GSK|ok], [GS|back, Z]]`; `world.ledger.length` is unchanged until `GSK|ok`; after it the rows, cash, method, customer and dueDay are exactly those of the 2.1 table for each of
   the seven outcomes (one check per row); a mixed sale appends SALE then PAYMENT with the same group, both `note 'split'`, PAYMENT `refGroupId` = group; `saleGroupInfo` owed matches;
   `receiptNumber` is one number; a second `GSK|ok` on the same message writes nothing and says `expired`; the new buyer exists only after the commit, with the phone typed.
8. **The sold card**: text holds `sold_done`; `credit_done` when owed; `method_done` for KBZ; `split_done` for mixed; `sale_due_line` when dated; keyboard `[U|g, RC|g]`, `[PY|g]` only
   while owed, no `CR|`, `CU|`, `PM|`, `SX|`, `LA|` anywhere; `U|g` nets stock and both buckets to zero (`dayStats` byMethod) and `openCredits` no longer lists it; `RC|g` prints the
   mixed method text and the due line.
9. **Back and cancel**: back from the method screen returns to the buyer screen with its buttons; back from the buyer screen redraws the item card (`cardText`) and clears the state;
   back after a skipped account screen returns to the method screen; back from the summary returns to the last shown step; `Z` anywhere edits to `cancelled`, writes nothing and
   clears the state; a scan mid-flow clears the state and opens the new card; the menu keeps the state.
10. **Stale taps**: `GS|f|full` tapped while the state is at `buyer` answers `expired`; `GS|a|KBZ` after `Z` answers `expired`; every `GS|*` and `GSK|ok` callback of the file is under
    64 bytes (the listener, >200 buttons).
11. **➕ inside the sale**: `LA|pm|GS` edits the how-paid screen into `add_ask_pm` and keeps the sale in `saved`; typed `AYA ဦးမောင်` shows `add_ask_kind` with `GS|k|wallet`, `GS|k|bank`
    and no Lists row yet; `GS|k|bank` appends one row with `kind 'bank'`, the prefix `add_done` and the `sale_ask_paid` screen (the account chosen, `draft.account` = the new key);
    the sold card then carries `LD|pm|<key>`; typing the name of an existing account answers `add_exists` and chooses it; a digits-only name asks again.
12. **Credits, summary, reports**: a part-paid sale with `dueDay = today + 7` is not in `summary_due_overdue` today, is there after `tick(8 days)` with `(date · ၁ ရက် လွန်)`, and an
    undated 1,000,000 seed credit stays on the `summary_overdue` line with the identical text; `openCredits` entries carry `dueDay` and `overdue`; `creditOverdue` truth table (dated
    future, dated today, dated past, undated 29 days, undated 30 days); the owed report row has the due column; `convertSaleToCredit` on a quick sale leaves `dueDay ''`.
13. **Voice inside a step**: a voice note `ဒေါ်မြင့်` on the buyer screen attaches her; a spoken `တစ်သောင်း` on the part screen (await_number) stores 10,000; a spoken sale phrase on the
    method screen does not write a sale (the state survives, no new SALE row).
14. **Quick stays quick**: `bench({quick:true})` (seed value): `S|S1-0005|1` writes one SALE row at once and the card is `afterSaleKeyboard` (the round-4 layout), `D` + price writes at once.
15. **Setting read live**: flipping `world.settings.sale_flow` between two sales changes the behaviour without a restart.

### 7.2 poc/run_lists.js (appended)

- `newTx` rows have `CFG.LEDGER_COLS.length` keys and `dueDay ''`; `commitSaleGroup` with `dueDay` sets it on the SALE row only; `rewriteRows` copies it to the replacement and
  leaves the mirror blank; `saleGroupInfo(...).dueDay` reads the live row after a rewrite.
- `listNormRow` with `kind 'Bank '` → `kind 'bank'`; with `kind 'x'` or blank → no `kind` key (exact 8-key shape as before); `listRowToCompact` adds `n` only when set; round trip;
  `listKind` of blank, `wallet`, `bank`, legacy `BANK` key, and `BANK` with an explicit `wallet`; `payMethodsByKind` on the seed = `{wallets: ['KBZ','WAVE'], banks: ['BANK']}`;
  `listUpsert` append carries `kind`; `addListOptionByLabel(..., {kind:'bank'})` writes it; `listsJsonFor` on seeded rows is byte-identical to round 4's string.
- `creditOverdue` table; `openCredits` fields; the `summary_due_overdue` line; `parseDayText`/`addDaysKey`/`daysBetweenKeys` callable from a load set WITHOUT core_orders.js (this suite's).
- `saleFlow(ports)`: missing → `steps`; `'quick'`, `'QUICK '`, `'steps'`, `'x'` → the right value.
- The S-style messages check for the round-5 keys (3.5), compared with the spec's code block as run_lists.js:924-930 does for round 4.

### 7.3 poc/run_gas.js (appended, with poc/fake_gas.js)

- `setupSheet` on an empty book: the Ledger has `CFG.LEDGER_COLS.length` columns with `DueDay` last and `@` on the whole column; Lists has nine columns with `Kind` last, a
  `wallet|bank` dropdown from row 2, the `lists_note_kind` note; Settings has `sale_flow = steps`; a second run changes nothing.
- `setupSheet` on a round-4 book (26-column Ledger with rows, 8-column Lists with rows): `DueDay` is appended at column 27 and the existing rows read back unchanged; `Kind` at
  column 9 with every row blank; no row moved.
- A Telegram sale on a 26-column Ledger BEFORE setupSheet (`gasStore.appendLedger` through `commitSaleGroup` with a dueDay): no throw, `getMaxColumns() === 27`, the value sits in
  column 27; after `setupSheet` `ledgerRows()` returns it as `dueDay`. The same through `gasSyncTabs.appendRows` (a phone's push).
- `refreshViews` writes 15 Credits cells, `Overdue` a boolean; the Dashboard overdue cell's formula text is `=SUMIF(Credits!$O:$O,TRUE,Credits!$L:$L)` (letters from `CFG.CREDIT_COLS`).
- `addListOption({list:'pay_method', key:'AYA', label:'AYA', kind:'bank'})` persists `Kind` = `bank`; `gasStore.listOptions` returns it; a hand-typed `Bank` reads as `bank`.
- One `sync` call pushing a mixed guided group `[SALE, PAYMENT]` with `dueDay` and a `list` entry with `kind` through the real handler: accepted, no quarantine, the Ledger block
  27 wide, the Lists row with its Kind, the lock held at every Ledger write (the run_gas.js:1148 pattern).
- `fake_gas`: no new member expected (`getMaxColumns`, `insertColumnsAfter` are modelled, fake_gas.js:379-384); if one is needed it joins `FAKE_GAS_MEMBERS` and run_gas's copy
  (:198-230) and is named in the report.

### 7.4 poc/run_sync.js and poc/run_app.js (appended)

- run_sync: a reference phone pushes a guided mixed group with `dueDay`: one entry, `ok`, no OVERPAID flag, the server rows carry `dueDay`; a second phone pulls them with
  `dueDay`; a `group` whose SALE row has `dueDay '2026-13-40'` is quarantined `malformed`; a `list` entry with `kind 'bank'` is applied and the next `lists_json` carries `n`; with
  `kind 'x'` it is quarantined `malformed`; an old-shape entry (no kind) is applied as before.
- run_app: `appInputModeFor` of the five sale states (`sale_buyer`/`sale_phone`/`sale_due` → `'text'`, `sale_part`/`sale_bank` → `'number'`, `kind 'sale'` → null) — this check is
  red today because the purposes are not produced yet (it drives the flow on the real app store to obtain them); a guided mixed sale on the real app store with
  `world.settings.sale_flow = 'steps'` after `syncNow('settings')`: one outbox entry of kind `group` with two txs, SALE first with a receipt number, PAYMENT without; the per-device
  pref `setting:sale_flow = 'quick'` makes the next `S|id|1` commit at once on that phone while the server says `steps`; the `sale_due` text bar sends `dd.mm.yyyy` from the date input.

### 7.5 Existing checks that change (named here, D9), and why the rest stay green

| File:line | Today | Change | Why |
|---|---|---|---|
| poc/run_lists.js:703 | `Object.keys(b.row).length === 26` | `=== CFG.LEDGER_COLS.length` | `newTx` always carries `dueDay` (decision 5) |
| poc/run_gas.js:423, :426, :427 (`defaultLists`) | rows of eight cells | append `''` (the blank Kind) to each row | the seed writes `header.length` cells (gas_store.js:297) |
| poc/run_gas.js:456 | `c.cols === 8` | `c.cols === CFG.LIST_COLS.length` | same |

Everything else stays untouched and green: run_scenario.js (327) and run_round4.js (296) commit through `S|id|n` on worlds seeded by `seedSimWorld`, which sets `sale_flow 'quick'`
(decision 9) — including run_round4.js:1965-1967 "START + one tap still records a one-piece cash sale; nothing is asked before the commit" and run_scenario.js:750-755; the card-shape
checks (run_scenario.js:60, :431; run_app.js:147-152) because `cardKeyboard` is unchanged; run_lists.js:592/:869/:1003 and run_gas.js:1094-1098 because rows without a kind keep their
exact shape and compact string; run_gas.js:439-440, :466-467 and run_lists.js:918 because they iterate `CFG.LIST_COLS` and `lists_note_kind` exists; run_gas.js:1148 because it reads
`CFG.LEDGER_COLS.length`; run_app.js:627-632 and :699-710 (the round-4 ➕ and split on the app store) because that world is `quick`; the sync suites because `dueDay` is optional in
validation and the checksums ignore it.

### 7.6 Manual browser checks (Node cannot run them; listed for the orchestrator)

The built simulator: login as Seller shop 1, the sell tour end to end in Telegram and in the app frame (the keypad opens on the part screen, the text bar on the buyer screen, the
date input on the typed-due screen); the laptop's Lists tab edit (rename an account, set Kind bank) is seen on the next Telegram how-paid screen and in the frame after `🔄`;
`⏩ +1 ရက်` eight times shows the dated credit in the 21:00 summary; the `sale_flow` switch flips both devices; the headless autopilot `?login=sister&device=app&tour=sell`
loads with an empty `SIM_ERRORS`.

---

## 8. Build steps and file ownership

Nobody edits a file outside their step's list; a needed change elsewhere goes into the report (SPEC-round-4.md:918).

1. **Model** (first, alone): `core_config.js`, `core_burmese.js` (the three date functions moved in), `core_orders.js` (the five functions moved out, nothing else),
   `core_ledger.js` (3.2), `core_messages.js` (every key of 3.5), `core_report.js` (3.6), `core_sync.js` (3.7), `poc/sim_ports.js` (`listOptions` kind, `setListRow`),
   `poc/sim_seed.js` (`sale_flow: 'quick'`), `poc/run_lists.js` (7.2), `poc/run_sync.js` (7.4). Checker: `node poc/run_lists.js`, `run_sync.js`, `run_scenario.js`, `run_round4.js`,
   `run_app.js` all green (the last three unchanged and still green prove the quick default).
2. In parallel after step 1:
   - **Bot**: `core_bot.js` (3.1), `core_messages.js` (additions only), `poc/run_round5.js` (new, 7.1). Checker: run_round5 ≥ 120 checks, 0 failed; run_scenario and run_round4 unchanged green;
     every callback under 64 bytes; `npx acorn@8 --ecma5` on core_bot.js (the orchestrator's convention, map-glue L).
   - **Google glue**: `gas_store.js`, `gas_setup.js`, `gas_sync.js`, `gas_main.js` (no change expected), `poc/fake_gas.js` (only if a member is missing), `poc/run_gas.js` (7.3 and the three
     named lines). Checker: `node poc/run_gas.js` 0 failed; `node tools/bundle_gas.js` parses.
3. **App** (after the Bot step): `app/app_ui.js` (the date input, `data-cb` on keyboard buttons), `app/app_i18n.js` (`ui_date_pick`), `app/README.md`, `poc/run_app.js` (7.4), `poc/run_lists.js`
   (the three named-line edit is step 1's; none here). Checker: `node poc/run_app.js` 0 failed; `node tools/build_app.js` builds; the ES5 parse of the two app files.
4. **Simulator v2** (after Bot and App): `poc/sim_ui.js`, `poc/simulator.template.html`, `poc/build_simulator.js`, `poc/sim_tours.js` (new), `app/dev/index.html` (a `sale_flow` checkbox
   beside `appVoice`). Checker: `node poc/build_simulator.js` writes one file; the manual checks of 7.6; the headless autopilot loads with no page error.
5. **Docs** (last, alone): `apps-script/README.md` (the Settings `sale_flow` row, the `Kind` column, the DueDay column and the migration order of 4.4), `app/README.md`, `docs/USER-GUIDE.html`,
   `POS-PROJECT-PLAN.md` Appendix F.

Parallelism: 2-Bot and 2-Glue touch disjoint files; 3 needs the Bot's flow to exercise `run_app`; 4 needs 2 and 3 (the frame bundle is the app).

---

## 9. Not built (deliberately), and open questions for the orchestrator

- A count-plus-changed-price combination (💬 still sells one piece at the typed price, as today); a per-line discount on the summary.
- Attaching a buyer, converting to credit, changing the method or splitting AFTER a guided sale from the sold card (D3); undo and re-sell is the correction; the functions stay for
  `quick`, voice, orders and tests.
- A "due soon" line for sale credits in the 21:00 summary (orders have one, core_orders.js:479-483); only the overdue line is added.
- The app's own settings-screen switch for `sale_flow` (the per-device pref exists, app_store.js:341-344, and is tested through `setPref` in 7.4, but no UI).
- `onEdit` on the Customers tab bumping `Rev`/`UpdatedAt` so a laptop-typed phone reaches phones at the next pull instead of the daily full-masters pull (one branch in gas_main.js:109-121
  plus `gasSyncCounters.nextRev`, gas_sync.js:98). Recommended for a later round; the simulator fakes it in 6.2.
- Asking the kind on the other ➕ paths (PM, EM, SXM, ODM, OXM, AC); they create wallets, the laptop corrects.
- A second account in a mixed payment (two wallets, no cash); splitting a PAYMENT or DEPOSIT; a due day on a quick-mode or voice credit (the laptop may type it into the Ledger's
  `DueDay` cell — the tab is protected with a warning only, gas_setup.js:83-84; the readers would honour it).
- `isEnrolled` on the bot's sync port (`gasSyncBotPort`, gas_sync.js:371-377, has none; `enrolledInApp` core_bot.js:3402-3404 is therefore always false): in the simulator both
  devices of a login sell; unchanged.
- A page-level ES5 or invisible-character scanner (map-glue L): the acorn run stays the orchestrator's convention.

Open questions: (1) should `btn_no_name` be offered at all on a sale above a threshold (the owner wants contacts), or always as decided here; (2) should the undated and the dated
overdue credits share one summary line (this design keeps the undated line bit-identical and adds a second); (3) whether the simulator's Burmese tour sentences are reviewed by the
family before the artifact is shared.
