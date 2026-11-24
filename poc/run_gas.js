/**
 * poc/run_gas.js — the Google glue (apps-script/gas_*.js) run in Node as it runs in production: the real
 * setupSheet, gasStore, script lock, doPost, sync handler and onEdit, over poc/fake_gas.js, a strict stand-in
 * for the Apps Script services (docs/design-round-4/SPEC-round-4.md sections 1.5 and 12).
 *
 *   node poc/run_gas.js
 *   RUN_GAS_BOT_FROM=<folder> node poc/run_gas.js    takes core_bot.js and core_orders.js from that folder
 *                                                   (a copy of the project while those two are being edited)
 *
 * The bundle is joined in memory from the file list of tools/bundle_gas.js; nothing is written to disk.
 * Every simulated request and every hand edit is a new execution (a fresh vm context over the same fake
 * spreadsheet, Script Properties and cache), because production keeps no variable between two requests.
 * Telegram is the one thing replaced inside an execution: gasChat becomes a recorder.
 * What the fake cannot show: formulas are never evaluated (the Dashboard checks compare formula TEXT, and one
 * check evaluates the account formulas with a small SUMIFS reader of its own), and nothing here proves that a
 * call behaves in Google Sheets as the fake assumes; the fake's header lists what it assumes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createFakeGas, FAKE_GAS_MEMBERS, fakeGasMembersOf } = require('./fake_gas.js');

const ROOT = path.join(__dirname, '..');
const BOT_FROM = process.env.RUN_GAS_BOT_FROM ? path.resolve(process.env.RUN_GAS_BOT_FROM) : '';
const BOT_FILES = ['core_bot.js', 'core_orders.js'];

let pass = 0, fail = 0;
function check(cond, label, detail) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✘ ' + label + (detail === undefined ? '' : ' | got: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); }
}
const step = title => console.log('\n── ' + title);
/** One group of checks. An exception inside it is a failed check, not the end of the run. */
function section(title, fn) {
  step(title);
  try { fn(); } catch (err) {
    check(false, 'this group of checks ran to its end', err && err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : String(err));
  }
}
function finish() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

/* ------------------------------ the bundle ------------------------------ */

/** The file list of tools/bundle_gas.js, read from its source (requiring that file would write dist/Code.gs). */
function bundleFileList() {
  const text = fs.readFileSync(path.join(ROOT, 'tools', 'bundle_gas.js'), 'utf8');
  const m = /const FILES = (\[[\s\S]*?\]);/.exec(text);
  if (!m) throw new Error('tools/bundle_gas.js: the FILES list was not found');
  const files = Array.from(vm.runInNewContext('(' + m[1] + ')'));
  if (!files.length || !files.every(f => typeof f === 'string' && /^[\w.-]+\.js$/.test(f))) throw new Error('tools/bundle_gas.js: FILES is not a list of file names');
  return files;
}

