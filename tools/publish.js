/**
 * tools/publish.js — one-step publishing from this PC (set up with docs/AUTO-PUBLISH-SETUP.html).
 *
 *   node tools/publish.js bot "what changed"   build Code.gs, upload it, move the live web app to it
 *   node tools/publish.js rollback [N]          move the live web app back to version N
 *                                               (default: the version it ran before the last publish)
 *   node tools/publish.js app                   build the phone app and deploy it to Firebase Hosting
 *   node tools/publish.js status                show who is signed in, the live version, and the web app check
 *
 * Add --any-time to publish the bot inside a scheduled-job window anyway.
 *
 * Safety rules (each one guards against a failure seen in review):
 *  - The web app runs as whoever deployed it (executeAs USER_DEPLOYING), so clasp must be signed in as
 *    the account in publish.config.json, or the bot would start running as someone else.
 *  - Only the existing deployment is updated, so the /exec address Telegram uses never changes.
 *  - push uses --force: without a terminal clasp silently answers "no" to the manifest question.
 *  - No publish within 15 minutes of the daily summary (21:00), the weekly backup (Sunday 22:00) or the
 *    monthly report (1st, 08:00), Yangon time: those triggers run the newest code at once.
 *  - The web app is checked with a GET (never a POST, which would log a webhook_token error). A sign-in
 *    page instead of the bot's answer means access changed: the deployment is moved straight back.
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAS = path.join(ROOT, 'apps-script');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'publish.config.json'), 'utf8'));
const LOG = path.join(__dirname, 'publish-log.jsonl');

function run(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || GAS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function say(s) { console.log(s); }
function fail(s) { console.error('STOPPED: ' + s); process.exit(1); }

function yangonNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value;
  return { weekday: get('weekday'), day: Number(get('day')), minutes: Number(get('hour')) * 60 + Number(get('minute')),
    label: get('weekday') + ' ' + get('hour') + ':' + get('minute') };
}

function inJobWindow() {
  const t = yangonNow();
  const near = m => Math.abs(t.minutes - m) <= 15;
  if (near(21 * 60)) return 'the daily summary at 21:00';
  if (t.weekday === 'Sun' && near(22 * 60)) return 'the weekly backup on Sunday 22:00';
  if (t.day === 1 && near(8 * 60)) return 'the monthly report on the 1st at 08:00';
  return '';
}

function signedInAccount() {
  const out = run('clasp show-authorized-user');
  const m = out.match(/logged in as\s+(\S+?)\.?\s*$/m);
  return m ? m[1] : '';
}

function liveVersion() {
  const out = run('clasp list-deployments');
  const line = out.split(/\r?\n/).find(l => l.indexOf(CONFIG.deploymentId) >= 0);
  if (!line) fail('the web app deployment ' + CONFIG.deploymentId + ' is not in clasp list-deployments.');
  const m = line.match(/@(\d+)/);
  if (!m) fail('could not read the version from: ' + line.trim());
  return Number(m[1]);
}

// 200 = the bot's own page. A redirect to script.googleusercontent.com is also the bot (older code answered
// that way). Anything else, above all a redirect to accounts.google.com, means the web app is not public.
async function checkWebApp() {
  const res = await fetch(CONFIG.webAppUrl, { redirect: 'manual' });
  const where = res.headers.get('location') || '';
  const okay = res.status === 200 || (res.status === 302 && /^https:\/\/script\.googleusercontent\.com\//.test(where));
  return { okay, status: res.status, where: where.split('?')[0] };
}

function lastLogEntry() {
  if (!fs.existsSync(LOG)) return null;
  const lines = fs.readFileSync(LOG, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}
function writeLog(entry) { fs.appendFileSync(LOG, JSON.stringify(entry) + '\n'); }

function checkAccount() {
  const who = signedInAccount();
  if (who !== CONFIG.account) {
    fail('clasp is signed in as "' + (who || 'nobody') + '", but the web app must be published by ' + CONFIG.account +
      '. In Command Prompt: clasp logout, then clasp login with that account.');
  }
  return who;
}

async function publishBot(description, anyTime) {
  if (!description) fail('say what changed, for example: node tools/publish.js bot "fix receipt numbers"');
  const job = inJobWindow();
  if (job && !anyTime) fail('it is ' + yangonNow().label + ' in Yangon, within 15 minutes of ' + job + '. Try again later, or add --any-time.');
  checkAccount();

  say('1/6 building Code.gs');
  say(run('node tools/bundle_gas.js', ROOT).trim());

  say('2/6 reading the live version');
  const before = liveVersion();
  const pre = await checkWebApp();
  say('    live version @' + before + ', web app check before: HTTP ' + pre.status);

  say('3/6 uploading (clasp push --force)');
  say(run('clasp push --force').trim());

  say('4/6 moving the web app to a new version (same /exec address)');
  say(run('clasp update-deployment ' + CONFIG.deploymentId + ' -d ' + JSON.stringify(description.slice(0, 100))).trim());
  const after = liveVersion();
  if (after === before) fail('the deployment still shows @' + before + '. Nothing was switched.');

  say('5/6 checking the web app answers');
  const post = await checkWebApp();
  if (!post.okay) {
    say('    web app check FAILED: HTTP ' + post.status + ' ' + post.where);
    say('    moving the web app back to @' + before);
    say(run('clasp update-deployment ' + CONFIG.deploymentId + ' -V ' + before + ' -d "rollback after failed check"').trim());
    writeLog({ at: new Date().toISOString(), what: 'bot', description, from: before, to: after, result: 'rolled back', status: post.status });
    fail('the new version did not answer like the bot. The live bot is back on @' + before +
      '. Open Deploy > Manage deployments and check that Who has access says Anyone.');
  }
  say('    HTTP ' + post.status + ', fine');

  say('6/6 recording the publish');
  writeLog({ at: new Date().toISOString(), what: 'bot', description, from: before, to: after, result: 'ok', status: post.status });
  say('DONE: the live bot moved from @' + before + ' to @' + after + '. Undo with: node tools/publish.js rollback ' + before);
}

async function rollback(versionArg) {
  checkAccount();
  const current = liveVersion();
  let target = Number(versionArg);
  if (!target) {
    const last = lastLogEntry();
    if (!last || !last.from) fail('no earlier publish is recorded. Give the version: node tools/publish.js rollback N');
    target = last.from;
  }
  if (target === current) fail('the live bot already runs @' + current + '.');
  say('moving the web app from @' + current + ' to @' + target);
  say(run('clasp update-deployment ' + CONFIG.deploymentId + ' -V ' + target + ' -d "rollback"').trim());
  const post = await checkWebApp();
  writeLog({ at: new Date().toISOString(), what: 'rollback', from: current, to: target, result: post.okay ? 'ok' : 'check failed', status: post.status });
  say('DONE: live bot on @' + liveVersion() + ', web app check HTTP ' + post.status + (post.okay ? ', fine' : ', NOT fine'));
  say('Note: the code in the editor (HEAD) is still the newest upload. The web app runs the version above.');
}

function publishApp() {
  const project = CONFIG.firebaseProject;
  if (!project) fail('firebaseProject is missing in tools/publish.config.json.');
  say('1/3 checking the Firebase sign-in and the Hosting site');
  const sites = run('firebase hosting:sites:list --project ' + project, ROOT);
  if (!/web\.app/.test(sites)) fail('project ' + project + ' has no Hosting site yet. Run once: firebase hosting:sites:create ' + project + ' --project ' + project);
  say('2/3 building the app');
  say(run('node tools/build_app.js', ROOT).trim());
  say('3/3 deploying to Firebase Hosting');
  const out = run('firebase deploy --only hosting --project ' + project, ROOT);
  say(out.trim().split(/\r?\n/).slice(-4).join('\n'));
  writeLog({ at: new Date().toISOString(), what: 'app', project, result: /Deploy complete/.test(out) ? 'ok' : 'check output' });
}

async function status() {
  say('clasp signed in as: ' + (signedInAccount() || 'nobody') + ' (must be ' + CONFIG.account + ')');
  say('live web app version: @' + liveVersion());
  const c = await checkWebApp();
  say('web app check: HTTP ' + c.status + (c.okay ? ', fine' : ', NOT fine ' + c.where));
  say('Yangon time: ' + yangonNow().label + (inJobWindow() ? ' (inside a scheduled-job window)' : ''));
}

(async function main() {
  const args = process.argv.slice(2);
  const anyTime = args.indexOf('--any-time') >= 0;
  const rest = args.filter(a => a !== '--any-time');
  try {
    if (rest[0] === 'bot') return await publishBot(rest.slice(1).join(' '), anyTime);
    if (rest[0] === 'rollback') return await rollback(rest[1]);
    if (rest[0] === 'app') return publishApp();
    if (rest[0] === 'status') return await status();
    say('usage: node tools/publish.js bot "what changed" | rollback [N] | app | status');
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || String(err)).toString().trim();
    fail(detail.split(/\r?\n/).slice(-6).join('\n'));
  }
})();
