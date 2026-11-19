# SalesTagBot offline-first app: the reconciled specification

Version 1, 2026-11-02. This is the binding design for the real fix to slow internet in the shops. It merges three design notes and applies every fix from the critic's review (see critique.md). Where the raw notes in this folder disagree with this file, this file wins.

## 0. The decision in one paragraph

A tap in a chat bot cannot answer until the message has travelled phone, Telegram, Google, Telegram, phone. On a weak signal that is many seconds, and no server tuning removes the round trip. The fix is to run the bot's brain on the phone. The same `core_*.js` that runs in Apps Script today (and already runs in a browser in the simulator) runs inside an installable web app against a local copy of the shop's data, so every button answers in milliseconds with no network. Every row the core writes is queued and sent to the Google Sheet whenever there is a signal, even hours later. The Sheet stays the single source of truth. Telegram stays for the 21:00 summary, owner pings, PDFs, forwarding receipts, the voice path during the pilot, and as the fallback. Nothing about the Sheet, the tags or the ledger rules changes.

## 1. What runs where

| Part | Runs on | Needs network | Notes |
| --- | --- | --- | --- |
| Conversation, ledger, reports as tables | the phone (`core_*.js` unchanged plus small additive edits) | no | identical Burmese cards and buttons to Telegram |
| Local data | the phone, IndexedDB | no | Items, Customers, Settings, Messages, both shops' active-year Ledger |
| Sync | the phone to Apps Script `/exec?api=...` | yes, in the background | push the outbox, pull by sequence number, one round trip |
| Voice and photo understanding | Apps Script calling Gemini | yes, queued | results come back as the usual confirm proposal |
| PDFs | Apps Script | yes | sent to Telegram, or returned to the app for the share sheet |
| 21:00 summary, monthly PDF, owner pings | Apps Script triggers, Telegram | server side | unchanged, plus a stale-phone line |
| App shell hosting | Firebase Hosting (free Spark plan) | only at install and update | measured from both shops before build; Cloudflare Pages as the standby |

## 2. Phone app (PWA)