let FILES = [], BUNDLE = '';
const SOURCES = {};
try {
  FILES = bundleFileList();
  FILES.forEach(f => {
    const dir = BOT_FROM && BOT_FILES.indexOf(f) >= 0 ? BOT_FROM : path.join(ROOT, 'apps-script');
    SOURCES[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  });
  BUNDLE = FILES.map(f => '/* ===== ' + f + ' ===== */\n' + SOURCES[f].trim() + '\n').join('\n');
} catch (err) {
  console.log('poc/run_gas.js: the bundle cannot be built' + (BOT_FROM ? ' (RUN_GAS_BOT_FROM = ' + BOT_FROM + ')' : ''));
  check(false, 'every file named in tools/bundle_gas.js can be read', err && err.message ? err.message : String(err));
  finish();
}

console.log('poc/run_gas.js: ' + FILES.length + ' files, ' + Math.round(BUNDLE.length / 1024) + ' KB' +
  (BOT_FROM ? '; ' + BOT_FILES.join(' and ') + ' from ' + BOT_FROM : '; every file from apps-script/'));

section('0. The bundle: the file list of tools/bundle_gas.js, joined in memory', () => {
  const broken = [];
  FILES.forEach(f => { try { new vm.Script(SOURCES[f], { filename: f }); } catch (err) { broken.push(f + ': ' + err.message); } });
  check(FILES.length >= 17 && FILES[0] === 'core_config.js' && FILES[FILES.length - 1] === 'gas_main.js' &&
    ['gas_store.js', 'gas_setup.js', 'gas_sync.js', 'gas_main.js'].every(f => FILES.indexOf(f) > FILES.indexOf('core_orders.js')),
    'the list has the core files first and the four glue files after them (' + FILES.length + ' files)', FILES);
  check(broken.length === 0, 'every file of the bundle parses', broken);
  if (broken.length) {
    console.log('\n  The bundle cannot be loaded, so no other check can run.' + (BOT_FROM ? '' : ' If core_bot.js or core_orders.js is being edited, set RUN_GAS_BOT_FROM.'));
    finish();
  }
  // The script lock has one holder: "LockService.<member>" (a use in code) appears once in all the files together.
  const uses = [];
  FILES.forEach(f => { (SOURCES[f].match(/\bLockService\.\w+/g) || []).forEach(u => uses.push(f + ': ' + u)); });
  check(uses.length === 1 && uses[0] === 'gas_main.js: LockService.getScriptLock', 'LockService is called in exactly one place of the bundle, in gas_main.js', uses);
});

/* ------------------------------ helpers ------------------------------ */

const plain = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = o => { const out = {}; Object.keys(o).sort().forEach(k => { out[k] = o[k]; }); return out; };
function thrown(fn) { try { fn(); } catch (err) { return err || new Error('thrown'); } return null; }
const throwsWith = (fn, re) => { const err = thrown(fn); return !!err && re.test(String(err.message)); };

const books = [];                                      // every spreadsheet of this run that the end-of-run checks look at
function newBook(label, opts) {
  const fake = createFakeGas(Object.assign({ source: BUNDLE, filename: 'Code.gs' }, opts || {}));
  if (!opts || !opts.unchecked) books.push({ label, fake });
  return fake;
}
/** A spreadsheet on which setupSheet() ran once, as after the deployment steps of the README. */
function setupBook(label) {
  const fake = newBook(label);
  fake.newExecution().setupSheet();
  return fake;
}

const lockSnap = fake => ({ acquires: fake.lock.acquires, nested: fake.lock.nested, releases: fake.lock.releases, stray: fake.lock.strayReleases, waits: fake.lock.waits.length });
/** Run fn and report what it did to the script lock and which calls it made on the fakes. */
function locked(fake, fn) {
  const s = lockSnap(fake), from = fake.log.length;
  let out, error = null;
  try { out = fn(); } catch (err) { error = err || new Error('thrown'); }
  return {
    out, error, calls: fake.calls(from),
    acquires: fake.lock.acquires - s.acquires, nested: fake.lock.nested - s.nested, releases: fake.lock.releases - s.releases,
    stray: fake.lock.strayReleases - s.stray, waits: fake.lock.waits.slice(s.waits), held: fake.lock.held
  };
}
/** The lock was taken exactly once, with that wait time, never while held, and is free again. */
const once = (d, ms) => d.acquires === 1 && d.releases === 1 && d.nested === 0 && d.stray === 0 && !d.held && d.waits.length === 1 && d.waits[0] === ms;
const lockOf = d => ({ acquires: d.acquires, releases: d.releases, nested: d.nested, stray: d.stray, held: d.held, waits: d.waits, error: d.error ? String(d.error.message) : null });
const valueWrites = (calls, sheet) => calls.filter(c => c.write === 'value' && (!sheet || c.sheet === sheet));
const allHeld = list => list.length > 0 && list.every(c => c.held);
const touches = (calls, sheet) => calls.filter(c => c.sheet === sheet).length;
const dashRewrites = calls => calls.filter(c => c.call === 'Sheet.clear' && c.sheet === 'Dashboard').length;
const serviceCalls = calls => calls.map(c => c.call);

/**
 * Telegram inside one execution: every gasChat call is recorded and answered with a message id. With the fake
 * given, each record also keeps `at`, the position of the fake's call log when the message went out.
 */
function recordTelegram(x, fake) {
  const sent = [];
  x.gasChat = new Proxy({}, {
    get(t, prop) {
      if (typeof prop === 'symbol') return undefined;
      return function () { sent.push({ method: String(prop), args: Array.from(arguments), at: fake ? fake.log.length : -1 }); return { messageId: sent.length }; };
    }
  });
  return sent;
}
/** One web request: a new execution, doPost(e), the reply as the caller sees it. prepare(x) runs before doPost. */
function request(fake, parameter, body, prepare) {
  const x = fake.newExecution();
  const sent = recordTelegram(x, fake);
  if (prepare) prepare(x);
  const d = locked(fake, () => x.doPost({ parameter: parameter || {}, postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }));
  const reply = d.out ? fake.reply(d.out) : null;
  let json = null;
  if (reply && reply.kind === 'json') { try { json = JSON.parse(reply.body); } catch (ignore) {} }
  return Object.assign(d, { x, sent, reply, json });
}

// The Lists tab as setupSheet() lays it out (CFG.LIST_COLS).
const LC = { List: 1, Key: 2, Label: 3, Active: 4, Order: 5, Shop: 6, Detail: 7, Note: 8 };
const lists = fake => fake.sheet('Lists');
const listRow = (fake, list, key) => lists(fake).rows().find(r => r.List === list && String(r.Key) === key) || null;
const listKeys = (fake, list) => lists(fake).rows().filter(r => r.List === list).map(r => String(r.Key));
const errorsOf = fake => (fake.sheet('Errors') ? fake.sheet('Errors').rows() : []);
const errorKinds = fake => errorsOf(fake).map(r => String(r.Where));

/** A hand edit that fires the simple trigger: what onEdit did (fired, error, calls) and what it did to the script lock. */
function edit(fake, tab, row, col, value) {
  let e = null;
  const d = locked(fake, () => { e = fake.hand.type(tab, row, col, value); });
  if (d.error) throw d.error;
  return Object.assign(d, { fired: e.fired, error: e.error, calls: e.calls });
}
/** Type a Settings value by hand (no trigger: the cell is as a person left it before the request under test). */
function setSetting(fake, key, value) {
  const row = fake.sheet('Settings').rows().find(r => r.Key === key);
  if (!row) throw new Error('no Settings row ' + key);
  fake.hand.type('Settings', row._row, 2, value, { trigger: false });
}
/** Type a whole row by hand below the last used row of a tab. Returns its row number. */
function typeRow(fake, tab, values, opts) {
  const r = fake.sheet(tab).lastRow() + 1;
  values.forEach((v, i) => { if (v !== '') fake.hand.type(tab, r, i + 1, v, opts || { trigger: false }); });
  return r;
}
const STAFF = { id: '1001', name: 'Sister', shop: 'S1', role: 'staff' };
function addStaff(fake) {
  typeRow(fake, 'Staff', ['1001', 'Sister', 'S1', 'staff', '']);
  typeRow(fake, 'Staff', ['1002', 'Brother', 'S2', 'staff', '']);
}

/* ------------------------------ what the spec says, written a second time ------------------------------ */

// The members poc/fake_gas.js models, as SPEC-round-4.md section 12 lists them. A change of the fake's own table
// shows up here.
const SPEC_MEMBERS = {
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
  Logger: ['log']
};
// What the fake has beyond that list, each a real Apps Script member the glue calls (or an object the list implies).
const ADDED_MEMBERS = {
  LockService: ['getScriptLock'], PropertiesService: ['getScriptProperties'], CacheService: ['getScriptCache'],
  HtmlService: ['createHtmlOutput'], HtmlOutput: [],
  ContentService: ['createTextOutput', 'MimeType'], TextOutput: ['setMimeType'],
  Sheet: ['insertRowsAfter'],
  ProtectionType: ['SHEET', 'RANGE'], DigestAlgorithm: ['SHA_256'], Charset: ['UTF_8'], MimeType: ['JSON'],
  UrlFetchApp: [], DriveApp: [], ScriptApp: [], DataValidation: [], ConditionalFormatRule: []
};

function letters(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function lettersIndex(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

/** The account formulas of spec section 1.5, written from the spec (not from gas_setup.js). */
function accountFormulas(CFG) {
  const L = name => { const c = letters(CFG.LEDGER_COLS.indexOf(name) + 1); return 'Ledger!$' + c + ':$' + c; };
  const mBase = KEY => L('Cash') + ',' + L('Day') + ',$D$2&"*",' + L('Method') + ',"' + String(KEY).replace(/"/g, '""') + '"';
  return {
    mIn(KEY) { const b = mBase(KEY); return 'SUMIFS(' + b + ',' + L('Cash') + ',">0",' + L('ReversesTxID') + ',"=")+SUMIFS(' + b + ',' + L('Cash') + ',"<0",' + L('ReversesTxID') + ',"<>")'; },
    mOut(KEY) { const b = mBase(KEY); return '-(SUMIFS(' + b + ',' + L('Cash') + ',"<0",' + L('ReversesTxID') + ',"=")+SUMIFS(' + b + ',' + L('Cash') + ',">0",' + L('ReversesTxID') + ',"<>"))'; }
  };
}

/**
 * A reader for the one formula shape of the account block: sums and differences of SUMIFS over whole Ledger
 * columns, with the criteria that block uses ($D$2&"*", "KEY", ">0", "<0", "=", "<>"). The fake keeps formulas as
 * text; this evaluates that text over the fake's Ledger cells the way Sheets documents SUMIFS (a text criterion
 * compares without case and knows * and ?, "=" is an empty cell, "<>" a cell that is not empty, a comparison
 * only matches numbers), so a check can say that the Dashboard would show what the bot's own report shows.
 */
function evalAccountFormula(fake, formula, env) {
  const ledger = fake.sheet('Ledger').values();
  const column = ref => {
    const m = /^Ledger!\$([A-Z]+):\$([A-Z]+)$/.exec(ref);
    if (!m || m[1] !== m[2]) throw new Error('not a whole Ledger column: ' + ref);
    const c = lettersIndex(m[1]) - 1;
    return ledger.map(r => (r[c] === undefined ? '' : r[c]));
  };
  const splitArgs = s => {
    const out = [];
    let cur = '', quoted = false;
    for (const ch of s) {
      if (ch === '"') quoted = !quoted;
      if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const criterion = expr => expr.split('&').map(part => {
    if (/^".*"$/.test(part)) return part.slice(1, -1).replace(/""/g, '"');
    if (Object.prototype.hasOwnProperty.call(env, part)) return env[part];
    throw new Error('unknown criterion part ' + part);
  }).join('');
  const matches = (cell, crit) => {
    if (crit === '=') return cell === '';
    if (crit === '<>') return cell !== '';
    const m = /^(>=|<=|>|<)(-?\d+(?:\.\d+)?)$/.exec(crit);
    if (m) {
      if (typeof cell !== 'number') return false;
      const n = Number(m[2]);
      return m[1] === '>' ? cell > n : m[1] === '<' ? cell < n : m[1] === '>=' ? cell >= n : cell <= n;
    }
    if (typeof cell !== 'string') return false;
    const re = new RegExp('^' + crit.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return re.test(cell);
  };
  const sumifs = args => {
    const a = splitArgs(args);
    if (a.length < 3 || a.length % 2 !== 1) throw new Error('SUMIFS arguments: ' + args);
    const sum = column(a[0]), conds = [];
    for (let i = 1; i < a.length; i += 2) conds.push([column(a[i]), criterion(a[i + 1])]);
    let total = 0;
    for (let r = 0; r < sum.length; r++) if (typeof sum[r] === 'number' && conds.every(c => matches(c[0][r], c[1]))) total += sum[r];
    return total;
  };
  const expr = String(formula).replace(/^=/, '').replace(/SUMIFS\(([^()]*)\)/g, (all, args) => '(' + sumifs(args) + ')');
  if (!/^[-+()\d.\s]+$/.test(expr)) throw new Error('not an account formula: ' + formula);
  return Function('"use strict"; return (' + expr + ');')();
}

/* ====================================================================================================== */

section('1. fake_gas rule (a): strict. A member outside the modelled list throws', () => {
  const fake = newBook('rules', { unchecked: true });
  const x = fake.newExecution();
  const ss = x.SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.insertSheet('Scratch');
  const notModelled = (fn, cls, member) => { const err = thrown(fn); return !!err && err.message === 'fake_gas: ' + cls + '.' + member + ' is not modelled'; };
  check(notModelled(() => x.SpreadsheetApp.getActiveSheet(), 'SpreadsheetApp', 'getActiveSheet') && notModelled(() => ss.getSheets(), 'Spreadsheet', 'getSheets') &&
    notModelled(() => sh.insertRowsBefore(1, 1), 'Sheet', 'insertRowsBefore') && notModelled(() => sh.getRange(1, 1).setBackground('#ffffff'), 'Range', 'setBackground') &&
    notModelled(() => x.Utilities.sleep(1), 'Utilities', 'sleep') && notModelled(() => x.Logger.getLog(), 'Logger', 'getLog') &&
    notModelled(() => x.PropertiesService.getScriptProperties().deleteProperty('k'), 'Properties', 'deleteProperty') && notModelled(() => x.CacheService.getScriptCache().getAll(['k']), 'Cache', 'getAll'),
    'a real Apps Script member that is not modelled throws "fake_gas: <Class>.<member> is not modelled"');
  check(notModelled(() => x.SpreadsheetApp.newDataValidation().requireCheckBox(), 'DataValidationBuilder', 'requireCheckBox') &&
    notModelled(() => x.SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfed('=A1=1'), 'ConditionalFormatRuleBuilder', 'whenFormulaSatisfed') &&
    notModelled(() => sh.getRange(1, 1).setDataValidations([]), 'Range', 'setDataValidations') && notModelled(() => sh.setConditionalFormattingRules([]), 'Sheet', 'setConditionalFormattingRules') &&
    notModelled(() => sh.getRange(1, 1).setNotes([['x']]), 'Range', 'setNotes') && notModelled(() => x.SpreadsheetApp.newDataValidationRule(), 'SpreadsheetApp', 'newDataValidationRule'),
    'a misspelt builder or setter fails instead of passing silently');
  check(notModelled(() => x.LockService.getScriptLock().tryLock(1), 'Lock', 'tryLock') && notModelled(() => x.LockService.getScriptLock().hasLock(), 'Lock', 'hasLock') &&
    notModelled(() => x.LockService.getDocumentLock(), 'LockService', 'getDocumentLock'), 'Lock has waitLock and releaseLock, nothing else');
  check(notModelled(() => x.UrlFetchApp.fetch('https://example.org'), 'UrlFetchApp', 'fetch') && notModelled(() => x.DriveApp.getFileById('x'), 'DriveApp', 'getFileById') &&
    notModelled(() => x.ScriptApp.getProjectTriggers(), 'ScriptApp', 'getProjectTriggers'), 'Telegram, Drive and triggers resolve as names and model nothing');
  check(same(sorted(Object.keys(FAKE_GAS_MEMBERS).filter(k => k !== 'added').reduce((o, k) => { o[k] = FAKE_GAS_MEMBERS[k]; return o; }, {})), sorted(SPEC_MEMBERS)),
    'the modelled members are exactly the list of spec section 12');
  check(same(sorted(FAKE_GAS_MEMBERS.added), sorted(ADDED_MEMBERS)),
    'beyond that list: the three service entry points, doPost\'s two reply objects, the enum values, and Sheet.insertRowsAfter (gasEnsureRows)', FAKE_GAS_MEMBERS.added);
  const lock = x.LockService.getScriptLock(), range = sh.getRange(1, 1);
  check(same(Object.keys(sh).sort(), fakeGasMembersOf('Sheet').slice().sort()) && same(Object.keys(range).sort(), fakeGasMembersOf('Range').slice().sort()) &&
    same(Object.keys(ss).sort(), fakeGasMembersOf('Spreadsheet').slice().sort()) && same(Object.keys(lock).sort(), ['releaseLock', 'waitLock']) &&
    same(Object.keys(x.SpreadsheetApp).sort(), fakeGasMembersOf('SpreadsheetApp').slice().sort()),
    'the fake objects carry those members and no other (the table is enforced when an object is built)');
  check(throwsWith(() => { sh.getName = function () { return 'x'; }; }, /cannot be assigned/) && throwsWith(() => sh.getRange('A1:B2'), /is not modelled/) &&
    throwsWith(() => sh.getRange(1, 1, 1, 1, 1), /takes \(row, column/), 'a fake object cannot be patched, and getRange knows (row, column, rows, columns), "A:A" and "A1" only');
  const builtRule = x.SpreadsheetApp.newDataValidation().requireCheckbox().build();
  check(throwsWith(() => sh.getRange(1, 1).setDataValidation(x.SpreadsheetApp.newDataValidation().requireCheckbox()), /build\(\) returned/) &&
    throwsWith(() => x.SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=A1=1').setBackground('#ff0000').setRanges(sh.getRange(1, 1)), /array of ranges/) &&
    throwsWith(() => x.SpreadsheetApp.newDataValidation().requireValueInList('a,b', true), /array of strings/) &&
    throwsWith(() => sh.setConditionalFormatRules([builtRule]), /ConditionalFormatRuleBuilder\.build/) &&
    throwsWith(() => x.SpreadsheetApp.newDataValidation().build(), /before any require/),
    'builders and setters refuse the wrong kind of argument (a builder that was not built, a range that is not in an array)');

  step('1. fake_gas rule (b): values behave like Sheets');
  ss.setSpreadsheetTimeZone('Asia/Yangon');
  const cell = (r, c) => fake.sheet('Scratch').value(r, c);
  sh.getRange(1, 1).setValue('09777123456');
  sh.getRange(1, 2).setNumberFormat('@').setValue('09777123456');
  check(cell(1, 1) === 9777123456 && sh.getRange(1, 1).getValue() === 9777123456, 'a number-like string in a cell that is not text becomes a number: 09777123456 loses its zero', cell(1, 1));
  check(cell(1, 2) === '09777123456' && sh.getRange(1, 2).getValue() === '09777123456', 'the same string in a cell formatted @ stays that string', cell(1, 2));
  sh.getRange(2, 1, 1, 4).setValues([['TRUE', 'false', '=SUM(1,2)', '2026-11-10']]);
  const dateCell = sh.getRange(2, 4).getValue();
  check(cell(2, 1) === true && cell(2, 2) === false, 'TRUE and FALSE typed as text become booleans');
  check(cell(2, 3) === '=SUM(1,2)' && fake.sheet('Scratch').isFormula(2, 3) && sh.getRange(2, 3).getValue() === '=SUM(1,2)', 'a formula is kept as its text and never evaluated');
  check(dateCell instanceof vm.runInContext('Date', x) && !(dateCell instanceof Date) && dateCell.toISOString() === '2026-11-09T17:30:00.000Z',
    'a yyyy-mm-dd string becomes a Date at midnight of the spreadsheet\'s time zone, made of the Date of the execution that reads it (so "instanceof Date" holds inside the code)', String(dateCell));
  sh.getRange(3, 1, 1, 4).setNumberFormat('@').setValues([['TRUE', 'false', '=SUM(1,2)', '2026-11-10']]);
  check(cell(3, 1) === 'TRUE' && cell(3, 2) === 'false' && cell(3, 3) === '=SUM(1,2)' && !fake.sheet('Scratch').isFormula(3, 3) && cell(3, 4) === '2026-11-10', 'cells formatted @ keep every one of those strings');
  check(throwsWith(() => sh.getRange(4, 1, 2, 2).setValues([[1, 2]]), /number of rows/) && throwsWith(() => sh.getRange(4, 1, 1, 2).setValues([[1, 2, 3]]), /number of columns/) &&
    throwsWith(() => sh.getRange(4, 1, 1, 2).setValues([1, 2]), /two-dimensional/), 'setValues with the wrong dimensions throws');
  sh.getRange(5, 1, 3, 1).setDataValidation(builtRule);
  check([5, 6, 7].every(r => cell(r, 1) === '') && sh.getLastRow() === 3, 'a tick-box rule set with setDataValidation leaves its cells blank');
  sh.getRange(5, 2, 3, 1).insertCheckboxes();
  check([5, 6, 7].every(r => cell(r, 2) === false) && sh.getLastRow() === 7, 'insertCheckboxes sets every cell of its range to false');
  sh.getRange(8, 1).setDataValidation(x.SpreadsheetApp.newDataValidation().requireValueInList(['S1', 'S2'], true).setAllowInvalid(false).build());
  check(throwsWith(() => sh.getRange(8, 1).setValue('S3'), /violates the data validation rules/) && cell(8, 1) === '' &&
    !thrown(() => { sh.getRange(8, 1).setValue('S2'); sh.getRange(8, 1).setValue(''); }) && throwsWith(() => fake.hand.type('Scratch', 8, 1, 'S9', { trigger: false }), /violates/),
    'a write that breaks a rule made with setAllowInvalid(false) throws, for a script and for a person; a blank is never refused');
  const grid = ss.insertSheet('Grid');
  grid.appendRow(['head']);
  fake.hand.trimRows('Grid', 0);
  check(fake.sheet('Grid').maxRows === 1 && throwsWith(() => grid.getRange(2, 1), /outside the dimensions of the sheet/) && throwsWith(() => grid.getRange(1, 27), /outside the dimensions/) &&
    throwsWith(() => grid.getRange(1, 1, 2, 1), /outside the dimensions/), 'a range that reaches outside the grid throws for every use (stricter than Sheets, where setValues grows the sheet by itself)');
  grid.appendRow(['a', '0123']);
  grid.insertRowsAfter(2, 3);
  check(fake.sheet('Grid').maxRows === 5 && fake.sheet('Grid').value(2, 1) === 'a' && fake.sheet('Grid').value(2, 2) === 123 && !thrown(() => grid.getRange(5, 1).setValue('x')),
    'appendRow grows the sheet by itself and reads its strings like typed text; insertRowsAfter adds rows');

  step('1. fake_gas rule (c): LockService as documented, not counted');
  lock.waitLock(1000);
  const first = fake.lock.held && fake.lock.acquires === 1;
  lock.waitLock(1000);
  const second = fake.lock.held && fake.lock.acquires === 1 && fake.lock.nested === 1;
  lock.releaseLock();
  const freed = !fake.lock.held;
  lock.releaseLock();
  check(first && second && freed && fake.lock.strayReleases === 1, 'waitLock on a held lock does nothing and is counted as an acquire while held; the first releaseLock frees the lock', fake.lock);
  lock.waitLock(15000);
  (function oldStoreMethod() { const own = x.LockService.getScriptLock(); own.waitLock(15000); try { return 1; } finally { own.releaseLock(); } })();
  check(!fake.lock.held && fake.lock.nested === 2, 'so a method that takes and releases the lock itself inside a held lock frees it: the hazard gasLocked() removes is visible here');
  fake.lock.busy = true;
  const timeout = throwsWith(() => lock.waitLock(100), /Lock timeout/);
  fake.lock.busy = false;
  check(timeout && !fake.lock.held, 'a lock another process holds makes waitLock throw a timeout');

  step('1. fake_gas rule (d): every execution starts with fresh globals over the same spreadsheet');
  const a = fake.newExecution(), n0 = fake.executions;
  a.GAS_DASH_DIRTY = true; a.GAS_LOCK_DEPTH = 1; a.GAS_TABLES.Marker = [1];
  const b = fake.newExecution();
  check(a !== b && fake.executions === n0 + 1 && b.GAS_DASH_DIRTY === false && b.GAS_LOCK_DEPTH === 0 && Object.keys(b.GAS_TABLES).length === 0 && b.GAS_LISTS_MEMO === null,
    'GAS_TABLES, GAS_LISTS_MEMO, GAS_LOCK_DEPTH and GAS_DASH_DIRTY of one execution are not seen by the next');
  a.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scratch').getRange(20, 1).setValue('from a');
  a.PropertiesService.getScriptProperties().setProperty('K', 'v');
  a.CacheService.getScriptCache().put('ck', 'cv', 60);
  check(b.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scratch').getRange(20, 1).getValue() === 'from a' && b.PropertiesService.getScriptProperties().getProperty('K') === 'v' &&
    b.CacheService.getScriptCache().get('ck') === 'cv' && b.PropertiesService.getScriptProperties().getProperty('nope') === null && b.CacheService.getScriptCache().get('nope') === null,
    'the spreadsheet, the Script Properties and the cache are shared by all executions');
  a.LockService.getScriptLock().waitLock(1000);
  fake.newExecution();
  check(!fake.lock.held && fake.lock.leaked === 1, 'a lock left held never outlives its execution, and the fake counts it as leaked');
  fake.setBound(false);
  const c = fake.newExecution();
  const unboundError = thrown(() => c.gasSpreadsheet());
  fake.props.SHEET_ID = fake.spreadsheetId;
  const viaId = c.gasSpreadsheet().getId() === fake.spreadsheetId;
  const noTrigger = fake.hand.type('Scratch', 21, 1, 'typed');
  fake.setBound(true);
  check(!!unboundError && /Not bound to a sheet/.test(unboundError.message) && viaId && noTrigger.fired === false,
    'a standalone project: getActiveSpreadsheet() is null, gasSpreadsheet() opens Script Property SHEET_ID, and a hand edit fires no trigger');
});

/* ====================================================================================================== */

/** Today's lists as version 3 shows them on a sheet with the default Settings, from CFG and MSG (not from the seeding code). */
function defaultLists(CFG, MSG) {
  const rows = [];
  CFG.DEFAULT_PAY_METHODS.forEach((k, i) => rows.push(['pay_method', k, MSG['method_' + k] || k, true, i + 1, '', '', '', '']));
  const cats = CFG.EXPENSE_CATEGORIES.slice();
  if (!cats.some(c => c[0] === 'other')) cats.push(['other', MSG.cat_other]);
  cats.forEach((c, i) => rows.push(['expense_category', c[0], c[1], true, i + 1, '', CFG.EXPENSE_EMOJI[c[0]] || '', '', '']));
  CFG.FABRIC_PRESETS.forEach((f, i) => rows.push(['fabric', 'f' + (i + 1), f, true, i + 1, '', '', '', '']));
  return rows;
}

/** The five built-in item categories (round 6b) as the Lists tab's first seed writes them after the round-4 lists, from CFG. */
function defaultItemCategories(CFG) {
  return CFG.CATEGORIES.map((c, i) => ['item_category', CFG.ITEM_CATEGORY_KEYS[i], c, true, i + 1, '', CFG.CATEGORY_EMOJI[c], '', '']);
}

let CFG = null, MSG = null;

section('2. setupSheet() on an empty spreadsheet: the Lists tab is created and seeded', () => {
  const fake = newBook('empty');
  const x = fake.newExecution();
  const d = locked(fake, () => x.setupSheet());
  CFG = plain(x.CFG); MSG = plain(x.MSG);
  const L = lists(fake), expected = defaultLists(CFG, MSG);
  check(!d.error && fake.sheetNames().indexOf('Lists') >= 0 && same(L.header(), CFG.LIST_COLS) && L.frozenRows === 1 && L.bold(1, 1),
    'setupSheet finishes and the Lists tab exists with the header ' + CFG.LIST_COLS.join(', '), d.error ? d.error.message : L.header());
  check(same(L.values().slice(1), expected.concat(defaultItemCategories(CFG))) && expected.length === 16, 'seeded with today\'s lists: 4 methods (CASH first), 9 expense categories (other last, each with its emoji), 3 fabrics, then the five item categories (round 6b)', L.values().slice(1));
  const body = L.rows();
  check(body.length === 21 && body.every(r => r.Active === true) && body.every(r => typeof r.Order === 'number' && r.Order >= 1) && body.every(r => r.Shop === ''),
    'every seeded row is active (the boolean true), has Order 1..n inside its list and a blank Shop');
  check(listRow(fake, 'pay_method', 'KBZ').Label === 'KBZPay' && listRow(fake, 'pay_method', 'CASH').Order === 1 && listRow(fake, 'expense_category', 'other').Detail === '📦' &&
    same(listKeys(fake, 'fabric'), ['f1', 'f2', 'f3']), 'spot values: KBZ is labelled KBZPay, CASH is first, other carries 📦, the fabrics are f1 f2 f3');
  const textCols = [LC.Key, LC.Label, LC.Detail, LC.Note], otherCols = [LC.List, LC.Active, LC.Order, LC.Shop];
  check(textCols.every(c => [1, 2, 17, 18, 500, 1000].every(r => L.format(r, c) === '@')) && otherCols.every(c => [2, 17, 500].every(r => L.format(r, c) === '')),
    'the whole Key, Label, Detail and Note columns are plain text (@); List, Active, Order and Shop are not');
  // Text format is part of the contract: before any seed value is written.
  const lcalls = d.calls.filter(c => c.sheet === 'Lists');
  const firstSeed = lcalls.findIndex(c => c.call === 'Range.setValues' && c.row >= 2);
  const wholeColumnFormats = lcalls.map((c, i) => (c.call === 'Range.setNumberFormat' && c.arg === '@' && c.row === 1 && c.rows === 1000 && c.cols === 1 ? { i, col: c.col } : null)).filter(Boolean);
  check(firstSeed > 0 && same(wholeColumnFormats.filter(f => f.i < firstSeed).map(f => f.col).sort(), textCols.slice().sort()),
    'the four columns are formatted before the first seed value is written', { firstSeed, wholeColumnFormats });
  check(lcalls.filter(c => c.call === 'Sheet.appendRow').length === 0 && lcalls.filter(c => c.call === 'Range.setValues' && c.row === 2 && c.rows === 21 && c.cols === 9).length === 1,
    'the seed is one setValues block from row 2, never appendRow');
  // Niceties.
  const tick = L.validation(2, LC.Active);
  check(fake.calls(0, c => c.call === 'Range.insertCheckboxes').length === 0 && !!tick && tick.type === 'checkbox' && L.validation(1, LC.Active) === null && L.validation(1000, LC.Active).type === 'checkbox' &&
    L.validations('checkbox') === 999, 'Active shows tick boxes through a data-validation rule from row 2 to the last row; insertCheckboxes is never called');
  const dropList = L.validation(2, LC.List), dropShop = L.validation(2, LC.Shop);
  check(!!dropList && dropList.type === 'list' && same(dropList.values, CFG.LIST_NAMES) && dropList.showDropdown === true && dropList.allowInvalid === false && L.validation(1, LC.List) === null &&
    !!dropShop && dropShop.type === 'list' && same(dropShop.values, ['S1', 'S2']) && dropShop.allowInvalid === false && L.validation(1, LC.Shop) === null && L.validations('list') === 3 * 999,
    'List, Shop and Kind are dropdowns from row 2 that reject other input (a blank Shop stays allowed)', { dropList, dropShop });
  check(CFG.LIST_COLS.every((name, i) => L.note(1, i + 1) === (i === 0 ? MSG.lists_note_list + '\n' + MSG.lists_note_item_category : MSG['lists_note_' + name.toLowerCase()]) && L.note(1, i + 1).length > 3),
    'each of the eight header cells carries its Burmese note (Messages lists_note_<column>) (the List note also explains item_category, round 6b)');
  const rules = L.rules();
  check(rules.length === 2 && rules[0].formula === '=AND($B2<>"",COUNTIFS($A$2:$A,$A2,$B$2:$B,$B2)>1)' && same(rules[0].ranges, ['B2:B1000']) &&
    rules[1].formula === '=AND($B2<>"",$C2="")' && same(rules[1].ranges, ['C2:C1000']) && rules.every(r => /^#[0-9a-f]{6}$/i.test(r.background)),
    'two highlights: a key used twice in one list, and a row without a label', rules);
  check(errorsOf(fake).length === 0, 'nothing was logged to the Errors tab (a failed nicety would be logged there, not thrown)', errorsOf(fake));
  check(once(d, 15000) && !fake.lock.held, 'setupSheet took the script lock once, for the Lists tab, and released it', lockOf(d));
  // What the user sees does not change by seeding.
  const y = fake.newExecution(), ports = y.buildPorts();
  check(same(plain(y.payMethods(ports)), CFG.DEFAULT_PAY_METHODS) && same(plain(y.expenseCategories(ports)), expected.filter(r => r[0] === 'expense_category').map(r => [r[1], r[2]])) &&
    same(plain(y.fabricOptions(ports)).map(r => r.label), CFG.FABRIC_PRESETS), 'the buttons the core builds from the seeded tab are the ones it built before: methods, categories, fabrics');
  const dash = fake.sheet('Dashboard').values().map(r => r[0]);
  const lastListsWrite = d.calls.map(c => c.sheet === 'Lists' && !!c.write).lastIndexOf(true), dashWritten = d.calls.findIndex(c => c.call === 'Sheet.clear' && c.sheet === 'Dashboard');
  check(lastListsWrite > 0 && dashWritten > lastListsWrite && dashRewrites(d.calls) === 1 && dash.indexOf('Money by account (this month)') > dash.indexOf('Expenses by category (this month)') && dash.indexOf('Expenses by category (this month)') > 0,
    'setupSheet writes the Dashboard after its last write to the Lists tab: the category block and, below it, the account block', { lastListsWrite, dashWritten });

  step('3. setupSheet() a second time changes nothing');
  const before = fake.sheetNames().map(n => fake.sheet(n).dump());
  const counts = { tick: L.validations('checkbox'), drop: L.validations('list'), rules: L.rules().length };
  const d2 = locked(fake, () => fake.newExecution().setupSheet());
  const after = fake.sheetNames().map(n => fake.sheet(n).dump());
  const changed = fake.sheetNames().filter((n, i) => before[i] !== after[i]);
  check(!d2.error && changed.length === 0, 'every tab holds exactly what it held (values, formats, rules, notes)', d2.error ? d2.error.message : changed);
  check(L.validations('checkbox') === counts.tick && L.validations('list') === counts.drop && L.rules().length === counts.rules && counts.rules === 2,
    'the validation and conditional-rule counts are equal: a second run adds no rule', { now: [L.validations('checkbox'), L.validations('list'), L.rules().length], counts });
  check(L.rows().length === 21 && L.rows().every(r => r.Active === true), 'the 21 rows are still there, once, and still active');
  // A box the family unticked stays unticked; a row they typed gets its tick.
  fake.hand.tick('Lists', listRow(fake, 'pay_method', 'WAVE')._row, LC.Active, false, { trigger: false });
  const typed = typeRow(fake, 'Lists', ['pay_method', 'AYA', 'AYA ဘဏ်']);
  const d3 = locked(fake, () => fake.newExecution().setupSheet());
  check(!d3.error && listRow(fake, 'pay_method', 'WAVE').Active === false, 'a third run never changes an Active cell that holds false');
  check(typed === 23 && L.value(typed, LC.Active) === true && L.rows().length === 22, 'and it writes true into the blank Active cell of the row typed by hand, without seeding again');
  check(valueWrites(d3.calls, 'Lists').length === 1 && valueWrites(d3.calls, 'Lists')[0].row === typed && valueWrites(d3.calls, 'Lists')[0].col === LC.Active,
    'that tick is the only value written to the Lists tab', valueWrites(d3.calls, 'Lists'));
  check(errorsOf(fake).length === 0, 'the Errors tab is still empty', errorsOf(fake));
});

section('3b. ensureListsTab: a failure of the text format stops setup; a failed nicety does not', () => {
  const fake = newBook('format-fails');
  fake.failNext(c => c.call === 'Range.setNumberFormat' && c.sheet === 'Lists', 'Service error: Spreadsheets');   // Google fails on the first text format of the Lists tab
  const x = fake.newExecution();
  const d = locked(fake, () => x.setupSheet());
  check(!!d.error && d.error.message === 'Service error: Spreadsheets' && fake.faultsLeft === 0 && lists(fake).lastRow() === 1 && fake.sheetNames().indexOf('Dashboard') >= 0 && fake.sheet('Dashboard').lastRow() === 0 &&
    !fake.lock.held && x.GAS_LOCK_DEPTH === 0 && errorsOf(fake).length === 0,
    'the text format is not inside a try/catch: its error stops setupSheet before any row is seeded (and before the Dashboard), and the lock is released', d.error ? d.error.message : 'no error');
  const redo = locked(fake, () => fake.newExecution().setupSheet());
  check(!redo.error && lists(fake).rows().length === 21 && lists(fake).format(2, LC.Detail) === '@' && lists(fake).validations('checkbox') === 999 && fake.sheet('Dashboard').lastRow() > 10,
    'running setupSheet again finishes the tab: text columns, the 21 rows, the tick boxes', redo.error ? redo.error.message : lists(fake).rows().length);
  // The FIRST nicety fails (the tick boxes): the ones after it must still be applied.
  const fake2 = newBook('nicety-fails');
  fake2.failNext(c => c.call === 'DataValidationBuilder.requireCheckbox', 'no tick boxes today');
  const d2 = locked(fake2, () => fake2.newExecution().setupSheet());
  const L = lists(fake2);
  check(!d2.error && L.rows().length === 21 && L.rows().every(r => r.Active === true) && L.validations('checkbox') === 0 && L.validations('list') === 2997 && L.note(1, 8) === MSG.lists_note_note &&
    L.rules().length === 2 && fake2.sheet('Dashboard').lastRow() > 10,
    'each nicety has its own try/catch: when the tick boxes fail, the tab is still seeded and gets its dropdowns, notes and highlights, and setup goes on', d2.error ? d2.error.message : { tick: L.validations('checkbox'), drop: L.validations('list'), rules: L.rules().length });
  check(same(errorKinds(fake2), ['lists_setup']) && /tick boxes/.test(String(errorsOf(fake2)[0].Message)) && /no tick boxes today/.test(String(errorsOf(fake2)[0].Message)),
    'and the failed nicety is one row in the Errors tab', errorsOf(fake2));
  // A header the family removed comes back (ensureColumns), the rows stay.
  const fake3 = setupBook('lost-header');
  fake3.hand.setRaw('Lists', 1, LC.Note, '');
  const d3 = locked(fake3, () => fake3.newExecution().setupSheet());
  check(!d3.error && same(lists(fake3).header(), CFG.LIST_COLS) && lists(fake3).rows().length === 21 && errorsOf(fake3).length === 0,
    'a Lists tab that lost a header cell gets the column back on the next setupSheet, without a second seed', d3.error ? d3.error.message : lists(fake3).header());
});

section('4. setupSheet() on a version-3 spreadsheet: seeded from its own Settings and Messages', () => {
  // A sheet of the version before: every tab but Lists, with the family's own methods, categories and fabrics.
  const fake = setupBook('version-3');
  fake.hand.deleteSheet('Lists');
  setSetting(fake, 'pay_methods', 'CASH,AYA,KBZ,TOOLONGKEY1234');
  setSetting(fake, 'expense_categories', 'fabric:အထည်ဖိုး,tea:လက်ဖက်ရည်ဖိုး');
  setSetting(fake, 'fabric_presets', 'ပိုး,ဇာ');
  typeRow(fake, 'Messages', ['method_AYA', 'AYA ဘဏ်']);
  const pre = fake.newExecution(), prePorts = pre.buildPorts();
  const seenBefore = { methods: plain(pre.payMethods(prePorts)), labels: plain(pre.payMethods(prePorts)).map(k => pre.methodLabel(prePorts, k)), cats: plain(pre.expenseCategories(prePorts)), fabrics: plain(pre.fabricOptions(prePorts)).map(r => r.label) };
  check(same(seenBefore.methods, ['CASH', 'AYA', 'KBZ']) && same(seenBefore.labels, [MSG.method_CASH, 'AYA ဘဏ်', 'KBZPay']) && same(seenBefore.fabrics, ['ပိုး', 'ဇာ']) && same(plain(pre.gasStore.listOptions('pay_method')), []),
    'before: no Lists tab, the store answers [] and the core shows CASH, AYA ဘဏ်, KBZPay (the 14-byte key is left out, as in version 3)', seenBefore);
  const d = locked(fake, () => fake.newExecution().setupSheet());
  const L = lists(fake);
  const expected = [
    ['pay_method', 'CASH', MSG.method_CASH, true, 1, '', '', '', ''],
    ['pay_method', 'AYA', 'AYA ဘဏ်', true, 2, '', '', '', ''],
    ['pay_method', 'KBZ', 'KBZPay', true, 3, '', '', '', ''],
    ['expense_category', 'fabric', 'အထည်ဖိုး', true, 1, '', '🧵', '', ''],
    ['expense_category', 'tea', 'လက်ဖက်ရည်ဖိုး', true, 2, '', '', '', ''],
    ['expense_category', 'other', MSG.cat_other, true, 3, '', '📦', '', ''],
    ['fabric', 'f1', 'ပိုး', true, 1, '', '', '', ''],
    ['fabric', 'f2', 'ဇာ', true, 2, '', '', '', '']
  ];
  check(!d.error && same(L.values().slice(1), expected.concat(defaultItemCategories(CFG))), 'seeded from them: the method_AYA label, the custom categories plus other, the custom fabrics as f1 f2, then the five item categories', d.error ? d.error.message : L.values().slice(1));
  const post = fake.newExecution(), postPorts = post.buildPorts();
  const seenAfter = { methods: plain(post.payMethods(postPorts)), labels: plain(post.payMethods(postPorts)).map(k => post.methodLabel(postPorts, k)), cats: plain(post.expenseCategories(postPorts)), fabrics: plain(post.fabricOptions(postPorts)).map(r => r.label) };
  check(same(seenAfter, seenBefore), 'after: the core shows exactly what it showed before, now from the tab', seenAfter);
  const dashLabels = fake.sheet('Dashboard').values().map(r => r[0]);
  check(dashLabels.indexOf('AYA ဘဏ် (AYA)') > 0 && dashLabels.indexOf('KBZPay (KBZ)') > 0 && dashLabels.indexOf('လက်ဖက်ရည်ဖိုး (tea)') > 0 && dashLabels.every(l => !/\(CASH\)|\(WAVE\)/.test(String(l))),
    'the Dashboard lists the seeded accounts (AYA, KBZ; no CASH row, no WAVE) and the tea category');
  check(errorKinds(fake).length >= 1 && errorKinds(fake).every(k => k === 'pay_methods'), 'the only Errors rows are about the method key that is too long', errorKinds(fake));
});

section('5. A published version on a sheet where setupSheet() has not run yet: no Lists tab', () => {
  const fake = setupBook('no-lists-tab');
  fake.hand.deleteSheet('Lists');
  const x = fake.newExecution(), ports = x.buildPorts();
  const first = locked(fake, () => x.gasStore.listOptions('pay_method'));
  const again = locked(fake, () => [x.gasStore.listOptions('pay_method'), x.gasStore.listOptions('fabric'), x.gasStore.listOptions('expense_category')]);
  check(same(plain(first.out), []) && first.calls.length > 0 && again.calls.length === 0, 'listOptions answers [] and asks Google once per execution, not on every call', serviceCalls(again.calls));
  check(same(plain(x.payMethods(ports)), CFG.DEFAULT_PAY_METHODS) && x.methodLabel(ports, 'KBZ') === 'KBZPay' && plain(x.expenseCategories(ports)).length === 9 &&
    x.listsJsonFor({ store: x.gasStore }) === '', 'the core falls back to the Settings rows (legacy) and no lists_json is derived');
  // The first option added creates the tab, seeded, so the old buttons never disappear.
  const y = fake.newExecution(), yports = y.buildPorts();
  const d = locked(fake, () => y.addListOptionByLabel(yports, 'pay_method', 'AYA ဘဏ်', STAFF));
  const res = plain(d.out);
  check(!d.error && res && res.ok === true && res.created === true && /^AYA[0-9A-F]{4}$/.test(res.key), '➕ by name on that sheet creates the option', d.error ? d.error.message : res);
  check(fake.sheetNames().indexOf('Lists') >= 0 && lists(fake).rows().length === 22 && lists(fake).validations('checkbox') === 999 && lists(fake).rules().length === 2,
    'the Lists tab now exists as setupSheet would make it: the 21 seeded options plus the new one');
  check(same(plain(y.payMethods(yports)), CFG.DEFAULT_PAY_METHODS.concat([res.key])) && y.methodLabel(yports, res.key) === 'AYA ဘဏ်',
    'the method buttons are the old ones and the new one', plain(y.payMethods(yports)));
  check(once(d, 15000) && y.GAS_DASH_DIRTY === true && errorsOf(fake).length === 0, 'one lock, the Dashboard flag raised, nothing in Errors', lockOf(d));
});

section('6. gasStore.listOptions: what the Lists tab means', () => {
  const fake = setupBook('listOptions');
  const x = fake.newExecution();
  const first = locked(fake, () => x.gasStore.listOptions('pay_method'));
  const rows = plain(first.out);
  check(rows.length === 4 && rows.every(r => same(Object.keys(r).sort(), ['active', 'detail', 'key', 'label', 'list', 'note', 'order', 'shop'])),
    'rows carry exactly the lower-case fields list, key, label, active, order, shop, detail, note', rows[0]);
  check(rows.every(r => r.list === 'pay_method' && typeof r.key === 'string' && typeof r.label === 'string' && r.active === true && typeof r.order === 'number' && r.shop === '' && r.detail === '' && r.note === '') &&
    same(rows.map(r => r.key), ['CASH', 'KBZ', 'WAVE', 'BANK']) && same(rows.map(r => r.order), [1, 2, 3, 4]), 'in sheet order, with strings for the text columns, a boolean Active and a numeric Order');
  const second = locked(fake, () => [x.gasStore.listOptions('pay_method'), x.gasStore.listOptions('expense_category'), x.gasStore.listOptions('fabric'), x.gasStore.listOptions('pay_method')]);
  check(second.calls.length === 0 && plain(second.out)[1].length === 9 && plain(second.out)[2].length === 3, 'the tab is read once per execution: four more calls make no Google call', serviceCalls(second.calls));
  first.out[0].label = 'changed by a caller';
  check(plain(x.gasStore.listOptions('pay_method'))[0].label === MSG.method_CASH, 'a caller that changes a returned row does not change the next answer');
  check(same(plain(x.gasStore.listOptions('nope')), []) && same(plain(x.gasStore.listOptions('')), []), 'an unknown list is []');
  // Hand edits, typed while no trigger runs (a standalone copy, or before this version was published).
  fake.hand.tick('Lists', listRow(fake, 'pay_method', 'WAVE')._row, LC.Active, false, { trigger: false });
  const blankActive = typeRow(fake, 'Lists', ['pay_method', 'AYA', 'AYA ဘဏ်', '', '', 'S2', '09 777 123456 ဦးမောင်']);
  const noKey = typeRow(fake, 'Lists', ['pay_method', '', 'no key here']);
  const badOrder = typeRow(fake, 'Lists', ['fabric', '123', '', '', 'soon']);
  check(same(plain(x.gasStore.listOptions('pay_method')).map(r => r.key), ['CASH', 'KBZ', 'WAVE', 'BANK']), 'inside one execution the read stays the cached one (as in production, until a write invalidates it)');
  const y = fake.newExecution(), ports = y.buildPorts();
  const pm = plain(y.gasStore.listOptions('pay_method')), byKey = k => pm.find(r => r.key === k);
  check(byKey('WAVE').active === false && lists(fake).value(listRow(fake, 'pay_method', 'WAVE')._row, LC.Active) === false, 'a row whose Active holds false is inactive');
  check(lists(fake).value(blankActive, LC.Active) === '' && byKey('AYA').active === true && byKey('AYA').order === 0 && byKey('AYA').shop === 'S2' && byKey('AYA').detail === '09 777 123456 ဦးမောင်',
    'a hand-typed row with a blank Active is active; its blank Order is 0', byKey('AYA'));
  check(pm.length === 5 && !pm.some(r => r.label === 'no key here') && lists(fake).value(noKey, LC.Label) === 'no key here', 'a row with a blank Key is skipped');
  const fab = plain(y.gasStore.listOptions('fabric')).find(r => r.key === '123');
  check(!!fab && fab.key === '123' && typeof fab.key === 'string' && fab.order === 0 && fab.label === '' && lists(fake).value(badOrder, LC.Key) === '123',
    'a key typed as digits stays the string 123 (the Key column is text), an Order that is not a number is 0', fab);
  // A cell that lost its text format holds a number; the store still answers strings.
  [LC.Key, LC.Label, LC.Detail, LC.Note].forEach(c => fake.hand.clearFormat('Lists', 30, c));
  ['fabric', '0456', '789', '', '2', '', '0111', '5'].forEach((v, i) => { if (v !== '') fake.hand.type('Lists', 30, i + 1, v, { trigger: false }); });
  const numeric = plain(fake.newExecution().gasStore.listOptions('fabric')).find(r => r.key === '456');
  check(lists(fake).value(30, LC.Key) === 456 && !!numeric && same(numeric, { list: 'fabric', key: '456', label: '789', active: true, order: 2, shop: '', detail: '111', note: '5' }),
    'Key, Label, Detail and Note come back as strings even from cells that hold numbers (the zero is gone there: the reason those columns are text)', numeric);
  check(same(plain(y.payMethods(ports, 'S1')), ['CASH', 'KBZ', 'BANK']) && same(plain(y.payMethods(ports, 'S2')), ['CASH', 'KBZ', 'BANK', 'AYA']) && y.methodKnown(ports, 'WAVE') === true && y.methodLabel(ports, 'wave') === 'WavePay',
    'the core on top: WAVE is no button any more but still known and labelled; AYA is offered in shop 2 only');
  // onEdit gives the typed row its tick.
  const e = fake.hand.type('Lists', blankActive, LC.Note, 'typed by the family');
  check(e.fired && !e.error && lists(fake).value(blankActive, LC.Active) === true && lists(fake).value(noKey, LC.Active) === '' && lists(fake).value(badOrder, LC.Active) === true &&
    lists(fake).value(listRow(fake, 'pay_method', 'WAVE')._row, LC.Active) === false,
    'after onEdit the hand-typed rows that have a Key hold true; the row without a Key stays blank and the unticked box stays false');
  check(errorsOf(fake).length === 0, 'nothing in Errors', errorsOf(fake));
});

section('7. gasStore.addListOption: the upsert rule persisted in the Lists tab', () => {
  const fake = setupBook('addListOption');
  const L = lists(fake);
  const call = (rec, seed) => { const x = fake.newExecution(); const d = locked(fake, () => x.gasStore.addListOption(rec, seed === undefined ? [] : seed)); d.x = x; return d; };
  const dumpLists = () => L.dump();

  const a = call({ list: 'pay_method', key: 'AYA', label: 'AYA ဘဏ်', shop: '', note: 'added by Sister 2026-11-10' });
  const rowA = listRow(fake, 'pay_method', 'AYA');
  check(!a.error && same(plain(a.out), { status: 'ok', key: 'AYA' }) && !!rowA && rowA._row === 23 && rowA.Label === 'AYA ဘဏ်' && rowA.Active === true && rowA.Order === 5 && rowA.Shop === '' && rowA.Detail === '' && rowA.Note === 'added by Sister 2026-11-10',
    'append: a new key with a label becomes the row below the last one, active, Order = largest + 1', a.error ? a.error.message : rowA);
  const la = a.calls.filter(c => c.sheet === 'Lists');
  const fmtA = la.map((c, i) => (c.call === 'Range.setNumberFormat' && c.arg === '@' && c.row === 23 ? { i, col: c.col } : null)).filter(Boolean);
  const writeA = la.findIndex(c => c.call === 'Range.setValues' && c.row === 23);
  check(la.filter(c => c.call === 'Sheet.appendRow').length === 0 && writeA > 0 && same(fmtA.filter(f => f.i < writeA).map(f => f.col).sort(), [LC.Key, LC.Label, LC.Detail, LC.Note]),
    'never appendRow: the Key, Label, Detail and Note cells of the new row are set to @ first, then one setValues writes the row', { fmtA, writeA });
  check(once(a, 15000) && allHeld(valueWrites(a.calls)) && a.x.GAS_DASH_DIRTY === true && touches(a.calls, 'Dashboard') === 0 && a.calls.some(c => c.call === 'SpreadsheetApp.flush'),
    'under the script lock, flushed, the Dashboard flag raised, the Dashboard itself not touched', lockOf(a));
  check(plain(a.x.gasStore.listOptions('pay_method')).some(r => r.key === 'AYA'), 'the same execution reads the new row at once (the cache was dropped)');

  const before = dumpLists();
  const b = call({ list: 'pay_method', key: 'aya', label: 'Another name' });
  check(same(plain(b.out), { status: 'dup', key: 'AYA' }) && dumpLists() === before && b.calls.filter(c => c.write).length === 0 && b.x.GAS_DASH_DIRTY === false && once(b, 15000),
    'dup: the same key in another case with another label writes nothing, answers the stored key, raises no flag', plain(b.out));
  const c0 = call({ list: 'pay_method', key: 'UNKNOWNKEY', detail: '09 111' });
  check(same(plain(c0.out), { status: 'dup', key: 'UNKNOWNKEY' }) && dumpLists() === before, 'dup: an absent key without a label appends nothing');
  const c1 = call({ list: 'pay_method', key: 'A|B', label: 'bar in the key' });
  check(plain(c1.out).status === 'dup' && dumpLists() === before, 'dup: a key with | is never written');

  const d1 = call({ list: 'pay_method', key: 'AYA', detail: '09777123456' });
  const stored = L.value(23, LC.Detail);
  check(same(plain(d1.out), { status: 'ok', key: 'AYA' }) && stored === '09777123456' && typeof stored === 'string' && L.format(23, LC.Detail) === '@' && d1.x.GAS_DASH_DIRTY === true,
    'detail: set on an account that has none; the stored Detail 09777123456 is that string, leading zero kept', stored);
  const d2 = call({ list: 'pay_method', key: 'AYA', detail: '09777123456' });
  const d3 = call({ list: 'pay_method', key: 'AYA', detail: '09111222333', detailWas: '09000000000' });
  check(plain(d2.out).status === 'dup' && plain(d3.out).status === 'dup' && L.value(23, LC.Detail) === '09777123456',
    'detail: the same value is dup; a stale edit (detailWas is not what is stored) is dup and overwrites nothing');
  const d4 = call({ list: 'pay_method', key: 'aya', detail: '09111222333 ဦးမောင်', detailWas: '09777123456' });
  check(plain(d4.out).status === 'ok' && L.value(23, LC.Detail) === '09111222333 ဦးမောင်' && L.value(23, LC.Label) === 'AYA ဘဏ်' && L.value(23, LC.Active) === true && L.value(23, LC.Order) === 5,
    'detail: replaced when detailWas is the stored value; label, Active and Order untouched');
  const kbz = listRow(fake, 'pay_method', 'KBZ')._row;
  fake.hand.clearFormat('Lists', kbz, LC.Detail);
  const d5 = call({ list: 'pay_method', key: 'KBZ', detail: '0012345678901' });
  const setCalls = d5.calls.filter(c => c.sheet === 'Lists' && c.row === kbz && c.col === LC.Detail).map(c => c.call);
  check(plain(d5.out).status === 'ok' && L.value(kbz, LC.Detail) === '0012345678901' && L.format(kbz, LC.Detail) === '@' && same(setCalls, ['Range.setNumberFormat', 'Range.setValue']),
    'detail: the cell is set to @ before the value is written, so a cell whose format was cleared still keeps 0012345678901', { value: L.value(kbz, LC.Detail), setCalls });

  const cb = typeRow(fake, 'Lists', ['pay_method', ' cb']);      // typed in lower case with a space in front: the key is CB all the same
  const e1 = call({ list: 'pay_method', key: 'CB', label: 'CB ဘဏ်', detail: '0099' });
  check(plain(e1.out).status === 'ok' && plain(e1.out).key === 'CB' && L.value(cb, LC.Key) === ' cb' && L.value(cb, LC.Label) === 'CB ဘဏ်' && L.value(cb, LC.Detail) === '0099' && L.value(cb, LC.Active) === '' && L.lastRow() === cb,
    'label: a hand-typed row without a label gets the label (and the detail), found by its normalised key; its Key and Active cells are not touched', L.values()[cb - 1]);
  [LC.Key, LC.Label, LC.Detail, LC.Note].forEach(c => fake.hand.clearFormat('Lists', cb + 1, c));
  const e2 = call({ list: 'pay_method', key: '0977', label: '0977 Wave', detail: '09777000111', note: '0001' });
  check(plain(e2.out).status === 'ok' && same(L.values()[cb].slice(1, 3), ['0977', '0977 Wave']) && L.value(cb + 1, LC.Detail) === '09777000111' && L.value(cb + 1, LC.Note) === '0001' && L.value(cb + 1, LC.Order) === 6,
    'append: every text cell of the new row keeps its string even when the row had lost its text format (key 0977, detail 09777000111, note 0001)', L.values()[cb]);

  // An empty list: the seed rows come first, whatever the status.
  lists(fake).rows().filter(r => r.List === 'fabric').map(r => r._row).sort((p, q) => q - p).forEach(r => fake.hand.deleteRow('Lists', r));
  const sx = fake.newExecution();
  const seed = plain(sx.legacyListRows({ store: sx.gasStore }, 'fabric'));
  const f0 = call({ list: 'fabric', key: 'fonly', detail: 'a detail for a key nobody has' }, seed);
  check(plain(f0.out).status === 'dup' && same(listKeys(fake, 'fabric'), ['f1', 'f2', 'f3']) && lists(fake).rows().filter(r => r.List === 'fabric').every((r, i) => r.Active === true && r.Order === i + 1),
    'seed: with no row of that list the seed rows are written first, also when the status is dup', listKeys(fake, 'fabric'));
  const f1 = call({ list: 'fabric', key: 'fjersey9c2e', label: 'ဂျာစီ' }, seed);
  const jersey = listRow(fake, 'fabric', 'fjersey9c2e');
  check(plain(f1.out).status === 'ok' && same(listKeys(fake, 'fabric'), ['f1', 'f2', 'f3', 'fjersey9c2e']) && jersey.Order === 4 && jersey.Label === 'ဂျာစီ',
    'seed: the next add finds the three and only appends its own row with Order 4', listKeys(fake, 'fabric'));
  const emptyAgain = newBook('addListOption-seed');
  emptyAgain.newExecution().setupSheet();
  lists(emptyAgain).rows().filter(r => r.List === 'expense_category').map(r => r._row).sort((p, q) => q - p).forEach(r => emptyAgain.hand.deleteRow('Lists', r));
  const ex = emptyAgain.newExecution();
  const catSeed = plain(ex.legacyListRows({ store: ex.gasStore }, 'expense_category'));
  const g1 = locked(emptyAgain, () => ex.gasStore.addListOption({ list: 'expense_category', key: 'tea', label: 'လက်ဖက်ရည်ဖိုး' }, catSeed));
  const cats = lists(emptyAgain).rows().filter(r => r.List === 'expense_category');
  check(plain(g1.out).status === 'ok' && cats.length === 10 && same(cats.map(r => r.Key), catSeed.map(r => r.key).concat(['tea'])) && cats[9].Order === 10 && cats[8].Detail === '📦' &&
    lists(emptyAgain).rows().length === 22 && valueWrites(g1.calls, 'Lists').length === 1 && valueWrites(g1.calls, 'Lists')[0].rows === 10,
    'seed: the nine old categories and the new one are written as one block of ten rows; adding one option never hides the old ones', cats.map(r => r.Key));
  lists(emptyAgain).rows().filter(r => r.List === 'fabric').map(r => r._row).sort((p, q) => q - p).forEach(r => emptyAgain.hand.deleteRow('Lists', r));
  const ex2 = emptyAgain.newExecution();
  const g2 = locked(emptyAgain, () => ex2.gasStore.addListOption({ list: 'fabric', key: 'F2', detail: '100% ချည်' }, plain(ex2.legacyListRows({ store: ex2.gasStore }, 'fabric'))));
  const fabrics = lists(emptyAgain).rows().filter(r => r.List === 'fabric');
  check(same(plain(g2.out), { status: 'ok', key: 'f2' }) && same(fabrics.map(r => [r.Key, r.Detail, r.Order, r.Active]), [['f1', '', 1, true], ['f2', '100% ချည်', 2, true], ['f3', '', 3, true]]) &&
    valueWrites(g2.calls, 'Lists').length === 1, 'seed: a detail for one of the seed rows themselves is written with them, in the same block', fabrics.map(r => [r.Key, r.Detail]));

  // The tab is missing.
  fake.hand.deleteSheet('Lists');
  const mx = fake.newExecution();
  const m = locked(fake, () => mx.gasStore.addListOption({ list: 'expense_category', key: 'tea', label: 'လက်ဖက်ရည်ဖိုး' }, plain(mx.legacyListRows({ store: mx.gasStore }, 'expense_category'))));
  const tea = listRow(fake, 'expense_category', 'tea');
  check(!m.error && plain(m.out).status === 'ok' && lists(fake).rows().length === 22 && !!tea && tea.Order === 10 && tea._row === 23 && same(lists(fake).header(), CFG.LIST_COLS),
    'tab missing: it is created and seeded through ensureListsTab (21 rows), then the option is appended', m.error ? m.error.message : lists(fake).rows().length);
  check(lists(fake).validations('checkbox') === 999 && lists(fake).rules().length === 2 && lists(fake).format(18, LC.Key) === '@' && once(m, 15000) && mx.GAS_DASH_DIRTY === true,
    'with its tick boxes, highlights and text columns; ensureListsTab ran inside the same lock (one acquire, none while held)', lockOf(m));

  // The grid is full: tidy people delete the empty rows at the bottom.
  fake.hand.trimRows('Lists', 0);
  const fullAt = lists(fake).maxRows;
  const t = call({ list: 'pay_method', key: 'UAB', label: 'UAB ဘဏ်', detail: '0123' });
  check(fullAt === 23 && !t.error && plain(t.out).status === 'ok' && lists(fake).maxRows === 24 && lists(fake).value(24, LC.Key) === 'UAB' && lists(fake).value(24, LC.Detail) === '0123' && lists(fake).value(24, LC.Active) === true,
    'full grid: when the tab has no empty row left the sheet grows by the rows needed and the option is written', t.error ? t.error.message : lists(fake).values()[18]);

  // A box somebody ticked and unticked far below does not push the next option down there.
  const stray = setupBook('addListOption-stray');
  stray.hand.tick('Lists', 400, LC.Active, true, { trigger: false });
  stray.hand.tick('Lists', 400, LC.Active, false, { trigger: false });
  const sy = stray.newExecution();
  sy.gasStore.addListOption({ list: 'pay_method', key: 'AYA', label: 'AYA ဘဏ်' }, []);
  check(lists(stray).lastRow() === 400 && listRow(stray, 'pay_method', 'AYA')._row === 23, 'a stray unticked box in row 400 does not move the next option away from the list: it goes to row 23');

  // The caller's read is older than the lock: another request added the same account in between.
  const race = setupBook('addListOption-race');
  const mine = race.newExecution();
  const seenByMine = plain(mine.gasStore.listOptions('pay_method')).map(r => r.key);       // this request has read the tab
  race.newExecution().gasStore.addListOption({ list: 'pay_method', key: 'RACE', label: 'added by the other request' }, []);
  const stillStale = plain(mine.gasStore.listOptions('pay_method')).map(r => r.key);
  const late = locked(race, () => mine.gasStore.addListOption({ list: 'pay_method', key: 'RACE', label: 'added by this request' }, []));
  check(seenByMine.indexOf('RACE') < 0 && stillStale.indexOf('RACE') < 0 && same(plain(late.out), { status: 'dup', key: 'RACE' }) && listKeys(race, 'pay_method').filter(k => k === 'RACE').length === 1 &&
    listRow(race, 'pay_method', 'RACE').Label === 'added by the other request' && lists(race).rows().length === 22,
    'the whole body starts from a fresh read under the lock: an option another request added a moment ago is found (dup), not written twice and not overwritten', plain(late.out));
  // The same key typed a second time by hand: the first row is the option (the core ignores the second).
  const twin = typeRow(race, 'Lists', ['pay_method', 'race', 'a second row with the same key']);
  const firstRace = listRow(race, 'pay_method', 'RACE')._row;
  const onFirst = locked(race, () => race.newExecution().gasStore.addListOption({ list: 'pay_method', key: 'Race', detail: '0123' }, []));
  check(plain(onFirst.out).status === 'ok' && firstRace < twin && lists(race).value(firstRace, LC.Detail) === '0123' && lists(race).value(twin, LC.Detail) === '' && lists(race).value(twin, LC.Label) === 'a second row with the same key',
    'when a key stands in two rows, a detail is written to the first one, which is the row the core reads', { first: lists(race).value(firstRace, LC.Detail), twin: lists(race).value(twin, LC.Detail) });

  const u = call({ list: 'colours', key: 'red', label: 'Red' });
  check(!!u.error && /unknown list/.test(u.error.message) && !fake.lock.held && u.x.GAS_LOCK_DEPTH === 0 && u.acquires === 1 && u.releases === 1,
    'an unknown list name throws, and the lock is released', u.error ? u.error.message : plain(u.out));
  check(errorsOf(fake).length === 0 && errorsOf(emptyAgain).length === 0 && errorsOf(stray).length === 0, 'nothing in Errors', errorsOf(fake));
});

section('8. The core over the real store: ➕ by name, the account number', () => {
  const fake = setupBook('core-over-store');
  const x = fake.newExecution(), ports = x.buildPorts();
  const r1 = plain(x.addListOptionByLabel(ports, 'pay_method', 'KBZ ဦးမောင်', STAFF));
  const row = r1 && r1.key ? listRow(fake, 'pay_method', r1.key) : null;
  check(!!r1 && r1.ok === true && r1.created === true && /^KBZ[0-9A-F]{4}$/.test(r1.key) && r1.label === 'KBZ ဦးမောင်' && !!row && row.Label === 'KBZ ဦးမောင်' && row.Order === 5 && /^added by Sister \d{4}-\d{2}-\d{2}$/.test(row.Note),
    'addListOptionByLabel creates the account with a key made from the name and a note saying who added it', r1);
  const dump = lists(fake).dump();
  const r2 = plain(x.addListOptionByLabel(ports, 'pay_method', 'kbz  ဦးမောင်', { id: '1002', name: 'Brother', shop: 'S2', role: 'staff' }));
  check(!!r2 && r2.ok === true && r2.existed === true && r2.key === r1.key && lists(fake).dump() === dump, 'the same name again (other case and spacing, another seller) reuses it and writes nothing', r2);
  const r3 = plain(x.addListOptionByLabel(ports, 'pay_method', '09 777 123456', STAFF));
  check(!!r3 && r3.ok === false && r3.reason === 'empty' && lists(fake).dump() === dump, 'a name made of digits only (a mistyped amount) is refused and writes nothing', r3);
  const s1 = plain(x.setListDetail(ports, 'pay_method', r1.key, '  09777123456  '));
  const cellValue = lists(fake).value(row._row, LC.Detail);
  check(!!s1 && s1.ok === true && s1.saved === true && s1.detail === '09777123456' && cellValue === '09777123456' && typeof cellValue === 'string' && x.accountDetail(ports, r1.key) === '09777123456',
    'setListDetail stores the number as text: the cell holds the string 09777123456', { s1, cellValue });
  check(same(plain(x.transferLines(ports, 'S1')), ['KBZ ဦးမောင် 09777123456']) && same(plain(x.payMethods(ports, 'S1')), ['CASH', 'KBZ', 'WAVE', 'BANK', r1.key]),
    'so a receipt with a balance can print where to transfer, and the account is a method button', plain(x.transferLines(ports, 'S1')));
  const s2 = plain(x.setListDetail(ports, 'pay_method', r1.key, '09 111 222333 ဦးမောင်'));
  check(!!s2 && s2.saved === true && lists(fake).value(row._row, LC.Detail) === '09 111 222333 ဦးမောင်', 'a wrong number retyped replaces the old one', s2);
  const r4 = plain(x.addListOptionByLabel(ports, 'expense_category', 'ရေဖိုး', STAFF));
  check(!!r4 && r4.created === true && /^c[0-9a-f]{4}$/.test(r4.key) && plain(x.expenseCategories(ports)).some(c => c[0] === r4.key && c[1] === 'ရေဖိုး') && listRow(fake, 'expense_category', r4.key).Order === 10,
    'a Burmese category name gets a key that starts with a letter (c + 4 hex) and joins the category buttons', r4);
  const r6 = plain(x.addListOptionByLabel(ports, 'pay_method', '09 777 123456 ဒေါ်လှ', STAFF));
  const numbered = r6 && r6.key ? listRow(fake, 'pay_method', r6.key) : null;
  check(!!r6 && r6.created === true && /^B097771[0-9A-F]{4}$/.test(r6.key) && !!numbered && typeof numbered.Key === 'string' && numbered.Label === '09 777 123456 ဒေါ်လှ',
    'an account named by its number gets a key that starts with a letter (B + digits + 4 hex), stored as text', r6);
  const r5 = plain(x.addListOptionByLabel(ports, 'fabric', 'ဂျာစီ', STAFF));
  check(!!r5 && r5.created === true && /^f[0-9a-f]{4}$/.test(r5.key) && same(plain(x.fabricOptions(ports)).map(o => o.label), CFG.FABRIC_PRESETS.concat(['ဂျာစီ'])), 'and a fabric joins the fabric buttons', r5);
  check(errorsOf(fake).length === 0 && fake.lock.nested === 0 && !fake.lock.held, 'nothing in Errors; the lock was never taken while held');
});

section('9. gasStore.addDesign', () => {
  const fake = setupBook('addDesign');
  const D = () => fake.sheet('Designs').rows();
  const x = fake.newExecution();
  const a = locked(fake, () => x.gasStore.addDesign({ code: 'TSL-31', name: '', category: '', basePrice: '', daysToMake: '', active: true, note: 'created from an order by Sister' }));
  const made = plain(a.out);
  check(!a.error && same(made, { code: 'TSL-31', name: '', category: '', photoUrl: '', photoFileId: '', basePrice: '', daysToMake: '', active: true, note: 'created from an order by Sister' }),
    'a new code is appended and comes back in the shape getDesign returns', a.error ? a.error.message : made);
  check(D().length === 1 && D()[0].DesignCode === 'TSL-31' && D()[0].Active === true && D()[0].Note === 'created from an order by Sister' && same(plain(x.gasStore.getDesign('TSL-31')), made),
    'one Designs row, active, and getDesign finds it in the same execution');
  check(once(a, 15000) && allHeld(valueWrites(a.calls, 'Designs')) && valueWrites(a.calls, 'Designs').length === 1 && valueWrites(a.calls, 'Designs')[0].call === 'Sheet.appendRow',
    'written through the mapped-append helper (one appendRow) under the script lock', lockOf(a));
  const y = fake.newExecution();
  const b = locked(fake, () => y.gasStore.addDesign({ code: 'tsl31', name: 'another name', basePrice: 99000 }));
  check(!b.error && same(plain(b.out), made) && D().length === 1 && b.calls.filter(c => c.write).length === 0 && once(b, 15000),
    'the same code again (tsl31 is TSL-31) writes nothing and returns the stored design', plain(b.out));
  const c = locked(fake, () => y.gasStore.addDesign({ code: 'TSL-32', name: 'ဝမ်းဆက်', category: 'ဝတ်စုံ', basePrice: 45000, daysToMake: 7, note: '' }));
  check(!c.error && same(plain(c.out), { code: 'TSL-32', name: 'ဝမ်းဆက်', category: 'ဝတ်စုံ', photoUrl: '', photoFileId: '', basePrice: 45000, daysToMake: 7, active: true, note: '' }) && D().length === 2,
    'name, category, price and days are stored when given', plain(c.out));
  const e = locked(fake, () => y.gasStore.addDesign({ name: 'no code' }));
  check(!!e.error && /no code/.test(e.error.message) && !fake.lock.held && D().length === 2, 'without a code it throws and releases the lock');
  // Two sellers create the same code at the same moment: the second one reads again under the lock.
  const slow = fake.newExecution();
  const seen = plain(slow.gasStore.listDesigns()).length;
  fake.newExecution().gasStore.addDesign({ code: 'TSL-40', note: 'from the other request' });
  const f = locked(fake, () => slow.gasStore.addDesign({ code: 'TSL-40', note: 'from this request' }));
  check(seen === 2 && !f.error && plain(f.out).note === 'from the other request' && D().length === 3, 'a code another request created a moment ago is found under the lock, not written twice', plain(f.out));
  check(errorsOf(fake).length === 0, 'nothing in Errors', errorsOf(fake));
});

section('10. The Dashboard: the category block and the account block', () => {
  const fake = setupBook('dashboard');
  addStaff(fake);
  const F = accountFormulas(CFG);
  // An account and a category the family retired, and an account whose key carries a quote.
  fake.hand.tick('Lists', listRow(fake, 'pay_method', 'WAVE')._row, LC.Active, false, { trigger: false });
  fake.hand.tick('Lists', listRow(fake, 'expense_category', 'transport')._row, LC.Active, false, { trigger: false });
  typeRow(fake, 'Lists', ['pay_method', 'A"B', 'Quote "bank"', true, 9]);
  const d = locked(fake, () => fake.newExecution().setupSheet());
  const D = fake.sheet('Dashboard'), v = D.values();
  const at = label => v.findIndex(r => r[0] === label) + 1;
  const head = at('Money by account (this month)'), catHead = at('Expenses by category (this month)');
  check(!d.error && head > 0 && same(v[head - 1].slice(0, 5), ['Money by account (this month)', 'In', 'Out', 'Net', '']) && D.bold(head, 1) && D.bold(head, 4),
    'a bold heading row: Money by account (this month), In, Out, Net', d.error ? d.error.message : v[head - 1]);
  const accounts = [['KBZ', 'KBZPay'], ['WAVE', 'WavePay'], ['BANK', MSG.method_BANK], ['A"B', 'Quote "bank"']];
  const rowsOk = accounts.map((a, i) => {
    const r = head + 1 + i, cells = v[r - 1];
    return cells[0] === a[1] + ' (' + a[0] + ')' && cells[1] === '=' + F.mIn(a[0]) && cells[2] === '=' + F.mOut(a[0]) && cells[3] === '=B' + r + '-C' + r &&
      [2, 3, 4].every(c => D.isFormula(r, c) && D.format(r, c) === '#,##0');
  });
  check(rowsOk.every(Boolean) && v[head + accounts.length - 1 + 1][0] === '', 'one row per account that is not cash, a retired one (WAVE) included, in list order, each a number row: label (KEY), =In, =Out, =B-C', v.slice(head, head + accounts.length).map(r => r[0]));
  check(v[head][1] === '=SUMIFS(Ledger!$K:$K,Ledger!$D:$D,$D$2&"*",Ledger!$U:$U,"KBZ",Ledger!$K:$K,">0",Ledger!$T:$T,"=")+SUMIFS(Ledger!$K:$K,Ledger!$D:$D,$D$2&"*",Ledger!$U:$U,"KBZ",Ledger!$K:$K,"<0",Ledger!$T:$T,"<>")' &&
    v[head][2] === '=-(SUMIFS(Ledger!$K:$K,Ledger!$D:$D,$D$2&"*",Ledger!$U:$U,"KBZ",Ledger!$K:$K,"<0",Ledger!$T:$T,"=")+SUMIFS(Ledger!$K:$K,Ledger!$D:$D,$D$2&"*",Ledger!$U:$U,"KBZ",Ledger!$K:$K,">0",Ledger!$T:$T,"<>"))',
    'the KBZ row carries exactly the formula texts of spec section 1.5 (no Shop criterion, no blank-Method term)', v[head].slice(1, 3));
  check(v[head + 3][1].indexOf(',"A""B",') > 0, 'a quote inside a key is doubled in the criterion', v[head + 3][1]);
  check(v.every(r => !/\(CASH\)/.test(String(r[0]))), 'CASH has no row in the account block');
  const cats = v.slice(catHead, head - 2).map(r => r[0]);
  const y = fake.newExecution(), ports = y.buildPorts();
  check(catHead > 0 && head === catHead + cats.length + 2 && cats.length === 9 && cats.indexOf('ကားခ (transport)') === 3 && cats[8] === MSG.cat_other + ' (other)' &&
    !plain(y.expenseCategories(ports)).some(c => c[0] === 'transport'), 'the category block lists every expense category, the retired one (transport) included, and other; the account block follows it', cats);
  check(v[catHead + 8][1].indexOf('"other")+SUMIFS(') > 0 && /,"="\)\)$/.test(v[catHead + 8][1]) && v[catHead][1] === '=-(SUMIFS(Ledger!$J:$J,Ledger!$D:$D,$D$2&"*",Ledger!$G:$G,"EXPENSE",Ledger!$V:$V,"fabric"))',
    'the category formulas are the ones of version 3 (other also counts a blank Category)', v[catHead][1]);

  // The account formulas, read the way Sheets reads SUMIFS, equal the bot's own month report.
  const z = fake.newExecution(), zp = z.buildPorts();
  recordTelegram(z);
  z.gasStore.updateItem('S1-0001', { name: 'ပိုးအင်္ကျီ', category: 'အင်္ကျီ', type: 'SKU', price: 30000 });
  z.gasStore.updateItem('S2-0001', { name: 'ထမီ', category: 'ထမီ', type: 'SKU', price: 40000 });
  const s1 = () => z.gasStore.getItem('S1-0001'), s2 = () => z.gasStore.getItem('S2-0001'), brother = { id: '1002', name: 'Brother', shop: 'S2', role: 'staff' };
  z.commitRestock(zp, { item: s1(), qty: 9, staff: STAFF, source: 'BUTTON' });
  z.commitRestock(zp, { item: s2(), qty: 9, staff: brother, source: 'BUTTON' });
  z.commitSale(zp, { item: s1(), staff: STAFF, source: 'BUTTON', method: 'KBZ' });                                   // KBZ in 30,000
  const cashSale = z.commitSale(zp, { item: s1(), unitPrice: 20000, staff: STAFF, source: 'BUTTON' });               // cash, then marked KBZ: a mirror and a replacement
  const rw = plain(z.rewriteGroup(zp, cashSale.groupId, { method: 'KBZ' }, STAFF, 'u-1', { noteIfBlank: 'method' }));
  z.commitExpense(zp, { shop: 'S1', amount: 5000, category: 'fabric', method: 'KBZ', staff: STAFF, source: 'BUTTON' }); // KBZ out 5,000
  const undone = z.commitExpense(zp, { shop: 'S2', amount: 7000, category: 'other', method: 'KBZ', staff: brother, source: 'BUTTON' });
  const un1 = plain(z.undoGroup(zp, undone.groupId, brother));                                                       // the expense and its mirror net to nothing
  const waveSale = z.commitSale(zp, { item: s2(), staff: brother, source: 'BUTTON', method: 'WAVE' });
  const un2 = plain(z.undoGroup(zp, waveSale.groupId, brother));                                                     // WAVE in 40,000 and back
  const splitMe = z.commitSale(zp, { item: s1(), staff: STAFF, source: 'BUTTON' });
  const sp = plain(z.splitSale(zp, splitMe.groupId, 20000, 'BANK', STAFF, 'u-2', 'BUTTON'));                         // cash 10,000 + BANK 20,000
  z.commitSale(zp, { item: s2(), staff: brother, source: 'BUTTON', method: 'BANK' });                                // BANK in 40,000 in shop 2
  const ym = z.dayKey(new Date()).slice(0, 7), env = { '$D$2': ym };
  const stats = ['S1', 'S2'].map(shop => plain(z.monthStats(zp, shop, ym)).byMethod);
  const report = key => ({ in: stats.reduce((n, s) => n + (s[key] ? s[key].in : 0), 0), out: stats.reduce((n, s) => n + (s[key] ? s[key].out : 0), 0) });
  const sheet = key => ({ in: evalAccountFormula(fake, '=' + F.mIn(key), env), out: evalAccountFormula(fake, '=' + F.mOut(key), env) });
  check(rw.ok === true && un1.ok === true && un2.ok === true && sp.ok === true && sp.full === false && fake.sheet('Ledger').rows().length === 16,
    'a month of entries through the core and the real store: sales on KBZ, WAVE and BANK, a method rewrite, an expense, two undos, a split (16 Ledger rows)', { rw: rw.ok, un1, un2, sp, rows: fake.sheet('Ledger').rows().length });
  check(same(report('KBZ'), { in: 50000, out: 5000 }) && same(report('WAVE'), { in: 0, out: 0 }) && same(report('BANK'), { in: 60000, out: 0 }),
    'the bot\'s month report by method: KBZ in 50,000 out 5,000, WAVE 0, BANK in 60,000', { KBZ: report('KBZ'), WAVE: report('WAVE'), BANK: report('BANK') });
  check(['KBZ', 'WAVE', 'BANK'].every(k => same(sheet(k), report(k))),
    'the Dashboard formulas of those accounts, evaluated over the Ledger tab, give the same In and Out', { KBZ: sheet('KBZ'), WAVE: sheet('WAVE'), BANK: sheet('BANK') });
  check(allHeld(valueWrites(fake.calls(0, c => c.exec === fake.executions), 'Ledger')) && fake.lock.nested === 0,
    'every one of those Ledger writes (Telegram route: writeGroup inside ports.lock.run) was made while the lock was held');
  check(errorsOf(fake).length === 0, 'nothing in Errors', errorsOf(fake));
});

section('10b. The Dashboard rewrite: the grid grows before the tab is cleared, and a name that looks like a formula stays text', () => {
  // Tidy people delete the empty rows at the bottom of a tab. Every option added makes the Dashboard a row longer.
  const fake = setupBook('dashboard-grid');
  fake.props.WEBHOOK_SECRET = 'secret-1';
  addStaff(fake);
  const D = () => fake.sheet('Dashboard'), dashLabels = () => D().values().map(r => r[0]);
  let id = 7100;
  const update = () => ({ update_id: ++id, message: { message_id: id, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, text: '/help' } });
  const addByName = (list, name) => { let out = null; const t = request(fake, { token: 'secret-1' }, update(), x => { x.processUpdate = function (u, ports) { out = plain(x.addListOptionByLabel(ports, list, name, STAFF)); return 'ok'; }; }); t.added = out; return t; };
  const rowsBefore = D().lastRow();
  fake.hand.trimRows('Dashboard', 0);
  const t1 = addByName('pay_method', 'AYA bank');
  const grow = t1.calls.findIndex(c => c.call === 'Sheet.insertRowsAfter' && c.sheet === 'Dashboard'), clear = t1.calls.findIndex(c => c.call === 'Sheet.clear' && c.sheet === 'Dashboard');
  check(!t1.error && t1.reply.body === 'ok' && t1.added && t1.added.created === true && errorsOf(fake).length === 0 && D().lastRow() === rowsBefore + 1 && D().maxRows === rowsBefore + 1 &&
    dashLabels().indexOf('AYA bank (' + t1.added.key + ')') > 0 && dashRewrites(t1.calls) === 1,
    '➕ through doPost on a Dashboard with no empty row left: the rewrite is one row longer and has the new account; nothing in Errors', { error: t1.error ? t1.error.message : null, errors: errorKinds(fake), lastRow: D().lastRow(), rowsBefore });
  check(grow >= 0 && clear > grow && t1.calls[grow].held && t1.calls[clear].held, 'the grid is grown before the tab is cleared, under the lock', { grow, clear });
  fake.hand.trimRows('Dashboard', 0);
  const r = lists(fake).lastRow() + 1;
  const e1 = edit(fake, 'Lists', r, LC.List, 'expense_category'), e2 = edit(fake, 'Lists', r, LC.Key, 'tea');
  check(e1.fired && !e1.error && e2.fired && !e2.error && errorsOf(fake).length === 0 && D().lastRow() === rowsBefore + 2 && dashLabels().indexOf('tea (tea)') > 0,
    'a hand edit of the Lists tab on a trimmed Dashboard: onEdit rewrites it with the new category row', { errors: errorsOf(fake), lastRow: D().lastRow() });
  fake.hand.trimRows('Dashboard', 0);
  typeRow(fake, 'Lists', ['pay_method', 'CB', 'CB ဘဏ်']);
  const s = locked(fake, () => fake.newExecution().setupSheet());
  check(!s.error && D().lastRow() === rowsBefore + 3 && dashLabels().indexOf('CB ဘဏ် (CB)') > 0 && errorsOf(fake).length === 0,
    'setupSheet() on a trimmed Dashboard (the owner\'s repair tool) runs to its end and writes the longer Dashboard', s.error ? s.error.message : D().lastRow());
  // A failure on the way leaves the Dashboard as it was, never blank.
  fake.hand.trimRows('Dashboard', 0);
  const shown = D().dump();
  fake.failNext(c => c.call === 'Sheet.insertRowsAfter' && c.sheet === 'Dashboard', 'the grid cannot grow');
  const t2 = addByName('pay_method', 'MAB bank');
  check(!t2.error && t2.reply.body === 'ok' && fake.faultsLeft === 0 && same(errorKinds(fake), ['dashboard']) && D().dump() === shown && D().lastRow() === rowsBefore + 3 && t2.added && t2.added.created === true && !fake.lock.held,
    'a rewrite that fails before writing is one Errors row (dashboard) and leaves the Dashboard exactly as it was; the option is added', { faultsLeft: fake.faultsLeft, errors: errorKinds(fake), lastRow: D().lastRow() });

  // Names in column A come from the Lists tab, where anybody's ➕ or a hand edit can put any text.
  const book = setupBook('dashboard-text-names');
  book.props.WEBHOOK_SECRET = 'secret-1';
  addStaff(book);
  const BD = () => book.sheet('Dashboard'), at = label => BD().values().findIndex(row => row[0] === label) + 1;
  let made = null;
  request(book, { token: 'secret-1' }, update(), x => { x.processUpdate = function (u, ports) { made = plain(x.addListOptionByLabel(ports, 'pay_method', '=HYPERLINK("x")', STAFF)); return 'ok'; }; });
  const typed = lists(book).lastRow() + 1;
  edit(book, 'Lists', typed, LC.List, 'expense_category'); edit(book, 'Lists', typed, LC.Key, 'calc'); edit(book, 'Lists', typed, LC.Label, '=1+2');
  const acctRow = made ? at('=HYPERLINK("x") (' + made.key + ')') : 0, catRow = at('=1+2 (calc)');
  const madeRow = made ? listRow(book, 'pay_method', made.key) : null;
  check(made && made.created === true && madeRow && madeRow.Label === '=HYPERLINK("x")' && !lists(book).isFormula(madeRow._row, LC.Label) && !lists(book).isFormula(typed, LC.Label),
    'a ➕ name and a hand-typed label that start with "=" are text in the Lists tab (its Label column is plain text)', madeRow);
  check(acctRow > 0 && catRow > 0 && !BD().isFormula(acctRow, 1) && !BD().isFormula(catRow, 1) && BD().values().every(row => String(row[0]).charAt(0) !== "'"),
    'on the Dashboard they are the account row "=HYPERLINK("x") (KEY)" and the category row "=1+2 (calc)" as text, not formulas (and no apostrophe shows)', { acctRow, catRow, labels: BD().values().map(row => row[0]) });
  check(BD().values().filter((row, i) => BD().isFormula(i + 1, 1)).length === 1, 'the only formula in column A is the low-stock line');
  check(errorsOf(book).length === 0, 'nothing in Errors', errorsOf(book));
});

section('11. onEdit: a hand edit of the Lists tab ticks the row and rewrites the Dashboard', () => {
  const fake = setupBook('onEdit');
  const L = lists(fake), dashLabels = () => fake.sheet('Dashboard').values().map(r => r[0]);
  const other = fake.hand.type('Settings', fake.sheet('Settings').rows().find(r => r.Key === 'summary_hour')._row, 2, '20');
  check(other.fired && !other.error && same(serviceCalls(other.calls), ['Range.getSheet', 'Sheet.getName']) && other.calls.every(c => !c.write),
    'an edit in another tab: after asking the edited range for its sheet and that sheet for its name, onEdit makes no Sheet, Range or other call', serviceCalls(other.calls));
  check(fake.lock.acquires === 1 && fake.lock.waits.length === 1, 'and does not touch the script lock (the one acquire so far is setupSheet\'s)', fake.lock);
  const x = fake.newExecution();
  check(!thrown(() => x.onEdit()) && !thrown(() => x.onEdit({})) && !thrown(() => x.onEdit({ value: 'x' })), 'onEdit without an event or without a range returns quietly');

  const r = L.lastRow() + 1;
  const e1 = edit(fake, 'Lists', r, LC.List, 'pay_method');
  check(e1.fired && !e1.error && L.value(r, LC.Active) === '' && dashRewrites(e1.calls) === 1, 'typing the List cell of a new row: no Key yet, so no tick; the Dashboard is rewritten');
  const e2 = edit(fake, 'Lists', r, LC.Key, 'AYA');
  check(e2.fired && !e2.error && L.value(r, LC.Active) === true && dashLabels().indexOf('AYA (AYA)') > 0, 'typing the Key: the Active cell now holds true and the Dashboard has the account row "AYA (AYA)"', dashLabels());
  const e3 = edit(fake, 'Lists', r, LC.Label, 'AYA ဘဏ်');
  check(e3.fired && !e3.error && dashLabels().indexOf('AYA ဘဏ် (AYA)') > 0 && dashLabels().indexOf('AYA (AYA)') < 0 && dashRewrites(e3.calls) === 1, 'typing the Label: the Dashboard row is "AYA ဘဏ် (AYA)"');
  check([e1, e2, e3].every(e => once(e, 15000) && allHeld(e.calls.filter(c => c.write))), 'each of those edits took the lock once and wrote only while holding it', [e1, e2, e3].map(lockOf));
  const e4 = fake.hand.tick('Lists', r, LC.Active, false);
  check(e4.fired && !e4.error && L.value(r, LC.Active) === false && dashLabels().indexOf('AYA ဘဏ် (AYA)') > 0, 'unticking the box: it stays false (onEdit never writes into a cell that holds false) and the retired account keeps its Dashboard row');
  const cat = fake.hand.type('Lists', listRow(fake, 'expense_category', 'rent')._row, LC.Label, 'ဆိုင်ခန်းခ');
  check(cat.fired && !cat.error && dashLabels().indexOf('ဆိုင်ခန်းခ (rent)') > 0, 'renaming a category: the Dashboard\'s category row follows');
  check(throwsWith(() => fake.hand.type('Lists', r + 1, LC.List, 'colours'), /violates the data validation rules/) && throwsWith(() => fake.hand.type('Lists', r, LC.Shop, 'S3'), /violates/) &&
    !thrown(() => fake.hand.type('Lists', r, LC.Shop, 'S2')), 'the dropdowns refuse a list name or a shop that does not exist');
  fake.hand.deleteSheet('Dashboard');
  const e5 = fake.hand.type('Lists', r + 1, LC.Key, 'NODASH');
  check(e5.fired && !e5.error && L.value(r + 1, LC.Active) === true && errorsOf(fake).length === 0, 'without a Dashboard tab the edit is still handled: the tick is written and nothing is logged', errorsOf(fake));
  // A failure inside goes to the Errors tab, never to the person who typed.
  const broken = setupBook('onEdit-fails');
  broken.failNext(c => c.call === 'Sheet.clear' && c.sheet === 'Dashboard', 'the Dashboard cannot be written');
  const be = edit(broken, 'Lists', listRow(broken, 'fabric', 'f1')._row, LC.Label, 'ပိုးထည်');
  check(be.fired && !be.error && broken.faultsLeft === 0 && same(errorKinds(broken), ['onEdit']) && /the Dashboard cannot be written/.test(String(errorsOf(broken)[0].Message)) && !broken.lock.held && be.acquires === 1 && be.releases === 1,
    'an error inside onEdit is one Errors row and never reaches the person who typed; the lock is released', be.error ? be.error.message : errorKinds(broken));
});

section('11b. A warning about a Lists row is one Errors row, however often the tab is edited or the Dashboard rewritten', () => {
  // A key holding "|" is skipped and logged once (spec 1.1): once per 6 hours through the Script cache, for the
  // readers of gas_setup.js (onEdit, the Dashboard rewrite, setupSheet) as for the bot.
  const fake = setupBook('warn-once');
  addStaff(fake);
  const r = typeRow(fake, 'Lists', ['pay_method', 'A|B', 'bar bank']);
  const warned = book => errorKinds(book).filter(k => k === 'lists').length;
  const edits = ['one', 'two', 'three'].map(v => edit(fake, 'Lists', r, LC.Note, v));
  check(edits.every(e => e.fired && !e.error && dashRewrites(e.calls) === 1) && warned(fake) === 1 && errorKinds(fake).length === 1 && /contains "\|"/.test(String(errorsOf(fake)[0].Message)),
    'three hand edits of the Lists tab, each rewriting the Dashboard: the key with "|" is one Errors row, not three', errorKinds(fake));
  const s = locked(fake, () => fake.newExecution().setupSheet());
  const d = fake.newExecution();
  d.GAS_DASH_DIRTY = true;
  d.gasDashboardRefresh();
  const b = fake.newExecution(), methods = plain(b.payMethods(b.buildPorts()));
  check(!s.error && warned(fake) === 1 && errorKinds(fake).length === 1 && same(methods, CFG.DEFAULT_PAY_METHODS) && Object.keys(fake.cache).some(k => /^listkey:/.test(k)),
    'then setupSheet(), a Dashboard refresh and the bot: still that one row (the warning is remembered in the Script cache), and the key is no button', { errors: errorKinds(fake), methods });
  // The legacy path: the family deleted every pay_method row, so the core reads Settings pay_methods again, which holds a key that is too long.
  const legacy = setupBook('warn-once-legacy');
  for (let row = lists(legacy).lastRow(); row >= 2; row--) if (lists(legacy).value(row, LC.List) === 'pay_method') legacy.hand.deleteRow('Lists', row);
  setSetting(legacy, 'pay_methods', 'CASH,KBZ,TOOLONGKEY1234');
  const f = listRow(legacy, 'fabric', 'f1')._row;
  const l = ['one', 'two', 'three'].map(v => edit(legacy, 'Lists', f, LC.Note, v));
  check(l.every(e => e.fired && !e.error) && same(errorKinds(legacy), ['pay_methods']) && legacy.sheet('Dashboard').values().some(row => row[0] === 'KBZPay (KBZ)'),
    'a key of Settings pay_methods that is too long, read by three Dashboard rewrites (onEdit): one Errors row', errorKinds(legacy));
});

section('12. The Dashboard after a list change: once per request, in doPost\'s finally, on both branches', () => {
  const fake = setupBook('dirty-flag');
  fake.props.WEBHOOK_SECRET = 'secret-1';
  addStaff(fake);
  const update = id => ({ update_id: id, message: { message_id: id, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, text: '/help' } });
  const dashLabels = () => fake.sheet('Dashboard').values().map(r => r[0]);
  const z = fake.newExecution();
  const clear = locked(fake, () => z.gasDashboardRefresh());
  check(clear.calls.length === 0 && clear.acquires === 0, 'gasDashboardRefresh() with the flag clear returns before touching any service');

  // The round-4 bot's ➕ ends in ports.store.addListOption. Here the update handler is replaced by one that adds two options.
  let repliedAt = -1;                                   // the fake's log position when the bot's reply went out
  const t1 = request(fake, { token: 'secret-1' }, update(7001), x => {
    x.processUpdate = function (u, ports) {
      ports.store.addListOption({ list: 'pay_method', key: 'AYA', label: 'AYA ဘဏ်' }, []);
      ports.store.addListOption({ list: 'expense_category', key: 'tea', label: 'လက်ဖက်ရည်ဖိုး' }, []);
      ports.chat.sendMessage(1001, '➕ added');
      repliedAt = fake.log.length;
      return 'ok';
    };
  });
  check(!t1.error && t1.reply && t1.reply.kind === 'html' && t1.reply.body === 'ok' && dashRewrites(t1.calls) === 1 && dashLabels().indexOf('AYA ဘဏ် (AYA)') > 0 && dashLabels().indexOf('လက်ဖက်ရည်ဖိုး (tea)') > 0,
    'Telegram branch: two options added in one request, the Dashboard is rewritten once and shows both; the reply is ok()', { rewrites: dashRewrites(t1.calls), reply: t1.reply });
  const lastListWrite = t1.calls.map(c => c.sheet === 'Lists' && c.write === 'value').lastIndexOf(true), firstDash = t1.calls.findIndex(c => c.sheet === 'Dashboard');
  check(t1.sent.length === 1 && repliedAt > 0 && firstDash > 0 && t1.calls[firstDash].n >= repliedAt && t1.calls.filter(c => c.n < repliedAt && c.sheet === 'Dashboard').length === 0,
    'the bot\'s ➕ reply went out before the first call on the Dashboard tab: it never waits for the rewrite', { repliedAt, firstDashboardCall: firstDash > 0 ? t1.calls[firstDash].n : null });
  check(lastListWrite > 0 && firstDash > lastListWrite && t1.acquires === 3 && t1.releases === 3 && t1.nested === 0 && same(t1.waits, [15000, 15000, 15000]) &&
    allHeld(t1.calls.filter(c => c.sheet === 'Dashboard' && c.write)) && t1.x.GAS_DASH_DIRTY === false,
    'after the last Lists write, under its own lock (three acquires: two adds and the rewrite, none while held), and the flag is clear again', lockOf(t1));
  const t2 = request(fake, { token: 'secret-1' }, update(7002), x => { x.processUpdate = function () { return 'ok'; }; });
  check(!t2.error && t2.reply.body === 'ok' && touches(t2.calls, 'Dashboard') === 0 && t2.acquires === 0, 'Telegram branch, nothing added: no call on the Dashboard tab, no lock', serviceCalls(t2.calls));
  const t3 = request(fake, { token: 'secret-1' }, update(7003), x => {
    x.processUpdate = function (u, ports) { ports.store.addListOption({ list: 'pay_method', key: 'aya', label: 'again' }, []); return 'ok'; };
  });
  check(touches(t3.calls, 'Dashboard') === 0 && t3.acquires === 1, 'an add that changes nothing (dup) raises no flag: no rewrite', serviceCalls(t3.calls).filter(c => /Dashboard/.test(c)));
  const t4 = request(fake, { token: 'secret-1' }, update(7004), x => {
    x.processUpdate = function (u, ports) { ports.store.addListOption({ list: 'fabric', key: 'fjersey', label: 'ဂျာစီ' }, []); throw new Error('the handler failed after the add'); };
  });
  check(!t4.error && t4.reply.body === 'ok' && dashRewrites(t4.calls) === 1 && same(errorKinds(fake), ['doPost']), 'a request that fails after the add still answers ok(), logs the failure and rewrites the Dashboard (finally)', errorKinds(fake));
  fake.failNext(c => c.call === 'Sheet.clear' && c.sheet === 'Dashboard', 'the Dashboard cannot be written');
  const t5 = request(fake, { token: 'secret-1' }, update(7005), x => {
    x.processUpdate = function (u, ports) { ports.store.addListOption({ list: 'fabric', key: 'fvelvet', label: 'ကတ္တီပါ' }, []); return 'ok'; };
  });
  check(!t5.error && t5.reply.body === 'ok' && fake.faultsLeft === 0 && same(errorKinds(fake), ['doPost', 'dashboard']) && !fake.lock.held && t5.x.GAS_LOCK_DEPTH === 0 && listKeys(fake, 'fabric').indexOf('fvelvet') > 0,
    'a failing rewrite is one Errors row (dashboard); the reply and the option are not affected and the lock is released', errorKinds(fake));

  // The ?api= branch. Until the sync server knows the list kind (step 3) the option is added before doPost in the same execution.
  const a1 = request(fake, { api: 'ping' }, {}, x => { x.gasStore.addListOption({ list: 'pay_method', key: 'CB', label: 'CB ဘဏ်' }, []); });
  check(!a1.error && a1.json && a1.json.ok === true && a1.reply.kind === 'json' && dashRewrites(a1.calls) === 1 && dashLabels().indexOf('CB ဘဏ် (CB)') > 0,
    '?api= branch: the flag raised during the execution is honoured after the JSON reply was built (one rewrite)', { rewrites: dashRewrites(a1.calls), json: a1.json });
  const a2 = request(fake, { api: 'ping' }, {});
  check(a2.json && a2.json.ok === true && a2.calls.length === 2 && same(serviceCalls(a2.calls), ['ContentService.createTextOutput', 'TextOutput.setMimeType']),
    '?api= branch, nothing added: the request makes no call besides building its reply', serviceCalls(a2.calls));
  const a3 = request(fake, { api: 'sync' }, '{not json');
  check(a3.json && a3.json.error === 'bad_request' && touches(a3.calls, 'Dashboard') === 0, 'a body that is not JSON still answers bad_request and leaves the Dashboard alone');
  check(fake.lock.nested === 0 && !fake.lock.held, 'the lock was never taken while held in any of these requests');
});

const SYNC_NOW = new Date();
/** A ledger row as a phone pushes it. */
function syncTx(o) {
  return Object.assign({
    txId: '', groupId: '', time: SYNC_NOW.toISOString(), day: '', shop: 'S1', itemId: 'S1-0001', type: 'SALE', qty: -1, unitPrice: 30000, amount: 30000, cash: 30000,
    costAtSale: '', customerId: '', refGroupId: '', note: '', source: 'BUTTON', transcript: '', staffId: '1001', updateId: '', reversesTxId: '', method: 'CASH', category: '', receiptNo: ''
  }, o);
}
/** Staff, one registered item, and a phone enrolled through the real handler. */
function enrolledBook(label) {
  const fake = setupBook(label);
  addStaff(fake);
  typeRow(fake, 'Staff', ['1009', 'Owner', 'S1', 'owner', '']);
  const x = fake.newExecution();
  x.gasStore.updateItem('S1-0001', { name: 'ပိုးအင်္ကျီ', category: 'အင်္ကျီ', type: 'SKU', price: 30000 });
  const minted = fake.newExecution().syncMintEnrollCode('1001', 'S1', 'staff', 'Sister phone');
  const en = request(fake, { api: 'enroll' }, { code: minted.code, platform: 'test', label: 'Sister phone', appVersion: 1 });
  if (!en.json || !en.json.ok) throw new Error('enrolment failed: ' + JSON.stringify(en.json));
  const device = en.json.device;
  const creds = () => ({ device: device.id, token: device.token, appVersion: 1, clientTime: new Date().toISOString() });
  return { fake, device, creds, day: x.dayKey(SYNC_NOW) };
}

section('13. Sync: the Settings a phone receives carry the lists (real gasSyncStore, real handler)', () => {
  const { fake, creds } = enrolledBook('sync-settings');
  const x = fake.newExecution();
  const sp = x.gasSyncServerPorts();
  const settings = plain(x.syncSettingsFor(sp));
  const parsed = settings.lists_json ? JSON.parse(settings.lists_json) : null;
  check(!!parsed && same(Object.keys(parsed), CFG.LIST_NAMES) && same(parsed.pay_method, [{ k: 'CASH', l: MSG.method_CASH, a: 1, o: 1, s: '', d: '' }, { k: 'KBZ', l: 'KBZPay', a: 1, o: 2, s: '', d: '' },
    { k: 'WAVE', l: 'WavePay', a: 1, o: 3, s: '', d: '' }, { k: 'BANK', l: MSG.method_BANK, a: 1, o: 4, s: '', d: '' }]) && parsed.expense_category.length === 9 && parsed.fabric.length === 3,
    'syncSettingsFor over the real gasSyncStore adds lists_json: the Lists tab as compact rows', parsed && parsed.pay_method);
  check(settings.pay_methods === CFG.DEFAULT_PAY_METHODS.join(',') && settings.summary_hour === 21 && typeof sp.store.listOptions === 'function' && typeof sp.store.addListOption === 'function' && typeof sp.store.addDesign === 'function',
    'next to the Settings rows themselves; the sync store carries listOptions, addListOption and addDesign');
  const boot = request(fake, { api: 'bootstrap' }, creds());
  check(boot.json && boot.json.ok === true && typeof boot.json.settings.lists_json === 'string' && boot.json.settings.lists_json === settings.lists_json && typeof boot.json.settingsHash === 'string',
    'api=bootstrap through doPost sends it to the phone', boot.json && Object.keys(boot.json.settings || {}).length);
  // An edit in the Lists tab changes the hash, so the next pull carries the new Settings.
  const pull1 = request(fake, { api: 'sync' }, Object.assign(creds(), { pull: { ledgerSeq: 0, settingsHash: boot.json.settingsHash } }));
  fake.hand.type('Lists', listRow(fake, 'pay_method', 'KBZ')._row, LC.Detail, '09777123456', { trigger: false });
  fake.hand.tick('Lists', listRow(fake, 'pay_method', 'WAVE')._row, LC.Active, false, { trigger: false });
  const pull2 = request(fake, { api: 'sync' }, Object.assign(creds(), { pull: { ledgerSeq: 0, settingsHash: boot.json.settingsHash } }));
  const pm2 = pull2.json && pull2.json.pull && pull2.json.pull.settings ? JSON.parse(pull2.json.pull.settings.lists_json).pay_method : null;
  check(pull1.json && pull1.json.pull.settings === null && !!pm2 && pm2[1].d === '09777123456' && pm2[2].a === 0 && pull2.json.pull.settingsHash !== boot.json.settingsHash,
    'a pull with the current hash carries no Settings; after a hand edit of the Lists tab the hash differs and the pull carries the new lists (account number as text, WAVE inactive)', pm2);
  // A hand-typed Settings row with the derived name is never passed through.
  typeRow(fake, 'Settings', ['lists_json', '{"pay_method":[{"k":"HACK","l":"typed by hand","a":1,"o":1,"s":"","d":""}]}']);
  const y = fake.newExecution();
  const s2 = plain(y.syncSettingsFor(y.gasSyncServerPorts()));
  check(typeof s2.lists_json === 'string' && s2.lists_json.indexOf('HACK') < 0 && JSON.parse(s2.lists_json).pay_method.length === 4, 'a Settings row called lists_json typed by hand is replaced by the derived value');
  fake.hand.deleteSheet('Lists');
  const w = fake.newExecution();
  const s3 = plain(w.syncSettingsFor(w.gasSyncServerPorts()));
  check(!('lists_json' in s3) && s3.pay_methods === CFG.DEFAULT_PAY_METHODS.join(','), 'and on a sheet without the Lists tab no lists_json is sent at all (the phone keeps the legacy lists)');
});

section('14. Sync: one push through the real handler; the batch lock is never taken twice and covers every Ledger write', () => {
  const { fake, device, creds, day } = enrolledBook('sync-push');
  const pre = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'b0', entries: [
    { kind: 'group', entryId: 'e-r', groupId: 'g-restock', txs: [syncTx({ txId: 't-restock', groupId: 'g-restock', day, type: 'RESTOCK', qty: 5, unitPrice: '', amount: 0, cash: 0, method: '' })] }
  ] } }));
  check(pre.json && pre.json.ok === true && pre.json.push.results[0].status === 'ok', 'a restock pushed first, so the sale below raises no stock flag', pre.json && pre.json.push);
  // [list entry, sale group]. Step 3 adds the measurement entry to this batch (and the list kind to the server).
  const listKnown = fake.newExecution().SYNC.ENTRY_KINDS.list !== undefined;
  const entries = [
    { kind: 'list', entryId: 'e-list', rec: { list: 'pay_method', key: 'AYA1A2B', label: 'AYA ဘဏ်', shop: '', note: 'added by Sister ' + day } },
    { kind: 'group', entryId: 'e-sale', groupId: 'g-sale', txs: [syncTx({ txId: 't-sale', groupId: 'g-sale', day, receiptNo: 'R1-A-000001', method: 'KBZ' })] }
  ];
  const push = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'b1', entries }, pull: { ledgerSeq: 0 } }));
  const results = push.json && push.json.push ? push.json.push.results : [];
  const byEntry = id => results.find(r => r.entryId === id) || {};
  check(!push.error && push.json && push.json.ok === true && byEntry('e-sale').status === 'ok' && same(byEntry('e-sale').seq, [2]), 'the sale group of the batch is applied (Seq 2)', push.json && push.json.push);
  if (listKnown) {
    check(byEntry('e-list').status === 'ok' && !!listRow(fake, 'pay_method', 'AYA1A2B') && dashRewrites(push.calls) === 1,
      'the list entry is applied inside the batch: the option is in the Lists tab and the Dashboard was rewritten once, after the batch', byEntry('e-list'));
  } else {
    check(byEntry('e-list').status === 'quarantined' && byEntry('e-list').reason === 'bad_kind' && listRow(fake, 'pay_method', 'AYA1A2B') === null && same(errorKinds(fake), ['sync_reject']),
      'the list entry is answered bad_kind today: the list kind reaches the sync server in step 3 (this check then expects ok)', byEntry('e-list'));
  }
  const ledgerWrites = valueWrites(push.calls, 'Ledger');
  check(push.nested === 0 && push.stray === 0 && !push.held, 'the fake LockService reports no acquire while the lock was held, and the lock is free after the request', lockOf(push));
  check(ledgerWrites.length === 1 && allHeld(ledgerWrites) && ledgerWrites[0].call === 'Range.setValues' && ledgerWrites[0].row === 3 && ledgerWrites[0].cols === CFG.LEDGER_COLS.length,
    'the lock is held at every write to the Ledger tab (one block write for the group)', ledgerWrites);
  const seqWrites = push.calls.filter(c => c.call === 'Properties.setProperty' && c.arg === 'LEDGER_SEQ');
  check(seqWrites.length === 1 && allHeld(seqWrites) && fake.props.LEDGER_SEQ === '2', 'and at the LEDGER_SEQ increment that numbers the row', seqWrites);
  const sale = fake.sheet('Ledger').rows().find(r => r.TxID === 't-sale');
  check(!!sale && sale.Seq === 2 && sale.DeviceID === device.id && sale.Method === 'KBZ' && sale.Day === day && typeof sale.Day === 'string' && sale.ReceiptNo === 'R1-A-000001' && sale.Amount === 30000,
    'the row in the Ledger tab is the phone\'s row plus Seq, ReceivedAt and DeviceID', sale);
  check(push.json.pull && push.json.pull.ledger.length === 2 && typeof push.json.pull.settings.lists_json === 'string', 'the same request pulls both rows and the Settings with lists_json');
  const again = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'b1', entries: [entries[1]] } }));
  check(again.json.push.results[0].status === 'dup' && valueWrites(again.calls, 'Ledger').length === 0 && again.nested === 0, 'the batch sent again is dup and writes nothing');

  // A store method that locks itself, called inside the batch lock, neither takes nor frees it.
  const x = fake.newExecution();
  recordTelegram(x);
  const sp = x.gasSyncServerPorts(), heldAfter = {};
  const nestedRun = locked(fake, () => sp.lock.run(function () {
    heldAfter.start = fake.lock.held;
    x.gasStore.addListOption({ list: 'pay_method', key: 'INBATCH', label: 'In the batch' }, []); heldAfter.addListOption = fake.lock.held;
    x.gasStore.addMeasurement({ customerId: 'C-0001', orderId: '', day: day, staffId: '1001', source: 'FORM', notes: '', fields: { neck: '14', sleeve_round: '36/30/20' } }); heldAfter.addMeasurement = fake.lock.held;
    x.gasStore.addCustomer({ name: 'ဒေါ်မြ' }); heldAfter.addCustomer = fake.lock.held;
    x.gasStore.nextOrderNo('S1'); heldAfter.nextOrderNo = fake.lock.held;
    x.gasStore.addDesign({ code: 'TSL-77' }); heldAfter.addDesign = fake.lock.held;
    x.gasDedupe.remember('9100'); heldAfter.remember = fake.lock.held;
    x.buildPorts().lock.run(function () { return 1; }); heldAfter.portsLock = fake.lock.held;
    x.ensureListsTab(x.gasSpreadsheet()); heldAfter.ensureListsTab = fake.lock.held;
    sp.sync.appendRows([Object.assign(syncTx({ txId: 't-after', groupId: 'g-after', day }), { seq: sp.devices.nextSeq(), receivedAt: SYNC_NOW.toISOString(), deviceId: device.id })]);
    return 'done';
  }));
  check(!nestedRun.error && nestedRun.out === 'done' && Object.keys(heldAfter).length === 9 && Object.keys(heldAfter).every(k => heldAfter[k] === true),
    'inside sp.lock.run the lock is still held after addListOption, addMeasurement, addCustomer, nextOrderNo, addDesign, gasDedupe.remember, ports.lock.run and ensureListsTab', nestedRun.error ? nestedRun.error.message : heldAfter);
  check(once(nestedRun, 15000) && allHeld(valueWrites(nestedRun.calls)) && valueWrites(nestedRun.calls, 'Ledger').length === 1,
    'the whole batch is one acquire and one release, with no acquire while held; the Ledger row appended after those calls was still written under the lock', lockOf(nestedRun));
  check(!!listRow(fake, 'pay_method', 'INBATCH') && fake.sheet('Measurements').rows().length === 1 && fake.sheet('Customers').rows().length === 1 && fake.sheet('Designs').rows().length === 1 && x.GAS_LOCK_DEPTH === 0,
    'and each of them did its work');

  // The Ledger tab has no empty row left (appendRow fills it to its last grid row): the block write still lands.
  fake.hand.trimRows('Ledger', 0);
  const full = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'b2', entries: [
    { kind: 'group', entryId: 'e-2', groupId: 'g-two', txs: [syncTx({ txId: 't-two-a', groupId: 'g-two', day, receiptNo: 'R1-A-000002' }), syncTx({ txId: 't-two-b', groupId: 'g-two', day, type: 'PAYMENT', itemId: '', qty: 0, unitPrice: '', amount: 5000, cash: 5000, refGroupId: 'g-two', method: 'KBZ' })] }
  ] } }));
  check(full.json && full.json.ok === true && full.json.push.results[0].status === 'ok' && fake.sheet('Ledger').rows().length === 5 && fake.sheet('Ledger').maxRows === 6 && allHeld(valueWrites(full.calls, 'Ledger')),
    'a group pushed when the Ledger tab is full to its last grid row grows the sheet and is written as one block', full.json && (full.json.push || full.json));

  // Another process holds the lock for too long.
  const rowsBefore = fake.sheet('Ledger').rows().length;
  fake.lock.busy = true;
  const busy = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'b3', entries: [
    { kind: 'group', entryId: 'e-3', groupId: 'g-busy', txs: [syncTx({ txId: 't-busy', groupId: 'g-busy', day, receiptNo: 'R1-A-000003' })] }
  ] } }));
  fake.lock.busy = false;
  check(busy.json && busy.json.ok === false && busy.json.error === 'busy' && busy.json.retryAfterSec === 10 && fake.sheet('Ledger').rows().length === rowsBefore && busy.x.GAS_LOCK_DEPTH === 0 && !fake.lock.held,
    'a lock timeout answers {ok: false, error: busy} and writes no Ledger row; the phone keeps the batch', busy.json);
  const retry = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'b3', entries: [
    { kind: 'group', entryId: 'e-3', groupId: 'g-busy', txs: [syncTx({ txId: 't-busy', groupId: 'g-busy', day, receiptNo: 'R1-A-000003' })] }
  ] } }));
  check(retry.json.push.results[0].status === 'ok' && fake.sheet('Ledger').rows().length === rowsBefore + 1, 'and the retry is applied');
  check(fake.lock.nested === 0 && fake.lock.strayReleases === 0 && fake.lock.leaked === 0, 'over all these requests: no acquire while held, no release of a lock that was not held, no lock left behind', fake.lock);
});

