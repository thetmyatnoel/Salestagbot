# Apps Script project: deploy guide

Everything in this folder is the production bot. `core_*.js` is shared with the
simulator in `../poc`; `gas_*.js` is the Google-specific glue; `dist/Code.gs` is all of
it joined into one file for pasting.

The picture: the Google Sheet is the database, and its tabs are the tables. Apps Script
is a small program that lives inside that sheet and runs on Google's computers, not on
yours. It receives Telegram messages, calls Gemini, and writes rows. This guide installs
that program and connects it to Telegram. Each block says what it is for, then the clicks.

## A. Before you start

- A Google account used only for the business, with 2-step verification on.
- Telegram on your phone.
- This folder on your computer.
- You are outside Myanmar for the Gemini key step; everything else works from anywhere Google works.

## B. Put the program inside a sheet (5 minutes)

Why: the sheet is the home of the program and its database. Attaching the program to the
sheet lets the code say "my sheet" without an address.

1. In the business account, create a new Google Sheet. Name it anything; the program
   creates and finds its own tabs by their names.
2. In the sheet, click Extensions > Apps Script. The editor opens with a file `Code.gs`
   that holds a placeholder.
   If instead you see "Sorry, unable to open the file at this time", your browser is
   signed into several Google accounts: open an Incognito window (Ctrl+Shift+N), sign in
   with only the business account, and try again.
3. Paste the code. Open `dist/Code.gs` from this folder in Notepad, press Ctrl+A then
   Ctrl+C. In the editor click inside `Code.gs`, press Ctrl+A, then Ctrl+V, then Ctrl+S.
   One file, one paste. (If you changed any file in this folder, run
   `node tools/bundle_gas.js` first to rebuild `dist/Code.gs`.)
4. Name the project: click "Untitled project" at the top left and type `POS bot`.
5. The manifest. Why: it is the program's settings card: the time zone, so "today" and
   the 21:00 summary mean Yangon time; the permissions it will ask for; and that it is a
   web app, so Telegram has an address to deliver messages to.
   Click the gear icon on the left (Project Settings), tick "Show appsscript.json manifest
   file in editor", click the `< >` Editor icon to go back, open the `appsscript.json`
   that now appears under Files, press Ctrl+A, paste the contents of this folder's
   `appsscript.json`, press Ctrl+S.

## C. Build the tabs (2 minutes)

Why: the program builds its own database: every tab with headers, the stock formulas,
200 blank tag ids per shop, the default settings and Burmese messages, and the dashboard.

1. At the top of the editor, next to Run and Debug, open the dropdown that shows a
   function name and choose `setupSheet`. Click Run.
2. Google asks for permission the first time. Click Review permissions, pick the business
   account, then on the "Google hasn't verified this app" screen click Advanced, then
   "Go to POS bot (unsafe)", then Allow. That warning is normal for a script you wrote
   yourself; it lists exactly the permissions from the manifest.
3. Wait about half a minute. The Execution log at the bottom ends with "Sheet ready".
4. Switch to the sheet's browser tab. You now have Items, Ledger, Staff, Settings,
   Messages, Errors, Customers, Credits, Deposits, Import, Dashboard, Orders, OrderItems,
   Designs, MeasureFields, Measurements and Lists, and Items holds 400 blank tag ids.
5. On a sheet that already has rows from before the sync version (the app of plan
   section 14), run `backfillSync` once from the same dropdown. It stamps Seq,
   ReceivedAt and DeviceID on the old Ledger rows, Rev on Items and Customers, and
   ReceiptNo on old sales. This is the single sanctioned migration that writes into
   existing Ledger rows: it only runs from the editor, by hand, never from a request or a
   trigger, and it does not need re-running afterwards, because every new row gets its
   Seq as it is appended (an Errors row `ledger_no_seq` means someone inserted a Ledger
   row by hand; run it again). `backfillMethod` is an optional cosmetic migration that
   fills Method = CASH on old rows; nothing needs it, the code reads a blank Method as
   CASH. `setupSheet` itself never writes into existing Ledger rows.

## D. The two keys (10 minutes)

Why: the keys are secrets. They are stored inside Google as "script properties", not in
the code and not in the sheet, so the code can be copied or backed up without leaking them.
`BOT_TOKEN` lets the program act as your Telegram bot. `GEMINI_KEY` lets it call Gemini.
`GEMINI_MODEL` picks which model, changeable later without touching code.

1. Telegram token. In Telegram, search for BotFather, send `/newbot`, give it a display
   name such as "Shop Tag Bot" and a username that ends in `bot`. BotFather replies with a
   token that looks like `123456789:AAH...`. Keep it.
2. Gemini key. Go to https://aistudio.google.com/apikey, click Create API key, copy it.
   Do this from a country where the Gemini API is offered; Myanmar is not on the list.
   Recommended before the pilot: enable billing on that key so the daily free quota is
   never a failure mode (cost is cents per month).
3. In the editor click the gear icon, Project Settings, scroll to Script Properties, click
   Add script property, and add three rows:
   - `BOT_TOKEN` = the token from BotFather
   - `GEMINI_KEY` = the key from AI Studio
   - `GEMINI_MODEL` = `gemini-2.5-flash-lite` (or whatever passed the Phase 0 test)
   Click Save script properties.

## E. Connect Telegram (5 minutes)

Why: deploying gives the program a web address. `registerWebhook` tells Telegram to send
every message to that address. The Staff tab is the allowlist: anyone not on it gets no
reply, which is what you want for a bot whose tags hang in a public shop.

