// t9 programmatic pixel probes (no deps). Decodes 8-bit RGB/RGBA PNG via node:zlib,
// evaluates the six acceptance probes (a-f) on shots/verify-sol.png / verify-cygnus.png.
// Revised criteria (captain decision after t7): all 3D checks normalized to the
// viewport canvas (shots/geom.json canvasRect), not the full screenshot.
// Usage: node scripts/probe.mjs

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIR = fileURLToPath(new URL('../shots/', import.meta.url));
const DARK = 110; // R < DARK => dark pixel

// ---------- minimal PNG decoder (8-bit, colorType 2 RGB / 6 RGBA, filters 0-4) ----------
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

// ---------- image helpers ----------
const darkAt = (img, x, y) => img.px[(y * img.width + x) * img.bpp] < DARK;
const lumAt = (img, x, y) => {
  const i = (y * img.width + x) * img.bpp;
  return 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
};

function bandRatios(img, x0, x1, yFrom, yTo) {
  // per-row dark ratio over band [x0, x1] for rows yFrom..yTo-1
  const w = x1 - x0 + 1;
  const out = [];
  for (let y = yFrom; y < yTo; y++) {
    let n = 0;
    for (let x = x0; x <= x1; x++) if (darkAt(img, x, y)) n++;
    out.push(n / w);
  }
  return out;
}

function largestRun(ratios, threshold) {
  let best = null;
  let cur = null;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] > threshold) {
      if (!cur) cur = [i, i];
      else cur[1] = i;
      if (!best || cur[1] - cur[0] > best[1] - best[0]) best = [cur[0], cur[1]];
    } else cur = null;
  }
  return best; // [startIdx, endIdx] relative, or null
}

// ---------- load ----------
const geom = JSON.parse(readFileSync(join(DIR, 'geom.json'), 'utf8'));
const cr = geom.canvasRect;
if (!cr) { console.error('FATAL: no canvasRect in geom.json'); process.exit(2); }
const sol = decodePng(join(DIR, 'verify-sol.png'));
const cyg = decodePng(join(DIR, 'verify-cygnus.png'));
console.log(`verify-sol.png     ${sol.width}x${sol.height} bpp=${sol.bpp}`);
console.log(`verify-cygnus.png  ${cyg.width}x${cyg.height} bpp=${cyg.bpp}`);
console.log(`canvas rect (screenshot px): x=${cr.x} y=${cr.y} w=${cr.w} h=${cr.h}`);
if (sol.width !== 1440 || sol.height !== 820) console.log('NOTE: screenshot is not 1440x820.');

const VH = cr.h; // viewport height (normalization denominator per t9 criteria)
const cy = cr.y + cr.h; // canvas bottom (exclusive)
const cx = Math.round(cr.x + cr.w / 2);
const x0 = cx - 40, x1 = cx + 39;
const vq = (rowY) => (rowY - cr.y) / VH; // viewport-normalized y
console.log(`band: x=${x0}..${x1} (viewport center cx=${cx}, ±40px)\n`);

const results = [];
const check = (id, desc, value, ok, detail = '') => {
  results.push({ id, desc, value, ok });
  console.log(`[${id}] ${desc}\n     measured: ${value}${detail ? ' | ' + detail : ''}\n     => ${ok ? 'PASS' : 'FAIL'}`);
};

// ---- a) SOL canvas non-blank: viewport region x[40%,60%] y[20%,70%], dark ratio > 0.5% ----
{
  const rx0 = Math.round(cr.x + 0.4 * cr.w), rx1 = Math.round(cr.x + 0.6 * cr.w);
  const ry0 = Math.round(cr.y + 0.2 * cr.h), ry1 = Math.round(cr.y + 0.7 * cr.h);
  let n = 0, tot = 0;
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) { tot++; if (darkAt(sol, x, y)) n++; }
  const r = n / tot;
  check('a', 'SOL 画布非空白 (视口内 x40-60%,y20-70% 暗像素占比)', `${(r * 100).toFixed(2)}%  (要求 > 0.5%)`, r > 0.005, `region x${rx0}-${rx1} y${ry0}-${ry1}`);
}

// ---- b) CYGNUS funnel exits bottom [new]: lowest dark row in band, (y-canvasY)/canvasH > 0.985 ----
{
  const full = bandRatios(cyg, x0, x1, cr.y, cy);
  let lastDark = -1;
  for (let i = 0; i < full.length; i++) if (full[i] > 0) lastDark = i;
  const q = lastDark < 0 ? 0 : vq(cr.y + lastDark);
  const last30 = (() => { for (let i = full.length - 1; i >= 0; i--) if (full[i] > 0.3) return i; return -1; })();
  const prof = [];
  for (let i = full.length - 20; i < full.length; i += 2) prof.push(`y${cr.y + i}:${(full[i] * 100).toFixed(0)}%`);
  check('b', 'CYGNUS 漏斗穿出底边 (band 最下暗行 / 视口高)', `${q.toFixed(4)}  (要求 > 0.985)`, q > 0.985,
    `最下暗行 y=${lastDark < 0 ? '无' : cr.y + lastDark}; 最后 >30% 行 y=${last30 < 0 ? '无' : cr.y + last30} (${last30 < 0 ? '' : vq(cr.y + last30).toFixed(3)}); 底20行轮廓: ${prof.join(' ')}`);
}

