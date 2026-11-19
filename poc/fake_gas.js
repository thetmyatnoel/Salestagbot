/**
 * poc/fake_gas.js — a strict, in-memory stand-in for the Apps Script services that gas_*.js talks to, so the
 * Google glue (setupSheet, gasStore, the script lock, doPost, onEdit) runs in Node as it runs in production.
 * poc/run_gas.js is its only user. It is written by the same people as the code it checks, so it follows
 * four rules that keep it from agreeing with a mistake (docs/design-round-4/SPEC-round-4.md section 12):
 *
 *  (a) STRICT. Every fake object throws `fake_gas: <Class>.<member> is not modelled` for a member outside
 *      FAKE_GAS_MEMBERS below. A misspelt Apps Script call fails the test instead of passing silently.
 *      Builders check their arguments the way the real ones do (setRanges wants an array of ranges,
 *      setDataValidation wants the rule that build() returned, setValues wants the range's dimensions).
 *  (b) VALUES BEHAVE LIKE SHEETS. A string written to a cell whose number format is not '@' is read the way
 *      Sheets reads typed text: '09777123456' becomes the number 9777123456, 'TRUE' / 'FALSE' become booleans,
 *      '2026-09-06' becomes a Date, '=...' becomes a formula. A cell formatted '@' keeps every string as it
 *      is (and holds text only). insertCheckboxes() sets every cell of its range to false. A cell that only
 *      carries a tick-box rule is still blank. A write that breaks a rule made with setAllowInvalid(false)
 *      throws. Formulas are kept as text and never evaluated: getValues() returns the formula text, so
 *      nothing in a test may depend on Items.Status, Items.Stock or a Dashboard number.
 *      THE GRID, stricter than Sheets on purpose: a range that reaches outside the sheet's rows or columns
 *      throws for every use. In Sheets setValues below the last row is known to grow the grid by itself; a
 *      format, a note, a rule or a read on such a range is expected to fail ("The coordinates of the range
 *      are outside the dimensions of the sheet"), which nobody measured on a live sheet. The code under test
 *      must not depend on which it is, so it grows the sheet first (gasEnsureRows, gasEnsureWidth) and this
 *      fake refuses every such range. appendRow grows the sheet by itself, as in Sheets.
 *      Not modelled: the locale-dependent readings of typed text (7/3/20, 12:30, 50%, a currency sign); such
 *      a string stays a string here, so a test must not conclude that it is safe in a cell that is not '@'.
 *  (c) LOCKSERVICE AS DOCUMENTED. The script lock is not counted: waitLock on a lock that is already held
 *      does nothing, and the first releaseLock frees it. The fake counts the acquires made while the lock
 *      was held (fake.lock.nested) and exposes whether it is held; every logged call carries `held`.
 *  (d) EXECUTIONS. fake.newExecution() loads the bundle into a fresh vm context over the same spreadsheet,
 *      Script Properties and cache. Globals (GAS_TABLES, GAS_LOCK_DEPTH, GAS_DASH_DIRTY) therefore live as
 *      long as one request, as in production. Every simulated request and every hand edit starts one.
 *
 * What a test looks at is never visible to the code under test: fake.sheet(name) (raw cells, formats, rules,
 * notes), fake.log (every call made on a fake object, in order), fake.lock, fake.props, fake.cache.
 * fake.hand.* are the things a person does in the Sheet (type into a cell, tick a box, delete a row or a tab).
 * fake.failNext(match, message) makes one future call fail, to show where the code lets an error through.
 */
'use strict';
const vm = require('vm');
const crypto = require('crypto');
const util = require('util');

/**
 * The modelled members, class by class. The first block is the list of the spec; `added` names what the real
 * code needs beyond it (each is a real Apps Script member). This table is enforced: strict() refuses to build
 * a fake object whose members are not exactly the ones listed here for its class, so the table cannot drift
 * from the code below, and poc/run_gas.js compares it with the list it expects.
 */
const FAKE_GAS_MEMBERS = {
  SpreadsheetApp: ['getActiveSpreadsheet', 'openById', 'flush', 'ProtectionType', 'newDataValidation', 'newConditionalFormatRule'],
  Spreadsheet: ['getSheetByName', 'insertSheet', 'setSpreadsheetTimeZone', 'getId', 'getUrl'],
  Sheet: ['getName', 'getSheetId', 'getLastRow', 'getLastColumn', 'getMaxRows', 'getMaxColumns', 'insertColumnsAfter', 'getRange',
          'getDataRange', 'appendRow', 'deleteRow', 'clear', 'clearContents', 'setFrozenRows', 'hideSheet', 'setColumnWidth',
          'getProtections', 'protect', 'setConditionalFormatRules', 'getConditionalFormatRules'],
  Range: ['getValues', 'getValue', 'setValues', 'setValue', 'setFormulas', 'setNumberFormat', 'setFontWeight', 'setFontSize',
          'setDataValidation', 'setNote', 'insertCheckboxes', 'getSheet', 'getRow', 'getColumn'],
  Protection: ['setDescription', 'setWarningOnly'],
  DataValidationBuilder: ['requireValueInList', 'requireCheckbox', 'requireFormulaSatisfied', 'setAllowInvalid', 'setHelpText', 'build'],
  ConditionalFormatRuleBuilder: ['whenFormulaSatisfied', 'setBackground', 'setFontColor', 'setRanges', 'build'],
  Lock: ['waitLock', 'releaseLock'],
  Properties: ['getProperty', 'setProperty'],
  Cache: ['get', 'put', 'remove'],
  Utilities: ['getUuid', 'computeDigest', 'DigestAlgorithm', 'Charset', 'formatDate'],
  Logger: ['log'],
  added: {
    // The three service entry points (the spec lists what they return).
    LockService: ['getScriptLock'], PropertiesService: ['getScriptProperties'], CacheService: ['getScriptCache'],
    // doPost's two replies: ok() on the Telegram branch, gasSyncJson() on the ?api= branch. The code only builds
    // them; a test reads what they hold with fake.reply(output).
    HtmlService: ['createHtmlOutput'], HtmlOutput: [],
    ContentService: ['createTextOutput', 'MimeType'], TextOutput: ['setMimeType'],
    // gasEnsureRows (gas_store.js): a block write below the last grid row needs the rows to exist.
    Sheet: ['insertRowsAfter'],
    // The values of the enums the spec's list names (SpreadsheetApp.ProtectionType, Utilities.DigestAlgorithm,
    // Utilities.Charset) and of ContentService.MimeType.
    ProtectionType: ['SHEET', 'RANGE'], DigestAlgorithm: ['SHA_256'], Charset: ['UTF_8'], MimeType: ['JSON'],
    // Present so that a reference resolves, with no member modelled: Telegram, Gemini, Drive and triggers
    // are not part of what this fake can check.
    UrlFetchApp: [], DriveApp: [], ScriptApp: [],
    // What build() returns. The code only passes them on.
    DataValidation: [], ConditionalFormatRule: []
  }
};

