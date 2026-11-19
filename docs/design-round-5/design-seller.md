# design-seller.md — round 5 from the seller's side (designer's report, 2026-11-11)

Angle: the fewest taps and the least confusion per screen for a seller who has no computer habit. Every screen
of the guided sale is written out below with its text and its buttons, for Telegram and for the app, then the
data, the functions, the glue, the app, the simulator, the tests and the build steps. Inputs: `BRIEF.md` (D1-D9),
`map-sale.md`, `map-app.md`, `map-sim.md`, `map-glue.md`, and the code as of today. Every Burmese label is
copied from `MSG` (apps-script/core_messages.js) or `APP_MSG` (app/app_i18n.js) with its line; a label marked
**NEW** is a draft composed from words that already exist in MSG and must be rewritten by a native speaker, as
the header of core_messages.js says of every string.

## Top decisions (and where they refine a brief decision)

1. **The item card and the count stay exactly as they are.** `cardKeyboard` (core_bot.js:207-230) and `askQty`
   (246-255) are untouched; in `steps` mode the `S|<id>|<n>` tap (the card's `✅ ရောင်း ၁`, a grid digit, or the
   app's stepper) no longer writes: it opens the guided flow with the count already answered, and the first flow
   screen is drawn **in place of the tapped message**. The app's stepper is therefore the count step (D1 allows
   the app its own controls), the card checks of every existing suite stay green in both modes, and the count
   screen (D2) is skipped when the count was given on the card. The 💬 changed-price row joins the grid's last
   row in `steps` mode (D2).
2. **"Full now or part now" and "how much now" are one screen** (refines D2). Its question is `credit_ask_paid`
   ('💳 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)', core_messages.js:97); its first button `✅ အကုန် {total}`
   commits the sale. The screen already shows item, count, buyer and how paid, so for the full-payment case it
   **is** the summary confirmation; a separate "မှန်ပါသလား?" screen exists only on the part-payment path, after
   the date. One tap fewer on the 90 % path; nothing is written before a tap that names the total (D3 kept).
3. **The back row is `[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]`** = `btn_back` (core_messages.js:335) + `btn_cancel` (:32),
   not the brief's '↩️ back': ↩️ is `btn_undo` (:27), which sits on the next card (refines D1). Cancel inside the
   flow redraws the **item card** (not `cancelled`): the seller lands where a scan lands.
4. **Every flow callback is `F|<code>|<itemId>|<arg>`** (≤ 47 bytes), so a stale or expired tap can always answer
   with a fresh item card; the draft lives in one state `{kind:'sale', step, itemId, msgId, draft, hist}`
   (`st:<uid>`, 1800 s); typed answers go through the existing `await_number` dispatcher (`applyAwaitedNumber`)
   with the sale state carried in `state.sale`, so the app's keypad and voice numbers work unchanged.
5. **The buyer is created at the commit**, from `draft.name` and `draft.phone` (D3: an abandoned flow writes
   nothing, Customers included); an existing buyer is picked by id. The phone question appears only after a new
   name and has its own skip (`F|ph|<id>|skip`), never `Z` (map-app surprise 7).
6. **One write**: new `commitSaleGroup(ports, p)` in core_ledger.js builds `[SALE, PAYMENT?]` with `newTx` and
   calls `writeGroup` once; the mixed shape is `splitSale`'s (core_ledger.js:1039-1045) without the mirror pair.
   `DueDay` is on the SALE row. `afterSaleKeyboard` is untouched (the voice card keeps its corrective buttons,
   D3/D7); the guided card uses a new `guidedSaleKeyboard`: undo, receipt, 💰 while owed, 📱 phone row.
