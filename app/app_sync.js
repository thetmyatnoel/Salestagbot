/**
 * app/app_sync.js — the phone's sync client (SPEC-offline-first.md sections 5 to 7).
 *
 * createAppSync(phone, opts) -> sync.
 *   enroll(code)        typed one-time code -> device token (api=enroll), then bootstrap with paging and
 *                       a progress callback
 *   syncNow(reason)     push the outbox then pull the delta in ONE request (api=sync), apply the results
 *                       through core_sync's client helpers, learn the clock offset, repair days whose
 *                       checksums differ; one call in flight at a time, the next waits
 *   scheduleSync(ms)    debounced sync after each commit; also on launch, on `online` and when the app
 *                       returns to the foreground (attach())
 *   flushAiJobs()       queued voice/photo/notebook jobs, one api=ai call each, replayed through handleIntent
 *                       (a done photo or pic answer's itemRev is taken when the phone's Rev is its itemRevWas)
 *   exportDocument()    Transport B: the outbox as a .json document for the Web Share API or a download
 *   chipState()         the header chip: synced / n waiting / not sent for h hours / red after 2 days
 * Transport: fetch POST text/plain to WEBAPP_URL + '?api=...' following the 302 to
 * script.googleusercontent.com (appFetchTransport); the tests and the dev page pass the fake server's
 * handle() instead. Backoff 5 s .. 10 min on failures. DRAIN shows a notice; REVOKED wipes the phone.
 * Logic adapted from poc/sim_phone.js (same project). Plain ES5: var and function only.
 */
var APP_SYNC_BACKOFF_MS = [5000, 15000, 60000, 300000, 600000];
var APP_SYNC_DEBOUNCE_MS = 1500;
var APP_SYNC_TIMEOUT_MS = 60000;
var APP_SYNC_STALE_HOURS = 1;            // chip turns amber: oldest pending entry older than this
var APP_SYNC_EXPORT_HOURS = 4;           // Transport B is suggested after this
var APP_SYNC_RED_DAYS = 2;               // chip turns red
// Round 6, revision 3 (spec 13.7.2, 13.11): a drawing's picture (sketch) and a new piece's photo without AI (pic) are not
// AI jobs. Their "the session / the item is not on the server yet" answer (no_session, no_item) is tried again after
// APP_SKETCH_RETRY_SEC, at most APP_SKETCH_TRIES times.
var APP_SKETCH_TRIES = 5;
var APP_SKETCH_RETRY_SEC = 300;
var APP_AI_JOB_KINDS = { voice: true, text: true, photo: true, notebook: true };

/** fetch() transport: one POST per call, JSON in, JSON out, redirects followed. Never throws synchronously. */
function appFetchTransport(apiUrl, fetchImpl) {
  var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  return function (api, body) {
    if (!apiUrl) return Promise.resolve({ ok: false, error: 'config', message: 'no API URL' });
    if (!f) return Promise.resolve({ ok: false, error: 'network', message: 'fetch unavailable', transportFailure: true });
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, APP_SYNC_TIMEOUT_MS) : null;
    var url = apiUrl + (apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'api=' + encodeURIComponent(api);
    var init = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', credentials: 'omit', cache: 'no-store' };
    if (controller) init.signal = controller.signal;
    return f(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) return { ok: false, error: 'http_' + res.status, message: 'HTTP ' + res.status, transportFailure: true };
      return res.text().then(function (text) {
        try { return JSON.parse(text); } catch (err) { return { ok: false, error: 'bad_response', message: text.slice(0, 120), transportFailure: true }; }
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : 'network', message: err && err.message ? err.message : String(err), transportFailure: true };
    });
  };
}

/**
 * The words for a pending list entry on the sync screen: the label it carries, else (an account-number entry
 * {list, key, detail, detailWas} has none) the option's label from the local lists or the account's label; the
 * account number follows when the entry sets one.
 */
function appPendingListLabel(ports, rec) {
  var label = rec.label ? String(rec.label) : '';
  if (!label) {
    var o = rec.list && rec.key ? listOption(ports, rec.list, rec.key) : null;
    label = o && o.label ? o.label : (rec.list === 'pay_method' && rec.key ? methodLabel(ports, rec.key) : String(rec.key || ''));
  }
  return rec.detail ? label + ' · ' + rec.detail : label;
}

