/**
 * gas_setup.js — run setupSheet() once from the Apps Script editor.
 * Creates every tab with headers, formulas, defaults and 200 blank tag ids per shop.
 * Safe to re-run: it only adds what is missing (and always rewrites the Dashboard).
 * On an existing sheet it also appends the columns this version added (Ledger Method and
 * Category, Customers Bought..Visits). It never writes into existing Ledger rows: a blank
 * Method on an old row already reads as CASH everywhere (methodOf in core_ledger.js, the
 * Dashboard formulas). backfillMethod() below is an optional one-time migration the
 * maintainer runs on purpose from the editor, never from here.
 * The Lists tab (ensureListsTab): one row per option the buttons offer. Created here, seeded once
 * from the Settings rows of the version before (pay_methods, expense_categories, fabric_presets and
 * the Messages labels) and, last, the five built-in item categories (item_category, round 6b); from then
 * on the tab wins and the family edits it on the laptop.
 * Round 5, on a round-4 sheet (run it right after publishing the server): the Ledger grows to 27 columns with DueDay
 * last (plain text), the Lists tab gets Kind as its ninth column with a dropdown, the Credits header becomes 15 wide
 * (DueDay, Overdue), Settings gets sale_flow and sale_due_presets, Messages the new keys, and the Dashboard's
 * Overdue cell reads the Credits Overdue column. A second run changes nothing.
 * Round 6: sale_flow is form (the app's forms and the Telegram review card) or quick (the one-tap card); a round-5 value
 * steps is rewritten to form, and a round-5 default note to the round-6 one. Revision 3: the ai row (TRUE), its note, a
 * note on each shop's name, brand, address and phone row (one set per CFG.SHOP_IDS) and one conditional-format rule that
 * colours that Shops block wherever its rows are; no row moves and no typed value is touched.
 * Round 6b: the sample toggle's two default texts (🧵 → 🎨) are rewritten where the tab still holds round 3's exact text;
 * the Lists tab's first seed writes item_category's five built-in rows after the three round-4 lists, and the List header
 * note explains them (lists_note_item_category).
 */
