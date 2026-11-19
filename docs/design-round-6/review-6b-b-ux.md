# Review of SPEC-round-6b.md: UX and tests (lens b)

Date 2026-11-18. Reviewer lens: the sample sign and its hint, the app form's + chip, name field, validation, duplicates,
retired categories, F7/F8; Telegram's ➕ and the restock loop for a seller with no computer habit; whether the new tests fail
without their features; whether the existing checks named to change are the right ones; file ownership; ES5.
The tree was compared with `Noel-backup/r6-built` first: they are identical, so nothing of 6b is built yet. Every
`file:line` below is in today's tree.

Verdict: one blocker (a test-function name collision that would delete existing checks), six major findings (the
restock loop's capture of scans, typed counts, untested features, the app-under-quick loop, the guide's app section, retired
categories), and minor findings. The new globals of 0.2 are all free (grepped across apps-script/, app/, poc/, tools/,
dist excluded), and so are `RT`, `NIC` and `round6h`. The menu-row checks named in 3.6 are the complete set (run_round4.js:964,
:1126, run_wizard.js:2444, :2454; :1726, :1761, :1786, :1823, run_app.js:494, :2492, :2501 and run_scenario.js:202 stay green).
The legacy digit keeps run_wizard.js:2076, :2132 and run_sync.js:1923 green (their taps are not strict, sim_phone.js:507).

## Blocker

**B1. `round6f` already exists in run_app.js.** 5.6 and step 3 ask for "steps 80-84 in a NEW `round6f(ctx)`, called at the
end of `round6e` (run_app.js:2525)". But run_app.js:2729 already declares `async function round6f(ctx)` (step 74). round6e
already calls it at :2720, and it calls `round6g` (:2893, :2902, steps 75-79). run_app.js is a CommonJS script (`'use strict'`,
:11), so a second top-level `async function round6f` silently replaces the first. Steps 74-79 would never run again: existing
checks deleted, which the conventions forbid. Fix: name it `round6h` (free), call it at the end of `round6g` after step 79,
and add it to 0.2.

## Major

**M1. The loop takes over every scan for ten minutes.** The `openTag` intercept (3.3) runs before every other branch, and
`restockAsk` re-arms the 600 s TTL after each save and each refusal (3.2). Picture a seller who never taps ✅ ပြီးပြီ (very
likely for a seller with no computer habit). She then scans a piece for a waiting customer and gets
'S1-0004 · … · လက်ကျန် ၅ / 📦 ဘယ်နှစ်ထည် ရောက်လဲ? [+၁] [+၅] …' instead of the sale card. Where the card's first button is
'✅ ရောင်း ၁', this screen's first is '+၁'. A one-of-a-kind piece gives 'basket_unique' and the ask again, and the scan she
made for the sale is lost. Fix: (a) when the loop refuses a piece that can be sold (unique, in stock), end the loop and show
that piece's item card with one line saying the restock finished; (b) on the loop's count screen, add a row
`[🛒 ကတ်] → K|<id>` (K| already skips the intercept); (c) a shorter TTL (about 180 s). W45 should check (a) or (b).

**M2. A typed count is not taken as the count.** The count screen asks "📦 ဘယ်နှစ်ထည် ရောက်လဲ?", so the natural answer is to
type '12'. 3.3 treats a typed number at step `qty` as nothing (only ✏️ အခြား first). Here is what happens in the code today. A
typed '7' with state `restock_loop` falls through handleText (core_bot.js:825-858) to the AI. The mock answers NEW_ITEM_INFO
(sim_mock_ai.js:145), and handleIntent (core_bot.js:1140-1141) answers `not_understood` plus the last item's card, which has
sell buttons. With AI off, `ai_off` plus the same card. In production, Gemini may instead propose a RESTOCK Y/N outside the
loop. W45's "a typed '7' at a loop's count screen … writes no RESTOCK" passes only because of the mock. Fix: at step `qty`, a
typed whole number from 1 to 999 commits like `RQ|<id>|<n>` (the state holds `itemId`) and re-arms with `restock_more`. Out of
range, answer `bad_qty` and show the count screen again. W45 asserts both, and the bare-tag-number rule stays at step `tag` only.

