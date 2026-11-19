# Review of SPEC-round-6 (rev of 2026-11-12): ledger, readers, sync and glue

Lens: every form outcome written and undone with the real functions; the allocation rule and DueDay through every
reader; the counted new piece (item type, RESTOCK rows, stock); the sync server and old phones; setupSheet and the
settings migration from `steps` to `form`. Every `file:line` is the current tree (rounds 4 and 5 built). Probes ran on
the simulator world (core + `poc/sim_*.js`, the fake server, an enrolled reference phone); the scripts are in
`C:\Users\USER\AppData\Local\Temp\claude\382443627803a215\49f3ff95-e593-4d86-a074-f2e6d3f31155\scratchpad\probe\`
(p1.js to p4.js). No code or test was changed.

Six major findings, seven minor. No blocker: the ledger shape of section 3.2 holds up (see "Confirmed" at the end).

---

## Major

### M1. The new-piece form's photo job can still reach the server before the item entry (6.2's "always" is false)

**Spec.** 6.2 says the item entry "is therefore always pushed before the job (`flushAiJobs` runs only after a
successful push, app_sync.js:352-353 …)", so the job meets a placeholder-named item, the server renames it, and the Drive
`photoUrl` is never overwritten by the phone's `local://` value.

**Code.** `flushAiJobs` runs after a successful SYNC, not after the push that carries this Save's entries:
- a Save made while a sync is in flight only sets `sync.wanted` (app_sync.js:327);
- when the in-flight sync ends ok, `flushAiJobs` runs first (app_sync.js:352-354), then the `'again'` sync that pushes
  the new item entry (app_sync.js:357). A sync that ends inside the 1.5 s debounce (`APP_SYNC_DEBOUNCE_MS`,
  app_sync.js:21) does the same without `wanted`;
- the queued job is already in `store.queuedMedia()` because `appNewItemSave` queues it at Save (spec 7.2);
- the form's own photo opens that window. The 📸 tap opens the phone's camera app through `#photoInput`. Coming back
  fires `visibilitychange` → `sync.syncNow('foreground')` (app_sync.js:536). That sync is in flight on Myanmar mobile
  data while the seller types the price and cost and taps Save.

**Probe p2.js** (the reference phone, job sent before the push that carries the item): on the server, S1-0007 was
still BLANK, so the job wrote only the Drive URL (gas_sync.js:310-314 twin, poc/sim_sync.js:183-187). The push that
followed carried the creation entry with a stale `baseRev` (core_sync.js:729), which:
- overwrote the Drive URL with `local://S1-0007`;
- logged two `sync_conflict` rows (`S1-0007.name:  -> ပစ္စည်း S1-0007`, then `ပစ္စည်း S1-0007 -> ထမီ ပိုးထည် အစိမ်း`);
- pinged the owner twice with `ping_conflict` '⚠️ {id} · ဖုန်း ၂ လုံးက {field} ကို ပြောင်းထားပါသည် · {mine} →
  {theirs} (နောက်ဆုံး ပြောင်းသူ အတိုင်း)' (core_sync.js:129).

6.2's server rename does not help here: `aiRenameFields` never renames a BLANK item. This is the very defect 6.2
exists to remove, on the form's main path.

**Fix** (app/app_sync.js, step 3, no core change): in `sync.flushAiJobs`, skip a photo job while an `item` entry for its
`itemId` is still in the outbox:
`if (job.kind === 'photo' && job.itemId && store.outbox.some(function (e) { return e.kind === 'item' && e.id === job.itemId; })) return next(i + 1);`.
Add one run_app step-50 check: a Save while a sync is held in flight sends no `ai` call until the item entry has been
acked. Fix the twin rule in `sim_phone.applyAiResults` as well, so R6e tests the same rule.

### M2. An over-stock count, which the form allows, makes the owner void the whole basket and its bank payment

**Spec.** 1.3 "over stock": count > stock is "a warning, never a refusal (the server flags it, core_sync.js:807-809)".
Section 5 accepts that the `V|` of a `stock_negative` ping voids the whole basket.

**Code.** The server flags every phone row that drives stock below 0 (core_sync.js:806-810). The ping text is
`ping_stock_negative` '⚠️ {name} ({id}) · လက်ကျန် {stock} · ဖုန်း ၂ လုံးက တစ်ပြိုင်နက် ရောင်းထားပါသည် · တစ်ခုကို
ပယ်ဖျက်ပါ' (core_sync.js:126: "two phones sold at the same time · void one of them"). Its only button is `V|<group>`
(core_sync.js:634-637).

