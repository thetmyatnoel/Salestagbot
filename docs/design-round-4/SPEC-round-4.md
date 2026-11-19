# SPEC round 4 (binding, revision 2): option lists, bank accounts, split payment, add-option, measurement form

Date 2026-11-09. This file is the contract for the build of POS-PROJECT-PLAN.md section 15. Where the
plan and this file differ, this file wins. Revision 2 resolves every finding of the three spec reviews
(`review-ledger-sync.md`, `review-bot-ux.md`, `review-glue-app-tests.md`, same folder; read the one for
your step, it holds file:line evidence and probes). Background facts: `map-ledger.md`, `map-botux.md`,
`map-appsheet.md`. Source designs: `design-*.md`.

**Revision 2.1 (2026-11-11), after the adversarial review of steps 1 and 2.** The code of steps 1 and 2
now does the following, and these points bind later steps as much as the sections below:
- `methodKeyFor(ports, text, shop)`: CASH or an exact key among `payMethods(ports, shop)` wins at once;
  otherwise the label match over the shop's active rows; only then a known retired or other-shop key;
  otherwise `''`.
- `addListOptionByLabel`: a name that is only an amount (digits, Burmese number words, separators and
  currency words such as ကျပ်, k, ks, kyat, mmk, lakh; helper `listLooksLikeAmount`) is `empty`.
  It may answer `{ok: true, existed: true}` when the same name was added at the same moment.
  `setListDetail` may answer `{ok: false, reason: 'missing'}`.
- `openCredits` skips a group whose amount minus cash, applied deposits and payments is 0 or less before
  it calls `saleGroupInfo` (a split sale is no longer a permanent candidate).
- `finishSplit` clears only its own `split_bank` state (`clearSplitState`); a spoken amount whose method
  resolves to CASH is the cash part, and the account part is the rest.
- The ➕ add state gives way to a spoken intent (`isMoneyIntent`) only when that intent carries what its
  entry needs (a number for SALE, RETURN, RESTOCK, EXPENSE, PAYMENT and DEPOSIT; a number or item for
  TRANSFER; a customer for ORDER).
- A message edited into a committed card is marked in the cache (`card:<chat>:<msg>`, 10 minutes); a ➕
  tap on a marked message answers `expired` as a new message and leaves the card alone.
- Google glue: `writeDashboard` grows the grid before it clears the tab, and writes its label cells with
  a leading apostrophe; the glue's list readers use `gasListsPorts()` (the store plus the script cache),
  so a list warning is logged once across executions; `gasEnsureRows` grows a tab before a block write
  below its last row; `ensureListsTab` runs under `gasLocked`.

**Revision 2.2 (2026-11-11), after the adversarial review of steps 3 and 4.** These points override the
sections below where they differ:
- 9.1 duplicate rule: a measurement entry is a dup only when a stored session of that customer carries
  the same `entryId`. `CFG.MEAS_FIXED_COLS` ends with `EntryID`; `gasStore.addMeasurement` writes it and
  appends the column to a Measurements tab set up before it; the reader keeps it out of the fields. The
  old values rule applies only to an entry without a usable entryId (missing, or over
  `SYNC.MEAS_ENTRY_ID_MAX` = 64). Section 12's "dup against an older session" now means the older
  session's own entry sent again. A dup also gives its session id to the order named in `rec.orderId`
  when that order belongs to the same customer and has no measId (`syncLinkMeasOrder`).
- 8 and 9.1 old servers: this server marks its own `bad_kind` answer with `kindKnown: true`.
  `syncApplyPushResults` keeps in the outbox a list or measurement entry answered `bad_kind` without
  `kindKnown` (a server older than the kind: a rollback, or the app published before the bot), with no
  `measurementRejected` and no quarantined line. A list entry that does leave the outbox quarantined
  clears `cursor.settingsHash`; `syncApplyDelta` keeps it cleared on a page without settings.
- 9.1 paging: the pull carries `measFrom`; `syncApplyDelta` advances `measAfter` only when `measFrom` is
  absent or equals the cursor's value, and gives a store with `upsertMeasurement` but no numeric
  `measAfter` the value 0. A list or measurement entry answered `retry` holds back the later entries of
  the batch that depend on it.
- 8 key rule: a list-entry key with whitespace, a comma, a colon or a control character is accepted only
  when it equals a key of the server's stored list exactly (legacy keys such as `K PAY`). `|`, an empty
  key and keys over 12 bytes stay malformed.
- 8 Transport B: when `counts.retry > 0` the ingest reply appends `' · ' + t('ingest_retry')`
  (new SYNC_MSG key `ingest_retry`: `⏳ {retry} ခု ကျန်`) and the SyncLog note appends `retry N`.
- 5 prompts: `dropAddState` runs on `/start` that opens the menu or a voucher link and on every `M|`
  callback; an `add_option` state gives back its saved state, a `list_detail` state is cleared. Both
  prompts live `CFG.ADD_STATE_TTL_SEC` = 600 s. A typed sentence inside the 10 minutes is still taken
  as the name (no typed money-intent escape).
- 9.3 app: the voucher box makes a typed order id canonical (`v1-25` is `V1-0025`); a number field with
  `multi > 1` is normalised box by box before the join; a reload deferred by an open form happens only
  when `commit('reload')` resolved true; `createIdbAdapter`'s `onversionchange` calls
  `adapter.onreplaced` and the app reloads that tab after its commit chain settles. Each queued AI job
  gets its own `jobId` (the server caches AI results by job id for every device). The app form leaves
  out MeasureFields keys that do not match `[A-Za-z0-9_]{1,40}`.

## 0. Owner's answers and ground rules

Owner's answers (2026-11-09):
1. Logins stay as they are. No bank accounts are pre-registered: the Lists tab is seeded from today's
   methods and the family adds the real accounts (laptop or ➕).
2. **Every staff member may add a bank account from the phone**, not only the owner.
3. **Receipts and vouchers that still carry a balance print where to transfer.**
4. The measurement book moves to a form in the app (phone, laptop Chrome, iPad).

Ground rules:
- `apps-script/core_*.js` and `app/app_*.js` are **ES5 only**: `var` and `function`; no let/const, arrow
  functions, classes, template literals, default parameters, spread, destructuring, for-of, `Object.assign`,
  `Math.imul`, `Array.prototype.includes/find/findIndex`, `String.prototype.includes/startsWith/endsWith/padStart/repeat`.
  Test files under `poc/` may use modern JS.
- **All core and app files share one global scope.** Before adding a global function or variable, grep
  `apps-script/core_*.js`, `apps-script/gas_*.js` and `app/app_*.js` for the name. An existing name is
  never redefined. (`categoryEmoji(category)` in core_config.js is the item-category emoji and stays as it
  is; the new expense helper is `expenseEmoji`.)
- **Load sets differ.** core_ledger.js calls nothing defined in core_orders.js, core_sync.js or
  core_bot.js. core_sync.js calls nothing defined in core_orders.js or core_bot.js. `aiContextText` uses
  nothing but `CFG` (tools/score_voice.js loads only core_config, core_burmese, core_ai_prompt).
- The Ledger stays append-only. No new Ledger column, no new row type.
- Backward compatible: rows already in the live Sheet are never touched; a Sheet without a `Lists` tab
  and a store without the new methods behave exactly as today (legacy fallback).
- Telegram callback data is at most 64 bytes, always. Every committing callback joins `MUTATING_ACTIONS`.
  A screen builder skips a button whose callback data would exceed 64 bytes (the `sendDesignScreen` rule).
- Selling stays scan + ✅. Nothing is asked before the commit. The common cases cost no more taps than
  today.
- **No existing check is edited.** With everything in this spec in place, all existing checks pass
  unchanged: `node poc/run_scenario.js` (327), `node poc/run_sync.js` (178), `node poc/run_app.js` (79).
  A reviewer prototyped the new keyboards against them. An existing check that fails is a regression to
  fix in the code. `poc/run_scenario.js` is not edited at all; new checks go into new files or are
  appended to `run_sync.js` / `run_app.js`.
- New Burmese strings go into `MSG` in `core_messages.js` (app chrome strings into `app/app_i18n.js`).
  Section 11 gives the texts. No new button text may contain `ငွေသား`, `KBZPay`, `WavePay` or `ဘဏ်လွှဲ`, and
  none may start with `🏦` followed by a space unless it is a method button (existing checks find buttons
  by those texts, and `stripMethodLines` removes message lines that start with `🏦 `).
- A committed card (a sale, payment, deposit, expense, return, voucher reply) is never edited into a
  question. Follow-up questions from a committed card are sent as a new message, as `CR`, `CU` and `PY`
  do today.
- The actionable screen is always the last bot message of a reply (the app shows only the last one).
- No new file is created under `apps-script/` (five loaders list those files by name). `app/config.js` is
  never edited. `app/dist/`, `apps-script/dist/`, `poc/dist/` are build outputs anyone may regenerate.
- The project is not a git repository. A copy made before the build is at
  `C:\Users\USER\Desktop\Noel-backup\pre-round4`.

## 1. Lists: data model

### 1.1 Config (core_config.js)

```js
LIST_NAMES: ['pay_method', 'expense_category', 'fabric'],
LIST_CODES: { pm: 'pay_method', ec: 'expense_category', fb: 'fabric' },   // short codes inside callback data
LIST_PREFIX: { pay_method: 'B', expense_category: 'c', fabric: 'f' },
LIST_COLS: ['List', 'Key', 'Label', 'Active', 'Order', 'Shop', 'Detail', 'Note'],
LIST_KEY_MAX_BYTES: 12,      // same limit as METHOD_KEY_MAX_BYTES: a method key rides in PM|<uuid>|<KEY>
LIST_LABEL_MAX: 40,
LIST_DETAIL_MAX: 80,
MAX_BANK_BUTTONS: 12,        // was 4; the method rows now wrap (section 2)
```

A normalised list row, the only shape the core works with:
`{ list, key, label, active (boolean), order (number), shop ('' | 'S1' | 'S2'), detail (string), note (string) }`.
`shop` blank means both shops. `detail` is the account number and holder for `pay_method`, the emoji for
`expense_category`, unused for `fabric`. Keys never change once used (Ledger.Method and Ledger.Category
store keys).

