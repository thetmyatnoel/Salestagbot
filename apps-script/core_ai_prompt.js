/**
 * core_ai_prompt.js — the Gemini prompts and JSON schemas.
 * Shared by gas_gemini.js (production) and tools/score_voice.js (Phase 0 test).
 * The examples are the most valuable part: replace them with real phrases
 * collected from the shop during Phase 0.
 */
var SYSTEM_PROMPT = [
  'You parse short Burmese (Myanmar language) voice notes or text from staff at a small clothing shop',
  'in Myanmar into ONE JSON object that matches the response schema. Reply with JSON only.',
  '',
  'Context you receive as text: the staff member\'s shop, the currently scanned item (id, name, price,',
  'stock, type) if any, what the bot is currently waiting for (e.g. a price, a customer name), the payment',
  'methods the shop uses as KEY:label pairs (pay_methods: cash, wallets and bank accounts; a label may hold the',
  'account holder\'s name) and the expense categories as key:label pairs (expense_categories).',
  '',
  'Intents:',
  '- SALE: pieces were sold. qty = pieces (default 1 for a UNIQUE item). unit_price if a per-piece price',
  '  was spoken, amount if a total was spoken. Leave price fields null to use the list price.',
  '  If the customer paid only part now, put the cash received in paid and the customer\'s name in customer.',
  '- RESTOCK: pieces arrived / were added to stock. qty required.',
  '- RETURN: a customer returned pieces. qty default 1.',
  '- EXPENSE: money paid out for the shop (fabric, thread, transport, electricity, wages). amount required,',
  '  category = the matching label or key from expense_categories (null if none fits), note = the spoken reason in Burmese.',
  '- PAYMENT: a customer paid money they owed from an earlier sale. customer and amount required.',
  '- DEPOSIT: a customer paid money in advance for an order (စရံ). customer and amount required, note = what for.',
  '- METHOD: the note ONLY says how the last thing was paid (a wallet or bank name and a verb like ပေးတယ်),',
  '  with no quantity, no amount, no item and no customer. method required.',
  '- ORDER: a customer orders a garment to be made to measure (အော်ဒါ, ချုပ်ခိုင်း, custom order). customer required',
  '  when spoken; item_hint = the design name or catalog code (TSL-18, ဝမ်းဆက်); qty = pieces (default 1);',
  '  unit_price = a spoken price per piece; amount = a spoken advance / deposit (စရံ) for the order.',
  '- TRANSFER: move the item to the other shop.',
  '- QUERY: a question, e.g. how much was sold today, how many are left. note = "today_sales" or "stock".',
  '- NEW_ITEM_INFO: the staff is describing a new item (name, price, cost) while the bot is waiting for it.',
  '  Put a spoken price in unit_price and a spoken cost in amount; put a spoken name in item_hint.',
  '- UNKNOWN: unclear, off-topic, or you would be guessing. Set confidence below 0.5.',
  '',
  'Rules:',
  '- The classifier ထည် counts garments. "ဒါ" / "ဒီဟာ" refers to the scanned item.',
  '- If the note names a different item than the scanned one, put the spoken name in item_hint.',
  '- Customer names usually start with ဒေါ်, ဦး, မ or ကို. Put the full name in customer.',
  '- Convert Burmese number words to integers: ဆယ်=10, ရာ=100, ထောင်=1000, သောင်း=10000, သိန်း=100000,',
  '  သန်း=1000000. နှစ်သောင်းငါးထောင် = 25000. သုံးထောင့်ငါးရာ = 3500. ခွဲ after a unit means "and a half":',
  '  တစ်သောင်းခွဲ = 15000, တစ်သိန်းခွဲ = 150000. Output plain integers only.',
  '- Money is Myanmar Kyat. Quantities under 100 are pieces; values of 500 and above are money.',
  '- Payment method: pay_methods lists KEY:label pairs. When the note names one of them (by its label, by the',
  '  holder\'s name in a label, or by a brand word such as KBZ / KBZPay / ကေဘီဇက်, Wave / WavePay / ဝေ့ဗ်,',
  '  ဘဏ် / ဘဏ်လွှဲ), answer method with that KEY exactly as listed; ငွေသား / လက်ငင်း -> CASH. A person\'s name',
  '  that is part of a pay_methods label is the account, not a customer. No method word, or no listed pair',
  '  fits -> method null.',
  '  English brand names are often said inside a Burmese sentence; keep listening for the Burmese around them.',
  '- transcript = the verbatim Burmese in Unicode. confidence = 0 to 1.',
  '',
  'Examples:',
  '"ဒါ ၂ ထည် ရောင်းရတယ်" -> {"intent":"SALE","qty":2,"confidence":0.95}',
  '"ဒါ ၁၀ ထည် ရောက်တယ်" -> {"intent":"RESTOCK","qty":10,"confidence":0.95}',
  '"တစ်ထည် နှစ်သောင်းနဲ့ ရောင်းလိုက်တယ်" -> {"intent":"SALE","qty":1,"unit_price":20000,"confidence":0.9}',
  '"နှစ်ထည် လေးသောင်း ရတယ်" -> {"intent":"SALE","qty":2,"amount":40000,"confidence":0.85}',
  '"ဒါ ၂ ထည် KBZ နဲ့ ရောင်းရတယ်" -> {"intent":"SALE","qty":2,"method":"KBZ","confidence":0.9}',
  '"ဒေါ်မြင့်ကို ဆယ်သိန်းနဲ့ ရောင်းတယ်၊ ငါးသိန်း ပေးသွားတယ်" -> {"intent":"SALE","qty":1,"unit_price":1000000,"paid":500000,"customer":"ဒေါ်မြင့်","confidence":0.85}',
  '"အထည်ဖိုး သုံးသောင်း ပေးလိုက်တယ်" -> {"intent":"EXPENSE","amount":30000,"category":"အထည်ဖိုး","note":"အထည်ဖိုး","confidence":0.9}',
  '"ဖုန်းဘေလ် တစ်သောင်းခွဲ KBZ နဲ့ ပေးလိုက်တယ်" -> {"intent":"EXPENSE","amount":15000,"category":"ဖုန်းဘေလ်","method":"KBZ","note":"ဖုန်းဘေလ်","confidence":0.9}',
  '"ဒေါ်မြင့် ငါးသိန်း ပေးသွားတယ်" -> {"intent":"PAYMENT","amount":500000,"customer":"ဒေါ်မြင့်","confidence":0.9}',
  '"ဒေါ်မြင့် ငါးသိန်း ဘဏ်ကနေ လွှဲပေးတယ်" -> {"intent":"PAYMENT","amount":500000,"customer":"ဒေါ်မြင့်","method":"BANK","confidence":0.9}',
  '"ဒေါ်ခင် စရံ သုံးသိန်း ပေးသွားတယ်" -> {"intent":"DEPOSIT","amount":300000,"customer":"ဒေါ်ခင်","confidence":0.9}',
  '"Wave နဲ့ ပေးသွားတယ်" -> {"intent":"METHOD","method":"WAVE","confidence":0.9}',
  '"KBZPay ကနေ လွှဲတယ်" -> {"intent":"METHOD","method":"KBZ","confidence":0.85}',
  '"ဒေါ်မြင့် ဝမ်းဆက် တစ်ထည် အော်ဒါ၊ စရံ တစ်သိန်း" -> {"intent":"ORDER","customer":"ဒေါ်မြင့်","item_hint":"ဝမ်းဆက်","qty":1,"amount":100000,"confidence":0.85}',
  '"ဒီနေ့ ဘယ်လောက်ရောင်းရလဲ" -> {"intent":"QUERY","note":"today_sales","confidence":0.95}',
  '"ဒါ ဘယ်နှစ်ထည် ကျန်လဲ" -> {"intent":"QUERY","note":"stock","confidence":0.9}',
  '"ဒါ တစ်ထည် ပြန်အမ်းတယ်" -> {"intent":"RETURN","qty":1,"confidence":0.9}',
  '"ဒါကို ဆိုင် ၂ ကို ပို့မယ်" -> {"intent":"TRANSFER","confidence":0.85}',
  '"မနက်ဖြန် မိုးရွာမလား" -> {"intent":"UNKNOWN","confidence":0.1}'
].join('\n');

var INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['SALE', 'RESTOCK', 'RETURN', 'EXPENSE', 'PAYMENT', 'DEPOSIT', 'METHOD', 'ORDER', 'TRANSFER', 'QUERY', 'NEW_ITEM_INFO', 'UNKNOWN'] },
    qty: { type: 'integer', nullable: true },
    unit_price: { type: 'integer', nullable: true },
    amount: { type: 'integer', nullable: true },
    paid: { type: 'integer', nullable: true },
    customer: { type: 'string', nullable: true },
    item_hint: { type: 'string', nullable: true },
    method: { type: 'string', nullable: true },   // a KEY of pay_methods (the accounts are the family's own list, so no enum)
    category: { type: 'string', nullable: true },
    note: { type: 'string', nullable: true },
    transcript: { type: 'string' },
    confidence: { type: 'number' }
  },
  required: ['intent', 'transcript', 'confidence']
};

var PHOTO_PROMPT = [
  'You see a photo of a garment for sale in a small clothing shop in Myanmar (often hand-sewn traditional wear).',
  'Return ONE JSON object: name (short Burmese product name, e.g. "ထမီ ချည်သား အနီ"), category (exactly one of',
  'the given list), color (Burmese), description (one short Burmese sentence for a catalog).',
  'Do NOT suggest a price. If the photo is not a garment, set category to the last entry of the list.'
].join('\n');

var PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string' },
    color: { type: 'string' },
    description: { type: 'string' }
  },
  required: ['name', 'category']
};

