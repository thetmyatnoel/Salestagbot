/**
 * gas_main.js — web app entry point, ports wiring, the script lock, triggers and one-time helpers.
 *
 * doPost has two branches that never share a code path: ?api=… is the phone app's sync API
 * (gas_sync.js, JSON via ContentService); everything else is the Telegram webhook (HtmlService ok()).
 *
 * gasLocked() below is the ONE holder of the script lock: every function that needs it goes through it
 * and nothing else in the project calls the lock service. onEdit() is the simple trigger that keeps the
 * Lists tab and the Dashboard in step when the family edits the Lists tab by hand.
 *
 * Script Properties (Project Settings > Script properties):
 *   BOT_TOKEN        from @BotFather
 *   GEMINI_KEY       from Google AI Studio (created from a supported country)
 *   GEMINI_MODEL     e.g. gemini-2.5-flash-lite
 *   WEBHOOK_SECRET   any long random string (registerWebhook makes one if missing)
 *   WEBAPP_URL       the /exec URL from Deploy > Web app
 *   GROUP_CHAT_ID    the family group's chat id (see Errors tab after adding the bot to the group)
 *   SHEET_ID         only for a standalone project (created at script.google.com/home): the spreadsheet id
 */
function doPost(e) {
  try {
    try {
      // The app's sync API: ?api=ping|enroll|sync|bootstrap|ai|photo|report|devices. JSON through
      // ContentService (gas_sync.js); the device token is checked inside, never the webhook secret.
      if (e && e.parameter && e.parameter.api) return gasSyncHandle(e.parameter.api, e);
      var secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
      if (secret && (!e.parameter || e.parameter.token !== secret)) {
        try {
          gasStore.logError('webhook_token', 'A request arrived without the right token. If this is your bot, run registerWebhook again so Telegram uses the current secret.', '', '');
        } catch (ignore) {}
        return ok();
      }
      var update = JSON.parse(e.postData.contents);
      if (update && update.probe) return ok();   // probeWebhookResponse() only wants the status code
      // Transport B: a staff member shares the app's outbox as a .json document when Google is
      // unreachable from the shop but Telegram is not. Same apply path as api=sync (gas_sync.js).
      if (gasSyncTelegramDocument(update)) return ok();
      processUpdate(update, buildPorts());
    } catch (err) {
      try { gasStore.logError('doPost', err, '', e && e.postData ? String(e.postData.contents).slice(0, 2000) : ''); } catch (ignore) {}
    }
    return ok();   // always 200, or Telegram re-sends the same update for 24 hours
  } finally {
    // Both branches: an option added to the Lists tab during this request (gasStore.addListOption) only
    // raised a flag. The Dashboard is rewritten here, once, after the bot's reply went out and after the
    // batch lock was released. Does nothing, and touches no service, on every other request.
    gasDashboardRefresh();
  }
}

function doGet() { return HtmlService.createHtmlOutput('POS bot is running.'); }

/* ------------------------------ the script lock ------------------------------ */

/**
 * The one re-entrant script lock. Apps Script's script lock is not counted: a second waitLock on a lock this
 * execution already holds does nothing, and the FIRST releaseLock frees it. A store method that took and
 * released the lock itself while running inside ports.lock.run or sp.lock.run (addListOption or addMeasurement
 * inside a phone's push batch) would therefore free the batch lock half way, and the ledger rows after it
 * would be numbered and appended unprotected. So every holder goes through this function, and a call made
 * while the lock is already held just runs: buildPorts().lock.run, gasSyncServerPorts().lock.run,
 * gasDedupe.remember, gasStore.addCustomer, nextOrderNo, addMeasurement, addListOption, addDesign,
 * ensureListsTab, gasDashboardRefresh and onEdit. Nothing else may call the lock service, and the line below
 * is its only use. Only waitLock and releaseLock are used (poc/run_sync.js S18 stubs exactly these two).
 */
var GAS_LOCK_DEPTH = 0;
function gasLocked(fn, waitMs) {
  if (GAS_LOCK_DEPTH > 0) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(waitMs || 15000);
  GAS_LOCK_DEPTH = 1;
  try { return fn(); } finally { GAS_LOCK_DEPTH = 0; lock.releaseLock(); }
}

/* ------------------------------ the Dashboard after a list change ------------------------------ */

// Set by gasStore.addListOption (gas_store.js) when the Lists tab changed during this execution.
var GAS_DASH_DIRTY = false;

/**
 * Rewrites the Dashboard once when a list changed during this execution (its category and account blocks
 * are built from the Lists tab). doPost calls it in a finally on both branches, so the ➕ reply never waits
 * for it and a phone's batch never holds the lock for it. With the flag clear it returns before touching
 * any service. A failure goes to the Errors tab and never reaches the caller.
 */
