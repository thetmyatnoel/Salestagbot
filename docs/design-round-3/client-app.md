## Decision

Build **SalesTagBot as an installable Progressive Web App (PWA)** hosted on **Firebase Hosting (Spark, free)**, that runs the existing `core_*.js` unchanged against an in-memory copy of the shop's data mirrored to IndexedDB, and syncs to the Google Sheet through a small new JSON endpoint in the same Apps Script project. Telegram stays exactly as it is for the 21:00 summary, owner pings, PDFs, receipt forwarding and as the fallback UI. Nothing about the Sheet, the ledger rules or the Telegram bot changes; the phone simply stops waiting for the network.

The simulator (`poc/sim_ports.js` + `sim_ui.js`) is already 70 percent of this app: it runs `processUpdate()` with Telegram-shaped updates against in-memory ports and renders the bot's cards and inline buttons in a phone pane. The PWA is that simulator with (a) persistence, (b) an outbox that uploads to the Sheet, (c) a camera, a microphone and a service worker, and (d) a "current card" layout instead of a long transcript.

## 1. Form factor, compared

| | PWA (recommended) | Telegram Mini App | Sideloaded Android APK (WebView wrapper) | Native |
|---|---|---|---|---|
| Offline logic + local data | Yes: service worker + IndexedDB on Android Chrome and iOS Safari home-screen apps | No in practice: the page is loaded by Telegram's webview each time; on iOS it is a WKWebView, where Service Workers are only available to app-bound domains that the embedding app (Telegram) declares; Telegram's docs offer only a 5 MB DeviceStorage, no offline mode | Yes (Android only) | Yes |
| Covers both Android and iPhone | Yes | Yes, but online-only | Android only; iPhone impossible without a paid Apple developer account | Needs two codebases plus Apple account |
| Install, zero literacy | Android: Chrome menu "Install app"; iPhone: Safari Share > "Add to Home Screen" (Chrome on iOS can also do it since iOS 16.4). Done once by the sister | Nothing to install, but needs Telegram online every time | "Unknown sources" dialogs, a signed .apk sent over Telegram, re-send for every update | App stores or sideload |
| Storage persistence | Android: `navigator.storage.persist()` granted silently for installed apps; iOS: home-screen apps have their own usage counter so the 7-day Safari eviction does not apply, quota up to ~60% of disk on iOS 17+ | Telegram-controlled webview, cleared at Telegram's discretion | App-controlled | App-controlled |
| QR scan with camera | `BarcodeDetector` on Chrome Android (Play Services); `jsQR` fallback over `getUserMedia` everywhere incl. iOS standalone (works since iOS 13.4) | `showScanQrPopup()` (Bot API 6.4) is nice, but online-only | Same as PWA inside WebView | Native |
| Voice note | `MediaRecorder`: Chrome gives `audio/webm;codecs=opus`, Safari 14.1-18.3 gives `audio/mp4` (AAC), Safari 18.4+ also webm/ogg; Gemini accepts audio/webm, audio/aac, audio/m4a, audio/ogg | Same, but only while online | Same | Native |
| Photo capture | `<input type=file accept=image/* capture>` on both | Same | Same | Native |
| Share to Viber/Telegram | Web Share API (Safari iOS 12.2+, Chrome Android), `canShare({files})` for PDFs | Telegram-only sharing | Android share sheet | Native |
| Updates | Service worker: next open shows "new version" banner; one `firebase deploy` from Windows | Instant (server page) | Re-send APK by hand, every time | Store or re-send |
| Cost / accounts | 0; Google account the project already has; no card | 0 | 0 but needs Android Studio + keystore on the maintainer's PC | Apple 99 USD/yr; Play 25 USD |
| Push (not required) | Android yes; iOS home-screen apps since 16.4 | via bot | yes | yes |

The Mini App is the tempting one because the family already lives in Telegram, but it cannot be offline-first on iPhone and still needs the Telegram round trip to open, so it fails the one requirement that triggered this redesign. A wrapped APK excludes the iPhones in the family. The PWA is the only zero-cost option that is instant, offline, on both platforms, and updatable from abroad with one command.

## 2. Hosting: Firebase Hosting, with Cloudflare Pages as a cold standby

Firebase Hosting Spark: 10 GB storage, 360 MB/day transfer, "No payment method needed", HTTPS on `<project>.web.app` and `<project>.firebaseapp.com`. Deploy from Windows: `firebase deploy --only hosting` (CLI via `npm i -g firebase-tools`, or the standalone Windows binary from firebase.tools so Node is not even required). The app is ~1 MB with fonts; 2 phones opening it daily is kilobytes of traffic because the service worker serves the shell from cache. `firebase.google.com` measured 2/2 reachable from Myanmar, and web.app/firebaseapp.com are served from Google's front ends like docs.google.com (164/165), so the prior is good, but **the exact hosting domain is not yet measured** (see hosting section for the measurement procedure). GitHub Pages is free for public repos but GitHub's own policy says Pages is not for running a business or sites "primarily directed at commercial transactions"; a private POS is a grey zone, github.com had 8% anomalies, and deploying needs git on the maintainer's machine; keep it as a documented emergency mirror only. Cloudflare Pages is free, deploys with `npx wrangler pages deploy dist` or drag-and-drop, on `<name>.pages.dev`; its reachability from Myanmar is unmeasured, so it is the standby that gets measured now and used only if web.app fails.

## 3. Architecture in one paragraph

The browser bundle = `core_*.js` (untouched) + `pwa_ports.js` (store on an in-memory mirror written through to IndexedDB, chat as a persisted local message list, ai/pdf as outbox jobs, cache in memory+IDB, lock no-op, clock, `crypto.randomUUID`) + `pwa_sync.js` (outbox upload, pull of other shop's rows, Items/Customers/Settings/Messages refresh) + `pwa_ui.js` (the simulator's phone renderer, re-laid-out as one big current card with a bottom bar) + `pwa_scan.js`, `pwa_media.js`, `sw.js`, `manifest.webmanifest`. Server side: one new file `gas_api.js` in the existing Apps Script project exposing `doPost(?api=1&token=...)` for sync, voice, photo and PDF jobs, and a two-line addition to the 21:00 summary that flags a phone that has not synced. Everything the family knows (cards, Burmese labels, button names, Undo, 💳 မကျေသေး, 🧾) is produced by the same core code, so the Telegram bot and the app never disagree.

## 4. Chat transcript or plain screen?

Hybrid, leaning plain: show **only the latest bot message as one large card with large buttons**, a one-line "⌃ မှတ်တမ်း" (history) handle that unfolds the last ~50 messages as the familiar chat, and a fixed bottom bar [📷 ဖတ်] [🎤] [☰]. The content of the card is byte-identical to what Telegram shows, so a seller who learnt Telegram recognises every word and button; the layout removes scrolling, the START step and the waiting. This also costs nothing extra: the renderer is `renderMsg()` from `sim_ui.js` with a different container.

## 5. The honest sync story (summary; detail in architecture)

Every tap commits locally in <50 ms and the card updates immediately. A sync chip in the header shows ✓ ပို့ပြီး (synced), ⏳ ၃ ခု ကျန် (3 waiting) or ⚠️ ၂ ရက် ကတည်းက မပို့ရသေး (not synced for 2 days); tapping it opens the sync screen with "ယခု ပို့မယ်" and "📤 ဖိုင်ထုတ်" (export). Voice notes are stored and shown as "🎤 သိမ်းထားပြီ · အင်တာနက် ရရင် နားလည်ပါမယ်" and turn into the normal ✅/❌ confirm card when the server answers. Undo offline is the same reversing rows, also queued. Rows leave the outbox only after the Sheet acknowledges their TxIDs. The daily summary names any phone that has unsynced data, so the owner is never silently short of rows.

