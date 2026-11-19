# SPEC round 5, revision 2 (binding): the guided sale, DueDay, Kind, sale_flow, simulator v2

Date 2026-11-12 (revision 2 of the 2026-11-11 spec). This file is the contract for the build of POS-PROJECT-PLAN.md
section 16. Where the plan, the brief (`BRIEF.md`), a design (`design-seller.md`, `design-owner.md`,
`design-risk.md`) or a review (`review-ledger-sync.md`, `review-bot-app.md`, `review-sim-tests.md`) differs from this
file, this file wins. Background facts with line numbers: `map-sale.md`, `map-app.md`, `map-sim.md`, `map-glue.md`
(same folder). Line numbers below are those of the tree on 2026-11-12, round 4 built and unpublished (no source file
changed since 2026-11-11).

## Revision 2.1 (2026-11-12, after step 1)

- 8.6 gains a sixth allowed edit: run_gas.js:557's expected rows get the ninth `''` cell (the step-1 builder proved
  the check cannot go green otherwise; it is the same change as :421-427).
- run_gas.js:530 ('a Lists tab that lost a header cell gets the column back'): no test edit. `ensureColumns`
  (gas_setup.js) must put a missing header name back into its blank cell instead of writing it after the last
  non-empty cell (today it would overwrite `Kind`); step 2 fixes the code.
- Step 1 added helper globals beyond 3.4's list (`msgTemplate` in core_messages.js; `saleSoldCard`, `saleBuyerScreen`
  and the screen helpers in core_bot.js; `DUE_COL_HEADER`, `creditDueCell`, `receiptDueLine` in core_report.js) and one
  state field `acct` ('bank' | 'wallet' | 'all', the account-screen filter chosen on Q2). A sold card is never edited by
  a late ✖️ or a stale tap (ignored, or `expired` as a new message); ⏮ on the look-alikes screen returns to Q1; a
  transfer part below the total sets `mixed` back to true.
- poc/sim_mock_ai.js (orchestrator): a spoken cash part on the transfer-part screen (awaiting `sale_step`) carries its
  method, as on the round-4 split screen.

## Revision 2: what changed and why

Every finding of the three reviews was checked against the code; all 45 are applied, with the variants named here.
The decisions D1-D9 stand unchanged.

- **Caption-aware edits (B1).** Every guided screen is edited with the `isCaption` of the message it sits on;
  `editOrSend` gains a sixth argument, `creditDeposit` gains `isCaption`; `bench()` records every edit's flag and one
  check compares it with the target message's `photo` (1.0, 3.4, 8.1 step 24).
- **Flow routing (M1, M2, M7, M9).** Every exit of the buyer screens goes through `saleNext` (Q5 when `needBuyer`,
  Q2 otherwise); an account named through ➕ goes to Q3c when the payment is mixed; the ➕ prompt (and every other
  nested prompt) carries the back button of the screen it was opened from, so there is no virtual `add` step;
  `needBuyer` is an answer of Q4 and is cleared with `paid`, never when the buyer screen is re-shown (1.2, 3.4).
- **Cancel (M3)** clears only a state that belongs to the tapped message and item; a ✖️ on an older screen marks
  that screen `expired` and leaves the live state alone (1.0, 3.4).
- **Typed numbers (M5, m15)** are consumed at the count and amount-now steps without ✏️ (and a typed date at the
  due screen); `saleText` returns `true` explicitly; a spoken number does the same (1.0, 3.4).
- **Six answers everywhere (M8, m21).** The how-paid screen lists wallets singly only while the whole screen fits
  six answers; otherwise one `btn_kind_wallet '📲 Pay အကောင့်'` row opens the wallets screen. The account screen shows
  at most five accounts plus ➕, or pages of four with `btn_more` (1.2 Q2, Q3).
- **Ledger (L1, L2/F13, L3, L4).** A mixed payment whose bank part is 0 is booked as cash (`payKey`); the list rec
  gets `kind` only when it is a `LIST_KINDS` value (run_sync.js:820 and run_app.js:646 pin the rec keys); the `dueDay`
  validation is one explicit line (a number is malformed); `kind: ''` is "no kind", never a quarantine (2.2, 2.4, 4.3).
- **Sheet glue (L5, L6, L7, L9, L10, L11).** `ensureTab`/`ensureColumns` grow the grid themselves; Credits gets
  `ensureColumns`; `sendDailySummary` refreshes the views first (gas_main.js changes); Day and DueDay are `@` on the
  Credits tab; "a second run changes nothing" is defined; the migration runs `setupSheet` right after the publish (4.x).
- **Seed-true tests (M6/F2, m7, m8/F12, F11).** UNIQUE steps use `S1-0001`/`S1-0004`; the 1,000,000 example stays
  prose; byte counts corrected (`back|due_text` 24, `ph|skip` 18, `S|<item>|n` 13); the state check compares named
  fields; "no second edit" is counted through a listener (3.4, 8.1).
- **Simulator (F1, F3-F10).** A label target matches the button text up to its first `{` (`sim.buttonByKey`); the
  tour highlight is part of rendering (`S.tour.hot` in the page, `win.SIM_HOT` in the frame, the stepper's sell button
  carries `data-cb`); Reset drops every frame; the demo clock is an offset (`world.clockOffsetMs`), the suites keep
  `nowOverride`; tours may switch login/device per step; `check_simulator.js` refuses `<!--`; step 4 starts with a
  probe artifact; the `SIM_TOUR_MSG` citation is `cust_find` :150 (5, 6, 8.8, 9).
- **App (M4, m1, m20, F5).** The keypad is titled with the question line (`appQuestionLine`), reopens per prompt
  (`appKeypadKeyFor`), the phone step uses `inputmode=tel`, the stepper's sell button has `data-cb` (5, 8.5).
- **Smaller UX fixes (m2-m6, m10-m14, m16-m19).** Digits are never a name, partial phone matches are offered, a
  known phone is never duplicated, a sold-meanwhile piece is noticed at the first tap, the grid and the price prompt
  store their message id, recents and accounts key on `item.shop`, a sold card is never edited to `expired`, a spoken
  cash part at Q3c is converted, two new keys replace the 💳 and `(ပေးငွေ …)` wordings (`sale_ask_paid`,
  `sale_ask_split_account`), `sale_bad_amount` carries a back row, the menu taps that keep the state are named, a
  yearless past date is refused and the due day is bounded (`CFG.SALE_DUE_MAX_DAYS`), a price below 1 is refused, 💬
  from the grid keeps the grid, `credit_done`'s `paid` is cash + payments + applied.
- **Stated, not changed (L8).** On the Sheet the buyer row and the ledger group are two writes; a stray Customers row
  is harmless (2.6).

How this spec was merged (unchanged from revision 1): the screens follow `design-seller.md`, the callback shape, the
stale-tap rules, the optional `Kind` shape, `listFindByLabel` and the simulator build follow `design-risk.md`, the
ledger contract (the seven-outcome table), the 🔢 hint row, the `cust_find` line, the "digits are never a name" rule,
the due column of the three credit reports and the migration order follow `design-owner.md`. Section 10 lists what is
left out.

Round 4 and round 5 ship together: nothing is published until step 4 of section 9 is done.

## 0. Owner's direction and decisions (binding)

The owner's words (BRIEF.md:9-20): the simulator must show everything (logins, the owner's and the sellers'
views, phone and laptop, measurements, stocking, expenses); the sale must be guided step by step, one set of
buttons at a time (scan > count > buyer with contact > paid 100 % by one method or mixed > cash / bank transfer /
wave / QR > which account > full or deposit > how much and when the rest is paid), because many options on one
screen confuse the sellers; voice is not a focus.

D1-D9 of BRIEF.md:28-76 are binding as written, with these refinements (each named by a judge or a reviewer):

- **D1** One question per screen, at most six answer buttons, then one back row. The back row is
  `[btn_back '⏮ နောက်ပြန်' | btn_cancel '✖️ မလုပ်တော့']` (core_messages.js:335, :32): the brief's `↩️` is
  `btn_undo '↩️ မှားသွားတယ်'` (:27), which sits on the card that follows the summary. The six-answer rule counts
  choices: the ၂..၉ count grid is one number question and keeps its eight digits. Every other screen counts every
  button above the back row, ➕ and ▶️ included (1.2 Q2 and Q3 say how the count is kept).
- **D2** The step order is the owner's. "Full now or part now" and "how much now" are ONE screen whose text ends
  with `confirm_ask 'မှန်ပါသလား?'` (:69) and whose first button `✅ အကုန် {total}` is the committing tap
  (a dedicated callback `SC|<item>|ok`, section 1.2 Q4); the explicit summary screen exists on the part path and
  after a typed amount. A bargained price (💬) leads to the count, not to a one-piece sale.
- **D3** One write at ✅ (`commitSaleGroup`, section 2.2); the buyer is created at ✅ too (on the Sheet as its own
  write just before the group, 2.6); the sold card carries undo, receipt, 💰 while owed, the 🔢 number hint when an
  account was created inside the sale, and 📱 for a buyer without a phone. No method, credit, customer, split or ➕
  buttons on it.
- **D4** `DueDay` is the 27th Ledger column, on the SALE row of a part-paid or unpaid sale; Credits gains
  `DueDay` and `Overdue`; the 21:00 summary (which refreshes the Credits tab first), the receipt, the PDF and the
  three credit reports read it.
- **D5** Settings `sale_flow` = `steps` (default in code and in setupSheet) or `quick`. `seedSimWorld` sets
  `quick`, so every existing suite, the dev page and today's simulator keep the one-tap card; `run_wizard.js`
  and simulator v2 set `steps`.
- **D6** `Kind` is present on a normalised list row only when the cell holds `wallet` or `bank`; a blank Kind is
  a wallet, the legacy key `BANK` is a bank by name. ➕ on the how-paid screen (and on the account screen) asks the
  kind AFTER the name and writes the Lists row only when the kind is known; an existing label skips the kind question.
- **D7** Voice as today. Six routing lines let a spoken name, phone, date or number land in the guided step it was
  spoken in (section 3.4); nothing else is built on voice. The simulator moves the phrases behind `<details>`.
- **D8** Simulator v2 = D8's list exactly (login, device bar, the Sheet with Dashboard, Lists editable, Ledger,
  Customers, Credits, Deposits, Orders, Measurements, Errors, the app at laptop width, "what can I do" tours),
  plus a clock control and a `sale_flow` switch. No Devices tab, no Settings tab, no editable Customers.
- **D9** Kept. The existing checks that may change are the five named in section 8.6, each with its label.

Ground rules carried over from SPEC-round-4.md section 0, still binding: `apps-script/core_*.js`,
`app/app_*.js` and `poc/sim_*.js` are ES5 (`var` and `function`; no let/const, arrows, classes, template
literals, defaults, spread, destructuring, for-of, `Object.assign`, `Math.imul`, `includes`, `find`,
`startsWith`, `padStart`, `repeat`); one global scope, every new name grepped across `apps-script/`, `app/`,
`poc/` before it is added; load sets (core_ledger.js calls nothing of core_orders.js, core_sync.js, core_bot.js;
core_sync.js nothing of core_orders.js, core_bot.js; core_bot.js calls core_orders.js only behind
`ordersEnabled`/`typeof`, because run_sync loads core_bot without core_orders, run_sync.js:16-20); callback data
at most 64 bytes, every committing callback in `MUTATING_ACTIONS`; the Ledger stays append-only; the script
lock through `gasLocked`; no new file under `apps-script/`; `app/config.js` and `tools/publish*.js` untouched;
no new button text contains `ငွေသား`, `KBZPay`, `WavePay` or `ဘဏ်လွှဲ`, none starts with `🏦 ` (run_lists.js:919-921
checks the round-4 keys, run_wizard.js checks the round-5 keys); a committed card is never edited into a
question; the actionable screen is always the last bot message of a reply; `apps-script/dist/`, `app/dist/`,
`poc/dist/` are build outputs. Backup before this round: `C:\Users\USER\Desktop\Noel-backup\pre-round5`.

Suite counts measured on 2026-11-11 before this round (`node poc/run_*.js`): run_scenario 327, run_round4 338,
run_lists 236, run_gas 249, run_app 186, run_sync 307, all `0 failed`. With this spec built, every one of them
still ends `0 failed`; the only existing checks whose code changes are the five of section 8.6.

## 1. The guided sale: screens

### 1.0 Rules every screen follows

- **Mode.** `saleFlow(ports)` (core_config.js, section 3.1) reads Settings `sale_flow`: `'quick'` when the value
  is the word quick in any case, else `'steps'`. Everything in this section is `steps`; `quick` is today's path
  unchanged (1.6).
- **One message.** The flow lives in the message the seller tapped: each screen edits it in place with the
  `isCaption` of that message (`ports.chat.editMessage(chatId, msgId, text, kb, isCaption)`; `handleCallback`
  derives it, `isCaption = !!cq.message.photo`, core_bot.js:425, and every seeded or photographed item card IS a
  photo message, :235-236, which `editMessageText` cannot edit: gas_telegram.js:52-61 would send a NEW message
  instead). `editOrSend(ports, chatId, msgId, text, kb, isCaption)` (core_bot.js:380-383) gains that sixth
  argument (`!!isCaption`; today's callers pass nothing and keep `false`). A typed or spoken answer has no tapped
  message: the next screen is a NEW message (`msgId` null) and `state.msgId` moves to the id `sendMessage`
  returned (`{messageId}`, sim_ports.js:299, app_ports.js:99; `askMeasQuestion` already relies on it,
  core_bot.js:3188-3189); edits of that text message later carry `isCaption false`, which the next tap supplies.
  The app shows only the latest bot message (app_ui.js:352, 468), so both cases show the right screen.
- **Layout.** Lines 1..n: the header block (1.1). Last line: the one question. Then the answer buttons (one per
  row when they are sentences or account names, two or three per row when short), then the back row
  `[btn_back → SS|<item>|back|<step> | btn_cancel → SS|<item>|z]`, always both, always last. On the first screen
  of a flow ⏮ does what ✖️ does.
- **Cancel** `SS|<item>|z` (`saleCancel`). It clears a state only when that state belongs to the tapped message:
  the live sale state (`saleStateOf`, 3.4) is for this item and its `msgId` is null or equals the tapped
  `msgId`, or the live state is the price prompt `D` opened from this item's card (`await_number sale_price`
  for this `itemId` with no `saved`). Then `clearState` and the tapped message is edited into
  `cardText(fresh) + cardKeyboard(fresh)`: nothing was written, the seller lands where a scan lands. With no
  live state at all the tapped message becomes the card as well (nothing to clear). Otherwise (a live state of
  another flow, or a newer screen of this flow) the tapped message is edited to `expired` and the live state is
  untouched, as rule (b) below. `Z` keeps its meaning everywhere else (clear state, `cancelled`,
  core_bot.js:530-533) and is never emitted on a guided screen (in the app a `cancelled` message is a dead card
  with no keyboard and no scanner, map-app 16.2).
- **Back** `SS|<item>|back|<step>` (`saleBack`): only when the sale state's step is `<step>` (rule (c) below;
  `saleStateOf` looks through a nested prompt); pops `state.hist`, deletes the draft fields the re-shown step
  owns (table in 3.4), redraws that step in place. With an empty `hist` it is a cancel. Skipped screens were never
  pushed, so back never lands on one. A nested prompt opened FROM a screen (✏️ အခြား on Q4, ✏️ ရိုက်မယ် on the grid,
  💬 on the grid, ➕ on Q2 or Q3) carries the back row of the screen it was opened from (`back|paid`, `back|qty`,
  `back|method`, `back|account`): that back restores the saved sale state and redraws that screen with its
  buttons, nothing popped. There is no step called `add`.
- **Stale and expired taps** (`saleGuard`, 3.4): (a) no sale state for this item (expired after
  `CFG.STATE_TTL_SEC` 1800 s, a scan in between, a finished sale): the tapped message is edited to `expired`
  ('⏱ သက်တမ်းကုန်သွားပါပြီ။ ထပ်ပြောပေးပါ။', :71) and a fresh item card is sent (`sendItemCard`), because every
  callback carries the item id; when the tapped message is a committed card (`isCommittedCard`,
  core_bot.js:1405-1407, 600 s) OR its text or caption contains `t(ports, 'sold_done')` up to its first `{`
  ('✅ ရောင်းပြီး', :52; `cq.message` is passed in for this) the card is left alone and `expired` is a new
  message: a sold card is never destroyed, however late the tap; (b) a tap on an OLDER message than the live
  screen (`state.msgId` set and different: the ၂..၉ grid left behind, an earlier screen after a typed answer moved
  the flow): that message is edited to `expired`, the live state and the live screen are untouched (a different
  text, so no "message is not modified" Errors row); (c) a tap on the live message whose step letter no longer
  matches `state.step` (a second tap racing the redraw, the same back button twice): ignored without an edit, the
  message already shows the current screen. `startGuidedSale` returns without an edit when the state is already
  this item's first step on this message with the same count (a double ✅ ရောင်း ၁ or stepper tap makes no identical
  edit and no Errors row). Every screen the flow sends as a new message (the grid, the price prompt, every
  typed-path screen) stores its id in `state.msgId` (or the nested prompt's `msgId`), so rule (b) can tell an old
  grid from a newer one.
- **Double tap on ✅.** `SC` joins `MUTATING_ACTIONS` (120 s guard, core_bot.js:417-418, 428-432). `S` is exempt
  from that guard in `steps` mode (it writes nothing there, and "back to the card, then ✅ ရောင်း ၁ again" within
  two minutes must work): `if (MUTATING_ACTIONS[action] && !(action === 'S' && saleFlow(ports) === 'steps'))`.
  After the commit the state is cleared and the card is `markCommittedCard`ed, so a late second ✅ writes nothing.
- **Typed or spoken text while a screen waits for a tap** (`saleText`, 3.4; the spoken twin in `handleIntent`):
  a number feeds the step when it takes one: the count (step `qty`, the grid: the Q0 rules), the amount now
  (step `paid`, Q4 before ✏️: the Q4 typed rules), the price and the transfer part (already `await_number`); a
  name or phone feeds the `buyer`/`name`/`phone` steps; a date feeds `due_text` and, when `parseDayText` reads
  it, the `due` screen too; `saleText` returns `true` for everything it handled (an edit returns `undefined` in
  all three chat ports, so the return value is explicit, the `|| true` convention of core_bot.js:692, :802).
  Anything else at a button-only step falls through to today's paths (a typed tag id opens its card and clears
  the state, core_bot.js:652-653; the rest reaches the AI as in the expense flow; `buildAiContext.awaiting` is
  `'sale_' + step` by the existing rule at :623, no change).
- **A scan during a flow** (`openTag`, :122-124) clears the state and shows the new card: the flow is abandoned,
  nothing written. `/start` and the stateless menu taps (`M|today`, `M|recent`, `M|pay`, `M|cust`, `M|rep`,
  `M|acct`, `M|help`, `M|app`, `M|devices`, `M|ord`) keep the state (`dropAddState` touches only ➕ and 🔢
  prompts, :2175-2180) and the flow's buttons still work afterwards; the menu taps that open a flow of their own
  (`M|find`, `M|cfind`, `M|exp`, `M|dep`, `M|nb`, `M|meas`; core_bot.js:584, :592, :1812/:1816, :1735) replace
  the state as today, and the guided screen then answers by rule (a).
- **Role.** Seller and owner see the same flow; the owner keeps `V|g` (void) on old cards. Recents and accounts
  are keyed on `item.shop` (the shop the row is written to, 2.2), never on `staff.shop`: the shared owner login
  selling a shop-2 piece sees shop-2 accounts and recents (`afterSaleKeyboard` keys on the row's shop today,
  core_bot.js:282).

### 1.1 The header block

`saleHeader(ports, item, draft)` builds the lines above every question, in this order, each only once its
answer is known:

| Line | Text | Key |
|---|---|---|
| sale | `confirm_sale` '📝 ရောင်း {qty} ထည် · {name} · {amount} ကျပ်' (:61); amount = qty × unitPrice | existing |
| buyer | `customerLabel(c)` (core_bot.js:1474-1476) for a picked buyer; `'👤 ' + newName` (+ ` · ` + `fmtPhone(newPhone)` when typed) for a new one; nothing when 🚫 | — |
| how paid | `sale_line_method` '💰 {method}' with `methodLabel`; mixed: `sale_line_mixed` '💰 {cashMethod} {cash} · {method} {bank}' with cash = total − bankPart until the amount now is known, then paid − bankPart | NEW |
| paid now | `sale_line_paid` 'ပေးပြီး {paid} · ကျန် {owed}' (from the due screen on) | NEW |
| due | `sale_due_set` '📅 ကျန် {owed} · {date}' (`fmtDayMy`) or `sale_due_none` '📅 မသေချာ' (summary only) | NEW |

### 1.2 Screen by screen

Notation: `[a | b]` is one keyboard row. `<item>` is the item id (`S1-0002`). "App" notes say what the phone
shows beyond the plain rows (every core keyboard row renders as flex buttons, app_ui.js:678-687). `shop` below
is always `item.shop`.

