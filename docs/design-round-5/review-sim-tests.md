# Review of SPEC-round-5.md — lens: simulator, tests and build

Reviewer's brief: can one HTML page host the Telegram simulation and the real app over one world as section 6
says; is every tour feasible with the real flows; are the editable Lists writes real; is each test of section 8
red without its feature and does the `quick` switch really keep run_scenario green; file ownership; ES5.
Every claim below was checked against the tree of 2026-11-11 (round 4 built, unpublished). Line numbers are
those of the files today.

Method: read the spec and the four maps, then tried to refute each section against the code. Where the code
alone could not answer (the srcdoc frame reaching `parent`, `requestAnimationFrame` under headless virtual
time), a 30-line probe page was run through the Chrome found on this machine
(`C:\Program Files\Google\Chrome\Application\chrome.exe --headless=new --virtual-time-budget --dump-dom`,
the command check_simulator_browser.js will use). The probe and a source scan live in the session scratchpad,
not in the project.

Verdict: the architecture of section 6 holds (one world, one fake server, the Telegram pane over `world.sim`,
the app in `<iframe srcdoc>` frames talking to `parent.SIM.server`); no blocker. Four majors must be fixed in
the spec before step 4 is built, because the smoke run and two tours cannot pass as written; the rest are
precision fixes.

## Findings

### F1 · major · §6.4, §6.6, §8.1 helpers — a tour or test target named by a MSG key with a placeholder never matches

**Problem.** The spec resolves `{label: '<MSG key>'}` at run time with `world.sim.button(world.sim.lastBot(user),
t(world.ports, key))` "the way every test finds buttons" (§6.4), and the smoke run taps `btn_paid_all` by that
route on every sale (§6.6), as does run_wizard's `guided(u, itemId, answers)` "each answer by MSG label or
callback data" (§8.1). `button()` is a plain substring test on the rendered text:

- poc/sim_ports.js:437-443 `if (rows[r][c].text.indexOf(label) >= 0) return rows[r][c].callback_data;`

`t(ports, 'btn_paid_all')` with no vars is the literal `'✅ အကုန် {amount}'` (section 7), which is never a
substring of `'✅ အကုန် 18,000'`. The same holds for `btn_wallet '📲 {method}'`, `btn_bank '🏦 {method}'`
(core_messages.js:131), `btn_days '{n} ရက်'` (:238), `btn_half 'တစ်ဝက် {amount}'` (:254) and the app's
`ui_sell_n '✅ ရောင်း {n} ထည်'` (app_i18n.js:46). run_round4.js uses only placeholder-free keys this way
(`MSG.btn_discount`, `MSG.btn_expense`, `MSG.btn_accounts`, run_round4.js:98,109,1958) and otherwise taps by
exact callback (`tapData`, :75). The smoke's "the four taps of the simplest sale (`btn_sell_one`, `btn_no_name`,
`btn_cash`, `btn_paid_all`)" therefore throws `no button "✅ အကုန် {amount}"` (sim_ports.js:447) at the fourth tap,
and `?autorun=smoke` reports `failed > 0`.

**Fix.** Define the rule once in §6.4 and reuse it in §8.1: a label target is matched on the text up to its first
`{` (`t(ports, key).split('{')[0].trim()`, i.e. `'✅ အကုန်'`), or the tour names the callback (`{cb: 'SC|S1-0002|ok'}`,
`{cb: 'SS|S1-0002|m|KBZ'}`). The smoke of §6.6 should tap `SC|<item>|ok`, `SS|<item>|m|mix`, `SS|<item>|a|KBZ`,
`SS|<item>|p|half`, `SS|<item>|d|14` by data, as run_round4 does, and the label route only for `btn_sell_one`,
`btn_no_name`, `btn_cash`, `btn_new_customer`, `btn_yes`.

### F2 · major · §6.6, §8.1 steps 2 and 14, §1.3 row 3 — the item ids do not match the seed

**Problem.** Three places sell pieces the seed cannot sell:

