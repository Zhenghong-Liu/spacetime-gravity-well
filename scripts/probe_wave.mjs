// t2 粒子系统逐组活性探针（无依赖，内置 PNG 解码）。
// 在 shot_wave.mjs 产物上按区域归因，回答「变的是不是粒子」:
//   S1 SOL 天空带 diff (a,b)      —— 地平线上方只有尘埃漂移，尘埃死则 ≈0
//   S2 SOL 9px 方块跨帧匹配 (a,b) —— 9x9 实心行判据 + 地平线收敛带/球盘排除，
//                                    贴地方块位移统计（匹配位移≥5px 且无静止匹配 = 漂移活）
//   C1 CYGNUS 天空带 diff (c,d)   —— 尘埃
//   C2 CYGNUS 全 stage 排除 天空带∪杯口盘∪球盘 的残余 diff (c,d)
//      —— 该区域唯一动效来源是吸入螺旋粒子（块 opacity 0.05 低于 Δlum 阈值、尘埃在天空带）
// 用法: node scripts/probe_wave.mjs

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
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG: ${path}`);
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (stride + 1)) throw new Error(`raw size mismatch in ${path}`);
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
const X0 = Math.max(0, Math.round(rect.x));
const Y0 = Math.max(0, Math.round(rect.y));
const A = decodePng(DIR + 'wave-a.png');
const B = decodePng(DIR + 'wave-b.png');
const C = decodePng(DIR + 'wave-c.png');
const D = decodePng(DIR + 'wave-d.png');
const W = A.width, H = A.height;
const X1 = Math.min(W, Math.round(rect.x + rect.w));
const Y1 = Math.min(H, Math.round(rect.y + rect.h));
const SW = X1 - X0, SH = Y1 - Y0;
const THRESH = 12;

const lum = (img, x, y) => {
  const i = (y * img.width + x) * img.bpp;
  return 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
};
const L = (img) => {
  const out = new Float32Array(img.width * img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) out[y * img.width + x] = lum(img, x, y);
  return out;
};
const LA = L(A), LB = L(B), LC = L(C), LD = L(D);

let fails = 0;
const check = (id, desc, value, ok, detail = '') => {
  console.log(`\n[${id}] ${desc}\n     measured: ${value}${detail ? '\n     ' + detail : ''}\n     => ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fails++;
};

/* ---- 区域定义（stage 归一化坐标，布局来自 CenterStage.css / 参考图实测） ---- */
// 天空带：地平线（≈27% stage 高）以上；尘埃的世界坐标 z∈[-36,-2]（远侧）、y∈[0.3,8.2]，只投影进这条带
const skyTop = Math.round(Y0 + 0.04 * SH);
const skyBot = Math.round(Y0 + 0.26 * SH);
// 地平线收敛带：y ∈ [26%,36%] stage 高 —— 远场网格线在此以 3px 级间距密集交汇，
// 任意 9x9 窗口都会「实心」，方块检测必须整体排除（代价：最远一两个贴块可能漏检）
const horizonBot = Math.round(Y0 + 0.36 * SH);
// SOL 球盘：中心 (50%,42%)、直径 ≈250px（参考图实测）
const solBall = { cx: X0 + 0.5 * SW, cy: Y0 + 0.42 * SH, r: 140 };
// CYGNUS 杯口盘：世界原点投影 ≈(50%, 33%)，r≈2.4u ≈ 95px；球盘中心 (50%,80%)、直径 ≈28px
const cygCup = { cx: X0 + 0.5 * SW, cy: Y0 + 0.33 * SH, r: 95 };
const cygBall = { cx: X0 + 0.5 * SW, cy: Y0 + 0.8 * SH, r: 55 };

const inSky = (y) => y >= skyTop && y < skyBot;
const inDisk = (x, y, d) => (x - d.cx) ** 2 + (y - d.cy) ** 2 <= d.r * d.r;
// HUD 文字层（headline 左上 / readouts 右上 / engine 底栏 / 角标）—— 方块检测需排除
const inHud = (x, y) =>
  (x >= X0 + 8 && x <= X0 + 320 && y >= Y0 + 8 && y <= Y0 + 125) ||
  (x >= X1 - 330 && x <= X1 - 8 && y >= Y0 + 8 && y <= Y0 + 130) ||
  (y >= Y1 - 90);

/* ---- S1: SOL 天空带 diff（尘埃专属区域） ---- */
{
  let changed = 0, total = 0;
  for (let y = skyTop; y < skyBot; y++)
    for (let x = X0 + 8; x < X1 - 8; x++) {
      if (inDisk(x, y, solBall)) continue;
      const i = y * W + x;
      total++;
      if (Math.abs(LA[i] - LB[i]) > THRESH) changed++;
    }
  const pct = (100 * changed) / total;
  check('S1', 'SOL 尘埃漂移（天空带两帧 diff，尘埃是唯一动效源）',
    `${changed}/${total} = ${pct.toFixed(2)}%`,
    pct > 0.05,
    `尘埃速度 ±0.12u/s × 1.8s ≈ ±1-2px，250 点散布天空带；尘埃死则应 ≈0`);
}

