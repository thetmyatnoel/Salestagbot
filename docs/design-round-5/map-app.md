# map-app.md — the phone app (app/) and its test bench, as built after round 4

Mapper's report for round 5 (2026-11-11). Every claim cites `file:line` of the current tree. Burmese labels
are quoted from `apps-script/core_messages.js` (MSG) and `app/app_i18n.js` (APP_MSG), never translated here.
Section 16 lists what a guided sale needs from the app; section 17 what a simulator that embeds the real app
needs; section 18 the surprises.

## 1. Files, load order, one global scope

The app is the unchanged core plus seven `app_*.js` files, all plain ES5 in ONE global scope (no modules).
Three places list the same order and must stay in step:

| Where | Order | Evidence |
| --- | --- | --- |
| `tools/build_app.js` | `CORE_FIRST` = core_config, core_burmese, core_messages, core_ai_prompt, core_ledger, core_report, core_bot, core_sync; then any other `apps-script/core_*.js` alphabetically (today only `core_orders.js`); then `APP_FIRST` = app_i18n, app_store, app_ports, app_sync, app_scan, app_media, app_ui; then any other `app/app_*.js` | build_app.js:29-30, 55-58; the built list is in app/dist/version.json `files` (16 files) |
| `app/dev/index.html` | the same core files, then `poc/sim_mock_ai.js`, `poc/sim_ports.js`, `poc/sim_seed.js`, `poc/sim_sync.js`, then `app/vendor/jsQR.js`, then the seven app files in APP_FIRST order | dev/index.html:109-129 |
| `poc/run_app.js` | `FILES` = CORE_FIRST + CORE_REST (read from disk, sorted) + the four poc sim files + the seven app files, each run with `vm.runInThisContext` | run_app.js:17-24 |

`app_i18n.js` merges APP_MSG into MSG at load so `t(ports, key)` finds the `ui_*` keys (app_i18n.js:149-153);
`t()` reads `ports.store.getMessage(key)` first (the Sheet's Messages tab), then MSG (core_messages.js:426-432),
so a Messages row with an `ui_*` key overrides app chrome too (app_store.js:474 comment).

`app/config.js` is the one per-deployment file (public values only: `apiUrl`, `botUsername`, `appName`;
config.example.js:10-17); the build copies it into dist and refuses secrets (build_app.js:31-35, 72, 97-98).
D9 forbids touching it.

## 2. Boot: `bootApp(config, opts)` (app_ui.js:247-309)

- `var APP = null` is the single UI singleton (app_ui.js:16); every `app*` UI function reads it. One app per page.
- `opts.win` / `opts.doc` default to `window` / `document` (252-253); platform from the UA (254-255).
- Adapter: `opts.adapter`, else `createIdbAdapter()` when available, else `createMemoryAdapter()` (256-260);
  `adapter.onreplaced = appOnDbReplaced` (261).
- `phone = createAppPhone({adapter, platform, name: 'app', transport: opts.transport || null})` (262);
  `sync = createAppSync(phone, {apiUrl, transport, platform, online, label})` (266); `online()` trusts
  `phone.online === false` or `navigator.onLine === false` (265).
- `APP` fields (267-273): `config, opts, win, doc, phone, sync, store, platform, screen ('boot'|'enroll'|'home'|
  'history'|'sync'|'settings'), showScanner, qty {msgId, n}, keypadAutoFor, scanner, videoEl, scanState, scanError,
  recorder, installEvt, updateReady, reloadOnControl, tapStart, toastTimer, iosHintDismissed, findText, findResults,
  persisted, enrollBusy, enrollError, enrollProgress, pdfBusy, thumbAsked, offlineToastShown, lastRenderedRev,
  justStarted, rendering, measForm, reloadAfterForm`. `APP.$ = doc.getElementById` (274-275); `APP.tt = t(ports, …)` (277-278).
- After `phone.load()` (283): `appApplyPrefs`, `appWireEvents`, then listeners `phone.on('change', appOnChange)`,
  `'sync' → appRender`, `'syncstate' → appRenderHeader`, `'progress'` (enroll screen), `'revoked'` (close form,
  enroll screen with `app_revoked`), `'measureform' → appOnMeasureForm` (286-291); `sync.attach(win, doc)` (292);
  service worker, install hints, storage persist (293-295). Enrolled (`store.meta.deviceId`): `screen='home'`,
  `sync.start()`, render, scanner only if pref `cameraOk` (296-301); else `screen='enroll'` (303). Resolves to `APP` (307).
- `appWireEvents` (316-333) binds by id WITHOUT null checks: `chip`, `gear`, `btnScan`, `btnMenu`, `btnVoice`,
  `photoInput`; window `offline/online/beforeinstallprompt`; `visibilitychange` stops/starts the scanner.
  The DOM the app needs is exactly index.html:22-38: `#shopName #chip #gear #banner #main #bottom #btnScan
  #btnVoice #btnMenu #overlay #toast #photoInput` (dev/index.html:38-54 duplicates it inside `.frame`).
- `appRender` (356-372) repaints header, banner, clears `#main`, hides `#bottom` unless enrolled and on
  home/history (363), hides `#btnVoice` unless `settingOn(ports, 'app_voice')` (364-365), dispatches by `APP.screen`.
- `appOnChange(evt)` (336-348): `measdraft` events only toast on failure; an `update` event on home sets
  `showScanner = false` (341) so the latest card replaces the scanner; repaint; `recordTapMs` from `APP.tapStart`;
  `durable === false` toasts `ui_not_saved` '⚠️ ဖုန်းထဲ မသိမ်းနိုင်ပါ · ထပ်ကြိုးစားပါမည်'.

## 3. Rendering a bot message and its keyboard

`appLatestBot()` = `APP.phone.sim.lastBot()` (app_ui.js:352): the last `from === 'bot'` entry of `store.chat`
(app_ports.js:309-313). Home shows only that message, large (467-488); history shows the last 200 small (796-804).

`appRenderMsg(m, opts)` (646-694):
- class `card bot|user [system] [pending]` (649); user bubbles: voice wave, photo, or text (651-658).
- bot: photo via `appPhotoNode` (660, 595-615: media dataUrl/blob, thumb, remote URL except Drive, else emoji;
  asks `sync.fetchThumbs` once per item when online 610-613); document → `.doc` line, `<details class="rep">`
  with `appRenderReport` (open when big) and `appDocActions` (661-669); else plain text (671).
- `info = opts.big ? appCardInfo(m) : null` (673). `appCardInfo` (37-46) recognises an item card by a button
  whose `callback_data` is `S|<id>|1` and a SKU card by a `Q|<id>` button; returns `{msgId, itemId, sku, sellText,
  sellData, qtyData}`. A SKU card gets the stepper (674) and `appKeyboardForCard` drops the `S|id|*` and `Q|id`
  buttons (55-66); a UNIQUE card keeps its single sell button, painted `good` (683).
- keyboard: `div.kb` (+ `grid` only when `opts.big && appIsMenuMessage(ports, m)`, 677); otherwise one `div.row`
  per keyboard row (680), one `<button>` per core button with `onclick → appOnTap(m, b.callback_data, btn)` (682).
  `appIsMenuMessage` = `m.from === 'bot' && m.text === t(ports, 'menu')` (79), i.e. the text
  '👋 ပစ္စည်း Tag ကို scan လုပ်ပါ။ ဒါမှမဟုတ် အောက်က ခလုတ် နှိပ်ပါ။' (core_messages.js:89); `.kb.grid` is 3 columns,
  72 px buttons (app.css:94-95). The menu keyboard itself is the core's `showMenu` (core_bot.js:127-148): three rows
  of three, a fourth row (📏 `M|meas` in the app, `M|nb`, `M|acct`), and when `ports.sync` exists a 📲 row (the
  phone has no `ports.sync`, app_ports.js:164-184, so no 📲 row in the app).
- a big card whose text starts with '🧾' and has no document gets `appShareRow` (690).
- footer: `span.time` with 'edited · ' when `m.edited` (692).

`appStepper(m, info)` (696-712): `APP.qty` resets per message id (698); `[−] [n] [+]` with `CFG.MAX_SALE_QTY`
clamp (704-706; MAX_SALE_QTY 999, core_config.js:108); tapping the number opens `appOpenNumberKeypad({title:
ui_keypad_qty '🔢 အရေအတွက်', initial, max})` (700-702); the big sell button says `info.sellText` for 1, else
`ui_sell_n` '✅ ရောင်း {n} ထည်' (708), and commits `appStepperData(itemId, n)` = `S|<id>|<n>` (48-53, 709).

`appOnTap(m, data, btn)` (779-787): a `X|…` transfer is refused offline, with an outbox, or before the first
sync (`ui_transfer_online`, 781-783); then **the busy mark**: `btn.className += ' busy'` (784; `.kb button.busy
{opacity:.6}` app.css:96), `APP.tapStart` for telemetry (785), `APP.phone.sim.tap(m.id, data)`; a rejection
repaints (786). The mark disappears with the full repaint on the `change` event after the durable commit.
`.kb button.hot` (app.css:97, accent outline) is defined but NO JS sets it today: a free hook for a tour highlight.

Reports: `appRenderReport(rep)` (617-632) draws `rep.subtitle`, one table per section (columns, rows, totals,
'—' when empty), and the **footer** as `div.sub.foot` with `white-space: pre-line` (630; app.css:197) because a
receipt prints one transfer account per line. `appDocActions` (714-733) offers `ui_btn_pdf_telegram`
'📄 PDF → Telegram' (through `sync.requestReport(kind, groupId)`, kind from `appReportApiKind` 88-94) and
`ui_btn_share` '📤 ပို့မယ်' (Web Share or clipboard, 747-751).

Toasts: `appToast(text, bad)` (1190-1198) writes `#toast`, class `toast [bad]`, hides after 2600 ms; the element
is fixed under the header (app.css:77-78) and `pointer-events: none`.

## 4. The home screen (app_ui.js:467-592)

`appRenderHome(main)`: when `APP.showScanner || !lastBot` → scanner panel, a `scanrow` with `ui_btn_keypad`
'⌨️ နံပါတ် ရိုက်မယ်' (471-473), Recent, Find, then either the `menu` text as a system card (no history yet) or the
`ui_history` '⌃ မှတ်တမ်း' handle (476-477). Otherwise: the big card, `appInputBar(m)` when the core waits for
input (482-483), and a `scanrow` with the history handle and `ui_btn_photo` '📸 ဓာတ်ပုံ' (484-487).

- Scanner (490-551): `div.scan` with the `<video>`, guide, hint `ui_scan_hint`, torch/close tools when running,
  else one primary button whose label depends on `scanState`/`scanError` (`ui_scan_start`, `ui_scan_starting`,
  `ui_camera_denied|none|error`). `appStartScanner` only on home with `showScanner` and enrolled (516); first
  success stores pref `cameraOk` and commits (532-533). `appOnDecoded(text)` → `appParseTagLink` (app_scan.js:12-20:
  `?start=ID`, `tg://…start=`, bare `S1-0042`) → `appOpenTagId(id)` (546-551): stop scanner, `showScanner=false`,
  `tapStart`, **`APP.phone.sim.start(id)`** — a scan is the `/start <id>` update, exactly as in Telegram.
- Recent tiles (553-573): `recentItems(ports, shop|null for owner, 6)`; each tile is a button `appOpenTagId(it.id)`
  showing emoji+id, name (+`sample_mark`), and sold-out text / `btn_pending` / price · stock.
- Find (574-592): `input[type=search]` + 🔍, `findItemsByName` (own shop then all), 8 tiles, `ui_find_none` toast.
- Menu: `#btnMenu` → `appOpenMenu()` (788-793) = `showScanner=false`, `APP.phone.sim.start('')` (the bare `/start`).
- `#btnScan` returns to the scanner (320).

## 5. Input bar, keypads, overlay, text, photo

`appInputModeFor(state)` (app_ui.js:68-78) decides from the core's per-user state (`getState(ports, uid)`,
core_bot.js:2160-2163, cache key `st:<uid>`, TTL `CFG.STATE_TTL_SEC` 1800 s / `ADD_STATE_TTL_SEC` 600 s for ➕
and 🔢 prompts, core_config.js:11-12, core_bot.js:2164-2169):

