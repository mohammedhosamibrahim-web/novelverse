'use strict';

/**
 * Generates the PWA app icons (192/512 PNG) with zero native dependencies.
 * Run: node scripts/gen-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function hex2rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Draw an icon: dark gradient background + stylized open book. */
function drawIcon(size) {
  const top = hex2rgb('#1e293b');
  const bottom = hex2rgb('#0b0f19');
  const page = hex2rgb('#e2e8f0');
  const accent = hex2rgb('#818cf8');

  const raw = Buffer.alloc(size * (size * 4 + 1));
  const rowStride = size * 4 + 1;
  const cx = size / 2;

  for (let y = 0; y < size; y++) {
    raw[y * rowStride] = 0; // filter: none
    const t = y / size;
    const bg = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
    ];
    for (let x = 0; x < size; x++) {
      const o = y * rowStride + 1 + x * 4;
      // rounded corner mask
      const r = size * 0.18;
      const corner = Math.max(Math.abs(x - cx) - (cx - r), 0) ** 2 + Math.max(Math.abs(y - cx) - (cx - r), 0) ** 2;
      if (corner > r * r) {
        raw[o] = 0; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = 0;
        continue;
      }
      raw[o + 3] = 255;
      let color = bg;

      // book: two pages + spine
      const bookTop = size * 0.24;
      const bookBottom = size * 0.76;
      const spine = cx + size * 0.012;
      const halfW = size * 0.22;
      if (y > bookTop && y < bookBottom) {
        const tilt = (y - bookTop) / (bookBottom - bookTop) * size * 0.05;
        if (x > spine - halfW && x < spine + halfW) {
          // within book
          const leftDist = x < spine ? (spine - x) / halfW : 0;
          const rightDist = x >= spine ? (x - spine) / halfW : 0;
          const edge = x < spine ? leftDist : rightDist;
          const shade = 1 - edge * 0.35 - (x < spine ? 0.18 : 0.05);
          // spine line
          if (Math.abs(x - spine) < size * 0.012) {
            color = [accent[0], accent[1], accent[2]];
          } else {
            color = [
              Math.min(255, Math.round(page[0] * shade)),
              Math.min(255, Math.round(page[1] * shade)),
              Math.min(255, Math.round(page[2] * shade)),
            ];
          }
          // page separation lines
          const line = size * 0.055;
          if (Math.abs((y - bookTop) % line) < size * 0.008 && edge < 0.8) {
            color = [Math.round(color[0] * 0.75), Math.round(color[1] * 0.75), Math.round(color[2] * 0.75)];
          }
          // tilt shading for open book shape
          const tiltShade = (x < spine ? (spine - x) / halfW : (x - spine) / halfW);
          color = [
            Math.round(color[0] * (0.9 + tiltShade * 0.15)),
            Math.round(color[1] * (0.9 + tiltShade * 0.15)),
            Math.round(color[2] * (0.9 + tiltShade * 0.15)),
          ];
        }
      }
      raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'client', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`generated ${file}`);
}
