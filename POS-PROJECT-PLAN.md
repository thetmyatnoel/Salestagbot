# Chat-based POS for two clothing shops in Myanmar

Assessment and build plan. Written 2026-09-06.

Stack: Telegram bot + Google Apps Script + Google Sheets + Gemini API. Zero monthly cost, no server, the family only ever touches Telegram.

---

## 1. Verdict on the current design

The architecture is right and should be kept. Apps Script as the webhook target, Sheets as the database, Telegram as the only UI, and Gemini for Burmese audio and photos is the cheapest serious way to build this, and it is a pattern many working bots already use.

What the current plan under-specifies, and what this document fixes:

| Gap in the current plan | Fix |
| --- | --- |
| Voice is the only input, so every sale waits on an AI round-trip | Buttons first, voice second. One tap logs the common case; voice handles the messy cases. |
| An AI mis-hear becomes a wrong row silently | Voice results are shown back and committed only after a tap. Button actions commit instantly but get an Undo button. |
| Stock is updated in place, which races between two shops and hides mistakes | Append-only ledger. Stock is a formula over the ledger. Corrections are reversing rows, never edits. |
| Anyone who scans a tag in the shop can talk to the bot | Staff allowlist by Telegram user id. Strangers get nothing. |
| Public web app URL with no secret, and Apps Script cannot read request headers | Secret in the webhook URL query string, checked in doPost. |
| Telegram retries any update that does not get a 200 | Always return 200, deduplicate on update_id, log errors to a sheet. |
| AI outage stops the shop | Buttons never touch AI, so the shop keeps running when Gemini is down or the quota is hit. |
| AI "suggests a base price" from a photo | AI names and categorizes; the sister sets the price from preset buttons. Pricing is her knowledge, not the model's. |
| No expenses, returns, or transfers, so P&L is incomplete | Intents: SALE, RESTOCK, RETURN, EXPENSE, TRANSFER, ADJUST, QUERY, NEW_ITEM. |
| Everything hangs on one personal Google account | Dedicated business Google account, 2-step verification, code in git via clasp. |
| Telegram-specific code everywhere | Keep the Telegram calls in one file so a switch to Viber is days, not a rewrite. |

---

## 2. Target architecture

```text
 [Pre-printed QR hang tag: S1-0042]
            │  phone camera → https://t.me/<bot>?start=S1-0042
            ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Telegram (only thing the family sees)                       │
 │ • START → item card with photo, price, stock, buttons       │
 │ • Tap [Sold 1] [Sold 2] [Sold 3]  → instant, Undo button    │
 │ • Or send voice / photo / text    → AI path, confirm button │
 │ • 21:00 daily summary posted to the family group            │
 └──────────────────────────────┬──────────────────────────────┘
                                │ webhook POST  …/exec?token=SECRET
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Google Apps Script (deployed as web app, runs as owner)     │
 │ doPost: check secret → dedupe update_id → allowlist staff   │
 │         → route: /start | callback | voice | photo | text   │
 │ telegram.gs   one file, all Telegram calls                  │
 │ gemini.gs     one file, all Gemini calls                    │
 │ ledger.gs     append rows under LockService, never edit     │
 │ reports.gs    daily summary trigger, low-stock, backup      │
 └──────────────┬──────────────────────────────┬───────────────┘
                │ only for voice / photo       │ every action
                ▼                              ▼
 ┌──────────────────────────────┐  ┌───────────────────────────┐
 │ Gemini API (Flash-Lite)      │  │ Google Sheet              │
 │ audio/ogg inline → JSON      │  │ Items, Ledger, Staff,     │
 │ photo → name/category JSON   │  │ Settings, Errors,         │
 │ temperature 0, schema forced │  │ Dashboard (formulas only) │
 └──────────────────────────────┘  └───────────────────────────┘
                                             │
                                   Google Drive: item photos,
                                   weekly backup copies of the Sheet
```

Nothing in Myanmar talks to Google directly. The phones only need Telegram. Apps Script and Gemini run in Google's data centers, so Gemini API region rules apply to your developer account, not to the shops.

---

## 3. Data model (Google Sheet tabs)

**Items** — one row per tag.

| Column | Notes |
| --- | --- |
| ItemID | `S1-0042`. Shop prefix + 4 digits. Pre-generated, printed as QR. |
| Shop | S1 or S2 |
| Name | Burmese, e.g. ထမီ ချည်သား အနီ |
| Category | ထမီ / လုံချည် / အင်္ကျီ / ဝတ်စုံ / other. Fixed list in Settings. |
| Type | UNIQUE (one hand-sewn piece, stock 0 or 1) or SKU (counted stock) |
| Price | integer MMK |
| Cost | integer MMK, optional. Blank means "unknown" in P&L. |
| PhotoURL | Drive link |
| Status | formula: BLANK if no Name, SOLD if UNIQUE and Stock ≤ 0, else ACTIVE |
| Stock | formula: `=SUMIFS(Ledger!Qty, Ledger!ItemID, A2)` |
| CreatedAt, CreatedBy | set by the bot |

**Ledger** — append-only, one row per event. Never edited by hand.

| Column | Notes |
| --- | --- |
| TxID | `Utilities.getUuid()` |
| Time | Telegram message time in Asia/Yangon, not processing time |
| Shop, ItemID | ItemID blank for EXPENSE |
| Type | SALE, RESTOCK, RETURN, EXPENSE, TRANSFER_OUT, TRANSFER_IN, ADJUST |
| Qty | signed: sale −2, restock +10, undo of a sale +2 |
| UnitPrice, Amount | Amount = what money actually moved |
| CostAtSale | copied from Items at the moment of sale so later cost edits do not rewrite history |
| Note, Source | Source = BUTTON / VOICE / PHOTO / TEXT / UNDO |
| Transcript | what Gemini heard, for debugging and prompt tuning |
| StaffID, UpdateID, ReversesTxID | UpdateID for dedupe, ReversesTxID for undo |

Section 12.2 adds three columns (Paid, CustomerID, RefGroupID), three row types (PAYMENT, DEPOSIT, DEPOSIT_APPLIED) and the Customers, Credits and Deposits tabs, so that a sale and the money for it can land in different months.

**Staff** — TelegramUserID, Name, DefaultShop, Role (owner/staff), Active. The allowlist.

**Settings** — key/value: shop names, bot username, family group chat id, summary hour, low-stock threshold, category list, price presets per category, Gemini model name.

**Messages** — key → Burmese text for every bot reply and button label. The sister can fix wording here without any code change.

**Errors** — Time, Where, Message, UpdateID, Payload. Checked weekly by you.

**Dashboard** — formulas only: today and this month per shop: revenue, pieces sold, expenses, gross profit, low-stock list, top items. You look at this from Korea. The family never needs to.

Secrets (bot token, Gemini key, webhook secret, web app URL) live in Script Properties, never in a sheet or in code.

---

## 4. Interaction design

### 4.1 Sale by button (the 90% path)

1. Scan the tag with the phone camera. Telegram opens the bot with a START button.
2. Tap START. Bot sends `/start S1-0042` for her and replies with the item card:
   photo, name, price, stock, and buttons `[ရောင်း ၁] [ရောင်း ၂] [ရောင်း ၃]` on row one, `[ကုန်ရောက်] [ပြန်အမ်း] [စျေးလျှော့]` on row two.
   For UNIQUE items the first row is just `[✅ ရောင်းပြီး]`.
3. Tap `ရောင်း ၂`. The bot appends the ledger row and edits the card to
   `✅ ရောင်းပြီး ၂ ထည် · ၅၀,၀၀၀ ကျပ် · လက်ကျန် ၁` with one button `[↩️ မှားသွားတယ်]`.
4. Undo appends a reversing ADJUST row and restores the card. Undo is allowed for 30 minutes.

Two taps after the scan. No AI call. Works in about two to four seconds.

### 4.2 Sale or anything else by voice

1. Scan and START as above, or skip the scan if the last scan was under 10 minutes ago.
2. Record a voice note: "ဒါ ၂ ထည် ရောင်းရတယ်" or "တစ်ထည် နှစ်သောင်းနဲ့ ရောင်းလိုက်တယ်" (sold one at 20,000).
3. Bot replies with what it understood and two buttons:
   `🎤 "ဒါ ၂ ထည် ရောင်းရတယ်" → ရောင်း ၂ ထည် · ထမီ အနီ · ၅၀,၀၀၀ ကျပ်` `[✅ မှန်တယ်] [❌ မဟုတ်ဘူး]`
4. Tap ✅ to commit. ❌ shows the button card instead.
5. If Gemini errors or the free quota is exhausted, the bot says it could not hear and shows the button card. The shop never stops.

Voice notes recorded offline are queued by Telegram and delivered when the phone reconnects. Time is taken from the message, so the ledger stays correct.

### 4.3 Register a new hand-sewn piece by photo

1. Attach a blank pre-printed tag (status BLANK) and scan it. Bot: "🆕 Tag အသစ်ပါ။ ဓာတ်ပုံ ပို့ပါ" (new tag, send a photo).
2. She sends a photo, with an optional voice note or caption.
3. Gemini returns name, category, color, and a one-line description. The photo is saved to Drive.
4. Bot shows the proposed name and asks the price with preset buttons drawn from that category's existing prices, plus "other". Then cost, with a skip button.
5. Bot writes the Items row, appends RESTOCK +1, and replies with the finished item card.

The AI proposes the name and category. The human sets the money.

### 4.4 Other intents

| Intent | How it is entered | Example |
| --- | --- | --- |
| RESTOCK | button or voice on a SKU tag | "ဒါ ၁၀ ထည် ရောက်တယ်" |
| RETURN | button on the item card | customer brings a piece back |
| EXPENSE | voice or text, no scan | "အထည်ဖိုး သုံးသောင်း ပေးလိုက်တယ်" (paid 30,000 for fabric) |
| TRANSFER | button "send to other shop" on the card | moves stock S1 → S2 |
| QUERY | voice or text | "ဒီနေ့ ဘယ်လောက်ရောင်းရလဲ" (how much sold today?) |
| Menu | `/start` with no tag | buttons for today's total, find item, help |
| PAYMENT | menu button, or voice | "ဒေါ်မြင့် ငါးသိန်း ပေးသွားတယ်" (Daw Myint paid 500,000), see section 12.2 |
| DEPOSIT | menu button, or voice | advance for a custom order, see section 12.2 |
| RECEIPT | button on the card after a sale | receipt message for the customer, see section 12.5 |
| REPORT | menu button | PDF for printing, see section 12.3 |

Burmese strings above are drafts. Have your sister rewrite every label in the Messages tab before the pilot. The bot reads labels from there.

### 4.5 Daily summary

A time trigger at 21:00 Asia/Yangon posts to the family group:

```text
📊 ၆ စက်တင်ဘာ
ဆိုင် ၁ · ရောင်းရငွေ 325,000 · ၁၃ ထည် · ကုန်ကျ 20,000 · အမြတ် ~118,000
ဆိုင် ၂ · ရောင်းရငွေ 140,000 · ၆ ထည် · ကုန်ကျ 0 · အမြတ် ~52,000
⚠️ လက်ကျန်နည်း: ထမီ အနီ (1), လုံချည် စစ် (2)
```

Gross profit uses CostAtSale where known and says how many pieces had no cost. A weekly and a monthly version go to the owner only.

---

## 5. AI layer

Model: the cheapest Flash-Lite that passes the Phase 0 test. Google's pricing page today lists `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite` and `gemini-3.5-flash-lite` with free tiers, plus full Flash models. Put the model name in Script Properties so changing it is a settings edit, not a code change.

Request shape for voice: inline `audio/ogg` bytes plus a text part with context, temperature 0, `responseMimeType: application/json`, and a response schema. Telegram voice notes are OGG/Opus and Gemini lists both OGG and Opus as supported; a 10-second note is about 320 audio tokens.

Response schema:

