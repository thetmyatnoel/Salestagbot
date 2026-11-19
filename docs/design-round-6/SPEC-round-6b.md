# SPEC round 6b (binding): the sample sign, item categories the shop can grow, 📦 in Telegram's menu

Date 2026-11-18, **revision 2** (the same day, after the reviews `review-6b-b-data.md` and `review-6b-b-ux.md`). An addendum
to `SPEC-round-6.md` (revision 3 with the amendments F9b and F10b), written from the owner's second feedback
(`FEEDBACK-2.md`, decisions G1-G4). Every rule of SPEC-round-6.md binds unless a section below says it is replaced. Every
`file:line` is today's tree: rounds 4, 5 and 6 built and unpublished, nothing of 6b built. Rounds 4, 5, 6 and 6b ship
together; nothing is published before step 5 of section 6 is done. Backup of the tree before this round:
`C:\Users\USER\Desktop\Noel-backup\r6-built`.

`SPEC-round-6.md` itself is NOT edited: poc/run_app.js:1773-1780 and :1799, poc/run_wizard.js:1604-1613 and W39
(run_wizard.js:3040-3046) parse its blocks. Where it says something else, this file wins; 0.3 names the sentences.

Suite counts measured on the baseline (`node poc/<suite>.js`, all `0 failed`): run_scenario 327, run_round4 345, run_lists 236,
run_gas 336, run_sync 385, run_app 542, run_wizard 512, check_simulator 112, check_simulator_browser 13.

## Revision 2

Every finding of the two reviews was checked against the code. The two files reuse ids, so they are written "data B1" and
"ux B1" here. One claim was measured rather than read: a scratch copy of the tree with item_category added to `CFG.LIST_NAMES`
and to the first seed, which showed exactly which existing checks move (5.8), and then the same copy with those edits, which
was green again (run_gas 336, run_lists 236, the other suites and check_simulator unchanged).

| Finding | Verdict | What changed (section) |
|---|---|---|
| data B1 (major) LIST_LAZY hides the built-ins from the laptop | applied, in a simpler form | `LIST_LAZY` is dropped. item_category is last in `CFG.LIST_NAMES`, so the first seed of the Lists tab writes the five built-in rows after the round-4 lists (rows 18-22), and `simSeedLists` does the same with no code change. The every-run append that the review proposed is not built. No live Sheet has a Lists tab (the live bot is the 2026-11-03 build, `Noel-backup/deployed-v2-2026-11-03/Code.js`, which has no `ensureListsTab`), so the first setupSheet after the publish writes all four lists. The general merge is gone; only the catch-all is merged (by key). 20 run_gas checks and run_lists.js:354 are named, measured (2.3, 2.7, 5.8) |
| data B2 (major) a photo during the ➕ prompt is saved onto another item | applied | NEW `newItemStateOf`, used by `handlePhoto`, `toggleSample`, `newItemPrice`, `newItemCost` and `newItemFormState`; W44 (2.6, 5.2) |
| data B3 server and phone rename with different lists | applied | NEW `itemCategoryCats(ctx, ports, shop)`: the job's own `ctx.categories` on both sides; R6l (2.3, 2.8, 5.5) |
| data B4 a typed 'အခြား' row makes a dead catch-all chip | applied | the catch-all is merged by key only. A pick resolves against `itemCategoryOptions`, the same rows the chips and buttons came from (2.3, 2.5, 2.6) |
| data B5 the sample word is refused only by ➕ | applied | `itemCategoryRows` leaves out every row whose name contains it. `itemCategoryFind` refuses such a name. The simulator's laptop add goes through `addItemCategory` (2.3, 5.7) |
| data B6 an old built-in name becomes the catch-all after a rename | applied | `itemCategoryOf` falls back to the row with the built-in's key (2.3) |
| data B7 the photo AI ignores the Shop column | applied | `itemCategoryAi(ports, shop)` takes the piece's shop at every caller (2.3, 2.8) |
| data B8 RT does not end a loop parked at the typed count | applied | NEW `restockLoopOf`: `RT`, `dropAddState`, the TTL and the intercept see both shapes of the loop (3.3) |
| data B9 a typed count goes to the AI | applied | at step `qty`, a typed 1..999 is the count. An out-of-range number gets `bad_qty` and the count screen again (3.3, W45) |
| data B10 the loop catches sale scans for ten minutes | applied, with ux M1 | the count screen gets [🛒 ရောင်းမယ် → `K\|<id>`]. A one-of-a-kind piece ends the loop and shows its card. TTL 180 s (`CFG.RESTOCK_LOOP_TTL_SEC`) (3.2, 3.3) |
| data B11 a restored draft saves a category no chip shows | applied | the view resolves `catKey` against the offered chips. Save stores only that category, else the catch-all (2.5, step 83) |
| data B12 the Lists tab never explains item_category | applied | NEW Messages key `lists_note_item_category` is appended to the List header note; run_gas.js:466 is named (2.7, 4.1, 5.8) |
| data B13 sync can duplicate a category name | applied on the read side | `itemCategoryRows` shows a name once (the first row wins). `syncApplyListEntry` is unchanged, so core_sync.js is not touched (2.3, 2.7) |
| ux B1 (blocker) `round6f` already exists | applied | the new steps go in `round6h`, called at the end of `round6g` after step 79 (5.6) |
| ux M1 the loop takes over every scan | applied | as data B10 (3.2, 3.3, W45) |
| ux M2 a typed count is not the count | applied | as data B9 (3.3, W45) |
| ux M3 checks that pass without their feature | applied | W43 adds the notebook's matches and `saleScreenAdd`. W44 adds `handlePhoto`'s list, `buildAiContext`, the notebook context and `attachTagToItem` (5.2) |
| ux M4 no check of the loop in the app under quick | applied | run_app step 85. 3.3 says how the app types a tag (Scan, then the keypad). The count card's '·' line is accepted: a chat card is a core text (13.1 rule 3), as `restock_done` already is (3.3, 5.6) |
| ux M5 the guide's app section | applied | :250 gets the plus chip and :252 the switch, its hint and the badge. The 🎨/🧵 box goes beside :379 (Telegram), with one sentence in app words (6, step 5) |
| ux M6 a retired name is reused silently | applied: refused | `itemCategoryFind(ports, label, shop)` answers `closed` for a match the shop's chips do not offer. NEW `add_ic_closed` (2.3, 2.5, 2.6, W4, W44, step 82) |
| ux m1 step 6c collides | applied | the new check_simulator step is 6e (5.7) |
| ux m2 RT is missing from the bench's answer() | applied | W45 taps through the bench's `tapData` (5.2) |
| ux m3 ✖️ in the loop ends the whole loop | applied | in the loop, ✖️ is `RT\|skip`: back to the ask, the loop kept (3.2) |
| ux m4 ✏️ in the loop shows a price example and has no range | applied | NEW `restock_type_qty`. The count typed in the loop is checked against 1..999 (3.3) |
| ux m5 a hand-typed 'နမူနာ' row is offered | applied | as data B5 |
| ux m6 an emoji in a label reaches the app | applied in the app | the item view's `sub` goes through `appPlain`. In Telegram, the doubled emoji of a label the family typed with one is accepted (2.8 row 15, 7) |
| ux m7 long chips overflow a phone | applied | the category chips wrap (2.5) |
| ux m8 the switch's name and contrast | applied | `aria-label` is `ui_lbl_sample`, and NEW token `--good-ink` for `.switch.on`. The guide explains ဖွင့်/ပိတ် against ဟုတ်/မဟုတ် (1.2, 6) |
| ux m9 two labels go stale | applied | run_wizard.js:2051 and :2079 are label-only edits (5.8) |
| ux m10 the simulator's Lists tab | applied | step 4 owns sim_ui.js:820-875 (5.7, 6) |
| ux m11 the start() caption is wrong in the loop | applied | tgrestock gives its start steps their own captions (5.7) |
| ux m12 the live hint | partly applied | the sample and closed answers show live, and the field takes focus. '·' in the hint is accepted, as the form's .fmsg already shows `basket_other_shop`. Rejected: selecting a chip while the name is still being typed (the mode would switch under the seller's finger; Save already uses the existing row) (2.5) |
| ux m13 hand-typed rows need a short Key | applied | the README, the guide and `lists_note_item_category` say to add with ➕, or to give an ASCII Key of at most 12 bytes (2.7, 6) |
| ux m14 the AI is offered other shops' categories | applied | as data B7 |
| ux m15 a refusal re-asks without naming ✅ | applied | `restockAsk` chooses its text from `n` (3.3) |
| ux m16 new categories sort after the catch-all | applied | the catch-all is always the last option (2.3) |
| (reviser) run_lists.js:622 | named | adding a fourth name to `CFG.LIST_NAMES` adds `item_category: []` to `listsJsonUpsert`'s output (measured). Revision 1's 5.9 missed it (5.8) |
| (reviser) row 7 of 2.8 | corrected | the notebook's AI call is in `handleNotebookPhoto` (core_bot.js:2525), not in a `startNotebook` |
| (reviser) step ownership | changed | the run_gas seed edits belong to step 1, the step that changes `CFG.LIST_NAMES` and gas_setup.js. Step 1 and step 2 share run_gas.js in sequence, in disjoint regions (6) |

---

## 0. Decisions

### 0.1 G1-G4 (binding, FEEDBACK-2.md), with these refinements

- **G1 The sample has its own sign and says what it is.** Telegram's toggle reads `🎨 နမူနာ: ဟုတ်` / `🎨 နမူနာ: မဟုတ်`
  (two changed MSG texts, 4.2; 🎨 is already the design sign, `ord_ask_design` core_messages.js:224); 🧵 stays the
  အခြား category's emoji (core_config.js:27). In Telegram a sample's item card and every item row lead with 🎨 instead of
  the category emoji (`itemEmoji`, 2.3); the text mark `sample_mark` ' (နမူနာ)' (core_messages.js:13) stays, so the
  reports keep printing text. In the app the sample row is a real switch (`.switch`, `role="switch"`, named 'နမူနာ')
  labelled 'နမူနာ' with the one-line hint `ui_sample_hint`; a sample piece shows a small text badge 'နမူနာ' (F7: no emoji)
  on the tiles, the sale form's line and the item view. setupSheet rewrites the two old toggle texts in the live Sheet's
  Messages tab (1.3). The guide explains sample versus အခြား (6, step 5).
- **G2 Item categories become a list the shop can grow.** A fourth Lists-tab list `item_category` (code `ic`), last in
  `CFG.LIST_NAMES`, seeded from `CFG.CATEGORIES` with fixed keys and their emojis in Detail by the Lists tab's first seed
  (2.7), read through the round-4 machinery (store, lists_json, the per-list legacy fallback) and synced through the existing
  `list` entry. A category is stored on the item **by its name, as today** (2.2 says why). The app's new-piece form shows the
  shop's active categories as chips (the catch-all always last) and a last chip (plus icon) အမျိုးအစားအသစ် (`btn_add_cat`
  plain: the word table's words for "add a category", SPEC-round-6.md 13.1, for G2's draft "+ အသစ်") that opens a name field;
  Save adds the category in the same commit and uses it. Telegram's new-piece card gets `➕` on its category screen through
  the round-4 `LA|` pattern (resume `NIC`). Anyone who registers pieces may add; a name the owner closed (unticked, or limited
  to another shop) is refused, not reused; the owner renames, retires and orders on the laptop's Lists tab from the first
  setupSheet on. Every reader keeps working with a custom category (2.8).
- **G3 Telegram's menu gets 📦 ကုန်ရောက်** (`M|restock`, in both channels). In Telegram (and in the app under `quick`)
  it asks for the tag; a scanned or typed tag shows the restock count screen of that item; a count is a preset, a typed
  number or ✏️; after each save the bot offers the next tag or `✅ ပြီးပြီ`. The loop never traps a sale: its count screen
  carries 🛒 ရောင်းမယ် (the item card), a one-of-a-kind piece ends it, and it expires 180 s after its last prompt. The app with
  forms keeps opening its restock form. Four existing checks change (3.6).
- **G4** Round 6's rules bind (SPEC-round-6.md 0.4, 13.1, 13.12 F10b): ES5 in `core_*.js`, `app_*.js`, `sim_*.js`; one global
  scope; every new global grepped (0.2); callback data at most 64 bytes; append-only ledger; `gasLocked`; no new file under
  `apps-script/`; `app/config.js`, `tools/publish*.js`, `acc.txt`, `survey.txt` untouched; F7/F8 in the app; F10b (no new
  two-shop assumption: every shop loop reads `CFG.SHOP_IDS`, the tag default uses `CFG.SHOP_IDS[0]`); existing checks change
  only where 5.8 names them; every new check fails without its feature; invisible characters only through
  `String.fromCharCode`. The simulator gets two tours (`newcat`, `tgrestock`, 5.7).

### 0.2 New names (every one grepped across `apps-script/`, `app/`, `poc/`, `tools/`, dist excluded, on 2026-11-18: free)

