/**
 * poc/check_simulator.js — proves the simulator build without a browser (round 5, spec 6.5).
 *
 *   node poc/build_simulator.js && node poc/check_simulator.js
 *
 * The output exists and carries every FILES banner and var SIM_APP_SRCDOC; the srcdoc string as embedded holds no raw
 * </script, no <!-- and no U+2028/U+2029, and decodes to a frame document whose scripts compile; every FRAME_FILES
 * source and the frame shell hold no </script; both template markers were replaced; the file is under 4 MB; the app
 * sets data-cb and reads SIM_HOT, the page reads data-cb; the tours (loaded in a vm with core_config, core_burmese,
 * core_messages, app_i18n, sim_seed and sim_tours) name only MSG/APP_MSG label keys with a non-empty text before the
 * first '{', SIM_USERS logins and the devices tg, app, laptop, floor; a frame without parent.SIM (its boot script in a
 * vm) posts its APP_MSG labels when ready, a snapshot whenever it changes and a fresh one on the page's snap command.
 * Round 6 (spec 10.6, 13.15): 5b the app's forms in the frame (data-f, SIM_HOT, the ops form, set, photo and close, the
 * snapshot's form, hot repaints a form; run on a stub app in a vm), 5c revision 3 in the frame (the three new files,
 * #back, noHistory, the screen op through appNavReset, mark and pick on plain text, the smoke's #back), 6b the sellers'
 * tours on the app's forms (device app, f targets, their done predicates, tgsale on Telegram, no item-card trap), 6d a
 * tour that taps an AI button (the sheet photo, 📒) needs the AI and is blocked, with a reason, while the switch is off.
 * 5d (handovers 13, 15 and 33): the frame's confirm() counts an instant false (a page sandboxed without allow-modals) as
 * OK and leaves a real answer as it is, the page itself never calls confirm(), SIM.smoke closes a changed form with ←
 * while confirm() is ignored, and the header of build_simulator.js counts FRAME_FILES right.
 * Ends with "N passed, M failed" and exit code 1 on a failure. Node only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'poc/dist/pos-simulator.html');
const B = require('./build_simulator.js');

let pass = 0, fail = 0;
function check(cond, label, detail) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.log('  ✘ ' + label + (detail === undefined ? '' : ' | got: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); }
}
const step = title => console.log('\n── ' + title);
function run(fn) { try { fn(); } catch (e) { check(false, 'this step ran to its end', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); } }
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);

let html = '', literal = '', srcdoc = '';

step('1. The output file');
run(() => {
  check(fs.existsSync(OUT), 'poc/dist/pos-simulator.html exists');
  html = fs.readFileSync(OUT, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');
  check(bytes < 4 * 1024 * 1024, 'the file is under 4 MB', Math.round(bytes / 1024) + ' KB');
  check(html.indexOf('<!-- @scripts -->') < 0 && html.indexOf('<!-- @appframe -->') < 0, 'both template markers were replaced');
  const missing = B.FILES.filter(f => html.indexOf('/* ===== ' + f + ' ===== */') < 0);
  check(missing.length === 0, 'every FILES banner is in the output (' + B.FILES.length + ' files)', missing);
  const want = ['core_config', 'core_burmese', 'core_messages', 'core_ai_prompt', 'core_ledger', 'core_report', 'core_bot', 'core_sync', 'core_orders']
    .map(f => 'apps-script/' + f + '.js').concat(['sim_mock_ai', 'sim_ports', 'sim_seed', 'sim_sync', 'sim_tours', 'sim_ui'].map(f => 'poc/' + f + '.js'));
  check(JSON.stringify(B.FILES) === JSON.stringify(want), 'FILES is the build_app core order + core_orders, then the six sim files, sim_tours before sim_ui', B.FILES);
  const at = B.FILES.map(f => html.indexOf('/* ===== ' + f + ' ===== */'));
  check(at.every((x, i) => i === 0 || x > at[i - 1]), 'the banners come in FILES order');
  check(/var SIM_APP_SRCDOC = "/.test(html), 'the output holds var SIM_APP_SRCDOC = "<JSON string>"');
});

step('2. The embedded srcdoc string');
run(() => {
  const m = /var SIM_APP_SRCDOC = ("(?:[^"\\\n]|\\.)*");/.exec(html);
  check(!!m, 'the srcdoc literal is one complete string on its line');
  literal = m ? m[1] : '';
  check(literal.length > 500000, 'the srcdoc literal carries the app bundle (> 500,000 characters)', literal.length);
  check(!/<\/script/i.test(literal), 'the srcdoc string as embedded holds no raw </script');
  check(literal.indexOf('<!--') < 0, 'the srcdoc string as embedded holds no <!--');
  check(literal.indexOf(LS) < 0 && literal.indexOf(PS) < 0, 'the srcdoc string as embedded holds no U+2028 / U+2029');
  srcdoc = vm.runInNewContext(literal);
  check(typeof srcdoc === 'string' && /^<!doctype html>/i.test(srcdoc), 'the literal decodes to a frame document (<!doctype html>)');
  check(srcdoc === B.buildSrcdoc(), 'the decoded document is exactly what build_simulator.js builds from today\'s sources');
  check((srcdoc.match(/<\/script>/g) || []).length === 3, 'decoded, the frame has its three </script> back (prelude, bundle, boot)', (srcdoc.match(/<\/script>/g) || []).length);
});

step('3. The frame document');
run(() => {
  const scripts = [];
  srcdoc.replace(/<script>([\s\S]*?)<\/script>/g, (a, body) => { scripts.push(body); return a; });
  check(scripts.length === 3, 'three inline scripts: the prelude, the bundle, the boot', scripts.length);
  let compiled = 0;
  scripts.forEach((s, i) => { try { new vm.Script(s, { filename: 'frame-script-' + i }); compiled++; } catch (e) { check(false, 'frame script ' + i + ' compiles', e.message); } });
  check(compiled === scripts.length, 'every frame script compiles');
  const bundle = scripts[1] || '';
  const missing = B.FRAME_FILES.filter(f => bundle.indexOf('/* ===== ' + f + ' ===== */') < 0);
  check(missing.length === 0, 'the frame bundle carries every FRAME_FILES source', missing);
  const at = B.FRAME_FILES.map(f => bundle.indexOf('/* ===== ' + f + ' ===== */'));
  check(at.every((x, i) => i === 0 || x > at[i - 1]), 'FRAME_FILES come in order');
  // tools/build_app.js: CORE_FIRST, the other core_*.js alphabetically, then APP_FIRST.
  const tool = read('tools/build_app.js');
  const arr = name => JSON.parse(new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);').exec(tool)[1].replace(/'/g, '"'));
  const coreFirst = arr('CORE_FIRST'), appFirst = arr('APP_FIRST');
  const coreRest = fs.readdirSync(path.join(ROOT, 'apps-script')).filter(f => /^core_.*\.js$/.test(f) && coreFirst.indexOf(f) < 0).sort();
  const order = coreFirst.concat(coreRest).map(f => 'apps-script/' + f).concat(appFirst.map(f => 'app/' + f));
  check(JSON.stringify(B.FRAME_FILES) === JSON.stringify(order), 'FRAME_FILES is the tools/build_app.js order (CORE_FIRST, the rest of core alphabetically, APP_FIRST)', B.FRAME_FILES);
  const bad = B.FRAME_FILES.filter(f => /<\/script/i.test(read(f)));
  check(bad.length === 0, 'no FRAME_FILES source holds </script', bad);
  const shell = B.frameShell();
  check(!/<\/script/i.test(shell) && shell.indexOf('<!--') < 0, 'the frame shell holds no </script and no HTML comment');
  const ids = ['app', 'shopName', 'chip', 'gear', 'banner', 'main', 'bottom', 'btnScan', 'btnVoice', 'btnMenu', 'overlay', 'toast', 'photoInput'];
  check(ids.every(id => shell.indexOf('id="' + id + '"') >= 0), 'the shell keeps the ids appWireEvents binds (' + ids.join(', ') + ')');
  check(srcdoc.indexOf(read('app/app.css').trim()) >= 0, 'app/app.css is inlined in a <style>');
  check(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2/.test(srcdoc) && !/href="[^"]*fonts\/fonts\.css/.test(srcdoc),
    'the frame takes the Google Fonts link (fonts/fonts.css cannot resolve in a srcdoc)');
  check(!/<script[^>]*\bsrc=/.test(srcdoc) && srcdoc.indexOf('function jsQR') < 0 && srcdoc.indexOf('/* ===== app/vendor') < 0,
    'no <script src> in the frame (no config.js) and no jsQR inlined');
  const boot = scripts[2] || '', pre = scripts[0] || '';
  check(/bootApp\(\{ apiUrl: 'fake:\/\/sim-server', botUsername: 'ShopTagBot', appName: 'SalesTag \(demo\)', version: 'demo' \}/.test(boot), 'the boot calls bootApp with the dev page\'s config (fake://sim-server, SalesTag (demo))');
  check(boot.indexOf('adapter: createMemoryAdapter()') >= 0 && boot.indexOf('online: function () { return true; }') >= 0 && boot.indexOf('noServiceWorker: true') >= 0,
    'the boot passes a memory adapter, online() always true and noServiceWorker');
  check(boot.indexOf('window.parent.SIM.frameReady(window, app)') >= 0, 'the boot registers the ready frame with SIM.frameReady(window, app)');
  check(pre.indexOf('window.parent.SIM.ping()') >= 0 && pre.indexOf('window.parent.SIM.server.handle(api, body)') >= 0 && pre.indexOf('window.parent.SIM.latency') >= 0,
    'the transport calls parent.SIM.server.handle after parent.SIM.latency when parent.SIM.ping() answers');
  check(pre.indexOf("simFrame: 'call'") >= 0 && pre.indexOf("d.simPage === 'reply'") >= 0, 'otherwise the transport is a postMessage round trip');
});

