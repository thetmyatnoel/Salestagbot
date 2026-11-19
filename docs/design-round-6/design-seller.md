# design-seller.md — round 6 from the seller's side (designer's report, 2026-11-12)

Angle: a product planner for sellers with no computer habit. Every screen a seller touches is written out top to
bottom (field, default, when it appears, label, what Save does, what an error looks like) at phone width and at laptop
width; then the Telegram review cards (the backup), what the owner sees, the data, the functions, the readers, the
glue, the app code, the simulator, the tests and the build. Inputs: `BRIEF.md` (R1-R9, binding), `map-app-forms.md`,
`map-core-commits.md`, `map-sim-tests.md`, `docs/design-round-5/map-basket-readers.md` ("the basket map") and the
current tree (rounds 4 and 5 built, unpublished). Every Burmese label is copied from `MSG` (apps-script/core_messages.js)
or `APP_MSG` (app/app_i18n.js) with its line; a label marked **NEW** is a draft made from words MSG already uses and
must be rewritten by a native speaker (core_messages.js:2-4).

## Top decisions (where this design chooses inside R1-R9)

1. **One switch, two worlds.** `saleFlow(ports)` returns `form` or `quick` (R6; `steps`, blank and any other value read
   as `form`). `form` turns on together: the seller's home and the app's four forms (sale, new piece, restock,
   expense), and in Telegram the sale review card and the new-piece review card. `quick` is round 4 exactly: the one-tap
   card, the photo price-then-cost steps, the app's chat cards and stepper. A phone whose server lacks the `dueDay` cap
   is already forced to `quick` (core_sync.js:1454-1467), so a form-written shape never reaches a server that cannot
   read it. **No new cap**: run_gas.js:1771 and the caps half of run_sync.js:1734 stay.
2. **Scan = sell.** On the seller's home, a scan of a sellable own-shop tag opens the sale form with that line; a blank
   tag opens the new-piece form; a sold piece, or another shop's piece, opens today's item card. A normal cash sale is
   **one scan and one tap** (Save).
3. **Forms are app-native pages** on `document.body` like `#measForm` (app/app_ui.js:1001-1052), in ONE new file
   `app/app_forms.js`: pure helpers (Node-tested) plus a thin DOM. They call the core writes on `phone.ports`, then
   `phone.commit(kind)`, then `sync.scheduleSync()` (the `appMeasCommit` pattern, app_ui.js:257-259), and **show the
   reply card only after the commit resolved** (the measurement form closes before it, :1143-1151).
4. **Numbers are typed on the app's own 64 px keypad** (`appOpenNumberKeypad`, app_ui.js:940-970), raised above an open
   form; names, phones, notes and searches use native inputs. One kind of number entry everywhere, with `000`.
5. **One write per Save.** A basket is ONE `writeGroup` (new `commitBasket`); `commitSaleGroup` becomes its one-line
   wrapper and writes the same rows, so the seven outcomes (poc/run_wizard.js:520-549) stay green. One receipt number
   per basket (the phone copies the first SALE row's number onto the group's later SALE rows). One undo.
6. **The rules live in shared pure helpers** (`basketAddItem`, `basketCheck`, `basketTotals`, `saleDueKey`,
   `newItemCheck`, `itemMargin`) used by the app form and the Telegram card alike, because the commit functions clamp but
   never refuse (map-core-commits 0.3). One Save function for both (`basketCommit`, core_bot.js).
7. **A part payment asks for the promised day** (7, 14, 30 days, a date, not sure; none preselected). One tap, and the
   owner's overdue list stays useful. A full payment never shows it.
8. **The profit percentage is markup on cost**, and the label says so: '📈 အမြတ် {profit} · အရင်းရဲ့ {pct}%' (NEW,
   "{pct}% of the cost"). A family shop prices a piece by adding to what it cost; margin on price is not shown.
9. **The app never waits for the photo AI.** The new-piece form works offline; an empty name is saved as the placeholder
   'ပစ္စည်း <id>' and the AI renames the piece after the next sync (today's replay rule, app/app_sync.js:388-395). The
   AI job is queued **at Save**, after the item write, so the item entry is always pushed before the job and the server's
   Drive URL is never overwritten by the phone. Telegram runs the AI at once (core_bot.js:2116-2121), so its card is
   pre-filled.
10. **Count above 1 makes a stock item**: type SKU and ONE RESTOCK row of that count (the `importProducts` precedent,
    core_ledger.js:1803-1813). Count 1 stays UNIQUE, as today.
11. **Payment, deposit and return stay chat flows** (R4 "could"). They already work in the app through ☰ and the item
    card, and a form would not save taps (section 10).
12. **The Telegram review card keeps the round-5 state and callbacks** (`{kind: 'sale'}`, `SS|<item>|…`, `SC|<item>|ok`):
    slot 1 becomes the card's *anchor* (the first item, fixed for the card's life, so `ITEM_ACTIONS` at core_bot.js:431
    stays), `state.draft.lines` holds the basket, `state.step` names the open sub-screen (`'card'` when none) and `hist`
    dies. The round-5 screens become the card's edit screens and return to the card.
13. **No round-5 message key is deleted**, so run_wizard.js:1619/1623 and run_gas.js:1498 stay; only the text of
    `settings_note_sale_flow` changes (run_wizard.js:1633 is named).
14. **Simulator:** sellers land on 📱 un-enrolled with ⚡ lit (the enrol tour stays possible). Form steps use a new
    target kind `f` (a `data-f` control), frame ops `form`, `fset`, `fphoto`, a `form` object in the frame snapshot, and
    a page scan event on the app too (map-sim-tests T1-T7 and T10 closed).

---

## 1. Screens

### 1.0 Rules every app form follows

- **One form at a time**: `div#saleForm | #newForm | #restockForm | #expenseForm`, class `formpage`, `role=dialog`, on
  `document.body`, so it survives every `appRender` (app_ui.js:373-389). `APP.screen` stays `'home'`, so the
  simulator's pre-step never closes it (map-sim-tests T3). Opening a form closes an open one (and `#measForm`), clears
  `#overlay`, stops the home scanner and clears a stale core state (`clearState`, as `startMeasureFor` does,
  core_bot.js:4198).
- **Layout**: `.fcol` (max 900 px, app.css:172), `.fhead` with the title and `ui_btn_close` '✖️ ပိတ်' (app_i18n.js:37),
  the sections in the order below, then the fixed `.fbar` (app.css:190) with the running total, `.fmsg` and ONE green
  Save `btn_save` '✅ သိမ်း' (core_messages.js:344). Every tap target is at least 56 px (`--tap`, app.css:16).
- **Progressive disclosure**: a section shows only what the current choice needs. Every reveal rule is a pure function
  (`appSaleView`, `appNewView`), so the screen and the Node checks agree.
- **Numbers**: prices, amounts, counts and costs are `.fnum` buttons that look like inputs and open the number keypad
  titled with the field's label. The keypad draws into `#overlay`, which gets class `over` (z-index 34: above `.fbar`
  33, below the toast 40, app.css:77, :136, :171, :190) while a form is open (map-app-forms 6). Counts also have
  `[−] n [+]` (`.stepper`, app.css:98-100).
- **Save**: the tap disables Save and shows `ui_form_saving` '⏳ သိမ်းနေသည်…' (NEW). The pure save runs. A refusal
  re-enables Save, writes its text into `.fmsg`, outlines the field (`.fbad`) and scrolls it into view (no toast).
  Accepted: `phone.commit('<kind>')`; when it resolves the form closes and the home shows the core's reply card
  (`APP.showScanner = false`). When the write fails (`false`) the form closes anyway: the rows are in memory and the
  next commit retries, and `ui_not_saved` '⚠️ ဖုန်းထဲ မသိမ်းနိုင်ပါ · ထပ်ကြိုးစားပါမည်' (app_i18n.js:58) is toasted by
  `appOnChange` (app_ui.js:364). Saving again would write twice, so the form never offers it. The core's tap guard
  covers callbacks only (core_bot.js:445-449); the disabled button covers the form.
- **Draft**: every change is kept in the persisted cache (`saledraft:<staffId>` TTL 1800 s, `newdraft:<itemId>` 86400 s,
  `rsdraft:<staffId>` and `expdraft:<staffId>` 1800 s) and made durable by a 400 ms debounced `phone.commit('formdraft')`,
  a change kind `appOnChange` ignores as it ignores `measdraft` (app_ui.js:354-357). Reopening the same form restores it
  with the strip `ui_form_restored` '📋 မသိမ်းရသေးသော စာရင်း ပြန်ပေါ်လာပါပြီ' (NEW) and `ui_form_clear` '🔄 အသစ်' (NEW).
  A restored sale line whose UNIQUE piece was sold meanwhile is dropped with a toast `sale_gone`.
- **Close**: ✖️ on a form the seller changed asks `ui_meas_close_ask` 'ရိုက်ထားတာတွေ မသိမ်းဘဲ ပိတ်မလား?'
  (app_i18n.js:149); yes drops the draft and any photo taken for it (`store.removeMedia`). A form opened by a scan and
  not touched since closes without asking, so a price check costs one tap.
- **Scanning inside a form** (sale and restock): a compact camera box `.fscan` (16:9, at most 30 vh) at the top re-uses
  the one scanner and its `<video>` (`APP.scanner`, `APP.videoEl`, app_ui.js:532-552): the video node moves into the
  form and back. The camera restarts 800 ms after each read (the scanner stops itself after a decode, app/app_scan.js:45-53;
  the same text within 2 s is ignored, :47). Under it, `ui_btn_keypad` '⌨️ နံပါတ် ရိုက်မယ်' (app_i18n.js:31) opens the tag
  keypad with a callback into the form; at 700 px and wider a text box with the placeholder `ui_keypad_title`
  '🔢 Tag နံပါတ်' (:32) also takes a typed id or a USB scanner's line (Enter adds; `appParseTagLink`, app_scan.js:13-21).
  An accepted read flashes its line; a refusal is a toast (the seller is looking at the tag, not at the bar).
- **Labels** come from `t()` only; every input has an `aria-label`; every control carries `data-f="<name>"` (section 7).

### 1.1 The seller's home (form mode)

Phone width (`#app` max 600 px, app.css:57), top to bottom:

```
┌ header (unchanged): ဆိုင် ၁ (ရန်ကုန်)              ✓ ပို့ပြီး   ⚙ ┐
[banner, only when there is one (unchanged)]
┌ .jobgrid 2 × 2, 72 px ─────────────────────────────────┐
│ 🛒 ရောင်းမယ်               │ 🆕 ပစ္စည်းအသစ်              │
│ 📦 ကုန်ရောက်               │ 💸 ကုန်ကျ                   │
└────────────────────────────────────────────────────────┘
┌ scanner panel (today's, app_ui.js:507-531): video, guide, 🔦, ✖️ ┐
ℹ️ Tag ဖတ်ရင် ရောင်းမည့် စာရင်း ပွင့်ပါမည်                    (muted, small)
[⌨️ နံပါတ် ရိုက်မယ်]
🕘 မကြာသေးမီ   six tiles (appRecentPanel / appTiles, app_ui.js:570-590)
🔍 ရှာ  [🔍 ပစ္စည်း အမည် ရိုက်ပါ ][🔍]                       (appFindPanel, :591-609)
┌ bottom bar (unchanged, app/index.html:30-34): [📷 ဖတ်] [☰ မီနူး] ┐
```

| Element | Label | Tap does |
|---|---|---|
| 🛒 tile | `ui_home_sell` '🛒 ရောင်းမယ်' (NEW) | the sale form, empty, its camera on |
| 🆕 tile | `ui_home_new` '🆕 ပစ္စည်းအသစ်' (NEW) | the new-piece form, waiting for a blank tag |
| 📦 tile | `btn_restock` '📦 ကုန်ရောက်' (core_messages.js:24) | the restock form, its camera on |
| 💸 tile | `btn_expense` '💸 ကုန်ကျ' (:160) | the expense form |
| scan, keypad, recent tile, find result | hint `ui_home_scan_hint` 'ℹ️ Tag ဖတ်ရင် ရောင်းမည့် စာရင်း ပွင့်ပါမည်' (NEW) | the scan router (1.2) |
| ☰ မီနူး | unchanged (index.html:33) | the core's menu (core_bot.js:131-153): today, recent, find, 💰 payment, 📥 deposit, customers, reports, accounts, 📏, 📲 |

- After a Save the home shows the reply card as the big latest card with its buttons (today's card state,
  app_ui.js:497-504); 📷 ဖတ် brings the scanner back (:337). While a form is open the home draws no scanner panel
  (the video is in the form).
- On an item card in the chat, form mode draws no stepper (`appRenderMsg` consults `appCardInfo` only when `saleFlow` is
  `quick`, app_ui.js:690-692): the core's own buttons show and ✅ opens the form (3.4).
