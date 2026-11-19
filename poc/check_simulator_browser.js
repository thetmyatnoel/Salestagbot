/**
 * poc/check_simulator_browser.js — the browser-driven check of the simulator (round 5, spec 6.5).
 *
 *   node poc/build_simulator.js && node poc/check_simulator_browser.js
 *
 * Looks for Chrome (process.env.CHROME, then the usual install paths), runs
 *   chrome --headless=new --disable-gpu --virtual-time-budget=60000 --dump-dom "file:///…/pos-simulator.html?autorun=smoke&latency=0"
 * (with a throw-away profile directory), reads <pre id="smoke"> as JSON {passed, failed, errors, checks} (SIM.smoke(),
 * spec 6.6) and exits 1 when failed > 0, errors is not empty or the element is missing. It then runs the same smoke
 * with &transport=post (every app frame takes the postMessage path) and asks for as many passed checks, none failed
 * and no page error there too. With no Chrome it prints
 * "skipped: no Chrome found" and exits 0, so the manual browser checks of spec 8.8 are run instead. Node only.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'poc/dist/pos-simulator.html');

function findChrome() {
  const env = process.env;
  const list = [env.CHROME,
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const p of list) if (p && fs.existsSync(p)) return p;
  return null;
}

/** The <pre id="smoke"> of a dumped DOM: script text is dropped first (sim_ui.js names the element in a comment). */
function smokeOf(dom) {
  const body = String(dom || '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const m = /<pre id="smoke"[^>]*>([\s\S]*?)<\/pre>/.exec(body);
  if (!m) return { found: false };
  const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  try { return { found: true, text: text, data: JSON.parse(text) }; } catch (e) { return { found: true, text: text, data: null, error: e.message }; }
}

/** One headless Chrome run of the page at url (a throw-away profile), the DOM dumped on stdout. */
function dump(chrome, url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-sim-chrome-'));
  const res = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile,
    '--virtual-time-budget=60000', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (ignore) {}
  return res;
}

function main() {
  const chrome = findChrome();
  if (!chrome) { console.log('skipped: no Chrome found'); console.log('0 passed, 0 failed'); process.exit(0); }
  if (!fs.existsSync(OUT)) { console.log('  ✘ poc/dist/pos-simulator.html is missing: run node poc/build_simulator.js'); console.log('0 passed, 1 failed'); process.exit(1); }
  const url = 'file:///' + OUT.replace(/\\/g, '/').replace(/^\/+/, '') + '?autorun=smoke&latency=0';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-sim-chrome-'));
  console.log('Chrome: ' + chrome + '\nPage:   ' + url + '\n');
  const res = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile,
    '--virtual-time-budget=60000', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (ignore) {}
  let pass = 0, fail = 0;
  const check = (cond, label, detail) => {
    if (cond) { pass++; console.log('  ✔ ' + label); }
    else { fail++; console.log('  ✘ ' + label + (detail === undefined ? '' : ' | got: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); }
  };
  check(!res.error && res.status === 0, 'headless Chrome ran and dumped the DOM', res.error ? res.error.message : 'exit ' + res.status + ' ' + String(res.stderr || '').slice(0, 300));
  const s = smokeOf(res.stdout);
  check(s.found, '<pre id="smoke"> is in the page');
  check(!!s.data, 'its text is the JSON of SIM.smoke()', s.error || (s.text || '').slice(0, 200));
  const d = s.data || { passed: 0, failed: 0, errors: [] };
  (d.checks || []).forEach(line => console.log('     smoke: ' + line));
  check(typeof d.passed === 'number' && d.passed > 0, 'SIM.smoke() passed ' + d.passed + ' checks');
  check(d.failed === 0, 'SIM.smoke() failed none', d.failed);
  check(Array.isArray(d.errors) && d.errors.length === 0, 'no page error (window.SIM_ERRORS, handleUpdate)', d.errors);
  check(d.transport === 'direct', 'the app frame of this run reached parent.SIM (the direct transport)', d.transport);

  // The same smoke with &transport=post: every frame takes the postMessage path, the one a host that gives the srcdoc
  // child its own origin would force (the page then sees a frame only through the snapshots and labels it posts).
  console.log('\nPage:   ' + url + '&transport=post\n');
  const res2 = dump(chrome, url + '&transport=post');
  check(!res2.error && res2.status === 0, 'postMessage: headless Chrome ran and dumped the DOM', res2.error ? res2.error.message : 'exit ' + res2.status + ' ' + String(res2.stderr || '').slice(0, 300));
  const s2 = smokeOf(res2.stdout);
  check(s2.found && !!s2.data, 'postMessage: <pre id="smoke"> holds the JSON of SIM.smoke()', s2.error || (s2.text || '').slice(0, 200));
  const d2 = s2.data || { passed: 0, failed: 0, errors: [] };
  (d2.checks || []).forEach(line => console.log('     smoke: ' + line));
  check(d2.transport === 'post', 'postMessage: the app frame took the postMessage path', d2.transport);
  check(typeof d2.passed === 'number' && d2.passed > 0 && d2.passed === d.passed, 'postMessage: SIM.smoke() passed ' + d2.passed + ' checks, as many as over parent.SIM', [d2.passed, d.passed]);
  check(d2.failed === 0, 'postMessage: SIM.smoke() failed none', d2.failed);
  check(Array.isArray(d2.errors) && d2.errors.length === 0, 'postMessage: no page error', d2.errors);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
