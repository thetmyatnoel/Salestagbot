# Review of SPEC-round-6.md revision 3: UX and F7/F8 compliance

Lens: every app screen in the spec and the mockup obeys F7 (emojis only on main menu buttons, clean label/value lists) and
F8 (the English words; back, sync and settings icon-only with accessible labels). Back (F6) has to work for every screen,
form, overlay and the Android back gesture, without losing typed data or popping twice. The figure (F2) has to be usable with
a finger on a phone and work offline. The buyers page (F5), the history (F3) and the receipt (F11) have to be clear to a
seller who does not use computers.

Read: `SPEC-round-6.md` (revision 3, 3610 lines; top table, 1.0-1.11, 7.3-7.4, 10.7, 13.0-13.17), `mockup.html`
(14 screens), `FEEDBACK-1.md` (F1-F12, F9b), `BRIEF.md`. Every claim was checked against today's tree (`app/app_ui.js`,
`app/app_i18n.js`, `app/app_sync.js`, `app/app_ports.js`, `app/index.html`, `apps-script/core_bot.js`,
`apps-script/core_messages.js`, `poc/sim_ui.js`, `poc/build_simulator.js`). `appPlain` was run in Node on every MSG and
APP_MSG text, using the regex exactly as 13.1 prints it.

Verdict: **one blocker and nine majors**. Most come from the navigation stack (13.4) and from F7, which is only half
applied. The F1, F3, F4, F5, F10 and F11 designs are sound. They need the fixes below before step 3.

---

## Blocker

### UX-B1. `appNavReset` swallows the next n-1 back presses (13.4)
- **Problem.** At SPEC:2782, `appNavReset` does `APP.navIgnore += n; APP.win.history.go(-n)`. A traversal of several
  entries in one document fires **one** `popstate`, not n. So `navIgnore` stays at n-1, and the next n-1 real back
  presses (the header ← or Android back) are swallowed. Meanwhile the history keeps moving back, so `APP.nav` and the
  history fall out of step. The phone then closes the app with a form still open.
- **Evidence.** Here is a realistic path. ☰ Menu pushes `card` (SPEC:2787-2791). 👤 opens the buyers page (screen).
  A row opens the buyer page (screen). ငွေလက်ခံ goes through `appScreenAct`, which pushes `card`, and the home's card
  state shows. The bottom bar is on the home (SPEC:2749), so Scan is reachable, and Scan calls `appNavReset` with n = 4.
  One popstate arrives, leaving `navIgnore` at 3. The seller then scans a tag and the sale form opens. Their next three
  back presses do nothing, and a fourth leaves the app. Revoke and enrolment use the same function.
- **Fix.** Use `navIgnore += 1` for one `go(-n)`. Better still, key every entry with `{salestag: depth}` and let
  `appOnPop` compare `history.state.salestag` with `APP.nav.length` instead of counting events. Add this case to
  run_app step 59: n ≥ 2 layers, then Scan, then open a form, then back must close the form.

## Major

### UX-M1. No `card` layer after a form's Save, so the sold card has no ← (1.1, 7.3, 13.4)
- **Problem.** 1.1 says the card state shows ← (SPEC:399-400), and mockup screen 4 draws it. But `appFormSave` → `appCloseForm({saved: true})` (SPEC:1725)
  pushes nothing. `appOnChange` pushes `card` only when a delivered update turns the home from its scanner state into a card
  (SPEC:2789). While the form is open, :358 is told to leave `showScanner` alone (SPEC:1741), so that turn never happens.
  - **After a home-scan sale**, the stack is empty: no ←, and Android back leaves the app from the sold card. The
    receipt opened from that sold card (`RC|`) pops back to the scanner, not to the sold card (SPEC:2776), so the seller
    loses the undo and ငွေလက်ခံ buttons.
  - **`appFormLineCard`** (SPEC:1728) shows the item card through `phone.commit('card')`, which is not an `update`, so
    that card has no ← either.
  - **A form opened from an item card** keeps a `card` layer under it. When it is closed by back, `appCloseForm` sets
    `showScanner = true` (SPEC:1726). The scanner then shows ← with a stale layer, and one back press does nothing.