```json
{
  "type": "object",
  "properties": {
    "intent": { "type": "string", "enum": ["SALE","RESTOCK","RETURN","EXPENSE","TRANSFER","QUERY","NEW_ITEM_INFO","UNKNOWN"] },
    "qty": { "type": "integer", "nullable": true },
    "unit_price": { "type": "integer", "nullable": true },
    "amount": { "type": "integer", "nullable": true },
    "item_hint": { "type": "string", "nullable": true },
    "note": { "type": "string", "nullable": true },
    "transcript": { "type": "string" },
    "confidence": { "type": "number" }
  },
  "required": ["intent", "transcript", "confidence"]
}
```

System instruction, draft:

```text
You parse short Burmese voice notes from staff at a clothing shop in Myanmar into one JSON object.
Context gives the currently scanned item (id, name, price, stock, type) and the staff member's shop.
Rules:
- Quantities count garments. The classifier ထည် marks pieces. Default qty is 1 for SALE on a UNIQUE item.
- Convert Burmese number words to integers: ဆယ်=10, ရာ=100, ထောင်=1000, သောင်း=10000, သိန်း=100000, သန်း=1000000.
  Example: နှစ်သောင်းငါးထောင် = 25000. Output all numbers as plain integers.
- Money is Myanmar Kyat. A per-piece price goes in unit_price; a total goes in amount.
- transcript is the verbatim Burmese in Unicode.
- If the note is unclear, not about the shop, or you are guessing, set intent UNKNOWN and confidence below 0.5.
Examples:
"ဒါ ၂ ထည် ရောင်းရတယ်" → {"intent":"SALE","qty":2}
"ဒါ ၁၀ ထည် ရောက်တယ်" → {"intent":"RESTOCK","qty":10}
"တစ်ထည် နှစ်သောင်းနဲ့ ရောင်းလိုက်တယ်" → {"intent":"SALE","qty":1,"unit_price":20000}
"အထည်ဖိုး သုံးသောင်း ပေးလိုက်တယ်" → {"intent":"EXPENSE","amount":30000,"note":"fabric"}
"ဒီနေ့ ဘယ်လောက်ရောင်းရလဲ" → {"intent":"QUERY","note":"today_sales"}
```

The examples are the most valuable part of the prompt. Replace them with real phrases your sister actually uses, collected in Phase 0, and add shop vocabulary such as garment names and fabric words.

Photo prompt: return `{name, category (from the fixed list), color, description}` as JSON. Do not ask for a price.

Commit rule: confidence below 0.7 or intent UNKNOWN never reaches the confirm screen; the bot shows the button card instead.

---

## 6. Security and reliability rules

1. Bot token, Gemini key, webhook secret in Script Properties. Never in a sheet, never in git.
2. Webhook URL is `.../exec?token=<long random secret>`. doPost returns 200 and does nothing if the token is wrong. Apps Script cannot read headers, so Telegram's `secret_token` header option cannot be used; the query string is the substitute.
3. Allowlist by Telegram user id from the Staff tab. Unknown users are logged to Errors with their id so you can add them, and get no reply or a one-line "staff only" message.
4. doPost always returns 200, even on exceptions. Errors go to the Errors tab. Otherwise Telegram re-sends the same update forever and the bot wedges on one bad message.
5. Answer Telegram with an HTTP 200, which in Apps Script means HtmlService output, not ContentService (ContentService answers with a 302 redirect, and Telegram's webhook client neither follows redirects nor accepts anything but 200 to 299; it then re-sends the same update for 24 hours and holds that chat's later messages behind it). Deduplicate on update_id twice: CacheService for 6 hours and a durable list of the last 400 ids in a Script Property. See section 13.1.
6. Answer every callback query immediately with answerCallbackQuery, then do the work, then edit the message to remove the buttons so a double tap cannot double-log.
7. Wrap ledger appends in LockService so two shops posting at the same second do not interleave.
8. Never delete or edit ledger rows from code. Undo and corrections are reversing rows.
9. Protect the Ledger and Items tabs so only the owner account can edit by hand.
10. Deploy as "Execute as: Me", "Who has access: Anyone". After code changes, edit the existing deployment and create a new version. Creating a new deployment changes the URL and silently breaks the webhook.
11. Project timezone `Asia/Yangon` in appsscript.json, so "today" and the 21:00 trigger are right.
12. Weekly trigger copies the Sheet to a Backups folder in Drive and keeps the last eight.
13. Dedicated Google account for the business, 2-step verification on, recovery phone that a family member controls. You are the maintainer; the family knows where the account details are kept.
14. Code lives in a git repo and is pushed with clasp. The browser editor is not the source of truth.
15. Two bots and two sheets: a dev bot you test with and the production bot the family uses.

---

## 7. Phase 0: validate before building (2 to 3 days)

Do these before writing the real bot. Each one can kill or reshape the design.

| # | Test | How | Pass condition |
| --- | --- | --- | --- |
| T1 | Telegram works on the family's phones and SIMs without a VPN | Create the bot with BotFather, send the link, have both shops send a voice note at morning, noon, and evening | Voice notes arrive via getUpdates, all three times |
| T2 | Gemini understands the sister's Burmese | Collect 30 real voice notes covering every intent, recorded in the shop with normal noise. Run them through a throwaway script against Flash-Lite and full Flash | ≥ 90% correct intent + quantity + amount. Under 80%: ship buttons-only and use voice for notes, or route audio through Google Cloud Speech-to-Text `my-MM` and let Gemini parse the text |
| T3 | Phones render Unicode Burmese | Bot sends a Burmese message; family screenshots it | Readable. Garbled means the phone is on Zawgyi and must be switched to Unicode |
| T4 | QR deep link opens the bot | Print one tag on paper, scan with the phone camera app | Telegram opens with a START button, and the bot receives the item id |
| T5 | Round-trip latency from Myanmar | Time scan → item card | Under 5 seconds for buttons, under 15 for voice |

T1 note (updated 2026-10-31): OONI network measurements run from inside Myanmar between July and October 2026 show Telegram reachable: 2,485 tests, 1.2 percent anomalies, no confirmed blocking. The election-period study by Human Rights Myanmar, also built on OONI data, found Telegram the least-blocked messenger at 5 percent, against 97 to 98 percent for WhatsApp, Signal and Messenger. Vendor "censorship maps" that list Telegram as blocked contradict these measurements. Still test on the family's own SIMs; the picture can change without notice. See section 12.1.

---

## 8. Build plan

### Week 1: skeleton with buttons, no AI

- Create the business Google account. Create the Sheet with the tabs in section 3. Seed five test items.
- Create the Apps Script project, install clasp, `clasp clone`, init git.
- Write doPost with secret check, dedupe, allowlist, routing, error logging (Appendix A).
- `/start <id>` shows the item card. Sale, restock, return buttons append ledger rows. Undo works.
- Deploy, run `registerWebhook()`, test from your own phone with a printed test QR.
- Done when you can scan a test tag in Korea and log a sale in under 5 seconds, and the Errors tab stays empty.

### Week 2: AI paths

- Voice note → Gemini → JSON → confirm screen → commit. Expense and query intents.
- Photo on a BLANK tag → name and category proposal → price presets → item created, photo in Drive.
- Graceful fallback when Gemini fails or the quota is hit.
- Replay the 30 Phase 0 voice notes through the real bot.
- Done when 27 or more of the 30 land on a correct confirm screen.

### Week 3: reporting, tags, hardening

- Stock and status formulas, Dashboard tab, daily summary to the family group, low-stock line, weekly backup, monthly owner report.
- Generate the tag PDF: about 200 blank tags per shop plus tags for existing stock. Send it to the family to print at a local shop on card stock or sticker paper. Hang tags with string survive better than stickers on fabric.
- One laminated card per shop with three pictures: scan, tap START, tap a number. One-minute screen recording in Burmese.
- Done when a simulated day of 50 mixed transactions produces a correct summary and correct stock.

### Week 4 onward: pilot in shop 1, then shop 2

- Enter shop 1's current stock. Fastest: she photographs each piece with its new tag, and you or the bot fill names and prices.
- Run one to two weeks. Read the Transcript column and Errors tab every few days. Move real phrases into the prompt examples. Let her rewrite labels in the Messages tab.
- Roll out to shop 2 once shop 1 goes three days without a correction.

---

## 9. Costs and quotas

Monthly cost:

| Item | Cost |
| --- | --- |
| Google Sheets, Apps Script, Drive | 0 |
| Telegram Bot API | 0 |
| Gemini free tier | 0. The per-account daily quota is shown in AI Studio under rate limits. Free-tier prompts may be used to improve Google products. |
| Gemini paid tier, worst case 100 voice notes a day on 2.5 Flash-Lite | about 1 USD |
| Gemini paid tier, same load on a full Flash model | about 3 to 4 USD |
| Tag printing at a local print shop | one-time, a few thousand MMK |

The paid tier is worth turning on before the pilot even if the free quota is enough. It removes the daily cap as a failure mode and the paid tier does not use your data for training.

Apps Script limits on a consumer account, against expected load of 200 transactions a day:

| Quota | Limit per day | Expected use |
| --- | --- | --- |
| URL Fetch calls | 20,000 | about 1,200 |
| Trigger runtime | 90 minutes | under 2 minutes |
| Single execution | 6 minutes | under 20 seconds |
| Simultaneous executions | 30 | 2 |

The Sheet grows by roughly 3,000 ledger rows a month. Formulas stay fast for years; archive the ledger to a yearly tab if the Dashboard ever slows down.

---

## 10. Operations runbook

| Situation | Action |
| --- | --- |
| Weekly | Open the Errors tab. Empty is normal. |
| Monthly | Check Gemini usage in AI Studio. Skim the Transcript column for repeated mis-hears and add them as prompt examples. |
| Google renames or retires a model | Change GEMINI_MODEL in Script Properties. No code change. |
| Bot stops answering | Run `webhookStatus` from the script; it shows last_error_message and pending_update_count. Usual cause: a new deployment URL. Re-run registerWebhook. |
| Bot repeats the same message every hour, or goes silent with an empty Errors tab | Telegram is re-sending an update it did not accept. Run `probeWebhookResponse`: it must print HTTP 200. If not, the reply is not going through HtmlService (section 13.1). Fix, publish a new version, run `registerWebhook` (drops the backlog). Three minutes after any message, `webhookStatus` must show pending_update_count 0. |
| A wrong row got in | Add a reversing row from the bot's Undo, or by hand in a matching ADJUST row. Never delete. |
| Telegram becomes unreachable in Myanmar | Not Viber: Viber chatbots carry a EUR 100 monthly fee under the commercial model in force since February 2024. Plan B is a small web app served by Apps Script itself (same QR tags, same buttons, a PIN instead of a Telegram account); Google domains measure as reachable from Myanmar. See section 12.1. All Telegram calls are in one file, so the rest of the system is untouched. |
| New family member | They open the bot and press START. Their id appears in Errors. Add it to Staff. |
| You are unavailable | The Sheet keeps working with no code at all. The family can read it, and any developer can pick up the repo. |

---

## 11. Later, once the pilot is stable

- Find an item by name or by photo without scanning, for tags that fall off.
- Payment method per sale: cash, KBZPay, WavePay. Useful for end-of-day cash reconciliation.
- The photo library becomes a customer-facing catalog, as a Telegram channel or a simple page.
- Multi-photo items and size or color variants under one design.
- Customer orders for custom pieces with a deposit and a due date.

---

## 12. What the shop said, and what changes (2026-10-31)

The shop today runs a paid POS with a barcode scanner, an Excel-style product list and a Bluetooth voucher printer. One sister is the only person who can operate it, so she enters every product and every sale herself, and the sellers write sales in a notebook instead. Six problems came back. Each ends with the decision.

### 12.1 Everything the family uses must work from Myanmar (their first priority)

What runs where, and whether it can be reached. Measurements are OONI tests run from inside Myanmar, July to October 2026.