**Probe p3.js.** One phone, no concurrency, a basket of S1-0002 × 1 and S1-0005 × 3 (stock 2), mixed KBZ 5,000:
- the owner got that ping;
- the instructed 🚫 tap mirrored all three rows, including S1-0002 (which was fine) and the PAYMENT of 5,000 KBZ that
  really arrived;
- the day's KBZ net became 0 and S1-0002 went back to stock 5.

With baskets the blast radius grows from one row to every line plus the bank part. With SKU stock that depends on
restocks the family may not record, this ping will be routine. Telegram baskets are never flagged at all, so the two
channels disagree.

**Fix** (pick one, the spec must name it):
- (a) `syncFlagPing` attaches `V|` only when the item is UNIQUE (a real double sale). A SKU gets an information ping
  without a button: NEW `ping_stock_short` '⚠️ {name} ({id}) · လက်ကျန် {stock} · 📦 ကုန်ရောက် မမှတ်ရသေးတာ
  ရှိနိုင်ပါသည် · စစ်ပါ'. This is a small core_sync.js change that 6.3 must then list.
- (b) The form asks once before a Save with an over-stock line: the `.fmsg` shows `ui_stock_over` and needs a second tap
  on Save.

Either way, 5.1's "none" for the `stock_negative` row is wrong for a basket.

### M3. A return from a basket bought on credit refunds cash and leaves the whole credit open (1.10's claim is false)

**Spec.** 1.10 says payments, deposits and a return "read the group's owed (basket map 2.14), so a basket works with
them".

**Code.**
- `T|` writes `commitReturn(ports, merge(base, {item, qty: 1}))` (core_bot.js:528-535): no group, no customer, and
  `cash = amount`, a full cash refund (core_ledger.js:866-879; map-core-commits 2.8: "The refund is not capped").
- Basket map 2.14 does not cover returns.

**Probe p1.js.** Outcome 5 basket (owed 33,000), then ↩️ `T|S1-0005`:
- the RETURN row was −22,000 amount and −22,000 cash, CASH, with no customer;
- `saleGroupInfo(...).owed` stayed 33,000;
- ဒေါ်မြင့်'s `bought` kept the returned piece.

The drawer is shown paying out 22,000 for a piece the buyer had not paid for, and the Credits tab and the 21:00 overdue
line keep asking for it. This happened before round 6 for one-line credits, but baskets make "bring one piece back from
a part-paid sale" a normal event.

**Fix.** Either:
- (a) state it in section 12 and make `T|` warn when `lastLiveSale(item)`'s group still owes. NEW `ret_credit_open`:
  'ℹ️ 👤 {customer} · ကျန် {owed} ကျပ် · အကြွေးနဲ့ ရောင်းထားတာပါ · ပြန်အမ်းရင် ဆိုင်ရှင်ကို မေးပါ' (words from
  `sale_line_paid`, `btn_return` '↩️ ပြန်အမ်း' :25, `card_pending` :12). Remove "and a return … so a basket works with
  them" from 1.10.
- (b) specify the money rule: a RETURN that carries the group's `customerId` and `refGroupId`, cash refunded only above
  what is still owed, and `saleGroupInfo`/`openCredits` counting it. That needs new reader work, so (a) is the
  realistic choice for this round.

### M4. "More than one live SALE row" also matches custom-order deliveries; four of the new branches would change them

**Spec.** Section 5's opening: "A one-line group, a delivery and a mixed one-item sale take today's path byte for
byte". Only `openCredits` is guarded with `!isOrderId(groupId)` (4.2). The `U`/`V` reply (4.4) is types-based and even
names `orderUndoLine`. `customerLines` (4.4), `describeGroup` (4.3) and `cardText`'s `card_buyer_basket` (4.4, 5.1) use
the bare guard.

