# SalesTagBot: customers + payment method, expenses by buttons, PC access

Design against the code as it stands on 2026-11-02 (`apps-script/core_*.js`, `gas_*.js`, `poc/run_scenario.js`, 109 checks). Everything below reuses the existing patterns: append-only Ledger, undo by reversing rows, proposals confirmed with ✅/❌, callback data `ACTION|arg|arg` under 64 bytes, per-user state in cache (`st:<uid>`), Burmese strings in `core_messages.js` (overridable from the Messages tab), tabs and columns listed in `core_config.js`, Settings keys read through `ports.store.getSetting`.

Scope note: this step covers the user's points 2 (customers, who paid how), 3 (expenses) and 5 (laptop/PC). Points 1 (notifications) and 4 (tailoring measurements) are other steps; the Customers design below is deliberately the anchor the measurement book will later hang off (one CustomerID per person), so nothing here needs redoing for it.

---

## 0. One ledger change that everything else uses: "rewrite in place of the group"

Three new actions (mark a sale as paid by bank, attach a customer to a paid sale, and the existing "not fully paid") all mean *the same event, with one field corrected*. The append-only rule says: reverse, then re-append. `convertSaleToCredit` already does that, but it creates a **new GroupID**, which has three costs that will get worse now that there are more such corrections: the receipt number changes after the customer already got a receipt, every button on the card (`U|`, `RC|`, `PY|`) has to be re-rendered with the new id, and the Credits view and PAYMENT `RefGroupID` links point at whichever id happened to be live.

Decision: **a rewrite keeps the GroupID.** `rewriteGroup(ports, groupId, changes, staff, updateId)`:

1. Takes the group's live rows (see definition below). Refuses unless there is exactly one live row (`reason:'complex'`), it is of a rewritable type (SALE, RETURN, PAYMENT, DEPOSIT, EXPENSE), and `dayKey(now) === row.day` (`reason:'expired'`; a rewrite after midnight would spread one event over two days).
2. Appends the mirror row (same as `undoGroup`: negated Qty/Amount/Cash, `ReversesTxID`, `Source:UNDO`, `Note:'rewrite'`, copying Method and Category so per-method totals net out).
3. Appends the replacement row: every field copied from the original, `changes` applied (method, customerId, cash, note), `when = new Date(row.time)` so Time and Day stay those of the real event, `Source: BUTTON|VOICE`, **same groupId**.
4. Both go through `writeGroup` under the lock, so `afterWrite` refreshes the views.

"Live row" is redefined once, in a helper `liveRows(rows)`: rows that neither reverse another row nor are reversed by one. Today three places use the weaker "not a reversing row" test and must switch to the helper: `saleGroupInfo` (`live`, `first`), `undoGroup` (otherwise undo after a rewrite reports `already`), and `openCredits` (drop the `r.cash >= r.amount` shortcut on the first SALE row of a group; compute `saleGroupInfo` and test `owed > 0`). `convertSaleToCredit` becomes `rewriteGroup(groupId, {cash: paidNow, customerId, note:'credit'})`. Net effect on sums: original + mirror + replacement = replacement, so `statsWhere`, `addCash`, Dashboard SUMIFS and the Items Stock SUMIF are all unchanged and correct.

Fix carried along: today `convertSaleToCredit` re-commits with processing time, so a credit conversion at 00:05 moves the sale to the next day. The `when` rule above closes that.

`receiptNumber` should also skip voided groups (`saleGroupInfo(g).voided`); today a reversed sale still consumes a number.

---

## 1. Customer records and payment method

### 1.1 Payment method on every cash-moving row

New Ledger column **Method**, appended at the end (after `ReversesTxID`). Values are keys from Settings `pay_methods`, default `CASH,KBZ,WAVE,BANK`. Labels in `METHOD_LABEL` (overridable in Messages as `method_CASH` etc.):

| Key | Burmese (draft) | English |
| --- | --- | --- |
| CASH | ငွေသား | cash in the drawer |
| KBZ | KBZPay | KBZPay wallet/app |
| WAVE | WavePay | WavePay |
| BANK | ဘဏ်လွှဲ | any other bank transfer (KBZ bank, AYA, CB, Yoma…) |

Rules:
- Method is set on rows where Cash ≠ 0: SALE (cash now), RETURN (refund), PAYMENT, DEPOSIT, EXPENSE. RESTOCK, TRANSFER, ADJUST, DEPOSIT_APPLIED carry `''`.
- `newTx` defaults `method` to `CASH` when `cash !== 0` and no method is given. Every button commit therefore stays exactly as fast as today: scan, START, `ရောင်း ၂` = cash sale, two taps.
- Undo mirrors copy Method from the original (so the KBZ bucket is reduced when a KBZ sale is undone).
- Reading legacy rows: blank Method with Cash ≠ 0 is read as `CASH` (in `gasStore.ledgerRows` and the sim store). No backfill needed.

**One tap to mark bank.** `afterSaleKeyboard` gains a third row with one button per non-cash method in `pay_methods` (max 4): `🏦 KBZPay` `🏦 WavePay` `🏦 ဘဏ်လွှဲ` → `PM|<groupId>|KBZ` (44 bytes). Tap → `rewriteGroup(groupId, {method})` → card edited to `...\n🏦 KBZPay နဲ့ ပေးတယ်` with the same Undo/Receipt/Credit/Customer buttons (same groupId, so nothing else changes). If the shop sets `pay_methods` to `CASH,BANK` they see a single `🏦 ဘဏ်လွှဲ` button. The same row appears under the replies for PAYMENT (`pay_done`), DEPOSIT (`dep_done`) and RETURN (`return_done`). The buttons are hidden when the group is no longer rewritable (a DEPOSIT_APPLIED row joined it, or a PAYMENT references it); the method was then chosen in the flow or stays CASH.

**Expenses** ask the method as a step (section 2) because they are rarer and more often paid from the bank.

**Voice.** `INTENT_SCHEMA` gains `method` (enum `CASH|KBZ|WAVE|BANK`, nullable) and `category` (string, nullable; section 2). Prompt rules and examples:
- "KBZ နဲ့ ပေးတယ်", "KBZPay ကနေ လွှဲတယ်" → `method:"KBZ"`; "Wave" / "ဝေ့ဗ်" → `WAVE`; "ဘဏ်လွှဲ", "ဘဏ်ကနေ လွှဲတယ်" → `BANK`; "ငွေသား", "လက်ငင်း" → `CASH`.
- `"ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်" → {"intent":"SALE","qty":2,"method":"KBZ"}`
- New intent **METHOD**: the note says only how the last thing was paid: `"Wave နဲ့ ပေးသွားတယ်" → {"intent":"METHOD","method":"WAVE"}`. The bot keeps `lg:<uid>` in cache (last committed groupId, TTL = undo window) and proposes `🏦 WavePay · ရောင်း ၂ ထည် 36,000 ကျပ်` with ✅/❌; ✅ runs `rewriteGroup`. No last group → `not_understood` fallback.
- `describeProposal` appends ` · 🏦 KBZPay` when a method other than CASH is present; `confirmProposal` passes `method` into every `commit*`.

Phase 0 T2 gets five extra voice samples with "KBZ"/"Wave" said inside Burmese sentences; English brand names in Burmese speech are the one thing the model has not been tested on.

### 1.2 Attaching a customer to a fully paid sale

