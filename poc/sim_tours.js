/**
 * poc/sim_tours.js — the simulator's "what can I do · ဘာလုပ်လို့ရလဲ" tours, as data (round 5, spec 6.4; round 6,
 * spec 8.3-8.4: the sellers' jobs run on the app's forms). Plain ES5, inlined by poc/build_simulator.js before
 * poc/sim_ui.js, which runs them.
 *
 * A tour: {id, login, device, devices?, need?, noAutoEnrol?, title: {my, en}, steps: [...]}.
 *   login   the SIM_USERS key the tour starts as; device 'tg' | 'app' | 'laptop' (the default pane of every step)
 *   devices the panes the tour can run on (['tg', 'app']); it then runs on the pane that is open (payment, deposit)
 *   need    {item: id} a one-piece item still in stock, {blank: id} a blank tag, {unenrolled: true} a phone not enrolled,
 *           {ai: true} the owner's AI switch on (Settings ai, aiOn): a step taps a button the bot offers only with AI on
 *           (the sheet photo MM|<t>|photo, round 6 13.11), so with AI off the tour does not start and says why
 * A step: {my, en, target, done, login?, device?, only?, act?}.
 *   target  {tag: 'S1-0002'} the rack tile; {cb: 'S|S1-0002|1'} exact callback data (the app's stepper matches on the
 *           'S|<id>|' prefix); {label: 'btn_all'} a MSG or APP_MSG key, matched by its text up to the first '{';
 *           {re: '^PY\\|'} the first button whose callback data matches; {type: '5000'} the input bar, pre-filled
 *           ('@code' = the enrol code the bot sent last); {ui: '#clockDay'} page chrome ('frame:#btnMenu' inside the
 *           app frame); {tab: 'lists', cell: 'KBZ.Label'} the laptop; round 6: {f: 'save'} a control of the app's open
 *           form or a job tile (its data-f name, tapped), {f: 'amount', value: 12500} a form value (spec 8.3)
 *   done    function (e, c): true when the step happened. e is one event: {src: 'tg' | 'app' | 'page' | 'world',
 *           kind: 'tap' | 'text' | 'photo' | 'scan' | 'ui' | 'sync' | 'enter' | ..., data, text, id, name};
 *           c is the page context (sim_ui.js makeCtx: world, login, device, tab, frame, want, mark, ...); c.frame.form
 *           is the open form as the frame's snapshot shows it (appFormSnap: kind, lines, error, last = the control used)
 *   login, device  a per-step override: the panel switches the pane and says so in both languages
 *   only    'tg' | 'app': the step exists only when the tour runs on that pane (START is Telegram's, ☰ the app's)
 *   act     function (c): what "⏭ do it for me" does when the target alone does not say it
 * Captions: {k:key} = the label of a MSG/APP_MSG key at run time (t(world.ports, key) up to its first '{'),
 * {f:key|n=V} = that text filled, {l:list.KEY} = an option's current label (the Lists tab), {v:scan|tap|type} = a verb
 * of SIM_TOUR_MSG, {c:code} = the enrol code the bot sent last (the pane has switched to 📱, so the caption carries it). The Burmese captions beyond those words are a draft for the owner (page copy, never shown to buyers).
 */

/** The connecting Burmese verbs, each a word the bot already says: 'scan လုပ်ပါ' (menu), 'နှိပ်ပါ' (help), 'ရိုက်ပါ' (cust_find). */
var SIM_TOUR_MSG = {
  scan: 'scan လုပ်ပါ',
  tap: 'နှိပ်ပါ',
  type: 'ရိုက်ပါ',
  sources: { scan: 'menu', tap: 'help', type: 'cust_find' }
};