**E. The item card** (unchanged text and buttons, `cardText`/`cardKeyboard`, core_bot.js:181-230).
In `steps` mode `S|<item>|1` (the card's `btn_sell_one '✅ ရောင်း ၁'` / `btn_sold '✅ ရောင်းပြီး'`, and the app's
stepper `S|<item>|N`, app_ui.js:48-53) writes nothing: `startGuidedSale(... qty ...)` edits the card into **Q1**
with `draft.qty = clampQty(N)`, `hist []` and `msgId` = the card's id. `handleCallback` loads the item fresh for
every `ITEM_ACTIONS` tap (:434): a UNIQUE piece with stock ≤ 0 at this first tap (sold on another phone while the
card was open) is answered at once with the **S✖** screen (`cardText(fresh)` + `sale_gone` + `cardKeyboard(fresh)`,
no state), not after four questions. A UNIQUE piece in stock skips the count (D2) with no code. The SKU card
keeps `btn_qty '🔢 အရေအတွက်'` → `Q|<item>` and `btn_discount '💬 စျေးလျှော့'` → `D|<item>` (D2's secondary row for
bargaining). App: the SKU card keeps its stepper and `ui_sell_n '✅ ရောင်း {n} ထည်'` (app_i18n.js:46).

**Q0. The count grid** (`Q|<item>`, SKU only). In `steps` mode `Q` sends a NEW message through
`askQty(chatId, uid, item, ports, {steps: true})` (text `ask_qty '🔢 ဘယ်နှစ်ထည် ရောင်းလဲ?'` (:18) + `id · name`,
rows `[၂ ၃ ၄ ၅] [၆ ၇ ၈ ၉]` → `SS|<item>|q|<n>` (`CFG.QTY_GRID`), last row
`[btn_type_qty '✏️ ရိုက်မယ်' → QN|<item> | btn_discount → D|<item> | btn_cancel → SS|<item>|z]`) and sets the
state `{kind:'sale', step:'qty', item, msgId: <the grid's id, from askQty's {messageId}, core_bot.js:254>, hist: [],
draft: {}}`. In `quick` mode `askQty` is byte-identical to today (run_scenario.js:431). `SS|<item>|q|<n>` →
`draft.qty = n`, `hist ['qty']` → **Q1**, editing the grid message. A typed number on the grid (no ✏️) is read
by `saleText` with the same rules as below. `QN|<item>` in `steps` mode sets
`{kind:'await_number', purpose:'sale_qty', itemId, saved: <the sale state at step qty>}` and edits the grid to
`ask_qty_number '✏️ အရေအတွက် ရိုက်ပါ (ဥပမာ 4)'` (:19) + `[btn_back → SS|<item>|back|qty | btn_cancel → SS|<item>|z]`;
the typed number (1..`CFG.MAX_SALE_QTY`, else `bad_qty` (:20) with that back row and the state kept, as :725-728)
→ **Q1** as a new message. App: the keypad opens by itself for `await_number` (app_ui.js:758-760).

**Q0b. A changed price** (`D|<item>`). From the CARD (no sale state): state
`{kind:'await_number', purpose:'sale_price', itemId, msgId: <the prompt's id>}` and the prompt `ask_sale_price`
(:82) as a new message with `[btn_cancel → SS|<item>|z]` in `steps` mode (`Z` and no `msgId` in `quick`, as today
:457-460). From the GRID (a sale state at step `qty` is live): the grid is a question screen, so `D` EDITS it in
place to `ask_sale_price` + `[btn_back → SS|<item>|back|qty | btn_cancel → SS|<item>|z]` and sets
`{kind:'await_number', purpose:'sale_price', itemId, saved: <the sale state at step qty>}`: ⏮ brings the grid
back, the grid never becomes a stateless screen. The typed or spoken price `n` (`applyAwaitedNumber` case
`sale_price`, `steps` branch → `saleFromPrice`): n < 1 → `ask_sale_price` again as a new message with the same
buttons, the state set again (the `bad_qty` pattern); UNIQUE → **Q1** as a new message with `qty 1, unitPrice n,
priceChanged true`; SKU → the grid as a new message with first line `sale_ask_qty_price '🔢 ဘယ်နှစ်ထည် ရောင်းလဲ?
({price} ကျပ် နဲ့)'` (NEW) instead of `ask_qty`, the same `SS|<item>|q|<n>` digits, last row
`[btn_type_qty → QN|<item> | btn_cancel → SS|<item>|z]` (no 💬: the price is known), state `{kind:'sale',
step:'qty', item, msgId: <the new grid's id>, hist: [], draft: {unitPrice: n, priceChanged: true}}`. So "three
pieces at a bargained price" is one sale (D2), which today's `D` path is not (:713-721).

**The buyer screens exit through `saleNext`.** Every exit of Q1, Q1b, Q1c and Q1d (a button, a typed or spoken
name, a phone, a skip) calls `saleNext(ctx, state)`, which is **Q5** when `draft.needBuyer` and **Q2** otherwise.
No buyer screen names Q2 or Q5 directly.

**Q1. Buyer** (D2). Text: header + `credit_ask_customer '👤 ဝယ်သူ ဘယ်သူလဲ?'` (:98) + second line
`cust_find '🔍 နာမည် ဒါမှမဟုတ် ဖုန်းနံပါတ် ရိုက်ပါ'` (:150), so the seller learns that typing searches.
```
[🚫 နာမည် မရှိ]                           → SS|<item>|b|none        NEW btn_no_name; absent when draft.needBuyer
[👤 ဒေါ်မြင့် · +95 912 345 678]           → SS|<item>|b|C-0001      recentCustomers(ports, item.shop, 4), customerLabel
[👤 ဒေါ်ခင်]                               → SS|<item>|b|C-0002
[✏️ နာမည်အသစ်]                             → SS|<item>|b|new         btn_new_customer (:45)
[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]               → SS|<item>|back|buyer | SS|<item>|z
```
When the flow comes back here for a part payment (`draft.needBuyer`, from **Q4**), the 🚫 row is absent and the
line `sale_need_buyer 'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်'` (NEW) stands above the question. `none` → `saleNext`;
a customer id → `draft.customerId` → `saleNext`; `new` → **Q1b**.
Typing here (`saleBuyerNamed`): a text that is only digits and phone punctuation (the regex of
`addListOptionByLabel`, core_ledger.js:718: `^[0-9၀-၉\s.,\-+()\/]*$`), whatever its length, is a PHONE HINT and
never a name: `matchCustomers(ports, text)` (:1370-1374; its phone branch, :1351-1358, returns the exact number
first and partial matches after it when four or more digits were typed): an exact phone → that buyer →
`saleNext`; partial matches only (the last four digits typed) → **Q1c** in its phone form (the matches, no create
button); nobody, or fewer than four digits → `cust_none '👤 မတွေ့ပါ။'` (:151) and Q1 again as a new message,
nothing created. Otherwise the name branch: exact name → that buyer → `saleNext`; look-alikes → **Q1c**; nobody →
`draft.newName = text` → **Q1d**. App: `appInputModeFor` → `'text'` (text bar `ui_text_placeholder '✏️ ရိုက်ပါ'` +
`ui_btn_send 'ပို့'`).

**Q1b. New name** (`SS|<item>|b|new`): edit to header + `ask_name '✏️ နာမည် ရိုက်ပေးပါ'` (:80) + back row
(`back|name`); step `name`. Typed → the Q1 matching (an exact match is used, nothing is duplicated).

**Q1c. Look-alikes**: `cust_pick '👤 "{name}" · ဘယ်သူလဲ?'` (:143), one row per match (≤ 4, `customerLabel`) →
`SS|<item>|b|<custId>`, then, in the name form only, `[✏️ "{name}" အသစ် ဖန်တီး → SS|<item>|b|create]`
(`btn_create_named` :144), back row (`back|buyer`). `create` keeps `draft.newName` (no Customers row yet, D3) →
**Q1d** when `draft.newPhone` is still undefined, else (the screen was reached from Q1d) → `saleNext`. This is
`pickCustomer`'s screen (core_bot.js:1460-1472) without its immediate `addCustomer` (:1465). The phone form (a
partial phone match from Q1) has no create button: digits are never a name.