- `S1-0006` (the 1,000,000 wedding set) is `type: 'UNIQUE'`, `stock: 1` (poc/sim_seed.js:43) and the seed
  sells it: `commitSale(ports, { item: ports.store.getItem('S1-0006'), qty: 1, paid: 500000, … })`
  (sim_seed.js:103-104). Its card is therefore `card_sold_out` with the single button `btn_return`
  (core_bot.js:185, :219-221): there is no `btn_sold` to tap. The smoke's "a deposit sale (`S1-0006`: `btn_sold`,
  `btn_new_customer`, …)" (§6.6) and the tap-count example "deposit 100,000 of 1,000,000 … `✅ ရောင်းပြီး`"
  (§1.3) are impossible; §8.1 step 8's "cash 500,000 of 1,000,000" is the same piece. run_scenario.js:51 pins the
  seed state ("Daw Myint owes 500,000 on the 1,000,000 wedding set").
- `S1-0005` is `type: 'SKU'`, `stock: 2` (sim_seed.js:42), not UNIQUE; run_round4.js:1963-1967 sells it with
  `MSG.btn_sell_one`. §8.1 step 2 ("UNIQUE `S1-0005` goes from `btn_sold` straight to the buyer screen") and
  step 14 ("UNIQUE `S1-0005` reaches the summary …; the owner sells it first") cannot see a `btn_sold`.

**Fix.** The seed's UNIQUE pieces with stock are `S1-0001` (25,000), `S1-0004` (45,000, cost blank) and
`S2-0001` (45,000); use one of them in steps 2 and 14 and in the tour. For the 1,000,000 figures (half = 500,000
against ဒေါ်ခင်'s 300,000 free deposit in step 8 and S+), either void the seeded sale first in the test (the owner's
`V|g` restores stock, run_scenario.js:745-747 shows a void on an old group) or reach 1,000,000 through
`D|S1-0002` + typed `1000000` (Q0b, one piece at a bargained price). The smoke should use `S1-0004` for the deposit
sale and state the amounts it then expects (half of 45,000 = 22,500, so no deposit question: ဒေါ်စန်း is new).

### F3 · major · §6.4 — the highlight is wiped by the next render, and the page renders on every event

**Problem.** The tour "highlights the next thing to click" by setting `.hot` on `[data-cb="…"]` "from outside"
after a step. The Telegram pane is rebuilt from scratch on every draw: `renderPhone()` clears `#chat` and
re-creates every message and button (poc/sim_ui.js:137-146, :216-220), and `scheduleRender()` runs on EVERY
`world.listeners` event (sim_ui.js:53-57). With frames attached those events are constant: the fake server emits
`synclog` on every sync call (poc/sim_sync.js:152), `devices` on enrol (:110,115), `ledger` per pushed row (:138),
and §6.2 asks the page to call `syncNow('sim')` on each open frame after every Telegram update, on top of the
app's own debounce/launch/visibility syncs (app/app_sync.js:521-540). A class added after the render is gone at
the next frame (well under a second during a tour). Inside the frame the same holds: `appRender` empties `#main`
and redraws the card on every `change` and `sync` event (app/app_ui.js:356-372, :286-287).