- Laptop width: the same column centred at 600 px; a form opens at its own 900 px width with two columns (1.3-1.6).
- `quick`: today's home exactly (no job grid; a scan opens the item card with the stepper).

### 1.2 The scan router (`appScanRoute`, pure)

The camera, the tag keypad, a recent tile, a find result and the simulator's rack click all end here.

| Situation | Result |
|---|---|
| no form open, tag unknown | toast `tag_not_found` '❓ Tag {id} ကို မတွေ့ပါ။' (core_messages.js:8), the scanner restarts (as app_ui.js:558-562) |
| no form, BLANK tag | the new-piece form for that tag |
| no form, sellable (UNIQUE in stock, or SKU), own shop (owner: either shop) | the sale form with that line |
| no form, UNIQUE sold | today's item card through the core (`phone.sim.start(id)`), which names the buyer (`card_buyer`, :156) |
| no form, a seller's scan of the other shop's tag | toast `basket_other_shop` (NEW) and today's item card (its 🔁 transfer button stays) |
| sale form open | `basketAddItem`: a new line, or count + 1 for a SKU already in, or a refusal toast |
| restock form open | `appRestockAdd`: a new line or + 1; blank, UNIQUE and other shop refused |
| new-piece form waiting for its tag | a BLANK tag is taken; any other: toast `tag_not_blank` '❓ {id} က အသစ် Tag မဟုတ်ပါ။ အသစ် Tag ကို scan လုပ်ပါ။' (:322) |
| expense form open | no scanner is shown |

### 1.3 The sale form `#saleForm` (R2, must)

Opened by a home scan (with its line), the 🛒 tile (empty), or ✅ / 🔢 / 💬 on an item card in the app's chat (3.4).

```
┌ .fhead: 🛒 ရောင်းမယ်                                        [✖️ ပိတ်] ┐
[📋 မသိမ်းရသေးသော စာရင်း ပြန်ပေါ်လာပါပြီ   [🔄 အသစ်]]      (only for a restored draft)
┌ .fscan camera (16:9) · 🔦 · ✖️ ┐     stopped: [➕ Tag ထပ်ဖတ်]
[⌨️ နံပါတ် ရိုက်မယ်]         (≥ 700 px also: [🔢 Tag နံပါတ် ____ ])
🕘 [tile][tile][tile][tile]   one row: own shop, not sold, not in the basket
── basket ───────────────────────────────────────────────────
┌ .fline ──────────────────────────────────────────────────┐
│ 🧣 S1-0002 · လုံချည် ကချင် အပြာ                      [🗑] │
│ [ 18,000 ကျပ် ]         [−]  ၂  [+]             36,000    │
│ ⚠️ လက်ကျန် ၁ ထည်သာ ရှိပါသည်           (only if count > stock) │
└──────────────────────────────────────────────────────────┘
┌ .fline (one of a kind) ──────────────────────────────────┐
│ 👗 S1-0001 · ထမီ ချည်သား အနီ                         [🗑] │
│ [ 25,000 ကျပ် ]         ၁ ထည်တည်း                 25,000    │
└──────────────────────────────────────────────────────────┘
── 👤 ဝယ်သူ ─────────────────────────────────────────────────
[ 🔍 နာမည် ဒါမှမဟုတ် ဖုန်းနံပါတ် ရိုက်ပါ                   ]
(👤 ဒေါ်မြင့် · +95 …) (👤 ဒေါ်ခင်) (✏️ နာမည်အသစ်)              .fchips
── 💰 ဘယ်လိုပေးလဲ? ──────────────────────────────────────────
[💵 ငွေသား | 📲 KBZPay | 📲 WavePay | 🏛 ဘဏ် | 💵+🏦 ခွဲပေး]   .seg, wraps
── 💳 ───────────────────────────────────────────────────────
[✅ အကုန် 83,000 | 💳 မကျေသေး]                               .seg
╞ .fbar  စုစုပေါင်း 83,000 ကျပ်   (part: · ပေးပြီး 30,000 · ကျန် 53,000)
│ [.fmsg]
╘ [✅ သိမ်း]
```

| Field | Control (`data-f`) | Default | Shown when | Labels (line) | Rule |
|---|---|---|---|---|---|
| line | `.fline` per item in scan order (`line:<id>`) | from the scan | always | '{emoji} {id} · {name}' as the tiles show items (app_ui.js:585-588); `sample_mark` ' (နမူနာ)' (:13) | UNIQUE twice refused (`basket_twice`); SKU again = count + 1; one row per item (basket map 3.3 rule 5); at most `CFG.BASKET_MAX_LINES` 10 (`basket_max`) |
| price | `.fnum` (`price:<id>`) | the item's price at the moment the line was added (pinned: what the seller saw is written) | always | amount + ' ကျပ်'; a pending piece shows `btn_pending` '⏳ စျေး မသတ်မှတ်ရသေး' (:48) in warn colour | keypad titled `btn_discount` '💬 စျေးလျှော့' (:22); a changed price shows the old one struck through and sets `priceChanged`; at least 1 |
| count | `.stepper` (`qty-:<id>`, `qty:<id>`, `qty+:<id>`) | 1 | SKU lines | keypad title `ui_keypad_qty` '🔢 အရေအတွက်' (app_i18n.js:33) | 1..`CFG.MAX_SALE_QTY` 999; above stock a warning `ui_stock_over` '⚠️ လက်ကျန် {stock} ထည်သာ ရှိပါသည်' (NEW), never a refusal (the server flags it, core_sync.js:807-809) |
| one of a kind | text | — | UNIQUE lines | `ui_line_one` '၁ ထည်တည်း' (NEW) | count fixed at 1 |
| remove | 🗑 (`remove:<id>`) | — | every line | aria-label `btn_remove_line` '🗑 ဖယ်' (NEW) | no question |
| buyer search | `<input type=search>` (`buyer`) | empty: no buyer | always | section `btn_customer` '👤 ဝယ်သူ' (:140); placeholder `cust_find` '🔍 နာမည် ဒါမှမဟုတ် ဖုန်းနံပါတ် ရိုက်ပါ' (:150) | typing lists `findCustomers` (core_ledger.js:1446-1468; four or more digits search phones) as chips, six at most |
| buyer chips | `.fchips` (`buyer:<customerId>`, `buyer:new`) | `recentCustomers(ports, shop, 3)` (core_ledger.js:1398) + ✏️ | always | `customerLabel` (core_bot.js:1590); `btn_new_customer` '✏️ နာမည်အသစ်' (:45) | a picked buyer replaces the chips by one row '👤 ဒေါ်မြင့် · +95 912 345 678 [✖️]' |
| new buyer | two inputs (`name`, `phone`, `inputmode=tel`) | the typed search text goes to name (letters) or phone (digits; digits are never a name, SPEC-round-5 rev 2) | after ✏️ | `ask_name` '✏️ နာမည် ရိုက်ပေးပါ' (:80); `ask_phone` '📱 {customer} ၏ ဖုန်းနံပါတ် (Viber) ရိုက်ပါ' (:146) with the typed name | a phone a customer already has shows the chip `ui_buyer_known_phone` '📱 ဒီဖုန်းက {customer} ပါ' (NEW) and Save uses that customer (never duplicated); 1-6 digits refused (`ui_phone_short`); the Customers row is written at Save only (`saleResolveBuyer`, core_bot.js:3140-3148) |
| how paid | `.seg` (`pay:CASH`, `pay:<KEY>`, `pay:bank`, `pay:mix`) | 💵 cash | always | section `sale_ask_method` '💰 ဘယ်လိုပေးလဲ?' (:432); `btn_cash` '💵 ငွေသား' (:132); `btn_wallet` '📲 {method}' (:425) for each `payMethodsByKind(ports, shop).wallets` (core_ledger.js:138-147); `btn_bank_transfer` '🏛 ဘဏ်' (:426) when a bank-kind account exists; `btn_split` '💵+🏦 ခွဲပေး' (:376) when any non-cash account exists and the total is at least 2 (as core_bot.js:2618) | the basket's shop's accounts |
| account | `.seg` (`acct:<KEY>`, `acct:add`) | the only one, when there is one | 🏛 or 💵+🏦 chosen | `sale_ask_account` '🏛 ဘယ်အကောင့်လဲ?' (:433) / `sale_ask_split_account` '💵+🏦 ဘယ်အကောင့်နဲ့ ခွဲပေးလဲ?' (:434); `btn_bank` '🏦 {method}' (:131), `btn_wallet`; `btn_add_bank` '➕ ဘဏ်အသစ်' (:385) | 🏛 lists banks, 💵+🏦 every non-cash account; ➕ opens an inline name box (placeholder `add_ask_pm`, :388) with `btn_kind_wallet` '📲 Pay အကောင့်' / `btn_kind_bank` '🏛 ဘဏ်အကောင့်' (:429-430); its ✅ writes the Lists row at once (`addListOptionByLabel(..., {kind})`, core_ledger.js:762, offline) and selects it |
| transfer part | `.fnum` (`transfer`), chip `btn_half` 'တစ်ဝက် {amount}' (:254) | empty | 💵+🏦 with an account | `ui_transfer_part` '💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ?' (NEW); live line `sale_line_mixed` '💰 {cashMethod} {cash} · {method} {bank}' (:440) | 1..paid; equal to paid puts the whole amount on the account (round-5 rule, run_wizard.js:1256) |
| paid now | `.seg` (`paid:full`, `paid:part`) | full | always | `btn_paid_all` '✅ အကုန် {amount}' (:427); `btn_credit` '💳 မကျေသေး' (:41) | — |
| amount now | `.fnum` (`amount`), chips `0` and `btn_half` | empty | part | `btn_paid_now` '💳 ယခု ပေးငွေ' (NEW) | 0..total − 1; mixed: at least the transfer part (`sale_bad_amount`, :445) |
| buyer needed | hint | — | part, no buyer | `sale_need_buyer` 'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်' (:438) | Save refused until a buyer is picked or named |
| promised day | `.seg` (`due:7`, `due:14`, `due:30`, `due:date`, `due:none`) | none chosen | part | `sale_ask_due` '📅 ကျန် {owed} ကျပ် · ဘယ်တော့ ပေးလဲ?' (:436); `btn_days` '{n} ရက်' (:238) for `saleDuePresets(ports).slice(0, 3)` (core_bot.js:2331-2337); `ui_btn_pick_date` '📅 ရက်စွဲ ရွေးပါ' (app_i18n.js:55); `btn_due_unknown` '❓ မသေချာ' (:428) | 📅 opens today's date sheet (`appOpenDateSheet`, app_ui.js:972-988, given a callback) from today to today + 365; the choice shows as `sale_due_set` '📅 ကျန် {owed} · {date}' (:442) or `sale_due_none` '📅 မသေချာ' (:443); Save refused while none is chosen |
| total | `.fbar` line | — | always | `ui_sale_total` 'စုစုပေါင်း {total} ကျပ်' (NEW); part adds ' · ' + `sale_line_paid` 'ပေးပြီး {paid} · ကျန် {owed}' (:441) | `basketTotals` (the screen and the ledger use one function) |
| Save | `.good` (`save`) | disabled while the basket is empty | always | `btn_save` '✅ သိမ်း' | `basketCommit` (3.4): checks, then one write |

**Laptop width (≥ 700 px)**: `.fsplit` makes two columns. Left: camera box, tag text box, recent row, basket. Right:
buyer, how paid, paid now. The bar spans the 900 px column.

**After Save** the home shows the core's sold card (`basketReply`, 3.4):

```
✅ ရောင်းပြီး 🛍 ၃ ခု · 83,000 ကျပ်                      basket_sold (NEW)
S1-0002 · လုံချည် ကချင် အပြာ × ၂ · 36,000 · 📦 ၂          basket_sold_line (NEW), one per line
S1-0005 · ထမီ ဇင်းမယ် အဝါ × ၁ · 22,000 · 📦 ၁
S1-0001 · ထမီ ချည်သား အနီ × ၁ · 25,000 · 📦 ၀
💳 👤 ဒေါ်မြင့် · ပေးပြီး 30,000 · ကျန် 53,000 ကျပ်         credit_done (:99)
📅 ကျန် 53,000 · <date>                                  sale_due_set (:442)
[↩️ မှားသွားတယ်] [🧾 ဘောက်ချာ]                            btn_undo (:27), btn_receipt (:42)
[💰 ငွေလက်ခံ]                                             btn_pay (:37), while owed
```

A one-line basket shows today's sold card unchanged (`saleCardText`, core_bot.js:3194-3217). A buyer holding a free
deposit who still owes gets today's question `credit_use_deposit` '📥 {customer} ၏ စရံ {deposit} ကျပ် ရှိပါသည်။ သုံးမလား?'
(:100) with `btn_use_deposit` '✅ စရံ သုံးမယ်' / `btn_no_deposit` '❌ မသုံးဘူး' (:46-47), exactly saleCommit's tail
(core_bot.js:3177-3183). Undo `U|<group>` mirrors every row (core_ledger.js:992-1017).

