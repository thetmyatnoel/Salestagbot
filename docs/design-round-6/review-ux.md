# Review: app forms and Telegram UX (SPEC-round-6.md)

Date 2026-11-13. Lens: APP FORMS AND TELEGRAM UX. Adversarial review of `docs/design-round-6/SPEC-round-6.md` (with
`mockup.html`, `map-app-forms.md`, `map-core-commits.md`, `map-sim-tests.md`, `docs/design-round-5/map-basket-readers.md`)
against the CURRENT tree (rounds 4 and 5 built). Every screen was walked against `app/app_ui.js`, `app/app_scan.js`,
`app/app_ports.js`, `app/app.css`, `app/app_i18n.js` and `apps-script/core_bot.js` / `core_messages.js` as built. No
code or test was changed. Two scratchpad scripts checked every quoted label against MSG / APP_MSG and every new key for
clashes (results under "Confirmed").

Summary: 2 blockers, 13 major, 10 minor. The two blockers are both in the scanner of an open form: the home's render
glue stops the form's camera, and once that is fixed the camera reads the same tag again after about 2 s and raises a
stock line's count by itself, on the default "scan then Save" path.

---

## Blockers

### U1. The home's render glue kills the form's camera (1.0 "Scanning inside a form", 7.4)

- **Problem.** The spec lets the form own the one scanner (`appFormScanStart` calls `appStartScanner()`, and the
  `screen`/`showScanner` guard is skipped while `APP.form.scan` is set, 7.4). That is not enough. Every `appRender()`
  ends with `if (APP.screen !== 'home' || !APP.showScanner) appStopScanner();` (app/app_ui.js:388). The 7.4 hook table
  never mentions this line. `APP.showScanner` is false in three of the four ways into the sale form:
  1. a home scan: `appOpenTagId` sets it false before `/start` (app_ui.js:563-567);
  2. 🛒 in the compact card-state row;
  3. a card button such as `S|`, `D|` or `R|` (the card state).

  `appStartScanner` calls `appRender()` itself, once at 'starting' (app_ui.js:538) and once at 'running' (:551). It
  also commits the `cameraOk` pref (:550), which goes through `appOnChange` back into `appRender`. The deliver that
  opened the form emits `change {kind:'update'}`, and `appOnChange` answers it by setting `showScanner = false` (:358).
  The result: the strip's camera is stopped the moment it starts. "Scan many" dies after the first tag.

  Separately, the strip never shows the scanner's state ('starting', 'running', the camera-denied error, the start
  button). That drawing lives only in `appScannerPanel` (:507-531), which `appRender` draws for the home, not for the
  form.
- **Not caught by any planned check.** `fakeDocument` has no camera (run_app.js:850-888). The simulator frame has no
  camera (map-app-forms 4). The manual checks of 10.7 all run on the simulator.
- **Fix.** Add to 7.4:
  - :388 stops the scanner only when no form owns it (`!(APP.form && APP.form.scan)`);
  - `appOnChange` :358 leaves `showScanner` alone while a form is open, or `appOpenForm` sets `APP.showScanner = true`
    while the form owns the scanner;
  - every scanner state change (`onDecode`, `onError`, 'starting', 'running') repaints the strip of an open form;
  - add to 10.7: "on a real Android phone and an iPhone: home scan opens the form, a second tag is read in the strip".

### U2. The camera reads the same tag again and raises the count by itself (1.0, 1.2 table, 1.6)

- **Problem.** The form restarts the scanner `APP_FORM_RESCAN_MS` 700 ms after each read (1.0). `createAppScanner`
  ignores the same text only within 2000 ms of the last accepted read (app/app_scan.js:45-47). A tag that stays in view
  is therefore read again about 2 s later, and again every ~2.7 s, with a vibration each time (:50). The router's rule
  "a stock item already in: its count + 1" (1.2) then raises the count silently; for a one-of-a-kind piece the
  `basket_twice` toast repeats.

  The default path is the worst case. A home scan opens the sale form and `appOpenForm` restarts the camera at once
  (7.3, when `cameraOk` is set), while the phone still points at the same tag. A seller who holds the phone flat over the
  table to read the screen sells ×2 with one scan and one tap of Save. The total shows it, but the screen gives no
  warning. Restock has the same flaw (1.6: "the same stock item again: + 1"), so the stock comes out wrong.
