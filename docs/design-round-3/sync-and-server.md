# SalesTagBot offline-first: sync and server design

Scope: the phone runs `core_config/burmese/messages/ai_prompt/ledger/report/bot.js` unchanged (three small, backward-compatible edits listed in section 10) against a local store; Apps Script keeps the Sheet as the single truth and grows a sync API next to the Telegram webhook. Everything below fits the code as it stands in `C:\Users\USER\Desktop\Noel\apps-script` and `C:\Users\USER\Desktop\Noel\poc`.

## 0. Shape of the answer, in one paragraph

The phone gets a PWA (installable web page, Android and iPhone, no app store) built by the same bundler that makes `poc/dist/pos-simulator.html`: core files + a persistent version of `poc/sim_ports.js` whose store is backed by IndexedDB, plus the chat-like UI from `poc/sim_ui.js` with the shop-floor and Sheet panes removed. A tap calls `processUpdate()` locally and answers in milliseconds. Every ledger group the core writes goes into an outbox; a sync loop posts the outbox to `/exec?api=sync` with the device token and pulls the delta back by a server sequence number. Voice and photo are queued as blobs and sent to `/exec?api=ai` when online; the server runs only the Gemini call and returns the intent, and the phone runs `handleIntent()` itself, so the confirm screen appears later as a proposal. Telegram stays for the 21:00 summary, owner pings, PDFs, receipt forwarding, and as the fallback UI through the unchanged `doPost` Telegram route.

Hosting the PWA shell: the shell only needs its origin at install time and on updates (the service worker caches it). Candidates in order: GitHub Pages (`<user>.github.io`, push a built file, no CI needed), Firebase Hosting free tier (`*.web.app`), both with Myanmar reachability still to be measured (github.com measured 92 percent, github.io and web.app not measured). Apps Script's own HtmlService cannot host it: HtmlService pages run in a sandboxed iframe on googleusercontent with no service worker and no manifest, so they cannot be installed or work offline. Data traffic always goes to `script.google.com/macros/s/<id>/exec` (measured 2/2 OK), whose body is served after a 302 from `script.googleusercontent.com`, which must be added to the Phase 0 measurements (T11 below).

## 1. Local data on the phone

### What is mirrored

| Tab | Mirrored | Scope per device | Why |
| --- | --- | --- | --- |
| Items | all rows, both shops, minus formula columns (Status, Stock) | staff and owner: all 400+ tags; Cost is stripped for role staff | tiny (400 x 13 fields, about 60 KB); transfers need the other shop's id; Status and Stock are derived locally exactly as `sim_ports.viewItem` does |
| Customers | all | all | small, shared across shops, needed for credit and deposit buttons |
| Staff | only self | the device's staff record from Devices binding | `getStaff(uid)` returns self; `listStaff()` returns owners (ids only) so `notifyOwners` can address them |
| Settings, Messages | all | all | drives labels and presets; pulled whole when the server hash changes |
| Ledger | a working window, not all rows | own shop (staff) or both shops (owner) | see below |

### The ledger window

`core_ledger.js` scans `ledgerRows()` in ten places (undo, saleGroupInfo, openCredits, depositsHeldMap, statsWhere, recentItems, recentCustomers, receiptNumber, dayReport, monthReport). Each needs a specific subset to be correct. The window W is defined by Seq membership, never by Day alone:

- R1 every row with `Seq` in the last two calendar months of receipt (this month and last month), about 2 x 6,000 = 12,000 rows at 200 events/day for two shops;
- R2 every row of any sale group that still has money owed, whatever its age, plus every PAYMENT row whose RefGroupID points at such a group (so `saleGroupInfo`, `openCredits`, `convertSaleToCredit` are exact);
- R3 every DEPOSIT and DEPOSIT_APPLIED row ever (`depositsHeldMap` sums all time; deposits are rare, tens per month);
- R4 for staff devices: any row of a group that has at least one row in the device's shop (transfer groups span shops).

Plus an opening balance: `openingStock[itemId]` = SUM(Qty) over rows that are not in W. The store computes `item.stock = openingStock[id] + sum(qty of W rows for id)`. Status is derived from name, type and stock as today.

Compaction happens on the phone on the 1st of each month: rows that fall out of R1 and are not held by R2 to R4 are folded into `openingStock` and deleted from the local ledger store. The fold is exact because the phone had every row with Seq up to its cursor. A fresh device gets `openingStock` and W from the server's bootstrap response (one full ledger scan server side, cached 6 hours). A nightly `stockCheck` (server sends a hash of Items.Stock per shop; mismatch triggers a re-bootstrap) guards against drift.

### Size over a year

200 events/day x 2 shops = 72,000 rows/year on the server. The phone holds about 12,000 to 15,000 rows (window plus R2 to R4) at about 300 bytes each as JSON = under 5 MB, plus up to 12 MB of item thumbnails (400 x 30 KB) and queued media (a 10-second WAV at 16 kHz mono = 320 KB, kept until uploaded). IndexedDB quotas are gigabytes on both platforms. iPhone rule: the app must be added to the Home Screen; Safari evicts storage of a site not visited for seven days, while home-screen web apps are exempt. The install card (one laminated page) says this.

### In-memory model

At start the window is loaded into arrays identical to `world.items`, `world.ledger`, `world.customers` in `sim_ports.js`; the core sees exactly the same store methods; writes are write-through to IndexedDB. `ports.lock.run(fn)` is `fn()` (one JS thread). `ports.cache` is an in-memory map persisted to the `cache` store so a half-finished deposit flow survives an app restart (`st:`, `li:`, `cf:`, `tap:` keys keep their TTLs). `ports.uuid` is `crypto.randomUUID()` with `simUuid()` as fallback. `ports.clock.now` is `new Date()`. `ports.store.refreshViews` is absent on the phone, so `afterWrite` returns immediately (existing behaviour at `core_ledger.js:55`); the server runs it once per batch instead.

### The other shop

Staff devices see the other shop's Items (so transfer targets resolve and `otherShop()` works) but none of its ledger except transfer groups. `answerToday`, `openCredits`, `recentItems` already filter by `staff.shop` for staff and show both shops for owners; with the server filtering the pull by scope, an owner's phone converges to both shops' ledgers and a seller's phone to her own.

## 2. Identity and enrollment

