// t1 表盘区域两帧像素对比（无依赖，复用 probe.mjs 的 PNG 解码器）。
// 用法: node scripts/diff_t1.mjs  → 读取 shots/t1-dial-rect.json，
// 比较 shots/t1-a.png / shots/t1-b.png 中表盘区域，输出变化像素占比。
// 判定: 变化像素占比 > 0.5% 视为「各环层与中央 C 形位置明显变化」。

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../shots/', import.meta.url));

function decodePng(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG: ' + path);
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType}): ${path}`);
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (stride + 1)) throw new Error(`raw size mismatch in ${path}: ${raw.length} != ${height * (stride + 1)}`);
  const px = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) v = (v + paeth(a, b, c)) & 255;
      out[x] = v;
    }
  }
  return { width, height, px, bpp };
}

const rect = JSON.parse(readFileSync(DIR + '/t1-dial-rect.json'));
const x0 = Math.max(0, Math.round(rect.x));
const y0 = Math.max(0, Math.round(rect.y));
const x1 = Math.min(1440, Math.round(rect.x + rect.w));
const y1 = Math.min(820, Math.round(rect.y + rect.h));

const A = decodePng(DIR + '/t1-a.png');
const B = decodePng(DIR + '/t1-b.png');
if (A.width !== B.width || A.height !== B.height || A.bpp !== B.bpp) {
  throw new Error('frame size/bpp mismatch');
}

const THRESH = 12; // 亮度差阈值（抗压缩噪声/抗锯齿抖动）
let changed = 0, total = 0;
for (let y = y0; y < y1; y++) {
  for (let x = x0; x < x1; x++) {
    const ia = (y * A.width + x) * A.bpp;
    const ib = (y * B.width + x) * B.bpp;
    const la = 0.2126 * A.px[ia] + 0.7152 * A.px[ia + 1] + 0.0722 * A.px[ia + 2];
    const lb = 0.2126 * B.px[ib] + 0.7152 * B.px[ib + 1] + 0.0722 * B.px[ib + 2];
    total++;
    if (Math.abs(la - lb) > THRESH) changed++;
  }
}
const pct = (100 * changed) / total;
console.log(`dial region: x=${x0} y=${y0} → ${x1}×${y1} (${x1 - x0}×${y1 - y0}px)`);
console.log(`changed pixels: ${changed}/${total} = ${pct.toFixed(2)}% (threshold Δlum>12)`);
console.log(pct > 0.5 ? 'PASS: 表盘区域 1s 内明显变化' : 'FAIL: 变化不明显');
process.exitCode = pct > 0.5 ? 0 : 1;
