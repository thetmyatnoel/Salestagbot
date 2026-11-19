# Round 5 brief: the step-by-step sale and the full simulator (2026-11-11)

Round 4 (lists, bank accounts, split payment, the measurement form) is built and tested but NOT
published; round 5 builds on top of it and ships together with it. Backup of the project from before
this round: `C:\Users\USER\Desktop\Noel-backup\pre-round5`.

## The owner's direction, in their words (summarised)

1. "The simulator should have all things starting from the logins, owner page, seller page, phone,
   laptop and all functions including the measurements, stocking page, expense page, etc."
2. "When selling a thing, the user should be seen step by step clicking things, like scan > count >
   name (contact of the buyer should be saved too; that should be in the seller's right on the selling
   scenario, or maybe later registering with laptop by owner) > payment made by 100% with one option
   only or mixed option > payment (cash / bank transfer / wave / QR scan pay) > if bank or scan pay, to
   which account (KBZ, AYA etc.) > full payment or just deposit only > if so how much is the deposit,
   when will the rest be paid. The button options should be shown step by step like this; if various
   options are shown at the same time, the seller would be confused."
3. "Voice AI is not that important for now, so do not focus on that so much."
4. "Think by yourself for the best user experience, plan and then build." The owner will publish
   round 4 and round 5 together once this is done.

Earlier standing facts still hold: staff have no computer habit; Burmese UI; zero cost; Myanmar
reachability; paper for the owner; one shared owner login, seller logins per phone; sellers add bank
accounts themselves; the laptop (the Sheet) is where lists are managed.

## Decisions taken for the design (the orchestrator's; the spec may refine, not drop, them)

D1. **One question per screen.** The sale becomes a guided flow: every screen asks one thing and
    shows at most six answer buttons plus a back row (↩️ back, ✖️ cancel). The same core runs the flow
    in Telegram and in the app, so both surfaces show the same steps; the app may use its own controls
    (stepper, keypad, date picker) where Telegram has only buttons.
D2. **Step order follows the owner**, with skips when a step has only one possible answer:
    scan or pick the item → count (skipped for a one-of-a-kind piece) → buyer (first button: no name;
    then recent customers; typing a name or phone searches; a new name may be followed by an optional
    phone with a skip) → how paid (💵 cash, the wallet accounts by name for QR or wallet pay, 🏦 bank
    transfer, 💵+🏦 mixed) → which bank account (only after 🏦 bank transfer, and only when more than
    one) → full now or part now (deposit) → if part: how much now, and when the rest is paid (buttons
    for a week, two weeks, a month, a typed date, not sure) → a summary card with ↩️ undo and 🧾
    receipt. Mixed asks for the transfer part after the account; the rest is cash. A part payment
    needs a buyer: if none was given, the flow asks for one then. The 💬 changed-price option stays
    reachable from the count screen as a secondary row (bargaining is common), not as its own step.
D3. **One ledger write at the end**, when the summary is confirmed: the sale row with its cash part,
    a PAYMENT row for the transfer part of a mixed payment, the customer attached, all in one group.
    Nothing is written while the seller is still answering; an abandoned flow writes nothing. The
    corrective buttons of today's after-sale card (method change, credit conversion, customer attach,
    split, ➕) are no longer needed on the summary card; the functions stay for the other entry points
    (customer card, voice intents, orders) and for tests.
D4. **The promised date is kept.** A new ledger column `DueDay` (YYYY-MM-DD, blank when none) on the
    sale row of a part-paid or unpaid sale; the Credits view and the 21:00 summary use it (overdue =
    past DueDay, or past OVERDUE_DAYS when blank). It travels through sync like the other columns and
    setupSheet appends it at the right-hand end.
D5. **A way back.** Settings key `sale_flow`: `steps` (default, the guided flow) or `quick` (today's
    one-tap card). The old scenario suite runs with `quick` and stays green unchanged; the new flow
    gets its own suite. The owner can switch back without a publish.
D6. **Wallets and banks.** The Lists tab gains a `Kind` column for pay_method rows: `wallet`
    (KBZPay, WavePay: shown by name on the how-paid screen, these are the QR / scan-pay ones) or
    `bank` (shown behind 🏦 bank transfer). A row without a Kind is treated as a wallet. ➕ on the
    how-paid screen asks the kind with two buttons after the name. The Lists tab is still the only
    place to rename or retire.
D7. **Voice** keeps working as today; nothing new is built on it; the simulator moves the voice
    phrases behind a collapsed section.
D8. **Simulator v2** is a demo of the whole product, not a developer page: a login screen (Owner, the
    shared admin login; Seller shop 1; Seller shop 2); a device bar per role (✈️ Telegram, 📱 the real
    phone app with its measurement form, running against the in-page fake server; 💻 the laptop: the
    Sheet with Dashboard, Lists (editable Label, Active, Detail, Kind), Ledger, Customers, Credits,
    Deposits, Orders, Measurements, Errors; and the app at laptop width); a "what can I do" panel with
    a guided tour per function (sell step by step, restock, register a new piece by photo, return,
    expense, receive a payment, take a deposit, custom order with voucher and measurements, reports
    and the 21:00 summary, enrol a phone, manage lists on the laptop) that highlights the next thing
    to click and explains it in Burmese and English, so the owner sees the real clicks. It stays one
    self-contained HTML file built by poc/build_simulator.js and published as an artifact.
D9. **Keep the rules of rounds 3 and 4**: ES5 core, one global scope (grep before adding a global),
    callback data under 64 bytes, append-only ledger, the script lock through gasLocked, every change
    with checks that fail without it, existing checks not edited except those the spec names, no new
    file under apps-script/ (bundle_gas.js lists the files), nothing in app/config.js or
    tools/publish*.js.
