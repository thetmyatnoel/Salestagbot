# UX review for first-time phone users (2026-11-19)

The owner asked for a check "as a designer who cares for the customer: user-friendly for users who have zero knowledge
about technology, phones, computers, everything", and then for fixes. This note records what was looked at, what was found,
what was changed (round 6c, built the same day) and what was left as it is, with the reason.

The people in mind: the two sellers (they kept paper notebooks until now; the app is the first app they will use for
work), the owner sister (prefers paper; her channel is Telegram), and the computer-literate sister (the laptop and the
setup). The review walked the seller's app in the simulator screen by screen (home, the sale form with a credit, the
sold card, the menu, Settings, the new-piece form, the restock and expense forms, history, the receipt), read every
string the app shows (app_i18n.js, core_messages.js) and every place the app asks a question or shows an error.

## What already works for such a user (kept)

- One screen per job with the defaults filled (count 1, cash, paid in full, no buyer) and one green Save; the first
  problem is written in red above Save and the field is outlined and scrolled into view.
- Big type (18 px body, 20 px buttons, every tappable thing 56 px or more, 64 px keypad keys), high contrast in light
  and dark, Burmese set in a bundled Noto Sans Myanmar (the text looks the same on every phone).
- The app's own keypads for numbers (with 000 for kyat) instead of the phone keyboard; the phone keyboard for names only.
- Plain words on buttons ("မှားသွားတယ်" for undo, "မကျေသေး" for credit) and the English words the sellers already say.
- Everything works offline, the phone says so in Burmese ("အင်တာနက် မရှိ · ဖုန်းထဲ သိမ်းထားပါမည်"), and the sync state is one
  icon with a count.
- The receipt and every card are clean label/value lists; the history is a table by day.

## What was found and changed (round 6c)

| # | Found | Why it matters for a first-time user | Change |
|---|-------|--------------------------------------|--------|
| 1 | Four questions used the phone's own `confirm()` box: leaving a changed form, leaving a changed measurement form, clearing the drawing, disconnecting the phone. | Its buttons are **OK / Cancel** in English and do not say what happens ("OK" leaves without saving). Some hosts (the artifact viewer) block the box, so the question was silently skipped there. | `appAsk`: the app's own question sheet with two big Burmese buttons that name the outcome ("မသိမ်းဘဲ ထွက်မယ်" / "ဆက်ဖြည့်မယ်"), the risky one on top in red, the safe one under it. Android back = the safe one. The app never calls `confirm()` now. |
| 2 | "🔁 ဖုန်း ပြန်ချိတ်ဆက်" in Settings wiped the phone's enrolment at one tap when nothing was waiting to sync. | A stray tap left the seller on the enrol screen needing a new code from Telegram; nothing explained that. | It always asks ("ဒီဖုန်းကို ဆိုင်နဲ့ ဖြုတ်မလား?"), says a new code is needed, names the unsent entries that would be lost, and suggests asking the owner first. |
| 3 | Undo ("မှားသွားတယ်") and the owner's void ran at one tap on the sold card, the receipt and the entry page. | Big buttons invite stray taps; undo reverses stock and money records and the seller would have to re-enter the sale. | One question first: "ဒီမှတ်တမ်းကို ပြန်ဖျက်မလား?" with what happens, then "ပြန်ဖျက်မယ်" / "မဖျက်ပါ". |
| 4 | The first scan makes the phone ask for the camera in its own language (Allow / Block); a Block cannot be undone from inside the app. | Nothing told the seller what to answer, and after a refusal the only hint was "ကင်မရာ ခွင့် မရပါ · နံပါတ် ရိုက်ပါ". | A line under the Scan button before the first permission ("… Allow (ခွင့်ပြု) ကို နှိပ်ပါ") and, after a refusal, where the permission is put back (Settings → Apps → this app → Camera) and that the keypad works meanwhile. Shown on the home and in every form's camera strip. |
| 5 | Every toast vanished after 2.6 s, refusals included. | A slow reader never got to the end of "⚠️ S2-0004 · ဆိုင် ၂ ၏ ပစ္စည်းပါ · မထည့်ပါ". | The time follows the text (55 ms per character, 1.5 s base), a refusal stays at least 4.5 s, nothing stays past 7 s. |
| 6 | The Menu was a 3-column grid; Burmese labels were cut into syllables over three lines ("မ / ကြာ / သေးမီ"). | Fragments of a word are hard to read for anyone, impossible for a slow reader. | Two columns, 64 px rows: every label stays whole. |
| 7 | In the card state the job row shrank to 🛒 with its word and three emoji-only buttons (🆕 📦 💸). | Most of the time the home shows a card, so the sellers mostly saw the emoji-only row; 💸 or 📦 alone does not tell a first-time user what the button does. | The emoji with its word under it in small type (the full row is unchanged). |
| 8 | The new-piece form's cost box was an empty box with no hint. | A seller who does not know the cost did not know whether the form would accept the piece without it. | The empty box reads "မသိရင် ချန်ထားပါ" in muted type. |
| 9 | The enrol screen said "tap 📲 in the bot and type the 8-character code". | It did not say why, or what to do without a code. | It says the phone needs a code to join the shop, where the code comes from (your own Telegram, the bot's 📲 အက်ပ်), that it lasts 15 minutes, and to ask the owner for help without one. |
| 10 | The sync page said "သိမ်းဆည်းမှု: မခိုင်မြဲ · Home screen ထည့်ပါ" (storage: not persistent). | Jargon. | "ဖုန်းက ဒီအက်ပ်ရဲ့ မှတ်တမ်းကို ဖျက်နိုင်ပါသည် · အက်ပ်ကို Home screen မှာ ထည့်ထားရင် ပိုလုံခြုံပါသည်", and the good state says the records are kept safely in the phone. |

The simulator's smoke run and the checks were brought to the new behaviour (poc/sim_ui.js, poc/check_simulator.js,
poc/run_app.js): the smoke taps a changed form's ←, waits for the question sheet (the frame's snapshot carries it as
`ask`), taps its leave button and waits for the form to close. The frame's `confirm()` wrapper for a sandboxed host stays
(harmless) but nothing in the app calls it any more.

## Looked at and left as it is

- **Phone numbers show as +95 912 345 678.** Locals write 09 912 345 678. The format is in every receipt, voucher,
  Telegram text and seven checks pin it; the gain is small next to the churn. A later round may switch `fmtPhone` to
  the local form in one place.
- **Prices in Arabic digits, counts in Burmese digits.** As the tags and the paper notebooks do; unchanged.
- **The Settings page shows the version and a tap-time line** in small muted type. Support needs the version; the rest
  is quiet enough.
- **Icon-only back, sync and gear in the header** are what the owner asked for (F6, F8); each has a spoken label.
- **The date picker** for a promised day is the phone's own calendar; the presets (7, 14, 30 days, "not sure") cover
  most sales, so the calendar is rarely needed.
- **Zawgyi keyboards.** The app renders Unicode correctly on any phone (bundled font), but a phone whose keyboard still
  types Zawgyi would store garbled names. Out of scope; the family's phones are Unicode.
- **The menu's "📲 အက်ပ်" inside the app** mints an enrol code for another phone of the same person; harmless but odd.
  Hiding it in the app is a core change with pinned menu rows; left for a later round.
