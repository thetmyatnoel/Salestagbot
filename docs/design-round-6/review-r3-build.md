# Review of SPEC-round-6.md revision 3: buildability and data

Lens: the F2 drawing's storage, size, sync and PDF path against today's code; F5 buyer add and edit; the F10 shop
settings path; the offline icons and precache; the history from local data; global names; whether the named tests fail
without their features; whether the list of existing checks to change is complete; file ownership; ES5.
Every file:line is today's tree (2026-11-13). Severity: blocker (data is lost on a path the spec endorses), major (the
build stalls, an unlisted check goes red, or a real defect ships), minor (a gap or contradiction a builder must guess).

## Blocker

**B-1 (13.7.2) A drawing saved alone is quarantined on the server, and the phone then deletes it.**
13.7.2 says "nothing filled AND no drawing is still refused `empty` (a drawing alone may be saved)". Such an entry has
`rec.fields = {}`. `syncMeasRecReason` refuses it as `malformed` (`var keys = Object.keys(f)` at core_sync.js:500, then
`keys.length < 1 … return bad` at :501). Revision 3 does not relax that rule. A quarantined measurement entry calls
`measurementRejected` (core_sync.js:1415), which deletes the local record (app_store.js:520-527). So the tailor's drawing
is gone from the phone and was never stored on the server. Its PNG job then gets `no_session` for ever (see M-2).
run_app 69 checks "a drawing alone saves" on the phone only, and R6h never pushes an entry with no fields, so no test
catches this.
Fix: pick one.
- Keep `empty` for a save with no value (the drawing then needs at least one value).
- Or let `syncMeasRecReason` accept 0 fields when `rec.sketch` is non-empty, check that gasStore.addMeasurement, the
  duplicate signature and the PDF all work with no fields, and add an R6h case that pushes such an entry.

## Major

**M-1 (13.11) With AI off, a new piece's photo never reaches the server.**
The only path that uploads a phone's photo is the AI `photo` job:
- gas_sync.js:306-316 saves the JPEG to Drive and writes the item's photoUrl, inside the AI hook;
- app_ports.js:151 queues that job from `describePhoto`;
- `chat.savePhoto` (app_ports.js:119-122) only returns `'local://<media>'`.

13.11 removes that job when AI is off: `describePhoto` is called only when `aiOn`, and run_app 71 says "a new-piece Save
queues no photo job". `syncHandle` also refuses photo jobs with `ai_off`. Result: with AI off, every piece created in
the app keeps `photoUrl 'local://…'` on the server. Telegram, the other phones and the thumbnails never see the photo.
Fix: separate the upload from the naming. With AI off, queue the job marked no-AI (`ctx.noAi`, or a kind `pic` handled
like `sketch`). The server saves it to Drive and sets photoUrl without calling Gemini, and never refuses it as `ai_off`.

**M-2 (13.7.2) A PNG job whose measurement session was refused retries for ever.**
When the measurement entry leaves the outbox quarantined (B-1, a bad pattern, or an unknown customer), the sketch job
stays `queued`. Every 300 s it gets `no_session`, and each try writes an Errors row (core_sync.js:1268). The chip counts
it as waiting (app_sync.js:485).
Fix: when `measurementRejected` runs for a customer, mark that customer's sketch jobs whose `entryId` left the outbox as
`failed`. Also cap `no_session` at a few tries.

**M-3 (13.12) `gasStore.setSetting` with `setValue` corrupts shop phone numbers.**
Settings are read through `getValues` (gas_store.js:690-693; the existing writer is gas_store.js:523). So `09123456789`
typed in the shop form is stored as the number 9123456789, and `+95…` is parsed as a number too. Receipts then print
the wrong phone. 'TRUE' / 'FALSE' become booleans, so the "same value → dup" comparison never matches.
Fix: `setSetting` sets the Value cell to plain text (`setNumberFormat('@')`) before `setValue(String(value))`, as the
Lists and Measurements writers do. Compare dup values as `String(…).toUpperCase()`.

