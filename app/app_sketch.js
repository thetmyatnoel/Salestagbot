/**
 * app/app_sketch.js — the front-view figure to draw on (round 6, revision 3, F2: docs/design-round-6/SPEC-round-6.md 13.7.2).
 *
 * The measurement form gets a section 'ကိုယ်ပုံ': the outline of a woman (htamein to the ankles) or a man (trousers), and
 * the tailor's red strokes over it. The pad is inert (the page scrolls over it) until ဆွဲ enters a draw mode, left with OK.
 * The drawing is one text per session (sketch): '1' + fig + ':' + strokes joined by '.', each stroke the base64url of its
 * bytes x0, y0, x1, y1, ... (0..255 on the figure's 200 x 300 box). It syncs with the session (the Measurements column
 * Sketch) and, as a PNG made here, through the photo-job path into the session's PhotoURL (the measurement PDF prints it).
 * Pure helpers first (Node-tested), then the pad (DOM) and the PNG. Plain ES5: var and function only.
 */
var APP_SKETCH_STROKES = 60;          // strokes per drawing
var APP_SKETCH_POINTS = 400;          // points per stroke
var APP_SKETCH_MIN_STEP = 2;          // a point is kept when at least this far (grid units) from the stroke's last kept point
var APP_SKETCH_ERASE_R = 10;          // the eraser takes the stroke it touches within this many grid units
var APP_SKETCH_W = 200;               // the figure's box (viewBox 0 0 200 300)
var APP_SKETCH_H = 300;
var APP_SKETCH_PNG_MAX = 80000;       // a data URL longer than this is rendered again at 200 x 300
var APP_SKETCH_FIGURES = {
  F: ['M84 28a16 16 0 1 0 32 0a16 16 0 1 0 -32 0', 'M93 44l0 8', 'M107 44l0 8',
    'M93 52L70 60C62 63 60 70 60 78L55 120L50 162L49 176L57 176L59 162L65 122L71 88C72 98 74 106 76 112C78 124 79 134 80 142 C74 156 70 168 70 180L74 270L126 270L130 180C130 168 126 156 120 142C121 134 122 124 124 112C126 106 128 98 129 88L135 122 L141 162L143 176L151 176L150 162L145 120L140 78C140 70 138 63 130 60L107 52Z',
    'M84 270L82 286L96 286L96 270', 'M104 270L104 286L118 286L116 270'],
  M: ['M84 26a16 16 0 1 0 32 0a16 16 0 1 0 -32 0', 'M92 42l0 8', 'M108 42l0 8',
    'M92 50L64 58C56 61 54 68 54 76L49 120L45 162L44 176L52 176L54 162L60 122L67 88C68 110 70 128 72 146L72 176L76 286L96 286 L99 186L101 186L104 286L124 286L128 176L128 146C130 128 132 110 133 88L140 122L146 162L148 176L156 176L155 162L151 120 L146 76C146 68 144 61 136 58L108 50Z']
};
var APP_SKETCH_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/* ---------- pure helpers ---------- */

function appSketchB64(bytes) {
  var out = '', i;
  for (i = 0; i + 2 < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += APP_SKETCH_B64.charAt((n >> 18) & 63) + APP_SKETCH_B64.charAt((n >> 12) & 63) + APP_SKETCH_B64.charAt((n >> 6) & 63) + APP_SKETCH_B64.charAt(n & 63);
  }
  var rest = bytes.length - i;
  if (rest === 1) { var a = bytes[i] << 16; out += APP_SKETCH_B64.charAt((a >> 18) & 63) + APP_SKETCH_B64.charAt((a >> 12) & 63); }
  else if (rest === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out += APP_SKETCH_B64.charAt((b >> 18) & 63) + APP_SKETCH_B64.charAt((b >> 12) & 63) + APP_SKETCH_B64.charAt((b >> 6) & 63); }
  return out;
}
/** base64url (no padding) back to bytes, or null when the text cannot be one. */
function appSketchUnB64(text) {
  var s = String(text), bytes = [], buf = 0, bits = 0;
  if (s.length % 4 === 1) return null;
  for (var i = 0; i < s.length; i++) {
    var v = APP_SKETCH_B64.indexOf(s.charAt(i));
    if (v < 0) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 255); }
  }
  return bytes;
}
function appSketchByte(v, max) { var b = Math.round(Number(v) * 255 / max); return b < 0 ? 0 : b > 255 ? 255 : b; }

