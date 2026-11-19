# Why the bot repeated its menu every hour

Confidence: 0.8. Telegram follows redirects: no.

## Diagnosis

Telegram never accepts the bot's HTTP reply, so it keeps re-delivering the same /start update for 24 hours; the 1-hour CacheService dedupe hides the retries, and the first retry after the cache entry expires re-runs showMenu, which is why the identical menu arrives at exactly 60-minute spacing (10:56, 11:56) without anyone sending /start.

Mechanism, step by step:
1. doPost() in C:\Users\USER\Desktop\Noel\apps-script\gas_main.js returns ContentService.createTextOutput('ok'). Google serves every ContentService response as an HTTP 302 redirect to a one-time URL on script.googleusercontent.com (the script has ALREADY executed by then, so the menu message is sent before the 302 goes back). That redirect target only accepts GET.
2. Telegram's webhook client (official telegram-bot-api server, WebhookActor.cpp) treats only 200-299 as success and contains no redirect handling. A 302 produces last_error_message "Wrong response from the webhook: 302 Moved Temporarily" and the update is scheduled for re-delivery.
3. Retry schedule from the source: first retry immediately (delay 0), then the delay doubles (1,2,4,8,16,32 s) and caps at a random 60-120 s per attempt, repeating until the update expires (message updates are pushed with timeout 86400 s = 24 h). So the same update_id is POSTed roughly every 1-2 minutes, all day.
4. processUpdate() in core_bot.js caches 'upd:<id>' for 3600 s and returns 'duplicate' silently (no Errors row, no reply). At 60 min the cache entry lapses; the next retry (≤2 min later) runs handleUpdate again -> showMenu -> the menu appears once more, and the cache is re-armed. Hence a menu every ~60-62 min. The 3-hour gap before 14:58 is consistent with iOS notification grouping (the stack is collapsed, "Show less") or the chat being open at 12:56/13:56; the exact 60-minute step is the fingerprint.
5. Why earlier /start got no reply with an empty Errors tab: Telegram delivers updates per queue, and message updates are queued by chat_id (Client.cpp: webhook_queue_id = chat_id + (11<<33)). A queue only advances when its head update succeeds or expires, so while the stuck /start is retrying, every newer message from that same phone waits behind it for up to 24 h. doPost never runs for those, so nothing is logged.
Note that the secret-mismatch branch of doPost also returns ok(), so it has the same problem, and CacheService (max TTL 6 h, may evict early) can never cover Telegram's 24 h retry window on its own.

## Retry behaviour

Per the official telegram-bot-api server source: success is HTTP 200-299 only (any 3xx/4xx/5xx or a closed/timed-out connection is 'Wrong response from the webhook' and is retried). Telegram waits up to 60 s (connection idle_timeout) for the response. The first retry is immediate, then the delay doubles (1, 2, 4, 8, 16, 32 s) and caps at a random 60-120 s per attempt; a Retry-After header from the webhook overrides this (clamped to 3600 s). Retries continue until the update expires, 24 h after the message date, after which it is dropped ('Drop update ...'). Updates are grouped into per-chat queues (message updates: chat_id-based queue id; callback queries: user-based) and each queue is strictly head-of-line: later updates in the same chat wait until the failing one succeeds or expires, while other chats are unaffected. max_connections (1-100, default 40) bounds parallel queues, and Telegram itself drops to 1 connection while no delivery has succeeded in the last 10 s. drop_pending_updates on setWebhook discards the whole backlog.

## Evidence

- Telegram's webhook delivery code counts only HTTP 200-299 as success; any other code yields the error 'Wrong response from the webhook: <code> <reason>' and schedules a retry. There is no redirect handling anywhere in the actor.
  Source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/master/telegram-bot-api/WebhookActor.cpp lines 619-640 (`if (200 <= response->code_ && response->code_ <= 299)` ... `query_error = "Wrong response from the webhook: " << response->code_ << " " << response->reason_`)
- Retry schedule: new update delay_=1; on error, if fail_count_>0 next_delay = min(random(60..120), delay*2); first retry is immediate; update is dropped only when now+delay > expires_at_. WEBHOOK_MAX_RESEND_TIMEOUT = 60.
  Source: WebhookActor.cpp lines 405-417 and 502-520; WebhookActor.h (`static constexpr td::int32 WEBHOOK_MAX_RESEND_TIMEOUT = 60;`)
