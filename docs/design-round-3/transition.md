# Transition and operation

## What "the app" is, in one paragraph (so the table below has a precise meaning)

A single-file web app (the same build trick as `poc/build_simulator.js`: `core_*.js` inlined unchanged, plus a new `pwa_ports.js` and `pwa_ui.js`) installed on the home screen from a browser. `pwa_ports.js` implements the same `ports` object the Google glue implements today: `store` over IndexedDB (items, ledger rows, customers, settings, messages; stock = sum over local ledger rows exactly as `sim_ports.js` does), `chat` renders to the screen instead of Telegram, `ai` and `pdf` are queues that run only when online, `cache`/`lock`/`clock`/`uuid`/`dedupe` are local. Every button therefore runs `processUpdate()` locally and answers in the time it takes to redraw a card. Every ledger row the core writes is also put in an **outbox**; a sync job pushes the outbox to a new `action=sync` branch of the existing Apps Script web app (script.google.com, measured reachable) and pulls new Items/Customers/Settings/Messages and other phones' ledger rows. The Sheet stays the only source of truth; the phone holds a copy. Because the ledger is append-only and every row already carries a UUID `TxID`, sync is a set-merge: no conflicts, re-sends are harmless, undo is just another row. Three columns are added to Ledger: `DeviceID`, `SyncedAt` (server clock), `TapMs` (tap-to-feedback on the phone). Two tabs are added: `Devices` (DeviceID, Shop, StaffID, Label like "ဆိုင် ၁ ဖုန်း A", TokenHash, Active, LastSyncAt, LastRowTime, OutboxAtLastSync, AppVersion) and `Quarantine` (rows the server would not accept, with the reason). Hosting of the HTML file is decided by Phase 0 test P1 (candidates below); after install the service worker serves the app from the phone, so hosting is touched only at install and update, never during a sale.

Three things change in the core because of offline, and they are the only ones:
1. **IDs made on the phone must not collide.** Receipt numbers become per-device: `R1-A-000231` (shop 1, phone A, phone's own counter) instead of a number derived from ledger order (`receiptNumber()` today walks the whole ledger, which gives different answers on different phones). Customer ids become `C-A-0007` (device letter in the id) instead of `C-0007`. The owner still gets a gap-free sequence per phone; nothing is ever renumbered.
2. **Owner "void".** A new owner-only action reverses any group at any age (today `undoGroup` refuses after 30 minutes unless `force`). This replaces hand edits in the Sheet (see playbook). It is a reversing row like everything else.
3. **Cash count row.** New ledger type `CASH_COUNT` (Amount = counted drawer, Cash = 0) written by the end-of-day button, so the summary can print the drawer difference.

## Division of labour after the change

Legend: **App·off** = works with no signal, answer is instant. **App·on** = in the app, needs signal, queued until there is one. **TG** = Telegram (bot or group). **Both** = either, same ledger.

| Feature | Lives after | Reason |
| --- | --- | --- |
| Sale (scan tag → tap 1/2/3) | **App·off** | The 90% path and the whole point. Scan is the in-app camera (same printed tags; the app reads the `t.me/...?start=S1-0042` text and takes the id). `commitSale` runs locally; the row goes to the outbox. |
| Undo (30 min) | **App·off** on the phone that made the row; **owner void** any row: App·on or TG | Undo is a reversing row (`undoGroup`), works offline. The Undo button only exists on the phone that made the sale, so no cross-phone race. Void by the owner needs the row to have arrived, so it is online. |
| Discount (sell at a price) | **App·off** | A numeric keypad in the app beats typing digits into a chat; `commitSale` with `unitPrice`. |
| Credit sale (💳 မကျေသေး) | **App·off** | `convertSaleToCredit` is two local rows. Customer list is in the local copy; a new customer gets a device-prefixed id and syncs as a Customers row. |
| Receive payment (💰 ငွေလက်ခံ) | **App·off**, server re-checks | `commitPayment` caps at what the phone believes is owed. If two phones take payment on the same credit while offline, the server accepts both and flags "paid more than owed" in the summary; the owner voids one. Rare, visible, reversible. |
| Deposit (📥 စရံ) | **App·off** | Plain row; applying a deposit at delivery is local too (`applyDeposit`). |
| Receipt (🧾) | Text: **App·off**. Forward to customer: app share button → Telegram/Viber. PDF: **App·on** (server builds it). | `receiptText` is pure; numbering becomes `R1-A-000231`. The PDF needs the Sheets export on the server. |
| New item by photo (blank tag) | Register: **App·off** (photo stored locally, category by button, price by preset buttons, placeholder name "S1-0042 · ထမီ"). AI name proposal: **App·on**, queued, shown later as "✏️ အမည် ဒီလို ပြောင်းမလား" with ✅/❌. | The piece must be sellable the minute the tag is tied on. Gemini runs only from Apps Script (Myanmar region rule), so naming is an asynchronous improvement, not a gate. Photo uploads to Drive at sync. |
| Price pending (⏳) + owner ping | Mark: **App·off**. Ping: **TG** from the server when the row syncs. Set price: owner's App·on or TG. Sellers see the price at their next pull. | Push notification to a person who may be anywhere is what Telegram is for; a PWA cannot do that reliably on iPhone. Until then the card already says "ask the owner". |
| Restock | **App·off** | Local row. |
| Return | **App·off** | Local row. |
| Transfer to other shop | **App·off** on the sender; the receiving shop sees it after both phones sync | The garment travels slower than the sync. Until the receiver pulls, its phone says "tag not found" for that id, which is correct for that shop. |
| Recent items / find by name | **App·off** | `recentItems` and `rankItemsByName` run over the local copy. |
| Voice notes | **TG now**; **App·on** (queued) after Phase 0 test P6 passes for both phone types | Gemini is server-only and Telegram already queues offline voice notes and delivers OGG/Opus, which Gemini accepts. Browser recordings are WebM/Opus on Android and MP4/AAC on iPhone; until P6 proves Gemini parses both, the microphone stays in Telegram. |
| Expenses (💸 ကုန်ကျ) | **App·off** by buttons (category → amount → cash/bank, section 13.3); by voice: TG | Three taps, no AI. |
| Reports as PDF | **Server**. Delivered to the owner by **TG** (menu as today) or downloaded from the app when online. On-screen table: **App·off** | `buildReport` is pure and renders as a table offline (the simulator already does this); the A4 PDF needs the Sheets export. Print shops want the file in Telegram/Viber anyway. |
| 21:00 family summary | **TG** (server), with a new sync-status line; also readable in the owner's app under "ဒီနေ့" | Group push with no app needed. The summary must come from the Sheet, not a phone, so it can say what has not arrived (see daily rhythm). |
| Monthly PDF on the 1st | **TG** (server) | Unchanged. |
| Notebook photo import | **TG** for the literate sister now; **App·on** later | Low frequency, one user, Gemini on the server. |
| Owner pings, "staff only", new staff id discovery | **TG** | Unchanged; enrollment of a phone also starts in Telegram (see enrollment). |
| Today's numbers | **App·off** (this phone's view as of last pull) and **TG /today** (server truth) | The app says "ဒီဖုန်း အတိုင်း · နောက်ဆုံး sync ၁၄:၁၂" under the number so nobody mistakes it for the whole shop. |
| End-of-day cash count | **App·off** (new) | Drawer total is `cashNet` over local rows; the count is a row. |
| Sync itself | **App·on**, automatic; **Transport B**: the app hands the outbox to Telegram as a text packet to the bot | Telegram queues offline messages and reaches Google from Telegram's own servers, exactly the path the bot uses today. So a Myanmar→Google outage does not stop the push. |
| Future tailoring module (13.4) | Order, status, delivery, measurement keypad form: **App·off**. Photo-of-measurement-sheet: **App·on** queued. Voucher and measurement PDFs: server, via TG or app download. | The measurement form is the strongest argument for the app: 32 numeric fields on a keypad instead of a chat. Money follows the same rows. |