- **Fix.** Inside a form, ignore any read of an id that is already a line until a different id was read, or until a long
  window passes (e.g. 8 s), whichever comes first. Or never use a re-scan as +1: the stepper is the count (R2). If +1 by
  re-scan stays, make it a visible toast ('S1-0002 × ၂') and add a W/run_app check: "the same id read twice within N s
  adds nothing".

---

## Major

### U3. A restored draft merges into the next customer's sale, and the line-name round trip adds +1 (1.0 Draft, 1.3, 7.2)

- **Problem.** 1.3 says: "A sale draft younger than 1800 s is restored first and the new line added to it". A draft
  survives an app kill (common on low-RAM Android when the seller switches to KBZPay to check a transfer) and the
  line-name tap (`appFormLineCard` keeps it, 7.3). So the next home scan within 30 minutes, which may be the next
  customer's piece, opens a form holding the abandoned basket plus the new line. The only cue is the
  `ui_form_restored` strip, and Save is still one tap. This is exactly what 0.3 rule 1 forbids in Telegram ("an earlier
  customer's basket never absorbs the next customer's piece").

  Also, the line name opens the item card. Its natural way back, the card's ✅ `S|` or 💬 `D|`, calls
  `openForm('sale', {itemId, qty: 1})`. `appSaleInit` then adds `req.itemId` to the restored lines through `appSaleAdd`
  (7.2), and a stock line goes to count + 1. `🔄 အသစ်` (`restored:clear`) also drops the line that was just scanned.
- **Fix.**
  - Restore without asking only from 🛒 or from the line-name return.
  - A scan or a card button that finds a draft shows the strip as a choice first: [continue] keeps the old lines and adds
    the new one; [🔄 new sale] drops the old lines and keeps the new one.
  - Never add a `req.itemId` that is already a line of the restored draft.

### U4. The number keypad appends to its initial value (1.0 "Numbers have one entry style", 1.3 price, 1.8)

- **Problem.** `appOpenNumberKeypad` starts from `spec.initial` (app_ui.js:942) and appends each key (:952, 10-digit
  cap). The only precedent passes the current value (`initial: APP.qty.n`, :721), so on today's stepper typing 5 after
  1 gives 15. The spec never states `initial` for a `.fnum`. If the builder follows the precedent, re-pricing an
  18,000 line by typing 1, 5, 000 gives 1,800,015,000. A line price has no upper bound (`basketCheck` `need_price` only
  asks for ≥ 1, 4.2).

  The tap counts of 1.8 ("price, 1, 5, 000, OK") assume an empty keypad. The transfer, paid-now, cost and count keypads
  have the same problem.
- **Fix.**
  - Every `.fnum` opens the keypad empty (`initial: 0`), with the current value in the title or the display's
    placeholder; or give `appOpenNumberKeypad` a "first key replaces" rule.
  - Add a soft warning when a line price is more than 10× the item's price.
  - Add a run_app check on the keypad's first key.

### U5. A full repaint while typing breaks inputs and the camera strip (7.3 `appFormRepaint`, 7.4 `phone.on('sync')`)

- **Problem.** "A repaint replaces F.el's children and keeps the focus on the same data-f". Several things repaint while
  the seller is typing:
  - the buyer search lists chips on every keystroke (1.3);
  - the phone label follows the typed name;
  - a background sync repaints an open form (7.4).

  Rebuilding a focused `<input>` loses the caret and ends an IME composition, which matters for Burmese keyboards. A
  sync that lands mid-word rebuilds the field. The measurement form never rebuilds an input while typing: it rewrites
  only the `.vid` line (app_ui.js:1104-1107, :1112-1119).

  The repaint also re-parents `APP.videoEl` into a new strip each time. iOS pauses a moved `<video>`.
  `appScannerPanel` replays it (:522), but the strip has no such rule.
- **Fix.**
  - Text inputs update `values` without a repaint, and only the dependent region is redrawn (the chips, the phone label,
    the running line).
  - The sync repaint skips a form whose input has focus, or redraws only the lines.
  - The strip node is kept across repaints, or replays the video as :522 does.

### U6. The reused CSS does not fit the form rows at phone width, and the mockup hides it (1.0 layout, 1.3, 1.5, 1.7, 7.6)

- **Problem.**
  - `.seg` does not wrap (app.css:147-148), yet 1.3 says the how-paid row "wraps". That row has 💵, every wallet
    (unbounded), 🏛 and 💵+🏦, and the promised-day row has five choices.
  - `.formpage .toggle` does not wrap (:185-186). It carries five category chips (1.5) and the six or more expense
    categories plus ➕ (1.7).
  - `.stepper` keys are 64 × 64 px at 30 px (:98-100). The line "[18,000 ကျပ်] [−] ၂ [+] 36,000" needs about 360 px on a
    line about 300 px wide (360 px phone minus the `.fcol` and `.fline` padding).
  - `.fcol` reserves 110 px at the bottom (:172), but the sale bar holds the running line, `.fmsg` and a 60 px Save,
    about 140-170 px with a refusal showing. The last row, the promised day, which is the very row Save refuses on,
    sits under the bar.

  The mockup draws 15-16 px text, 44-48 px controls and its own `.seg{flex-wrap:wrap}` (mockup.html:96-126). That breaks
  1.0's "every tap target is at least 56 px" and does not match the app's CSS, so the form looks shorter and tidier than
  it will be.
- **Fix.** 7.6 adds:
  - `.formpage .seg, .formpage .toggle {flex-wrap: wrap}`;
  - a compact `.fline .stepper` with the line on two rows (price and amount, then the stepper);
  - a bottom padding that follows the bar's height (or a non-fixed bar on a phone);
  - Telegram's wallet collapse (one 📲 Pay အကောင့် choice when the screen would exceed six answers, core_bot.js:2621).

  Then redraw the mockup at the app's real sizes (18 px body, 20 px buttons, 56/64 px targets).

### U7. In the app there is no way to add a new account during a sale unless one already exists (1.3 account rows)

- **Problem.** ➕ (`acct:add`) exists only "as the last choice of the revealed list", after 🏛 or 💵+🏦:
  - 🏛 shows only "when a bank-kind account exists";
  - 💵+🏦 shows only "when a non-cash account exists".

  A shop with cash only has no ➕ at all. A customer paying with a wallet that is not listed yet can only be booked
  through the mixed path. Telegram's how-paid screen always ends with ➕ (`LA|pm|SSA|<a>`, core_bot.js:2632), and the
  family asked for adding an option on the fly (round-3 feedback).
- **Fix.** A last `➕` choice on the how-paid row (`pay:add`, which reveals `acctname` and the kind). The new key becomes
  the method, and the Lists row is written at Save (3.9).

### U8. A buyer name typed in the search is dropped at Save (1.3 buyer rows, 4.2 `basketCheck`)

- **Problem.** The search field only lists matches. The name and phone fields appear only after ✏️ (`buyer:new`). A
  seller who types 'ဒေါ်နီနီ' and taps Save without picking a chip or ✏️ gets:
  - for a full payment, a sale with no buyer, silently;
  - for a part payment, the refusal `sale_need_buyer` 'ℹ️ မကျေသေးရင် ဝယ်သူ နာမည် လိုပါသည်' ("a buyer's name is
    needed"), although a name was just typed.

  The spec only defines "empty = no buyer".
- **Fix.** At Save, text left in the search with no pick is handled as ✏️ (the name/phone split of `buyer:new`) when
  nothing matches exactly. Otherwise Save refuses with the search row outlined (`.fbad`) and the matches shown.

### U9. The app silently changes who the buyer is (1.3 new buyer, 3.9, 4.4 `saleResolveBuyer`)

- **Problem.**
  - When the typed phone belongs to one existing customer, "Save uses that customer" automatically, whatever name was
    typed. Telegram offers that match as a choice instead (`salePhoneTyped` → look-alikes, core_bot.js:2882-2889).
  - When ✏️ new is followed by an exact-name match, `saleResolveBuyer` uses the existing customer (core_bot.js:3142-3144),
    although choosing ✏️ new past a chip with the same name means a different person.

  With phones shared in a family and common Burmese names, a credit can land on the wrong customer.
- **Fix.**
  - The `ui_buyer_known_phone` chip is tappable (use that customer). Save refuses until the seller taps it or changes the
    phone.
  - ✏️ new with an exact-name match shows that customer as a chip next to "create new" (`btn_create_named`) and does not
    merge silently.

### U10. Telegram: one missed ➕ throws the whole basket away, and the closing text points to a button that is gone (0.3 rule 1, 2.2)

- **Problem.** A scan without ➕ runs `basketClose`, which clears the state and edits the card to `basket_closed`
  '⏱ ဒီစာရင်း ပိတ်ပြီး · ပစ္စည်း ထပ်ထည့်ရင် ➕ ကို အရင် နှိပ်ပါ' with no buttons. Scanning the next tag is the action
  the owner described ("scan all tags (one or many)", BRIEF.md:12-13). After one such scan, every line, the buyer and
  the payment are gone. The text says "press ➕ first" when no ➕ is left to press. The basket is not lost silently, but
  it is lost.
- **Fix.** Keep the closed basket resumable while its state would live. Two options:
  - the new tag's item card gets one extra row, "➕ add to the open list", as `SS|<a>|i|<id>` (20 bytes; an
    `ITEM_ACTIONS` id that exists);
  - or `basket_closed` keeps a [▶️ continue] button that reopens the card at its add step.

  In both cases, reword the text so it says what happened and what to do.

### U11. Telegram: ✖️ on any sub-screen cancels the whole basket (2.1 sub-screens, `saleCancel`)

- **Problem.** Every sub-screen ends with `[⏮ နောက်ပြန်] [✖️ မလုပ်တော့ → SS|<a>|z]`, and `z` is `saleCancel`: the state
  is cleared and the message becomes the anchor's item card (core_bot.js:2790-2803). On the buyer or how-paid list,
  "never mind" reads as ✖️, and a three-line basket is gone with no question. On the card, Save and Cancel share one
  row (`[✅ သိမ်း] [✖️ မလုပ်တော့]`), so a fat finger destroys the basket.
- **Fix.** On a sub-screen, ✖️ is dropped (⏮ is the way out), or `z` on a sub-screen returns to the card. On the card,
  put ✖️ on its own row below Save.

### U12. Telegram new-piece card: a typed price after the photo goes to the AI, and a second photo resets the card (2.3)

- **Problem.** Today the photo sets step 'price' (core_bot.js:2127), so a typed "25000" becomes the price (:732-735). In
  form mode the step is 'card', and the number path takes only the price, cost and count steps (2.3). A typed number on
  the card therefore falls through to `ports.ai.parseText` (:757), which is a regression on the most natural input.

  A second photo while the card is live runs `handlePhoto` again: the AI name replaces a typed name (:2121), the
  category is replaced, and form mode resets `step 'card'` and `draft.count = 1`.
- **Fix.**
  - At step 'card', a typed number ≥ 500 is the price (the caption rule, :2129) and the card is redrawn; anything else
    answers `ask_price`.
  - With `state.form` already set, a second photo replaces only the photo.
  - Add a W29 check.

### U13. The new-piece form has a dead end when the tag was registered meanwhile (1.5 tag, 1.9)

- **Problem.** Save re-reads the tag. On `not_blank` the form shows `tag_not_blank` '❓ {id} က အသစ် Tag မဟုတ်ပါ။ အသစ်
  Tag ကို scan လုပ်ပါ။' ("scan a new tag"). But a new-piece form that has its tag refuses every scan with
  `ui_form_no_scan` (1.2 rule 1). The seller can only close the form, and `appNewItemAbandon` then removes the photo
  and the typed values.
- **Fix.** On `not_blank`, clear the form's tag and show the strip again (the 🆕 state), keeping the photo, name,
  category, price, cost, count and sample. The next blank tag becomes the form's tag and the draft key moves to it.

### U14. The photo AI's late rename takes the place of the sold card on the home (1.4, 6.2)

- **Problem.** `replayJob` pushes `photo_seen` with `botSay` (app_sync.js:388-394), and `lastBot` returns any bot
  message, system lines included (app_ports.js:309-312). Since the forms queue the job at Save (6.2), every new piece
  produces a '📸 name · category' line after a later sync. That often happens while the home shows the next sale's sold
  card. The home's big card then switches to the photo line, and ↩️ 🧾 💰 (undo within 30 minutes) leave the home; they
  stay only in the history.
- **Fix.** Insert the replay line before the latest bot card (`store.insertChatBefore`, as `markWaiting` does,
  app_ports.js:213-215), or toast it. Alternatively, the home's card state skips system lines when it picks
  `appLatestBot()`.

### U15. Android back leaves the app with a form open (12, "the Android back button closing a form", not built)

- **Problem.** A form is a full page (`role=dialog` on body), and Android users leave a page with back. In the installed
  app, back closes the app. The sale is then not saved, and its draft comes back under the U3 rules (into the next scan).
  Android is the family's main platform.
- **Fix.** `appOpenForm` calls `history.pushState({form: kind}, '')`, and a `popstate` listener calls
  `appCloseForm({ask: true})`. If the seller stays, push the state again. This is a few lines in app_forms.js with no new
  file; the measurement form can join.

---

## Minor

### U16. The new-piece form's scanner state is left undefined (1.0, 7.3 `appFormTag`, `appFormPhoto`)

- **Problem.** The spec never says that an accepted blank tag clears `F.scan`, so three things can go wrong:
  - `appFormTag` "restarts the scanner after 700 ms" for every kind, including a new-piece form that just got its tag;
  - visibilitychange (coming back from the camera app) restarts the scanner while `F.scan` is still set, into a strip
    that no longer exists;
  - the 📸 tap clicks `#photoInput` (capture) while the strip's `getUserMedia` may still hold the camera. Map-app-forms
    17 (last bullet) says to stop the scanner first; 7.3 leaves it out.
- **Fix.**
  - An accepted tag sets `F.scan = false` and stops the scanner.
  - `appFormPhoto` (the 📸 tap) calls `appFormScanStop(F)` before `input.click()`.
  - `appFormTag` restarts only sale and restock forms, and a new-piece form that is still without its tag.

### U17. Closing after Save restarts the home camera, and a 'mode' close gives no reason (7.3 `appFormSave` / `appCloseForm`)

- **Problem.** `appCloseForm({})` "after a close without Save" sets `showScanner = true` and restarts the camera. But
  `appFormSave` calls `appCloseForm({})` and only then sets `showScanner = false`. The camera therefore starts
  (`getUserMedia`) and is stopped at once: a flicker of the camera light, and an iOS permission prompt in Safari.

  A 'mode' refusal also closes the form (7.2, 6.6 step 5). The `.fmsg`, the only explanation, goes away with the form,
  and the seller sees the scanner with no reason given.
- **Fix.** `appCloseForm({saved: true})` skips the scanner restart. A mode close toasts `expired`, or pushes a bot line.

### U18. An exception inside a form Save leaves Save stuck (7.2, 7.3)

- **Problem.** The form Saves call the core directly, outside `processUpdate`'s try/catch (core_bot.js:45-56). If
  `commitBasket` throws (it throws on 0 or more than 10 lines, B9), or the store throws:
  - `F.saving` stays set and Save stays on '⏳ သိမ်းနေသည်…' until ✖️;
  - a Customers or Lists row written just before can stay in memory without its sale (`basketCommitDraft` step 2).
- **Fix.** `appFormSave` wraps the pure save in try/catch, then `logError`, clears `F.saving` and writes `.fmsg`
  (`expired`). Customers and Lists rows are written only after `basketCheck` passed and immediately before
  `commitBasket`.

### U19. A tap count in 1.8 is wrong

- **Problem.** "Three pieces, cash" in Telegram is ✅, then two rounds of ➕ and START (the scan itself is not counted),
  then ✅ သိမ်း: 6 taps, not 4. The other rows of the table check out.
- **Fix.** Correct the cell to 6.

### U20. The expense form's reply brings back the corrective buttons (1.7 reply, `replyKeyboard`)

- **Problem.** `replyKeyboard` for an EXPENSE is `moneyKeyboard`: undo, 📝 `EN|` (a note rewrite), and the 🏦 method
  rewrite rows while cash is set (core_bot.js:354-365, :344-351). These are corrective buttons for fields the form just
  asked for, the round-4 pattern the brief's diagnosis criticises. 📝 after a note was saved rewrites the expense.
- **Fix.** Use `undoRow` (as the restock reply does, 1.6) after the expense form.

### U21. Wording that misleads or is inconsistent (sections 1, 2.3, 9)

- **Problem.**
  - (a) `ord_bad_date` '❓ ရက်စွဲ နားမလည်ပါ။ ဥပမာ 30.10.26 လို ရိုက်ပါ။' (core_messages.js:252) answers a date picked
    in the sheet (nothing was typed), because the sheet has `min` but no `max` (app_ui.js:975).
  - (b) The price keypad is titled `btn_discount` '💬 စျေးလျှော့' ("discount") even on a ⏳ price-pending line.
  - (c) `basket_max` 'ℹ️ တစ်ခါ ရောင်းရင် {max} ခု အထိပါ' ("per sale") is reused by the restock form.
  - (d) 🧵 means three things on one new-piece screen: the category အခြား (core_config.js:24), cost
    (`btn_item_cost` NEW) and sample (`btn_sample_off`, :49).
  - (e) The Telegram cost sub-screen asks `ask_cost` '🧵 ကုန်ကျစရိတ် (အထည် + လက်ခ) …' (:78) while its card says
    'အရင်း'.
  - (f) 9.1 says အရင်း and ရောင်းစျေး come from `today_query` (:87). No MSG, APP_MSG or report text contains either word
    (grep); only အမြတ် is there. They are the owner's words: say so for the native speaker.
  - (g) `btn_paid_full` starts with 💵 (cash) even when the method is KBZPay.
  - (h) `expired` '⏱ … ထပ်ပြောပေးပါ' ("say it again") for an account retired by a pull does not say what changed.
- **Fix.**
  - (a) Set `max` on the date input to today + 365.
  - (b) Title a pending line's keypad `ask_sale_price` or `btn_item_price`.
  - (c) Give restock its own word in a NEW key.
  - (d) Give cost an emoji of its own (🏷 and 💸 are taken; for example 🪙).
  - (e) Use the same word on both.
  - (f) Correct the sentence.
  - (g) Use a neutral emoji.
  - (h) Write a NEW line, for example 'ℹ️ ဒီအကောင့် မရှိတော့ပါ · ငွေသား ပြောင်းထားပါသည်'.

### U22. Smaller layout and naming issues on the home and in 4.4 (1.1, 4.4)

- **Problem.**
  - The compact card-state row puts four 56 px buttons across about 330 px, roughly 76 px each. With 20 px text,
    '🆕 ပစ္စည်းအသစ်' and '📦 ကုန်ရောက်' wrap to two or three lines and the buttons grow.
  - The 2 × 2 tiles of 72 px above the scanner push the camera and ⌨️ below the fold on a 640 px phone.
  - In 4.4, `basketCallback` uses `BASKET_STEP_OF[letter]`, while the ADAPT table adapts `SALE_STEP_OF`
    (core_bot.js:2307). Both names are free; pick one.
- **Fix.**
  - The compact row uses the emoji only, with the label as `aria-label`, or stays 2 × 2 at 56 px.
  - Consider the camera above the tiles in the scanner state.
  - One name for the letter map.

### U23. A fast double tap on the app item card's sell button adds +1 (4.4 `S` exemption, 7.3 `appOnOpenForm`)

- **Problem.** In form mode `S` is exempt from the 120 s tap guard (core_bot.js:446 becomes `=== 'form'`), and "an
  openform of kind sale while a sale form is open adds the line instead" (7.3). On a slow phone, a second tap that lands
  before the deferred open (`setTimeout 0` after the core's run) covers the card emits a second request, which adds the
  line again: a stock item × 2, or × 6 from the stepper's `S|id|3`.
- **Fix.** `appOnOpenForm` drops a sale request for the same itemId and qty within about 1.5 s of the form's opening, or
  `req` carries the tapped message id and a second request from that message only focuses the form.

### U24. The phone keyboard mode is left behind as dead code (7.4 deletions)

- **Problem.** Deleting the `sale` branch of `appInputModeFor` leaves 'tel' with no source (app_ui.js:77-79,
  :797-798). The app's remaining phone prompt, 📱 `CF|` → `askPhone` (`await_text` purpose 'phone'), still gets the
  letter keyboard. R5 says anything dead is removed.
- **Fix.** Map `await_text` purpose 'phone' to 'tel' (one line), and keep the mode.

### U25. A torn tag not among the recent items cannot be added; typed text on the add screen is ignored silently (1.3, 2.1, 2.2)

- **Problem.**
  - The sale form offers the camera, the tag keypad and one row of recent items, but no name search. The home's 🔍 sits
    behind the form.
  - In Telegram, ☰ 🔍 `M|find` replaces the basket state (2.2).
  - On the Telegram add screen, typed text that is not a tag id is "nothing" (the ADAPT row for `saleText`), so the
    seller gets no answer.
- **Fix.**
  - A 🔍 field under the recent row in the sale form (`findItemsByName`, own shop first, results as tiles that go through
    `appFormTag`).
  - On the add screen, a typed name lists up to four matches as `i|<id>` buttons, or answers `basket_add_ask` again.

---

## Confirmed (tried to refute, held)

- Every label the spec quotes with a `file:line` is in MSG / APP_MSG with that exact text and line. A script parsed
  every "`key` 'text' (ref)" of the spec; the only differences are line ranges (`:25-26`, `:429-430`) and two texts the
  markdown wraps.
- The 40 keys of 9.1 and the 20 of 9.3 are all free in MSG and APP_MSG. The merge at app_i18n.js:152-156 would
  otherwise drop a clashing key silently, and none does. No new `btn_*` contains ငွေသား, KBZPay, WavePay or ဘဏ်လွှဲ, or
  starts with '🏦 '.
- Every new global name of sections 4, 7 and 8.3 was grepped across apps-script/, app/, poc/ and tools/ (dist and vendor
  excluded) and is free. The new CSS classes (`.jobs`, `.compact`, `.scanstrip`, `.fline`, `.fnum`, `.bchip`, `.fneed`,
  `.fbad`, `.fsplit`, `.ftotal`, `.fphoto`) are free, and `.bchip` correctly avoids the sync `.chip` (app.css:61-67).
- Callback bytes recomputed: `SS|S1-0002|l|S1-0005` 20, `add` 14, `o|method` 19, `i|…` 20, `q|9` 14, `qn`/`pr` 13,
  `rm|…` 21, `p|all` 16, `a|<12>` 25, `back|due_text` 24, `z` 12, `SC|…|ok` 13, `LA|pm|SSA|S1-0002` 17, `NI|S1-0007|q|-`
  14, `NI|…|back` 15, `NC|…|ok` 13, `P|S1-0007|pending` 17. All match 2.1 and 2.3.
- The z-order: `.overlay` 30 → 34 sits above `.formpage` 32 and `.fbar` 33, and below `.rec` 35 and `.toast` 40
  (app.css:77, :136, :166, :171, :190). The keypad's OK is disabled at 0 (app_ui.js:960, not :961), so the `0` chip
  for paid now is needed.
- `#photoInput` is a file input with `capture`, so a browser opens the camera only from a tap (1.5's extra tap is right).
  `appParseTagLink` reads a USB scanner's t.me line (app_scan.js:13-21).
- `deliver` resets `phone.pendingAi` (app_ports.js:219), so a job queued by a form never leaks a ⏳ line into the next
  update.
- A failed caption edit falls back to a new message (gas_telegram.js:52-61). The review card grows as text messages
  after ➕, so the 1024-character caption limit does not bite.
- The sold card's keyboard: `afterSaleKeyboard(..., {plain: true})` gives undo and receipt, plus 💰 while something is
  owed (core_bot.js:283-288), as 1.4 draws. `saleSoldCard` still recognises `basket_sold` through `sold_done`'s prefix
  (core_bot.js:2383-2387).
- The `S` exemption line (core_bot.js:446), `SC` in `MUTATING_ACTIONS` (:436), `ITEM_ACTIONS` (:431) and the stale-tap
  rules a-c (`saleGuard`, :2359-2377) work as the spec describes them for the card.
- The other rows of 1.8 count correctly (a stock item × 2, a bargained price, mixed, part with 14 days, restock,
  expense).
