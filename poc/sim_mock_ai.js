/**
 * poc/sim_mock_ai.js — a rule-based stand-in for Gemini so the POC runs with no
 * API key and inside a sandboxed page. It understands the sample Burmese phrases
 * from the plan plus simple English ("sold 2", "restock 10", "expense 30000 fabric",
 * "Daw Myint paid 500000", "deposit 300000 from Daw Khin"), the shop's own accounts by the
 * label or key the bot listed in ctx.payMethods ("KBZ ဦးမောင် နဲ့ ပေးသွားတယ်"), payment-method words
 * ("KBZ", "Wave", "ဘဏ်", "ငွေသား") and the expense category labels.
 * Production uses gas_gemini.js with the real model; this file is never deployed.
 */
var MOCK_GARMENTS = ['ထမီ', 'လုံချည်', 'အင်္ကျီ', 'ဝတ်စုံ'];
var MOCK_COLORS = ['အနီ', 'အပြာ', 'အစိမ်း', 'အဝါ', 'အနက်', 'အဖြူ', 'ပန်းရောင်', 'ခရမ်း', 'ရွှေရောင်'];
/** [label the model would return, words that mean it]. Labels match CFG.EXPENSE_CATEGORIES. */
var MOCK_EXPENSE_CATS = [
  ['အထည်ဖိုး', ['အထည်ဖိုး', 'အထည်', 'fabric', 'cloth']],
  ['ချည်ဖိုး', ['ချည်ဖိုး', 'thread']],
  ['လက်ခ', ['လက်ခ', 'wage', 'labor', 'labour', 'tailor']],
  ['ကားခ', ['ကားခ', 'transport', 'taxi', 'bus']],
  ['ဖုန်းဘေလ်', ['ဖုန်းဘေလ်', 'ဖုန်းဖိုး', 'phone bill', 'phone']],
  ['ထမင်းဖိုး', ['ထမင်းဖိုး', 'နေ့လယ်စာ', 'food', 'lunch']],
  ['မီးဖိုး', ['မီးဖိုး', 'electric', 'electricity']],
  ['ဆိုင်ခ', ['ဆိုင်ခ', 'rent']]
];
var MOCK_METHODS = [
  ['KBZ', ['kbzpay', 'kbz', 'ကေဘီဇက်']],
  ['WAVE', ['wavepay', 'wave', 'ဝေ့ဗ်']],
  ['BANK', ['ဘဏ်', 'bank']],
  ['CASH', ['ငွေသား', 'လက်ငင်း', 'cash']]
];

/** Burmese names start with ဒေါ် or ဦး in the samples; English "Daw X" / "U X" / "Ko X" / "Ma X". */
function mockCustomer(s) {
  var m = s.match(/(^|\s)((?:ဒေါ်|ဦး)[က-႟]+)/);
  if (m) return m[2];
  var e = s.match(/\b((?:Daw|U|Ko|Ma)\s+[A-Z][a-zA-Z]+)/);
  if (e) return e[1];
  return null;
}

/** "ခွဲ" after a unit word means "and a half": တစ်သောင်းခွဲ = 15000. Rewritten so parseBurmeseNumbers reads it. */
function mockExpandHalf(s) {
  return String(s).replace(/သိန်းခွဲ/g, 'သိန်းငါးသောင်း').replace(/သောင်းခွဲ/g, 'သောင်းငါးထောင်').replace(/ထောင်ခွဲ/g, 'ထောင်ငါးရာ').replace(/ရာခွဲ/g, 'ရာငါးဆယ်');
}

