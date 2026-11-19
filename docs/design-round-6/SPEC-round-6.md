# SPEC round 6 (binding): forms in the app for the sellers, Telegram for the owner

**Revision 3 (2026-11-13, owner feedback 1).** The owner tried the simulator; `FEEDBACK-1.md` turned the twelve points
into binding decisions F1-F12, and the owner's reply replaced F9 by F9b (one AI switch; the notebook stays in the app).
Section 13 is the whole contract of revision 3; the earlier sections were edited where they now differ and say
"revision 3". R1-R9 stand; nothing of revision 2 is withdrawn except where a row below says so.

| F | Decision, in short | Sections |
|---|---|---|
| F1 | one notes field on the measurement form: the MeasureFields `note` row as a 300-character box; the form's own box removed; old notes merged into it without loss; the PDF and Telegram show it once | 13.7.1, 1.10, 13.15 (W37, R6h, run_app 67) |
| F2 | the front-view figure (a woman, or a man) to draw on with a finger: pen, eraser, clear; saved with the session as strokes (`sketch`, a new Measurements column) and as a PNG through the photo-job path into the session's PhotoURL; shown again, printed on the measurement PDF, named on Telegram's measurement card; offline | 13.7.2, 3.1, 6.7, 13.15 (W37, R6h, R6i, run_gas 30-31, run_app 68-69) |
| F3 | history = this phone's own records (ledger groups) as a table by day; a row opens its receipt or its entry, with undo while allowed; the bot chat leaves the app | 13.8, 13.15 (run_app 61) |
| F4 | no chat box: a labelled field with OK only for a question that waits, a search field with a magnifier only where searching happens | 13.5, 13.15 (run_app 60) |
| F5 | buyers page: list with search and +, a buyer form (new, edit), a buyer page as a clean list with its sales and actions; `customerCheck` / `commitCustomer`; the existing customer sync and its Rev bump | 13.6, 13.15 (W34, W35, run_app 62-64) |
| F6 | ← at the top left of every screen but the home, forms included; one navigation stack mirrored in history state; the Android back gesture; a dirty form asks once | 13.3, 13.4, 1.0, 7.3, 13.15 (run_app 58-59) |
| F7 | emojis only on the job buttons and the main menu; `appPlain` everywhere else; clean label/value lists and tables; views for the item, sold, today and (review r3) group cards | 13.1, 13.9, 1.0-1.7, 13.15 (W36, run_app 57, 66) |
| F8 | English words OK, Settings, Menu, Scan, Photo, Save, Cancel (plus Share, PDF, Print, which F11 names, and AI, which F9b names); back, sync and settings icon-only with accessible labels; Tabler-style inline SVG icons that ship inside the precached bundle | 13.1, 13.2, 13.3 |
| F9b (replaces F9) | one Settings key `ai`, the owner's switch in the app's Settings for every phone and the bot; on: 📒, 🎤 and the photo's AI name in the app (with today's `notebook_import` / `app_voice` rows); off: none of them and no AI call anywhere; Telegram obeys it | 13.11, 2.6, 13.15 (W38, R6g, R6i, run_gas 32, run_app 71) |
| F10 | the owner edits each shop's name, address and phone in the app's Settings (a new owner-only `setting` entry) and in a marked Shops block of the Settings tab; ids stay S1 / S2 | 13.12, 13.15 (R6g, run_gas 29, 32, run_app 70) |
| F11 | ဘောက်ချာ opens a receipt screen with 'ဘောက်ချာ Share မယ်' (its text to the phone's share sheet) and 'PDF / Print' (the phone's print dialog, offline) | 13.10, 1.4, 13.15 (W34, run_app 65) |
| F12 | 📦 ကုန်ရောက် on the app home (revision 2) and in the app's ☰ menu | 13.11, 2.6, 13.15 (W34, run_app 72) |

The two questions put to the owner (a return from a sale still owed; a piece scanned twice into the basket) got no answer:
the design's choices stand and the user guide states them plainly (13.16 step 5). `docs/design-round-6/mockup.html` is
redrawn for revision 3.

**Revision 3, after its two reviews (2026-11-13).** `review-r3-ux.md` (UX-B1, UX-M1 to M9, UX-m1 to m10) and
`review-r3-build.md` (B-1, M-1 to M-12, m-1 to m-15) were checked finding by finding against today's tree. The revision
number stays 3; R1-R9 and F1-F12 (with F9b) stand. Applied, with the fix chosen where a finding offered two:

| Id | What changes | Where |
|---|---|---|
| UX-B1, M-10 | The stack no longer counts popstate events: every history entry carries its depth (`{salestag: d}`), `appOnPop` closes the layers above the depth it landed on, and `appNavSync` brings the history to `APP.nav.length` with one `pushState` per missing level or ONE `history.go(-n)` (one walk, one popstate, recognised by `APP.navBusy`); `navIgnore` is gone | 13.4, 1.0, 13.15 run_app 59 |
| UX-M1, m-7 | One rule for `card` layers: `appRender` keeps a `card` layer on top exactly while the home shows a card (a scan, a tile, the menu, a screen action, a form's Save, the line-name card); a Save replaces the form layer by the reply card's `card` layer; a close without Save returns to the card state when a `card` layer is below; the receipt from a sold card returns to it | 13.4, 7.3, 1.0, 1.1 |
| UX-M2 | A layer that replaces another uses `appNavReplace` (no history call); a push made while the app's own walk is under way is written when its popstate arrives; `appNavDrop` does nothing when no layer of that kind exists | 13.4, 13.6 |
| UX-M3, m-7 | The banner, the re-enrol wipe, revoke, an enrolment, the dev page's `&screen=` and the simulator's `screen` op go through `appOpenScreen` / `appNavReset`; the bottom of the stack is the enrol screen on a phone that is not enrolled; `#back` is hidden on the enrol screen | 13.3, 13.4, 13.13, 13.15 |
| UX-M4 | A guard entry pushed with the seller's first tap, so Chrome's skip of entries added without a tap closes layers instead of leaving the app; the toast `ui_back_again` at the bottom; real-phone checks of the stack, the figure, the PNG, Share and Print | 13.4, 10.7, 13.14 |
| UX-M5 | The figure is inert (the page scrolls over it) until ဆွဲ, which enters a draw mode left with OK; an undo of the last stroke; clear is its own button; each pointer is mapped through `getBoundingClientRect` at every event and the canvas redrawn on resize; at most 300 px wide and `calc(100vh - 240px)` high | 13.7.2, 13.13, mockup 8 |
| UX-M6 | `appPlain` removes every emoji anywhere in a line (`APP_EMOJI_ANY`; text arrows and shapes such as → and □↑ stay), then tidies the line; run in Node on every MSG and APP_MSG value, none keeps an emoji; run_app 57 asserts it for every key | 13.1, 13.15 |
| UX-M7 | Every path that bypasses `APP.tt` is named and fixed: app_sync's texts through `appPlain` where drawn, the tiles, the find heading and button, the photo placeholder, the report's 📄, the voice bubble, the copy toast (`ui_copied`), the tag keypad's ✅ (OK) and ⌫ (an icon), the stepper; 1.3's line label | 13.1, 13.2, 13.13, 1.3 |
| UX-M8 | No '·'-joined values left in the app: the buyer's and the phone's history rows, the sale form's bar (three label/value cells), a `group` view for the restock, expense, payment and deposit replies, the sold view's mixed method, the item view's basket row, the Settings and sync screens as label/value rows, the AI parts as rows, the shop rows | 13.6, 13.8, 13.9, 13.11, 13.12, 1.3, mockup 3, 10, 12, 13, 15 |
| UX-M9 | The card state's Photo handle is deleted (with no state waiting it replaced the last scanned piece's photo without saying so); the new-piece form keeps its Photo | 1.1, 13.1, mockup 4 |
| UX-m1 (second part) | Every button whose text is `btn_cancel`'s reads 'Cancel', whatever its callback (`Z` and `SS\|…\|z`) | 13.1, 13.9 |
| UX-m2, m-9 | At boot an entry with `salestag` above 0 (a reload) is walked back once | 13.4 |
| UX-m3 | A measurement Save toasts `meas_saved_form` (plain); `appCloseMeasForm` drops the `meas` layer on Save and revoke; with no active `note` field a restored draft's notes are saved as notes | 13.7.1, 13.4 |
| UX-m4 | The receipt of an undone sale shows `ui_hist_undone` and no Share, Print, undo or void; every action and hint sits inside `.rc-actions` | 13.10 |
| UX-m5 | `ui_lbl_qty` 'အရေအတွက်'; 'Photo အမည်', 'Settings {label}' and 'Scan' in the two scan hints | 13.14, 9.3, 1.1, 1.5 |
| UX-m6 (in part) | 13.11 says where restock is under `quick` (the scanned piece's card); 📦 in Telegram's menu is left to the owner | 13.11, 13.17 |
| UX-m7 (first part) | sim_ui.js:631 marks `#back` | 13.15 |
| UX-m8 | The guide says what 📒 does; a hint line under the AI switch | 13.11, 13.16 |
| UX-m9 | 13.17 says why the history lists no measurement sessions (the toast of UX-m3 confirms a save) | 13.17 |
| UX-m10, m-8 | The mockup and the spec agree (the figure 300 px wide, the full month in the buyer's table, the sold card's ←, now true); 7.4 drops `formPopIgnore` | 7.4, mockup |
| B-1 | Chosen: a drawing alone is still refused `empty` (one value at least; the note counts), so no entry without fields reaches the server; no server change | 13.7.2, 13.15 run_app 69 |
| M-1 | Chosen: a job kind `pic` (an upload without AI). With AI off a new piece's photo is queued as `pic`: the server saves it to Drive and sets the item's photoUrl, never calls Gemini and never answers `ai_off` | 13.11, 6.7, 13.15 (R6i, run_gas 31, run_app 71) |
| M-2 | A sketch job of a refused session fails when `measurementRejected` runs; `no_session` is tried at most 5 times and writes no Errors row | 13.7.2 |
| M-3 | `gasStore.setSetting` sets the Value cell to plain text before writing a string; `dup` compares strings without case | 13.12, run_gas 29 |
| M-4 | Chosen: the Shops block is coloured by one conditional-format rule on the Settings tab (members the fake already models, read back through its `rules()`), not `Range.setBackground`; it stays in step 1 | 13.12, run_gas 32 |
| M-5 | The PDF's notes row keeps 'မှတ်ချက်' (a PHOTO session's margin note); only the 'fix of M-…' part prints as 'ပြင်ဆင်ချက်' | 13.7.1, W37 |
| M-6 | The run_app.js:497 edit is step 3's | 13.15, 13.16, 10.8 |
| M-7 | Chosen: step 3 runs after step 2 | 11, 13.16 |
| M-8 | R6g tests the older server by leaving `setting` out of `SYNC.ENTRY_KINDS` (as M9 does); a store without `setSetting` is final; a refused setting toasts the owner | 13.12, 13.15 |
| M-9 | The dev page's header gets `#back` | 13.13 |
| M-11 | Chosen: every nav function and the simulator's `snap` are null-safe, so the stub APPs of today's checks need no edit | 13.4, 13.16 |
| M-12 | AI jobs met while AI is off (or answered `ai_off`) are `skipped`: out of the queue, the sync icon and the pending lines | 13.11 |
| m-1 | The merge of a saved FORM session's notes is dropped (no phone record has a `source`) | 13.7.1 |
| m-2, m-15 | The PDF's figure and its 'စာရွက် ဓာတ်ပုံ' row are decided by `meas.sketch`; `MM\|copy` copies the drawing and its picture; a fix made before the PNG exists is named in 13.17 | 13.7.2, 13.17 |
| m-3 | `addMeasurement` appends `Sketch` only for a session with a drawing; setupSheet adds it at the publish | 13.7.2, 3.1, 6.6 |
| m-4 | The smoke's back click is `{op: 'click', sel: '#back'}` with no key | 13.15 |
| m-5 | A finished sketch or pic job leaves the ⏳ lines alone; such jobs have their own pending line `ui_pending_pics` | 13.7.2, 13.14 |
| m-6 | The undone mark of the history comes from every row of the group | 13.8 |
| m-10 | Blank rows under the PDF's caption cover the figure; `insertImage` runs before `flush` | 13.7.2 |
| m-11 | `Path2D` draws the outline; the canvas comes from an injected factory | 13.7.2 |
| m-12 | A rollback of the bot below round 6 is named | 13.17 |
| m-13 | Kept and said: the AI switch's ON also writes `notebook_import` and `app_voice` TRUE, because F9b says "AI on" shows 📒 and 🎤; the Sheet rows turn one part off afterwards | 13.11, 13.17 |
| m-14 | The stepper's label at a count of 1 goes through `appPlain` | 13.1 |

Rejected, each for one reason:
- UX-m1, first part (← runs a card's own ⏮ နောက်ပြန်): `btn_back` exists only on `SS|…|back` (the Telegram review card,
  core_bot.js:2530), `MQ|…|b` and `MF|` (core_bot.js:4254, :4385, the Telegram measurement flow), and the app shows none
  of them (form mode has no review card; the app opens the measurement form instead, core_bot.js:4183, :4199), so no app
  screen has two backs.
- UX-m7, second part (rename the tour's text): the page's text names `ui_btn_back` '← နောက်သို့', the arrow the app shows
  and its accessible name; sim_ui.js:1401 and :1414-1415 pin it.

Left to the owner: whether F12's "main menu" also means Telegram's menu (UX-m6; 13.17).

**Revision 2 (2026-11-13).** The three reviews (`review-money.md`, `review-ux.md`, `review-build.md`) were checked
finding by finding against today's tree. Every finding held and is applied below; none was rejected, and R1-R9 stand
(no blocker proved one impossible). Where a finding offered two fixes, the one chosen is named here.

| Id | What revision 2 changes | Where |
|---|---|---|
| M1 | 6.2's "the item entry is always pushed first" was false (`flushAiJobs` runs after any good sync, before the `again` sync). `sync.flushAiJobs` and `sim_phone.applyAiResults` skip a photo job while an `item` outbox entry for its `itemId` waits | 6.2, 7.5, 10.3 step 50, 10.4 R6e |
| M2 | Fix (a): a `stock_negative` flag on a stock item (SKU) pings the owner with NEW `ping_stock_short` and no void button; a one-of-a-kind piece keeps `ping_stock_negative` and `V\|`. One `core_sync.js` change, in step 1 | 1.3, 5.1, 6.3, 9.2, 10.4 R6f, 11 |
| M3 | 1.10's claim removed. `T\|` on a piece whose last live sale still owes writes nothing and answers NEW `ret_credit_open`; the owner's path is the void (M6) | 0.1 R4, 1.10, 4.4, 5.1, 10.1 W33, 12 |
| M4, B6 | One guard `basketGroup(info)` = more than one live SALE row and not a custom-order delivery (`isOrderId`), used by every reader branch; the `U`/`V` reply also skips an id with no Items row | 0.1 R7, 4.2-4.4, 5, 10.1 W27(i) |
| M5 | A form-mode new piece's card carries `[↩️ မှားသွားတယ်]`; its `U\|` also returns the tag to BLANK (`unregisterItem`), refused with NEW `undo_new_used` once the piece has other live rows | 1.5, 2.3, 3.6, 4.2, 4.4, 10.1 W28, 10.3 step 50 |
| M6 | The owner's 🧾 receipt reply of a basket carries `voidButton`; the owner's item card of a piece last sold in a basket carries 🧾 (`ownerBasketRow`) | 0.3 rule 17, 1.4, 4.4, 12, 10.1 W27(j) |
| m1 | 3.5 corrected: `backfillSync` writes the number on a group's first SALE row only; the copy to every line is the phone's | 3.5 |
| m2 | `customerLines`' desc is 'ရောင်း ' + NEW `basket_count` '🛍 {n} ခု'; `cust_line` carries the amount once | 4.4, 5.1, 9.1, W27(e) |
| m3 | 0.3 rule 11 reworded: the `V\|` listing is the 4.4 change | 0.3 |
| m4, B16 | Chosen: 'အခြား' (chosen or the fallback) is the one category the photo AI may replace; documented, W25 unchanged | 1.5, 4.2, 6.2 |
| m5 | Chosen: the promise of a per-phone quick switch is removed (no control writes the pref; it stays a test hook) | 1.0, 1.11, 3.10, 6.6 |
| m6 | `setupSheet` rewrites a Settings value `steps` to `form` and a round-5 default note to the round-6 one; 3.10 also names core_sync.js:1492 | 3.10, 6.1, 10.5 section 27 |
| m7 | A seller's blank tag of the other shop is refused (`basket_other_shop`) in form mode: `commitNewItem` `other_shop`, `openTag`, the app router | 1.2, 1.5, 4.2, 4.4, 12 |
| U1 | The form owns the scanner through ONE predicate `appScannerWanted()` used by `appRender`'s stop line (:388), `appStartScanner`, `appOnChange` (:358) and visibility; the strip is drawn with the scanner's states; real-phone checks | 1.0, 7.3, 7.4, 10.7 |
| U2 | Inside a form a re-read never raises a count (the stepper is the count, R2): an id already a line only toasts; `APP.scanner.holdMs` (app_scan.js) drops a tag held in view silently | 0.3 rule 14, 1.0, 1.2, 1.6, 7.1, 10.3 |
| U3, U23 | Draft rule: 🛒 restores; a scan or card button for an id already a line restores and adds nothing; any other id opens a fresh basket with the old lines one tap away (`ui_form_older`, `restored:merge`) | 0.3 rule 15, 1.0, 1.3, 7.2, 7.3 |
| U4 | Every `.fnum` opens the keypad empty, titled with its label and current value, with its upper bound; NEW `ui_price_far` warns above 10 × the item's price | 1.0, 1.3, 10.3 step 53 |
| U5 | No repaint while typing: text inputs redraw only their dependent region; a sync repaint waits for blur; the strip node is kept | 1.0, 7.3 |
| U6 | 7.6: wrapping `.seg`/`.toggle` in forms, a two-row line with a 56 px stepper, a bottom padding that follows the bar, Telegram's wallet collapse (`pay:wallets`); the mockup redrawn at the app's sizes | 1.3, 7.6, mockup |
| U7 | A last `➕ ဘဏ်အသစ်` (`pay:add`) on the how-paid row, always | 1.3, 7.8 |
| U8 | Search text left without a pick: a new buyer when nothing matches, else Save refuses with NEW `ui_buyer_pick_first` | 1.3, 1.9, 7.2 |
| U9 | No silent buyer swap: a known phone is a tappable chip and Save refuses until it is tapped or changed; ✏️ new with an exact name offers that customer next to `btn_create_named`; `saleResolveBuyer`'s phone rule dropped, `forceNew` added | 1.3, 1.9, 3.9, 4.4 |
| U10 | A Telegram scan without ➕ pauses the card (NEW `basket_paused` + `↪️` `SS\|<a>\|go`) and the scanned item's card offers `➕ စာရင်းထဲ ထည့်` (`SS\|<a>\|i\|<id>`); a basket is dropped only by starting another sale; `basket_closed` reworded | 0.3 rule 1, 1.2, 2.1, 2.2, W31 |
| U11 | Sub-screens and their typed prompts end with ⏮ alone; on the card ✖️ has its own row below Save | 2.1, W4, W12 |
| U12 | Telegram new-piece card: a typed number ≥ 500 at step `card` is the price, a smaller one asks again, other text is the name; a second photo replaces only the photo | 2.3, 4.4, W29 |
| U13 | `not_blank` at Save clears the tag and shows the strip again, keeping every typed value | 1.5, 1.9, 7.2 |
| U14 | The photo AI's `photo_seen` line goes before the latest card with buttons, never on top | 6.2, 7.5 |
| U15 | Android back: `history.pushState` on open, `popstate` asks before closing (no longer in 12) | 1.0, 7.3, 12 |
| U16 | An accepted blank tag stops the new-piece scanner; 📸 stops it before opening the camera | 1.0, 1.5, 7.3 |
| U17 | `appCloseForm({saved: true})` never restarts the home camera; a `mode` close toasts `expired` | 7.3 |
| U18 | `appFormSave` catches a throw (`logError`, Save re-enabled, `expired`) | 1.0, 7.3 |
| U19 | 1.8: three pieces in Telegram = 6 taps | 1.8 |
| U20 | The expense form's reply is `undoRow` | 1.7 |
| U21 | (a) the date sheet's max = today + 365; (b) a pending line's keypad title `ask_sale_price`; (c) NEW `restock_max`; (d) cost is 🪙 on the new keys; (e) NEW `item_ask_cost` on the card's cost screen; (f) 9.1's source sentence corrected; (g) `btn_paid_full` starts with 💯; (h) NEW `basket_method_gone` | 1.3, 1.5, 1.6, 1.9, 2.3, 9.1 |
| U22 | The compact row: 🛒 with its label over two columns, 🆕 📦 💸 emoji-only with `aria-label`; the job grid 64 px and the home scanner capped at 40vh under it; one letter-map name `SALE_STEP_OF` | 1.1, 4.4, 7.6 |
| U24, B12 | `await_text` purpose `phone` maps to `tel` (the mode stays); the `'date'` mode, its bar and the sheet's no-callback path are deleted | 7.4, 10.3 step 54 |
| U25 | A 🔍 row in the sale and restock forms; a typed name on the Telegram add screen lists up to four `i\|<id>` matches | 1.3, 1.6, 2.1 |
| B1 | The `return` and `reports` tours lose `devices` (Telegram only); 6b guards tours that need the item card | 8.4, 10.6 |
| B2 | `appFormSnap.last = {f, n}`; `ff`/`fset` are done when `last.f` is their name with `n` above the step's mark; `error` is the problem's key | 7.2, 8.3, 8.4, 8.5 |
| B3 | The page resolves the photo preset and sends the whole record in the `photo` op | 8.2, 8.4, 10.6 5b |
| B4 | 1424 moves to W22y (`btn_paid_full` → `p\|all`); W8 and run_app 54 cover `p\|all` / `paid:full` | 10.1, 10.3 |
| B5 | run_app 53-54 drive the keypad and the date sheet | 10.3 |
| B7 | 922 and step 21 are "setup through `card()`"; 901 O, 905 V, 1116 O | 10.1 |
| B8 | Steps 1-3 rebuild the simulator before check_simulator | 11 |
| B9 | 6b: "the sale part ends at `f: save`" | 10.6 |
| B10 | R6c and W32's literal byte counts are labelled pins; run_gas 26 builds its rows with `commitBasket` | 10.1, 10.4, 10.5 |
| B11 | Step 46 asserts one `receiptNo` on the SALE rows and none on the PAYMENT | 10.3 |
| B13 | 1081 uses `G2.store.meta.staff`; the deletions are "the step body except the G/G2 creation, the enrolment and `uid`" | 10.3 |
| B14 | 8.3's predicates written as ES5 functions | 8.3 |
| B15 | Mockup: the recent row and 🔍 in the sale form, six home tiles, no 🎤, the ⌃ မှတ်တမ်း handles, the seed's price chips | mockup, 1.1, 1.5 |
| B17 | The changed 1142 also requires `app_forms.js` after `app_ui.js` on the dev page | 10.3 |
| B18 | Step 2 owns poc/fake_gas.js, poc/sim_ports.js and run_gas.js's member tables, when a member is needed | 6.5, 11 |
| B19 | Step 41: "no bot message" | 10.3 |

Date 2026-11-12 (revision 2: 2026-11-13; revision 3, the owner's feedback: 2026-11-13). This file is the contract for the build of round 6 (`docs/design-round-6/BRIEF.md`, R1-R9). Where the
brief, a design (`design-seller.md`, `design-owner.md`, `design-risk.md`), a map (`map-app-forms.md`,
`map-core-commits.md`, `map-sim-tests.md`, `docs/design-round-5/map-basket-readers.md`, called "the basket map") or
round 5's contract (`docs/design-round-5/SPEC-round-5.md` rev 2.1) differs from this file, this file wins. Every
`file:line` is today's tree: rounds 4 and 5 built and unpublished. Rounds 4, 5 and 6 ship together; nothing is
published before step 5 of section 11 is done.

How this spec was merged. The screens follow `design-seller.md` (the seller-UX winner) with that judge's grafts. The
ledger contract (commitBasket's derivation, the basket against the seven round-5 outcomes, DueDay on every SALE row plus
the `saleGroupInfo` hardening, the types-based undo replies, `describeGroup`, `customerLines`) follows `design-owner.md`
(the bookkeeping winner). The code shape (state kind `'sale'`, the `SS|`/`SC|` prefixes, the round-5 sub-screens reused,
one shared Save, the router in `appOpenTagId` plus `openTag`, the render/mount split of `app/app_forms.js`, the
simulator ops, the `run_wizard.js` disposition table, step 1 owning the core-dependent test regions) follows
`design-risk.md` (the buildability winner). Where the three judges disagreed, section 0.3 gives the ruling and why.

Suite counts measured today (`node poc/<suite>.js`): run_scenario 327, run_round4 345, run_lists 236, run_gas 295,
run_app 265, run_sync 333, run_wizard 290, check_simulator 68, all `0 failed`.

---

## 0. Decisions

### 0.1 R1-R9 (binding, BRIEF.md:30-72), with these refinements

- **R1** The four forms are app-native pages on `document.body` (the `#measForm` precedent, app/app_ui.js:1001-1052),
  in ONE new file `app/app_forms.js`: a pure part (Node-tested) and a thin DOM. They call the core on `phone.ports`
  (`commitBasket` through `basketCommitDraft`, `commitNewItem`, `commitRestockGroup`, `commitExpense`), then
  `phone.commit(kind)`, then `sync.scheduleSync()`. The home in form mode gets four job tiles above the scanner.
- **R2** The sale form is 1.3. Defaults count 1, cash, paid in full, no buyer: a normal cash sale is one scan and one
  tap (Save). One write = one group (section 3.2). Two refinements: a part payment requires an amount and a promised-day
  choice (none preselected), and the stock shows on every stock-item line.
- **R3** The new-piece form is 1.5. The app never waits for the photo AI: the job is queued at Save (0.3 rule 2 says
  why a pre-fill inside the form cannot be done without a sync change); the name is what the seller typed, or the
  placeholder `ပစ္စည်း <id>` that the AI renames after the next sync. Telegram's new-piece card IS pre-filled (its AI
  answers at once, core_bot.js:2115-2122).
- **R4** Built: restock (1.6) and expense (1.7), the two "should" jobs. Not built: the three "could" jobs (receive a
  payment, take a deposit, a return) stay today's chat flows, which already work in the app through `deliver`
  (map-app-forms 16). A payment and a deposit read the group's owed, so a basket works with them; a return does not
  (`T|` refunds cash with no group or buyer, core_bot.js:528-535, core_ledger.js:866-879), so `T|` on a piece whose
  sale still owes is refused (1.10, 0.3 rule 16).
- **R5** Telegram: the sale review card (2.1) and the new-piece review card (2.3). The round-5 step machine is deleted
  (`hist`, `saleGo`, `saleNext`, `saleBack`'s pop, `SALE_BACK_CLEARS`, the summary step, the committing button of the
  how-much-now screen, the `steps` branches of `Q`/`QN`/`D`) with its tests replaced (10.1); about two thirds of its
  screens are the card's sub-screens. The app's round-5 chat-step glue is deleted too (7.4).
- **R6** `saleFlow(ports)` returns `'form'` or `'quick'`; `steps`, a blank and every other value read `form`.
- **R7** Section 5. One allocation rule (fill in line order, 3.4); every reader change is guarded by
  `basketGroup(info)`: the group has more than one live SALE row AND is not a custom-order delivery (`isOrderId`,
  core_config.js:215; a delivery writes one SALE row per voucher line, core_orders.js:263-272). A multi-line restock
  group is recognised by its rows' types, with the same `isOrderId` exclusion. A one-line group and a delivery render
  byte for byte as today.
- **R8** Section 8: sellers land on 📱; sell, deposit, mixed, price, back, restock, newitem and expense run on the app
  forms; a new `tgsale` tour shows the Telegram review card; SIM.smoke gains the three-item basket with a part payment.
- **R9** Section 0.4.

### 0.2 Scope

| Job | App (form mode) | Telegram (form mode) | quick (both) |
|---|---|---|---|
| sale | sale form (1.3) | review card (2.1) | round 4's one-tap card |
| new piece | new-piece form (1.5) | new-piece card (2.3) | photo, price, cost (core_bot.js:2095-2195) |
| restock | restock form (1.6), from 📦 and from an item card's `R\|` | `R\|` / `RQ\|` as today | as today |
| expense | expense form (1.7), from 💸 and from ☰ `M\|exp` | `ES\|` / `EC\|` / `EA\|` / `EM\|` as today | as today |
| payment, deposit, return, transfer | today's chat flows (a return from a sale that still owes is refused, 1.10) | today's (the same refusal) | today's (the same refusal) |
| custom orders | unchanged | unchanged | unchanged |
| measurement form (revision 3) | one note, the figure to draw on (13.7) | the flow unchanged; the card names a drawing (13.7.2) | as form mode |
| buyers, receipt, history (revision 3) | app pages: 13.6, 13.10, 13.8 (both modes) | today's cards | the app pages too |
| AI, shops (revision 3) | the owner's AI switch and Shops screen in Settings (13.11, 13.12) | obeys the `ai` row; shops from the Sheet | the same |

### 0.3 Where the judges disagreed, and the ruling

1. **A scan while a Telegram review card is live.** Two judges (bookkeeping, buildability) chose design-risk's rule: a
   tag joins the basket only after ➕ (`SS|<a>|add`), so an earlier customer's basket (its state lives up to
   `CFG.STATE_TTL_SEC` 1800 s, core_config.js:11) never absorbs the next customer's piece. Revision 2 (U10): a scan
   without ➕ no longer throws the basket away. It PAUSES the live card (`basketPause`, 4.4): the card's message reads
   `basket_paused` '⏸ ဒီစာရင်း ({n} ခု) ခဏ ရပ်ထားပါသည် · ဆက်ရောင်းရင် ↪️ ဒါမှမဟုတ် ပစ္စည်းကတ်ရဲ့ ➕ ကို နှိပ်ပါ' (NEW)
   with one button `btn_resume` '↪️ ဆက်လုပ်မယ်' (NEW, `SS|<a>|go`), and the scanned tag's item card comes with a
   first row `btn_add_to_list` '➕ စာရင်းထဲ ထည့်' (NEW, `SS|<a>|i|<id>`) when the piece can join. One tap therefore
   adds a piece scanned without ➕. The basket is dropped only when the seller starts another sale (✅ on an item card:
   `basketClose` edits the paused card to `basket_closed` '⏱ ဒီစာရင်း ပိတ်လိုက်ပါပြီ · ဘာမှ မမှတ်ရသေးပါ', reworded
   NEW) or when the state's 1800 s run out.
2. **The AI name inside the app's new-piece form.** Built as design-seller's queue-at-Save, the seller judge's own
   fallback. Measured in this tree (a scratchpad experiment on the app phone and the simulator server, no code
   changed): the server's photo job writes `photoUrl` through `updateItem`, which bumps the item's Rev (gas_sync.js:313
   with `gasStampRev` gas_store.js:93-101; the simulator twin poc/sim_sync.js:185), so any later phone item entry that
   changes a field with the older `baseRev` is flagged `sync_conflict` (core_sync.js:729) and pings the owner
   `ping_conflict` (core_sync.js:129, :746, :1171-1175). A form that pre-fills from a job sent before its Save always
   pushes such an entry. The same experiment showed today's path already raises this false ping when the AI renames
   the placeholder after the job (the Errors row read `sync_conflict S1-0007.name: ပစ္စည်း S1-0007 -> ထမီ ပိုးထည်
   အစိမ်း`); section 6.2 fixes it on the server side, and revision 2 (M1) makes the phone hold the job until its item
   entry has been pushed, which the first draft wrongly took for granted.
3. **Every way into a job in the app opens its form** (seller judge), at one line per entry point: `S|`, `Q|`, `QN|`,
   `D|` on an item card, `R|`, ☰ `M|exp`, a home scan of a sellable or price-pending own-shop tag, a blank tag. In
   Telegram `Q|`, `QN|` and `D|` keep quick's grid and prompts and end on the review card (design-risk's smallest
   change). `K|` (☰ 🕘 / 🔍 / "which item") always shows the item card (`openTag(..., {card: true})`), so ↩️ and 🔁 of an
   in-stock piece stay reachable in the app.
4. **One router** (buildability): an open form takes a tag inside `appOpenTagId`; otherwise `/start <id>` reaches the
   core's `openTag`, which in the app calls ONE generic hook `ports.ui.openForm(kind, req)` (the `measureForm`
   precedent, app_ports.js:179-183, core_bot.js:4183, :4199). No app-side `appScanRoute`.
5. **Lists rows typed inside an app form** (a new account, a new expense category) are written at Save in the same
   commit as the ledger rows, never on an inline ✅ (bookkeeping, buildability). Telegram's in-sale ➕ keeps round 5's
   rule (the row is written at the kind tap, SPEC-round-5 D6).
6. **Line callbacks carry the item id** (`SS|<a>|l|<id>`, `SS|<a>|rm|<id>`), never an index.
7. **A part payment** requires its amount and a promised-day choice; the app outlines both rows the moment 💳 is
   chosen (seller judge), and Save refuses until they are answered (bookkeeping).
8. **Draft lifetimes**: sale, restock and expense 1800 s (`CFG.STATE_TTL_SEC`); the new-piece draft one day.
9. **Save re-reads the mode** (bookkeeping): a sale Save that finds `saleFlow` now `quick` (an older server forced it,
   core_sync.js:1454-1468, or the owner flipped it) is refused with `expired`, so a basket with a DueDay never goes to a
   server that would drop the date.
10. **A refused review-card Save frees its tap guard** (buildability, from design-seller): otherwise the corrected ✅ on
   the same message within 120 s is swallowed (core_bot.js:446-449). Same for the new-piece card's Save.
11. **Not built** (buildability): `ping_basket_note`, `CFG.SOURCE.FORM`, a laptop Items tab, a new sync cap, renaming
   or deleting a tour id. Today the `V|` reply shows `void_done` and the first item's card only (core_bot.js:552-560);
   listing every voided line is the 4.4 change of `case 'U'` / `case 'V'`, which this round builds.
12. **The only ✅ on a sale screen is Save**: the paid-in-full choice reads `btn_paid_full` '💯 အကုန် ပေးပြီး {amount}'
   (NEW; 💯, not 💵, because the method may be a wallet) on the app's segment and on the Telegram paid sub-screen;
   round 5's `btn_paid_all` (core_messages.js:427) stays in MSG unused.
13. **A price-pending own-shop piece scanned from home** opens the sale form with its line flagged ⏳ and its price
   box outlined (the seller types the agreed price); the item card, with the owner's `SP|`, is one tap away (the line's
   name, 1.3) and on ☰ 🕘 / 🔍.
14. **Revision 2: the count is the stepper.** Inside an app form a second read of an id that is already a line never
   changes its count (the camera re-reads a tag left in view, app/app_scan.js:45-53): the line flashes and a toast
   says so (`ui_form_twice` for a stock item, `basket_twice` for a one-of-a-kind piece). Telegram keeps
   `basketAddItem`'s merge (+1) on its add screen, where every scan follows an explicit ➕.
15. **Revision 2: a draft never absorbs another customer's piece.** 🛒 restores the sale draft; a scan or card button
   for an id already in the draft restores it and adds nothing (the line-name round trip); any other id opens a fresh
   basket with only that line, the old lines one tap away (`ui_form_older` + `[ui_form_merge]`).
16. **Revision 2: a return from a sale that still owes is refused** (`ret_credit_open`, 4.4), in both channels and both
   modes, because `T|` would pay cash out of the drawer and leave the credit open. The owner voids the basket (rule 17)
   and sells the kept pieces again, or receives the payment first.
17. **Revision 2: the owner can always reach a basket.** The owner's 🧾 receipt reply of a basket offers
   `btn_void` '🚫 ပယ်ဖျက် (ဆိုင်ရှင်)' (core_messages.js:189); the owner's item card of a piece whose last live sale
   is a basket offers that 🧾. A `stock_negative` ping offers the void only for a one-of-a-kind piece (6.3).

### 0.4 Ground rules (round 5 section 0, still binding)

`apps-script/core_*.js`, `app/app_*.js` and `poc/sim_*.js` are ES5 (`var`, `function`; no let/const, arrows, classes,
template literals, defaults, spread, destructuring, for-of, `Object.assign`, `includes`, `find`, `startsWith`,
`padStart`, `repeat`); one global scope; every new name of sections 4 and 7 was grepped across `apps-script/`, `app/`,
`poc/`, `tools/` (dist excluded) on 2026-11-12 and is free. Load sets: core_ledger.js calls nothing of core_orders.js,
core_sync.js, core_bot.js; core_sync.js nothing of core_orders.js, core_bot.js; core_bot.js calls core_orders.js only
behind `ordersEnabled`/`typeof`. Callback data at most 64 bytes; every committing callback in `MUTATING_ACTIONS`. The
Ledger stays append-only; the script lock through `gasLocked`. No new file under `apps-script/`; four new app files
(`app/app_forms.js`, and since revision 3 `app/app_icons.js`, `app/app_sketch.js`, `app/app_screens.js`), each listed in the
four load lists (7.1, 13.13); `app/index.html` changes in revision 3 (13.3). `app/config.js` and `tools/publish*.js`
untouched. No new
button text contains `ငွေသား`, `KBZPay`, `WavePay` or `ဘဏ်လွှဲ`, and none starts with `🏦 ` (run_lists.js:919-921 for
round 4's keys, run_wizard.js step 23 for round 5's, W32 here for round 6's). A committed card is never edited into a
question; the actionable screen is always the last bot message of a reply. `apps-script/dist/`, `app/dist/`,
`poc/dist/` are build outputs. Existing checks change only where 10.8 names them; every new check fails without its
feature. The forms have Node-testable pure helpers, as the measurement form has (app_ui.js:117-259). Backup of the
tree before this round: `C:\Users\USER\Desktop\Noel-backup\r5-built` (BRIEF.md:3).

---

## 1. The app home and forms

### 1.0 Rules every form follows

- **Mode.** `formsInApp(ports)` (core_bot.js, 4.4) = `saleFlow(ports) === 'form' && !!(ports.ui && ports.ui.openForm)`.
  Everything in this section exists only when it is true. Under `quick` (Settings, or an older server's `quickForced`)
  the app is round 4's: no job tiles, the stepper card, today's chat flows. The per-phone pref `setting:sale_flow`
  (app_store.js:341-344) also wins, but no control writes it (the only `setting:` pref with a control is `text_cards`,
  app_ui.js:888): it is a test hook (run_app.js step 36), never offered to the family (revision 2, m5).
- **One form at a time**: `APP.form`, one of `div#saleForm`, `#newForm`, `#restockForm`, `#expenseForm`, class
  `formpage`, `role=dialog`, `aria-modal=true`, on `document.body`, so it survives every `appRender`
  (app_ui.js:373-389). `APP.screen` stays `'home'` (the simulator's pre-step never closes it). Opening a form closes
  another one and `#measForm`, calls `appCloseOverlay()`, `appStopScanner()` and `clearState(ports, uid)` (as
  `startMeasureFor` does before its hook, core_bot.js:4199).
- **Android back** (revision 2, U15; revision 3 makes it the app's one navigation stack, 13.4): `appOpenForm` pushes a
  `form` layer (`appNavPush`; the history entry carries its depth, `{salestag: n}`, inside a try/catch; the simulator's
  frame and the dev page run with `noHistory`), and the `popstate` listener `appOnPop` closes every layer above the
  depth it landed on, the form with `appCloseForm({ask: true, pop: true})`; when the seller stays, the form's entry is
  pushed again. A Save replaces the form layer by the `card` layer of the reply card (`appNavReplace`, no history
  call); another close that did not come from back (a mode close) drops the layer with `appNavDrop('form')`, whose walk
  back is recognised by `APP.navBusy` and never counted, so one back press never leaves the app with a form open
  (revision 3 review, UX-B1). (Revision 2's `appOnFormPop`, `F.hist` and `APP.formPopIgnore` are not built.)
- **Layout**: `.fcol` (max 900 px, app.css:172), `.fhead` with the icon-only back ← (`data-f="close"`, `aria-label`
  `ui_aria_back`, revision 3, F6) at the left and the title (plain, 13.1), the sections of the form, then the fixed
  `.fbar` (app.css:190) with the running line, `.fmsg` (app.css:193) and ONE green Save reading 'Save' (`ui_w_save`,
  revision 3, F8; revision 2 had `btn_save` '✅ သိမ်း', core_messages.js:344, which Telegram keeps). There is no ✖️ ပိတ်
  any more. Every tap target is at least 56 px
  (`--tap`, app.css:16). The bar's height changes (a running line, a refusal in `.fmsg`), so the form's bottom padding
  follows it: after each repaint `appFormRegion(F, 'bar')` sets `F.el`'s `--fbar-h` to the bar's `offsetHeight` and the
  form's `.fcol` pads by `calc(var(--fbar-h, 110px) + 16px)` (7.6), so the last row (the promised day, where Save
  refuses most) is never under the bar.
- **Numbers have one entry style**: a price, an amount, a count or a cost is a `.fnum` button that looks like an input
  and opens the app's 64 px keypad with `000` (`appOpenNumberKeypad`, app_ui.js:940-970). The keypad appends each key
  to `spec.initial` (app_ui.js:942, :952), so every `.fnum` opens it EMPTY (`initial: 0`, as the chat prompts do,
  app_ui.js:789; never the stepper's `initial: APP.qty.n`, :721) and shows the current value in its title instead:
  '{label} · {current}' (for example '💬 စျေးလျှော့ · 18,000'); typing 1, 5, 000 then gives 15,000, never 1,800,015,000.
  Where a field has an upper bound the keypad gets it as `max`: paid now the total, the transfer part the paid-now
  amount, a count `CFG.MAX_SALE_QTY` 999 (`spec.max` caps the digits, app_ui.js:953). Its OK is disabled at 0
  (app_ui.js:960), so where 0 is a valid answer (paid now) a `0` chip is offered. The overlay
  draws above a form: `.overlay` z-index 30 becomes **34** (app.css:136; above `.formpage` 32, app.css:171, and `.fbar`
  33, :190; below `.rec` 35, :166, and `.toast` 40, :77). Names, phones, the buyer search and notes are native inputs
  (the phone with `inputmode=tel`).
- **Progressive disclosure**: a section shows only what the current choice needs; every reveal rule is a pure function
  of the form's values (`appSaleView`, `appNewItemView`, `appRestockView`, `appExpenseView`, 7.2), so the screen and the
  Node checks agree.
- **A row the seller must still answer is outlined** (`.fneed`) the moment it appears, with its question as its label
  (paid now, the promised day, the buyer of a part payment). A row Save refused gets `.fbad`.
- **Save**: the tap sets `F.saving`, disables Save and shows `ui_form_saving` '⏳ သိမ်းနေသည်…' (NEW). The pure save
  runs; it returns `{ok: false, reason: 'busy'}` by itself while `F.saving` is set (a double tap is refused in pure
  code). A refusal re-enables Save, writes the first problem's text into `.fmsg`, outlines its field (`.fbad`) and
  scrolls it into view (no toast). Accepted: `appFormCommit` (`phone.commit(kind)`, then `sync.scheduleSync()`), and
  only after it resolves does the form close and the home show the core's reply card (`APP.showScanner = false`) under
  the compact job row (1.1). The measurement form closes before its commit resolves (app_ui.js:1146-1150); the forms
  do not. If the commit resolves `false` the form closes anyway: the rows are in memory, the next commit retries, and
  `appOnChange` toasts `ui_not_saved` '⚠️ ဖုန်းထဲ မသိမ်းနိုင်ပါ · ထပ်ကြိုးစားပါမည်' (app_i18n.js:58, app_ui.js:364).
  A second Save is never offered (it would write twice). The pure save runs inside a try/catch (revision 2, U18): a
  throw (the core outside `processUpdate`'s catch, core_bot.js:45-56) is logged (`ports.logError('form', err)`),
  clears `F.saving`, re-enables Save and shows `expired` in `.fmsg`; a Customers or Lists row written just before the
  throw stays (a harmless orphan, the window round 5 accepted), because the rows are written only after the checks
  passed and immediately before the ledger write (3.9).
- **Draft**: every change is kept in the persisted cache under `formdraft:<kind>:<key>` (`cachePut`), with TTL
  `CFG.STATE_TTL_SEC` 1800 s for `sale`, `restock` and `expense` (key = the staff id) and 86400 s for `newitem` (key =
  the item id), and made durable by a debounced `phone.commit('formdraft')` (`APP_FORM_DRAFT_MS` 400), a change kind
  `appOnChange` ignores as it ignores `measdraft` (app_ui.js:354-357). A draft survives an app kill, so how it comes
  back decides whether a stale basket can absorb the next customer's piece (revision 2, U3; 0.3 rule 15):
  - opened with no item (🛒 ရောင်းမယ်, 📦 ကုန်ရောက်, 💸 ကုန်ကျ, the same tag's new-piece form): the draft is restored
    with the strip `ui_form_restored` '📋 မသိမ်းရသေးသော စာရင်း ပြန်ပေါ်လာပါပြီ' (NEW) and `[ui_form_clear '🔄 အသစ်']`
    (NEW, `restored:clear`: an empty form);
  - opened with an item that is ALREADY a line of the draft (the line-name round trip of 1.3, a second tap on the same
    card button, the same piece scanned again from home): the draft is restored and nothing is added or counted;
  - opened with any other item (the next customer's scan, a card button): a FRESH form with only that line; the old
    lines ride along in `values.older` and the strip reads `ui_form_older` '📋 မသိမ်းရသေးသော စာရင်း {n} ခု ရှိပါသည်'
    (NEW) with `[ui_form_merge '📋 ပြန်ထည့်']` (NEW, `restored:merge`: the old lines first, then this one, each id
    once). `older` is dropped by Save, ✖️ and 🔄; one Save tap never sells the old lines unseen.
  A restored line whose one-of-a-kind piece was sold meanwhile is dropped with the toast `basket_gone`. 🔄 on a form
  opened with an item keeps that item's line.
- **Close**: ← (or the phone's back, revision 3, 13.4) on a form the seller changed asks `ui_meas_close_ask`
  'ရိုက်ထားတာတွေ မသိမ်းဘဲ ပိတ်မလား?' (app_i18n.js:149); yes drops the draft and an unsaved photo (`store.removeMedia`, app_store.js:646-652). A form opened
  by a scan or a card button and not changed since closes without asking, so a price check costs one tap. A close
  without Save returns the home to the layer below: its card state when a `card` layer is below (a form opened from an
  item card, revision 3, 13.4), else its scanner state (`APP.showScanner = true`; the camera restarts when the pref
  `cameraOk` is set). A close after Save (`appCloseForm({saved: true})`) never restarts the home camera: the home
  shows the reply card (revision 2, U17).
- **Scanning inside a form** (sale, restock, and the new-piece form until its tag is read): a `.scanstrip` (16:9, at
  most 30 vh) at the top holds the app's ONE scanner video: `APP.videoEl` (app_ui.js:509-512) is moved into the strip,
  and `appRenderHome` draws no scanner panel while a form is open.
  - **Who owns the camera** (revision 2, U1). Today every `appRender()` ends by stopping the scanner whenever
    `APP.showScanner` is false (app_ui.js:388), `appOpenTagId` sets it false before `/start` (:563-567), a delivered
    update sets it false (:358) and `appStartScanner` refuses without it (:532-533) and repaints twice (:538, :551).
    A form-owned camera would die the moment it starts. So ONE predicate decides: `appScannerWanted()` =
    `APP.form ? !!APP.form.scan : (APP.screen === 'home' && APP.showScanner)`. :388 stops the scanner only when it
    is false; `appStartScanner` returns when it is false (and while `APP.measForm`); visibility restarts the scanner
    only when it is true; :358 leaves `showScanner` alone while a form is open.
  - **The strip shows the scanner's state**. `appFormStrip(F)` builds `F.stripEl` ONCE (a `div.scan.scanstrip` holding
    `APP.videoEl`) and `appFormStripState(F)` redraws only its non-video children with `appScannerPanel`'s states
    and labels (app_ui.js:513-530: 'starting', running with 🔦 and ✖️, `ui_camera_denied` / `ui_camera_none` /
    `ui_camera_error`, the start button) and its iOS replay rule (:522). `appRender()` ends with
    `if (APP.form) appFormStripState(APP.form)`, so every scanner state change (they all call `appRender`, :538, :543,
    :547, :551) repaints the strip. The strip node is never rebuilt by a repaint (the video is not re-parented, U5).
  - `appFormScanStart(F)` sets `F.scan`, sets `APP.scanner.holdMs = APP_FORM_SAME_TAG_MS` (8000) and calls
    `appStartScanner()`; `appFormScanStop(F)` clears both and stops it. The scanner stops itself after each read
    (app/app_scan.js:45-53); `appFormTag` restarts it after `APP_FORM_RESCAN_MS` 700 ms, for a sale or restock form
    and a new-piece form still without its tag only (an accepted blank tag sets `F.scan = false` and stops it, U16).
  - **A tag left in view** (revision 2, U2). The scanner ignores the same text for 2 s only (app_scan.js:45-47) and
    buzzes on each read (:50), so a tag under the camera is read again every ~2.7 s. `holdMs` (a new option of
    `createAppScanner`, 7.1) makes a repeat of the last text inside the window refresh the window and be dropped
    silently (no buzz, no stop), so a tag held in view is read once. Whatever the camera does, an id that is already a
    line never changes its count (0.3 rule 14).
  - Under the strip, `[ui_btn_keypad '⌨️ နံပါတ် ရိုက်မယ်']` (app_i18n.js:31) opens the tag keypad (app_ui.js:910-938),
    whose result goes through `appOpenTagId` like a scan; at 700 px and wider a text box with the placeholder
    `ui_keypad_title` '🔢 Tag နံပါတ်' (app_i18n.js:32) takes a typed id or a USB scanner's line (Enter;
    `appParseTagLink`, app_scan.js:13-21). The sale and restock forms also have a 🔍 row (`find`, 1.3). An accepted
    read flashes its line; a refused read is a toast (the seller is looking at the tag, not at the bar).
- **Repaints never fight the keyboard** (revision 2, U5). A text input (`buyer`, `name`, `phone`, `acctname`,
  `catname`, `note`, `find`, the new piece's `name`) writes `values` on `input` without a repaint and redraws only its
  dependent region through `appFormRegion(F, region)`: the buyer chips and the known-phone chip, the new buyer's phone
  label, the find results, the bar. A full `appFormRepaint` replaces the children of `F.body` (every section between
  the strip and the bar) and never touches `F.stripEl`. The sync repaint (`phone.on('sync')`, 7.4) is skipped while
  `APP.doc.activeElement` is an input inside `F.el`; it sets `F.stale` and the repaint runs on that input's `blur`. A
  Burmese IME composition is never ended by a repaint (`compositionstart` sets `F.composing`; no region redraw runs
  until `compositionend`).
- **Labels** go through `APP.tt` (`t()`) only, which since revision 3 returns them plain (`appPlain`, 13.1: no leading
  emoji; the tables below keep each key's MSG text, the app shows it without its emoji); a few controls carry an icon
  (13.2: remove = `trash`, add = `plus`, pick a date = `calendar`, photo = `camera`, search = `search`); every input has
  an `aria-label`; every control carries `data-f="<name>"` (7.8) and the class `hot` when `APP.win.SIM_HOT === 'f:' +
  <name>`, drawn by the form's own renderer.

### 1.1 The seller's home (form mode)

Phone width (`#app` max 600 px, app.css:57), scanner state, top to bottom:

```
header (revision 3, 13.3): ဆိုင် ၁ (ရန်ကုန်) · [sync icon] · [gear icon]      no back button on the home's scanner state
[banner, when there is one (unchanged)]
┌ .jobs 2 × 2, 64 px ───────────────────────────┐
│ 🛒 ရောင်းမယ်            │ 🆕 ပစ္စည်းအသစ်          │   the only emojis of the app besides the ☰ menu (13.1)
│ 📦 ကုန်ရောက်            │ 💸 ကုန်ကျ               │
└───────────────────────────────────────────────┘
scanner panel (appScannerPanel, app_ui.js:507-531; its square capped at 40vh under the job grid, 7.6; torch and stop as icons)
Tag ကို Scan လုပ်ရင် ရောင်းမည့် စာရင်း ပွင့်ပါမည်          (muted, small; ui_home_scan_hint plain)
[(keyboard) နံပါတ် ရိုက်မယ်]
မကြာသေးမီ · six tiles (appRecentPanel / appTiles, app_ui.js:570-590)
[ ပစ္စည်း အမည် ရိုက်ပါ (search field) ] [(search)]    appFindPanel, app_ui.js:591-609
[(history) မှတ်တမ်း]                                ui_history plain, the handle of app_ui.js:494: opens the history page (13.8)
bottom bar (revision 3, 13.3): [(scan) Scan] · [(menu) Menu]   (🎤 only with AI on and Settings app_voice, 13.11)
```

| Element | `data-f` | Label (file:line) | Tap does |
|---|---|---|---|
| sell tile | `job:sell` | `ui_home_sell` '🛒 ရောင်းမယ်' (NEW) | the sale form, empty, its camera running |
| new-piece tile | `job:new` | `ui_home_new` '🆕 ပစ္စည်းအသစ်' (NEW) | the new-piece form waiting for a blank tag |
| restock tile | `job:restock` | `btn_restock` '📦 ကုန်ရောက်' (core_messages.js:24) | the restock form, its camera running |
| expense tile | `job:expense` | `btn_expense` '💸 ကုန်ကျ' (core_messages.js:160) | the expense form |
| hint | — | `ui_home_scan_hint` 'ℹ️ Tag ကို Scan လုပ်ရင် ရောင်းမည့် စာရင်း ပွင့်ပါမည်' (NEW; shown plain; revision 3 uses F8's 'Scan', UX-m5) | — |
| scanner, keypad, recent tile, find result | — | as today (labels plain, icons per 13.1) | the scan router (1.2) |
| Menu | — | `ui_w_menu` 'Menu' with the `menu-2` icon (revision 3) | the core's menu (core_bot.js:131-153; revision 3 adds 📦 in form mode and gates 📒 by the AI switch, 13.11) |

- **Card state** (after a Save, or any bot card): ONE compact row of 56 px (`.jobs.compact`, revision 2, U22): 🛒
  with its label `ui_home_sell` over two columns, then 🆕, 📦 and 💸 as emoji only, each carrying its label as
  `aria-label` (four labels at 20 px do not fit in about 76 px each); then the latest card large as today (since revision
  3 an item, sold, today or `group` card is drawn as a clean list, 13.9), and the handle row, now `[(history) မှတ်တမ်း]`
  alone (app_ui.js:500-504; the smoke presses `button.handle`, poc/sim_ui.js:1416). Revision 3's review (UX-M9) deletes
  today's `[📸 ဓာတ်ပုံ]` handle (:503): with no state waiting, a photo taken there silently replaced the photo of the last
  scanned piece (core_bot.js:2103-2108), whatever card was showing; the new-piece form keeps its Photo. The header shows
  ← in this state (a `card` layer, kept by `appRender`'s card rule after a scan, a form's Save or a menu tap alike,
  13.4): back returns to the scanner. 🛒 there opens the sale form with its camera running: the next
  sale is one tap, without finding Scan first.
- An item card in the app keeps its buttons and its stepper (app_ui.js:690-692, :716-735); in form mode its `S|`, `Q|`,
  `QN|`, `D|` and `R|` open the forms (4.4) instead of writing.
- Laptop width: the column stays centred at 600 px; a form opens at its own 900 px width in two columns (`.fsplit`, at
  700 px and wider).
- Under `quick` or without the hook: today's home exactly.

### 1.2 The scan router

The camera, the tag keypad, a recent tile, a find result and the simulator's `{op: 'open'}` all end in `appOpenTagId`
(app_ui.js:563-568).

1. **A form is open**: `appOpenTagId(id)` hands the id to `appFormTag(APP.form, id)`; the core is not called.

   | Open form | Accepted | Refused (toast, form kept) |
   |---|---|---|
   | sale | a new id: `basketAddItem` (4.2), a new line at the end. An id already a line: nothing changes and the line flashes (0.3 rule 14) | `ui_form_twice` 'ℹ️ {id} ထည့်ပြီးသားပါ · အရေအတွက် တိုးရင် + ကို နှိပ်ပါ' (NEW, a stock item already a line), `basket_twice` (a one-of-a-kind piece already a line), `tag_not_found` (:8), `basket_blank`, `basket_other_shop`, `basket_gone`, `basket_max` |
   | restock | a new id: `basketAddItem(..., {restock: true})`, a new line. An id already a line: nothing changes | `ui_form_twice`, `tag_not_found`, `basket_blank`, `basket_unique`, `basket_other_shop`, `restock_max` (NEW) |
   | new piece, tag not yet read | a BLANK tag of the seller's shop (the owner: either shop) becomes the form's tag | `tag_not_blank` '❓ {id} က အသစ် Tag မဟုတ်ပါ။ အသစ် Tag ကို scan လုပ်ပါ။' (:322), `tag_not_found`, `basket_other_shop` (a seller's blank tag of the other shop, revision 2, m7) |
   | new piece with its tag, expense | — | `ui_form_no_scan` '✖️ ဒီစာမျက်နှာ ပိတ်ပြီးမှ Tag ဖတ်ပါ' (NEW). A new-piece Save refused `not_blank` clears the tag (U13), so the form is back in the row above |

2. **No form open**: today's path (`phone.sim.start(id)` sends `/start <id>`, so the simulator's `scanned(id)` still
   holds, poc/sim_tours.js:50-52), then the core's `openTag` (core_bot.js:105-129, called from `/start` at :92), changed
   as 4.4 says:

   | Scanned | Telegram (form mode) | App (`formsInApp`) |
   |---|---|---|
   | unknown | `tag_not_found` (as today, :107) | the same |
   | a BLANK tag of the seller's shop (the owner: either shop) | `new_tag` and the state `new_item` (as today, :122-124) | `openForm('newitem', {itemId})` |
   | a BLANK tag of the other shop, scanned by a seller (revision 2, m7) | form mode: `basket_other_shop`, no state (quick: today's `new_tag`, section 12) | the toast `basket_other_shop`, no form |
   | own shop (the owner: either shop), sellable: `basketAddItem(ports, staff, [], id, 1).ok` (a stock item, a one-of-a-kind piece in stock, a price-pending piece) | the item card (as today) | `openForm('sale', {itemId, qty: 1})` |
   | a one-of-a-kind piece already sold | the item card with `card_buyer` | the same |
   | another shop's tag scanned by a seller | the item card | the same (its `S\|` answers `basket_other_shop`, 4.4) |
   | any tag while the Telegram card waits at its ➕ screen | the tag joins the basket (2.1) | — |
   | any other tag while a Telegram basket card is live | the card pauses and the item card offers `➕ စာရင်းထဲ ထည့်` (`basketPause`, 2.2) | — |

3. **`K|`** (☰ 🕘 မကြာသေးမီ, 🔍 ရှာ and the "which item" list, `showChoices` core_bot.js:1033-1036) calls
   `openTag(..., {card: true})` and always shows the item card, in both channels. That is how a seller reaches
   `btn_return` '↩️ ပြန်အမ်း' and `btn_transfer` '🔁 {shop} သို့' (core_messages.js:25-26) on an in-stock piece. Inside
   the sale form a line's name does the same (1.3).

### 1.3 The sale form `#saleForm` (R2)

Opened by: a home scan of a sellable own-shop tag (with that line); 🛒 (empty, camera on); in the app's chat an item
card's `S|<id>|<n>` (the stepper or ✅, with that count), `Q|<id>` and `QN|<id>` (count 1), `D|<id>` (count 1, the
line's price keypad opens at once). A sale draft younger than 1800 s comes back by the draft rule of 1.0 (revision 2,
U3): 🛒 restores it; an opener whose item is already a line restores it and adds nothing; any other opener starts a
fresh basket with that line and offers the old lines through `ui_form_older` / `[ui_form_merge]`.

Phone width, the part-payment state of a three-line basket on the fresh seed (the amount is answered, the promised day
is still outlined; `docs/design-round-6/mockup.html` draws this screen, the home, the new-piece form, the sold card,
the Telegram card and, since revision 2, the paused Telegram card, all at the app's real sizes):

```
┌ .fhead: [←]  ရောင်းမယ်                                               ┐   revision 3: ← at the left, no ✖️, plain title
[မသိမ်းရသေးသော စာရင်း ပြန်ပေါ်လာပါပြီ          [အသစ်]]   (🛒 with a draft only)
[မသိမ်းရသေးသော စာရင်း ၂ ခု ရှိပါသည်          [ပြန်ထည့်]]   (instead: a scan with a draft of other lines)
┌ .scanstrip (16:9) · (bulb) · (x) ┐        the scanner's own states: starting, Scan, camera denied (plain)
[(keyboard) နံပါတ် ရိုက်မယ်]       (≥ 700 px also: [Tag နံပါတ် ________ ])
[ ပစ္စည်း အမည် ရိုက်ပါ ______ ] [(search)]    a torn tag: the matches come as tiles under it
မကြာသေးမီ [tile][tile]          one row: own shop, not sold, not in the basket (two tiles at phone width)
┌ .fline ─────────────────────────────────────────────────────────┐
│ S1-0002 · လုံချည် ကချင် အပြာ                            [(trash)] │  the name opens the item card
│ [ 18,000 ကျပ် ]                                         36,000  │  row 2: the price box and the amount
│ [−]  ၂  [+]                        လက်ကျန် ၅                     │  row 3: a 56 px stepper and the stock
├ .fline ─────────────────────────────────────────────────────────┤
│ S1-0005 · ထမီ ဇင်းမယ် အဝါ                               [(trash)] │
│ [ 22,000 ကျပ် ]                                         22,000  │
│ [−]  ၁  [+]                        လက်ကျန် ၂                     │
├ .fline ─────────────────────────────────────────────────────────┤
│ S1-0001 · ထမီ ချည်သား အနီ                               [(trash)] │
│ [ 25,000 ကျပ် ]                                         25,000  │
│ ၁ ထည်တည်း                                                        │
└─────────────────────────────────────────────────────────────────┘
── ဝယ်သူ ───────────────────────────────────────────────────────────
(ဒေါ်မြင့် · +95 912 345 678   (x))                             the picked buyer
── ဘယ်လိုပေးလဲ? ────────────────────────────────────────────────────
[ငွေသား] [KBZPay] [WavePay]                                     .seg, wraps (7.6)
[ဘဏ်] [ခွဲပေး] [(plus) ဘဏ်အသစ်]
[အကုန် ပေးပြီး 83,000] [မကျေသေး]                                 .seg
  ယခု ပေးငွေ  [ 30,000 ]   (0) (တစ်ဝက် 41,500)               (outlined until answered)
┌ .fneed  ကျန် 53,000 ကျပ် · ဘယ်တော့ ပေးလဲ?                     ┐
│ [၇ ရက်] [၁၄ ရက်] [၃၀ ရက်]                                       │
│ [(calendar) ရက်စွဲ ရွေးပါ] [မသေချာ]                              │
╞ .fbar  [စုစုပေါင်း 83,000] [ပေးပြီး 30,000] [ကျန် 53,000]   three label/value cells (.fsum; revision 3, UX-M8)
│ [.fmsg]
╘ [ Save ]                                    the form pads by the bar's measured height (1.0)
```
(Revision 3, F7/F8: every label is its key's text through `appPlain`; the table below keeps the MSG texts, which Telegram
shows as they are. The line's leading category emoji of revision 2 is dropped in the app.)

| Field | Control (`data-f`) | Default | Shown when | Labels (file:line) | Rule |
|---|---|---|---|---|---|
| line | `.fline` per item in the order added | from the scan or the opener | always | '{id} · {name}' (revision 3: no category emoji, as the tiles, 13.1; the id in `--mono`), `sample_mark` ' (နမူနာ)' (:13); the name is a button `line:<id>` with the aria-label `ui_line_card` 'ℹ️ ပစ္စည်းကတ်' (NEW) | the name opens the item card: `appFormLineCard` closes the form keeping its draft (no question; 🛒 brings it back within 1800 s) and the core shows the card through `openTag(..., {card: true})` |
| remove | 🗑 (`remove:<id>`) | — | every line | aria-label `btn_remove_line` '🗑 ဖယ်' (NEW) | no question |
| find | `<input type=search>` (`find`) + 🔍 (`find:go`); result tiles `found:<id>` | empty | always (revision 2, U25) | placeholder `ui_find_placeholder` '🔍 ပစ္စည်း အမည် ရိုက်ပါ' (app_i18n.js:42); none: the toast `ui_find_none` (:43) | `findItemsByName(ports, shop, text)` (core_ledger.js:1684), the basket's shop only, eight at most, as tiles; a tile goes through `appFormTag` like a scan (a torn tag that is not in the recent row) |
| price | `.fnum` (`price:<id>`) | the item's price **when the line was added** (pinned: what the seller saw is what is written) | always, row 2 of the line with the amount | amount + ' ကျပ်'; a price-pending piece shows `btn_pending` '⏳ စျေး မသတ်မှတ်ရသေး' (:48) in the warn colour, outlined `.fneed` | the keypad opens empty (1.0), titled `btn_discount` '💬 စျေးလျှော့' (:22) + ' · ' + the current price, or for a pending line `ask_sale_price` '💬 ဘယ်စျေးနဲ့ ရောင်းလဲ? ဂဏန်း ရိုက်ပါ (ဥပမာ 18000)' (:82, revision 2, U21b); a changed price shows the old one struck through and sets `priceChanged`; at least 1; more than 10 × the item's price adds the warn line `ui_price_far` '⚠️ {price} ကျပ် · ပစ္စည်းစျေး {list} ကျပ်ရဲ့ ၁၀ ဆ ကျော်နေပါသည်' (NEW), never a refusal (U4) |
| count | `.stepper` (`qty-:<id>`, `qty:<id>`, `qty+:<id>`), 56 px keys, row 3 of the line | 1 | a stock item (SKU) | `ui_keypad_qty` '🔢 အရေအတွက်' (app_i18n.js:33) for the keypad | 1..`CFG.MAX_SALE_QTY` 999 (core_config.js:108); the stepper is the ONLY way to change it (0.3 rule 14) |
| one of a kind | text | — | a UNIQUE piece | `ui_line_one` '၁ ထည်တည်း' (NEW) | the count is 1, no stepper |
| stock | muted text beside the stepper | — | every SKU line | `ui_line_stock` '📦 လက်ကျန် {stock}' (NEW; the word of `card` :10) | the stock before this sale |
| over stock | warn line | — | count > stock | `ui_stock_over` '⚠️ လက်ကျန် {stock} ထည်သာ ရှိပါသည်' (NEW) | a warning, never a refusal. The server flags the row (core_sync.js:806-810); for a stock item the owner's ping is information only, `ping_stock_short` with no void button (revision 2, M2; 6.3), so one miscounted line never leads to a void of the whole basket and its bank part |
| buyer search | `<input type=search>` (`buyer`) | empty = no buyer | no buyer picked | section label `btn_customer` '👤 ဝယ်သူ' (:140); placeholder `cust_find` '🔍 နာမည် ဒါမှမဟုတ် ဖုန်းနံပါတ် ရိုက်ပါ' (:150) | typing lists `findCustomers` (core_ledger.js:1446-1470; four or more digits search phones) as chips, six at most (a region redraw, never a repaint, 1.0). Text left in the search without a pick at Save (revision 2, U8): when no customer matches it, it is a new buyer, split as `buyer:new` splits it (a digits-only text has no name: Save refuses with `ask_name` on the name input); when any customer matches, Save refuses `buyer_pick` with `ui_buyer_pick_first` '👤 စာရင်းထဲက ဝယ်သူကို နှိပ်ပါ · ဒါမှမဟုတ် ✏️ နာမည်အသစ်' (NEW), the search row `.fbad` and the matches shown |
| buyer chips | `.bchip` (`buyer:<customerId>`, `buyer:new`) | `recentCustomers(ports, shop, 3)` (core_ledger.js:1398-1413) + ✏️ | no buyer picked | `customerLabel` (core_bot.js:1590-1592); `btn_new_customer` '✏️ နာမည်အသစ်' (:45) | a picked buyer replaces the search and the chips by one chip '👤 ဒေါ်မြင့် · +95 912 345 678' with ✖️ (`buyer:clear`) |
| new buyer | two inputs (`name`, `phone` with `inputmode=tel`) | the typed search text: digits and phone punctuation go to the phone, anything else to the name (digits are never a name, SPEC-round-5 rev 2) | after ✏️ | `ask_name` '✏️ နာမည် ရိုက်ပေးပါ' (:80); `ask_phone` '📱 {customer} ၏ ဖုန်းနံပါတ် (Viber) ရိုက်ပါ' (:146) with the typed name | the app never changes the buyer silently (revision 2, U9). A phone that customers already have shows each as a tappable chip `ui_buyer_known_phone` '📱 ဒီဖုန်းက {customer} ပါ' (NEW, `buyer:<id>`: use that customer); Save refuses `known_phone` (the same text, the phone input `.fbad`) until the seller taps it or changes the phone. A name that `matchCustomers` (core_ledger.js:1471-1475) finds exactly shows that customer as a chip under `ui_buyer_same_name` '👤 ဒီနာမည်နဲ့ ဝယ်သူ ရှိပြီးသားပါ · ဒီလူလား?' (NEW) next to `btn_create_named` '✏️ "{name}" အသစ် ဖန်တီး' (:144, `buyer:create`, sets `forceNew`); Save refuses `same_name` until one is tapped. 1-6 digits are refused at Save (`basket_bad_phone`); the Customers row is written at Save only |
| how paid | `.seg` (`pay:CASH`, `pay:<KEY>`, `pay:wallets`, `pay:bank`, `pay:mix`, `pay:add`), wrapping | 💵 cash | always | `sale_ask_method` '💰 ဘယ်လိုပေးလဲ?' (:432); `btn_cash` '💵 ငွေသား' (:132); `btn_wallet` '📲 {method}' (:425) per wallet of `payMethodsByKind(ports, shop)` (core_ledger.js:138-148) while the row holds six choices at most, else ONE `btn_kind_wallet` '📲 Pay အကောင့်' (:429, `pay:wallets`, which reveals the wallets as the account row), Telegram's rule (core_bot.js:2621-2628); `btn_bank_transfer` '🏛 ဘဏ်' (:426) when a bank-kind account exists; `btn_split` '💵+🏦 ခွဲပေး' (:376) when a non-cash account exists and the total is at least 2; `btn_add_bank` '➕ ဘဏ်အသစ်' (:385, `pay:add`) ALWAYS last (revision 2, U7: a cash-only shop or an unlisted wallet can add one, as Telegram's method screen does, core_bot.js:2632) | the basket's shop's accounts (the first line's shop) |
| account | `.seg` (`acct:<KEY>`, `acct:add`) | the only one, when the list has one | 🏛, 💵+🏦 or 📲 Pay အကောင့် chosen | `sale_ask_account` '🏛 ဘယ်အကောင့်လဲ?' (:433) or `sale_ask_split_account` '💵+🏦 ဘယ်အကောင့်နဲ့ ခွဲပေးလဲ?' (:434); `btn_bank` '🏦 {method}' (:131), `btn_wallet`; `btn_add_bank` '➕ ဘဏ်အသစ်' (:385) as the last choice of the revealed list | 🏛 lists the banks, 📲 the wallets, 💵+🏦 every non-cash account |
| new account | input (`acctname`) + `.seg` (`acctkind:wallet`, `acctkind:bank`) | — | after `pay:add` or `acct:add` | placeholder `add_ask_pm` '✏️ ဘဏ်/အကောင့် နာမည် ရိုက်ပါ (ဥပမာ KBZ ဦးမောင်)' (:388); `btn_kind_wallet` '📲 Pay အကောင့်', `btn_kind_bank` '🏛 ဘဏ်အကောင့်' (:429-430) | the new key becomes the method (after `pay:add`) or the mixed account (after `acct:add` under 💵+🏦); the Lists row is written at Save, in the same commit as the sale (3.9); an existing label is used as it is |
| transfer part | `.fnum` (`transfer`) + chip `btn_half` 'တစ်ဝက် {amount}' (:254) (`transfer:half`) | empty, outlined | 💵+🏦 with an account | `ui_transfer_part` '💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ?' (NEW); live line `sale_line_mixed` '💰 {cashMethod} {cash} · {method} {bank}' (:440) | 1..paid now (the keypad's `max`); equal to paid now books everything on the account (outcome 6) |
| paid now | `.seg` (`paid:full`, `paid:part`) | full | always | `btn_paid_full` '💯 အကုန် ပေးပြီး {amount}' (NEW, MSG); `btn_credit` '💳 မကျေသေး' (:41) | full clears the amount and the promised day |
| amount now | `.fnum` (`amount`) + chips `0` (`amount:0`) and `btn_half` (`amount:half`) | empty, outlined | part | `btn_paid_now` '💳 ယခု ပေးငွေ' (NEW) | 0..total − 1 (mixed: at least the transfer part); the keypad's `max` is the total, and an amount equal to the total flips the segment to full |
| buyer needed | hint line, the buyer section outlined | — | part and no buyer | `sale_need_buyer` 'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်' (:438) | Save is refused until a buyer is picked or named |
| promised day | `.seg` (`due:<n>` for each of `saleDuePresets(ports).slice(0, 3)`, core_bot.js:2331-2337; `due:date`; `due:none`), wrapping | none chosen, outlined | part | label `sale_ask_due` '📅 ကျန် {owed} ကျပ် · ဘယ်တော့ ပေးလဲ?' (:436); `btn_days` '{n} ရက်' (:238); `ui_btn_pick_date` '📅 ရက်စွဲ ရွေးပါ' (app_i18n.js:55); `btn_due_unknown` '❓ မသေချာ' (:428) | 📅 opens the date sheet (`appOpenDateSheet(onOk, {max})`, app_ui.js:972-988): its input has `min` today (:975) and, new, `max` today + `CFG.SALE_DUE_MAX_DAYS` 365 (core_config.js:113), so a picked date is never refused with `ord_bad_date`'s "type it like 30.10.26" (revision 2, U21a); the choice then shows as `sale_due_set` '📅 ကျန် {owed} · {date}' (:442) or `sale_due_none` '📅 မသေချာ' (:443); Save is refused while none is chosen |
| running line | `.fbar`, `.fsum` cells | — | always | revision 3 (UX-M8): label/value cells, each a muted label over a `--mono` value: `ui_lbl_total` 'စုစုပေါင်း', and for a part payment `ui_lbl_paid` 'ပေးပြီး' and `ui_lbl_owed` 'ကျန်' (`--warn`); revision 2's `basket_total` 'စုစုပေါင်း {total} ကျပ်' (NEW) and `sale_line_paid` (:441) stay in MSG, unused by the app | `basketTotals` (4.2): the screen and the ledger use one function |
| Save | `.good` (`save`) | disabled while the basket is empty | always | `ui_w_save` 'Save' (revision 3; revision 2 had `btn_save` '✅ သိမ်း', :344) | `appSaleSave` (7.2), which calls the shared `basketCommitDraft` (4.4) |

There is no other ✅ on the screen (0.3 rule 12). The basket's shop is the first line's; for a seller it is
`staff.shop`, the owner may sell either shop but not both in one basket (rule B6, 3.2). The account lists, the recent
buyers and the recent tiles key on it (run_wizard.js step 19 pins this for round 5).

**Laptop width (≥ 700 px)**: `.fsplit` makes two columns. Left: the camera strip, the tag box, the 🔍 row, the recent
row, the lines. Right: buyer, how paid, paid now, the promised day. The bar spans the 900 px column.

### 1.4 After Save: the sold card

`appSaleSave` pushes the core's reply to the phone's own chat (`basketSoldReply`, 4.4, with `msgId` null) and the home
shows it as the big latest card under the compact job row. Revision 3 (F7): in the app that message carries the view
`{kind: 'sold', id: <group>}` and is drawn as the clean list of 13.9 (a table of the lines, then ပေးပြီး / ကျန် / ပေးနည်း /
ဝယ်သူ / ပေးမည့်ရက် one per row, the buttons plain); its ဘောက်ချာ opens the receipt page (13.10). The text below is what
Telegram's review card turns into, and what the core still writes into the message:

```
✅ ရောင်းပြီး 🛍 ၃ ခု · ၄ ထည် · 83,000 ကျပ်                    basket_sold (NEW; starts with sold_done's '✅ ရောင်းပြီး')
S1-0002 · လုံချည် ကချင် အပြာ × ၂ · 36,000 · လက်ကျန် ၃            basket_sold_line (NEW), one per live SALE row
S1-0005 · ထမီ ဇင်းမယ် အဝါ × ၁ · 22,000 · လက်ကျန် ၁
S1-0001 · ထမီ ချည်သား အနီ × ၁ · 25,000 · လက်ကျန် ၀
💳 👤 ဒေါ်မြင့် · ပေးပြီး 30,000 · ကျန် 53,000 ကျပ်              credit_done (:99)
📅 ကျန် 53,000 · ၂၆ နိုဝင်ဘာ ၂၀၂၆                                sale_due_set (:442)
[↩️ မှားသွားတယ်] [🧾 ဘောက်ချာ]                                    btn_undo (:27) U|<g>, btn_receipt (:42) RC|<g>
[💰 ငွေလက်ခံ]                                                     btn_pay (:37) PY|<g>, while owed
```

A one-line basket shows today's sold card byte for byte (`saleCardText`, core_bot.js:3194-3218). A new account created
by this Save adds `acct_detail_hint` (:403) and `[btn_acct_number '🔢 နံပါတ် ထည့်' → LD|pm|<KEY>]` (:399); a buyer
without a phone adds 📱 (`phoneRow`), as round 5's sold card does (`saleCardKeyboard`, core_bot.js:3220-3225). A buyer
who holds a free deposit and still owes gets today's question `credit_use_deposit` '📥 {customer} ၏ စရံ {deposit} ကျပ်
ရှိပါသည်။ သုံးမလား?' (:100) with `btn_use_deposit` / `btn_no_deposit` (`CD|<g>|yes|p`, `CD|<g>|no|p`, :46-47), exactly
`saleCommit`'s tail (core_bot.js:3176-3184); the core's `creditDeposit` answers it (it reads the group's owed, so a basket
works). Undo `U|<g>` mirrors every row of the group within 30 minutes (core_ledger.js:992-1017). After that the owner
voids a basket from its 🧾 receipt (`RC|<g>` answers the owner with `btn_void`, 0.3 rule 17, 4.4); a seller sees no
void button.

### 1.5 The new-piece form `#newForm` (R3)

Opened by a home scan of a blank tag (with that tag), by 🆕 (waiting for a blank tag), or by a restored draft for that
tag.

```
┌ .fhead: [←]  ပစ္စည်းအသစ် · S1-0007                                    ┐   revision 3: ←, plain title
(🆕 only, until a blank tag is read:) .scanstrip · Tag အသစ်ကို Scan လုပ်ပါ · [(keyboard) နံပါတ် ရိုက်မယ်]
┌ .fphoto (4:3) ─────────────────────────────┐
│              [ (camera) Photo ]            │   after the shot: the picture and [(camera) Photo ပြန်ရိုက်]
└────────────────────────────────────────────┘
ပစ္စည်း အမည်  [                                    ]
အမည် မရိုက်ရင် ဓာတ်ပုံကို ကြည့်ပြီး နောက်မှ အမည် ပေးပါမည်          (photo taken, name empty, AI on only: 13.11)
အမျိုးအစား [ထမီ] [လုံချည်] [အင်္ကျီ]                     .toggle, wraps (7.6)
           [ဝတ်စုံ] [အခြား]
အရင်း      [ 12,000 ]
ရောင်းစျေး  [ 25,000 ]   (10,000) (15,000) (22,000) (25,000)       pricePresets for ထမီ on the seed
[စျေး မသတ်မှတ်ရသေး]                                          toggle
အမြတ် 13,000 ကျပ် · အရင်းပေါ် 108%                            .vid (or the warn line when below cost)
အရေအတွက်  [−]  ၁  [+]
၅ ထည် · လက်ကျန်နဲ့ ရောင်းမည့် ပစ္စည်း ဖြစ်ပါမည်                   (count > 1)
[နမူနာ: မဟုတ်]                                                 toggle
╞ .fbar [.fmsg] ╘ [ Save ]
```

| Field | Control (`data-f`) | Default | Shown when | Labels (file:line) | Rule |
|---|---|---|---|---|---|
| tag | `.scanstrip` + keypad (`tag`) | the scanned tag | 🆕 until a blank tag is read | `ui_tag_scan_new` '📷 Tag အသစ်ကို Scan လုပ်ပါ' (NEW; revision 3, UX-m5); title `ui_new_title` '🆕 ပစ္စည်းအသစ် · {id}' (NEW) | BLANK only (`tag_not_blank`), and for a seller of the own shop only (`basket_other_shop`, revision 2, m7); an accepted tag sets `F.scan = false` and stops the scanner (U16). Re-read at Save (another phone may have used it): a Save refused `not_blank` (revision 2, U13) clears the form's tag, shows `tag_not_blank` in `.fmsg` and the strip again, and KEEPS the photo, name, category, cost, price, pending, count and sample; the next blank tag becomes the form's tag and the draft moves to its key (`formdraft:newitem:<new id>`) |
| photo | big button (`photo`) | none | always | revision 3: `ui_w_photo` 'Photo' with the `camera` icon (was `ui_btn_photo` '📸 ဓာတ်ပုံ', app_i18n.js:65); `ui_photo_retake` 'Photo ပြန်ရိုက်' (NEW) | the tap first calls `appFormScanStop(F)` (the strip's camera stream must not hold the camera, map-app-forms 17), then clicks `#photoInput` (app/index.html:38; the phone's own camera, offline). A browser opens it only from a tap, so a scan never opens the camera by itself (one tap more than R3's wording). Optional: a piece may be saved without a photo |
| name | `<input>` (`name`) | empty | always | `ui_form_name` 'ပစ္စည်း အမည်' (NEW); hint `ui_form_name_later` '📸 အမည် မရိုက်ရင် ဓာတ်ပုံကို ကြည့်ပြီး နောက်မှ အမည် ပေးပါမည်' (NEW) while a photo is taken, the name is empty and the AI switch is on (revision 3, 13.11; with AI off no photo job is queued) | empty is saved as `itemPlaceholderName(id)` 'ပစ္စည်း <id>', the one name the AI may replace (6.2) |
| category | `.toggle` (`cat:<i>`, i = 0..4), wrapping | none (saved as 'အခြား', the last of `CFG.CATEGORIES`, core_config.js:23) | always | `btn_item_cat` '🏷 အမျိုးအစား' (NEW); '{emoji} {category}' from `CFG.CATEGORY_EMOJI` (core_config.js:24) | changes the price chips. 'အခြား' is the catch-all: chosen or the fallback, it is the one category the photo AI may replace with its own (revision 2, m4; `aiRenameFields`, 4.2); any other chosen category is never replaced |
| cost | `.fnum` (`cost`) | empty = unknown | always | `btn_item_cost` '🪙 အရင်း' (NEW; 🪙 because 🧵 already means အခြား and the sample on this screen, revision 2, U21d) | a whole number ≥ 1, or unknown (today's ⏭, core_bot.js:2181) |
| price | `.fnum` (`price`) + four chips (`price:<n>`) | empty | always | `btn_item_price` '💰 ရောင်းစျေး' (NEW); chips `pricePresets(ports, category, shop)` (core_ledger.js:1754-1769) | at least 1, or pending |
| pending | toggle (`pending`) | off | always | `btn_pending` '⏳ စျေး မသတ်မှတ်ရသေး' (:48) | on clears and dims the price. Neither a price nor pending: Save asks `ask_price` '💰 စျေး ဘယ်လောက်လဲ?' (:77). Pending at Save pings the owner with `price_ask_owner` '⏳ {id} · {name} · စျေး သတ်မှတ်ပေးပါ' (:193) and the `SP\|` buttons (`priceButtons`, core_bot.js:2197-2200), an outbox notice on the phone (app_ports.js:93-98) |
| profit | `.vid` line | — | price ≥ 1 and cost ≥ 1 | `item_lbl_profit` '📈 အမြတ် {profit} ကျပ် · အရင်းပေါ် {pct}%' (NEW); below cost `item_lbl_loss` '⚠️ ရောင်းစျေးက အရင်းထက် နည်းနေပါသည်' (NEW) | `itemMargin` (4.2): pct = round(profit × 100 / cost), markup on cost, and the label says "on cost" (အရင်းပေါ်); a loss warns, never refuses |
| count | `.stepper` (`count-`, `count`, `count+`) | 1 | always | `ui_keypad_qty` '🔢 အရေအတွက်' (app_i18n.js:33); hint `ui_form_count_sku` 'ℹ️ {n} ထည် · လက်ကျန်နဲ့ ရောင်းမည့် ပစ္စည်း ဖြစ်ပါမည်' (NEW) when above 1 | 1..999; above 1 the piece is a stock item (SKU) with that stock (3.6) |
| sample | toggle (`sample`) | off | always | `btn_sample_off` '🧵 နမူနာ: မဟုတ်' / `btn_sample_on` '🧵 နမူနာ: ဟုတ်' (:49-50) | the RESTOCK note 'new sample' (core_bot.js:2187) |
| Save | `.good` (`save`) | — | always | `ui_w_save` 'Save' (revision 3) | `appNewItemSave` (7.2) |

The spelling ရောင်းစျေး follows MSG (`btn_pending`, `ask_price`, `btn_discount` all write စျေး); the brief's ရောင်းဈေး is
the same word.

**Laptop width**: `.fsplit` left = tag, photo, name, category; right = cost, price, profit, count, sample.

**After Save** the home shows `item_created` '🆕 မှတ်ပြီးပါပြီ' + ' · S1-0007' (:85, as core_bot.js:2190-2191), then the
new piece's card (`sendItemCard(..., {undo: groupId})`): a stock-item card when the count was above 1, `card_pending`
(:12) when the price is pending, and ALWAYS a first row `undoRow` `[↩️ မှားသွားတယ်]` (`btn_undo` :27, `U|<g>`; revision
2, M5). The count is new this round (it was always 1), and nothing else can take a mistyped 30 back to 3: `R|` only adds
(core_bot.js:513-527), the restock form refuses nothing smaller, `CFG.TX.ADJUST` (core_config.js:27) has no writer and
the Items tab holds no stock. Within 30 minutes that undo mirrors the RESTOCK and returns the tag to BLANK
(`unregisterItem`, 4.2), so the seller registers it again; once the piece has another live row (it was sold) the undo
is refused with `undo_new_used` (NEW) and nothing is written (3.6, 4.4).

### 1.6 The restock form `#restockForm` (R4 should)

Opened by 📦 (empty, camera on) and, in the app, by an item card's `R|<id>` (with that line; `cardKeyboard` offers `R|`
on a stock item only, core_bot.js:227-231).

```
┌ .fhead: [←]  ကုန်ရောက်                                              ┐   revision 3
.scanstrip · [(keyboard) နံပါတ် ရိုက်မယ်] · [ ______ ][(search)] · one row of own-shop stock-item tiles
┌ .fline ────────────────────────────────────────────────┐
│ S2-0003 · လုံချည် ပိုး အနက်                       [(trash)] │
│ လက်ကျန် ၁ → ၆                                             │
│ [−]  ၅  [+]        (၁) (၅) (၁၀) (၂၀)                       │
└────────────────────────────────────────────────────────┘
╞ .fbar [.fmsg] ╘ [ Save ]
```
Opened also by 📦 ကုန်ရောက် in the app's ☰ menu (revision 3, F12: `M|restock`, 13.11).

- One line per scanned stock item, count 1. The chips are `CFG.RESTOCK_PRESETS` [1, 5, 10, 20] (core_config.js:20),
  labelled with `myDigits`; each SETS the count (`qtyset:<id>:<n>`). The stock line is `ui_restock_after`
  '📦 လက်ကျန် {now} → {after}' (NEW, the word of `card` :10). The same stock item again: nothing changes and the toast
  `ui_form_twice` says the stepper is the count (0.3 rule 14; revision 2, U2: a re-read never adds stock). One shop per
  form (the first line's; a seller's own). The 🔍 row of 1.3 is here too.
- Refused with a toast: a blank tag `basket_blank`, a one-of-a-kind piece `basket_unique` 'ℹ️ {id} က တစ်ထည်တည်း
  ပစ္စည်းပါ · ကုန်ရောက် မမှတ်နိုင်ပါ' (NEW; it has no `R|` today, core_bot.js:219-224), another shop's tag
  `basket_other_shop`, an unknown tag `tag_not_found`, the eleventh line `restock_max` 'ℹ️ ကုန်ရောက် တစ်ခါမှာ {max} မျိုး
  အထိပါ' (NEW; `basket_max` says "per sale", revision 2, U21c).
- Save: `commitRestockGroup` (4.2): ONE group, one RESTOCK row per line, one clock read, one undo. The reply: one line →
  `<id> · ` + `restock_done` '📦 ကုန်ရောက် {qty} ထည် · လက်ကျန် {stock}' (:53); several → `restock_group_done`
  '📦 ကုန်ရောက် {n} မျိုး · {qty} ထည်' (NEW) and one `group_item_line` '{id} · {name} · လက်ကျန် {stock}' (NEW) per
  line; the keyboard `undoRow` [↩️ မှားသွားတယ်] (core_bot.js:367-369). In the app (revision 3, UX-M8) the reply carries the
  view `{kind: 'group', id: groupId}` and is drawn as a clean list (13.9): a table of the lines, no joined text.

### 1.7 The expense form `#expenseForm` (R4 should)

Opened by 💸 and, in the app, by ☰ `M|exp` (`startExpense`, core_bot.js:1939, calls the hook): one job, one screen.

```
┌ .fhead: [←]  ကုန်ကျ                                                 ┐   revision 3
(owner only) ဘယ်ဆိုင် အတွက်လဲ?  [ဆိုင် ၁ (ရန်ကုန်) | ဆိုင် ၂ (မန္တလေး)]
ဘာ ကုန်ကျစရိတ်လဲ?
[အထည်ဖိုး][ချည်ဖိုး][လက်ခ][ကားခ][ဖုန်းဘေလ်][ထမင်းဖိုး] … [(plus) အမျိုးအစားအသစ်]
{cat} · ဘယ်လောက်လဲ?   [ 20,000 ]   (5,000) (10,000) (20,000) (30,000) (50,000)
ဘယ်လိုပေးလဲ?          [ငွေသား | KBZPay | WavePay | …]
မှတ်ချက်              [ မှတ်ချက် ရိုက်ပါ (ဥပမာ နေ့လယ်စာ ၃ ယောက်) ]
╞ .fbar [.fmsg] ╘ [ Save ]
```
(The expense category emojis of `expenseEmoji`, core_ledger.js:271-295, stay in Telegram; the app's chips are plain.)

| Field | `data-f` | Default | Labels (file:line) | Rule |
|---|---|---|---|---|
| shop (owner only) | `shop:S1`, `shop:S2` | `staff.shop` | `exp_ask_shop` '💸 ဘယ်ဆိုင် အတွက်လဲ?' (:161); `shopName` | a seller: the own shop, no control |
| category | `cat:<key>`, `cat:add` | none | `exp_ask_cat` '💸 ဘာ ကုန်ကျစရိတ်လဲ?' (:162); `expenseCategories(ports, shop)` with `expenseEmoji` (core_ledger.js:271-295); `btn_add_cat` '➕ အမျိုးအစားအသစ်' (:386) reveals an input `catname` with the placeholder `add_ask_ec` (:389) | required; a new category is created at Save (`addListOptionByLabel(ports, 'expense_category', label, staff)`, core_ledger.js:762-786, offline) in the same commit |
| amount | `amount` (`.fnum`), chips `amount:<n>` | empty | `exp_ask_amount` '💸 {cat} · ဘယ်လောက်လဲ?' (:163) as label and keypad title; chips `expensePresets(ports, category)` (core_ledger.js:316-331) | at least 1 (`expenseAmount`'s rule, core_bot.js:2005-2011) |
| how paid | `pay:<KEY>` | 💵 | `sale_ask_method` (:432); `btn_cash`, `btn_wallet` / `btn_bank` for `payMethods(ports, shop)` (core_ledger.js:117) | `methodKnown`; no mixed |
| note | `note` (textarea) | empty | `btn_note` '📝 မှတ်ချက်' (:166); placeholder `exp_ask_note` (:165) | at most 100 characters |

Save: `commitExpense` (core_ledger.js:882-890) with the note in the same EXPENSE row (the chat flow adds it later as a
rewrite, core_bot.js:2050-2062). Reply: `expense_done` '💸 ကုန်ကျစရိတ် {amount} ကျပ် · {cat}{note} · {method}
မှတ်ပြီးပါပြီ' (:55) with `note` = ' · ' + the note (as `attachExpenseNote` formats it, core_bot.js:2057-2058) and
`undoRow(ports, groupId)` (core_bot.js:367-369), as the restock reply. Not `replyKeyboard` (core_bot.js:354-365): for an
EXPENSE it is `moneyKeyboard` with 📝 `EN|` and the 🏦 method rows (:344-351, :362-363), corrective buttons for fields
the form has just asked (revision 2, U20). In the app (revision 3, UX-M8) the reply carries the view `{kind: 'group', id:
groupId}` and is drawn as label/value rows (13.9).

### 1.8 Tap counts (phone, form mode; a "scan" is one camera read and is not counted as a tap)

| Case | App form | Telegram review card (after START) | quick |
|---|---|---|---|
| one piece, cash, paid in full | Save = **1** | ✅ ရောင်း ၁, ✅ သိမ်း = 2 | ✅ = 1 |
| three pieces, cash | 3 scans + Save = 1 | ✅, then 2 × (➕, scan, START), ✅ သိမ်း = 6 (a scan without ➕: START, then `➕ စာရင်းထဲ ထည့်` on the item card, the same count) | three sales |
| a stock item × 2 | +, Save = 2 | ✅, the line, ၂, ✅ သိမ်း = 4 | 🔢, ၂ = 2 |
| a bargained price of 15,000 | price, 1, 5, 000, OK, Save = 6 | ✅, the line, 💬, type, ✅ သိမ်း = 4 + typed | 💬, typed |
| mixed: KBZ 5,000, the rest cash | 💵+🏦, (KBZ when there are several), transfer, 5, 000, OK, Save = 6-7 | ✅, 💰, 💵+🏦, KBZ, type, ✅ သိမ်း = 5 + typed | ✅, 💵+🏦, KBZ, typed |
| part 20,000, a recent buyer, 14 days | 💳, amount, 2, 0, 000, OK, buyer chip, ၁၄ ရက်, Save = 9 | ✅, 💳 မကျေသေး, ✏️ အခြား, type, the buyer, ၁၄ ရက်, ✅ သိမ်း = 6 + typed | ✅ + corrective buttons |
| new piece, a preset price, a typed cost, the AI name later | 📸 (+2 in the camera app), price chip, cost, 1, 2, 000, OK, Save | photo, price chip, 🪙 အရင်း, type, ✅ သိမ်း | photo, price, cost |
| new piece × 10 | + count, 1, 0, OK | + 🔢, type | not possible |
| restock 5 of a stock item | 📦, scan, (၅), Save = 3 | `R\|`, +၅ (today) | the same |
| expense 20,000, fabric, cash | 💸, 🧵 အထည်ဖိုး, (20,000), Save = 4 | `EC`, `EA`, `EM` (today) | the same |

### 1.9 Errors as the seller sees them

| Code (helper) | Text (file:line) | Where |
|---|---|---|
| scan: `missing` | `tag_not_found` '❓ Tag {id} ကို မတွေ့ပါ။' (:8) | toast |
| scan: `blank` (sale, restock) | `basket_blank` 'ℹ️ {id} က Tag အသစ်ပါ · ပစ္စည်းအသစ် အရင် မှတ်ပါ' (NEW) | toast |
| scan: `other_shop` | `basket_other_shop` '⚠️ {id} · {shop} ၏ ပစ္စည်းပါ · မထည့်ပါ' (NEW) | toast |
| scan: `gone` | `basket_gone` '⚠️ {id} ရောင်းပြီးသားပါ · မထည့်ပါ' (NEW) | toast |
| scan: `twice` | `basket_twice` 'ℹ️ {id} ထည့်ပြီးသားပါ' (NEW): a one-of-a-kind piece already a line; `ui_form_twice` 'ℹ️ {id} ထည့်ပြီးသားပါ · အရေအတွက် တိုးရင် + ကို နှိပ်ပါ' (NEW): a stock item already a line (0.3 rule 14) | toast; the line flashes |
| scan: `max` | `basket_max` 'ℹ️ တစ်ခါ ရောင်းရင် {max} ခု အထိပါ' (NEW); the restock form `restock_max` (NEW) | toast |
| scan: `unique` (restock) | `basket_unique` (NEW) | toast |
| scan: `other_shop` (new piece, a seller's blank tag of the other shop) | `basket_other_shop` | toast |
| Save: `empty` | `scan_first` '📷 ပစ္စည်း Tag ကို အရင် scan လုပ်ပေးပါ။' (:74) | `.fmsg` |
| Save: `gone` (sold on another phone meanwhile) | `basket_line_gone` '⚠️ {id} ရောင်းပြီးသားပါ · ဖယ်ပြီးမှ သိမ်းပါ' (NEW) | the line `.fbad`, `.fmsg`; the total never changes silently: the seller removes the line |
| Save: `need_price` | `basket_need_price` '💬 {id} · ရောင်းစျေး ရိုက်ပါ' (NEW) | the line's price box |
| Save: `qty` | `bad_qty` '❓ ၁ မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ' (:20) | the line |
| Save: `account` (🏛 or 💵+🏦 with no account picked) | `sale_ask_account` (:433) / `sale_ask_split_account` (:434) | the account row |
| Save: `transfer` | `sale_bad_amount` '❓ {min} မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ' (:445) | the transfer row |
| Save: `paid_none` | `sale_ask_paid` '💰 ယခု ပေးငွေ ဘယ်လောက်လဲ? (စုစုပေါင်း {total} ကျပ်)' (:435) | the amount row |
| Save: `paid` | `sale_bad_amount` | the amount row |
| Save: `need_buyer` | `sale_need_buyer` (:438) | the buyer section |
| Save: `buyer_pick` (app; search text that matches customers, none picked) | `ui_buyer_pick_first` (NEW) | the search row `.fbad`, the matches shown |
| Save: `need_name` (app; search text of digits only, none picked) | `ask_name` (:80) | the new buyer's name input |
| Save: `known_phone` (app; a new buyer's phone that customers already have) | `ui_buyer_known_phone` (NEW) | the phone input `.fbad` and the customer chips |
| Save: `same_name` (app; ✏️ new with an exact-name match, neither chosen) | `ui_buyer_same_name` (NEW) | the name input `.fbad`, the customer chip and `btn_create_named` |
| Save: `phone` | `basket_bad_phone` '📱 ဖုန်းနံပါတ် တိုလွန်းပါသည် (09 နဲ့ စပါ)' (NEW) | the phone input |
| Save: `due_none` | `sale_ask_due` (:436) | the promised-day row |
| Save: `due` (a date outside today .. +365; only a TYPED date in Telegram can reach it, the app's sheet has `min` and `max`) | `ord_bad_date` (:252) | the promised-day row |
| Save: `method` (an account retired by a pull meanwhile) | `basket_method_gone` 'ℹ️ ဒီအကောင့် မရှိတော့ပါ · ငွေသား ပြောင်းထားပါသည် · စစ်ပြီး ထပ်သိမ်းပါ' (NEW, revision 2, U21h) | `.fmsg`; the method falls back to 💵 (mixed off) in both channels, so the next Save is the seller's checked choice |
| Save: `mode` (the phone is now quick) | `expired` '⏱ သက်တမ်းကုန်သွားပါပြီ။ ထပ်ပြောပေးပါ။' (:71) | the form closes and `expired` is a toast (U17: the `.fmsg` would go with the form) |
| Save: `busy` | — (ignored) | — |
| Save: a throw inside the save (revision 2, U18) | `expired` | `.fmsg`; Save is enabled again |
| new piece: `not_blank` | `tag_not_blank` (:322) | `.fmsg`; the tag is cleared and the strip shown again, every typed value kept (U13) |
| new piece: `other_shop` (a seller's blank tag of the other shop) | `basket_other_shop` | `.fmsg`, the tag row |
| new piece: no price and not pending | `ask_price` (:77) | the price row |
| new piece: `count` | `bad_qty` | the count |
| expense: no category / an amount below 1 | `exp_ask_cat` (:162) / `ask_number` '✏️ ဂဏန်း ရိုက်ပေးပါ (ဥပမာ 25000)' (:79) | the field |
| a new category or account the Lists refuse | `add_ask_ec` (:389) / `add_ask_pm` (:388) for an empty name; `add_unavailable` (:393) | the input |

### 1.10 What stays a chat flow in the app

Receiving a payment, taking a deposit and a return stay today's flows: ☰ `M|pay` and `M|dep` (core_bot.js:133,
:639-640), 💰 on the sold card and the customer card (`PY|`, `PL|`), ↩️ `T|` on the item card (core_bot.js:528-535).
They already run in the app through `deliver`; a form would not save taps (design-seller 1.7). A payment and a deposit
read the group's owed (basket map 2.14), so a basket works with them.

A return does NOT (revision 2, M3). `T|` writes `commitReturn(ports, merge(base, {item, qty: 1}))` (core_bot.js:528-535):
no group, no buyer, and `cash = amount`, a full cash refund that nothing caps (core_ledger.js:866-879). Bringing one
piece back from a part-paid basket would pay cash out of the drawer and leave the whole credit owed in Credits, the
21:00 overdue line and the buyer's `bought`. So `T|` first reads `creditOpenFor(ports, itemId)` (4.2): when the piece's
last live SALE belongs to a group (not a custom order) that still owes, nothing is written and the card answers
`ret_credit_open` 'ℹ️ 👤 {customer} · ကျန် {owed} ကျပ် · အကြွေးနဲ့ ရောင်းထားတာပါ · ပြန်အမ်းရင် ဆိုင်ရှင်ကို မေးပါ'
(NEW), for every role, in both channels and both modes. The owner's way: void the basket from its receipt (0.3 rule 17)
and sell the kept pieces again, or receive the payment first and then take the piece back. A return of a piece whose
sale is paid is today's. A spoken return (`handleIntent`) keeps today's path (section 12).

Custom orders are unchanged. The measurement form changes in revision 3 (F1, F2: one note, the figure, ← and Save, 13.7).
Revision 3 also moves three chat cards of the app to app pages, in both sale modes: 👤 ဝယ်သူများ and the customer card
become the buyers page and the buyer page (13.6; their 💰 and 📥 still start these chat flows), and 🧾 ဘောက်ချာ becomes
the receipt page (13.10).

### 1.11 `quick`

Exactly round 4 and today's suites: the one-tap card with its corrective buttons, the chat new-piece chain (price, then
cost), no job tiles, no forms, no review card. The app follows `quick` from Settings or from an older server
(`quickForced`, core_sync.js:1454-1468, :1489-1494); the pref `setting:sale_flow` (app_store.js:341-344) is a test hook
with no control (run_app.js step 36; 1.0).

---

## 2. Telegram

### 2.1 The sale review card (R5, the sellers' backup)

Telegram cannot draw a form, so the same sale is ONE message that reads like the receipt it becomes, with its defaults
filled in, buttons that open sub-screens, and one Save.

**Opened by** (form mode, no `ports.ui.openForm`): `S|<id>|<n>` on the item card (`btn_sell_one` '✅ ရောင်း ၁' :15,
`btn_sold` '✅ ရောင်းပြီး' :21; also the digits of the `Q|` grid, which in both modes is quick's `askQty` with
`S|<id>|<n>` digits, core_bot.js:254-266); a typed count after `QN|` (quick's prompt `await_number sale_qty`,
core_bot.js:490-491); a typed price after `D|` (quick's prompt `await_number sale_price` with `[Z]`,
core_bot.js:505-506). All three reach `startSaleFor` (4.4). A tapped item card (a photo message) is edited into the card
with its `isCaption`; a typed opener sends the card as a new message. `S` stays exempt from the 120 s tap guard in form
mode (core_bot.js:446: `=== 'form'`), because it writes nothing. A second identical `S` tap on the message that already
shows this one-line card makes no edit (round 5's rule, core_bot.js:2401-2403).

**Text** (`basketCardText(ports, state)`), the anchor `<a>` = the item the card was opened on:

```
⚠️ S1-0001 ရောင်းပြီးသားပါ · ဖယ်ပြီးမှ သိမ်းပါ        a refusal line, only after a refused Save or a refused add
🛒 ရောင်းမည့် စာရင်း · ၃ ခု                            basket_title (NEW)
1. 🧣 S1-0002 · လုံချည် ကချင် အပြာ × ၂ · 36,000        basket_card_line (NEW), names cut to CFG.BASKET_NAME_MAX 24
2. 👗 S1-0005 · ထမီ ဇင်းမယ် အဝါ × ၁ · 22,000            (a bargained line ends ' 💬'; a pending line shows btn_pending as its amount)
3. 👗 S1-0001 · ထမီ ချည်သား အနီ × ၁ · 25,000
စုစုပေါင်း 83,000 ကျပ်                                 basket_total (NEW)
👤 ဒေါ်မြင့် · +95 912 345 678                          customerLabel (core_bot.js:1590); a new buyer '👤 ' + name (+ ' · ' + fmtPhone); none: btn_no_name '🚫 နာမည် မရှိ' (:424)
💰 ငွေသား                                              sale_line_method (:439) / sale_line_mixed (:440)
ပေးပြီး 30,000 · ကျန် 53,000                            sale_line_paid (:441), always: with nothing owed it is the last line
📅 ကျန် 53,000 · ၂၆ နိုဝင်ဘာ ၂၀၂၆                       only while owed: sale_due_set (:442) / sale_due_none (:443) / sale_ask_due (:436) while not chosen
ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်                    only while owed with no buyer: sale_need_buyer (:438)
```

**Keyboard** (`basketCardKeyboard(ports, state)`):

```
[1. S1-0002 × ၂] [2. S1-0005 × ၁]       SS|<a>|l|<id>     btn_card_line '{n}. {id} × {qty}' (NEW), two per row
[3. S1-0001 × ၁]
[➕ ပစ္စည်း ထပ်ထည့်]                       SS|<a>|add        btn_add_item (NEW); absent at CFG.BASKET_MAX_LINES lines
[👤 ဝယ်သူ] [💰 ဘယ်လိုပေးလဲ?]              SS|<a>|o|buyer    btn_customer (:140) · SS|<a>|o|method sale_ask_method (:432)
[💳 မကျေသေး]                              SS|<a>|o|paid     btn_credit (:41), while paid in full
  owed: [💳 ယခု ပေးငွေ] [📅 ပေးမည့်ရက်]     SS|<a>|o|paid     btn_paid_now (NEW) · SS|<a>|o|due btn_due (NEW)
[✅ သိမ်း]                                 SC|<a>|ok         btn_save (:344)
[✖️ မလုပ်တော့]                             SS|<a>|z          btn_cancel (:32), its own row below Save (revision 2, U11)
```

The only ✅ on the card is Save. Every sub-screen is drawn on the card's own message (with its `isCaption`); its text is
`basketHead` (`basket_title` and `basket_total`, two lines) followed by the round-5 screen's question; its last row is
`[btn_back '⏮ နောက်ပြန်' → SS|<a>|back|<step>]` ALONE (:335), and so is the last row of a typed prompt opened from it.
There is no ✖️ on a sub-screen (revision 2, U11): `z` is `saleCancel`, which clears the whole basket (core_bot.js:2790-2803),
and "never mind" on the buyer or how-paid list must not do that; ⏮ is the way out. A back tap on a sub-screen goes to
its parent (`SALE_PARENT`, 4.4: the card, or the sub-screen above it); a back tap while a typed prompt opened from that
sub-screen is live redraws the sub-screen (round 5's rule). A typed answer has no tapped message: the next screen is a
new message and `state.msgId` moves to it (round 5's rule, core_bot.js:2290-2293).

| Sub-screen (step) | Opened by | Text after `basketHead` | Answers (`SS\|<a>\|…` unless shown) | Exit | Built from (core_bot.js) |
|---|---|---|---|---|---|
| line (`line`, `state.line` = the item id) | `l\|<id>` | that line's `basket_card_line`; a stock item adds `ask_qty` '🔢 ဘယ်နှစ်ထည် ရောင်းလဲ?' (:18) | a stock item: `q\|1`..`q\|9` (`CFG.QTY_GRID` with 1 in front), `qn` (✏️ `btn_type_qty` :17, a typed count, prompt `ask_qty_number` :19, `await_number sale_qty`); every line: `pr` (💬 `btn_discount` :22, a typed price, prompt `ask_sale_price` :82, `await_number sale_price`), `rm\|<id>` (🗑 `btn_remove_line`, only while the basket has 2+ lines) | the card | `saleQtyGrid` :2534, `saleQtyPick`/`saleQtyTyped` :2805-2825 on `state.line`, `saleFromPrice`'s bound (a price below 1 asks again) |
| add (`add`) | `add` | `basket_add_ask` '📷 နောက် Tag ကို scan လုပ်ပါ · ဒါမှမဟုတ် နံပါတ် ရိုက်ပါ (ဥပမာ S1-0042)' (NEW) | up to four `recentItems(ports, shop, 6)` (core_ledger.js:1708-1724) that are sellable and not in the basket, as '{emoji} {id} · {name}' → `i\|<id>`; or a scan (`/start <id>`) or a typed id, both through `openTag`; a typed text that is not a tag id is a name search (revision 2, U25): up to four `findItemsByName(ports, shop, text)` (core_ledger.js:1684) matches that `basketAddItem` accepts, as the same `i\|<id>` rows on a new add screen, or `find_none` '🔍 မတွေ့ပါ။' (:92) on top of `basket_add_ask` | the card | NEW `basketAddScanned` |
| buyer (`buyer`, `name`, `phone`) | `o\|buyer` | `credit_ask_customer` '👤 ဝယ်သူ ဘယ်သူလဲ?' (:98), `cust_find` (:150); with the need-buyer view (owed, no buyer) `sale_need_buyer` above them and no 🚫 | `b\|none` (`btn_no_name`), `b\|<custId>` (`recentCustomers(ports, shop, 4)`), `b\|new` → the name prompt (`ask_name`), a typed name or phone (the round-5 matching), the look-alikes (`cust_pick` :143, `b\|create` `btn_create_named` :144), the phone prompt (`ord_ask_phone` :219, `ph\|skip` `btn_skip` :30) | `basketNext` | `saleScreenBuyer` :2572, `saleScreenLookalikes` :2591, `saleScreenName` :2601, `saleScreenPhone` :2606, the answers :2827-2895 |
| how paid (`method`, `account`, `bank`, `kind`) | `o\|method` | `sale_ask_method` (:432) | `m\|CASH`, `m\|<wallet KEY>`, `m\|bank` → `account` (banks; one bank is picked for you), `m\|mix` → `account` (every non-cash account; one is picked for you) → `bank` (the transfer part: `split_ask_amount` :378, `x\|half`, or typed, `await_number sale_step`), `m\|more` → `account` (wallets), `a\|<KEY>`, `a\|p<n>` (pages), ➕ `LA\|pm\|SSA\|<a>` → `add_ask_pm` → the kind (`sale_ask_kind` :437, `k\|wallet`, `k\|bank`; the Lists row is written at the kind tap, round-5 D6) | the card | `saleScreenMethod` :2615, `saleAccountCandidates` :2638, `saleScreenAccount` :2646, `saleScreenBankPart` :2667, `saleScreenKind` :2707, `saleMethodPick`/`saleAccountPick`/`saleBankHalf` :2897-2934, `saleKindPick` :3031, `saleAddNamed` :3048, `saleAccountResume` :3073 |
| paid now (`paid`) | `o\|paid` | `sale_ask_paid` (:435) | `p\|all` (`btn_paid_full` '💯 အကုန် ပေးပြီး {amount}', NEW: paid in full), `p\|0`, `p\|half` (`btn_half` :254), mixed: `p\|bank` (the transfer part only), ✏️ `p\|other` (`btn_other` :31; `ask_number` :79, `await_number sale_step`) | `p\|all` → the card; a part answer → `basketNext` | `saleScreenPaid` :2676 (its first button was `SC\|<id>\|ok`, now `p\|all`), `salePaidPick` :2975, `saleNumber` :2936 |
| promised day (`due`, `due_text`) | `o\|due` (only while owed), or `basketNext` | `sale_ask_due` (:436) | `d\|<n>` (the first three `saleDuePresets`, `btn_days` :238), `d\|type` (`btn_due_type` :240 → `ord_ask_due_text` :251), `d\|none` (`btn_due_unknown` :428); a date typed on either screen | `basketNext` | `saleScreenDue` :2694, `saleScreenDueText` :2702, `saleDuePick` :2993, `saleDueTyped` :3010 (both through `saleDueKey`, 4.2) |

`basketNext` (4.4) after the paid, buyer and due answers: while something is owed and no buyer is set, the buyer
sub-screen in its need-buyer view; then, while owed and no promised day is chosen, the due sub-screen; else the card.
So a part payment is: 💳 မကျေသေး, the amount, the buyer, the day, then the card with ✅ သိမ်း; the round-5 order.

**Typed text on the card** (step `card`) is a buyer search (`saleBuyerNamed`), as round 5's first screen read it
(run_wizard.js:151; digits are a phone hint). A typed tag id is caught first by `tagIdFromText` (core_bot.js:704-705),
so on the add screen it adds the line, and anywhere else it is a scan without ➕ (2.2: the card pauses). Typed text on
the add screen is a name search (the table above).

**Save** `SC|<a>|ok` (`basketSave`, 4.4) at step `card`: `basketCommitDraft` (the shared Save, 4.4). A refusal redraws
the card with the first problem's text on top, writes nothing, keeps the state, and removes this tap's guard key
`'tap:' + chatId + ':' + msgId + ':SC|' + <a> + '|ok'` (`ports.cache.remove`, which every port has: gas_main.js:154,
sim_ports.js:355, app_ports.js:161), so the corrected ✅ within 120 s is not swallowed (core_bot.js:446-449). A piece sold
meanwhile is such a refusal (`basket_line_gone`); the seller removes its line, the other lines stay. Accepted:
`clearState`, `markCommittedCard`, and `basketSoldReply` on the tapped message: the sold card of 1.4, or the deposit
question.

**Cancel** `SS|<a>|z` is `saleCancel` (core_bot.js:2790-2803) as it is: the message becomes the anchor's item card and
the state is cleared; a sold card is never touched. It is offered on the card only, on a row of its own (U11).

**Callbacks** (64-byte rule; tag ids are `S\d-\d{4}`, 7 bytes):

| Callback | Bytes | Step needed (rule c) | Writes | In |
|---|---|---|---|---|
| `SS\|S1-0002\|l\|S1-0005` | 20 | card | no | ITEM_ACTIONS |
| `SS\|S1-0002\|add` | 14 | card | no | ITEM_ACTIONS |
| `SS\|S1-0002\|o\|method` (the longest `o`; `buyer` 18, `paid` 17, `due` 16) | 19 | card | no | ITEM_ACTIONS |
| `SS\|S1-0002\|i\|S1-0005` | 20 | add (on the card's message), or paused (on the item card of `state.resume`, 2.2) | no | ITEM_ACTIONS |
| `SS\|S1-0002\|go` (NEW, revision 2, U10) | 13 | paused (on the paused card, `state.msgId`) | no | ITEM_ACTIONS |
| `SS\|S1-0002\|q\|9` · `qn` · `pr` | 14 · 13 · 13 | line | no | ITEM_ACTIONS |
| `SS\|S1-0002\|rm\|S1-0005` | 21 | line | no | ITEM_ACTIONS |
| `SS\|S1-0002\|p\|all` | 16 | paid | no | ITEM_ACTIONS |
| `SS\|S1-0002\|a\|<12-byte key>` (round 5) | 25 | account | no | ITEM_ACTIONS |
| `SS\|S1-0002\|back\|due_text` (the longest back) | 24 | that step | no | ITEM_ACTIONS |
| `SS\|S1-0002\|z` | 12 | card (offered there only; accepted at any step, as round 5's) | no | ITEM_ACTIONS |
| `SC\|S1-0002\|ok` | 13 | card | **yes** | ITEM_ACTIONS, MUTATING_ACTIONS (already, core_bot.js:436) |
| `LA\|pm\|SSA\|S1-0002` (round 5) | 17 | method, account | no | — |
| `CD\|<g>\|yes\|p\|<12-byte key>` (round 5) | 58 | — | yes | MUTATING_ACTIONS |

The round-5 answer letters keep their shape (`b`, `ph`, `m`, `a`, `x`, `p`, `d`, `k`, `back`, `z`); `q` now belongs to
the line sub-screen; `o`, `l`, `add`, `i`, `qn`, `pr`, `rm`, `go` and the argument `p|all` are new. Slot 1 is always the
anchor; it stays the anchor when its own line is removed, so `ITEM_ACTIONS` (core_bot.js:431, :452-454) keeps finding an
existing item.

**State** `st:<uid>`, TTL `CFG.STATE_TTL_SEC` 1800 s (as round 5):

```
{ kind: 'sale',
  step: 'card' | 'line' | 'add' | 'buyer' | 'name' | 'phone' | 'method' | 'account' | 'bank' | 'paid' | 'due' | 'due_text' | 'kind',
  item: <the anchor id>, msgId, cap: <true when msgId is a photo message>, line: <item id of the open line sub-screen> | '',
  acct: 'bank' | 'wallet' | 'all', undo: {method, mixed, bankPart} | absent,
  paused: true | absent, resume: <message id of the item card that carries ➕ စာရင်းထဲ ထည့်> | absent,
  draft: { lines: [{id, qty, unitPrice, priceChanged}], customerId, newName, newPhone, method, mixed, bankPart,
           part, paid, dueDay, addLabel, addedKey } }
```

There is no `hist`. `draft.qty`, `draft.unitPrice` and `draft.priceChanged` moved into `lines[]` (`unitPrice` null =
the item has no price yet). `draft.part` true = not paid in full, with `paid` the amount now. `draft.dueDay` absent =
not chosen, `''` = ❓ not sure, `yyyy-mm-dd` = the date. `undo` holds the payment fields as they were when `o|method`
opened the how-paid sub-screen; ⏮ from that sub-screen to the card restores them, and every exit of the chain to the card
drops them. `cap` lets `basketPause` and `basketClose` edit the card with the right `isCaption`. `paused` and `resume`
belong to 2.2's pause (revision 2, U10). The typed prompts wrap the state as round
5 did (`{kind: 'await_number', purpose: 'sale_step' | 'sale_qty' | 'sale_price', saved}`), and ➕ wraps it with resume
`SSA`, so `saleStateOf` (core_bot.js:2340-2347) reads through them unchanged.

### 2.2 Stale, double and late taps; the ➕ rule

`saleGuard` (core_bot.js:2359-2377) keeps round 5's rules: (a) no basket state for this anchor: the message reads
`expired` (:71) and a fresh item card follows; a sold card is never edited (the reply is a new `expired` message,
`saleSoldCard` :2383-2387, which recognises the basket's sold card because `basket_sold` starts with `sold_done`'s
'✅ ရောင်းပြီး'); (b) a message older than the live card reads `expired`, the basket untouched; (c) a letter that does not
belong to the open sub-screen (or to the card) is ignored with no edit, so answer letters tapped while the card shows
are no-ops and a second tap of an answer whose sub-screen already returned to the card cannot redo it. Revision 2 adds
one exception to (b): while `state.paused`, an `i|<id>` tap on the message `state.resume` (the item card that offered
it) is accepted, and `go` is accepted only on `state.msgId` (the paused card).

Further rules:

- `SC` and `NC` are in `MUTATING_ACTIONS` (120 s); a refused Save frees its key (2.1, 2.3).
- **The ➕ rule.** A scanned or typed tag joins the basket only while the card waits at its add screen (step `add`), or
  through the `➕ စာရင်းထဲ ထည့်` row below. Any other scan or typed tag while a basket card is live is "a scan without ➕"
  (revision 2, U10: the owner's own words are "scan all tags", BRIEF.md:12-13, so it is normal, not a mistake):
  `openTag` calls `basketPause(ctx, state, item)`, which
  1. edits the live card's message (with `state.cap`) to `basket_paused` '⏸ ဒီစာရင်း ({n} ခု) ခဏ ရပ်ထားပါသည် ·
     ဆက်ရောင်းရင် ↪️ ဒါမှမဟုတ် ပစ္စည်းကတ်ရဲ့ ➕ ကို နှိပ်ပါ' (NEW) with ONE row `[btn_resume '↪️ ဆက်လုပ်မယ်' →
     SS|<a>|go]` (NEW);
  2. sets `state.paused = true` and keeps every line, the buyer and the payment;
  3. sends the scanned tag's item card as today (`sendItemCard`, core_bot.js:236-243), with ONE extra first row
     `[btn_add_to_list '➕ စာရင်းထဲ ထည့်' → SS|<a>|i|<id>]` (NEW) when `basketAddItem(ports, staff, lines, id, 1).ok`,
     and stores that message's id as `state.resume` (a later scan without ➕ moves `resume` to the newer card; the older
     card's ➕ then answers `expired` by rule (b)).
  `i|<id>` from the item card adds the line (`basketAddScanned`), turns THAT message into the card (with its
  `isCaption`; `state.msgId` moves to it, `paused` and `resume` are cleared) and the paused message keeps no live
  button (its ↪️ answers `expired`, rule (b)). `go` on the paused card redraws the card there, unpaused. The basket is
  dropped only when the seller starts another sale (✅, 🔢 or 💬 on any item card while a basket is live, paused or not:
  `startBasket` calls `basketClose`, which edits the old card's message to `basket_closed` '⏱ ဒီစာရင်း ပိတ်လိုက်ပါပြီ
  · ဘာမှ မမှတ်ရသေးပါ' (NEW) with no buttons and clears the state) or when the state's 1800 s run out. The basket is
  never lost by a scan, and a stale one never absorbs a new piece without a tap.
- **An added tag** (`basketAddScanned`): accepted or refused, the add screen's message is edited to `basket_moved`
  '⬇️ အောက်မှာ ဆက်လုပ်ပါ' (NEW) with no buttons and the card comes back as a NEW message (the actionable screen is the
  last bot message), a refusal (`basket_twice`, `basket_other_shop`, `basket_gone`, `basket_blank`, `tag_not_found`,
  `basket_max`) as its top line with the basket kept. An `i|<id>` tap redraws the card on the tapped message.
- `/start` and the stateless menu taps keep the state (`dropAddState` touches only ➕ and 🔢 prompts,
  core_bot.js:3243-3248); the menu taps that open a flow of their own (`M|find`, `M|cfind`, `M|exp`, `M|dep`, `M|nb`,
  `M|meas`) replace it as today, and the card then answers by rule (a).
- A spoken answer lands in the open sub-screen (the step names are kept, `handleIntent` :843-849, :890-896, :904-918,
  :931-934); a spoken count goes to the open line; `saleIntentClashes` (:3088-3098) and `confirmProposal`
  (:1129-1130) treat any line of the basket as the piece being sold.

### 2.3 The new-piece review card

A blank tag scanned in Telegram answers `new_tag` '🆕 Tag အသစ်ပါ ({id})။ ပစ္စည်းရဲ့ ဓာတ်ပုံ ပို့ပေးပါ။' (:9) as today;
the photo reaches `handlePhoto` (core_bot.js:2095-2132), which builds the draft as today (the AI name and category,
:2115-2124). In form mode the state gains `form: true`, `step: 'card'`, `draft.count = 1`, a caption number of 500 or
more is the price (:2125, :2129), and the card below is sent as a TEXT message (the photo is the user's; no caption
limit) instead of `priceScreen` (:2130-2131). In form mode a seller's blank tag of the other shop answers
`basket_other_shop` and starts no state (revision 2, m7; 1.2). A second photo while the card is live (`state.form`
already set, revision 2, U12) replaces ONLY `photoUrl` and `photoFileId`: today's handler would let the AI name win over
a typed one (:2121), replace the category and reset the step and the count; the card is then sent again as a new
message (`state.msgId` follows).

```
⚠️ …                                       a refusal line, only after a refused Save
📸 ထမီ ပိုးထည် အစိမ်း · ထမီ                  photo_seen (:83)
💰 ရောင်းစျေး 25,000 ကျပ်                   item_lbl_price (NEW) | btn_pending '⏳ စျေး မသတ်မှတ်ရသေး' | ask_price '💰 စျေး ဘယ်လောက်လဲ?' while neither
🪙 အရင်း 12,000 ကျပ်                        item_lbl_cost (NEW) | item_lbl_cost_none '🪙 အရင်း မသိသေး' (NEW)
📈 အမြတ် 13,000 ကျပ် · အရင်းပေါ် 108%       item_lbl_profit (NEW) when price and cost are known | item_lbl_loss (NEW) below cost
🔢 ၁ ထည်                                   item_lbl_count (NEW), + sample_mark ' (နမူနာ)' (:13) with the sample toggle on
[10,000] [15,000] [22,000] [25,000]        P|<id>|<n>        pricePresets(ports, category, staff.shop), as priceScreen (:2134-2142); ထမီ on the seed
[✏️ အခြား] [⏳ စျေး မသတ်မှတ်ရသေး]           P|<id>|other · P|<id>|pending      btn_other (:31), btn_pending (:48)
[🪙 အရင်း] [✏️ နာမည်]                       C|<id>|other · NI|<id>|n           btn_item_cost (NEW), btn_item_name (NEW)
[🏷 အမျိုးအစား] [🧵 နမူနာ: မဟုတ်]            NI|<id>|c · PS|<id>                btn_item_cat (NEW), btn_sample_off / on (:49-50)
[➖] [🔢 ၁ ထည်] [➕]                         NI|<id>|q|- · NI|<id>|qn · NI|<id>|q|+    item_lbl_count in the middle
[✅ သိမ်း]                                  NC|<id>|ok                         btn_save
[✖️ မလုပ်တော့]                              Z                                  btn_cancel, its own row (as 2.1)
```

There is no ⏭ skip-cost button on the card (an unknown cost is already the default) and the count is inline.

| Sub-screen (step) | Opened by | Text | Answers | Back (`NI\|<id>\|back`) |
|---|---|---|---|---|
| price (`price`) | `P\|<id>\|other` | `photo_seen` + `ask_price` (:77) | a typed number ≥ 0 (0 or below reads as pending, as `isPricePending` reads it, core_bot.js:181-183) | `btn_back` '⏮ နောက်ပြန်' |
| cost (`cost`) | `C\|<id>\|other` | `photo_seen` + `item_ask_cost` '🪙 အရင်း ဘယ်လောက်လဲ? (အထည် + လက်ခ)' (NEW: the card says အရင်း, so its question does too; quick keeps `ask_cost` :78, revision 2, U21e) | a typed whole number ≥ 1 | `btn_skip` '⏭ ကျော်' (the cost stays unknown) |
| name (`name`) | `NI\|<id>\|n` | `photo_seen` + `ask_name` (:80) | a typed text (trimmed, at most 60 characters) | `btn_back` |
| category (`cat`) | `NI\|<id>\|c` | `item_ask_cat` '🏷 ဘာ အမျိုးအစားလဲ?' (NEW) | five rows '{emoji} {category}' → `NI\|<id>\|c\|<0..4>` (an index into `CFG.CATEGORIES`: a label is up to 21 bytes, an index 1) | `btn_back` |
| count (`count`) | `NI\|<id>\|qn` | `item_ask_count` '🔢 ဘယ်နှစ်ထည် ရှိလဲ?' (NEW) | a typed 1..999 (else `bad_qty` with the back row, the state kept) | `btn_back` |

Every answer sets its field and returns to the card: a tap edits the card in place, a typed answer sends it as a new
message (`state.msgId` follows). `P|`, `C|` and `PS|` keep their handlers (`newItemPrice` :2154, `newItemCost` :2172,
`toggleSample` :2145); with `state.form` they set the field and redraw the card, never move a step forward and never
write; under `quick` they are today's chain byte for byte. `NI|<id>|q|-` and `q|+` move the count by one within
1..999. The guard of `NI` and `NC`: `state.kind === 'new_item' && state.itemId === <id> && state.form`, else `expired`
as a new message (as `newItemPrice` answers, :2156).

**Save** `NC|<id>|ok` (`newItemSave`, 4.4): `commitNewItem` (4.2). Refused: `not_blank` → the message reads `expired`
and the item card follows; `price` (neither a price nor pending) → the card with `ask_price` on top; either refusal
frees the tap guard key of `NC|<id>|ok`; `other_shop` (m7) → the message reads `basket_other_shop`, the state cleared.
Accepted: the tail of `newItemCost` (core_bot.js:2188-2194): `setLastItem`, `clearState`, the card edited to
`item_created` · id, `notifyOwners(price_ask_owner, priceButtons)` while the price is pending, then
`sendItemCard(..., {undo: r.groupId})`: the new piece's card with `undoRow` as its first row (revision 2, M5; 1.5).

| Callback | Bytes | Writes | In |
|---|---|---|---|
| `NI\|S1-0007\|q\|-` · `q\|+` · `c\|4` | 14 | no | ITEM_ACTIONS (NEW) |
| `NI\|S1-0007\|qn` · `n` · `c` · `back` | 13 · 12 · 12 · 15 | no | ITEM_ACTIONS |
| `NC\|S1-0007\|ok` | 13 | **yes** | ITEM_ACTIONS (NEW), MUTATING_ACTIONS (NEW) |
| `P\|S1-0007\|pending` (the longest existing) | 17 | no | ITEM_ACTIONS (as today) |

State: today's `{kind: 'new_item', itemId, step, draft}` (core_bot.js:123) plus `form: true`, `msgId`, `draft.count`,
steps `card` | `price` | `cost` | `name` | `cat` | `count`. `handleText` routes a typed answer by step: `name` takes
any text before the number path; `price`, `cost` and `count` take a number (core_bot.js:732-735 extended). At step
`card` (revision 2, U12; today the photo sets step `price`, :2127, so a typed 25000 is the price, and at `card` it would
fall through to `ports.ai.parseText`, :757): a typed number of 500 or more is the price (the caption rule, :2129) and
the card is redrawn as a new message; a smaller number answers the card with `ask_price` on top; any other text is the
name (trimmed, at most 60 characters). A tag id is still caught first (:704).

### 2.4 Restock and expense in Telegram

Unchanged: `R|<id>` → `ask_restock_qty` with `RQ|<id>|<n>` presets and `RQ|<id>|other` (core_bot.js:513-527); ☰
`M|exp` → `ES|` (owner), `EC|`, `EA|`, `EM|` (commits), `EN|` (a note, as a rewrite) (core_bot.js:1939-2062). There is no
review card for them; their chat flows are short and are the owner's too.

### 2.5 Telegram as the owner's channel

| Stays in Telegram for the owner | Where | Round 6 change |
|---|---|---|
| the 21:00 family summary | `sendDailySummary` (gas_main.js), `buildDailySummary` (core_ledger.js:1617-1682) | none in code: a basket counts as its rows; an overdue basket names its buyer (DueDay on every SALE row, 3.4) |
| reports and PDFs (day, month, stock, owed, a customer's statement) | `showReportMenu` (core_bot.js:2064), core_report.js | the ပစ္စည်း cell of the credit tables follows `openCredits` (`basket_name`, 5.1) |
| receipts `RC\|g`, `RCP\|g` | core_report.js:331-409, `sendReceipt` (core_bot.js:2080-2084) | the text: none (one line per basket line already); the owner's `RC\|g` reply of a basket adds `[btn_void]` (`V\|g`), and the owner's item card of a piece last sold in a basket adds `[🧾 ဘောက်ချာ]` (revision 2, M6; 0.3 rule 17) |
| price-pending pings with `SP\|` | `notifyOwners` (core_bot.js:2221-2226); from a phone as outbox notices (app_ports.js:93-98) | the app's new-piece form sends them too, same text and buttons |
| server flags with the owner's `V\|` | `syncFlagPing` (core_sync.js:634-637) | a `stock_negative` flag on a stock item pings `ping_stock_short` with no button (revision 2, M2; 6.3); a one-of-a-kind piece keeps `ping_stock_negative` and `V\|`; a `V\|` on a basket voids every line and its reply lists them (4.4) |
| 📲 the code that connects a phone, 📱 the phone list | `sendEnrollCode` / `showDevices` (core_bot.js:154-167) | none |
| 🏛 accounts, 👤 customers, 💰 payments, 📥 deposits, 🧵 orders, 📏 measurements | the ☰ menu (core_bot.js:131-153) | none |

### 2.6 The seller's menu

The ☰ menu is the core's `showMenu` (core_bot.js:131-153), the same for both roles and both channels except the two
revision-3 rules of 13.11: in the app with forms the extra row gains 📦 ကုန်ရောက် (`M|restock`, F12), and 📒 စာအုပ် shows
only while the AI switch is on and `notebook_import` is TRUE, in the app as in Telegram (F9b). In the app with the hook
its 💸 `M|exp` opens the expense form (4.4); 🕘 `M|recent` and 🔍 `M|find` list items as `K|` buttons that open the item
card (1.2 rule 3); 💰 `M|pay` and 📥 `M|dep` stay chat flows (1.10); 👤 `M|cust` opens the buyers page (13.6). The menu
card keeps its emojis (the main menu, F7); its text is plain. `enrolledInApp` / `sendAppCard`
(core_bot.js:4470-4480, no caller) stay unwired: a seller whose phone has the app must still be able to sell in Telegram
when the app is down, which is what the backup is for.

### 2.7 `quick`

`sale_flow = quick`: `S|<id>|n`, `QN`, `D` commit as today and show `afterSaleKeyboard`; the photo chain is price, then
cost; no `SS|`, `SC|`, `NI|`, `NC|` or `LA|pm|SSA` button is ever emitted; the tap guard keeps `S`.

---

## 3. Ledger and data

### 3.1 What does not change

No Ledger column, row type, Items column, tab or Credits/Deposits/Customers column is added. `sale_flow` takes `form` |
`quick`. Revision 3 adds exactly three things to the data: the Settings key `ai` (13.11; a missing row reads ON), the
Measurements column `Sketch` (13.7.2; in `CFG.MEAS_FIXED_COLS`, so setupSheet adds it at the publish, gas_setup.js:137-144;
`addMeasurement` appends it to a tab without it only for a session with a drawing, as `EntryID` only with an entry id)
and the push entry kind `setting` (13.12, owner only, nine whitelisted keys). The AI job kinds gain two that are not AI:
`sketch` (13.7.2) and `pic` (13.11). The Sheet's Dashboard formulas sum rows (gas_setup.js:398-430) and accept any number of rows per
group (basket map 2.18).

### 3.2 `commitBasket(ports, p)`: the one write of a sale

`p = {lines: [{item, qty, unitPrice, priceChanged}], paid, method, bankPart, mixed, customerId, dueDay, note, staff,
source, transcript, updateId, when}`. In this order (core_ledger.js:826-837 with `amount` replaced by `total`):

1. `when = p.when instanceof Date ? p.when : ports.clock.now()`, read ONCE and passed to every `newTx` (today each
   `newTx` reads the clock, core_ledger.js:32, so a sale at 23:59:59 can put its rows on two Days).
2. Per line: `qty_i = max(1, round(qty_i || 1))`; `unit_i = nullish(unitPrice_i) ? Number(item.price) || 0 :
   Number(unitPrice_i)`; `amount_i = qty_i × unit_i`; `total = Σ amount_i`.
3. The group: `paid = nullish(p.paid) ? total : clamp(round(p.paid), 0, total)`; `KEY = upper(p.method || CASH)`;
   `bankPart = (KEY === CASH || !p.mixed) ? 0 : clamp(round(p.bankPart), 0, paid)`; `cashPart = paid − bankPart`;
   `owed = total − paid`; `payKey = (p.mixed && bankPart === 0) ? CASH : KEY`; `twoRows = bankPart > 0 && cashPart > 0`.
4. Allocation: `A = twoRows ? cashPart : paid`; `cash = basketAllocate([amount_i], A)` (3.4).
5. Per SALE row: `method_i = twoRows ? (cash_i ? CASH : '') : methodFor(payKey, cash_i)` (core_ledger.js:104-107);
   `groupNote = p.note || (twoRows ? 'split' : owed > 0 ? 'credit' : '')`; `note_i = groupNote || (priceChanged_i ?
   'price' : '')`; `dueDay_i = owed > 0 ? (p.dueDay || '') : ''`; `customerId` on every row; `costAtSale = item.cost`;
   `qty: −qty_i`; `unitPrice: unit_i`; `refGroupId ''`; the transcript on the first row only.
6. When `twoRows`: ONE PAYMENT after all SALE rows: `itemId` = line 1's item, `qty 0`, `amount = cash = bankPart`,
   `method KEY`, `customerId`, `refGroupId` = the group, note `'split'`, no DueDay (core_ledger.js:844-851's shape).
7. `writeGroup(ports, sales.concat(payment ? [payment] : []))` (core_ledger.js:67-75). Returns
   `{groupId, txs, sales, payment, owed, total}`.

Binding rules (the basket map 3.2-3.3, made the contract):

- **B1** One group: one SALE row per line in line order, then at most one PAYMENT; one `writeGroup`, so one lock on the
  Sheet (`gasLocked`, gas_main.js:67-73) and one outbox `group` entry on a phone (app_store.js:657-663).
- **B2** Cash is filled in line order (`basketAllocate`); every row keeps `0 ≤ Cash ≤ Amount`.
- **B3** DueDay goes on **every** SALE row while the group owes after the write; never on the PAYMENT.
- **B4** The buyer goes on every SALE row and on the PAYMENT.
- **B5** The notes of step 5: a group note wins over a line's 'price'.
- **B6** One row per distinct item (a stock item scanned again raises its count). Every line is of one shop, the first
  line's. At most `CFG.BASKET_MAX_LINES` = 10 lines (11 rows), far under `SYNC.PUSH_MAX_ROWS` 200 (core_sync.js:43).
- **B7** One clock read (step 1).
- **B8** A one-line basket writes `commitSaleGroup`'s rows exactly: the same fields in the same order, `ports.uuid()`
  called SALE first, then PAYMENT. The one difference: the SALE and the PAYMENT now share one `time` (they could differ
  by a millisecond); no check compares them.
- **B9** Every line has `unitPrice ≥ 1` and qty 1..999: `basketCheck` enforces it before the write. `commitBasket`
  clamps the way `commitSaleGroup` does and throws only on an empty list or more than `BASKET_MAX_LINES` lines (a
  programming error, never a seller's).

`commitSaleGroup(ports, p)` (core_ledger.js:824-855) becomes a wrapper: `commitBasket` with the one line `{item: p.item,
qty: p.qty, unitPrice: p.unitPrice, priceChanged: p.priceChanged}` and every other field copied (a field-by-field
literal: `merge` lives in core_bot.js:3262 and core_ledger.js may not call it), returning `{groupId: r.groupId, txs:
r.txs, sale: r.sales[0], payment: r.payment, owed: r.owed}` as today. The seven-outcome checks (run_wizard.js:520-549)
pin the wrapper.

### 3.3 A basket against the seven round-5 outcomes

Seed (poc/sim_seed.js:38-46): line 1 S1-0002 × 2 at 18,000 = 36,000 (cost 9,000); line 2 S1-0005 × 1 = 22,000 (cost
11,000); line 3 S1-0001, one of a kind, 25,000 (cost 12,000). Total 83,000; buyer ဒေါ်မြင့် (C-0001); promised day D.

| # | Outcome (SPEC-round-5 2.2) | SALE cash 1 · 2 · 3 | SALE method 1 · 2 · 3 | Note (every SALE row) | DueDay | PAYMENT | Owed |
|---|---|---|---|---|---|---|---|
| 1 | cash, full | 36,000 · 22,000 · 25,000 | CASH ×3 | '' (a bargained line alone: 'price') | '' ×3 | — | 0 |
| 2 | wallet or bank (KBZ), full | 36,000 · 22,000 · 25,000 | KBZ ×3 | '' / 'price' per line | '' | — | 0 |
| 3 | one method, part now 30,000 | 30,000 · 0 · 0 | CASH · '' · '' | credit | D ×3 | — | 53,000 |
| 3b | one method, nothing now | 0 · 0 · 0 | '' ×3 | credit | D ×3 | — | 83,000 |
| 4 | mixed, full, KBZ 10,000 | 36,000 · 22,000 · 15,000 | CASH ×3 | split | '' | 10,000 KBZ, split | 0 |
| 5 | mixed, part 50,000 of which KBZ 10,000 | 36,000 · 4,000 · 0 | CASH · CASH · '' | split | D ×3 (not the PAYMENT) | 10,000 KBZ, split | 33,000 |
| 6 | mixed with the cash part 0 (KBZ = paid = 30,000) | 30,000 · 0 · 0 | KBZ · '' · '' | credit | D ×3 | — | 53,000 |
| 7 | mixed with the bank part 0 | as 1 (full) or 3 (part) | CASH by `payKey` | as 1 / 3 | as 1 / 3 | — | as 1 / 3 |

A date chosen with a full payment is dropped (1, 2, 4); a bargained part sale carries 'credit', not 'price'. The server's
OVERPAID check sees the PAYMENT after all three SALE rows (core_sync.js:811-815, :823): in outcome 5 the shadow owes
83,000 − 40,000 = 43,000 ≥ 10,000 and in outcome 4 exactly 10,000, so no flag (a PAYMENT pushed after row 1 would raise a
false `ping_overpaid`, which is why step 6 puts it last).

### 3.4 The allocation rule and where DueDay goes

`basketAllocate(amounts, A)` (pure): walk the lines in order, `cash_i = min(amount_i, max(0, A − Σ cash_<i))`. It keeps
`Σ cash_i = A` exactly (whole kyat, no remainder) and `0 ≤ cash_i ≤ amount_i` (the invariant every writer keeps,
core_ledger.js:806, :829), so no row reads as overpaid on its own. Proportional shares and the delivery shape (cash 0 on
every SALE row plus one PAYMENT, core_orders.js) were rejected (design-owner 2.3). The readers that print each row's cash
(the customer statement, the day report, the Ledger tab) show it as it is, which reads naturally (the first lines paid).

DueDay's condition is group-level (owed after the write) and the date goes on every SALE row: under fill-in-order the
first row (the one `saleGroupInfo` reads, core_ledger.js:1166, :1170) is the one most likely fully paid, and a date on
the owing rows only would vanish from Credits, the 21:00 line, the receipt and the sold card. `saleGroupInfo` also takes
the first non-blank `dueDay` of its live SALE rows, then of all its SALE rows (one line of insurance; for every group
written so far the result is unchanged: one SALE row, or a rewrite whose replacement copies the date,
core_ledger.js:1074).

### 3.5 One receipt number per basket

Telegram rows carry no ReceiptNo; `receiptNumber` counts SALE groups per shop (core_ledger.js:1729-1751), so a basket is
already one number. A phone stamps a fresh number on every SALE row today (app/app_store.js:296-299; twin
poc/sim_phone.js:123-126), which would use three numbers for a three-line basket (basket map 2.11). New rule, in both
`appendLedger`s: before stamping, walk the stored ledger backward from its end while `row.groupId === tx.groupId`; the
first such SALE row that is not a mirror and has a `receiptNo` gives its number to `tx`; otherwise stamp anew
(`receiptCounter++`). The rows of one `writeGroup` are appended consecutively under one lock, so the walk finds them.
The counter grows by one per basket and stays gap-free per phone; the PAYMENT never gets a number (run_app.js:967's rule
holds; round6 step 46 re-asserts it on the app store, 10.3). So a phone basket's rows show the same number on every SALE
line in the Sheet's ReceiptNo column. A Telegram basket does not: `backfillSync` writes the number on the FIRST SALE row
of each group only (gas_sync.js:460-467: `seen[GroupID] = true`, then one `setValue`), so its other lines stay blank
(revision 2, m1). No reader depends on the difference: `receiptNumber` and the receipt read the first row
(core_ledger.js:1729-1737).

### 3.6 A counted new piece (`commitNewItem`)

For tag S1-0007 registered with count 3, price 25,000, cost 12,000:

| Where | Written |
|---|---|
| Items (`updateItem`, one outbox `item` entry on a phone, app/app_store.js:286-293) | name (the typed one, or `itemPlaceholderName(id)`), category (a chosen one, else the last of `CFG.CATEGORIES`), **type SKU** (count 1: UNIQUE), price 25000 (`''` when pending; a price of 0 is stored `''`), cost 12000 (`''` when unknown), sample, photoUrl, photoFileId, createdAt, createdBy: the fields and order of `newItemCost` (core_bot.js:2182-2185) |
| Ledger: one group, ONE row | RESTOCK, itemId S1-0007, **qty +3**, amount 0, cash 0, note 'new item' ('new sample' with the sample toggle), source PHOTO (the `importProducts` precedent for a counted SKU, core_ledger.js:1803-1813) |
| The undo (revision 2, M5) | `U\|<g>` within 30 minutes, from the new piece's card (1.5, 2.3): one RESTOCK mirror of −3 (`undoGroup`), then `unregisterItem` writes name, category, type, price, cost, photoUrl, photoFileId, createdAt, createdBy `''` and sample false in ONE `updateItem`: the tag is BLANK again (the status formula reads a blank name, gas_setup.js:371; the phone's `viewItem`, app_store.js:260) and can be registered again. Refused with `undo_new_used` when the piece has a live row outside the group (it was sold, moved or restocked): the RESTOCK alone cannot be mirrored without leaving negative stock, and a UNIQUE at stock 0 reads SOLD |
| Owner (while the price is pending) | the caller sends `notifyOwners(price_ask_owner, priceButtons)` (core_bot.js:2193, :2197-2200); on a phone an outbox notice, relayed after the item and the group (push order customer, item, list, group, measurement, notice: core_sync.js:75) |

Readers: the stock is the sum of the rows (3); `lowStockList` (core_ledger.js:1610-1615) may list it the same evening,
which is right; the card offers `S|<id>|1`, 🔢 and `R|` (a stock-item card, core_bot.js:227-231); later sales write
`costAtSale = item.cost` (core_ledger.js:840), so the 21:00 profit is right from the first sale; an unknown cost counts in
`summary_nocost` as today.

### 3.7 Restock of several tags (`commitRestockGroup`)

One RESTOCK row per line in line order (qty +n, amount 0, cash 0, note '', source BUTTON) in ONE group: one undo
(`undoGroup` mirrors every live row, core_ledger.js:1004-1013), one outbox entry, one clock read. Every reader of a
RESTOCK row reads it per row (stock, `recentItems`, `dayReport`); none sums RESTOCK by group.

### 3.8 An expense

`commitExpense` as it is (core_ledger.js:882-890): one EXPENSE row, amount and cash `−|amount|`, the category key, the
method, **the note in the same write** (the Telegram path adds it later as a rewrite, core_bot.js:2050-2062), source
BUTTON.

### 3.9 Customers and Lists rows

- A buyer typed as new in the form or on the card becomes a Customers row only at Save (`saleResolveBuyer`,
  core_bot.js:3140-3148; an exact name match meanwhile is used, never duplicated, UNLESS `draft.forceNew` is set: the
  seller saw that customer and chose `btn_create_named`, revision 2, U9). The draft spec's earlier "a new phone that
  normalises to one customer's phone resolves to that customer" is DROPPED: it would change the buyer silently on a
  shared family phone. The app form asks instead (`known_phone`, 1.3); Telegram's phone screen already offers the
  match as a choice (`salePhoneTyped`, core_bot.js:2882-2889). On a phone the `customer` entry is queued before the
  group (core_sync.js:75); on the Sheet it is its own `gasLocked` write just before the group (the window round 5
  accepted, SPEC-round-5 2.6).
- An account (`addListOptionByLabel(ports, 'pay_method', label, staff, {kind})`, core_ledger.js:762-786) or an expense
  category (`addListOptionByLabel(ports, 'expense_category', label, staff)`) typed in an app form is written at Save,
  after the Save's checks passed and in the same `phone.commit` as the ledger rows. A refused or abandoned form writes
  no Lists row. The outbox pushes `list` entries before the group (core_sync.js:75).

### 3.10 Settings and CFG (core_config.js)

| Item | Today | Round 6 |
|---|---|---|
| Settings `sale_flow` | `steps` \| `quick`, default `steps` (core_config.js:207-210; seed gas_setup.js:76) | `form` \| `quick`, default `form`; any value but `quick` reads `form` |
| `CFG.SALE_FLOW` (core_config.js:111) | `{ STEPS: 'steps', QUICK: 'quick' }` | `{ FORM: 'form', QUICK: 'quick' }`; its other readers: gas_setup.js:76 (changes in the same step, 11) and core_sync.js:1492 (`syncSettingsQuick` writes `CFG.SALE_FLOW.QUICK`, which is kept; no change) |
| `CFG.BASKET_MAX_LINES` | — | NEW `10` (the lines of one sale or one restock) |
| `CFG.BASKET_NAME_MAX` | — | NEW `24` (an item name on the card and in `basket_name`) |
| `CFG.SOURCE` | BUTTON, VOICE, PHOTO, TEXT, UNDO, SYSTEM, NOTEBOOK, IMPORT (core_config.js:35) | unchanged: the forms write BUTTON (sale, restock, expense) and PHOTO (the new piece), as the chat flows do |
| the pref `setting:sale_flow` | app_store.js:341-344 | unchanged code; no control writes it (the only `setting:` pref with a control is `text_cards`, app_ui.js:888), so it is a test hook (run_app.js step 36) and is not offered to the family (revision 2, m5) |

### 3.11 Phone cache

`formdraft:<kind>:<key>` (1.0). Telegram's card lives in `st:<uid>` (TTL 1800 s). No other new cache key.

---

## 4. Core functions

Every new name below was grepped (0.4) and is free. No new apps-script file.

### 4.1 core_config.js

- `CFG.SALE_FLOW: { FORM: 'form', QUICK: 'quick' }` (:111; `STEPS` removed); the comment at :109-110 says "Settings
  sale_flow = form (the app's forms and the Telegram review card) or quick (the one-tap card with the corrective
  buttons); saleFlow(ports) reads it on every tap".
- `CFG.BASKET_MAX_LINES: 10`, `CFG.BASKET_NAME_MAX: 24`, beside `MAX_SALE_QTY` (:108).
- `saleFlow(ports)` (:207-210): `return String(ports.store.getSetting('sale_flow', CFG.SALE_FLOW.FORM) ||
  '').trim().toLowerCase() === CFG.SALE_FLOW.QUICK ? CFG.SALE_FLOW.QUICK : CFG.SALE_FLOW.FORM;` Its doc line: "'quick'
  when the value is the word quick in any case, else 'form' (the default; round 5's steps reads as form). Never cached."

### 4.2 core_ledger.js (it calls nothing of core_bot.js, core_orders.js, core_sync.js)

Pure helpers (no ports):

```
basketAllocate(amounts, cash) -> [n]
  // 3.4: cash_i = min(amount_i, max(0, cash - Σ cash_<i)) in order; Σ = cash when cash <= Σ amounts; each 0..amount_i.
basketTotals(lines, pay) -> {amounts, total, paid, bankPart, cashPart, owed, payKey, twoRows, rowCash, rowMethod, pending}
  // lines = [{qty, unitPrice}] (unitPrice null, undefined or '' = a price-pending line: amount 0, its index in pending);
  // pay = {part, paid, method, mixed, bankPart}: paid now = part ? paid : the total. Steps 2-5 of 3.2 without rows.
  // The form's running line, the card's text, basketCheck and commitBasket all call it.
saleDueKey(now, choice) -> 'yyyy-mm-dd' | '' | null
  // choice: a whole number of days 0..CFG.SALE_DUE_MAX_DAYS (a number or a digit string) -> addDaysKey(dayKey(now), n);
  // 'none' or '' -> ''; any other text -> parseDayText(text, now, {noRoll: true}) (core_burmese.js:103), kept only from
  // dayKey(now) to dayKey(now) + SALE_DUE_MAX_DAYS; else null (refused). saleDuePick and saleDueTyped
  // (core_bot.js:2993-3025) and the app's due row call it: the bounds live in one place.
itemMargin(price, cost) -> {profit, pct} | null
  // null unless both are whole numbers >= 1; profit = price - cost; pct = Math.round(profit * 100 / cost) (markup on cost).
itemPlaceholderName(id) -> 'ပစ္စည်း ' + id
  // the placeholder name; handlePhoto (core_bot.js:2121), replayJob (app_sync.js:390) and sim_phone.js:700 call it
  // instead of their literals.
basketGroup(info) -> boolean                                                     // revision 2, M4
  // !!info && info.rows.length > 1 && !isOrderId(info.groupId). info = saleGroupInfo(...) (its rows are the live SALE
  // rows). THE guard of every basket reader branch (openCredits, cardText, the U/V reply, customerLines, describeGroup,
  // the owner's void rows): a custom-order delivery writes one SALE row per voucher line into the order's group, with
  // pseudo item ids order.id + '-' + line (core_orders.js:263-272), and keeps today's text everywhere.
aiRenameFields(item, desc) -> {name, category?} | null
  // the one rule of the photo AI's late rename (6.2): null unless item && desc && desc.name &&
  // String(item.name) === itemPlaceholderName(item.id); category is included only when CFG.CATEGORIES lists
  // desc.category and item.category is '' or the fallback (the last of CFG.CATEGORIES). A BLANK item (name '') is
  // never renamed and a typed name is never replaced. 'အခြား' is both the fallback and a chip the seller may pick: it
  // is the catch-all, so the AI's category replaces it either way (revision 2, m4); any other chosen category is
  // never replaced. W25 pins exactly this.
```

Store readers (they write nothing):

```
basketAddItem(ports, staff, lines, itemId, qty, opts) -> {ok: true, lines, index, merged} | {ok: false, reason, vars}
  // Returns new arrays; `lines` is never mutated. qty is clamped to 1..MAX_SALE_QTY (default 1). The basket's shop is
  // lines[0]'s item's shop; with no line it is staff.shop for a seller, the item's shop for the owner.
  // Reasons, checked in this order: 'missing' (no item) · 'blank' (status BLANK) · 'other_shop' (item.shop differs from
  // the basket's shop) · without opts.restock: 'gone' (a UNIQUE with stock <= 0), 'twice' (a UNIQUE already in);
  // with opts.restock: 'unique' (any UNIQUE) · 'max' (a new item when lines.length >= CFG.BASKET_MAX_LINES).
  // A stock item already in: that line's qty + qty (capped), merged true, index = that line. Else a new line at the end:
  // {id, qty, unitPrice: Number(item.price) when > 0, else null (a price-pending piece is accepted), priceChanged: false}.
  // vars = {id, shop: shopName(ports, item.shop), max: myDigits(CFG.BASKET_MAX_LINES)}.
  // The merge (+qty on a stock item already in) serves Telegram's add screen, where every scan follows ➕. The app's
  // forms never call it for an id that is already a line (0.3 rule 14): appSaleAdd / appRestockAdd answer
  // ui_form_twice / basket_twice first.
  // Keys: missing tag_not_found · blank basket_blank · other_shop basket_other_shop · gone basket_gone ·
  //       twice basket_twice · unique basket_unique · max basket_max.
basketCheck(ports, staff, draft, opts) -> {ok, problems: [{code, id, key, vars}]}
  // The Save-time re-check shared by the app form and the review card. draft = the state draft of 2.1 (plus, from the
  // app, needAccount: 'bank' | 'all' when 🏛 or 💵+🏦 is chosen without an account). Every line is re-read. Codes in this
  // order (the first is what the seller sees):
  //   mode        saleFlow(ports) is not 'form'                                   expired
  //   empty       no line                                                         scan_first
  //   per line, in line order: missing tag_not_found · blank basket_blank · other_shop basket_other_shop ·
  //     gone (a UNIQUE now at stock <= 0) basket_line_gone · twice basket_twice · need_price (unitPrice null or < 1)
  //     basket_need_price · qty (not a whole 1..999) bad_qty{max}
  //   max         more than BASKET_MAX_LINES lines                               basket_max
  //   method      the key is not methodKnown (skipped with opts.pendingMethod)    basket_method_gone (revision 2, U21h;
  //               the caller sets the draft's method to CASH, mixed off, so the next Save is a checked choice)
  //   account     needAccount set and no account key                              sale_ask_account / sale_ask_split_account
  //   transfer    mixed and not 1 <= bankPart <= paid now                         sale_bad_amount{min 1, max paid now}
  //   paid_none   part and no amount                                              sale_ask_paid{total}
  //   paid        part and not min <= paid <= total - 1 (min = mixed ? bankPart : 0)   sale_bad_amount{min, max}
  //   need_buyer  owed > 0, no customerId and no newName                          sale_need_buyer
  //   phone       a new buyer's phone of 1-6 digits (normPhone)                   basket_bad_phone
  //   due_none    owed > 0 and dueDay absent                                      sale_ask_due{owed}
  //   due         owed > 0, dueDay not '' and not a day from today to +365        ord_bad_date
basketName(ports, info) -> string
  // fill(basket_name, {n, names}): the item names of info.rows (the live SALE rows) in row order, each cut to
  // CFG.BASKET_NAME_MAX characters (with '…'), the first three joined by ', ', then ', …' when there are more.
creditOpenFor(ports, itemId) -> {groupId, customerId, owed} | null              // revision 2, M3
  // s = lastLiveSale(ports, itemId) (core_ledger.js:1204-1208); info = s ? saleGroupInfo(ports, s.groupId) : null;
  // the triple when info && !isOrderId(info.groupId) && !info.voided && info.owed > 0, else null. case 'T' reads it.
newItemUndoInfo(ports, groupId) -> {itemId, used} | null                        // revision 2, M5
  // g = groupRows(ports, groupId) (core_ledger.js:981-985): non-null only when g.live is exactly one RESTOCK row whose
  // note is 'new item' or 'new sample'; itemId = that row's item; used = true when the item has a live ledger row in
  // any other group (a sale, a restock, a transfer, a return).
```

Writes:

```
commitBasket(ports, p) -> {groupId, txs, sales, payment, owed, total}          // 3.2
commitSaleGroup(ports, p)                                                       // the wrapper of 3.2, same return as today
commitNewItem(ports, p) -> {ok: true, item, groupId, pending} | {ok: false, reason}
  // p = {itemId, name, category, price, cost, count, sample, photoUrl, photoFileId, staff, source, updateId, when}.
  // Refusals (nothing written): 'missing' · 'not_blank' (status is not BLANK: registered meanwhile) · 'other_shop'
  // (revision 2, m7: staff.role !== 'owner' and item.shop !== staff.shop; today such a RESTOCK is quarantined
  // `scope` on the server, core_sync.js:361-370, and the piece reads SOLD at stock 0) · 'count' (not a
  // whole 1..999) · 'price' (absent, or neither '' nor a whole number >= 0) · 'cost' (neither ''/absent nor a whole
  // number >= 0). A price of 0 is stored ''. An empty name becomes itemPlaceholderName(id); a category outside
  // CFG.CATEGORIES becomes the last one. One clock read. Then updateItem with the fields and order of newItemCost
  // (core_bot.js:2182-2185; type count > 1 ? SKU : UNIQUE; createdAt = when, createdBy = staff.id) and ONE commitRestock
  // {qty: count, note: sample ? 'new sample' : 'new item', source: p.source || PHOTO, updateId, when}.
  // pending = the stored price is ''. The caller (core_bot.js newItemSave, the app's appNewItemSave) sends notifyOwners
  // (core_ledger.js may not call core_bot.js).
commitRestockGroup(ports, p) -> {ok: true, groupId, txs} | {ok: false, reason}
  // p = {lines: [{item, qty}], note, staff, source, updateId, when}. Refusals (nothing written): 'empty' · 'max' (more
  // than BASKET_MAX_LINES) · 'qty' (a qty not a whole 1..999) · 'unique' · 'blank' · 'other_shop' (two shops, or a
  // seller's line of another shop). One clock read, one RESTOCK row per line in commitRestock's shape
  // (core_ledger.js:857-864), one writeGroup. commitRestock stays for the one-item paths.
unregisterItem(ports, itemId)                                                   // revision 2, M5
  // ONE updateItem(itemId, {name: '', category: '', type: '', price: '', cost: '', sample: false, photoUrl: '',
  // photoFileId: '', createdAt: '', createdBy: ''}): the row a blank tag has (generateBlankTags, gas_setup.js:356-371,
  // leaves every column but ID and Shop empty), so the status reads BLANK again. Only case 'U' calls it, right after
  // undoGroup mirrored a new-piece group that newItemUndoInfo found unused.
```

Changed:

| Function (line) | Change |
|---|---|
| `commitSaleGroup` (:824-855) | the wrapper of 3.2; its doc comment says so |
| `saleGroupInfo` (:1152-1176) | `dueDay` = the first non-blank `dueDay` of `live`, then of `saleRows`, else `''` (3.4); nothing else |
| `openCredits` (:1253-1256) | after today's `itemName` line: `if (basketGroup(info)) itemName = basketName(ports, info);` (the voucher branch is unchanged) |

Unchanged, and why: `writeGroup`, `newTx` (the single clock read is `commitBasket`'s `when`), `groupMethods` (per-row
method sums), `receiptNumber` (3.5), `rewriteCheck` (a basket is `complex`: every corrective path refuses it, as round
5's D3 wants), `commitPayment` / `applyDeposit` (the group's owed; they copy line 1's itemId, as a delivery does),
`dayStats` / `monthStats` / `buildDailySummary`, `customerSummaryMap` (the buyer is on every row), `customerHistory`
(its one caller, the customer card, now goes through `customerLines`), `lastLiveSale`, `recentItems`, `commitSale`,
`commitRestock`, `commitExpense`, `importProducts`.

### 4.3 core_report.js

- NEW `describeGroup(ports, txs) -> string`, beside `describeRow` (:91-99): `live = liveRows(txs)`; when the group id is
  not an order id (`!isOrderId(txs[0].groupId)`, the guard of `basketGroup`, revision 2, M4) and it has more than one
  live SALE row: `txLabel(SALE) + ' ' + t(ports, 'basket_line', {n: fmtCount(n), amount: fmtMoney(Σ amount)})` + (a
  customer: `' · 👤 ' + customerName`); with more than one live RESTOCK row (the same guard): `t(ports,
  'restock_group_done', {n: fmtCount(n), qty: fmtCount(Σ qty)})`; else `describeRow(ports, live[0] || txs[0])`, so a
  one-row group and a delivery read as today (run_app.js:248-249 stay green). The app's pending lines use it (7.5).
- Unchanged: `buildReceipt` / `receiptText` / `receiptReport` (:331-409, one line per row), `dayReport` (:169-198), the
  three credit tables (:227-230, :280-282, :311-320, which follow `openCredits`), `customerReport` (:265-290).

### 4.4 core_bot.js

**Predicate and hook.** `formsInApp(ports)` = `saleFlow(ports) === CFG.SALE_FLOW.FORM && !!(ports.ui &&
ports.ui.openForm)` (the `measureFormEnabled` shape, :4183). `ports.ui.openForm(kind, req)`: `kind` is `'sale'`,
`'newitem'`, `'restock'` or `'expense'`; `req = {chatId, uid, staff, itemId, qty, unitPrice, priceChanged, focus}` (the
fields a kind needs; `focus: 'price'` opens the line's price keypad). The core clears its state first and sends nothing
itself (the `startMeasureFor` precedent, :4199). Telegram and the reference phone (poc/sim_phone.js) have no `ports.ui`,
so they get the review cards.

**Entry points** (the only lines outside the sale and new-piece sections that change):

| Where (line) | Today | Round 6 |
|---|---|---|
| `ITEM_ACTIONS` (:431) | … `SS`, `SC` | + `NI`, `NC` |
| `MUTATING_ACTIONS` (:435-436) | … `SC` | + `NC` |
| the `S` exemption (:446) | `saleFlow(ports) === 'steps'` | `=== 'form'` |
| `case 'S'` (:463-472) | steps: `startGuidedSale` | form: `startSaleFor(sctx, item, clampQty(arg), {})`; quick unchanged |
| `case 'Q'` (:473-481) | steps: the grid as a flow screen | the steps branch removed; `formsInApp` → `startSaleFor(sctx, item, 1, {})`; else `askQty(chatId, uid, item, ports)` as quick (its digits are `S\|id\|n`) |
| `case 'QN'` (:482-493) | steps branch | removed; `formsInApp` → `startSaleFor(sctx, item, 1, {})`; else quick's prompt (:490-491) |
| `case 'D'` (:494-510) | steps branch | removed; `formsInApp` → `startSaleFor(sctx, item, 1, {price: true})`; else quick's prompt (:505-506), whose typed price reaches `startSaleFor` in form mode |
| `case 'SS'` / `'SC'` (:511-512) | `saleCallback` / `saleCommit` | `basketCallback` / `basketSave` |
| `case 'R'` (:513-517) | the presets | `formsInApp` → `clearState`, `ports.ui.openForm('restock', {chatId, uid, staff, itemId: id})`; else as today |
| `case 'T'` (:528-535) | `commitReturn` with `{item, qty: 1}`: a full cash refund, no group, no buyer | revision 2, M3: first `var open = creditOpenFor(ports, id)`; when it is set nothing is written and the message becomes `cardText(item) + '\n' + t(ports, 'ret_credit_open', {customer: customerName(ports, open.customerId), owed: fmtMoney(open.owed)})` with `cardKeyboard(item)` + `ownerBasketRow(ports, staff, item)` (the owner's 🧾, whose receipt offers 🚫); else today's return. Both modes, every role |
| `case 'K'` (:577) | `openTag` | `openTag(chatId, id, staff, uid, ports, {card: true})` |
| `case 'P'`, `'C'`, `'PS'` (:573-575) | the photo chain | with `state.form`: set the field and redraw the new-piece card (2.3); quick unchanged |
| NEW `case 'NI'` / `'NC'` | — | `newItemCallback` / `newItemSave` |
| `startExpense` (:1939-1949) | the chat flow | `formsInApp` → `clearState`, `ports.ui.openForm('expense', {chatId, uid, staff})`; else as today |
| `openTag(chatId, itemId, staff, uid, ports, opts)` (:105-129) | order branches; BLANK → `new_item`; else clear the state and the card | after the two order branches: (1) a live basket at step `add` and not `opts.card` → `basketAddScanned`; (2) BLANK: in form mode a seller's tag of the other shop → `basket_other_shop` as a message, no state (revision 2, m7); else `formsInApp` → `clearState`, `openForm('newitem', {chatId, uid, staff, itemId})`; else `basketClose`, then today's `new_item` state (with `form: true` when `saleFlow` is form) and `new_tag`; (3) `formsInApp && !opts.card && basketAddItem(ports, staff, [], itemId, 1).ok` → `clearState`, `setLastItem`, `openForm('sale', {chatId, uid, staff, itemId, qty: 1})`; (4) a live Telegram basket (not at `add`) and not `opts.card` → `basketPause` (2.2; the basket is kept, the item card offers `➕ စာရင်းထဲ ထည့်`), `setLastItem`; (5) else `clearState`, `setLastItem`, `sendItemCard` (today). Under quick (2) and (4) never apply |
| `applyAwaitedNumber` (:765-820) | steps branches of `sale_price` (:769-778), `sale_qty` (:779-799) | `sale_price`: with `state.saved` (a basket) → the open line's price (below 1: the prompt again, the state set again), then the card as a new message; without: quick as today; form → below 1: `ask_sale_price` again with `[Z]` and the state set again, else `startSaleFor(sctx, item, 1, {unitPrice: n, priceChanged: true})`. `sale_qty`: with `saved` → the open line's count (bad: `bad_qty` with the line's back row, the state kept); without: quick as today; form → bad: `bad_qty` with `[Z]`, the state kept, else `startSaleFor(sctx, item, n, {})`. `sale_step` (:815): `saleNumber`, which now exits to `basketNext` or the card |
| `handleText` (:723, :732-735) | `saleText`; the photo chain's numbers | `saleText` adapted; the new-piece card's steps: `name` takes any text (before the number path), `price`, `cost`, `count` take a number; at step `card` (revision 2, U12) a number ≥ 500 is the price, a smaller number answers the card with `ask_price` on top, other text is the name (2.3) |
| `handlePhoto` (:2125-2131) | `priceScreen` | form: `state.form = true`, `step 'card'`, `draft.count = 1`, a caption number ≥ 500 is the price, then `newItemCardShow`; a photo while `state.form` is already set replaces only `photoUrl` / `photoFileId` and sends the card again (revision 2, U12); quick unchanged |
| `handleIntent` (:843-849, :890-896, :904-918, :931-934) | spoken answers into the step | the same, into the open sub-screen; a spoken count goes to the open line |
| `confirmProposal` (:1129-1130) | a spoken sale of the piece clears the live flow | the same when the piece is any line of the live basket |
| `cardText` (:185-210) | `card_buyer` on a sold UNIQUE | `card_buyer_basket` when `basketGroup(info)` (5.1; a delivery keeps `card_buyer`, revision 2, M4) |
| `case 'U'`, `case 'V'` (:541-560) | `undo_done` / `void_done` + the first item's card | when `!isOrderId(id)` and `u.types` (core_ledger.js:1016) holds more than one SALE, or more than one RESTOCK: `undo_done` / `void_done` + `orderUndoLine` + one `group_item_line` per distinct item of the group's rows that `getItem` finds (an id with no Items row is skipped, as today's `after ? … : ''`, :548-550, :557-559), in row order, with its stock now; a delivery and a mixed one-item sale (SALE + PAYMENT) keep today's reply (revision 2, M4). `case 'U'` also (revision 2, M5): before `undoGroup`, `ni = newItemUndoInfo(ports, id)`; `ni && ni.used` → `edit(undo_new_used{id})`, nothing written; after an accepted undo with `ni` → `unregisterItem(ports, ni.itemId)` and the reply `undo_done` + '\n' + `item_unregistered` '🏷 {id} · Tag အသစ် ပြန်ဖြစ်ပါပြီ' (NEW), no card |
| `sendReceipt` (:2080-2084) | the receipt text + `[📄 PDF]` | + `[voidButton(ports, g)]` as a second row when `staff.role === 'owner'`, `basketGroup(info)` and `!info.voided` (revision 2, M6); every other receipt unchanged |
| `sendItemCard(chatId, item, staff, ports, opts)` (:236-243) | `cardText` + `cardKeyboard` | `opts.undo` (a group id) puts `undoRow(ports, opts.undo)` first (the form-mode new piece, M5); `opts.addTo` (`{anchor}`) puts `[btn_add_to_list → SS\|<anchor>\|i\|<id>]` first (the pause, U10); `ownerBasketRow(ports, staff, item)` is appended for the owner (M6). Without opts and for a seller: today's card byte for byte |
| `customerCard` (:1681-1702) | `customerHistory(…, 8).map(customerLine)` (:1689) | `customerLines(ports, customerId, CFG.CUST_HISTORY_LINES)` |
| `saleCardText` (:3194-3218) | the first item's card + `sold_done` | when `basketGroup(info)`: `basket_sold` + one `basket_sold_line` per live SALE row, then the group lines exactly as today (`credit_done` / `cust_attached`, `split_done` / `method_done`, `sale_due_set`, `acct_detail_hint`); one row: unchanged |
| the header legend (:20-31) | the `SS\|`/`SC\|` lines | the card's letters (2.1) and `NI\|`, `NC\|` |

**NEW functions.**

```
formsInApp(ports) -> boolean
startSaleFor(ctx, item, qty, opts)
  // opts = {unitPrice, priceChanged, price}. add = basketAddItem(ports, ctx.staff, [], item.id, qty). Refused: the tapped
  // message (or a new one) becomes cardText(fresh) + '\n' + the reason's text + cardKeyboard(fresh), no state (round 5's
  // S✖ pattern; 'gone' answers sale_gone '⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ' (:444), the others their basketAddItem key).
  // opts.unitPrice sets that line's unitPrice and priceChanged. formsInApp: clearState, setLastItem,
  // ports.ui.openForm('sale', {chatId, uid, staff, itemId, qty, unitPrice, priceChanged, focus: opts.price ? 'price' : ''}).
  // Else startBasket(ctx, item, add.lines).
startBasket(ctx, item, lines)
  // A second identical tap on the message that already shows this one-line card: no edit (round 5's rule). Another live
  // basket card (paused or not): basketClose. Then state {kind: 'sale', step: 'card', item: item.id, msgId: ctx.msgId,
  // cap: ctx.isCaption, line: '', draft: {lines}}, setLastItem, saleRedraw (the card on the tapped message, or a new one).
basketClose(ports, chatId, uid)
  // A live basket state (saleStateOf) with a msgId, in Telegram (not formsInApp): edit that message to basket_closed
  // (reworded, revision 2) with no buttons and isCaption = state.cap, then clearState. Called by startBasket only: a new
  // sale replaces the old basket; a scan never does (basketPause).
basketPause(ctx, state, item)                           // 2.2, revision 2, U10
  // edits state.msgId (isCaption state.cap) to basket_paused{n} with [btn_resume → SS|<a>|go]; state.paused = true;
  // r = sendItemCard(ctx.chatId, item, staff, ports, basketAddItem(ports, staff, state.draft.lines, item.id, 1).ok ?
  // {addTo: {anchor: state.item}} : {}); state.resume = r && r.messageId; setState. Under quick it is never called.
ownerBasketRow(ports, staff, item) -> rows              // revision 2, M6
  // [] unless staff.role === 'owner'; s = lastLiveSale(ports, item.id); info = s ? saleGroupInfo(ports, s.groupId) :
  // null; basketGroup(info) && !info.voided → [[btn(t(ports, 'btn_receipt'), 'RC|' + info.groupId)]], else [].
basketHead(ports, state) -> 'basket_title\nbasket_total'
basketCardText(ports, state, prefix) -> string          // 2.1; prefix = a refusal line on top
basketCardKeyboard(ports, state) -> rows                // 2.1
basketCallback(ctx, parts, item, message)
  // SS|<a>|<letter>|<arg>: z → saleCancel; back → saleBack; go → unpause and redraw the card on state.msgId; else
  // saleGuard with SALE_STEP_OF[letter] (the round-5 map, adapted; one name, revision 2, U22), then the handler:
  // o (open buyer/method/paid/due; method snapshots state.undo), l (the line sub-screen, state.line = arg), add, i (on
  // the card's message at step add, or on state.resume while paused: the item card becomes the card), q, qn, pr, rm,
  // and round 5's b, ph, m, a, x, p (+ 'all'), d, k.
basketAddScanned(ctx, state, item)                      // 2.2
basketNext(ctx, state, prefix)
  // after the paid, buyer and due answers: owed and no buyer → 'buyer' (the need-buyer view); owed and dueDay absent →
  // 'due'; else 'card'. Owed comes from basketTotals.
basketProblemText(ports, problem) -> t(ports, problem.key, problem.vars)
basketCommitDraft(ports, staff, draft, opts) -> {ok: true, r, customer} | {ok: false, problems}
  // THE shared Save of both channels. opts = {uid, updateId, source, pendingMethod}.
  // 1. chk = basketCheck(ports, staff, draft, {pendingMethod}); refused → {ok: false, problems}.
  // 2. customer = saleResolveBuyer(ports, draft) (the Customers row is written here, at Save only).
  // 3. r = commitBasket(ports, {lines (each item re-read), paid: draft.part ? draft.paid : null, method, bankPart, mixed,
  //    customerId: customer ? customer.id : '', dueDay: draft.dueDay || '', staff, source: opts.source || BUTTON,
  //    updateId: opts.updateId}).
  // 4. setLastItem(ports, opts.uid, first line's id), setLastGroup(ports, opts.uid, r.groupId) (core_bot.js:3249-3259).
basketSoldReply(ports, chatId, msgId, isCaption, r, draft, customer)
  // saleCommit's tail (:3176-3186): markCommittedCard when msgId; saleCardText(r.groupId, draft.addedKey); the deposit
  // question when customer && r.owed > 0 && depositsFree(ports, customer.id) > 0 (CD| buttons with |p and addedKey), else
  // saleCardKeyboard(r.groupId, draft.addedKey, customer); editOrSend (msgId null sends a new message: the app's sold card).
basketSave(ctx, item, message)
  // saleGuard at step 'card'; basketCommitDraft(..., {uid, updateId, source: BUTTON}); refused: remove the tap key
  // 'tap:<chat>:<msg>:SC|<a>|ok', then the card again with basketProblemText(first) on top (a 'mode' refusal instead
  // clears the state and turns the message into the anchor's item card with expired on top; a 'method' refusal sets the
  // draft's method to CASH, mixed off, before the redraw); ok: clearState, basketSoldReply.
saleShow(state, ctx, r)
  // state.msgId = saleShownId(ctx, r); state.cap = !(r && r.messageId) && !!ctx.isCaption. Every place that moves
  // state.msgId uses it (a new message sets cap false).
customerLines(ports, customerId, n) -> [string]
  // customerHistory(ports, customerId, 0) (core_ledger.js:1384-1389: n = 0 returns every row, newest first); the SALE
  // rows of a group with more than one live SALE row and not an order id (basketGroup's guard: a delivery keeps one line
  // per voucher row, revision 2, M4) collapse into ONE cust_line (:153) '{day} · {desc} · {amount}{paid}{method}':
  // desc = txLabel(SALE) + ' ' + basket_count{n} ('🛍 {n} ခု', NEW; the amount is cust_line's own {amount}, printed
  // once, revision 2, m2), amount Σ, cust_line_paid (:154) with Σ cash when it differs from Σ amount, the method of the
  // rows that carry cash; a PAYMENT or DEPOSIT_APPLIED of such a group keeps its own line; then the first n entries.
  // A one-row group gives exactly customerLine(ports, r) (:1672-1678).
newItemCardText(ports, state, prefix) / newItemCardKeyboard(ports, state, staff)     // 2.3
newItemCardShow(chatId, msgId, uid, state, staff, ports, prefix)
  // edits the card on msgId (isCaption false: the card is a text message), or sends it when msgId is null; stores msgId.
newItemCallback(chatId, msgId, uid, parts, staff, ports)       // NI|<id>|…: q|-, q|+, qn, n, c, c|<i>, back
newItemSave(chatId, msgId, uid, itemId, staff, updateId, ports) // NC|<id>|ok (2.3); other_shop answers basket_other_shop;
  // accepted: sendItemCard(..., {undo: r.groupId}) (M5)
var SALE_PARENT = { line: 'card', add: 'card', buyer: 'card', name: 'buyer', phone: 'buyer', method: 'card',
  account: 'method', bank: 'method', kind: 'method', paid: 'card', due: 'card', due_text: 'due' };
```

`saleResolveBuyer` (:3140-3148) gains one rule (revision 2, U9): with `draft.forceNew` the exact-name merge (:3142-3144)
is skipped and the Customers row is created (the app sets it when the seller taps `btn_create_named` past a customer of
that name; Telegram never sets it). The earlier draft's phone rule (a new phone resolving silently to the customer who
has it) is dropped: the app asks (`known_phone`, 1.3) and Telegram's phone screen offers the match (run_wizard.js:353).

**The round-5 section (core_bot.js:2287-3224), function by function** (map-core-commits 7.3, settled). Dead code goes in
step 1 together with the checks that pin only it (10.1).

| Verdict | Functions |
|---|---|
| **REUSE as is** | `saleCtx`, `saleShownId`, `saleDuePresets`, `saleSoldCard`, `saleStateOf`, `saleScreenLookalikes`, `saleScreenName`, `saleScreenPhone`, `saleAccountCandidates`, `saleScreenAccount`, `saleScreenBankPart`, `saleScreenKind`, `saleScreenDueText`, `saleScreenBuyer`, `saleCancel`, `saleAddNamed`, `saleCardKeyboard`, `saleBankFromCash` (they read the basket through the two adapted helpers below) |
| **ADAPT** | `saleHeader` (→ `basketHead`, + `sale_line_paid` with `opts.paid` on a part payment), `saleTotal` (→ `basketTotals(draft.lines, …).total`), `SALE_STEP_OF` (→ the letter map of 2.1: `q`, `qn`, `pr`, `rm` → line; `o`, `l`, `add` → card; `i` → add; round 5's others unchanged), `saleGuard` (rule (c) through the new map), `saleGo` (sets the step and redraws; the `hist` push deleted), `saleRedraw` (`card` draws the card; `saleShow`), `saleScreenFor` (+ `card`, `line`, `add`; `qty` and the summary default removed), `saleBackRow` (`back\|<step>` ALONE: `z` leaves the sub-screens and their typed prompts, revision 2, U11), `saleBack` (the parent of `SALE_PARENT` instead of `hist`; a live prompt redraws its screen; back to the card restores `state.undo`), `saleQtyGrid` (1..9 on `state.line`, the line screen's rows), `saleScreenMethod` and `saleScreenDue` (the basket's total and owed), `saleScreenPaid` (first button `p\|all` with `btn_paid_full`), `saleAfterAccount` (mixed → the transfer part, else the card; drops `state.undo`), `saleQtyPick` / `saleQtyTyped` (the open line; exit the card), `saleBuyerPick`, `saleBuyerChosen`, `saleBuyerNamed`, `salePhoneTyped`, `salePhoneSkip` (every exit that called `saleNext` calls `basketNext`; the look-alikes are drawn with `saleGo(..., 'buyer', ..., {look})`), `saleMethodPick`, `saleAccountPick`, `saleBankHalf` (exits through `saleAfterAccount`), `saleNumber` (`bank` → the card; `paid`: ≥ total → full and the card, else part and `basketNext`), `salePaidPick` (+ `all`; a part answer → `basketNext`), `saleDuePick`, `saleDueTyped` (through `saleDueKey`; exit `basketNext`), `saleKindPick` (back to step `method`, then `saleAfterAccount`), `saleAccountResume` (sets the step directly), `saleIntentClashes`, `saleResend` (any line; the open screen), `saleText` (`card`: a buyer search; `line`: a count; `add`: a name search listing up to four `i\|<id>` matches, a tag id being caught earlier, revision 2, U25), `saleResolveBuyer` (+ `forceNew`), `saleCardText` (the basket branch) |
| **DEAD, deleted** | `saleNext` (two of its rules survive: a part payment needs a buyer, in `basketNext` and `basketCheck`; one account is picked for you, in `saleMethodPick`), `saleBuyerScreen` (the `hist` trick), `SALE_BACK_CLEARS` (:2309-2312), `saleScreenSummary` (:2714-2720), `saleScreenQty` (:2567-2569), `startGuidedSale` (:2393-2406, → `startBasket`), `saleFromPrice` (:2412-2431, → `applyAwaitedNumber` and the line), `saleCommit` (:3155-3187, → `basketSave` and `basketSoldReply`), the `steps` branches of `Q`/`QN`/`D` (:474-479, :483-489, :495-504) and of `applyAwaitedNumber` (:772, :783-789, :793), and the `opts.steps` branch of `askQty` (:255-258 keeps `opts.price` only if a caller remains; with none it is deleted too) |
| **NEW** | the functions above |

### 4.5 core_messages.js

Every key of section 9 is added in step 1 in a "round 6" block; one key changes its text. No key is deleted (run_gas.js:1498
`R5_KEYS`, run_wizard.js:1619 and :1623 still require round 5's).

---

## 5. Readers (R7)

Every change applies only when `basketGroup(info)` holds (4.2: more than one live SALE row AND not a custom-order
delivery; for a restock group, more than one live RESTOCK row and not an order id). A one-line group, a delivery (one
SALE row per voucher line, core_orders.js:263-272, revision 2, M4) and a mixed one-item sale take today's path byte for
byte. The example is 3.3 row 5 (83,000; paid 50,000 = 40,000 cash on rows 1-2 and 10,000 KBZ; owed 33,000; date D;
ဒေါ်မြင့်).

### 5.1 Reader by reader

| Reader (file:line) | On a basket today (basket map) | Change | Pinned by |
|---|---|---|---|
| sold card `saleCardText` core_bot.js:3194-3218 | the first item's card, the summed qty, the first item's stock | `basket_sold` + one `basket_sold_line` per row; the group lines unchanged; `saleSoldCard` still recognises it | W27a |
| the item card's buyer line `cardText` core_bot.js:185-210 | '👤 ဒေါ်မြင့် · ပေးပြီး 50,000 · …' under a 25,000 piece (breaks) | `card_buyer_basket` '👤 {customer} · 🛍 {n} ခု · ပေးပြီး {paid} · {method}': the figure is said to be the basket's | W27b |
| the Credits item `openCredits` core_ledger.js:1253-1256, so the Credits tab (gas_store.js:710-716), the three credit reports (core_report.js:227-230, :280-282, :311-320), the simulator's Credits (poc/sim_ui.js:866-878) | the first item's name | `basketName`: '🛍 ၃ ခု · လုံချည် ကချင် အပြာ, ထမီ ဇင်းမယ် အဝါ, ထမီ ချည်သား အနီ'; ItemID stays the first item's; no new column | W27c, gas 26 |
| `saleGroupInfo` core_ledger.js:1152-1176 | sums right; row 1 for the rest | `dueDay` from the first dated live row (3.4) | W27f, W26 |
| `creditOverdue` core_ledger.js:1214-1216 | DueDay-based | none (DueDay on every row) | W27f |
| undo / void reply core_bot.js:541-560 | `undo_done` + the first item's card | `undo_done` / `void_done` + one `group_item_line` per item that has an Items row (types-based: also a multi-line restock group; never a delivery) | W27d, W27(i), W28 |
| customer card `customerCard` core_bot.js:1681-1702 | three of its eight lines for one sale, each with its own cash | `customerLines`: ONE line '{day} · ရောင်း 🛍 ၃ ခု · 83,000 · ပေး 40,000 · ငွေသား' (`cust_line` with desc 'ရောင်း ' + `basket_count`, the amount once, revision 2, m2) and the PAYMENT's own line; a delivery keeps one line per voucher row | W27e, W27(i) |
| the 21:00 summary core_ledger.js:1617-1682 (overdue line :1653-1666) | right only if row 1 carries the DueDay | none: B3 puts it on every row | W27f, SIM.smoke 21:00 |
| receipt / PDF core_report.js:331-409, the server's receipt (core_sync.js:1290-1293) | one line per item, right | none | W27g |
| `dayStats`, `monthStats`, Dashboard (gas_setup.js:398-430), `answerToday` (core_bot.js:1051) | per row, right | none | W27g |
| `groupMethods` core_ledger.js:1189-1201, `undoGroup` :992-1017, `rewriteCheck` :1029-1044 (`complex`) | right | none | W26 |
| `commitPayment`, `applyDeposit`, `payPick`, `showPayList` | the group's owed; line 1's itemId copied | none | W27h |
| a return `T\|` core_bot.js:528-535 (revision 2, M3) | a full cash refund with no group and no buyer; the credit stays owed | refused while the piece's sale still owes (`creditOpenFor`, `ret_credit_open`, 1.10) | W33 |
| the owner's receipt reply `sendReceipt` core_bot.js:2080-2084 and item card (revision 2, M6) | no way to void a basket after 30 minutes but a `stock_negative` ping | `btn_void` on the receipt of a basket and 🧾 on the item card, owner only | W27(j) |
| the app's pending lines `pendingLines` app/app_sync.js:496-503 | `describeRow` of the first row | `describeGroup` | run_app 55 |
| the phone's receipt counter app_store.js:296-299, sim_phone.js:123-126 | one number per row | one per group, copied (3.5) | run_app 44, 46, R6a |
| the simulator's Ledger tab poc/sim_ui.js:707-724 | N unrelated-looking rows | a narrow `Basket` column '🛍 i/n' on the rows of a group with 2+ SALE rows (page copy) | 10.7 manual |
| the server: validation, `overpaid` core_sync.js:361-445, :811-815 | accepts; right while the PAYMENT is last | none (B1, B6) | R6a, R6c |
| the server's `stock_negative` ping `syncFlagPing` core_sync.js:634-637, :806-810 (revision 2, M2) | one over-stock line of a stock item pings "two phones sold at the same time · void one" (:126) with `V\|<group>`, which voids every line AND the bank PAYMENT that really reached the account | a stock item: NEW `ping_stock_short`, no button (information: a restock may not have been recorded); a one-of-a-kind piece: today's ping and `V\|` | R6f |
| `customerSummaryMap` / Customers F:K core_ledger.js:1347-1382 | the buyer on every row | none | gas 26 |

A `V|` voids the whole basket (basket map 2.15) and, after the 4.4 change, its reply lists every line it voided; a
basket has no per-line undo (12). Since revision 2 the `stock_negative` ping offers `V|` only for a one-of-a-kind piece
(a real double sale); a stock item's ping has no button, so a miscounted shelf never leads the owner to void a correct
basket with its bank part (M2). Old phones need nothing: the app has never been published, so at the round 4+5+6
publish every phone starts on round 6 (design-owner 4.24); an older server forces `quick` (core_sync.js:1454-1468).

---

## 6. Glue and sync

### 6.1 setupSheet (apps-script/gas_setup.js)

- `defaults` (:76): `['sale_flow', CFG.SALE_FLOW.FORM]`, appended only when the key is missing (:78-79), so a Sheet
  where the owner typed `quick` keeps it (run_gas.js:1567). The comment above it (:74-75) and the file header (:15) say
  `form` / `quick`.
- Revision 2 (m6): a Settings row `sale_flow` whose value, trimmed and in any case, is `steps` (a round-5 test book) is
  REWRITTEN to `form` (one `setValue` right after the defaults loop), so the cell never shows a word its note no longer
  explains; the code still reads `steps` as form for an older row a phone pulled.
- The note on the `sale_flow` Key cell (:85-93) is unchanged code; its text is the new `settings_note_sale_flow` (9.2),
  which the Messages loop (:81-84) appends only when the key is missing and `t()` reads from the tab. Revision 2 (m6): a
  Messages row `settings_note_sale_flow` whose text is EXACTLY round 5's default ('steps = တစ်ဆင့်ချင်း မေး · quick =
  ခလုတ်တစ်ချက် ရောင်း', core_messages.js:448) is rewritten to the round-6 text before the note is set; a text the
  family typed is kept.
- No tab, column, dropdown or Dashboard cell changes.

### 6.2 The photo AI's late rename, made one rule on both sides (gas_sync.js, poc/sim_sync.js, the two phones)

Today the server's photo job (`gasSyncHooks().ai`, gas_sync.js:306-316) saves the JPEG to Drive and writes only
`photoUrl` (one Rev bump, gas_store.js:369-372 with `gasStampRev` :93-101); the phone then renames a placeholder-named
item with the AI's name (`replayJob`, app/app_sync.js:388-395) and pushes that item entry with its older `baseRev`, which
the server flags `sync_conflict` and pings to the owner (core_sync.js:719-746, :1171-1175). Measured in this tree (0.3
rule 2). The fix, with no core_sync.js change:

- **Server** (gas_sync.js:310-314; its twin poc/sim_sync.js:183-187): after the Drive save, `var cur =
  store.getItem(job.itemId); var f = url ? {photoUrl: url} : {}; var ren = cur ? aiRenameFields(cur, desc) : null;` add
  `ren.name` and `ren.category` (when present) to `f`, and write `f` in ONE `updateItem` (one Rev bump).
- **Phones** (`replayJob` app/app_sync.js:389-395; `applyAiResults` poc/sim_phone.js:698-703): rename through the same
  `aiRenameFields(item, desc)`, so the entry they push carries the values the server already holds: the server answers
  `dup` (`!differs`, core_sync.js:731-735), no conflict and no ping. A BLANK item is never renamed (its name is ''), a
  typed name is never replaced, and a chosen category only when it is the catch-all 'အခြား' (4.2).
- **The new-piece form queues the job at Save** (`appNewItemSave`, 7.2: `chat.savePhoto(mediaId, itemId)` first, so
  `queueAi` takes `file.itemId`, app_ports.js:130-133; then `ports.ai.describePhoto` in a try/catch, which queues and
  throws `PendingAi`). `photoUrl` at Save = `chat.savePhoto(...)`'s `'local://' + mediaId`, `photoFileId` = the media id
  (today's in-app values).
- **The job waits for its item entry** (revision 2, M1). The first draft said the item entry is "always pushed before
  the job" because `flushAiJobs` runs after a push. It runs after any sync that ends ok (app_sync.js:352-354), BEFORE the
  `again` sync (:357) that pushes entries made while that sync was in flight (a Save during a sync only sets `wanted`,
  :327). The form's own photo opens that window: the camera app's return fires `visibilitychange` →
  `syncNow('foreground')` (:536), in flight on mobile data while the seller types the price and Saves. The review's probe
  (p2.js) saw the job reach a still-BLANK server item (only the Drive URL written, `aiRenameFields` never renames a
  BLANK), then the item entry with a stale `baseRev` overwrite the URL with `local://S1-0007`, log two `sync_conflict`
  rows and ping the owner twice (core_sync.js:129, :729). The rule, on both phones: `sync.flushAiJobs`
  (app/app_sync.js:405-426) skips a photo job while `store.outbox` holds an entry of kind `item` with `id ===
  job.itemId` (`return next(i + 1)`, the job stays queued for the next flush); `phone.applyAiResults`
  (poc/sim_phone.js:680-712) skips it the same way over `phone.outbox`. The next good sync pushes the item first, so the
  job meets an ACTIVE placeholder-named item, renames it on the server, and the Drive `photoUrl` is never overwritten.
  A voice or text job is not held.
- **The replay line never covers the sold card** (revision 2, U14). `replayJob` says `photo_seen` with `botSay`
  (app_sync.js:388-394), and the home's big card is the last bot message of any kind (`appLatestBot` →
  `phone.sim.lastBot`, app_ports.js:309-312; app_ui.js:369, :497). With every app new piece now queuing a job, the line
  would replace the next sale's sold card (and its ↩️ 🧾 💰) on the home. The line is therefore inserted BEFORE the
  latest bot message when that message has buttons (`store.insertChatBefore`, app_store.js:599, as `markWaiting` does,
  app_ports.js:213-215), else pushed as today.
- The two defects that predate round 6 and stay (section 12): a phone's local media id stored as `photoFileId` shows as
  text in Telegram (core_sync.js:719-739, core_bot.js:240-242, gas_telegram.js:39-46); a job queued at photo time on the
  quick path, before its item entry even exists, can still reach the server first (the M1 rule holds a job only while
  the entry waits in the outbox).

### 6.3 core_sync.js

ONE change in revision 2 (M2; it goes in step 1 with the core); revision 3 adds the changes listed in 6.7. Today every
phone row that drives an item's stock below 0
is flagged `stock_negative` (:806-810), and the owner's ping reads `ping_stock_negative` '⚠️ {name} ({id}) · လက်ကျန်
{stock} · ဖုန်း ၂ လုံးက တစ်ပြိုင်နက် ရောင်းထားပါသည် · တစ်ခုကို ပယ်ဖျက်ပါ' (:126, "two phones sold at the same time ·
void one") with its only button `V|<group>` (`syncFlagPing`, :634-637). The form allows an over-stock count (a warning,
1.3), and on a stock item that is usually a restock nobody recorded, not a double sale: the review's probe (p3.js) voided
a correct basket line and the 5,000 KBZ PAYMENT that really arrived. So:

- `syncFlagText` (:616-620): a `STOCK_NEGATIVE` flag whose item is not UNIQUE reads NEW `ping_stock_short` '⚠️ {name}
  ({id}) · လက်ကျန် {stock} · 📦 ကုန်ရောက် မမှတ်ရသေးတာ ရှိနိုင်ပါသည် · စစ်ပါ' (in the `SYNC_MSG` block, :92-138, merged
  into MSG at :139); a UNIQUE keeps `ping_stock_negative`. The phone's own flag line (app_sync.js:236,
  sim_phone.js:609) reads the same text.
- `syncFlagPing` (:634-637): no `V|` button for such a flag (`kb = []`); every other flag keeps its button. The
  owner still voids from the receipt when the sale really was wrong (0.3 rule 17).
- run_sync S4 (:233-252, a UNIQUE sold twice) stays green unchanged; R6f is the new check (10.4).

Otherwise unchanged. `SYNC.CAPS` stays `['dueDay']` (core_sync.js:85), so run_gas.js:1771 and the caps part of
run_sync.js:1734 stay; `syncSettingsQuick` (:1489-1494) still writes `quick`. A basket passes `syncValidateBatch`
(:399-445): every row of one shop (B6), at most 11 rows, one staff, one group; another shop's line is refused at the
scan, so a basket is never quarantined `scope` (:361-370). A Telegram basket is written on the Sheet directly and is
never flagged (a channel difference that predates the round, section 12).

### 6.4 gas_store.js, gas_main.js, gas_telegram.js

No change. A Telegram basket is N `appendRow` + `flush` under one `gasLocked` (gas_store.js:391-410), eleven at most,
well inside the 15 s lock (gas_main.js:67-73). A review card whose caption edit fails falls back to a new message
(gas_telegram.js:52-61), which `saleShow` follows (the new message is text: `cap` false).

### 6.5 poc twins

- poc/sim_phone.js `appendLedger` (:121-126): the receipt copy of 3.5, the twin of app/app_store.js:294-299.
- poc/sim_phone.js `applyAiResults` (:698-703) and poc/sim_sync.js `hooks.ai` (:183-187): 6.2.
- poc/fake_gas.js, poc/sim_ports.js: no change expected. When the glue needs a member the fake lacks, step 2 adds it to
  the fake's table and to run_gas.js's member tables (`SPEC_MEMBERS` / `ADDED_MEMBERS`, run_gas.js:198-229) and names it
  in its report; step 2 owns those files and that region for this purpose only (revision 2, B18; section 11).

### 6.6 The exact migration (for apps-script/README.md; replaces SPEC-round-5 4.5 steps 2-3 where they name `steps`)

1. All suites green (10.9); `node tools/bundle_gas.js`, `node tools/build_app.js`, `node poc/build_simulator.js`.
2. To open the shops on the one-tap card instead of the forms, type the row `sale_flow | quick` into the Settings tab
   before the publish (the code default is `form` when the row is missing). Then publish the bot.
3. Right after, in the same sitting, run `setupSheet` once (rounds 4-5: Lists with Kind, the Ledger at 27 columns with
   DueDay as text, Credits at 15, the Dashboard's Overdue cell; round 6: `sale_flow = form` unless typed (a `steps`
   value is rewritten to `form`), `sale_due_presets`, the Messages keys of rounds 4-6, a round-5 default
   `settings_note_sale_flow` rewritten to the round-6 text), then `rebuildViews`. The live Sheet (round 3) has neither
   round-5 row, so on it this only appends.
4. Publish the app. Every phone loads round 6 at its first open (none runs an older app).
5. The owner may flip `sale_flow` at any time: the bot obeys at the next tap, each phone at its next pull. The switch is
   for all phones at once (the app has no per-phone control, 1.0). A sale form open at the flip refuses its Save, closes
   and toasts `expired`.
6. Rebuild and publish the simulator artifact last.

Revision 3: step 3's `setupSheet` also appends the Settings row `ai | TRUE` (today's AI behaviour; the owner may turn it
off in the app afterwards), notes the `ai` row and marks the Shops block (13.11, 13.12), and adds the Measurements column
`Sketch` (`MEAS_FIXED_COLS` + `ensureColumns`, gas_setup.js:137-144: after `EntryID` on a new tab, at the end of a tab
set up before).

### 6.7 Revision 3: what changes in sync and glue

| Where | Change | Section |
|---|---|---|
| core_sync.js `SYNC` (:41-89) | `ENTRY_KINDS` + `setting: 8`; `SETTING_KEYS`; `MEAS_SKETCH_MAX` 4000; `MEAS_SKETCH_RE` | 13.12, 13.7.2 |
| core_sync.js `syncValidateBatch` (:406-438), `syncSettingReason` (NEW), the apply loop (:751-771), the ack (:1399-1419) | the `setting` entry: owner only, the nine keys, `ok` / `dup`, an older server keeps it, a quarantine resets the settings hash | 13.12 |
| core_sync.js `syncMeasRecReason` (:494-510), `syncApplyMeasurementEntry` (:568-596), `syncMeasPage` (:941-968) | `sketch` accepted, stored and pulled (only when non-empty); the `note` key up to 300 characters | 13.7 |
| core_sync.js `syncHandle` 'ai' (:1250-1272) | `sketch` and `pic` jobs return `photoUrl` and are never refused `ai_off`; AI jobs answered `ai_off` while the switch is off; a sketch's `no_session` and a pic's `no_item` write no Errors row | 13.7.2, 13.11 |
| gas_store.js | `setSetting`; the `Sketch` column in `addMeasurement` / `gasMeasFromRow`; `findMeasurementByEntry`; `setMeasurementPhoto` | 13.12, 13.7.2 |
| gas_sync.js `hooks.ai` (:300-319), gas_pdf.js `make` (:9-43), gas_setup.js (:52-93) | the figure job and the `pic` job (no Gemini call); the figure in the measurement PDF; the `ai` row, its note and the Shops block (notes and one conditional-format rule) | 13.7.2, 13.11, 13.12 |
| poc/sim_sync.js, poc/sim_ports.js, poc/sim_phone.js | the twins of the above (`hooks.ai` sketch and pic; `setSetting`; `local.setSettingLocal`, the re-apply, `sketch` in the local measurement record) | 13.16 step 2 |
| phones (app_store.js, app_sync.js) | `local.setSettingLocal` and the re-apply; `sketch` in the measurement record; the sketch and pic jobs' hold and their five tries; AI jobs `skipped` while AI is off (review r3, M-12); `measurementRejected` fails orphaned sketch jobs; `pendingLines` | 13.7.2, 13.11, 13.12 |

---

## 7. App (app/)

### 7.1 Files and the four load lists

| File | Change |
|---|---|
| `app/app_forms.js` (NEW, ES5) | the four forms: the pure part (7.2), then the DOM part (7.3) |
| `app/app_ui.js` | the hooks of 7.4 and the deletions of 7.4 |
| `app/app_scan.js` | revision 2, U2: `createAppScanner`'s `decoded` (:45-53) reads `sc.holdMs`: when set, a repeat of `sc.lastDecode` inside `holdMs` of the last time it was SEEN refreshes `lastDecodeAt` and returns (no buzz, no stop); without it, today's 2000 ms rule exactly |
| `app/app_ports.js` | `ui.openForm` (7.5) |
| `app/app_sync.js` | `replayJob` through `aiRenameFields` and its line placed under the latest card; `flushAiJobs` holds a photo job while its item entry waits; `pendingLines` through `describeGroup` (7.5) |
| `app/app_store.js` | the receipt copy in `appendLedger` (3.5) |
| `app/app_i18n.js` | the APP_MSG keys of 9.3, in a "round 6" block |
| `app/app.css` | 7.6 |
| `app/dev/index.html` | 7.7 |
| `tools/build_app.js` | `APP_FIRST` (:30) gains `'app_forms.js'` after `'app_ui.js'`; revision 3: the full list of 13.13 (`app_icons.js` before `app_ui.js`; `app_sketch.js`, `app_screens.js` after `app_forms.js`) |
| `poc/build_simulator.js` | `FRAME_FILES` (:28) gains `'app_forms'` after `'app_ui'`, in the SAME step as `APP_FIRST`, so check_simulator.js:87 never goes red; revision 3: the same order as `APP_FIRST` (13.13) |
| `poc/run_app.js` | `FILES` (:17-24) gains `'app/app_forms.js'` after `'app/app_ui.js'`; revision 3: the same order (13.13) |
| `app/app_icons.js`, `app/app_sketch.js`, `app/app_screens.js` (revision 3, NEW, ES5) | 13.13 |
| `app/index.html` (revision 3) | the header's `#back` and icon buttons, English bottom-bar fallbacks (13.3); check_simulator.js:93's shell ids are kept |
| `app/config.js`, `tools/publish*.js` | unchanged |

### 7.2 app/app_forms.js, the pure part (no DOM; Node-tested on an enrolled phone, as `appMeas*`, app_ui.js:117-259)

`F = APP.form = {kind: 'sale' | 'newitem' | 'restock' | 'expense', req, values, dirty, saving, scan, el, timer, stripEl,
body, stale, composing, last: {f, n}, openedAt}` (revision 3: no `hist`; the form's layer lives in `APP.nav`, 13.4). `values` is the form's whole state (the draft is `values`).
Constants: `APP_FORM_DRAFT_MS` 400, `APP_FORM_RESCAN_MS` 700, `APP_NEW_DRAFT_TTL` 86400, `APP_FORM_SAME_TAG_MS` 8000
(revision 2, U2). `F.last` (revision 2, B2) is the last control used: every `appFormSet` and every DOM handler sets
`F.last = {f: <data-f name>, n: F.last.n + 1}`.

| Function | Does |
|---|---|
| `appFormDraftKey(kind, key)` / `appFormDraftRead(store, kind, key)` / `appFormDraftWrite(store, kind, key, values)` / `appFormDraftDrop(store, kind, key)` | `formdraft:<kind>:<key>` in the persisted cache; TTL 1800 s (`CFG.STATE_TTL_SEC`) for sale, restock and expense, `APP_NEW_DRAFT_TTL` for newitem; unreadable means none (the `appMeasDraft*` shape, app_ui.js:200-215) |
| `appHomeJobs(ports)` | `['sell', 'new', 'restock', 'expense']` when `formsInApp(ports)`, else `[]` |
| `appSaleInit(phone, req)` | the values of a fresh or restored sale form, by the draft rule of 1.0 (revision 2, U3): the draft's lines whose UNIQUE piece is now sold are dropped first; no `req.itemId` → the draft (`restored` true); `req.itemId` already a line of the draft → the draft, nothing added (`restored` true); any other `req.itemId` → `{lines: [that line]}` through `appSaleAdd` with `req.qty`, `req.unitPrice`, `req.priceChanged`, and the draft's lines kept as `older` (the `ui_form_older` strip); defaults `{lines: [], method: 'CASH', part: false}` |
| `appSaleAdd(phone, values, itemId, qty)` | an id already a line → `{ok: false, twice: true, text}` (`ui_form_twice` for a stock item, `basket_twice` for a UNIQUE; nothing changes, 0.3 rule 14); else `basketAddItem(ports, staff, values.lines, itemId, qty)`; returns `{ok: true, values}` or `{ok: false, text}` (the reason's key filled) |
| `appSaleSet(phone, values, f, v)` | the one state change for a control name (7.8): `qty+:<id>`, `qty-:<id>`, `qty:<id>` (1..999; a UNIQUE stays 1), `price:<id>` (≥ 1; `priceChanged` = the value differs from the item's price), `remove:<id>`, `find` (the search text), `find:go` (the results), `found:<id>` (as a scan), `buyer` (the search text), `buyer:<id>` (clears the new buyer; also the known-phone and same-name chips), `buyer:new` (opens the name and phone fields, the search text going to the phone when it is digits and phone punctuation, else to the name), `buyer:create` (`forceNew` true), `buyer:clear`, `name`, `phone`, `pay:CASH` and `pay:<wallet KEY>` (method, no mix, no account list), `pay:wallets` (the wallet list), `pay:bank` (the bank list; the only bank picked for you), `pay:mix` (mixed, every non-cash account; the only one picked for you), `pay:add` (the new-account inputs; the new key becomes the method), `acct:<KEY>`, `acct:add`, `acctname`, `acctkind:wallet` / `bank`, `transfer`, `transfer:half` (half of the paid-now amount), `paid:full` (drops `paid` and `dueDay`), `paid:part`, `amount`, `amount:0`, `amount:half` (an amount equal to the total sets `part` false), `due:<n>` (`dueDay = saleDueKey(now, n)`), `date` (a yyyy-mm-dd from the date sheet through `saleDueKey`), `due:none` (`''`), `restored:clear` (only the opener's line, or empty), `restored:merge` (`older` lines first, then the current ones, each id once). Returns NEW values; marks `dirty`. The DOM and the simulator's `set` op both call it |
| `appSaleView(phone, values)` | the lines with emoji, name, type, stock, `stockOver`, `priceFar` (a price above 10 × the item's, U4), `pending`, amount; `basketTotals`; the basket's shop; wallets and banks (`payMethodsByKind`), `collapseWallets` (more than six how-paid choices, U6); `canMix` (a non-cash account and total ≥ 2); the account list and `showAdd`; `showTransfer`; the recent buyers (`recentCustomers(ports, shop, 3)`) or the matches (`findCustomers`, six); `knownPhone` (every customer whose `normPhone` equals the new buyer's), `sameName` (`matchCustomers(...).exact` for a new buyer's name, unless `forceNew`); the find results; `older` (its count); the due presets; the needed rows (`needAmount`, `needDue`, `needBuyer`); `problems` (`basketCheck` plus the app's own of `appSaleSave`, shown only after a Save attempt) |
| `appSaleDraftOf(phone, values)` | the draft of 2.1 for `basketCheck` / `basketCommitDraft` (`needAccount` when 🏛, 📲 or 💵+🏦 has no account; a pending new account as `addLabel` + `addKind`; `forceNew`; search text left without a pick turned into `newName` / `newPhone` as 1.3 says) |
| `appSaleSave(phone, F)` | `{ok: false, reason: 'busy'}` while `F.saving`. First the app's own checks (revision 2, U8, U9), in this order: `buyer_pick` (search text that `findCustomers` matches, no pick; `ui_buyer_pick_first`), `need_name` (search text of digits only, no pick; `ask_name`), `known_phone` (`ui_buyer_known_phone`), `same_name` (`ui_buyer_same_name`). Then `basketCheck(..., {pendingMethod: !!values.addLabel})`; refused → `{ok: false, problems}`; a `method` problem also sets the method to CASH (mixed off); a `mode` problem closes the form with the toast `expired` (6.6 step 5, U17). A new account: `addListOptionByLabel(ports, 'pay_method', label, staff, {kind})` (refused → its reason's key), its key becomes the method and `addedKey`. Then `basketCommitDraft(ports, staff, draft, {uid, source: BUTTON, updateId: store.nextUpdateId()})`, `clearState`, `basketSoldReply(ports, uid, null, false, r, draft, customer)` (the sold card pushed to the phone's own chat, app_ports.js:92-99), `appFormDraftDrop`. Returns `{ok: true, groupId}`. It writes nothing durable itself |
| `appNewItemInit(phone, req)` / `appNewItemSet(phone, values, f, v)` / `appNewItemView(phone, values)` | 1.5: `tag`, `name`, `cat:<i>`, `cost`, `price`, `price:<n>`, `pending`, `count-`, `count`, `count+`, `sample`; the view gives `margin` (`itemMargin`), `loss`, `skuHint`, the price chips (`pricePresets`), `nameLater` |
| `appNewItemPhoto(phone, values, rec)` | `store.addMedia({kind: 'photo', blob, dataUrl, mime, status: 'file'})` (or the simulator's `{kind: 'photo', sim: {meta, visual, mimeType}}`, as `phone.sim.photo` builds it, app_ports.js:285-288); a previous unsaved photo of the form is removed; `values.mediaId` set. No AI job yet |
| `appNewItemSave(phone, F)` | `busy` while saving; re-reads the tag: not BLANK → `{ok: false, reason: 'not_blank'}` and the values lose `tag` (the strip shows again, every other value kept; revision 2, U13), a seller's tag of the other shop → `basket_other_shop` (m7); neither a price nor pending → `ask_price`; `chat.savePhoto(mediaId, itemId)` when a photo was taken (it sets `media.itemId` and returns `'local://' + mediaId`); `commitNewItem(ports, {itemId, name, category, price: pending ? '' : price, cost, count, sample, photoUrl, photoFileId: mediaId \|\| '', staff, source: PHOTO, updateId})`; then `try { ports.ai.describePhoto(store.getMedia(mediaId), {categories: CFG.CATEGORIES}) } catch (e) {}` (queues the job, 6.2; it waits for the item entry, M1); `notifyOwners(price_ask_owner, priceButtons)` when pending (an outbox notice); `clearState`, `setLastItem`, `item_created` · id and `sendItemCard(..., {undo: r.groupId})` to the phone's chat (M5); `appFormDraftDrop`. Returns `{ok, item}` |
| `appNewItemAbandon(phone, values)` | removes the form's unsaved media (`store.removeMedia`); the tag stays BLANK |
| `appRestockInit` / `appRestockAdd(phone, values, itemId)` / `appRestockSet` / `appRestockView` / `appRestockSave(phone, F)` | 1.6; `basketAddItem(..., {restock: true})`; Save = `commitRestockGroup` and the reply of 1.6 (`undoRow`), `setLastItem` (first line) |
| `appExpenseInit` / `appExpenseSet` / `appExpenseView` / `appExpenseSave(phone, F)` | 1.7; a new category through `addListOptionByLabel(ports, 'expense_category', label, staff)` at Save; `commitExpense` with the note; the reply of 1.7; `setLastGroup` |
| `appFormCommit(phone, sync, kind)` | `phone.commit(kind)`, then `sync.scheduleSync()` when ok; resolves true or false (the `appMeasCommit` shape, app_ui.js:257-259) |
| `appFormSnap()` | `null`, or `{kind, itemId, lines: [{id, qty, price}], buyer: {id, name, phone}, pay, acct, transfer, part, amount, due, total, error, saved, name, category, cost, price, pending, count, sample, photo, shop, cat, note, older, last: {f, n}}` for the simulator (8.2). `error` is the first problem's KEY (for example `sale_need_buyer`), never its text, so both transports compare the same value (revision 2, B2); `last` is `F.last` |

### 7.3 app/app_forms.js, the DOM part

| Function | Does |
|---|---|
| `appOnOpenForm(evt)` | the `'openform'` listener: a `setTimeout(0)` open after the core's run, as `appOnMeasureForm` (app_ui.js:995-999). An `openform` of kind sale while a sale form is open adds the line only when its id is not already a line; otherwise it only focuses the form (revision 2, U23: a second tap on the card's sell button that lands before the deferred open, `S` being exempt from the tap guard in form mode, core_bot.js:446, never adds +1 or +3) |
| `appOpenForm(kind, req)` | closes another form and `#measForm`, `appCloseOverlay()`, `appStopScanner()`, `clearState`; `<kind>Init`; builds `F` (`F.openedAt` = now), sets `APP.form` (from now on `appScannerWanted()` reads `F.scan`, U1), `appFormMount(F)`; pushes the `form` layer (`appNavPush`, revision 3, 13.4; revision 2's `F.hist` is not built); starts the form scanner (sale, restock, a new-piece form without a tag) when the pref `cameraOk` is set; `req.focus === 'price'` opens the line's price keypad |
| `appFormRender(F)` | the whole `div#<kind>Form.formpage[role=dialog]` built with `APP.doc.createElement` only (`fakeDocument` in run_app.js:850-888 can render it): `.fhead`, `F.stripEl` (`appFormStrip`, sale, restock and a new-piece form without its tag), `F.body` (every section), `.fbar`; every control carries `data-f` and `hot` per 1.0 |
| `appFormMount(F)` / `appFormRepaint(F)` | `document.body.appendChild` once (the only line that touches `document.body`); a repaint replaces `F.body`'s children and the bar's, never `F.stripEl`, and keeps the focus on the same `data-f` (revision 2, U5) |
| `appFormRegion(F, region)` | NEW (U5): redraws one region without touching the inputs: `buyer` (the chips, the known-phone and same-name chips), `phone` (the new buyer's phone label), `find` (the result tiles), `bar` (the running line, `.fmsg`, Save; then `--fbar-h` from the bar's `offsetHeight`, 1.0). An input's `input` handler calls it; nothing runs while `F.composing` (between `compositionstart` and `compositionend`) |
| `appFormStrip(F)` / `appFormStripState(F)` | NEW (U1): the strip built once (`div.scan.scanstrip` with `APP.videoEl`) and its non-video children redrawn from `APP.scanState` / `APP.scanError` with `appScannerPanel`'s labels and replay rule (app_ui.js:513-530); `appRender()` calls `appFormStripState(APP.form)` last |
| `appFormTag(F, id)` | the router target of 1.2 rule 1: an id already a line → the toast of 0.3 rule 14 and a flash, nothing else; else the kind's Add, a toast on a refusal, a repaint, the draft write. The scanner restarts after `APP_FORM_RESCAN_MS` for a sale or restock form and a new-piece form still without its tag; an accepted blank tag sets `F.scan = false` and stops it (U16) |
| `appFormScanStart(F)` / `appFormScanStop(F)` | `F.scan` on or off with `appStartScanner()` / `appStopScanner()`, and `APP.scanner.holdMs = APP_FORM_SAME_TAG_MS` on, `null` off (U2); the one scanner's video lives in `F.stripEl` |
| `appFormPhoto(fileOrRec)` | the photo input's target while a new-piece form is open: in the browser `appDownscalePhoto(file, APP_PHOTO_MAX_PX)` (app_media.js:47-68), in the frame or Node a sim rec; then `appNewItemPhoto` and a repaint. The 📸 button's handler calls `appFormScanStop(F)` BEFORE `$('photoInput').click()` (U16) |
| `appFormChanged(F)` | the draft written, `phone.commit('formdraft')` debounced by `APP_FORM_DRAFT_MS` |
| `appFormSave(F)` | 1.0's Save, inside try/catch (U18): `F.saving`, the kind's Save; refused → `.fmsg`, `.fbad`, scroll, `F.saving = false` (a `not_blank` new piece also gets its strip back, U13); a throw → `ports.logError('form', err, '', kind)`, `F.saving = false`, `expired` in `.fmsg`; ok → `appFormCommit`, then `appCloseForm({saved: true})` (its `form` layer becomes the reply card's `card` layer, revision 3, 13.4), `APP.showScanner = false`, `appRender()` |
| `appCloseForm(opts)` | `opts.ask`: a dirty form asks `ui_meas_close_ask` (on no it stays, and after a back press the history entry is pushed again); `opts.keep`: the draft stays (the line-name tap); else the draft is dropped; `appNewItemAbandon` for an unsaved photo; the scanner stopped; the element removed; `opts.saved`: no scanner restart (U17); a close without Save: the home shows the layer below (its card state, `APP.showScanner = false`, when a `card` layer is below; else `APP.showScanner = true` and the home scanner restarts per the pref); revision 3 (13.4): `opts.saved` or `opts.card` → `appNavReplace({kind: 'card'})`, or `appNavDrop('form')` when the layer below is already a `card` (the home has one card layer); otherwise, unless `opts.pop`, `appNavDrop('form')`; the reload after `phone.commit('reload')` when an update waits (as app_ui.js:1169-1176) |
| `appOnFormPop(evt)` | revision 3: not built; the app's one `popstate` listener is `appOnPop` (13.4), which closes the top layer, a form among them, with `appCloseForm({ask: true, pop: true})` |
| `appFormLineCard(F, id)` | `appCloseForm({keep: true, card: true})` (revision 3: the form layer becomes the item card's `card` layer, 13.4), then `openTag(uid, id, staff, uid, ports, {card: true})`, `APP.showScanner = false`, `phone.commit('card')`, `appRender()` |
| `appFormSet(f, v)` | the simulator's `set` op: the kind's Set, `F.last` bumped, then repaint (or the region of a text field) and draft |
| `appJobRow(compact)` | the four job buttons (`data-f="job:…"`, `hot` per 1.0); `compact` = the 56 px row of the card state |

### 7.4 app/app_ui.js: the hooks, and the deletions

| Hook | Line | Change |
|---|---|---|
| `APP` fields | :289 | + `form: null`; revision 3: the nav fields of 13.4 (`nav`, `navDepth`, `navBusy`, `navHist`, `navGuard`, `screenArg`); revision 2's `formPopIgnore` is not built (review r3, m-8) |
| `phone.on` | :304-308 | `'revoked'` also calls `appCloseForm({})`; + `phone.on('openform', appOnOpenForm)`; `phone.on('sync', …)` (:304) also repaints an open form (a piece sold elsewhere shows at once), unless an input inside the form has focus: then `F.stale` is set and the repaint runs on that input's `blur` (revision 2, U5) |
| `popstate` | :341-345 (the `win` listeners) | + `win.addEventListener('popstate', appOnPop)` (revision 3's one navigation stack, 13.4; replaces revision 2's `appOnFormPop`) |
| the photo input | :340 | the change handler calls `appFormPhoto` when `APP.form && APP.form.kind === 'newitem'`, else `appOnPhotoPicked` as today |
| `visibilitychange` | :346-349 | hidden: `appStopScanner()` as today; visible: `if (appScannerWanted() && APP.store.getPref('cameraOk')) appStartScanner()`, one rule for the home and a form (revision 2, U1) |
| `appOnChange` | :353-365 | `formdraft` is handled like `measdraft` (:354-357); :358 becomes `if (evt && evt.kind === 'update' && APP.screen === 'home' && !APP.form) APP.showScanner = false;` (U1: the deliver that opened the form must not turn the form's camera off) |
| `appRender` | :388 | `if (!appScannerWanted()) appStopScanner();` then `if (APP.form) appFormStripState(APP.form);` (U1). NEW `appScannerWanted()` beside it: `APP.form ? !!APP.form.scan : (APP.screen === 'home' && APP.showScanner)` |
| `appRenderHome` | :484-505 | under `appHomeJobs(ports).length`: `appJobRow(false)` above the scanner panel in the scanner state (the panel's square capped at 40vh, 7.6), `appJobRow(true)` above the card in the card state, the hint line under the scanner; the `ui_history` handle (:493) and the card state's handle row (:500-503) kept; no scanner panel while `APP.form` is open |
| `appStartScanner` | :532-533 | `if (!APP \|\| !APP.store.meta.deviceId \|\| APP.measForm \|\| !appScannerWanted()) return;` replaces the `screen`/`showScanner` guard (U1) |
| `appOpenTagId` | :563-568 | first line: `if (APP.form) return appFormTag(APP.form, id);` |
| `appInputModeFor` | :68-84 | + `if (state.kind === 'await_text' && state.purpose === 'phone') return 'tel';` before the `await_text` line (revision 2, U24: 📱 `CF\|` → `askPhone` gets the phone keyboard; the `'tel'` mode keeps a source after the sale branch goes) |
| `appOpenDateSheet(onOk, opts)` | :972-988 | takes a callback and `{max}`; the input gets `max` (today + `CFG.SALE_DUE_MAX_DAYS` from the form, U21a); OK with no date does nothing, else `onOk(value)`. The no-callback path (`appSendText`) has no caller left and is deleted (revision 2, B12) |
| service worker | :1254, :1262-1265 | `canApply` also needs `!APP.form`; `controllerchange`: `if (APP.measForm \|\| APP.form) APP.reloadAfterForm = true` |

Deleted (R5: the app can no longer reach them once `S|`/`Q|`/`QN|`/`D|` open the form; no app path sets a `sale` state):

- the `sale` branch of `appInputModeFor` (:76-82) and with it the `'date'` mode and its bar (:796) (revision 2, B12: no
  state returns `'date'` any more; `'tel'` stays, sourced by `await_text` purpose `phone` above);
- the guided title in `appInputBar` (:784-785): every number prompt is titled with its first line (`appFirstLine`);
- `appQuestionLine` (:86-91), which then has no caller. `appKeypadKeyFor` (:92-94) stays (:786 still calls it).
- the no-callback path of `appOpenDateSheet` (:983, `appSendText(v)`), whose only caller was the `'date'` bar.

### 7.5 app_ports.js, app_sync.js, app_store.js

- **app_ports.js:179-183**: `ui` gains `openForm: function (kind, req) { emit('openform', {kind: kind, req: req}); }`
  beside `measureForm`.
- **app_sync.js `replayJob` (:388-395)**: the photo branch renames through `aiRenameFields(item, desc)` (6.2) and says
  `photo_seen` only when it renamed, inserting the line BEFORE the latest bot message when that one has buttons
  (`store.insertChatBefore`, app_store.js:599), else pushing it (revision 2, U14).
- **app_sync.js `flushAiJobs` (:405-426)**: a photo job is skipped (`return next(i + 1)`, it stays queued) while
  `store.outbox` has an entry `{kind: 'item', id: job.itemId}` (revision 2, M1; 6.2).
- **app_sync.js `pendingLines` (:499-502)**: `describeGroup(phone.ports, e.txs)` instead of `describeRow(…, r)`; the
  ADJUST suffix and the time stay.
- **app_store.js `appendLedger` (:294-299)**: the receipt copy of 3.5.

### 7.6 app/app.css

- `.overlay` z-index 30 → **34** (:136). No check pins 30.
- NEW classes, through the existing tokens only (dark mode follows, :18-33): `.jobs` (a 2 × 2 grid of 64 px buttons,
  like `.kb.grid` :94-95; `.jobs ~ .scan { max-height: 40vh }` so the camera and ⌨️ stay above the fold on a 640 px
  phone, revision 2, U22) and `.jobs.compact` (one row of 56 px on a five-column grid: 🛒 with its label spans two
  columns, 🆕 📦 💸 are emoji only at 24 px with an `aria-label`); `.scanstrip` (the `.scan` look, :115-122, at 16:9,
  max-height 30vh); `.fline` (a card-like row, the 🗑 at the right; row 2 the price box and the amount, row 3 the
  stepper and the stock), `.fline .stock` (muted), `.fline .over` (warn); `.fnum` (an input-looking button, `var(--mono)`
  digits); `.bchip` (buyer chips; `.chip` is the header's sync chip, :61-67); `.fneed` (an outline in `var(--accent)`),
  `.fbad` (an outline in `var(--bad)`); `.fsplit` (one column; two at `min-width: 700px`); `.fbar .ftotal`; `.fphoto`
  (4:3); `[data-f].hot` next to `.kb button.hot, .sell.hot` (:97).
- Revision 2 (U6), so the reused rules fit a 360 px phone (about 300 px inside `.fcol` and `.fline`):
  - `.formpage .seg, .formpage .toggle { flex-wrap: wrap; }` and `.formpage .seg button, .formpage .toggle button
    { flex: 1 1 auto; white-space: nowrap; }`: today neither wraps (app.css:147-148, :185-186), and the how-paid row
    holds up to six choices, the promised day five, the categories five, the expense categories six or more;
  - `.fline .stepper { margin-top: 0; } .fline .stepper button { min-width: var(--tap); min-height: var(--tap);
    font-size: 26px; } .fline .stepper .n { min-width: 64px; flex: 0 0 auto; }`: today's 64 × 64 keys at 30 px
    (:98-100) plus the price box and the amount need about 360 px on one row; the line puts the stepper on its own row;
  - `.formpage .fcol { padding-bottom: calc(var(--fbar-h, 110px) + 16px + env(safe-area-inset-bottom)); }`: today a fixed
    110 px (:172) while the sale bar (running line, `.fmsg`, 60 px Save) is 140-170 px; `appFormRegion(F, 'bar')` sets
    `--fbar-h`;
  - the how-paid row collapses the wallets into one `📲 Pay အကောင့်` choice beyond six choices (1.3), Telegram's rule.
- Reused: `.formpage`, `.fcol`, `.fhead`, `.ffield`, `.toggle`, `.vid`, `.fbar`, `.fmsg`, `.seg`, `.stepper`, `.tiles`,
  `.good`.
- Revision 3 adds `.iconbtn`, `.ic`, the icon chip and `.badge`, `.kv` / `.kvr` / `.kvh`, `.tbl`, `.lrow`, `.owed`,
  `.switch`, `.sketch`, `.sktools` and the print rules (13.13); `.fhead`'s close button becomes the icon-only ← at the left.
- The mockup (`docs/design-round-6/mockup.html`, revision 2) is drawn at these sizes: 18 px body, 20 px buttons, 56 px
  targets, 64 px keys, the wrapping rows.

### 7.7 The dev page (app/dev/index.html)

- :70 becomes `Settings sale_flow = form (off: quick)`; :136 becomes `world.settings.sale_flow = 'form';` with its comment
  saying form; :207-210 write `'form'` / `'quick'`.
- The `tgSell` bench button (:211-216): `S|S1-0002|1` (the review card), then, when the mode is form,
  `tapLastByKey(U.sister, 'btn_save')`.
- `<script src="../app_forms.js"></script>` after `app_ui.js` (:130); revision 3 adds `../app_icons.js` before `app_ui.js`,
  `../app_sketch.js` and `../app_screens.js` after `app_forms.js`, and `noHistory: true` in the `bootApp` options (:152)
  (13.13).
- A form on the dev page covers the browser window, not the 390 px frame (map-app-forms 6): cosmetic, kept (12).

### 7.8 The `data-f` names (the form's twin of `data-cb`)

| Form | Names |
|---|---|
| home | `job:sell`, `job:new`, `job:restock`, `job:expense` |
| every form | `close`, `save`, `scan` (the camera button), `keypad`, `recent:<id>`, `restored:clear` |
| sale | `find`, `find:go`, `found:<id>`, `restored:merge`, `line:<id>`, `remove:<id>`, `price:<id>`, `qty-:<id>`, `qty:<id>`, `qty+:<id>`, `buyer`, `buyer:<customerId>`, `buyer:new`, `buyer:create`, `buyer:clear`, `name`, `phone`, `pay:CASH`, `pay:<KEY>`, `pay:wallets`, `pay:bank`, `pay:mix`, `pay:add`, `acct:<KEY>`, `acct:add`, `acctname`, `acctkind:wallet`, `acctkind:bank`, `transfer`, `transfer:half`, `paid:full`, `paid:part`, `amount`, `amount:0`, `amount:half`, `due:<n>`, `due:date`, `due:none`, `date` |
| new piece | `tag`, `photo`, `name`, `cat:<i>`, `cost`, `price`, `price:<n>`, `pending`, `count-`, `count`, `count+`, `sample` |
| restock | `find`, `find:go`, `found:<id>`, `remove:<id>`, `qty-:<id>`, `qty:<id>`, `qty+:<id>`, `qtyset:<id>:<n>` |
| expense | `shop:S1`, `shop:S2`, `cat:<key>`, `cat:add`, `catname`, `amount`, `amount:<n>`, `pay:<KEY>`, `note` |
| buyer (revision 3) | `name`, `phone`, `note`, `buyer:<id>`, `buyer:create` |
| shop (revision 3) | `name`, `address`, `phone` |
| pages (revision 3, not forms) | the buyers page `buyer:new`, `buyer:<id>`, `bsearch`; the buyer page `edit`, `PY\|…`, `PL\|…`, `DC\|…`, `MS\|…`, `CS\|…` (the callback is the name), `row:<groupId>`; the history `hist:<groupId>`, `hist:more`; the entry and receipt pages `undo`, `rc:share`, `rc:print`, `void`; Settings `ai`, `shop:S1`, `shop:S2`; the measurement figure `fig:F`, `fig:M`, `sk:pen`, `sk:eraser`, `sk:clear` |
| every form (revision 3) | `close` is the icon-only ← of `.fhead` (13.4) |

A `set` op with a value fills a `.fnum` (the number), an input (the text) or `date` (yyyy-mm-dd); a click op presses a
button.

---

## 8. Simulator (R8)

### 8.1 The page (poc/sim_ui.js, poc/simulator.template.html)

- `boot` (sim_ui.js:96): `world.settings.sale_flow = 'form';` its comment: the demo shows the forms and the review card;
  `seedSimWorld` says quick for the suites.
- The header switch: `#flowSteps` becomes `#flowForm`, labelled "form" (template :320; the group's title at :318 says
  "Settings sale_flow: form = one-screen forms (app) and the review card (Telegram), quick = the one-tap card"); `renderFlow` (sim_ui.js:216-220) lights
  `#flowForm` when `saleFlow(world.ports) === 'form'`; the listeners (:1524-1525) call `setFlow('form')` /
  `setFlow('quick')`.
- `doLogin` (:181-191): a login whose role is `staff` sets `S.device = 'app'` and calls `ensureFrame(key)`; the owner keeps
  the open device. The frame is NOT auto-enrolled: it shows the enrol screen and the ⚡ shortcut hint (:252, :620), so the
  `enrol` tour still finds an unenrolled frame (map-sim-tests T6); a tour step on the app enrols through its pre-step.
- `doTarget` (:1198-1215): a `ui` target starting with `frame:` sends `{op: 'click', sel: <the rest>}` instead of
  `document.querySelector` (T1); the new target kind `f` is handled as in 8.3.
- The Ledger tab (`ledgerTable`, :707-724) gains a narrow `Basket` column: '🛍 i/n' on the rows of a group with 2+ SALE
  rows, else empty (T10). The Credits tab follows `openCredits` (it shows `basket_name`).

### 8.2 The frame (poc/build_simulator.js)

- `FRAME_FILES` (:28) + `'app_forms'` (done in step 3 with `APP_FIRST`, 7.1).
- `SIM_FRAME.snap()` (:141-147) + `form: typeof appFormSnap === 'function' ? appFormSnap() : null`; `measForm` kept.
- `SIM_FRAME.cmd` (:149-173) gains four ops (T4): `form` (`{op: 'form', kind, id}` → `appOpenForm(kind, {itemId: id})`,
  what a job tile does), `set` (`{op: 'set', f, value}` → `appFormSet(f, value)`), `photo` (`{op: 'photo', preset:
  <the whole SIM_PHOTOS record>}` → `appFormPhoto({kind: 'photo', sim: {meta: preset, visual: preset.visual, mimeType:
  'image/jpeg'}})`, built as `phone.sim.photo` builds it, app_ports.js:285-288), `close` (`{op: 'close'}` →
  `appCloseForm({})`, no question: a `confirm()` would block an unattended run).
- Revision 2 (B3): the PAGE resolves the preset. `SIM_PHOTOS` lives in poc/sim_seed.js:12, which is in the page's
  `FILES` but not in `FRAME_FILES` (build_simulator.js:27-28), and in post mode the frame cannot reach the page's
  globals; the mock AI names the piece from `file.meta` (poc/sim_mock_ai.js:195-198) and the job carries the media's
  `sim` record (app_ports.js:139-141, app_sync.js:374). So a tour's act or the smoke sends `{op: 'photo', preset:
  SIM_PHOTOS[k]}` (plain JSON, it survives `postMessage`), never a key; a key alone would give the generic name
  'ပစ္စည်းအသစ်'.
- `hot` (:152) also calls `appFormRepaint(APP.form)` when a form is open (T5). `click` (:170) already presses
  `[data-f="save"]`. A form's `phone.commit(kind)` reaches the page as `{src: 'app', kind}` through `notify` (:189-195),
  and the 200 ms watcher posts a changed snapshot in post mode (:206).

### 8.3 The tours engine (sim_ui.js) and vocabulary (poc/sim_tours.js)

- **A new target kind `f`**: `{f: '<data-f name>'}` or `{f: '<name>', value: '<text>'}`. `computeHot` (:1118-1129) sets
  `T.hot = 'f:' + f`; `syncFrameHot` ships it unchanged (:630); `doTarget` maps an `f` target with a value to `{op:
  'set'}` and one without to `{op: 'click', sel: '[data-f="…"]'}`, so every `f` step completes under ⏭ alone
  (`runTourUnattended`, :1473-1491).
- **New done predicates** (written in ES5, as sim_tours.js:1-3 requires; revision 2, B14):
  ```
  function formIs(kind) { return when(function (c) { return !!(c.frame && c.frame.form && c.frame.form.kind === kind); }); }
  function formHas(fn) { return when(function (c) { return !!(c.frame && c.frame.form && fn(c.frame.form)); }); }
  function ledgerGrew(type, itemId) { /* a row of that type and item arrived after T.mark.ledger */ }
  function tagIn(id) {
    return any(scanned(id), formHas(function (f) {
      return f.itemId === id || (f.lines || []).some(function (l) { return l.id === id; });
    }));
  }
  function formUsed(name) {   // revision 2, B2: the control was used after this step began
    return function (e, c) {
      var f = c.frame && c.frame.form;
      return !!(f && f.last && f.last.f === name && f.last.n > (c.mark.formN || 0));
    };
  }
  ```
  A scan into an open form never reaches the bot, so it is seen through the snapshot (T2), while a home scan still
  emits `/start <id>`. `c.mark.formN` is the snapshot's `form.last.n` when the step began (0 without a form): the
  engine records it with the other marks when it starts a step (`T.mark`, sim_ui.js), so a control used in an earlier
  step never completes a later one.
- **Step makers** (revision 2, B2: every step has a `done`, check_simulator.js:194): `ff(name, my, en, more)` (a click)
  and `fset(name, value, my, en, more)` (a value), both with `done: formUsed(name)` unless `more.done` says otherwise;
  a job tile `ff('job:<kind>')` has `done: formIs(<kind>)` (a tile writes no draft, so only the snapshot shows it); the
  last step of a tour carries the `done` of 8.4. No form event says which control was used (`phone.commit('formdraft')`
  posts only `{kind}`, app_ports.js:241-244, and BOOT's `lite()` turns only bot updates into events,
  build_simulator.js:175-184), which is why the snapshot carries `last`. The verbs are the existing ones
  (check_simulator.js:198). Captions use `{k:key}` with APP_MSG or MSG keys.

### 8.4 The tours

The id list of check_simulator.js:156 is kept (it checks a superset) and one tour is added.

| id | Login · device | Steps (targets) | `done` of the last step |
|---|---|---|---|
| sell | sister · app | `tag S1-0002` (`tagIn`: the form opens with the line), `f: save` | `ledgerGrew('SALE', 'S1-0002')`. Title 'ရောင်း · တစ်မျက်နှာတည်း (ငွေသား · အကုန်)' / 'Sell on one screen (cash, paid in full)' |
| deposit | sister · app, need S1-0001 | `tag S1-0001`, `f: buyer:new`, `f: name` = ဒေါ်နီနီ, `f: phone` = 09444555666, `f: paid:part`, `f: amount` = 12500, `f: due:14`, `f: save`; then the four laptop steps unchanged | `creditOf(c, 'ဒေါ်နီနီ')` for the sale part; the laptop steps as today |
| mixed | sister · app | `tag S1-0003`, `f: pay:mix`, `f: acct:KBZ`, `f: transfer` = 5000, `f: save` | a PAYMENT of 5,000 KBZ |
| price | sister · app | `tag S1-0002`, `f: price:S1-0002` = 15000, `f: qty+:S1-0002`, `f: save` | a SALE of 2 × 15,000 |
| back | sister · app | `tag S1-0002`, `tag S1-0003`, `f: remove:S1-0003`, `f: close` (act `{op: 'close'}`) | the form is closed and the ledger has not grown. Title 'ဖယ် · မလုပ်တော့' / 'Remove a line, then leave' |
| restock | brother · app | `f: job:restock`, `tag S2-0003`, `f: qty:S2-0003` = 5, `f: save` | a RESTOCK of +5 |
| newitem | sister · app, need blank S1-0007 | `tag S1-0007` (the new-piece form), `f: photo` (act `{op: 'photo', preset: <the htamein_green record of SIM_PHOTOS>}`, resolved by the page, 8.2), `f: price` = 25000, `f: cost` = 12000, `f: save` | the world's S1-0007 is ACTIVE with price 25,000 |
| expense | sister · app | `f: job:expense`, `f: cat:fabric`, `f: amount` = 20000, `f: save` | an EXPENSE of 20,000 |
| tgsale (NEW) | sister · tg | `tag S1-0002`, START, `cb S\|S1-0002\|1` (the review card), `cb SS\|S1-0002\|add`, `tag S1-0005`, START, `cb SC\|S1-0002\|ok` | two SALE rows in one group. Title 'Telegram · ရောင်းကတ် (အက်ပ် မရှိရင်)' / 'Telegram backup: the review card' |
| lists | owner · laptop, then tg | the laptop part unchanged; the Telegram part: `tag S1-0002`, START, `cb S\|S1-0002\|1`, `cb SS\|S1-0002\|o\|method` (the new KBZ label and AYA Pay show, no WavePay), `cb SS\|S1-0002\|back\|method` (the sub-screen has no ✖️ since revision 2, U11), `cb SS\|S1-0002\|z` | as today on the last step |
| quick | sister · tg | `#flowQuick`, tag, START, `S\|S1-0002\|1` (the one-tap card writes), then `#flowForm` | `saleFlow(c.world.ports) === 'form'`. Title 'quick ရောင်း ↔ form' |
| return, reports | sister · **tg** (revision 2, B1: `devices` removed, so they run on Telegram whichever pane is open, sim_ui.js:993) | unchanged | unchanged. Why: in form mode a home scan on the app opens the sale form and sends no item card (1.2 rule 2), so `return`'s `cb T\|S1-0002` (sim_tours.js:207-213) would never be on screen (⏭ answers "The button is not on the screen yet.", sim_ui.js:1204, and the autopilot fails the step, :1486); `reports` is the owner's kind of tour (R8). On the app a return is ☰ 🕘 → `K\|S1-0002` → ↩️ (1.2 rule 3) |
| payment, takedeposit, order, enrol, stranger | unchanged | unchanged (chat flows; payment and takedeposit also on the app through ☰) | unchanged |

The owner's tours (reports, the 21:00 post, lists, enrol a phone) stay on Telegram and the laptop (R8).

### 8.5 SIM.smoke (sim_ui.js:1299-1466)

Changed steps:

- "the simplest sale" (:1330-1338): `tgStart('S1-0002')`, `tgKey('btn_sell_one')`, `tgTap('SC|S1-0002|ok')`. The
  :1338 condition is unchanged; its label: 'Telegram: START, ✅ ရောင်း ၁, ✅ သိမ်း write one SALE row, cash 18,000'.
- "the deposit sale" (:1340-1357): `tgKey('btn_sold')`, `tgTap('SS|S1-0004|o|buyer')`, `tgKey('btn_new_customer')`,
  `typeOn('tg', 'ဒေါ်စန်း')`, `typeOn('tg', '09777123456')`, `tgTap('SS|S1-0004|o|paid')`, `tgTap('SS|S1-0004|p|half')`
  (`basketNext` opens the due sub-screen), `tgTap('SS|S1-0004|d|14')`, `tgTap('SC|S1-0004|ok')`. The four checks
  (:1354-1357) unchanged.
- "app: a mixed sale of two" (:1367-1397): `{op: 'open', id: 'S1-0003'}` opens the form with the line; then `set
  qty+:S1-0003`, `set pay:mix`, `set acct:KBZ`, `set transfer 5000`, `click [data-f="save"]`, sync. The labels of :1371,
  :1378, :1386 become 'app: S1-0003 opens the sale form with its line', 'app: the form reads 24,000 with KBZ 5,000',
  'app: Save closes the form and the home shows the sold card'; :1393-1395 unchanged.
- "owner: Lists on the laptop" (:1428-1441): `tgTap('SS|S1-0002|o|method')` instead of `tgTap('SS|S1-0002|b|none')`
  before reading the buttons; the :1439 condition is unchanged.

NEW step "app: a three-item basket with a part payment", after "app: a mixed sale of two" (map-sim-tests 8, with this
spec's names; every wait reads the snapshot, so both transports make the same number of checks,
check_simulator_browser.js:91):

1. `n0 = world.ledger.length`; `{op: 'form', kind: 'sale'}`; wait for `form.kind === 'sale'` and no line.
2. Rack clicks S1-0002, `set qty+:S1-0002`, S1-0005, S1-0001: three lines in that order.
3. S1-0001 again and S2-0002: still three lines (refusals `basket_twice`, `basket_other_shop`); S1-0002 again: its
   count stays 2 (`ui_form_twice`, 0.3 rule 14).
4. Total 83,000; defaults cash, paid in full, no buyer.
5. `set paid:part`, `set amount 30000`, `click save` with no buyer: nothing written, the form open, `form.error` is
   the key `sale_need_buyer` (7.2: the snapshot carries keys, revision 2, B2).
6. `set buyer ဒေါ်မြင့်`, `click buyer:C-0001`, `click due:14`, `click save`; the sold card (`basket_sold`); sync.
7. Checks: three SALE rows of one group in line order S1-0002, S1-0005, S1-0001; qty −2, −1, −1; amounts 36,000, 22,000,
   25,000; cash 30,000 · 0 · 0, methods CASH · '' · ''; C-0001 and DueDay today + 14 on every row; note `credit`; ONE
   receipt number on all three; no PAYMENT; no quarantine, no OVERPAID; `openCredits` ONE entry, owed 53,000, its item
   `basket_name`; stock S1-0002 −2, S1-0005 −1, S1-0001 SOLD. About 12 checks.

The last step (+15 days, 21:00) then also finds ဒေါ်မြင့် next to ဒေါ်စန်း in `summary_due_overdue`; :1454 (ဒေါ်စန်း)
stays.

---

## 9. Messages

The texts are drafts made from words MSG already uses (core_messages.js:2-4 asks a native speaker to confirm them); the
family may rewrite any of them in the Messages tab. Revision 3's keys (7 MSG, 84 APP_MSG) are in 13.14; the app shows
every text below without its leading emoji (`appPlain`, 13.1), Telegram as written. No new `btn_*` text contains `ငွေသား`, `KBZPay`, `WavePay` or
`ဘဏ်လွှဲ`, and none starts with `🏦 `. Placeholders fill with `fmtMoney` for money and `fmtCount`/`myDigits` for counts.

### 9.1 core_messages.js `MSG`, round 6, step 1 adds all of them

```
basket_title: '🛒 ရောင်းမည့် စာရင်း · {n} ခု'
basket_card_line: '{n}. {emoji} {id} · {name} × {qty} · {amount}'
basket_total: 'စုစုပေါင်း {total} ကျပ်'
basket_add_ask: '📷 နောက် Tag ကို scan လုပ်ပါ · ဒါမှမဟုတ် နံပါတ် ရိုက်ပါ (ဥပမာ S1-0042)'
basket_moved: '⬇️ အောက်မှာ ဆက်လုပ်ပါ'
basket_closed: '⏱ ဒီစာရင်း ပိတ်လိုက်ပါပြီ · ဘာမှ မမှတ်ရသေးပါ'
basket_paused: '⏸ ဒီစာရင်း ({n} ခု) ခဏ ရပ်ထားပါသည် · ဆက်ရောင်းရင် ↪️ ဒါမှမဟုတ် ပစ္စည်းကတ်ရဲ့ ➕ ကို နှိပ်ပါ'
basket_twice: 'ℹ️ {id} ထည့်ပြီးသားပါ'
basket_other_shop: '⚠️ {id} · {shop} ၏ ပစ္စည်းပါ · မထည့်ပါ'
basket_gone: '⚠️ {id} ရောင်းပြီးသားပါ · မထည့်ပါ'
basket_line_gone: '⚠️ {id} ရောင်းပြီးသားပါ · ဖယ်ပြီးမှ သိမ်းပါ'
basket_blank: 'ℹ️ {id} က Tag အသစ်ပါ · ပစ္စည်းအသစ် အရင် မှတ်ပါ'
basket_max: 'ℹ️ တစ်ခါ ရောင်းရင် {max} ခု အထိပါ'
basket_need_price: '💬 {id} · ရောင်းစျေး ရိုက်ပါ'
basket_bad_phone: '📱 ဖုန်းနံပါတ် တိုလွန်းပါသည် (09 နဲ့ စပါ)'
basket_unique: 'ℹ️ {id} က တစ်ထည်တည်း ပစ္စည်းပါ · ကုန်ရောက် မမှတ်နိုင်ပါ'
basket_sold: '✅ ရောင်းပြီး 🛍 {n} ခု · {qty} ထည် · {amount} ကျပ်'
basket_sold_line: '{id} · {name} × {qty} · {amount} · လက်ကျန် {stock}'
basket_line: '🛍 {n} ခု · {amount} ကျပ်'
basket_name: '🛍 {n} ခု · {names}'
card_buyer_basket: '👤 {customer} · 🛍 {n} ခု · ပေးပြီး {paid} · {method}'
group_item_line: '{id} · {name} · လက်ကျန် {stock}'
restock_group_done: '📦 ကုန်ရောက် {n} မျိုး · {qty} ထည်'
btn_card_line: '{n}. {id} × {qty}'
btn_add_item: '➕ ပစ္စည်း ထပ်ထည့်'
btn_remove_line: '🗑 ဖယ်'
btn_paid_full: '💯 အကုန် ပေးပြီး {amount}'
btn_paid_now: '💳 ယခု ပေးငွေ'
btn_due: '📅 ပေးမည့်ရက်'
btn_item_name: '✏️ နာမည်'
btn_item_cat: '🏷 အမျိုးအစား'
btn_item_cost: '🪙 အရင်း'
btn_item_price: '💰 ရောင်းစျေး'
item_lbl_price: '💰 ရောင်းစျေး {price} ကျပ်'
item_lbl_cost: '🪙 အရင်း {cost} ကျပ်'
item_lbl_cost_none: '🪙 အရင်း မသိသေး'
item_lbl_profit: '📈 အမြတ် {profit} ကျပ် · အရင်းပေါ် {pct}%'
item_lbl_loss: '⚠️ ရောင်းစျေးက အရင်းထက် နည်းနေပါသည်'
item_lbl_count: '🔢 {count} ထည်'
item_ask_count: '🔢 ဘယ်နှစ်ထည် ရှိလဲ?'
item_ask_cat: '🏷 ဘာ အမျိုးအစားလဲ?'
item_ask_cost: '🪙 အရင်း ဘယ်လောက်လဲ? (အထည် + လက်ခ)'
btn_resume: '↪️ ဆက်လုပ်မယ်'
btn_add_to_list: '➕ စာရင်းထဲ ထည့်'
basket_count: '🛍 {n} ခု'
basket_method_gone: 'ℹ️ ဒီအကောင့် မရှိတော့ပါ · ငွေသား ပြောင်းထားပါသည် · စစ်ပြီး ထပ်သိမ်းပါ'
restock_max: 'ℹ️ ကုန်ရောက် တစ်ခါမှာ {max} မျိုး အထိပါ'
ret_credit_open: 'ℹ️ 👤 {customer} · ကျန် {owed} ကျပ် · အကြွေးနဲ့ ရောင်းထားတာပါ · ပြန်အမ်းရင် ဆိုင်ရှင်ကို မေးပါ'
undo_new_used: 'ℹ️ {id} ကို ရောင်းထားပြီးပါပြီ · ပြန်မဖျက်နိုင်ပါ'
item_unregistered: '🏷 {id} · Tag အသစ် ပြန်ဖြစ်ပါပြီ'
```

Fifty keys (revision 2 added the ten from `basket_paused` on and changed the text of `basket_closed`, `btn_paid_full`,
`btn_item_cost`, `item_lbl_cost` and `item_lbl_cost_none`; all fifty names were grepped and are free). Source words: `ord_line` '{n}. {desc} × {qty} · {amount}' (:231) and `receipt_line` (:121) for the line
keys; `ord_total` (:233) for `basket_total`; `sold_done` (:52, its prefix kept for `saleSoldCard`) for `basket_sold`;
`card` (:10, 'လက်ကျန်') for the stock lines; `scan_first` (:74), `menu` (:89, 'ဒါမှမဟုတ်') and `help` (:90, 'ဥပမာ
S1-0042') for `basket_add_ask`; `new_tag` (:9) and `tag_not_blank` (:322) for `basket_blank`; `add_exists` (:392,
'ပြီးသား') for `basket_twice`; `ord_other_shop` (:286) for `basket_other_shop`; `sale_gone` (:444) for the gone keys;
`bad_qty` (:20) for `basket_max`; `ask_sale_price` (:82) for `basket_need_price`; `card_buyer` (:156) and `cust_card`
(:152, 🛍) for the basket names; `restock_done` (:53) and `ask_restock_qty` (:81) for the restock and count keys;
`sale_ask_paid` (:435, 'ယခု ပေးငွေ') for `btn_paid_now`; the round-5 report header ပေးမည့်ရက် for `btn_due`;
`today_query` (:87) for အမြတ်; `btn_add_cat` (:386) for အမျိုးအစား. Revision 2 (U21f): no MSG, APP_MSG or report text
contains အရင်း or ရောင်းစျေး (grep of core_messages.js, app_i18n.js, core_report.js); they are the owner's own words
in the brief (R3: "cost (အရင်း), selling price (ရောင်းဈေး)"), so the native speaker should confirm them. For the
revision-2 keys: `ui_err_busy` (app_i18n.js:97, 'ခဏ') for `basket_paused`; `app_offline` (core_sync.js:93,
'ဆက်လုပ်') for `btn_resume`; `card_pending` (:12, 'ဆိုင်ရှင်ကို မေးပါ') and `btn_return` (:25) for `ret_credit_open`;
`undo_expired` (:58) for `undo_new_used`; `new_tag` (:9, 'Tag အသစ်') for `item_unregistered`; `restock_done` (:53)
for `restock_max`; `ask_cost` (:78, '(အထည် + လက်ခ)') for `item_ask_cost`; the rest ('ပိတ်လိုက်', 'စာရင်းထဲ',
'မရှိတော့', '💯') are drafts.

### 9.2 Changed text (one key)

```
settings_note_sale_flow: 'form = တစ်မျက်နှာတည်း ဖြည့်ပြီး သိမ်း · quick = ခလုတ်တစ်ချက် ရောင်း'
```

Today (core_messages.js:448): 'steps = တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက် ရောင်း'. run_gas.js:1495 compares the note
through `MSG.settings_note_sale_flow`, so only run_wizard.js:1633 needs its successor (10.1). No MSG key is deleted;
round 5's `btn_paid_all`, `sale_ask_qty_price`, `confirm_ask` and `btn_yes` stay as harmless Messages rows.

Revision 2 (M2) adds ONE key to core_sync.js's `SYNC_MSG` block (:92-138, merged into MSG at :139), in step 1:

```
ping_stock_short: '⚠️ {name} ({id}) · လက်ကျန် {stock} · 📦 ကုန်ရောက် မမှတ်ရသေးတာ ရှိနိုင်ပါသည် · စစ်ပါ'
```

Its words: `ping_stock_negative` (:126) for the head, `btn_restock` (core_messages.js:24) for '📦 ကုန်ရောက်',
`ping_overpaid` (:127, 'စစ်ပါ') for the tail; 'ရှိနိုင်ပါသည်' is a draft.

### 9.3 app/app_i18n.js `APP_MSG`, round 6, step 3 adds all of them

```
ui_home_sell: '🛒 ရောင်းမယ်'
ui_home_new: '🆕 ပစ္စည်းအသစ်'
ui_home_scan_hint: 'ℹ️ Tag ကို Scan လုပ်ရင် ရောင်းမည့် စာရင်း ပွင့်ပါမည်'
ui_form_saving: '⏳ သိမ်းနေသည်…'
ui_form_restored: '📋 မသိမ်းရသေးသော စာရင်း ပြန်ပေါ်လာပါပြီ'
ui_form_clear: '🔄 အသစ်'
ui_form_no_scan: '✖️ ဒီစာမျက်နှာ ပိတ်ပြီးမှ Tag ဖတ်ပါ'
ui_line_card: 'ℹ️ ပစ္စည်းကတ်'
ui_line_one: '၁ ထည်တည်း'
ui_line_stock: '📦 လက်ကျန် {stock}'
ui_stock_over: '⚠️ လက်ကျန် {stock} ထည်သာ ရှိပါသည်'
ui_buyer_known_phone: '📱 ဒီဖုန်းက {customer} ပါ'
ui_transfer_part: '💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ?'
ui_new_title: '🆕 ပစ္စည်းအသစ် · {id}'
ui_tag_scan_new: '📷 Tag အသစ်ကို Scan လုပ်ပါ'
ui_photo_retake: '🔄 ဓာတ်ပုံ ပြန်ရိုက်'
ui_form_name: 'ပစ္စည်း အမည်'
ui_form_name_later: '📸 အမည် မရိုက်ရင် ဓာတ်ပုံကို ကြည့်ပြီး နောက်မှ အမည် ပေးပါမည်'
ui_form_count_sku: 'ℹ️ {n} ထည် · လက်ကျန်နဲ့ ရောင်းမည့် ပစ္စည်း ဖြစ်ပါမည်'
ui_restock_after: '📦 လက်ကျန် {now} → {after}'
ui_form_older: '📋 မသိမ်းရသေးသော စာရင်း {n} ခု ရှိပါသည်'
ui_form_merge: '📋 ပြန်ထည့်'
ui_form_twice: 'ℹ️ {id} ထည့်ပြီးသားပါ · အရေအတွက် တိုးရင် + ကို နှိပ်ပါ'
ui_price_far: '⚠️ {price} ကျပ် · ပစ္စည်းစျေး {list} ကျပ်ရဲ့ ၁၀ ဆ ကျော်နေပါသည်'
ui_buyer_pick_first: '👤 စာရင်းထဲက ဝယ်သူကို နှိပ်ပါ · ဒါမှမဟုတ် ✏️ နာမည်အသစ်'
ui_buyer_same_name: '👤 ဒီနာမည်နဲ့ ဝယ်သူ ရှိပြီးသားပါ · ဒီလူလား?'
```

Twenty-six keys (merged into MSG at load, app_i18n.js:152-156; revision 2 added the last six, all grepped free in MSG
and APP_MSG). Their words: `ui_form_restored` for `ui_form_older`; `basket_twice` and `ui_keypad_qty`
('အရေအတွက်') for `ui_form_twice`; `btn_new_customer` (:45, '✏️ နာမည်အသစ်') for `ui_buyer_pick_first`; `add_exists`
(:392, 'ရှိပြီးသား') for `ui_buyer_same_name`; the rest are drafts.

### 9.4 Reused word for word

- MSG: `btn_save` (:344), `btn_cancel` (:32), `btn_back` (:335), `btn_undo` (:27), `btn_receipt` (:42), `btn_pay` (:37),
  `btn_customer` (:140), `btn_new_customer` (:45), `btn_no_name` (:424), `btn_cash` (:132), `btn_wallet` (:425),
  `btn_bank` (:131), `btn_bank_transfer` (:426), `btn_split` (:376), `btn_add_bank` (:385), `btn_kind_wallet`,
  `btn_kind_bank` (:429-430), `btn_credit` (:41), `btn_half` (:254), `btn_days` (:238), `btn_due_type` (:240),
  `btn_due_unknown` (:428), `btn_other` (:31), `btn_skip` (:30), `btn_type_qty` (:17), `btn_discount` (:22),
  `btn_pending` (:48), `btn_sample_on` / `btn_sample_off` (:49-50), `btn_restock` (:24), `btn_expense` (:160),
  `btn_add_cat` (:386), `btn_note` (:166), `btn_acct_number` (:399), `btn_use_deposit` / `btn_no_deposit` (:46-47),
  `sale_ask_method` (:432), `sale_ask_account` (:433), `sale_ask_split_account` (:434), `sale_ask_paid` (:435),
  `sale_ask_due` (:436), `sale_ask_kind` (:437), `sale_need_buyer` (:438), `sale_line_method` (:439), `sale_line_mixed`
  (:440), `sale_line_paid` (:441), `sale_due_set` (:442), `sale_due_none` (:443), `sale_gone` (:444), `sale_bad_amount`
  (:445), `credit_ask_customer` (:98), `credit_done` (:99), `credit_use_deposit` (:100), `cust_find` (:150), `cust_pick`
  (:143), `btn_create_named` (:144), `ask_name` (:80), `ask_phone` (:146), `ord_ask_phone` (:219), `ord_ask_due_text`
  (:251), `ord_bad_date` (:252), `split_ask_amount` (:378), `ask_qty` (:18), `ask_qty_number` (:19), `bad_qty` (:20),
  `ask_sale_price` (:82), `ask_number` (:79), `ask_price` (:77), `ask_cost` (:78), `new_tag` (:9), `tag_not_found`
  (:8), `tag_not_blank` (:322), `scan_first` (:74), `photo_seen` (:83), `item_created` (:85), `price_ask_owner` (:193),
  `card_pending` (:12), `sample_mark` (:13), `restock_done` (:53), `expense_done` (:55), `exp_ask_shop` (:161),
  `exp_ask_cat` (:162), `exp_ask_amount` (:163), `exp_ask_note` (:165), `add_ask_pm` (:388), `add_ask_ec` (:389),
  `add_unavailable` (:393), `acct_detail_hint` (:403), `undo_done` (:57), `void_done` (:190), `expired` (:71).
- APP_MSG: `ui_btn_close` (:37), `ui_btn_keypad` (:31), `ui_keypad_title` (:32), `ui_keypad_qty` (:33), `ui_scan_start`
  (:25), `ui_torch` (:30), `ui_recent_title` (:40), `ui_btn_photo` (:65), `ui_btn_pick_date` (:55), `ui_date_title`
  (:56), `ui_meas_close_ask` (:149), `ui_not_saved` (:58).
- Revision 2 adds to the reused set: MSG `btn_void` '🚫 ပယ်ဖျက် (ဆိုင်ရှင်)' (:189), `find_none` (:92),
  `btn_kind_wallet` (:429, the collapsed wallets), `btn_add_bank` (:385, `pay:add`), `ask_sale_price` (:82, a pending
  line's keypad title); APP_MSG `ui_find_placeholder` (:42), `ui_find_none` (:43), `ui_history` '⌃ မှတ်တမ်း' (:48),
  `ui_scan_starting` (:26), `ui_camera_denied` (:27), `ui_camera_none` (:28), `ui_camera_error` (:29) for the strip.

---

## 10. Tests

Plain Node, `check(cond, label, detail)`, labels from MSG, relative dates, the 64-byte listener (run_wizard.js:58-65),
every new check red without its feature ("fails without" names the code whose absence turns it red). Existing checks
change only where 10.8 names them. Revision 3's new checks (W34-W39, R6g-R6i, run_gas 29-32, run_app 57-72,
check_simulator 5c) and its changed checks are in 13.15; their rows are also in 10.8.

### 10.1 poc/run_wizard.js: rewritten in place (step 1)

The name stays (apps-script/README.md:363 and :374 run it). The bench (:55-130) keeps `world.settings.sale_flow =
'steps'` (:76), which now also proves that `steps` reads as form. `guided()` (:122-127) becomes `card(u, id, answers)`:
scan, tap the card's sell button (`S|<id>|1`: the review card), then each answer as `answer` does today. The helpers
`same`, `txt`, `head`, `bytes`, `dmy`, `edits`, `worlds` and `CARD_SOLD_ROWS` stay.

**Disposition of every round-5 check** (today's lines and labels; map-sim-tests 5.1 has each label in full). V = kept
verbatim; W<n> = the successor step that re-asserts the rule on the review card (same label where the rule survives);
O = dropped with the step machine.

| Round-5 step | Kept verbatim (V) | Successor (W) | Dropped (O) |
|---|---|---|---|
| 1 Nothing before ✅ (:143) | none | W1: 149 (the card is edited into the review card: same id, nothing written), 172 (Save = one SALE row: qty −1, cash 18,000, CASH, no customer, no DueDay, no note), 175 (the sold card has [undo, receipt] only), 177 (state cleared, `lg` holds the group); W4: 154, 157 (the buyer sub-screen's rows end with [⏮ `back\|buyer`] ALONE: no ✖️ on a sub-screen, revision 2, U11); W8: 187 (a typed amount never commits: it returns to the card or to `basketNext`) | 151, 159, 163, 167, 169, 183, 192, 195 |
| 2 The count (:200) | 204 (`cardKeyboard` is byte-identical in both modes) | W2: 209, 211 (the `Q` grid is quick's `askQty`), 227, 248 (the line sub-screen's grid and its typed count), 253 (a one-of-a-kind line has no grid) | 213, 217, 236, 240 |
| 3 A changed price (:259) | none | W3: 265, 278 (qty −2 at 15,000, note `price` on that row), 285, 292 | 269, 273, 275, 300, 304, 307 |
| 4 Buyer (:312) | none | W4: 318, 323, 327, 332, 336, 339, 343, 347, 350, 353, 357, 363, 366, 368, 372, 375 (each through `o\|buyer`; the exit is `basketNext`) | none |
| 5 How paid (:380) | none | W5: 386, 388, 392, 398, 404, 410, 416, 420, 425, 432, 436, 442 (through `o\|method`) | none |
| 6 Mixed (:447) | none | W6: 453, 463, 469, 479, 482, 486, 493 (now a Save refusal), 501, 503, and 467, 468, 474 with the card as setup; W18: 515 | 458, 490, 497 |
| 7 The seven outcomes (:520) | **all**: 525, 527, 529, 531, 533, 536, 539, 541, 543, 545, 547 (they pin the wrapper, B8) | none | none |
| 8 Part without a buyer (:552) | none | W8: 558 (the card shows `sale_need_buyer`; Save writes nothing), 562, 573, 577, 583, 591, 601, 609, 613 (the paid answer opens the buyer sub-screen in its need-buyer view, then the due sub-screen); NEW in W8 (revision 2, B4): on a part draft with a buyer and a day, `p\|all` returns to the card with `part` false and `paid` and `dueDay` cleared, and its text is `btn_paid_full` with the total | 568, 597 |
| 9 Due typed and unknown (:620) | none | W9: 628, 632, 639, 641, 645, 649, 652, 656, 658 | none |
| 10 Overdue by DueDay (:663) | the assertions 670, 674, 678, 679, 689 | setup through `card()` | none |
| 11 Back (:694) | none | W11: 742, 744 (`S` stays exempt), 749, 752, 756, 758, 760, 764, 766 (back goes to the parent sub-screen; from how paid to the card it restores the payment) | 702, 708, 710, 713, 715, 722, 730, 736, 739, 771, 774 |
| 12 Cancel (:780) | 829 | W12: 786, 793, 797, 810, 816, 818, 824 (✖️ from the card, on its own row below Save; revision 2, U11) | 802 |
| 13 Stale, double, expired (:834) | none | W13: 841, 850, 857, 870 (two ✅ within 120 s write one group), 874, 878, 884, 889, 891 (**changed rule**, revision 2, U10: a scan without ➕ pauses the card, `basket_paused` with ↪️, keeps the state, and the new item card offers `➕ စာရင်းထဲ ထည့်`) | 855, 861, 864 |
| 14 Sold meanwhile (:896) | 922 (setup through `card()`: `l\|S1-0003`, `q\|9`, `SC\|S1-0003\|ok` instead of :918-921's `Q\|` grid taps, revision 2, B7); 905 (a setup check, setup through `card()`) | W14: 907 (**changed rule**: the card stays with `basket_line_gone` on top, nothing written, the state kept), 916 (the first tap still answers `sale_gone`) | 901 ('the sister reaches the summary': the summary step is gone) |
| 15 ➕ inside the sale (:928) | none | W15: 934, 938, 944, 950, 954, 957, 964, 969, 974, 978, 981, 986, 991, 995 | none |
| 16 Menu taps keep the flow (:1001) | none | W16: 1009, 1011, 1016, 1019, 1023 | none |
| 17 Quick switch (:1028) | 1032, 1036, 1041, 1045, 1062 | W17: 1049 (+ no `NI\|`/`NC\|` and no `SS\|…\|o\|` in the quick world), 1051 ('steps', 'x', a blank and a missing key read **form**), 1057 (flipped to form: the next tap shows the card) | none |
| 18 Voice (:1067) | 1074, 1077 | W18: 1080, 1083, 1088 (a spoken answer lands in the open sub-screen) | none |
| 19 Owner (:1093) | none | W19: 1103, 1106, 1109, 1118, and 1100, 1112 with the card as setup | 1116 (a `\|\| true` check that can never fail, B7) |
| 20 Receipt and reports (:1124) | 1159; the assertions 1135, 1138, 1146, 1152 | setup through `card()` | none |
| 21 Ledger helpers (:1165) | **all** (1170-1186), setup through `card()`: :1174 drives `guided(..., 'btn_cash', ..., 'btn_yes')`, buttons that no longer exist (revision 2, B7) | none | none |
| 22 Kind in the core (:1191) | **all** (1196-1243) | none | none |
| 22z (:1249) | none | W22z: 1256, 1265, 1269, 1277, 1285, 1294, 1299, 1303, 1322, 1326, 1334 | 1260, 1312, 1316 |
| 22y (:1338) | 1412, 1418 | W22y: 1357, 1364, 1369, 1375, 1383, 1389, 1394, 1402, and 1424 (revision 2, B4: :1420-1424 drive `guided(['btn_no_name', 'btn_cash'])` and pin `btn_paid_all` → `SC\|S1-0002\|ok`, which round 6 removes; its successor opens the paid sub-screen through `card()` and `o\|paid` and checks `buttonByKey(..., 'btn_paid_full') === 'SS\|S1-0002\|p\|all'`, the label rule still cutting at the first `{`, and that `btn_days` still throws) | 1345, 1350 |
| 22x (:1429) | none | W22x: 1441, 1445, 1450, 1458, 1464, 1474, 1485, 1490, 1516, 1525, 1532, 1538, 1546, 1551, 1569, 1573, 1600 | 1498, 1506, 1583, 1592, 1608 |
| 23 Texts, 64 bytes, no errors (:1614) | 1619, 1621, 1623, 1626, 1637, 1639, 1645 | 1633 **changed**: `settings_note_sale_flow` is compared with SPEC-round-6.md 9.2, the other 24 keys still with SPEC-round-5.md; W23: 1643 (START + one tap shows the review card, its last line `sale_line_paid`; nothing written before Save) | none |
| 24 Caption-aware edits (:1651) | **all** (1661, 1662; the edits now include the review card's, `basketPause`'s and `basketClose`'s) | none | none |

**New steps:**

| Step | Checks | Fails without |
|---|---|---|
| W25 Pure helpers | `basketAllocate` fills in order ([36000, 22000, 25000] with 30,000 → [30000, 0, 0]; with 40,000 → [36000, 4000, 0]; with 73,000 → [36000, 22000, 15000]) and 200 seeded random cases keep Σ = A and 0 ≤ cash_i ≤ amount_i; `basketTotals` of one line equals `commitSaleGroup`'s derivations on the seven outcomes' inputs, and a pending line counts 0 and is listed; `saleDueKey` (0, 14 and 365 accepted; 366, −1 and 0.5 null; 'none' → ''; yesterday and +400 null; yyyy-mm-dd and Burmese digits accepted); `itemMargin` ((25000, 12000) → {13000, 108}; (12000, 25000) → {−13000, −52}; an empty cost or 0 → null); `itemPlaceholderName('S1-0007') === 'ပစ္စည်း S1-0007'`; `aiRenameFields` (a placeholder name → the AI name; a typed name → null; a BLANK item (name '') → null; category only when '' or 'အခြား'); `basketAddItem` (each reason in its order; a stock item again raises its count; a UNIQUE stays 1; the owner's shop is the first line's; a pending item accepted with unitPrice null; `restock` refuses a UNIQUE as `unique`); `basketCheck` (each code with its key, in the order of 4.2, on hand-built drafts) | the helpers, the fill rule, the bounds |
| W26 commitBasket | the three-line basket of 3.3 against outcomes 1, 2, 3, 3b, 4, 5, 6 and 7, row by row (type, order, cash, method, note, DueDay on every SALE row, the customer on every row, the PAYMENT last with `refGroupId` and no DueDay, owed); a one-line basket writes step 7's rows field by field (B8); a clock that advances 1 ms per `now()` across 23:59:59.999 Yangon gives every row of a basket, and the SALE and PAYMENT of a mixed one-item `commitSaleGroup`, one `time` and one `day` (the second is red today: `newTx` reads the clock per row, core_ledger.js:32); one group id; it throws on 0 and on 11 lines; `rewriteCheck` answers `complex` | B1-B9, the single clock read |
| W27 Readers on a basket | (a) `saleCardText` = `basket_sold` + three `basket_sold_line`s and `saleSoldCard` is true on it; (b) the sold-out S1-0001 card shows `card_buyer_basket` with the basket's paid; (c) `openCredits` item = `basketName` while a one-line credit keeps its item name; (d) the `U\|g` reply lists the three items with their stock back, and a mixed one-item sale's reply is today's; (e) the customer card has one line for the basket and the later PAYMENT as its own line, a one-row group's line is `customerLine`'s; (f) `saleGroupInfo` on a hand-built group whose row 1 is undated and row 2 dated gives row 2's date (red today); +15 days, `buildDailySummary` names the buyer in `summary_due_overdue`; (g) `receiptText` has three lines, the total and the method; `dayStats` sums; (h) `describeGroup` (a basket, a two-line restock group, a one-row group = `describeRow`); a later `commitPayment` caps at the basket's owed; (i) revision 2, M4: a two-line custom-order delivery (run_scenario's V1-2533 shape, core_orders.js:263-272) keeps today's `U\|` reply (no `group_item_line` for `V1-2533-1`, no throw), today's customer-card lines (one per voucher row) and its Credits item name, and `describeGroup` gives `describeRow`; (j) revision 2, M6: two hours after the sale, the owner's `RC\|g` of the basket carries `btn_void` → `V\|g`, and that tap mirrors every row and lists the three items; a seller's `RC\|g` has no void button; the owner's item card of S1-0001 carries 🧾 `RC\|g`, a seller's does not; a one-line sale's receipt is today's for both. (e) reads '{day} · ရောင်း 🛍 ၃ ခု · 83,000 · ပေး 40,000 · ငွေသား' (the amount once, m2) | each reader change of section 5, `basketGroup`, `ownerBasketRow` and the receipt's void row |
| W28 New piece and restock writes | `commitNewItem`: count 1 → UNIQUE, stock 1, RESTOCK 1, 'new item'; count 3 → SKU, stock 3, ONE RESTOCK of 3; sample → 'new sample'; price 0 → '' (pending); the refusals `missing`, `not_blank`, `count` (0, 1000), `price` (absent, −1, 1.5), `cost` ('x') write nothing; an empty name → the placeholder; an unknown category → 'အခြား'. `commitRestockGroup`: two lines → one group of two RESTOCK rows and one undo that mirrors both (the `U\|` reply lists both items); the refusals `empty`, `max`, `qty`, `unique`, `blank`, `other_shop` write nothing. Revision 2: `commitNewItem` refuses `other_shop` for a seller's S2 blank tag and writes nothing (m7); the new piece's `U\|g` within 30 minutes mirrors the RESTOCK, leaves the item BLANK (name '', type '', stock 0) and answers `undo_done` + `item_unregistered`; after a sale of one of its pieces the same `U\|g` answers `undo_new_used` and writes nothing (M5) | `commitNewItem`, `commitRestockGroup`, the types-based reply, `newItemUndoInfo` / `unregisterItem` |
| W29 The Telegram new-piece card | a blank tag, then a photo → the card (state step `card`, `form` true, nothing written); `P\|id\|25000` redraws the card (no `ask_cost`, no write); `C\|id\|other` + 12000 → the `item_lbl_profit` line 13,000 · 108%; `NI\|id\|q\|+` twice → '🔢 ၃ ထည်'; the name and category sub-screens and their back; `PS` sample; `NC` → SKU, stock 3, one RESTOCK, `item_created`; a pending price sends the owner `price_ask_owner` with `SP\|` buttons; `NC` with neither price nor pending → `ask_price` on top, nothing written, and a second `NC` on the same message within 120 s then works; an `NC` after another tag replaced the state answers `expired`; under quick, `P\|` still asks `ask_cost`. Revision 2 (U12, U21e, M5): a typed 25000 at step `card` sets the price and redraws the card (no AI call: the mock AI's call count is unchanged); a typed 300 answers `ask_price` on top; a typed 'ထမီ အသစ်' becomes the name; a second photo keeps the typed name, the category and the count and replaces the photo only; the cost sub-screen asks `item_ask_cost`; the accepted `NC`'s item card has `U\|<g>` as its first row | the card, `NC` in MUTATING, the freed guard, the `card`-step routing |
| W30 The app hooks in the core | a world whose `ports.ui.openForm` is a recording stub: `S\|S1-0002\|3` → `openForm('sale', {itemId: 'S1-0002', qty: 3})` with no edit and no state; `Q\|`, `QN\|` → sale qty 1; `D\|` → sale with `focus: 'price'`; `R\|S1-0002` → restock; `M\|exp` → expense; `openTag` of S1-0002 → sale; a blank tag → newitem; a price-pending piece → sale; a sold piece and another shop's tag (a seller) → the item card; `K\|S1-0002` → the item card; `S\|S2-0002\|1` by a seller → the card with `basket_other_shop`, no hook; under quick the card and the one-tap commit; revision 2 (m7): a seller's blank S2 tag in form mode answers `basket_other_shop`, no hook and no state, and under quick today's `new_tag` | `startSaleFor`, the `openTag` route, `formsInApp`, the other-shop blank refusal |
| W31 The ➕ rule and the shared Save | ➕, then `/start S1-0005` → the add screen reads `basket_moved`, the card comes back as a new message with two lines; a typed id at the add screen adds; a typed 'ဇင်းမယ်' at the add screen lists `i\|S1-0005` (U25); `i\|<id>` adds from the recent buttons; S1-0001 twice, S2-0002, a blank tag, a sold piece → their refusal lines, the basket kept; revision 2 (U10): a scan without ➕ edits the card (with its `isCaption`) to `basket_paused` with `[↪️ → SS\|<a>\|go]`, keeps the state (`paused`), and the new item card's first row is `[➕ စာရင်းထဲ ထည့် → SS\|<a>\|i\|<id>]`; that tap turns the item card into the card with three lines; `go` on the paused card redraws the card there; the older card's ↪️ after that answers `expired`; ✅ on an item card while a basket is live (paused or not) edits the old card to `basket_closed` (the reworded text) and starts a fresh one; no sub-screen carries `z` (U11); `SC` after a refusal on the same message writes one group (the guard key freed); the owner flips `sale_flow` to quick while a card is open: `SC` answers `expired` and the message becomes the item card, nothing written; a `method` refusal (a retired account) answers `basket_method_gone` and the draft's method is CASH; the app form and the card both write through `basketCommitDraft` (a Save of the same draft from each gives identical rows) | `basketPause`, `basketClose`, `basketAddScanned`, the guard removal, the mode check |
| W32 Round-6 texts and bytes | every key of 9.1 is in MSG, non-empty and equal to the block of 9.1 (parsed from this file, as :1633 parses round 5's); `settings_note_sale_flow` equals 9.2; no new `btn_*` contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ, and none starts with '🏦 '; the byte counts of 2.1 and 2.3 (`SS\|S1-0002\|rm\|S1-0005` 21, `SS\|S1-0002\|back\|due_text` 24, `SS\|S1-0002\|go` 13, `NI\|S1-0007\|back` 15, `NC\|S1-0007\|ok` 13), labelled as PINS: they are literal constants that hold without the feature, as round 5's :1637 is (revision 2, B10); every callback emitted by every bench is at most 64 bytes; no update failed with an exception | the keys (the literal byte counts are pins) |
| W33 Returns on credit (revision 2, M3) | the outcome-5 basket (owed 33,000), then `T\|S1-0005` by the sister: nothing written, the card shows `ret_credit_open` with ဒေါ်မြင့် and 33,000; the same by the owner: nothing written, the owner's 🧾 row shows; after `PA\|<g>\|all` (paid up) `T\|S1-0005` writes today's RETURN; a one-line credit sale's piece is refused the same way; a paid one-line sale's `T\|` is today's reply byte for byte; a delivery's tagged piece is not refused by this rule (`isOrderId`) | `creditOpenFor`, the `T` guard |

### 10.2 poc/run_round4.js 9z (step 1)

- **:1938** label only: 'bench() runs on sale_flow quick (seedSimWorld seeds it; the code default is form)'.
- **:1955-1956** condition also excludes `/^(NI|NC)\|/`; label 'quick: no SS|, SC|, NI|, NC| or LA|pm|SSA button was
  ever emitted in this world (…)'.
- **:1962-1964** condition: `Y.world.ledger.length === nY && sy.row === lastY && sy.row.itemId !== 'S1-0002' &&
  sy.card.edited === true && sy.card.text.endsWith(t(Y.ports, 'sale_line_paid', {paid: '18,000', owed: '0'})) &&
  Y.state(U.sister).kind === 'sale' && Y.state(U.sister).step === 'card'`; label 'form: sell() returns no row of its
  own (lastRow() is older than the tap); the card is edited into the review card and a sale state waits'.
- **:1967** label only: 'form: ✖️ on the review card brings the item card back; still nothing written'.
- :1959 (`'steps'`) stays: it now also proves that steps reads as form. Step 10 (:2002, :2007, :2008) unchanged.

### 10.3 poc/run_app.js

**Step 1 edits** (inside `round5()`; they touch only the core's behaviour):

- **Deleted** (45 checks; successors in `round6()`): step 33's 924, 928, 933, 937, 941, 947, 950, 954, 957, 962, 965,
  967, 970, 973 (the `G` creation and enrolment lines stay); step 34 whole (978, 985, 988, 993, 997, 1002, 1006, 1009,
  1013, 1018, 1020, 1023, 1028, 1030, 1032, 1036, with its setup); step 35's checks 1045, 1048, 1051, 1054, 1057 (the
  `G2` creation and enrolment lines stay); step 37's 1103, 1110, 1120, 1122, 1126, 1129, 1132 (the guided chain from
  :1103 to :1132); step 39's guided block :1198-1227 (checks 1213, 1224, 1227; the reset at :1228 stays). Revision 2
  (B13): each deletion is "the step body except the G/G2 creation, the enrolment and `uid`", i.e. the driving lines go
  with the checks they feed (step 33's chain from :923, step 35's :1041-1044 and :1050-1053, step 37's :1105-1131);
  kept are the `G` / `G2` creation and enrolment and step 33's `const uid` (:917), which steps 35-39 use. Left behind,
  those lines would scan into a form in step 3 and tap stale messages.
- **Changed**:
  - **921**: `saleFlow(G.ports) === 'form'`; label 'the server says steps, which reads as form: the next pull carries
    it to the phone'.
  - **1073**: `tg36 && tg36.kind === 'sale' && tg36.step === 'card' && world.ledger.length === w36`; label 'the same tap
    in Telegram (the server says form) shows the review card and writes nothing'.
  - **1077**: `saleFlow(G2.ports) === 'form'`.
  - **1081** (setup of step 37): the S1-0002 card is pushed with `sendItemCard(uid, G2.ports.store.getItem('S1-0002'),
    G2.store.meta.staff, G2.ports)` (round5() has no `staff` binding, and the file runs under `'use strict'`, revision
    2, B13) and `await G2.phone.commit('t')` instead of `G2.phone.sim.start` (a scan opens the sale form from step 3).
    1086 and 1090 then hold unchanged.
  - **1092-1101** (setup of 1097/1101): instead of the stepper tap, the S1-0001 card (one of a kind: no stepper) is
    pushed with `sendItemCard(uid, …, G2.store.meta.staff, G2.ports)`, `q1` = that message; 1101's `SIM_HOT` is
    `'D|S1-0001'` and the hot button's text is `MSG.btn_discount`.
  - **1259**: `saleFlow(H2.ports) === 'form'`; label '…form again'.
  - **1266** (interim, until step 3): `st40b && st40b.kind === 'sale' && st40b.step === 'card' &&
    H2.store.ledger.length === n40b`; label 'the stepper's S|S1-0003|1 opens the sale again (the review card until the
    app has its form hook) and writes nothing'.

**Step 3 edits**:

- `FILES` (:17-24) + `'app/app_forms.js'` after `'app/app_ui.js'`.
- **Deleted** with the app glue they pin (7.4): 900, 901, 902, 903 (the `sale` branch of `appInputModeFor`), 906
  (`appQuestionLine`), 1194 (the guided keypad title). 909 (`appKeypadKeyFor`) and 1196 stay.
- **1142**: `/world\.settings\.sale_flow\s*=\s*'form'/`, and (revision 2, B17) the dev page's script list holds
  `<script src="../app_forms.js"></script>` AFTER `<script src="../app_ui.js"></script>` (app/dev/index.html:124-130 is
  checked by nothing else); label 'the dev page starts in form, loads app_forms.js after app_ui.js and has the
  sale_flow checkbox that syncs the settings'.
- **1262** (setup): the card comes from `sendItemCard` (as at :1081).
- **1266** (final): a listener records `'openform'` events; the tap emits exactly one `{kind: 'sale', req.itemId:
  'S1-0003', req.qty: 1}`, no state and no ledger row follow; label 'the stepper's S|S1-0003|1 asks for the sale form
  (one openform request) and writes nothing'. 1268 then holds unchanged.

**Step 3, new `round6()`** (called after `round5()` at :297), steps 41-56. A phone `F6` is enrolled against a world with
`sale_flow = 'form'` and restocked as `round5()` does; a second phone `F6b` sells against it. Helpers: `fakeWalk`, a
`data-f` walker, the memory adapter's `transactions`, `holdWrites` and `failNext`, a stub APP as step 29 builds.

| Step | Checks | Fails without |
|---|---|---|
| 41 Home and route | `appHomeJobs` gives four jobs under form and none under quick; `F6.phone.sim.start('S1-0002')` emits one `openform` sale request {itemId S1-0002, qty 1}, no BOT message (the `/start S1-0002` user line is pushed as today, app_ports.js:260-262, which the tours' `scanned` reads, revision 2, B19), no state, no ledger row; a blank S1-0007 → `openform` newitem; a seller's blank S2 tag → the toast text `basket_other_shop`, no `openform` (m7); a price-pending piece → sale; a sold piece and S2-0002 → the item card, no `openform`; a `K\|S1-0002` tap on a ☰ 🕘 list → the item card; with the pref `setting:sale_flow = quick` the stepper card as today | the `openTag` route, `ports.ui.openForm` |
| 42 Entry points | the stepper's `S\|S1-0002\|3` → sale qty 3; `Q\|`, `QN\|` → sale qty 1; `D\|` → sale with `focus: 'price'`; `R\|S1-0002` → restock; `M\|exp` → expense; each writes nothing and leaves no state | the hooks of 4.4 |
| 43 Sale model | add S1-0002, `qty+`, S1-0005, S1-0001: three lines, total 83,000, defaults cash / full / no buyer; S1-0001 again → `basket_twice`; revision 2 (U2): S1-0002 again → `ui_form_twice` and its count stays 2, and with `APP.scanner.holdMs` set a stub scanner's repeat of the same text inside 8000 ms reaches no `onDecode`; S2-0002 → `basket_other_shop`; S1-0007 → `basket_blank`; the 11th line → `basket_max`; an unknown id → `tag_not_found`; `find` 'ကချင်' + `find:go` lists S1-0002 and `found:S1-0003` adds a line (U25); every SKU line has `ui_line_stock`, a count above stock adds `ui_stock_over`; a price of 200,000 on S1-0002 adds `ui_price_far` and Save still works (U4); `pay:bank` with one bank picks it, `pay:mix` lists every non-cash account and shows the transfer; with seven accounts the row shows one `pay:wallets` choice (U6); `pay:add` is the last choice on a cash-only shop too (U7); `paid:part` sets `needAmount` and `needDue`; no buyer sets `needBuyer`; `buyer:new` sends typed digits to the phone and a name to the name | `appSale*`, `basketAddItem`, the re-scan rule |
| 44 Save on the real store | ONE adapter transaction carries the three SALE rows, ONE outbox group entry, the sold card (`basket_sold`) in the chat and the draft removal; with `holdWrites` the form is still open and nothing is painted before the release; all three SALE rows carry the same `receiptNo` and the counter grows by 1; `scheduleSync` once at `APP_SYNC_DEBOUNCE_MS`; after the sync the server has three rows in one group, no quarantine, no flag | `appSaleSave`, `appFormCommit`, the receipt copy |
| 45 Part with a new buyer | Save with part and no amount → `sale_ask_paid`; with the amount and no buyer → `sale_need_buyer`; with a buyer and no day → `sale_ask_due`; none writes anything; then a new name and phone, 14 days: the outbox is [customer, group], cash 30,000 / 0 / 0, DueDay +14 on all three, the customer on all three; `openCredits` gives one entry named `basketName`. Revision 2 (U8, U9): search text 'ဒေါ်နီနီ' (no match) left without a pick → a new buyer ဒေါ်နီနီ at Save; search text 'ဒေါ်' (matches) left without a pick → `buyer_pick`, nothing written; a new buyer with ဒေါ်မြင့်'s phone → `known_phone`, nothing written, then tapping her chip uses C-0001 (no new Customers row); ✏️ new 'ဒေါ်မြင့်' → `same_name`, nothing written; `buyer:create` then Save → a SECOND Customers row ဒေါ်မြင့် (`forceNew`); the Telegram card's exact-name pick is unchanged | `basketCheck`, B2-B4, the app's buyer checks, `forceNew` |
| 46 Mixed and a new account | KBZ 20,000 in full: three SALE + the PAYMENT last, no OVERPAID on the server; the three SALE rows carry ONE `receiptNo` and the PAYMENT none (run_app.js:967's rule on the app store, revision 2, B11); a total of 1 offers no 💵+🏦; a new account typed (`acct:add`, `acctname`, `acctkind:bank`) and a refused Save write no Lists row; the accepted Save writes [list, group] in one transaction and the sold card carries `btn_acct_number`; on a cash-only world `pay:add` + 'AYA Pay' + `acctkind:wallet` makes it the method (U7) | B1, `canMix`, Lists rows at Save, the receipt copy |
| 47 Draft | a restart over the same adapter restores the sale draft with `ui_form_restored` when opened with no item (🛒); 1801 s later it is gone; a `formdraft` change does not repaint the home; Save drops the draft; a restored line whose one-of-a-kind piece was sold meanwhile is dropped. Revision 2 (U3): with a draft of S1-0002 × 2, an `openform` for S1-0002 restores it and the count stays 2; an `openform` for S1-0005 opens ONE line S1-0005 with `older` = [S1-0002] and `ui_form_older`; Save then writes only S1-0005; `restored:merge` instead gives S1-0002 × 2 then S1-0005; 🔄 keeps S1-0005 only | the draft helpers, the TTL, the `appOnChange` case, the draft rule |
| 48 Sold meanwhile; the mode | `F6b` sells S1-0001 and syncs; `F6` pulls; `F6`'s Save → `basket_line_gone`, nothing written, the form kept; with `quickForced` from an older server's pull, Save → the form closes and the toast is `expired` (U17), nothing written; a KBZ draft whose account a pull retired → `basket_method_gone`, the method back to CASH, nothing written (U21h) | the Save-time re-read, the `mode` and `method` codes |
| 49 Double Save | a second `appSaleSave` while `F.saving` returns `busy`; one group; revision 2 (U23): two `openform` sale requests for S1-0002 with qty 3 within one tick give ONE line of 3 | the `busy` refusal, the open rule |
| 50 New piece | a sim photo → a media record of status `file`, no queued job, nothing in the outbox; Save with count 3, price 25,000, cost 12,000 and no name → the outbox [item, group] (type SKU, the placeholder name, `photoUrl` 'local://<media>', `photoFileId` the media id), stock 3, ONE RESTOCK +3 'new item'; the job is queued at Save with itemId S1-0007; after the sync the server's item has the Drive `photoUrl` and the phone's replay renamed the placeholder (`replayJob` calls `aiRenameFields`: a source check); a pending price → a `notice` entry with `SP\|` buttons; ✖️ after a photo removes the media and leaves the tag BLANK; a non-blank tag scanned into the waiting form → `tag_not_blank`. Revision 2: (M1) a Save made while a sync is held in flight (the transport holds its response) sends NO `ai` call in that sync's flush; the `again` sync acks the item entry and only then is the job sent, the server's photoUrl stays the Drive URL and the Errors tab has no `sync_conflict`; (U14) the replay's `photo_seen` line lands BEFORE the latest card with buttons, so `appLatestBot()` is still that card; (M5) the new piece's card has `U\|<g>` first, and that tap within 30 minutes leaves S1-0007 BLANK with stock 0 (outbox: the mirror group and one item entry of blanks); (U13) a `not_blank` Save keeps the photo, price, cost and count and clears only the tag; (m7) a seller's S2 blank tag is refused `basket_other_shop`; (U16) the 📸 tap stops the scanner before the input's click | `appNewItem*`, the queue at Save, the M1 hold, the undo |
| 51 Restock | S1-0002 set to 5 (chip) and S1-0003 + 2 → one group of two RESTOCK rows; the reply `restock_group_done` + two `group_item_line`s + undo; S1-0001 → `basket_unique`; the undo mirrors both | `appRestock*`, `commitRestockGroup` |
| 52 Expense | fabric, 20,000, CASH, a note → one EXPENSE row with the note and no rewrite row; a new category typed → the outbox [list, group]; an amount of 0 → `ask_number`, nothing written; the owner's form offers the shop and books S2 when chosen | `appExpense*` |
| 53 Glue (a stub APP) | `appFormSave` closes only after `phone.commit` resolves; `failNext` → `ui_not_saved`, the form closes, the ops kept; a save that throws (a stubbed `basketCommitDraft`) → `expired` in `.fmsg`, Save enabled again, `logError` called (U18); the SW `canApply` is false while a form is open; `revoked` closes the form; visibility restarts the form's scanner, not the home one; `appStartScanner` refuses while a form without `scan` is open. Revision 2 (U1): with a form whose `scan` is set and `APP.showScanner` false, `appRender()` does NOT stop the scanner and a delivered `update` leaves `showScanner` unchanged; the strip shows `ui_scan_starting`, then the running tools, then `ui_camera_denied` after an `onError('denied')`; a saved close does not start the home scanner (U17). (U15) `appOpenForm` pushes one history state; a `popstate` on a dirty form asks and, on no, pushes again; ✖️ calls `history.back()` once and the popstate it fires is ignored. (U5) an `input` event on `buyer` redraws the chips region and leaves the input node and its value in place; a `sync` while the input has focus does not repaint, and its `blur` does. (B5) a `.fnum` tap opens the keypad above the form (`.overlay` z 34 over `.formpage` 32) titled with the field label and the current value, starting EMPTY (U4); '2', '0', '000', OK sets 20,000; OK is disabled at 0; `due:date` opens the sheet titled `ui_date_title` with an `input type=date`, `min` today and `max` today + 365; OK with no date does nothing; OK calls `onOk` with yyyy-mm-dd and the row reads `sale_due_set`. `appOpenTagId` and the photo input route to the open form; the line-name tap closes the form keeping its draft and shows the item card | each hook of 7.4, the keypad and the date sheet |
| 54 Render (fakeDocument) | `appFormRender` of the sale form gives every control a `data-f`; `SIM_HOT = 'f:save'` marks exactly Save; part reveals the amount and the day, both `.fneed`; mix reveals the accounts and the transfer; new reveals the name and the phone, and the phone input has `inputmode=tel` (B12); the `paid:full` segment's text is `btn_paid_full` with the total (B4); no control other than Save carries a ✅ text; the home under form draws the 2 × 2 job grid in the scanner state with the `ui_history` handle, and the compact row in the card state (🛒 with its label, 🆕 📦 💸 with `aria-label`s, U22); app.css has `.overlay` z-index 34, `[data-f].hot`, `.formpage .seg` and `.formpage .toggle` with `flex-wrap: wrap`, and `--fbar-h` in the `.fcol` padding (U6) | the renderer, the reveal rules, the CSS |
| 55 Pending lines | a three-line basket entry shows one `describeGroup` line; a two-line restock entry `restock_group_done`; a one-line entry keeps its `describeRow` line (run_app.js:248-249 stay) | the `pendingLines` branch |
| 56 Older server, deletions, texts | `quickForced`: no jobs and `S\|` commits at once (step 40 extended); `appInputModeFor({kind: 'sale', step: 'buyer'})` is null and `appQuestionLine` is undefined; `appInputModeFor({kind: 'await_text', purpose: 'phone'})` is `'tel'` and no state gives `'date'` (U24, B12); every key of 9.3 is in APP_MSG, non-empty and equal to the block of 9.3; no `deliver` or listener errors on the round-6 phones | `appHomeJobs` reading `saleFlow`, the deletions, the keys |

### 10.4 poc/run_sync.js

**Step 1 edits** (setup lines of R5a, R5c, R5e and four checks; `r5StepsWorld` (:1542-1546) keeps `'steps'`, which now
reads as form; the reference phone has no `ports.ui`, so it gets the review card):

- R5a: **:1558** becomes `['SS|S1-0002|o|method', 'SS|S1-0002|m|mix', 'SS|S1-0002|a|KBZ']`; :1559 (text 5000, the
  transfer part) stays; ONE new line before :1560: `['SS|S1-0002|o|paid', 'SS|S1-0002|p|other'].forEach(d => r5Tap(P,
  d));`; :1560 (9000), :1561 (ဒေါ်မြင့်, typed on the need-buyer sub-screen `basketNext` opens), :1562 (the date, typed
  on the due sub-screen) and :1563 (`SC`) stay. Assertions 1565-1580 unchanged.
- R5c: **:1600** becomes `['SS|S1-0002|o|buyer', 'SS|S1-0002|b|C-0001', 'SS|S1-0002|o|paid', 'SS|S1-0002|p|half']`;
  :1601 (the first preset day, on the due sub-screen `basketNext` opens) and :1602 stay; **:1609** becomes
  `['SC|S1-0005|ok']`. Assertions 1614-1618 unchanged.
- R5e: :1666 (ဦးသန့် typed on the card: a buyer search, then the phone sub-screen) stays; **:1667** becomes
  `['SS|S1-0002|ph|skip', 'SC|S1-0002|ok']`; **:1671** becomes `['SC|S1-0002|ok']`. Assertions 1673-1678 unchanged.
- **1693**: `saleFlow(P.ports) === 'form'` and `P.lastText().endsWith(t(P.ports, 'sale_line_paid', {paid: '18,000',
  owed: '0'}))` instead of `cust_find`; label 'after the pull (the hash changed) saleFlow(phone) is form (the Sheet's
  steps reads as form): the sell button opens the review card and writes nothing'.
- **1734**: `saleFlow(P.ports) === 'form'` (the `same3(wire.caps, ['dueDay'])` part stays); label '… the phone sells with
  the form'.
- **1753**: `saleFlow(P.ports) === 'form'`; label '… form again'.
- **1764**: `saleFlow(P.ports) === 'form'` and the review card's last line as at 1693; label 'published again: one page
  brings the Settings back and the sell button opens the review card (writes nothing)'.
- 1739's `w.settings.sale_flow === 'steps'` is the world's raw value and stays.

**Step 2, new steps after R5h:**

| Step | Checks | Fails without |
|---|---|---|
| R6a A basket on the reference phone through the review card | S1-0002 × 2, then ➕ `/start S1-0005`, then ➕ `/start S1-0001`; mixed KBZ 10,000 with 50,000 paid now (outcome 5); ဒေါ်မြင့်; 14 days. Offline: ONE outbox group [SALE, SALE, SALE, PAYMENT], cash 36,000 / 4,000 / 0, the same `receiptNo` on the three SALE rows and none on the PAYMENT, the counter +1; pushed: ok, no flag (no OVERPAID), Seq in order; the server's `openCredits` gives one entry (`basketName`, the DueDay, owed 33,000); the undo's four mirrors put every bucket back | B1-B5, the sim_phone receipt copy |
| R6b A counted new piece on the reference phone | the Telegram card with count 3 and the price pending: the outbox is [item, group, notice]; the server's item is SKU with stock 3; the owner's Telegram gets `price_ask_owner` with `SP\|` | `commitNewItem`, the card |
| R6c Another shop in a group | a hand-built group from a shop-1 phone with a shop-2 SALE row is quarantined `scope` (pins why `basketAddItem` refuses it) | nothing: a PIN of today's server, green before the round (revision 2, B10 labels it so; rule 0.4's "fails without its feature" does not apply to a pin) |
| R6d The alias | the server's `steps` → `saleFlow(phone) === 'form'`; the server's `QUICK ` → quick | `saleFlow` |
| R6e The photo AI's late rename | a new piece saved on the reference phone with the placeholder name (job queued at the photo); revision 2 (M1): `applyAiResults` while the item entry is still in the outbox sends no `ai` call and the job stays queued; pushed, then `applyAiResults`: the server's item has the AI name, its category and the Drive URL after the job alone (one Rev bump); the phone's replay entry is answered `dup`; no `sync_conflict` in the Errors tab and no `ping_conflict` in the owner's chat (red today: the experiment of 0.3 rule 2); a typed name and a chosen category other than 'အခြား' are never replaced | the server rename (6.2) on poc/sim_sync.js, `aiRenameFields` and the M1 hold in sim_phone.js |

### 10.5 poc/run_gas.js

- **Step 1 edits**: **1495** `flow.Value === 'form'`; label 'Settings: sale_flow = form, its Key cell carrying
  settings_note_sale_flow, and sale_due_presets = 7,14,30'. **1540** `r.Value === 'form'`; label 'Settings got
  sale_flow = form and sale_due_presets; nothing in the Errors tab'.
- **Step 2, new sections** (before section 17 "Over the whole run"):
  - **26** one sync through the real handler with [customer, a three-line part-and-mixed basket, list entry]: one Ledger
    block of 4 rows × 27 with one GroupID, the DueDay text on the three SALE rows and blank on the PAYMENT, the Credits
    tab's Item = `basketName`, the Customers tab's bought and paid, no OVERPAID, an empty Errors tab. The basket's rows
    are BUILT by `commitBasket` on the real store of a reference phone (revision 2, B10: section 23 writes its rows by
    hand, and hand-written rows would pass without B1/B3). Fails without B1/B3 and `basketName`.
  - **27** setupSheet on a book whose Settings hold `sale_flow | steps` and whose Messages hold round 5's default
    `settings_note_sale_flow`: the Settings value is REWRITTEN to `form`, the Messages row to the round-6 text and the
    Key cell's note says form/quick (revision 2, m6); a book whose Settings say `quick` and whose note the family
    retyped keeps both; `saleFlow` reads form for a phone's older `steps`; the Errors tab is empty. Fails without the
    rewrite and the alias.
  - **28** a source check: `gasSyncHooks().ai`'s photo branch calls `aiRenameFields` and writes `photoUrl` and the rename
    in one `updateItem` (DriveApp is not modelled by the fake, run_gas.js:319, so the branch is pinned by source; the
    behaviour is R6e on its twin). Fails without 6.2 on gas_sync.js.

### 10.6 poc/check_simulator.js (step 4)

**Changed**: **120-124** the id list names `flowForm` instead of `flowSteps`; **140** the regex
`world\.settings\.sale_flow = 'form'`, label 'the page boots with sale_flow = form'; **160** `KINDS` gains `'f'` and
**193**'s label '…(tag, cb, label, re, type, ui, tab, f)…'; **217** `sell` becomes `tgsale`, label 'the tgsale tour runs
from S|S1-0002|1 to SC|S1-0002|ok'; **223** `s3` is taken from `tgsale` (the `tap` predicate is the same function,
sim_tours.js:38-45).

**New**: 5b: app/app_forms.js sets `'data-f'` and reads `SIM_HOT`; BOOT has the ops `form`, `set`, `photo` and `close`,
`snap` carries `form` (with `last` and `error`), `hot` repaints a form; app.css styles `[data-f].hot`; revision 2 (B3):
the `photo` op builds its media from `cmd.preset.meta` / `.visual` (a record, never a key: the source of BOOT does not
name `SIM_PHOTOS`), and the newitem tour's act sends `SIM_PHOTOS`' htamein_green RECORD. 6b: the tours sell, deposit,
mixed, price, back, restock, newitem and expense have device `app`, and their SALE PART ends at an `f` target (`f:
save`, or `close` for back; deposit then goes on to the owner's laptop steps, check_simulator.js:214; revision 2, B9);
every `f` / `fset` step's `done` is `formUsed(name)` or `formIs(kind)` (revision 2, B2); every `f` name a tour uses, up
to its first `:`, is a literal in app_forms.js; tgsale is device `tg` and holds `SS|S1-0002|add`; `return` and `reports`
have no `devices` (they run on Telegram, B1); no tour that can run on the app (device or devices `app`) has a `tag` step
of a sellable own-shop item followed by a `cb` that only the item card offers (`T|`, `X|`, `R|`, `D|`, `Q|`, `QN|`,
`S|`) (B1); `doLogin` puts a `staff` login on `app`; `doTarget` maps `frame:` to the `click` op.

**Unchanged**: :47, :87 (both lists gain the file in step 3), :93, :135-139, :141, :153, :156, :190-214, :226, step 7, and
check_simulator_browser.js (its :91 binds the new smoke step to the same count on both transports).

### 10.7 SIM.smoke and the manual browser checks

SIM.smoke: section 8.5. Manual checks (step 4 lists them, the orchestrator runs them) on poc/dist/pos-simulator.html:

- a seller lands on 📱, enrols with ⚡, sells by scan + Save; the compact job row shows above the sold card;
- a three-tag basket with a buyer chip, part and 14 days; the needed rows are outlined the moment 💳 is chosen; the sold
  card shows undo and receipt;
- a line's name opens its item card (↩️ and 🔁 there); 🛒 brings the basket back with `ui_form_restored`;
- the new-piece form with the preset photo, profit and %, count 3; the name renamed after the sync;
- the restock and expense forms; ☰ 💸 opens the expense form;
- the keypad opens above a form; the date sheet from the promised-day row;
- the Telegram review card: ➕, scan, Save; a scan without ➕ shows `basket_paused` with ↪️ and the item card's
  `➕ စာရင်းထဲ ထည့်` adds the piece; ✅ on another item card then closes the old card (`basket_closed`); the new-piece
  card, a typed 25000 on it;
- the owner's 💻 Ledger shows the Basket column and Credits shows `basket_name`;
- the form at laptop width in two columns; dark mode;
- the form/quick switch flips both devices;
- `?autorun=smoke` gives failed 0, and `&transport=post` gives the same count.

On app/dev/index.html: the sale form covers the window (expected), Save works, the checkbox flips.

**On real phones** (revision 2, U1, U2, U15; the simulator frame and `fakeDocument` have no camera, run_app.js:850-888,
so these are the only checks of the strip). On one Android phone (Chrome, the installed app) and one iPhone (Safari),
with a build of `app/dist/`:

- a home scan of a SKU opens the sale form and the strip's camera keeps running (it is not stopped by the home's
  render); a SECOND tag is read in the strip and becomes the second line;
- the first tag held under the camera for ten seconds: no buzz after the first, its count stays 1;
- the strip shows the starting state, the running tools (🔦 where the phone has a torch) and, with the camera
  permission refused, `ui_camera_denied` and the ⌨️ row;
- 📸 in the new-piece form opens the phone's camera app (the strip's stream stopped first) and the photo comes back;
- Android back on an open, changed form asks `ui_meas_close_ask`; "no" keeps the form; back on an unchanged form closes
  it and a second back leaves the app;
- the iPhone strip keeps playing after a repaint (typing in the buyer search, a sync).

**On real phones, revision 3** (review r3, UX-M4; the frame and `fakeDocument` have no back gesture, no canvas, no share
sheet and no print dialog, so these are the only checks of them), on the same two phones with a build of `app/dist/`:

- cold start, no tap, a camera scan opens the sale form, Android back: note whether the form closed or the app left
  (Chrome's skip of an entry added without a tap, 13.4); then cold start, one tap anywhere, a camera scan, back: the form
  closes and the app stays;
- ☰ → 👤 ဝယ်သူများ → a buyer → a sale row's receipt, then back four times: the buyer, the buyers, the home with the menu
  card, the scanner; a fifth back shows `ui_back_again` and a sixth leaves the app;
- Scan from three layers deep, then a scan that opens a form, then ONE back: the form closes (not three backs);
- a changed form, back, "no": the form stays; back again asks again; "yes" closes it;
- the home's sold card after a Save shows ←; the receipt opened from it returns to it;
- the measurement form: a finger swipe over the figure scrolls the page and leaves no mark; ဆွဲ, draw, undo the last
  stroke, OK; rotate the phone, draw again: the stroke lands under the finger; Save, reopen the session: the drawing is
  back; after a sync the measurement PDF shows the figure sharp at the phone's devicePixelRatio;
- the receipt's 'ဘောက်ချာ Share မယ်' opens the share sheet with the receipt text (Viber, Telegram); 'PDF / Print' opens
  the print dialog with the receipt alone (no header, bottom bar or buttons).

### 10.8 Every existing check that changes (the only edits allowed)

| File:line | Label (today, short) | Change | Step | Why |
|---|---|---|---|---|
| poc/run_wizard.js (whole file) | round-5 steps 1-24 | rewritten per 10.1 (V verbatim, W successors, O dropped) | 1 | R5 removes the step mode |
| poc/run_round4.js:1938 | 'bench() runs on sale_flow quick (… default is steps)' | label | 1 | R6 default |
| poc/run_round4.js:1955-1956 | 'quick: no SS\|, SC\| or LA\|pm\|SSA button…' | + `NI\|`, `NC\|` | 1 | the new prefixes |
| poc/run_round4.js:1962-1964 | 'steps: sell() returns no row… buyer screen…' | condition + label (review card) | 1 | R5 |
| poc/run_round4.js:1967 | 'steps: ✖️ on that screen brings the item card back…' | label | 1 | R5 |
| poc/run_app.js:921 | 'the server says steps…' | `form` | 1 | R6 |
| poc/run_app.js:924-973, 978-1036, 1045-1057, 1103-1132, 1198-1227 (1213, 1224, 1227) | the app's guided chat steps (45 checks) | deleted; successors in round6 41-56 | 1 | R1, R5 |
| poc/run_app.js:1073 | 'the same tap in Telegram (the server says steps) asks the buyer…' | the review card | 1 | R5 |
| poc/run_app.js:1077 | 'without the pref the phone follows the server again…' | `form` | 1 | R6 |
| poc/run_app.js:1081 (setup) | step 37's card | `sendItemCard` instead of a scan | 1 | a scan opens the form in step 3 |
| poc/run_app.js:1092-1101 (setup of 1097, 1101) | 'every keyboard button carries data-cb…', 'SIM_HOT marks exactly…' | the S1-0001 card's keyboard; `D\|S1-0001` | 1 | no guided screen in the app |
| poc/run_app.js:1259 | '…steps again' | `form` | 1 | R6 |
| poc/run_app.js:1266 | '…opens the guided sale again and writes nothing' | interim: the review card | 1 | R5 |
| poc/run_app.js:900-903, 906, 1194 | `appInputModeFor`'s sale branch, `appQuestionLine`, the guided keypad title | deleted with the glue | 3 | R5 (dead code) |
| poc/run_app.js:1142 | 'the dev page starts in steps…' | `form`, and the dev page loads `app_forms.js` after `app_ui.js` (B17) | 3 | R6, 7.7 |
| poc/run_app.js:1262 (setup), 1266 | '…opens the guided sale again…' | `sendItemCard`; the `openform` request | 3 | R1 |
| poc/run_sync.js:1558, 1600, 1609, 1667, 1671 and one new setup line before 1560 | R5a, R5c, R5e taps | review-card taps; assertions unchanged | 1 | R5 |
| poc/run_sync.js:1693, 1734, 1753, 1764 | R5f, R5h 'steps…' | `form` + the review card | 1 | R6 |
| poc/run_gas.js:1495, 1540 | 'Settings: sale_flow = steps…', 'Settings got sale_flow = steps…' | `form` | 1 | R6 seed |
| poc/check_simulator.js:120-124, 140, 160, 193, 217, 223 | the ids, the boot value, KINDS, the sell tour, the S\| predicate | 10.6 | 4 | R8 |
| poc/sim_ui.js:1330-1338, 1340-1352, 1371, 1378, 1386, 1433-1438 | SIM.smoke | 8.5 | 4 | R5, R8 |
| poc/run_app.js:497 (revision 3) | 'the customer card carries 📏 = MS\|<customerId> as its last row' | `CH\|` in the app emits one `openscreen` buyer request, no message (13.15) | 3 (review r3, M-6: it needs step 3's `ui.openScreen`) | F5 |
| poc/run_app.js:1101, 1172, 1183, 1196 (revision 3) | the hot button's text, the stepper's text, the bar's button, the keypad title | compared with the plain texts (13.15) | 3 | F7 |
| poc/sim_ui.js:1421 (revision 3) | the smoke's back click | `{op: 'click', sel: '#back'}`, no `key` (review r3, m-4) | 4 | F6 |
| poc/check_simulator.js:141 (revision 3) | 'a tour on an enrolled phone away from its chat screen waits for the back button …' | the BOOT regex reads `/case 'screen': appNavReset\(\)/` (the frame's screen op, 13.4); the rest unchanged | 4 | F6 |

### 10.9 Why everything else stays green, and the expected counts

- The quick seed (poc/sim_seed.js:72): run_scenario, run_lists, run_round4 1-9l and 10, run_app 1-31, run_sync 0-M11
  and run_gas 1-17 never reach a round-6 path; `cardKeyboard`, `askQty`, `afterSaleKeyboard` and the chat new-piece
  chain under quick are today's byte for byte.
- The wrapper (B8) keeps run_wizard step 7, run_gas.js:1454 (`commitSaleGroup` direct) and every reader check
  (one-line groups). Reader branches are guarded by `basketGroup` (more than one live row, never an order id); no
  existing suite builds a multi-SALE group from tags (basket map 4), and the deliveries of run_scenario.js:1038-1069 keep
  today's replies because of the `isOrderId` half of the guard.
- Revision 2's other core changes touch no existing check: the `stock_negative` change (6.3) keeps run_sync S4
  (:233-252, a one-of-a-kind piece: `ping_stock_negative` and `V|`); the return guard (`creditOpenFor`) meets the one
  seller `T|` of today's suites (run_round4.js:216-217) on a piece whose last sale was paid; `newItemUndoInfo` meets no
  existing undo (no suite undoes a 'new item' group, and today's new-piece reply has no undo button); `sendItemCard`'s
  extra rows need `opts` or an owner with a basket, which no existing suite has; `saleResolveBuyer`'s `forceNew` is set
  by the app only.
- MSG only gains keys; the one changed text is compared through `MSG.` at run_gas.js:1495. `ITEM_ACTIONS` and
  `MUTATING_ACTIONS` only gain `NI` and `NC`; no check counts them. The overlay z-index, the new CSS classes and the new
  APP field are pinned nowhere. check_simulator.js:87 sees both lists gain `app_forms.js` in the same step.
- The server rename (6.2) keeps run_sync S8 (:307-333) green: the job there meets the placeholder name, the server and
  the phone agree, and :319 is checked before the job runs.
- **Expected after the round** (revision 2 adds W33, the W27(i)/(j), W28, W29 and W31 checks, R6f, run_gas 27's rewrite
  and the run_app checks of 10.3): run_scenario 327, run_lists 236, run_round4 345, run_wizard about 355 (rewritten),
  run_gas 295 + about 10, run_sync 333 + about 22, run_app 265 − 51 + about 115, check_simulator 68 + about 12. After
  step 1 alone: run_app 220, every other suite at today's count except run_wizard. Every builder reports the real counts.

---

## 11. Build steps and file ownership

Nobody edits a file outside their step's list, and inside a shared suite only the regions named in section 10; a needed
change elsewhere goes into the report. Revision 3 adds files and regions to every step: 13.16 lists them (notably
`apps-script/core_orders.js` joins step 1, `gas_store.js` and `gas_pdf.js` join step 2, three new app files, `app/index.html`
and `app/vendor/tabler-icons-LICENSE.txt` join step 3). Each step's checker: the named suites end `0 failed`; `npx acorn@8 --ecma5
<file>` passes on every changed `core_*.js`, `app_*.js` and `sim_*.js`; every new global was grepped first; `node
tools/bundle_gas.js` and `node tools/build_app.js` run; and (revision 2, B8) in steps 1, 2 and 3 `node
poc/build_simulator.js` runs BEFORE check_simulator, because check_simulator.js:64 compares the embedded frame with
`buildSrcdoc()` of today's sources (its header, :4, says to build first) and these steps change frame sources.

1. **Core** (first, alone).
   - Files: `apps-script/core_config.js`, `core_ledger.js`, `core_messages.js` (9.1, 9.2), `core_report.js`,
     `core_bot.js`; `apps-script/core_sync.js` (revision 2, M2: `syncFlagText`, `syncFlagPing` and the one `SYNC_MSG`
     key of 9.2 only); `apps-script/gas_setup.js` (:15, :74-93 only: the defaults, the `steps` rewrite and the note's
     Messages rewrite, 6.1); `poc/run_wizard.js` (rewritten, 10.1);
     `poc/run_round4.js` (10.2); `poc/run_app.js` (the step-1 edits of 10.3 only); `poc/run_sync.js` (the step-1 edits
     of 10.4 only); `poc/run_gas.js` (:1495, :1540 only); `poc/sim_seed.js` (the comment at :70-71 only: "the code's
     default is form"; the value stays quick).
   - Checker: run_wizard, run_scenario 327, run_lists 236, run_round4 345, run_gas 295, run_sync 333, check_simulator 68
     and run_app 220 all end `0 failed`.
2. **Glue and sync** (after 1; revision 3: before 3).
   - Files: `apps-script/gas_sync.js` (the photo branch of `gasSyncHooks().ai` only, 6.2); `poc/sim_sync.js` (`hooks.ai`
     only); `poc/sim_phone.js` (`appendLedger`'s receipt copy, `applyAiResults`' rename and its M1 hold);
     `poc/run_sync.js` (R6a-R6f appended after R5h, nothing else); `poc/run_gas.js` (26-28 appended before section 17;
     and, only if the glue needs a member the fake lacks, the member tables :198-229); `poc/fake_gas.js` and
     `poc/sim_ports.js` (only for such a member, named in the report; revision 2, B18). No `gas_store.js`,
     `gas_main.js` or `gas_telegram.js` change is expected; `core_sync.js` is step 1's.
   - Checker: run_sync and run_gas end `0 failed`; the step-1 suites stay green.
3. **App** (after 1 and, revision 3, after 2).
   - Files: `app/app_forms.js` (new), `app/app_ui.js`, `app/app_ports.js`, `app/app_sync.js`, `app/app_store.js`,
     `app/app_scan.js` (`holdMs` only, revision 2, U2), `app/app_i18n.js` (9.3), `app/app.css`, `app/dev/index.html`;
     `tools/build_app.js` (`APP_FIRST` only);
     `poc/build_simulator.js` (the `FRAME_FILES` line :28 only); `poc/run_app.js` (`FILES`, the step-3 edits of 10.3,
     `round6()` appended). Not `app/config.js`, not `app/index.html`, not `tools/publish*.js`.
   - Checker: run_app ends `0 failed`; build_app runs (its secrets scan passes); `node poc/build_simulator.js`, then
     check_simulator 68 stays green; the dev-page checks of 10.7; the real-phone checks of 10.7 are listed in the report
     for the orchestrator.
4. **Simulator** (after 2 and 3).
   - Files: `poc/build_simulator.js` (BOOT: `snap`, `cmd`, `hot`), `poc/sim_ui.js`, `poc/sim_tours.js`,
     `poc/simulator.template.html`, `poc/check_simulator.js`.
   - Checker: `node poc/build_simulator.js` runs; check_simulator ends `0 failed`; check_simulator_browser ends `0
     failed` or says skipped; the manual browser checks of 10.7.
5. **Docs** (last, alone).
   - Files: `apps-script/README.md` (:363 run_wizard's description; `sale_flow` form/quick; the basket rows; the receipt
     number; the counted new piece; the migration of 6.6), `app/README.md` (the forms, the job tiles, the photo at
     Save), `docs/USER-GUIDE.html` (selling on the app, the Telegram backup), `POS-PROJECT-PLAN.md` (the round-6
     appendix). Then a copy of the tree to `C:\Users\USER\Desktop\Noel-backup\r6-built`; nothing published.

Parallelism: 2 and 3 touch disjoint files; 4 needs the bundle of 3 and the phone of 2; 5 needs everything. Revision 3
(review r3, M-7): step 3 runs AFTER step 2, because run_app 69-71 sync against poc/sim_sync.js and poc/sim_ports.js
(run_app.js:21), whose sketch and pic branches and `setSetting` are step 2's. Files shared in sequence, always in disjoint regions: `poc/run_app.js` (1 then 3), `poc/run_sync.js` and
`poc/run_gas.js` (1 then 2), `poc/build_simulator.js` (3 then 4). Every report gives the suite counts and any file it
needed but did not own.

---

## 12. Deliberately not built this round

- **The R4 "could" jobs as forms**: receive a payment, take a deposit, a return. They stay the chat flows (☰ `M|pay`,
  `M|dep`, the card's `PY|`, `PL|`, `T|`), in the app too. `commitCustomerPayment` (map-core-commits 8.3) is not added:
  each would need a new money rule first (a spread over several credits, a required customer for a deposit,
  core_ledger.js:928-937; a capped refund, :866-879).
- **A return from a sale that still owes** (revision 2, M3): refused (`ret_credit_open`, 1.10), not booked. Booking it
  right needs a RETURN that carries the group's `refGroupId` and `customerId`, refunds cash only above what is still
  owed, and is counted by `saleGroupInfo`, `openCredits` and `customerSummaryMap`: new reader work for a later round. A
  SPOKEN return (`handleIntent`) keeps today's path, and so does the return of a piece from a custom order.
- **Review cards in Telegram for restock and expense**: `R|`, `RQ|`, `ES|`, `EC|`, `EA|`, `EM|`, `EN|` stay.
- **Custom orders**: unchanged (R4). (The measurement form changes in revision 3, 13.7; what revision 3 leaves out is in
  13.17.)
- **An AI name inside the app's open new-piece form** (0.3 rule 2): it needs the server to stop flagging a pre-filled
  entry, a core_sync.js change.
- **A freshness timer on the Telegram basket** and a tag joining it with no tap at all (0.3 rule 1: one tap, ➕ before
  the scan or `➕ စာရင်းထဲ ထည့်` after it); several tags typed at once.
- **Per-line undo or edit of a saved basket**: the undo is the whole basket within 30 minutes, and after that the
  owner's void from the receipt (0.3 rule 17), also the whole basket; corrective buttons on a basket (`rewriteCheck`
  answers `complex`).
- **A Telegram basket's over-stock line is not flagged** (it is written on the Sheet, not pushed by a phone): the
  channels differ as they did before the round; the app's form warns (`ui_stock_over`) and the Telegram card does not.
- **A counted new piece's count corrected after 30 minutes**, or once one of its pieces was sold: there is still no
  ADJUST writer (`CFG.TX.ADJUST`, core_config.js:27); within 30 minutes the undo returns the tag to blank (M5). The undo's
  item entry (the blank fields) can meet a server Rev already bumped by the photo job; when the phone has not pulled
  that Rev, the server flags a `sync_conflict` once (a rare false ping, accepted).
- **A seller's blank tag of the other shop under quick**: today's chat path still registers it (the RESTOCK is then
  quarantined `scope`, core_sync.js:361-370); form mode refuses it (m7). It predates the round.
- **A basket in quick mode or from voice** (a spoken sale keeps its corrective card, round 5 D7); a basket across shops;
  a basket-level discount; two accounts in one mixed payment; a DueDay on a PAYMENT.
- **Restocking a one-of-a-kind piece**, or changing a piece's type, name, category or count after Save (the Items tab and
  the card's buttons do that).
- **Entering a profit or a percentage to compute the price**; markup chips (+30 % / +50 %).
- **The photo defects that predate the round**: a phone's media id shown as text in Telegram, the per-phone media-id
  collision, a failed photo job never retried (app_store.js:653), and a job queued at photo time on the quick path
  reaching the server before its item entry exists (the M1 hold covers an entry waiting in the outbox, the form's case,
  not an entry not yet made).
- **`ping_basket_note`, `CFG.SOURCE.FORM`, a laptop Items tab, a new sync cap, a raised `app_min_version`**, deleting a
  round-5 MSG key, renaming a tour id.
- **Containing a form inside the dev page's 390 px frame.** (The Android back button IS built: revision 2 for forms,
  revision 3 for every screen, 13.4. The bottom bar's hard-coded labels ARE moved to `t()` in revision 3, 13.3.)
- **A per-phone quick switch in the app's Settings** (revision 2, m5): the pref `setting:sale_flow` stays a test hook.
- **Wiring `enrolledInApp` / `sendAppCard`** (core_bot.js:4470-4480): the Telegram backup must keep selling.
- **Owner approval of new buyers, and merging look-alike customers** (as round 5).

---

## 13. Revision 3: the owner's feedback (F1-F12, `FEEDBACK-1.md`, with the amendment F9b)

The owner tried the simulator and wrote twelve points; `FEEDBACK-1.md` turned them into binding decisions F1-F12, and the
owner's reply of the same day replaced F9 by F9b (one AI switch; the notebook stays in the app). This section is their
contract. Where an earlier section still says something else, this section wins; the earlier sections were edited where
they differ and say "revision 3". Every `file:line` is today's tree (rounds 4 and 5 built, round 6 not built). R1-R9 stand.

### 13.0 What changes, in one view

| Area | Before (the simulator the owner tried) | Revision 3 |
|---|---|---|
| Measurement form | two "မှတ်ချက်" boxes (the `note` field, core_config.js:92, and the form's own box, app_ui.js:1032-1035); no figure | one note box (13.7.1); the front-view figure to draw on (13.7.2) |
| မှတ်တမ်း | the bot chat's last 200 messages (app_ui.js:827-835) | this phone's own records as a table by day; a row opens its receipt or entry (13.8) |
| Text box | "✏️ ရိုက်ပါ" + "ပို့" under any card while a state waits (app_ui.js:797-801) | a labelled field with OK only for a question that waits; a search field only where searching happens (13.5) |
| Buyers | a chat card of six buyers, 🔍 and ✖️ (core_bot.js:1659-1664); a text card per buyer (:1681-1701) | an app page: list, search, +, new and edit form, detail as a clean list (13.6) |
| Back | "← နောက်သို့" on three screens only (app_ui.js:829, :840, :871) | ← icon at the top left of every screen but the home, forms included; Android back does the same (13.3, 13.4) |
| Look | emojis on every line and button | emojis only on the job buttons and the main menu; clean lists and tables (13.1, 13.9) |
| Words | Burmese for everything | OK, Settings, Menu, Scan, Photo, Save, Cancel in English (13.1); back, sync and settings icon-only (13.2, 13.3) |
| AI (📒 စာအုပ်, 🎤, the photo's name) | 📒 behind Settings notebook_import (core_bot.js:141), 🎤 behind app_voice (app_ui.js:381), the photo AI always on | one "AI" switch in the app's Settings, the owner's for every phone and the bot; on: 📒, 🎤 and the photo name in the app; off: none of them and no AI call anywhere (13.11, F9b) |
| Shops | Settings keys typed by hand (core_config.js:189-192, core_orders.js:41-44) | the owner's Shops screen in the app and a marked Shops block in the Sheet (13.12) |
| Receipt | a 🧾 text card with 📤 and 📄 PDF (core_bot.js:2080-2084, app_ui.js:710) | a receipt screen with "ဘောက်ချာ Share မယ်" and "PDF / Print" (13.10) |
| Restock | home tile (revision 2) and the item card | also in the app's ☰ menu (13.11) |

Three new app files: `app/app_icons.js` (13.2), `app/app_sketch.js` (13.7.2), `app/app_screens.js` (13.4-13.12).
`app/index.html` changes (13.3). No new apps-script file and no new tab. New: one Settings key `ai` (13.11), one
Measurements column `Sketch` (13.7.2), one push entry kind `setting` (13.12), and two job kinds that are not AI, `sketch`
(13.7.2) and `pic` (13.11, review r3 M-1).

**One predicate for the app's own pages.** `screensInApp(ports)` (core_bot.js, NEW, beside `formsInApp`) =
`!!(ports.ui && ports.ui.openScreen)`. It is true on every app phone in BOTH sale modes (`form` and `quick`): the
buyers page, the receipt screen and the history do not depend on `sale_flow`. Telegram and the reference phone
(poc/sim_phone.js) have no `ports.ui`, so every Telegram text stays as it is. `ports.ui.openScreen(name, req)` (NEW,
app/app_ports.js:181-183 beside `measureForm`) emits `'openscreen'` `{name, req}`; the core sends nothing when it calls
it (the `measureForm` precedent, core_bot.js:4199).

### 13.1 The visual language (F7) and the word table (F8)

**Rules.**

1. **Emojis only on main menu buttons**: the four job buttons of the home (`appJobRow`, both the 2 × 2 grid and the
   compact row: `ui_home_sell`, `ui_home_new`, `btn_restock`, `btn_expense`) and the buttons of the core's main menu
   card (the card `appIsMenuMessage` recognises, app_ui.js:95, drawn as the grid, :695). Nothing else in the app shows
   an emoji (review r3 made it true: rule 2 now removes every emoji and rule 3 names every path around `APP.tt`; the
   simulator's preset pictures, which stand for photos, keep theirs).
2. **`appPlain(text)`** (app/app_icons.js, pure, NEW) removes every emoji from every line of a text (review r3, UX-M6:
   revision 3's first draft removed only the leading cluster and left 39 texts with an emoji, among them `pay_ask_amount`,
   `receipt_thanks` and the later lines of `cust_card`). First the leading run of clusters (`APP_EMOJI_HEAD`), then any
   cluster left anywhere in the line (`APP_EMOJI_ANY`, global). A line that lost an emoji inside is tidied (doubled
   spaces, a space inside parentheses, trailing spaces and a trailing ' ·'); a line that lost its head also loses a
   leading space, '·' or '/'. A line without an emoji comes back unchanged, spaces and all, so fragments such as
   `sample_mark` ' (နမူနာ)' keep their leading space. Arrows and geometric shapes used as text stay unless U+FE0F follows
   them (`→` in 'PDF → Telegram' and `ui_tap_ms`, `□↑` in `ui_install_ios_steps` stay; `↩️` goes). ES5, no `u` flag:
   ```
   var APP_EMOJI_HEAD = /^(?:(?:[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2900-\u297F\u2B00-\u2BFF\u3030\u303D\u3297\u3299]|[\uD83C-\uD83E][\uDC00-\uDFFF])[\uFE0E\uFE0F\u20E3]?(?:\u200D(?:[\u2190-\u27BF\u2B00-\u2BFF]|[\uD83C-\uD83E][\uDC00-\uDFFF])\uFE0F?)*\+?)+\s*/;
   var APP_EMOJI_ANY = /(?:[0-9#*]\uFE0F?\u20E3|[\u2190-\u21FF\u25A0-\u25FF]\uFE0F|[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2300-\u23FF\u2460-\u24FF\u2600-\u27BF\u2900-\u297F\u2B00-\u2BFF\u3030\u303D\u3297\u3299]|[\uD83C-\uD83E][\uDC00-\uDFFF])[\uFE0E\uFE0F\u20E3]?(?:\u200D(?:[\u2600-\u27BF\u2B00-\u2BFF]|[\uD83C-\uD83E][\uDC00-\uDFFF])\uFE0F?)*\+?/g;
   function appPlainLine(l) {
     var head = l.replace(APP_EMOJI_HEAD, ''), s = head.replace(APP_EMOJI_ANY, '');
     if (s === l) return l;
     if (s !== head) s = s.replace(/ {2,}/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ +$/, '').replace(/ ·$/, '');
     if (head !== l) s = s.replace(/^[ \/·]+/, '');
     return s;
   }
   function appPlain(text) {
     return String(text === null || text === undefined ? '' : text).split('\n').map(appPlainLine).join('\n');
   }
   ```
   (`APP_EMOJI_HEAD` is revision 3's first pattern written with `\u` escapes; both were run in Node against the literal
   form on every MSG and APP_MSG value on 2026-11-13 with the same result.) So '💵+🏦 ခွဲပေး' reads 'ခွဲပေး', '✓ ပို့ပြီး'
   'ပို့ပြီး', '⌃ မှတ်တမ်း' 'မှတ်တမ်း', '💰 👤 {customer} · ကျန် {owed} ကျပ် · …' '{customer} · ကျန် {owed} ကျပ် · …',
   'ကျေးဇူးတင်ပါသည် 🙏' 'ကျေးဇူးတင်ပါသည်', '🎤/📸 စစ်ရန် ကျန် {n} ခု' 'စစ်ရန် ကျန် {n} ခု', ' (⏰ {n} ရက် လွန်)' ' ({n} ရက်
   လွန်)', and '1. S1-0002 × ၂' and 'PDF → Telegram' are unchanged. After it no MSG or APP_MSG value holds an emoji. One
   text reads poorly without its emoji: `acct_none` '… ➕ နဲ့ ထည့်ပါ။' (the ➕ named a button); it is listed for the native
   speaker, who may reword the MSG text Telegram shows too. MSG and APP_MSG keep their texts (Telegram and the Messages
   tab are untouched); the app shows them plain.
3. **Where it is applied** (app_ui.js): `APP.tt` (:294) becomes `function (key, vars) { return appPlain(t(ports, key,
   vars)); }`, so every app label, title, toast (`appToast`, :1239-1247) and form label is plain; NEW `APP.ttRaw` = today's
   `t`, used ONLY by `appJobRow`. `appRenderMsg` (:663-714) passes the card text (:688) and every keyboard button text
   (:701) through `appPlain`, except the buttons of a menu card (`grid`, :695). A keypad title (`spec.title`, :946, and
   `appFirstLine`, :803) is plain.
   **Text that bypasses `APP.tt`** (review r3, UX-M7, m-14; each changes in step 3):
   - app_sync.js keeps its own raw `tt` (:84; run_app.js:596, :651 and :830 compare `pendingLines` with raw `t`), so the
     app passes `chipState().text` and every `pendingLines()` text through `appPlain` where it draws them: the chip's
     `aria-label` and `title`, the sync screen (:842, :852), the red banner (:407);
   - the recent tiles (`appTiles`, :584) show the id alone, without `categoryEmoji`, and their status (:581-582) uses
     `APP.tt`; the find heading (:593) uses `APP.tt('btn_find')`; the find button (:606, '🔍') is the `search` icon with
     `aria-label` `ui_aria_search`;
   - the photo placeholder (`appPhotoNode`, :626, the category emoji or 🧵) is the `camera` icon (the simulator's preset
     pictures keep their `visual.emoji` on a coloured ground, :625: they stand for a photo, not for a label);
   - the report card's '📄' (:679) is the `file-text` icon; the voice bubble's '🎤' (:670) the `microphone` icon;
   - the copy fallback of `appShareText` (:773, the receipt's Share where the phone has no share sheet) toasts
     `ui_copied` 'ကူးပြီးပါပြီ' (NEW) instead of '📋';
   - the tag keypad's '✅' key (:923-926) reads 'OK' (`ui_w_ok`), and the '⌫' of both keypads (:923, :949) is the
     `backspace` icon with `aria-label` `ui_aria_backspace` 'ဖျက်' (NEW); the scanner's '✖️' (:520) is the `x` icon;
   - the stepper's sell label at a count of 1 (`info.sellText`, :728, the raw button text) goes through `appPlain`.
4. **Icons**: Tabler-style outline glyphs (13.2) for the icon-only controls and as the leading glyph of the few text
   buttons the word table names. No other decoration.
5. **Data as clean lists**: one label and one value per row (`.kv` / `.kvr`: the label left in `--muted`, the value right,
   numbers in `--mono`), with headings (`.kvh`); histories as tables (`.tbl`: time | what | amount); a tappable row
   (`.lrow`) ends with a chevron icon. No "·"-joined value strings, no emoji lines. A description cell (the "what" of a
   history row) shows the item or the buyer on its first line and the row's type as a muted tag under it, never 'type ·
   item'; a figure that belongs to a row (paid, the method) is a small label/value pair, never 'ပေး 500,000 · ငွေသား'
   (review r3, UX-M8: the buyer's and the phone's history, the sale form's bar, the `group` view, the sold view's mixed
   method, the item view's basket row, the Settings and sync screens, the AI parts and the shop rows follow it).
6. **Telegram**: every message keeps its text (the owner's channel). The review card (2.1) already reads one fact per
   line; its buttons keep their emojis, the only icon Telegram has ("where it fits", F7). New Telegram text of this
   revision: `ms_sketch_line` (13.7.2) and `ai_off` (13.11) only.

**The word table** (every control of the app's chrome and pages; "plain" = the key's text through `appPlain`).

| Control | Shows | Key (file:line or NEW) |
|---|---|---|
| back, every screen but the home and the enrol screen, every form | icon `arrow-left` only; `aria-label` 'နောက်သို့' | `ui_aria_back` (NEW) |
| sync status (header) | icon by state only (13.3), a count badge while waiting; `aria-label` and `title` = the state's text, plain | `ui_sync_synced`, `ui_sync_waiting`, `ui_sync_stale_hours`, `ui_sync_stale_days`, `ui_sync_sending`, `ui_sync_offline`, `ui_sync_never` (app_i18n.js:15-21) |
| settings (header) | icon `settings` only; `aria-label` 'Settings' | `ui_w_settings` 'Settings' (NEW) |
| Settings screen title | 'Settings' | `ui_w_settings` (replaces `ui_settings_title`, app_i18n.js:124) |
| Settings: the AI switch | 'AI' and an on/off toggle; under it the parts that are on | `ui_ai_title` 'AI' (NEW), `ui_on` / `ui_off` (:128-129) |
| bottom bar, scan | icon `scan` + 'Scan' | `ui_w_scan` 'Scan' (NEW; replaces the hard-coded '📷 ဖတ်', app/index.html:31) |
| bottom bar, menu | icon `menu-2` + 'Menu' | `ui_w_menu` 'Menu' (NEW; replaces '☰ မီနူး', :33) |
| bottom bar, voice (AI on and Settings app_voice) | icon `microphone` + 'ပြော' | `ui_btn_voice` plain (app_i18n.js:63) |
| scanner start button | icon `scan` + 'Scan' (its states keep their texts, plain: 'ကင်မရာ ဖွင့်နေသည်…', the camera errors) | `ui_w_scan`; `ui_scan_starting`, `ui_camera_denied`, `ui_camera_none`, `ui_camera_error` (:26-29) |
| scanner torch / stop | icon `bulb` / icon `x`; `aria-label` 'မီး' / 'ပိတ်' | `ui_torch`, `ui_btn_close` plain (:30, :37) |
| type a tag number | icon `keyboard` + 'နံပါတ် ရိုက်မယ်' | `ui_btn_keypad` plain (:31) |
| keypad and date sheet OK; the tag keypad's ✅ key | 'OK' | `ui_w_ok` 'OK' (NEW; replaces `ui_btn_ok`, :36, at app_ui.js:960 and :979, and the '✅' key at :923-926) |
| the keypads' delete key | icon `backspace`; `aria-label` 'ဖျက်' | `ui_aria_backspace` (NEW; replaces '⌫', app_ui.js:923, :949) |
| keypad and date sheet close | 'Cancel' | `ui_w_cancel` 'Cancel' (NEW; replaces `ui_btn_close` at :933, :959, :978) |
| Save of every form (sale, new piece, restock, expense, buyer, shop, measurement) | 'Save' | `ui_w_save` 'Save' (NEW; replaces `btn_save` in the app forms and `ui_meas_save`, app_i18n.js:147, at app_ui.js:1040) |
| a core card's ✖️ မလုပ်တော့ (any button whose text is `btn_cancel`'s, core_messages.js:32: callback `Z` or `SS\|…\|z`; review r3, UX-m1) | 'Cancel' | `ui_w_cancel` (the rule lives in `appRenderMsg`) |
| photo button (the new-piece form; the card state's handle, app_ui.js:503, is deleted, 1.1) | icon `camera` + 'Photo' | `ui_w_photo` 'Photo' (NEW; replaces `ui_btn_photo`, app_i18n.js:65) |
| retake a photo | icon `camera` + 'Photo ပြန်ရိုက်' | `ui_photo_retake` (revision 2's NEW key; its draft becomes 'Photo ပြန်ရိုက်') |
| text field answer (13.5) | 'OK' | `ui_w_ok` (replaces `ui_btn_send` 'ပို့', :52, and the placeholder `ui_text_placeholder`, :51) |
| search fields (items: home, sale and restock forms; buyers) | an `<input type=search>` with the placeholder and a search icon button; `aria-label` 'ရှာ' | `ui_find_placeholder` plain (:42), `cust_find` plain (core_messages.js:150), `ui_aria_search` 'ရှာ' (NEW) |
| history handle (home) | icon `history` + 'မှတ်တမ်း' | `ui_history` plain (:48) |
| receipt: share | icon `share` + 'ဘောက်ချာ Share မယ်' | `ui_receipt_share` (NEW) |
| receipt: print | icon `printer` + 'PDF / Print' | `ui_receipt_print` (NEW) |
| report document: to Telegram / share | 'PDF → Telegram' / icon `share` + 'Share' | `ui_btn_pdf_telegram` plain (:71); `ui_w_share` 'Share' (NEW; replaces `ui_btn_share` '📤 ပို့မယ်', :72) |
| buyers: new | icon `plus` only; `aria-label` 'ဝယ်သူအသစ်' | `ui_aria_new_buyer` (NEW) |
| buyer: edit | icon `pencil` + 'ပြင်မယ်' | `ui_btn_edit` (NEW) |
| undo on a screen | icon `arrow-back-up` + 'မှားသွားတယ်' | `btn_undo` plain (core_messages.js:27) |
| figure tools (13.7.2, review r3 UX-M5) | outside draw mode: icon `pencil` + 'ဆွဲ' (enters draw mode); in draw mode a `.seg` icon `pencil` + 'ဆွဲ' / icon `eraser` + 'ဖျက်', icon `arrow-back-up` + 'မျဉ်း ပြန်ဖျက်', and 'OK' (leaves draw mode); apart, icon `trash` + 'ရှင်း' | `ui_sketch_pen`, `ui_sketch_eraser`, `ui_sketch_undo` (NEW), `ui_w_ok`, `ui_btn_clear` (app_i18n.js:39) |
| a form line's remove / add an account or category / pick a date | icon `trash` (`aria-label` 'ဖယ်') / icon `plus` + 'ဘဏ်အသစ်', 'အမျိုးအစားအသစ်' / icon `calendar` + 'ရက်စွဲ ရွေးပါ' | `btn_remove_line`, `btn_add_bank`, `btn_add_cat`, `ui_btn_pick_date` plain |

**English words, the complete list**: OK, Settings, Menu, Scan, Photo, Save, Cancel (F8's seven); Share, PDF, Print (the
words F11 itself uses for the receipt; "Share" is also what every Android share sheet shows); AI (the switch F9b names).
"Tag" and "PDF" already appear in MSG texts and stay. **Burmese is kept for everything else**: the job buttons and the
menu (with their emojis), every screen title other than Settings (ဝယ်သူများ, ဝယ်သူ, ဝယ်သူအသစ်, ဘောက်ချာ, မှတ်တမ်း,
ဆိုင်များ, ပို့ခြင်း), every form label and choice (ဝယ်သူ, ဘယ်လိုပေးလဲ?, ငွေသား, မကျေသေး, ရောင်းစျေး, အရင်း, …),
every list label (13.9), every prompt and refusal. Back and the sync status have no word at all.

### 13.2 The icon set

- **Where**: `app/app_icons.js` (NEW, ES5): `APP_ICONS` = `{name: [path data, …]}`; `appIconSvg(name)` returns
  `'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'` + one `<path d=…/>` per entry +
  `'</svg>'`; `appIcon(name)` returns `appH('span', {class: 'ic', html: appIconSvg(name)})`. An unknown name gives an
  empty span. The markup is built from the table only (no user text), so `innerHTML` is safe, and the run_app fake
  document (run_app.js:850-888, no `createElementNS`) renders it.
- **Offline, and how it ships**: inline SVG inside the JavaScript bundle. `tools/build_app.js` concatenates `app_icons.js`
  into `app/dist/app.<hash>.js` (APP_FIRST, :30; 13.13), and that bundle is already in the service worker's precache list
  (`bundleName`, build_app.js:91, stamped into sw.js:13), so the icons are on the phone after the first load and nothing is
  fetched at run time: no CDN, no font file, no image request. The simulator's frame inlines the same file
  (`FRAME_FILES`, poc/build_simulator.js:28).
- **Licence**: the glyphs follow Tabler Icons (MIT). `app/vendor/tabler-icons-LICENSE.txt` (NEW, the MIT notice) is copied
  into `app/dist/vendor/` by build_app.js:88-90 and kept out of the precache by its `/LICENSE/i` filter (:91).
- **The glyphs** (24 × 24 grid, stroke 2, round caps and joins; the path data below is the contract):

| Name | Used for | Paths |
|---|---|---|
| `arrow-left` | back | `M5 12l14 0` · `M5 12l6 6` · `M5 12l6 -6` |
| `settings` | header gear | `M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z` · `M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0` |
| `cloud-check` | synced | `M11 18.004h-4.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.388 0 2.585 .82 3.138 2.007` · `M15 19l2 2l4 -4` |
| `cloud-upload` | waiting, sending | `M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1` · `M9 15l3 -3l3 3` · `M12 12l0 9` |
| `cloud-off` | offline, not enrolled | `M9.58 5.548c.24 -.11 .492 -.207 .752 -.286c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 .957 -.383 1.824 -1.003 2.454m-2.997 1.033h-11.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.13 -.582 .37 -1.128 .7 -1.62` · `M3 3l18 18` |
| `alert-triangle` | sync problem | `M12 9v4` · `M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z` · `M12 16h.01` |
| `scan` | Scan | `M4 7v-1a2 2 0 0 1 2 -2h2` · `M4 17v1a2 2 0 0 0 2 2h2` · `M16 4h2a2 2 0 0 1 2 2v1` · `M16 20h2a2 2 0 0 0 2 -2v-1` · `M5 12l14 0` |
| `menu-2` | Menu | `M4 6l16 0` · `M4 12l16 0` · `M4 18l16 0` |
| `microphone` | voice | `M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1 -6 0z` · `M5 10a7 7 0 0 0 14 0` · `M8 21l8 0` · `M12 17l0 4` |
| `search` | search | `M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0` · `M21 21l-6 -6` |
| `plus` | new buyer, add an account or category | `M12 5l0 14` · `M5 12l14 0` |
| `pencil` | edit, figure pen | `M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4` · `M13.5 6.5l4 4` |
| `eraser` | figure eraser | `M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3` · `M18 13.3l-6.3 -6.3` |
| `trash` | remove a line, clear the figure | `M4 7l16 0` · `M10 11l0 6` · `M14 11l0 6` · `M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12` · `M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3` |
| `x` | scanner stop | `M18 6l-12 12` · `M6 6l12 12` |
| `camera` | Photo | `M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2` · `M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0` |
| `share` | Share | `M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0` · `M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0` · `M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0` · `M8.7 10.7l6.6 -3.4` · `M8.7 13.3l6.6 3.4` |
| `printer` | PDF / Print | `M17 17h2a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2h-14a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h2` · `M17 9v-4a2 2 0 0 0 -2 -2h-6a2 2 0 0 0 -2 2v4` · `M7 15a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2z` |
| `arrow-back-up` | undo | `M9 14l-4 -4l4 -4` · `M5 10h11a4 4 0 1 1 0 8h-1` |
| `history` | history handle | `M12 8l0 4l2 2` · `M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5` |
| `keyboard` | type a tag number, the number bar | `M2 8a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z` · `M6 10l0 .01` · `M10 10l0 .01` · `M14 10l0 .01` · `M18 10l0 .01` · `M6 14l0 .01` · `M18 14l0 .01` · `M10 14l4 .01` |
| `bulb` | torch | `M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7` · `M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3` · `M9.7 17l4.6 0` |
| `calendar` | pick a date | `M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z` · `M16 3v4` · `M8 3v4` · `M4 11h16` |
| `chevron-right` | a tappable row | `M9 6l6 6l-6 6` |
| `file-text` | a report document on a card (review r3, UX-M7) | `M14 3v4a1 1 0 0 0 1 1h4` · `M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z` · `M9 9l1 0` · `M9 13l6 0` · `M9 17l6 0` |
| `backspace` | the keypads' delete key (review r3, UX-M7) | `M20 6a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-11l-5 -5a1.5 1.5 0 0 1 0 -2l5 -5z` · `M12 10l4 4m0 -4l-4 4` |

### 13.3 The header, the bottom bar and the shell (F6, F8)

**app/index.html** (it changes; :23-27 and :30-34):
```
<header class="top">
  <button id="back" class="iconbtn" type="button" aria-label="back" hidden></button>
  <div class="shop" id="shopName">SalesTag</div>
  <button class="chip iconbtn never" id="chip" type="button" aria-label="sync">…</button>
  <button id="gear" class="iconbtn" type="button" aria-label="settings">⚙</button>
</header>
…
<nav class="bottom" id="bottom" hidden>
  <button class="primary" id="btnScan" type="button">Scan</button>
  <button id="btnVoice" type="button" hidden>ပြော</button>
  <button id="btnMenu" type="button">Menu</button>
</nav>
```
The static texts are what a phone shows only if the bundle fails to boot. Every id that appWireEvents binds stays
(check_simulator.js:92-93 keeps holding; `back` is new). No HTML comment is added inside the frame shell (the simulator
copies `<div id="app">` … `#photoInput`, poc/build_simulator.js:213-221, and refuses a comment, :219).

**At boot** (`bootApp`, app_ui.js:300-325) NEW `appPaintChrome()` puts the icons and words in: `#back` = icon
`arrow-left` with `aria-label` `ui_aria_back`; `#gear` = icon `settings`, `aria-label` and `title` `ui_w_settings`;
`#btnScan` = icon `scan` + `ui_w_scan`; `#btnMenu` = icon `menu-2` + `ui_w_menu`; `#btnVoice` = icon `microphone` +
`ui_btn_voice`.

**`appRenderHeader()`** (app_ui.js:391-399):
- `#back.hidden = !appNavCanBack()` (13.4): hidden on the home's scanner state and on the enrol screen
  (`appNavCanBack` is false on the enrol screen whatever the stack holds; review r3, UX-M3), shown everywhere else.
- `#shopName`: on the home and the enrol screen the shop's name (as today, :394); on every other screen the screen's
  title (`appScreenTitle(APP.screen)`: history `ui_history_title`, sync `ui_sync_title`, settings `ui_w_settings`, buyers
  `ui_buyers_title`, buyer `ui_buyer_title`, receipt `ui_receipt_title`, entry `ui_entry_title`, all plain). The
  `.pagehead` rows of today's three screens (:829, :840, :871) are deleted: the header carries the back button and the
  title.
- `#chip` (icon only): `className = 'chip iconbtn ' + kind (+ ' offline')`, `innerHTML` = the state's icon (+ a badge),
  `aria-label` and `title` = the state's text, plain. From `sync.chipState()` (app_sync.js:479-494):

  | `chipState()` | Icon | Badge | Colour | Text (aria) |
  |---|---|---|---|---|
  | `synced` | `cloud-check` | — | `--good` | `ui_sync_synced` 'ပို့ပြီး' |
  | `sending` | `cloud-upload` (a CSS pulse) | — | `--accent` | `ui_sync_sending` |
  | `waiting` | `cloud-upload` | the count (`st.entries + st.aiQueued`, `myDigits`), at most '၉၉+' | `--warn` | `ui_sync_waiting` |
  | `stale` | `cloud-upload` | the count | `--warn` | `ui_sync_stale_hours` |
  | `red` (a problem: two days unsent, chipState :490) | `alert-triangle` | — | `--bad` | `ui_sync_stale_days` |
  | `offline: true` while enrolled (any kind but `red`) | `cloud-off` | the count when above 0 | `--muted` | `ui_sync_offline` |
  | `never` (not enrolled) | `cloud-off` | — | `--muted` | `ui_sync_never` |

  A tap opens the sync screen (`appOpenScreen('sync')`).
- `#gear`: a tap opens Settings (`appOpenScreen('settings')`); on the enrol screen it still opens Settings (today's
  behaviour, :336, :871), and ← there returns to the enrol screen, the bottom of the stack on a phone that is not
  enrolled (13.4).

**appWireEvents** (:333-350): `#back` → `appNavBack()`; `#chip` → `appOpenScreen('sync')` (replaces the toggle at :335);
`#gear` → `appOpenScreen('settings')` (replaces :336); `#btnScan` → `appNavReset()`, then today's scanner start (:337);
`#btnMenu` → `appOpenMenu()` (:338; the menu card pushes a `card` layer, 13.4); `win.addEventListener('popstate',
appOnPop)` (replaces revision 2's `appOnFormPop`, 7.4). Revision 3's review adds (UX-M3, UX-M4): the capture listeners
`doc.addEventListener('pointerdown', appNavGuard, true)` and the same for `keydown` (not with `noHistory`, 13.4); the
banner's ကြည့်မယ် (:408) → `appOpenScreen('sync')` (today `APP.screen = 'sync'`: no ← and no bottom bar, a dead end
exactly when sync is in trouble), and the banner's text (`st.text`, :407) drawn through `appPlain`; the re-enrol wipe
(:902), `phone.on('revoked')` (:307) and a finished enrolment call `appNavReset()` before they set the screen.

**The bottom bar** (:380): shown on the home only (today also on `history`, which is now a screen with a back button).

### 13.4 Navigation: back as history state (F6)

One stack decides the back button, the Android back gesture and the browser's back. It lives in app/app_screens.js (the
nav section) and replaces revision 2's form-only history (1.0's "Android back", 7.3's `appOnFormPop` and `F.hist`,
`APP.formPopIgnore`). Review r3 (UX-B1, UX-M1 to M4, M-10, M-11, UX-m2, m-7, m-9) replaced the first draft's counter of
popstate events (`navIgnore`): one `history.go(-n)` fires ONE popstate, so counting n left the next n−1 real backs
swallowed. Now every history entry carries its depth and the history is brought to the stack, never counted.

- **State** (`APP`, app_ui.js:284-290, NEW fields): `nav: []` (the layers above the home's scanner state, oldest first),
  `navDepth: 0` (the depth of the history entry the app is on), `navBusy: false` (a walk the app started is under way),
  `navHist: false` (true once `history.pushState` worked), `navGuard: false`, `screenArg: null`. Every nav function and
  the simulator's `snap` read `APP.nav || []`, `(APP.opts || {}).noHistory` and `APP.win && APP.win.history`, so the
  stub APPs of run_app.js:754-758 (step 29) and `withFakeApp` (:880-883, used by :1175-1196) and check_simulator.js:235
  run unchanged (M-11).
- **History entries** carry their depth: `{salestag: d}`, d = the number of layers the entry stands for. An entry without
  a numeric `salestag` (the page's own first entry) is depth 0, and so is the guard entry `{salestag: 0, guard: true}`.
- **Layer kinds**: `{kind: 'card'}` (the home shows a bot card instead of the scanner: a menu, a chat flow, an item card, a
  sold card, a `group` card), `{kind: 'screen', name, arg}` (history, entry, sync, settings, buyers, buyer, receipt),
  `{kind: 'form', form: <kind>}` (sale, newitem, restock, expense, buyer, shop), `{kind: 'meas'}` (`#measForm`),
  `{kind: 'sheet'}` (the number keypad, the tag keypad, the date sheet in `#overlay`).
- **Functions**:
  ```
  appNavTop()          the top layer, or null
  appNavPush(layer)    APP.nav.push(layer); appNavSync()
  appNavReplace(layer) the top layer replaced by this one: same depth, no history call. Used by a form's Save that shows
                       the reply card, the line-name card, a new buyer's page after the buyer form, the known-phone chip,
                       and appOpenScreen of the screen already on top
  appNavDrop(kind)     a close that did not come from back (a sheet's OK or Cancel, a mode close, a buyer edit's Save, the
                       measurement form's Save): removes the topmost layer of that kind, then appNavSync(); does NOTHING
                       when the stack holds no layer of that kind (appCloseOverlay runs on every form open, app_ui.js:1004)
  appNavReset()        Scan, revoke, an enrolment, the re-enrol wipe, the simulator's screen op: every layer closed without
                       asking (a form's draft kept, as revision 2's draft rule wants); APP.nav = []; appNavSync(); then the
                       scanner state, or the enrol screen on a phone without deviceId
  appNavSync()         brings the history to APP.nav.length (does nothing with noHistory or without win.history):
                         APP.navBusy               return: the walk's popstate calls it again
                         length > navDepth         pushState({salestag: d}, '') for d = navDepth+1 .. length (inside
                                                   try/catch: a failure sets navHist false), then navDepth = length
                         length < navDepth         navBusy = true; history.go(length - navDepth): ONE walk, ONE popstate
  appOnPop(e)          the popstate listener; H = e.state.salestag when it is a number, else 0:
                         APP.navBusy               the app's own walk: navBusy = false; navDepth = H; appNavSync() (a layer
                                                   pushed meanwhile, such as the form the tag keypad's 4th digit opens
                                                   right after the keypad closed, gets its entry now)
                         otherwise                 the user's back (one entry, or several when the browser skipped one) or
                                                   forward: navDepth = H; appNavPopTo(H); appNavSync() (a form that stayed
                                                   gets its entry back; a forward is walked back)
                       when nothing was open (the stack empty, the guard entry left): the toast ui_back_again, at most
                       once in 3 s; the next back leaves the app
  appNavPopTo(H)       while APP.nav.length > H: appNavPop(); it stops at the first layer that stays
  appNavCanBack()      APP.nav.length > 0 && APP.screen !== 'enroll'
  appNavBack()         the ← of the header and of every form: if (!appNavCanBack()) return;
                       APP.navHist ? APP.win.history.back() : appNavPopTo(APP.nav.length - 1)
  appNavPop()          closes the top layer; false when it stays:
                         sheet   appCloseOverlay({fromNav: true}); APP.nav.pop()
                         form    appCloseForm({ask: true, pop: true}); a dirty form whose user stays keeps its layer
                         meas    appCloseMeasForm({ask: true, pop: true}), the same rule
                         screen  APP.nav.pop(); APP.screen = the nearest 'screen' layer still below (its arg into
                                 APP.screenArg), else the bottom: 'home' on an enrolled phone (its card state when a 'card'
                                 layer is below, else the scanner state), 'enroll' on a phone without deviceId (today's
                                 rule, app_ui.js:871); appRender()
                         card    APP.nav.pop(); when the core waits for something (appState() not null): clearState(ports,
                                 uid), the same as the card's ✖️ (core_bot.js:582-585); then the layer below as for 'screen',
                                 else APP.showScanner = true, appRender(), and the camera restarts when the pref cameraOk is set
  appNavGuard()        the capture listener of pointerdown and keydown: when the stack is empty, navDepth is 0 and the
                       current entry has no numeric salestag (the page's first entry), pushState({salestag: 0, guard:
                       true}, '') with the tap's user activation; navDepth stays 0
  appOpenScreen(name, arg)  APP.screen = name; APP.screenArg = arg; a 'screen' layer pushed, or the top 'screen' layer
                       replaced when it has the same name (no duplicate); appRender()
  ```
- **Who pushes**: `appOpenScreen`; `appOpenForm` (7.3) and `appOpenMeasForm` (app_ui.js:1001) push `form` / `meas`;
  `appOpenNumberKeypad` (:940), `appOpenTagKeypad` (:910) and `appOpenDateSheet` (:972) push `sheet`, and
  `appCloseOverlay` (:909) drops it unless `fromNav`; `appCloseMeasForm({})` drops the `meas` layer on Save and on
  revoke (a measurement form opened from the buyer page returns to it; UX-m3).
- **`card` layers follow one rule** (UX-M1, m-7; `appNavCardSync`): whenever `appRender()` draws the home (`APP.screen === 'home'`, no
  form and no measurement form open), it keeps a `card` layer on top exactly while the home shows a card
  (`!APP.showScanner && appLatestBot()`): it pushes one when the top layer is neither `card` nor `sheet`, and drops a
  `card` layer left on top of the scanner state. So a scan, a tile or a find result that shows an item card
  (`appOpenTagId` sets `showScanner` false before the update, app_ui.js:563-567), the ☰ menu (`appOpenMenu`, :819-824), a
  screen action answered with a card (`appScreenAct`, 13.6), a form's Save and the line-name card all get their ← the
  same way, and no caller pushes a `card` itself. A form's Save replaces its `form` layer by the reply card's `card` layer
  (`appCloseForm({saved: true})` → `appNavReplace({kind: 'card'})`; `appFormLineCard` the same), or drops it when the
  layer below is already a `card` (one card layer for the home). A close without Save goes back to the layer below, the
  card state when it is a `card`. The receipt opened from a sold card (`RC|`) is a `screen` over that `card`, so back
  returns to the sold card with its undo and ငွေလက်ခံ.
- **Paths that used to set `APP.screen` directly** (UX-M3, m-7): the banner's ကြည့်မယ် (app_ui.js:408) calls
  `appOpenScreen('sync')`; the re-enrol wipe (:902), `phone.on('revoked')` (:307) and a finished enrolment call
  `appNavReset()` first; the dev page's `&screen=` (app/dev/index.html:183) calls `appOpenScreen`; the simulator's
  `screen` op (poc/build_simulator.js:156) calls `appNavReset()` and then, for any screen but 'home',
  `appOpenScreen(name)`. Outside boot (app_ui.js:314, :320) nothing else assigns `APP.screen` than appOpenScreen,
  appNavPop and appNavReset.
- **Which screens have back**: every screen, every form and every sheet, and the home in its card state; NOT the home in
  its scanner state and NOT the enrol screen. The bottom of the stack is the home on an enrolled phone and the enrol
  screen on a phone that is not (the gear there opens Settings; ← returns to the enrol screen).
- **The Android back gesture or button**: in the installed app (display standalone, app/manifest.webmanifest:9) the system
  back fires `popstate` while the app has pushed entries, and `appOnPop` closes every layer above the entry it landed on.
  Chrome on Android skips, on back, an entry from which another was pushed without a user tap (its history-manipulation
  intervention, UX-M4); a camera scan opens a form with no tap (the camera starts from the pref, app_ui.js:318; a decode
  opens the tag, :542, :563), and the re-push of a dirty form happens inside `popstate`. Two things keep that from closing
  the app with a layer open: the guard entry (`appNavGuard`), pushed with the seller's first tap, so a skip lands on the
  page's first entry (depth 0: every layer closed, the app stays); and the depth tags, so a back that skipped an entry
  closes the layers of both. A camera scan before any tap of a fresh start has no guard under it: there the first back
  may leave the app, and the form's draft brings the basket back at the next 🛒 or scan (13.17). The real-phone checks of
  10.7 measure it. With the guard, back on the home's scanner state shows `ui_back_again` once and the next back leaves
  the app (the usual Android "press back again" pattern). iPhones have no back gesture in a standalone app; the header ←
  is the way.
- **A reload** (UX-m2, m-9: the service worker's update, `reloadAfterForm`, app_ui.js:1170-1174) keeps the entries pushed
  before it while `APP.nav` starts empty: at boot, before the first render and unless `noHistory`, an entry whose
  `salestag` is above 0 sets `navDepth` to it, and `appNavSync()` walks back to depth 0 once.
- **Leaving a form with typed values asks once**: `appCloseForm({ask: true})` and `appCloseMeasForm({ask: true})` ask
  `ui_meas_close_ask` 'ရိုက်ထားတာတွေ မသိမ်းဘဲ ပိတ်မလား?' (app_i18n.js:149) through `APP.win.confirm` (as :1162 does
  today) when the form is dirty; an unchanged form closes without asking (a price check costs one tap, 1.0).
- **No history in a frame**: the simulator's frame and the dev page pass `noHistory: true` to `bootApp`
  (poc/build_simulator.js BOOT :196-197; app/dev/index.html:152), because a srcdoc frame shares the page's joint session
  history; with it no entry is pushed and no guard listener is added, and ← calls `appNavPopTo(APP.nav.length - 1)`
  directly. Node checks run without `win.history` and take the same path.

### 13.5 No chat box (F4)

`appInputBar` (app_ui.js:777-802) keeps its modes (`appInputModeFor`, :68-84, unchanged: run_app.js:163 pins 'text' for
`find`) and draws them differently:

| Waiting state | Bar |
|---|---|
| `await_number` (and the photo chain's number steps) | today's keypad bar: icon `keyboard` + `ui_type_number_bar` plain (:791-793); its keypad title plain |
| `new_item` step `photo` | icon `camera` + 'Photo' |
| `find` | a search field: `<input type=search>` with the placeholder `ui_find_placeholder` plain and a search icon button (`aria-label` `ui_aria_search`); Enter or the icon sends |
| `find_customer` | the same with `cust_find` plain (in the app it is reached only from an old message: 👤 opens the buyers page, 13.6) |
| every other text state (`await_text` names, notes, account names, the phone `tel`, `credit` / `dep` / `cu` names, `dep` notes, `meas_pick`) | a labelled field: `<label>` = the waiting question, i.e. the first line of the latest bot message, plain; the input (`inputmode=tel` for `tel`); the button 'OK' (`ui_w_ok`). No placeholder, no 'ပို့' |

- No bar at all when no state waits (today), and NEW: none when the latest bot message carries a `document` (a report) or
  a `view` (13.9). That is the owner's second screenshot: a text box under a report card.
- Typed text reaches the core only through these fields, so a seller never sends free text to the bot or its AI from the
  app. `ui_text_placeholder` and `ui_btn_send` stay in APP_MSG unused.

### 13.6 Buyers (F5)

**Core** (step 1):
- `showCustomers` (core_bot.js:1659-1664), first line: `if (screensInApp(ports)) { clearState(ports, uid); return
  ports.ui.openScreen('buyers', {chatId: chatId, uid: uid, staff: staff}); }`. Telegram keeps its card.
- `customerCard` (:1681-1701), first line: `if (screensInApp(ports)) return ports.ui.openScreen('buyer', {chatId: chatId,
  customerId: customerId, staff: staff});`. Every `CH|<id>` in the app opens the buyer page.
- NEW `customerRows(ports, customerId, n)` (core_bot.js, beside `customerLine` :1672) -> `[{groupId, day, type, desc, name, amount,
  cash, method, n}]` (`name`: the first live SALE row's item name, '' for a PAYMENT or DEPOSIT_APPLIED; review r3, UX-M8):
  the structured twin of revision 2's `customerLines` (4.4), with its collapse rule (a group with more
  than one live SALE row and not an order id is ONE entry, `n` = its lines, `amount` Σ, `cash` Σ; a PAYMENT or
  DEPOSIT_APPLIED keeps its own entry), newest first, the first `n`. `customerLines` becomes `customerRows(…)` mapped
  through `cust_line`, its text unchanged.
- NEW in core_ledger.js (store port only):
  ```
  customerCheck(ports, v, selfId) -> {ok, problems: [{code, field, key, vars, customerId?}]}
    // v = {name, phone, note, forceNew}; selfId = the edited customer's id ('' for a new buyer). Codes in order:
    //   name         the trimmed name is empty                                          ask_name (core_messages.js:80)
    //   phone        the phone has 1-6 digits (normPhone, core_ledger.js:1421-1426)    basket_bad_phone (revision 2 NEW)
    //   known_phone  another customer (id !== selfId) has the same normPhone             ui_buyer_known_phone {customer}, customerId
    //   same_name    new buyer, !forceNew, a customer with the same normName (:1415)     ui_buyer_same_name, customerId
  commitCustomer(ports, v, selfId) -> customer
    // name trimmed and cut to CFG.CUST_NAME_MAX 60, note cut to CFG.CUST_NOTE_MAX 100, phone stored as savePhone does
    // (core_bot.js:1651-1652: normPhone when isValidPhone, else the trimmed text, cut to 20). selfId: updateCustomer(selfId,
    // only the changed fields among name, phone, note); else addCustomer({name, phone, note}). Returns the stored record.
  ```
  `CFG.CUST_NAME_MAX: 60` and `CFG.CUST_NOTE_MAX: 100` are NEW beside `CUST_HISTORY_LINES` (core_config.js:129).
- **How a buyer syncs, and the Rev**: a new buyer is `addCustomer` (app/app_store.js:325-333: the local record and an
  outbox `customer` entry); an edit is `updateCustomer` (:334-340: the whole record in a `customer` entry). The server
  applies a known id by comparing name, phone and note, writes the changed fields with `rev = devices.nextRev()` and
  `updatedAt` (core_sync.js:693-708: the Rev bump on edit), and answers that `rev`, which the phone keeps
  (`setCustomerRev`, core_sync.js:1408, app_store.js:429). Every other phone pulls the changed customer by its Rev
  (`CUSTOMER_PULL_FIELDS`, core_sync.js:72). An edit in the Sheet or by the bot stamps a Rev too (`gasStampRev` in
  gas_store.js:466-475). No core_sync.js change for buyers. A customer has no base Rev, so two phones editing the same
  buyer offline keep the later push (13.17).

**The buyers page** (`APP.screen = 'buyers'`; header: ←, 'ဝယ်သူများ', sync, gear):
```
[ (search) နာမည် ဒါမှမဟုတ် ဖုန်းနံပါတ် ရိုက်ပါ          ] [ + ]
──────────────────────────────────────────────────────────
ဒေါ်မြင့်                                   ကျန် 500,000   >
+95 912 345 678
ဒေါ်စန်း                                                  >
+95 977 712 3456
ဦးသန့်                                                    >
… နောက်ထပ် ၁၂ ယောက် · ရှာပါ                (beyond 60 rows)
```
- Rows: NEW pure `appBuyersRows(phone, text)` -> `{rows: [{id, name, phone, owed}], more}`: text '' → the customers of
  `recentCustomers(ports, staff.role === 'owner' ? null : staff.shop, all)` (core_ledger.js:1398-1413) first, then every
  other customer by `normName`; text non-empty → `findCustomers(ports, text)` (:1446-1468: four digits or more search
  phones). `phone` = `fmtPhone` or ''; `owed` from `customerSummaryMap` (:1347-1367), shown only when above 0, in `--warn`,
  labelled `ui_lbl_owed` 'ကျန်'. At most `APP_BUYERS_MAX` 60 rows; `more` = how many more.
- The search input writes on `input` and redraws only the list region (revision 2's U5 rule). A row (`data-f="buyer:<id>"`)
  opens the buyer page; `+` (`data-f="buyer:new"`, icon only, `aria-label` `ui_aria_new_buyer`) opens the buyer form.
  Nothing found: `cust_none` plain.

**The buyer form** (`APP.form`, kind `buyer`, `div#buyerForm.formpage`; new or edit):
```
┌ .fhead: [←]  ဝယ်သူအသစ်                    (edit: ဝယ်သူ ပြင်ရန်)
နာမည်            [                              ]
ဖုန်း             [ 09                           ]   inputmode=tel
မှတ်ချက်          [                              ]   textarea, 100
  (known phone)   ဒီဖုန်းက ဒေါ်မြင့် ပါ  [ဒေါ်မြင့် · +95 912 345 678 >]
  (same name)     ဒီနာမည်နဲ့ ဝယ်သူ ရှိပြီးသားပါ · ဒီလူလား?  [ဒေါ်မြင့် >]  [ "ဒေါ်မြင့်" အသစ် ဖန်တီး ]
╞ .fbar  [.fmsg]  [ Save ]
```

| Field | `data-f` | Default | Label | Rule |
|---|---|---|---|---|
| name | `name` | '' (edit: the name) | `ui_lbl_name` 'နာမည်' | required; maxlength 60 |
| phone | `phone` | '' (edit: the phone) | `ui_lbl_phone` 'ဖုန်း' | `inputmode=tel`, maxlength 20; 1-6 digits refused |
| note | `note` | '' (edit: the note) | `ui_lbl_note` 'မှတ်ချက်' | textarea, maxlength 100 |
| known phone | `buyer:<id>` | — | `ui_buyer_known_phone` (revision 2 NEW) | shown after a Save refused `known_phone`; the chip closes the form and opens that buyer's page (the form's layer replaced by that page, `appNavReplace`, 13.4) |
| same name | `buyer:<id>`, `buyer:create` | — | `ui_buyer_same_name`; `btn_create_named` (core_messages.js:144) plain | new buyers only; `buyer:create` sets `forceNew` |
| Save | `save` | — | `ui_w_save` | `appBuyerSave` |

`appBuyerSave(phone, F)`: `busy` while saving; `customerCheck` → the first problem's text in `.fmsg`, `.fbad` on its field;
ok → `commitCustomer` → `appFormCommit(phone, sync, 'customer')` (7.2: `phone.commit`, then `scheduleSync`) → a new
buyer: the form's layer is replaced by the new buyer's page (`appNavReplace({kind: 'screen', name: 'buyer', arg: <new
id>})`, `APP.screen = 'buyer'`; no history call, review r3 UX-M2); an edit: the form's layer dropped
(`appNavDrop('form')`), back on that buyer's page, redrawn. No draft (three
short fields); a dirty form asks before it closes (13.4).

**The buyer page** (`APP.screen = 'buyer'`, `APP.screenArg` = the customer id; header: ←, 'ဝယ်သူ', sync, gear):
```
ဒေါ်မြင့်                                        [ (pencil) ပြင်မယ် ]
ဖုန်း                                   +95 912 345 678   (a tel: link)
မှတ်ချက်                                   ဘောက်ချာ ဖုန်းနဲ့ ပို့
── ငွေ ──────────────────────────────────────────────
ဝယ်ပြီး                                         1,000,000
ပေးပြီး                                           500,000
ကျန်                                              500,000   (--warn)
စရံ                                                     0   (only above 0)
နောက်ဆုံး ဝယ်ချိန်                              ၁၂ အောက်တိုဘာ
လာဝယ်သည့် အကြိမ်                                        ၁
[ ငွေလက်ခံ ]  [ စရံ ]
[ အတိုင်းအတာ ]  [ စာရင်း PDF ]
── ဝယ်ယူမှု မှတ်တမ်း ────────────────────────────────
ရက်စွဲ        အကြောင်း                                ငွေ
၁၂            မင်္ဂလာ ဝတ်စုံ ရွှေရောင်                 1,000,000   >
အောက်တိုဘာ    ရောင်း                                       (the type: a muted tag)
              ပေးပြီး 500,000   ပေးနည်း ငွေသား               (muted label/value pairs, only when the cash differs)
```
- Rows (`.kv`) from the customer record and `customerSummary` (core_ledger.js:1369-1371): `ui_lbl_phone`, `ui_lbl_note`
  (each only when set), heading `ui_lbl_money` 'ငွေ', `ui_lbl_bought` 'ဝယ်ပြီး', `ui_lbl_paid` 'ပေးပြီး', `ui_lbl_owed`
  'ကျန်' (`--warn` above 0), `ui_lbl_deposit` 'စရံ' (only above 0), `ui_lbl_last` 'နောက်ဆုံး ဝယ်ချိန်' (`fmtDayShortMy`),
  `ui_lbl_visits` 'လာဝယ်သည့် အကြိမ်' (`myDigits`). This is the owner's example card (`cust_card`, core_messages.js:152)
  laid out one fact per row.
- The history table (`.tbl`, heading `ui_buyer_history` 'ဝယ်ယူမှု မှတ်တမ်း', columns `ui_lbl_date` 'ရက်စွဲ', `ui_lbl_what`
  'အကြောင်း', `ui_lbl_amount` 'ငွေ'): `customerRows(ports, customerId, CFG.CUST_HISTORY_LINES)`, drawn by rule 5 of 13.1 (review r3, UX-M8: the first draft
  printed 'ရောင်း · …' over 'ပေး 500,000 · ငွေသား', the owner's own complaint line). The date cell is `fmtDayShortMy` and
  may wrap to two lines (day, month). The what cell's first line is the item `name` (a basket: the first item's name and
  ' +{n−1}', as 13.8), or, for a row without an item, the type word alone; its second line, muted, is the type tag
  `txLabel(type)` ('ရောင်း', 'ငွေလက်ခံ', …) when the first line is a name; when the cash differs from the amount, a third
  muted line holds two small label/value pairs (`.kvs`), `ui_lbl_paid` 'ပေးပြီး' {cash} and `ui_lbl_method` 'ပေးနည်း'
  {method}. `desc` and `cust_line_paid` stay for Telegram's `customerLines`. A SALE row opens the receipt page (13.10), another row the
  entry page (13.8).
- Actions (`data-f` = the callback): 'ငွေလက်ခံ' (`btn_pay` plain) while owed, `PY|<group>` when the buyer has one open
  credit else `PL|<customerId>` (customerCard's rule, :1692-1695); 'စရံ' (`btn_deposit` plain) `DC|<customerId>`;
  'အတိုင်းအတာ' (`btn_measure` plain) `MS|<customerId>` while `measureEnabled(ports)` (:1699); 'စာရင်း PDF'
  (`btn_statement` plain) `CS|<customerId>`; 'ပြင်မယ်' opens the buyer form in edit mode. The four core actions run through
  `appScreenAct(data)`.
- `appScreenAct(data)` (NEW, app_screens.js): `phone.sim.act(data)` (NEW, app_ports.js: pushes `{from: 'bot', text: '',
  keyboard: [], system: true, carrier: true}`, then `phone.sim.tap(thatId, data)`, :300-307); when it resolves and the core
  answered with a bot message (the carrier edited, or a newer bot message that is not an unanswered carrier) the app shows
  the home's card state (`APP.screen = 'home'`, `APP.showScanner = false`) and `appRender`'s card rule pushes the `card`
  layer (13.4); when the core opened a page instead (`MS|` opens the measurement form, a
  `meas` layer) nothing more. `phone.sim.lastBot()` (:309-313) skips an unanswered carrier (`m.carrier && !m.edited`), so
  `appLatestBot` never shows an empty card. Back from that card returns to the buyer page (13.4).
- Opened by: 👤 ဝယ်သူများ in the ☰ menu (`M|cust` → `showCustomers` → the buyers page), a buyers row, a `CH|` button
  anywhere, the buyer form's Save.

### 13.7 The measurement form

#### 13.7.1 One note (F1)

- **The one field** is the MeasureFields row with key `note` (core_config.js:92, label မှတ်ချက်, group `general`, the last
  field). `appMeasFieldNode` (app_ui.js:1064-1109) draws it as a 3-row `<textarea>` with maxlength `CFG.MEAS_NOTE_MAX` 300
  (NEW, core_config.js beside `MEAS_GROUPS` :54, with `CFG.MEAS_NOTE_KEY: 'note'`) instead of the one-line box
  (:1103-1107). If the family hides that row in MeasureFields, the form has no note.
- **The second box goes**: the form's own textarea (`F.notesEl`, app_ui.js:1032-1035, label `ui_meas_notes`) is deleted;
  `appMeasFormSave` (:1143-1151) passes `notes: ''` while the form has the note field (without it, a restored draft's
  notes; below). The session's Notes column stays the system's (Telegram's
  'fix of M-…', core_orders.js:592); nobody types into it any more.
- **Saved values are migrated without loss.** The app was never published, so no FORM session with a typed Notes exists in
  a live book; drafts and test books may hold one. NEW pure `appMeasNoteMerge(fields, values, notes)` (app_ui.js, beside
  `appMeasPrefill`): when `notes` (trimmed) is non-empty and an active field has the key `note`, it returns values whose
  `note` is `values.note + ' · ' + notes` (or `notes` alone), cut to 300; otherwise the values unchanged. `appOpenMeasForm`
  (:1001) calls it with `M.notes` (a restored draft's notes, :209, :233) only. Review r3, m-1: the first draft also merged
  `prev.notes` when the newest session's `source` was FORM, but no session on a phone has a `source` (the pull,
  core_sync.js:957-958, and the local record, app_store.js:484, :496, do not carry it); a saved session's Notes stay in
  its Sheet row and print on its PDF, so nothing is lost. When no active field has the key `note` (the family hid the
  row), the restored notes are kept as notes: `F.noteField` is false and `appMeasFormSave` passes `notes: M.notes`
  (review r3, UX-m3), so nothing typed is dropped. `appMeasModel`, `appMeasDraftRead` / `appMeasDraftWrite` and `appMeasSave` keep their `notes`
  field and behaviour (run_app.js:564-618, 734-760 and 821 pin them); only the page stops typing into it.
- **The server keeps 300 characters for that one key**: `syncMeasRecReason` (core_sync.js:503) reads
  `f[keys[i]].length > (keys[i] === CFG.MEAS_NOTE_KEY ? CFG.MEAS_NOTE_MAX : SYNC.MEAS_VALUE_MAX)`; every other key keeps 60
  (run_sync.js:1021's 'a value over 60' uses `neck` and stays). `appMeasCollect` (app_ui.js:184-199) cuts the note at 300
  and every other value at 60 (`APP_MEAS_VALUE_MAX`, :122).
- **Shown once**: the PDF (`measurementReport`, core_orders.js:602-627) prints the note as the `general` group's row
  'မှတ်ချက်' (:615-618, as today); the extra rows of `meas.notes` (:620) follow review r3's M-5: the notes are split at the 'fix of M-…' text that
  `saveMeasurement` appends (core_orders.js:592, ' · fix of ' or a leading 'fix of '); the rest keeps today's label
  'မှတ်ချက်' and is printed only when it is non-empty AND differs from `fields.note` (a PHOTO session's margin note, 'No
  Bra' in poc/sim_seed.js:27, so run_scenario.js:1166-1167 holds); the 'fix of M-00041' part is printed as its own row
  'ပြင်ဆင်ချက်' (a code constant like the other labels there). Telegram's flow is unchanged: the note is its last question (`askMeasQuestion`, core_bot.js:4247-4260)
  and `measurementSummaryLines` (core_orders.js:558-569) prints it once.
- **A save says so wherever the form was opened** (review r3, UX-m3): `appMeasFormSave` also toasts `meas_saved_form`
  plain (the line `appMeasSave` writes into the chat, app_ui.js:253, shows only on the home's card), and
  `appCloseMeasForm({})` drops the `meas` layer on Save and on revoke (13.4), so a form opened from the buyer page
  returns to that page.

#### 13.7.2 The figure to draw on (F2)

**What the tailor sees.** Between the last measurement group and the note, a section 'ကိုယ်ပုံ' (`ui_sketch_title`): the
front-view outline of a woman (the paper sheet's figure, docs/design-round-2/forms-extraction.md:5, :44) or of a man (the
fields have a trouser group, core_config.js:86-91); the tailor draws on it with a finger. Review r3 (UX-M5): the first
draft's pad took every touch (`touch-action: none`) in the middle of a long scrolling form, so a finger reaching the note
drew a stroke; the pad is now inert until the tailor asks to draw.
```
── ကိုယ်ပုံ ─────────────────────────────────────────────
[ အမျိုးသမီး | အမျိုးသား ]                       .seg, data-f fig:F / fig:M
outside draw mode:
[ (pencil) ဆွဲ ]                     [ (trash) ရှင်း ]   sk:draw; sk:clear apart (only with strokes)
in draw mode (the pad outlined in --accent):
[ (pencil) ဆွဲ | (eraser) ဖျက် ]  [ (arrow-back-up) မျဉ်း ပြန်ဖျက် ]  [ OK ]   .seg sk:pen / sk:eraser; sk:undo; sk:done
┌ .sketch (2:3, at most 300 px wide and calc(100vh - 240px) high) ┐
│        (the outline, --muted, 2 px)                              │   outside draw mode a finger scrolls the page
│          red strokes the tailor drew                             │   (touch-action: pan-y); in draw mode it draws
└──────────────────────────────────────────────────────────────────┘   (touch-action: none)
```
At 700 px and wider the form is two columns (`.fsplit`): the fields left, the figure right and sticky at the top.

- **Draw mode**: `ဆွဲ` (`sk:draw`) enters it: the pad gets `.drawing` (`touch-action: none`, an `--accent` outline),
  is scrolled into view with its tools (`scrollIntoView({block: 'start'})`; the tools sit ABOVE the pad, and the height
  cap keeps tools, pad and bar on one phone screen), and the tools turn into the draw-mode row. `OK` (`sk:done`,
  `ui_w_ok`) leaves it; so do Save, ←, 🔄 and closing the form. Outside draw mode nothing draws: the canvas has
  `touch-action: pan-y` and no pointer handler acts, so a finger swipe scrolls the form and leaves no mark.
- **Tools** (draw mode): `ဆွဲ` (pen, the default) draws a stroke per touch (pointer events `pointerdown` / `pointermove` /
  `pointerup` / `pointercancel`, with touch and mouse as the fallback, the `appWireVoice` pattern, app_ui.js:1201-1211);
  `ဖျက်` (eraser) removes the whole stroke the finger touches (within 10 grid units of any of its points); `မျဉ်း ပြန်ဖျက်`
  (`sk:undo`, `ui_sketch_undo`, icon `arrow-back-up`) removes the last stroke, disabled with none. `ရှင်း` (`sk:clear`,
  its own button, not a segment: it is an action, not a mode) asks `ui_sketch_clear_ask` 'ကိုယ်ပုံပေါ်က ရေးထားတာ အကုန်
  ဖျက်မလား?' and empties the drawing. The figure toggle changes only the outline. 🔄 အသစ် တိုင်း (`appMeasClear`,
  :1136-1141) empties the drawing too. A drawing counts as typed (dirty, 13.4).
- **Figures** (`APP_SKETCH_FIGURES`, app/app_sketch.js; viewBox `0 0 200 300`, no fill; ' · ' separates paths):
  ```
  F (woman, htamein to the ankles):
    M84 28a16 16 0 1 0 32 0a16 16 0 1 0 -32 0 · M93 44l0 8 · M107 44l0 8 ·
    M93 52L70 60C62 63 60 70 60 78L55 120L50 162L49 176L57 176L59 162L65 122L71 88C72 98 74 106 76 112C78 124 79 134 80 142
    C74 156 70 168 70 180L74 270L126 270L130 180C130 168 126 156 120 142C121 134 122 124 124 112C126 106 128 98 129 88L135 122
    L141 162L143 176L151 176L150 162L145 120L140 78C140 70 138 63 130 60L107 52Z ·
    M84 270L82 286L96 286L96 270 · M104 270L104 286L118 286L116 270
  M (man, trousers):
    M84 26a16 16 0 1 0 32 0a16 16 0 1 0 -32 0 · M92 42l0 8 · M108 42l0 8 ·
    M92 50L64 58C56 61 54 68 54 76L49 120L45 162L44 176L52 176L54 162L60 122L67 88C68 110 70 128 72 146L72 176L76 286L96 286
    L99 186L101 186L104 286L124 286L128 176L128 146C130 128 132 110 133 88L140 122L146 162L148 176L156 176L155 162L151 120
    L146 76C146 68 144 61 136 58L108 50Z
  ```
- **The data** (`sketch`, one text per session): `'1' + fig + ':' + strokes.join('.')`, `fig` 'F' or 'M'; each stroke is
  the base64url (`A-Z a-z 0-9 - _`, no padding) of its bytes `x0, y0, x1, y1, …`, each 0..255 on the figure's box
  (`x = b × 200 / 255`, `y = b × 300 / 255`). A point is kept when it is at least 2 grid units from the stroke's last kept
  point; a stroke has 2 to 400 points; at most `APP_SKETCH_STROKES` 60 strokes; the whole text at most
  `SYNC.MEAS_SKETCH_MAX` 4000 characters (a stroke that would pass it is dropped with the toast `ui_sketch_full`). The
  pattern is `SYNC.MEAS_SKETCH_RE = /^1[FM]:([A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*)?$/`. '' = no drawing; a figure with no
  stroke is ''.
- **Pure helpers** (app/app_sketch.js, Node-tested): `appSketchEncode(fig, strokes)` → text; `appSketchDecode(text)` →
  `{fig, strokes}` or `null` for anything that does not match; `appSketchAddPoint(stroke, x, y)` (the 2-unit rule);
  `appSketchErase(strokes, x, y)` → the strokes without the touched one; `appSketchUndo(strokes)` → the strokes without the
  last one (review r3, UX-M5); `appSketchFits(fig, strokes)` (the 4000 rule).
- **The DOM** (app/app_sketch.js): `appSketchPad(F)` builds the section once per form open (an inline `<svg>` outline from
  the figure paths and a `<canvas>` over it), redraws the strokes from `F.sketch` (`{fig, strokes}`) and calls
  `appMeasChanged(F)` after each stroke, erase, undo or clear. Each pointer event is mapped to the figure's box through the
  canvas's `getBoundingClientRect()` read AT THAT EVENT (never a size kept from the open), and `appSketchFit(F)` sizes the
  canvas to its box times `devicePixelRatio` and redraws the strokes on open, on the window's `resize` (a rotation, the
  700 px two-column switch) and after a font-size change (review r3, UX-M5). Nothing repaints the form while a
  finger is down.
- **Prefill and draft**: the drawing comes from a restored draft (the `measdraft` value gains `sketch`: `appMeasDraftWrite`
  writes it, `appMeasDraftRead` returns `sketch` '' when absent, app_ui.js:200-215), else the newest session's
  (`prev.sketch`), else an empty woman. So a session opened again shows its drawing, on any phone that pulled it, offline.
- **Save**: `appMeasSave(phone, req, input)` (:244-255) takes `input.sketch`; nothing filled is refused `empty` as
  today (`ui_meas_empty`), with or without a drawing. Review r3, B-1: the first draft let a drawing alone be saved, but an
  entry with no field is `malformed` on the server (core_sync.js:500-501) and its quarantine deletes the phone's copy
  (`measurementRejected`, app_store.js:520-527), so the drawing would be lost; the note counts as a value, so a tailor who
  only draws types one word in it. `store.local.saveMeasurementLocal` (app_store.js:492-501) stores
  `sketch` in the local record and puts it in the outbox `rec` only when non-empty (so run_app.js:592's exact `rec` holds),
  and its returned copy gains `entryId` (the outbox entry it pushed). Then, when a drawing exists and `input.makeCanvas` is given
  (review r3, m-11: the page passes `appSketchCanvas`, which returns `APP.doc.createElement('canvas')` with the asked
  width and height; Node passes none, and run_app 69 passes a stub), `appSketchPng(text, makeCanvas)` renders a 300 × 450
  PNG (white ground; the outline `#444` 2 px, drawn with one `new Path2D(d)` per figure path, and with `typeof Path2D ===
  'undefined'` no PNG; the strokes `#C62828` 3 px;
  a data URL longer than 80,000 characters is rendered again at 200 × 300) and ONE media record is added:
  `store.addMedia({kind: 'sketch', status: 'queued', jobId: 'j-' + …, data: <base64>, mime: 'image/png', entryId, customerId,
  queuedAt})` (app_store.js:629-637). Without a factory or `Path2D` none is added; the strokes are saved anyway.
- **The strokes sync with the session**: `syncMeasRecReason` (core_sync.js:494-510) accepts `rec.sketch` absent, '' or a
  string of at most 4000 characters matching the pattern, else `malformed`; `syncApplyMeasurementEntry` (:568-596) passes
  `sketch` to `addMeasurement` (:592-593); `gasStore.addMeasurement` (gas_store.js:594-633) writes a `Sketch` cell, the
  column appended when the tab lacks it ONLY for a session with a drawing (as `EntryID` only with an entry id, :605), so
  run_gas.js:1302 and :1306 hold; setupSheet adds it to the live book at the publish (`MEAS_FIXED_COLS` +
  `ensureColumns`, gas_setup.js:137-144; review r3, m-3); `gasMeasFromRow` (:215-228) reads it; `CFG.MEAS_FIXED_COLS`
  (core_config.js:164) gains `'Sketch'` at the end, so the column is never read as a field. The pull (`syncMeasPage`,
  core_sync.js:945-968) adds `sketch` to a session only when non-empty, so run_sync.js:1121's key list holds; the phones'
  `upsertMeasurement` (app_store.js:480-485, poc/sim_phone.js) keep it. The duplicate rule (`syncMeasSignature`, :535-539)
  is unchanged. poc/sim_ports.js and poc/fake_gas.js store `sketch` with the record.
- **The picture syncs like a photo** (the media path, F2): `jobPayload` (app/app_sync.js:372-380) also sends `entryId`;
  `flushAiJobs` (:405-426) skips a sketch job while `store.outbox` holds the `measurement` entry with that `entryId`
  (revision 2's M1 rule), so the session exists on the server first. A sketch job is not an AI job: it flushes whatever the
  AI switch says (13.11). The server's `ai` API (`syncHandle`, core_sync.js:1250-1272) adds `else if (job.kind ===
  'sketch') rec.photoUrl = result.photoUrl || '';` and never refuses it as `ai_off`. `gasSyncHooks().ai` (gas_sync.js:300-319)
  gains a `sketch` branch before the Gemini calls: NEW `gasStore.findMeasurementByEntry(entryId)`; none → `throw new
  Error('no_session')`; else save the PNG to the photo folder (`gasPhotoFolder()`, as :312) as `<MeasID>-figure.png` and NEW
  `gasStore.setMeasurementPhoto(measId, url)` writes that session's PhotoURL cell under the lock (the one cell a session
  gets after it was added, as an order's MeasID link is); return `{photoUrl: url}`. No AI call, no quota. poc/sim_sync.js
  `hooks.ai` (:174, beside its photo branch :183-187) does the same on the world (`photoUrl = 'sim://figure/' + measId`). On the phone a done job is
  `status: 'done'` with its data dropped and `replayJob` (:381-404) says nothing; a `failed` job whose error is
  `no_session` stays queued with `retryAfterUntil` now + 300 s; any other failure is `status: 'failed'` with `lastError` and
  NO `ai_down` line (:418 skips a sketch). Review r3, M-2: a `no_session` answer adds one to the job's `tries`, and the
  fifth makes it `failed` (`APP_SKETCH_TRIES` 5); the server writes no Errors row for a sketch's `no_session` (the catch
  of `syncHandle`, core_sync.js:1268, skips that one message); and when `measurementRejected` (app_store.js:520-527)
  deletes a customer's record it also marks that customer's queued sketch jobs whose `entryId` is no longer in the outbox
  `status: 'failed'`, `lastError: 'rejected'`. Review r3, m-5: `replayJob` returns before its last line (app_sync.js:403,
  which clears every ⏳ line) for a sketch or pic job, so the ⏳ of a waiting voice or photo job stays; `pendingLines`
  counts sketch and pic jobs under NEW `ui_pending_pics` 'ပုံ {n} ခု' and only the AI kinds under `ui_pending_ai`.
- **The measurement PDF**: `measurementReport` adds `report.image = {url: meas.photoUrl, caption: 'ကိုယ်ပုံ'}` when
  the session has a `sketch` and a `photoUrl` (whatever its source: a Telegram fix or copy keeps both, below), and prints
  the 'စာရွက် ဓာတ်ပုံ' URL row (:621) only for a session without a `sketch` (a PHOTO session's sheet photo), so a figure's
  Drive URL never prints as a sheet photo (review r3, m-2).
  `gasPdf.make` (gas_pdf.js:9-43): after `sh.clear()` (:12) also `sh.getImages().forEach(function (im) { im.remove(); })`;
  when `report.image`, the rows end with a caption row and 18 blank rows (the image's 360 px at the default row height, so
  the export's print range covers it; review r3, m-10), and BEFORE `SpreadsheetApp.flush()` (gas_pdf.js:35) the Drive file
  of the URL's id (`/[-\w]{25,}/`) as a blob is placed with `sh.insertImage(blob, 1, <the row under the caption>)`,
  resized to 240 × 360; a failed fetch is logged `pdf_image` and the PDF prints
  without it. The app's on-screen report preview (`appRenderReport`, app_ui.js:634-648) ignores `report.image`.
- **The Telegram measurement card**: when the newest session has a drawing, the previous-session screen of
  `startMeasureFor` (core_bot.js:4204-4207) adds the line `ms_sketch_line` '✏️ ကိုယ်ပုံ ပါပါသည် · 📄 PDF မှာ ကြည့်ပါ' (NEW)
  and a row `[btn_meas_pdf → MP|<prev.id>]` (the existing PDF, `sendMeasPdf` :4451); `measFix` (:4345-4358) copies
  `saved.sketch` into the new session, `MM|copy` (`measMode`, :4220-4226) copies `prev.sketch` and, with a drawing,
  `prev.photoUrl` (review r3, m-15; today it copies the field values only), and `saveMeasurement` (core_orders.js:585-599) passes `s.sketch` to `addMeasurement`,
  so a Telegram fix or copy keeps the drawing (a fix's `photoUrl` is already copied, :4351).
- **Offline**: drawing, saving and showing need no network; only the PNG waits for the next good sync. A Telegram fix
  made before the PNG job ran copies an empty PhotoURL, so its PDF prints without the figure (13.17).

### 13.8 History (F3)

`APP.screen = 'history'` (header: ←, 'မှတ်တမ်း'); `appRenderHistory` (app_ui.js:827-835, the last 200 chat messages) is
replaced by `appHistoryScreen` (app_screens.js). The bot chat is no longer shown anywhere in the app; `store.chat` keeps
only what the home's card needs. The owner keeps Telegram's own history.

- **Which rows**: NEW pure `appHistoryRows(phone, days)`: the groups (`groupId`) of the local ledger (`store.ledger`) in
  which at least one row that is not a mirror was recorded by THIS phone, `!r.synced || r.deviceId ===
  store.meta.deviceId` (`markSynced` stamps the device id, app_store.js:405-412); mirror rows (`reversesTxId`) are not
  listed; a group is undone when `groupRows(ports, groupId).live` is empty, computed from EVERY row of the group (review
  r3, m-6: an owner's void from Telegram writes its mirrors with device 'TG', gas_store.js:397, which a filter by device
  would miss); newest group first by its first row's
  time; the groups of the last `APP_HIST_DAYS` 7 days, and 'နောက်ထပ် ကြည့်မယ်' (`ui_hist_more`) adds seven more. A
  Telegram row of the same staff member (device 'TG') is not this phone's and is not listed.
- **Each row** `{groupId, day, time, name, tag, amount, unit, pending, undone, undoUntil, kind}` (review r3, UX-M8: the
  what cell shows the name on its first line and the type as a muted tag under it, rule 5 of 13.1, never 'type · name'):

  | Group | name (first line) | tag (muted, second line) | amount |
  |---|---|---|---|
  | SALE rows (+ a split PAYMENT) | the first item's name, ' +{n−1}' for a basket ('… +၂') | `txLabel('SALE')` 'ရောင်း' | Σ amount, kyat |
  | one RESTOCK with note 'new item' / 'new sample' | the name | `ui_home_new` plain 'ပစ္စည်းအသစ်' | '+{qty} ထည်' |
  | RESTOCK rows | the name, or '{n} မျိုး' | 'ကုန်ရောက်' | '+{Σ qty} ထည်' |
  | EXPENSE | the category label | 'ကုန်ကျ' | the amount, kyat |
  | PAYMENT, DEPOSIT | the buyer | 'ငွေလက်ခံ' / 'စရံ' | the amount |
  | RETURN, TRANSFER_OUT / IN, FEE | the item or the buyer | `txLabel` (core_report.js:6-9) | the amount (a transfer: '{qty} ထည်') |

  `pending` (a row not yet synced) shows the `cloud-upload` icon with `aria-label` `ui_hist_pending` 'မပို့ရသေး'; `undone`
  strikes the row and its amount reads `ui_hist_undone` 'ပယ်ဖျက်ပြီး'.
- **Layout** (`.tbl`, one table per day; the day heading `ui_hist_today` 'ဒီနေ့' / `ui_hist_yesterday` 'မနေ့က' /
  `fmtDayShortMy`):
  ```
  ဒီနေ့ · ၁၃ နိုဝင်ဘာ
  အချိန်   အကြောင်း                                     ငွေ
  14:32   လုံချည် ကချင် အပြာ +၂                          83,000   >
          ရောင်း  (cloud-upload)                          the type tag, muted; the icon while not sent
  13:05   အထည်ဖိုး                                       20,000   >
          ကုန်ကျ
  11:40   လုံချည် ပိုး အနက်                               +၅ ထည်   >
          ကုန်ရောက်
  09:12   ထမီ ပိုးထည် အစိမ်း                              +၃ ထည်   >
          ပစ္စည်းအသစ်
  မနေ့က · ၁၂ နိုဝင်ဘာ
  …
  [ နောက်ထပ် ကြည့်မယ် ]
  ```
  Empty: `ui_history_empty` plain.
- **A row opens** (`data-f="hist:<groupId>"`): a sale group → the receipt page (13.10); any other group → the entry page
  (`APP.screen = 'entry'`, header 'မှတ်တမ်း အသေးစိတ်' `ui_entry_title`): `.kv` rows `ui_lbl_time`, the type, the buyer, the
  method, the note; a `.tbl` of its rows (item | qty | amount); and, while the undo is allowed, `[arrow-back-up
  မှားသွားတယ်]` with `ui_undo_until` '{time} အထိ ပြန်ဖျက်နိုင်ပါသည်' under it. **The undo is allowed** when every row of the
  group is live and the first is at most `CFG.UNDO_WINDOW_MIN` 30 minutes old (the rule of `undoGroup`,
  core_ledger.js:999-1000). The button runs `appScreenAct('U|' + groupId)`: the core's own undo (`case 'U'`,
  core_bot.js:541-551, with revision 2's lists and the new-piece rule) answers on the home's card.
- Opened by the home's history handle (app_ui.js:494, :502: `appOpenScreen('history')`).

### 13.9 Cards as clean lists (F7)

**View hints from the core.** The chat port takes an optional last argument `extra`: `chat.sendMessage(chatId, text,
keyboard, extra)`, `chat.sendPhoto(chatId, photo, caption, keyboard, extra)`, `chat.editMessage(chatId, messageId, text,
keyboard, isCaption, extra)` (app/app_ports.js:93-123): the stored message gets `m.view = (extra && extra.view) || null`
(an edit without one clears it). gas_telegram.js (:35, :39, :52) and poc/sim_ports.js (:317, :321, :329) ignore the extra
argument: no change, and every Telegram text is byte for byte today's. The core passes a view only when
`screensInApp(ports)`:
- `sendItemCard` (core_bot.js:236-243): `{view: {kind: 'item', id: item.id, extra: opts.extra || []}}`; the edits that put a
  line under a card (revision 2's `startSaleFor` refusal; `case 'T'`'s `ret_credit_open`) pass the same view with that line
  in `extra`.
- the sold card (`basketSoldReply`, 4.4; `saleCardText`, :3194-3217): `{view: {kind: 'sold', id: groupId, extra: addedKey ?
  [<acct_detail_hint text>] : []}}`; the deposit question (`credit_use_deposit`) has no view.
- `answerToday` (:1051-1060): `{view: {kind: 'today'}}`.
- review r3, UX-M8: every reply that ends a committed restock, expense, payment or deposit, `{view: {kind: 'group', id:
  groupId}}`: `restock_done` (`handleCallback`'s `case 'R'`, :526; `applyAwaitedNumber`, :805; the restock form's reply,
  1.6), `expense_done` (`expenseMethod`, :2038; the expense form's reply, 1.7), `pay_done` (`commitPaymentAndReply`,
  :1855), `dep_done` (`finishDeposit`, :1930), and the same replies of a voice or typed proposal (`confirmProposal`,
  :1134, :1148). The new-piece reply needs none: the item card that follows it carries the item view.

**The app draws a view** (app_screens.js): `appRenderMsg` (app_ui.js:663-714) draws `appViewNode(m.view)` instead of the
text node (:688); the photo (:677), the stepper (:691) and the keyboard (:692-708, `.kb .row button` with `data-cb` and
`hot`) are drawn as today, with plain labels. Pure builders (Node-tested):

- `appItemView(phone, id)` → `{title, sub, rows, extra}`: title = the name (+ `sample_mark` plain); sub = the id · the
  category; rows: `ui_lbl_price` 'ရောင်းစျေး' {price} ကျပ် (a pending price: 'စျေး မသတ်မှတ်ရသေး' in `--warn`);
  `ui_lbl_stock` 'လက်ကျန်' {stock} for a stock item, for a one-of-a-kind piece `ui_val_have` 'ရှိ' / `ui_val_sold`
  'ရောင်းပြီး'; a sold piece with a buyer adds `ui_lbl_buyer` 'ဝယ်သူ', `ui_lbl_paid` 'ပေးပြီး', `ui_lbl_method` 'ပေးနည်း'
  (cardText's facts, :191-206); a piece sold in a basket adds, before ပေးပြီး, the row `ui_lbl_basket` 'အတူ ဝယ်သည်' valued
  `basket_count` plain ('{n} ခု'), so the paid reads as the basket's (review r3, UX-M8: no ' · {n} ခု' tail); then the extra
  lines, muted.
- `appSoldView(phone, groupId)` → title `ui_sold_title` 'ရောင်းပြီး', sub = the receipt number · the time; a `.tbl`
  (`ui_lbl_item` 'ပစ္စည်း' | `ui_lbl_qty` 'အရေအတွက်' | `ui_lbl_amount` 'ငွေ'; the narrow quantity column may wrap its heading) with one row per live SALE row and, under a stock
  item, a muted 'လက်ကျန် {stock}'; rows `ui_lbl_total` 'စုစုပေါင်း', `ui_lbl_paid`, `ui_lbl_owed` (only while owed,
  `--warn`), `ui_lbl_method` ('ငွေသား' or 'KBZPay'; a mixed payment reads 'ခွဲပေး', `btn_split` plain, and is followed by one
  indented row per method, the method as label and its amount as value, from `groupMethods`; review r3, UX-M8), `ui_lbl_buyer`,
  `ui_lbl_due` 'ပေးမည့်ရက်' (only while owed and dated).
- `appTodayView(phone)` → per shop of the staff (the owner: both) a heading and rows from `dayStats` as answerToday reads
  them: `ui_lbl_revenue` 'ရောင်းရငွေ', `ui_lbl_pieces` 'ထည်', `ui_lbl_cash_in` 'ငွေလက်ခံ', `ui_lbl_expenses` 'ကုန်ကျ',
  `ui_lbl_profit` 'အမြတ် (ခန့်မှန်း)', `ui_lbl_drawer` 'ငွေသား', `ui_lbl_bank` 'ဘဏ်'.
- `appGroupView(phone, groupId)` (review r3, UX-M8) → `{title, sub, rows, table, extra}` from the group's rows; sub = the
  time; by the group's type:
  - RESTOCK (not a new piece): title `btn_restock` plain 'ကုန်ရောက်'; a `.tbl` (`ui_lbl_item` 'ပစ္စည်း' | `ui_lbl_pieces`
    'ထည်' | `ui_lbl_stock` 'လက်ကျန်') with one row per line: the name (the id muted under it), '+{qty}', the stock now;
  - EXPENSE: title `btn_expense` plain 'ကုန်ကျ'; rows `ui_lbl_amount`, `ui_lbl_cat` 'အမျိုးအစား', `ui_lbl_method`,
    `ui_lbl_note` (when set), `ui_lbl_shop` 'ဆိုင်' (the owner only);
  - PAYMENT: title `btn_pay` plain 'ငွေလက်ခံ'; rows `ui_lbl_buyer`, `ui_lbl_amount`, `ui_lbl_method`, `ui_lbl_owed` (what
    the sale it pays still owes after it, `saleGroupInfo` of its `refGroupId`);
  - DEPOSIT: title `btn_deposit` plain 'စရံ'; rows `ui_lbl_buyer`, `ui_lbl_amount`, `ui_lbl_method`, `ui_lbl_held`
    'လက်ခံထား စုစုပေါင်း' (`depositsFor`), `ui_lbl_note` (when set);
  - an undone group: the same, under `ui_hist_undone` in `--muted`.
  The keyboard under it (`undoRow`, the deposit's 📱) is drawn as today, plain.
- Report documents (`m.document.report`): the tables of `appRenderReport` (:634-648) as today; the caption plain; the
  actions 'PDF → Telegram' and icon `share` + 'Share' (`appDocActions`, :737-756).
- Every other bot card: its text and buttons plain (13.1); a button whose text is `btn_cancel`'s reads 'Cancel', whatever
  its callback (`Z`, `SS|…|z`; review r3, UX-m1).

The sold card of 1.4 in the app therefore reads:
```
ရောင်းပြီး                                    R1-A-000231 · 14:32
ပစ္စည်း                                   အရေအတွက်       ငွေ
လုံချည် ကချင် အပြာ                          ၂         36,000
  လက်ကျန် ၃
ထမီ ဇင်းမယ် အဝါ                             ၁         22,000
  လက်ကျန် ၁
ထမီ ချည်သား အနီ                             ၁         25,000
စုစုပေါင်း                                            83,000
ပေးပြီး                                               30,000
ကျန်                                                  53,000
ပေးနည်း                                              ငွေသား
ဝယ်သူ                                               ဒေါ်မြင့်
ပေးမည့်ရက်                                  ၂၆ နိုဝင်ဘာ ၂၀၂၆
[ မှားသွားတယ် ]  [ ဘောက်ချာ ]
[ ငွေလက်ခံ ]
```

### 13.10 The receipt (F11)

- **Core**: `sendReceipt` (core_bot.js:2080-2084), first line: `if (screensInApp(ports)) return ports.ui.openScreen('receipt',
  {chatId: chatId, groupId: groupId, staff: staff});`. Telegram's receipt message (the text and `[📄 PDF]`, the owner's void
  row of revision 2's M6) is unchanged.
- **The page** (`APP.screen = 'receipt'`, `APP.screenArg` = the group; header: ←, 'ဘောက်ချာ'): NEW pure
  `appReceiptView(phone, groupId)` from `buildReceipt` (core_report.js:331-358) and the letterhead (`shopAddress`,
  `shopPhone`, core_orders.js:43-44; core_orders.js is in the app bundle, build_app.js:55-57):
  ```
  ဆိုင် ၁ (ရန်ကုန်)
  အမှတ် ၁၂၃ ဗိုလ်ချုပ်လမ်း                                (the address, when set)
  09 123 456 789                                          (the phone, when set)
  ဘောက်ချာ                                       R1-A-000231
  ရက်စွဲ                               ၁၃ နိုဝင်ဘာ ၂၀၂၆ · 14:32
  ဝယ်သူ                                              ဒေါ်မြင့်
  ပစ္စည်း                         အရေအတွက်   စျေး          ငွေ
  လုံချည် ကချင် အပြာ               ၂      18,000      36,000
  ထမီ ဇင်းမယ် အဝါ                  ၁      22,000      22,000
  ထမီ ချည်သား အနီ                  ၁      25,000      25,000
  စုစုပေါင်း                                          83,000
  ပေးပြီး (ငွေသား)                                     30,000
  ကျန်                                                 53,000
  ပေးမည့်ရက်                                ၂၆ နိုဝင်ဘာ ၂၀၂၆
  ငွေလွှဲရန်                        KBZPay 09 777 123 456 (ဒေါ်မြ)
  ကျေးဇူးတင်ပါသည်
  [ (share)   ဘောက်ချာ Share မယ် ]
  [ (printer) PDF / Print ]
  [ (undo)    မှားသွားတယ် ]           while the undo is allowed (13.8's rule)
  [ ပယ်ဖျက် (ဆိုင်ရှင်) ]             the owner, a basket that is not voided (revision 2, M6: btn_void plain → V|<g>)
  ```
  A voided sale shows `receipt_void` plain on top and no undo. An undone sale (review r3, UX-m4: its mirrors written by
  `U|` within the 30 minutes) shows `ui_hist_undone` 'ပယ်ဖျက်ပြီး' on top and none of the four buttons: nothing to share,
  print, undo or void. Every button and the `ui_undo_until` hint sit inside `.rc-actions`, which the print stylesheet
  hides (13.13). Labels: `ui_lbl_receipt` 'ဘောက်ချာ', `ui_lbl_date`,
  `ui_lbl_buyer`, `ui_lbl_item`, `ui_lbl_qty`, `ui_lbl_unit` 'စျေး', `ui_lbl_amount`, `ui_lbl_total`, `ui_lbl_paid` (+
  `receiptMethodText`, core_report.js:366-371), `ui_lbl_owed`, `ui_lbl_due`, `ui_lbl_transfer` 'ငွေလွှဲရန်'
  (`r.transferLines`), `receipt_thanks` plain.
- **'ဘောက်ချာ Share မယ်'** (`data-f="rc:share"`): NEW pure `appReceiptText(phone, rcpt)` builds the plain text of the page
  (the same lines, `label  value`, no emoji, money through `fmtMoney`), and `appShareText(text, title)` (app_ui.js:770-774)
  hands it to the phone's share sheet (`navigator.share`: Viber, Telegram, Messenger, SMS), or copies it where there is none and toasts `ui_copied` 'ကူးပြီးပါပြီ' (13.1).
  **What Share sends**: that text only, from this phone to whoever the seller picks; no file, nothing to the server.
- **'PDF / Print'** (`data-f="rc:print"`): `APP.win.print()`; the print stylesheet (13.13) prints the receipt alone, and the
  phone's print dialog offers a printer or "Save as PDF". Offline. Where `print` does not exist, the server's A4 PDF goes to
  the seller's own Telegram chat (`APP.sync.requestReport('receipt', groupId)`, app_sync.js:429-432) when online, else the
  toast `app_need_online`.
- **Opened by**: the sold card's ဘောက်ချာ (`RC|<g>`), a sale row of the history, a sale row of a buyer's page.
- The share row under a 🧾 card (`appShareRow`, app_ui.js:710, :765-769) is deleted: the app has no receipt card any more.

### 13.11 The AI switch (F9b), the menu and restock (F12)

**The switch.** NEW Settings key `ai` ('TRUE' / 'FALSE'), the one AI switch for every phone and the bot. NEW
`aiOn(ports)` (core_config.js, beside `settingOn` :202-205): `var v = ports.store.getSetting('ai', true); return !(v ===
false || v === 0 || /^\s*(FALSE|0|OFF|NO)\s*$/i.test(String(v)));` A missing row reads ON, which is today's behaviour (the
photo AI names a new piece, Telegram reads voice notes and typed sentences). **How it maps onto today's rows**, which the
Sheet keeps as the source of truth:

| Feature | Shown and allowed when | Today |
|---|---|---|
| 📒 the notebook (Telegram and the app's ☰) | `aiOn(ports) && settingOn(ports, 'notebook_import')` | `notebook_import` only (core_bot.js:141, :2231) |
| 🎤 voice in the app (the bottom bar) | `aiOn(ports) && settingOn(ports, 'app_voice')` | `app_voice` only (app_ui.js:381) |
| the photo AI's name for a new piece (the app's form, Telegram's photo) | `aiOn(ports)` | always |
| Telegram voice notes and typed sentences (`parseVoice`, `parseText`) | `aiOn(ports)` | always |
| the measurement-sheet photo (`MM|photo`, `readMeasurementSheet`) | `aiOn(ports)` | always |

**The app's switch** (Settings screen, `appRenderSettings`, app_ui.js:869-905; it replaces today's read-only voice row,
:891): a row 'AI' with an on/off toggle (`data-f="ai"`), and under it a muted hint and three label/value rows (review r3, UX-M8 and UX-m8): the hint `ui_ai_hint` (NEW)
says in one line what each part does; the rows `ui_ai_nb` 'စာအုပ်', `ui_ai_voice` 'အသံ' and `ui_ai_photo` 'Photo အမည်' are
each valued `ui_on` 'ဖွင့်' or `ui_off` 'ပိတ်' as the part is shown and allowed by the table above (a part can be off by
its own Sheet row while AI is on). When AI is off every row reads 'ပိတ်' and the hint is `ui_ai_off_hint` 'AI
ပိတ်ထားပါသည် · ဖောင်တွေကို လက်နဲ့ ဖြည့်ပါ'. The owner's toggle writes, through the `setting` entry of 13.12: ON → `ai` TRUE,
`notebook_import` TRUE and `app_voice` TRUE (so "AI on" shows 📒, 🎤 and the photo name, as F9b says); OFF → `ai` FALSE
only (the two rows keep their values; while `ai` is FALSE they do not matter). Writing the two rows on ON is deliberate
(review r3, m-13): F9b says "AI on" shows 📒, 🎤 and the photo's name, and setupSheet seeds `notebook_import` FALSE
(gas_setup.js:55) and no `app_voice` row, so an ON that wrote `ai` alone would show nothing new; an owner who wants one
part off afterwards types FALSE in its row, and the row above says so. The local Settings change at once, so the
owner's phone shows or hides the parts before any sync; every other phone follows at its next pull and the bot at its next
tap. A seller sees the switch disabled with `ui_ai_owner_only` 'ဆိုင်ရှင်သာ ပြောင်းနိုင်ပါသည်'. In the Sheet the `ai` row
carries the note `settings_note_ai` (13.14) and setupSheet appends `['ai', 'TRUE']` when it is missing (gas_setup.js
defaults :52-77, appended by :78-79), so the live book keeps today's behaviour after the publish.

**When AI is off nothing is shown and nothing is queued for the AI; every form works by hand:**
- `showMenu` (core_bot.js:131-151): the notebook button (:141) needs `aiOn(ports) && settingOn(ports, 'notebook_import')`,
  in both channels (the notebook stays in the app, F9b); `startNotebook` (:2230-2234) answers `nb_off` unless both hold.
- the app's 🎤 (`voiceOn`, app_ui.js:381) needs `aiOn && app_voice`.
- `handleVoice` (core_bot.js:687-698) and the free-text fallback of `handleText` (:754-760): when `!aiOn(ports)`,
  `fallbackToButtons(chatId, uid, staff, ports, 'ai_off', '')` instead of the AI call (NEW MSG `ai_off`; the buttons are the
  ones `ai_down` gets today).
- `handlePhoto` (:2108-2124): `desc = aiOn(ports) ? <today's describePhoto call> : null`, so the name is the placeholder
  'ပစ္စည်း <id>' and no AI call or `photo_seen` line happens; the new-piece card and form work as without a name.
- the app's new-piece form (revision 2's `appNewItemSave`, 7.2): `ports.ai.describePhoto` is called only when `aiOn`; the
  hint `ui_form_name_later` shows only when `aiOn`. With AI off the photo still goes up (review r3, M-1: today the AI
  `photo` job is the only path that saves a phone's photo to Drive and sets the item's photoUrl, gas_sync.js:306-316, and
  `chat.savePhoto` only returns 'local://', app_ports.js:119-122): `appNewItemSave` calls NEW `phone.queuePic(mediaId,
  itemId)` (app_ports.js, beside `queueAi`: the media record becomes `{kind: 'pic', status: 'queued', itemId, jobId,
  queuedAt}`). A `pic` job is not AI: `flushAiJobs` sends it whatever the switch says, after the item's outbox entry
  (revision 2's M1 hold); the server's `syncHandle` answers it `rec.photoUrl = result.photoUrl || ''` and never `ai_off`;
  `gasSyncHooks().ai` gains a `pic` branch before the Gemini calls (the item missing → `throw new Error('no_item')`, else
  the JPEG saved as `<itemId>.jpg` in `gasPhotoFolder()` and `gasStore.updateItem(itemId, {photoUrl})`, as :310-312, with
  no AI call); poc/sim_sync.js `hooks.ai` the same on the world (`photoUrl = 'sim://photo/' + itemId`). On the phone a
  done `pic` job drops its data and says nothing; `no_item` follows the sketch's `no_session` rule (13.7.2).
- `measMethodRow` (:4212-4214): `btn_meas_photo` only when `aiOn`; the `MM|<t>|photo` answer (:4230-4235) refuses with
  `ai_off` when off.
- the phone's queue (review r3, M-12: a held job kept the icon-only sync status at "waiting" for ever, because
  `chipState` counts `aiQueued`, app_sync.js:485): `flushAiJobs` (app_sync.js:405-426) marks a job of kind voice, text,
  photo or notebook `status: 'skipped'` while `!aiOn` (its data kept, its ⏳ line cleared, never queued again: it was
  recorded before the owner switched AI off, and F9b says nothing waits for the AI); `store.queuedMedia` lists status
  'queued' only (app_store.js:653), so neither the chip nor `pendingLines` counts a skipped job. Sketch and pic jobs are
  not AI and go. The server's `ai` API (`syncHandle`, core_sync.js:1250-1272) answers an AI job `{status: 'failed', error:
  'ai_off'}` without calling the hook while `!aiOn(sp)`, and the phone marks a job so answered `skipped` too (a phone
  that had not pulled the switch yet).

**The menu and restock (F12).** In the app with forms (`formsInApp`) the extra row of `showMenu` gains `btn(t(ports,
'btn_restock'), 'M|restock')` right after the orders or measurement button: [📏 အတိုင်းအတာ] [📦 ကုန်ရောက်] [📒 စာအုပ်
(AI)] [🏛 အကောင့်]. Telegram's rows are unchanged (run_round4.js:964 and :1126 pin them; a Telegram restock starts from the
scanned piece's 📦, core_bot.js:230). `menuAction` (:631-655) gains `case 'restock': return formsInApp(ports) ?
(clearState(ports, uid), ports.ui.openForm('restock', {chatId: chatId, uid: uid, staff: staff})) : undefined;` (the
restock form of 1.6, empty, its camera running). Under `quick` the app has no forms (1.11): there, as in Telegram, a
restock starts from the scanned piece's card (📦 `R|`, core_bot.js:227-231), and the guide says so (review r3, UX-m6).
Whether F12's "main menu" also means Telegram's menu is left to the owner (13.17). The menu shows nothing that is switched off: orders only with the order
module (:139), 📏 only with a measurement path (:140), 📒 and 🎤 only with AI and their row.

### 13.12 Shops registered by the owner (F10), and the `setting` entry

**Amendment F10b (2026-11-13, FEEDBACK-1.md "Amendment 2").** The owner may add a third shop later. Nothing new in round 6 may assume exactly two shops: the Shops screen, the shop form, `SYNC.SETTING_KEYS` (built from `CFG.SHOP_IDS` times the shop keys, plus the AI keys), the Sheet notes and band, and every new test iterate `CFG.SHOP_IDS`. The ids stay S1 and S2 this round; S3 itself is not built (13.17).


The storage stays the Settings keys every reader already uses: `shop_name_S1` / `_S2` (`shopName`, core_config.js:189-192),
`shop_address_*`, `shop_phone_*`, `shop_brand_*` (core_orders.js:41-44; seeded by gas_setup.js:53, :72-73). The ids S1 and
S2 stay in tags, callbacks and lists.

**In the Sheet** (setupSheet, gas_setup.js, after the defaults loop :78-79, in the try/catch style of :85-93): the eight
shop rows (name, brand, address and phone of S1 and S2) get a note on their Key cell from the NEW Messages keys
`settings_note_shop_name`, `settings_note_shop_brand`, `settings_note_shop_address`, `settings_note_shop_phone` (13.14,
`{n}` = ၁ / ၂), and the tab one conditional-format rule that colours those rows (review r3, M-4: `Range.setBackground` is not modelled by
poc/fake_gas.js, :56, and a logged failure would turn run_gas.js:472 red, while the rule builder and
`setConditionalFormatRules` are, fake_gas.js:454-459, :521-552, and read back through `rules()`, :742):
`SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH($A2,"^shop_(name|brand|address|phone)_S[12]$")')
.setBackground('#e3e7f7').setRanges([settings.getRange(2, 1, settings.getMaxRows() - 1, 2)]).build()`, set with
`settings.setConditionalFormatRules([rule])` (the Settings tab has no other rule): the Shops block, coloured wherever its
rows are. No row moves; a value the family
typed is never touched. The `ai` row gets its own note (13.11).

**In the app** (the owner only): the Settings screen (`appRenderSettings`, app_ui.js:869-905) gains a section 'ဆိုင်များ'
(`ui_shops_title`) above the font size:
```
ဆိုင်များ
ဆိုင် ၁ (ရန်ကုန်)                                                >
အမှတ် ၁၂၃ ဗိုလ်ချုပ်လမ်း                                            (muted; the address and the phone
09 123 456 789                                                       on lines of their own, UX-M8)
ဆိုင် ၂ (မန္တလေး)                                                 >
လိပ်စာ မထည့်ရသေး
```
A row (`data-f="shop:S1"`) opens the shop form (`APP.form`, kind `shop`, `div#shopForm.formpage`), title `ui_shop_title`
'{shop} · {id}':

| Field | `data-f` | Default | Label | Rule |
|---|---|---|---|---|
| name | `name` | `shopName(ports, id)` | `ui_lbl_shop_name` 'ဆိုင်အမည်' | required, maxlength `CFG.SHOP_TEXT_MAX.name` 40 |
| address | `address` | `shopAddress` | `ui_lbl_address` 'လိပ်စာ' | maxlength 80 |
| phone | `phone` | `shopPhone` | `ui_lbl_phone` 'ဖုန်း' | `inputmode=tel`, free text (two numbers allowed), maxlength 40 |
| Save | `save` | — | `ui_w_save` | `appShopSave` |

`appShopSave(phone, F)`: a blank name → `ui_shop_name_needed` in `.fmsg`; for each changed field
`store.local.setSettingLocal('shop_<field>_' + id, value)`; then `appFormCommit(phone, sync, 'setting')`; the toast
`ui_shop_saved`; the header shows the new name at once. A seller's Settings screen has no Shops section.

**The `setting` entry** (shops and the AI switch). `store.local.setSettingLocal(key, value)` (NEW, app/app_store.js; twin
poc/sim_phone.js) writes the local Settings at once and queues `{kind: 'setting', key, value}`. core_sync.js (step 1): NEW
entry kind `setting` (`SYNC.ENTRY_KINDS`, :75, gains `setting: 8`). Validation (`syncValidateBatch`, :406-438): `reason =
sp.store.setSetting ? syncSettingReason(device, e) : SYNC.REASON.BAD_KIND`. NEW `syncSettingReason(device, e)`: the key is
one of `SYNC.SETTING_KEYS` = shop_name_S1, shop_name_S2, shop_address_S1, shop_address_S2, shop_phone_S1, shop_phone_S2, ai,
notebook_import, app_voice; a shop value is a string of at most `CFG.SHOP_TEXT_MAX` (name 40, address 80, phone 40;
`CFG.SHOP_TEXT_MAX` NEW in core_config.js beside `SHOP_NAMES` :22) and a name is not blank; an AI value is exactly 'TRUE'
or 'FALSE'; else `malformed`. The device must be the owner's, else `staff`. Apply (the push loop, beside `list`,
:751-771): the same value as stored (compared as strings without case, so a cell read back as a number or a boolean
still matches; review r3, M-3) → `dup`, else `sp.store.setSetting(key, value)` → `ok`; the result is `{kind:
'setting', entryId, status}`. The ack (:1399-1419): a setting answered `bad_kind` without `kindKnown` stays in the outbox
(an older server), and a quarantined one clears `cursor.settingsHash` so the next pull brings the server's value back (the
list rule). A server whose store lacks `setSetting` answers `bad_kind` WITH `kindKnown` (core_sync.js:669), which is final:
the entry is dropped and the hash cleared like any quarantine (review r3, M-8). A refused setting also toasts the owner:
app_ui's `phone.on('sync', …)` reads the summary's `quarantined` (app_sync.js:277, emitted at :350) and, for a `setting`
entry, toasts `app_rejected` plain with its reason; the Settings screen shows the server's value after the next pull. The next pull of every phone carries the new Settings (the settings hash changed, :1004-1020); the bot reads
them at its next tap. `local.setSettings(map)` (app_store.js:459, poc/sim_phone.js:241) re-applies the outbox's setting
entries over a pulled map (as it re-applies list entries), so an offline edit is never undone by a pull before it is
pushed. `pendingLines` (app_sync.js) shows a setting as `ui_pending_setting` '{label}' (the shop's name, or 'AI').

**Glue** (step 2): NEW `gasStore.setSetting(key, value)` (gas_store.js): under `gasLocked`, the Value cell of the row whose
Key is `key`, or a new row, set to plain text (`setNumberFormat('@')`) before `setValue(String(value))`, as the Lists and
Measurements writers do (gas_store.js:315, :624), so '09123456789' keeps its 0, '+95…' its '+' and 'TRUE' stays text
(review r3, M-3: Settings are read through `getValues`, gas_store.js:690-693); `gasInvalidate()`. It is a member of `gasStore`, not a global: run_gas.js:177 already has a test helper function `setSetting(fake, key, value)`, which stays. poc/sim_ports.js gains the same member (and run_gas.js's member tables,
:198-229, name it: revision 2's B18 rule).

### 13.13 App files, CSS and the four load lists

| File | Revision 3 |
|---|---|
| `app/app_icons.js` (NEW) | `APP_ICONS` (with review r3's `file-text` and `backspace`), `appIconSvg`, `appIcon`, `APP_EMOJI_HEAD`, `APP_EMOJI_ANY`, `appPlainLine`, `appPlain` (13.1, 13.2) |
| `app/app_sketch.js` (NEW) | the figures, the encode/decode helpers (`appSketchUndo` among them), the pad with its draw mode and `appSketchFit`, `appSketchCanvas`, `appSketchPng` (13.7.2) |
| `app/app_screens.js` (NEW) | the nav stack (13.4: `appNavTop`, `appNavPush`, `appNavReplace`, `appNavDrop`, `appNavReset`, `appNavSync`, `appOnPop`, `appNavPopTo`, `appNavCanBack`, `appNavBack`, `appNavPop`, `appNavGuard`, `appNavCardSync` (the card rule `appRender` calls), `appOpenScreen`); the history, entry, buyers, buyer and receipt pages, the Settings AI switch and Shops section (13.6, 13.8, 13.10, 13.11, 13.12); the item, sold, today and group views (13.9); the form kinds `buyer` and `shop`; `appScreenAct`; `appReceiptText`; `appOnOpenScreen` (the `'openscreen'` listener, a `setTimeout(0)` open as `appOnMeasureForm`, app_ui.js:995-999) |
| `app/app_forms.js` (revision 2 NEW) | `.fhead` = `[← data-f="close"]` + the title, plain (no ✖️ ပိတ်); Save reads `ui_w_save`; `appOpenForm` / `appCloseForm` push and drop the `form` layer (13.4); a kind table `APP_FORM_KINDS` `{sale, newitem, restock, expense, buyer, shop}`, each `{init, set, view, save, render}`, through which `appOpenForm`, `appFormRender`, `appFormSet` and `appFormSave` dispatch; the photo button 'Photo'; the AI gate of `appNewItemSave` and its `phone.queuePic` with AI off (13.11); a Save replaces the `form` layer by a `card` layer (13.4); the bar's `.fsum` cells (1.3) |
| `app/app_ui.js` | `APP.tt` plain and `APP.ttRaw` (13.1); `appPaintChrome` and the header (13.3); the nav wiring and `phone.on('openscreen', appOnOpenScreen)` (:303-308); the history renderer replaced (:827-835); no `.pagehead` (:829, :840, :871); the Settings screen's AI switch and Shops section (13.11, 13.12); `voiceOn` (:381) needs `aiOn`; `appInputBar` (13.5); `appRenderMsg` views and plain labels (13.9); OK / Cancel in the three sheets; the measurement form: ← in its head (:1013-1016), the note textarea, no notes box, the figure section, Save and its toast (13.7); `appShareRow` deleted. Review r3: the card rule in `appRender` (13.4); the banner (:407-408), the wipe (:902), `phone.on('revoked')` (:307) and the enrolment through the stack; the guard listeners (13.3); the reload walk at boot (13.4); the card state's Photo handle (:503) deleted (1.1); `appTiles` (:581-588), the find panel (:593, :606), `appPhotoNode` (:626), the voice bubble (:670), the report card (:679), the stepper (:728), `appShareText` (:773) and the two keypads (:923-926, :949) per 13.1; the sync screen and the Settings screen as label/value rows (UX-M8: `ui_lbl_state`, `ui_lbl_last_sync`, `ui_sync_problem`; `ui_lbl_staff`, `ui_lbl_shop`, `ui_lbl_device`, `ui_lbl_letter`, `ui_font_size`, `ui_text_cards`, `ui_lbl_version`; the clock and storage sentences stay as muted notes); `phone.on('sync', …)` toasts a refused setting (13.12) |
| `app/app_ports.js` | `ui.openScreen`; the chat `extra` view; `phone.sim.act`; `lastBot` skips an unanswered carrier; `phone.queuePic` (13.11) |
| `app/app_store.js` | `saveMeasurementLocal` and `upsertMeasurement` keep `sketch`, the returned `entryId`; `local.setSettingLocal`; `setSettings` re-applies setting entries; `measurementRejected` fails that customer's orphaned sketch jobs (13.7.2) |
| `app/app_sync.js` | `jobPayload` sends `entryId`; `flushAiJobs`' sketch and pic holds, AI jobs `skipped` while `!aiOn` or answered `ai_off`, the failure rules and the five `no_session` / `no_item` tries; `replayJob` silent for a sketch or pic and leaves the ⏳ lines; `pendingLines` names a setting and counts pictures apart (`ui_pending_pics`) |
| `app/app_i18n.js` | the keys of 13.14 |
| `app/app.css` | below |
| `app/index.html` | 13.3 |
| `app/vendor/tabler-icons-LICENSE.txt` (NEW) | the MIT notice (13.2) |
| `app/dev/index.html` | `<script src="../app_icons.js">` before `../app_ui.js`; `../app_sketch.js` and `../app_screens.js` after `../app_forms.js` (:124-130); `noHistory: true` in its `bootApp` options (:152); review r3, M-9: its own header (:39-43) gains `<button id="back" class="iconbtn" type="button" aria-label="back" hidden></button>` before `#shopName` (without it `appWireEvents` and `appPaintChrome` throw on `$('back')`), and its autopilot's `&screen=` (:183) calls `appOpenScreen(q.screen)` |
| `tools/build_app.js` | `APP_FIRST` (:30) = `['app_i18n.js', 'app_store.js', 'app_ports.js', 'app_sync.js', 'app_scan.js', 'app_media.js', 'app_icons.js', 'app_ui.js', 'app_forms.js', 'app_sketch.js', 'app_screens.js']` |
| `poc/build_simulator.js` | `FRAME_FILES` (:28) in the same order (check_simulator.js:87 compares the two); BOOT passes `noHistory: true` (:196-197); review r3 (step 4): the `screen` op (:156) calls `appNavReset()` and then, for any screen but 'home', `appOpenScreen(name)`; `snap` reads `(APP.nav \|\| [])`; `pick` (:128-132) also matches a button's plain text |
| `poc/run_app.js` | `FILES` (:20-23) in the same order |

**app.css** (new rules through the existing tokens only, so dark mode follows, :18-33):
- `.iconbtn` (a square button: 44 px in the header, `--tap` 56 px elsewhere; its `svg` 24 px in `currentColor`); `.ic svg`
  (`width: 1.2em; height: 1.2em; vertical-align: -.2em`) for a text button's leading glyph; `.top .shop` keeps today's
  ellipsis (:59).
- `.chip.iconbtn` (no text) with its colour per state (13.3) and `.badge` (a 20 px pill at the top right, `--warn` on
  `--panel`, `--mono` digits); `.chip.sending svg` a 1.2 s opacity pulse, off under `prefers-reduced-motion: reduce`.
- `.kv` / `.kvr` (a row: `display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid
  var(--line)`; the label `--muted`; the value `font-weight: 600; text-align: right`, numbers `--mono`), `.kvh` (a section
  heading), `.tbl` (a full-width table, `--mono` right-aligned numbers, a muted second line), `.lrow` (a 56 px tappable row
  with the chevron at the right), `.owed` (`--warn`), `.switch` (the AI toggle, 56 px).
- `.sketch` (a 2:3 box at most 300 px wide and `calc(100vh - 240px)` high, its width following; the outline `svg` and
  the `canvas` stacked; the canvas `touch-action: pan-y`, and `touch-action: none` with an `--accent` outline under
  `.sketch.drawing`; review r3, UX-M5), `.sktools` (above the pad; the clear button apart at its right).
- review r3, UX-M8: `.fsum` (the sale bar's cells: a muted 14 px label over a `--mono` 600 value, in a row that wraps),
  `.tag` (a history row's muted type line), `.kvs` (a small inline label/value pair inside a table cell).
- `@media print`: `.top, .bottom, .banner, .toast, .overlay, .rc-actions { display: none !important; } #app { position:
  static; max-width: none; } .main { overflow: visible; }`, so only the receipt prints.
- `.pagehead` (:125-127) stays, unused (no check pins it).

### 13.14 Messages of revision 3

MSG (core_messages.js, step 1, a "round 6 · revision 3" block; drafts for a native speaker):
```
ms_sketch_line: '✏️ ကိုယ်ပုံ ပါပါသည် · 📄 PDF မှာ ကြည့်ပါ'
ai_off: '🤖 AI ပိတ်ထားပါသည် · အောက်က ခလုတ်တွေနဲ့ မှတ်ပါ'
settings_note_ai: 'AI · FALSE = ဓာတ်ပုံ အမည်၊ အသံ၊ စာ၊ စာအုပ် အကုန် ပိတ် · TRUE = ဖွင့် (စာအုပ်က notebook_import၊ အက်ပ်အသံက app_voice ပါ TRUE လိုပါသည်)'
settings_note_shop_name: 'ဆိုင် {n} · အမည် · မီနူး၊ ဘောက်ချာ၊ အက်ပ် ထိပ်မှာ ပြပါသည်'
settings_note_shop_brand: 'ဆိုင် {n} · ဘောက်ချာ ခေါင်းစီး · မထည့်ရင် အမည်ကို သုံးပါသည်'
settings_note_shop_address: 'ဆိုင် {n} · လိပ်စာ · ဘောက်ချာမှာ ပြပါသည်'
settings_note_shop_phone: 'ဆိုင် {n} · ဖုန်း · ဘောက်ချာမှာ ပြပါသည်'
```
Their words: `btn_meas_pdf` and `rep_meas_title` for the PDF line; `ai_down` and `menu` (core_messages.js:89, 'ခလုတ်') for
`ai_off`; `ui_shop_short` 'ဆိုင်' and `receipt_header` for the notes; 'ခေါင်းစီး', 'ပြပါသည်' and 'ပိတ်ထား' are drafts.

APP_MSG (app/app_i18n.js, step 3, a "round 6 · revision 3" block):
```
ui_w_ok: 'OK'
ui_w_settings: 'Settings'
ui_w_menu: 'Menu'
ui_w_scan: 'Scan'
ui_w_photo: 'Photo'
ui_w_save: 'Save'
ui_w_cancel: 'Cancel'
ui_w_share: 'Share'
ui_aria_back: 'နောက်သို့'
ui_aria_search: 'ရှာ'
ui_aria_new_buyer: 'ဝယ်သူအသစ်'
ui_btn_edit: 'ပြင်မယ်'
ui_buyers_title: 'ဝယ်သူများ'
ui_buyers_more: 'နောက်ထပ် {n} ယောက် · ရှာပါ'
ui_buyer_title: 'ဝယ်သူ'
ui_buyer_new_title: 'ဝယ်သူအသစ်'
ui_buyer_edit_title: 'ဝယ်သူ ပြင်ရန်'
ui_buyer_history: 'ဝယ်ယူမှု မှတ်တမ်း'
ui_lbl_name: 'နာမည်'
ui_lbl_phone: 'ဖုန်း'
ui_lbl_note: 'မှတ်ချက်'
ui_lbl_money: 'ငွေ'
ui_lbl_bought: 'ဝယ်ပြီး'
ui_lbl_paid: 'ပေးပြီး'
ui_lbl_owed: 'ကျန်'
ui_lbl_deposit: 'စရံ'
ui_lbl_last: 'နောက်ဆုံး လာချိန်'
ui_lbl_visits: 'လာသည့် အကြိမ်'
ui_lbl_date: 'ရက်စွဲ'
ui_lbl_time: 'အချိန်'
ui_lbl_what: 'အကြောင်း'
ui_lbl_amount: 'ငွေ'
ui_lbl_item: 'ပစ္စည်း'
ui_lbl_qty: 'အရေအတွက်'
ui_lbl_unit: 'စျေး'
ui_lbl_price: 'ရောင်းစျေး'
ui_lbl_stock: 'လက်ကျန်'
ui_val_have: 'ရှိ'
ui_val_sold: 'ရောင်းပြီး'
ui_lbl_buyer: 'ဝယ်သူ'
ui_lbl_method: 'ပေးနည်း'
ui_lbl_total: 'စုစုပေါင်း'
ui_lbl_due: 'ပေးမည့်ရက်'
ui_lbl_receipt: 'ဘောက်ချာ'
ui_lbl_transfer: 'ငွေလွှဲရန်'
ui_lbl_address: 'လိပ်စာ'
ui_lbl_revenue: 'ရောင်းရငွေ'
ui_lbl_pieces: 'ထည်'
ui_lbl_cash_in: 'ငွေလက်ခံ'
ui_lbl_expenses: 'ကုန်ကျ'
ui_lbl_profit: 'အမြတ် (ခန့်မှန်း)'
ui_lbl_drawer: 'ငွေသား'
ui_lbl_bank: 'ဘဏ်'
ui_sold_title: 'ရောင်းပြီး'
ui_receipt_title: 'ဘောက်ချာ'
ui_receipt_share: 'ဘောက်ချာ Share မယ်'
ui_receipt_print: 'PDF / Print'
ui_entry_title: 'မှတ်တမ်း အသေးစိတ်'
ui_hist_pending: 'မပို့ရသေး'
ui_hist_undone: 'ပယ်ဖျက်ပြီး'
ui_hist_more: 'နောက်ထပ် ကြည့်မယ်'
ui_hist_today: 'ဒီနေ့'
ui_hist_yesterday: 'မနေ့က'
ui_undo_until: '{time} အထိ ပြန်ဖျက်နိုင်ပါသည်'
ui_sketch_title: 'ကိုယ်ပုံ'
ui_sketch_female: 'အမျိုးသမီး'
ui_sketch_male: 'အမျိုးသား'
ui_sketch_pen: 'ဆွဲ'
ui_sketch_eraser: 'ဖျက်'
ui_sketch_clear_ask: 'ကိုယ်ပုံပေါ်က ရေးထားတာ အကုန် ဖျက်မလား?'
ui_sketch_full: 'ကိုယ်ပုံ ပြည့်သွားပါပြီ · တချို့ကို ဖျက်ပြီးမှ ဆက်ရေးပါ'
ui_ai_title: 'AI'
ui_ai_nb: 'စာအုပ်'
ui_ai_voice: 'အသံ'
ui_ai_photo: 'Photo အမည်'
ui_ai_off_hint: 'AI ပိတ်ထားပါသည် · ဖောင်တွေကို လက်နဲ့ ဖြည့်ပါ'
ui_ai_owner_only: 'ဆိုင်ရှင်သာ ပြောင်းနိုင်ပါသည်'
ui_shops_title: 'ဆိုင်များ'
ui_shop_title: '{shop} · {id}'
ui_lbl_shop_name: 'ဆိုင်အမည်'
ui_shop_name_needed: 'ဆိုင်အမည် ထည့်ပါ'
ui_shop_saved: 'ဆိုင် အချက်အလက် သိမ်းပြီး · ပို့ပြီးရင် ဖုန်းတိုင်းမှာ ပြောင်းပါမည်'
ui_shop_no_address: 'လိပ်စာ မထည့်ရသေး'
ui_pending_setting: 'Settings {label}'
ui_back_again: 'ထွက်ရန် နောက်တစ်ခါ ထပ်နှိပ်ပါ'
ui_copied: 'ကူးပြီးပါပြီ'
ui_aria_backspace: 'ဖျက်'
ui_sketch_undo: 'မျဉ်း ပြန်ဖျက်'
ui_pending_pics: 'ပုံ {n} ခု'
ui_ai_hint: 'AI ဖွင့်ထားရင် စာအုပ်က လက်ရေး စာအုပ် ဓာတ်ပုံကို စာရင်း ဖတ်ပေးပါသည်၊ အသံနဲ့ မှတ်နိုင်ပါသည်၊ Photo ကြည့်ပြီး ပစ္စည်းအမည် ပေးပါသည်'
ui_lbl_cat: 'အမျိုးအစား'
ui_lbl_held: 'လက်ခံထား စုစုပေါင်း'
ui_lbl_basket: 'အတူ ဝယ်သည်'
ui_lbl_shop: 'ဆိုင်'
ui_lbl_staff: 'ဝန်ထမ်း'
ui_lbl_device: 'ဖုန်း အမည်'
ui_lbl_letter: 'ဘောက်ချာ စာလုံး'
ui_lbl_version: 'ဗားရှင်း'
ui_lbl_state: 'အခြေအနေ'
ui_lbl_last_sync: 'နောက်ဆုံး ပို့ချိန်'
```
Revision 2's NEW `ui_photo_retake` gets the draft 'Photo ပြန်ရိုက်' (it was '🔄 ဓာတ်ပုံ ပြန်ရိုက်'). Review r3 (UX-m5) changes
three drafts of this block (`ui_lbl_qty` 'အရေ', which read alone means "skin", becomes 'အရေအတွက်', the word of
`ui_keypad_qty`, app_i18n.js:33; `ui_ai_photo` and `ui_pending_setting` use F8's 'Photo' and 'Settings') and two of 9.3
(`ui_home_scan_hint` and `ui_tag_scan_new` say 'Scan လုပ်', the word of `scan_first`, core_messages.js:74, next to the
'Scan' button), and adds the last sixteen keys above: `ui_lbl_cat` from `btn_item_cat` (revision 2), `ui_lbl_held` from
`dep_done` (core_messages.js:110), `ui_lbl_shop` from `ui_shop_short` (app_i18n.js:14), `ui_lbl_letter` from `ui_device`
(:131), `ui_lbl_version` from `ui_version`, `ui_lbl_last_sync` from `ui_sync_last` (:78), `ui_aria_backspace` from
`ui_sketch_eraser`; the others are drafts. Each of them was grepped free in apps-script/, app/, poc/ and tools/ and in this
file on 2026-11-13. Every key was grepped in
MSG, APP_MSG and SYNC_MSG on 2026-11-13 and is free. Their words: `btn_customers` for ui_buyers_title; `cust_card`
(core_messages.js:152: ဝယ်ပြီး, ပေးပြီး, ကျန်, စရံ, နောက်ဆုံး, ကြိမ်) for the buyer labels; `receipt_total` and
`receipt_customer` (:122-123) for the receipt labels; `today_query` (:87) for the day labels; `ui_history_title` and
`ui_history_empty` for the history; `receipt_transfer` (:406) for ငွေလွှဲရန်; `btn_notebook` (:40) and `ui_btn_voice` for
the AI parts; `ui_settings_title` ('ဆက်တင်') for ui_pending_setting; `ui_btn_clear` and `btn_remove_line` for the tools; the
rest are drafts. No key is deleted; the keys the app stops using (`ui_btn_ok`, `ui_btn_close` in the sheets, `ui_btn_send`,
`ui_text_placeholder`, `ui_btn_share`, `ui_btn_photo`, `ui_meas_notes`, `ui_meas_save`, `ui_settings_title`, `ui_btn_scan`,
`ui_btn_menu`, `ui_voice_flag`) stay as harmless rows.

Build note (2026-11-13, finding 7 of the build's review): `ui_lbl_last` and `ui_lbl_visits` are built as
'နောက်ဆုံး လာချိန်' and 'လာသည့် အကြိမ်' (app/app_i18n.js:207-208), as the block above now reads, not as the first
drafts 'နောက်ဆုံး ဝယ်ချိန်' and 'လာဝယ်သည့် အကြိမ်'. Their values come from `customerSummaryMap` (core_ledger.js),
which counts every day with a live row of the buyer, payments and deposits too, as `cust_card` and the Customers tab do,
so the labels say "last came" and "times came", not "bought". mockup.html's buyer page reads the same; 13.6's sketch
and its label list still show the first drafts.

### 13.15 Tests of revision 3

Every new check is red without its feature ("fails without" names that code). The labels come from MSG / APP_MSG.

**poc/run_wizard.js** (step 1, appended after W33):

| Step | Checks | Fails without |
|---|---|---|
| W34 The app's pages in the core | a world whose `ports.ui` records `openScreen` and `openForm`: `M\|cust` → `openScreen('buyers')`, no message, no state; `CH\|C-0001` → `openScreen('buyer', {customerId: 'C-0001'})`; `RC\|<g>` → `openScreen('receipt', {groupId})`; without `ports.ui` (Telegram) all three answer today's texts byte for byte; the menu of a form-mode app world has `M\|restock` right after `M\|meas`; the Telegram menu has no `M\|restock`; `M\|restock` → `openForm('restock')` | `screensInApp`, the three hooks, the restock rule |
| W35 customerCheck / commitCustomer | each code in order (empty name; 5 digits; another customer's phone; an exact name for a new buyer, which `forceNew` passes; the edited buyer's own phone and name pass); `commitCustomer` normalises a valid phone, keeps an odd one as typed, cuts the name at 60 and the note at 100; an edit writes only the changed fields (a store spy) | the two functions |
| W36 View hints | a recording chat port with `ports.ui`: `sendItemCard` passes `{view: {kind: 'item', id}}`, the sold card `{kind: 'sold', id: <g>}`, `answerToday` `{kind: 'today'}`, `case 'T'`'s refusal its `ret_credit_open` line in `extra`; review r3: `R|` on a stock item, a payment (`PA|`), a deposit (`DN|`) and an expense (`EM|`) each pass `{view: {kind: 'group', id: <their group>}}`; without `ports.ui` no extra argument at all | the hints |
| W37 Measurement core | `CFG.MEAS_FIXED_COLS` ends with 'Sketch'; `saveMeasurement` passes `sketch`; `MF\|<saved id>` then `MK` keeps the sketch and the photoUrl; `measurementReport` of a session with a sketch and a photoUrl has `image`, no 'စာရွက် ဓာတ်ပုံ' row and its note row once, a PHOTO session (no sketch) keeps 'စာရွက် ဓာတ်ပုံ' and its margin note under 'မှတ်ချက်', and a session whose notes hold 'fix of M-…' prints that part as 'ပြင်ဆင်ချက်' and the rest as 'မှတ်ချက်' (review r3, M-5, m-2); `MM\|copy` of a session with a sketch keeps the sketch and the photoUrl (m-15); `startMeasureFor` with a newest session that has a sketch shows `ms_sketch_line` and `MP\|<id>` | the sketch pass-through, the report rules, the line |
| W38 The AI switch | `aiOn` reads ON for a missing row, 'TRUE', 'yes'; OFF for 'FALSE', 'false ', 0, false; with `ai` FALSE: a Telegram voice note answers `ai_off` and the mock AI's call count is unchanged; a typed sentence the same; a photo of a blank tag gives the card with 'ပစ္စည်း <id>' and no `describePhoto` call; the menu has no `M\|nb` although `notebook_import` is TRUE and `M\|nb` answers `nb_off`; the measurement method row has no photo button; with `ai` TRUE and `notebook_import` TRUE the app's menu has `M\|nb` (the notebook stays in the app) | `aiOn` and every gate of 13.11 |
| W39 Revision-3 texts | every key of 13.14's MSG block is in MSG, non-empty and equal to the block (parsed from this file) | the keys |

**poc/run_sync.js** (step 2, appended after R6f):

| Step | Checks | Fails without |
|---|---|---|
| R6g The setting entry | the owner's phone sets `shop_name_S1` offline: the local Settings change at once, one outbox `setting` entry; pushed: ok, the server's Settings hold it; a second phone's pull carries it; the same value again is `dup`; a seller's entry is quarantined `staff`; an unknown key, a 41-character name and `ai` = 'maybe' are `malformed`; `ai` = 'FALSE' from the owner is ok and the second phone's `aiOn` reads OFF after its pull; a pull made while the entry waits does not undo the local value (re-apply); review r3, M-8: with `setting` left out of `SYNC.ENTRY_KINDS` (an older server, as M9 does, run_sync.js:1449-1456) the answer is `bad_kind` without `kindKnown` and the entry stays in the outbox; a server store without `setSetting` answers `bad_kind` WITH `kindKnown`, the entry is dropped and the settings hash cleared; a stored 'true' meets 'TRUE' as `dup` | the entry kind, `syncSettingReason`, the re-apply |
| R6h A drawing on the wire | a measurement entry with a valid `sketch` is stored and pulled back with it; one without a sketch is pulled without the key; a `sketch` of 4001 characters, a bad pattern and a number are each `malformed`; a `note` of 300 characters is accepted and 301 refused (the 60 rule of `neck` still refuses 61) | the sketch rules, the note limit |
| R6i Jobs on the server twin | a job `{kind: 'sketch', entryId}` for a stored session sets that session's photoUrl and answers `done` with it; a job whose entry is unknown answers `failed` with `no_session`; with `ai` FALSE a `photo` job answers `failed` with `ai_off` and the hook is not called, while a sketch job still runs; review r3, M-1: a `pic` job for a stored item sets its photoUrl and answers `done` with it, also with `ai` FALSE, without the AI's describe call (a counting stub), and one for an unknown item answers `failed` with `no_item`; a sketch's `no_session` writes no Errors row (M-2) | the `sketch` branch of poc/sim_sync.js, `syncHandle`'s rules |

**poc/run_gas.js** (step 2, appended before section 17):
- 29: `gasStore.setSetting` writes an existing key in place and appends a new one; `getSetting` reads it at once; review
  r3, M-3: '09123456789' is read back as the string '09123456789', '+95 9 777' as itself and 'TRUE' as the string 'TRUE'
  (the cell's number format is '@'). Fails
  without `setSetting`.
- 30: `addMeasurement` with a sketch on a Measurements tab without the column appends `Sketch` and reads it back; a session
  without one leaves the cell blank; `findMeasurementByEntry` and `setMeasurementPhoto` find and write the PhotoURL of that
  row only. Fails without the column and the two members.
- 31 (source checks; DriveApp and the image API are not modelled, run_gas.js:319): `gasSyncHooks().ai` has a `sketch`
  branch that calls `findMeasurementByEntry` and `setMeasurementPhoto` and no Gemini call, and a `pic` branch that calls
  `updateItem` with the photoUrl and no Gemini call (review r3, M-1); `gasPdf.make` calls `getImages` and `insertImage`,
  the latter before `SpreadsheetApp.flush` (m-10). Fails without them.
- 32: setupSheet appends `ai | TRUE` when missing (and keeps a typed FALSE), notes the `ai` Key cell with `settings_note_ai`
  and the eight shop Key cells with the four `settings_note_shop_*` texts, and gives the Settings tab one conditional-format
  rule whose formula names the shop keys over columns A:B with the background '#e3e7f7' (read through the fake's
  `rules()`, review r3, M-4); a second setupSheet leaves one rule; a value the family typed is kept; nothing is logged to
  the Errors tab. Fails without the AI row and the Shops block.

**poc/run_app.js** (step 3, `round6()` continued after step 56):

| Step | Checks | Fails without |
|---|---|---|
| 57 Icons and plain text | every name of 13.2's table is in `APP_ICONS`; `appIconSvg('arrow-left')` has `viewBox="0 0 24 24"` and `stroke="currentColor"`; `appPlain` cases ('💵+🏦 ခွဲပေး' → 'ခွဲပေး', '✓ ပို့ပြီး' → 'ပို့ပြီး', '⌃ မှတ်တမ်း' → 'မှတ်တမ်း', '1. S1-0002 × ၂' unchanged, two lines each stripped); review r3, UX-M6: the cases of 13.1 rule 2 ('💰 👤 {customer} · …', 'ကျေးဇူးတင်ပါသည် 🙏', '🎤/📸 …', ' (⏰ {n} ရက် လွန်)', ' (နမူနာ)' kept with its space, 'PDF → Telegram' kept), and for EVERY key of MSG and APP_MSG `appPlain` of its text holds no match of `APP_EMOJI_ANY` and no U+FE0F; `APP.tt('btn_undo')` is plain and `appJobRow` keeps '🛒 ရောင်းမယ်' (`APP.ttRaw`) | `app_icons.js`, the `tt` switch |
| 58 Header and bottom bar (fakeDocument) | home scanner state: `#back` hidden; the history screen: shown, `#shopName` = 'မှတ်တမ်း'; the chip for synced / 3 waiting / offline / red carries the icon of 13.3, the badge '၃' only while waiting, `aria-label` = the plain state text; `#gear` `aria-label` 'Settings'; `#btnScan` reads 'Scan' and `#btnMenu` 'Menu' with their icons; the bottom bar is hidden on the history screen; review r3: the red banner's ကြည့်မယ် opens the sync screen with `#back` shown; the enrol screen hides `#back`, and gear → Settings → ← returns to the enrol screen without a throw; the chip's `aria-label` and the sync screen's rows hold no emoji; the recent tiles show no category emoji | `appPaintChrome`, `appRenderHeader` |
| 59 The nav stack | (review r3: a stubbed `win.history` records `pushState`, `back` and `go` and fires `popstate` on a later tick with the target entry's state) open buyers → buyer → receipt: three screen layers and entries `salestag` 1, 2, 3; back three times walks back to the home; a sheet over a form closes first; a dirty form asks once and, on no, stays with its layer and its entry is pushed again; UX-B1: two layers, Scan (ONE `go(-2)`, one popstate), then a scan opens a form, then one back closes the form; a popstate that lands two entries down (a skipped entry) closes two layers; UX-M2: the tag keypad's 4th digit (a drop, then a form opened before the drop's popstate) ends with the history at the stack's depth; the buyer form's Save replaces its layer by the buyer page with no history call; `appCloseOverlay()` with no sheet open calls no `back`; UX-M1: a home scan, Save: `#back` shown (a `card` layer), ← from the sold card's receipt returns to the sold card, back again gives the scanner; a form opened from an item card and closed without Save shows that card; UX-m2: boot on an entry `{salestag: 3}` calls `go(-3)` once; UX-M4: the first `pointerdown` on the first entry pushes `{salestag: 0, guard: true}` once; a back with nothing open toasts `ui_back_again`; with `noHistory` back pops directly and no guard is pushed; a menu tap pushes `card`, and back from it clears a waiting state (`M\|find`, then back: no state); Scan clears every layer; M-11: the stub APP of step 29 (no `nav`, no `opts`) saves and closes the measurement form without a throw | the nav section of `app_screens.js` |
| 60 No chat box | `M\|find`: the bar is an `input[type=search]` with a search icon button and no 'ပို့'; an `await_text` state: a `label` holding the question (plain) and an 'OK' button; a report document card with a waiting state: no bar; an item card with a view and a waiting state: no bar; no element anywhere carries `ui_btn_send`'s text | `appInputBar` |
| 61 History | after a basket sale, a restock, a new piece, an expense and an undone sale on this phone and a Telegram sale by the same staff: the rows are this phone's five, newest first, the basket '… +၂', the new piece '+၃ ထည်', the undone one `ui_hist_undone`, the unsynced ones pending; after a sync no row is pending; the Telegram sale is absent; an 8-day-old group appears only after `ui_hist_more`; a sale row opens the receipt page, a restock row the entry page with the undo button; 31 minutes later no undo button; the undo button's act writes the mirrors and the home shows `undo_done` | `appHistoryRows`, the entry page, `appScreenAct` |
| 62 Buyers list | the order (this shop's recent buyers first), a search by name and by four digits, the 60-row cap with `ui_buyers_more`, the owed marker; `+` opens the buyer form | `appBuyersRows`, the page |
| 63 Buyer form | each refusal of `customerCheck` in `.fmsg`; a new buyer queues one `customer` entry and opens its page; an edit queues a `customer` entry with the new phone; after the sync the server's Rev for that customer grew and the phone's record has it (`setCustomerRev`); the known-phone chip opens that buyer | `appBuyerSave`, the sync path |
| 64 Buyer page | the `.kv` rows of a buyer with a credit and a deposit; the history table from `customerRows` (a basket is one row); `PY\|` for one credit, `PL\|` for two; `MS\|` opens the measurement form and pushes no card layer; `DC\|` shows the deposit prompt on a card layer and back returns to the buyer page; review r3: the history row of a basket with a part payment has the item on its first line, the tag 'ရောင်း' and the pairs 'ပေးပြီး' / 'ပေးနည်း', and no '·' in its cells; a measurement saved from `MS\|` toasts `meas_saved_form` (plain) and returns to the buyer page | the page, `appScreenAct`'s card rule |
| 65 Receipt | the rows of a basket with a part payment, the letterhead lines when Settings have them; `appReceiptText` equals the expected lines (no emoji); Share calls `navigator.share` with it; PDF / Print calls `win.print`; without `print`, `requestReport('receipt')` is called; the void row only for the owner's basket; the undo row only within 30 minutes; review r3, UX-m4: an undone sale's receipt shows `ui_hist_undone` and no Share, Print, undo or void, and every action sits inside `.rc-actions`; without `navigator.share` Share copies and toasts `ui_copied` | `appReceiptView`, `appReceiptText`, the actions |
| 66 Views | the item view of a SKU, of a sold one-of-a-kind piece with its buyer, of a pending price; the sold view of a three-line basket; the today view of the owner (two shops); the keyboard under a view keeps `data-cb` on `.kb .row button`; a Z button and an `SS\|…\|z` button both read 'Cancel'; the menu card keeps its emojis; review r3, UX-M8: the `group` view of a three-line restock (a table), an expense, a payment (with the owed after it) and a deposit (with the held total); a mixed sale's sold view has 'ခွဲပေး' and one row per method; the item view of a piece sold in a basket has 'အတူ ဝယ်သည်'; the stepper's label at a count of 1 has no emoji (m-14) | the builders, `appRenderMsg` |
| 67 One note | the form draws one textarea for `note` (maxlength 300) and no second box; `appMeasNoteMerge` cases (empty notes; notes only; both joined with ' · '; cut at 300; no active `note` field); a restored round-4 draft with notes opens with them in the note box and saves them in `fields.note` with `notes` ''; review r3, UX-m3: with the `note` row hidden the restored notes are saved as `notes` | the note field, the merge |
| 68 Figure helpers | encode/decode round trip for F and M; the 2-unit rule; erase removes the touched stroke only; 61 strokes or 4001 characters refused; `appSketchDecode` of a bad text is null; `appSketchUndo` drops the last stroke only (review r3, UX-M5) | the pure part of `app_sketch.js` |
| 69 Figure save and sync | a drawing alone is refused `empty` and nothing is queued, a drawing with the note filled saves (review r3, B-1); outside draw mode a pointer sequence on the pad adds no stroke, `sk:draw` then the same sequence adds one (UX-M5); a stubbed `makeCanvas` and a global `Path2D` stub (m-11) yield one queued `sketch` media record; the outbox `rec.sketch` and the local record carry it; a stubbed canvas yields one queued `sketch` media record with the entry's id; `flushAiJobs` sends no `ai` call while the measurement entry waits and sends it after the ack, also with AI off; the server stub's `no_session` keeps it queued with `retryAfterUntil` and the fifth makes it `failed` (M-2); a quarantined measurement entry fails that customer's sketch job at once (M-2); a failure adds no `ai_down` line; a finished sketch job leaves a waiting voice job's ⏳ line (m-5); the form opened again shows the drawing (prefill), also from a pulled session | the save path, the hold, the failure rules |
| 70 Shops | the owner's Settings list both shops, a seller's none; the shop form saves only the changed keys as `setting` entries; the header shows the new name before any sync | the Shops section, `appShopSave` |
| 71 The AI switch on the phone | the owner's toggle OFF queues one `setting` (`ai` FALSE), hides 🎤 and 📒 at once and a new-piece Save queues no photo job; ON queues three (`ai`, `notebook_import`, `app_voice` TRUE) and shows them; a seller's toggle is disabled with `ui_ai_owner_only`; with AI off `flushAiJobs` sends no voice or photo job and sends a sketch job; review r3, M-1: with AI off a new-piece Save with a photo queues one `pic` job (no `photo` job), which after the item's ack sets the item's photoUrl on the server twin; M-12: a voice job queued before the switch went off becomes `skipped`, and the chip reads synced with no badge | the switch, the gates on the phone |
| 72 The menu in the app | form mode: `M\|restock` on the menu and its tap opens the restock form; with AI off no `M\|nb` | the menu rules on the phone |

**poc/check_simulator.js** (step 4): a new 5c: the three new files are in `FRAME_FILES` (the existing :87 check covers the
order); the frame shell has `id="back"`; BOOT passes `noHistory: true`; the frame's `screen` op calls `appNavReset()`
(review r3, UX-M3); `SIM_FRAME.mark` and `pick` also match a button's
plain text (`appPlain`); the smoke's back step clicks `#back`.

**SIM.smoke** (step 4): the two steps at poc/sim_ui.js:1398-1427 keep their meaning; :1416 still presses `button.handle`
(now the history page) and :1421 clicks `#back` instead of `.pagehead .ghost`, as `{op: 'click', sel: '#back'}` with no
`key` (review r3, m-4: `pick` filters by the key's label text, build_simulator.js:128-132, and the icon-only `#back` has
none). The tour engine's pre-step mark (sim_ui.js:631, `{sel: '.pagehead .ghost'}`) becomes `{sel: '#back'}` (UX-m7).

**Existing checks that change** (added to 10.8):

| File:line | Label (today, short) | Change | Step | Why |
|---|---|---|---|---|
| poc/run_app.js:497 | 'the customer card carries 📏 = MS\|<customerId> as its last row' | the `CH\|` tap in the app emits one `openscreen` `{name: 'buyer', req.customerId: C1}` and sends no message; the label says the buyer page offers 📏 | 3 (review r3, M-6: it needs step 3's `ui.openScreen`, app_ports.js:181-183) | F5 |
| poc/run_app.js:1101 (revision 2's setup with `D\|S1-0001`) | 'SIM_HOT marks exactly the button with that callback' | the hot button's text equals `appPlain(MSG.btn_discount)` | 3 | F7 |
| poc/run_app.js:1172 | 'the stepper's data-cb follows the count…' | the text equals `APP.tt('ui_sell_n', …)` (plain) | 3 | F7 |
| poc/run_app.js:1183 (setup of 1196) | the bar's open button found by `t(…, 'ui_type_number_bar')` | found by `APP.tt('ui_type_number_bar')` | 3 | F7 |
| poc/run_app.js:1196 | 'the other number prompts … keep the first line as the title' | expected `['the header line', 'the header line']` (the title is plain) | 3 | F7 |
| poc/sim_ui.js:1421 | the smoke's back click | `{op: 'click', sel: '#back'}`, no `key` | 4 | F6 |
| poc/check_simulator.js:141 | 'a tour on an enrolled phone away from its chat screen waits for the back button …' | the BOOT regex `/case 'screen': APP\.screen = /` becomes `/case 'screen': appNavReset\(\)/` | 4 | F6 (review r3, UX-M3) |

**Why everything else stays green**: Telegram texts and keyboards are unchanged (no `ports.ui`); the views add `m.view`
and change no `m.text` or `m.keyboard` (run_app.js:642 reads the keyboard); `appInputModeFor` is unchanged (run_app.js:163,
:506, :512, :639, :720); the measurement helpers keep `notes` (run_app.js:564-618, 734-760, 821; run_sync.js:974-1022;
run_gas.js:1221-1239); a session without a drawing is pulled with today's keys (run_sync.js:1121); the seeds have no `ai`
row, so `aiOn` reads ON and every AI path of today's suites runs as before (poc/sim_seed.js:69 keeps `notebook_import`
TRUE, so the menus that list 📒 still list it); the menu rows of Telegram worlds are unchanged (run_round4.js:964, :1126,
:1726, :1786, :1823; run_scenario.js:202), and the app world of run_app.js:492 runs on quick, where `M|restock` is not
offered; `SIM_FRAME.label` stays raw, so check_simulator.js:252 and sim_ui.js:1414-1418 hold. Expected after the round, on
top of 10.9: run_wizard about +45, run_sync about +28, run_gas about +13, run_app about +120, check_simulator about +7
(review r3 included). Review r3 also keeps these green: the stub APPs of run_app.js:754-758 and :880-883 and
check_simulator.js:235 (the nav functions and `snap` are null-safe, 13.4); the pending-line checks run_app.js:596, :651
and :830 (app_sync's texts stay raw, 13.1 rule 3); run_scenario.js:1166-1167 (the margin note keeps 'မှတ်ချက်', 13.7.1);
run_gas.js:1302, :1306 and :1318 (`addMeasurement` appends `Sketch` only with a drawing; setupSheet appends it once);
run_gas.js:472 (the Shops colour is a modelled conditional-format rule, 13.12).

### 13.16 Build steps and ownership, revision 3

Section 11 keeps its five steps; each takes these files and regions in addition (nobody edits outside the list).

1. **Core**: `apps-script/core_config.js` (`aiOn`; `MEAS_FIXED_COLS` + 'Sketch'; `MEAS_NOTE_KEY`, `MEAS_NOTE_MAX`,
   `CUST_NAME_MAX`, `CUST_NOTE_MAX`, `SHOP_TEXT_MAX`); `core_ledger.js` (`customerCheck`, `commitCustomer`); `core_bot.js`
   (`screensInApp`; the hooks of `showCustomers`, `customerCard`, `sendReceipt`; the menu; `menuAction` 'restock';
   `startNotebook`; the AI gates of `handleVoice`, `handleText`, `handlePhoto`, `measMethodRow`, `measMode`; `customerRows`;
   the view hints, with the `group` hints of 13.9; `startMeasureFor`'s line; `measFix`'s and `MM|copy`'s sketch); `apps-script/core_orders.js` (NEW to step 1:
   `saveMeasurement`'s sketch, `measurementReport`'s note split and its image and sheet-photo rows decided by `sketch`); `core_sync.js` (the `setting` kind,
   `syncSettingReason`, `SYNC.SETTING_KEYS`, the note limit, the sketch rules, `syncMeasPage`'s sketch, `syncHandle`'s sketch
   and pic results, the `ai_off` refusal and the unlogged `no_session` / `no_item`, the ack rules); `core_messages.js` (13.14's MSG block); `apps-script/gas_setup.js` (the
   `ai` default, the AI and Shops notes and the Shops conditional-format rule, after :79); `poc/run_wizard.js` (W34-W39); `poc/run_app.js` (revision 2's
   step-1 edits only; review r3, M-6 moves the :497 edit to step 3).
2. **Glue and sync**: `apps-script/gas_store.js` (`setSetting`, writing a plain-text cell; the Sketch column in `addMeasurement` and `gasMeasFromRow`;
   `findMeasurementByEntry`, `setMeasurementPhoto`); `apps-script/gas_sync.js` (the `sketch` and `pic` branches of `hooks.ai`);
   `apps-script/gas_pdf.js` (the image, its blank rows, before `flush`); `poc/sim_sync.js` (`hooks.ai` sketch and pic); `poc/sim_ports.js` (`setSetting`, `sketch`
   kept by `addMeasurement`); `poc/sim_phone.js` (`local.setSettingLocal`, the re-apply, `sketch` in the local measurement
   record); `poc/fake_gas.js` (only if a member is missing, named in the report); `poc/run_sync.js` (R6g-R6i);
   `poc/run_gas.js` (29-32 and the member tables).
3. **App**: `app/app_icons.js`, `app/app_sketch.js`, `app/app_screens.js` (new); `app/app_forms.js`, `app/app_ui.js`,
   `app/app_ports.js`, `app/app_store.js`, `app/app_sync.js`, `app/app_i18n.js`, `app/app.css`, `app/index.html`,
   `app/vendor/tabler-icons-LICENSE.txt` (new), `app/dev/index.html`; `tools/build_app.js` (`APP_FIRST` only);
   `poc/build_simulator.js` (`FRAME_FILES` only); `poc/run_app.js` (`FILES`, :497, :1101, :1172, :1183, :1196, steps 57-72). Review r3, M-7: step 3 runs after step 2
   (run_app 69-71 sync against step 2's poc/sim_sync.js and poc/sim_ports.js).
4. **Simulator**: `poc/build_simulator.js` BOOT (`noHistory: true`; `mark` and `pick` match plain text; the `screen` op through
   `appNavReset`, review r3; `snap` adds `nav: (APP.nav || []).map(kind)` and `screenArg`); `poc/sim_ui.js` (:631, :1421; a tour that tapped the customer card or the receipt card on
   the app uses the pages' `data-f`); `poc/sim_tours.js`; `poc/check_simulator.js` (5c, :141).
5. **Docs**: `docs/USER-GUIDE.html` also says, plainly and in Burmese, the two answers the owner did not give
   (FEEDBACK-1.md, the paragraph before the amendment): **a piece from a sale that still owes cannot be returned by a
   seller** (the card says `ret_credit_open`; the owner voids the sale from its receipt or takes the payment first), and
   **scanning a piece that is already in the basket does not add another; the + on its line does**. It also shows the
   buyers page, the history, the receipt's two buttons, the figure, the AI switch and the owner's Shops screen, and says
   (review r3, UX-m6, UX-m8, UX-M4) what 📒 စာအုပ် does (a photo of a seller's handwritten notebook page is read by the photo
   AI, each line becomes a proposed entry the seller confirms; it shows only while AI is on), where restock is under
   `quick` (the scanned piece's 📦), and that on the home a first back shows "press again" and a second leaves the app.
   `apps-script/README.md` names the `ai` row, the Shops block of the Settings tab and the Measurements `Sketch` column.

### 13.17 Deliberately not built in revision 3

- **A third shop** (and renaming the ids S1 / S2): the ids live in tags (`S1-0001`), callbacks, the Lists' Shop column and
  `CFG.SHOP_IDS` (core_config.js:21); the owner did not ask for a third shop.
- **Tapping a body area of the figure to jump to its field** (F2's optional nicety): a tap on the drawing must stay a dot;
  a separate mode would be one more control to learn.
- **The figure as a photo in Telegram**: Telegram shows it inside the measurement PDF (`MP|`); no `sendPhoto` of the Drive
  file. **Editing a figure in Telegram**: a Telegram fix keeps the drawing as it was.
- **An AI switch inside Telegram** (a command or a button): the owner flips it in the app or in the Sheet; the bot obeys
  it. **Per-feature AI switches in the app**: the Sheet's `notebook_import` and `app_voice` rows still do that (the
  switch's ON writes both TRUE on purpose, 13.11; review r3, m-13).
- **The shop's letterhead brand in the app** (`shop_brand_*`): the Sheet's Shops block only.
- **A ➕ new buyer and a buyer edit in Telegram's 👤 list**: there, buyers are still created inside a sale, a credit, a
  deposit or an order, and edited through 📱 (`CF|`).
- **📦 in Telegram's menu**: a restock in Telegram starts from the scanned piece's card. Left to the owner (review r3,
  UX-m6): if F12's "main menu" means Telegram's too, one button `M|restock` in `showMenu`'s extra row and a Telegram
  `menuAction` case that asks for the tag are added, and run_round4.js:964 and :1126 (which pin today's rows) join 10.8.
- **Measurement sessions in the history** (review r3, UX-m9): the phone keeps only each buyer's newest session, with its
  day but no time and no device (app_store.js:484, :496), so it cannot list what this phone saved; a save says so with a
  toast (13.7.1), and the buyer page's 📏 opens the newest session.
- **Changing an existing piece's photo from the app**: the card state's Photo handle is deleted (1.1; it changed the last
  scanned piece silently and its 'local://' photo never reached the server); Telegram's photo after a scan still does it.
- **A camera scan before the first tap of a fresh start** (13.4): Chrome may skip the form's entry, so the first back can
  leave the app; the form's draft brings the basket back at the next 🛒 or scan.
- **A Telegram fix made before the drawing's PNG reached the server**: it copies an empty PhotoURL, so its PDF prints
  without the figure (the strokes are kept); the next app save of that buyer renders a new PNG.
- **A rollback of the bot below round 6** (review r3, m-12): an older server stores a session without its `sketch` (the
  drawing is lost) and refuses a `note` over 60 characters as `malformed`, after which the phone deletes the session
  (core_sync.js:503, app_store.js:520-527); no sync cap guards it. A rollback takes the app back with the bot.
- **Deleting or merging buyers**; a base Rev for customers (two phones editing one buyer offline keep the later push).
- **The bot chat history in the app** (removed); the rows recorded by the same staff member in Telegram or on another phone
  (the history is this phone's).
- **A list of a buyer's measurement sessions** (the buyer page opens the newest through 📏).
- **Free text to the AI from the app** (no chat box); voice stays behind the AI switch and app_voice.