| Piece | Runs where | Who must reach it | From Myanmar |
| --- | --- | --- | --- |
| Telegram app | the family's phones | the family, every day | Yes. 2,485 Telegram tests, 1.2 percent anomalies, no confirmed block. Least-blocked messenger in the election crackdown: 5 percent, against 97 to 98 percent for WhatsApp, Signal and Messenger. |
| Apps Script, Sheets, Drive | Google's data centers | the maintainer, occasionally. Never the family. | Yes. google.com 181 of 181 tests fine, docs.google.com 164 of 165, youtube.com 99 percent. |
| Gemini API | Google's data centers, called by Apps Script | nobody in Myanmar | Not offered in Myanmar, while every neighbor is on the list. The key is created once, from a supported country, by the maintainer. Daily operation never opens AI Studio. The API requests themselves leave from Google's own servers, not from any phone. |
| Claude | nowhere in the running system | nobody | Used only to write the code. |

Rules that follow:

1. Nothing on the Myanmar side may depend on a VPN. VPN use is criminalised and blocked there. The design never needs one.
2. The maintainer creates the Gemini key and, if wanted, the billing from outside Myanmar. Usage monitoring moves from AI Studio to the Errors tab and a weekly count of VOICE rows in the Ledger.
3. Plan B if Telegram is ever blocked is not Viber. Viber chatbots carry a EUR 100 monthly maintenance fee under the commercial model in force since February 2024. Plan B is a small web app served by Apps Script itself: the same QR tags open a page on script.google.com instead of Telegram, with the same buttons and a PIN instead of a Telegram account. Google is reachable per the measurements above. Voice recording inside that web app has to be verified before it is relied on; the button path works regardless.
4. Telegram's own proxy feature and other circumvention tools are off the table for the same reason as VPNs.

### 12.2 A sale in September, the money in October

Problem. A customer buys 1,000,000 kyat of goods in September, pays 500,000, and pays the rest in October. The current software knows only "a sale", so September and October are both wrong and the cash drawer never matches the screen. The same happens in reverse with deposits for custom orders: money arrives before the goods exist.

Decision. Record the sale and the money as separate events and show both every month.

- A SALE is recorded when the goods leave the shop, at the full price. This is the month's sales, and profit is computed on it: sales minus the cost of those goods minus expenses.
- Money is recorded when it arrives: with the sale (the Paid column), later (a PAYMENT row) or earlier (a DEPOSIT row).
- "Still owed" is the gap between the two. "Deposits held" is money received for goods not yet delivered.

The monthly report then reads, for the example above:

```text
September                                 October
Sales (goods out)      1,000,000          Sales (goods out)            0
Cash received            500,000          Cash received          500,000  (for September's sale)
Still owed               500,000  Daw M.  Still owed                   0
Profit                 on 1,000,000       Profit                 on 0
```

Both numbers are right, and the owner can see why they differ. If she prefers to call "cash received minus cash paid out" her profit, that line is on the same report.

Flows for the family:

| Moment | What they do |
| --- | --- |
| Sale not fully paid | After "Sold 1" the card has a third button next to Undo: `💳 မကျေသေး` (not fully paid). Tap it: "How much paid now?" with `[0] [half] [type a number]`, then "Who?" with the last customers as buttons or a typed or spoken name. The card then shows "owed 500,000 by Daw Myint". |
| Customer pays later | Menu `💰 ငွေလက်ခံ` (receive payment) lists open credits as buttons: name, balance, since when. Tap one, then `[all] [type a number]`. Or voice: "ဒေါ်မြင့် ငါးသိန်း ပေးသွားတယ်". |
| Deposit for an order | Menu `📥 စရံ` (deposit): who, how much, what for. When the piece is delivered, sell it as usual; the bot sees the customer holds a deposit and offers "use deposit 300,000?". |
| Report | Daily and monthly summaries gain four lines: cash received, still owed (with names), deposits held, and credits older than 30 days. |

Ledger changes: columns Paid, CustomerID and RefGroupID; row types PAYMENT (cash later, RefGroupID points at the sale), DEPOSIT (cash in advance) and DEPOSIT_APPLIED (deposit consumed by a sale; not cash). New tabs: Customers (ID, name, phone, note), Credits and Deposits (formula views of open balances). The intent enum in section 5 gains PAYMENT and DEPOSIT. Undo keeps working the same way: reversing rows.

Formulas the Sheet uses: sales = SALE and RETURN amounts; cash received = SALE Paid + PAYMENT + DEPOSIT; owed per sale = Amount minus Paid minus its PAYMENT rows minus its DEPOSIT_APPLIED rows; deposits held = DEPOSIT minus DEPOSIT_APPLIED.

### 12.3 The owner wants the table on paper

Problem. The owner does not use a computer, and print shops in Myanmar print from a PDF on a phone.

Decision. The bot makes the PDF and sends it into the chat.

- Menu `🖨 စာရင်း` (reports): `[Today] [This month] [Last month] [Stock list] [Owed list]`. The bot replies with an A4 PDF, Burmese headings, as a Telegram document. The owner takes the phone to the print shop or forwards the file to the shop's Viber or Telegram, or prints from the phone if a printer is nearby. Nobody needs a computer.
- On the 1st of each month the owner receives last month's report PDF without asking.
- Mechanics: Apps Script fills a hidden Print tab, exports it through the Sheets PDF export (A4, fit to width, repeat header row), and sends it with sendDocument. Burmese rendering in that export is to be confirmed on the first real run; the fallback is building the page in a Google Doc with the Padauk or Noto Sans Myanmar font and exporting that.

### 12.4 Samples with no code and no price

Problem. The design department makes one or two samples of each new design. They have no code and no barcode, sellers do not know the price for certain, and when a customer wants to buy a sample there is no way to record it.

Decision. This is the blank-tag flow from section 4.3, which exists for exactly this. Three additions:

- Every finished sample gets a blank hang tag from the pre-printed stack before it reaches the floor. The designer photographs it and the item exists within a minute, with a name and category proposed by the model and a price chosen from buttons.
- If the price is not decided yet, `⏳ စျေး မသတ်မှတ်ရသေး` (price pending) is a button. The owner gets a message asking for the price, and until she answers the card tells sellers to ask her. Nothing is sold at a guessed price.
- Items registered this way carry a sample flag, so the report shows samples sold on their own line, and a sample that turns into a production run gets a normal SKU tag.
- A sample carries the 🎨 sign in Telegram (the toggle `🎨 နမူနာ: ဟုတ်/မဟုတ်`, and 🎨 instead of the category's emoji on its card and rows) and a 'နမူနာ' badge in the app, whose new-piece form has a နမူနာ switch with a one-line hint (round 6b, 2026-11-18). Before that the toggle carried 🧵, the emoji of the category အခြား, and the owner could not tell the two apart. A sample is a flag, not a category: a piece of any category can be one.

Selling a sample is then scan, START, Sold. No barcode, no label printer.

### 12.5 The voucher printer

Problem. The Bluetooth voucher printer is flat when the customer arrives, has to be switched on and paired first, and is one more thing the sellers avoid.

Decision. Take the printer out of the critical path.

- After each sale the card has `🧾 ဘောက်ချာ` (receipt). It produces a receipt message: shop name, receipt number, date, items, total, paid, owed. The seller shows it on the phone, forwards it to the customer's Telegram or Viber, or screenshots it. Receipt numbers run per shop (R1-000231) so the owner has a sequence.
- Paper only when asked: the same receipt comes as a small PDF that any phone-connected printer or print shop can print.
- The carbon voucher book stays for customers who insist. Its voucher number can be typed into the bot, optional.

A printer can come back later as a Wi-Fi printer on an always-on device, but that is the dependency the sellers disliked, so it is deferred until someone asks for it.

### 12.6 Sellers who keep a notebook instead

Problem. The sellers are not comfortable with a scanner, a PC and a printer, so they write sales by hand, and sales go missing.

Decision. The two-tap path and the voice path are the answer, and the pre-printed tags mean the sellers never label anything. Three additions make the fallback paths just as short:

- Sale without a tag: menu `🕘 recent items` and `🔍 find` lead to the same card, so a piece with a lost tag is still two taps.
- Notebook photo: at the end of the day a seller photographs the handwritten page. Gemini reads the lines, and the computer-literate sister confirms each one with a tap. Her job shrinks from "type everything" to "tap confirm". Burmese handwriting recognition must be tested on the sellers' real notebooks in Phase 0 before this is promised.
- A shared shop phone is fine: one Telegram account per shop in the Staff tab. Per-seller phones can come later if the owner wants to see who sold what.

### 12.7 Moving off the current software

- Export the product list from the current software as Excel or CSV. A one-time import fills the Items tab with names, prices and costs, keeping their existing codes as the tag IDs where they fit the `S1-xxxx` pattern or as an alias column where they do not. No re-typing.
- Existing barcode labels cannot open a Telegram bot, so existing stock gets QR tags printed from the imported list, about one afternoon of tying tags.
- Run both systems for one or two weeks in shop 1 only, then stop the subscription.

### 12.8 What this adds to the build

Not yet built, in order:

1. Credit sales, payments and deposits: ledger columns and types, Customers, Credits and Deposits tabs, the three flows, and the four new report lines. About three days.
2. Reports as PDF: report menu, Print tab export, sendDocument, monthly auto-send. About two days, plus the Burmese rendering check.
3. Receipts: message, numbering, optional PDF. One day.
4. Sample additions: price pending, owner ping, sample flag. Half a day.
5. Sale without a tag, recent items. Half a day.
6. Product-list import from the current software. Half a day.
7. Notebook photo import, only after the Phase 0 handwriting test passes. Two days.

This slots in as a new week 3 of section 8; reporting, tags and hardening move to week 4.

## 13. Round two: what the shop said after the first live run (2026-11-02)

Five points came back once the bot was live. The first was a fault in the bot's plumbing, now fixed. The other four are additions, designed and reviewed but not yet built. The full design notes, the extracted form fields and the critic's review are in `docs/design-round-2/`.

### 13.1 The bot repeated its menu every hour (fixed)

What happened. Google Apps Script answers any web request served through ContentService with an HTTP 302 redirect to a one-time address on script.googleusercontent.com, and only that address returns the real 200 body. Telegram's webhook client counts only HTTP 200 to 299 as success and does not follow redirects (both verified in primary sources: the telegram-bot-api server code and Google's Content Service documentation). So Telegram treated every reply as a failure and re-sent the same `/start` every one to two minutes for up to 24 hours. The bot's one-hour dedupe hid the retries; the first retry after the hour ran the menu again, which is the exact 60-minute spacing in the notifications. Worse, Telegram delivers one chat's updates in order and does not move past a failing one, so the family's newer messages waited silently behind the stuck one. That is why `/start` seemed to do nothing while the Errors tab stayed empty.

Fix, all in `gas_main.js`:

- The webhook reply goes through HtmlService, which is served from the /exec address itself with 200.
- `probeWebhookResponse()` posts to the web app the way Telegram does and logs the status code. It must print 200 after every deployment.
- Update ids are remembered for 6 hours in CacheService and durably in a Script Property (last 400 ids), so a re-delivery is never processed twice.
- `registerWebhook()` drops the pending backlog when it re-registers.

Runbook rule: three minutes after any message, `webhookStatus()` must show `pending_update_count: 0`.

### 13.2 Customers: who bought what, what is still owed, and how they paid

Decisions:

- **Payment method on every cash-moving row.** New Ledger column Method with values from a Settings list `pay_methods` (default CASH, KBZ, WAVE, BANK). The default is CASH so the two-tap sale stays two taps. After a sale, a payment or a deposit the reply carries one 🏦 button per non-cash method; one tap marks it. Voice notes that say "KBZ နဲ့" or "ဘဏ်လွှဲ" carry the method too. Reports then show the drawer and each wallet separately so both reconcile: daily line "💵 ငွေသား … · 🏦 ဘဏ် …" as net movement, and a monthly table by method.
- **A customer can be attached to any sale**, not only a credit sale, with a 👤 button, so "which customer bought this piece" is answerable from both sides: the customer card and the item card.
- **Phone is optional**, never asked inside a money flow: a 📱 button on the reply that created the customer, with a Viber flag. Customers are matched by phone first, then exact name, then a chooser; never a silent merge on a partial name.
- **A customer card in the bot** (👤 ဝယ်သူများ menu): bought, paid, owed, deposit held, last visit, last lines with method, plus buttons to receive payment, take a deposit, add a phone, and a statement PDF. The Customers tab gets the same six summary columns, rewritten by the script.
- **Corrections keep their group id.** Marking a method, attaching a customer and converting to a credit sale all rewrite the one row as mirror plus replacement inside the same group, so receipt numbers and buttons stay stable. Receipt numbers are never renumbered; a voided sale leaves a gap.