step('4. The outer page');
run(() => {
  const blocks = [];
  html.replace(/<script>([\s\S]*?)<\/script>/g, (a, body) => { blocks.push(body); return a; });
  check(blocks.length === B.FILES.length + 1, 'one inline <script> per FILES entry plus the srcdoc block', blocks.length);
  let ok = 0;
  blocks.forEach((s, i) => { try { new vm.Script(s, { filename: 'page-script-' + i }); ok++; } catch (e) { check(false, 'page script ' + i + ' compiles', e.message); } });
  check(ok === blocks.length, 'every page script compiles');
  check(blocks.every(s => s.indexOf('<!--') < 0), 'no page script holds <!-- (the tokenizer\'s double-escaped state)');
  const tpl = read('poc/simulator.template.html');
  check(tpl.indexOf('<!-- @appframe -->') >= 0 && tpl.indexOf('<!-- @scripts -->') > tpl.indexOf('<!-- @appframe -->'), 'the template has both markers, @appframe first');
  const ids = ['login', 'loginOpts', 'who', 'clockNow', 'clock31', 'clockDay', 'clock2100', 'flowForm', 'flowQuick', 'postSummary', 'printTags', 'reset', 'devices',
    'devExtra', 'tours', 'toursBody', 'tagsS1', 'tagsS2', 'tgPane', 'chat', 'startbar', 'inputbar', 'textIn', 'photoBtn', 'micBtn', 'voice', 'phrases', 'outage', 'parserOut',
    'appPane', 'appHolder', 'laptopPane', 'tabs', 'sheetBody', 'wideHolder', 'smoke', 'pop', 'printSheet'];
  const missing = ids.filter(id => tpl.indexOf('id="' + id + '"') < 0);
  check(missing.length === 0, 'the template carries the ids sim_ui.js binds', missing);
  const clk = ['clock31', 'clockDay', 'clock2100', 'clockNow'].map(id => tpl.indexOf('id="' + id + '"'));
  check(clk.every(x => x > 0) && clk[0] < clk[3] && clk[1] < clk[3] && clk[2] < clk[3],
    'the clock buttons come before #clockNow (the text grows with the offset and would push them away between two taps)', clk);
  check(/<details class="voice-box" id="voice">/.test(tpl) && !/<details[^>]*id="voice"[^>]*\bopen\b/.test(tpl), 'the voice phrases sit in one collapsed <details>');
  check(/:root:not\(\[data-theme="light"\]\)/.test(tpl) && /:root\[data-theme="dark"\]/.test(tpl), 'the CSS tokens keep both dark-theme blocks');
});