- Message updates expire 24 h after the message date (left_time = message_date + 86400 - now; most add_update calls pass timeout 86400), matching the Bot API doc 'they will not be kept longer than 24 hours'.
  Source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/master/telegram-bot-api/Client.cpp line 18474 and add_update_impl (tqueue push with get_unix_time()+timeout); https://core.telegram.org/bots/api#getting-updates
- Updates are delivered per queue and a queue is re-scheduled only after its head update succeeds (drop_event) or errors (re-queued at wakeup_at_), so a permanently failing update blocks later updates in the same queue; message updates use queue id = chat_id + (11<<33), i.e. one queue per chat.
  Source: WebhookActor.cpp send_update()/on_update_error()/drop_event(); Client.cpp line 19457 (`auto webhook_queue_id = message_info->chat_id + (static_cast<int64>(11) << 33);`)
- Telegram waits at most 60 s for the webhook response: the outbound connection is created with idle_timeout = 60 (`HttpOutboundConnection(fd, ssl_stream, max_post_size=0, max_files=50, idle_timeout=60, ...)`). max_connections is clamped to 1 while there has been no success in the last 10 s.
  Source: WebhookActor.cpp line 230-232 plus https://raw.githubusercontent.com/tdlib/td/master/tdnet/td/net/HttpOutboundConnection.h lines 28-31; WebhookActor.cpp create_new_connections()
- Official Bot API doc: 'In case of an unsuccessful request (a request with response HTTP status code different from 2XY), we will repeat the request and give up after a reasonable amount of attempts'; getWebhookInfo exposes pending_update_count, last_error_date, last_error_message; setWebhook has max_connections (1-100, default 40) and drop_pending_updates.
  Source: https://core.telegram.org/bots/api#setwebhook and #getwebhookinfo
- Google: 'For security, content returned by the Content service is redirected to a one-time URL at script.googleusercontent.com ... ensure the HTTP client is configured to follow redirects.'
  Source: https://developers.google.com/apps-script/guides/content
- The 302 applies to POST as well; the script runs before the redirect is returned (data already written to the sheet), and the redirect URL must be requested with GET (POST to it returns 405).
  Source: https://gist.github.com/tanaikech/131ba814a1f6012fd6a5ffe11789971f ; https://dev.to/googleworkspace/youre-probably-using-curl-wrong-with-your-google-apps-script-web-app-1ed8
- Independent reports of Apps Script Telegram bots with exactly this symptom: bot keeps re-sending its welcome message, getWebhookInfo shows 'Wrong response from the webhook: 302 Moved Temporarily' and a growing pending_update_count; one author who added CacheService update_id dedupe still saw users' messages silently never arrive (queue blocking) and found the 302 in getWebhookInfo.
  Source: https://discuss.google.dev/t/telegram-bot-keep-spamming/279019 ; https://habr.com/ru/articles/1066054/ ; https://my-blog-b1c7.onrender.com/blog/gas-telegram-webhook-302-error/
- Screenshot: identical menu text from 'Thiri Khit' at Yesterday 10:56, 11:56, 14:58 plus an older collapsed one; the 10:56->11:56 step equals the 3600 s dedupe TTL in processUpdate().
  Source: C:\Users\USER\.claude\uploads\a9b209a7-fac1-41e9-bc05-de092641f15c\dda6c4da-image.png ; C:\Users\USER\Desktop\Noel\apps-script\core_bot.js lines 22-33

## Recommended fix

In order of preference (do 1-3 together; 4 is the fallback if 1 fails the check):

