# Map: how the phone app can host native forms (round 6)

Date 2026-11-12. Mapper's report for `docs/design-round-6/BRIEF.md` (R1-R9). Tree: the current one (rounds 4 and 5
built, unpublished); line numbers as of today. Scope: `app/*`, `app/dev/index.html`, `tools/build_app.js`,
`poc/run_app.js`, plus the core and simulator lines a form touches. No code or test was changed.

The precedent is the round-4 measurement form (`#measForm`, app/app_ui.js:117-259 pure part, :990-1177 DOM part). Every
section ends with what it means for a new form. Section 15 is the recipe; 16 the commit calls; 17 photos and the AI;
18 the seller's home; 19 the traps found on the way.

---

## 0. Short answer

- The app can already host a native, offline form: `#measForm` proves the pattern (pure helpers on the store, a thin
  DOM on `document.body`, a draft in the persisted cache, `phone.commit` then `sync.scheduleSync`). Nothing in the
  store, ports or sync needs to change for a form to *write*: every core `commit*` function runs on `phone.ports`
  synchronously and lands in one adapter transaction at the next `phone.commit`.
- What the forms need that the measurement form never needed:
  1. **Layering**: the in-app keypads and the tag keypad draw into `#overlay` (z-index 30, app.css:136), BELOW a
     `.formpage` (z-index 32, app.css:171). A form that wants the 64 px keypad must change the z-order or use native
     inputs (`inputmode="numeric"`) as `#measForm` does.
  2. **Scan into a form**: the scanner is one instance bound to the home `<video>` with `onDecode -> appOnDecoded ->
     appOpenTagId -> phone.sim.start(id)` (app_ui.js:540-545, 558-568); the tag keypad also ends in `appOpenTagId`
     (:926, :928). A basket needs a routing switch ("a form is open: give it the id").
  3. **Photo into a form**: `#photoInput`'s change handler is wired once to `appOnPhotoPicked`, which sends the photo to
     the core as a chat message (app_ui.js:340, :1229-1235). A form needs to receive the downscaled photo instead.
  4. **A basket write**: `commitSaleGroup` takes ONE item (core_ledger.js:824-855) and the phone stamps a receipt
     number on EVERY SALE row (app_store.js:296-299). Both are covered by `docs/design-round-5/map-basket-readers.md`
     3.2-3.3; nothing in this map changes those conclusions.
  5. **A new-piece write**: there is no core function; the Telegram path is the bot handler `newItemCost`
     (core_bot.js:2172-2193: `updateItem` as UNIQUE + `commitRestock` qty 1 + `notifyOwners` when the price is pending).
  6. **The photo AI is never synchronous in the app**: `ports.ai.describePhoto` always queues and throws `PendingAi`
     (app_ports.js:130-151); the result arrives only after a successful sync (`flushAiJobs`, app_sync.js:352-353,
     405-426) and its replay renames a still-blank item behind an open form (app_sync.js:388-395). See section 17.
