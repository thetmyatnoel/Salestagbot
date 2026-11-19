# Map: the simulator and the tests as built (round 5), and what a form default does to them

Date 2026-11-12. Mapper's report for `docs/design-round-6/BRIEF.md` (R1-R9; this map serves R5, R6, R8 and R9).
Tree: the current one (rounds 4 and 5 built, unpublished), line numbers as of today. Files read: `poc/sim_ui.js`,
`poc/sim_tours.js`, `poc/build_simulator.js`, `poc/check_simulator.js`, `poc/check_simulator_browser.js`,
`poc/simulator.template.html`, the round-5 parts of `poc/run_wizard.js`, `run_round4.js`, `run_app.js`,
`run_sync.js`, `run_gas.js`, and the app hooks they lean on (`app/app_ui.js`, `app/app_ports.js`, `app/app.css`,
`app/dev/index.html`). No code or test was changed.

**Verdicts used in the tables** (a check is "under a form default" when Settings `sale_flow` is `form` or blank, `steps`
reads as `form`, R6):

- **V**: still valid as it is.
- **V\***: the assertion is still valid, but its setup drives the round-5 steps (`guided(...)`, `SS|`/`SC|` taps); the
  setup must reach the same rows another way (a direct `commitSaleGroup` call, the review card, or the app form).
- **Q**: still valid only on `sale_flow = quick` (it already runs there, or must be moved there).
- **RC**: must move to a form equivalent on the **Telegram review card** (the screen is reached from the card and
  returns to it; R5 allows the round-5 screens to be reused as the card's edit screens).
- **AF**: must move to a form equivalent on the **app form** (Node-testable pure helpers plus a fake-DOM check, R9).
- **O**: obsolete (pins one question per screen, the order of the screens, `hist`, back between screens, or the app's
  chat-step input bars); the spec deletes it with its feature and replaces it, never leaves it half-working (R5).

**Short answer.**

1. The suites that never touch the guided sale stay green as long as `seedSimWorld` keeps `sale_flow: 'quick'`
   (poc/sim_seed.js:72): run_scenario.js, run_lists.js, run_round4.js steps 1-9l and 10, run_app.js steps 1-31,
   run_sync.js 0-S22/L*/M*, run_gas.js 1-17. Changing that seed would break hundreds of checks; keep it.
2. The checks that pin round 5 are concentrated in run_wizard.js (about 250 checks over 24 steps), run_round4.js 9z,
   run_app.js 32-40, run_sync.js R5a/R5c/R5e/R5f/R5h, run_gas.js 18-19, check_simulator.js 4-6 and the six-step
   `SIM.smoke()` in sim_ui.js. Roughly: the core and reader checks (run_wizard 7, 10, 20-22, 24; run_gas 20-25; run_sync
   R5b/R5d/R5g) stay; the customer-matching, payment, due-date, ➕ and tap-guard rules move to the review card's edit
   screens and to the app form; the screen-order and back-chain checks (run_wizard 1, 2, 11, most of 22x/22y; run_app
   32, 34, 37, 39) are obsolete.
3. The tour engine knows only Telegram-style keyboards: a step resolves to a callback in the last bot message (on the
   app, of the frame's snapshot), and an app step is seen through bot updates. An app-native form needs four things
   the engine lacks today: stable `data-f` hooks with the highlight drawn by the form's own renderer, form state in the
   frame snapshot, an app scan event that does not go through `/start`, and frame commands that set a field and press
   a form button (section 7). Six concrete traps are listed in section 6.
4. A three-item basket smoke step fits after the existing app enrolment and needs only those additions (section 8).

---

## 1. poc/sim_ui.js as built (1540 lines)

### 1.1 Boot, world, Reset

- `boot()` (sim_ui.js:92-110): `world = simSeedLists(seedSimWorld(createSimWorld()))`, then
  `world.settings.sale_flow = 'steps'` (:96, "the demo shows the guided sale (seedSimWorld says quick for the
  suites)"), `server = createFakeServer(world)`, the page state `S` (:98-101) with **`device: 'tg'`** (:99), and
  `window.SIM = {world, server, latency, frameReady, smoke, ping, frameEvent, frameError}` (:102), the frame's only
  door into the page.
- `reset()` (:111-117): closes the popover, stops the autopilot, removes **every** `<iframe>` and empties
  `S.frames`/`S.frameEls` before `boot()` (the fix of review-sim-tests.md F4: a kept frame would hold a token the new
  server denies). check_simulator.js:139 pins it.
- `onWorldEvent` (:119-129): a `ledger` event flashes the row; a `lists` event marks changed Lists rows and calls
  `framesSync('settings')` (:121); a Telegram `update` calls `framesSync('sim')` (:123) and feeds the tour. Every
  world event schedules one render (`scheduleRender`, :140-146; `renderAll`, :147-168).

### 1.2 Login and devices

- `LOGINS` (:33-38): owner (✈️ 📱 💻), sister (shop 1, ✈️ 📱), brother (shop 2, ✈️ 📱), customer (tour step only).
  `buildLogin` (:170-180), `doLogin` (:181-191): sets `S.login`/`S.user`, keeps `S.device` (only laptop is taken from
  a seller, :186), creates the frame when the app is open (:187). `logout` (:192-198).
- `DEV_NAMES` (:39-42): tg, app, laptop, floor. `setDevice` (:223-233); `renderDevices` (:241-268) draws the device
  bar's extras: the frame state, **⚡ enrol (shortcut)** (`#enrolShortcut`, :252), **🔄 sync now** (`#frameSync`,
  :253), the owner's "📱 app at laptop width" switch (`#wideToggle`, :255-264).
- R8 consequence: nothing makes a seller land on the app today. `S.device` starts `'tg'` and `doLogin` keeps it;
  `tourStart` runs a tour on the open pane only when the tour lists `devices` (:993).

### 1.3 The shop floor and Telegram

- Racks: `buildRacks` (:277-293) draws one QR tile per item; `updateRacks` (:294-311) marks the tour's tag (`hot`
  when `st.target.tag`, :296, :305) and moves a transferred tag.
- `scan(id)` (:312-327) is a click on a tile. On the app it sends the frame `{op: 'open', id}` (:319), on Telegram it
  shows the START bar and emits the page event `{src: 'page', kind: 'scan', id}` (:323-324). **The app branch emits
  no scan event** (see trap T2).
- `renderPhone` (:337-364): the chat, the START bar, and the input bar pre-filled and `hot` for a `type` target
  (:360-363). `renderMsg` (:385-425): every button carries `data-cb` and gets `hot` when its callback is the tour's
  (:415). This is the "highlight as part of rendering" rule (review-sim-tests.md F3).

### 1.4 The app frames and the transport

- `ensureFrame(key)` (:489-500): one `<iframe srcdoc=SIM_APP_SRCDOC>` per login (`owner_wide` = the owner's app at
  laptop width), kept across switches.
- **Direct transport** (the default): the frame's prelude finds `parent.SIM` and `parent.SIM.ping() === 'pong'`
  (build_simulator.js:44); `SIM.frameReady(win, app)` (:508-514) registers `S.frames[key] = {direct: true, win, app}`;
  the page then reads the frame's state with `win.SIM_FRAME.snap()` (`snapOf`, :531-535) and commands it with
  `win.SIM_FRAME.cmd(c)` (`frameCmd`, :537-553), both wrapped in try/catch into `SIM_ERRORS`. The frame's sync calls
  `parent.SIM.server.handle` after `parent.SIM.latency` (build_simulator.js:74-83).
- **postMessage fallback**: `ping()` answers `'post'` when the page URL has `?transport=post` (:506), so every frame
  takes the path a host that isolates the srcdoc child would force. The page's `message` listener (:586-614) answers
  `{simFrame: 'call'}` with `server.handle` after `LATENCY` (and shifts `clientTime`/`serverTime` by a clock jump made
  during the flight, :595-600), registers a frame on `{simFrame: 'ready'}` with its first snapshot (:604-608), takes
  `{simFrame: 'event'}` (:609-610) and `{simFrame: 'error'}` (:611-612). Commands go out as
  `{simPage: 'cmd', c}` (:543); on a `screen` command the page patches its cached snapshot at once (:545-550).
- `onFrameEvent` (:517-530) keeps the snapshot and the APP_MSG labels a frame posts, answers the tour's request for a
  fresh snapshot (`T.ask`, :524-527), and turns a frame event into a tour event
  `{src: 'app', key, kind: e.ev | e.kind, data, text}` (:528).
- `frameEnrolled`/`frameHome` (:554-555); `framePre(key)` (:560-564): what an app step waits for first: `'enrol'` or,
  when enrolled but `snap.screen !== 'home'`, `'home'` (the back button). `framesSync(why)` (:566-569) syncs the
  enrolled frames; `framesClock` (:570-572) sends the clock offset to post-mode frames; `enrolShortcut(key)`
  (:574-584) mints a code for the login and types it into the frame's own box (`op: 'enroll'`).
- `renderAppPane` (:615-622): shows the open login's frame and the hint line.
- **Frame highlight** `syncFrameHot` (:624-635): for the frame of the current app step it sends `{op: 'hot', hot}`
  when the wanted callback changes (:630; the frame sets `window.SIM_HOT` and calls `appRender`,
  build_simulator.js:152), and on **every** page render while a mark is wanted `{op: 'mark', sel, text}` (:631-633;
  the frame adds `.simhot`, build_simulator.js:118-126, styled by `FRAME_CSS`, :211). `frameMark` (:636-642): a
  `ui: 'frame:<sel>'` target marks that selector; a `type` target marks `#codeInput, .inbar input`; a `label` target
  with no resolved callback marks every button whose text holds the label.
- In the app: `appRenderMsg` sets `data-cb` on every keyboard button and adds `hot` when it equals `APP.win.SIM_HOT`
  (app/app_ui.js:694-703); `appStepper`'s sell button carries `data-cb = appStepperData(id, n)` and is hot for any
  `S|<id>|…` (app_ui.js:729-731); app.css:97 styles `.kb button.hot, .sell.hot`. Nothing else in the app reads
  `SIM_HOT`.

### 1.5 The laptop: the Sheet, Lists editing

- Tabs (`renderSheet`, :655-691; the list :658-669): Dashboard, Lists, Ledger, Customers, Credits, Deposits, Orders,
  Measurements, Errors, Family group. An edit in progress keeps its cell (:677-678, `S.sheetDirty`, redrawn on
  focusout, :1529).