### 13.3 Expenses by buttons

💸 ကုန်ကျ in the menu: category, amount, cash or bank, done. Three taps; an optional note afterwards. Categories live in Settings (`expense_categories`: fabric, thread, labour, transport, phone bill, food, electricity, rent, other) and the key goes in a new Ledger column Category. The monthly report gains "expenses by category", and the report menu gains this month's expense list. Voice keeps working and now also carries the category.

### 13.4 Custom tailoring: the measurement book and the voucher book

Finding from the photographs. The two measurement sheets (Thiri Khit and Won Yone letterheads) are the same printed template: the same 22 labels in the left column and 10 in the right, the same five header lines. Only the brand differs. So there is nothing to merge; one unified form covers both shops. Its 32 fields, in the order a tailor measures:

| Group | Fields (Burmese label, key) |
| --- | --- |
| Upper body | လည်ပင်း neck · ပုခုံး shoulder · ရင်ကျယ် chest_width · ကျောကျယ် back_width · ရင်ပေါ်ပတ်လည် over_bust · ရင် bust · ရင်အောက်ပတ်လည် under_bust · ရင်မြင့် bust_height · ရင်ကွာ bust_distance · ချိုင်း armhole |
| Sleeves | လက်မောင်းရင်း upper_arm · တံတောင်ဆစ် elbow · လက်ဝ sleeve_round (three values, e.g. 36/30/20) · လက်အရှည် sleeve_length (three values, e.g. 20/37/58) |
| Waist and hip | ခါးအကျ waist_drop · ခါး waist · တင်အကျ hip_drop · တင်သေး high_hip · တင်ကြီး hip · ကိုယ်အရှည် body_length · ရှေ့ကိုယ်အရှည် front_length · နောက်ကိုယ်အရှည် back_length |
| Htamein | ထမိန်အရှည် htamein_length · ထမိန် ဘယ်/ညာ htamein_side (left/right buttons) · ထမိန် အမျိုးအစား htamein_style (text) |
| Trousers | ဝ trouser_round · ပေါင်ရင်း thigh · ခါးမှဒူး waist_to_knee · ဒူး knee · အရှည် trouser_length · ခြေဝ leg_opening |
| General | မှတ်ချက် note (the margin notes such as "No Bra" or "109") · ဒီဇိုင်းပုံ design photo or catalog code |

The list lives in a MeasureFields tab (key, Burmese label, English label, group, number of values, active), so the family can rename, reorder or hide fields without code. Values are stored as text so "36/30/20" and "17.5" survive. Units are centimetres, not printed on the paper.

The voucher book is a work order rather than a priced receipt: numbered lines of "fabric + design code + description" with the money (Total, Advance, Amount) often filled later. Design codes such as TSL-0018 and TSL-18 are the same catalog number written two ways, so the system normalises them and offers them as buttons from a Designs tab.

Design decisions:

- **Tabs**: Orders (voucher number continuing each shop's own paper series, customer, ordered and due dates, status, total), OrderItems (fabric, design code, description, qty, price), Measurements (one row per session, one column per field, photo of the paper sheet when there is one), Designs (code, name, photo, base price, days to make). No money on the Orders row; it is computed from the ledger.
- **Money follows the rules already in place.** The advance is a DEPOSIT earmarked to the voucher. Delivery writes one SALE per line into a group whose id is the voucher number, applies the earmarked deposit first, and records cash handed over as a PAYMENT with its method; an unpaid balance is an ordinary credit in the existing views and the 21:00 summary. Cancelling refunds the deposit or keeps it as a fee. Undo within 30 minutes reverses the delivery and resets the status. Revenue is recognised on delivery, like everything else.
- **Status**: ordered, cutting, sewing, ready, delivered, cancelled, moving forward only; "ready" pings the shop so the customer can be told.
- **Flows**: new order with a target of seven taps for one line (customer, design with its base price, qty, due-date buttons, advance through the existing deposit flow); an order card; a voucher message and an A5 PDF to forward to the customer on Telegram or Viber; delivery in four taps; reminders in the 21:00 summary for orders due within three days and overdue; an open-orders PDF and a measurement-sheet PDF in the paper layout for the tailor.
- **Measurement capture, three ways on one button row**: a web form served by the same Apps Script project and opened from a Telegram button, with a numeric keypad and one Save (best on phone and laptop, primary once test T7 passes); a photo of the filled paper sheet read by Gemini into the fields with a confirm-and-fix screen (fallback, and a bridge while the paper book is still in use; enabled after test T8); and a one-question-at-a-time chat for fixing single fields or as a last resort. Until T7 passes the first button is the chat or photo path, so nothing depends on anything beyond Telegram.

Decisions needed from the family before this is built:

1. Voucher numbering: continue each shop's paper series (Thiri Khit from 2532, Won Yone from its own next number), and retire the paper books the day the bot takes over.
2. The order of the three numbers in လက်ဝ and လက်အရှည်, and what ဝ under ဘောင်းဘီ measures.
3. Brand name, address and phone numbers per shop for the voucher and measurement PDFs.

### 13.5 Laptops and PCs

The system is not phone-only; the phone is where the camera is. Telegram Desktop and web.telegram.org show the same bot with the same buttons, and PDFs download to the PC. Typing a tag id such as `S1-0042`, or pasting a tag link, will open the item card without a scan. The shop's existing USB barcode scanner types whatever it reads into the focused window, so with Telegram Desktop open it scans tags straight into the chat; printing a barcode of the id under the QR on each tag supports one-dimensional scanners. The Google Sheet is the full PC view for the computer-literate sister. A PC console served by Apps Script is possible later at zero cost and doubles as the Plan B of section 12.1; its reachability from Myanmar has to be measured first.

### 13.6 Build order and effort

| Step | Content | Effort |
| --- | --- | --- |
| 1 | Deploy the webhook fix: paste, new version, probe must print 200, registerWebhook | today |
| 2 | Customers, payment method, expenses, PC text entry (13.2, 13.3, 13.5) | about 6 days |
| 3 | Tailoring: tabs, order flow, card, status, voucher, delivery, cancel, chat measurements, fixes, reminders, reports | about 8 days |
| 4 | Measurement web form, after test T7 | 2 days |
| 5 | Measurement photo path, after test T8 | 2 days |
| 6 | Simulator screens, tests, Burmese review of about 100 new strings with the family | 2 days |

Phase 0 additions: T6 Google sign-in from the shop for the Sheet on a PC; T7 script.google.com reachability from the shop and a form opened and saved inside Telegram's browser on both shops' phones; T8 twenty real measurement sheets through Gemini, at least 85 percent of fields right before confirmation; T9 five voice notes with "KBZ" or "Wave" inside Burmese; T10 the field semantics confirmed with the tailor.

## 14. The real fix for slow internet: an offline-first app (2026-11-02)

### 14.1 Why a chat bot cannot be fixed for a bad signal

Every tap in Telegram travels phone, Telegram, Google, Telegram, phone before the seller sees anything. The Google part is 2 to 4 seconds and can be trimmed by caching; the two phone legs are the network and cannot be trimmed from the server. On a weak signal replies take many seconds or arrive late, sellers tap again, and a tool that is not instant will not be adopted by people who are not confident with technology. Caching alone is a hot fix. A Telegram Mini App does not help either: it loads over the network every time and cannot keep offline storage on iPhone.

### 14.2 The decision

Run the bot's brain on the phone. The conversation and ledger code is already platform-free (the simulator runs it in a browser), so an installable web app runs it against a local copy of the shop's data: every button answers in milliseconds with no network, every row is queued and synced to the Google Sheet whenever there is a signal, even hours later, and the Sheet stays the single source of truth. Telegram keeps the 21:00 summary, owner pings, PDFs, receipt forwarding, voice during the pilot, and remains the fallback. The Sheet, the tags and the ledger rules do not change. Recurring cost stays zero: the app shell is hosted on Firebase's free plan and the data path is the same Apps Script web app.

The binding specification is `docs/design-round-3/SPEC-offline-first.md`. It was produced by three design notes and a critic's review (same folder), and adopts every fix the critic required. The load-bearing choices:

- **Scanner-first app, same cards.** Icon, scan, tap; the latest card large, history behind a handle, a sync chip (synced, n waiting, not sent for 2 days). Android first, iPhone after its own tests.
- **Local data**: both shops' ledger for the current year plus the master tabs; no sliding windows in version 1; an incremental stock map so old phones stay instant.
- **Identity by a typed one-time code from the Telegram bot**, a device token stored hashed on the server, a Devices tab with drain and revoke from Telegram. No secret in the app bundle, no Google sign-in for the family.
- **Push with client ids, accept and flag.** Rows carry the phone's UUIDs; the server deduplicates, stamps a sequence number, receipt time and device, and accepts every well-formed row as what happened. Anomalies (negative stock, overpayment, deposit over-applied) are flagged in the summary and in an owner ping that carries a **void** button, a new owner-only action that reverses any group at any age. Only duplicates and structural errors are refused.
- **Pull by sequence number with per-day checksums**, so a hand edit or a lost row is detected and repaired; corrections are voids and re-entries, never cell edits.
- **Clock corrected from the server** so the business day is right offline. **Confirmation only after the local write completes.** **Transfers online only**, since they are the one operation that writes a quantity read from stock.
- **Receipt numbers per phone** (`R1-A-000231`, never renumbered). **Voice stays in Telegram** until real browser recordings pass through Gemini. **Transport B**: when Google is unreachable but Telegram is not, the outbox goes to the bot as a file and the server ingests it the same way.
- **Two UIs never compete**: once enrolled, the Telegram bot answers a scanned tag with "sell in the app", never a sale; shop 2 stays on Telegram until shop 1 passes acceptance; one selling phone per shop in version 1.
- **Measured, not promised**: tap-to-confirmation median under 300 ms on the sellers' own phones, every day's rows in the Sheet by 08:00, a stale-phone line in the 21:00 summary, a cash count at closing.

### 14.3 Build order and effort

| Step | Content | Effort |
| --- | --- | --- |
| 0 | Core fixes into the Telegram bot now: undo mirrors kept in their group (done), receipt column, owner void, sequence and device columns, enroll-code stubs | 2 days |
| 1 | Phase 0 gates: hosting origin and `script.googleusercontent.com` from both shops' SIMs for three days, install and airplane-mode sale on one Android and one iPhone, a real browser POST, Burmese rendering, a full offline day, voice formats, in-app scanning, Transport B, remote enrollment, iPhone 8-day storage | 2 days, 1 to 2 weeks elapsed |
| 2 | Server sync endpoint in Apps Script | 5 days |
| 3 | Phone data layer and sync, built in the simulator first with a fake server and two phones | 6 days |
| 4 | The app shell, Android, first deploy | 6 days |
| 5 | Pilot in shop 1, three weeks | 4 days |
| 6 | iPhone, in-app voice and photos, shop 2, a second phone per shop | 3 days |

About 30 maintainer days, 10 to 12 calendar weeks from abroad. The tailoring module (13.4) is then built on the app, where its 32-field form belongs.

### 14.3b Owner's decision on quantity input (2026-11-02)

The owner rejected the "Sold 1 / 2 / 3" buttons and asked for the most user-friendly, responsive quantity entry. Decision: one tap "Sold" always sells one piece, which is most sales. For more pieces, the control fits the surface. In Telegram, which only has buttons, a "quantity" button opens a grid of 2 to 9 plus "type it". In the app, where the screen is ours, a stepper (minus, number, plus) sits on the card, and tapping the number opens a numeric keypad, so any count is one or two taps with instant feedback. Both paths commit the same action, so the ledger and the tests do not care which surface sent the count. One-of-a-kind pieces keep a single "Sold" button.

### 14.4 Decisions the owner makes now

Go or no-go; the pilot phone in shop 1; receipt numbers per phone; the 21:00 summary posting on time with a warning line; who counts the drawer and the tolerance; voice in Telegram during the pilot; the app's Burmese name and icon.

## 15. Round three: bank accounts, split payments, option lists, devices (2026-11-05)

What the owner said after the first live run of version 3, in short: register the shop's bank accounts
and pick one from a list when a sale is paid by transfer; let one sale be paid part in cash and part by
bank; register the expense options and pick from them; when an option is missing in the middle of an
entry, add it right there, with the fewest taps; selling happens on the phone, list registration
mostly on the laptop, and the measurement book on a phone, a laptop or an iPad. Also: the voucher
numbers are the pre-printed numbers of bought voucher books, and the shop name, address and phone
printed on them are unimportant because customers never see this system. Three designs were drawn
(fewest taps, laptop-first lists, ledger correctness) and merged; they agreed on the money model.

### 15.1 One place for every option list: the Lists tab

Decisions:

- **A new Sheet tab `Lists`** holds every option the buttons offer, one row per option: `List`,
  `Key`, `Label`, `Active`, `Order`, `Shop`, `Detail`, `Note`. Three lists to start: `pay_method`
  (the bank and wallet accounts), `expense_category`, `fabric`. `Designs` and `MeasureFields` keep
  their own tabs; they already have the same Key / Label / Active / Order shape.
- **The laptop is the editor.** The computer-literate sister adds a row, renames a `Label`, moves
  an `Order`, or unticks `Active`. She never edits a `Key` once used: the Ledger stores keys in
  `Method` and `Category`, and reports bucket by key. `setupSheet` gives the tab dropdowns for
  `List` and `Shop`, a checkbox for `Active`, a validation on `Key` (letters, digits, underscore, at
  most 12 bytes, because a method key rides inside 64-byte Telegram callback data), red highlights for
  a duplicate key or a blank label, and Burmese notes on the header cells. `Detail` holds the account
  number and holder for an account, or the emoji for an expense category. `Shop` blank means both
  shops; an account can belong to one shop.
- **Seeded once, backward compatible.** On its first run `setupSheet` fills the tab from what exists
  today (`Settings pay_methods` plus the `Messages method_<KEY>` labels, `expense_categories`,
  `fabric_presets`). One core helper, `listOptions(ports, name, shop)`, reads the tab when the store
  offers it and the tab has rows, otherwise the old Settings values, so a sheet without the tab, or a
  phone on an older build, behaves exactly as today. A retired option (Active unticked) still resolves
  its label for old rows.
- **Phones get the lists through the existing Settings sync.** The sync server derives the three
  legacy Settings values from the tab (`pay_methods` as `CASH,KBZ:KBZPay,AYA:AYA ဦးမောင်`, and so on)
  when it answers a pull, so a list edit changes the Settings hash and reaches every phone at its next
  sync with no app release and no new phone database. The bot reads the tab on its next request. No
  republishing for any list change.

### 15.2 Bank accounts are the 🏦 buttons

Decisions:

- **Each `pay_method` row is one button.** Under a sale, a payment, a deposit, an expense, an order
  advance, a delivery and a refund, the 🏦 row shows the shop's accounts by their Burmese label, three
  per row, up to six; a seventh and later sit one tap further behind `🏦 နောက်ထပ်…`. The Ledger keeps
  storing the short key, so old rows and every report are untouched. A whole sale paid into one account
  stays scan, ✅, 🏦 account: two taps after the scan, as today.
- **Voice follows the labels.** The Gemini intent's method list is built from the accounts at request
  time, so "AYA ဦးမောင် နဲ့ ပေးသွားတယ်" marks that account.
- **Account details stay inside.** `Detail` is shown on the owner's account list and may, later and
  only if the owner wants it, print on a receipt that still carries a balance ("ငွေလွှဲရန် …"). By
  default nothing about accounts reaches a customer.

### 15.3 One sale, part cash and part bank

Decisions:

- **The ledger shape is the one deliveries already use.** A split appends to the sale's own group, in
  one write: a mirror of the live SALE row, a replacement SALE row with `Cash` = the cash part (same
  receipt number, time and day), and a PAYMENT row with `Amount` = `Cash` = the bank part, `Method` =
  the account key, `RefGroupID` = the sale group, item and customer copied. No new column, no new row
  type, no new sync rule. `saleGroupInfo` reports owed 0, the Credits view skips it, the drawer and
  each account get their part, undo reverses all of it inside the 30-minute window, the owner can void
  later, and the receipt reads "ပေးပြီး 30,000 (ငွေသား 10,000 · KBZPay 20,000)". The same shape was
  verified in production by custom-order deliveries.
- **The taps.** On the sold card: `💵+🏦 ခွဲပေး`, then the account (skipped when the shop has one
  account), then the bank amount: type it (the app opens the keypad by itself), or tap `တစ်ဝက်` or
  `အကုန်`. Three taps for a half, two taps plus the number otherwise, no customer needed. "အကုန်"
  degrades to a plain method change. Today the same case costs about nine taps and forces a customer
  record, because it has to go through a credit sale and a later payment.
- **After a split only undo and receipt remain** on that card: the group has two live rows, so the
  same-day rewrites (👤 attach, 💳 not fully paid, 🏦 re-mark, note) are refused by the existing rule.
  The card says so; attach the customer before splitting when the sale should be on their card. The
  same button on a payment or deposit reply splits that row (a small extension).

### 15.4 Expense categories

Decisions:

- **The category grid comes from the `expense_category` list**, three per row, with each category's
  emoji from `Detail`; the flow stays category, amount, how paid (three taps after 💸, the owner one
  more for the shop). The last button of the grid is `➕ အသစ် ထည့်`.
- **Reports need no re-run.** The Dashboard's expense-by-category block and a new cash-in-by-account
  block become live QUERY formulas over the Ledger joined to the Lists labels, so a new category or
  account shows up without running `setupSheet` again.

### 15.5 Adding a missing option where it is needed: one pattern

Decisions:

- **Every pick-list screen ends with `➕ အသစ် ထည့်`** before `✖️ မလုပ်တော့`: the account row, the
  expense category grid, the fabric row, the design screen (customers already have it). Tapping it asks
  exactly one thing, the name, typed or spoken; the bot reuses an existing option when the name
  matches an existing label, otherwise makes the key itself (the ASCII letters of the label, or a
  prefix plus a short random suffix; nobody ever sees a key), writes the row to the `Lists` tab under
  the script lock, and **continues the interrupted entry with the new option already selected**: an
  expense goes on to the amount screen, a sale is marked with the new account, the split goes on to the
  amount, the fabric lands on the order line, a new design code goes on to the price screen. One tap
  plus one word, once; from then on it is an ordinary button on every device.
- **Who may add.** Everyone adds expense categories and fabrics; only the owner adds bank accounts and
  design codes. Renaming, hiding and reordering happen on the laptop only, never mid-flow.
- **On the phone app, offline.** The app adds the option to its local list at once and queues a
  `list` entry in the outbox; the server appends the row at the next sync. Two phones adding the same
  name while offline produce two rows with one label; the server logs it and the sister retires one on
  the laptop (old rows keep their label). Until the app build with the `list` kind is published, the
  app's ➕ records the row under the generic bucket (`other`, `ဘဏ်လွှဲ`) with the typed name as the
  note and tells the owner, so no money total is ever wrong.

### 15.6 Devices: phone to sell, laptop for lists, any screen for measurements

Decisions:

- **Selling: the phone**, through the bot today and the app after its pilot. Unchanged.
- **Lists: the laptop, in the Sheet.** `Lists`, `Designs`, `MeasureFields` and `Customers` are the
  registration tabs; the bot sees an edit on the next request, phones at their next sync. Telegram
  Desktop on the laptop runs the same ➕ flows and sells by a typed tag id (section 13.5). No PC console
  is built.
- **The measurement book: a form screen in the app**, served by the same bundle to an Android phone,
  the laptop's Chrome and an iPad opened from its home-screen icon, each enrolled once with a 📲 code.
  The customer card's 📏 button opens one scrolling form: the active `MeasureFields` rows grouped under
  the Burmese headings, decimal inputs that accept `36/30/20` for multi-value fields, a left/right
  toggle for the htamein side, an optional voucher number, pre-fill from the customer's last session,
  one `✅ သိမ်း`. On the laptop Tab and Enter move down the printed order. Saving writes a local record
  and one `measurement` outbox entry; the server applies it with the existing `addMeasurement` and
  links the voucher. The field list reaches phones as a derived Settings value, so the sister's
  renames and reorders arrive at the next sync. The Telegram chat questions and the photo of the paper
  page stay as fallbacks, and they are the only path on every device until the app's first deployment
  and the Phase 0 reachability gates of section 14 have passed. The HtmlService form stays unbuilt
  (section 13.5).

### 15.7 What the reports show

- The 21:00 summary keeps "💵 ငွေသား … · 🏦 ဘဏ် … · 💳 အကြွေး ကျန် …" and adds one line per account
  (`🏦 KBZPay 60,000 · AYA 20,000`) on a day when more than one account moved. The month PDF's
  by-method table already prints one row per account key with in, out and net; with real accounts as
  keys that table is the per-account statement the owner reconciles against each wallet. The day PDF
  prints a split as the sale line (cash part) and a payment line (bank part) marked `ခွဲပေး`. The
  receipt, the customer card and the statement show both parts. The sold-out item card shows the mixed
  method text instead of the sale row's method alone.

### 15.8 Build order and effort

1. **Server and Telegram (about five days).** `Lists` tab with seeding and validation; `listOptions`
   with the legacy fallback and the derived Settings values for sync; accounts as buttons, three per
   row, with the overflow picker; the split; the ➕ pattern with resume on every pick-list; voice method
   by label; the summary and card changes; the Dashboard QUERY blocks; scenario and sync checks; README.
   Published with `tools/publish.js bot`, then `setupSheet` once from the editor. Everything in this
   step works on phones through Telegram the same day, and lists already reach the app through Settings.
2. **App (about two days).** The `list` outbox kind on both sides with `app_min_version` raised, so the
   app's ➕ works offline. The split and the account buttons need no app code: the app renders the
   core's keyboards and opens its keypad for the amount.
3. **Measurement form (about four days).** The derived field list, the form screen, the `measurement`
   outbox kind, the pre-fill pull, tests. Depends on the app's first deployment and the Phase 0 gates.

Rules carried over: the live sheet's rows are never touched; `Method` and `Category` keys never change;
the server is deployed before any app build that emits a new outbox kind; new Burmese strings go through
the family's review.

### 15.9 The owner's decisions (2026-11-09)

1. Logins stay as they are: one shared owner login as admin, seller logins for phone selling, one shared
   Google account. No bank accounts are pre-registered; the `Lists` tab starts from today's four methods
   and the family adds the real accounts on the laptop or with ➕.
2. **Every staff member may add a bank account from the phone**, because sellers are the ones who receive
   the payments. This replaces the owner-only proposal in 15.5.
3. **A receipt or voucher that still carries a balance prints where to transfer**, because receipts are
   what customers receive. This replaces the default in 15.2. Each account's number is its `Detail`.
4. The measurement book moves to the app form.

The owner said "build". The binding build contract is `docs/design-round-4/SPEC-round-4.md`; the code maps
and the three source designs are in the same folder.

## 16. Round five: the step-by-step sale and the full simulator (2026-11-11)

The owner's direction after round 4 (built, not yet published): the sale must be guided one question
at a time (scan, count, buyer with contact, how paid, which account, full or part now, how much and
when the rest is paid), because a screen full of options confuses the sellers; the simulator must show
everything (logins, the owner's and the sellers' views, phone and laptop, every function including
measurements, stocking and expenses); voice AI is not a focus for now. The brief with the decisions
taken is `docs/design-round-5/BRIEF.md`; the binding contract is `docs/design-round-5/SPEC-round-5.md`
(written by a design workflow: four code maps, three designs, three judges, three adversarial reviews,
one revision). Rounds 4 and 5 are published together.

## Appendix A: doPost skeleton (Apps Script, V8)

```javascript
// Code.gs — entry point. Every branch returns 200 so Telegram never retries.
const PROPS = PropertiesService.getScriptProperties();
const CACHE = CacheService.getScriptCache();

function doPost(e) {
  try {
    if (e.parameter.token !== PROPS.getProperty('WEBHOOK_SECRET')) return ok();
    const update = JSON.parse(e.postData.contents);

    const key = 'upd:' + update.update_id;          // Telegram re-sends until it sees 200
    if (CACHE.get(key)) return ok();
    CACHE.put(key, '1', 21600);                       // plus a durable list of ids in a Script Property (gas_main.js)

    const from = (update.message || update.callback_query || {}).from;
    const staff = findStaff(from && from.id);       // Staff tab allowlist
    if (!staff) { logUnknownUser(from); return ok(); }

    if (update.callback_query) handleCallback(update.callback_query, staff);
    else if (update.message) handleMessage(update.message, staff);
  } catch (err) {
    logError('doPost', err, e && e.postData && e.postData.contents);
  }
  return ok();
}

function ok() { return HtmlService.createHtmlOutput('ok'); }   // HtmlService answers 200; ContentService would answer 302, which Telegram rejects

function handleMessage(msg, staff) {
  if (msg.text && msg.text.startsWith('/start')) {
    const itemId = (msg.text.split(' ')[1] || '').trim();
    return itemId ? showItemCard(msg.chat.id, itemId, staff) : showMenu(msg.chat.id, staff);
  }
  if (msg.voice) return handleVoice(msg, staff);
  if (msg.photo) return handlePhoto(msg, staff);
  if (msg.text)  return handleText(msg, staff);
}

function handleCallback(cq, staff) {
  tg('answerCallbackQuery', { callback_query_id: cq.id });   // stop the spinner first
  const [action, a, b] = cq.data.split('|');                  // "SALE|S1-0042|2", max 64 bytes
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (action === 'SALE') {
      const tx = appendLedger({ type: 'SALE', itemId: a, qty: -Number(b), staff,
                                source: 'BUTTON', when: cq.message.date });
      editCard(cq.message, msgText('sold', { qty: b, stock: stockOf(a) }),
               [[{ text: msgText('undo'), callback_data: 'UNDO|' + tx.id }]]);
    }
    // CONFIRM|token, UNDO|txId, RESTOCK|id|qty, RETURN|id, TRANSFER|id follow the same shape
  } finally {
    lock.releaseLock();
  }
}
```

## Appendix B: Telegram helpers and webhook registration

```javascript
// telegram.gs — the only file that knows about Telegram.
function tg(method, payload) {
  const res = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + PROPS.getProperty('BOT_TOKEN') + '/' + method,
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true });
  return JSON.parse(res.getContentText());
}

function telegramFile(fileId) {                                // voice notes and photos, up to 20 MB
  const info = tg('getFile', { file_id: fileId });
  const url = 'https://api.telegram.org/file/bot' + PROPS.getProperty('BOT_TOKEN') + '/' + info.result.file_path;
  return UrlFetchApp.fetch(url).getBlob();
}

function registerWebhook() {                                   // run once from the editor
  const url = PROPS.getProperty('WEBAPP_URL') + '?token=' + PROPS.getProperty('WEBHOOK_SECRET');
  Logger.log(tg('setWebhook', { url: url, allowed_updates: ['message', 'callback_query'],
                                 drop_pending_updates: true }));
  Logger.log(tg('getWebhookInfo', {}));
}
```

appsscript.json:

```json
{
  "timeZone": "Asia/Yangon",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

## Appendix C: Gemini call with inline audio

```javascript
// gemini.gs — the only file that knows about Gemini.
function parseVoice(fileId, context) {
  const audio = telegramFile(fileId);
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [
      { inlineData: { mimeType: 'audio/ogg', data: Utilities.base64Encode(audio.getBytes()) } },
      { text: 'Context: ' + JSON.stringify(context) }
    ]}],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: INTENT_SCHEMA }
  };
  const model = PROPS.getProperty('GEMINI_MODEL');           // e.g. gemini-2.5-flash-lite
  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
    { method: 'post', contentType: 'application/json',
      headers: { 'x-goog-api-key': PROPS.getProperty('GEMINI_KEY') },
      payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  const data = JSON.parse(res.getContentText());
  return JSON.parse(data.candidates[0].content.parts[0].text);
}
```

Callers catch the throw and fall back to the button card.

## Appendix D: QR tags

Deep link format: `https://t.me/<bot_username>?start=S1-0042`. The start payload allows letters, digits, underscore and hyphen, up to 64 characters.