| state | mode |
| --- | --- |
| `kind: 'await_number'` (any purpose: sale_qty, sale_price, restock_qty, split_bank, credit_paid, pay_amount, dep_amount, exp_amount, set_price, order_*; core_bot.js:454-2944) | `'number'` |
| `kind: 'new_item'`, step `photo` / `price` or `cost` / other | `'photo'` / `'number'` / null |
| `kind: 'exp'`, step `amount` | `'number'` |
| `kind: 'await_text'` (purposes add_option, list_detail, phone, exp_note), `'find'`, `'find_customer'` | `'text'` |
| `kind: 'notebook'` | `'photo'` |
| `kind: 'credit'|'dep'|'cu'` with step `name`; `'dep'` step `note` | `'text'` |
| `kind: 'meas_pick'` (with or without step) | `'text'` |
| anything else (`'order'`, `'orders'`, `'order_tag'`, `'voucher'`, `'meas'`, no state) | `null` → no bar |

`appInputBar(m)` (754-771):
- `'number'`: for `await_number` the keypad **opens by itself once per message** (`APP.keypadAutoFor !== m.id`,
  via `setTimeout(…, 0)`, 758-760) with `title = appFirstLine(m.text)`, `initial: 0`, `onOk: v → appSendText(String(v))`;
  the bar keeps one primary button `ui_type_number_bar` '⌨️ ဂဏန်း ရိုက်မယ်' to reopen it (762-764).
- `'photo'`: one primary `ui_btn_photo` button → `appPickPhoto()` (766).
- `'text'`: `input[type=text]` placeholder `ui_text_placeholder` '✏️ ရိုက်ပါ' + `ui_btn_send` 'ပို့'; Enter sends (767-770).
- `appSendText(text)` → `APP.phone.sim.text(text)` (773-776): a typed message update.

