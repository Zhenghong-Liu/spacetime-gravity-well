// 6 个天体截图的「平面可见性」数值检查（无依赖，PNG 解码器仿 scripts/diff_t1.mjs）。
// 用法: node scripts/check_plane.mjs  → 读取 shots/body-1.png .. shots/body-6.png。
//
// 方法：
//   - 中央 stage 矩形取固定 275,91,852×689（1440×820 窗口下与 shot_all.mjs 截屏一致）。
//   - 背景底色亮度 bgLum 由 stage 矩形四角 5×5 采样取中位数估计（纸底/雾底）。
//   - 「墨色像素」= 亮度 < bgLum - 40 的像素（网格线/球线框/尘埃等显著暗于底色者）。
//   - inkRatio   = 墨色像素占比。
//   - rowCoverage = 墨色像素 ≥15 个的行占全部行的比例（平面/漏斗/球在竖直方向铺开）。
//
// 判定阈值（本脚本自定，输出中写明）：
//   inkRatio ≥ 3% 且 rowCoverage ≥ 25%  → pass（6 个全 pass 才算过，exit 0）。

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../shots/', import.meta.url));
const FRAME = { w: 1440, h: 820 };
const STAGE = { x: 275, y: 91, w: 852, h: 689 };
const INK_DLT = 40; // 墨色判定：亮度低于底色 bgLum - 40
const ROW_MIN_INK = 15; // 一行内至少 15 个墨色像素才算「有内容」
const PASS_INK = 0.03;
const PASS_ROWS = 0.25;

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

const lumAt = (img, x, y) => {
  const i = (y * img.width + x) * img.bpp;
  return 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
};

let allPass = true;
const rows = [];
for (let n = 1; n <= 6; n++) {
  const img = decodePng(DIR + `/body-${n}.png`);
  if (img.width !== FRAME.w || img.height !== FRAME.h) {
    console.error(`body-${n}: frame ${img.width}×${img.height} != expected ${FRAME.w}×${FRAME.h}`);
    allPass = false;
    rows.push({ n, bgLum: null, inkRatio: null, rowCoverage: null, pass: false });
    continue;
  }
  const x0 = Math.max(0, STAGE.x), y0 = Math.max(0, STAGE.y);
  const x1 = Math.min(img.width, STAGE.x + STAGE.w), y1 = Math.min(img.height, STAGE.y + STAGE.h);

  // 四角 5×5 采样估计底色亮度
  const corner = (cx, cy) => {
    const s = [];
    for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) s.push(lumAt(img, cx + dx, cy + dy));
    return s.sort((a, b) => a - b)[2];
  };
  const bgLum = [corner(x0 + 4, y0 + 4), corner(x1 - 9, y0 + 4), corner(x0 + 4, y1 - 9), corner(x1 - 9, y1 - 9)].sort((a, b) => a - b)[2];
  const thresh = bgLum - INK_DLT;

  let ink = 0, total = 0;
  const rowInk = new Uint32Array(y1 - y0);
  for (let y = y0; y < y1; y++) {
    let ri = 0;
    for (let x = x0; x < x1; x++) {
      total++;
      if (lumAt(img, x, y) < thresh) {
        ink++;
        ri++;
      }
    }
    rowInk[y - y0] = ri;
  }
  const inkRatio = ink / total;
  let goodRows = 0;
  for (let i = 0; i < rowInk.length; i++) if (rowInk[i] >= ROW_MIN_INK) goodRows++;
  const rowCoverage = goodRows / rowInk.length;
  const pass = inkRatio >= PASS_INK && rowCoverage >= PASS_ROWS;
  allPass = allPass && pass;
  rows.push({ n, bgLum, inkRatio, rowCoverage, pass });
}

console.log(`stage rect: x=${STAGE.x} y=${STAGE.y} ${STAGE.w}×${STAGE.h}px @ ${FRAME.w}×${FRAME.h}`);
console.log(`ink rule: lum < bgLum - ${INK_DLT}; row rule: row ink >= ${ROW_MIN_INK}px`);
console.log(`pass rule: inkRatio >= ${(PASS_INK * 100).toFixed(1)}% AND rowCoverage >= ${(PASS_ROWS * 100).toFixed(0)}%  (6/6 pass 才算过)\n`);
for (const r of rows) {
  if (r.inkRatio === null) {
    console.log(`body-${r.n}: FAIL (frame size mismatch)`);
    continue;
  }
  console.log(
    `body-${r.n}: bgLum=${r.bgLum.toFixed(0)}  inkRatio=${(r.inkRatio * 100).toFixed(2)}%  rowCoverage=${(r.rowCoverage * 100).toFixed(1)}%  → ${r.pass ? 'PASS' : 'FAIL'}`
  );
}
console.log(allPass ? '\nRESULT: 6/6 PASS' : '\nRESULT: NOT ALL PASS');
process.exitCode = allPass ? 0 : 1;