- Ledger (`ledgerTable`, :707-724): Time, Shop, ItemID, Type, Qty, Amount, Cash, Method, Category, Customer, DueDay,
  Source, Route (✈️ / 📱 + receipt letter, `routeOf` :701-706), Note; **no GroupID column** (a basket reads as N
  unrelated rows, map-basket-readers.md 2.17). Credits (`creditsTable`, :866-876) is one row per `openCredits` entry,
  `td(c.item)` (:870).
- Lists (`listsTab`, :804-836): Label, Active, Detail and (pay_method) Kind are editable cells with
  `data-cell="<key>.<Field>"` (`cellId`, :781), written through `store.setListRow` (`listEdit`, :782-785;
  `textCell`, :786-803); the add-row form (`addRowForm`, :837-845; `data-cell="add"`) calls
  `addListOptionByLabel` (`addListRow`, :846-856). A `lists` event syncs the frames (:121), so a phone gets the
  change at its next pull.

### 1.6 Clock, sale_flow switch, header

- Demo clock = an offset (`clockAdd`, :933-938; `clockTo2100`, :939-944, never runs backwards); `renderClock`
  (:208-215); post-mode frames get `{op: 'clock'}` (`framesClock`), direct frames read `parent.SIM.world.clockOffsetMs`
  (build_simulator.js:54-57). Buttons `#clock31`, `#clockDay`, `#clock2100` sit before `#clockNow`
  (check_simulator.js:125-127 pins the order).
- `postSummary` (:945-952): `buildDailySummary` + the server's summary lines into the Family group tab.
- **sale_flow switch**: the header's `<div class="seg2">` with `#flowSteps` "steps" and `#flowQuick` "quick"
  (simulator.template.html:318-321, title "steps = one question per screen, quick = the one-tap card");
  `renderFlow` (:216-220) lights `#flowSteps` only when `saleFlow(world.ports) === 'steps'`; `setFlow(v)`
  (:954-959) writes `world.settings.sale_flow` and calls `framesSync('settings')`; listeners :1524-1525.

### 1.7 The tours runner

`findTour`/`curStep`/`stepDev`/`stepLogin` (:979-982); `tourBlocked` (:983-989: `need.item` sold, `need.blank` not
blank, `need.unenrolled` and the frame enrolled); `tourStart` (:990-1000: the pane is the open one when the tour lists
it in `devices`, else `tour.device`; steps filtered by `only`); `enterStep` (:1006-1029: switches login and pane and
says so, `T.mark = {meas, ledger}` :1019, `T.pre = framePre(...)` for app steps :1021, asks a post-mode frame for a
fresh snapshot :1025-1026); `checkStep`/`advance`/`finishTour`/`tourLeave`/`tourSkip` (:1030-1064); `tourEvent`
(:1065-1077: events of another user or another frame are ignored; a pending pre-step is re-evaluated first).

How a target becomes a highlight: `resolveWant(st)` (:1107-1117): `cb` is itself; `re` and `label` look in the last
bot message of the step's device (`lastBotFor`, :1078-1081: the frame's `snap.last` on the app); on Telegram a MSG
label goes through `world.sim.buttonByKey`; otherwise the label's text (`labelText`, :1091-1106: a key's text up to its
first `{`, MSG from the world, APP_MSG from a direct frame or from the labels a post-mode frame posted) is matched
against button texts. `computeHot` (:1118-1129) sets `T.hot` to that callback; `markUiHot` (:1130-1141) marks page
chrome (`ui` that is not `frame:`, `tab`, `tab` + `cell`, `#enrolShortcut` during a pre-step).

⏭ "do it for me" (`tourDoIt`, :1185-1197): a `home` pre-step sends `{op: 'screen', screen: 'home'}`, an `enrol`
pre-step runs the shortcut, otherwise the step's `act(ctx)` or `doTarget(st)` (:1198-1215: tag → `scan`, START,
callback → `tapOn` (:1170-1178; on the app `{op: 'tap', data}`), type → `typeOn` (:1179-1183; on the app
`{op: 'text'}`), tab → `setTab`, `ui` → `document.querySelector(t.ui).click()`). `makeCtx` (:1153-1163) is what
`done`/`act` see: world, server, login, user, device, tab, groupPosts, `frame` (the snapshot), want, mark, code, and
the helpers tapData, text, scan, start, photo, click, openTab, setListRow, addList, frameCmd. Captions
(`fmtCaption`, :1216-1229): `{k:key}`, `{f:key|n=V}`, `{l:list.KEY}`, `{v:verb}`, `{c:code}`. Panel
(`renderTours`, :1230-1279): `#tourDo`, `#tourSkip`, `#tourLeave`, the switched-pane line in both languages.

Unattended runs (`?login=…&device=…&tour=…`): `autopilot` (:1492-1505) and `runTourUnattended` (:1473-1491: ⏭ every
4 s per try, three tries, then `simError` + skip), result into `<pre id="smoke">` (`writeResult`, :1468-1472).

### 1.8 SIM.smoke() (:1283-1466), the content of the browser check