**M-4 (13.12, 13.16) The Shops-block colour breaks step 1's checker.**
The colour of the Shops block needs `Range.setBackground`. `poc/fake_gas.js` does not model it (the Range member list
at fake_gas.js:56; run_gas.js:204-205). gas_setup.js is step 1's file, but the fake and the member tables are step 2's.
A call inside the "try/catch style of :85-93" logs to Errors, so run_gas.js:472 ('nothing was logged to the Errors
tab') and the other `errorsOf(...).length === 0` checks go red in step 1. run_gas 32 also cannot read a colour: the
fake's `hand` has no background accessor.
Fix: either move the Shops block (notes and colour) to step 2, together with `Range.setBackground` in the fake,
`ADDED_MEMBERS.Range`, and a `hand.background(r, c)`; or drop the colour and keep only the notes, which the fake already
models.

**M-5 (13.7.1) An unlisted run_scenario check breaks, and the paper sheet's margin note is mislabelled.**
A PHOTO session keeps the sheet's margin note in `notes` and leaves `fields.note` empty (sim_seed.js:27,
run_scenario.js:997: `notes === 'No Bra'`). Under the new rule, notes that differ from `fields.note` print as
'ပြင်ဆင်ချက်'. So run_scenario.js:1166-1167, which expects `['မှတ်ချက်', 'No Bra']`, goes red. It is not in 13.15 or 10.8,
and 10.9 still says run_scenario 327. It also calls F1's own example ("No Bra") a "correction".
Fix: print 'ပြင်ဆင်ချက်' only for the `fix of M-…` text (split it off `notes`), or only for FORM sessions. Keep
'မှတ်ချက်' for PHOTO and CHAT notes.

**M-6 (13.16 step 1) The new run_app.js:497 check cannot pass in step 1.**
The new expectation (a `CH|` tap emits `openscreen` and sends no message) needs `ports.ui.openScreen`, which step 3 adds
(13.13, app_ports.js). In step 1 the app phone's `ui` has only `measureForm` (app_ports.js:181-183), so
`screensInApp` is false and the customer card is still sent. Step 1's checker requires run_app 220 green.
Fix: leave :497 unchanged in step 1 and make it a step-3 edit.

**M-7 (11, 13.16) Steps 2 and 3 are not independent any more.**
run_app syncs against `poc/sim_sync.js` (run_app.js:21). Step 3's checks depend on step 2's files:
- run_app 69 (the sketch job is sent after the ack and sets photoUrl) needs step 2's `hooks.ai` sketch branch. Today
  that hook throws `unknown ai job kind` (sim_sync.js:188).
- run_app 70 and 71 (`setting` entries reach the server) need step 2's `setSetting` on `poc/sim_ports.js`. Today the
  sim store has no such member (sim_ports.js:296 has only `getSetting`), so the entries are quarantined `bad_kind`.

So step 3 cannot end `0 failed` while it runs in parallel with step 2.
Fix: run step 3 after step 2, or move the two twin edits (sim_sync sketch branch, sim_ports setSetting) into step 1.

**M-8 (13.15 R6g) The last clause of R6g contradicts the code and 13.12.**
R6g says "a server without setSetting answers bad_kind and the entry stays". But a kind the server knows, with a store
that lacks the method, gets `kindKnown: true` (core_sync.js:669). That answer is final (run_sync.js:1481-1488), and
13.12's ack rule keeps only bad_kind without kindKnown. The entry is dropped and the settings hash cleared, so the
owner's edit silently reverts.
Fix: test the older server as M9 does (run_sync.js:1449-1456: `setting` left out of `SYNC.ENTRY_KINDS`). Say that a
store without `setSetting` is final, and show the owner a line when a setting is refused.

**M-9 (13.3, 13.13) The dev page crashes at boot.**
app/dev/index.html has its own header markup (lines 40-47) with no `#back`. 13.3 binds `#back` in `appWireEvents`,
paints it in `appPaintChrome` and toggles it in `appRenderHeader`. `$('back')` is null there, so boot throws a
TypeError. 13.13's dev-page row lists only the script tags and `noHistory`.
Fix: add `<button id="back" class="iconbtn" type="button" aria-label="back" hidden></button>` to the dev header, or
null-guard every `#back` access.