section('14b. Sync, step 3: [list entry, sale group, measurement entry] in one push through the real handler', () => {
  // Spec 12 adds the measurement entry to the batch of section 14. It gets a spreadsheet of its own here: section 14 counts
  // exactly one Measurements row (its own addMeasurement inside sp.lock.run) after that batch, and that check stays as it is.
  const { fake, creds, day } = enrolledBook('sync-measure');
  const x0 = fake.newExecution();
  const customer = plain(x0.gasStore.addCustomer({ name: 'ဒေါ်မြ' }));
  x0.gasStore.addOrder({ id: 'V1-0007', shop: 'S1', customerId: customer.id, orderedDay: day, status: 'OPEN' });
  const pre = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'm0', entries: [
    { kind: 'group', entryId: 'e-r', groupId: 'g-restock', txs: [syncTx({ txId: 't-restock', groupId: 'g-restock', day, type: 'RESTOCK', qty: 5, unitPrice: '', amount: 0, cash: 0, method: '' })] }
  ] } }));
  const fields = { neck: '14', sleeve_round: '36/30/20', bust: '17.5' };
  const entries = [
    { kind: 'list', entryId: 'e-list', rec: { list: 'pay_method', key: 'AYA1A2B', label: 'AYA ဘဏ်', shop: '', note: 'added by Sister ' + day } },
    { kind: 'group', entryId: 'e-sale', groupId: 'g-sale', txs: [syncTx({ txId: 't-sale', groupId: 'g-sale', day, receiptNo: 'R1-A-000001', method: 'KBZ' })] },
    { kind: 'measurement', entryId: 'e-meas', rec: { customerId: customer.id, orderId: 'V1-0007', day, staffId: '1001', source: 'FORM', notes: 'ပထမ', fields } }
  ];
  const push = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'm1', entries }, pull: { ledgerSeq: 0, measAfter: 0 } }));
  const results = push.json && push.json.push ? push.json.push.results : [];
  const byEntry = id => results.find(r => r.entryId === id) || {};
  check(pre.json && pre.json.ok === true && !push.error && byEntry('e-list').status === 'ok' && byEntry('e-sale').status === 'ok' && byEntry('e-meas').status === 'ok' && byEntry('e-meas').id === 'M-00001',
    'the three entries of one push are applied: the option, the sale, the session (M-00001)', push.error ? push.error.message : results);
  check(push.nested === 0 && push.stray === 0 && !push.held, 'the fake LockService reports no acquire while the lock was held, and the lock is free after the request', lockOf(push));
  const held = ['Ledger', 'Measurements', 'Lists', 'Orders'].filter(tab => !allHeld(valueWrites(push.calls, tab)));
  check(held.length === 0, 'the lock is held at every write to the Ledger, Measurements, Lists and Orders tabs (addMeasurement and addListOption inside the batch keep it)', held);
  const row = fake.sheet('Measurements').rows()[0] || {};
  check(fake.sheet('Measurements').rows().length === 1 && row.MeasID === 'M-00001' && row.CustomerID === customer.id && row.OrderID === 'V1-0007' && row.Source === 'FORM' && row.StaffID === '1001' &&
    row.Day === day && row.Notes === 'ပထမ' && row.sleeve_round === '36/30/20' && row.bust === '17.5' && fake.sheet('Orders').rows()[0].MeasID === 'M-00001',
    'the session row: source FORM, the voucher of the same customer kept, every value the text that was typed; the order gets MeasID', row);
  const pulled = (push.json && push.json.pull) || {};
  const m0 = (pulled.measurements || [])[0] || {};
  check((pulled.measurements || []).length === 1 && m0.id === 'M-00001' && m0.n === 1 && m0.customerId === customer.id && m0.orderId === 'V1-0007' && m0.day === day && m0.notes === 'ပထမ' &&
    same(sorted(m0.fields || {}), sorted(fields)) && pulled.measNext === 1 && pulled.measFrom === 0 && pulled.more === false,
    'the same request pulls it (measAfter 0): {id, n, customerId, orderId, day, notes, fields} with the blank fields left out', pulled.measurements);
  const mf = pulled.settings && pulled.settings.meas_fields_json ? JSON.parse(pulled.settings.meas_fields_json) : [];
  check(mf.length === CFG.MEASURE_FIELDS.length && same(Object.keys(mf[0]), ['key', 'labelMy', 'labelEn', 'group', 'multi', 'type', 'order', 'active']) && mf[0].key === CFG.MEASURE_FIELDS[0][0] && mf[0].active === true,
    'its Settings carry meas_fields_json, the MeasureFields tab read through the real gasSyncStore', mf[0]);
  const again = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'm1', entries: [entries[2]] } }));
  check(again.json && again.json.push.results[0].status === 'dup' && again.json.push.results[0].id === 'M-00001' && fake.sheet('Measurements').rows().length === 1 && valueWrites(again.calls, 'Measurements').length === 0,
    'the measurement entry sent again is a dup with the same id and writes nothing', again.json && again.json.push);
  const older = request(fake, { api: 'sync' }, Object.assign(creds(), { pull: { ledgerSeq: 0 } }));
  check(older.json && older.json.ok === true && !('measurements' in older.json.pull) && !('measNext' in older.json.pull) && older.json.pull.more === false,
    'a pull without measAfter (a phone with the core of before step 3) carries no sessions');
  check(fake.lock.nested === 0 && fake.lock.strayReleases === 0 && fake.lock.leaked === 0 && errorsOf(fake).length === 0, 'over these requests: no acquire while held, no stray release, no lock left, nothing in Errors', errorKinds(fake));
});