**Q1d. Phone of a new buyer** (only after a new name). Text: header + `ord_ask_phone
'📞 {customer} ၏ ဖုန်းနံပါတ် ရိုက်ပါ (မရှိရင် ကျော်ပါ)'` (:219, verbatim) with `customer = newName`;
`[btn_skip '⏭ ကျော်' → SS|<item>|ph|skip]` + back row (`back|phone`). The skip is never `Z` (today's phone
prompt skips with `Z`, :1527, which would cancel the sale). Typed: `normPhone` (core_ledger.js:1320-1325) with
fewer than 7 digits → the same screen again as a new message (the order flow's rule, core_bot.js:2427-2428); an
exact match of `normPhone(text)` with an existing customer's phone (`findCustomers`, :1351-1358; ဒေါ်မြင့် holds
`09 123 456 78` in the seed) → `draft.newPhone = normPhone(text)` and **Q1c** in its name form offering that
customer and `btn_create_named` (so a known number is never duplicated); `isValidPhone` → `draft.newPhone =
normPhone(text)`; else kept as typed (`savePhone`'s rule, :1535-1536). Then `saleNext`. An existing buyer without
a phone is not asked here; the sold card offers `phoneRow` (:363-365). App: the text bar with `inputmode="tel"`
(section 5).

**Q2. How paid** (D2, D6). Text: header + `sale_ask_method '💰 ဘယ်လိုပေးလဲ?'` (NEW).
```
[💵 ငွေသား]                                → SS|<item>|m|CASH        btn_cash (:132)
[📲 KBZPay]                                → SS|<item>|m|KBZ         btn_wallet '📲 {method}' (NEW), one wallet per row
[📲 WavePay]                               → SS|<item>|m|WAVE
[🏛 ဘဏ်]                                   → SS|<item>|m|bank        btn_bank_transfer (NEW), only when the shop has a bank-kind account
[💵+🏦 ခွဲပေး]                             → SS|<item>|m|mix         btn_split (:376), only when any non-cash account exists and total ≥ 2
[➕ ဘဏ်အသစ်]                               → LA|pm|SSA|<item>        btn_add_bank (:385)
[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]
```
Wallets and banks come from `payMethodsByKind(ports, item.shop)` (section 3.3; the 12-byte and
`MAX_BANK_BUTTONS` rules of `payMethods` apply). **The six-answer count is the whole screen:** with W wallets,
B = 1 when a bank-kind account exists, X = 1 when any non-cash account exists (the 💵+🏦 row), the wallets are
listed one per row while `1 + W + B + X + 1 ≤ 6`; otherwise the wallet rows are replaced by ONE row
`[📲 Pay အကောင့် → SS|<item>|m|more]` (`btn_kind_wallet`, NEW, the same key the ➕ kind question uses), which
opens the account screen filtered to wallets. So the seeded lists (two wallets, one bank) give
`[💵 ငွေသား] [📲 KBZPay] [📲 WavePay] [🏛 ဘဏ်] [💵+🏦 ခွဲပေး] [➕] [back]` (6); three wallets and a bank give
`[💵 ငွေသား] [📲 Pay အကောင့်] [🏛 ဘဏ်] [💵+🏦 ခွဲပေး] [➕] [back]` (5); four wallets and no bank give
`[💵 ငွေသား] [📲 Pay အကောင့်] [💵+🏦 ခွဲပေး] [➕] [back]` (4). Lower-case arguments (`bank`, `mix`, `more`) are
categories, upper-case ones are keys (`listNormKey` upper-cases pay_method keys, core_ledger.js:326-329), so they
never collide. `CASH` or a wallet key → `draft.method = KEY` → **Q4**. `bank` → **Q3** (banks). `mix` →
`draft.mixed = true` → **Q3** (every non-cash account). `more` → **Q3** (wallets). `LA|pm|SSA|<item>` → **Q2+**.
A total below 2 (a bargained price of 1) has no 💵+🏦 row: nothing can be split.

**Q2+. ➕ an account inside the sale** (D6: the name, then the kind, nothing written before the kind). The ➕ row
sits on Q2 (step `method`) and on Q3 (step `account`). `LA|pm|SSA|<item>` → `askAddOption` with the new resume
code `SSA` (`ADD_RESUME_LIST.SSA = 'pay_method'`, core_bot.js:1334-1335): the screen is edited to `add_ask_pm
'✏️ ဘဏ်/အကောင့် နာမည် ရိုက်ပါ (ဥပမာ KBZ ဦးမောင်)'` (:388) with the back row of the screen it was tapped on
`[btn_back → SS|<item>|back|<saved.step> | btn_cancel → SS|<item>|z]` (`back|method` from Q2, `back|account` from
Q3; never `[Z]`), the sale state kept in `saved` as `askAddOption` does (:1389-1391). ⏮ restores the saved state
and redraws that screen (1.0 Back). The typed name → `finishAddOption` case `SSA`, which calls `listFindByLabel`
(section 3.3) instead of `addListOptionByLabel`: `empty` (digits, an amount) → `add_ask_pm` again, state kept;
an existing label → prefix `add_exists 'ℹ️ "{label}" ရှိပြီးသား · အဲဒါကို သုံးပါမယ်'` (:392), the sale state
restored, `draft.method = key` → **the account step's exit** (below) as a new message; a new label → the sale
state restored with `draft.addLabel = <clean label>`, `saleGo(..., 'kind')` (which pushes the saved step, `method`
or `account`, on `hist`), a new message `sale_ask_kind '➕ "{label}" · ဘဏ် လား၊ Pay လား?'` (NEW) with
`[📲 Pay အကောင့် → SS|<item>|k|wallet | 🏛 ဘဏ်အကောင့် → SS|<item>|k|bank]` (`btn_kind_wallet`, `btn_kind_bank`,
NEW) and the back row (`back|kind` → pops to the screen the ➕ was tapped on, Q2 or Q3, `addLabel` dropped). The
kind tap → `addListOptionByLabel(ports, 'pay_method', draft.addLabel, staff, {kind})` (one Lists row, shared by
both shops), `draft.addedKey = draft.method = key` → **the account step's exit** with the prefix `add_done
'➕ "{label}" ထည့်ပြီး'` (:391). **The account step's exit** is `saleNext` from step `account`, exactly as
`SS|<item>|a|<KEY>` takes it: `draft.mixed` → **Q3c** (the transfer part is always asked), else **Q4**. A store
without `addListOption` answers `add_unavailable` (:393) as a new message at the ➕ tap and the screen keeps its
buttons (today's rule, :1378). The 🔢 number hint comes on the sold card (**S**), never mid-flow (`askListDetail`
replaces the state, :1310).

**Q3. Which account** (`SS|<item>|a|<KEY>`). Reached after `bank` (bank-kind accounts), `mix` (every non-cash
account) or `more` (wallets). Skipped when the filter leaves exactly one account (`startSplit`'s rule, :1169),
except for `more`. Text: header + `sale_ask_account '🏛 ဘယ်အကောင့်လဲ?'` (NEW) for `bank` and `more`;
`sale_ask_split_account '💵+🏦 ဘယ်အကောင့်နဲ့ ခွဲပေးလဲ?'` (NEW: `split_ask_bank` :377 without its `(ပေးငွေ {cash})`,
because nothing is paid yet) for `mix`. Buttons: one account per row, banks as `btn_bank '🏦 {method}'` (:131),
wallets as `btn_wallet`; a button over 64 bytes is skipped (`utf8ByteLength`, :312; with keys ≤ 12 bytes the
longest is 25). **Six answers:** up to five accounts are listed, then `[btn_add_bank → LA|pm|SSA|<item>]` (6 at
most); with six or more accounts the screen is paged: four accounts, `[btn_more '▶️ နောက်ထပ်' → SS|<item>|a|p<n+1>]`
(:217; `p0`, `p1`, … are pages, lower-case so they never meet a key), then ➕ (6); the last page has no ▶️. A
page tap redraws the same step (rule (c) passes: the step is still `account`). Then the back row (`back|account`).
With no bank-kind account the `bank` category is not offered on Q2 at all; the ➕ row is the way to add one.
`draft.method = KEY`; then `saleNext`: `mix` → **Q3c**; else → **Q4**.

**Q3c. The transfer part of a mixed payment** (`mix` only). Text: header + `split_ask_amount
'💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ? ဂဏန်း ရိုက်ပါ (ပေးငွေ {cash} · ကျန်တာ ငွေသား)'` (:378) with cash = the total.
Buttons: `[တစ်ဝက် {half} → SS|<item>|x|half]` (`btn_half` :254, half = round(total / 2)), back row (`back|bank`).
State `{kind:'await_number', purpose:'sale_step', saved: <sale state at step bank>}`, so the typed amount reaches
`applyAwaitedNumber` and the app's keypad opens by itself (as today's split amount screen, run_app.js:707-708).
A typed or spoken `n`: 1 ≤ n < total → `draft.bankPart = n`; n ≥ total → the whole payment is on that account
(`draft.mixed = false`, `bankPart 0`, the method stays the key); n < 1 → `sale_bad_amount
'❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ'` (NEW) with min 1, max total − 1, as a new message WITH this screen's
back row (`back|bank`, `SS|<item>|z`) and the state set again (the `bad_qty` pattern: in the app the latest card
must have a way back). A spoken cash part ('ငွေသား ငါးထောင်', the model answers method CASH) is converted to the
account part, `total − w`, as today's split screen converts it (`splitBankFromCash`, core_bot.js:827-828,
:1262-1268; one line in `handleIntent`, 3.4). Then **Q4**.

**Q4. How much now, and the confirmation of the full path** (D2 refined). Text: header (sale, buyer, how
paid) + `sale_ask_paid '💰 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)'` (NEW: `credit_ask_paid` :97 with the
💰 of `pay_ask_amount` :104 instead of 💳, so a plain cash sale does not end on a credit glyph) + `confirm_ask
'မှန်ပါသလား?'` (:69), so the committing tap is recognisable as a confirmation.
```
[✅ အကုန် 18,000]                           → SC|<item>|ok            NEW btn_paid_all '✅ အကုန် {amount}'   COMMITS, paid = total
[0 | တစ်ဝက် 9,000 | ✏️ အခြား]               → SS|<item>|p|0 | SS|<item>|p|half | SS|<item>|p|other
[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]
```
With a mixed payment the second row is `[fmtMoney(bankPart) → SS|<item>|p|bank]` (only the transfer part now,
the rest owed), then `[fmtMoney(half)]` only while half > bankPart, then `[✏️ အခြား]`; the half button is also
omitted while half < 1. `0`, `half`, `bank` → `draft.paid` → when no buyer yet (`none`): `draft.needBuyer = true`
→ **Q1** (without 🚫) → `saleNext` → **Q5**; else **Q5**. `needBuyer` and `paid` are answers of THIS screen: back
onto the buyer screen keeps them (3.4). `other` → state `{kind:'await_number', purpose:'sale_step', saved: <sale
state at step paid>}`, the message edited to header + `ask_number '✏️ ဂဏန်း ရိုက်ပေးပါ (ဥပမာ 25000)'` (:79) + back
row (`back|paid`); the typed `n` (with or without ✏️: a number typed on this screen before ✏️ takes the same
rules through `saleText`): n ≥ total → `draft.paid = total` → **Q6** (a typed amount never commits; the summary's
✅ does); bankPart ≤ n < total → `draft.paid = n` → the buyer check → **Q5**; n < bankPart or n < 0 →
`sale_bad_amount` with min = bankPart (0 when not mixed), max = total − 1, as a new message with this screen's back
row (`back|paid`, `SS|<item>|z`), state set again. The app's keypad cannot type 0 (OK disabled at 0,
app_ui.js:928-933): the `0` button is the only way to a pure credit, which is why it stays.

**Q5. When is the rest paid** (D4). Text: header with `sale_line_paid` + `sale_ask_due
'📅 ကျန် {owed} ကျပ် · ဘယ်တော့ ပေးလဲ?'` (NEW).
```
[၇ ရက် | ၁၄ ရက် | ၃၀ ရက်]                   → SS|<item>|d|7 | 14 | 30        btn_days '{n} ရက်' (:238), saleDuePresets (3.4)
[✏️ ရက်စွဲ ရိုက် | ❓ မသေချာ]                → SS|<item>|d|type | SS|<item>|d|none    btn_due_type (:240), NEW btn_due_unknown
[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]
```
`n` → `draft.dueDay = addDaysKey(dayKey(now), n)`; `none` → `draft.dueDay = ''`; then **Q6**. `type` → **Q5b**.
A date typed on this screen without ✏️ is read as on Q5b (`saleText`).

**Q5b. A typed date** (`SS|<item>|d|type`): step `due_text`; edit to header + `ord_ask_due_text
'✏️ ရက်စွဲ ရိုက်ပါ (ဥပမာ 30.10.26)'` (:251) + back row (`back|due_text` → Q5). Typed (`saleDueTyped`):
`parseDayText(text, now, {noRoll: true})` (accepts `30.10.26`, `30/10`, Burmese digits and, new, `2026-10-30`,
section 3.2; `noRoll` keeps a yearless past date in THIS year instead of rolling it to next year, core_orders.js:76,
so `5.11` typed on the 12th is refused instead of booking the rest eleven months ahead); null, a day before
today, or a day more than `CFG.SALE_DUE_MAX_DAYS` (365) days after today → `ord_bad_date '❓ ရက်စွဲ နားမလည်ပါ။
ဥပမာ 30.10.26 လို ရိုက်ပါ။'` (:252) + back row, state kept; else `draft.dueDay = key` → **Q6** as a new message.
App: `appInputModeFor` → `'date'` (section 5).

**Q6. Summary** (the part path, and after a typed amount). Text: `confirm_sale`, the buyer line, the how-paid
line, `sale_line_paid`, `sale_due_set` or `sale_due_none` (only while owed > 0), `confirm_ask`.
`[✅ မှန်တယ် → SC|<item>|ok]` (`btn_yes` :28), back row (`back|summary`).

**S. The sold card** (the commit, `SC|<item>|ok`, section 3.4 `saleCommit`). The tapped message is edited (with
its `isCaption`) into `saleCardText(ports, groupId, addedKey)` (3.4): `cardText(fresh)` + `sold_done
'✅ ရောင်းပြီး {qty} ထည် · {amount} ကျပ် · လက်ကျန် {stock}'` (:52), then when they apply `credit_done
'💳 👤 {customer} · ပေးပြီး {paid} · ကျန် {owed} ကျပ်'` (:99, owed > 0; `paid` = `info.cash + info.payments +
info.applied`, the rule `card_buyer` uses at :199, so a mixed part payment prints what changed hands, not the cash
part only as `finishCredit` :1659 does) or `cust_attached '👤 ဝယ်သူ {customer} · မှတ်ပြီး'` (:142, a buyer and
nothing owed), `method_done` (:133, one non-cash account, via `methodLine` :367-370) or `split_done
'💵 {cashMethod} {cash} · 🏦 {method} {bank} · မှတ်ပြီး'` (:379, two rows), `sale_due_set` (a date and owed > 0),
`acct_detail_hint 'ℹ️ {label} ရဲ့ နံပါတ် ထည့်ထားရင် …'` (:403, an account created inside this sale). Keyboard
`afterSaleKeyboard(ports, g, {plain: true})` = `[btn_undo → U|g, btn_receipt → RC|g]` + `[btn_pay → PY|g]` while
owed > 0, then `[btn_acct_number '🔢 နံပါတ် ထည့်' → LD|pm|<KEY>]` when `draft.addedKey`, then `phoneRow(customer)`
(:363-365). No 💳, 👤, 🏦, 💵+🏦 or ➕ (D3). `setLastItem`, `setLastGroup`, `clearState`, `markCommittedCard`.
App: a big card; the two half-width buttons of the first row.

**S+. The buyer holds a deposit.** When the buyer exists, owed > 0 after the write and
`depositsFree(ports, customerId) > 0` (core_ledger.js:1214; the free pool, which is what `applyDeposit` can use):
the card text ends with `credit_use_deposit '📥 {customer} ၏ စရံ {deposit} ကျပ် ရှိပါသည်။ သုံးမလား?'` (:100) and
the keyboard is only `[✅ စရံ သုံးမယ် → CD|<g>|yes|p[|<KEY>] | ❌ မသုံးဘူး → CD|<g>|no|p[|<KEY>]]` (`btn_use_deposit`
:46, `btn_no_deposit` :47; `p` = plain, the optional fifth part is `draft.addedKey`; at most 58 bytes). `yes` →
`applyDeposit` (core_ledger.js:858-873) + `deposit_applied` (:101); both answers redraw with `saleCardText` and
the plain keyboard of **S** (section 3.4 `creditDeposit` with `plain`, editing with the tapped message's
`isCaption`: this card is the photo card), never with the corrective rows.

**S✖. Sold meanwhile.** At the first tap (E) and again at ✅ the item is re-read; a UNIQUE piece with stock ≤ 0
(sold on another phone while the card was open) edits the message to `cardText(fresh)` (`card_sold_out` +
`card_buyer`, :11, :156) + a last line `sale_gone '⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ'` (NEW) with `cardKeyboard(fresh)`;
`clearState`; nothing written. A SKU below zero is written as today (stock is derived; the server flags
`stock_negative`, core_sync.js:798-800).

### 1.3 Tap counts

| Sale | Telegram, after the scan | App |
|---|---|---|
| one piece, cash, no name | ✅ ရောင်း ၁ · 🚫 · 💵 · ✅ အကုန် = **4** | the same 4 (the stepper's ✅ is the first) |
| three pieces, KBZPay, a known buyer | 🔢 · ၃ · 👤 · 📲 KBZPay · ✅ အကုန် = 5 | + + ✅ · 👤 · 📲 · ✅ = 6 |
| a deposit of 100,000 on a 1,000,000 piece in stock, new buyer, two weeks (an example, not a seeded item) | ✅ ရောင်းပြီး · ✏️ နာမည်အသစ် · type · type phone · 💵 · ✏️ အခြား · type · ၁၄ ရက် · ✅ မှန်တယ် = 7 taps + 3 typed | the same, keypad for the amount |
| mixed 10,000 KBZPay + the rest cash | ✅ ရောင်း ၁ · 🚫 · 💵+🏦 · (one account: skipped) · type 10000 · ✅ အကုန် = 4 + 1 typed | the same |

Today: one tap, then up to six more on the after-sale card. `quick` keeps the one-tap card (D5).

### 1.4 Errors, as the seller sees them

| Case | What happens | Where |
|---|---|---|
| the last UNIQUE piece was sold meanwhile | **S✖** (at the first tap or at ✅) | `startGuidedSale`, `saleCommit` |
| the item was deleted | `tag_not_found` (:8) through `ITEM_ACTIONS` (SS and SC join it) | `handleCallback` :434-436 |
| a tap on an older screen | that message → `expired`; the live screen untouched | `saleGuard` (b) |
| ✖️ on an older screen | that message → `expired`; the live state untouched | `saleCancel` |
| a second tap on the live screen racing the redraw | ignored, no edit | `saleGuard` (c) |
| the state is gone (30 min, a scan, a finished sale) | tapped message → `expired`, a fresh item card follows | `saleGuard` (a) |
| ✅ tapped twice | the second tap is dropped (120 s guard); later: `expired` as a new message, the card kept (within 600 s by `isCommittedCard`, for ever by the `sold_done` text) | `MUTATING_ACTIONS`, `saleGuard` (a) |
| a typed amount out of range | `sale_bad_amount` with the screen's back row, state kept | `saleNumber` |
| a typed date unreadable, in the past or over a year ahead | `ord_bad_date`, state kept | `saleDueTyped` |
| a typed price below 1 | `ask_sale_price` again, state kept | `saleFromPrice` |
| a typed phone too short | `ord_ask_phone` again | `salePhoneTyped` |
| a typed phone somebody has | Q1c offering that buyer, nothing duplicated | `salePhoneTyped`, `saleBuyerNamed` |
| a typed phone nobody has, or 1-3 digits | `cust_none` + Q1 again, nothing created | `saleBuyerNamed` |
| ➕ with a store that cannot add | `add_unavailable` as a new message, the screen keeps its buttons | `askAddOption` (:1378) |
| ➕ name that is only digits or an amount | `add_ask_pm` again | `finishAddOption` (`listFindByLabel` `empty`) |

### 1.5 Undo and receipt

`U|g` → `undoGroup` (core_ledger.js:905-930) mirrors every live row of the group (the SALE and, when mixed, the
PAYMENT) within 30 min; stock comes back; owed nets to 0 (`openCredits` sums the negative PAYMENT mirror into
`paid[refGroupId]`, :1130); the card becomes `undo_done` (:57) + `cardText`. `RC|g` → `buildReceipt`/`receiptText`
(core_report.js:322-369): mixed methods print as ' (ငွေသား 8,000 · KBZPay 10,000)', `receipt_transfer` while
owed > 0, and a new line `sale_due_set` after it when the SALE row carries a `DueDay` and owed > 0; the PDF
(`receiptReport`) prints the same line in its footer above `receipt_thanks` (section 3.5). `V|g` unchanged.

### 1.6 `quick` mode (D5)

`sale_flow = quick`: `S|<item>|n`, `QN`, `D` commit as today and show `afterSaleKeyboard`; `askQty` has no 💬
row and keeps `Z`; no `SS|`, `SC|` or `LA|pm|SSA` button is ever emitted; the `tap:` guard keeps `S`. The switch
is a Settings row on the laptop; phones follow at their next pull (`syncSettingsFor` copies every row,
core_sync.js:915-929); a phone may override with the pref `setting:sale_flow` (app_store.js:341-344, not drawn).

## 2. Ledger and data model

### 2.1 `DueDay`

- `CFG.LEDGER_COLS` gains `'DueDay'` as its 27th, last name (core_config.js:132-134). Both Sheet writers are
  positional by CFG order (gas_store.js:385, gas_sync.js:180) and `ensureColumns` appends at the right-hand end
  (gas_setup.js:257-265), so last is the only safe place; Seq, ReceivedAt, DeviceID stay adjacent for `stampSeq`
  (gas_sync.js:193-197).
- Value: `yyyy-mm-dd` text (like `Day`) on the SALE row of a group that still owes at commit time and whose
  seller chose a date; `''` otherwise (full payment, "not sure", every other row type, mirrors, old rows).
- `newTx` adds `dueDay: f.dueDay || ''` as its 27th field (core_ledger.js:31-63): present on every row.
  `rewriteRows` copies `dueDay: row.dueDay` onto the replacement (`changes.dueDay` when given) and leaves the
  mirror blank (:975-988); `undoGroup` mirrors leave it blank (:918-925). `convertSaleToCredit` on a quick sale
  therefore keeps `dueDay ''`; a method change or customer attach on a guided credit keeps its date.
- Readers: `saleGroupInfo` returns `dueDay: first.dueDay || ''` (:1078-1085); `openCredits` entries gain
  `dueDay`, `overdue` and `daysOver` (2.3); `buildReceipt` exposes `r.dueDay` (3.5).
- Sync: `syncValidateTx` accepts `dueDay` absent, `null`, `''`, or a string matching `^\d{4}-\d{2}-\d{2}$`; anything
  else (a number included) is `MALFORMED`: the one line of section 4.3, never the `strings` loop (which lets numbers
  through, core_sync.js:381-385). Day checksums hash only n/amount/cash (core_sync.js:876-903): no repair loop.

### 2.2 `commitSaleGroup(ports, p)`: the one write

In core_ledger.js, next to `commitSale` (:755-768, which stays untouched for voice, notebook and `quick`).
`p = {item, qty, unitPrice, paid, method, bankPart, mixed, customerId, dueDay, note, priceChanged, staff,
source, transcript, updateId, when}`. Rules, in this order:

- `qty = max(1, round(p.qty || 1))`; `unitPrice = nullish(p.unitPrice) ? Number(item.price) || 0 : Number(p.unitPrice)`;
  `amount = qty × unitPrice`; `paid = clamp(round(p.paid), 0, amount)` (`amount` when `p.paid` is nullish);
  `KEY = String(p.method || 'CASH').toUpperCase()`; `bankPart = (KEY === 'CASH' || !p.mixed) ? 0 : clamp(round(p.bankPart || 0), 0, paid)`;
  `cashPart = paid − bankPart`; `owed = amount − paid`.
- **The method of the SALE row:** `payKey = (p.mixed && bankPart === 0) ? CFG.METHOD.CASH : KEY`. A mixed payment
  whose transfer part came out as 0 (the seller typed 0, or the clamp made it 0) is a cash payment; nothing reached
  the account (`methodFor` would otherwise book the whole payment on `KEY`, core_ledger.js:103-106). The flow itself
  never produces this shape (Q3c refuses n < 1 and ➕ inside a mixed payment always asks the part, 1.2), so the rule
  is the ledger's own guard.
- Two rows only when `bankPart > 0 && cashPart > 0`. Otherwise one SALE row.
- `note = p.note || (twoRows ? 'split' : owed > 0 ? 'credit' : p.priceChanged ? 'price' : '')`; the PAYMENT row's note
  is always `'split'`. `dueDay = owed > 0 ? (p.dueDay || '') : ''` (a date chosen with a full payment is dropped).
- SALE via `newTx`: `{shop: item.shop, itemId: item.id, type: SALE, qty: −qty, unitPrice, amount, cash: twoRows ? cashPart : paid,
  costAtSale: item.cost, customerId: p.customerId || '', refGroupId: '', note, method: twoRows ? CFG.METHOD.CASH : methodFor(payKey, paid)
  ('' when paid is 0, CASH or the key otherwise: today's convention, core_ledger.js:103-106), dueDay, source, transcript, staffId: staff.id, updateId, when}`.
- PAYMENT (two rows only) via `newTx`: `{groupId: sale.groupId, shop, itemId, type: PAYMENT, qty: 0, unitPrice: null,
  amount: bankPart, cash: bankPart, customerId, refGroupId: sale.groupId, note: 'split', method: KEY, source, staffId, updateId, when}`,
  AFTER the SALE row (the server checks a PAYMENT against what is owed on the shadow ledger, core_sync.js:802-805).
- `writeGroup(ports, twoRows ? [sale, payment] : [sale])` once (core_ledger.js:66-74: one lock, one outbox group on a
  phone, app_ports.js:166-172). Returns `{groupId, txs, sale, payment (or null), owed}`.

The seven outcomes (one check per row in run_wizard.js, section 8.1 step 7):

| Outcome | Rows | Cash | Method | Note | DueDay |
|---|---|---|---|---|---|
| cash, full, no buyer | SALE | amount | CASH | '' ('price' when bargained) | '' |
| wallet or bank, full | SALE | amount | KEY | '' ('price' when bargained) | '' |
| one method, part now (deposit); 0 allowed | SALE | paid | `methodFor(KEY, paid)` ('' when 0) | 'credit' | the chosen day or '' |
| mixed, full (cash > 0, bank > 0) | SALE then PAYMENT | amount − bank · bank | CASH · KEY | 'split' · 'split' | '' |
| mixed, part now | SALE then PAYMENT | paid − bank · bank | CASH · KEY | 'split' · 'split' | the chosen day or '' (SALE only) |
| mixed where the cash part is 0 (bank = paid) | SALE | paid | KEY | 'credit' when owed > 0 else '' | as above |
| mixed where the bank part is 0 | SALE | paid | CASH ('' when 0), by `payKey` | 'credit' when owed > 0 else '' | as above |

`GroupID` = the SALE's `txId` (:61, `writeGroup` forces the PAYMENT onto it, :68). Receipt numbers: a phone
stamps the SALE row (`appendLedger`, app_store.js:294-299), Telegram rows derive theirs (`receiptNumber`,
core_ledger.js:1621-1643): the PAYMENT row never carries one. `afterWrite` (:82-92) refreshes the views whenever a
customer is on the row or cash ≠ amount. The mixed shape is `splitSale`'s (:1039-1045) without the mirror pair, so
`saleGroupInfo`, `groupMethods`, `openCredits`, `dayStats`, the receipt, `undoGroup` and the sync server read it
as today; `rewriteCheck` answers `complex` for two live rows (:947), so no corrective function can ever touch a
mixed guided group.

### 2.3 Credits and the overdue rule

- `CFG.CREDIT_COLS` gains `'DueDay', 'Overdue'` at the end (13 → 15, core_config.js:157).
- `creditOverdue(dueDay, days, today)` (core_ledger.js, new): `dueDay ? today > dueDay : days >= CFG.OVERDUE_DAYS`.
  Truth table (a named check, 8.1 step 12): dated in the future with days ≥ 30 → not overdue; dated today →
  not overdue; dated in the past → overdue; undated 29 days → not; undated 30 days → overdue.
- `openCredits` (:1122-1169) entries gain `dueDay: info.dueDay`, `overdue: creditOverdue(info.dueDay, days, dayKey(now))`,
  `daysOver: dueDay ? daysBetweenKeys(dueDay, dayKey(now)) : days`. Sort unchanged.
- `gasStore.refreshViews` writes 15 cells per Credits row `[…, c.days, c.dueDay || '', c.overdue === true]` and,
  before `setValues`, sets `@` on the whole `Day` AND `DueDay` columns of the Credits tab (by
  `CFG.CREDIT_COLS.indexOf(name) + 1`; the tab is cleared and rewritten whole, gas_store.js:681-687; without the
  format Sheets coerces `2026-12-30` into a Date, and today's `Day` column already suffers that, so both
  date-looking columns become text together).
- Dashboard (gas_setup.js:405-406): the cell `'Overdue (>30d)'` becomes `'Overdue'` with
  `'=SUMIF(' + CR('Overdue') + ',TRUE,' + CR('Owed') + ')'` (`=SUMIF(Credits!$O:$O,TRUE,Credits!$L:$L)`).
- **Freshness.** The Credits tab is a snapshot rewritten by `afterWrite` after a credit-related write
  (core_ledger.js:82-92) or once per accepted push batch (core_sync.js:847-850); a dated credit whose `DueDay`
  passes overnight would show `Overdue FALSE` until the next such write. So `sendDailySummary` (gas_main.js:240-249)
  calls `gasStore.refreshViews(openCredits(ports, null), depositsHeldList(ports), customerSummaries(ports))` (the
  `rebuildViews` body, :287-291) BEFORE building the text: the laptop is fresh every evening at the latest, and the
  Dashboard's `Overdue` cell agrees with the summary. gas_main.js is therefore a changed file of step 2 (4.2). The
  README (section H) still says that `Days`/`Overdue` are as of the last refresh and that `rebuildViews` refreshes
  them at any time.
- `buildDailySummary` (core_ledger.js:1551-1557): `overdue = openCredits(ports, null).filter(c => c.overdue)`;
  the undated ones print today's `summary_overdue '⏰ {days} ရက်ကျော် အကြွေး: {list}'` (:208) unchanged; the
  dated ones print one line `summary_due_overdue '⏰ ရက်လွန် အကြွေး: {list}'` (NEW), five names oldest first,
  each `{customer} {owed} ({fmtDayShortMy(dueDay)} · {myDigits(daysOver)} ရက် လွန်)`.
- The three credit tables of core_report.js (month report :219-221, customer statement :271-273, owed report
  :306-310) gain a column `ပေးမည့်ရက်` (NEW header, code constant) after `ရက်`: `fmtDayShortMy(c.dueDay)` or
  `''`, prefixed `'⏰ '` when `c.overdue`. Totals rows get one more `''`.
- The simulator's Credits tab shows `DueDay` and ⏰ by `c.overdue` (section 6), computed live from the world.

### 2.4 `Kind` (D6)

- `CFG.LIST_COLS` gains `'Kind'` as its 9th, last name (core_config.js:116); `CFG.LIST_KINDS = ['wallet', 'bank']`.
- Normalised row (`listNormRow`, core_ledger.js:336-348): `var kind = listText(r.kind).toLowerCase(); if (CFG.LIST_KINDS.indexOf(kind) >= 0) row.kind = kind;`
  — the field is PRESENT ONLY WHEN SET. A row without it keeps today's exact eight-field shape, so
  run_lists.js:592/:869/:1003, run_gas.js:593 and run_gas.js:1094-1098 stay green and `lists_json` is byte-identical
  for kind-less rows (no needless Settings-hash change on every phone at publish).
- `methodKind(row)` (new): `row.kind || (row.key === CFG.METHOD.BANK ? 'bank' : 'wallet')`. The seeded
  `ဘဏ်လွှဲ` (`legacyListRows`, :378-395, `method_BANK` :130) is a bank by name; everything else blank is a wallet.
- Compact row (`listRowToCompact`/`listRowFromCompact`, :498-506): `t: row.kind` only when set; `kind: c.t` back.
- `listUpsert` (:561-600): the appended row carries `kind: rec.kind` (:582) when the rec has it; `set` ops stay
  label/detail only (a Kind is a laptop cell edit afterwards; `gasListsPersist` persists only those two sets,
  gas_store.js:319-323).
- `addListOptionByLabel(ports, name, label, staff, extra)` (:715-734): the rec handed to `store.addListOption`
  (:728, `{list, key, label, shop: '', note}`) gets a `kind` key ONLY by this exact line, added after the literal:
  `if (extra && CFG.LIST_KINDS.indexOf(extra.kind) >= 0) rec.kind = extra.kind;` — never `kind: extra && extra.kind`
  (a `kind: undefined` key would be copied into the phone's outbox entry, app_store.js:360 with `appCloneRecord`
  :57-66, sim_phone.js:171 with `copy` :56, and two existing checks pin the rec keys to exactly
  `['key','label','list','note','shop']`: run_sync.js:820 and run_app.js:646). The four-argument callers are
  unchanged. Its first half becomes `listFindByLabel` (3.3).
- Sheet: `gasListRows` reads `kind: text(o.Kind).trim().toLowerCase()` (gas_store.js:244-249); `gasStore.listOptions`
  adds `kind` to a returned row ONLY when it is non-empty (:629-633; run_gas.js:593 pins the eight-key shape);
  `gasListValues` maps `Kind: r.kind || ''` (:276-282); `gasListsPersist`'s appended row copies `kind` (:316);
  `ensureListsTab` appends the column on an existing tab (`ensureColumns`, gas_setup.js:154), adds a `Kind`
  dropdown (`requireValueInList(CFG.LIST_KINDS, true).setAllowInvalid(false)`, from row 2, a blank allowed, the
  Shop pattern :189-190) and the header note `lists_note_kind` through the existing loop (:192-196).
  `GAS_LIST_TEXT_COLS` (gas_store.js:221) is unchanged (Kind holds plain words).
- Sync from a phone (`syncListRecReason`, core_sync.js:469-481): `kind` absent or `''` is "no kind" (the `shop`
  rule's shape, :478), a string in `CFG.LIST_KINDS` is a kind, anything else is `MALFORMED`; `syncApplyListEntry`
  (:517-525) copies `kind` only when it is in `CFG.LIST_KINDS` (a quarantined list entry would leave the phone's
  outbox and clear its `settingsHash`, :1403-1410, so a blank must never quarantine). An older server ignores the
  field (it copies named fields only) and stores a wallet; the laptop sets Kind later. `app_min_version` is not
  raised.
- Simulator store (poc/sim_ports.js:245-255): `listOptions` returns `kind: str(r.kind)` ONLY when the raw row's
  kind is non-empty (run_lists.js:869 compares the raw rows to exactly eight fields); `addListOption`'s generic
  `r[op.field] = op.value` (:269) needs no change.

### 2.5 Settings

| Key | Values | Default (code and setupSheet) | Read by |
|---|---|---|---|
| `sale_flow` | `steps` \| `quick` (any case) | `steps` | `saleFlow(ports)` on every `S`, `Q`, `QN`, `D` and in the `tap:` guard; never cached |
| `sale_due_presets` | days, comma list | `7,14,30` (`CFG.SALE_DUE_PRESETS`) | `saleDuePresets(ports)` (core_bot.js, 3.4) |

Both reach phones like every key (`syncSettingsFor`, core_sync.js:915-929; pulled on a hash change :1010;
bootstrap :1062-1067). `seedSimWorld` (poc/sim_seed.js:67-74) sets `sale_flow: 'quick'`; `bench()` of
run_wizard.js and simulator v2 set `'steps'`. The orders' `due_presets` (7, 14, 21, 30) are not touched.

### 2.6 Customers

No column change. A buyer named inside a guided sale becomes a Customers row only at ✅:
`addCustomer({name, phone})` (every store takes `phone`: gas_store.js:433, app_store.js:327, poc/sim_ports.js:101),
on the same device and before the ledger rows, so a phone's outbox holds the `customer` entry before the `group`
(`ENTRY_KINDS`, core_sync.js:75; `syncPlanPush` :1352-1356). An abandoned flow leaves no row. **On the Sheet these
are two writes:** `gasStore.addCustomer` under its own `gasLocked` (gas_store.js:428-441), then the group under
`writeGroup`'s lock (core_ledger.js:66-74); a Sheets failure between them leaves a Customers row with no sale.
Accepted: it is the window today's CR path has (core_bot.js:1465 before `convertSaleToCredit`), a stray customer
row is harmless and the laptop may delete it; one lock around both would not make two Sheets writes a transaction,
so none is added. A typed text of digits and phone punctuation only is matched as a phone (exact or partial) and
never becomes a name (1.2 Q1); a phone nobody has re-asks the buyer question and creates nothing; a phone somebody
has is offered, never duplicated (1.2 Q1d).

### 2.7 CFG additions (core_config.js)

`LEDGER_COLS` + `'DueDay'`; `CREDIT_COLS` + `'DueDay', 'Overdue'`; `LIST_COLS` + `'Kind'`;
`LIST_KINDS: ['wallet', 'bank']`; `SALE_DUE_PRESETS: [7, 14, 30]`; `SALE_DUE_MAX_DAYS: 365` (the farthest promised
date a seller may type, 1.2 Q5b); `SALE_FLOW: { STEPS: 'steps', QUICK: 'quick' }`.
No new TTL: the flow uses `STATE_TTL_SEC` (1800 s). The comment above `LEDGER_COLS` (:127-131) gains the
`DueDay` sentence of 2.1.

## 3. Core functions

Every new global below was grepped on 2026-11-11 across apps-script/, app/, poc/ and tools/ and is free; the
builder greps again before adding it.

### 3.1 core_config.js

Section 2.7, plus `saleFlow(ports)` next to `settingOn` (:190-193):
`return String(ports.store.getSetting('sale_flow', CFG.SALE_FLOW.STEPS) || '').trim().toLowerCase() === CFG.SALE_FLOW.QUICK ? CFG.SALE_FLOW.QUICK : CFG.SALE_FLOW.STEPS;`

### 3.2 core_burmese.js and core_orders.js

`addDaysKey(day, n)`, `daysBetweenKeys(dayA, dayB)`, `parseDayText(text, now, opts)` MOVE from core_orders.js:48-78
to core_burmese.js (after `daysSince`, :76-78; same names, same bodies; they use `MY_DIGITS` and `dayKey`, both
in that file) and are deleted from core_orders.js (one global scope: never two definitions). Reasons: run_sync
loads no core_orders (run_sync.js:16-20), core_ledger.js may call nothing of core_orders.js (:25-26), and the
sale's due date needs them in core_ledger.js and core_bot.js. `parseDayText` gains two things: a first branch, a
text matching `^\d{4}-\d{2}-\d{2}$` (the app's `<input type="date">`) is returned as the key after the same
month/day validity check (`Date.UTC` round trip), with no past-date adjustment; and an optional third argument
`opts`: with `opts.noRoll` the line `if (!m[3] && key < today) key = (y + 1) + key.slice(4)` (core_orders.js:76) is
skipped, so a yearless past date stays in this year (the sale's `saleDueTyped` then refuses it; the orders call it
without `opts` and keep the roll). `settingList` and `duePresets` stay in core_orders.js (every loader that drives
the bot loads it: run_scenario.js:16, run_lists.js:18, run_round4.js:24, bundle_gas, build_app, build_simulator);
the sale has its own presets (3.4).

### 3.3 core_ledger.js

New:
```
commitSaleGroup(ports, p) -> { groupId, txs, sale, payment, owed }           // section 2.2
creditOverdue(dueDay, days, today) -> boolean                                 // section 2.3
methodKind(row) -> 'wallet' | 'bank'                                          // section 2.4
payMethodsByKind(ports, shop) -> { wallets: [KEY], banks: [KEY] }
   // the keys payMethods(ports, shop) returns (:116-130: CASH first, the 12-byte drop, the MAX_BANK_BUTTONS cap), without CASH,
   // split by methodKind(listOption(ports, 'pay_method', key)); a key with no row (legacy Settings) is a wallet unless it is BANK
listFindByLabel(ports, name, label) -> { ok: false, reason: 'empty' | 'unavailable' }
                                     | { ok: true, existed: true, key, label }           // a row has that name (listNameKey); nothing written
                                     | { ok: true, existed: false, label: <clean> }      // free: the caller decides when to write
   // the first half of addListOptionByLabel (:715-722: listCleanText, the digits/amount refusal, the listNameKey lookup over listRows);
   // addListOptionByLabel calls it and is otherwise unchanged
```
Changed: `newTx` (+`dueDay`), `rewriteRows` (the replacement copies `dueDay`), `saleGroupInfo` (+`dueDay`),
`openCredits` (+`dueDay`, `overdue`, `daysOver`), `listNormRow` (+`kind` when set), `listRowToCompact` /
`listRowFromCompact` (`t`), `listUpsert` (the append carries `kind`), `addListOptionByLabel(…, extra)` (the rec
gains `kind` by the one conditional line of 2.4 — `if (extra && CFG.LIST_KINDS.indexOf(extra.kind) >= 0) rec.kind = extra.kind;`
— and nothing else), `buildDailySummary` (2.3). `legacyListRows`, `payMethods`, `methodLabel`, `methodKnown`,
`splitSale`, `convertSaleToCredit`, `commitSale`, `undoGroup`, `rewriteCheck` unchanged.

### 3.4 core_bot.js

**Callbacks** (the header legend at :20-31 gains the `SS`, `SC`, `SSA` and `CD …|p` lines). `SS` and `SC` join
`ITEM_ACTIONS` (:414), so the item is loaded from `parts[1]` and a vanished tag answers `tag_not_found`
(:434-436); `SC` joins `MUTATING_ACTIONS` (:417-418); `SS` does not. Byte counts are for `<item>` = `S1-0002` and
the longest argument of the row.

| Data | Bytes (max) | Step answered | Commits |
|---|---|---|---|
| `S\|<item>\|n` (card, app stepper; n ≤ 999) | 13 | count; `steps`: starts the flow, no write, exempt from the `tap:` guard | no |
| `Q\|<item>`, `QN\|<item>`, `D\|<item>` | existing | grid, typed count, typed price (`D` from the grid edits the grid, 1.2 Q0b) | no |
| `SS\|<item>\|q\|<2..9>` | 16 | count from the grid | no |
| `SS\|<item>\|b\|none` · `new` · `create` · `<custId>` (`C-` + 8 hex on a phone) | 23 | buyer, name, look-alikes | no |
| `SS\|<item>\|ph\|skip` | 18 | phone | no |
| `SS\|<item>\|m\|CASH` · `<KEY>` · `bank` · `mix` · `more` | 25 | how paid | no |
| `SS\|<item>\|a\|<KEY>` · `p<n>` | 25 | account; `p<n>` = page n of the account screen (redraws the same step) | no |
| `SS\|<item>\|x\|half` | 17 | transfer part | no |
| `SS\|<item>\|p\|0` · `half` · `bank` · `other` | 18 | how much now | no |
| `SS\|<item>\|d\|<n>` · `type` · `none` | 17 | due day | no |
| `SS\|<item>\|k\|wallet` · `bank` | 19 | kind of the account named in ➕ (writes one Lists row, as every `LA` flow does) | no |
| `SS\|<item>\|back\|<step>` (longest `due_text`) | 24 | back from `<step>` | no |
| `SS\|<item>\|z` | 12 | cancel (1.0 Cancel: clears only its own state) | no |
| `SC\|<item>\|ok` | 13 | commit, at step `paid` (paid = total) or `summary` | **yes** |
| `CD\|<g>\|yes\|p[\|<KEY>]` · `no\|p[\|<KEY>]` | 58 | use the deposit, plain keyboard, the hint key | yes (existing `CD`) |
| `LA\|pm\|SSA\|<item>` | 17 | ➕ an account inside the sale (from Q2 or Q3) | no |

**State** (`st:<uid>`, `setState` :2164-2169, TTL `STATE_TTL_SEC`; the ➕ prompt `ADD_STATE_TTL_SEC`, 600 s):
```
sale   = { kind: 'sale', step, item: <itemId>, msgId: <the message the current question is on, or null>, hist: [<steps left behind>],
           draft: { qty, unitPrice, priceChanged, customerId, newName, newPhone, needBuyer, method, mixed, bankPart, paid, dueDay, addLabel, addedKey } }
steps  : 'qty' | 'buyer' | 'name' | 'phone' | 'method' | 'account' | 'bank' | 'paid' | 'due' | 'due_text' | 'kind' | 'summary'
number = { kind: 'await_number', purpose: 'sale_step', saved: <sale state> }           // steps bank (at entry) and paid (after ✏️ အခြား)
count  = { kind: 'await_number', purpose: 'sale_qty', itemId, saved: <sale state at qty> }   // QN in steps mode
price  = { kind: 'await_number', purpose: 'sale_price', itemId, msgId: <the prompt's id> }   // D from the card (steps); quick: as today, no msgId
       | { kind: 'await_number', purpose: 'sale_price', itemId, saved: <sale state at qty> }  // D from the grid (steps)
add    = { kind: 'await_text', purpose: 'add_option', list: 'pay_method', resume: { a: 'SSA', args: [<item>] }, saved: <sale state> }
```
`saleStateOf(ports, uid)` returns the sale state behind any of these (`kind 'sale'`; `sale_step`/`sale_qty`/
`sale_price` → `saved` when present; `add_option` with `resume.a === 'SSA'` → `saved`), else null. The nested
prompts (`number`, `count`, `price` with `saved`, `add`) are drawn on the message `saved.msgId` names, or on a new
message whose id the prompt then stores in `saved.msgId`.

Back clears, per re-shown step: `qty` → `qty`; `buyer` → `customerId, newName, newPhone` (NOT `needBuyer`: it is
an answer of Q4); `name` → `newName`; `phone` → `newPhone`; `method` → `method, mixed, bankPart`; `account` →
`method, bankPart`; `bank` → `bankPart`; `paid` → `paid, needBuyer`; `due` → `dueDay`; `due_text`, `summary` →
nothing; `kind` → `addLabel`. A nested prompt opened FROM a screen (✏️ အခြား on Q4 → `ask_number`; ✏️ ရိုက်မယ် or
💬 on the grid → `ask_qty_number` / `ask_sale_price`; ➕ on Q2 or Q3 → `add_ask_pm`) carries the back row of the
screen it was opened from (`back|paid`, `back|qty`, `back|method`, `back|account`): while the live state is that
prompt, `saleGuard` compares the carried step with `saleStateOf(...).step` (the saved step, so rule (c) passes)
and `saleBack` restores the saved sale state and redraws that screen with its buttons, nothing popped and nothing
cleared. When the number state IS the screen (Q3c, set at entry), back leaves the step as above. The `kind`
screen was entered by `saleGo` from the restored state, so its `hist` ends with `method` or `account` and `back|kind`
pops to the screen the ➕ was tapped on.

**Functions** (new unless marked changed):

| Function | Signature | Does |
|---|---|---|
| `saleDuePresets` | `(ports) → [n]` | Settings `sale_due_presets` split on commas, positive numbers only, else `CFG.SALE_DUE_PRESETS`; the first three are buttons. Parses the value itself (never `settingList`: run_sync loads no core_orders) |
| `saleStateOf` | `(ports, uid) → state \| null` | above |
| `saleGuard` | `(ctx, item, step, message) → state \| null` | rules (a)-(c) of 1.0; `step` null skips rule (c); `message` = `cq.message` (its `text`/`caption` decides the sold-card branch of rule (a), together with `isCommittedCard`); answers `expired` (+ `sendItemCard`) itself, editing with `ctx.isCaption`, and returns null |
| `startGuidedSale` | `(ctx, item, qty, draft, hist)` | the S✖ rule first (UNIQUE, stock ≤ 0 → `cardText(fresh)` + `sale_gone` + `cardKeyboard(fresh)`, no state); the idempotence rule of 1.0; builds `{kind:'sale', step:'buyer', item, msgId: ctx.msgId, hist, draft: merge(draft, {qty})}`; `setLastItem`; `saleGo(..., 'buyer')` |
| `saleFromPrice` | `(ctx, item, price, saved)` | Q0b: price < 1 → `ask_sale_price` again (new message, the state set again with `saved`); UNIQUE → `startGuidedSale` as a new message; SKU → the grid with the price line as a new message, its id in `state.msgId` |
| `saleGo` | `(ctx, state, step, prefix)` | pushes the old step on `hist` (unless the screen was skipped), sets `state.step`, draws the screen with `editOrSend(ports, chatId, ctx.msgId, text, kb, ctx.isCaption)`, stores the shown message id in `state.msgId` (the tapped id, or the new message's), `setState`. `ctx = {chatId, msgId, isCaption, uid, staff, updateId, ports}` |
| `saleNext` | `(ctx, state)` | the step after the current one with the skips of 1.2: after `buyer`/`name`/`phone` → `due` when `draft.needBuyer`, else `method`; after `method` → `account` or its skip (one account) → `bank` when `draft.mixed`, else `paid`; after `account` → `bank` when `draft.mixed`, else `paid`; after `bank` → `paid`; after `paid` → `buyer` when a buyer is needed and none is set, else `due`; after `due`/`due_text` → `summary` |
| `saleHeader` | `(ports, item, draft) → text` | 1.1 |
| `saleBackRow` | `(ports, item, step) → row` | `[btn_back → SS\|item\|back\|step, btn_cancel → SS\|item\|z]` |
| `saleScreenQty` / `Buyer` / `Lookalikes` / `Name` / `Phone` / `Method` / `Account` / `BankPart` / `Paid` / `Due` / `DueText` / `Kind` / `Summary` | `(ports, staff, item, state, opts) → {text, kb, await}` | the screens of 1.2 (`opts.page` for `Account`, `opts.phoneForm` for `Lookalikes`); `await` names the `await_number` purpose to set (`sale_step`) when the screen takes a typed number at entry |
| `saleCallback` | `(ctx, parts, item, message)` | the `SS` dispatcher: `z` → `saleCancel`; `back` → `saleGuard` with the carried step, then `saleBack`; `a\|p<n>` → `saleGuard(step 'account')` then the account screen page n; every other letter → `saleGuard` with the letter's step, then the handler |
| `saleBack` | `(ctx, state, fromStep)` | 1.0 Back, the table above |
| `saleCancel` | `(ctx, item)` | 1.0 Cancel: the ownership rule, then `clearState` + the card, or `expired` |
| `saleBuyerPick` / `saleBuyerNamed` / `salePhoneTyped` | | Q1, Q1b, Q1c, Q1d; every exit through `saleNext` |
| `saleMethodPick` / `saleAccountPick` | | Q2, Q3 (`methodKnown` else rule (c)); `saleAccountPick` ends in `saleNext` |
| `saleNumber` | `(ctx, saved, n, source, transcript)` | `applyAwaitedNumber` case `sale_step`: by `saved.step` (`bank` → the Q3c rules, `paid` → the Q4 typed rules); a bad value sends `sale_bad_amount` with the screen's back row and sets the number state again |
| `salePaidPick` / `saleDuePick` / `saleDueTyped` / `saleKindPick` | | Q4, Q5, Q5b (`parseDayText(text, now, {noRoll: true})`, the `SALE_DUE_MAX_DAYS` bound), Q2+ (`saleKindPick` ends in `saleNext` from step `account`) |
| `saleText` | `(ctx, state, text) → true \| false` | kind `sale`: `buyer`/`name` → `saleBuyerNamed`; `phone` → `salePhoneTyped`; `due_text` → `saleDueTyped`; `qty` → `parseNumberText(text)` non-null → the Q0 typed rules (else false); `paid` → `parseNumberText(text)` non-null → `saleNumber`'s Q4 rules (else false); `due` → `parseDayText(text, now, {noRoll: true})` non-null → `saleDueTyped` (else false); every handled branch returns `true` explicitly |
| `saleCommit` | `(ctx, item, message)` | **S**, **S+**, **S✖** of 1.2: `saleGuard`, step must be `paid` or `summary`, fresh item, stock rule, `saleResolveBuyer`, `commitSaleGroup`, `setLastItem`, `setLastGroup`, `clearState`, `markCommittedCard`, the card edited with `ctx.isCaption` |
| `saleResolveBuyer` | `(ports, draft) → customer \| null` | `customerId` → `getCustomer`; `newName` → `matchCustomers` exact or `addCustomer({name: newName, phone: newPhone \|\| ''})` |
| `saleCardText` | `(ports, groupId, addedKey) → text` | **S** text from the ledger (`saleGroupInfo`, `groupMethods`, `getItem`; `credit_done.paid = cash + payments + applied`), so `creditDeposit` can rebuild it |
| `saleAccountResume` | `(chatId, uid, item, found, staff, updateId, ports)` | `finishAddOption` case `SSA` (Q2+): sets `draft.method` (and `addLabel` for a new label), then `saleNext` from step `account` for an existing label (Q3c when mixed, else Q4) or the `kind` screen for a new one, as a new message |
| **changed** `editOrSend` | `(ports, chatId, msgId, text, kb, isCaption)` | the sixth argument, `!!isCaption`, replaces the hard-coded `false` (:381); today's five callers pass nothing and are unchanged |
| **changed** `handleCallback` | | case `S`: `if (saleFlow(ports) === 'steps') return startGuidedSale(ctx, item, clampQty(arg), {}, []);` before today's body (:444-451); case `Q`: steps → `askQty(..., {steps: true})` and the sale/qty state with the grid's id; case `QN`: steps → the count state with `saved` and the back row; case `D`: steps → from the grid (a live sale state at step `qty` for this item) edit in place with `saved` and the back row, from the card a new prompt with `SS\|id\|z` and its id in `msgId`; the guard line of 1.0; new cases `SS` → `saleCallback(ctx, parts, item, cq.message)`, `SC` → `saleCommit(ctx, item, cq.message)`; case `CD` passes `isCaption` (after `msgId`), `parts[3] === 'p'` and `parts[4]` |
| **changed** `askQty` | `(chatId, uid, item, ports, opts)` | `opts.steps` → `SS\|item\|q\|n` digits and the steps last row; `opts.price` → `sale_ask_qty_price` first line and no 💬; no opts → byte-identical to today; returns `sendMessage`'s `{messageId}` as today (:254) |
| **changed** `applyAwaitedNumber` | | `sale_price`, `sale_qty`: branch on `saleFlow` (steps → `saleFromPrice` / `startGuidedSale` as a new message with `saved.draft`); new case `sale_step` → `saleNumber` |
| **changed** `handleText` | | inside `if (state)` (:668), FIRST: `if (state.kind === 'sale' && saleText(ctx, state, text)) return true;` — before the number path (:681), because a phone number parses as a number (:658-659) |
| **changed** `handleIntent` | | six lines in the text block (:775-808) and the number block (:823-831): kind `sale` at `buyer`/`name` → `saleBuyerNamed(intent.customer \|\| transcript)`; `phone` → `salePhoneTyped` when `normPhone(transcript).length >= 7` (the :781-786 rule); `due_text` → `saleDueTyped(transcript)`; `qty` → `firstNumber([intent.qty, intent.amount])` non-null → the Q0 typed rules; `paid` → `spokenMoney` non-null → `saleNumber`'s Q4 rules; and at `await_number sale_step` with `saved.step === 'bank'` a spoken cash part (`intent.method` resolving to CASH) becomes `total − w` (the `splitBankFromCash` rule, :827-828). A spoken number at a `sale_step` otherwise reaches `applyAwaitedNumber` through :823-831 as today |
| **changed** `afterSaleKeyboard` | `(ports, groupId, opts)` | `opts.plain` → the undo/receipt row and the 💰 row only (:271-274); callers without `opts` unchanged |
| **changed** `creditDeposit` | `(chatId, msgId, isCaption, groupId, arg, staff, updateId, ports, plain, addedKey)` | edits with `isCaption` (today `false`, :1671: the S+ card is a photo message); with `plain`: text `saleCardText(ports, groupId, addedKey)` (+ `deposit_applied` on yes), keyboard `afterSaleKeyboard(..., {plain: true})` + the hint row for `addedKey` + `phoneRow`; without: today's body |
| **changed** `askAddOption` | | resume `SSA`: the prompt's keyboard is `saleBackRow(ports, item, saved.step)` (`method` or `account`) instead of `[Z]`; everything else as today (the tapped question screen is edited with `isCaption`, :1393) |
| **changed** `finishAddOption` | | `case 'SSA'`: `listFindByLabel` instead of `addListOptionByLabel`, then `saleAccountResume`; no hint row (it comes on the sold card) |
| **changed** `ADD_RESUME_LIST`, `ITEM_ACTIONS`, `MUTATING_ACTIONS` | | `SSA: 'pay_method'`; `SS: 1, SC: 1`; `SC: 1` |

New globals to grep: `saleFlow, methodKind, payMethodsByKind, creditOverdue, commitSaleGroup, listFindByLabel,
saleDuePresets, saleStateOf, saleGuard, startGuidedSale, saleFromPrice, saleGo, saleNext, saleHeader, saleBackRow,
saleScreen*, saleCallback, saleBack, saleCancel, saleBuyerPick, saleBuyerNamed, salePhoneTyped, saleMethodPick,
saleAccountPick, saleNumber, salePaidPick, saleDuePick, saleDueTyped, saleKindPick, saleText, saleCommit,
saleResolveBuyer, saleCardText, saleAccountResume, gasLedgerWidth, GAS_LEDGER_WIDTH_OK, setListRow, SIM_TOURS,
SIM_TOUR_MSG, SIM_APP_SRCDOC, SIM_HOT, appOpenDateSheet, appQuestionLine, appKeypadKeyFor`.

### 3.5 core_report.js

`buildReceipt` (:322-348) adds `r.dueDay = info.dueDay || ''`; `receiptText` (:358-369) pushes
`sale_due_set {owed, date: fmtDayMy(r.dueDay)}` right after `r.transfer` (or after `receipt_total` when there is
no transfer line) while `r.owed > 0 && r.dueDay`; `receiptReport` (:376-388) appends the same line to `footer`
after the account lines and before `receipt_thanks` (one line, never in `subtitle`: gas_pdf.js sizes column A to
the longest cell). The three credit tables: section 2.3. `describeRow` unchanged.

### 3.6 core_messages.js

Every key of section 7, added in step 1 so later steps only read it.

## 4. Glue and sync

### 4.1 setupSheet (gas_setup.js:14-88)

1. **The grid grows inside the two header writers**, not at a call site: `ensureTab` (:247-254) gets
   `if (header.length) gasEnsureWidth(sh, header.length);` before its header write, and `ensureColumns`
   (:257-265) gets `gasEnsureWidth(sh, start + missing.length - 1);` before its `setValues` (`gasEnsureWidth`,
   gas_store.js:113-117, is `getMaxColumns` + `insertColumnsAfter(max, n − max)`, both modelled by the fake,
   poc/fake_gas.js:379-384; a new tab has 26 columns and the fake refuses a wider write, :296-298, :408-411).
   The Ledger line of `setupSheet` then needs no special case: `ensureTab(ss, 'Ledger', CFG.LEDGER_COLS)` +
   `ensureColumns(ledger, CFG.LEDGER_COLS)` as today (:19, :28), and any tab that grows past 26 in a later round is
   covered. `setupTailoringTabs` may keep its own growth line (:118-125). Then `textColumn(ledger, CFG.LEDGER_COLS,
   'DueDay')` next to Day/Time (:36-37).
2. `defaults` (:44-66) gains `['sale_flow', CFG.SALE_FLOW.STEPS]` and `['sale_due_presets', CFG.SALE_DUE_PRESETS.join(',')]`
   (appended only when missing, :67-68). Nicety, in its own try/catch: the `sale_flow` row's Key cell gets the
   note `t(ports, 'settings_note_sale_flow')`.
3. Credits: `var credits = ensureTab(ss, 'Credits', CFG.CREDIT_COLS); ensureColumns(credits, CFG.CREDIT_COLS);`
   (`ensureTab` writes a header only on an empty tab, :249, so an existing book would keep its 13-wide header until
   the first `refreshViews`, while the Dashboard already reads `Credits!$O:$O`; `ensureColumns` appends `DueDay`
   and `Overdue` at once, 15 ≤ 26).
4. `ensureListsTab` (:150-210): `ensureColumns` appends `Kind`; the `Kind` dropdown nicety of 2.4; the note loop
   needs `MSG.lists_note_kind`. The seed rows (:164-174) are unchanged (`gasListValues` writes `''` for a missing
   kind; the legacy `BANK` row is a bank by name).
5. `writeDashboard` (:405-406): the `Overdue` cell of 2.3.

### 4.2 gas_store.js, gas_sync.js and gas_main.js

- `gasLedgerWidth(sh)` (gas_store.js, next to `gasEnsureWidth` :113-117; `var GAS_LEDGER_WIDTH_OK = false;`):
  once per execution, `if (sh.getMaxColumns() < CFG.LEDGER_COLS.length) gasEnsureWidth(sh, CFG.LEDGER_COLS.length)`.
  Called first by `gasStore.appendLedger` (:371-388) and by `gasSyncTabs.appendRows` (gas_sync.js:174-183), so a
  sale between "publish server" and "run setupSheet" never writes 27 values into a 26-column grid (map-glue GAP 1);
  the value sits under a blank header until `setupSheet` writes `DueDay` there, after which `gasTable` reads it by
  name (:36-51). run_sync step S18 stubs `gasSyncServerPorts` to the fake server and never reaches `appendRows`,
  so it stays green although it loads gas_sync.js without gas_store.js.
- `gasStore.appendLedger`: `DueDay: tx.dueDay || ''` in the map. `gasSyncLedgerValues` (gas_sync.js:160-170): the same.
- `gasStore.ledgerRows` (:389-404): `dueDay: o.DueDay === undefined ? '' : gasDay(o.DueDay)`.
- `gasStore.refreshViews` (:681-698): the 15-cell Credits row and the `@` format of `Day` and `DueDay` (2.3).
- Lists: `gasListRows`, `listOptions`, `gasListValues`, `gasListsPersist` as in 2.4.
- `gas_main.js`: `sendDailySummary` (:240-249) calls `gasStore.refreshViews(openCredits(ports, null),
  depositsHeldList(ports), customerSummaries(ports))` right after `buildPorts()` and before `buildDailySummary`
  (2.3 Freshness; three lines, the `rebuildViews` body :287-291). `onEdit` already rewrites the Dashboard on a Lists
  edit; `rebuildViews` stays the migration step.

### 4.3 core_sync.js

- `syncValidateTx` (:369-388): ONE line after the `strings` loop (:385), and `'dueDay'` is NOT added to `strings`
  (that loop accepts numbers, :384):
  `if (!syncBlank(tx.dueDay) && !(syncStr(tx.dueDay) && /^\d{4}-\d{2}-\d{2}$/.test(tx.dueDay))) return SYNC.REASON.MALFORMED;`
  (`syncBlank` :143 covers `''`, `null`, `undefined`).
- `syncListRecReason` (:469-481): after the `shop` line (:478):
  `if (!syncAbsent(rec.kind) && rec.kind !== '' && !(syncStr(rec.kind) && CFG.LIST_KINDS.indexOf(rec.kind) >= 0)) return bad;`
  (a blank is "no kind", like a blank `shop`; a quarantine would drop the seller's new option from her buttons,
  :1403-1410).
- `syncApplyListEntry` (:517-525): `if (syncStr(rec.kind) && CFG.LIST_KINDS.indexOf(rec.kind) >= 0) rec2.kind = rec.kind;`
  beside the copied fields (:520); `''` is not copied.
- Old devices: an old phone pushes rows without `dueDay` (stored `''`) and list entries without `kind` (a wallet);
  a new phone pushing to an old server passes (no unknown-field rule, :381-385) and the old `gasSyncLedgerValues`
  drops the value silently, which the publish order forbids anyway; a new server pulling to an old phone:
  `appendSynced` keeps the extra key (app_store.js:444-452). The OVERPAID check (:802-805) sees the SALE on the
  shadow before the PAYMENT because `commitSaleGroup` writes the SALE first. `syncSettingsFor` is unchanged.

### 4.4 poc/fake_gas.js

No new member expected: `getMaxColumns`, `insertColumnsAfter`, `setNumberFormat`, `setNote` are modelled
(poc/fake_gas.js:52-56, :379-384). A member the glue newly needs is added to the fake's table, to run_gas.js's copy
(:198-230) and named in the report (SPEC-round-4.md section 12 rule).

### 4.5 The exact migration (for the README)

1. All suites green (section 8); `node tools/bundle_gas.js`, `node tools/build_app.js`, `node poc/build_simulator.js`.
2. To open the shops on the one-tap card instead of the guided flow, type the row `sale_flow | quick` into the
   Settings tab NOW, before the publish (`getSetting` reads it as soon as it exists, gas_store.js:664-668; the code's
   default when the row is missing is `steps`, 3.1). Then `node tools/publish.js bot "round 4 + 5: lists, accounts,
   split, measurement form, guided sale"`.
3. **Right after step 2, in the same sitting,** run `setupSheet` once in the editor: the Lists tab (round 4) with its
   ninth `Kind` column and dropdown; the Ledger grown to 27 columns with `DueDay` as text; the Credits header 15
   wide; the Settings rows `sale_flow = steps` (unless typed in step 2) and `sale_due_presets`; the new Messages
   keys; the Dashboard with the `Overdue` cell. Then run `rebuildViews` so the Credits tab shows `DueDay`/`Overdue`
   values before the first credit write. Between 2 and 3 a Telegram sale (in `steps`, with `MSG` fallbacks for the
   new keys) and a phone's push both work (4.2), but the `sale_flow` row cannot be typed into a Settings row that
   does not exist yet, hence step 2's note and "right after".
4. `node tools/publish.js app`. Phones update through the service worker; until then they sell with the one-tap
   card and every row they write stays valid.
5. The owner may change Settings `sale_flow` at any time once the row exists; the bot obeys at the next tap, each
   phone at its next pull. Rebuild and publish the simulator artifact last.

## 5. App (app/)

- `appInputModeFor` (app_ui.js:68-78), before the final `return null`:
  ```
  if (state.kind === 'sale') {
    if (state.step === 'buyer' || state.step === 'name') return 'text';
    if (state.step === 'phone') return 'tel';
    if (state.step === 'due_text') return 'date';
    return null;
  }
  ```
  The number steps are `await_number` and already return `'number'` (:70) with the auto-open keypad (:758-760).
  `appInputBar` treats `'tel'` as the text bar with `inputmode="tel"` on the input (:767; a numeric keyboard for
  the phone number).
- **Keypad title and reopening.** `appInputBar` (:754-771) titles the keypad with `appQuestionLine(m.text)` (new,
  pure: the last non-empty line of the text) instead of `appFirstLine(m.text)` (:760, :763) when the state is
  `await_number` with purpose `sale_step` or `sale_qty` (the guided screens put the header first and the question
  last, 1.0 Layout; today's number prompts are one line, so the other purposes keep `appFirstLine`). The auto-open
  is keyed on `appKeypadKeyFor(m, state)` (new, pure) = `m.id + '|' + state.purpose + '|' + (state.saved ? state.saved.step : '')`
  instead of `m.id` alone (:758-759), so the second number prompt on the same message (Q3c, then ✏️ အခြား on Q4)
  opens the keypad again. Both helpers are asserted in 8.5.
- **Date sheet.** `appInputBar`: mode `'date'` renders one primary button `ui_btn_pick_date` →
  `appOpenDateSheet()`: a `div.sheet` in `#overlay` (the `appOpenNumberKeypad` pattern, :909-939) with `h3`
  `ui_date_title`, an `<input type="date" min="<dayKey(now)>">`, and `[ui_btn_close | ui_btn_ok]`; OK with a value
  → `appCloseOverlay()` then `appSendText(value)` (`yyyy-mm-dd`, which `parseDayText` now accepts); OK without a
  value does nothing. app.css: one rule `.sheet input[type=date] { font-size: 20px; min-height: var(--key); }`.
- **Tour hooks.** `appRenderMsg` (:646-694) sets `data-cb` = `b.callback_data` on every keyboard button it draws
  (:682) and adds the class `hot` to the button whose `callback_data === APP.win.SIM_HOT` (a global the simulator
  page sets on the frame's window; the real app never has it, so the line is a read of `undefined`). `appStepper`
  (:697-712) sets `data-cb` = `appStepperData(info.itemId, APP.qty.n)` on its sell button (:709) and adds `hot` when
  `APP.win.SIM_HOT` starts with `'S|' + info.itemId + '|'`. app.css: `.sell.hot` next to `.kb button.hot` (:97),
  same rule. The page re-renders the frame with `frame.contentWindow.appRender()` after setting `SIM_HOT` (6.4).
- **Offline-safe boot** (the simulator opened with the network off). `bootApp` (:265):
  `var online = opts.online || function () { return phone.online !== false && !(win && win.navigator && win.navigator.onLine === false); };`
  and `appDoEnroll` (:444) asks `!APP.sync.online()` instead of `APP.win.navigator.onLine === false`. Why:
  `sync.call` answers `{ok:false, error:'offline', transportFailure:true}` to every request while `online()` is
  false (app_sync.js:90), and `online()` trusts `navigator.onLine === false`, so a srcdoc frame inside a file
  opened without a connection could neither enrol nor sync against the in-page fake server. The frame passes
  `online: function () { return true; }` (6.2); the real app passes nothing and behaves exactly as today
  (`createAppSync` already takes `opts.online`, app_sync.js:78).
- app_i18n.js: `ui_btn_pick_date`, `ui_date_title` (section 7).
- `app/dev/index.html`: `world.settings.sale_flow = 'steps'` after `simSeedLists(world)` (:134), and a `sale_flow`
  checkbox beside `appVoice` (:199-204 pattern) that writes `world.settings.sale_flow` and calls `sync.syncNow('settings')`.
- Unchanged: `appCardInfo`, `appStepperData`, `appKeyboardForCard` (:37-66; in steps mode the stepper's `S|id|N`
  opens Q1 in place of the card, which then has no `S|id|1` and renders plain rows), `app_store.js`, `app_sync.js`
  (`pendingLines` prints the group's first row with `describeRow`), `app_ports.js`, the form, `tools/build_app.js`,
  `app/config.js`.

## 6. Simulator v2 (poc/, D8)

### 6.1 Page: login, roles, devices, panes

- **Login** (`#login`, a full-page overlay at boot): three cards `👩‍💼 ဆိုင်ရှင် / Owner` (`SIM_USERS.owner`, the shared
  admin login), `🧵 ဆိုင် ၁ / Seller shop 1` (`sister`), `🧵 ဆိုင် ၂ / Seller shop 2` (`brother`) (poc/sim_seed.js:4-9).
  Page state `S.login`; a header chip shows who is logged in with `🚪 Log out` back to the login screen. Switching
  keeps every device's data (the world is one). "Customer (not staff)" becomes the tour step "a stranger scans a tag".
- **Device bar** (`#devices`): `✈️ Telegram` · `📱 အက်ပ် / App`; the owner adds `💻 Laptop`. Telegram = today's phone
  pane bound to `world.chats[SIM_USERS[login].id]`; App = an `<iframe srcdoc>` per login (6.2), 390 × 780 (the dev
  page's frame, app/dev/index.html:22); Laptop (owner only) = the Sheet pane plus a toggle "app at laptop width"
  that shows a second frame for the owner at 820 px (the form goes two-column from 700 px, app.css:193).
- **Stage**: left the "what can I do · ဘာလုပ်လို့ရလဲ" panel (`#tours`, 6.4) above the shop floor (racks as today,
  poc/sim_ui.js:95-127; a click = a scan on the active device: Telegram → the START bar; App →
  `frame.contentWindow.appOpenTagId(id)`); centre the active device; the laptop takes the full width when chosen.
  Voice: the 16 `PHRASES` and the parser box move into one collapsed `<details>` under the Telegram phone (D7).
- **Clock.** The demo clock is an OFFSET, not a frozen instant: `createSimWorld` gains `world.clockOffsetMs = 0`
  and `now()` (poc/sim_ports.js:22) becomes `world.nowOverride ? new Date(world.nowOverride.getTime()) : new Date(Date.now() + (world.clockOffsetMs || 0))`
  (step 1, sim_ports.js). The suites keep `nowOverride` (`tick`, run_round4.js:74) and are untouched. The header
  buttons `⏩ +31 min`, `⏩ +1 ရက် / next day`, `🕘 21:00` ADD to `world.clockOffsetMs` (21:00 = the offset that puts
  the Yangon wall clock at 21:00 today), so later rows, `receivedAt`, TTLs and the frames' learned server offset
  (app_ports.js:61-63, app_sync.js:116) keep moving. The fake server reads the same clock (sim_sync.js:21). Reset
  builds a new world, so the offset is 0 again.
- **Header actions**: the clock buttons above, `Post 21:00 summary` (pushes `buildDailySummary(world.ports,
  dayKey(now)) + '\n' + server.summaryLines().join('\n')` into the Family group tab, the dev page's composition,
  app/dev/index.html:208), a `sale_flow` two-button switch (`steps` | `quick`: writes `world.settings.sale_flow` and
  calls `syncNow('settings')` on every READY frame, the `app_voice` mechanism :201-204), `Print tags`, `Reset`,
  and `Simulate Gemini outage` inside the voice `<details>`.
- **Reset** removes every `<iframe>` from the document and empties `S.frames` BEFORE calling `boot()` (today
  `#reset` only calls `boot()`, sim_ui.js:525): a frame kept across a reset still holds its `deviceId`/`token` in
  its memory adapter and resolves `parent.SIM.server` at call time, so the new server would answer `auth` (`syncAuthenticate`,
  core_sync.js:328-331), log `device_denied` on every attempt and turn the chip red (`ui_err_auth`, app_sync.js:136).
  After Reset the page is at the login screen, the device bar shows no enrolled frame and the owner's `📱 ဖုန်းများ`
  lists none (8.8).
- **Laptop tabs** (`renderSheet`, poc/sim_ui.js:283-324): Dashboard, **Lists (editable, 6.3)**, Ledger (+ a `DueDay`
  column), Customers, Credits (+ `DueDay`, ⏰ by `c.overdue` instead of `c.days >= CFG.OVERDUE_DAYS`, :427), Deposits,
  Orders, **Measurements** (new: `world.measurements`, the fixed columns and the field keys, values as text), Errors,
  Family group. No Devices tab, no Settings tab, no editable Customers (D8's list; the owner's `📱 ဖုန်းများ` in
  Telegram lists the phones, sim_sync.js:233-242).

### 6.2 Embedding the real app

- One `<iframe srcdoc>` per device: `APP` is one global per document (app_ui.js:16) and app.css redefines the
  template's globals (map-sim CSS note). The srcdoc is built by `build_simulator.js` (6.5): the `#app` shell of
  app/index.html:22-38 (ids unchanged: `appWireEvents` binds them without null checks, app_ui.js:316-333; the HTML
  comment of index.html:19 is NOT copied, 6.5), the template's Google Fonts link (app/fonts/fonts.css paths do not
  resolve in a srcdoc; offline the system Myanmar font is the fallback, as today), `app.css` inlined in a `<style>`,
  the core and app files in `tools/build_app.js` order inlined in one `<script>`, no `config.js`, no `jsQR` (the
  floor click is the scan; app_scan.js tests `typeof jsQR` at run time, :25, :92, :131), and the boot script
  ```
  bootApp({ apiUrl: 'fake://sim-server', botUsername: 'ShopTagBot', appName: 'SalesTag (demo)', version: 'demo' },
    { adapter: createMemoryAdapter(), online: function () { return true; }, noServiceWorker: true,
      transport: function (api, body) { return new Promise(function (res, rej) { setTimeout(function () {
        try { res(parent.SIM.server.handle(api, body)); } catch (e) { rej(e); } }, parent.SIM.latency); }); } })
    .then(function (app) { parent.SIM.frameReady(window, app); });
  ```
  (the dev page's call, app/dev/index.html:138-150, with `parent.` and the `online` of section 5).
- **Ready frames only.** `SIM.frameReady(win, app)` registers `S.frames[login] = {win, app}`; the page talks to a
  frame only through that registry (`frame.contentWindow.APP` is `null` until `bootApp` resolves, app_ui.js:16,
  :267), and calls `app.sync.syncNow(...)` only when `app.store.meta.deviceId` is set (an un-enrolled frame answers
  `not_enrolled`, app_sync.js:250, harmless but noisy). Every page-side call into a frame is wrapped in try/catch
  that appends to `window.SIM_ERRORS`.
- Enrolment, the honest way, is the first tour: Telegram menu → `btn_app '📲 အက်ပ်'` → the `app_enroll_code`
  message → type it into the frame's `#codeInput` → `ui_btn_enroll 'ချိတ်ဆက်'` (app_ui.js:440-464). A shortcut on
  the device bar fills the field from `server.mintEnrollCode(SIM_USERS[login], label).display` and calls the frame's
  `appDoEnroll()` (dev page :172-173, :186-191). The owner's `📱 ဖုန်းများ` then lists the frames with their letters.
- After every Telegram `update` event the page calls `app.sync.syncNow('sim')` on the ready, enrolled frames; a
  frame's own push lands in `world.ledger` through `syncTabs.appendRows` and emits `ledger` (sim_sync.js:137-139),
  so the Sheet pane redraws through the one listener (sim_ui.js:53-57).
- The measurement form (`#measForm.formpage`, fixed inset 0) stays inside the frame's document: the frame is its
  window. No app CSS change.
- `world.settings.sale_flow = 'steps'` at boot: the demo shows the guided sale.

### 6.3 Editable Lists

- `poc/sim_ports.js`: `store.setListRow(name, key, fields)` (sim-only, a hand edit): finds the raw row by
  `listNormKey(name, key)`, assigns `label | active | order | shop | detail | kind` as given (strings as the Sheet
  holds them, `active` boolean), emits `{type: 'lists'}`; a no-op on an unknown key. Adding a row from the laptop
  reuses `addListOptionByLabel(world.ports, name, label, SIM_USERS.owner, {kind})` (the bot's own rule, so a
  duplicate name is refused the same way).
- The Lists tab draws Label (input), Active (tick box), Detail (input), Kind (select '' | wallet | bank, pay_method
  rows only) and an "add row" form (list, label, kind); `change` → `setListRow`; `listRowSig` gains `kind`
  (sim_ui.js:360-362) so `markListChanges` flashes the edit. Propagation is free: Telegram reads `store.listOptions`
  first on every screen (core_ledger.js:447-451); the frames pull `lists_json` at the next sync (hash change); the
  page calls `syncNow('settings')` on the ready frames after a `lists` event.

### 6.4 Tours ("what can I do")

- `poc/sim_tours.js` (new, plain ES5, inlined by the build): `var SIM_TOURS = [...]`, each tour
  `{id, login, device, title: {my, en}, steps: [{my, en, target, done, login?, device?}]}`. A step may override
  `login` and/or `device`: the panel switches the pane (and the logged-in chip) and the caption says so in both
  languages; the tour's own `login`/`device` are the defaults. `target` is one of `{tag: 'S1-0002'}` (highlight the
  rack tile `[title="Scan S1-0002"]`, sim_ui.js:103), `{cb: 'S|S1-0002|1'}` (exact callback data; for the app's
  stepper a `cb` matches on the `S|<id>|` PREFIX, because the count is whatever the stepper shows), `{label: 'btn_sell_one'}`
  (a MSG or APP_MSG key, resolved by the label rule below), `{type: '18000'}` (highlight the input bar and pre-fill
  it), `{ui: '#devices .app'}` (page chrome), `{tab: 'lists', cell: 'KBZ.Kind'}` (the laptop).
- **The label rule** (one definition, reused by 6.6 and 8.1): a label target matches a button whose text contains
  `t(ports, key)` UP TO ITS FIRST `{`, trimmed (`'✅ အကုန် {amount}'` → `'✅ အကုန်'`; `'တစ်ဝက် {amount}'` → `'တစ်ဝက်'`),
  because `world.sim.button` is a plain substring test on the rendered text (sim_ports.js:437-443) and an unfilled
  template never matches a filled button. `sim_ports.js` gains `sim.buttonByKey(message, key)` (step 1) =
  `sim.button(message, prefix)` with that prefix, which THROWS when the prefix is empty (`btn_days '{n} ရက်'` starts
  with `{`: such a key can only be a `cb` target). `sim.tapLastByKey(user, key)` taps it (the `tapLast` pattern,
  :456-459).
- **The highlight is part of rendering**, never a class set after the fact (the Telegram pane is rebuilt from
  scratch on every world event, sim_ui.js:137-146, :216-220, :53-57, and the fake server emits `synclog` on every
  sync call, sim_sync.js:152; the frame redraws `#main` on every `change`/`sync`, app_ui.js:356-372). The page keeps
  `S.tour = {id, i, hot}`; `renderMsg` adds `hot` to the button whose `callback_data === S.tour.hot`; the rack tile
  and the input bar read `S.tour` the same way; for the frame the page sets `frame.contentWindow.SIM_HOT = hot`
  and calls `frame.contentWindow.appRender()`, and `appRenderMsg`/`appStepper` add the class themselves (section 5).
  When a tour ends or is left, `S.tour = null`, `SIM_HOT = ''`, one more render.
- `done(evt, ctx)` is checked on every `world.listeners` event (`update` carries `evt.update.callback_query.data` /
  `message.text`, sim_ports.js:389-393) and on each ready frame's `APP.phone.on('change')`; the panel then shows the
  next caption in Burmese and English, with `⏭ do it for me` (performs the step through `world.sim.tap`,
  `appOpenTagId`, `APP.phone.sim.tapLast`, `setListRow`, …) and `skip`. Captions quote button labels at run time
  through `t(world.ports, key)`; the connecting Burmese verbs come from a small `SIM_TOUR_MSG` table whose words
  exist in MSG ('scan လုပ်ပါ' from `menu` :89, 'နှိပ်ပါ' from `help` :90, 'ရိုက်ပါ' from `cust_find` :150, also in
  `ord_ask_due_text` :251 and `add_ask_pm` :388; `ask_number` :79 reads 'ရိုက်ပေးပါ' and is not the source);
  anything beyond those is a draft for the owner (page copy, never shown to customers).
- Tours (D8): sell step by step (cash, full); sell with a deposit and a date (the seller's Telegram, then steps
  that switch to the owner's 💻: the Credits tab, `⏩ +1 ရက်` × 15, `🕘 21:00`, `Post 21:00 summary`); mixed payment;
  a changed price for two pieces; back and cancel; restock (`btn_restock` → `+၅`); register a new piece by photo
  (a blank tag → 📸 → price → cost); return (`btn_return`); expense (`btn_expense` → category → amount → method);
  receive a payment (`btn_pay` → the credit → `btn_all`); take a deposit (`btn_deposit`); custom order with voucher
  and measurements (Telegram `btn_orders` → … → 📏; the app's form from `btn_measure`); reports and the 21:00
  summary (`btn_reports` → `rep_today`; the clock); enrol a phone (Telegram `btn_app` → the code, then a step on the
  📱 device: type it, `ui_btn_enroll`); manage lists on the laptop (rename KBZPay, retire WavePay, set a Kind, add an
  account, watch the how-paid screen change); switch to the quick sale and back; a stranger scans a tag (a step with
  `login: 'customer'`: the pane renders `world.chats[9999]` for that step, `S.user = SIM_USERS.customer`, and the
  bot answers `staff_only`; the previous login comes back afterwards).
- Autopilot: `?login=sister&device=app&tour=sell&latency=0` runs a tour's "do it for me" steps unattended and
  collects page errors in `window.SIM_ERRORS` (the dev page's pattern, app/dev/index.html:96-107, 156-184);
  `?autorun=smoke` runs `SIM.smoke()` (6.6) and writes its result into `<pre id="smoke">` as JSON.

### 6.5 Files and build

- `poc/build_simulator.js`: `FILES` = `core_config, core_burmese, core_messages, core_ai_prompt, core_ledger,
  core_report, core_bot, core_sync, core_orders` (the build_app order, tools/build_app.js:29-30 + core_orders),
  `poc/sim_mock_ai, sim_ports, sim_seed, sim_sync, sim_tours, sim_ui`; a second list `FRAME_FILES` = the nine core
  files + the seven app files in `APP_FIRST` order (build_app.js:30) for the srcdoc; `app/app.css` inlined. The
  srcdoc is embedded as `var SIM_APP_SRCDOC = <JSON string>;` at a new template marker `<!-- @appframe -->` with
  every `</script` inside the string written as `<\/script`; the existing `</script` refusal (:20-21) applies to
  every outer file AND to every `FRAME_FILES` source and the frame shell (the escaped `<\/script` decodes back to
  `</script` inside the frame). The frame shell carries no HTML comment: inside the outer `<script>` a `<!--`
  followed by `<script` puts the HTML tokenizer into its double-escaped state, where `</script>` no longer closes
  the block, so one comment (app/index.html:19 copied by habit) would silently kill the page. Output
  `poc/dist/pos-simulator.html` (≈ 1.35 MB: today's 517 KB + core_sync and sim_sync + the 688 KB app bundle +
  17 KB css; under the 16 MB artifact limit). The qrcodejs CDN tag stays for the racks.
- `poc/simulator.template.html`: the login overlay, the header chip, the device bar, the two-column stage
  (`#tours` + floor | device), the laptop layout (Sheet, wide frame toggle), the collapsed voice `<details>`, the
  clock and `sale_flow` controls, `.kb button.hot` for the Telegram pane, caption styles, the two markers
  `<!-- @scripts -->` and `<!-- @appframe -->`; the CSS tokens and dark theme stay (:5-34).
- `poc/sim_ui.js`: `boot()` = `world = simSeedLists(seedSimWorld(createSimWorld())); world.settings.sale_flow = 'steps';
  server = createFakeServer(world); window.SIM = {world, server, latency: 250, frameReady, smoke}`; `S` gains
  `login, device, tour, frames`; `renderMsg` adds `data-cb` and `hot`; the login, device bar, tour panel,
  Measurements tab, editable Lists tab, clock and switch; Reset's frame teardown; `SIM.smoke()`; `window.SIM_ERRORS`.
- `poc/check_simulator.js` (new, Node): proves the build without a browser: the output file exists; it contains
  every `FILES` banner (`/* ===== <file> ===== */`) and `var SIM_APP_SRCDOC`; the srcdoc STRING (as embedded) holds
  no raw `</script`, no `<!--` and no U+2028/U+2029; every `FRAME_FILES` source and the frame shell hold no `</script`;
  both markers were replaced; the file is under 4 MB; `app/app_ui.js` sets `data-cb` and reads `SIM_HOT`, and
  `poc/sim_ui.js` reads `data-cb`; every `label` key named in `SIM_TOURS` exists in `MSG` or `APP_MSG` and its text
  before the first `{` is non-empty (it loads core_config, core_burmese, core_messages, app_i18n and sim_tours in a vm
  and walks the data); every tour's `login` (and every step override) is a `SIM_USERS` key and every `device` is
  `tg`, `app`, `laptop` or `floor`.
- `poc/check_simulator_browser.js` (new, Node): the browser-driven check. It looks for Chrome (`process.env.CHROME`,
  then the usual Windows paths), runs
  `chrome --headless=new --disable-gpu --virtual-time-budget=60000 --dump-dom "file:///…/pos-simulator.html?autorun=smoke&latency=0"`,
  parses `<pre id="smoke">` as JSON `{passed, failed, errors: []}` and exits 1 when `failed > 0`, `errors.length > 0`
  or the element is missing; with no Chrome it prints `skipped: no Chrome found` and exits 0, so the orchestrator
  runs the manual checks of 8.8 instead.

### 6.6 `SIM.smoke()`

The page-side autorun the browser check reads. Taps name EXACT callback data except where a placeholder-free label
is given (the label rule of 6.4): log in as `sister`; Telegram: scan `S1-0002`, START, the four taps of the
simplest sale (`btn_sell_one` by label, `SS|S1-0002|b|none`, `SS|S1-0002|m|CASH`, `SC|S1-0002|ok`) → one SALE row
(cash 18,000); a deposit sale on `S1-0004` (UNIQUE, 45,000, in stock: `btn_sold` by label, `btn_new_customer` by
label, type `ဒေါ်စန်း`, type `09777123456`, `SS|S1-0004|m|CASH`, `SS|S1-0004|p|half`, `SS|S1-0004|d|14`,
`SC|S1-0004|ok`) → one SALE row with cash 22,500, owed 22,500, a new customer and `dueDay` = today + 14 (ဒေါ်စန်း is
new, so no deposit question); App: enrol through the shortcut, `appOpenTagId('S1-0003')`, the stepper's
`S|S1-0003|2`, `SS|S1-0003|b|none`, `SS|S1-0003|m|mix`, `SS|S1-0003|a|KBZ`, type `5000`, `SC|S1-0003|ok` → two rows
in one group (SALE cash 19,000 CASH, PAYMENT 5,000 KBZ) after `syncNow`; log in as `owner`; Laptop:
`setListRow('pay_method', 'WAVE', {active: false})` → the next Telegram how-paid screen has no WavePay; `⏩ +1 ရက်`
× 15 then `🕘 21:00` → the Family group post contains `summary_due_overdue` naming ဒေါ်စန်း; every step counts
`passed`/`failed`, every uncaught error lands in `errors`. (`S1-0006` is sold out in the seed, sim_seed.js:103-104,
and `S1-0005` is a SKU, :42: neither can start a UNIQUE sale.)

## 7. Messages

core_messages.js `MSG`, step 1 adds all of them (drafts composed from words already in MSG; the source key is
given; the family may rewrite any of them in the Messages tab):

```
btn_no_name: '🚫 နာမည် မရှိ'
btn_wallet: '📲 {method}'
btn_bank_transfer: '🏛 ဘဏ်'
btn_paid_all: '✅ အကုန် {amount}'
btn_due_unknown: '❓ မသေချာ'
btn_kind_wallet: '📲 Pay အကောင့်'
btn_kind_bank: '🏛 ဘဏ်အကောင့်'
sale_ask_qty_price: '🔢 ဘယ်နှစ်ထည် ရောင်းလဲ? ({price} ကျပ် နဲ့)'
sale_ask_method: '💰 ဘယ်လိုပေးလဲ?'
sale_ask_account: '🏛 ဘယ်အကောင့်လဲ?'
sale_ask_split_account: '💵+🏦 ဘယ်အကောင့်နဲ့ ခွဲပေးလဲ?'
sale_ask_paid: '💰 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)'
sale_ask_due: '📅 ကျန် {owed} ကျပ် · ဘယ်တော့ ပေးလဲ?'
sale_ask_kind: '➕ "{label}" · ဘဏ် လား၊ Pay လား?'
sale_need_buyer: 'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်'
sale_line_method: '💰 {method}'
sale_line_mixed: '💰 {cashMethod} {cash} · {method} {bank}'
sale_line_paid: 'ပေးပြီး {paid} · ကျန် {owed}'
sale_due_set: '📅 ကျန် {owed} · {date}'
sale_due_none: '📅 မသေချာ'
sale_gone: '⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ'
sale_bad_amount: '❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ'
summary_due_overdue: '⏰ ရက်လွန် အကြွေး: {list}'
lists_note_kind: 'wallet = Pay အကောင့် (KBZPay, WavePay, QR) · bank = ဘဏ်လွှဲ · ကွက်လပ်ထားရင် wallet · BANK ကုဒ်က bank'
settings_note_sale_flow: 'steps = တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက် ရောင်း'
```

| Key | Source words | Where |
|---|---|---|
| `btn_no_name` | `btn_design_none '🚫 ကုဒ် မရှိ'` :226, `ask_name` :80 | Q1 |
| `btn_wallet` | the glyph of `btn_app '📲 အက်ပ်'` :184, the shape of `btn_bank '🏦 {method}'` :131 | Q2, Q3 |
| `btn_bank_transfer` | `summary_cash` :205 ('ဘဏ်'), the glyph of `btn_accounts '🏛 အကောင့်'` :395 (not 🏦: the round-4 rule; not 🏧: an ATM) | Q2 |
| `btn_paid_all` | `btn_all 'အကုန် {amount}'` :44 with ✅ (`btn_yes` :28) | Q4 |
| `btn_due_unknown` | `ms_low_hint` :342 ('မသေချာ') | Q5 |
| `btn_kind_wallet`, `btn_kind_bank` | `lists_note_list` :415 ('Pay အကောင့်'), `acct_title` :396 ('ဘဏ်အကောင့်'), the glyphs of :184 and :395 | Q2+ (the kind question); `btn_kind_wallet` also on Q2 when the wallets do not fit (1.2 Q2) |
| `sale_ask_qty_price` | `ask_qty` :18, `split_ask_amount` :378 ('နဲ့') | Q0b |
| `sale_ask_method` | `exp_ask_method` :164 ('ဘယ်လိုပေးလဲ?') | Q2 |
| `sale_ask_account` | `split_ask_bank` :377 ('ဘယ်အကောင့်'), glyph :395 | Q3 (`bank`, `more`) |
| `sale_ask_split_account` | `split_ask_bank` :377 without its `(ပေးငွေ {cash})` (nothing is paid when the account is chosen) | Q3 (`mix`) |
| `sale_ask_paid` | `credit_ask_paid` :97 with the 💰 of `pay_ask_amount` :104 in place of 💳 (a plain cash sale must not end on a credit glyph; `credit_ask_paid` stays on the CR path) | Q4 |
| `sale_ask_due` | `credit_done` :99 ('ကျန်'), `ord_ask_due` :236 ('ဘယ်တော့'), `pay_ask_amount` :104 ('ပေးလဲ?') | Q5 |
| `sale_ask_kind` | `add_done` :391, `ord_ask_viber` :220 ('လား?'), `lists_note_list` :415 | Q2+ |
| `sale_need_buyer` | `btn_credit` :41 ('မကျေသေး'), `credit_ask_customer` :98 ('ဝယ်သူ'), `ask_name` :80, `app_need_online` core_sync.js:101 ('လိုပါသည်') | Q1 (needBuyer) |
| `sale_line_method`, `sale_line_mixed` | `split_done` :379 without ' · မှတ်ပြီး' | header |
| `sale_line_paid` | `receipt_total` :122 | header |
| `sale_due_set`, `sale_due_none` | `ord_due_set` :237 (📅), `credit_done` :99 ('ကျန်'), `ms_low_hint` :342 | summary, card, receipt |
| `sale_gone` | `card_sold_out` :11 ('ရောင်းပြီးသား'), `rejected` :70 ('မမှတ်ပါ') | S✖ |
| `sale_bad_amount` | `split_bad` :382 with `{min}` | Q3c, Q4 |
| `summary_due_overdue` | `summary_orders_overdue` :369, `summary_overdue` :208 | 21:00 |
| `lists_note_kind` | `lists_note_list` :415, `lists_note_shop` :420 ('ကွက်လပ်ထားရင်'), `lists_note_key` :416 ('ကုဒ်') | the Lists header note |
| `settings_note_sale_flow` | `btn_meas_chat '💬 တစ်ခုချင်း မေး'` :331, `menu` :89 ('ခလုတ်'); `တစ်ဆင့်ချင်း` and `တစ်ချက်` are new words for the owner to confirm; a Settings-tab note, never a button | setupSheet nicety |

Reused verbatim (no new key): `btn_back`, `btn_cancel`, `btn_skip`, `btn_other`, `btn_half`, `btn_yes`, `btn_cash`,
`btn_bank`, `btn_split`, `btn_add_bank`, `btn_more`, `btn_new_customer`, `btn_create_named`, `btn_days`,
`btn_due_type`, `btn_type_qty`, `btn_discount`, `btn_undo`, `btn_receipt`, `btn_pay`, `btn_phone`, `btn_acct_number`,
`btn_use_deposit`, `btn_no_deposit`, `confirm_sale`, `confirm_ask`, `credit_ask_customer`, `cust_find`, `cust_pick`,
`cust_none`, `ask_name`, `ask_qty`, `ask_qty_number`, `ask_sale_price`, `ask_number`, `bad_qty`, `ord_ask_phone`,
`split_ask_amount`, `ord_ask_due_text`, `ord_bad_date`, `sold_done`, `credit_done`, `cust_attached`, `method_done`,
`split_done`, `credit_use_deposit`, `deposit_applied`, `acct_detail_hint`, `add_ask_pm`, `add_done`, `add_exists`,
`add_unavailable`, `expired`, `tag_not_found`, `card_sold_out`, `card_buyer`, `summary_overdue`, `receipt_transfer`.
(`credit_ask_paid` and `split_ask_bank` are no longer used by the guided flow; they stay for the CR and SX paths.)

Rule check: no `btn_*` key above contains `ငွေသား`, `KBZPay`, `WavePay` or `ဘဏ်လွှဲ`, and none starts with `🏦 `
(`lists_note_kind` is a header note, not a button; `btn_wallet` is filled with the account's own label at run
time). run_wizard.js step 23 asserts it over the keys above.

app/app_i18n.js `APP_MSG` (step 3): `ui_btn_pick_date: '📅 ရက်စွဲ ရွေးပါ'` (`btn_due_type` :240, `lists_note_list`
'ရွေးပါ'), `ui_date_title: '📅 ရက်စွဲ'`.

core_report.js (step 1, a code constant, not MSG): the column header `ပေးမည့်ရက်` (NEW: the pattern of
`ord_ask_due '📅 ရွေးမည့်ရက် …'` :236 with `ပေး` of `credit_done` :99).

## 8. Tests

Conventions (SPEC-round-4.md section 12): plain Node, `vm.runInThisContext` in bundle order, numbered steps,
`check(cond, label, detail)`, labels from `MSG`, the 64-byte listener, `N passed, M failed` + exit code. Every
check below is phrased so that it is red without its feature. No existing check is edited except the five of 8.6.
Dates in checks are RELATIVE to the bench clock (`BASE` = today 04:00Z, run_round4.js:36; the suites run on any
day): "ten days ahead" means `addDaysKey(today, 10)`, typed as `d.m.yy` through a small formatter in the file.

### 8.1 poc/run_wizard.js (new, step 1; the designs called it run_round5)

Loader: the eight core files + core_orders + sim_mock_ai, sim_ports, sim_seed (run_round4.js:21-26). `bench()`
copied from run_round4.js:47-137 with: `world.settings.sale_flow = 'steps'` after `simSeedLists` (and
`bench({quick: true})` leaves `quick`), `setAccounts(list)` copying each account's `kind` onto the row it builds
(run_round4.js:80-84 builds rows with a fixed field list and would drop it, so every bank-account check would
silently see wallets), the fixed BASE clock, a wrapper around `world.ports.chat.editMessage` that records
`{messageId, isCaption}` for every edit into `edits[]` (step 24), and a `world.listeners` entry counting `chat`
events with `edited === true` per message id (`editsOf(id)`, step 13; `sim_ports.editMessage` only sets a boolean,
:315-316, so a count must come from the events). Helpers: `guided(u, itemId, answers)` (scan, tap the card, then
each answer: a string starting with a callback prefix (`SS|`, `SC|`, `LA|`, `S|`) is tapped by data, a MSG key by
`sim.buttonByKey` (the label rule of 6.4), `{type: '…'}` is typed), `screen(u)` = `{text, datas, texts}` of the
last bot message, `ledgerLen()`, `errorsOf(w, where)`. The seed's UNIQUE pieces in stock are `S1-0001` (25,000),
`S1-0004` (45,000) and `S2-0001` (45,000); `S1-0006` is sold out by the seed (sim_seed.js:103-104) and `S1-0005` is
a SKU (:42): no step taps `btn_sold` on either.

1. **Nothing before ✅**: scan `S1-0002`, `btn_sell_one`, `btn_no_name`, `btn_cash`, `SC|S1-0002|ok`:
   `world.ledger.length` and `world.customers.length` unchanged at every screen; the card message was edited (same
   id) at every step and its text ends with `credit_ask_customer` + `cust_find`, then `sale_ask_method`, then
   `sale_ask_paid` + `confirm_ask`; the first screen's data rows are `[SS|S1-0002|b|none]`, up to four
   `SS|S1-0002|b|C-…`, `[SS|S1-0002|b|new]`, `[SS|S1-0002|back|buyer, SS|S1-0002|z]`; the state has `kind 'sale'`,
   `step 'buyer'`, `item 'S1-0002'`, `draft` deep-equal `{qty: 1}`, `hist` `[]` and `msgId === card.id` (compared
   field by field, not as one literal); ✅ writes exactly one SALE row (qty −1, cash 18,000, method CASH,
   customerId '', dueDay '', note '') and the card reads `sold_done` with data rows `[U|g, RC|g]` only; `getState`
   null; `lg:<uid>` set.
2. **The count**: the SKU card keeps `S|id|1` and `Q|id` (byte-identical `cardKeyboard` in both modes); `Q|id` in
   steps mode sends the grid with `SS|S1-0002|q|2..9` and the last row `[QN|…, D|…, SS|…|z]`, and the state's
   `msgId` is the grid's id (not the card's); ၃ → the buyer screen with `draft.qty 3`, `hist ['qty']` and
   `confirm_sale` showing ၃ ထည် and 54,000; typed `3` on a fresh grid WITHOUT ✏️ → the same buyer screen as a NEW
   message with `qty 3` (no AI call: `world.ai` records none); `btn_type_qty` + typed `4` → the buyer screen as a
   NEW message with `qty 4`; typed `0` → `bad_qty` with the back row, state kept; UNIQUE `S1-0001` goes from
   `btn_sold` straight to the buyer screen with `qty 1`.
3. **A changed price**: `btn_discount` on the CARD, typed `15000` on the SKU → the grid with `sale_ask_qty_price`
   showing 15,000 and no 💬; ၂ → the buyer screen with `2 × 15,000 = 30,000` in `confirm_sale`; ✅ writes qty −2,
   unitPrice 15000, amount 30,000, note `'price'`, and `world.ledger.length` was unchanged until ✅ (today's `D`
   path would have written one piece at once). On UNIQUE the typed price goes to the buyer screen at once. Typed
   `0` after 💬 → `ask_sale_price` again, state kept, nothing written. 💬 tapped on the GRID edits the grid in
   place to `ask_sale_price` with `[SS|…|back|qty, SS|…|z]` (no new message); `back|qty` there → the grid again on
   the same message with its digits live (a ၂ tap works).
4. **Buyer**: typed `ဒေါ်မြင့်` (exact) picks C-0001 with no new row and goes to how-paid; typed `ဒေါ်မြ` shows
   `cust_pick` with `SS|…|b|C-0001` and `btn_create_named`; `create` keeps the name and asks `ord_ask_phone`
   with `[SS|…|ph|skip]` (not `Z`); typed `09 777 123456` (nobody has it) re-asks with `cust_none` and creates
   nothing; typed `12` → `cust_none`, nothing created and no `newName` (digits are never a name); typed `5678`
   (the last four digits of ဒေါ်မြင့်'s number) → `cust_pick` with `SS|…|b|C-0001` and NO `btn_create_named`;
   typed `09 123 456 78` (ဒေါ်မြင့်'s number) picks her; a new name `ဦးသန့်` → `ord_ask_phone`; typed `123` →
   `ord_ask_phone` again; typed `09 123 456 78` there → `cust_pick` offering ဒေါ်မြင့် and `btn_create_named`, and
   `create` → how-paid with `newName 'ဦးသန့်'` and `newPhone '0912345678'` kept (no Q1d again); on another bench the
   new name + typed `09 555 000 111` → how-paid; `world.customers.length` unchanged until ✅, then one more row with
   phone `09555000111` and the sale carries its id; `skip` leaves `phone ''` and the sold card carries `phoneRow`;
   the state after `skip` is still a sale state.
5. **How paid** (seed lists): data rows `[m|CASH] [m|KBZ] [m|WAVE] [m|bank] [m|mix] [LA|pm|SSA|S1-0002] [back, z]`
   with texts `btn_cash`, `📲 KBZPay`, `📲 WavePay`, `btn_bank_transfer`, `btn_split`, `btn_add_bank` (six answers);
   `bank` with one bank (BANK by name) skips the account screen → `sale_ask_paid`; `setAccounts` with `AYA` and
   `CB` of kind bank → `sale_ask_account` with two `btn_bank` rows and `[LA|pm|SSA|…]`; with no bank-kind account
   the `bank` button is absent; `setAccounts` with THREE wallets and BANK → `[m|CASH] [m|more] [m|bank] [m|mix] [LA]
   [back, z]` where the `m|more` text is `btn_kind_wallet` (five answers, never seven); four wallets and no bank →
   `[m|CASH] [m|more] [m|mix] [LA] [back, z]`; `more` → `sale_ask_account` listing the wallets as `btn_wallet` rows;
   `mix` on the seed lists KBZ, WAVE and BANK (`btn_bank` for BANK) under `sale_ask_split_account` (no
   `(ပေးငွေ`); `setAccounts` with six wallets, `more` → four `btn_wallet` rows, `[a|p1]` with text `btn_more`, `[LA]`
   (six answers), and `a|p1` → the remaining two, `[LA]`, no ▶️; a `mix` on those six → the same paging.
6. **Mixed**: `mix` → KBZ (three candidates, so the account screen) → `split_ask_amount` with `[btn_half]`, the
   state `await_number sale_step`; typed `10000` of 18,000 → `sale_ask_paid` with `[btn_paid_all] [10,000 →
   p|bank] [✏️]` (no half: 9,000 < 10,000); ✅ writes SALE (cash 8,000, CASH, 'split') then PAYMENT (10,000, KBZ,
   refGroupId = group, 'split') in one group; `saleGroupInfo.owed 0`; `groupMethods` two entries; `dayStats` CASH
   +8,000 and KBZ +10,000; `receiptText` contains ' (ငွေသား 8,000 · KBZPay 10,000)'; `rewriteCheck` answers
   `complex`; `undoGroup` within 30 min nets every bucket to 0 and restores stock; typed `18000` on the amount
   screen → not mixed (one row, method KBZ); typed `0` → `sale_bad_amount` with min 1 and the back row
   `[SS|…|back|bank, SS|…|z]`, state kept. On another bench: `mix` → KBZ → typed `5000` → `sale_ask_paid`; typed
   `9000` on that screen WITHOUT ✏️ → the buyer screen with `sale_need_buyer`; `ဒေါ်မြင့်` → `sale_ask_due`; `၁၄ ရက်`;
   `btn_yes` → SALE (cash 4,000) + PAYMENT (5,000), owed 9,000, and the card's `credit_done` says `ပေးပြီး 9,000`
   (cash + payments, not 4,000). A spoken 'ငွေသား ငါးထောင်' (the mock answers method CASH) at the amount screen of
   an 18,000 mixed sale stores `bankPart 13,000`.
7. **The seven outcomes** (section 2.2, one check per row, each a direct `commitSaleGroup` call): cash full; wallet
   full; one method part (0 and half; `cash 0 → method ''`); mixed full; mixed part (DueDay on the SALE only);
   mixed with the bank part equal to paid (one row, method KEY, 'credit'); mixed with `method 'KBZ', mixed true,
   bankPart 0` → one row whose method is `CASH` (the `payKey` rule, not KBZ); a date chosen with a full payment is
   dropped (`dueDay ''`); a bargained part sale carries 'credit', not 'price'.
8. **Part without a buyer** (UNIQUE `S1-0004`, 45,000): `btn_sold`, `btn_no_name`, cash, `half` → the buyer screen
   without `btn_no_name` and with `sale_need_buyer`; typed `ဒေါ်ခင်` → `sale_ask_due` (never how-paid again) with
   `[7 ရက်, 14 ရက်, 30 ရက်] [btn_due_type, btn_due_unknown] [back, z]`; `SS|…|d|14` → the summary with
   `sale_line_paid` and `sale_due_set` (`fmtDayMy(addDaysKey(today, 14))`) and `[SC|…|ok] [back, z]`; `btn_yes` →
   one SALE row (cash 22,500 of 45,000, customerId C-0002, dueDay = that key, note 'credit'); the card has
   `credit_done`, `sale_due_set`, `[U, RC] [PY]`, and since ဒေါ်ခင် holds 300,000, the `credit_use_deposit` question
   with `[CD|g|yes|p, CD|g|no|p]` only; `yes` → one DEPOSIT_APPLIED row in the group, `deposit_applied`, the card
   redrawn with the plain rows (no `CR|`, `CU|`, `PM|`, `SX|`, `LA|`); on another bench `no` → the plain rows and
   no write; on a third bench the buyer-needed screen answered with `btn_new_customer`, typed `ဒေါ်စန်း`, typed
   `09 777 123 456` → `sale_ask_due` as well (the typed path exits through `saleNext`), and ✅ creates the customer
   (no deposit question: she is new).
9. **Due typed and unknown**: `btn_due_type` → `ord_ask_due_text` with the back row; typed `32.13.26` → `ord_bad_date`,
   state kept; yesterday typed as `d.m.yy` AND as `d.m` (no year: `noRoll` keeps it in this year) → `ord_bad_date`
   both times; a date 400 days ahead → `ord_bad_date`; ten days ahead typed as `d.m.yy` → the summary as a new
   message with that date; the same day as `yyyy-mm-dd` → the same key; ten days ahead typed on the DUE screen
   (buttons, no ✏️) → the summary too; `btn_due_unknown` → `dueDay ''` and `sale_due_none`.
10. **Overdue by DueDay**: a part sale due in 7 days: `openCredits(...).overdue === false`; `tick(8 * 1440)` →
    `overdue === true` and `daysOver 1` while `days < OVERDUE_DAYS`; `buildDailySummary` has `summary_due_overdue`
    naming the buyer with the date and `၁ ရက် လွန်`, and the seeded undated 500,000 credit still under
    `summary_overdue` with identical text; a part sale with `dueDay ''` at 29 days is not overdue.
11. **Back**: from the summary back → due → paid → method → buyer → the item card (`cardText`, `cardKeyboard`,
    state null); back from the due screen then forward again shows no stale `sale_due_set`; back after a skipped
    account screen returns to how-paid; from the buyer screen of a grid-started flow → the grid redrawn in place
    (with the price line when one was typed); the back buttons of two successive screens tapped within 120 s
    move two screens, while the SAME back button tapped twice moves one (the second carries a step the state has
    left: no edit, no Errors row); from the item card reached by back, `S|id|1` again within 120 s starts the flow
    once more (`world.ledger.length` unchanged, the card edited into the buyer screen: `S` is exempt from the
    mutating-tap guard in steps mode); the ➕ prompt opened on how-paid carries `[SS|…|back|method, SS|…|z]` and
    its back → how-paid with the sale state restored; the ➕ prompt opened on the ACCOUNT screen (after `mix`)
    carries `back|account` and its back → the account screen, where `SS|…|a|KBZ` is still live (rule (c) passes);
    `back|kind` after a name typed from the account screen → the account screen, `addLabel` dropped; on the part
    path (`half` → buyer-needed → `ဒေါ်ခင်` → due) back from the due screen → the buyer screen STILL without
    `btn_no_name` and with `sale_need_buyer` (`needBuyer` survives), and back once more → `sale_ask_paid` with
    `paid` cleared.
12. **Cancel**: `SS|…|z` on how-paid → the message is `cardText + cardKeyboard`, state null, no row; `z` on the
    grid and on the price prompt (from the card and from the grid) → the item card on that message, state null;
    `z` on the ၂..၉ grid LEFT BEHIND after the card was tapped again (the flow is on the card) → the grid says
    `expired`, the live state and the card unchanged; mid-flow `M|exp` then `z` on the old guided screen → that
    screen says `expired` and the expense state is intact (`kind 'exp'`); `z` on a guided screen with no state at
    all → the card, no Errors row; `Z` elsewhere still answers `cancelled`.
13. **Stale, double, expired**: a second `S|id|1` on the same card within 120 s neither writes nor edits and
    keeps the state (`editsOf(card.id)` unchanged, `JSON.stringify([text, keyboard])` identical); a tap on the
    ၂..၉ grid left behind after the card was tapped again → that grid message says `expired`, the live screen is
    untouched; a tap on an earlier screen after a typed answer moved the flow → that message says `expired`, the
    live state unchanged; `SS|…|m|CASH` on the live message while the state is at `due` → nothing changes (no
    edit, no Errors row); two ✅ on the same message within 120 s write one group; ✅ after `tick(31)` → `expired`
    on the message and a fresh item card as the last message, nothing written; `tick(3)` (past the 120 s guard)
    then `SC` replayed on the sold card → a new `expired` message, the card kept; `tick(11)` (past the 600 s of
    `isCommittedCard`) then `SC` again → still a new `expired` message, the sold card still kept (the `sold_done`
    text rule); a scan of another tag mid-flow clears the state and the old screen's buttons answer `expired` + card.
14. **Sold meanwhile**: UNIQUE `S1-0001` reaches the summary on the sister's chat; the owner sells it first on the
    same world; the sister's ✅ edits her message to `card_sold_out` + `card_buyer` + `sale_gone` with
    `cardKeyboard` and writes nothing. On another bench the owner sells `S1-0004` first and the sister's FIRST tap
    (`btn_sold` on her stale card) answers the same S✖ screen at once with no state. A SKU below zero still writes.
15. **➕ inside the sale**: `LA|pm|SSA|S1-0002` on how-paid edits it to `add_ask_pm` with `[SS|…|back|method,
    SS|…|z]` and keeps the sale in `saved`; typed `AYA ဦးမောင်` → `sale_ask_kind` with `[k|wallet, k|bank]` and
    NO Lists row yet; `bank` → one row with `kind 'bank'`, the next screen `sale_ask_paid` prefixed `add_done`,
    `draft.method` = the new key, the sold card carrying `acct_detail_hint` and `[LD|pm|<key>]`; the next sale's
    how-paid shows the account behind 🏛 ဘဏ် only; on another bench `wallet` → the next how-paid shows it by
    name; typed an existing label (`KBZPay`) → `add_exists`, no kind question, no second row, the method chosen;
    typed `5000` → `add_ask_pm` again; `back|kind` → how-paid with `addLabel` dropped and no row; on another bench
    `mix` → the account screen → `LA|pm|SSA|…` (its prompt carries `back|account`) → typed `CB ဦးကျော်` → `bank` →
    the next screen is `split_ask_amount` for the new account (never `sale_ask_paid`), typed `6000`, ✅ → SALE
    (cash 12,000, CASH, 'split') + PAYMENT (6,000, the new key); and `mix` → ➕ → an EXISTING label → `split_ask_amount`
    as well.
16. **Menu survives, scan does not**: `M|today` mid-flow keeps the sale state and the screen's buttons still work;
    `M|find` mid-flow replaces it (`kind 'find'`) and the guided screen's next tap answers `expired` + a fresh card;
    a scan clears it.
17. **Quick switch**: `bench({quick: true})`: scan + `btn_sell_one` writes at once and the card has
    `afterSaleKeyboard`'s rows exactly as run_round4 step 1 (:144-146); `D` + price writes one piece at once;
    `askQty` has `S|id|n` digits and `[QN, Z]`; no `SS|`, `SC|` or `LA|pm|SSA` anywhere; `'QUICK '`, `'Quick'`,
    `'steps'`, `'x'` and a missing key read as the right mode; flipping `world.settings.sale_flow` between two
    sales changes the behaviour without a restart.
18. **Voice unchanged**: `sim.voice(sister, 'ဒါ ၂ ထည် ရောင်းရတယ်')` → the confirm card → `btn_yes` writes as today
    and shows `afterSaleKeyboard` (the corrective rows) in steps mode too; a spoken `ဒေါ်မြင့်` on the buyer screen
    picks her; a spoken `တစ်သောင်း` on the amount screen stores 10,000; a spoken `သုံး` (qty 3) on the grid → the
    buyer screen with `qty 3`.
19. **Owner**: the owner's flow is identical; selling `S2-0001` (shop 2) the owner's buyer screen lists shop-2
    recents and the how-paid screen shop-2 accounts (`setAccounts` gives shop 2 its own wallet first); `V|g` voids
    a guided mixed group (both rows mirrored).
20. **Receipt and reports**: `RC|g` text order (`receipt_total`, `receipt_transfer`, `sale_due_set`,
    `receipt_customer`) on a credit with an account detail; `receiptReport(...).footer` holds the due line above
    `receipt_thanks`; the owed report, the month report and the customer statement each have the `ပေးမည့်ရက်`
    column with `⏰ ` once overdue; `convertSaleToCredit` on a quick sale leaves `dueDay ''`.
21. **Ledger helpers**: `newTx` has 27 keys with `dueDay ''`; `rewriteRows` keeps `dueDay` on the replacement
    (method change, customer attach, note) and leaves the mirror blank; `saleGroupInfo(...).dueDay` reads the live
    row after a rewrite; `CFG.CREDIT_COLS` has 15 names; `creditOverdue` truth table (2.3).
22. **Kind in the core**: `listNormRow` without a kind has exactly eight fields, with `'Bank '` nine with
    `kind 'bank'`, with `'x'` eight; `methodKind` of blank, wallet, bank, the legacy `BANK` key, and `BANK` with
    an explicit `wallet`; `payMethodsByKind` on the seed = `{wallets: ['KBZ', 'WAVE'], banks: ['BANK']}` and a
    13-byte key is dropped as `payMethods` drops it; `listRowToCompact` adds `t` only when set and the round trip
    keeps it; `listsJsonFor` of the seeded lists is byte-identical to the round-4 string; `listUpsert`'s append
    carries `kind`, a later rec with another kind on the same key is `dup`; `addListOptionByLabel(…, {kind:'bank'})`
    stores it and the rec the sim store received has a `kind` key, while `addListOptionByLabel(…)` with no `extra`
    and with `{kind: ''}` hands over a rec whose keys are exactly `['key','label','list','note','shop']`;
    `listFindByLabel` answers `empty`, `existed` (case, spacing, a zero-width space built with `String.fromCharCode`)
    and free; `sim_ports.listOptions` returns no `kind` for a raw row without one; `parseDayText('2026-12-30')`,
    `parseDayText('5.11', now, {noRoll: true})` (this year, even when past) versus without `opts` (next year when
    past), `addDaysKey`, `daysBetweenKeys` work in this load set and are not defined twice (`typeof` in a vm
    context that loads core_burmese alone).
23. **Texts, 64 bytes, no errors**: every key of section 7 is in MSG and non-empty; no `btn_*` of section 7
    contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ or starts with '🏦 '; the placeholders fill (`sale_line_mixed`,
    `sale_bad_amount`, `sale_ask_due`, `sale_due_set`, `sale_ask_paid`); `CFG.LIST_COLS` has one `lists_note_*` each;
    the texts equal the code block of section 7 (read from this file, as run_lists.js:924-930 does); every callback
    emitted in the file is ≤ 64 bytes (the longest `CD|<g>|yes|p|<KEY>`, 58; `SS|S1-0002|back|due_text` is 24);
    the steps mirror of run_round4's last check: "START + one tap asks who bought it; nothing is written before ✅";
    no `handleUpdate` error in any world.
24. **Caption-aware edits**: over every bench of the file, each recorded edit's `isCaption === !!target.photo`,
    where `target` is the message with that id in `world.chats` (every seeded card is a photo message,
    sim_seed.js:86-87, and no `text_cards` setting is seeded, :67-74), and at least one edit with `isCaption true`
    (a guided screen on a card) and one with `false` (a typed-path text message edited by a tap) were seen.
    Red without the fix: `editOrSend` passes `false` on every card today (core_bot.js:381).

### 8.2 poc/run_round4.js (appended, step 1)

One block at the end, before the final count: on a fresh `bench()` (quick) the sale card, the split and the ➕
paths are exactly as the file's step 1-3 assert (a re-run of `sell` + `datas` against the same literal rows),
and `bench()` with `world.settings.sale_flow = 'steps'` set before `sell` makes `sell()` return no row (the
card edited into the buyer screen, `lastRow()` older than the tap): the quick/steps switch is pinned in the suite
that owns the one-tap card.

### 8.3 poc/run_sync.js (appended, step 2)

- A reference phone pushes a mixed guided group (SALE with `dueDay` ten days ahead, then PAYMENT): `ok`, no OVERPAID
  flag, both rows on the server with `dueDay` and `seq`; the undo group of it: `ok`, every bucket nets to 0.
- `syncValidateTx`: `dueDay` absent ok, `null` ok, `''` ok, `'2026-12-30'` ok, `'30.12.26'` malformed, the number
  `20261230` malformed.
- A row without `dueDay` (an old phone) is stored with `''`; a pull to a fresh phone carries `dueDay`;
  `appendSynced` keeps it.
- A list entry with `kind: 'bank'` is applied and the next `lists_json` carries `t: 'bank'`; `kind: 'card'` is
  quarantined `malformed`; `kind: ''` is APPLIED (the server row has no kind: a wallet), never quarantined, and the
  phone's `settingsHash` is untouched; an old-shape entry (no kind) is applied as before; a server whose store
  forward ignores `kind` stores a wallet, no quarantine.
- The outbox holds a `customer` entry before the `group` when a buyer was typed in a guided sale on the reference
  phone, and none when 🚫 was tapped; after one sync the server has the customer and the group's `customerId`
  resolves.
- `sale_flow` typed into `world.settings` after bootstrap reaches the phone at the next pull (hash change) and
  `saleFlow(phone.ports)` reads it.

### 8.4 poc/run_gas.js (appended, step 2; the four named edits of 8.6)

- `setupSheet` on an empty book: the Ledger has `CFG.LEDGER_COLS.length` columns (`getMaxColumns() ≥ 27`), `DueDay`
  last and the whole column `@`; the Credits header is 15 wide; Settings has `sale_flow = steps` and
  `sale_due_presets = 7,14,30`, and the `sale_flow` Key cell carries `settings_note_sale_flow`; Messages has every
  key of section 7; the Lists tab has nine columns, the ninth header `Kind` with `lists_note_kind` and a `list`
  validation over `wallet, bank` from row 2 that allows a blank; the Dashboard overdue cell is
  `=SUMIF(Credits!$O:$O,TRUE,Credits!$L:$L)` with the label `Overdue`.
- **A second run changes nothing**, defined as: after the second `setupSheet`, the `values()`, `format`,
  `validations` and `note` views (poc/fake_gas.js:752) of Ledger, Lists, Settings, Messages and Credits equal the
  first run's, `lastRow()` of Settings and Messages is unchanged (no duplicated default or key), and the Dashboard
  has the same `values()` (it is cleared and rewritten by design, gas_setup.js:448-449; call logs and formats are
  not compared).
- A round-4 book (26 Ledger columns with rows, 8 Lists columns with rows, 13 Credits headers): `setupSheet`
  appends `DueDay` as column 27 and `Kind` as column 9 without moving a header or a row; the Credits header is 15
  wide right after `setupSheet`, before any `refreshViews`; rows read back unchanged. A 20-column tab (spare columns
  deleted by hand) grows the same way through `ensureColumns` (the growth lives in `ensureTab`/`ensureColumns`, 4.1).
- The publish window: on a 26-column Ledger with no `DueDay` header, one Telegram `appendLedger` and one
  `gasSyncTabs.appendRows` succeed (`getMaxColumns` called once per execution), the value sits in column 27,
  `ledgerRows().dueDay` is `''` until `setupSheet` writes the header and the value afterwards.
- `refreshViews` writes 15 Credits cells per row, the `Day` AND `DueDay` columns are `@` and both cells keep their
  `yyyy-mm-dd` strings, `Overdue` is a boolean; `gasStore.listOptions` returns `kind` for a row typed `Bank` and no
  `kind` key for a blank cell (run_gas.js:593's eight-key rule); `addListOption` with `kind` appends a row whose
  Kind cell is `bank`; `gasListValues` on a 9-header tab; `syncSettingsFor` over the real store still equals the
  round-4 compact rows for the seed (no `t`), and carries `t: 'bank'` once an account typed `bank` exists.
- `sendDailySummary` (with `group_chat_id` set and `gasChat` recorded as the file does, run_gas.js:136-141): on a
  book holding a dated credit whose `DueDay` is yesterday and whose Credits tab still says `Overdue FALSE` (written
  before the day passed), the call rewrites the Credits tab first (`Overdue TRUE` on that row) and the recorded
  message holds `summary_due_overdue`; `LockService` is still used in exactly one place (run_gas.js:87-90).
- One `sync` call through the real handler pushing `[customer entry, mixed guided group with dueDay, list entry
  with kind]`: accepted, no quarantine, the Ledger block 27 wide, the Lists row with its Kind, the lock held at
  every Ledger write (the :1148 pattern); every existing lock user still takes the lock exactly once.

### 8.5 poc/run_app.js (appended, step 3)

- `appInputModeFor`: `{kind:'sale', step:'buyer'}`, `'name'` → `'text'`; `'phone'` → `'tel'`; `'due_text'` →
  `'date'`; `'method'`, `'paid'`, `'summary'` → null; `{kind:'await_number', purpose:'sale_step'}` → `'number'`.
- `appQuestionLine('📝 ရောင်း ၁ ထည်\n👤 x\n💰 y\n\n')` → `'💰 y'` (the last non-empty line) and of a one-line text the
  line itself; `appKeypadKeyFor({id: 7}, {purpose: 'sale_step', saved: {step: 'bank'}})` → `'7|sale_step|bank'`,
  and with `saved.step 'paid'` a different key (so the second prompt on one message reopens the keypad).
- On the real app store with `world.settings.sale_flow = 'steps'` pulled: scan, the stepper's `S|S1-0002|2`,
  `btn_no_name`, `mix` → KBZ → typed `5000` → `btn_paid_all`: `store.ledger` gains two rows, ONE outbox `group`
  entry with SALE then PAYMENT, the receipt number on the SALE row only, no `customer` entry; the sync answers
  `ok` without flags; a new buyer typed on the phone → a `customer` entry before the `group` and the server
  resolves the sale's `customerId` after sync.
- The guided state survives a restart over the same adapter mid-flow (the `sale_price` precedent, run_app.js:
  205-217) and the next tap continues.
- The per-device pref `setting:sale_flow = 'quick'` makes the next `S|id|1` commit at once on that phone while the
  server says `steps`.
- `bootApp` is not run (no DOM): a source check (the way run_lists.js:924-930 reads a document) requires
  `app/app_ui.js` to contain `opts.online ||` and its `appDoEnroll` body not to contain `navigator.onLine`,
  `appRenderMsg` to set `'data-cb'` and read `SIM_HOT`, `appStepper` to set `'data-cb'`, and `app/app.css` to
  contain `.sell.hot`.

### 8.6 Existing checks that change (named here, D9; the only edits allowed)

| File:line | Label | Today | Change | Why |
|---|---|---|---|---|
| poc/run_lists.js:703 | `<label>: the returned rows and the two appended ledger rows are equal in every field` | `Object.keys(b.row).length === 26` | `=== 27` | `newTx` carries `dueDay` (2.1) |
| poc/run_gas.js:421-427 (`defaultLists`), compared at :441 | `seeded with today's lists: 4 methods (CASH first), 9 expense categories (other last, each with its emoji), 3 fabrics` | eight-cell rows | a ninth cell `''` in the three `rows.push` calls | the seed writes `header.length` cells (gas_store.js:297) |
| poc/run_gas.js:456 | `the seed is one setValues block from row 2, never appendRow` | `c.cols === 8` | `c.cols === 9` | the Lists tab is nine wide |
| poc/run_gas.js:463-464 | `List and Shop are dropdowns from row 2 that reject other input (a blank Shop stays allowed)` | `L.validations('list') === 2 * 999` | `=== 3 * 999`, label 'List, Shop and Kind are dropdowns …' | the `Kind` dropdown is a third `list` validation |
| poc/run_gas.js:520 | `each nicety has its own try/catch: when the tick boxes fail, the tab is still seeded and gets its dropdowns, notes and highlights, and setup goes on` | `L.validations('list') === 1998` | `=== 2997` | the same third dropdown (all three designs missed this line) |
| poc/run_gas.js:540-557 (the `expected` rows of the custom-Settings seed), compared at :557 | `seeded from them: the method_AYA label, the custom categories plus other, the custom fabrics as f1 f2` | eight-cell rows | a ninth cell `''` (the Kind) in each expected row | the seed writes `header.length` cells, as at :421-427 (found by the step-1 builder, revision 2.1) |

run_gas.js:466-467 (`each of the eight header cells carries its Burmese note`) iterates `CFG.LIST_COLS` and stays
green once `lists_note_kind` exists; its label may be reworded to "each header cell" (a label, not logic).

### 8.7 Why everything else stays green

- `seedSimWorld` sets `sale_flow: 'quick'`: run_scenario.js (327; :60, :64, :66, :431-443, :750-755, :757-771 and
  every other sale), run_round4.js (338; :144-148, every 2*, 3*, 9b/9c, and :1965-1967 "nothing is asked before the
  commit"), run_app.js (186; steps 6, 9, 23, 25), run_sync.js (307; S1 :185-189), run_lists.js (236; the one bot
  sale at :895) all drive the one-tap card as today. `cardKeyboard` and `askQty` without opts are byte-identical.
- The optional `kind`: run_lists.js:592 (compact keys `k,l,a,o,s,d`), :869 and :1003 (exact eight-field rows),
  run_gas.js:593 (eight keys from `gasStore.listOptions`), :1094-1098 (compact pay_method rows), run_sync.js:820 and
  run_app.js:646 (a list entry's rec keys, exactly `['key','label','list','note','shop']`) stay green because no
  seeded or round-4 row has a kind and `kind` is added to a rec only by the conditional line of 2.4 (never as
  `kind: undefined`).
- Header checks read `CFG.LIST_COLS` and `CFG.LEDGER_COLS` (run_gas.js:439-440, :466, :1148), run_gas has no pin on
  the Dashboard overdue formula or on `Credits` width (grep `Overdue`, `CREDIT_COLS`: none), run_gas 16b taps only
  `M|acct`, `LA|pm|AC` and `LD|pm|<key>` (:1413-1434) and never sells; `insertColumnsAfter` is an `OTHER_WRITES`
  entry of the fake, not a value write (poc/fake_gas.js:141-143), so the growth inside `ensureTab`/`ensureColumns`
  changes no write count the suite pins.
- Sync: `dueDay` is optional in validation, the checksums ignore it, `syncSettingsFor` is unchanged, run_sync S18
  never reaches `appendRows` (it stubs `gasSyncServerPorts`).
- `parseDayText`, `addDaysKey`, `daysBetweenKeys` keep their names and bodies (the ISO branch and the optional
  `opts` are additions; every existing call passes two arguments and keeps the roll); every loader loads
  core_burmese before core_orders.
- `editOrSend`'s sixth argument defaults to `false`; its five existing callers (core_bot.js:1151, :1198, :1244,
  :1856, :1862) pass nothing.
- `world.clockOffsetMs` is 0 on every world the suites build; `nowOverride` wins when set (sim_ports.js:22).

### 8.8 Manual browser checks (Node cannot run them; the step-4 builder lists them, the orchestrator runs them)

On `poc/dist/pos-simulator.html` opened from disk: the login screen; log in as Seller shop 1 → ✈️: the sell tour
end to end with the next button highlighted at each step and the highlight surviving the redraws; 📱: enrol
through the Telegram code, the same sale on the app (the stepper is the count and its sell button is highlighted
by the tour, the text bar on the buyer screen, the numeric keyboard on the phone step, the keypad opening on the
mixed amount screen AND again after ✏️ အခြား with the question line as its title, the date sheet on `due_text`
sending `yyyy-mm-dd`); the Ledger tab shows the rows from both routes; Owner → 💻: edit a Label and a Kind on the
Lists tab and see the next how-paid screen in Telegram and, after sync, in the frame; `⏩ +1 ရက်` × 8 then
`🕘 21:00`: `summary_due_overdue` in the Family group, and a Telegram message sent after the jump carries the moved
time (the clock is an offset, not frozen); the measurement form opens inside the frame at phone width and in two
columns at laptop width; the `sale_flow` switch flips both devices; Reset returns to the login screen, the device
bar shows no enrolled frame, the owner's `📱 ဖုန်းများ` lists none, and a frame opened afterwards enrols cleanly (no
`ui_err_auth`); no console error, `SIM_ERRORS` empty. With the network OFF (the file opened from disk in airplane
mode): the page loads with fallback fonts, the Telegram phone works, the 📱 frame enrols through the code and syncs
against the in-page server (no `ui_enroll_offline`; the chip reaches `ui_sync_synced`). `?autorun=smoke` shows
`failed: 0` in `#smoke`. On `app/dev/index.html`: the date sheet sends `yyyy-mm-dd` and the summary shows the day;
the `sale_flow` checkbox flips the app.

## 9. Build steps and file ownership

Nobody edits a file outside their step's list; a needed change elsewhere goes into the report. Each builder's
checker: the suites named below end `0 failed`; every changed `core_*.js`, `app_*.js`, `sim_*.js` passes
`npx acorn@8 --ecma5 <file>` (the orchestrator's convention, map-glue L); every new global of section 3.4 is
grepped before it is added; `node tools/bundle_gas.js` and `node tools/build_app.js` run.

1. **Core** (first, alone): `apps-script/core_config.js`, `core_burmese.js` (the date helpers in, the ISO branch,
   the `opts.noRoll` argument), `core_orders.js` (the three date helpers out, nothing else), `core_ledger.js`,
   `core_messages.js` (every key of section 7), `core_report.js`, `core_bot.js`; `poc/sim_ports.js` (`listOptions`
   kind when set, `setListRow`, `world.clockOffsetMs` in `now()`, `sim.buttonByKey`, `sim.tapLastByKey`),
   `poc/sim_seed.js` (`sale_flow: 'quick'`), `poc/run_wizard.js` (new), `poc/run_round4.js` (the appended block of
   8.2 only), `poc/run_lists.js` (the one named edit at :703 only).
   Checker: `node poc/run_wizard.js` 0 failed; run_scenario 327, run_round4 338 + the block, run_lists 236,
   run_app 186, run_sync 307, all unchanged and green. run_gas is expected RED between step 1 and step 2 (a 27-wide
   Ledger header on a 26-column fake sheet); step 2 makes it green again; nothing is published in between.
2. **Glue and sync** (after 1, in parallel with 3): `apps-script/gas_setup.js`, `gas_store.js`, `gas_sync.js`,
   `gas_main.js` (`sendDailySummary` refreshes the views, 2.3), `core_sync.js`, `poc/fake_gas.js` (no new member
   expected), `poc/run_gas.js` (the four named edits + 8.4), `poc/run_sync.js` (8.3), `poc/sim_sync.js` and
   `poc/sim_phone.js` (no change expected). Checker: `node poc/run_gas.js`, `node poc/run_sync.js` 0 failed;
   `node tools/bundle_gas.js`; run_wizard, run_scenario, run_round4, run_lists unchanged and green.
3. **App** (after 1, in parallel with 2): `app/app_ui.js` (section 5), `app/app_i18n.js`, `app/app.css`,
   `app/dev/index.html`, `poc/run_app.js` (8.5). Not `app/config.js`, not `tools/`. Checker: `node poc/run_app.js`
   0 failed; `node tools/build_app.js` loads; the dev-page checks of 8.8.
4. **Simulator v2** (after 2 and 3): `poc/build_simulator.js`, `poc/simulator.template.html`, `poc/sim_ui.js`,
   `poc/sim_tours.js` (new), `poc/check_simulator.js` (new), `poc/check_simulator_browser.js` (new). **First act,
   before any tour is written:** publish a 20-line probe artifact (a page with an `<iframe srcdoc>` child that writes
   `String(!!parent.SIM)` and the result of a `parent.SIM.ping()` call into the page) and read it back through the
   artifact host, because the transport of 6.2 calls `parent.SIM.server.handle` synchronously and that was verified
   only over `file://` (an `about:srcdoc` child under a host iframe without `allow-same-origin` would get an opaque
   origin and `parent.SIM` would throw). If the probe fails, the transport becomes a `postMessage` round trip (the
   frame posts `{api, body, id}`, the page answers; 6.2's boot snippet changes, nothing else does) and the report
   says so. Checker: `node poc/build_simulator.js`, `node poc/check_simulator.js` 0 failed,
   `node poc/check_simulator_browser.js` (0 failed, or `skipped`), the browser checks of 8.8, then publish the artifact.
5. **Docs** (last, alone): `apps-script/README.md` (section H: `DueDay`, `Kind`, `sale_flow`, `sale_due_presets`,
   the Credits tab as a snapshot refreshed by writes, the push batch, the 21:00 summary and `rebuildViews`; section
   I: the migration of 4.5), `app/README.md` (the guided sale on the phone, the date sheet), `docs/USER-GUIDE.html`
   (the step-by-step sale, the simulator), `POS-PROJECT-PLAN.md` Appendix F.

Parallelism: 2 and 3 touch disjoint files and both need only step 1; 4 needs the app bundle of 3 and the sync of 2;
5 needs everything. Each report names the suite counts after the step and any file it needed but did not own.

## 10. Deliberately not built

- Anything new on voice beyond the six routing lines of 3.4 (D7); no new intents; the voice sale keeps the
  corrective after-sale card.
- A separate "full or part" yes/no screen (the amount screen with `confirm_ask` is the one question), a
  summary screen on the full-cash path, or a commit from a typed amount.
- `Z` inside the guided flow (every guided screen cancels with `SS|<item>|z` into the item card); a `Z` that
  restores a saved state; a virtual `add` step (the nested prompts carry the back button of their screen).
- One lock around the buyer row and the ledger group on the Sheet (two writes are not a transaction either way;
  a stray Customers row is harmless, 2.6).
- A per-phone `sale_flow` toggle on the app's Settings screen (the pref `setting:sale_flow` works and is tested;
  the brief puts the switch on the laptop); a Settings tab, a Devices tab or an editable Customers phone in the
  simulator (D8's list plus the clock and the switch only).
- A Kind `set` op in `listUpsert`/`gasListsPersist` (a Kind is set at append or as a laptop cell); a Kind for
  expense categories or fabrics; asking the kind on the other ➕ paths (PM, EM, SXM, ODM, OXM, AC create wallets;
  the laptop corrects); renaming, hiding or reordering options from the phone; a Key rename in the simulator.
- Moving `settingList`/`duePresets` out of core_orders.js; the orders' `due_presets` for the sale (it has
  `sale_due_presets`); a `noRoll` for the orders' typed dates (they keep rolling a yearless past date forward).
- Editing one answer after the commit (undo within 30 minutes and sell again); the corrective buttons are
  reachable in `quick` mode and on the voice card; attaching a buyer, converting to credit, changing the method or
  splitting a guided sale from its card (D3).
- DueDay on PAYMENT rows, reminders to buyers, a "due soon" summary line for sale credits, SMS/Viber links; a due
  date on the pay list buttons (`creditButtons`, core_bot.js:1684-1685); a Credits tab recomputed by a time trigger
  other than the 21:00 summary.
- Several tags on one receipt; a discount in percent; two accounts in one mixed payment; splitting a PAYMENT or a
  DEPOSIT; owner-only steps in the flow (both roles sell the same way); owner approval of buyers created by
  sellers; merging look-alike customers.
- `onEdit` on the Customers tab bumping `Rev` (a laptop-typed phone reaches phones at the daily full-masters pull,
  as today).
- A camera scanner inside the simulator's frames (`jsQR` left out; the rack click is the scan); photos in the
  in-page app (the fake server's thumb hook returns strings the app ignores); a Telegram Desktop pane; inlining
  the fonts into the artifact (the Google Fonts link stays; offline falls back to the system Myanmar font); a
  frozen demo clock (the suites keep `nowOverride`, the page uses the offset).
- An automated ES5 or invisible-character scan of the sources (the acorn run and the `String.fromCharCode` rule
  stay the orchestrator's conventions).
- Raising `app_min_version`: nothing new is required of a phone.