7. **Kind is asked before the name on ➕** (refines D6's "after the name"): the Lists tab persists `Kind` only when
   a row is appended (`gasListsPersist` sets `label`/`detail` only, gas_store.js:319-323), and the row is
   appended the moment the name arrives (`finishAddOption`, core_bot.js:1417-1451). Two taps, same result, no
   new `set` op. The FM resume gets no 🔢 hint row: `LD|pm|KEY` would replace the sale state.
8. **`sale_flow` defaults to `steps` in code; `seedSimWorld` sets `quick`** so run_scenario, run_round4, run_sync,
   run_app and run_lists stay green unchanged; the new `run_round5.js` and the simulator set `steps` (D5).
9. **Dates**: `addDaysKey`, `daysBetweenKeys`, `parseDayText` move from core_orders.js to core_burmese.js (same
   names, no duplicate global), `parseDayText` also accepts `yyyy-mm-dd` (the app's `<input type="date">`);
   `CFG.SALE_DUE_PRESETS` [7, 14, 30] (Settings `sale_due_presets`). Credits gain `DueDay` and `Overdue`
   columns, so the Dashboard, the 21:00 summary and the simulator agree on one rule.
10. **Simulator v2** = one world + `createFakeServer`, a login screen, a device bar per role, the real app in an
    `<iframe srcdoc>` per device, an editable Lists tab through a sim-only `store.setListRow`, Settings,
    Measurements and Devices tabs, a clock control, and a tour engine driven by `data-cb` attributes and the
    `update` event. Built by `poc/build_simulator.js` into one HTML file (D8).

---

## 1. Screens

### 1.0 Rules every screen follows

- **One message.** The flow lives in one chat message: the tapped message is edited into the next screen
  (`ports.chat.editMessage`, as the expense flow does, core_bot.js:1850, 1862). A typed or spoken answer has no
  tapped message: the next screen is a **new** message (`editOrSend` with `msgId` null, core_bot.js:380-383) and
  `state.msgId` moves to it. The app shows only the latest bot message (app_ui.js:352, 468), so both cases show
  the right screen.
- **Layout.** Lines 1..n: the running summary (section 1.1); last line: the one question. Answer buttons: at
  most six, one per row when they are sentences, two or three per row when they are short; then the back row
  `[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]`, always both and always last, so the seller finds the same two buttons in the same
  place on every screen; on the first screen of a flow ⏮ does what ✖️ does (back from the first question is the
  item card).
- **Cancel** (`F|z|<id>`): `clearState`, edit the flow message into `cardText(fresh) + cardKeyboard(fresh)`.
  Nothing was written. `Z` (core_bot.js:530-533) still works everywhere else.
- **Back** (`F|b|<id>`): pop `state.hist`, clear the draft fields that the re-shown step owns (table in 3.4),
  redraw that step in place.
- **Stale tap**: a tap whose message id is not `state.msgId`, or whose code does not answer `state.step`, or
  whose item id is not `state.itemId`: the tapped message is edited to `expired` ('⏱ သက်တမ်းကုန်သွားပါပြီ။
  ထပ်ပြောပေးပါ။', core_messages.js:71); the live flow is untouched.
- **Expired state** (no `sale` state at all, 30 min passed, or a scan in between): the tapped message is
  edited to `expired` and a fresh item card is sent (`sendItemCard`), because the callback carries the item id.
- **Double tap**: the two committing callbacks (`F|p|<id>|all`, `F|ok|<id>`) join `MUTATING_ACTIONS`
  (core_bot.js:417-418, 120 s guard); after the commit the state is cleared, so a late second tap meets "no
  state" and writes nothing. `S` leaves the guard in `steps` mode (it writes nothing there; a re-tap after a
  cancel must work).
- **Voice/typed text while a screen waits for a tap**: a number feeds the step when it takes one (count, price,
  amount, date), a name feeds the buyer/name step, a phone number feeds the phone step; anything else is
  answered by the screen again (`buildAiContext.awaiting = 'sale_' + step`, core_bot.js:615-633). Nothing new is
  built on voice (D7).
- **A scan during a flow** (`openTag`, core_bot.js:122-124) clears the state and shows the new card: the old
  flow is abandoned, nothing written.
- **Role**: the seller and the owner see the same flow; the owner's Telegram also keeps `V|g` (void) on old cards.

### 1.1 The running summary block

Built by `saleDraftText(ports, item, draft)`; one line per answered step, in this order:

| Line | Text | Key |
|---|---|---|
| item | `{emoji} {id} · {name}` (as `showChoices` labels an item, core_bot.js:938-941; `sample_mark` appended for samples) | — |
| count/price | `{qty} ထည် × {price} = {amount} ကျပ်` | **NEW** `sale_line_qty` |
| buyer | `👤 {name}` + ` · {phone}` when known (`customerLabel`, core_bot.js:1474-1476) | — |
| how paid | `💰 {method}` (`methodLabel`, core_ledger.js:180-187) | **NEW** `sale_line_method` |
| mixed | `💰 ငွေသား {cash} · {method} {bank}` | **NEW** `sale_line_mixed` |
| paid now | `ပေးပြီး {paid} · ကျန် {owed}` (the words of `receipt_total`, core_messages.js:122) | **NEW** `sale_line_paid` |
| due | `📅 ကျန်ငွေ · {date}` (`fmtDayMy`, core_burmese.js:44-48) | **NEW** `sale_due_set` |

### 1.2 Screen by screen

Notation: `[a | b]` is one keyboard row with two buttons. App notes say what the phone shows beyond the plain
rows (every row of core buttons renders as 56 px flex buttons, app_ui.js:678-687).

**E. Entry: the item card** (unchanged, `cardKeyboard` core_bot.js:207-230)

| Item | Rows |
|---|---|
| SKU | `[✅ ရောင်း ၁ → S\|id\|1 \| 🔢 အရေအတွက် → Q\|id]` `[💬 စျေးလျှော့ → D\|id \| 📦 ကုန်ရောက် → R\|id]` `[↩️ ပြန်အမ်း → T\|id \| 🔁 {shop} သို့ → X\|id]` |
| UNIQUE | `[✅ ရောင်းပြီး → S\|id\|1]` `[💬 စျေးလျှော့ \| ↩️ ပြန်အမ်း]` `[🔁 {shop} သို့]` |
| price pending | `[💬 စျေးပြောပြီး ရောင်း → D\|id]` `[💰 စျေးသတ်မှတ် \| 🔁]` |

In `steps` mode `S|id|n` starts the flow with `draft.qty = n` (card: 1; grid: 2..9; app stepper: 1..999 via
`appStepperData`, app_ui.js:48-53) and edits the tapped message into **Q1**. App: the SKU card keeps its stepper
`[−] n [+]` and the big `✅ ရောင်း {n} ထည်` (`ui_sell_n`, app_i18n.js:46); the UNIQUE card its green `✅ ရောင်းပြီး`.

**Q0. Count (SKU, from 🔢)** — `askQty` (core_bot.js:246-255), one new message, unchanged text:
`🔢 ဘယ်နှစ်ထည် ရောင်းလဲ?` (`ask_qty`, :18) + `{id} · {name}`.
`[၂ ၃ ၄ ၅]` `[၆ ၇ ၈ ၉]` → `S|id|n`; last row in `steps` mode `[✏️ ရိုက်မယ် → QN|id | 💬 စျေးလျှော့ → D|id | ✖️ မလုပ်တော့ → Z]`
(in `quick` mode the last row is today's `[✏️ | ✖️]`). The digit grid keeps its eight digits: it is one number
question, not eight options (refines D1's "six"). `QN|id` → state `{kind:'await_number', purpose:'sale_qty', itemId,
sale:null}`, the message edited to `ask_qty_number` ('✏️ အရေအတွက် ရိုက်ပါ (ဥပမာ 4)', :19) + `[⏮ | ✖️]`; the typed
number (1..999, else `bad_qty` :20 and the state kept, as today core_bot.js:722-734) → **Q1** as a new message.
App: the keypad opens by itself for `await_number` (app_ui.js:758-760) titled with the first line.

**Q0b. Changed price** — `D|id` from the card or from Q0 (core_bot.js:457-460): state `{kind:'await_number',
purpose:'sale_price', itemId, sale: <the sale state when one exists, else null>}`; new message
`💬 ဘယ်စျေးနဲ့ ရောင်းလဲ? ဂဏန်း ရိုက်ပါ (ဥပမာ 18000)` (`ask_sale_price`, :82) + `[⏮ | ✖️]`. In `steps` mode the typed
price sets `draft.unitPrice` and continues: SKU → **Q0** as a new message with the new price in its first line
(`sale_line_qty` with the count still blank: `× {price}`), UNIQUE → **Q1** with `qty 1`. So "bargained price
for 3 pieces" is possible, which the one-piece `D` path (core_bot.js:713-721) is not today. In `quick` mode `D`
commits one piece as today.

**Q1. Buyer** (D2: first button no name; recent customers; typing searches)
Text: summary block + `👤 ဝယ်သူ ဘယ်သူလဲ?` (`credit_ask_customer`, :98).
```
[🚫 နာမည် မရှိ]                       → F|c|S1-0002|none        NEW btn_no_name
[👤 ဒေါ်မြင့် · +95 912 345 678]       → F|c|S1-0002|C-0001      recentCustomers(shop, 4), customerLabel
[👤 ဒေါ်ခင်]                           → F|c|S1-0002|C-0002
[✏️ နာမည်အသစ်]                         → F|c|S1-0002|new         btn_new_customer (:45)
[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]           → F|b|S1-0002 | F|z|S1-0002   (SKU from the grid: back = Q0; from the card: back = the card)
```
Typing a name or a phone here searches (`matchCustomers`, `findCustomers` core_ledger.js:1345-1374): an exact
name or phone → that buyer → **Q2**; look-alikes → **Q1c**; nobody → `draft.name = text` → **Q1d**. When the flow
needs a buyer for a part payment (**Q4**), this screen comes back without the 🚫 row and with the line
**NEW** `sale_need_buyer` 'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်' above the question.
App: text bar `✏️ ရိုက်ပါ` + `ပို့` (`ui_text_placeholder`, `ui_btn_send`; `appInputModeFor` → `'text'` for
`sale/buyer`). Four recent buyers at most: the whole screen fits one phone height.

**Q1b. New name** — `F|c|id|new`: edit to `✏️ နာမည် ရိုက်ပေးပါ` (`ask_name`, :80) + `[⏮ | ✖️]`; step `name`.
Typed → same matching as Q1 (an exact match is used, nothing is duplicated).

**Q1c. Look-alikes** — `cust_pick` ('👤 "{name}" · ဘယ်သူလဲ?', :143), one row per match (≤ 4, `customerLabel`) →
`F|c|id|<custId>`, then `[✏️ "{name}" အသစ် ဖန်တီး → F|c|id|create]` (`btn_create_named`, :144), back row. `create`
keeps `draft.name` (no Customers row yet) → **Q1d**.

**Q1d. Phone of a new buyer** — `📞 {customer} ၏ ဖုန်းနံပါတ် ရိုက်ပါ (မရှိရင် ကျော်ပါ)` (`ord_ask_phone`, :219,
reused verbatim) + `[⏭ ကျော် → F|ph|id|skip]` (`btn_skip`, :30) + back row. Typed: `normPhone` (core_ledger.js:
1320-1325); fewer than 7 digits → the same screen again (the order flow's rule, core_bot.js:2427); `isValidPhone`
→ `draft.phone = normPhone(text)`, else kept as typed (`savePhone`'s rule, 1531-1540). Then **Q2**. An existing
buyer without a phone is never asked here (fewest taps); the sold card offers `📱 ဖုန်း ထည့်` (`phoneRow`) as today.
App: text bar.

**Q2. How paid** (D2, D6)
Text: summary block + **NEW** `sale_ask_method` '💰 ဘယ်လိုပေးလဲ?' (the words of `exp_ask_method`, :164).
```
[💵 ငွေသား]                            → F|m|S1-0002|CASH         btn_cash (:132)
[KBZPay | WavePay]                     → F|m|S1-0002|KBZ | F|m|S1-0002|WAVE   wallets by their Label, no emoji (D6)
[🏦 ဘဏ်လွှဲ]                            → F|mb|S1-0002              NEW btn_pay_bank (the words of method_BANK :130)
[💵+🏦 ခွဲပေး | ➕ ဘဏ်အသစ်]              → F|mx|S1-0002 | LA|pm|FM|S1-0002   btn_split (:376), btn_add_bank (:385)
[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]
```
Wallets = active `pay_method` rows of the shop whose `kind` is not `bank` (blank = wallet, D6), in list order,
three per row while ≤ 3 and no label over ten characters, else two per row (`methodRows`' rule, core_bot.js:
318-322); a button over 64 bytes is skipped. With the seeded lists this screen has exactly six answer buttons.
`F|m|id|CASH` or a wallet → `draft.method = KEY` → **Q4**. `F|mb` → **Q3a**. `F|mx` → **Q3b**. `LA|pm|FM|id` →
**Q2+** (the ➕ path).

**Q2+. ➕ a new account from the how-paid screen** (D6 refined: kind first)
`LA|pm|FM|<id>` edits Q2 into **NEW** `add_ask_kind` '➕ ဘယ်အမျိုးအစားလဲ? (ဘဏ် / Pay)' with
`[📱 Pay အကောင့် → LA|pm|FM|id|wallet | 🏦 ဘဏ် အကောင့် → LA|pm|FM|id|bank]` (**NEW** `btn_kind_wallet`,
`btn_kind_bank`, the words of `lists_note_list` :415) + `[✖️ → Z]`; then the name prompt `add_ask_pm` (:388) as
today, the add state carrying `kind` and `saved: <the sale state>`. The typed name → `addListOptionByLabel(...,
{kind})` → resume `FM`: `draft.method = key` (wallet) or `draft.account = key, draft.method = key` (bank) and
**Q4** as a new message prefixed with `add_done` (:391). No 🔢 hint row here (decision 7). From **Q3a** the ➕ is
`LA|pm|FM|id|bank` (kind known, straight to the name).

**Q3a. Which bank account** (only after 🏦, only when more than one bank-kind account)
Text: summary block + **NEW** `sale_ask_bank` '🏦 ဘယ်အကောင့်လဲ?'.
`[🏦 KBZ bank]` `[🏦 AYA ဦးမောင်]` → `F|a|id|<KEY>` (`btn_bank` '🏦 {method}', :131, one per row), then
`[➕ ဘဏ်အသစ် → LA|pm|FM|id|bank]`, back row. Exactly one bank account → skipped (`startSplit`'s rule, core_bot.js:
1169). None → the text `split_no_bank` ('ℹ️ ဘဏ်အကောင့် မရှိသေးပါ။ အရင် ထည့်ပါ။', :383) with `[➕ ဘဏ်အသစ်]` and the
back row. `F|a` → `draft.method = draft.account = KEY` → **Q4**.

**Q3b. Which account for the mixed part** — text: summary block + `split_ask_bank` ('💵+🏦 ဘယ်အကောင့်နဲ့
ခွဲပေးလဲ? (ပေးငွေ {cash})', :377) with `cash` = the sale total. Every non-cash account of the shop, wallets by
label, banks as `🏦 {label}`, one per row (≤ 6; more → two per row), `[➕ ဘဏ်အသစ် → LA|pm|FM|id]`, back row. One
account → skipped. `F|a|id|KEY` with `draft.mixed = true` → **Q3c**.

**Q3c. The transfer part** — text: summary block + `split_ask_amount` ('💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ? ဂဏန်း
ရိုက်ပါ (ပေးငွေ {cash} · ကျန်တာ ငွေသား)', :378) with `cash` = total. `[တစ်ဝက် {half} → F|x|id|half]` (`btn_half`,
:254) `[✏️ အခြား → F|x|id|t]` (`btn_other`, :31), back row. `t` → `{kind:'await_number', purpose:'sale_bank',
itemId, sale}` and the app keypad; a typed or spoken number 1..total−1 → `draft.bankPart`; ≥ total → the whole
payment is by that account (`draft.mixed = false`, as `splitSale`'s `full`); out of range → `split_bad` (:382)
with `max` = total, state kept. Then **Q4**.

**Q4. How much now** (D2's full-or-part + how-much, merged: decision 2)
Text: summary block + `💳 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)` (`credit_ask_paid`, :97).
```
[✅ အကုန် 18,000]                        → F|p|S1-0002|all      NEW btn_paid_all (btn_all :44 with ✅)   COMMITS
[0 | တစ်ဝက် 9,000 | ✏️ အခြား]            → F|p|S1-0002|0 | F|p|S1-0002|half | F|p|S1-0002|t
[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]
```
`all` → `draft.paid = total` → **commit** (section 1.5). `0` / `half` → `draft.paid` → if no buyer yet → **Q1**
(buyer required) else **Q5**. `t` → `{await_number, purpose:'sale_paid', sale}` + `ask_number` ('✏️ ဂဏန်း
ရိုက်ပေးပါ (ဥပမာ 25000)', core_messages.js:81) + back row; typed `n`: `n >= total` → commit as `all`;
`0 <= n < total` → part; `n < bankPart` (mixed) or `n < 0` → `split_bad` with `max` = total, state kept. With a
mixed payment the second row is `[✏️ အခြား]` alone (0 and half can be below the transfer part). The app's keypad
cannot type 0 (OK disabled while 0, app_ui.js:928-933): the `0` button is the only way to a pure credit, which is
why it stays.

**Q5. When is the rest paid** (D4)
Text: summary block (with `ပေးပြီး {paid} · ကျန် {owed}`) + **NEW** `sale_ask_due` '📅 ကျန်ငွေ {owed} ကျပ် · ဘယ်တော့လဲ?'
(the words of `ping_overpaid` core_sync.js:124 and `ord_ask_due` :236).
```
[၇ ရက် | ၁၄ ရက် | ၃၀ ရက်]               → F|d|S1-0002|7 | F|d|S1-0002|14 | F|d|S1-0002|30   btn_days '{n} ရက်' (:238), CFG.SALE_DUE_PRESETS
[✏️ ရက်စွဲ ရိုက် | ❓ မသေချာ]            → F|d|S1-0002|t | F|d|S1-0002|none   btn_due_type (:240), NEW btn_due_unknown
[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]
```
`n` → `draft.dueDay = addDaysKey(today, n)`; `none` → `draft.dueDay = ''`; `t` → **Q5b**. Then **Q6**.
App: the preset rows as buttons; for `t` see Q5b.

**Q5b. Typed date** — `F|d|id|t`: edit to `✏️ ရက်စွဲ ရိုက်ပါ (ဥပမာ 30.10.26)` (`ord_ask_due_text`, :251) + back row;
state `{kind:'await_text', purpose:'sale_due', itemId, sale}`. Typed: `parseDayText(text, now)` (accepts
`30.10.26`, `30/10`, Burmese digits and, new, `2026-10-30`); null or a day before today → `ord_bad_date` (:252)
+ back row, state kept; else **Q6** as a new message. App: `appInputModeFor` → `'date'`: the bar shows one
button **NEW** `ui_btn_pick_date` '📅 ရက်စွဲ ရွေးပါ' that opens a bottom sheet with `<input type="date" min=today>`
and `✅ အိုကေ` (`ui_btn_ok`), sending `yyyy-mm-dd` as text.

**Q6. Confirm (part-payment path only)**
Text: the full summary block (item, count, buyer, how paid, paid/owed, due) + `မှန်ပါသလား?` (`confirm_ask`, :69).
`[✅ မှန်တယ် → F|ok|S1-0002]` (`btn_yes`, :28) `[⏮ နောက်ပြန် | ✖️ မလုပ်တော့]`. `ok` → **commit**.

**S. The sold card** (edited in place of Q4/Q6, or a new message after a typed answer; `markCommittedCard`)
Text: `soldText(fresh, qty, r)` (= `cardText` + `sold_done` '✅ ရောင်းပြီး {qty} ထည် · {amount} ကျပ် · လက်ကျန် {stock}',
:52) then, when they apply: `credit_done` ('💳 👤 {customer} · ပေးပြီး {paid} · ကျန် {owed} ကျပ်', :99) when owed > 0;
`cust_attached` ('👤 ဝယ်သူ {customer} · မှတ်ပြီး', :142) when a buyer and nothing owed; `method_done` (:133) when one
non-cash account (via `methodLine`, core_bot.js:367-370); `split_done` (:379) when mixed; `sale_due_set` when a
date. Keyboard `guidedSaleKeyboard(ports, groupId, customer)`:
```
[↩️ မှားသွားတယ် → U|g | 🧾 ဘောက်ချာ → RC|g]     btn_undo (:27), btn_receipt (:42)
[💰 ငွေလက်ခံ → PY|g]                           btn_pay (:37), only while owed > 0
[📱 ဖုန်း ထည့် → CF|custId]                    phoneRow (core_bot.js:362-365), only for a buyer without a phone
```
No 💳, 👤, 🏦, 💵+🏦 or ➕ (D3). App: the card is `big`, text pre-wrap, two half-width buttons on the first row.

**S+. The buyer holds a deposit** — when `depositsFree(ports, customerId) > 0` and owed > 0 after the write, the
card text adds `credit_use_deposit` ('📥 {customer} ၏ စရံ {deposit} ကျပ် ရှိပါသည်။ သုံးမလား?', :100) and the keyboard
is only `[✅ စရံ သုံးမယ် → F|u|<g>|yes | ❌ မသုံးဘူး → F|u|<g>|no]` (`btn_use_deposit` :46, `btn_no_deposit` :47;
`F|u|<36-byte group>|yes` = 44 bytes). `yes` → `applyDeposit` (core_ledger.js:858-873, a DEPOSIT_APPLIED row in
the sale's group) + `deposit_applied` (:101); both answers redraw with `guidedSaleKeyboard`. This mirrors
`finishCredit`/`creditDeposit` (core_bot.js:1663-1680) without their `afterSaleKeyboard`.

### 1.3 Tap counts, seller's eye

| Sale | Taps after the scan (Telegram) | App |
|---|---|---|
| one piece, cash, no name | `✅ ရောင်း ၁` · `🚫 နာမည် မရှိ` · `💵 ငွေသား` · `✅ အကုန် 18,000` = **4** | same 4 (the stepper's ✅ is the first) |
| three pieces, KBZPay, a known buyer | `🔢` · `၃` · `👤 ဒေါ်မြင့်` · `KBZPay` · `✅ အကုန်` = 5 | `+` `+` · ✅ · 👤 · KBZPay · ✅ = 6 |
| deposit 100,000 on a 1,000,000 set, new buyer, two weeks | `✅ ရောင်းပြီး` · `✏️ နာမည်အသစ်` · type · type phone · `💵` · `✏️ အခြား` · type · `၁၄ ရက်` · `✅ မှန်တယ်` = 7 taps + 3 typed | same, keypad for the amount |
| mixed 10,000 KBZPay + rest cash | `✅ ရောင်း ၁` · `🚫` · `💵+🏦` · (one account: skipped) · `✏️` · type 10000 · `✅ အကုန်` = 5 + 1 typed | same |

Today: 1 tap, then up to 6 more on the after-sale card to say the same things. The quick switch (D5) keeps the
1-tap card for a shop that prefers it.

### 1.4 Errors, as the seller sees them

| Case | What happens | Where |
|---|---|---|
| stock changed (another phone sold the last UNIQUE piece) | at the commit `fresh.stock <= 0` for a UNIQUE item: the flow message becomes `cardText(fresh)` (the `card_sold_out` card with `card_buyer`) + **NEW** `sale_gone` '⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ', state cleared, nothing written | `saleCommit` |
| SKU stock below the count | written as today (stock is derived; the server flags `stock_negative`, core_sync.js:799-800) | — |
| item deleted | `tag_not_found` (:8) | `saleCommit`, `saleGuard` |
| stale tap on an old screen | that message → `expired`; the live screen untouched | `saleGuard` |
| expired state (30 min, or a scan) | tapped message → `expired`, a fresh item card follows | `saleGuard` |
| double tap on ✅ | second tap dropped (120 s guard), or "no state" after the redraw | `MUTATING_ACTIONS` |
| typed amount out of range | `split_bad` (max = total), state kept | `applyAwaitedNumber` |
| typed date unreadable or past | `ord_bad_date`, state kept | `saleDueTyped` |
| typed phone too short | `ord_ask_phone` again | `salePhoneTyped` |
| ➕ with a store that cannot add | `add_unavailable` (:393) as a new message, Q2 keeps its buttons | `askAddOption` (today's rule) |
| ➕ name that is only digits | `add_ask_pm` again | `finishAddOption` (today) |

### 1.5 Undo and receipt

`U|g` → `undoGroup` (core_ledger.js:905-930) mirrors every live row of the group (SALE and the mixed PAYMENT)
within 30 min, stock comes back, owed nets to 0; the card becomes `undo_done` (:57) + `cardText`. `RC|g` →
`buildReceipt`/`receiptText` (core_report.js:322-369): the mixed methods print as ' (ငွေသား 8,000 · KBZPay 10,000)',
`receipt_transfer` while owed > 0, and a new last line `sale_due_set` when the SALE row carries a `DueDay`.
`V|g` (owner) unchanged.

### 1.6 `quick` mode (D5)

`sale_flow = quick`: `S|id|n`, `QN`, `D` commit as today and show `afterSaleKeyboard`; `askQty` has no 💬 row;
no `F|` button is ever emitted. Switch: a Settings row on the laptop; phones follow at their next pull
(core_sync.js:915-929); a phone may override with the pref `setting:sale_flow` (app_store.js:341-344).

---

## 2. Data model

### 2.1 Ledger
- `CFG.LEDGER_COLS` gains `'DueDay'` as its **27th, last** name (core_config.js:132-134). Both Sheet writers are
  positional by CFG order (gas_store.js:385, gas_sync.js:180), so last is the only safe place (map-glue B).
- `newTx` gains `dueDay: f.dueDay || ''` (core_ledger.js:31-64). Set only by `commitSaleGroup` on the SALE row
  when `paid < amount` and a date was chosen; `''` for "not sure" and for every other row.
- `rewriteRows` copies `dueDay: row.dueDay` onto the replacement (core_ledger.js:965-990); mirrors leave it blank.
- Readers: `saleGroupInfo` returns `dueDay: first.dueDay || ''` (:1064-1086); `openCredits` rows gain `dueDay`,
  `overdue` (`dueDay ? dueDay < today : days >= CFG.OVERDUE_DAYS`) and `daysOver` (`dueDay ? daysBetweenKeys(dueDay,
  today) : days`) (:1122-1169). `CFG.CREDIT_COLS` gains `'DueDay', 'Overdue'` (15 names, :157); the Credits view
  row is `[..., c.days, c.dueDay, c.overdue]` (gas_store.js:684-687).
- Note values: `''` plain, `'credit'` when owed > 0 (as `convertSaleToCredit`), `'split'` on the mixed pair,
  `'spoken price'` stays the `D` path's note in quick mode; the guided flow writes `'price'` when
  `draft.unitPrice` differs from the item's price.
- Sync: `syncValidateTx` accepts `dueDay` absent, `''` or `yyyy-mm-dd` (else MALFORMED) (core_sync.js:369-388);
  the phone stores copy every key (app_store.js:236-240, 444-452), nothing else to add.

### 2.2 Lists
- `CFG.LIST_COLS` gains `'Kind'` as its 9th, last name (core_config.js:116). Values `''`, `'wallet'`, `'bank'`;
  `accountKind(row)` returns `'bank'` for `'bank'`, else `'wallet'` (D6: blank = wallet).
- `listNormRow` gains `kind: listText(r.kind).toLowerCase()` (core_ledger.js:336-348); `listRowToCompact` gains
  `t: row.kind` and `listRowFromCompact` reads `kind: c.t` (`k` is taken, :498-506); `listUpsert`'s append row
  carries `rec.kind` (the `listNormRow({key, label, …})` call at :582-584); `addListOptionByLabel(ports, name, label,
  staff, opts)` passes `opts.kind` into the `addListOption` rec (:715-734).
- Seed: `legacyListRows` gives pay_method rows `kind: key === CFG.METHOD.CASH ? '' : (CFG.DEFAULT_METHOD_KIND[key] ||
  'wallet')` with `CFG.DEFAULT_METHOD_KIND = { BANK: 'bank' }` (:378-424), so the seeded `ဘဏ်လွှဲ` sits behind 🏦,
  KBZPay/WavePay show by name, and the laptop user sees both words in the Kind column from day one. `ensureListsTab`
  copies `r.kind` into its seed objects (gas_setup.js:164-174); `simSeedLists` copies the rows as they are.
- Phone → server: `syncListRecReason` allows `kind` absent | `''` | `'wallet'` | `'bank'`; `syncApplyListEntry`
  copies it (core_sync.js:469-481, 517-525). Sheet store, every explicit field list names it: `gasListRows` reads
  `kind: text(o.Kind)` (gas_store.js:244-249), `gasStore.listOptions` copies it (:629-633), `gasListValues` writes
  `Kind: r.kind || ''` (:276-282), `gasListsPersist`'s `pending.push({…})` carries it on an appended row (:316; the
  `set` branch stays label/detail only). Sim store: `listOptions` returns `kind` (poc/sim_ports.js:245-256); the
  generic `r[op.field] = op.value` in `addListOption` already works (:261-275).

### 2.3 Settings (setupSheet defaults, gas_setup.js:44-68)
| Key | Default | Read by |
|---|---|---|
| `sale_flow` | `steps` | `saleFlowSteps(ports)` = `String(getSetting('sale_flow', 'steps')).toLowerCase() !== 'quick'` |
| `sale_due_presets` | `7,14,30` | `saleDuePresets(ports)` (like `duePresets`, core_orders.js:28-31) |
`seedSimWorld` sets `sale_flow: 'quick'` (poc/sim_seed.js:73-80); `bench()` in run_round5.js and the simulator's
`boot()` set `'steps'`.

### 2.4 Customers
No column change. A new buyer is `addCustomer({name, phone})` at the commit (every store takes `phone`:
gas_store.js:433, app_store.js:327, poc/sim_ports.js:101). `recentCustomers(shop, 4)` (core_ledger.js:1297-1312)
feeds Q1; `customerLabel` shows the phone.

### 2.5 CFG additions (core_config.js)
`SALE_DUE_PRESETS: [7, 14, 30]`, `DEFAULT_METHOD_KIND: { BANK: 'bank' }`, `LEDGER_COLS` + `DueDay`, `LIST_COLS` +
`Kind`, `CREDIT_COLS` + `DueDay`, `Overdue`. No new TTL: the flow uses `STATE_TTL_SEC` (1800 s).

---

## 3. Core functions

### 3.1 core_config.js
Section 2.5. `colLetter` and the Dashboard keep working because every new name is appended last.

### 3.2 core_burmese.js and core_orders.js
Move `addDaysKey(day, n)`, `daysBetweenKeys(dayA, dayB)`, `parseDayText(text, now)` from core_orders.js:49-80 to
core_burmese.js (after `daysSince`, :76-78); delete them from core_orders.js (one global scope: never two
definitions). `parseDayText` gains a first branch: `/^\d{4}-\d{2}-\d{2}$/` → returned as is when it is a real day.
core_ledger.js may now call them (its header rule "calls nothing defined in core_orders.js", :25-26, still holds).

### 3.3 core_ledger.js
- `commitSaleGroup(ports, p)` → `{groupId, txs}`. `p = {item, qty, unitPrice, paid, bankPart, method, customerId,
  dueDay, note, staff, source, transcript, updateId}`. `amount = qty * unitPrice`; `paid` clamped 0..amount;
  `bank = min(bankPart || 0, paid)`; `cash = paid - bank`. SALE via `newTx`: `qty: -qty, amount, cash,
  method: methodFor(bank > 0 ? CASH : p.method, cash), customerId, dueDay: paid < amount ? p.dueDay : '', note,
  costAtSale: item.cost`. When `bank > 0`: PAYMENT `{groupId: sale.groupId, amount: bank, cash: bank, method: p.method,
  refGroupId: sale.groupId, customerId, note: 'split', itemId}` **after** the SALE row (core_sync.js:802-805 checks a
  payment against owed). `writeGroup([sale, payment?])` once. `commitSale` (:755-768) untouched.
- `accountKind(row)`, `walletMethods(ports, shop)`, `bankMethods(ports, shop)`: the active pay_method rows of the
  shop split by kind (keys only, through `payMethods` so the 12-byte and cap rules apply, :116-130).
- `openCredits`, `saleGroupInfo`, `rewriteRows`, `newTx`, `listNormRow`, `listRowToCompact/FromCompact`,
  `listUpsert`, `addListOptionByLabel`, `legacyListRows`: section 2. `buildDailySummary` (:1516-1575): `overdue =
  openCredits(ports, null).filter(c => c.overdue)`; dated ones → **NEW** `summary_due_passed` '⏰ ရက်လွန် အကြွေး: {list}'
  with `customer owed (date)`, undated ones → `summary_overdue` as today.

### 3.4 core_bot.js

**Callbacks** (header legend at :20-31 gains the `F` line):

| Data | Bytes (max) | Step answered | Commits |
|---|---|---|---|
| `S\|id\|n`, `QN\|id`, `D\|id` (existing) | 17 | count / price (steps mode: no write) | no |
| `F\|c\|id\|none` · `new` · `create` · `<custId>` | 24 | buyer, name, look-alikes | no |
| `F\|ph\|id\|skip` | 17 | phone | no |
| `F\|m\|id\|<KEY>` · `F\|mb\|id` · `F\|mx\|id` | 25 | how paid | no |
| `F\|a\|id\|<KEY>` | 25 | account (bank or mixed) | no |
| `F\|x\|id\|half` · `t` | 17 | transfer part | no |
| `F\|p\|id\|all` · `0` · `half` · `t` | 17 | how much now | **`all` yes** |
| `F\|d\|id\|<n>` · `t` · `none` | 17 | due day | no |
| `F\|ok\|id` | 13 | confirm | **yes** |
| `F\|b\|id`, `F\|z\|id` | 12 | back, cancel | no |
| `F\|u\|<group>\|yes` · `no` | 44 | use the buyer's deposit (after the write) | yes (DEPOSIT_APPLIED) |
| `LA\|pm\|FM\|id` · `LA\|pm\|FM\|id\|wallet` · `bank` | 25 | ➕ from Q2/Q3a | no |

`MUTATING_ACTIONS` gains nothing by prefix (the guard keys on `action = parts[0]`); `handleCallback` adds
`var mutating = MUTATING_ACTIONS[action] || (action === 'F' && isCommittingF(parts))` where `isCommittingF` is
`parts[1] === 'ok' || (parts[1] === 'p' && parts[3] === 'all') || parts[1] === 'u'`, and `S` is exempt in steps
mode. `ADD_RESUME_LIST` (:1334-1335) gains `FM: 'pay_method'`.

**State** (`st:<uid>`, `setState` :2164-2169, TTL 1800 s):

| kind | step / purpose | fields | set | consumed |
|---|---|---|---|---|
| `sale` | `qty` (grid shown), `buyer`, `name`, `phone`, `method`, `account`, `bank_amount`, `paid`, `due`, `confirm` | `itemId`, `msgId`, `draft {qty, unitPrice, customerId, name, phone, method, account, mixed, bankPart, paid, dueDay, needBuyer}`, `hist []` | `saleStart`, every `saleShow*` | `saleCallback`, `saleTextInput` |
| `await_number` | `sale_qty` (exists), `sale_price` (exists), `sale_paid`, `sale_bank` | `itemId`, `sale` (the sale state or null) | QN, D, `F\|p\|id\|t`, `F\|x\|id\|t` | `applyAwaitedNumber` (:710-753), voice via handleIntent :823-831 |
| `await_text` | `sale_due` | `itemId`, `sale` | `F\|d\|id\|t` | `handleText` await_text block (:660-665) |
| `await_text` | `add_option` with `kind` and `resume {a:'FM', args:[id, kind]}` | as today + `kind` | `askAddOption` | `finishAddOption` |

Back clears, per re-shown step: `qty` → `qty`; `buyer` → `customerId, name, phone, needBuyer`; `name` → `name`;
`phone` → `phone`; `method` → `method, account, mixed, bankPart`; `account` → `account, bankPart`; `bank_amount` →
`bankPart`; `paid` → `paid`; `due` → `dueDay`.

**Functions** (new unless marked changed):

| Function | Signature | Does |
|---|---|---|
| `saleFlowSteps` | `(ports) → bool` | Settings `sale_flow` ≠ `quick` |
| `saleDuePresets` | `(ports) → [n]` | Settings `sale_due_presets` or `CFG.SALE_DUE_PRESETS` |
| `saleStart` | `(chatId, msgId, isCaption, uid, item, qty, sale, staff, ports)` | builds the state (`draft.qty = qty`, keeps `sale.draft.unitPrice` from a typed price), `hist` = `[]` or `['qty']` when the tap came from the grid; → `saleShowBuyer` editing `msgId` |
| `saleStateOf` | `(state) → sale state or null` | `state.kind === 'sale' ? state : (state && state.sale) || null` |
| `saleGuard` | `(chatId, msgId, isCaption, uid, itemId, step, ports) → state or null` | the stale/expired rules of 1.0; answers `expired` (+ `sendItemCard` when no state) and returns null |
| `saleDraftText` | `(ports, item, draft) → string` | section 1.1 |
| `saleBackRow` | `(ports, itemId) → row` | `[btn_back F\|b, btn_cancel F\|z]`, the same on every screen; `saleBack` on the first screen (empty `hist`) calls `saleCancel` |
| `saleShowBuyer` / `saleShowName` / `saleShowPhone` / `saleShowMethod` / `saleShowBank` / `saleShowMixedAccount` / `saleShowMixedAmount` / `saleShowPaid` / `saleShowDue` / `saleShowConfirm` | `(chatId, msgId, uid, state, ports, prefix)` | push `hist`, set `step`, `setState`, `editOrSend(msgId, withPrefix(prefix, text), kb)`; set `state.msgId` to the message shown (the edited one, or the new one returned by `sendMessage`, :549 pattern) |
| `saleCallback` | `(code, parts, chatId, msgId, isCaption, uid, staff, updateId, ports)` | the `F` switch; `b` → `saleBack`, `z` → `saleCancel`, `u` → `saleUseDeposit` |
| `saleBack` | `(chatId, msgId, uid, state, ports)` | pops `hist`; first screen → `saleCancel` |
| `saleCancel` | `(chatId, msgId, isCaption, uid, itemId, ports, staff)` | `clearState`; edit to `cardText + cardKeyboard` of the fresh item |
| `saleBuyerPick` | `(…, arg)` | `none` → `saleShowMethod`; `new` → `saleShowName`; `create` → `saleShowPhone` (draft.name kept); id → `draft.customerId` → `saleShowMethod` (or `saleShowPaid`→ when `needBuyer`: back to where Q4 left: `saleShowDue`) |
| `saleBuyerTyped` | `(chatId, uid, state, text, staff, ports)` | `matchCustomers`; exact → pick; partial → `saleShowLookalikes` (`cust_pick`, ≤ 4, `btn_create_named`); none → `draft.name` → `saleShowPhone`; 4+ digits with no match → `cust_none` (:151) + Q1 again |
| `salePhoneTyped` | `(chatId, uid, state, text, ports)` | section Q1d |
| `saleMethodPick` | `(…, code, arg)` | `m` → `draft.method`; `mb` → `saleShowBank` (or skip rules); `mx` → `saleShowMixedAccount` (or skip) |
| `saleAccountPick` | `(…, key)` | `methodKnown` else `expired`; sets `account`/`method`; mixed → `saleShowMixedAmount`, else `saleShowPaid` |
| `saleBankPart` | `(chatId, msgId, uid, state, n, staff, ports)` | section Q3c; from `F\|x\|half` or `applyAwaitedNumber` |
| `salePaid` | `(chatId, msgId, uid, state, n, staff, updateId, ports, source)` | section Q4; `n >= total` → `saleCommit`; else buyer check → `saleShowDue` |
| `saleDuePick` / `saleDueTyped` | | section Q5/Q5b |
| `saleCommit` | `(chatId, msgId, isCaption, uid, state, staff, updateId, ports, source)` | section 1.5: fresh item, stock rule, `resolveBuyer`, `commitSaleGroup`, `setLastItem`, `setLastGroup`, `clearState`, `markCommittedCard`, `editOrSend` the sold card with `guidedSaleKeyboard` or the deposit question |
| `resolveBuyer` | `(ports, draft) → customer or null` | `customerId` → `getCustomer`; `name` → exact `matchCustomers` or `addCustomer({name, phone})` |
| `guidedSaleKeyboard` | `(ports, groupId, customer) → rows` | section S |
| `saleUseDeposit` | `(chatId, msgId, isCaption, groupId, arg, staff, updateId, ports)` | section S+ |
| `saleResumeMethod` | `(chatId, uid, itemId, key, kind, staff, ports, prefix)` | the `FM` resume after ➕: restores `state.saved`, sets the method/account, `saleShowPaid(null, …, prefix)` |
| `saleTextInput` | `(chatId, uid, state, text, n, staff, updateId, ports) → handled` | dispatch by `state.step` for kind `sale` (buyer/name → `saleBuyerTyped`; phone → `salePhoneTyped`; a number on `paid`/`bank_amount` → `salePaid`/`saleBankPart`); called in `handleText` **before** the number path (a phone parses as a number, :658-659) and from `handleIntent`'s text block (:775-800) with the transcript |
| **changed** `handleCallback` case `S` (:444-450) | | `if (saleFlowSteps(ports)) return saleStart(…, clampQty(arg), saleStateOf(getState(…)), …)` else today |
| **changed** `QN` (:453-456), `D` (:457-460) | | the await state carries `sale: saleStateOf(getState(ports, uid))`; the message gets the back row in steps mode |
| **changed** `applyAwaitedNumber` (:710-753) | | `sale_qty`, `sale_price`: steps → `saleStart` / `saleStartPriced`; new `sale_paid` → `salePaid`, `sale_bank` → `saleBankPart` (bad values re-set the state, as `sale_qty` does at :726) |
| **changed** `askQty` (:246-255) | | last row gains `btn_discount → D\|id` in steps mode |
| **changed** `askAddOption` (:1373-1395) | | `a === 'FM'`: with no `args[1]` edit to `add_ask_kind` and return; with it, store `kind` in the add state; never `refuseOnCard` (Q2 is a question screen) |
| **changed** `finishAddOption` (:1417-1451) | | passes `state.kind` to `addListOptionByLabel`; `case 'FM': return saleResumeMethod(…)`; no hint for FM |
| **changed** `buildAiContext` (:615-633) | | `awaiting = 'sale_' + state.step` for kind `sale` |

### 3.5 core_report.js
`buildReceipt` adds `dueDay: info.dueDay` (:322-348); `receiptText` prints `sale_due_set` after `receipt_transfer`
when `r.dueDay && r.owed > 0`; the PDF data (`receiptReportData`) adds the same line. The owed report (`c.days`
reader at :302-311) adds a `DueDay` column; its sort stays by time.

### 3.6 core_sync.js
Section 2.1 and 2.2 (`syncValidateTx`, `syncListRecReason`, `syncApplyListEntry`). Nothing else: `syncSettingsFor`
already sends every Settings row and the derived `lists_json` (:915-929), so `sale_flow`, `sale_due_presets` and
`t` in compact rows reach the phones at the next hash change.

### 3.7 Messages (core_messages.js, all NEW; drafts for a native speaker)

```
btn_no_name:        '🚫 နာမည် မရှိ'                               (btn_design_none :226 pattern)
btn_pay_bank:       '🏦 ဘဏ်လွှဲ'                                  (method_BANK :130 behind the bank emoji)
btn_paid_all:       '✅ အကုန် {amount}'                            (btn_all :44 with ✅; this button commits)
btn_due_unknown:    '❓ မသေချာ'                                    (ms_low_hint :342)
btn_kind_wallet:    '📱 Pay အကောင့်'                               (lists_note_list :415)
btn_kind_bank:      '🏦 ဘဏ် အကောင့်'
add_ask_kind:       '➕ ဘယ်အမျိုးအစားလဲ? (ဘဏ် / Pay)'
sale_ask_method:    '💰 ဘယ်လိုပေးလဲ?'                              (exp_ask_method :164)
sale_ask_bank:      '🏦 ဘယ်အကောင့်လဲ?'                             (split_ask_bank :377)
sale_ask_due:       '📅 ကျန်ငွေ {owed} ကျပ် · ဘယ်တော့လဲ?'           (ping_overpaid core_sync.js:124, ord_ask_due :236)
sale_need_buyer:    'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်'            (btn_credit :41, app_need_online core_sync.js:101)
sale_line_qty:      '{qty} ထည် × {price} = {amount} ကျပ်'
sale_line_method:   '💰 {method}'
sale_line_mixed:    '💰 ငွေသား {cash} · {method} {bank}'
sale_line_paid:     'ပေးပြီး {paid} · ကျန် {owed}'                  (receipt_total :122)
sale_due_set:       '📅 ကျန်ငွေ · {date}'
sale_gone:          '⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ'                  (card_sold_out :11, rejected :70)
summary_due_passed: '⏰ ရက်လွန် အကြွေး: {list}'                     (summary_orders_overdue :369, summary_overdue :208)
lists_note_kind:    'wallet = Pay အကောင့် (QR) · bank = ဘဏ်လွှဲ · ကွက်လပ်ထားရင် wallet'   (lists_note_shop :420)
```
Rules kept: the round-4 rule "no new button text contains ငွေသား/KBZPay/WavePay/ဘဏ်လွှဲ or starts with 🏦 + space" is
enforced by run_lists.js step S over its fixed list of the 40 round-4 keys only (`buttons = KEYS.filter(...)`,
poc/run_lists.js:911-921), so `btn_pay_bank` ('🏦 ဘဏ်လွှဲ') is outside that check; it is a method-like button that
appears only on the guided Q2 (steps mode), it never becomes a message line (`stripMethodLines` drops text lines, not
buttons, core_bot.js:1102-1104), and no existing check finds a button by that text on a flow screen. `sale_line_mixed`
is a message line, not a button, and the family may rename either in the Messages tab. app/app_i18n.js:
`ui_btn_pick_date: '📅 ရက်စွဲ ရွေးပါ'`, `ui_date_title: '📅 ရက်စွဲ'` (btn_due_type :240, lists_note_list 'ရွေးပါ').
Reused as is: `credit_ask_customer`, `ask_name`, `ord_ask_phone`, `credit_ask_paid`, `split_ask_bank`,
`split_ask_amount`, `split_bad`, `split_no_bank`, `ord_ask_due_text`, `ord_bad_date`, `confirm_ask`, `btn_yes`,
`btn_back`, `btn_cancel`, `btn_skip`, `btn_other`, `btn_half`, `btn_days`, `btn_due_type`, `btn_cash`, `btn_bank`,
`btn_split`, `btn_add_bank`, `btn_new_customer`, `btn_create_named`, `cust_pick`, `cust_none`, `sold_done`,
`credit_done`, `cust_attached`, `method_done`, `split_done`, `credit_use_deposit`, `btn_use_deposit`,
`btn_no_deposit`, `deposit_applied`, `expired`, `tag_not_found`, `add_ask_pm`, `add_done`, `add_exists`,
`add_unavailable`.

---

## 4. Glue and sync

### 4.1 setupSheet (gas_setup.js:14-88)
1. `var ledger = ss.getSheetByName('Ledger') || ss.insertSheet('Ledger'); gasEnsureWidth(ledger,
   CFG.LEDGER_COLS.length); ledger = ensureTab(ss, 'Ledger', CFG.LEDGER_COLS);` — the Measurements precedent
   (:118-125): a new tab has 26 columns and `ensureTab` writes a 27-wide header (:247-254). Then `ensureColumns`
   (:257-265) appends `DueDay` on an existing sheet, and `textColumn(ledger, CFG.LEDGER_COLS, 'DueDay')`.
2. Settings defaults: `['sale_flow', 'steps'], ['sale_due_presets', CFG.SALE_DUE_PRESETS.join(',')]`.
3. `ensureTab(ss, 'Credits', CFG.CREDIT_COLS)` is unchanged; `refreshViews` rewrites the header anyway.
4. `ensureListsTab` (:150-210): `ensureColumns` appends `Kind`; `GAS_LIST_TEXT_COLS` gains `'Kind'`; the seed
   copies `kind`; a nicety adds a `wallet, bank` dropdown that allows blank; the header note loop needs
   `MSG.lists_note_kind` (it builds the key from the column name, :183-186).
5. Dashboard (:405-406): `'Overdue'`, `=SUMIF(CR('Overdue'),TRUE,CR('Owed'))`.

### 4.2 Writers and readers (gas_store.js, gas_sync.js)
- `gasStore.appendLedger` (:377-385): `DueDay: tx.dueDay || ''` in the map, and `gasEnsureWidth(sh,
  CFG.LEDGER_COLS.length)` before `appendRow` — closes map-glue's GAP 1 (a sale between "publish server" and
  "run setupSheet" would append 27 values into a 26-column tab; the fake refuses that, poc/fake_gas.js:408-411).
- `gasSyncTabs.appendRows` (gas_sync.js:174-183): the same `gasEnsureWidth` before `setValues`;
  `gasSyncLedgerValues` (:160-170) maps `DueDay`.
- `gasStore.ledgerRows` (:389-404): `dueDay: gasDay(o.DueDay)` (a Date typed by hand comes back as text).
- `gasStore.refreshViews` (:681-698): the 15-cell Credits row.
- `gasListRows` (:244-249), `gasStore.listOptions` (:629-633), `gasListValues` (:276-282) and the append row of
  `gasListsPersist` (:316) each name `kind` (every one of them is an explicit field list that drops what it does not
  name); the `set` branch of `gasListsPersist` (:319-323) stays label/detail only (kind is append-only, decision 7).
- `gasEnsureWidth` (gas_store.js:113-116) uses `getMaxColumns` and `insertColumnsAfter`, both in `FAKE_GAS_MEMBERS`
  (poc/fake_gas.js:52-53): no new member.

### 4.3 Validation and old phones (core_sync.js)
- `dueDay`: optional, `''` or `yyyy-mm-dd`; a new phone pushing to an old server passes (no unknown-field rule,
  :381-385) and the value is dropped by the old `gasSyncLedgerValues`; an old phone pushing to the new server
  passes with `dueDay` undefined → `''`; a new server pulling to an old phone: `appendSynced` keeps the extra key
  (app_store.js:444-452). Checksums hash only n/amount/cash (:876-887): no repair loop. Deployment order stays
  the README's (server, `setupSheet`, app); `gasEnsureWidth` in the writers makes the order a convenience, not a guard.
- `kind` on a list entry: validated and copied (2.2); an old server ignores it (`syncApplyListEntry` copies named
  fields only) and the row lands as a wallet — the laptop can set Kind later.
- `sale_flow` and `sale_due_presets`: Settings rows, carried by `syncSettingsFor` as every key; the phone reads
  them with `getSetting` (app_store.js:341-344); the first pull after the hash change switches the phone.

---

## 5. App (app/)

- **Input modes** (`appInputModeFor`, app_ui.js:68-78), new branches placed before the generic `await_text` line:
  `kind 'sale'` with step `buyer` | `name` | `phone` → `'text'`; other `sale` steps → `null` (buttons only);
  `await_text` with purpose `sale_due` → `'date'` (new mode); `await_number` purposes `sale_paid`, `sale_bank` →
  `'number'` by the existing kind rule (keypad auto-opens once per message, :758-760, titled with the first line:
  `credit_ask_paid` / `split_ask_amount`).
- **Date sheet**: `appInputBar` for mode `'date'` renders one primary button `ui_btn_pick_date`; `appOpenDateSheet()`
  draws a `.sheet` in `#overlay` (like `appOpenNumberKeypad`, :909-939) with `h3 ui_date_title`, `<input type="date"
  min=dayKey(now)>`, `[✖️ ပိတ် | ✅ အိုကေ]`; OK → `appSendText(value)` (`yyyy-mm-dd`, accepted by `parseDayText`).
- **Stepper**: unchanged (`appCardInfo`, `appStepperData`, `appKeyboardForCard`, :37-66); in steps mode its
  `S|id|N` opens Q1 in place of the card, which then has no `S|id|1` → plain rows, no stepper.
- **Back row**: a plain two-button row; `✖️` restores the item card (the latest bot message) with its stepper.
- **Tour hook**: `appRenderMsg` sets `data-cb` = `callback_data` on every keyboard button (one attribute, :682); the
  simulator highlights `.kb button[data-cb="…"]` with the existing `.hot` class (app.css:97). `appOnTap`'s busy
  mark (:784) and tap-to-paint telemetry (:344-346) unchanged.
- **Settings screen**: unchanged. No per-phone `sale_flow` toggle is drawn (the pref `setting:sale_flow` already
  works through `getSetting`, app_store.js:341-344, but the brief puts the switch in the Sheet's Settings, D5; see 9).
- **Form**: `#measForm.formpage` unchanged; the simulator scopes it inside the iframe (6.2), so no CSS change.
- **Bottom bar**, **scanner**, **sync**: unchanged. `tools/build_app.js` unchanged (new files: none).

---

## 6. Simulator v2 (poc/, D8)

### 6.1 Page: login, roles, devices, panes
- **Login** (`#login`, a full-page overlay at boot): three cards `👩‍💼 ဆိုင်ရှင် / Owner` (`SIM_USERS.owner`, the shared
  admin login), `🧵 ဆိုင် ၁ / Seller shop 1` (`sister`), `🧵 ဆိုင် ၂ / Seller shop 2` (`brother`) (poc/sim_seed.js:4-9);
  the "customer (not staff)" case becomes a tour step. Page state `S.login`; a header chip shows who is logged in
  with `🚪 Log out`. Switching keeps every device's data (the world is one).
- **Device bar** (`#devices`): `✈️ Telegram` · `📱 အက်ပ် / App` · `💻 Laptop` (owner only; a seller sees two). The
  Telegram device is today's phone pane bound to `world.chats[SIM_USERS[login].id]`; the app device is an iframe
  (6.2) enrolled for that login; the laptop is the Sheet pane plus a second app iframe at 720 px ("the app at
  laptop width", the form goes two-column from 700 px, app.css:193).
- **Stage**: left `What can I do · ဘာလုပ်လို့ရလဲ` (`#tours`, 6.4); centre the active device; right the shop floor
  (racks as today, poc/sim_ui.js:95-127; a click = a scan on the active device: Telegram → the START bar; app →
  `frame.contentWindow.appOpenTagId(id)`). Voice phrases and the parser box move into one collapsed
  `<details>` under the phone (D7).
- **Top actions**: `⏩ Next day` and `🕘 21:00` (set `world.nowOverride`, then post `buildDailySummary(world.ports,
  dayKey(now)) + server.summaryLines()` into the Family group tab, as app/dev/index.html:208 composes it), `Print
  tags`, `Reset`, `Simulate Gemini outage` (kept, inside the voice details).
- **Laptop tabs** (`renderSheet`, poc/sim_ui.js:283-324): Dashboard, **Lists (editable)**, Ledger (+ `DueDay`),
  Customers, Credits (+ `DueDay`, ⏰ by `c.overdue`), Deposits, Orders, **Measurements** (new: `world.measurements`
  with the field columns), Errors, **Settings** (new, editable: `sale_flow` as a two-button segment, `summary_hour`,
  `text_cards`, `app_voice`, `notebook_import`), **Devices** (new: `server.devices` with status, letter, pending),
  Family group. Sellers never see the laptop (BRIEF: the laptop is where lists are managed).

### 6.2 Embedding the real app
- One `<iframe srcdoc>` per device (`APP` is one global, app_ui.js:16; app.css fights the template's classes,
  map-sim). The srcdoc is built by `build_simulator.js`: `app/index.html` with `app.css` inlined, `config.js`
  dropped, the `<!-- @app-script -->` marker replaced by the inlined core + app files (the `tools/build_app.js`
  order, build_app.js:29-30, 55-58), the font link replaced by the template's Google Fonts link (fonts.css paths do
  not resolve in a srcdoc), and the boot script replaced by:
  `bootApp({apiUrl:'fake://sim-server', botUsername:'ShopTagBot', appName:'SalesTag', version:'sim'}, {adapter:
  createMemoryAdapter(), transport: function (api, body) { return new Promise(function (res, rej) { setTimeout(function
  () { try { res(parent.SIM.server.handle(api, body)); } catch (e) { rej(e); } }, parent.SIM.latency); }); },
  noServiceWorker: true}).then(function (app) { parent.SIM.onFrameReady(window, app); })` (the dev page's call,
  app/dev/index.html:138-150, with `parent.`). The string is embedded as `var SIM_APP_SRCDOC = <JSON>` with `</script`
  escaped.
- Enrolment: the tour's honest path (Telegram `📲 အက်ပ်` → `app_enroll_code` → type the code in the frame's
  `#codeInput` → `appDoEnroll`), plus a shortcut on the device bar: `server.mintEnrollCode(SIM_USERS[login], label)`
  → `frame.contentWindow.document.getElementById('codeInput').value = m.display; frame.contentWindow.appDoEnroll()`
  (poc/sim_sync.js:219-221; app/dev/index.html:172-173). The owner's `📱 ဖုန်းများ` then lists the frames with letters.
- After every Telegram action the page calls `frame.contentWindow.APP.sync.syncNow('sim')` so the phone shows the
  row; the phone's own pushes land in `world.ledger` through `syncTabs.appendRows` and emit `ledger` (sim_sync.js:
  137-139), so the Sheet pane redraws.