**Fix.** Make the highlight part of rendering, not a post-step: `renderMsg` (sim_ui.js) adds `hot` to the button
whose `callback_data` equals `S.tour.hot` (and the rack tile / input bar likewise read `S.tour`); for the frame, the
page re-applies the class in its own `APP.phone.on('change')` and `on('sync')` listeners (after `setTimeout(0)`,
since `appOnChange` repaints synchronously), or `appRenderMsg` adds `hot` when `b.callback_data === win.SIM_HOT`
(one line in step 3's file, read-only, no `APP` change). Say which in §6.4 and in the step-3/step-4 file lists.

### F4 · major · §6.1, §6.5 — Reset creates a new world and server but the frames keep the old device

**Problem.** §6.5 has `boot()` build `world`, `server` and `window.SIM = {world, server, …}`; §6.1 says Reset goes
"back to the login screen" and that frames are created per login and kept ("switching keeps every device's data").
Today `#reset` just calls `boot()` again (sim_ui.js:525). After a Reset every existing frame still holds its
`deviceId`/`token` in its memory adapter and resolves `parent.SIM.server` at call time, so its next sync hits a
server that has never seen the device: `syncAuthenticate` answers `auth` "unknown device or bad token"
(core_sync.js:328-331), logs `device_denied` (a `synclog` event per attempt, sim_sync.js:152), the chip turns red
with `ui_err_auth` (app_sync.js:136), and the frame is a zombie that neither Telegram nor the laptop can reach.
Separately, `frame.contentWindow.APP` is `null` until `bootApp` resolves (app_ui.js:16, :267), so "after every
Telegram `update` the page calls `frame.contentWindow.APP.sync.syncNow('sim')`" throws into `SIM_ERRORS` for a
frame still booting (an un-enrolled frame is harmless: `runSync` answers `not_enrolled`, app_sync.js:250).

**Fix.** In §6.1/§6.5: Reset removes every `<iframe>` and empties `S.frames` before `boot()`; the page talks to a
frame only after `SIM.frameReady(win, app)` registered it (`S.frames[login] = {win, app}`), and guards
`app.store.meta.deviceId` before `syncNow`. The manual check of §8.8 ("Reset returns to the login screen") should
add "and the device bar shows no enrolled frame; the owner's `📱 ဖုန်းများ` lists none".

### F5 · minor · §6.4, §5 — on a SKU card in the app the first step has no `[data-cb]` target

**Problem.** `appKeyboardForCard` removes the `S|<id>|*` and `Q|<id>` buttons from a SKU card (app_ui.js:55-66) and
the stepper's sell button is `appH('button', { class: 'good sell', … })` with no `data-cb` (app_ui.js:709); the
`data-cb` of §5 is set only in `appRenderMsg`'s keyboard loop (:682). A tour step `{cb: 'S|S1-0002|1'}` or
`{label: 'btn_sell_one'}` finds nothing in the frame for the first tap of every SKU sale, and `.kb button.hot`
(app.css:97) does not style a button outside `.kb` anyway.

**Fix.** §5 (step 3): `appStepper` sets `data-cb` = `appStepperData(info.itemId, APP.qty.n)` on the sell button and
app.css gains `.sell.hot` next to `.kb button.hot`; §6.4: a `cb` target matches on the `S|<id>|` prefix for a
stepper (the count is whatever the stepper shows).

### F6 · minor · §6.4 — one `login`/`device` per tour, but three tours cross roles or devices

**Problem.** A tour is `{id, login, device, title, steps}`. "Sell with a deposit and a date (then the Credits tab,
`⏩ +1 ရက်` × 15, `🕘 21:00`)" needs the seller's Telegram and then the owner's laptop (§6.1: only the owner has
💻); "enrol a phone (`btn_app` → the code → the frame)" needs Telegram then the app frame; "a stranger scans a tag
(`SIM_USERS.customer` → `staff_only`)" needs `world.chats[9999]`, which no login's pane shows (the pane is bound to
`world.chats[SIM_USERS[login].id]`, §6.1).

**Fix.** Allow a per-step `login` and `device` override (the panel switches the pane and says so in the caption),
and let the stranger step render the customer's chat (`S.user = SIM_USERS.customer` for that step, back
afterwards), or split those tours in two and say so.

### F7 · minor · §6.1 — the clock control freezes time; say so, or use an offset

**Problem.** `world.nowOverride` makes `now()` return a copy of one fixed Date (poc/sim_ports.js:22); the fake
server reads the same clock (sim_sync.js:21). After the first `⏩`, every later Telegram row, `receivedAt`,
chat time and `edited` stamp share one instant for the rest of the session, cache TTLs never expire (the 120 s
`tap:` guard, `STATE_TTL_SEC`), and the frames keep real time plus the learned offset, so their skew against the
server grows and `skew_warn_sec` pings can land in the owner's chat. This is exactly what the suites want from
`tick()` (run_round4.js:74), not what a demo wants.

**Fix.** Either state in §6.1 that the demo clock is frozen after the first `⏩` (and that `Reset` clears it), or
give `createSimWorld` a `world.clockOffsetMs` honoured in `now()` (one line in sim_ports.js, step 1) and have the
header buttons add to it; the suites keep `nowOverride`.

### F8 · minor · §6.5 — check_simulator.js must also refuse `<!--` (and pin the frame-file rules)

**Problem.** The srcdoc is embedded as a JS string inside a `<script>` block. In HTML's script tokenizer a `<!--`
followed by `<script` enters the "double escaped" state, in which `</script>` no longer closes the block until a
`-->` is seen; the srcdoc string certainly contains `<script`, so ONE HTML comment anywhere in that string (for
example copying app/index.html:19 into the frame shell) swallows the outer `</script>` and the rest of the page
silently stops running. Today's inputs are clean (scan of the 9 core, 7 app, app.css and 5 sim files: no `<!--`,
no `</script`, no U+2028/U+2029), which is why the spec's `<\/script` rewrite is enough — but nothing pins it. The
`</script` refusal is also needed for FRAME_FILES (the escaped `<\/script` decodes back to `</script` inside the
frame; tools/build_app.js refuses it today, check_simulator should too).