/** The drawing as its text: '' for no stroke (a figure with no stroke is ''). strokes = [[[x, y], ...], ...] in grid units. */
function appSketchEncode(fig, strokes) {
  var f = fig === 'M' ? 'M' : 'F', parts = [];
  (strokes || []).forEach(function (st) {
    if (!st || st.length < 1) return;
    var pts = st.length === 1 ? [st[0], st[0]] : st, bytes = [];
    pts.slice(0, APP_SKETCH_POINTS).forEach(function (p) { bytes.push(appSketchByte(p[0], APP_SKETCH_W), appSketchByte(p[1], APP_SKETCH_H)); });
    parts.push(appSketchB64(bytes));
  });
  return parts.length ? '1' + f + ':' + parts.join('.') : '';
}
/** {fig, strokes} of a drawing's text, or null for anything that does not match (13.7.2's pattern and byte rules). */
function appSketchDecode(text) {
  if (typeof text !== 'string' || !SYNC.MEAS_SKETCH_RE.test(text) || text.length > SYNC.MEAS_SKETCH_MAX) return null;
  var fig = text.charAt(1), body = text.slice(3), strokes = [];
  if (!body) return { fig: fig, strokes: [] };
  var list = body.split('.');
  if (list.length > APP_SKETCH_STROKES) return null;
  for (var i = 0; i < list.length; i++) {
    var bytes = appSketchUnB64(list[i]);
    if (!bytes || bytes.length % 2 || bytes.length < 4 || bytes.length > APP_SKETCH_POINTS * 2) return null;
    var st = [];
    for (var k = 0; k < bytes.length; k += 2) st.push([bytes[k] * APP_SKETCH_W / 255, bytes[k + 1] * APP_SKETCH_H / 255]);
    strokes.push(st);
  }
  return { fig: fig, strokes: strokes };
}
/** A point onto a stroke (a NEW array): kept when at least 2 grid units from the last kept point, 400 points at most. */
function appSketchAddPoint(stroke, x, y) {
  var st = stroke || [], last = st[st.length - 1];
  if (st.length >= APP_SKETCH_POINTS) return st;
  if (last) {
    var dx = x - last[0], dy = y - last[1];
    if (Math.sqrt(dx * dx + dy * dy) < APP_SKETCH_MIN_STEP) return st;
  }
  return st.concat([[x, y]]);
}
/** The strokes without the one the finger touched (the latest drawn within 10 grid units of any of its points). */
function appSketchErase(strokes, x, y) {
  var list = strokes || [];
  for (var i = list.length - 1; i >= 0; i--) {
    for (var k = 0; k < list[i].length; k++) {
      var dx = list[i][k][0] - x, dy = list[i][k][1] - y;
      if (Math.sqrt(dx * dx + dy * dy) <= APP_SKETCH_ERASE_R) return list.slice(0, i).concat(list.slice(i + 1));
    }
  }
  return list.slice();
}
/** The strokes without the last one. */
function appSketchUndo(strokes) { return (strokes || []).slice(0, Math.max(0, (strokes || []).length - 1)); }
/** At most 60 strokes and 4000 characters (SYNC.MEAS_SKETCH_MAX). */
function appSketchFits(fig, strokes) {
  return (strokes || []).length <= APP_SKETCH_STROKES && appSketchEncode(fig, strokes).length <= SYNC.MEAS_SKETCH_MAX;
}

/* ---------- the pad (DOM) ---------- */