Quick preview inside the Sheet, one formula per row:

```text
=IMAGE("https://quickchart.io/qr?size=300&text=" & ENCODEURL("https://t.me/" & Settings!B2 & "?start=" & A2))
```

For printing, generate an A4 PDF with a short Python script using the `qrcode` and `reportlab` packages: QR on the left, the item id in large text on the right so a tag can still be typed if the camera fails, and the shop name. Pre-print 200 blank ids per shop; a blank id becomes a real item the first time a photo is registered against it.

## Appendix F: Build status (2026-09-06)

The plan above has been implemented as a proof of concept in this folder. See README.md.

- `apps-script/` holds the deployable project: shared core plus Google glue, following sections 3 to 6.
- `poc/run_scenario.js` drives every flow in section 4 with in-memory ports; 50 checks pass.
- `poc/dist/pos-simulator.html` is a click-through simulator of the phone, the shop floor and the Sheet.
- `tools/score_voice.js` is the Phase 0 test T2; `tools/make_tags.py` is Appendix D.
- Not yet done: running `gas_*.js` against a live Google account and Telegram, and the Phase 0 tests themselves.
- Built 2026-10-31, from section 12.8: credit sales, payments and deposits (Customers, Credits and Deposits tabs, Cash / CustomerID / RefGroupID ledger columns, PAYMENT / DEPOSIT / DEPOSIT_APPLIED rows); reports as PDF with a monthly auto-send; receipts as text and PDF; price-pending samples with an owner ping and a sample flag; recent items without a tag; product-list import from the Import tab; notebook photo import behind the `notebook_import` setting (off by default until the Phase 0 handwriting test passes). The scenario in `poc/run_scenario.js` covers all of it: 109 checks pass.
- Still to verify on a live account: Burmese glyphs in the Sheets PDF export (fallback is a Docs export), and `sendDocument` from Apps Script to Telegram.
- 2026-11-02: the bot went live and exposed the Telegram-redirect fault (section 13.1), fixed in `gas_main.js` with HtmlService replies, durable dedupe and a probe function. Sections 13.2 to 13.5 are designed and reviewed, not built; the design notes are in `docs/design-round-2/`.
- 2026-11-03, later: "build all things" complete in code. Phase 2 built the custom tailoring module (section 13.4: orders and vouchers per shop, deposits earmarked to a voucher, status, delivery, cancel with refund or fee, measurements by chat or by a photo of the paper sheet, reminders, order and measurement reports; `core_orders.js` plus five new Sheet tabs), the Telegram enrollment screens (📲 code, /devices), and the phone app under `app/` (offline store, sync client, scanner-first screen, quantity stepper, service worker, self-hosted fonts and QR reader, build script, dev page, README for Firebase deployment). Test totals: scenario 327, sync 178, app 79, all passing; the Apps Script bundle, the simulator and the app all build. Not yet done: a live run of the new Sheet code (setupSheet, one real order), the Phase 0 field tests of section 14, the first Firebase deployment, and a real-browser check of the service worker. Tailoring orders are Telegram-only for now; the app hides them until the order tabs are added to its sync. The HtmlService measurement form is deliberately not built.
- 2026-11-03: "build all things" phase 1 done. Sections 13.2, 13.3 and 13.5 are built into the shared core (payment method with 🏦 buttons and voice, customers with phone and a card, expenses by buttons, PC text entry, owner void, the quantity grid of 14.3b), and the sync engine of section 14 is built on the server side (`core_sync.js`, `gas_sync.js`) with a fake server and a reference phone (`poc/sim_phone.js`, `poc/sim_sync.js`, `poc/run_sync.js`, 178 checks). The scenario has 213 checks. Phase 2 (the phone app, the tailoring module, the Telegram enrollment screens) is in progress.
- 2026-11-02, later: two more fixes in the core, both covered by the scenario (118 checks): the same button tapped twice within two minutes records one sale (slow-connection guard), and undo mirrors now stay in the group they reverse, which closes a real bug where an undone credit sale stayed listed as owed. A `text_cards` setting sends item cards without photos. Section 14 (the offline-first app) is designed, reviewed and specified in `docs/design-round-3/SPEC-offline-first.md`, awaiting the owner's go-ahead.

- 2026-11-04 to 2026-11-05: publishing from the PC is set up (`docs/AUTO-PUBLISH-SETUP.html`,
  `tools/publish.js`); the owner published version 3 to the live web app on 2026-11-04 and the webhook
  answers 200. The phone app is built with the real addresses but not yet deployed to
  `salestagbot.web.app`. Section 15 (bank accounts, split payments, the Lists tab, the ➕ pattern, the
  measurement form on three devices) is designed from three merged proposals.
