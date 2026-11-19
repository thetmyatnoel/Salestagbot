# Round 5b brief: several items for one buyer (the basket), 2026-11-12

Round 5 (the guided sale, SPEC-round-5.md revision 2.1) is built and checked; rounds 4, 5 and this addition are
published together. Snapshot of the tree before this addition: `C:\Users\USER\Desktop\Noel-backup\r5-built`.

## The owner's question, in their words

"When selling, multiple items can be sold for one customer, what about that???"

Today each guided sale holds ONE item: a buyer who takes three pieces gets three flows, three buyer and payment
questions and three receipts. The owner's earlier direction still binds: one question per screen, few options per
screen, sellers with no computer habit, "think by yourself for the best user experience, plan and then build".

## Facts already in the code (verified by the orchestrator)

- A ledger group can hold several SALE rows: a custom-order delivery writes one SALE row per garment in one group
  (core_orders.js header, deliverOrder). `saleGroupInfo` (core_ledger.js:1152) sums every SALE row of a group;
  `openCredits` (:1219) sums per group and names a multi-line voucher "N ကြောင်း · …"; `buildReceipt`
  (core_report.js:331) prints one line per live SALE row; `undoGroup` mirrors every live row of the group; the sync
  server accepts a group entry of up to `SYNC.PUSH_MAX_ROWS` rows.
- `saleGroupInfo` reads `itemId`, `unitPrice`, `method`, `customerId` and `dueDay` from the FIRST live row, and
  `qty` as the sum; several readers (the sold card, the item card's buyer line, reports, the customer card,
  `openCredits`' item name for a non-order group) assume one item per sale group.
- The guided flow keys every callback on the item id (`SS|<item>|…`, `SC|<item>|ok`) and its state on one `item`.

## Decisions taken for the design (the orchestrator's; the spec may refine, not drop, them)

B1. **A basket** ("🛍"): several items for ONE buyer in ONE sale. The buyer, how-paid, account, amount-now and
    promised-day questions are asked ONCE for the whole basket; one write at ✅: one group, one SALE row per basket
    line (the delivery shape), the customer on every row, one receipt number, one undo, one sold card, one entry
    in Credits.
B2. **A one-item sale stays as simple as today or costs at most ONE extra tap.** The designers compare at least
    these entry points and the judges pick on seller UX: (a) an explicit "anything else?" screen after each item's
    count; (b) an "➕ add another item" answer on an existing screen (for example the buyer screen), keeping six
    answers; (c) scanning or typing another tag while a sale is open asks "add to this sale or start a new one?".
    A combination is allowed. Whatever wins must be obvious to a seller who has never seen it.
B3. **Adding the next item:** scan its tag (Telegram START link; the app camera), type its number, or pick from
    the shop's recent items. Each added SKU gets its own count (and 💬 changed price) step; a UNIQUE piece skips
    the count and cannot be added twice; an item of the OTHER shop is refused with a message (accounts, recents
    and receipts are per shop).
B4. **The basket is always visible** in the header block of every later screen (lines and running total, short
    when long), and can be corrected before ✅: remove a line, change a line's count; back steps through the screens
    as today. Stock is re-read at ✅ for every line; a UNIQUE line sold meanwhile is reported and the seller decides
    (drop it and continue, or cancel), nothing written until then.
B5. **Money.** The total is the sum of the lines. A part payment's cash is allocated over the SALE rows by a rule
    the spec fixes (and that every reader, the Credits view, receipts and undo agree with); DueDay goes on every
    owing row of the group (or the spec says which row carries it and every reader uses that). A mixed payment is
    one PAYMENT row for the transfer part referencing the group, as today.
B6. **Readers** that assume one item per group (sold card, item card buyer line, Credits item name, reports, the
    customer card, the 21:00 summary, the app's pending lines, the simulator's Ledger view) show a basket as one
    sale with N lines, for example "🛍 ၃ ခု · 54,000".
B7. **Callbacks and state.** Callback data stays under 64 bytes; the spec decides whether the flow keeps keying on
    the first item or gets a basket key; the stale, double-tap and cancel rules of round 5 keep holding; the 30-min
    state TTL applies to the whole basket; a basket can hold at most a fixed number of lines (the spec picks it,
    e.g. 10).
B8. **Surfaces.** Telegram and the app run the same core; the app shows the latest bot message only, so the
    basket screen must be self-explanatory there; the app's stepper is the count of the line being added.
B9. **`quick` mode** stays one item per sale, unchanged.
B10. **Simulator:** a tour "sell three items to one buyer" on Telegram and on the app, a smoke step, and the
    Ledger/Credits views showing the basket group; docs updated.
B11. Every rule of round 5 section 0 still binds (ES5, one global scope, grep new names, 64 bytes, append-only,
    gasLocked, no new apps-script file, app/config.js and tools/publish*.js untouched, existing checks never edited
    except those the spec names, every new check fails without its feature).
