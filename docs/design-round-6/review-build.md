# Review of SPEC-round-6.md: tests, removal, simulator and build

Date 2026-11-13. Lens: every removed round-5 behaviour has its tests replaced or moved; every new check fails without
its feature; the existing checks named to change are exactly the ones that must; the simulator tours and smoke steps on
app forms are feasible with the frame transport as built; disjoint file ownership; ES5; the mockup is accurate.
Read: SPEC-round-6.md, mockup.html, map-app-forms.md, map-core-commits.md, map-sim-tests.md, map-basket-readers.md,
and the current tree. Every `file:line` is today's tree. No code or test was changed; the suites were run once
(`node poc/<suite>.js`) to confirm the spec's counts.

Seven major findings, twelve minor ones. The majors are: three simulator steps that cannot run as specified (B1-B3),
a round-5 check marked "kept verbatim" that cannot be kept (B4), two deleted app checks with no successor (B5), and a
reader guard that also catches multi-line custom-order deliveries (B6). The rest is accuracy and housekeeping.

---

## Major

### B1. The `return` tour (and the other tg+app tours) now run on the app, where a scan opens the sale form

- Section: 8.1, 8.4 ("return, payment, takedeposit, order, reports, enrol, stranger | unchanged").
- Evidence: 8.1 makes `doLogin` put a staff login on `app`. `tourStart` runs a tour on the open pane whenever the tour
  lists it (`var dev = tour.devices && tour.devices.indexOf(S.device) >= 0 ? S.device : tour.device`,
  poc/sim_ui.js:993). `return` lists `devices: ['tg', 'app']` and its steps are `tag('S1-0002')`, `start` (tg only),
  `cb('T|S1-0002')` (poc/sim_tours.js:207-213). In form mode a home scan of a sellable own-shop tag opens the sale form
  (1.2 rule 2; 4.4 `openTag` route (3)) and sends no item card. So `T|S1-0002` is never in `snap.last`, and ⏭ answers
  "The button is not on the screen yet." (poc/sim_ui.js:1202-1205). `runTourUnattended` then fails the step after three
  tries (poc/sim_ui.js:1486). The same move puts `reports` (sister, tg+app) on the app, against R8 ("the owner's tours
  ... stay on Telegram and the laptop").
- Fix: on the app, the return tour goes ☰ 🕘 → `K|S1-0002` (the item card, 1.2 rule 3), then `T|S1-0002`. Or the
  return tour keeps `devices: ['tg']`. Decide whether `reports` keeps `devices`. Add a 6b check: no tour that lists
  `app` starts with a `tag` of a sellable own-shop item followed by a `cb` that only the item card offers.

### B2. The `f` steps have no `done` predicate, and nothing reports which control was used

- Section: 8.3 ("Step makers: `ff(name, my, en, more)` ... and `fset(...)`"), 8.4 (only the last step's `done` is
  given).
- Evidence: check_simulator.js:194 requires a `done(evt, ctx)` on every step. BOOT's `lite()` turns only bot updates
  into `ev` events (poc/build_simulator.js:175-184). A form control calls no bot: its only echo is the debounced
  `phone.commit('formdraft')`, which posts `{kind: 'formdraft'}` (app/app_ports.js:241-244) and does not say which control
  was used. A job tile writes no draft at all. `appFormSnap` (7.2) has no field for the last control used. So `ff`/`fset`
  have nothing generic to wait for. The `deposit`, `mixed`, `price`, `restock`, `newitem` and `expense` tours have three
  to seven such steps each. The smoke has a related gap: step 5 of 8.5 reads `form.error` "is `sale_need_buyer`", but
  7.2 does not say whether `error` holds the key or the text.
- Fix: make the done rule part of the contract. Either (a) `appFormSnap` gains `last: {f, n}` (the control name and a
  counter bumped by `appFormSet` and by every DOM handler), with `ff(name)` done = `formHas(f => f.last && f.last.f ===
  name)` and job tiles done = `formIs(kind)`; or (b) each maker takes a value predicate. Also say that `error` is the
  problem's key (`basketProblemText` gives the text), so both transports compare the same thing.

### B3. `{op: 'photo', preset: 'htamein_green'}` cannot resolve inside the frame

- Section: 8.2 (`photo` op), 8.4 (newitem act `{op: 'photo', preset: 'htamein_green'}`).
- Evidence: `SIM_PHOTOS` is defined in poc/sim_seed.js:12. That file is in the page's `FILES` but not in `FRAME_FILES`
  (poc/build_simulator.js:27-28). In post mode the frame has no access to the page's globals at all. The mock AI names
  the piece from `file.meta` (poc/sim_mock_ai.js:195-198), and the job carries the media's `sim` record
  (app/app_ports.js:139-141, app/app_sync.js:374). A key without the record therefore gives the generic name
  'ပစ္စည်းအသစ်', and the manual check "the name renamed after the sync" (10.7) shows the wrong name.
- Fix: the page resolves the key and sends the record: `{op: 'photo', preset: <the SIM_PHOTOS entry>}`, which is plain
  JSON and survives postMessage. The frame builds `{kind: 'photo', sim: {meta, visual, mimeType}}` as `phone.sim.photo`
  does (app_ports.js:285-288). The check_simulator.js 5b check should also cover this.

### B4. run_wizard 1424 is marked "kept verbatim" but pins the removed paid-in-full button, and its replacement has no test

- Section: 10.1 row 22y ("Kept verbatim (V): 1412, 1418, 1424"), 0.3 rule 12, 2.1 paid sub-screen (`p|all`).
- Evidence: poc/run_wizard.js:1420-1424 runs `K.guided(u, ITEM, ['btn_no_name', 'btn_cash'])` and asserts
  `K.sim.buttonByKey(K.last(u), 'btn_paid_all') === 'SC|S1-0002|ok'`. In round 6 the paid screen's first button is
  `SS|<a>|p|all` labelled `btn_paid_full` '💵 အကုန် ပေးပြီး {amount}' (NEW), and `btn_paid_all` stays in MSG unused
  (0.3 rule 12, 9.2). The round-5 checks that pinned that button (167, 169) are O. No W step and no run_app step taps
  `p|all` or reads `btn_paid_full`, on the card or on the app's `paid:full` segment.
- Fix: replace 1424 with W22y: on the paid sub-screen `buttonByKey(..., 'btn_paid_full') === 'SS|S1-0002|p|all'` (the
  label rule still cuts at the first `{`) and `btn_days` still throws. Add to W8: `p|all` returns to the card with
  `part` false and `paid`/`dueDay` cleared. Add to run_app 54: the `paid:full` segment's text is `btn_paid_full` with
  the total.

### B5. The app's keypad and date sheet lose every check, and round 6 depends on both

- Section: 10.3 (step 1 deletes step 33's 947, 950, 954 and step 34 whole, including 1013, 1018, 1020), 1.0 (`.fnum`
  opens `appOpenNumberKeypad`), 1.3 (`due:date` → `appOpenDateSheet(onOk)`), 7.4.
- Evidence: the only run_app checks that press keypad keys and OK, or open the date sheet, are 950-954 and 1012-1020
  (`grep -n "ui_btn_ok\|ui_date_title" poc/run_app.js` → :952, :1012-1013). These include: the sheet's title, an
  `input type=date` with `min` = today, "OK without a date does nothing", and "OK sends yyyy-mm-dd". Steps 41-56 never
  name the keypad or the sheet. 7.4 changes `appOpenDateSheet` to take a callback, which is exactly the path left
  untested. The map flagged it ("AF if the form's 'a date' choice reuses the sheet", map-sim-tests 5.3 step 34).
- Fix: add to step 53 or 54:
  - a `.fnum` tap opens the keypad titled with the field's label above the form (`.overlay` z 34 over `.formpage` 32);
  - '2', '0', '000', OK sets the value; OK is disabled at 0 and the `0` chip covers that case;
  - `due:date` opens the sheet with `ui_date_title`, `type=date`, `min` today and `max` today + 365;
  - OK with no date does nothing; OK calls `onOk` with yyyy-mm-dd and the row reads `sale_due_set`.

### B6. "More than one live SALE row" also catches a multi-line custom-order delivery

- Section: 5 ("A one-line group, a delivery and a mixed one-item sale take today's path byte for byte"), 4.4 (`case
  'U'`/`'V'`, `customerLines`, `cardText`), 4.2 (`openCredits` alone guards `!isOrderId`).
- Evidence: `deliverOrder` writes one SALE row per order line into group = `order.id` (apps-script/core_orders.js:263-272),
  with pseudo item ids `order.id + '-' + line`. A two-line order is therefore "a group with more than one live SALE
  row". The new U/V reply adds "one `group_item_line` per distinct item ... with its stock now", but those ids have no
  Items row. Today's reply guards with `after ? ... : ''` (apps-script/core_bot.js:548-550, :557-559). The new reply
  would read `null.name` and fail inside `handleUpdate`, or print an empty line. `customerLines` would also fold the
  delivery's SALE rows into one 'ရောင်း 🛍 2 ခု' line. No check covers this: W27 builds tag baskets only, and today's
  delivery checks use one-line orders (run_scenario.js:1038-1050).
- Fix: guard every reader branch with `!isOrderId(groupId)`, as `openCredits` does. In the U/V reply, also skip an id
  that `getItem` cannot find. Add W27(i): the U| reply and the customer card of a two-line delivery are today's text.

---

## Minor

### B7. Several "kept verbatim" rows need their setup rewritten; three checks are not in the table

- Section: 10.1 ("Disposition of every round-5 check").
- Evidence:
  - 922 (step 14) is V, but its setup taps `SS|S1-0003|q|9`, `btn_no_name`, `btn_cash` (poc/run_wizard.js:918-921). In
    round 6 the `Q|` grid is quick's `askQty` with `S|<id>|<n>` digits (4.4).
  - Step 21 is "all V", but :1174 drives `A.guided(u, 'S1-0004', [..., 'btn_cash', ..., 'btn_yes'])`, and those buttons
    no longer exist.
  - Only steps 10 and 20 carry "setup through card()".
  - A script that compares the table with every `check(` line of run_wizard.js finds three lines with no disposition:
    901 ("the sister reaches the summary"), 905 (setup check) and 1116 (a `|| true` check).
- Fix: mark 922 and step 21 "setup through card()". Give 901 O (the summary step), 905 V (setup) and 1116 O (it can
  never fail).

### B8. check_simulator.js stays green after steps 1-3 only if the simulator is rebuilt

- Section: 11 (the step checkers), 10.9 ("After step 1 alone ... check_simulator 68").
- Evidence: poc/check_simulator.js:64 asserts `srcdoc === B.buildSrcdoc()`, built from today's core and app sources.
  Its header says `node poc/build_simulator.js && node poc/check_simulator.js` (:4). Steps 1-3 change frame sources, but
  their checkers name only `bundle_gas` and `build_app`.
- Fix: add `node poc/build_simulator.js` to the checkers of steps 1, 2 and 3 (poc/dist is a build output).

### B9. 6b says the deposit tour "ends at an f target", but it ends on the laptop

- Section: 10.6 (6b), 8.4 (deposit: "then the four laptop steps unchanged").
- Evidence: the deposit tour's last steps are the owner's laptop ones, `#postSummary` among them
  (poc/check_simulator.js:214 pins them).
- Fix: "whose sale part ends at `f: save`" (and `close` for back).

### B10. Some new checks pass without their feature

- Section: 10.4 R6c, 10.1 W32, 10.5 section 26.
- Evidence:
  - R6c is labelled "today's server (a pin)" and is green today.
  - W32's `bytes('SS|S1-0002|rm|S1-0005') === 21` and the other literal byte counts are constants, as round 5's :1637 is.
  - run_gas 26 "fails without B1/B3" only if its rows come from `commitBasket`. Section 23's rows are written by hand
    (map-sim-tests 5.5).
- Fix: call R6c and the W32 literals pins (or drop them) under the rule of 0.4. Build run_gas 26's rows with
  `commitBasket` on the real store.

### B11. The app store's "no receipt number on the PAYMENT" rule loses its only check

- Section: 3.5 ("run_app.js:967's rule holds"), 10.3 (967 deleted in step 1), round6 44 and 46.
- Evidence: 967 is the only run_app check that `!rows33[1].receiptNo` (poc/run_app.js:967). The receipt copy changes
  `appendLedger` (app/app_store.js:294-299). Only R6a checks the rule, on the sim_phone twin.
- Fix: step 46 asserts the same `receiptNo` on the three SALE rows and none on the PAYMENT.

### B12. Removed glue leaves dead code, and the form's phone keyboard has no check

- Section: 7.4 (deleted: the `sale` branch, the `'date'` mode), R5 ("anything dead is removed").
- Evidence:
  - After the sale branch goes (app/app_ui.js:77-82), nothing returns `'tel'`, yet `appInputBar` still builds it
    (:798).
  - `appOpenDateSheet()` without a callback (7.4: "without one it does what it does today") loses its only caller
    (:796).
  - 901 and 1110 (the tel keyboard) are deleted. Step 54 never checks the new buyer's phone input with
    `inputmode=tel` (1.3).
- Fix: delete both dead paths, or say why they stay. Add "the phone input has `inputmode=tel`" to step 54.

### B13. run_app's step-1 edits: an undefined name, and setup lines not named

- Section: 10.3 step 1.
- Evidence:
  - The new 1081 is `sendItemCard(uid, ..., staff, G2.ports)`, but round5() has no `staff` binding. `sendItemCard`
    takes it (apps-script/core_bot.js:236), and the file runs with `'use strict'`, so this is a ReferenceError.
  - For steps 33, 35 and 37 the deletion names check lines only. The driving lines would stay: :1041-1044, :1050 and
    :1052-1053 of step 35, the chain from :923 in step 33, and :1105-1131 in step 37. In step 3 these lines would scan
    into a form and tap stale messages.
  - Step 33's `const uid` (:917) must be kept, because steps 35-39 use it.
- Fix: write `G2.store.meta.staff`. Name the deletions as "the step body except the G/G2 creation, the enrolment and
  `uid`".

### B14. The sim_tours predicates are written with arrows, in an ES5 file

- Section: 8.3 (`formHas` = `when(c => ...)`, `tagIn` ... `.some(l => l.id === id)`), 0.4.
- Evidence: poc/sim_tours.js:1-3 is "Plain ES5", and 0.4 binds `poc/sim_*.js`. The 11 checker (`acorn --ecma5`) would
  catch arrows, but only after the build.
- Fix: write the predicates as `function (c) {...}` in the spec.

### B15. The mockup differs from the spec and from the app in five places

- Section: mockup.html figures 1-4, 1.1, 1.3, 1.5.
- Evidence:
  - Figure 2 has no 🕘 recent row, but 1.3's drawing has one (`🕘 [tile][tile][tile][tile]`).
  - Figure 1 draws four recent tiles, but 1.1 says six.
  - Figures 1 and 4 draw 🎤 ပြော, which app/index.html:32 hides by default.
  - Neither 1.1 nor figure 1 keeps today's `ui_history` handle of the scanner state (app/app_ui.js:493). Figure 4 drops
    the card-state handle row (app_ui.js:500-503), which the smoke step "a tour started right after a tap inside the
    app" presses (`button.handle`, poc/sim_ui.js:1416).
  - The new-piece price chips 20,000 · 25,000 · 30,000 · 35,000 (also 1.5 and 2.3) are not what `pricePresets(ports,
    'ထမီ', 'S1')` returns on the seed. Measured: 10,000 · 15,000 · 22,000 · 25,000.
- Fix: redraw these, or say so in the captions. 1.1 should list the history handle explicitly.

### B16. W25 pins a rule that contradicts "a chosen category is never replaced"

- Section: 4.2 `aiRenameFields`, 1.5 category row, 10.1 W25 ("category only when '' or 'အခြား'").
- Evidence: 'အခြား' is both a chip the seller can choose (🧵 အခြား, 1.5) and the stored default for "not chosen"
  (`commitNewItem`; handlePhoto stores the last category too, apps-script/core_bot.js:2122). The AI therefore replaces a
  chosen 'အခြား', and W25 pins exactly that.
- Fix: decide one way. Either store '' for "not chosen" until Save's fallback (then the AI replaces only ''), or state
  that a chosen 'အခြား' may be renamed.

### B17. No check catches `app_forms.js` missing from the dev page

- Section: 7.1 (four load lists), 7.7.
- Evidence: check_simulator.js:87 covers `APP_FIRST`/`FRAME_FILES`, and run_app covers its own `FILES`. The dev page's
  `<script>` list (app/dev/index.html:124-130) is checked by nothing: run_app.js:1142 reads only `sale_flow`, the
  checkbox and `syncNow`.
- Fix: the changed 1142 also requires `<script src="../app_forms.js">` after `app_ui.js`.

### B18. Owner of fake_gas.js and sim_ports.js not named

- Section: 6.5, 11 step 2.
- Evidence: 6.5 allows "a member the glue newly needs is added to the fake's table and to run_gas.js's copy
  (:198-230)". Neither poc/fake_gas.js nor poc/sim_ports.js is in any step's file list. The SPEC_MEMBERS/ADDED_MEMBERS
  copies (poc/run_gas.js:198-229) sit outside run_gas's owned regions (:1495, :1540, sections 26-28).
- Fix: give step 2 these files and run_gas.js's member tables, conditionally.

### B19. Step 41's "no chat message" is not true of a scan

- Section: 10.3 step 41.
- Evidence: `phone.sim.start(id)` sends `/start <id>` as a user message into the chat (app/app_ports.js:260-262, the
  sim helpers); the tours' `scanned(id)` depends on that message (poc/sim_tours.js:50-52).
- Fix: "no bot message".

---

## Confirmed as written

- Suite counts today: run_scenario 327, run_round4 345, run_lists 236, run_gas 295, run_app 265, run_sync 333, run_wizard
  290, check_simulator 68, all 0 failed.
- run_app's step-1 deletions are 14 + 16 + 5 + 7 + 3 = 45 checks, so 265 - 45 = 220 after step 1. The step-3 deletions
  (900-903, 906, 1194) make 51.
- Every new name of sections 4 and 7 is free in `apps-script/`, `app/`, `poc/` and `tools/`; `reloadAfterForm` is reused
  on purpose. The 40 MSG keys (9.1) and 20 APP_MSG keys (9.3) are free, and the blocks hold exactly 40 and 20.
- All 74 quoted labels of the form `key 'text' (:line)` match MSG/APP_MSG word for word and by line.
- The cited lines of run_round4 (1938, 1955, 1959, 1962, 1967), run_sync (1558-1563, 1600-1609, 1666-1671, 1693, 1734,
  1739, 1753, 1764) and run_gas (1495, 1540) are right. The new R5a, R5c and R5e tap sequences walk 2.1's sub-screens to
  the same rows, and `fmtMoney(0)` is '0', so the new 1962 condition can hold.
- check_simulator.js:87 compares `FRAME_FILES` with `CORE_FIRST + rest + APP_FIRST`, without build_app's `appRest`.
  Putting `app_forms.js` in `APP_FIRST` and `FRAME_FILES` in the same step is right. build_app has no per-file
  precache.
- `ports.cache.remove` exists in every port: gas_main.js:154, sim_ports.js:355, app_ports.js:161 and sim_phone.js:384.
  The reference phone has no `ports.ui`, so it gets the review card.
- The z-indexes are as cited (app/app.css:77, :136, :166, :171, :190).
- The receipt copy can be built: both `appendLedger`s push row by row (app/app_store.js:294-305, poc/sim_phone.js:121-131).
- The frame transport carries forms:
  - `click` already presses any selector (`pick`, build_simulator.js:128-132);
  - post-mode frames post a changed snapshot every 200 ms (:206);
  - the page re-evaluates `when()` steps every second (sim_ui.js:1537);
  - `syncFrameHot` ships any `T.hot` (sim_ui.js:630);
  - a form on `document.body` keeps `APP.screen` 'home', so `framePre` does not ask for the back button (sim_ui.js:560-564).
- run_sync S8 stays green under 6.2. The item has the placeholder name and the fallback category, so the server and the
  phone rename it the same way and the phone's entry is a `dup`.
- File ownership is disjoint between steps 2 and 3. The shared suites are edited in sequence.
- The mockup's Burmese labels are the spec's.