function setupSheet() {
  var ss = gasSpreadsheet();
  ss.setSpreadsheetTimeZone('Asia/Yangon');

  var items = ensureTab(ss, 'Items', CFG.ITEM_COLS);
  var ledger = ensureTab(ss, 'Ledger', CFG.LEDGER_COLS);
  ensureTab(ss, 'Staff', CFG.STAFF_COLS);
  var settings = ensureTab(ss, 'Settings', ['Key', 'Value']);
  var messages = ensureTab(ss, 'Messages', ['Key', 'Text']);
  ensureTab(ss, 'Errors', CFG.ERROR_COLS);
  var customers = ensureTab(ss, 'Customers', CFG.CUSTOMER_COLS);
  // Existing sheets: append any header this version added, at the end, so formulas keep their letters.
  ensureColumns(items, CFG.ITEM_COLS);
  ensureColumns(ledger, CFG.LEDGER_COLS);
  ensureColumns(customers, CFG.CUSTOMER_COLS);
  // Credits is a view rewritten whole by refreshViews, but the Dashboard reads its columns by letter: an existing tab
  // gets the round-5 headers (DueDay, Overdue) now, not only at the next credit write.
  var credits = ensureTab(ss, 'Credits', CFG.CREDIT_COLS);
  ensureColumns(credits, CFG.CREDIT_COLS);
  ensureTab(ss, 'Deposits', CFG.DEPOSIT_COLS);
  var imp = ensureTab(ss, 'Import', CFG.IMPORT_COLS);
  var print = ensureTab(ss, 'Print', []);
  var dash = ensureTab(ss, 'Dashboard', []);
  setupTailoringTabs(ss);

  textColumn(ledger, CFG.LEDGER_COLS, 'Day');        // Day stays text, never auto-dated
  textColumn(ledger, CFG.LEDGER_COLS, 'Time');
  textColumn(ledger, CFG.LEDGER_COLS, 'Method');
  textColumn(ledger, CFG.LEDGER_COLS, 'Category');
  textColumn(ledger, CFG.LEDGER_COLS, 'DueDay');     // the promised date of a part-paid sale, text like Day
  textColumn(customers, CFG.CUSTOMER_COLS, 'Phone');  // 09... must keep its leading zero
  items.getRange('A:A').setNumberFormat('@');
  imp.getRange('A:A').setNumberFormat('@');

  // The rows of each shop come from CFG.SHOP_IDS (amendment F10b: an id added there gets its name, voucher number and
  // letterhead rows here too, in the same places as S1's and S2's; like every default, only when the key is missing).
  var shopRows = function (rowsOf) { var out = []; CFG.SHOP_IDS.forEach(function (id) { out = out.concat(rowsOf(id)); }); return out; };
  var defaults = [].concat(shopRows(function (id) { return [['shop_name_' + id, CFG.SHOP_NAMES[id] || id]]; }), [
    ['low_stock_threshold', 2], ['summary_hour', 21],
    ['price_presets', '10000,15000,20000,25000,30000'], ['deposit_presets', '50000,100000,200000,300000'],
    ['notebook_import', 'FALSE'], ['text_cards', 'FALSE'], ['group_chat_id', ''],
    // Payment methods (CASH first; the others become the 🏦 buttons). Keys are short ASCII codes of at most
    // CFG.METHOD_KEY_MAX_BYTES (12) bytes: they travel inside the 64-byte callback data (PM|<group id>|<KEY>);
    // a longer key is left out of the buttons and logged. The Burmese label goes in Messages as method_<KEY>.
    // Then expense categories as key:label and the expense amount presets.
    // pay_methods, expense_categories and fabric_presets are what the Lists tab is seeded from (ensureListsTab
    // below) and what the core reads while that tab has no rows; once it has rows, the tab wins.
    ['pay_methods', CFG.DEFAULT_PAY_METHODS.join(',')],
    ['expense_categories', CFG.EXPENSE_CATEGORIES.map(function (c) { return c[0] + ':' + c[1]; }).join(',')],
    ['expense_presets', CFG.EXPENSE_PRESETS.join(',')],
    ['pc_pin', '']
    // Custom tailoring: the NEXT voucher number of each shop's paper book (type the number on the next blank page),
    // fabric and due-date buttons, the reminder window of the 21:00 summary, and each shop's letterhead for the
    // voucher and the measurement sheet (brand, address, phones).
  ], shopRows(function (id) { return [['order_next_no_' + id, 1]]; }), [
    ['fabric_presets', CFG.FABRIC_PRESETS.join(',')], ['due_presets', CFG.DUE_PRESETS.join(',')],
    ['order_remind_days', CFG.ORDER_REMIND_DAYS]
  ], shopRows(function (id) { return [['shop_brand_' + id, ''], ['shop_address_' + id, ''], ['shop_phone_' + id, '']]; }), [
    // The sale (round 6): form = the app's forms and the Telegram review card, one write at Save; quick = the one-tap
    // card. Then the day buttons of "when is the rest paid" (days from today).
    ['sale_flow', CFG.SALE_FLOW.FORM], ['sale_due_presets', CFG.SALE_DUE_PRESETS.join(',')],
    // The owner's one AI switch (round 6, revision 3): TRUE keeps today's behaviour; the app's Settings can turn it off.
    ['ai', 'TRUE']
  ]);
  var have = gasTable('Settings').map(function (r) { return String(r.Key); });
  defaults.forEach(function (d) { if (have.indexOf(d[0]) < 0) settings.appendRow(d); });
  gasInvalidate();   // writeDashboard below reads expense_categories through the store
  // A round-5 book says steps (one question per screen): the word its note no longer explains becomes form.
  gasTable('Settings').forEach(function (r) {
    if (String(r.Key) === 'sale_flow' && String(r.Value === undefined || r.Value === null ? '' : r.Value).trim().toLowerCase() === 'steps') {
      settings.getRange(r._row, 2).setValue(CFG.SALE_FLOW.FORM);
    }
  });
  gasInvalidate();

  var haveMsg = gasTable('Messages').map(function (r) { return String(r.Key); });
  var missing = Object.keys(MSG).filter(function (k) { return haveMsg.indexOf(k) < 0; }).map(function (k) { return [k, MSG[k]]; });
  if (missing.length) messages.getRange(messages.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
  // Nicety, in its own try/catch: the Key cell of the sale_flow row explains its two values (Messages settings_note_sale_flow).
  try {
    gasInvalidate();
    // Round 5's default text of that note (exactly) becomes round 6's; a text the family typed is kept.
    gasTable('Messages').forEach(function (r) {
      if (String(r.Key) === 'settings_note_sale_flow' && String(r.Text) === 'steps = တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက် ရောင်း') {
        messages.getRange(r._row, 2).setValue(MSG.settings_note_sale_flow);
      }
    });
    gasInvalidate();
    var flowRow = 0;
    gasTable('Settings').forEach(function (r) { if (!flowRow && String(r.Key) === 'sale_flow') flowRow = r._row; });
    if (flowRow) settings.getRange(flowRow, 1).setNote(t({ store: gasStore }, 'settings_note_sale_flow'));
  } catch (err) {
    try { gasStore.logError('setup', 'Settings sale_flow note: ' + (err && err.message ? err.message : err), '', ''); } catch (ignore) {}
  }
  // Round 6b, in its own try/catch: the sample toggle's two texts of round 3 (exactly, with 🧵) become the 🎨 ones, because
  // t() reads this tab first; a text the family typed is kept, and a second run finds nothing to rewrite.
  try {
    gasInvalidate();
    var oldSample = { btn_sample_on: '🧵 နမူနာ: ဟုတ်', btn_sample_off: '🧵 နမူနာ: မဟုတ်' };
    gasTable('Messages').forEach(function (r) {
      var key = String(r.Key);
      if (Object.prototype.hasOwnProperty.call(oldSample, key) && String(r.Text) === oldSample[key]) messages.getRange(r._row, 2).setValue(MSG[key]);
    });
    gasInvalidate();
  } catch (err) {
    try { gasStore.logError('setup', 'Messages sample texts: ' + (err && err.message ? err.message : err), '', ''); } catch (ignore) {}
  }
  // Niceties of revision 3, in their own try/catch: the ai row's note, a note on each shop's rows (one set per id of
  // CFG.SHOP_IDS: name, brand, address, phone) and ONE conditional-format rule that colours those rows (the Shops block).
  try {
    gasInvalidate();
    var ports = { store: gasStore }, shopKey = {}, fields = ['name', 'brand', 'address', 'phone'];
    CFG.SHOP_IDS.forEach(function (id, i) {
      fields.forEach(function (f) { shopKey['shop_' + f + '_' + id] = t(ports, 'settings_note_shop_' + f, { n: myDigits(i + 1) }); });
    });
    gasTable('Settings').forEach(function (r) {
      var key = String(r.Key);
      if (key === 'ai') settings.getRange(r._row, 1).setNote(t(ports, 'settings_note_ai'));
      else if (Object.prototype.hasOwnProperty.call(shopKey, key)) settings.getRange(r._row, 1).setNote(shopKey[key]);
    });
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=REGEXMATCH($A2,"^shop_(' + fields.join('|') + ')_(' + CFG.SHOP_IDS.join('|') + ')$")')
      .setBackground('#e3e7f7').setRanges([settings.getRange(2, 1, Math.max(1, settings.getMaxRows() - 1), 2)]).build();
    settings.setConditionalFormatRules([rule]);
  } catch (err) {
    try { gasStore.logError('setup', 'Settings Shops block: ' + (err && err.message ? err.message : err), '', ''); } catch (ignore) {}
  }

  if (items.getLastRow() < 2) {
    generateBlankTags('S1', 1, 200);
    generateBlankTags('S2', 1, 200);
  }

  print.hideSheet();
  ensureListsTab(ss);   // before the Dashboard: its category and account blocks are built from the lists
  writeDashboard(dash);
  protectTab(items);
  protectTab(ledger);
  gasInvalidate();
  Logger.log('Sheet ready. Next: add your Telegram id to Staff, set Script Properties, deploy, registerWebhook(). ' +
    'Then run rebuildViews() to fill the Customers summary columns, and backfillSync() once (gas_sync.js) on a sheet that has rows from before the sync version.');
}

/**
 * The custom-tailoring tabs (core_orders.js). Orders and OrderItems: master data with text day/time columns.
 * MeasureFields: seeded once from CFG.MEASURE_FIELDS (the unified paper form); afterwards the family renames,
 * reorders or sets Active FALSE there, and never changes a Key that was used. Measurements: the fixed columns
 * plus one column per MeasureFields key, every cell plain text ('@') so '36/30/20' or '7/3/20' never become
 * dates and '17.5' keeps its form. Designs: the catalogue of design codes (TSL-0018) with base price and days.
 */
function setupTailoringTabs(ss) {
  var orders = ensureTab(ss, 'Orders', CFG.ORDER_COLS);
  ensureColumns(orders, CFG.ORDER_COLS);
  ['OrderID', 'OrderedDay', 'DueDay', 'DeliveredDay', 'StatusAt', 'CreatedAt', 'VoucherSentAt'].forEach(function (c) { textColumn(orders, CFG.ORDER_COLS, c); });
  var lines = ensureTab(ss, 'OrderItems', CFG.ORDER_ITEM_COLS);
  ensureColumns(lines, CFG.ORDER_ITEM_COLS);
  textColumn(lines, CFG.ORDER_ITEM_COLS, 'OrderID');
  textColumn(lines, CFG.ORDER_ITEM_COLS, 'DesignCode');
  var designs = ensureTab(ss, 'Designs', CFG.DESIGN_COLS);
  ensureColumns(designs, CFG.DESIGN_COLS);
  textColumn(designs, CFG.DESIGN_COLS, 'DesignCode');
  var fields = ensureTab(ss, 'MeasureFields', CFG.MEAS_FIELD_COLS);
  ensureColumns(fields, CFG.MEAS_FIELD_COLS);
  if (fields.getLastRow() < 2) {
    fields.getRange(2, 1, CFG.MEASURE_FIELDS.length, CFG.MEAS_FIELD_COLS.length).setValues(CFG.MEASURE_FIELDS.map(function (f, i) {
      return [f[0], f[1], f[2], f[3], f[4], f[5], i + 1, true];
    }));
  }
  gasInvalidate();
  var keys = gasTable('MeasureFields').map(function (r) { return String(r.Key || ''); }).filter(function (k) { return k !== ''; });
  var measCols = CFG.MEAS_FIXED_COLS.concat(keys);
  // A new tab has 26 columns; 9 fixed + 32 fields do not fit, and writing past the grid fails. On a tab set up before
  // EntryID, ensureColumns appends it after the field keys (every reader goes by the header).
  var measSheet = ss.getSheetByName('Measurements') || ss.insertSheet('Measurements');
  var haveCols = measSheet.getLastRow() ? gasHeader(measSheet).filter(function (h) { return h !== ''; }) : [];
  gasEnsureWidth(measSheet, haveCols.length + measCols.filter(function (c) { return haveCols.indexOf(c) < 0; }).length);
  var meas = ensureTab(ss, 'Measurements', measCols);
  ensureColumns(meas, measCols);
  meas.getRange(1, 1, meas.getMaxRows(), Math.max(meas.getLastColumn(), measCols.length)).setNumberFormat('@');
  gasInvalidate();
}

/**
 * The Lists tab: one row per option the buttons offer (List, Key, Label, Active, Order, Shop, Detail, Note, Kind) for
 * the three lists pay_method (bank and wallet accounts), expense_category and fabric. Idempotent. setupSheet()
 * runs it, and so does gasStore.addListOption on a sheet that has no Lists tab yet. Kind (round 5) is wallet or bank
 * on a pay_method row; blank is a wallet (the legacy BANK key is a bank by name). In this order:
 *  1. the tab and its header (a round-4 tab gets Kind as its ninth column, at the right-hand end);
 *  2. Key, Label, Detail and Note become plain text BEFORE any value is written: an account number such as
 *     09777123456 must keep its leading zero (it is what receipts print). This is part of the contract and
 *     deliberately not inside a try/catch: a failure stops here with its error;
 *  3. a tab without rows is seeded from the lists of the version before (legacyListRows: Settings pay_methods
 *     with the Messages labels, expense_categories, fabric_presets), every row active, Order 1..n, Shop blank;
 *  4. a row that has a Key and a blank Active gets TRUE, so the box shows what the code does (a blank Active
 *     counts as active); a cell that holds FALSE is never changed;
 *  5. niceties, each in its own try/catch (a failure is logged to Errors and setup goes on): tick boxes on Active
 *     through a data-validation rule, dropdowns on List, Shop and Kind from row 2, the Burmese notes on the header
 *     cells (Messages lists_note_<column>), and two red highlights (a key used twice in one list, a row without
 *     a label), set as the sheet's only conditional-format rules so that a second run adds none.
 *     NEVER Range.insertCheckboxes(): it sets every cell of its range to FALSE and would switch every option off;
 *  6. the per-execution table cache is dropped, so writeDashboard() reads the seeded rows.
 * Under the script lock (gasLocked is re-entrant), so a ➕ tapped in the bot while setupSheet() runs cannot seed
 * the tab a second time.
 */
function ensureListsTab(ss) {
  return gasLocked(function () {
    var ports = gasListsPorts();
    var sh = ensureTab(ss, 'Lists', CFG.LIST_COLS);
    ensureColumns(sh, CFG.LIST_COLS);
    var header = gasHeader(sh);
    function col(name) {
      var c = header.indexOf(name) + 1;
      if (c < 1) throw new Error('The Lists tab has no "' + name + '" column.');
      return c;
    }
    var maxRows = sh.getMaxRows();
    GAS_LIST_TEXT_COLS.forEach(function (name) { sh.getRange(1, col(name), maxRows, 1).setNumberFormat('@'); });
    gasInvalidate();   // from here on every table is read again: the caller's Lists, Settings and Messages may be older
    if (gasListsLastRow() < 2) {
      var seed = [];
      CFG.LIST_NAMES.forEach(function (name) {
        legacyListRows(ports, name).forEach(function (r, i) {
          seed.push({ list: name, key: r.key, label: r.label, active: true, order: i + 1, shop: '', detail: r.detail, note: r.note });
        });
      });
      gasListsWriteRows(sh, header, 2, seed);
      SpreadsheetApp.flush();
      gasInvalidate();
    }
    gasListsFillActive(sh);

    function nicety(what, fn) {
      try { fn(); } catch (err) {
        try { gasStore.logError('lists_setup', 'Lists tab, ' + what + ': ' + (err && err.message ? err.message : err), '', ''); } catch (ignore) {}
      }
    }
    function below(name) { return sh.getRange(2, col(name), sh.getMaxRows() - 1, 1); }   // from row 2: never the header
    nicety('Active tick boxes', function () {
      below('Active').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    });
    nicety('List dropdown', function () {
      below('List').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CFG.LIST_NAMES, true).setAllowInvalid(false).build());
    });
    nicety('Shop dropdown', function () {   // a blank Shop (both shops) stays allowed: a rule never rejects an empty cell
      below('Shop').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CFG.SHOP_IDS, true).setAllowInvalid(false).build());
    });
    nicety('Kind dropdown', function () {   // a blank Kind stays allowed: a wallet, or a bank by name for the legacy BANK key
      below('Kind').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CFG.LIST_KINDS, true).setAllowInvalid(false).build());
    });
    nicety('header notes', function () {
      CFG.LIST_COLS.forEach(function (name) {
        // Round 6b: the List cell also explains the item_category rows (rename = new pieces only, the catch-all last, ➕).
        var note = t(ports, 'lists_note_' + name.toLowerCase());
        if (name === 'List') note += '\n' + t(ports, 'lists_note_item_category');
        sh.getRange(1, col(name)).setNote(note);
      });
    });
    nicety('highlights', function () {
      var L = colLetter(header, 'List'), K = colLetter(header, 'Key'), B = colLetter(header, 'Label'), red = '#f4c7c3';
      var dupRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + K + '2<>"",COUNTIFS($' + L + '$2:$' + L + ',$' + L + '2,$' + K + '$2:$' + K + ',$' + K + '2)>1)')
        .setBackground(red).setRanges([below('Key')]).build();
      var blankLabelRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + K + '2<>"",$' + B + '2="")')
        .setBackground(red).setRanges([below('Label')]).build();
      sh.setConditionalFormatRules([dupRule, blankLabelRule]);
    });
    gasInvalidate();
    return sh;
  }, 15000);
}