`appOpenNumberKeypad(spec)` (909-939): draws into `#overlay` a `div.sheet` with `h3` `spec.title || ui_keypad_number`
'✏️ ဂဏန်း ရိုက်ပါ', a `.display` showing `fmtMoney(Number(digits))` or '0' (916), keys `1-9, 000, 0, ⌫` (918), max
10 digits, `spec.max` clamp (921-922), actions `ui_btn_close` '✖️ ပိတ်' and `ui_btn_ok` '✅ အိုကေ' disabled until
`> 0` (928-933); OK closes and calls `spec.onOk(Number(digits))`. Integers only (no decimal key), value sent as
plain digits text. `appOpenTagKeypad` (879-907): shop segment (`CFG.SHOP_IDS`, `shopName`), `S1-____` display,
`⌫`/`✅`, auto-opens the tag at 4 digits via `appOpenTagId`. `appCloseOverlay` clears and hides `#overlay` (878).
Overlay CSS: fixed, bottom sheet, `z-index 30` (app.css:136-148), keys 64 px (`--key`).

Photo: `#photoInput` is a hidden `input[type=file][capture=environment]` (index.html:38); `appPickPhoto` clicks it
(1176-1179); `appOnPhotoPicked` downsizes (`appDownscalePhoto`, `APP_PHOTO_MAX_PX` 1280, app_media.js:12,48) and
calls `APP.phone.sim.photoBlob(rec, '')` (1180-1186). Voice: `#btnVoice` press-and-hold → `createAppRecorder`
→ `sim.voiceBlob(rec)` (1132-1163); hidden unless Settings `app_voice` is on (365).

## 6. The measurement form entry (app_ui.js:941-1128; app_ports.js:179-184)

- The core calls `ports.ui.measureForm(req)` (core hook, spec 9.2); on the phone that port is
  `{ measureForm: function (req) { emit('measureform', req); } }` (app_ports.js:181-183). The bot has no `ports.ui`.
- `appOnMeasureForm(req)` defers with `setTimeout(0)` so the form opens after the core's run (946-950);
  `req = {chatId, uid, customerId, orderId, staff}` (run_app.js:498-500).
- `appOpenMeasForm(req)` (952-1003): closes any overlay and the scanner, builds `appMeasModel(ports, store, req)`
  (210-220: fields = `appMeasFormFields(measureFields(ports, true))`, prev = `latestMeasurement`, a kept draft wins),
  and appends **`div#measForm.formpage` to `doc.body`** (962, 1002), never into `#overlay`. Head `ui_meas_title`
  '📏 {customer} · အတိုင်းအတာ' + `ui_btn_close`; `fprev` row with `ui_meas_prev` and `ui_meas_clear` '🔄 အသစ် တိုင်း';
  voucher input + derived id (`appMeasVoucher`); `fgrid` of fields under `measGroupLabel` headings
  (`appMeasDrawFields` 1006-1013, `appMeasFieldNode` 1015-1060: side toggle with `btn_left`/`btn_right` 'ဘယ်'/'ညာ',
  `multi` boxes joined with '/', decimal inputmode); notes textarea; fixed `fbar` with `ui_meas_save` '✅ သိမ်း'.
  Enter moves to the next input (994-1000).
- Draft: every change → `appMeasDraftWrite` into the persisted cache `measdraft:<customerId>` (TTL 86400 s) and a
  debounced `phone.commit('measdraft')` (1063-1070, 110-111).
- Save: `appMeasFormSave` → `appMeasSave(phone, req, {values, notes, voucher})` (228-239: `appMeasCollect`, bad
  voucher dropped, `store.local.saveMeasurementLocal`, draft dropped, bot line `meas_saved_form`
  '📏 {customer} · အတိုင်းအတာ {n} ခု သိမ်းပြီး'), then `appCloseMeasForm`, then `appMeasCommit` (241-243:
  `phone.commit('meas')` then `sync.scheduleSync()`).
- CSS: `.formpage` is `position: fixed; inset: 0; z-index: 32` over the whole page (app.css:170), one column,
  two from 700 px (193). The README says it covers the whole browser window, not only the dev page's phone frame
  (app/README.md, "The 📏 measurement form covers the whole browser window"); the comment at app_ui.js:942-943
  claims the opposite and is stale.

## 7. Other screens, header, banner

- Enroll (411-464): `ui_enroll_title` '📲 ချိတ်ဆက်ရန်', `ui_enroll_hint`, `ui_err_config` when no apiUrl and no
  transport (417), `input#codeInput` placeholder `ui_enroll_placeholder` 'XXXX-XXXX' maxlength 9 (418), the
  `ui_btn_enroll` 'ချိတ်ဆက်' button → `appDoEnroll()` (440-464): `syncNormalizeCode` (core_sync.js:202), length
  `SYNC.CODE_LEN` 8 (core_sync.js:44), `APP.sync.enroll(code)`, then `screen='home'`, toast `enroll_done`, scanner.
- History (796-804): `pagehead` with `ui_btn_back` '← နောက်သို့' (app chrome back, also on sync 809 and settings 840).
- Sync (807-835): chip text, `ui_sync_last`, offline, problem (`sync.errorText`), clock offset, storage persisted,
  `sync.pendingLines(12)`, export suggestion, `ui_btn_sync_now` → `sync.syncNow('manual')`, `ui_btn_export`.
- Settings (838-874): staff and device lines, font size segment (prefs `fontSize`), **`text_cards` toggle written as
  pref `setting:text_cards` 'TRUE'/'FALSE'** (855-859), read-only `app_voice`, version (`APP_BUILD`), tap median,
  `ui_btn_reenroll` → `store.wipe()`.
- Header (374-382): `#shopName` = `shopName(ports, staff.shop)` or `config.appName`; `#chip` text/class from
  `sync.chipState()` (`chip synced|waiting|stale|red|sending|never`, app.css:61-67). Banner (384-408): red chip →
  `banner bad` with `ui_btn_view`; Android install prompt → `banner info`.

## 8. app_ports.js — `createAppPhone(opts)` → `phone`

- `phone` (55-59): `name, platform, adapter, online (true), clockErrorMs, transport, pendingAi, log, ready,
  listeners, chain, lastCallbackAnswered`; `wallClock()` (61) and `now()` = wall clock + `store.meta.offsetMs` (63);
  `store = createAppStore(adapter, {now})` (64); `staffId()` (68).
- Events (73-84): `on/off/emit`; listener errors are logged, never thrown.
- `phone.ports` (164-184): `store: store.ports`, `chat` (93-123: `sendMessage` to another chat id becomes an outbox
  `notice` relayed through Telegram, 95-97; `sendPhoto`, `sendDocument`, `editMessage` sets `m.edited` and saves
  (108-115), `answerCallback`, `typing`, `getFile`, `savePhoto` → `local://<fileId>`), `cache` (158-162), `ai`
  (148-153: every call queues a job and throws `PendingAi`, 130-147), `pdf.make` returns the on-screen table marked
  `serverJob` (155-157), `lock.run` opens a collector so rows of one run form one outbox group (166-172), `clock`,
  `uuid`, `dedupe` over the last 400 update ids (175-178), `ui.measureForm` (181-183).