## 6. One-line effort

About 25 working days for the maintainer, in six increments that each ship something usable; details in the estimate.

---

# Facts checked

- Gemini accepts audio MIME types audio/wav, mp3, aiff, aac, ogg, flac, mpeg, m4a, l16, opus, alaw, mulaw and audio/webm; 20 MB total inline request limit; 32 tokens per second of audio.
  Source: https://ai.google.dev/gemini-api/docs/audio (fetched 2026-11-02)
- Safari deletes all script-writable storage (IndexedDB, localStorage, service worker registrations and cache) after seven days of Safari use without user interaction on the site; web apps added to the home screen are not part of Safari and have their own counter of days of use, and WebKit does not expect their data to be deleted.
  Source: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- Safari 17 / iOS 17: origin quota up to 60% of disk for browser apps and for Home Screen web apps (same as browser), 15% for other embedding apps; eviction is LRU of whole origins under pressure, skipping origins in persistent mode; navigator.storage.persist() decided by heuristics such as running as a Home Screen Web App.
  Source: https://webkit.org/blog/14403/updates-to-storage-policy/ and https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Chrome: an origin may store up to 60% of disk; storage-pressure eviction skips origins granted persistence via navigator.storage.persist(); Chromium and Safari grant or deny persist() automatically without a prompt.
  Source: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- iOS 16.4 added Web Push and Badging for Home Screen web apps and let third-party browsers (e.g. Chrome for iOS) offer Add to Home Screen; sites with manifest display standalone/fullscreen open as web apps.
  Source: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ; https://9to5mac.com/2023/07/14/google-chrome-web-apps-ios/
- Chrome installability criteria: manifest with name/short_name, 192px and 512px icons, start_url, display standalone/fullscreen/minimal-ui, served over HTTPS, user interacted and viewed 30s; prefer_related_applications false.
  Source: https://web.dev/articles/install-criteria
- BarcodeDetector shipped in Chrome 83 on Android (requires Google Play Services), macOS and ChromeOS; checking constructor existence is not enough, call BarcodeDetector.getSupportedFormats() and look for qr_code. Safari 17+ lists it only 'disabled by default' behind a feature flag and WebKit bug reports say it stopped working on iOS 18; Firefox none.
  Source: https://developer.chrome.com/docs/capabilities/shape-detection ; https://caniuse.com/mdn-api_barcodedetector ; https://bugs.webkit.org/show_bug.cgi?id=281848
- jsQR is a standalone pure-JavaScript QR decoder (Apache-2.0) taking Uint8ClampedArray RGBA ImageData: jsQR(data, width, height).
  Source: https://github.com/cozmo/jsQR
- MediaRecorder enabled by default in Safari from iOS 14.3 beta / Safari 14.1; Safari records MP4 container with AAC audio; Safari 14.1-18.3 return isTypeSupported false for WebM, Safari 18.4 added WebM/Ogg. Chrome records WebM/Opus.
  Source: https://webkit.org/blog/11353/mediarecorder-api/ ; https://blog.addpipe.com/recording-audio-in-the-browser-using-pure-html5-and-minimal-javascript.md ; https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- getUserMedia (camera) works in iOS home-screen (standalone) web apps since iOS 13.4; it did not before; it is still not available inside WKWebView without app-bound domains.
  Source: https://bugs.webkit.org/show_bug.cgi?id=185448 ; https://bugs.webkit.org/show_bug.cgi?id=208788 ; https://github.com/gruhn/vue-qrcode-reader/issues/76
- In WKWebView (what Telegram and every non-Safari iOS app embed) the Service Worker API is available only when the embedding app opts into App-Bound Domains (limitsNavigationsToAppBoundDomains) or is a default-browser-eligible app; Telegram Mini Apps docs offer no offline mode, only DeviceStorage (5 MB per user).
  Source: https://webkit.org/blog/10882/app-bound-domains/ ; https://www.inappwebview.dev/docs/service-worker ; https://core.telegram.org/bots/webapps
- Telegram Mini Apps can scan QR with showScanQrPopup/closeScanQrPopup (Bot API 6.4+), online only since the Mini App itself is loaded from the developer's URL.
  Source: https://core.telegram.org/bots/webapps ; https://pub.dev/documentation/new_telegram_web_app/latest/telegram_web_app/TelegramWebAppImpl/showScanQrPopup.html