// ---- c) CYGNUS sphere dense-block center, (y-canvasY)/canvasH in [0.72, 0.95] ----
{
  const ratios = bandRatios(cyg, x0, x1, cr.y, cy);
  const run = largestRun(ratios, 0.45);
  if (run) {
    const start = cr.y + run[0], end = cr.y + run[1];
    const q = vq((start + end) / 2);
    check('c', 'CYGNUS 球体稠密块中心 y/视口高', `${q.toFixed(4)}  (rows ${start}..${end}, 要求 0.72~0.95)`, q >= 0.72 && q <= 0.95);
  } else {
    let mi = 0;
    for (let i = 1; i < ratios.length; i++) if (ratios[i] > ratios[mi]) mi = i;
    check('c', 'CYGNUS 球体稠密块中心 y/视口高', `无 >45% 连续行 (band 内最大单行占比 ${(ratios[mi] * 100).toFixed(1)}% @ y=${cr.y + mi})`, false);
  }
}

// ---- d) CYGNUS rim: first row from canvas top with band dark ratio > 15%, (y-canvasY)/canvasH in [0.18, 0.42] ----
{
  const ratios = bandRatios(cyg, x0, x1, cr.y, cy);
  const i = ratios.findIndex((r) => r > 0.15);
  if (i >= 0) {
    const q = vq(cr.y + i);
    check('d', 'CYGNUS 漏斗口 rim 首行 y/视口高', `${q.toFixed(4)}  (y=${cr.y + i}, ratio ${(ratios[i] * 100).toFixed(1)}%, 要求 0.18~0.42)`, q >= 0.18 && q <= 0.42);
  } else {
    check('d', 'CYGNUS 漏斗口 rim 首行 y/视口高', '无 >15% 行', false);
  }
}

// ---- e) heatmap brightness ratio in [0.75, 1.15] (screenshot-absolute rect, unchanged) ----
{
  const avgLum = (img) => {
    let s = 0, n = 0;
    for (let y = 680; y < 770; y++) for (let x = 1150; x < 1400; x++) { s += lumAt(img, x, y); n++; }
    return s / n;
  };
  const Ls = avgLum(sol), Lc = avgLum(cyg);
  const ratio = Lc / Ls;
  check('e', '热图亮度 L_cygnus/L_sol', `${ratio.toFixed(3)}  (L_sol=${Ls.toFixed(1)}, L_cygnus=${Lc.toFixed(1)}, 要求 0.75~1.15)`, ratio >= 0.75 && ratio <= 1.15);
}

// ---- f) SOL sphere [new]: band rows with ratio>12% inside y[30%,75%] viewport;
//         centroid y / viewport height in [0.38, 0.62] ----
{
  const wFrom = Math.round(cr.y + 0.3 * cr.h);
  const wTo = Math.round(cr.y + 0.75 * cr.h);
  const ratios = bandRatios(sol, x0, x1, wFrom, wTo);
  let sw = 0, sn = 0, cnt = 0, su = 0;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] > 0.12) {
      const rowY = wFrom + i;
      sw += ratios[i] * rowY;
      sn += ratios[i];
      su += rowY;
      cnt++;
    }
  }
  if (cnt === 0) {
    check('f', 'SOL 球体质心(>12%行) y/视口高', `窗口内无 >12% 行 (window y${wFrom}..${wTo})`, false);
  } else {
    const centroidW = sw / sn;
    const centroidU = su / cnt;
    const q = vq(centroidW);
    check('f', 'SOL 球体质心(>12%行,按暗占比加权) y/视口高', `${q.toFixed(4)}  (${cnt} 行, 要求 0.38~0.62)`, q >= 0.38 && q <= 0.62,
      `加权质心 y=${centroidW.toFixed(0)}; 参考: 未加权行均值 ${vq(centroidU).toFixed(4)}`);
    // diagnostics
    let mi = 0;
    for (let i = 1; i < ratios.length; i++) if (ratios[i] > ratios[mi]) mi = i;
    const prof = [];
    for (let i = 0; i < ratios.length; i += 8) prof.push(`y${wFrom + i}:${(ratios[i] * 100).toFixed(0)}%`);
    console.log(`     diag(f): 窗口内最大单行 ${(ratios[mi] * 100).toFixed(1)}% @ y=${wFrom + mi} | 轮廓(每8行): ${prof.join(' ')}`);
  }
}

const passCount = results.filter((r) => r.ok).length;
console.log(`\n=== OVERALL: ${passCount}/6 项达标 => ${passCount === 6 ? 'PASS' : 'FAIL'} ===`);
process.exitCode = passCount === 6 ? 0 : 1;