- Installable web app, one HTML bundle built like the simulator: `core_*.js` unchanged, plus `app_store.js` (IndexedDB mirror), `app_ports.js`, `app_sync.js`, `app_ui.js` (the simulator's phone renderer), `app_scan.js`, `app_media.js`, `sw.js`, `manifest.webmanifest`, self-hosted Noto Sans Myanmar and jsQR. No framework, no external scripts, nothing loaded from a third-party CDN.
- Android first (Chrome, Add to Home Screen). iPhone after its own Phase 0 tests pass (Safari-only install, separate storage for home-screen apps, camera and microphone quirks).
- Home screen is the scanner: the camera opens on launch with Recent and Find below, so a sale is icon, scan, tap. The latest bot card is shown large with 56 px buttons; the chat history sits behind a handle. Bottom bar: 📷, 🎤 (enabled after the voice test), ☰ menu. A sync chip in the header: ✓ synced, ⏳ n waiting, ⚠️ not sent for 2 days.
- The ✅ confirmation is shown only after the IndexedDB transaction completes (tens of milliseconds), and the outbox entry is written in that same transaction, so a killed tab never loses a sale the seller believes is recorded.
- Stock is kept as an incremental map in the store, updated on every append and on applied pulls, so a 2 GB Android phone stays instant with a year of rows.
- Shell updates apply silently on the next cold start when the outbox is empty and no multi-step flow is open; never mid-sale. No banner to tap.
- PIN gate off by default. Protection is remote: revoke wipes the phone on its next contact.
- Tags are unchanged: the app parses the item id out of the existing `t.me/...?start=S1-0042` QR, and a typed 4-digit keypad is the fallback.

## 3. Local data

- Mirrored: Items (both shops, including Cost), Customers, Settings, Messages, Staff (self plus owner ids), and the Ledger for the current year for both shops, plus carried-forward opening rows after the yearly archive. No sliding windows and no monthly folds in version 1; realistic volume is 10 to 20 thousand rows a year, under 5 MB.
- Both shops' ledgers on every phone, so a customer who owes in shop 1 can pay in shop 2. The UI still filters by the staff member's shop as today; owners see both.
- Bootstrap of a new phone: compact array format, gzip where available, 500 rows a page, a progress bar. A 3 to 5 MB first load must survive a 2G link.

## 4. Identity and enrollment

- Devices tab: DeviceID, TokenHash (SHA-256), StaffID, Shop, Role, Label, Platform, Status (PENDING, ACTIVE, DRAIN, REVOKED), CreatedAt, LastSeen, AppVersion, PendingCount, ReceiptLetter, Note.
- Enrollment by a typed one-time code, because iPhone home-screen apps keep separate storage from Safari and never receive a tapped link: the bot's menu gains 📲 အက်ပ်; it replies with an 8-character code bound to the staff member's Telegram id, valid 15 minutes, 5 attempts. The card says: install first, open from the icon, type the code. On Android the link form is offered too, as a convenience.
- The app exchanges the code for a device token (32 random bytes) that only ever travels in the JSON body, never in a URL, and is stored on the server as a hash. Every request carries device id and token. No Google sign-in on the family side, no shared secret in the bundle.
- Owner command `/devices` in Telegram (and the same screen in the owner's app): list, DRAIN (accept pushes, refuse pulls, so a found phone can empty its outbox), REVOKE (reject everything; the app wipes itself on that reply).
- One selling phone per shop plus the owner's phone in version 1. A second phone per shop comes after the pilot; the design supports it, but it is the only source of same-shop races and is not needed to prove the fix.
- Once a Telegram id is enrolled, the Telegram bot no longer sells for it: a tag scanned through the camera app answers with the item and one button "sell in the app". Per shop, all or nothing. Un-enrolled users (owner, designer, shop 2 during the pilot) see the bot unchanged.

## 5. Transport

- Transport A: `fetch` POST to the existing `/exec` with `?api=sync|enroll|ai|photo|report|devices|ping`, body `text/plain` JSON (no CORS preflight), following the 302 to `script.googleusercontent.com`. The Telegram webhook branch is untouched and still answers through HtmlService. The sync branch answers JSON through ContentService.
- Phase 0 gate: `script.googleusercontent.com` and the hosting origin must be measured from both shops' SIMs for three days, with a real browser POST, before any sync code is written.
- Transport B, designed in, not an afterthought: the app exports its outbox as a `.json` document shared to the bot in Telegram (a document, not a text message, because a day's outbox exceeds Telegram's text limit). The server's document handler runs the same `applyPush`. Offered automatically after 4 hours unsynced. This is the path when Google is unreachable from Myanmar but Telegram is not.

## 6. Push: the phone's rows into the Sheet

- Ids are the phone's: `newTx()` already makes UUID TxIDs and GroupIDs. Customers created on a phone get `C-` plus 8 hex characters.
- The server, under the script lock: skips rows whose TxID already exists (a 6-hour cache of recent ids, then the TxID column); writes each group with one `setValues` so a group is all or nothing; stamps Seq, ReceivedAt, DeviceID; bumps the master revision when items or customers changed; runs the view refresh once per batch; relays queued owner pings through Telegram.
- Accept and flag. Every well-formed row from a valid device is accepted as what happened; the seller saw ✅ and the cash moved. Anomalies are flagged, never silently dropped: stock below zero, a payment above what was owed, a deposit applied beyond what was held. Each flag goes into the 21:00 summary and into an owner ping that carries a void button. The only rejections are duplicates whose intended end state already holds (a second undo of the same group) and structural errors (unknown device, malformed row, staff or shop mismatch), which land in a Quarantine tab and are shown on the phone under ❌.
- Owner void: a new owner-only action `V|groupId` reverses any group at any age (undo with force, Source UNDO, note "void by owner"), available in Telegram and in the app, and attached to every conflict ping. This replaces hand edits in the Sheet.
- Transfers between shops are the one operation that writes a quantity read from stock, so they run online: the transfer button needs a fresh pull, and the server computes the quantity at receipt.
- Time: the phone learns `offset = serverTime − clientTime` at every sync, persists it, and `ports.clock.now()` applies it, so the business day is right even offline; the server also records ReceivedAt; a warning shows when the offset exceeds 5 minutes.

## 7. Pull: the Sheet's rows onto the phone

- Cursor: a server-assigned Seq column on the Ledger (Script Property counter under the lock, backfilled as row minus one for existing rows). Never the row number, which breaks on sorts, inserts and the yearly archive.
- Each pull also carries per-day checksums per shop (row count, sum of Amount, sum of Cash) so a phone that disagrees re-pulls that day and the Errors tab records that a hand edit or a lost row was repaired. The Ledger stays protected; corrections are voids and re-entries, never cell edits.
- Items and Customers carry Rev and UpdatedAt; the first sync of each day pulls the masters in full as a safety net for missed edits. Settings and Messages are pulled when their hash changes, so the sister's Burmese rewrites reach the app.
- Timing: sync on launch, right after each commit (debounced, one in flight), on the online event, and when the app returns to the foreground. Polling while backgrounded is not relied on; phones freeze background web apps.

## 8. Receipts, voice, photos, reports

- Receipt numbers: per-device letter from enrollment, `R1-A-000231`, gap-free per phone, never exhausted, never renumbered; stored in a ReceiptNo column on the SALE row. `receiptNumber()` prefers the column and falls back to today's derivation for old rows. The Telegram route keeps the plain per-shop series. The owner signs off on this format.
- Voice stays in Telegram for the pilot: Telegram's OGG is known to work with Gemini, and Telegram already queues voice notes offline. In-app voice (queued recordings sent to `api=ai`, replayed through `handleIntent` with the recording-time context) is enabled after the format test (real Chrome and Safari recordings through Gemini).
- New item by photo: registered offline at once with a placeholder name, the category by button and the price by preset; the AI name arrives later as a ✅/❌ proposal. The photo uploads to Drive at sync.
- Reports: tables render offline from `buildReport`; PDFs are built on the server and sent to Telegram, or returned to the app for the share sheet when small.

## 9. The daily summary and measurement

- 21:00 summary gains a sync line: "✅ all phones synced" or "⚠️ shop 2 phone not synced since 16:12, shop 2 figures incomplete". When late rows arrive, a corrected summary is posted once (at most hourly, not after midnight), and yesterday's late rows appear as a line in today's summary.
- End-of-day cash count: a button shows the expected drawer from local rows, the seller counts and confirms or types the amount; a CASH_COUNT row records it and the summary shows the difference.
- Telemetry stays out of the Ledger: TapMs (tap to painted confirmation) in a local ring buffer and a SyncLog tab (device, time, transport, rows, duration, result, version). The owner's private summary gets one Ops line.
- Acceptance for the pilot, all over the last 7 days: median TapMs under 300 ms and 95th percentile under 1 s on the sellers' own phones; every day's rows in the Sheet by 08:00 the next day; no duplicate TxIDs; every flag resolved within a day; drawer count within 5,000 MMK on 6 of 7 days; one Transport B push and one re-enrollment exercised; sync success on 95 percent of attempts with signal.

## 10. Core edits (all additive, existing checks stay green)

1. Mirror rows of an undo stay in the group they reverse, and `saleGroupInfo` also counts older out-of-group reversals. Done 2026-11-02; it fixed a real bug where an undone credit sale stayed open.
2. Ledger columns appended: Seq, ReceivedAt, DeviceID, ReceiptNo. Items and Customers: Rev, UpdatedAt. New tabs: Devices, SyncLog, Quarantine, AiJobs.
3. `receiptNumber()` prefers the row's ReceiptNo.
4. Owner-only `V|groupId` void.
5. `newTx()` passes receiptNo through; the store may supply customer ids.
6. 📲 enroll code and `/devices` in the Telegram menu; "sell in the app" reply for enrolled users.
7. `doPost` routes `?api=` to the sync handler; everything else unchanged.

## 11. Phase 0 gates (before any sync code)

| # | Test | Pass |
| --- | --- | --- |
| P1 | Hosting origin (`<project>.web.app`, standby `<project>.pages.dev`) opened from both shops' SIMs, three times a day for three days | 95 percent success, first load under 10 s |
| P2 | Service worker install on one Android and one iPhone; airplane-mode sale from the icon; data survives a restart | both pass, or iPhone deferred |
| P3 | Real browser POST (text/plain) to `/exec?api=ping` from both phones, following the redirect | JSON back on both |
| P4 | Burmese rendering of the real strings with the bundled font; Zawgyi check per phone | every glyph correct |
| P5 | One full day of offline use with the notebook in parallel, forced sync at closing | every line in the Sheet, drawer matches |
| P6 | Real Chrome webm and Safari mp4 recordings through `geminiCall()` | same accuracy as Telegram OGG, else voice stays in Telegram |
| P7 | In-app QR scan of the printed tags in shop light on both phones | card in under 2 s, permission remembered |
| P8 | Transport B round trip with three offline sales | three rows, no duplicates |
| P9 | Remote enrollment of the sister's phone by the typed code, timed | under 15 minutes |
| P10 | iPhone left 8 days unopened, then opened offline | data still there |

## 12. Build order and effort

| Step | Content | Maintainer days |
| --- | --- | --- |
| 0 | Core fixes into the Telegram bot now: group-kept mirrors (done), ReceiptNo column and fallback, owner void, Seq/ReceivedAt/DeviceID columns with a backfill function, enroll-code and Devices stubs, scenario checks | 2 |
| 1 | Phase 0 gates P1 to P10 (1 to 2 weeks elapsed, go/no-go) | 2 |
| 2 | Server: `gas_sync.js` with api routing, enroll by code, push with dedupe and accept-and-flag, pull by Seq with checksums, compressed bootstrap, AI jobs, report and photo endpoints, notice relay, Transport B document handler, summary sync line, `/devices` | 5 |
| 3 | Phone data layer in the simulator first: IndexedDB store with incremental stock, outbox in the same transaction, sync loop with clock offset and revoke wipe, a fake server over the in-memory sheet with two phones and the 22 sync scenarios; the existing checks stay green through the new ports | 6 |
| 4 | PWA shell: scanner-first home, latest-card UI from the simulator, sync chip, menu grid, keypad, enroll screen, bundled font and jsQR, manifest, service worker with silent update, build script, Firebase deploy. Android only | 6 |
| 5 | Pilot in shop 1, three weeks: one Android selling phone plus the owner's phone; week 1 sale, undo, discount, recent, find, restock, chip, cash count; week 2 credit, payment, deposit, receipt, expense, a Transport B drill and a re-enrollment drill; acceptance by section 9 | 4 |
| 6 | After acceptance: iPhone enrollment if P2, P7, P10 passed; in-app voice and photo queue if P6 passed; shop 2; a second phone per shop | 3 |
| 7 | Later on the same sync: notebook import in the app, the tailoring module (its 32-field form is the strongest reason for an app), yearly archive on phones | later |

Total about 30 maintainer days (range 26 to 36), 10 to 12 calendar weeks working evenings from abroad, zero recurring cost. The three raw estimates (15 plus 5, 20 and 25 days) each omitted part of the others' scope; 30 with the fixes is realistic.

## 13. Decisions the owner makes now

1. Go or no-go on the app, knowing the effort above and that the Sheet, the tags and her Telegram stay as they are.
2. Which phone in shop 1 is the pilot phone, and that shop 1 runs one selling phone for the pilot.
3. Receipt numbers per phone (`R1-A-000231`) instead of one series per shop.
4. The 21:00 summary posts on time with a warning line when a phone is stale, and a correction later.
5. Who counts the drawer, when, and the tolerance for "matches" (5,000 MMK proposed).
6. Voice notes stay in Telegram during the pilot.
7. The app's Burmese name and icon as the sellers will see it on the home screen.