- The measurement form (`#measForm.formpage`, fixed inset 0) stays inside the iframe's document: the frame is its
  window. No app CSS change.
- Page `world.settings.sale_flow = 'steps'` at boot (the demo shows the guided sale); the Settings tab flips it and
  calls `syncNow('settings')` on every frame (the `app_voice` mechanism, app/dev/index.html:201-204).

### 6.3 Editable Lists and Settings
- `poc/sim_ports.js`: `store.setListRow(name, key, fields)` (sim-only, a hand edit): finds the raw row by
  `listNormKey`, assigns `label | active | order | shop | detail | kind` as given, emits `{type:'lists'}`. Adding a
  row from the laptop reuses `addListOption({list, key: listKeyFor(…), label, kind})` (the bot's own rule, so a
  duplicate label is refused the same way). The Lists tab draws Label (input), Active (checkbox), Detail (input),
  Kind (select wallet/bank/blank) and a `➕ row` form; `listRowSig`/`markListChanges` flash the change (sim_ui.js:
  359-372). Propagation is free: Telegram reads `store.listOptions` first (core_ledger.js:447); the frames pull
  `lists_json` at the next sync (hash change) — the page triggers `syncNow`.
- Settings tab: writes `world.settings[k]`, emits a new `{type:'settings'}` from a sim-only `store.setSetting`
  (today `nextOrderNo` emits `settings` already, sim_ports.js), then `syncNow` on the frames.