**M-10 (13.4) `appNavReset` swallows later back presses.**
`APP.navIgnore += n; history.go(-n)` is wrong: one `go(-n)` traversal fires a single `popstate`. After a Scan from n
layers deep, the next n−1 real back presses (including Android's gesture) are ignored.
Fix: add 1 per `go()`, or match `e.state.salestag` against `APP.nav.length` instead of counting.

**M-11 (13.4, 13.15) Existing stub-APP checks will crash, and they are not listed.**
These checks build an `APP` with no `nav` and no `opts`:
- run_app.js:754-758 (step 29: `appMeasFormSave` → `appCloseMeasForm`, which in revision 3 drops a `meas` layer);
- `withFakeApp` at run_app.js:880-883, used by the kept checks at :1175-1196 (`titles()` opens and closes the number
  keypad, which pushes and drops a `sheet` layer);
- check_simulator.js:235 (step 7 runs BOOT, whose `snap` revision 3 extends with `APP.nav.map(kind)`).

Each one hits a TypeError.
Fix: make `appNavPush`, `appNavDrop`, `appNavCanBack` and `snap` null-safe (`APP.nav || []`, `(APP.opts || {})`),
or list these setup lines as changed.

**M-12 (13.11) AI jobs held while AI is off keep the sync icon at "waiting" for ever.**
`flushAiJobs` leaves voice, text, photo and notebook jobs queued while `!aiOn`. `chipState` counts `aiQueued` and
dates only the outbox (app_sync.js:485-491). So a phone that had a queued job when the owner switched AI off shows the
waiting icon with a badge indefinitely. F8 makes that icon the only sync signal, and F9b says nothing waits for the AI.
Fix: with AI off, mark such jobs `skipped` (leave them out of `queuedMedia` and the chip), and re-queue them when AI
comes back on if wanted.

## Minor

- **m-1 (13.7.1)** The merge condition can never be true on a phone. `appOpenMeasForm` merges "when the newest
  session's `source` is FORM", but neither the pull (syncMeasPage, core_sync.js:957-958) nor the local record
  (app_store.js:484, :496) carries `source`. Drop the branch, or add `source` to both.
- **m-2 (13.7.2)** The figure's Drive URL prints as "sheet photo". `measurementReport` prints 'စာရွက် ဓာတ်ပုံ' for any
  photoUrl (core_orders.js:621), so a FORM session's PDF would show the image and also its raw URL under that label.
  Gate :621 with `meas.source !== CFG.MEAS_SOURCE.FORM`.
- **m-3 (13.7.2, 3.1, 6.6)** Say that gasStore.addMeasurement appends `Sketch` only when `rec.sketch` is non-empty
  (as `EntryID` is only with an entryId). Otherwise run_gas.js:1302 and :1306 break. Also, "the tab gets its Sketch
  column with the first session that carries a drawing" is wrong: setupSheet's `measCols` = `MEAS_FIXED_COLS` + keys,
  then `ensureColumns` (gas_setup.js:137-144), adds it at the publish.
- **m-4 (13.15)** sim_ui.js:1421 still fails after changing only `sel: '#back'`. The call keeps
  `key: 'ui_btn_back'`, and `pick` filters by textContent (build_simulator.js:128-132). An icon-only `#back` never
  matches, so the smoke fails. Drop the key, or let `pick` match `aria-label`.
- **m-5 (13.7.2)** `replayJob`'s last line (app_sync.js:403) clears every pending ⏳ line whenever any job finishes,
  including a sketch. Skip that line for a sketch. `pendingLines` also counts a sketch under `ui_pending_ai`
  '🎤/📸 စစ်ရန် …'. Give it its own line or leave it out.
- **m-6 (13.8)** Compute the undone mark from all rows of the group (`groupRows(ports, g)`). Mirrors written by the
  owner's void from Telegram are not this phone's rows (deviceId 'TG', gas_store.js:397), so filtering first would
  show a voided sale as live.
- **m-7 (13.4)** Some screen changes bypass the stack:
  - the red banner's view button (app_ui.js:408) opens sync with no layer, which is a dead end (no ←, and the bottom
    bar shows on the home only);
  - the re-enrol wipe (:902) and the frame's `screen` op (build_simulator.js:156) leave stale layers;
  - `appOpenTagId` (:563-567) sets `showScanner` false before the update, so the ":358 from scanner state" rule pushes
    no card layer, and the item card after a scan has no ←. Make appOpenTagId push the card layer.

  The bottom of the stack for a phone that is not enrolled must be 'enroll', not home (the gear from the enrol screen).