New button on the after-sale card: `👤 ဝယ်သူ` → `CU|<groupId>`. Shows the same picker as the credit flow (`recentCustomers` 4 buttons, `✏️ နာမည်အသစ်`, `✖️`), state `{kind:'cu', groupId, step:'customer'}`; pick → `CUP|<groupId>|C-0001` (46 bytes) → `rewriteGroup(groupId, {customerId})` → card gains `👤 ဒေါ်မြင့်`. `new` → `ask_name` → typed or spoken name → `resolveOrCreateCustomer` → same. Cash stays equal to Amount, so no credit opens; `afterSaleKeyboard` must decide `isCredit` from `saleGroupInfo(g).owed > 0`, not from `!!customerId` as it does now (that bug would otherwise hide the `💳 မကျေသေး` button and show `ငွေလက်ခံ` for a paid sale).

Voice already supports this: "ဒေါ်မြင့်ကို ရောင်းတယ်" gives `customer` with `paid:null` → `commitSale` with the customer and full cash.

### 1.3 Phone (optional, skip-able, never blocks a sale)

- Customers tab already has Phone. The bot never asks for it inside a money flow. Instead every reply that created a new customer (credit, deposit, CU, voice) carries one extra button `📱 ဖုန်း ထည့်` → `CF|C-0007`. The seller taps it or ignores it.
- `CF` sets state `{kind:'await_text', purpose:'phone', customerId}` and asks `📱 ဒေါ်မြင့် ၏ ဖုန်းနံပါတ် (Viber) ရိုက်ပါ` with `⏭ ကျော်` / `✖️`. `handleText` must check this state **before** the number path (a phone number parses as a number today and would be treated as a price). Normalise: Burmese digits → Arabic, strip spaces/dashes/dots, `0959…` or `+959…` → stored as `09…`; anything that fails `^09\d{7,9}$` is still saved as typed (never block), and the reply shows it so she can fix it. Store via new `ports.store.updateCustomer(id, {phone})` (Customers is master data, updated in place like Items; the Ledger stays append-only).
- Display phones as `+95 9xx xxx xxx` in the customer card: Telegram makes international numbers tappable, which opens the dialer or Viber on the phone. The bot cannot message Viber (chatbots there cost EUR 100/month); the seller forwards the receipt text by hand, as today.
- `findCustomers` also matches on digits, so `🔍` with `0977` finds her.

### 1.4 Customer history in the bot

Menu button `👤 ဝယ်သူများ` → `M|cust`: six most recent customers as buttons (`CH|C-0001`) plus `🔍 ရှာ` (state `find_customer`: typed name or digits) and `✖️`. `CH` shows:

```
👤 ဒေါ်မြင့် · +95 977 712 3456
🛍 ဝယ်ပြီး 1,012,000 · 💵 ပေးပြီး 512,000 · 💳 ကျန် 500,000
📥 စရံ 0 · 🕘 နောက်ဆုံး ၆ စက်တင်ဘာ · ၃ ကြိမ်
──────────
၆ စက် · ဝတ်စုံ မင်္ဂလာ · 1,000,000 · ပေး 500,000 · ငွေသား
၁ အောက် · ငွေလက်ခံ · 12,000 · KBZPay
...
[💰 ငွေလက်ခံ] [📥 စရံ]   [📱 ဖုန်း ထည့်] [📄 စာရင်း PDF]
```

Payment button appears only when owed > 0 and routes to the existing `PY|<groupId>` when one credit is open, or the pay list filtered to this customer. `📄` → `CS|C-0001` builds report kind `customer` (sections: summary, transactions with Method column, open credits, deposits) through the existing `buildReport` → `ports.pdf.make` → `sendDocument`, so the shop can hand a customer their statement.

New core functions in `core_ledger.js`: `customerSummary(ports, customerId)` → `{bought, paid, owed, depositHeld, lastDay, visits}` with Bought = Σ Amount of SALE+RETURN rows for the customer, Paid = Σ Cash of those rows + Σ PAYMENT Amount + Σ DEPOSIT_APPLIED Amount, Owed = Bought − Paid, DepositHeld = Σ DEPOSIT − Σ DEPOSIT_APPLIED, LastVisit = max Day, Visits = distinct Days (mirrors net out, no special casing); `customerHistory(ports, customerId, n)` → last n live rows; `customerSummaries(ports)` for the sheet.

### 1.5 Per-customer summary in the Sheet

Six columns appended to the Customers tab: **Bought, Paid, Owed, DepositHeld, LastVisit, Visits**. They are a view the script rewrites (same as Credits/Deposits): `refreshViews(credits, deposits, customers)` gets a third argument and writes F:K for every customer row (`addCustomer` keeps appending 5 values; the view fills the rest on the next refresh). `afterWrite` already triggers on every row with a CustomerID. `rebuildViews()` in `gas_main.js` passes the new argument. The computer-literate sister therefore opens one tab and sees name, phone, bought, paid, owed, deposit, last visit; Ledger filtered by CustomerID gives the detail with the Method column.

### 1.6 Reports: drawer vs bank

`statsWhere` gains `byMethod: { CASH:{in,out}, KBZ:{in,out}, … }` filled by the same undo-aware logic as `addCash`, plus `cashBank = Σ non-CASH in`. Then:
- `summary_cash` becomes `   💵 ငွေသား {cash} · 🏦 ဘဏ် {bank} · 💳 အကြွေး ကျန် {owed}`; `today_query` gets the same two numbers. Invariant checked by a test: cash + bank = cashIn.
- Day report: new column `နည်းလမ်း` (method label) per row; totals row shows per-method net.
- Month report: per-day table gets `ငွေသား` and `ဘဏ်` columns; new section `ငွေလက်ခံ နည်းလမ်းအလိုက်` (method, in, out, net) per shop so the drawer count and each wallet statement can be reconciled line by line.
- `SUMMARY_COLS` gets `ငွေသား`, `ဘဏ်` after `ငွေလက်ခံ`.
- Dashboard: two columns `Cash in (drawer)` and `Cash in (bank)` built from the existing `cashIn` formula with an extra `Method` criterion; existing formulas untouched since Method is appended at the end.

---

## 2. Expenses by buttons

Menu button `💸 ကုန်ကျ` → `M|exp`. State `{kind:'exp', step, draft:{shop, cat, amount, method, note}}`; each tap carries only the new value, the draft lives in state (TTL 30 min, same as the other flows; a stale tap gets `expired`).

| Step | Screen (Burmese draft / English) | Buttons → callback |
| --- | --- | --- |
| shop (owners only; staff use `staff.shop`) | `💸 ဘယ်ဆိုင် အတွက်လဲ?` / which shop | `ဆိုင် ၁` `ဆိုင် ၂` → `ES|S1` |
| cat | `💸 ဘာ ကုန်ကျစရိတ်လဲ?` / what kind of expense | 3 per row: `🧵 အထည်ဖိုး` `🪡 ချည်ဖိုး` `✂️ လက်ခ` / `🚕 ကားခ` `📱 ဖုန်းဘေလ်` `🍚 ထမင်းဖိုး` / `💡 မီးဖိုး` `🏠 ဆိုင်ခ` `📦 အခြား` → `EC|fabric`; `✖️` → `Z` |
| amount | `💸 ဖုန်းဘေလ် · ဘယ်လောက်လဲ?` / how much | presets from `expensePresets(ports, cat)` (most common past amounts in that category, padded from Settings `expense_presets`, 4 buttons, same algorithm as `pricePresets`) → `EA|15000`; `✏️ အခြား` → `EA|other` → `await_number` purpose `exp_amount` (typed or spoken) |
| method | `💸 ဖုန်းဘေလ် 15,000 ကျပ် · ဘယ်လိုပေးလဲ?` / how was it paid | `💵 ငွေသား` first, then `🏦 KBZPay` `🏦 WavePay` `🏦 ဘဏ်လွှဲ` → `EM|CASH` |
| note | `📝 မှတ်ချက် (ရိုက်ပါ၊ ဒါမှမဟုတ် ကျော်ပါ)` / note, type or skip | `⏭ ကျော်` → `EN|skip`; typed text or a voice note becomes the note |
| done | `💸 ကုန်ကျစရိတ် 15,000 ကျပ် · ဖုန်းဘေလ် · KBZPay မှတ်ပြီးပါပြီ` | `↩️ မှားသွားတယ်` → `U|<groupId>` |

