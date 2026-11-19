# Round 6 brief: forms in the app for the sellers, Telegram for the owner (2026-11-12)

Rounds 4 and 5 are built and NOT published (snapshot `C:\Users\USER\Desktop\Noel-backup\r5-built`). Round 6 is
built on top and the three ship together. Round 5's contract: `docs/design-round-5/SPEC-round-5.md` (rev 2.1).
A useful round-5b map that survives: `docs/design-round-5/map-basket-readers.md` (every reader of a sale group and
whether a group with several SALE rows for different items works).

## The owner's direction, in their words (2026-11-12)

1. "When selling, multiple items can be sold for one customer, what about that???"
2. On "Register a new piece by photo": "there is no count registration step; user should fill: photo scan >
   profit, cost, count, product name should be filled in one step like a form. Same for selling things too: scan
   all tags (one or many) > count > other necessary things should be filled like a form. Current step by step makes
   the user confused (I think). You think more like a pro who is a 기획자 (product planner)."
3. They did not understand the difference between Telegram and the app. After an explanation they said "yes" to
   this plan: **sellers use only the phone app** (one-screen forms, offline, its own tag scanner); **Telegram
   becomes the owner's channel** (21:00 family summary, reports and PDFs, alerts, the code that connects a phone)
   and a simple **backup for selling** through a review card, for a phone without the app.

## Diagnosis (the orchestrator's, as product planner)

Round 4's after-sale card showed many unrelated corrective buttons at once; round 5 replaced it with many screens in
a row. In both the seller never sees the whole transaction. A form shows the whole sale like the receipt it
becomes, with sensible defaults filled in and extra fields appearing only when a choice needs them (progressive
disclosure), and one Save. Telegram cannot render forms, so there the same idea is a review card.

## Decisions (binding)

The owner said yes to the plan. Four detail choices (pricing entry, defaults, the Telegram mode, the fate of the
step-by-step screens) were offered and left unanswered; the orchestrator took the recommended answers below.

R1. **The app's forms are app-native screens** (like the round-4 measurement form `#measForm`, app_ui.js), not bot
    messages: they read the local store and call the core's commit functions directly (commitSaleGroup and the
    other commit* functions in core_ledger.js), so they work offline and sync as today. The app's home becomes a
    seller's home: big buttons for the jobs, the scanner, recent items.
R2. **Sale form** (must): scan one or many tags (camera; or type the number; or pick a recent item) into a basket
    on ONE screen; each line shows the item, its price and a count stepper (a one-of-a-kind piece is count 1 and
    cannot be added twice; an item of the other shop is refused); a line can be removed and its price changed
    (bargaining); below: buyer (optional; one search field for name or phone with recent buyers as chips; "new"
    expands name and phone fields; a part payment requires a buyer), how paid (segmented: cash, each wallet such as
    KBZPay and WavePay, bank, mixed; bank and mixed reveal the account and, for mixed, the transfer amount),
    paid now (full / part; part reveals the amount and the promised day: 7, 14, 30 days, a date, not sure), the
    total and ONE Save. Defaults: count 1, cash, paid in full, no buyer, so a normal cash sale is scan then Save.
    One write: one group, one SALE row per line, the round-5 ledger shapes (mixed = sale cash part + a PAYMENT row;
    DueDay), one receipt number, one undo; after Save the sold card shows undo and receipt.
R3. **New-piece form** (must): a blank tag scanned (or "new piece") opens the camera; after the photo ONE form:
    name (pre-filled from the photo AI when available, editable), category chips, cost (အရင်း), selling price
    (ရောင်းဈေး), profit (အမြတ်) and its percentage shown automatically, count (stepper, default 1; more than 1 makes
    the item a stock item with that many pieces), price "pending" for the owner as today, sample toggle; Save writes
    the item and its RESTOCK row(s) in one go.
R4. **Other jobs as forms, in this priority** (the spec decides how far this round goes; must and should are in):
    should: restock (scan one or many tags, a count each, Save), expense (category, amount, how paid, note, Save);
    could: receive a payment on a credit (buyer, amount, how paid), take a deposit (buyer, amount, how paid, note),
    a return. Custom orders and the measurement form keep their current screens.
R5. **Telegram** keeps everything for the owner and becomes the sellers' backup: a sale in Telegram is a review
    card (the whole sale with defaults, buttons to add an item, change a count, set the buyer, set the payment, then
    Save), the sub-screens returning to the card; a new piece by photo in Telegram is a review card too (name, cost,
    price, count, then Save). The round-5 step-by-step screens are no longer a mode: their pieces may be reused as
    the review card's edit screens; anything dead is removed with its tests replaced, never left half-working.
R6. **Settings `sale_flow`**: `form` (default; the app forms and the Telegram review card) or `quick` (the old
    one-tap card with corrective buttons, the owner's fallback). The value `steps` from round 5 reads as `form`.
R7. **Readers** of a sale group with several items (sold card, item card buyer line, Credits item name, reports,
    the customer card, the 21:00 summary, the app's pending lines, the simulator's views) show a basket as one sale
    with N lines (map-basket-readers.md lists each and its change). The cash of a part payment is allocated over
    the rows by one rule every reader agrees with.
R8. **Simulator**: sellers start on 📱 the app by default; the tours for selling, new piece, restock and expense run
    on the app forms; the owner's tours (reports, 21:00, lists, enrol a phone) stay on Telegram and the laptop; a
    Telegram review-card tour shows the backup. A smoke step for a three-item basket with a part payment.
R9. Every rule of round 5 section 0 still binds (ES5, one global scope, grep new names, 64 bytes for Telegram
    callbacks, append-only ledger, gasLocked, no new apps-script file, app/config.js and tools/publish*.js untouched,
    existing checks never edited except those the spec names, every new check fails without its feature; the app's
    forms need Node-testable pure helpers as the measurement form has).