- **m-8 (7.4)** The APP-fields row still adds `formPopIgnore: false`. That contradicts 1.0 and 13.4 ("not built").
- **m-9 (13.4)** Stale history entries survive a reload (the SW update reload): `APP.nav` is empty but the session
  history still holds `salestag` entries, so back does nothing. Specify a `replaceState` at boot, or treat a popstate
  with an empty nav as "leave".
- **m-10 (13.7.2)** The PDF image may fall outside the printed range. An over-grid image anchored below the last data
  row can be cut from the export's print range. Write blank rows under the caption to cover the image's height, and
  call `insertImage` before `SpreadsheetApp.flush()` (gas_pdf.js:35).
- **m-11 (13.7.2)** `appSketchPng` must draw the outline on a canvas: name `Path2D(d)` (synchronous) or an alternative.
  Say where pure `appMeasSave` gets its canvas (injected, or `APP.doc`), so run_app 69's stub knows what to fake.
- **m-12 (13.7.2, 13.7.1)** On a rollback to an older bot:
  - a session with a sketch is stored without it and acked, so the drawing is lost;
  - a note over 60 characters is `malformed`, so `measurementRejected` deletes the whole local session.

  No cap guards either (SYNC.CAPS stays `['dueDay']`). Name it under 13.17, or add a cap.
- **m-13 (13.11)** Switching AI on writes `notebook_import` and `app_voice` TRUE. That overrides a FALSE the owner set
  in the Sheet, against 13.17's "per-feature switches stay in the Sheet".
- **m-14 (13.1)** The stepper's label at n = 1 is `info.sellText`, the raw button text (app_ui.js:727). Only :701 is
  named for `appPlain`, so the stepper keeps its emoji (against F7).
- **m-15 (13.7.2)** A newer session can lose the drawing. A Telegram copy (`MM|copy`, core_bot.js:4220) makes a
  newest session with no sketch, and the app form then opens with no drawing. A `measFix` made before the PNG job ran
  copies photoUrl '', so its PDF has no image.

## Confirmed sound

- Every new global, constant and member was grepped across apps-script/, app/, poc/ and tools/ (dist excluded): none
  exists. The 91 keys of 13.14 do not clash with MSG, APP_MSG, SYNC_MSG or revision 2's blocks (9.1, 9.3).
- The icons ship in the precached bundle. `APP_FIRST` (build_app.js:30) goes into the bundle, and the bundle is in the
  precache (:76, :91). The licence file is copied by :88-90 and kept out of the precache by `/LICENSE/i` at :91.
- Buyer add and edit follow the cited path: app_store.js:325-340, core_sync.js:693-708 (the Rev bump), :1408
  (`setCustomerRev`), and `CUSTOMER_PULL_FIELDS` at :72. Customers go first in a push, before the same request's pull.
- History's device test works: `markSynced` stamps the id (app_store.js:405-412), app_sync.js:275 passes
  `store.meta.deviceId`, the server stamps `device.id`, and Telegram rows carry 'TG' (gas_store.js:397).
- The pull's key list for sessions without a drawing holds (run_sync.js:1121). run_gas.js:1277 holds, because `Sketch`
  goes after `EntryID`. sim_ports' `addMeasurement` already copies every key (sim_ports.js:199-210).
- gas_telegram.js:35-61 and sim_ports.js:317-335 ignore an extra chat argument.
- check_simulator.js:87 and :92-93 hold. run_app.js:492 stays green, because that world runs on quick.
- run_app.js:950, 952, 1009-1014, 1129 and 1194 are already deleted by revision 2. :1101, :1172, :1183 and :1196 are
  rightly listed. :1172 and :1183 compare through `APP.tt`, which `withFakeApp` stubs to raw `t`, so they hold either
  way.
- The ES5 regex of 13.1 has no `u` flag, so acorn --ecma5 accepts it. The `aiOn` and `appNavPush` snippets are ES5.