### 6.4 Tours ("What can I do")
- Engine `poc/sim_tours.js` (new, plain ES5, inlined by the build). A tour is `{id, my, en, steps: [{device, my, en,
  target, done}]}`. `target` is one of `{tag: 'S1-0002'}` (highlight the rack tile), `{cb: 'S|S1-0002|1'}` or
  `{label: MSG.btn_sell_one}` (highlight `[data-cb]` in the Telegram pane or inside the frame's document via
  `frame.contentWindow.document`), `{type: '18000'}` (highlight the input bar and pre-fill), `{ui: '#devices
  .app'}` (page chrome), `{tab: 'lists', cell: 'KBZ.Label'}` (laptop). `done(evt)` is checked on every
  `world.listeners` event (`update` after each Telegram tap/message, sim_ports.js:449-455) and on the frame's
  `APP.phone.on('change')`; the panel then shows the next caption in Burmese and English. A `⏭ do it for me` button
  performs the step (`world.sim.tap`, `appOpenTagId`, `APP.phone.sim.tapLast`, …). Every quoted label is read at
  run time with `t(world.ports, key)` / `MSG.key`, never retyped.
- **The sell tour, as the seller sees it** (device: the app; the Telegram variant is the same with START):
  1. 🏷 `S1-0002` on the rack glows — "Scan the tag · Tag ကို scan လုပ်ပါ" → the card appears with the stepper.
  2. `✅ ရောင်း ၁ ထည်` glows — "One piece sold. Tap ✅ · တစ်ထည် ရောင်းပြီ၊ ✅ နှိပ်ပါ".
  3. Q1: `👤 ဒေါ်မြင့်` glows — "Who bought it? Tap a name, type a new one, or 🚫 for no name · ဝယ်သူ ဘယ်သူလဲ?".
  4. Q2: `KBZPay` glows — "How was it paid? Cash, a Pay wallet, 🏦 bank transfer, or 💵+🏦 part and part".
  5. Q4: `✅ အကုန် 18,000` glows — "All of it now? Tap ✅ and the sale is recorded. Nothing was written before this tap."
  6. The sold card: `🧾 ဘောက်ချာ` glows — "The receipt; ↩️ undoes within 30 minutes" → the Ledger tab flashes the row.
  Variant tours: *deposit sale* (steps 5 → `တစ်ဝက်` → `၁၄ ရက်` → `✅ မှန်တယ်`; then the Credits tab shows DueDay and
  `⏩ Next day` ×15 shows ⏰ and the 21:00 line), *mixed payment* (`💵+🏦` → the account → `✏️` 10000 → `✅ အကုန်`),
  *changed price* (`💬` → type → count → …), *cancel and back* (`⏮`, `✖️` brings the card back).