Helpers: `waitFor` (:1283-1295), `tgTap`/`tgKey`/`tgStart` (:1302-1310; Telegram taps press the rendered buttons),
`appHas(data)`/`appTap(data, next)` (:1311-1318; they wait for a callback in the frame's `snap.last`), `step`
(:1319-1321). The sequence (`seq`, :1324-1456):

| Step (line) | What it drives | Checks (line: label) | Verdict |
|---|---|---|---|
| login (:1325) | `doLogin('sister')`, `setDevice('tg')` | 1328 'logged in as Seller shop 1, the login screen closed' | V |
| the simplest sale (:1330) | Telegram: START S1-0002, `btn_sell_one` '✅ ရောင်း ၁', `SS\|S1-0002\|b\|none`, `SS\|…\|m\|CASH`, `SC\|…\|ok` | 1308 'a scan of … shows the START bar' (V); 1338 'Telegram: the four taps write one SALE row, cash 18,000' | RC (START, ✅ ရောင်း ၁ → the review card, Save: the same one row) |
| the deposit sale (:1340) | Telegram: S1-0004, `btn_sold`, `btn_new_customer`, typed ဒေါ်စန်း and 09777123456, `m\|CASH`, `p\|half`, `d\|14`, `SC\|ok` | 1354 'one SALE row, cash 22,500'; 1355 'ဒေါ်စန်း owes 22,500'; 1356 'one new customer, ဒေါ်စန်း'; 1357 'DueDay = today + 14' | RC (set buyer new, set payment part half, 14 days, Save; the four assertions stand) |
| app: enrol (:1359) | `setDevice('app')`, wait for `frameReady`, `enrolShortcut` | 1362, 1363, 1365 | V |
| app: a mixed sale of two (:1367) | frame `open S1-0003`, stepper `S\|S1-0003\|2`, `SS\|…\|b\|none`, `m\|mix`, `a\|KBZ`, `x\|half`, typed 5000, `SC\|ok`, sync | 1371 card; 1378 'typed 5000 → the amount screen'; 1386 '✅ shows the sold card'; 1393 'two rows in one group reached the Ledger after syncNow'; 1394 'the SALE of two, cash 19,000 CASH'; 1395 'the PAYMENT of 5,000 KBZ' | AF (1371-1386 O as chat steps; 1393-1395 stand on the form: count 2, mixed KBZ 5000, Save) |
| app: a tour waits for the chat screen (:1398) | frame `screen history`, `tourStart('sell')`, ⏭ | 1401, 1405 | V (needs a `sell` tour that runs on the app; see trap T3 if the form is an `APP.screen`) |
| app: a tour started right after a tap inside the app (:1412) | frame `click button.handle` (ui_history), `tourStart('sell')`, frame `click .pagehead .ghost` | 1414 'APP_MSG keys have their label on the page (ui_btn_back, ui_btn_enroll, ui_meas_save)'; 1419; 1424 | V |
| owner: Lists on the laptop (:1428) | laptop Lists tab, WAVE inactive, then Telegram S1-0002 `S\|…\|1`, `SS\|…\|b\|none`, `SS\|…\|z` | 1432 'laptop: the Lists tab draws the Active cell of WAVE' (V); 1439 'the next Telegram how-paid screen has no WavePay (KBZPay stays)' | RC (the review card's payment edit screen) or AF (the form's payment choices after a sync) |
| the clock and the 21:00 post (:1443) | ⏩ ×15, 🕘 21:00, Post 21:00 summary | 1447, 1450, 1451, 1455 (V); 1454 'the Family group post carries summary_due_overdue naming ဒေါ်စန်း' | V\* (needs the dated credit of "the deposit sale") |

The result carries `transport` (:1461, direct or post), which check_simulator_browser.js reads.

---

## 2. poc/sim_tours.js as built (351 lines): the vocabulary and every tour

### 2.1 Vocabulary

- A tour (header, sim_tours.js:4-23): `{id, login, device, devices?, need?, noAutoEnrol?, title: {my, en}, steps}`; a
  step `{my, en, target, done, login?, device?, only?, act?}`. Targets: `tag`, `cb`, `label`, `re`, `type`, `ui`
  (`frame:<sel>` = inside the app frame), `tab` (+ `cell`).
- Verbs `SIM_TOUR_MSG` (:27-32): 'scan လုပ်ပါ' (source MSG `menu`), 'နှိပ်ပါ' (`help`), 'ရိုက်ပါ' (`cust_find`);
  check_simulator.js:198 requires each verb to be in the named MSG key.
- Done predicates (:38-77): `tap(cb)` (on the app a `S|<id>|` target also matches any stepper count, :38-45),
  `tapRe`, `tapWant` (the tap carried the callback the label rule found, `c.want`, :48), `said`, `scanned(id)` (a page
  scan, or on the app the bot's text `/start <id>`, :50-52), `started`, `menuOpened` (`/start`), `photoSent`,
  `pressed(name)` (page chrome), `when(fn)`, `any`, `listRow`, `codeTyped`, `creditOf`.
- Step makers (:79-101): `tag`, `start` (`only: 'tg'`), `cb`, `re`, `label`, `typed`, `menu()` (Telegram `/start`, or
  on the app `ui: 'frame:#btnMenu'` with `act: frameCmd({op: 'menu'})`, :90-96), `flat`; `OWNER_LAPTOP` (:102).

### 2.2 Every tour, its targets, and what round 6 does to it

| id (line) | Login · device | Title (page copy) | Targets in order | Round 6 |
|---|---|---|---|---|
| sell (:106) | sister · tg, devices tg+app | 'တစ်ဆင့်ချင်း ရောင်း (ငွေသား · အကုန်)' | tag S1-0002, START (tg), cb `S\|S1-0002\|1`, `SS\|S1-0002\|b\|none`, `SS\|…\|m\|CASH`, `SC\|…\|ok` | AF: device app: tag S1-0002 (the form opens with the line), Save. A separate RC tour on Telegram (R8). Title NEW, e.g. 'ရောင်း · တစ်မျက်နှာတည်း (ငွေသား · အကုန်)' |
| deposit (:118) | sister · tg+app, need item S1-0001 | 'စရံ နဲ့ ရောင်း · ကျန်ငွေ ပေးမည့်ရက်' | tag S1-0001, START, `S\|S1-0001\|1`, `SS\|…\|b\|new`, type ဒေါ်နီနီ, type 09444555666 (or `ph\|skip`), `m\|CASH`, `p\|half`, `d\|14`, `SC\|ok`; then OWNER_LAPTOP: tab credits, `#clockDay` ×15, `#clock2100`, `#postSummary` | sale part AF (buyer new + phone, part half, 14 days, Save); the four laptop steps V |
| mixed (:144) | sister · tg+app | 'ခွဲပေး (ငွေသား + KBZPay)' | tag S1-0003, START, `S\|S1-0003\|1`, `SS\|…\|b\|none`, `m\|mix`, `a\|KBZ`, type 5000, `SC\|ok` | AF (how paid mixed, account KBZ, transfer 5000, Save) |
| price (:158) | sister · tg+app | 'စျေးလျှော့ပြီး ၂ ထည် ရောင်း' | tag S1-0002, START, `D\|S1-0002`, type 15000, `SS\|…\|q\|2`, `b\|none`, `m\|CASH`, `SC\|ok` | AF (line price 15,000, count 2, Save) |
| back (:172) | sister · tg+app | 'နောက်ပြန် · မလုပ်တော့' | tag, START, `S\|S1-0002\|1`, `b\|none`, `SS\|…\|back\|method`, `SS\|…\|z` | O (a form has no screen chain); a "remove a line, then leave" tour may replace it. check_simulator.js:156 names `back` |
| restock (:184) | brother · tg+app | 'ကုန်ရောက် (ဆိုင် ၂)' | tag S2-0003, START, `R\|S2-0003`, `RQ\|S2-0003\|5` | AF (restock form, R4 should; R8 runs it on the app) |
| newitem (:194) | sister · tg, need blank S1-0007 | 'Tag အသစ် · ဓာတ်ပုံနဲ့ မှတ်' | tag S1-0007, START, `#photoBtn` (act photo htamein_green), `P\|S1-0007\|25000`, type 12000 or `C\|S1-0007\|skip` | AF (blank tag → camera → the new-piece form, R3, R8); a Telegram RC variant (R5) |
| return (:207) | sister · tg+app | 'ပြန်အမ်း' | tag, START, `T\|S1-0002` | V (a return is "could", R4) |
| expense (:216) | sister · tg+app | 'ကုန်ကျစရိတ် မှတ်' | menu, `M\|exp`, `EC\|fabric`, `EA\|20000`, `EM\|CASH` | AF (expense form, R4 should; R8) |
| payment (:227) | sister · tg+app | 'အကြွေး ငွေလက်ခံ' | menu, `M\|pay`, re `^PY\|`, label `btn_all` | V until a payment form exists (R4 could) |
| takedeposit (:237) | sister · tg+app | 'စရံ လက်ခံ' | menu, `M\|dep`, `DC\|C-0002`, `DA\|C-0002\|100000`, `DN\|C-0002\|100000` | V (R4 could) |
| order (:248) | sister · tg | 'အော်ဒါ · ဘောက်ချာ · အတိုင်းအတာ' | menu, `M\|ord`, `ON`, `OC\|C-0001`, re OI/OQ/OD/ODA, `MS\|V…`, `MM\|…\|photo`, photo, `MK\|`; then app: `frame:#btnMenu`, `M\|meas`, `MS\|C-0002`, `frame:#measForm` (act `{op: 'meas', values}`, done `world.measurements` grew) | V (custom orders and the measurement form keep their screens, R4); the last step is the only app-native-form tour step today |
| reports (:275) | sister · tg+app | 'စာရင်း PDF · ၂၁:၀၀ အစီရင်ခံ' | menu, `M\|rep`, `RP\|today`, laptop 21:00 + post | V (R8: the owner's tours stay on Telegram and the laptop; the spec may switch the login to owner) |
| enrol (:288) | sister · tg, noAutoEnrol, need unenrolled | 'ဖုန်းအက်ပ် ချိတ်ဆက်' | menu, `M\|app`, app type `@code` (act fill), app label `ui_btn_enroll` (act enroll), owner tg `/start`, `M\|devices` | V; see trap T6 if sellers are auto-enrolled at login |
| lists (:304) | owner · laptop | '💻 Lists ပြင် · ဘဏ်/အကောင့်' | Lists cells `KBZ.Label`, `WAVE.Active`, `BANK.Kind`, `add` (each with act); then tg: tag S1-0002, START, `S\|S1-0002\|1`, `SS\|…\|b\|none`, `SS\|…\|z` (:319-323, `device: 'tg'` from step 5, :324) | laptop part V; Telegram part RC (open the review card, its payment edit shows the new name and AYA Pay, no WavePay, ✖️) or AF |
| quick (:327) | sister · tg | 'quick ရောင်း ↔ steps' | `#flowQuick`, tag, START, `S\|S1-0002\|1` (the one-tap card), `#flowSteps` (done `saleFlow === 'steps'`) | Q for the middle; the switch steps must move to the new button and value (`form`); title NEW, e.g. 'quick ရောင်း ↔ form' |
| stranger (:340) | owner · tg, a customer step | 'ဝယ်သူ တစ်ယောက် Tag ကို scan' | customer tag + START (`staff_only` 'ဒီ bot ကို ဆိုင်ဝန်ထမ်းများသာ သုံးနိုင်ပါသည်။'), owner laptop Errors | V |

R8 also asks for a Telegram review-card tour (the backup): its targets are bot buttons, which the engine already
handles (`cb`/`label` on Telegram, `renderMsg` hot, caption edits on the photo card).

---

## 3. poc/build_simulator.js as built (274 lines)

- `CORE` (:25-26): core_config, core_burmese, core_messages, core_ai_prompt, core_ledger, core_report, core_bot,
  core_sync, core_orders. **`FILES`** (:27) = CORE + `poc/sim_mock_ai, sim_ports, sim_seed, sim_sync, sim_tours,
  sim_ui`, one `<script>` each under a banner `/* ===== <file> ===== */` (`main`, :254-271). **`FRAME_FILES`** (:28) =
  CORE + `app/app_i18n, app_store, app_ports, app_sync, app_scan, app_media, app_ui` (the tools/build_app.js order,
  checked at check_simulator.js:82-87).
- The srcdoc (`buildSrcdoc`, :223-240): `<!doctype html>`, `lang="my" data-font="1"`, the Google Fonts link, `app.css`
  + `FRAME_CSS` (:211, `.simhot` outline), the `#app` shell cut from app/index.html (`frameShell`, :213-221: from
  `<div id="app">` to `#photoInput`, no HTML comment), then three scripts: **PRELUDE** (:42-99), the bundle of
  FRAME_FILES, **BOOT** (:108-208). No config.js, no jsQR. Embedded as `var SIM_APP_SRCDOC = "<JSON>"` at
  `<!-- @appframe -->` with `</script` → `<\/script`, `<!--` → `<\!--`, U+2028/2029 escaped (`embed`, :246-252).
- PRELUDE: the transport choice (:44), page errors to `SIM.frameError` or posted (:47-52), the demo clock as a
  `Date` replacement (:53-69), the clock-jump shift (:70-73), the two transports (:74-86), the reply/command listener
  (:87-97), `window.SIM_FRAME_PRELUDE` (:98).
- BOOT: `SIM_FRAME.snap()` (:141-147) returns `{ready, deviceId, screen, label, letter, last: {id, text, keyboard},
  measForm: boolean, code, chip, chipText, error, busy}`; `SIM_FRAME.label(key)` (:148); `SIM_FRAME.cmd(c)`
  (:149-173) with the ops:

| op (line) | Does | Used by |
|---|---|---|
| hot (:152) | `window.SIM_HOT = c.hot; appRender()` | syncFrameHot |
| mark (:153; `mark` :118-126) | adds `.simhot` to `sel` matches and to buttons whose text holds `text` | syncFrameHot |
| open (:154) | `appOpenTagId(id)` (= `APP.phone.sim.start(id)`, app_ui.js:563-568) | a rack click on the app |
| menu (:155) | `appOpenMenu()` | the ☰ steps |
| screen (:156) | `APP.screen = …; appRender(); notify({kind: 'screen'})` | the `home` pre-step |
| tap (:157) | taps `data` on the newest bot message that has it (else the newest) | tapOn, smoke |
| text (:158) | `appCloseOverlay(); appSendText(text)` (a text to the bot) | typeOn, smoke |
| fill (:159) | sets `#codeInput` or `.inbar input` | the enrol code step |
| enroll (:160) | types the code and calls `appDoEnroll()` | enrolShortcut |
| sync (:161) | `APP.sync.syncNow(why)` when enrolled | framesSync, smoke |
| meas (:162-167) | writes `APP.measForm.values` and calls `appMeasFormSave()` | the order tour's last step |
| clock (:168) | the post-mode clock offset | framesClock |
| snap (:169) | a fresh snapshot event with an id | enterStep over postMessage |
| click (:170; `pick` :128-132) | clicks the first `sel` match (whose text holds the label of `key`) | smoke (history, back) |

- Events: the phone's `change` (every bot update, and every `phone.commit(why)` as `{kind: why}`, app_ports.js:229-243),
  `sync` and `syncstate` become `notify` (:189-195; `lite`, :175-184, maps a bot update to `{ev: 'tap' | 'text' |
  'photo' | 'voice'}`); direct frames call `parent.SIM.frameEvent`, post frames post the event with a snapshot (and
  the APP_MSG labels on sync). A post frame also posts `ready` with its labels (:205) and a watcher posts a snapshot
  whenever it changed (every 200 ms, :206).

---

## 4. poc/check_simulator.js and poc/check_simulator_browser.js

check_simulator.js (275 lines, Node, no browser):

| Step (line) | Checks | Verdict |
|---|---|---|
| 1. The output file (:36-51) | 38 exists; 41 under 4 MB; 42 markers replaced; 44 every FILES banner; 47 'FILES is the build_app core order + core_orders, then the six sim files, sim_tours before sim_ui'; 49 banner order; 50 `var SIM_APP_SRCDOC` | V (47 must change only if a new poc/sim_*.js joins FILES) |
| 2. The embedded srcdoc string (:53-66) | 56, 58, 59, 60, 61, 63, 64 'the decoded document is exactly what build_simulator.js builds from today's sources', 65 | V |
| 3. The frame document (:68-107) | 72, 75, 78, 80, 87 FRAME_FILES order, 89, 91, 93 'the shell keeps the ids appWireEvents binds (app, shopName, chip, gear, banner, main, bottom, btnScan, btnVoice, btnMenu, overlay, toast, photoInput)', 94-106 (fonts, no `<script src>`, bootApp config, memory adapter, frameReady, both transports) | V (93 holds as long as R1's seller home keeps these ids; new app files must join FRAME_FILES and tools/build_app.js together) |
| 4. The outer page (:109-130) | 113, 116, 117, 119; **124 'the template carries the ids sim_ui.js binds'** (the list :120-122 names `flowSteps`, `flowQuick`); 127 clock order; 128 voice box; 129 dark tokens | V, except 124: renaming `#flowSteps` (to a form button) must change this list, so the spec must name the check |
| 5. The tour hooks (:132-143) | 135 'app/app_ui.js sets data-cb on keyboard buttons and the stepper's sell button'; 136 'reads SIM_HOT'; 137 page sets and reads data-cb; 138 op hot + appRender; 139 Reset; **140 'the page boots with sale_flow = steps'** (regex `world\.settings\.sale_flow = 'steps'`); 141 pre-step `home` | 135-139, 141 V (the stepper stays on the quick card); 140 must change (R6/R8); a form needs its own hook check (data-f, SIM_HOT in the form renderer) |
| 6. The tours as data (:145-227) | 153 'SIM_TOURS holds the tours of 6.4 (at least 17)'; **156 'every tour of 6.4 is there (sell, deposit, mixed, price, back, restock, newitem, return, expense, payment, takedeposit, order, reports, enrol, lists, quick, stranger)'**; 190 labels; 191 logins; 192 devices; **193 'every step has exactly one target of 6.4 (tag, cb, label, re, type, ui, tab), cb within 64 bytes, re compiles'** (`KINDS`, :160); 194-199; 201 stranger; 206, 210 enrol code step; 214 deposit tour's laptop steps; **217 'the sell tour runs from S\|S1-0002\|1 to SC\|S1-0002\|ok'**; 223 'a S\|<id>\|1 target is done by that tap, and on the app by any S\|<id>\|<n> of the stepper'; 226 label target done by `c.want` | 153, 190-199, 201, 206, 210, 214, 226 V; 156 changes if `back` is removed or ids renamed; 193 changes if a target kind is added (e.g. `f`); 217 O (the sell tour becomes scan → Save); 223 Q (still true of the stepper on the quick card, no longer of the sell tour) |
| 7. A frame without parent.SIM (:229-272) | 252 ready message carries labels; 262 watcher; 267 snap answer; 269 page reads posted labels | V |

check_simulator_browser.js (98 lines): finds Chrome (:23-35), runs
`pos-simulator.html?autorun=smoke&latency=0` headless with `--virtual-time-budget=60000` (:59-63), reads
`<pre id="smoke">` (`smokeOf`, :38-44). Checks: 70 Chrome ran; 72 the element; 73 JSON; 76 passed > 0; 77 failed 0;
78 no page error; 79 transport direct; then the same with `&transport=post` (:84-93): 85, 87, 90 transport post,
**91 'postMessage: SIM.smoke() passed N checks, as many as over parent.SIM'**, 92, 93. All V as a harness. 91 binds
any new smoke step: it must make the same number of checks over both transports (no transport-dependent skip). With
no Chrome it prints "skipped: no Chrome found" and exits 0 (:57).

---

## 5. The suites' checks that pin round 5, sorted

### 5.1 poc/run_wizard.js (1666 lines; bench = seed + Lists + `sale_flow = 'steps'`, :55-76; `guided()` :122-127)

Step 1. Nothing before ✅ (:143)
- O: 149 'the card itself is edited into the first question (same message id); nothing written' (RC equivalent: the
  card is edited into the review card, nothing written); 151 'the first screen: the sale line, then "who bought it"
  and the hint that typing searches'; 159 'state: kind sale, step buyer, item S1-0002, draft {qty: 1}, hist [], msgId
  = the card'; 163 '🚫 edits the card into "how paid"; nothing written'; 167 '💵 edits the card into "how much now"
  ending with မှန်ပါသလား?…'; 169 'the first button is ✅ အကုန် 18,000 → SC|S1-0002|ok'; 183 '✏️ အခြား edits the
  screen into ask_number…'; 187 'typed 18000 (the whole total) → the summary as a new message with ✅ မှန်တယ်; a typed
  amount never commits' (the rule "a typed amount never commits" survives as RC: a typed paid amount returns to the
  card); 192 'typed 20000 … without ✏️ → the summary with paid 18,000'; 195 'and the summary's ✅ writes the one SALE row'.
- RC: 154 'buyer rows: [🚫] [👤 ...] (up to four) [✏️ new name] [⏮ back|buyer, ✖️ z]' and 157 'the texts are
  btn_no_name, btn_back and btn_cancel' (only if the buyer screen is reused as the card's buyer edit screen; its last
  row then returns to the card); 177 'the state is cleared, lg:<uid> holds the group, no customer was created'.
- RC+AF: 172 '✅ writes exactly one SALE row: qty -1, cash 18,000, CASH, no customer, no DueDay, no note' (R2's default
  write: scan then Save); 175 'the card reads ရောင်းပြီး with [undo, receipt] only (no 💳 👤 🏦 💵+🏦 ➕)' (R2: after
  Save the sold card shows undo and receipt).

Step 2. The count (:200)
- V: 204 'the SKU card keeps S|id|1 and Q|id: cardKeyboard is byte-identical in both modes' (if the item card keeps
  both buttons in form mode).
- RC (the grid as the card's count edit screen): 209 'Q|id sends the grid as a new message: SS|id|q|2..9, then [✏️ QN,
  💬 D, ✖️ SS|z]'; 211 'the grid text starts with ask_qty…'; 227 'typed 3 on the grid (no ✏️) → … no AI call'; 248
  'typed 0 → bad_qty with the back row, the count state kept'.
- RC+AF: 253 'UNIQUE S1-0001: ✅ ရောင်းပြီး goes straight to the buyer screen with qty 1 (no count)' (R2: a
  one-of-a-kind line is count 1 and cannot be added twice).
- O: 213 'the state remembers the grid, not the card'; 217 '၃ edits the grid into the buyer screen…'; 236 '✏️ edits the
  grid into ask_qty_number…'; 240 'typed 4 after ✏️ → the buyer screen as a NEW message'.

Step 3. A changed price (:259)
- RC: 265 '💬 on the card: the price prompt is a new message with [✖️ SS|z]…'; 292 'typed 0 after 💬 → ask_sale_price
  again…'.
- RC+AF: 278 '✅ writes qty -2, unitPrice 15,000, amount 30,000, note price…'; 285 'on a UNIQUE piece the typed price
  goes to the buyer screen at once (qty 1 at 20,000)' (the "at once" part is O).
- O: 269, 273, 275, 300, 304, 307 (the grid with a price line, back to the grid, still nothing on how-much-now).

Step 4. Buyer (:312): the matching rules are the same `findCustomers`/phone rules a form's search field needs.
- RC+AF: 318 'typed ဒေါ်မြင့် (exact) picks C-0001 (no new row)…' (the "goes to how-paid" part is O); 323 'typed
  ဒေါ်မြ → cust_pick with ဒေါ်မြင့် and "create ဒေါ်မြ"'; 327 'create keeps the name and asks the phone with [⏭
  SS|ph|skip] (not Z); no Customers row yet'; 332 'a phone nobody has → cust_none…'; 336 'typed 12 → cust_none…
  (digits are never a name)'; 339 'typed 5678 (the last four digits…) → cust_pick offering her and NO create button';
  343; 347; 350 'typed 123 (too short) → ord_ask_phone again'; 353 '… a known number is never duplicated'; 363 'a new
  name and a valid phone → how-paid; the Customers tab is untouched until ✅'; 366 '✅ creates ဦးသန့် with phone
  09555000111 and the SALE row carries the new id'; 368 'the sold card names the buyer (cust_attached) and offers no
  📱'.
- RC: 357 'create → how-paid with newName and newPhone kept…; the header shows both'; 372 'skip leaves the phone
  blank…'; 375 'after skip the sold card carries the 📱 row for the new buyer without a phone'.

Step 5. How paid (:380): the Telegram keyboard rules move to the card's payment edit screen; the app's segmented
control (R2) reads the same lists but has no six-button limit.
- RC: 386 'seed lists: [💵] [KBZ] [WAVE] [bank] [mix] [➕] [back, z]'; 388 '(six answers)'; 410 'three wallets and a
  bank: … (five answers, never seven)'; 416; 420 'more → sale_ask_account…'; 425; 432 'six wallets: four 📲 rows, [▶️
  → a|p1], [➕]'; 436; 442.
- RC+AF: 392 'bank with one bank (BANK by name) skips the account screen…'; 398 'two bank-kind accounts →
  sale_ask_account with two 🏦 rows…'; 404 'with no bank-kind account the 🏛 ဘဏ် button is absent'.

Step 6. Mixed (:447)
- RC: 453 'mix → KBZ … → split_ask_amount with [တစ်ဝက် 9,000]…'; 515 'a spoken ငွေသား ငါးထောင် … stores bankPart
  13,000' (or O if voice answers on edit screens are dropped).
- RC+AF: 463 '✅ writes SALE (cash 8,000, CASH, split) then PAYMENT (10,000, KBZ, refGroupId = group, split) in one
  group' (R2: mixed = sale cash part + a PAYMENT row); 469 'the sold card prints split_done and the plain rows'; 479
  'typed 18000 on the amount screen → not mixed…'; 482 'one row, method KBZ'; 486 'typed 0 → sale_bad_amount (1 ..
  17,999)…'; 493 'typed 9000 … → the buyer screen with sale_need_buyer and no 🚫' (R2: a part payment requires a
  buyer); 501 '✅ မှန်တယ် → SALE (cash 4,000, DueDay today + 14) + PAYMENT (5,000), owed 9,000'; 503 'the card's
  credit_done says ပေးပြီး 9,000 (cash + payments, not 4,000)'.
- V\*: 467 'saleGroupInfo.owed 0; groupMethods two entries; dayStats CASH +8,000 and KBZ +10,000'; 468 'the receipt
  prints (ငွေသား 8,000 · KBZPay 10,000); rewriteCheck answers complex'; 474 'undo within 30 min mirrors both rows…'.
- O: 458 '… how much now: [✅ အကုန်] [10,000 → p|bank, ✏️] …'; 490 'typed 5000 → how much now'; 497 'ဒေါ်မြင့် → when
  is the rest paid'.

Step 7. The seven outcomes of commitSaleGroup (:520)
- V: 525, 527, 529, 531, 533, 536, 539, 541, 543, 545 'a date chosen with a full payment is dropped', 547 'a bargained
  part sale carries credit, not price' (direct `commitSaleGroup` calls; valid as long as a one-line basket is
  today's write byte for byte, map-basket-readers.md 3.3 rule 7).

Step 8. Part without a buyer (:552)
- RC+AF: 558 'half → the buyer screen without 🚫 and with sale_need_buyer…'; 573 '✅ မှန်တယ် → one SALE row: cash
  22,500 of 45,000, ဒေါ်ခင်, DueDay today + 14, note credit'; 601 '✅ creates ဒေါ်စန်း and no deposit question is asked
  (she is new)'.
- RC (+AF where the form offers the same choices: 7, 14, 30 days, a date, not sure, R2): 562 'ဒေါ်ခင် → sale_ask_due
  (never how-paid again) with [7 14 30] [✏️ ❓] [back, z]'.
- RC (the deposit question after Save; R2 does not say whether the app form asks it): 577 'the card has credit_done,
  sale_due_set and … the deposit question with [CD yes p, CD no p] only'; 583 'yes → one DEPOSIT_APPLIED row…'; 591
  'no → the plain rows… and no write'; 609 'all taps: the deposit question sits on the scanned photo card itself';
  613 'CD yes on the photo card edits it as a caption (isCaption true)…'.
- O: 568 '၁၄ ရက် → the summary with sale_line_paid and sale_due_set…'; 597 'the buyer-needed screen answered with ✏️
  new name … → sale_ask_due (the typed path exits through saleNext)'.

Step 9. Due typed and unknown (:620)
- RC: 628 '✏️ ရက်စွဲ ရိုက် edits the due screen into ord_ask_due_text…'; 645 'ten days ahead typed as d.m.yy → the
  summary as a new message…'; 652.
- RC+AF (the date rules of `parseDayText` and `SALE_DUE_MAX_DAYS`): 632 'typed 32.13.26 → ord_bad_date…'; 639
  'yesterday typed … → ord_bad_date both times'; 641 'a date 400 days ahead → ord_bad_date'; 649 'the same day typed
  as yyyy-mm-dd → the same key'; 656 '❓ မသေချာ → dueDay blank and sale_due_none…'; 658 '✅ writes the credit without
  a DueDay and the card prints no due line'.

Step 10. Overdue by DueDay (:663): V\* (setup `A.guided(u, 'S1-0004', [...])` at :667): 670, 674, 678
'the 21:00 summary has summary_due_overdue naming ဒေါ်မြင့်…', 679, 689.

Step 11. Back (:694)
- O: 702 'back from the summary → due → paid → method → buyer → the item card…'; 708; 710; 713 'bank with one bank
  skipped the account screen (hist [buyer, method])'; 715; 722; 730; 736 'the back buttons of two successive screens
  within 120 s move two screens'; 739; 771; 774.
- RC: 742 'back from the first screen is the card'; 744 'from that card S|id|1 again within 120 s starts the flow
  once more (nothing written…: S is exempt from the tap guard)' (core_bot.js:446 keeps S exempt while S writes
  nothing); 749 'the ➕ prompt opened on how-paid carries [⏮ back|method, ✖️] and keeps the sale in saved'; 752; 756;
  758; 760; 764 'a name typed from the account screen → the kind screen…'; 766.