/** The figure's outline as SVG markup (from the table only, safe as innerHTML). */
function appSketchSvg(fig) {
  var paths = APP_SKETCH_FIGURES[fig === 'M' ? 'M' : 'F'];
  return '<svg viewBox="0 0 200 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
    paths.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
}
/**
 * The section of the measurement form (built once per form open): the figure toggle, the tools, the pad. F is the
 * measurement form (APP.measForm): F.sketch = {fig, strokes}; F.skDraw (draw mode); F.skTool ('pen' | 'eraser').
 */
function appSketchPad(F) {
  var tt = APP.tt;
  F.skDraw = false;
  F.skTool = 'pen';
  F.skLive = null;
  var sec = appH('div', { class: 'fsketch' });
  sec.appendChild(appH('h3', { text: tt('ui_sketch_title') }));
  F.skFigSeg = appH('div', { class: 'seg' });
  sec.appendChild(F.skFigSeg);
  F.skTools = appH('div', { class: 'sktools' });
  sec.appendChild(F.skTools);
  F.skFig = appH('div', { class: 'skfig' });
  F.skCanvas = appH('canvas', { class: 'skcanvas', 'aria-label': tt('ui_sketch_title') });
  F.skPad = appH('div', { class: 'sketch' }, [F.skFig, F.skCanvas]);
  sec.appendChild(F.skPad);
  appSketchWire(F);
  appSketchPaint(F);
  F.skResize = function () { appSketchFit(F); };
  if (APP.win && APP.win.addEventListener) APP.win.addEventListener('resize', F.skResize);
  if (APP.win && APP.win.setTimeout) APP.win.setTimeout(function () { appSketchFit(F); }, 0);
  return sec;
}
/** The figure toggle and the tools, for the current mode (outside: ဆွဲ and ရှင်း; inside: pen / eraser, undo, OK). */
function appSketchPaint(F) {
  var tt = APP.tt, sk = F.sketch, hot = APP.win ? APP.win.SIM_HOT : undefined;
  var mk = function (f, text, icon, o) {
    o = o || {};
    var a = { type: 'button', 'data-f': f, text: text, class: (o.cls ? o.cls + ' ' : '') + (o.on ? 'on' : '') + (hot === 'f:' + f ? ' hot' : ''), disabled: o.disabled ? 'disabled' : null,
      onclick: function () { appSketchAct(F, f); } };
    return icon ? appHi('button', a, icon) : appH('button', a);
  };
  appClear(F.skFigSeg);
  F.skFigSeg.appendChild(mk('fig:F', tt('ui_sketch_female'), null, { on: sk.fig !== 'M' }));
  F.skFigSeg.appendChild(mk('fig:M', tt('ui_sketch_male'), null, { on: sk.fig === 'M' }));
  appClear(F.skTools);
  if (F.skDraw) {
    F.skTools.appendChild(appH('div', { class: 'seg' }, [mk('sk:pen', tt('ui_sketch_pen'), 'pencil', { on: F.skTool === 'pen' }), mk('sk:eraser', tt('ui_sketch_eraser'), 'eraser', { on: F.skTool === 'eraser' })]));
    F.skTools.appendChild(mk('sk:undo', tt('ui_sketch_undo'), 'arrow-back-up', { disabled: !sk.strokes.length }));
    F.skTools.appendChild(mk('sk:done', tt('ui_w_ok'), null, { cls: 'primary' }));
  } else F.skTools.appendChild(mk('sk:draw', tt('ui_sketch_pen'), 'pencil'));
  if (sk.strokes.length) {
    var clear = mk('sk:clear', tt('ui_btn_clear'), 'trash');
    clear.className = (clear.className ? clear.className + ' ' : '') + 'skclear';
    F.skTools.appendChild(clear);
  }
  F.skFig.innerHTML = appSketchSvg(sk.fig);
  F.skPad.className = 'sketch' + (F.skDraw ? ' drawing' : '');
  appSketchDraw(F);
}
/** A tool or the figure toggle. */
function appSketchAct(F, f) {
  if (APP.measForm !== F) return;
  var sk = F.sketch, changed = false;
  if (f === 'fig:F' || f === 'fig:M') { var g = f.slice(4); if (sk.fig !== g) { sk.fig = g; changed = true; } }
  else if (f === 'sk:draw') { F.skDraw = true; appSketchPaint(F); if (F.skTools && F.skTools.scrollIntoView) { try { F.skTools.scrollIntoView({ block: 'start' }); } catch (ignore) {} } appSketchFit(F); return; }
  else if (f === 'sk:done') { F.skDraw = false; }
  else if (f === 'sk:pen') F.skTool = 'pen';
  else if (f === 'sk:eraser') F.skTool = 'eraser';
  else if (f === 'sk:undo') { if (sk.strokes.length) { sk.strokes = appSketchUndo(sk.strokes); changed = true; } }
  else if (f === 'sk:clear') {
    // The app's own question (the UX review), never confirm(): the strokes go only when the tailor chooses so.
    if (!sk.strokes.length) return;
    appAsk({ kind: 'sketch', title: APP.tt('ui_sketch_clear_ask'), yes: APP.tt('ui_ask_sketch_yes'), no: APP.tt('ui_w_cancel'), danger: true, onYes: function () {
      if (APP.measForm !== F) return;
      sk.strokes = [];
      appSketchPaint(F);
      appMeasChanged(F);
    } });
    return;
  }
  appSketchPaint(F);
  if (changed) appMeasChanged(F);
}
/** Leave the draw mode (Save, back, 🔄, close). */
function appSketchLeave(F) {
  if (!F || !F.skPad || !F.skDraw) return;
  F.skDraw = false;
  F.skLive = null;
  appSketchPaint(F);
}
/**
 * Where the 200 x 300 figure sits inside a w x h box: the outline's svg is drawn "xMidYMid meet", so a box that is not 2:3
 * (the pad's height cap on a short phone, a rotation) letterboxes it. The strokes go through the same scale and offset,
 * so a stroke lands under the finger AND on the outline it was drawn on, whatever the box (checker's fix of step 3).
 */