- Tour list (D8): sell step by step; sell with a deposit and a date; mixed payment; restock (`📦 ကုန်ရောက်` → `+၅`);
  register a new piece by photo (blank tag → 📸 → price → cost); return (`↩️ ပြန်အမ်း`); expense (`💸 ကုန်ကျ` →
  category → amount → method); receive a payment (`💰 ငွေလက်ခံ` → the credit → `အကုန်`); take a deposit (`📥 စရံ`);
  custom order with voucher and measurements (Telegram: `🧵 အော်ဒါ` → … → `📏`; app: the form); reports and the
  21:00 summary (`🖨 စာရင်း` → `📅 ဒီနေ့`; `🕘 21:00`); enrol a phone (`📲 အက်ပ်` → the code → the frame); manage
  lists on the laptop (Lists tab: rename KBZPay, retire one, set Kind, watch the how-paid screen change); switch to
  the quick sale (Settings tab) and back; a stranger scans a tag (`SIM_USERS.customer` → `staff_only`).

### 6.5 Files and build
- `poc/build_simulator.js`: `FILES` = `core_config, core_burmese, core_messages, core_ai_prompt, core_ledger, core_report,
  core_bot, core_sync, core_orders`, `sim_mock_ai, sim_ports, sim_seed, sim_sync`, `sim_tours`, `sim_ui`; plus
  `APP_FILES` (the seven app files in `APP_FIRST` order) for the srcdoc; the `</script` rule applies to every file
  and the srcdoc string is escaped. Output `poc/dist/pos-simulator.html` (≈ 1.9 MB: the core inlined twice; fine
  for an artifact). `app/vendor/jsQR.js` is left out (a rack click is the scan; `app_scan.js` tests `typeof jsQR`).