function createAppSync(phone, opts) {
  opts = opts || {};
  var store = phone.store;
  var timers = opts.timers || {
    setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
    clearTimeout: function (h) { clearTimeout(h); }
  };
  var transport = opts.transport || phone.transport || (opts.apiUrl ? appFetchTransport(opts.apiUrl, opts.fetchImpl) : null);
  var sync = {
    phone: phone, inFlight: null, wanted: false, timer: null, failures: 0, state: 'idle', lastError: null, lastSummary: null,
    pendingBatch: null, drainShown: false, clockWarnedMs: null, progress: null, listeners: [], detachFns: [],
    appVersion: opts.appVersion !== undefined ? opts.appVersion : (typeof SYNC !== 'undefined' ? SYNC.VERSION : 1),
    label: opts.label || phone.name, platform: opts.platform || phone.platform,
    online: opts.online || function () { return phone.online; },
    hasTransport: !!transport
  };
  function copy(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
  function noop() {}
  function emit(name, payload) { phone.emit(name, payload); }
  function tt(key, vars) { return t(phone.ports, key, vars); }
  function botSay(text) { return phone.botSay(text); }

  /** One request. Network trouble (offline, thrown transport, lost reply) comes back as {transportFailure:true}. */
  function call(api, body) {
    if (!transport) return Promise.resolve({ ok: false, error: 'config', message: 'no transport' });
    if (!sync.online()) return Promise.resolve({ ok: false, error: 'offline', transportFailure: true });
    return new Promise(function (resolve) {
      var done = false;
      function finish(res) { if (done) return; done = true; resolve(res); }
      try {
        Promise.resolve(transport(api, body)).then(function (res) {
          if (!res) return finish({ ok: false, error: 'lost', transportFailure: true });
          finish(res);
        }, function (err) {
          finish({ ok: false, error: 'network', message: err && err.message ? err.message : String(err), transportFailure: true });
        });
      } catch (err) {
        finish({ ok: false, error: 'network', message: err && err.message ? err.message : String(err), transportFailure: true });
      }
    });
  }
  sync.call = call;
  function authBody(extra) {
    var b = { device: store.meta.deviceId, token: store.meta.token, appVersion: sync.appVersion, clientTime: phone.wallClock().toISOString() };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) b[k] = extra[k];
    return b;
  }
  /** offset = serverTime - clientTime, persisted; the core's clock applies it. */
  sync.learnOffset = function (serverTime, sentClientTime) {
    if (!serverTime || !sentClientTime) return;
    var offset = syncClockOffset(serverTime, sentClientTime);
    store.setMeta({ offsetMs: offset });
    if (Math.abs(offset) > SYNC.SKEW_WARN_SEC * 1000 && sync.clockWarnedMs !== offset) {
      sync.clockWarnedMs = offset;
      botSay(tt('app_clock', { min: myDigits(Math.round(Math.abs(offset) / 60000)) }));
    }
  };
  function noteFailure(error, message) {
    sync.lastError = { error: error, message: message || '', at: phone.now().toISOString() };
    store.setMeta({ lastSyncTry: phone.now().toISOString(), lastSyncError: error });
  }
  function noteSuccess() {
    sync.lastError = null;
    sync.failures = 0;
    store.setMeta({ lastSyncOk: phone.now().toISOString(), lastSyncTry: phone.now().toISOString(), lastSyncError: null });
  }
  /** Burmese line for the sync screen's "problem" box. */
  sync.errorText = function (err) {
    var e = err === undefined ? (sync.lastError && sync.lastError.error) : err;
    if (!e) return '';
    if (e === 'config') return tt('ui_err_config');
    if (e === 'auth') return tt('ui_err_auth');
    if (e === 'version') return tt('ui_err_version');
    if (e === 'busy') return tt('ui_err_busy');
    if (e === 'revoked') return tt('app_revoked');
    if (e === 'drain') return tt('app_drain');
    if (e === 'server' || e === 'bad_request' || /^http_5/.test(e)) return tt('ui_err_server');
    return tt('ui_err_network');
  };

  /* ---------- enrollment and bootstrap ---------- */
  sync.enroll = function (code, label) {
    var sent = phone.wallClock().toISOString();
    var body = { code: syncNormalizeCode(code), platform: sync.platform, label: label || sync.label, appVersion: sync.appVersion, clientTime: sent };
    return call('enroll', body).then(function (res) {
      if (!res.ok) { noteFailure(res.error, res.message); return phone.commit('enroll').then(function () { return res; }); }
      var d = res.device;
      store.setMeta({
        deviceId: d.id, token: d.token, staff: d.staff, scope: d.scope || [], receiptLetter: d.receiptLetter || '',
        label: d.label || label || sync.label, platform: sync.platform, enrolledAt: phone.now().toISOString(),
        owners: (d.owners || []).map(function (id) { return { id: String(id), name: 'owner', shop: 'S1', role: 'owner' }; })
      });
      sync.learnOffset(res.serverTime, sent);
      return phone.commit('enroll').then(function () {
        emit('enrolled', res);
        if (!res.bootstrap) return res;
        return sync.bootstrap(sync.progress).then(function (b) { res.bootstrapResult = b; return res; });
      });
    });
  };

  /** Everything from the server, paged; synced rows are replaced, unsynced local rows and the outbox stay. */
  sync.bootstrap = function (onProgress) {
    if (!store.meta.deviceId) return Promise.resolve({ ok: false, error: 'not_enrolled' });
    store.local.resetSynced();
    var cursorSeq = 0, pages = 0, rows = 0, total = 0;
    function report(done) {
      var p = { pages: pages, rows: rows, total: total, done: !!done };
      if (onProgress) { try { onProgress(p); } catch (ignore) {} }
      emit('progress', p);
    }
    function page(sent) {
      return call('bootstrap', authBody({ cursorSeq: cursorSeq })).then(function (res) {
        if (!res.ok) {
          noteFailure(res.error, res.message);
          return phone.commit('bootstrap').then(function () { return res; });
        }
        if (res.items) {
          res.items.forEach(store.local.upsertItem);
          (res.customers || []).forEach(store.local.upsertCustomer);
          store.local.setSettings(res.settings || {});
          store.local.setMessages(res.messages || {});
          var fields = {};
          if (res.staff) fields.staff = res.staff;
          fields.owners = (res.owners || []).map(function (o) { return { id: String(o.id), name: o.name || 'owner', shop: o.shop || 'S1', role: 'owner' }; });
          if (res.scope) fields.scope = res.scope;
          if (res.receiptLetter) fields.receiptLetter = res.receiptLetter;
          var cursor = copy(store.meta.cursor);
          cursor.masterRev = res.masterRev || 0;
          cursor.settingsHash = res.settingsHash || '';
          cursor.messagesHash = res.messagesHash || '';
          fields.cursor = cursor;
          store.setMeta(fields);
        }
        (res.ledger || []).forEach(function (row) {
          if (!store.local.hasRow(row.txId)) store.local.appendSynced(row);
          else store.local.markSynced(row.txId, row.seq, row.receivedAt, row.deviceId);
        });
        rows += (res.ledger || []).length;
        total = res.total || total;
        cursorSeq = res.nextCursorSeq;
        pages++;
        report(false);
        return phone.commit('bootstrap-page').then(function () {
          if (res.more) return page(phone.wallClock().toISOString());
          var cursor = copy(store.meta.cursor);
          cursor.ledgerSeq = res.asOfSeq || cursorSeq;
          store.setMeta({ cursor: cursor, lastFullMastersDay: dayKey(phone.now()), lastBootstrap: phone.now().toISOString() });
          sync.learnOffset(res.serverTime, sent);
          noteSuccess();
          return phone.commit('bootstrap').then(function () {
            report(true);
            var out = { ok: true, api: 'bootstrap', pages: pages, rows: rows };
            emit('sync', out);
            // Spec 9.1: one sync right after a successful bootstrap. The measurement sessions are not part of the
            // bootstrap (they come in measAfter pages with a pull) and must be on the phone before the form opens.
            sync.scheduleSync(0, 'bootstrap');
            return out;
          });
        });
      });
    }
    return page(phone.wallClock().toISOString());
  };

  /* ---------- the sync round trip ---------- */
  function showQuarantine(q) {
    if (q.reason === SYNC.REASON.ALREADY_REVERSED) botSay(tt('app_already_undone'));
    else botSay(tt('app_rejected', { reason: syncReasonText(phone.ports, q.reason) }));
  }
  function showFlags(f) {
    var detail = f.flags.map(function (fl) { return syncFlagText(phone.ports, fl); }).join(' · ');
    botSay(tt('app_flagged', { detail: detail }));
  }
  function handleNotOk(res) {
    if (res.error === 'revoked') {
      return store.wipe().then(function () { sync.state = 'revoked'; emit('revoked', res); emit('change', { kind: 'revoked', durable: true }); });
    }
    if (res.error === 'drain') botSay(tt('app_drain'));
    else if (res.error !== 'auth' && res.error !== 'version' && res.error !== 'config') botSay(tt('app_sync_fail'));
    noteFailure(res.error, res.message);
    return phone.commit('sync-error');
  }

  function runSync(reason) {
    if (!store.meta.deviceId) return Promise.resolve({ ok: false, error: 'not_enrolled' });
    // A batch whose reply was lost is resent as it was (same batchId); an empty one is never kept, so rows
    // committed after a failed empty sync are planned afresh instead of riding on a stale empty plan.
    var plan = sync.pendingBatch && sync.pendingBatch.entries.length ? sync.pendingBatch : syncPlanPush(store.outbox, store.pushMax());
    if (!plan.batchId) plan.batchId = appUuid();
    sync.pendingBatch = plan;
    var today = dayKey(phone.now()), fullMasters = store.meta.lastFullMastersDay !== today;
    var sent = phone.wallClock().toISOString();
    var pull = copy(store.meta.cursor);
    pull.fullMasters = fullMasters;
    var summary = { ok: false, at: sent, reason: reason, api: 'sync', pushed: plan.rows, entries: plan.entries.length, acked: 0, quarantined: [], flagged: [], pulled: 0, pages: 1, repaired: [], drain: false };
    return call('sync', authBody({ pendingCount: store.pendingRows(), push: plan.entries.length ? { batchId: plan.batchId, entries: plan.entries } : null, pull: pull })).then(function (res) {
      if (res.transportFailure) {
        summary.error = res.error;
        noteFailure(res.error, res.message);
        return phone.commit('sync-fail').then(function () { return summary; });
      }
      sync.pendingBatch = null;
      if (!res.ok) {
        summary.error = res.error;
        summary.message = res.message;
        return handleNotOk(res).then(function () { return summary; });
      }
      sync.learnOffset(res.serverTime, sent);
      if (res.push) {
        var ar = syncApplyPushResults(store.local, plan.entries, res.push.results, res.serverTime, store.meta.deviceId);
        summary.acked = ar.acked.length;
        summary.quarantined = ar.quarantined;
        summary.flagged = ar.flagged;
        ar.quarantined.forEach(showQuarantine);
        ar.flagged.forEach(showFlags);
      }
      summary.drain = !!res.drain;
      if (res.drain && !sync.drainShown) { sync.drainShown = true; botSay(tt('app_drain')); }
      if (!res.drain) sync.drainShown = false;
      var applied = null;
      function applyPages(delta) {
        if (!delta) return Promise.resolve();
        applied = syncApplyDelta(store.local, delta);
        summary.pulled += applied.added;
        if (!delta.more) return Promise.resolve();
        return phone.commit('sync-page').then(function () {
          var sent2 = phone.wallClock().toISOString();
          return call('sync', authBody({ pendingCount: store.pendingRows(), push: null, pull: copy(store.meta.cursor) })).then(function (res2) {
            if (!res2.ok) { summary.incomplete = true; return; }
            sync.learnOffset(res2.serverTime, sent2);
            summary.pages++;
            return applyPages(res2.pull);
          });
        });
      }
      return applyPages(res.pull).then(function () {
        if (!applied || !applied.repairDays.length) return;
        var rp = copy(store.meta.cursor);
        rp.repairDays = applied.repairDays;
        return call('sync', authBody({ pendingCount: store.pendingRows(), push: null, pull: rp })).then(function (rres) {
          if (!rres.ok || !rres.pull) return;
          var rapplied = syncApplyDelta(store.local, rres.pull);
          summary.repaired = rapplied.repaired;
          rapplied.repaired.forEach(function (day) {
            store.ports.logError('checksum_repair', 'day ' + day + ' re-pulled from the server (hand edit or lost row)', '', '');
            botSay(tt('app_repaired', { day: fmtDayShortMy(day) }));
          });
        });
      }).then(function () {
        if (fullMasters && res.pull) store.setMeta({ lastFullMastersDay: today });
        // Rows left behind (a full page, a resent batch, a sale made while this request flew) go out next.
        if (summary.acked > 0 && store.outbox.length) sync.wanted = true;
        summary.ok = true;
        noteSuccess();
        return phone.commit('sync').then(function () { return summary; });
      });
    });
  }

  /** Push then pull; one in flight, a second request while busy runs once more afterwards. */
  sync.syncNow = function (reason) {
    if (sync.inFlight) { sync.wanted = true; return sync.inFlight; }
    if (sync.timer) { timers.clearTimeout(sync.timer); sync.timer = null; }
    sync.state = 'sending';
    emit('syncstate', sync.state);
    var p = runSync(reason || 'manual').then(function (summary) {
      sync.lastSummary = summary;
      if (summary.ok) { sync.state = 'ok'; sync.failures = 0; }
      else if (summary.error === 'not_enrolled') sync.state = 'idle';
      else {
        sync.state = 'error';
        if (summary.error && summary.error !== 'revoked' && summary.error !== 'auth' && summary.error !== 'version' && summary.error !== 'config') {
          sync.failures++;
          if (sync.online()) sync.scheduleSync(APP_SYNC_BACKOFF_MS[Math.min(sync.failures, APP_SYNC_BACKOFF_MS.length) - 1]);
        }
      }
      return summary;
    }, function (err) {
      sync.state = 'error';
      noteFailure('internal', err && err.message ? err.message : String(err));
      try { store.ports.logError('sync', err, '', reason || ''); } catch (ignore) {}
      return phone.commit('sync-crash').then(function () { return { ok: false, error: 'internal', message: err && err.message }; });
    }).then(function (summary) {
      sync.inFlight = null;
      emit('sync', summary);
      emit('syncstate', sync.state);
      if (summary.ok) {
        return sync.flushAiJobs().then(function () { return summary; }, function () { return summary; });
      }
      return summary;
    }).then(function (summary) {
      if (sync.wanted) { sync.wanted = false; return sync.syncNow('again'); }
      return summary;
    });
    sync.inFlight = p;
    return p;
  };
  sync.scheduleSync = function (ms, reason) {
    if (sync.timer) timers.clearTimeout(sync.timer);
    sync.timer = timers.setTimeout(function () {
      sync.timer = null;
      sync.syncNow(reason || 'scheduled');
    }, ms === undefined ? APP_SYNC_DEBOUNCE_MS : ms);
  };

  /* ---------- AI jobs: queued recordings and photos, replayed through handleIntent ---------- */
  function jobPayload(job) {
    // jobId: unique per queued job (app_ports.js queueAi); a media record queued by an older build has only its id.
    var base = { id: job.jobId || job.id, kind: job.kind, mime: job.mime || '', text: job.text || '', ctx: job.ctx || {}, createdAt: job.createdAt, itemId: job.itemId || '', sim: job.sim || null };
    if (job.entryId) base.entryId = job.entryId;   // a drawing's picture: the measurement entry whose session it belongs to
    if (job.blob && typeof appBlobToBase64 === 'function') {
      return appBlobToBase64(job.blob).then(function (b64) { base.data = b64; return base; });
    }
    base.data = job.data || '';
    return Promise.resolve(base);
  }
  /** A line under the latest card: before it when that card has buttons (so it stays the card the home shows), else last. */
  function sayUnderCard(text) {
    var latest = phone.sim.lastBot();
    if (latest && latest.keyboard && latest.keyboard.length) return store.insertChatBefore({ from: 'bot', text: text, keyboard: [], system: true }, latest);
    return botSay(text);
  }
  function replayJob(job, j) {
    // A drawing's picture or a photo uploaded without AI says nothing and leaves the waiting lines of the AI jobs alone.
    if (job.kind === 'sketch' || job.kind === 'pic') return;
    var staff = store.meta.staff, uid = phone.staffId();
    var msg = { chat: { id: /^\d+$/.test(String(uid)) ? Number(uid) : uid, type: 'private' }, from: { id: /^\d+$/.test(String(uid)) ? Number(uid) : uid }, message_id: 0 };
    try {
      if (job.kind === 'voice' || job.kind === 'text') {
        botSay(tt('app_ai_result'));
        handleIntent(j.intent, msg, staff, 'ai-' + job.id, phone.ports, job.kind === 'voice' ? CFG.SOURCE.VOICE : CFG.SOURCE.TEXT, job.ctx || {});
      } else if (job.kind === 'photo') {
        // Round 6 (spec 6.2): the server's rule (aiRenameFields: a placeholder name only, the catch-all category only),
        // so the item entry this rename pushes carries what the server already holds; the line goes under the card (U14).
        // Round 6b: the category is decided against the job's own list (its ctx), as the server decides it.
        var item = job.itemId ? store.ports.getItem(job.itemId) : null, fields = item ? aiRenameFields(item, j.desc, itemCategoryCats(job.ctx, phone.ports, item.shop)) : null;
        if (fields) {
          store.ports.updateItem(job.itemId, fields);
          sayUnderCard(tt('photo_seen', { name: fields.name, category: fields.category || item.category }));
        }
      } else if (job.kind === 'notebook') {
        (j.lines || []).slice(0, CFG.NOTEBOOK_MAX_LINES).forEach(function (line, i) {
          presentNotebookLine(msg.chat.id, uid, line, i + 1, staff, 'ai-' + job.id, phone.ports);
        });
      }
    } catch (err) { store.ports.logError('ai_replay', err, job.id, job.kind); }
    // The ⏳ line that waited for this job is done with.
    store.chat.forEach(function (m) { if (m.pending) { m.pending = false; store.saveChat(m); } });
  }
  /** An outbox entry this job waits for (round 6, M1): a photo or pic job its item's entry, a sketch job its measurement entry. */
  function jobWaits(job) {
    for (var i = 0; i < store.outbox.length; i++) {
      var e = store.outbox[i];
      if ((job.kind === 'photo' || job.kind === 'pic') && job.itemId && e.kind === 'item' && e.id === String(job.itemId)) return true;
      if (job.kind === 'sketch' && job.entryId && e.kind === 'measurement' && e.entryId === job.entryId) return true;
    }
    return false;
  }
  /** An AI job recorded before the owner switched AI off (round 6, review r3 M-12): out of the queue, its data kept. */
  function skipJob(job) {
    store.updateMedia(job.id, { status: 'skipped', lastError: 'ai_off' });
    sync.skipped = true;
  }
  /**
   * A new piece's photo job that meets AI off (the phone's switch or the server's ai_off answer): the photo is the only
   * copy of that piece's picture, so it goes up as a pic job (13.11, review r3 M-1: with AI off the photo still goes up),
   * its jobId kept; it waits for nothing of the AI. Any other AI job is skipped. Returns the job to send, or null.
   */
  function aiOffJob(job) {
    sync.skipped = true;
    if (job.kind === 'photo' && job.itemId) return store.updateMedia(job.id, { kind: 'pic', ctx: {}, lastError: 'ai_off' }) || null;
    skipJob(job);
    return null;
  }
  sync.flushAiJobs = function () {
    if (!store.meta.deviceId) return Promise.resolve([]);
    var jobs = store.queuedMedia(), done = [];
    sync.skipped = false;
    function next(i) {
      if (i >= jobs.length) return Promise.resolve(done);
      var job = jobs[i], ai = !!APP_AI_JOB_KINDS[job.kind];
      if (job.retryAfterUntil && job.retryAfterUntil > phone.now().getTime()) return next(i + 1);
      if (ai && !aiOn(phone.ports)) {
        job = aiOffJob(job);
        if (!job) return next(i + 1);
        ai = false;
      }
      if (jobWaits(job)) return next(i + 1);
      return jobPayload(job).then(function (payload) {
        return call('ai', authBody({ job: payload }));
      }).then(function (res) {
        if (!res.ok) { store.updateMedia(job.id, { lastError: res.error }); return res.transportFailure ? Promise.resolve(done) : next(i + 1); }
        var j = res.job;
        if (j.status === 'quota') { store.updateMedia(job.id, { retryAfterUntil: phone.now().getTime() + (j.retryAfterSec || SYNC.RETRY_AFTER_SEC) * 1000 }); return next(i + 1); }
        if (j.status !== 'done') {
          if (ai && j.error === 'ai_off') {                                      // the server heard of the switch first
            var asPic = aiOffJob(job);
            if (asPic) { jobs[i] = asPic; return next(i); }                      // the same photo again, as a pic job
            return next(i + 1);
          }
          if (!ai) {
            // Not an AI job: no ai_down line. The session or the item is not on the server yet: tried again later.
            var waiting = (job.kind === 'sketch' && j.error === 'no_session') || (job.kind === 'pic' && j.error === 'no_item');
            var tries = (Number(job.tries) || 0) + 1;
            if (waiting && tries < APP_SKETCH_TRIES) store.updateMedia(job.id, { tries: tries, lastError: j.error, retryAfterUntil: phone.now().getTime() + APP_SKETCH_RETRY_SEC * 1000 });
            else store.updateMedia(job.id, { tries: tries, status: 'failed', lastError: j.error || 'failed' });
            return next(i + 1);
          }
          store.updateMedia(job.id, { status: 'failed', lastError: j.error || 'failed' });
          botSay(tt('ai_down'));
          return next(i + 1);
        }
        var fin = { status: 'done', result: j, blob: job.kind === 'voice' ? null : job.blob };
        if (!ai) { fin.blob = null; fin.data = ''; }          // the picture is on the server now
        store.updateMedia(job.id, fin);
        done.push(job);
        // A done photo or pic answer says the item's Rev before (itemRevWas) and after (itemRev) the job's own write: the phone
        // still at the one before, with no item entry of that piece waiting, takes the new one, so its next entry of the piece
        // (the rename below, an undo) carries no stale base (review r6: the false sync_conflict and the owner's ping).
        var own = job.itemId && j.itemRev ? store.ports.getItem(job.itemId) : null;
        if (own && store.local.setItemRev && Number(own.rev || 0) === j.itemRevWas && !jobWaits(job)) store.local.setItemRev(job.itemId, j.itemRev);
        replayJob(job, j);
        return phone.commit('ai').then(function () { return next(i + 1); });
      });
    }
    return next(0).then(function () {
      // Skipped AI jobs wait for nothing any more: their waiting lines go once no AI job is left in the queue.
      if (sync.skipped && !store.queuedMedia().some(function (m) { return !!APP_AI_JOB_KINDS[m.kind]; })) {
        store.chat.forEach(function (m) { if (m.pending) { m.pending = false; store.saveChat(m); } });
      }
      return phone.commit('ai-flush').then(function () { return done; });
    });
  };

  /* ---------- server jobs: PDF to Telegram, item thumbnails ---------- */
  sync.office = function (action, params) {
    return call('office', authBody(syncMerge(params || {}, { action: action })));
  };
  sync.requestReport = function (kind, groupId, inline) {
    if (!store.meta.deviceId) return Promise.resolve({ ok: false, error: 'not_enrolled' });
    return call('report', authBody({ kind: kind, groupId: groupId || null, inline: !!inline }));
  };
  sync.fetchThumbs = function (ids) {
    if (!store.meta.deviceId || !ids.length) return Promise.resolve({ ok: false, error: 'nothing' });
    return call('photo', authBody({ itemIds: ids.slice(0, SYNC.PHOTO_MAX) })).then(function (res) {
      if (!res.ok || !res.thumbs) return res;
      Object.keys(res.thumbs).forEach(function (id) {
        var v = res.thumbs[id];
        if (typeof v === 'string' && v) store.setThumb(id, v.indexOf('data:') === 0 ? v : (/^[A-Za-z0-9+/=]+$/.test(v) ? 'data:image/jpeg;base64,' + v : v));
      });
      return phone.commit('thumbs').then(function () { return res; });
    });
  };

  /* ---------- Transport B: the outbox as a .json document ---------- */
  sync.exportDocument = function () {
    var entries = syncPlanPush(store.outbox, 100000).entries;
    var meta = store.meta, now = phone.now();
    var name = 'salestag-outbox-' + (meta.staff && meta.staff.shop ? meta.staff.shop : 'S') + '-' + (meta.receiptLetter || 'X') + '-' + dayKey(now) + '-' + timeKey(now).replace(':', '') + '.json';
    var text = syncExportDocument({ deviceId: meta.deviceId, staffId: phone.staffId(), label: meta.label, batchId: 'doc-' + appUuid().slice(0, 8) }, entries, phone.wallClock().toISOString());
    return { name: name, text: text, entries: entries.length, rows: syncPlanPush(store.outbox, 100000).rows };
  };
  /** Browser: hand the document to the share sheet (Telegram, Viber) or download it. Resolves to 'shared' | 'downloaded' | 'empty'. */
  sync.shareExport = function () {
    var doc = sync.exportDocument();
    if (!doc.entries) return Promise.resolve('empty');
    var nav = typeof navigator !== 'undefined' ? navigator : null;
    var blob = typeof Blob !== 'undefined' ? new Blob([doc.text], { type: 'application/json' }) : null;
    if (nav && nav.share && blob && typeof File !== 'undefined') {
      var file = new File([blob], doc.name, { type: 'application/json' });
      if (!nav.canShare || nav.canShare({ files: [file] })) {
        return nav.share({ files: [file], title: doc.name }).then(function () { return 'shared'; }, function () { return sync.downloadExport(doc, blob); });
      }
    }
    return Promise.resolve(sync.downloadExport(doc, blob));
  };
  sync.downloadExport = function (doc, blob) {
    if (typeof document === 'undefined' || !blob || typeof URL === 'undefined' || !URL.createObjectURL) return 'unsupported';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 2000);
    return 'downloaded';
  };

  /* ---------- the chip ---------- */
  sync.chipState = function (at) {
    at = at || phone.now();
    var st = store.stats();
    var out = { kind: 'synced', text: tt('ui_sync_synced'), entries: st.entries, pending: st.pending, ageMs: 0, suggestExport: false, offline: !sync.online(), enrolled: st.enrolled };
    if (!st.enrolled) { out.kind = 'never'; out.text = tt('ui_sync_never'); return out; }
    if (sync.inFlight) { out.kind = 'sending'; out.text = tt('ui_sync_sending'); return out; }
    if (!st.entries && !st.aiQueued) return out;
    var oldest = st.oldestPendingAt ? new Date(st.oldestPendingAt).getTime() : at.getTime();
    out.ageMs = Math.max(0, at.getTime() - oldest);
    var hours = out.ageMs / 3600000;
    out.suggestExport = hours >= APP_SYNC_EXPORT_HOURS;
    if (hours >= APP_SYNC_RED_DAYS * 24) { out.kind = 'red'; out.text = tt('ui_sync_stale_days', { d: myDigits(Math.floor(hours / 24)) }); }
    else if (hours >= APP_SYNC_STALE_HOURS) { out.kind = 'stale'; out.text = tt('ui_sync_stale_hours', { h: myDigits(Math.floor(hours)) }); }
    else { out.kind = 'waiting'; out.text = tt('ui_sync_waiting', { n: fmtCount(st.entries + st.aiQueued) }); }
    return out;
  };
  /** Pending entries in words for the sync screen: [{text, kind}]. */
  sync.pendingLines = function (max) {
    var lines = [];
    store.outbox.forEach(function (e) {
      if (e.kind === 'group') {
        var live = liveRows(e.txs);
        var r = live[0] || e.txs[0];
        // Round 6: a basket or a restock of several lines is one line (describeGroup); a one-row group reads as before.
        lines.push({ kind: 'group', text: describeGroup(phone.ports, e.txs) + (r.reversesTxId ? ' (' + txLabel('ADJUST') + ')' : '') + ' · ' + timeKey(new Date(e.at)) });
      } else if (e.kind === 'setting') {
        // The owner's Shops screen or AI switch (revision 3): the shop's name as this phone shows it now, or AI.
        var sm = /^shop_[a-z]+_(S[0-9]+)$/.exec(String(e.key || ''));
        lines.push({ kind: 'setting', text: tt('ui_pending_setting', { label: sm ? shopName(phone.ports, sm[1]) : tt('ui_ai_title') }) });
      } else if (e.kind === 'item') lines.push({ kind: 'item', text: tt('ui_pending_item', { id: e.id }) });
      else if (e.kind === 'customer') lines.push({ kind: 'customer', text: tt('ui_pending_customer', { name: e.rec && e.rec.name }) });
      else if (e.kind === 'notice') lines.push({ kind: 'notice', text: tt('ui_pending_notice') });
      else if (e.kind === 'error') lines.push({ kind: 'error', text: tt('ui_pending_error') });
      else if (e.kind === 'list') lines.push({ kind: 'list', text: tt('ui_pending_list', { label: appPendingListLabel(phone.ports, e.rec || {}) }) });
      else if (e.kind === 'measurement') lines.push({ kind: 'measurement', text: tt('ui_pending_meas', { customer: customerName(phone.ports, (e.rec || {}).customerId) }) });
    });
    // Revision 3 (review r3, m-5): the AI jobs under ui_pending_ai; a drawing's picture and a photo without AI apart.
    var queued = store.queuedMedia(), ai = queued.filter(function (m) { return !!APP_AI_JOB_KINDS[m.kind]; }).length, pics = queued.length - ai;
    if (ai) lines.push({ kind: 'ai', text: tt('ui_pending_ai', { n: fmtCount(ai) }) });
    if (pics) lines.push({ kind: 'pics', text: tt('ui_pending_pics', { n: fmtCount(pics) }) });
    if (max && lines.length > max) {
      var rest = lines.length - max;
      lines = lines.slice(0, max);
      lines.push({ kind: 'more', text: tt('ui_sync_pending_more', { n: fmtCount(rest) }) });
    }
    return lines;
  };

  /* ---------- triggers: launch, after each commit, online, foreground ---------- */
  sync.start = function () {
    if (store.meta.deviceId) sync.syncNow('launch');
  };
  sync.attach = function (win, doc) {
    var onChange = phone.on('change', function (evt) {
      if (!evt || evt.kind !== 'update') return;
      if (store.outbox.length || store.queuedMedia().length) sync.scheduleSync(APP_SYNC_DEBOUNCE_MS, 'commit');
    });
    sync.detachFns.push(function () { phone.off('change', onChange); });
    if (win && win.addEventListener) {
      var onOnline = function () { sync.failures = 0; sync.syncNow('online'); };
      win.addEventListener('online', onOnline);
      sync.detachFns.push(function () { win.removeEventListener('online', onOnline); });
    }
    if (doc && doc.addEventListener) {
      var onVis = function () { if (doc.visibilityState === 'visible') sync.syncNow('foreground'); };
      doc.addEventListener('visibilitychange', onVis);
      sync.detachFns.push(function () { doc.removeEventListener('visibilitychange', onVis); });
    }
  };
  sync.detach = function () {
    sync.detachFns.forEach(function (fn) { fn(); });
    sync.detachFns = [];
    if (sync.timer) { timers.clearTimeout(sync.timer); sync.timer = null; }
  };
  return sync;
}