Four taps for a typical expense (category, amount, cash, skip). `commitExpense` is unchanged in shape: Amount and Cash negative, ItemID blank; it just receives `category` and `method`. The category key goes in the new Ledger column **Category** (appended after Method); Note stays free text. The same `commitExpense` serves voice: `category` from Gemini is matched against the category labels and keys (`ဖုန်းဘေလ်` → `phone`), unknown → `other` with the spoken reason kept in Note; the proposal reads `📝 ကုန်ကျစရိတ် 15,000 ကျပ် · ဖုန်းဘေလ် · KBZPay · ဆိုင် ၁`.

Categories are configurable: Settings `expense_categories` = `fabric:အထည်ဖိုး,thread:ချည်ဖိုး,labour:လက်ခ,transport:ကားခ,phone:ဖုန်းဘေလ်,food:ထမင်းဖိုး,electric:မီးဖိုး,rent:ဆိုင်ခ,other:အခြား` (key:label pairs; keys are what the Ledger stores, so renaming a label never breaks history). Default list and emoji map live in `CFG.EXPENSE_CATEGORIES` / `CFG.EXPENSE_EMOJI`. Keys are ASCII so `EC|transport` is 12 bytes.

Reports: `statsWhere` gains `expensesByCategory: {phone: {count, total, bank}}`. Month report gets section `ကုန်ကျစရိတ် အမျိုးအစားအလိုက်` (category, count, total, of which bank) per shop with a totals row; report menu gets `💸 ကုန်ကျစရိတ်` → `RP|exp` (this month's expense rows with category, method, note, and the by-category totals), handy at month end. Daily summary keeps its single expenses number. Dashboard: one block "Expenses by category, this month" with `SUMIFS(Amount, Day, month*, Type, "EXPENSE", Category, key)` per key.

---

## 3. Laptop / PC access

The system is not phone-only; the phone is just where the camera is. Real options, in order of effort:

**a. Telegram Desktop or web.telegram.org — zero work, works today.** Telegram Desktop (Windows/macOS/Linux) and web.telegram.org (`/a` and `/k`) show the same chat with the same bot, the same cards, the same inline buttons, PDFs download to the PC, voice notes can be recorded with the PC microphone, photos are drag-and-drop. Login is by scanning a QR from the phone (Settings → Devices → Link Desktop Device) or by phone number with the code arriving in the phone's Telegram, so no SMS dependency. Both are reachable wherever Telegram is (same servers as the app; the OONI Telegram test includes web.telegram.org). What a PC lacks is the camera scan. Replacements, all cheap:
- Type `/start S1-0042`, or just `S1-0042` (add to `handleText`: a bare tag id `^S[12]-\d{4}$` or a pasted `t.me/<bot>?start=S1-0042` opens the card before any AI call; zero cost, also useful on the phone when a tag is torn).
- `🔍 ရှာ` and `🕘 မကြာသေးမီ` already reach any item in two taps.
- **The shop's existing USB barcode scanner.** A keyboard-wedge scanner types whatever it reads plus Enter into the focused window. With Telegram Desktop focused on the bot chat, scanning a tag types the id and sends it: scan → card → click Sold, same two taps as the phone. If the scanner is 1D-only (most cheap ones), `tools/make_tags.py` prints a Code128 of the id under the QR (one hour of work); a 2D scanner reads the QR itself and the pasted-URL rule above handles the `t.me` text. This turns the old POS computer into a full SalesTagBot station for nothing.

**b. The Google Sheet is the PC view.** Items, Ledger (with Method and Category), Customers (with the summary columns), Credits, Deposits, Dashboard, plus filter views. Share the Sheet with the computer-literate sister; Ledger and Items stay protected (warning-only today; make the protection editor-restricted to the business account), Settings and Messages are hers to edit (`pay_methods`, `expense_categories`, every button label). docs.google.com measured 164/165 reachable from Myanmar (plan §12.1); the Google sign-in path (accounts.google.com, 2-step code to the phone) should be tried once from the shop as a Phase 0 test T6 before anyone relies on it.

**c. PDFs** from `🖨 စာရင်း` open and print straight from the PC; the monthly PDF arrives on the 1st in Telegram Desktop too.

**d. An Apps Script HtmlService page — possible, zero cost, not now.** The same project can serve a Burmese web page at its `/exec` URL: `doGet` returns `HtmlService.createTemplateFromFile('pc')`, the page calls server functions through `google.script.run`, and those functions call the same `core_*` code with the same `gasStore` ports, so the ledger rules hold. It *can*: show today's rows, stock with search, a customer lookup with history, owed and expenses by category, on a big screen with a keyboard; take a PIN (Settings `pc_pin`, checked server-side, rate-limited through CacheService) because "Execute as me / Anyone" means the page acts as the owner; later host write forms (expense entry, the tailoring measurement sheet) that go through `commitExpense` and friends; and it is exactly the Plan B of §12.1, so building it read-only first de-risks a Telegram block. It *cannot*: push notifications, run offline, start fast (2 to 5 s per load, Apps Script cold start), take more than about 30 simultaneous users, or scan a tag without webcam JS. Two things to verify before trusting it: HtmlService pages are served from a `*.googleusercontent.com` sandbox frame, so run the OONI web_connectivity query for that domain as done for docs.google.com; and Burmese fonts render fine in any browser, no issue there. Cost: zero (same quotas). Effort: 2 to 3 days for a read-only console with PIN, later writes 1 day per form.

Recommendation: ship (a) + the text-tag rule (half a day) and tell the family "Telegram on the computer is the same bot". Build (d) when the tailoring measurement form wants a big screen or when Plan B becomes necessary.

---

## 4. Burmese strings to add to `core_messages.js` (drafts for the sister to rewrite)

```
btn_bank: '🏦 ဘဏ်လွှဲ'            btn_cash: '💵 ငွေသား'
method_CASH: 'ငွေသား'  method_KBZ: 'KBZPay'  method_WAVE: 'WavePay'  method_BANK: 'ဘဏ်လွှဲ'
method_done: '🏦 {method} နဲ့ ပေးတယ်လို့ မှတ်ပြီး'
method_mark: ' · 🏦 {method}'                       (appended to proposals and cards)
method_voice: '🏦 {method} · နောက်ဆုံး {desc}'      (METHOD intent proposal)
btn_customer: '👤 ဝယ်သူ'            cust_attached: '👤 {customer} · မှတ်ပြီး'
btn_phone: '📱 ဖုန်း ထည့်'          ask_phone: '📱 {customer} ၏ ဖုန်းနံပါတ် (Viber) ရိုက်ပါ'
phone_saved: '📱 {customer} · {phone} သိမ်းပြီး'
btn_customers: '👤 ဝယ်သူများ'       cust_list: '👤 ဘယ်ဝယ်သူလဲ?'   cust_find: '🔍 နာမည် ဒါမှမဟုတ် ဖုန်း ရိုက်ပါ'
cust_none: '👤 မတွေ့ပါ။'
cust_card: '👤 {name}{phone}\n🛍 ဝယ်ပြီး {bought} · 💵 ပေးပြီး {paid} · 💳 ကျန် {owed}\n📥 စရံ {deposit} · 🕘 နောက်ဆုံး {last} · {visits} ကြိမ်'
cust_line: '{day} · {desc} · {amount} · {method}'
btn_statement: '📄 စာရင်း PDF'      rep_customer_title: 'ဝယ်သူ စာရင်း · {name}'
btn_expense: '💸 ကုန်ကျ'            exp_ask_shop: '💸 ဘယ်ဆိုင် အတွက်လဲ?'
exp_ask_cat: '💸 ဘာ ကုန်ကျစရိတ်လဲ?'  exp_ask_amount: '💸 {cat} · ဘယ်လောက်လဲ?'
exp_ask_method: '💸 {cat} {amount} ကျပ် · ဘယ်လိုပေးလဲ?'
exp_ask_note: '📝 မှတ်ချက် (ရိုက်ပါ၊ ဒါမှမဟုတ် ကျော်ပါ)'
expense_done: '💸 ကုန်ကျစရိတ် {amount} ကျပ် · {cat}{note} · {method} မှတ်ပြီးပါပြီ'   (replaces the current text)
confirm_expense: '📝 ကုန်ကျစရိတ် {amount} ကျပ် · {cat}{note} · {method} · {shop}'   (replaces)
cat_fabric: 'အထည်ဖိုး' cat_thread: 'ချည်ဖိုး' cat_labour: 'လက်ခ' cat_transport: 'ကားခ' cat_phone: 'ဖုန်းဘေလ်'
cat_food: 'ထမင်းဖိုး' cat_electric: 'မီးဖိုး' cat_rent: 'ဆိုင်ခ' cat_other: 'အခြား'
rep_expense: '💸 ကုန်ကျစရိတ်'       rep_by_method: 'ငွေလက်ခံ နည်းလမ်းအလိုက်'   rep_by_cat: 'ကုန်ကျစရိတ် အမျိုးအစားအလိုက်'
summary_cash: '   💵 ငွေသား {cash} · 🏦 ဘဏ် {bank} · 💳 အကြွေး ကျန် {owed}'   (replaces)
today_query: adds a line '💵 ငွေသား {cash} · 🏦 ဘဏ် {bank}'
help: adds '💻 ကွန်ပျူတာမှာ Telegram ဖွင့်ပြီး Tag နံပါတ် (ဥပမာ S1-0042) ရိုက်ပို့ပါ'
```

---

## 5. Migration of an existing Sheet

All new columns go at the **end** of their tabs so no existing formula (Items Stock SUMIF, Dashboard SUMIFS, user filter views) shifts.

1. `setupSheet()` gains `ensureColumns(sheet, cols)`: for each header in `CFG.*_COLS` missing from row 1, append it after the last header. Ledger gets `Method` (col U) and `Category` (col V), both formatted `@`. Customers gets `Bought, Paid, Owed, DepositHeld, LastVisit, Visits` (F:K). Safe to re-run.
2. Settings: `setupSheet` appends the missing keys `pay_methods`, `expense_categories`, `expense_presets` (`5000,10000,20000,30000,50000`), `pc_pin` (blank). Messages: already appends missing `MSG` keys.
3. No backfill of Method: readers treat blank + Cash ≠ 0 as CASH. If the owner knows some past rows were bank, she adds a reversing pair by hand (same as any correction) or leaves them.
4. Dashboard is rewritten by `setupSheet` as today; `rebuildViews()` fills the Customers summary columns.
5. `appendLedger` maps by header name through `CFG.LEDGER_COLS`, so order is enforced by config; the sim store follows the same list.
6. Deploy: edit the existing deployment, new version; `registerWebhook` is not needed (URL unchanged).
7. The simulator seed (`poc/sim_seed.js`) gets Method on its seeded rows and one legacy row without Method to exercise the default.

---

## 6. Effort

| Piece | Days |
| --- | --- |
| `rewriteGroup` + live-row helper, migrate `convertSaleToCredit`, `receiptNumber` fix, tests | 1.0 |
| Method column, defaults, `PM` buttons, voice `method`/METHOD intent, by-method stats, summary/today/day/month/Dashboard | 1.5 |
| Customer attach (`CU`), phone (`CF`), history (`CH`), statement PDF (`CS`), Customers summary view, `updateCustomer` in gas + sim | 1.5 |
| Expenses by buttons: flow, categories/presets settings, Category column, voice category, month/`RP|exp` report, Dashboard block | 1.0 |
| PC: text-tag rule in `handleText`, Code128 on tags, help text | 0.5 |
| `setupSheet` migration, seed, docs (plan §12 update, README) | 0.5 |
| **Total** | **6 days** |
| Optional HtmlService read-only console with PIN (Plan B groundwork) | +2.5 |

---

# Data model changes

## core_config.js

```js
CFG.METHOD = { CASH:'CASH', KBZ:'KBZ', WAVE:'WAVE', BANK:'BANK' };
CFG.DEFAULT_PAY_METHODS = ['CASH','KBZ','WAVE','BANK'];           // Settings pay_methods overrides
CFG.EXPENSE_CATEGORIES = [['fabric','အထည်ဖိုး'],['thread','ချည်ဖိုး'],['labour','လက်ခ'],['transport','ကားခ'],
  ['phone','ဖုန်းဘေလ်'],['food','ထမင်းဖိုး'],['electric','မီးဖိုး'],['rent','ဆိုင်ခ'],['other','အခြား']];  // Settings expense_categories overrides ("key:label,...")
CFG.EXPENSE_EMOJI = { fabric:'🧵', thread:'🪡', labour:'✂️', transport:'🚕', phone:'📱', food:'🍚', electric:'💡', rent:'🏠', other:'📦' };
CFG.EXPENSE_PRESETS = [5000, 10000, 20000, 30000, 50000];          // Settings expense_presets overrides
CFG.PC_PIN_TTL_SEC = 3600;                                          // only if the HtmlService console is built
CFG.INTENT.METHOD = 'METHOD';                                       // "how the last thing was paid"
// Appended at the END so existing formulas keep their column letters:
CFG.LEDGER_COLS = [...existing 20..., 'Method', 'Category'];        // U, V
CFG.CUSTOMER_COLS = ['CustomerID','Name','Phone','Note','CreatedAt', 'Bought','Paid','Owed','DepositHeld','LastVisit','Visits'];  // F:K are a script-written view
```

TX types: unchanged (SALE, RESTOCK, RETURN, EXPENSE, TRANSFER_OUT/IN, ADJUST, PAYMENT, DEPOSIT, DEPOSIT_APPLIED). No new row type; corrections stay reversing rows.

## Ledger row (newTx fields)

| Field | Column | Rule |
| --- | --- | --- |
| `method` | Method (new, U) | one of pay_methods keys. Set when Cash ≠ 0 (SALE, RETURN, PAYMENT, DEPOSIT, EXPENSE). `newTx` defaults to `CASH` when `cash !== 0 && !f.method`; `''` otherwise. Undo mirrors copy it. Readers treat blank + Cash ≠ 0 as `CASH` (legacy rows). |
| `category` | Category (new, V) | EXPENSE rows: category key (`phone`); blank for every other type. |
| GroupID | unchanged | a rewrite (method, customer, credit conversion) keeps the GroupID: mirror row + replacement row join the original group. |
| Time/Day | unchanged | replacement row copies the original Time/Day; mirror rows carry now. Rewrite refused if `dayKey(now) !== row.day`. |
| Note | unchanged | mirror rows of a rewrite: `'rewrite'`; replacement: `'credit'`, `'method'`, `'customer'`. |

"Live rows" of a group (new helper `liveRows`): rows that neither reverse another row nor are reversed by one. Used by `saleGroupInfo`, `undoGroup`, `openCredits`, `rewriteGroup`, `receiptNumber` (skip voided groups).

## Settings tab, new keys

| Key | Default | Meaning |
| --- | --- | --- |
| `pay_methods` | `CASH,KBZ,WAVE,BANK` | order = button order; first must be CASH; non-CASH keys become the 🏦 buttons (max 4) |
| `expense_categories` | `fabric:အထည်ဖိုး,thread:ချည်ဖိုး,labour:လက်ခ,transport:ကားခ,phone:ဖုန်းဘေလ်,food:ထမင်းဖိုး,electric:မီးဖိုး,rent:ဆိုင်ခ,other:အခြား` | key:label pairs; keys stored in Ledger.Category, labels shown |
| `expense_presets` | `5000,10000,20000,30000,50000` | padding for `expensePresets(ports, cat)` (most common past amounts in that category first, like `pricePresets`) |
| `pc_pin` | blank | only used by the optional HtmlService console |

Messages tab: all keys in section 4 of the design (setupSheet appends missing ones).

## Customers tab

Columns A:E unchanged and written by `addCustomer` (still 5 values). Phone updated in place by new `ports.store.updateCustomer(id, {phone, note})` (gas: `getRange(_row, col).setValue`; sim: object merge). Columns F:K (`Bought, Paid, Owed, DepositHeld, LastVisit, Visits`) rewritten by `refreshViews(credits, deposits, customers)` from `customerSummaries(ports)`:
Bought = Σ Amount(SALE,RETURN) · Paid = Σ Cash(SALE,RETURN) + Σ Amount(PAYMENT) + Σ Amount(DEPOSIT_APPLIED) · Owed = Bought − Paid · DepositHeld = Σ Amount(DEPOSIT) − Σ Amount(DEPOSIT_APPLIED) · LastVisit = max Day · Visits = distinct Days. All over rows with that CustomerID, mirrors included (they net out).

## Credits / Deposits tabs
Unchanged columns. Credits view no longer relies on the first SALE row's `cash >= amount` shortcut (rewrites keep the GroupID).

## Dashboard
Adds columns `Cash in (drawer)` and `Cash in (bank)` per shop block (existing cashIn formula + `Ledger!$U:$U,"CASH"` / `"<>CASH"` criterion) and a block "Expenses by category, this month" (`SUMIFS(Amount, Day, $D$2&"*", Type, "EXPENSE", Category, key)` per key from the Settings list). Existing cells keep their positions.

## Gemini schema (core_ai_prompt.js)
`INTENT_SCHEMA.properties.method = { type:'string', enum:['CASH','KBZ','WAVE','BANK'], nullable:true }`
`INTENT_SCHEMA.properties.category = { type:'string', nullable:true }`
`intent` enum gains `METHOD`. `aiContextText` adds `pay_methods` and `expense_categories` labels so the model maps spoken words to keys.

## ports.store additions
`updateCustomer(id, fields)`; `refreshViews(credits, deposits, customers)` (third argument). Sim store mirrors both.

## Report model (core_report.js)
`statsWhere` result gains `byMethod {key:{in,out}}`, `cashBank`, `expensesByCategory {key:{count,total,bank}}`. New report kinds `exp` (this month's expenses) and `customer` (one customer's statement, `fileName: 'customer-<id>-<day>'`).

## Migration (existing sheet)
`setupSheet()` → `ensureColumns` appends `Method`,`Category` to Ledger row 1 (format `@`) and `Bought…Visits` to Customers; appends missing Settings keys and Messages; rewrites Dashboard; then `rebuildViews()`. No data backfill. Deploy as a new version of the same deployment.

---

# Callbacks and states

## New callback actions (all `ACTION|arg|arg`, longest is 46 bytes)

| Action | Data | Button (Burmese draft / English) | What it does |
| --- | --- | --- | --- |
| `PM` | `PM|<groupId>|<METHOD>` (44 B) | `🏦 KBZPay` / `🏦 WavePay` / `🏦 ဘဏ်လွှဲ` (bank transfer); one per non-CASH key in `pay_methods` | `rewriteGroup(groupId, {method})`; edits the card: `method_done`, same keyboard. Shown under SALE, RETURN, PAYMENT, DEPOSIT replies while the group is rewritable (single live row, same day, no PAYMENT/DEPOSIT_APPLIED attached). |
| `CU` | `CU|<groupId>` | `👤 ဝယ်သူ` / customer | On a paid sale: picker of 4 recent customers + `✏️ နာမည်အသစ်` + `✖️`; state `{kind:'cu', groupId, step:'customer'}` |
| `CUP` | `CUP|<groupId>|<custId|new>` (46 B) | `👤 ဒေါ်မြင့်` / `✏️ နာမည်အသစ်` (new name) | pick → `rewriteGroup(groupId, {customerId})` → `cust_attached`; `new` → step `name`, `ask_name`; typed or spoken name → `resolveOrCreateCustomer` → same. Reply adds `📱 ဖုန်း ထည့်` when the customer is new and has no phone. |
| `CF` | `CF|<custId>` | `📱 ဖုန်း ထည့်` / add phone | state `{kind:'await_text', purpose:'phone', customerId}`; `ask_phone` with `⏭ ကျော်` (skip → `Z`) |
| `CH` | `CH|<custId>` | `👤 <name>` in the customers list | customer card (`cust_card` + up to 8 `cust_line`) with `💰 ငွေလက်ခံ` (if owed; → `PY|<groupId>` or filtered pay list), `📥 စရံ` (→ `DC|<custId>` through `startDeposit`), `📱 ဖုန်း ထည့်`, `📄 စာရင်း PDF` |
| `CS` | `CS|<custId>` | `📄 စာရင်း PDF` / statement PDF | `buildReport('customer')` → `pdf.make` → `sendDocument` |
| `M` | `M|cust` | `👤 ဝယ်သူများ` / customers | list 6 recent customers (`CH|`) + `🔍 ရှာ` (`M|cfind`) + `✖️` |
| `M` | `M|cfind` | `🔍 ရှာ` / find | state `{kind:'find_customer'}`; `cust_find`; typed name or digits → `findCustomers` → `CH|` buttons or `cust_none` |
| `M` | `M|exp` | `💸 ကုန်ကျ` / expense | starts the expense flow (owner: step `shop`; staff: step `cat`) |
| `ES` | `ES|S1` | `ဆိုင် ၁` / `ဆိုင် ၂` | owner picks the shop; → step `cat` |
| `EC` | `EC|<catKey>` | `📱 ဖုန်းဘေလ်` (phone bill), `🍚 ထမင်းဖိုး` (food), `🧵 အထည်ဖိုး` (fabric), `🪡 ချည်ဖိုး` (thread), `✂️ လက်ခ` (labour), `🚕 ကားခ` (transport), `💡 မီးဖိုး` (electricity), `🏠 ဆိုင်ခ` (rent), `📦 အခြား` (other) | → step `amount` with `expensePresets(cat)` |
| `EA` | `EA|<amount>` or `EA|other` | `10,000` … / `✏️ အခြား` | amount → step `method`; `other` → `await_number` purpose `exp_amount` (typed digits, Burmese digits, or spoken; `applyAwaitedNumber` resumes the flow) |
| `EM` | `EM|<METHOD>` | `💵 ငွေသား` (cash) first, then the 🏦 buttons | → step `note` |
| `EN` | `EN|skip` | `⏭ ကျော်` / skip | `commitExpense({amount, shop, category, method, note:''})` → `expense_done` + `↩️ မှားသွားတယ်` (`U|`) |
| `RP` | `RP|exp` | `💸 ကုန်ကျစရိတ်` / expenses | this month's expense PDF (rows + by-category totals) |
| `Y`/`N` | unchanged | ✅ မှန်တယ် / ❌ မဟုတ်ဘူး | proposals now also carry `method`, `category`; a METHOD-intent proposal's ✅ calls `rewriteGroup(lastGroup, {method})` |

Existing actions that change behaviour: `S`, `D`, `RQ`, `T`, `PA`, `DN` and `Y` set cache `lg:<uid>` = committed groupId (TTL `UNDO_WINDOW_MIN*60`) so a voice "Wave နဲ့ ပေးတယ်" knows what it refers to. `CR` → `CP` → `CC` keep their names; `finishCredit` calls `rewriteGroup(groupId, {cash: paidNow, customerId, note:'credit'})` and no longer changes the groupId, so `afterSaleKeyboard` needs no re-render of ids. `afterSaleKeyboard(ports, groupId)` drops the `isCredit` parameter and reads `saleGroupInfo(groupId).owed > 0`.

## New / changed states (cache `st:<uid>`, TTL `STATE_TTL_SEC`)

| State | Fields | Entered by | Consumed by |
| --- | --- | --- | --- |
| `exp` | `step: 'shop'|'cat'|'amount'|'method'|'note'`, `draft: {shop, cat, amount, method}` | `M|exp` | `ES`, `EC`, `EA`, `EM`, `EN`; typed text or voice at step `note` → note then commit; `buildAiContext.awaiting = 'exp_<step>'` |
| `await_number` purpose `exp_amount` | `draft` | `EA|other` | `applyAwaitedNumber` → step `method` |
| `cu` | `groupId`, `step: 'customer'|'name'` | `CU`, `CUP|…|new` | `CUP`; typed/spoken name at step `name` |
| `await_text` purpose `phone` | `customerId` | `CF` | `handleText` **before** the number path: normalise, `updateCustomer`, `phone_saved`; `Z` skips |
| `find_customer` | – | `M|cfind` | `handleText` → `findCustomers(text)` (name or digits) |
| cache `lg:<uid>` | last committed groupId | every commit reply | METHOD intent proposal; cleared on undo |

Voice/text while in these states: `handleIntent` already routes spoken numbers into `await_number`; add: `exp` step `note` takes `intent.note || transcript`; `cu` step `name` takes `intent.customer || item_hint || transcript` (same as credit); `await_text`/`phone` takes digits found in the transcript, else re-asks.

## Menu layout after the change
```
[📊 ဒီနေ့] [🕘 မကြာသေးမီ] [🔍 ရှာ]
[💰 ငွေလက်ခံ] [📥 စရံ] [💸 ကုန်ကျ]
[👤 ဝယ်သူများ] [🖨 စာရင်း] [❓ အကူအညီ]  (+ [📒 စာအုပ်] when notebook_import is on)
```
After-sale card:
```
[↩️ မှားသွားတယ်] [🧾 ဘောက်ချာ]
[💳 မကျေသေး] [👤 ဝယ်သူ]
[🏦 KBZPay] [🏦 WavePay] [🏦 ဘဏ်လွှဲ]
```
Report menu adds `[💸 ကုန်ကျစရိတ်]`.

## PC path in `handleText` (no state, before the AI call)
`^S[12]-\d{4}$` (case-insensitive) or `t\.me/[^?]+\?start=([A-Z0-9_-]{1,64})` → `openTag`. This is what a USB keyboard-wedge scanner types into Telegram Desktop.

---

# Report changes

## Daily summary (`buildDailySummary`, 21:00 to the family group)
`summary_cash` → `   💵 ငွေသား {cash} · 🏦 ဘဏ် {bank} · 💳 အကြွေး ကျန် {owed}` where cash = `byMethod.CASH.in`, bank = Σ non-CASH `in`. Invariant: cash + bank = cashIn (existing field). Expenses line unchanged.

## `/today` and `📊 ဒီနေ့` (`answerToday`)
Adds `💵 ငွေသား {cash} · 🏦 ဘဏ် {bank}` under the existing cash line per shop.

## `statsWhere` (core_ledger.js)
Adds `byMethod: {CASH:{in,out}, KBZ:{in,out}, WAVE:{…}, BANK:{…}}` (undo-aware exactly like `addCash`: a mirror reduces the bucket its original filled), `cashBank`, `expensesByCategory: {phone:{count,total,bank}, …}` (EXPENSE rows; mirrors subtract; `bank` = part not paid in CASH). Blank Method with Cash ≠ 0 counts as CASH (legacy rows).

## Day report (`dayReport`)
Table columns: `အချိန် · အမျိုးအစား · ပစ္စည်း / ဝယ်သူ · ထည် · ငွေ · ငွေလက်ခံ · နည်းလမ်း · မှတ်ချက်` (new: method label; EXPENSE rows show the category label in `ပစ္စည်း / ဝယ်သူ` when Note is blank). Totals row gains a second line per method with net cash (`ငွေသား 134,000 · KBZPay 36,000`). `SUMMARY_COLS` → `ဆိုင် · ရောင်းရငွေ · ထည် · ငွေလက်ခံ · ငွေသား · ဘဏ် · ကုန်ကျစရိတ် · ပစ္စည်းကုန်ကျ · အမြတ် · နမူနာ ရောင်း`; `summaryRow` fills the two new cells.

## Month report (`monthReport`)
- Summary section: new `ငွေသား`, `ဘဏ်` columns (above).
- `နေ့အလိုက်` (by day): columns `ရက် · ရောင်းရငွေ · ထည် · ငွေလက်ခံ · ငွေသား · ဘဏ် · ကုန်ကျ`.
- New section `ငွေလက်ခံ နည်းလမ်းအလိုက်` (cash by method) per shop: `နည်းလမ်း · ဝင် · ထွက် · ကျန်` (method, in, out, net), one row per method that moved money, totals row. This is the line the owner compares with the drawer count and with each KBZPay/WavePay/bank statement.
- New section `ကုန်ကျစရိတ် အမျိုးအစားအလိုက်` (expenses by category) per shop: `အမျိုးအစား · အကြိမ် · စုစုပေါင်း · ဘဏ်မှ` (category, count, total, of which bank), sorted by total desc, totals row; uncategorised legacy EXPENSE rows appear as `အခြား`.
- Existing credit and deposit sections unchanged; credit rows gain nothing (method lives on the payments).

## New report kinds (`buildReport`)
- `exp` → `💸 ကုန်ကျစရိတ်` button: this month's EXPENSE rows (`ရက် · အမျိုးအစား · ငွေ · နည်းလမ်း · မှတ်ချက်`) per shop + the by-category section. `fileName: 'expenses-<yyyy-mm>'`.
- `customer` (`CS|<custId>`): title `ဝယ်သူ စာရင်း · <name>`, subtitle phone; sections: summary (bought, paid, owed, deposit held, last visit), transactions (`ရက် · အမျိုးအစား · ပစ္စည်း · ငွေ · ငွေလက်ခံ · နည်းလမ်း`, live rows only), open credits for this customer, deposits. `fileName: 'customer-<id>-<day>'`. Shop-scoped for staff, all shops for owners (same rule as other reports).

## Receipts
`receiptText` adds `ပေးပြီး {paid} ({method})` when the sale (or its payments) used one non-cash method; mixed → list `ငွေသား 6,000 · KBZPay 6,000`. `receiptNumber` skips voided groups and is stable across rewrites because the GroupID no longer changes.

## Monthly auto-send (`sendMonthlyReport`)
Unchanged mechanics; the PDF now carries the two new sections.

## Dashboard tab (`writeDashboard`)
Per shop, both blocks: `Cash in (drawer)` and `Cash in (bank)` columns next to `Cash in` (same formula with `Ledger!$U:$U,"CASH"` and `"<>CASH"` criteria; blanks count as drawer because the criterion `"CASH"` misses them, so add `+SUMIFS(..., Ledger!$U:$U, "")` to the drawer column for legacy rows). New block `Expenses by category (this month)`: one row per key in `expense_categories`, `SUMIFS(Amount, Day, $D$2&"*", Type, "EXPENSE", Category, key)` negated. Existing cells keep their addresses.

## Customers tab (view columns F:K)
Rewritten by `refreshViews` after any write with a CustomerID: Bought, Paid, Owed, DepositHeld, LastVisit, Visits (definitions in data model). `rebuildViews()` from the editor refreshes all three views.

---

# Tests

Add to `poc/run_scenario.js` after step 33 (same helpers: `sim.start`, `sim.tapLast`, `sim.tapAny`, `sim.voice`, `sim.text`, `sim.button`, `lastRow`, `item`). Seed: `sim_seed.js` gives the September credit sale `method:'CASH'` and leaves one seeded EXPENSE row without `method` to exercise the legacy default; `sim_mock_ai.js` learns `KBZ|Wave|ဘဏ်|ငွေသား` → `method` and category labels → `category`, and `METHOD` intent for "<method> နဲ့ ပေး(သွား)တယ်" with no quantity or amount.

```
34. Button sale is CASH by default and offers bank buttons
    sim.start(sister,'S1-0002'); tapLast('ရောင်း ၂')
    ✔ lastRow().method === 'CASH'
    ✔ button(lastBot,'KBZPay') === 'PM|'+groupId+'|KBZ' && button(lastBot,'WavePay') && button(lastBot,'ဘဏ်လွှဲ') && button(lastBot,'ဝယ်သူ')
    ✔ callback data length < 64 for every button on the card

35. Mark the sale as KBZPay: rewrite keeps the group
    const g = lastRow().groupId; const n = world.ledger.length; const rcpt = receiptNumber(ports, g)
    tapLast('KBZPay')
    ✔ world.ledger.length === n+2 && both new rows have groupId === g
    ✔ mirror row: reversesTxId set, cash === -36000, method === 'CASH'; replacement: method === 'KBZ', cash === 36000, time === original time
    ✔ saleGroupInfo(ports,g).total === 36000 && .cash === 36000 && .owed === 0 && liveRows(...).length === 1
    ✔ dayStats(ports,'S1',today).byMethod.KBZ.in === 36000 and byMethod.CASH.in dropped by 36000; cashIn unchanged
    ✔ receiptNumber(ports,g) === rcpt (number stable), lastText includes 'KBZPay'
    ✔ item('S1-0002').stock unchanged by the rewrite

36. Undo after a method change voids the sale once
    tapLast('မှားသွားတယ်')
    ✔ saleGroupInfo(ports,g).voided && stock restored && byMethod.KBZ.in === 0
    tap the same Undo again → ✔ lastText includes MSG.undo_already (no rows written)

37. Rewrite refused on another day
    sell 1; world.clock advance +1 day; tap 'KBZPay'
    ✔ lastText === MSG.expired && world.ledger.length unchanged; clock restored

38. Attach a customer to a fully paid sale
    sell 1 (S1-0003); tapLast('ဝယ်သူ'); tapAny('ဒေါ်မြင့်')
    ✔ live SALE row customerId === 'C-0001' && cash === amount
    ✔ openCredits(ports,'S1') count unchanged (no credit opened)
    ✔ card keeps 'မကျေသေး' and has no 'ငွေလက်ခံ' (afterSaleKeyboard now derives isCredit from owed)
    ✔ customerSummary(ports,'C-0001').bought increased by the sale amount, .owed unchanged

39. New customer with a phone, typed with Burmese digits and spaces
    sell 1; tapLast('ဝယ်သူ'); tapLast('နာမည်အသစ်'); sim.text(sister,'မစုစု')
    ✔ customer created, button 'ဖုန်း ထည့်' present
    tapLast('ဖုန်း ထည့်'); const rows = world.ledger.length; sim.text(sister,'09 ၇၇၇ 123 456')
    ✔ getCustomer(new).phone === '09777123456' && world.ledger.length === rows (phone did not become a price)
    ✔ lastText includes '+95 977' (tappable international form)

40. Customers menu, history card, statement PDF
    sim.start(sister,''); tapLast('ဝယ်သူများ'); tapAny('ဒေါ်မြင့်')
    ✔ text includes 'ဝယ်ပြီး', 'ပေးပြီး', 'ကျန်', 'စရံ', 'နောက်ဆုံး' and a line with 'KBZPay' or 'ငွေသား'
    ✔ buttons: 'စာရင်း PDF' present; 'ငွေလက်ခံ' present iff customerSummary().owed > 0
    tapLast('စာရင်း PDF') ✔ lastBot.document.name starts 'customer-C-0001'
    tapLast via menu 'ဝယ်သူများ' → 'ရှာ' → sim.text('0977') ✔ button for မစုစု offered (search by digits)

41. Voice sale with method
    sim.start(sister,'S1-0002'); sim.voice(sister,'ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်')
    ✔ proposal text includes 'KBZPay'; tapLast('မှန်တယ်') ✔ lastRow().method === 'KBZ' && source === 'VOICE'

42. Voice method-only after a button sale
    sim.start(sister,'S1-0002'); tapLast('ရောင်း ၁'); sim.voice(sister,'Wave နဲ့ ပေးသွားတယ်')
    ✔ proposal includes 'WavePay' and the sale amount; tapLast('မှန်တယ်')
    ✔ live row of that group has method === 'WAVE'; groupId unchanged

43. Payment and deposit by bank
    menu 'ငွေလက်ခံ' → pick the 500,000 credit → 'အကုန်' → tapLast('KBZPay')
    ✔ live PAYMENT row method === 'KBZ', refGroupId still the sale, openCredits empty
    menu 'စရံ' → 'ဒေါ်ခင်' → '100,000' → 'ကျော်' → tapLast('ဘဏ်လွှဲ')
    ✔ live DEPOSIT row method === 'BANK' && depositsFor('C-0002') unchanged by the rewrite

44. Expense by buttons, cash
    sim.start(sister,''); tapLast('ကုန်ကျ')
    ✔ category buttons include 'ဖုန်းဘေလ်' and 'ထမင်းဖိုး' (staff: no shop question)
    tapLast('ဖုန်းဘေလ်') ✔ amount presets shown, 'အခြား' present
    tapLast('10,000') ✔ method buttons, 'ငွေသား' first
    tapLast('ငွေသား') ✔ asks note with 'ကျော်'
    tapLast('ကျော်')
    ✔ lastRow(): type EXPENSE, amount -10000, cash -10000, category 'phone', method 'CASH', shop 'S1', itemId ''
    ✔ reply has Undo; dayStats(...).expenses increased by 10000; expensesByCategory.phone.total === 10000

45. Expense with typed amount, bank, typed note
    'ကုန်ကျ' → 'ထမင်းဖိုး' → 'အခြား' → sim.text('၁၂၅၀၀') → 'KBZPay' → sim.text('နေ့လယ်စာ ၃ ယောက်')
    ✔ row: amount -12500, category 'food', method 'KBZ', note 'နေ့လယ်စာ ၃ ယောက်'
    ✔ byMethod.KBZ.out === 12500

46. Owner expense asks the shop first
    sim.start(owner,''); tapLast('ကုန်ကျ') ✔ buttons 'ဆိုင် ၁' 'ဆိုင် ၂'; tapLast('ဆိုင် ၂') → 'ကားခ' → '5,000' → 'ငွေသား' → 'ကျော်'
    ✔ row shop 'S2', category 'transport'

47. Voice expense with category and method
    sim.voice(sister,'ဖုန်းဘေလ် တစ်သောင်းခွဲ KBZ နဲ့ ပေးလိုက်တယ်') (mock: 15000)
    ✔ proposal includes 'ဖုန်းဘေလ်' and 'KBZPay'; confirm ✔ category 'phone', method 'KBZ', amount -15000

48. Expense presets learn from history
    ✔ expensePresets(ports,'phone') starts with 10000 and 15000 (the two amounts used), padded from Settings

49. Reports carry method and category
    const m = buildReport(ports,'month',{shop:null})
    ✔ sections include heading 'ငွေလက်ခံ နည်းလမ်းအလိုက်' with a KBZPay row whose 'in' equals monthStats byMethod.KBZ.in
    ✔ section 'ကုန်ကျစရိတ် အမျိုးအစားအလိုက်' has a 'ဖုန်းဘေလ်' row with total 25000 and count 2
    ✔ summary row has 'ငွေသား' + 'ဘဏ်' cells summing to the 'ငွေလက်ခံ' cell
    const d = buildReport(ports,'today') ✔ columns include 'နည်းလမ်း'
    const e = buildReport(ports,'exp') ✔ kind 'exp', rows.length === number of this month's live EXPENSE rows

50. Daily summary reconciles drawer and bank
    const s = buildDailySummary(ports, today)
    ✔ includes 'ငွေသား' and 'ဘဏ်'; parsed cash + bank === dayStats(...).cashIn for S1

51. Legacy row without Method counts as cash
    ✔ the seeded EXPENSE row with method undefined appears in byMethod.CASH.out; day report shows 'ငွေသား' for it

52. Settings override of pay methods
    world.settings.pay_methods = 'CASH,BANK'; sell 1
    ✔ exactly one 🏦 button ('ဘဏ်လွှဲ'), no 'KBZPay'; restore setting

53. PC / scanner path: typed tag opens the card without AI
    const aiCalls = world.aiCalls; sim.text(sister,'s1-0002')
    ✔ lastText includes 'S1-0002' and a 'ရောင်း ၁' button && world.aiCalls === aiCalls
    sim.text(sister,'https://t.me/SalesTagBot?start=S1-0005') ✔ card for S1-0005

54. Credit conversion keeps the group id (regression for the rewrite refactor)
    sell 1 (S1-0003); const g = lastRow().groupId; 'မကျေသေး' → '0' → 'ဒေါ်မြင့်'
    ✔ openCredits includes groupId g with owed === amount; receiptNumber(ports,g) unchanged
    ✔ 'ငွေလက်ခံ' button data === 'PY|'+g (no re-rendered id)
    ✔ undo on g voids it and closes the credit

55. Customers view columns
    const cs = customerSummaries(ports); const m = cs.find(c => c.id==='C-0001')
    ✔ m.bought === Σ SALE/RETURN amounts for C-0001, m.owed === Σ openCredits owed for C-0001, m.lastDay === today, m.visits >= 2
    ✔ sim store refreshViews was called with 3 arguments after the last customer write

56. Expired expense state
    'ကုန်ကျ' → 'ကားခ'; world.cache clear 'st:'+sister; tapLast('5,000')
    ✔ lastText === MSG.expired, no row written
```

Expected count after this step: 109 + about 60 checks. `node poc/run_scenario.js` must still exit 0; the printed Ledger tail should show the Method and Category columns.

---

# Risks

## Conflicts with the append-only rule
- None by design. All corrections (method, customer, credit) are mirror row + replacement row via `writeGroup`. The only in-place writes are Customers.Phone (master data, same class as Items edits that already exist) and the Customers view columns F:K and Credits/Deposits (script-written views, already the pattern).
- The one real change to ledger semantics is "a rewrite keeps the GroupID", which requires redefining live rows in `saleGroupInfo`, `undoGroup` and `openCredits`. If that refactor is judged too risky for the pilot, fall back to the current new-GroupID behaviour; the cost is receipt renumbering after a method change and re-rendering keyboards with the new id. Tests 35, 36 and 54 pin the chosen behaviour either way.
- A rewrite after midnight would spread one event over two Days; refused by the same-day rule. A method fix for yesterday's row is then done by hand as a reversing pair, like any other old correction (runbook unchanged).

## Existing bugs surfaced while reading, worth fixing in this step
- `convertSaleToCredit` re-commits with processing time, not the sale's time: a credit conversion at 00:05 moves the sale to the next Day. Fixed by `when = row.time` in `rewriteGroup`.
- `afterSaleKeyboard(..., isCredit)` is passed `!!customerId` in `confirmProposal`: a voice sale naming a customer but fully paid hides `💳 မကျေသေး` and shows `ငွေလက်ခံ`. Fixed by deriving from `owed > 0`.
- `receiptNumber` counts voided (undone) sale groups, so receipt numbers have gaps after undos. Fix: skip `voided` groups.
- `handleText` parses any number first; a typed phone number in any state other than the new `await_text` would be taken as a price. The phone state is checked first; also consider refusing numbers > 50,000,000 in `applyAwaitedNumber` as a guard.

## Myanmar / zero-cost constraints
- Nothing new runs on the Myanmar side except Telegram (already measured) and, optionally, Google Sheets on a PC (docs.google.com measured; the sign-in flow via accounts.google.com should be tried once from the shop, test T6).
- KBZPay / WavePay / bank are labels only. No wallet API, no reconciliation import; the owner compares the report's per-method totals with the app statements by eye. Any API integration would need a merchant account and is out of scope for zero cost.
- The HtmlService console (if built) is served through a `*.googleusercontent.com` sandbox frame; its reachability from Myanmar has not been measured. Run the OONI web_connectivity query before promising it; same caveat already applies to Plan B in §12.1.
- Telegram Desktop / web.telegram.org use the same Telegram infrastructure as the app; the OONI Telegram test covers web.telegram.org. No VPN, no proxy, as before.
- The shop's USB barcode scanner may be 1D-only; adding a Code128 of the id under the QR on the tags covers it. Tags already printed would need reprinting for that, or the PC user types the id.

## Usability (zero computer literacy)
- The after-sale card grows from 2 to 3 rows of buttons. The default path is unchanged (two taps, cash); the new buttons are optional. If the sister finds three bank buttons noisy, `pay_methods = CASH,BANK` collapses them to one.
- Expenses by buttons are four taps; voice remains the shortcut. Category labels and order are hers to edit in Settings/Messages without code.
- Phone capture is never asked inside a money flow and never validated hard; a wrong phone is visible on the customer card and fixable with the same button.

## AI
- Gemini must map "KBZ", "Wave", "ဘဏ်" said inside Burmese to the method enum; English brand names in Burmese speech are untested. Add five such notes to the Phase 0 T2 set. The METHOD intent is low-risk: it only ever proposes, and ✅ is required.
- `category` is free text from the model; mapping to keys falls back to `other` with the spoken reason kept in Note, so no expense is lost to a bad category.

## Quotas and size
- Two more Ledger columns and six Customers columns: negligible. `customerSummaries` walks the ledger once per write with a CustomerID (same cost class as `openCredits` today). `refreshViews` writes one more block; still one execution well under the 6-minute limit.
- Callback data stays under 64 bytes: longest is `CUP|<36-char uuid>|C-0001` = 46 bytes.

## Out of scope here, but shaped by this step
- Tailoring measurements (user point 4): hang off CustomerID in a new Measurements tab with a dated row per measurement set, plus the existing DEPOSIT → SALE → receipt chain for the receipt book. The customer card (`CH`) is where a `📏 အတိုင်းအတာ` button will go.
- Notifications (user point 1): not touched here; nothing in this step sends more messages than before except the optional owner ping already present.

---

Estimate: 6 days