**Normalisation**, applied by `listRows` to every source, so every other helper sees only normalised rows:
- `key`: trimmed string, upper-cased for `pay_method`, lower-cased for the other lists. A row with an
  empty key, or a key containing `|`, is skipped (the second case is logged once). A later row whose
  normalised key repeats an earlier one is skipped.
- `label`: trimmed string; the key when blank.
- `active`: boolean. Stores map a blank cell to `true`.
- `order`: a finite number above 0, else 0. Rows with order 0 sort after all others, in source order.
- `shop`: `S1` or `S2` (upper-cased), else `''`.
- `detail`, `note`: trimmed strings.

### 1.2 The upsert rule, written once (core_ledger.js)

`listUpsert(rows, rec, seedRows)` is pure. `rows` = the normalised rows of `rec.list` now stored.
It returns `{rows, ops, status, key}` where `ops` is a list of `{op: 'append', row}` and
`{op: 'set', key, field, value}` for the store to persist.
- When `rows` is empty, the `seedRows` (normalised) are appended first (each an `append` op), so adding
  one option never hides the options the user sees today.
- Keys compare after normalisation (case-insensitively in effect). The returned `key` is the stored one.
- Key absent, and `rec.label` is a non-empty string: append
  `{list, key, label, active: true, order: (largest order of that list, 0 when none) + 1, shop: rec.shop || '', detail: rec.detail || '', note: rec.note || ''}`.
  Status `ok`.
- Key absent, and no label: nothing is appended. Status `dup`.
- Key present: set `label` only when the stored label is blank (or equal to the key) and `rec.label` is
  non-empty. Set `detail` when `rec.detail` is a non-empty string different from the stored one **and**
  either the stored detail is blank or `rec.detailWas` is a string equal to the stored detail (the user
  replaced the value they were looking at; a stale edit from an offline phone never overwrites a newer
  one). Never touches `active`, `order`, `shop`. Status `ok` when something was set, else `dup`.

Store port (feature-detected; all optional):
- `store.listOptions(name)`: every row of that list (active or not) in sheet order; `[]` when the tab or
  the list is missing. Returns `order: 0` for a blank cell (never `''`, `NaN`, `Infinity`), and Key, Label,
  Detail, Note as strings.
- `store.addListOption(rec, seedRows)`: reads its rows of `rec.list`, calls `listUpsert`, persists the
  ops, returns `{status, key}`.
- `store.addDesign(rec)`: appends a Designs row `{code, name, category, basePrice, daysToMake, active, note}`.
  When the code already exists (the `getDesign` lookup) nothing is written. It returns the stored design
  in the shape `getDesign` returns, for a new row and for an existing code alike.

### 1.3 Core helpers (core_ledger.js)

- `legacyListRows(ports, name)`: normalised rows as today's Settings/Messages/CFG give them, never reading
  the Lists tab or `lists_json`, and parsing every Settings value itself:
  - `pay_method`: today's parse of `Settings pay_methods` (CASH forced first, default
    `CFG.DEFAULT_PAY_METHODS`, the 12-byte rule), label = `t(ports, 'method_' + KEY)` when that message
    exists, else the key; order 1..n.
  - `expense_category`: today's parse of `Settings expense_categories` (`key:label`, CFG fallback with
    `cat_<key>` labels, `other` appended), detail = `CFG.EXPENSE_EMOJI[key] || ''`.
  - `fabric`: `Settings fabric_presets` CSV or `CFG.FABRIC_PRESETS`, keys `f1`, `f2`, ... in order.
- `listRows(ports, name)`: normalised rows from the **first non-empty** source:
  1. `ports.store.listOptions(name)` when the store has it (server, simulator);
  2. `Settings lists_json` (the phone; compact rows, section 1.4). A value that is missing, is not valid
     JSON, or holds no rows for this list counts as absent. The parse is memoised on the raw string; the
     memo is read-only: `listRows` builds new row objects from it on every call;
  3. `legacyListRows(ports, name)`.
- `listOptions(ports, name, shop, includeInactive)`: `listRows` filtered (active unless
  `includeInactive`; when `shop` is given, rows whose `shop` is blank or equal), sorted by `order` (0
  last), ties by source order.
- `listOption(ports, name, key)`: the row with that normalised key, inactive included, or `null`.
- `payMethods(ports, shop)`: `['CASH']` followed by the active `pay_method` keys for that shop (all shops
  when `shop` is omitted), `CASH` itself skipped. A key over `LIST_KEY_MAX_BYTES` UTF-8 bytes is dropped
  and logged once (`warnPayMethodKey`, as today). At most `CFG.MAX_BANK_BUTTONS` non-cash keys; the rest
  are dropped and logged once. With no Lists rows it returns exactly today's value.
- `methodKnown(ports, key)`: true for `CASH` and for any `pay_method` row, inactive included. Every place
  that today validates a tapped method with `payMethods(ports).indexOf(key) < 0` uses `!methodKnown(...)`.
- `methodLabel(ports, key)`: the `pay_method` row's label (inactive included), else
  `t(ports, 'method_' + KEY)` when that message exists, else the key.
- `accountDetail(ports, key)`: the row's `detail` or `''`.
- `expenseCategories(ports)`: `[[key, label], ...]` of active rows; `['other', t(ports, 'cat_other')]`
  appended when missing. `categoryLabel(ports, key)` resolves inactive rows too.
- `expenseEmoji(ports, key)`: the row's `detail` when non-empty, else `CFG.EXPENSE_EMOJI[key]`, else `📦`.
- `fabricOptions(ports)`: active `fabric` rows. In core_orders.js `fabricPresets(ports)` becomes a wrapper
  that returns their labels (never the reverse).
- `listHash(text)`: a 32-bit FNV-1a hash of the string in the shift-add form (no `Math.imul`), as 8
  lower-case hex digits.
- `listNameKey(label)`: `normName(label)` after removing U+200B, U+200C, U+200D, U+2060 and U+FEFF. Two
  labels are the same name when their `listNameKey` is equal.
- `listKeyFor(ports, name, label, existingKeys)`: `slug + suffix`. `slug` = the first 7 ASCII letters and
  digits of the label (upper case for `pay_method`, lower case otherwise). When the slug is empty or
  starts with a digit, `CFG.LIST_PREFIX[name]` comes first and the slug is cut to 6, so a key always
  starts with a letter. `suffix` = the first 4 hex characters of `listHash(listNameKey(label))` (same case
  rule), so every device derives the same key for the same name and the upsert merges them. Only when
  that key already exists in `existingKeys` (another label, compared after normalisation) take 4 hex
  characters from `ports.uuid()` instead, regenerating at most 5 times. At most 11 bytes; never `CASH`,
  never `other`.
- `addListOptionByLabel(ports, name, label, staff)`:
  1. Clean the label: remove U+200B and U+FEFF, drop line breaks, collapse whitespace, trim, cut to
     `LIST_LABEL_MAX`. Empty, or made only of digits (Arabic or Burmese), spaces and the characters
     `. , - + ( ) /`: return `{ok: false, reason: 'empty'}` (a mistyped amount must not become an option).
  2. A row of `listRows(ports, name)` (inactive included) with the same `listNameKey`: return
     `{ok: true, existed: true, key, label: <stored label>}` and write nothing.
  3. No `ports.store.addListOption`: return `{ok: false, reason: 'unavailable'}`.
  4. Otherwise `key = listKeyFor(...)`, then
     `ports.store.addListOption({list: name, key, label, shop: '', note: 'added by ' + staff.name + ' ' + dayKey(now)}, listRows(ports, name))`
     and return `{ok: true, created: true, key, label}`. Options added in a flow are shared by both shops.
- `setListDetail(ports, name, key, detail)`: cleans `detail` (one line, trimmed, cut to `LIST_DETAIL_MAX`);
  empty: `{ok: false, reason: 'empty'}`; no store method: `{ok: false, reason: 'unavailable'}`; otherwise
  `store.addListOption({list: name, key, detail, detailWas: accountDetail(ports, key)}, listRows(ports, name))`
  and return `{ok: true, saved: <status is 'ok'>, detail: <the detail now stored>}`.
- `methodKeyFor(ports, text, shop)`: an exact key (upper-cased) known to `methodKnown`; else the key of an
  active row whose `listNameKey(label)` equals, contains, or is contained in `listNameKey(text)` (longest
  label first; a label shorter than 2 characters never matches by containment); else `''`.
- `transferLines(ports, shop)`: the array of `label + ' ' + detail` for the active non-cash `pay_method`
  rows of that shop that have a non-empty detail (first 4 by order). `transferLine(ports, shop)`: `''`
  when that array is empty, else `t(ports, 'receipt_transfer', {accounts: <joined with ' · '>})`.

### 1.4 How lists reach a phone

In core_ledger.js, next to each other:
- `listRowToCompact(row)` gives `{k, l, a (1|0), o, s, d}`; `listRowFromCompact(name, c)` gives a row.
- `listsJsonFor(ports)`: `JSON.stringify({pay_method: [...], expense_category: [...], fabric: [...]})` of
  the normalised `store.listOptions` rows, or `''` when the store has no `listOptions` or all three are
  empty.
- `listsJsonUpsert(raw, name, seedRows, rec)`: parses `raw` itself (never the memo; unparseable counts as
  `{}`), runs `listUpsert` on that list, returns `{raw: <new JSON>, status, key}`.

In core_sync.js:
- `syncSettingsFor(sp)` replaces both `sp.store.allSettings()` calls (`syncBuildPull`, `syncBootstrap`):
  it copies the Settings map (or `{}`), deletes `lists_json` and `meas_fields_json` from the copy, then
  sets `lists_json` when `listsJsonFor(sp)` is non-empty. (Step 3 adds `meas_fields_json`, section 9.1.)
  A list edit therefore changes the Settings hash and reaches every phone at its next sync.