1. Top right, click Deploy, New deployment. Click the gear next to "Select type" and
   choose Web app. Set Execute as: Me, and Who has access: Anyone. Click Deploy, approve
   if asked again, and copy the Web app URL that ends in `/exec`.
2. Back in Project Settings, add one more script property: `WEBAPP_URL` = that URL.
3. In the function dropdown choose `probeWebhookResponse` and Run. The log must say
   `HTTP 200`. This is the status Telegram sees; anything else means Telegram will keep
   re-sending every message, which shows up as the bot repeating itself every hour.
4. In the function dropdown choose `registerWebhook` and Run. The log shows `"ok": true`.
   (`webhookStatus` shows the same later; `last_error_message` and `pending_update_count`
   are the useful fields. Three minutes after any message, pending_update_count must be 0.)
5. In Telegram open your bot and press START. Nothing answers yet, on purpose: you are
   not on the staff list.
6. Open the sheet's Errors tab, find the row that says "Not in Staff tab" with a number,
   and put that number in the Staff tab: TelegramUserID, your name, DefaultShop `S1`,
   Role `owner` and Active `TRUE`. This sets up the first owner.
7. Send `/start` to the bot again. Use the app button to get the owner’s phone enrolment code.
   Once enrolled, open **Settings → ဝန်ထမ်းနှင့် သုံးခွင့်** in the phone app to add each worker,
   choose their jobs and shops, and issue their code.
8. In the function dropdown choose `installTriggers` and Run, once. This sets the 21:00
   daily summary, the monthly PDF on the 1st and the Sunday backup.

## F. The family group and the first PDF (5 minutes)

1. Create a Telegram group for the family, add the bot to it, and send any message in it.
   The Errors tab shows a `group_chat` row with the group's chat id. Put that id in a
   script property `GROUP_CHAT_ID`.
2. Run `previewSummary` to see tonight's summary text in the log, and `sendDailySummary`
   to post it to the group now.
3. Run `previewMonthlyPdf`. It saves this month's report PDF to Drive. Open it on a phone
   and check that the Burmese text renders. If glyphs are missing, change the font in
   `gas_pdf.js` (the fallback is building the page in a Google Doc with Padauk).

## G. Bring the product list over from the old software (optional, 15 minutes)

Export the product list from the current POS as Excel or CSV, paste it into the `Import`
tab under `Code | Name | Category | Type | Price | Cost | Stock | Shop`, then run
`importProductsFromSheet`. Codes shaped like `S1-0042` land on that tag; any other code
becomes the Alias of the next blank tag, so typing the old code still finds the item.
Opening stock is written as RESTOCK rows. Category: a name of the Lists tab's `item_category` list
(stored with its row's current Label; a built-in's old name finds its row); any other name, or none,
becomes the catch-all (အခြား).

## H. Settings worth knowing

- `notebook_import` in the Settings tab is FALSE until the Phase 0 handwriting test passes.
  Set it to TRUE to show the 📒 button in the menu, in Telegram and in the app (the `ai` row below
  must be TRUE too). 📒 reads a photo of a page of a seller's handwritten notebook with the photo AI;
  each line becomes a proposed entry that the seller confirms or rejects.
- `ai` is the owner's one AI switch: `TRUE` (what `setupSheet` writes, today's behaviour) or
  `FALSE`; a missing row reads TRUE. With `FALSE` nothing is sent to Gemini anywhere: a new piece
  gets no AI name (it keeps `ပစ္စည်း S1-0007` until someone types a name), Telegram answers a voice
  note or a typed sentence with "🤖 AI ပိတ်ထားပါသည်" (and the card of the last scanned piece), the
  measurement flow does not offer 📷 စာရွက် ဓာတ်ပုံ, and 📒 and the app's voice button are hidden.
  Every button, card and form still works by hand, and a phone's photo of a new piece still goes to
  Drive. The owner flips it in the app (Settings, the AI row; a seller sees it but cannot change
  it): ON writes `ai`, `notebook_import` and `app_voice` TRUE, OFF writes `ai` FALSE and leaves the
  other two as they are. Typed here, the bot obeys at the next tap and each phone at its next sync.
  To keep one part off while AI is on, type FALSE in its own row: `notebook_import` for 📒,
  `app_voice` for the app's voice button. The Key cell carries a note that says so (Messages
  `settings_note_ai`).
- `deposit_presets` and `price_presets` are the amounts offered as buttons.
- `sale_flow` is `form` (the default) or `quick`. `form`: the sellers sell in the phone app on one
  screen, the sale form (scan every piece of the buyer, then the buyer, how paid and how much now,
  then Save; a new piece, a restock and an expense have a form each), and Telegram shows a sale as
  one review card, 🛒 ရောင်းမည့် စာရင်း, whose buttons change a line's count or price, add pieces
  (➕ ပစ္စည်း ထပ်ထည့်), set the buyer and the payment, and save (✅ သိမ်း). Nothing is written before
  Save. `quick` brings back the old one-tap card with its corrective buttons, in Telegram and in the
  app (no forms there). Any other value reads as `form`; round 5's `steps` is rewritten to `form` by
  `setupSheet`. Type the word in the Value cell: the bot obeys at the next tap, with no publish, and
  each phone at its next sync (a sale form that is open on a phone at that moment refuses its Save,
  closes and says သက်တမ်းကုန်သွားပါပြီ; the seller sells again).
- `sale_due_presets` are the day buttons of "when is the rest paid", default `7,14,30`: whole days
  from 1 to 365. Only the first three become buttons; a wrong entry is left out.
