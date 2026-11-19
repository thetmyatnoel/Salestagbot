/**
 * tools/score_voice.js — Phase 0 test T2. Runs real voice notes through the real
 * Gemini prompt and reports what the bot would have understood.
 *
 *   set GEMINI_KEY=...            (PowerShell: $env:GEMINI_KEY="...")
 *   node tools/score_voice.js samples/                 # every .ogg/.oga/.opus/.mp3/.m4a/.wav in the folder
 *   node tools/score_voice.js samples/ --model gemini-2.5-flash-lite
 *   node tools/score_voice.js --text "ဒါ ၂ ထည် ရောင်းရတယ်"
 *
 * Optional samples/expected.json:
 *   { "001.ogg": {"intent":"SALE","qty":2}, "002.ogg": {"intent":"EXPENSE","amount":30000} }
 * Export voice notes from Telegram Desktop (right-click > Save as) into the folder.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');

const ROOT = path.join(__dirname, '..');
['apps-script/core_config.js', 'apps-script/core_burmese.js', 'apps-script/core_ai_prompt.js']
  .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }));

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const KEY = process.env.GEMINI_KEY;
const MODEL = opt('--model', 'gemini-2.5-flash-lite');
const CONTEXT = { shop: 'S1', staff: 'test', item: { id: 'S1-0002', name: 'လုံချည် ကချင် အပြာ', price: 18000, stock: 5, type: 'SKU' }, awaiting: null };
const MIME = { '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mp3', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac' };

if (!KEY) { console.error('Set GEMINI_KEY first.'); process.exit(2); }

function gemini(parts) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: INTENT_SCHEMA }
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/${MODEL}:generateContent`, method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY, 'content-length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(JSON.parse(data).candidates[0].content.parts[0].text)); }
        catch (e) { reject(new Error('Bad response: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const text = opt('--text', null);
  if (text) {
    console.log(JSON.stringify(await gemini([{ text: 'Staff wrote: ' + text }, { text: aiContextText(CONTEXT) }]), null, 2));
    return;
  }
  const dir = args.find(a => !a.startsWith('--') && fs.existsSync(a));
  if (!dir) { console.error('Give a folder of audio files or --text "..."'); process.exit(2); }
  let expected = {};
  const expPath = path.join(dir, 'expected.json');
  if (fs.existsSync(expPath)) expected = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  const files = fs.readdirSync(dir).filter(f => MIME[path.extname(f).toLowerCase()]).sort();
  let ok = 0, total = 0;
  const t0 = Date.now();
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const started = Date.now();
    let out;
    try {
      out = await gemini([
        { inlineData: { mimeType: MIME[path.extname(f).toLowerCase()], data: buf.toString('base64') } },
        { text: aiContextText(CONTEXT) }
      ]);
    } catch (e) {
      console.log(`${f}\tERROR\t${e.message}`);
      continue;
    }
    const ms = Date.now() - started;
    const exp = expected[f];
    let verdict = '';
    if (exp) {
      total++;
      const good = Object.keys(exp).every(k => String(out[k]) === String(exp[k]));
      if (good) ok++;
      verdict = good ? 'PASS' : 'FAIL expected ' + JSON.stringify(exp);
    }
    console.log(`${f}\t${out.intent}\tqty=${out.qty}\tunit=${out.unit_price}\tamount=${out.amount}\tconf=${out.confidence}\t${ms}ms\t"${out.transcript}"\t${verdict}`);
  }
  if (total) console.log(`\n${ok}/${total} correct (${Math.round(100 * ok / total)}%) on ${MODEL} in ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