function appSketchBox(w, h) {
  var s = Math.min(w / APP_SKETCH_W, h / APP_SKETCH_H) || 1;
  return { s: s, ox: (w - APP_SKETCH_W * s) / 2, oy: (h - APP_SKETCH_H * s) / 2 };
}
/** A pointer's position on the figure's box, through the canvas's box read at this event (never a size kept from the open). */
function appSketchPoint(F, e) {
  var r = F.skCanvas.getBoundingClientRect ? F.skCanvas.getBoundingClientRect() : { left: 0, top: 0, width: APP_SKETCH_W, height: APP_SKETCH_H };
  var src = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
  var b = appSketchBox(r.width || APP_SKETCH_W, r.height || APP_SKETCH_H);
  var x = (Number(src.clientX) - r.left - b.ox) / b.s, y = (Number(src.clientY) - r.top - b.oy) / b.s;
  return [Math.max(0, Math.min(APP_SKETCH_W, x)), Math.max(0, Math.min(APP_SKETCH_H, y))];
}
/** Pointer events (touch and mouse as the fallback, the appWireVoice pattern); nothing acts outside draw mode. */
function appSketchWire(F) {
  var c = F.skCanvas;
  var down = function (e) {
    if (!F.skDraw || APP.measForm !== F) return;
    if (e.preventDefault) e.preventDefault();
    var p = appSketchPoint(F, e);
    if (F.skTool === 'eraser') {
      var before = F.sketch.strokes.length;
      F.sketch.strokes = appSketchErase(F.sketch.strokes, p[0], p[1]);
      if (F.sketch.strokes.length !== before) { appSketchPaint(F); appMeasChanged(F); }
      return;
    }
    F.skLive = [p];
    appSketchDraw(F);
  };
  var move = function (e) {
    if (!F.skDraw || !F.skLive) return;
    if (e.preventDefault) e.preventDefault();
    var p = appSketchPoint(F, e);
    F.skLive = appSketchAddPoint(F.skLive, p[0], p[1]);
    appSketchDraw(F);
  };
  var up = function () {
    if (!F.skLive) return;
    var st = F.skLive.length === 1 ? [F.skLive[0], F.skLive[0]] : F.skLive;
    F.skLive = null;
    var next = F.sketch.strokes.concat([st]);
    if (!appSketchFits(F.sketch.fig, next)) { appToast(APP.tt('ui_sketch_full'), true); appSketchDraw(F); return; }
    F.sketch.strokes = next;
    appSketchPaint(F);
    appMeasChanged(F);
  };
  if (APP.win && 'onpointerdown' in APP.win) {
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  } else {
    c.addEventListener('touchstart', down);
    c.addEventListener('touchmove', move);
    c.addEventListener('touchend', up);
    c.addEventListener('mousedown', down);
    c.addEventListener('mousemove', move);
    c.addEventListener('mouseup', up);
  }
}
/** The canvas sized to its box times devicePixelRatio, the strokes drawn again (open, resize, a font-size change). */
function appSketchFit(F) {
  var c = F && F.skCanvas;
  if (!c || !c.getBoundingClientRect) return;
  var r = c.getBoundingClientRect(), dpr = (APP.win && APP.win.devicePixelRatio) || 1;
  if (!r.width || !r.height) return;
  var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  appSketchDraw(F);
}
/** Draw the strokes (and the stroke under the finger) on a 2D context of a w x h canvas, where the outline sits (appSketchBox). */
function appSketchStrokes(ctx, strokes, w, h, width) {
  var b = appSketchBox(w, h), X = function (x) { return b.ox + x * b.s; }, Y = function (y) { return b.oy + y * b.s; };
  ctx.strokeStyle = '#C62828';
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  (strokes || []).forEach(function (st) {
    if (!st || !st.length) return;
    ctx.beginPath();
    ctx.moveTo(X(st[0][0]), Y(st[0][1]));
    for (var i = 1; i < st.length; i++) ctx.lineTo(X(st[i][0]), Y(st[i][1]));
    if (st.length === 1) ctx.lineTo(X(st[0][0]) + 0.01, Y(st[0][1]));
    ctx.stroke();
  });
}
function appSketchDraw(F) {
  var c = F && F.skCanvas, ctx = c && c.getContext ? c.getContext('2d') : null;
  if (!ctx) return;
  var w = c.width || APP_SKETCH_W, h = c.height || APP_SKETCH_H, dpr = (APP.win && APP.win.devicePixelRatio) || 1;
  ctx.clearRect(0, 0, w, h);
  appSketchStrokes(ctx, F.sketch.strokes.concat(F.skLive ? [F.skLive] : []), w, h, 3 * dpr);
}