section('14c. gasStore.listAllMeasurements: every session of every customer, oldest first', () => {
  const fake = setupBook('meas-all');
  const x = fake.newExecution();
  x.gasStore.addMeasurement({ customerId: 'C-0002', orderId: '', day: '2026-11-01', staffId: '1001', source: 'CHAT', photoUrl: '', notes: 'a', fields: { neck: '14', sleeve_round: '36/30/20' } });
  x.gasStore.addMeasurement({ customerId: 'C-0001', orderId: 'V1-0003', day: '2026-11-02', staffId: '1002', source: 'FORM', photoUrl: '', notes: '', fields: { bust: '17.5' } });
  x.gasStore.addMeasurement({ customerId: 'C-0002', orderId: '', day: '2026-11-03', staffId: '1001', source: 'PHOTO', photoUrl: '', notes: '', fields: { neck: '14.5' } });
  const y = fake.newExecution();
  const read = locked(fake, () => y.gasStore.listAllMeasurements());
  const all = plain(read.out) || [];
  check(!read.error && same(all.map(m => m.id), ['M-00001', 'M-00002', 'M-00003']) && same(all.map(m => m.customerId), ['C-0002', 'C-0001', 'C-0002']) && read.acquires === 0 && valueWrites(read.calls).length === 0,
    'every session, oldest first, whatever the customer; a read without the lock and without a write', read.error ? read.error.message : all.map(m => m.id));
  const keys = ['id', 'customerId', 'orderId', 'day', 'staffId', 'source', 'notes', 'fields'];
  check(all.length === 3 && all.every(m => keys.every(k => k in m)) && all[0].day === '2026-11-01' && all[0].fields.sleeve_round === '36/30/20' && all[1].fields.bust === '17.5' && all[1].fields.neck === '' &&
    all[1].orderId === 'V1-0003' && all[1].source === 'FORM' && all[1].staffId === '1002' && all[0].notes === 'a',
    'each as {id, customerId, orderId, day, staffId, source, notes, fields}, values as text and blank cells as empty strings', all[1]);
  const sp = y.gasSyncServerPorts();
  check(same(all, plain(y.gasStore.listMeasurements())) && typeof sp.store.listAllMeasurements === 'function', 'the same records as listMeasurements() without a customer; the sync store carries the method');
  const page = plain(y.syncMeasPage(sp.store.listAllMeasurements(), 1, 1));
  check(page.list.length === 1 && page.list[0].id === 'M-00002' && page.list[0].n === 2 && same(page.list[0].fields, { bust: '17.5' }) && page.next === 2 && page.more === true,
    'the sync core pages them by number over the real store: after 1, one per page, gives M-00002 (blank fields left out) and more', page);
});