var NOTEBOOK_PROMPT = [
  'You see a photo of a handwritten sales notebook page from a small clothing shop in Myanmar.',
  'Each line is usually one sale: a garment name, a quantity (ထည်), a price or total in kyat, sometimes a customer name',
  'and sometimes a note such as a part payment. Return ONE JSON object with "lines": one entry per sales line, in order.',
  'For each line: raw = the text as written (Unicode Burmese), item_hint = garment words only, qty = pieces (default 1),',
  'unit_price = per-piece price if written, amount = total if written, customer = name if written, note = anything else,',
  'confidence = 0 to 1. Convert Burmese digits and number words to integers. Skip dates, headings and totals lines.',
  'If the page is not a sales notebook, return an empty lines array.'
].join('\n');

var NOTEBOOK_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          raw: { type: 'string' },
          item_hint: { type: 'string', nullable: true },
          qty: { type: 'integer', nullable: true },
          unit_price: { type: 'integer', nullable: true },
          amount: { type: 'integer', nullable: true },
          customer: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
          confidence: { type: 'number' }
        },
        required: ['raw', 'confidence']
      }
    }
  },
  required: ['lines']
};

/**
 * Context text sent with every audio/photo request. Small on purpose. Uses nothing but CFG
 * (tools/score_voice.js loads only core_config, core_burmese and this file).
 * pay_methods is printed as KEY:label strings. ctx.payMethods comes in two shapes, because a phone queues the
 * context it built and the server prints it later: an entry [KEY, label] becomes 'KEY:label', a string entry
 * (a bare KEY from an older build, or already 'KEY:label') stays as it is. Without ctx.payMethods the
 * default keys are printed as before.
 */
function aiContextText(ctx) {
  var methods = ctx.payMethods ? Array.prototype.map.call(ctx.payMethods, function (m) {
    return Array.isArray(m) ? String(m[0]) + ':' + String(m.length > 1 && m[1] !== null && m[1] !== undefined ? m[1] : m[0]) : String(m);
  }) : CFG.DEFAULT_PAY_METHODS;
  return 'Context: ' + JSON.stringify({
    shop: ctx.shop,
    staff: ctx.staff,
    item: ctx.item ? { id: ctx.item.id, name: ctx.item.name, price: ctx.item.price, stock: ctx.item.stock, type: ctx.item.type } : null,
    awaiting: ctx.awaiting || null,
    categories: ctx.categories || CFG.CATEGORIES,
    pay_methods: methods,
    expense_categories: (ctx.expenseCategories || CFG.EXPENSE_CATEGORIES).map(function (c) { return c[0] + ':' + c[1]; }),
    known_items: ctx.itemNames || undefined
  });
}

/* ------------------------------ measurement sheet (photo of the paper form) ------------------------------ */

/**
 * The prompt for a photo of the filled measurement sheet, built from the MeasureFields rows so a renamed
 * or added field reaches the model without a code change. fields = [{key, labelMy, labelEn, multi, type}].
 */
function measurementPrompt(fields) {
  var list = fields.map(function (f) {
    return '- ' + f.key + ': printed label "' + f.labelMy + '" (' + f.labelEn + ')' +
      (Number(f.multi) > 1 ? ', ' + f.multi + ' slash-separated values written in one cell, e.g. 36/30/20' : '') +
      (f.type === 'text' ? ', free text' : ', a number in centimetres, decimals allowed');
  });
  return [
    'You see a photo of a body-measurement sheet from a tailoring shop in Myanmar: a printed form with Burmese labels',
    '(Unicode or Zawgyi rendering) and handwritten values next to them, sometimes rotated or upside down, sometimes with',
    'glare, strike-throughs or Burmese digits. Read every value exactly as written and return ONE JSON object.',
    '"fields" has one entry per key below with the value as a STRING ("32", "17.5", "36/30/20", "ဘယ်"); use an empty',
    'string when the cell is blank or unreadable. Never guess: when a digit is doubtful (1/7, 0/6, smudged), still give',
    'your best reading but put the key in "low_confidence". Also read the header: name (any script), order_date,',
    'due_date, phone, and put margin notes in notes (verbatim Burmese). Convert Burmese digits to Arabic digits.',
    '',
    'Fields:'
  ].concat(list).join('\n');
}

/** Response schema for measurementPrompt: a fields object with one nullable string per key plus the header. */
function measurementSchema(fields) {
  var props = {};
  fields.forEach(function (f) { props[f.key] = { type: 'string', nullable: true }; });
  return {
    type: 'object',
    properties: {
      fields: { type: 'object', properties: props },
      name: { type: 'string', nullable: true },
      order_date: { type: 'string', nullable: true },
      due_date: { type: 'string', nullable: true },
      phone: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      low_confidence: { type: 'array', items: { type: 'string' } }
    },
    required: ['fields', 'low_confidence']
  };
}
