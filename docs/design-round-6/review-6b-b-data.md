# Review of SPEC-round-6b.md: data, sync and glue (reviewer b)

Lens: the item_category list through listRows / listOptions / lists_json / the `list` sync entry / ensureListsTab and a
second setupSheet run / gasStore.listOptions; a round-6 Sheet and old phones; every reader of item.category with a custom
value; name versus key storage; quick mode; the Telegram restock loop's callbacks and states against core_bot.js as built.
Tree checked: identical to `Noel-backup\r6-built` (nothing of 6b built). Line numbers are today's tree.

## What holds (checked, no finding)

- `CFG.LIST_NAMES` is the only gate in `listsJsonFor` (core_ledger.js:544), `listsJsonUpsert` (:566, keeps unknown keys,
  so a build without 6b preserves `item_category`), `listFindByLabel` (:744), `syncListRecReason` (core_sync.js:491),
  `gasStore.addListOption` (gas_store.js:709), the List dropdown (gas_setup.js:250), `simSeedLists` (sim_seed.js:127).
- Seeding agrees on every device: the phone seeds from `listRows` (= legacy when its lists_json `item_category` is `[]`),
  the server from `legacyListRows` (core_sync.js:572), the Sheet from the caller's `listRows` (core_ledger.js:766, 772,
  listUpsert :594-599). Legacy rows for item_category read no Settings, so keys and labels are identical everywhere.
- `listKeyFor` can never produce a built-in key (slug + 4 hex; 'htamein', 'longyi', 'eingyi', 'wutsone' need non-hex
  tails; 'other' is excluded at :685). Generated keys stay at most 11 bytes; `syncListRecReason` accepts them.
- A second setupSheet run: no seed (`gasListsLastRow() < 2` false), the dropdown rule is rewritten with the new name,
  the 1.3 Messages rewrite finds nothing. The live round-3 bundle holds exactly '🧵 နမူနာ: ဟုတ်' / '🧵 နမူနာ: မဟုတ်'
  (Noel-backup/deployed-v2-2026-11-03/Code.js:286-287), so the exact-text rewrite matches.
- Existing list checks stay green: run_gas.js:1096, run_lists.js:229/238/592-597/989-996, run_wizard.js:1261 all compare
  against `CFG.LIST_NAMES`-driven values; run_sync.js:632 `sameLists` names three lists only.
- Quick mode: the quick photo chain writes through `updateItem` (core_bot.js:2463-2467), not commitNewItem; row 6's
  `itemCategoryPick(...) || cats.other` gives a list label there, so quick stores canonical names too.
- Old phones: the app was never published; an older bundle would ignore the new lists_json key. No finding.
- G3 menu checks: run_round4.js:964, :1126 and run_wizard.js:2444, :2454 are the only pins; :1726, :1761, :1786, :1823,
  run_app.js:494, :2492, :2501, run_scenario.js:202, :845 hold.

## Findings

### B1 (major) LIST_LAZY hides the five built-ins from the laptop, so G2's owner path does not exist until a first add
Spec 2.7 keeps item_category out of every seed (ensureListsTab gas_setup.js:227-235 only seeds a tab with no rows, and
6b skips LIST_LAZY even then); rows appear only when someone ➕ adds (listUpsert seeds only an EMPTY list,
core_ledger.js:594-599, with `rows = listRows(...)` from :766). Consequences:
- After the publish the owner opens the Lists tab and finds no item_category row to rename, untick or order, while G2
  (FEEDBACK-2.md:33-34) says "the owner renames, retires or reorders on the laptop's Lists tab".
- The workaround (2.7 "type rows by hand") needs the hidden fixed keys: a typed Label 'ထမိန်' does not rename ထမီ (new
  key, new name: both are offered); only a typed Key 'htamein' does.
- Once any hand-typed item_category row exists, the first ➕ seeds nothing (the list is not empty), so the built-ins stay
  virtual forever and never appear on the laptop.
The stated reason is test convenience (fourteen run_gas checks pin the 16-row seed); the conventions allow named checks to
change. Fix: setupSheet (every run, also the second) appends the five item_category rows at the end of the tab when the tab
holds no item_category row, after the existing 16-row first seed (so run_gas section 2's row numbers 2-17 hold; name the
count checks that move as allowed edits); keep the virtual merge only for a Sheet that has not run setupSheet since 6b.