section('14d. EntryID (fix round): a session from a phone keeps its outbox entry id, and the duplicate rule goes by it', () => {
  const fake = setupBook('meas-entry');
  const header = fake.sheet('Measurements').header();
  check(header.indexOf('EntryID') === CFG.MEAS_FIXED_COLS.indexOf('EntryID') && header.indexOf('EntryID') === header.indexOf('Notes') + 1,
    'setupSheet lays EntryID out as a fixed column after Notes, before the field keys', header.slice(0, 11));
  const x = fake.newExecution();
  const cust = plain(x.gasStore.addCustomer({ name: 'ဒေါ်မြ' }));
  const device = { id: 'dev-14d', staffId: '1001' };
  const rec = { customerId: cust.id, orderId: '', day: '2026-11-10', staffId: '1001', source: 'FORM', notes: '', fields: { neck: '14', waist: '30' } };
  const apply = (r, entryId) => { const y = fake.newExecution(); return plain(y.syncApplyMeasurementEntry(y.gasSyncServerPorts(), device, r, entryId)); };
  const a = apply(rec, 'entry-a'), b = apply(Object.assign({}, rec, { fields: { neck: '14', waist: '28' } }), 'entry-b'), c = apply(rec, 'entry-c'), again = apply(rec, 'entry-a');
  const rows = fake.sheet('Measurements').rows();
  check(a.status === 'ok' && b.status === 'ok' && c.status === 'ok' && c.id === 'M-00003' && again.status === 'dup' && again.id === 'M-00001' && same(rows.map(r => r.EntryID), ['entry-a', 'entry-b', 'entry-c']),
    'over the real store: back to the first values is a new session (M-00003); the first entry sent again is a dup with M-00001; each row keeps its entry id', [a, b, c, again]);
  const z = fake.newExecution(), zp = z.buildPorts();
  const newest = plain(z.latestMeasurement(zp, cust.id)), all = plain(z.gasStore.listMeasurements(cust.id));
  check(newest.id === 'M-00003' && newest.fields.waist === '30' && newest.entryId === 'entry-c' && all.every(m => !('EntryID' in m.fields)),
    'the newest session is the one saved last (waist 30); EntryID is never read as a measurement field', newest);

  // A Measurements tab laid out before EntryID (the live sheet before setupSheet runs again): the column is appended when a phone's session needs it.
  const old = setupBook('meas-entry-old');
  old.hand.deleteSheet('Measurements');
  const ox = old.newExecution();
  ox.gasSpreadsheet().insertSheet('Measurements');
  const oldCols = ['MeasID', 'CustomerID', 'OrderID', 'Day', 'StaffID', 'Source', 'PhotoURL', 'Notes', 'neck', 'waist'];
  oldCols.forEach((h, i) => old.hand.setRaw('Measurements', 1, i + 1, h));
  const oc = plain(ox.gasStore.addCustomer({ name: 'ဒေါ်ခင်' }));
  ox.gasStore.addMeasurement({ customerId: oc.id, orderId: '', day: '2026-11-10', staffId: '1001', source: 'CHAT', photoUrl: '', notes: '', fields: { neck: '13' } });
  check(same(old.sheet('Measurements').header(), oldCols), 'a Telegram session (no entry id) adds no column to that tab', old.sheet('Measurements').header());
  const oapply = entryId => { const y = old.newExecution(); return plain(y.syncApplyMeasurementEntry(y.gasSyncServerPorts(), device, Object.assign({}, rec, { customerId: oc.id }), entryId)); };
  const f1 = oapply('entry-old'), f2 = oapply('entry-old');
  const oh = old.sheet('Measurements').header(), oall = plain(old.newExecution().gasStore.listMeasurements(oc.id));
  check(f1.status === 'ok' && same(oh, oldCols.concat(['EntryID'])) && f2.status === 'dup' && f2.id === f1.id && oall.length === 2 && oall[0].entryId === '' && oall[1].entryId === 'entry-old' &&
    oall[1].fields.waist === '30' && !('EntryID' in oall[1].fields) && errorsOf(old).length === 0,
    'a phone\'s session appends EntryID at the end; the same entry again is a dup by it', { header: oh, f1, f2 });
  // setupSheet run again on a tab laid out before EntryID: the column goes at the end, once.
  const re = setupBook('meas-entry-resetup');
  re.hand.deleteSheet('Measurements');
  re.newExecution().gasSpreadsheet().insertSheet('Measurements');
  oldCols.forEach((h, i) => re.hand.setRaw('Measurements', 1, i + 1, h));
  re.newExecution().setupSheet();
  const h1 = re.sheet('Measurements').header();
  re.newExecution().setupSheet();
  const h2 = re.sheet('Measurements').header();
  check(same(h1.slice(0, oldCols.length), oldCols) && h1.filter(h => h === 'EntryID').length === 1 && same(h2, h1) && errorsOf(re).length === 0,
    'setupSheet on that tab appends EntryID after the existing columns (and the MeasureFields keys it lacks), once; a second run changes nothing', h1);
});

section('15. Every user of the script lock, called alone, takes it exactly once', () => {
  const fake = setupBook('lock-users');
  addStaff(fake);
  const run = fn => { const x = fake.newExecution(); recordTelegram(x); const d = locked(fake, () => fn(x)); d.x = x; return d; };
  const a = run(x => x.buildPorts().lock.run(function () { return fake.lock.held; }));
  check(a.out === true && once(a, 15000), 'buildPorts().lock.run (15 s)', lockOf(a));
  const b = run(x => x.gasSyncServerPorts().lock.run(function () { return fake.lock.held; }));
  check(b.out === true && once(b, 15000), 'gasSyncServerPorts().lock.run (15 s)', lockOf(b));
  const c = run(x => { x.gasDedupe.remember('9001'); return x.gasDedupe.seen('9001') && !x.gasDedupe.seen('9002'); });
  check(c.out === true && once(c, 5000) && allHeld(c.calls.filter(k => k.call === 'Properties.setProperty')) && fake.props.PROCESSED_UPDATES === '["9001"]', 'gasDedupe.remember (5 s), the Script Property written under the lock', lockOf(c));
  const d = run(x => x.gasStore.addCustomer({ name: 'ဒေါ်မြ', phone: '09777123456' }));
  check(plain(d.out).id === 'C-0001' && once(d, 15000) && allHeld(valueWrites(d.calls, 'Customers')) && fake.sheet('Customers').rows()[0].Phone === '09777123456', 'gasStore.addCustomer (15 s); the phone keeps its zero', lockOf(d));
  const e = run(x => [x.gasStore.nextOrderNo('S1'), x.gasStore.nextOrderNo('S1')]);
  check(same(plain(e.out), ['V1-0001', 'V1-0002']) && e.acquires === 2 && e.releases === 2 && e.nested === 0 && same(e.waits, [15000, 15000]) && allHeld(valueWrites(e.calls, 'Settings')), 'gasStore.nextOrderNo (15 s), once per number', lockOf(e));
  const f = run(x => x.gasStore.addMeasurement({ customerId: 'C-0001', orderId: '', day: '2026-11-10', staffId: '1001', source: 'CHAT', notes: '', fields: { neck: '14', sleeve_round: '36/30/20', bust: '17.5', waist: '7/3/20' } }));
  const meas = fake.sheet('Measurements').rows()[0];
  check(plain(f.out).id === 'M-00001' && once(f, 15000) && allHeld(valueWrites(f.calls, 'Measurements')) && meas.sleeve_round === '36/30/20' && meas.bust === '17.5' && meas.waist === '7/3/20' && meas.Day === '2026-11-10',
    'gasStore.addMeasurement (15 s); every value stays the text that was typed', lockOf(f));
  fake.hand.trimRows('Measurements', 0);
  const f2 = run(x => x.gasStore.addMeasurement({ customerId: 'C-0001', orderId: '', day: '2026-11-10', staffId: '1001', source: 'CHAT', notes: '', fields: { neck: '14.5' } }));
  check(!f2.error && plain(f2.out).id === 'M-00002' && fake.sheet('Measurements').rows().length === 2 && fake.sheet('Measurements').rows()[1].neck === '14.5', 'and it still works when the Measurements tab has no empty row left', f2.error ? f2.error.message : plain(f2.out));
  const slowM = fake.newExecution();
  const seenM = plain(slowM.gasStore.listMeasurements()).length;
  fake.newExecution().gasStore.addMeasurement({ customerId: 'C-0001', orderId: '', day: '2026-11-10', staffId: '1002', source: 'CHAT', notes: '', fields: { neck: '15' } });
  const f3 = locked(fake, () => slowM.gasStore.addMeasurement({ customerId: 'C-0001', orderId: '', day: '2026-11-10', staffId: '1001', source: 'CHAT', notes: '', fields: { neck: '16' } }));
  check(seenM === 2 && !f3.error && plain(f3.out).id === 'M-00004' && same(fake.sheet('Measurements').rows().map(r => r.MeasID), ['M-00001', 'M-00002', 'M-00003', 'M-00004']),
    'two saves in two requests never share a MeasID: the number is drawn from a fresh read under the lock', f3.error ? f3.error.message : plain(f3.out));
  const g = run(x => x.gasStore.addListOption({ list: 'pay_method', key: 'AYA', label: 'AYA ဘဏ်' }, []));
  check(plain(g.out).status === 'ok' && once(g, 15000), 'gasStore.addListOption (15 s)', lockOf(g));
  const h = run(x => x.gasStore.addDesign({ code: 'TSL-31' }));
  check(plain(h.out).code === 'TSL-31' && once(h, 15000), 'gasStore.addDesign (15 s)', lockOf(h));
  const i = run(x => { x.gasStore.listOptions('fabric'); x.gasStore.getSetting('summary_hour', 0); x.ensureListsTab(x.gasSpreadsheet()); return Object.keys(x.GAS_TABLES).length === 0 && x.GAS_LISTS_MEMO === null && x.GAS_LEDGER_MEMO === null; });
  check(!i.error && i.out === true && once(i, 15000), 'ensureListsTab (15 s); it ends with the per-execution table cache dropped (gasInvalidate)', lockOf(i));
  const j = run(x => { x.GAS_DASH_DIRTY = true; x.gasDashboardRefresh(); return x.GAS_DASH_DIRTY; });
  check(j.out === false && once(j, 15000) && dashRewrites(j.calls) === 1, 'gasDashboardRefresh with the flag raised (15 s)', lockOf(j));
  const k = run(x => x.syncMintEnrollCode('1001', 'S1', 'staff', 'phone'));
  check(!k.error && /^[A-Z2-9]{8}$/.test(plain(k.out).code) && once(k, 15000) && allHeld(valueWrites(k.calls, 'Devices')), 'syncMintEnrollCode through sp.lock.run (15 s)', lockOf(k));
  const l = run(x => { const p = x.buildPorts(); return x.commitExpense(p, { shop: 'S1', amount: 5000, category: 'fabric', staff: STAFF, source: 'BUTTON' }); });
  check(!l.error && once(l, 15000) && allHeld(valueWrites(l.calls, 'Ledger')) && valueWrites(l.calls, 'Ledger').length === 1 && fake.sheet('Ledger').rows()[0].Seq === 1 && fake.sheet('Ledger').rows()[0].DeviceID === 'TG',
    'a Telegram-route ledger write (writeGroup): one lock, the row appended and numbered under it', lockOf(l));
  // An error inside the locked function releases the lock, and the next user can take it.
  const m = run(x => x.gasLocked(function () { throw new Error('inside the lock'); }, 15000));
  const n = run(x => x.gasLocked(function () { return x.gasLocked(function () { return x.gasLocked(function () { return fake.lock.held; }); }); }));
  check(!!m.error && m.error.message === 'inside the lock' && m.acquires === 1 && m.releases === 1 && !m.held && m.x.GAS_LOCK_DEPTH === 0, 'gasLocked releases the lock when its function throws', lockOf(m));
  check(n.out === true && once(n, 15000) && n.x.GAS_LOCK_DEPTH === 0, 'gasLocked inside gasLocked inside gasLocked: one acquire (default wait 15 s), one release', lockOf(n));
  fake.lock.busy = true;
  const o = run(x => x.gasLocked(function () { return 'ran'; }, 5000));
  fake.lock.busy = false;
  check(!!o.error && /Lock timeout/.test(o.error.message) && o.x.GAS_LOCK_DEPTH === 0 && o.releases === 0, 'gasLocked does not run its function, and does not count itself as holder, when waitLock times out', lockOf(o));
  const source = fake.newExecution().gasLocked.toString();
  check(/LockService\.getScriptLock\(\)/.test(source) && /\.waitLock\(/.test(source) && /\.releaseLock\(\)/.test(source) && !/tryLock|hasLock/.test(source), 'gasLocked uses getScriptLock, waitLock and releaseLock only (what poc/run_sync.js S18 stubs)');
  check(fake.lock.nested === 0 && fake.lock.strayReleases === 0 && fake.lock.leaked === 0 && errorsOf(fake).length === 0, 'in all of the above: no acquire while held, nothing in Errors', fake.lock);
});

section('16. A Telegram update through the real doPost and the real bot', () => {
  const fake = setupBook('telegram');
  fake.props.WEBHOOK_SECRET = 'secret-1';
  addStaff(fake);
  const help = request(fake, { token: 'secret-1' }, { update_id: 8001, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, text: '/help' } });
  check(!help.error && help.reply.kind === 'html' && help.reply.body === 'ok' && help.sent.length === 1 && help.sent[0].method === 'sendMessage' && help.sent[0].args[0] === 1001 && help.sent[0].args[1] === MSG.help,
    '/help from a staff member: the bot answers through gasChat and doPost returns ok()', help.error ? help.error.message : help.sent);
  check(once(help, 5000) && touches(help.calls, 'Dashboard') === 0 && fake.props.PROCESSED_UPDATES === '["8001"]', 'the only lock of that request is the 5-second one of gasDedupe.remember; the Dashboard is not touched', lockOf(help));
  const twice = request(fake, { token: 'secret-1' }, { update_id: 8001, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, text: '/help' } });
  check(twice.reply.body === 'ok' && twice.sent.length === 0 && twice.acquires === 0, 'the same update delivered again is ignored');
  const stranger = request(fake, { token: 'secret-1' }, { update_id: 8002, message: { message_id: 2, from: { id: 4242, first_name: 'Nobody' }, chat: { id: 4242, type: 'private' }, date: 1, text: 'hello' } });
  check(stranger.reply.body === 'ok' && stranger.sent.length === 1 && stranger.sent[0].args[1] === MSG.staff_only && same(errorKinds(fake), ['unknown_user']), 'somebody who is not in the Staff tab gets the staff-only line and one Errors row', errorKinds(fake));
  const noToken = request(fake, {}, { update_id: 8003, message: { message_id: 3, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, text: '/help' } });
  check(noToken.reply.body === 'ok' && noToken.sent.length === 0 && same(errorKinds(fake), ['unknown_user', 'webhook_token']), 'an update without the webhook token is not processed and still answers ok()', errorKinds(fake));
  check(fake.lock.nested === 0 && !fake.lock.held, 'the lock was never taken while held');
});

section('16b. ➕ through the real doPost, the real bot and the real store (only with a round-4 core_bot.js)', () => {
  // The simulator checks of the bot run over the simulator's store. This is the one place where the bot's own
  // ➕ and 🔢 flows write through gasStore into the Lists tab. It needs the bot of this round: with
  // RUN_GAS_BOT_FROM pointing at an older copy the group is left out.
  if (!/add_option/.test(SOURCES['core_bot.js']) || !/list_detail/.test(SOURCES['core_bot.js'])) {
    console.log('  (left out: the bundled core_bot.js is from before round 4 and has no ➕ flow)');
    return;
  }
  const fake = setupBook('bot-add');
  fake.props.WEBHOOK_SECRET = 'secret-1';
  addStaff(fake);
  let id = 8100;
  const tap = (data, messageId) => request(fake, { token: 'secret-1' }, { update_id: ++id, callback_query: { id: 'cq' + id, from: { id: 1001 }, message: { message_id: messageId, chat: { id: 1001, type: 'private' } }, data } });
  const type = text => request(fake, { token: 'secret-1' }, { update_id: ++id, message: { message_id: id, from: { id: 1001 }, chat: { id: 1001, type: 'private' }, date: 1, text } });
  const shown = r => r.sent.filter(s => s.method === 'sendMessage' || s.method === 'editMessage');
  const textOf = s => (s ? String(s.method === 'editMessage' ? s.args[2] : s.args[1]) : '');
  const lastText = r => textOf(shown(r).pop());
  const firstDash = r => { const c = r.calls.find(k => k.sheet === 'Dashboard'); return c ? c.n : -1; };

  const menu = tap('M|acct', 501);
  const ask = tap('LA|pm|AC', 502);
  check(!menu.error && lastText(menu).indexOf(MSG.acct_title) === 0 && !ask.error && lastText(ask) === MSG.add_ask_pm && touches(menu.calls.concat(ask.calls), 'Lists') > 0 && valueWrites(menu.calls.concat(ask.calls), 'Lists').length === 0,
    'the accounts screen, then ➕: the bot asks for the name and nothing is written yet', [lastText(menu), lastText(ask)]);
  const add = type('AYA ဘဏ် ဦးမောင်');
  const rows = lists(fake).rows().filter(r => r.Label === 'AYA ဘဏ် ဦးမောင်');
  const key = rows.length ? String(rows[0].Key) : '';
  check(!add.error && rows.length === 1 && rows[0].List === 'pay_method' && /^AYA[0-9A-F]{4}$/.test(key) && rows[0].Active === true && rows[0].Order === 5 && /^added by Sister \d{4}-\d{2}-\d{2}$/.test(String(rows[0].Note)),
    'the typed name becomes one row of the Lists tab: a key made from the name, active, last in its list, with who added it', rows);
  check(lastText(add).indexOf('AYA ဘဏ် ဦးမောင်') >= 0 && lastText(add).indexOf(MSG.acct_title) >= 0 && dashRewrites(add.calls) === 1 && firstDash(add) > 0 && shown(add).every(s => s.at <= firstDash(add)) &&
    fake.sheet('Dashboard').values().some(r => r[0] === 'AYA ဘဏ် ဦးမောင် (' + key + ')'),
    'the bot answers with the accounts screen, the new account on it, BEFORE the Dashboard is touched; the Dashboard is then rewritten once and has the account row', { lastText: lastText(add), rewrites: dashRewrites(add.calls) });
  check(add.nested === 0 && !add.held && add.x.GAS_DASH_DIRTY === false && same(add.waits, [5000, 15000, 15000]),
    'three locks in that request, one after the other: the update id (5 s), the option, the Dashboard', lockOf(add));
  const askNumber = tap('LD|pm|' + key, 503);
  const number = type('09 777 123456');
  const cell = rows.length ? lists(fake).value(rows[0]._row, LC.Detail) : null;
  check(!askNumber.error && !number.error && cell === '09 777 123456' && typeof cell === 'string' && lastText(number).indexOf('09 777 123456') >= 0,
    '🔢 and a typed number: the Detail cell holds the text 09 777 123456 and the accounts screen shows it', { cell, lastText: lastText(number) });
  const y = fake.newExecution(), ports = y.buildPorts();
  check(same(plain(y.payMethods(ports, 'S1')), CFG.DEFAULT_PAY_METHODS.concat([key])) && same(plain(y.transferLines(ports, 'S1')), ['AYA ဘဏ် ဦးမောင် 09 777 123456']) && errorsOf(fake).length === 0 && fake.lock.nested === 0,
    'the account is a method button and the line a receipt with a balance prints; nothing in Errors, no lock taken while held', errorsOf(fake));
});

/* ====================================================================================================== */
/* Round 5, step 2 (docs/design-round-5/SPEC-round-5.md 8.4): DueDay, Kind, sale_flow and the Credits columns in the  */
/* Sheet glue. Placed before section 17 so that its whole-run checks cover these spreadsheets too.                     */

// The MSG keys of spec section 7 (round 5), written a second time.
const R5_KEYS = ['btn_no_name', 'btn_wallet', 'btn_bank_transfer', 'btn_paid_all', 'btn_due_unknown', 'btn_kind_wallet', 'btn_kind_bank',
  'sale_ask_qty_price', 'sale_ask_method', 'sale_ask_account', 'sale_ask_split_account', 'sale_ask_paid', 'sale_ask_due', 'sale_ask_kind',
  'sale_need_buyer', 'sale_line_method', 'sale_line_mixed', 'sale_line_paid', 'sale_due_set', 'sale_due_none', 'sale_gone', 'sale_bad_amount',
  'summary_due_overdue', 'lists_note_kind', 'settings_note_sale_flow'];
const R5_EIGHT = ['active', 'detail', 'key', 'label', 'list', 'note', 'order', 'shop'];
/** One registered SKU (S1-0001, 30,000) and one customer, written through the real store. Returns the customer. */
function r5ItemAndBuyer(fake, name) {
  const x = fake.newExecution();
  x.gasStore.updateItem('S1-0001', { name: 'ပိုးအင်္ကျီ', category: 'အင်္ကျီ', type: 'SKU', price: 30000 });
  return plain(x.gasStore.addCustomer({ name: name || 'ဒေါ်မြ' }));
}
/** A credit sold through the real core over the real store (commitSaleGroup, the guided sale's one write): 10,000 of 30,000 now. */
function r5Credit(x, customerId, dueDay) {
  return plain(x.commitSaleGroup(x.buildPorts(), { item: x.gasStore.getItem('S1-0001'), qty: 1, paid: 10000, customerId, dueDay, staff: x.gasStore.getStaff('1001'), source: 'BUTTON' }));
}
/**
 * A spreadsheet as round 4 left it: setupSheet() of this version, then the three tabs round 5 changes put back as round 4
 * wrote them (a 26-column Ledger with two rows and its text columns, an 8-column Lists tab with the 16 seeded rows, 13
 * Credits headers with one row) and the two round-5 Settings rows taken out. Every other tab is as setupSheet() made it.
 */
function round4Book(label) {
  const fake = setupBook(label);
  ['Ledger', 'Lists', 'Credits'].forEach(n => fake.hand.deleteSheet(n));
  ['sale_due_presets', 'sale_flow'].forEach(k => { const r = fake.sheet('Settings').rows().find(o => o.Key === k); if (r) fake.hand.deleteRow('Settings', r._row); });
  const x = fake.newExecution(), ss = x.SpreadsheetApp.getActiveSpreadsheet();
  const R4L = CFG.LEDGER_COLS.filter(c => c !== 'DueDay'), R4S = CFG.LIST_COLS.filter(c => c !== 'Kind'), R4C = CFG.CREDIT_COLS.filter(c => c !== 'DueDay' && c !== 'Overdue');
  const ledger = ss.insertSheet('Ledger');
  ledger.getRange(1, 1, 1, R4L.length).setValues([R4L]);
  ['Day', 'Time', 'Method', 'Category'].forEach(n => ledger.getRange(1, R4L.indexOf(n) + 1, ledger.getMaxRows(), 1).setNumberFormat('@'));
  const row = o => R4L.map(c => (o[c] === undefined ? '' : o[c]));
  ledger.getRange(2, 1, 2, R4L.length).setValues([
    row({ TxID: 'r4-sale', GroupID: 'r4-sale', Time: '2026-11-01T04:00:00.000Z', Day: '2026-11-01', Shop: 'S1', ItemID: 'S1-0001', Type: 'SALE', Qty: -1, UnitPrice: 30000,
          Amount: 30000, Cash: 10000, CustomerID: 'C-0001', Note: 'credit', Source: 'BUTTON', StaffID: '1001', Method: 'CASH', Seq: 1, ReceivedAt: '2026-11-01T04:00:01.000Z', DeviceID: 'TG' }),
    row({ TxID: 'r4-exp', GroupID: 'r4-exp', Time: '2026-11-02T04:00:00.000Z', Day: '2026-11-02', Shop: 'S1', Type: 'EXPENSE', Qty: 0, Amount: -5000, Cash: -5000,
          Source: 'BUTTON', StaffID: '1001', Method: 'CASH', Category: 'fabric', Seq: 2, ReceivedAt: '2026-11-02T04:00:01.000Z', DeviceID: 'TG' })
  ]);
  const lst = ss.insertSheet('Lists');
  lst.getRange(1, 1, 1, R4S.length).setValues([R4S]);
  ['Key', 'Label', 'Detail', 'Note'].forEach(n => lst.getRange(1, R4S.indexOf(n) + 1, lst.getMaxRows(), 1).setNumberFormat('@'));
  const seed = defaultLists(CFG, MSG).map(r => r.slice(0, R4S.length));
  lst.getRange(2, 1, seed.length, R4S.length).setValues(seed);
  const cr = ss.insertSheet('Credits');
  cr.getRange(1, 1, 2, R4C.length).setValues([R4C, ['r4-sale', '2026-11-01', 'S1', 'C-0001', 'ဒေါ်မြ', 'S1-0001', 'ပိုးအင်္ကျီ', 30000, 10000, 0, 0, 20000, 11]]);
  return fake;
}

section('18. Round 5: setupSheet() on an empty spreadsheet: DueDay, the Credits columns, sale_flow, the new messages, Kind, the Overdue cell', () => {
  const fake = newBook('r5-empty');
  const d = locked(fake, () => fake.newExecution().setupSheet());
  const Led = fake.sheet('Ledger'), L = lists(fake), S = fake.sheet('Settings'), C = fake.sheet('Credits'), due = CFG.LEDGER_COLS.length;
  check(!d.error && due === 27 && CFG.LEDGER_COLS[26] === 'DueDay' && same(Led.header(), CFG.LEDGER_COLS) && Led.maxCols >= 27 && [1, 2, 500, Led.maxRows].every(r => Led.format(r, due) === '@'),
    'the Ledger has the 27 headers with DueDay last, a grid of at least 27 columns, and the whole DueDay column is plain text', d.error ? d.error.message : { header: Led.header(), maxCols: Led.maxCols });
  check(same(C.header(), CFG.CREDIT_COLS) && C.header().length === 15 && same(C.header().slice(13), ['DueDay', 'Overdue']), 'the Credits header is 15 wide, DueDay and Overdue last', C.header());
  const flow = S.rows().find(r => r.Key === 'sale_flow'), presets = S.rows().find(r => r.Key === 'sale_due_presets');
  check(!!flow && flow.Value === 'form' && !!presets && presets.Value === '7,14,30' && S.note(flow._row, 1) === MSG.settings_note_sale_flow && S.note(flow._row, 1).length > 3,
    'Settings: sale_flow = form, its Key cell carrying settings_note_sale_flow, and sale_due_presets = 7,14,30', { flow, presets, note: flow ? S.note(flow._row, 1) : null });
  const msgKeys = fake.sheet('Messages').rows().map(r => String(r.Key));
  check(R5_KEYS.length === 25 && R5_KEYS.every(k => typeof MSG[k] === 'string' && msgKeys.indexOf(k) >= 0), 'Messages has every key of spec section 7', R5_KEYS.filter(k => msgKeys.indexOf(k) < 0));
  const kind = L.validation(2, 9), bottom = L.validation(L.maxRows, 9);
  check(same(L.header(), CFG.LIST_COLS) && L.header().length === 9 && L.header()[8] === 'Kind' && L.note(1, 9) === MSG.lists_note_kind && !!kind && kind.type === 'list' && same(kind.values, ['wallet', 'bank']) &&
    kind.allowInvalid === false && L.validation(1, 9) === null && !!bottom && bottom.type === 'list' && !thrown(() => fake.hand.type('Lists', 2, 9, '', { trigger: false })) &&
    throwsWith(() => fake.hand.type('Lists', 2, 9, 'card', { trigger: false }), /violates/) && L.value(2, 9) === '',
    'the Lists tab is nine wide: Kind last, with lists_note_kind and a wallet/bank dropdown from row 2 that allows a blank and refuses anything else', { header: L.header(), kind });
  const v = fake.sheet('Dashboard').values(), dep = v.find(r => r[0] === 'Deposits held') || [];
  check(dep[4] === 'Overdue' && dep[5] === '=SUMIF(Credits!$O:$O,TRUE,Credits!$L:$L)' && v.every(r => r.every(c => String(c).indexOf('Overdue (>') < 0)),
    'the Dashboard\'s overdue cell is labelled Overdue and sums Owed where the Credits Overdue column is TRUE', dep);
  check(errorsOf(fake).length === 0 && once(d, 15000), 'nothing in the Errors tab; one lock, for the Lists tab', errorsOf(fake));

  step('18b. Round 5: a second setupSheet() changes nothing (values, formats, validations and notes of five tabs; no row added twice; the same Dashboard values)');
  const five = ['Ledger', 'Lists', 'Settings', 'Messages', 'Credits'];
  const snap = () => five.map(n => fake.sheet(n).dump());
  const before = snap(), lastRows = [S.lastRow(), fake.sheet('Messages').lastRow()], dash = JSON.stringify(fake.sheet('Dashboard').values());
  const d2 = locked(fake, () => fake.newExecution().setupSheet());
  const after = snap();
  check(!d2.error && five.every((n, i) => before[i] === after[i]), 'Ledger, Lists, Settings, Messages and Credits hold exactly what they held', d2.error ? d2.error.message : five.filter((n, i) => before[i] !== after[i]));
  check(S.lastRow() === lastRows[0] && fake.sheet('Messages').lastRow() === lastRows[1] && S.rows().filter(r => r.Key === 'sale_flow').length === 1 && S.rows().filter(r => r.Key === 'sale_due_presets').length === 1,
    'no Settings default and no Messages key is added a second time', { settings: [lastRows[0], S.lastRow()], messages: [lastRows[1], fake.sheet('Messages').lastRow()] });
  check(JSON.stringify(fake.sheet('Dashboard').values()) === dash, 'the Dashboard is rewritten with the same values');
});

