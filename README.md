# SalesTagBot: a POS for family clothing shops in Myanmar

Three faces of one program, all in Burmese, all running the same shared core:

- **The Telegram bot** on Google Apps Script + Google Sheets: the owner's channel, and the sellers' backup.
  A scanned QR tag opens an item card with buttons; the Sheet is the database.
- **The phone app** (an installable PWA): the sellers' daily tool. Scan a tag, fill one form, Save. It works
  with no internet, keeps the shop's data on the phone and syncs with the Sheet when the connection is there.
- **The simulator**: the whole system (both shops, every role, phone and laptop, the Sheet) in one HTML file,
  for trying every function before anything is published.

A worker can enrol directly in the phone app with a code from the owner or access administrator. Telegram remains available for the existing bot and scheduled messages.
The plan, the history of every design round and the build status live in [POS-PROJECT-PLAN.md](POS-PROJECT-PLAN.md)
(Appendix F is the build log).

## Installation and deployment

Use the [installation manual](docs/INSTALL-AND-DEPLOY.md) or [download the printable PDF](docs/INSTALL-AND-DEPLOY.pdf). Page 1 is the Burmese phone handout. Pages 2–4 cover owner setup, deployment and release checks.

## Shops, staff and closing the books

The owner can open **Settings → ဆိုင် ဖွင့် / ပိတ်** to add a shop, change its name, address or phone number, or close it. S1 and S2 are the initial shops. A new shop receives 20 blank tag records. Its shop number stays with historical transactions.

Open **Settings → ဝန်ထမ်းနှင့် သုံးခွင့်** to assign a worker one or more jobs, a primary shop and additional shops. Use an app-only staff number such as `W-001`, or the worker’s Telegram user ID when linking that account. Give the worker the single-use phone enrolment code. The owner appoints access administrators. An access administrator can manage ordinary staff across the business.

| Job | Work in the phone app |
| --- | --- |
| Seller | Scan and record sales offline. Send stock to another shop or confirm its arrival while online. |
| Designer | Register pieces and samples, leave the selling price pending, and attach a photo. |
| Tailor | Find an open voucher, check the due date, record measurements and update progress. |
| Bookkeeper | Record an expense against a shop and payment account, check balances and print reports. |
| Report reader | Read and print reports for assigned shops. |
| Access administrator | Assign jobs and shops, disable accounts and issue phone enrolment codes. |
| Owner | Review all shops, manage their details, assign access administrators and use the operational screens. |

For a new installation, set up the first owner using the [Apps Script setup guide](apps-script/README.md). Create each worker through the app’s staff screen and assign their jobs and shops before issuing an enrolment code. Those assignments apply on the worker’s first sign-in.

For a closing report, open **ဆိုင်စာရင်း ကြည့်မယ်**, choose the day, month or year, and select a shop if needed. The first page shows sales after refunds, money received and paid, outstanding balances, costs and profit or loss in kyat. **အသေးစိတ် ကြည့်မယ်** opens the shop, category, payment, product, transfer and transaction tables. **ပုံနှိပ်မယ်** prints the selected view. An offline seller’s copy uses the phone’s local records and carries a provisional notice. Management, workshop, bookkeeping, shipment and shared report screens use the server.

For a partial transfer, enter the sending tag, quantity and destination. The receiver chooses a blank tag belonging to the destination and confirms the quantity shown. A shipment in transit appears on the report before it appears in the receiving shop’s stock.

## What is in this repository

| Folder | What | Notes |
| --- | --- | --- |
| `apps-script/core_*.js` | The shared core: ledger, bot conversation, orders and measurements, reports and receipts, sync protocol, Burmese text, config. | Platform-free ES5. Runs unchanged in the bot, the app and the simulator. |
| `apps-script/gas_*.js` | The Google glue: Sheets, Telegram, Gemini, PDF, import, webhook, triggers, setup, sync endpoint. | `node tools/bundle_gas.js` joins everything into `apps-script/dist/Code.gs`. |
| `app/` | The phone app: store (IndexedDB), ports, sync client, forms, screens, scanner, sketch, icons, Burmese UI strings. | `node tools/build_app.js` writes `app/dist/`, the folder Firebase Hosting serves. Test bench on the PC: `app/dev/index.html`. See [app/README.md](app/README.md). |
| `poc/` | The simulator (`build_simulator.js` → `poc/dist/pos-simulator.html`) and the nine automated suites. | In-memory ports, demo data, a rule-based stand-in for Gemini. |
| `tools/` | `publish.js` (publishes the bot and the app from this PC), the two bundlers, `make_tags.py` (A4 PDF of QR hang tags), `make_icons.js`, `fetch_fonts.js`, `score_voice.js`. | Setup of the publish tool: [docs/AUTO-PUBLISH-SETUP.html](docs/AUTO-PUBLISH-SETUP.html). |
| `docs/` | [USER-GUIDE.html](docs/USER-GUIDE.html) for the sellers and the owner (Burmese first), `system-map.html`, and `design-round-2` … `design-round-6`: briefs, specs, designs, reviews and the owner's feedback for every round. | `docs/USER-GUIDE.pdf` is older than the HTML. |

