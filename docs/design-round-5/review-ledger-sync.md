# Review of SPEC-round-5.md — lens: LEDGER, SYNC AND GLUE (2026-11-12)

Reviewer brief: can every ledger shape of the spec be written and undone with the real functions; does `DueDay`
travel through `syncValidateBatch`, `gasStore`, the app store and old phones without quarantine; does the Lists
`Kind` column pass `listNormRow`, `lists_json`, the list sync entry and `ensureListsTab`; does `sale_flow` reach
phones; are the Credits view and the summary formulas right; the script lock; `setupSheet` idempotence.

Method: every claim of sections 2, 3.3, 4, 8.3-8.7 read against the files as they are on 2026-11-12 (round 4
built, unpublished), plus one scratch probe on `poc/fake_gas.js` for the Ledger grid story (notes at the end).
Line numbers are the current tree's. Two findings (L2, L1's neighbour M1) overlap other reviews; they are kept
because this lens rates them from the ledger/test side.

## Findings

### L1 · major · §2.2 — outcome row 7 ("mixed where the bank part is 0") contradicts the method rule

**Problem.** The rules say `KEY = String(p.method || 'CASH').toUpperCase()` (the account chosen on Q3, e.g. `KBZ`),
`bankPart = … clamp(…, 0, paid)`, `twoRows = bankPart > 0 && cashPart > 0`, and the SALE row's
`method: twoRows ? CASH : methodFor(KEY, paid)`. With `p.mixed === true` and `bankPart === 0` that is ONE row with
`methodFor('KBZ', paid)` = `'KBZ'`: the whole payment is booked on the account although nothing reached it. The
table two paragraphs later says the same case writes `CASH ('' when 0)`, and 8.1 step 7 checks "mixed with bank
part 0 (one row, CASH)". Rule and table cannot both hold; a builder following the rule turns the step-7 check red
or, worse, special-cases the test.

**Evidence.** `methodFor(method, cash)` returns the given key upper-cased whenever cash moved
(apps-script/core_ledger.js:103-106); SPEC-round-5.md 2.2 bullets 1 and 4 (`KEY`, `method: twoRows ? CASH :
methodFor(KEY, paid)`) vs table row "mixed where the bank part is 0 | SALE | paid | CASH ('' when 0)"; 8.1 step 7.
review-bot-app.md M1 shows how the flow can reach this shape (➕ from the `mix` screen never asks the transfer part).

**Fix.** One line in the rules before the row is built: `var payKey = (p.mixed && bankPart === 0) ? CFG.METHOD.CASH : KEY;`
and `method: twoRows ? CFG.METHOD.CASH : methodFor(payKey, paid)`. Equivalently, state at the top: "`mixed` with a
bank part of 0 is a cash payment (`mixed = false`, `KEY = CASH`) before anything else is derived." The "cash part
is 0" row (one row, `KEY`) stays as written: it is correct.

### L2 · major · §2.4 / §3.3 / §8.7 — the list rec must not carry `kind: undefined`; two suites pin the rec keys

**Problem.** 2.4 and 3.3 say "`extra.kind` goes into the `addListOption` rec" without saying the key must be ABSENT
when no kind was given. The natural `kind: extra && extra.kind` adds a `kind: undefined` key. On a phone that rec
is the outbox entry as given, and two existing checks pin its keys to exactly `['key','label','list','note','shop']`:
run_sync.js:820 (named in 8.7) and run_app.js:646 (not named anywhere in the spec).

**Evidence.** core_ledger.js:726 builds the rec literal; app_store.js:360 queues `appCloneRecord(rec)` and
`appCloneRecord` copies every own key, `undefined` values included (app_store.js:57-66); poc/sim_phone.js:171 queues
`copy(rec)` with the same `for k in o` copy (:56); poc/run_app.js:646 `same(Object.keys(listEntries[0].rec).sort(),
['key','label','list','note','shop'])`; poc/run_sync.js:820 the same with `same3`.

**Fix.** 3.3: build the rec as today and add exactly `if (extra && CFG.LIST_KINDS.indexOf(extra.kind) >= 0) rec.kind = extra.kind;`
(no `kind` key otherwise, never `''`). 8.7: name run_app.js:646 beside run_sync.js:820 as checks that stay green by
this rule. (review-sim-tests.md F13 asks the same for :820.)

