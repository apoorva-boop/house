// Generates the PWA icons as real PNGs with a hand-rolled encoder — zlib.deflateSync
// over a raw RGBA pixel buffer, no image library. The art is a flat house silhouette,
// so it does not need anti-aliasing.
//
// Run with `node scripts/make-icons.mjs`. Writes into apps/web/public/.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "apps", "web", "public");

const BG = [47, 111, 79, 255]; // --accent green
const ROOF = [26, 60, 43, 255]; // darker green
const WALL = [247, 245, 240, 255]; // near-white
const DOOR = [26, 60, 43, 255];

let crcTable = null;

function crcTableFor() {
  if (crcTable !== null) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(buf) {
  const table = crcTableFor();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Minimal PNG encoder: one IDAT chunk, filter type 0 (none) on every scanline. */
function encodePng(width, height, pixelAt) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const idat = deflateSync(raw);

  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** A flat house silhouette: a triangular roof over a square wall, one door. */
function houseIcon(x, y, size) {
  const cx = size / 2;
  const roofTop = size * 0.12;
  const eaves = size * 0.42;
  const wallBottom = size * 0.88;
  const wallLeft = size * 0.2;
  const wallRight = size * 0.8;
  const doorLeft = size * 0.44;
  const doorRight = size * 0.56;
  const doorTop = size * 0.68;
  const roofLeftEdge = size * 0.08;
  const roofRightEdge = size * 0.92;

  if (y >= roofTop && y < eaves) {
    const t = (y - roofTop) / (eaves - roofTop);
    const left = cx - t * (cx - roofLeftEdge);
    const right = cx + t * (roofRightEdge - cx);
    return x >= left && x <= right ? ROOF : BG;
  }

  if (y >= eaves && y < wallBottom) {
    if (x >= wallLeft && x <= wallRight) {
      if (x >= doorLeft && x <= doorRight && y >= doorTop) return DOOR;
      return WALL;
    }
    return BG;
  }

  return BG;
}

function writeIcon(name, size) {
  const png = encodePng(size, size, (x, y) => houseIcon(x, y, size));
  const dest = path.join(PUBLIC_DIR, name);
  writeFileSync(dest, png);
  console.log(`wrote ${name} (${String(size)}x${String(size)}, ${String(png.length)} bytes)`);
}

writeIcon("icon-192.png", 192);
writeIcon("icon-512.png", 512);
writeIcon("apple-touch-icon.png", 180);