**M3. Several new checks pass without their feature.**
- W43 says it fails without "`itemEmoji` at the five call sites", but it checks only `cardText`, `showChoices` and
  `basketCardLine`. The notebook matches (core_bot.js:2545) and the add screen (`saleScreenAdd`, :2969) can keep
  `categoryEmoji` and W43 stays green.
- 2.8 row 6 (Telegram's `handlePhoto`: `{categories: cats.names}` and `itemCategoryPick(...) || cats.other`, core_bot.js:2370,
  :2376), row 7 (`buildAiContext` :785 and `readNotebook` :2525) and row 14 (`attachTagToItem` :4872) have no check anywhere
  in 5.
- Fix: add to W43 a sample row on the notebook matches and on the add screen. Add to W44: a photo whose mock meta names
  'ပိုးအင်္ကျီ' after it was added gives a card whose photo_seen names it, and the voice context holds the custom name.
  Add a design of a custom category whose tag attach keeps that category.

**M4. The loop in the app under `quick` has no check, and its words don't fit the app.** 3.3 says the app under quick runs the
chat loop, but 5.6 has no step for it.
- It works only because `appInputModeFor` (app_ui.js:72-84) gives `restock_loop` no input mode, so the Scan button keeps the
  state (`appDropWaiting(true)`, app_ui.js:950-955, :960-965). Giving the state a field later would silently break the loop.
- The app shows no field, yet `restock_ask_tag` and `restock_more` say "type the number (e.g. S1-0042 or 42)". The app's tag
  keypad wants four digits and a shop (app_ui.js:1067-1085), and it appears only after Scan.
- The count card's header `group_item_line` 'S1-0002 · name · လက်ကျန် ၅' is a '·'-joined value line in the app (13.1 rule 5).
- Fix: a run_app step on the quick world (P of run_app.js:492). ☰ 📦 shows the ask card. Scan keeps the state, and
  `appOpenTagId` gives the count card. RQ gives `restock_more`. Menu drops the state. Also say in 3.3 that the app's way to
  type a tag is Scan, then the keypad, and accept or fix the header line.

