// Renders the PWA PNG icons (public/icon-web.svg: teal/green, so the web app is
// easy to tell apart from the blue/violet desktop app in the taskbar) and the
// desktop source PNG (public/icon.svg) without any image tooling: signed-distance shapes, 4x4
// supersampling, raw PNG encoding.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (size, rgba) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// Shapes in the 512-unit design space.
const roundRect = (x, y, r) => {
  const qx = Math.abs(x - 256) - (256 - r), qy = Math.abs(y - 256) - (256 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
// magic-* icon family: rounded tile, diagonal gradient, white photo glyph and a
// yellow sparkle (the shared "magic" mark), as in public/icon.svg.
const inPolygon = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// Rounded box given by its corners, as a signed distance.
const box = (x, y, x0, y0, x1, y1, r) => {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r), qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
// Four-point star with the SVG's quadratic edges: sqrt|u| + sqrt|v| <= 1.
const sparkle = (x, y, cx, cy, r) =>
  Math.sqrt(Math.abs(x - cx) / r) + Math.sqrt(Math.abs(y - cy) / r) <= 1;
const mountain = [[116, 388], [216, 268], [284, 340], [330, 292], [396, 388]];
const DESKTOP = [[59, 130, 246], [124, 58, 237]]; // blue -> violet
const WEB = [[20, 184, 166], [22, 163, 74]]; // teal -> green, to tell the web app apart

function sample(x, y, maskable, [from, to]) {
  // maskable icons need a full-bleed background and content in the safe zone
  if (maskable) { const k = 0.8; x = 256 + (x - 256) / k; y = 256 + (y - 256) / k; }
  const inside = maskable || roundRect(x, y, 112) <= 0;
  if (!inside) return [0, 0, 0, 0];
  const t = Math.max(0, Math.min(1, (x + y) / 1024));
  let c = from.map((v, i) => v + (to[i] - v) * t);
  const frame = box(x, y, 68, 156, 444, 436, 44) <= 0 && box(x, y, 100, 188, 412, 404, 12) > 0;
  if (frame || inPolygon(x, y, mountain) || Math.hypot(x - 196, y - 234) <= 24) c = [255, 255, 255];
  if (sparkle(x, y, 404, 112, 66)) c = [250, 204, 21];
  return [...c, 255];
}

function render(size, colors, maskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4, scale = 512 / size;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const s = sample((px + (sx + 0.5) / ss) * scale, (py + (sy + 0.5) / ss) * scale, maskable, colors);
      acc[0] += s[0] * s[3]; acc[1] += s[1] * s[3]; acc[2] += s[2] * s[3]; acc[3] += s[3];
    }
    const i = (py * size + px) * 4;
    buf[i + 3] = Math.round(acc[3] / (ss * ss));
    for (let k = 0; k < 3; k++) buf[i + k] = acc[3] ? Math.round(acc[k] / acc[3]) : 0;
  }
  return png(size, buf);
}

writeFileSync('public/icon-192.png', render(192, WEB));
writeFileSync('public/icon-512.png', render(512, WEB));
writeFileSync('public/icon-maskable-512.png', render(512, WEB, true));
// Source for the desktop app icons: npx tauri icon src-tauri/icons/source-1024.png
writeFileSync('src-tauri/icons/source-1024.png', render(1024, DESKTOP));
console.log('icons written');