### 1.4 The new-piece form `#newForm` (R3, must)

Opened by a blank tag scanned on home, the 🆕 tile, or `openTag` on a blank tag in the app (3.4).

```
┌ .fhead: 🆕 ပစ္စည်းအသစ် · S1-0007                              [✖️ ပိတ်] ┐
(🆕 tile only, until a blank tag is read:)
┌ .fscan camera ┐  📷 Tag အသစ်ကို ဖတ်ပါ   [⌨️ နံပါတ် ရိုက်မယ်]
┌ photo box (4:3) ─────────────────────────────┐
│            [ 📸 ဓာတ်ပုံ ]  (big button)          │   after the shot: the picture + [🔄 ဓာတ်ပုံ ပြန်ရိုက်]
└──────────────────────────────────────────────┘
ပစ္စည်း အမည်
[                                            ]
📸 အမည် မရိုက်ရင် ဓာတ်ပုံကို ကြည့်ပြီး နောက်မှ အမည် ပေးပါမည်     (photo taken, name empty)
🏷 အမျိုးအစား
[👗 ထမီ][🧣 လုံချည်][👚 အင်္ကျီ][🧥 ဝတ်စုံ][🧵 အခြား]              .toggle, one choice
🧵 အရင်း            [ 12,000 ]
💰 ရောင်းဈေး         [ 25,000 ]    (20,000) (25,000) (30,000) (35,000)
[⏳ စျေး မသတ်မှတ်ရသေး]                                           toggle
📈 အမြတ် 13,000 · အရင်းရဲ့ 108%                                 .vid line (or ⚠️ when below cost)
🔢 အရေအတွက်        [−]  ၁  [+]
ℹ️ ၅ ထည် · လက်ကျန်နဲ့ ရောင်းမည့် ပစ္စည်း ဖြစ်ပါမည်                  (count > 1)
[🧵 နမူနာ: မဟုတ်]                                                toggle
╞ .fbar [.fmsg]  ╘ [✅ သိမ်း]
```

