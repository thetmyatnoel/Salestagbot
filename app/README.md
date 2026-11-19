# SalesTag phone app (PWA)

The phone app is the Telegram bot's brain moved onto the seller's phone. The same `apps-script/core_*.js`
that answers in Telegram runs inside an installable web app, against a copy of the shop's data kept on the
phone (IndexedDB). A sale is a scan and one tap: the scan opens the sale form with that piece, more pieces
of the same buyer are scanned into it, and Save writes the sale (see "Selling on the phone" below). The sold
card appears as soon as the phone itself has saved the rows, with or without internet. In the background the
app sends the saved rows to the Google Sheet (through the same Apps Script `/exec` address the bot already
uses) and pulls what changed (sales made through Telegram, new prices, the other shop's rows). Nothing on the
phone loads from a third-party CDN: the Burmese font, the QR reader and the icons are part of the app. The
binding design is `docs/design-round-3/SPEC-offline-first.md`; round 4 (lists, bank accounts, split payment,
the measurement form) is `docs/design-round-4/SPEC-round-4.md`; round 5 (the promised day, wallet and bank
accounts, the `sale_flow` switch) is `docs/design-round-5/SPEC-round-5.md`; round 6 (the forms, a sale of
several pieces, the Telegram review card; with the owner's feedback: the back button, the buyers page, the
history, the receipt page, the figure on the measurement form, the AI switch and the Shops screen) is
`docs/design-round-6/SPEC-round-6.md`; round 6b (the sample's switch and badge, item categories the shop can
add to, 📦 in Telegram's menu) is `docs/design-round-6/SPEC-round-6b.md`.

## Files

| Path | What it is |
| --- | --- |
| `app/app_*.js` | the app itself: store (IndexedDB), ports, sync client, UI, scanner, voice/photo, Burmese UI strings; since round 6 also `app_forms.js` (the sale, new-piece, restock and expense forms), `app_screens.js` (the back stack and the pages: buyers, a buyer, history, receipt, the Settings AI switch and Shops), `app_icons.js` (the line icons and the rule that shows texts without emoji) and `app_sketch.js` (the figure of the measurement form) |
| `app/index.html`, `app.css`, `sw.js`, `manifest.webmanifest` | the page, its look, the offline service worker, the install manifest |
| `app/ping.html` | the Phase 0 reachability page (see below) |
| `app/config.example.js` | template for `app/config.js`, the one per-deployment file (public values only) |
| `app/fonts/`, `app/vendor/jsQR.js`, `app/icons/` | self-hosted font, QR decoder, home-screen icons (made by `tools/fetch_fonts.js`, `tools/make_icons.js`) |
| `app/vendor/tabler-icons-LICENSE.txt` | the MIT notice of the Tabler-style line icons; the icons themselves are drawn by `app_icons.js`, inside the app's one JavaScript file, so they work offline |
| `app/dev/index.html` | the test bench: the whole app against a fake server and demo data, on the PC |
| `app/dist/` | the build output; this folder is what Firebase Hosting serves. Never edit it by hand |
| `tools/build_app.js` | the build |
| `poc/run_app.js` | automatic checks of the app's data layer and sync (`node poc/run_app.js`) |
| `firebase.json`, `.firebaserc.example` | Firebase Hosting settings (in the project root) |

## Build

From the project folder (`C:\Users\USER\Desktop\Noel`):

```
node tools/build_app.js
```

It joins every `apps-script/core_*.js` (the named ones first, then any others such as `core_orders.js`,
alphabetically) and every `app/app_*.js` into one file `app/dist/app.<hash>.js`, checks that it compiles,
copies the rest of the app into `app/dist/`, and writes the service worker's file list and
`app/dist/version.json`. It refuses to build if anything going to `app/dist` looks like a secret (a Google key
starting `AIza`, a bot token, or the text `BOT_TOKEN=`, `GEMINI_KEY=`, `WEBHOOK_SECRET=`). Without
`app/config.js` it uses the example and warns; the built app then shows a "config.js" notice on its first
screen instead of trying the network.

Check before every release: `node poc/run_app.js` must end with `0 failed`.

## Try it on the PC (the dev page)

Serve the project folder over HTTP. In `C:\Users\USER\Desktop\Noel`:

```
python -m http.server 8080
```

Leave that window open while you use the page (Ctrl+C in it stops the server).
Then open `http://localhost:8080/app/dev/index.html?enroll=sister&latency=0` in Chrome. (Double-clicking
`app/dev/index.html` also opens it in Chrome; every file is loaded as a plain script.) The left side is a phone
running the real app; the right side is the bench:

1. **Enrollment code**: press *Sister · S1* (or Brother, Owner). The code appears and is typed into the app for
   you; press **ချိတ်ဆက်** in the app. The demo data downloads and the scanner home screen opens.
   `?enroll=sister` in the address does all of this by itself.
2. **Network**: tick *offline* to sell without a network, untick it to watch the rows go to the fake server.
   *Settings sale_flow = form (off: quick)* starts ticked (the forms); untick it for the old one-tap card,
   tick it again to go back. The phone syncs at once and follows. *Settings app_voice* and *Gemini outage*
   try the voice button and an AI that does not answer.
3. **Telegram route**: make rows "in Telegram" and watch the phone pull them.
4. **Devices**: drain, re-activate or revoke the phone the way the owner's `/devices` command does.
5. **Page errors**: any script error shows here.

The fake server and the phone's memory reset on every reload. Add `#idb` at the end of the address
(`...?enroll=sister&latency=0#idb`) to keep the phone's data across reloads in the browser's real database
(IndexedDB); the fake server still resets. For an unattended look, the page also takes `&open=S1-0002`
(open a tag: with the forms on, the sale form opens) and `&screen=sync` (open a page: `sync`, `settings`,
`history` or `buyers`); `latency=0` means no fake network delay.

The forms (sale, new piece, restock, expense, buyer, shop) and the 📏 measurement form cover the whole browser
window, not only the phone frame: make the window narrower than 700 px to see them in one column, as a phone
shows them (at 700 px and wider the sale, new-piece and measurement forms have two columns). The dev page keeps
no browser history, so the browser's own back button does not drive the app there; the ← at the top left of the
app does.

To try the built app exactly as phones get it: `python -m http.server 8080 --directory app/dist`, then open
`http://localhost:8080/`. The service worker only runs over `http://localhost` or `https://`, never from a
file opened by double-click, and the app's phone storage is only dependable there too.

## Deploy to Firebase Hosting (Windows, first time)

Firebase Hosting serves the app's files at `https://<project-id>.web.app`, on the free **Spark** plan, with no
card. The phones download the app from there once (and again only for updates); sales never depend on it.
Before the shops rely on it, run the Phase 0 checks below from both shops' SIMs.

### 1. Install the Firebase command-line tool (once)

Use **Command Prompt** (Start, type `cmd`, Enter) for every command below; it avoids PowerShell's script
blocking. Pick one way:

- **npm** (Node.js is already on this PC because the build uses it):
  ```
  npm install -g firebase-tools
  ```
  Check it: `firebase --version` prints a version number.
- **Standalone program** (no Node needed): download the Windows file from the official address
  `https://firebase.tools/bin/win/instant/latest` and run it (if Windows SmartScreen asks, choose *More info*
  then *Run anyway*, only for that file from that address). It opens its own window where `firebase` works.
  In that window, go to the project first: `cd C:\Users\USER\Desktop\Noel`.

### 2. Sign in (once per PC)

```
firebase login
```

A browser opens. Sign in with the **business Google account** (the one that owns the Sheet and the Apps
Script) and press *Allow*. Back in the window it says "Success! Logged in as ...". To switch account later:
`firebase logout`, then `firebase login` again.

### 3. Create the Firebase project (once)

1. Open `https://console.firebase.google.com`, signed in with the same business account.
2. *Create a project* (or *Add project*). Name it, for example `salestag-shops`. Under the name the console
   shows the **project ID** (for example `salestag-shops` or `salestag-shops-1a2b3`); write it down.
3. Google Analytics: turn it **off** (not needed). Press *Create project*, wait, then *Continue*.
4. The project starts on the **Spark** (no-cost) plan. Do not press *Upgrade*; Hosting needs no card.
5. Do **not** open *Build* > *Hosting* and do not click *Get started* there. Since 15 October 2026 a new
   project has no Hosting site, and that flow can create the permanent default site under a name with
   random letters added. The site is created from the command line in step 6 instead. **Do not run
   `firebase init`** in the project folder: `firebase.json` is already written and `init` would offer to
   overwrite it.

### 4. Tell the project folder which Firebase project to use (once)

In `C:\Users\USER\Desktop\Noel`:

```
copy .firebaserc.example .firebaserc
notepad .firebaserc
```

Replace `your-firebase-project-id` with the project ID from step 3, save, close Notepad.

### 5. Fill in app/config.js (once, and again whenever the Apps Script address changes)

```
copy app\config.example.js app\config.js
notepad app\config.js
```

- `apiUrl`: in the Apps Script editor, *Deploy* > *Manage deployments*, copy the **Web app URL** that ends in
  `/exec` (the same address the Telegram webhook uses). When you change the script later, use *Manage
  deployments* > edit (pencil) > *Version: New version* > *Deploy*, so this address stays the same.
- `botUsername`: the bot's username without `@` (what the printed QR tags link to).
- `appName`: optional; the shop name replaces it after the first sync.

### 6. Build and deploy (every release)

First time only, create the Hosting site. List the sites first:

```
firebase hosting:sites:list --project <project-id>
```

If it lists no site, create one named after the project. The first site becomes the permanent default
site and prints `Site URL: https://<project-id>.web.app`. If a site already exists, do not create another.

```
firebase hosting:sites:create <project-id> --project <project-id>
```

Then, for every release:

```
node tools/build_app.js
firebase deploy --only hosting
```

Or in one step, which also checks that the site exists and records the release in
`tools/publish-log.jsonl`:

```
node C:/Users/USER/Desktop/Noel/tools/publish.js app
```

For this deployment the project is `salestagbot`, its site is `https://salestagbot.web.app`,
and `.firebaserc` and `app/config.js` are already filled in.

When Claude runs these commands, the Firebase tool runs without questions. A missing site then stops the
deploy with `Unable to deploy to Hosting as there is no Hosting site` instead of asking for a name.

The end of the output shows `Hosting URL: https://<project-id>.web.app`. That address is the app
(`https://<project-id>.firebaseapp.com` serves the same files). To undo a bad release: Firebase console >
Hosting > release history > *Roll back* on the previous release.

## Phase 0: the ping page

`https://<project-id>.web.app/ping.html` checks, from a real phone, the two things the app needs from
Myanmar: that the hosting address opens at all (gate P1: the page itself loaded) and that a browser can POST
to the Apps Script `/exec?api=ping` and get JSON back (gate P3). The `/exec` box is filled from `config.js`,
and the page pings once when it opens. Press **📡 ၃ ကြိမ်** for three more pings, then **📋 ရလဒ် ကူးမယ်** and send
the copied text (or a screenshot) to the owner. Do it on each shop's phone on its own SIM, morning, midday and
evening, for three days. Pass: JSON back nearly every time, and the page opening in under 10 seconds. If
`web.app` does not open from a shop, stop and tell the maintainer before installing anything there (the
standby host in the design is Cloudflare Pages).

## Enroll a phone, laptop or iPad (connect it to a staff member)

Each device (phone, laptop browser, iPad) belongs to one person in the Staff tab, and each device needs its own
one-time code: a person with a phone and a laptop presses 📲 once for each. Do it in this order:

1. **Install the app first** (next section) and open it the way you will always open it: on a phone or iPad
   **from its home-screen icon**, on a laptop in its Chrome tab or app window.
2. In Telegram, that person opens the bot and presses **📲 အက်ပ်**. The bot answers with an 8-character code
   like `K7QM-4TXP`. It works for 15 minutes and allows 5 wrong tries.
3. In the app, type the code in the box (small or capital letters; the dash is optional) and press
   **ချိတ်ဆက်**. The device downloads the shop's data (a progress line shows), then opens the scanner.
   A message shows the device's name and its receipt letter (A, B, ...).

Every enrolled device shows up in the owner's **📱 ဖုန်းများ** list in Telegram (or `/devices`) with its own
receipt letter: an Android phone as *Android app*, an iPhone or iPad as *iPhone app*, a laptop as *Web app*.

If the code expired, press 📲 again for a new one. On iPhone and iPad the code must be typed in the app opened
from the icon, not in Safari: the icon app keeps its own separate storage. Enrolling changes nothing in the
Telegram bot: that person can still use it as before. To move a person to a new device: enroll the new one;
the owner can drain (⏸) or revoke (❌) the old one in 📱 ဖုန်းများ.

## Install on the phone, laptop or iPad

**Android (Chrome)**

1. Open **Chrome** (not the browser inside Telegram; if a link opened inside Telegram, tap ⋮ and then *Open in
   Chrome*). Type the address `https://<project-id>.web.app` and let it load once with internet.
2. If the line **ဖုန်းထဲ ထည့်မလား?** appears, tap **ထည့်မယ်** and then *Install*. If it does not appear: Chrome menu
   ⋮ > *Install app* (or *Add to Home screen*) > *Install*.
3. A **ဆိုင်** icon appears on the home screen. From now on always open the app from that icon.
4. When it asks for the camera, press *Allow* (it is for scanning tags).

**iPhone or iPad (Safari)**, after the iPhone Phase 0 checks have passed

1. Open **Safari** and type the address `https://<project-id>.web.app`.
2. Tap the Share button (the square with an arrow pointing up) > *Add to Home Screen* > *Add*. (Opened in
   Safari, the app's first screen shows these steps too.)
3. Open the app from the new **ဆိုင်** icon (not from Safari) and enroll there.
4. Allow the camera when asked.

**Laptop (Chrome)**

1. Open **Chrome**, type the address `https://<project-id>.web.app` and let it load once with internet.
2. Choose one way to open it and keep to it: a bookmark of that address, or, when Chrome shows an install
   button at the right end of the address bar, the installed app with its own window and icon. Enroll there.
3. Keep the app open in one tab or window only: two tabs of the app do not see each other's changes.

Never clear the browser's data, clear the app's storage, or uninstall the app while the sync icon at the top
shows a cloud with an arrow and a number (rows waiting to be sent). If the internet to Google is down for a
long time, tap the sync icon > **ဖိုင်ထုတ်** and send the file to the bot in Telegram; the server takes the
rows from the file.

## Selling on the phone (the forms)

With Settings `sale_flow` at `form` (the default), the four everyday jobs of a seller (a sale, a new piece,
a restock, an expense) are one screen each, with one green **Save**. Nothing is written before Save, and Save
writes the whole job at once, on the phone, with or without internet. The labels below are the app's: since round 6 the app shows its texts without emoji
(emojis stay only on the four job buttons and on the Menu card), and a few common words are English: OK,
Settings, Menu, Scan, Photo, Save, Cancel, Share, PDF, Print, AI.

**The home.** At the top: the shop's name, the sync icon (a cloud: ticked when everything is sent, an arrow
and a number while rows wait, crossed out offline, a triangle when a row has waited two days; a tap
opens the sync page) and the gear (Settings). Under it four job buttons, **🛒 ရောင်းမယ်**,
**🆕 ပစ္စည်းအသစ်**, **📦 ကုန်ရောက်** and **💸 ကုန်ကျ**; the scanner; **နံပါတ် ရိုက်မယ်** (type a tag
number); the recent pieces; a search field for an item's name; **မှတ်တမ်း** (the history). At the bottom
**Scan** and **Menu** (and **ပြော**, the voice button, only while AI is on and Settings `app_voice` is TRUE).
After a Save the home shows the reply card large, under one row of the four job buttons (🛒 with its label,
the other three as their emoji with the word under it in small type), so the next sale is one tap on 🛒.

**Back.** Every page, form and card has **←** at the top left (the home's scanner has none); the phone's
own back button or gesture does the same, one layer at a time. A form with typed values asks once with the
app's own question sheet, **ရိုက်ထားတာတွေ မသိမ်းရသေးပါ · ထွက်မလား?**, with **မသိမ်းဘဲ ထွက်မယ်** (red, on top) and
**ဆက်ဖြည့်မယ်** under it (the phone's back while the sheet is open is **ဆက်ဖြည့်မယ်**); an untouched form closes at once. On the home's scanner a first back
shows **ထွက်ရန် နောက်တစ်ခါ ထပ်နှိပ်ပါ** and a second leaves the app. An iPhone has no back gesture in the
installed app: use ←. Right after a fresh start, a camera scan made before any tap can let the first back
leave the app (a browser rule); the sale's list is not lost, it comes back with the next 🛒 or scan.

**Questions, notes and hints for a first-time user** (the UX review of 2026-11-19,
docs/design-round-6/REVIEW-ux-zero-tech.md). The app never uses the phone's own OK / Cancel box: every question is
a sheet with two big Burmese buttons that say what happens, the risky one on top (red when it destroys
something), the safe one under it, and the phone's back is the safe one. Four things ask this way: leaving a
changed form or measurement form (above), **မှားသွားတယ်** and the owner's **ပယ်ဖျက်** on the sold card, the
receipt and the entry page (**ဒီမှတ်တမ်းကို ပြန်ဖျက်မလား?** → **ပြန်ဖျက်မယ်** / **မဖျက်ပါ**), the drawing's
clear on the measurement form, and **ဖုန်း ပြန်ချိတ်ဆက်** in Settings, which now always asks
(**ဒီဖုန်းကို ဆိုင်နဲ့ ဖြုတ်မလား?**, naming the unsent entries and that a new Telegram code will be needed).
Under the camera's **Scan** button (the home and every form's camera strip) a line says what to answer when
the phone asks for the camera the first time (**Allow**), and after a refusal where the permission is put
back (the phone's Settings → Apps → this app → Camera) and that **နံပါတ် ရိုက်မယ်** works meanwhile. A toast
stays longer the longer its text is (55 ms per character; a refusal at least 4.5 s, never past 7 s). The Menu
card is two columns, so no Burmese label is cut into syllables. The new-piece form's empty cost box reads
**မသိရင် ချန်ထားပါ**. The enrol screen says where the code comes from and to ask the owner without one.

**The sale form** (**ရောင်းမယ်**). A scan from the home of a piece of the seller's shop that can be sold opens
it with that piece as a line; 🛒 opens it empty with its camera running; the sell buttons of an item card open
it too.
- Scan every piece of the same buyer while the form is open (the camera strip at the top, **နံပါတ် ရိုက်မယ်**,
  the item search, or the recent pieces): each becomes a line, up to ten. **A piece that is already a line is
  never added again by a scan**: the line flashes and a toast says **{id} ထည့်ပြီးသားပါ · အရေအတွက် တိုးရင် +
  ကို နှိပ်ပါ** (a one-of-a-kind piece: **{id} ထည့်ပြီးသားပါ**). The count of a piece sold by count is
  changed only with − and + on its line. A tag left under the camera is read once. One sale is one shop; a tag
  of the other shop, a blank tag or a sold piece is refused with a toast.
- Each line: '{id} · {name}' (a sample's name is followed by a small **နမူနာ** badge; a tap on the name opens
  the item card; the form keeps its list), the price box
  (the price when the piece was scanned; a tap opens the keypad, empty, titled with the current price; a price
  above ten times the item's warns), the amount, − count +, **လက်ကျန်** (more than the stock warns, it does not
  refuse), and the bin icon to remove the line. A piece whose price is not set yet shows
  **စျေး မသတ်မှတ်ရသေး**: type the agreed price.
- **ဝယ်သူ**: empty is no buyer. Type a name or a phone number (four digits or more search the phones) and tap
  a chip, or a recent buyer's chip, or **နာမည်အသစ်** (a name and a phone). The app never changes the buyer
  by itself: a phone that a buyer already has shows **ဒီဖုန်းက {customer} ပါ** with that buyer as a chip, a
  name that exists shows **ဒီနာမည်နဲ့ ဝယ်သူ ရှိပြီးသားပါ · ဒီလူလား?** with the buyer and
  **"{name}" အသစ် ဖန်တီး**, and Save waits until one is tapped. A new buyer is written at Save only.
- **ဘယ်လိုပေးလဲ?**: **ငွေသား** (the default), each wallet by name (or one **Pay အကောင့်** when they do not
  fit), **ဘဏ်** (then the account), **ခွဲပေး** (part to an account, the rest cash: the account, then how much
  went to it) and, always last, **ဘဏ်အသစ်** (a name, then **Pay အကောင့်** or **ဘဏ်အကောင့်**; the Lists row
  is written at Save).
- **အကုန် ပေးပြီး {amount}** (the default) or **မကျေသေး**. A part payment outlines the rows still to answer:
  **ယခု ပေးငွေ** (the keypad, or the chips **0** and **တစ်ဝက်**), a buyer (**မကျေသေးရင် ဝယ်သူ နာမည်
  လိုပါသည်**), and when the rest is paid: the first three days of Settings `sale_due_presets` (**၇ ရက်**,
  **၁၄ ရက်**, **၃၀ ရက်**), **ရက်စွဲ ရွေးပါ** (a calendar from today to a year ahead) or **မသေချာ**. Save
  refuses until all three are answered, says why in the bar and outlines the row.
- The bar at the bottom shows **စုစုပေါင်း** and, for a part payment, **ပေးပြီး** and **ကျန်**, then **Save**.
  A sale with no buyer, cash, paid in full is therefore a scan and Save.
- The form keeps an unsaved list for 30 minutes. 🛒 brings it back (**မသိမ်းရသေးသော စာရင်း ပြန်ပေါ်လာပါပြီ**,
  with **အသစ်** to start empty). A scan of another piece starts a fresh list with only that piece and offers
  the old one (**မသိမ်းရသေးသော စာရင်း {n} ခု ရှိပါသည်**, **ပြန်ထည့်**), so one Save never sells a list nobody
  looked at. Save writes one group, one SALE row per line (see `apps-script/README.md`, section H).

**After Save: the sold card**, drawn as a list: **ရောင်းပြီး** with the receipt number and the time, a table
of the lines (**ပစ္စည်း**, **အရေအတွက်**, **ငွေ**), then **စုစုပေါင်း**, **ပေးပြီး**, **ကျန်** (while owed),
**ပေးနည်း**, **ဝယ်သူ** and **ပေးမည့်ရက်**. Its buttons: **မှားသွားတယ်** (the undo of the whole sale, 30
minutes), **ဘောက်ချာ** (the receipt page), **ငွေလက်ခံ** while money is owed, **နံပါတ် ထည့်** when an account
was added in this sale, **ဖုန်း ထည့်** for a buyer without a phone. A buyer who still owes and holds a deposit
is asked first: **စရံ သုံးမယ်** or **မသုံးဘူး**.

**The receipt page** (**ဘောက်ချာ**, from the sold card, a sale in the history or a buyer's page): the shop's
name, address and phone (Settings, ဆိုင်များ), the number, the date, the buyer, the lines with quantity, price
and amount, the total, paid (with the account), owed, the promised day, where to transfer, and two buttons.
**ဘောက်ချာ Share မယ်** hands the receipt as plain text to the phone's share sheet (Viber, Telegram,
Messenger, SMS; where there is none it is copied, **ကူးပြီးပါပြီ**): only that text, from this phone to whoever
the seller picks. **PDF / Print** opens the phone's print dialog with the receipt alone (a printer, or "Save as
PDF"), offline; where the browser cannot print, the server's PDF is sent to the seller's own Telegram chat
while online. While the undo is allowed the page also has **မှားသွားတယ်** and the time it is allowed until;
the owner sees **ပယ်ဖျက် (ဆိုင်ရှင်)** on a sale of several pieces. A sale that a later payment was taken
against shows neither the undo nor the void, with a line that says why
(**ဒီအရောင်းမှာ ငွေလက်ခံ/စရံ ပါပြီးလို့ ပြင်လို့ မရတော့ပါ။**; Telegram's ↩️ and 🚫 answer the same line): that payment is undone first,
within its 30 minutes. An undone sale shows
**ပယ်ဖျက်ပြီး** and no buttons.

**The new-piece form** (**ပစ္စည်းအသစ် · {id}**): a scan of a blank tag of the seller's shop opens it (🆕 opens
it waiting for one). **Photo** opens the phone's camera (the strip's camera stops first); **ပစ္စည်း အမည်**;
**အမျိုးအစား**; **အရင်း**; **ရောင်းစျေး** with four chips, or **စျေး မသတ်မှတ်ရသေး** (the owner is asked for
the price, as in Telegram); a line with the profit and the markup on cost; **အရေအတွက်** − 1 + (above 1 the
piece is sold by count, with that stock); **နမူနာ**; **Save**. Then the new piece's card with
**မှားသွားတယ်**: within 30 minutes it makes the tag blank again, so the piece can be registered anew; once a
piece of it was sold the undo is refused.
- **အမျိုးအစား** (round 6b): one chip per category the tag's shop is offered (the Lists tab's `item_category`
  rows, active, for that shop or every shop, by Order: ထမီ, လုံချည်, အင်္ကျီ, ဝတ်စုံ, the added ones, and the
  catch-all **အခြား** always last), written plain, the chips wrapping on a narrow phone; a second tap clears the
  choice; none chosen is the catch-all. The last chip, **အမျိုးအစားအသစ်** with a plus icon, opens a name field
  (40 characters, the keyboard opens by itself; placeholder **ပစ္စည်း အမျိုးအစား နာမည် ရိုက်ပါ (ဥပမာ
  ပိုးအင်္ကျီ)**). A line under it answers while typing: a name the shop already has, **"ထမီ" ရှိပြီးသား ·
  အဲဒါကို သုံးပါမယ်** (Save uses that row and adds nothing); a name holding the word နမူနာ, **နမူနာ က
  အမျိုးအစား မဟုတ်ပါ · နမူနာ ခလုတ်ကို သုံးပါ**; a name the owner closed (unticked, or kept to another shop),
  **"ဝတ်စုံ" ကို ပိတ်ထားပါတယ် · တခြား နာမည် ရိုက်ပါ**. Save refuses those two, an empty name, digits or an
  amount alone and a name with no letter, outlines the field and writes nothing. Otherwise Save adds the
  category (a Lists row for every shop, noted `added by <name> <day>`) and the piece with it, in the same
  commit, and the phone queues one `list` entry beside the item and the group; a form closed without Save adds
  no row. Anyone who registers pieces may add; the owner renames, closes and orders them on the laptop's
  Lists tab (see `apps-script/README.md`, section H). A label renamed there renames the chip for new pieces
  only. A chip chosen before the owner renames its row keeps its choice, and Save stores the new label; a
  restored draft whose category was closed since shows no chip on and saves the catch-all. A row whose
  Label is only an emoji or invisible characters shows its Key on the chip. A new category has no pieces
  yet, so its price chips are the defaults.
- **နမူနာ** (round 6b) is a switch at the end of the right-hand column (last on a phone): **ပိတ်**, tapped
  **ဖွင့်** (green), the same words as the AI switch; Telegram says ဟုတ်/မဟုတ် for the same flag. The line
  under it always reads **ဒီဇိုင်းဌာနက လုပ်တဲ့ နမူနာ ဆိုရင် ဖွင့်ပါ၊ အစီရင်ခံစာမှာ သီးသန့် ပြပါမည်**. A sample
  shows a small **နမူနာ** badge after its name on the recent tiles of the home and of the forms, on its line
  in the sale form and on its item card (text only: the app shows no emoji there). A sample is not the
  category အခြား: a piece of any category can be one, and the reports count samples sold in their own
  column.

**The photo at Save**: the photo stays on the phone until Save; Save queues it with the piece, and it goes up
at the next good sync, after the piece itself. With AI on, the server's photo AI looks at it: when no name was
typed (the piece was saved as `ပစ္စည်း S1-0007`), its name and category replace that placeholder on the server
and on the phone (the form says so under the name: **အမည် မရိုက်ရင် ဓာတ်ပုံကို ကြည့်ပြီး နောက်မှ အမည်
ပေးပါမည်**); a typed name is never replaced, a chosen category only when it is the catch-all (အခြား, or the
owner's new Label for it). The AI is given the piece's shop's categories as they were at Save (the added ones
too, the catch-all last), and the server and the phone both decide against that same list. With AI off the
photo is only saved to Drive and the placeholder stays until someone types a name.

**The restock form** (**ကုန်ရောက်**, from 📦 on the home, 📦 ကုန်ရောက် in the Menu, or the item card's
ကုန်ရောက်): scan the pieces sold by count that arrived; each line has − count + and the chips ၁, ၅, ၁၀, ၂၀,
and shows **လက်ကျန် {now} → {after}**; a one-of-a-kind piece, a blank tag or a tag of the other shop is
refused; up to ten kinds; Save writes one group (one undo).

**The expense form** (**ကုန်ကျ**, from 💸 or 💸 ကုန်ကျ in the Menu): the owner picks the shop; the category
(**အမျိုးအစားအသစ်** adds one, written at Save); the amount (chips or the keypad); how paid; a note (100
characters); Save.

**Still chat cards in the app**: receiving a payment (💰 ငွေလက်ခံ), taking a deposit (📥 စရံ), a return and
a move to the other shop (on the item card) are the bot's cards with buttons, as in Telegram, drawn plain. A
question that needs typing shows one labelled box with **OK** (numbers open the keypad). There is no free text
box any more, so nothing typed reaches the bot or its AI by accident. **A return of a piece whose sale still
owes money is refused** for everyone, with the line **{customer} · ကျန် {owed} ကျပ် · အကြွေးနဲ့ ရောင်းထားတာပါ ·
ပြန်အမ်းရင် ဆိုင်ရှင်ကို မေးပါ**: the owner takes the payment first, or voids the sale from its receipt (a
sale of several pieces), and sells the kept pieces again.

**The buyers page** (Menu > 👤 ဝယ်သူများ): every buyer, this shop's recent ones first (the owner: every
shop's), with the phone and what is still owed (**ကျန်**); a search field (a name, or four digits or more of a
phone) and **+** for a new buyer (**နာမည်**, **ဖုန်း**, **မှတ်ချက်**, Save). A buyer's page lists **ဖုန်း**
(a tap calls), **မှတ်ချက်**, then **ငွေ**: **ဝယ်ပြီး**, **ပေးပြီး**, **ကျန်**, **စရံ** (only when held),
**နောက်ဆုံး လာချိန်** and **လာသည့် အကြိမ်**; the buttons **ငွေလက်ခံ** (while owed), **စရံ**,
**အတိုင်းအတာ** and **စာရင်း PDF**; **ပြင်မယ်** (edit the name, phone or note); and **ဝယ်ယူမှု မှတ်တမ်း**,
a table by date (a sale of several pieces is one row; a sale row opens its receipt). A buyer edited on one
phone reaches the others at their next sync; two phones editing the same buyer offline keep the later push.

**The history** (**မှတ်တမ်း** on the home): what THIS phone recorded, newest first, one table per day
(**ဒီနေ့**, **မနေ့က**, then the date): **အချိန်**, **အကြောင်း** (the piece, the category or the buyer, with
the kind under it: ရောင်း, ပစ္စည်းအသစ်, ကုန်ရောက်, ကုန်ကျ, ငွေလက်ခံ, စရံ…) and **ငွေ**. A cloud icon marks a
row not sent yet; an undone row reads **ပယ်ဖျက်ပြီး**. Seven days at a time (**နောက်ထပ် ကြည့်မယ်**). A sale
opens its receipt; any other row opens **မှတ်တမ်း အသေးစိတ်** with its rows and, while allowed,
**မှားသွားတယ်**. Rows made in Telegram or on another phone are not listed, and neither are measurements (a
saved measurement shows a toast). The bot's chat is no longer shown in the app.

**Settings** (the gear): the staff member, the shop, the phone's name and its receipt letter; **AI** with its
switch and, under it, **စာအုပ်**, **အသံ** and **Photo အမည်**, each ဖွင့် or ပိတ်; for the owner **ဆိုင်များ**;
the font size, cards without photos, the version, and re-enrolling.
- **The AI switch** is the owner's (a seller sees it greyed, **ဆိုင်ရှင်သာ ပြောင်းနိုင်ပါသည်**). ON writes
  Settings `ai`, `notebook_import` and `app_voice` TRUE: the Menu shows 📒 စာအုပ် (a photo of a page of a
  seller's handwritten notebook, read by the photo AI into proposed entries that the seller confirms), the
  bottom bar shows **ပြော** (voice), and a new piece's photo gets an AI name. OFF writes `ai` FALSE: none of
  them shows, nothing is sent to the AI from any phone or from the bot, and every form works by hand (**AI
  ပိတ်ထားပါသည် · ဖောင်တွေကို လက်နဲ့ ဖြည့်ပါ**). A voice note or a notebook page recorded before the switch
  went off is skipped, not sent; a new piece's photo still goes up, without the AI. The owner's phone changes
  at once, every other phone at its next sync, the bot at its next tap.
- **ဆိုင်များ** (the owner only): one row per shop (its name, then its address and phone). A row opens the
  shop form: **ဆိုင်အမည်** (required, 40 characters), **လိပ်စာ** (80), **ဖုန်း** (40, two numbers allowed),
  **Save**. The header and the receipt change at once; the change reaches the Sheet's Settings rows
  (`shop_name_S1`, `shop_address_S1`, `shop_phone_S1`, …) at the next sync and every other phone after its own
  (**ဆိုင် အချက်အလက် သိမ်းပြီး · ပို့ပြီးရင် ဖုန်းတိုင်းမှာ ပြောင်းပါမည်**). The letterhead brand stays a
  Sheet row. A change the server refuses shows a toast and the server's value comes back. The shop ids S1 and
  S2 stay; the screen lists every shop id there is, so a third shop, when it is added in a later round, gets
  its row without a change here.

**The old one-tap card.** The owner chooses in the Settings tab of the Sheet: the row `sale_flow` is `form`
(the default) or `quick` (the old card: one tap sells, then the buttons under the sold card add the buyer, the
account or the credit; no job buttons and no forms; a restock starts from the scanned piece's card,
ကုန်ရောက်, or from the Menu's 📦 ကုန်ရောက်). Under `quick` the Menu's 📦 runs Telegram's ☰ 📦 loop (round 6b)
as chat cards: the card asks for a tag; **Scan** keeps the loop and reads the tag (for a torn tag,
**နံပါတ် ရိုက်မယ်** under the scanner: the shop and four digits, so the card's example `42` does not apply
here); the count card offers +၁ +၅ +၁၀ +၂၀, **အခြား** (the number keypad), **မလုပ်တော့** (skip this tag)
and **ရောင်းမယ်** (the item card; the loop ends); after each count the next tag is asked, with **ပြီးပြီ** to
finish. **Menu** ends the loop, and so does Scan while the keypad of **အခြား** is open (the next scan then
shows the item card). Each count is its own RESTOCK with its own **မှားသွားတယ်**; the rest of the loop's
rules are in `apps-script/README.md`, section H. The buyers page, the receipt page and the history stay the
same. No publish is needed: the bot
follows at the next tap, the phones at their next sync. A phone also goes back to the one-tap card by itself,
and asks no promised day, while the bot it syncs with is older than round 5 (the app published before the
bot, or the bot rolled back); its first sync with the new bot brings the forms back.

## The measurement form (📏)

In the app, a customer's measurements are typed into one form.

- **Open it**: Menu > **📏 အတိုင်းအတာ**, then choose the customer (a recent one, **နာမည်အသစ်**, or type
  the name); or press **အတိုင်းအတာ** on a buyer's page, which opens the form for that buyer at once (← and
  Save then return to that page).
- **What it shows**: ← and the title at the top; the voucher box; the active fields of the MeasureFields tab
  under their group headings, filled in with the customer's last measurements (**အဟောင်း** and the date;
  **အသစ် တိုင်း** empties the measurement boxes, the note and the drawing, the voucher stays); the figure
  (below); **Save** at the bottom. The one notes box is the MeasureFields row `note` (မှတ်ချက်), a box of up
  to 300 characters; the form has no second notes box any more. A change in the MeasureFields tab reaches the
  app with the next sync. A field whose Key holds anything other than English letters, digits and `_`, or is
  longer than 40 characters, is left out of the form (the Telegram questions still ask it).
- **The figure** (**ကိုယ်ပုံ**): the front view of a woman (**အမျိုးသမီး**, the default) or a man
  (**အမျိုးသား**) to mark on with a finger, as on the paper sheet. It does nothing until **ဆွဲ** is tapped, so a
  finger on it scrolls the page as anywhere else. In drawing mode the pad is outlined: **ဆွဲ** draws, **ဖျက်**
  removes the one line the finger touches, **မျဉ်း ပြန်ဖျက်** removes the last line, and **OK** ends drawing
  mode (so do Save and ←). **ရှင်း** empties the drawing after asking. The drawing is kept with the session,
  works offline, comes back when the buyer's form is opened again (on any phone that has synced), and is
  printed on the measurement PDF (its picture goes up at the next good sync). Up to 60 lines; a drawing that
  is full says so (**ကိုယ်ပုံ ပြည့်သွားပါပြီ · တချို့ကို ဖျက်ပြီးမှ ဆက်ရေးပါ**). At 700 px and wider the figure
  sits beside the fields.
- **Voucher box** (leave it empty when there is no voucher): type just the number and the app makes it a
  voucher id of the shop of the person using the device: `2532` becomes `V1-2532` in shop 1, and `v1-25`
  becomes `V1-0025`. The id shows under the box. Anything else is removed, with **ဘောက်ချာ နံပါတ် မမှန်ပါ**.
- **Fields with several boxes**: one number per box, saved joined with `/` (36, 30, 20 is saved as
  `36/30/20`; an empty middle box gives `36//20`).
- **Enter** moves to the next box (in the notes box it starts a new line).
- **Draft**: what is typed and drawn is kept for a day, also when the app is reloaded or closed, and comes back
  when the form is opened again for that customer. ← (or the phone's back) after typing asks once whether to
  close without saving; yes throws the typed values away.
- **Save** saves on the device at once, also without internet, and says so in a toast (**{customer} ·
  အတိုင်းအတာ {n} ခု သိမ်းပြီး**). At least one value is needed, and the note counts: a drawing alone is not
  saved (**အတိုင်းအတာ တစ်ခုခု ထည့်ပါ**), so a tailor who only draws types one word in the note. The
  measurements go to the Sheet with a later sync, like a sale; until then the sync icon counts them as
  waiting.
- One column on a phone, two columns on a screen 700 px wide or more (a laptop, an iPad).

## How updates reach the phones

1. Change the code, run `node poc/run_app.js`, then build and deploy (step 6). Raising the number in
   `app/VERSION` (for example to `1.0.1`) makes a release easy to recognise; the build adds its own hash anyway.
2. The next time a device opens the app with internet, it quietly downloads the new version in the background
   (the service worker file is never cached by the browser, so it is always checked).
3. The device switches to the new version by itself on a later fresh start of the app, and only when nothing is
   waiting to be sent, no step is half-done and no form is open (sale, new piece, restock, expense, buyer, shop
   or 📏). Never in the middle of a sale; there is no button to tap. To hurry it: close the app fully (swipe it
   away from the recent-apps list; on a laptop close its tab or window) and open it again.
4. To check which version a device runs: Settings (the gear) shows **ဗားရှင်း** and the build; compare it with
   `build` in `https://<project-id>.web.app/version.json`.

**The round 4 build upgrades the app's storage on the device** (its IndexedDB database goes to version 2,
with a new store for measurements; the sales, the waiting rows and everything else already there stay). This
matters only on a device that already has the app from before round 4. On such a laptop or iPad, close every
other tab of the app before its first update to this build: once one tab has upgraded, a tab still open on the
old version can no longer save on the device. It shows **⚠️ ဖုန်းထဲ မသိမ်းနိုင်ပါ** on every change, and what
it makes reaches the Sheet only if that tab syncs before it is closed. From this build on, a tab whose storage
is taken over by a newer version in another tab reloads itself into the new version. Round 6 keeps the
database at version 2.

The Apps Script side is deployed separately (see `apps-script/README.md`). When a change touches both the
server and the app, deploy the server first, then the app. Rounds 4, 5, 6 and 6b go out together, in this
order (the full steps are in `apps-script/README.md`, section I, "Rounds 4, 5, 6 and 6b"):

1. Every check ends with `0 failed`; then `node tools/bundle_gas.js`, `node tools/build_app.js` and
   `node poc/build_simulator.js`.
2. Optional, before the publish: to open the shops on the old one-tap card instead of the forms, add the
   Settings row `sale_flow` with Value `quick`.
3. Publish the bot (`node C:/Users/USER/Desktop/Noel/tools/publish.js bot "what changed"`).
4. Right after, in the same sitting, run `setupSheet` once in the editor (round 6 adds the Settings rows
   `sale_flow` = `form` and `ai` = `TRUE`, the notes and colour of the Shops block, and the Measurements
   column `Sketch`; round 6b's first Lists seed ends with the five `item_category` rows, and the two
   sample-toggle texts of round 3 in the Messages tab become the 🎨 ones), then `rebuildViews`.
5. Only then publish the app (`node C:/Users/USER/Desktop/Noel/tools/publish.js app`; the first time, only after
   point 5 "Firebase for the phone app" of `docs/AUTO-PUBLISH-SETUP.html`).
6. Last, rebuild and republish the simulator page.

If the app goes out first, nothing is lost: an option added with ➕ (account, expense category, fabric), an
account number set with 🔢, a measurement saved in the form, and a shop's details or the AI switch changed on
the owner's phone wait on the devices and go in once the bot is published. Until then every sync adds one
Quarantine row and one Errors row (`sync_reject`, `bad_kind`) per waiting entry; those rows can be ignored, and
the phones sell with the one-tap card (no forms) and ask no promised day. Before rolling the bot back, let every
phone sync first when you can: a promised day still waiting on a phone would reach a bot older than round 5
without its date, a bot older than round 6 keeps a measurement without its drawing and refuses one whose
note is longer than 60 characters (the phone then drops it), and a bot older than round 6b quarantines an
item category added on a phone (the piece keeps the category's name). Roll the app back with the bot. After publishing
the new bot again, run `setupSheet` and then `rebuildViews` once more.

## Never put in config.js

`config.js` is a public file: anyone who opens the app's address can read it. It holds only the `/exec` URL,
the bot's username and a display name. **Never** put there (or anywhere under `app/`):

- the Telegram bot token (it looks like `123456789:AA...`),
- the Gemini / Google API key (it starts with `AIza`),
- the webhook secret, any password, any device token, sharing links to the Sheet or Drive files.

Those live only in the Apps Script project's Script Properties. The build refuses to produce `app/dist` when
it sees a bot token, an `AIza` key or `BOT_TOKEN=` / `GEMINI_KEY=` / `WEBHOOK_SECRET=`. Each device receives
its own token at enrollment and keeps it on the device; it never appears in a URL or in config.js.
