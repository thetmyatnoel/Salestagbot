/**
 * gas_telegram.js — the only file that talks to Telegram. Swap this file to
 * move the bot to another channel; the core never changes.
 */
function tgToken() {
  var t = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  if (!t) throw new Error('Script Property BOT_TOKEN is missing');
  return t;
}

function tg(method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + tgToken() + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (!body.ok) throw new Error('Telegram ' + method + ': ' + res.getContentText().slice(0, 300));
  return body;
}

/** Same as tg() but multipart, for uploading files (sendDocument, sendPhoto with a blob). */
function tgUpload(method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + tgToken() + '/' + method, {
    method: 'post', payload: payload, muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (!body.ok) throw new Error('Telegram ' + method + ': ' + res.getContentText().slice(0, 300));
  return body;
}

function tgMarkup(keyboard) {
  return { inline_keyboard: keyboard && keyboard.length ? keyboard : [] };
}

var gasChat = {
  sendMessage: function (chatId, text, keyboard) {
    var r = tg('sendMessage', { chat_id: chatId, text: text, reply_markup: tgMarkup(keyboard) });
    return { messageId: r.result.message_id };
  },
  sendPhoto: function (chatId, photo, caption, keyboard) {
    try {
      var r = tg('sendPhoto', { chat_id: chatId, photo: photo, caption: caption, reply_markup: tgMarkup(keyboard) });
      return { messageId: r.result.message_id };
    } catch (err) {
      return gasChat.sendMessage(chatId, caption, keyboard);   // bad file id: degrade to text
    }
  },
  /** doc is a Blob from gasPdf.make. */
  sendDocument: function (chatId, doc, caption) {
    var r = tgUpload('sendDocument', { chat_id: String(chatId), caption: caption || '', document: doc });
    return { messageId: r.result.message_id };
  },
  editMessage: function (chatId, messageId, text, keyboard, isCaption) {
    var payload = { chat_id: chatId, message_id: messageId, reply_markup: tgMarkup(keyboard) };
    payload[isCaption ? 'caption' : 'text'] = text;
    try {
      tg(isCaption ? 'editMessageCaption' : 'editMessageText', payload);
    } catch (err) {
      if (String(err.message).indexOf('not modified') >= 0) return;
      return gasChat.sendMessage(chatId, text, keyboard);     // too old to edit: send instead (the core keeps the new id)
    }
  },
  answerCallback: function (id) {
    try { tg('answerCallbackQuery', { callback_query_id: id }); } catch (err) { /* stale query, ignore */ }
  },
  typing: function (chatId) {
    try { tg('sendChatAction', { chat_id: chatId, action: 'typing' }); } catch (err) { /* cosmetic */ }
  },
  /** Voice notes and photos, up to Telegram's 20 MB bot limit. Returns a Blob. */
  getFile: function (fileId) {
    var info = tg('getFile', { file_id: fileId });
    var url = 'https://api.telegram.org/file/bot' + tgToken() + '/' + info.result.file_path;
    var blob = UrlFetchApp.fetch(url).getBlob();
    var ext = String(info.result.file_path).split('.').pop().toLowerCase();
    if (ext === 'oga' || ext === 'ogg' || ext === 'opus') blob.setContentType('audio/ogg');
    if (ext === 'jpg' || ext === 'jpeg') blob.setContentType('image/jpeg');
    return blob;
  },
  /** Keep a copy of item photos in Drive for the catalog. Returns the Drive URL. */
  savePhoto: function (fileId, name) {
    var blob = gasChat.getFile(fileId).setName(name + '.jpg');
    var file = gasPhotoFolder().createFile(blob);
    return file.getUrl();
  }
};

function gasPhotoFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  var folder = DriveApp.createFolder('POS Photos');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}