### L3 · minor · §2.1 / §4.3 / §8.3 — the `dueDay` validation is stated two ways; one of them lets a number through

**Problem.** 2.1: "`syncValidateTx` accepts `dueDay` absent, `''`, or a string matching `^\d{4}-\d{2}-\d{2}$`;
anything else is MALFORMED." 4.3: "`'dueDay'` joins the `strings` list and, when it is a non-blank string, it must
match …". The `strings` loop accepts `syncNum(v)` too, so a `dueDay: 20261230` passes 4.3's wording, while 8.3
expects "a number malformed". A builder who follows 4.3 literally writes a check that 8.3 turns red.

**Evidence.** core_sync.js:381-385: `if (!(v === undefined || v === null || syncStr(v) || syncNum(v))) return MALFORMED`.

**Fix.** Replace the 4.3 sentence with the one line to add after :385:
`if (!syncBlank(tx.dueDay) && !(syncStr(tx.dueDay) && /^\d{4}-\d{2}-\d{2}$/.test(tx.dueDay))) return SYNC.REASON.MALFORMED;`
(`syncBlank` :143 covers `''`, `null`, `undefined`); do not add `'dueDay'` to `strings`.

### L4 · minor · §4.3 — `syncListRecReason` should treat `kind: ''` like absent, as the `shop` rule does

**Problem.** "`kind` absent, or a string in `CFG.LIST_KINDS`, else MALFORMED" quarantines a rec with `kind: ''`.
A quarantined list entry leaves the phone's outbox and clears `cursor.settingsHash`, so the option the seller
added disappears from her buttons at the next pull — a hard loss for a blank. Today's `shop` rule already allows
`''` for exactly this reason.

**Evidence.** core_sync.js:478 `if (!syncAbsent(rec.shop) && rec.shop !== '' && CFG.SHOP_IDS.indexOf(rec.shop) < 0) return bad;`;
the phone side of a quarantined list entry: core_sync.js:1403-1410 (`removeEntry`, `cur.settingsHash = ''`).

**Fix.** `if (!syncAbsent(rec.kind) && rec.kind !== '' && !(syncStr(rec.kind) && CFG.LIST_KINDS.indexOf(rec.kind) >= 0)) return bad;`
and in `syncApplyListEntry` copy `kind` only when `CFG.LIST_KINDS.indexOf(rec.kind) >= 0` (a blank is "no kind").
8.3 gains: `kind: ''` is applied as a wallet, not quarantined.

### L5 · minor · §4.1 step 3 — on an existing book the Credits header stays 13 wide until the first refresh

**Problem.** `ensureTab(ss, 'Credits', CFG.CREDIT_COLS)` writes a header only on an EMPTY tab; every real book has a
13-column Credits header. Until `rebuildViews` (migration step 3) or the first credit-related write runs
`refreshViews`, the tab has no `DueDay`/`Overdue` header while the Dashboard already reads `Credits!$O:$O` and the
owner reads a tab whose header does not match its new formula. The spec relies on the README order; a forgotten
`rebuildViews` leaves the Overdue cell at 0 until the next credit write.

**Evidence.** gas_setup.js:247-254 (`ensureTab` writes the header when `getLastRow() === 0` only), :29 (no
`ensureColumns` for Credits), gas_store.js:684-687 (the header is rewritten only inside `refreshViews`).

**Fix.** 4.1 step 3: `var credits = ensureTab(ss, 'Credits', CFG.CREDIT_COLS); ensureColumns(credits, CFG.CREDIT_COLS);`
(15 columns fit the 26-column grid, no growth needed). 8.4's round-4-book check then asserts the Credits header is
15 wide right after `setupSheet`, before any refresh.

### L6 · minor · §2.3 / D4 — the Credits tab's `Overdue` is a snapshot; a credit that passes its DueDay overnight stays FALSE on the laptop