function gasDashboardRefresh() {
  if (!GAS_DASH_DIRTY) return;
  GAS_DASH_DIRTY = false;
  try {
    gasLocked(function () {
      gasInvalidate();
      var dash = gasSpreadsheet().getSheetByName('Dashboard');
      if (dash) writeDashboard(dash);
    });
  } catch (err) {
    try { gasStore.logError('dashboard', err, '', ''); } catch (ignore) {}
  }
}

/**
 * Simple trigger: runs on every cell the family edits by hand, in any tab (it runs because this project is
 * bound to the Sheet; in a standalone copy nothing fires and setupSheet() stays the way to refresh). Edits
 * made by the script itself never fire it, and deleting a row does not either. The first statement leaves
 * before any spreadsheet read unless the edit was in the Lists tab. There: a row the family typed gets its
 * Active box ticked (a blank Active already counts as active, so the box shows what the code does; a box
 * that was unticked is never touched), and the Dashboard is rewritten so its category and account rows
 * follow the list. Under the lock, from a fresh read, so two quick edits end with the newest picture.
 */
function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== 'Lists') return;
  try {
    gasLocked(function () {
      gasInvalidate();
      gasListsFillActive(e.range.getSheet());
      var dash = gasSpreadsheet().getSheetByName('Dashboard');
      if (dash) writeDashboard(dash);
    });
  } catch (err) {
    try { gasStore.logError('onEdit', err, '', ''); } catch (ignore) {}
  }
}

/**
 * The webhook reply. HtmlService, not ContentService: ContentService answers every
 * request with an HTTP 302 redirect to script.googleusercontent.com before the 200
 * body, and Telegram's webhook client counts only 200-299 as success and never follows
 * redirects. With a 302 Telegram re-sends the same update every minute or two for a
 * day and holds that chat's newer messages behind it. HtmlService output is served
 * from the /exec URL itself with 200. Verify with probeWebhookResponse().
 */
function ok() { return HtmlService.createHtmlOutput('ok'); }

/**
 * Shows the HTTP status Telegram sees when it posts to the web app. Run from the
 * editor after every deployment: it must print 200. A 302 means Telegram will retry.
 */
function probeWebhookResponse() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('WEBAPP_URL');
  if (!url) throw new Error('Set Script Property WEBAPP_URL first');
  var res = UrlFetchApp.fetch(url + '?token=' + (p.getProperty('WEBHOOK_SECRET') || ''), {
    method: 'post', contentType: 'application/json', payload: '{"probe":1}', followRedirects: false, muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  Logger.log('HTTP ' + code + (code >= 200 && code < 300 ? ' : good, Telegram will accept this.' : ' : bad, Telegram will keep retrying. Expected 200.'));
}

function buildPorts() {
  loadShopRegistry({ store: gasStore });
  return {
    store: gasStore, chat: gasChat, ai: gasAi, pdf: gasPdf,
    cache: {
      get: function (k) { return CacheService.getScriptCache().get(k); },
      put: function (k, v, ttl) { CacheService.getScriptCache().put(k, v, Math.min(ttl || 600, 21600)); },
      remove: function (k) { CacheService.getScriptCache().remove(k); }
    },
    lock: { run: function (fn) { return gasLocked(fn, 15000); } },
    clock: { now: function () { return new Date(); } },
    uuid: function () { return Utilities.getUuid(); },
    dedupe: gasDedupe,
    // The app's enrollment and device buttons in the bot (📲, /devices, DV|): gas_sync.js, optional for the core.
    sync: typeof gasSyncBotPort === 'function' ? gasSyncBotPort() : null
  };
}

/**
 * Durable memory of the last 400 processed Telegram update ids, in a Script Property.
 * Outlives the 6-hour cache, so a re-delivery a day later is still ignored.
 */
var gasDedupe = {
  _load: function () {
    try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PROCESSED_UPDATES') || '[]'); } catch (e) { return []; }
  },
  seen: function (id) { return gasDedupe._load().indexOf(String(id)) >= 0; },
  remember: function (id) {
    gasLocked(function () {
      var list = gasDedupe._load();
      if (list.indexOf(String(id)) < 0) {
        list.push(String(id));
        if (list.length > 400) list = list.slice(list.length - 400);
        PropertiesService.getScriptProperties().setProperty('PROCESSED_UPDATES', JSON.stringify(list));
      }
    }, 5000);
  }
};

/* ------------------------- run these once from the editor ------------------------- */

/** After the first deployment: point Telegram at the web app. Re-run if the URL ever changes. */
function registerWebhook() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBAPP_URL');
  if (!url) throw new Error('Set Script Property WEBAPP_URL to the /exec URL first');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('WEBHOOK_SECRET', secret);
  }
  Logger.log(tg('setWebhook', {
    url: url + '?token=' + secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true
  }));
  Logger.log(tg('getWebhookInfo', {}));
}