### 1.5 The Lists tab and the script lock (gas_setup.js, gas_store.js, gas_main.js, gas_sync.js)

**One re-entrant script lock.** LockService is not counted: a second `waitLock` on a held lock does
nothing and the first `releaseLock` frees it. So no function that can run inside `ports.lock.run` or
`sp.lock.run` may take or release the lock itself. In gas_main.js:

```js
var GAS_LOCK_DEPTH = 0;
function gasLocked(fn, waitMs) {
  if (GAS_LOCK_DEPTH > 0) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(waitMs || 15000);
  GAS_LOCK_DEPTH = 1;
  try { return fn(); } finally { GAS_LOCK_DEPTH = 0; lock.releaseLock(); }
}
```

It uses only `waitLock` and `releaseLock` (poc/run_sync.js step S18 stubs exactly these two and loads
gas_sync.js and gas_main.js without gas_store.js; S18 must stay green unchanged). Every holder goes
through it and nothing else calls LockService: `buildPorts().lock.run` (gas_main.js),
`gasSyncServerPorts().lock.run` (gas_sync.js), `gasDedupe.remember` (5000 ms), `gasStore.addCustomer`,
`nextOrderNo`, `addMeasurement`, and the new `addListOption` and `addDesign`. Keep each one's existing
wait time.

- `ensureListsTab(ss)` (gas_setup.js), idempotent:
  1. Create the tab with `CFG.LIST_COLS` when missing (`ensureTab`, `ensureColumns`).
  2. **Text format is part of the contract**: right after the header and before any seed, the whole `Key`,
     `Label`, `Detail` and `Note` columns get number format `@`. Not inside a try/catch: a failure stops
     setup with its error. (An account number such as 09777123456 must keep its leading zero; it is what
     receipts print.)
  3. When the tab has no data rows: seed the three lists from `legacyListRows({store: gasStore}, name)`
     with `Active` = the boolean `true`, `Order` 1..n, `Shop` blank, written with `setValues`.
  4. Write `true` into the `Active` cell of every row that has a Key and a blank Active. Never change a
     cell that holds `false`.
  5. Niceties, each in its own try/catch: `Active` checkboxes as
     `sh.getRange(2, activeCol, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())`
     (**never `Range.insertCheckboxes()`**: it sets every cell of its range to FALSE and would switch every
     option off); dropdowns from row 2 on `List` (`requireValueInList(CFG.LIST_NAMES, true)`,
     `setAllowInvalid(false)`) and on `Shop` (`S1`, `S2`; blank allowed); header notes
     `t({store: gasStore}, 'lists_note_' + <column name in lower case>)` with `setNote`; two highlights set
     with one `sh.setConditionalFormatRules([dupRule, blankLabelRule])` (replacing the sheet's rules, so a
     second run adds none).
  6. `gasInvalidate()`.
  `setupSheet` calls it before `writeDashboard`.
- `gasStore.listOptions(name)`: `gasTableIf('Lists')` rows of that list; a blank Key is skipped;
  `active = (v === '' || v === null || v === undefined) ? true : gasBool(v)`; `String()` of Key, Label,
  Detail, Note; a blank or non-numeric Order is 0.
- `gasStore.addListOption(rec, seedRows)`, the whole body inside `gasLocked`: `gasInvalidate()` first (the
  caller's read is older than the lock); create and seed the tab through `ensureListsTab` when it is
  missing; read the rows of `rec.list`; `listUpsert`; persist: an appended row never uses `appendRow`; it
  sets `@` on the Key, Label, Detail and Note cells of the new row and then writes with `setValues` (the
  `addMeasurement` pattern), and a `set` op on Label or Detail sets `@` on its cell first; then
  `SpreadsheetApp.flush()`, `gasInvalidate()`, `GAS_DASH_DIRTY = true`. It does not rewrite the Dashboard
  itself.
- `gasStore.addDesign(rec)` inside `gasLocked`, through the existing mapped-append helper.
- **Dashboard refresh.** `var GAS_DASH_DIRTY = false;` `gasDashboardRefresh()` returns before touching any
  service when the flag is clear; otherwise it clears the flag and rewrites the Dashboard once under
  `gasLocked` in a try/catch (an error goes to the Errors tab). `doPost` calls it in a `finally` on both
  branches (Telegram and `?api=`). So the ➕ reply never waits for the Dashboard and the batch lock is
  never held for the rewrite.
- `writeDashboard`: the category block lists every `expense_category` row (inactive included) plus
  `other`. After it, a new block: a bold heading row `['Money by account (this month)', 'In', 'Out', 'Net']`,
  then one row per non-cash row of `listOptions({store: gasStore}, 'pay_method', null, true)`:
  `[label + ' (' + KEY + ')', '=' + mIn(KEY), '=' + mOut(KEY), '=B' + r + '-C' + r]`, each row in
  `numberRows`, with

```js
function mBase(KEY) { return L('Cash') + ',' + L('Day') + ',$D$2&"*",' + L('Method') + ',"' + String(KEY).replace(/"/g, '""') + '"'; }
function mIn(KEY) { var b = mBase(KEY); return 'SUMIFS(' + b + ',' + L('Cash') + ',">0",' + L('ReversesTxID') + ',"=")+SUMIFS(' + b + ',' + L('Cash') + ',"<0",' + L('ReversesTxID') + ',"<>")'; }
function mOut(KEY) { var b = mBase(KEY); return '-(SUMIFS(' + b + ',' + L('Cash') + ',"<0",' + L('ReversesTxID') + ',"=")+SUMIFS(' + b + ',' + L('Cash') + ',">0",' + L('ReversesTxID') + ',"<>"))'; }
```

  (This is `addMethodCash` as formulas: a mirror reduces the bucket its original filled. No Shop
  criterion. No blank-Method term.)
- `onEdit(e)` in gas_main.js (a simple trigger; it runs because the project is bound to the Sheet). First
  statement, before any spreadsheet read:
  `if (!e || !e.range || e.range.getSheet().getName() !== 'Lists') return;`
  Then, in one try/catch: `gasLocked(function () { gasInvalidate(); <write true into blank Active cells of rows that have a Key>; writeDashboard(<the Dashboard tab, when it exists>); })`.
- Simulator store (poc/sim_ports.js): `world.lists` (array of rows), `listOptions`, `addListOption` (calls
  `listUpsert`, emits a `lists` event), `addDesign`. `simSeedLists(world)` fills `world.lists` from
  `legacyListRows`. `seedSimWorld` does **not** call it (run_scenario keeps the legacy path); the new test
  files, the simulator page and the app's dev page do.
- The fake server (poc/sim_sync.js) wraps the simulator store method by method. It forwards, each only
  when the simulator store has the method: `listOptions`, `addListOption`, `addDesign` (step 1);
  `listMeasureFields`, `listAllMeasurements`, `listMeasurements`, `addMeasurement`, `getOrder`,
  `updateOrder` (step 3). A check that needs a server without a method deletes that forward on
  `server.ports.store` for the check and restores it.

## 2. Bank accounts are the method buttons (core_bot.js)

- `methodRows(ports, shop, current, mk, opts)`:
  - `current` is a key, an array of keys, or null: those keys get no button.
  - One button per remaining key of `payMethods(ports, shop)`: `CASH` gives `btn_cash`, others `btn_bank`
    with `methodLabel`; callback `mk(key)`.
  - Layout: one row when there are 3 or fewer buttons and no label is longer than 10 characters,
    otherwise rows of 2.
  - `opts.split` (a callback string) adds `btn_split`; `opts.add` (a callback string) adds `btn_add_bank`.
    They never share a row with method buttons: they form one extra last row, split first.
  - The caller appends its own `[btn_cancel]` row on the screens that have one today (expense, delivery,
    refund) and on the split account screen.
- Sites, all using `methodRows` (the old `slice(0, MAX_BANK_BUTTONS)` logic goes away):

| Site | shop | current | mk(key) | opts |
| --- | --- | --- | --- | --- |
| after a sale (`afterSaleKeyboard`, while rewritable and cash > 0) | row.shop | `methodOf(row)` | `PM\|<g>\|<KEY>` | split `SX\|<g>`, add `LA\|pm\|PM\|<g>` |
| payment, deposit, expense, return replies (`moneyKeyboard`) | row.shop | `methodOf(row)` | `PM\|<g>\|<KEY>` | add `LA\|pm\|PM\|<g>` |
| order voucher reply (advance group) | order.shop | `CASH` | `PM\|<depositGroup>\|<KEY>` | add `LA\|pm\|PM\|<depositGroup>` |
| expense method screen | draft.shop | null | `EM\|<KEY>` | add `LA\|pm\|EM` |
| delivery method screen | order.shop | null | `ODM\|<id>\|<KEY>\|<paid>\|<pool>` | add `LA\|pm\|ODM\|<id>\|<paid>\|<pool>` |
| refund method screen | order.shop | null | `OXM\|<id>\|<KEY>` | add `LA\|pm\|OXM\|<id>` |
| split account screen | row.shop | `CASH` | `SXM\|<g>\|<KEY>` | add `LA\|pm\|SXM\|<g>` |

- **Accounts screen.** The menu's fourth row (with 🧵 and 📒 when present) gains `btn_accounts` =
  `M|acct`. It sends one message: `acct_title`, then one `acct_line` per active non-cash account of the
  staff member's shop (owner: all shops; a blank detail shows as `—`), or `acct_none`. Keyboard: one
  `btn_acct_detail {label}` button per row (`LD|pm|<KEY>`), accounts without a detail first, then the
  others (to correct a wrong number), 8 in all; then `[btn_add_bank = LA|pm|AC] [btn_cancel = Z]`.
- `LD|pm|<KEY>` (any staff member): unknown key or `CASH`: `expired`. No `ports.store.addListOption`:
  `add_unavailable`. Otherwise state `{kind: 'await_text', purpose: 'list_detail', list: 'pay_method', key}`
  and `acct_ask_detail {label}` is sent as a new message with `[btn_cancel]`. **Typed text only**: a voice
  note in this state repeats `acct_ask_detail` (a spoken number arrives as words). An empty text asks
  again. The text goes to `setListDetail`; the state is cleared; reply `acct_detail_saved {label, detail}`
  with the detail now stored (when it was not saved, the stored one), then the accounts screen as the last
  message.
- **Voice.**
  - core_ai_prompt.js: `INTENT_SCHEMA.method` becomes `{ type: 'string', nullable: true }` (the shape
    `customer` and `category` already have). `aiContextText` prints `pay_methods` as `KEY:label` strings
    and accepts both shapes of `ctx.payMethods`: an array entry `[KEY, label]` becomes `KEY:label`, a
    string entry stays as it is (a phone queues the context it built and the server prints it later);
    without `ctx.payMethods` it prints `CFG.DEFAULT_PAY_METHODS` as today. The prompt's method rule
    becomes: "Payment method: pay_methods lists KEY:label pairs. When the note names one of them (by its
    label, by the holder's name in a label, or by a brand word such as KBZ / KBZPay / ကေဘီဇက်, Wave /
    WavePay / ဝေ့ဗ်, ဘဏ် / ဘဏ်လွှဲ), answer method with that KEY exactly as listed; ငွေသား / လက်ငင်း ->
    CASH. A person's name that is part of a pay_methods label is the account, not a customer. No method
    word, or no listed pair fits -> method null." The examples keep KBZ, WAVE and BANK.
  - core_bot.js: `buildAiContext` sets `ctx.payMethods = [[KEY, label], ...]` for
    `payMethods(ports, staff.shop)` (CASH first), the shape `ctx.expenseCategories` has.
  - poc/sim_mock_ai.js: before it looks for a customer, the mock looks for a label or key of the
    `ctx.payMethods` pairs in the text (`listNameKey` containment, longest label first), returns that KEY
    as `method` and removes the label from the text; then its built-in word lists as today.
  - Wherever an intent's method is used (also the deposit-note path), it passes through
    `methodKeyFor(ports, intent.method, staff.shop)`; an unknown method is dropped (CASH as today).

