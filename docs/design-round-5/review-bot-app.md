# Review of SPEC-round-5.md — lens: BOT UX AND APP (2026-11-12)

Adversarial walk of the guided sale (SPEC sections 0, 1, 2.2, 2.6, 3.4, 5, 7, 8.1, the relevant rows of 6.6) against
`apps-script/core_bot.js`, `core_ledger.js`, `core_messages.js`, `core_burmese.js`, `core_orders.js`, `core_report.js`,
`app/app_ui.js`, `app/app_i18n.js`, `app/app_ports.js`, `app/app_store.js`, `app/app_sync.js`, `apps-script/gas_telegram.js`,
`poc/sim_ports.js`, `poc/sim_seed.js`, `poc/run_round4.js`. Line numbers are those of the tree on 2026-11-11 (round 4
built, unpublished; the spec was last written 21:09 that day, no source file changed since). Burmese is quoted from
`MSG` and `APP_MSG`, never translated.

Verdict: the screens, the state shape and almost every reuse the spec names exist exactly where it says (section B).
One blocker remains (every guided screen is drawn through `editOrSend`, which edits caption-blind, so a photo card in
Telegram dead-ends after the first tap and no suite can see it), nine majors (➕ inside a mixed payment records cash;
`back|add` lands on a screen whose buttons rule (c) swallows; ✖️ on an old screen kills the live flow; the app's keypad
is titled with the header line; a typed number at a button screen is not consumed although 1.0 promises it; the test
plan sells items the seed cannot sell; back onto the buyer-needed screen loses `needBuyer`; the how-paid screen can
show seven answers; a typed or new buyer on the part path is routed to how-paid again, which 8.1 step 8 itself
contradicts) and twenty-one minors.

## A. Findings

### B1 (blocker) — 1.0 "One message", 3.4 `saleGo`, `creditDeposit`: every screen is drawn caption-blind

**Problem.** The flow "lives in the message the seller tapped", and that message is the item card. In production the
item card is a PHOTO message whenever the item has a photo and `text_cards` is off (`sendItemCard` → `chat.sendPhoto`,
core_bot.js:235-236), so every edit of it is a caption edit. 1.0 says the screens are "caption-aware", but 3.4 names
`editOrSend(ctx.msgId)` as the drawing call of `saleGo` (the function behind every screen) and gives `creditDeposit` the
new signature `(chatId, msgId, groupId, arg, staff, updateId, ports, plain, addedKey)` with no `isCaption`.

**Evidence.**
- `editOrSend` hard-codes the flag: `return ports.chat.editMessage(chatId, msgId, text, kb || [], false);` (core_bot.js:381).
  Today it is used only on text question screens (expense :1856, :1862; split :1151, :1198, :1244).
- `creditDeposit` edits with `false` (:1671); today its `CD` buttons sit only on text messages (`finishCredit` :1660-1665).
  S+ puts them on the sold card, which is the (photo) item card.
- `handleCallback` knows the flag (`isCaption = !!cq.message.photo`, :425) and its own `edit` closure uses it (:433); the
  spec's `startGuidedSale`, `saleCancel`, `saleGuard`, `saleCommit` signatures carry `isCaption`, so only the two named
  calls lose it.
- Production consequence: `gasChat.editMessage` (gas_telegram.js:52-61) calls `editMessageText` on a photo message,
  Telegram answers an error that is not "not modified", and the catch **sends a new message** instead (:59). No Errors
  row. `state.msgId` keeps the card's id (the edit returned nothing). A tap on the NEW message → rule (b) ("`state.msgId`
  set and different") → that message is edited to `expired`. A tap on the old card's `✅ ရောင်း ၁` → `startGuidedSale`'s
  idempotence rule ("same item, first step, same message, same count → no edit") → nothing happens. The seller is stuck
  until the state expires (1800 s) or they scan again.
- No suite can see it: `sim_ports.js` `editMessage(chatId, messageId, text, keyboard)` ignores a fifth argument
  (:309-320), so does `app_ports.js` (:108-115), while every seeded item IS a photo card (`photoUrl`, `photoFileId`,
  sim_seed.js:86-87; no `text_cards` in the seed settings :67-74). run_wizard passes green with the wrong flag on every edit.

**Fix.** (1) 3.4: `saleGo`, `saleBack`, `saleCancel`, `saleGuard`, `saleCommit` and `creditDeposit` edit through
`ports.chat.editMessage(chatId, msgId, text, kb, isCaption)` with the tapped message's flag (`ctx.isCaption`);
`editOrSend` only where `msgId` is null (the typed and spoken paths, where it sends). `creditDeposit` gains `isCaption`
after `msgId`; `case 'CD'` passes the one `handleCallback` already has (:537). (2) 8.1: `bench()` wraps
`world.ports.chat.editMessage` to record `(messageId, isCaption)` and one named check asserts `isCaption === !!target.photo`
for every edit of the suite (red without the fix because every seeded card is a photo). (3) 1.0 "One message" says it in
one sentence: a guided screen is edited with the `isCaption` of the message it sits on.

### M1 (major) — 1.2 Q2+ / Q3: ➕ inside a mixed payment skips the transfer part and records the whole sale as cash