var SIM_TOURS = (function () {
  function ext(a, b) { var o = {}, k; for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k]; for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k]; return o; }

  /* ---------- done predicates ---------- */
  function tap(cb) {
    var pre = /^S\|[^|]+\|/.exec(cb);   // the app's stepper sends S|<id>|<n>: there a 'S|' target matches on its prefix
    return function (e) {
      if (e.kind !== 'tap') return false;
      if (e.data === cb) return true;
      return !!pre && e.src === 'app' && String(e.data).indexOf(pre[0]) === 0;
    };
  }
  function tapRe(re) { var r = new RegExp(re); return function (e) { return e.kind === 'tap' && r.test(String(e.data)); }; }
  /** A label target: the tap carried the callback the label rule found on the screen (c.want). */
  function tapWant() { return function (e, c) { return e.kind === 'tap' && !!c.want && e.data === c.want; }; }
  function said(text) { return function (e) { return e.kind === 'text' && e.text === text; }; }
  function scanned(id) {
    return function (e) { return (e.kind === 'scan' && e.id === id) || (e.src === 'app' && e.kind === 'text' && e.text === '/start ' + id); };
  }
  function started(id) { return function (e) { return e.kind === 'text' && e.text === '/start ' + id; }; }
  function menuOpened() { return function (e) { return e.kind === 'text' && e.text === '/start'; }; }
  function photoSent() { return function (e) { return e.kind === 'photo'; }; }
  function pressed(name) { return function (e) { return e.kind === 'ui' && e.name === name; }; }
  function when(fn) { return function (e, c) { return !!fn(c); }; }
  function any() {
    var fns = Array.prototype.slice.call(arguments);
    return function (e, c) { for (var i = 0; i < fns.length; i++) if (fns[i](e, c)) return true; return false; };
  }
  /* Round 6 (spec 8.3): the app's open form as the frame's snapshot shows it. A scan into an open form never reaches
     the bot, so it is seen there; a form event says nothing about the control used, so the snapshot carries last. */
  function formIs(kind) { return when(function (c) { return !!(c.frame && c.frame.form && c.frame.form.kind === kind); }); }
  function formHas(fn) { return when(function (c) { return !!(c.frame && c.frame.form && fn(c.frame.form)); }); }
  /** A row of that type (and item; '' = any) arrived after the step began (T.mark.ledger), and passes test when given. */
  function ledgerGrew(type, itemId, test) {
    return when(function (c) {
      var rows = c.world.ledger.slice((c.mark && c.mark.ledger) || 0);
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.type === type && !r.reversesTxId && (!itemId || r.itemId === itemId) && (!test || test(r))) return true;
      }
      return false;
    });
  }
  /** At least n rows of that type arrived after the step began, all in one group (a basket). */
  function oneGroup(type, n) {
    return when(function (c) {
      var rows = c.world.ledger.slice((c.mark && c.mark.ledger) || 0).filter(function (r) { return r.type === type && !r.reversesTxId; });
      return rows.length >= n && rows.every(function (r) { return r.groupId === rows[0].groupId; });
    });
  }
  /** The tag reached the app: its scan opened a form (the /start of a home scan) or it is a line of the open form. */
  function tagIn(id) {
    return any(scanned(id), formHas(function (f) {
      return f.itemId === id || (f.lines || []).some(function (l) { return l.id === id; });
    }));
  }
  /** Revision 2, B2: the control was used after this step began (c.mark.formN = the snapshot's last.n then). */
  function formUsed(name) {
    return function (e, c) {
      var f = c.frame && c.frame.form;
      return !!(f && f.last && f.last.f === name && f.last.n > ((c.mark && c.mark.formN) || 0));
    };
  }
  function listRow(c, list, key) {
    var rows = c.world.ports.store.listOptions(list);
    for (var i = 0; i < rows.length; i++) if (listNormKey(list, rows[i].key) === listNormKey(list, key)) return rows[i];
    return null;
  }
  /** The enrol code is typed as the app reads it (syncNormalizeCode): with or without the dash, in either case. */
  function codeTyped(typed, code) {
    var a = syncNormalizeCode(typed || ''), b = syncNormalizeCode(code || '');
    return a !== '' && a === b;
  }
  function creditOf(c, name) {
    var list = openCredits(c.world.ports, null);
    for (var i = 0; i < list.length; i++) if (list[i].customer === name) return list[i];
    return null;
  }
  /** One of the sample photos (poc/sim_seed.js), the whole record: the page sends it to the frame (revision 2, B3). */
  function photoPreset(key) {
    for (var i = 0; i < SIM_PHOTOS.length; i++) if (SIM_PHOTOS[i].key === key) return SIM_PHOTOS[i];
    return null;
  }

  /* ---------- step makers ---------- */
  function tag(id, my, en) {
    return { target: { tag: id }, done: scanned(id), my: my || '🏷 ' + id + ' ကို {v:scan}', en: en || 'Scan the tag ' + id + ' on the rack: click it.' };
  }
  /** A scan on the app: the sale (or new-piece) form opens with the piece, or the open form takes it as a line. */
  function appTag(id, my, en) { return ext(tag(id, my, en), { done: tagIn(id) }); }
  function start(id) {
    return { only: 'tg', target: { ui: '#startbar button' }, done: started(id), my: 'START {v:tap}', en: 'Telegram opens the bot with a START button: press it. The item card comes back.' };
  }
  function cb(data, my, en, more) { return ext({ target: { cb: data }, done: tap(data), my: my, en: en }, more || {}); }
  function re(rx, my, en, more) { return ext({ target: { re: rx }, done: tapRe(rx), my: my, en: en }, more || {}); }
  function label(key, my, en, more) { return ext({ target: { label: key }, done: tapWant(), my: my || '{k:' + key + '} {v:tap}', en: en }, more || {}); }
  function typed(text, my, en, more) { return ext({ target: { type: text }, done: said(text), my: my || text + ' {v:type}', en: en }, more || {}); }
  /** A control of the app's form, tapped (its data-f name); a job tile is done when its form is open (spec 8.3). */
  function ff(name, my, en, more) {
    var job = /^job:(.+)$/.exec(name), kind = job ? (job[1] === 'sell' ? 'sale' : job[1] === 'new' ? 'newitem' : job[1]) : '';
    return ext({ target: { f: name }, done: job ? formIs(kind) : formUsed(name), my: my, en: en }, more || {});
  }
  /**
   * A value typed into a control of the app's form (a number field's keypad, a text box): the frame's set op. alt names
   * the chip that gives the same value (a seller taps it instead): the step is done when either control was used.
   */
  function fset(name, value, my, en, alt) {
    return { target: { f: name, value: value }, done: alt ? any(formUsed(name), formUsed(alt)) : formUsed(name), my: my, en: en };
  }
  /** The menu: /start typed in Telegram, ☰ on the app. */
  function menu() {
    return [
      { only: 'tg', target: { type: '/start' }, done: menuOpened(), my: '/start {v:type}', en: 'Open the menu: type /start and send it.' },
      { only: 'app', target: { ui: 'frame:#btnMenu' }, done: menuOpened(), my: '☰ မီနူး {v:tap}', en: 'Open the menu: tap ☰ at the bottom of the app.',
        act: function (c) { c.frameCmd({ op: 'menu' }); } }
    ];
  }
  /**
   * Round 6b, step-4 checker: ⏭ of a count in Telegram's ☰ 📦 loop (the tgrestock tour). The loop ends three minutes after
   * its last question (CFG.RESTOCK_LOOP_TTL_SEC, by the world clock: a slow read of the captions, or a ⏩), and START then
   * shows the item card, so the count the step wants is not offered. When the bot is not waiting for this tag's count (the
   * bot's own rule, restockLoopOf), ⏭ opens the loop again as a person would: /start, 📦, the scan and START; then the count.
   */
  function loopCount(id, data) {
    return function (c) {
      var lp = restockLoopOf(getState(c.world.ports, c.user.id));
      if (!lp || lp.step !== 'qty' || lp.itemId !== id) { c.text('/start'); c.tapData('M|restock'); c.scan(id); c.start(); }
      c.tapData(data);
    };
  }
  function flat(list) {
    var out = [];
    list.forEach(function (s) { if (s && s.length !== undefined && typeof s !== 'string') out = out.concat(s); else out.push(s); });
    return out;
  }
  var OWNER_LAPTOP = { login: 'owner', device: 'laptop' };
  var SAVE_MY = '{k:ui_w_save} {v:tap}';
  /** The count steps of tgrestock: what a person does when the loop ended before START (loopCount does it for ⏭). */
  var LOOP_LATE = ' The item card came instead of the count screen? More than three minutes passed since the bot\'s last question, so the loop ended: type /start, tap {k:btn_restock}, scan the tag and press START again (⏭ does that).';

  return [
    {
      id: 'sell', login: 'sister', device: 'app',
      title: { my: 'ရောင်း · တစ်မျက်နှာတည်း (ငွေသား · အကုန်)', en: 'Sell on one screen (cash, paid in full)' },
      steps: flat([
        appTag('S1-0002', null, 'Scan S1-0002 on the shop-1 rack (a SKU: 18,000, five in stock): click its tag. The phone opens the sale form with the piece as its first line.'),
        ff('save', SAVE_MY, 'The form starts at count 1, cash, paid in full and no buyer, so a normal cash sale is this one tap: {k:ui_w_save} at the bottom. One SALE row; it reaches the Ledger at the next sync.',
          { done: ledgerGrew('SALE', 'S1-0002') })
      ])
    },
    {
      id: 'deposit', login: 'sister', device: 'app', need: { item: 'S1-0001' },
      title: { my: 'စရံ နဲ့ ရောင်း · ကျန်ငွေ ပေးမည့်ရက်', en: 'Sell with a deposit and a date for the rest' },
      steps: flat([
        appTag('S1-0001', null, 'Scan S1-0001 (one piece, 25,000): the sale form opens with it.'),
        ff('buyer:new', '{k:btn_new_customer} {v:tap}', 'A buyer who has not bought before: under {k:btn_customer} tap {k:btn_new_customer}.'),
        fset('name', 'ဒေါ်နီနီ', 'ဒေါ်နီနီ {v:type}', 'Type her name, ဒေါ်နီနီ.'),
        fset('phone', '09444555666', '09444555666 {v:type}', 'Type her phone number, 09444555666 (it may stay empty).'),
        ff('paid:part', '{k:btn_credit} {v:tap}', 'She pays only a part now: tap {k:btn_credit}. What she pays now and the promised day are outlined: Save waits for both.'),
        fset('amount', 12500, '12,500 {v:type}', 'What she pays now: tap the amount and type 12500 on the keypad (half, 12,500, is also a chip).', 'amount:half'),
        ff('due:14', '{f:btn_days|n=၁၄} {v:tap}', 'When does she pay the rest? Tap 14 days.'),
        ff('save', SAVE_MY, 'Tap {k:ui_w_save}: one SALE row with her as the buyer and its DueDay; the buyer is created now. The owner sees it after the sync.',
          { done: when(function (c) { return !!creditOf(c, 'ဒေါ်နီနီ'); }) }),
        ext(OWNER_LAPTOP, { target: { tab: 'credits' }, done: when(function (c) { return c.device === 'laptop' && c.tab === 'credits'; }),
          my: 'ဆိုင်ရှင် · 💻 · Credits {v:tap}', en: 'The owner\'s laptop: open the Credits tab. ဒေါ်နီနီ owes 12,500; DueDay is 14 days ahead.',
          act: function (c) { c.openTab('credits'); } }),
        ext(OWNER_LAPTOP, { target: { ui: '#clockDay' }, done: when(function (c) { var cr = creditOf(c, 'ဒေါ်နီနီ'); return !!cr && cr.overdue; }),
          my: '⏩ +1 ရက် × ၁၅ {v:tap}', en: 'Press ⏩ +1 ရက် fifteen times: the demo clock moves 15 days ahead and the credit turns ⏰ overdue.',
          act: function (c) { for (var i = 0; i < 15; i++) { var cr = creditOf(c, 'ဒေါ်နီနီ'); if (cr && cr.overdue) break; c.click('#clockDay'); } } }),
        ext(OWNER_LAPTOP, { target: { ui: '#clock2100' }, done: pressed('clock2100'), my: '🕘 21:00 {v:tap}', en: 'Move the clock to 21:00, when the bot posts the day\'s summary.',
          act: function (c) { c.click('#clock2100'); } }),
        ext(OWNER_LAPTOP, { target: { ui: '#postSummary' }, done: pressed('summary'), my: 'Post 21:00 summary {v:tap}',
          en: 'Post the 21:00 summary: the Family group tab shows {k:summary_due_overdue} with ဒေါ်နီနီ.', act: function (c) { c.click('#postSummary'); } })
      ])
    },
    {
      id: 'mixed', login: 'sister', device: 'app',
      title: { my: 'ခွဲပေး (ငွေသား + KBZPay)', en: 'A mixed payment (part KBZPay, the rest cash)' },
      steps: flat([
        appTag('S1-0003', null, 'Scan S1-0003 (12,000, three in stock): the sale form opens with it.'),
        ff('pay:mix', '{k:btn_split} {v:tap}', 'Part by an account, the rest in cash: under how paid tap {k:btn_split}.'),
        ff('acct:KBZ', '{l:pay_method.KBZ} {v:tap}', 'Which account? Tap {l:pay_method.KBZ}.'),
        fset('transfer', 5000, '5,000 {v:type}', 'The KBZPay part: tap its box and type 5000 on the keypad. The form shows the cash part, 7,000.'),
        ff('save', SAVE_MY, 'Tap {k:ui_w_save}: two rows in one group, the SALE with the cash part and a PAYMENT of 5,000 to KBZPay.',
          { done: ledgerGrew('PAYMENT', '', function (r) { return Number(r.amount) === 5000 && r.method === 'KBZ'; }) })
      ])
    },
    {
      id: 'price', login: 'sister', device: 'app',
      title: { my: 'စျေးလျှော့ပြီး ၂ ထည် ရောင်း', en: 'A changed price for two pieces' },
      steps: flat([
        appTag('S1-0002'),
        fset('price:S1-0002', 15000, '15,000 {v:type}', 'The buyer bargains: tap the line\'s price (18,000) and type the agreed price for one piece, 15000.'),
        ff('qty+:S1-0002', '+ {v:tap}', 'Two pieces at that price: tap + on the line\'s count.'),
        ff('save', SAVE_MY, 'Tap {k:ui_w_save}: one sale of 2 × 15,000 = 30,000.',
          { done: ledgerGrew('SALE', 'S1-0002', function (r) { return Number(r.qty) === -2 && Number(r.amount) === 30000; }) })
      ])
    },
    {
      id: 'back', login: 'sister', device: 'app',
      title: { my: 'ဖယ် · မလုပ်တော့', en: 'Remove a line, then leave' },
      steps: flat([
        appTag('S1-0002'),
        appTag('S1-0003', null, 'Scan a second piece, S1-0003: it becomes the second line of the same form.'),
        ff('remove:S1-0003', '{k:btn_remove_line} {v:tap}', 'The wrong piece? The bin on its line takes it out again.'),
        ff('close', '{k:ui_btn_back} {v:tap}', 'Changed your mind? ← at the top left leaves the form and nothing is written (on a phone it asks first, because the form was changed).',
          { act: function (c) { c.frameCmd({ op: 'close' }); },
            done: when(function (c) { return !!c.frame && !c.frame.form && c.world.ledger.length === c.mark.ledger; }) })
      ])
    },
    {
      id: 'restock', login: 'brother', device: 'app',
      title: { my: 'ကုန်ရောက် (ဆိုင် ၂)', en: 'Restock (shop 2)' },
      steps: flat([
        ff('job:restock', '{k:btn_restock} {v:tap}', 'New pieces arrived: on the home tap {k:btn_restock}. The restock form opens with its camera.'),
        appTag('S2-0003', null, 'Scan S2-0003 on the shop-2 rack (one left): it becomes the form\'s line.'),
        fset('qty:S2-0003', 5, '၅ {v:type}', 'Five arrived: tap the count and type 5 (the ၅ chip does the same).', 'qtyset:S2-0003:5'),
        ff('save', SAVE_MY, 'Tap {k:ui_w_save}: one RESTOCK row of +5; the stock shows 6.',
          { done: ledgerGrew('RESTOCK', 'S2-0003', function (r) { return Number(r.qty) === 5; }) })
      ])
    },
    {
      id: 'newitem', login: 'sister', device: 'app', need: { blank: 'S1-0007' },
      title: { my: 'Tag အသစ် · ဓာတ်ပုံနဲ့ မှတ်', en: 'Register a new piece by photo' },
      steps: flat([
        appTag('S1-0007', null, 'Scan a blank tag, S1-0007: the new-piece form opens.'),
        ff('photo', '{k:ui_w_photo} {v:tap}', 'Tap {k:ui_w_photo} and take the picture (here: the green htamein). The form never waits for the AI: the name comes after the next sync.',
          { act: function (c) { c.frameCmd({ op: 'photo', preset: photoPreset('htamein_green') }); } }),
        fset('price', 25000, '25,000 {v:type}', 'The price: tap its box and type 25000 (or tap the 25,000 chip).', 'price:25000'),
        fset('cost', 12000, '12,000 {v:type}', 'The cost (fabric + labour): type 12000. The form shows the profit and its %.'),
        ff('save', SAVE_MY, 'Tap {k:ui_w_save}: the tag is registered at 25,000; after the sync the photo AI names the piece.',
          { done: when(function (c) { var it = c.world.ports.store.getItem('S1-0007'); return !!it && it.status === CFG.STATUS.ACTIVE && Number(it.price) === 25000; }) })
      ])
    },
    {
      id: 'return', login: 'sister', device: 'tg',
      title: { my: 'ပြန်အမ်း', en: 'A return' },
      steps: flat([
        tag('S1-0002'),
        start('S1-0002'),
        cb('T|S1-0002', '{k:btn_return} {v:tap}', 'A buyer brings one back: tap {k:btn_return}. One RETURN row; the account buttons only correct how the money went back.')
      ])
    },
    {
      id: 'expense', login: 'sister', device: 'app',
      title: { my: 'ကုန်ကျစရိတ် မှတ်', en: 'Record an expense' },
      steps: flat([
        ff('job:expense', '{k:btn_expense} {v:tap}', 'On the home tap {k:btn_expense} (☰ → {k:btn_expense} opens the same form).'),
        ff('cat:fabric', '{l:expense_category.fabric} {v:tap}', 'What for? Tap {l:expense_category.fabric}.'),
        fset('amount', 20000, '20,000 {v:type}', 'How much? Tap the amount and type 20000 (or tap the 20,000 chip).', 'amount:20000'),
        ff('save', SAVE_MY, 'Cash is chosen already: tap {k:ui_w_save}. One EXPENSE row.',
          { done: ledgerGrew('EXPENSE', '', function (r) { return Math.abs(Number(r.amount)) === 20000; }) })
      ])
    },
    {
      id: 'tgsale', login: 'sister', device: 'tg',
      title: { my: 'Telegram · ရောင်းကတ် (အက်ပ် မရှိရင်)', en: 'Telegram backup: the review card' },
      steps: flat([
        tag('S1-0002', null, 'No app at hand? The same sale works in Telegram. Scan S1-0002 on the shop-1 rack.'),
        start('S1-0002'),
        cb('S|S1-0002|1', '{k:btn_sell_one} {v:tap}', 'Tap {k:btn_sell_one}: nothing is written yet; the card becomes the review card (its lines, the buyer, how paid).'),
        cb('SS|S1-0002|add', '{k:btn_add_item} {v:tap}', 'A second piece for the same buyer: tap {k:btn_add_item}, then scan it. (A scan without ➕ only pauses the card.)'),
        tag('S1-0005', null, 'Scan S1-0005 (22,000).'),
        ext(start('S1-0005'), { en: 'Press START: the piece joins the review card as its second line.' }),
        cb('SC|S1-0002|ok', '{k:btn_save} {v:tap}', 'Tap {k:btn_save}: two SALE rows in one group, with one receipt number.', { done: oneGroup('SALE', 2) })
      ])
    },
    {
      id: 'payment', login: 'sister', device: 'tg', devices: ['tg', 'app'],
      title: { my: 'အကြွေး ငွေလက်ခံ', en: 'Receive a payment on a credit' },
      steps: flat([
        menu(),
        cb('M|pay', '{k:btn_pay} {v:tap}', 'Tap {k:btn_pay}.'),
        re('^PY\\|', 'ဒေါ်မြင့် {v:tap}', 'Who pays? Tap the first credit (ဒေါ်မြင့် owes 500,000 in the demo).'),
        label('btn_all', null, 'She pays it all: tap {k:btn_all}. One PAYMENT row; the credit is closed.')
      ])
    },
    {
      id: 'takedeposit', login: 'sister', device: 'tg', devices: ['tg', 'app'],
      title: { my: 'စရံ လက်ခံ', en: 'Take a deposit' },
      steps: flat([
        menu(),
        cb('M|dep', '{k:btn_deposit} {v:tap}', 'Tap {k:btn_deposit}.'),
        cb('DC|C-0002', 'ဒေါ်ခင် {v:tap}', 'Who? Tap ဒေါ်ခင်.'),
        cb('DA|C-0002|100000', '100,000 {v:tap}', 'How much? Tap 100,000.'),
        cb('DN|C-0002|100000', '{k:btn_skip} {v:tap}', 'What for? Skip the note: tap {k:btn_skip}. One DEPOSIT row; Deposits shows what she holds.')
      ])
    },
    {
      id: 'order', login: 'sister', device: 'tg', need: { ai: true },
      title: { my: 'အော်ဒါ · ဘောက်ချာ · အတိုင်းအတာ', en: 'A custom order with its voucher and measurements' },
      steps: flat([
        menu(),
        cb('M|ord', '{k:btn_orders} {v:tap}', 'Tap {k:btn_orders}.'),
        cb('ON', '{k:btn_order_new} {v:tap}', 'Tap {k:btn_order_new}.'),
        cb('OC|C-0001', 'ဒေါ်မြင့် {v:tap}', 'For whom? Tap ဒေါ်မြင့်.'),
        re('^OI\\|[^|]+\\|TSL-0018$', 'TSL-0018 {v:tap}', 'Which design? Tap TSL-0018 (ဝမ်းဆက်, 150,000).'),
        re('^OQ\\|[^|]+\\|1$', '၁ {v:tap}', 'How many? Tap ၁.'),
        re('^OD\\|[^|]+\\|14$', '{f:btn_days|n=၁၄} {v:tap}', 'Ready when? Tap the ✨ 14 days of the design.'),
        re('^ODA\\|[^|]+\\|50000$', '50,000 {v:tap}', 'The advance: tap 50,000. The voucher comes.'),
        re('^MS\\|V', '{k:btn_measure} {v:tap}', 'Measurements for this order: tap {k:btn_measure} on the voucher.'),
        re('^MM\\|[^|]+\\|photo$', '{k:btn_meas_photo} {v:tap}', 'Take them from the paper sheet: tap {k:btn_meas_photo}.'),
        { target: { ui: '#photoBtn' }, done: photoSent(), my: '📷 {v:tap}', en: 'Tap 📷 and pick the measurement sheet.',
          act: function (c) { c.photo('meas_sheet_myint'); } },
        re('^MK\\|', '{k:btn_all_correct} {v:tap}', 'The bot read the sheet (❓ marks a box it is unsure of): tap {k:btn_all_correct}. One Measurements row.'),
        { device: 'app', target: { ui: 'frame:#btnMenu' }, done: menuOpened(), my: '📱 · ☰ မီနူး {v:tap}',
          en: 'The same on the app, with its form: open the menu with ☰.', act: function (c) { c.frameCmd({ op: 'menu' }); } },
        cb('M|meas', '{k:btn_measure} {v:tap}', 'Tap {k:btn_measure}.', { device: 'app' }),
        cb('MS|C-0002', 'ဒေါ်ခင် {v:tap}', 'For whom? Tap ဒေါ်ခင်: the measurement form opens.', { device: 'app' }),
        { device: 'app', target: { ui: 'frame:#measForm [data-f="save"]' }, my: '{k:ui_w_save} {v:tap}',
          en: 'Fill a few boxes and tap {k:ui_w_save}. Under the boxes is the figure ({k:ui_sketch_title}, a woman or a man): {k:ui_sketch_pen} lets a finger draw on it, and the drawing is kept with the session and printed on its PDF. The row reaches the Measurements tab at the next sync.',
          done: when(function (c) { return c.world.measurements.length > c.mark.meas; }),
          act: function (c) { c.frameCmd({ op: 'meas', values: { neck: '30', bust: '33', waist: '26' } }); } }
      ])
    },
    {
      id: 'reports', login: 'sister', device: 'tg',
      title: { my: 'စာရင်း PDF · ၂၁:၀၀ အစီရင်ခံ', en: 'Reports and the 21:00 summary' },
      steps: flat([
        menu(),
        cb('M|rep', '{k:btn_reports} {v:tap}', 'Tap {k:btn_reports}.'),
        cb('RP|today', '{k:rep_today} {v:tap}', 'Tap {k:rep_today}: a PDF arrives (open "Preview the PDF").'),
        ext(OWNER_LAPTOP, { target: { ui: '#clock2100' }, done: pressed('clock2100'), my: '🕘 21:00 {v:tap}', en: 'The owner: move the clock to 21:00.',
          act: function (c) { c.click('#clock2100'); } }),
        ext(OWNER_LAPTOP, { target: { ui: '#postSummary' }, done: pressed('summary'), my: 'Post 21:00 summary {v:tap}',
          en: 'Post the 21:00 summary: the Family group tab shows the day of both shops.', act: function (c) { c.click('#postSummary'); } })
      ])
    },
    {
      id: 'enrol', login: 'sister', device: 'tg', noAutoEnrol: true, need: { unenrolled: true },
      title: { my: 'ဖုန်းအက်ပ် ချိတ်ဆက်', en: 'Enrol a phone (the app)' },
      steps: flat([
        menu(),
        cb('M|app', '{k:btn_app} {v:tap}', 'Tap {k:btn_app}: the bot answers with a one-time code (15 minutes).'),
        { device: 'app', target: { type: '@code' }, my: '📱 · 🔑 {c:code} {v:type}', en: 'Switch to the app (📱): type the code {c:code} into the box.',
          done: when(function (c) { return !!c.frame && (c.frame.deviceId !== '' || codeTyped(c.frame.code, c.code)); }),
          act: function (c) { c.frameCmd({ op: 'fill', text: c.code }); } },
        { device: 'app', target: { label: 'ui_btn_enroll' }, my: '{k:ui_btn_enroll} {v:tap}', en: 'Tap {k:ui_btn_enroll}: the phone downloads the shop and is ready.',
          done: when(function (c) { return !!c.frame && c.frame.deviceId !== '' && c.frame.screen === 'home'; }),
          act: function (c) { c.frameCmd({ op: 'enroll', code: c.code }); } },
        { login: 'owner', device: 'tg', target: { type: '/start' }, done: menuOpened(), my: 'ဆိုင်ရှင် · /start {v:type}', en: 'The owner\'s Telegram: type /start.' },
        cb('M|devices', '{k:btn_devices} {v:tap}', 'Tap {k:btn_devices}: the new phone is listed with its receipt letter.', { login: 'owner', device: 'tg' })
      ])
    },
    {
      id: 'lists', login: 'owner', device: 'laptop',
      title: { my: '💻 Lists ပြင် · ဘဏ်/အကောင့်', en: 'Manage the accounts on the laptop (Lists)' },
      steps: flat([
        { target: { tab: 'lists', cell: 'KBZ.Label' }, my: 'Lists · KBZPay ကို ပြင်', en: 'Lists tab: rename KBZPay (click its Label, type e.g. KBZPay ဆိုင်, press Enter).',
          done: when(function (c) { var r = listRow(c, 'pay_method', 'KBZ'); return !!r && r.label !== 'KBZPay'; }),
          act: function (c) { c.openTab('lists'); c.setListRow('pay_method', 'KBZ', { label: 'KBZPay ဆိုင်' }); } },
        { target: { tab: 'lists', cell: 'WAVE.Active' }, my: 'WavePay · Active ☐', en: 'Retire WavePay: untick its Active box.',
          done: when(function (c) { var r = listRow(c, 'pay_method', 'WAVE'); return !!r && !r.active; }),
          act: function (c) { c.openTab('lists'); c.setListRow('pay_method', 'WAVE', { active: false }); } },
        { target: { tab: 'lists', cell: 'BANK.Kind' }, my: 'BANK · Kind = bank', en: 'Set a Kind: the BANK row is a bank (it already counts as one by its key; now the cell says so).',
          done: when(function (c) { var r = listRow(c, 'pay_method', 'BANK'); return !!r && r.kind === 'bank'; }),
          act: function (c) { c.openTab('lists'); c.setListRow('pay_method', 'BANK', { kind: 'bank' }); } },
        { target: { tab: 'lists', cell: 'add' }, my: 'AYA Pay · wallet ထည့်', en: 'Add an account below the table: list pay_method, label AYA Pay, Kind wallet, then Add.',
          done: when(function (c) { return c.world.ports.store.listOptions('pay_method').some(function (r) { return r.label === 'AYA Pay'; }); }),
          act: function (c) { c.openTab('lists'); c.addList('pay_method', 'AYA Pay', 'wallet'); } },
        tag('S1-0002', null, 'Now Telegram (the owner sells too): scan S1-0002.'),
        start('S1-0002'),
        cb('S|S1-0002|1', '{k:btn_sell_one} {v:tap}', 'Tap {k:btn_sell_one}: the review card.'),
        cb('SS|S1-0002|o|method', '{k:sale_ask_method} {v:tap}', 'Tap {k:sale_ask_method}: the accounts show the new name and AYA Pay, and no WavePay.'),
        cb('SS|S1-0002|back|method', '{k:btn_back} {v:tap}', 'Back to the review card: tap {k:btn_back} (a sub-screen has no ✖️).'),
        cb('SS|S1-0002|z', '{k:btn_cancel} {v:tap}', 'Leave without selling: tap {k:btn_cancel}. A phone gets the same lists at its next sync.')
      ]).map(function (s, i) { return i >= 4 ? ext(s, { device: 'tg' }) : s; })
    },
    {
      id: 'quick', login: 'sister', device: 'tg',
      title: { my: 'quick ရောင်း ↔ form', en: 'Switch to the quick sale and back' },
      steps: flat([
        { target: { ui: '#flowQuick' }, my: 'sale_flow · quick {v:tap}', en: 'In the header, switch sale_flow to quick.',
          done: when(function (c) { return saleFlow(c.world.ports) === 'quick'; }), act: function (c) { c.click('#flowQuick'); } },
        tag('S1-0002'),
        start('S1-0002'),
        cb('S|S1-0002|1', '{k:btn_sell_one} {v:tap}', 'One tap sells at once (quick): the after-sale card offers the corrections together (credit, buyer, accounts, ➕).'),
        { target: { ui: '#flowForm' }, my: 'sale_flow · form {v:tap}', en: 'Switch back to form: the app opens its forms again and Telegram its review card.',
          done: when(function (c) { return saleFlow(c.world.ports) === 'form'; }), act: function (c) { c.click('#flowForm'); } }
      ])
    },
    {
      // Round 6b (SPEC-round-6b.md 5.7, G1 and G2): the plus chip adds an item category in the same Save; the sample switch.
      id: 'newcat', login: 'sister', device: 'app', need: { blank: 'S1-0008' },
      title: { my: 'ပစ္စည်းအသစ် · အမျိုးအစားအသစ် ➕ · နမူနာ', en: 'A new piece with a new category, as a sample' },
      steps: flat([
        appTag('S1-0008', null, 'Scan a blank tag, S1-0008: the new-piece form opens with the shop\'s categories as chips, the catch-all {l:item_category.other} last.'),
        ff('cat:add', '{k:btn_add_cat} {v:tap}', 'The piece is none of those (a silk blouse): tap the last chip, {k:btn_add_cat}. A name field opens and takes the keyboard.'),
        fset('catname', 'ပိုးအင်္ကျီ', 'ပိုးအင်္ကျီ {v:type}', 'Type the new category\'s name, ပိုးအင်္ကျီ. A name the shop already has is used, not added twice; the word နမူနာ and a name the owner closed are refused (the line under the field says so).'),
        fset('price', 25000, '25,000 {v:type}', 'The price: a new category has no pieces yet, so its chips are the default prices. Tap 25,000 (or tap the box and type 25000).', 'price:25000'),
        ff('sample', '{k:ui_lbl_sample} · {k:ui_off} → {k:ui_on} {v:tap}', 'This piece is a sample, one of the one or two pieces the design department makes of a new design: turn the {k:ui_lbl_sample} switch on ({k:ui_off} → {k:ui_on}). A sample is not the category {l:item_category.other}: a piece of any category can be a sample, and the reports count samples sold in their own column.'),
        ff('save', SAVE_MY, 'Tap {k:ui_w_save}: the piece is registered as a ပိုးအင်္ကျီ sample, and the same Save adds ပိုးအင်္ကျီ to the shop\'s categories. Both reach the Sheet at the next sync; the piece shows the small {k:ui_lbl_sample} badge.',
          { done: when(function (c) {
            var it = c.world.ports.store.getItem('S1-0008'), yes = function (v) { return v === true || /^(true|1|yes)$/i.test(String(v)); };
            return !!it && it.status === CFG.STATUS.ACTIVE && it.category === 'ပိုးအင်္ကျီ' && yes(it.sample)
              && c.world.ports.store.listOptions('item_category').some(function (r) { return r.label === 'ပိုးအင်္ကျီ'; });
          }) }),
        // Done by the tap on the tab (setTab's event), not by a Lists tab left open earlier: the caption is this step's point.
        ext(OWNER_LAPTOP, { target: { tab: 'lists' }, done: function (e, c) { return e.kind === 'ui' && e.name === 'tab' && e.tab === 'lists' && c.device === 'laptop'; },
          my: 'ဆိုင်ရှင် · 💻 · Lists {v:tap}', en: 'The owner\'s laptop: open the Lists tab. The item_category rows are the five built-in categories and the new ပိုးအင်္ကျီ. Here the owner renames a category (Label: new pieces get the new name, pieces registered before keep theirs), unticks Active to close it, sets the chips\' order (Order) and the emoji Telegram shows (Detail). {l:item_category.other} is the catch-all and always comes last.',
          act: function (c) { c.openTab('lists'); } })
      ])
    },
    {
      // Round 6b (SPEC-round-6b.md 5.7, G3): 📦 in Telegram's menu, a loop of tags; START inside the loop gives the count
      // screen, so the two start steps carry their own captions (start()'s shared one is for the item card).
      id: 'tgrestock', login: 'owner', device: 'tg',
      title: { my: 'Telegram · ☰ 📦 ကုန်ရောက် · Tag အများ', en: 'Telegram: restock several tags from the menu' },
      steps: flat([
        menu(),
        cb('M|restock', '{k:btn_restock} {v:tap}', 'A delivery came: in the menu tap {k:btn_restock}. The bot asks for a tag (scan it, or type its number).'),
        tag('S1-0002', null, 'Scan S1-0002 on the shop-1 rack (five in stock).'),
        ext(start('S1-0002'), { my: 'START {v:tap} → {k:ask_restock_qty}', en: 'Press START: inside the restock loop the bot answers with the count screen of S1-0002 (its stock now and the +1 to +20 buttons). Was the scan for a sale after all? {k:btn_restock_sell} on that screen ends the loop.' }),
        cb('RQ|S1-0002|5', '+၅ {v:tap}', 'Five arrived: tap +5 (typing 5 does the same). One RESTOCK row of +5 with its own {k:btn_undo}, and the bot asks for the next tag.' + LOOP_LATE,
          { done: ledgerGrew('RESTOCK', 'S1-0002', function (r) { return Number(r.qty) === 5; }), act: loopCount('S1-0002', 'RQ|S1-0002|5') }),
        tag('S2-0003', null, 'The next tag, from shop 2: scan S2-0003 (the owner restocks either shop; a seller only her own).'),
        ext(start('S2-0003'), { my: 'START {v:tap} → {k:ask_restock_qty}', en: 'Press START: the count screen of S2-0003, still inside the loop. A wrong tag? {k:btn_cancel} skips it and the loop goes on.' }),
        cb('RQ|S2-0003|1', '+၁ {v:tap}', 'One arrived: tap +1. A second RESTOCK row, with its own {k:btn_undo}.' + LOOP_LATE,
          { done: ledgerGrew('RESTOCK', 'S2-0003', function (r) { return Number(r.qty) === 1; }), act: loopCount('S2-0003', 'RQ|S2-0003|1') }),
        cb('RT|done', '{k:btn_restock_done} {v:tap}', 'No more tags: tap {k:btn_restock_done}. The loop also ends by itself three minutes after its last question, and when a one-of-a-kind piece is scanned (a sale, never a restock).')
      ])
    },
    {
      id: 'stranger', login: 'owner', device: 'tg',
      title: { my: 'ဝယ်သူ တစ်ယောက် Tag ကို scan', en: 'A stranger scans a tag' },
      steps: flat([
        ext(tag('S1-0002', '👤 ဝယ်သူ · 🏷 S1-0002 ကို {v:scan}', 'A customer (not staff) scans a tag with her own phone.'), { login: 'customer', device: 'tg' }),
        ext(start('S1-0002'), { login: 'customer', device: 'tg', only: null, en: 'She presses START: the bot answers "{k:staff_only}" and nothing else.' }),
        ext(OWNER_LAPTOP, { target: { tab: 'errors' }, done: when(function (c) { return c.device === 'laptop' && c.tab === 'errors'; }),
          my: 'ဆိုင်ရှင် · 💻 · Errors {v:tap}', en: 'Back to the owner: the Errors tab lists the unknown user (unknown_user).',
          act: function (c) { c.openTab('errors'); } })
      ])
    }
  ];
})();
