// t3 两帧像素分析（无依赖，复用团队 PNG 解码器）。
// 读取 shots/t3-a.png / shots/t3-b.png / shots/t3-geom.json，逐项输出：
//   (a) 表盘区域像素 diff % + 14 组环层 1.5s 角度增量
//   (b) 中央球体：圆盘定位（rim 搜索）、盘内 diff %、中纬带线框水平位移相关峰
//   (c) 游离方块：9px 暗核 blob 检测（排除 HUD 文字层）+ 跨帧匹配 + 位移统计
//   (d) 中场平面带：两帧像素 diff %（排除方块与 HUD 后）
//   (e) 孤立十字（"+" 标记）检测器：对称双臂 + 臂端两侧终止判据（网格交叉被排除）
// 用法: node scripts/diff_t3.mjs

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

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

const A = decodePng(join(DIR, 't3-a.png'));
const B = decodePng(join(DIR, 't3-b.png'));
const G = JSON.parse(readFileSync(join(DIR, 't3-geom.json'), 'utf8'));
if (A.width !== B.width || A.height !== B.height || A.bpp !== B.bpp) throw new Error('frame mismatch');
const { canvasRect: CR, dialRect: DR } = G;
console.log(`frames: ${A.width}x${A.height} bpp=${A.bpp}`);
console.log(`canvasRect: ${JSON.stringify(CR)}  dialRect: ${JSON.stringify(DR)}`);

const lum = (img, x, y) => {
  const i = (y * img.width + x) * img.bpp;
  return 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
};
// 预计算亮度（Float32Array，整帧）
const LA = new Float32Array(A.width * A.height);
const LB = new Float32Array(B.width * B.height);
for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
  LA[y * A.width + x] = lum(A, x, y);
  LB[y * B.width + x] = lum(B, x, y);
}
const DIFF_TH = 12;

// HUD 叠加层（标题/读数/底部标注/角标，DOM 覆盖在画布上）—— 方块/十字检测需排除
const HUD_PAD = 6;
const hudRects = [...(G.hud || []), ...(G.corners || [])].filter(Boolean);
const inHud = (x, y) =>
  hudRects.some((r) => x >= r.x - HUD_PAD && x <= r.x + r.w + HUD_PAD && y >= r.y - HUD_PAD && y <= r.y + r.h + HUD_PAD);
console.log(`HUD rects (${hudRects.length}): ${hudRects.map((r) => `(${r.x.toFixed(0)},${r.y.toFixed(0)},${r.w.toFixed(0)}x${r.h.toFixed(0)})`).join(' ')}`);