## 3. One sale, part cash and part bank

A split is always **cash plus one account**.

### 3.1 Ledger (core_ledger.js)

- Refactor only: `rewriteRows(ports, row, changes, staff, updateId, opts)` returns `[mirror, replacement]`
  exactly as `rewriteGroup` builds them today; `rewriteGroup` uses it. Behaviour identical.
- `splitSale(ports, groupId, bankPart, method, staff, updateId, source)`:
  - `chk = rewriteCheck(ports, groupId)`; not ok: `{ok: false, reason: chk.reason}`. The live row must be
    a SALE with `cash > 0`, else `{ok: false, reason: 'type'}`.
  - `KEY = String(method).toUpperCase()`; `M = methodOf(row)`. `KEY` must be known (`methodKnown`) and
    not `CASH`; when `M` is not `CASH`, `KEY` must equal `M`. Else `{ok: false, reason: 'method'}`.
  - `bank = Math.round(Number(bankPart))`; not finite or `bank <= 0`: `{ok: false, reason: 'amount'}`.
  - `bank >= row.cash`: the whole payment is on the account. `M === KEY`: nothing is written. Otherwise
    `rewriteGroup(ports, groupId, {method: KEY}, staff, updateId, {noteIfBlank: 'method', source: source})`.
    Return `{ok, reason, full: true, method: KEY, bankPart: row.cash, cashPart: 0}`.
  - Otherwise **one** `writeGroup(ports, [mirror, replacement, payment])` in that order:
    `[mirror, replacement] = rewriteRows(ports, row, {cash: row.cash - bank, method: CFG.METHOD.CASH}, staff, updateId, {noteIfBlank: 'split', source: source})`
    (the replacement is the cash part; it keeps the receipt number, Time and Day) and
    `payment = newTx(ports, {groupId: groupId, shop: row.shop, itemId: row.itemId, type: CFG.TX.PAYMENT, qty: 0, unitPrice: null, amount: bank, cash: bank, customerId: row.customerId, refGroupId: groupId, note: 'split', method: KEY, staffId: staff.id, source: source, updateId: updateId})`.
    (`newTx` reads `staffId`, not `staff`: a blank StaffID would be quarantined by the sync server.)
  - Returns `{ok: true, full: false, groupId, cashPart: row.cash - bank, bankPart: bank, method: KEY, cashMethod: 'CASH'}`.
- Nothing else in the ledger changes: `saleGroupInfo`, `openCredits`, `groupMethods`, `undoGroup`,
  `customerSummaryMap`, `statsWhere`, `receiptNumber` already handle this shape.

### 3.2 Bot flow (core_bot.js)

- `SX|<g>`: guard = `rewriteCheck` ok, live row SALE, cash > 0.
  - Guard fails: the tapped card is edited exactly as `changeMethod` edits it on a refusal today (its own
    text without method lines, then `rewriteRefusal(ports, reason)`, keyboard `replyKeyboard(ports, g)`).
  - Guard passes: the tapped card is **not** edited; the question is a new message.
    When `methodOf(row)` is not `CASH` (the sale was already marked with an account), that account is the
    bank side: no account screen, straight to the amount screen for it. Otherwise candidates =
    `payMethods(ports, row.shop)` minus `CASH`. None: `split_no_bank` with
    `[btn_add_bank = LA|pm|SXM|<g>] [btn_cancel]`. Exactly one: the amount screen for it. Otherwise
    `split_ask_bank {cash: fmtMoney(row.cash)}` with the split account rows and a last row `[btn_cancel]`.
- `SXM|<g>|<KEY>` (the amount screen): the SX guard again, plus `methodKnown(KEY)` and `KEY` not `CASH`;
  on failure the tapped question is edited to `describeRow(ports, row)` (when a live row exists) +
  `rewriteRefusal(ports, reason)` with `replyKeyboard(ports, g)`. State
  `{kind: 'await_number', purpose: 'split_bank', groupId: g, method: KEY}`; text
  `split_ask_amount {method: methodLabel(ports, KEY), cash: fmtMoney(row.cash)}`; keyboard
  `[btn_all {amount: fmtMoney(cash)} = SXA|<g>|<KEY>|all] [btn_half {amount: fmtMoney(half)} = SXA|<g>|<KEY>|half]`
  / `[btn_cancel]`, `half = Math.round(cash / 2)`. The amount screen edits the question it was tapped on;
  it is sent as a new message when SX goes straight to it and when it resumes after the add-option flow.
  In the app the keypad opens by itself (the state is `await_number`); in Telegram the seller types.
- `SXA|<g>|<KEY>|<all|half>` (msgId = the tapped question) and the typed or spoken number
  (`applyAwaitedNumber` case `split_bank`, msgId = null, the state already cleared there) both call
  `finishSplit`:
  1. `chk = rewriteCheck(ports, g)`; not ok, not a SALE or cash <= 0: `clearState`; the refusal as in SXM
     (edit msgId, or send).
  2. `all` = `row.cash`; `half` = `Math.round(row.cash / 2)`. A typed or spoken amount that is not a
     whole number in `1..row.cash`: `setState(ports, uid, state)` again (the `sale_qty` pattern) and send
     `split_bad {max: fmtMoney(row.cash)}` with `[btn_cancel]`; stop.
  3. `clearState(ports, uid)` (also on the button path); `r = splitSale(...)`; not ok: the refusal with
     `r.reason`.
  4. Reply (edit msgId when there is one, else send): `describeRow(ports, <the live SALE row of g after the write>)`,
     then `split_done {cash: fmtMoney(r.cashPart), cashMethod: methodLabel(ports, r.cashMethod), bank: fmtMoney(r.bankPart), method: methodLabel(ports, KEY)}`
     (or `method_done {method: methodLabel(ports, KEY)}` when `r.full`), then, not when full: `split_hint`
     while `now - <the SALE row's time>` is within `CFG.UNDO_WINDOW_MIN` minutes, else `split_hint_late`;
     keyboard `replyKeyboard(ports, g)`; `setLastGroup`. The text of the tapped message is never the base.
- `SXA` joins `MUTATING_ACTIONS`.
- After a split the card shows undo and receipt only (plus 💰 while something is still owed): the existing
  rewrite rule, unchanged.

## 4. Expense categories (core_bot.js)

- `expenseCatScreen`: the grid from `expenseCategories` with `expenseEmoji(ports, key)`, three per row;
  last row `[btn_add_cat = LA|ec|EC] [btn_cancel]`.
- The expense method screen uses `methodRows` (section 2) plus its `[btn_cancel]` row. `EM|<KEY>`
  validates with `methodKnown`.

## 5. Adding a missing option where it is needed (core_bot.js)

- Callback `LA|<code>|<resume>|<args...>` with `<code>` in `CFG.LIST_CODES`. Not a committing action.
- `askAddOption`, in this order, before anything is edited:
  1. `<code>` not in `CFG.LIST_CODES`: `expired`.
  2. No `ports.store.addListOption`: send `add_unavailable` as a new message and stop; nothing is edited
     and the state is untouched.
  3. Resume `PM` or `SXM`: `rewriteCheck(ports, g)` must pass (for `SXM` the whole SX guard), else answer
     exactly as a refused `PM` tap does today and ask no name. Resume `OF`, `ODM`, `OXM` only when
     `ordersEnabled(ports)`, else `expired`.
  4. `cur = getState(ports, uid)`;
     `saved = (cur && cur.kind === 'await_text' && cur.purpose === 'add_option') ? (cur.saved || null) : (cur || null)`
     (a second tap never stores an add state inside an add state). State
     `{kind: 'await_text', purpose: 'add_option', list, resume: {a: <resume>, args: [...]}, saved}`.
  5. The prompt `add_ask_pm` / `add_ask_ec` / `add_ask_fb` with `[btn_cancel]`: for resume `PM` the tapped
     message is the card of a committed entry and is not edited, the prompt is a new message; for every
     other resume the tapped message is a question screen and is edited to the prompt.
- The two id checks at the top of `handleText` stay first: a typed tag id or voucher id opens that card
  and drops the add or detail state, as for every other typed state.
