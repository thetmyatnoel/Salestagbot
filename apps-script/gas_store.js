/**
 * gas_store.js — Google Sheets implementation of ports.store.
 * Reads are cached per execution; every write invalidates the cache and flushes.
 * Only Items rows and Customers master data (A:E, e.g. the phone) are ever updated in place
 * (registering a blank tag, moving a tag between shops, attaching a photo, setting a price,
 * adding a phone); every such change bumps Rev/UpdatedAt so phones pull it (gasStampRev).
 * Ledger rows are append-only: a Telegram-route row gets its Seq, ReceivedAt and DeviceID
 * ("TG") in appendLedger itself, so no code path ever has to come back and fill a cell.
 * Credits and Deposits are views the script rewrites (refreshViews); on Customers only the
 * summary columns F:K are a view, written by row and never cleared.
 * Custom tailoring (core_orders.js): Orders and OrderItems are master data updated in place like Items
 * (status, dates, the tag of a line; a line removed while the order is being written is deleted);
 * Measurements rows are only ever appended, every value written as text into '@' cells so '36/30/20'
 * or '7/3/20' never become dates; MeasureFields and Designs are read as the family edits them. Reading a
 * tailoring tab that setupSheet() has not created yet returns nothing instead of failing, so the 21:00
 * summary keeps working on a sheet that was not set up again.
 * Option lists (core_ledger.js listRows): the Lists tab holds one row per option the buttons offer (bank
 * accounts, expense categories, fabrics). The family edits it on the laptop; the bot only ever appends a
 * row (➕) or fills a blank Label or an account's Detail (listUpsert decides, addListOption persists).
 * Key, Label, Detail and Note are plain-text cells so an account number such as 09777123456 keeps its
 * zero. A sheet without the tab reads as "no lists" and the core falls back to the Settings rows.
 * The script lock: every method here that needs it goes through gasLocked() (gas_main.js), the one
 * re-entrant holder, because the same methods also run inside a phone's push batch, which holds it.
 * Round 6, revision 3: setSetting writes one Settings value as plain text (the owner's Shops screen and AI switch,
 * through the phones' setting entry), so 09123456789 keeps its zero and TRUE stays text. A Measurements row may carry
 * the session's drawing (Sketch, a column appended on a tab set up before it, only for a session that has one); its
 * PhotoURL is the one cell written after the row was added (setMeasurementPhoto, the drawing's picture from the phone).
 */
var GAS_TABLES = {};
var GAS_LEDGER_MEMO = null;
var GAS_LISTS_MEMO = null;   // the Lists tab's rows by list name (gasListRows); null = not read in this execution
var GAS_LEDGER_WIDTH_OK = false;   // gasLedgerWidth ran in this execution (the grid only ever grows)

function gasSheet(name) {
  var sh = gasSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setupSheet() first.');
  return sh;
}

/** Whole tab as objects keyed by header. Skips fully empty rows. */
function gasTable(name) {
  if (GAS_TABLES[name]) return GAS_TABLES[name];
  var values = gasSheet(name).getDataRange().getValues();
  var header = values[0] || [], rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 }, empty = true;
    for (var c = 0; c < header.length; c++) {
      var v = values[r][c];
      o[header[c]] = v;
      if (v !== '' && v !== null && v !== undefined) empty = false;
    }
    if (!empty) rows.push(o);
  }
  GAS_TABLES[name] = rows;
  return rows;
}

function gasInvalidate() { GAS_TABLES = {}; GAS_LEDGER_MEMO = null; GAS_LISTS_MEMO = null; }

function gasNum(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isNaN(n) ? '' : n;
}

function gasBool(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1' || String(v).toLowerCase() === 'yes';
}

/** Sheets may turn "2026-09-06" into a Date; normalise back to the text key. */
function gasDay(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Yangon', 'yyyy-MM-dd');
  return String(v || '');
}

function gasIso(v) {
  return v instanceof Date ? v.toISOString() : String(v || '');
}

function gasItemFromRow(o) {
  return {
    id: String(o.ItemID), shop: String(o.Shop || ''), name: String(o.Name || ''), category: String(o.Category || ''),
    type: String(o.Type || ''), price: gasNum(o.Price), cost: gasNum(o.Cost), photoUrl: String(o.PhotoURL || ''),
    photoFileId: String(o.PhotoFileID || ''), status: String(o.Status || ''), stock: Number(o.Stock) || 0,
    createdAt: gasIso(o.CreatedAt), createdBy: String(o.CreatedBy || ''), sample: gasBool(o.Sample), alias: String(o.Alias || ''),
    rev: Number(o.Rev) || 0, updatedAt: gasIso(o.UpdatedAt), _row: o._row
  };
}

/**
 * Rev and UpdatedAt for a master change made through Telegram (set price, photo, transfer, phone,
 * new customer). Phones pull masters by Rev (syncBuildPull), so without this a change made in the
 * bot would never reach them. The sync path passes its own rev and is left alone. The counter is a
 * Script Property; the callers run outside the script lock, so two simultaneous Telegram edits could
 * share a number, which only costs an extra pull. Returns a copy; the caller's object is untouched.
 */
function gasStampRev(fields) {
  var f = {};
  for (var k in fields) f[k] = fields[k];
  if (f.rev === undefined && typeof gasSyncCounters !== 'undefined') {
    f.rev = gasSyncCounters.nextRev();
    f.updatedAt = new Date().toISOString();
  }
  return f;
}

/** Rows of a tab, or [] when the tab does not exist (tailoring tabs on a sheet set up before them). */
function gasTableIf(name) {
  return gasSpreadsheet().getSheetByName(name) ? gasTable(name) : [];
}

/** Header row of a sheet as strings (the real column order, which ensureColumns may have extended). */
function gasHeader(sh) {
  var last = sh.getLastColumn();
  return last ? sh.getRange(1, 1, 1, last).getValues()[0].map(function (v) { return String(v); }) : [];
}