- 2026-11-09: the owner answered 15.9 and said "build". The binding contract is
  `docs/design-round-4/SPEC-round-4.md` (revision 2, after three adversarial spec reviews that found nine
  blockers, among them a helper name that already existed, a script lock that is not re-entrant, and the
  app's keypads being invisible today because `#overlay` has no CSS class). A copy of the project from
  before this build is in `C:\Users\USER\Desktop\Noel-backup\pre-round4`. Build order: step 1 model, step 2
  bot flows and Google glue, step 3 sync kinds, step 4 the app and the measurement form, step 5 docs.
  **To continue an interrupted build:** run the six suites (`node poc/run_scenario.js`, `run_sync.js`,
  `run_app.js`, `run_lists.js`, `run_round4.js`, `run_gas.js`; the last three exist once their step ran),
  compare the files of each step in spec section 13 with the backup to see which steps have landed, and go
  on from the first step whose checks of spec section 12 are missing. Nothing of round 4 is published; the
  live bot stays on version 3 until `node tools/publish.js bot "..."` is run and `setupSheet` after it.
- 2026-11-10: step 1 (the model) is built and independently checked (`poc/run_lists.js`). A usage limit
  cut the step-2 builders off mid-work; they were restarted with handover notes and told to audit what was
  on disk instead of starting over. A cut-off builder leaves no report, so after any interruption trust
  only the suites and a diff against the backup, never the file dates.
- 2026-11-11: steps 1 and 2 are built, reviewed by three adversarial reviewers (10 findings, 1 major:
  split sales slowed the open-credit list for good) and fixed. Suites: run_scenario 327, run_sync 192,
  run_app 79, run_lists 236, run_round4 296, run_gas 230, all green. Spec revision 2.1 (top of the spec)
  records what the review changed. Snapshot after step 2: `C:\Users\USER\Desktop\Noel-backup\pre-step3`
  (without acc.txt and survey.txt). Steps 3 and 4 (sync kinds, the app, the measurement form) were started.
- 2026-11-11 (later): steps 3 and 4 are built, each independently checked, then reviewed by three
  adversarial reviewers (sync, app, release safety): 12 findings, 1 major (a re-save that went back to an
  older session's values was answered "duplicate" and lost, so phone and server disagreed for good; the
  duplicate rule now goes by the entry id, in a new EntryID column at the end of Measurements). Also fixed:
  an app published before the bot, or a bot rollback, no longer throws away new accounts and form sessions;
  the ➕ and 🔢 prompts close at /start, at a menu button and after 10 minutes. Suites: run_scenario 327,
  run_sync 307, run_app 186, run_lists 236, run_round4 338, run_gas 249, all green. Spec revision 2.2
  records the changes. Manual browser checks passed on the dev page and the built app. Still open: a typed
  payment sentence inside the 10-minute ➕ window becomes an option name; the form was not tried on a real
  phone or iPad; real Gemini and real Google Sheets not yet tried. Step 5 is done: apps-script/README.md
  (the Lists tab in section H, the round-4 publish order and live checks under section I),
  app/README.md (the measurement form, laptop and iPad enrollment, the database version 2 note) and
  docs/USER-GUIDE.html (draft 2: accounts, split payment, ➕, 🔢, the Lists tab, the form), each written
  and then checked claim by claim against the code. docs/USER-GUIDE.pdf is still draft 1. Round 4 is
  ready to publish: bot, then setupSheet once, then app.
- 2026-11-11 (round 5 started): the owner asked for a one-question-per-screen sale, a simulator that
  shows every role, device and function, and no further voice work. Backup before this round:
  `C:\Users\USER\Desktop\Noel-backup\pre-round5` (without acc.txt and survey.txt). Design docs go to
  `docs/design-round-5/`. Round 4 stays unpublished until round 5 is done.
- 2026-11-12: round 5 is built. Step 1 (the guided sale core) was cut off once by a usage limit and finished from
  the files on disk; its checker fixed five defects (a late cancel could wipe a sold card's undo button, among
  them). Steps 2 (Sheet and sync: DueDay, Kind, Credits Overdue, sale_flow) and 3 (the app: text, phone and date
  inputs, the keypad) ran in parallel, then step 4 (simulator v2: logins, Telegram, the real app in a frame, the
  laptop Sheet with editable Lists, 17 tours). Three adversarial reviewers found 10 problems (2 major: a typed
  or spoken sale sentence during a guided sale proposed a second sale or rewrote the previous one); all fixed,
  plus a capability mark so a round-5 phone falls back to the one-tap card against an older bot. Suites:
  run_wizard 290, run_scenario 327, run_round4 345, run_lists 236, run_app 265, run_sync 333, run_gas 295,
  check_simulator 68, check_simulator_browser 13 (SIM.smoke 34, over both frame transports), all green. The
  simulator artifact was republished. Snapshot after this: `C:\Users\USER\Desktop\Noel-backup\r5-built`.
  The guides followed the same day, each written then checked claim by claim against the code: apps-script/README.md
  (sale_flow, sale_due_presets, Kind, DueDay, the Credits tab; section I "Rounds 4 and 5" with the release order and
  the live checks), app/README.md (selling on the phone) and docs/USER-GUIDE.html (draft 3: the step-by-step sale and
  the simulator as the place to practise). docs/USER-GUIDE.pdf is still draft 1.
- 2026-11-12 (round 6 started): after trying round 5 the owner asked for one-screen forms instead of step-by-step
  screens, a basket for several items per buyer, and a count and a name on the new-piece form. After an
  explanation of Telegram versus the app they agreed: sellers use only the phone app (forms, offline, scanner);
  Telegram is the owner's channel plus a review-card backup for selling. Brief: `docs/design-round-6/BRIEF.md`;
  design workflow wf_a99e6b8d-49d writes `docs/design-round-6/SPEC-round-6.md` and `mockup.html`. Rounds 4, 5
  and 6 are published together.
  2026-11-13: the design finished (14 agents; 57 review findings, all applied; SPEC-round-6.md revision 2). The
  screens were published for the owner to approve before the build: https://claude.ai/artifact/3Gw1KRXzWnrEWSaRQE7d8z.
- 2026-11-13 (round 6, revision 3): the owner tried the simulator and the mockup and wrote twelve points, which
  `docs/design-round-6/FEEDBACK-1.md` turned into binding decisions F1-F12: one notes box on the measurement form; a
  figure to draw on (a woman, or a man); the history as this phone's own records; no chat box; a buyers page with +
  and an edit form; ← on every screen and the phone's back; emojis only on the job buttons and the menu, data as
  clean lists; the English words OK, Settings, Menu, Scan, Photo, Save, Cancel; the owner edits each shop's name,
  address and phone; a receipt page with Share and Print; restock in the menu. The owner's replies of the same day
  replaced F9 (the notebook out of the app) by F9b (one AI switch for every phone and the bot: 📒, voice and the
  photo's name only while it is on) and added F10b ("I might need a third shop; also I want to edit the shops data
  also like name, place etc."): the shop editing is built, the ids stay S1 and S2, and nothing new assumes exactly
  two shops; a third shop (S3: its tags, voucher series V3, Settings rows, the transfer choice, the Lists dropdown,
  the reports and the 21:00 summary) is a later round, planned once the owner confirms it. SPEC-round-6.md revision 3
  (its section 13) is the contract, after two more reviews (`review-r3-ux.md`, `review-r3-build.md`); the mockup was
  redrawn. Two questions put to the owner got no answer, so the design's choices stand and the user guide says them
  plainly: a seller cannot return a piece of a sale that still owes, and scanning a piece that is already in the
  list adds nothing (its + does).
- 2026-11-13 (round 6 built): backup before the build `C:\Users\USER\Desktop\Noel-backup\pre-round6`. The five steps
  of the spec's sections 11 and 13.16, each built and then checked by an independent checker who fixed what was
  wrong and added a check for every mutant the suites let through. Step 1, the core: one group for a sale of
  several pieces (`commitBasket`), the Telegram review card of a sale and of a new piece, the counted new piece and
  its undo back to a blank tag, the restock of several pieces, a return refused on a sale that still owes, the hooks
  that open the app's forms and pages, the buyer checks, the views that let the app draw cards as lists, the AI
  switch, the `setting` entry and the drawing in sync, setupSheet's `ai` row and Shops block; `run_wizard.js`
  rewritten for it (its checker fixed four defects and one check that could never fail). Step 2, sync and glue: the
  drawing's picture and a new piece's photo without AI saved to Drive with no Gemini call, the figure on the
  measurement PDF, `setSetting`, the `Sketch` column, one receipt number per basket on the phones, the photo AI's
  late rename made one rule on server and phone (no defect found; four test gaps closed). Step 3, the app: the four
  forms and the job buttons, the back stack with the phone's back, the buyers page and form, the history, the
  receipt page, the figure, the Settings AI switch and Shops section, line icons inside the bundle instead of
  emojis, the English words (its checker fixed three defects and added 29 checks). Step 4, the simulator: the
  sellers' tours on the app's forms, a Telegram review-card tour, SIM.smoke with a three-piece basket on part
  payment (no defect; coverage gaps closed). A review of the finished build followed and its findings were fixed in
  the files of the step that owns them; the ones that needed another step's files were fixed in the cross-step pass
  (the next entry), the phone's half of the false `sync_conflict` fix and the Help's step numbers among them. Suites
  at the end of the build:
  run_scenario 327, run_round4 345, run_lists 236, run_gas 334, run_app 523, run_sync 378, run_wizard 506,
  check_simulator 107, check_simulator_browser 13 (SIM.smoke 57 checks over both frame transports), all 0 failed.
  Step 5, the guides, each written then checked claim by claim against the code: apps-script/README.md (sale_flow
  form/quick, the `ai` row, the Shops block, the Measurements `Sketch` column and the one notes box, the rows of a
  basket, one receipt number per basket, the counted new piece; section I "Rounds 4, 5 and 6" with the release
  order and the live checks), app/README.md (the forms and the job buttons, the photo at Save, back, buyers,
  history, the receipt page, the figure, Settings) and docs/USER-GUIDE.html (draft 4: selling in the app, the
  Telegram card as the backup, the two answers above, buyers, history, the receipt's two buttons, the figure, the AI
  switch and 📒, the owner's Shops screen). docs/USER-GUIDE.pdf is still draft 1. Still open: nothing is published
  (rounds 4 to 6 go out together: the bot, `setupSheet`, `rebuildViews`, the app, then the simulator); the
  real-phone checks of the spec's 10.7 on one Android phone and one iPhone (the camera strip, the phone's back, the
  figure under a finger and its picture, Share and Print); a native speaker's pass over the new Burmese texts; and
  whether F12's "main menu" also means Telegram's (Telegram's menu has no 📦 for now; a restock there starts from
  the scanned piece's card). Snapshot of the built tree: `C:\Users\USER\Desktop\Noel-backup\r6-built` (without
  acc.txt and survey.txt), taken on 2026-11-14 after the cross-step pass (the next entry).
- 2026-11-13 (round 6, cross-step pass): the items the build's fixers handed over because each needed a file of
  another step were fixed by that file's owner, each reproduced first and pinned by a check that fails without it
  (proved in a scratch copy). The tree before this pass: `C:\Users\USER\Desktop\Noel-backup\r6-build-raw` (without
  acc.txt and survey.txt). Core: a sale that a later payment was taken against (a PAYMENT of another group whose
  RefGroupID is the sale) is neither undone nor voided any more; `undoGroup` and `voidGroup` answer `locked`, the bot
  says `rewrite_locked` in both channels and writes nothing, so that payment is undone first (run_wizard W42); the
  undo and void of a basket carry the group view, which the app draws as a table of the basket's own lines (W42,
  run_app 76); `setupSheet` seeds the shop rows of every id in `CFG.SHOP_IDS` (F10b; run_wizard W40 and run_gas 32 add
  a third id in a test). Phones: a photo or pic job's answer gives the item's Rev before and after its write, and the
  app and the reference phone take the new one when their own Rev was the one before, so a new piece undone right
  after its photo went up raises no false `sync_conflict` and no owner ping (run_app 75, run_sync R6j); the reference
  phone sends a new piece's photo as a pic job when AI is off, as the app does (R6k). App: the Help keeps its 1. 2. 3.
  (run_app 77); tag ids are read for every shop of `CFG.SHOP_IDS` (78); a sale form opened by a scan writes its
  draft at once, so an untouched basket comes back under 🛒 (79). Simulator: the app frame counts an instant false
  from `confirm()` (a host page sandboxed without allow-modals) as OK, so the ← of a changed form, the measurement
  form's close and the drawing's clear work there (SIM.smoke 58, check_simulator 5d); the build header names the
  eleven app files. Guides: the user guide says what a second scan of a piece does in each channel (the app adds
  nothing, its + does; Telegram's card offers ➕ စာရင်းထဲ ထည့်, which adds one more), and that a sale with a later
  payment shows the grey `rewrite_locked` line instead of its undo and void until that payment is undone; both
  READMEs say the same; the spec's labels table and the mockup use the built buyer labels နောက်ဆုံး လာချိန် and
  လာသည့် အကြိမ်. Every finding of the review is now fixed (the optional second guard of its finding 3 was not
  built). Suites: run_scenario 327, run_round4 345, run_lists 236, run_gas 336, run_app 542, run_sync 385,
  run_wizard 512, check_simulator 112, check_simulator_browser 13 (SIM.smoke 58 checks over both frame transports),
  all 0 failed. Still open: what the entry above lists (nothing published, the real-phone checks, the native
  speaker's pass, F12 and Telegram's menu); a question for the owner: a payment older than 30 minutes has no undo,
  so a sale it was taken against can then be neither undone nor voided; and, for the third-shop round, the tag
  patterns `S[12]` in core_bot.js and core_ledger.js, `otherShop` (core_config.js), setupSheet's blank tags and the
  simulator's racks, which still name S1 and S2.
- 2026-11-14: the orchestrator re-ran every suite (run_scenario 327, run_round4 345, run_lists 236, run_gas 336,
  run_sync 385, run_app 542, run_wizard 512, check_simulator 112, check_simulator_browser 13, all 0 failed), the ES5
  check and the protected-file checks, and drove the built simulator by hand (a one-item cash sale: scan then Save;
  a three-item basket with a buyer, KBZPay, half paid and a 14-day date, one group of three rows with the cash
  spread in line order and one Credits entry; the buyers page with search and +; the buyer page as a clean list; the
  measurement form with one note and the figure; back; history). The simulator artifact was republished. Nothing is
  published to the shops; rounds 4, 5 and 6 go out together.
- 2026-11-18 (round 6b): the owner tried the round-6 simulator and wrote three points, which
  `docs/design-round-6/FEEDBACK-2.md` turned into binding decisions G1-G4: (G1) the sample needs its own sign and a
  word on what it is, because Telegram's toggle carried 🧵, the emoji of the category အခြား; (G2) a new piece's
  category list must grow with a +, not only offer အခြား; (G3) Telegram's menu gets 📦 restock (the question F12 had
  left open); (G4) every rule of round 6 still binds. The contract is `docs/design-round-6/SPEC-round-6b.md`
  (revision 2, after two reviews: `review-6b-b-data.md`, `review-6b-b-ux.md`). Backup before the build:
  `C:\Users\USER\Desktop\Noel-backup\r6-built`. What was built:
  - G1: Telegram's toggle reads 🎨 နမူနာ: ဟုတ်/မဟုတ်, and a sample's item card and rows lead with 🎨 (its name keeps
    ' (နမူနာ)', the reports keep their နမူနာ ရောင်း column); `setupSheet` rewrites round 3's two toggle texts where the
    Messages tab still holds them exactly. The app's new-piece form has a real switch နမူနာ (ပိတ်/ဖွင့်, as the AI
    switch) with the hint line, and a sample shows a small နမူနာ badge on the tiles, the sale form's line and the item
    card.
  - G2: a fourth Lists-tab list `item_category`, seeded by the tab's first seed with the five built-ins under fixed
    keys (`htamein`, `longyi`, `eingyi`, `wutsone`, `other`; rows 18-22 on a default sheet), read and synced through
    the round-4 list machinery. The item still stores the category's name (a key would have needed a migration of
    the live Items and of every reader); a renamed built-in's old name still finds its row. The catch-all `other`
    is always offered and always last. The app's form shows the shop's categories as chips plus အမျိုးအစားအသစ်,
    which adds the category in the same Save; Telegram's 🏷 screen lists them by key with ➕ အမျိုးအစားအသစ်.
    Anyone who registers pieces may add; a name holding နမူနာ and a name the owner closed are refused. The photo
    AI, the server's late rename and the phones' replay all use the piece's shop's list as it was given to the AI.
  - G3: 📦 ကုန်ရောက် in Telegram's menu (and in the app's Menu under `quick`) asks for a tag, shows its count screen
    (presets, a typed number, ✏️, ✖️ to skip, 🛒 ရောင်းမယ် for a sale) and, after each count, the next tag or
    ✅ ပြီးပြီ; one RESTOCK group per tag; a one-of-a-kind piece ends it; it ends 180 seconds after its last question.
  - The five steps of the spec's section 6, each built and then checked by an independent checker who added a check
    for every mutant the suites let through. Step 1, the core: its checker fixed one defect (a bad count at the
    count screen did not re-arm the loop's 180-second window) and added 22 checks after 26 of 31 mutants passed.
    Step 2, glue and sync: no defect, four checks added. Step 3, the app: no defect, nine checks added. Step 4, the
    simulator: the tours `newcat` and `tgrestock`, the item_category rows on the laptop's Lists tab, the rack's
    🎨 sample. A review of the build followed; its findings were fixed and pinned by checks: at the count screen
    only a number on its own is the count (a typed tag is the next tag), a spoken count works in the loop, a tap on
    the newest count screen after the 180 seconds still counts, ✖️ or ✅ on an older message only removes its
    buttons, the ➕ prompt lapses after ten minutes while the card lives 30, an emoji-only name is refused, a chosen
    category keeps its row through an owner's rename (in Telegram and in the app), and a label with nothing left
    once plain shows its Key on the app's chip.
  - Step 5, the guides, each written then checked claim by claim against the code: apps-script/README.md (the
    item_category list in section H, the sample sign and the Messages rewrite, Telegram's 📦 loop; section I
    "Rounds 4, 5, 6 and 6b" with the release order and the live checks), app/README.md (the category chips and +,
    the refusals, the sample switch and badge, the loop under `quick`) and docs/USER-GUIDE.html (draft 5: the chips
    and +, the switch and badge, a box on 🎨 နမူနာ versus 🧵 အခြား, Telegram's ➕ and ☰ 📦, the Lists tab's
    item_category rows, three new rows in Part D, the two new tours). docs/USER-GUIDE.pdf is still draft 1 (the
    tree has no tool to make it).
  Suites at the end: run_scenario 327, run_round4 345, run_lists 269, run_gas 353, run_sync 398, run_app 600,
  run_wizard 610, check_simulator 136, check_simulator_browser 13, all 0 failed. Snapshot of the built tree:
  `C:\Users\USER\Desktop\Noel-backup\r6b-built` (without acc.txt and survey.txt). Still open: nothing is published
  (rounds 4 to 6b go out together: the bot, `setupSheet`, `rebuildViews`, the app, then the simulator); a native
  speaker's pass over the round-6b texts (ten bot texts, two app texts, the two changed toggles); the real-phone
  checks of round 6; and the owner's view on whether 📦 in Telegram's fourth row is too cramped (one line of
  `showMenu` moves it to its own row).
- 2026-11-18 (round 6b verified by the orchestrator): the build workflow wf_4e89d471-e15 (18 agents) ended with a
  final verifier that ran every suite, 8 mutants (all killed) and its own probes. I re-ran the three builds and all
  nine suites myself (the same counts as above, all 0 failed), the ES5 check of every core_, gas_, app_ and sim_ file,
  the invisible-character scan (none), and compared app/config.js, tools/publish.js, tools/publish.config.json and
  tools/publish-log.jsonl with r6-built (identical; acc.txt and survey.txt are identical to pre-round4). By hand in the
  simulator: in Telegram, ☰ shows 📦 ကုန်ရောက်; typing 2 opened S1-0002, +၅ gave stock 10 and the next-tag message;
  a rack scan of S1-0003 and a typed 3 gave stock 6; ✅ ပြီးပြီ ended the loop (two RESTOCK rows). A blank tag's card
  showed 🎨 နမူနာ: မဟုတ်; 🏷 listed the five built-ins with ➕ အမျိုးအစားအသစ်; the typed name ပဝါ was added (a Lists
  row at once, the default price presets) and, with the sample on, the saved card led with 🎨 and kept (နမူနာ). In
  the app (shop-1 seller), the form's chips showed ပဝါ from the server and အခြား last; typing ပဝါ in the + field gave
  the live "already exists" hint; a new name ခါးပတ် with the switch on (green ဖွင့်, hint below) saved the piece as a
  sample with that category, synced the Lists row ("added by Sister (S1)"), and the item view and home tile carry the
  နမူနာ badge. The laptop's Lists tab shows the seven item_category rows. No console errors, SIM_ERRORS 0. The
  simulator artifact was republished (version 9); the backup r6b-built was refreshed with the rebuilt app files.
- 2026-11-19 (round 6c, the UX review for first-time phone users): the owner asked me to check the product myself "as a
  designer who cares for the customer (user-friendly for users with zero knowledge of technology)" and to fix what needs
  it, then to push everything to GitHub. The review (every string of the app, every question and error, the seller's
  screens in the simulator) is `docs/design-round-6/REVIEW-ux-zero-tech.md`: ten findings fixed, six looked at and left
  with the reason. Built, in the app only (the core, the bot and the Sheet are untouched):
  - `appAsk` (app_ui.js): the app's own question sheet with two big Burmese buttons that name the outcome, the risky one on
    top (red when it destroys something), the safe one under it; Android back is the safe one. It replaces every
    `window.confirm` (English OK / Cancel, blocked in some hosts): leaving a changed form or measurement form
    ("ရိုက်ထားတာတွေ မသိမ်းရသေးပါ · ထွက်မလား?" → မသိမ်းဘဲ ထွက်မယ် / ဆက်ဖြည့်မယ်), the drawing's clear, and ဖုန်း ပြန်ချိတ်ဆက် in
    Settings, which now always asks and names the unsent entries. Undo (မှားသွားတယ်) and the owner's void ask first too
    ("ဒီမှတ်တမ်းကို ပြန်ဖျက်မလား?"), on the sold card, the receipt and the entry page.
  - A line under the camera's Scan button (the home and every form's strip): what to answer the phone's first camera
    question (Allow), and after a refusal where the permission is put back and that the keypad works meanwhile.
  - Toasts stay by their length (55 ms per character over 1.5 s; a refusal at least 4.5 s; never past 7 s).
  - The Menu card is two columns at 18 px (Burmese labels no longer cut into syllables); the compact job row shows each
    emoji with its word under it; the new-piece form's empty cost box reads "မသိရင် ချန်ထားပါ"; the enrol hint says where
    the code comes from and to ask the owner; the sync page's storage lines are plain words.
  - The simulator's frame snapshot carries the open question as `ask`; the smoke run taps a changed form's ←, waits for
    the sheet and taps its leave button (sim_ui.js, check_simulator.js 5d). New checks: run_app step 86 (22 checks) and
    the updated pins of steps 58 and 59; app/README.md and docs/USER-GUIDE.html describe the questions, the camera note and
    the new words.
  Suites: run_scenario 327, run_round4 345, run_lists 269, run_gas 353, run_sync 398, run_app 622, run_wizard 610,
  check_simulator 137, check_simulator_browser 13, all 0 failed; ES5 and the invisible-character scan clean; the
  protected files untouched. Hand-checked in the simulator: the ← of a changed sale form opens the sheet, ဆက်ဖြည့်မယ်
  keeps it, မသိမ်းဘဲ ထွက်မယ် closes it with nothing written; the sold card's မှားသွားတယ် opens the undo question;
  the menu's two columns; the compact row's words; the cost hint. Simulator republished (version 10); snapshot
  `C:\Users\USER\Desktop\Noel-backup\r6c-built`. The project folder became a git repository (`.gitignore` keeps acc.txt,
  survey.txt and the publish log out; `.gitattributes` keeps the bytes as written) for the owner's private GitHub
  repository. Left for later, with the reason in the review: the +95 phone format, Zawgyi keyboards, the menu's 📲 in the
  app.