section('19. Round 5: setupSheet() on a round-4 spreadsheet appends DueDay and Kind at the right-hand ends and widens Credits, moving nothing', () => {
  const fake = round4Book('r5-round4');
  const Led = fake.sheet('Ledger'), L = lists(fake), C = fake.sheet('Credits'), S = fake.sheet('Settings');
  const before = { ledger: Led.values(), lists: L.values(), credits: C.values() };
  check(Led.maxCols === 26 && Led.header().length === 26 && before.ledger.length === 3 && L.header().length === 8 && before.lists.length === 17 && C.header().length === 13 && !S.rows().some(r => r.Key === 'sale_flow'),
    'the round-4 spreadsheet: a 26-column Ledger with two rows, an 8-column Lists tab with 16 rows, 13 Credits headers, no sale_flow row', { ledger: Led.header().length, lists: L.header().length, credits: C.header().length });
  const d = locked(fake, () => fake.newExecution().setupSheet());
  const ledger = Led.values(), lst = L.values(), credits = C.values();
  check(!d.error && same(Led.header(), CFG.LEDGER_COLS) && Led.maxCols >= 27 && same(ledger.slice(1).map(r => r.slice(0, 26)), before.ledger.slice(1)) && ledger.slice(1).every(r => r[26] === '') &&
    [1, 2, Led.maxRows].every(r => Led.format(r, 27) === '@') && Led.format(2, CFG.LEDGER_COLS.indexOf('Day') + 1) === '@',
    'Ledger: DueDay is column 27 (plain text), the 26 headers and both rows are where they were, the new cells blank', d.error ? d.error.message : Led.header());
  check(same(L.header(), CFG.LIST_COLS) && same(lst.slice(1).map(r => r.slice(0, 8)), before.lists.slice(1)) && lst.slice(1).every(r => r[8] === '') && L.validation(2, 9) && L.validation(2, 9).type === 'list' &&
    L.note(1, 9) === MSG.lists_note_kind, 'Lists: Kind is column 9 with its dropdown and note; the 16 rows are unchanged, each with a blank Kind', L.header());
  check(same(C.header(), CFG.CREDIT_COLS) && same(credits[1].slice(0, 13), before.credits[1]) && d.calls.filter(c => c.sheet === 'Credits' && (c.call === 'Sheet.clearContents' || (c.call === 'Range.setValues' && c.row > 1))).length === 0,
    'Credits: the header is 15 wide right after setupSheet (no refreshViews ran) and the row below it is untouched', { header: C.header(), row: credits[1] });
  const x = fake.newExecution(), rows = plain(x.gasStore.ledgerRows()), pm = plain(x.gasStore.listOptions('pay_method')), ports = x.buildPorts();
  check(rows.length === 2 && rows.every(r => r.dueDay === '') && rows[0].txId === 'r4-sale' && rows[0].cash === 10000 && rows[0].day === '2026-11-01' && rows[0].method === 'CASH' && rows[1].category === 'fabric' && rows[1].amount === -5000 &&
    pm.length === 4 && pm.every(r => same(Object.keys(r).sort(), R5_EIGHT)) && x.methodKind(x.listOption(ports, 'pay_method', 'BANK')) === 'bank' && x.methodKind(x.listOption(ports, 'pay_method', 'KBZ')) === 'wallet',
    'read back: both Ledger rows as before with dueDay "", the options without a kind (KBZ a wallet, BANK a bank by name)', { rows, pm });
  check(S.rows().filter(r => r.Key === 'sale_flow' && r.Value === 'form').length === 1 && S.rows().filter(r => r.Key === 'sale_due_presets').length === 1 && errorsOf(fake).length === 0,
    'Settings got sale_flow = form and sale_due_presets; nothing in the Errors tab', errorsOf(fake));
  const five = ['Ledger', 'Lists', 'Settings', 'Messages', 'Credits'], snap = () => five.map(n => fake.sheet(n).dump());
  const once1 = snap(), lastRows = [S.lastRow(), fake.sheet('Messages').lastRow()];
  const d2 = locked(fake, () => fake.newExecution().setupSheet());
  check(!d2.error && five.every((n, i) => once1[i] === snap()[i]) && S.lastRow() === lastRows[0] && fake.sheet('Messages').lastRow() === lastRows[1],
    'a second setupSheet() on the migrated spreadsheet changes nothing', d2.error ? d2.error.message : five.filter((n, i) => once1[i] !== snap()[i]));

  step('19b. Round 5: tabs whose spare columns were deleted by hand grow the same way (the growth lives in ensureTab and ensureColumns)');
  const narrow = round4Book('r5-narrow');
  narrow.hand.trimCols('Lists', 0);
  narrow.hand.trimCols('Credits', 0);
  const nL = narrow.sheet('Lists'), nC = narrow.sheet('Credits'), nLed = narrow.sheet('Ledger');
  check(nL.maxCols === 8 && nC.maxCols === 13 && nLed.maxCols === 26, 'before: Lists 8 columns, Credits 13, Ledger 26 (no spare column anywhere)', [nL.maxCols, nC.maxCols, nLed.maxCols]);
  const dn = locked(narrow, () => narrow.newExecution().setupSheet());
  const grew = dn.calls.filter(c => c.call === 'Sheet.insertColumnsAfter').map(c => c.sheet).sort();
  check(!dn.error && nL.maxCols === 9 && same(nL.header(), CFG.LIST_COLS) && nC.maxCols === 15 && same(nC.header(), CFG.CREDIT_COLS) && nLed.maxCols === 27 && same(nLed.header(), CFG.LEDGER_COLS) &&
    same(grew, ['Credits', 'Ledger', 'Lists']) && nL.rows().length === 16 && errorsOf(narrow).length === 0,
    'setupSheet grows each grid by exactly what its new headers need and writes them (Lists 9, Credits 15, Ledger 27)', dn.error ? dn.error.message : { grew, lists: nL.maxCols, credits: nC.maxCols });

  step('19c. Round 5: the migration with "sale_flow | quick" typed into Settings before the publish (spec 4.5 step 2): the typed row wins and gets the note');
  const typed = round4Book('r5-typed-quick');
  const tr = typeRow(typed, 'Settings', ['sale_flow', 'quick']);
  const before19c = typed.newExecution();
  const quickBefore = before19c.saleFlow(before19c.buildPorts());
  const dq = locked(typed, () => typed.newExecution().setupSheet());
  const TS = typed.sheet('Settings'), flows = TS.rows().filter(r => r.Key === 'sale_flow'), after19c = typed.newExecution();
  check(!dq.error && quickBefore === 'quick' && flows.length === 1 && flows[0]._row === tr && flows[0].Value === 'quick' && TS.note(tr, 1) === MSG.settings_note_sale_flow &&
    after19c.saleFlow(after19c.buildPorts()) === 'quick' && TS.rows().filter(r => r.Key === 'sale_due_presets').length === 1,
    'setupSheet keeps the typed sale_flow quick (no second row), puts the note on it, and adds sale_due_presets; the bot reads quick before and after', dq.error ? dq.error.message : flows);
});

section('20. Round 5: the publish window (the new server on a round-4 Ledger before setupSheet): a Telegram sale and a phone\'s group each write their 27 values', () => {
  const fake = round4Book('r5-window');
  addStaff(fake);
  const cust = r5ItemAndBuyer(fake);
  const x = fake.newExecution();
  recordTelegram(x);
  const today = x.dayKey(new Date()), due = x.addDaysKey(today, 10), due2 = x.addDaysKey(today, 12);
  const d = locked(fake, () => {
    const g = r5Credit(x, cust.id, due);
    x.gasLocked(function () {   // as the sync batch runs it: under the script lock
      x.gasSyncTabs.appendRows([Object.assign(syncTx({ txId: 't-window', groupId: 't-window', day: today, cash: 0, method: '', note: 'credit', customerId: cust.id, dueDay: due2 }),
        { seq: x.gasSyncCounters.nextSeq(), receivedAt: new Date().toISOString(), deviceId: 'dev-window' })]);
    }, 15000);
    return g;
  });
  const Led = fake.sheet('Ledger'), sale = d.out ? d.out.sale : null;
  const widthCalls = d.calls.filter(c => c.sheet === 'Ledger' && c.call === 'Sheet.getMaxColumns').length, grows = d.calls.filter(c => c.sheet === 'Ledger' && c.call === 'Sheet.insertColumnsAfter');
  check(!d.error && !!sale && widthCalls === 1 && grows.length === 1 && Led.maxCols === 27 && Led.header().filter(h => h !== '').length === 26 &&
    allHeld(valueWrites(d.calls, 'Ledger')),
    'one execution, a Telegram credit sale (commitSaleGroup) and a phone\'s group (gasSyncTabs.appendRows): the grid grows once to 27 columns, getMaxColumns asked once, the header still 26',
    d.error ? String(d.error.stack).split('\n').slice(0, 3).join(' | ') : { widthCalls, grows: grows.length, maxCols: Led.maxCols, header: Led.header().length });
  const alone = round4Book('r5-window-phone'), xa = alone.newExecution();
  const da = locked(alone, () => xa.gasLocked(function () {
    xa.gasSyncTabs.appendRows([Object.assign(syncTx({ txId: 't-alone', groupId: 't-alone', day: today, cash: 0, method: '', note: 'credit', dueDay: due2 }),
      { seq: 3, receivedAt: new Date().toISOString(), deviceId: 'dev-alone' })]);
  }, 15000));
  const aLed = alone.sheet('Ledger'), aRow = aLed.values().find(r => r[0] === 't-alone') || [];
  check(!da.error && aLed.maxCols === 27 && aRow.length === 27 && aRow[26] !== '' && da.calls.filter(c => c.sheet === 'Ledger' && c.call === 'Sheet.getMaxColumns').length === 1,
    'a phone\'s group as the first Ledger write after the publish: gasSyncTabs.appendRows grows the grid itself (getMaxColumns asked once)', da.error ? da.error.message : { maxCols: aLed.maxCols, row: aRow.length });
  const vals = Led.values(), at = id => vals.find(r => r[0] === id) || [];
  check(!!sale && at(sale.txId).length === 27 && at(sale.txId)[26] !== '' && at('t-window')[26] !== '' && Led.value(1, 27) === '', 'both dates sit in column 27, under a blank header cell', sale ? [at(sale.txId)[26], at('t-window')[26]] : null);
  const early = plain(fake.newExecution().gasStore.ledgerRows());
  check(!!sale && early.find(r => r.txId === sale.txId).dueDay === '' && early.find(r => r.txId === 't-window').dueDay === '', 'ledgerRows() reads dueDay "" while that header cell is blank');
  fake.newExecution().setupSheet();
  const late = plain(fake.newExecution().gasStore.ledgerRows());
  check(!!sale && same(Led.header(), CFG.LEDGER_COLS) && Led.value(1, 27) === 'DueDay' && late.find(r => r.txId === sale.txId).dueDay === due && late.find(r => r.txId === 't-window').dueDay === due2 &&
    late.find(r => r.txId === 'r4-sale').dueDay === '', 'once setupSheet() writes DueDay into that header cell, ledgerRows() reads both dates (and "" for the round-4 rows)', late.map(r => [r.txId, r.dueDay]));
});

section('21. Round 5: the Credits view (15 cells, Day and DueDay as text, Overdue a boolean) and Kind in the store and in the phones\' lists', () => {
  const fake = setupBook('r5-views');
  addStaff(fake);
  const cust = r5ItemAndBuyer(fake);
  const x = fake.newExecution();
  recordTelegram(x);
  const today = x.dayKey(new Date()), due = x.addDaysKey(today, 10);
  const g = r5Credit(x, cust.id, due);
  const C = fake.sheet('Credits'), col = n => CFG.CREDIT_COLS.indexOf(n) + 1, r = C.rows().find(o => o.GroupID === g.groupId);
  check(!!r && C.values()[r._row - 1].length === 15 && r.Day === today && r.DueDay === due && r.Overdue === false && r.Owed === 20000 && r.Customer === 'ဒေါ်မြ' &&
    ['Day', 'DueDay'].every(n => [1, r._row, C.maxRows].every(k => C.format(k, col(n)) === '@')) && C.format(r._row, col('Overdue')) === '' && C.format(r._row, col('Days')) === '',
    'refreshViews writes a credit as 15 cells: Day and DueDay keep their yyyy-mm-dd text (both whole columns @), Overdue is the boolean false', r);
  const kbz = listRow(fake, 'pay_method', 'KBZ');
  fake.hand.setRaw('Lists', kbz._row, 9, 'Bank');   // typed as Bank (pasted past the dropdown): the reader lower-cases it
  const y = fake.newExecution(), pm = plain(y.gasStore.listOptions('pay_method')), k = pm.find(o => o.key === 'KBZ');
  check(!!k && k.kind === 'bank' && same(Object.keys(k).sort(), R5_EIGHT.concat(['kind']).sort()) && pm.filter(o => o.key !== 'KBZ').every(o => same(Object.keys(o).sort(), R5_EIGHT)) &&
    y.methodKind(y.listOption(y.buildPorts(), 'pay_method', 'KBZ')) === 'bank', 'gasStore.listOptions: the Kind typed Bank comes back as kind: bank; a blank Kind adds no kind key (the eight-key rule)', pm);
  const a = locked(fake, () => fake.newExecution().gasStore.addListOption({ list: 'pay_method', key: 'CBB1A2B', label: 'CB ဘဏ်', kind: 'bank', shop: '', note: 'added by Sister' }, []));
  const cb = listRow(fake, 'pay_method', 'CBB1A2B');
  check(!a.error && plain(a.out).status === 'ok' && !!cb && cb.Kind === 'bank' && cb.Label === 'CB ဘဏ်' && once(a, 15000), 'gasStore.addListOption with kind bank appends a row whose Kind cell is bank', a.error ? a.error.message : cb);
  const z = fake.newExecution();
  const nine = plain(z.gasListValues(CFG.LIST_COLS, { list: 'pay_method', key: 'W1', label: 'Wave', active: true, order: 3, shop: '', detail: '', note: '', kind: 'wallet' }));
  const noKind = plain(z.gasListValues(CFG.LIST_COLS, { list: 'fabric', key: 'f9', label: 'x', active: true, order: 1 }));
  check(same(nine, ['pay_method', 'W1', 'Wave', true, 3, '', '', '', 'wallet']) && noKind.length === 9 && noKind[8] === '', 'gasListValues on the nine headers: the Kind cell, blank for a row without one', { nine, noKind });
  const s1 = plain(z.syncSettingsFor(z.gasSyncServerPorts())), pm1 = JSON.parse(s1.lists_json).pay_method;
  check(pm1.find(c => c.k === 'KBZ').t === 'bank' && pm1.find(c => c.k === 'CBB1A2B').t === 'bank' && !('t' in pm1.find(c => c.k === 'WAVE')) && !('t' in pm1.find(c => c.k === 'CASH')),
    'syncSettingsFor over the real store: t: bank on the two accounts whose Kind is bank, no t where the Kind is blank', pm1);
  const seed = setupBook('r5-seed-json'), w = seed.newExecution(), pm0 = JSON.parse(plain(w.syncSettingsFor(w.gasSyncServerPorts())).lists_json).pay_method;
  check(same(pm0, [{ k: 'CASH', l: MSG.method_CASH, a: 1, o: 1, s: '', d: '' }, { k: 'KBZ', l: 'KBZPay', a: 1, o: 2, s: '', d: '' }, { k: 'WAVE', l: 'WavePay', a: 1, o: 3, s: '', d: '' }, { k: 'BANK', l: MSG.method_BANK, a: 1, o: 4, s: '', d: '' }]),
    'and on a freshly seeded spreadsheet the compact rows are still the round-4 ones (no t)', pm0);
});

section('22. Round 5: sendDailySummary refreshes the Credits tab first, so a DueDay that passed overnight is Overdue there and in the 21:00 text', () => {
  const fake = setupBook('r5-summary');
  addStaff(fake);
  setSetting(fake, 'group_chat_id', '-100777');
  const cust = r5ItemAndBuyer(fake, 'ဒေါ်ခင်');
  const x0 = fake.newExecution();
  recordTelegram(x0);
  const yesterday = x0.addDaysKey(x0.dayKey(new Date()), -1);
  const g = r5Credit(x0, cust.id, yesterday);
  const C = fake.sheet('Credits'), oc = CFG.CREDIT_COLS.indexOf('Overdue') + 1, dc = CFG.CREDIT_COLS.indexOf('DueDay') + 1;
  const row0 = C.rows().find(o => o.GroupID === g.groupId);
  fake.hand.setRaw('Credits', row0._row, oc, false);   // the snapshot as the last write left it, before the day passed
  check(!!row0 && C.value(row0._row, oc) === false && C.value(row0._row, dc) === yesterday, 'before: the Credits tab says Overdue FALSE for the credit promised for yesterday', row0);
  const x = fake.newExecution(), sent = recordTelegram(x, fake), from = fake.log.length;
  const d = locked(fake, () => x.sendDailySummary());
  const rewrite = fake.calls(from, c => c.call === 'Range.setValues' && c.sheet === 'Credits');
  const msg = sent.find(s => s.method === 'sendMessage') || { args: [], at: -1 };
  const text = String(msg.args[1] || ''), row1 = C.rows().find(o => o.GroupID === g.groupId);
  check(!d.error && !!row1 && row1.Overdue === true && rewrite.length === 1 && msg.at > rewrite[0].n, 'sendDailySummary rewrites the Credits tab first: Overdue TRUE on that row, before the message goes out',
    d.error ? d.error.message : { overdue: row1 && row1.Overdue, rewrites: rewrite.length, at: msg.at });
  check(sent.length === 1 && String(msg.args[0]) === '-100777' && text.indexOf(MSG.summary_due_overdue.split('{')[0].trim()) >= 0 && text.indexOf('ဒေါ်ခင်') >= 0,
    'the one message goes to the family group and holds summary_due_overdue with the buyer', text);
  const uses = [];
  FILES.forEach(f => { (SOURCES[f].match(/\bLockService\.\w+/g) || []).forEach(u => uses.push(f + ': ' + u)); });
  check(uses.length === 1 && uses[0] === 'gas_main.js: LockService.getScriptLock' && d.nested === 0 && !d.held && errorsOf(fake).length === 0,
    'LockService is still called in exactly one place of the bundle; nothing in the Errors tab', { uses, errors: errorsOf(fake) });
});

section('23. Round 5: one sync through the real handler with [customer, mixed guided group with DueDay, list entry with Kind]', () => {
  const { fake, creds, day } = enrolledBook('r5-sync');
  const pre = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'r0', entries: [
    { kind: 'group', entryId: 'e-r', groupId: 'g-restock', txs: [syncTx({ txId: 't-restock', groupId: 'g-restock', day, type: 'RESTOCK', qty: 5, unitPrice: '', amount: 0, cash: 0, method: '' })] }
  ] } }));
  const due = fake.newExecution().addDaysKey(day, 10), cid = 'C-1a2b3c4d';
  const entries = [
    { kind: 'customer', entryId: 'e-cust', rec: { id: cid, name: 'ဒေါ်စန်း', phone: '09777123456', note: '', createdAt: new Date().toISOString() } },
    { kind: 'group', entryId: 'e-mix', groupId: 't-mix', txs: [
      syncTx({ txId: 't-mix', groupId: 't-mix', day, cash: 4000, method: 'CASH', note: 'split', customerId: cid, dueDay: due, receiptNo: 'R1-A-000001' }),
      syncTx({ txId: 't-mix-p', groupId: 't-mix', day, type: 'PAYMENT', itemId: '', qty: 0, unitPrice: '', amount: 5000, cash: 5000, refGroupId: 't-mix', method: 'KBZ', note: 'split', customerId: cid, dueDay: '' })
    ] },
    { kind: 'list', entryId: 'e-kind', rec: { list: 'pay_method', key: 'CBB1A2B', label: 'CB ဘဏ်', kind: 'bank', shop: '', note: 'added by Sister ' + day } }
  ];
  const push = request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'r1', entries } }));
  const res = push.json && push.json.push ? push.json.push.results : [], by = id => res.find(r => r.entryId === id) || {};
  check(pre.json && pre.json.ok === true && push.json && push.json.ok === true && ['e-cust', 'e-mix', 'e-kind'].every(id => by(id).status === 'ok') && push.json.push.counts.quarantined === 0 && same(by('e-mix').flags, []),
    'accepted: the customer, the group (no OVERPAID flag: the SALE is on the shadow before its PAYMENT) and the option; nothing quarantined', push.error ? push.error.message : res);
  const lw = valueWrites(push.calls, 'Ledger');
  check(lw.length === 1 && lw[0].call === 'Range.setValues' && lw[0].rows === 2 && lw[0].cols === 27 && allHeld(lw) && push.nested === 0 && !push.held,
    'the group is one Ledger block 27 wide, written under the lock (the pattern of section 14)', lw);
  const Lr = fake.sheet('Ledger').rows(), sale = Lr.find(r => r.TxID === 't-mix'), pay = Lr.find(r => r.TxID === 't-mix-p');
  check(!!sale && sale.DueDay === due && typeof sale.DueDay === 'string' && !!pay && pay.DueDay === '' && sale.Seq > 0 && pay.Seq === sale.Seq + 1 && sale.CustomerID === cid,
    'the SALE row carries its DueDay as text, the PAYMENT row none; both numbered', { sale, pay });
  const cbb = listRow(fake, 'pay_method', 'CBB1A2B'), credit = fake.sheet('Credits').rows().find(r => r.GroupID === 't-mix');
  check(!!cbb && cbb.Kind === 'bank' && fake.sheet('Customers').rows().some(r => r.CustomerID === cid) && !!credit && credit.DueDay === due && credit.Owed === 21000 && credit.Customer === 'ဒေါ်စန်း',
    'the Lists row has Kind bank, the Customers tab the buyer, and the Credits view the credit with its DueDay', { cbb, credit });
  check(fake.lock.nested === 0 && fake.lock.strayReleases === 0 && fake.lock.leaked === 0 && errorsOf(fake).length === 0, 'no acquire while held, no stray release, no lock left, nothing in Errors', errorKinds(fake));
});

section('24. Round 5 (checker): DueDay stays text in the publish window, a Date cell reads as its day, the 21:00 summary survives a failed refresh, a wallet Kind from a phone', () => {
  // 24a. The publish window: gasLedgerWidth makes the grown DueDay column plain text before the first value goes in.
  const fake = round4Book('r5c-window-text');
  addStaff(fake);
  const cust = r5ItemAndBuyer(fake);
  const x = fake.newExecution();
  recordTelegram(x);
  const today = x.dayKey(new Date()), due = x.addDaysKey(today, 10), due2 = x.addDaysKey(today, 12);
  const d = locked(fake, () => {
    const g = r5Credit(x, cust.id, due);
    x.gasLocked(function () {
      x.gasSyncTabs.appendRows([Object.assign(syncTx({ txId: 't-text', groupId: 't-text', day: today, cash: 0, method: '', note: 'credit', customerId: cust.id, dueDay: due2 }),
        { seq: x.gasSyncCounters.nextSeq(), receivedAt: new Date().toISOString(), deviceId: 'dev-text' })]);
    }, 15000);
    return g;
  });
  const Led = fake.sheet('Ledger'), vals = Led.values(), at = id => vals.find(r => r[0] === id) || [], sale = d.out ? d.out.sale : null;
  check(!d.error && !!sale && Led.value(1, 27) === '' && [1, 2, Led.maxRows].every(r => Led.format(r, 27) === '@') && at(sale.txId)[26] === due && at('t-text')[26] === due2,
    'publish window: the grown column 27 is plain text before any value goes in, so both dates are stored as yyyy-mm-dd text, not turned into Dates',
    d.error ? d.error.message : { cells: sale ? [String(at(sale.txId)[26]), String(at('t-text')[26])] : null, format: Led.format(2, 27) });

  // 24b. A DueDay cell that Sheets holds as a Date (its format cleared, a date typed by hand) is read back as yyyy-mm-dd.
  const book2 = setupBook('r5c-date-cell');
  addStaff(book2);
  const c2 = r5ItemAndBuyer(book2);
  const y = book2.newExecution();
  recordTelegram(y);
  const g2 = r5Credit(y, c2.id, due), row2 = book2.sheet('Ledger').rows().find(o => o.TxID === g2.sale.txId);
  book2.hand.clearFormat('Ledger', row2._row, 27);
  book2.hand.type('Ledger', row2._row, 27, due, { trigger: false });
  const cell = book2.sheet('Ledger').value(row2._row, 27), back = plain(book2.newExecution().gasStore.ledgerRows()).find(o => o.txId === g2.sale.txId);
  check(Object.prototype.toString.call(cell) === '[object Date]' && !!back && back.dueDay === due,
    'a DueDay cell holding a Date (format cleared, the day typed by hand) is read by ledgerRows as its yyyy-mm-dd day', { cell: String(cell), back: back && back.dueDay });

  // 24c. The Credits refresh at 21:00 fails: the summary still goes out, and the failure is one Errors row.
  const book3 = setupBook('r5c-summary-fails');
  addStaff(book3);
  setSetting(book3, 'group_chat_id', '-100777');
  const c3 = r5ItemAndBuyer(book3, 'ဒေါ်ခင်');
  const z0 = book3.newExecution();
  recordTelegram(z0);
  r5Credit(z0, c3.id, z0.addDaysKey(z0.dayKey(new Date()), -1));
  book3.failNext(c => c.call === 'Sheet.clearContents' && c.sheet === 'Credits', 'Service error: Credits is busy');
  const z = book3.newExecution(), sent = recordTelegram(z, book3);
  const dz = locked(book3, () => z.sendDailySummary());
  const msgs = sent.filter(m => m.method === 'sendMessage'), errs = errorsOf(book3).filter(e => e.Where === 'summary_refresh');
  check(!dz.error && msgs.length === 1 && String(msgs[0].args[0]) === '-100777' && String(msgs[0].args[1]).indexOf(MSG.summary_due_overdue.split('{')[0].trim()) >= 0 &&
    errs.length === 1 && /Credits is busy/.test(String(errs[0].Message)) && !dz.held,
    'when the Credits refresh fails at 21:00 the summary still goes out with its due line, and the failure is one summary_refresh row in Errors', dz.error ? dz.error.message : { msgs: msgs.length, errs });

  // 24d. A wallet Kind from a phone through the real handler; a blank kind reaches the store as no kind at all.
  const { fake: book4, creds } = enrolledBook('r5c-wallet');
  const seen = [];
  const capture = w => { const orig = w.gasStore.addListOption; w.gasStore.addListOption = function (rec, seed) { seen.push(plain(rec)); return orig.call(this, rec, seed); }; };
  const le = (id, rec) => ({ kind: 'list', entryId: id, rec: Object.assign({ list: 'pay_method', shop: '', note: 'added by Sister' }, rec) });
  const pw = request(book4, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'r5c-w', entries: [le('e-w', { key: 'WAV1A2B', label: 'Wave ဒေါ်စု', kind: 'wallet' }), le('e-blank', { key: 'KBZ1A2B', label: 'KBZ ဦးလှ', kind: '' })] } }), capture);
  const res = id => (pw.json && pw.json.push ? pw.json.push.results.find(r => r.entryId === id) : null) || {};
  const wr = listRow(book4, 'pay_method', 'WAV1A2B'), br = listRow(book4, 'pay_method', 'KBZ1A2B');
  const recW = seen.find(r => r.key === 'WAV1A2B') || {}, recB = seen.find(r => r.key === 'KBZ1A2B') || {};
  check(res('e-w').status === 'ok' && !!wr && wr.Kind === 'wallet' && recW.kind === 'wallet' && res('e-blank').status === 'ok' && !!br && br.Kind === '' && !!recB.key && !('kind' in recB),
    'a list entry with kind wallet is applied with Kind wallet; one with kind "" is applied, the rec handed to the store has no kind key, and its Kind cell is blank', { results: pw.json && pw.json.push && pw.json.push.results, recW, recB });
  const v4 = book4.newExecution(), pm4 = JSON.parse(plain(v4.syncSettingsFor(v4.gasSyncServerPorts())).lists_json).pay_method;
  check((pm4.find(c => c.k === 'WAV1A2B') || {}).t === 'wallet' && !!pm4.find(c => c.k === 'KBZ1A2B') && !('t' in pm4.find(c => c.k === 'KBZ1A2B')),
    'and lists_json carries t: wallet for the first and no t for the second', pm4.slice(-2));
});

section('25. Round 5: every pull of the real handler names caps ["dueDay"] (a phone whose pull lacks it, from an older bot, sells with the one-tap card)', () => {
  const { fake, creds } = enrolledBook('r5-caps');
  const p1 = request(fake, { api: 'sync' }, Object.assign(creds(), { pull: { ledgerSeq: 0 } }));
  const p2 = request(fake, { api: 'sync' }, Object.assign(creds(), { pull: { ledgerSeq: 0, settingsHash: p1.json && p1.json.pull ? p1.json.pull.settingsHash : '' } }));
  check(p1.json && p1.json.ok && p1.json.pull && JSON.stringify(p1.json.pull.caps) === '["dueDay"]' && p2.json && p2.json.ok && p2.json.pull.settings === null && JSON.stringify(p2.json.pull.caps) === '["dueDay"]',
    'api=sync: the pull carries caps ["dueDay"] on the wire, with the Settings and on a page without them', [p1.json && p1.json.pull && p1.json.pull.caps, p2.json && p2.json.pull && p2.json.pull.caps]);
});

/* ====================================================================================================== */
/* Round 6, step 2 (docs/design-round-6/SPEC-round-6.md 10.5 and 13.15): a basket from a reference phone through the   */
/* real handler, the steps rewrite, the photo AI's rename, setSetting, the drawing's Sketch column and picture, the     */
/* pic job, the measurement PDF's picture, and setupSheet's ai row and Shops block. Placed before section 17 so that its */
/* whole-run checks cover these spreadsheets too.                                                                         */

// The reference phone (poc/sim_phone.js, the LOCAL STORE CONTRACT app/app_store.js follows) over the core of this bundle,
// in a vm context of its own, talking to the real doPost of a fake spreadsheet: every call is one request (one execution).
const R6_PHONE_CORE = ['core_config.js', 'core_burmese.js', 'core_messages.js', 'core_ai_prompt.js', 'core_ledger.js', 'core_report.js', 'core_bot.js', 'core_orders.js', 'core_sync.js'];
const R6_PHONE_SIM = ['poc/sim_mock_ai.js', 'poc/sim_ports.js', 'poc/sim_phone.js'];
function r6Phone(fake, staffId, shop, role, label) {
  const ctx = vm.createContext({ console });
  R6_PHONE_CORE.forEach(f => vm.runInContext(SOURCES[f], ctx, { filename: 'phone/' + f }));
  R6_PHONE_SIM.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: 'phone/' + f }));
  const J = vm.runInContext('JSON', ctx), requests = [];   // a reply as the phone's own realm parses it
  const P = ctx.createPhone({ name: label, clock: () => new Date(), transport: (api, body) => {
    const d = request(fake, { api }, body);
    requests.push(Object.assign(d, { api }));
    return d.json ? J.parse(JSON.stringify(d.json)) : null;
  } });
  P.enrollResult = P.enroll(fake.newExecution().syncMintEnrollCode(staffId, shop, role, label).code);
  return { P, ctx, requests };
}
/** The three seed pieces of poc/sim_seed.js (S1-0002 18,000 SKU, S1-0005 22,000 SKU, S1-0001 25,000 one of a kind) registered and stocked through the real store. */
function r6Pieces(fake) {
  const x = fake.newExecution();
  recordTelegram(x);
  const p = x.buildPorts(), owner = x.gasStore.getStaff('1009');
  [['S1-0002', 'လုံချည် ကချင် အပြာ', 'လုံချည်', 'SKU', 18000, 9000, 5], ['S1-0005', 'ထမီ ဇင်းမယ် အဝါ', 'ထမီ', 'SKU', 22000, 11000, 2], ['S1-0001', 'ထမီ ချည်သား အနီ', 'ထမီ', 'UNIQUE', 25000, 12000, 1]].forEach(a => {
    x.gasStore.updateItem(a[0], { name: a[1], category: a[2], type: a[3], price: a[4], cost: a[5] });
    x.commitRestock(p, { item: x.gasStore.getItem(a[0]), qty: a[6], staff: owner, source: 'SYSTEM', note: 'opening stock' });
  });
}
/** A spreadsheet with the Sister (1001), the Brother (1002) and the Owner (1009) in Staff. */
function r6Book(label) {
  const fake = setupBook(label);
  addStaff(fake);
  typeRow(fake, 'Staff', ['1009', 'Owner', 'S1', 'owner', '']);
  return fake;
}
/** Drive, the blob API and Gemini inside one execution, as tests stand them in (the fake models none of them): what they were asked is recorded. */
function r6Drive(x) {
  const seen = { files: [], gemini: 0, fetched: [] }, realU = x.Utilities;
  const blob = (bytes, mime, name) => ({ bytes, mime, name, setName(n) { this.name = n; return this; }, getBytes() { return bytes; } });
  x.Utilities = {
    newBlob: (bytes, mime, name) => blob(bytes, mime, name), base64Decode: s => String(s).split('').map(c => c.charCodeAt(0) & 255),
    getUuid: () => realU.getUuid(), computeDigest: (a, v, c) => realU.computeDigest(a, v, c), DigestAlgorithm: realU.DigestAlgorithm, Charset: realU.Charset,
    formatDate: (d, tz, f) => realU.formatDate(d, tz, f)
  };
  x.gasPhotoFolder = () => ({ createFile(b) { const id = 'drv' + String(seen.files.length + 1).padStart(30, '0'); seen.files.push({ name: b.name, mime: b.mime, id }); return { getUrl: () => 'https://drive.google.com/file/d/' + id + '/view' }; } });
  x.gasAi = new Proxy({}, { get(t, prop) { return function () { seen.gemini++; return prop === 'describePhoto' ? { name: 'ထမီ ပိုးထည် အစိမ်း', category: 'ထမီ' } : {}; }; } });
  return seen;
}
const R5_DEFAULT_NOTE = 'steps = တစ်ဆင့်ချင်း မေး · quick = ခလုတ်တစ်ချက် ရောင်း';
const R6_SHOP_FIELDS = ['name', 'brand', 'address', 'phone'];