/**
 * The ports the Lists readers of this file use (ensureListsTab's seed and header notes, writeDashboard): the store
 * and the Script cache of buildPorts(). The cache matters for the warnings about a Lists row (a key holding '|', a
 * pay_method key that is too long): listWarnOnce (core_ledger.js) logs each once per 6 hours through it. Without it
 * every hand edit of the Lists tab (onEdit), every Dashboard rewrite and every setupSheet() run would add the same
 * Errors row again.
 */
function gasListsPorts() {
  return { store: gasStore, cache: buildPorts().cache };
}

/**
 * Write TRUE into the Active cell of every Lists row that has a Key and a blank Active (a row the family typed
 * by hand: a blank Active already counts as active, and now its box shows it). Only blank cells are written,
 * one by one: a cell that holds FALSE (an option switched off) is never touched. Returns how many were filled.
 */
function gasListsFillActive(sh) {
  var header = gasHeader(sh), keyCol = header.indexOf('Key') + 1, activeCol = header.indexOf('Active') + 1, last = sh.getLastRow();
  if (keyCol < 1 || activeCol < 1 || last < 2) return 0;
  var keys = sh.getRange(2, keyCol, last - 1, 1).getValues(), active = sh.getRange(2, activeCol, last - 1, 1).getValues(), filled = 0;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i][0], a = active[i][0];
    if (k === null || k === undefined || String(k).trim() === '') continue;
    if (a === '' || a === null || a === undefined) {
      sh.getRange(i + 2, activeCol).setValue(true);
      filled++;
    }
  }
  if (filled) {
    SpreadsheetApp.flush();
    gasInvalidate();
  }
  return filled;
}