**Code.**
- `deliverOrder` writes one SALE row per voucher line in the order's group, with `itemId = l.itemId || order.id + '-' +
  l.line` (core_orders.js:266-272). run_scenario.js:1064-1069 has a two-line delivery (V1-2533).
- The delivery reply offers `U|<orderId>` (core_bot.js:4041).

**Consequence.** Undoing a two-line delivery would take the new branch: one `group_item_line` '{id} · {name} · လက်ကျန်
{stock}' per item, for ids such as V1-2533-1 that have no Items row (`getItem` is null). That prints garbage, or throws
after the mirrors were already written, so the seller gets no reply. Also:
- the customer card would collapse a delivery into 'ရောင်း 🛍 ၂ ခု …';
- the phone's pending line would read as a basket;
- a tagged order piece's card would show the basket buyer line.

**Fix.** Write the guard once as `basketGroup(info) = info.rows.length > 1 && !isOrderId(info.groupId)` and use it in
all five places (the `U`/`V` reply, `customerLines`, `describeGroup`, `cardText`, `openCredits`). Add one W27 check: a
two-line delivery's `U|` reply, customer card and Credits row are unchanged.

### M5. A counted new piece cannot be undone or corrected: a mistyped count stays in the stock for good

**Spec.**
- 1.5: the count is a keypad field (1..999); "After Save" shows `item_created` '🆕 မှတ်ပြီးပါပြီ' · id, then the
  card. No undo row.
- 3.6: one RESTOCK of +count.
- 12: changing "a piece's type, name, category or count after Save" is for "the Items tab and the card's buttons".

**Code.** No path takes stock down:
- `newItemCost`'s tail edits the message with an empty keyboard (core_bot.js:2190);
- `R|` only adds (core_bot.js:513-527), and the restock form refuses a UNIQUE (`basket_unique`);
- there is no writer of `ADJUST` (`CFG.TX.ADJUST`, core_config.js:27, has no caller);
- the Items tab has no Stock input (Stock is derived from the Ledger);
- the Ledger is append-only.

So "30" typed for "3" means 27 phantom pieces in the stock report's value, in `lowStockList`, and in every later
`stock_negative` check. In round 5 the count was always 1, so this is a new hole. Undoing the RESTOCK alone would be
wrong for a UNIQUE: stock 0 reads SOLD (app_store.js:260).

**Fix.** Put `undoRow` [↩️ မှားသွားတယ်] (`btn_undo` :27) under `item_created` in the app and on the Telegram card. In
`undoGroup`'s caller (`case 'U'`), when the undone group's only live row was a RESTOCK whose note is 'new item' or 'new
sample' and the item has no other live rows, also return the item to BLANK: `updateItem(id, {name: '', category: '',
type: '', price: '', cost: '', photoUrl: '', photoFileId: '', sample: false})`. Inside 30 minutes the seller can then
re-register it. Add W28 and run_app 50 checks for this.

### M6. After 30 minutes a basket cannot be corrected by anyone: the "owner's void" of section 12 has no entry point

**Spec.**
- 12: "the undo is the whole basket within 30 minutes, and so is the owner's void, including the one a stock_negative
  ping offers".
- 4.2: `rewriteCheck` answers `complex` for a basket, so every corrective path refuses it.

**Code.**
- `V|` is emitted only by `syncFlagPing` (core_sync.js:635).
- `voidButton` exists (core_bot.js:372-374) and has no caller.

So a basket found wrong after 30 minutes (wrong buyer, cash booked instead of KBZ, a wrong count) cannot be fixed in
Telegram or the app, not even by the owner. Telegram baskets never get a ping at all. A one-line sale today still has
the same-day corrective buttons (`afterSaleKeyboard`, core_bot.js:283-299).

**Fix.** Give the owner `voidButton(ports, g)` ('🚫 ပယ်ဖျက် (ဆိုင်ရှင်)', `btn_void` :189) on the receipt reply (`RC|g`)
and on the owner's view of the sold card when the group is a basket. `case 'V'` already checks the role
(core_bot.js:554). Add one W27 check: the owner voids a two-hour-old basket, the seller gets no button.

---

## Minor

- **m1. 3.5 misstates `backfillSync`.** It writes the receipt number on the FIRST SALE row of each group only
  (gas_sync.js:461-467: `seen[GroupID] = true`, then `setValue` on that row). It does not write it "on every line", so a
  phone basket (number on all rows) and a backfilled Telegram basket (number on row 1) will look different in the
  ReceiptNo column. Fix: say so, or leave the copy to the phone only. No reader depends on it (`receiptNumber`,
  core_ledger.js:1729-1737, reads the first row).
- **m2. `customerLines` prints the amount twice.** desc = 'ရောင်း ' + `basket_line` '🛍 {n} ခု · {amount} ကျပ်', placed
  inside `cust_line` '{day} · {desc} · {amount}{paid}{method}' (core_messages.js:153), gives '… · ရောင်း 🛍 ၃ ခု ·
  83,000 ကျပ် · 83,000 · ပေး 40,000 · ငွေသား'. The example in 5.1 drops both the day and the second amount. Fix: desc =
  'ရောင်း 🛍 ' + fmtCount(n) + ' ခု' (or a NEW `basket_count` '🛍 {n} ခု'), and let `cust_line` carry the amount; update
  the W27e expectation.
- **m3. 0.3 rule 11 says "The `V|` reply already lists every line it voided".** Today it shows `void_done` and the
  first item's card only (core_bot.js:552-560). The listing comes from the 4.4 change. Reword rule 11, so nobody skips
  the 4.4 row thinking it is done.
- **m4. A deliberately chosen 'အခြား' gets replaced by the AI.** `aiRenameFields` replaces a category that is '' or the
  last of `CFG.CATEGORIES` (4.2). The form saves "none chosen" as that same value (1.5) and also offers 🧵 အခြား as a
  chip, so a chosen 'အခြား' is replaced, against 6.2's "a chosen category is never replaced". Fix: say that 'အခြား' is
  always replaceable, or store '' when nothing was chosen and let `commitNewItem` keep ''.
- **m5. "One phone can still be put on quick with the pref `setting:sale_flow`"** (1.0, 3.10, 6.6 step 5). No app
  control writes that pref: the only `setting:` pref with a UI is `text_cards` (app_ui.js:888). Only a test can set it
  (run_app.js:1060). Fix: add a Settings-screen toggle in 7.4 (the `text_cards` pattern), or drop the sentence from the
  migration text the owner will read.
- **m6. Settings migration wording.**
  - A Settings row that already reads `steps` is kept (6.1), so the cell keeps showing `steps` under a note that now
    explains only `form` and `quick`.
  - On a book whose Messages tab already holds round 5's `settings_note_sale_flow`, the note stays 'steps =
    တစ်ဆင့်ချင်း မေး · …' (gas_setup.js:81-90 appends only missing keys, and `t()` reads the tab).
  - 3.10's "its only other reader, gas_setup.js:76" overlooks core_sync.js:1492 (`QUICK`, kept, harmless).
  - Fix: let setupSheet rewrite the value `steps` to `form`, then update run_gas 27. Add to 6.6 step 3: "if the Messages
    tab has a `settings_note_sale_flow` row from a round-5 test, delete it first".
- **m7. The new-piece form accepts another shop's blank tag.** In 4.4 `openTag` sends any BLANK to `openForm('newitem')`
  with no shop check, and `commitNewItem` has no `other_shop` refusal. Probe p4.js (today's chat flow, the same
  writes): a shop-1 seller registered S2-0004. The item entry was accepted, the RESTOCK group was quarantined `scope`
  (core_sync.js:361-370), and the piece now reads SOLD with stock 0 on the server and the phone. This predates the
  round, but `commitNewItem` is new: add `other_shop` (a seller's tag of another shop) to its refusals and to the
  scan-router table of 1.2.

---

## Confirmed (tried to refute, held)

- 3.2's derivation and the 3.3 table: outcomes 3, 4, 5, 6 and 7 recomputed; Σ cash = A; 0 ≤ cash ≤ amount on every row.
- The basket is ONE outbox group entry of 4 rows on a phone (app_store.js:657-662; probe p1). The server accepted it
  with no flag: the PAYMENT comes after the SALE rows, and the shadow owed was 43,000 ≥ 10,000 (core_sync.js:811-815).
- `openCredits` gives one entry per basket with owed 33,000 and the DueDay (probe p1). Its item is the first item's
  name until `basketName` (core_ledger.js:1255-1256).
- Today's phone stamps three receipt numbers on one basket (R1-A-000001..000003, counter +3; probe p1): 3.5's copy is
  needed.
- `receiptText` lists one line per row with the total, the split methods and the date (probe p1).
- `saleGroupInfo` takes `dueDay` and `method` from the first live row (core_ledger.js:1166-1170), so B3 (DueDay on
  every SALE row) and the hardening are right.
- `statsWhere` counts `sales` per row, but the count is read only as a zero test (core_ledger.js:1559, :1623). The
  Dashboard sums rows, and its Overdue cell reads the Credits tab (gas_setup.js:451-453).
- `customerSummaryMap` is right with the buyer on every row (core_ledger.js:1347-1367).
- `undoGroup` mirrors every live row in the same group and returns `types` (core_ledger.js:992-1017). The phone's mirrors
  get no receipt number (app_store.js:296).
- `syncPlanPush` sends customer, item and list entries before groups (core_sync.js:1364-1366). Item entries carry only
  their changed fields (app_store.js:285-292), so a rename equal to the server's is answered `dup`
  (core_sync.js:732-735). run_sync S8 stays green under 6.2.
- `syncSettingsFor` sends `sale_flow` to phones (core_sync.js:924-938); `quickForced` covers an older server
  (core_sync.js:1454-1455, :1467).
- `syncGroupInScope` quarantines a mixed-shop group (core_sync.js:361-370), so B6's refusal at the scan is required.
