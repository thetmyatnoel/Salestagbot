/**
 * app/config.example.js — copy to app/config.js and fill in the PUBLIC values. config.js is the one file
 * of the app that differs per deployment; tools/build_app.js copies it into app/dist/ (or this example
 * when config.js is missing, so a build never breaks).
 *
 * Nothing secret belongs here: no bot token, no Gemini key, no webhook secret, no device token. The
 * build refuses a bundle that contains such strings. The /exec URL is already public (it is the
 * Telegram webhook address) and the server checks a per-device token inside every request body.
 */
var APP_CONFIG = {
  // Deploy > Manage deployments in the Apps Script editor: the Web app URL that ends in /exec.
  apiUrl: 'https://script.google.com/macros/s/PASTE_DEPLOYMENT_ID_HERE/exec',
  // The bot's username (what the printed QR tags link to), without the @.
  botUsername: 'YourBotUsername',
  // Shown in the header until the shop name arrives with the first sync.
  appName: 'SalesTag'
};