**Problem.** D4 says "the Credits view and the 21:00 summary use it". The summary computes `openCredits` live at
21:00, but the Credits tab (and the Dashboard SUMIF over it) is rewritten only by `afterWrite` after a credit-related
write or once per accepted push batch. A dated credit whose DueDay passes with no write shows `Overdue FALSE` and
`Days` unchanged until somebody writes a credit, a payment or a deposit. Same class as today's `Days` column, but
the spec now puts a boolean the owner will trust next to it, and the simulator's Credits tab (computed live,
section 6) will not show the same staleness, so the demo and the real Sheet disagree.

**Evidence.** core_ledger.js:82-92 (`afterWrite` conditions), core_sync.js:847-850 (one refresh per batch),
gas_main.js:240-249 (`sendDailySummary` builds the text and sends; no view refresh), gas_setup.js:405-406 (the
Dashboard reads the tab, not the ledger).

**Fix.** Either (a) `sendDailySummary` (gas_main.js:240-249) calls
`gasStore.refreshViews(openCredits(ports, null), depositsHeldList(ports), customerSummaries(ports))` before building
the text — one extra write per day, the `rebuildViews` body, so the laptop is fresh every evening (4.2 then names
gas_main.js as changed and 8.4 adds "the summary trigger rewrites Credits"), or (b) README section H states that
`Overdue`/`Days` are as of the last credit write and `rebuildViews` refreshes them. (a) is three lines.

### L7 · minor · §4.1 step 1 — grow the grid inside `ensureTab`/`ensureColumns`, not only at the Ledger call site

**Problem.** The spec fixes the 26→27 boundary with a special sequence at one call site
(`getSheetByName || insertSheet; gasEnsureWidth; ensureTab; ensureColumns`). The hazard is general: any header
appended past column 26 of any tab (Ledger again in round 6, Customers, Lists at 27 one day) fails the same way, and
a family who deleted spare columns can make a 20-wide tab fail earlier. `setupTailoringTabs` already hand-rolls the
same growth (gas_setup.js:118-125).

**Evidence.** gas_setup.js:247-254 (`ensureTab` writes `header.length` wide with no growth), :257-265
(`ensureColumns` writes at `start` with no growth), gas_store.js:113-117 (`gasEnsureWidth`); the probe below
confirms the fake throws "outside the dimensions" / "appendRow … not modelled" without growth and passes with it.

**Fix.** In `ensureTab`: `if (header.length) gasEnsureWidth(sh, header.length);` before the header write. In
`ensureColumns`: `gasEnsureWidth(sh, start + missing.length - 1);` before `setValues`. Then 4.1 step 1 is just
`ensureTab` + `ensureColumns` + `textColumn` as for every other tab, `setupTailoringTabs` may keep its own line,
and `gasLedgerWidth` stays for the publish window (4.2). Both calls are modelled by the fake
(`getMaxColumns`, `insertColumnsAfter`, poc/fake_gas.js:379-384) and `insertColumnsAfter(max, n)` is always "after
the last column", which is the only form the fake accepts.

### L8 · minor · §2.6 / §3.4 `saleCommit` — on the Sheet the buyer row is written outside the group's lock and before it

**Problem.** "The buyer is created at ✅ … on the same device and before the ledger rows". On the Telegram route
`gasStore.addCustomer` takes and releases its own lock, then `commitSaleGroup` takes the lock again; a Sheets
failure between the two (timeout, quota) leaves a Customers row with no sale and no undo. Today's CR path has the
same window (`pickCustomer` → `addCustomer` → `convertSaleToCredit`), so this is not new, but D3's "one write at ✅"
reads as if the whole ✅ were one atomic step, and the README/owner may rely on that.