| Kind | Names |
|---|---|
| core functions (core_ledger.js) | `listPick`, `itemCategoryRows`, `itemCategoryOptions`, `itemCategoryOf`, `itemCategoryFallback`, `itemCategoryPick`, `itemCategoryAi`, `itemCategoryCats`, `itemCategoryEmoji`, `itemEmoji`, `itemCategoryFind`, `addItemCategory` |
| core functions (core_bot.js) | `restockAsk`, `restockLoopOf`, `restockLoopTag`, `restockLoopSave`, `restockQtyScreen`, `newItemCatAdded`, `newItemStateOf` |
| app function (app_ui.js) | `appSampleBadge` |
| CFG members | `ITEM_CATEGORY_KEYS`, `ITEM_CATEGORY_NEUTRAL`, `SAMPLE_EMOJI`, `SAMPLE_WORD`, `RESTOCK_LOOP_TTL_SEC`; new values in `LIST_NAMES`, `LIST_CODES` (`ic`), `LIST_PREFIX` (`item_category: 'i'`). (Revision 1's `LIST_LAZY` is dropped.) |
| MSG keys | `add_ask_ic`, `add_ic_sample`, `add_ic_closed`, `restock_ask_tag`, `restock_more`, `restock_type_qty`, `restock_loop_done`, `btn_restock_done`, `btn_restock_sell`, `lists_note_item_category` |
| APP_MSG keys | `ui_lbl_sample`, `ui_sample_hint` |
| state, callbacks | state kind `restock_loop`; action `RT` (`RT\|done`, `RT\|skip`); ➕ resume `NIC`; list code `ic` (the string 'ic' appears elsewhere only as a CSS class) |
| list keys | `htamein`, `longyi`, `eingyi`, `wutsone`, `other` (row keys of `item_category`; 'htamein' and 'longyi' appear elsewhere only inside other identifiers and texts) |
| CSS, tours, tests | `.sbadge`, `.fswitch`, the token `--good-ink`; tour ids `newcat`, `tgrestock`; run_app's `round6h`; run_gas's helper `defaultItemCategories` |

### 0.3 What this file replaces in SPEC-round-6.md (read with it)

| SPEC-round-6.md | Replaced by |
|---|---|
| 1.5 table rows `category` (`cat:<i>`, CFG.CATEGORIES) and `sample` (toggle `btn_sample_off/on`); 7.8 new-piece names `cat:<i>`, `sample` | 1.2, 2.5 |
| 2.3 sub-screen row `category (cat)` (`NI\|<id>\|c\|<0..4>`, an index) and the card's `[🧵 နမူနာ: မဟုတ်]` | 1.1, 2.6 |
| 4.2 `aiRenameFields(item, desc)` ("only when CFG.CATEGORIES lists desc.category"), `commitNewItem` ("a category outside CFG.CATEGORIES becomes the last one") | 2.3 |
| 6.2 the server's and the phones' calls `aiRenameFields(cur, desc)` / `aiRenameFields(item, desc)` | 2.8 rows 10-12 |
| 13.11 "Telegram's rows are unchanged (run_round4.js:964 and :1126 pin them …)" and "Under quick … a restock starts from the scanned piece's card" | 3 |
| 13.15 "the app world of run_app.js:492 runs on quick, where `M\|restock` is not offered" | 3.1 (it is offered there now, the chat loop) |
| 13.17 the bullet "📦 in Telegram's menu" (left to the owner) | 3 (built) |

---

## 1. G1 The sample sign and its hint

### 1.1 Telegram

| Place (file:line today) | Today | Round 6b |
|---|---|---|
| the new-piece review card's toggle (`newItemCardKeyboard`, core_bot.js:3822) and the quick photo chain's toggle (`priceScreen`, core_bot.js:2402) | `btn_sample_off` '🧵 နမူနာ: မဟုတ်' / `btn_sample_on` '🧵 နမူနာ: ဟုတ်' | the same keys with the changed texts '🎨 နမူနာ: မဟုတ်' / '🎨 နမူနာ: ဟုတ်' (4.2); the callback `PS\|<id>` unchanged; `toggleSample` (core_bot.js:2406) reads its state through `newItemStateOf` (2.6) |
| the item card (`cardText`, core_bot.js:227-229: `{emoji} {id} · {name}` + `sample_mark`) | the category emoji, so an အခြား sample read '🧵 S1-0010 · ထမီ အသစ် (နမူနာ)' | the emoji is `itemEmoji(ports, item)` (2.3): 🎨 for a sample, the category's emoji otherwise: '🎨 S1-0010 · ထမီ အသစ် (နမူနာ)'; the mark ' (နမူနာ)' stays |
| item rows that start with an emoji: `showChoices` (M\|find, M\|recent, a spoken "which item", core_bot.js:1173), the notebook's matches (`presentNotebookLine`, :2545), the review card's add screen (`saleScreenAdd`, :2969), the review card's lines (`basketCardLine`, :2819) | `categoryEmoji(it.category)` | `itemEmoji(ports, it)` (`basketCardLine`: `itemEmoji(ports, it \|\| {})`, the neutral 🔖 when the item is missing) |
| the new-piece card's count line (`newItemCardText`, :3811) | '🔢 ၁ ထည်' + ' (နမူနာ)' | unchanged (the toggle right below it now carries 🎨) |
| the owner's price ping (`price_ask_owner`) | the name, no mark | unchanged (7) |

### 1.2 The app (F7: no emoji; the switch and the badge are text)

**The new-piece form's sample row** (`appNewItemRender`, app/app_forms.js:1491) becomes a switch row at the end of the
right column (`.fsplit` right at laptop width, last on a phone):

```
နမူနာ                                              [ ပိတ် ]      ui_lbl_sample · .switch (on: [ ဖွင့် ], .switch.on, green)
ဒီဇိုင်းဌာနက လုပ်တဲ့ နမူနာ ဆိုရင် ဖွင့်ပါ၊ အစီရင်ခံစာမှာ သီးသန့် ပြပါမည်      ui_sample_hint, muted small, always shown
```

- The control: `appFormBtn(F, 'sample', tt(v.sample ? 'ui_on' : 'ui_off'), {cls: 'switch', on: !!v.sample, role:
  'switch', checked: !!v.sample, aria: tt('ui_lbl_sample')})` inside `appH('div', {class: 'fsec fswitch'}, [appH('div',
  {class: 'kv'}, [appH('span', {class: 'k', text: tt('ui_lbl_sample')}), <the switch>]), appH('div', {class: 'muted small',
  text: tt('ui_sample_hint')})])`. The accessible name is 'နမူနာ' (`aria-label`, appFormBtn's existing `o.aria`,
  app_forms.js:749), its state is `aria-checked`. `ui_on` 'ဖွင့်' / `ui_off` 'ပိတ်' (app_i18n.js:128-129) are the AI switch's
  words, so the phone has one switch look (`.switch`, app.css:276-277); Telegram says ဟုတ်/မဟုတ် for the same flag, and the
  guide says so (6, step 5). The `data-f` stays `sample`, `appNewItemSet`'s `case 'sample'` (app_forms.js:438) is unchanged,
  and the RESTOCK note 'new sample' is unchanged (core_ledger.js:1131).
- `appFormBtn` (app_forms.js:747-756) gains two options: `o.role` → the attribute `role`, `o.checked` (when not `undefined`)
  → `aria-checked` 'true' / 'false'. Every existing call passes neither, so its markup is unchanged.
- **Contrast** (review m8): `.switch.on` is white on `--good` #6FCF97 in dark mode (about 1.9:1). NEW token `--good-ink`,
  as `--accent-ink` is done (app.css:9, :21, :29): `#FFFFFF` on `:root`, `#13151D` in both dark blocks; `.switch.on { color:
  var(--good-ink); }` (app.css:277). The AI switch gets the same fix.

**The badge.** NEW `appSampleBadge()` (app/app_ui.js, beside `appTiles`): `appH('span', {class: 'sbadge', text:
APP.tt('ui_lbl_sample')})`. It replaces the text mark ' (နမူနာ)' in the app's four places:

| Place (file:line) | Today | Round 6b |
|---|---|---|
| home recent tiles (`appTiles`, app_ui.js:705) | `.nm` = name + plain `sample_mark` | `.nm` = `appH('span', {class: 'nm'}, [appH('span', {text: it.name})].concat(it.sample ? [appSampleBadge()] : []))` |
| the forms' recent tiles (`appFormTiles`, app_forms.js:1315) | the same | the same rule |
| the sale form's line name (app_forms.js:1346) | ' · ' + name + mark | ' · ' + name, then `appSampleBadge()` for a sample |
| the item view (`appItemView`, app_screens.js:713; drawn by `appViewNode`, :810) | `title` = name + plain mark | `title` = `it.name`; NEW field `badge` = `it.sample ? tt('ui_lbl_sample') : ''`; `appViewNode` draws `.vtitle` as the title span followed by `<span class="sbadge">` when `v.badge` |

`.sbadge` (app.css, existing tokens only, so dark mode follows): `display: inline-block; margin-left: 6px; padding: 0 8px;
border: 1px solid var(--accent); border-radius: 999px; color: var(--accent); font-size: 13px; line-height: 20px;
font-weight: 600; vertical-align: middle; white-space: nowrap`. `.fswitch .kv { border-bottom: 0; }`.

### 1.3 The live Sheet's Messages tab

The two toggle texts exist on the live (round-3) Sheet: setupSheet appended them with the 🧵 text long ago, and `t()` reads
the tab first (core_messages.js:519-525), so a changed MSG default alone would never reach Telegram. setupSheet therefore
rewrites them as round 6 rewrote `settings_note_sale_flow` (gas_setup.js:101-109): in a NEW try/catch block right after the
`sale_flow` note block (after gas_setup.js:114), every Messages row whose Key is `btn_sample_on` and whose Text is EXACTLY
'🧵 နမူနာ: ဟုတ်', or whose Key is `btn_sample_off` and whose Text is EXACTLY '🧵 နမူနာ: မဟုတ်', gets `MSG.btn_sample_on` /
`MSG.btn_sample_off` in its Text cell (one `setValue` each); a text the family typed is kept; a failure is logged
(`gasStore.logError('setup', 'Messages sample texts: …')`), never thrown. A second run finds nothing to rewrite. (The live
round-3 bundle holds exactly those texts, Noel-backup/deployed-v2-2026-11-03/Code.js:286-287.) The file header
(gas_setup.js:17-20) gains: "Round 6b: the sample toggle's two default texts (🧵 → 🎨) are rewritten where the tab still holds
round 3's exact text; the Lists tab's first seed writes item_category's five built-in rows after the three round-4 lists, and
the List header note explains them (lists_note_item_category)."

### 1.4 Reports: unchanged, and why that is distinct already

The day and month reports count samples sold in their own column 'နမူနာ ရောင်း' (`summaryRow`, `SUMMARY_COLS`,
core_report.js:50-53, from `statsWhere`'s `samplesSold`, core_ledger.js:1918-1945), and the stock report prints a sample's
name with ' (နမူနာ)' next to a separate Category column (core_report.js:321-323), so a sample of category အခြား reads
'… (နမူနာ)' | 'အခြား' in two cells. The report tables hold no emoji today (they become Sheets and PDFs); none is added.

### 1.5 The simulator's rack

poc/sim_ui.js:305 (page copy, English): `it.name + (it.sample ? ' 🎨 sample' : '')` instead of `' (sample)'`.

---

## 2. G2 Item categories as a list

### 2.1 The list

| Item | Value |
|---|---|
| name, code, key prefix | `item_category`; `CFG.LIST_CODES.ic = 'item_category'` (callbacks `LA\|ic\|…`, prompt `add_ask_ic`); `CFG.LIST_PREFIX.item_category = 'i'` (a generated key for a Burmese name is 'i' + 4 hex digits, `listKeyFor`, core_ledger.js:675-696) |
| `CFG.LIST_NAMES` (core_config.js:127) | `['pay_method', 'expense_category', 'fabric', 'item_category']`, item_category LAST: the List dropdown, `listsJsonFor`, `listsJsonUpsert`, `syncListRecReason` (core_sync.js:491), `gasStore.addListOption` (gas_store.js:709), `listFindByLabel` (core_ledger.js:744), the first seed of `ensureListsTab` (gas_setup.js:227-235) and `simSeedLists` (poc/sim_seed.js:125-133) take it with no code change; last, so the first seed writes it after the 16 round-4 rows |
| built-in rows (`legacyListRows`, NEW branch before the `listNormRows` tail, core_ledger.js:446) | for `i` in 0..4: `{key: CFG.ITEM_CATEGORY_KEYS[i], label: CFG.CATEGORIES[i], detail: CFG.CATEGORY_EMOJI[CFG.CATEGORIES[i]]}`, normalised with Order 1..5 by the function's existing tail (core_ledger.js:446-448). Reads no Settings, so every device builds the same five |
| `CFG.ITEM_CATEGORY_KEYS` (NEW) | `['htamein', 'longyi', 'eingyi', 'wutsone', 'other']`, parallel to `CFG.CATEGORIES` (core_config.js:26) |
| fixed keys, why | the Sheet's first seed, a phone's lists_json seed and the server's sync seed (`syncApplyListEntry`, core_sync.js:572) all come from `legacyListRows`, so the built-ins have the same keys on every device. `listKeyFor` can never produce one of them (a generated key is a slug plus four hex digits; 'htamein', 'longyi', 'eingyi', 'wutsone' need non-hex tails, and it never returns `other`, core_ledger.js:685), so a later add cannot collide |
| the catch-all | the row keyed `other` (label 'အခြား' until the owner renames it). It always exists (merged by key when no row has it, 2.3), it is always offered and always the LAST option whatever its Order (review m16: an added category comes before it), it is what a piece with no chosen category gets, and it is the one category the photo AI may replace (2.3) |
| `CFG.ITEM_CATEGORY_NEUTRAL` (NEW) | '🔖': the emoji of a category with no Detail and no built-in emoji (it appears nowhere in MSG; 🏷 already means both "category" and "tag", 🧵 means အခြား) |
| `CFG.SAMPLE_WORD` (NEW) | 'နမူနာ': a name containing it is never a category (2.3, review B5) |
| `CFG.SAMPLE_EMOJI` (NEW) | '🎨' |
| `CFG.CATEGORIES`, `CFG.CATEGORY_EMOJI`, `categoryEmoji` (core_config.js:26-27, :211-213) | unchanged: the seed, the legacy fallback and the default of every reader. `categoryEmoji(category)` keeps its one parameter and its 🧵 fallback (run_lists.js:365 pins it); round 6b stops calling it from the core (2.8) |

### 2.2 Name storage, and why not a key

The item keeps the category's **name** in its Category field, as today. Reasons: the Items tab, the Import tab
(gas_import.js:7), the Designs tab (`design.category`, core_bot.js:4872, :4355), the stock report (core_report.js:321-323),
the photo AI's prompt and answer (core_ai_prompt.js:96-98), the name search (core_ledger.js:2079) and the voice hint
(core_bot.js:1162) all speak names; the live Sheet's Items already hold names; a key would need a migration of the live Items
column and of every phone's cache, a lookup in each of those readers, and would show codes to the family on the laptop.

The match between a piece and a row is by name, through `listNameKey` (spaces, case and zero-width characters aside,
core_ledger.js:663-666), the rule the ➕ uses against duplicates; a built-in's old name also finds its row by key after a
rename (`itemCategoryOf`, 2.3). The consequence, said in the README, the guide and the List header note: **renaming a Label on
the laptop renames the chip for new pieces; pieces registered before keep the old name** (the Items tab's Category cell is
where to change them). An old name reads as its built-in row (a renamed built-in) or, when no row carries it, as a custom
category (2.8): the built-in emoji when it is a built-in name, else 🔖, its own price presets.

### 2.3 Core functions (apps-script/core_ledger.js, beside the list helpers; ES5; no ports where marked pure)

```
listPick(rows, shop, includeInactive) -> rows                                    // pure
  // the filter and sort of listOptions (core_ledger.js:496-511) taken out unchanged: active rows (all with includeInactive),
  // a row with a Shop belongs to that shop only, then by Order (rows without one last, in source order). listOptions becomes
  // `return listPick(listRows(ports, name), shop, includeInactive);` (the same result for every call).
itemCategoryRows(ports) -> rows
  // rows = listRows(ports, 'item_category'): the tab (five built-ins and the adds after setupSheet), lists_json, or the five
  // built-ins (the per-list fallback of a store with no item_category row). When no row is keyed 'other', the built-in 'other'
  // row of legacyListRows(ports, 'item_category') is appended: the catch-all always exists, merged by its KEY only (review B4;
  // no other built-in is merged, review B1). Then a row is left out, each logged once (listWarnOnce, 'lists'):
  //   - when its listNameKey contains listNameKey(CFG.SAMPLE_WORD) (a sample is the 🎨 switch, never a category; review B5):
  //     'Lists: the item_category row "<label>" holds the word နမူနာ and is not offered; a sample is the 🎨 switch';
  //   - when an earlier row has the same listNameKey, the row keyed 'other' counting as earlier than every row (a name twice:
  //     a hand-typed row and a phone's add, two keys after a collision; the first in Sheet order wins; review B13):
  //     'Lists: the item_category name "<label>" is on two rows; the first (key <k>) is used'.
  //   The row keyed 'other' itself is never left out. New row objects.
itemCategoryOptions(ports, shop) -> rows
  // listPick(itemCategoryRows(ports), shop, false) without the row keyed 'other', then that row LAST whatever its Active, Shop
  // and Order: the catch-all is always offered (as expenseCategories keeps 'other', core_ledger.js:271-275) and always last
  // (review m16). Every chip, every Telegram button, every pick and the AI's list come from this one function.
itemCategoryOf(ports, name) -> row | null
  // n = listNameKey(name); '' -> null. The row of itemCategoryRows (active or not) whose listNameKey(label) is n; else, when n
  // is the listNameKey of CFG.CATEGORIES[i], the row of itemCategoryRows keyed CFG.ITEM_CATEGORY_KEYS[i] (a renamed built-in:
  // an old name in a Designs row, the Import tab, a restored draft or a card drawn before the rename gets the row's current
  // label; review B6); else null.
itemCategoryFallback(ports) -> label
  // the label of the row keyed 'other' in itemCategoryRows (always there).
itemCategoryPick(names, name) -> label | ''                                       // pure
  // the entry of names whose listNameKey equals listNameKey(name), else ''.
itemCategoryAi(ports, shop) -> {names, other}
  // names = the labels of itemCategoryOptions(ports, shop || '') (the piece's shop: review B7; the catch-all already last, as
  // PHOTO_PROMPT says "set category to the last entry of the list" for a non-garment, core_ai_prompt.js:98);
  // other = itemCategoryFallback(ports).
itemCategoryCats(ctx, ports, shop) -> {names, other}
  // ctx && ctx.categories is an array with an entry -> {names: a copy of it, other: its last entry} (the list the AI was given
  // for this job); else itemCategoryAi(ports, shop). The server's late rename and the phone's replay both read the job's own
  // ctx, so they decide alike whatever each side's list holds now (review B3).
itemCategoryEmoji(ports, name) -> emoji
  // r = itemCategoryOf(ports, name): r.detail when set; else CFG.CATEGORY_EMOJI[name] when name is an own property (a built-in
  // name); else CFG.ITEM_CATEGORY_NEUTRAL.
itemEmoji(ports, item) -> emoji
  // item && item.sample ? CFG.SAMPLE_EMOJI : itemCategoryEmoji(ports, item ? item.category : '').   (G1)
itemCategoryFind(ports, label, shop) -> {ok: false, reason: 'empty' | 'unavailable' | 'sample'} | {ok: false, reason: 'closed', key, label} | {ok: true, existed: true, key, label} | {ok: true, existed: false, label}
  // Nothing is written. clean = listCleanText(label, CFG.LIST_LABEL_MAX); when listNameKey(clean) contains
  // listNameKey(CFG.SAMPLE_WORD): {ok: false, reason: 'sample'} (first; review B5: 'နမူနာ ထမီ' too). Else
  // f = listFindByLabel(ports, 'item_category', label). When f.existed and f.key is not the key of an entry of
  // itemCategoryOptions(ports, shop) (the owner unticked it, or gave it another shop): {ok: false, reason: 'closed', key: f.key,
  // label: f.label} (review M6: typing the name does not undo the owner's untick). Else f.
addItemCategory(ports, label, staff, shop) -> as addListOptionByLabel (core_ledger.js:762-786), plus reasons 'sample', 'closed'
  // f = itemCategoryFind(ports, label, shop); !f.ok or f.existed -> f; else addListOptionByLabel(ports, 'item_category', f.label,
  // staff). Shared by every shop (Shop ''), noted 'added by <name> <day>' as every ➕.
```

Changed:

| Function (line) | Change |
|---|---|
| `legacyListRows` (:404-450) | the `item_category` branch of 2.1 before the `listNormRows` tail |
| `listOptions` (:496-511) | through `listPick` (no behaviour change) |
| `listFindByLabel` (:743-753) | `var rows = name === 'item_category' ? itemCategoryRows(ports) : listRows(ports, name);` (the merged catch-all is found, so an add of 'အခြား' writes nothing; a left-out row is not matched) |
| `aiRenameFields(item, desc, cats)` (:921-926) | stays pure; `cats` = `{names, other}` from `itemCategoryCats`, optional. `names = cats && cats.names \|\| CFG.CATEGORIES`, `other = cats && cats.other \|\| last` (last = `CFG.CATEGORIES[CFG.CATEGORIES.length - 1]`); `hit = itemCategoryPick(names, desc.category)`; the item is at the catch-all when `listNameKey(item.category)` is '' or equals that of `other` or of `last` (old pieces keep the word အခြား after a rename); `out.category = hit` only when `hit` and the item is at the catch-all. Without `cats` every result is today's (W25, run_wizard.js:1687-1690, stays green). Its doc comment says so |
| `commitNewItem` (:1112-1134; the rule at :1125) | `var row = itemCategoryOf(ports, p.category), category = row ? row.label : itemCategoryFallback(ports);` (a name that matches a row, active or retired, is stored with the row's current label, a built-in's old name included; '' or an unknown name gets the catch-all). A retired category is stored when the caller passes it (a Telegram card drawn before the untick); the channels themselves offer none (2.5, 2.6). Its doc comment says so |
| `importProducts` (:2166-2200; the rule at :2186) | the same rule for `row.Category` |

`pricePresets` (:2137-2152) is unchanged: it compares the item's category with the asked one exactly, so a new category
with no pieces gets the default presets (Settings `price_presets`, else `CFG.DEFAULT_PRICE_PRESETS`), which is what G2 asks.

### 2.4 One set of functions for every place

The app's form, Telegram's card and every reader use the same few: `itemCategoryOptions` (the chips, the buttons and what a
pick resolves against: active, for the piece's shop, the catch-all always there and last), `itemCategoryOf` /
`itemCategoryFallback` (what is stored), `itemCategoryFind` / `addItemCategory` (the ➕ and the +), `itemCategoryAi` /
`itemCategoryCats` (the AI's list) and `itemCategoryEmoji` / `itemEmoji` (Telegram's emoji; the app shows none).

### 2.5 The app's new-piece form (app/app_forms.js)

```
အမျိုးအစား  [ထမီ] [လုံချည်] [အင်္ကျီ] [ဝတ်စုံ] [ပိုးအင်္ကျီ] [အခြား] [(plus) အမျိုးအစားအသစ်]      .toggle, wraps (7.6)
            after (plus):  [ ပစ္စည်း အမျိုးအစား နာမည် ရိုက်ပါ (ဥပမာ ပိုးအင်္ကျီ) ]                input catname, maxlength 40, focused
                           "ထမီ" ရှိပြီးသား · အဲဒါကို သုံးပါမယ်                                    live: add_exists / add_ic_sample / add_ic_closed
```

The shop below is the tag's shop, else the staff's.

| Part (line today) | Round 6b |
|---|---|
| values (`appNewItemFresh`, :395-397) | `cat: -1` is replaced by `category: ''` (the chosen name), `catAdd: false`, `catName: ''` |
| restored draft (`appNewItemInit`, :398-409) | a round-6 draft holds `cat` as an index: when `typeof values.cat === 'number'`, `values.category = values.cat >= 0 && values.cat < CFG.CATEGORIES.length ? CFG.CATEGORIES[values.cat] : ''`; then `delete values.cat`; missing `catAdd` / `catName` default to `false` / `''`. (The view below decides whether that name still has a chip.) |
| set (`appNewItemSet`, :421-440) | `arg = parts.slice(1).join(':')` (a hand-typed key may hold ':'). `cat:<key>`: the entry of `itemCategoryOptions(ports, shop)` whose key is `listNormKey('item_category', arg)` (the rows the chips came from: review B4); none → no change; when `!x.catAdd && x.category === row.label` → `x.category = ''` (a second tap clears, as today's index toggle), else `x.category = row.label; x.catAdd = false`. `cat:add`: `x.catAdd = !x.catAdd`, and on turning it on `x.category = ''`. `catname`: `x.catName = String(v \|\| '').slice(0, CFG.LIST_LABEL_MAX)` |
| `appNewItemCategory(values)` (:442-444) | `values.catAdd ? String(values.catName \|\| '').trim() : String(values.category \|\| '')` (still one argument; the view's presets and the snapshot call it) |
| problems (`appNewItemProblems`, :445-457) | after the tag's problem and before the price's: when `values.catAdd`, `f = itemCategoryFind(ports, values.catName, shop)`; `!f.ok` → `{code: 'cat', key: <reason>, vars: f.reason === 'closed' ? {label: f.label} : {}, field: 'catname'}` with `<reason>` = `add_unavailable` (unavailable), `add_ic_sample` (sample), `add_ic_closed` (closed), else `add_ask_ic` |
| view (`appNewItemView`, :458-469) | `categories: itemCategoryOptions(ports, shop).map(function (r) { return {key: r.key, label: r.label}; })`; NEW `catKey`: when `!values.catAdd` and `values.category`, `r = itemCategoryOf(ports, values.category)` and `catKey = r` and r.key among the categories' keys `? r.key : ''` (a restored draft of a renamed built-in shows the renamed chip on; one of a category the owner retired or gave another shop shows none and saves the catch-all: review B11); `catIndex` goes; NEW `catAdd`; NEW `catHint`: while `values.catAdd` and the trimmed name is not empty, from `itemCategoryFind(ports, values.catName, shop)`: existed → `{key: 'add_exists', vars: {label}}`, sample → `{key: 'add_ic_sample', vars: {}}`, closed → `{key: 'add_ic_closed', vars: {label}}`, else `null`; `presets` as today from `appNewItemCategory(values)` (a new name gets the default presets) |
| Save (`appNewItemSave`, :491-527) | after the problems pass: when `v.catAdd`, `a = addItemCategory(ports, v.catName, staff, shop)`; `!a.ok` → refused with the problem of the row above (nothing else written); `category = a.label` (an existing active name gives that row's label and writes no row). Else `category` = the label of the view's `catKey` row, or `''` (commitNewItem then stores the catch-all). Then `commitNewItem` with that category. The Lists row is written in the same `phone.commit` as the item and the group (SPEC-round-6.md 0.3 rule 5): the phone store's `addListOption` updates lists_json (seeding the five built-ins first when its list is empty, `listsJsonUpsert`) and queues one `list` entry. A refused or abandoned form writes no Lists row. The photo job's context (:518): `{categories: itemCategoryAi(ports, r.item.shop).names}` |
| render (`appNewItemRender`, :1478-1480) | one chip per `view.categories` entry: `appFormBtn(F, 'cat:' + c.key, appPlain(c.label), {on: !v.catAdd && view.catKey === c.key})` (plain: F7, the Detail emojis stay in Telegram); then `appFormBtn(F, 'cat:add', tt('btn_add_cat'), {icon: 'plus', on: !!v.catAdd})` (the word table's "add a category", SPEC-round-6.md 13.1, as the expense form, app_forms.js:1522); the section gets `.fbad` when `catname` is bad; while `v.catAdd`: `appFormInput(F, 'catname', v.catName, {placeholder: tt('add_ask_ic'), 'aria-label': tt('add_ask_ic'), maxlength: '40'}, ['cathint'])` and `appFormRegionNode(F, 'cathint', '', …)` drawing `tt(view.catHint.key, view.catHint.vars)` (muted small) when the view has one (redrawn on input, no repaint while typing, U5). The '·' of `add_exists` stays in that hint: it is a message line, as the form's `.fmsg` already shows `basket_other_shop` (13.1 rule 5 is about value lists) |
| focus (review m12) | when `cat:add` turns `catAdd` on, the newitem kind's click handling focuses `[data-f="catname"]` once after the repaint (`F.el.querySelector(…).focus()` in a try/catch), so the phone's keyboard opens without a second tap |
| CSS (review m7) | `.formpage .toggle button[data-f^="cat:"] { white-space: normal; overflow-wrap: anywhere; }` after app.css:285 (it beats `.formpage .toggle button`'s `nowrap`; the expense form's `cat:` chips may wrap too, harmless), so a 40-character label never widens a 343 px phone column |
| snapshot (`appFormSnap`, :720-745) | `category` keeps its expression (now the name, or the typed name while `catAdd`); NEW `catAdd: F.kind === 'newitem' ? !!v.catAdd : false`; `cat` stays (the expense form's key; '' for a new piece) |
| `data-f` (SPEC-round-6.md 7.8, new piece) | `cat:<key>`, `cat:add`, `catname` replace `cat:<i>`; `sample` stays |

Who may add: anyone who registers pieces (a seller and the owner), as sellers add accounts in round 4. Validation is the round-4
rule (`listFindByLabel`, core_ledger.js:743-753) plus two: empty, digits only and amounts in words are refused ('add_ask_ic' in
`.fmsg` and on the field), at most 40 characters (`listCleanText`), zero-width characters removed, a name that is already an
offered category (spacing and case aside) is used and not duplicated (the live hint says so first), a name the owner closed is
refused (`add_ic_closed`, review M6), and a name containing the sample word is refused (`add_ic_sample`). Choosing a chip
while the name is typed is not built (7).

### 2.6 Telegram's new-piece card: the category screen and ➕ (apps-script/core_bot.js)

```
🏷 ဘာ အမျိုးအစားလဲ?                                    item_ask_cat (core_messages.js:492)
[👗 ထမီ]                NI|S1-0007|c|htamein    20 bytes
[🧣 လုံချည်]             NI|S1-0007|c|longyi     19
[👚 အင်္ကျီ]             NI|S1-0007|c|eingyi     19
[🧥 ဝတ်စုံ]              NI|S1-0007|c|wutsone    20
[🔖 ပိုးအင်္ကျီ]          NI|S1-0007|c|i3fa2      18   a category added earlier (no Detail)
[🧵 အခြား]              NI|S1-0007|c|other      18   the catch-all, always last
[➕ အမျိုးအစားအသစ်]      LA|ic|NIC|S1-0007       17   btn_add_cat (core_messages.js:386)
[⏮ နောက်ပြန်]            NI|S1-0007|back         15
```

The shop below is the item's shop (`ports.store.getItem(<id>).shop`).

- **The screen** (`newItemCallback` `case 'c'` without an argument, core_bot.js:3868-3876): one row per
  `itemCategoryOptions(ports, shop)` entry, `btn(itemCategoryEmoji(ports, r.label) + ' ' + r.label, 'NI|' + id + '|c|' +
  r.key)`; a row whose key is longer than `CFG.LIST_KEY_MAX_BYTES` (12) bytes in UTF-8 is left out of the buttons and logged
  once (`listWarnOnce`, core_ledger.js:168, 'Lists: the item_category key "…" is longer than 12 bytes and is left out of
  Telegram's buttons; give it a shorter Key'), so the longest callback is 13 + 12 = 25 bytes; then the ➕ row; then the back
  row. A generated key is at most 11 bytes, a built-in at most 7.
- **A pick** (`NI|<id>|c|<arg>`, :3877-3882): the entry of `itemCategoryOptions(ports, shop)` whose key is
  `listNormKey('item_category', arg)` (the rows the buttons came from: review B4); when there is none and `arg` is one digit
  0..4, the entry keyed `CFG.ITEM_CATEGORY_KEYS[Number(arg)]` (a card drawn before round 6b: run_wizard.js:2076, :2132 and
  run_sync.js:1923 still tap `c|1` and `c|2`); none → no edit (as today; a button of a category closed since it was drawn).
  `d.category = row.label`, the card redrawn in place.
- **➕** (`askAddOption`, core_bot.js:1630; NEW `ADD_RESUME_LIST.NIC = 'item_category'`, :1591-1592): a NEW branch after
  the `SSA` branch (:1649-1663), in the same shape: `ns = newItemFormState(ports, uid, args[0])`; none → the message reads
  `expired` (edit, no buttons); `ns.step !== 'cat'` → ignored with no edit (a ➕ that raced a redraw, rule (c)); else the
  category screen is edited into `add_ask_ic` with ONE row `[btn_back → NI|<id>|back]` (never `Z`, which would drop the
  card), `ns.msgId` follows the edit, and `setState(uid, {kind: 'await_text', purpose: 'add_option', list: 'item_category',
  resume: {a: 'NIC', args: [id]}, saved: ns})` (TTL `CFG.ADD_STATE_TTL_SEC`, setState's prompt rule, :3968-3973). The checks
  before it are today's: an unknown code or resume → expired; a store without `addListOption` → `add_unavailable` as a new
  message, the card kept.
- **The card's state while the prompt waits** (review B2). NEW `newItemStateOf(state)`: `state` when its kind is
  `new_item`; `state.saved` when `state` is `await_text` / `add_option` with `list === 'item_category'` and `state.saved.kind
  === 'new_item'`; else `null`. Every reader of the new-piece state goes through it:
  - `newItemFormState` (:3848-3851): `var s = newItemStateOf(getState(ports, uid)); return s && s.itemId === itemId && s.form ?
    s : null;`, so `NI|<id>|back` from the prompt redraws the card (its `setState` replaces the add state) and an `NC|<id>|ok`
    on an older card message still saves the draft;
  - `handlePhoto` (:2346): `var ns = newItemStateOf(state); if (!ns) { <the last item's photo, as today> }` and `state = ns`
    after it. A photo sent while the ➕ prompt waits is the card's second photo (the round-6 branch, :2354-2360: only the photo
    changes, the card comes back as a new message, its state replaces the add state). It never reaches the last scanned item:
    a blank tag never becomes the last item (openTag's new-piece path, :151-155, has no `setLastItem`), so that item would be
    an earlier, unrelated piece;
  - `toggleSample` (:2406), `newItemPrice` (:2416) and `newItemCost` (:2444): `var state = newItemStateOf(getState(ports, uid));` in
    place of the raw read, so a toggle or a price tapped on an older card message during the prompt acts on the card (and ends
    the prompt through the card's own `setState`) instead of answering `expired`.
- **The typed or spoken name** (`finishAddOption`, :1689-1729): `r = state.list === 'item_category' ? addItemCategory(ports,
  text, staff, <the item's shop>) : addListOptionByLabel(…)` (as today). The re-ask row of a `NIC` add is `[btn_back →
  NI|<id>|back]` instead of `[Z]`. `!r.ok`: `empty` → `add_ask_ic` again with that row (state kept); `sample` →
  `add_ic_sample` + '\n' + `add_ask_ic` with that row (state kept); `closed` → `t('add_ic_closed', {label: r.label})` + '\n' +
  `add_ask_ic` with that row (state kept, nothing written: review M6); `unavailable` → for `NIC` the saved card state is
  restored and the card comes back as a new message with `add_unavailable` on top (`newItemCardShow(chatId, null, …,
  t('add_unavailable'))`), otherwise today's. `ok`: the generic tail restores `state.saved` (the card) and `case 'NIC': return
  newItemCatAdded(chatId, uid, args[0], r.label, staff, ports, prefix);` with `prefix` = `add_done` / `add_exists` '{label}' as
  today.
- NEW `newItemCatAdded(chatId, uid, itemId, label, staff, ports, prefix)`: `st = newItemFormState(ports, uid, itemId)`; none →
  `withPrefix(prefix, t(ports, 'expired'))` as a new message; else `st.draft.category = label` and `newItemCardShow(chatId,
  null, uid, st, staff, ports, prefix)`: the card as a NEW message (a typed answer always is, SPEC-round-6.md 2.3), its first
  line `➕ "ပိုးအင်္ကျီ" ထည့်ပြီး`, its photo_seen line naming the new category, its price chips the defaults.
- **When it is written**: at the name, the round-4 rule of every ➕ in Telegram (`finishAddOption` writes through
  `gasStore.addListOption` under the lock). A card cancelled afterwards leaves the category in the list (harmless; the owner may
  retire it). The app writes at Save (2.5): the two channels differ as round 6 already accepted for the in-sale ➕ (0.3 rule 5).
- Under `quick` no `NI|` button is ever emitted (SPEC-round-6.md 2.7), so there is no category screen and no ➕ there; the
  photo chain stores the AI's category or the catch-all (2.8 row 6).

| Callback | Bytes | Writes | In |
|---|---|---|---|
| `NI\|S1-0007\|c\|<key>` | 18-20 for the built-ins, at most 25 | no | ITEM_ACTIONS (as today) |
| `LA\|ic\|NIC\|S1-0007` | 17 | no (the name writes) | — (as every `LA\|`) |

### 2.7 The owner's laptop (the Lists tab), sync and phones

- **Rows on the Sheet** (review B1). item_category is the last name of `CFG.LIST_NAMES`, so the first seed of
  `ensureListsTab` (gas_setup.js:227-235, its code unchanged) writes the five built-in rows after the 16 round-4 rows, in the
  same single block: rows 18-22 on a sheet with the default Settings, active, Order 1..5, Shop blank, Detail = the emoji.
  `simSeedLists` (poc/sim_seed.js:125-133, its code unchanged; its comment :118-123 says "the four lists") does the same for
  the simulator and the suites. **The live Sheet has no Lists tab yet**: the live bot is the 2026-11-03 build (@3,
  tools/publish-log.jsonl; Noel-backup/deployed-v2-2026-11-03/Code.js has no `ensureListsTab`), so the first setupSheet after
  the round-4-to-6b publish creates the tab with all four lists, and the owner finds the five rows to rename, untick and order
  on day one (FEEDBACK-2 G2). A Lists tab seeded by a round-4, 5 or 6 build (development and test books only) holds no
  item_category row: it reads the five through `listRows`' per-list fallback, and its first add writes them before the new one
  (`listUpsert`, core_ledger.js:594-599, the round-4 rule). The every-run append that review B1 proposed is not built: only
  those books would use it, and it would move one more existing check (measured: 21 instead of 20). The List dropdown offers
  `item_category` (its values are `CFG.LIST_NAMES`, gas_setup.js:250).
- **The List header note** (review B12): `ensureListsTab`'s header-notes nicety (gas_setup.js:258-262) writes, on the List
  column only, `t(ports, 'lists_note_list') + '\n' + t(ports, 'lists_note_item_category')`; the seven other columns keep their
  own note. The new key reaches the live Messages tab through setupSheet's missing-keys append (gas_setup.js:97-99), which runs
  before `ensureListsTab` (:143).
- **Editing on the laptop**: Label renames the chip (2.2's consequence), Active unticked retires it (no chip, no button, and a
  typed name of it is refused; the pieces keep it; untick, never delete: a deleted row's chip is gone, and only the catch-all
  comes back on its own, 2.3), Order orders the chips (the catch-all stays last whatever its Order), Shop limits a chip and the
  AI's list to one shop (blank = every shop), Detail is the emoji Telegram shows (the app shows none). A row typed by hand needs
  a Key: a row without one is skipped (`listNormRow`, core_ledger.js:353-357), and a key longer than 12 bytes (any Burmese key)
  is left out of Telegram's buttons (2.6); the README, the guide and the List note say to add with ➕ / + instead, or to give a
  short ASCII Key (review m13). A name that is on two rows is offered once (the first row, 2.3). onEdit (gas_main.js:109-121)
  needs no change: it ticks the typed row's Active and rewrites the Dashboard, which has no item-category block.
- **Sync**: no core_sync.js change. A phone's add is today's `list` entry (`syncListRecReason`, core_sync.js:488-500, accepts
  the new name through `CFG.LIST_NAMES`); `syncApplyListEntry` (:566-574) upserts it by key (seeding the server's list from
  `legacyListRows` only on a book with no item_category row). Two devices that add the same name derive the same key; a name
  added under two keys (a phone whose lists_json predates a laptop row of that name) gives two rows, which every reader shows
  once (2.3, review B13). The item entry carries the category name like any field (`SYNC.ITEM_FIELDS`, :69); the push order
  (customer, item, list, group, …) needs nothing, because the name does not depend on the row. `listsJsonFor`
  (core_ledger.js:540-553) carries `item_category` with its rows, so every phone's Settings hash moves once after the publish and
  it pulls once.
- **Old phones**: none exist (the app has never been published; every phone starts on the 6b bundle). An app build without 6b
  ignores the `item_category` key of lists_json (`listsJsonUpsert` keeps unknown keys, core_ledger.js:566). **An older server**
  (a rollback below 6b) quarantines an item_category `list` entry as `malformed`; the piece keeps its category name and the
  option lives on that phone until its next lists_json pull (7).
- **quick**: Telegram and the app under `quick` never show a category chooser; the stored category is the AI's (from the
  shop's current list) or the catch-all.

### 2.8 Every reader of a category, and its fallback

| # | Reader (file:line) | Today | Round 6b | A custom category |
|---|---|---|---|---|
| 1 | Telegram item card `cardText` (core_bot.js:229) | `categoryEmoji(item.category)` | `itemEmoji(ports, item)` | its Detail, else 🔖; 🎨 for a sample |
| 2 | `showChoices` (:1173), notebook matches (`presentNotebookLine`, :2545), add-screen matches (`saleScreenAdd`, :2969), review-card line (`basketCardLine`, :2819) | `categoryEmoji` | `itemEmoji` | the same |
| 3 | the new-piece card's category screen (:3871) | `CFG.CATEGORIES` by index | `itemCategoryOptions` by key + ➕ (2.6) | listed with its emoji |
| 4 | the card's photo_seen line (`newItemSeen`, :3798-3800), the quick chain's (:2399, :2438) | the draft's name | unchanged | the name shows |
| 5 | price chips: the card (:3818), the quick chain (`priceScreen`, :2397), the owner's `SP\|` buttons (:2480), the app form (app_forms.js:464) | `pricePresets(category)` | unchanged | no pieces yet → the default presets; later its own common prices |
| 6 | the photo AI in Telegram (`handlePhoto`, :2370, :2376) | `{categories: CFG.CATEGORIES}`; an answer outside it → the last | `var it6 = ports.store.getItem(state.itemId), cats = itemCategoryAi(ports, it6 ? it6.shop : staff.shop)`; `{categories: cats.names}`; `draft.category = (desc && itemCategoryPick(cats.names, desc.category)) \|\| cats.other` | the AI may answer it (its shop's list) |
| 7 | the voice and text AI context (`buildAiContext`, :785), the notebook (`handleNotebookPhoto` → `readNotebook`, :2525) | `CFG.CATEGORIES` | `itemCategoryAi(ports, staff.shop).names` | given to the AI |
| 8 | the app's photo job (app_forms.js:518) | `{categories: CFG.CATEGORIES}` | `{categories: itemCategoryAi(ports, r.item.shop).names}` | given to the AI |
| 9 | the server's photo job (gas_sync.js:333) | `ctx.categories \|\| CFG.CATEGORIES` | `var jobItem = job.itemId ? gasStore.getItem(job.itemId) : null;` then `{categories: itemCategoryCats(ctx, { store: gasStore }, jobItem ? jobItem.shop : '').names}` (the phone's list when the job carries one) | the same |
| 10 | the server's late rename (gas_sync.js:340) | `aiRenameFields(cur, desc)` | `aiRenameFields(cur, desc, itemCategoryCats(ctx, { store: gasStore }, cur.shop))` | replaces the catch-all only |
| 11 | the server twin (poc/sim_sync.js:208) | `aiRenameFields(cur, desc)` | `aiRenameFields(cur, desc, itemCategoryCats(job.ctx, sp, cur.shop))` | the same |
| 12 | the phones' replay (app/app_sync.js:407; poc/sim_phone.js:799) | `aiRenameFields(item, j.desc)` | `aiRenameFields(item, j.desc, itemCategoryCats(job.ctx, phone.ports, item.shop))` | the same list as the server's (the job's ctx), so the pushed entry is a dup (review B3) |
| 13 | `commitNewItem` (core_ledger.js:1125), `importProducts` (:2186) | outside `CFG.CATEGORIES` → the last | 2.3 | stored by the row's current label |
| 14 | a tag attached to a voucher line (`attachTagToItem`, core_bot.js:4872) | the design's category when in `CFG.CATEGORIES`, else the last | `var crow = d ? itemCategoryOf(ports, d.category) : null;` → `crow ? crow.label : itemCategoryFallback(ports)` | a design of that category keeps it; a built-in's old name gets the row's current label |
| 15 | the stock report (core_report.js:321-323), the Items tab, the app's item view `sub` (app_screens.js:713) | the stored name | unchanged, except the app's `sub`: `it.id + ' · ' + appPlain(it.category)` (review m6: a label typed with an emoji shows none in the app) | the custom name shows |
| 16 | the name search (core_ledger.js:2079), the voice hint (core_bot.js:1162), orders' presets by design category (:4355) | the stored name | unchanged | works by name |
| 17 | the mock AI (poc/sim_mock_ai.js:195-199) | `meta.category` or the last of `CFG.CATEGORIES` | unchanged (a test may give `meta.category` a custom name) | — |
| 18 | gas_gemini.js:40, core_ai_prompt.js:163 | `ctx.categories \|\| CFG.CATEGORIES` | unchanged (every caller now passes the list) | — |
| 19 | gas_import.js:7 (the Import tab's instructions) | "Category must be one of CFG.CATEGORIES" | "Category: a name of the Lists tab's item_category (a built-in's old name finds its row); another name becomes the catch-all" | — |

---

## 3. G3 Telegram's 📦 restock from the menu

### 3.1 The menu

`showMenu` (core_bot.js:171-192): the line at :181 loses its condition: `extra.push(btn(t(ports, 'btn_restock'),
'M|restock'))` for every channel and both sale modes, right after the orders or measurement button (as the app's, SPEC-round-6.md
13.11). Telegram's fourth row reads [🧵 အော်ဒါ] [📦 ကုန်ရောက်] [📒 စာအုပ်] [🏛 အကောင့်] (📒 only with AI and its row); the
first three rows keep three buttons each (run_scenario.js:202, run_round4.js:964, :1726 still hold).

`menuAction` `case 'restock'` (:731-735): `formsInApp(ports)` → the app's restock form as today; else (Telegram, and the app
under `quick`) → `return restockAsk(chatId, null, uid, staff, ports, 0, '');`.

### 3.2 The loop

```
☰ [📦 ကုန်ရောက်]                         M|restock                                   9 bytes
→ 📦 ကုန်ရောက် · ပစ္စည်း Tag ကို scan လုပ်ပါ · ဒါမှမဟုတ် နံပါတ် ရိုက်ပါ (ဥပမာ S1-0042 ဒါမှမဟုတ် 42)       restock_ask_tag
  [✖️ မလုပ်တော့]                          Z                                           (nothing saved yet)
scan S1-0002 (START), or type S1-0002 or 2 →
  S1-0002 · လုံချည် ကချင် အပြာ · လက်ကျန် ၅                group_item_line (core_messages.js:473)
  📦 ဘယ်နှစ်ထည် ရောက်လဲ?                                  ask_restock_qty (:81)
  [+၁] [+၅] [+၁၀] [+၂၀]                    RQ|S1-0002|1 … RQ|S1-0002|20                12-13 bytes
  [✏️ အခြား] [✖️ မလုပ်တော့]                RQ|S1-0002|other · RT|skip                   16 · 7 bytes
  [🛒 ရောင်းမယ်]                            K|S1-0002                                    9 bytes
+၅, or a typed 5 → 'S1-0002 · 📦 ကုန်ရောက် ၅ ထည် · လက်ကျန် ၁၀' with [↩️ မှားသွားတယ်] (U|<g>, unchanged)
     (a tap edits the count message; a typed count is a new message), then a NEW message:
  📦 နောက် Tag ကို scan လုပ်ပါ · ဒါမှမဟုတ် နံပါတ် ရိုက်ပါ · ပြီးရင် ✅ ပြီးပြီ ကို နှိပ်ပါ      restock_more
  [✅ ပြီးပြီ]                              RT|done                                      7 bytes
✏️ အခြား → that message reads '✏️ ဘယ်နှစ်ထည် ရောက်လဲ · ဂဏန်း ရိုက်ပေးပါ (ဥပမာ 12)' (restock_type_qty) with [✖️ → RT|skip];
     a typed 1..999 saves as above; another number → bad_qty with [✖️ → RT|skip], nothing written
✖️ (RT|skip) → that message becomes the ask again (restock_more with ✅ after a save, restock_ask_tag with ✖️ before), nothing saved
🛒 ရောင်းမယ် → the loop ends; S1-0002's item card comes (K|: the card's sell buttons)
a one-of-a-kind piece scanned → basket_unique (+ restock_loop_done after a save), the loop ends, that piece's item card comes
✅ ပြီးပြီ → that message reads '📦 ကုန်ရောက် မှတ်တာ ပြီးပါပြီ' (restock_loop_done), no buttons; the loop ends
```

| Step | State (`st:<uid>`) | TTL |
|---|---|---|
| after `M\|restock` | `{kind: 'restock_loop', step: 'tag', n: 0}` | `CFG.RESTOCK_LOOP_TTL_SEC` (NEW, 180 s) |
| a tag accepted | `{kind: 'restock_loop', step: 'qty', itemId, n}` | 180 s |
| a count saved (an `RQ` preset, a number typed at the count screen, or one typed after ✏️) | `{kind: 'restock_loop', step: 'tag', n: n + 1}` (re-armed) | 180 s |
| `RQ\|<id>\|other` in the loop | `{kind: 'await_number', purpose: 'restock_qty', itemId, loop: n}` | 180 s (setState gives the loop's TTL to both shapes, 3.3) |
| `RT\|skip`, or a refusal | `{kind: 'restock_loop', step: 'tag', n}` (re-armed) | 180 s |
| ended by | `RT\|done`; `Z` (the ask before any save); 🛒 (`K\|`, the item card path clears the state, core_bot.js:166); a one-of-a-kind tag; any `M\|` tap and a bare `/start` (`dropAddState` clears both shapes: a menu tap means the seller moved on; a `/start <id>` scan reaches `openTag` without it, :97); another flow's state replacing it; the TTL | — |

Why 180 s (reviews B10, M1): revision 1's 600 s, re-armed on every prompt, let a forgotten loop catch a scan made for a sale
ten minutes later. Three minutes between two tags of one delivery is enough, and an expired loop is harmless: the next scan
shows the item card, whose 📦 still restocks. While the loop is open, a scan for a sale costs one tap (🛒 ရောင်းမယ်), and the
scan of a one-of-a-kind piece (never restocked, so always a sale or a look) ends the loop by itself.

### 3.3 Core changes (apps-script/core_bot.js; `CFG.RESTOCK_LOOP_TTL_SEC: 180` in core_config.js beside `ADD_STATE_TTL_SEC`)

- NEW `restockLoopOf(state)` → `{n, step, itemId}` or `null` (pure): a `restock_loop` state → `{n: state.n || 0, step:
  state.step, itemId: state.itemId || ''}`; an `await_number` state with purpose `restock_qty` and `!nullish(state.loop)` →
  `{n: state.loop, step: 'qty', itemId: state.itemId}`; else `null`. Used by the intercept, `RT`, `dropAddState` and setState.
- `setState` (:3968-3973): the TTL is `prompt ? CFG.ADD_STATE_TTL_SEC : restockLoopOf(state) ? CFG.RESTOCK_LOOP_TTL_SEC :
  CFG.STATE_TTL_SEC`.
- `dropAddState` (:3979-3984): first `if (restockLoopOf(st)) return clearState(ports, uid);` (review B8).
- NEW `restockAsk(chatId, msgId, uid, staff, ports, n, prefix)`: `setState(uid, {kind: 'restock_loop', step: 'tag', n: n ||
  0})`; text `withPrefix(prefix, t(ports, n > 0 ? 'restock_more' : 'restock_ask_tag'))` (the ask names ✅ ပြီးပြီ exactly when
  it carries it: review m15); keyboard `n > 0 ? [[btn(t(ports, 'btn_restock_done'), 'RT|done')]] : [[btn(t(ports,
  'btn_cancel'), 'Z')]]`; `msgId` → `editMessage(chatId, msgId, text, kb, false)`, else `sendMessage`. Before anything is saved
  the way out is ✖️ (nothing to finish); after a save it is ✅ ပြီးပြီ.
- NEW `restockQtyScreen(chatId, item, ports, head, loop)`: today's body of `case 'R'` (:557-559): `sendMessage(chatId,
  withPrefix(head, t(ports, 'ask_restock_qty')), [CFG.RESTOCK_PRESETS → btn('+' + myDigits(n), 'RQ|' + id + '|' + n),
  [btn(btn_other, 'RQ|' + id + '|other'), btn(btn_cancel, loop ? 'RT|skip' : 'Z')]].concat(loop ? [[btn(t(ports,
  'btn_restock_sell'), 'K|' + id)]] : []))`. `case 'R'` (Telegram) calls it with `head` '' and `loop` false (byte for byte
  today's message). In the loop ✖️ skips this tag and keeps the loop (review m3).
- NEW `restockLoopTag(chatId, uid, lp, itemId, staff, ports)` (`lp` from `restockLoopOf`): `add = basketAddItem(ports, staff,
  [], itemId, 1, {restock: true})` (reasons in order: missing, blank, other_shop for a seller, unique; the owner restocks any
  shop's stock item, core_ledger.js:941).
  - `missing`, `blank`, `other_shop` → `restockAsk(chatId, null, uid, staff, ports, lp.n, t(ports, BASKET_REASON_KEY[add.reason],
    add.vars))`: the refusal on top, the loop kept at step `tag`, nothing written (`tag_not_found`, `basket_blank`,
    `basket_other_shop`).
  - `unique` (review M1) → `clearState`; `sendMessage(chatId, t(ports, 'basket_unique', add.vars) + (lp.n > 0 ? '\n' + t(ports,
    'restock_loop_done') : ''))`; then `return openTag(chatId, itemId, staff, uid, ports)`: with no state, the tag takes its
    normal path (its item card).
  - accepted → `setState(uid, {kind: 'restock_loop', step: 'qty', itemId: item.id, n: lp.n})`, `setLastItem`,
    `restockQtyScreen(chatId, item, ports, t(ports, 'group_item_line', {id, name: item.name, stock: fmtCount(item.stock)}),
    true)`. A price-pending stock item is accepted (as the app's restock form accepts it).
- NEW `restockLoopSave(chatId, msgId, uid, n, p, isCaption, staff, ports)`: `r = commitRestock(ports, p)` (`p` = the
  commitRestock params: `item`, `qty`, `staff`, `source`, `transcript`, `updateId`); `fresh = getItem(p.item.id)`;
  `setLastItem`; `editOrSend(ports, chatId, msgId, p.item.id + ' · ' + t(ports, 'restock_done', {qty: fmtCount(p.qty), stock:
  fmtCount(fresh.stock)}), undoRow(ports, r.groupId), isCaption, {kind: 'group', id: r.groupId})` (the app's one-line restock
  reply, app_forms.js:602; a tap edits the count message, a typed count, with `msgId` null, is a new message); then
  `restockAsk(chatId, null, uid, staff, ports, n + 1, '')`.
- `openTag` (:117): first lines after `opts = opts || {}`: `var lp = opts.card ? null : restockLoopOf(getState(ports, uid)); if
  (lp) return restockLoopTag(chatId, uid, lp, itemId, staff, ports);` (before the unknown-tag, order, basket and blank
  branches; `K|` keeps the item card). A tag scanned at the count screen, or while ✏️ waits, replaces the count screen's item
  (the older screen's RQ buttons still save, as an `R|` screen's always did).
- `handleText` (:825, first lines inside `if (state) {`), for a `restock_loop` state only:
  - step `tag`: `if (n !== null && /^[0-9၀-၉]{1,4}$/.test(text)) return openTag(chatId, (staff.shop || CFG.SHOP_IDS[0]) + '-' +
    ('0000' + n).slice(-4), staff, uid, ports);` (a bare tag number, as the app's tag keypad composes it, app_ui.js:1069-1085;
    a full id such as S1-0042 is caught earlier by `tagIdFromText`, :809);
  - step `qty` (reviews B9, M2): when `n !== null`: `item = getItem(state.itemId)`; no item → `restockAsk(chatId, null, uid,
    staff, ports, state.n || 0, t(ports, 'tag_not_found', {id: state.itemId}))`; `n` a whole number 1..`CFG.MAX_SALE_QTY` →
    `restockLoopSave(chatId, null, uid, state.n || 0, {item, qty: n, staff, source: CFG.SOURCE.TEXT, transcript: text, updateId},
    false, staff, ports)`; else `sendMessage(t(ports, 'bad_qty', {max: myDigits(CFG.MAX_SALE_QTY)}))` and
    `restockQtyScreen(chatId, item, ports, t(ports, 'group_item_line', …), true)` again, the state kept. At the count screen a
    typed number is therefore the count, never a tag: a typed 5 there never opens S1-0005.
  Other text keeps today's path (the AI sees `awaiting` 'restock_loop_tag' / 'restock_loop_qty' through `buildAiContext`'s
  existing `kind + '_' + step` rule, :778; only non-number text reaches it now).
- `case 'RQ'` (:561-571): first `var lp = restockLoopOf(getState(ports, uid)), inLoop = !!lp && lp.step === 'qty' && lp.itemId
  === id;`. `other`: when `inLoop` → `setState(uid, {kind: 'await_number', purpose: 'restock_qty', itemId: id, loop: lp.n})` and
  `edit(t(ports, 'restock_type_qty'), [[btn(t(ports, 'btn_cancel'), 'RT|skip')]])` (review m4: a count example, not
  `ask_number`'s price example '(ဥပမာ 25000)'); else today's. A count: when `inLoop` → `restockLoopSave(chatId, msgId, uid,
  lp.n, merge(base, {item: item, qty: Number(arg)}), isCaption, staff, ports)`; else today's. Outside the loop (an item card's
  📦) nothing changes.
- `applyAwaitedNumber` `case 'restock_qty'` (:910-916): when `!nullish(state.loop)`: a whole `n` in 1..`CFG.MAX_SALE_QTY` →
  `restockLoopSave(chatId, null, uid, state.loop, {item: item2, qty: n, staff, source, transcript, updateId}, false, staff,
  ports)`; else `setState(ports, uid, state)` and `sendMessage(chatId, t(ports, 'bad_qty', {max: …}), [[btn(t(ports,
  'btn_cancel'), 'RT|skip')]])` (review m4). Without `loop` it is today's (no range check: it predates the round, 7).
- NEW `case 'RT'` in `handleCallback`: `var lp = restockLoopOf(getState(ports, uid));` `arg === 'skip'`: `lp` →
  `restockAsk(chatId, msgId, uid, staff, ports, lp.n, '')` (the tapped message becomes the ask, nothing saved); no loop →
  `edit(t(ports, 'expired'))`. Any other argument (`done`): `lp` → `clearState`; then `edit(t(ports, 'restock_loop_done'))`
  (idempotent; it also ends a loop waiting at the ✏️ prompt: review B8). `RT` is in neither `ITEM_ACTIONS` nor
  `MUTATING_ACTIONS` (it writes nothing).
- The header legend (:20-38): `RT|done ends the 📦 restock loop of the menu, RT|skip drops the tag at its count screen (round 6b)`;
  `M|restock` named in the menu line.

**The app.** The app with forms never arms the loop (its `M|restock` opens the form). The app under `quick` runs it as a chat
loop with no app code change: the ask and the count screen are cards with plain labels (13.1); the app types a tag through
Scan and then the tag keypad (the shop and four digits, app_ui.js:1067-1085), which sends `/start <id>` into `openTag`, so the
texts' "type the number" means the keypad there and the example '42' does not apply (the keypad shows `S1-____`);
`restock_loop` has no input mode (`appInputModeFor`, app_ui.js:72-84, returns null for it), so Scan keeps the loop
(`appDropWaiting(true)`, :950-955) and Menu ends it (`appOpenMenu` → `appDropWaiting(false)`, :966-968); ✏️ opens the number
keypad (an `await_number` state); Scan while that keypad waits drops the loop (the Scan rule for a state with a field), so the
next scan shows the item card. The count card's first line keeps its '·' (a chat card is a core text, 13.1 rule 3, as
`restock_done` already is in the app). run_app step 85 pins this, so a later input mode for `restock_loop` cannot silently
break Scan (review M4).

| Callback | Bytes | Writes | In |
|---|---|---|---|
| `M\|restock` | 9 | no | — |
| `RQ\|S1-0002\|20` · `RQ\|S1-0002\|other` | 13 · 16 | yes · no | ITEM_ACTIONS, MUTATING_ACTIONS (as today) |
| `RT\|done` · `RT\|skip` | 7 · 7 | no | — |
| `K\|S1-0002` (🛒 ရောင်းမယ်) | 9 | no | ITEM_ACTIONS (as today) |

### 3.4 Several tags in a row, said in one place

Each tag is its own RESTOCK group with its own ↩️ (the existing `commitRestock`, one undo per tag); the loop only saves the
seller the menu tap between tags. A typed count, ✏️, ✖️, 🛒, a refusal, a second scan at the count screen and the 180 s window
are all in 3.2-3.3. Restocking several tags as ONE group stays the app form's (SPEC-round-6.md 1.6).

### 3.5 F10b

No shop is named: the owner's tags of any shop are accepted (`basketAddItem`'s owner rule), a seller's tag of another shop is
refused, the bare number uses `staff.shop || CFG.SHOP_IDS[0]`. `tagIdFromText`'s `S[12]` (core_bot.js:216) predates the round
and is not touched.

### 3.6 The existing checks that change for G3 (also in 5.8)

| File:line | Label today | Change |
|---|---|---|
| poc/run_round4.js:964 | 'the menu keeps three rows of three; the fourth row gains 🏛 အကောင့်' | `same(E.datas(menu)[3], ['M\|ord', 'M\|restock', 'M\|nb', 'M\|acct'])`; label '… the fourth row gains 📦 ကုန်ရောက် (round 6b) and 🏛 အကောင့်' |
| poc/run_round4.js:1126 | 'without 🧵 and 📒 the fourth row is 🏛 alone' | `same(F3.datas(F3.last(U.sister))[3], ['M\|restock', 'M\|acct'])` (the row count stays 4); label 'without 🧵 and 📒 the fourth row is 📦 and 🏛' |
| poc/run_wizard.js:2444 | 'the menu of a form-mode app world has M\|restock right after the orders button; the Telegram menu has none' | `menuT.indexOf('M\|restock') === menuT.indexOf('M\|ord') + 1` instead of `menuT.indexOf('M\|restock') < 0`; label '…; the Telegram menu has it too, right after the orders button (round 6b, G3)' |
| poc/run_wizard.js:2454 | 'in Telegram M\|restock does nothing (no menu button, no form)' | `T.bots(u).length === bT + 1 && T.screen(u).text === MSG.restock_ask_tag && same(T.screen(u).datas, [['Z']]) && T.state(u).kind === 'restock_loop' && T.state(u).step === 'tag'`; label 'in Telegram M\|restock asks for the tag (restock_ask_tag, ✖️) and waits (round 6b, G3)' |

Checked and unchanged: run_round4.js:1726, :1761, :1786, :1823 (the fourth row still starts with M|ord or M|meas, M|acct is
still there); run_app.js:494 (the quick app world: `keyboard[3][0]` is still M|meas); run_app.js:2492, :2501; run_wizard.js:2447-
2450; run_scenario.js:202, :845; check_simulator.js:529.

---

## 4. Messages

Drafts from words MSG already uses (core_messages.js:2-4 asks a native speaker to confirm them); the family may rewrite any
of them in the Messages tab. The app shows every text without its emojis (`appPlain`, SPEC-round-6.md 13.1), Telegram as
written. No new `btn_*` text contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ, and none starts with '🏦 '. No round-4, 5 or 6
text changes (run_lists.js:925-930, run_wizard.js:1604-1613 and :3044-3046, run_app.js:1773-1780 compare them with their
specs).

### 4.1 core_messages.js `MSG`, round 6b, step 1 adds all of them

```
add_ask_ic: '✏️ ပစ္စည်း အမျိုးအစား နာမည် ရိုက်ပါ (ဥပမာ ပိုးအင်္ကျီ)'
add_ic_sample: 'ℹ️ နမူနာ က အမျိုးအစား မဟုတ်ပါ · 🎨 နမူနာ ခလုတ်ကို သုံးပါ'
add_ic_closed: 'ℹ️ "{label}" ကို ပိတ်ထားပါတယ် · တခြား နာမည် ရိုက်ပါ'
restock_ask_tag: '📦 ကုန်ရောက် · ပစ္စည်း Tag ကို scan လုပ်ပါ · ဒါမှမဟုတ် နံပါတ် ရိုက်ပါ (ဥပမာ S1-0042 ဒါမှမဟုတ် 42)'
restock_more: '📦 နောက် Tag ကို scan လုပ်ပါ · ဒါမှမဟုတ် နံပါတ် ရိုက်ပါ · ပြီးရင် ✅ ပြီးပြီ ကို နှိပ်ပါ'
restock_type_qty: '✏️ ဘယ်နှစ်ထည် ရောက်လဲ · ဂဏန်း ရိုက်ပေးပါ (ဥပမာ 12)'
restock_loop_done: '📦 ကုန်ရောက် မှတ်တာ ပြီးပါပြီ'
btn_restock_done: '✅ ပြီးပြီ'
btn_restock_sell: '🛒 ရောင်းမယ်'
lists_note_item_category: 'item_category = ပစ္စည်း အမျိုးအစား · Detail = Telegram မှာ ပြမယ့် emoji · Label ပြင်ရင် ပစ္စည်းအသစ်တွေမှာပဲ နာမည်သစ် ပေါ်ပါမယ် (အရင် ပစ္စည်းတွေ နာမည်ဟောင်း အတိုင်း) · အခြား က အမြဲ နောက်ဆုံး · အသစ် ထည့်ရင် ➕ ကို သုံးပါ'
```

Ten keys, in a "round 6b" block after the revision-3 block (core_messages.js:502-511). Their words: `add_ask_ec` / `add_ask_fb`
(:389-390, '✏️ … နာမည် ရိုက်ပါ (ဥပမာ …)') and `item_ask_cat` (:492, 'အမျိုးအစား') for `add_ask_ic`; `tag_not_blank` (:322,
'မဟုတ်ပါ') and `menu` (:89, 'ခလုတ်') for `add_ic_sample`; `add_exists` (:392, '"{label}"'), `ui_off` (app_i18n.js:129, 'ပိတ်')
and `add_ask_ec` ('နာမည် ရိုက်ပါ') for `add_ic_closed`; `btn_restock` (:24), `scan_first` (:74, 'ပစ္စည်း Tag ကို … scan လုပ်') and
`basket_add_ask` (:455, 'နောက် Tag ကို scan လုပ်ပါ · ဒါမှမဟုတ် နံပါတ် ရိုက်ပါ (ဥပမာ S1-0042)') for the two restock prompts;
`ask_restock_qty` (:81) and `ask_number` (:79, 'ဂဏန်း ရိုက်ပေးပါ') for `restock_type_qty`; `item_created` (:85, '…ပြီးပါပြီ')
for `restock_loop_done`; `ui_home_sell` (app_i18n.js:152, the same words) for `btn_restock_sell`; `lists_note_list` and
`lists_note_detail` (:415, :421) for `lists_note_item_category`; 'ပြီးပြီ' is a draft.

### 4.2 Changed texts (two keys)

```
btn_sample_on: '🎨 နမူနာ: ဟုတ်'
btn_sample_off: '🎨 နမူနာ: မဟုတ်'
```

Today (core_messages.js:49-50): '🧵 နမူနာ: ဟုတ်' / '🧵 နမူနာ: မဟုတ်'. The live Sheet's rows are rewritten by setupSheet (1.3).
run_scenario.js:352-353 find the toggle by the substring 'နမူနာ: မဟုတ်' / 'နမူနာ: ဟုတ်' and stay green; run_wizard.js:2051
and :2079 compare callbacks and `MSG.sample_mark`, so they stay green, and their labels, which name 🧵, get label-only edits
(5.8, review m9).

### 4.3 app/app_i18n.js `APP_MSG`, round 6b, step 3 adds both

```
ui_lbl_sample: 'နမူနာ'
ui_sample_hint: 'ဒီဇိုင်းဌာနက လုပ်တဲ့ နမူနာ ဆိုရင် ဖွင့်ပါ၊ အစီရင်ခံစာမှာ သီးသန့် ပြပါမည်'
```

Two keys, in a "round 6b" block at the end of APP_MSG (app_i18n.js:280). `ui_sample_hint` is G1's draft with '၊' for the '·';
its words: `ui_on` (:128, 'ဖွင့်') and the report column 'နမူနာ ရောင်း' (core_report.js:53).

### 4.4 Reused word for word

MSG `btn_add_cat` (:386), `btn_back` (:335), `btn_cancel` (:32), `btn_other` (:31), `btn_restock` (:24), `item_ask_cat` (:492),
`add_done` (:391), `add_exists` (:392), `add_unavailable` (:393), `expired` (:71), `sample_mark` (:13), `ask_restock_qty` (:81),
`restock_done` (:53), `group_item_line` (:473), `bad_qty` (:20), `tag_not_found` (:8), `basket_blank`, `basket_other_shop`,
`basket_unique` (round 6), `lists_note_list` (:415); APP_MSG `ui_on`, `ui_off` (:128-129).

---

## 5. Tests

Plain Node, `check(cond, label, detail)`, labels from MSG / APP_MSG, the 64-byte listener (run_wizard.js:58-65). Every new
check names in "fails without" the code whose absence turns it red; the builder proves the starred ones (★) red in a scratch
copy of the tree with that code removed, and says so in the report. Existing checks change only where 5.8 names them.

### 5.1 poc/run_lists.js (step 1): a new step `W. Item categories (round 6b, G2)`, appended after step V

| # | Checks | Fails without |
|---|---|---|
| W1 ★ | `CFG.LIST_NAMES` ends with 'item_category', `LIST_CODES.ic`, `LIST_PREFIX.item_category === 'i'`, no `CFG.LIST_LAZY`; `ITEM_CATEGORY_KEYS` has `CFG.CATEGORIES.length` entries, the last 'other'; `SAMPLE_WORD` 'နမူနာ', `SAMPLE_EMOJI` '🎨', `ITEM_CATEGORY_NEUTRAL` '🔖', `RESTOCK_LOOP_TTL_SEC` 180; `legacyListRows(p, 'item_category')` = five rows: those keys, the labels of `CFG.CATEGORIES`, Detail = `CFG.CATEGORY_EMOJI`, Order 1..5, Shop '' | the CFG members, the legacy branch |
| W2 ★ | a world after `simSeedLists` holds the three round-4 lists and then the five item_category rows (keys, Order 1..5, Detail emojis, active); `itemCategoryOptions(p, 'S1')` = the five in built-in order; `JSON.parse(listsJsonFor(p)).item_category` holds the five; a world with NO Lists rows (`seedSimWorld` only) and a phone-like store whose lists_json has `item_category: []` (`phoneLikePorts`, run_lists.js:158) both offer the five (the per-list fallback) | `LIST_NAMES`, the fallback |
| W3 ★ | on a world with no Lists rows: `addItemCategory(p, 'ပိုးအင်္ကျီ', sister, 'S1')` → `{ok: true, created: true}`, key `/^i[0-9a-f]{4}$/`; the world's item_category rows are the five built-ins first (their keys, Order 1..5, emojis) then the new one (Order 6, Detail '', Shop '', Note 'added by …'); on a seeded world the same add appends ONE row (Order 6); `itemCategoryOptions` now six: the four garments, ပိုးအင်္ကျီ, then အခြား last; the same name on a second world gives the same key | `LIST_PREFIX`, `addItemCategory`, the seed, the catch-all-last rule |
| W4 ★ | `'ပိုး အင်္ကျီ'`, `'ပိုးအင်္ကျီ' + String.fromCharCode(0x200b)`, `'ထမီ'` → `existed` with the stored label, nothing written; `'နမူနာ'`, `' နမူနာ '`, `'နမူနာ ထမီ'` → `{ok: false, reason: 'sample'}`; `''`, `'123'`, `'5000 ကျပ်'` → `empty`; the ဝတ်စုံ row unticked → `itemCategoryFind(p, 'ဝတ်စုံ', 'S1')` = `{ok: false, reason: 'closed', key: 'wutsone', label: 'ဝတ်စုံ'}` and `addItemCategory` writes nothing; a row with Shop 'S2' → `closed` for 'S1', `existed` for 'S2'; 'အခြား' → `existed` even with the other row unticked (the catch-all is always offered) | `itemCategoryFind` (the contains rule, the closed rule), `listFindByLabel` on `itemCategoryRows` |
| W5 ★ | a world whose Lists tab holds only a hand-typed `{list: 'item_category', key: 'pahsoe', label: 'ပုဆိုး'}`: the options are ပုဆိုး and the catch-all 'အခြား' (key 'other', merged by key), and nothing else; with `{key: 'misc', label: 'အခြား'}` added before it: one 'အခြား' option, keyed 'other' (a `cat:other` lookup finds it); a typed row 'နမူနာ' and one 'နမူနာ ထမီ' are neither offered nor found by `itemCategoryOf`, each logged once (one Errors row each, two reads); two rows 'ပိုးအင်္ကျီ' under keys 'i3fa2' and 'silk1' → one option (the first), `itemCategoryFind` answers key 'i3fa2', one log line | the catch-all merge by key, the sample filter, the dedupe |
| W6 | a row with Shop 'S2' is offered for S2 only and is in `itemCategoryAi(p, 'S2').names`, not in `(p, 'S1')`; the 'other' row unticked → still the last option; the 'other' row given Order 1 → still the last option; relabelled 'တခြား' → `itemCategoryFallback` 'တခြား', `itemCategoryAi(p, 'S1').names` ends with 'တခြား' and `.other` is 'တခြား'; `itemCategoryCats({categories: ['ထမီ', 'x', 'တခြား']}, p, 'S1')` → `{names: ['ထမီ', 'x', 'တခြား'], other: 'တခြား'}` (a copy), and with `{}` → `itemCategoryAi(p, 'S1')`; `listOptions` gives what it gave before for the three other lists (`listPick`) | the catch-all rule, `itemCategoryAi`'s shop, `itemCategoryCats` |
| W7 | `itemCategoryEmoji`: a Detail '🥻' wins; 'ထမီ' → '👗'; an unknown name → '🔖'; the htamein row relabelled 'ထမိန်' with Detail '🥻' → 'ထမီ' (the old name) gives '🥻'; `itemEmoji` of a sample → '🎨', of an အခြား piece → '🧵'; `categoryEmoji('dress') === '🧵'` and `categoryEmoji.length === 1` still | `itemCategoryEmoji`, `itemEmoji`, `itemCategoryOf`'s key fallback |
| W8 ★ | `aiRenameFields(placeholder at 'အခြား', {name, category: 'ပိုး အင်္ကျီ'}, itemCategoryAi(p, 'S1'))` → `{name, category: 'ပိုးအင်္ကျီ'}` (the list's label); at the relabelled catch-all 'တခြား' and at the word 'အခြား' → replaced; at 'လုံချည်' → name only; a category the list lacks → name only; without the third argument every W25 case is unchanged | the `cats` parameter |
| W9 ★ | `commitNewItem` with category 'ပိုး အင်္ကျီ' stores 'ပိုးအင်္ကျီ'; with a retired category stores it; with 'chair' stores the catch-all; with 'ထမီ' after the htamein row is relabelled 'ထမိန်' stores 'ထမိန်'; with the name of a hand-typed 'နမူနာ' row stores the catch-all; `importProducts` the same five | the 2.3 rule, `itemCategoryOf`'s key fallback |

### 5.2 poc/run_wizard.js (step 1): W43-W46, inserted before W39 (W39 stays the file's last step)

Every tap of these steps goes through the bench's `tapData` (`b.tapData(u, data)`): `answer()`'s action list
(run_wizard.js:170) lacks `RT`, so `answer('RT|done')` would fall to `tapLastByKey` (review m2; the helper is not edited).

| Step | Checks | Fails without |
|---|---|---|
| W43 ★ The sample sign | `MSG.btn_sample_on` / `off` start with '🎨 ' and `CFG.SAMPLE_EMOJI !== CFG.CATEGORY_EMOJI['အခြား']`; form mode: the new-piece card's `PS\|S1-0007` button reads `btn_sample_off`, after the tap `btn_sample_on`, and no button of the card starts with '🧵 '; quick: `priceScreen`'s toggle reads `btn_sample_off`; a sample of category အခြား (`commitNewItem … sample: true`) and a non-sample အခြား piece of the same name stem: `cardText` of the sample starts with '🎨 ' + its id and holds `sample_mark`, of the other with '🧵 '; the sample's row under M\|find (`showChoices`) starts with '🎨 '; its review-card line (`basketCardLine`) holds '🎨'; `presentNotebookLine` with a line whose `item_hint` matches the two pieces equally gives the `NB\|` choice rows, the sample's starting with '🎨 ' and the other's with '🧵 '; `saleScreenAdd(ports, staff, item, state, {found: [the sample]})` gives a row starting with '🎨 '; the stock report's row of the sample: the name cell ends with `sample_mark`, its category cell is 'အခြား', no cell holds '🎨' | the texts; `itemEmoji` at each of the five call sites (one assertion each: review M3) |
| W44 ★ Item categories in Telegram | the card's 🏷: `item_ask_cat` with one row per built-in key `NI\|S1-0007\|c\|<key>` (the emoji of each), then `LA\|ic\|NIC\|S1-0007`, then `NI\|S1-0007\|back`; `c\|longyi` → လုံချည်; the legacy `c\|1` → လုံချည်; ➕ → the same message reads `add_ask_ic` with ONLY `[NI\|S1-0007\|back]`, the state is `await_text` / `add_option` / `item_category` with `saved.kind === 'new_item'`; ⏮ from it → the card in place, the state `new_item` at `card`; ➕ again, typed '12' → `add_ask_ic` again with ⏮ (no `Z`), the state kept; typed 'နမူနာ' → `add_ic_sample` on top, the state kept; the ဝတ်စုံ row unticked, typed 'ဝတ်စုံ' → `add_ic_closed` ('ဝတ်စုံ') on top of `add_ask_ic` with ⏮, the state kept, no row (review M6); **B2**: with S1-0002 scanned before the blank tag (the last item), a photo sent while the prompt waits → the card comes back as a new message whose draft `photoFileId` is the new file, the state `new_item` at `card`, S1-0002's `photoUrl` unchanged; ➕ again, `PS\|S1-0007` tapped on the older card message → the card's sample flips (no `expired`); typed 'ပိုးအင်္ကျီ' → a NEW message whose first line is `add_done` with that label, whose photo_seen names it, whose price chips are the defaults; the world's Lists hold the five then the new row (written at the name, before ✅); ✅ → the item's category 'ပိုးအင်္ကျီ' and its card starts with '🔖 '; a second blank tag's 🏷 screen lists the new key before `other`; typed 'ထမီ' after ➕ → `add_exists`, no new row; **rows 6-7**: a photo of a third blank tag whose mock meta names category 'ပိုးအင်္ကျီ', with `ports.ai.describePhoto` wrapped to keep its ctx → `ctx.categories` holds 'ပိုးအင်္ကျီ' and ends with 'အခြား', and the card's photo_seen names 'ပိုးအင်္ကျီ'; `buildAiContext(ports, staff, uid).categories` holds it; with `readNotebook` wrapped, a notebook photo's ctx `categories` holds it; **B7**: a row with Shop 'S2' is missing from an S1 blank tag's 🏷 screen and from that photo's ctx; **row 14**: TSL-0018's category set to 'ပိုးအင်္ကျီ' and an open order line of it: 🏷 Tag တပ် and a blank tag (`attachTagToItem`) → the piece's category 'ပိုးအင်္ကျီ'; with the htamein row relabelled 'ထမိန်' and a design of 'ထမီ' → 'ထမိန်'; a store without `addListOption`: ➕ → `add_unavailable` as a new message, the card kept; under quick no `NI\|` button; the bytes: `LA\|ic\|NIC\|S1-0007` 17, `NI\|S1-0007\|c\|htamein` 20; a hand-typed key of 13 bytes is left out of the screen and logged once | the 2.6 code (`newItemStateOf` in `handlePhoto` and `toggleSample`), `ADD_RESUME_LIST.NIC`, the 2.3 functions, rows 6, 7 and 14 of 2.8 |
| W45 ★ Restock from Telegram's menu | the Telegram menu's fourth row is ['M\|ord', 'M\|restock', 'M\|nb', 'M\|acct']; `M\|restock` → `restock_ask_tag` with [Z], state `restock_loop` / `tag`, its cache entry expires `CFG.RESTOCK_LOOP_TTL_SEC` s ahead (`world.cacheData['st:' + uid].exp`); scan S1-0002 → `group_item_line` + '\n' + `ask_restock_qty`, datas `[RQ presets]`, `['RQ\|S1-0002\|other', 'RT\|skip']`, `['K\|S1-0002']`; `RQ\|S1-0002\|5` → that message reads 'S1-0002 · ' + `restock_done` with the U\| row, then a NEW `restock_more` with [RT\|done], state `tag`, `n` 1, ONE RESTOCK of +5; **B9**: scan S1-0005, typed '7' → a new 'S1-0005 · ' + `restock_done` (+7) and `restock_more`, `n` 2; scan S1-0005, typed '0' and then '1000' → `bad_qty` and the count screen again each time, nothing written, state `qty`; **m4**: `RQ\|S1-0005\|other` → `restock_type_qty` with [RT\|skip], state `await_number` / `restock_qty` / `loop` 2; typed '25000' → `bad_qty`, nothing written; typed 3 → +3 and `restock_more`, `n` 3; **B8**: scan S1-0005, `RQ\|S1-0005\|other`, then `RT\|done` → `restock_loop_done`, state null, and a typed 4 afterwards writes no RESTOCK; **m3**: armed with `n` 1, scan S1-0002, `RT\|skip` → that message becomes `restock_more` with [RT\|done], state `tag`, nothing written; armed with `n` 0, the same → `restock_ask_tag` with [Z]; **B10**: scan S1-0002, `K\|S1-0002` → the item card, state null; **M1**: armed, one save, scan S1-0001 (one of a kind) → `basket_unique` + '\n' + `restock_loop_done`, then S1-0001's item card, state null, no row; **m15**: armed, one save, S1-0007 (blank) → `basket_blank` on top of `restock_more` with [RT\|done]; S9-9999 → `tag_not_found`; the sister's S2-0003 → `basket_other_shop`; the state kept each time; typed '5' at the ask → S1-0005's count screen; `RT\|done` → `restock_loop_done`, state null; a later scan of S1-0002 → the item card, not the count screen; armed again, `M\|today` → the state is gone; armed again, the clock moved 181 s → a scan of S1-0002 gives the item card (the TTL); the owner restocks S2-0003 (no refusal); an item card's `R\|S1-0002` → today's screen (its second row `['RQ\|S1-0002\|other', 'Z']`, no 🛒 row) and its `RQ` reply today's text (no prefix, no offer) | `restockAsk`, `restockLoopOf`, `restockLoopTag`, `restockLoopSave`, `restockQtyScreen`'s loop rows, the openTag / handleText / RQ / RT / applyAwaitedNumber / dropAddState / setState changes, the menu line |
| W46 Round-6b texts | every key of section 4.1's block of `docs/design-round-6/SPEC-round-6b.md` (ten) is in MSG, non-empty and equal to the block; the two keys of 4.2 equal their block (parsed as W39 parses 13.14) | the keys |

### 5.3 poc/run_round4.js (step 1)

Only the two edits of 3.6 (:964, :1126). No new check.

### 5.4 poc/run_gas.js (step 2): sections 33-35, appended before section 17 (run_gas.js:2166)

- 33 ★ setupSheet and item categories: on an empty book the Lists tab's rows 18-22 are the five item_category rows (keys of
  `CFG.ITEM_CATEGORY_KEYS`, labels, Detail emojis, Order 1..5, Active true, Shop ''), inside the first seed's one block; the
  List header cell's note is `MSG.lists_note_list + '\n' + MSG.lists_note_item_category` and the Key header's is still
  `MSG.lists_note_key`; a book whose Messages tab holds `btn_sample_on` = '🧵 နမူနာ: ဟုတ်' (exactly) and `btn_sample_off` = a text
  the family typed: after setupSheet `btn_sample_on` reads `MSG.btn_sample_on` and `btn_sample_off` keeps the typed text; a
  second setupSheet writes neither cell; no Errors row. Fails without item_category in `CFG.LIST_NAMES`, the header note and the
  rewrite.
- 34 ★ The ➕ on the Sheet: on a seeded book, `addItemCategory(x.buildPorts(), 'ပိုးအင်္ကျီ', staff, 'S1')` writes ONE row
  (row 23, Order 6, Shop '', Note 'added by …') under one lock; `x.listsJsonFor({store: x.gasStore})` carries six item_category
  rows; a second add of 'ပိုး အင်္ကျီ' writes nothing; on a book whose five item_category rows were deleted by hand (a tab
  seeded by a round-4-6 build), the first add writes the five built-ins and then the new row as one block; the Dashboard has no
  item-category block. Fails without the list in `CFG.LIST_NAMES` (gas_store.js:709 throws) and without the seed.
- 35 Source: `gasSyncHooks().ai`'s photo branch passes `itemCategoryCats(ctx, { store: gasStore }, …).names` as
  `describePhoto`'s categories (the rename's half is the named change of run_gas.js:1896, 5.8). Fails without it.

### 5.5 poc/run_sync.js (step 2): R6l, appended after R6k (run_sync.js:2179)

R6l ★ An item category from a phone, on a world with no Lists rows (`seedSimWorld` without `simSeedLists`, so the seeds of
both sides run): the reference phone P (poc/sim_phone.js) registers a blank tag offline through the new-piece card with ➕
'ပိုးအင်္ကျီ' and ✅: P's lists_json holds the five and the new row, its outbox one `list` entry `{list: 'item_category', label:
'ပိုးအင်္ကျီ'}` besides the item and the group; pushed: every entry ok, the world's Lists hold the five built-ins (seeded by
`syncApplyListEntry`) and the new row with P's key, the server's item has the category; a second phone's pull offers it
(`itemCategoryOptions`) with the same key. The late rename with a custom category: a placeholder piece at the catch-all whose
photo meta names 'ပိုးအင်္ကျီ' → after the job the server's item has the AI name and that category, the phone's replay pushes the
same fields, answered `dup`; no `sync_conflict`, no owner ping. **B3**: the same again after the owner unticks 'ပိုးအင်္ကျီ' on
the server between the phone's last pull and the job (the job's ctx still names it): the server's rename and the phone's replay
agree (the item entry is `dup`), no `sync_conflict`, no Errors row, no owner ping. Fails without the list name in
`CFG.LIST_NAMES` and without `itemCategoryCats(job.ctx, …)` in poc/sim_sync.js and poc/sim_phone.js.

### 5.6 poc/run_app.js (step 3): steps 80-85 in a NEW `round6h(ctx)`, called at the end of `round6g` after step 79

`round6f` already exists (run_app.js:2729, step 74, called at :2720) and chains to `round6g` (:2893, :2902, steps 75-79); a second
top-level `round6f` would silently replace it and lose steps 74-79 (review ux B1). `round6h` is free in all four folders; its
call `await round6h(ctx);` is the last line of `round6g`'s body (after step 79, run_app.js:3095).

| Step | Checks | Fails without |
|---|---|---|
| 80 ★ The sample switch and badge (fakeDocument) | the new-piece form's `[data-f="sample"]` has `role="switch"`, `aria-checked="false"`, `aria-label` = `ui_lbl_sample`, the class `switch`, the text `ui_off`; after a click `aria-checked="true"`, `switch on`, `ui_on`; the row's label is `ui_lbl_sample` and `ui_sample_hint` is the line under it; no text in the form holds an emoji (`APP_EMOJI_ANY`); app.css defines `--good-ink` on `:root` and in both dark blocks and `.switch.on` uses it; a sample piece's home tile and form tile: `.nm` holds the name and one `.sbadge` 'နမူနာ', no '(နမူနာ)'; the sale form's line the same; `appItemView` of a sample: `title` = the name, `badge` = 'နမူနာ'; `appViewNode` draws `.vtitle` with the `.sbadge`; a non-sample has no badge; the item view's `sub` of a piece whose category label holds an emoji holds none (review m6) | 1.2, row 15 of 2.8 |
| 81 ★ Category chips and + | the chips are the five `cat:<key>` (plain labels, `other` last) and a last `cat:add` with the plus icon and `btn_add_cat`'s plain text; `cat:longyi` selects လုံချည်, a second tap clears; `cat:add` focuses `[data-f="catname"]` when the fake document records focus; `catname` 'ပိုးအင်္ကျီ', a price, Save: the item's category is 'ပိုးအင်္ကျီ', the outbox holds one `list` entry `{list: 'item_category', label: 'ပိုးအင်္ကျီ'}` with the item and the group, lists_json holds the five and the new row; a second form shows the new chip before `cat:other`; the snapshot's `category` reads the typed name and `catAdd` true before Save; a restored round-6 draft with `cat: 1` opens with လုံချည် chosen; app.css holds the `cat:` chip wrap rule (review m7) | 2.5 |
| 82 ★ Validation and duplicates | `catname` '' / '123' / '5000 ကျပ်' → Save refused, `.fmsg` = plain `add_ask_ic`, the field `.fbad`, nothing in the outbox, the tag still BLANK; 'နမူနာ' and 'နမူနာ ထမီ' → the `cathint` region shows plain `add_ic_sample` while typing and Save is refused with it; the ဝတ်စုံ row unticked on the world and pulled: 'ဝတ်စုံ' → `cathint` shows plain `add_ic_closed` ('ဝတ်စုံ'), Save refused with it, no `list` entry (review M6); 'ထမီ ' → `cathint` shows plain `add_exists`, Save stores ထမီ and queues no `list` entry; a form closed after typing a name writes no Lists row; a store without `addListOption` → `add_unavailable` | `appNewItemProblems`, `itemCategoryFind`, the view's `catHint`, the Save order |
| 83 The AI, the list and a restored draft | a Save with a photo queues a job whose `ctx.categories` equals `itemCategoryAi(ports, 'S1').names` (the custom name in it, the catch-all last); the phone's replay renames a placeholder at the catch-all to the custom category the server twin answered, the pushed entry is `dup` (with the named change of run_app.js:1502, 5.8); **B11**: a restored draft whose category is 'ဝတ်စုံ', after the ဝတ်စုံ row is unticked and pulled → no chip on (`view.catKey === ''`), Save stores 'အခြား'; a restored round-6 draft with `cat: 0`, after the htamein row is relabelled 'ထမိန်' and pulled → the `cat:htamein` chip is on and Save stores 'ထမိန်' | rows 8 and 12 of 2.8, the view's `catKey` |
| 84 Round-6b app texts | every key of section 4.3's block of `docs/design-round-6/SPEC-round-6b.md` (two) is in APP_MSG, non-empty and equal (parsed as run_app.js:1773-1780 parse 9.3); `appPlain` of each of the ten new MSG texts and the two changed ones holds no emoji | the keys |
| 85 ★ The loop in the app under quick (review M4) | a phone on a freshly seeded world (quick, the suites' default) with the sister enrolled: Menu, then `M\|restock` → the last card's text is plain `restock_ask_tag` and its datas `[['Z']]`, the state `restock_loop`; `appOnScanButton()` keeps the state (`appInputModeFor` gives null); `appOpenTagId('S1-0002')` → the count card: plain `group_item_line` + `ask_restock_qty`, datas with the four RQ presets, `RQ\|S1-0002\|other`, `RT\|skip` and `K\|S1-0002`; tap `RQ\|S1-0002\|5` → a plain `restock_done` line under 'S1-0002 · ' and then the `restock_more` card with `[['RT\|done']]`, one RESTOCK +5 in the outbox; `appOpenTagId('S1-0002')`, tap `RQ\|S1-0002\|other` → `appInputModeFor(state) === 'number'`; `appOpenMenu()` → the state is null; armed again, `appOpenTagId('S1-0002')`, tap `K\|S1-0002` → the item card, state null | the Scan rule for a state with no field, the loop (3.3) |

### 5.7 poc/check_simulator.js (step 4): a new step 6e after 6d (before step 7, check_simulator.js:559); the two tours (poc/sim_tours.js); the simulator's Lists tab

The tours (appended to `SIM_TOURS`, before `stranger`):

| id | Login · device | Steps (targets) | `done` of the last own-pane step |
|---|---|---|---|
| newcat | sister · app, `need: {blank: 'S1-0008'}` | `appTag('S1-0008')` (the new-piece form), `ff('cat:add')`, `fset('catname', 'ပိုးအင်္ကျီ')`, `fset('price', 25000, …, 'price:25000')` (a new category's chips are the defaults, 25,000 among them), `ff('sample')` (caption: what a sample is, and that it is not အခြား), `ff('save')`; then the owner's laptop: `{tab: 'lists'}` (caption: the item_category rows, rename, untick, Order, Detail, the catch-all always last) | save: the world's S1-0008 is ACTIVE with category 'ပိုးအင်္ကျီ' and sample true, and the world's Lists hold an item_category row of that label. Title 'ပစ္စည်းအသစ် · အမျိုးအစားအသစ် ➕ · နမူနာ' / 'A new piece with a new category, as a sample' |
| tgrestock | owner · tg | `menu()`, `cb('M\|restock')`, `tag('S1-0002')`, `ext(start('S1-0002'), {my, en})` (caption: the count screen comes back, not the item card), `cb('RQ\|S1-0002\|5')` (done `ledgerGrew('RESTOCK', 'S1-0002', qty 5)`), `tag('S2-0003')`, `ext(start('S2-0003'), {my, en})` (the same caption), `cb('RQ\|S2-0003\|1')` (done the same for S2-0003, qty 1), `cb('RT\|done')` | `tap('RT\|done')`. Title 'Telegram · ☰ 📦 ကုန်ရောက် · Tag အများ' / 'Telegram: restock several tags from the menu' |

`start()`'s shared caption "The item card comes back." (sim_tours.js:129-131) is wrong inside the loop, so tgrestock's two
start steps carry their own `my` / `en` through `ext` (review m11); the helper is not edited.

The simulator's Lists tab (poc/sim_ui.js:820-875, review m10): the `names` map (:829) gains `item_category: 'item_category ·
item categories'`, so the footnote counts it; the Detail sentence (:851) adds "or the emoji Telegram shows for an item category";
`addListRow` (:867-875) calls `addItemCategory(world.ports, label, SIM_USERS.owner, '')` when the list is `item_category` (the
sample and closed refusals apply: 'Not added: sample' / 'Not added: closed'), else today's `addListOptionByLabel`.

check_simulator 6e (each fails without its tour or page line): both ids exist and are unique; `newcat` runs on the app only, its
own-pane part ends at `f: save`, it has `f: cat:add`, a `catname` `fset` with a value, `f: sample`, and a later laptop step with
`tab: 'lists'`; its save step's `done` is true for a fake context whose world item S1-0008 has that category and the list row, and
false without the row; `tgrestock` runs on Telegram, its `cb` targets include `M|restock`, two `RQ|<id>|<n>`, `RT|done`, all
within 64 bytes; its two start steps' `en` do not say "item card"; each RQ step's `done` is true for a fake context with a RESTOCK
row of that item and qty after the mark and false for one before it; poc/sim_ui.js holds `' 🎨 sample'` and no `' (sample)'`,
`item_category:` inside the Lists tab's `names` map, and `addItemCategory(`. The existing `want` list (check_simulator.js:316) and
6b's `APP_TOURS` (:396) are not edited (they check supersets).

SIM.smoke is unchanged (check_simulator_browser stays 13). Manual browser checks (listed in step 4's report): both tours under
⏭ to the end; the laptop's Lists tab shows the five item_category rows from the start and six after `newcat`; adding 'နမူနာ'
there is refused; the app's switch and badge in light and dark (the on state readable in dark).

### 5.8 Every existing check that changes (the only edits allowed)

**For G2's first seed (review B1; step 1).** Measured in a scratch copy: with item_category last in `CFG.LIST_NAMES` and the
legacy branch, exactly these run_gas checks went red, and with the edits below the copy was green again (336 passed). The rule
for each: the Lists tab now holds 21 seeded rows (16 + the five item categories at rows 18-22), so every count of seeded rows
grows by 5 and every row number of a row added after the seed grows by 5; nothing else in the check changes. Labels that say "16
rows" say "21 rows". A NEW helper `defaultItemCategories(CFG)` goes right after `defaultLists` (run_gas.js:421-429), which itself
is NOT changed (run_gas.js:1480 builds a round-4 fixture sheet from it):
`return CFG.CATEGORIES.map((c, i) => ['item_category', CFG.ITEM_CATEGORY_KEYS[i], c, true, i + 1, '', CFG.CATEGORY_EMOJI[c], '', '']);`

| File:line | Label (today, short) | Change |
|---|---|---|
| poc/run_gas.js:441 | 'seeded with today\'s lists: 4 methods (CASH first), 9 expense categories …, 3 fabrics' | `same(L.values().slice(1), expected.concat(defaultItemCategories(CFG)))` (`expected.length === 16` stays); label '…, 3 fabrics, then the five item categories (round 6b)' |
| poc/run_gas.js:443 | 'every seeded row is active (the boolean true), has Order 1..n inside its list and a blank Shop' | `body.length === 21` |
| poc/run_gas.js:456 | 'the seed is one setValues block from row 2, never appendRow' | `c.rows === 21` |
| poc/run_gas.js:492 | 'the 16 rows are still there, once, and still active' | `=== 21`; label 'the 21 rows …' |
| poc/run_gas.js:498 | 'and it writes true into the blank Active cell of the row typed by hand, without seeding again' | `typed === 23`, `L.rows().length === 22` |
| poc/run_gas.js:513 | 'running setupSheet again finishes the tab: text columns, the 16 rows, the tick boxes' | `rows().length === 21`; label '… the 21 rows …' |
| poc/run_gas.js:520 | 'each nicety has its own try/catch: when the tick boxes fail, the tab is still seeded …' | `L.rows().length === 21` |
| poc/run_gas.js:529 | 'a Lists tab that lost a header cell gets the column back on the next setupSheet, without a second seed' | `rows().length === 21` |
| poc/run_gas.js:557 | 'seeded from them: the method_AYA label, the custom categories plus other, the custom fabrics as f1 f2' | `same(L.values().slice(1), expected.concat(defaultItemCategories(CFG)))`; label '…, then the five item categories' |
| poc/run_gas.js:581 | 'the Lists tab now exists as setupSheet would make it: the 16 old options plus the new one' | `rows().length === 22`; label '… the 21 seeded options plus the new one' |
| poc/run_gas.js:641 | 'append: a new key with a label becomes the row below the last one, active, Order = largest + 1' | `rowA._row === 23` |
| poc/run_gas.js:644-646 | 'never appendRow: the Key, Label, Detail and Note cells of the new row are set to @ first, then one setValues writes the row' | in the two lines that feed it (:644 `fmtA`, :645 `writeA`) `c.row === 23`; the check line itself unchanged |
| poc/run_gas.js:662-663 | 'detail: set on an account that has none; the stored Detail 09777123456 is that string, leading zero kept' | `L.value(23, …)` (:662) and `L.format(23, …)` (:663) |
| poc/run_gas.js:667 | 'detail: the same value is dup; a stale edit … overwrites nothing' | `L.value(23, …)` |
| poc/run_gas.js:670 | 'detail: replaced when detailWas is the stored value; label, Active and Order untouched' | `L.value(23, …)` in its four reads |
| poc/run_gas.js:706-707 | 'seed: the nine old categories and the new one are written as one block of ten rows …' | `lists(emptyAgain).rows().length === 22` (:707) |
| poc/run_gas.js:721 | 'tab missing: it is created and seeded through ensureListsTab (16 rows), then the option is appended' | `rows().length === 22`, `tea._row === 23`; label '(21 rows)' |
| poc/run_gas.js:730 | 'full grid: when the tab has no empty row left the sheet grows by the rows needed and the option is written' | `fullAt === 23`, `maxRows === 24`, `value(24, …)` |
| poc/run_gas.js:739 | 'a stray unticked box in row 400 does not move the next option away from the list: it goes to row 18' | `_row === 23`; label '… it goes to row 23' |
| poc/run_gas.js:748-749 | 'the whole body starts from a fresh read under the lock: an option another request added a moment ago is found (dup) …' | `lists(race).rows().length === 22` (:749) |
| poc/run_gas.js:466 | 'each of the eight header cells carries its Burmese note (Messages lists_note_<column>)' | the List cell (i = 0) carries `MSG.lists_note_list + '\n' + MSG.lists_note_item_category`, the other seven their own note (review B12); label '… (the List note also explains item_category, round 6b)' |
| poc/run_lists.js:354 | 'simSeedLists wrote the three lists: every row active, ordered, for both shops' | `w.lists.length === 4 + CFG.EXPENSE_CATEGORIES.length + 3 + CFG.CATEGORIES.length`; label 'simSeedLists wrote the four lists (item_category last, round 6b): …' |
| poc/run_lists.js:622 | 'an unparseable value counts as empty' | the expected object gains `item_category: []` (`listsJsonUpsert` fills every name of `CFG.LIST_NAMES`; measured) |

The checks of run_gas.js:1525, :1533 and :1557 (a round-4 sheet built from `defaultLists`) and :723 (`format(18, LC.Key)`, row 18
now being a seeded text row) stay green unedited (measured).

**The others.**

| File:line | Label (today, short) | Change | Step |
|---|---|---|---|
| poc/run_wizard.js:2051 | 'its rows: the price presets, …, [🏷 category, 🧵 sample], …' | label only: '[🏷 category, 🎨 sample]' (review m9) | 1 |
| poc/run_wizard.js:2075 | '🏷 → item_ask_cat with the five categories by index and ⏮' | `same(s.datas, CFG.ITEM_CATEGORY_KEYS.map(k => ['NI\|S1-0007\|c\|' + k]).concat([['LA\|ic\|NIC\|S1-0007'], ['NI\|S1-0007\|back']]))`; label '🏷 → item_ask_cat with the five categories by key, ➕ and ⏮ (round 6b, G2)' | 1 |
| poc/run_wizard.js:2079 | '🧵 marks the sample on the count line' | label only: 'the 🎨 toggle marks the sample on the count line (round 6b)' (review m9) | 1 |
| poc/run_wizard.js:2444 | '… the Telegram menu has none' | 3.6 | 1 |
| poc/run_wizard.js:2454 | 'in Telegram M\|restock does nothing (no menu button, no form)' | 3.6 | 1 |
| poc/run_round4.js:964 | 'the menu keeps three rows of three; the fourth row gains 🏛 အကောင့်' | 3.6 | 1 |
| poc/run_round4.js:1126 | 'without 🧵 and 📒 the fourth row is 🏛 alone' | 3.6 | 1 |
| poc/run_gas.js:1896 | 'source: gasSyncHooks().ai\'s photo branch calls aiRenameFields and writes photoUrl and the rename through one gasStore.updateItem' | the regex `/aiRenameFields\(cur, desc\)/` becomes `/aiRenameFields\(cur, desc, itemCategoryCats\(ctx, \{ store: gasStore \}, cur\.shop\)\)/`; the rest unchanged | 2 |
| poc/run_app.js:1502 | 'the phone\'s replay renamed the placeholder through aiRenameFields (the server\'s rule)' | the regex `/aiRenameFields\(item, j\.desc\)/` becomes `/aiRenameFields\(item, j\.desc, itemCategoryCats\(job\.ctx, phone\.ports, item\.shop\)\)/`; the rest unchanged | 3 |

### 5.9 Why everything else stays green, and the expected counts

- Measured (the scratch copy of 5.8): with item_category in `CFG.LIST_NAMES`, the legacy branch, the first seed and
  `simSeedLists` writing it, run_scenario, run_round4, run_wizard, run_sync, run_app and check_simulator stayed green unedited;
  run_gas and run_lists went red only where 5.8 names them. The List dropdown check (run_gas.js:449) and the lists_json key checks
  (run_gas.js:1096, run_lists.js:592, run_wizard.js:1261) compare with `CFG.LIST_NAMES` itself; the per-list fallback keeps
  run_lists.js:238 and :988-996; run_sync.js:632 `sameLists` names three lists.
- `categoryEmoji` is untouched (run_lists.js:365); the built-in Details are `CFG.CATEGORY_EMOJI`, so the card lines of
  run_wizard.js:201 and :267 keep '🧣'; no existing suite has a sample piece on a card except run_scenario.js:350-356, whose
  checks read substrings that 6b keeps.
- The legacy digit of 2.6 keeps run_wizard.js:2076-2077, :2132-2135 and run_sync.js:1923; `aiRenameFields` without its third
  argument keeps W25; `commitNewItem`'s fallback is still 'အခြား' for an unknown name.
- The menu's fourth row is pinned only where 3.6 names it; `RT`, `K|` and `M|restock` emit nothing longer than 16 bytes; an item
  card's `R|` screen is byte for byte today's (`restockQtyScreen` with `loop` false).
- No round-4, 5 or 6 text changes (4); the two changed texts are found by substring (4.2).
- The app's new-piece form had no check on `cat:<i>` or on the sample toggle's text; `appFormSnap`'s keys are not pinned
  (check_simulator.js:206 reads fields).
- **Expected after the round**: run_scenario 327, run_round4 345, run_lists 236 + about 14, run_wizard 512 + about 60, run_gas 336
  + about 10, run_sync 385 + about 8, run_app 542 + about 32, check_simulator 112 + about 10, check_simulator_browser 13. Every
  builder reports the real counts.

---

## 6. Build steps and file ownership

Nobody edits a file outside their step's list, and inside a shared suite only the regions named in 5; a needed change elsewhere
goes into the report. Each step's checker: the named suites end `0 failed`; `npx --yes acorn@8 --ecma5 --silent <file>` passes on
every changed `core_*.js`, `app_*.js`, `sim_*.js`; every new global was grepped first (0.2 holds them); then `node
tools/bundle_gas.js`, `node tools/build_app.js`, `node poc/build_simulator.js` (BEFORE check_simulator, which compares the
embedded sources, check_simulator.js:72), then every suite, check_simulator and check_simulator_browser.

1. **Core** (first, alone).
   - Files: `apps-script/core_config.js` (2.1: `LIST_NAMES`, `LIST_CODES.ic`, `LIST_PREFIX.item_category`, `ITEM_CATEGORY_KEYS`,
     `ITEM_CATEGORY_NEUTRAL`, `SAMPLE_EMOJI` '🎨', `SAMPLE_WORD` 'နမူနာ', `RESTOCK_LOOP_TTL_SEC` 180, their comments;
     `categoryEmoji` untouched); `apps-script/core_ledger.js` (2.3); `apps-script/core_messages.js` (4.1, 4.2);
     `apps-script/core_bot.js` (1.1, 2.6, 2.8 rows 1-3, 6, 7, 14, 3.1-3.3); `apps-script/gas_setup.js` (the List header note of
     2.7 in the header-notes nicety, :258-262; the Messages rewrite of 1.3 after :114; the header :10-12, :17-20; the seed loop
     itself is NOT changed); `poc/sim_seed.js` (`simSeedLists`' comment :118-123 only: "the four lists"); `poc/run_lists.js` (5.1
     and the two edits of 5.8); `poc/run_wizard.js` (5.2 and the five edits of 5.8); `poc/run_round4.js` (the two edits of
     3.6); `poc/run_gas.js` (ONLY the 5.8 rows of G2's first seed and :466, and the helper `defaultItemCategories` after :429:
     step 1 changes `CFG.LIST_NAMES` and gas_setup.js, which turn exactly those checks red).
   - Checker: run_lists, run_wizard, run_round4 345, run_scenario 327, run_gas 336, run_sync 385, run_app 542, check_simulator
     112, check_simulator_browser 13 (the phones and the server still call `aiRenameFields` with two arguments, which keeps
     today's rule, so steps 2 and 3 find their suites green).
2. **Glue and sync** (after 1).
   - Files: `apps-script/gas_sync.js` (2.8 rows 9-10 only); `apps-script/gas_import.js` (the comment at :7 only, 2.8 row 19);
     `poc/sim_sync.js` (`hooks.ai`'s photo branch, :208 only); `poc/sim_phone.js` (`applyAiResults`, :799 only);
     `poc/run_gas.js` (sections 33-35 before section 17, and :1896; step 1's edits stay as they are); `poc/run_sync.js` (R6l
     after R6k).
   - Checker: run_gas, run_sync; the step-1 suites stay green.
3. **App** (after 1 and 2: run_app 83 syncs against step 2's poc/sim_sync.js).
   - Files: `app/app_forms.js` (1.2's switch and line badge, `appFormBtn`'s two options, 2.5, row 8 of 2.8);
     `app/app_ui.js` (`appSampleBadge`, `appTiles`); `app/app_screens.js` (`appItemView`'s `title`, `badge` and `sub`,
     `appViewNode`); `app/app_sync.js` (`replayJob`, :407 only); `app/app_i18n.js` (4.3); `app/app.css` (`.sbadge`, `.fswitch`,
     `--good-ink` and `.switch.on`, the `cat:` chip wrap); `poc/run_app.js` (`round6h` with steps 80-85, its call at the end of
     `round6g`, and :1502). Not `app/config.js`, not `app/index.html`, not `tools/`.
   - Checker: run_app; build_app (its secrets scan passes); build_simulator, then check_simulator 112 stays green.
4. **Simulator** (after 2 and 3).
   - Files: `poc/sim_tours.js` (the two tours of 5.7); `poc/sim_ui.js` (:305, and the Lists tab :820-875 of 5.7);
     `poc/check_simulator.js` (6e).
   - Checker: build_simulator; check_simulator; check_simulator_browser 13 (or says skipped); the manual browser checks of 5.7.
5. **Docs** (last, alone).
   - Files: `apps-script/README.md` (the `item_category` list: written by the first seed (rows 18-22) and why, the fixed
     built-in keys, "rename = new pieces only", "untick, never delete", the catch-all always last, a name on two rows shown once,
     a hand-typed row needs a short ASCII Key (at most 12 bytes) or use ➕ instead, Detail = Telegram's emoji, the List note; the
     setupSheet rewrite of the two sample texts; 📦 in Telegram's menu and its loop: the count typed or tapped, ✖️ skips a tag,
     🛒 opens the card, a one-of-a-kind piece ends it, 180 s); `app/README.md` (the category chips and +, the closed and sample
     refusals, the sample switch and badge); `docs/USER-GUIDE.html` (below); `POS-PROJECT-PLAN.md` (a round-6b appendix; 12.4
     gains "a sample carries the 🎨 sign in Telegram and a 'နမူနာ' badge in the app"). `docs/USER-GUIDE.pdf` is regenerated only
     if the tree has a tool for it; otherwise the report says it is stale. Then a copy of the tree to
     `C:\Users\USER\Desktop\Noel-backup\r6b-built`; nothing published.
   - The guide (review M5; Burmese with the English line under it, as the guide does):
     - section 10, the app's new piece: :250 lists the chips as the app shows them, ending with the plus chip
       'အမျိုးအစားအသစ်' (a name field opens; Save adds the category; a closed name and the word နမူနာ are
       refused); :252 describes the switch 'နမူနာ' (ပိတ် → ဖွင့်), its hint line, and the small 'နမူနာ' badge
       a sample shows on the tiles and the item view; one sentence in the app's own words: "the badge နမူနာ is a sample; the chip
       အခြား is a category" (no emoji: the app shows none);
     - section ၂, Telegram's new piece: :379 names '🎨 နမူနာ: မဟုတ်' instead of '🧵 နမူနာ: မဟုတ်', and adds ➕ အမျိုးအစားအသစ်
       on the 🏷 screen; beside it a NEW box: '🎨 နမူနာ နဲ့ 🧵 အခြား မတူပါ။ အခြား က ပစ္စည်း အမျိုးအစား တစ်ခုပါ (ထမီ၊ လုံချည်၊ အင်္ကျီ၊
       ဝတ်စုံ မဟုတ်တဲ့ အထည်)။ နမူနာ က ဒီဇိုင်းဌာနက ဒီဇိုင်းအသစ် တစ်ခုစီအတွက် လုပ်တဲ့ တစ်ထည် နှစ်ထည်ပါ၊ အမျိုးအစား ဘာပဲ ဖြစ်ဖြစ်
       နမူနာ ဖြစ်နိုင်ပါတယ်။ နမူနာ ရောင်းရင် အစီရင်ခံစာမှာ "နမူနာ ရောင်း" ကော်လံမှာ သီးသန့် ပြပါတယ်။ Telegram မှာ ဟုတ်/မဟုတ်၊ အက်ပ်မှာ
       ဖွင့်/ပိတ် ဆိုတာ အတူတူပါ။' / 'Sample and Other are different: Other is a category (a garment that is not a htamein, longyi,
       blouse or set); a sample is one of the one or two pieces the design department makes of each new design, of any category,
       and the reports count samples sold in their own column. Telegram's yes/no and the app's on/off are the same switch.';
     - the laptop: the Lists tab's item_category rows (rename = new pieces only, untick to close, Order, the catch-all always
       last, Detail = Telegram's emoji; add new ones with ➕ / +, or give a short ASCII Key);
     - Telegram's ☰ 📦 ကုန်ရောက်: scan or type the tag, tap or type the count, ✏️ for another count, ✖️ to skip a wrong tag, 🛒
       ရောင်းမယ် when the scan was for a sale, the next tag, ✅ ပြီးပြီ; under `quick` the app's ☰ 📦 runs the same loop (Scan, then
       the keypad, to type a tag).

Parallelism: 2 and 3 touch disjoint files but 3 runs after 2; 4 needs 2 and 3; 5 needs everything. Files shared in sequence,
always in disjoint regions: `poc/run_gas.js` (step 1: the 5.8 rows of G2's first seed, :466 and the helper; step 2: sections
33-35 and :1896). Every report gives the suite counts and any file it needed but did not own.

---

## 7. Deliberately not built in round 6b

- **A rename that follows the pieces**: pieces registered before a Label change keep the old name (2.2); no bulk rename. The
  Items tab's Category cell changes a piece; the readers treat an old built-in name as its row and any other orphaned name as a
  custom category.
- **Deleting a category**: untick Active. A deleted row's chip is gone (only the catch-all comes back on its own, 2.3); a deleted
  custom one's pieces keep the name.
- **Writing item_category rows into a Lists tab seeded by a round-4, 5 or 6 build** at a later setupSheet (review B1's every-run
  append): no live Sheet has such a tab (2.7); those books get the rows at their first add.
- **Merging duplicate names on the server** (`syncApplyListEntry` answering `dup` for an equal name under another key): the
  readers show such a name once instead (2.3), and core_sync.js stays untouched.
- **Choosing a chip while a matching name is typed** in the app (review m12's last point): the hint says the name exists, and
  Save uses that row.
- **Per-shop categories in the app beyond the Shop column**, an emoji picker in the app (Detail on the laptop only; the app shows
  no emoji, F7), a category report or a Dashboard block.
- **Removing emojis from a typed label**: a label the family types with an emoji shows it in Telegram after the Detail emoji (a
  doubled emoji); the app shows the label plain (2.8 row 15).
- **Changing a registered piece's category or sample flag from the app or Telegram** (SPEC-round-6.md 12: the Items tab does
  that).
- **The other 🧵s**: 🧵 အော်ဒါ (`btn_orders`, core_messages.js:212), the SEWING status (`ORDER_STATUS_EMOJI`, core_config.js:50),
  the fabric expense category (`EXPENSE_EMOJI.fabric`, core_config.js:112) and `btn_card` '🧵 ကတ်' (:274) keep 🧵: they are not on
  the new-piece screens, and run_scenario.js:832-1153 and run_round4.js:923 tap them by their text.
- **`sample_mark`'s text** stays ' (နမူနာ)': it is printed in the stock report's cells, where no emoji is wanted (1.4); the
  owner's price ping (`price_ask_owner`) does not mark a sample.
- **A Telegram restock of several tags as ONE group** (the app form's job), a review card for restock in Telegram, and a range
  check of the item card's own ✏️ restock count outside the loop (`applyAwaitedNumber`'s `restock_qty` without `loop`,
  core_bot.js:910-916, predates the round; the loop's typed counts are checked, 3.3).
- **Ending the loop on a blank tag**: a blank tag scanned in the loop is refused with `basket_blank` (register it first) and the
  loop stays; only a one-of-a-kind piece ends it (3.3).
- **The loop in the app with forms** (its form already takes several tags), and moving 📦 to its own Telegram menu row: the
  fourth row may hold four buttons in Telegram as it already does in the app (13.11); one line of `showMenu` moves it if the owner
  finds it cramped.
- **A rollback of the bot below 6b**: an item_category `list` entry from a phone is quarantined `malformed` (core_sync.js:491 of
  that older build); the piece keeps its name. A rollback takes the app back with the bot (as SPEC-round-6.md 13.17).
- **mockup.html** is not redrawn; the simulator's two tours show the screens.
