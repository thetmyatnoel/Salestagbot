# Custom tailoring (made-to-measure) module for SalesTagBot

Design note, 2026-11-02. Fits the existing Apps Script + Sheets + Telegram system (`apps-script/core_*.js`, `gas_*.js`) and its accounting rules: revenue when goods leave, deposits held until delivery, append-only ledger, corrections as reversing rows, Burmese-only UI, zero monthly cost, nothing on the family side that is unreachable from Myanmar.

## 0. What the two paper books contain (from the photos)

**Book 1, body-measurement sheet** (both shops' forms, "Thiri Khit" and "Won Yone", carry the same fields in the same two-column layout, so one unified form covers both):

- Header: အမည် (name), အပ်သည့်ရက် (order date, e.g. 15.10.2026), ရွေးမည့်ရက် (collection date, 30.10.26), ဖုန်းနံပါတ် (phone), အရေအတွက် (quantity).
- Left column (22 labels): လည်ပင်း neck · ပုခုံး shoulder · ရင် bust · ချိုင်း armhole · လက်မောင်းရင်း upper arm · လက်ဝ arm round (multi, e.g. 36/30/20) · လက်အရှည် sleeve length (multi, 20/37/58) · ရင်ကွာ bust-point gap · ရင်မြင့် bust height (17.5 seen) · ကျောကျယ် back width · ရင်ကျယ် chest width · ရင်အောက်ပတ်လည် under-bust · ရင်ပေါ်ပတ်လည် over-bust · ခါးအကျ waist drop · ခါး waist · တင်ကြီး hip · တင်သေး high hip · တင်အကျ hip drop · ကိုယ်အရှည် body length · ထမိန်အရှည် skirt length · ထမိန် ဘယ်/ညာ skirt left/right · ထမိန် အမျိုးအစား skirt type.
- Right column (10 labels): တံတောင်ဆစ် elbow · ရှေ့ကိုယ်အရှည် front length · နောက်ကိုယ်အရှည် back length · ဘောင်းဘီအတိုင်း (trousers:) ဝ waist round · ပေါင်ရင်း thigh · ဒူး knee · အရှည် length · ခြေဝ leg opening · ခါးမှဒူး waist-to-knee.
- Free area: handwritten notes (e.g. "ကိုယ်ရှည် 109", "ပုံ ပို့ပေးမည်") and a figure drawing for marking the design.

**Book 2, carbon voucher** (Thiri Khit, voucher 2531): customer name, phone with "Viber" written beside it, date, numbered lines "fabric + design code + description" (TSL-0018, TSL-18, TSL-0025), Qty / Price / Amount columns, Total, Advance, Amount (balance), signature.

Everything on both books maps onto the four tabs below plus the existing ledger.

## 1. Data model (new Sheet tabs)

Add to `CFG` in `core_config.js`; `gas_setup.js` creates the tabs; `gas_store.js` and `poc/sim_ports.js` get the matching store functions.

**Orders** — one row per voucher. Updated in place like Items (status, dates); money is never stored here, it is computed from the ledger.

| Column | Notes |
| --- | --- |
| OrderID | `V-2532`. Voucher number continuing the paper series; `order_next_no` in Settings seeds it (set to 2532 on go-live, i.e. last paper voucher + 1). Also the ledger GroupID of the delivery sale and the deep-link payload for a QR on the voucher PDF (`?start=V-2532`). |
| Shop | S1 / S2 |
| CustomerID | Customers tab (`C-0007`). Phone lives on the customer row. |
| OrderedDay | yyyy-mm-dd (Telegram message time, Asia/Yangon) |
| DueDay | ရွေးမည့်ရက် |
| DeliveredDay | set by the deliver flow |
| Status | ORDERED / CUTTING / SEWING / READY / DELIVERED / CANCELLED |
| StatusAt, StatusBy | last status change, staff id |
| Total | sum of OrderItems.Amount at order time (snapshot; re-summed if lines are edited before delivery) |
| MeasID | latest measurement session used for this order (Measurements.MeasID), blank if none |
| Notes | free text / voice transcript |
| CreatedBy, CreatedAt | staff id, ISO time |
| VoucherSentAt | when the voucher message was last produced |
| CancelNote | reason, set with CANCELLED |

**OrderItems** — numbered lines of the voucher.

| Column | Notes |
| --- | --- |
| OrderID, Line | `V-2532`, 1..n. LineID = `V-2532-1` is used as the ledger ItemID when no tag is attached. |
| DesignCode | `TSL-0018` from Designs, or blank ("no code") |
| Fabric | text, from fabric presets or typed (ပိုး, ချည်, ပုဝါ, customer's own fabric = ဝယ်သူအထည်) |
| Description | free text (e.g. ဝမ်းဆက်, ရင်ဖုံး) |
| Qty, UnitPrice, Amount | integers MMK; Amount = Qty × UnitPrice |
| Cost | optional per-line cost; blank by default (see ledger mapping, double counting) |
| ItemID | tag id if a hang tag is attached to the finished piece (`S1-0187`), else blank |

**Measurements** — one row per customer per measurement session. Fixed columns first, then one column per field key from MeasureFields. Values are stored as text so `36/30/20` and `17.5` survive.

| Column | Notes |
| --- | --- |
| MeasID | `M-00041` |
| CustomerID, OrderID | OrderID optional (measurements taken outside an order) |
| Day, StaffID | when, who |
| Source | FORM / PHOTO / CHAT / COPY (copied from the customer's previous session) |
| PhotoURL | Drive link to the photo of the paper sheet or the figure drawing, if any |
| Notes | free text, replaces the margin notes on the paper |
| `<key>` × ~32 | one column per MeasureFields.Key, e.g. `neck`, `shoulder`, `arm_round`, … The store maps header names dynamically, so adding a field = adding a row in MeasureFields and a header cell here. |

**MeasureFields** — the configurable unified form. The family edits labels and order here, no code change.

| Column | Notes |
| --- | --- |
| Key | `neck`, snake_case, never changes once used (it is the Measurements column header) |
| LabelMy | လည်ပင်း — what the bot, the form and the PDF show |
| LabelEn | neck — for the maintainer and the Gemini prompt |
| Group | upper / sleeve / waist_hip / skirt / trouser / general (Burmese group titles live in Messages: `mg_upper` အပေါ်ပိုင်း, `mg_sleeve` လက်, `mg_waist_hip` ခါး · တင်, `mg_skirt` ထမိန်, `mg_trouser` ဘောင်းဘီ, `mg_general` အထွေထွေ) |
| Multi | number of values, 1 default; 3 for လက်ဝ and လက်အရှည် (`36/30/20`) |
| Type | number / text (ထမိန် အမျိုးအစား, ထမိန် ဘယ်/ညာ are text) |
| Order | sort order inside the group |
| Active | TRUE/FALSE, hides a field everywhere without deleting its data |

Seed (32 rows): upper: neck, shoulder, bust, armhole, bust_gap (ရင်ကွာ), bust_height (ရင်မြင့်), back_width, chest_width, under_bust, over_bust, front_length, back_length, body_length; sleeve: upper_arm, arm_round (3), sleeve_length (3), elbow; waist_hip: waist_drop, waist, hip, high_hip, hip_drop; skirt: skirt_length, skirt_lr (text), skirt_type (text); trouser: tr_waist, thigh, knee, tr_length, leg_open, waist_knee; general: qty_note (text), extra (text).

**Designs** — the catalog behind codes like TSL-0018.

| Column | Notes |
| --- | --- |
| DesignCode | `TSL-0018`; letters + digits, uppercase; aliases such as `TSL-18` resolve by number |
| Name | Burmese name |
| Category | from CFG.CATEGORIES |
| PhotoURL, PhotoFileID | Drive copy + Telegram file id for instant card photos |
| BasePrice | integer MMK, first price button |
| DaysToMake | integer, default for the due-date buttons (e.g. 14) |
| Active, Note | |

**Ledger** — one new column appended at the end: `Method` (CASH / BANK / blank), written by the delivery payment and by any PAYMENT/DEPOSIT (the existing receive-payment and deposit flows gain a two-button step for it, which also answers the shop's "cash or bank transfer" request). Appending a column keeps every existing row and formula valid.

**Settings** keys added: `order_next_no`, `fabric_presets` (comma list), `due_presets` (7,14,21,30), `order_remind_days` (3), `meas_capture` (form / photo / chat: the default method shown first), `voucher_footer` (text printed under the voucher).

**Customers**: no new columns; `Note` keeps "Viber" when the seller marks the phone as a Viber number (button in the new-customer step).

## 2. Status lifecycle

| Status | Burmese | Who sets it | How |
| --- | --- | --- | --- |
| ORDERED | 📝 အော်ဒါ လက်ခံပြီး | seller | created by the new-order flow |
| CUTTING | ✂️ ဖြတ်နေ | tailor / designer | status button on the order card (optional step) |
| SEWING | 🧵 ချုပ်နေ | tailor | status button |
| READY | ✅ ပြီးပြီ · ရွေးနိုင် | tailor | status button; bot pings the seller's shop chat and (optionally) produces a ready message to forward to the customer |
| DELIVERED | 🚚 ပေးအပ်ပြီး | the deliver flow only | never a plain button; set when the delivery sale group is written; undo of that group sets it back to READY |
| CANCELLED | ✖️ ပယ်ဖျက် | owner only | cancel flow asks refund / keep deposit |

Rules: status moves forward only (buttons show only the next steps plus "back one step" for the tailor); DELIVERED and CANCELLED are terminal; every change writes StatusAt/StatusBy. The lifecycle is deliberately loose: a shop that never uses CUTTING/SEWING just taps READY, or goes straight to deliver from ORDERED (deliver is allowed from any non-terminal status).

## 3. Ledger mapping

See the `ledger_mapping` section (same text) — summary: DEPOSIT at order time with RefGroupID = OrderID; on delivery one SALE row per line in a group whose GroupID is the OrderID, Cash 0, plus DEPOSIT_APPLIED into that group and, if money is handed over on the day, a PAYMENT row in the same group with Method; anything still owed is a credit visible in the existing Credits view and receive-payment flow; cancellation = refund (negative DEPOSIT) or kept deposit (SALE of a cancellation fee + DEPOSIT_APPLIED).

## 4. Flows

See the `flows` section (same text): menu, new order (11 taps for the common case), order card, status, voucher, measurements (form / photo / chat), delivery, cancel, tag attach, reminders, reports.

## 5. Measurement capture: recommendation

See `measurement_capture_recommendation` (same text). Primary: Apps Script HtmlService web form opened from a Telegram `url` button, identity by a one-time token in the URL, saved through `google.script.run` with a confirmation message posted back to the chat. Fallback: photo of the filled paper sheet read by Gemini into the same fields with a confirm/fix screen. The chat questionnaire is kept only for single-field fixes and as the last resort.

## 6. Reminders and reports

- 21:00 summary gains two lines: `📅 ၃ ရက်အတွင်း ရွေးရမည့် အော်ဒါ: 2532 ဒေါ်မြင့် (၃၀ ရက်), …` for open orders with DueDay ≤ today + `order_remind_days`, and `⏰ ရက်လွန် အော်ဒါ: …` for DueDay < today. Owner's weekly summary adds the count and the deposits held against open orders.
- `🖨 စာရင်း` menu gains `[🧵 အော်ဒါစာရင်း]` (open orders PDF: voucher, customer, phone, lines, ordered, due, status, total, paid, owed; sorted by due) and the order card gains `[📏 အတိုင်း PDF]` (measurement sheet PDF per customer in the paper layout: header block, two columns label/value in the MeasureFields order and groups, notes, the photo link; printed for the tailor).
- Monthly report gains a section "အော်ဒါ ချုပ်" (custom-order revenue): orders delivered (count, revenue = SALE rows whose GroupID starts with `V-`), deposits received this month for orders, deposits still held against open orders, orders cancelled. Day/month stats functions get an `isOrder(groupId)` split the same way `samplesSold` is split today.

## 7. Phones and laptops

Telegram runs on phones, Telegram Desktop and the web. Every bot flow works the same on a laptop; the measurement web form is the piece that benefits most from a laptop keyboard (the `url` button opens it in the default browser on desktop). No separate PC software is needed, and the Sheet itself remains readable on any computer for the maintainer.

## 8. Risks, tests, effort

See `risks`, `tests` and `estimate_days`. Total about 14 working days; about 12 if the photo-to-Gemini path is left to a later phase after a Phase 0 style accuracy test on 20 real sheets.

---

# Data model

## Orders
| Column | Notes |
| --- | --- |
| OrderID | V-2532. Voucher number continuing the paper series; Settings.order_next_no seeds it (set to last paper voucher + 1). Also the GroupID of the delivery sale group and the QR deep-link payload (?start=V-2532; matches the existing /start regex [A-Z0-9_-]). |
| Shop | S1 / S2 |
| CustomerID | Customers tab id (phone on the customer row) |
| OrderedDay | yyyy-mm-dd from the Telegram message time |
| DueDay | ရွေးမည့်ရက် |
| DeliveredDay | set by the deliver flow |
| Status | ORDERED / CUTTING / SEWING / READY / DELIVERED / CANCELLED |
| StatusAt, StatusBy | ISO time, staff id |
| Total | sum of OrderItems.Amount (snapshot, re-summed on line edits before delivery) |
| MeasID | latest Measurements.MeasID used for this order, optional |
| Notes | free text / voice transcript |
| CreatedBy, CreatedAt | |
| VoucherSentAt | last time the voucher message was produced |
| CancelNote | set with CANCELLED |

Money (deposit, paid, owed) is never stored on the row; `orderMoney(ports, orderId)` computes it from the ledger: deposits = DEPOSIT rows with RefGroupID = OrderID (net of negative refund rows), applied = DEPOSIT_APPLIED rows in group OrderID, payments = PAYMENT rows with RefGroupID = OrderID, owed = Total − applied − payments (before delivery: Total − deposits).

## OrderItems
| Column | Notes |
| --- | --- |
| OrderID, Line | V-2532, 1..n; LineID V-2532-1 is the ledger ItemID when no tag is attached |
| DesignCode | TSL-0018 from Designs or blank |
| Fabric | preset or typed text |
| Description | free text |
| Qty, UnitPrice, Amount | integers MMK, Amount = Qty × UnitPrice |
| Cost | optional, blank by default (avoid double counting with EXPENSE rows) |
| ItemID | hang tag id attached to the finished piece, else blank |

## Measurements
| Column | Notes |
| --- | --- |
| MeasID | M-00041 |
| CustomerID, OrderID | OrderID optional |
| Day, StaffID | |
| Source | FORM / PHOTO / CHAT / COPY |
| PhotoURL | Drive link to the paper sheet / figure photo |
| Notes | free text |
| one column per MeasureFields.Key | values stored as text ("36/30/20", "17.5"); the store maps headers dynamically |

## MeasureFields (configurable unified form)
| Column | Notes |
| --- | --- |
| Key | snake_case, immutable once used (it is the Measurements header) |
| LabelMy | Burmese label shown everywhere |
| LabelEn | English label (maintainer, Gemini prompt) |
| Group | upper / sleeve / waist_hip / skirt / trouser / general; Burmese group names in Messages (mg_upper အပေါ်ပိုင်း, mg_sleeve လက်, mg_waist_hip ခါး · တင်, mg_skirt ထမိန်, mg_trouser ဘောင်းဘီ, mg_general အထွေထွေ) |
| Multi | number of values, default 1; 3 for arm_round and sleeve_length |
| Type | number / text |
| Order | sort order within the group |
| Active | TRUE / FALSE |

Seed rows (32): neck လည်ပင်း, shoulder ပုခုံး, bust ရင်, armhole ချိုင်း, bust_gap ရင်ကွာ, bust_height ရင်မြင့်, back_width ကျောကျယ်, chest_width ရင်ကျယ်, under_bust ရင်အောက်ပတ်လည်, over_bust ရင်ပေါ်ပတ်လည်, front_length ရှေ့ကိုယ်အရှည်, back_length နောက်ကိုယ်အရှည်, body_length ကိုယ်အရှည် (group upper); upper_arm လက်မောင်းရင်း, arm_round လက်ဝ (3), sleeve_length လက်အရှည် (3), elbow တံတောင်ဆစ် (sleeve); waist_drop ခါးအကျ, waist ခါး, hip တင်ကြီး, high_hip တင်သေး, hip_drop တင်အကျ (waist_hip); skirt_length ထမိန်အရှည်, skirt_lr ထမိန် ဘယ်/ညာ (text), skirt_type ထမိန် အမျိုးအစား (text) (skirt); tr_waist ဝ, thigh ပေါင်ရင်း, knee ဒူး, tr_length အရှည်, leg_open ခြေဝ, waist_knee ခါးမှဒူး (trouser); qty_note အရေအတွက် (text), extra မှတ်ချက် (text) (general).

## Designs
| Column | Notes |
| --- | --- |
| DesignCode | TSL-0018, uppercase; TSL-18 resolves by number |
| Name, Category | Burmese name; category from CFG.CATEGORIES |
| PhotoURL, PhotoFileID | Drive copy + Telegram file id |
| BasePrice | first price button |
| DaysToMake | default due-date suggestion |
| Active, Note | |

## Ledger
One column appended: Method (CASH / BANK / blank) on PAYMENT, DEPOSIT and delivery rows. No other change; GroupID = OrderID for the delivery group, RefGroupID = OrderID on DEPOSIT and PAYMENT rows.

## Settings keys
order_next_no, fabric_presets, due_presets (7,14,21,30), order_remind_days (3), meas_capture (form | photo | chat), voucher_footer.

## CFG additions
ORDER_COLS, ORDER_ITEM_COLS, MEAS_FIXED_COLS, MEAS_FIELD_COLS, DESIGN_COLS, ORDER_STATUS {ORDERED, CUTTING, SEWING, READY, DELIVERED, CANCELLED}, PAY_METHOD {CASH, BANK}, SOURCE.FORM, DUE_PRESETS [7,14,21,30], ORDER_REMIND_DAYS 3. Store ports added: getOrder, listOrders(shop, statuses), addOrder, updateOrder, listOrderItems, addOrderItem, listDesigns, getDesign, listMeasureFields, addMeasurement, listMeasurements(customerId), getMeasurement; chat port added: sendMessage with a url button (btnUrl helper: {text, url}).

---

# Flows

Conventions: callback data is ACTION|arg|arg, all under 64 bytes (longest below: `ODP|V-2532|1500000` = 18 bytes). Burmese labels are drafts for the Messages tab. New callback prefixes (no clash with the existing S D R RQ T X U Y N P C PS SP K M Z CR CP CC CD PY PA DC DA DN RP RC RCP NB): O, ON, OC, OI, OF, OE, OP, OQ, OA, OD, OS, OV, OVP, ODL, ODP, ODM, OX, OXR, OT, MS, MM, MQ, MF, MK, ML, RP|ord, RP|meas. States (cache `st:<uid>`, 30 min TTL, cleared by Z): `{kind:'order', step: customer|name|phone|design|fabric|desc|price|qty|more|due|deposit, orderId, draft}` ; `{kind:'await_number', purpose: order_price|order_qty|deliver_paid|order_dep}` ; `{kind:'meas', step: method|q|fix|photo|notes, customerId, orderId, measId, i, fieldKey, values}` ; `{kind:'order_tag', orderId, line}`.

### F0. Menu
Menu gets a fourth row button `🧵 အော်ဒါ` (Orders) → `M|ord` → sub-menu:
`[➕ အော်ဒါအသစ် New order ON]  [📋 အော်ဒါများ Orders OL|open]  [📏 အတိုင်းအတာ Measurements MS|pick]`
`OL|open` lists open orders of the staff's shop (owner: all) sorted by DueDay as buttons `🧵 2532 · ဒေါ်မြင့် · ၃၀ ရက် · ✂️` → `O|V-2532` (order card). Overdue ones carry ⏰. Page of 8, `[▶️ နောက်ထပ် More OL|open|8]`.

### F1. New order (common case: known customer, catalog design, one line = 11 taps, typing only for a new name/phone and a description)
1. `🧵 အော်ဒါ` → `➕ အော်ဒါအသစ်` (`ON`). Bot allocates nothing yet; state order/customer.
2. "👤 ဝယ်သူ ဘယ်သူလဲ? Who is the customer?" buttons: 4 recent customers `👤 ဒေါ်မြင့်` (`OC|C-0007`), `✏️ နာမည်အသစ် New` (`OC|new`), `✖️ မလုပ်တော့ Cancel` (`Z`). Voice/text with a name also works (resolveOrCreateCustomer).
   2a. New: "✏️ နာမည် ရိုက်ပေးပါ Type the name" → text → "📞 ဖုန်းနံပါတ်? Phone" buttons `[⏭ ကျော် Skip OC|nophone]` ; text `09…` → "📱 Viber လား? Is this Viber?" `[✅ Viber OC|viber] [📵 မဟုတ် No OC|noviber]` (writes Customers.Note = Viber).
3. Order row is created now (`V-2532`, status ORDERED, DueDay blank) so a half-finished order is never lost; card header "🧵 ဘောက်ချာ 2532 · ဒေါ်မြင့်".
4. "🎨 ဒီဇိုင်း? Design" buttons: 6 most-ordered active designs `TSL-0018 · ဝမ်းဆက်` (`OI|V-2532|TSL-0018`), `✏️ ကုဒ်ရိုက် Type code` (`OI|V-2532|type`), `🚫 ကုဒ်မရှိ No code` (`OI|V-2532|none`). Typed `tsl18`, `TSL-18`, `18` resolve to TSL-0018; unknown code → "❓ မတွေ့ပါ" with the same buttons. A design with a photo is shown as a photo card.
5. "🧶 အထည်? Fabric" buttons from `fabric_presets` (`OF|V-2532|ပိုး`), `👜 ဝယ်သူအထည် Customer's fabric` (`OF|V-2532|own`), `✏️ အခြား Other` (type), `⏭ ကျော် Skip` (`OF|V-2532|-`).
6. "📝 ဖော်ပြချက် Description (type / voice / skip)" `[⏭ ကျော် OE|V-2532|-]`. Text or voice transcript stored verbatim.
7. "💰 စျေး? Price" buttons: design BasePrice first, then pricePresets for the design's category (`OP|V-2532|150000`), `✏️ အခြား` (`OP|V-2532|other` → await_number order_price).
8. "🔢 အရေအတွက်? Qty" `[၁ OQ|V-2532|1] [၂ …|2] [၃ …|3] [✏️ အခြား …|other]`. Line appended; card shows the running list "1. ပိုး + TSL-0018 · ဝမ်းဆက် × 1 · 150,000".
9. "➕ နောက်တစ်ကြောင်း ထပ်ထည့်မလား? Add another line?" `[➕ ထပ်ထည့် Add OA|V-2532|add] [✅ ပြီးပြီ Done OA|V-2532|done] [↩️ နောက်ဆုံးကြောင်း ဖျက် Remove last OA|V-2532|pop]`. Add loops to step 4.
10. "📅 ရွေးမည့်ရက်? Due date" buttons `[၇ ရက် OD|V-2532|7] [၁၄ ရက် …|14] [၂၁ ရက် …|21] [၃၀ ရက် …|30] [✏️ ရက်စွဲ ရိုက် Type a date OD|V-2532|type]`. If every line's design has DaysToMake, the largest is offered first as `✨ ၁၄ ရက် (TSL-0018)`. Typed dates accept 30.10.26, 30/10/2026, 30-10, Burmese digits; the bot echoes the resolved date in Burmese (၃၀ အောက်တိုဘာ ၂၀၂၆) before saving.
11. "📥 စရံ? Advance" buttons: `[အကုန် {total}]`, `[တစ်ဝက် {half}]`, depositPresets, `[0 OD… no: ODP? no: ODE|V-2532|0]`, `[✏️ အခြား]` → existing `finishDeposit` with customerId, note `V-2532`, refGroupId `V-2532`, then method `[💵 ငွေသား Cash ODM|<groupId>|CASH] [🏦 ငွေလွှဲ Bank …|BANK]` (writes Ledger.Method on the DEPOSIT row). 0 skips both.
12. Bot edits the card into the voucher message (F3) with buttons `[📏 အတိုင်းယူ Measure MS|V-2532] [🧾 PDF OVP|V-2532] [↩️ မှားသွားတယ် Undo U|<depositGroup>]` plus `[🧵 ကတ် Card O|V-2532]`. Undo here reverses the deposit only; the order row stays (cancel via F7 if the whole order was a mistake).

### F2. Order card (`O|V-2532`, also opened by scanning the voucher QR `?start=V-2532` or a tag attached to the piece)
Text: "🧵 ဘောက်ချာ 2532 · ဒေါ်မြင့် · 📞 09… (Viber)\n📅 အပ် ၁၅ အောက်တိုဘာ · ရွေး ၃၀ အောက်တိုဘာ (၃ ရက် ကျန်)\n1. ပိုး + TSL-0018 ဝမ်းဆက် × 1 · 150,000\n2. …\nစုစုပေါင်း 300,000 · စရံ 100,000 · ကျန် 200,000\n✂️ ဖြတ်နေ · 📏 အတိုင်း ရှိ (M-00041)".
Buttons by status:
- ORDERED/CUTTING/SEWING: row 1 next status(es) `[✂️ ဖြတ်နေ OS|V-2532|CUTTING] [🧵 ချုပ်နေ OS|…|SEWING] [✅ ပြီးပြီ OS|…|READY]` (only forward moves shown); row 2 `[📏 အတိုင်း Measurements MS|V-2532] [🧾 ဘောက်ချာ Voucher OV|V-2532]`; row 3 `[📥 စရံ ထပ်ပေး More advance ODE|V-2532] [🚚 ပေးအပ် Deliver ODL|V-2532]`; row 4 `[🏷 Tag တပ် Attach tag OT|V-2532] [✖️ ပယ်ဖျက် Cancel OX|V-2532]` (cancel only for owner).
- READY: row 1 `[🚚 ပေးအပ် Deliver ODL|V-2532]` large; row 2 `[📣 ဝယ်သူကို အကြောင်းကြား Ready message OV|V-2532|ready]` produces a short "ပြီးပါပြီ၊ လာရွေးနိုင်ပါပြီ" message to forward on Viber/Telegram; rest as above.
- DELIVERED: `[🧾 ဘောက်ချာ RC|V-2532] [💰 ငွေလက်ခံ PY|V-2532]` (the latter only while owed > 0; it is the existing payment flow because the group id is the order id).
- CANCELLED: `[🧾 ဘောက်ချာ OV|V-2532]` only.
`OS` writes Status/StatusAt/StatusBy, edits the card, and on READY sends `t('order_ready_ping')` to the shop's staff and the owner (notifyOwners pattern).

### F3. Voucher message (`OV|V-2532`, `OVP` for PDF)
"🧾 {shop}\nဘောက်ချာ 2532 · ၁၅ အောက်တိုဘာ ၂၀၂၆\nဝယ်သူ ဒေါ်မြင့် · 📞 09… (Viber)\n1. ပိုး + TSL-0018 · ဝမ်းဆက် × 1 · 150,000\n2. ချည် + ကုဒ်မရှိ · ရင်ဖုံး × 1 · 150,000\n──────────\nစုစုပေါင်း 300,000\nစရံ 100,000 (ငွေသား)\nကျန် 200,000\n📅 ရွေးမည့်ရက် ၃၀ အောက်တိုဘာ\n{voucher_footer}". The seller long-presses → forward to the customer's Telegram, or copies/screenshots into Viber (bots cannot post to Viber). `OVP` builds the same as an A5 PDF through gasPdf with a QR of `https://t.me/<bot>?start=V-2532` in the header so the voucher itself opens the order on delivery day. Numbering is the voucher number, no separate receipt number until delivery.

### F4. Measurements (`MS|V-2532` from an order, `MS|pick` from the menu which first asks the customer like F1 step 2, `MS|C-0007` direct)
Entry screen "📏 ဒေါ်မြင့် · အတိုင်းအတာ": if the customer has a previous session: "နောက်ဆုံး ၁၂ စက်တင်ဘာ (M-00031)" with `[📋 အဟောင်း သုံး Use previous MM|V-2532|copy] [🔄 အသစ်တိုင်း New MM|V-2532|new]`; else straight to the method row. Method row (order from Settings.meas_capture first): `[🌐 ဖောင် ဖွင့် Open form → url button] [📷 စာရွက် ဓာတ်ပုံ Photo of sheet MM|V-2532|photo] [💬 တစ်ခုချင်း မေး Ask one by one MM|V-2532|chat]`.
(a) Form: the url button carries `WEBAPP_URL?form=meas&t=<10-char token>`; the token is cached 30 min → `{uid, chatId, customerId, orderId, shop}`. The page (HtmlService, `doGet(e)` routes on `e.parameter.form`) shows the customer name, the groups in MeasureFields order, inputs with `inputmode="decimal"` (text inputs for Multi>1 with placeholder 36/30/20 and for Type text), a notes box, a camera input for the figure photo (base64 → Drive), and one `✅ သိမ်းမည် Save` button. Save → `google.script.run.saveMeasurementForm(token, values, photoB64)` → server validates the token (single use), writes the Measurements row (Source FORM), sets Orders.MeasID, posts to the staff's chat "📏 ဒေါ်မြင့် · M-00041 သိမ်းပြီး · ၂၈ ကွက်" with the grouped summary and `[✏️ ပြင် Fix MF|M-00041] [🧵 ကတ် O|V-2532]`, and the page shows "✅ သိမ်းပြီးပါပြီ · Telegram ကို ပြန်သွားပါ". Works on phone and laptop.
(b) Photo: state meas/photo; "📷 ဖြည့်ပြီး စာရွက်ကို ဓာတ်ပုံ ရိုက်ပို့ပါ (တည့်တည့်၊ အလင်းကောင်းကောင်း)". `handlePhoto` sees state meas → saves the photo to Drive (PhotoURL) → `ai.readMeasurementSheet(blob, {fields:[{key,labelMy,labelEn,multi}], hints})` → JSON `{fields:{neck:"32", arm_round:"36/30/20"…}, name, order_date, due_date, phone, notes, low_confidence:["bust_height"]}` → the bot writes nothing yet; it shows the grouped summary with ❓ beside low-confidence fields and `[✅ အကုန်မှန် All correct MK|<token>] [✏️ ပြင် Fix MF|<token>] [❌ မဟုတ်ဘူး N|<token>]`. MK writes the Measurements row (Source PHOTO, PhotoURL). The header name/dates/phone from the sheet are shown but only used to warn if the name does not match the chosen customer.
(c) Chat questionnaire: state meas/q with i; one message per active field "📏 ၃/၃၂ · ရင် (bust)?" with `[⏭ ကျော် Skip MQ|<token>|s] [⏮ နောက်ပြန် Back MQ|<token>|b] [✅ ဒီလောက်ပဲ Finish MQ|<token>|f] [✖️]`; the reply is a text or voice number (parseNumberText; `36/30/20` and `17.5` accepted as text for Multi/decimal fields); the bot edits the question message into "ရင် · 78" and sends the next one. Finish or the last field → summary + `[✅ သိမ်း MK] [✏️ ပြင် MF]`.
Fix (`MF|<token or measId>`): buttons of the groups → buttons of fields in the group showing current values `ရင်မြင့် · 17.5` (`ML|<tok>|bust_height`) → "✏️ ရင်မြင့် · ဂဏန်း ရိုက်ပါ" → text → back to the summary. Fixing a saved session appends a new Measurements row (Source = original, Notes "fix of M-00041"); rows are never edited.
Measurement PDF: order card / fix summary `[📏 PDF RP|meas|C-0007]` → `measurementReport` in the paper layout (header: name, ordered, due, phone, qty; two columns label | value in the MeasureFields order; notes; photo link; order lines) → `pdf.make` → sendDocument. The tailor prints it or reads it on the phone.

### F5. Delivery day (`ODL|V-2532`; 4 taps when fully paid in cash)
1. Open the order: scan the voucher QR / the attached tag, or Menu → အော်ဒါများ → pick.
2. `🚚 ပေးအပ်` → "🚚 ဘောက်ချာ 2532 · ဒေါ်မြင့်\nစုစုပေါင်း 300,000 · စရံ 100,000 · ကျန် 200,000\n💰 ယခု ပေးငွေ?" `[အကုန် 200,000 ODP|V-2532|all] [0 ODP|V-2532|0] [✏️ အခြား ODP|V-2532|other]` (other → await_number deliver_paid). If the customer's pooled deposits exceed the earmarked deposit the line "📥 စရံ ပိုရှိ 50,000 (အခြား)" appears and is included in the applied amount.
3. If paid > 0: "💵 ဘယ်လို ပေးလဲ?" `[💵 ငွေသား ODM|V-2532|CASH|200000] [🏦 ငွေလွှဲ ODM|V-2532|BANK|200000]` (34 bytes).
4. Commit `deliverOrder(ports, {orderId, paid, method, staff, updateId})` → ledger group V-2532: SALE per line (Cash 0, CostAtSale from OrderItems.Cost or blank, CustomerID, ItemID = tag or LineID, Note = fabric + design), DEPOSIT_APPLIED (min(held, total)), PAYMENT (paid, Method) in the same group with RefGroupID V-2532; Orders.Status DELIVERED, DeliveredDay. Reply: receipt text (multi-line buildReceipt for order groups) with `[↩️ မှားသွားတယ် U|V-2532] [🧾 PDF RCP|V-2532] [🏷 Tag တပ် OT|V-2532]` and, if owed > 0, "💳 ကျန် 50,000 · အကြွေး" with `[💰 ငွေလက်ခံ PY|V-2532]`; the open balance appears in the Credits view and the 21:00 summary like any credit sale.
Undo (`U|V-2532`) uses undoGroup (30 min window) and the bot sets Status back to READY and clears DeliveredDay.

### F6. Attach a tag to the finished piece (`OT|V-2532`, optional)
"🏷 ပစ္စည်းမှာ တပ်မည့် Tag ကို scan လုပ်ပါ" state order_tag; the next `/start S1-0187` on a BLANK tag registers the Items row (Name = design name + customer, Type UNIQUE, Price = line price, Sample false, Note V-2532-1), RESTOCK +1 (source SYSTEM, note "custom order"), writes OrderItems.ItemID; if the order is already DELIVERED the SALE row was written with the LineID, so the bot appends a RESTOCK +1 / SALE −1 pair against the tag at 0 amount? No: keep it simple — attaching a tag is allowed only before delivery; after delivery the button is hidden. Scanning that tag later opens the order card (Items.Note → OrderID).

### F7. Cancel (`OX|V-2532`, owner only)
"✖️ ဘောက်ချာ 2532 ပယ်ဖျက်မလား? စရံ 100,000 ရှိသည်" `[💸 စရံ ပြန်အမ်း Refund OXR|V-2532|refund] [🏦 စရံ သိမ်း Keep OXR|V-2532|keep] [✖️ မလုပ်တော့ Z]` → method buttons for a refund → writes the rows in the ledger mapping, Status CANCELLED, CancelNote from an optional text.

### F8. Reminders (sendDailySummary)
buildDailySummary appends `summary_orders_due` ("📅 ၃ ရက်အတွင်း ရွေးရမည့် အော်ဒါ: 2532 ဒေါ်မြင့် (၃၀ ရက်), 2535 မခင် (၁ ရက်)") and `summary_orders_overdue` ("⏰ ရက်လွန် အော်ဒါ: 2529 ဒေါ်စု (၂ ရက် လွန်)") for status ∉ {DELIVERED, CANCELLED}; up to 5 each, the owner's weekly version lists all.

### F9. Reports
`RP|ord` open-orders PDF (per shop section; columns ဘောက်ချာ · ဝယ်သူ · ဖုန်း · ပစ္စည်း · အပ်ရက် · ရွေးရက် · အခြေအနေ · စုစုပေါင်း · ပေးပြီး · ကျန်; totals), `RP|meas|C-0007` measurement sheet PDF, monthly report section "အော်ဒါ ချုပ်" (delivered count, revenue, deposits received, deposits held for open orders, cancelled).

---

# Measurement capture recommendation

## The three methods

**1. Sequential chat questionnaire (30 questions)**
- Zero new technology; works wherever the bot works; voice answers possible.
- Cost: one webhook round trip per field. From Myanmar a round trip is 2–5 s (section 7 T5 target < 5 s), so 30 fields take 2–4 minutes of waiting plus typing; the chat scrolls into a 60-message wall; a mistake three questions back needs "back" taps. Telegram bots cannot force the phone's numeric keyboard: an inline keyboard cannot open a keypad, and a `ReplyKeyboardMarkup` digit pad would replace the user's normal keyboard and fight the inline buttons used everywhere else. Multi-value fields (36/30/20) and decimals (17.5) need text entry anyway.
- Verdict: fine for one or two fields, wrong for thirty. Keep it as the fix tool and the last-resort fallback.

**2. HtmlService web form opened from a Telegram button**
- One page, two columns in the paper's order, groups collapsible, `inputmode="decimal"` opens the numeric keypad on Android and iOS, text inputs for multi-value and text fields, a notes box, camera input for the figure drawing, one Save. 30 values arrive in one call; typing time only. Works on a laptop (the family asked), on Telegram Desktop and on any browser.
- Technical facts checked against the current Telegram Bot API and Apps Script docs:
  - Inline keyboards offer `url` buttons (open in Telegram's in-app browser on mobile, system browser on desktop) and `web_app` buttons (Telegram Mini App, HTTPS required, inline-keyboard web_app buttons work only in private chats — ours are private). Telegram Web and some desktop builds load Mini Apps in an iframe; HtmlService pages are themselves a script.google.com wrapper around a sandboxed script.googleusercontent.com iframe. `HtmlService.XFrameOptionsMode.ALLOWALL` is needed for the iframe case, and the Telegram Mini App bridge (`window.Telegram.WebApp.initData`, MainButton, close()) is not reliable from inside that nested iframe because the SDK talks to `window.parent`, which is Google's wrapper, not Telegram. So: use a plain `url` button, not `web_app`, and do not depend on initData.
  - Identity: the URL carries a one-time token (`?form=meas&t=ab12cd34ef`, 10 chars, CacheService 30 min, single use, bound to staff uid, customer, order, shop). Anyone without a valid token sees "link expired, tap the button again". No login, no Google account on the family side: the web app is already deployed "Execute as me / Anyone" for the webhook, and `google.script.run` works for anonymous visitors under that deployment.
  - Posting back: the page calls `google.script.run.withSuccessHandler(...).saveMeasurementForm(token, values, photoB64)`; no CORS, no redirect handling, runs as the owner, writes the Sheet, and sends the Telegram confirmation message to the staff chat through `gasChat` (chat id from the token). `doPost` stays the Telegram webhook only. If a non-HtmlService host is ever used (the Plan B web app), the same handler is reachable through `doPost` with `e.parameter.form === 'meas'` and a `text/plain` body (the one content type Apps Script accepts cross-origin without preflight), but that is not needed now.
  - `doGet(e)` currently ignores parameters; it gains `if (e.parameter.form === 'meas') return measurementPage(e.parameter.t)` and keeps returning the "POS bot is running" text otherwise. `/exec` 302-redirects to googleusercontent; Telegram's in-app browser (Chrome Custom Tabs on Android, SFSafariViewController on iOS) follows it. Google domains measure reachable from Myanmar (OONI, section 12.1).
  - The page is also the print layout: the same template renders the measurement PDF, so the tailor's printout looks like the form the seller filled.
- Verdict: best fit. One tap to open, one tap to save, numeric keypad, laptop-friendly, Burmese labels straight from MeasureFields.

**3. Photo of the filled paper sheet read by Gemini**
- Keeps the paper habit during the transition: the tailor measures with the book as today, someone photographs the page, the bot proposes all 30 values, the seller taps "all correct" or fixes one or two. One tap plus a photo.
- Why it is tractable: the labels are printed in a fixed layout and the numbers are handwritten Arabic digits in cells beside them; the prompt lists the fields (key + Burmese label + English label + multi count) in the sheet's order and asks for JSON keyed by key with strings, a `low_confidence` list, and the header fields (name, dates, phone). Gemini Flash reads printed Burmese well and handwritten digits reasonably; `responseSchema` forces the shape; temperature 0.
- Limits: Telegram compresses photos to about 1280 px on the long side, so a whole A5 page gives roughly 15–20 px per digit; glare, blue-pen smudges (visible on the first photo), 1/7 and 0/6 confusions, mixed Burmese digits, a rotated or upside-down page (the second photo), struck-through corrections. Expect 90–97 % per-field accuracy before confirmation, which is why the confirm/fix screen is mandatory and low-confidence fields are flagged. Each sheet costs one image call (~1,300 tokens), well inside the quota, and the photo is kept in Drive as the ground truth.
- Verdict: good fallback and a good bridge for the first weeks; not primary because it preserves the paper book the shop wants to retire, and because its accuracy cannot be promised until tested on 20 real sheets.

## Recommendation

Primary: the HtmlService web form (method 2). Fallback: the photo-to-Gemini path (method 3), offered on the same method row and used while the paper book is still around or when the form page cannot be opened. The chat questionnaire (method 1) stays as the fix tool (`✏️ ပြင်` → pick field → type) and as the last resort if script.google.com is ever unreachable while Telegram is not.

Pilot plan: ship form + fix first (about 3 days), run the photo path behind a Settings flag (`meas_capture_photo = TRUE`) once 20 photographed sheets from the shop score at least 95 % of fields correct after confirmation and at least 85 % before it; order the method buttons by `Settings.meas_capture` so the family can make whichever they prefer the first button.

---

# Ledger mapping

Principle unchanged from section 12.2 of the plan: revenue when goods leave, cash when it arrives. Only the GroupID/RefGroupID conventions are new, chosen so that the existing `saleGroupInfo`, `openCredits`, `applyDeposit`, `commitPayment`, `undoGroup`, `receiptNumber` and the Credits/Deposits views work on orders without modification.

| Moment | Rows | Fields |
| --- | --- | --- |
| Order created | none | the Orders/OrderItems rows carry no money |
| Advance at order time (F1 step 11, or `ODE` later) | DEPOSIT | Amount = Cash = advance, CustomerID, RefGroupID = OrderID (earmark), Note "V-2532", Method CASH/BANK, Source BUTTON/VOICE. Shows in Deposits held (pooled per customer, as today). |
| Status changes | none | |
| Delivery (F5) | SALE × n lines, all with GroupID = OrderID | per line: ItemID = OrderItems.ItemID (tag) or LineID `V-2532-1`, Qty = −Qty, UnitPrice, Amount = Qty × UnitPrice, **Cash 0**, CostAtSale = OrderItems.Cost or blank, CustomerID, Note = fabric + design + description, Source BUTTON. Revenue lands on the delivery day. |
| Delivery, deposit consumed | DEPOSIT_APPLIED in the same group | Amount = min(deposits held by the customer, order total); earmarked deposits for this order first, then the customer's pooled remainder (asked). Cash 0, RefGroupID = OrderID. Existing `applyDeposit` already does this given groupId = OrderID. |
| Delivery, money handed over | PAYMENT in the same group | Amount = Cash = paid now, RefGroupID = OrderID, Method CASH/BANK. `saleGroupInfo` sums PAYMENT rows by RefGroupID, so owed = total − applied − payments. |
| Balance unpaid | nothing extra | owed > 0 makes the group an open credit: Credits view, `💰 ငွေလက်ခံ` list, 30-day overdue line, all unchanged. Later payments are ordinary PAYMENT rows with RefGroupID = OrderID. |
| Undo delivery (30 min) | mirror rows of the whole group via `undoGroup` | SALE, DEPOSIT_APPLIED and the same-day PAYMENT reverse together; the bot resets Status to READY. |
| Cancel, refund deposit | DEPOSIT with negative Amount and Cash | RefGroupID = OrderID, Note "refund V-2532", Method; the customer's held deposit drops to zero, cash out is honest. |
| Cancel, deposit kept | SALE (ItemID `V-2532-X`, Qty 0, Amount = kept, Cash 0, Note "cancellation fee") + DEPOSIT_APPLIED same amount, GroupID = OrderID | revenue recognised on the day the order dies; nothing owed. |
| Tag attached before delivery | Items row registered + RESTOCK +1 (0 amount) | the delivery SALE then carries the real ItemID, stock goes 1 → 0, the stock formula and item card stay right. |

Why Cash = 0 on the SALE rows: `openCredits` skips a group when its first SALE row has `cash >= amount`; with several lines, spreading cash across lines would make that shortcut wrong, and a single PAYMENT row also records the method and the time cleanly. One alternative is a two-line change in `openCredits` (compute the group before the shortcut); the PAYMENT-row convention avoids touching it.

Costs and profit: the shop records fabric and thread purchases as EXPENSE rows today. If OrderItems.Cost is also filled, those materials would be counted twice in profit. Rule for the pilot: Cost blank, order profit = order revenue − expenses, as for everything else; fill Cost only when the owner wants per-order margin and that material was not expensed.

Stats: `statsWhere` gains `orderRevenue`, `ordersDelivered`, `orderDeposits` by the test `groupId starts with 'V-'` (same technique as `samplesSold`), used by the monthly report section and the owner summary. `receiptNumber` treats the order group like any sale group, so the delivery receipt still gets an R1-… number in the sequence; the voucher number stays the OrderID.

Code touch points: `commitDeposit` and `commitPayment` accept `refGroupId` and `method`; `newTx` writes `method`; `commitSale` gets a `groupId` override (writeGroup already honours `txs[0].groupId`); new `deliverOrder`, `cancelOrder`, `orderMoney`, `openOrders`, `ordersDue` in a new `core_orders.js`; `undoGroup` is unchanged, the bot handles the status rollback.

---

# Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Telegram callback_data 64-byte cap | long ids break buttons | OrderID (6–7 chars) + short prefixes keep the longest payload (`ODM|V-2532|BANK|2000000`) under 30 bytes; measurement tokens are 10 chars; never put field labels in callback data |
| Telegram message 4096 chars / keyboard size | 32-field summary with Burmese labels is ~1,500 chars, fine; 32 field buttons in one keyboard is unusable on a phone | fix screen is two-level (group → field); open-orders list paged by 8 |
| Telegram cannot send to Viber; bots cannot message a customer who never started the bot | the voucher reaches the customer only by forward/screenshot/PDF | voucher as copyable text + A5 PDF; "Viber" flag on the customer reminds the seller which app to use; a public customer channel is a later option |
| `web_app` buttons and the Mini App bridge inside HtmlService's nested iframe | initData empty, MainButton/close() no-ops, blank page on Telegram Web | use `url` buttons; identity by one-time token; the page has its own Save and a "go back to Telegram" line; `setXFrameOptionsMode(ALLOWALL)` set anyway |
| Apps Script web app must stay "Anyone" and keep the same deployment URL | a new deployment changes the URL and breaks both the webhook and the form links | already a runbook rule (section 6.10); the form URL is read from WEBAPP_URL at request time |
| `google.script.run` payload with a photo (base64) and the 50 MB / 6-minute limits | large photos fail | the page downscales the figure photo to 1200 px before upload; measurements themselves are a few hundred bytes |
| Token expiry (30 min) while the tailor measures | Save fails | the page shows the expiry time; on failure it keeps the values in the page and tells the user to tap the button again and paste; server accepts a token refresh from the same uid within 2 hours |
| Google pages unreachable on a given day/SIM while Telegram works | form cannot open | photo path and chat questionnaire need only Telegram; the method row always shows all three |
| Gemini accuracy on handwriting (digits, 36/30/20, decimals, rotated pages, smudges, Burmese digits) | wrong measurements reach the tailor | confirm/fix is mandatory, low-confidence flags, photo kept as ground truth, Phase 0 style test on 20 real sheets before enabling, Settings flag to turn the path off |
| Gemini quota exhausted or API down | photo path fails | falls back to the form/chat buttons, as voice does today |
| Two staff edit the same order at once | lost status update | status writes go through LockService like ledger appends; status moves are idempotent (same status twice is a no-op) |
| Orders tab edited in place (status, dates) | history of status changes lost | StatusAt/StatusBy plus an optional OrderEvents append tab if the owner wants the timeline; money history is in the ledger regardless |
| Delivery SALE rows with Cash 0 and the `openCredits` first-row shortcut | a fully paid order wrongly listed as a credit | the PAYMENT-row convention makes owed 0 and `saleGroupInfo` drops it; test case 9 covers it |
| Deposit pooling per customer | a customer with two open orders can have one order's deposit applied to the other | earmark by RefGroupID applied first; pooled remainder only after a yes/no button; both shown on the order card |
| Double counting of material cost | profit understated | Cost blank by default (see ledger mapping) |
| Voucher number series collides with paper vouchers still in use | two documents with one number | set `order_next_no` to last paper number + 1 on go-live and retire the paper book the same day, or prefix the bot's numbers (e.g. 3001+) if both must coexist |
| Burmese rendering in the Sheets PDF export (still unverified in the live account) | measurement/voucher PDFs unreadable | same fallback as reports: build in a Google Doc with Noto Sans Myanmar; the HTML form template can also be exported with `HtmlService` → `getAs(PDF)` as a third route |
| Apps Script execution time on the 21:00 summary as Orders grow | trigger slow | orders scan is one tab read; archive DELIVERED/CANCELLED rows older than a year to an archive tab |
| Family literacy: 11 taps for an order is still long | staff avoid the flow and keep the voucher book | most taps are single-choice buttons; voice shortcuts ("ဒေါ်မြင့် ဝမ်းဆက် တစ်ထည် တစ်သိန်းခွဲ စရံ တစ်သိန်း") pre-fill customer, line, price and advance for a confirm screen; a laminated card with the 4 screens |

---

# Tests

Additions to `poc/run_scenario.js` (same harness: `sim.start`, `sim.tapLast`, `sim.tapAny`, `sim.text`, `sim.voice`, `sim.photo`, `lastRow`, `check`). Seed additions in `poc/sim_seed.js`: Designs TSL-0018 (ဝမ်းဆက်, BasePrice 150000, DaysToMake 14) and TSL-0025, MeasureFields 32 rows, Settings order_next_no 2532, fabric_presets ပိုး,ချည်,ပုဝါ, a sim photo preset `SIM_PHOTOS.measSheet` whose mock AI returns 30 field values with `bust_height` low-confidence, and `sim.openUrl(user, label)` which finds the url button, extracts the token and calls `saveMeasurementForm` directly (simulating the browser).

Step 20. New order, known customer, one line, 14 days, 100,000 advance in cash
- sim.start(sister) → tapLast('အော်ဒါ') → tapLast('အော်ဒါအသစ်') → tapLast('ဒေါ်မြင့်') → tapLast('TSL-0018') → tapLast('ပိုး') → tapLast('ကျော်') → tapLast('150,000') → tapLast('၁') → tapLast('ပြီးပြီ') → tapLast('၁၄ ရက်') → tapLast('100,000') → tapLast('ငွေသား')
- check order V-2532 exists, status ORDERED, DueDay = today + 14, Total 150000, one OrderItems row (TSL-0018, ပိုး, qty 1, 150000)
- check lastRow() is DEPOSIT amount 100000 cash 100000 refGroupId 'V-2532' method 'CASH' customerId C-0001
- check depositsFor(C-0001) === 100000; orderMoney('V-2532').owed === 50000
- check the voucher message contains 'ဘောက်ချာ 2532', '150,000', 'စရံ 100,000', 'ကျန် 50,000' and offers buttons 'အတိုင်းယူ', 'PDF', 'မှားသွားတယ်'
- check every callback_data on that message is ≤ 64 bytes (assert over all keyboards in the whole scenario at the end)

Step 21. New customer with Viber phone, two lines, typed code alias, typed due date, no advance
- tapAny('အော်ဒါအသစ်') → tapLast('နာမည်အသစ်') → text('မခင်စု') → text('09455042134') → tapLast('Viber') → tapLast('ကုဒ်ရိုက်') → text('tsl 18') → tapLast('ဝယ်သူအထည်') → text('ရင်ဖုံး') → tapLast('အခြား') → text('80000') → tapLast('၂') → tapLast('ထပ်ထည့်') → tapLast('ကုဒ်မရှိ') → tapLast('ချည်') → tapLast('ကျော်') → tapLast('150,000') → tapLast('၁') → tapLast('ပြီးပြီ') → tapLast('ရက်စွဲ ရိုက်') → text('30.10.26') → tapLast('0')
- check customer created with phone 09455042134 and note containing 'Viber'
- check order V-2533 has 2 lines, line 1 DesignCode 'TSL-0018' (alias resolved), line 2 DesignCode '', Total 310000, DueDay '2026-10-30'
- check no DEPOSIT row was written (ledger length unchanged since the order started)

Step 22. Undo of the advance keeps the order
- on V-2532's voucher message tapAny('မှားသွားတယ်') → check reversing DEPOSIT row (−100000), depositsFor(C-0001) === 0, order V-2532 still ORDERED; then re-add via order card tapAny('စရံ ထပ်ပေး') → '100,000' → 'ငွေလွှဲ' → check method 'BANK'

Step 23. Status moves and ready ping
- tapAny('ကတ်') on V-2532 → tapLast('ဖြတ်နေ') → check Status CUTTING, StatusBy sister; tapLast('ပြီးပြီ') → check Status READY and the owner received a message containing '2532'
- check the card of a READY order shows no 'ဖြတ်နေ' button (no backward moves) and shows 'ပေးအပ်'

Step 24. Measurements by web form
- card V-2532 → tapLast('အတိုင်း') → check method row has a url button whose url contains 'form=meas&t='
- sim.openUrl(sister, 'ဖောင်') with values {neck:'32', shoulder:'52', arm_round:'36/30/20', bust_height:'17.5', skirt_type:'ဘယ်ဘက်'} and notes 'ကိုယ်ရှည် 109'
- check Measurements row M-00001 for C-0001, OrderID V-2532, Source FORM, arm_round === '36/30/20' (string), bust_height === '17.5'; Orders.MeasID === 'M-00001'
- check the sister's chat got a summary message containing 'M-00001' and 'လက်ဝ · 36/30/20' with a 'ပြင်' button
- check reusing the same token returns {ok:false, reason:'expired'} and writes nothing

Step 25. Fix one field
- tapLast('ပြင်') → tapLast('အပေါ်ပိုင်း') → tapLast('ရင်မြင့်') → text('18') → check a new Measurements row M-00002 with bust_height '18', neck still '32', Notes contains 'M-00001'; M-00001 unchanged; Orders.MeasID === 'M-00002'

Step 26. Measurements by photo (mock Gemini)
- card V-2533 → 'အတိုင်း' → tapLast('စာရွက် ဓာတ်ပုံ') → sim.photo(sister, SIM_PHOTOS.measSheet) → check the proposal lists 30 values and marks 'ရင်မြင့်' with ❓; nothing written yet
- tapLast('အကုန်မှန်') → check Measurements row Source PHOTO with PhotoURL set, 30 fields filled, OrderID V-2533
- mock AI throws → photo again → check reply equals MSG.ai_down and the method row is shown again

Step 27. Measurements by chat, skip and finish
- 'အတိုင်း' on V-2533 → 'တစ်ခုချင်း မေး' → text('33') → tapLast('ကျော်') → voice('ခုနစ်ဆယ့်ရှစ်') → tapLast('ဒီလောက်ပဲ') → tapLast('သိမ်း') → check row Source CHAT with neck '33', shoulder '', bust '78'

Step 28. Copy previous measurements
- 'အတိုင်း' on a new order for C-0001 → tapLast('အဟောင်း သုံး') → check new row Source COPY equal to M-00002's values

Step 29. Delivery, balance paid in cash in full
- card V-2532 → tapLast('ပေးအပ်') → check text shows 'ကျန် 50,000' → tapLast('အကုန်') → tapLast('ငွေသား')
- check ledger group 'V-2532' has SALE (qty −1, amount 150000, cash 0, itemId 'V-2532-1', customerId C-0001), DEPOSIT_APPLIED 100000, PAYMENT 50000 method CASH refGroupId 'V-2532'
- check saleGroupInfo('V-2532').owed === 0; openCredits(S1) does not contain V-2532; depositsFor(C-0001) === 0; order Status DELIVERED, DeliveredDay today
- check dayStats(S1).revenue increased by 150000 and orderRevenue === 150000; receipt text lists the line and 'စရံ 100,000'
- check the reply has 'မှားသွားတယ်' and no 'ငွေလက်ခံ' button

Step 30. Undo delivery
- tapLast('မှားသွားတယ်') → check three mirror rows, Status READY, DeliveredDay '', depositsFor(C-0001) === 100000, revenue back to the previous value

Step 31. Delivery with balance left as credit, then payment by bank
- deliver V-2533 (owed 310000) → tapLast('0') → check no PAYMENT row, SALE × 2 rows cash 0, openCredits(S1) contains group V-2533 owed 310000, reply has 'ငွေလက်ခံ'
- tapLast('ငွေလက်ခံ') → tapLast('အကုန်') → tapLast('ငွေလွှဲ') → check PAYMENT 310000 method BANK refGroupId V-2533, owed 0, Credits view empty for V-2533

Step 32. Deliver with a tag attached
- new order V-2534 for C-0002 (who holds the seeded 300,000 deposit), line 200000; card → 'Tag တပ်' → sim.start(sister, 'S1-0010') (a BLANK tag) → check Items S1-0010 ACTIVE UNIQUE price 200000 stock 1, OrderItems.ItemID 'S1-0010'
- deliver, paid 0 → check SALE itemId 'S1-0010', stock 0, DEPOSIT_APPLIED 200000 (pooled deposit used), depositsFor(C-0002) === 100000, owed 0
- sim.start(sister, 'S1-0010') → check the order card for V-2534 opens (not the item card)

Step 33. Cancel with refund and cancel keeping the deposit (owner only)
- sister taps 'ပယ်ဖျက်' on an open order → check MSG.owner_only-style refusal; owner: 'ပယ်ဖျက်' → 'စရံ ပြန်အမ်း' → 'ငွေသား' → check DEPOSIT row amount −100000 cash −100000 refGroupId set, depositsFor === 0, Status CANCELLED
- another order with 50,000 advance → owner 'ပယ်ဖျက်' → 'စရံ သိမ်း' → check SALE qty 0 amount 50000 cash 0 note contains 'cancellation' + DEPOSIT_APPLIED 50000 in group = OrderID, revenue +50000, deposits held 0

Step 34. Reminders in the 21:00 summary
- set clock to DueDay − 3 of an open order → buildDailySummary contains 'ရွေးရမည့် အော်ဒါ' and the voucher number; set clock to DueDay + 2 → contains 'ရက်လွန် အော်ဒါ'; delivered/cancelled orders never appear

Step 35. Reports
- tapAny('စာရင်း') → tapLast('အော်ဒါစာရင်း') → check pdf.make received kind 'orders' with one row per open order, columns include 'ကျန်', totals row
- card → 'PDF' (measurement) → check kind 'meas', header rows contain the customer name and due date, 32 label/value rows in MeasureFields order, 'လက်ဝ' row value '36/30/20'
- buildReport('month') → check a section 'အော်ဒါ ချုပ်' with delivered count, revenue and deposits received for the month

Step 36. MeasureFields configurability
- set MeasureFields row 'bust_height' Active FALSE and rename LabelMy of 'neck' to 'လည်' → start the chat questionnaire → check the first question says 'လည်' and the questionnaire asks 31 questions; the form page HTML (measurementPage(token)) contains 'လည်' and not 'ရင်မြင့်'; the saved row still has a bust_height column (left blank)

Step 37. Guards
- a customer (non-staff) opening '/start V-2532' gets staff_only; a sister from S2 opening an S1 order sees the card read-only (no deliver button) unless owner; 'ODP' on a DELIVERED order replies MSG.expired; token-less GET '?form=meas' returns the expired page; callback_data byte-length assertion over every keyboard emitted in the scenario ≤ 64; final count: all checks pass, Errors tab empty except the deliberate ai_down line.

---

# Estimate

Total about 14 working days (12 without the photo-to-Gemini path), split:

| Part | Days | Covers |
| --- | --- | --- |
| 1. Data model and stores | 1.5 | CFG columns and enums, gas_setup tabs and seeds, gas_store + sim_ports functions (orders, items, designs, measure fields, measurements with dynamic columns), Ledger Method column, Settings keys |
| 2. Order creation, card, status, voucher | 2.0 | core_orders.js (next voucher number, orderMoney, openOrders, ordersDue), new-order flow with customer/design/fabric/price/qty/due/advance steps, alias resolution, order card and status buttons, ready ping, voucher text and A5 PDF with QR, menu and sub-menu, Burmese strings |
| 3. Delivery, cancel, tag, ledger mapping | 1.5 | deliverOrder (SALE per line, DEPOSIT_APPLIED, PAYMENT with method), undo with status rollback, credit hand-off to the existing payment flow, cancel refund/keep, tag attach and tag → order card, method buttons added to the existing deposit and payment flows |
| 4. Measurements: fields config, chat questionnaire, fix, copy | 1.0 | MeasureFields-driven questions, summary rendering, two-level fix, copy previous session |
| 5. Measurements: HtmlService form | 2.0 | doGet routing, token issue/validate, HTML template from MeasureFields (phone + laptop layout, decimal keypad, multi-value inputs, figure photo upload), saveMeasurementForm, chat confirmation, expiry handling, manual test in Telegram Android/iOS in-app browser and desktop |
| 6. Measurements: photo → Gemini | 1.5 (+0.5 test) | prompt and response schema from MeasureFields, readMeasurementSheet port, proposal with low-confidence flags, confirm/fix, Settings flag; half a day to run 20 real sheets and decide |
| 7. Reminders and reports | 1.5 | summary lines (due in 3 days, overdue), open-orders PDF, measurement sheet PDF in the paper layout, monthly custom-order section, stats split |
| 8. Tests and simulator | 1.5 | run_scenario steps 20–37, seed data, sim.openUrl and mock measurement AI, simulator UI buttons for the new screens, callback-length assertion |
| 9. Burmese review and pilot fixes | 1.0 | sister rewrites the ~60 new Messages keys, go-live voucher number, laminated how-to card, first-week corrections |

Sequence: 1 → 2 → 3 → 4 → 5 → 7 → 8 → 9, with 6 after the handwriting test; parts 2–3 give a usable order book in the first week, parts 4–5 replace the measurement book in the second.
