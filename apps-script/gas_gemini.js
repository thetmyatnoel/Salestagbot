/**
 * gas_gemini.js — the only file that talks to Gemini.
 * Model name lives in Script Property GEMINI_MODEL so it can change without a deploy.
 * The key must be created from a country where the Gemini API is offered (Myanmar is not);
 * the calls themselves leave from Google's servers, never from a phone.
 */
function geminiCall(parts, schema, systemPrompt) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_KEY');
  var model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash-lite';
  if (!key) throw new Error('Script Property GEMINI_KEY is missing');
  var body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema }
  };
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  var data = JSON.parse(res.getContentText());
  var text = data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini returned no text: ' + res.getContentText().slice(0, 300));
  return JSON.parse(text);
}

function inlinePart(blob, fallbackMime) {
  return { inlineData: { mimeType: blob.getContentType() || fallbackMime, data: Utilities.base64Encode(blob.getBytes()) } };
}

var gasAi = {
  parseVoice: function (blob, ctx) {
    return geminiCall([inlinePart(blob, 'audio/ogg'), { text: aiContextText(ctx) }], INTENT_SCHEMA, SYSTEM_PROMPT);
  },
  parseText: function (text, ctx) {
    return geminiCall([{ text: 'Staff wrote: ' + text }, { text: aiContextText(ctx) }], INTENT_SCHEMA, SYSTEM_PROMPT);
  },
  describePhoto: function (blob, ctx) {
    return geminiCall([inlinePart(blob, 'image/jpeg'), { text: 'Allowed categories: ' + (ctx.categories || CFG.CATEGORIES).join(', ') }], PHOTO_SCHEMA, PHOTO_PROMPT);
  },
  /** Handwritten notebook page -> lines. Gated by the notebook_import setting until the Phase 0 test passes. */
  readNotebook: function (blob, ctx) {
    var out = geminiCall([inlinePart(blob, 'image/jpeg'),
      { text: 'Known item names in this shop: ' + (ctx.itemNames || []).join(' | ') }], NOTEBOOK_SCHEMA, NOTEBOOK_PROMPT);
    return out && out.lines ? out.lines : [];
  },
  /**
   * A photo of the filled paper measurement sheet. The prompt and the response schema are built from the active
   * MeasureFields the bot passes (ctx.fields = [{key, labelMy, labelEn, multi, type}]), so a renamed or added field
   * reaches the model without a code change. Returns {fields: {key: 'text'}, low_confidence: [keys], name,
   * order_date, due_date, phone, notes}; blank cells are left out, every value is a trimmed string.
   */
  readMeasurementSheet: function (blob, ctx) {
    ctx = ctx || {};
    var fields = ctx.fields || [];
    var out = geminiCall([inlinePart(blob, 'image/jpeg'), { text: 'Customer chosen in the shop: ' + (ctx.customer || '') }],
      measurementSchema(fields), measurementPrompt(fields)) || {};
    var got = out.fields || {}, values = {};
    fields.forEach(function (f) {
      var v = got[f.key];
      if (v !== undefined && v !== null && String(v).trim() !== '') values[f.key] = String(v).trim();
    });
    return {
      fields: values,
      low_confidence: (out.low_confidence || []).filter(function (k) { return values[k] !== undefined; }),
      name: out.name || '', order_date: out.order_date || '', due_date: out.due_date || '', phone: out.phone || '', notes: out.notes || ''
    };
  }
};