- The name arrives typed (`handleText`, in the `await_text` branch that runs before number parsing) or
  spoken (`handleIntent`, in the transcript section). In `handleIntent` the `add_option` state takes the
  transcript **unless** the model returned a money intent (SALE, RETURN, RESTOCK, EXPENSE, PAYMENT,
  DEPOSIT, TRANSFER, or an order intent) with `confidence >= CFG.MIN_CONFIDENCE`; in that case the add
  state is replaced by `state.saved` (or cleared) and the intent is handled as usual, so a spoken sale or
  expense is never turned into an option name. Both paths call
  `finishAddOption(chatId, uid, state, text, staff, updateId, ports, source)`:
  0. `cur = getState(ports, uid)`. When `cur` is not this same waiting state (`kind`, `purpose`, `list`
     and `resume.a` equal), nothing is restored and nothing is resumed: the option is still added and the
     reply is the prefix alone. (In the app a voice note is replayed later with the state it was recorded
     in; the entry may have been finished by typing in between.)
  1. `r = addListOptionByLabel(ports, state.list, text, staff)`. `empty`: ask again, state kept.
     `unavailable`: `add_unavailable`, state cleared.
  2. `prefix` = `add_done {label}` (created) or `add_exists {label}` (existed).
  3. Restore `state.saved` with `setState`, or `clearState` when it is null. Then resume. Each resumed
     handler is called with `msgId = null` and a new last argument `prefix`, and sends exactly **one** new
     message whose text is `prefix + '\n' +` its usual text. When its guard fails it sends
     `prefix + '\n' +` the refusal it gives today; for a known resume the prefix is never sent alone.

| resume.a | args | call | the restored state must be | refusal |
| --- | --- | --- | --- | --- |
| `PM` | `[g]` | `methodKnown(key)`; `rewriteCheck(ports, g)`; `rewriteGroup(ports, g, {method: key}, staff, updateId, {source: source, noteIfBlank: 'method'})` unless the row already has that method; `setLastGroup`; text `describeRow(ports, <live row>)` + `'\n'` + `method_done`; keyboard `replyKeyboard(ports, g)` | anything | `rewriteRefusal(ports, reason)` with `replyKeyboard(ports, g)` |
| `EM` | none | `expenseMethod(chatId, null, uid, key, staff, updateId, ports, prefix)` | `{kind: 'exp', step: 'method'}` with `draft.amount` | `expired` |
| `EC` | none | `expenseCategory(chatId, null, uid, key, staff, ports, prefix)` | `{kind: 'exp', step: 'cat'}` | `expired` |
| `SXM` | `[g]` | the amount screen of 3.2 for `key` | anything | as SXM in 3.2 |
| `ODM` | `[orderId, paid, pool]` | `deliverCommit(chatId, null, uid, orderId, Math.max(0, Math.round(Number(paid) || 0)), key, pool, staff, updateId, ports, prefix)` | anything | as today |
| `OXM` | `[orderId]` | `cancelCommit(chatId, null, uid, orderId, 'refund', key, staff, updateId, ports, prefix)` | anything | as today |
| `OF` | `[orderId]` | the order exists, is open and has a line: `updateOrderItem(orderId, <last line>, {fabric: label})`, then `sendDueScreen(chatId, null, uid, orderState(ports, uid, orderId), ports, prefix)` | the order state or none | `expired` |
| `AC` | none | the accounts screen | anything | |
| anything else | | `prefix` alone | | |

  4. After a **created** `pay_method`, for resume `PM`, `EM`, `ODM` and `OXM`: the resumed message gets
     one more text line `acct_detail_hint {label}` and one more last keyboard row
     `[btn_acct_number = LD|pm|<KEY>]`. No extra message is sent (the resumed message must stay the last
     bot message). Nothing is added for `SXM` (the state is waiting for an amount) nor for `AC` (the
     accounts screen already carries the number button).
- **Fabric screen**: one button per `fabricOptions` row, three per row, callback `OF|<id>|k|<key>`
  (`orderCallback` passes `parts[3]`; it sets the line's fabric to the row's label); then
  `[btn_own_fabric = OF|<id>|own] [btn_other = OF|<id>|type]` and
  `[btn_add_option = LA|fb|OF|<id>] [btn_cancel]`. A stale `OF|<id>|<index>` button still works: the index
  is mapped onto the current active list.
- **Design codes.** Where: `orderCodeTyped` and the `design` case of the order text input (typed or
  spoken) when `findDesign` returns null. Not `orderBegin`'s spoken hint and not a tapped `OI|<id>|<code>`.
  - `m = String(text).toUpperCase().replace(/[^A-Z0-9-]/g, '').match(/^([A-Z]{1,8})-?(\d{1,6})$/)`.
    No match (a name, digits alone, `TSL-31A`) or no `ports.store.addDesign`: today's behaviour unchanged.
  - Match: `state.draft.newCode = m[1] + '-' + m[2]` (`tsl 31` gives `TSL-31`, `TSL-0031` stays
    `TSL-0031`; `normDesignCode` is not used for the stored code), `setState`; **one** message
    `ord_design_unknown {code: newCode}` with
    `[btn_create_design {code: newCode} = OI|<id>|create] [btn_design_none = OI|<id>|none]` / `[btn_cancel]`.
    The design screen is not sent again and the step is unchanged, so a retyped code is looked up again.
  - `OI|<id>|create` (tested before the `getDesign(code)` lookup, like `type` and `none`):
    `state = orderState(ports, uid, id)`; no `state.draft.newCode`: edit to `expired`.
    `d = ports.store.addDesign({code: newCode, name: '', category: '', basePrice: '', daysToMake: '', active: true, note: 'added by <staff> <day>'})`.
    `newCode` stays in the draft (a second tap repeats the same screen and writes no second row). The
    tapped message is edited to `design_created {code: d.code}` and
    `orderPickDesign(chatId, null, uid, state, d, ports, null)` sends the next screen as a new message.
    Every staff member may do this.

## 6. Where to transfer, on receipts and vouchers that carry a balance

- `buildReceipt` exposes `r.transfer` = `transferLine(ports, r.shop)` when `r.owed > 0` and the group is
  not voided, else `''`; and `r.transferLines` (the array, or `[]`).
- `receiptText`: when `r.transfer` is non-empty, that line follows the total line.
- `receiptReport` (the PDF data): the accounts go **one per line** into `footer`, above the text that is
  there today: `footer = [t(ports, 'receipt_transfer', {accounts: lines[0]})].concat(lines.slice(1)).concat([t(ports, 'receipt_thanks')])`
  joined with a line break. Never as one long line and never in `subtitle` (gas_pdf.js sizes column A to
  its longest cell and exports fit-to-width; one long line would shrink the whole receipt). gas_pdf.js is
  not changed.
- The order voucher (core_orders.js): with `m = orderMoney(...)`, when `m.owed > 0`, the order is not
  CANCELLED and `transferLine(ports, order.shop)` is non-empty, the line is pushed into the voucher text's
  money block directly after the balance line (the delivered and the not-delivered branch alike). The
  voucher PDF (`voucherReport`): the same lines, one per line, above its footer text.
- `receipt_transfer` does not start with `🏦` (a method tap under the voucher reply rebuilds the message
  through `stripMethodLines`, which drops lines starting with `🏦 `).

## 7. Reports

- `buildDailySummary`: per shop, when two or more non-cash keys moved money that day (in or out not 0),
  one extra line `summary_accounts {list}` directly after that shop's `summary_cash` line; `{list}` =
  `label net` joined by ` · ` over those keys.
- Item card `card_buyer {method}`: `ms = groupMethods(ports, sale.groupId)`; one entry: its label;
  several: `label amount` joined by ` · `; none: `methodLabel(ports, methodOf(sale) || 'CASH')` as today.
- Day report: a row whose note is exactly `split` prints `t(ports, 'note_split')` in the note column.

## 8. Lists from the phone (step 3)

- `SYNC.ENTRY_KINDS = { customer: 1, item: 2, list: 3, group: 4, measurement: 5, notice: 6, error: 7 }`
  (the numbers are used for ordering only and are never stored).
- Entry `{kind: 'list', rec: {list, key, label?, detail?, detailWas?, shop?, note?}}`.
  - Validation (else `MALFORMED`): `rec` an object; `rec.list` in `CFG.LIST_NAMES`; `rec.key` a string of
    1 to `CFG.LIST_KEY_MAX_BYTES` UTF-8 bytes without `|`, comma, colon, whitespace or control characters;
    `label` absent or a string of 1..`LIST_LABEL_MAX` characters; `detail` and `detailWas` absent or
    strings of at most `LIST_DETAIL_MAX`; at least one of `label`, `detail` present; `shop` absent, `''`,
    or in `CFG.SHOP_IDS`; `note` absent or a string of at most 100. A server store without
    `addListOption`: `BAD_KIND`.
  - Apply: `sp.store.addListOption(rec2, legacyListRows(sp, rec.list))` where `rec2` copies the allowed
    fields and defaults `note` to `'device ' + device.id`. Result
    `{kind: 'list', entryId, status: 'ok' | 'dup', key}`; counted as ok or dup.
  - A store call of a `list` or `measurement` entry that throws is caught: the error is logged
    (`sync_apply`), the entry is answered `{kind, entryId, status: 'retry'}` and the loop continues.
    `syncApplyPushResults` ignores a status other than ok, dup and quarantined, so the phone keeps the
    entry and sends it again at the next sync; the ledger groups of the same batch are still applied.
  - `syncApplyPushResults` acknowledges an ok or dup `list` entry like any other.
- The phone's store port (`app/app_store.js` in step 4; the reference phone `poc/sim_phone.js` in step 3):
  - no `listOptions` (the core reads `lists_json`);
  - `addListOption(rec, seedRows)`: `listsJsonUpsert` on the local `lists_json` setting, persist that
    setting, push `{kind: 'list', rec: <rec without the seed>}` to the outbox only when the status is
    `ok`, return `{status, key}`;
  - `setSettings(map)` (a pull or bootstrap replacing the Settings map): store the map, then for every
    `list` entry still in the outbox, in outbox order,
    `r = listsJsonUpsert(<lists_json of the stored map, or ''>, rec.list, legacyListRows({store: <this phone's store port>}, rec.list), rec)`
    and keep `r.raw` as `lists_json`; persist once. (The seed is what the server itself seeds with while
    its list is empty, so a list that exists only as legacy Settings keeps all its options next to the
    pending one.)

