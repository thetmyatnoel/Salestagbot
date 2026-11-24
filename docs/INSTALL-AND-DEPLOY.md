# SalesTag installation and deployment

## 1. ဝန်ထမ်းအတွက် · Install on a phone

**ဆိုင်ရှင်က စတင်သုံးနိုင်ပြီဟု အကြောင်းကြားပြီးမှ တပ်ဆင်ပါ။** ဖုန်းကို အင်တာနက် ချိတ်ထားပြီး ဆိုင်ရှင်ထံမှ ဖုန်းချိတ်ဆက်ရန် ကုဒ် တောင်းပါ။ ကုဒ်သည် ၁၅ မိနစ်အတွင်း တစ်ကြိမ် သုံးနိုင်သည်။

**ဆိုင်အက်ပ် လိပ်စာ**  [salestagbot.web.app](https://salestagbot.web.app/)

### Android · Chrome

1. Chrome တွင် ဆိုင်အက်ပ် လိပ်စာကို ဖွင့်ပါ။
2. ညာဘက်အပေါ်ရှိ **⋮** ကို နှိပ်ပါ။ **Install app** သို့မဟုတ် **Add to Home screen** ကို ရွေးပြီး အတည်ပြုပါ။
3. ဖုန်းမျက်နှာပြင်ရှိ **ဆိုင်** အိုင်ကွန်ကို နှိပ်ပါ။ ကုဒ် ရိုက်ထည့်ပြီး **ချိတ်ဆက်** ကို နှိပ်ပါ။

### iPhone · Safari

1. Safari တွင် ဆိုင်အက်ပ် လိပ်စာကို ဖွင့်ပါ။
2. **Share** (အပေါ်မြှားပါသော အကွက်) ကို နှိပ်ပါ။ **Add to Home Screen → Add** ကို ရွေးပါ။
3. ဖုန်းမျက်နှာပြင်ရှိ **ဆိုင်** အိုင်ကွန်မှ အက်ပ်ကို ပြန်ဖွင့်ပါ။ ဤနေရာတွင် ကုဒ် ရိုက်ထည့်ပြီး **ချိတ်ဆက်** ကို နှိပ်ပါ။

### စတင်အသုံးပြုရန်

ဆိုင်အမည်နှင့် မိမိလုပ်ငန်းကို စစ်ပါ။ ရောင်းသူက ပစ္စည်းတံဆိပ်ကို စကင်ဖတ်ရာတွင် ကင်မရာသုံးခွင့် ပေးပါ။ စာရင်းကြည့်သူက **ဆိုင်စာရင်း ကြည့်မယ်** မှ နေ့၊ လ သို့မဟုတ် နှစ်ကို ရွေးနိုင်သည်။

**ပို့ရန် ကျန်သည်** ဟု ပြပါက အင်တာနက် ပြန်ချိတ်ပြီး အက်ပ်ကို ဖွင့်ထားပါ။ **အကုန် ပို့ပြီးပါပြီ** ဟု ပြမှ စာရင်းများ ရောက်ရှိပါပြီ။ ကုဒ် သက်တမ်းကုန်ပါက ဆိုင်ရှင်ထံမှ ကုဒ်အသစ် တောင်းပါ။

## 2. Owner · Set up the first shop

**Start once the phone app opens and its connection test passes on page 4.** Use the business Google account for the spreadsheet. Only the first owner needs a manual Staff row. Other workers can receive their codes in person.

1. **Identify the owner.** On the owner’s Telegram account, open [@itemtag_bot](https://t.me/itemtag_bot) and send `/start`. For an unregistered account, open the shop spreadsheet’s **Errors** tab and find the matching unknown-user entry. Copy the numeric Telegram user ID. If the owner already sees the bot menu, continue at step 3.
2. **Create the owner row.** Open **Staff** and enter the columns below in one row. Use the owner’s real ID and name. Send `/start` again. The bot menu should appear.
3. **Connect the owner’s phone.** Tap **📲 အက်ပ်** in the bot. Install the phone app using page 1, open it from its home-screen icon and enter the code within 15 minutes.
4. **Name the shops.** In app Settings, open **ဆိုင် ဖွင့် / ပိတ်**. Give S1 and S2 their business names, addresses and phone numbers. Close an unused shop or add another. Keep at least one shop open.
5. **Add the first worker.** Open **ဝန်ထမ်းနှင့် သုံးခွင့် → ဝန်ထမ်းအသစ်**. Enter a staff number such as `W-001`, the person’s name, jobs and permitted shops. Save, reopen their name and tap **ဖုန်းချိတ်ဆက်ရန် ကုဒ် ရယူမယ်**. Give that worker their code and page 1.
6. **Check the result together.** Ask a seller to find an item in the assigned shop. Ask a report reader to open the daily summary and check which shops appear. The owner can give a trusted staff member the access-administrator job to manage other workers.

| Staff column | Value for the first owner |
| --- | --- |
| TelegramUserID | Numeric ID from step 1 |
| Name | Owner’s name |
| DefaultShop | S1 |
| Role | owner |
| Active | TRUE |

## 3. Maintainer · Deploy the backend

**Use the existing Apps Script deployment and Firebase project.** The configured project is `salestagbot`. Keep the current Apps Script deployment ID so existing Telegram and app links continue to work.

1. **Get the release source.** [Download the tested code](https://github.com/thetmyatnoel/Salestagbot/archive/43fd2b077d0abf1daded2d626a2690c951b34ec6.zip). Extract the ZIP. Open a terminal in the extracted folder containing `firebase.json`, `tools` and `apps-script`.
2. **Sign in on the deployment computer.** Install Node.js 24 LTS and enable the **Google Apps Script API** in [Apps Script user settings](https://script.google.com/home/usersettings). Run the commands below from the release folder. Choose the business account listed in `tools/publish.config.json` when the browser asks. Confirm Firebase lists project `salestagbot`.

```sh
npm install -g @google/clasp@3 firebase-tools@15
clasp login
firebase login
firebase projects:list
node tools/publish.js status
```

3. **Check the target.** In the shop spreadsheet choose **Extensions → Apps Script → Deploy → Manage deployments**. Match the web app’s deployment ID and its URL ending in `/exec` to `tools/publish.config.json`. The same URL belongs in `app/config.js` and the script property `WEBAPP_URL`. Record the current version shown by the status command. Check that `BOT_TOKEN` belongs to the shop bot. Keep these credentials in **Project Settings → Script properties**. For a standalone script, set `SHEET_ID` to the shop spreadsheet ID.
4. **Publish the backend.** The command below builds the Apps Script bundle, uploads it and updates the existing deployment. Record the new live version printed at the end.

```sh
node tools/publish.js bot "First shop release"
```

5. **Prepare the shop spreadsheet.** In the Apps Script editor run `setupSheet`. Approve Google’s prompt as the business owner. Check the execution log for **Sheet ready** and verify **Staff**, **Items**, **Settings** and **Ledger** appear in the intended spreadsheet. Run `webhookStatus` and confirm the correct bot and webhook. For a first connection or a changed URL, run `registerWebhook` before staff start sending messages. It clears queued Telegram updates.
6. **Configure scheduled work.** Set `GROUP_CHAT_ID` in Script properties if the family group should receive reports. Run `installTriggers` once as the owner for the daily summary, monthly report and weekly backup. Continue on page 4.

## 4. Maintainer · Publish the phone app and check first use

**Publish Hosting.** In the same terminal, list Hosting sites. When the listing succeeds but the expected site is absent, create the named site once. If the listing reports a permissions error, sign in with an account that can deploy to the project.

```sh
firebase hosting:sites:list --project salestagbot
```

If the site is missing, run this command.

```sh
firebase hosting:sites:create salestagbot --project salestagbot
```

Publish the app from the release folder.

```sh
node tools/publish.js app
```

**Verify the release from a shop phone.**

1. Open [the live build information](https://salestagbot.web.app/version.json). Compare `build` with `app/dist/version.json` from the release. The tested application build is `1.0.0+1f6d909b84`.
2. Use the shop’s mobile data to open [the connection test](https://salestagbot.web.app/ping.html). Tap **📡 ၃ ကြိမ်**. Confirm the page loads and the backend returns successful JSON responses. Repeat at each shop.
3. In the spreadsheet’s **Settings**, set the `app_url` value to `https://salestagbot.web.app`. Follow page 2 to connect the first owner, then connect one worker. Verify the assigned shop and job screen appear. Ping alone only confirms connectivity.
4. Ask the owner to open the daily summary, switch to details and open print preview. An empty new shop can show zero totals. On the first genuine sale, compare the receipt and amount on the seller’s phone with the owner’s report after sync. Use the simulator for practice sales.

**If something fails**

| What you see | What to do |
| --- | --- |
| Firebase “Site Not Found” | Verify the Hosting project and site, publish the app, then check `version.json` again. |
| Google sign-in page during a phone ping | In **Manage deployments**, check the web app runs as the deploying owner and **Who has access** is **Anyone**. Check `/exec` in `app/config.js`. Rebuild and publish the app if that URL changed. |
| Code expired or the wrong jobs appear | Check the worker’s assignment. Issue a fresh code. Sync pending entries before changing an enrolled worker’s access or reconnecting a phone. |

**Recover a release.** For Hosting, open **Firebase Console → Hosting → Release history** and roll back to the previous working release if one exists. For the backend, run `node tools/publish.js rollback N` using the version number recorded on page 3. This moves the web app back. Editor code and triggers still use the latest upload. Restore the matching editor source if its triggers also need reverting. Keep the shop spreadsheet and phone data intact.