Step 12. Cancel (:780)
- RC: 786 '✖️ on how-paid → the message is cardText + cardKeyboard, state null, no row'; 793; 797; 810 '✖️ on the
  ၂..၉ grid left behind … → the grid says expired…'; 816 'M|exp mid-flow opens the expense flow'; 818; 824 '✖️ on a
  guided screen with no state at all → the card, no Errors row'.
- V: 829 'Z elsewhere still answers cancelled'.
- O: 802 '✖️ on the price prompt from the grid → the card on the grid's message'.

Step 13. Stale, double, expired taps (:834)
- RC: 841 'a second S|id|1 on the same card within 120 s neither writes nor edits and keeps the state'; 850; 857 'a
  tap on the earlier screen → that message says expired…'; 874 'tick(3) … then SC replayed on the sold card → a new
  expired message, the card kept (isCommittedCard)'; 878 '… (the sold_done text rule)'; 884 '✅ after tick(31) →
  expired on the message and a fresh item card…'; 889 'a scan of another tag mid-flow clears the state'; 891.
- RC+AF: 870 'two ✅ on the same message within 120 s write one group' (the form's Save tapped twice writes one group).
- O: 855 'a typed answer moved the flow to a new message'; 861 'the flow is at the due screen'; 864 'SS|m|CASH on the
  live message while the state is at due → nothing changes'.

Step 14. Sold meanwhile (:896)
- RC+AF: 907 'the sister's ✅ edits her message to card_sold_out + card_buyer + sale_gone with cardKeyboard, writes
  nothing, clears the state' (a Save on a sold one-of-a-kind writes nothing; the app needs its own refusal); 922 'a
  SKU below zero still writes (nine of three: stock -6)'.
- RC: 916 'the owner sells S1-0004 first: the sister's FIRST tap … answers the S✖ screen at once with no state'.
- setup only: 901, 905.

Step 15. ➕ inside the sale (:928): add-option-on-the-fly (memory: round-3 wants) belongs to both the card's payment
edit screen and the form's how-paid control.
- RC: 934 'LA|pm|SSA on how-paid edits it to add_ask_pm with [⏮ back|method, ✖️]…'; 957; 978; 981; 986 '🏛 → the
  next screen is split_ask_amount for the new account'; 995.
- RC+AF: 938 'typed AYA ဦးမောင် → sale_ask_kind … and NO Lists row yet'; 944 '🏛 ဘဏ်အကောင့် → one Lists row with kind
  bank…'; 950 'the sold card carries acct_detail_hint and [🔢 LD|pm|<key>]…'; 954; 964; 969 'typed an existing label
  (KBZPay) → add_exists, no kind question, no second row…'; 974 'typed 5000 → add_ask_pm again…'; 991 'typed 6000, ✅ →
  SALE (cash 12,000, CASH, split) + PAYMENT (6,000, the new key)'.

Step 16. Menu taps keep the flow (:1001): RC: 1009, 1011, 1016 'M|find mid-flow replaces the state (kind find)',
1019, 1023 'a scan clears it'.

Step 17. Quick switch (:1028)
- V (already on quick): 1032 'seedSimWorld sets sale_flow quick and saleFlow reads it'; 1036 'scan + ✅ ရောင်း ၁ writes
  at once and the card has afterSaleKeyboard's rows exactly as run_round4 step 1'; 1041 '💬 + a price writes one piece
  at once'; 1045 'askQty has S|id|n digits and [QN, Z], its text unchanged'; 1049 'no SS|, SC| or LA|pm|SSA button
  anywhere in the quick world' (should also exclude the review card's new prefixes); 1062 'flipped back to quick: the
  next tap writes again, without a restart'.
