// t2 两帧像素 diff（无依赖，内置 PNG 解码，仿 diff_t1.mjs）。
// 读取 shots/wave-rect.json + wave-a/b/c/d.png，分别计算:
//   SOL   : (a,b) 在 stage 矩形内的变化像素占比
//   CYGNUS: (c,d) 在 stage 矩形内的变化像素占比
// 判定: 占比 >= 1% → PASS（波浪+尘埃+方块/吸入综合动效明显）;
//       0.5% <= 占比 < 1% → WARN（有动效但低于预期）;
//       < 0.5% → FAIL（画面基本静止，粒子/波浪动画可能死了）。
// 用法: node scripts/diff_wave.mjs

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
    const out = px.subarray(y * stride, y * stride + stride);
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

const rect = JSON.parse(readFileSync(DIR + 'wave-rect.json', 'utf8'));
const x0 = Math.max(0, Math.round(rect.x));
const y0 = Math.max(0, Math.round(rect.y));
const A = decodePng(DIR + 'wave-a.png');
const B = decodePng(DIR + 'wave-b.png');
const C = decodePng(DIR + 'wave-c.png');
const D = decodePng(DIR + 'wave-d.png');
const W = A.width, H = A.height;
const x1 = Math.min(W, Math.round(rect.x + rect.w));
const y1 = Math.min(H, Math.round(rect.y + rect.h));

const THRESH = 12; // 亮度差阈值（抗压缩噪声/抗锯齿抖动）

function diffPair(name, X, Y, labelX, labelY) {
  if (X.width !== Y.width || X.height !== Y.height || X.bpp !== Y.bpp) {
    throw new Error(`frame size/bpp mismatch in pair ${name}`);
  }
  let changed = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * X.width + x) * X.bpp;
      const la = 0.2126 * X.px[i] + 0.7152 * X.px[i + 1] + 0.0722 * X.px[i + 2];
      const lb = 0.2126 * Y.px[i] + 0.7152 * Y.px[i + 1] + 0.0722 * Y.px[i + 2];
      total++;
      if (Math.abs(la - lb) > THRESH) changed++;
    }
  }
  const pct = (100 * changed) / total;
  const verdict = pct >= 1.0 ? 'PASS' : pct >= 0.5 ? 'WARN' : 'FAIL';
  console.log(`\n[${name}] ${labelX} vs ${labelY}  stage 矩形 [${x0},${y0} → ${x1},${y1}] (${x1 - x0}x${y1 - y0}px)`);
  console.log(`  变化像素: ${changed}/${total} = ${pct.toFixed(2)}%  (Δlum>${THRESH})`);
  console.log(`  => ${verdict}${verdict === 'PASS' ? '（动效明显，符合预期 ≳1%）' : verdict === 'WARN' ? '（有动效但低于 ≳1% 预期）' : '（画面基本静止，动画疑似死了）'}`);
  return pct >= 1.0;
}

const solOk = diffPair('SOL', A, B, 'wave-a', 'wave-b');
const cygOk = diffPair('CYGNUS', C, D, 'wave-c', 'wave-d');

console.log(`\n=== OVERALL: ${solOk && cygOk ? 'PASS (两组均 >= 1%)' : solOk || cygOk ? 'PARTIAL (一组 < 1%)' : 'FAIL (两组均 < 0.5% 附近)'} ===`);
process.exitCode = solOk && cygOk ? 0 : 1;