- `phone.deliver(update)` (217-239): serialized on `phone.chain`; runs `processUpdate(update, phone.ports)`
  synchronously, `markWaiting` swaps `ai_down` for `app_wait_server` ⏳ when a job was queued (196-216), keeps the
  last 50 in `phone.log`, then ONE `store.commit()`, then `emit('change', {kind:'update', result, durable, update})`.
- `phone.commit(why)` (241-244): commit outside a delivery, emits `change {kind: why, durable}`, resolves true/false.
- `phone.sim` (260-340): `start(payload)` (`/start [id]`), `text`, `voice(spoken)` (mock), `voiceBlob`, `photo(preset)`,
  `photoBlob`, `photoMessage`, `tap(messageId, data)` (callback_query), `replay`, `lastBot`, `lastBotWith(label)`,
  `button(m, label)`, `tapLast(label)`, `tapAny(label)`; plus `lastText`, `chatHas`, `stockOf`, `stats` (341-348).
  The update ids are `app-<n>` (app_store.js:584); `from()` is the enrolled staff (247-251).

## 9. app_store.js — the durable local store

- `APP_DB_NAME 'salestag'`, **`APP_DB_VERSION 2`** (30-31); `APP_STORES` (32-46): meta, items, customers, settings,
  messages, ledger (indexes groupId, itemId, day, seq, synced), outbox (localSeq), media, chat, cache, errors, thumbs,
  measurements (v2). Caps: chat 500, errors 50, tapMs 50 (47-49).
- `createMemoryAdapter` (75-121) with test hooks `holdWrites/release/heldCount`, `failNext`, `transactions`, `count`;
  `createIdbAdapter` (125-194) opens `name` at `APP_DB_VERSION`, creates only missing stores (137-146), closes on
  `versionchange` and calls `adapter.onreplaced` (151-155).
- `appFreshMeta()` (198-207): `deviceId, token, staff, owners, scope, receiptLetter, receiptCounter, offsetMs,
  cursor {ledgerSeq, masterRev, settingsHash, messagesHash, measAfter}, lastFullMastersDay, appVersion, label,
  platform, enrolledAt, nextMsgId, nextUpdateId, nextLocalSeq, nextErrorId, nextFileId, lastSyncOk, lastSyncTry,
  lastSyncError, lastBootstrap, prefs {}, tapMs []`.
- `createAppStore(adapter, {now})` (214): memory working set `S` (216-222), recorded ops `put/del/clr/putMeta`
  (231-234), flushed by `commit()` in one transaction (732-746; failed ops are kept for the next commit).
- `store.ports` (the core's store port, 283-381): items/customers/ledger (`appendLedger` stamps the per-device
  receipt number on SALE rows, 294-311; a collector or a `group` outbox entry), `getStaff/listStaff` from meta,
  **`getSetting(k, d)`: a pref `setting:<k>` wins over the synced Settings map (341-344)**, `getMessage` (345),
  `addListOption` (353-362), `listMeasurements` (364-367), `logError` (368-377); no `listOptions`, no `refreshViews`.
- `store.local` (401-549, the LOCAL STORE CONTRACT for core_sync): `removeEntry, markSynced, removeRows, setItemRev,
  setCustomerRev, upsertItem, upsertCustomer, hasRow, appendSynced, setSettings` (459-469: replaces the map, re-applies
  pending `list` entries, rewrites the `settings` store), `setMessages, upsertMeasurement, saveMeasurementLocal,
  measurementSynced, measurementRejected, getCursor, setCursor, syncedRows, replaceDay, resetSynced`.
- `store` surface (552-682): getters `meta, items, customers, ledger, outbox, chat, media, errors, settings, messages,
  measurements, rev, loaded, commits, pendingOps`; `setNow`, `pushOutbox`, `setMeta`, **`setPref/getPref`** (577-578,
  persisted in `meta.prefs`), `recordTapMs`, `nextUpdateId`, `nextFileId`, chat (`pushChat` 587-597, `insertChatBefore`,
  `saveChat`, `chatById`), cache (`cacheGet/cachePut/cacheRemove` with TTL), media, thumbs, collector, `stockOf`,
  `pendingRows`, `oldestPendingAt`, `stats()` (676-681), `pushMax`.
- `load()` (685-729) reads every store, repairs a v1 cursor (`measAfter` 0), sorts ledger synced-by-seq then
  unsynced-by-localSeq, chat by `order`; `wipe()` (749-762) clears everything but keeps `prefs.fontSize`.

## 10. app_sync.js — enrollment, bootstrap, the sync round trip, settings

- Transport: `opts.transport || phone.transport || appFetchTransport(apiUrl)` (72); `appFetchTransport` POSTs
  `text/plain` to `<apiUrl>?api=<name>` and follows redirects (28-49). `call(api, body)` never throws; failures come
  back as `{ok:false, error, transportFailure:true}` (88-105). `authBody` adds `device, token, appVersion, clientTime` (107-111).
- `sync.enroll(code, label)` (146-164): `api=enroll` with `{code, platform, label, appVersion, clientTime}`; on ok
  stores `deviceId, token, staff, scope, receiptLetter, label, owners` in meta, learns the clock offset, commits,
  emits `enrolled`, then `bootstrap()` when `res.bootstrap`.
- `sync.bootstrap(onProgress)` (167-228): `resetSynced`, pages `api=bootstrap` (`cursorSeq`), applies items,
  customers, **`store.local.setSettings(res.settings || {})`** (185), messages, staff/owners/scope/letter, cursor
  (`masterRev, settingsHash, messagesHash`), ledger rows; emits `progress`; at the end commits, emits `sync`, and
  **schedules one sync at once (`scheduleSync(0, 'bootstrap')`, 221)** so measurement sessions page in.
- `runSync(reason)` (249-323): one `api=sync` with `push` (`syncPlanPush` of the outbox, resent batch kept, 253-255)
  and `pull` = the cursor (+ `fullMasters` once a day, 256-259); applies push results (`syncApplyPushResults`,
  quarantine and flag lines spoken as `app_rejected` / `app_flagged`), `drain` notice, then `applyPages` →
  **`syncApplyDelta(store.local, delta)`** (288) with follow-up pages, checksum repair (301-313), commit.
- `sync.syncNow(reason)` (326-362): one in flight, `wanted` reruns, backoff `APP_SYNC_BACKOFF_MS` [5 s … 10 min]
  on transport failures; after an ok sync `flushAiJobs()` (372-426) replays queued voice/photo/notebook jobs through
  `handleIntent` / `presentNotebookLine`. `scheduleSync(ms, reason)` debounces (363-369, default 1500 ms).
  Triggers (521-540): `start()` on launch, `attach(win, doc)` → after each `update` commit with an outbox, on
  `online`, on `visibilitychange` visible.
- `requestReport(kind, groupId, inline)` → `api=report` (429-432); `fetchThumbs(ids)` → `api=photo` (433-443);
  `exportDocument`/`shareExport`/`downloadExport` = Transport B (446-476).