/* ---------- the PNG (made on the phone, offline; uploaded by the sketch job) ---------- */

/** The page's canvas factory (Node passes none, run_app 69 a stub). */
function appSketchCanvas(w, h) {
  var c = APP.doc.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
/**
 * The drawing as a PNG's base64 ('' without a drawing, a factory or Path2D): white ground, the outline #444 2 px (one
 * Path2D per figure path), the strokes #C62828 3 px; 300 x 450, or 200 x 300 when the data URL passes 80,000 characters.
 */
function appSketchPng(text, makeCanvas) {
  var d = appSketchDecode(text);
  if (!d || !d.strokes.length || typeof makeCanvas !== 'function' || typeof Path2D === 'undefined') return '';
  var render = function (w, h) {
    var c = makeCanvas(w, h), ctx = c && c.getContext ? c.getContext('2d') : null;
    if (!ctx) return '';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.scale(w / APP_SKETCH_W, h / APP_SKETCH_H);
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 2 * APP_SKETCH_W / w;
    APP_SKETCH_FIGURES[d.fig === 'M' ? 'M' : 'F'].forEach(function (p) { ctx.stroke(new Path2D(p)); });
    ctx.restore();
    appSketchStrokes(ctx, d.strokes, w, h, 3);
    return String(c.toDataURL ? c.toDataURL('image/png') : '');
  };
  var url = render(300, 450);
  if (url.length > APP_SKETCH_PNG_MAX) url = render(200, 300);
  var at = url.indexOf('base64,');
  return at >= 0 ? url.slice(at + 7) : '';
}
