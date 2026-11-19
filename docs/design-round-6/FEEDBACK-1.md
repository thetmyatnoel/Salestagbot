# Owner feedback 1 on the simulator and the round-6 mockup (2026-11-13)

The owner tried the simulator (round 5 as built, app frame) and wrote these points, with three screenshots
(the measurement form's "အထွေထွေ" group showing two "မှတ်ချက်" fields; the app home after a report card with a
text box "✏️ ရိုက်ပါ" and "ပို့"; the customers screen "👤 ဘယ်ဝယ်သူလဲ?" with buyers, 🔍 ရှာ and ✖️ မလုပ်တော့).
Each point below is binding for SPEC-round-6.md revision 3 (F1-F12); the orchestrator's facts are in brackets.

## The owner's words, point by point

1. "Why in measurement has 2 notes fields, what are they for?" [Fact: CFG.MEASURE_FIELDS has a 'note' field in the
   'general' group (core_config.js:92, label မှတ်ချက်, a fitting note) and the app form adds its own notes box
   (APP_MSG ui_meas_notes 'မှတ်ချက်'). Duplicate.]
2. "The measurement form that I gave you has a sketch of a person, did you include that or did you leave it out?"
   [Fact: left out. docs/design-round-2/forms-extraction.md:5 and :44: Form A has "a front-view female figure
   drawing in the lower right for marking". The app form has no figure.]
3. "What is the role of the မှတ်တမ်း menu?" [Fact: it opens the chat history of the bot's last 200 messages
   (app_ui.js appRenderHistory), a leftover of the chat model.]
4. "What is the purpose of the text field of the second image?" [Fact: the app's text bar sends typed text to the
   bot as a chat message (appInputBar); after a report it is the free-text box that reaches the voice/AI parser.]
5. "In buyer contacts seeing page, why there is no + button for adding new buyer's contacts registration?" [Fact:
   showCustomers (core_bot.js) offers recent buyers, 🔍 and ✖️; a buyer is created only inside a sale, credit,
   deposit or order.]
6. "The app does not have back <- button, that's kinda make the user to be a bit uncomfortable." [Fact: only the
   history, sync and settings screens have a "← နောက်သို့" text button; forms and cards have none; the phone's
   back gesture is not handled.]
7. On the customer card text (👤 name · phone / 🛍 bought · 💵 paid · 💳 owed / 📥 deposit · 🕘 last visit / a
   history line): "showing the data like this makes the UI a mess, that should be cleanly listed; emojis are not
   necessary everywhere, just main menus might need."
8. "For menu names which are many using in Myanmar as English word, just use English word, like OK, Settings,
   Menu, Scan, Photo; Back should be only with icon, not wording; also 'sent' beside the settings icon, that also
   should be icon for both situations."
9. "What is the usage of book menu?" [Fact: 📒 စာအုပ် is the notebook import: a photo of a seller's handwritten
   notebook page is read by the photo AI and each line becomes a proposed entry; it shows only when Settings
   notebook_import is TRUE. It is AI, which the owner said is not a focus.]
10. "Shop 2, shop 1 should be able to be registered by the owner." [Fact: shop names come from Settings
    shop_name_S1/S2 with defaults ဆိုင် ၁ / ဆိုင် ၂ (core_config.js:189-191); address and phone are Settings
    shop_address_S1/S2 and shop_phone_S1/S2 used on vouchers; there is no screen for them; the shop ids S1/S2 are
    fixed in tags, callbacks and lists, so a third shop is a larger change.]
11. "What is the purpose of the send of the receipt?" [Fact: in Telegram 🧾 ဘောက်ချာ sends the receipt text into
    the seller's chat with a PDF button, so it can be forwarded to the buyer or printed; in the app the card has a
    share button (the phone's share sheet) and a PDF.]
12. "Where can I find the restock menu?" [Fact: today only on an item's card after a scan (📦 ကုန်ရောက်); round 6
    already puts 📦 restock on the app home.]

## Decisions for revision 3 (binding)

F1. **One notes field** on the measurement form: the MeasureFields 'note' field and the form's own notes box
    become one field (the spec picks which and migrates saved values without loss; the PDF and the Telegram flow
    show it once).
F2. **The figure for marking** on the measurement form: a front-view figure outline (a female figure as on the
    paper sheet; the spec may add a male one if the shops measure men) on which the tailor draws with a finger
    (pen, eraser, clear); the drawing is saved with the session as a small image through the existing media path
    (photoUrl or a new field the spec names), synced like a photo, shown when the session is opened again and
    printed on the measurement PDF. Optional nicety: tapping a body area jumps to its field. Works offline.
F3. **History** becomes a clean list of what this phone recorded, newest first (sales, restocks, new pieces,
    expenses, payments), each row: time, what, amount; tapping a row opens it (receipt, undo while allowed). The
    bot-chat history leaves the seller's app (the owner keeps Telegram's own history).
F4. **No free-text chat box** in the seller's app. Search is a search field with a magnifier icon only where
    searching happens (items, buyers). Typed numbers go into fields, never into a chat.
F5. **Buyers page**: a list of buyers (name, phone, owed if any) with search, a "+" button that opens a new-buyer
    form (name, phone, note) and a buyer detail screen laid out as a clean list (see F7) with edit (name, phone,
    note), the sales history as rows, and the actions that apply (receive payment, take a deposit) as buttons.
F6. **Back**: an icon-only ← at the top left of every screen except the home, forms included; the phone's back
    gesture or button does the same (history state); leaving a form with typed values asks once (as the
    measurement form does today).
F7. **Visual language**: emojis only on the main menu buttons (the home's job buttons and the main menu);
    everywhere else plain text with Tabler-style simple icons at most. Data is shown as clean lists: one label and
    value per row, aligned, with headings; tables for histories. This applies to the customer card, the item card,
    the sold card, the report cards, the receipt screen, the history and every form. Telegram messages may keep
    their current text (it is the owner's channel), but the review card and any new Telegram text follow F7 where
    it fits.
F8. **Words**: use the English word where Myanmar sellers commonly say it in English: OK, Settings, Menu, Scan,
    Photo, Save, Cancel (the spec lists every one and keeps Burmese for everything else). Back is an icon only.
    The sync status beside the settings icon is an icon only in every state (synced, waiting with a small count
    badge, offline, problem), and Settings is a gear icon only; each icon-only control has an accessible label.
F9. **The notebook (📒 စာအုပ်)** leaves the seller's app (AI is not a focus); in Telegram it stays behind Settings
    notebook_import for the owner. The menu shows nothing that is switched off.
F10. **Shops registered by the owner**: the owner edits each shop's name, address and phone without touching
    Settings keys by hand: in the Sheet (a Shops block the spec places, for example list 'shop' in the Lists tab,
    or the Settings rows given a clear Shops section) and in the app's owner settings screen. Shop ids stay S1 and
    S2 in this round; a third shop is listed under Not built unless the owner asks for it.
F11. **Receipt**: after Save, "Receipt" opens a clean receipt screen (F7) with Share (the phone's share sheet:
    Viber, Telegram, Messenger) and PDF/Print; the label says what it does ("Share receipt"). In Telegram the
    receipt message is unchanged.
F12. **Restock** is a main job button on the app home (already in revision 2) and in the main menu.

The two questions put to the owner on 2026-11-13 (returns on a sale still owed; scanning a piece already in the
basket does not add one) got no answer; the design's choices stand and the guide must state them plainly.

## Amendment (2026-11-13, the owner's reply): F9 replaced by F9b

The owner wrote: "For the book menu, stay in app also, but instead like Telegram, there should be toggle for AI."

F9b. **An AI switch, and the notebook stays in the app.** The app gets one visible on/off switch "AI" (a toggle
     in the app's Settings screen; the owner's switch decides for every phone and the bot, a seller sees it but
     cannot change it; the spec names the Settings key and how it maps onto today's `notebook_import` and
     `app_voice` rows, which the Sheet keeps as the source of truth). When AI is on, the app shows 📒 the notebook
     (read a photo of a handwritten notebook page into proposed entries, as Telegram does), 🎤 voice, and the
     photo AI's name suggestion for a new piece. When AI is off, none of them is shown and nothing is queued for
     the AI; every form still works fully by hand. Telegram follows the same switch. F9 (remove the notebook from
     the app) no longer applies.

## Amendment 2 (2026-11-13): a third shop may come

The owner wrote: "I might need a third shop; also I want to edit the shops data also like name, place etc."

F10b. Round 6 keeps the ids S1 and S2 and builds the owner's shop editing of F10 (name, address = the place,
      phone). It adds NO new two-shop assumption: every new screen, list, setting entry, whitelist and test iterates
      `CFG.SHOP_IDS` (core_config.js:21) instead of naming S1 and S2, so the owner's Shops screen shows one row per id
      and the `setting` entry's whitelist is built from that list. Adding a third shop (S3: tags S3-xxxx, voucher
      series V3, its Settings rows, the transfer target choice, the Lists Shop dropdown, reports and the 21:00
      summary) is a later round, planned once the owner confirms the shop.