- **`chipState(at)`** (479-494): `never` (not enrolled, `ui_sync_never` '☁️ မပို့ရသေးပါ'), `sending`
  (`ui_sync_sending`), `synced` (`ui_sync_synced` '✓ ပို့ပြီး'), else by the oldest pending entry: `waiting`
  (`ui_sync_waiting` '⏳ {n} ခု ကျန်'), `stale` after 1 h (`ui_sync_stale_hours`), `red` after 2 days
  (`ui_sync_stale_days`); `suggestExport` after 4 h. **`pendingLines(max)`** (496-518): one line per outbox entry
  (`group` via `describeRow`, `item`, `customer`, `notice`, `error`, `list` with `appPendingListLabel` 56-63,
  `measurement`), plus queued AI, plus `ui_sync_pending_more`.

**Which Settings keys reach the phone, and how a new key such as `sale_flow` would.** The server's
`syncSettingsFor(sp)` copies EVERY key of the Settings tab (`sp.store.allSettings()`), removes hand-typed
`lists_json` / `meas_fields_json`, and adds the derived `lists_json` and `meas_fields_json` (core_sync.js:915-935).
`syncDelta` sends `settings` only when the cursor's `settingsHash` differs (core_sync.js:1010); the bootstrap always
sends it (1062-1067). On the phone `syncApplyDelta` calls `localStore.setSettings(delta.settings)` and stores the new
hash (core_sync.js:1438, 1452); `setSettings` replaces `S.settings` and the `settings` store (app_store.js:459-469);
the core reads it through `ports.store.getSetting(k, d)` (app_store.js:341-344), so `settingOn(ports, 'sale_flow')`
or `getSetting('sale_flow', 'steps')` works on the phone the moment the key exists in the Sheet and one sync has run
after the hash changed. No code reads `sale_flow` today (grep over apps-script/ and app/: none). The phone-local
override `prefs['setting:<k>']` (app_store.js:342) is how the Settings screen flips `text_cards` without the server
(app_ui.js:855-859); the same pattern could give a per-phone `sale_flow` switch, but the brief wants the switch in
Settings (D5), so that is a demo aid at most. The dev page already shows the mechanism live: the `app_voice`
checkbox writes `world.settings.app_voice` and calls `sync.syncNow('settings')` (dev/index.html:201-204).

## 11. app_i18n.js — APP_MSG keys (11-148)

