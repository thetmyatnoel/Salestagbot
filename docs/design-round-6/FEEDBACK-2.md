# Owner feedback 2 on the round-6 simulator (2026-11-18)

The owner tried the round-6 simulator (artifact NHfTJWYrxbo7qd1dGVVYjd, version 8) and wrote three points. Each is
binding for the round-6b addendum `SPEC-round-6b.md` (G1-G3). The orchestrator's facts are in brackets.

1. "What is the difference between နမူနာ and other? Is there any different sign for it?"
   [Facts: အခြား is the last entry of CFG.CATEGORIES (core_config.js:26), the garment category for anything that is
   not ထမီ, လုံချည်, အင်္ကျီ or ဝတ်စုံ. နမူနာ is the sample flag of POS-PROJECT-PLAN.md 12.4: a piece the design
   department makes (one or two of each new design), registered from a blank tag, often with the price still
   pending; the item card adds sample_mark ' (နမူနာ)' to its name (core_bot.js:228) and the reports count samples
   sold on their own line (core_ledger.js:1919-1945, core_report.js:51). The sign is the problem: Telegram's toggle is
   btn_sample_on/off '🧵 နမူနာ: ဟုတ်/မဟုတ်' (core_messages.js:49-50) and the အခြား category's emoji is also 🧵
   (core_config.js:27), so the two look the same; in the app (revision 3) both are plain text, the sample a toggle
   "နမူနာ: မဟုတ်" with no explanation.]
2. "For a new product there is only the other option, not a + option that the user can add an option manually with
   the name that user likes."
   [Facts: the new-piece form's category chips are the fixed CFG.CATEGORIES; there is no way to add one. Round 4's
   Lists tab already holds pay_method, expense_category and fabric with a ➕ add-on-the-spot pattern
   (addListOptionByLabel, listUpsert, the list sync entry, the laptop Lists tab).]
3. "Telegram's menu should also get 📦 restock." [Answer to the question left open in revision 3 (F12, 13.17).]

## Decisions (binding for SPEC-round-6b.md)

G1. **Sample has its own sign and says what it is.** Telegram's toggle becomes '🎨 နမူနာ: ဟုတ်/မဟုတ်' (a design
    sample; 🧵 stays the အခြား category's emoji only); every place that marks a sample (item card, review card,
    reports, the app's tiles and item view) shows the mark distinctly. In the app the sample row is a real switch
    with a one-line hint (draft: 'ဒီဇိုင်းဌာနက လုပ်တဲ့ နမူနာ · အစီရင်ခံစာမှာ သီးသန့် ပြပါမည်'), and a sample item shows a
    small 'နမူနာ' badge (text, F7: no emoji outside the main menu). The guide explains sample versus အခြား.
G2. **Item categories become a list the shop can grow.** A new Lists-tab list (the spec names it, for example
    `item_category`), seeded from CFG.CATEGORIES with their emojis in Detail as expense categories do, read through
    the same list machinery (store, lists_json, legacy fallback to CFG.CATEGORIES), synced through the existing list
    entry kind. The new-piece form (app) shows the active categories as chips plus a '+ အသစ်' chip that opens a name
    field; Save adds the category (anyone who registers pieces may add, as sellers add accounts in round 4; the
    owner renames, retires or reorders on the laptop's Lists tab) and uses it for the piece. Telegram's new-piece card
    gets the same ➕ through the round-4 ➕ pattern. Every reader of a category keeps working with a custom one: the
    category emoji falls back to a neutral one, the price presets fall back to the default presets, the photo AI is
    given the current list, reports and the Items tab show the custom name, quick mode and old phones are safe. A
    category is stored by its name on the item as today (or the spec says why a key is better and migrates).
G3. **Telegram's menu gets 📦 restock** (menuAction 'restock'): it asks for the tag (scan or type its number), then
    the existing restock count screen of that item; restocking several tags in a row is offered after each save
    (one more tag or done). The existing checks that pin Telegram's menu rows (run_round4.js:964, :1126 and any other
    the spec finds) are named as allowed changes.
G4. Every rule of round 6 still binds (ES5, one global scope, grep new names, 64-byte callbacks, append-only ledger,
    gasLocked, no new apps-script file, app/config.js and tools/publish*.js untouched, F7/F8 in the app, F10b: no new
    two-shop assumption, existing checks never edited except those the spec names, every new check fails without its
    feature). The simulator gets a tour for a new piece with a new category and a Telegram restock tour.