/* ---- S2: SOL 9px 方块跨帧匹配（贴地方块） ----
 * 方块 = 9x9 像素方点（PointsMaterial size:9, sizeAttenuation:false, 0x2c312a, opacity 0.5）。
 * 亮纸上混合后 L≈130，与网格线（L≈132）接近；识别用「实心行」判据：9x9 窗口内
 * 连续 ≥6 行每行 ≥8/9 像素 <150（真方块≈9 行实心；地平线收敛带/球缘线网的实心行 ≤5，
 * 且这两处已被 horizonBot 排除带 + solBall 排除盘剔除）。
 * 位移判据：设计速度 0.3-0.8u/s × 1.8s = 0.54-1.44u，各深度 1u≈24-75px → 预期 ~10-110px。 */
{
  const detect = (Lm) => {
    const M = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) M[i] = Lm[i] < 150 ? 1 : 0;
    const rowsSolid = (x0, y0) => {
      let best = 0, run = 0;
      for (let y = y0; y < y0 + 9; y++) {
        let k = 0;
        for (let x = x0; x < x0 + 9; x++) k += M[y * W + x];
        run = k >= 8 ? run + 1 : 0;
        if (run > best) best = run;
      }
      return best;
    };
    const seeds = [];
    for (let y = horizonBot; y < Y1 - 12; y += 3)
      for (let x = X0 + 4; x < X1 - 12; x += 3) {
        if (inDisk(x + 4, y + 4, solBall) || inHud(x + 4, y + 4)) continue;
        let best = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const r = rowsSolid(x + dx, y + dy);
            if (r > best) best = r;
          }
        if (best >= 6) seeds.push({ x: x + 4, y: y + 4, rows: best });
      }
    const blobs = [];
    for (const s of seeds) {
      const near = blobs.find((b) => Math.hypot(b.x - s.x, b.y - s.y) < 14);
      if (near) { if (s.rows > near.rows) near.rows = s.rows; }
      else blobs.push({ ...s });
    }
    return blobs;
  };
  const bA = detect(LA), bB = detect(LB);
  const matches = [];
  for (const bb of bB) {
    let best = null;
    for (const ba of bA) {
      const d = Math.hypot(bb.x - ba.x, bb.y - ba.y);
      if (d <= 90 && (!best || d < best.d)) best = { d, ba };
    }
    matches.push({ b: bb, a: best ? best.ba : null, d: best ? best.d : null });
  }
  const matched = matches.filter((m) => m.a);
  const moved = matched.filter((m) => m.d >= 5);
  const statics = matched.filter((m) => m.d < 2);
  const ds = matched.map((m) => m.d.toFixed(1)).join(' / ');
  check('S2', 'SOL 贴地方块漂移（9x9 实心行跨帧匹配）',
    `A 帧 ${bA.length} 候选 / B 帧 ${bB.length} 候选; 匹配 ${matched.length}, 位移≥5px: ${moved.length}, 静止(<2px): ${statics.length}; 位移(px): ${ds || '—'}`,
    bA.length >= 1 && bB.length >= 1 && matched.length >= 1 && moved.length >= 1 && statics.length === 0,
    `设计速度 0.3-0.8u/s × 1.8s = 0.54-1.44u，1u≈24-75px → 预期位移 ~10-110px; 匹配到静止方块=该块死（已排除地平线收敛带与球盘）`);
}

/* ---- C1: CYGNUS 天空带 diff（尘埃） ---- */
{
  let changed = 0, total = 0;
  for (let y = skyTop; y < skyBot; y++)
    for (let x = X0 + 8; x < X1 - 8; x++) {
      if (inDisk(x, y, cygBall)) continue;
      const i = y * W + x;
      total++;
      if (Math.abs(LC[i] - LD[i]) > THRESH) changed++;
    }
  const pct = (100 * changed) / total;
  check('C1', 'CYGNUS 尘埃漂移（天空带两帧 diff）',
    `${changed}/${total} = ${pct.toFixed(2)}%`,
    pct > 0.05,
    `CYGNUS dustOpacity 0.75；尘埃死则应 ≈0`);
}

/* ---- C2: CYGNUS 残余中场 diff（排除天空带/杯口盘/球盘/HUD）→ 吸入螺旋 ---- */
{
  let changed = 0, total = 0;
  for (let y = Y0 + 2; y < Y1 - 2; y++)
    for (let x = X0 + 2; x < X1 - 2; x++) {
      if (inSky(y) || inDisk(x, y, cygCup) || inDisk(x, y, cygBall) || inHud(x, y)) continue;
      const i = y * W + x;
      total++;
      if (Math.abs(LC[i] - LD[i]) > THRESH) changed++;
    }
  const pct = (100 * changed) / total;
  check('C2', 'CYGNUS 吸入螺旋粒子（中场残余 diff，排除天空带∪杯口盘∪球盘∪HUD）',
    `${changed}/${total} = ${pct.toFixed(2)}%`,
    pct > 0.05,
    `该区域静态内容=纸底+雾；块 opacity 0.05（Δlum≈8<阈值 12）不可见、尘埃只在天空带、网格盘在 r<1.8 已排除 → 残余变化只能来自 120 个螺旋吸入粒子（inflow 0.6 可见）`);
}

console.log(`\n=== OVERALL: ${fails === 0 ? 'PASS (逐组活性探针全过)' : `FAIL (${fails} 项未过)`} ===`);
process.exitCode = fails === 0 ? 0 : 1;