**Fix.** §6.5 check_simulator.js: the srcdoc string holds no `<!--`, no `</script`, no U+2028/U+2029; every
FRAME_FILES source is refused on `</script` like the outer files.

### F9 · minor · §6.2 — `parent.SIM` is verified on `file://`, not yet under the artifact host

**Problem.** The design rests on the srcdoc frame calling `parent.SIM.server.handle` synchronously. Verified here:
a probe page opened from disk in headless Chrome reports `parentAccess: true`, the Promise transport resolves
through `parent`, `parent.SIM.frameReady` runs, `requestAnimationFrame` fires under `--virtual-time-budget`, and
`<input type="date">` is honoured. Under the artifact host the page runs inside the host's iframe; if that iframe
lacked `allow-same-origin`, an `about:srcdoc` child would get a NEW opaque origin and `parent.SIM` would throw.
The host's own note that artifacts keep `localStorage` per artifact origin implies a real origin, so this is
very likely fine, but the spec does not say when it is checked and the artifact is the deliverable.

**Fix.** §9 step 4: the first act is to publish a 20-line probe artifact (srcdoc frame writing `!!parent.SIM`
into the page) and read it back; only then build the tours. If it fails, the transport becomes a `postMessage`
round trip (the frame posts `{api, body, id}`, the page answers), which needs no other change.

### F10 · minor · §7 (the `SIM_TOUR_MSG` words) — wrong source line for 'ရိုက်ပါ'

**Problem.** §6.4 says the connecting verbs come from MSG and cites 'ရိုက်ပါ' from `ask_number` :79. That key reads
`'✏️ ဂဏန်း ရိုက်ပေးပါ (ဥပမာ 25000)'` (core_messages.js:79) — 'ရိုက်ပေးပါ', not 'ရိုက်ပါ'. The word does exist:
`cust_find` :150 ('… ဖုန်းနံပါတ် ရိုက်ပါ'), `ord_ask_due_text` :251 ('✏️ ရက်စွဲ ရိုက်ပါ …'), `add_ask_pm` :388.
('scan လုပ်ပါ' from `menu` :89 and 'နှိပ်ပါ' from `help` :90 are correct.)

**Fix.** Cite `cust_find` :150 (or :251); the "never your own translations" rule is otherwise met.

### F11 · minor · §8.1 step 13 — "`card.edited` count unchanged" cannot be measured

**Problem.** `sim_ports.editMessage` sets a boolean (`list[i].edited = true`, poc/sim_ports.js:315) and emits
`{type: 'chat', chatId, message, edited: true}` (:316). After the first edit the flag is `true` for good; the
check "a second `S|id|1` … neither writes nor edits (`card.edited` count unchanged)" has nothing to count.

**Fix.** Count `chat` events with `edited === true` for that message id through a `world.listeners` entry (the
pattern of the 64-byte listener, run_round4.js:50-57), or snapshot `JSON.stringify([m.text, m.keyboard])` before
and after.

### F12 · minor · §8.1 step 1 — the state literal omits `msgId`

**Problem.** Step 1 pins the state as `{kind:'sale', step:'buyer', item:'S1-0002', draft:{qty:1}, hist:[]}`, but
§3.4 defines the sale state with `msgId` ("the message the current question is on") and `startGuidedSale` stores
it. A `same()` on that literal is red by design.

**Fix.** Compare the named fields (`kind, step, item, draft, hist`) and `msgId === card.id`.

### F13 · minor · §2.4, §3.3 — `addListOptionByLabel(…, extra)` must add `kind` to the rec only when given

**Problem.** The rec `addListOptionByLabel` hands to `store.addListOption` is `{list, key, label, shop: '', note}`
(core_ledger.js:728); on a phone that rec is the outbox entry, and run_sync.js:820 pins its keys exactly:
`same3(Object.keys(entry.rec).sort(), ['key', 'label', 'list', 'note', 'shop'])`. A builder who writes
`kind: extra && extra.kind` adds a `kind: undefined` key and turns that check red. §8.7 states the intent ("kind is
added to a rec only when the ➕ inside the sale passes it"); §2.4/§3.3 should say it as code. (`syncApplyListEntry`
already copies conditionally — `if (!syncAbsent(rec[f]))`, core_sync.js:520 — so adding `'kind'` to that array is
enough on the server side.)

