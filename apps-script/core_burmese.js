/**
 * core_burmese.js — numbers, dates and text helpers for Burmese output.
 * No platform APIs. Yangon is UTC+6:30 with no daylight saving, so date
 * math is done by hand instead of relying on Intl, which Apps Script lacks.
 */
var MY_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];
var MY_MONTHS = ['ဇန်နဝါရီ', 'ဖေဖော်ဝါရီ', 'မတ်', 'ဧပြီ', 'မေ', 'ဇွန်',
                 'ဇူလိုင်', 'ဩဂုတ်', 'စက်တင်ဘာ', 'အောက်တိုဘာ', 'နိုဝင်ဘာ', 'ဒီဇင်ဘာ'];
var YANGON_OFFSET_MS = 6.5 * 60 * 60 * 1000;

/** 2 -> "၂" (counts are shown in Burmese digits). */
function myDigits(n) {
  return String(n).replace(/\d/g, function (d) { return MY_DIGITS[Number(d)]; });
}

/** 25000 -> "25,000" (money stays in Arabic digits with separators). */
function fmtMoney(n) {
  n = Math.round(Number(n) || 0);
  var sign = n < 0 ? '-' : '';
  var s = String(Math.abs(n));
  return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtCount(n) {
  var v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + myDigits(Math.abs(v));
}

/** Date -> "2026-09-06" in Yangon time. */
function dayKey(date) {
  var d = new Date(date.getTime() + YANGON_OFFSET_MS);
  var m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/** Date -> "14:05" in Yangon time. */
function timeKey(date) {
  var d = new Date(date.getTime() + YANGON_OFFSET_MS);
  var h = d.getUTCHours(), mi = d.getUTCMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
}

/** "2026-09-06" -> "၆ စက်တင်ဘာ ၂၀၂၆" */
function fmtDayMy(key) {
  var p = key.split('-');
  return myDigits(Number(p[2])) + ' ' + MY_MONTHS[Number(p[1]) - 1] + ' ' + myDigits(p[0]);
}

/** "2026-09-06" -> "၆ စက်တင်ဘာ" (no year, for button labels). */
function fmtDayShortMy(key) {
  var p = String(key).split('-');
  if (p.length < 3) return String(key);
  return myDigits(Number(p[2])) + ' ' + MY_MONTHS[Number(p[1]) - 1];
}

/** Date -> "2026-09" in Yangon time. */
function monthKey(date) {
  return dayKey(date).slice(0, 7);
}

/** Date -> previous month's "yyyy-mm". */
function prevMonthKey(date) {
  var p = monthKey(date).split('-');
  var y = Number(p[0]), m = Number(p[1]) - 1;
  if (m === 0) { m = 12; y -= 1; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

/** "2026-09" -> "စက်တင်ဘာ ၂၀၂၆" */
function fmtMonthMy(ym) {
  var p = String(ym).split('-');
  return MY_MONTHS[Number(p[1]) - 1] + ' ' + myDigits(p[0]);
}

/** Whole days between an ISO time and now. */
function daysSince(iso, now) {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000));
}

/* The three day-key helpers below moved here from core_orders.js (round 5): the sale's due date needs them in
 * core_ledger.js and core_bot.js, which are loaded without the order module (run_sync.js, the app without orders). */

/** 'yyyy-mm-dd' + n days -> 'yyyy-mm-dd'. */
function addDaysKey(day, n) {
  var p = String(day).split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + Number(n)));
  var m = d.getUTCMonth() + 1, dd = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
}

/** Whole days from dayA to dayB (positive when dayB is later). */
function daysBetweenKeys(dayA, dayB) {
  var a = String(dayA).split('-'), b = String(dayB).split('-');
  return Math.round((Date.UTC(Number(b[0]), Number(b[1]) - 1, Number(b[2])) - Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2]))) / 86400000);
}