/** `label` cut out of the raw text `s`, whatever the spacing and letter case it was said with. */
function mockCutName(s, label) {
  var gap = '[\\s' + String.fromCharCode(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff) + ']';
  var chars = String(label).replace(new RegExp(gap, 'g'), '').split('').map(function (ch) { return ch.replace(/[\\^$.*+?()[\]{}|\/-]/g, '\\$&'); });
  if (!chars.length) return s;
  var m = new RegExp(chars.join(gap + '*'), 'i').exec(s);
  return m ? (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() : s;
}

/**
 * The accounts the bot listed for this request (ctx.payMethods): [KEY, label] pairs, or strings 'KEY' /
 * 'KEY:label' (a phone queues the context an older build made). Looks for a label, then for a key, inside the
 * text: names compared like listNameKey does (no spaces, any case), the longest first. Returns {key, text},
 * the text with a matched label cut out so a holder's name inside a label ("KBZ ဦးမောင်") is not taken
 * for a customer, or null when nothing listed is named.
 */
function mockCtxMethod(s, ctx) {
  var list = (ctx && ctx.payMethods) || [], pairs = [], i;
  for (i = 0; i < list.length; i++) {
    var e = list[i], key = '', label = '';
    if (e && typeof e === 'object' && e.length) {
      key = String(e[0] || '');
      label = e.length > 1 ? String(e[1] || '') : '';
    } else if (typeof e === 'string') {
      var at = e.indexOf(':');
      key = at < 0 ? e : e.slice(0, at);
      label = at < 0 ? '' : e.slice(at + 1);
    }
    if (key) pairs.push({ key: key.toUpperCase(), label: label });
  }
  if (!pairs.length) return null;
  var nk = typeof listNameKey === 'function' ? listNameKey : function (x) { return String(x || '').replace(/\s+/g, '').toLowerCase(); };
  var said = nk(s);
  var byLabel = pairs.filter(function (p) { return nk(p.label).length >= 2; }).sort(function (a, b) { return nk(b.label).length - nk(a.label).length; });
  for (i = 0; i < byLabel.length; i++) {
    if (said.indexOf(nk(byLabel[i].label)) >= 0) return { key: byLabel[i].key, text: mockCutName(s, byLabel[i].label) };
  }
  var byKey = pairs.filter(function (p) { return p.key.length >= 2; }).sort(function (a, b) { return b.key.length - a.key.length; });
  for (i = 0; i < byKey.length; i++) {
    if (said.indexOf(nk(byKey[i].key)) >= 0) return { key: byKey[i].key, text: s };
  }
  return null;
}

function mockParseIntent(text, ctx) {
  var s = mockExpandHalf(String(text || '').trim());
  var transcript = String(text || '').trim();
  // The shop's own accounts first (before a customer is looked for), then the built-in method words as before.
  var listed = mockCtxMethod(s, ctx);
  if (listed) s = listed.text;
  var lower = s.toLowerCase();
  var has = function (words) {
    for (var i = 0; i < words.length; i++) if (lower.indexOf(words[i].toLowerCase()) >= 0) return true;
    return false;
  };
  var I = CFG.INTENT;
  var nums = parseBurmeseNumbers(s);
  var qty = null, moneys = [];
  nums.forEach(function (n) {
    var after = s.slice(n.end, n.end + 8);
    if (/^\s*(ထည်|pcs|pieces|pc|piece)/i.test(after)) qty = n.value;
    else if (/^\s*(ကျပ်|kyat|mmk|k\b)/i.test(after) || n.value >= 500) moneys.push(n.value);
    else if (qty === null) qty = n.value;
  });
  var money = moneys.length ? moneys[0] : null;
  var customer = mockCustomer(s);
  var method = listed ? listed.key : null;
  MOCK_METHODS.forEach(function (m) { if (!method && has(m[1])) method = m[0]; });
  var category = null;
  MOCK_EXPENSE_CATS.forEach(function (c) { if (!category && has(c[1])) category = c[0]; });

  var intent = I.UNKNOWN, note = null, confidence = 0.92;
  var question = has(['ဘယ်လောက်', 'ဘယ်နှစ်', 'လဲ', '?', 'how much', 'how many', 'total']);
  if (question) {
    intent = I.QUERY;
    note = has(['ကျန်', 'left', 'stock', 'remaining']) ? 'stock' : 'today_sales';
  } else if (has(['ပြန်အမ်း', 'ပြန်ပေး', 'return', 'refund'])) {
    intent = I.RETURN;
  } else if (customer && has(['အော်ဒါ', 'ချုပ်ခိုင်း', 'custom order'])) {
    // "ဒေါ်မြင့် ဝမ်းဆက် တစ်ထည် အော်ဒါ၊ စရံ တစ်သိန်း": a made-to-measure order; the spoken advance is the amount.
    intent = I.ORDER;
  } else if (has(['စရံ', 'deposit', 'advance'])) {
    intent = I.DEPOSIT;
    note = s.replace(/(ဒေါ်|ဦး)[က-႟]+|[\d၀-၉,]+|စရံ|ပေးသွားတယ်|ပေးတယ်|deposit|from|paid|Daw\s+\w+|U\s+\w+/g, '').trim();
    note = note.replace(/\s+/g, ' ').trim();
    if (note.length < 2 || /^(သုံး|နှစ်|တစ်|ငါး|လေး|ခြောက်|ခုနှစ်|ရှစ်|ကိုး|ဆယ်)/.test(note)) note = null;
  } else if (method && method !== 'CASH' && !customer && money === null && qty === null && !category &&
             has(['ပေး', 'လွှဲ', 'paid', 'pay', 'transfer']) && !has(['ရောင်း', 'sold', 'sell'])) {
    // Only how the last thing was paid: "Wave နဲ့ ပေးသွားတယ်", "KBZPay ကနေ လွှဲတယ်".
    intent = I.METHOD;
  } else if (customer && has(['ပေး', 'လွှဲ', 'paid', 'pay']) && !has(['ရောင်း', 'sold', 'sell'])) {
    intent = I.PAYMENT;
  } else if (!customer && (category || has(['ဖိုး', 'ကုန်ကျ', 'ပေးလိုက်', 'expense', 'paid', 'spent']))) {
    intent = I.EXPENSE;
    note = category || 'အခြား';
  } else if (has(['ပြောင်း', 'ပို့', 'transfer', 'move'])) {
    intent = I.TRANSFER;
  } else if (has(['ရောက်', 'ဝင်', 'ထည့်', 'restock', 'arrived', 'received'])) {
    intent = I.RESTOCK;
  } else if (has(['ရောင်း', 'sold', 'sell', 'sale'])) {
    intent = I.SALE;
  } else if (ctx && ctx.awaiting && (money !== null || qty !== null)) {
    intent = I.NEW_ITEM_INFO;
  } else {
    confidence = 0.2;
  }

  var out = { intent: intent, qty: qty, unit_price: null, amount: null, paid: null, customer: null, item_hint: null,
              method: null, category: null, note: note, transcript: transcript, confidence: confidence };
  if (intent === I.PAYMENT || intent === I.DEPOSIT || intent === I.ORDER) out.customer = customer;
  if (intent === I.EXPENSE) out.category = category;
  if (method && (intent === I.SALE || intent === I.RETURN || intent === I.PAYMENT || intent === I.DEPOSIT || intent === I.EXPENSE || intent === I.METHOD)) {
    out.method = method;
  }
  // The split amount question ("ငွေသား ငါးထောင်" / "KBZ နဲ့ တစ်သောင်း"): the method word says which part the amount is.
  // The guided sale's transfer-part screen (SPEC-round-5.md 1.2 Q3c) is awaiting 'sale_step' and converts a cash part the same way.
  if (method && intent === I.NEW_ITEM_INFO && ctx && (ctx.awaiting === 'split_bank' || ctx.awaiting === 'sale_step')) out.method = method;
  if (money !== null) {
    if (intent === I.SALE || intent === I.RETURN) {
      if (qty && qty > 1 && !has(['နဲ့', 'each', 'per'])) out.amount = money; else out.unit_price = money;
      if (intent === I.SALE && customer) {
        out.customer = customer;
        out.paid = moneys.length > 1 ? moneys[1] : null;
      }
    } else if (intent === I.NEW_ITEM_INFO) {
      if (ctx && ctx.awaiting === 'cost') out.amount = money; else out.unit_price = money;
    } else {
      out.amount = money;
    }
  }
  if (intent === I.ORDER) {
    // The design: a code (TSL-18, tsl 18) or one of the design words of the demo catalogue.
    var code = s.match(/[A-Za-z]{2,5}\s*-?\s*\d{1,4}/);
    var words = ['ဝမ်းဆက်', 'ရင်ဖုံး'].filter(function (w) { return s.indexOf(w) >= 0; });
    out.item_hint = code ? code[0] : (words[0] || null);
    return out;
  }
  // "ဒါ" / "this" means the scanned item; otherwise a garment word becomes a hint.
  if (!has(['ဒါ', 'ဒီဟာ', 'this'])) {
    for (var g = 0; g < MOCK_GARMENTS.length; g++) {
      if (s.indexOf(MOCK_GARMENTS[g]) >= 0) {
        var hint = MOCK_GARMENTS[g];
        for (var c = 0; c < MOCK_COLORS.length; c++) if (s.indexOf(MOCK_COLORS[c]) >= 0) { hint += ' ' + MOCK_COLORS[c]; break; }
        out.item_hint = hint;
        break;
      }
    }
  }
  return out;
}

function mockDescribePhoto(file, ctx) {
  var meta = file && file.meta;
  if (meta && meta.name) return { name: meta.name, category: meta.category, color: meta.color || '', description: meta.description || '' };
  return { name: 'ပစ္စည်းအသစ်', category: CFG.CATEGORIES[CFG.CATEGORIES.length - 1], color: '', description: '' };
}

/**
 * A filled measurement-sheet preset carries meta.measure = {fields, low_confidence, name, notes}; only the keys the bot
 * asked for (ctx.fields, the active MeasureFields) come back, as strings. Anything else reads as a blank sheet.
 */
function mockReadMeasurementSheet(file, ctx) {
  var m = file && file.meta && file.meta.measure;
  if (!m) return { fields: {}, low_confidence: [], name: '', notes: '' };
  var want = {}, out = {};
  ((ctx && ctx.fields) || []).forEach(function (f) { want[f.key] = true; });
  Object.keys(m.fields || {}).forEach(function (k) { if (want[k]) out[k] = String(m.fields[k]); });
  return { fields: out, low_confidence: (m.low_confidence || []).filter(function (k) { return out[k] !== undefined; }),
           name: m.name || '', notes: m.notes || '' };
}

/** A "notebook page" photo preset carries its lines; anything else reads as an empty page. */
function mockReadNotebook(file, ctx) {
  var meta = file && file.meta;
  return meta && meta.lines ? meta.lines.map(function (l) {
    var o = {};
    for (var k in l) o[k] = l[k];
    if (o.confidence === undefined) o.confidence = 0.85;
    return o;
  }) : [];
}