step('5. The tour hooks');
run(() => {
  const ui = read('app/app_ui.js'), page = read('poc/sim_ui.js');
  check(/'data-cb': b\.callback_data/.test(ui) && /'data-cb': appStepperData\(/.test(ui), 'app/app_ui.js sets data-cb on keyboard buttons and the stepper\'s sell button');
  check(/\.SIM_HOT\b/.test(ui), 'app/app_ui.js reads SIM_HOT');
  check(/'data-cb': b\.callback_data/.test(page) && /getAttribute\('data-cb'\)/.test(page), 'poc/sim_ui.js sets and reads data-cb');
  check(page.indexOf("op: 'hot'") >= 0 && B.BOOT.indexOf('window.SIM_HOT = c.hot') >= 0 && B.BOOT.indexOf('appRender()') >= 0, 'the page sets SIM_HOT on a frame and the frame re-renders (appRender)');
  check(/querySelectorAll\('iframe'\)/.test(page) && /S\.frames = \{\}/.test(page), 'Reset removes every iframe and empties S.frames before boot()');
  check(/world\.settings\.sale_flow = 'form'/.test(page), 'the page boots with sale_flow = form');
  check(/case 'screen': appNavReset\(\)/.test(B.BOOT) && /notify\(\{ kind: 'screen' \}\)/.test(B.BOOT) && /T\.pre === 'home'/.test(page) && /op: 'screen', screen: 'home'/.test(page),
    'a tour on an enrolled phone away from its chat screen waits for the back button (pre "home"), and ⏭ brings the chat back (the frame screen op)');
});

/**
 * The boot script in a vm over a stub app (round 6): app/app_forms.js (the real appFormSnap, with the core it reads) and app/app_icons.js (the
 * real appPlain) are loaded; the app's form and nav functions are stubs that record their calls; document holds two
 * buttons, the history handle (its text plain, as the app draws it) and the header's icon-only #back.
 */
function bootVm(extra) {
  const calls = [];
  const button = (text, cls, id) => ({ textContent: text, className: cls, id: id || '', clicked: 0, click() { this.clicked++; } });
  const buttons = [button('မှတ်တမ်း', 'handle'), button('', 'iconbtn', 'back')];
  const staff = { id: '1001', role: 'staff', shop: 'S1' };
  const app = { screen: 'home', screenArg: null, nav: [{ kind: 'card' }], form: null, measForm: null, enrollError: '', enrollBusy: false,
    store: { chat: [], meta: { deviceId: 'D-1', label: 'phone', receiptLetter: 'A', staff: staff } },
    phone: { ports: { store: { getCustomer: () => null } }, sim: { lastBot: () => null }, on: () => {}, staffId: () => '1001' },
    sync: { chipState: () => ({ kind: 'synced', text: '' }) } };
  const ctx = vm.createContext({ console });
  ['apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js', 'apps-script/core_ledger.js', 'app/app_icons.js', 'app/app_forms.js']
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const win = vm.runInContext('this', ctx);
  const labelsOf = { ui_history: '⌃ မှတ်တမ်း' };
  Object.assign(win, {
    window: win, APP: app, APP_MSG: labelsOf, t: (ports, key) => labelsOf[key] || key,
    document: { getElementById: () => null, querySelectorAll: sel => (sel === '#back' ? [buttons[1]] : sel === '.simhot' ? buttons.filter(b => /simhot/.test(b.className)) : buttons) },
    createMemoryAdapter: () => ({}), setInterval: () => 0, bootApp: () => ({ then: fn => { fn(app); } }),
    appRender: () => { calls.push(['render']); },
    appNavReset: () => { calls.push(['reset']); app.nav = []; app.screen = 'home'; },
    appOpenScreen: name => { calls.push(['screen', name]); app.screen = name; },
    appOpenForm: (kind, req) => { calls.push(['form', kind, req]); return { kind: kind }; },
    appFormSet: (f, v) => { calls.push(['set', f, v]); return true; },
    appFormPhoto: file => { calls.push(['photo', file]); },
    appCloseForm: o => { calls.push(['close', o]); return true; },
    appFormRepaint: F => { calls.push(['repaint', F]); }
  });
  win.parent = { SIM: { frameReady: () => {}, frameEvent: () => {} } };
  win.SIM_FRAME_PRELUDE = { direct: true, transport: null, post: () => {}, setOffset: () => {} };
  if (extra) Object.assign(win, extra);
  vm.runInContext(B.BOOT, ctx, { filename: 'boot' });
  return { win, app, calls, buttons, staff, frame: win.SIM_FRAME };
}

step('5b. The app\'s forms in the frame (round 6, spec 8.2, 10.6)');
run(() => {
  const forms = read('app/app_forms.js');
  check(/'data-f': f\b/.test(forms) && /\.SIM_HOT\b/.test(forms), 'app/app_forms.js sets data-f on its controls and reads SIM_HOT');
  check(/\[data-f\][^{,]*\.hot\b/.test(read('app/app.css')), 'app/app.css styles [data-f].hot (the tour\'s highlight on a form control)');
  check(['form', 'set', 'photo', 'close'].every(op => B.BOOT.indexOf("case '" + op + "':") >= 0) && /appOpenForm\(/.test(B.BOOT) && /appFormSet\(/.test(B.BOOT)
    && /appFormPhoto\(/.test(B.BOOT) && /appCloseForm\(\{\}\)/.test(B.BOOT), 'BOOT has the ops form, set, photo and close (appOpenForm, appFormSet, appFormPhoto, appCloseForm({}) with no question)');
  const v = bootVm(), F = { kind: 'sale', req: {}, values: { lines: [{ id: 'S1-0002', qty: 2, unitPrice: 18000 }], method: 'CASH' }, problems: [{ key: 'sale_need_buyer', field: 'buyer' }],
    last: { f: 'save', n: 4 }, saving: false };
  const s0 = v.frame.snap();
  v.app.form = F;
  const s1 = v.frame.snap();
  check(s0.form === null && !!s1.form && s1.form.kind === 'sale' && s1.form.lines.length === 1 && s1.form.lines[0].qty === 2 && s1.form.last.f === 'save' && s1.form.last.n === 4
    && s1.form.error === 'sale_need_buyer' && JSON.stringify(s1.nav) === '["card"]' && s1.screenArg === null,
    'snap carries the open form (appFormSnap: its lines, last = the control used and its count, error = the first problem\'s key), the stack\'s kinds and screenArg; form null without a form', s1);
  // Step-4 checker: the page's argument and every layer are read from APP, not written as constants.
  v.app.screen = 'buyer'; v.app.screenArg = 'C-0001'; v.app.nav = [{ kind: 'screen' }, { kind: 'screen' }, { kind: 'form' }];
  const s2 = v.frame.snap();
  check(s2.screen === 'buyer' && s2.screenArg === 'C-0001' && JSON.stringify(s2.nav) === '["screen","screen","form"]',
    'snap carries the page\'s argument (the buyer page of C-0001) and the kind of every layer of the stack, in order', s2);
  v.app.screen = 'home'; v.app.screenArg = null; v.app.nav = [{ kind: 'card' }];
  v.calls.length = 0;
  v.frame.cmd({ op: 'hot', hot: 'f:save' });
  const hot1 = v.calls.slice();
  v.app.form = null;
  v.calls.length = 0;
  v.frame.cmd({ op: 'hot', hot: '' });
  check(v.win.SIM_HOT === '' && JSON.stringify(hot1.map(c => c[0])) === '["render","repaint"]' && hot1[1][1] === F && JSON.stringify(v.calls.map(c => c[0])) === '["render"]',
    'hot sets SIM_HOT, renders, and repaints an open form (its controls carry the mark); without a form it only renders', hot1.map(c => c[0]));
  v.calls.length = 0;
  v.frame.cmd({ op: 'form', kind: 'restock' });
  v.frame.cmd({ op: 'form', kind: 'sale', id: 'S1-0003' });
  const f1 = v.calls[0] || [], f2 = v.calls[1] || [];
  check(f1[1] === 'restock' && !('itemId' in f1[2]) && f1[2].uid === '1001' && f1[2].staff === v.staff && f2[1] === 'sale' && f2[2].itemId === 'S1-0003',
    'the form op opens a form as a job tile does (the staff\'s request), with the piece as its first line when given an id', v.calls);
  v.calls.length = 0;
  v.frame.cmd({ op: 'set', f: 'amount', value: 12500 });
  v.frame.cmd({ op: 'set', f: 'paid:part' });
  v.frame.cmd({ op: 'close' });
  check(JSON.stringify(v.calls) === JSON.stringify([['set', 'amount', 12500], ['set', 'paid:part', null], ['close', {}]]),
    'set passes a value to appFormSet (a tap without one), close calls appCloseForm({}) (no question)', v.calls);
  const preset = { key: 'htamein_green', name: 'ထမီ', visual: { emoji: '👗', bg: '#2e7d32' } };
  v.calls.length = 0;
  v.app.form = { kind: 'sale', last: { f: '', n: 1 }, values: {} };
  const refused = v.frame.cmd({ op: 'photo', preset: preset });
  v.app.form = { kind: 'newitem', last: { f: 'price', n: 3 }, values: {} };
  const took = v.frame.cmd({ op: 'photo', preset: preset }), file = (v.calls[0] || [])[1] || {};
  check(refused === false && took === true && v.calls.length === 1 && file.kind === 'photo' && !!file.sim && file.sim.meta === preset && file.sim.visual === preset.visual
    && file.sim.mimeType === 'image/jpeg' && v.app.form.last.f === 'photo' && v.app.form.last.n === 4 && B.BOOT.indexOf('SIM_PHOTOS') < 0,
    'the photo op builds the media from the record it is sent (meta, visual, image/jpeg; BOOT never names SIM_PHOTOS), marks photo as the control used, only in a new-piece form', file);
});

step('5c. Revision 3 in the frame (13.15)');
run(() => {
  check(['app/app_icons.js', 'app/app_sketch.js', 'app/app_screens.js'].every(f => B.FRAME_FILES.indexOf(f) >= 0), 'FRAME_FILES carries the three new app files (app_icons, app_sketch, app_screens)');
  check(B.frameShell().indexOf('id="back"') >= 0, 'the frame shell has the header\'s #back');
  check(/noServiceWorker: true, transport: pre\.transport, noHistory: true \}/.test(B.BOOT), 'BOOT passes noHistory: true to bootApp (the frame never touches the page\'s history)');
  const v = bootVm();
  v.app.nav = [{ kind: 'screen' }, { kind: 'form' }];
  v.frame.cmd({ op: 'screen', screen: 'history' });
  const a = v.calls.slice();
  v.calls.length = 0;
  v.frame.cmd({ op: 'screen', screen: 'home' });
  check(JSON.stringify(a) === JSON.stringify([['reset'], ['screen', 'history']]) && JSON.stringify(v.calls) === JSON.stringify([['reset'], ['render']]),
    'the frame\'s screen op closes every layer (appNavReset) and then opens the page asked for; home is the reset alone', [a, v.calls]);
  const clicked = v.frame.cmd({ op: 'click', sel: 'button.handle', key: 'ui_history' });
  const marked = v.frame.cmd({ op: 'mark', sel: '', text: '⌃ မှတ်တမ်း' });
  const back = v.frame.cmd({ op: 'click', sel: '#back' });
  check(clicked === true && v.buttons[0].clicked === 1 && marked === 1 && /simhot/.test(v.buttons[0].className) && back === true && v.buttons[1].clicked === 1,
    'pick and mark also match a button\'s plain text (the label ⌃ မှတ်တမ်း finds the handle that reads မှတ်တမ်း, appPlain); #back is clicked with no key');
  const page = read('poc/sim_ui.js');
  check(/frameCmd\(S\.frames\.sister, \{ op: 'click', sel: '#back' \}\)/.test(page) && page.indexOf('.pagehead') < 0 && /function homeMark[\s\S]{0,300}'#back'/.test(page),
    'the smoke\'s back step clicks #back and the tour\'s pre-step marks #back (no .pagehead left)');
});

step('5d. confirm() in a page sandboxed without allow-modals (handovers 13, 15) and the build header (33)');
run(() => {
  // The browser's confirm as a stub: it answers next.answer after next.delay ms of a stub clock (performance.now), and
  // notes the question and its this (the real one throws an Illegal invocation unless it is called on the window).
  const clock = { ms: 1000 }, asked = [], next = { answer: false, delay: 0 };
  let selfOk = true, v = null;
  const extra = { performance: { now: () => clock.ms } };
  extra.confirm = function (q) { asked.push(q); if (this !== v.win) selfOk = false; clock.ms += next.delay; return next.answer; };
  v = bootVm(extra);
  const answer = (a, delay) => { next.answer = a; next.delay = delay; return v.win.confirm('q' + asked.length); };
  const got = [answer(false, 0), answer(false, 29), answer(false, 30), answer(false, 1200), answer(true, 0), answer(true, 1200)];
  check(v.win.confirm !== extra.confirm && JSON.stringify(got) === '[true,true,false,false,true,true]' && asked.length === 6 && asked[0] === 'q0' && selfOk,
    'the frame wraps confirm(): a false within 30 ms (a page sandboxed without allow-modals ignores it, false at once) counts as OK, a false after 30 ms or more stays a no, a yes stays a yes; the question reaches the browser\'s own, called on the window',
    { got: got, asked: asked.length, selfOk: selfOk });
  const n0 = asked.length;
  const off = v.frame.cmd({ op: 'modals', on: false });
  next.answer = false; next.delay = 0;
  const sandboxed = v.win.confirm('x');
  const asked1 = asked.length;
  const on = v.frame.cmd({ op: 'modals', on: true });
  const real = answer(false, 1200);
  check(off === true && sandboxed === true && asked1 === n0 && on === true && real === false && asked.length === n0 + 1,
    'the modals command (off) puts an instant false under the wrapper, the way such a host answers, and the frame takes it as OK; on puts the browser\'s own back',
    { sandboxed: sandboxed, real: real, asked: [asked1 - n0, asked.length - n0] });
  const pageSrc = B.FILES.map(read).join('\n') + read('poc/simulator.template.html');
  // A call carries its question: the text "confirm()" in a comment or a label is no call.
  check(!/\bconfirm\s*\((?!\))/.test(pageSrc), 'the outer page never calls confirm() (only the frame does, through the wrapper)', (/[^\n]*\bconfirm\s*\((?!\))[^\n]*/.exec(pageSrc) || [''])[0].trim());
  const page = read('poc/sim_ui.js');
  // The UX review: the app asks with its own sheet, so the smoke taps the form's ←, waits for the sheet (snap.ask), taps its
  // leave button and waits for the form to close; the app's sources never call confirm() either.
  check(/step\('app: the ← of a changed form asks in the app, and its leave button closes it'[\s\S]{0,900}op: 'set', f: 'note'[\s\S]{0,600}frameCmd\(F, \{ op: 'click', sel: '\.formpage \[data-f="close"\]' \}\)[\s\S]{0,300}s\.ask === 'leave'[\s\S]{0,500}sel: '#overlay \[data-f="ask:yes"\]'[\s\S]{0,400}!s\.form/.test(page),
    'SIM.smoke changes a form, taps its own ←, waits for the app\'s question sheet, taps its leave button and waits for the form to close (both transports)');
  const appSrc = B.FRAME_FILES.filter(f => /^app\//.test(f)).map(read).join('\n');
  check(!/\bconfirm\s*\((?!\))/.test(appSrc) && /function appAsk\(/.test(appSrc) && /ask: typeof appAsking === 'function'/.test(read('poc/build_simulator.js')),
    'the app\'s own sources never call confirm(): appAsk draws the question, and the frame\'s snapshot carries the open sheet as ask', (/[^\n]*\bconfirm\s*\((?!\))[^\n]*/.exec(appSrc) || [''])[0].trim());
  // Handover 33: the header names as many core and app files as FRAME_FILES holds.
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
  const head = /FRAME_FILES \(the (\w+) core files \+ the (\w+) app files, build_app order\)/.exec(read('poc/build_simulator.js').split('*/')[0]);
  const nCore = B.FRAME_FILES.filter(x => /^apps-script\//.test(x)).length, nApp = B.FRAME_FILES.filter(x => /^app\//.test(x)).length;
  check(!!head && words.indexOf(head[1]) === nCore && words.indexOf(head[2]) === nApp && nCore + nApp === B.FRAME_FILES.length,
    'the header of build_simulator.js names the FRAME_FILES counts (' + nCore + ' core + ' + nApp + ' app files)', head && head.slice(1));
});

step('6. The tours as data');
run(() => {
  const ctx = vm.createContext({ console });
  ['apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js', 'apps-script/core_sync.js', 'app/app_i18n.js', 'poc/sim_seed.js', 'poc/sim_tours.js']
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const T = vm.runInContext('SIM_TOURS', ctx), MSG = vm.runInContext('MSG', ctx), APP_MSG = vm.runInContext('APP_MSG', ctx);
  const USERS = vm.runInContext('SIM_USERS', ctx), VERBS = vm.runInContext('SIM_TOUR_MSG', ctx);
  const DEVICES = ['tg', 'app', 'laptop', 'floor'];
  check(Array.isArray(T) && T.length >= 17, 'SIM_TOURS holds the tours of 6.4 (at least 17)', T && T.length);
  const ids = T.map(t => t.id);
  check(ids.length === new Set(ids).size, 'tour ids are unique', ids);
  const want = ['sell', 'deposit', 'mixed', 'price', 'back', 'restock', 'newitem', 'return', 'expense', 'payment', 'takedeposit', 'order', 'reports', 'enrol', 'lists', 'quick', 'stranger'];
  check(want.every(id => ids.indexOf(id) >= 0), 'every tour of 6.4 is there (' + want.join(', ') + ')', want.filter(id => ids.indexOf(id) < 0));
  const text = key => (MSG[key] !== undefined ? MSG[key] : APP_MSG[key]);
  const labels = [], badLabel = [], badLogin = [], badDevice = [], badTarget = [], badDone = [], badCaption = [], noCaption = [];
  const KINDS = ['tag', 'cb', 'label', 're', 'type', 'ui', 'tab', 'f'];
  T.forEach(tour => {
    if (!USERS[tour.login] || tour.login === 'customer') badLogin.push(tour.id + '.login=' + tour.login);
    if (DEVICES.indexOf(tour.device) < 0) badDevice.push(tour.id + '.device=' + tour.device);
    (tour.devices || []).forEach(d => { if (DEVICES.indexOf(d) < 0) badDevice.push(tour.id + '.devices ' + d); });
    if (!tour.title || !tour.title.my || !tour.title.en) noCaption.push(tour.id + '.title');
    (tour.steps || []).forEach((s, i) => {
      const where = tour.id + '#' + (i + 1);
      if (s.login !== undefined && !USERS[s.login]) badLogin.push(where + '.login=' + s.login);
      if (s.device !== undefined && DEVICES.indexOf(s.device) < 0) badDevice.push(where + '.device=' + s.device);
      if (s.only && DEVICES.indexOf(s.only) < 0) badDevice.push(where + '.only=' + s.only);
      const t = s.target || {}, kinds = Object.keys(t).filter(k => KINDS.indexOf(k) >= 0);
      if (kinds.length !== 1) badTarget.push(where + ' ' + JSON.stringify(t));
      if (t.cb !== undefined && Buffer.byteLength(String(t.cb), 'utf8') > 64) badTarget.push(where + ' cb over 64 bytes');
      if (t.re !== undefined) { try { new RegExp(t.re); } catch (e) { badTarget.push(where + ' re ' + t.re); } }
      if (t.label !== undefined) labels.push(t.label);
      if (typeof s.done !== 'function') badDone.push(where);
      if (!s.my || !s.en) noCaption.push(where);
      [s.my, s.en].forEach(c => String(c || '').replace(/\{([a-z]+):([^}]*)\}/g, (a, kind, arg) => {
        if (['k', 'f', 'l', 'v', 'c'].indexOf(kind) < 0) badCaption.push(where + ' ' + a);
        if (kind === 'c' && arg !== 'code') badCaption.push(where + ' ' + a);
        if (kind === 'k') labels.push(arg);
        if (kind === 'f' && text(arg.split('|')[0]) === undefined) badCaption.push(where + ' ' + a);
        if (kind === 'v' && !VERBS[arg]) badCaption.push(where + ' ' + a);
        if (kind === 'l' && !/^[a-z_]+\.[A-Za-z0-9_]+$/.test(arg)) badCaption.push(where + ' ' + a);
        return a;
      }));
    });
  });
  labels.forEach(k => { const s = text(k); if (s === undefined || !String(s).split('{')[0].trim()) badLabel.push(k); });
  check(labels.length > 0 && badLabel.length === 0, 'every label key the tours name (targets and {k:} captions, ' + labels.length + ') is in MSG or APP_MSG with a non-empty text before its first {', badLabel);
  check(badLogin.length === 0, 'every tour login and every step override is a SIM_USERS key (a tour starts as staff)', badLogin);
  check(badDevice.length === 0, 'every device is tg, app, laptop or floor', badDevice);
  check(badTarget.length === 0, 'every step has exactly one target of 6.4 (tag, cb, label, re, type, ui, tab, f), cb within 64 bytes, re compiles', badTarget);
  check(badDone.length === 0, 'every step has a done(evt, ctx) predicate', badDone);
  check(noCaption.length === 0, 'every tour title and step caption has Burmese and English', noCaption);
  check(badCaption.length === 0, 'every caption placeholder names a known key, verb or list option', badCaption);
  const srcs = VERBS.sources || {};
  check(['scan', 'tap', 'type'].every(v => VERBS[v] && srcs[v] && String(MSG[srcs[v]]).indexOf(VERBS[v]) >= 0),
    'each SIM_TOUR_MSG verb is a word the bot already says (scan လုပ်ပါ in menu, နှိပ်ပါ in help, ရိုက်ပါ in cust_find)', VERBS);
  const stranger = T.filter(t => t.id === 'stranger')[0];
  check(!!stranger && stranger.steps.some(s => s.login === 'customer'), 'the stranger tour has a step with login customer');
  // The enrol tour: the pane switches to 📱 for the code, so the caption carries it; the app reads the code with or
  // without its dash and in either case (syncNormalizeCode), and so does the step.
  const enrol = T.filter(t => t.id === 'enrol')[0];
  const codeStep = enrol && enrol.steps.filter(s => s.target && s.target.type === '@code')[0];
  check(!!codeStep && codeStep.device === 'app' && /\{c:code\}/.test(codeStep.my) && /\{c:code\}/.test(codeStep.en)
    && /\(k\|f\|l\|v\|c\)/.test(read('poc/sim_ui.js')), 'the type-the-code step of the enrol tour (on 📱) shows the code in both captions ({c:code}, filled by sim_ui.js)');
  const frameWith = code => ({ frame: { deviceId: '', code: code, screen: 'enroll' }, code: 'V796-UGQE' });
  const e0 = { src: 'page', kind: 'tick' };
  check(!!codeStep && codeStep.done(e0, frameWith('V796-UGQE')) && codeStep.done(e0, frameWith('V796UGQE')) && codeStep.done(e0, frameWith('v796-ugqe'))
    && !codeStep.done(e0, frameWith('V796-UGQ')) && !codeStep.done(e0, frameWith('')) && !codeStep.done(e0, { frame: { deviceId: '', code: '' }, code: '' }),
    'the code step is done when the box holds the code with or without its dash, in either case; not for a part of it or an empty box');
  const deposit = T.filter(t => t.id === 'deposit')[0];
  check(!!deposit && deposit.steps.some(s => s.device === 'laptop' && s.login === 'owner') && deposit.steps.some(s => s.target && s.target.ui === '#clockDay')
    && deposit.steps.some(s => s.target && s.target.ui === '#postSummary'), 'the deposit tour switches to the owner\'s 💻: Credits, ⏩ +1 ရက်, 🕘 21:00, Post 21:00 summary');
  const tgsale = T.filter(t => t.id === 'tgsale')[0];
  check(!!tgsale && tgsale.steps.some(s => s.target && s.target.cb === 'S|S1-0002|1') && tgsale.steps.some(s => s.target && s.target.cb === 'SC|S1-0002|ok'),
    'the tgsale tour runs from S|S1-0002|1 to SC|S1-0002|ok');
  // The done predicates answer the events they are written for.
  const tap = (data, src) => ({ src: src || 'tg', kind: 'tap', data: data });
  const c0 = { want: '' };
  const s3 = tgsale.steps.filter(s => s.target && s.target.cb === 'S|S1-0002|1')[0];
  check(s3.done(tap('S|S1-0002|1'), c0) && s3.done(tap('S|S1-0002|3', 'app'), c0) && !s3.done(tap('S|S1-0002|3', 'tg'), c0) && !s3.done(tap('S|S1-0003|1', 'app'), c0),
    'a S|<id>|1 target is done by that tap, and on the app by any S|<id>|<n> of the stepper');
  const pay = T.filter(t => t.id === 'payment')[0], all = pay.steps.filter(s => s.target && s.target.label === 'btn_all')[0];
  check(all.done(tap('PA|g|all'), { want: 'PA|g|all' }) && !all.done(tap('PA|g|other'), { want: 'PA|g|all' }), 'a label target is done by the tap on the button the label rule found (c.want)');
});

step('6b. The sellers\' tours on the app\'s forms (round 6, spec 8.3, 8.4, 10.6)');
run(() => {
  const ctx = vm.createContext({ console });
  ['apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js', 'apps-script/core_sync.js', 'app/app_i18n.js', 'poc/sim_seed.js', 'poc/sim_tours.js']
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const T = vm.runInContext('SIM_TOURS', ctx), USERS = vm.runInContext('SIM_USERS', ctx), ITEMS = vm.runInContext('SIM_SEED_ITEMS', ctx), PHOTOS = vm.runInContext('SIM_PHOTOS', ctx);
  const byId = id => T.filter(t => t.id === id)[0];
  const APP_TOURS = ['sell', 'deposit', 'mixed', 'price', 'back', 'restock', 'newitem', 'expense'];
  const own = t => t.steps.filter(s => !s.device || s.device === t.device);   // the sale part: the steps on the tour's own pane
  const notApp = APP_TOURS.filter(id => { const t = byId(id); return !t || t.device !== 'app' || (t.devices || []).some(d => d !== 'app'); });
  check(notApp.length === 0, 'the tours ' + APP_TOURS.join(', ') + ' run on the app (device app and no other pane)', notApp);
  const badEnd = APP_TOURS.filter(id => { const t = byId(id), o = t ? own(t) : [], last = o[o.length - 1]; return !last || !last.target || last.target.f !== (id === 'back' ? 'close' : 'save'); });
  check(badEnd.length === 0, 'their sale part ends at an f target, f: save (close for back); deposit then goes on to the owner\'s laptop', badEnd);
  const e0 = { src: 'page', kind: 'tick' }, badDone = [];
  const at = (f, n, mark) => ({ frame: { form: { kind: 'x', last: { f: f, n: n } } }, mark: { formN: mark } });
  APP_TOURS.forEach(id => {
    const t = byId(id), o = t ? own(t) : [];
    o.forEach((s, i) => {
      if (!s.target || s.target.f === undefined || i === o.length - 1) return;   // the last step carries the done of 8.4
      const name = s.target.f, job = /^job:(.+)$/.exec(name);
      let good;
      if (job) {
        const kind = job[1] === 'sell' ? 'sale' : job[1] === 'new' ? 'newitem' : job[1];
        good = s.done(e0, { frame: { form: { kind: kind } }, mark: {} }) && !s.done(e0, { frame: { form: null }, mark: {} }) && !s.done(e0, { frame: { form: { kind: 'other' } }, mark: {} });
      } else {
        good = s.done(e0, at(name, 3, 2)) && !s.done(e0, at(name, 2, 2)) && !s.done(e0, at(name + '-', 3, 2)) && !s.done(e0, { frame: { form: null }, mark: { formN: 0 } });
      }
      if (!good) badDone.push(id + ' ' + name);
    });
  });
  check(badDone.length === 0, 'every f / fset step is done by formUsed (its control used after the step began: last.f is its name, last.n above the mark) or, for a job tile, formIs (its form open)', badDone);
  const forms = read('app/app_forms.js'), unknown = [];
  T.forEach(t => t.steps.forEach(s => {
    if (!s.target || s.target.f === undefined) return;
    const name = String(s.target.f), head = name.split(':')[0], lit = "'" + head + (name.indexOf(':') >= 0 ? ':' : "'");
    if (forms.indexOf(lit) < 0) unknown.push(t.id + ' ' + name);
  }));
  check(unknown.length === 0, 'every f name a tour uses, up to its first ":", is a literal in app/app_forms.js', unknown);
  const tg = byId('tgsale');
  check(!!tg && tg.device === 'tg' && !tg.devices && tg.steps.some(s => s.target && s.target.cb === 'SS|S1-0002|add'), 'tgsale runs on Telegram and holds SS|S1-0002|add (➕, then a scan joins the review card)');
  check(['return', 'reports'].every(id => !!byId(id) && byId(id).device === 'tg' && !byId(id).devices), 'return and reports have no devices: they run on Telegram whichever pane is open (revision 2, B1)');
  const sellable = {};
  ITEMS.forEach(it => { if (Number(it.stock) > 0) sellable[it.id] = it.shop; });
  const trap = [];
  T.forEach(t => {
    if (t.device !== 'app' && (t.devices || []).indexOf('app') < 0) return;
    const u = USERS[t.login] || {}, steps = t.steps.filter(s => s.only !== 'tg' && (!s.device || s.device === 'app'));
    steps.forEach((s, i) => {
      const id = s.target && s.target.tag, next = steps[i + 1];
      if (!id || !sellable[id] || (u.role !== 'owner' && sellable[id] !== u.shop)) return;
      if (next && next.target && /^(T|X|R|D|Q|QN|S)\|/.test(String(next.target.cb || ''))) trap.push(t.id + ' ' + id + ' then ' + next.target.cb);
    });
  });
  check(trap.length === 0, 'no tour that can run on the app scans a sellable own-shop piece and then wants a button only its item card has (T|, X|, R|, D|, Q|, QN|, S|): in form mode that scan opens the sale form', trap);
  const ni = byId('newitem'), ph = ni && ni.steps.filter(s => s.target && s.target.f === 'photo')[0], sent = [];
  if (ph && ph.act) ph.act({ frameCmd: c => sent.push(c) });
  const green = PHOTOS.filter(p => p.key === 'htamein_green')[0];
  check(sent.length === 1 && sent[0].op === 'photo' && !!green && sent[0].preset === green, 'the newitem tour\'s photo step sends the whole htamein_green record of SIM_PHOTOS, never a key (revision 2, B3)', sent);
  const page = read('poc/sim_ui.js');
  check(/function doLogin[\s\S]*?if \(S\.user\.role === 'staff'\) S\.device = 'app';[\s\S]*?if \(S\.device === 'app'\) ensureFrame\(key\);/.test(page),
    'doLogin puts a staff login on 📱 and starts its frame (the owner keeps the open device)');
  check(/t\.ui\.indexOf\('frame:'\) === 0\) \{ frameCmd\(S\.frames\[S\.login\], \{ op: 'click', sel: t\.ui\.slice\(6\) \}\)/.test(page)
    && /op: 'set', f: t\.f, value: t\.value/.test(page) && /op: 'click', sel: '\[data-f="' \+ t\.f \+ '"\]'/.test(page)
    && /T\.hot = t\.f \? 'f:' \+ t\.f/.test(page) && /formN: snap0 && snap0\.form && snap0\.form\.last \? snap0\.form\.last\.n : 0/.test(page),
    'doTarget maps frame: to the click op and an f target to set (a value) or a click on [data-f]; an f target is hot as f:<name>; a step records the form\'s last count (formN)');
});

// Step-4 checker: the done column of 8.4 run on made-up worlds (each tour ends on its outcome and on nothing less), and
// the app's scan steps (tagIn: a home scan's /start, or the piece already in the open form, as a line or as its tag).
step('6c. What ends each seller\'s tour (spec 8.4, the done column) and the scan steps on the app (tagIn)');
run(() => {
  const ctx = vm.createContext({ console });
  ['apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js', 'apps-script/core_sync.js', 'app/app_i18n.js', 'poc/sim_seed.js', 'poc/sim_tours.js']
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const T = vm.runInContext('SIM_TOURS', ctx), ST = vm.runInContext('CFG.STATUS', ctx);
  let credits = [];
  vm.runInContext('this', ctx).openCredits = () => credits;   // creditOf (the deposit tour) reads the world's open credits
  const byId = id => T.filter(t => t.id === id)[0];
  const lastOwn = id => { const t = byId(id), o = t ? t.steps.filter(s => !s.device || s.device === t.device) : []; return o[o.length - 1] || null; };
  const e0 = { src: 'page', kind: 'tick' };
  const row = (type, itemId, more) => Object.assign({ type: type, itemId: itemId || '', groupId: 'G1', qty: 0, amount: 0, method: '' }, more || {});
  const ctxOf = (rows, mark, extra) => Object.assign({ world: { ledger: rows, ports: { store: { getItem: () => null } } }, mark: { ledger: mark || 0, formN: 0 }, frame: { form: null } }, extra || {});
  const ends = (id, c) => { const s = lastOwn(id); return !!s && s.done(e0, c) === true; };
  const item = it => ({ world: { ledger: [], ports: { store: { getItem: id => (id === 'S1-0007' ? it : null) } } }, mark: { ledger: 0, formN: 0 }, frame: { form: null } });
  check(ends('sell', ctxOf([row('SALE', 'S1-0002', { qty: -1, amount: 18000 })])) && !ends('sell', ctxOf([row('SALE', 'S1-0003', { qty: -1 })]))
    && !ends('sell', ctxOf([row('SALE', 'S1-0002', { qty: -1 })], 1)) && !ends('sell', ctxOf([row('SALE', 'S1-0002', { reversesTxId: 'T-1' })])),
    'the sell tour ends on a SALE of S1-0002 written after its Save step began (not another piece, not an older row, not a reversal)');
  credits = [{ customer: 'ဒေါ်နီနီ', owed: 12500 }];
  const depOk = ends('deposit', ctxOf([]));
  credits = [{ customer: 'ဒေါ်စန်း', owed: 22500 }];
  check(depOk && !ends('deposit', ctxOf([])), 'the deposit tour\'s sale part ends when ဒေါ်နီနီ has an open credit (and not for another buyer)');
  check(ends('mixed', ctxOf([row('SALE', 'S1-0003'), row('PAYMENT', '', { amount: 5000, method: 'KBZ' })])) && !ends('mixed', ctxOf([row('PAYMENT', '', { amount: 5000, method: 'CASH' })]))
    && !ends('mixed', ctxOf([row('PAYMENT', '', { amount: 4000, method: 'KBZ' })])) && !ends('mixed', ctxOf([row('SALE', 'S1-0003', { amount: 12000 })])),
    'the mixed tour ends on a PAYMENT of 5,000 to KBZ (not cash, not another amount, not a SALE alone)');
  check(ends('price', ctxOf([row('SALE', 'S1-0002', { qty: -2, amount: 30000 })])) && !ends('price', ctxOf([row('SALE', 'S1-0002', { qty: -1, amount: 15000 })]))
    && !ends('price', ctxOf([row('SALE', 'S1-0002', { qty: -2, amount: 36000 })])) && !ends('price', ctxOf([row('SALE', 'S1-0003', { qty: -2, amount: 30000 })])),
    'the price tour ends on a SALE of S1-0002 of 2 x 15,000 (not one piece, not the list price, not another piece)');
  const one = [row('SALE', 'S1-0002')];
  check(ends('back', ctxOf(one, 1)) && !ends('back', ctxOf(one, 1, { frame: { form: { kind: 'sale' } } })) && !ends('back', ctxOf(one.concat([row('SALE', 'S1-0003')]), 1))
    && !ends('back', ctxOf(one, 1, { frame: null })), 'the back tour ends when the form is closed and the ledger has not grown (not while the form is open, not after a write)');
  check(ends('restock', ctxOf([row('RESTOCK', 'S2-0003', { qty: 5 })])) && !ends('restock', ctxOf([row('RESTOCK', 'S2-0003', { qty: 4 })]))
    && !ends('restock', ctxOf([row('RESTOCK', 'S2-0002', { qty: 5 })])) && !ends('restock', ctxOf([row('SALE', 'S2-0003', { qty: 5 })])),
    'the restock tour ends on a RESTOCK of +5 of S2-0003 (not +4, not another piece, not another type)');
  check(ends('newitem', item({ id: 'S1-0007', status: ST.ACTIVE, price: 25000 })) && !ends('newitem', item({ id: 'S1-0007', status: ST.BLANK, price: '' }))
    && !ends('newitem', item({ id: 'S1-0007', status: ST.ACTIVE, price: 20000 })) && !ends('newitem', item(null)),
    'the newitem tour ends when the world\'s S1-0007 is ACTIVE at 25,000 (not while blank, not at another price)');
  check(ends('expense', ctxOf([row('EXPENSE', '', { amount: -20000, cash: -20000 })])) && !ends('expense', ctxOf([row('EXPENSE', '', { amount: -15000 })]))
    && !ends('expense', ctxOf([row('SALE', 'S1-0002', { amount: 20000 })])), 'the expense tour ends on an EXPENSE of 20,000 (not another amount, not another type)');
  check(ends('tgsale', ctxOf([row('SALE', 'S1-0002'), row('SALE', 'S1-0005')])) && !ends('tgsale', ctxOf([row('SALE', 'S1-0002'), row('SALE', 'S1-0005', { groupId: 'G2' })]))
    && !ends('tgsale', ctxOf([row('SALE', 'S1-0002')])) && !ends('tgsale', ctxOf([row('SALE', 'S1-0002'), row('SALE', 'S1-0005')], 2)),
    'the tgsale tour ends on two SALE rows of one group written by its Save (not two groups, not one row, not older rows)');
  const APP_TOURS = ['sell', 'deposit', 'mixed', 'price', 'back', 'restock', 'newitem', 'expense'], badTag = [];
  let tags = 0;
  APP_TOURS.forEach(id => {
    const t = byId(id);
    (t ? t.steps : []).forEach(s => {
      const tag = s.target && s.target.tag;
      if (!tag || (s.device && s.device !== 'app')) return;
      tags++;
      const form = f => ({ frame: { form: f }, mark: {} });
      const good = s.done({ src: 'app', kind: 'text', text: '/start ' + tag }, { frame: { form: null }, mark: {} })
        && s.done(e0, form({ kind: 'sale', itemId: '', lines: [{ id: 'S1-0005', qty: 1 }, { id: tag, qty: 1 }] }))
        && s.done(e0, form({ kind: 'newitem', itemId: tag, lines: [] }))
        && !s.done(e0, form({ kind: 'sale', itemId: '', lines: [{ id: 'S9-9999', qty: 1 }] }))
        && !s.done({ src: 'app', kind: 'text', text: '/start S9-9999' }, { frame: { form: null }, mark: {} }) && !s.done(e0, { frame: null, mark: {} });
      if (!good) badTag.push(id + ' ' + tag);
    });
  });
  check(tags >= 8 && badTag.length === 0, 'every scan step of the app tours (' + tags + ') is done by the home scan\'s /start <id> or by the piece in the open form (a line, or the new-piece form\'s tag); not by another piece', badTag);
});

// Review fix (step 4, 13.11): the bot offers its AI buttons only while the owner's AI switch is on (measMethodRow's sheet
// photo, the menu's 📒), so a tour that taps one needs the AI (need.ai) and does not start while it is off: the panel
// says why (with Reset) instead of waiting on a button that never comes.
step('6d. A tour that taps an AI button needs the AI (review fix, 13.11)');
run(() => {
  const ctx = vm.createContext({ console });
  ['apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js', 'apps-script/core_sync.js', 'app/app_i18n.js', 'poc/sim_seed.js', 'poc/sim_tours.js']
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const T = vm.runInContext('SIM_TOURS', ctx), byId = id => T.filter(t => t.id === id)[0];
  const AI_CBS = ['MM|c775fb3c7f|photo', 'M|nb'], AI_LABELS = ['btn_meas_photo', 'btn_notebook'];
  const tapsAi = s => {
    const t = s.target || {};
    return (t.cb !== undefined && (/^MM\|[^|]+\|photo$/.test(t.cb) || t.cb === 'M|nb')) || (t.re !== undefined && AI_CBS.some(cb => new RegExp(t.re).test(cb)))
      || AI_LABELS.indexOf(t.label) >= 0;
  };
  const users = T.filter(t => (t.steps || []).some(tapsAi)).map(t => t.id), unmarked = users.filter(id => !(byId(id).need || {}).ai);
  check(users.indexOf('order') >= 0 && unmarked.length === 0,
    'every tour that taps a button the bot offers only with AI on (the sheet photo MM|<t>|photo, 📒 M|nb) needs the AI, need.ai (' + users.join(', ') + ')', unmarked);
  // tourBlocked as the page has it, run over a stub world whose Settings the real aiOn reads (the switch the bot obeys).
  const page = read('poc/sim_ui.js');
  const fn = /\n  (function tourBlocked\(tour\) \{[\s\S]*?\n  \})\n/.exec(page), msg = /\n  (var AI_OFF_TOUR = '[^\n]*';)\n/.exec(page);
  check(!!fn && !!msg, 'poc/sim_ui.js has tourBlocked and the AI_OFF_TOUR text');
  if (!fn || !msg) return;
  const settings = {};
  Object.assign(vm.runInContext('this', ctx), {
    world: { settings: settings, ports: { store: { getSetting: (k, d) => (Object.prototype.hasOwnProperty.call(settings, k) ? settings[k] : d) } } },
    itemView: () => ({ stock: 1, status: 'BLANK' }), frameEnrolled: () => false
  });
  vm.runInContext(msg[1] + '\n' + fn[1], ctx, { filename: 'tourBlocked' });
  const tourBlocked = vm.runInContext('tourBlocked', ctx), text = vm.runInContext('AI_OFF_TOUR', ctx);
  const blocked = (id, ai) => { if (ai === undefined) delete settings.ai; else settings.ai = ai; return tourBlocked(byId(id)); };
  const offOthers = T.filter(t => !(t.need || {}).ai && blocked(t.id, 'FALSE') !== '').map(t => t.id);
  const got = [blocked('order', 'FALSE'), blocked('order', 'off'), blocked('order', undefined), blocked('order', 'TRUE')];
  check(got[0] === text && got[1] === text && got[2] === '' && got[3] === '' && /^AI is off/.test(text) && /Reset/.test(text) && offOthers.length === 0,
    'with Settings ai FALSE (or off) the order tour is blocked with the AI-off text, which offers Reset; with no ai row or TRUE it starts; no tour without need.ai is blocked by the switch', { got: got, offOthers: offOthers });
  check(/step\('a tour that needs the AI, with the AI off'[\s\S]{0,400}world\.settings\.ai = 'FALSE';\s*tourStart\('order'\)/.test(page),
    'SIM.smoke starts the order tour with Settings ai FALSE in the browser (the blocked panel, on both transports)');
});

// Round 6b (SPEC-round-6b.md 5.7): the tours newcat (the plus chip and the sample switch on the app, then the owner's
// Lists tab) and tgrestock (📦 in Telegram's menu: a loop of tags), run as data and, for tgrestock, on the real bot; the
// page's rack sign and the Lists tab's item_category (its count in the footnote, its add through addItemCategory).
step('6e. Round 6b: the tours newcat and tgrestock, the rack\'s 🎨 and the Lists tab\'s item_category (SPEC-round-6b.md 5.7)');
run(() => {
  const ctx = vm.createContext({ console });
  ['apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_messages.js', 'apps-script/core_ai_prompt.js', 'apps-script/core_ledger.js',
    'apps-script/core_report.js', 'apps-script/core_bot.js', 'apps-script/core_sync.js', 'apps-script/core_orders.js', 'app/app_i18n.js',
    'poc/sim_mock_ai.js', 'poc/sim_ports.js', 'poc/sim_seed.js', 'poc/sim_tours.js']
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const T = vm.runInContext('SIM_TOURS', ctx), ST = vm.runInContext('CFG.STATUS', ctx), MSG = vm.runInContext('MSG', ctx), USERS = vm.runInContext('SIM_USERS', ctx);
  const byId = id => T.filter(t => t.id === id)[0], ids = T.map(t => t.id), e0 = { src: 'page', kind: 'tick' };
  check(ids.filter(x => x === 'newcat').length === 1 && ids.filter(x => x === 'tgrestock').length === 1
    && ids.indexOf('newcat') < ids.indexOf('stranger') && ids.indexOf('tgrestock') < ids.indexOf('stranger'), 'the tours newcat and tgrestock exist once each, before stranger', ids);

  // newcat: the app only; the plus chip, a typed name, the sample switch, Save; then the owner's laptop, the Lists tab.
  const nc = byId('newcat'), own = nc.steps.filter(s => !s.device || s.device === nc.device), last = own[own.length - 1];
  const fAt = name => own.findIndex(s => !!s.target && s.target.f === name);
  check(nc.device === 'app' && (nc.devices || []).every(d => d === 'app') && !!nc.need && nc.need.blank === 'S1-0008' && !!last && last.target.f === 'save',
    'newcat runs on the app only, needs the blank tag S1-0008, and its own-pane part ends at f: save', { device: nc.device, need: nc.need, last: last && last.target });
  const named = own[fAt('catname')], price = own.filter(s => s.target && s.target.f === 'price' && s.target.value !== undefined)[0];
  check(fAt('cat:add') >= 0 && !!named && named.target.value === 'ပိုးအင်္ကျီ' && fAt('cat:add') < fAt('catname') && fAt('sample') > fAt('catname') && fAt('sample') < own.length - 1
    && !!price && price.done(e0, { frame: { form: { last: { f: 'price:25000', n: 3 } } }, mark: { formN: 2 } }),
    'newcat taps f: cat:add, then sets catname to ပိုးအင်္ကျီ (a value), a price (the price:25000 chip counts), taps f: sample, then Save', own.map(s => s.target && s.target.f));
  const saveAt = nc.steps.indexOf(last), lap = nc.steps.slice(saveAt + 1).filter(s => s.device === 'laptop' && s.login === 'owner' && s.target && s.target.tab === 'lists');
  const tabEv = name => ({ src: 'page', kind: 'ui', name: 'tab', tab: name });
  check(lap.length === 1 && lap[0].done(tabEv('lists'), { device: 'laptop', tab: 'lists' }) && !lap[0].done({ src: 'page', kind: 'enter' }, { device: 'laptop', tab: 'lists' })
    && !lap[0].done(tabEv('dash'), { device: 'laptop', tab: 'dash' }) && !lap[0].done(tabEv('lists'), { device: 'app', tab: 'lists' }),
    'after its Save newcat goes on to the owner\'s laptop and is done when the Lists tab is opened there (not by a Lists tab already open when the step begins, another tab or pane)');
  const at = (item, rows) => ({ world: { ledger: [], ports: { store: { getItem: id => (id === 'S1-0008' ? item : null), listOptions: name => (name === 'item_category' ? rows : []) } } },
    mark: { ledger: 0, formN: 0 }, frame: { form: null } });
  const piece = more => Object.assign({ id: 'S1-0008', status: ST.ACTIVE, category: 'ပိုးအင်္ကျီ', sample: true }, more || {});
  const silk = [{ list: 'item_category', key: 'i3fa2', label: 'ပိုးအင်္ကျီ', active: true }], other = [{ list: 'item_category', key: 'other', label: 'အခြား', active: true }];
  check(last.done(e0, at(piece(), silk)) && last.done(e0, at(piece({ sample: 'TRUE' }), other.concat(silk))) && !last.done(e0, at(piece(), other)) && !last.done(e0, at(piece(), []))
    && !last.done(e0, at(piece({ category: 'အခြား' }), silk)) && !last.done(e0, at(piece({ sample: false }), silk)) && !last.done(e0, at(piece({ status: ST.BLANK }), silk))
    && !last.done(e0, at(null, silk)), 'newcat\'s Save is done when the world\'s S1-0008 is ACTIVE, a sample, of category ပိုးအင်္ကျီ and the world\'s Lists hold that item_category row (not without the row, another category, no sample, still blank)');

  // tgrestock: Telegram; the menu's 📦, two tags each with its START and a count, then ✅.
  const tr = byId('tgrestock'), cbs = tr.steps.filter(s => s.target && s.target.cb !== undefined).map(s => s.target.cb);
  const rqs = tr.steps.filter(s => s.target && /^RQ\|[^|]+\|[0-9]+$/.test(String(s.target.cb || '')));
  check(tr.device === 'tg' && !tr.devices && tr.login === 'owner' && cbs.indexOf('M|restock') >= 0 && rqs.length === 2 && cbs[cbs.length - 1] === 'RT|done'
    && cbs.every(c => Buffer.byteLength(c, 'utf8') <= 64), 'tgrestock runs on Telegram as the owner: M|restock, two RQ|<id>|<n>, RT|done last, every callback within 64 bytes', cbs);
  const starts = tr.steps.map((s, i) => ({ s: s, prev: tr.steps[i - 1] })).filter(x => x.s.target && x.s.target.ui === '#startbar button');
  check(starts.length === 2 && starts.every(x => !/item card/i.test(x.s.en) && x.s.my && x.s.only === 'tg' && !!x.prev && !!x.prev.target.tag
    && x.s.done({ src: 'tg', kind: 'text', text: '/start ' + x.prev.target.tag }, {}) && !x.s.done({ src: 'tg', kind: 'text', text: '/start S9-9999' }, {})),
    'its two START steps follow their tag, are done by that /start <id>, and carry their own captions (the en does not say "item card": the loop shows the count screen)', starts.map(x => x.s.en));
  const row = (type, itemId, more) => Object.assign({ type: type, itemId: itemId || '', groupId: 'G1', qty: 0, amount: 0 }, more || {});
  const ledgerAt = (rows, mark) => ({ world: { ledger: rows, ports: { store: { getItem: () => null } } }, mark: { ledger: mark || 0, formN: 0 }, frame: { form: null } });
  const badRq = rqs.filter(s => {
    const p = s.target.cb.split('|'), id = p[1], n = Number(p[2]);
    return !(s.done(e0, ledgerAt([row('RESTOCK', id, { qty: n })])) && !s.done(e0, ledgerAt([row('RESTOCK', id, { qty: n })], 1)) && !s.done(e0, ledgerAt([row('RESTOCK', id, { qty: n + 1 })]))
      && !s.done(e0, ledgerAt([row('RESTOCK', 'S1-0003', { qty: n })])) && !s.done(e0, ledgerAt([row('SALE', id, { qty: n })])) && !s.done(e0, ledgerAt([row('RESTOCK', id, { qty: n, reversesTxId: 'T-1' })])));
  }).map(s => s.target.cb);
  check(badRq.length === 0 && rqs.map(s => s.target.cb).join(',') === 'RQ|S1-0002|5,RQ|S2-0003|1',
    'each RQ step is done by a RESTOCK of that item and count written after the step began (not an older row, another count or item, a SALE or a reversal)', badRq);
  const last2 = tr.steps[tr.steps.length - 1];
  check(last2.target.cb === 'RT|done' && last2.done({ src: 'tg', kind: 'tap', data: 'RT|done' }, {}) && !last2.done({ src: 'tg', kind: 'tap', data: 'RT|skip' }, {}), 'tgrestock ends on the tap RT|done');

  // tgrestock on the real bot (the page's world: the four lists, sale_flow form), each step acted as ⏭ does and
  // checked on the events the page's updateEvent makes; every callback is on the last bot message when it is tapped.
  const page = read('poc/sim_ui.js');
  const ue = /\n  (function updateEvent\(src, u\) \{[\s\S]*?\n  \})\n/.exec(page);
  check(!!ue, 'poc/sim_ui.js has updateEvent (the world\'s updates as tour events)');
  if (ue) {
    vm.runInContext(ue[1], ctx, { filename: 'updateEvent' });
    const updateEvent = vm.runInContext('updateEvent', ctx);
    const world = vm.runInContext('(function () { var w = simSeedLists(seedSimWorld(createSimWorld())); w.settings.sale_flow = \'form\'; return w; })()', ctx);
    const events = [], user = USERS[tr.login], n0 = world.ledger.length;
    world.listeners.push(evt => {
      if (evt.type === 'update') events.push(updateEvent('tg', evt.update));
      else if (evt.type !== 'synclog' && evt.type !== 'chat') events.push({ src: 'world', kind: evt.type });
    });
    const onLast = (m, data) => !!m && (m.keyboard || []).some(r => r.some(b => b.callback_data === data));
    let pending = null, stuck = '';
    tr.steps.filter(s => !s.only || s.only === tr.device).forEach((s, i) => {
      if (stuck) return;
      const t = s.target, mark = { ledger: world.ledger.length, formN: 0, meas: 0 };
      const c = () => ({ world: world, mark: mark, frame: null, device: 'tg', tab: 'dash', want: t.cb || '', login: tr.login, user: user });
      if (s.done({ src: 'page', kind: 'enter' }, c())) { stuck = '#' + (i + 1) + ' was done before it was acted'; return; }
      events.length = 0;
      if (t.type) world.sim.text(user, t.type);
      else if (t.tag) { pending = t.tag; events.push({ src: 'page', kind: 'scan', id: t.tag }); }
      else if (t.ui === '#startbar button') { world.sim.start(user, pending); pending = null; }
      else if (t.cb) {
        const m = world.sim.lastBot(user);
        if (!onLast(m, t.cb)) { stuck = '#' + (i + 1) + ' ' + t.cb + ' is not on the last bot message: ' + (m && m.text); return; }
        world.sim.tap(user, m.id, t.cb);
      } else { stuck = '#' + (i + 1) + ' has a target the dry run does not act: ' + JSON.stringify(t); return; }
      if (!events.some(e => s.done(e, c()))) stuck = '#' + (i + 1) + ' was not done after its action (' + JSON.stringify(t) + '); the bot said: ' + (world.sim.lastBot(user) || {}).text;
    });
    const rows = world.ledger.slice(n0).filter(r => r.type === 'RESTOCK' && !r.reversesTxId).map(r => r.itemId + ' +' + r.qty);
    const end = world.sim.lastBot(user) || {}, st = world.cacheData['st:' + user.id];
    check(!stuck && rows.join(',') === 'S1-0002 +5,S2-0003 +1' && end.text === MSG.restock_loop_done && !st,
      'tgrestock runs to its end on the bot: two RESTOCK rows (S1-0002 +5, S2-0003 +1), the last message reads restock_loop_done and the loop is over', { stuck: stuck, rows: rows, end: end.text, st: st });
  }

  // The page: the rack's sample sign, the Lists tab's footnote names item_category, and its add goes through addItemCategory.
  check(page.indexOf("it.sample ? ' 🎨 sample' : ''") >= 0 && page.indexOf(' (sample)') < 0, 'the rack marks a sample \' 🎨 sample\' (G1), no \' (sample)\' left');
  check(/var names = \{[^\n]*\bitem_category: '[^']+'/.test(page) && /function listsTab\(\)[\s\S]*?var names = \{[^\n]*item_category:/.test(page),
    'the Lists tab\'s names map holds item_category (the footnote counts its rows)');
  const fa = /\n  (function addListRow\(list, label, kind\) \{[\s\S]*?\n  \})\n/.exec(page);
  check(!!fa && /addItemCategory\(world\.ports, label, SIM_USERS\.owner, ''\)/.test(fa[1]), 'addListRow calls addItemCategory(world.ports, label, SIM_USERS.owner, \'\') for item_category');
  if (fa) {
    const w2 = vm.runInContext('simSeedLists(seedSimWorld(createSimWorld()))', ctx), S = { addNote: '' };
    Object.assign(vm.runInContext('this', ctx), { world: w2, S: S, tourEvent: () => {}, renderAll: () => {}, document: { activeElement: null }, $: () => ({ contains: () => false }) });
    vm.runInContext(fa[1], ctx, { filename: 'addListRow' });
    const addListRow = vm.runInContext('addListRow', ctx), ic = () => w2.lists.filter(r => r.list === 'item_category').length, ic0 = ic();
    const a1 = addListRow('item_category', 'နမူနာ', ''), n1 = S.addNote, c1 = ic();
    w2.ports.store.setListRow('item_category', 'wutsone', { active: false });
    const a2 = addListRow('item_category', 'ဝတ်စုံ', ''), n2 = S.addNote, c2 = ic();
    const a3 = addListRow('item_category', 'ပိုးအင်္ကျီ', ''), n3 = S.addNote;
    const added = w2.lists.filter(r => r.list === 'item_category' && r.label === 'ပိုးအင်္ကျီ');
    const a4 = addListRow('pay_method', 'AYA Pay', 'wallet'), aya = w2.lists.filter(r => r.list === 'pay_method' && r.label === 'AYA Pay')[0];
    check(ic0 === 5 && !a1.ok && a1.reason === 'sample' && n1 === 'Not added: sample' && c1 === 5 && !a2.ok && a2.reason === 'closed' && n2 === 'Not added: closed' && c2 === 5
      && a3.ok && /^i[0-9a-f]{4}$/.test(a3.key) && added.length === 1 && ic() === 6 && n3 === 'Added "ပိုးအင်္ကျီ" (key ' + a3.key + ').'
      && a4.ok && !!aya && aya.kind === 'wallet',
      'the laptop\'s add of an item_category row: the five built-ins first; နမူနာ refused (Not added: sample) and a closed name refused (Not added: closed), nothing written; a new name added once; pay_method keeps addListOptionByLabel with its Kind',
      { ic0: ic0, a1: a1, n1: n1, a2: a2, n2: n2, a3: a3, n3: n3, a4: a4, aya: aya });
  }

  // Step-4 checker (round 6b): what 5.7 and the captions pin beyond the checks above, each found by a mutant that left
  // them green, and the loop's three minutes (a slow read of tgrestock ended the loop and stranded the tour).
  check(nc.login === 'sister' && nc.title.my === 'ပစ္စည်းအသစ် · အမျိုးအစားအသစ် ➕ · နမူနာ' && nc.title.en === 'A new piece with a new category, as a sample'
    && tr.title.my === 'Telegram · ☰ 📦 ကုန်ရောက် · Tag အများ' && tr.title.en === 'Telegram: restock several tags from the menu',
    'newcat starts as the sister (seller shop 1); the titles of newcat and tgrestock are the spec\'s (5.7; step-4 checker)', { login: nc.login, titles: [nc.title, tr.title] });
  const pAt = f => ({ frame: { form: { last: { f: f, n: 3 } } }, mark: { formN: 2 } });
  check(!!price && price.target.value === 25000 && price.done(e0, pAt('price')) && price.done(e0, pAt('price:' + price.target.value)) && !price.done(e0, pAt('price:22000')),
    'newcat\'s price step sets 25,000 (a default preset: a new category has no pieces yet) and its chip is the one of that value, price:25000 (step-4 checker)', price && price.target);
  const sampleStep = own[fAt('sample')], lapEn = lap.length ? String(lap[0].en) : '';
  check(!!sampleStep && /\{k:ui_lbl_sample\}/.test(sampleStep.my) && /A sample is not the category \{l:item_category\.other\}/.test(sampleStep.en) && /department/.test(sampleStep.en)
    && ['Label', 'Active', 'Order', 'Detail'].every(w => lapEn.indexOf(w) >= 0) && /\{l:item_category\.other\} is the catch-all and always comes last/.test(lapEn),
    'newcat\'s captions: the sample step says what a sample is and that it is not the category အခြား; the laptop step names Label, Active, Order, Detail and the catch-all always last (5.7; step-4 checker)',
    { sample: sampleStep && sampleStep.en, laptop: lapEn });
  const opened = [];
  if (lap.length && lap[0].act) lap[0].act({ openTab: n => opened.push(n) });
  check(opened.join(',') === 'lists' && lap[0].done(tabEv(opened[0]), { device: 'laptop', tab: opened[0] }),
    '⏭ on newcat\'s laptop step opens the Lists tab (its act), and the tab event that sends completes the step (step-4 checker)', opened);
  check(starts.length === 2 && starts.every(x => /\{k:ask_restock_qty\}/.test(x.s.my)) && /\{k:btn_restock_sell\}/.test(starts[0].s.en) && /\{k:btn_cancel\}/.test(starts[1].s.en),
    'tgrestock\'s START steps: the my caption names the count screen ({k:ask_restock_qty}), not start()\'s; the en names 🛒 (btn_restock_sell) on the first and ✖️ (btn_cancel) on the second (step-4 checker)', starts.map(x => x.s.my));
  const lt = /\n  function listsTab\(\) \{[\s\S]*?\n  \}\n/.exec(page), ltSrc = lt ? lt[0] : '';
  check(ltSrc.indexOf("item_category: 'item_category · item categories'") >= 0 && ltSrc.indexOf('or the emoji of an expense category, or the emoji Telegram shows for an item category') >= 0
    && ltSrc.indexOf('fabric_presets) and the five built-in item categories') >= 0,
    'the Lists tab\'s texts: the names map labels item_category as the spec does, the Detail sentence names the emoji Telegram shows for an item category, the empty-tab text names the five built-in item categories (5.7; step-4 checker)');
  const rqSteps = tr.steps.filter(s => s.target && /^RQ\|[^|]+\|[0-9]+$/.test(String(s.target.cb || '')));
  check(rqSteps.length === 2 && rqSteps.every(s => typeof s.act === 'function' && /three minutes/.test(s.en) && /\{k:btn_restock\}/.test(s.en) && /\/start/.test(s.en) && /START again/.test(s.en)),
    'tgrestock\'s count steps say what to do when the item card came instead (the loop ended after three minutes: /start, {k:btn_restock}, the scan, START) and carry the act ⏭ uses for it (step-4 checker fix)', rqSteps.map(s => s.en));
  if (ue) {
    // tgrestock on the real bot again, acted exactly as ⏭ acts in the page (a step's act when it has one, else its target):
    // once as it is, then with the world clock moved past CFG.RESTOCK_LOOP_TTL_SEC before each START (a slow reader).
    const updateEvent = vm.runInContext('updateEvent', ctx), TTL = vm.runInContext('CFG.RESTOCK_LOOP_TTL_SEC', ctx), PRESETS = vm.runInContext('CFG.RESTOCK_PRESETS', ctx);
    const kbOf = m => ((m && m.keyboard) || []).map(r => r.map(b => b.callback_data));
    const dry = late => {
      const world = vm.runInContext('(function () { var w = simSeedLists(seedSimWorld(createSimWorld())); w.settings.sale_flow = \'form\'; return w; })()', ctx);
      const events = [], user = USERS[tr.login], n0 = world.ledger.length, screens = [];
      world.listeners.push(evt => {
        if (evt.type === 'update') events.push(updateEvent('tg', evt.update));
        else if (evt.type !== 'synclog' && evt.type !== 'chat') events.push({ src: 'world', kind: evt.type });
      });
      const newest = d => { const list = world.chats[user.id] || []; for (let i = list.length - 1; i >= 0; i--) if (list[i].from === 'bot' && kbOf(list[i]).some(r => r.indexOf(d) >= 0)) return list[i]; return null; };
      let pending = null, stuck = '';
      const page = {   // what the page's makeCtx gives an act, on this world (tapOn taps the newest message with the button)
        world: world, user: user, login: tr.login, device: 'tg', tab: 'dash', frame: null,
        text: v => world.sim.text(user, v),
        tapData: d => { const m = newest(d); if (!m) throw new Error('no button ' + d + ' in the chat'); world.sim.tap(user, m.id, d); },
        scan: id => { pending = id; events.push({ src: 'page', kind: 'scan', id: id }); },
        start: () => { const id = pending; pending = null; if (id) world.sim.start(user, id); }
      };
      tr.steps.filter(s => !s.only || s.only === tr.device).forEach((s, i) => {
        if (stuck) return;
        const t = s.target, c = Object.assign({}, page, { mark: { ledger: world.ledger.length, formN: 0, meas: 0 }, want: t.cb || '' });
        events.length = 0;
        try {
          if (t.ui === '#startbar button') {
            if (late) world.clockOffsetMs = (world.clockOffsetMs || 0) + (TTL + 1) * 1000;
            const id = pending;
            page.start();
            screens.push({ id: id, kb: kbOf(world.sim.lastBot(user)) });
          } else if (s.act) s.act(c);
          else if (t.type) page.text(t.type);
          else if (t.tag) page.scan(t.tag);
          else if (t.cb) {
            const m = world.sim.lastBot(user);
            if (!kbOf(m).some(r => r.indexOf(t.cb) >= 0)) throw new Error(t.cb + ' is not on the last bot message: ' + (m && m.text));
            world.sim.tap(user, m.id, t.cb);
          } else throw new Error('a target the dry run does not act: ' + JSON.stringify(t));
        } catch (err) { stuck = '#' + (i + 1) + ' ' + ((err && err.message) || err); return; }
        if (!events.some(e => s.done(e, c))) stuck = '#' + (i + 1) + ' was not done after ⏭ (' + JSON.stringify(t) + '); the bot said: ' + (world.sim.lastBot(user) || {}).text;
      });
      return { stuck: stuck, screens: screens, rows: world.ledger.slice(n0).filter(r => r.type === 'RESTOCK' && !r.reversesTxId).map(r => r.itemId + ' +' + r.qty).join(','),
        end: (world.sim.lastBot(user) || {}).text, st: world.cacheData['st:' + user.id] || null,
        said: (world.chats[user.id] || []).filter(m => m.from === 'user' && typeof m.text === 'string').map(m => m.text).join(' | ') };
    };
    const countScreen = id => JSON.stringify([PRESETS.map(n => 'RQ|' + id + '|' + n), ['RQ|' + id + '|other', 'RT|skip'], ['K|' + id]]);
    const now = dry(false);
    check(!now.stuck && now.screens.length === 2 && now.screens.every(x => JSON.stringify(x.kb) === countScreen(x.id)) && now.rows === 'S1-0002 +5,S2-0003 +1' && now.end === MSG.restock_loop_done && !now.st
      && now.said === '/start | /start S1-0002 | /start S2-0003',
      'acted as ⏭ acts, each START in tgrestock\'s loop gives the count screen of its tag: +1 to +20, ✏️ RQ|<id>|other and ✖️ RT|skip, 🛒 K|<id> (what its captions name); the tour ends as above, and ⏭ sends nothing beyond the tour\'s own /start and two STARTs (step-4 checker)', now);
    const late = dry(true);
    check(!late.stuck && late.screens.length === 2 && late.screens.every(x => !x.kb.some(r => r.indexOf('RQ|' + x.id + '|other') >= 0)) && late.rows === 'S1-0002 +5,S2-0003 +1'
      && late.end === MSG.restock_loop_done && !late.st && late.said === '/start | /start S1-0002 | /start | /start S1-0002 | /start S2-0003 | /start | /start S2-0003',
      'with the world clock moved past the loop\'s ' + TTL + ' s before each START (the item card comes, not the count screen), ⏭ on each count opens the loop again (/start, 📦, the scan, START) and tgrestock still ends with S1-0002 +5, S2-0003 +1 and restock_loop_done (step-4 checker fix)', late);
  }
});

step('7. A frame without parent.SIM (the boot script in a vm, the postMessage prelude stubbed)');
run(() => {
  // What the page knows of such a frame is what it posts: the labels of APP_MSG (the page has no app_i18n.js) and a
  // snapshot after every change, also one nobody announced (a screen opened in the app, a code typed into the box).
  const boot = (direct) => {
    const posted = [], timers = [], ready = [];
    const app = { screen: 'home', store: { chat: [], meta: { deviceId: 'D-1', label: 'phone', receiptLetter: 'A' } }, measForm: null, enrollError: '', enrollBusy: false,
      phone: { ports: {}, sim: { lastBot: () => null }, on: () => {} }, sync: { chipState: () => ({ kind: 'ok', text: '' }) } };
    const ctx = vm.createContext({
      JSON, String, Object, APP: app, APP_MSG: { ui_btn_back: '← နောက်သို့', ui_sync_waiting: '⏳ {n} ခု ကျန်' },
      t: (ports, key) => ({ ui_btn_back: '← နောက်သို့', ui_sync_waiting: '⏳ {n} ခု ကျန်' })[key] || key,
      document: { getElementById: () => null, querySelectorAll: () => [] },
      createMemoryAdapter: () => ({}), appRender: () => {}, setInterval: (fn) => { timers.push(fn); return timers.length; },
      bootApp: () => ({ then: (fn) => { fn(app); } })
    });
    const win = vm.runInContext('this', ctx);
    win.window = win;
    win.parent = { SIM: { frameReady: () => ready.push(1), frameEvent: () => {} } };
    win.SIM_FRAME_PRELUDE = { direct: direct, transport: null, post: (m) => posted.push(JSON.parse(JSON.stringify(m))), setOffset: () => {} };
    vm.runInContext(B.BOOT, ctx, { filename: 'boot' });
    return { app, posted, timers, ready, frame: win.SIM_FRAME };
  };
  const p = boot(false), first = p.posted[0] || {};
  check(first.simFrame === 'ready' && !!first.snap && first.labels && first.labels.ui_btn_back === '← နောက်သို့' && first.labels.ui_sync_waiting === '⏳'
    && Object.keys(first.labels).length === 2, 'the ready message carries a snapshot and the label of every APP_MSG key (the label rule: ⏳ {n} ခု ကျန် → ⏳)', first);
  const n0 = p.posted.length;
  p.timers.forEach(fn => fn());
  const quiet = p.posted.length === n0;
  p.app.screen = 'history';
  p.timers.forEach(fn => fn());
  const pushed = p.posted.slice(n0), again = p.posted.length;
  p.timers.forEach(fn => fn());
  const d = boot(true);
  check(p.timers.length === 1 && quiet && pushed.length === 1 && pushed[0].simFrame === 'event' && pushed[0].e.kind === 'snap' && pushed[0].e.snap.screen === 'history'
    && p.posted.length === again && d.ready.length === 1 && d.posted.length === 0 && d.timers.length === 0,
    'a watcher posts a snapshot when it changed without an event (the history screen), once, and nothing while it stays the same; with parent.SIM there is none (SIM.frameReady, nothing posted)',
    { pushed: pushed, direct: [d.ready.length, d.posted.length, d.timers.length] });
  const ans = p.frame.cmd({ op: 'snap', id: 7 }), last = p.posted[p.posted.length - 1] || {};
  check(ans === true && last.e && last.e.kind === 'snap' && last.e.id === 7 && last.e.snap.screen === 'history', 'the snap command answers with a fresh snapshot carrying its id', last);
  const page = read('poc/sim_ui.js');
  check(/rec\.labels && Object\.prototype\.hasOwnProperty\.call\(rec\.labels, key\)/.test(page) && /frameCmd\(rec, \{ op: 'snap', id: T\.ask \}\)/.test(page)
    && /e\.kind === 'snap' && e\.id && T && T\.ask === e\.id/.test(page) && /Q\.transport === 'post'/.test(page),
    'the page reads APP_MSG labels from those a frame posted, asks for a fresh snapshot when an app step begins and reads its answer (?transport=post forces this path)');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