- The Lists tab holds the options the buttons offer, one row each, in four lists:
  `pay_method` (the bank and wallet accounts, the 🏦 buttons; 💵 cash is always offered,
  whatever its row says), `expense_category`, `fabric` and `item_category` (the category of a
  piece, round 6b). Columns: List, Key, Label (the name on the button), Active, Order (smaller
  first), Shop (blank = both shops), Detail, Note, Kind. `setupSheet` creates it and fills it
  from the options of the version before, the five item categories last. Once a list has
  rows here, they win: Settings `pay_methods`, `expense_categories` and `fabric_presets` (and
  the Messages `method_<KEY>` names) are then ignored for that list.
  - Rename an option in its Label. Never change a Key once it is used: old rows store it. A key
    you type yourself is a short code of English letters and digits, at most 12 (KBZ, AYA). An
    account key that is longer is left out of the 🏦 buttons and noted in the Errors tab.
  - To retire an option, untick Active and keep the row, so old entries still show its name.
    Deleting every row of a list brings the old Settings options back.
  - The Active column already has its tick boxes. Never use Insert > Checkbox (Tick box) on
    it: that can set every cell to FALSE, which retires every option at once.
  - Detail: for an account, its number and the holder's name, at most 80 characters. A receipt
    or voucher that still has a balance to pay prints them as a "ငွေလွှဲရန်" (where to
    transfer) line: the first four accounts of that shop that have a Detail. For an expense
    category, Detail is the emoji on its button.
  - Kind, for an account only: `wallet` or `bank`, from the dropdown. The sale form's "how paid"
    row and the Telegram card's 💰 ဘယ်လိုပေးလဲ? screen show each wallet by name (KBZPay, WavePay:
    the QR and scan-to-pay ones; when they do not all fit, one Pay အကောင့် button opens them) and
    put the banks behind one ဘဏ် button (in Telegram 📲 Pay အကောင့် and 🏛 ဘဏ်). A blank Kind is a
    wallet, except the old `BANK` key
    (ဘဏ်လွှဲ), which is a bank. An account added during a sale gets the kind the seller picks after
    the name (Pay အကောင့် or ဘဏ်အကောင့်); one added another way has a blank Kind. So set `bank` on
    every bank account.
  - Sellers, not only the owner, add a missing account, expense category or fabric on the spot
    with ➕ (the name they type is used; an amount alone is refused; a name that already exists
    is reused, and a retired one stays retired until you tick Active again). An option added
    this way is for both shops. In the app's sale and expense forms (ဘဏ်အသစ်, အမျိုးအစားအသစ်) the
    row is written only when that sale or expense is saved, so a form left without Save adds
    nothing; in Telegram it is written as soon as the name (and, for an account, its kind) is in.
    Sellers also set an account's number with 🔢 on the 🏛 အကောင့် screen of the menu, or with
    🔢 နံပါတ် ထည့် on the sold card of a sale in which they added the account. The bot and the app
    cannot rename or remove an option: that is done here.
  - `item_category` (round 6b): the categories of the new-piece screens. The item keeps the
    category's NAME in its Category cell, as before; a piece and a row match by name (spaces, case
    and invisible characters aside).
    - The Lists tab's first seed writes the five built-ins after the rows of the three other lists
      (16 with the default Settings), in the same block: rows 18 to 22 on such a sheet, Active ticked,
      Order 1 to 5, Shop blank, Detail the emoji (ထမီ 👗 `htamein`, လုံချည် 🧣 `longyi`, အင်္ကျီ 👚
      `eingyi`, ဝတ်စုံ 🧥 `wutsone`, အခြား 🧵 `other`). The keys are fixed because every device
      builds the same five (the Sheet's seed, a phone's list and the server's sync all start from
      them), and a key made for an added name (its Latin letters, or `i` for a Burmese name, then four
      hex digits, such as `i3fa2`) can never be one of them.
      The live Sheet has no Lists tab yet, so the first `setupSheet` after the publish writes all
      four lists. A Lists tab seeded by a round-4, 5 or 6 build (test books only) has no
      item_category row: it shows the five anyway, and its first add writes them before the new one.
    - Label renames the chip for new pieces only: pieces registered before keep the old name (change
      one in the Items tab's Category cell). An old built-in name still reads as its renamed row
      (its emoji, and typing ထမီ at ➕ after ထမီ became ထမိန် picks ထမိန်).
    - Untick Active to close a category, never delete the row: a closed one has no chip and no
      button, and typing its name at ➕ or + is refused (`add_ic_closed`), never reopened; the pieces
      keep it. A deleted row's chip is simply gone; only the catch-all comes back by itself, and
      deleting every item_category row brings back the five built-ins.
    - The row keyed `other` is the catch-all: always offered and always the last chip and button,
      whatever its Active and Order (an added category comes before it); its Label may be changed. A
      piece with no category chosen gets it, and it is the one category the photo AI may replace.
    - Order orders the chips; Shop keeps a category to one shop (its chips and the photo AI's list);
      Detail is the emoji Telegram shows before the name (the app shows none; an added category
      without one shows 🔖).
    - A name on two rows is offered once (the first row), and a row whose name holds the word
      နမူနာ is never offered (a sample is the 🎨 switch); each is noted once in the Errors tab
      (`lists`).
    - Add with ➕ / + rather than by hand. A row typed here needs a Key: a row without one is
      skipped, and a key longer than 12 bytes (any Burmese key) is left out of Telegram's buttons
      (noted in the Errors tab), so give it a short code of English letters and digits (`silk`).
    - The List header cell's note explains all this (Messages `lists_note_item_category`, added
      after `lists_note_list`). The Dashboard has no item-category block, and `onEdit` needs nothing
      new.
    - Who may add: anyone who registers pieces. Refused, nothing written: an empty name, digits or
      an amount alone, a name with no letter (only emoji or signs), a name holding the word နမူနာ
      (`add_ic_sample`) and a closed name (`add_ic_closed`); a name the shop already has is used
      (`add_exists`). In Telegram the row is written at the typed or spoken name (a card cancelled
      afterwards leaves it; untick it if unwanted); in the app at the form's Save.
- MeasureFields keys are English letters, digits and `_`, at most 40 characters
  (`chest_width`). The app's measurement form leaves out a field whose key breaks this rule
  (the server would refuse the whole session); the Telegram flow still shows it. Never change a
  key that was used: the Measurements tab has one column per key. The row with Key `note` (label
  မှတ်ချက်, the last of the `general` group) is a session's one notes box: the app's form shows it
  as a box of up to 300 characters (every other value takes at most 60) and has no second notes box
  any more. Set that row's Active to FALSE and the form has no note. The Notes column of
  Measurements is filled by the system (a photo of the paper sheet puts its margin note there, a
  Telegram correction adds `fix of M-…`); nobody types into it.
- The Measurements tab has a `Sketch` column: on a new tab right after `EntryID`, before the field
  columns; on a tab made before (the live one), at the right-hand end, after the field columns. It
  holds the drawing a tailor made on the app form's
  figure, as text (`1F:…` on the woman's figure, `1M:…` on the man's); never edit it by hand. The
  picture of that drawing is saved in the photo folder on Drive as `<MeasID>-figure.png` at the
  phone's next good sync, and its link goes into that session's PhotoURL. The measurement PDF
  (📏 PDF) prints the figure under ကိုယ်ပုံ, and in Telegram the 📏 အတိုင်းအတာ screen of a buyer
  whose last session has a drawing says so (✏️ ကိုယ်ပုံ ပါပါသည်) with a 📏 PDF button. A Telegram
  correction or 📋 အဟောင်း သုံး keeps the drawing.
- The Shops block of the Settings tab: the rows `shop_name_S1`, `shop_brand_S1`, `shop_address_S1`
  and `shop_phone_S1`, and the same four for `S2`. `setupSheet` colours them light blue wherever
  they are (one conditional-format rule; no row moves) and puts a note on each Key cell. The name
  is shown on receipts, in the reports and the 21:00 summary and at the top of the app (blank:
  ဆိုင် ၁ / ဆိုင် ၂); the address and the phone print on the app's receipt page and on vouchers;
  the brand is the heading of a voucher and of the measurement PDF (blank: the name). The owner
  edits the name, the address (the place) and the phone of each shop in the app (Settings,
  ဆိုင်များ: one row per shop), which writes the same rows as plain text, so 09… keeps its 0; every
  other phone shows the change after its next sync. The brand is edited here only. The shop ids
  `S1` and `S2` stay fixed: they are in the printed tags (S1-0001), the buttons and the Lists tab's
  Shop column. A third shop (`S3`: its tags, voucher series V3, Settings rows, the transfer choice,
  the Lists dropdown, the reports and the 21:00 summary) is a later round, planned once the owner
  confirms it; nothing built in round 6 assumes exactly two shops (the Shops screen, what a phone
  may write and these notes and colours all go by the list of shop ids).
- `app_url`, when the app of plan section 14 is hosted, is shown under the enrollment
  code so a staff member knows where to install it. The one-time code itself is typed
  into the app and is never part of a link.
- The Messages tab holds every Burmese string the family sees. Rewrite them there; no
  code change needed.
- The Ledger column `DueDay` (the 27th, at the right-hand end) holds the day the buyer promised to
  pay the rest (text like `2026-12-30`), on every SALE row of a sale that is part-paid or unpaid. It
  is blank on every other row, and when the seller chose မသေချာ (not sure). Receipts, the PDF
  report and the owed reports print it.
- A sale of several pieces (a basket, from the sale form or the Telegram card) is ONE group in the
  Ledger: one SALE row per piece line, in the order the pieces were scanned, all with the same
  GroupID, each with its own Amount; the buyer (CustomerID) on every row; the DueDay on every SALE
  row while money is owed. The money paid now is filled into the rows in line order, so the first
  lines read as paid (Cash) and the later ones as owed; every row keeps Cash between 0 and its
  Amount. A part-paid sale has the note `credit` on every SALE row; a sale split between cash and
  an account (ခွဲပေး) has the note `split` instead, and ONE PAYMENT row after the SALE rows for the
  transfer part.
  A line whose price was changed has the note `price` when no other note applies. The receipt,
  Credits (its item cell reads 🛍 ၂ ခု · and the names) and the buyer's history show the group as
  one sale; the 21:00 summary and the reports add up its rows. A one-piece sale writes the rows it
  always did. The undo (↩️ မှားသွားတယ်, 30 minutes) reverses the whole basket; after that the
  owner voids it, again whole, with 🚫 ပယ်ဖျက် (ဆိုင်ရှင်) on its receipt (🧾 ဘောက်ချာ; only the
  owner sees that button). Neither goes through once a payment was taken later against the sale (a
  PAYMENT row of another group whose RefGroupID is the sale; a split's own PAYMENT row does not
  count): the bot answers `ℹ️ ဒီအရောင်းမှာ ငွေလက်ခံ/စရံ ပါပြီးလို့ ပြင်လို့ မရတော့ပါ။` and writes nothing, and the app shows that
  line in place of both buttons. That payment is undone first (its ↩️, within 30 minutes); then the
  sale's undo and void work again.
- `ReceiptNo`: one number per sale, however many pieces it has. A phone writes the same number (for
  example `R1-A-000231`: the shop, the phone's receipt letter, its own counter) on every SALE row of
  a basket; the PAYMENT row of a split has none. A sale made in Telegram leaves the cell blank (its
  receipt number is counted from the shop's sales), and `backfillSync` writes the number on the
  first SALE row of each such group only. Receipts and reports read the first row, so both kinds
  read alike.
- A new piece registered with a count above 1 (အရေအတွက် − + on the app's new-piece form, or
  ➖ 🔢 ➕ on the Telegram new-piece card) becomes a stock
  item: Type `SKU` in Items, its stock arriving as ONE RESTOCK row with that quantity (note `new
  item`, or `new sample`, source PHOTO). A count of 1 is a one-of-a-kind piece (`UNIQUE`), as
  before. Within 30 minutes ↩️ မှားသွားတယ် on its card reverses that row and makes the tag blank
  again (name, price, cost, photo cleared), so it can be registered anew; once one of its pieces was
  sold the undo is refused (`undo_new_used`). After those 30 minutes a mistyped count cannot be taken
  back (there is no stock correction); a later delivery is a restock.
- A sample (the design department's one or two pieces of a new design; plan 12.4) is the Items
  column `Sample`, set on the new-piece screens. Round 6b gives it its own sign, apart from the
  category အခြား (whose emoji is 🧵): the Telegram toggle reads 🎨 နမူနာ: မဟုတ် / 🎨 နမူနာ: ဟုတ်
  (Messages `btn_sample_off`, `btn_sample_on`), a sample's item card and its rows in Telegram's lists
  lead with 🎨 instead of the category's emoji and its name keeps ` (နမူနာ)`, and the app shows a
  switch (ဖွင့် / ပိတ်) with a hint line and a small နမူနာ badge. The day and month reports count
  samples sold in their own column (နမူနာ ရောင်း); the stock report prints ` (နမူနာ)` after the name,
  beside the Category column. `setupSheet` rewrites the two toggle texts in the Messages tab where
  they still hold round 3's exact text (`🧵 နမူနာ: ဟုတ်`, `🧵 နမူနာ: မဟုတ်`), because the bot reads
  the tab first; a text the family typed is kept, and a second run changes nothing.
- A restock of several tags in the app's form (📦 ကုန်ရောက်) is one group with one RESTOCK row per
  tag (its quantity on that row), so one undo reverses all of them.
- 📦 ကုန်ရောက် in Telegram's menu (round 6b; its fourth row reads 🧵 အော်ဒါ, 📦 ကုန်ရောက်, 📒 စာအုပ်,
  🏛 အကောင့်, 📒 only with AI and `notebook_import`) restocks several tags in a row, one tag at a time,
  in both `sale_flow` modes; the app under `quick` runs the same loop from its Menu (with `form` the
  app's 📦 opens its restock form). The bot asks for a tag: a scan and START, a typed id (S1-0042),
  or a bare number (42: the staff member's shop, else the first shop, and four digits). Then the
  count screen of that piece: +၁ +၅ +၁၀ +၂၀, a number typed on its own (5, ၅, ၅ ထည်; 1 to 999,
  another number gets `bad_qty` and the screen again), a spoken count (with AI on), or ✏️ အခြား and
  a typed count. At that screen only a number on its own is the count: a typed tag (`S1-5`,
  `S1 0005`, any shop id) is the next tag, and other text goes to the AI as before, never as a count.
  Each count is its own RESTOCK group with its own ↩️ (`S1-0042 · 📦 ကုန်ရောက် ၅ ထည် · လက်ကျန် …`),
  then the bot asks for the next tag and offers ✅ ပြီးပြီ, which ends the loop. ✖️ on the count
  screen skips that tag (nothing written, the loop goes on); 🛒 ရောင်းမယ် ends the loop and opens the
  item card (the scan was for a sale); a one-of-a-kind piece scanned ends it and shows its card; a
  blank tag, an unknown tag or a seller's tag of another shop is refused and the bot asks again (the
  owner restocks any shop). The loop ends 180 seconds after its last question
  (`RESTOCK_LOOP_TTL_SEC`) and at any menu button or a bare `/start`; the next scan then shows the
  item card, whose 📦 still restocks. A tap on the newest count screen within 30 minutes still counts
  as the loop's and opens it again; ✖️ or ✅ on an older message only removes its buttons.
- The `Credits` and `Deposits` tabs and the Customers summary columns F:K are rewritten
  by the script; run `rebuildViews` if you ever edit ledger rows by hand. Credits ends with
  `DueDay` (the promised day) and `Overdue` (TRUE when that day has passed or, with no day, when
  the sale is 30 days old or more). The tab is a snapshot, rewritten after every credit-related
  write (from Telegram or a phone), by `rebuildViews`, and by the 21:00 summary just before it is
  posted: `Days` and `Overdue` are as of the last rewrite, and `rebuildViews` brings them up to date
  at any time. The summary has a line ⏰ ရက်လွန် အကြွေး for promised payments that are late; the
  Dashboard's Overdue cell adds up what the Overdue rows owe.
- The app: 📲 in the bot's menu gives a staff member a typed one-time code (15 minutes,
  5 attempts). The owner's menu has 📱 (also `/devices`) with ⏸ drain, 🟢 activate and
  ❌ revoke buttons per phone. The 21:00 summary ends with a line about phones that have
  not synced.

## I. Every later code change

Edit the files in this folder, run `node tools/bundle_gas.js`, paste the new `dist/Code.gs`
over the old one in the editor, save. Then Deploy > Manage deployments > pencil icon >
Version: New version > Deploy. This keeps the same URL. Creating a *new* deployment
changes the URL and breaks the webhook (if that happens, update `WEBAPP_URL` and run
`registerWebhook` again). After every new version run `probeWebhookResponse` (expect
HTTP 200) and then `registerWebhook` once, which also drops any backlog Telegram was
holding.

If the bot ever repeats the same message every hour, or goes silent while the Errors
tab stays empty, that is Telegram re-sending a message it thinks was never accepted:
run `probeWebhookResponse`, fix whatever makes it print something other than 200, then
`registerWebhook`.

### Upgrading a sheet that already runs an older version

Some versions add tabs and columns. After pasting a new `Code.gs` and publishing the new
version, run these once from the function dropdown, in this order:

1. `setupSheet`: adds any missing tab and appends any missing column at the right-hand end,
   so existing formulas keep working. The version of 2026-11-03 adds the Orders, OrderItems,
   Designs, MeasureFields and Measurements tabs, the Method, Category, Seq, ReceivedAt,
   DeviceID and ReceiptNo ledger columns, the customer summary columns, and new Settings keys.
   It also marks old rows where cash moved as paid in cash.
2. `backfillSync`: numbers the existing ledger rows so the phone app can sync them.
3. `rebuildViews`: refills the Credits, Deposits and customer summary columns.
4. In the Settings tab, set `order_next_no_S1` and `order_next_no_S2` to the next unused page
   of each shop's paper voucher book, and fill `shop_brand_S1/S2`, `shop_address_S1/S2` and
   `shop_phone_S1/S2` for the voucher and measurement PDFs (the name, the address and the phone can
   also be set on the owner's phone: Settings > ဆိုင်များ, section H).
5. Place one test order end to end on the bot (new order, advance, deliver, undo) before
   telling the family.

### Publishing from this PC (instead of pasting)

The one-time setup is in `docs/AUTO-PUBLISH-SETUP.html`. After it, one command replaces the
paste and the pencil-icon steps above. Run it in Command Prompt from any folder:

```
node C:/Users/USER/Desktop/Noel/tools/publish.js bot "what changed"
```

It rebuilds `dist/Code.gs`, uploads exactly `dist/Code.gs` and `dist/appsscript.json`
(`.clasp.json` here has `"rootDir": "dist"`), moves the existing web app deployment to the new
version so the `/exec` address stays the same, and checks that the web app still answers. If the
check fails it moves the web app straight back. It refuses to run when clasp is signed in as
another account than the one in `tools/publish.config.json` (the web app runs as whoever
published it), and within 15 minutes of the 21:00 summary, the Sunday 22:00 backup or the
monthly report at 08:00 on the 1st, Yangon time. Each publish is recorded in
`tools/publish-log.jsonl`.

- `node C:/Users/USER/Desktop/Noel/tools/publish.js rollback` moves the web app back to the
  version it ran before the last publish (or `rollback N` for version N).
- `node C:/Users/USER/Desktop/Noel/tools/publish.js status` shows the signed-in account, the live
  version and the web app check.

The setup functions above (`setupSheet`, `backfillSync`, `rebuildViews`) and the Settings values
still need the editor when a version adds tabs or columns. Never run `clasp clone` or `clasp pull`
inside this folder, and never create a new deployment from the command line (`clasp deploy` or
`clasp create-deployment` without the existing ID): that makes a new `/exec` address that
Telegram does not use. Backups of the online code from before the first clasp publish are in
`C:\Users\USER\Desktop\Noel-backup`.

### Rounds 4, 5, 6 and 6b (lists, accounts, split payment, measurement form, the forms and the review card, item categories, Telegram's 📦)

The four rounds go out together, in this order:

1. Before the publish, on this PC: every check at the end of this file ends with `0 failed`, then
   `node tools/bundle_gas.js`, `node tools/build_app.js` and `node poc/build_simulator.js`.
2. Optional, before the publish: to open the shops on the old one-tap card instead of the forms,
   add a row to the Settings tab with Key `sale_flow` and Value `quick`. Without that row the shops
   open on the forms (`form`, the code's default).
3. The bot, from this PC (see "Publishing from this PC" above):
   ```
   node C:/Users/USER/Desktop/Noel/tools/publish.js bot "rounds 4-6b: lists, accounts, split, measurement form, forms, review card, item categories, menu restock"
   ```
4. Right after, in the same sitting, run `setupSheet` once in the editor. Rounds 4 and 5: it creates
   the Lists tab and fills it from the current Settings options, with a Kind column and its
   wallet/bank dropdown; adds the Ledger column DueDay at the right-hand end (the Ledger then has 27
   columns); gives the Credits tab its DueDay and Overdue columns (15 in all); appends an EntryID
   column at the right-hand end of the Measurements tab; and redraws the Dashboard with a "Money by
   account (this month)" block, its "Overdue (>30d)" cell becoming "Overdue" (it now also counts late
   promised payments). Rounds 5 and 6: it adds the Settings rows `sale_flow` (`form`, unless you
   typed `quick` in step 2; a `steps` value is rewritten to `form`), `sale_due_presets` (`7,14,30`)
   and `ai` (`TRUE`); puts a note on the `ai` row and on each shop row and colours the Shops block
   (see H); appends the `Sketch` column at the right-hand end of the Measurements tab; and adds the
   new Messages rows of rounds 4 to 6b (a round-5 default text of `settings_note_sale_flow` is
   rewritten to round 6's; a text the family typed is kept). Round 6b: the Lists tab's first seed
   ends with the five `item_category` rows (rows 18 to 22 with the default Settings; see H), the
   List header cell's note explains them, and the Messages rows `btn_sample_on` / `btn_sample_off`
   that still read round 3's `🧵 နမူနာ: ဟုတ်` / `🧵 နမူနာ: မဟုတ်` become the 🎨 texts. The live Sheet
   has none of the round 4 to 6b rows yet, so on it `setupSheet` only appends rows and columns (and
   adds the notes and the colour) and rewrites those two default texts; no value the family typed is
   changed. A sale made between the publish and `setupSheet` is kept, but the new columns and
   Settings rows only appear with `setupSheet`.
5. Then run `rebuildViews`, so the Credits tab fills its DueDay and Overdue columns at once.
6. The app (the first time, only after point 5 "Firebase" of `docs/AUTO-PUBLISH-SETUP.html`):
   ```
   node C:/Users/USER/Desktop/Noel/tools/publish.js app
   ```
   No phone runs an older app yet, so every phone starts on this one.
7. Last, rebuild the simulator (`node poc/build_simulator.js`) and republish its page.

The owner may flip `sale_flow` at any time afterwards: the bot follows at the next tap, every phone
at its next sync (the app has no per-phone switch).

Always the bot first, then the app, never the other way round. A phone with the new app that syncs
with a bot older than round 5, such as today's live one (the app published first, or the bot rolled
back), sells with the old one-tap card
and no forms, and asks no promised dates, until it syncs with the new bot. Nothing is lost
meanwhile: an option or account number added with ➕ or 🔢 on a phone, a measurement saved in the
app's form, and a shop's name, address or phone or the AI switch changed on the owner's phone wait
on the phone and go in once the new bot is published. Until then every sync adds one Quarantine row
and one Errors row (`sync_reject`, `bad_kind`) per waiting entry; those rows can be ignored.

Before a rollback (`publish.js rollback`), let every phone sync first when you can: a bot older than
round 5 does not keep DueDay, so a promised date still waiting on a phone would not reach the Sheet;
a bot older than round 6 keeps a measurement session without its drawing, and refuses a session
whose note is longer than 60 characters (the phone then drops that session); a bot older than round
6b quarantines an item category added on a phone (`malformed`): the piece keeps its category's
name, and the category lives only on that phone until its next pull. Roll the app back with
the bot (Firebase console > Hosting > release history > Roll back). After publishing the new bot
again (`publish.js bot`), run `setupSheet` and then `rebuildViews` once more.

A hand edit in the Lists tab redraws the Dashboard and ticks Active on a row you typed (`onEdit`,
nothing to install). It works because the program lives inside the sheet (section B); a separate
copy of the code would not do it. Deleting a whole row does not redraw the Dashboard; the next edit
in the tab, or running `setupSheet`, does.

Checks after the publish:
- The Lists tab has the accounts, expense categories and fabrics, every Active box ticked, and
  after them the five `item_category` rows (ထမီ, လုံချည်, အင်္ကျီ, ဝတ်စုံ, အခြား, keys `htamein` to
  `other`, Detail 👗 🧣 👚 🧥 🧵). The List header cell's note ends with the item_category line.
- In the Messages tab, `btn_sample_off` reads `🎨 နမူနာ: မဟုတ်` (unless the family had typed another
  text there).
- The Lists tab ends with a Kind column whose cells offer `wallet` and `bank`. Set `bank` on every
  bank account; leave KBZPay, WavePay and the other wallets blank or `wallet`.
- Type `0123` in the Key cell of an empty row below the list: it stays `0123`, not `123` (an
  account number in Detail keeps its leading 0 the same way). Then delete that row (right-click
  its row number > Delete row).
- The Dashboard shows "Money by account (this month)", and the cell that said "Overdue (>30d)" now
  says "Overdue".
- Change the Label of an account in the Lists tab: the Dashboard shows the new name.
- In Telegram, a customer card has a 📏 အတိုင်းအတာ row.
- The Settings tab has `sale_flow` = `form` (or the `quick` you typed) and `ai` = `TRUE`; the eight
  shop rows are coloured light blue, and their Key cells and the `ai` row's carry a note.
- The Measurements tab has a `Sketch` column (on a tab made before, the last one).
- In Telegram, with `sale_flow` at `form`, scan the tag of an item that has several pieces and tap
  ✅ ရောင်း ၁: one card follows, 🛒 ရောင်းမည့် စာရင်း · ၁ ခု, with 🚫 နာမည် မရှိ, 💰 ငွေသား and
  ပေးပြီး … · ကျန် 0. Tap ✅ သိမ်း: only then does the Ledger get the sale. Undo it with
  ↩️ မှားသွားတယ်.
- Sell again: ✅ ရောင်း ၁, then ➕ ပစ္စည်း ထပ်ထည့်, then scan a second tag and press START (or tap
  it in the list): the card lists two lines. Tap 💳 မကျေသေး, then 0, a buyer from the list and
  ၇ ရက်, then ✅ သိမ်း: the Ledger has two SALE rows with one GroupID, each with the buyer and a
  DueDay a week ahead, and the Credits tab shows one row for them (🛍 ၂ ခု · …) with Overdue FALSE.
  Undo it.
- In Telegram, `/start`: the fourth row has 📦 ကုန်ရောက်. Tap it, scan the tag of an item that has
  several pieces and press START: the count screen comes (+၁ … +၂၀, ✏️ အခြား, ✖️, 🛒 ရောင်းမယ်). Tap
  +၁: the Ledger gets one RESTOCK row and the bot asks for the next tag. Undo the row with
  ↩️ မှားသွားတယ်, then tap ✅ ပြီးပြီ.
- In Telegram, scan a blank tag, send a photo, tap 🏷 အမျိုးအစား: the five categories, then
  ➕ အမျိုးအစားအသစ် and ⏮. Leave with ⏮ and ✖️ မလုပ်တော့ (a category typed after ➕ would be written
  at once).
- In the Settings tab, set `sale_flow` to `quick`: the next tap on ✅ ရောင်း ၁ sells at once on the
  old card with its corrective buttons. Undo it, and set `sale_flow` back to `form` (or leave
  `quick` if the shops should keep the old card).
- Once the app is published, on the owner's phone: Settings (the gear) shows the AI switch and
  ဆိုင်များ. Open shop 1, change its address, tap Save: after the next sync the Settings tab's
  `shop_address_S1` shows the new text. Put it back the same way.

## J. Tags

`python ../tools/make_tags.py --bot YourBotUsername --shop S1 --from 1 --to 64 --out tags_S1.pdf`
prints an A4 sheet of QR tags. Ids S1-0001 to S1-0200 already exist as BLANK rows in Items.
Scanning a blank tag starts the "send a photo" flow; scanning a registered tag shows the item card.

## Files

| File | Role |
| --- | --- |
| dist/Code.gs | all of the below in one file, for pasting (rebuild with `node tools/bundle_gas.js`) |
| core_config.js | constants, column order, the AI switch (`aiOn`) |
| core_burmese.js | Burmese digits, money format, Yangon dates, number-word parser |
| core_messages.js | every bot string; overridable from the Messages tab |
| core_ai_prompt.js | Gemini prompts and JSON schemas |
| core_ledger.js | append-only ledger, the sale of several pieces as one group (`commitBasket`), the counted new piece, the restock of several pieces, credit sales, payments, deposits, split payment, undo, stats, daily summary, lookups, buyers (`customerCheck`, `commitCustomer`), product import, option lists, item categories (`itemCategoryOptions`, `addItemCategory`, `itemEmoji`) |
| core_report.js | daily / monthly / stock / owed reports and receipts as data |
| core_bot.js | the conversation: cards, buttons, the Telegram review card of a sale (🛒 ရောင်းမည့် စာရင်း, one write at ✅ သိမ်း; Settings `sale_flow`) and of a new piece, the hooks that open the app's forms and pages, voice, photo, proposals, credit, payment, deposit, split payment, ➕ new options (a new piece's category too), the ☰ 📦 restock loop, 🏛 accounts, reports, notebook, the AI switch's gates, 📲 enrollment and 📱 devices |
| core_sync.js | the app's sync protocol: enrollment, push (accept and flag), option lists, measurements (with their drawing) and the owner's Settings changes (shops, AI) from the phones, pull, checksums, Transport B, summary line |
| core_orders.js | custom tailoring: orders and vouchers, deposits earmarked to a voucher, delivery, cancel, status, measurements, reminders, order reports |
| gas_main.js | doPost, ports wiring, registerWebhook, triggers (daily, monthly, backup), onEdit of the Lists tab |
| gas_store.js | Sheets read/write, customers, Lists rows, Credits and Deposits views, a Settings value from the owner's phone (`setSetting`), the Measurements `Sketch` cell; stamps Seq on append and Rev on master edits |
| gas_sync.js | the Google side of the sync API: Devices, SyncLog, Quarantine, AiJobs tabs, counters, the photo jobs (with AI, the drawing's picture, a photo without AI), backfillSync (editor-only) |
| gas_telegram.js | Telegram API, including document upload |
| gas_gemini.js | Gemini API: voice, text, photo, notebook page, filled measurement sheet |
| gas_pdf.js | report -> hidden Print tab -> A4 PDF (the measurement figure as a picture) |
| gas_import.js | importProductsFromSheet |
| gas_setup.js | setupSheet, blank tags, the Lists tab (with the item_category seed and its note), dashboard formulas, the `ai` row and the Shops block, the rewrite of round 3's sample texts |

Checks, after any code change, in Command Prompt. `run_gas.js` runs the `gas_*.js` glue against a
strict fake of Google Sheets; `set RUN_GAS_BOT_FROM=<folder>` before it makes it take `core_bot.js`
and `core_orders.js` from that folder. `run_wizard.js` checks the Telegram review card, the write of
a sale of several pieces, the counted new piece and its card, the restock group, the reports and
receipts of such a sale, the core's side of the app's forms and pages, the buyer checks, the
measurement core (one note, the drawing), the AI switch, the sample's 🎨 sign, item categories in
Telegram and the ☰ 📦 loop; `run_lists.js` checks the option lists, item categories among them.
`check_simulator.js`
checks the simulator page that `build_simulator.js` has just built, and `check_simulator_browser.js`
runs that page in Chrome (on a PC without Chrome it prints `skipped: no Chrome found`).

```
cd /d C:\Users\USER\Desktop\Noel
node poc/run_scenario.js
node poc/run_sync.js
node poc/run_app.js
node poc/run_lists.js
node poc/run_round4.js
node poc/run_wizard.js
node poc/run_gas.js
node poc/build_simulator.js
node poc/check_simulator.js
node poc/check_simulator_browser.js
```