**Evidence.** gas_store.js:428-441 (`addCustomer` under `gasLocked`, 15 s), core_ledger.js:66-74 (`writeGroup`
locks only the rows), core_bot.js:1465 (today's `addCustomer` before the credit rewrite).

**Fix.** Say so in 2.6 ("two writes on the Sheet: the customer, then the group; a stray customer row without a sale
is harmless and the laptop may delete it") or, if the orchestrator wants it tight, have `saleCommit` run
`saleResolveBuyer` + `commitSaleGroup` inside one `ports.lock.run` on GAS (gasLocked is re-entrant,
gas_main.js:66-73; on the phone `lock.run` would then put the customer entry and the group under one collector
call, which `appendLedger` ignores for non-ledger writes, app_store.js:308-309, so nothing changes there).

### L9 · minor · §2.3 — while adding `@` to the Credits `DueDay` column, give `Day` (column B) the same format

**Problem.** `refreshViews` writes `c.day` (`yyyy-mm-dd` text) into a column that is not `@`, so Sheets coerces it
into a Date today; the spec adds `@` for `DueDay` (N) only. Two date-looking columns on one tab, one text and one
Date, is what the owner will see.

**Evidence.** gas_store.js:684-687 (no format on the Day column), spec 2.3 (format for `DueDay` only).

**Fix.** Format both columns in `refreshViews` (`Day` and `DueDay`, by `CFG.CREDIT_COLS.indexOf(...) + 1`), one
call each, before `setValues`. 8.4: "the Day and DueDay columns are `@`".

### L10 · minor · §8.4 — "a second run changes nothing" needs a definition

**Problem.** `writeDashboard` always clears and rewrites the Dashboard, `textColumn` and the niceties re-apply
formats and validations, `protectTab` is guarded. A snapshot comparison of every sheet would be red on call logs
and could be red on the Dashboard's rebuilt cells, while the intended property (no header moved, no row added, no
Settings/Messages row duplicated, same formats and validations) is true.

**Evidence.** gas_setup.js:448-449 (`sh.clear()` + `setValues`), :303-307 (`protectTab` returns when a
protection exists), :67-68 and :71-73 (defaults and Messages appended only when missing), poc/fake_gas.js:752
(the fake's sheet snapshot).

**Fix.** 8.4: compare, after the second run, the `values()`, `format`, `validations` and `note` views of Ledger,
Lists, Settings, Messages and Credits with the first run's, and `lastRow()` of Settings and Messages; leave the
Dashboard to "same values".

### L11 · minor · §4.5 — between publish-server and setupSheet the bot is in `steps` and the owner cannot switch

**Problem.** `saleFlow` defaults to `steps` when the Settings row is missing; the row is written by `setupSheet`
(step 3). Between step 2 and step 3 the Telegram sellers see the guided flow with MSG fallbacks (fine: the Messages
keys fall back to `MSG`, core_messages.js `t()`), but 4.5 step 5 "the owner may type quick at any time" is not
true in that window: there is no row to type into unless the owner adds one by hand.

**Evidence.** gas_store.js:664-668 (`getSetting` returns the default when no row or a blank Value), gas_setup.js:44-68
(defaults appended by `setupSheet` only), spec 3.1 (`saleFlow` default `STEPS`).

**Fix.** 4.5: "run `setupSheet` right after the server publish (steps 2 and 3 back to back); to start the shops on
`quick`, type the row `sale_flow | quick` into Settings before step 2 — `getSetting` reads it as soon as it exists."

## Confirmed OK (checked against the code)

- **One write at ✅.** `writeGroup` takes `ports.lock.run` once around `appendLedger` per tx and then `afterWrite`
  (core_ledger.js:66-74, 82-92). On the phone `lock.run` opens a collector so the rows of one `writeGroup` form ONE
  outbox `group` entry (app_ports.js:166-172, app_store.js:308-309); the reference phone the same (poc/sim_phone.js:389-398).
  `writeGroup` forces every tx onto `txs[0].groupId` (:67-68), and `newTx` makes groupId = txId (:61): `GroupID` = the
  SALE's txId as 2.2 says.
- **Receipt numbers.** The app stamps a receipt number only on `type === SALE && !reversesTxId` (app_store.js:296-299;
  sim_phone.js:123): the PAYMENT row of a mixed group never carries one; Telegram rows derive theirs
  (core_ledger.js:1621-1643).
- **The mixed shape is `splitSale`'s minus the mirror pair** and every reader already handles it: `saleGroupInfo` sums
  PAYMENT rows by `refGroupId` (:1077, 1082), `groupMethods` (:1100-1112), `openCredits`' pre-filter nets
  `paid[refGroupId]` (:1130, :1153), `dayStats`/`addMethodCash` book CASH 8,000 on the SALE and KBZ 10,000 on the
  PAYMENT (:1401-1412, :1449-1452), `rewriteCheck` answers `complex` for two live rows (:947), `undoGroup` mirrors
  every live row of the group, PAYMENT and DEPOSIT_APPLIED included (:905-930), `receiptMethodText` prints
  ' (ငွေသား 8,000 · KBZPay 10,000)' (core_report.js:351-356).
- **Server-side OVERPAID.** The SALE is pushed onto the shadow before the PAYMENT is checked (core_sync.js:802-805,
  :814), so "SALE first in `txs`" (2.2) is the right rule; a PAYMENT with `refGroupId` is in scope (:363).
- **`dueDay` travels.** `newTx` is the one explicit field list (:31-63); the app store copies rows whole
  (`copy(tx)` :300, `rowToDisk` :237, `stripLocal` :240, `appendSynced` :443-451); the sim store copies every key
  (sim_ports.js:76-82) and the fake server's `appendRows` too (sim_sync.js:137-139); the real server copies the tx
  whole (`syncCopy`, core_sync.js:144, :786) and writes it positionally by `CFG.LEDGER_COLS` (gas_sync.js:160-170,
  :180; gas_store.js:377-385); `ledgerRows` is an explicit map, so the spec's `dueDay: gasDay(o.DueDay)` line is the
  one place a Sheet value is read (gas_store.js:391-402); `textColumn` is positional by CFG index (gas_setup.js:268-270);
  `stampSeq` writes three adjacent cells from `Seq` (gas_sync.js:193-197), untouched by a 27th column.
- **No quarantine on old devices.** `syncValidateTx` has no unknown-field rule (core_sync.js:381-385): an old server
  accepts a tx with `dueDay`; `gasSyncLedgerValues` maps named columns only, so the old server drops it (gas_sync.js:160-170);
  a new server stores `''` for an old phone (`tx.dueDay || ''`); checksums hash n/amount/cash only (:876-887), so a
  dropped value never opens a repair loop; a repair replaces the day's rows as given (:1440-1442).
- **The Ledger grid story** (probe, below): the fake refuses 27 values on a 26-column tab, `gasEnsureWidth(sh, 27)`
  then `appendRow` works, `getDataRange` returns a 27-wide header with `''` at 27 so `gasTable` reads the value under
  key `''` harmlessly, `ensureColumns` writes `DueDay` at column 27 (`start` = 26 non-empty headers + 1), `textColumn`
  formats column 27 `@`; a fresh tab with `ensureTab` of 27 headers throws without growth and works with it.
  `GAS_LEDGER_WIDTH_OK` is reset per execution because the fake runs each request in a new vm context (fake_gas.js:288-291)
  and Apps Script starts a fresh global scope per execution.
- **Credits letters and the Dashboard formula.** `colLetter(CFG.CREDIT_COLS + ['DueDay','Overdue'])`: `Owed` → L,
  `DueDay` → N, `Overdue` → O (probe); `'=SUMIF(' + CR('Overdue') + ',TRUE,' + CR('Owed') + ')'` renders exactly
  `=SUMIF(Credits!$O:$O,TRUE,Credits!$L:$L)`; `owed(shop)` keeps `C`/`L` (gas_setup.js:377) because the new columns
  are appended. `refreshViews` clears contents (formats kept, fake_gas.js:433) and writes `[CFG.CREDIT_COLS].concat(...)`
  15 wide inside the 26-column grid (gas_store.js:681-687). No existing check pins `Overdue`, `CREDIT_COLS`, a
  13-wide Credits row or the Dashboard overdue cell (grep over poc/run_*.js: none).
- **`creditOverdue` and the date helpers.** `daysBetweenKeys(a, b)` is positive when `b` is later (core_orders.js:56-60),
  so `daysOver = daysBetweenKeys(dueDay, today)` is positive once overdue; `today > dueDay` on `yyyy-mm-dd` strings
  is a correct date compare. The move to core_burmese.js is necessary and safe: `MY_DIGITS` and `dayKey` live there
  (core_burmese.js:6, :30-34), run_sync loads core_bot and core_ledger without core_orders (run_sync.js:16-21), and
  `fmtDayShortMy('')` returns `''` (:50-54), so the report column `fmtDayShortMy(c.dueDay) || ''` needs no guard.
- **The three credit tables.** Month report (core_report.js:219-221), customer statement (:271-273), owed report
  (:306-310) each end with `ရက်` and carry totals rows of matching width, so "+1 column after `ရက်`, +1 `''` on the
  totals row" is exactly right. `buildReceipt` reads `saleGroupInfo` (:322-348); `receiptText` order (:358-369) and
  `receiptReport`'s footer (:376-388) take the extra line where the spec puts it.
- **`Kind` through the core.** `listNormRow` is the one normaliser (core_ledger.js:336-348) and every source goes
  through it: `listNormRows` (:355-370), `legacyListRows` (:378-423), `listRowFromCompact` (:503-506), `listUpsert`'s
  appended row (:582-584), `listsJsonUpsert` (:529-541). "Present only when set" keeps run_lists.js:592 (compact keys
  `k,l,a,o,s,d`), :869 and :1003 (eight-field rows), run_gas.js:593 (eight keys) and :1094-1098 (seed compact rows)
  green because no seeded or round-4 row has a kind. `listUpsert` sets nothing but label/detail on an existing key
  (:586-598), so "a later rec with another kind is `dup`" holds.
- **`Kind` through the Sheet.** `gasListRows` builds a fixed object from header-keyed rows (gas_store.js:234-254),
  `gasStore.listOptions` copies eight fields (:629-633), `gasListValues` maps named headers and writes `''` for an
  unknown one (:276-282), `gasListsPersist`'s `pending.push` is a fixed field list (:316) and persists `set` ops for
  label/detail only (:319-323): each of the spec's four edits is at the right line. `ensureListsTab` appends a missing
  header (`ensureColumns`, gas_setup.js:153-154; 9 ≤ 26, no growth) and the note loop walks `CFG.LIST_COLS`
  (:192-196), so `lists_note_kind` is the only missing piece; run_gas.js:466 and run_lists.js:918 iterate
  `CFG.LIST_COLS` the same way. The `Kind` dropdown is a third `list` validation on 999 cells, so the named edits
  run_gas.js:464 (`2 * 999` → `3 * 999`) and :520 (`1998` → `2997`) are the right two; the fake models
  `requireValueInList`/`setAllowInvalid` (poc/fake_gas.js:489-506) and stores one rule per cell (:345-348), so a
  second `setupSheet` does not double the count.
- **`Kind` through sync.** `syncListRecReason` validates named fields and ignores unknown ones (core_sync.js:469-481),
  `syncApplyListEntry` copies `label, detail, detailWas, shop` (:517-524): the spec's two edits are the complete set;
  an older server stores a wallet. The phone queues the rec as given (app_store.js:353-362; sim_phone.js:168-173) and
  `setSettings` re-applies pending recs onto a pulled `lists_json` (app_store.js:459-469), so a kind added offline
  survives a pull that arrives before the push. `listsJsonFor` → `listRowToCompact` (`t` only when set) changes the
  Settings hash only when a kind exists (:512-522).
- **`sale_flow` reaches phones.** `syncSettingsFor` copies every Settings row (core_sync.js:915-929); a pull sends the
  map on a hash change (:1010) and bootstrap always (:1062-1067); the app's `getSetting` reads the per-device pref,
  then the pulled map (app_store.js:341-344); the simulator's fake server exposes `allSettings` as a copy of
  `world.settings` (sim_sync.js:81); the real one reads the Settings tab (gas_sync.js:238-242); `gasStore.getSetting`
  returns the default for a missing row or a blank Value (gas_store.js:664-668). `seedSimWorld` has no `sale_flow`
  today (sim_seed.js:67-74), so the one added line is the switch for every suite, the dev page and today's simulator.
- **The script lock.** `buildPorts().lock.run` is `gasLocked` (gas_main.js:148-156), re-entrant through
  `GAS_LOCK_DEPTH` (:66-73); the sync server's `lock.run` is the same (gas_sync.js:290); `gasStore.addCustomer` locks
  itself (gas_store.js:428-441) and `gasSyncStore.addCustomer` with a phone id runs inside the batch lock
  (gas_sync.js:249-257). `commitSaleGroup` → one `writeGroup` → one lock; `gasLedgerWidth` adds no `LockService` use,
  so run_gas.js:87-90 ("LockService in exactly one place") and :473 ("setupSheet took the lock once") stay green.
  `insertColumnsAfter` is an `OTHER_WRITES` entry, not a value write (fake_gas.js:141-143), so run_gas.js:1148
  ("one block write for the group") is untouched when the grid grows inside a push.
- **`setupSheet` idempotence (as built today).** `ensureTab` writes a header only on an empty tab (gas_setup.js:247-254),
  `ensureColumns` writes only missing names (:257-265), defaults and Messages are appended only when missing
  (:67-68, :71-73), the Lists seed runs only while `gasListsLastRow() < 2` (:164-174), `protectTab` is guarded
  (:303-307); the `sale_flow` note and the `Kind` dropdown re-apply the same value. See L10 for how to check it.
- **Customer before group.** `ENTRY_KINDS` (core_sync.js:75), `syncPlanPush` sorts by kind then outbox order
  (:1352-1366), the server applies customers first (:676-709) and writes a phone id as given (gas_sync.js:249-257);
  the app's `addCustomer` pushes its entry before the sale's group (app_store.js:272-280, :325-332); the id shape
  `C-` + 8 hex passes `/^C-[0-9a-zA-Z]{4,12}$/` (core_sync.js:424). `addCustomer({name, phone})` is honoured by all
  three stores (gas_store.js:433, app_store.js:327, sim_ports.js:101).
- **S+ deposits.** `depositsFree` (core_ledger.js:1214-1217) is what `applyDeposit` uses without an order id
  (:858-873); the DEPOSIT_APPLIED row joins the sale's group, so `undoGroup` returns it with the sale.
- **Corrections.** `rewriteRows` builds mirror and replacement by explicit field lists (:965-990), so the spec's
  `dueDay: row.dueDay` on the replacement is the one hook; mirrors and `undoGroup`'s mirrors get `''` through
  `newTx`'s default (:918-925, :975-980). `convertSaleToCredit` → `rewriteGroup` (:1053-1059) therefore keeps a
  quick sale's `''`. `commitSale` is untouched (:755-768).
- **Existing consumers of `openCredits` entries** compare `groupId:owed` strings or lengths (run_sync.js:172-173,
  run_lists.js:1073-1074, run_scenario.js throughout) or JSON before/after within one clock (run_lists.js:731-758):
  the three new fields are harmless. run_lists.js:1038-1043 counts `ledgerRows()` calls inside `openCredits`;
  `dueDay`/`overdue`/`daysOver` need no store call. run_scenario.js:722 (`views.argc === 3`) is unchanged.
- **The summary filter.** Today `overdue = openCredits(ports, null).filter(c => c.days >= CFG.OVERDUE_DAYS)`
  (core_ledger.js:1551-1557); the split into undated (`summary_overdue`, identical text) and dated
  (`summary_due_overdue`) is a pure filter change on entries already sorted oldest first (:1167).

## Probe (scratch, not part of the tree)

`C:\Users\USER\AppData\Local\Temp\claude\382443627803a215\49f3ff95-e593-4d86-a074-f2e6d3f31155\scratchpad\probe_glue.js`
loads `poc/fake_gas.js` with `core_config.js` plus `ensureTab`, `ensureColumns`, `textColumn`, `gasEnsureWidth`,
`gasHeader` cut from the real files, and runs:

- publish window: 26-header Ledger, one 26-value row; `appendRow` of 27 values → "Sheet.appendRow with 27 values on
  Ledger, which has 26 columns, is not modelled"; `gasEnsureWidth(sh, 27)` → `maxCols 27`; `appendRow` 27 ok;
  `getDataRange().getValues()[0].length === 27` with `''` at index 26; `getLastColumn() === 27`;
  `ensureColumns(sh, COLS27)` → header ends `['ReceiptNo', 'DueDay']`; `textColumn(sh, COLS27, 'DueDay')` → column 27
  rows 1 and 5 formatted `@`.
- fresh tab: `ensureTab` with 27 headers on a new 26-column sheet → "The coordinates of the range are outside the
  dimensions of the sheet"; `gasEnsureWidth` first → header 27 wide, `maxCols 27`.
- letters: `{overdue: 'O', owed: 'L', dueDay: 'N', n: 15, formula: '=SUMIF(Credits!$O:$O,TRUE,Credits!$L:$L)'}`.