What stays exactly as it is: the Sheet tabs and formulas, the Telegram bot for anyone not enrolled in the app (the fallback UI), `core_*.js` except the three changes above, the printed tags, the webhook plumbing (HtmlService reply; the sync branch returns ContentService JSON because browsers follow the 302 and Telegram never calls that branch).

---

# Enrollment

## Enrollment: putting the app on a seller's phone from abroad

Who does what: the maintainer (abroad) prepares in the Sheet and talks on a Telegram call; the computer-literate sister holds the seller's phone in the shop. A seller never enrolls alone. Plan 15 minutes per phone the first time, 5 minutes after practice.

### Before the call (maintainer, 5 minutes)
1. In the `Devices` tab add a row: Shop, StaffID (the seller's Telegram id from the Staff tab), Label "ဆိုင် ၁ ဖုန်း A", Active TRUE. Leave TokenHash empty.
2. Make sure the phone is on Unicode (Phase 0 test P4 already told you which phones are Zawgyi). A Zawgyi phone gets switched to Unicode first or does not get the app.
3. Check the Sheet has at least 20 blank tags for that shop; the app pulls them at first sync so a new piece can be registered offline.

### On the call (sister with the seller's phone)
1. On the seller's phone, open Telegram, open the bot, send `/start`, tap **📱 App**. The bot answers with one link and the sentence "ဒီ link ကို ၁၀ မိနစ် အတွင်း တစ်ကြိမ် သာ သုံးလို့ ရပါသည်" (this link works once, within 10 minutes). The link carries a one-time code bound to that Telegram user, so the Staff allowlist is reused and nobody types a password.
2. Tap the link. The browser opens the app. The app shows one screen: the shop name, the seller's name, a big button **ဒီဖုန်းကို မှတ်ပုံတင်မယ်** (register this phone). Tap it. The app exchanges the code for a device token, stores it, and does the first pull (a progress bar, 5 to 30 seconds on a shop connection; if it fails it retries by itself and says so).
3. Add to home screen.
   - **Android (Chrome):** the app shows **ဖုန်း မျက်နှာပြင်မှာ ထည့်မယ်** (put on the phone screen). Tap it, then tap "Install/Add" in the Chrome box. Done.
   - **iPhone (Safari only; it must be Safari):** the app shows a picture: the Share square at the bottom → scroll → **Add to Home Screen** → **Add**. The sister does these three taps. Chrome on iPhone cannot do this, so the link must be opened in Safari (the bot's message says so under the link).
4. Close the browser. Open the app **from the home screen icon** (not from the browser). First open from the icon shows the home screen: a big **📷 Scan** button, **🕘 Recent**, **🔍 Find**, **💰 / 📥 / 💸**, and a small grey line "✅ sync ပြီး · ၁၄:၁၂". If the grey line says ⏳ instead, wait for it; do not start selling until the first pull has finished once.
5. Camera permission: tap 📷, allow the camera. Scan one real tag on the rack; the card must show. Tap **ရောင်း ၁**, see the green confirmation, tap **↩️ မှားသွားတယ်**. That one sale-and-undo is the test; it leaves two rows that cancel out.
6. Tell the seller the one rule for the overlap weeks (below). Hang the new laminated card. The old one comes down from that phone's station the same day.

### What the maintainer sees
The `Devices` row fills in: TokenHash, LastSyncAt, AppVersion. The test sale and its undo appear in the Ledger with the new DeviceID. If nothing appears within two minutes of step 5, the sync endpoint or the token is wrong; fix before enrolling the next phone.

### Lost token, new phone, second phone
Same steps. A Telegram user may have several devices (the owner: her phone and the shop PC's browser). To retire a phone, set Active FALSE in Devices; its next sync is refused and its screen says "ဆိုင်ရှင်ကို ပြောပါ" (tell the owner) while its outbox is kept.

## What the laminated card changes
Today: three pictures, "camera → START → number". New: three pictures, **"App icon → 📷 → number"**, with a fourth small picture: the home-screen chip "✅ 14:12" green and "⏳ ၃" orange, captioned "orange = not yet sent, press it when you have signal". One extra line at the bottom: "ဖုန်းကင်မရာ (camera app) နဲ့ Tag ကို scan မလုပ်ပါနဲ့ — App ထဲက 📷 သာ" (do not scan tags with the camera app; only the 📷 inside the app). That line prevents the one confusing thing: the camera app still opens Telegram for the same tag.

## What the user guide changes
- Part A (sellers) sections 1 to 10: every step that says "Telegram opens / press START / /start" becomes "open the app / tap 📷 or Recent". The buttons keep their Burmese names (same `core_messages.js`), so the pictures change but the words do not.
- Part A gets two new sections: **၁၁။ Sync** (the chip, what orange means, press it, the two-hour reminder) and **၁၂။ နေ့ဆုံး ငွေစစ်** (end-of-day cash count).
- Section 8 (voice) stays Telegram until P6 passes, with one sentence: "voice is in Telegram, buttons are in the app".
- Part C (owner) unchanged except: "📱 App" in the bot menu, and the new sync line in the 21:00 summary explained.
- Part D (troubleshooting) gains the rows from the playbook that a seller can act on: orange chip for hours, "tell the owner" screen, app says a new version is ready, camera does not open.
- Part B (designer) section: new piece can be registered without signal; the AI name arrives later and asks for a ✅.

## 10-minute training per seller (in the shop, with the sister)
1. (1 min) Open the app from the icon. Point at the green chip. "Green means everything is in the book. Orange with a number means that many sales are still only in this phone."
2. (3 min) Three real pieces from the rack: scan, Sold 1; scan, Sold 2, Undo; scan, Discount, type 18000. Let the seller do all three. Say nothing about the internet. If the shop has no signal at that moment, better: the point is that nothing changes.
3. (2 min) A piece without a tag: Recent → tap it → Sold 1. Find → type two letters → tap.
4. (2 min) The chip. Switch the phone to airplane mode, sell one, show the orange "⏳ ၁". Switch back, tap the chip, watch it turn green. "Do this when you see the orange and you have signal, and always before you go home."
5. (2 min) End of day: tap **🧮 ငွေစစ်**, the app shows the expected drawer. Count, type the number if different, tap done. "Then tap the chip once more."

Credit sales, payments, deposits and expenses are taught in week two to the seller who actually does them, five minutes each, using the same flows as today (the buttons did not change).

## Keeping two UIs from confusing people during the overlap
- **One phone, one way.** The moment a phone is enrolled, the Telegram bot stops showing sale buttons to that Telegram user. A scan that reaches Telegram by mistake (camera app) answers with the item name and price, and one button **📱 App ထဲမှာ ရောင်းပါ** that opens the app. The bot never silently sells from an enrolled phone, so a seller cannot log the same sale twice in two places.
- **Non-enrolled users see the old bot unchanged.** The owner and the designer may stay on Telegram for weeks; nothing breaks for them.
- **The camera app problem.** The printed tags still say `t.me/...`. That is deliberate: tags do not need reprinting and Telegram remains the fallback. The card line above, plus the bot's "sell in the app" reply, is enough; after two days nobody opens the camera app for tags.
- **Owner's view does not change.** Summaries, pings, PDFs keep arriving in Telegram, so the person who approves the change feels no disruption.
- **Shop 2 keeps the Telegram bot** until shop 1 has passed the acceptance criteria; the two shops are never half-and-half within one shop.

---

# Daily rhythm

## A day in the shop with poor internet

**Opening (seller, 1 minute).** Open the app from the icon. It shows yesterday's closing state at once (no spinner) and, in the background, tries one pull with a 10-second timeout. With signal: the chip goes "✅ ၀၈:၄၂", prices set overnight by the owner and transfers from the other shop appear, and the day starts. Without signal: the chip shows "⏳ မသွားသေး · နောက်ဆုံး ယမန်နေ့ ၂၀:၅၈" in grey; the app is fully usable; the pull repeats every 5 minutes while the app is open. Nothing on the screen asks the seller to wait, ever.

**Selling (all day, no network needed).** Scan → tap. The card answers in the time it takes to redraw (target under 300 ms). Every row goes to the outbox; the chip shows the outbox count: "⏳ ၃". Whenever the phone has any connectivity the app syncs by itself: on every return to the app, every 5 minutes while open, and when the network changes (for instance arriving on Wi-Fi). A sync is one POST with the whole outbox and the pull cursor; a slow link that takes 20 seconds is fine because nobody is waiting on it. Rows are removed from the outbox only when the server has answered "ok" or "duplicate" for them by TxID, so a half-finished sync is harmless and is simply repeated.

**Two-hour rule.** If the oldest outbox row is older than 2 hours, the chip turns red and a full-width line appears every 30 minutes: "📤 ၂ နာရီ ကတည်းက မပို့ရသေး — လိုင်း ရှိရင် ဒီမှာ နှိပ်ပါ" (not sent for 2 hours; tap here when you have signal). Tapping syncs; failing that, it suggests moving to where there is signal, and after 4 hours it offers Transport B through Telegram. The seller does not need to understand why; the card says "orange or red: press it when you have signal, and before going home".

**Lunch and Wi-Fi.** If the shop has Wi-Fi only at certain hours, or the seller passes a Wi-Fi spot at lunch, the app syncs itself when the network changes. If the seller takes the phone home and has Wi-Fi there, the evening sync happens then; the summary already went out, so the correction message covers it (below).

**Closing (seller, 2 minutes).** Tap **🧮 ငွေစစ်**. The app shows the expected drawer for this shop today from the local rows: cash in minus cash out (`cashNet`: sales paid now, payments received, deposits, minus refunds and expenses), in one large number, with the one-line breakdown under it. The seller counts the drawer and taps **ကိုက်တယ်** (matches) or types the counted amount. The app writes a `CASH_COUNT` row (Amount = counted) and shows the difference. Then the seller taps the chip and waits only until it turns green; if it does not, the card says to try again at home or tell the owner, and the summary will say the phone is stale. The owner sees the difference in the summary: "💵 ငွေစစ် ဆိုင် ၁: ကိုက်" or "လွဲ −၅,၀၀၀".

**21:00 summary (server).** Built from the Sheet as today, plus the sync-status line. The rule for "stale": an active device whose LastSyncAt is more than 60 minutes ago and that had rows today, or that has not synced at all since 18:00 today, or whose last sync reported a non-empty outbox. Per stale phone the summary prints exactly: "⚠️ ဆိုင် ၂ ဖုန်း ၄ နာရီ ကတည်းက sync မလုပ်ရသေး — ဆိုင် ၂ စာရင်း မပြည့်စုံ" (with the label and the hours filled in). When no phone is stale: "✅ ဖုန်း ၃ လုံး အားလုံး sync ပြီး". The numbers above the line are never silently short: if a shop had an active phone that did not sync today, that shop's line says "(ဖုန်း A မရောက်သေး)" after its revenue.

**Correction after late rows.** When rows dated today arrive after the summary was posted (the evening Wi-Fi case), the server posts once, at most once an hour and not after midnight: "📊 ၂ နိုဝင်ဘာ (ပြင်ဆင်ပြီး · ဆိုင် ၂ ဖုန်း A ရောက်ပြီ)" with the full corrected summary. Rows for yesterday that arrive today appear as a line in today's summary: "ယမန်နေ့ နောက်ကျ ရောက်: ဆိုင် ၂ · ၃ row · ၄၅,၀၀၀" so the monthly totals and the daily messages never disagree without saying so.

**Owner's day.** Nothing changes in Telegram: 21:00 summary in the group, pings when a price is pending, PDFs on request and on the 1st. If she installs the app, "ဒီနေ့" shows both shops as of her last pull with the "as of" time under the number, and the ပြင် menu lets her void a wrong row with one tap and a reason, without the Sheet.

**Maintainer's day.** Read the Ops line (20 seconds). Once a week: SyncLog for failures with signal, Quarantine for undecided rows, Devices for a phone on an old version or long unsynced, Errors as today.

---

# Playbook

## Failure and recovery playbook

Format: what happened → what the family sees → what they do → what the maintainer does → what prevents it next time.

**1. Phone lost or broken with unsynced sales.**
Seen: nothing; the owner notices at 21:00 from the summary line "⚠️ ဆိုင် ၁ ဖုန်း A · ၁၄:၁၂ ကတည်းက sync မလုပ်ရသေး" or the seller reports it.
Family: count the drawer. The maintainer or sister sets the device Active FALSE in `Devices` (a thief with the phone can push nothing further). The gap is bounded by LastSyncAt in Devices: everything before it is in the Sheet. For the gap, the seller and the sister reconstruct from the drawer: drawer − expected drawer at LastSyncAt = unrecorded cash. The sister records it in Telegram with the owner's **ပြင်** menu: either the actual pieces if the seller remembers them (scan the rack for what is missing: the stock-list PDF versus the rack), or one SALE on the special item `S1-0000 "ဖုန်း ပျောက် · မှတ်မရ"` for the amount, so revenue and cash are right and stock is fixed by a rack count on the weekend.
Maintainer: revoke, enroll a replacement phone (15 min), check `Quarantine` for nothing odd.
Prevention: sync runs by itself every 5 minutes while the app is open and online and on every return to the app; the chip turns orange with a count; after 2 hours unsynced the app shows a full-width reminder every 30 minutes; after 4 hours it offers **Transport B** ("Telegram နဲ့ ပို့မယ်": hands the outbox as a text packet to the bot through Telegram's own offline queue, which the bot ingests like any sync). The owner summary's sync line makes a stale phone visible the same evening, never a week later.

**2. Two phones in one shop.**
Supported by design: each has its own DeviceID, letter, counters. Rows interleave by event time in the Sheet.
The one real effect: phone B does not know phone A's sales until it pulls, so stock on B is stale by minutes to hours. A SKU with 5 in stock sold 3 on A and 3 on B shows −1 after merge; a UNIQUE piece "sold twice" is physically impossible, so it is a mis-scan. The server flags any item whose stock went below zero in the summary: "⚠️ S1-0042 လက်ကျန် −၁ — စစ်ပါ". The sister looks, voids the wrong row with the owner's ပြင် button (a reversing row). Prevention: pull-on-open and pull-on-sync; both phones in one shop should sync at lunch. Payments on the same credit from two phones: server accepts both, summary says "ပေးပြီး > ကျန်", sister voids one.

**3. The sister enters a correction in the Sheet by hand.**
Rule unchanged: Ledger rows are never edited; corrections are reversing rows. What changes is that she no longer needs to touch the Sheet: the owner role in Telegram and in the app has **ပြင်** (fix): pick today's or any day's row from a list, tap **ပယ်ဖျက်** (void), optionally re-enter it right. The Ledger and Items tabs stay protected (plan rule 9) so a hand edit requires the owner account on purpose.
If a row was edited anyway: phones hold their copy and will not see the edit. The server includes a per-day checksum (row count and sum of Amount and Cash per shop) in every sync response; a phone that disagrees for a day it holds re-pulls that day in full. Divergence lasts until the next sync, never longer. A deleted row cannot be detected by TxID, so deletion is forbidden and the weekly backup is the recovery; the `Errors` tab gets a line when a checksum mismatch was repaired, so the maintainer knows a hand edit happened.

**4. The server rejects a row.**
Reasons the sync branch refuses: unknown ItemID (a blank tag that does not exist in the Sheet, for instance a mistyped id), a blank tag registered by two phones (second registration loses), a row whose Time is more than 10 minutes in the future of the server clock (phone clock wrong), a negative payment, a malformed packet. Accepted-but-flagged (goes into Ledger and the summary): stock below zero, payment above owed.
Refused rows are removed from the outbox, written to the `Quarantine` tab with the reason, and the phone shows them under **❌ လက်မခံ** on the home screen with "ဆိုင်ရှင်ကို ပြောပါ". For the blank-tag race the losing phone's item card changes to the winner's name and the local sale rows stay valid (they reference the tag id, which exists). The sister reviews Quarantine with the maintainer weekly; most entries are re-entered correctly in one tap from the owner's ပြင် menu ("ဒီ row ကို ပြန်ထည့်").
Phone clock: the app compares its clock with the server's at every sync and, if off by more than 5 minutes, shows "⏰ ဖုန်း နာရီ မမှန် — ပြင်ပါ" and stamps rows with the corrected time until the phone is fixed.

**5. Token expired or revoked.**
Tokens have no expiry; they are revoked by setting Active FALSE or by re-enrolling the same device (which replaces the hash). The phone sees HTTP 401 on sync, keeps every outbox row, keeps selling offline, and shows "ဖုန်း ထပ်မှတ်ပုံတင်ရန် — ဆိုင်ရှင်ကို ပြောပါ" on the chip. Re-enrollment (Telegram → 📱 App → link → register) binds a new token to the same local database; the outbox then syncs. Nothing is lost in this path by construction: the outbox is never cleared on an auth failure, only on a per-row "ok" or "duplicate" from the server.

**6. The app shows an old version.**
Every sync response carries `latestVersion`. The service worker fetches the new build in the background; when it is ready the app shows a banner "✨ အသစ် ရပြီ — ပြန်ဖွင့်ပါ" with one button that reloads. A phone that has not opened the app in weeks updates on first open with signal. If a phone stays on an old version for more than 7 days (visible in Devices.AppVersion and the Ops line), the maintainer asks the sister to open the app on Wi-Fi and tap the banner. Last resort: sync first until the chip is green, then remove the icon and enroll again (removing the icon deletes local data on iPhone, which is why "sync first" is the rule written on the card). The server keeps accepting rows from old versions unless `minVersion` says otherwise; a below-minimum app can still sync but cannot sell until it reloads, and the message says exactly that.

**7. Storage cleared.**
Causes: user "clear browsing data", iPhone reinstall, Android storage pressure (rare for installed PWAs; the app requests persistent storage on first run). Effect: token and local database gone, including any unsynced rows. The phone shows the enrollment screen. The family re-enrolls (15 min); the first pull restores everything that reached the Sheet. The loss is the unsynced rows, bounded as in case 1 and visible in the summary line. Prevention is the same as case 1, plus: the app never asks the user to clear anything, and on iPhone the app lives as a home-screen web app, which is exempt from Safari's 7-day storage eviction for unvisited sites.

**8. Telegram blocked for a day.**
The app does not use Telegram, so selling, syncing, pulling and PDFs continue (PDF: the app opens the server's `action=pdf` URL in the browser, which follows the redirect to the file). What stops: the 21:00 group post, owner pings, receipt forwarding to customers, voice. The server detects the failed `sendMessage` and stores the summary; the owner's app shows it under "ဒီနေ့ → 📊 ည ၉ နာရီ အနှစ်ချုပ်" after a pull; pings are shown in the owner's app the same way. When Telegram returns the stored posts are not re-sent (the day is over); the next summary says "ယမန်နေ့ Telegram မရောက်ပါ" with the previous day's summary appended once. Voice is unavailable that day; buttons never were. Transport B is unavailable too, so Google reachability matters that day: it is the other leg.

**9. Google unreachable from Myanmar for a day.**
Selling is offline; nothing changes in the shop. Sync fails; chips turn orange; after 4 hours the app offers Transport B. Transport B works precisely in this case: the phone talks to Telegram (reachable), Telegram's servers talk to Google (not from Myanmar). Pushes arrive, the summary is right, the sync line says which phones used Transport B. Pulls wait until Google is back (new items from the other shop, prices set by the owner), which is tolerable for a day. The Telegram bot itself keeps working for everyone, since it was always Telegram→Google. If both Telegram and Google are unreachable, the shop still sells; the day's rows arrive the next day and the summary carries the correction.

**10. The Sheet hits its size or slows down.**
The real limit is not the 10-million-cell cap (about 12 years at 3,000 rows a month) but Apps Script reading the whole Ledger on every call (`gasTable('Ledger')`), which gets slow past roughly 40,000 rows, and phones pulling a very large first sync. Design: the active `Ledger` holds the current year; `archiveLedger()` moves last year's rows to `Ledger2026` on January 1st (owner-only button in Telegram and a reminder in the Ops line from 35,000 rows: "📄 Ledger ၃၅,၀၀၀ rows — archive"). Open credits and held deposits from the archived year are carried forward as opening rows so `openCredits` and `depositsFor` keep working. Phones pull only the active year plus open credit groups, so a first sync stays under a few MB. Monthly reports for an archived month read the archive tab.

**11. Gemini quota exhausted (or the model errors).**
Buttons never touch Gemini, so sales, expenses, credits, everything offline continues. Queued voice notes and new-item photos wait on the server with a retry every 30 minutes until the daily quota resets; the app shows "🎤 ၃ ခု စောင့်နေ" (3 waiting) and new items keep their placeholder names, which are sellable. A voice note waiting longer than 2 hours is sent back to the seller in Telegram with "ခလုတ်နဲ့ ထည့်ပါ" so the sale is not forgotten; the audio is still processed later and, if it then parses to a sale that the seller already entered by button, the proposal says "ဒါ ထည့်ပြီးပြီလား?" (already entered?) with ❌ as the default. The Ops line shows "AI queue 3 · oldest 2h". Plan 9's note stands: the paid tier at about one dollar a month removes this case entirely, but the design does not depend on it.

**12. Related small cases.**
- Camera will not open: Android, the site permission was denied once; Settings → Apps → the app → Permissions → Camera. iPhone: Settings → Safari → Camera → Allow. Until fixed, Recent and Find sell anything.
- Phone offline for days (the owner travelling): the app works; the first sync after return takes longer; nothing else.
- Same tag scanned twice by two sellers for one customer: the second seller sees the stock already lowered only after pull; the physical piece is gone, so the second scan is a different piece with a reused tag or a mistake; the summary's negative-stock flag catches it.
- Sister adds staff: unchanged (Staff tab); the Devices row is what enables the app for them.

---

# Measurement

## Proving the speed problem is solved

Three numbers, measured where they happen, written into rows the Sheet already receives.

**1. Tap-to-feedback on the phone (the number the sellers feel).** The app timestamps the tap (`performance.now()` in the button handler) and the moment the confirmation card has been painted (`requestAnimationFrame` after the DOM update). The difference is stored on the ledger row as `TapMs` for mutating actions and in a local ring buffer of the last 200 non-mutating actions (card open, Recent, Find). Target: median under 300 ms, 95th percentile under 1,000 ms, measured on the sellers' own phones, not the maintainer's. For comparison the current path is 2 to 4 seconds on a good day (plan 4.1) and "many seconds or late" in the shops.

**2. Sync lag (how far the Sheet is behind the shop).** Per row: `SyncedAt − Time` (server clock minus phone event time). Computed by the server in the sync branch and written to the row. Daily aggregates per device: median, 95th percentile, maximum, and the count of rows that arrived more than one hour and more than one day late. Target for the pilot: median under 15 minutes, 95% of rows in the Sheet within 2 hours on a normal day, 100% of a day's rows in the Sheet by 08:00 the next morning.

**3. Unsynced-row age (the risk on the phone right now).** On the phone: age of the oldest outbox row, shown as the chip colour (green 0; orange with count under 2 hours; red over 2 hours). On the server: `now − Devices.LastSyncAt` for every active device that had rows that day, plus `OutboxAtLastSync` (the phone reports its outbox size with every sync, so the server knows the count as of then). The sync-status line in the 21:00 summary is this number in words.

**Where the numbers appear.**
- *Family group, 21:00:* only the sync-status line, in Burmese, and only when a phone is stale (it is not an Ops dashboard). Example: "⚠️ ဆိုင် ၂ ဖုန်း ၄ နာရီ ကတည်းက sync မလုပ်ရသေး — ဆိုင် ၂ စာရင်း မပြည့်စုံ". When everything is in: "✅ ဖုန်း ၃ လုံး အားလုံး sync ပြီး".
- *Owner summary (owner's private chat, same time), one extra Ops line:* "⚙️ tap→reply ၀.၃ စက္ကန့် · sync နှောင့်နှေး ၁၂ မိနစ် · ၁ နာရီ ကျော် နောက်ကျ ၃ row · ဖုန်း: ဆ၁-A ၂၀:၅၈ ✅ · ဆ၁-B ၂၀:၄၀ ✅ · ဆ၂-A ၁၆:၁၂ ⚠️ · AI queue 0 · app v12 ×3". Medians over the day; the owner learns to read it as "all green" in a week; the maintainer gets the same message.
- *Sheet:* `Devices` tab (live state per phone), `SyncLog` tab (one row per sync: DeviceID, At, Transport A/B, RowsPushed, RowsPulled, DurationMs, Result, AppVersion), `Ledger.TapMs` and `Ledger.SyncedAt` columns. A small `Ops` tab with formulas: daily medians and p95 of TapMs and lag, late-row counts, rows per transport, days per device without a sync. The maintainer looks at Ops weekly, like the Errors tab today.
- *In the app, ℹ️ screen:* version, device label, last sync, outbox count and oldest age, today's median tap time, hosting origin. The sister reads this screen to the maintainer over the phone when something is odd.

**Pilot acceptance criteria (shop 1, two weeks; all must hold over the last 7 days).**
1. Speed: median TapMs under 300 ms and p95 under 1,000 ms on every enrolled phone; no seller report of "waiting" in the daily check-in.
2. Completeness: every day's rows in the Sheet by 08:00 next day; zero rows lost (phone outbox empty after sync AND the server's per-day checksum equals the phone's for every day the phone holds).
3. Integrity: zero duplicate TxIDs in the Ledger; Quarantine has no row older than 7 days without a decision; every negative-stock flag resolved within one day.
4. Adoption: the end-of-day cash count matches the app's expected drawer within 5,000 MMK on at least 6 of 7 days, and the sellers' notebooks are not in use (the sister checks; the notebook is the competitor, not Telegram).
5. Self-sufficiency: at least one Transport B push and one re-enrollment were exercised (deliberately) and worked; the sister resolved at least one Quarantine or void without the maintainer.
6. Reachability: the sync endpoint succeeded on at least 95% of attempts logged in SyncLog per device (attempts while offline are not counted; attempts with signal that failed are).
7. Summary correctness: on every day a phone was stale at 21:00, the summary said so, and a correction message followed when the rows arrived.
Shop 2 is enrolled only when all seven hold.

---

# Phase 0

## Phase 0 tests to run before building the app (3 to 4 elapsed days, mostly waiting; the family's time is about two hours total)

Each test has a pass rule; a fail reshapes the design as stated. Run from both shops' phones on their own SIMs and on the shop Wi-Fi where there is one. No VPN at any point.

| # | Test | How | Pass | If it fails |
| --- | --- | --- | --- | --- |
| P1 | Hosting domain reachable from both shops | Put a 1-line page on each candidate: Firebase Hosting (`<name>.web.app`, Google infrastructure, free Spark plan, deploy from the maintainer's computer with the Firebase CLI, no card), GitHub Pages (`<user>.github.io`, upload through the GitHub website, no CI needed), and the Apps Script web app itself (`script.google.com/.../exec`, already measured OK) as control. The sister opens each link morning, noon, evening for 3 days on each shop's SIM and on Wi-Fi, replies "ok/fail" in Telegram each time (18 taps per shop). | ≥ 95% success per candidate and first load under 10 s | Pick the candidate that passes; if only script.google.com passes, the app is served from Apps Script and the "offline" part is lost until a host is found, so the project waits; do not build on an unmeasured host |
| P2 | Service worker and home-screen install on one Android and one iPhone of the family | Install the current simulator HTML (plus a 20-line service worker) from the chosen host; add to home screen; switch to airplane mode; open from the icon; tap through a sale | App opens and sells with no signal on both; data survives closing the app and restarting the phone | iPhone fails: pilot Android-only and the iPhone users keep Telegram; Android fails: re-check the phone's Chrome version |
| P3 | Browser-to-Apps-Script sync call | From the installed app, `fetch` POST (text/plain body, redirect follow) to `/exec?action=sync&token=test` returning JSON through ContentService; also the `action=pdf` download | 200 with JSON on both phones' browsers; the PDF opens | The CORS/redirect behaviour of Apps Script web apps is the risk; fallback is a JSONP-style GET for pull and Transport B for push |
| P4 | Burmese rendering in the app | The app page shows the real `core_messages.js` strings, Burmese digits, the 21:00 sample summary, and one PDF; screenshots from every phone that will be enrolled | Every glyph correct, no boxes, no Zawgyi scrambling, with the phone's built-in Myanmar font (no web font download needed) | A Zawgyi phone is switched to Unicode or excluded; if the built-in font is missing, bundle Noto Sans Myanmar in the single file (about 300 KB, acceptable) |
| P5 | A real day of offline use with a forced sync later | One seller uses the installed test build for one full day in airplane mode (or with data off) on real sales, writing the paper notebook in parallel as today; at closing, data on, tap the chip. Compare the notebook, the drawer and the Sheet | Every notebook line is in the Sheet; the cash count matches; the seller did not wait for anything; the sync took under one minute | The gaps show what the UI makes people skip; fix before the pilot |
| P6 | Voice recording format on each phone | Record 5 Burmese notes in the browser on Android Chrome (WebM/Opus) and iPhone Safari (MP4/AAC), upload through the test sync, run them through the existing `tools/score_voice.js` prompt | Gemini returns the right intent and numbers at the same rate as the Telegram OGG notes (T2's 90%) | Voice stays in Telegram for the app pilot; in-app microphone is deferred; nothing else depends on it |
| P7 | In-app QR scanning of the existing tags | Scan the printed `tools/sample_tags_S1.pdf` tags inside the app in shop light, both phone types, with the camera permission remembered after reopening from the icon | Scan to card under 2 s; permission not asked again on reopen | If iPhone asks for permission on every open, the card teaches "tap Allow" and Recent/Find become the first-line path on iPhone |
| P8 | Transport B round trip | Airplane mode, sell three pieces, tap "Telegram နဲ့ ပို့မယ်", which opens Telegram with a prepared packet to the bot; data on; let Telegram deliver it; check the Ledger | Three rows, no duplicates, DeviceID set, SyncLog says transport B; then a normal sync does not re-push them | If Telegram's share sheet mangles the packet, send it as a file instead of text |
| P9 | Install from abroad over a call | The maintainer enrolls the sister's own phone remotely by the exact script in the enrollment section, timing it | Under 15 minutes, no step needed the maintainer to see the screen | Rewrite the step that failed; add a picture to the bot's message |
| P10 | Storage persistence | After P2, leave the installed app unopened for 8 days on the iPhone, then open it offline | Data still there | If evicted, iPhone phones must sync before closing each day and the card says so; pilot Android-first |

Also carried from the plan and still open: T2 (voice accuracy on real notes), T6 (Google sign-in from the shop for the sister's PC), T7 (script.google.com form inside Telegram). P1 and P3 together answer T7's reachability part.

Side note for the maintainer, outside the test list: `survey.txt` in the project folder appears to hold a Gemini API key in plain text. Move it to Script Properties and delete the file before anything in this folder is shared or hosted.

---

# Pilot

## Effort for the non-code parts

| Work | Who | Effort |
| --- | --- | --- |
| Phase 0 P1 to P10 | maintainer + sister | 3 to 4 elapsed days, about 2 hours of the family's time, about 1 day of the maintainer's |
| Burmese strings: about 40 new (sync chip, enrollment screen, cash count, quarantine, sync line, Ops line, version banner, Transport B) | sister rewrites in the Messages tab | half a day, after the maintainer's draft |
| Laminated cards: new 3-picture card per phone station, plus the camera-app warning line | maintainer designs, family prints and laminates locally | 1 hour design, one print-shop visit |
| User guide: Part A rewritten, two new sections, Part D rows, screenshots from the real app | maintainer, sister checks the Burmese | 1 day |
| Enrollment: Devices rows, calls, 15 min per phone | maintainer + sister | 1 hour for three phones |
| Training: 10 minutes per seller, 5 minutes per extra flow in week 2 | sister | 1 hour total per shop |
| Pilot monitoring: Ops line daily, SyncLog and Quarantine weekly, one 10-minute check-in call with the sister per week | maintainer | 20 minutes a day for 3 weeks |
| Owner decisions below | owner | one conversation |

For scale, the code side (not asked here, stated so the owner can weigh the whole): `pwa_ports.js` and `pwa_ui.js` built from `sim_ports.js`/`sim_ui.js`, the sync branch and the Devices/SyncLog/Quarantine tabs in Apps Script, the three core changes, the summary lines, the Telegram enrollment and hand-off messages: about two to three weeks of the maintainer's evenings, with the existing `run_scenario.js` extended to cover offline merge cases.

## Pilot sequence

**Which shop first: shop 1**, the shop the plan already chose for the Telegram pilot and the one where the computer-literate sister can stand next to the seller in the first days. Shop 2 stays entirely on the Telegram bot until shop 1 passes the acceptance criteria; no shop runs both UIs on the same phone.

**Which phones first: the two Android phones with the best Phase 0 results**, enrolled on the same day. An iPhone joins in week 2 of the pilot only if P2, P7 and P10 passed on it; otherwise iPhone users keep Telegram and are enrolled after the pilot.

**Which features first (what the sellers are taught, in order; everything else stays hidden behind a setting until its week):**
- Week 1: scan → sale, undo, discount, recent, find, restock, return, sync chip, end-of-day cash count. Credit sales and payments stay in Telegram for that week only if the seller doing them is not yet enrolled; otherwise they are in the app from day one since the flows are identical.
- Week 2: credit sale, receive payment, deposit, receipt (text and share), expenses by buttons, transfer. Deliberate drills: one Transport B push, one re-enrollment of a phone, one void by the sister.
- Week 3 (shop 1 acceptance, shop 2 enrollment starts): new item by photo with placeholder name and later AI naming; price pending with the owner setting prices in her app.
- After both shops: in-app voice if P6 passed; notebook import in the app; the tailoring module on the app from the start (its measurement form is the reason to have an app at all for the design department).

**Stop rules during the pilot:** if a day's rows are missing from the Sheet at 08:00 for two days in a row, or a lost row is confirmed, the pilot phones go back to Telegram the same morning (set Devices Active FALSE; the bot resumes sale buttons for those users immediately) and the cause is fixed before resuming. Tags, Sheet and summaries are unchanged by the switch, so rolling back costs nothing but the sellers' patience.

## What the owner should decide now

1. **Go or no-go on the offline app itself**, knowing it is two to three weeks of build plus three weeks of pilot, zero monthly cost, and that it leaves the Sheet, the tags and her Telegram untouched.
2. **Which two phones in shop 1 are the pilot phones**, and whether the shop keeps one phone or two (two is supported; the stale-stock flag is the price).
3. **Receipt numbering:** accept `R1-A-000231` (per phone, gap-free per phone, never renumbered) instead of one sequence per shop. The alternative, numbers assigned by the server at sync, means a receipt shown to a customer offline has no number yet.
4. **The 21:00 summary when a phone is stale:** post at 21:00 with the warning line and a correction later (recommended), or wait until 21:30 once. Also whether she wants the Ops line in her private summary or only the maintainer.
5. **Who counts the drawer and when**, and the tolerance she considers "matches" (the acceptance criterion uses 5,000 MMK).
6. **Whether the sellers may keep using Telegram voice notes during the pilot** (recommended yes: voice stays in Telegram until P6 passes, and it does not duplicate button sales because the proposal always asks for a ✅).
7. **The app's Burmese name and icon** as it will appear on the home screen (the sellers will call it by that name), and whether the owner herself wants the app on her phone in week 1 or prefers Telegram only until shop 2 is enrolled.
8. **The three tailoring decisions from section 13.4** remain open and are not blocked by this work, but the tailoring module should be built on the app, not the chat, so they are best decided together.