/** The tab, created when missing; an empty tab gets the header, the grid grown first (a new tab has 26 columns). */
function ensureTab(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (header.length && sh.getLastRow() === 0) {
    gasEnsureWidth(sh, header.length);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Add the headers of cols that row 1 does not have yet. Never moves or renames an existing one. A missing name whose
 * own cell (its place in cols) is a blank inside the header row goes back into that cell (a header cell somebody
 * cleared, with the columns after it still in place); every other missing name is appended after the last non-empty
 * header cell, in cols order, so formulas keep their letters. The grid grows first (a tab has 26 columns, and a tab
 * whose spare columns were deleted has fewer; writing past the grid fails).
 */
function ensureColumns(sh, cols) {
  var last = Math.max(1, sh.getLastColumn());
  var have = sh.getRange(1, 1, 1, last).getValues()[0].map(function (v) { return String(v); });
  var missing = cols.filter(function (c) { return have.indexOf(c) < 0; });
  if (!missing.length) return;
  var end = 0;   // the column of the last non-empty header cell
  have.forEach(function (v, i) { if (v !== '') end = i + 1; });
  var at = [];   // [column, name]
  missing.forEach(function (name) {
    var own = cols.indexOf(name);
    if (own < end && have[own] === '') at.push([own + 1, name]);
    else at.push([++end, name]);
  });
  at.sort(function (a, b) { return a[0] - b[0]; });
  gasEnsureWidth(sh, at[at.length - 1][0]);
  for (var i = 0; i < at.length;) {   // one block per run of neighbouring cells (the usual case: one block at the end)
    var j = i;
    while (j + 1 < at.length && at[j + 1][0] === at[j][0] + 1) j++;
    sh.getRange(1, at[i][0], 1, j - i + 1).setValues([at.slice(i, j + 1).map(function (p) { return p[1]; })]).setFontWeight('bold');
    i = j + 1;
  }
  gasInvalidate();
}

/** Whole column as plain text so Sheets never turns "2026-09-06", "09777123456" or "CASH" into something else. */
function textColumn(sh, cols, name) {
  sh.getRange(1, cols.indexOf(name) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
}

/**
 * OPTIONAL one-time migration, run by hand from the editor, never called by setupSheet() or any
 * request path (plan section 6 rule 8: code never edits Ledger rows). Rows where money moved
 * (Cash <> 0) but Method is blank get Method = CASH, which is exactly what every reader already
 * assumes for them (methodOf in core_ledger.js; the Dashboard's bank column subtracts blank
 * Methods), so nothing needs this to be right; it only makes the Method column complete to the
 * eye. No business fact changes. Safe to re-run: it only touches blank cells. Returns the number
 * of rows filled.
 */
function backfillMethod(ledger) {
  ledger = ledger || gasSheet('Ledger');
  var last = ledger.getLastRow();
  if (last < 2) return 0;
  var cashCol = CFG.LEDGER_COLS.indexOf('Cash') + 1, methodCol = CFG.LEDGER_COLS.indexOf('Method') + 1;
  var cash = ledger.getRange(2, cashCol, last - 1, 1).getValues();
  var methodRange = ledger.getRange(2, methodCol, last - 1, 1);
  var methods = methodRange.getValues(), changed = 0;
  for (var i = 0; i < methods.length; i++) {
    if (Number(cash[i][0]) && String(methods[i][0] === null || methods[i][0] === undefined ? '' : methods[i][0]) === '') {
      methods[i][0] = CFG.METHOD.CASH;
      changed++;
    }
  }
  if (changed) {
    methodRange.setValues(methods);
    SpreadsheetApp.flush();
    gasInvalidate();
  }
  return changed;
}

function protectTab(sh) {
  var existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (existing.length) return;
  sh.protect().setDescription('Edited by the bot. Corrections go in as new rows.').setWarningOnly(true);
}

/** Pre-generate tag ids so blank QR tags can be printed before items exist. */
function generateBlankTags(shop, from, to) {
  var sh = gasSheet('Items');
  var start = sh.getLastRow() + 1, values = [], formulas = [];
  var statusCol = colLetter(CFG.ITEM_COLS, 'Status'), stockCol = colLetter(CFG.ITEM_COLS, 'Stock');
  var nameCol = colLetter(CFG.ITEM_COLS, 'Name'), typeCol = colLetter(CFG.ITEM_COLS, 'Type');
  var LItem = 'Ledger!$' + colLetter(CFG.LEDGER_COLS, 'ItemID') + ':$' + colLetter(CFG.LEDGER_COLS, 'ItemID');
  var LQty = 'Ledger!$' + colLetter(CFG.LEDGER_COLS, 'Qty') + ':$' + colLetter(CFG.LEDGER_COLS, 'Qty');
  for (var n = from; n <= to; n++) {
    var id = shop + '-' + ('0000' + n).slice(-4);
    var r = start + values.length;
    var row = CFG.ITEM_COLS.map(function () { return ''; });
    row[0] = id;
    row[1] = shop;
    values.push(row);
    formulas.push([
      '=IF(' + nameCol + r + '="","BLANK",IF(AND(' + typeCol + r + '="UNIQUE",' + stockCol + r + '<=0),"SOLD","ACTIVE"))',
      '=SUMIF(' + LItem + ',A' + r + ',' + LQty + ')'
    ]);
  }
  sh.getRange(start, 1, values.length, CFG.ITEM_COLS.length).setValues(values);
  sh.getRange(start, CFG.ITEM_COLS.indexOf('Status') + 1, formulas.length, 2).setFormulas(formulas);
  gasInvalidate();
}

/**
 * Owner view in the Sheet. Everything here is a formula over Ledger, Credits and Deposits.
 * Cash in is split into drawer (Method CASH) and bank (any other Method): drawer + bank = cash in.
 * A blank Method (rows older than the column) reads as CASH in the code, and the bank column
 * subtracts blanks, so a legacy row is never counted twice without any cell being rewritten.
 * A block "Expenses by category" follows the shop blocks: one row per expense_category option, a
 * retired one included (it may still have expenses this month), plus "other". Then "Money by account":
 * one row per bank or wallet account (every pay_method option except CASH, retired ones included) with
 * this month's money in, out and net over both shops. Both blocks are built from the lists at the time
 * of writing, so the Dashboard is rewritten when a list changes: by setupSheet(), by onEdit() after a
 * hand edit of the Lists tab, and by gasDashboardRefresh() after the bot added an option (gas_main.js).
 * Every rewrite can be a row longer than the last one, and the family may have deleted the empty rows at the
 * bottom of the tab, so the rows are built first, the grid is grown to fit them, and only then is the tab cleared
 * and written: a failure on the way never leaves the Dashboard blank. The account and category names in column A
 * come from the Lists tab, where a seller's ➕ can put any text: each is written with a leading apostrophe, so a
 * name that starts with =, + or - stays text instead of becoming a broken formula. (Column A is not made '@':
 * the low-stock formula lives there.)
 */
function writeDashboard(sh) {
  var L = function (n) { var c = colLetter(CFG.LEDGER_COLS, n); return 'Ledger!$' + c + ':$' + c; };
  var L2 = function (n) { var c = colLetter(CFG.LEDGER_COLS, n); return 'Ledger!$' + c + '$2:$' + c; };
  var CR = function (n) { var c = colLetter(CFG.CREDIT_COLS, n); return 'Credits!$' + c + ':$' + c; };
  var DP = function (n) { var c = colLetter(CFG.DEPOSIT_COLS, n); return 'Deposits!$' + c + ':$' + c; };
  function sumType(col, shop, dayRef, type) {
    return 'SUMIFS(' + L(col) + ',' + L('Day') + ',' + dayRef + ',' + L('Shop') + ',"' + shop + '",' + L('Type') + ',"' + type + '")';
  }
  function rev(shop, dayRef) { return '=' + sumType('Amount', shop, dayRef, 'SALE') + '+' + sumType('Amount', shop, dayRef, 'RETURN'); }
  function pieces(shop, dayRef) { return '=-(' + sumType('Qty', shop, dayRef, 'SALE') + '+' + sumType('Qty', shop, dayRef, 'RETURN') + ')'; }
  function cashIn(shop, dayRef, extra) {
    // Positive cash on normal rows, minus the negative cash of undo mirrors (so corrections do not inflate the gross).
    var base = L('Cash') + ',' + L('Day') + ',' + dayRef + ',' + L('Shop') + ',"' + shop + '"' + (extra || '');
    return 'SUMIFS(' + base + ',' + L('Cash') + ',">0",' + L('ReversesTxID') + ',"=")' +
           '+SUMIFS(' + base + ',' + L('Cash') + ',"<0",' + L('ReversesTxID') + ',"<>")';
  }
  function cashDrawer(shop, dayRef) { return '=' + cashIn(shop, dayRef, ',' + L('Method') + ',"CASH"'); }
  function cashBank(shop, dayRef) {
    return '=' + cashIn(shop, dayRef, ',' + L('Method') + ',"<>CASH"') + '-(' + cashIn(shop, dayRef, ',' + L('Method') + ',"="') + ')';
  }
  function expenses(shop, dayRef) { return '=-' + sumType('Amount', shop, dayRef, 'EXPENSE'); }
  function cogs(shop, prefixRef) {
    return '=SUMPRODUCT((LEFT(' + L2('Day') + ',LEN(' + prefixRef + '))=' + prefixRef + ')*(' + L2('Shop') + '="' + shop + '")' +
           '*(' + L2('Type') + '="SALE")*(-' + L2('Qty') + ')*IF(ISNUMBER(' + L2('CostAtSale') + '),' + L2('CostAtSale') + ',0))';
  }
  function owed(shop) { return '=SUMIF(' + CR('Shop') + ',"' + shop + '",' + CR('Owed') + ')'; }
  var H = ['', 'Revenue', 'Pieces', 'Cash in', 'Cash in (drawer)', 'Cash in (bank)', 'Expenses', 'COGS', 'Gross profit', 'Still owed'];
  var W = H.length;
  function blank() { return H.map(function () { return ''; }); }
  function pad(row) { while (row.length < W) row.push(''); return row; }
  var boldRows = [], numberRows = [];
  function block(label, dayRef, prefixRef, r0) {
    var rows = [[label].concat(H.slice(1))];
    boldRows.push(r0);
    CFG.SHOP_IDS.forEach(function (shop, i) {
      var r = r0 + 1 + i;
      numberRows.push(r);
      // Gross profit = Revenue (B) - Expenses (G) - COGS (H)
      rows.push([shop, rev(shop, dayRef), pieces(shop, dayRef), '=' + cashIn(shop, dayRef), cashDrawer(shop, dayRef), cashBank(shop, dayRef),
                 expenses(shop, dayRef), cogs(shop, prefixRef), '=B' + r + '-G' + r + '-H' + r, owed(shop)]);
    });
    return rows;
  }
  var rows = [
    pad(['POS dashboard']),
    pad(['Today', '=TEXT(TODAY(),"yyyy-mm-dd")', 'This month', '=TEXT(TODAY(),"yyyy-mm")']),
    blank()
  ];
  rows = rows.concat(block('TODAY', '$B$2', '$B$2', rows.length + 1));
  rows.push(blank());
  rows = rows.concat(block('THIS MONTH', '$D$2&"*"', '$D$2', rows.length + 1));
  rows.push(blank());
  numberRows.push(rows.length + 1);
  // Overdue: the Credits tab's own Overdue column (past the promised DueDay, or OVERDUE_DAYS old when undated; creditOverdue).
  rows.push(pad(['Deposits held', '=SUM(' + DP('Held') + ')', 'Owed, all', '=SUM(' + CR('Owed') + ')', 'Overdue',
             '=SUMIF(' + CR('Overdue') + ',TRUE,' + CR('Owed') + ')']));
  rows.push(blank());
  // Expenses by category, this month. One row per expense_category option of the Lists tab (on a sheet without
  // Lists rows: Settings expense_categories, as before), a retired option included because it may still have
  // expenses this month, plus "other"; blank Category (legacy rows) counts as "other".
  var lists = gasListsPorts();
  var cats = listOptions(lists, 'expense_category', null, true).map(function (r) { return [r.key, r.label]; });
  if (!cats.some(function (c) { return c[0] === 'other'; })) cats.push(['other', t(lists, 'cat_other')]);
  boldRows.push(rows.length + 1);
  rows.push(pad(['Expenses by category (this month)', 'Amount']));
  cats.forEach(function (c) {
    var f = 'SUMIFS(' + L('Amount') + ',' + L('Day') + ',$D$2&"*",' + L('Type') + ',"EXPENSE",' + L('Category') + ',"' + String(c[0]).replace(/"/g, '""') + '")';
    if (c[0] === 'other') f += '+SUMIFS(' + L('Amount') + ',' + L('Day') + ',$D$2&"*",' + L('Type') + ',"EXPENSE",' + L('Category') + ',"=")';
    numberRows.push(rows.length + 1);
    rows.push(pad(["'" + c[1] + ' (' + c[0] + ')', '=-(' + f + ')']));
  });
  rows.push(blank());
  // Money by account, this month, all shops: addMethodCash (core_ledger.js) as formulas. In = positive cash on
  // normal rows plus the negative cash of mirrors (a mirror reduces the bucket its original filled); Out the same
  // with the signs swapped. No Shop criterion, and no blank-Method term: a blank Method is CASH, which has no row here.
  function mBase(KEY) { return L('Cash') + ',' + L('Day') + ',$D$2&"*",' + L('Method') + ',"' + String(KEY).replace(/"/g, '""') + '"'; }
  function mIn(KEY) { var b = mBase(KEY); return 'SUMIFS(' + b + ',' + L('Cash') + ',">0",' + L('ReversesTxID') + ',"=")+SUMIFS(' + b + ',' + L('Cash') + ',"<0",' + L('ReversesTxID') + ',"<>")'; }
  function mOut(KEY) { var b = mBase(KEY); return '-(SUMIFS(' + b + ',' + L('Cash') + ',"<0",' + L('ReversesTxID') + ',"=")+SUMIFS(' + b + ',' + L('Cash') + ',">0",' + L('ReversesTxID') + ',"<>"))'; }
  boldRows.push(rows.length + 1);
  rows.push(pad(['Money by account (this month)', 'In', 'Out', 'Net']));
  listOptions(lists, 'pay_method', null, true).forEach(function (a) {
    if (a.key === CFG.METHOD.CASH) return;
    var r = rows.length + 1;
    numberRows.push(r);
    rows.push(pad(["'" + a.label + ' (' + a.key + ')', '=' + mIn(a.key), '=' + mOut(a.key), '=B' + r + '-C' + r]));
  });
  rows.push(blank());
  rows.push(pad(['Low stock (SKU items at or below the threshold)']));
  rows.push(pad(['=IFERROR(JOIN(", ",FILTER(Items!$C:$C&" ("&Items!$' + colLetter(CFG.ITEM_COLS, 'Stock') + ':$' + colLetter(CFG.ITEM_COLS, 'Stock') +
             '&")",Items!$' + colLetter(CFG.ITEM_COLS, 'Status') + ':$' + colLetter(CFG.ITEM_COLS, 'Status') + '="ACTIVE",Items!$E:$E="SKU",Items!$' +
             colLetter(CFG.ITEM_COLS, 'Stock') + ':$' + colLetter(CFG.ITEM_COLS, 'Stock') + '<=VLOOKUP("low_stock_threshold",Settings!$A:$B,2,FALSE))),"none")']));
  rows.push(blank());
  rows.push(pad(['Active items', '=COUNTIF(Items!$' + colLetter(CFG.ITEM_COLS, 'Status') + ':$' + colLetter(CFG.ITEM_COLS, 'Status') + ',"ACTIVE")',
             'Sold unique pieces', '=COUNTIF(Items!$' + colLetter(CFG.ITEM_COLS, 'Status') + ':$' + colLetter(CFG.ITEM_COLS, 'Status') + ',"SOLD")',
             'Blank tags left', '=COUNTIF(Items!$' + colLetter(CFG.ITEM_COLS, 'Status') + ':$' + colLetter(CFG.ITEM_COLS, 'Status') + ',"BLANK")']));
  gasEnsureRows(sh, rows.length);
  gasEnsureWidth(sh, W);
  sh.clear();
  sh.getRange(1, 1, rows.length, W).setValues(rows);
  sh.getRange('A1').setFontWeight('bold').setFontSize(14);
  boldRows.forEach(function (r) { sh.getRange(r, 1, 1, W).setFontWeight('bold'); });
  numberRows.forEach(function (r) { sh.getRange(r, 2, 1, W - 1).setNumberFormat('#,##0'); });
  sh.setColumnWidth(1, 220);
}