- Web Share API: Safari iOS 12.2+, Chrome for Android, Samsung Internet 8.2+; requires HTTPS and a user gesture; file sharing limited to types such as application/pdf, image/*, audio/*, check navigator.canShare({files}).
  Source: https://caniuse.com/web-share ; https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- Firebase Hosting Spark plan: 10 GB storage, 360 MB/day transfer, 'No payment method needed'; sites served at PROJECT_ID.web.app and PROJECT_ID.firebaseapp.com; deploy with 'firebase init hosting' then 'firebase deploy --only hosting'.
  Source: https://firebase.google.com/pricing ; https://firebase.google.com/docs/hosting/quickstart
- Firebase CLI installs on Windows with 'npm install -g firebase-tools' (Node 18+) or as a standalone Windows binary from https://firebase.tools/bin/win/instant/latest (no Node); 'firebase login', 'firebase deploy'.
  Source: https://firebase.google.com/docs/cli
- GitHub Pages: available in public repositories with GitHub Free; sites max 1 GB, soft 100 GB/month bandwidth, 10 builds/hour; hosted at <owner>.github.io; policy: not intended as free hosting to run an online business, e-commerce or sites primarily directed at commercial transactions.
  Source: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits ; https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages ; Enterprise mirrors of the same page via search
- Cloudflare Pages Free: 500 builds/month, 20,000 files per site; direct upload with 'npx wrangler pages deploy <dir>' or drag-and-drop in the dashboard; served at <project>.pages.dev; Workers Free plan 100,000 requests/day is the default for users.
  Source: https://developers.cloudflare.com/pages/platform/limits/ ; https://developers.cloudflare.com/pages/get-started/direct-upload/ ; https://developers.cloudflare.com/workers/platform/pricing/
- Apps Script HtmlService serves web apps inside a sandboxed iframe (IFRAME mode only), so a PWA shell cannot be hosted by Apps Script itself (no service worker registration from a sandboxed/third-party frame); ContentService answers with a 302 redirect to script.googleusercontent.com whose final 200 carries Access-Control-Allow-Origin, and browsers avoid the CORS preflight by POSTing with Content-Type text/plain (community-documented, must be tested).
  Source: https://developers.google.com/apps-script/guides/html/restrictions ; https://developers.google.com/apps-script/guides/web ; https://gist.github.com/tanaikech/a72aab0242012362c46ec69031c720d5 ; project note POS-PROJECT-PLAN.md 13.1
- Service worker update: browser checks for a byte-different sw.js on navigation (and at most every 24h on functional events); the new worker waits until the old controls zero clients; use updatefound/statechange to show a 'new version' prompt, skipWaiting() after the user agrees, reload on controllerchange.
  Source: https://web.dev/articles/service-worker-lifecycle
- Myanmar switched officially to Unicode on 1 October 2019 (U-Day); Android has shipped Myanmar Unicode support since 4.4 and AOSP bundles NotoSansMyanmar (Regular/Medium/Bold); some vendors sold Zawgyi-defaulted handsets in Southeast Asia, so Zawgyi phones still exist.
  Source: https://en.wikipedia.org/wiki/Zawgyi_font ; https://www.frontiermyanmar.net/en/zawgyi-to-unicode-the-big-switch ; https://android.googlesource.com/platform/external/noto-fonts/+/2536dca/notosansmyanmar/ ; https://dimagi.atlassian.net/wiki/spaces/commcarepublic/pages/2143949112/Myanmar+Android+Zawgyi+and+Unicode
- iOS ships 'Myanmar Sangam MN' as a system font (Apple system-fonts list). NOT re-verified by fetch today: the fetched page text was truncated before the M entries; confirm on https://developer.apple.com/fonts/system-fonts/ or on the device. The app self-hosts Noto Sans Myanmar so rendering does not depend on it.
  Source: https://developer.apple.com/fonts/system-fonts/ (partial fetch)
- OONI: Web Connectivity measurements for a specific domain from Myanmar can be queried in OONI Explorer / MAT with probe_cc=MM&test_name=web_connectivity&domain=<host>, or via api.ooni.io/api/v1/aggregation and /measurements with anomaly=true; a single measurement is not conclusive, look across time and ASNs.
  Source: https://ooni.org/support/ooni-explorer ; https://ooni.org/support/interpreting-ooni-data/ ; POS-PROJECT-PLAN.md Appendix E aggregation URL
- Measured reachability from Myanmar (project context, OONI Jul-Oct 2026): Telegram 2,485 tests 1.2% anomalies; google.com 181/181; docs.google.com 164/165; script.google.com 2/2; firebase.google.com 2/2; github.com 326/355 with 8% anomalies; Gemini API not offered in Myanmar; VPN criminalised.
  Source: C:\Users\USER\Desktop\Noel\POS-PROJECT-PLAN.md section 12.1 and task context
- core_bot.js entry is processUpdate(update, ports) with ports = {store, chat, ai, pdf, cache, lock, clock, uuid, dedupe}; sim_ports.js already implements all ports in memory and builds Telegram-shaped updates (sim.start/tap/text/voice/photo); build_simulator.js inlines core + sim files into one HTML; handleIntent(intent, msg, staff, updateId, ports, source, ctx) is a global the app can call after a deferred voice parse; receiptNumber() derives numbers from ledger order; addCustomer in the store assigns IDs.
  Source: C:\Users\USER\Desktop\Noel\apps-script\core_bot.js, core_ledger.js, poc\sim_ports.js, poc\build_simulator.js (read 2026-11-02)

---

# Architecture

## A. File and module structure

```
apps-script/                      (unchanged unless marked)
  core_config.js  core_burmese.js  core_messages.js  core_ai_prompt.js
  core_ledger.js  core_report.js   core_bot.js        -> REUSED UNTOUCHED, shipped to the phone as-is
  gas_main.js     gas_store.js     gas_telegram.js    gas_gemini.js  gas_pdf.js  gas_setup.js  gas_import.js
  gas_api.js                      NEW  JSON endpoint for the app: pair, push, pull, voice, photo, pdf, ping
  gas_main.js                     EDIT (10 lines): route ?api=1 to gasApi.handle(); summary footnote for stale devices
  gas_setup.js                    EDIT: Staff tab gains DeviceKey, PairCode, LastSyncAt columns; Ledger gains ReceiptNo, Device
pwa/                              NEW
  index.html                      shell: header (shop, sync chip), card area, bottom bar, screens as <section hidden>
  app.css                         big type, Burmese font stack, 56px buttons, light/dark
  manifest.webmanifest            name "SalesTag", short_name "ဆိုင်", display standalone, start_url "./?src=pwa", icons 192/512, lang "my"
  sw.js                           precache shell, runtime cache for photos, update message
  pwa_ports.js                    the ports (store, chat, ai, pdf, cache, lock, clock, uuid, dedupe) on IndexedDB mirror
  pwa_db.js                       IndexedDB open/upgrade, load-all, write-through helpers
  pwa_sync.js                     outbox, push/pull cycle, sync state machine, export
  pwa_ui.js                       rendering: card, history, menu, keypad, sync screen (renderMsg/renderReport lifted from sim_ui.js)
  pwa_scan.js                     BarcodeDetector -> jsQR fallback, tag URL parser
  pwa_media.js                    MediaRecorder hold-to-talk, photo capture + downscale
  pwa_i18n.js                     app-chrome strings not in core_messages (install, sync, scanner); same key/override pattern
  vendor/jsQR.js                  Apache-2.0, pinned copy
  fonts/NotoSansMyanmar-{400,600}.woff2   self-hosted subset
  build_pwa.js                    concatenates core_*.js + pwa_*.js -> dist/app.<hash>.js, writes version.json and sw.js precache list
  dist/                           what firebase deploy uploads (firebase.json public: pwa/dist)
poc/
  sim_ports.js, sim_ui.js         unchanged; simulator gains a "PWA ports" switch that boots pwa_ports against a fake gas_api (dev build)
  run_scenario.js                 unchanged; a second runner run_scenario_pwa.js runs the same 109 checks through pwa_ports with fake-indexeddb
```

Loading order in the bundle is the same as `build_simulator.js`: config, burmese, messages, ai_prompt, ledger, report, bot, then the pwa files. All classic scripts, no modules, no bundler, no npm in the runtime.

## B. How the core runs on the phone without changes

`core_*.js` is synchronous: `store.getItem()` returns a value, not a promise. IndexedDB is asynchronous. The bridge is the one architectural trick: **load the whole dataset into memory at startup, run the core against plain arrays exactly as `sim_ports.js` does, and write every change through to IndexedDB after the `processUpdate()` call returns**. Volume is small: a few hundred Items, 36k ledger rows per year for both shops (~10 MB as JSON, ~1 s to load on a cheap phone; prune to the last 13 months later if needed), under 500 customers.

The app never calls Telegram and never sees an `update_id` from Telegram. It fabricates Telegram-shaped updates exactly like `sim_ports.world.sim`:
- open a scanned tag → `{update_id, message:{text:'/start S1-0042', from:{id: staffId}, chat:{id: staffId}, date: now}}`
- tap a button → `{callback_query:{id, from, message:{message_id, chat, text}, data:'S|S1-0042|2'}}`
- typed text → `message.text`
`uid`/`chatId` is the staff's Telegram user id from the Staff tab (the pairing step hands it over), so the same person has one identity in Telegram and in the app and Undo windows, `last item` and multi-step states live in the same `ports.cache` keys.

Two small core edits are worth making (not required, but they remove two sync warts). Both are additive and keep the 109 checks green:
1. `receiptNumber(ports, groupId)`: if the SALE row carries `receiptNo`, return it. The pwa store stamps `receiptNo = 'R' + shopDigit + '-' + deviceLetter + seq` (e.g. `R1-A000231`) on each SALE it writes, so a number shown offline never changes after sync; the Telegram path keeps the old derivation (or the server stamps the same way). Without this, an offline receipt number could shift once the other shop's rows interleave.
2. `writeGroup()` already goes through `ports.store.appendLedger`, so nothing else is needed for the outbox; but `undoGroup` reads `ports.store.ledgerRows()` which must include unsynced rows: it does, because the mirror holds them.

Everything else (credit sales, deposits, price pending, samples, recent items, reports, receipts text) runs unchanged.

## C. The ports, one by one

| Port | Browser implementation |
|---|---|
| `store.getItem/listItems/updateItem` | in-memory `items[]` (same `viewItem`/`stockOf` as sim_ports: stock is a sum over the ledger mirror, status derived). `updateItem` writes IDB `items` and enqueues an outbox op `{kind:'item', id, fields}` |
| `store.appendLedger/ledgerRows` | push to `ledger[]`, IDB put with `sync:'pending'`, outbox op `{kind:'ledger', tx}`; `ledgerRows()` returns the array (copy) |
| `store.getStaff/listStaff` | the paired staff record plus the staff list from the last pull (needed for `notifyOwners`, which in the app becomes an outbox op the server turns into a Telegram ping) |
| `store.getCustomer/listCustomers/addCustomer` | memory + IDB; `addCustomer` assigns `'C-' + deviceLetter + '-' + seq` (two phones cannot collide; the Sheet accepts any id). Server-created customers (from Telegram) arrive in the pull |
| `store.getSetting/getMessage` | from the last pull of the Settings and Messages tabs (so the sister's Burmese rewrites reach the app too), defaults from `core_messages.js` |
| `store.logError/logUnknownUser` | IDB `errors` + outbox op `{kind:'error'}` so the maintainer still sees them in the Errors tab |
| `store.refreshViews` | omitted (optional in core); the server refreshes Credits/Deposits tabs after applying a batch |
| `chat.sendMessage/sendPhoto/sendDocument/editMessage` | persisted local message list (IDB `chat`), same shape as sim_ports (`{from:'bot', text, keyboard, photo, document, edited}`); UI re-renders on a listener |
| `chat.answerCallback/typing` | no-op / show a 300 ms spinner on the tapped button |
| `chat.getFile(fileId)` | returns the local Blob record from IDB `files` |
| `chat.savePhoto(fileId, name)` | returns a local `blob:` URL immediately and enqueues `{kind:'photo', fileId, itemId}`; when the server answers it returns the Drive URL and the store patches `photoUrl` |
| `ai.parseVoice/parseText/describePhoto/readNotebook` | **never called synchronously by the app for voice** (see D). `describePhoto` returns a cached server result if the photo job already came back, else throws `Error('queued')` which core's `handlePhoto` catches and continues with the placeholder name `ပစ္စည်း S1-0042`; the AI name is patched in when the job returns, unless the seller already renamed. `parseText` (typed Burmese sentences) goes through the same queue as voice |
| `pdf.make(report)` | online: POST report JSON to `gas_api` → PDF base64 → Blob → `chat.sendDocument` shows it with [📤 Share] (Web Share: Viber, Telegram, print); offline: the button replies `📄 PDF အတွက် အင်တာနက် လိုပါသည် · စာရင်းကို အောက်မှာ ကြည့်နိုင်ပါသည်` and the report table (from `buildReport`, which is platform-free) is rendered on screen anyway |
| `cache.get/put/remove` | memory map with expiry, mirrored to IDB `cache` so a multi-step flow survives an app restart |
| `lock.run(fn)` | `fn()` directly (one user per phone) |
| `clock.now()` | `new Date()`; row `time` uses the phone clock; the server also records `receivedAt` so a wrong phone clock is visible |
| `uuid()` | `crypto.randomUUID()` (secure context) |
| `dedupe` | `{seen:()=>false, remember:()=>{}}`; the app never re-delivers an update |

## D. Voice, photo and PDF jobs (the only things that need the server)

Voice: hold 🎤, `MediaRecorder` picks `audio/webm;codecs=opus` if `isTypeSupported`, else `audio/mp4`. On release the app stores `{blob, mime, duration, ctx: buildAiContext(ports, staff, uid), msg:{date, message_id}}` in IDB `files` + outbox `{kind:'voice'}` and pushes a local user bubble plus a bot bubble `🎤 သိမ်းထားပြီ · အင်တာနက် ရရင် နားလည်ပါမယ်` (saved; will be understood when online). When the job returns the intent JSON, the app calls core's `handleIntent(intent, msg, staff, updateId, ports, CFG.SOURCE.VOICE, ctx)` with the *recording-time* context, so "ဒါ ၂ ထည်" refers to the item that was on screen when she spoke. The confirm card (✅ မှန်တယ် / ❌ မဟုတ်ဘူး) appears and commits locally as usual. If the server returns an AI error, the bubble becomes core's `ai_down` text with the button card. Same path online and offline, one code path; online it just takes 3-6 s instead of hours. Server side, `gas_api` relabels `audio/mp4` to `audio/m4a` before `gasAi.parseVoice` (Gemini lists m4a and aac, not mp4; Phase 0 test T11 confirms it). Notes are capped at 30 s (~60-120 KB).

Photo: `<input type=file accept="image/*" capture="environment">` (no getUserMedia needed), canvas-downscale to 1280 px JPEG ~150-250 KB, stored in `files`, then the normal core `handlePhoto` runs immediately (price buttons appear at once); the job uploads the photo, the server saves it to Drive and runs `describePhoto`, returns `{photoUrl, name, category}`, the store patches the item if it still has the placeholder name. The Telegram card for that item later shows the Drive photo.

PDF: see table above. Receipt text (not PDF) is built locally by `receiptText()` and shared with Web Share as text, so a receipt can go to a customer's Viber offline-recorded and sent the moment the phone has signal (Viber queues it).

## E. IndexedDB schema (database `salestag`, version 1)

| Store | keyPath | Indexes | Record |
|---|---|---|---|
| `items` | `id` | `shop`, `status` | item as in gas_store `gasItemFromRow` + `updatedAt`, `dirty` |
| `ledger` | `txId` | `groupId`, `day`, `itemId`, `sync` (pending/acked), `seq` (autoinc local order) | the tx from `newTx` + `receiptNo`, `device`, `seq`, `sync`, `serverRow` |
| `customers` | `id` | `name` | `{id, name, phone, note, createdAt, dirty}` |
| `staff` | `id` | | staff list from the last pull (role, shop, name) |
| `settings` | `key` | | `{key, value}` |
| `messages` | `key` | | `{key, text}` (Burmese overrides) |
| `chat` | `id` autoInc | `ts` | `{from, text, keyboard, photo, document, edited, ts}`; trimmed to the last 200 |
| `cache` | `key` | `exp` | `{key, v, exp}` for core's `st:`, `li:`, `cf:`, `tap:` keys |
| `files` | `fileId` | `kind` | `{fileId, kind: voice|photo|pdf, blob, mime, duration, remoteUrl, created}`; voice blobs deleted after the job is acked, photos kept as thumbnails |
| `outbox` | `opId` autoInc | `state`, `kind` | `{kind: ledger|item|customer|voice|photo|pdf|error|owner_ping, payload, fileId?, created, tries, lastError, state: pending|sending|done|failed}` |
| `errors` | `id` autoInc | | mirror of the Errors tab rows this phone produced |
| `meta` | `key` | | `deviceKey`, `deviceLetter`, `staffId`, `shop`, `botUsername`, `ledgerCursor` (server row count seen), `tablesHash`, `lastSyncOk`, `lastSyncTry`, `lastSyncError`, `appVersion`, `persisted`, `receiptSeq`, `customerSeq` |

Write-through rule: `processUpdate()` runs synchronously on memory; a `commit()` afterwards opens one IDB transaction over the stores touched during that update (collected by the ports) and writes them; the UI renders from memory, never waits for IDB. Startup: open DB → `getAll` of items, ledger, customers, settings, messages, cache, chat(last 200) → build memory → render in under a second.

## F. Sync protocol (`gas_api.js` + `pwa_sync.js`)

Transport: `fetch(WEBAPP_URL + '?api=1&token=' + WEBHOOK_SECRET_FOR_API, {method:'POST', body: JSON.stringify(req), headers:{'Content-Type':'text/plain;charset=utf-8'}, redirect:'follow'})`. Text/plain avoids the CORS preflight that Apps Script cannot answer; the 302 to `script.googleusercontent.com` is followed by fetch and the final body is `ContentService.createTextOutput(JSON).setMimeType(JSON)`. The Telegram webhook path keeps HtmlService (13.1); the two are separated by the `api=1` parameter at the top of `doPost`. **This exact browser → Apps Script round trip is Phase 0 test T11 and must pass from a shop phone before anything else is built on it.** Plan B if it fails: an Apps Script `doGet` JSONP endpoint for pulls plus `no-cors` POSTs with a confirmation pull; uglier, same zero cost.

Auth: pairing. The sister opens the Staff tab, the maintainer has pre-filled a 6-digit `PairCode` per staff row (or runs `makePairCodes()`); on first launch the app asks for the code, POSTs `{op:'pair', code}` and receives `{deviceKey, staffId, shop, deviceLetter, botUsername}` stored in `meta`; the server blanks the code and stores a hash of `deviceKey` in the Staff row. Every later request carries `deviceKey`; a request with an unknown key gets `{error:'unpaired'}` and the app shows the pairing screen again. The webhook secret stays for Telegram; the API uses a second secret so leaking one does not open the other.

Push (`op:'push'`): `{deviceKey, ops:[...]}` in order, at most 100 ops. Server under `LockService`: for each `ledger` op, if TxID already in the Ledger (set of TxIDs loaded once per call) skip, else append the row with `Device` and `ReceiptNo`; `item` ops apply `updateItem` field by field (last writer wins by phone time; conflicts are rare: price edits by the owner, transfers); `customer` ops insert if id unknown; `error` ops append to Errors; `owner_ping` → `gasChat.sendMessage` to owners; `voice`/`photo` ops carry base64 and return results inline. Returns `{acked:[opIds], results:{opId: intentOrPhotoResult}, ledgerCursor, tablesHash}`. Then `refreshViews` once. Append-only ledger means no merge conflicts, ever; stock of a SKU sold in both shops offline can go below zero and is shown as `⚠️ လက်ကျန် -1`; the owner fixes with ADJUST as today.

Pull (`op:'pull'`): `{deviceKey, ledgerCursor, tablesHash}` → the server returns Ledger rows beyond the cursor (the sheet is append-only so the row number is a monotonic cursor; rows the phone itself wrote come back and are marked `acked`), and the full Items, Customers, Staff, Settings, Messages tables only if their hash changed (they are small). Item photo thumbnails are fetched lazily by `op:'thumb'` and cached by the service worker.

Schedule: on launch; 3 s after any local commit (debounced); every 60 s while visible; on the `online` event; on `visibilitychange` to visible; manual button. Only in the foreground: iOS has no Background Sync; Chrome Android's Background Sync is registered too as a bonus, not relied upon. Exponential backoff on failure (5 s → 10 min), never more than one in-flight request, outbox ops stay `pending` until explicitly acked. Load on Apps Script: two phones × ~500 calls/day, each reading the Ledger once, far below quotas; the user never waits on any of it.

Server-side addition to the 21:00 summary: for each Staff row with a device, if `LastSyncAt` is older than two hours and the device reported pending ops in its last push, append `⚠️ {shop} ဖုန်း · {time} ကတည်းက sync မလုပ်ရသေး · {n} ခု ကျန်`. The owner then knows that the day's total may be short and why.

## G. Instant feedback and honesty about sync (UI rules)

- Tap → core runs → card redrawn in the same frame; a 300 ms highlight on the pressed button, no spinners for local actions.
- Header chip states, Burmese drafts: `✓ ပို့ပြီး` (green) · `⏳ ၃ ခု ပို့ရန်` (amber, count of pending ops) · `⚠️ ၂ ရက် ကတည်းက မပို့ရသေး` (red when > 24 h and pending > 0) · `📵 အင်တာနက် မရှိ · ဖုန်းထဲ သိမ်းထား` shown only on the sync screen, never as a blocking modal. Tapping the chip opens the sync screen: last success time, pending list in plain words ("ရောင်း ၂ ထည် · ထမီ အနီ · ၁၄:၀၂"), [🔄 ယခု ပို့မယ်] and [📤 ဖိုင်ထုတ်].
- Voice queued: user bubble with 🎤 and duration + bot bubble `🎤 သိမ်းထားပြီ · အင်တာနက် ရရင် နားလည်ပါမယ်`; it is replaced by the confirm card when parsed. If she sells by buttons meanwhile, nothing breaks: the voice confirm card still refers to the recording-time context.
- Undo offline: identical reversing rows via `undoGroup`; the mirror rows join the outbox after the originals; the server's TxID dedupe makes re-sends harmless.
- Never lose a sale: (1) `navigator.storage.persist()` requested at first launch and after install; the sync screen shows `🔒 ဖုန်းထဲ သိမ်းဆည်းမှု: ခိုင်မြဲ` or `⚠️ မခိုင်မြဲ · Home screen ထည့်ပါ`. (2) On iOS, if `display-mode` is not `standalone`, the app shows the install page first (pictures, three steps) and the sale flow is behind a small "ခဏ မထည့်သေး" link, because Safari-tab storage can vanish after 7 days without a visit. (3) Outbox entries are deleted only on ack. (4) When pending > 0 for > 24 h: red chip, a banner on the home screen, and the 21:00 summary footnote. (5) Export: `📤 ဖိုင်ထုတ်` writes `unsynced-S1-A-2026-11-02.json` (all pending ops, plus CSV of ledger rows) and opens Web Share: send it to the bot's Telegram chat or to the owner; `gas_main` gains a `handleDocument` for `.json` from staff that runs the same `applyOps` as the API, so **if Google is unreachable but Telegram works, the rows still reach the Sheet**. (6) Reinstall or cleared storage loses only what was pending; the app re-pairs and re-downloads everything from the Sheet, and `receiptSeq` restarts under a new device letter so numbers never collide.

## H. Scanning tags

Decoded text of today's tags is `https://t.me/<bot>?start=S1-0042`. Parser (`pwa_scan.js`): accept `/[?&]start=([A-Za-z0-9_-]{1,64})/`, `tg://resolve?domain=<bot>&start=...`, a bare `^S[12]-\d{4}$`, and the app's own future form `https://<app>/?start=S1-0042`; uppercase it and hand it to `sim.start`-style `/start <id>`. No reprint; the same `tools/make_tags.py` PDF stays valid, and scanning a tag with the phone's camera app still opens Telegram, which remains the fallback.

Scanner: `getUserMedia({video:{facingMode:'environment'}})` into a `<video>`; if `'BarcodeDetector' in window` and `getSupportedFormats()` includes `qr_code` (Chrome Android with Play Services) use it at ~10 fps; otherwise draw a 480-px frame to a canvas and run `jsQR(imageData.data, w, h, {inversionAttempts:'dontInvert'})` at ~8 fps (iOS Safari, Samsung Internet without Play Services, Huawei). First successful decode → vibrate (Android) + beep + the card opens; the camera stops. If permission is denied or no camera: automatic fall-through to the typed keypad. Typed fallback: [ဆိုင် ၁ | ဆိုင် ၂] toggle and a 4-digit keypad with 64-px keys, the `S1-` prefix pre-filled; the tag already prints the id in large text for exactly this.

## I. Burmese rendering

Font stack `"Noto Sans Myanmar", "Myanmar Text", "Myanmar Sangam MN", "Padauk", sans-serif`, and the app **self-hosts Noto Sans Myanmar 400/600 as woff2 (subset to Myanmar block + digits + punctuation, ~120 KB) in the service worker precache**, so both platforms render identically, offline, and independent of the phone's system font (Android Noto Sans Myanmar, iOS Myanmar Sangam MN). `font-size: 18px` body, 20px buttons, `line-height: 1.8` (Myanmar stacks need it), min button height 56 px, two to three buttons per row maximum, high contrast, and a font-size switch (A / A+ / A++) in settings stored per phone for older eyes. Zawgyi: the official switch to Unicode was 1 Oct 2019 and the self-hosted font makes the app's own text safe on any phone; the remaining risk is *typed* input from a Zawgyi keyboard (customer names, find). Mitigation: run the Google `myanmar-tools` Zawgyi detector on text input (tiny JS) and convert to Unicode before saving; show a one-time hint `ဖုန်း keyboard ကို Unicode ပြောင်းပါ` if Zawgyi is detected twice. Burmese digits via core's `myDigits` as today.

## J. Service worker caching strategy

- Precache (install): `index.html`, `app.<hash>.js`, `app.css`, fonts, icons, `vendor/jsQR.js`, `version.json`; cache name `shell-<hash>`; old shell caches deleted on activate.
- Shell: cache-first; navigation requests → `index.html` from cache (single page), so the app opens with no network at all.
- `gas_api` calls: never cached, network-only, done from the page (not the SW) so the outbox logic stays in one place.
- Photo thumbnails (`?op=thumb&id=`): stale-while-revalidate in `photos-v1`, capped at 400 entries LRU.
- Update flow: page registers SW, listens `updatefound` → `statechange: installed` with an existing controller → shows banner `✨ ဗားရှင်း အသစ် ရပြီ · [အခု ပြောင်းမယ်]`; on tap, only if the outbox is empty and no multi-step state is active, `postMessage('SKIP_WAITING')` → `skipWaiting()` → `controllerchange` → `location.reload()`. Otherwise the banner waits; it also applies silently on the next cold start. The page polls `version.json` once a day as a belt-and-braces check. Never reload mid-sale.
- Maintainer flow: edit `core_*.js` → `node poc/run_scenario.js` (109 checks) → `node poc/build_simulator.js` and click through in the simulator with "PWA ports" switched on (the simulator is the dev build; it boots `pwa_ports` against a fake `gas_api` and a fake IndexedDB) → `node pwa/build_pwa.js` (bumps version, hashes bundle, rewrites the precache list) → `firebase deploy --only hosting` → test on the maintainer's own Android and an iPhone (BrowserStack free trial or a family member's iPhone over a video call) → phones in the shops see the banner the next morning. Apps Script changes continue to be pasted by hand and verified with `probeWebhookResponse()` and a new `probeApi()`.

## K. Telegram's remaining role (unchanged code paths)

21:00 group summary and monthly PDF (triggers in `gas_main.js`), owner pings for price-pending items (`notifyOwners` via the `owner_ping` op), reports and receipts as documents, forwarding receipts to customers, and the complete bot as a fallback UI if a phone is lost or the app is broken: the Staff tab allows both, and because both write the same ledger through the same core, nothing diverges.

---

# Hosting

## Zero-cost hosting reachable from Myanmar

| | Firebase Hosting (recommended) | Cloudflare Pages (cold standby) | GitHub Pages (emergency mirror only) |
|---|---|---|---|
| Plan / cost | Spark: 10 GB storage, 360 MB/day transfer, "No payment method needed" | Free: 500 builds/month, 20,000 files; Workers Free is the default plan; no card seen in docs for Free (confirm at sign-up) | Free for public repositories; 1 GB site, soft 100 GB/month |
| Domain, HTTPS | `<project>.web.app`, `<project>.firebaseapp.com`, HTTPS automatic | `<project>.pages.dev`, HTTPS automatic | `<owner>.github.io/<repo>`, HTTPS |
| Deploy from Windows by a maintainer who pastes code | `firebase deploy --only hosting` (one line). CLI via `npm i -g firebase-tools` or the standalone Windows binary from firebase.tools (no Node needed). One-time `firebase login` + `firebase init hosting` | `npx wrangler pages deploy pwa/dist` (one line) or drag-and-drop the folder in the dashboard, no git needed | needs git push of the `dist` folder (or GitHub's web upload); repo must be public |
| Measured from Myanmar | `firebase.google.com` 2/2 OK; `web.app` itself not yet measured; same Google front-end infrastructure as `docs.google.com` (164/165) | not measured | `github.com` 326/355 with 8% anomalies; `github.io` not measured |
| Policy fit | fine | fine | Pages policy excludes "running an online business" and sites "primarily directed at commercial transactions"; a private POS is grey |
| Account | the business Google account that already owns the Sheet; no new identity | a Cloudflare account (email) | GitHub account |

Recommendation: deploy the same `pwa/dist` folder to Firebase (primary) and, once measured reachable, to Cloudflare Pages as a standby that the maintainer can switch to by sending the family a new link (the app has no hard-coded host; the API URL lives in `meta`). Custom domain is not required and not used (it would add DNS, cost, and one more thing to measure).

## What still has to be measured, and how

1. **Exact hosting domains**: `<project>.web.app`, `<project>.firebaseapp.com`, `<project>.pages.dev`. Method A, desk: OONI Explorer / MAT with `probe_cc=MM&test_name=web_connectivity&domain=<host>` (and `https://api.ooni.io/api/v1/aggregation?probe_cc=MM&test_name=web_connectivity&domain=<host>&since=2026-07-01&until=2026-11-02`); expect few or no measurements for a brand-new subdomain, in which case look at the parent zones (`web.app`, `firebaseapp.com`, `pages.dev`) and at the IPs' owners. Method B, field (decisive): the sister opens `https://<project>.web.app/ping.html` from both shops on the shop SIMs (MPT, ATOM, Ooredoo, Mytel as applicable) morning, noon, evening for three days; the page shows green and reports to `gas_api` `{op:'ping', carrier, rtt}`, so the maintainer sees the results in the Sheet without asking. Also run the free OONI Probe app once on each shop phone with these URLs added as a custom test list; that produces public measurements.
2. **`script.google.com` from the shop browsers (T7 in the plan)** for the sync endpoint, including the `script.googleusercontent.com` redirect target: the same `ping.html` does a real `op:'ping'` POST and shows the round-trip time; this is also test T11 (CORS/redirect from a browser).
3. **Drive thumbnails**: served through `gas_api` as base64, so no extra domain; if later served directly from `lh3.googleusercontent.com`, measure it first.
4. Re-measure quarterly and after any news of new blocks; the app's sync screen doubles as a live reachability monitor (last success time per phone, visible in the Staff tab `LastSyncAt`).

No VPN, no proxy, no third-party CDN scripts: every byte the phone loads comes from the hosting domain (fonts and jsQR self-hosted) or from Google Apps Script. Gemini is called only from Apps Script, as today.

---

# Screens

## Minimal screens (Burmese labels are drafts; every string lives in core_messages.js or pwa_i18n.js and can be overridden from the Messages tab)

1. **ချိတ်ဆက်ရန် (Pair)** - first run. Big field for the 6-digit code, [ချိတ်ဆက်]. Error: `ကုဒ် မမှန်ပါ · ဆိုင်ရှင်ကို မေးပါ`. Shown again if the server says the device is unpaired.
2. **Home screen ထည့်ပါ (Install first, iOS only)** - three pictures: Share icon → "Add to Home Screen" → ဆိုင် icon; small link `ခဏ မထည့်သေး`. On Android a one-line prompt uses `beforeinstallprompt`: `📲 ဖုန်းထဲ ထည့်မလား? [ထည့်မယ်]`.
3. **ပင်မ (Home / current card)** - header: shop name (`ဆိုင် ၁`), sync chip (`✓ ပို့ပြီး` / `⏳ ၃ ခု ပို့ရန်` / `⚠️ ၂ ရက် ကတည်းက မပို့ရသေး`), ⚙ for the sister. Body: the latest bot message as one large card with its inline buttons rendered 56 px tall (card, sold_done, confirm, credit, menu, all unchanged core texts). Below it `⌃ မှတ်တမ်း` (history). Bottom bar: [📷 ဖတ်] [🎤 ပြော] [☰ မီနူး]. Empty state: core's `menu` text `👋 ပစ္စည်း Tag ကို scan လုပ်ပါ။ ...`.
4. **မှတ်တမ်း (History)** - the familiar chat transcript, last 200 messages, read-only except buttons that are still valid (Undo within 30 min, receipt).
5. **Tag ဖတ်ရန် (Scanner)** - camera view with a square guide, `Tag ကို ဘောင်ထဲ ထားပါ`, torch toggle 🔦 where supported, [⌨️ နံပါတ် ရိုက်မယ်] and [✖️].
6. **နံပါတ် ရိုက်ရန် (Keypad)** - [ဆိုင် ၁ | ဆိုင် ၂] toggle, `S1-____` display, 0-9 keys 64 px, [ဖွင့်မယ်].
7. **မီနူး (Menu)** - core's `showMenu` buttons rendered as a grid: `📊 ဒီနေ့` `🕘 မကြာသေးမီ` `🔍 ရှာ` `💰 ငွေလက်ခံ` `📥 စရံ` `🖨 စာရင်း` `📒 စာအုပ်` (if enabled) `❓ အကူအညီ`.
8. **🎤 ပြောရန် (Voice)** - hold-to-talk overlay: timer, waveform, `လွှတ်လိုက်ရင် ပို့မယ် · အပေါ်ဆွဲရင် ဖျက်မယ်`; after release the queued bubble `🎤 သိမ်းထားပြီ · အင်တာနက် ရရင် နားလည်ပါမယ်`.
9. **📸 ဓာတ်ပုံ (Photo)** - opened from a blank tag or from `📸` on a card: system camera via file input, preview, [သုံးမယ်] [ပြန်ရိုက်].
10. **🖨 စာရင်း (Reports)** - core's report menu (`📅 ဒီနေ့` `📆 ဒီလ` `📆 ပြီးခဲ့တဲ့လ` `📦 ကုန်စာရင်း` `💳 အကြွေးစာရင်း`); the chosen report rendered as tables on screen immediately (from `buildReport`), with [📄 PDF] (online) and [📤 ပို့မယ်] (Web Share).
11. **🧾 ဘောက်ချာ (Receipt)** - receipt text card with [📤 Viber/Telegram သို့ ပို့] [📄 PDF] [🖨 ပုံနှိပ်] (print via share sheet).
12. **🔄 ပို့ခြင်း (Sync)** - `နောက်ဆုံး ပို့ပြီး ၁၄:၃၀`, pending list in words, `🔒 သိမ်းဆည်းမှု: ခိုင်မြဲ / ⚠️ မခိုင်မြဲ`, [🔄 ယခု ပို့မယ်] [📤 ဖိုင်ထုတ်] and, under "problems", the last error in plain Burmese (`Google ကို မရောက်ပါ` / `ကုဒ် သက်တမ်းကုန်ပါပြီ`).
13. **⚙ ဆက်တင် (Settings, sister only)** - font size A/A+/A++, `ဓာတ်ပုံမပါ ကတ်` (text cards), `ဗားရှင်း 1.4.2`, [ဖုန်း ပြန်ချိတ်ဆက်] (re-pair), [💾 ဒေတာ အကုန် ထုတ်] (full export).
14. **Banners** - `✨ ဗားရှင်း အသစ် ရပြီ · [အခု ပြောင်းမယ်]`; `⚠️ ၂ ရက် ကတည်းက မပို့ရသေး · [ကြည့်မယ်]`; `📵 အင်တာနက် မရှိ · ဖုန်းထဲ သိမ်းထားပါမည်` (one-time toast, not a modal).

Everything the seller reads inside screens 3, 4, 7, 10 and 11 is produced by core_bot.js / core_report.js, identical to Telegram; screens 1, 2, 5, 6, 8, 12, 13, 14 are app chrome and new strings (about 40), to be reviewed by the family with the existing ~100 round-two strings.

---

# Install guide

## Install guide (plain language; the sister or the maintainer over a video call does this once per phone)

### Android (Chrome)
1. The maintainer sends the link `https://<project>.web.app` in Telegram. Tap it. It opens in Chrome.
2. Tap the three dots (⋮) at the top right → tap **"Install app"** (some phones say "Add to Home screen") → tap **Install**.
3. Close Chrome. Find the new icon **ဆိုင်** on the home screen. Open it from there from now on, never from Chrome.
4. The first screen asks for the 6-digit code. The maintainer reads it from the Staff tab. Type it, tap **ချိတ်ဆက်**.
5. Tap **📷 ဖတ်**: Android asks "Allow camera?" → **While using the app**. Hold **🎤** once: "Allow microphone?" → **While using the app**.
6. Wait for the chip at the top to show **✓ ပို့ပြီး**. The shop's items are now on the phone. Put the phone in airplane mode and scan a tag: the card must appear instantly. Turn airplane mode off.
7. If the phone is from a brand with aggressive battery saving (Xiaomi, Oppo, Vivo, Huawei, Realme): Settings → Apps → Chrome → Battery → **No restrictions** (so the app is not killed while syncing).

### iPhone (Safari)
1. Open the link in **Safari** (not inside Telegram's browser: if Telegram opened it, tap the compass/Safari icon at the bottom to move it to Safari). On iOS 16.4 or newer, Chrome works too, but keep it simple: Safari.
2. Tap the **Share** button (the square with an arrow, bottom middle) → scroll → **"Add to Home Screen"** → **Add**.
3. Close Safari. Open the **ဆိုင်** icon from the home screen. Always open it from the icon, never from Safari, otherwise the phone may wipe the saved data after a week of not visiting.
4. Enter the 6-digit code → **ချိတ်ဆက်**.
5. Tap **📷 ဖတ်**: "ဆိုင် would like to access the camera" → **Allow**. Hold **🎤**: microphone → **Allow**. (If iOS asks again later, tap Allow again; that is a known iOS quirk.)
6. Wait for **✓ ပို့ပြီး**, then do the airplane-mode test as on Android.
7. Do not delete the icon: deleting it deletes the saved data on that phone. If the phone must be reset, open the app first and make sure the chip shows **✓**.

### Both
- One phone per seller or one per shop, as today in the Staff tab; the code is per staff row.
- The Telegram bot keeps working on the same phone; if the app ever fails, scan the tag with the camera app and use Telegram exactly as before.
- When a banner says **✨ ဗားရှင်း အသစ် ရပြီ**, tap it when no sale is in progress. Nothing else to do.

## 10-minute training script for a seller (Burmese labels are drafts for the family to correct)

Minute 0-1: "This is the shop app. It works even without internet. Everything you do is saved in the phone and sent to the owner's sheet when the signal comes back. You never wait."

Minute 1-3, the sale: open the icon. Tap **📷 ဖတ်**, point at the tag. The card appears: picture, name, price, stock. Tap **ရောင်း ၁** (or ၂, ၃). It says **✅ ရောင်းပြီး ၁ ထည် · ၂၅,၀၀၀ ကျပ် · လက်ကျန် ၄**. Done, two taps. Do it three times with three tags.

Minute 3-4, mistake: tap **↩️ မှားသွားတယ်** under the reply. "Within 30 minutes. After that, tell the owner."

Minute 4-5, bargained price: **💬 စျေးလျှော့** → type 18000 → **ရောင်း**.

Minute 5-6, not fully paid: after the sale tap **💳 မကျေသေး** → how much paid now (0 / half / other) → customer name button or **✏️ နာမည်အသစ်**. "Later, when she pays, use ☰ → **💰 ငွေလက်ခံ**."

Minute 6-7, voice: hold **🎤**, say "ဒါ ၂ ထည် ရောင်းရတယ်", release. "If there is no internet it says 'saved, will understand later'. When it comes back you will see **✅ မှန်တယ် / ❌ မဟုတ်ဘူး**. Tap ✅ only if it is right."

Minute 7-8, tag lost or camera fails: **📷 ဖတ်** → **နံပါတ် ရိုက်မယ်** → type the 4 digits printed on the tag. Or ☰ → **🕘 မကြာသေးမီ** → tap the item.

Minute 8-9, the chip: "Green ✓ means everything is in the sheet. Yellow ⏳ ၃ means three things are waiting for signal; that is normal, keep selling. Red ⚠️ for a whole day: open the chip and tap **🔄 ယခု ပို့မယ်**, and tell the sister if it stays red."

Minute 9-10, the rules: never delete the icon; always open the app from the icon; if the app is broken, scan the tag with the camera and use Telegram like before. Give the laminated card: 📷 ဖတ် → ရောင်း ၁ → ✅.

---

# Risks

## Risks and how each is handled

1. **Browser → Apps Script sync blocked by CORS or the 302 redirect** (community-documented, not official). Mitigation: Phase 0 test T11 with `ping.html` from a shop phone before building the sync engine; plan B is a `doGet` JSONP pull plus `no-cors` POST with pull-to-confirm; plan C is routing the outbox through Telegram (the `.json` document import already in the design).
2. **The exact hosting domain (`web.app`) turns out unreachable or flaky from a carrier.** Mitigation: measure first (OONI + `ping.html` on shop SIMs over three days); Cloudflare Pages standby deployed in parallel; the app has no hard-coded host; the Telegram bot remains fully functional regardless.
3. **iOS storage eviction / data loss.** Safari tabs lose script storage after 7 days without a visit; home-screen apps have their own counter and WebKit treats deletion there as a bug, and iOS 17+ grants ~60% of disk. Mitigation: force the install screen on iOS when not standalone, request `persist()`, outbox acked-only deletion, red chip after 24 h, daily-summary footnote, export to Telegram. Residual: a phone reset with unsynced rows loses those rows; made visible, not silent.
4. **iOS camera/microphone permission quirks in standalone mode** (re-prompts, black camera after backgrounding). Mitigation: typed keypad fallback is always one tap away; voice is optional by design (buttons never need AI); test on a real iPhone in Phase 0.
5. **Safari records `audio/mp4` (AAC); Gemini lists `audio/m4a`/`audio/aac`, not `audio/mp4`.** Mitigation: server relabels to `audio/m4a`; Phase 0 test with three real Safari recordings; fallback is a WAV encoder in the app (bigger files, still fine at 30 s).
6. **No BarcodeDetector on iOS and on Android phones without Play Services.** Mitigation: jsQR fallback is the default path; it decodes a printed QR in well under a second on 2018-era phones; QR error correction M on the tags helps.
7. **Two phones selling the same SKU offline → negative stock, or both editing an item's price.** Append-only ledger means no data loss; stock shows ⚠️ and the owner adjusts; item fields are last-writer-wins and rare. Receipt numbers are made collision-free per device (small core edit); customer ids are device-prefixed.
8. **Phone clock wrong** → rows land on the wrong day. Mitigation: server stores `receivedAt`; the app compares its clock with the server's at each sync and shows `⚠️ ဖုန်း နာရီ မမှန်ပါ` if off by more than 10 minutes.
9. **Apps Script quotas / slow reads.** Each sync reads the Ledger tab (seconds, in the background). ~1,000 executions/day for two phones is far below limits; if the Sheet grows past ~100k rows, archive yearly tabs (already in the plan) and the pull cursor keeps working.
10. **Zawgyi phones / keyboards.** The self-hosted font makes the app's own text safe; typed input is detected and converted with myanmar-tools; T3 remains in Phase 0.
11. **Aggressive Android battery managers kill Chrome's background work.** The design never depends on background sync; sync happens while the app is open. Install guide step 7 relaxes battery limits anyway.
12. **Secrets on the phone.** The device key is per staff row, revocable from the Staff tab; the Telegram webhook secret and Gemini key never reach the phone. The API checks the key on every call and rate-limits pairing attempts (5 per hour per IP-less world: per code).
13. **Maintainer tooling drift.** Firebase CLI needs an occasional update; the standalone binary avoids Node version issues. `build_pwa.js` is plain Node like `build_simulator.js`; no bundler, no framework, so the project stays maintainable by any developer.
14. **Two UIs to keep consistent.** They share 100% of the conversation code; only app chrome differs. Any change to a Burmese string in the Messages tab reaches both at the next pull.
15. **Adoption.** The two-tap sale is faster than the notebook only if the app opens instantly and never waits; the design guarantees that for buttons. Voice and photos remain "send and forget". Keep the laminated three-step card and the 10-minute script; pilot in shop 1 first, as in the plan.

---

# Estimate

About 25 working days of maintainer time, delivered in six increments (each one leaves the family with something working; Telegram keeps running throughout):

1. Phase 0 for the app (3 days, before any build): `ping.html` on Firebase + `gas_api` ping op; measure `web.app`, `script.google.com` POST with text/plain from Chrome Android and iOS Safari in both shops (T11); OONI queries; three Safari voice recordings relabelled to m4a through Gemini; Zawgyi check (T3) on each phone. Go/no-go decided here.
2. Server endpoint (4 days): `gas_api.js` (pair, push with TxID dedupe and LockService, pull with row cursor and table hashes, voice/photo/pdf/thumb ops, ping), Staff/Ledger column additions in `gas_setup.js`, `applyOps` reused by a Telegram `.json` import, summary footnote for stale devices, `probeApi()`.
3. Phone data layer (5 days): `pwa_db.js`, `pwa_ports.js` (memory mirror + write-through), `pwa_sync.js` (outbox, backoff, schedule, export), the two small core edits (receiptNo, nothing else), `run_scenario_pwa.js` passing the existing 109 checks through the new ports with fake-indexeddb.
4. UI (4 days): `pwa_ui.js` lifted from `sim_ui.js` (current card, history, menu grid, keypad, sync screen, settings, banners), fonts, big-type CSS, manifest, icons, pairing and install screens.
5. Camera, microphone, photo, service worker (4 days): `pwa_scan.js` (BarcodeDetector + jsQR, tag URL parser), `pwa_media.js` (hold-to-talk MediaRecorder with mime negotiation, photo capture and downscale), `sw.js` (precache, photos cache, update banner flow), `build_pwa.js`, `firebase.json`, first deploy.
6. Device testing and pilot (5 days): Android (one cheap phone) and iPhone standalone tests of install, persistence, airplane-mode sale, undo, voice queue, update banner; Burmese review of ~40 new app strings with the family; install both shop phones over a video call; one week of pilot in shop 1 with daily reading of Errors and the sync columns; then shop 2.

Calendar: 6-8 weeks part-time from abroad. Cost: 0 USD recurring; one-time nothing new (the Gemini paid tier already discussed in the plan is unchanged). Optional later (not in the 25 days): Cloudflare standby deploy (half a day), Background Sync on Android (half a day), per-seller phones and a PC console, which the same bundle already supports since it is a web page.