- `poc/simulator.template.html`: the login overlay, header chip, device bar, the three-column stage (`#tours` |
  device | floor), the laptop layout (Sheet + wide frame), the collapsed voice `<details>`, the clock buttons,
  the `.hot` highlight for the Telegram pane (`.kb button.hot`), caption styles; the CSS tokens and dark theme
  stay (:5-34).
- `poc/sim_ui.js`: `boot()` sets `sale_flow`, creates `server = createFakeServer(world)` and `window.SIM = {world,
  server, latency: 250, onFrameReady}`; `renderMsg` adds `data-cb`; login/device/tab rendering; `setListRow`
  bindings; Measurements/Settings/Devices tabs; a smoke autopilot `?login=sister&device=app&tour=sell` and
  `window.SIM_ERRORS` (the dev page's pattern, app/dev/index.html:96-107, 156-184).
- `poc/sim_tours.js` (new), `poc/sim_ports.js` (`setListRow`, `setSetting`), `poc/sim_sync.js` unchanged.
- Smoke (orchestrator, browser): open the file, log in as each role, run the sell tour on Telegram and on the app,
  the deposit tour, the lists tour; no `SIM_ERRORS`; the frame enrols; the Ledger flashes; dark mode readable.

---

## 7. Tests

Convention (SPEC-round-4 §12): numbered steps, `check(cond, label, detail)`, labels from `MSG`, the 64-byte
watcher, `0 failed`. Every check below fails without its feature.

### 7.1 poc/run_round5.js (new; `bench()` copied from run_round4.js:50-136 with `world.settings.sale_flow = 'steps'`)
1. **Flow start**: START + `✅ ရောင်း ၁` on `S1-0005` writes **no** row (`ledger.length` unchanged), edits the card in
   place (`card.edited`), its text ends with `credit_ask_customer`, its buttons are `[F|c|S1-0005|none]`, up to four
   `F|c|S1-0005|<C-…>`, `[F|c|S1-0005|new]`, `[F|b|S1-0005, F|z|S1-0005]`; the state is `{kind:'sale', step:'buyer',
   itemId:'S1-0005', draft:{qty:1}}`. The UNIQUE card's `✅ ရောင်းပြီး` does the same with `hist []`.
2. **Count**: `🔢` → `၃` → Q1 with `draft.qty 3` and `sale_line_qty` showing `၃ ထည် × 18,000 = 54,000`; the grid's
   last row is `[QN|…, D|…, Z]`; `✏️` + typed `4` → Q1 as a new message; typed `0` → `bad_qty`, state kept.
3. **Changed price**: `💬` on the card, typed `15000`: SKU → the grid with `× 15,000`; then `၂` → Q1 with
   `2 × 15,000 = 30,000`; UNIQUE → Q1 directly. The committed SALE row has `unitPrice 15000`, `amount 30000`,
   note `'price'`.
4. **Simplest sale**: `🚫` → `💵` → `✅ အကုန် 18,000`: exactly one row appended at the last tap (the count is
   asserted before and after each of the three taps), `qty -1, amount 18000, cash 18000, method 'CASH', customerId
   '', dueDay ''`, the message edited into `soldText` with `[U|g, RC|g]` only; `getState` null; `lg:<uid>` set.
5. **Known buyer, wallet**: `👤 ဒေါ်မြင့်` → `KBZPay` → `✅`: `customerId C-0001`, `method 'KBZ'`, card text has
   `cust_attached` and `method_done`; no `PY`.
6. **New buyer with phone**: `✏️ နာမည်အသစ်` → typed `ဒေါ်စန်း` → `ord_ask_phone` with `[F|ph|…|skip]`; typed
   `09 777 123456` → Q2; **no Customers row yet** (`world.customers.length` unchanged); after `✅` the row exists with
   `phone '09777123456'` and the sale has its id. A look-alike name (`ဒေါ်မြ`) shows `cust_pick` with `btn_create_named`.
   A typed phone of a known customer picks that customer. Skip leaves `phone ''`; `phoneRow` appears on the card.
7. **Bank transfer**: `🏦 ဘဏ်လွှဲ` with one bank account → Q4 directly (no account screen) and `method 'BANK'`; with
   two bank accounts (`setAccounts` with kinds) → `sale_ask_bank` with two `🏦` buttons and `[LA|pm|FM|id|bank]`;
   with none → `split_no_bank` + `➕`. Wallets never appear on the bank screen; `ဘဏ်လွှဲ` never appears as a wallet
   button on Q2 (seed kinds).
8. **Mixed**: `💵+🏦` → (one account: skipped) → `split_ask_amount` with `[F|x|…|half] [F|x|…|t]`; `✏️` + `10000` → Q4
   with `[✅ အကုန်] [✏️]`; `✅` → **two rows in one group**: SALE `cash 8000, method 'CASH'` then PAYMENT `amount 10000,
   method 'KBZ', refGroupId = group, note 'split'`; `saleGroupInfo.owed 0`; `groupMethods` two entries;
   `dayStats` CASH +8,000 and KBZ +10,000; the receipt text contains `(ငွေသား 8,000 · KBZPay 10,000)`; typed `18000`
   on Q3c → not mixed (`method 'KBZ'`, one row); `U|g` reverses both rows and restores stock.
9. **Deposit sale with a date**: `တစ်ဝက်` on a 1,000,000 set with no buyer → Q1 without the 🚫 row and with
   `sale_need_buyer`; buyer → `sale_ask_due` with `[F|d|…|7, 14, 30]` `[F|d|…|t, F|d|…|none]`; `၁၄ ရက်` → Q6 with
   `confirm_ask` and `[F|ok|…]`; `✅ မှန်တယ်` → one SALE row `cash 500000, dueDay = addDaysKey(today, 14), note
   'credit'`; card has `credit_done`, `sale_due_set`, `[U, RC] [PY]`; `openCredits` row has `dueDay`, `overdue
   false`; `tick(15 days)` → `overdue true`, `buildDailySummary` contains `summary_due_passed` with the name and
   **not** `summary_overdue`; the seeded undated credit (sim_seed) still uses `summary_overdue` at 30 days.
   `❓ မသေချာ` → `dueDay ''`, `overdue` by `OVERDUE_DAYS`. `0` → `cash 0, method ''`.
10. **Typed date**: `✏️ ရက်စွဲ ရိုက်` → state `{await_text, sale_due}`; `30.12.26` → Q6 (new message) with `fmtDayMy`;
    `2026-12-30` accepted the same; `abc` and yesterday → `ord_bad_date`, state kept.
11. **Deposit held**: a buyer with 300,000 free deposit (`ဒေါ်ခင်`) and owed → the card asks `credit_use_deposit`
    with `[F|u|g|yes, F|u|g|no]` only; `yes` → a DEPOSIT_APPLIED row in the group, `deposit_applied`, then
    `guidedSaleKeyboard`; `no` → the keyboard without a write.
12. **Back**: from Q2 `⏮` → Q1 with `draft.customerId` cleared and the summary without the buyer line; from Q4 after
    a bank account → Q2 (the skipped account screen is skipped backwards too); from Q1 of a card-started flow →
    the item card and no state; from Q1 of a grid-started flow → the grid.
13. **Cancel**: `✖️` on Q2 → the message is `cardText + cardKeyboard`, state null, no row; `Z` still answers
    `cancelled`.
14. **Stale and expired**: a tap on an earlier screen (after a typed answer moved the flow) → that message says
    `expired`, the live message untouched, state unchanged; `tick(31)` then a tap → `expired` and a fresh item card
    as the last message; a scan of another tag mid-flow → the flow's buttons answer `expired` + card; after the
    commit a second `F|p|…|all` writes nothing.
15. **Stock changed**: UNIQUE `S1-0001` sold by the brother (another user) while the sister is on Q4 → her `✅` →
    `sale_gone`, no row, state null. SKU below zero still writes (today's rule).
16. **➕ kind first**: `LA|pm|FM|id` on Q2 → `add_ask_kind` with the two kind buttons, state unchanged (`sale`);
    `bank` → `add_ask_pm`, add state with `kind 'bank'` and `saved` the sale; typed `AYA ဦးမောင်` → a Lists row with
    `kind 'bank'`, the reply `add_done` + Q4 as one new message with **no** `LD|` button; the sale's method is the new
    key; the next sale's Q2 shows it only behind 🏦. `wallet` → the next Q2 shows it by name. Digits-only name →
    `add_ask_pm` again. `Z` on the kind screen → `cancelled` and the sale state back.
17. **App surfaces**: `appInputModeFor` for `sale/buyer` `'text'`, `sale/method` `null`, `await_text/sale_due`
    `'date'`, `await_number/sale_paid` `'number'`; `appCardInfo(Q1 message)` null (no stepper on a flow screen).
    (Pure helpers; run_app.js step 32 repeats them on the real app store with a full guided sale and a mixed one
    ending in one outbox group of two rows, and `lists_json` compact rows with `t`.)
18. **Quick switch**: `world.settings.sale_flow = 'quick'` on the same bench → `✅ ရောင်း ၁` writes one row and
    shows today's `afterSaleKeyboard` layout (the run_round4 step-1 `datas`), `D` sells one piece at the typed price,
    no `F|` button anywhere; back to `steps` → Q1 again. The code default without the key is `steps`.
19. **Voice unchanged**: `sim.voice(sister, 'ဒါ ၂ ထည် ရောင်းရတယ်')` → confirm card → `✅ မှန်တယ်` writes as today
    and shows `afterSaleKeyboard` (corrective buttons) in steps mode too.
20. **Owner**: the owner's flow is identical; `V|g` still voids a guided sale; the receipt carries `sale_due_set`.
21. **Receipt and summary**: `RC|g` text order (`receipt_total`, `receipt_transfer`, `sale_due_set`,
    `receipt_customer`); the PDF data has the due line; `summary_cash` owed includes the guided credit.
22. **Lists kind in the core**: `listNormRow` default `''`, `accountKind` wallet; compact round trip keeps `t`;
    `legacyListRows` gives `BANK` `kind 'bank'` and `KBZ` `'wallet'`; `listUpsert` append carries kind;
    `syncListRecReason` accepts `'bank'`, rejects `'x'`.
23. **64 bytes and no errors** (as run_round4.js:1965-1969): every callback ≤ 64 bytes over every world; the longest
    is `F|u|<group>|yes` (44); no `handleUpdate` error in any world; and the steps mirror of the two-tap check:
    "START + one tap asks who bought it; nothing is written before ✅".

### 7.2 Existing checks that change (named, D9)
- `poc/run_lists.js:703` — `Object.keys(b.row).length === 26` → `27` (the row has `dueDay`).
- `poc/run_lists.js:592` — compact keys `['k','l','a','o','s','d']` → `['k','l','a','o','s','d','t']`, and the exact
  `data.pay_method[4]` object gains `t: ''` (that row is pushed into `w.lists` without a kind).
- `poc/run_lists.js:869` and `:1003` — the exact eight-field normalised rows gain `kind: ''`.
- `poc/run_gas.js:421-430` (`defaultLists`) — every seeded row gets a ninth cell: `''` for CASH, `'bank'` for BANK,
  `'wallet'` for KBZ and WAVE, `''` for every expense category and fabric; `:439` compares the seeded tab with it;
  `:456` `c.cols === 8` → `9`; `:466-467` iterate `CFG.LIST_COLS` and stay green, only the label "eight header cells"
  is reworded; `:1094-1097` the four compact pay_method rows gain `t` (`''`, `'wallet'`, `'wallet'`, `'bank'`).
  `:520` (`L.note(1, 8) === MSG.lists_note_note`) stays green because `Kind` is appended as the ninth column and Note
  keeps column 8: one more reason `Kind` goes last in `LIST_COLS`.
- No check pins the Dashboard's Overdue formula text (grep `Overdue` in run_gas.js: none); the Credits header checks
  read `CFG.CREDIT_COLS`.
- Everything else stays untouched and green: `seedSimWorld` sets `sale_flow: 'quick'`, so run_scenario.js (327 checks
  today, not edited at all), run_round4.js (338, incl. step 10 "nothing is asked before the commit"), run_sync.js
  (307), run_app.js (186), run_lists.js (236 minus the four edits above) and run_gas.js (249 minus the edits above)
  drive the one-tap card as today; the app dev page too. (Counts from `node poc/run_*.js` on 2026-11-11.)

### 7.3 Appended checks in the other suites
- **run_lists.js** (step 1): `parseDayText` ISO and the moved helpers exist in core_burmese.js (loading core_config,
  core_burmese only); `newTx` `dueDay` default `''`; `rewriteRows` keeps `dueDay` on the replacement and leaves the
  mirror blank; `openCredits` `overdue`/`daysOver` for dated, undated and the boundary day; `commitSaleGroup` shapes
  (cash, wallet, bank, mixed, nothing paid, clamps) and that `undoGroup` nets a mixed group; `CREDIT_COLS` 15.
- **run_sync.js**: a group with `dueDay '2026-12-30'` applied and pulled back with the value; `dueDay 'x'` →
  MALFORMED quarantine; a list entry `{kind:'bank'}` stored with the kind, `{kind:'x'}` MALFORMED; `lists_json` carries
  `t`; `sale_flow` reaches a phone in the bootstrap and after a hash change.
- **run_gas.js**: `setupSheet` on an empty book makes a 27-column Ledger with `DueDay` last and text-formatted, a
  15-column Credits header, a 9-column Lists tab with the Kind dropdown and `lists_note_kind`; a second run changes
  nothing; a version-4 book (26 columns, rows) gets `DueDay` appended and `Kind` appended; a Telegram sale before
  `setupSheet` grows the grid (`appendLedger` with 27 values on a 26-column tab succeeds); the sync push writes
  `DueDay`; `ledgerRows` reads it back; the Dashboard row reads `=SUMIF(Credits!O:O,TRUE,Credits!L:L)` (letters by
  `colLetter`); Settings defaults `sale_flow`/`sale_due_presets` seeded once.
- **run_app.js** (step 32): section 7.1 item 17's real-store part, plus: the stepper's `S|id|3` on a steps-mode phone
  opens Q1 with `draft.qty 3` and no row; the restart test (run_app.js:205-217 pattern) with a half-finished guided
  flow keeps the state; the per-device pref `setting:sale_flow = 'quick'` wins over the pulled `steps`.
- **Manual browser checks** (orchestrator): the date sheet opens and sends `yyyy-mm-dd`; the buyer text bar; the
  simulator smoke of 6.5; the dev page's sale in steps and quick.

---

## 8. Build steps and file ownership

Nobody edits a file outside their step's list; a needed change elsewhere goes into the report. Each step's checker
is the suite that must end `0 failed` plus the acorn ES5 parse of every edited core_/app_ file (the round-4
convention, SPEC-round-4.md:76-79; no repo script exists, map-glue L).

1. **Model** (first, alone): `core_config.js`, `core_burmese.js` (date helpers in, ISO), `core_orders.js` (date
   helpers out), `core_ledger.js` (`commitSaleGroup`, kind, dueDay, credits, summary), `core_messages.js` (every key
   of 3.7), `core_report.js`, `core_sync.js` (2.1, 2.2), `poc/sim_ports.js` (kind, `setListRow`, `setSetting`),
   `poc/sim_seed.js` (`sale_flow: 'quick'`), `poc/run_lists.js` (the three named edits + 7.3), `poc/run_sync.js`
   (7.3). Checker: run_lists, run_sync, run_scenario (unchanged), run_round4 (unchanged), run_app (unchanged).
2. In parallel after 1:
   - **Bot**: `core_bot.js`, `core_messages.js` (additions only), `poc/run_round5.js` (new). Checker: run_round5,
     run_scenario, run_round4 (both unchanged and green).
   - **Glue**: `gas_store.js`, `gas_setup.js`, `gas_sync.js`, `gas_main.js` (no change expected), `poc/fake_gas.js`
     (no new member expected), `poc/run_gas.js` (the named edits + 7.3). Checker: run_gas.
   - **App**: `app/app_ui.js`, `app/app_i18n.js`, `app/app.css` (date sheet only), `poc/run_app.js` (step 32).
     The state names and purposes of 3.4 are the contract that lets this run before the bot step lands. Checker:
     run_app; `node tools/build_app.js` loads.
3. **Simulator v2** (after 2): `poc/build_simulator.js`, `poc/simulator.template.html`, `poc/sim_ui.js`,
   `poc/sim_tours.js` (new), `app/dev/index.html` (a `sale_flow` checkbox, optional). Checker: the build runs; the
   browser smoke of 6.5; every Node suite still green (sim_ui is not loaded by them).
4. **Docs** (last): `apps-script/README.md` (DueDay, Kind, `sale_flow`, deployment order), `app/README.md` (the
   guided sale, the date sheet), `docs/USER-GUIDE.html`, `POS-PROJECT-PLAN.md` Appendix F.

Deployment: publish the server, run `setupSheet` once (27th Ledger column, Credits columns, Lists Kind, the two
Settings rows), publish the app, rebuild the simulator artifact.

---

## 9. Not built (deliberately)

- Anything new on voice (D7): a spoken answer inside a step is handled like typed text; no new intents.
- A per-phone `sale_flow` toggle on the app's Settings screen (the pref already works; the brief wants the switch
  on the laptop).
- Reminders to buyers, a "due soon" summary line, SMS/Viber links: the Credits view and the 21:00 line carry the date.
- Editing one answer after the commit: undo within 30 minutes and sell again (the corrective after-sale buttons
  are reachable in `quick` mode and on the voice card).
- Several tags on one receipt; a discount in percent; a Kind for expense categories or fabrics; renaming or retiring
  an account from the phone (the laptop's job); a Kind `set` op in `listUpsert`/`gasListsPersist`.
- A camera scanner inside the simulator's app frame (`jsQR` left out; the rack click is the scan).
- Owner-only steps in the guided flow (both roles sell the same way).

## Appendix: D1-D9, kept or refined

| D | Kept | Refined (why) |
|---|---|---|
| D1 | one question, ≤ 6 answers, back row | back glyph `⏮ နောက်ပြန်` (↩️ is undo); the digit grid keeps eight digits (one number question) |
| D2 | order scan → count → buyer → how paid → account → amount → date → card; skips; 💬 on the count screen; mixed after the account; part needs a buyer | full-or-part and how-much are one screen whose ✅ button commits; a confirm screen only on the part path |
| D3 | one write at the end, nothing before, no corrective buttons on the guided card | the buyer's deposit is applied by an explicit tap after the write (as `finishCredit` does today) |
| D4 | `DueDay` 27th column, Credits and 21:00 use it, right-hand end | Credits also gets `Overdue` so the Dashboard formula, the summary and the simulator agree; date helpers move to core_burmese.js |
| D5 | `sale_flow` steps/quick, old suite green unchanged | code default `steps`, `seedSimWorld` `quick`, the simulator `steps` |
| D6 | Kind wallet/bank, blank = wallet, laptop renames/retires, ➕ asks the kind | kind asked **before** the name (append-only persistence); only the guided screens ask it |
| D7 | voice as today | — |
| D8 | login, device bar, laptop tabs incl. editable Lists, tours, one file | iframe srcdoc per device; Settings/Measurements/Devices tabs; clock control |
| D9 | ES5, one scope, 64 bytes, append-only, lock, checks, no new apps-script file, config untouched | the named edits of 7.2 are the only existing checks touched |