## Appendix E: Sources checked on 2026-09-06

- Gemini audio formats, 32 tokens per second, 20 MB inline limit: https://ai.google.dev/gemini-api/docs/audio
- Gemini model names, free tier, paid prices, data-use terms: https://ai.google.dev/gemini-api/docs/pricing
- Gemini rate limits are per account and shown in AI Studio: https://ai.google.dev/gemini-api/docs/rate-limits
- Myanmar VPN ban, Signal blocked, Telegram still used, mid-2024: https://www.accessnow.org/myanmar-vpn-ban/ and https://www.irrawaddy.com/news/burma/signal-down-junta-blocks-last-secure-communication-channel-in-myanmar.html

Added 2026-10-31:

- OONI measurements from Myanmar, July to October 2026, Telegram test and web connectivity for google.com, docs.google.com, youtube.com: https://api.ooni.io/api/v1/aggregation?probe_cc=MM&test_name=telegram&since=2026-07-01&until=2026-10-31 (change `test_name=web_connectivity&domain=...` for the others)
- Human Rights Myanmar, blocking rates by platform during the 2025-26 election period (OONI-based, 198,000 measurements): https://humanrightsmyanmar.org/how-the-military-blocked-independent-media-during-the-2025-6-elections/
- Gemini API available regions (Myanmar absent): https://ai.google.dev/gemini-api/docs/available-regions
- Viber chatbot commercial model, EUR 100 monthly fee: https://respond.io/blog/viber-bot-pricing
- A vendor "censorship map" listing Telegram as blocked in Myanmar, contradicted by the OONI data above: https://cellesim.com/en/which-apps-are-blocked-where-2026