## 9. The measurement book as a form in the app

### 9.1 Server and sync (step 3)

- `measureFields(ports, activeOnly)` (core_orders.js; changed in step 4) reads, in order:
  `store.listMeasureFields()` when present and non-empty; `Settings meas_fields_json` when it parses to
  at least one field (the phone); `CFG.MEASURE_FIELDS`.
- `syncSettingsFor` also sets `meas_fields_json` when the store has `listMeasureFields` and it returns at
  least one row: the JSON array of every row as `{key, labelMy, labelEn, group, multi, type, order, active}`.
- Store method `listAllMeasurements()`: every session, oldest first, each
  `{id, customerId, orderId, day, staffId, source, notes, fields}` (gas_store.js: one line over the
  existing reader; poc/sim_ports.js over `world.measurements`).
- Pull. The request cursor may carry `measAfter` (a number). Only when it does and the store has
  `listAllMeasurements`, `syncBuildPull` returns `measurements` = the sessions whose numeric id
  (`M-00041` gives 41) is greater than `measAfter`, ascending, at most `SYNC.MEAS_PAGE` (100), each as
  `{id, n, customerId, orderId, day, notes, fields}` with blank fields left out, and `measNext` = the
  highest `n` sent (or `measAfter`). While sessions remain beyond the page, the reply's `more` is `true`
  (the flag the ledger paging already uses), so the existing client loops fetch the next page in the same
  sync; checksums are still compared on the last page only. `syncApplyDelta` upserts each session and
  advances `cursor.measAfter` **only when** the local store has `upsertMeasurement`; such a store starts
  its cursor with `measAfter: 0`. After a successful bootstrap the client runs one sync (`syncNow()` in
  the reference phone, `scheduleSync(0)` in the app), so the sessions are on the phone before the form is
  first opened.
- Entry `{kind: 'measurement', rec: {customerId, orderId, day, staffId, source, notes, fields}}`.
  - Validation: `rec` an object; `customerId` a non-empty string; `fields` an object with 1..80 keys,
    every key matching `/^[A-Za-z0-9_]{1,40}$/`, every value a string of at most 60 characters; `notes`
    absent or a string of at most 300; `day` a valid day key; `orderId` `''` or an order id by `isOrderId`
    (else `MALFORMED`); `String(rec.staffId) === String(device.staffId)` (else `STAFF`). A server store
    without `addMeasurement`: `BAD_KIND`.
  - Apply (store methods only): an unknown customer is `MALFORMED` (a customer created offline arrives
    earlier in the same batch as a `customer` entry). Duplicate rule: when **any** stored session of that
    customer has the same `day`, `staffId`, `notes` and the same non-empty fields, answer `dup` with that
    session's id. Otherwise: when `orderId` names an existing order of the same customer, the session is
    stored with that `orderId` and the order gets `measId`; in every other case the session is stored with
    `orderId: ''`. `store.addMeasurement({customerId, orderId, day, staffId, source: CFG.MEAS_SOURCE.FORM, photoUrl: '', notes, fields})`.
    Result `{kind: 'measurement', entryId, status, id}`.
  - `syncApplyPushResults`: for a `measurement` entry, `ok` or `dup` calls
    `localStore.measurementSynced(e.rec.customerId, r.id)`; `quarantined` calls
    `localStore.measurementRejected(e.rec.customerId)`; each when the local store has the method.
- LOCAL STORE CONTRACT additions, the same names on the reference phone (`poc/sim_phone.js`, step 3) and
  the app store (`app/app_store.js`, step 4):
  - `upsertMeasurement(rec)` (from a pull): keeps a pending local record over a server one, otherwise
    keeps the higher `n`.
  - `saveMeasurementLocal(rec)`: writes the newest-session record of that customer with `pending: true`
    and pushes `{kind: 'measurement', rec}`.
  - `measurementSynced(customerId, id)`: when no other `measurement` entry of that customer is left in
    the outbox, set `id`, `n` (the number in the id) and `pending: false`; otherwise leave it pending.
  - `measurementRejected(customerId)`: when no other `measurement` entry of that customer is left in the
    outbox, delete the local record and set `cursor.measAfter = 0`, so the next pulls bring back the
    server's sessions.
  - The store port's `listMeasurements(customerId)` returns `[that record]` or `[]` (so the core's
    `latestMeasurement` works).

### 9.2 Core hooks (core_bot.js, step 4)

- `measureFormEnabled(ports)`: `!!(ports.ui && ports.ui.measureForm)`.
  `measureEnabled(ports)`: `ordersEnabled(ports) || measureFormEnabled(ports)`.
- `startMeasureFor`: its **first** statement is
  `if (measureFormEnabled(ports)) { clearState(ports, uid); return ports.ui.measureForm({chatId: chatId, uid: uid, customerId: customerId, orderId: orderId || '', staff: staff}); }`
  (no measurement token and no `latestMeasurement` call before it).
- `startMeasure`: an order-id argument is honoured only when `ordersEnabled(ports)`, otherwise `expired`.
- Routing: in `handleCallback` the `ORDER_ACTIONS` gate lets `MS` through when `measureEnabled(ports)`;
  `menuAction` case `meas` tests `measureEnabled(ports)`; in `handleText` and in `handleIntent`'s
  transcript section a `meas_pick` state goes to `measPickNamed` when `measureEnabled(ports)`. Every other
  measurement and order action stays gated on `ordersEnabled`.
- Menu: when orders are not enabled but the form is, the fourth row shows `btn_measure` = `M|meas`.
- Customer card: a `btn_measure` = `MS|<customerId>` button when `measureEnabled(ports)`.

### 9.3 The app (app/, step 4)

- **Fix first**: the overlay element gets its class in both pages,
  `<div id="overlay" class="overlay" hidden></div>` (app/index.html, app/dev/index.html). Today the
  `.overlay` rule matches nothing and both keypads open behind `#app`, invisible. Section 3.2 depends on it.
- `APP_DB_VERSION` 2; new store `{name: 'measurements', keyPath: 'customerId'}` (added to `APP_STORES`,
  `load()` and `wipe()`), holding the newest session per customer:
  `{customerId, id, n, day, notes, fields, pending}`. The store implements the section 9.1 contract and
  section 8's `addListOption` and `setSettings`.
- `ports.ui`: `phone.ports.ui = { measureForm: function (req) { emit('measureform', req); } }` in
  app_ports.js; app_ui.js listens with `phone.on('measureform', ...)` and opens the form.
- The form is **not** drawn into `#overlay` (the keypads clear that element, and the dev page keeps it
  inside the phone frame). It is its own element `div#measForm.formpage`
  (`position: fixed; inset: 0; z-index: 32; overflow-y: auto; background: var(--bg)`; inner column
  `max-width: 900px; margin: 0 auto`), appended to `document.body` when it opens and removed when it
  closes. Contents:
  - a header with `ui_meas_title {customer}` and a close button;
  - an optional voucher input (`ui_meas_voucher`): digits alone are turned into the id with
    `orderIdFor(staff.shop, digits)` and the id is shown under the input; any other text that is not
    `isOrderId` is dropped with a toast;
  - the active fields from `measureFields(ports, true)` under `measGroupLabel` headings: one text input
    with `inputmode="decimal"` per number field; a field with `multi > 1` gets `multi` such inputs side
    by side, joined with `/` on save (trailing empty parts dropped, an empty middle part kept as an empty
    position) and filled from `value.split('/')` for the pre-fill (the decimal keypads of phones have no
    `/` key); a plain text input for text fields; a two-button toggle for the key `htamein_side` that
    shows and stores `t(ports, 'btn_left')` and `t(ports, 'btn_right')` (a stored value that is neither is
    shown as text);
  - a notes box (`ui_meas_notes`);
  - pre-fill from `latestMeasurement(ports, customerId)`, with `ui_meas_prev {date}` shown and a
    `ui_meas_clear` button that empties the inputs;
  - a fixed bottom bar with `ui_meas_save`; Enter moves to the next input and never submits;
  - one column below 700 px width, two columns from 700 px.
- Draft: every change is kept (`store.cachePut('measdraft:' + customerId, <JSON>, 86400)` with a debounced
  `phone.commit(...)`), restored when the form opens again for that customer, removed on save. Closing a
  form that has typed values asks once. The service-worker update waits while a form is open.
- Save: each value through `normMeasValue`; at least one non-empty value, else the toast
  `ui_meas_empty`; then `saveMeasurementLocal`, close the form, `phone.botSay(t(ports, 'meas_saved_form', {customer, n}))`,
  then `phone.commit('meas')` and, when it resolved, `APP.sync.scheduleSync()`.
- `appInputModeFor`: `meas_pick` gives `'text'` with or without a step.
- app/app_sync.js `pendingLines`: lines for the new kinds, `ui_pending_list` and `ui_pending_meas`.
- The dev page (`app/dev/index.html`) calls `simSeedLists(world)` after `seedSimWorld`.

## 10. What is deliberately not built

- A split between two bank accounts with no cash part; splitting a PAYMENT, a DEPOSIT or a delivery in
  one step (two entries already do it: two payments, a second advance, an advance before the delivery).
- Attaching a customer after a split: attach first, then split (the card says how to correct).
- Renaming, hiding or reordering options in the bot: the laptop does that in the Lists tab.
- The HtmlService measurement form; a PC console.
- Orders in the app (`ordersEnabled` stays false there); a session saved by the form links to a voucher
  only through the typed voucher number.

## 11. New messages

core_messages.js `MSG` (step 1 adds all of them):