- Telegram menu gains `📲 အက်ပ်` (`M|app`). The bot replies with a one-time link `https://<app_url>/#enroll=<enrollToken>` (32 random bytes base64url, 15-minute TTL, stored in CacheService and as a PENDING row in a new Devices tab bound to the staff's TelegramUserID, DefaultShop and Role). The link is tapped on the same phone, opening the PWA (or the install page first).
- The app posts `{api:'enroll', enrollToken, platform, name}`. The server mints a device token (32 random bytes), stores only its SHA-256 in Devices with Status ACTIVE, returns the plain token once, and returns the device's staff record, scope and the first receipt block. The app stores DeviceID and token in IndexedDB only.
- Every request carries `device` and `token` in the JSON body (never in the URL). The server hashes the token and matches the Devices row, checks Status, updates LastSeen, AppVersion and PendingCount.
- Revocation: owner command `/devices` in Telegram lists devices with `⏸ ပိတ်` (DRAIN) and `❌ ဖျက်` (REVOKE) buttons; or edit Status in the Devices tab. DRAIN keeps accepting pushes for `device_drain_hours` (24) but refuses pulls and AI, so a lost phone found again can empty its outbox; REVOKED rejects everything with `{error:'revoked'}` and the app wipes its IndexedDB on that reply. `/devices` also shows LastSeen and PendingCount, so the owner knows if a phone still holds unsynced sales.
- Why no Google sign-in on the family side: the web app runs as the maintainer with anonymous access, which cannot read the caller's Google identity; a Google login would need a Google account per seller, an English OAuth consent screen with an "unverified app" warning, scopes that let them edit the Sheet directly, and `Execute as: user accessing` would make every seller authorize the script. Identity already exists in Telegram, and the Staff allowlist already keys on TelegramUserID, so the bot vouches for the device once and a bearer token carries it from then on.
- Alternative path kept open: if the app is opened as a Telegram Mini App, `initData` can be verified server side with the bot token (HMAC) and enrollment needs no link. It is not the primary path because Telegram's in-app webview cannot be relied on for service workers and offline start.

## 3. Transport to Apps Script

- One web app URL, the existing `/exec`. `doPost(e)` routes on `e.parameter.api`: absent → Telegram branch exactly as today (secret check, HtmlService `ok()`); `api=enroll|sync|ai|photo|report|ping` → sync branch, JSON in, JSON out through `ContentService.createTextOutput(json).setMimeType(JSON)`. The two branches never share a code path after routing: the Telegram branch requires `token=WEBHOOK_SECRET`, the sync branch requires a valid device token in the body, and a body with `api` set is never parsed as a Telegram update. The sync branch must return ContentService (the body matters), the Telegram branch must keep HtmlService (the status matters, section 13.1).
- Request: `fetch(url + '?api=sync', {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(req)})`. `text/plain` makes it a CORS simple request, so no preflight (Apps Script does not answer OPTIONS). Apps Script replies 302 to `script.googleusercontent.com/macros/echo?...`; fetch follows it by default and the final response carries `Access-Control-Allow-Origin: *`. The redirect turns the POST into a GET of the echo URL, which is fine because the server has already processed the body. Consequence: the phone must reach `script.googleusercontent.com` as well as `script.google.com` — Phase 0 test T11, run on both shops' SIMs.
- Sizes and timing: no documented request body cap below megabytes, so batches are capped at 200 ledger rows (about 60 KB) and one AI job per request (a 10-second WAV base64 is about 430 KB; an item photo downscaled on the phone to 1024 px JPEG is 100 to 200 KB). Responses are paged at 500 ledger rows (about 150 KB) with `more:true`. Each execution must finish well inside the 6-minute limit; a sync with 200 rows and a 500-row page takes 2 to 6 seconds on Sheets. Timeouts on the phone: 60 seconds, then retry with backoff.
- Compression: optional, not in version 1. `Utilities.gzip` exists server side and `DecompressionStream` exists on Android Chrome and iOS 16.4+, but the deltas are small; add it only if the daily full master pull (60 KB) proves slow on 2G.
- Combined `sync` call: push and pull in one round trip, because each round trip on a flaky link costs seconds. `push` alone and `pull` alone also exist for the UI buttons "ပို့မယ်" and "ပြန်ယူမယ်".
- Rejected alternative, doGet JSONP: the device token would travel in the URL (browser history, logs), the 2 KB URL limit forbids pushes, and it has the same 302 to googleusercontent, so it buys nothing.

## 4. Push protocol

- Ids are the phone's: `newTx()` already calls `ports.uuid()` for TxID and defaults GroupID to the first TxID (`core_ledger.js:14-40`). The outbox is a list of entries in commit order: `{kind:'group', groupId, txs:[...]}`, `{kind:'item', id, fields, baseRev}`, `{kind:'customer', rec}`, `{kind:'notice', toStaffId, text, kb}`. The local store's `appendLedger` writes the row and appends the group to the outbox; `writeGroup` calls `appendLedger` once per row under `lock.run`, so the store collects the rows of one `lock.run` into one outbox group.
- Order inside the batch: customers, then items, then ledger groups in commit order, then notices. Within a group all rows are appended or none (one `LockService` critical section; the Sheet `appendRow` loop, as in `gasStore.appendLedger`, is replaced by one `setValues` for the whole group so a timeout cannot split a group).
- Idempotency: under the script lock the server reads the TxID column (one column, 72k cells at worst, about half a second; plus a CacheService set of the last 6 hours of TxIDs as a fast path) and skips any row whose TxID exists; a group whose rows all exist is answered `dup`. The client treats `ok` and `dup` identically (remove from outbox, mark rows synced).
- Server stamps: `Seq` (Script Property `LEDGER_SEQ` incremented under the lock), `ReceivedAt` (server ISO time), `DeviceID`. `Time` and `Day` stay as the phone wrote them: Yangon is UTC+6:30 with no DST and `dayKey()` applies the fixed offset, so the phone's wall clock decides the business day. If `clientTime` in the request differs from server time by more than `skew_warn_sec` (600), the response carries `clockSkewSec` and the app shows `⏰ ဖုန်း အချိန် မမှန်ပါ`; rows are still accepted (refusing them would strand sales), and the Errors tab gets a `clock_skew` row for the maintainer.
- Validation (reject the group, never the batch): device Status not ACTIVE/DRAIN; `tx.staffId` differs from the device's staff; `tx.shop` outside the device scope (owner scope is both shops); ItemID unknown after the batch's item creates were applied; `reversesTxId` already reversed on the server (`already_reversed`); PAYMENT that would push a group's owed below zero (`overpaid`; the server recomputes `saleGroupInfo`); amounts not integers or |amount| > 100,000,000; DEPOSIT_APPLIED exceeding held. Rejections return `{groupId, status:'rejected', reason}`; the client removes those rows from its local ledger (they never became truth), restores any undo button it had hidden, and shows a notice in the chat; the server logs `sync_reject` to Errors and pings the owner when money is involved.
- CostAtSale backfill: staff devices have no Cost, so their SALE rows arrive with `CostAtSale:''`; the server fills it from Items.Cost at receipt so the owner's profit stays right.
- After the batch: one `afterWrite(ports, allAcceptedTxs)` so Credits and Deposits refresh once; Items Status/Stock formulas recalc on their own; `MASTER_REV` bumps for item or customer changes; price-pending items that arrived with `Price:''` trigger the existing `notifyOwners` text through Telegram; queued notices are relayed with `gasChat.sendMessage`.
- Retries: the client retries a failed request with backoff 5 s, 15 s, 60 s, then every `sync_interval_sec`; a lost response is harmless because the same batch is idempotent. The outbox is only trimmed on a parsed server reply.

## 5. Pull protocol

- Ledger cursor: `Seq`, a monotonic integer the server writes on every append (also for rows appended by the Telegram route, so phones see Telegram-made sales). The row index is not used as cursor because a hand-inserted row or a sort would corrupt it; `Seq` survives both. Backfill at migration sets `Seq = row - 1` for existing rows.
- Master data cursor: `Rev` columns on Items and Customers, written by the server on every `updateItem`/`addCustomer` from a Script Property `MASTER_REV`, and by an installable `onEdit` trigger when the owner edits a cell by hand in the Sheet (the trigger bumps `MASTER_REV`, writes Rev and UpdatedAt on the edited row). Because `onEdit` can occasionally be missed, the first sync of each day asks for a full master pull (60 KB) and reconciles by id.
- Settings and Messages: pulled whole when the server's content hash differs from the client's (`settingsHash`, `messagesHash` in the request).
- Scope filter on the server: rows with `Shop` in the device's scope, plus rows whose GroupID has any row in scope (transfer groups). Owner scope is both shops.
- Paging: 500 rows per reply with `more:true` and `nextLedgerSeq`; the client loops until `more` is false before it marks the sync complete.
- Conflict rules: money never conflicts, it is append-only and corrections are reversing rows (the only cross-phone money race is a double undo or an over-payment, both rejected server side as in section 4). Master fields are last-writer-wins by server receipt order at field level: an item update carries only the changed fields and `baseRev`; if `baseRev` is below the row's current Rev and the same field changed meanwhile, the server still applies it (LWW) but logs `sync_conflict` to Errors and pings the owner with both values. `Items.Shop` changes only through TRANSFER groups and their undo, so the group ordering decides. Customer phone: LWW; customer identity is never merged silently (two phones creating "ဒေါ်မြင့်" offline produce two ids; the owner merges in the Sheet later; 13.2 already forbids silent merges).
- Price pending across devices: the designer's phone creates the item with `Price:''` and a RESTOCK row, offline; on sync the server pings the owner on Telegram (existing message `price_ask_owner` with `SP|` buttons, which still work through the Telegram route) and the owner's phone also pulls the item; whichever sets the price first wins, the Items Rev bumps, every phone pulls the new price on its next sync and the card stops saying "ask the owner". Until then the seller's card still offers `D|` (sell at a spoken price), which is allowed today.
- How two phones see each other: phone A pushes at t, phone B pulls at its next tick (default 180 s while the app is open, immediately after any local commit, and on the `online` event), so B is at most one interval behind. The chat UI marks rows it did not make itself with a small `☁️` prefix in the local history and updates cards on the screen (stock lines) after a pull.

## 6. What cannot run offline, and how it degrades

| Feature | Offline behaviour | When online |
| --- | --- | --- |
| Voice note | recorded with MediaRecorder, converted on the phone to 16 kHz mono WAV (Gemini's documented audio formats do not include webm); stored as a blob job with the AI context the core would have built (`buildAiContext`); chat shows `🎤 ⏳ ဆာဗာ စောင့်နေ` | `api=ai` uploads one job; server runs `gasAi.parseVoice` and returns the intent; the phone runs `handleIntent()` with the saved context, so the usual confirm proposal appears with `Y|`/`N|` buttons; the user confirms and the commit is local, then synced like any other |
| Photo on a blank tag | same queue; the item draft is created locally as `ပစ္စည်း S1-0042` with the local photo; price and cost are asked at once (the price step does not need the model) | server returns name/category/description and saves the photo to Drive; the item name is updated as a master change if the user has not renamed it |
| Photo of an existing item | saved locally and shown at once | uploaded, Drive URL filled in |
| Item thumbnails for other devices | not available until pulled | `api=photo` returns a 30 KB base64 thumbnail (Drive thumbnail fetched server side), cached in IndexedDB; avoids the phone fetching from lh3.googleusercontent.com directly |
| Reports as PDF | menu shows `🖨 အင်တာနက် လိုပါသည်`; today's totals are shown as text locally (`answerToday`) | `api=report` builds the PDF with `gasPdf.make` and sends it to the user's Telegram chat via `sendDocument` (existing path), the app says `📄 Telegram ထဲ ပို့ပြီးပါပြီ` |
| Receipt text | immediate, from local rows; shared with the phone's share sheet to Telegram or Viber | PDF variant as above |
| Receipt numbers | `receiptNumber()` today derives from ledger order (`core_ledger.js:490`), which breaks with a window and with two phones. New: the SALE row carries `ReceiptNo`, assigned on the phone from a per-device block (hi/lo): the server hands each device a block of `receipt_block_size` (50) numbers per shop at enroll and whenever fewer than 10 remain; numbers are unique per shop, never renumbered, voids leave gaps (13.2); interleaving between two phones only breaks strict time order, not uniqueness | `receiptNumber(ports, groupId)` returns the row's `receiptNo` when present and falls back to the old derivation for legacy rows; migration backfills legacy rows in ledger order so old receipts keep their numbers |
| Daily summary | unchanged, server trigger at 21:00 | gains one line when a device has not synced for more than 2 hours or has PendingCount > 0: `⏳ ဖုန်း မပို့ရသေး: ဆိုင် ၂ (၁၈:၄၀)`. Rows that arrive after 21:00 for that day are listed in the next morning's correction line `📊 ယမန်နေ့ ပြင်ဆင်ချက်` |
| Notebook import | online only (button disabled offline) | unchanged flow, lines come back as proposals |
| Owner pings (`notifyOwners`) | the phone's chat port treats `sendMessage(chatId != self)` as a notice in the outbox | server relays through Telegram |
| Gemini quota | the queue is a natural throttle: the server processes one job per request and returns `retryAfterSec` on a 429, the phone keeps the job queued and shows `⏳` | a daily count of AI jobs goes to the Errors tab weekly summary as today |

## 7. Apps Script quotas under this load

See the quotas field. Summary: 2 shops x 200 events/day arrive as roughly 150 pushes/day after batching; 4 phones polling every 3 minutes over 12 open hours add about 960 pulls/day; total about 1,100 to 1,400 executions/day of 1 to 5 seconds, no UrlFetch for sync itself. All well under the consumer limits; the one to watch is the script lock on appends, where the Telegram route and pushes serialize (fine at this scale), and the 30 simultaneous executions (4 phones plus Telegram cannot approach it).

## 8. Security

- The bundle contains no secrets: no bot token, no Gemini key, no webhook secret; the `/exec` URL is already public. The device token lives only in the installed app's IndexedDB on an HTTPS origin.
- A stolen, unlocked phone exposes: the local mirror (item names and prices, customers and phones, about two months of the shop's sales, deposits and credits) and the ability to post rows as that staff member until revoked. It does not expose Cost (stripped for staff), the other shop's sales, the Sheet, or Telegram beyond what the Telegram app itself exposes. Mitigations: `app_pin_required` setting enables a 4-digit PIN on app open (the PIN also derives a WebCrypto key that encrypts the device token at rest, so the token is unusable without the PIN); remote kill via `/devices` with DRAIN first to recover queued sales, then REVOKE; the app wipes itself on `revoked`; the Devices tab shows LastSeen so a silent phone is noticed.
- Server side: tokens stored as SHA-256 only; enroll tokens single-use and 15 minutes; all validation in section 4; every rejection logged; the Telegram route unchanged and still behind `WEBHOOK_SECRET`.

## 9. Sequence of a sale, end to end

1. Seller taps `📷` in the app, scans the hang tag (BarcodeDetector on Android, jsQR fallback on iPhone); the app parses `start=S1-0042` from the existing t.me QR, so tags are not reprinted. The app builds a Telegram-shaped `/start S1-0042` update (as `sim.start` does) and calls `processUpdate(update, localPorts)`. The card renders from the local Items row and local stock, in under 50 ms, offline.
2. Tap `ရောင်း ၂`: `handleCallback` → `commitSale` → `writeGroup` → `lock.run` → `store.appendLedger(tx)` writes the row to the in-memory ledger and IndexedDB, assigns `receiptNo` from the device block, and appends outbox entry `{kind:'group', groupId, txs:[tx]}`. `afterWrite` returns at once. The card is edited to `✅ ရောင်းပြီး ၂ ထည် · 36,000 · လက်ကျန် 3` with Undo, Receipt and Not-fully-paid, all local. The status bar shows `☁️ 1 မပို့ရသေး`.
3. Undo within 30 minutes appends mirror rows locally and a second outbox group; both groups will be pushed in order.
4. Signal returns (`online` event or the 3-minute tick). The sync loop posts `{api:'sync', device, token, clientTime, push:{batchId, entries:[...]}, pull:{ledgerSeq, masterRev, settingsHash, messagesHash}}`.
5. Server: verifies the token hash, Status ACTIVE, device scope; under the script lock reads the TxID column, drops duplicates, validates each group, stamps Seq/ReceivedAt/DeviceID, fills CostAtSale if blank, writes each group with one `setValues`, bumps `LEDGER_SEQ`; releases the lock; runs `afterWrite` once; relays notices; builds the pull delta for the device's scope from `Seq > ledgerSeq`, Items/Customers with `Rev > masterRev`, Settings/Messages if hashes differ, and a new receipt block if the device is low; updates Devices.LastSeen/PendingCount; returns JSON.
6. Phone: marks accepted groups synced and removes them from the outbox; removes rejected groups from its ledger and shows the notice; upserts pulled items/customers; appends pulled ledger rows it does not have (by TxID), skipping its own; advances the cursor; recomputes stock for the cards on screen; status bar `☁️ 0`.
7. 21:00: the server trigger posts the summary from the Sheet, which now includes the sale. Owner opens the Sheet from Korea: the row is there with Seq, ReceivedAt and DeviceID, Time as the shop's clock had it.

## 10. Core edits (small, backward compatible)

1. `receiptNumber(ports, groupId)`: prefer `row.receiptNo` when the SALE row has one; keep the old derivation as fallback. Add `ReceiptNo` to `CFG.LEDGER_COLS` (appended at the end with Seq, ReceivedAt, DeviceID) and to `newTx()` passthrough (`receiptNo: f.receiptNo || ''`) and `gasStore.appendLedger` mapping.
2. Customer ids: the store owns the format. Local store uses `'C-' + 8 hex from uuid`; `gasStore.addCustomer` accepts a client-supplied id when present (and keeps `C-000n` for Telegram-made customers). No change in the core.
3. `notifyOwners` stays; the phone's chat port implements `sendMessage(otherChatId)` as an outbox notice. No change in the core.
Everything else (window, opening stock, outbox) lives in the store implementation, which is the port boundary the core already respects.

## 11. Migration from Telegram-only, no data loss

1. Server first (one paste, one new version, `probeWebhookResponse` 200, `registerWebhook`): add the four Ledger columns, the Items/Customers Rev and UpdatedAt columns, the Devices and AiJobs tabs, the new Settings and Messages keys, the `onEdit` trigger (`installTriggers` gains it), the `api` routing, and the backfill function `backfillSync()` (Seq by row order, ReceiptNo by the old derivation, Rev = 1). The Telegram bot keeps working unchanged; nothing in the Sheet moves.
2. Maintainer enrolls his own phone from abroad against the production Sheet, runs a week of real traffic through both paths, compares `Seq` continuity and the Dashboard against a backup copy.
3. Shop 1: the computer-literate sister installs the PWA on the shop phone from the laminated card, taps `📲 အက်ပ်`, enrolls; Telegram stays on the same phone as the fallback. Tags are unchanged. After three days with an empty Errors tab and `PendingCount 0` at 21:00, shop 2 follows.
4. Rollback at any time: stop opening the app; the Devices tab shows whether anything is still unsynced; the bot in Telegram is the same code against the same Sheet.
5. Later, `summary_hour` and reports are untouched; the yearly Ledger archive (plan section 9) becomes the server-side analogue of the phone's compaction: archived rows keep their Seq, and bootstrap reads opening stock from the archive tab.

## 12. Phase 0 additions

- T11: from both shops' SIMs, load `https://script.google.com/macros/s/<id>/exec?api=ping` in the phone browser and confirm the JSON body renders (this proves the 302 to `script.googleusercontent.com` works), three times a day for three days.
- T12: install the PWA from the chosen host on one Android and one iPhone, add to Home Screen, enable airplane mode, open it, scan a printed tag with the in-app camera, record a 5-second voice note; everything must work offline and the note must upload when the signal returns.
- T13: measure the hosting origin (`<user>.github.io` or `<project>.web.app`) with the same OONI-style check; if both fail, host the shell on Firebase Hosting under a custom domain served by Cloudflare's free tier (cloudflare measurement needed too), the shell being the only thing that needs that origin.

---

# Data model

## New and changed tabs and columns (all additive; existing columns keep their positions)

Ledger (append 4 columns to CFG.LEDGER_COLS):
- Seq: integer, server-assigned under LockService from Script Property LEDGER_SEQ; monotonic; the pull cursor. Backfilled as row-1 for existing rows.
- ReceivedAt: ISO time at the server when the row was appended (Time stays the phone's business time).
- DeviceID: Devices.DeviceID that pushed the row; 'TG' for rows made through the Telegram route; 'SYS' for triggers.
- ReceiptNo: 'R1-000231' on SALE rows, assigned by the device from its receipt block; blank on other rows; backfilled from the old receiptNumber() derivation for existing SALE groups.

Items (append 3 columns): Rev (integer, from MASTER_REV, bumped by updateItem and by the installable onEdit trigger), UpdatedAt (ISO), UpdatedBy (StaffID or 'sheet' for hand edits). Status and Stock formulas unchanged; phones derive them locally and never receive them. Cost is stripped from pulls to role=staff devices.

Customers (append 2 columns): Rev, UpdatedAt. New CustomerIDs from phones are 'C-' + 8 hex (e.g. C-3f9a21c7); legacy 'C-0007' ids stay valid.

Devices (new tab): DeviceID (16 hex), TokenHash (SHA-256 hex of the bearer token), StaffID (TelegramUserID), Shop (S1|S2|BOTH), Role (staff|owner), Name (phone label), Platform (android|ios|desktop), Status (PENDING|ACTIVE|DRAIN|REVOKED), CreatedAt, LastSeen, AppVersion, LastPushSeq, LastPullSeq, PendingCount (as reported by the phone), ReceiptBlockFrom, ReceiptBlockTo, ReceiptShop, EnrollTokenHash (PENDING rows only), Note.

AiJobs (new tab, audit and idempotency): JobID (phone uuid), DeviceID, Kind (voice|photo|notebook), Status (done|failed|quota), ResultJSON (<= 2,000 chars), Error, CreatedAt (phone time), DoneAt (server), ItemID (photo jobs). Results also cached 6 h in CacheService under 'ai:'+JobID so a lost response does not re-spend Gemini.

Snapshots (optional tab, written by the monthly trigger): Month, AsOfSeq, ItemID, Stock. Lets bootstrap avoid a full ledger scan once the Ledger is archived yearly. Not needed for version 1 (bootstrap scans and caches 6 h).

Script Properties (new): LEDGER_SEQ, MASTER_REV, RECEIPT_NEXT_S1, RECEIPT_NEXT_S2 (all integers, updated only under LockService). Existing: BOT_TOKEN, GEMINI_KEY, GEMINI_MODEL, WEBHOOK_SECRET, WEBAPP_URL, GROUP_CHAT_ID, SHEET_ID, PHOTO_FOLDER_ID, BACKUP_FOLDER_ID, PROCESSED_UPDATES.

Settings keys (new, with defaults written by setupSheet): app_url ('' until hosted), sync_interval_sec (180), sync_window_months (2), receipt_block_size (50), receipt_block_refill_at (10), app_pin_required (FALSE), app_min_version (1), device_drain_hours (24), skew_warn_sec (600), pull_page_rows (500), push_max_rows (200), ai_max_seconds (12), thumb_px (320), stale_device_hours (2, for the 21:00 line).

Messages keys (new, Burmese drafts for the family to rewrite): app_offline ('📴 အင်တာနက် မရှိပါ · ဆက်လုပ်လို့ ရပါသည်'), app_unsynced ('☁️ {n} မပို့ရသေး'), app_synced ('☁️ ပို့ပြီး'), app_wait_server ('⏳ ဆာဗာ စောင့်နေ'), app_ai_result ('🎤 ကြားပြီးပါပြီ'), app_rejected ('⚠️ ဒီမှတ်တမ်းကို ဆာဗာ လက်မခံပါ: {reason}'), app_already_undone ('↩️ အခြားဖုန်းက ပြင်ထားပြီးပါပြီ'), app_clock ('⏰ ဖုန်း အချိန် မမှန်ပါ · ဆိုင်ရှင်ကို ပြောပါ'), app_revoked ('🔒 ဒီဖုန်းကို ပိတ်ထားပါသည်'), app_need_online ('🖨 အင်တာနက် လိုပါသည်'), app_report_sent ('📄 Telegram ထဲ ပို့ပြီးပါပြီ'), app_scan ('📷 Tag ကို scan လုပ်ပါ'), app_pin_ask ('🔢 PIN ရိုက်ပါ'), btn_app ('📲 အက်ပ်'), app_enroll_text ('📲 ဒီ link ကို ဒီဖုန်းမှာ နှိပ်ပါ (၁၅ မိနစ် အတွင်း): {url}'), summary_stale ('⏳ ဖုန်း မပို့ရသေး: {list}'), summary_late ('📊 ယမန်နေ့ ပြင်ဆင်ချက်: {list}'), devices_title ('📱 ဖုန်းများ'), btn_device_drain ('⏸ ပိတ်'), btn_device_revoke ('❌ ဖျက်').

Errors tab: unchanged columns; new Where values: sync_reject, sync_conflict, clock_skew, device_denied, ai_quota, enroll_expired.

Core constant changes: CFG.LEDGER_COLS += ['Seq','ReceivedAt','DeviceID','ReceiptNo']; CFG.ITEM_COLS += ['Rev','UpdatedAt','UpdatedBy']; CFG.CUSTOMER_COLS += ['Rev','UpdatedAt']; new CFG.DEVICE_COLS and CFG.AIJOB_COLS; newTx() passes receiptNo through; gasStore.appendLedger maps the four new fields; gasItemFromRow/listCustomers expose rev.

---

# Endpoints

All endpoints: POST to the existing /exec URL with ?api=<name>, body Content-Type text/plain;charset=utf-8 containing JSON. Every body except enroll and ping carries {device, token, appVersion, clientTime}. Responses are JSON via ContentService (302 to script.googleusercontent.com, followed by fetch). Errors: {ok:false, error:'auth'|'revoked'|'drain'|'bad_request'|'version'|'busy'|'server', message, retryAfterSec?}. Telegram keeps POST /exec?token=<WEBHOOK_SECRET> with no api parameter and still gets HtmlService 'ok'.

### api=ping (no auth)
Request: {} 
Response: {ok:true, serverTime:'2026-11-02T07:31:10.000Z', version:3}
Purpose: Phase 0 reachability test T11 and the app's online probe.

### api=enroll
Request: {"api":"enroll","enrollToken":"k3Jr...","platform":"android","name":"Shop 1 phone","appVersion":3}
Response: {"ok":true,"device":{"id":"a91c7f0e22d04b61","token":"<plain token, shown once>","staff":{"id":"1001","name":"Sister","shop":"S1","role":"staff"},"scope":["S1"],"owners":["1000"]},"receiptBlock":{"shop":"S1","from":232,"to":281},"bootstrap":true}
Errors: enroll_expired, enroll_used.

### api=sync (push then pull in one round trip)
Request:
{"api":"sync","device":"a91c7f0e22d04b61","token":"...","appVersion":3,"clientTime":"2026-11-02T14:05:02.000Z","pendingCount":2,
 "push":{"batchId":"b7e2...","entries":[
   {"kind":"customer","rec":{"id":"C-3f9a21c7","name":"ဒေါ်မြင့်","phone":"","note":"","createdAt":"2026-11-02T13:58:00.000Z"}},
   {"kind":"item","id":"S1-0042","fields":{"price":20000},"baseRev":17},
   {"kind":"group","groupId":"6f1c...","txs":[{"txId":"6f1c...","groupId":"6f1c...","time":"2026-11-02T14:01:11.000Z","day":"2026-11-02","shop":"S1","itemId":"S1-0002","type":"SALE","qty":-2,"unitPrice":18000,"amount":36000,"cash":36000,"costAtSale":"","customerId":"","refGroupId":"","note":"","source":"BUTTON","transcript":"","staffId":"1001","updateId":"","reversesTxId":"","receiptNo":"R1-000232"}]},
   {"kind":"notice","to":"1000","text":"🆕 S1-0042 ... စျေး သတ်မှတ်ပေးပါ","kb":[[{"text":"10,000","callback_data":"SP|S1-0042|10000"}]]}
 ]},
 "pull":{"ledgerSeq":48213,"masterRev":17,"settingsHash":"9c1a","messagesHash":"77e0","fullMasters":false}}
Response:
{"ok":true,"serverTime":"2026-11-02T14:05:04.000Z","clockSkewSec":2,
 "push":{"batchId":"b7e2...","results":[
   {"kind":"customer","id":"C-3f9a21c7","status":"ok"},
   {"kind":"item","id":"S1-0042","status":"ok","rev":19,"conflict":false},
   {"kind":"group","groupId":"6f1c...","status":"ok","seq":[48214]},
   {"kind":"notice","status":"ok"}]},
 "pull":{"ledger":[{"seq":48214,"txId":"6f1c...", "...":"same fields as pushed, plus receivedAt, deviceId"},{"seq":48215,"txId":"0d2b...","deviceId":"TG","type":"RESTOCK","...":"a row made in Telegram"}],
         "nextLedgerSeq":48215,"more":false,
         "items":[{"id":"S1-0042","shop":"S1","name":"...","category":"ထမီ","type":"UNIQUE","price":20000,"photoUrl":"...","photoFileId":"","createdAt":"...","createdBy":"1003","sample":true,"alias":"","rev":19}],
         "customers":[],"masterRev":19,
         "settings":null,"messages":null,
         "openingStock":null,
         "receiptBlock":null,
         "stockCheck":{"S1":"b41e","asOfSeq":48215}},
 "device":{"status":"ACTIVE","drainUntil":null}}
Group statuses: ok | dup | rejected with reason in {scope, staff, item_missing, already_reversed, overpaid, deposit_exceeds_held, bad_amount, status}. Item/customer statuses: ok | rejected | conflict (applied, logged).
Paging: when more:true the client repeats with pull only until more:false. fullMasters:true asks for every Items and Customers row (first sync of the day).

### api=bootstrap
Request: {"api":"bootstrap","device":"...","token":"...","appVersion":3,"clientTime":"..."}
Response: {"ok":true,"asOfSeq":48215,"openingStock":{"S1-0001":0,"S1-0002":5,"...":0},"ledger":[... rows in the window: last 2 calendar months in scope + open credit groups + their PAYMENT rows + all DEPOSIT/DEPOSIT_APPLIED rows + transfer groups touching the scope ...],"more":false,"items":[...all...],"customers":[...all...],"settings":{...},"messages":{...},"masterRev":19,"settingsHash":"9c1a","messagesHash":"77e0","staff":{...},"owners":["1000"],"receiptBlock":{"shop":"S1","from":282,"to":331}}
Paged like sync (500 rows per page, "cursorSeq" continuation). Used at enroll, after a stockCheck mismatch, and on 'reset local data'.

### api=ai (one job per request)
Request: {"api":"ai","device":"...","token":"...","appVersion":3,"clientTime":"...","job":{"id":"j-5a1e...","kind":"voice","mime":"audio/wav","data":"<base64, <= 1 MB>","ctx":{"shop":"S1","staff":"Sister","item":{"id":"S1-0002","name":"...","price":18000,"stock":3,"type":"SKU"},"awaiting":null,"categories":["ထမီ","..."],"state":null},"createdAt":"2026-11-02T13:40:00.000Z"}}
kind=photo adds "itemId":"S1-0042" and the server saves the photo to Drive; kind=notebook returns lines.
Response: {"ok":true,"job":{"id":"j-5a1e...","status":"done","intent":{"intent":"SALE","qty":2,"unit_price":null,"amount":null,"item_hint":null,"note":null,"transcript":"ဒါ ၂ ထည် ရောင်းရတယ်","confidence":0.93}}}
photo: {"ok":true,"job":{"id":"...","status":"done","desc":{"name":"...","category":"ထမီ","color":"...","description":"..."},"photoUrl":"https://drive.google.com/...","thumb":"<base64 jpeg 320px>"}}
quota: {"ok":true,"job":{"id":"...","status":"quota","retryAfterSec":600}}  failed: {"ok":true,"job":{"id":"...","status":"failed","error":"Gemini 503"}} (the phone shows ai_down and the button card, as today).
Idempotent on job.id (CacheService 6 h + AiJobs tab).

### api=photo
Request: {"api":"photo","device":"...","token":"...","appVersion":3,"clientTime":"...","itemIds":["S1-0002","S1-0005"]}
Response: {"ok":true,"thumbs":{"S1-0002":"<base64 jpeg>","S1-0005":null}}  (max 20 ids per call; server fetches Drive thumbnails with the script's own token so phones never touch googleusercontent image hosts)

### api=report
Request: {"api":"report","device":"...","token":"...","appVersion":3,"clientTime":"...","kind":"month","groupId":null}
kind in {today, month, last, stock, owed, receipt}; receipt needs groupId.
Response: {"ok":true,"sentTo":"telegram","messageId":4412}  (server builds with buildReport/gasPdf.make and sendDocument to the staff's Telegram chat; optional "inline":true returns {"pdf":"<base64>","fileName":"monthly-2026-10.pdf"} for the Web Share API when the file is under 500 KB)

### api=devices (owner devices only)
Request: {"api":"devices","device":"...","token":"...","appVersion":3,"clientTime":"...","action":"list"|"drain"|"revoke","target":"<DeviceID>"}
Response: {"ok":true,"devices":[{"id":"...","name":"Shop 1 phone","staff":"Sister","shop":"S1","status":"ACTIVE","lastSeen":"...","pendingCount":0,"appVersion":3}]}
The same actions exist as Telegram /devices with inline buttons.

### Telegram additions (same doPost, Telegram branch)
- Menu button 'M|app': replies with app_enroll_text and the one-time link; creates the PENDING Devices row.
- '/devices' (owners): device list with ⏸ and ❌ buttons (callback 'DV|<id>|drain' / 'DV|<id>|revoke').
- 'SP|' price buttons keep working for owner pings relayed from phones.

### doPost routing sketch (gas_main.js)
function doPost(e) {
  var api = e.parameter && e.parameter.api;
  if (api) return gasSyncHandle(api, e);          // JSON via ContentService; validates device token inside
  ... existing Telegram branch unchanged (WEBHOOK_SECRET check, processUpdate, return ok()) ...
}
gasSyncHandle wraps everything in try/catch and always returns JSON; the Telegram branch always returns HtmlService 200.

---

# Local store contract

The phone implements the same `ports` object the core already documents at the top of core_bot.js. Only the store and chat change meaning; signatures are identical to poc/sim_ports.js.

ports.store (app_store.js, IndexedDB-backed, in-memory arrays loaded at start):
- getItem(id) -> {id, shop, name, category, type, price, cost ('' on staff devices), photoUrl, photoFileId, status, stock, createdAt, createdBy, sample, alias, rev} | null. stock = openingStock[id] + sum(qty of local ledger rows for id); status derived as sim_ports.viewItem.
- listItems(shop|null) -> same shape, both shops mirrored.
- updateItem(id, fields): applies locally, bumps a local pendingRev, appends outbox {kind:'item', id, fields, baseRev}. Used by core for new items, price, photo, transfer shop.
- appendLedger(tx): writes tx to the ledger store with synced:false and seq:null; assigns tx.receiptNo from the device's block when tx.type==='SALE' and !tx.reversesTxId; collects rows written inside the current lock.run into one outbox {kind:'group'} entry (writeGroup calls appendLedger per row inside one lock.run; lock.run opens/closes the collector).
- ledgerRows() -> the window array (R1..R4 of section 1) in Seq order for synced rows followed by local unsynced rows in commit order. Returns the same array reference until a write, so the per-execution memo pattern of gas_store is unnecessary.
- getStaff(uid): returns the device's own staff record for its own id; null otherwise. listStaff(): [self] plus owner stubs {id, name:'owner', shop:'S1', role:'owner'} from bootstrap, so notifyOwners addresses them.
- getCustomer(id), listCustomers(), addCustomer(c) -> {id:'C-'+8hex, name, phone, note, createdAt} and outbox {kind:'customer', rec}.
- getSetting(key, def), getMessage(key): from the mirrored maps.
- logError(where, err, updateId, payload): local 'errors' store, forwarded to the server as a notice-less error entry in the next push (server writes it to Errors with DeviceID).
- logUnknownUser: never called on the phone (the device is always a known staff), kept as a no-op.
- refreshViews: intentionally absent (afterWrite returns early; the server refreshes Credits/Deposits once per batch).
Extra methods used only by app_sync.js, not by the core: applyPull(delta), applyBootstrap(b), outbox.peek(maxRows)/ack(results), setReceiptBlock(block), fold(asOfSeq), stats() for the status bar, wipe().

ports.chat (app_ports.js): sendMessage/sendPhoto/sendDocument/editMessage/answerCallback/typing render into the local chat history store (same as sim_ports.pushMsg) when chatId is the device's own staff id; for any other chatId they append outbox {kind:'notice', to, text, kb} which the server relays through Telegram. getFile(fileId) returns the queued blob handle; savePhoto(fileId, name) stores the blob under the item id and returns 'local://'+id until the server returns the Drive URL.

ports.ai (app_ports.js): parseVoice/parseText/describePhoto/readNotebook throw a special OfflineAiPending error after enqueuing a job {id, kind, blob|text, ctx:buildAiContext(...)}; core_bot's catch logs it and falls back to buttons (existing behaviour at core_bot.js:326-329), and the UI shows ⏳ instead of ai_down for this error class. When the job result arrives, app_sync.js calls handleIntent(intent, syntheticMsg, staff, updateId, ports, source, ctx) with the stored ctx, exactly as handleVoice would have. parseText for the plain-text path works the same way; number-only texts never reach AI (parseNumberText handles them locally as today).

ports.pdf: make(report) returns {name, report} for an on-screen table (as the simulator does); real PDFs come from api=report on the server.

ports.cache: in-memory map persisted to the 'cache' store with expiry; same get/put/remove semantics; TTL honoured against ports.clock.
ports.lock: run(fn) opens the outbox group collector, runs fn, closes it (single-threaded JS; no waiting).
ports.clock: now() -> new Date(). ports.uuid: crypto.randomUUID() or simUuid(). ports.dedupe: seen/remember over local synthetic update ids (monotonic counter per device), kept so processUpdate is called unchanged.

IndexedDB stores (database 'salestag', version 1): meta (device, token (encrypted when PIN on), staff, scope, cursor {ledgerSeq, masterRev, settingsHash, messagesHash}, openingStock, asOfSeq, receiptBlock, lastFullMasters, appVersion), items (key id), customers (key id), settings (key), messages (key), ledger (key txId; indexes seq, groupId, itemId, day, synced), outbox (key localSeq autoincrement), media (key jobId; blob + ctx + status), chat (key msgId; the local history, capped at 500 messages), cache (key; value + exp), errors (key autoincrement), thumbs (key itemId; blob).

Synthetic Telegram updates: the UI builds the same update objects sim_ports.world.sim builds (start, text, voice, photo, tap) with from.id = staff.id and chat.id = staff.id, so core_bot.js needs no new entry point.

---

# Failure matrix

| Failure | Phone behaviour | Server behaviour | End state |
| --- | --- | --- | --- |
| No signal for hours or days | every button answers locally; status bar shows ☁️ n unsynced; outbox grows; voice/photo jobs queue with ⏳ | nothing; 21:00 summary lists the stale device | all rows arrive in commit order on the next sync with the phone's Time and Day; summary correction line next morning |
| Request sent, response lost | retries the same batchId after backoff | TxIDs already exist → every group answers dup | exactly one copy of each row (idempotent append) |
| Server 5xx or 6-minute timeout mid batch | treats as lost response, retries | groups are written one setValues each under the lock, so a group is all-or-nothing; later groups retried | no half groups; order preserved |
| Two phones sell the last UNIQUE piece offline | both show sold; both push | append-only: both SALE rows accepted; Items.Stock becomes -1; owner pinged 'stock negative' with Undo buttons | the owner undoes one via Telegram or the Sheet; both phones pull the reversal |
| Two phones undo the same group offline | both show undone | second group rejected already_reversed | second phone drops its local mirror rows and shows app_already_undone; stock correct |
| Two phones take a payment on the same credit | both show paid | second rejected overpaid (server recomputes owed) | second phone drops its rows and shows notice; owner pinged |
| Owner and sister change a price offline | each sees her own | LWW by receipt order; sync_conflict logged; owner pinged with both values | all phones converge on the last writer after the next pull |
| Item created on a phone, sale on another before pull | second phone cannot scan it yet (tag unknown locally) → tag_not_found; after pull it works | items are applied before groups within a batch, so the creator's own sale never fails | eventual |
| Phone clock wrong | rows carry the phone's time; app shows app_clock warning | accepts rows; logs clock_skew; summary uses Day as written | maintainer fixes the phone clock; rows are not rewritten |
| Phone clock set to the future by a day | sale lands in tomorrow's Day | same as above; appears in the summary the next day | owner adjusts via reversing row if needed |
| Device DRAIN | pushes still accepted; pulls refused; app shows read-only banner | accepts pushes for device_drain_hours | queued sales recovered, then REVOKE |
| Device REVOKED | first reply with error revoked → wipe IndexedDB, show app_revoked | rejects all; logs device_denied | stolen phone useless after next contact |
| Enroll link opened late or twice | enroll_expired / enroll_used | PENDING row expires 15 min; token single-use | owner taps 📲 again |
| Gemini quota or 503 | job stays queued (quota) or shows ai_down and the button card (failed) | returns status quota with retryAfterSec, or failed; AiJobs row | buttons never depend on AI (plan section 1) |
| Voice job response lost | re-sends same job.id | cache/AiJobs return the stored result; Gemini not re-billed | one proposal |
| Service worker update while offline | old shell keeps running; update applied on next online launch | api responds version:'too old' only below app_min_version | no stranded phone |
| App storage evicted (iPhone not on home screen, cleared data) | app reopens with no device token → enroll again; unsynced outbox lost (shown on install card as the reason to always install to Home Screen and sync before clearing) | Devices row shows last PendingCount so the loss is known | re-bootstrap from the Sheet, nothing on the server is lost |
| Hand edit in the Sheet (owner fixes a price) | pulls it after onEdit bumps Rev; daily fullMasters catches a missed trigger | onEdit writes Rev/UpdatedAt | converges within a day at worst, usually within one sync |
| Hand-inserted or deleted Ledger row | nothing (Seq cursor, not row index) | backfillSync detects missing Seq and stamps it; protection is set strict for Ledger except the owner account | cursor stays valid |
| script.googleusercontent.com blocked (302 target) | all data calls fail; buttons still work; outbox grows | — | fallback transport needed (Firebase REST) — must be measured in Phase 0 T11 before build |
| Hosting origin blocked | installed phones unaffected; new installs and updates blocked | — | move the shell to another host; data path unchanged |
| LockService wait timeout (15 s) under load | request fails → retry | returns busy with retryAfterSec | serialized, no corruption |
| Outbox corrupted/unparseable entry | entry quarantined to a local 'failed' list and reported in the next sync as a notice | Errors row | maintainer inspects; other entries flow |

---

# Quotas

Assumptions: 2 shops x 200 events/day, 4 phones (2 shared shop phones + owner + designer), app open 12 h/day, poll every 3 min (sync_interval_sec 180) plus an immediate sync after each local commit coalesced to at most one per 20 s, 60 voice/photo jobs/day, Telegram fallback traffic as today.

| Quota (consumer Google account) | Limit | Expected daily use | Headroom and notes |
| --- | --- | --- | --- |
| Web app executions (doPost) | no fixed daily cap documented; bounded by simultaneous executions and runtime | about 150 pushes (400 rows coalesced), about 960 polls (4 phones x 240 ticks), 60 ai, 20 report/photo, Telegram webhook about 100 → about 1,300 executions | fine; each 1 to 5 s |
| Simultaneous executions | 30 | peak 3 to 5 (4 phones + Telegram + a trigger) | 6x headroom |
| Script runtime per execution | 6 min | sync 2 to 6 s (TxID column read 0.3 to 0.8 s, group setValues 0.3 s each, delta page 0.5 to 1.5 s); bootstrap 5 to 20 s (full ledger read, cached 6 h); ai 3 to 12 s | keep push_max_rows 200 and pull_page_rows 500 |
| Trigger total runtime | 90 min/day | daily summary, monthly PDF, weekly backup, onEdit (hand edits only): under 3 min/day | unchanged |
| UrlFetch calls | 20,000/day | sync uses none; Telegram sends about 300 (notices, pings, PDFs, fallback bot use); Gemini about 60 jobs x 1 call; photo saves and Drive thumbnails about 100 | about 500/day, 2.5 percent |
| UrlFetch payload / response | 50 MB each | largest is a 1 MB audio to Gemini | fine |
| doPost request body | undocumented, practical several MB | max about 1.1 MB (one AI job) | fine |
| ContentService response | undocumented, practical several MB | max about 150 KB (500-row page) or 600 KB (20 thumbnails) | fine on 2G: 150 KB at 50 kbps is 25 s; that is why pages are 500 rows and polls usually return under 2 KB |
| Properties | 9 KB per value, 500 KB per store | LEDGER_SEQ, MASTER_REV, RECEIPT_NEXT_* are a few bytes; PROCESSED_UPDATES already about 4 KB | fine; never store device tokens or lists in Properties, those live in the Devices tab |
| CacheService | 100 KB per value, 6 h max TTL | recent TxID set (6 h of rows, about 400 ids x 36 bytes = 15 KB, chunked by hour), enroll tokens, ai results (<= 2 KB each), bootstrap cache per scope (chunked 90 KB values) | fine; everything in cache has a durable fallback (TxID column, Devices tab, AiJobs tab) |
| LockService wait | 15 s configured in buildPorts | appends serialized: 150 pushes + 100 Telegram writes/day, each holding the lock under 2 s | contention negligible; the client retries on busy |
| Spreadsheet cells | 10 million | Ledger 72k rows x 24 cols = 1.7 M cells/year; Items 400 x 18; others small | archive the Ledger yearly from year 3 (plan section 9); Seq continues across archive tabs |
| Sheets read cost | getValues of the TxID column: 72k cells about 0.5 s; delta read of up to 500 rows x 24 cols: under 1 s; full Ledger read for bootstrap: 1.7 M cells about 10 to 20 s | bootstrap is rare (enroll, stockCheck mismatch) and cached 6 h | acceptable |
| Gemini free tier (2.5 Flash-Lite) | per AI Studio, on the order of 1,000 requests/day and 15 per minute as of 2025; check the console | 60 jobs/day | the queue throttles; retryAfterSec on 429; paid tier recommended as in plan section 9 |
| Telegram Bot API | about 30 messages/s overall, 1/s per chat | notices and pings tens per day | unchanged |
| Drive storage | 15 GB shared | photos 400 x 200 KB = 80 MB/year, PDFs transient | fine |
| Phone storage (IndexedDB) | GBs on Android; iPhone home-screen app exempt from the 7-day eviction | about 5 MB ledger window, 12 MB thumbnails, up to 10 MB queued media | fine |

Daily totals at 2 shops x 200 events: about 1,300 executions, about 75 minutes of total execution time (not a quota for web apps), about 500 UrlFetch calls, about 6,000 new Ledger rows per month. Doubling the shops or halving the poll interval stays inside every limit above.

---

# Risks

1. script.googleusercontent.com reachability (the 302 target for every ContentService body) has not been measured from Myanmar; only script.google.com has. If blocked, the whole data path needs another transport (Firebase Realtime Database REST on firebaseio.com, or Firestore on firestore.googleapis.com, both unmeasured). Run T11 before writing gas_sync.js.
2. Hosting origin for the PWA shell (github.io or web.app) unmeasured; github.com showed 8 percent anomalies. The shell is only needed at install and update time, so a blocked host hurts onboarding, not daily use.
3. iPhone constraints: storage eviction unless installed to the Home Screen; MediaRecorder output is mp4/aac (handled by WAV conversion); BarcodeDetector absent (jsQR fallback); getUserMedia inside home-screen apps has had regressions in some iOS versions. T12 on the family's actual iPhone model.
4. Shared shop phones were planned (12.6). If several sellers use several phones per shop, receipt numbers interleave in time order (still unique) and master conflicts become more frequent; both are handled, but the owner should know receipts are unique, not strictly chronological.
5. Apps Script onEdit triggers can be missed or delayed, and they do not fire for script edits (handled) nor for edits by other scripts; the daily fullMasters pull is the safety net, so a hand-edited price can take up to a day to reach a phone in the worst case.
6. The TxID-column scan for idempotency grows with the Ledger; at 72k rows it is under a second, at 300k rows it needs the yearly archive or a TxID index tab. Plan the archive from year 2.
7. Gemini audio formats: WAV upload is 320 KB per 10 s; on 2G this is slow but queued. If uploads prove too slow, add lamejs MP3 encoding (about 80 KB per 10 s) later.
8. Burmese UI in a browser: Zawgyi phones render Unicode wrongly (plan T3); the PWA bundles Noto Sans Myanmar as a cached web font so rendering does not depend on the phone's font.
9. Rejected groups are removed from the phone's local ledger (section 4). This is the only place local rows disappear; it must be shown clearly and logged, or a seller may believe a sale is recorded when the server refused it. Rejections are rare by construction (only races and staff/shop mismatches).
10. The maintainer pastes code by hand; the project now has three deploy targets (Code.gs paste, PWA build upload, Sheet backfill). The deploy guide must add a checklist, and app_min_version prevents an old shell talking to a new API.
11. Compaction correctness on the phone depends on folding by Seq, not Day; late-arriving old rows must be handled as section 1 describes, and the nightly stockCheck hash is the detector if the fold ever drifts.
12. Unknowns to confirm on a live account (unchanged from the plan): Burmese glyphs in the Sheets PDF export; sendDocument from Apps Script.

---

# Tests

Add to C:\Users\USER\Desktop\Noel\poc\run_scenario.js (keep the existing 113 checks green) and create C:\Users\USER\Desktop\Noel\poc\sim_sync.js:

sim_sync.js provides:
- createFakeServer(world): wraps the same in-memory sheet (world.items/ledger/customers/settings/messages) with the server-side functions from core_sync.js (applyPush, buildPull, buildBootstrap, enroll, devices, receipt blocks, Seq/Rev stamping, validation) and a fake AI (sim_mock_ai). Exposes handle(api, body) returning the JSON the real gas_sync.js would, plus flags: server.down (throws), server.dropResponse (processes but returns nothing), server.latencyMs.
- createPhone(server, opts): a device with app_store.js + app_ports.js + app_sync.js over an in-memory IndexedDB shim (or fake-indexeddb), its own clock offset, its own online flag, and the same sim helpers (start, tap, tapLast, voice, photo, text, lastBot) so tests read like the existing ones.

Scenarios (each with explicit checks):
S1 Offline sale then sync: phone A (S1) offline sells 2 of S1-0002 → local stock 3, server stock 5, outbox 1; online → sync → server has the row with the same TxID, Seq assigned, DeviceID = A; A outbox 0; second sync → no new rows (dup path).
S2 Lost response: server.dropResponse for one call → A retries same batchId → exactly one row on the server; A marks synced.
S3 Server down mid-day: server.down for 3 ticks → A keeps selling (5 groups) → server up → all 5 arrive in commit order; Seq strictly increasing in that order.
S4 Two phones same shop sell the last UNIQUE piece offline → both pushed; server stock -1; owner notice relayed; owner undoes one via Telegram route (processUpdate on world.ports) → both phones pull the reversal; stock 0 on both and on the server.
S5 Double undo race: A and B undo the same group offline → first accepted, second rejected already_reversed; B's local mirror rows removed; B chat shows app_already_undone; stock equal on A, B and server.
S6 Over-payment race: 500,000 owed; A and B each take 500,000 offline → second rejected overpaid; owed 0; B notice; Credits view consistent.
S7 Master LWW: owner phone sets price 20,000 offline; sister sets 22,000 offline; owner syncs first, then sister → server 22,000, Rev bumped twice, Errors has sync_conflict, both phones show 22,000 after pull.
S8 Price pending across devices: designer phone registers a blank tag offline (photo queued, price pending, RESTOCK +1) → sync → owner Telegram chat has price_ask_owner with SP buttons (notice relay) → owner taps SP|…|25000 in Telegram → designer and seller phones pull price 25,000 and card no longer says pending.
S9 Receipt blocks: A and B in S1 get disjoint blocks (232–281, 282–331); 60 sales on A trigger a refill; all ReceiptNo unique per shop; a voided sale leaves its number unused; receiptNumber(ports, groupId) on both phones and on the server returns the row's ReceiptNo; legacy rows without ReceiptNo still derive the old way.
S10 Voice offline: A offline records 'ဒါ ၂ ထည် ရောင်းရတယ်' after scanning S1-0002 → chat shows app_wait_server, no ledger row; online → api=ai with stored ctx → proposal appears with 36,000 → tap မှန်တယ် → local commit → synced; AI result cached so a repeated job id does not call the mock AI twice.
S11 Delta paging: seed the server with 1,200 rows in S1 and 300 in S2; A (S1 staff) bootstraps → receives only S1 rows plus transfer groups, in 3 pages; cursor advances; a 1,201st row appears only after the next sync; no duplicates by TxID.
S12 Scope and transfer: a TRANSFER group S1→S2 is pulled by both shops' phones; S2 staff phone never sees plain S1 SALE rows; owner phone sees everything.
S13 Bootstrap and opening stock: server with 3 months of rows (old sales, an old open credit, old deposits) → new phone bootstraps with the 2-month window → for every item phone stock === server SUM(qty); openCredits and depositsHeldList identical to the server's; the old open credit's PAYMENT rows present even though older than the window.
S14 Monthly fold: advance clock to the 1st → phone folds rows older than the window into openingStock → stock, openCredits, deposits unchanged; a late row with an old Day arriving after the fold still adds to stock exactly once (checked against server).
S15 Revocation: owner lists devices; sets B to DRAIN → B's push with 2 queued groups accepted, pull refused; set REVOKED → B's next call returns revoked and B's local store is wiped (meta empty); server rows intact.
S16 Clock skew: B clock +40 min → rows accepted with B's Time and Day; response carries clockSkewSec > 600; Errors has clock_skew; B chat shows app_clock.
S17 Customers created offline on two phones with the same name → two distinct ids, both pushed, no merge; recentCustomers on both phones lists both after pull.
S18 Shared doPost routing (Node-level using the fake handler shape): a Telegram update with the right token goes to processUpdate; the same body with api=sync and a bad token returns {ok:false,error:'auth'} and writes nothing; a Telegram update without the token writes nothing and returns ok.
S19 Daily summary stale line: B has not synced for 3 hours with PendingCount 2 → buildDailySummary includes summary_stale with the shop name and time; after B syncs the next summary omits it.
S20 CostAtSale backfill: staff phone (no Cost locally) sells → row arrives with costAtSale '' → server fills 9,000 from Items → monthStats on the server shows cogs 9,000 x qty and unknownCostPieces 0.
S21 Rejected group hygiene: force a scope mismatch (B pushes an S1 row from an S2-only device) → rejected scope; B's ledger no longer has the row; B chat shows app_rejected; Errors has sync_reject; stock on B equals server.
S22 Idempotent item create: the same {kind:'item'} entry pushed twice (lost response) → one Rev bump, fields unchanged on second apply.

Also add to tools: a Node check that the PWA bundle contains none of BOT_TOKEN, GEMINI_KEY, WEBHOOK_SECRET strings or any 'AIza' / numeric:AA token patterns, run as part of the build.

---

# Estimate

About 20 working days end to end for one maintainer, range 18 to 24:
- Server: core_sync.js (platform-free push/pull/bootstrap/validation/receipt blocks/device status) + gas_sync.js (Devices and AiJobs tabs, Seq and Rev stamping, onEdit trigger, doPost routing, ai/photo/report/devices endpoints, notice relay, backfillSync, /devices and 📲 in Telegram): 4 days
- Phone store and ports: app_store.js (IndexedDB mirror, window + openingStock + monthly fold, outbox, media queue, persisted cache) + app_ports.js (chat adapter from sim_ui, notice relay, lock/uuid/clock) + app_sync.js (online detection, backoff, paging, enroll, revoke wipe, AI job upload and handleIntent replay): 5 days
- PWA shell: manifest, service worker (shell cache, versioned update prompt), build script from build_simulator.js, Burmese chat UI trimmed from sim_ui, in-app QR scan (BarcodeDetector + jsQR), WAV recorder, photo downscale, PIN gate, install cards for Android and iPhone: 4 days
- Core edits (ReceiptNo column and receiptNumber fallback, newTx passthrough, column constants, gasStore mapping, client-supplied customer ids): 1 day
- Tests: poc/sim_sync.js (fake server over the same in-memory sheet, two phones, network flags) and the 16 scenarios added to poc/run_scenario.js, plus keeping the existing 113 checks green: 2 days
- Migration and docs: backfill run, setupSheet additions, deploy guide section, user guide pages, Phase 0 tests T11 to T13 with the family: 2 days
- Pilot buffer (shop 1 week one): 2 days
Not included: hosting decision if GitHub Pages and Firebase Hosting both measure badly from Myanmar (add 2 days for a custom domain on Cloudflare), and the design-round-2 features (13.2 to 13.4), which ride on the same sync once built because they are ledger groups and master rows.