**Fix.** §3.3: `if (extra && CFG.LIST_KINDS.indexOf(extra.kind) >= 0) rec.kind = extra.kind;` — nothing else.

## Confirmed OK (tried to refute, could not)

- **One page, one world, two routes.** `createFakeServer(world)` wraps `world.ports.store` and the same arrays
  (sim_sync.js:13-59), sets `world.ports.sync` so the Telegram menu shows `btn_app`/`btn_devices`
  (sim_sync.js:233-242; core_bot.js:140-145), `server.handle` JSON-round-trips the body (sim_sync.js:206-215) and
  `mintEnrollCode`/`summaryLines`/`deviceAction` exist (:218-230). The frame boot of §6.2 is the dev page's call
  (app/dev/index.html:133-150) with `parent.` in front; `createAppSync` already takes `opts.online`
  (app_sync.js:78), `appDoEnroll` is the one place that trusts `navigator.onLine` (app_ui.js:444), `bootApp`'s
  `online` is the line §5 rewrites (:265), `appRequestPersist` guards `navigator.storage` (:1240-1246),
  `appSetupServiceWorker` is skipped by `noServiceWorker`. `syncNow` on an un-enrolled frame answers
  `not_enrolled` (app_sync.js:250, :333). Probe: `parent.SIM` reachable from an `about:srcdoc` child over `file://`,
  Promise transport resolves, rAF fires under `--virtual-time-budget`, `type=date` honoured.
- **Memory adapter per frame.** `createMemoryAdapter()` is self-contained (app_store.js:75-121); one `APP` per
  document (app_ui.js:16), so one frame per device is the right unit. The `#app` shell is index.html:22-38 with
  `#overlay #toast #photoInput` inside (36-38). `#measForm.formpage` is appended to the frame's `document.body`
  (app_ui.js:1002), so it stays inside the frame as §6.2 says.
- **No global clash.** The page loads core + sim files only, the frame core + app files only; run_app.js already
  loads core (with core_sync and core_orders) + sim_mock_ai/sim_ports/sim_seed/sim_sync + the seven app files in
  one scope (run_app.js:17-24) and the dev page does the same with classic script tags (dev/index.html:109-129).
  `sim_ui.js` is an IIFE (sim_ui.js:5). `SIM`, `SIM_TOURS`, `SIM_TOUR_MSG`, `SIM_APP_SRCDOC`, `SIM_ERRORS` are
  unused today (grep over poc/, app/, apps-script/, the dev page and the template: only `SIM_USERS`, `SIM_PHOTOS`,
  `SIM_SEED_*`, `SIM_FILES`, `SIM_SHA_K`). `app_i18n.js` guards `typeof MSG` at load (app_i18n.js:149-153), so
  check_simulator's vm load set works. `app_scan.js` tests `typeof jsQR` at run time (:25, :92, :131), so leaving
  jsQR out is safe.
- **Build and size.** Today's build_simulator.js has the single `<!-- @scripts -->` marker and the `</script`
  refusal (build_simulator.js:19-27; template :281). Measured: the frame bundle (9 core + 7 app + app.css) is
  703,605 bytes raw and 716,577 bytes as a JSON string; the page files (9 core + 5 sim + template) ≈ 620 KB; the
  output lands at ≈ 1.34 MB, matching §6.5's "≈ 1.35 MB" and far under the 4 MB check and the 16 MB artifact
  limit. `FRAME_FILES` order = build_app.js's `CORE_FIRST` + `core_orders` + `APP_FIRST` (build_app.js:29-30,
  55-58). Chrome exists on this machine at the first path check_simulator_browser.js will try.
- **Editable Lists writes are real.** `sim_ports.listOptions` reads the raw `world.lists` rows and normalises
  Active/Order/strings (sim_ports.js:245-255), so a `setListRow` that assigns `label | active | detail | kind` on
  the raw row is read by the bot at the next screen through `listRows` → `store.listOptions` (core_ledger.js:447)
  and by `listsJsonFor` → `syncSettingsFor` for the frames (core_sync.js:915-921); `addListOption` applies `set`
  ops generically (`r[op.field] = op.value`, :269). Adding a row through `addListOptionByLabel(world.ports, …)`
  goes through `listUpsert` and `store.addListOption` (core_ledger.js:715-734) like the bot's ➕. Returning `kind`
  only when non-empty keeps run_lists.js:869's exact eight-field compare green.
