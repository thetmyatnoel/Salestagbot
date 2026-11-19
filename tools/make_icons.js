/**
 * tools/make_icons.js — the app icon as PNG placeholders (192 and 512 px) plus the SVG source.
 * No image library: a tiny PNG encoder over Node's zlib. The picture is a white price tag on the
 * indigo accent (#2F3E8F) used everywhere else in the project. Replace with the family's own icon
 * later (the owner decides the Burmese name and icon, plan 14.4); the manifest keeps the file names.
 *
 *   node tools/make_icons.js      -> app/icons/icon-192.png, icon-512.png, icon-maskable-512.png, icon.svg
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'app', 'icons');
const INDIGO = [0x2F, 0x3E, 0x8F], WHITE = [0xFF, 0xFF, 0xFF], SOFT = [0xE3, 0xE7, 0xF7];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Point-in-polygon (even-odd) for the tag shape. */
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Draw at size px with 2x2 supersampling. maskable: no rounded corners (the platform masks it). */
function draw(size, maskable) {
  const out = Buffer.alloc(size * size * 4);
  const s = size / 512;                                  // the design is laid out on a 512 grid
  const radius = 96 * s, pad = maskable ? 0 : 0;
  // Tag: a pentagon pointing right, with a string hole; the knot sits at the top left corner.
  const tag = [[118, 150], [310, 150], [410, 256], [310, 362], [118, 362]].map(p => [p[0] * s, p[1] * s]);
  const hole = [176 * s, 256 * s, 24 * s];
  const stripe = [[232, 230], [340, 230], [340, 282], [232, 282]].map(p => [p[0] * s, p[1] * s]);   // a "price" bar
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const px = x + (sx + 0.5) / 2, py = y + (sy + 0.5) / 2;
      let inSquare = true;
      if (!maskable) {
        const cx = Math.min(Math.max(px, radius + pad), size - radius - pad), cy = Math.min(Math.max(py, radius + pad), size - radius - pad);
        inSquare = (px - cx) * (px - cx) + (py - cy) * (py - cy) <= radius * radius;
      }
      if (!inSquare) continue;
      let c = INDIGO;
      if (inPoly(px, py, tag)) {
        c = WHITE;
        const dx = px - hole[0], dy = py - hole[1];
        if (dx * dx + dy * dy <= hole[2] * hole[2]) c = INDIGO;
        else if (inPoly(px, py, stripe)) c = SOFT;
      }
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const o = (y * size + x) * 4;
    out[o] = Math.round(r / 4); out[o + 1] = Math.round(g / 4); out[o + 2] = Math.round(b / 4); out[o + 3] = Math.round(a / 4);
  }
  return png(size, size, out);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#2F3E8F"/>
  <path d="M118 150h192l100 106-100 106H118z" fill="#FFFFFF"/>
  <circle cx="176" cy="256" r="24" fill="#2F3E8F"/>
  <rect x="232" y="230" width="108" height="52" rx="8" fill="#E3E7F7"/>
</svg>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-192.png'), draw(192, false));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), draw(512, false));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), draw(512, true));
fs.writeFileSync(path.join(OUT, 'icon.svg'), SVG);
console.log('wrote app/icons/icon-192.png, icon-512.png, icon-maskable-512.png, icon.svg');