1. Stop returning a redirect (root cause). In C:\Users\USER\Desktop\Noel\apps-script\gas_main.js change
   function ok() { return ContentService.createTextOutput('ok'); }
   to
   function ok() { return HtmlService.createHtmlOutput('ok'); }
   HtmlService output is served directly from the /exec URL with HTTP 200 (that is why a web app's address bar stays on script.google.com), whereas ContentService is always a 302 to script.googleusercontent.com. doGet can stay as is. Then Deploy > Manage deployments > edit the EXISTING deployment > new version (a new deployment changes the URL and breaks the webhook). Also add a self-test to gas_main.js so this can be verified without Telegram:
   function probeWebhookResponse() {
     var p = PropertiesService.getScriptProperties();
     var res = UrlFetchApp.fetch(p.getProperty('WEBAPP_URL') + '?token=' + p.getProperty('WEBHOOK_SECRET'), {
       method: 'post', contentType: 'application/json', payload: '{"update_id":-1}', followRedirects: false, muteHttpExceptions: true });
     Logger.log('HTTP ' + res.getResponseCode() + ' (Telegram only accepts 200-299; 302 means it will retry)');
   }
   UrlFetchApp carries no Google cookies, so it sees exactly what Telegram sees. Expect 200 after the change, 302 before.

2. Make the dedupe durable (defense in depth; CacheService is at most 6 h and can evict early, Telegram retries for 24 h). In core_bot.js processUpdate():
   var key = 'upd:' + update.update_id;
   if (ports.cache.get(key)) return 'duplicate';
   ports.cache.put(key, '1', 21600);
   if (!ports.seen.add(update.update_id)) return 'duplicate';
   and add the port in buildPorts() (gas_main.js):
   seen: { add: function (id) {            // ring buffer of the last 300 processed update ids; returns false if already processed
     var lock = LockService.getScriptLock(); lock.waitLock(15000);
     try {
       var props = PropertiesService.getScriptProperties();
       var ids = JSON.parse(props.getProperty('SEEN_UPDATES') || '[]');
       if (ids.indexOf(id) >= 0) return false;
       ids.push(id); if (ids.length > 300) ids = ids.slice(-300);
       props.setProperty('SEEN_UPDATES', JSON.stringify(ids));
       return true;
     } finally { lock.releaseLock(); }
   } }
   (300 ids is ~3.5 KB, under the 9 KB property limit.) Mirror it in C:\Users\USER\Desktop\Noel\poc\sim_ports.js (line ~168): seen: { add: function (id) { if (world.seen[id]) return false; world.seen[id] = 1; return true; } } with world.seen = {}. Do NOT use a 'highest update_id seen' watermark instead: with per-chat queues Telegram can legitimately deliver a lower id after a higher one and the watermark would drop a real sale.

3. Re-register the webhook with the stuck backlog dropped and one connection. In registerWebhook() change the setWebhook payload to
   { url: url + '?token=' + secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true, max_connections: 1 }
   and run registerWebhook() once right after deploying the new version. drop_pending_updates flushes the retrying update immediately (this alone stops the hourly menu the moment it runs); max_connections: 1 keeps deliveries sequential so LockService.waitLock(15000) and the append-only ledger never contend (Telegram already throttles to 1 connection while a webhook is failing, so nothing is lost; two shops never need parallel delivery).

4. Fallback only if probeWebhookResponse() still prints 302 after step 1: switch inbound to getUpdates long polling from a time trigger (everyMinutes(1), store the offset in Script Property TG_OFFSET, keep doPost removed and call deleteWebhook). Cost: every button press waits up to 60 s plus run time, which is a poor experience for a conversational POS, and ~1440 trigger runs/day eat into the consumer 90 min/day trigger quota. Dedupe alone is NOT a substitute for fixing the 302: with a permanent 302, the head update blocks that chat's queue for 24 h, so the family would get no replies at all.

Not recommended: 'respond faster' (there is no timeout evidence; Apps Script cannot answer before the handler finishes, and the handler is a few seconds against Telegram's 60 s idle timeout).

## Alternatives considered

- Telegram times out the request (60 s idle timeout) because Sheets/Lock work is slow: produces the same retry/dedupe pattern, but last_error_message would read 'Read timeout' or 'Connection timed out' instead of 302; fix 2 and 3 still apply, and the handler would need to be made cheaper. Unlikely: /start only reads the Staff tab and sends one message.
- Web app deployed with 'Who has access' not set to Anyone: Telegram is redirected to accounts.google.com and doPost never runs. Does not fit, because the menu IS sent, which proves doPost executes.
- A second webhook target or old deployment URL duplicating deliveries: ruled out because Telegram allows only one webhook per bot and the 60-minute period matches the cache TTL exactly.
- A time-based trigger or the simulator calling showMenu: ruled out, installTriggers() only installs sendDailySummary/sendMonthlyReport/weeklyBackup and none of them send the menu text.

## The check the user can run

In the Apps Script editor run webhookStatus() and read the getWebhookInfo line in the log. Before the fix you will see "last_error_message":"Wrong response from the webhook: 302 Moved Temporarily" (or "302 Found"), a last_error_date within the last couple of minutes, and pending_update_count >= 1: that confirms this diagnosis. After deploying the fix and running registerWebhook(), send one /start from the phone, wait 3 minutes, run webhookStatus() again: pending_update_count must be 0 and last_error_date must not have advanced (and probeWebhookResponse() must print HTTP 200, not 302).