**Problem.** Q2+ says the kind tap, and the `existed` branch, set `draft.method = key` and go **→ Q4**. The ➕ row is also
on Q3 ("Then `[btn_add_bank → LA|pm|SSA|<item>]`"), and Q3 is reached from `mix` with `draft.mixed = true`. From there
the flow must go to Q3c (the transfer part), never straight to Q4.

**Evidence.** 2.2 `commitSaleGroup`: `bankPart = (KEY === 'CASH' || !p.mixed) ? 0 : clamp(round(p.bankPart || 0), 0, paid)`
→ with the part never asked it is 0 → outcome row 7 "mixed where the bank part is 0 → one SALE row, method CASH". The
seller named a bank account and the ledger says cash. 8.1 step 15 exercises ➕ from how-paid only.

**Fix.** `saleAccountResume` and `saleKindPick` route through `saleNext` from step `account` exactly as `SS|<item>|a|<KEY>`
does: `draft.mixed` → Q3c, else Q4. 8.1 step 15 adds: `mix` → ➕ → a new bank → the next screen is `split_ask_amount`,
and ✅ writes two rows.

### M2 (major) — 3.4 "Back clears" / 1.0 rule (c): `back|add` redraws Q2 while the saved state may be at step `account`

**Problem.** "the virtual `add` (back from the ➕ name prompt) → restores the saved sale state and redraws Q2". When ➕ was
tapped on Q3, the saved state is `{step: 'account', …}` (`askAddOption` saves the current state as is, core_bot.js:1389-1391).
Q2's buttons carry the letter `m`; rule (c) ("a tap on the live message whose step letter no longer matches `state.step`:
ignored without an edit") then swallows every tap on the redrawn Q2: buttons that do nothing and no Errors row. The same
rule also swallows `back|add` itself: `saleGuard(…, step)` compares the carried step with `saleStateOf(...).step`
(`method` or `account`), and no state is ever at a step called `add`; the spec gives no exemption.

**Evidence.** 1.0 rule (c); 1.2 Q3 ➕ row; 3.4 `saleGuard` ("`step` null skips rule (c)" is the only escape and the
dispatcher row for `SS` does not use it for `add`); 3.4 "Back clears … the virtual `add` … redraws Q2".

**Fix.** Drop the virtual step: the ➕ prompt's back button carries the saved step (`back|method` from Q2, `back|account`
from Q3), so rule (c) passes naturally and `saleBack` redraws the screen of `saved.step` (`saleScreenMethod` or
`saleScreenAccount`). 8.1 step 11 adds "back from the ➕ prompt opened on the account screen → the account screen, every
button live".

### M3 (major) — 1.0 Cancel / 3.4 `saleCallback`: ✖️ on an older message wipes the live state

**Problem.** `SS|<item>|z` is dispatched "first (no state needed)" and `saleCancel` does `clearState`. A ✖️ on an OLDER
guided message (the ၂..၉ grid left behind, a screen superseded by a typed answer, a screen of an abandoned flow while the
seller is now inside an expense or a deposit) clears whatever state is live. The spec's own rule (b) promises "the live
state and the live screen are untouched" for taps on older messages, and the code's own precedent clears only the state
the button belongs to (`clearSplitState`, core_bot.js:1252-1255). Today's `Z` behaves the same (:530-533), but the guided
flow leaves far more live-looking old screens behind (every typed answer makes one).

**Evidence.** 1.0 Cancel; 1.0 Stale (b); 3.4 `saleCallback` row.

**Fix.** `saleCancel` clears the state only when `saleStateOf(ports, uid)` is a sale state for THIS item and (`state.msgId`
is null or equals the tapped `msgId`); otherwise it edits the tapped message to `expired` and leaves the state alone
(rule b). 8.1 step 13 adds "✖️ on the grid left behind while the flow is on the card → the grid says `expired`, the live
state unchanged"; step 16 adds "✖️ on an old guided screen during an expense keeps the expense state".

### M4 (major) — 5 App: the keypad's title is the header line, not the question

**Problem.** The number keypad opens with `title: appFirstLine(m.text)`. The spec's layout (1.0 "Layout", 1.1) puts the
header block FIRST (`confirm_sale '📝 ရောင်း {qty} ထည် · {name} · {amount} ကျပ်'`, then buyer, then how paid) and the
question LAST. On Q3c and after ✏️ အခြား on Q4 the phone's keypad is therefore titled "📝 ရောင်း ၁ ထည် · … · 18,000 ကျပ်"
instead of `split_ask_amount` / `ask_number`, and the sheet covers the card, so the seller cannot see what number is
wanted. Section 5 names no change to `appInputBar`.

**Evidence.** app_ui.js:760 and :763 `appOpenNumberKeypad({ title: appFirstLine(m.text), initial: 0, … })`; `appFirstLine`
:772 = `split('\n')[0]`. Today's number prompts are one-line messages, so the first line IS the question.

**Fix.** Section 5: `appInputBar` titles the keypad with the question line, the last non-empty line of `m.text`, when the
state is `await_number` with purpose `sale_step` or `sale_qty` (a pure `appQuestionLine(text)` helper, asserted in 8.5).

