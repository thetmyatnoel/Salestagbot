/**
 * app/app_icons.js — the app's icons and its plain text (round 6, revision 3: docs/design-round-6/SPEC-round-6.md 13.1, 13.2).
 *
 * APP_ICONS: Tabler-style outline glyphs (24 x 24 grid, stroke 2, round caps and joins; Tabler Icons, MIT, see
 * vendor/tabler-icons-LICENSE.txt). They ship inside the JavaScript bundle that the service worker precaches, so the
 * icons are on the phone after the first load and nothing is fetched at run time. The markup is built from this table
 * only (no user text), so it is safe as innerHTML.
 *
 * appPlain(text): every emoji removed from every line (the leading run, then any cluster left in the line), the line
 * tidied; a line without an emoji comes back unchanged; a digit keycap that starts a line is its step number ('1. ').
 * The app shows every label, title, toast and card text through
 * it (APP.tt); only the four job buttons and the core's main menu keep their emojis (F7).
 * Plain ES5: var and function only. No DOM access at load time.
 */
var APP_ICONS = {
  'arrow-left': ['M5 12l14 0', 'M5 12l6 6', 'M5 12l6 -6'],
  'settings': ['M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z', 'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0'],
  'cloud-check': ['M11 18.004h-4.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.388 0 2.585 .82 3.138 2.007', 'M15 19l2 2l4 -4'],
  'cloud-upload': ['M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1', 'M9 15l3 -3l3 3', 'M12 12l0 9'],
  'cloud-off': ['M9.58 5.548c.24 -.11 .492 -.207 .752 -.286c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 .957 -.383 1.824 -1.003 2.454m-2.997 1.033h-11.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.13 -.582 .37 -1.128 .7 -1.62', 'M3 3l18 18'],
  'alert-triangle': ['M12 9v4', 'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z', 'M12 16h.01'],
  'scan': ['M4 7v-1a2 2 0 0 1 2 -2h2', 'M4 17v1a2 2 0 0 0 2 2h2', 'M16 4h2a2 2 0 0 1 2 2v1', 'M16 20h2a2 2 0 0 0 2 -2v-1', 'M5 12l14 0'],
  'menu-2': ['M4 6l16 0', 'M4 12l16 0', 'M4 18l16 0'],
  'microphone': ['M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1 -6 0z', 'M5 10a7 7 0 0 0 14 0', 'M8 21l8 0', 'M12 17l0 4'],
  'search': ['M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M21 21l-6 -6'],
  'plus': ['M12 5l0 14', 'M5 12l14 0'],
  'pencil': ['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'],
  'eraser': ['M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3', 'M18 13.3l-6.3 -6.3'],
  'trash': ['M4 7l16 0', 'M10 11l0 6', 'M14 11l0 6', 'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12', 'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3'],
  'x': ['M18 6l-12 12', 'M6 6l12 12'],
  'camera': ['M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2', 'M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0'],
  'share': ['M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M8.7 10.7l6.6 -3.4', 'M8.7 13.3l6.6 3.4'],
  'printer': ['M17 17h2a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2h-14a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h2', 'M17 9v-4a2 2 0 0 0 -2 -2h-6a2 2 0 0 0 -2 2v4', 'M7 15a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2z'],
  'arrow-back-up': ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'],
  'history': ['M12 8l0 4l2 2', 'M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5'],
  'keyboard': ['M2 8a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z', 'M6 10l0 .01', 'M10 10l0 .01', 'M14 10l0 .01', 'M18 10l0 .01', 'M6 14l0 .01', 'M18 14l0 .01', 'M10 14l4 .01'],
  'bulb': ['M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7', 'M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3', 'M9.7 17l4.6 0'],
  'calendar': ['M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z', 'M16 3v4', 'M8 3v4', 'M4 11h16'],
  'chevron-right': ['M9 6l6 6l-6 6'],
  'file-text': ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z', 'M9 9l1 0', 'M9 13l6 0', 'M9 17l6 0'],
  'backspace': ['M20 6a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-11l-5 -5a1.5 1.5 0 0 1 0 -2l5 -5z', 'M12 10l4 4m0 -4l-4 4']
};

/** The glyph as SVG markup ('' for an unknown name). */
function appIconSvg(name) {
  var paths = Object.prototype.hasOwnProperty.call(APP_ICONS, name) ? APP_ICONS[name] : null;
  if (!paths) return '';
  return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    paths.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
}

/** span.ic holding the glyph (an empty span for an unknown name). */
function appIcon(name) {
  return appH('span', { class: 'ic', html: appIconSvg(name) });
}

/**
 * An element whose text is a label with a leading glyph: the text node first (so textContent is the label alone, in the
 * browser and in the Node checks' fake document), the glyph after it, drawn first by CSS (.wi > .ic { order: -1 }).
 */
function appHi(tag, attrs, icon) {
  var e = appH(tag, attrs);
  e.className = (e.className ? e.className + ' ' : '') + 'wi';
  if (icon) e.appendChild(appIcon(icon));
  return e;
}

// The leading run of emoji clusters (with a trailing '+' as in '💵+🏦'), then any cluster anywhere in a line. Arrows and
// geometric shapes used as text stay unless U+FE0F follows them. ES5: no u flag, surrogate pairs written out.
var APP_EMOJI_HEAD = /^(?:(?:[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2900-\u297F\u2B00-\u2BFF\u3030\u303D\u3297\u3299]|[\uD83C-\uD83E][\uDC00-\uDFFF])[\uFE0E\uFE0F\u20E3]?(?:\u200D(?:[\u2190-\u27BF\u2B00-\u2BFF]|[\uD83C-\uD83E][\uDC00-\uDFFF])\uFE0F?)*\+?)+\s*/;
var APP_EMOJI_ANY = /(?:[0-9#*]\uFE0F?\u20E3|[\u2190-\u21FF\u25A0-\u25FF]\uFE0F|[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2300-\u23FF\u2460-\u24FF\u2600-\u27BF\u2900-\u297F\u2B00-\u2BFF\u3030\u303D\u3297\u3299]|[\uD83C-\uD83E][\uDC00-\uDFFF])[\uFE0E\uFE0F\u20E3]?(?:\u200D(?:[\u2600-\u27BF\u2B00-\u2BFF]|[\uD83C-\uD83E][\uDC00-\uDFFF])\uFE0F?)*\+?/g;

// A digit keycap that starts a line (a digit, U+FE0F, U+20E3: the steps of help) is a step number: it reads '1. ', with
// no leading space. Only the app shows it so; Telegram's text keeps its keycaps.
var APP_KEYCAP_HEAD = /^([0-9])\uFE0F?\u20E3\s*/;

function appPlainLine(l) {
  var num = APP_KEYCAP_HEAD.exec(l);
  if (num) { var rest = appPlainLine(l.slice(num[0].length)); return num[1] + '.' + (rest ? ' ' + rest : ''); }
  var head = l.replace(APP_EMOJI_HEAD, ''), s = head.replace(APP_EMOJI_ANY, '');
  if (s === l) return l;
  if (s !== head) s = s.replace(/ {2,}/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ +$/, '').replace(/ ·$/, '');
  if (head !== l) s = s.replace(/^[ \/·]+/, '');
  return s;
}

function appPlain(text) {
  return String(text === null || text === undefined ? '' : text).split('\n').map(appPlainLine).join('\n');
}