- Every new app file must be added to four lists (build_app `APP_FIRST`, build_simulator `FRAME_FILES`, run_app
  `FILES`, the dev page's script tags); check_simulator.js:81-87 fails otherwise. Keeping the forms in app_ui.js avoids
  that.
- The home today is scanner + keypad + 6 recent tiles + find + the latest bot card; the jobs live in the core's ☰ menu
  and on the item card. A seller's home needs job tiles, a scan router, and a place for the sold card after Save.

---

## 1. Files, load order, and where a new file must be listed

| Where | What it loads | Line |
|---|---|---|
| `tools/build_app.js` | `CORE_FIRST` (8 core files), the other `core_*.js` alphabetically, then `APP_FIRST` = app_i18n, app_store, app_ports, app_sync, app_scan, app_media, app_ui, then any other `app/app_*.js` alphabetically (`appRest`) into `app/dist/app.<hash>.js` | :29-30, :55-58 |
| `poc/build_simulator.js` | `FRAME_FILES` = the 9 core files + the 7 app files, explicit; no jsQR, no config.js in the frame | :24-27 |
| `poc/check_simulator.js` | asserts `FRAME_FILES` equals CORE_FIRST + rest of core + `APP_FIRST` (NOT appRest) | :81-87 |
| `poc/run_app.js` | `FILES` = core + `poc/sim_mock_ai, sim_ports, sim_seed, sim_sync` + the 7 app files, `vm.runInThisContext` (one global scope) | :17-24 |
| `app/dev/index.html` | one classic `<script src>` per file, unbundled, plus the simulator's mock AI, ports, seed and fake server | :110-130 |

A new `app/app_forms.js` would be bundled by build_app on its own (appRest) but would be missing from the simulator frame,
the Node harness and the dev page, and check_simulator.js:87 would fail unless it goes into `APP_FIRST` and
`FRAME_FILES` together. R9 forbids a new apps-script file only; a new app file is allowed but costs those four edits.

---

## 2. Boot, the APP singleton, screens

`bootApp(config, opts)` (app_ui.js:263-326): picks the adapter (IndexedDB, else memory, :273-276), wires
`adapter.onreplaced` (:277), creates the phone (`createAppPhone`, :278) and the sync client (`createAppSync`, :283),
then sets the singleton `APP` (:284-290). Fields a form uses or must join: `phone, sync, store, win, doc, $, tt`
(:291-295), `screen` ('boot' | 'enroll' | 'home' | 'history' | 'sync' | 'settings'), `showScanner`, `scanner`,
`videoEl`, `scanState`, `qty` (the card stepper), `toastTimer`, `tapStart`, `measForm`, `reloadAfterForm`.

After `phone.load()` (:300): `appWireEvents` (:302), `phone.on('change', appOnChange)` (:303), `'sync'` re-renders
(:304), `'syncstate'` repaints the header (:305), `'progress'` (:306), `'revoked'` closes the form and goes to enroll
(:307), `'measureform'` opens the form (:308); then service worker, install hints, persist request; home (scanner
auto-starts when the pref `cameraOk` is set, :318) or enroll.

`appRender()` (:373-389) repaints header, banner and `#main` only; the bottom nav shows on home and history only
(:380); the scanner is stopped on any other screen (:388). **A form on `document.body` survives every `appRender`**
(the store's `change` events repaint the screen behind it).

`appOnChange(evt)` (:353-365): a `measdraft` change only toasts `ui_not_saved` when not durable (:354-357); an
`update` (a core delivery) on home hides the scanner so the latest card shows (:358); then `appRender`, the tap-to-paint
sample (:360-363), and the `ui_not_saved` toast on a failed write (:364).

---

## 3. The home today (`appRenderHome`, app_ui.js:484-505)

Two states, switched by `APP.showScanner` and whether a bot message exists:

1. **Scanner state** (`showScanner || !m`, :486-495): `appScannerPanel()` (the `<video>`, the guide square, 🔦 and ✖️;
   or a start button with the camera error, :507-531), one row with `ui_btn_keypad` "⌨️ နံပါတ် ရိုက်မယ်" (:488-490),
   `appRecentPanel()` (`recentItems(ports, shop, 6)`, shop = staff shop, all shops for the owner, :570-577),
   `appFindPanel()` (`findItemsByName`, own shop first then both, 8 results, :591-609), then the menu text card
   (no message yet) or the `ui_history` handle.
2. **Card state** (:497-504): the latest bot message as one big card (`appRenderMsg(m, {big: true})`), the input bar
   the core is waiting for (`appInputBar`), and a row with the history handle and 📸 `ui_btn_photo`.

Tiles (`appTiles`, :578-590): `.tiles` 2-column grid; each tile = category emoji + id, name (+ `sample_mark`), and a
status (sold: the tail of `card_sold_out` "✅ ရောင်းပြီးသား"; pending: `btn_pending`; else `fmtMoney(price) · stock`);
tap = `appOpenTagId(it.id)`.

Bottom bar (app/index.html:30-34): `📷 ဖတ်` (back to the scanner, app_ui.js:337), `🎤 ပြော` (only when Settings
`app_voice`, :381-382), `☰ မီနူး` (`appOpenMenu` = `phone.sim.start('')`, the core's `showMenu` grid, :819-824;
core_bot.js:131-153). **Its labels are hard-coded HTML**: `APP_MSG.ui_btn_scan / ui_btn_menu / ui_btn_voice`
(app_i18n.js:62-64) are never used, so a Messages-tab override does not reach them; the dev page has its own copy of
the shell (app/dev/index.html:38-55), the simulator copies app/index.html's shell (build_simulator.js `frameShell`).

Where the jobs are today: sale (S|id|N), restock (R|id, SKU only), discount, return, transfer on the item card
(`cardKeyboard`, core_bot.js:211-234); payment M|pay, deposit M|dep, expense M|exp, customers, reports, 📏 M|meas, 🏛 M|acct, 📲 M|app in
the ☰ menu; a new piece only by scanning a blank tag (core_bot.js:122-125: state `new_item`, message `new_tag`).

Unused APP_MSG keys a home could take: `ui_home_hint` "👋 Tag ကို ဖတ်ပါ၊ ဒါမှမဟုတ် အောက်က ပစ္စည်းကို နှိပ်ပါ"
(app_i18n.js:44), `ui_menu_title`, `ui_scan_title`.

---

## 4. Scanner and tag entry

- `appParseTagLink(text)` (app_scan.js:13-21): t.me `?start=ID`, tg://, a bare `S1-0042`/`S1 0042`, the app's own
  `?start=`; null otherwise. Pure, tested (run_app.js step 1).
- `createAppScanner({video, onDecode, onError})` (app_scan.js:35-136): BarcodeDetector or jsQR on a 480 px canvas at
  8-10 fps; **the first decode vibrates, STOPS the camera and calls onDecode** (:45-53); the same text within 2 s is
  ignored (:47) and `lastDecode` survives a restart of the same instance. Errors: 'denied' | 'none' | 'error' (:107-111).
- App glue: `appStartScanner()` runs only when `APP.screen === 'home' && APP.showScanner && enrolled` (app_ui.js:533),
  creates ONE `APP.scanner` with `onDecode: appOnDecoded` (:539-545), sets the pref `cameraOk` (:549-550).
  `appOnDecoded` toasts `tag_not_found` and restarts on a non-tag (:558-562), else `appOpenTagId(id)` (:563-568):
  stop the camera, hide the scanner, start the tap timer, `phone.sim.start(id)` (the core's `openTag`: card, blank-tag
  prompt, or not found).
- `visibilitychange` restarts the camera when the screen is home and `showScanner` (:346-349) - **with no check for an
  open form** (a form opened from the scanner state would get the camera running behind it on return).
- The tag keypad `appOpenTagKeypad()` (:910-938): shop toggle (`.seg`), 4 digits, auto-opens at the fourth digit or ✅,
  **always via `appOpenTagId`**.
- In the simulator frame there is no camera and no jsQR; the rack click sends `{op: 'open', id}` -> `appOpenTagId`
  (build_simulator.js:155; sim_ui.js:319).

For a basket form: a second scanner instance with the form's own `<video>` and its own `onDecode`, or one router in
`appOpenTagId` / `appOnDecoded` ("a form is open: hand it the id"); the auto-stop after each decode means "scan many"
= restart after each add; the 2-second same-text rule already blocks a double add of the same tag but also blocks a
quick second scan of a SKU to count it up (the count stepper is the answer). The tag keypad needs an `onPick` callback
instead of the hard-wired `appOpenTagId`, and must render above the form (section 6). The simulator needs the same
router so `{op: 'open'}` adds to an open basket.

---

## 5. How the app shows bot messages today

- Messages live in `store.chat` (persisted, cap 500, app_store.js:47, :587-597). The core writes through `phone.ports.chat`
  (app_ports.js:93-123): `sendMessage/sendPhoto/sendDocument` push a bot message (to another chat id: an outbox notice,
  `pushNotice`, :95-98, :125-127), `editMessage` rewrites in place. `phone.botSay(text, kb)` pushes a `system` message
  (`card system` style) for app-made lines (:87-92), e.g. `meas_saved_form` after a form save.
- Home shows `appLatestBot()` = `phone.sim.lastBot()` (app_ui.js:369) when the scanner is hidden. `appRenderMsg(m, opts)`
  (:663-714): photo (`appPhotoNode`: media dataUrl/blob, cached thumb, or category emoji; asks `api=photo` for a Drive
  thumbnail when online, :612-632), document + report table + PDF/share actions, the keyboard as rows of buttons
  (`data-cb` = callback, `SIM_HOT` highlight), the menu as a 3-column grid, a share row under a 🧾 receipt text.
- A tap = `appOnTap(m, data)` (:810-818) -> `phone.sim.tap(m.id, data)` -> a Telegram-shaped `callback_query` through
  `processUpdate` (app_ports.js:300-307). So **a core-rendered card with U|/RC|/PY| buttons works in the app with no app
  code**: `U|<groupId>` (`undoGroup`, core_bot.js:541-550) does not care which message carried it.
- The stepper `appStepper` (:716-735): on a SKU card only (`appCardInfo` finds S|id|1 and Q|id, :37-46), `[−] [n] [+]`
  with the number keypad on the number (max `CFG.MAX_SALE_QTY` 999), one big sell button sending `S|id|N`
  (`appStepperData`, :48-53). State is `APP.qty = {msgId, n}`: one per card, not reusable per basket line; the CSS
  `.stepper` (app.css:98-100) is.
- `appInputBar(m)` (:777-802) + `appInputModeFor(state)` (:68-84): from the core's per-user state (`getState`, cache
  `st:<uid>`): 'number' (keypad, auto-opened once per message+prompt, `appKeypadKeyFor` :92-94), 'text' (a text bar),
  'tel' (text bar with the phone keyboard), 'date' (the date sheet), 'photo' (a 📸 button), or none. Text goes back as a
  user message (`appSendText`, :804-807).
- `markWaiting` (app_ports.js:196-216) swaps the core's `ai_down` line for `app_wait_server` "⏳ ဆာဗာ စောင့်နေပါသည် ·
  လိုင်း ရှိမှ အသံ/ဓာတ်ပုံ ကို စစ်ပါမည်" (core_sync.js:96) - **only inside `deliver`**, not for a form that queues an AI
  job itself.
- History screen: the last 200 messages small (:827-835).

For a form: the reply after Save can be a core-rendered message pushed through `ports.chat.sendMessage(staffId, text,
kb)` (a normal bot card with buttons) or `phone.botSay` (a system line); the home shows it only if the form sets
`APP.showScanner = false` (appOnChange does that for `update` events only, app_ui.js:358).

---

## 6. Overlay, keypads, date sheet, toasts: the z-order

| Element | Where | z-index |
|---|---|---|
| `#overlay.overlay` (keypads, date sheet) | sibling of `#app` (index.html:36) | 30 (app.css:136) |
| `.formpage` (`#measForm`) | appended to `document.body` (app_ui.js:1051) | 32 (app.css:171) |
| `.formpage .fbar` (the Save bar) | inside the form | 33 (app.css:190) |
| `.rec` (voice) | body | 35 (app.css:166) |
| `.toast` | body (index.html:37) | 40 (app.css:77) |

- `appOpenNumberKeypad({title, initial, max, onOk})` (app_ui.js:940-970): 64 px keys, `000`, OK disabled at 0, `onOk(v)`
  callback - reusable as is, but it is drawn BELOW an open form. The measurement form avoids it on purpose (comment
  :991-992: it never draws into `#overlay`, which the keypads clear).
- `appOpenTagKeypad()` (:910-938): see section 4.
- `appOpenDateSheet()` (:972-988): a native `<input type=date min=today>` whose OK **sends the text to the core**
  (`appSendText`), so it is the guided sale's, not a form's; a form puts its own `<input type=date>` inline.
- `appToast(text, bad)` (:1239-1247): one `#toast`, 2.6 s, above everything; usable from a form (the measurement form
  toasts refusals and shows the same text in its `.fmsg`, :1121-1124).
- `appCloseOverlay()` (:909) clears `#overlay`; the form calls it on open (:1004).

For a form with keypads: raise `#overlay` above `.formpage` (e.g. a modifier class on the overlay while a form is open)
or keep native inputs. On the dev page a body-level form covers the whole browser window, not the 390 px frame (the
frame's `transform` only contains its own children, app/dev/index.html:22); the simulator runs the app in an iframe, so
there the form fills the device.

---

## 7. The measurement form, anatomy (the precedent)

**Entry.** The core decides: `startMeasureFor` calls `ports.ui.measureForm(req)` when the hook exists
(core_bot.js:4198-4199; `measureFormEnabled` :4183); app_ports.js:181-183 emits `'measureform'`; `appOnMeasureForm`
defers the open with `setTimeout(0)` so it happens after the core's run (app_ui.js:995-999). req =
`{chatId, uid, customerId, orderId, staff}`.

**Pure part (Node-testable, app_ui.js:117-259).** Limits as `APP_MEAS_*` vars (:120-127). `appMeasModel(ports, store,
req)` -> everything the screen shows (fields, previous session, values = draft else prefill, voucher, `restored`)
(:226-236). `appMeasSave(phone, req, input)` -> validates (refuses `{ok: false, reason: 'empty'}`), normalises, writes
through the LOCAL STORE CONTRACT (`store.local.saveMeasurementLocal`, one outbox entry), drops the draft, says the bot
line `meas_saved_form`; returns `{ok, n, orderId, badVoucher, record}` and writes nothing durable (:244-255).
`appMeasCommit(phone, sync)` -> `phone.commit('meas')` then `sync.scheduleSync()` (:257-259). Drafts:
`appMeasDraftKey/Read/Write/Drop` on the persisted cache `measdraft:<customerId>`, TTL one day, unreadable = none
(:200-215).

**DOM part (app_ui.js:990-1177).** `appOpenMeasForm(req)`: close any form, `appCloseOverlay`, `appStopScanner`, build the
model, keep `F = {req, model, values, dirty, timer, el, ...}` in `APP.measForm` (:1001-1009); a full page
`div#measForm.formpage[role=dialog]` with `.fcol` (head with title + ✖️ close, a previous/restored strip, fields in
`.fgrid`, notes) and a fixed `.fbar` with `.fmsg` + the green Save (:1011-1041); Enter moves to the next input
(:1043-1049); appended to `document.body` (:1051). `appMeasChanged(F)` keeps the draft in the cache on every input and
debounces `phone.commit('measdraft')` by 400 ms (:1112-1119). `appMeasFormSave()` -> `appMeasSave`; refusal -> `.fmsg`
+ toast; ok -> close, toast a dropped voucher, `appMeasCommit` (:1143-1151) - **it closes before the commit resolves**
(the bot line is in memory; a failed write toasts `ui_not_saved` and retries at the next commit).
`appCloseMeasForm({ask})`: a dirty form asks `ui_meas_close_ask` and drops the draft on yes; clears the timer; removes
the element; a waiting service-worker update reloads only after `phone.commit('reload')` succeeded (:1157-1177).

**Lifecycle hooks the form joined** (a new form must join each):

| Hook | Line |
|---|---|
| `APP.measForm` / `APP.reloadAfterForm` fields | app_ui.js:289 |
| `'revoked'` closes the form | :307 |
| `appOnChange` treats `measdraft` as "nothing behind the form changed" | :354-357 |
| SW update waits while a form is open (`canApply`), reload deferred to the close (`controllerchange`) | :1254, :1263 |
| DB taken over by another tab: the draft is on disk, comes back on reopen | :1278-1287 |
| close overlay and stop scanner on open | :1003-1005 |
| simulator snapshot `measForm: !!APP.measForm` and command `{op: 'meas', values}` | build_simulator.js:145, :162-167 |
| tour target `frame:#measForm` | sim_tours.js:268-271 |

**Styles** (app.css:170-194): `.formpage` (fixed, full screen, scrolls), `.fcol` (max 900 px, bottom padding for the
bar), `.fhead`, `.fprev`, `.fgrid` (1 column; **2 columns at min-width 700 px**, :194), `.ffield` + `label`,
`.multi`, `.toggle` (+ `.on`), `.vid` (mono accent line), `textarea`, `.fbar` / `.fbar-in` (max 900), `.fmsg`.

**Tests** (poc/run_app.js): the hook on the real app store (step 19, :485-547), the pure helpers (step 20, :549-579), save
-> outbox -> server -> `measurementSynced` (step 21, :581-613), quarantine (step 22), the SW reload glue with a stub
`APP` and `{value}` objects for the inputs (step 29, :753-772), an old server (step 31). `appOpenMeasForm` itself is
never run in Node (it needs `document.body`); the browser smoke covers it.

---

## 8. Ports, phone, events (app/app_ports.js)

`createAppPhone(opts)` (:51-350) -> `phone`:

- `phone.ports` (:164-184) = `{store: store.ports, chat, cache, ai, pdf, lock, clock, uuid, dedupe, ui}`: the object
  every core function takes. `lock.run(fn)` opens a collector so the rows appended inside become ONE outbox group
  (:166-172); `clock.now` = wall clock + the server offset (:61-63, :173); `uuid` = `appUuid` (:25-41);
  `ui.measureForm` the only screen hook (:181-183).
- `phone.deliver(update)` (:217-239): serialised on `phone.chain`; runs `processUpdate` synchronously, swaps in the ⏳
  line when an AI job was queued, then ONE `store.commit()` and only then `emit('change', {kind: 'update', durable})`.
- `phone.commit(why)` (:241-244): the same commit outside a delivery, `emit('change', {kind: why, durable})`. **Not
  serialised on `phone.chain`**; harmless because every core write is synchronous and `store.commit` is chained
  (app_store.js:732-746), but a form must not assume its ops ride alone in their transaction.
- Events (`phone.on/off/emit`, :73-84): `change`, `sync`, `syncstate`, `progress`, `revoked`, `enrolled`, `ready`,
  `measureform`; a listener's exception is logged, never thrown.
- `phone.staffId()` = `store.meta.staff.id` as a string (:68-69); `phone.botSay` (:87-92); `phone.now`, `wallClock`.
- `phone.sim.*` (:260-340): Telegram-shaped updates for the UI and the tests: `start(payload)`, `text`, `voice`,
  `voiceBlob`, `photo(preset)` (a sim media record for Node), `photoBlob(rec)` (a real capture), `photoMessage`,
  `tap(messageId, data)`, `lastBot`, `button`, `tapLast`, `tapAny`.
- **AI** (:129-153): `queueAi(kind, file, ctx, extra)` stores the job in the media store (`status: 'queued'`, a unique
  `jobId`, `itemId` from `extra.itemId`, else the core state `new_item`, else `file.itemId`) and sets
  `phone.pendingAi`; every `ports.ai.*` throws `appPendingAiError(job)` (:43-49), so the core always takes its
  fallback. `queueAi` is a closure: a form reaches it only through `phone.ports.ai.describePhoto(file, ctx)`.
- `chat.savePhoto(fileId, itemId)` sets `media.itemId` and returns `'local://' + fileId` (:119-122);
  `chat.getFile(id)` returns the media record (:118).

---

## 9. The store (app/app_store.js)

- **Stores** (`APP_STORES`, :32-46): meta, items, customers, settings, messages, ledger (indexes groupId, itemId, day,
  seq, synced), outbox, media, chat, cache, errors, thumbs, measurements (IndexedDB `salestag` v2).
- **Recorded writes**: every change pushes an op (`put/del/clr`, :231-234); `store.commit()` flushes them in ONE
  adapter transaction; a failed write puts the ops back for the next commit (:732-746). The memory adapter has
  `holdWrites / release / failNext / transactions` for tests (:75-121).
- **Ledger append** (`ports.appendLedger`, :294-311): stamps `receiptNo = syncReceiptNo(shop, letter, ++counter)` on
  every SALE row without `reversesTxId`/`receiptNo` (:296-299: the basket bug, map-basket-readers 2.11 and 3.3 rule
  4); `synced: false`, `localSeq`; updates the stock map (`addStock`, :241-244); inside a collector the row waits for
  `closeCollector`, which pushes ONE `{kind: 'group', groupId: rows[0].groupId, txs}` (:658-663); outside, one entry
  per row. `writeGroup` (core_ledger.js:67-76) runs one `lock.run` per call, so **N commit calls = N groups = N outbox
  entries**, and nesting `lock.run` does not merge them (the inner collector pushes its own entry). A basket is one
  `writeGroup` call with all its rows.
- **Items**: `getItem(id)` returns a view with `stock` (from the stock map) and `status` (BLANK when the name is empty,
  SOLD for a UNIQUE at stock <= 0, else ACTIVE) (:258-268, :284); `listItems(shop)` includes blanks (:285);
  `updateItem(id, fields)` writes the item and queues `{kind: 'item', id, fields, baseRev}` at once (:286-293). **There
  is no addItem**: a new piece is always an existing blank tag (pre-created rows, `name: ''`, `type: ''`;
  sim_seed.js:98); both shops' items are on every phone (run_app.js:85).
- **Customers**: `addCustomer({name, phone, note})` -> id `C-<8 hex>`, queued `{kind: 'customer'}` (:325-333);
  `updateCustomer` (:334-340); `listCustomers`, `getCustomer`. Search helpers in the core: `findCustomers` (phone digits
  or name, core_ledger.js:1446-1468), `matchCustomers` (:1471-1475), `recentCustomers(ports, shop, n)` (:1398-1414).
- **Settings and prefs**: `getSetting(k, d)` - a per-device pref `setting:<k>` wins over the pulled Settings (:341-344;
  run_app.js step 36 proves it for `sale_flow`); `store.setPref/getPref` in `meta.prefs` (:577-578: fontSize,
  cameraOk, setting:text_cards, setting:sale_flow).
- **Option lists offline**: `addListOption(rec, seedRows)` applies to the local `lists_json` at once and queues
  `{kind: 'list'}` (:353-362); the core's `addListOptionByLabel` / `setListDetail` call it (core_ledger.js:762-805).
- **Receipt numbers per device**: `meta.receiptLetter` (from enrolment) + `meta.receiptCounter`, gap-free per phone
  (run_app.js:218).
- **Stock map**: `S.stock`, incremental on every append, applied pull and removal (:241-256, :398); `store.stockOf(id)`.
- **Media** (:629-653): `addMedia(rec)` keeps a Blob by reference (`put` without cloning), id `<kind>_<n>`;
  `updateMedia`, `getMedia`, `removeMedia`, `queuedMedia()`. Nothing prunes media on its own.
- **Cache** (:616-627): `cacheGet/cachePut(k, v, ttlSec)/cacheRemove`, persisted with expiry; this is where the core's
  per-user state (`st:`, `li:`, `lg:`, `card:`, `tap:`) and the form drafts live.
- `store.nextUpdateId()` -> `'app-<n>'` (:584); `store.wipe()` keeps only the font size (:749-762).

---

## 10. Sync (app/app_sync.js): what a commit queues and how a group reaches the server

- **Outbox entry kinds**: `group` (ledger rows of one group), `item`, `customer`, `list`, `measurement`, `notice` (an
  owner ping relayed through Telegram), `error`. The push order is by kind, then commit order: customers, items, lists,
  groups, measurements, notices, errors (`SYNC.ENTRY_KINDS`, core_sync.js:75; `syncPlanPush`, :1362-1377), never
  splitting a group, at most 200 rows per batch unless one group is bigger. So a buyer or a new piece written by a form
  reaches the server before the group that references it.
- **One round trip** (`runSync`, :249-323): push (resend a lost batch with the same batchId) + pull in one `api=sync`;
  `syncApplyPushResults` acks (rows marked synced with their Seq), shows a quarantine (`app_rejected`,
  `app_already_undone`) or flags (`app_flagged`) as bot lines (:231-238, :274-281); `syncApplyDelta` applies the pull,
  re-pulls a day whose checksum differs.
- **Server checks on a group** (core_sync.js:409-420): every row valid (`syncValidateTx` :372-394: shop, day, integer
  qty/amount/cash, item id on SALE/RESTOCK/RETURN, any string `source`), `staffId === device.staffId`, the item exists,
  the group in scope (`syncGroupInScope` :361-370: a staff phone may write only its shop's rows unless the row
  references a group or is a transfer), one groupId for all rows. Money rules (OVERPAID, stock_negative) are flags,
  not refusals.
- **When it runs** (`attach`, :524-540): after a `change` of kind `update` only (debounced 1.5 s), on launch, on
  `online`, on foreground. **A form's `phone.commit(why)` does not trigger it**: the form calls
  `sync.scheduleSync()` itself, as `appMeasCommit` does.
- **AI jobs** (:371-426): `flushAiJobs` runs after every successful sync; one `api=ai` call per queued job with the
  blob as base64 (`appBlobToBase64`, browser only) or the sim data (Node); quota -> retry later, failure -> `status:
  'failed'` + `ai_down`, done -> `replayJob`.
- **Pending lines** (`pendingLines`, :496-518): a group shows `describeRow` of its first live row (map-basket-readers
  for the basket wording); `ui_pending_item`, `ui_pending_customer`, `ui_pending_list`, `ui_pending_meas`,
  `ui_pending_ai`.
- **The precedent for "an older server"**: a pull whose `caps` lacks `dueDay` stores Settings with `sale_flow = quick`
  and `cursor.quickForced` (core_sync.js:83-85, :1437-1468; run_app.js step 40). A round-6 write shape the old bot
  cannot read (a basket) can gate the forms the same way (a NEW cap) so a rolled-back bot never receives it.

---

## 11. CSS (app/app.css): what a form can reuse, and the collisions

- Tokens on `:root` with dark mode twice (prefers-color-scheme guarded by `:not([data-theme="light"])`, and
  `[data-theme="dark"]`) (:7-33); 18 px body, A+/A++ via `html[data-font]` (:37-39); every tap target >= 56 px
  (`--tap`), keys 64 px (`--key`) (:16).
- Buttons `.primary`, `.good` (the green Save), `.ghost`, `.danger`, `:disabled` (:40-46); inputs and textareas 56 px,
  full width (:48).
- Reusable inside a form: `.seg` + `.on` (segmented choice: how paid, shop) (:147-149), `.stepper` + `.n` (count)
  (:98-100), `.tiles` (recent items) (:129-133), `.kb.grid` (3-column big buttons, 72 px) (:94-95), `.formpage .toggle`
  (two-state chips) (:185-187), `.formpage .vid` (an accent mono line: totals, profit) (:188), `.card` (:81-87),
  `.muted`, `.small`, `.num` (tabular digits) (:49-52).
- `#app` is max 600 px wide (:57), so the home stays phone-width on a laptop; a `.formpage` column is max 900 px and its
  `.fgrid` turns 2-column at 700 px (:172, :194), the "laptop for lists" width the owner's wide frame uses.
- **Collision**: `.chip` is the header's sync chip with sync colours (:61-67, `#chip` has a click handler); recent-buyer
  chips need a NEW class name.

---

## 12. Strings (app/app_i18n.js) and the labels a form can reuse

`APP_MSG` (app_i18n.js:11-151) is merged into `MSG` at load where the key is free (:152-156), so `t(ports, key)` finds
it and a Messages-tab row with the same key wins; `appT` works before a store exists (:159-165). The header asks for a
native speaker's rewrite. App chrome keys go here; a key the bot also shows goes to core_messages.js.

Existing labels a form can take verbatim (core_messages.js unless marked):

| Use | Key | Text |
|---|---|---|
| Save | `ui_meas_save` (app_i18n.js:147) / `btn_save` (:344) | ✅ သိမ်း |
| Close / ask | `ui_btn_close` (app_i18n.js:37), `ui_meas_close_ask` (app_i18n.js:149) | ✖️ ပိတ် · ရိုက်ထားတာတွေ မသိမ်းဘဲ ပိတ်မလား? |
| Count | `ui_keypad_qty` (app_i18n.js:33) / `btn_qty` (:16) | 🔢 အရေအတွက် |
| Sold | `sold_done` (:52) | ✅ ရောင်းပြီး {qty} ထည် · {amount} ကျပ် · လက်ကျန် {stock} |
| Undo / receipt | `btn_undo` (:27), `btn_receipt` (:42) | ↩️ မှားသွားတယ် · 🧾 ဘောက်ချာ |
| Buyer | `btn_customer` (:140), `credit_ask_customer` (:98), `btn_no_name` (:424), `btn_new_customer` (:45), `ask_phone` (:146) | 👤 ဝယ်သူ · 👤 ဝယ်သူ ဘယ်သူလဲ? · 🚫 နာမည် မရှိ · ✏️ နာမည်အသစ် · 📱 {customer} ၏ ဖုန်းနံပါတ် (Viber) ရိုက်ပါ |
| How paid | `sale_ask_method` (:432), `btn_cash` (:132), `btn_wallet` (:425), `btn_bank_transfer` (:426), `btn_split` (:376) | 💰 ဘယ်လိုပေးလဲ? · 💵 ငွေသား · 📲 {method} · 🏛 ဘဏ် · 💵+🏦 ခွဲပေး |
| Paid now | `btn_paid_all` (:427), `btn_credit` (:41), `sale_need_buyer` (:438) | ✅ အကုန် {amount} · 💳 မကျေသေး · ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည် |
| Promised day | `btn_days` (:238), `btn_due_type` (:240), `btn_due_unknown` (:428) | {n} ရက် · ✏️ ရက်စွဲ ရိုက် · ❓ မသေချာ |
| Sold meanwhile | `sale_gone` (:444) | ⚠️ ရောင်းပြီးသားပါ · မမှတ်ပါ |
| New piece | `photo_seen` (:83), `btn_pending` (:48), `btn_sample_on` / `btn_sample_off` (:49-50), `item_created` (:85) | 📸 {name} · {category} · ⏳ စျေး မသတ်မှတ်ရသေး · 🧵 နမူနာ: ဟုတ် · 🧵 နမူနာ: မဟုတ် · 🆕 မှတ်ပြီးပါပြီ |
| Owner ping | `price_ask_owner` (:193) | ⏳ {id} · {name} · စျေး သတ်မှတ်ပေးပါ |
| Jobs | `btn_restock` (:24), `btn_expense` (:160), `btn_pay` (:37), `btn_deposit` (:38), `btn_return` (:25) | 📦 ကုန်ရောက် · 💸 ကုန်ကျ · 💰 ငွေလက်ခံ · 📥 စရံ · ↩️ ပြန်အမ်း |
| Expense | `exp_ask_cat` (:162), `exp_ask_note` (:165), `expense_done` (:55) | 💸 ဘာ ကုန်ကျစရိတ်လဲ? · 📝 မှတ်ချက် ရိုက်ပါ (ဥပမာ နေ့လယ်စာ ၃ ယောက်) · 💸 ကုန်ကျစရိတ် {amount} ကျပ် · {cat}{note} · {method} မှတ်ပြီးပါပြီ |
| Restock done | `restock_done` (:53) | 📦 ကုန်ရောက် {qty} ထည် · လက်ကျန် {stock} |
| Item categories | `CFG.CATEGORIES` (core_config.js:23) | ထမီ · လုံချည် · အင်္ကျီ · ဝတ်စုံ · အခြား |

NEW labels the form chrome will need (proposals, Burmese drafts for the spec to confirm):

| Key (NEW) | Proposed text |
|---|---|
| `ui_home_sell` | 🛒 ရောင်းမယ် |
| `ui_home_new` | 🆕 ပစ္စည်းအသစ် |
| `ui_form_name` | ပစ္စည်း အမည် |
| `ui_form_cost` | 🧵 အရင်း |
| `ui_form_price` | 💰 ရောင်းဈေး |
| `ui_form_profit` | 📈 အမြတ် {amount} ကျပ် ({pct}%) |
| `ui_form_ai_wait` | ⏳ ဓာတ်ပုံကို စစ်နေသည် · အမည်ကို ကိုယ်တိုင် ရိုက်လည်း ရပါသည် |
| `ui_sale_add` | ➕ Tag ထပ်ဖတ် |
| `ui_sale_total` | စုစုပေါင်း {total} ကျပ် |
| `ui_sale_other_shop` | ⚠️ {shop} ၏ ပစ္စည်းပါ · ဒီဆိုင်မှာ မရောင်းနိုင်ပါ |
| `ui_sale_twice` | ⚠️ {id} ထည့်ပြီးသားပါ |
| `ui_form_saving` | ⏳ သိမ်းနေသည်… |

---

## 13. Dev page, build tool, simulator frame

- `app/dev/index.html`: a 390 x 780 phone frame (:22) with its own copy of the shell (:37-55), the unbundled files
  (:110-130), a fake server over the demo world, the memory adapter (or `#idb`), `bootApp(..., {adapter, transport,
  noServiceWorker: true})` (:151-156). Bench controls: enrolment codes, offline/latency/Gemini outage, `app_voice`, the
  `sale_flow` checkbox "steps (off: quick)" (:70, :136, :207-210), Telegram-route buttons, devices; autopilot
  `?enroll=sister&open=S1-0002&screen=...&latency=0` (:170-186). **poc/run_app.js:1142-1143 pins the `'steps'` line and
  the checkbox**: R6 (`form` | `quick`) touches a named check.
- `tools/build_app.js`: section 1 above; secrets scan (:31-47, :97-98); precache list (:91); nothing per file to edit
  for a form unless a new file goes into `APP_FIRST`.
- `poc/build_simulator.js`: each device is an `<iframe srcdoc>` with its own `APP` (:9-13); `SIM_FRAME.snap()` reports
  `measForm` (:141-147); commands `hot`, `mark`, `open`, `menu`, `screen`, `tap`, `text`, `fill`, `enroll`, `sync`,
  `meas`, `clock`, `snap`, `click` (:150-172). A form needs its own snapshot flag and fill/save commands for the tours
  (R8).

---

## 14. The Node harness (poc/run_app.js)

- Loads core + sim + app into one global scope (:17-24); `check(cond, label, detail)` and `step(title)` (:27-31);
  `world = seedSimWorld(createSimWorld())`, `server = createFakeServer(world)`, a synchronous `transport` with an
  offline switch (:36-44); fake `timers` so `scheduleSync` is observable (`timers.queue`, :45-50);
  `makePhone(name, extra)` -> `{phone, sync, adapter, store, ports}` on a memory adapter with the world's clock (:55-61);
  enrol with `sync.enroll(server.mintEnrollCode(sister, label).code)`.
- Rounds as functions: `main` (steps 1-14), `round4()` (15-31, :357), `round5()` (32-40, :890), called at :296-297; a
  round-6 function would be added the same way.
- **Fake DOM** (:850-888): `fakeDocument()` has `createElement` (attributes, class, text, children, listeners,
  `click()`, `hidden`, `value`) and `createTextNode` only: no `body`, no `querySelector(All)`, no `focus`, no style.
  `withFakeApp(P, extra, fn)` points `APP` at a real test phone with that document, an `#overlay` element, and a
  `win.setTimeout` that collects callbacks (`scheduled`). It is enough for `appRenderMsg`, `appStepper`,
  `appInputBar`, `appOpenNumberKeypad`; not for `appOpenMeasForm`.
- **How the measurement form is tested**: the pure helpers on an enrolled phone (model, draft round trip across a
  restart over the same adapter, save refusals, the outbox entry shape, `appMeasCommit` scheduling exactly one sync at
  `APP_SYNC_DEBOUNCE_MS`, the server row, the synced record), and the glue (`appMeasFormSave`, `appCloseMeasForm`) with a
  hand-made `APP` stub whose inputs are `{value}` objects and whose adapter fails once (`failNext`, step 29).
- Helpers a form test would reuse: `lastLocal(phone)` (:53), `rowsOf(txId)` (:52), `sStock(id)` (:51), the memory
  adapter's `transactions` (prove one transaction carried rows + outbox + chat, as step 3 does, :110-113),
  `holdWrites/release` (prove nothing is painted before the write, :94-109), `phone.sim.photo(preset)` for a photo
  without a browser.

---

## 15. The pattern a new form must follow

1. **Model** `appXxxModel(ports, store, req)` - pure: reads only the store/ports (items with stock and status,
   customers, `payMethodsByKind`, `expenseCategories`, `saleDuePresets`, `pricePresets`, the staff), restores a draft
   if one is kept, returns plain data. Validation helpers pure too (`appXxxCheck(model, input)` -> `{ok, reason, key}`).
2. **Save** `appXxxSave(phone, req, input)` - pure of the DOM: re-reads what may have changed since the form opened
   (a UNIQUE sold by another device, a price set by the owner), refuses with a reason (the DOM shows the message),
   else calls the core write(s) on `phone.ports` with the enrolled staff (section 16), drops the draft in the SAME op
   batch, pushes the reply card, returns `{ok, groupId, ...}`. Writes nothing durable itself.
3. **Commit** `appXxxCommit(phone, sync)` - `phone.commit('<kind>')` then `sync.scheduleSync()` when ok; resolves to
   true/false. The ✅/sold card is painted after it resolves `true` (the app's rule, app_ui.js:11-12); on `false` the
   ops stay in memory and `appOnChange` already toasts `ui_not_saved`.
4. **Draft** - `<kind>draft:<staffId or key>` in the persisted cache via `cachePut` (TTL one day), written on every
   change, the durable commit debounced (`APP_MEAS_DRAFT_MS` 400 ms) with a `change` kind that `appOnChange` ignores
   (as `measdraft`, :354-357); a photo is referenced by its media id, never embedded.
5. **DOM** - `appOpenXxx(req)`: `appCloseOverlay()`, `appStopScanner()`, one `div#xxxForm.formpage[role=dialog]` on
   `document.body`, `.fcol` with `.fhead` (title + ✖️), sections, a fixed `.fbar` with `.fmsg` and ONE `.good` Save that
   disables itself while saving (the core's tap dedupe, core_bot.js:445-449, only guards callbacks, not direct calls);
   `appCloseXxx({ask})` asks when dirty. Labels through `APP.tt` only; every input `aria-label`; numbers via
   `inputmode` or a keypad that renders above the form.
6. **Join the hooks** of section 7: an `APP.<form>` field, revoked, the SW `canApply`/`controllerchange`/reload on
   close, `appOnChange` for the draft kind, the `visibilitychange` scanner guard, the simulator snapshot and commands.
7. **Files** - keep it in app_ui.js, or add the new file to the four lists of section 1.
8. **Tests** - a `round6()` in run_app.js: the model and save on an enrolled phone; one transaction (`adapter.
   transactions`) carrying the rows, the outbox entry, the chat card and the draft removal; sync to the fake server
   and assert `world.ledger` and `server.stock`; a restart over the same adapter restores the draft; each refusal; each
   new check failing without its feature (R9).

---

## 16. Calling the core from a form: ports, staff, and which write

```js
var phone = APP.phone, ports = phone.ports, uid = phone.staffId();
var staff = ports.store.getStaff(uid);   // a copy of store.meta.staff {id, name, shop, role}
var base = { staff: staff, source: CFG.SOURCE.BUTTON, updateId: APP.store.nextUpdateId() };
// ... one core write (table below) -> r = {groupId, txs, ...}; then the reply card, e.g.
ports.chat.sendMessage(uid, saleCardText(ports, r.groupId), saleCardKeyboard(ports, r.groupId, '', customer));
setLastItem(ports, uid, itemId); setLastGroup(ports, uid, r.groupId);   // so a later "Wave နဲ့ ..." finds the sale
APP.showScanner = false;   // the home shows the card (appOnChange does this for 'update' only)
// then appXxxCommit(phone, APP.sync)
```

- `staff` must be the enrolled staff: the server refuses a row whose `staffId` is not the device's
  (core_sync.js:416). `when` is optional (`newTx` uses `ports.clock.now()`, offset-corrected, core_ledger.js:31).
  `source`: any string passes the server (core_sync.js:384-388) and nothing reads it except the Sheet column
  (gas_store.js:402, gas_sync.js:164), so a NEW `CFG.SOURCE.FORM` is possible (core_config.js:35 has none).
- Clear the core's per-user state (`clearState(ports, uid)`) when a form opens from home, as `startMeasureFor` does
  before its hook: a half-finished guided flow would otherwise keep `appInputBar` and the SW `canApply` (`!appState()`,
  app_ui.js:1254) busy.

| Form | Core write today | Shape and notes |
|---|---|---|
| Sale (R2) | `commitSaleGroup(ports, {item, qty, unitPrice, paid, method, bankPart, mixed, customerId, dueDay, priceChanged, staff, source, updateId})` (core_ledger.js:824-855) | ONE item. A basket needs a NEW multi-line write under one `writeGroup` with the rules of map-basket-readers 3.2-3.3 (fill-in-order cash, DueDay on every SALE row, buyer on every row, PAYMENT last, one receipt number, one row per item). Buyer: `saleResolveBuyer(ports, draft)` (core_bot.js:3140-3148) or `matchCustomers` + `ports.store.addCustomer`. Re-check each UNIQUE at Save (`saleCommit` does, core_bot.js:3161-3165). A buyer with a free deposit and a balance: the core offers `credit_use_deposit` with CD| buttons (core_bot.js:3178-3183); the form must decide. Reply: `saleCardText` / `saleCardKeyboard` (core_bot.js:3194-3225; first row only today). |
| New piece (R3) | none; `newItemCost` (core_bot.js:2172-2193) is a bot handler | `ports.store.updateItem(id, {name, category, type, price, cost, sample, photoUrl, photoFileId, createdAt, createdBy})` (queues `item`) then `commitRestock(ports, {item, qty: count, staff, source: CFG.SOURCE.PHOTO, note})` (core_ledger.js:857-864, one RESTOCK row with qty N) then `notifyOwners(ports, price_ask_owner, priceButtons)` when the price is pending (core_bot.js:2193; `priceButtons` :2197-2200, `notifyOwners` :2221-2226; on the phone it becomes an outbox notice). Telegram writes `type: UNIQUE` always (:2183); count > 1 needs `CFG.ITEM_TYPE.SKU` (core_config.js:33), which changes the card's buttons (core_bot.js:219-232). A shared NEW core function (for the form and the Telegram review card) fits R5/R9. Profit and its percentage: no core helper; a NEW pure helper. |
| Restock (R4 should) | `commitRestock(ports, {item, qty, staff, source, note})` | One call = one group. Several tags in one Save: N groups (N undo cards) or one `writeGroup` with N RESTOCK rows (one undo). A UNIQUE item has no R| button today (core_bot.js:219-224): restocking one is a type decision. |
| Expense (R4 should) | `commitExpense(ports, {shop, amount, category, method, note, staff, source})` (core_ledger.js:882-890) | Categories `expenseCategories(ports, shop)` (core_ledger.js:271-275), add on the fly `addListOptionByLabel(ports, 'expense_category', label, staff)` (offline). The owner picks a shop (Telegram asks `exp_ask_shop`). |
| Payment (could) | `commitPayment(ports, {groupId, amount, method, staff})` capped at what is owed (core_ledger.js:910-924) | Needs a credit group: `openCredits(ports, shop)` (core_ledger.js:1219) filtered by buyer, as `showPayList` does (core_bot.js:1818-1826). |
| Deposit (could) | `commitDeposit(ports, {shop, customerId, amount, method, note, refGroupId})` (core_ledger.js:928-938) | |
| Return (could) | `commitReturn(ports, {item, qty, unitPrice, refund, method, customerId})` (core_ledger.js:866-879) | |
| Method lists | `payMethodsByKind(ports, shop)` -> `{wallets, banks}` (core_ledger.js:138-148), `methodLabel` (:197-204) | A NEW account on the fly: `addListOptionByLabel(ports, 'pay_method', label, staff, {kind})` (core_ledger.js:762-788). |

Every one of these runs synchronously, appends through `ports.lock.run`, updates the stock map and the outbox in memory,
and becomes durable with the form's `phone.commit`.

---

## 17. Offline photo capture and the photo AI

**Capture today.** `#photoInput` = `<input type=file accept=image/* capture=environment>` (index.html:38) opens the
phone's own camera app, works offline; `appPickPhoto` clicks it (app_ui.js:1225-1228); the change handler (wired once,
:340) calls `appOnPhotoPicked` -> `appDownscalePhoto(file, 1280)` -> `{blob, dataUrl, width, height, mime}` (JPEG
~150-250 KB, app_media.js:47-68) -> `phone.sim.photoBlob(rec, '')` -> `store.addMedia({kind: 'photo', blob, dataUrl,
...})` -> a chat photo message -> the core's `handlePhoto` (core_bot.js:2095-2131).

**What `handlePhoto` does on a blank tag** (state `new_item`): `savePhoto` (on the phone: `media.itemId = id`, url
`local://<mediaId>`), `photoFileId = mediaId`, `describePhoto` (on the phone: queued, throws), name =
`'ပစ္စည်း ' + id` placeholder, category `အခြား`, then the price screen (:2112-2131).

**What a new-piece form needs:**

1. A photo target: the `#photoInput` change must go to the open form (a callback on `APP`), not to the core.
2. The media record: `store.addMedia({kind: 'photo', blob, dataUrl, mime, status: 'file'})`; `chat.savePhoto(media.id,
   itemId)` for the url and `media.itemId`; the item gets `photoUrl: 'local://<id>'` and `photoFileId: <id>` so the
   app's card finds the picture (`appPhotoNode` reads the media by `m.photo`, app_ui.js:614-623). Preview in the form
   from `dataUrl`. In Node: `store.addMedia({kind: 'photo', sim: {meta: preset, visual: preset.visual, mimeType}})` as
   `phone.sim.photo` does (app_ports.js:285-288); the fake server's mock AI reads `job.sim` (poc/sim_sync.js:183-186).
3. The AI job: `ports.ai.describePhoto(store.getMedia(id), {categories: CFG.CATEGORIES})` inside a try/catch (it always
   throws `PendingAi` after queueing; `itemId` comes from `file.itemId`, so `savePhoto` must run first). Then
   `sync.syncNow('photo')` when online: the job goes out only after a SUCCESSFUL sync (`flushAiJobs`, app_sync.js:352-353).
4. The Drive upload rides the AI job: the server describes AND saves the JPEG to Drive and sets the item's `photoUrl`
   (gas_sync.js:308-315). A job that ends `failed` is never retried (only `queued` jobs are flushed, app_store.js:653),
   so that photo never reaches Drive; `quota` retries after `retryAfterUntil` (app_sync.js:411, :417).

**Hazards for the form (none exists in the bot flow, where the item is saved before the result returns):**

- **The replay renames a blank item behind the form.** `replayJob` (app_sync.js:388-395) calls `updateItem(itemId,
  {name, category})` when the item's name is blank or the placeholder, and says `photo_seen`. If the result arrives
  while the form is open (the item still blank), the tag becomes ACTIVE with no type/price, an `item` entry is queued,
  and an abandoned form leaves a half-registered piece. The form must own its job (mark it, or queue it only at Save)
  and read `media.result.desc` itself for the pre-fill (`store.updateMedia(job.id, {status: 'done', result: j})`,
  :419), filling the name only if the seller has not typed one.
- **No synchronous AI**: even online the pre-fill needs push + pull + `api=ai` (Gemini); the form must be fully usable
  without it (`ui_form_ai_wait` NEW). Offline the name stays what the seller typed or the placeholder; today's late rule
  (rename only a placeholder) then applies after Save.
- **No ⏳ line**: `markWaiting` runs only inside `deliver` (app_ports.js:225); a form-queued job shows only in the chip
  (`aiQueued`, app_sync.js:485) and `ui_pending_ai`.
- **Storage**: each photo keeps the Blob AND the dataUrl (~2x); nothing prunes media; an abandoned form's photo should
  be removed (`store.removeMedia`). The blob is kept after a done photo job (app_sync.js:419).
- **Telegram later**: the server stores the phone's `photoFileId` (a local media id such as `photo_3`) verbatim
  (core_sync.js:719-739); `sendItemCard` prefers `photoFileId` (core_bot.js:240-242), Telegram rejects it and
  `gasChat.sendPhoto` degrades to text (gas_telegram.js:39-46). So an app-registered piece shows no photo in Telegram
  even after the Drive upload, today already (the in-app chat flow writes the same). Worth a line in the spec.
- The scanner (`getUserMedia`) and the capture input both need the camera: stop the scanner before opening the capture.

---

## 18. What the home needs to become a seller's home

1. **Job tiles** above or below the scanner: Sell (`ui_home_sell` NEW), New piece (`ui_home_new` NEW), Restock
   (`btn_restock`), Expense (`btn_expense`); could: Payment (`btn_pay`), Deposit (`btn_deposit`), Return (`btn_return`).
   A big grid in the `.kb.grid` / `.tiles` style (72 px), in `appRenderHome`'s scanner state (:486-495).
2. **A scan router** for a scan with no form open: blank tag -> the new-piece form (with the camera next); own-shop
   item -> the sale form with that line (or the item card when the seller wanted to look: the spec decides); other-shop
   item -> refused with `ui_sale_other_shop` (NEW) or the read-only card; not found -> today's toast. The same router
   for the tag keypad, a recent tile, a find result and the simulator's `{op: 'open'}`.
3. **Recent items** stay (`appRecentPanel`, 6 tiles; staff shop only), tap = the router.
4. **After Save**: the core-rendered sold card (undo, receipt, 💰 while owed) as the latest card, or a slim "last
   sale" strip over the scanner with the same buttons; undo works from any message for 30 minutes
   (`CFG.UNDO_WINDOW_MIN`, core_config.js:9).
5. **The ☰ menu stays** for everything else (customers, reports, accounts, 📏 measurement, 📲), and `sale_flow = quick`
   (R6; also forced by an old server's caps) returns today's card path.
6. **Bottom bar labels** move to `t()` if they change (today hard-coded in two shells, section 3).
7. **Guards**: the scanner must not restart behind an open form (`visibilitychange`, :346-349; `appStartScanner`,
   :533); a form opened from home clears a stale core state.
8. Optional: a today line (`M|today` exists in the core, `answerToday`), the sync chip as it is.

---

## 19. Traps and open points for the spec

1. `#overlay` (z 30) under `.formpage` (z 32): keypads invisible inside a form (section 6).
2. Scanner and tag keypad hard-wired to `appOpenTagId`; `onDecode` fixed at scanner creation (section 4).
3. `#photoInput` hard-wired to the core (section 17).
4. `phone.commit(kind)` never schedules a sync; `sync.attach` reacts to `update` only (app_sync.js:525-528).
5. `appOnChange` hides the scanner on `update` only; a form must set `showScanner` itself.
6. The receipt counter stamps every SALE row (app_store.js:296-299); `commitSaleGroup` is one item; N commit calls are N
   groups (section 9).
7. The photo AI replay vs an open form; no synchronous AI; failed job = photo never on Drive (section 17).
8. New piece: Telegram writes UNIQUE; count > 1 needs SKU; a UNIQUE has no restock button (section 16).
9. A form's Save is not covered by the core's double-tap dedupe (core_bot.js:445-449): disable the button.
10. `appMeasFormSave` closes before the commit resolves; a sale must paint its card only after `phone.commit` resolves.
11. Checks that pin today's behaviour and will be named by the spec: run_app.js:1142-1143 (dev page `steps` +
    checkbox), check_simulator.js:81-87 (`FRAME_FILES` = `APP_FIRST`), the round-5 guided-sale steps 32-40
    (run_app.js:890-1270) if R5 retires the step mode, sim_tours.js:268-271 (`frame:#measForm`).
12. `.chip` is taken by the sync chip (section 11).
13. The dev page's body-level form covers the whole window, not the phone frame (section 6).