/** Grow the sheet's grid to at least n columns (a new tab has 26; writing beyond the grid fails). */
function gasEnsureWidth(sh, n) {
  var max = sh.getMaxColumns();
  if (max < n) sh.insertColumnsAfter(max, n - max);
}

/**
 * The Ledger grid holds CFG.LEDGER_COLS.length columns before a row is written (round 5: DueDay is the 27th column
 * and a new tab has 26). Both Ledger writers call it first, so a sale between "publish the server" and "run
 * setupSheet()" never writes 27 values into a 26-column grid: the value then sits under a blank header until
 * setupSheet() writes DueDay there, and gasTable reads it by name from then on. A grown DueDay column is made plain
 * text before any value goes in, as setupSheet() does: otherwise Sheets turns 2026-12-30 into a Date, and the '@'
 * that setupSheet() sets afterwards would not turn that Date back into the text. Once per execution (one
 * getMaxColumns call); the grid only ever grows.
 */
function gasLedgerWidth(sh) {
  if (GAS_LEDGER_WIDTH_OK) return;
  var max = sh.getMaxColumns(), n = CFG.LEDGER_COLS.length, due = CFG.LEDGER_COLS.indexOf('DueDay') + 1;
  if (max < n) {
    sh.insertColumnsAfter(max, n - max);
    if (due > max) sh.getRange(1, due, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  GAS_LEDGER_WIDTH_OK = true;
}

/**
 * Grow the sheet's grid to at least n rows, before a block is written below the last grid row. appendRow adds
 * its row by itself. A block write is different: the cells of a new row are set to plain text BEFORE its values
 * go in (addMeasurement, the Lists tab), and a format on a range outside the grid is an error. A tab has no
 * spare row once somebody deleted the empty ones at the bottom, or once appendRow has filled it to its last row.
 */
function gasEnsureRows(sh, n) {
  var max = sh.getMaxRows();
  if (max < n) sh.insertRowsAfter(max, n - max);
}

/** Append one object to a tab through a field -> column map, in the tab's own column order. */
function gasAppendMapped(name, map, obj) {
  var sh = gasSheet(name), header = gasHeader(sh), byCol = {};
  for (var k in map) if (obj[k] !== undefined) byCol[map[k]] = obj[k];
  sh.appendRow(header.map(function (h) { var v = byCol[h]; return v === undefined || v === null ? '' : v; }));
  SpreadsheetApp.flush();
  gasInvalidate();
}

/** Write some fields of one row in place through a field -> column map. */
function gasUpdateMapped(name, map, rowNum, fields) {
  var sh = gasSheet(name), header = gasHeader(sh);
  for (var k in fields) {
    var col = map[k];
    if (!col) continue;
    var c = header.indexOf(col) + 1;
    if (c < 1) continue;
    var v = fields[k];
    if (v === null || v === undefined) v = '';
    sh.getRange(rowNum, c).setValue(v);
  }
  SpreadsheetApp.flush();
  gasInvalidate();
}

var GAS_ORDER_MAP = {
  id: 'OrderID', shop: 'Shop', customerId: 'CustomerID', orderedDay: 'OrderedDay', dueDay: 'DueDay', deliveredDay: 'DeliveredDay',
  status: 'Status', statusAt: 'StatusAt', statusBy: 'StatusBy', total: 'Total', measId: 'MeasID', notes: 'Notes', createdBy: 'CreatedBy',
  createdAt: 'CreatedAt', voucherSentAt: 'VoucherSentAt', cancelNote: 'CancelNote', prevStatus: 'PrevStatus'
};
var GAS_ORDER_ITEM_MAP = {
  orderId: 'OrderID', line: 'Line', designCode: 'DesignCode', fabric: 'Fabric', description: 'Description', qty: 'Qty',
  unitPrice: 'UnitPrice', amount: 'Amount', cost: 'Cost', itemId: 'ItemID'
};
var GAS_DESIGN_MAP = {
  code: 'DesignCode', name: 'Name', category: 'Category', photoUrl: 'PhotoURL', photoFileId: 'PhotoFileID',
  basePrice: 'BasePrice', daysToMake: 'DaysToMake', active: 'Active', note: 'Note'
};

function gasOrderFromRow(o) {
  return {
    id: String(o.OrderID), shop: String(o.Shop || ''), customerId: String(o.CustomerID || ''), orderedDay: gasDay(o.OrderedDay),
    dueDay: gasDay(o.DueDay), deliveredDay: gasDay(o.DeliveredDay), status: String(o.Status || ''), statusAt: gasIso(o.StatusAt),
    statusBy: String(o.StatusBy || ''), total: Number(o.Total) || 0, measId: String(o.MeasID || ''), notes: String(o.Notes || ''),
    createdBy: String(o.CreatedBy || ''), createdAt: gasIso(o.CreatedAt), voucherSentAt: gasIso(o.VoucherSentAt),
    cancelNote: String(o.CancelNote || ''), prevStatus: String(o.PrevStatus || ''), _row: o._row
  };
}

function gasOrderItemFromRow(o) {
  return {
    orderId: String(o.OrderID), line: Number(o.Line) || 0, designCode: String(o.DesignCode || ''), fabric: String(o.Fabric || ''),
    description: String(o.Description || ''), qty: Number(o.Qty) || 0, unitPrice: Number(o.UnitPrice) || 0, amount: Number(o.Amount) || 0,
    cost: gasNum(o.Cost), itemId: String(o.ItemID || ''), _row: o._row
  };
}

function gasDesignFromRow(o) {
  return {
    code: String(o.DesignCode), name: String(o.Name || ''), category: String(o.Category || ''), photoUrl: String(o.PhotoURL || ''),
    photoFileId: String(o.PhotoFileID || ''), basePrice: gasNum(o.BasePrice), daysToMake: gasNum(o.DaysToMake),
    active: o.Active === '' || o.Active === null || o.Active === undefined ? true : gasBool(o.Active), note: String(o.Note || '')
  };
}

/** Measurements: the fixed columns, then every other header is a MeasureFields key whose value is kept as text. */
function gasMeasFromRow(o, header) {
  var rec = {
    id: String(o.MeasID), customerId: String(o.CustomerID || ''), orderId: String(o.OrderID || ''), day: gasDay(o.Day),
    staffId: String(o.StaffID || ''), source: String(o.Source || ''), photoUrl: String(o.PhotoURL || ''), notes: String(o.Notes || ''),
    entryId: String(o.EntryID || ''), sketch: String(o.Sketch || ''), fields: {}
  };
  header.forEach(function (h) {
    if (!h || CFG.MEAS_FIXED_COLS.indexOf(h) >= 0) return;
    var v = o[h];
    rec.fields[h] = v === '' || v === null || v === undefined ? '' : (v instanceof Date ? Utilities.formatDate(v, 'Asia/Yangon', 'd/M/yyyy') : String(v));
  });
  return rec;
}

function gasMeasurements() {
  var sh = gasSpreadsheet().getSheetByName('Measurements');
  if (!sh) return [];
  var header = gasHeader(sh);
  return gasTable('Measurements').filter(function (o) { return String(o.MeasID || '') !== ''; }).map(function (o) { return gasMeasFromRow(o, header); });
}

/* ---------- the Lists tab (core_ledger.js listRows, listUpsert); poc/sim_ports.js keeps the same contract ---------- */

// Plain-text ('@') columns of the Lists tab: an account number such as 09777123456 must keep its leading zero
// (it is what receipts print), and a key made of digits must never be read as a number.
var GAS_LIST_TEXT_COLS = ['Key', 'Label', 'Detail', 'Note'];

/**
 * The rows of one list as the Lists tab holds them, in sheet order, each with its sheet row (_row). A row with a
 * blank Key is skipped (gasTable keeps a row whose only content is an unticked box). A blank Active counts as
 * true: a cell that only carries the tick-box validation shows an empty box while its value is still blank.
 * A blank or non-numeric Order is 0. Key, Label, Detail and Note come back as strings. [] when the tab or the
 * list is missing.
 * The core keeps no copy of the lists and asks for them several times per bot action (about seven times for a
 * month report), so the tab is read and sorted into its lists once per execution (GAS_LISTS_MEMO, dropped by
 * gasInvalidate() like every other table): a second call touches no Google service, also on a sheet that has
 * no Lists tab yet. The rows returned are the memo's own: callers read them and never change them.
 */
function gasListRows(name) {
  var want = String(name === null || name === undefined ? '' : name).trim().toLowerCase();
  if (!want) return [];
  if (!GAS_LISTS_MEMO) {
    var memo = {};
    var text = function (v) { return v === null || v === undefined ? '' : String(v); };
    gasTableIf('Lists').forEach(function (o) {
      var list = text(o.List).trim().toLowerCase(), key = text(o.Key);
      if (!list || key.trim() === '') return;
      var a = o.Active, n = Number(o.Order);
      (memo['l:' + list] = memo['l:' + list] || []).push({
        _row: o._row, list: list, key: key, label: text(o.Label),
        active: (a === '' || a === null || a === undefined) ? true : gasBool(a),
        order: (typeof o.Order === 'number' || typeof o.Order === 'string') && o.Order !== '' && isFinite(n) ? n : 0,
        shop: text(o.Shop), detail: text(o.Detail), note: text(o.Note), kind: text(o.Kind).trim().toLowerCase()
      });
    });
    GAS_LISTS_MEMO = memo;
  }
  return GAS_LISTS_MEMO['l:' + want] || [];
}

/**
 * The last row of the Lists tab that holds anything besides a bare tick box (1 = only the header). New rows go
 * right below it: a box somebody ticked and unticked further down holds FALSE and would otherwise push every
 * later option under a gap of empty rows.
 */
function gasListsLastRow() {
  var last = 1;
  gasTableIf('Lists').forEach(function (o) {
    for (var k in o) {
      if (k === '_row' || k === 'Active') continue;
      if (o[k] !== '' && o[k] !== null && o[k] !== undefined) {
        if (o._row > last) last = o._row;
        return;
      }
    }
  });
  return last;
}

/** One normalised list row as the cells of a Lists row, in the tab's own column order. Active is a real boolean; no kind is a blank Kind. */
function gasListValues(header, r) {
  var map = {
    List: r.list, Key: r.key, Label: r.label, Active: r.active !== false, Order: r.order > 0 ? r.order : '',
    Shop: r.shop || '', Detail: r.detail || '', Note: r.note || '', Kind: r.kind || ''
  };
  return header.map(function (h) { return Object.prototype.hasOwnProperty.call(map, h) ? map[h] : ''; });
}

/**
 * Write normalised rows into the Lists tab as one block starting at row `first`. Never appendRow: the Key, Label,
 * Detail and Note cells of the new rows are set to plain text first and the values are written with setValues
 * afterwards (the addMeasurement pattern), so '09777123456' stays that string.
 */
function gasListsWriteRows(sh, header, first, rows) {
  if (!rows.length) return;
  gasEnsureRows(sh, first + rows.length - 1);
  GAS_LIST_TEXT_COLS.forEach(function (h) {
    var c = header.indexOf(h) + 1;
    if (c < 1) throw new Error('The Lists tab has no "' + h + '" column. Run setupSheet().');
    sh.getRange(first, c, rows.length, 1).setNumberFormat('@');
  });
  sh.getRange(first, 1, rows.length, header.length).setValues(rows.map(function (r) { return gasListValues(header, r); }));
}

/**
 * Persist what listUpsert (core_ledger.js) answered for the list called name: the appended rows as one block
 * below the last used row, then each Label or Detail it set, in place, its cell made plain text first.
 * A set on a row appended by this same call (a seed row) is folded into the block, so the row is written once.
 */
function gasListsPersist(name, ops) {
  var sh = gasSheet('Lists'), header = gasHeader(sh), first = gasListsLastRow() + 1;
  var rowOf = {}, pending = [], sets = [];
  gasListRows(name).forEach(function (r) {
    var k = 'k:' + listNormKey(name, r.key);
    if (rowOf[k] === undefined) rowOf[k] = r._row;     // a repeated key: the first row is the option (listNormRows)
  });
  ops.forEach(function (op) {
    if (op.op === 'append') {
      var row = op.row;
      rowOf['k:' + row.key] = first + pending.length;
      pending.push({ list: name, key: row.key, label: row.label, active: row.active, order: row.order, shop: row.shop, detail: row.detail, note: row.note, kind: row.kind });
      return;
    }
    if (op.op !== 'set' || (op.field !== 'label' && op.field !== 'detail')) return;
    var at = rowOf['k:' + op.key];
    if (at === undefined) return;
    if (at >= first) { pending[at - first][op.field] = op.value; return; }
    sets.push({ row: at, col: header.indexOf(op.field === 'label' ? 'Label' : 'Detail') + 1, value: op.value });
  });
  gasListsWriteRows(sh, header, first, pending);
  sets.forEach(function (s) {
    if (s.col < 1) throw new Error('The Lists tab has no Label or Detail column. Run setupSheet().');
    var cell = sh.getRange(s.row, s.col);
    cell.setNumberFormat('@');
    cell.setValue(s.value);
  });
}

var GAS_ITEM_FIELD_TO_COL = {
  shop: 'Shop', name: 'Name', category: 'Category', type: 'Type', price: 'Price', cost: 'Cost',
  photoUrl: 'PhotoURL', photoFileId: 'PhotoFileID', createdAt: 'CreatedAt', createdBy: 'CreatedBy', sample: 'Sample', alias: 'Alias',
  rev: 'Rev', updatedAt: 'UpdatedAt'
};

var gasStore = {
  getItem: function (id) {
    var rows = gasTable('Items');
    for (var i = 0; i < rows.length; i++) if (String(rows[i].ItemID) === String(id)) return gasItemFromRow(rows[i]);
    return null;
  },
  listItems: function (shop) {
    return gasTable('Items').filter(function (o) { return !shop || String(o.Shop) === shop; }).map(gasItemFromRow);
  },
  updateItem: function (id, fields) {
    var item = gasStore.getItem(id);
    if (!item) throw new Error('updateItem: no item ' + id);
    fields = gasStampRev(fields);
    var sh = gasSheet('Items');
    for (var k in fields) {
      var col = GAS_ITEM_FIELD_TO_COL[k];
      if (!col) continue;
      var c = CFG.ITEM_COLS.indexOf(col) + 1;
      var v = fields[k];
      if (v === null || v === undefined) v = '';
      if (k === 'sample') v = v ? true : '';
      sh.getRange(item._row, c).setValue(v);
    }
    SpreadsheetApp.flush();
    gasInvalidate();
  },
  /**
   * One row. Seq, ReceivedAt and DeviceID are stamped here for rows that arrive without them (the
   * Telegram route, triggers, the import): writeGroup runs inside ports.lock.run, so the LEDGER_SEQ
   * Script Property increment is serialised with the phones' pushes (gasSyncTabs.appendRows).
   */
  appendLedger: function (tx) {
    var sh = gasSheet('Ledger');
    gasLedgerWidth(sh);
    if ((tx.seq === '' || tx.seq === null || tx.seq === undefined) && typeof gasSyncCounters !== 'undefined') {
      tx.seq = gasSyncCounters.nextSeq();
      tx.receivedAt = tx.receivedAt || new Date().toISOString();
      tx.deviceId = tx.deviceId || 'TG';
    }
    var map = {
      TxID: tx.txId, GroupID: tx.groupId, Time: tx.time, Day: tx.day, Shop: tx.shop, ItemID: tx.itemId, Type: tx.type,
      Qty: tx.qty, UnitPrice: tx.unitPrice, Amount: tx.amount, Cash: tx.cash, CostAtSale: tx.costAtSale,
      CustomerID: tx.customerId, RefGroupID: tx.refGroupId, Note: tx.note, Source: tx.source,
      Transcript: tx.transcript, StaffID: tx.staffId, UpdateID: tx.updateId, ReversesTxID: tx.reversesTxId,
      Method: tx.method || '', Category: tx.category || '', Seq: tx.seq || '', ReceivedAt: tx.receivedAt || '',
      DeviceID: tx.deviceId || '', ReceiptNo: tx.receiptNo || '', DueDay: tx.dueDay || ''
    };
    sh.appendRow(CFG.LEDGER_COLS.map(function (c) { return map[c] === undefined ? '' : map[c]; }));
    SpreadsheetApp.flush();
    gasInvalidate();
  },
  ledgerRows: function () {
    if (GAS_LEDGER_MEMO) return GAS_LEDGER_MEMO;
    GAS_LEDGER_MEMO = gasTable('Ledger').map(function (o) {
      return {
        txId: String(o.TxID), groupId: String(o.GroupID), time: gasIso(o.Time), day: gasDay(o.Day), shop: String(o.Shop),
        itemId: String(o.ItemID || ''), type: String(o.Type), qty: Number(o.Qty) || 0, unitPrice: gasNum(o.UnitPrice),
        amount: Number(o.Amount) || 0, cash: Number(o.Cash) || 0, costAtSale: gasNum(o.CostAtSale),
        customerId: String(o.CustomerID || ''), refGroupId: String(o.RefGroupID || ''), note: String(o.Note || ''),
        source: String(o.Source || ''), transcript: String(o.Transcript || ''), staffId: String(o.StaffID || ''),
        updateId: String(o.UpdateID || ''), reversesTxId: String(o.ReversesTxID || ''),
        method: String(o.Method || ''), category: String(o.Category || ''), seq: gasNum(o.Seq), receivedAt: gasIso(o.ReceivedAt),
        deviceId: String(o.DeviceID || ''), receiptNo: String(o.ReceiptNo || ''),
        dueDay: o.DueDay === undefined ? '' : gasDay(o.DueDay)
      };
    });
    return GAS_LEDGER_MEMO;
  },
  getStaff: function (uid) {
    var list = gasStore.listStaff();
    for (var i = 0; i < list.length; i++) if (list[i].id === String(uid)) return list[i];
    return null;
  },
  prepareShopTags: function (id) {
    if (!gasStore.listItems(id).length) generateBlankTags(id, 1, 20, gasSyncCounters.nextRev());
  },
  saveStaff: function (p) {
    var sh = gasSheet('Staff'), rows = gasTable('Staff'), row = sh.getLastRow() + 1;
    rows.forEach(function (r) { if (String(r.TelegramUserID) === String(p.id)) row = r._row; });
    gasEnsureRows(sh, row);
    var headers = gasHeader(sh), scopeCol = headers.indexOf('Shops') + 1;
    if (!scopeCol) { scopeCol = headers.length + 1; sh.getRange(1, scopeCol).setValue('Shops'); }
    sh.getRange(row, scopeCol).setValue((p.shops || [p.shop]).join(','));
    var cells = sh.getRange(row, 1, 1, 5);
    cells.setNumberFormat('@');
    cells.setValues([[String(p.id), String(p.name).replace(/^=/, "'="), p.shop, p.role, !!p.active]]);
    SpreadsheetApp.flush();
    gasInvalidate();
  },
  listStaff: function (includeInactive) {
    return gasTable('Staff').filter(function (s) {
      return includeInactive || s.Active === '' || gasBool(s.Active);
    }).map(function (s) {
      return { id: String(s.TelegramUserID), name: String(s.Name || ''), shop: String(s.DefaultShop || 'S1'), active: s.Active === '' || gasBool(s.Active), shops: s.Shops ? String(s.Shops).split(',') : undefined, role: String(s.Role || 'staff').toLowerCase() };
    });
  },
  getCustomer: function (id) {
    var list = gasStore.listCustomers();
    for (var i = 0; i < list.length; i++) if (list[i].id === String(id)) return list[i];
    return null;
  },
  listCustomers: function () {
    return gasTable('Customers').map(function (c) {
      return { id: String(c.CustomerID), name: String(c.Name || ''), phone: String(c.Phone || ''), note: String(c.Note || ''), createdAt: gasIso(c.CreatedAt),
               rev: Number(c.Rev) || 0, updatedAt: gasIso(c.UpdatedAt) };
    });
  },
  addCustomer: function (c) {
    return gasLocked(function () {
      var sh = gasSheet('Customers');
      var id = 'C-' + ('0000' + sh.getLastRow()).slice(-4);
      var nowIso = new Date().toISOString();
      var rec = { id: id, name: String(c.name || '').trim() || id, phone: c.phone || '', note: c.note || '', createdAt: nowIso,
                  rev: typeof gasSyncCounters !== 'undefined' ? gasSyncCounters.nextRev() : 0, updatedAt: nowIso };
      var map = { CustomerID: rec.id, Name: rec.name, Phone: rec.phone, Note: rec.note, CreatedAt: new Date(), Rev: rec.rev || '', UpdatedAt: rec.updatedAt };
      sh.appendRow(CFG.CUSTOMER_COLS.map(function (col) { return map[col] === undefined ? '' : map[col]; }));
      SpreadsheetApp.flush();
      gasInvalidate();
      return rec;
    }, 15000);
  },
  /** Master data in place (phone, note, name). The Phone column is text-formatted by setupSheet so 09... keeps its zero. */
  updateCustomer: function (id, fields) {
    var rows = gasTable('Customers'), row = null;
    for (var i = 0; i < rows.length; i++) if (String(rows[i].CustomerID) === String(id)) row = rows[i];
    if (!row) throw new Error('updateCustomer: no customer ' + id);
    fields = gasStampRev(fields);
    var map = { name: 'Name', phone: 'Phone', note: 'Note', rev: 'Rev', updatedAt: 'UpdatedAt' };
    var sh = gasSheet('Customers');
    for (var k in fields) {
      var col = map[k];
      if (!col) continue;
      var v = fields[k];
      if (v === null || v === undefined) v = '';
      sh.getRange(row._row, CFG.CUSTOMER_COLS.indexOf(col) + 1).setValue(v);
    }
    SpreadsheetApp.flush();
    gasInvalidate();
  },
  /* ---------- custom tailoring (core_orders.js); poc/sim_ports.js implements the same functions ---------- */
  getOrder: function (id) {
    var rows = gasTableIf('Orders');
    for (var i = 0; i < rows.length; i++) if (String(rows[i].OrderID) === String(id)) return gasOrderFromRow(rows[i]);
    return null;
  },
  /** Orders of a shop (null = all) and status (null = any), in sheet order. */
  listOrders: function (shop, status) {
    return gasTableIf('Orders').filter(function (o) {
      return String(o.OrderID || '') !== '' && (!shop || String(o.Shop) === shop) && (!status || String(o.Status) === status);
    }).map(gasOrderFromRow);
  },
  addOrder: function (rec) {
    gasAppendMapped('Orders', GAS_ORDER_MAP, rec);
    return gasStore.getOrder(rec.id);
  },
  updateOrder: function (id, fields) {
    var o = gasStore.getOrder(id);
    if (!o) throw new Error('updateOrder: no order ' + id);
    var f = {};
    for (var k in fields) if (k !== 'id') f[k] = fields[k];
    gasUpdateMapped('Orders', GAS_ORDER_MAP, o._row, f);
  },
  /**
   * The next voucher number of a shop's paper series under the script lock, so two sellers creating orders
   * at once never draw the same one: Settings order_next_no_<shop> is the number to issue (never below an id
   * the shop already used); it is written back + 1. Returns the id: V1-2532, V2-0101.
   */
  nextOrderNo: function (shop) {
    return gasLocked(function () {
      gasInvalidate();
      var key = 'order_next_no_' + shop, rows = gasTable('Settings'), row = null, max = 0;
      for (var i = 0; i < rows.length; i++) if (String(rows[i].Key) === key) row = rows[i];
      var n = row ? Math.round(Number(row.Value)) || 0 : 0;
      gasTableIf('Orders').forEach(function (o) {
        var m = String(o.Shop) === shop && String(o.OrderID || '').match(/^V\d+-(\d+)$/);
        if (m) max = Math.max(max, Number(m[1]));
      });
      if (n <= max) n = max + 1;
      if (n < 1) n = 1;
      var sh = gasSheet('Settings');
      if (row) sh.getRange(row._row, 2).setValue(n + 1); else sh.appendRow([key, n + 1]);
      SpreadsheetApp.flush();
      gasInvalidate();
      return orderIdFor(shop, n);
    }, 15000);
  },
  /** Lines of one order (null = every order's), in sheet order. */
  listOrderItems: function (orderId) {
    return gasTableIf('OrderItems').filter(function (o) {
      return String(o.OrderID || '') !== '' && (!orderId || String(o.OrderID) === String(orderId));
    }).map(gasOrderItemFromRow);
  },
  addOrderItem: function (rec) {
    gasAppendMapped('OrderItems', GAS_ORDER_ITEM_MAP, rec);
  },
  updateOrderItem: function (orderId, line, fields) {
    var l = gasStore.listOrderItems(orderId).filter(function (x) { return Number(x.line) === Number(line); })[0];
    if (!l) throw new Error('updateOrderItem: no line ' + orderId + '-' + line);
    var f = {};
    for (var k in fields) if (k !== 'orderId' && k !== 'line') f[k] = fields[k];
    gasUpdateMapped('OrderItems', GAS_ORDER_ITEM_MAP, l._row, f);
  },
  /** OrderItems is master data like Items, not the ledger: a line removed while the order is being written is deleted. */
  removeOrderItem: function (orderId, line) {
    var l = gasStore.listOrderItems(orderId).filter(function (x) { return Number(x.line) === Number(line); })[0];
    if (!l) return;
    gasSheet('OrderItems').deleteRow(l._row);
    SpreadsheetApp.flush();
    gasInvalidate();
  },
  listDesigns: function () {
    return gasTableIf('Designs').filter(function (o) { return String(o.DesignCode || '') !== ''; }).map(gasDesignFromRow);
  },
  /** By code, or by alias: TSL-18, tsl18 and TSL-0018 are the same design (normDesignCode). */
  getDesign: function (code) {
    var list = gasStore.listDesigns(), want = String(code || '').trim(), key = normDesignCode(want), i;
    for (i = 0; i < list.length; i++) if (list[i].code === want) return list[i];
    if (!key) return null;
    for (i = 0; i < list.length; i++) if (normDesignCode(list[i].code) === key) return list[i];
    return null;
  },
  /**
   * A new Designs row {code, name, category, basePrice, daysToMake, active, note} (a code created from the order
   * screen; the family fills the name, price and photo later on the laptop). Under the lock, from a fresh read:
   * when getDesign already finds the code (TSL-18, tsl18 and TSL-0018 are one design) nothing is written.
   * Returns the stored design in the shape getDesign returns, for a new row and for an existing code alike.
   */
  addDesign: function (rec) {
    return gasLocked(function () {
      gasInvalidate();
      rec = rec || {};
      var code = String(rec.code || '').trim();
      if (!code) throw new Error('addDesign: no code');
      var have = gasStore.getDesign(code);
      if (have) return have;
      var row = { code: code, name: String(rec.name || ''), category: String(rec.category || ''), photoUrl: '', photoFileId: '',
                  basePrice: gasNum(rec.basePrice), daysToMake: gasNum(rec.daysToMake), active: rec.active !== false, note: String(rec.note || '') };
      gasAppendMapped('Designs', GAS_DESIGN_MAP, row);
      return gasStore.getDesign(code) || row;
    }, 15000);
  },
  /** MeasureFields rows as the family edits them (renamed, reordered, Active FALSE); [] makes the core use the CFG list. */
  listMeasureFields: function () {
    return gasTableIf('MeasureFields').filter(function (o) { return String(o.Key || '') !== ''; }).map(function (o) {
      return { key: String(o.Key), labelMy: String(o.LabelMy || ''), labelEn: String(o.LabelEn || ''), group: String(o.Group || ''),
               multi: Number(o.Multi) || 1, type: String(o.Type || 'number'), order: Number(o.Order) || 0,
               active: o.Active === '' || o.Active === null || o.Active === undefined ? true : gasBool(o.Active) };
    });
  },
  /**
   * A new Measurements row (rows are never edited), under the lock so two saves never share an id: MeasID M-00001,
   * a column is appended for a field key the tab does not have yet, and the row's cells are set to '@' (plain
   * text) before the values are written as strings, so '36/30/20', '7/3/20' or '17.5' stay exactly as typed.
   * rec.entryId (a session from a phone's form, core_sync.js) goes into EntryID, a column appended here as well
   * on a tab set up before it: the sync server answers a resent entry dup by it. rec.sketch (round 6, revision 3: the
   * drawing on the figure, '1F:<strokes>') goes into Sketch, appended the same way, and only for a session that has one.
   */
  addMeasurement: function (rec) {
    return gasLocked(function () {
      gasInvalidate();   // a Measurements read made before the lock was taken must not decide the next MeasID
      var sh = gasSheet('Measurements'), header = gasHeader(sh), fields = rec.fields || {};
      var missing = Object.keys(fields).filter(function (k) { return header.indexOf(k) < 0; });
      if (rec.entryId && header.indexOf('EntryID') < 0 && missing.indexOf('EntryID') < 0) missing.push('EntryID');
      if (rec.sketch && header.indexOf('Sketch') < 0 && missing.indexOf('Sketch') < 0) missing.push('Sketch');
      if (missing.length) {
        gasEnsureWidth(sh, header.length + missing.length);
        sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
        header = header.concat(missing);
      }
      // The next number after the highest MeasID (not the row count, which a deleted row would make repeat).
      var maxNo = 0;
      gasTable('Measurements').forEach(function (o) { var m = String(o.MeasID || '').match(/^M-(\d+)$/); if (m) maxNo = Math.max(maxNo, Number(m[1])); });
      var id = 'M-' + ('00000' + (maxNo + 1)).slice(-5);
      var fixed = { MeasID: id, CustomerID: rec.customerId, OrderID: rec.orderId || '', Day: rec.day, StaffID: rec.staffId,
                    Source: rec.source || '', PhotoURL: rec.photoUrl || '', Notes: rec.notes || '', EntryID: rec.entryId || '', Sketch: rec.sketch || '' };
      var row = header.map(function (h) {
        var v = Object.prototype.hasOwnProperty.call(fixed, h) ? fixed[h] : fields[h];
        return v === undefined || v === null ? '' : String(v);
      });
      var at = sh.getLastRow() + 1;
      gasEnsureRows(sh, at);
      var range = sh.getRange(at, 1, 1, header.length);
      range.setNumberFormat('@');
      range.setValues([row]);
      SpreadsheetApp.flush();
      gasInvalidate();
      var out = { id: id, customerId: String(rec.customerId || ''), orderId: String(rec.orderId || ''), day: String(rec.day || ''),
                  staffId: String(rec.staffId || ''), source: String(rec.source || ''), photoUrl: String(rec.photoUrl || ''), notes: String(rec.notes || ''),
                  entryId: String(rec.entryId || ''), sketch: String(rec.sketch || ''), fields: {} };
      Object.keys(fields).forEach(function (k) { out.fields[k] = fields[k] === undefined || fields[k] === null ? '' : String(fields[k]); });
      return out;
    }, 15000);
  },
  /**
   * The session a phone's measurement entry became (its EntryID), or null: the drawing's picture job looks its session up
   * by the entry it was saved with (gas_sync.js). A blank entry id finds nothing. The newest row wins (there is one).
   */
  findMeasurementByEntry: function (entryId) {
    var want = String(entryId === null || entryId === undefined ? '' : entryId);
    if (!want) return null;
    var list = gasMeasurements();
    for (var i = list.length - 1; i >= 0; i--) if (list[i].entryId === want) return list[i];
    return null;
  },
  /**
   * The one cell a session gets after it was added: its PhotoURL (the Drive picture of the drawing; an order's MeasID link
   * is likewise written later), under the lock, as plain text like the rest of the row. Throws for an unknown MeasID.
   */
  setMeasurementPhoto: function (measId, url) {
    return gasLocked(function () {
      gasInvalidate();
      var sh = gasSheet('Measurements'), c = gasHeader(sh).indexOf('PhotoURL') + 1, row = null;
      if (c < 1) throw new Error('The Measurements tab has no PhotoURL column. Run setupSheet().');
      gasTable('Measurements').forEach(function (o) { if (String(o.MeasID) === String(measId)) row = o; });
      if (!row) throw new Error('setMeasurementPhoto: no session ' + measId);
      var cell = sh.getRange(row._row, c);
      cell.setNumberFormat('@');
      cell.setValue(String(url === null || url === undefined ? '' : url));
      SpreadsheetApp.flush();
      gasInvalidate();
    }, 15000);
  },
  getMeasurement: function (id) {
    var list = gasMeasurements();
    for (var i = 0; i < list.length; i++) if (list[i].id === String(id)) return list[i];
    return null;
  },
  /** One customer's sessions, oldest first (the newest is the last). */
  listMeasurements: function (customerId) {
    return gasMeasurements().filter(function (m) { return !customerId || m.customerId === String(customerId); });
  },
  /** Every session of every customer, oldest first: the sync server pages them to the phones by MeasID (syncBuildPull). */
  listAllMeasurements: function () { return gasMeasurements(); },
  /* ---------- option lists (core_ledger.js listRows and listUpsert); poc/sim_ports.js implements the same functions ---------- */
  /**
   * Every row of one list (pay_method, expense_category, fabric), active or not, in sheet order; [] when the Lists
   * tab or the list is missing, which makes the core read the Settings rows as before. Order is 0 for a blank
   * cell; Key, Label, Detail and Note are strings. kind (the Kind cell in lower case) is there only when that cell is
   * not blank, so a row without one keeps the eight-field shape (listNormRow then keeps it only for wallet or bank).
   */
  listOptions: function (name) {
    return gasListRows(name).map(function (r) {
      var o = { list: r.list, key: r.key, label: r.label, active: r.active, order: r.order, shop: r.shop, detail: r.detail, note: r.note };
      if (r.kind) o.kind = r.kind;
      return o;
    });
  },
  /**
   * Add an option, or set an account's Detail, by the one upsert rule (listUpsert). rec = {list, key, label?,
   * detail?, detailWas?, shop?, note?}; seedRows = what the user sees today, written first while the list has no
   * row yet, so adding one option never hides the old ones. Returns {status: 'ok' | 'dup', key}.
   * The whole body runs under the script lock (re-entrant: on the sync route the batch already holds it) and
   * starts from a fresh read, because the caller looked at the list before the lock was taken. A sheet that
   * setupSheet() has not visited since this version gets its Lists tab here, seeded from the Settings rows.
   * The Dashboard is not rewritten here: the flag makes doPost do it once, after the reply (gasDashboardRefresh).
   */
  addListOption: function (rec, seedRows) {
    return gasLocked(function () {
      gasInvalidate();
      rec = rec || {};
      var name = String(rec.list || '');
      if (CFG.LIST_NAMES.indexOf(name) < 0) throw new Error('addListOption: unknown list "' + name + '"');
      var ss = gasSpreadsheet(), created = false;
      if (!ss.getSheetByName('Lists')) {
        ensureListsTab(ss);
        created = true;
      }
      var res = listUpsert(gasListRows(name), rec, seedRows);
      if (res.ops.length) gasListsPersist(name, res.ops);
      if (res.ops.length || created) {
        SpreadsheetApp.flush();
        gasInvalidate();
        GAS_DASH_DIRTY = true;
      }
      return { status: res.status, key: res.key };
    }, 15000);
  },
  getSetting: function (key, def) {
    var rows = gasTable('Settings');
    for (var i = 0; i < rows.length; i++) if (String(rows[i].Key) === key && rows[i].Value !== '') return rows[i].Value;
    return def;
  },
  /**
   * One Settings value written by the sync server (round 6, revision 3: the owner's Shops screen and AI switch through a
   * phone's setting entry, core_sync.js, which whitelists the key). Under the lock, from a fresh read: the Value cell of the
   * row whose Key is key, or of a new row below the last one, is made plain text ('@') BEFORE the value goes in as a
   * string, as the Lists and Measurements writers do, so '09123456789' keeps its zero, '+95 9 777' its '+' and 'TRUE'
   * stays the text TRUE (Settings are read back through getValues). A member of gasStore, not a global: poc/run_gas.js has
   * a test helper of that name.
   */
  setSetting: function (key, value) {
    return gasLocked(function () {
      gasInvalidate();
      var k = String(key), v = String(value === null || value === undefined ? '' : value), sh = gasSheet('Settings'), row = null;
      gasTable('Settings').forEach(function (r) { if (!row && String(r.Key) === k) row = r; });
      if (row) {
        var cell = sh.getRange(row._row, 2);
        cell.setNumberFormat('@');
        cell.setValue(v);
      } else {
        var at = sh.getLastRow() + 1;
        gasEnsureRows(sh, at);
        var line = sh.getRange(at, 1, 1, 2);
        line.setNumberFormat('@');
        line.setValues([[k, v]]);
      }
      SpreadsheetApp.flush();
      gasInvalidate();
    }, 15000);
  },
  getMessage: function (key) {
    var rows = gasTable('Messages');
    for (var i = 0; i < rows.length; i++) if (String(rows[i].Key) === key && rows[i].Text !== '') return String(rows[i].Text);
    return null;
  },
  /**
   * Rewrite the Credits and Deposits tabs from the computed views, and fill the Customers
   * summary columns F:K (Bought..Visits) from customerSummaries(ports). The Customers tab is
   * never cleared: A:E is master data (name, phone, note), so only F:K is written, row by row.
   * The third argument is optional so older callers keep working; rebuildViews() in gas_main.js
   * should pass customerSummaries(ports) as well.
   * A Credits row is 15 cells: round 5 adds DueDay (the promised date, '' when none) and Overdue (a boolean). The whole
   * Day and DueDay columns are made plain text before the values go in: the tab is cleared and rewritten whole, and
   * without the format Sheets would turn 2026-12-30 into a Date.
   */
  refreshViews: function (credits, deposits, customers) {
    var cs = gasSheet('Credits');
    cs.clearContents();
    var crows = [CFG.CREDIT_COLS].concat(credits.map(function (c) {
      return [c.groupId, c.day, c.shop, c.customerId, c.customer, c.itemId, c.item, c.total, c.cash, c.payments, c.applied, c.owed, c.days,
              c.dueDay || '', c.overdue === true];
    }));
    ['Day', 'DueDay'].forEach(function (name) {
      cs.getRange(1, CFG.CREDIT_COLS.indexOf(name) + 1, cs.getMaxRows(), 1).setNumberFormat('@');
    });
    cs.getRange(1, 1, crows.length, CFG.CREDIT_COLS.length).setValues(crows);
    var ds = gasSheet('Deposits');
    ds.clearContents();
    var drows = [CFG.DEPOSIT_COLS].concat(deposits.map(function (d) {
      return [d.customerId, d.customer, d.received, d.used, d.held, d.lastDay, d.earmarked || ''];
    }));
    ds.getRange(1, 1, drows.length, CFG.DEPOSIT_COLS.length).setValues(drows);
    cs.getRange(1, 1, 1, CFG.CREDIT_COLS.length).setFontWeight('bold');
    ds.getRange(1, 1, 1, CFG.DEPOSIT_COLS.length).setFontWeight('bold');
    if (customers && customers.length !== undefined) gasWriteCustomerView(customers);
    SpreadsheetApp.flush();
  },
  logError: function (where, err, updateId, payload) {
    var msg = err && err.message ? err.message + (err.stack ? '\n' + String(err.stack).slice(0, 500) : '') : String(err);
    gasSheet('Errors').appendRow([new Date(), where, msg, updateId || '', String(payload || '').slice(0, 2000)]);
  },
  logUnknownUser: function (from, updateId) {
    gasSheet('Errors').appendRow([new Date(), 'unknown_user',
      'Not in Staff tab: ' + from.id + ' (' + [from.first_name, from.last_name, from.username].filter(Boolean).join(' ') + '). Add the id to Staff to allow.',
      updateId || '', JSON.stringify(from)]);
  }
};

/** Columns F:K of Customers (Bought, Paid, Owed, DepositHeld, LastVisit, Visits), one block write, A:E untouched. */
function gasWriteCustomerView(customers) {
  var rows = gasTable('Customers');
  if (!rows.length) return;
  var byId = {};
  customers.forEach(function (c) { byId[String(c.id || c.customerId)] = c; });
  var first = CFG.CUSTOMER_COLS.indexOf('Bought') + 1;
  var width = CFG.CUSTOMER_COLS.indexOf('Visits') - CFG.CUSTOMER_COLS.indexOf('Bought') + 1;
  var maxRow = rows.reduce(function (m, r) { return Math.max(m, r._row); }, 1);
  var block = [];
  for (var i = 2; i <= maxRow; i++) block.push(['', '', '', '', '', '']);
  rows.forEach(function (r) {
    var m = byId[String(r.CustomerID)];
    if (m) block[r._row - 2] = [m.bought, m.paid, m.owed, m.depositHeld, m.lastDay, m.visits];
  });
  if (block.length) gasSheet('Customers').getRange(2, first, block.length, width).setValues(block);
}

/**
 * The spreadsheet this script works on. A project created from the sheet
 * (Extensions > Apps Script) is bound to it; a standalone project created at
 * script.google.com/home reads Script Property SHEET_ID instead.
 */
function gasSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Not bound to a sheet. Set Script Property SHEET_ID to the spreadsheet id (the long part of its URL).');
  return SpreadsheetApp.openById(id);
}