| Field | Control (`data-f`) | Default | Shown when | Labels (line) | Rule |
|---|---|---|---|---|---|
| tag | `.fscan` + keypad (`tag`) | the scanned tag | 🆕 tile until a blank tag is read | `ui_tag_scan_new` '📷 Tag အသစ်ကို ဖတ်ပါ' (NEW); title `ui_new_title` '🆕 ပစ္စည်းအသစ် · {id}' (NEW) | BLANK only (`tag_not_blank`); re-read at Save (another phone may have used it) |
| photo | big button (`photo`) | none | always | `ui_btn_photo` '📸 ဓာတ်ပုံ' (app_i18n.js:65); `ui_photo_retake` '🔄 ဓာတ်ပုံ ပြန်ရိုက်' (NEW) | a tap clicks `#photoInput` (index.html:38: the phone's own camera, offline). The file chooser needs a user gesture, so a scan never opens it by itself. Optional: a piece can be saved without a photo |
| name | `<input>` (`name`) | empty | always | `ui_form_name` 'ပစ္စည်း အမည်' (NEW); hint `ui_form_name_later` '📸 အမည် မရိုက်ရင် ဓာတ်ပုံကို ကြည့်ပြီး နောက်မှ အမည် ပေးပါမည်' (NEW) | empty is saved as 'ပစ္စည်း <id>' (the AI renames only that, app_sync.js:390) |
| category | `.toggle` (`cat:<i>`) | none (saved as 'အခြား', the last of `CFG.CATEGORIES`, core_config.js:23) | always | `ui_form_cat` '🏷 အမျိုးအစား' (NEW); '{emoji} {category}' from `CFG.CATEGORY_EMOJI` (core_config.js:24) | changes the price chips |
| cost | `.fnum` (`cost`) | empty (unknown) | always | `btn_item_cost` '🧵 အရင်း' (NEW) | 0 or more, whole kyat; empty = unknown (today's ⏭, core_bot.js:2181) |
| price | `.fnum` (`price`) + four chips (`price:<n>`) | empty | always | `ui_form_price` '💰 ရောင်းဈေး' (NEW); chips `pricePresets(ports, category, shop)` (core_ledger.js:1754) | at least 1, or pending |
| pending | toggle (`pending`) | off | always | `btn_pending` '⏳ စျေး မသတ်မှတ်ရသေး' (:48) | on clears and dims the price; at Save the owner is pinged with `price_ask_owner` '⏳ {id} · {name} · စျေး သတ်မှတ်ပေးပါ' (:193) and the SP buttons (core_bot.js:2193-2200), an outbox notice on the phone (app_ports.js:93-98) |
| profit | `.vid` line | — | price and cost known | `item_lbl_profit` '📈 အမြတ် {profit} · အရင်းရဲ့ {pct}%' (NEW); below cost `item_lbl_loss` '⚠️ ရောင်းဈေးက အရင်းထက် နည်းနေပါသည်' (NEW) | `itemMargin`: pct = round(profit × 100 ÷ cost), none when cost is 0; a loss warns, never refuses |
| count | `.stepper` (`count-`, `count`, `count+`) | 1 | always | `ui_keypad_qty` '🔢 အရေအတွက်' (app_i18n.js:33); hint `ui_form_count_sku` 'ℹ️ {n} ထည် · လက်ကျန်နဲ့ ရောင်းမည့် ပစ္စည်း ဖြစ်ပါမည်' (NEW) | 1..999; above 1 = SKU with that stock |
| sample | toggle (`sample`) | off | always | `btn_sample_off` '🧵 နမူနာ: မဟုတ်' / `btn_sample_on` '🧵 နမူနာ: ဟုတ်' (:49-50) | RESTOCK note 'new sample' (core_bot.js:2187) |
| Save | `.good` (`save`) | — | always | `btn_save` | `newItemCheck`, `commitNewItem`, then the photo job, the owner ping, the item card |

**Laptop width**: `.fsplit` left = tag, photo, name, category; right = cost, price, profit, count, sample.

**After Save** the home shows `item_created` '🆕 မှတ်ပြီးပါပြီ' + ' · S1-0007' (:85, as core_bot.js:2190-2191) and the
new piece's card (`sendItemCard`): a SKU card with `✅ ရောင်း ၁` and 🔢 when the count was above 1, `✅ ရောင်းပြီး` for one
piece, the pending card (`card_pending`, :12) when the price is pending.

### 1.5 The restock form `#restockForm` (R4, should)

```
┌ .fhead: 📦 ကုန်ရောက်                                         [✖️ ပိတ်] ┐
┌ .fscan camera ┐   [⌨️ နံပါတ် ရိုက်မယ်]   🕘 one row of own-shop SKU tiles
┌ .fline ───────────────────────────────────────────────┐
│ 🧣 S2-0003 · လုံချည် ပိုး အနက်                     [🗑] │
│ 📦 လက်ကျန် ၁ → ၆                                        │
│ [−]  ၅  [+]        (၅) (၁၀) (၂၀)                         │
└───────────────────────────────────────────────────────┘
╞ .fbar [.fmsg]  ╘ [✅ သိမ်း]
```

- A line per scanned SKU, count 1; the chips are `CFG.RESTOCK_PRESETS` without 1 (core_config.js:20), labelled with
  `myDigits`; the stock line is `ui_restock_after` '📦 လက်ကျန် {now} → {after}' (NEW, the word of `card`, :10).
- Refused with a toast: a blank tag `basket_blank` (NEW); a UNIQUE `ui_restock_unique` 'ℹ️ {id} က တစ်ထည်တည်း ပစ္စည်းပါ · ကုန်ရောက် မမှတ်နိုင်ပါ'
  (NEW; a UNIQUE has no R| button today, core_bot.js:219-224); the other shop `basket_other_shop`; unknown `tag_not_found`.
  The same SKU again: + 1. One shop per form (the first line's).
- Save: `commitRestockGroup` (ONE group, one RESTOCK row per line, one undo). The reply: one line → today's
  `restock_done` '📦 ကုန်ရောက် {qty} ထည် · လက်ကျန် {stock}' (:53); several → `restock_done_n` '📦 ကုန်ရောက် {n} ခု · {qty} ထည်'
  (NEW) then one `stock_query` line per item; with `undoRow` [↩️ မှားသွားတယ်] (core_bot.js:367-369).

### 1.6 The expense form `#expenseForm` (R4, should)

```
┌ .fhead: 💸 ကုန်ကျ                                            [✖️ ပိတ်] ┐
(owner only) 💸 ဘယ်ဆိုင် အတွက်လဲ?   [ဆိုင် ၁ | ဆိုင် ၂]                  .seg
💸 ဘာ ကုန်ကျစရိတ်လဲ?
[🧵 အထည်ဖိုး][🪡 ချည်ဖိုး][✂️ လက်ခ][🚕 ကားခ][📱 ဖုန်းဘေလ်]...[➕ အမျိုးအစားအသစ်]   .toggle, wraps
💸 {cat} · ဘယ်လောက်လဲ?      [ 20,000 ]    (5,000) (10,000) (20,000) (30,000)
💰 ဘယ်လိုပေးလဲ?             [💵 ငွေသား | 📲 KBZPay | 📲 WavePay | 🏦 …]
📝 မှတ်ချက်                [ textarea: 📝 မှတ်ချက် ရိုက်ပါ (ဥပမာ နေ့လယ်စာ ၃ ယောက်) ]
╞ .fbar [.fmsg]  ╘ [✅ သိမ်း]
```

| Field | Default | Labels (line) | Rule |
|---|---|---|---|
| shop (owner) | the owner's shop | `exp_ask_shop` '💸 ဘယ်ဆိုင် အတွက်လဲ?' (:161); `shopName` | sellers: their shop, no control |
| category (`cat:<key>`) | none | `exp_ask_cat` '💸 ဘာ ကုန်ကျစရိတ်လဲ?' (:162); `expenseCategories(ports, shop)` with `expenseEmoji` (core_ledger.js:271-294); `btn_add_cat` '➕ အမျိုးအစားအသစ်' (:386) → inline box, placeholder `add_ask_ec` (:389), written at once (`addListOptionByLabel(ports, 'expense_category', label, staff)`) | required |
| amount (`amount`) | empty | `exp_ask_amount` '💸 {cat} · ဘယ်လောက်လဲ?' (:163); chips `expensePresets(ports, category)` (core_ledger.js:316) | at least 1 (as core_bot.js:2005-2011) |
| how paid (`pay:<KEY>`) | 💵 | `sale_ask_method` (:432); `btn_cash`, `btn_wallet`, `btn_bank` for `payMethods(ports, shop)` (core_ledger.js:117) | `methodKnown` |
| note (`note`) | empty | `btn_note` '📝 မှတ်ချက်' (:166); placeholder `exp_ask_note` (:165) | at most 100 characters |

Save: `commitExpense` with the note in the same row (the chat flow adds it later as a rewrite, core_bot.js:2050-2062).
Reply: `expense_done` '💸 ကုန်ကျစရိတ် {amount} ကျပ် · {cat}{note} · {method} မှတ်ပြီးပါပြီ' (:55) with `replyKeyboard`
(undo, note, method rows, core_bot.js:354-365).

### 1.7 Payment, deposit, return (R4 could: not forms this round)

They stay where they are and work in the app as today: 💰 ငွေလက်ခံ and 📥 စရံ in ☰ (core_bot.js:133, `M|pay`, `M|dep`),
the 💰 button on a sold card or a customer card (`PY|`, `PL|`), ↩️ ပြန်အမ်း on the item card (`T|`, :528-535). The basket
works with all of them: they read group owed (basket map 2.14).

### 1.8 Tap counts (phone, form mode; a "scan" is one camera read)

| Case | App form | Telegram review card | Round 5 (Telegram, steps) | quick |
|---|---|---|---|---|
| one piece, cash, full | scan + Save = **1 tap** | scan, START, ✅, ✅ သိမ်း | scan, START, ✅, 🚫, 💵, ✅ အကုန် | scan, START, ✅ |
| three pieces, cash, full | 3 scans + Save | 3 × (scan, START) + ✅ + Save | not possible | three sales |
| SKU × 2 | scan, +, Save (2) | + ✏️ line, ၂ | + grid | 🔢, ၂ |
| bargained price 15,000 | scan, price, 1 5 000 OK, Save (5) | + ✏️ line, 💬, typed | + 💬, typed | 💬, typed |
| mixed: KBZ 5,000 + cash | scan, 💵+🏦, (KBZ), transfer, 5 000 OK, Save (6-7) | + 💰, 💵+🏦, KBZ, typed, card | 7+ screens | ✅, 💵+🏦, KBZ, typed |
| part 20,000, recent buyer, 14 days | scan, 💳, amount, 2 0 000 OK, buyer chip, ၁၄, Save (9) | + 👤, buyer, 💳, ✏️, typed, 📅, ၁၄ | 9 screens | ✅, 💳, … |
| new piece, one, preset price, typed cost, AI name later | scan, 📸 (+2 in the camera app), price chip, cost, 1 2 000 OK, Save (9) | scan, START, photo, price chip, 🧵, typed, ✅ သိမ်း | price, cost | price, cost |
| new piece × 10 | + count, 1 0 OK (+3) | + 🔢, typed | not possible | not possible |
| restock 5 of a SKU | 📦, scan, (၅), Save (3) | R, +၅ (today) | — | R, +၅ |
| expense 20,000 fabric cash | 💸, 🧵 အထည်ဖိုး, (20,000), Save (4) | today's EC, EA, EM | — | same |

### 1.9 Errors as the seller sees them

| Code (helper) | Text (line) | Where |
|---|---|---|
| `missing` (scan) | `tag_not_found` (:8) | toast |
| `blank` (sale/restock scan) | `basket_blank` 'ℹ️ {id} က Tag အသစ်ပါ · ပစ္စည်းအသစ် အရင် မှတ်ပါ' (NEW) | toast |
| `other_shop` | `basket_other_shop` '⚠️ {id} · {shop} ၏ ပစ္စည်းပါ · မထည့်ပါ' (NEW) | toast |
| `sold` (scan) / `gone` (Save) | `sale_gone` '⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ' (:444), prefixed '{id} · ' | toast / the line in red, `.fmsg`; the seller removes it (the total never changes silently) |
| `twice` | `basket_twice` 'ℹ️ {id} ထည့်ပြီးသားပါ' (NEW) | toast |
| `max` | `basket_max` '❗ တစ်ခါ ရောင်းရင် {max} ခုအထိသာ ထည့်နိုင်ပါသည်' (NEW) | toast |
| `empty` | `scan_first` '📷 ပစ္စည်း Tag ကို အရင် scan လုပ်ပေးပါ။' (:74) | `.fmsg` |
| `price` (line) | `ask_sale_price` '💬 ဘယ်စျေးနဲ့ ရောင်းလဲ? ဂဏန်း ရိုက်ပါ (ဥပမာ 18000)' (:82) | the line's price box, `.fmsg` |
| `qty` | `bad_qty` '❓ ၁ မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ' (:20) | the line |
| `buyer` | `sale_need_buyer` (:438) | buyer section |
| `phone` | `ui_phone_short` '📱 ဖုန်းနံပါတ် တိုလွန်းပါသည် (09 နဲ့ စပါ)' (NEW) | phone input |
| `transfer`, `paid` | `sale_bad_amount` '❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ' (:445) | the amount |
| `due` | `sale_ask_due` (:436) | promised-day row |
| `method` (an account retired by a pull meanwhile) | the control falls back to 💵 and toasts `expired` (:71) | how paid |
| `tag` / `not_blank` (new piece) | `ui_tag_scan_new` / `tag_not_blank` (:322) | tag row |
| new piece `price` | `ask_price` '💰 စျေး ဘယ်လောက်လဲ?' (:77) | price |
| new piece `count` | `bad_qty` | count |
| restock `unique` | `ui_restock_unique` (NEW) | toast |
| expense `category` / `amount` | `exp_ask_cat` (:162) / `ask_number` '✏️ ဂဏန်း ရိုက်ပေးပါ (ဥပမာ 25000)' (:79) | the field |

### 1.10 The Telegram sale review card (R5, the backup)

Telegram cannot draw a form, so the same sale is ONE message that reads like the receipt it becomes, with defaults
filled in, buttons that open edit screens, and one Save. Entry (form mode, no `ports.ui`): `✅ ရောင်း ၁` / `✅ ရောင်းပြီး`
(`S|id|1`), 🔢 (`Q|id`) or 💬 (`D|id`) on the item card edits that card (a photo: caption-aware, `isCaption`) into:

```
🛒 ရောင်းမည့် စာရင်း · ၂ ခု                                     basket_title (NEW)
1. 🧣 S1-0002 · လုံချည် ကချင် အပြာ × ၂ · 36,000                  ord_line '{n}. {desc} × {qty} · {amount}' (:231)
2. 👗 S1-0001 · ထမီ ချည်သား အနီ × ၁ · 25,000
စုစုပေါင်း 61,000                                               ord_total 'စုစုပေါင်း {total}' (:233)
🚫 နာမည် မရှိ                                                    btn_no_name (:424), or customerLabel / '👤 name · phone'
💰 ငွေသား                                                       sale_line_method (:439) / sale_line_mixed (:440)
ပေးပြီး 61,000 · ကျန် 0                                          sale_line_paid (:441)
(owed:) 📅 ကျန် 25,000 · <date> | 📅 မသေချာ | 📅 ကျန် … · ဘယ်တော့ ပေးလဲ?   sale_due_set / sale_due_none / sale_ask_due
(a refusal, last line:) ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်
[✏️ 1. S1-0002] [✏️ 2. S1-0001]          btn_line '✏️ {n}. {id}' (NEW), two per row
[➕ ပစ္စည်း ထပ်ထည့်]                       btn_add_item (NEW)
[👤 ဝယ်သူ] [💰 ဘယ်လိုပေးလဲ?]              btn_customer (:140), sale_ask_method (:432)
[💳 မကျေသေး]   (owed: [💳 ယခု ပေးငွေ] [📅 ပေးမည့်ရက်])   btn_credit (:41); btn_paid_now, btn_due (NEW)
[✅ သိမ်း] [✖️ မလုပ်တော့]                 btn_save (:344), btn_cancel (:32)
```

A bargained line adds ' · 💬' after its name; a pending-price line shows `btn_pending` instead of its amount. With
`CFG.BASKET_MAX_LINES` 10 the caption stays well under Telegram's 1024 characters (basket map 2.13).

| Sub-screen (step) | Opened by | Reuses (core_bot.js) | Text / buttons | Back |
|---|---|---|---|---|
| line (`line`) | `SS|a|l|<i>` | `saleQtyGrid` :2534 (ADAPT) | `ord_line` of the line; SKU: `ask_qty` '🔢 ဘယ်နှစ်ထည် ရောင်းလဲ?' (:18) with ၁..၉ (`SS|a|q|n`), `btn_type_qty` '✏️ ရိုက်မယ်' (:17, `SS|a|q|other`); every line: `btn_discount` '💬 စျေးလျှော့' (`SS|a|pr`, typed price, `sale_price`), `btn_remove_line` '🗑 ဖယ်' (`SS|a|r`) | `btn_back` '⏮ နောက်ပြန်' (:335) `SS|a|c` |
| add (`add`) | `SS|a|n` | NEW | `basket_add_ask` '➕ နောက်ပစ္စည်း Tag ကို scan လုပ်ပါ၊ ဒါမှမဟုတ် အောက်က ပစ္စည်းကို နှိပ်ပါ' (NEW); up to four `recentItems(ports, shop, 4)` not in the basket as '{emoji} {id} · {name}' (`SS|a|i|<id>`) | ⏮ |
| buyer (`buyer`, `name`, `phone`) | `SS|a|o|buyer` | `saleScreenBuyer` :2572, `saleScreenLookalikes` :2591, `saleScreenName` :2601, `saleScreenPhone` :2606, the answers :2827-2894 (REUSE/ADAPT: exits return to the card) | as round 5; 🚫 hidden while a part payment needs a buyer | ⏮ |
| how paid (`method`, `account`, `bank`, `kind`) | `SS|a|o|method` | `saleScreenMethod` :2615, `saleScreenAccount` :2646, `saleScreenBankPart` :2667, `saleScreenKind` :2707, ➕ `LA|pm|SSA|<a>` (askAddOption :1489-1500) | as round 5 (six answers, wallets row, pages) | ⏮ (from account, kind and the transfer part: back to how paid) |
| paid now (`paid`) | `SS|a|o|paid` | `saleScreenPaid` :2676 (ADAPT: `✅ အကုန် {total}` is `SS|a|p|all`, sets full and returns; it no longer commits) | `sale_ask_paid` (:435); [✅ အကုန်] [0 · တစ်ဝက် · ✏️ အခြား] | ⏮ |
| promised day (`due`, `due_text`) | `SS|a|o|due` (only while owed) | `saleScreenDue` :2694, `saleScreenDueText` :2702 | as round 5 | ⏮ |

- **Add by scan**: while the card is live, a scanned (`/start S1-0005`) or typed (`tagIdFromText`, core_bot.js:704-705)
  tag is added by `basketScan` instead of clearing the state (today's `openTag` clears it, :125-127). The card is sent
  again as a NEW message (the actionable screen is always the last bot message, SPEC-round-5 0) and the old message is
  edited to `basket_moved` '⬇️ အောက်မှာ ဆက်လုပ်ပါ' (NEW) with no buttons. Refusals (twice, other shop, blank, sold,
  max) are a last line on that new card; the basket is kept.
- **Save** (`SC|<a>|ok`, in `MUTATING_ACTIONS`): `basketCommit`; a refusal redraws the card with the reason as its last
  line and deletes that tap's guard key (else a second Save on the same message within 120 s would be swallowed,
  core_bot.js:446-449). Accepted: today's tail (core_bot.js:3173-3186): `setLastItem`, `setLastGroup`, `clearState`,
  `markCommittedCard`, the sold card (1.3) or the deposit question, edited in place.
- **✖️** (`SS|a|z`, `saleCancel` :2790, REUSE): the message becomes the anchor's item card, nothing written. A sold card
  is never edited (`saleSoldCard` :2383, which keeps working because `basket_sold` starts with '✅ ရောင်းပြီး').
- **Stale taps**: `saleGuard` rules (a)-(b) unchanged (core_bot.js:2359-2377); rule (c) compares the letter's step with
  `state.step` (`BASKET_STEP_OF`, 3.4).

### 1.11 The Telegram new-piece review card (R5)

Blank tag → `new_tag` '🆕 Tag အသစ်ပါ ({id})။ ပစ္စည်းရဲ့ ဓာတ်ပုံ ပို့ပေးပါ။' (:9, unchanged) → the photo → `handlePhoto`
builds the draft as today (AI name and category, core_bot.js:2111-2124) → in form mode the card instead of the price
screen:

```
📸 ထမီ ပိုးထည် အစိမ်း · ထမီ                photo_seen '📸 {name} · {category}' (:83)
💰 ရောင်းဈေး 25,000                        item_lbl_price (NEW)  | ⏳ စျေး မသတ်မှတ်ရသေး (btn_pending)
🧵 အရင်း 12,000                            item_lbl_cost (NEW)   | (unknown: the line is left out)
📈 အမြတ် 13,000 · အရင်းရဲ့ 108%              item_lbl_profit (NEW) | item_lbl_loss (NEW)
🔢 ၁ ထည်                                   item_lbl_count (NEW)
[20,000][25,000][30,000][35,000]           P|id|<n> (today's presets)
[✏️ အခြား] [⏳ စျေး မသတ်မှတ်ရသေး]            P|id|other, P|id|pending
[🧵 အရင်း] [✏️ နာမည်]                       C|id|other, NN|id      (btn_item_cost, btn_item_name NEW)
[👗 ထမီ] [🧵 နမူနာ: မဟုတ်]                   NK|id (category screen), PS|id
[➖] [🔢 ၁ ထည်] [➕]                         NQ|id|-, NQ|id|other, NQ|id|+
[✅ သိမ်း] [✖️ မလုပ်တော့]                    NS|id, Z
```

Every answer sets its field and redraws the card (typed answers: as a new message); the category screen lists the five
`CFG.CATEGORIES` one per row (`NK|id|<i>`) with ⏮. Save `NS|id` (`MUTATING_ACTIONS`): `newItemCheck`, `commitNewItem`,
`item_created`, the owner ping when pending, the item card (as core_bot.js:2190-2194). A caption number of 500 or more
still sets the price (:2125, :2129).

### 1.12 `quick` (the owner's fallback)

Telegram: today's one-tap card with the corrective rows (`afterSaleKeyboard`, core_bot.js:283-310) and today's photo
steps (price, then cost). App: today's home, stepper and chat cards. Owner's switch: Settings `sale_flow` (the Sheet),
or per phone the pref `setting:sale_flow` (app_store.js:341-344, run_app.js step 36).

### 1.13 What the owner sees

- **21:00 summary** (`buildDailySummary`, core_ledger.js:1617-1682): unchanged sums; a basket counts its pieces and
  revenue per row; an overdue basket names its buyer (DueDay is on every SALE row, 2.2).
- **Credits tab, credit reports, the Telegram owed report**: one row per basket, Item '🛍 ၃ ခု · လုံချည် ကချင် အပြာ, ထမီ ဇင်းမယ် အဝါ, …'
  (`basket_name`, NEW).
- **Ledger tab**: N SALE rows with one GroupID and one ReceiptNo; a mixed basket's PAYMENT last.
- **Items tab**: a counted new piece is Type SKU with its stock; app-registered pieces get the Drive photo URL after the
  AI job (section 5). Telegram still shows such a piece as a text card (photoFileId is a phone media id, core_sync.js:719-739;
  unchanged, section 10).
- **Pings**: `price_ask_owner` with SP buttons for a pending piece from any phone; `ping_stock_negative` on a basket line
  whose V| voids the whole basket (core_sync.js:634-637; stated, not changed).
- **Lists tab**: accounts and expense categories a seller added on the fly appear as today's ➕ rows do.
- **The owner's own sales** use the same app forms (both shops) or the review card; reports, PDFs, enrolment codes and
  the 21:00 post stay on Telegram and the laptop.

---

## 2. Ledger and data

### 2.1 Basket rows (`commitBasket`)

All rows share one `when` (one clock read, map-core-commits 6a), one GroupID (the first row's TxID), the buyer
(`customerId`) on every row, DueDay on every SALE row while the group owes (basket map 3.3 rule 1), all SALE rows in
line order then at most one PAYMENT (rule 3), and on a phone the same ReceiptNo on every SALE row (rule 4).

(a) S1-0002 × 2 @ 18,000, S1-0005 × 1 @ 22,000, S1-0001 × 1 @ 25,000; total 83,000; 30,000 now in cash; ဒေါ်မြင့်; 14 days:

| # | Type | Item | Qty | Amount | Cash | Method | Note | DueDay | Customer |
|---|---|---|---|---|---|---|---|---|---|
| 1 | SALE | S1-0002 | −2 | 36,000 | 30,000 | CASH | credit | D+14 | C-0001 |
| 2 | SALE | S1-0005 | −1 | 22,000 | 0 | '' | credit | D+14 | C-0001 |
| 3 | SALE | S1-0001 | −1 | 25,000 | 0 | '' | credit | D+14 | C-0001 |

(b) S1-0002 + S1-0003 (18,000 + 12,000), paid in full, KBZ 10,000 + cash 20,000 (`twoRows`): SALE 18,000 cash 18,000
CASH split; SALE 12,000 cash 2,000 CASH split; PAYMENT 10,000 cash 10,000 KBZ, RefGroupID = group, ItemID S1-0002,
note split, no DueDay.

(c) the same, 15,000 now of which KBZ 10,000 (cash part 5,000): SALE 18,000 cash 5,000 CASH split D; SALE 12,000 cash 0
'' split D; PAYMENT 10,000 KBZ split; owed 15,000.

(d) One line: exactly `commitSaleGroup`'s rows today (the seven outcomes, run_wizard.js:525-547).

Per-line `costAtSale` = the item's cost; `unitPrice` = the line's (pinned) price; a bargained line's note is `price`
only when no group note applies (rule 6, as core_ledger.js:836). Source `BUTTON` (the app's sales are BUTTON today).

### 2.2 The allocation rule (R7)

`basketAllocate(amounts, A)`: `cash_i = min(amount_i, A − Σ cash_<i)` in line order, with `A = twoRows ? cashPart :
paid` (the basket map 3.2, "fill in line order"). Every row keeps 0 ≤ Cash ≤ Amount; Σ = A; a full payment gives every
row its own amount; zero-cash rows store Method '' (skipped by `groupMethods`, core_ledger.js:1191). Readers that show a
per-line paid figure (the customer card's line, the statement, the day report) read the rows; the group readers sum.

### 2.3 New piece (`commitNewItem`)

`updateItem(id, {name, category, type: count > 1 ? 'SKU' : 'UNIQUE', price ('' pending), cost ('' unknown), sample,
photoUrl, photoFileId, createdAt, createdBy})` (the fields of core_bot.js:2183-2186), then ONE RESTOCK `{qty: count,
note: sample ? 'new sample' : 'new item', source: PHOTO}`. On the phone the outbox gets `item`, then `group`, then the
owner `notice`; the AI job (media record, `status: 'queued'`, `itemId`) is queued in the same commit.

### 2.4 Restock group and expense

`commitRestockGroup`: one RESTOCK row per line (`qty +n`, amount and cash 0), one group, one `when`. Expense: one EXPENSE
row as today, `note` set directly.

### 2.5 Tabs, settings, cache, outbox

- **Items**: no new column; `type` is a synced field (core_sync.js:69). **Customers**: a new buyer at Save
  (`saleResolveBuyer`). **Lists**: ➕ accounts and categories as today. **Ledger**: no new column.
- **Settings** `sale_flow`: `form` (setupSheet seed) | `quick`; a typed value is kept (run_gas.js:1567). The Key cell's
  note `settings_note_sale_flow` gets the text 'form = တစ်မျက်နှာတည်း ဖြည့်ပြီး သိမ်း · quick = ခလုတ်တစ်ချက် ရောင်း' (changed).
- **Cache** (phone): `saledraft:<staffId>`, `newdraft:<itemId>`, `rsdraft:<staffId>`, `expdraft:<staffId>` (1.0).
  Telegram: the card lives in `st:<uid>` (TTL `STATE_TTL_SEC` 1800, core_config.js:11).
- **Outbox push order** is by kind (customer, item, list, group, measurement, notice, error; core_sync.js:75), so a new
  buyer, a new piece and an account made inside a sale reach the server before the group that uses them.

### 2.6 CFG

`CFG.SALE_FLOW = { FORM: 'form', QUICK: 'quick' }` (replaces `STEPS`, core_config.js:111); `CFG.BASKET_MAX_LINES: 10`
(well under `SYNC.PUSH_MAX_ROWS` 200, core_sync.js:43, and the caption limit). Nothing else.

---

## 3. Core functions

Every name below was grepped over apps-script/, app/, poc/, tools/ (dist excluded) and is free. ES5, one global scope,
no new apps-script file; core_ledger.js calls nothing of core_bot.js (core_ledger.js:25-26).

### 3.1 core_config.js

- `saleFlow(ports)` (:207-210): `'quick'` for the word quick in any case, else `'form'`; the default `CFG.SALE_FLOW.FORM`.

### 3.2 core_ledger.js

```
basketAllocate(amounts, cash) -> [cash_i]                                                        // pure (2.2)
basketTotals(lines, pay) -> {amounts, total, paid, bankPart, cashPart, owed, twoRows, payKey, rowCash, rowMethod}   // pure
    lines = [{qty, unitPrice}], pay = {paid (null = full), method, mixed, bankPart}; commitSaleGroup's derivations
    (core_ledger.js:826-837) applied to the sum, then basketAllocate.
basketAddItem(ports, staff, draft, itemId) -> {ok, draft, index, bumped} | {ok: false, reason, item}
    reasons: 'missing' | 'blank' | 'other_shop' | 'sold' | 'twice' | 'max'. Reads only. The basket's shop is the first
    line's; a seller's first line must be the seller's shop; later lines must match the basket's shop. A SKU already in:
    qty + 1 (cap MAX_SALE_QTY). A pending-price item is accepted with unitPrice null. Else unitPrice = item.price.
basketCheck(ports, staff, draft, now) -> {ok: true} | {ok: false, problems: [{code, index}]}
    codes: 'empty', 'missing', 'gone', 'price', 'qty', 'buyer', 'phone', 'method', 'transfer', 'paid', 'due', 'other_shop'
    (re-reads every item; the bounds of saleNumber/salePaidPick/saleDuePick, core_bot.js:2936-3025, in one place).
saleDueKey(today, choice) -> 'yyyy-mm-dd' | '' | null                                              // pure
    choice: whole days 0..SALE_DUE_MAX_DAYS, a typed or yyyy-mm-dd date (parseDayText with noRoll, today..+365), 'none'.
commitBasket(ports, p) -> {groupId, txs, sales, payment, owed, total}
    p = {lines: [{item, qty, unitPrice, priceChanged}], paid, method, bankPart, mixed, customerId, dueDay, note,
         staff, source, transcript, updateId, when}; one when, rows of 2.1, one writeGroup. Clamps like commitSaleGroup.
commitSaleGroup(ports, p) -> commitBasket with one line, returning {groupId, txs, sale: sales[0], payment, owed}
itemMargin(price, cost) -> {profit, pct} | null                                                  // pure, pct null when cost 0
newItemCheck(input) -> {ok} | {ok: false, code}    codes 'tag', 'price', 'cost', 'count'          // pure
commitNewItem(ports, p) -> {ok: true, item, groupId, pending} | {ok: false, reason}
    p = {itemId, name, category, price, cost, count, sample, photoUrl, photoFileId, staff, source, updateId, when};
    reasons 'missing' | 'not_blank' | 'count'; empty name -> 'ပစ္စည်း ' + id; unknown category -> the last one;
    price '' or a number >= 0 (0 keeps today's "reads as pending" rule, core_bot.js:181-183); pending = price '' or <= 0.
commitRestockGroup(ports, p) -> {groupId, txs} | throws on no lines or a qty outside 1..MAX_SALE_QTY
    p = {lines: [{item, qty}], note, staff, source, updateId, when}
```

Changed: `openCredits` item name (:1253-1256): a group with more than one live SALE row that is not an order gets
`basket_name` with the first three names joined by ', ' (cut at 60 characters). `saleGroupInfo` (:1170): `dueDay` =
the first non-blank DueDay among the live rows (hardening, basket map 3.3 rule 1).

### 3.3 core_report.js

`describeGroup(ports, rows)` NEW: for live rows of one group with more than one SALE row: 'ရောင်း ' + `basket_count`
'🛍 {n} ခု' (NEW) + ' · 👤 {customer}' + ' · {total} ကျပ်'; more than one RESTOCK row: 'ကုန်ရောက် ' + `basket_count` + ' · {qty} ထည်';
else `describeRow(ports, rows[0])` (:91-99). Used by the app's pending lines.

### 3.4 core_bot.js

**Hooks into the app (R1).** `formsInApp(ports)` = `saleFlow(ports) === 'form' && !!(ports.ui && ports.ui.openForm)`
(the `measureFormEnabled` pattern, :4183). When true:

| Where | Today | Form mode in the app |
|---|---|---|
| `S|id|n` (:462-470) | commitSale | `ports.ui.openForm('sale', {itemId, qty})`, nothing written |
| `Q|id`, `QN|id` (:472-491) | grid / typed | `openForm('sale', {itemId})` |
| `D|id` (:493-506) | price prompt | `openForm('sale', {itemId, price: true})` (the line's price keypad opens) |
| `R|id` (:513-517) | presets | `openForm('restock', {itemId})` |
| `M|exp` (menuAction :641) | chat flow | `openForm('expense', {})` |
| `openTag` blank (:122-125) | new_item state | `openForm('new', {itemId})` |

`S` stays exempt from the tap guard while it writes nothing (:446: `=== 'form'`).

**The review card (Telegram: form mode, no `ports.ui.openForm`).** State `st:<uid>`:
`{kind: 'sale', step: 'card' | 'line' | 'add' | 'buyer' | 'name' | 'phone' | 'method' | 'account' | 'bank' | 'paid' |
'due' | 'due_text' | 'kind', item: <anchor id>, msgId, line: <index>, acct, draft: {shop, lines: [{id, qty, unitPrice,
priceChanged}], customerId, newName, newPhone, needBuyer, method, mixed, bankPart, paid, dueDay, dueChosen, addLabel,
addedKey}}`. The typed prompts keep their wrappers (`sale_step`, `sale_qty`, `sale_price` in `saved`; ➕ resume `SSA`),
so `saleStateOf` (:2340-2347) reads through them unchanged.

| Callback | Letter → step needed | Meaning | Bytes (anchor S1-0002) |
|---|---|---|---|
| `SS|a|c` | any | back to the card | 12 |
| `SS|a|l|<i>` | card | open line i | 14 |
| `SS|a|n` | card | the add screen | 12 |
| `SS|a|i|<id>` | add | add that recent item | 20 |
| `SS|a|o|<step>` | card | open buyer / method / paid / due | 19 (method) |
| `SS|a|q|<n|other>` | line | the line's count | 18 |
| `SS|a|pr` | line | the line's typed price | 13 |
| `SS|a|r` | line | remove the line | 12 |
| `SS|a|b|…`, `ph|skip`, `m|…`, `a|…`, `x|half`, `p|…`, `d|…`, `k|…` | as round 5 (:2307) | the round-5 answers; `p|all` NEW | ≤ 27 with a 12-byte key |
| `SS|a|z` | any | cancel into the item card | 12 |
| `SC|a|ok` | card | Save | 13 |
| `LA|pm|SSA|a` | method, account | ➕ an account | 17 |
| `NQ|id|-`, `NQ|id|+`, `NQ|id|other` | new_item | count | 12 / 16 |
| `NN|id`, `NK|id`, `NK|id|<i>`, `NS|id` | new_item | name, category, save | 10-12 |

`NQ`, `NN`, `NK`, `NS` join `ITEM_ACTIONS` (slot 1 is the blank tag); `NS` joins `MUTATING_ACTIONS`.

Functions:

```
startBasket(ctx, item, qty, opts)          S|/Q|/D| in form mode; sale_gone at once for a sold UNIQUE (as startGuidedSale
                                           :2393-2406); opts.price opens the line's price prompt, opts.grid its count.
basketScan(chatId, uid, staff, updateId, ports, live, item)     openTag (and a typed id) with a live card: add, resend.
basketCardText(ports, state) / basketCardKeyboard(ports, state)  1.10.
basketScreen(ports, staff, state, opts) -> {text, kb, await}    'card' or the open sub-screen (replaces saleScreenFor).
basketCallback(ctx, parts, item, message)                       replaces saleCallback (:2723-2748), BASKET_STEP_OF.
basketCommit(ports, staff, uid, draft, opts) -> {ok, r, customer, addedKey} | {ok: false, problems}
                                           basketCheck, saleResolveBuyer (extended: a new phone that matches a customer
                                           is that customer), commitBasket, setLastItem (first line), setLastGroup.
                                           Shared by the card's Save and the app form.
basketReply(ports, groupId, customer, addedKey) -> {text, kb}    the sold card or the deposit question (saleCommit's tail).
basketSave(ctx, item, message)             SC|a|ok: basketCommit, then clearState, markCommittedCard, editOrSend.
newItemCardText(ports, state) / newItemCardKeyboard(ports, state, staff) / newItemSave(chatId, msgId, uid, itemId,
  staff, updateId, ports) / newItemCallback(ctx, parts, item)   1.11; newItemPrice, newItemCost, toggleSample
                                           (:2145-2195) set the field and redraw the card in form mode, else as today;
                                           newItemCost's write becomes a commitNewItem call (count 1: the same fields).
```

Verdicts on the round-5 code (map-core-commits 7.3): **REUSE** `saleCtx`, `saleShownId`, `saleDuePresets`,
`saleSoldCard`, `saleRedraw` (drawing `basketScreen`), the buyer, method, account, transfer, due and kind screens,
`saleCancel`, `saleResolveBuyer`, `saleCardKeyboard`, `saleKindPick`, `saleAddNamed`, `saleAccountResume`. **ADAPT**
`saleStateOf`, `saleTotal` (→ `basketTotals`), `saleGuard` (rule c), `saleHeader` (→ `basketCardText`), `saleBackRow`
(→ [⏮ `SS|a|c`]), `saleQtyGrid`, `saleScreenPaid`, every answer handler (exit = the card), `saleText`,
`saleIntentClashes` (any line), `saleResend`, `saleCardText` (basket branch), `applyAwaitedNumber` `sale_price` /
`sale_qty` / `sale_step` (:771-815: the open line or the open screen), `handleIntent`'s routing (:843-849, :904-918).
**DEAD, removed with their checks**: `saleGo`, `state.hist`, `saleNext`, `saleBuyerScreen`, `saleBack`,
`SALE_BACK_CLEARS`, `saleScreenSummary`, `saleScreenFor`'s summary, `startGuidedSale`, `saleCallback`, `saleCommit`
(its tail lives in `basketReply`/`basketSave`), the `steps` branches of `Q`/`QN`/`D` and their `applyAwaitedNumber`
twins, `SALE_STEP_OF`'s `back`. `enrolledInApp`/`sendAppCard` (:4470-4480) were dead before round 6 and stay untouched.

**Readers in core_bot.js** (section 4): `saleCardText`, the `U|`/`V|` replies (:541-560), `cardText`'s buyer line
(:185-207), `customerCard` (:1681-1702).

### 3.5 Messages

core_messages.js, a "round 6" block (all NEW, drafts):

| Key | Text | Use |
|---|---|---|
| `basket_title` | '🛒 ရောင်းမည့် စာရင်း · {n} ခု' | card head |
| `basket_add_ask` | '➕ နောက်ပစ္စည်း Tag ကို scan လုပ်ပါ၊ ဒါမှမဟုတ် အောက်က ပစ္စည်းကို နှိပ်ပါ' | add screen |
| `basket_moved` | '⬇️ အောက်မှာ ဆက်လုပ်ပါ' | the old card after a scan |
| `basket_twice` | 'ℹ️ {id} ထည့်ပြီးသားပါ' | refusal |
| `basket_other_shop` | '⚠️ {id} · {shop} ၏ ပစ္စည်းပါ · မထည့်ပါ' | refusal |
| `basket_blank` | 'ℹ️ {id} က Tag အသစ်ပါ · ပစ္စည်းအသစ် အရင် မှတ်ပါ' | refusal |
| `basket_max` | '❗ တစ်ခါ ရောင်းရင် {max} ခုအထိသာ ထည့်နိုင်ပါသည်' | refusal |
| `basket_sold` | '✅ ရောင်းပြီး 🛍 {n} ခု · {amount} ကျပ်' | sold card (keeps the `sold_done` prefix) |
| `basket_sold_line` | '{id} · {name} × {qty} · {amount} · 📦 {stock}' | sold card |
| `basket_name` | '🛍 {n} ခု · {names}' | Credits, reports |
| `basket_count` | '🛍 {n} ခု' | customer line, pending line |
| `card_buyer_basket` | '👤 {customer} · 🛍 {n} ခု · ပေးပြီး {paid} · {method}' | item card |
| `btn_add_item` | '➕ ပစ္စည်း ထပ်ထည့်' | card |
| `btn_line` | '✏️ {n}. {id}' | card |
| `btn_remove_line` | '🗑 ဖယ်' | line screen, form |
| `btn_paid_now` | '💳 ယခု ပေးငွေ' | card, form |
| `btn_due` | '📅 ပေးမည့်ရက်' | card |
| `item_lbl_price` | '💰 ရောင်းဈေး {price}' | new-piece card |
| `item_lbl_cost` | '🧵 အရင်း {cost}' | new-piece card |
| `item_lbl_profit` | '📈 အမြတ် {profit} · အရင်းရဲ့ {pct}%' | card, form |
| `item_lbl_loss` | '⚠️ ရောင်းဈေးက အရင်းထက် နည်းနေပါသည်' | card, form |
| `item_lbl_count` | '🔢 {n} ထည်' | card, count button |
| `btn_item_name` | '✏️ နာမည်' | card |
| `btn_item_cost` | '🧵 အရင်း' | card, form label |
| `restock_done_n` | '📦 ကုန်ရောက် {n} ခု · {qty} ထည်' | restock reply |

Changed text: `settings_note_sale_flow` (:448) → 'form = တစ်မျက်နှာတည်း ဖြည့်ပြီး သိမ်း · quick = ခလုတ်တစ်ချက် ရောင်း'.
No new button text contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ, and none starts with '🏦 ' (the round-5 rule).

app_i18n.js, a "round 6" block (all NEW): `ui_home_sell` '🛒 ရောင်းမယ်', `ui_home_new` '🆕 ပစ္စည်းအသစ်',
`ui_home_scan_hint` 'ℹ️ Tag ဖတ်ရင် ရောင်းမည့် စာရင်း ပွင့်ပါမည်', `ui_sale_add` '➕ Tag ထပ်ဖတ်', `ui_sale_total`
'စုစုပေါင်း {total} ကျပ်', `ui_form_saving` '⏳ သိမ်းနေသည်…', `ui_form_restored` '📋 မသိမ်းရသေးသော စာရင်း ပြန်ပေါ်လာပါပြီ',
`ui_form_clear` '🔄 အသစ်', `ui_line_one` '၁ ထည်တည်း', `ui_stock_over` '⚠️ လက်ကျန် {stock} ထည်သာ ရှိပါသည်',
`ui_phone_short` '📱 ဖုန်းနံပါတ် တိုလွန်းပါသည် (09 နဲ့ စပါ)', `ui_buyer_known_phone` '📱 ဒီဖုန်းက {customer} ပါ',
`ui_transfer_part` '💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ?', `ui_new_title` '🆕 ပစ္စည်းအသစ် · {id}', `ui_tag_scan_new`
'📷 Tag အသစ်ကို ဖတ်ပါ', `ui_photo_retake` '🔄 ဓာတ်ပုံ ပြန်ရိုက်', `ui_form_name` 'ပစ္စည်း အမည်', `ui_form_name_later`
'📸 အမည် မရိုက်ရင် ဓာတ်ပုံကို ကြည့်ပြီး နောက်မှ အမည် ပေးပါမည်', `ui_form_cat` '🏷 အမျိုးအစား', `ui_form_price`
'💰 ရောင်းဈေး', `ui_form_count_sku` 'ℹ️ {n} ထည် · လက်ကျန်နဲ့ ရောင်းမည့် ပစ္စည်း ဖြစ်ပါမည်', `ui_restock_unique`
'ℹ️ {id} က တစ်ထည်တည်း ပစ္စည်းပါ · ကုန်ရောက် မမှတ်နိုင်ပါ', `ui_restock_after` '📦 လက်ကျန် {now} → {after}'.

Reused verbatim (with their lines in 1.3-1.11): `btn_save`, `btn_cancel`, `btn_back`, `btn_undo`, `btn_receipt`,
`btn_pay`, `sold_done`, `credit_done`, `cust_attached`, `sale_*` (round 5), `btn_*` of round 5, `ord_line`, `ord_total`,
`btn_half`, `ask_*`, `bad_qty`, `scan_first`, `tag_not_found`, `tag_not_blank`, `photo_seen`, `item_created`,
`price_ask_owner`, `btn_pending`, `btn_sample_*`, `exp_*`, `btn_note`, `btn_add_bank`, `btn_add_cat`, `add_ask_*`,
`restock_done`, `stock_query`, `expense_done`, `undo_done`, `credit_use_deposit`, `btn_use_deposit`,
`btn_no_deposit`; APP_MSG `ui_btn_close`, `ui_btn_keypad`, `ui_keypad_title`, `ui_keypad_qty`, `ui_btn_photo`,
`ui_btn_pick_date`, `ui_date_title`, `ui_meas_close_ask`, `ui_not_saved`.

---

## 4. Readers (R7; the basket map section 4, decided)

A "basket" below is a group whose `saleGroupInfo(...).rows.length > 1` (one-line baskets keep today's text, rule 7).

| Reader (file:line) | Change |
|---|---|
| sold card `saleCardText` (core_bot.js:3194-3217) | basket: `basket_sold`, one `basket_sold_line` per live SALE row, then today's buyer, method and due lines |
| `U|g` / `V|g` replies (core_bot.js:541-560) | basket or multi-row restock: `undo_done` / `void_done` + one `stock_query` line per item ('{id} · {name}') instead of the first item's card |
| item card buyer line `cardText` (core_bot.js:189-206) | when the piece's group is a basket: `card_buyer_basket` (the basket's figures, said to be the basket's) |
| Credits item name `openCredits` (core_ledger.js:1253-1256) | `basket_name` (3.2); ItemID stays the first item's; no new column |
| three credit reports, owed PDF, Credits tab (core_report.js:227-320, gas_store.js:710-716) | follow `openCredits` |
| customer card `customerCard` + `customerLine` (core_bot.js:1672-1702) | a basket's SALE rows collapse into ONE line: desc 'ရောင်း ' + `basket_count`, amount = basket total, ' · ပေး {cash}' when the group's at-sale cash differs from the total, the method of its rows; the PAYMENT keeps its line. The history then shows up to 8 events |
| 21:00 summary, `dayStats`, Dashboard (core_ledger.js:1534-1682, gas_setup.js:398-453) | none (per-row sums; DueDay on every row) |
| receipt / PDF (core_report.js:331-409) | none (one line per item already) |
| receipt number on a phone (app/app_store.js:294-299; twin poc/sim_phone.js:121-126) | a SALE row whose group already has a numbered SALE row appended just before it (walk back while the GroupID matches) takes the same number; the counter moves once per basket |
| app pending lines `pendingLines` (app/app_sync.js:496-503) | `describeGroup` (3.3) |
| `saleGroupInfo.dueDay` (core_ledger.js:1170) | first non-blank DueDay among live rows |
| simulator Ledger (poc/sim_ui.js:707-724) | a Group cell: '🛍 i/n' for a group of more than one row (page copy) |
| simulator Credits (poc/sim_ui.js:866-878) | follows `openCredits` |
| server `stock_negative` (core_sync.js:807-809) | none; its V| voids the whole basket (stated) |
| server `overpaid` (core_sync.js:811-815) | none (PAYMENT last) |
| `rewriteCheck` (core_ledger.js:1034) | none: `complex`, so no corrective path touches a basket |

---

## 5. Glue and sync

- **setupSheet** (apps-script/gas_setup.js:76, :85-92): seeds `['sale_flow', CFG.SALE_FLOW.FORM]` and writes the new note
  text; a Sheet that holds `steps` keeps it (it reads as `form`); no migration of values (rounds 4-6 never shipped).
- **No server change.** A basket, a counted new piece and a restock group pass `syncValidateBatch` as they are
  (core_sync.js:399-445: one GroupID, items exist, same staff, scope). The phone refuses another shop's line, so a basket
  is never quarantined as `scope` (basket map 2.15). `SYNC.CAPS` stays `['dueDay']` (core_sync.js:85): a phone on an
  older server is forced to `quick`, where none of the form shapes is written.
- **Order on the phone**: customer, item, list entries are pushed before the group (core_sync.js:75), so a new buyer,
  a new piece and an account made in a form arrive first. The form's commit does not trigger a sync by itself
  (`sync.attach` reacts to `update` only, app/app_sync.js:524-528), so every form calls `sync.scheduleSync()` after its
  commit.
- **Photo AI and Drive**: the job is queued at Save (`chat.savePhoto(mediaId, itemId)` first, so `queueAi` takes
  `file.itemId`, app_ports.js:131-135). `flushAiJobs` runs only after a successful sync (app_sync.js:352-353), which
  pushed the item entry first; the server then saves the JPEG to Drive and sets photoUrl (gas_sync.js:308-315), which no
  later phone entry overwrites. `replayJob` (app_sync.js:388-395) gains two guards: it never writes a BLANK item, and it
  sets `category` only when the item's category is blank or the fallback 'အခြား'.
- **gas_store.js, gas_sync.js, gas_main.js, gas_telegram.js**: no change. N basket rows are N `appendRow` under one
  `gasLocked` (gas_store.js:391-410).
- `app/config.js`, `tools/publish*.js`: untouched.

---

## 6. App (app/)

### 6.1 Files

| File | Change |
|---|---|
| `app/app_forms.js` (NEW) | the four forms: pure helpers, then the DOM; loaded after app_ui.js |
| `app/app_ui.js` | home in form mode (`appJobsPanel`), the router in `appOpenTagId` (:563-568), `appOpenTagKeypad(onPick)` (:910-938), `appOpenDateSheet(onOk)` (:972-988), `appOnPhotoPicked` to an open form (:1229-1235), the scanner guards (:346-349, :532-533), no stepper in form mode (:690-692), `APP.form` (:289), the hooks of 6.3, `#overlay.over` while a form is open, no home scanner panel while a form is open (:486) |
| `app/app_ports.js` | `ui.openForm(kind, req)` emits `'openform'` (beside `measureForm`, :179-183) |
| `app/app_store.js` | the receipt-number rule (:294-299) |
| `app/app_sync.js` | `pendingLines` uses `describeGroup` (:496-503); the two replay guards (:388-395) |
| `app/app_i18n.js` | the round-6 keys (3.5) |
| `app/app.css` | 6.4 |
| `app/index.html` | unchanged (the shell ids check_simulator.js:93 binds) |
| `app/dev/index.html` | a `<script>` for app_forms.js; the `saleFlow` checkbox becomes "Settings sale_flow = form (off: quick)" with `world.settings.sale_flow = 'form'` (:70, :136, :207-214); `tgSell` taps the review card's Save when the mode is form |
| `tools/build_app.js` | `APP_FIRST` gains `app_forms` after `app_ui` (:29-30) |

### 6.2 Pure helpers (app_forms.js; Node-tested on an enrolled phone)

```
appScanRoute(ports, staff, itemId, form) -> {to: 'sale' | 'new' | 'card' | 'restock' | 'none', reason}     (1.2)
appFormDraftKey(kind, key) / appFormDraftRead(store, kind, key) / appFormDraftWrite(store, kind, key, d) / appFormDraftDrop
appSaleModel(ports, store, req) -> {staff, draft, restored, wallets, banks, recentBuyers, duePresets}
appSaleSet(ports, draft, field, value) -> draft      the reveal rules: CASH clears mixed and bankPart; 🏛 with one bank
                                                     sets it; mix keeps the account list; full clears paid, due;
                                                     a picked buyer clears newName/newPhone; remove, qty, price, ...
appSaleView(ports, draft) -> {lines (with stockOver), totals, showAccounts, showTransfer, showPart, showDue,
                              needBuyer, knownPhone, problems: []}
appSaleSave(phone, draft) -> {ok: true, groupId, owed} | {ok: false, problems}    basketCommit + basketReply pushed by
                                                     ports.chat.sendMessage(staffId, …), draft dropped; nothing durable
appNewModel(ports, store, req) / appNewSet / appNewView -> {margin, loss, skuHint, presets}
appNewSave(phone, draft) -> {ok, item, pending}      newItemCheck, commitNewItem, savePhoto + describePhoto (try/catch,
                                                     PendingAi expected), notifyOwners when pending, item_created +
                                                     sendItemCard, draft dropped
appRestockAdd(ports, staff, lines, itemId) -> {ok, lines, reason}  /  appRestockSave(phone, lines)
appExpenseModel(ports, store, staff) / appExpenseSave(phone, input) -> {ok, groupId} | {ok: false, code}
appFormCommit(phone, sync, kind) -> Promise<bool>    phone.commit(kind) then sync.scheduleSync() when ok
```

Constants: `APP_FORM_DRAFT_MS` 400, `APP_SALE_DRAFT_TTL` 1800, `APP_NEW_DRAFT_TTL` 86400, `APP_FORM_RESCAN_MS` 800.

### 6.3 DOM and hooks

`appOnFormHook(kind, req)` (the `'openform'` listener; deferred with `setTimeout(0)` like `appOnMeasureForm`,
app_ui.js:995-999), `appOpenForm(kind, req)`, `appFormRedraw(F)`, `appFormSaveTap()`, `appCloseForm({ask})`,
`appFormScan(F, on)`, `appFormPhoto(F, rec)`, `appFormSet(name, value)` (the simulator's `fset`), `appFormSnap()` (the
snapshot object), `appFormMark(el, name)` (adds `hot` when `APP.win.SIM_HOT === 'f:' + name`). `F = {kind, req, model,
draft, dirty, saving, timer, el, scan}` in `APP.form`. Every control is built by one maker that sets `data-f` and calls
`appFormMark`, so the highlight is part of rendering (map-sim-tests T5). Hooks joined (map-app-forms 7):

| Hook | Where |
|---|---|
| `APP.form` field | bootApp :289 |
| `'revoked'` closes the form | :307 |
| `appOnChange` ignores `formdraft` | :354-357 |
| SW `canApply` waits while `APP.form`; `controllerchange` defers the reload to the close | :1254, :1260-1265; `appCloseForm` reloads after `phone.commit('reload')` as :1170-1175 |
| `visibilitychange` restarts the camera only for the home scanner or `APP.form.scan` | :346-349 |
| `appStartScanner` guard | :533 |
| photo input → `appFormPhoto` when a new-piece form is open | :340, :1229-1235 |
| the tag keypad and the date sheet take a callback; with a form open they draw above it (`#overlay.over`) | :910-988 |

### 6.4 CSS (app.css)

`.jobgrid` (2 columns, 72 px buttons, like `.kb.grid` :94-95), `.fscan` (the scanner look of `.scan` :117-124 at 16:9,
max 30vh), `.fline` (a `.card`-like row with the 🗑 at the right), `.fnum` (an input-looking button, mono digits),
`.fchips` (buyer chips: NOT `.chip`, which is the header's sync chip, app.css:61-67), `.fsplit` (one column; two at
min-width 700 px), `.fbar .ftotal`, `.fbad` (bad outline), `.fwarn`, `.overlay.over { z-index: 34 }`,
`[data-f].hot` beside `.kb button.hot, .sell.hot` (:97). Dark mode through the existing tokens only.

---

## 7. Simulator (poc/)

- **Boot and logins** (sim_ui.js:92-110, :181-191): `world.settings.sale_flow = 'form'`; a seller's login lands on 📱
  (`S.device = 'app'`) un-enrolled, with ⚡ lit (map-sim-tests T6); the owner lands on ✈️.
- **Header switch** (simulator.template.html:318-321, sim_ui.js:216-220, :954-959): `#flowForm` "form" and `#flowQuick`
  "quick"; `renderFlow` lights `#flowForm` when `saleFlow` is `form`.
- **Scan on the app** (sim_ui.js:312-327): also emits `{src: 'page', kind: 'scan', id}` (T2), so `scanned(id)`
  (sim_tours.js:50-52) is done by a rack click on either device.
- **Frame** (build_simulator.js): `FRAME_FILES` gains `app/app_forms.js` (:28; check_simulator.js:87 then holds);
  `SIM_FRAME.snap()` adds `form: appFormSnap()` ({kind, lines: [{id, qty, price}], buyer, pay, acct, transfer, paid,
  amount, due, total, error, saved} for a sale; {kind, itemId, photo, name, category, price, cost, count, pending, sample,
  error, saved} for a new piece; restock and expense alike; null when none); ops `form` ({kind, id}: what a tile or the
  router does), `fset` ({f, value}: runs the control's own handler, so the reveal rules run), `fphoto` ({preset}: a sim
  media record as `phone.sim.photo` makes, app_ports.js:285-288); `hot` also redraws an open form (:152).
- **Tours** (sim_tours.js): a new target `{f: '<name>', value?}`; `computeHot` sets `T.hot = 'f:' + name`; `doTarget`
  sends `fset` when the step names a value, else `click` `[data-f="<name>"]` (T1: no `frame:` target without an act);
  done predicates `formIs(fn)` (reads `c.frame.form`) and the ledger mark.

| Tour | Device | Steps (targets) |
|---|---|---|
| sell | app (sister) | tag S1-0002 (form opens with the line), f save; title 'ရောင်း · တစ်မျက်နှာတည်း (ငွေသား · အကုန်)' |
| basket (replaces back) | app | tag S1-0002, tag S1-0005, f qty+:S1-0002, f remove:S1-0005, f save; title 'ပစ္စည်း အများကြီး · တစ်ခု ဖယ်' |
| deposit | app, then owner laptop | tag S1-0001, f paid:part, f amount=12500, f buyer:new, f name=ဒေါ်နီနီ, f phone=09444555666, f due:14, f save; laptop steps as today |
| mixed | app | tag S1-0003, f pay:mix, f acct:KBZ, f transfer=5000, f save |
| price | app | tag S1-0002, f price:S1-0002=15000, f qty+:S1-0002, f save |
| restock | app (brother) | ui frame job tile (act `form` restock), tag S2-0003, f qty:S2-0003=5, f save |
| newitem | app | tag S1-0007, f photo (act `fphoto` htamein_green), f price:25000, f cost=12000, f save |
| expense | app | form expense, f cat:fabric, f amount=20000, f save |
| tgsale (NEW) | tg | tag S1-0002, START, cb S\|S1-0002\|1, cb SC\|S1-0002\|ok |
| tgnew (NEW) | tg, need blank S1-0008 | tag S1-0008, START, photo, cb P\|S1-0008\|25000, cb NS\|S1-0008 |
| quick | tg | #flowQuick, tag, START, S\|S1-0002\|1, #flowForm (done `saleFlow === 'form'`); title 'quick ရောင်း ↔ form' |
| return, payment, takedeposit, order, reports, enrol, stranger | as today | unchanged |
| lists | laptop, then tg | laptop part unchanged; Telegram part: S\|S1-0002\|1 (the card), SS\|S1-0002\|o\|method (the new names, no WavePay), SS\|S1-0002\|z |

- **SIM.smoke** (sim_ui.js:1324-1456): "the simplest sale" and "the deposit sale" drive the review card (same four
  assertions each); "app: a mixed sale of two" drives the form (`form` sale with S1-0003, `qty+`, `pay:mix`, `acct:KBZ`,
  `transfer` 5000, `save`; 1393-1395 stand); NEW "app: a basket of three with a part payment" exactly as map-sim-tests 8
  (S1-0002 × 2, S1-0005, S1-0001; S1-0001 again and S2-0002 refused; Save refused without a buyer; ဒေါ်မြင့်, 30,000,
  14 days; three SALE rows of one group in line order, cash 30,000/0/0, DueDay on all three, one receipt number, one
  `openCredits` entry named by `basket_name`, owed 53,000; the 21:00 step finds ဒေါ်မြင့် too); every wait reads the
  snapshot so both transports make the same number of checks (check_simulator_browser.js:91).
- **Ledger tab**: the Group cell (section 4).

---

## 8. Tests

Every new check fails without its feature. "Named" = an existing check whose code changes, given with its line and label.
Obsolete checks are deleted with the code they pinned (R5) and replaced by the checks listed.

### 8.1 poc/run_wizard.js (bench :55-76 sets `steps`, which now reads `form`; `guided()` :122-127 becomes `card()`)

New steps:
- **W1 commitBasket**: one-line = commitSaleGroup rows field by field for all seven outcomes; 2.1 (a) (b) (c) exactly;
  one `when` with a clock that ticks per call; `basketAllocate` sums and bounds; `basketTotals` equals the rows.
- **W2 basketAddItem / basketCheck**: each reason and each code of 3.2; owner's first line in shop 2; max 10.
- **W3 saleDueKey**: 7, 0, 365, 366 (null), 'none' (''), a past date (null), yyyy-mm-dd, Burmese digits.
- **W4 the card**: `S|S1-0002|1` edits the card in place (same message, caption), nothing written, the texts of 1.10;
  ✅ သိမ်း writes one SALE (cash 18,000, CASH, no customer, no DueDay, no note); the sold card has undo and receipt only.
- **W5 add by scan**: /start S1-0005 → a new message with two lines, the old one reads `basket_moved` with no buttons;
  S1-0001 twice, S2-0002, S1-0007 (blank), a sold piece: refusal lines, basket kept; a SKU again: count 2; a typed id adds.
- **W6 line screen**: count, typed count (`bad_qty` on 0), typed price, remove (the anchor too), back to the card.
- **W7 buyer** (round-5 rules, exits to the card): the assertions of run_wizard.js:318-375, rewritten.
- **W8 how paid** (round-5 rules :386-442, :453-503, :934-995, rewritten): one bank auto-picked, mixed, ➕ inside, kinds.
- **W9 paid and due**: part 0, half, typed; Save refused without a buyer and without a due choice (reason lines); the
  deposit question for ဒေါ်ခင် (CD yes writes DEPOSIT_APPLIED in the group).
- **W10 Save and stale taps**: sold meanwhile (nothing written); two SC on one message write one group; SC after a
  refusal on the same message works; a tap on an older card reads expired; ✖️ = the item card.
- **W11 readers** (section 4): sold card of a basket (`saleSoldCard` true), `basket_name` in openCredits, `card_buyer_basket`,
  the customer card's one line, U| reply lines, the receipt's three lines, the 21:00 overdue line, the dueDay hardening.
- **W12 new piece core**: count 1 = today's fields and RESTOCK 1; count 5 = SKU and stock 5; pending; refusals;
  `itemMargin(25000, 12000)` = {13000, 108}; `itemMargin(25000, 0).pct` null.
- **W13 Telegram new-piece card**: the card after the photo; P preset redraws (no cost step); C other, NQ, NN, NK, PS;
  NS saves SKU × 5; pending pings the owner; in a quick world today's price-then-cost steps stay.
- **W14 commitRestockGroup**: two lines one group; undo mirrors both; refusals.
- **W15 modes**: no NQ|/NN|/NK|/NS| button in the quick world.

Kept (V): step 7 :520-549; step 21 :1165-1186; step 22 :1191-1243; step 24 :1651-1662; :1159; :1412, :1418, :1424;
step 17 :1032, :1036, :1041, :1045, :1049, :1062; step 18 :1074, :1077; :1637 (literal byte counts).
Setup changed, assertions kept (V*): step 10 (setup :667), step 19 (:1100, assertions :1103-1118 via the card), step 20
(setup :1128), step 22x/22y/22z checks marked RC+AF in map-sim-tests 5.1 move into W7-W10 with their labels.
Named: **:1051** "'QUICK ', 'Quick', 'steps', 'x', a blank and a missing key read as the right mode" (now: steps, x,
blank, missing read `form`); **:1633** 'every text is exactly the one the spec gives' (`settings_note_sale_flow` is compared
with SPEC-round-6.md's text, the other 24 with SPEC-round-5.md); **:1643** 'START + one tap asks who bought it…' (now:
shows the review card, nothing written); **:1057** 'flipped to steps between two sales: the next tap asks' (now: form,
the card).
Deleted with the step machine (O, map-sim-tests 5.1): step 1 :149, :151, :159, :163, :167, :169, :183, :187, :192, :195
(→ W4); step 2 :213, :217, :236, :240 (→ W6); step 3 :269-307 except :278 (→ W6); step 6 :458, :490, :497; step 8 :568,
:597; step 11 all but :742-766 (→ W10/W8); step 12 :802; step 13 :855, :861, :864; 22x :1498, :1506, :1583, :1592, :1608;
22y :1345, :1350; 22z :1260, :1312, :1316. Every RC/RC+AF check of steps 1-6, 8, 9, 11-16, 22x-22z is rewritten into
W4-W10 with the same label where the rule survives.

### 8.2 poc/run_app.js (a `round6()` after `round5()`, steps 41-55; `fakeDocument6` = `fakeDocument` plus `body` and a
`data-f` lookup, defined inside round6 so the shared helper :850-888 stays as it is)

- **41** `appScanRoute`, every row of 1.2.  **42** sale model/set/view: defaults, every reveal rule, totals = rows.
- **43** basket save on an enrolled phone: refusals write nothing; Save → ONE adapter transaction holds three SALE rows,
  ONE outbox group entry, the sold card and the draft removal (`adapter.transactions`, as step 3 :110-113);
  `appFormCommit` schedules exactly one sync at `APP_SYNC_DEBOUNCE_MS`; one receipt number on all three rows, counter + 1.
- **44** sync: the server's ledger has the three rows in order, no quarantine, no OVERPAID; `basket_name`; stock.
- **45** a new buyer: the customer entry is pushed before the group; a known phone uses that customer.
- **46** mixed basket: PAYMENT last, server ok.  **47** the draft survives a restart over the same adapter; a sold line drops.
- **48** new piece: count 5 → item entry (type SKU) before the RESTOCK group; the AI job is queued at Save with itemId,
  not before; pending → a notice; a replay onto a BLANK item writes nothing; the category guard.
- **49** restock save (one group), refusals.  **50** expense save (note in the row, a category added on the fly first).
- **51** hooks: S|id|1, Q|id, D|id, R|id, M|exp and a blank openTag emit `'openform'` with the right kind and write
  nothing; in quick they behave as today.
- **52** fake DOM: the sale form's controls carry `data-f`; `SIM_HOT = 'f:save'` marks only Save; `#overlay.over` while open;
  home in form mode has the job grid and no stepper.
- **53** stub APP (as step 29): `canApply` false while `APP.form`; revoked closes it; the reload waits for the close.
- **54** `pendingLines`: a basket is one line, a restock group one line.  **55** older server: quick, no job grid, S| commits.

Named: **:921** 'the server says steps…' and **:924** (form: the next pull; the scan opens the form) → AF; **:962**, **:965**,
**:967**, **:970**, **:973** (their setup becomes the form's Save; labels kept); **:1013**, **:1018**, **:1020** (the date
sheet now hands the date to a callback); **:1028-1036** (setup via the form); **:1073** (Telegram shows the card) and
**:1077** (`saleFlow` is `form`); **:1086**, **:1090**, **:1159**, **:1167**, **:1172** (setup moves to a phone with the pref
`setting:sale_flow` quick, labels kept); **:1097**, **:1101** (setup: the item card's keyboard); **:1142** 'the dev page
starts in steps and has the sale_flow checkbox…' (form); **:1243** (`boot40 === 'form'`), **:1259** ('form again'),
**:1266** ('the stepper's S|S1-0003|1 opens the guided sale again') → 'opens the form hook and writes nothing'.
Deleted (O): :899-903 with `appInputModeFor`'s `sale` branch (app_ui.js:76-82); :928-957; :985-1009, :1023; :1045-1057
(→ 47); :1103-1132; :1194, :1213, :1224, :1227. Kept (V): :906, :909, :918, :1062, :1067, :1135-1140, :1146, :1196,
:1249, :1254, and every check of steps 1-31 (they run on the seed's quick, poc/sim_seed.js:72).

### 8.3 poc/run_sync.js

New **R6a** a basket of three with a mixed part payment from the reference phone (poc/sim_phone.js through the card's
taps): one entry, PAYMENT last, no flag, one receipt number on the SALE rows (the sim_phone twin), one Credits entry;
**R6b** a hand-built basket with a shop-2 line from a shop-1 phone is quarantined `scope` (why the phone refuses it);
**R6c** a counted new piece: item (SKU) then RESTOCK 5, server stock 5; **R6d** a restock group of two; **R6e** a photo
job queued at Save is flushed after the push and the server's `drive://` photoUrl stays.
Named: R5a setup **:1556-1563**, R5c **:1600-1609**, R5e **:1667-1671** (card taps instead of `SS|`/`SC|` steps;
assertions :1565-1580, :1614-1618, :1673-1678 kept); **:1693** (form: the sell button opens the review card),
**:1734** (`saleFlow` `form`; `same3(wire.caps, ['dueDay'])` unchanged), **:1753**, **:1764** (form; the card).
Kept: :1589, :1630-1654, :1687, :1701-1715, :1739, :1745, :1749, :1757, :1769; S8 :309-332 (quick).

### 8.4 poc/run_gas.js

Named: **:1495** 'Settings: sale_flow = steps, its Key cell carrying settings_note_sale_flow…' (form, the new note text);
**:1540** 'Settings got sale_flow = steps…' (form). New: a Sheet holding `steps` keeps it and reads as `form` (19c); one sync
of a basket of three plus PAYMENT lands as one Ledger block of four rows, no OVERPAID (23 sibling). Kept: :1498 (no key
deleted), :1454 (commitSaleGroup wrapper), :1771 (caps).

### 8.5 poc/run_round4.js 9z and step 10

Kept: :1938, :1942, :1945, :1951, :1954, :2002, :2007, :2008. Named: **:1964** 'steps: sell() returns no row of its own…
the card is edited into the buyer screen' (form: into the review card) and **:1967** '✖️ on that screen brings the item
card back' (its tap becomes `SS|<id>|z` on the card).

### 8.6 run_scenario.js, run_lists.js

Untouched; the photo flow checks (run_scenario.js steps 11, 12, 28, 29) and run_lists.js:919-921 run on quick.

### 8.7 poc/check_simulator.js and check_simulator_browser.js

Named: **:124** 'the template carries the ids sim_ui.js binds' (`flowForm` for `flowSteps`); **:140** 'the page boots with
sale_flow = steps' (form); **:156** 'every tour of 6.4 is there…' (without `back`, with `basket`, `tgsale`, `tgnew`);
**:193** 'every step has exactly one target…' (`KINDS` gains `f`, :160); **:217** 'the sell tour runs from S|S1-0002|1 to
SC|S1-0002|ok' (that is now the `tgsale` tour; the `sell` tour runs tag → f save). New (step 5 sibling): app_forms.js sets
`'data-f'` and reads `SIM_HOT`; BOOT has ops `form`, `fset`, `fphoto` and `form:` in the snapshot; `hot` redraws a form;
the page emits a scan event on the app. Kept: :47, :87 (both lists gain the file), :93, :135-139, :141, :153, :190-214,
:223, :226, step 7. check_simulator_browser.js: all kept; :91 binds the new smoke step to both transports.

---

## 9. Build steps and ownership

| Step | Owner edits | Gate |
|---|---|---|
| 1 core | apps-script/core_config.js, core_ledger.js, core_report.js, core_messages.js, core_bot.js, gas_setup.js; poc/run_wizard.js (8.1), run_gas.js (8.4), run_round4.js (8.5) | every `node poc/run_*.js` ends `0 failed` |
| 2 app | app/app_forms.js (NEW), app_ui.js, app_ports.js, app_store.js, app_sync.js, app_i18n.js, app.css, app/dev/index.html, tools/build_app.js, poc/build_simulator.js `FRAME_FILES` only, poc/sim_phone.js (receipt twin), poc/run_app.js (8.2), run_sync.js (8.3) | suites green; `node tools/build_app.js` passes its secrets scan |
| 3 simulator | poc/sim_ui.js, sim_tours.js, build_simulator.js (snapshot, ops), simulator.template.html, check_simulator.js (8.7) | `node poc/build_simulator.js`, check_simulator.js green, the browser check on both transports |
| 4 verify | none (docs only) | all of the above again; a copy in `C:\Users\USER\Desktop\Noel-backup\r6-built`; nothing published |

One builder per step owns its files; step 2 also edits the one `FRAME_FILES` line so check_simulator.js:87 never
fails between steps.

---

## 10. Not built (deliberately)

- Payment, deposit and return forms (R4 could; 1.7).
- An AI name inside the app's open form (the app's AI is asynchronous by design; Telegram has it).
- Markup chips (+30 % / +50 % / +100 %) that fill the price from the cost: a later refinement of R3.
- A per-line undo; a basket over two shops; a transfer inside a form; voice inside a form.
- Telegram photo cards for app-registered pieces (the phone's media id as photoFileId, core_sync.js:719-739).
- Review cards in Telegram for restock and expense (today's buttons stay: `R|`, `RQ|`, `EC|`, `EA|`, `EM|`).
- The bottom bar labels through `t()` (still hard-coded, app/index.html:30-34); the Android back button closing a form.
- A nudge in Telegram for a seller whose phone has the app (`enrolledInApp`/`sendAppCard` stay dead).