- Must change (R6): 1051 "'QUICK ', 'Quick', 'steps', 'x', a blank and a missing key read as the right mode" (today
  'steps', 'x', blank and missing read as `steps`; under R6 they read as `form`).
- RC: 1057 'flipped to steps between two sales: the next tap asks instead of writing' (flipped to form: the next tap
  shows the review card and writes nothing).

Step 18. Voice (:1067)
- V: 1074 'the spoken sale shows the confirm card (nothing written)'; 1077 '✅ writes as today and shows
  afterSaleKeyboard (the corrective rows) in steps mode too' (if the spoken sale keeps its corrective card in form mode).
- RC or O: 1080 'a spoken ဒေါ်မြင့် on the buyer screen picks her'; 1083 'a spoken တစ်သောင်း on the amount screen
  stores 10,000…'; 1088 'a spoken သုံး (qty 3) on the grid → the buyer screen with qty 3'.

Step 19. Owner (:1093)
- V\*: 1100 (setup), 1112 'V|g voids the guided mixed group (both rows mirrored)'.
- RC+AF: 1103 'the owner's flow is identical and the buyer screen of a shop-2 piece lists ဒေါ်ခင် (the shop-2 buyer)
  first' (recent buyers as chips, keyed on the item's shop); 1106 'the how-paid screen lists the shop-2 account first
  (keyed on item.shop, not staff.shop)'; 1109 'the owner's mixed sale of the shop-2 piece writes two rows in shop 2';
  1118 'the shop-2 account is absent under a shop-1 sale'.

Step 20. Receipt and reports (:1124): V\* (setup `A.guided(...)` at :1128): 1135 'RC|g: receipt_total, then
receipt_transfer, then sale_due_set, then receipt_customer'; 1138; 1146 'the owed report has the ပေးမည့်ရက် column…';
1152. V: 1159 'convertSaleToCredit on a quick sale leaves dueDay blank…'.

Step 21. Ledger helpers (:1165): V: 1170, 1172, 1176, 1179, 1181, 1182, 1183, 1186.

Step 22. Kind in the core (:1191): V: 1196, 1198, 1200, 1202, 1205, 1209, 1212, 1220, 1225, 1228, 1230, 1232, 1234,
1236, 1237, 1239, 1243.