section('26. Round 6: one sync through the real handler with [customer, a three-line part-and-mixed basket, list entry], built by commitBasket on a reference phone', () => {
  const fake = r6Book('r6-basket');
  r6Pieces(fake);
  const { P, ctx, requests } = r6Phone(fake, '1001', 'S1', 'staff', 'R6 reference phone');
  check(P.enrollResult.ok && P.ports.store.getItem('S1-0002').price === 18000 && P.stockOf('S1-0002') === 5 && P.stockOf('S1-0001') === 1 && P.ledger.length === 3,
    'a reference phone enrols through the real doPost and bootstraps the three pieces and their stock', P.enrollResult.ok ? { stock: P.stockOf('S1-0002'), rows: P.ledger.length } : P.enrollResult);
  P.online = false;
  const staff = P.meta.staff, day = ctx.dayKey(P.now()), due = ctx.addDaysKey(day, 14);
  const cust = P.ports.store.addCustomer({ name: 'ဒေါ်စန်း', phone: '09777123456' });
  const acct = ctx.addListOptionByLabel(P.ports, 'pay_method', 'AYA ဦးမောင်', staff, { kind: 'bank' });
  const item = id => P.ports.store.getItem(id);
  const b = ctx.commitBasket(P.ports, { lines: [{ item: item('S1-0002'), qty: 2 }, { item: item('S1-0005'), qty: 1 }, { item: item('S1-0001'), qty: 1 }],
    paid: 50000, method: acct.key, mixed: true, bankPart: 10000, customerId: cust.id, dueDay: due, staff, source: 'BUTTON' });
  const kinds = Array.from(P.outbox, e => e.kind), g = b.groupId;
  check(acct.ok && same(kinds, ['customer', 'list', 'group']) && b.txs.length === 4 && b.total === 83000 && b.owed === 33000,
    'offline on the phone: the outbox is [customer, list, group] and commitBasket wrote one group of four rows (83,000, owing 33,000)', { kinds, owed: b.owed });
  P.online = true;
  const n0 = requests.length;
  const r = P.syncNow();
  const push = requests.slice(n0).find(d => d.json && d.json.push) || {}, res = push.json ? push.json.push.results : [], by = id => res.find(x => x.entryId === id) || {};
  check(r.ok && r.acked === 3 && r.quarantined.length === 0 && r.flagged.length === 0 && P.outbox.length === 0 && res.length === 3 && res.every(x => x.status === 'ok') &&
    same(Array.from(res.find(x => x.kind === 'group').flags || []), []) && push.json.push.counts.quarantined === 0,
    'pushed through doPost: the customer, the option and the basket are ok, nothing quarantined, no flag (no OVERPAID)', push.json ? push.json.push : push.error && push.error.message);
  const lw = valueWrites(push.calls || [], 'Ledger');
  check(lw.length === 1 && lw[0].call === 'Range.setValues' && lw[0].rows === 4 && lw[0].cols === CFG.LEDGER_COLS.length && allHeld(lw) && push.nested === 0 && !push.held,
    'the basket is ONE Ledger block of 4 rows x 27, written under the lock (B1)', lw);
  const Lr = fake.sheet('Ledger').rows().filter(x => x.GroupID === g);
  check(Lr.length === 4 && same(Lr.map(x => x.Type), ['SALE', 'SALE', 'SALE', 'PAYMENT']) && same(Lr.map(x => x.DueDay), [due, due, due, '']) && Lr.slice(0, 3).every(x => typeof x.DueDay === 'string') &&
    same(Lr.map(x => x.Cash), [36000, 4000, 0, 10000]) && Lr.every(x => x.CustomerID === cust.id) && Lr[3].Method === acct.key && Lr.slice(0, 3).every(x => x.ReceiptNo === Lr[0].ReceiptNo && x.ReceiptNo !== '') && Lr[3].ReceiptNo === '',
    'one GroupID: the DueDay text on the three SALE rows and blank on the PAYMENT (B3), the cash filled in line order, the buyer on all four, one receipt number on the SALE rows', Lr.map(x => [x.Type, x.Cash, x.DueDay, x.ReceiptNo]));
  const y = fake.newExecution(), yp = y.buildPorts(), name = y.basketName(yp, y.saleGroupInfo(yp, g));
  const credit = fake.sheet('Credits').rows().filter(x => x.GroupID === g), crow = fake.sheet('Customers').rows().find(x => x.CustomerID === cust.id) || {};
  check(credit.length === 1 && credit[0].Item === name && name.indexOf('🛍') >= 0 && credit[0].Owed === 33000 && credit[0].DueDay === due && crow.Bought === 83000 && crow.Paid === 50000 && crow.Owed === 33000,
    'the Credits tab names the basket by basketName (one row, owing 33,000, the DueDay); the Customers tab has the buyer with bought 83,000 and paid 50,000', { credit, customer: [crow.Bought, crow.Paid, crow.Owed] });
  const opt = listRow(fake, 'pay_method', acct.key);
  check(!!opt && opt.Label === 'AYA ဦးမောင်' && opt.Kind === 'bank' && errorsOf(fake).length === 0 && P.ledger.filter(x => x.groupId === g).every(x => x.synced && typeof x.seq === 'number'),
    'the option is in the Lists tab with Kind bank; the phone\'s four rows are synced with their Seq; nothing in the Errors tab', errorKinds(fake));
});

section('27. Round 6: setupSheet() on a round-5 book rewrites sale_flow steps to form and round 5\'s default note to round 6\'s; what the family typed stays', () => {
  const fake = setupBook('r6-steps');
  const S = fake.sheet('Settings'), M = fake.sheet('Messages');
  const flowRow = () => S.rows().find(r => r.Key === 'sale_flow'), noteRow = () => M.rows().find(r => r.Key === 'settings_note_sale_flow');
  fake.hand.type('Settings', flowRow()._row, 2, 'steps', { trigger: false });
  fake.hand.type('Messages', noteRow()._row, 2, R5_DEFAULT_NOTE, { trigger: false });
  const x0 = fake.newExecution(), before = x0.saleFlow(x0.buildPorts());
  const d = locked(fake, () => fake.newExecution().setupSheet());
  check(!d.error && before === 'form' && flowRow().Value === 'form' && noteRow().Text === MSG.settings_note_sale_flow && S.note(flowRow()._row, 1) === MSG.settings_note_sale_flow &&
    S.rows().filter(r => r.Key === 'sale_flow').length === 1 && errorsOf(fake).length === 0,
    'a book with sale_flow steps (read as form already) and round 5\'s default note: setupSheet writes form, the note\'s round-6 text, and the Key cell\'s note says form / quick', d.error ? d.error.message : { flow: flowRow().Value, note: noteRow().Text });
  const typed = setupBook('r6-steps-typed');
  const TS = typed.sheet('Settings'), TM = typed.sheet('Messages');
  const tf = TS.rows().find(r => r.Key === 'sale_flow'), tn = TM.rows().find(r => r.Key === 'settings_note_sale_flow');
  typed.hand.type('Settings', tf._row, 2, 'quick', { trigger: false });
  typed.hand.type('Messages', tn._row, 2, 'ကျွန်မတို့ မှတ်ချက် · quick', { trigger: false });
  typed.newExecution().setupSheet();
  const x1 = typed.newExecution();
  check(TS.rows().find(r => r.Key === 'sale_flow').Value === 'quick' && TM.rows().find(r => r.Key === 'settings_note_sale_flow').Text === 'ကျွန်မတို့ မှတ်ချက် · quick' &&
    TS.note(tf._row, 1) === 'ကျွန်မတို့ မှတ်ချက် · quick' && x1.saleFlow(x1.buildPorts()) === 'quick' && errorsOf(typed).length === 0,
    'a book whose Settings say quick and whose note the family retyped keeps both (the Key cell shows the retyped note)', TS.note(tf._row, 1));
  check(x1.saleFlow({ store: { getSetting: () => 'steps' } }) === 'form' && x1.saleFlow({ store: { getSetting: () => ' STEPS ' } }) === 'form', 'a phone\'s older steps (pulled before the rewrite) reads form');
});

section('28. Round 6: the photo job writes the Drive URL and the AI\'s rename of a placeholder in ONE updateItem (spec 6.2)', () => {
  const src = SOURCES['gas_sync.js'], a = src.indexOf("if (job.kind === 'photo') {"), z = src.indexOf('return { desc: desc', a), branch = a > 0 && z > a ? src.slice(a, z) : '';
  check(!!branch && /aiRenameFields\(cur, desc, itemCategoryCats\(ctx, \{ store: gasStore \}, cur\.shop\)\)/.test(branch) && (branch.match(/gasStore\.updateItem\(/g) || []).length === 1 && /f = url \? \{ photoUrl: url \} : \{\}/.test(branch) && /f\.name = ren\.name/.test(branch) && /f\.category = ren\.category/.test(branch),
    'source: gasSyncHooks().ai\'s photo branch calls aiRenameFields and writes photoUrl and the rename through one gasStore.updateItem', branch.slice(0, 300));
  // The same branch run in an execution, with Drive and Gemini stood in (the fake models neither): one write, one Rev.
  const fake = r6Book('r6-rename');
  const x0 = fake.newExecution();
  x0.gasStore.updateItem('S1-0007', { name: x0.itemPlaceholderName('S1-0007'), category: CFG.CATEGORIES[CFG.CATEGORIES.length - 1], type: 'SKU', price: 25000 });
  x0.gasStore.updateItem('S1-0008', { name: 'ထမီ ကျွန်မ', category: 'လုံချည်', type: 'SKU', price: 25000 });
  const rev0 = Number(fake.props.MASTER_REV);
  const x = fake.newExecution(), seen = r6Drive(x);
  const d = locked(fake, () => [x.gasSyncHooks().ai({ id: 'j-7', kind: 'photo', itemId: 'S1-0007', data: 'abc', ctx: {} }, { id: 'dev' }), x.gasSyncHooks().ai({ id: 'j-8', kind: 'photo', itemId: 'S1-0008', data: 'abc', ctx: {} }, { id: 'dev' })]);
  const i7 = plain(fake.newExecution().gasStore.getItem('S1-0007')), i8 = plain(fake.newExecution().gasStore.getItem('S1-0008'));
  check(!d.error && i7.name === 'ထမီ ပိုးထည် အစိမ်း' && i7.category === 'ထမီ' && /^https:\/\/drive\.google\.com\/file\/d\/drv0+1\/view$/.test(i7.photoUrl) && i7.rev === rev0 + 1 &&
    i8.name === 'ထမီ ကျွန်မ' && i8.category === 'လုံချည်' && /drv0+2/.test(i8.photoUrl) && i8.rev === rev0 + 2 && Number(fake.props.MASTER_REV) === rev0 + 2 && seen.gemini === 2 && same(seen.files.map(f => f.name), ['S1-0007.jpg', 'S1-0008.jpg']),
    'run with Drive stood in: a placeholder-named piece gets the AI name, its category and the Drive URL with ONE Rev; a typed name and a chosen category keep theirs (the URL alone)', d.error ? d.error.message : { i7: [i7.name, i7.category, i7.rev - rev0], i8: [i8.name, i8.category, i8.rev - rev0], counter: Number(fake.props.MASTER_REV) - rev0 });
  // Step-2 checker: a Drive save that fails is one photo_save row, and the placeholder is still renamed in ONE write (spec 6.2: f = url ? {photoUrl} : {}).
  x0.gasStore.updateItem('S1-0009', { name: x0.itemPlaceholderName('S1-0009'), category: CFG.CATEGORIES[CFG.CATEGORIES.length - 1], type: 'SKU', price: 25000 });
  const revF = Number(fake.props.MASTER_REV), errsF = errorsOf(fake).length;
  const xf = fake.newExecution(), seenF = r6Drive(xf);
  xf.gasPhotoFolder = () => ({ createFile() { throw new Error('Drive 500'); } });
  const df = locked(fake, () => xf.gasSyncHooks().ai({ id: 'j-9', kind: 'photo', itemId: 'S1-0009', data: 'abc', ctx: {} }, { id: 'dev' }));
  const i9 = plain(fake.newExecution().gasStore.getItem('S1-0009'));
  check(!df.error && df.out.photoUrl === '' && df.out.desc.name === 'ထမီ ပိုးထည် အစိမ်း' && i9.name === 'ထမီ ပိုးထည် အစိမ်း' && i9.category === 'ထမီ' && i9.photoUrl === '' && i9.rev === revF + 1 &&
    Number(fake.props.MASTER_REV) === revF + 1 && same(errorKinds(fake).slice(errsF), ['photo_save']) && seenF.gemini === 1,
    'a Drive save that fails: one photo_save row, the reply keeps the AI\'s description, and the placeholder is still renamed (name and category) in ONE write', df.error ? df.error.message : { i9: [i9.name, i9.category, i9.photoUrl, i9.rev - revF], errors: errorKinds(fake).slice(errsF) });
});

section('29. Round 6: gasStore.setSetting writes a Settings value as plain text, in place or on a new row, under the lock; a setting entry through the real handler', () => {
  const fake = r6Book('r6-setting');
  const S = fake.sheet('Settings'), rows0 = S.rows().length, named = S.rows().find(r => r.Key === 'shop_name_S1');
  const d1 = locked(fake, () => fake.newExecution().gasStore.setSetting('shop_name_S1', 'ဆိုင် ၁ (ရန်ကုန် · ဗိုလ်ချုပ်လမ်း)'));
  check(!d1.error && once(d1, 15000) && allHeld(valueWrites(d1.calls, 'Settings')) && S.rows().length === rows0 && S.value(named._row, 2) === 'ဆိုင် ၁ (ရန်ကုန် · ဗိုလ်ချုပ်လမ်း)' && S.format(named._row, 2) === '@',
    'an existing key is written in place (no new row), its Value cell plain text, under one lock', d1.error ? d1.error.message : lockOf(d1));
  const x = fake.newExecution();
  const d2 = locked(fake, () => { x.gasStore.setSetting('app_voice', 'TRUE'); return x.gasStore.getSetting('app_voice', null); });
  const added = S.rows().find(r => r.Key === 'app_voice');
  check(!d2.error && d2.out === 'TRUE' && S.rows().length === rows0 + 1 && !!added && added._row === rows0 + 1 + 1 && S.format(added._row, 2) === '@' && S.value(added._row, 2) === 'TRUE',
    'a new key is appended as a new row below the last; getSetting in the same execution reads it at once; TRUE stays the text TRUE', d2.error ? d2.error.message : { out: d2.out, added });
  const y = fake.newExecution();
  y.gasStore.setSetting('shop_phone_S1', '09123456789');
  y.gasStore.setSetting('shop_phone_S2', '+95 9 777');
  y.gasStore.setSetting('ai', 'FALSE');
  const z = fake.newExecution(), get = k => z.gasStore.getSetting(k, null);
  check(get('shop_phone_S1') === '09123456789' && get('shop_phone_S2') === '+95 9 777' && get('ai') === 'FALSE' && typeof get('ai') === 'string' && !z.aiOn(z.buildPorts()) && z.shopPhone(z.buildPorts(), 'S1') === '09123456789',
    'read back in a fresh execution: 09123456789 keeps its zero, +95 9 777 its plus, FALSE is the string FALSE (and turns the AI off)', { s1: get('shop_phone_S1'), s2: get('shop_phone_S2'), ai: get('ai') });
  // The same through doPost: the owner's phone's setting entry, a dup, a seller's entry.
  const own = fake.newExecution().syncMintEnrollCode('1009', 'S1', 'owner', 'Owner phone'), sis = fake.newExecution().syncMintEnrollCode('1001', 'S1', 'staff', 'Sister phone');
  const enrol = m => request(fake, { api: 'enroll' }, { code: m.code, platform: 'test', label: 'p', appVersion: 1 }).json.device;
  const od = enrol(own), sd = enrol(sis), cred = dv => ({ device: dv.id, token: dv.token, appVersion: 1, clientTime: new Date().toISOString() });
  const put = (dv, id, key, value) => { const q = request(fake, { api: 'sync' }, Object.assign(cred(dv), { push: { batchId: 'b-' + id, entries: [{ kind: 'setting', entryId: id, key, value }] } })); return { res: q.json.push.results[0], q }; };
  const e1 = put(od, 's1', 'shop_address_S2', '35 လမ်း · 09444555666'), e2 = put(od, 's2', 'shop_address_S2', '35 လမ်း · 09444555666'), e3 = put(sd, 's3', 'shop_address_S2', 'x');
  const addr = S.rows().find(r => r.Key === 'shop_address_S2');
  check(e1.res.status === 'ok' && e1.res.kind === 'setting' && allHeld(valueWrites(e1.q.calls, 'Settings')) && e1.q.nested === 0 && e2.res.status === 'dup' && e3.res.status === 'quarantined' && e3.res.reason === 'staff' &&
    addr.Value === '35 လမ်း · 09444555666' && S.format(addr._row, 2) === '@',
    'through the real handler: the owner\'s setting entry is ok and written under the batch lock, the same again is a dup, a seller\'s is quarantined staff', [e1.res, e2.res, e3.res]);
  const pull = request(fake, { api: 'sync' }, Object.assign(cred(sd), { pull: { ledgerSeq: 0 } })).json.pull;
  check(pull.settings && pull.settings.shop_address_S2 === '35 လမ်း · 09444555666' && pull.settings.shop_phone_S1 === '09123456789' && errorKinds(fake).every(k => k === 'sync_reject'),
    'the next pull carries the new values to every phone (as text); the one Errors row is the seller\'s quarantine', errorKinds(fake));
});

section('30. Round 6: the Measurements Sketch column, findMeasurementByEntry and setMeasurementPhoto', () => {
  const fake = r6Book('r6-sketch');
  const header = fake.sheet('Measurements').header();
  check(header.indexOf('Sketch') === CFG.MEAS_FIXED_COLS.indexOf('Sketch') && header.indexOf('Sketch') === header.indexOf('EntryID') + 1,
    'setupSheet lays Sketch out as a fixed column right after EntryID, before the field keys', header.slice(0, 11));
  // A Measurements tab laid out before Sketch (round 5): the column is appended only for a session that has a drawing.
  fake.hand.deleteSheet('Measurements');
  fake.newExecution().gasSpreadsheet().insertSheet('Measurements');
  const oldCols = ['MeasID', 'CustomerID', 'OrderID', 'Day', 'StaffID', 'Source', 'PhotoURL', 'Notes', 'EntryID', 'neck', 'note'];
  oldCols.forEach((h, i) => fake.hand.setRaw('Measurements', 1, i + 1, h));
  const SK = '1F:AAEC.BQYHCQo', x = fake.newExecution();
  x.gasStore.addMeasurement({ customerId: 'C-0001', orderId: '', day: '2026-11-10', staffId: '1001', source: 'CHAT', photoUrl: '', notes: '', fields: { neck: '13' } });
  const h1 = fake.sheet('Measurements').header();
  const withSketch = plain(fake.newExecution().gasStore.addMeasurement({ customerId: 'C-0002', orderId: '', day: '2026-11-10', staffId: '1001', source: 'FORM', photoUrl: '', notes: '', fields: { neck: '14', note: 'ပခုံး နိမ့်' }, entryId: 'e-30a', sketch: SK }));
  fake.newExecution().gasStore.addMeasurement({ customerId: 'C-0003', orderId: '', day: '2026-11-10', staffId: '1001', source: 'FORM', photoUrl: '', notes: '', fields: { neck: '15' }, entryId: 'e-30b' });
  const h2 = fake.sheet('Measurements').header(), all = plain(fake.newExecution().gasStore.listMeasurements());
  check(same(h1, oldCols) && same(h2, oldCols.concat(['Sketch'])) && withSketch.sketch === SK && all.length === 3 && all[0].sketch === '' && all[1].sketch === SK && all[2].sketch === '' &&
    all.every(m => !('Sketch' in m.fields)) && fake.sheet('Measurements').rows()[2].Sketch === '',
    'a session without a drawing adds no column; the first one with a drawing appends Sketch at the end and reads it back; a later session without one leaves its cell blank; Sketch is never a field', { h2, sketches: all.map(m => m.sketch) });
  const f1 = plain(fake.newExecution().gasStore.findMeasurementByEntry('e-30a')), f0 = fake.newExecution().gasStore.findMeasurementByEntry('nope'), fb = fake.newExecution().gasStore.findMeasurementByEntry('');
  check(!!f1 && f1.id === withSketch.id && f1.customerId === 'C-0002' && f1.sketch === SK && f0 === null && fb === null,
    'findMeasurementByEntry finds the session by its entry id; an unknown or blank entry id finds nothing', f1);
  const before = fake.sheet('Measurements').values();
  const d = locked(fake, () => fake.newExecution().gasStore.setMeasurementPhoto(withSketch.id, 'https://drive.google.com/file/d/abcdefghijklmnopqrstuvwxy123/view'));
  const afterV = fake.sheet('Measurements').values(), pc = oldCols.indexOf('PhotoURL'), changed = [];
  afterV.forEach((row, r) => row.forEach((v, c) => { if (String(v) !== String((before[r] || [])[c])) changed.push([r + 1, c + 1]); }));
  const back = plain(fake.newExecution().gasStore.getMeasurement(withSketch.id));
  check(!d.error && once(d, 15000) && same(changed, [[3, pc + 1]]) && back.photoUrl === 'https://drive.google.com/file/d/abcdefghijklmnopqrstuvwxy123/view' && back.sketch === SK &&
    !!thrown(() => fake.newExecution().gasStore.setMeasurementPhoto('M-09999', 'x')),
    'setMeasurementPhoto writes the PhotoURL of that row only, under one lock; an unknown MeasID throws', d.error ? d.error.message : { changed, lock: lockOf(d) });
  // A phone's measurement entry with a drawing through the real handler: stored with it, pulled with it.
  const { fake: book, creds, day } = enrolledBook('r6-sketch-sync');
  const cust = plain(book.newExecution().gasStore.addCustomer({ name: 'ဒေါ်မြ' }));
  const push = request(book, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'm-30', entries: [
    { kind: 'measurement', entryId: 'e-30s', rec: { customerId: cust.id, orderId: '', day, staffId: '1001', source: 'FORM', notes: '', fields: { neck: '14', note: 'n'.repeat(CFG.MEAS_NOTE_MAX) }, sketch: SK } },
    { kind: 'measurement', entryId: 'e-30t', rec: { customerId: cust.id, orderId: '', day, staffId: '1001', source: 'FORM', notes: '', fields: { neck: '15' } } }
  ] }, pull: { ledgerSeq: 0, measAfter: 0 } }));
  const pr = push.json ? push.json.push.results : [], ms = push.json && push.json.pull ? push.json.pull.measurements || [] : [], row = book.sheet('Measurements').rows()[0] || {};
  check(pr.length === 2 && pr.every(r => r.status === 'ok') && row.Sketch === SK && row.EntryID === 'e-30s' && row.note === 'n'.repeat(CFG.MEAS_NOTE_MAX) && ms.length === 2 && ms[0].sketch === SK && !('sketch' in ms[1]) &&
    errorsOf(book).length === 0,
    'through the real handler: a session with a drawing (and a 300-character note) is stored with its Sketch and pulled with it; one without is pulled without the key', { results: pr, pulled: ms.map(m => Object.keys(m)) });
});