```
btn_split: '💵+🏦 ခွဲပေး'
split_ask_bank: '💵+🏦 ဘယ်အကောင့်နဲ့ ခွဲပေးလဲ? (ပေးငွေ {cash})'
split_ask_amount: '💵+🏦 {method} နဲ့ ဘယ်လောက်လဲ? ဂဏန်း ရိုက်ပါ (ပေးငွေ {cash} · ကျန်တာ ငွေသား)'
split_done: '💵 {cashMethod} {cash} · 🏦 {method} {bank} · မှတ်ပြီး'
split_hint: 'ℹ️ ပြင်ချင်ရင် ↩️ မှားသွားတယ် နှိပ်ပြီး ပြန်ရောင်းပါ'
split_hint_late: 'ℹ️ ပြင်ချင်ရင် ဆိုင်ရှင်ကို ပြောပါ'
split_bad: '❓ ၁ မှ {max} အတွင်း ဂဏန်း ရိုက်ပေးပါ'
split_no_bank: 'ℹ️ ဘဏ်အကောင့် မရှိသေးပါ။ အရင် ထည့်ပါ။'
btn_add_bank: '➕ ဘဏ်အသစ်'
btn_add_cat: '➕ အမျိုးအစားအသစ်'
btn_add_option: '➕ အသစ် ထည့်'
add_ask_pm: '✏️ ဘဏ်/အကောင့် နာမည် ရိုက်ပါ (ဥပမာ KBZ ဦးမောင်)'
add_ask_ec: '✏️ ကုန်ကျစရိတ် အမျိုးအစား နာမည် ရိုက်ပါ (ဥပမာ ရေဖိုး)'
add_ask_fb: '✏️ အထည် အမည် ရိုက်ပါ (ဥပမာ ဂျာစီ)'
add_done: '➕ "{label}" ထည့်ပြီး'
add_exists: 'ℹ️ "{label}" ရှိပြီးသား · အဲဒါကို သုံးပါမယ်'
add_unavailable: 'ℹ️ ဒီနေရာကနေ စာရင်းအသစ် ထည့်လို့ မရသေးပါ။ ဆိုင်ရှင်ကို ပြောပါ။'
btn_accounts: '🏛 အကောင့်'
acct_title: '🏛 ဘဏ်အကောင့်များ'
acct_line: '▫️ {label} · {detail}'
acct_none: 'ℹ️ ဘဏ်အကောင့် မရှိသေးပါ။ ➕ နဲ့ ထည့်ပါ။'
btn_acct_number: '🔢 နံပါတ် ထည့်'
btn_acct_detail: '🔢 {label}'
acct_ask_detail: '🔢 {label} ရဲ့ အကောင့်နံပါတ် (သို့) ဖုန်းနံပါတ် ရိုက်ပါ (ဥပမာ 09 777 123456 ဦးမောင်)'
acct_detail_saved: '✅ {label} · {detail} မှတ်ပြီး'
acct_detail_hint: 'ℹ️ {label} ရဲ့ နံပါတ် ထည့်ထားရင် အကြွေးကျန်တဲ့ ဘောက်ချာမှာ ငွေလွှဲရန် ပါလာပါမယ်။'
receipt_transfer: 'ငွေလွှဲရန် · {accounts}'
summary_accounts: '   🏦 {list}'
note_split: 'ခွဲပေး'
btn_create_design: '➕ "{code}" အသစ် ဖန်တီး'
design_created: '🎨 {code} ဖန်တီးပြီး · စျေးနဲ့ ပုံကို နောက်မှ ထည့်နိုင်ပါတယ်'
meas_saved_form: '📏 {customer} · အတိုင်းအတာ {n} ခု သိမ်းပြီး'
lists_note_list: 'ဘယ်စာရင်းလဲ ရွေးပါ · pay_method = ဘဏ်/Pay အကောင့် · expense_category = ကုန်ကျစရိတ် · fabric = အထည်'
lists_note_key: 'ကုဒ် (အင်္ဂလိပ် စာလုံး/ဂဏန်း ၁၂ လုံးအထိ) · သုံးပြီးသား ကုဒ်ကို ဘယ်တော့မှ မပြင်ပါနဲ့'
lists_note_label: 'ခလုတ်မှာ ပေါ်မယ့် နာမည် · ပြင်လို့ ရပါတယ်'
lists_note_active: 'အမှန်ခြစ် ဖြုတ်ရင် ခလုတ် ပျောက်ပါမယ် · စာရင်းဟောင်းတွေ မပျက်ပါ'
lists_note_order: 'ခလုတ် အစီအစဉ် · ဂဏန်း ငယ်တာ အရင်'
lists_note_shop: 'S1 သို့မဟုတ် S2 · ကွက်လပ်ထားရင် ဆိုင် နှစ်ဆိုင်လုံး'
lists_note_detail: 'ဘဏ်အကောင့်: အကောင့်နံပါတ်နဲ့ နာမည် (အကြွေးကျန် ဘောက်ချာမှာ ပါမယ်) · ကုန်ကျစရိတ်: emoji'
lists_note_note: 'မှတ်ချက်'
```

(`btn_accounts`, `acct_title` and `acct_line` deliberately avoid a leading `🏦 `; `summary_accounts` starts with spaces, so `stripMethodLines` never matches it.)

app/app_i18n.js (step 4, `ui_` prefix): `ui_meas_title` '📏 {customer} · အတိုင်းအတာ',
`ui_meas_voucher` 'ဘောက်ချာ နံပါတ် (မရှိရင် မထည့်ပါနဲ့)', `ui_meas_notes` 'မှတ်ချက်',
`ui_meas_prev` '📋 အဟောင်း {date}', `ui_meas_clear` '🔄 အသစ် တိုင်း', `ui_meas_save` '✅ သိမ်း',
`ui_meas_empty` '❓ အတိုင်းအတာ တစ်ခုခု ထည့်ပါ', `ui_meas_close_ask` 'ရိုက်ထားတာတွေ မသိမ်းဘဲ ပိတ်မလား?',
`ui_meas_bad_voucher` '❓ ဘောက်ချာ နံပါတ် မမှန်ပါ', `ui_pending_list` '➕ စာရင်းအသစ် · {label}',
`ui_pending_meas` '📏 အတိုင်းအတာ · {customer}'.

## 12. Tests

**poc/run_lists.js** (new, step 1; loads the core files, sim_mock_ai.js, sim_ports.js, sim_seed.js):
- `legacyListRows` equals today's lists for all three names (also with custom Settings and a Messages
  label); `listRows` source order (store, `lists_json`, legacy), the per-list fallback, invalid JSON, the
  read-only memo (mutating a returned row never changes the next call; two worlds with the same raw
  string stay independent); normalisation (key case, blank key skipped, repeated key skipped, a key with
  `|` skipped and logged, blank label, order 0 last, shop); `listOptions` filters and sort; `payMethods`
  with a shop, the 12-byte drop and log, the cap, and today's value without lists; `methodLabel` for an
  inactive row and for a key with only a Messages label; `methodKnown`; `expenseEmoji`; the existing
  `categoryEmoji('dress')` still returns the item emoji.
- `listUpsert`: seed when empty; append; label-less absent key is `dup`; the detail rule (blank, same,
  `detailWas` equal, `detailWas` stale); case-insensitive keys; order numbering. `listHash` is stable;
  `listKeyFor` shape, starts with a letter (label `09 777 123456`), same key for the same name on two
  worlds, a clash with another label takes the uuid path, reserved names. `addListOptionByLabel` created,
  existed (case, spacing, a zero-width space), empty, a digits-only label, unavailable, and
  seed-on-first-add (adding one category to a store without lists keeps all the old ones).
  `setListDetail` saved, unchanged, stale. `methodKeyFor`. `transferLines` and `transferLine`.
  `listsJsonFor` and `listsJsonUpsert` round trip. `aiContextText` with pairs, with plain keys and with
  no `payMethods`.
- `rewriteGroup` unchanged after the refactor: before editing core_ledger.js, copy today's function into
  poc/run_lists.js as `legacyRewriteGroup`. The check runs both on two identically seeded worlds with
  `world.ports.uuid` replaced by a counter and `world.nowOverride` fixed, and requires the returned rows
  and the appended ledger rows to be equal in every field, for: a method change, a cash change on a SALE
  (clamped), a customer attach, a note, a category, `noteIfBlank`, and `source` plus `transcript` in opts.
- `splitSale` on a 30,000 cash sale with 20,000 KBZ: three rows appended in the sale's group in the order
  mirror, replacement, PAYMENT; every row carries the staff id; `saleGroupInfo` owed 0; `openCredits`
  unchanged; `dayStats` CASH net +10,000 and KBZ +20,000; `groupMethods` and the receipt text mixed; one
  receipt number; `rewriteCheck` now refuses; `undoGroup` nets every bucket to 0 and restores stock.
  `bank >= cash` is a plain method rewrite (mirror and replacement appended, one live row, no PAYMENT).
  A sale marked KBZ then split 20,000 KBZ of 30,000: replacement CASH 10,000, PAYMENT KBZ 20,000; another
  KEY is refused with `method`. Refusals (`amount`, `method` for CASH and an unknown key, a locked group,
  a RETURN row, a group with a deposit applied). A split on a credit sale keeps owed and the customer.
- Receipts: `r.transfer` only with owed > 0, not voided, and a detail; the PDF data has one account per
  footer line. The daily summary's account line only with two or more accounts moved. The day report
  prints `note_split`.