### M5 (major) — 1.0 "Typed or spoken text" vs 3.4 `saleText`: a typed number at a button screen is not consumed

**Problem.** 1.0 promises "a number feeds the step when it takes one (count, price, transfer part, amount now)". The only
steps whose live state is `await_number` are Q3c (at entry) and Q4 after ✏️. `saleText` handles `buyer`/`name`/`phone`/
`due_text` and "other steps → false". So "3" typed on the ၂..၉ grid (state `{kind:'sale', step:'qty'}`) and "5000" typed
on Q4 before ✏️ (state `{kind:'sale', step:'paid'}`) fall through: `handleText`'s number path needs
`state.kind === 'await_number'` (core_bot.js:681), the text reaches the AI (:699-707) with `awaiting 'sale_qty'` /
`'sale_paid'` → `not_understood`, or a sale proposal on top of the open flow. A spoken number does the same (:823 needs
`await_number`). Sellers who use notebooks will type the number before they find ✏️.

**Evidence.** core_bot.js:681; 3.4 `saleText` row; 1.0 bullet "Typed or spoken text while a screen waits for a tap".

**Fix.** `saleText` also handles `qty` (`parseNumberText(text)` → the Q0 rules: 1..`MAX_SALE_QTY`, else `bad_qty` + back row)
and `paid` (→ the Q4 typed rules: n ≥ total → Q6; bankPart ≤ n < total → the buyer check → Q5; else `sale_bad_amount`);
`handleIntent` adds the same two lines for a spoken number (`firstNumber([intent.qty, intent.amount])` at `qty`,
`spokenMoney` at `paid`). 8.1 step 2 adds "typed `3` on the grid without ✏️ → the buyer screen with qty 3"; step 6 adds
"typed `5000` on the amount screen without ✏️ → the buyer check".

### M6 (major) — 8.1 steps 2, 8, 14, 1.3 row 3 and 6.6: the plan sells items the seed cannot sell as written

**Problem.** The tests call `S1-0005` UNIQUE and expect `btn_sold`; they sell "500,000 of 1,000,000"; the smoke starts a
deposit sale on `S1-0006` with `btn_sold`. In the seed `S1-0005` is a SKU and `S1-0006` is already sold out.

**Evidence.** sim_seed.js:42 `S1-0005 … type: 'SKU', price: 22000, stock: 2`; :43 `S1-0006 … UNIQUE, price: 1000000, stock: 1`;
:103 the seeded credit sale `commitSale(ports, { item: ports.store.getItem('S1-0006'), qty: 1, paid: 500000, … })` leaves
it at stock 0, so its card is `card_sold_out` with `btn_return` only (`cardKeyboard`, core_bot.js:220-222). run_round4.js:
1963-1966 sells `S1-0005` with `btn_sell_one` for 22,000 (a SKU sale). `bench()` (run_round4.js:47-137) reseeds the same
world and adds nothing. The UNIQUE pieces in stock are `S1-0001` (25,000, :38), `S1-0004` (45,000, :41), `S2-0001` (:44).

**Fix.** Steps 2 and 14 use `S1-0001` or `S1-0004`; step 8 and 6.6 use `S1-0004` with 💬 and a typed price when a large
total matters, or `bench()` restocks `S1-0006` by one before the deposit cases (`commitRestock`, as the seed does :89)
and says so. 1.3 row 3 stays prose.

### M7 (major) — 3.4 "Back clears": back onto the buyer-needed screen drops `needBuyer`

**Problem.** The table clears `needBuyer` when the buyer step is re-shown. On the part path Q4 `0`/`half` → Q1 (needBuyer)
→ buyer → Q5. Back from Q5 lands on Q1 with `needBuyer` gone: the 🚫 row is back; 🚫 → Q2 ("`none` → Q2") → the seller
answers how-paid and the amount again. `needBuyer` and `paid` are answers of Q4, not of the buyer step.

**Evidence.** 3.4 "Back clears, per re-shown step: … `buyer` → `customerId, newName, newPhone, needBuyer`"; 1.2 Q1
"`none` → Q2"; 1.2 Q4 "`0`, `half`, `bank` → `draft.paid` → when no buyer yet: `draft.needBuyer = true` → Q1".

**Fix.** Back onto `buyer` clears `customerId, newName, newPhone` only; `needBuyer` is cleared with `paid`. 8.1 step 11
adds "back from the due screen onto the buyer-needed screen still shows no 🚫 and `sale_need_buyer`".

### M8 (major) — 1.2 Q2: with three wallets and a bank the how-paid screen has seven answers

**Problem.** D1 (binding, refined in section 0): "at most six answer buttons, then one back row". Q2: "While the shop has
three wallets or fewer, each is one row … so this screen never has more than six answers." Count with three wallets and
a bank: 💵 (1) + 📲 × 3 + 🏛 (1) + 💵+🏦 (1) + ➕ (1) = 7.

**Evidence.** 1.2 Q2 rows; section 0 D1 "The six-answer rule counts choices".