## Development status

The project is in development and has no shop users as of 24 November 2026. The simulator uses sample staff and transactions.
- **Built and verified, not yet published:** rounds 4, 5, 6, 6b and 6c (lists, bank accounts and split payments,
  the one-screen forms, a sale of several pieces, the phone's back button, buyers and history pages, receipts,
  the measurement form with its figure, the Shops screen, growable item categories, in-app questions instead of
  the phone's own dialog boxes, camera notes). They go out together once the owner has approved them in the
  simulator; the release order is in Appendix F of the plan.

## Build and test

Builds (plain Node, no packages to install):

```bash
node tools/bundle_gas.js
node tools/build_app.js
node poc/build_simulator.js
```

Suites: every one prints `passed / failed` and exits non-zero on a failure. On 2026-11-19 all nine passed, 3,074 checks.

```bash
node poc/run_scenario.js
node poc/run_round4.js
node poc/run_lists.js
node poc/run_gas.js
node poc/run_sync.js
node poc/run_shop_workflows.js
node poc/run_app.js
node poc/run_wizard.js
node poc/check_simulator.js
node poc/check_simulator_browser.js
```

`check_simulator_browser.js` drives the built simulator in headless Chrome; the rest run without a browser.
Everything in `apps-script/`, `app/` and `poc/` stays ES5 so it runs on the shops' older Android phones; check a
file with `npx --yes acorn@8 --ecma5 --silent <file>`.

To try the simulator, open `poc/dist/pos-simulator.html` in a browser: no server, no keys. To try the app on the
PC, serve the project folder (`python -m http.server 8080`) and open `http://localhost:8080/app/dev/index.html`.

## Going live and operating

- [apps-script/README.md](apps-script/README.md): installing the bot (the Sheet, the Apps Script project, BotFather, the webhook), step by step.
- [app/README.md](app/README.md): how the app works, enrolling a phone, hosting on Firebase.
- [docs/AUTO-PUBLISH-SETUP.html](docs/AUTO-PUBLISH-SETUP.html): `tools/publish.js`, which publishes the bot (clasp) and the app (Firebase Hosting) and logs each publish to `tools/publish-log.jsonl` on the publishing PC (not in the repository).
- [docs/AI-RELEASE.md](docs/AI-RELEASE.md): letting an AI agent publish a release: where it may run, what access it needs, the rules, the release steps, rollback and troubleshooting. **An AI asked to publish reads this first.**
- [docs/USER-GUIDE.html](docs/USER-GUIDE.html): the guide for the people in the shops.

## Secrets and private files

Nothing secret is in this repository. The bot token, the Gemini key, the webhook secret and the device tokens live
in the Apps Script project's Script Properties (and a password manager). `app/config.js`, `tools/publish.config.json`,
`.firebaserc` and `apps-script/.clasp.json` hold only the public identifiers of this deployment: the `/exec` address
is the same one Telegram calls as a webhook, and every app request carries a per-device token checked by the server.
`tools/build_app.js` refuses a bundle that contains a secret-looking string.

The family's private notes (`acc.txt`, `survey.txt`) are excluded by `.gitignore` and belong outside the project
folder. Keep the repository private: the documents name the shops and the people who work in them.

`.gitattributes` keeps every file byte for byte (no line-ending conversion), so a clone runs the suites on exactly
the bytes this PC does.

## Architecture in one paragraph

Telegram calls `doPost` in `gas_main.js`; `processUpdate` in `core_bot.js` deduplicates on `update_id`, checks the
Staff list, then routes: `/start <tag>` shows the item card, button taps append ledger rows under a lock and get an
undo button, a photo on a blank tag registers a new unique piece. The phone app runs the same core against a copy of
the data in IndexedDB: a scan opens the sale form, Save writes the rows on the phone first, and `app_sync.js` sends
them to the Sheet through the same `/exec` address (`core_sync.js` / `gas_sync.js`) and pulls what changed: sales made
through Telegram, new prices, the other shop's rows. Stock is never stored; it is a sum over the append-only Ledger
tab. A daily trigger posts the summary to the family group, a monthly one sends the month's report and a weekly one
copies the Sheet.