/** Shows what Telegram thinks of the webhook (last_error_message is the useful field). */
function webhookStatus() {
  Logger.log(tg('getMe', {}));
  Logger.log(tg('getWebhookInfo', {}));
}

/** Daily summary at the configured hour (Yangon time), monthly PDF on the 1st, weekly backup. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (['sendDailySummary', 'weeklyBackup', 'sendMonthlyReport'].indexOf(tr.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(tr);
  });
  var hour = Number(gasStore.getSetting('summary_hour', 21));
  ScriptApp.newTrigger('sendDailySummary').timeBased().everyDays(1).atHour(hour).create();
  ScriptApp.newTrigger('sendMonthlyReport').timeBased().onMonthDay(1).atHour(8).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(22).create();
  Logger.log('Triggers installed: daily summary at ' + hour + ':00, monthly PDF on the 1st at 08:00, weekly backup Sunday 22:00 (Asia/Yangon)');
}

/* ------------------------------ trigger handlers ------------------------------ */

function groupChatId() {
  return PropertiesService.getScriptProperties().getProperty('GROUP_CHAT_ID') || gasStore.getSetting('group_chat_id', '');
}

/** The stale-phone line of plan 14.2 under the summary (gas_sync.js; nothing when no phone is enrolled). */
function summaryWithSyncLines(text) {
  if (typeof gasSyncSummaryLines !== 'function') return text;
  try {
    var lines = gasSyncSummaryLines(new Date());
    if (lines.length) text += '\n' + lines.join('\n');
  } catch (err) {
    try { gasStore.logError('sync_summary', err, '', ''); } catch (ignore) {}
  }
  return text;
}

/**
 * The 21:00 summary. The Credits tab is a snapshot rewritten after credit-related writes, so a dated credit whose DueDay
 * passed overnight would still read Overdue FALSE there: the views are refreshed first (the rebuildViews body), and the
 * laptop and the Dashboard's Overdue cell agree with the summary at least every evening. A failure of that refresh is
 * logged and the summary still goes out.
 */
function sendDailySummary() {
  var ports = buildPorts();
  try {
    gasStore.refreshViews(openCredits(ports, null), depositsHeldList(ports), customerSummaries(ports));
  } catch (err) {
    try { gasStore.logError('summary_refresh', err, '', ''); } catch (ignore) {}
  }
  var chatId = groupChatId();
  var text = summaryWithSyncLines(buildDailySummary(ports, dayKey(new Date())));
  if (!chatId) {
    gasStore.logError('sendDailySummary', 'GROUP_CHAT_ID not set. Summary was:\n' + text, '', '');
    return;
  }
  gasChat.sendMessage(chatId, text);
}

/** Last month's report as a PDF to every owner and to the family group, on the 1st. */
function sendMonthlyReport() {
  var ports = buildPorts();
  var report = buildReport(ports, 'last', { shop: null, now: new Date() });
  var blob = gasPdf.make(report);
  var caption = t(ports, 'rep_monthly_caption') + '\n' + report.title;
  var targets = gasStore.listStaff().filter(function (s) { return s.role === 'owner'; }).map(function (s) { return s.id; });
  var group = groupChatId();
  if (group) targets.push(group);
  targets.forEach(function (chatId) {
    try { gasChat.sendDocument(chatId, blob, caption); } catch (err) { gasStore.logError('sendMonthlyReport', err, '', chatId); }
  });
}

function weeklyBackup() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('BACKUP_FOLDER_ID'), folder;
  if (folderId) folder = DriveApp.getFolderById(folderId);
  else {
    folder = DriveApp.createFolder('POS Backups');
    props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  }
  var ss = gasSpreadsheet();
  DriveApp.getFileById(ss.getId()).makeCopy('POS backup ' + Utilities.formatDate(new Date(), 'Asia/Yangon', 'yyyy-MM-dd'), folder);
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(8).forEach(function (f) { f.setTrashed(true); });
}

/** Manual check without Telegram: prints today's summary to the log. */
function previewSummary() {
  Logger.log(summaryWithSyncLines(buildDailySummary(buildPorts(), dayKey(new Date()))));
}

/** Rebuild the Credits and Deposits tabs and the Customers summary columns F:K from the ledger. */
function rebuildViews() {
  var ports = buildPorts();
  gasStore.refreshViews(openCredits(ports, null), depositsHeldList(ports), customerSummaries(ports));
  Logger.log('Credits, Deposits and Customers F:K rebuilt.');
}