### B2 (major) A photo sent while Telegram's ➕ category prompt waits is saved onto ANOTHER item
The ➕ wraps the card in `{kind: 'await_text', purpose: 'add_option', saved: <new_item>}` (2.6) and only `newItemFormState`
learns to see through it. `handlePhoto` reads the raw state: `if (!state || state.kind !== 'new_item')` (core_bot.js:2346)
takes the "photo of the last scanned item" path, `updateItem(last.id, {photoUrl, photoFileId})` (:2349-2350). A blank tag
never becomes the last item (openTag's new_item path, core_bot.js:151-155, has no setLastItem), so `last` is whatever the
seller scanned before, often a sold piece: its photo is replaced, and the card loses the round-6 rule "a second photo while
the card is live only changes the photo" (:2354-2360). Same blind spot, harmless: `P|`, `C|`, `PS|` of an older card answer
`expired` while the prompt waits. Fix: a helper `newItemStateOf(state)` (the state, or `state.saved` for a waiting add state
with list item_category) used by handlePhoto (restore the saved card, take the photo as its second photo) and by
toggleSample / newItemPrice / newItemCost; W44 gets "a photo during the ➕ prompt changes the card's photo, no other item".

### B3 (minor) Server rename and phone replay use different lists: a false sync_conflict and an owner ping
Rows 10-12 of 2.8 give the server `itemCategoryAi({ store: gasStore })` and the phone `itemCategoryAi(phone.ports)`, while
the AI itself was given the phone's `ctx.categories` (row 8). When the owner unticks or renames a category on the laptop
after the phone's last pull, the AI may answer the old name: the server finds no hit (keeps the catch-all), the phone's
replay hits and pushes `category`; the server's rename already bumped Rev, so core_sync.js:780-808 flags `sync_conflict`,
logs an Errors row, pings the owner and writes the phone's (retired) value. Fix: both sides build `cats` from the job's own
context when present: `{names: ctx.categories, other: ctx.categories[ctx.categories.length - 1]}` (itemCategoryAi puts the
catch-all last), else the local list. The result is then identical by construction (R6l / step 83 stay dup).

### B4 (minor) A hand-typed row named အခြား under another key makes a dead catch-all chip and button
itemCategoryRows drops the built-in 'other' when its NAME is present (2.3), so with a typed `{key: 'misc', label: 'အခြား'}`
no row keyed 'other' exists; itemCategoryOptions then appends "the built-in" catch-all. Its chip `cat:other` / button
`NI|<id>|c|other` look the row up in itemCategoryRows (2.5 set, 2.6 pick), find nothing and do nothing; the screen shows two
'အခြား'; itemCategoryAi's names hold 'အခြား' twice. Fix: merge the 'other' built-in by key only (it is the catch-all), or
let the pick functions resolve against the same rows itemCategoryOptions returned.

### B5 (minor) The sample word is refused only through ➕; a 'နမူနာ' row is still offered as a category
itemCategoryFind refuses 'နမူနာ' (2.3), but itemCategoryRows / itemCategoryOptions / itemCategoryAi do not filter it: a row
typed on the laptop, or added through the simulator laptop's add row (poc/sim_ui.js:859, :868 call addListOptionByLabel,
which skips the sample check), becomes a chip, a Telegram button and an AI answer, and commitNewItem stores it (itemCategoryOf
matches it). Names that contain the word ('နမူနာ ထမီ') pass too. This undoes G1's separation. Fix: itemCategoryRows skips
(and logs once) a row whose listNameKey equals or contains listNameKey(SAMPLE_WORD); itemCategoryFind refuses names that
contain it; the simulator's add row uses addItemCategory for item_category.

### B6 (minor) Old built-in names become the catch-all at commit after a rename
commitNewItem, importProducts and attachTagToItem store "the matching row's label, else the catch-all" (2.3, 2.8 rows 13-14).
After the owner relabels the htamein row, inputs that still carry the old CFG name are demoted to 'အခြား': the Designs tab's
Category (typed long ago, read at core_bot.js:4871-4872), the Import tab, a restored app draft (2.5 converts `cat: 1` to
'လုံချည်'), a Telegram card picked before the rename. itemCategoryEmoji (2.3) deliberately treats an old built-in name as
known, so the readers and the writers disagree. Fix: itemCategoryOf falls back to the row keyed `ITEM_CATEGORY_KEYS[i]` when
the name equals `CFG.CATEGORIES[i]` (store its current label); an unknown name stays the catch-all.