- **The `quick` switch keeps the old suites green.** run_scenario.js:13-19 loads no core_sync and seeds with
  `seedSimWorld` only (:20); its one-tap pins (:60-66, :431-443, :750-755, :757-771) and run_round4's
  (:144-148, :1963-1967) all tap `S|id|n`/`Q|id`/`QN`/`D`, which §1.6 leaves byte-identical in `quick`;
  `askQty` without opts keeps `Z` (:431 pins it). Settings-shape pins survive the extra key: run_sync.js:649
  compares `plainKeys(sent).length === Object.keys(world.settings).length - 2` (both sides gain `sale_flow`);
  run_gas has no pin on the Settings row count, `getMaxColumns`, `Overdue`, `CREDIT_COLS` or Credits width (grep).
  run_round4.js:855 pins only `MUTATING_ACTIONS.SXA` and the absence of LA/LD/SX/SXM, so `SC: 1` is free.
  `addDaysKey`/`parseDayText`/`daysBetweenKeys` are used by run_scenario.js:866-1144 with core_burmese loaded
  before core_orders (:13-16), so the move of §3.2 is invisible there. `MAX_BANK_BUTTONS` is 12
  (core_config.js:109), so §8.1 step 5's four wallets and the `more` screen are reachable.
- **The five named edits of §8.6 are exactly where the spec says.** run_lists.js:703 `Object.keys(b.row).length
  === 26`; run_gas.js:421-427 `defaultLists` eight-cell rows compared at :441; :456 `c.cols === 8`; :463-464
  `L.validations('list') === 2 * 999`; :520 `L.validations('list') === 1998` (and `L.note(1, 8) ===
  MSG.lists_note_note` stays true because Kind is the 9th column). run_gas.js:466-467 iterates `CFG.LIST_COLS`
  and needs `lists_note_kind`, as §8.6 says.
- **Section 8 tests are red without their feature** where I could judge it: 8.1 steps 1, 3, 6, 7, 10, 15, 17, 21,
  22 each name a value that today's code cannot produce (no `SS|`, no second row at ✅, no `dueDay`, no `kind`);
  8.2's steps-mode `sell()` returning no row is red today (`S|id|1` commits, core_bot.js:444-451); 8.3's
  `syncValidateTx('30.12.26')` → `malformed` is red today (`dueDay` is not in the `strings` list,
  core_sync.js:381-385, and no format rule exists); 8.4's 27-column Ledger is red today (26 columns, and the fake
  refuses a 27-wide write); 8.5's source checks are red today (`navigator.onLine` is in `appDoEnroll`, no
  `data-cb`). check_simulator.js's "contains every FILES banner and `var SIM_APP_SRCDOC`" is red against today's
  build.
- **Ownership has no overlap.** Step 1 owns sim_ports.js (`setListRow`, `listOptions` kind) and sim_seed.js
  (`sale_flow: 'quick'`); step 4 owns sim_ui.js, the template, build_simulator.js and the three new poc files;
  steps 2 and 3 are disjoint (gas_*/core_sync/run_gas/run_sync/sim_sync/sim_phone vs app_*/dev page/run_app);
  step 4 needs step 3's `data-cb` and step 2's sync, as §9 orders them. The only cross-step dependency this review
  adds is F5 (a `data-cb` on the stepper and `.sell.hot` in app.css: step 3's files, named in §5).
- **ES5.** The new page-side files (`sim_tours.js`, the v2 `sim_ui.js`) have no need for anything beyond `var` and
  `function`; the frame's boot snippet uses `new Promise`, which the real app already requires (app_sync.js:89).
  The two zero-width characters in poc/sim_ui.js:480 are the U+200D joiners of the 👨‍👩‍👧 emoji, not a stray
  invisible character; a future source scan must allow U+200D inside emoji sequences.

## Summary for the orchestrator

Fix F1-F4 in the spec before step 4 (they decide whether the smoke run and two tours can pass); F5-F13 are
one-line precision fixes to §5, §6, §7 and §8. The build approach of §6.5 (one file, srcdoc frames, `parent.SIM`)
is sound and measured at ≈ 1.34 MB; the `quick` default in `seedSimWorld` really does keep every existing suite
green; the five named edits of §8.6 are complete.