**poc/run_sync.js** (appended): step 1: `lists_json` in the bootstrap and in a pull only when the hash
changed; a Lists edit changes the hash; a hand-typed `lists_json` Settings row is not passed through.
Step 3: the `list` kind (ok, dup, each malformed variant, a server without the method, a throwing store
answered `retry` while the batch's sale group is applied); the phone's offline add visible at once,
surviving a pull that arrives before the push (on a world without Lists rows the phone still offers KBZ,
WAVE and BANK together with the option it added), and appearing on a second phone after sync; two phones
adding the same name offline end with one row; a stale `detailWas` does not overwrite; the split's three
rows in one entry answered `ok`, not quarantined, with no OVERPAID flag; `meas_fields_json`; the
`measurement` kind (ok, dup on a retry, dup against an older session, staff mismatch, unknown customer,
bad fields, the voucher link only for the same customer and the stored `orderId` blank otherwise); a
quarantined measurement leaves no pending record and the earlier server session is back after the next
sync; with 250 sessions on the server one `syncNow` of a fresh phone ends with all applied and
`latestMeasurement` equal to the server's for every customer. Step S18 stays green unchanged.

**poc/run_round4.js** (new, step 2; a world seeded with `simSeedLists`):
- After-sale keyboard layout with 2, 4 and 7 accounts, a long label, a per-shop account; the split and
  add buttons in their own last row; every method screen keeps its cancel row.
- Split: half, all, a typed amount, a spoken amount, one account only (no account screen), no account
  (the ➕ path), the sale marked with an account first (no account screen; the amount screen names that
  account; day stats CASH +10,000 and that account +20,000), a typed amount out of range (state kept), a
  stale tap, a double tap, SX then cancel (the sale card still has its text and `btn_undo`), the result
  naming the item and the total on the button path and on the typed path, the late hint after the undo
  window.
- ➕: bank from the sale card (the sale is marked; the resumed card is the last bot message and carries
  `btn_undo`, `btn_receipt` and the number button); bank inside the split; bank on the expense method
  screen commits one expense; category continues to the amount screen; an existing name is reused; a
  digits-only name asks again; the add button tapped twice then the name gives exactly one option and one
  expense; the add button on yesterday's sale card answers the today-only refusal and asks no name; a
  resume whose state is gone says `expired` after the prefix and writes nothing; add on a sale card then
  cancel leaves the card unchanged; a store without `addListOption` answers `add_unavailable` at the tap
  and the tapped screen keeps its buttons; a spoken money intent in the add state is handled as the
  intent; bank at delivery and at refund; a seller (not the owner) adds a bank.
- Accounts screen: lines, the number entry, cancel saves nothing, a wrong number retyped and the receipt
  showing the new one, a voice note in the detail state saves nothing.
- Transfer line on a credit receipt and on an order voucher with a balance; still there after a method
  tap on the voucher reply; none on a cancelled order's voucher; none when owed is 0.
- Fabric by key, a stale index button, ➕ fabric. Design codes: a typed `31` and a typed Burmese name
  offer no create button; `tsl 31` creates `TSL-31`; create tapped twice shows the price screen twice and
  one Designs row.
- Voice: method by label, including a label that contains a holder's name.
- Every callback under 64 bytes; the two-tap sale unchanged.

**poc/run_gas.js** with **poc/fake_gas.js** (new, step 2):
- fake_gas rules. (a) Strict: every fake object throws `fake_gas: <Class>.<member> is not modelled` for a
  member outside this list: SpreadsheetApp {getActiveSpreadsheet, openById, flush, ProtectionType,
  newDataValidation, newConditionalFormatRule}; Spreadsheet {getSheetByName, insertSheet,
  setSpreadsheetTimeZone, getId, getUrl}; Sheet {getName, getSheetId, getLastRow, getLastColumn,
  getMaxRows, getMaxColumns, insertColumnsAfter, getRange (row, column, rows, columns and the forms
  'A:A', 'A1'), getDataRange, appendRow, deleteRow, clear, clearContents, setFrozenRows, hideSheet,
  setColumnWidth, getProtections, protect, setConditionalFormatRules, getConditionalFormatRules}; Range
  {getValues, getValue, setValues, setValue, setFormulas, setNumberFormat, setFontWeight, setFontSize,
  setDataValidation, setNote, insertCheckboxes, getSheet, getRow, getColumn}; Protection {setDescription,
  setWarningOnly}; DataValidationBuilder {requireValueInList, requireCheckbox, requireFormulaSatisfied,
  setAllowInvalid, setHelpText, build}; ConditionalFormatRuleBuilder {whenFormulaSatisfied, setBackground,
  setFontColor, setRanges, build}; Lock {waitLock, releaseLock}; Properties {getProperty, setProperty};
  Cache {get, put, remove}; Utilities {getUuid, computeDigest, DigestAlgorithm, Charset, formatDate};
  Logger {log}. (A member the existing code really calls and that is missing here is added to the fake
  and named in the report.) (b) Values behave like Sheets: a string written to a cell whose format is not
  `@` becomes a number when it looks like one (09777123456 becomes 9777123456) and a boolean for TRUE or
  FALSE; `@` cells keep strings; `insertCheckboxes` sets every cell of its range to false; `setValues`
  with the wrong dimensions throws; formulas are kept as text and never evaluated. (c) LockService as
  documented: `waitLock` on a held lock does nothing, `releaseLock` frees it; the fake counts acquires
  made while held and exposes whether the lock is held. (d) `newExecution()` loads the bundle into a
  fresh vm context over the same fake spreadsheet, properties and cache; every simulated request and
  every hand edit starts one.
- run_gas.js builds the bundle in memory from the file list of tools/bundle_gas.js. The environment
  variable `RUN_GAS_BOT_FROM` may name a folder to take `core_bot.js` and `core_orders.js` from (the Google
  glue builder uses the backup folder while the Bot builder edits those two files in parallel); without
  it the project's files are used.
- Checks: `setupSheet` on an empty spreadsheet (Lists created and seeded, every seeded row active) and a
  second run (nothing changes; validation and conditional-rule counts equal; rows still active);
  `setupSheet` on a version-3 spreadsheet with custom `pay_methods`, `expense_categories` and a
  `method_AYA` message (seeded from them); `gasStore.listOptions` (a row holding false is inactive, a
  hand-typed row with a blank Active is active and holds true after `onEdit`); `addListOption` (append,
  detail rules, dup, seed when the list is empty, tab missing; the stored Detail `09777123456` is that
  string); `addDesign`; the Dashboard's account rows carry exactly the formula texts of section 1.5 and
  the category block lists an inactive category; `onEdit` on Lists rewrites the Dashboard, and for
  another tab makes no Sheet or Range call; the dirty flag (one rewrite per request, none when clear);
  `syncSettingsFor` over the real `gasSyncStore` carries `lists_json`; one `sync` call through the real
  sync handler with a push of [list entry, sale group, measurement entry] (step 3 adds the last): the fake
  LockService reports no acquire while held and the lock is held at every write to the Ledger tab; every
  existing lock user still takes the lock exactly once when called alone.

**poc/run_app.js** (appended, step 4): DB version 2 with the new store in `APP_STORES`, `load()` and
`wipe()`; `addListOption`, the outbox entry only on `ok`, and the pending-aware `setSettings` with the
seed (after such a pull the phone's method buttons show the old accounts and the pending one);
`saveMeasurementLocal`, the outbox entry, the server row, `measurementSynced`; a quarantined measurement
leaves no pending record; `listMeasurements` feeding `latestMeasurement`; `upsertMeasurement` rules;
`M|meas`, `MS|new` with a typed name, `MS|create` and `MS|<customerId>` on the real app store each end in
one `ports.ui.measureForm` call and no logged error; the customer-card and menu buttons;
`appInputModeFor`; after ➕ bank from the sale card the last bot message is the sale card; a spoken name
queued offline, the same name then typed, the job replayed: one expense; a split with a typed amount on
the real app store.

**Manual browser checks** (Node cannot run them; the step-4 builder lists them in the report, the
orchestrator runs them): on the dev page the number keypad is visible and tappable (it is not today); a
split with a typed amount; the form in one column at phone width and in two columns from 700 px; Enter
moves to the next input; the three boxes of a multi-value field save `36/30/20`; the draft survives a
reload; `node tools/build_app.js` output loads.

## 13. Build steps and file ownership

Nobody edits a file outside their step's list. A needed change elsewhere goes into the report.

1. **Model** (first, alone): `core_config.js`, `core_ledger.js`, `core_messages.js` (every MSG key of
   section 11), `core_report.js`, `core_ai_prompt.js`, `core_sync.js` (only `syncSettingsFor` with
   `lists_json`), `core_orders.js` (only `fabricPresets` as a wrapper over `fabricOptions`),
   `poc/sim_ports.js`, `poc/sim_seed.js`, `poc/sim_mock_ai.js`, `poc/sim_sync.js` (the three list
   forwards only), `poc/run_lists.js` (new), `poc/run_sync.js` (the step-1 checks).
2. **Bot** and **Google glue**, in parallel after step 1:
   - Bot: `core_bot.js`, `core_orders.js`, `core_messages.js` (additions only), `poc/run_round4.js` (new),
     `poc/sim_ui.js` (a `Lists` tab in the Sheet pane, redrawn on the `lists` event; `simSeedLists` after
     `seedSimWorld`), `poc/simulator.template.html`, `poc/build_simulator.js`.
   - Google glue: `gas_store.js`, `gas_setup.js`, `gas_main.js`, `gas_sync.js`, `gas_gemini.js` (no change
     expected), `poc/fake_gas.js` (new), `poc/run_gas.js` (new).
3. **Sync** (after step 2 is verified): `core_sync.js`, `gas_store.js` (`listAllMeasurements` only),
   `poc/sim_ports.js`, `poc/sim_sync.js`, `poc/sim_phone.js`, `poc/run_sync.js`, `poc/run_gas.js`
   (additions).
4. **App** (after step 3): the source files under `app/` except `app/config.js`, `tools/build_app.js`,
   `core_bot.js` and `core_orders.js` (only section 9.1's `measureFields` change and section 9.2's hooks),
   `core_messages.js` (additions only), `poc/run_app.js`, `poc/run_round4.js` (the hook checks).
5. **Docs** (last, alone): `apps-script/README.md` (section H: the Lists tab replaces the `pay_methods`,
   `expense_categories` and `fabric_presets` paragraphs and wins once it has rows; section I: the
   deployment order and the `onEdit` note), `app/README.md` (the measurement form, enrolling a laptop
   browser and an iPad), `docs/USER-GUIDE.html`, `POS-PROJECT-PLAN.md` Appendix F.

Deployment order, for the README: publish the server (`node tools/publish.js bot "..."`), run
`setupSheet` once from the editor (creates the Lists tab), then publish the app.