section('31. Round 6: the drawing\'s picture (sketch) and a photo without AI (pic) in gasSyncHooks().ai, and the picture in the measurement PDF', () => {
  const src = SOURCES['gas_sync.js'];
  const branchOf = kind => { const a = src.indexOf("if (job.kind === '" + kind + "') {"), z = src.indexOf('return { photoUrl', a); return a > 0 && z > a ? src.slice(a, src.indexOf('}', z) + 1) : ''; };
  const sk = branchOf('sketch'), pic = branchOf('pic'), gem = src.indexOf('gasAi.');
  check(!!sk && /gasStore\.findMeasurementByEntry\(job\.entryId\)/.test(sk) && /throw new Error\('no_session'\)/.test(sk) && /gasStore\.setMeasurementPhoto\(meas\.id, figure\)/.test(sk) && /-figure\.png/.test(sk) && sk.indexOf('gasAi') < 0 &&
    src.indexOf("if (job.kind === 'sketch') {") < gem,
    'source: the sketch branch finds the session by its entry id (else no_session), saves <MeasID>-figure.png and calls setMeasurementPhoto, before any Gemini call and with none of its own', sk.slice(0, 200));
  check(!!pic && /throw new Error\('no_item'\)/.test(pic) && /gasStore\.updateItem\(job\.itemId, \{ photoUrl: pic \}\)/.test(pic) && pic.indexOf('gasAi') < 0 && src.indexOf("if (job.kind === 'pic') {") < gem,
    'source: the pic branch (no_item for an unknown piece) writes the item\'s photoUrl through updateItem, before any Gemini call and with none of its own', pic.slice(0, 200));
  const pdf = SOURCES['gas_pdf.js'], gi = pdf.indexOf('sh.getImages().forEach'), ins = pdf.indexOf('sh.insertImage('), fl = pdf.indexOf('SpreadsheetApp.flush()'), cl = pdf.indexOf('sh.clear()');
  check(cl > 0 && gi > cl && ins > 0 && fl > ins && /\.remove\(\)/.test(pdf.slice(gi, gi + 80)) && /setWidth\(GAS_PDF_IMAGE_SIZE\.width\)\.setHeight\(GAS_PDF_IMAGE_SIZE\.height\)/.test(pdf) &&
    /GAS_PDF_IMAGE_ROWS = 18/.test(pdf) && /logError\('pdf_image'/.test(pdf),
    'source: gasPdf.make removes the Print tab\'s pictures after clear(), places the picture (240 x 360) with insertImage BEFORE SpreadsheetApp.flush, under a caption and 18 blank rows; a failure is pdf_image', { gi, ins, fl });
  // The two branches run through the real doPost, with Drive stood in (the fake models no Drive): the session's PhotoURL, the item's photoUrl.
  const { fake, creds, day } = enrolledBook('r6-jobs');
  const cust = plain(fake.newExecution().gasStore.addCustomer({ name: 'ဒေါ်မြ' }));
  request(fake, { api: 'sync' }, Object.assign(creds(), { push: { batchId: 'm-31', entries: [{ kind: 'measurement', entryId: 'e-31', rec: { customerId: cust.id, orderId: '', day, staffId: '1001', source: 'FORM', notes: '', fields: { neck: '14' }, sketch: '1F:AAEC' } }] } }));
  let seen = null;
  const job = (j, ai) => { if (ai !== undefined) setSetting(fake, 'ai', ai); const q = request(fake, { api: 'ai' }, Object.assign(creds(), { job: Object.assign({ createdAt: new Date().toISOString() }, j) }), x => { seen = r6Drive(x); }); return { job: q.json && q.json.job, seen, q }; };
  const errs0 = errorsOf(fake).length;
  const a = job({ id: 'j-sk', kind: 'sketch', entryId: 'e-31', mime: 'image/png', data: 'png' });
  const m = plain(fake.newExecution().gasStore.findMeasurementByEntry('e-31'));
  check(a.job && a.job.status === 'done' && a.job.photoUrl === m.photoUrl && /drive\.google\.com/.test(m.photoUrl) && same(a.seen.files.map(f => [f.name, f.mime]), [[m.id + '-figure.png', 'image/png']]) && a.seen.gemini === 0,
    'through doPost: a sketch job saves <MeasID>-figure.png and writes that session\'s PhotoURL; the reply carries it; no Gemini call', a.job);
  const b = job({ id: 'j-ns', kind: 'sketch', entryId: 'e-none', mime: 'image/png', data: 'png' });
  const c = job({ id: 'j-ph', kind: 'photo', itemId: 'S1-0001', data: 'jpg' }, 'FALSE');
  const e = job({ id: 'j-pic', kind: 'pic', itemId: 'S1-0001', mime: 'image/jpeg', data: 'jpg' });
  const it = plain(fake.newExecution().gasStore.getItem('S1-0001'));
  const f = job({ id: 'j-np', kind: 'pic', itemId: 'S9-0001', mime: 'image/jpeg', data: 'jpg' });
  check(b.job.status === 'failed' && b.job.error === 'no_session' && c.job.status === 'failed' && c.job.error === 'ai_off' && c.seen.gemini === 0 && c.seen.files.length === 0 &&
    e.job.status === 'done' && e.job.photoUrl === it.photoUrl && /drive\.google\.com/.test(it.photoUrl) && same(e.seen.files.map(x => x.name), ['S1-0001.jpg']) && e.seen.gemini === 0 &&
    f.job.status === 'failed' && f.job.error === 'no_item' && errorsOf(fake).length === errs0,
    'no_session for an unknown entry; with ai FALSE a photo job is refused ai_off with no Drive or Gemini call, while a pic job saves <itemId>.jpg and writes the item\'s photoUrl; no_item for an unknown piece; no Errors row for any of them',
    { b: b.job, c: c.job, e: e.job, f: f.job, errors: errorKinds(fake).slice(errs0) });
  // Step-2 checker: a sketch job that names no mime is still saved as a PNG.
  const g = job({ id: 'j-sk2', kind: 'sketch', entryId: 'e-31', data: 'png' });
  check(g.job && g.job.status === 'done' && same(g.seen.files.map(x => [x.name, x.mime]), [[m.id + '-figure.png', 'image/png']]) && g.seen.gemini === 0,
    'a sketch job that names no mime is saved as image/png under its MeasID', g.seen.files);
  // Step-2 checker: gasPdf.make itself, with a recording Print tab, Drive and the export stood in (the fake models none of them).
  const pdfRun = (report, drive) => {
    const x = fake.newExecution(), log = [], realSA = x.SpreadsheetApp, realSS = realSA.getActiveSpreadsheet();
    let rows = null;
    const any = (name, extra) => new Proxy({}, { get(t, p) { if (extra && p in extra) return extra[p]; return (...a) => { log.push(name + '.' + String(p) + '(' + a.join(',') + ')'); return any(name); }; } });
    const old = ['a', 'b'].map(n => ({ remove() { log.push('remove ' + n); } }));
    const print = any('sh', {
      getImages: () => { log.push('getImages'); return old; },
      getRange: (...a) => any('range ' + a.join(','), { setValues: v => { rows = v.map(r => r.slice()); log.push('setValues ' + a.join(',')); } }),
      insertImage: (blob, c, r) => { log.push('insertImage ' + blob.name + ' ' + c + ',' + r); return any('image'); },
      getSheetId: () => 7
    });
    const bound = (t, p) => { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; };
    const ss = new Proxy({}, { get(_, p) {   // an empty target: the fake's objects are frozen
      if (p === 'getSheetByName') return n => (n === 'Print' ? print : realSS.getSheetByName(n));
      if (p === 'getUrl') return () => 'https://docs.google.com/spreadsheets/d/book/edit';
      return bound(realSS, p);
    } });
    x.SpreadsheetApp = new Proxy({}, { get(_, p) {
      if (p === 'getActiveSpreadsheet') return () => ss;
      if (p === 'flush') return () => { log.push('flush'); return realSA.flush(); };
      return bound(realSA, p);
    } });
    x.DriveApp = { getFileById: id => { log.push('drive ' + id); if (drive === 'fails') throw new Error('Drive 404'); return { getBlob: () => ({ name: 'blob-' + id }) }; } };
    x.UrlFetchApp = { fetch: () => { log.push('fetch'); return { getResponseCode: () => 200, getContentText: () => '', getBlob: () => ({ setName() { return this; }, setContentType() { log.push('pdf'); return this; } }) }; } };
    x.ScriptApp = { getOAuthToken: () => 'token' };
    const d = locked(fake, () => x.gasPdf.make(report));
    return { d, log, rows, at: s => log.findIndex(l => l.indexOf(s) === 0) };
  };
  const FID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';
  const rep = img => ({ title: 'အတိုင်းအတာ', subtitle: 'ဒေါ်မြ', sections: [{ heading: 'ကိုယ်', columns: ['', ''], rows: [['ရင်', '34']], totals: [] }], fileName: 'm', image: img });
  const base = 1 + 1 + 1 + 1 + 1 + 1;   // title, subtitle, blank, heading, columns, one row
  const p1 = pdfRun(rep({ url: 'https://drive.google.com/file/d/' + FID + '/view?usp=drivesdk', caption: 'ကိုယ်ပုံ' }));
  const cap = base + 2, insAt = p1.at('insertImage');
  check(!p1.d.error && !!p1.rows && p1.rows.length === base + 2 + 18 && p1.rows[cap - 1][0] === 'ကိုယ်ပုံ' && p1.rows.slice(cap).every(r => r.every(v => v === '')) && p1.at('range ' + cap + ',1,1,2.setFontWeight(bold)') >= 0 &&
    p1.log[insAt] === 'insertImage blob-' + FID + ' 1,' + (cap + 1) && p1.log[insAt + 1] === 'image.setWidth(240)' && p1.log[insAt + 2] === 'image.setHeight(360)' && p1.at('drive ' + FID) >= 0 &&
    p1.at('sh.clear()') < p1.at('remove a') && p1.at('remove b') > 0 && insAt < p1.at('flush') && p1.at('flush') < p1.at('fetch') && p1.at('pdf') > 0,
    'gasPdf.make with report.image: old pictures removed after clear(), a bold caption row and 18 blank rows, the Drive file of the URL\'s id placed under the caption at 240 x 360, before the flush and the export', { rows: p1.rows && p1.rows.length, log: p1.log.filter(l => /image|Image|remove|drive|flush|fetch|clear/.test(l)) });
  const p2 = pdfRun(rep(null));
  check(!p2.d.error && !!p2.rows && p2.rows.length === base && p2.at('insertImage') < 0 && p2.at('drive') < 0 && p2.at('remove a') > p2.at('sh.clear()') && p2.at('fetch') > 0,
    'without report.image: no extra rows, no picture and no Drive call; the Print tab\'s earlier pictures are still removed', { rows: p2.rows && p2.rows.length, error: p2.d.error && p2.d.error.message, log: p2.log.filter(l => /Image|remove|drive/.test(l)) });
  const errsP = errorsOf(fake).length;
  const p3 = pdfRun(rep({ url: 'https://drive.google.com/file/d/' + FID + '/view', caption: 'ကိုယ်ပုံ' }), 'fails');
  const p4 = pdfRun(rep({ url: 'sim://figure/M-00001', caption: 'ကိုယ်ပုံ' }));
  check(!p3.d.error && !p4.d.error && p3.at('pdf') > 0 && p4.at('pdf') > 0 && p3.at('insertImage') < 0 && p4.at('insertImage') < 0 && p4.at('drive') < 0 &&
    same(errorKinds(fake).slice(errsP), ['pdf_image', 'pdf_image']) && p3.at('flush') > 0,
    'a picture that cannot be fetched (Drive fails, or the URL holds no Drive id) is one pdf_image row each and the PDF still prints', { errors: errorKinds(fake).slice(errsP) });
});

section('32. Round 6: setupSheet() on a round-5 book adds the ai row, the Sketch column, the AI and Shops notes and ONE colour rule, once; what the family typed stays', () => {
  const fake = setupBook('r6-round5');
  // Back to round 5: no ai row, a Measurements tab without Sketch, no notes on the shop rows, no colour rule, sale_flow steps.
  const S = fake.sheet('Settings');
  fake.hand.deleteRow('Settings', S.rows().find(r => r.Key === 'ai')._row);
  fake.hand.type('Settings', S.rows().find(r => r.Key === 'sale_flow')._row, 2, 'steps', { trigger: false });
  const x0 = fake.newExecution(), st = x0.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Settings');
  st.setConditionalFormatRules([]);
  S.rows().forEach(r => { if (/^shop_/.test(String(r.Key))) st.getRange(r._row, 1).setNote(''); });
  const mh = fake.sheet('Measurements').header().filter(h => h !== 'Sketch');
  fake.hand.deleteSheet('Measurements');
  const ms = fake.newExecution().gasSpreadsheet().insertSheet('Measurements');
  ms.insertColumnsAfter(ms.getMaxColumns(), mh.length - ms.getMaxColumns());   // a round-5 tab: 9 fixed + the field keys, no spare column
  mh.forEach((h, i) => fake.hand.setRaw('Measurements', 1, i + 1, h));
  check(!S.rows().some(r => r.Key === 'ai') && S.rules().length === 0 && fake.sheet('Measurements').header().indexOf('Sketch') < 0 &&
    S.rows().filter(r => /^shop_/.test(String(r.Key))).every(r => !S.note(r._row, 1)) && S.rows().find(r => r.Key === 'sale_flow').Value === 'steps',
    'the round-5 book: no ai row, no colour rule, no Sketch column, no note on the shop rows, sale_flow steps');
  const d = locked(fake, () => fake.newExecution().setupSheet());
  const ai = S.rows().filter(r => r.Key === 'ai'), mh2 = fake.sheet('Measurements').header(), rules = S.rules();
  const m = rules.length === 1 ? /REGEXMATCH\(\$A2,"([^"]+)"\)/.exec(rules[0].formula) : null, re = m ? new RegExp(m[1]) : null;
  const shopKeys = [], notes = [];
  CFG.SHOP_IDS.forEach((id, i) => R6_SHOP_FIELDS.forEach(f => {
    const k = 'shop_' + f + '_' + id, r = S.rows().find(o => o.Key === k);
    shopKeys.push(k);
    notes.push(!!r && S.note(r._row, 1) === x0.t({ store: { getMessage: () => null } }, 'settings_note_shop_' + f, { n: x0.myDigits(i + 1) }));
  }));
  check(!d.error && ai.length === 1 && /^true$/i.test(String(ai[0].Value)) && S.note(ai[0]._row, 1) === MSG.settings_note_ai && S.rows().find(r => r.Key === 'sale_flow').Value === 'form',
    'setupSheet appends ai | TRUE with the settings_note_ai note, and rewrites steps to form', d.error ? d.error.message : ai);
  check(notes.length === R6_SHOP_FIELDS.length * CFG.SHOP_IDS.length && notes.every(Boolean),
    'the name, brand, address and phone rows of every shop in CFG.SHOP_IDS (' + notes.length + ' Key cells) carry their settings_note_shop_* note, numbered', notes);
  check(!!re && shopKeys.every(k => re.test(k)) && ['ai', 'sale_flow', 'shop_name_S9', 'shop_x_S1', 'pay_methods', 'xshop_name_S1'].every(k => !re.test(k)) && rules[0].background === '#e3e7f7' &&
    rules[0].ranges.length === 1 && rules[0].ranges[0] === 'A2:B' + S.maxRows,
    'ONE conditional-format rule colours exactly the Shops keys #e3e7f7 over columns A:B, wherever those rows are', rules);
  check(mh2.indexOf('Sketch') === mh2.length - 1 && mh2.filter(h => h === 'Sketch').length === 1 && same(mh2.slice(0, mh.length), mh) && errorsOf(fake).length === 0,
    'the Measurements tab gets Sketch at its right-hand end, once; nothing moves; nothing in the Errors tab', mh2.slice(-3));
  const tabs = ['Settings', 'Messages', 'Measurements'], snap = () => tabs.map(n => fake.sheet(n).dump()), s1 = snap();
  const d2 = locked(fake, () => fake.newExecution().setupSheet());
  check(!d2.error && tabs.every((n, i) => s1[i] === snap()[i]) && S.rules().length === 1, 'a second setupSheet changes nothing in Settings, Messages and Measurements, and leaves ONE rule', d2.error ? d2.error.message : tabs.filter((n, i) => s1[i] !== snap()[i]));
  // What the family typed: ai FALSE and a shop's name stay; the notes and the rule still come.
  const typed = setupBook('r6-typed');
  const TS = typed.sheet('Settings');
  typed.hand.type('Settings', TS.rows().find(r => r.Key === 'ai')._row, 2, 'FALSE', { trigger: false });
  typed.hand.type('Settings', TS.rows().find(r => r.Key === 'shop_name_S1')._row, 2, 'ဆိုင် ၁ (ရန်ကုန်)', { trigger: false });
  typed.newExecution().setupSheet();
  const tx = typed.newExecution();
  check(TS.rows().filter(r => r.Key === 'ai').length === 1 && TS.rows().find(r => r.Key === 'ai').Value === false && !tx.aiOn(tx.buildPorts()) && TS.rows().find(r => r.Key === 'shop_name_S1').Value === 'ဆိုင် ၁ (ရန်ကုန်)' &&
    TS.rules().length === 1 && errorsOf(typed).length === 0,
    'a typed ai FALSE (the AI stays off) and a typed shop name are kept; still one rule', { ai: TS.rows().find(r => r.Key === 'ai').Value });
  // Amendment F10b (the owner may add a third shop): a bundle whose CFG.SHOP_IDS has a third id. setupSheet gives that shop
  // its own name, voucher-number, brand, address and phone rows, and notes and colours them with the others; a book set up
  // before the id existed gains them on its next run, once, and a value the app or the family already wrote stays.
  const bundle3 = FILES.map(f => '/* ===== ' + f + ' ===== */\n' + SOURCES[f].trim() + '\n' +
    (f === 'core_config.js' ? "CFG.SHOP_IDS.push('S3'); CFG.SHOP_NAMES.S3 = 'ဆိုင် ၃';\n" : '')).join('\n');
  const three = newBook('r6-three-shops', { source: bundle3 });
  const d3 = locked(three, () => three.newExecution().setupSheet());
  const T3 = three.sheet('Settings'), x3 = three.newExecution(), ids3 = Array.from(x3.CFG.SHOP_IDS), keys3 = [];
  ids3.forEach(id => ['shop_name_', 'order_next_no_', 'shop_brand_', 'shop_address_', 'shop_phone_'].forEach(p => keys3.push(p + id)));
  const val3 = k => (T3.rows().find(r => r.Key === k) || {}).Value;
  const shops3 = () => {
    const rs = T3.rules(), mm = rs.length === 1 ? /REGEXMATCH\(\$A2,"([^"]+)"\)/.exec(rs[0].formula) : null, rx = mm ? new RegExp(mm[1]) : null, noted = [];
    ids3.forEach((id, i) => R6_SHOP_FIELDS.forEach(f => {
      const r = T3.rows().find(o => o.Key === 'shop_' + f + '_' + id);
      noted.push(!!r && T3.note(r._row, 1) === x3.t({ store: { getMessage: () => null } }, 'settings_note_shop_' + f, { n: x3.myDigits(i + 1) }) && !!rx && rx.test(r.Key));
    }));
    return { once: keys3.filter(k => T3.rows().filter(r => r.Key === k).length !== 1), noted, rules: rs.length, errors: errorsOf(three).length };
  };
  const a3 = shops3();
  check(!d3.error && same(ids3, ['S1', 'S2', 'S3']) && a3.once.length === 0 && val3('shop_name_S3') === 'ဆိုင် ၃' && String(val3('order_next_no_S3')) === '1' &&
    ['shop_brand_S3', 'shop_address_S3', 'shop_phone_S3'].every(k => String(val3(k)) === '') && a3.noted.length === 12 && a3.noted.every(Boolean) && a3.rules === 1 && a3.errors === 0,
    'F10b: with a third id in CFG.SHOP_IDS, setupSheet gives S3 its name (ဆိုင် ၃), voucher-number, brand, address and phone rows, once each; its four Key cells carry their settings_note_shop_* note (n = ၃) and the one colour rule covers them', d3.error ? d3.error.message : a3);
  // The same book as it was before the third id: no S3 rows, the S1 name typed, then the app's Shops screen wrote S3's name.
  T3.rows().filter(r => /_S3$/.test(String(r.Key))).map(r => r._row).sort((a, b) => b - a).forEach(row => three.hand.deleteRow('Settings', row));
  three.hand.type('Settings', T3.rows().find(r => r.Key === 'shop_name_S1')._row, 2, 'ဆိုင် ၁ (ရန်ကုန်)', { trigger: false });
  three.newExecution().gasStore.setSetting('shop_name_S3', 'ဆိုင် ၃ (ပုသိမ်)');
  const gone = keys3.filter(k => /_S3$/.test(k) && T3.rows().some(r => r.Key === k));
  const d4 = locked(three, () => three.newExecution().setupSheet()), b3 = shops3();
  check(same(gone, ['shop_name_S3']) && !d4.error && b3.once.length === 0 && val3('shop_name_S3') === 'ဆိုင် ၃ (ပုသိမ်)' && val3('shop_name_S1') === 'ဆိုင် ၁ (ရန်ကုန်)' && String(val3('order_next_no_S3')) === '1' &&
    b3.noted.every(Boolean) && b3.rules === 1 && b3.errors === 0,
    'a book set up before the third id gains S3\'s missing rows on the next setupSheet, once each, noted and coloured; the S3 name the app wrote and the typed S1 name stay', d4.error ? d4.error.message : { gone, b3, s3: val3('shop_name_S3') });
});

/* ====================================================================================================== */
/* Round 6b, step 2 (docs/design-round-6/SPEC-round-6b.md 5.4): the item categories on the Sheet (the first seed, the    */
/* List note, the ➕ through the real store) and the round-3 sample texts; the photo job's list of categories. Placed     */
/* before section 17 so that its whole-run checks cover these spreadsheets too.                                          */

section('33. Round 6b: setupSheet() and item categories: the five built-ins at rows 18-22 of the first seed, the List note; round 3\'s sample texts rewritten once, a typed one kept', () => {
  const fake = newBook('r6b-setup');
  const d = locked(fake, () => fake.newExecution().setupSheet());
  const L = lists(fake), ic = L.rows().filter(r => r.List === 'item_category');
  const want = CFG.ITEM_CATEGORY_KEYS.map((k, i) => [k, CFG.CATEGORIES[i], true, i + 1, '', CFG.CATEGORY_EMOJI[CFG.CATEGORIES[i]]]);
  const blocks = valueWrites(d.calls, 'Lists').filter(c => c.row <= 22 && c.row + (c.rows || 1) - 1 >= 18);
  check(!d.error && same(ic.map(r => r._row), [18, 19, 20, 21, 22]) && same(ic.map(r => [String(r.Key), r.Label, r.Active, r.Order, r.Shop, r.Detail]), want) && L.rows().length === 21 &&
    blocks.length === 1 && blocks[0].call === 'Range.setValues' && blocks[0].row === 2 && blocks[0].rows === 21,
    'on an empty book rows 18-22 of the Lists tab are the five item_category rows (the built-in keys, labels, Active, Order 1..5, Shop blank, the emoji in Detail), written inside the first seed\'s one block',
    d.error ? d.error.message : { rows: ic.map(r => [r._row, r.Key, r.Label, r.Order, r.Detail]), blocks });
  check(L.note(1, LC.List) === MSG.lists_note_list + '\n' + MSG.lists_note_item_category && MSG.lists_note_item_category.length > 3 && L.note(1, LC.Key) === MSG.lists_note_key &&
    errorsOf(fake).length === 0,
    'the List header cell\'s note is lists_note_list and then lists_note_item_category; the Key header keeps lists_note_key; nothing in Errors', { list: L.note(1, LC.List), key: L.note(1, LC.Key) });
  // A round-3 book: btn_sample_on still holds round 3's text exactly (🧵), btn_sample_off a text the family typed.
  const old = setupBook('r6b-sample-texts'), M = old.sheet('Messages'), typed = 'နမူနာ ဟုတ်လား · ကျွန်မတို့ စာ';
  const rowOf = key => M.rows().find(r => r.Key === key) || {};
  const onRow = rowOf('btn_sample_on')._row, offRow = rowOf('btn_sample_off')._row;
  old.hand.type('Messages', onRow, 2, '🧵 နမူနာ: ဟုတ်', { trigger: false });
  old.hand.type('Messages', offRow, 2, typed, { trigger: false });
  const before = [rowOf('btn_sample_on').Text, rowOf('btn_sample_off').Text];
  const d1 = locked(old, () => old.newExecution().setupSheet());
  const x1 = old.newExecution(), p1 = x1.buildPorts();
  check(!d1.error && same(before, ['🧵 နမူနာ: ဟုတ်', typed]) && /^🎨 /.test(MSG.btn_sample_on) && rowOf('btn_sample_on').Text === MSG.btn_sample_on && rowOf('btn_sample_off').Text === typed &&
    x1.t(p1, 'btn_sample_on') === MSG.btn_sample_on && x1.t(p1, 'btn_sample_off') === typed && errorsOf(old).length === 0,
    'setupSheet rewrites btn_sample_on (round 3\'s exact 🧵 text) to MSG.btn_sample_on, so Telegram shows 🎨; the typed btn_sample_off stays; nothing in Errors',
    d1.error ? d1.error.message : { on: rowOf('btn_sample_on').Text, off: rowOf('btn_sample_off').Text });
  const d2 = locked(old, () => old.newExecution().setupSheet());
  const again = valueWrites(d2.calls, 'Messages').filter(c => [onRow, offRow].some(r => c.row <= r && c.row + (c.rows || 1) - 1 >= r));
  check(!d2.error && again.length === 0 && rowOf('btn_sample_on').Text === MSG.btn_sample_on && rowOf('btn_sample_off').Text === typed && errorsOf(old).length === 0,
    'a second setupSheet writes neither cell', d2.error ? d2.error.message : again);
  // The step-2 checker's addition: the mirror, so each of the two round-3 texts is pinned here (btn_sample_off exact, btn_sample_on typed).
  const mir = setupBook('r6b-sample-texts-mirror'), MM = mir.sheet('Messages'), typedOn = 'နမူနာ ဟုတ်တယ် · ကျွန်မတို့ စာ';
  const mrowOf = key => MM.rows().find(r => r.Key === key) || {};
  mir.hand.type('Messages', mrowOf('btn_sample_off')._row, 2, '🧵 နမူနာ: မဟုတ်', { trigger: false });
  mir.hand.type('Messages', mrowOf('btn_sample_on')._row, 2, typedOn, { trigger: false });
  const dm = locked(mir, () => mir.newExecution().setupSheet());
  const xm = mir.newExecution(), pm = xm.buildPorts();
  check(!dm.error && /^🎨 /.test(MSG.btn_sample_off) && mrowOf('btn_sample_off').Text === MSG.btn_sample_off && mrowOf('btn_sample_on').Text === typedOn &&
    xm.t(pm, 'btn_sample_off') === MSG.btn_sample_off && xm.t(pm, 'btn_sample_on') === typedOn && errorsOf(mir).length === 0,
    'the mirror: btn_sample_off still holding round 3\'s exact 🧵 text becomes MSG.btn_sample_off (Telegram shows 🎨), a typed btn_sample_on stays; nothing in Errors',
    dm.error ? dm.error.message : { on: mrowOf('btn_sample_on').Text, off: mrowOf('btn_sample_off').Text });
});

section('34. Round 6b: ➕ an item category on the Sheet (addItemCategory over the real store): one row under one lock, lists_json carries it, a second add writes nothing, a hand-emptied list is seeded first', () => {
  const fake = setupBook('r6b-addcat');
  const SILK = 'ပိုးအင်္ကျီ';
  const x = fake.newExecution();
  const a = locked(fake, () => plain(x.addItemCategory(x.buildPorts(), SILK, STAFF, 'S1')));
  const key = a.out && a.out.key, row = key ? listRow(fake, 'item_category', key) : null, wa = valueWrites(a.calls, 'Lists');
  check(!a.error && !!a.out && a.out.ok === true && a.out.created === true && /^i[0-9a-f]{4}$/.test(key) && !!row && row._row === 23 && row.Label === SILK && row.Order === 6 && row.Active === true &&
    row.Shop === '' && row.Detail === '' && /^added by Sister \d{4}-\d{2}-\d{2}$/.test(row.Note) && lists(fake).rows().length === 22,
    'on a seeded book addItemCategory writes ONE row: row 23, Order 6, Shop blank, Note "added by Sister <day>"', a.error ? a.error.message : { out: a.out, row });
  check(once(a, 15000) && wa.length === 1 && wa[0].row === 23 && wa[0].rows === 1 && allHeld(wa) && x.GAS_DASH_DIRTY === true,
    'under one lock (one acquire, none while held), one value write, the Dashboard flag raised', { lock: lockOf(a), writes: wa });
  const y = fake.newExecution(), lj = JSON.parse(y.listsJsonFor({ store: y.gasStore }) || '{}');
  check(Array.isArray(lj.item_category) && lj.item_category.length === 6 && same(lj.item_category.map(c => c.k), CFG.ITEM_CATEGORY_KEYS.concat([key])) && lj.item_category[5].l === SILK,
    'listsJsonFor carries six item_category rows, the new one last', lj.item_category);
  const dump = lists(fake).dump();
  const b = locked(fake, () => plain(y.addItemCategory(y.buildPorts(), 'ပိုး အင်္ကျီ', STAFF, 'S1')));
  check(!b.error && !!b.out && b.out.ok === true && b.out.existed === true && b.out.key === key && b.out.label === SILK && lists(fake).dump() === dump && b.calls.filter(c => c.write).length === 0 && b.acquires === 0,
    'a second add of "ပိုး အင်္ကျီ" is that category: nothing written, the lock not even taken', b.error ? b.error.message : b.out);
  // The Dashboard: rewritten after the add, it still has no item-category block.
  const dz = locked(fake, () => x.gasDashboardRefresh());
  const dash = fake.sheet('Dashboard').values().map(r => r.map(v => String(v)).join(' | ')).join('\n');
  const icMarks = CFG.ITEM_CATEGORY_KEYS.filter(k => k !== 'other').map(k => '(' + k + ')').concat(['(' + key + ')', SILK, CFG.CATEGORIES[0]]);
  check(!dz.error && dashRewrites(dz.calls) === 1 && icMarks.every(m => dash.indexOf(m) < 0) && !/item.?categor/i.test(dash),
    'the Dashboard rewritten after the add has no item-category block (no row of an item category\'s name or key)', dz.error ? dz.error.message : icMarks.filter(m => dash.indexOf(m) >= 0));
  // A Lists tab seeded by a round-4, 5 or 6 build (no item_category row): the first add writes the five built-ins and the new row as one block.
  const r46 = setupBook('r6b-addcat-r46');
  lists(r46).rows().filter(r => r.List === 'item_category').map(r => r._row).sort((p, q) => q - p).forEach(r => r46.hand.deleteRow('Lists', r));
  const rows46 = lists(r46).rows().length;
  const z = r46.newExecution();
  const c = locked(r46, () => plain(z.addItemCategory(z.buildPorts(), SILK, STAFF, 'S1')));
  const ic = lists(r46).rows().filter(r => r.List === 'item_category'), wc = valueWrites(c.calls, 'Lists');
  check(rows46 === 16 && !c.error && !!c.out && c.out.created === true && c.out.key === key && same(ic.map(r => String(r.Key)), CFG.ITEM_CATEGORY_KEYS.concat([key])) &&
    same(ic.map(r => r.Order), [1, 2, 3, 4, 5, 6]) && same(ic.slice(0, 5).map(r => r.Detail), CFG.CATEGORIES.map(n => CFG.CATEGORY_EMOJI[n])) && ic[0]._row === 18 &&
    wc.length === 1 && wc[0].rows === 6 && once(c, 15000) && errorsOf(r46).length === 0,
    'a tab with no item_category row (seeded before round 6b): the first add writes the five built-ins and then the new row, as ONE block of six rows, under one lock',
    c.error ? c.error.message : { keys: ic.map(r => r.Key), writes: wc.map(w => [w.row, w.rows]) });
  check(errorsOf(fake).length === 0 && !fake.lock.held, 'nothing in Errors; the lock is free');
});

section('35. Round 6b: the photo job\'s list of item categories (gasSyncHooks().ai): the job\'s own list, else the piece\'s shop\'s offered list; the late rename decides against the same list', () => {
  const src = SOURCES['gas_sync.js'], a0 = src.indexOf("if (job.kind === 'photo') {"), z0 = src.indexOf('return { desc: desc', a0), branch = a0 > 0 && z0 > a0 ? src.slice(a0, z0) : '';
  check(!!branch && /gasAi\.describePhoto\(blob, \{ categories: itemCategoryCats\(ctx, \{ store: gasStore \}, jobItem \? jobItem\.shop : ''\)\.names \}\)/.test(branch) &&
    /var jobItem = job\.itemId \? gasStore\.getItem\(job\.itemId\) : null;/.test(branch) && !/CFG\.CATEGORIES/.test(branch),
    'source: the photo branch passes itemCategoryCats(ctx, { store: gasStore }, <the piece\'s shop>).names as describePhoto\'s categories (CFG.CATEGORIES no longer)', branch.slice(0, 400));
  // Run in executions, Drive stood in, Gemini replaced by a recorder that answers the custom category with a space.
  const fake = r6Book('r6b-photo-cats'), SILK = 'ပိုးအင်္ကျီ', other = CFG.CATEGORIES[CFG.CATEGORIES.length - 1];
  const x0 = fake.newExecution();
  const added = plain(x0.addItemCategory(x0.buildPorts(), SILK, STAFF, 'S1'));
  typeRow(fake, 'Lists', ['item_category', 'pahsoe', 'ပုဆိုး', '', 7, 'S2']);           // a category the owner limited to S2
  const x1 = fake.newExecution();
  ['S1-0007', 'S1-0008', 'S2-0007'].forEach(id => x1.gasStore.updateItem(id, { name: x1.itemPlaceholderName(id), category: other, type: 'SKU', price: 25000 }));
  const runJob = (job, answer) => {
    const x = fake.newExecution(), asked = [];
    r6Drive(x);
    x.gasAi = { describePhoto: (blob, c) => { asked.push(plain(c)); return { name: answer.name, category: answer.category }; } };
    const d = locked(fake, () => plain(x.gasSyncHooks().ai(job, { id: 'dev' })));
    return { d, asked, item: plain(fake.newExecution().gasStore.getItem(job.itemId)) };
  };
  const s1 = runJob({ id: 'j-s1', kind: 'photo', itemId: 'S1-0007', data: 'abc', ctx: {} }, { name: 'ပိုးအင်္ကျီ အနီ', category: 'ပိုး အင်္ကျီ' });
  const want1 = CFG.CATEGORIES.slice(0, 4).concat([SILK, other]);
  check(added.created === true && !s1.d.error && s1.asked.length === 1 && same(s1.asked[0].categories, want1) && s1.item.name === 'ပိုးအင်္ကျီ အနီ' && s1.item.category === SILK,
    'a job that carries no list: Gemini is given the S1 piece\'s offered list (the custom category, the catch-all last, no S2-only row); the placeholder at the catch-all takes the list\'s label',
    s1.d.error ? s1.d.error.message : { asked: s1.asked, item: [s1.item.name, s1.item.category] });
  const s2 = runJob({ id: 'j-s2', kind: 'photo', itemId: 'S2-0007', data: 'abc', ctx: {} }, { name: 'ပုဆိုး အပြာ', category: 'ပုဆိုး' });
  check(!s2.d.error && s2.asked.length === 1 && s2.asked[0].categories.indexOf('ပုဆိုး') >= 0 && s2.asked[0].categories[s2.asked[0].categories.length - 1] === other && s2.item.category === 'ပုဆိုး',
    'an S2 piece\'s job is given the S2 list (the S2-only row in it) and may be renamed to it', s2.d.error ? s2.d.error.message : { asked: s2.asked, category: s2.item.category });
  // B3 on the real server: the owner unticks ပိုးအင်္ကျီ; a job whose ctx (the phone's list at the photo) still names it decides against that list.
  fake.hand.tick('Lists', listRow(fake, 'item_category', added.key)._row, LC.Active, false, { trigger: false });
  const s3 = runJob({ id: 'j-s3', kind: 'photo', itemId: 'S1-0008', data: 'abc', ctx: { categories: ['ထမီ', SILK, other] } }, { name: 'ပိုးအင်္ကျီ အဝါ', category: SILK });
  const x3 = fake.newExecution();
  check(!s3.d.error && same(s3.asked[0].categories, ['ထမီ', SILK, other]) && s3.item.name === 'ပိုးအင်္ကျီ အဝါ' && s3.item.category === SILK &&
    !x3.itemCategoryOptions(x3.buildPorts(), 'S1').some(r => r.key === added.key) && errorsOf(fake).length === 0,
    'a job that carries the phone\'s list is given exactly that list, and the rename decides against it even after the owner unticked the category (as the phone\'s replay does, so the two agree)',
    s3.d.error ? s3.d.error.message : { asked: s3.asked, item: [s3.item.name, s3.item.category], errors: errorKinds(fake) });
  // The step-2 checker's addition, row 10's shop in behaviour: an S1 piece's job without a list whose AI answers the S2-only
  // category anyway (a real Gemini can leave its list) gets the AI name only and keeps the catch-all.
  const x4 = fake.newExecution();
  x4.gasStore.updateItem('S1-0009', { name: x4.itemPlaceholderName('S1-0009'), category: other, type: 'SKU', price: 25000 });
  const s4 = runJob({ id: 'j-s4', kind: 'photo', itemId: 'S1-0009', data: 'abc', ctx: {} }, { name: 'ပုဆိုး အစိမ်း', category: 'ပုဆိုး' });
  check(!s4.d.error && s4.asked.length === 1 && s4.asked[0].categories.indexOf('ပုဆိုး') < 0 && s4.item.name === 'ပုဆိုး အစိမ်း' && s4.item.category === other && errorsOf(fake).length === 0,
    'an S1 piece\'s job without a list whose AI answers the S2-only category: the rename decides against the S1 piece\'s list, so the AI name is taken and the catch-all kept',
    s4.d.error ? s4.d.error.message : { asked: s4.asked, item: [s4.item.name, s4.item.category] });
});

section('Shop access across separate Apps Script requests', () => {
  const { fake } = enrolledBook('shop-access');
  const minted = fake.newExecution().syncMintEnrollCode('1009', 'S1', 'owner', 'Owner');
  const enrolled = request(fake, { api: 'enroll' }, { code: minted.code }).json.device;
  const call = (action, fields = {}) => request(fake, { api: 'office' }, { device: enrolled.id, token: enrolled.token, action, ...fields }).json;
  const shop = call('shop', { shop: 'S10', name: 'Market', address: '10 Market St', phone: '09123', create: true });
  check(shop.ok && call('shops').shops.some(s => s.id === 'S10' && s.phone === '09123'), 'new shop and its phone number survive the next execution', shop);
  const user = { id: 'W-001', name: 'May', role: 'viewer+bookkeeper', shop: 'S10', shops: ['S10', 'S1'], active: true };
  const saved = call('person', { person: user });
  check(saved.ok && call('people').people.some(p => p.id === user.id && p.shops.length === 2), 'an app-only staff number keeps two shops on the Staff sheet', saved);
  const invite = call('invite', { target: user.id });
  const phone = request(fake, { api: 'enroll' }, { code: invite.code }).json;
  check(phone.ok && phone.bootstrap === false, 'a bookkeeper can enrol with a code given by the rights administrator', phone.error);
  const report = request(fake, { api: 'office' }, { device: phone.device.id, token: phone.device.token, action: 'close', period: '2026', shop: 'S10' }).json;
  check(report.ok && report.report.sections.length > 7, 'the shop yearly close is available over doPost', report.message);
});

section('17. Over the whole run', () => {
  const bad = { nested: [], stray: [], leaked: [], held: [], checkboxes: [], unmodelled: [] };
  books.forEach(b => {
    if (b.fake.lock.nested) bad.nested.push(b.label);
    if (b.fake.lock.strayReleases) bad.stray.push(b.label);
    if (b.fake.lock.leaked) bad.leaked.push(b.label);
    if (b.fake.lock.held) bad.held.push(b.label);
    if (b.fake.calls(0, c => c.call === 'Range.insertCheckboxes').length) bad.checkboxes.push(b.label);
    if (errorsOf(b.fake).some(r => /fake_gas:|is not modelled/.test(String(r.Message)))) bad.unmodelled.push(b.label);
  });
  check(bad.nested.length === 0 && bad.stray.length === 0 && bad.leaked.length === 0 && bad.held.length === 0,
    'in none of the ' + books.length + ' spreadsheets was the script lock taken while held, released while free, or left held', bad);
  check(bad.checkboxes.length === 0, 'Range.insertCheckboxes was never called', bad.checkboxes);
  check(bad.unmodelled.length === 0, 'no Errors tab holds a swallowed "not modelled" error of the fake (a misspelt call inside a try/catch)', bad.unmodelled);
});

finish();