Groups and keys (Burmese as written there): header/chip `ui_app_name, ui_shop_short, ui_sync_synced, ui_sync_waiting,
ui_sync_stale_hours, ui_sync_stale_days, ui_sync_sending, ui_sync_offline, ui_sync_never`; home `ui_scan_title,
ui_scan_hint, ui_scan_start, ui_scan_starting, ui_camera_denied, ui_camera_none, ui_camera_error, ui_torch,
ui_btn_keypad '⌨️ နံပါတ် ရိုက်မယ်', ui_keypad_title '🔢 Tag နံပါတ်', ui_keypad_qty '🔢 အရေအတွက်', ui_keypad_number
'✏️ ဂဏန်း ရိုက်ပါ', ui_btn_open, ui_btn_ok '✅ အိုကေ', ui_btn_close '✖️ ပိတ်', ui_btn_back '← နောက်သို့', ui_btn_clear,
ui_recent_title, ui_recent_none, ui_find_placeholder, ui_find_none, ui_home_hint`; card/inputs `ui_sell_n
'✅ ရောင်း {n} ထည်', ui_qty_hint, ui_history '⌃ မှတ်တမ်း', ui_history_title, ui_history_empty, ui_text_placeholder
'✏️ ရိုက်ပါ', ui_btn_send 'ပို့', ui_type_number_bar '⌨️ ဂဏန်း ရိုက်မယ်', ui_transfer_online, ui_not_saved,
ui_offline_toast, ui_thumb_loading`; bottom bar `ui_btn_scan '📷 ဖတ်', ui_btn_voice, ui_btn_menu '☰ မီနူး',
ui_btn_photo '📸 ဓာတ်ပုံ', ui_voice_hold, ui_voice_recording, ui_voice_denied, ui_voice_unsupported`; reports
`ui_btn_pdf_telegram, ui_btn_share, ui_pdf_sending, ui_pdf_failed, ui_report_preview`; sync screen `ui_sync_title,
ui_sync_last, ui_sync_last_never, ui_sync_pending_title, ui_sync_pending_none, ui_sync_pending_more, ui_btn_sync_now,
ui_btn_export, ui_export_hint, ui_export_suggest, ui_export_done, ui_export_none, ui_storage_persisted,
ui_storage_not, ui_storage_unknown, ui_sync_problem, ui_err_network, ui_err_auth, ui_err_server, ui_err_version,
ui_err_busy, ui_err_config, ui_pending_item, ui_pending_customer, ui_pending_notice, ui_pending_error,
ui_pending_ai, ui_pending_list, ui_pending_meas, ui_clock_offset`; enrollment `ui_enroll_title '📲 ချိတ်ဆက်ရန်',
ui_enroll_hint, ui_enroll_placeholder 'XXXX-XXXX', ui_btn_enroll 'ချိတ်ဆက်', ui_enroll_wait, ui_enroll_loading,
ui_enroll_done, ui_enroll_short, ui_enroll_offline`; install `ui_install_ios_title, ui_install_ios_steps,
ui_install_later, ui_install_android, ui_btn_install`; settings `ui_settings_title, ui_font_size, ui_text_cards,
ui_voice_flag, ui_on, ui_off, ui_version, ui_device, ui_staff, ui_btn_reenroll, ui_confirm_wipe, ui_tap_ms,
ui_update_ready, ui_update_applied, ui_btn_view, ui_banner_stale, ui_menu_title`; the form `ui_meas_title,
ui_meas_voucher, ui_meas_notes, ui_meas_prev, ui_meas_clear, ui_meas_save '✅ သိမ်း', ui_meas_empty,
ui_meas_close_ask, ui_meas_bad_voucher`. Note the bottom bar labels are also hard-coded in index.html:31-33 and
dev/index.html:47-49 (not rendered from APP_MSG). `appT(ports, key, vars)` (156-162) works before a store exists.
No key exists today for a date picker, a back row, a "part now / full now" step or a buyer step: the core's MSG
would carry those (bot territory); the app only needs keys for chrome it adds (for example a date sheet's title and OK).

## 12. app.css — the classes a new screen can reuse (205 lines)

Tokens `:root` (7-17: `--bg --panel --panel-2 --ink --muted --line --accent --accent-soft --good --warn --bad
--tg-*`, `--tap 56px`, `--key 64px`), dark mode (18-33). Buttons: base 56 px / 20 px (40), `.primary .good .ghost
.danger` (43-46); inputs 56 px (48). Frame: `#app` fixed, `max-width 600px` (57); `.top`, `.chip.<kind>` (58-67),
`.main` flex column gap 12 (68), `.bottom` 60 px buttons (69-71), `.banner[.bad|.info]` (72-76), `.toast[.bad]`
(77-78). Card: `.card[.system|.pending]` pre-wrap (81-83), `.pic[.small]` (84-86), `.time`, `.voice`, `.doc`.
Keyboard: `.kb` column gap 8 (91), `.kb .row` flex (92), `.kb button` flex 1, 56 px, Telegram-blue (93), `.kb.grid`
3 columns 72 px (94-95), `.busy`, `.hot` (96-97). `.stepper`, `.stepper .n`, `.sell` 68 px (98-101), `.handle` (102),
`.inbar` (103-105). History `.hist .card.user|.bot` (108-112). Scanner `.scan .guide .hint .tools .start` (115-122),
`.scanrow` (123-124), `.pagehead` (125-127), `.section h3`, `.tiles` 2 columns (128-133). Keypad: `.overlay`,
`.sheet`, `.display[.tag]`, `.keys` 3 columns 64 px, `.keys button.op`, `.sheet .actions`, `.seg[.on]` (136-148).
Screens: `.screen h2`, `.panel .row .k .v`, `.code`, `.stack`, `.pend`, `.install`, `.rec` (151-167). Form:
`.formpage .fcol .fhead .fprev .fgrid .ffield .multi .toggle .vid .fbar .fbar-in .fmsg` (170-193). Reports `.rep`
(196-204). Fonts come from `fonts/fonts.css` (index.html:17; self-hosted woff2 listed in version.json precache).

## 13. index.html and app/dev/index.html

`app/index.html` (51 lines): PWA metas (`lang="my"`, manifest, theme color, apple-mobile-web-app-*), `app.css?v=
__APP_VERSION__` (18), the `#app` shell (22-35), `#overlay #toast #photoInput` (36-38), `config.js` (40), the
`<!-- @app-script -->` marker the build replaces with the bundle tag (41; build_app.js:79), and the boot script
`bootApp(APP_CONFIG with version stamped)` or the 'app bundle missing' text (42-49).

`app/dev/index.html` (241 lines), the maintainer's bench:
- Loads unbundled files in this exact order (109-129): `core_config, core_burmese, core_messages, core_ai_prompt,
  core_ledger, core_report, core_bot, core_sync, core_orders`, then `poc/sim_mock_ai.js, poc/sim_ports.js,
  poc/sim_seed.js, poc/sim_sync.js`, then `app/vendor/jsQR.js`, then `app_i18n, app_store, app_ports, app_sync,
  app_scan, app_media, app_ui`. Styles: `../fonts/fonts.css`, `../app.css`, plus a 390×780 `.frame` (18-34).
- World and fake server (133-135): `world = seedSimWorld(createSimWorld()); simSeedLists(world); server =
  createFakeServer(world);`. Transport (138-145): a Promise that waits `dev.latency` ms, rejects when `dev.offline`,
  else `server.handle(api, body)`.
- Adapter (146-147): `location.hash === '#idb'` → `createIdbAdapter({name: 'salestag-dev'})`, else `createMemoryAdapter()`.
- **Boot call (149-150)**: `bootApp({ apiUrl: 'fake://sim-server', botUsername: 'ShopTagBot', appName: 'SalesTag (dev)',
  version: 'dev' }, { adapter, transport, noServiceWorker: true }).then(app => { window.DEV.app = app; refresh();
  autopilot(app); })`. `window.DEV = {world, server, dev, adapter, app}` (148).
- Autopilot query params (156-184): `?enroll=sister|brother|owner` mints a code with `server.mintEnrollCode(U[x],
  label)`, writes `m.display` into `#codeInput` and calls the app's own `appDoEnroll()` (172-173, 186-191), then polls
  until `app.store.meta.deviceId && app.screen === 'home'`; `&open=S1-0002` → `appOpenTagId(q.open)` (180);
  `&screen=sync|settings|history` → `app.screen = …; appRender()` (181); `&latency=0` sets the fake delay (170).
- Bench buttons: enrollment codes for Sister/Brother/Owner (192-194); network `offline` checkbox (sets
  `app.phone.online` and syncs when back, 195-198), `latency`, `aiFail` → `world.aiFail`, `appVoice` →
  `world.settings.app_voice` + `sync.syncNow('settings')` (199-204); Telegram route `tgSell` (`world.sim.start(U.sister,
  'S1-0002'); world.sim.tapLast(U.sister, 'ရောင်း ၁')`), `tgRestock`, `tgPrice`, `tgSummary` (`buildDailySummary` +
  `server.summaryLines()`) (205-208); device actions `drain/activate/revoke` per device via `server.deviceAction`
  (223-230); `reload` (209). `refresh()` (211-235) shows server rows/seq/quarantine/errors, the last 6 ledger rows,
  the owner's Telegram chat (`world.chats[U.owner.id]`), devices and `store.stats()`; it runs on every `world.listeners`
  event and every 2 s (236-237). Page errors are captured into `#pageErrors` (96-108).

## 14. tools/build_app.js (113 lines)

`FILES` as in section 1 (55-58); each file prefixed with a `/* ===== path ===== */` banner (64); the bundle starts
with `var APP_BUILD = {version, hash, builtAt}` (70) which the Settings screen shows (app_ui.js:861-862); **hash** =
first 10 hex of SHA-256 over `version + sources` (not the build time, 67-69) so an unchanged rebuild keeps its name;
compiled once with `vm.Script` (71); secret scan (72, 97-98). Stamps: `index.html` gets the `<script src="app.<hash>.js">`
and `__APP_VERSION__` = `version+hash` (75-79); `ping.html` stamped; `config.js` or the example with a warning (83-86);
`fonts/ vendor/ icons/` copied (87-90); **SW precache** = `index.html, app.<hash>.js, app.css?v=<stamp>,
manifest.webmanifest, config.js, version.json` + the copied files minus LICENSE (91), written into `sw.js` on the lines
marked `// @sw-version` and `// @sw-precache` (92-95; sw.js:13-14); `version.json` with `files` and `precache` (96);
old `app.<hash>.js` bundles removed from dist (102). `app/VERSION` is `1.0.0`; current dist bundle `app.9f8fbde3b5.js`.

## 15. poc/run_app.js — the app's data layer and UI helpers in Node (847 lines)

- No DOM and no fake DOM: it runs the files with `vm.runInThisContext` (24) and tests the store, ports, sync and
  the **pure** UI helpers (`appCardInfo`, `appStepperData`, `appKeyboardForCard`, `appInputModeFor`, `appReportApiKind`,
  `appItemIdFromText`, `appIsIos`, `appParseTagLink`, every `appMeas*` helper, `appPendingListLabel`). Rendering
  functions are never called; where a UI function touches `APP`, the test stubs `APP` by hand (step 29 at 753-771:
  `APP = {win, phone, store, sync: {scheduleSync}, tt, $: () => null, measForm, reloadAfterForm}` to run
  `appMeasFormSave` / `appCloseMeasForm`; step 30 at 790-802 for `appOnDbReplaced`) and restores it.
- Helpers: `check(cond, label, detail)` / `step(title)` / `tick(ms)` (27-32); `world = seedSimWorld(createSimWorld())`,
  `server = createFakeServer(world)`, `U = SIM_USERS` (36-39); a synchronous `transport(api, body)` that throws when
  `net.offline` (40-44); fake `timers {setTimeout, clearTimeout, fire()}` handed to `createAppSync` so debounce and
  backoff are asserted without waiting (45-50); `makePhone(name, extra)` = `createAppPhone({adapter, name, transport,
  clock: world clock, platform: 'android'}) + createAppSync(phone, {transport, timers, …}) + load()` (55-61);
  `sStock`, `rowsOf`, `lastLocal` (51-53). `fakeIndexedDB()` (309-354) is a minimal IndexedDB for `createIdbAdapter`
  (upgrade path, `onversionchange`).
- Coverage (steps 1-31): tag links; enrollment + bootstrap paging; a sale offline with held writes (the ✅ waits);
  push/ack; a Telegram-route row pulled; the stepper's `S|id|N`; clock offset; voice queued then replayed; restart
  over the same adapter with a half-finished flow in the cache; Transport B; chip states; debounce and one in flight;
  backoff, DRAIN, REVOKE; fetch transport shape; round 4: DB v2 upgrade, measurement sessions, `measureFields`,
  the local measurement rules, the form hooks on the real store (`M|meas`, `MS|new`, `MS|create`, `MS|<cid>`),
  the form's pure logic and draft, save/sync/quarantine, ➕ bank from the sale card with a pull before the push,
  a queued spoken name then typed, a split with a typed amount, `appInputModeFor` for the new states, voucher
  canonicalisation, multi-box normalisation, the SW-update-after-form rule, DB replaced by another tab, an old
  server answering `bad_kind`. Runs with `node poc/run_app.js`; must end `0 failed` (app/README.md "Check before every release").
- Convention the round-5 app step must keep: new checks are appended as numbered steps in this file (spec round-4
  section 12 lists the step-4 additions in the same style), each failing without the change.

## 16. What a guided sale (D1-D3) needs from the app

The app renders whatever keyboard the core sends, so most of the guided flow is bot work; these are the app-side facts
and gaps:

1. **A wizard step with buttons renders without app changes.** Each core keyboard row becomes a `div.row` of
   flex-1 buttons (app_ui.js:678-687), so one answer per row gives full-width 56 px buttons and `[↩️ back, ✖️ cancel]`
   as one row gives two half-width buttons. The card text is `pre-wrap` (app.css:81). Only the message whose text equals
   `t('menu')` becomes the 3-column grid (679; appIsMenuMessage 79); a step card must not reuse that exact text.
   Home shows ONLY the latest bot message (`sim.lastBot`, 352, 468): a step may be a new message or an `editMessage`
   of the latest one (app_ports.js:108-115); editing an older message while a newer bot message exists shows the newer.
2. **Where a 'back' row renders today: nowhere in the sale.** `Z` is cancel only: it clears the state and edits the
   message to `cancelled` (core_bot.js:530-533), after which the home shows that edited card with no keyboard and no
   scanner until 📷 ဖတ် (`#btnScan`, app_ui.js:320) or ☰ is tapped. `btn_back` '⏮ နောက်ပြန်' (core_messages.js:335)
   exists only in the Telegram measurement flow (`MQ|<tok>|b`, core_bot.js:3186; `MF|<tok>`, 3317). The app's own
   `ui_btn_back` '← နောက်သို့' (app_i18n.js:38) is page chrome (history/sync/settings), not a card button. Label
   collision to settle in the spec: the brief's '↩️ back' uses the emoji of `btn_undo` '↩️ မှားသွားတယ်' (core_messages.js:27).
3. **Typed count / amount: the keypad already fits.** Any step whose state is `kind: 'await_number'` auto-opens
   `appOpenNumberKeypad` once with the message's first line as title and sends the integer as text (754-764);
   the stepper is only on SKU item cards (`S|id|1` + `Q|id`, 37-46). A count step that is NOT an item card must either
   set an `await_number` state (keypad, buttons stay tappable) or add its own `kind` to `appInputModeFor` (68-78). The
   keypad has no decimal and clamps only via `spec.max` (921-922); `initial: 0` keeps OK disabled until a digit.
4. **Typed name or phone: the text bar.** `await_text` (any purpose), `find_customer`, `cu`/`credit`/`dep` step `name`
   show the input + 'ပို့' (767-770). The existing phone prompt's skip is callback `Z` (core_bot.js:785), which would
   also cancel a guided flow: the spec must give the buyer-phone skip its own callback.
5. **Date entry: nothing exists in the app.** `appInputModeFor` returns null for `kind: 'order'` (no bar at all), so
   even the order flow's typed date (`ord_ask_due_text` '✏️ ရက်စွဲ ရိုက်ပါ (ဥပမာ 30.10.26)', core_bot.js:2731-2742)
   has no input in the app today (orders are off in the app, run_app.js:488). The core's date pieces to reuse: presets
   as buttons from `duePresets` (Settings `due_presets`, default `CFG.DUE_PRESETS`; core_orders.js:28-31; rows
   `OD|<id>|<n>` + `btn_due_type` '✏️ ရက်စွဲ ရိုက်' core_bot.js:2615-2618), `addDaysKey(day, n)` (core_orders.js:49-54),
   and `parseDayText(text, now)` which accepts `30.10.26`, `30/10/2026`, `30-10`, Burmese digits, but NOT ISO
   `yyyy-mm-dd` (66-80). An app date picker (`<input type="date">` gives `yyyy-mm-dd`, or a sheet in `#overlay` like
   the keypad, 909-939) must therefore either send `dd.mm.yyyy` text or the new flow must accept the ISO key; the
   flow's state for that step needs a new `appInputModeFor` branch (for example `'date'`) and the i18n keys for the
   sheet's title/OK. `fmtDayShortMy(key)` (core_burmese.js:50-55) labels a chosen day in Burmese.
6. **One write at the end (D3) is compatible with the store.** Nothing is persisted but the state (`st:<uid>` in the
   `cache` store, app_ports.js:158-162, app_store.js:616-627) until the core appends rows; each `deliver` commits the
   state and chat in one transaction (app_ports.js:228), so an abandoned flow leaves a state that expires after
   `STATE_TTL_SEC` and survives a restart (run_app.js:205-217 proves this for `sale_price`). The confirm tap's rows,
   written inside one `lock.run`, form one outbox group (app_ports.js:166-172, app_store.js:658-663).
7. **`sale_flow` (D5)** reaches the phone as any Settings key (section 10); `settingOn(ports, …)` is for TRUE/FALSE
   only (core_config.js:190-193), so a `steps|quick` value needs `ports.store.getSetting('sale_flow', 'steps')`.
8. **The ✅ feedback** stays as today: the busy mark on the tapped button (784), repaint after the durable commit;
   `recordTapMs` measures tap-to-paint (344-346).
9. **Telemetry/undo card**: the after-sale `btn_undo` '↩️ မှားသွားတယ်' and `btn_receipt` '🧾 ဘောက်ချာ' buttons render
   as plain keyboard buttons; the share row appears when the card text starts with '🧾' (690).

## 17. What a simulator that embeds the real app needs

1. **Files, in this order** (the dev page's list, dev/index.html:109-129): the nine core files (`core_config,
   core_burmese, core_messages, core_ai_prompt, core_ledger, core_report, core_bot, core_sync, core_orders`),
   `poc/sim_mock_ai.js, poc/sim_ports.js, poc/sim_seed.js, poc/sim_sync.js`, then `app_i18n, app_store, app_ports,
   app_sync, app_scan, app_media, app_ui` (`app/vendor/jsQR.js` only matters for a real camera; without it the scanner
   falls to 'none' and the start button shows an error label, app_scan.js:23-26). Today's `poc/build_simulator.js`
   inlines only core + sim_ui and deliberately omits `core_sync.js` (build_simulator.js:12-18) and loads qrcodejs from
   cdnjs (simulator.template.html:280); the round-5 build must add `core_sync.js`, `sim_sync.js`, the app files and
   `app.css` (plus `fonts/fonts.css` or accept the system Myanmar font fallback of `--sans`, app.css:14).
2. **The DOM**: a copy of index.html:22-38 inside a phone frame (as dev/index.html:37-55), ids unchanged, because
   `appWireEvents` binds them without null checks (app_ui.js:318-323). `#toast` and `#overlay` can sit inside the
   frame (dev page does), but `#measForm.formpage` is appended to `document.body` and is `position: fixed; inset: 0`
   (app_ui.js:1002; app.css:170): in a simulator it covers the whole page unless a CSS override scopes it to the frame
   (that is an app-file change the app step would own; the dev page lives with it).
3. **The exact boot call** (dev/index.html:133-150): `var world = seedSimWorld(createSimWorld()); simSeedLists(world);
   var server = createFakeServer(world); bootApp({apiUrl: 'fake://sim-server', botUsername, appName, version},
   {adapter: createMemoryAdapter(), transport: function (api, body) { return Promise.resolve(server.handle(api, body)); },
   noServiceWorker: true}).then(function (app) { … })`. `apiUrl` must be non-empty (or `/PASTE_/`-free) only to avoid
   the `ui_err_config` card; the transport wins over `appFetchTransport` (app_sync.js:72). `bootApp` resolves to `APP`.
4. **Enrollment without typing a code**: mint with `server.mintEnrollCode(SIM_USERS.sister, 'label')` →
   `{code, display, deviceId, expiresAt}` (sim_sync.js:219-221; core_sync.js:255-266), then either (a) the dev page's
   way, `document.getElementById('codeInput').value = m.display; appDoEnroll();` and poll `APP.store.meta.deviceId &&
   APP.screen === 'home'` (dev/index.html:172-183), which also shows the real enroll screen, progress line and
   `enroll_done` toast; or (b) `APP.sync.enroll(m.code).then(…)` then `APP.screen = 'home'; APP.showScanner = true;
   appRender();` (what `appDoEnroll` does at 449-462; run_app.js:79 uses `sync.enroll` directly). `SIM_USERS` are
   `sister {id 1001, S1, staff}`, `brother {1002, S2}`, `owner {1000, S1, owner}` (sim_seed.js:4-9). The owner's menu
   📲/📱 rows appear in the Telegram pane because `createFakeServer` installs `world.ports.sync` (sim_sync.js:234-242).
5. **One app per page**: `APP` is one global and `bootApp` adds listeners to the same ids each time it is called
   (app_ui.js:16, 316-323) and `sync.attach` adds window/document listeners (app_sync.js:524-540) with no app-level
   teardown API (only `sync.detach`, 541-545, and `appStopScanner`). A simulator with a login screen (Owner / Seller 1 /
   Seller 2, D8) therefore either (a) keeps one app and re-enrolls on role change (`APP.store.wipe()` then enroll with
   that role's code, which is also what the real product does, app_ui.js:867-872), or (b) runs one iframe per role, or
   (c) rebuilds the `#app` subtree and calls `APP.sync.detach()` before each `bootApp` so stale handlers go with the old
   nodes. A `createMemoryAdapter()` per role keeps each phone's data when switching back.
6. **Sharing the fake server with the Telegram simulation of the same world**: `createFakeServer(world)` wraps
   `world.ports.store` and the same `world.items / ledger / customers / settings / messages / lists / measurements`
   arrays (sim_sync.js:13-101), stamps Seq/Rev on Telegram-route writes (29-59), and answers `handle(api, body)` with
   `syncHandle` (209-215). The Telegram side is `world.sim.start(user, payload) / text / voice / photo / tap /
   tapLast / lastBot` over `world.ports` (sim_ports.js:400-468), rendered by sim_ui.js from `world.chats[user.id]`.
   Rows made in Telegram reach the phone only at its next pull: after a Telegram action the simulator should call
   `APP.sync.syncNow('sim')` (the dev page relies on the app's own triggers and a 2 s refresh, dev/index.html:195-204,
   236-237); rows made on the phone appear in the Sheet pane after the debounced push (1500 ms) because
   `syncTabs.appendRows` pushes into `world.ledger` and emits `{type: 'ledger'}` to `world.listeners` (sim_sync.js:137-139).
   `world.listeners` events: `items, ledger, customers, lists, orders, devices, quarantine, synclog, views` — the
   Sheet pane re-renders on them (sim_ui.js:53).
7. **Driving the app for a guided tour**: everything is a global: `appOpenTagId('S1-0002')` (a scan), `appOpenMenu()`,
   `APP.phone.sim.tapLast(label)` / `tap(m.id, data)`, `appSendText(text)`, `APP.screen = 'sync'; appRender()`,
   `appOpenNumberKeypad(spec)`. To highlight the next button, the unused `.kb button.hot` class (app.css:97) can be
   set on the button whose `callback_data` the tour expects (the keyboard is in `APP.phone.sim.lastBot().keyboard`).
8. **Settings switch in the demo**: `world.settings.sale_flow = 'quick'` then `APP.sync.syncNow('settings')` is the
   exact mechanism the dev page uses for `app_voice` (dev/index.html:201-204); the hash changes, the phone pulls.
9. **Laptop width**: `#app` is `max-width 600px` (app.css:57) and the form goes two-column from 700 px (193); the
   D8 "app at laptop width" is the same bundle in a wider frame.

## 18. Surprises and stale spots found while mapping

- `appInputModeFor` has no branch for `order*`, `voucher` and `meas` states, so a typed date (or any order text) has
  no input bar in the app; irrelevant while orders are off in the app (`ordersEnabled(P.ports)` false, run_app.js:488),
  decisive for a guided step that asks a date (section 16.5).
- The comment at app_ui.js:942-943 ("the dev page keeps it inside the phone frame") contradicts the code (appended to
  `doc.body`, 1002) and the README (it covers the whole window).
- `.kb button.hot` is styled but never set (app.css:97) — a ready hook for the tour.
- The bottom bar labels are hard-coded in both HTML files (index.html:31-33, dev/index.html:47-49) while the same
  strings exist as `ui_btn_scan / ui_btn_voice / ui_btn_menu` in app_i18n.js:59-61.
- `bootApp` has no teardown; the dev page reloads to reset (dev/index.html:209). A multi-role simulator must plan for it (17.5).
- The phone's `pdf.make` returns a `serverJob` table; the fake server's `hooks.photo` returns `'thumb:<id>'` strings that
  `appPhotoNode` ignores (not `data:`), so cards in a simulator show the category emoji, never a picture (sim_sync.js:191-194; app_ui.js:604).
- `syncSettingsFor` copies every Settings key (core_sync.js:916-917): a new key needs no sync change, only a Sheet row
  and a hash change; the first phone to see it is the one whose next pull follows the edit.