### B7 (minor) The photo AI ignores the Shop column
2.7 says Shop limits a chip to one shop, and the chips use `itemCategoryOptions(ports, <piece's shop>)`, but itemCategoryAi
uses `itemCategoryOptions(ports, '')` (every shop). The AI may give an S1 piece a category the owner limited to S2, through
handlePhoto (row 6), the app's job (row 8) and the late rename (rows 10-12). Fix: `itemCategoryAi(ports, shop)` with the
piece's shop at every caller (app_forms.js:518 knows it; handlePhoto has the item; the server rename has `cur.shop`).

### B8 (minor) RT|done does not end a loop parked at the typed-count prompt
`RQ|<id>|other` in the loop replaces the loop state by `{kind: 'await_number', purpose: 'restock_qty', loop}` (3.2 table,
today core_bot.js:563). `case 'RT'` clears only a `restock_loop` state (3.3). A seller who taps ✏️ and then ✅ ပြီးပြီ on the
older offer reads "done", yet a number typed later still writes a RESTOCK (applyAwaitedNumber :910-916) and re-arms the loop
with `restock_more`. Fix: RT (and dropAddState) also clear an await_number restock_qty state that carries `loop`.

### B9 (minor) A number typed at the loop's count screen goes to the AI and buries the count screen
At step `qty` only the RQ buttons count (3.3 handleText rule is step `tag` only). A typed '7' falls through handleText to
parseText; the mock answers NEW_ITEM_INFO and `fallbackToButtons` (core_bot.js:1184-1188) sends `not_understood` plus the
last item's card, which becomes the last message (the app under quick shows only the latest card); with AI off the same with
`ai_off`. With Gemini, awaiting 'restock_loop_qty' is unknown to the prompt. Fix: at step `qty` a typed whole number 1..999
is the count (the same commit and offer as `RQ|<id>|<n>`); W45's "typed '7' writes no RESTOCK" becomes "typed 7 restocks 7".

### B10 (minor) The loop catches every scan for ten minutes, including a scan made to sell
openTag's intercept runs before every branch (3.3) and the state lives 600 s after each save (3.2). A seller who forgets
✅ ပြီးပြီ in a busy shop and scans a piece for a customer gets the count screen (stock item) or `basket_unique` on top of
`restock_ask_tag` (a one-of-a-kind piece) instead of the item card. Fix: the count screen and the refusal carry a second
button that opens the item card and ends the loop (`K|<id>` after clearing), or the intercept applies only while the loop's
own prompt is the last bot message.

### B11 (minor) A restored draft can save a category that no chip shows
The view lists only active options for the shop (2.5 `itemCategoryOptions`), the chip is on only when `v.category ===
c.label`, but Save stores any name itemCategoryOf matches, retired or of another shop included (2.3 commitNewItem rule). A
draft restored after the owner unticked its category shows no selected chip and still saves the retired one. Fix: on
restore (or in the view) clear a category that is not among the options, or show it as an extra selected chip.

### B12 (minor) The Lists tab never explains item_category
The List header note (lists_note_list, core_messages.js:415) names three lists, lists_note_detail (:421) says "account / expense
emoji", lists_note_label (:417) says a Label may be edited freely, which for item_category orphans old pieces (2.2). Section 4
changes no round-4 text and adds no note, and the live notes come from the Messages tab anyway. Fix: a new Messages key
(e.g. `lists_note_item_category`) appended to the List header note by ensureListsTab's header-notes nicety, and the
item_category consequence of a Label edit in it.

### B13 (minor) Sync can duplicate a category name
syncApplyListEntry upserts by key only (core_sync.js:566-574). A phone whose lists_json predates a hand-typed laptop row
of the same name (or a key drawn from uuid after a collision) adds the same Label under its own key; the server appends a
second row and both channels show two identical chips. Harmless for stored data (names), visible on every new-piece screen.
Fix: for item_category, syncApplyListEntry answers `dup` with the existing key when a row of the same listNameKey exists
(itemCategoryFind), or itemCategoryOptions drops later rows of an equal name.