/** Every member a fake object of that class has (the spec's list plus `added`), or null for an unknown class. */
function fakeGasMembersOf(cls) {
  const base = cls !== 'added' && Array.isArray(FAKE_GAS_MEMBERS[cls]) ? FAKE_GAS_MEMBERS[cls] : null;
  const extra = Array.isArray(FAKE_GAS_MEMBERS.added[cls]) ? FAKE_GAS_MEMBERS.added[cls] : null;
  return base || extra ? (base || []).concat(extra || []) : null;
}

const KEY = 100000;                                    // cell key = row * KEY + column
const isDate = v => util.types.isDate(v);              // true for a Date of any vm realm
const isBlank = v => v === '' || v === null || v === undefined;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const GROUPED_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A date as a cell holds it. getValues() turns it into a Date of the execution that reads it. */
function CellDate(ms) { this.ms = ms; Object.freeze(this); }

function colLetters(c) {
  let s = '';
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Wall-clock parts of an instant in a time zone, and that zone's offset from UTC at that instant. */
function zoneParts(tz, ms) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {};
  dtf.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}
function zoneOffsetMs(tz, ms) {
  const p = zoneParts(tz, ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

function createFakeGas(options) {
  options = options || {};
  const script = new vm.Script(String(options.source || ''), { filename: options.filename || 'Code.gs' });

  const world = {
    book: { id: 'fake-spreadsheet-id', timeZone: 'Etc/GMT', sheets: new Map(), nextSheetId: 1 },
    bound: options.bound !== false,                    // a project made from the Sheet: getActiveSpreadsheet() returns it
    props: {}, cache: {},
    lock: { held: false, acquires: 0, nested: 0, releases: 0, strayReleases: 0, leaked: 0, waits: [], busy: false },
    log: [], faults: [], exec: 0, flushes: 0, loggerLines: [], seed: 0x5eed1234
  };

  /* ------------------------------ strict objects and the call log ------------------------------ */

  const RANGES = new WeakMap(), RULES = new WeakMap(), CF_RULES = new WeakMap(), OUTPUTS = new WeakMap();
  const VALUE_WRITES = { 'Range.setValues': 1, 'Range.setValue': 1, 'Range.setFormulas': 1, 'Range.insertCheckboxes': 1,
                         'Sheet.appendRow': 1, 'Sheet.deleteRow': 1, 'Sheet.clear': 1, 'Sheet.clearContents': 1 };
  const OTHER_WRITES = { 'Range.setNumberFormat': 1, 'Range.setFontWeight': 1, 'Range.setFontSize': 1, 'Range.setDataValidation': 1, 'Range.setNote': 1,
                         'Sheet.insertColumnsAfter': 1, 'Sheet.insertRowsAfter': 1, 'Sheet.setFrozenRows': 1, 'Sheet.hideSheet': 1, 'Sheet.setColumnWidth': 1,
                         'Sheet.protect': 1, 'Sheet.setConditionalFormatRules': 1, 'Spreadsheet.insertSheet': 1, 'Spreadsheet.setSpreadsheetTimeZone': 1 };

  /** A fake object: only the given members exist; every call is logged with the lock state at that moment. */
  function strict(cls, members, tag) {
    const listed = fakeGasMembersOf(cls), have = Object.keys(members);
    if (!listed) throw new Error('fake_gas: the class ' + cls + ' is not in FAKE_GAS_MEMBERS');
    const unlisted = have.filter(m => listed.indexOf(m) < 0), unbuilt = listed.filter(m => have.indexOf(m) < 0);
    if (unlisted.length || unbuilt.length) {
      throw new Error('fake_gas: ' + cls + ' does not match FAKE_GAS_MEMBERS (modelled but not listed: [' + unlisted.join(', ') + '], listed but not modelled: [' + unbuilt.join(', ') + '])');
    }
    const target = {};
    Object.keys(members).forEach(name => {
      const m = members[name];
      target[name] = typeof m !== 'function' ? m : function () {
        const id = cls + '.' + name;
        const entry = { n: world.log.length, exec: world.exec, cls, member: name, call: id, held: world.lock.held,
                        write: VALUE_WRITES[id] ? 'value' : (OTHER_WRITES[id] ? 'other' : '') };
        const first = arguments[0];
        if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean') entry.arg = first;   // a tab name, a property key, a wait time
        if (tag) Object.keys(tag).forEach(k => { entry[k] = tag[k]; });
        world.log.push(entry);
        for (let i = 0; i < world.faults.length; i++) {                  // a failure a test asked for (failNext)
          if (!world.faults[i].match(entry)) continue;
          const fault = world.faults.splice(i, 1)[0];
          entry.failed = true;
          throw new Error(fault.message);
        }
        return m.apply(this, arguments);
      };
    });
    Object.freeze(target);
    return new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'symbol') return t[prop];
        if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
        throw new Error('fake_gas: ' + cls + '.' + prop + ' is not modelled');
      },
      set(t, prop) { throw new Error('fake_gas: ' + cls + '.' + String(prop) + ' cannot be assigned'); },
      defineProperty(t, prop) { throw new Error('fake_gas: ' + cls + '.' + String(prop) + ' cannot be defined'); },
      deleteProperty(t, prop) { throw new Error('fake_gas: ' + cls + '.' + String(prop) + ' cannot be deleted'); }
    });
  }
  const int = (v, what, min) => {
    if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < min) throw new Error('fake_gas: ' + what + ' must be a whole number of at least ' + min + ', got ' + util.inspect(v));
    return v;
  };

  /* ------------------------------ the spreadsheet: cells ------------------------------ */

  function newSheet(name) {
    return { name, id: world.book.nextSheetId++, maxRows: 1000, maxCols: 26, cells: new Map(), frozenRows: 0, hidden: false,
             colWidths: {}, protections: [], cfRules: [] };
  }
  function cellOf(sh, r, c) { return sh.cells.get(r * KEY + c) || null; }
  function cellFor(sh, r, c) {
    let cell = sh.cells.get(r * KEY + c);
    if (!cell) { cell = { v: '' }; sh.cells.set(r * KEY + c, cell); }
    return cell;
  }
  function lastRow(sh) {
    let m = 0;
    sh.cells.forEach((cell, k) => { if (!isBlank(cell.v)) { const r = Math.floor(k / KEY); if (r > m) m = r; } });
    return m;
  }
  function lastCol(sh) {
    let m = 0;
    sh.cells.forEach((cell, k) => { if (!isBlank(cell.v)) { const c = k % KEY; if (c > m) m = c; } });
    return m;
  }
  /** Rows added at the bottom take the number formats and the data-validation rules of the row above them. */
  function growRows(sh, after, n) {
    if (after < sh.maxRows) {                          // rows inserted in the middle: move everything below down
      const moved = [];
      sh.cells.forEach((cell, k) => { if (Math.floor(k / KEY) > after) moved.push([k, cell]); });
      moved.forEach(([k]) => sh.cells.delete(k));
      moved.forEach(([k, cell]) => sh.cells.set(k + n * KEY, cell));
    }
    sh.maxRows += n;
    for (let c = 1; c <= sh.maxCols; c++) {
      const above = cellOf(sh, after, c);
      if (!above || (above.fmt === undefined && !above.dv)) continue;
      for (let r = after + 1; r <= after + n; r++) {
        const cell = cellFor(sh, r, c);
        if (above.fmt !== undefined) cell.fmt = above.fmt;
        if (above.dv) cell.dv = above.dv;
      }
    }
  }
  function removeRow(sh, pos) {
    const moved = [];
    sh.cells.forEach((cell, k) => { const r = Math.floor(k / KEY); if (r >= pos) moved.push([k, cell, r]); });
    moved.forEach(([k]) => sh.cells.delete(k));
    moved.forEach(([k, cell, r]) => { if (r > pos) sh.cells.set(k - KEY, cell); });
    sh.maxRows -= 1;
  }

  /** What Sheets stores when `value` is written to a cell (rule b). Returns {v, f}: f marks a formula. */
  function coerce(cell, value, where) {
    const text = !!cell && cell.fmt === '@';
    if (value === null || value === undefined) return { v: '' };
    if (isDate(value)) {
      if (isNaN(value.getTime())) throw new Error('fake_gas: an invalid Date was written to ' + where);
      return text ? { v: new Date(value.getTime()).toISOString() } : { v: new CellDate(value.getTime()) };
    }
    if (typeof value === 'number') {
      if (!isFinite(value)) throw new Error('fake_gas: ' + value + ' was written to ' + where);
      return { v: text ? String(value) : value };
    }
    if (typeof value === 'boolean') return { v: text ? (value ? 'TRUE' : 'FALSE') : value };
    if (typeof value !== 'string') throw new Error('fake_gas: a ' + (Array.isArray(value) ? 'array' : typeof value) + ' was written to ' + where + ' (a cell takes a string, a number, a boolean or a Date)');
    if (text || value === '') return { v: value };
    if (value.charAt(0) === '=' && value.length > 1) return { v: value, f: true };
    if (value.charAt(0) === "'") return { v: value.slice(1) };            // the typed apostrophe: "keep as text"
    if (/^true$/i.test(value)) return { v: true };
    if (/^false$/i.test(value)) return { v: false };
    if (NUM_RE.test(value) && isFinite(Number(value))) return { v: Number(value) };
    if (GROUPED_RE.test(value)) return { v: Number(value.replace(/,/g, '')) };
    const d = ISO_DAY_RE.exec(value);
    if (d) {
      const utc = Date.UTC(+d[1], +d[2] - 1, +d[3]);
      const back = new Date(utc);
      if (back.getUTCMonth() === +d[2] - 1 && back.getUTCDate() === +d[3]) return { v: new CellDate(utc - zoneOffsetMs(world.book.timeZone, utc)) };
    }
    return { v: value };
  }
  /** A rule made with setAllowInvalid(false) refuses the value, for a script as for a person. */
  function checkRule(sh, r, c, cell, v) {
    const dv = cell.dv;
    if (!dv || dv.allowInvalid || isBlank(v)) return;
    let ok = true;
    if (dv.type === 'list') ok = dv.values.indexOf(v instanceof CellDate ? '' : String(v)) >= 0;
    else if (dv.type === 'checkbox') ok = typeof v === 'boolean';
    if (!ok) throw new Error('The data you entered in cell ' + colLetters(c) + r + ' violates the data validation rules set on this cell. (fake_gas: ' + sh.name + ', value ' + util.inspect(v) + ')');
  }
  function writeCell(sh, r, c, value) {
    const cell = cellFor(sh, r, c);
    const out = coerce(cell, value, sh.name + '!' + colLetters(c) + r);
    checkRule(sh, r, c, cell, out.v);
    cell.v = out.v;
    if (out.f) cell.f = true; else delete cell.f;
  }

  /* ------------------------------ executions ------------------------------ */

  function newExecution() {
    world.exec++;
    if (world.lock.held) { world.lock.leaked++; world.lock.held = false; }   // a script lock never outlives its execution
    const E = { id: world.exec };

    function makeRange(sh, row, col, nr, nc) {
      int(row, 'the row of a range', 1); int(col, 'the column of a range', 1);
      int(nr, 'the number of rows of a range', 1); int(nc, 'the number of columns of a range', 1);
      if (row + nr - 1 > sh.maxRows || col + nc - 1 > sh.maxCols) {
        throw new Error('The coordinates of the range are outside the dimensions of the sheet. (fake_gas: ' + sh.name + ' has ' + sh.maxRows + ' rows and ' +
          sh.maxCols + ' columns; asked for row ' + row + ', column ' + col + ', ' + nr + ' x ' + nc + '. Only appendRow grows a sheet by itself.)');
      }
      let R;
      const each = fn => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fn(row + i, col + j, i, j); };
      const need2d = (values, what) => {
        if (!Array.isArray(values) || !values.every(Array.isArray)) throw new Error('fake_gas: Range.' + what + ' needs a two-dimensional array');
        if (values.length !== nr) throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' + values.length + ' but the range has ' + nr + '.');
        values.forEach(v => {
          if (v.length !== nc) throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' + v.length + ' but the range has ' + nc + '.');
        });
      };
      const raw = () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const line = [];
          for (let j = 0; j < nc; j++) { const cell = cellOf(sh, row + i, col + j); line.push(cell ? cell.v : ''); }
          out.push(line);
        }
        return out;
      };
      R = strict('Range', {
        getValues() { return E.toRealm(raw()); },
        getValue() { return E.toRealm(raw())[0][0]; },
        setValues(values) { need2d(values, 'setValues'); each((r, c, i, j) => writeCell(sh, r, c, values[i][j])); return R; },
        setValue(value) { each((r, c) => writeCell(sh, r, c, value)); return R; },
        setFormulas(formulas) {
          need2d(formulas, 'setFormulas');
          each((r, c, i, j) => {
            const f = formulas[i][j];
            if (typeof f !== 'string') throw new Error('fake_gas: Range.setFormulas needs strings');
            const cell = cellFor(sh, r, c);
            cell.v = f;
            if (f.charAt(0) === '=') cell.f = true; else delete cell.f;
          });
          return R;
        },
        setNumberFormat(format) {
          if (typeof format !== 'string' || !format) throw new Error('fake_gas: Range.setNumberFormat needs a format string');
          each((r, c) => { cellFor(sh, r, c).fmt = format; });
          return R;
        },
        setFontWeight(weight) {
          if (weight !== 'bold' && weight !== 'normal' && weight !== null) throw new Error('fake_gas: Range.setFontWeight takes "bold", "normal" or null');
          each((r, c) => { const cell = cellFor(sh, r, c); if (weight === 'bold') cell.bold = true; else delete cell.bold; });
          return R;
        },
        setFontSize(size) { int(size, 'a font size', 1); each((r, c) => { cellFor(sh, r, c).size = size; }); return R; },
        setDataValidation(rule) {
          if (rule !== null && !RULES.has(rule)) throw new Error('fake_gas: Range.setDataValidation takes the rule that DataValidationBuilder.build() returned, or null');
          each((r, c) => { const cell = cellFor(sh, r, c); if (rule === null) delete cell.dv; else cell.dv = RULES.get(rule); });
          return R;
        },
        setNote(note) {
          if (typeof note !== 'string') throw new Error('fake_gas: Range.setNote takes a string');
          each((r, c) => { const cell = cellFor(sh, r, c); if (note === '') delete cell.note; else cell.note = note; });
          return R;
        },
        insertCheckboxes() {                             // the real one: a tick-box rule AND the value FALSE in every cell
          const rule = Object.freeze({ type: 'checkbox', allowInvalid: true, helpText: '' });
          each((r, c) => { const cell = cellFor(sh, r, c); cell.dv = rule; cell.v = false; delete cell.f; });
          return R;
        },
        getSheet() { return sheetObject(sh); },
        getRow() { return row; },
        getColumn() { return col; }
      }, { sheet: sh.name, row, col, rows: nr, cols: nc });
      RANGES.set(R, { sh, row, col, nr, nc });
      return R;
    }

    const sheetObjects = new Map();
    function sheetObject(sh) {
      if (sheetObjects.has(sh)) return sheetObjects.get(sh);
      const alive = () => { if (world.book.sheets.get(sh.name) !== sh) throw new Error('fake_gas: the sheet "' + sh.name + '" was deleted'); };
      let S;
      S = strict('Sheet', {
        getName() { return sh.name; },
        getSheetId() { return sh.id; },
        getLastRow() { alive(); return lastRow(sh); },
        getLastColumn() { alive(); return lastCol(sh); },
        getMaxRows() { alive(); return sh.maxRows; },
        getMaxColumns() { alive(); return sh.maxCols; },
        insertColumnsAfter(after, howMany) {
          alive();
          int(after, 'insertColumnsAfter position', 1); int(howMany, 'insertColumnsAfter count', 1);
          if (after !== sh.maxCols) throw new Error('fake_gas: Sheet.insertColumnsAfter is modelled after the last column only (' + sh.maxCols + '), got ' + after);
          sh.maxCols += howMany;
          return S;
        },
        insertRowsAfter(after, howMany) {
          alive();
          int(after, 'insertRowsAfter position', 1); int(howMany, 'insertRowsAfter count', 1);
          if (after > sh.maxRows) throw new Error('fake_gas: Sheet.insertRowsAfter(' + after + ') is below the last row of ' + sh.name + ' (' + sh.maxRows + ')');
          growRows(sh, after, howMany);
          return S;
        },
        getRange(a, b, c, d) {
          alive();
          if (typeof a === 'string') {
            if (arguments.length !== 1) throw new Error('fake_gas: Sheet.getRange(a1Notation) takes one argument');
            let m = /^([A-Z]+):([A-Z]+)$/.exec(a);
            if (m && colIndex(m[2]) >= colIndex(m[1])) return makeRange(sh, 1, colIndex(m[1]), sh.maxRows, colIndex(m[2]) - colIndex(m[1]) + 1);
            m = /^([A-Z]+)([1-9]\d*)$/.exec(a);
            if (m) return makeRange(sh, Number(m[2]), colIndex(m[1]), 1, 1);
            throw new Error('fake_gas: Sheet.getRange("' + a + '") is not modelled (only the forms "A:A" and "A1")');
          }
          if (arguments.length < 2 || arguments.length > 4) throw new Error('fake_gas: Sheet.getRange takes (row, column[, numRows[, numColumns]])');
          return makeRange(sh, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
        },
        getDataRange() { alive(); return makeRange(sh, 1, 1, Math.max(1, lastRow(sh)), Math.max(1, lastCol(sh))); },
        appendRow(contents) {
          alive();
          if (!Array.isArray(contents)) throw new Error('fake_gas: Sheet.appendRow takes an array');
          if (contents.length > sh.maxCols) throw new Error('fake_gas: Sheet.appendRow with ' + contents.length + ' values on ' + sh.name + ', which has ' + sh.maxCols + ' columns, is not modelled');
          const r = lastRow(sh) + 1;
          if (r > sh.maxRows) growRows(sh, sh.maxRows, r - sh.maxRows);
          contents.forEach((v, i) => writeCell(sh, r, i + 1, v));
          return S;
        },
        deleteRow(position) {
          alive();
          int(position, 'deleteRow position', 1);
          if (position > sh.maxRows) throw new Error('fake_gas: Sheet.deleteRow(' + position + ') is below the last row of ' + sh.name);
          removeRow(sh, position);
          return S;
        },
        clear() {                                      // contents and formats (conditional formats are formats); data-validation rules and notes stay
          alive();
          sh.cells.forEach((cell, k) => {
            cell.v = ''; delete cell.f; delete cell.fmt; delete cell.bold; delete cell.size;
            if (!cell.dv && cell.note === undefined) sh.cells.delete(k);
          });
          sh.cfRules = [];
          return S;
        },
        clearContents() { alive(); sh.cells.forEach(cell => { cell.v = ''; delete cell.f; }); return S; },
        setFrozenRows(rows) { alive(); sh.frozenRows = int(rows, 'setFrozenRows', 0); return S; },
        hideSheet() { alive(); sh.hidden = true; return S; },
        setColumnWidth(column, width) { alive(); int(column, 'setColumnWidth column', 1); int(width, 'setColumnWidth width', 1); sh.colWidths[column] = width; return S; },
        getProtections(type) {
          alive();
          if (type !== 'SHEET' && type !== 'RANGE') throw new Error('fake_gas: Sheet.getProtections takes SpreadsheetApp.ProtectionType.SHEET or .RANGE');
          return sh.protections.filter(p => p.type === type).map(p => p.object);
        },
        protect() {
          alive();
          const data = { type: 'SHEET', description: '', warningOnly: false };
          let P;
          P = strict('Protection', {
            setDescription(text) { data.description = String(text); return P; },
            setWarningOnly(flag) { data.warningOnly = !!flag; return P; }
          }, { sheet: sh.name });
          data.object = P;
          sh.protections.push(data);
          return P;
        },
        setConditionalFormatRules(rules) {
          alive();
          if (!Array.isArray(rules) || !rules.every(r => CF_RULES.has(r))) throw new Error('fake_gas: Sheet.setConditionalFormatRules takes an array of the rules that ConditionalFormatRuleBuilder.build() returned');
          sh.cfRules = rules.map(r => ({ object: r, data: CF_RULES.get(r) }));
          return S;
        },
        getConditionalFormatRules() { alive(); return sh.cfRules.map(r => r.object); }
      }, { sheet: sh.name });
      sheetObjects.set(sh, S);
      return S;
    }

    const spreadsheet = strict('Spreadsheet', {
      getSheetByName(name) { const sh = world.book.sheets.get(String(name)); return sh ? sheetObject(sh) : null; },
      insertSheet(name) {
        if (typeof name !== 'string' || !name) throw new Error('fake_gas: Spreadsheet.insertSheet is modelled with a name only');
        if (world.book.sheets.has(name)) throw new Error('A sheet with the name "' + name + '" already exists. Please enter another name.');
        const sh = newSheet(name);
        world.book.sheets.set(name, sh);
        return sheetObject(sh);
      },
      setSpreadsheetTimeZone(tz) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (err) { throw new Error('fake_gas: unknown time zone ' + tz); }
        world.book.timeZone = tz;
      },
      getId() { return world.book.id; },
      getUrl() { return 'https://docs.google.com/spreadsheets/d/' + world.book.id + '/edit'; }
    });
    E.spreadsheet = spreadsheet;
    E.range = (sh, row, col, nr, nc) => makeRange(sh, row, col, nr, nc);

    function validationBuilder() {
      const data = { type: '', values: null, showDropdown: true, formula: '', allowInvalid: true, helpText: '' };   // real default: invalid input is allowed with a warning
      let B;
      B = strict('DataValidationBuilder', {
        requireValueInList(values, showDropdown) {
          if (!Array.isArray(values) || !values.length || !values.every(v => typeof v === 'string' && v !== '')) throw new Error('fake_gas: DataValidationBuilder.requireValueInList takes a non-empty array of strings');
          if (showDropdown !== undefined && typeof showDropdown !== 'boolean') throw new Error('fake_gas: DataValidationBuilder.requireValueInList(values, showDropdown): showDropdown is a boolean');
          data.type = 'list'; data.values = values.slice(); data.showDropdown = showDropdown !== false;
          return B;
        },
        requireCheckbox() {
          if (arguments.length) throw new Error('fake_gas: DataValidationBuilder.requireCheckbox with custom values is not modelled');
          data.type = 'checkbox';
          return B;
        },
        requireFormulaSatisfied(formula) {
          if (typeof formula !== 'string' || formula.charAt(0) !== '=') throw new Error('fake_gas: DataValidationBuilder.requireFormulaSatisfied takes a formula that starts with "="');
          data.type = 'formula'; data.formula = formula;
          return B;
        },
        setAllowInvalid(allow) {
          if (typeof allow !== 'boolean') throw new Error('fake_gas: DataValidationBuilder.setAllowInvalid takes a boolean');
          data.allowInvalid = allow;
          return B;
        },
        setHelpText(text) { data.helpText = String(text); return B; },
        build() {
          if (!data.type) throw new Error('fake_gas: DataValidationBuilder.build() before any require...() call');
          const rule = strict('DataValidation', {});
          RULES.set(rule, Object.freeze({ type: data.type, values: data.values ? Object.freeze(data.values.slice()) : null, showDropdown: data.showDropdown,
                                          formula: data.formula, allowInvalid: data.allowInvalid, helpText: data.helpText }));
          return rule;
        }
      });
      return B;
    }
    function conditionalBuilder() {
      const data = { formula: '', background: '', fontColor: '', ranges: [] };
      let B;
      B = strict('ConditionalFormatRuleBuilder', {
        whenFormulaSatisfied(formula) {
          if (typeof formula !== 'string' || formula.charAt(0) !== '=') throw new Error('fake_gas: ConditionalFormatRuleBuilder.whenFormulaSatisfied takes a formula that starts with "="');
          data.formula = formula;
          return B;
        },
        setBackground(color) {
          if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(String(color))) throw new Error('fake_gas: ConditionalFormatRuleBuilder.setBackground is modelled with "#rrggbb" or null');
          data.background = color || '';
          return B;
        },
        setFontColor(color) {
          if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(String(color))) throw new Error('fake_gas: ConditionalFormatRuleBuilder.setFontColor is modelled with "#rrggbb" or null');
          data.fontColor = color || '';
          return B;
        },
        setRanges(ranges) {
          if (!Array.isArray(ranges) || !ranges.length || !ranges.every(r => RANGES.has(r))) throw new Error('fake_gas: ConditionalFormatRuleBuilder.setRanges takes an array of ranges');
          data.ranges = ranges.map(r => { const x = RANGES.get(r); return { sheet: x.sh.name, row: x.row, col: x.col, rows: x.nr, cols: x.nc }; });
          return B;
        },
        build() {
          if (!data.formula) throw new Error('fake_gas: ConditionalFormatRuleBuilder.build() without a condition');
          if (!data.ranges.length) throw new Error('fake_gas: ConditionalFormatRuleBuilder.build() without setRanges()');
          if (!data.background && !data.fontColor) throw new Error('fake_gas: ConditionalFormatRuleBuilder.build() without a format');
          const rule = strict('ConditionalFormatRule', {});
          CF_RULES.set(rule, Object.freeze({ formula: data.formula, background: data.background, fontColor: data.fontColor, ranges: Object.freeze(data.ranges.slice()) }));
          return rule;
        }
      });
      return B;
    }

    const lock = strict('Lock', {
      waitLock(ms) {
        int(ms, 'waitLock milliseconds', 1);
        world.lock.waits.push(ms);
        if (world.lock.busy) throw new Error('Exception: Lock timeout: another process was holding the lock for too long.');
        if (world.lock.held) { world.lock.nested++; return; }            // not counted: a second acquire does nothing
        world.lock.held = true;
        world.lock.acquires++;
      },
      releaseLock() {
        if (!world.lock.held) { world.lock.strayReleases++; return; }
        world.lock.held = false;                                          // the FIRST release frees it
        world.lock.releases++;
      }
    });
    const properties = strict('Properties', {
      getProperty(key) { return Object.prototype.hasOwnProperty.call(world.props, key) ? world.props[key] : null; },
      setProperty(key, value) {
        if (typeof key !== 'string' || typeof value !== 'string') throw new Error('fake_gas: Properties.setProperty takes two strings, got ' + typeof key + ' and ' + typeof value);
        world.props[key] = value;
        return properties;
      }
    });
    const cache = strict('Cache', {
      get(key) {
        const e = world.cache[String(key)];
        if (!e) return null;
        if (e.exp <= Date.now()) { delete world.cache[String(key)]; return null; }
        return e.v;
      },
      put(key, value, ttl) {
        if (typeof key !== 'string' || typeof value !== 'string') throw new Error('fake_gas: Cache.put takes a string key and a string value, got ' + typeof key + ' and ' + typeof value);
        if (key.length > 250) throw new Error('Argument too large: key');
        if (value.length > 100000) throw new Error('Argument too large: value');
        if (ttl !== undefined) { int(ttl, 'Cache.put expiration', 1); if (ttl > 21600) throw new Error('fake_gas: Cache.put expiration above 21600 seconds'); }
        world.cache[key] = { v: value, exp: Date.now() + (ttl === undefined ? 600 : ttl) * 1000 };
      },
      remove(key) { delete world.cache[String(key)]; }
    });

    function formatDate(date, tz, format) {
      if (!isDate(date) || isNaN(date.getTime())) throw new Error('fake_gas: Utilities.formatDate needs a valid Date');
      if (typeof tz !== 'string' || typeof format !== 'string') throw new Error('fake_gas: Utilities.formatDate(date, timeZone, format) takes two strings');
      const p = zoneParts(tz, date.getTime()), two = n => (n < 10 ? '0' : '') + n;
      return format.replace(/'[^']*'|[A-Za-z]+/g, tok => {
        if (tok.charAt(0) === "'") return tok.slice(1, -1);
        switch (tok) {
          case 'yyyy': return String(p.year);
          case 'MM': return two(p.month);
          case 'M': return String(p.month);
          case 'dd': return two(p.day);
          case 'd': return String(p.day);
          case 'HH': return two(p.hour);
          case 'mm': return two(p.minute);
          case 'ss': return two(p.second);
          default: throw new Error('fake_gas: Utilities.formatDate pattern "' + tok + '" is not modelled');
        }
      });
    }
    function uuid() {                                    // deterministic: a failing run can be repeated
      const hex = [];
      for (let i = 0; i < 32; i++) {
        world.seed = (world.seed + 0x6d2b79f5) | 0;
        let t = Math.imul(world.seed ^ (world.seed >>> 15), 1 | world.seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        hex.push((((t ^ (t >>> 14)) >>> 0) % 16).toString(16));
      }
      hex[12] = '4';
      hex[16] = '89ab'.charAt(parseInt(hex[16], 16) % 4);
      const s = hex.join('');
      return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
    }

    const output = (cls, kind, text) => {
      const data = { kind, body: String(text), mime: kind === 'html' ? 'text/html' : 'text/plain' };
      let O;
      const members = {};
      if (cls === 'TextOutput') {
        members.setMimeType = function (mime) {
          if (mime !== 'JSON') throw new Error('fake_gas: TextOutput.setMimeType is modelled with ContentService.MimeType.JSON only');
          data.mime = 'application/json'; data.kind = 'json';
          return O;
        };
      }
      O = strict(cls, members);
      OUTPUTS.set(O, data);
      return O;
    };

    const sandbox = {
      SpreadsheetApp: strict('SpreadsheetApp', {
        getActiveSpreadsheet() { return world.bound ? spreadsheet : null; },
        openById(id) {
          if (id !== world.book.id) throw new Error('fake_gas: SpreadsheetApp.openById("' + id + '"): no such spreadsheet');
          return spreadsheet;
        },
        flush() { world.flushes++; },
        ProtectionType: strict('ProtectionType', { SHEET: 'SHEET', RANGE: 'RANGE' }),
        newDataValidation() { return validationBuilder(); },
        newConditionalFormatRule() { return conditionalBuilder(); }
      }),
      LockService: strict('LockService', { getScriptLock() { return lock; } }),
      PropertiesService: strict('PropertiesService', { getScriptProperties() { return properties; } }),
      CacheService: strict('CacheService', { getScriptCache() { return cache; } }),
      Utilities: strict('Utilities', {
        getUuid() { return uuid(); },
        computeDigest(algorithm, value, charset) {
          if (algorithm !== 'SHA_256') throw new Error('fake_gas: Utilities.computeDigest is modelled with DigestAlgorithm.SHA_256 only');
          if (typeof value !== 'string') throw new Error('fake_gas: Utilities.computeDigest is modelled with a string value only');
          if (charset !== undefined && charset !== 'UTF_8') throw new Error('fake_gas: Utilities.computeDigest is modelled with Charset.UTF_8 only');
          return Array.from(crypto.createHash('sha256').update(value, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b));   // signed bytes, as Apps Script
        },
        DigestAlgorithm: strict('DigestAlgorithm', { SHA_256: 'SHA_256' }),
        Charset: strict('Charset', { UTF_8: 'UTF_8' }),
        formatDate(date, tz, format) { return formatDate(date, tz, format); }
      }),
      Logger: strict('Logger', { log(line) { world.loggerLines.push(String(line)); } }),
      HtmlService: strict('HtmlService', { createHtmlOutput(html) { return output('HtmlOutput', 'html', html); } }),
      ContentService: strict('ContentService', {
        createTextOutput(text) { return output('TextOutput', 'text', text === undefined ? '' : text); },
        MimeType: strict('MimeType', { JSON: 'JSON' })
      }),
      UrlFetchApp: strict('UrlFetchApp', {}),
      DriveApp: strict('DriveApp', {}),
      ScriptApp: strict('ScriptApp', {})
    };
    const ctx = vm.createContext(sandbox);
    // Values handed to the code are made of the execution's own Array and Date, so `v instanceof Date` in
    // gas_store.js is true for a date cell exactly as in Apps Script.
    E.toRealm = vm.runInContext('(function (rows) {\n' +
      '  var out = [];\n' +
      '  for (var i = 0; i < rows.length; i++) {\n' +
      '    var line = [];\n' +
      '    for (var j = 0; j < rows[i].length; j++) { var v = rows[i][j]; line.push(v !== null && typeof v === "object" ? new Date(v.ms) : v); }\n' +
      '    out.push(line);\n' +
      '  }\n' +
      '  return out;\n' +
      '})', ctx);
    script.runInContext(ctx);
    ctx.__fakeExecution = E;
    return ctx;
  }

  /* ------------------------------ what a test looks at ------------------------------ */

  function a1(r) { return colLetters(r.col) + r.row + (r.rows > 1 || r.cols > 1 ? ':' + colLetters(r.col + r.cols - 1) + (r.row + r.rows - 1) : ''); }
  function view(v) { return v instanceof CellDate ? new Date(v.ms) : v; }
  function sheetView(name) {
    const sh = world.book.sheets.get(name);
    if (!sh) return null;
    const api = {
      name,
      get maxRows() { return sh.maxRows; },
      get maxCols() { return sh.maxCols; },
      get hidden() { return sh.hidden; },
      get frozenRows() { return sh.frozenRows; },
      lastRow: () => lastRow(sh),
      lastCol: () => lastCol(sh),
      value: (r, c) => { const cell = cellOf(sh, r, c); return cell ? view(cell.v) : ''; },
      isFormula: (r, c) => { const cell = cellOf(sh, r, c); return !!(cell && cell.f); },
      format: (r, c) => { const cell = cellOf(sh, r, c); return cell && cell.fmt !== undefined ? cell.fmt : ''; },
      validation: (r, c) => { const cell = cellOf(sh, r, c); return cell && cell.dv ? cell.dv : null; },
      note: (r, c) => { const cell = cellOf(sh, r, c); return cell && cell.note !== undefined ? cell.note : ''; },
      bold: (r, c) => { const cell = cellOf(sh, r, c); return !!(cell && cell.bold); },
      /** Rows 1..lastRow, columns 1..lastCol, as stored (a formula as its text, a date as a Date). */
      values: () => {
        const nr = lastRow(sh), nc = lastCol(sh), out = [];
        for (let r = 1; r <= nr; r++) { const line = []; for (let c = 1; c <= nc; c++) line.push(api.value(r, c)); out.push(line); }
        return out;
      },
      /** The rows as objects keyed by the header row, each with its sheet row (_row); fully blank rows are left out. */
      rows: () => {
        const v = api.values(), header = v[0] || [], out = [];
        for (let r = 1; r < v.length; r++) {
          if (v[r].every(isBlank)) continue;
          const o = { _row: r + 1 };
          header.forEach((h, c) => { if (h !== '') o[String(h)] = v[r][c]; });
          out.push(o);
        }
        return out;
      },
      header: () => (api.values()[0] || []).map(String),
      column: title => api.header().indexOf(title) + 1,
      /** How many cells carry a data-validation rule (optionally of one type). */
      validations: type => { let n = 0; sh.cells.forEach(cell => { if (cell.dv && (!type || cell.dv.type === type)) n++; }); return n; },
      rules: () => sh.cfRules.map(r => ({ formula: r.data.formula, background: r.data.background, fontColor: r.data.fontColor, ranges: r.data.ranges.map(a1) })),
      protections: () => sh.protections.map(p => ({ type: p.type, description: p.description, warningOnly: p.warningOnly })),
      /** Everything the sheet holds, as one string: two equal dumps mean nothing changed. */
      dump: () => {
        const keys = Array.from(sh.cells.keys()).sort((x, y) => x - y), cells = [];
        keys.forEach(k => {
          const cell = sh.cells.get(k), v = cell.v instanceof CellDate ? { date: cell.v.ms } : cell.v;
          if (isBlank(cell.v) && cell.fmt === undefined && !cell.dv && cell.note === undefined && !cell.bold && cell.size === undefined) return;
          cells.push([Math.floor(k / KEY), k % KEY, v, cell.f ? 1 : 0, cell.fmt === undefined ? '' : cell.fmt, cell.dv ? cell.dv : 0, cell.note === undefined ? '' : cell.note, cell.bold ? 1 : 0, cell.size || 0]);
        });
        return JSON.stringify({ maxRows: sh.maxRows, maxCols: sh.maxCols, frozenRows: sh.frozenRows, hidden: sh.hidden, colWidths: sh.colWidths,
                                protections: api.protections(), rules: api.rules(), cells });
      }
    };
    return api;
  }

  /* ------------------------------ what a person does in the Sheet ------------------------------ */

  function need(name) {
    const sh = world.book.sheets.get(name);
    if (!sh) throw new Error('fake_gas: no sheet "' + name + '"');
    return sh;
  }
  /** Fire the simple trigger for a hand edit: a new execution, onEdit(e) when the project has one. An error inside it is swallowed, as Google does, and returned. */
  function fireOnEdit(sh, row, col, value, oldValue) {
    const from = world.log.length;
    if (!world.bound) return { ctx: null, from, fired: false, error: null, calls: [] };   // a standalone project has no simple triggers
    const ctx = newExecution();
    const result = { ctx, from, fired: false, error: null, calls: [] };
    if (typeof ctx.onEdit !== 'function') return result;
    result.fired = true;
    const E = ctx.__fakeExecution;
    const range = E.range(sh, row, col, 1, 1);
    result.from = world.log.length;
    try { ctx.onEdit({ authMode: 'LIMITED', range, source: E.spreadsheet, value: value === '' ? undefined : String(value), oldValue }); } catch (err) { result.error = err; }
    result.calls = world.log.slice(result.from);
    return result;
  }
  const hand = {
    /**
     * Type a value into one cell, as a person does: Sheets reads the text (rule b) and a rule that rejects
     * invalid input refuses it (this throws). Then the simple trigger runs, unless opts.trigger === false
     * (a row typed before this version was published, or a standalone copy where nothing fires).
     * Returns {ctx, fired, error, calls}: the trigger's execution and the calls it made.
     */
    type(name, row, col, value, opts) {
      const sh = need(name);
      if (row > sh.maxRows || col > sh.maxCols) throw new Error('fake_gas: hand.type outside the grid of ' + name);
      const cell = cellOf(sh, row, col), old = cell ? view(cell.v) : '';
      writeCell(sh, row, col, value);
      if (opts && opts.trigger === false) return { ctx: null, fired: false, error: null, calls: [] };
      return fireOnEdit(sh, row, col, value, isBlank(old) ? undefined : old);
    },
    /** Tick or untick a box: the cell takes the boolean. */
    tick(name, row, col, checked, opts) { return hand.type(name, row, col, !!checked, opts); },
    /** Delete a whole row. Google fires no onEdit for it. */
    deleteRow(name, row) { removeRow(need(name), row); },
    /** Delete a tab. */
    deleteSheet(name) { need(name); world.book.sheets.delete(name); },
    /** Delete the empty rows at the bottom, as tidy people do: the grid ends `spare` rows below the last used row. */
    trimRows(name, spare) { const sh = need(name); sh.maxRows = Math.max(1, lastRow(sh) + (spare || 0)); sh.cells.forEach((cell, k) => { if (Math.floor(k / KEY) > sh.maxRows) sh.cells.delete(k); }); },
    /** The same for the empty columns at the right (round 5, a test-side action, not a modelled member): the grid ends `spare` columns right of the last used column. */
    trimCols(name, spare) { const sh = need(name); sh.maxCols = Math.max(1, lastCol(sh) + (spare || 0)); sh.cells.forEach((cell, k) => { if (k % KEY > sh.maxCols) sh.cells.delete(k); }); },
    /** Format > Number > Automatic on one cell. */
    clearFormat(name, row, col) { const cell = cellOf(need(name), row, col); if (cell) delete cell.fmt; },
    /** Put a value into a cell exactly as given, with no reading of the text (a state the test wants to start from). */
    setRaw(name, row, col, value) { const cell = cellFor(need(name), row, col); cell.v = isDate(value) ? new CellDate(value.getTime()) : value; delete cell.f; }
  };

  return {
    members: FAKE_GAS_MEMBERS,
    newExecution,
    hand,
    sheet: sheetView,
    sheetNames: () => Array.from(world.book.sheets.keys()),
    get log() { return world.log; },
    /** The calls logged since log index `from`, optionally filtered. */
    calls: (from, filter) => world.log.slice(from || 0).filter(filter || (() => true)),
    /**
     * Make one future call fail, as a Google service sometimes does: the first call whose log entry
     * (call, sheet, row, col, rows, cols, arg, held) satisfies match throws an Error with that message instead
     * of doing its work. The fault is used up by that call. A test uses it to see where the code lets an
     * error through and where it catches it.
     */
    failNext(match, message) {
      if (typeof match !== 'function') throw new Error('fake_gas: failNext(match, message) takes a function over a log entry');
      world.faults.push({ match, message: String(message || 'Service error: the call failed (fake_gas.failNext)') });
    },
    /** How many failures asked for with failNext have not happened yet. */
    get faultsLeft() { return world.faults.length; },
    lock: world.lock,
    props: world.props,
    cache: world.cache,
    get flushes() { return world.flushes; },
    get loggerLines() { return world.loggerLines; },
    get executions() { return world.exec; },
    get timeZone() { return world.book.timeZone; },
    spreadsheetId: world.book.id,
    /** A standalone project (made at script.google.com): getActiveSpreadsheet() returns null. */
    setBound(flag) { world.bound = !!flag; },
    /** What doPost returned: {kind: 'html' | 'json' | 'text', body, mime}. */
    reply: out => { const d = OUTPUTS.get(out); return d ? { kind: d.kind, body: d.body, mime: d.mime } : null; }
  };
}

module.exports = { createFakeGas, FAKE_GAS_MEMBERS, fakeGasMembersOf };