**Fix.** The ▶️ threshold counts the whole screen: wallets are listed singly only while
`1 + wallets + (bank ? 1 : 0) + (anyNonCash ? 1 : 0) + 1 ≤ 6`; otherwise the first `6 − (the rest)` wallets and
`btn_more '▶️ နောက်ထပ်'`. 8.1 step 5 adds three wallets + BANK → two 📲 and ▶️.

### M9 (major) — 1.2 Q1/Q1b/Q1c/Q1d: a typed or new buyer on the part path is routed to how-paid again

**Problem.** Q1 names the `needBuyer` branch only for a BUTTON pick: "a customer id → `draft.customerId` → Q2 (or Q5 when
`needBuyer`)". Every typed path says Q2 flatly: "exact name → that buyer → Q2" (Q1), "Typed → the Q1 matching" (Q1b),
Q1d "Then Q2". Read literally, the deposit case (Q4 `half` → Q1 without 🚫 → the seller TYPES `ဒေါ်ခင်`, or ✏️ a new name
and a phone) goes back to how-paid, then to Q4, then to Q1 again: a loop. 8.1 step 8 expects the opposite ("`ဒေါ်ခင်` →
`sale_ask_due`"), so the spec contradicts its own test. `saleNext` (3.4) mentions "needBuyer" among the skips, but the
screen prose is what a builder copies.

**Evidence.** 1.2 Q1 last paragraph, Q1b, Q1d "Then **Q2**"; 8.1 step 8 "`ဒေါ်ခင်` → `sale_ask_due`".

**Fix.** 1.2 states once, above Q1: every exit of Q1/Q1b/Q1c/Q1d goes through `saleNext`, which is Q5 when `draft.needBuyer`
and Q2 otherwise; Q1d's "Then Q2" becomes "then `saleNext`". 8.1 step 8 adds the ✏️ နာမည်အသစ် + typed phone variant
landing on `sale_ask_due`.

### m1 (minor) — 5 App: the keypad does not reopen for the second number prompt on the same message

Mixed: Q3c sets `await_number` on message M (the keypad opens, `APP.keypadAutoFor = M`); `btn_half` → Q4 edits M; ✏️ အခြား
→ `await_number` on M again → `APP.keypadAutoFor === m.id` → no auto-open (app_ui.js:758-759); the seller must find
`ui_type_number_bar '⌨️ ဂဏန်း ရိုက်မယ်'`. Fix: key the auto-open on `m.id + '|' + state.purpose + '|' + (state.saved ?
state.saved.step : '')`, with a pure `appKeypadKeyFor(m, state)` helper for 8.5.

### m2 (minor) — 1.2 Q1 / 2.6: short digit strings become names; partial phone matches have no path

`findCustomers` treats a text as a phone only with four or more digits and no letters (core_ledger.js:1351); "12" goes to
`matchCustomers` → nobody → `draft.newName = '12'` → Q1d, against 2.6's "digits are never a name". And the phone branch
also returns PARTIAL matches (`p.indexOf(digits) >= 0`, :1356: the seller types the last four digits) while Q1 says only
"an exact phone → that buyer; nobody → `cust_none`". Fix: any digits-only text (the regex of `addListOptionByLabel`, :718)
is a phone hint whatever its length; partial phone matches → Q1c (`cust_pick` with `customerLabel`, which shows the phones).

### m3 (minor) — 1.2 Q1d: a typed phone an existing customer already has creates a duplicate

Q1d stores `draft.newPhone` and ✅ creates the buyer; nobody checks `findCustomers(phone)` (ဒေါ်မြင့် is seeded with
`09 123 456 78`, sim_seed.js:57). Fix: an exact phone match at Q1d → Q1c offering that customer and `btn_create_named`;
8.1 step 4 adds the case.

### m4 (minor) — 1.2 E / 3.4 `startGuidedSale`: a UNIQUE piece sold meanwhile is noticed only at ✅

A stale card (the piece sold on the other phone) still shows `btn_sold`; the seller answers buyer, method and amount
before S✖. `handleCallback` loads a FRESH item for every `ITEM_ACTIONS` tap (core_bot.js:434). Fix: `startGuidedSale`
applies the S✖ rule at once (UNIQUE with stock ≤ 0 → `cardText(fresh)` + `sale_gone` + `cardKeyboard(fresh)`).

### m5 (minor) — 1.2 Q0 / Q0b: the grid's own id is not stored in `state.msgId`

`Q` and `saleFromPrice` send the grid as a NEW message but the spec never says they store its id (`askQty` returns
`sendMessage`'s `{messageId}`, core_bot.js:254; sim_ports.js:299, app_ports.js:99, gas_telegram.js:37). Without it rule
(b) cannot tell an old grid from a newer one: `q|3` on the old grid matches `step 'qty'` and edits the OLD grid into Q1.
Fix: both set `state.msgId` from the returned id.

### m6 (minor) — 1.2 Q1, Q2: recents and accounts keyed on `staff.shop`, the row on `item.shop`

`recentCustomers(ports, staff.shop, 4)` and `payMethodsByKind(ports, staff.shop)` while the row is `shop: item.shop` (2.2).
The shared owner login (DefaultShop S1, sim_seed.js:7) selling a shop-2 piece sees shop-1 accounts; `afterSaleKeyboard`
keys on the row's shop today (core_bot.js:282). Fix: `item.shop` on both screens.

### m7 (minor) — 3.4 callback table: two byte counts are off

`SS|S1-0002|back|due_text` is 24 bytes (table 23); `SS|S1-0002|ph|skip` is 18 (table 17). Harmless (the longest,
`CD|<g>|yes|p|<KEY>` at 58, is right); fix the numbers so 8.1 step 23 is not written against them.

### m8 (minor) — 8.1 step 1: the state equality omits `msgId`

"the state is `{kind:'sale', step:'buyer', item:'S1-0002', draft:{qty:1}, hist:[]}`" while 3.4 puts `msgId` in the state.
A deep `same()` check is red against the spec's own shape. Fix: include `msgId: <card id>` or compare fields.

### m9 (minor) — 6.4 / 6.6: tour `label` targets and the smoke cannot find buttons whose text has a placeholder

`world.sim.button(m, label)` is `text.indexOf(label) >= 0` (sim_ports.js:449-455) and the tours look up `t(world.ports, key)`:
for `btn_paid_all '✅ အကုန် {amount}'`, `btn_half`, `btn_days`, `btn_wallet` the unfilled template never matches; 6.6 also
writes `half` and `၁၄ ရက်` as if they were labels. Fix: match on the text before the first `{`, and 6.6 names what it taps
(callback data or `fill(MSG.btn_half, …)`).

### m10 (minor) — 1.0 Stale (a) / 1.4 / 8.1 step 13: the committed-card memory is ten minutes, and the replay needs a tick

`isCommittedCard` lives 600 s (core_bot.js:1401-1403). A `SC|<item>|ok` tapped on a sold card whose redraw never reached
the phone, later than ten minutes, meets rule (a) without the committed-card branch: the sold card is edited to `expired`
and loses `btn_undo`/`btn_receipt`. 1.4 states the kept-card behaviour without the limit. And step 13's "`SC` replayed on
the sold card → a new `expired` message" is dropped silently by the 120 s `tap:` guard (:428-431) unless the test ticks
past two minutes first. Fix: say "within `ADD_STATE_TTL_SEC`" in 1.4, or let `saleGuard` keep any tapped message whose
text contains `t('sold_done')`'s prefix (`cq.message.text`/`caption` is available); step 13 inserts `tick(3)`.

### m11 (minor) — 3.4 `handleIntent` / D7: a spoken cash part at Q3c is stored as the account part

"ငွေသား ငါးထောင်" (the model answers method CASH) at a `split_bank` prompt is turned into the account part by
`splitBankFromCash` (core_bot.js:827-828, :1262-1268); at `sale_step`/`bank` the 5,000 is stored as `bankPart`. One line
(`state.purpose === 'sale_step' && state.saved.step === 'bank' && method CASH → total − w`) keeps parity.

### m12 (minor) — 1.2 Q4, Q3 wording

Every full-cash sale now ends on `credit_ask_paid '💳 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)'` (the 💳 credit
glyph on the committing screen of a plain sale), and Q3 for `mix` reuses `split_ask_bank '… (ပေးငွေ {cash})'` with cash =
the total before anything is paid. Reused keys, so a note for the Messages tab; a new key would be drafted from
`pay_ask_amount` (:104) and `btn_all` (:44).

### m13 (minor) — 1.2 Q3c, Q4, 1.4: `sale_bad_amount` is sent with no keyboard

Q3c and Q4 say "`sale_bad_amount` … and the state set again" and name no buttons, unlike `bad_qty` ("with that back row")
and `ord_bad_date` ("+ back row"). It is a NEW message (the typed path), so in the app it becomes the latest card with no
way back but a valid number or a scan. Fix: `sale_bad_amount` carries the back row of the screen it belongs to
(`back|bank` / `back|paid`, `SS|<item>|z`).

### m14 (minor) — 1.0 "A scan during a flow": "every `M|*` menu tap keeps the state" is false for six of them

`dropAddState` touches only the ➕ and 🔢 prompts (core_bot.js:2175-2180), but `menuAction` then REPLACES the state for
`M|find` (:584), `M|cfind` (:592), `M|exp` (`startExpense` :1812/:1816), `M|dep` (`startDeposit` :1735), `M|nb`, `M|meas`.
After those, a tap on the guided screen meets rule (a): `expired` + a fresh card while the new flow's screen is also
live. 8.1 step 16 uses `M|today` (stateless), so the test is right and the prose is not. Fix: 1.0 says "the stateless menu
taps (`M|today`, `M|recent`, `M|rep`, `M|acct`, `M|help`, `M|app`, `M|devices`) keep the state; the flows that open a
state replace it, as today".

### m15 (minor) — 3.4 `saleText` / `handleText`: a handled edit returns `undefined`

"`var h = saleText(…); if (h) return h;`" — `ports.chat.editMessage` returns nothing in all three ports (sim_ports.js:
309-320, app_ports.js:108-115, gas_telegram.js:52-61), so any branch that ends in an edit answers falsy and the text falls
through to the AI as well. Today's typed-path branches all `sendMessage` (truthy), but one future edit breaks it. Fix:
`saleText` returns `true` explicitly, the `|| true` convention of :692 and :802.

### m16 (minor) — 1.2 Q5b / 3.2: a yearless past date rolls to next year, and nothing bounds the future

`parseDayText` turns `11.11` into next year's date when the day is past (core_orders.js:76), so "a day before today →
`ord_bad_date`" is reachable only with an explicit year or the ISO form; a seller typing `5.11` on the 12th books the rest
for eleven months hence without noticing. 8.1 step 9's "yesterday" is ambiguous about the form. Fix: `saleDueTyped`
refuses a key more than `CFG.OVERDUE_DAYS` × 12 (or a stated bound) ahead with `ord_bad_date`, or 3.2's `parseDayText`
takes an option that disables the roll for the sale; step 9 names `11.11.26` and `11.11`.

### m17 (minor) — 1.2 Q0b: a typed price below 1 breaks every later range

`applyAwaitedNumber` case `sale_price` accepts any `n` today (core_bot.js:713-716: a 0 sale). In `steps` a price of 0 makes
Q4 read `✅ အကုန် 0`, half 0, and `sale_bad_amount '❓ 1 မှ -1 အတွင်း …'` on Q3c (max = total − 1). Fix: `saleFromPrice`
refuses `n < 1` with `ask_sale_price` again and the state kept (the `bad_qty` pattern), and Q3c/Q4 are skipped when
`total ≤ 1`.

### m18 (minor) — 1.2 Q0b: 💬 from the grid replaces the sale state behind the grid

`D|<item>` sets `{await_number, sale_price, itemId}` "as today" (:457-460) and sends the price prompt as a NEW message. The
grid (state `{kind:'sale', step:'qty'}`) is now stateless but still shows its digits; a digit tap meets rule (a): the grid
→ `expired` + a fresh card, while the price prompt still waits. Fix: in `steps`, `D` from the grid edits the grid in place
(it is a question screen, not a committed card) and keeps the sale state in `saved`, so ⏮ returns to the grid.

### m19 (minor) — 1.2 S / 3.4 `saleCardText`: "paid" on `credit_done` after a mixed part payment

`credit_done '💳 👤 {customer} · ပေးပြီး {paid} · ကျန် {owed} ကျပ်'` (:99) is filled from the ledger, but the spec does not
define `paid`; `finishCredit` uses `info.cash` today (:1659), which for a two-row group is the cash part only (8,000 while
18,000 changed hands). `cardText`'s `card_buyer` already uses `info.cash + info.payments + info.applied` (:199). Fix: 3.4
says `paid = cash + payments + applied` on the sold card, and 8.1 step 6 asserts it on the mixed part case.

### m20 (minor) — 5 App: the phone step uses the plain text bar

`appInputBar`'s text mode is `input[type=text]` (app_ui.js:767); at step `phone` a numeric keyboard is what the seller
needs. Fix: `appInputBar` sets `inputmode: 'tel'` when `state.kind === 'sale' && state.step === 'phone'` (one attribute;
`appInputModeFor` may return `'tel'` and the bar treats it as text).

### m21 (minor) — 1.2 Q3: "beyond six, rows of two" contradicts D1

Q3 lists "one account per row … up to six; beyond six, rows of two (the `methodRows` wrap, :318-322)" plus ➕: with seven
or more accounts (`mix` lists every non-cash one, `MAX_BANK_BUTTONS` 12) the screen has up to thirteen answers. Fix: cap
at five accounts plus `btn_more` → a second page (the `more` mechanism Q2 already has), or state the exception to D1.

## B. Confirmed OK (checked against the code)

- **Messages.** Every reused key the spec cites exists with the quoted text and line: `btn_back` :335, `btn_cancel` :32,
  `btn_undo` :27, `btn_yes` :28, `btn_skip` :30, `btn_other` :31, `confirm_ask` :69, `expired` :71, `confirm_sale` :61,
  `credit_ask_customer` :98, `credit_ask_paid` :97, `credit_done` :99, `credit_use_deposit` :100, `deposit_applied` :101,
  `cust_find` :150, `cust_none` :151, `cust_pick` :143, `btn_create_named` :144, `cust_attached` :142, `btn_new_customer`
  :45, `btn_use_deposit` :46, `btn_no_deposit` :47, `ask_name` :80, `ask_number` :79, `ask_sale_price` :82, `ask_qty` :18,
  `ask_qty_number` :19, `bad_qty` :20, `btn_type_qty` :17, `btn_discount` :22, `sold_done` :52, `card_sold_out` :11,
  `card_buyer` :156, `tag_not_found` :8, `ord_ask_phone` :219, `ord_ask_due_text` :251, `ord_bad_date` :252, `btn_days`
  :238, `btn_due_type` :240, `btn_half` :254, `btn_more` :217, `btn_cash` :132, `btn_bank` :131, `method_done` :133,
  `btn_split` :376, `split_ask_bank` :377, `split_ask_amount` :378, `split_done` :379, `split_bad` :382, `btn_add_bank`
  :385, `add_ask_pm` :388, `add_done` :391, `add_exists` :392, `add_unavailable` :393, `btn_acct_number` :399,
  `acct_detail_hint` :403, `receipt_transfer` :406, `summary_overdue` :208, `menu` :89, `help` :90, `lists_note_list` :415,
  `btn_design_none` :226, `btn_app` :184, `summary_cash` :205, `btn_accounts` :395, `acct_title` :396, `btn_all` :44,
  `ms_low_hint` :342, `exp_ask_method` :164, `ord_ask_due` :236, `ord_due_set` :237, `pay_ask_amount` :104, `ord_ask_viber`
  :220, `btn_credit` :41, `rejected` :70, `summary_orders_overdue` :369, `lists_note_shop` :420, `lists_note_key` :416,
  `btn_meas_chat` :331, `receipt_total` :122, `app_need_online` core_sync.js:101.
- **No clash.** None of the 20 new `MSG` keys, nor `ui_btn_pick_date`, `ui_date_title`, nor the Settings keys `sale_flow` /
  `sale_due_presets` exist under apps-script/, app/, poc/, tools/ (dist excluded). All 41 new globals of 3.4 (`saleFlow` …
  `appOpenDateSheet`, `saleScreen*` as a prefix) are free; the only `sale*` names in the tree are `saleGroupInfo` and the
  local `saleRows` of core_ledger.js:1071. No new `btn_*` duplicates an existing text.
- **Button-text rule.** No new `btn_*` of section 7 contains `ငွေသား`, `KBZPay`, `WavePay` or `ဘဏ်လွှဲ`, none starts with
  `🏦 ` (`btn_bank_transfer`, `btn_kind_bank` use 🏛); `lists_note_kind` holds the words but run_lists.js:919-921 scans only
  its own eight `btn_*` keys. `stripMethodLines` (:1102-1104) touches none of the new header lines (`💰`, `📅`, `ℹ️`).
- **Ports.** `sendMessage` returns `{messageId}` in all three chat ports (gas_telegram.js:37, sim_ports.js:299, app_ports.js:99),
  which `askMeasQuestion` already relies on (:3188-3189); `editMessage` takes `isCaption` in production (gas_telegram.js:52)
  and ignores it in both simulators (B1).
- **Callbacks.** `ITEM_ACTIONS` :414 (a vanished item answers `tag_not_found` through the tapped message's `edit`, :436),
  `MUTATING_ACTIONS` :417-418 with `CD` in it, the `tap:` guard :428-432 wraps get and put so the `S`-in-steps exemption is
  one condition; `case 'CD'` :537 passes `(chatId, msgId, id, arg, …)` so `parts[3]`/`parts[4]` are a two-token change.
  Byte counts hold under 64 for every row (the two miscounts of m7 are still under); app customer ids are `C-` + 8 hex
  (app_store.js:326), so `SS|<item>|b|<custId>` stays 20 bytes. Lower-case `bank|mix|more` can never meet a key:
  `listNormKey` upper-cases pay_method keys (core_ledger.js:326-329) and `listKeyFor` makes them from letters (:647-651).
- **Pattern reuse.** The expense flow is as described: `expenseState(uid, step)` guard :1838-1841, in-place edits :1850 and
  :1862 (`editOrSend`), `withPrefix` :386-388, `markCommittedCard` on the committing tap :1908, `isCommittedCard` :1405-1407
  (600 s). `dropAddState` :2175-2180 touches only `add_option`/`list_detail`; `setState` TTLs :2164-2169 (1800 s for a
  `sale` state and for `await_number sale_step`; 600 s for the ➕ prompt that wraps the sale in `saved`, so a ➕ left open
  ten minutes loses the sale, as today's expense ➕ does). `askAddOption` saves `cur` as `saved` :1389-1391, never nests an
  add state in an add state, edits the tapped question for every resume but PM :1393-1394, and the `isCommittedCard` check
  :1388 protects a Q2 that became the sold card; `finishAddOption` restores `state.saved` :1431 — the SSA branch must fork
  before `addListOptionByLabel` (:1419), which the spec says.
- **Text routing.** `handleText` :649-708: tag id first (:652-653, clears the state through `openTag` :122), the `await_text`
  block (:660-665) before `parseNumberText` (:666), `if (state)` at :668, `await_number` at :681, the AI at :699-707. A
  `kind === 'sale'` check placed first inside `if (state)` precedes the number path, so a typed phone at Q1/Q1d never
  becomes a number; `2026-12-30` from the date sheet parses as 2026 but is caught the same way. `applyAwaitedNumber` clears
  the state first (:711), so `saleNumber` must re-set it on a bad value — the spec says so. `handleIntent`'s free-text block
  (:775-808) runs before the confidence check, where `creditNamed` sits (:794), so the four routing lines land in the right
  place; `buildAiContext.awaiting` becomes `'sale_' + step` by :623 as claimed; a spoken number at `sale_step` reaches
  `applyAwaitedNumber` through :823-831.
- **Customers.** `findCustomers` phone rule :1351, `matchCustomers` :1370-1374, `normPhone`/`isValidPhone`/`fmtPhone`
  :1320-1339 (the seeded `09 123 456 78` prints `+95 912 345 678`, as the spec's Q1 shows); `orderPhoneTyped`'s "< 7 digits
  → ask again" :2427-2428; `savePhone`'s keep-as-typed :1535-1536; `customerLabel` :1474-1476; `recentCustomers` :1297-1312
  (padded by `createdAt`, so shop-2 sellers see the two seeded customers too). `addCustomer` takes `phone` in all three
  stores (gas_store.js:428, app_store.js:325-327, sim_ports.js), so D3's create-at-✅ is one call. `pickCustomer` creates at
  once (:1465); the spec's Q1c without the create is the right variant. The order flow asks the phone right after a new
  name with `btn_skip` on its own callback (:2421), the precedent Q1d copies.
- **Money screens.** `startSplit`'s one-account skip :1169; `sendSplitAmount`'s `await_number` + `btn_half` :1187-1198;
  `methodRows` 64-byte skip :312, 3-or-wrap rule :318-322, extra last row :323-325; `payMethods` 12-byte drop and
  `MAX_BANK_BUTTONS` cap (core_ledger.js:116-130); `methodKnown` includes retired accounts :172-177; `methodLabel` :180-187;
  `listOption` :487-493; `depositsFree` :1214 (the free pool `applyDeposit` :858-873 consumes, a better choice than
  `finishCredit`'s `depositsFor` :1658); `afterSaleKeyboard` rows :270-287 (the `plain` cut is rows 1-2); `rewriteCheck`
  answers `complex` for two live rows (:947), so no corrective function reaches a mixed guided group; `splitSale`'s shape
  (:1039-1045) and `receiptMethodText` (core_report.js:351-356) print ' (ငွေသား 8,000 · KBZPay 10,000)' as claimed.
- **Dates.** `addDaysKey`, `daysBetweenKeys`, `parseDayText` (core_orders.js:48-78) use only `MY_DIGITS` and `dayKey`, both
  in core_burmese.js, so the move is clean; `parseDayText` has no ISO branch today (:66-78); `sendDueScreen` draws `btn_days`
  with `myDigits` :2615 and `orderDue`'s `addDaysKey(dayKey(now), n)` :2736 is the rule Q5 copies; `orderDueTyped` :2741-2747
  is the Q5b precedent.
- **Double and stale taps.** Every `SS` button is idempotent under rule (c) once its step has moved (a second `q|3`, `b|C-0001`,
  `m|CASH`, `p|half`, `d|14`, `k|bank` finds another `state.step` and is ignored, so no second Lists row and no second
  write); `SC` is covered by the 120 s guard and, after the commit, by `clearState` + `markCommittedCard`; a second
  `LA|pm|SSA` never nests (:1390). The same back button twice moves one screen because the second carries a step the state
  has left.
- **App.** `appInputModeFor` :68-78 has no branch for `kind: 'sale'`, and `await_number` → `'number'` already covers
  `sale_step`/`sale_qty`; `appInputBar` :754-771 handles `number`, `photo`, else text, so the `'date'` branch must sit before
  the text fallthrough (the spec puts it there); `appCardInfo` needs an `S|<id>|1` button (:37-46) and `SS`/`SC` never match
  `p[0] === 'S'`, so Q1 drawn into the card loses the stepper and renders plain rows while the unchanged `cardKeyboard` keeps
  the stepper on the card; `appKeyboardForCard` filters only when `info.sku` (:55-66); `appOnTap` busy mark :784;
  `appRenderMsg`'s button loop :680-684 is where `data-cb` goes; history renders old keyboards tappable (:801 → :675-689), so
  rules (b) and (c) matter in the app too; `.kb button.hot` is styled and unset (app.css:97); `createAppSync` takes
  `opts.online` (app_sync.js:78) and `bootApp` builds `online` at :265; `appDoEnroll` reads `navigator.onLine` at :444; the
  keypad's OK is disabled at 0 (:929), so Q4's `0` button is indeed the only way to a pure credit; the app shows only the
  latest bot message (:352, :468); `appIsMenuMessage` compares the whole text to `t('menu')` (:79), so no guided screen turns
  into the grid; `app_store.getSetting` honours the pref `setting:<k>` first (:341-344); the guided state lives in the
  `cache` store and survives a restart like `sale_price` does.
- **Quick mode stays pinned.** `seedSimWorld` sets no `sale_flow` (sim_seed.js:67-74), so `quick` there is the right lever;
  run_scenario.js:431 pins the quick grid's `Z` and `S|id|N` digits; run_round4.js:1963-1967 pins "START + one tap …
  nothing is asked before the commit" and :141-148 the after-sale rows; run_app.js:707-708 pins `split_bank` as
  `await_number` — all drive `S|id|1` and stay green with `quick`. `cardKeyboard` and `askQty` without opts are untouched in
  both modes; `confirmProposal` (:1012-1079) keeps the voice sale on `commitSale` + `afterSaleKeyboard` in both modes, as
  D7 and 8.1 step 18 want.
- **Loose end noticed, not a finding.** `enrolledInApp`/`sendAppCard` (core_bot.js:3402-3411) have no caller anywhere under
  apps-script/ or poc/; an enrolled phone's Telegram still sells today and the spec's silence changes nothing.