- **Fix.** `appCloseForm({saved: true})` and `appFormLineCard` push or keep one `card` layer. A close without Save goes
  back to the card state when a `card` layer is below (13.4's own screen rule). Add a run_app check: home scan, Save,
  `#back` shown, back gives the scanner, and ← from the receipt gives the sold card.

### UX-M2. Dropping and then pushing in the same tick, and an unguarded `appNavDrop` (13.4)
- **Problem.** `appNavDrop` calls the asynchronous `history.back()` (SPEC:2780). Several paths push a new layer in the
  same tick:
  - buyer form Save, then `appOpenScreen('buyer', id)` (SPEC:2903);
  - the known-phone chip "closes the form and opens that buyer's page" (SPEC:2894);
  - the tag keypad's 4th digit: `appCloseOverlay()` then `appOpenTagId`, which opens a form (app_ui.js:926-928);
  - the line-name tap.

  The spec does not say how the queued back traversal and the synchronous `pushState` are ordered, and browsers disagree.
  The result can be the history at a different depth from `APP.nav`. Second, `appNavDrop` is not guarded on a layer of
  that kind existing. `appOpenForm` and `appOpenMeasForm` call `appCloseOverlay()` on every open (SPEC:1716;
  app_ui.js:1004), and that close "drops a sheet unless fromNav". With no sheet open, it fires a stray `history.back()`
  and swallows it, which eats the entry of the `card` below.
- **Fix.** When one layer replaces another, use `history.replaceState` (no back, no ignore). When a push follows a drop,
  push only after the swallowed `popstate` has arrived. `appNavDrop` does nothing when no layer of that kind exists.

### UX-M3. Ways onto screens that bypass the stack: a dead end and a crash (13.3, 13.4)
- **Problem.** Revision 3 rewires the chip, gear, Scan and history handle, but these direct assignments in today's tree
  are left alone:
  - **The banner.** app_ui.js:408, the red banner's ကြည့်မယ် (shown in the two-days-unsent state), sets `APP.screen = 'sync'`. The
    stack is empty, so there is no ←, and the bottom bar is hidden (SPEC:2749). The seller is stuck on the sync
    screen exactly when sync is in trouble.
  - **The wipe.** app_ui.js:902 (re-enrol) sets `screen = 'enroll'` while the Settings layer is still in `APP.nav`. So ←
    shows on the enrol screen, against SPEC:2720, which defines `#back.hidden = !appNavCanBack()` and gives the enrol
    screen no exception of its own.
  - **The gear on the enrol screen.** SPEC:2737 keeps the gear there. It opens Settings, and then ← runs `appNavPop`,
    whose bottom is always `'home'` (SPEC:2776). On an unenrolled phone, `appRenderHome` → `appRecentPanel` reads
    `staff.shop` with `staff` null (app_ui.js:571-572), so the render throws. Today's rule, `deviceId ? 'home' :
    'enroll'` (app_ui.js:871), is lost.
  - **The simulator.** poc/build_simulator.js:156 (the `screen` op the tours' ⏭ uses, sim_ui.js:1188) also sets
    `APP.screen` directly and leaves stale layers behind.
- **Fix.** The banner calls `appOpenScreen('sync')`. The wipe calls `appNavReset()`. The bottom of `appNavPop` is
  `'enroll'` when there is no `deviceId`, and `#back` is hidden when `APP.screen === 'enroll'`. The `screen` op calls
  `appNavReset()` and then `appOpenScreen`.

### UX-M4. Android back depends on a Chrome intervention, and there are no real-phone checks for revision 3 (13.4, 10.7)
- **Problem.** 13.4 says the system back "does exactly what ← does" because the app pushed entries. Chrome on Android
  (88 and later, the history-manipulation intervention) skips, on back, entries that were added without user activation.
  Two of the spec's paths add entries like that:
  - **A camera scan opens a form without any tap.** The camera starts at boot from the pref (app_ui.js:318), and a decode
    opens the tag (app_ui.js:542, :563).
  - **The dirty-form re-push happens inside `popstate`** right after a native `confirm`.

  So the first Android back after a camera-only scan may leave the app instead of closing the form. Revision 3 adds no
  real-phone check: 10.7 (SPEC:2366-2383) has only revision 2's form checks. Nothing tests the stack across screens, the
  card state, the figure under a real finger, the PNG at a real `devicePixelRatio`, or `navigator.share` and
  `window.print` on Android and iPhone. The Node fake document has none of them.
- **Fix.** Add these real-phone checks (Android Chrome installed, iPhone Safari):
  - cold start → camera scan → form → back closes the form;
  - menu → buyers → buyer → receipt, then back four times;
  - a dirty form → back → "no" → back again;
  - draw on the figure, scroll past it, reopen the session;
  - receipt Share and PDF / Print.

  If the intervention is confirmed, push the first entry only after a tap, or design for a skipped entry: a base guard
  entry, with `replaceState` for transitions not started by a user.

### UX-M5. The figure traps the scroll, has no undo, and is sized only once (13.7.2)
- **Problem.** The pad is 2:3 and up to 320 px wide (SPEC:2982; the mockup says 300), so it is about 450-480 px tall. It
  has `touch-action: none` (SPEC:2984) and sits between the last group and the note, in the middle of a long scrolling
  form. On a 375 × 667 phone it fills nearly all the space between the 72 px head and the fixed `.fbar`. A finger that
  swipes up to reach the note draws a stroke instead. Scrolling is possible only on the 25-30 px margins. A seller who
  does not use computers will leave stray strokes, which also make the form dirty, and may not notice them. The tools
  are pen, whole-stroke eraser and clear: there is no "undo last stroke", the natural fix for a slip. The canvas is sized
  "once per form open" (SPEC:3028), so a rotation, a font-size change or the 700 px two-column switch misaligns the
  finger with the outline. ဖျက် (eraser) and ရှင်း (clear) are near-synonyms placed side by side in one `.seg`, so the
  clear action looks like a mode.
- **Fix.** Make the pad inert by default (`touch-action: pan-y`, no drawing) until ဆွဲ is tapped. That enters draw mode,
  with a Done that leaves it. Alternatively, open a full-screen drawing sheet from a thumbnail, as a `sheet` layer with
  back. Add `ui_sketch_undo` (icon `arrow-back-up`) that removes the last stroke. Map each pointer through
  `getBoundingClientRect()` at every event and redraw on `resize`. Draw clear as a separate button, not a segment.

### UX-M6. `appPlain` strips only the first emoji cluster of a line (13.1)
- **Problem.** I ran the regex printed at 13.1 on every text: 27 MSG texts and 3 APP_MSG texts still show emojis after
  `appPlain`. Rule 1 (SPEC:2583) says "Nothing else in the app shows an emoji". The worst cases are the flows the new
  buyer page starts (13.6):
  - `pay_ask_amount` '💰 👤 {customer} · …' becomes '👤 {customer} · …';
  - `pay_done`, `dep_ask_amount`, `dep_done`, `credit_done` and `confirm_payment` keep their '👤';
  - `receipt_thanks` 'ကျေးဇူးတင်ပါသည် 🙏' keeps its 🙏, on the receipt page and in the Share text (13.10 promises "no emoji");
  - the later lines of `today_query` and `cust_card` keep '💵 ', '🏦 ', '💳 ', '🕘 ';
  - `ui_pending_ai` '🎤/📸 …' becomes the garbled '/📸 …';
  - `ui_export_suggest` keeps '… 📤 ဖိုင်ထုတ် …'.

  Run_app step 57 tests only text where the emoji comes first, so this would pass the checks.
- **Fix.** Remove every emoji cluster anywhere in a line (a global replace, keeping `↔`/`→` only if wanted), then
  collapse doubled spaces and a leading ' · ' or '/'. Step 57 should check that no MSG or APP_MSG value contains an
  emoji after `appPlain` (except the job keys read through `APP.ttRaw`).

### UX-M7. Text that bypasses `APP.tt`, and hard-coded emojis (13.1)
- **Problem.** Rule 3 (SPEC:2590) relies on `APP.tt` alone. These paths never go through it:
  - **app_sync.js:84 has its own raw `tt`.** So `chipState().text` and `pendingLines()` keep their emojis on the sync
    screen (app_ui.js:842, :852) and in the red banner (app_ui.js:407). Only the chip's aria-label is said to be plain.
  - **The home** (app_ui.js):
    - :584, each tile's category emoji. Mockup screen 2's caption says "the recent tiles drop the category emoji", but
      no spec line changes `appTiles`, and the same tiles appear in the sale and restock forms.
    - :581-582, a raw `t` for the tile status ('⏳ စျေး …').
    - :593, a raw `btn_find` heading ('🔍 ရှာ').
  - **Elsewhere in app_ui.js:**
    - :626, the photo placeholder (the category emoji or 🧵);
    - :679, the report card's '📄';
    - :773, the copy fallback of `appShareText`, which toasts only '📋'. That is also what the receipt's Share shows
      when there is no share sheet: an emoji with no words.
    - :923, the tag keypad's '✅' key;
    - :670, the voice bubble's '🎤'.
  - **The spec's own tables.** 1.3's table still gives the line label as '{emoji} {id} · {name}' (SPEC:493) while the
    note under the drawing says it is dropped.
- **Fix.** Name each of these in 13.1 and 13.13:
  - app_sync's texts go through `appPlain` where the app draws them;
  - tiles and the placeholder use a plain id, or the `camera` icon;
  - the find heading uses `APP.tt`;
  - '📄' becomes an icon;
  - the copy toast becomes a new `ui_copied` 'ကူးပြီး';
  - the tag keypad's ✅ becomes 'OK'.

  Fix 1.3's line label.

### UX-M8. The clean lists stop short of the owner's own example (13.1 rule 5, 13.6, 13.9, 1.3, 1.6, 1.7)
- **Problem.** Rule 5 (SPEC:2604) says: no "·"-joined value strings. Yet:
  - **The buyer page's history row** (SPEC:2919, :2930; mockup screen 10) still prints 'ရောင်း · မင်္ဂလာ ဝတ်စုံ
    ရွှေရောင်' over 'ပေး 500,000 · ငွေသား'. That is the very line from the owner's pasted complaint.
  - **The sale form's running line** in `.fbar` (SPEC:484; mockup screen 3) is 'စုစုပေါင်း 83,000 ကျပ် · ပေးပြီး
    30,000 · ကျန် 53,000'.
  - **The confirmation cards** after the restock, expense and new-piece Save (`restock_done`, `restock_group_done` +
    `group_item_line`, `expense_done`, `item_created`) stay joined text. So do the cards after payment and deposit.
    13.9 gives views only to the item, sold and today cards, so two of the four job buttons end on the very pattern F7
    rejects.
  - **The Settings and sync screens** keep one-string rows ('👤 {name} · {shop}', 'ဖုန်း · {label} · …', 'နောက်ဆုံး
    ပို့ပြီး · {time}', app_i18n.js:78, :131-132). Mockup screen 13 draws them as `.kvr` rows with an empty value.
  - **Smaller cases:**
    - the AI line 'စာအုပ် · အသံ · ဓာတ်ပုံ အမည်';
    - the sold view's method 'ငွေသား 19,000 · KBZPay 5,000';
    - the item view's paid value ' · {n} ခု';
    - the shop row 'address · phone'.
- **Fix.** Make each of these a row or a table cell:
  - **the buyer history:** type and item on one line, then a muted `.kv`-style 'ပေးပြီး 500,000' and 'ပေးနည်း ငွေသား';
  - **the running line:** three right-aligned label/value pairs in the bar;
  - **the confirmation cards:** add views `restock`, `expense`, `newitem` (a title plus `.kv` rows) and `pay` / `dep`
    for the payment and deposit replies, passed like the sold view;
  - **Settings and sync:** label/value rows: ဝန်ထမ်း / ဆိုင် / ဖုန်း / ဘောက်ချာ စာလုံး / နောက်ဆုံး ပို့ချိန်.

### UX-M9. The card state's "Photo" handle is a leftover of the chat model (1.1, 13.1)
- **Problem.** The word table (SPEC:2628) and 1.1 (SPEC:398-399) keep `[(camera) Photo]` under every card. With no
  state waiting, a photo silently becomes the photo of the last scanned item (core_bot.js:2103-2108). So under a
  payment card, a buyer flow or the menu, "Photo" changes some item's picture without saying which. It is the same kind
  of unexplained chat input as the text box the owner asked about (point 4), and they will ask again.
- **Fix.** Show the handle only under an item card, labelled for that item (NEW `ui_item_photo` 'Photo ထည့်' plus the
  item id in its aria-label), or drop it from the card state. The new-piece form has its own Photo.

## Minor

- **UX-m1. Two different backs on one screen.** Core cards keep their own 'နောက်ပြန်' (`btn_back` '⏮ နောက်ပြန်',
  core_messages.js:335), which goes one step back. The header ← and Android back pop the whole card and clear the state
  (SPEC:2777). A seller sees two "back" controls that do different things. The cancel buttons are inconsistent too:
  `SS|…|z` (core_bot.js:504, :2415, :2530, :2543) reads 'မလုပ်တော့', while `Z` reads 'Cancel'. **Fix:** when the card
  has a `btn_back` button, ← runs it; map every `btn_cancel` text to 'Cancel', not only callback `Z`.
- **UX-m2. Stale history after a reload.** `reloadAfterForm` (app_ui.js:1170-1174) reloads with entries already pushed,
  and `APP.nav` starts empty, so back presses do nothing until the stale entries run out. **Fix:** at boot, when
  `history.state && history.state.salestag`, `history.go(-salestag)` once, swallowed.
- **UX-m3. The measurement form from the buyer page.**
  - **No confirmation.** The "saved" note is a bot message (`appMeasSave` → `botSay`, app_ui.js:253), which the buyer
    page never shows. **Fix:** add a toast.
  - **The `meas` layer.** 13.4 should say that `appCloseMeasForm({})` drops it on Save and revoke.
  - **Lost notes.** When the family hides the `note` row, `appMeasNoteMerge` returns the values unchanged and Save passes
    `notes: ''` (SPEC:2954-2961). The old notes are lost, against F1's "without loss".
- **UX-m4. The receipt page.**
  - The page of an **undone** sale (mirrored rows) is not defined, so a seller can Share a receipt for a sale that was
    undone. **Fix:** show `ui_hist_undone` on top, with no Share or undo.
  - The undo and void buttons and `ui_undo_until` must sit inside `.rc-actions`, or they print.
- **UX-m5. Words.**
  - `ui_lbl_qty` 'အရေ' (SPEC:3411) on its own reads as "skin"; use 'အရေအတွက်' or 'ခု' (native speaker).
  - F8's English word is not used everywhere: `ui_ai_photo` 'ဓာတ်ပုံ အမည်' (Photo), `ui_pending_setting` 'ဆက်တင် · …'
    (Settings), and the hints' 'ဖတ်' (`ui_home_scan_hint`, `ui_tag_scan_new`) next to a 'Scan' button.
- **UX-m6. F12 in quick mode and in Telegram.** 📦 is added only to the menu of the app in form mode (SPEC:3260-3266).
  In `quick` the app has neither the home tile nor the menu item. Telegram's menu is left alone "because
  run_round4.js:964 and :1126 pin them", but R9 lets the spec name checks that change. **Fix:** ask the owner whether
  F12's "main menu" includes Telegram's, or add 📦 there and name the two pins in 10.8.
- **UX-m7. Simulator tours.**
  - sim_ui.js:631 still marks `.pagehead .ghost`, which revision 3 deletes, so the pre-step highlights nothing.
  - The pre-step text names `ui_btn_back` '← နောက်သို့' (sim_ui.js:1401-1402), but the app's back is now an arrow
    alone.
  - 13.15 fixes only :1421. **Fix:** mark `#back` and name it by its aria-label.
- **UX-m8. The guide does not answer two of the owner's questions.** 13.16 step 5 (SPEC:3585) covers the history and the
  receipt but not what 📒 does (owner point 9, "what is the usage of book menu"). The AI line names 'စာအုပ်' without
  saying what it does.
- **UX-m9. Measurement sessions are missing from the history.** The history leaves out the sessions this phone saved
  (13.8 reads only the ledger), but a tailor will look for "the measurement I just saved" under မှတ်တမ်း. **Fix:** add
  them as rows that open the measurement form, or say why not in 13.17.
- **UX-m10. The mockup and the spec disagree.**
  - The figure's maximum width is 300 in the mockup and 320 in the spec.
  - The buyer table's date is '၁၂ အောက်' in the mockup, but `fmtDayShortMy` gives the full month, which wraps in a
    74 px column.
  - The sold card shows ←, which the spec's stack does not give (UX-M1).
  - 7.4 still lists `formPopIgnore` (SPEC:1736), while 13.4 says it is not built.

## Confirmed OK

- **F1.** The duplicate is real: `F.notesEl` at app_ui.js:1032-1035, next to the MeasureFields `note` row at
  core_config.js:92. 13.7.1 keeps the one field as a 300-character textarea, merges old notes into it, and prints it once.
- **F2.** It is in the design: the paper sheet's front-view woman (and a man), drawn with a finger, with pen, eraser and
  clear. It is offline from drawing to save to reopen. Only the PNG waits for a sync. It is printed on the measurement
  PDF and named on Telegram's measurement card.
- **F3.** The history (app_ui.js:827-835, the chat's last 200 messages) is replaced by this phone's ledger groups, one
  table per day (time / what / amount), with pending and undone marks. A row opens its receipt or its entry, with undo
  for the 30 minutes.
- **F4.** 'ပို့' and '✏️ ရိုက်ပါ' are gone. A labelled field with OK appears only for a question that waits; a search
  field with a magnifier only for `find`. No bar appears under report or view cards.
- **F5.** The buyers page has search, an icon-only + (aria-label), name, phone and owed per row, and a 60-row cap. The
  buyer form handles new and edit, with the known-phone and same-name checks. The buyer page lists one fact per row with
  its actions. It works in both sale modes.
- **F8, the header.** The word table covers every control: OK, Settings, Menu, Scan, Photo, Save and Cancel in English.
  Back, sync (seven states mapped to four glyphs, with a count badge) and settings are icon-only, each with an
  aria-label.
- **The icons.** The Tabler glyphs ship as inline SVG inside the precached bundle (build_app.js:30, :91), so nothing is
  fetched at run time and they work offline.
- **F7, the menus.** The four job buttons (through `APP.ttRaw`) and the ☰ menu grid keep their emojis, as allowed.
- **F9b, F10, F11, F12 (app home and menu in form mode).**
  - F9b: one owner-only AI switch, shown to sellers as disabled with a reason, and Telegram obeys it.
  - F10: a Shops section and shop form in Settings, plus a Shops block in the Sheet.
  - F11: Share (text only, through the share sheet) and PDF / Print (offline, through `print()`), with labels that say
    what they do.
  - F12: 📦 on the home and in the app's ☰ menu in form mode.
- **The mockup.** Colour tokens on `:root` with dark mode both ways, and icon-only controls with aria-labels in every
  header state.