**M5. The guide edit for the app section is wrong (the owner's own question).** Step 5 says ":252 and :379 name '🎨 နမူနာ'
instead of '🧵 နမူနာ'" and puts the 🎨/🧵 box "near :252". But USER-GUIDE.html:252 is section 10, the app's new-piece form. It
has no 🧵 ('နမူနာ: မဟုတ်' → 'နမူနာ: ဟုတ်'). After 6b the app shows a switch (ပိတ်/ဖွင့်) and a text badge, never an emoji (F7).
Writing '🎨 နမူနာ' there teaches the app user a sign the app never shows, and the box would explain in emojis the app does not
have. Fix: :252 describes the switch 'နမူနာ' (ပိတ် → ဖွင့်), its hint and the badge. :250 lists the chips with the plus chip
အမျိုးအစားအသစ်. The box goes beside :379 (Telegram, where 🎨 and 🧵 are seen), with a sentence in the app section in the app's
words (the 'နမူနာ' badge, the 'အခြား' chip).

**M6. A typed name of a retired category is used silently.** `itemCategoryFind` matches retired rows (via `listFindByLabel`
on `itemCategoryRows`), and 2.5 and W9 store the retired name.
- In the app, the live hint says '"ဝတ်စုံ" ရှိပြီးသား · အဲဒါကို သုံးပါမယ်' ("already exists, will use it"), but there is no
  chip for it, which confuses the seller. Either way, the owner's untick on the laptop is bypassed piece by piece. Telegram
  does the same through `add_exists`.
- Fix (pick one and test it in 82 and W44): a retired match is refused with a short text saying the owner closed this
  category (the chips stay the choice); or it is used but the hint says it is closed and the owner sees it in the Note.
  Today's silent reuse should not be the rule.

## Minor

- **m1.** The "new step 6c" of check_simulator collides with the existing step 6c (check_simulator.js:458) and step 6d (:523).
  Call it 6e.
- **m2.** W45 taps `RT|done`, but the bench's `answer()` regex (run_wizard.js:170) has no `RT`, so the tap goes to
  `tapLastByKey`. Say "through `tapData`", or let the helper's list gain `RT`. It is a helper, not a check.
- **m3.** In the loop, the count screen's ✖️ (`Z`) clears the whole loop ('cancelled'). A seller who taps ✖️ to skip a wrong tag
  and then scans the next tag gets the item card. In the loop, ✖️ should re-arm step `tag` (`restockAsk` with `n` and
  `restock_more`), or use `btn_restock_done`.
- **m4.** In the loop, ✏️ အခြား edits the screen into `ask_number` '(ဥပမာ 25000)', a price example for a count, and the typed
  count has no range check (core_bot.js:910-916). A seller who copies the example adds 25,000 pieces. In the new loop path, use
  `item_ask_count` and `bad_qty` from 1 to 999. That changes only new code, not the item card's `R|`.
- **m5.** A hand-typed Lists row 'နမူနာ' is still offered as a chip and a button (`itemCategoryOptions`), although + refuses
  the word. 'နမူနာ ထမီ' passes. Filter rows whose `listNameKey` equals `SAMPLE_WORD` out of `itemCategoryOptions`, and let the
  sample check use "contains the word".
- **m6.** A category label typed with an emoji leaks into the app: the item view's `sub` prints `it.category` raw
  (app_screens.js:713), which breaks F7. Telegram shows the Detail emoji and then the label's own emoji. Use `appPlain` on the
  sub's category, or remove emojis in `itemCategoryFind`'s label.
- **m7.** `.formpage .toggle button { white-space: nowrap }` (app.css:285). A custom label of up to 40 characters overflows a
  343 px phone column and scrolls the page sideways. The category chips need `white-space: normal; overflow-wrap: anywhere`
  (and `.sbadge` keeps `nowrap`).
- **m8.** The sample switch's accessible name is its text 'ပိတ်'/'ဖွင့်' (role=switch on the button), not 'နမူနာ'. Pass
  `aria: tt('ui_lbl_sample')` (appFormBtn's `o.aria`). Two more points: `.switch.on` is white on `--good` #6FCF97 in dark mode
  (app.css:22, :277), about 1.9:1 contrast; and the same flag reads ဟုတ်/မဟုတ် in Telegram but ဖွင့်/ပိတ် in the app (say it
  in the guide, or use ဟုတ်/မဟုတ် on the switch).
- **m9.** Two labels will be stale after 6b, because the spec forbids editing them: run_wizard.js:2051 ('[🏷 category, 🧵
  sample]') and :2079 ('🧵 marks the sample'). Name them in 5.8 as label-only edits.
- **m10.** The simulator's Lists tab: the `names` map (sim_ui.js:829) has no `item_category`, so the footnote's counts leave it
  out. Its Detail sentence (:851) doesn't mention the item emoji. Its add-row path uses `addListOptionByLabel` (:868), with no
  sample refusal. Step 4 owns sim_ui.js ":305 only"; widen that to :829-868.
- **m11.** tgrestock: the `start()` helper's caption "The item card comes back" (sim_tours.js:130) is wrong in the loop, where
  the count screen comes back. The two `start` steps need their own captions.
- **m12.** The live `catexists` hint is `add_exists` with ' · ', while 4.3 itself keeps '·' out of the app's lines (13.1 rule
  5). It doesn't warn about the sample word while typing. The name field gets no focus when + opens it (one extra tap on a
  phone). A name that matches an active chip could select that chip instead of only hinting.
- **m13.** A hand-typed row needs a Key: `listNormRow` skips a row without one, and Telegram leaves out keys over 12 bytes (a
  Burmese key is 18 bytes or more). 2.7 invites the family to type rows by hand, so step 5's README and guide must say: a short
  ASCII Key, or add with +.
- **m14.** `itemCategoryAi(ports)` uses shop '', so an S2-only category is given to the AI for an S1 piece. Pass the piece's
  shop where it is known (Telegram's `handlePhoto` and the app's Save).
- **m15.** After a refusal at `n > 0`, the re-ask text is `restock_ask_tag`, which doesn't mention ✅ ပြီးပြီ, yet that is its
  only button. Use `restock_more` when `n > 0`.
- **m16.** New categories always sort after the catch-all: [… အခြား] [ပိုးအင်္ကျီ] [+]. The Order assigned at the add is max + 1,
  and the owner asked for + precisely because only "other" existed. Show the catch-all last in the chips and buttons unless
  the owner gave it an Order, or document "Order".