Step 22z. Found by the step-1 checker (:1249)
- RC: 1256 'the whole total typed as the transfer part puts the payment on KBZ alone (mixed false)'; 1269; 1277 'a ✖️
  racing the ✅ leaves the sold card as it is ([undo, receipt]); expired comes as a new message'; 1285 'with a newer
  flow live on another card, a late ✖️ or step tap on the sold card is ignored…'; 1294 '⏮ on the look-alikes of a
  typed name → the buyer screen again…, not the item card'; 1299; 1303; 1322; 1326; 1334 'a ➕ arriving after the step
  moved on is ignored without an edit (rule (c))…'.
- RC+AF: 1265 '✅ writes SALE (8,000 CASH) + PAYMENT (10,000 KBZ), not 18,000 on KBZ'.
- O: 1260 'back to the transfer part and typed 10000 → mixed again…'; 1312 'grid-started: ⏮ on the look-alikes → the
  buyer screen with qty 3 kept (not the grid)'; 1316 'buyer needed: ⏮ on the look-alikes → the buyer-needed screen…'.

Step 22y. Pinned by the step-1 checker's mutants (:1338)
- RC+AF: 1357 'typed 5000 on how-much-now below the 10,000 transfer part → sale_bad_amount 10,000 .. 17,999…'; 1364
  'sale_due_presets "3, 10, x, 45, 60" → the day buttons ၃ ၁၀ ၄၅'; 1369 'sale_due_presets with nothing usable → 7, 14,
  30'; 1375 'a new name that exists by ✅ (added meanwhile) is that customer, not a second row'; 1402 'a bargained total
  of 1: how-paid has no 💵+🏦 row'.
- RC: 1383 '✖️ on an old screen of S1-0002 while the price prompt of S1-0003 waits → that screen expired…'; 1389;
  1394 'ဒေါ်ခင် (who holds a deposit) paying in full gets no deposit question…'.
- V: 1412 'six dated overdue credits → the 21:00 line names five of them'; 1418 'sim clock: now() = the real clock +
  world.clockOffsetMs…'; 1424 'sim.buttonByKey finds ✅ အကုန် 18,000 by btn_paid_all…'.
- O: 1345 '⏮ on the transfer-part screen → the account screen…'; 1350 '⏮ on the ✏️ prompt of how-much-now…'.

Step 22x. Found by the step-1 reviewer (:1429)
- RC+AF: 1441 'sale_due_presets "0.4,7,500" → only the ၇ ရက် button'; 1450 'sale_due_presets "365, 366, 30" → ၃၆၅ and
  ၃၀ (366 is past SALE_DUE_MAX_DAYS)'; 1546 '💵+🏦 → ➕ → "ငွေသား" typed → add_ask_pm again…, nothing added'.
- RC: 1445 'a stale or hand-built SS|id|d|500 or d|0.4 writes no DueDay…' (prefix-bound); 1458 'a spoken sale of the
  piece on how-paid → no ✅ proposal…'; 1464; 1474 'a voice proposal confirmed while a guided sale of the same piece
  is open writes once and closes the flow…'; 1485; 1490; 1516 'a past date typed on the due screen → the due screen
  again…'; 1525 'typed 1000 on the grid (no ✏️) → the grid again… bad_qty first'; 1532, 1538 (the look-alikes header);
  1551; 1569 'the edit to how-paid fails and is sent as a new message → the state remembers that message'; 1573; 1600.
- O: 1498 'new name, a known phone, ✏️ create, then ⏮ ⏮ ⏮ → the buyer screen, the name screen, the item card'; 1506;
  1583, 1592, 1608 (an edit sent as a new message, then ⏮ back to the grid / how-much-now).

Step 23. Texts, 64 bytes, no errors (:1614)
- V: 1619 'every key of section 7 is in MSG and non-empty'; 1621; 1623; 1626; 1639 '… within 64 bytes…'; 1645 'no update
  of any world failed with an exception'. Caveat: if the spec deletes a dead round-5 key (e.g. `sale_ask_paid`) or
  changes its text, 1619/1623 must be named.
- V, but binding: **1633 'every text is exactly the one the spec gives (compared with
  docs/design-round-5/SPEC-round-5.md)'** pins all 25 round-5 texts, including `settings_note_sale_flow` 'steps =
  တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက် ရောင်း' (core_messages.js:448). A note that names `form` breaks this check
  unless the spec names it (proposed NEW text: 'form = တစ်မျက်နှာတည်း ဖြည့်ပြီး သိမ်း · quick = ခလုတ်တစ်ချက် ရောင်း').
- O if the `SS|`/`SC|` prefixes die, else V: 1637 'the spec's byte counts: back|due_text 24, CD yes p with a 12-byte key
  58, LA|pm|SSA 17, SC ok 13'.
- RC: 1643 'START + one tap asks who bought it; nothing is written before ✅ (the steps mirror of run_round4's last
  check)' (form: START + one tap shows the review card; nothing written before Save).