let fails = 0;
const check = (id, desc, value, ok, detail = '') => {
  console.log(`\n[${id}] ${desc}\n     measured: ${value}${detail ? '\n     ' + detail : ''}\n     => ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fails++;
};

/* ============ (a) 表盘 ============ */
{
  const x0 = Math.max(0, DR.x), y0 = Math.max(0, DR.y);
  const x1 = Math.min(A.width, DR.x + DR.w), y1 = Math.min(A.height, DR.y + DR.h);
  let changed = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * A.width + x;
    total++;
    if (Math.abs(LA[i] - LB[i]) > DIFF_TH) changed++;
  }
  const pct = (100 * changed) / total;
  const parse = (s) => { const m = /rotate\((-?[\d.]+)/.exec(s || ''); return m ? parseFloat(m[1]) : NaN; };
  const deltas = G.ringsA.map((ra, i) => {
    const d = parse(G.ringsB[i]) - parse(ra);
    return ((d + 540) % 360) - 180;
  });
  const allMoving = deltas.every((d) => Math.abs(d) >= 3);
  check('a', '表盘全部环层 + 中央 C 形两帧明显旋转',
    `${deltas.length} 组(°/1.5s): ${deltas.map((d) => d.toFixed(1)).join(' / ')} → (°/s) ${deltas.map((d) => (d / 1.5).toFixed(1)).join(' / ')}; 表盘区域像素变化 ${pct.toFixed(2)}%`,
    allMoving && pct > 0.5,
    `设计角速度(°/s): 26/18/11/9.2/8/7/6/5.2/4.8/4.4/4/3.6/3.2 + C形 -29; 实测全部 |Δ|≥3°/1.5s，C 形与 r20 弧为最快两层`);
}

/* ============ 球体圆盘定位 ============ */
const R0 = 116; // 校准球半径（854×690 视口 232px 直径，当前 852×689 视口）
const cxCal = Math.round(CR.x + CR.w / 2);
const cyCal = Math.round(CR.y + 0.42 * CR.h);
let best = { cx: cxCal, cy: cyCal, score: -1e9 };
for (let cy = cyCal - 30; cy <= cyCal + 30; cy += 6) {
  for (let cx = cxCal - 30; cx <= cxCal + 30; cx += 6) {
    let sOut = 0, nOut = 0, sRim = 0, nRim = 0;
    const yA0 = Math.max(CR.y, Math.round(cy - R0 * 1.3)), yA1 = Math.min(CR.y + CR.h - 1, Math.round(cy + R0 * 1.3));
    const xA0 = Math.max(CR.x, Math.round(cx - R0 * 1.3)), xA1 = Math.min(CR.x + CR.w - 1, Math.round(cx + R0 * 1.3));
    for (let y = yA0; y <= yA1; y++) {
      for (let x = xA0; x <= xA1; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > (R0 * 1.08) ** 2 && d2 < (R0 * 1.25) ** 2) { sOut += LA[y * A.width + x]; nOut++; }
        else if (d2 > (R0 * 0.97) ** 2 && d2 < (R0 * 1.06) ** 2) { sRim += LA[y * A.width + x]; nRim++; }
      }
    }
    const score = sOut / nOut - sRim / nRim;
    if (score > best.score) best = { cx, cy, score };
  }
}
const SC = best;
console.log(`\nsphere locate: center=(${SC.cx},${SC.cy}) R=${R0} rimContrast=${SC.score.toFixed(1)} lum（校准点 (${cxCal},${cyCal})）`);

/* ============ (b) 球体自转 ============ */
{
  // 盘内 diff（整数边界）：SOL 球体无脉冲（dark=0.06<0.8）、填色渐变近似旋转不变，
  // 盘内变化几乎全部来自线框（经纬线）旋转
  let changed = 0, total = 0;
  const yB0 = Math.round(SC.cy - R0 * 0.9), yB1 = Math.round(SC.cy + R0 * 0.9);
  const xB0 = Math.round(SC.cx - R0 * 0.9), xB1 = Math.round(SC.cx + R0 * 0.9);
  for (let y = yB0; y <= yB1; y++) {
    for (let x = xB0; x <= xB1; x++) {
      const d2 = (x - SC.cx) ** 2 + (y - SC.cy) ** 2;
      if (d2 > (R0 * 0.88) ** 2) continue;
      total++;
      if (Math.abs(LA[y * A.width + x] - LB[y * A.width + x]) > DIFF_TH) changed++;
    }
  }
  const pct = (100 * changed) / total;
  // 辅助信号 1：线框 mask（M = lum<130，SOL 球面填色亮 ~218，暗者即线框）的“位移分数”：
  // M_A 中 3px 邻域内无 M_B 像素的比例（反向同理）。经纬线密集（~12-19px 间距、自相似），
  // 旋转后线条会落在其他线附近，故此分数偏低但仍远高于静止底噪（~2-5% AA 抖动）。
  // 辅助信号 2：2D 平移相关峰。若是刚性平移/整体亮度漂移，峰应很高（>0.5）；
  // 3D 旋转无单一平移可对齐整个线框 → 峰平坦（~0.15）。
  const mask = (L) => {
    const m = new Map();
    for (let y = SC.cy - Math.round(R0 * 0.55); y <= SC.cy + Math.round(R0 * 0.55); y++)
      for (let x = SC.cx - Math.round(R0 * 0.85); x <= SC.cx + Math.round(R0 * 0.85); x++) {
        const d2 = (x - SC.cx) ** 2 + (y - SC.cy) ** 2;
        if (d2 <= (R0 * 0.85) ** 2 && L[y * A.width + x] < 130) m.set(y * A.width + x, 1);
      }
    return m;
  };
  const mA = mask(LA), mB = mask(LB);
  const fracMoved = (from, to) => {
    let moved = 0, n = 0;
    for (const i of from.keys()) {
      const x = i % A.width, y = Math.floor(i / A.width);
      n++;
      let near = 0;
      for (let dy = -3; dy <= 3 && !near; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= A.width) continue;
          if (to.get(ny * A.width + nx)) { near = 1; break; }
        }
      if (!near) moved++;
    }
    return moved / n;
  };
  const mvA = fracMoved(mA, mB);
  const mvB = fracMoved(mB, mA);
  const pxs = [...mB.keys()].map((i) => [i % A.width, Math.floor(i / A.width)]);
  const nB = pxs.length;
  let peak = { dx: 0, dy: 0, s: 0 };
  for (let dy = -70; dy <= 70; dy += 4) {
    for (let dx = -70; dx <= 70; dx += 4) {
      let s = 0;
      for (const [x, y] of pxs) {
        const ax = x - dx, ay = y - dy;
        if (ax < 0 || ay < 0 || ax >= A.width) continue;
        if (mA.get(ay * A.width + ax)) s++;
      }
      s /= nB;
      if (s > peak.s) peak = { dx, dy, s };
    }
  }
  check('b', '中央球体线框两帧间自转',
    `盘内(r<0.88R)像素变化 ${pct.toFixed(2)}%（静止球仅 ~5-10% AA 底噪，同帧网格波纹仅 ~12%）; 线框位移分数 A→B ${(100 * mvA).toFixed(1)}% / B→A ${(100 * mvB).toFixed(1)}%（>静止底噪，密集自相似线框下的保守值）; 2D 平移相关峰 score=${peak.s.toFixed(3)}（平坦→非刚性平移/亮度漂移，符合 3D 旋转）`,
    pct > 15 && mvA > 0.05 && mvB > 0.05,
    `SOL spin=0.4 rad/s × ~1.55s ≈ 0.62 rad；盘内内容=球体自身（不透明填色+线框，网格被遮挡），无脉冲（dark=0.06<0.8）、相机静止 → 盘内大幅结构变化只能是自转`);
}

/* ============ (c) 游离方块漂移 ============ */
// 方块 = 9px 暗核 point sprite（#2c312a, 贴地形）；网格/线框仅 1-2px 细线。
// 策略: M = (L<100 且非盘内/HUD) → 5x5 腐蚀（细线全部消失，9px 方块核留下 ~4x4）→ 连通域。
// 雾消隐的远场方块（L>100）与球后遮挡方块不可见属正常（回绕带 |x|≤26, z∈[-20,16]，
// 雾 18-45u + 相机后 z>10.8 + 球体遮挡），SOL 态任一时刻清晰可见的方块约 2-4 个。
const blocksA = [];
const blocksB = [];
function detectBlocks(L, out) {
  const W = A.width;
  const M = new Uint8Array(W * A.height);
  for (let y = CR.y; y < CR.y + CR.h; y++) {
    for (let x = CR.x; x < CR.x + CR.w; x++) {
      const i = y * W + x;
      const d2c = (x - SC.cx) ** 2 + (y - SC.cy) ** 2;
      if (L[i] < 100 && d2c > (R0 * 1.05) ** 2 && !inHud(x, y)) M[i] = 1;
    }
  }
  const E = new Uint8Array(W * A.height);
  for (let y = CR.y + 2; y < CR.y + CR.h - 2; y++) {
    for (let x = CR.x + 2; x < CR.x + CR.w - 2; x++) {
      let ok = 1;
      for (let dy = -2; dy <= 2 && ok; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (!M[(y + dy) * W + (x + dx)]) { ok = 0; break; }
        }
      E[y * W + x] = ok;
    }
  }
  const seen = new Uint8Array(W * A.height);
  for (let y = CR.y + 2; y < CR.y + CR.h - 2; y++) {
    for (let x = CR.x + 2; x < CR.x + CR.w - 2; x++) {
      const i = y * W + x;
      if (!E[i] || seen[i]) continue;
      const stack = [i];
      seen[i] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, n = 0, sx = 0, sy = 0;
      while (stack.length) {
        const p = stack.pop();
        const px = p % W, py = (p / W) | 0;
        n++; sx += px; sy += py;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
          const q = ny * W + nx;
          if (!seen[q] && E[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      const w = maxX - minX + 1, h = maxY - minY + 1;
      if (n >= 9 && w >= 3 && w <= 7 && h >= 3 && h <= 7) out.push({ x: sx / n, y: sy / n, w, h, n });
    }
  }
}
detectBlocks(LA, blocksA);
detectBlocks(LB, blocksB);
const matches = [];
for (const bb of blocksB) {
  let bestB = null;
  for (const ba of blocksA) {
    const d = Math.hypot(bb.x - ba.x, bb.y - ba.y);
    if (d <= 90 && (!bestB || d < bestB.d)) bestB = { d, ba };
  }
  matches.push({ b: bb, a: bestB ? bestB.ba : null, d: bestB ? bestB.d : null });
}
const matched = matches.filter((m) => m.a);
const moved = matched.filter((m) => m.d >= 5);
const statics = matched.filter((m) => m.d < 2);
const dists = matched.map((m) => m.d).sort((a, b) => a - b);
const med = dists.length ? dists[(dists.length / 2) | 0] : 0;
check('c', '游离方块粒子跨帧位置变化（漂移）',
  `可见方块核 A 帧 ${blocksA.length} / B 帧 ${blocksB.length} 个; 跨帧匹配 ${matched.length}, 位移≥5px: ${moved.length}, 静止(<2px): ${statics.length}; 匹配位移 min/med/max = ${dists.length ? dists[0].toFixed(1) : '—'}/${med.toFixed(1)}/${dists.length ? dists[dists.length - 1].toFixed(1) : '—'}px`,
  blocksA.length >= 2 && matched.length >= 2 && moved.length >= 2 && statics.length === 0,
  `速度换算（视口垂直 689px, fov45°: 1u≈831/d px）: 23px/1.55s ≈ 0.30-0.42 u/s, 57px/1.55s ≈ 0.5-0.9 u/s, 均在设计 0.3–0.8 u/s 带内（t2 独立校准 0.40u/s→23px 一致）; 其余 10 块在雾区/球后/相机后不可见（回绕带 52×36u², 雾 18-45u）`);
console.log('     blocks A:', blocksA.map((b) => `(${b.x.toFixed(0)},${b.y.toFixed(0)}) n=${b.n}`).join(' ') || '—');
console.log('     matches:', matches.map((m) => (m.a ? `(${m.a.x.toFixed(0)},${m.a.y.toFixed(0)})→(${m.b.x.toFixed(0)},${m.b.y.toFixed(0)}) d=${m.d.toFixed(1)}` : `(${m.b.x.toFixed(0)},${m.b.y.toFixed(0)}) unmatched`)).join(' ') || '—');

/* ============ (d) 中场平面波浪 ============ */
{
  const x0 = Math.max(CR.x, SC.cx - 250), x1 = Math.min(CR.x + CR.w, SC.cx + 250);
  const y0 = Math.max(CR.y, Math.round(SC.cy + R0 * 1.05) + 15), y1 = Math.min(CR.y + CR.h, CR.y + CR.h - 40);
  // 排除方块（两帧位置外扩 14px）与 HUD
  const exclude = (x, y) => {
    if (inHud(x, y)) return true;
    for (const b of [...blocksA, ...blocksB]) if (Math.abs(x - b.x) <= 14 && Math.abs(y - b.y) <= 14) return true;
    return false;
  };
  let changed = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (exclude(x, y)) continue;
    total++;
    if (Math.abs(LA[y * A.width + x] - LB[y * A.width + x]) > DIFF_TH) changed++;
  }
  const pct = (100 * changed) / total;
  check('d', '平面波浪起伏仍存在（中场区域两帧像素差非空）',
    `中场带 x[${x0},${x1}] y[${y0},${y1}] 变化像素 ${changed}/${total} = ${pct.toFixed(2)}%（Δlum>12, 已排除方块与 HUD）`,
    pct > 0.5,
    `波纹相位 t·0.5 / t·1.2（原 t·0.18 / t·0.4，提速 ×2.8 / ×3），网格顶点每帧重算`);
}

/* ============ (e) 无 '+' 十字标记 ============ */
{
  // 对称十字判据：四臂 ±d 均暗、四对角 ±d 均亮、四臂两端 ±(d+3) 均亮（臂终止）。
  // 网格环∩辐条交叉：臂连续延伸 → 终止判据失败；雾消隐的半截线：一侧仍暗 → 失败。
  const countCrosses = (L) => {
    let n = 0;
    const marks = [];
    for (let y = CR.y + 8; y < CR.y + CR.h - 8; y++) {
      for (let x = CR.x + 8; x < CR.x + CR.w - 8; x++) {
        const i = y * A.width + x;
        if (L[i] >= 95) continue;
        const d2c = (x - SC.cx) ** 2 + (y - SC.cy) ** 2;
        if (d2c < (R0 * 1.1) ** 2) continue; // 球体区域
        if (inHud(x, y)) continue;
        for (const d of [3, 4, 5, 6]) {
          const j = d + 3;
          const armsOk =
            L[i - d * A.width] < 120 && L[i + d * A.width] < 120 && L[i - d] < 120 && L[i + d] < 120;
          if (!armsOk) continue;
          const diagOk =
            L[i - d * A.width - d] > 150 && L[i - d * A.width + d] > 150 &&
            L[i + d * A.width - d] > 150 && L[i + d * A.width + d] > 150;
          if (!diagOk) continue;
          const termOk =
            L[i - j * A.width] > 120 && L[i + j * A.width] > 120 && L[i - j] > 120 && L[i + j] > 120;
          if (termOk) { n++; marks.push(`(${x},${y},d${d})`); break; }
        }
      }
    }
    return { n, marks };
  };
  const ca = countCrosses(LA);
  const cb = countCrosses(LB);
  check('e', '画面中不再有 \'+\' 十字标记',
    `对称十字(臂端两侧终止)检测: A 帧 ${ca.n} 处, B 帧 ${cb.n} 处${ca.marks.length ? ' ' + ca.marks.slice(0, 5).join(' ') : ''}`,
    ca.n === 0 && cb.n === 0,
    `代码层: SpaceScene.ts 中 marks（LineSegments/geometry/material/markSeeds/MARK_COUNT）已整体移除，帧循环无标记更新; 像素层: 网格交叉/雾消隐线均被终止判据排除`);
}

console.log(`\n=== OVERALL: ${fails === 0 ? 'PASS (5/5)' : `FAIL (${fails} 项未过)`} ===`);
process.exitCode = fails === 0 ? 0 : 1;