/**
 * A typed or spoken date: 30.10.26, 30/10/2026, 30-10 (this year, or next year when already past),
 * 2026-10-30 (the app's date input, taken as it is), Burmese digits accepted. Returns 'yyyy-mm-dd' or null.
 * opts.noRoll keeps a yearless past date in this year instead of rolling it to next year (the guided sale then
 * refuses it; the orders call without opts and keep the roll).
 */
function parseDayText(text, now, opts) {
  var s = String(text || '').replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); }).trim();
  var d, mo, y, key, check;
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    y = Number(iso[1]); mo = Number(iso[2]); d = Number(iso[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCMonth() !== mo - 1) return null;
    return s;
  }
  var m = s.match(/^(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\s*[.\/-]\s*(\d{2,4}))?$/);
  if (!m) return null;
  var today = dayKey(now);
  d = Number(m[1]); mo = Number(m[2]);
  if (m[3]) { y = Number(m[3]); if (y < 100) y += 2000; } else y = Number(today.slice(0, 4));
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  key = y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  if (!m[3] && key < today && !(opts && opts.noRoll)) key = (y + 1) + key.slice(4);
  return key;
}

/**
 * Parse a number from typed or spoken-style Burmese text.
 * Handles Arabic digits ("25,000"), Burmese digits ("၂၅၀၀၀") and number words
 * ("နှစ်သောင်းငါးထောင်" = 25000, "သုံးထောင့်ငါးရာ" = 3500). Returns null if none found.
 * Used by the bot for typed prices and by the simulator's stand-in for Gemini.
 */
function parseBurmeseNumbers(text) {
  if (!text) return [];
  var s = String(text).replace(/[၀-၉]/g, function (c) { return String(MY_DIGITS.indexOf(c)); });
  var out = [];
  var digitRe = /\d[\d,]*/g, m;
  while ((m = digitRe.exec(s)) !== null) {
    var v = Number(m[0].replace(/,/g, ''));
    if (!isNaN(v)) out.push({ value: v, index: m.index, end: m.index + m[0].length });
  }
  var units = [['တစ်', 1], ['နှစ်', 2], ['သုံး', 3], ['လေး', 4], ['ငါး', 5], ['ခြောက်', 6],
               ['ခုနှစ်', 7], ['ခုနစ်', 7], ['ရှစ်', 8], ['ကိုး', 9]];
  var mults = [['သိန်း', 100000], ['သောင်း', 10000], ['ထောင်', 1000], ['သန်း', 1000000], ['ရာ', 100], ['ဆယ်', 10]];
  var tokens = units.map(function (u) { return { w: u[0], unit: u[1] }; })
    .concat(mults.map(function (mm) { return { w: mm[0], mult: mm[1] }; }));
  tokens.sort(function (a, b) { return b.w.length - a.w.length; });
  var i = 0;
  while (i < s.length) {
    var tok = matchTokenAt(s, i, tokens);
    if (!tok) { i++; continue; }
    var start = i, total = 0, pending = 0, sawAny = false;
    while (i < s.length) {
      tok = matchTokenAt(s, i, tokens);
      if (tok) {
        sawAny = true;
        if (tok.unit) pending = tok.unit;
        else { total += (pending || 1) * tok.mult; pending = 0; }
        i += tok.w.length;
      } else if (s[i] === '့' || s[i] === ' ' || s[i] === '်') {
        i++;
      } else break;
    }
    if (sawAny) out.push({ value: total + pending, index: start, end: i });
  }
  out.sort(function (a, b) { return a.index - b.index; });
  return out;
}

function matchTokenAt(s, i, tokens) {
  for (var k = 0; k < tokens.length; k++) {
    if (s.substr(i, tokens[k].w.length) === tokens[k].w) return tokens[k];
  }
  return null;
}

function parseNumberText(text) {
  var nums = parseBurmeseNumbers(text);
  return nums.length ? nums[0].value : null;
}

/** Fill {placeholders} in a template. */
function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, function (_, k) {
    return vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : '';
  });
}
