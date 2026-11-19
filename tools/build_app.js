/**
 * tools/build_app.js — builds the phone app into app/dist/ (what `firebase deploy` uploads).
 *
 *   node tools/build_app.js
 *
 * 1. Concatenates, in this order: apps-script/core_config.js, core_burmese.js, core_messages.js,
 *    core_ai_prompt.js, core_ledger.js, core_report.js, core_bot.js, core_sync.js, then any other
 *    apps-script/core_*.js alphabetically (a later core_orders.js joins on its own), then app/app_i18n.js,
 *    app_store.js, app_ports.js, app_sync.js, app_scan.js, app_media.js, app_ui.js and any other app/app_*.js,
 *    into app/dist/app.<hash>.js (hash = first 10 hex of the SHA-256 of the version and the sources, so an unchanged rebuild keeps its name). The bundle is compiled once
 *    with vm.Script to catch a syntax error before deploy.
 * 2. Copies index.html (script tag + version stamped), app.css, manifest.webmanifest, sw.js (version and the
 *    precache list stamped), ping.html, fonts/, vendor/, icons/, and config.js (or config.example.js when
 *    config.js is missing, with a warning) into app/dist/. Writes app/dist/version.json.
 * 3. Refuses to build when any text going to dist contains 'AIza', a bot token pattern
 *    (digits:AA...), or the strings BOT_TOKEN= / GEMINI_KEY= / WEBHOOK_SECRET=.
 * Stale app.<hash>.js bundles from earlier builds (its own output) are removed from app/dist so the
 * deploy stays small; nothing outside app/dist is ever touched. Node-only: modern JS is fine here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const DIST = path.join(APP, 'dist');
const CORE_FIRST = ['core_config.js', 'core_burmese.js', 'core_messages.js', 'core_ai_prompt.js', 'core_ledger.js', 'core_report.js', 'core_bot.js', 'core_sync.js'];
const APP_FIRST = ['app_i18n.js', 'app_store.js', 'app_ports.js', 'app_sync.js', 'app_scan.js', 'app_media.js', 'app_icons.js', 'app_ui.js', 'app_forms.js', 'app_sketch.js', 'app_screens.js'];
const SECRET_PATTERNS = [
  { re: /AIza/, why: 'looks like a Google API key (AIza...)' },
  { re: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/, why: 'looks like a Telegram bot token (digits:token)' },
  { re: /BOT_TOKEN=|GEMINI_KEY=|WEBHOOK_SECRET=/, why: 'contains a secret assignment (BOT_TOKEN= / GEMINI_KEY= / WEBHOOK_SECRET=)' }
];

function read(p) { return fs.readFileSync(p, 'utf8'); }
function listDir(dir, filter) { return fs.existsSync(dir) ? fs.readdirSync(dir).filter(filter).sort() : []; }
function scanSecrets(name, text) {
  for (const s of SECRET_PATTERNS) {
    const m = s.re.exec(text);
    if (m) {
      const at = text.lastIndexOf('\n', m.index);
      throw new Error('refusing to build: ' + name + ' ' + s.why + ' near "' + text.slice(m.index, m.index + 12) + '…" (line ' + (text.slice(0, at + 1).split('\n').length) + ')');
    }
  }
}

function main() {
  const version = (fs.existsSync(path.join(APP, 'VERSION')) ? read(path.join(APP, 'VERSION')) : '0.0.0').trim();
  const builtAt = new Date().toISOString();

  // 1. the bundle
  const coreDir = path.join(ROOT, 'apps-script');
  const coreRest = listDir(coreDir, f => /^core_.*\.js$/.test(f) && !CORE_FIRST.includes(f));
  const appRest = listDir(APP, f => /^app_.*\.js$/.test(f) && !APP_FIRST.includes(f));
  const files = CORE_FIRST.map(f => path.join('apps-script', f)).concat(coreRest.map(f => path.join('apps-script', f)))
    .concat(APP_FIRST.map(f => path.join('app', f))).concat(appRest.map(f => path.join('app', f)));
  const parts = files.map(rel => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) throw new Error('missing ' + rel);
    const src = read(p);
    if (src.includes('</script')) throw new Error(rel + ' contains "</script"');
    return '/* ===== ' + rel.replace(/\\/g, '/') + ' ===== */\n' + src.trim() + '\n';
  });
  let bundle = '/* SalesTag app bundle ' + version + ' · built ' + builtAt + ' by tools/build_app.js. Do not edit; edit apps-script/core_*.js and app/app_*.js. */\n' + parts.join('\n');
  // The hash covers the version and the sources, not the build time: rebuilding unchanged code keeps the
  // same file name, so a redeploy does not make every phone download the app again.
  const hash = crypto.createHash('sha256').update(version + '\n' + parts.join('\n')).digest('hex').slice(0, 10);
  bundle = 'var APP_BUILD = ' + JSON.stringify({ version, hash, builtAt }) + ';\n' + bundle;
  try { new vm.Script(bundle, { filename: 'app.' + hash + '.js' }); } catch (err) { throw new Error('bundle does not compile: ' + err.message); }
  scanSecrets('bundle', bundle);

  // 2. the files going to dist, stamped
  const stamp = version + '+' + hash;
  const bundleName = 'app.' + hash + '.js';
  const out = {};
  out[bundleName] = bundle;
  out['index.html'] = read(path.join(APP, 'index.html')).replace('<!-- @app-script -->', '<script src="' + bundleName + '"></script>').replace(/__APP_VERSION__/g, stamp);
  out['app.css'] = read(path.join(APP, 'app.css'));
  out['manifest.webmanifest'] = read(path.join(APP, 'manifest.webmanifest'));
  out['ping.html'] = read(path.join(APP, 'ping.html')).replace(/__APP_VERSION__/g, stamp);
  const configPath = fs.existsSync(path.join(APP, 'config.js')) ? path.join(APP, 'config.js') : path.join(APP, 'config.example.js');
  if (configPath.endsWith('config.example.js')) console.warn('warning: app/config.js not found; using config.example.js (the app will show the config error until the real /exec URL is set)');
  out['config.js'] = read(configPath);
  if (!configPath.endsWith('config.example.js') && /PASTE_|YourBotUsername/.test(out['config.js'])) console.warn('warning: app/config.js still has a placeholder (PASTE_... or YourBotUsername); fill in the /exec URL and the bot username');
  const copies = {};
  ['fonts', 'vendor', 'icons'].forEach(dir => {
    listDir(path.join(APP, dir), f => !f.startsWith('.') && f !== 'MANIFEST.json').forEach(f => { copies[dir + '/' + f] = path.join(APP, dir, f); });
  });
  const precache = ['index.html', bundleName, 'app.css?v=' + stamp, 'manifest.webmanifest', 'config.js', 'version.json'].concat(Object.keys(copies).filter(f => !/LICENSE/i.test(f)));
  out['sw.js'] = read(path.join(APP, 'sw.js'))
    .replace(/^var SW_VERSION = .*;\s*\/\/ @sw-version.*$/m, 'var SW_VERSION = ' + JSON.stringify(stamp) + '; // @sw-version')
    .replace(/^var SW_PRECACHE = .*;\s*\/\/ @sw-precache.*$/m, 'var SW_PRECACHE = ' + JSON.stringify(precache) + '; // @sw-precache');
  if (!out['sw.js'].includes(JSON.stringify(stamp))) throw new Error('sw.js: the @sw-version line was not found');
  out['version.json'] = JSON.stringify({ version, hash, build: stamp, builtAt, bundle: bundleName, files: files.map(f => f.replace(/\\/g, '/')), precache }, null, 2) + '\n';
  Object.keys(out).forEach(name => scanSecrets(name, out[name]));
  Object.keys(copies).forEach(name => { if (/\.(js|css|svg|json)$/i.test(name)) scanSecrets(name, read(copies[name])); });

  // 3. write dist (remove only this script's own earlier bundles)
  fs.mkdirSync(DIST, { recursive: true });
  listDir(DIST, f => /^app\.[0-9a-f]{10}\.js$/.test(f) && f !== bundleName).forEach(f => fs.unlinkSync(path.join(DIST, f)));
  Object.keys(out).forEach(name => fs.writeFileSync(path.join(DIST, name), out[name]));
  Object.keys(copies).forEach(name => {
    const target = path.join(DIST, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(copies[name], target);
  });
  const size = Buffer.byteLength(bundle, 'utf8');
  console.log('wrote app/dist/' + bundleName + ' (' + Math.round(size / 1024) + ' KB, ' + files.length + ' files) and ' + (Object.keys(out).length - 1 + Object.keys(copies).length) + ' more files; build ' + stamp);
}

try { main(); } catch (err) { console.error('build_app failed: ' + err.message); process.exit(1); }