Step 24. Caption-aware edits (:1651): V: 1661 'over N edits in every bench, isCaption === !!target.photo for each'; 1662
'both kinds were seen…' (the review card on the photo card keeps supplying caption edits; still the right guard for
Telegram's 1024-character caption limit, map-basket-readers.md 2.13).

### 5.2 poc/run_round4.js 9z (:1932) and the end of step 10

The bench runs on the seed's quick (the label at :1938 says "the code default is steps").
- V (Q): 1938 'bench() runs on sale_flow quick…'; 1942 'quick: the sale card is exactly the one step 1 asserts…'; 1945
  'quick: the split path is exactly as step 2 asserts…'; 1951 'quick: the ➕ path is exactly as step 3 asserts…'; 1954
  'quick: no SS|, SC| or LA|pm|SSA button was ever emitted in this world…' (should also exclude the review card's new
  prefixes); step 10: 2002 64 bytes, 2007 'START + one tap still records a one-piece cash sale; nothing is asked before
  the commit', 2008.
- RC: 1964 'steps: sell() returns no row of its own…; the card is edited into the buyer screen and a sale state waits
  for the answer' (form: the card is edited into the review card); 1967 'steps: ✖️ on that screen brings the item card
  back; still nothing written'.

### 5.3 poc/run_app.js steps 32-40 (:899-1268)

| Step | Checks (line: label) | Verdict |
|---|---|---|
| 32 (:899) appInputModeFor for the guided sale | 900 'the buyer and name steps: the text bar'; 901 'the phone step: tel'; 902 'the typed-date step: date (the date sheet)'; 903 '…a number prompt of the flow (sale_step): the keypad' | O (the app no longer runs the chat steps in form mode) |
| | 906 'appQuestionLine: the last non-empty line…'; 909 'appKeypadKeyFor: message id, purpose and the saved step…' | V while other number prompts use them (sale_price, `run_app` 39:1196) |
| 33 (:912) a guided mixed sale on the real store | 918 'a phone enrolled against the seeded world sells in quick mode (the suites' default)' | V |
| | 921 'the server says steps: the next pull carries it to the phone'; 924 'the scan shows the SKU card (the stepper)' | AF (the server says form; the scan opens the form with the line) |
| | 928, 933, 937, 941, 947, 950, 954, 957 (stepper `S\|…\|2` → buyer question, 🚫, 💵+🏦, the keypad scheduled once and titled, OK sends, how much now) | O |
| | 962 'store.ledger gains two rows: the SALE (cash part 31,000) and the PAYMENT (5,000 KBZ) of one group'; 965 'ONE outbox group entry, SALE then PAYMENT; no customer entry'; 967 'the receipt number is on the SALE row only'; 970 'the sold card replaces how much now; the state is cleared'; 973 'the sync answers ok without flags; both rows are on the server' | AF (same assertions after the form's Save; 967 needs a basket sibling: one number per basket, map-basket-readers.md 2.11) |
| 34 (:976) part payment with a new buyer typed | 985, 988, 993, 997, 1002, 1006, 1009 (text bar, tel keyboard, keypad, the date-sheet button) | O |
| | 1013 'the date sheet: ui_date_title, an input type=date from today (min), close and OK'; 1018; 1020 'OK sends the date as yyyy-mm-dd text…' | AF if the form's "a date" choice reuses the sheet (ui_date_title '📅 ရက်စွဲ', ui_btn_pick_date '📅 ရက်စွဲ ရွေးပါ') |
| | 1023 (summary) | O |
| | 978 setup; 1028 'one SALE row: 12,000, 5,000 paid now, the new buyer, DueDay ten days ahead'; 1030 'a customer entry before the group, the group's SALE names that customer'; 1032 'the sold card: who owes what, and 💰 while owed'; 1036 'after the sync the server resolves the sale's customerId…; the DueDay arrived' | AF |
| 35 (:1040) restart mid-flow | 1045, 1048 'after the restart the persisted cache holds the guided state on the same message', 1051 | AF (the form's draft survives a restart, as the measurement draft does: `appMeasDraftWrite`, app_ui.js:212, called at :1116) |
| | 1054 '✅ အကုန် commits one cash SALE; the receipt counter continued'; 1057 | AF |
| 36 (:1059) per-device pref `setting:sale_flow` | 1062 'the pref wins over the pulled Settings on this phone only'; 1067 'S\|S1-0003\|1 commits at once (the one-tap card…)' | V (the pref stays, app_store.js:342) |
| | 1073 'the same tap in Telegram (the server says steps) asks the buyer and writes nothing' | RC (server says form: the review card) |
| | 1077 'without the pref the phone follows the server again…' | V (value `form`) |
| 37 (:1080) tour hooks, keypad, source checks | 1086 'the stepper's sell button carries data-cb = S\|S1-0002\|1; no highlight without SIM_HOT'; 1090 'SIM_HOT = S\|S1-0002\|… highlights the stepper's sell button' | Q (the stepper lives on the quick card) |
| | 1097 'every keyboard button carries data-cb = its callback; none is hot without SIM_HOT'; 1101 'SIM_HOT marks exactly the button with that callback' | V (any bot keyboard in the app chat; setup reaches a guided screen, so V\*) |
| | 1103, 1110, 1120, 1122, 1126, 1129, 1132 (buyer bar, tel bar, keypad opening on the transfer part and on ✏️ အခြား, ✖️) | O |
| | 1135 'bootApp takes opts.online…'; 1136 'appDoEnroll asks APP.sync.online()…'; 1137 'appRenderMsg sets data-cb and reads SIM_HOT; appStepper sets data-cb'; 1139 'app.css highlights .sell.hot and sizes the date input'; 1140 'the two keys of the date sheet are in APP_MSG (and merged into MSG)' | V |
| | **1142 'the dev page starts in steps and has the sale_flow checkbox that syncs the settings'** (app/dev/index.html:70, :136, :207-214) | must change (form / quick) |
| 38 (:1145) | 1146 'no update failed with an exception' | V |
| 39 (:1149) highlight, data-cb, keypad titles | 1159 'a UNIQUE card's sell button keeps its good class…'; 1167 'the stepper's sell button is hot for any S\|S1-0002\|…'; 1172 'the stepper's data-cb follows the count…' | Q |
| | 1194 'sale_qty and sale_step: the keypad … titled with the question line'; 1213; 1224; 1227 | O |
| | 1196 'the other number prompts (sale_price here) keep the first line as the title' | V |
| 40 (:1230) a server older than DueDay | 1243 '…stores the Settings with sale_flow quick and the phone sells with the one-tap card (the server says steps)'; 1249; 1254 'S\|S1-0003\|1 commits one SALE at once, without a due day' | V (quickForced, core_sync.js:1454-1468, :1489-1492, still forces quick; "steps" in the labels reads "form") |
| | 1259 '…the next page brings the Settings as they are; steps again'; 1266 'the stepper's S\|S1-0003\|1 opens the guided sale again and writes nothing'; 1268 | AF (form again: the scan opens the form) |

### 5.4 poc/run_sync.js R5 (:1538-1771; `r5StepsWorld` sets steps, :1542-1546)

| Step | Checks (line: label) | Verdict |
|---|---|---|
| R5a (:1548) mixed guided sale on the reference phone | 1565 'offline: one outbox group, SALE (cash 4,000, DueDay ten days ahead, ဒေါ်မြင့်) then PAYMENT (5,000 KBZ, no DueDay)'; 1572 'pushed: ok with no flag (the SALE is on the shadow before its PAYMENT)…; 9,000 owed'; 1576; 1580 'the undo group (two mirrors) is ok too…' | V\* (the reference phone, poc/sim_phone.js, has no form: the setup should call the basket commit through the phone's ports, as the app form will, or drive the review card); add a basket sibling (3 SALE + PAYMENT, OVERPAID silent only when the PAYMENT is last, map-basket-readers.md 2.15) |
| R5b (:1585) | 1589 dueDay validation | V |
| R5c (:1593) older phone | 1614 'a group whose rows have no dueDay (an older phone) is accepted and its row is stored with dueDay ""'; 1618 'a fresh phone's bootstrap carries dueDay…' | V\* (setup taps `SS\|`/`SC\|`, :1600-1609) |
| R5d (:1621) list kind | 1630, 1635, 1645, 1654 | V |
| R5e (:1659) buyer of a guided sale | 1673 'a typed new buyer: the outbox holds the customer entry, then the group whose SALE names it; after 🚫 only a group is added'; 1678 'one sync: the server has the customer once…' | V\* / AF (the form's "new" buyer must queue the customer entry before the group) |
| R5f (:1682) | 1687 'the phone bootstraps with the seed's sale_flow quick' | V |
| | 1693 'after the pull … saleFlow(phone) is steps: the sell button opens the buyer question and writes nothing' | RC (form: the sell button on the reference phone's bot opens the review card) |
| R5g (:1697) | 1701, 1704, 1715 | V |
| R5h (:1719) older server | 1734 'this server's pull names caps [dueDay]; the phone sells guided' | RC/AF (sells with the form); the exact caps list is pinned here (`same3(wire.caps, ['dueDay'])`) |
| | 1739 '…stores the map with sale_flow quick and sells with the one-tap card (the Sheet still says steps)'; 1745 'ရောင်း ၁ commits at once…'; 1749; 1757; 1769 | V |
| | 1753 '…steps again'; 1764 'published again: … the sell button opens the buyer question (writes nothing)' | RC (opens the review card) |

### 5.5 poc/run_gas.js 18-25 (:1437-1774)

| Section | Checks (line: label) | Verdict |
|---|---|---|
| 18 (:1487) setupSheet on an empty book | 1491 Ledger 27 headers, DueDay text; 1493 Credits 15; 1498 'Messages has every key of spec section 7' (`R5_KEYS`, :1441-1444); 1500 Lists Kind; 1505 Dashboard Overdue; 1507 | V (1498 must be named if a round-5 key is deleted) |
| | **1495 'Settings: sale_flow = steps, its Key cell carrying settings_note_sale_flow, and sale_due_presets = 7,14,30'** (seeded by gas_setup.js:76) | must change (setupSheet seeds `form`; the note's text) |
| 18b (:1509) | 1515, 1516, 1518 | V |
| 19 (:1521) a round-4 book | 1525, 1529, 1532, 1534, 1537, 1545 | V |
| | **1540 'Settings got sale_flow = steps and sale_due_presets…'** | must change (form) |
| 19b (:1548) | 1553, 1556 | V |
| 19c (:1560) | 1567 'setupSheet keeps the typed sale_flow quick…' | V (add: a round-5 Sheet holding `steps` reads as form, R6) |
| 20 (:1572) publish window | 1589, 1599, 1602, 1604, 1607 (direct `commitSaleGroup` + `gasSyncTabs.appendRows`) | V |
| 21 (:1611) Credits view, Kind | 1620, 1626, 1630, 1634, 1636, 1639 | V |
| 22 (:1643) 21:00 refresh | 1655, 1661, 1663, 1667 | V |
| 23 (:1671) one sync [customer, mixed group, list entry] | 1687, 1690, 1693, 1696, 1698 (synthesised rows; "guided" is only the name) | V (a basket sibling: one Ledger block of 4 rows × 27, no OVERPAID) |
| 24 (:1701) | 1718, 1732, 1747, 1760, 1763 | V |
| 25 (:1767) caps | **1771 'api=sync: the pull carries caps ["dueDay"] on the wire…'** (exact `JSON.stringify(...) === '["dueDay"]'`) | V unless round 6 adds a cap (then this check, run_sync.js:1734 and the app's quickForced rule, core_sync.js:1454, need naming) |

### 5.6 What stays green without being touched

Because `seedSimWorld` seeds `sale_flow: 'quick'` (sim_seed.js:72) and every one of these benches keeps the seed:
run_scenario.js 0-77, run_lists.js A-V, run_round4.js 1-9l and 10, run_app.js 1-31, run_sync.js 0-S22, T-B, CS,
S18, S11, Final, L1-L3g, M1-M11, run_gas.js 1-17. None of them emits `SS|`/`SC|`. The only change that touches them
is the code default of `saleFlow` (core_config.js:207-210): they all set the value explicitly, so a new default
(`form`) does not reach them.

---

## 6. Traps the spec must close (found while mapping)

- **T1. ⏭ throws on a `frame:` target without `act`.** `doTarget` ends with
  `document.querySelector(t.ui).click()` (sim_ui.js:1214); `'frame:#x'` is not a valid selector, so it throws
  (caught at :1195 into `SIM_ERRORS`, which fails the unattended run and the browser check). Every existing
  `frame:` step has an `act` (sim_tours.js:93-94, :264-265, :268-271). Either every form step carries an `act`, or
  `doTarget` learns `frame:` (frame `click` op with that selector).
- **T2. A scan on the app is seen only as the bot's `/start <id>`.** `scanned(id)` (sim_tours.js:50-52) accepts a page
  scan or, from the app, the frame's text event `/start <id>`; the page emits its scan event only on Telegram
  (sim_ui.js:320-324). A form that adds the scanned tag without calling the bot (`appOpenTagId` today =
  `APP.phone.sim.start(id)`, app_ui.js:563-568) leaves every tag step undone. The page should emit
  `{src: 'page', kind: 'scan', id}` for the app too, or the frame should send `{ev: 'scan', id}`.
- **T3. A form drawn as an `APP.screen` is closed by the pre-step.** `framePre` asks for the back button whenever
  `snap.screen !== 'home'` (sim_ui.js:560-564) and ⏭ sets `APP.screen = 'home'` (:1188; build_simulator.js:156).
  The measurement form avoids this by living on its own `div#measForm.formpage` on `document.body` with
  `APP.screen` left at `'home'` (app_ui.js:991-1050, app.css:170-178). A sale form must do the same, or `framePre`
  must accept form screens.
- **T4. Only keyboards resolve.** `resolveWant`/`computeHot`/`tapWant` find callbacks in `snap.last`
  (sim_ui.js:1078-1129, sim_tours.js:48); the snapshot carries no form state (`measForm: boolean`,
  build_simulator.js:145). A `label` target on a form button is highlighted by text (frameMark, sim_ui.js:640;
  BOOT mark, :123) but its `done` never fires and ⏭ answers "The button is not on the screen yet." (sim_ui.js:1204).
- **T5. The highlight inside a form must be drawn by the form.** `SIM_HOT` is read only by `appRenderMsg` and
  `appStepper` (app_ui.js:694-703, :729-731). The page's `mark` is re-sent on every page render (sim_ui.js:633), but a
  form that repaints itself on a stepper tap or a choice (no page render follows) drops `.simhot` until the next world
  event (review-sim-tests.md F3). `{op: 'hot'}` only calls `appRender` (build_simulator.js:152), which does not repaint
  a form on its own element.
- **T6. Sellers on the app by default vs the enrol tour.** R8 wants sellers to start on 📱; `S.device` starts `'tg'`
  (sim_ui.js:99) and `doLogin` keeps it (:181-191). If a seller login also auto-enrols its frame, the `enrol` tour
  (`need: {unenrolled: true}`, sim_tours.js:288; `tourBlocked`, sim_ui.js:987) is blocked until Reset. Landing on the
  app un-enrolled (the hint and ⚡ shortcut, sim_ui.js:252, :620) keeps both.
- **T7. The switch is pinned in four places.** `boot` sets `'steps'` (sim_ui.js:96) and check_simulator.js:140 greps
  for it; `#flowSteps`/`#flowQuick` (template :318-321) are in check_simulator.js:120-124; `renderFlow` lights
  `#flowSteps` only for `'steps'` (sim_ui.js:216-220), so with `saleFlow` returning `form` neither button lights; the
  `quick` tour's last step waits for `saleFlow === 'steps'` (sim_tours.js:335-336). The dev page has its own checkbox
  (app/dev/index.html:70, :136, :207-214; run_app.js:1142).
- **T8. Texts pinned to the round-5 spec.** run_wizard.js:1633 compares 25 MSG texts with SPEC-round-5.md (including
  `settings_note_sale_flow`); run_gas.js:1498 requires the same 25 keys in the Messages tab; run_wizard.js:1619 requires
  them in MSG. Deleting or rewording a dead round-5 key needs these checks named.
- **T9. One receipt number per SALE row on phones.** app/app_store.js:296-298 and poc/sim_phone.js:123-125 stamp every
  SALE row; run_app.js:967 pins "the receipt number is on the SALE row only" for a one-SALE group; a basket needs its
  own check (map-basket-readers.md 2.11).
- **T10. The simulator's Ledger shows no group.** `ledgerTable` has no GroupID column (sim_ui.js:707-724); a basket
  needs a marker for R7's "the simulator's views".

---

## 7. What a tour of an app-native form needs

The measurement form is the precedent: its own element (`div#measForm.formpage`, app_ui.js:1011), pure helpers for
Node (`appMeas*`, app_ui.js:117-260), a frame command that fills it and presses Save (`op: 'meas'`,
build_simulator.js:162-167), a tour step whose `done` reads the world after the app's sync
(`world.measurements.length > c.mark.meas`, sim_tours.js:270). A sale, new-piece, restock or expense form needs
that plus the following.

**7.1 Stable hooks.** Every control carries `data-f="<name>"`, the form's twin of `data-cb`: e.g. `line:<id>`,
`qty+:<id>`, `qty-:<id>`, `price:<id>`, `remove:<id>`, `buyer` (the search input), `buyer:<customerId>` (a chip),
`buyer:new`, `name`, `phone`, `pay:CASH` / `pay:<key>` / `pay:bank` / `pay:mix`, `acct:<key>`, `transfer`,
`paid:full`, `paid:part`, `amount`, `due:7` / `due:14` / `due:30` / `due:date` / `due:unknown`, `save`; new piece:
`name`, `cat:<x>`, `cost`, `price`, `count+`, `count-`, `pending`, `sample`, `save`; restock: `qty+:<id>`, `save`;
expense: `cat:<key>`, `amount`, `pay:<key>`, `note`, `save`. A check_simulator.js step-5 sibling greps app_ui.js for
`'data-f'` and for `SIM_HOT` in the form renderer; a run_app.js fake-DOM test (like 37 and 39) proves one control and
only that one is hot.

**7.2 Highlight a field or button inside the frame.** Drawn by the form's renderer, not added afterwards (T5): the
renderer adds `hot` when `APP.win.SIM_HOT === 'f:' + name` (a prefix rule like the stepper's, e.g. `f:qty+:` for any
line, is optional); app.css styles `[data-f].hot` next to `.kb button.hot, .sell.hot` (app.css:97); `{op: 'hot'}`
(build_simulator.js:152) also repaints an open form. On the page, a new target kind `{f: 'save'}`: `computeHot` sets
`T.hot = 'f:save'` the way a `cb` target sets its callback (sim_ui.js:1126), and `syncFrameHot` already ships it
(:630). check_simulator.js:160/:193 (`KINDS`) must learn `f`. The alternative without a new kind,
`{ui: 'frame:[data-f="save"]'}` through `frameMark`/`mark`, works only for a form that never repaints itself between
two page renders, and every such step needs an `act` (T1).

**7.3 Know where the user is (done predicates).** The snapshot gains a `form` object, e.g.
`{kind: 'sale', lines: [{id, qty, price}], buyer: {id, name, phone}, pay, acct, transfer, paid: 'full' | 'part',
amount, due, total, error, saved: '<groupId>' | ''}` (null when no form is open). In direct mode the page re-evaluates
`when(...)` predicates on its 1-second tick (sim_ui.js:1537); in post mode the frame's 200 ms watcher posts the changed
snapshot by itself (build_simulator.js:206). Save calls `phone.commit('<kind>')` so the frame's `change` listener sends
`{src: 'app', kind: 'sale'}` (app_ports.js:241-243; build_simulator.js:199, :175-184), and the app's
`scheduleSync()` after the commit (as `appMeasCommit`, app_ui.js:257-259) brings the rows to the world, where
`when(c => c.world.ledger.length > c.mark.ledger)` sees them (`T.mark.ledger`, sim_ui.js:1019). A scan into the form
must be visible to the tour (T2), and the form must keep `APP.screen === 'home'` or `framePre` must accept it (T3).

**7.4 Do it for me (filling fields).** New frame commands next to `meas`: `{op: 'form', kind}` opens a form (the
seller home's big button does the same); `{op: 'set', f, value}` runs the control's own input handler (so the reveal
rules run: part reveals the amount and the promised day, mixed reveals the account and the transfer, "new" reveals
name and phone, and the draft is written), because setting `input.value` without the handler leaves the model unchanged
(the measurement inputs update `F.values` only in their `input` listener, app_ui.js:1072, :1105); the existing
`{op: 'click', sel: '[data-f="save"]'}` (build_simulator.js:170) presses buttons. `doTarget` maps an `f` target to
`set` when the step names a value and to `click` otherwise; tag steps stay rack clicks (`{op: 'open'}`), which the
app must route to the open form's basket. Every step must complete under ⏭ alone, because `runTourUnattended`
(sim_ui.js:1473-1491) and the browser check drive tours that way.

**7.5 Captions.** APP_MSG keys work in `{k:…}` captions already (labels from a direct frame or posted by a post-mode
frame, sim_ui.js:1091-1106; build_simulator.js:134-139). If a choose verb is wanted, 'ရွေးပါ' is in MSG `find_pick`
'🔍 ရွေးပါ:' (core_messages.js:93), which satisfies the rule of check_simulator.js:198. Tour titles and captions are
page copy (a draft for the owner), never MSG.

---

## 8. How SIM.smoke would drive a three-item basket on the app form

Where: a new step after "app: a mixed sale of two" (sim_ui.js:1367-1397) and before "owner: Lists on the laptop", so
the frame is enrolled and its 21:00 credit is checked by the last step. Stock at that point (seed, sim_seed.js:38-46,
minus the earlier steps): S1-0002 SKU 18,000 × 4 (one sold by "the simplest sale"), S1-0005 SKU 22,000 × 2, S1-0001
one piece 25,000 (unsold), S1-0003 × 1, S1-0004 sold. Buyer: ဒေါ်မြင့် (C-0001, no deposit, so no deposit question).

Helpers (form twins of `appHas`/`appTap`, :1311-1318): `formOf = () => (snapOf(S.frames.sister) || {}).form`,
`formWait(pred) = waitFor(() => { var f = formOf(); return !!f && pred(f); }, 10000)`, `fset(f, v) =
frameCmd(S.frames.sister, {op: 'set', f, value: v})`, `fclick(f) = frameCmd(S.frames.sister, {op: 'click', sel:
'[data-f="' + f + '"]'})`. All waits go through the snapshot so both transports behave alike (check_simulator_browser.js:91
requires the same pass count).

Sequence:
1. `n0 = world.ledger.length`; open the sale form (`{op: 'form', kind: 'sale'}` or the home's sell button) →
   `formWait(f => f.kind === 'sale' && !f.lines.length)`.
2. `scan('S1-0002')` (the rack click = the phone's scanner) → one line; `fclick('qty+:S1-0002')` → qty 2.
3. `scan('S1-0005')`, `scan('S1-0001')` → three lines in that order.
4. Refusals: `scan('S1-0001')` again → still three lines, S1-0001 qty 1 (R2: one piece cannot be added twice); `scan('S2-0002')`
   (shop 2) → still three lines (R2; a shop-2 line would quarantine the whole group as `scope`, map-basket-readers.md
   2.15). Each shows a message: NEW APP_MSG, e.g. `ui_sale_one_piece` '❗ ဒီပစ္စည်းက တစ်ထည်တည်းပါ' and
   `ui_sale_other_shop` '❗ ဒီပစ္စည်းက တခြားဆိုင်ကပါ' (proposals; the spec names the keys).
5. `ok(total === 83,000)` (36,000 + 22,000 + 25,000) and the defaults: cash, paid in full, no buyer.
6. `fclick('paid:part')`, `fset('amount', '30000')`, `fclick('save')` with no buyer → nothing written
   (`world.ledger.length === n0`, the form still open, `form.error` holds `sale_need_buyer` 'ℹ️ မကျေသေးရင် ဝယ်သူ
   နာမည် လိုပါသည်').
7. `fset('buyer', 'ဒေါ်မြင့်')`, `fclick('buyer:C-0001')`, `fclick('due:14')`, `fclick('save')` →
   `formWait(f => !!f.saved)` or the sold card (NEW `basket_line` '🛍 {n} ခု · {amount}', map-basket-readers.md 4).
8. `frameCmd(..., {op: 'sync', why: 'smoke'})`, then wait for three phone SALE rows of one group in `world.ledger`.
9. Checks (each one `ok`):
   - three SALE rows, one GroupID, in line order S1-0002, S1-0005, S1-0001; qty -2, -1, -1; amounts 36,000, 22,000,
     25,000; no PAYMENT row (cash only);
   - `customerId` C-0001 on every row; `dueDay` today + 14 on every SALE row (rule 1 of map-basket-readers.md 3.3);
   - cash filled in line order (3.2): 30,000, 0, 0; methods CASH, '', ''; note `credit` on every row;
   - one receipt number for the basket (T9; first row only, or the same number on all three, as the spec decides);
   - one outbox entry before the sync; `server.quarantine.length === 0` and no OVERPAID flag;
   - `openCredits` holds ONE entry for the group: owed 53,000, dueDay today + 14, its item the NEW `basket_name`
     '🛍 {n} ခု · {names}' (map-basket-readers.md 4);
   - stock: S1-0002 2 (4 − 2), S1-0005 1, S1-0001 SOLD;
   - optional: undo from the sold card → three mirrors, nothing owed, stock back (then the 21:00 step below loses this
     credit; leave undo out, or run it on a second basket).
10. The last step ("the clock and the 21:00 post", +15 days) then also finds ဒေါ်မြင့် in the `summary_due_overdue`
    '⏰ ရက်လွန် အကြွေး: {list}' line, next to ဒေါ်စန်း (whose credit now comes from the review card).

The same step with `&transport=post` must make exactly as many checks (check_simulator_browser.js:91), so no check may
depend on `S.frames.sister.direct`.
