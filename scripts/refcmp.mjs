/**
 * refcmp.mjs —— 中央 3D 视口 <-> 参考图 对齐度评测器（团队共享工具，无第三方依赖）。
 *
 * 用法：
 *   node scripts/refcmp.mjs                       # 采集并比对全部 6 个天体
 *   node scripts/refcmp.mjs sol                   # 只做 sol
 *   node scripts/refcmp.mjs sol betelgeuse        # 只做指定的几个
 *   node scripts/refcmp.mjs --help
 *
 * 前置：Vite dev server 必须已在 127.0.0.1:5199 运行（npx vite --port 5199 --strictPort）。
 *
 * 产出（每个天体）：
 *   shots/cur/<id>.png     本次运行抓取的「视口」截图（852x689 @ DSF1）
 *   shots/cmp/<id>.png     三联图：参考图视口 | 当前视口 | 差异叠加（红=只有参考有墨，绿=只有当前有墨）
 *   shots/cmp/<id>.json    量化指标（见下）
 *
 * 指标（全部只在「遮掉叠加文字后的纯 3D 区域」上计算）：
 *   mad        灰度平均绝对差（0..255，越小越像）
 *   coarseIou  4x4 下采样后的"结构位置"IoU（0..1）—— 主指标。1px 网格线错开 1~2px
 *              就会让逐像素 iou 归零，coarseIou 只看结构位置，用来判断"形状有没有对上"
 *   iou        逐像素墨迹 IoU（0..1，越大越像）—— 辅助指标，对线宽/相位极敏感
 *   inkRef/inkCur  墨迹像素占比（当前比参考"淡"还是"浓"）
 *   rowInk[24] 按行分 24 带的墨迹占比（ref / cur 各一份）—— 结构在竖直方向是否对齐
 *   colInk[24] 按列分 24 带的墨迹占比（ref / cur 各一份）—— 结构在水平方向是否对齐
 *   bandDiffRow/Col  每个带的 (ref - cur) 差值，直接指出该改哪儿
 *
 * 注意：场景本身在动（网格呼吸、球自转、尘埃漂移），mad/iou 不可能为 0。
 * 请把注意力放在 rowInk/colInk 的「形状」是否一致，以及三联图里的结构差异上。
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CFG = JSON.parse(readFileSync(join(ROOT, 'scripts/refmap.json'), 'utf8'));
const BIN =
  '/Users/liuzh/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const TARGET = 'http://127.0.0.1:5199';
const BANDS = 24;
const VIEW_W = 852;
const VIEW_H = 689;

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')));
  process.exit(0);
}
const ALL_IDS = Object.keys(CFG.refs);
const ids = argv.filter((a) => !a.startsWith('-'));
const targets = ids.length ? ids : ALL_IDS;
for (const id of targets) {
  if (!CFG.refs[id]) {
    console.error(`未知天体 id: ${id}（可选：${ALL_IDS.join(', ')}）`);
    process.exit(2);
  }
}

for (const d of ['shots/cur', 'shots/cmp']) mkdirSync(join(ROOT, d), { recursive: true });

/* 每个天体一条独立 CDP 端口 —— 6 个 agent 并行跑各自的 refcmp 时不会互相抢浏览器。
 * 需要固定端口时用环境变量：REFCMP_PORT=9555 node scripts/refcmp.mjs sol */
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}
const PORT = Number(process.env.REFCMP_PORT || (9500 + (djb2([...targets].sort().join(',')) % 400)));
const PROFILE_DIR = `/tmp/refcmp-profile-${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 只读文件头取图片尺寸（PNG / JPEG） */
function imageSize(path) {
  const b = readFileSync(path);
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const m = b[o + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
    }
    o += 2 + b.readUInt16BE(o + 2);
  }
  throw new Error('无法解析图片尺寸: ' + path);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 30_000);
    });
  return { ws, send, errors };
}

/** 页面内执行的比对逻辑：把参考图裁出视口 -> 与当前截图逐像素比对。 */
function buildCompareExpr({ refUrl, curUrl, crop, masks, bands }) {
  return `(async () => {
    const W = ${VIEW_W}, H = ${VIEW_H}, bands = ${bands};
    const load = (u) => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image load failed: ' + u));
      i.src = u;
    });
    const refImg = await load(${JSON.stringify(refUrl)});
    const curImg = await load(${JSON.stringify(curUrl)});
    const cr = ${JSON.stringify(crop)};

    const refC = document.createElement('canvas');
    refC.width = W; refC.height = H;
    const rctx = refC.getContext('2d', { willReadFrequently: true });
    rctx.imageSmoothingEnabled = true; rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(refImg, cr.x, cr.y, cr.w, cr.h, 0, 0, W, H);

    const curC = document.createElement('canvas');
    curC.width = W; curC.height = H;
    const cctx = curC.getContext('2d', { willReadFrequently: true });
    cctx.imageSmoothingEnabled = true; cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(curImg, 0, 0, W, H);

    const rd = rctx.getImageData(0, 0, W, H).data;
    const cd = cctx.getImageData(0, 0, W, H).data;
    const masks = ${JSON.stringify(masks)};
    const gray = (d, i) => d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;

    const masked = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const nx = x / W, ny = y / H; let m = 1;
      for (const k of masks) if (nx >= k.x0 && nx <= k.x1 && ny >= k.y0 && ny <= k.y1) { m = 0; break; }
      masked[y * W + x] = m;
    }

    let ks = 0, ksum = 0;
    for (const [x, y] of [[4,4],[W-5,4],[4,H-5],[W-5,H-5],[W>>1,4]]) {
      ksum += gray(rd, (y * W + x) * 4); ks++;
    }
    const paper = ksum / ks;

    let n = 0, sumAbs = 0, andN = 0, orN = 0, inkRef = 0, inkCur = 0;
    const rowRef = new Float64Array(bands), rowCur = new Float64Array(bands), rowN = new Float64Array(bands);
    const colRef = new Float64Array(bands), colCur = new Float64Array(bands), colN = new Float64Array(bands);
    const out = new Uint8ClampedArray(W * H * 4);

    /* 粗粒度结构掩膜：4x4 下采样后统计"这一小块里有没有墨"。
     * 1px 宽的网格线只要错开 1~2px，逐像素 IoU 就归零；粗粒度掩膜只看结构位置，
     * 因此更适合当作"形状有没有对上"的主指标。 */
    const DS = 4;
    const bw = Math.ceil(W / DS), bh = Math.ceil(H / DS);
    const cntR = new Uint16Array(bw * bh), cntC = new Uint16Array(bw * bh), cntM = new Uint16Array(bw * bh);

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, i = p * 4;
      const gr = gray(rd, i), gc = gray(cd, i);
      const dR = gr < paper - 42 ? 1 : 0, dC = gc < paper - 42 ? 1 : 0;
      if (dR && dC) { out[i]=40; out[i+1]=40; out[i+2]=40; }
      else if (dR) { out[i]=226; out[i+1]=30; out[i+2]=30; }
      else if (dC) { out[i]=20; out[i+1]=160; out[i+2]=40; }
      else { const v = 255 - Math.min(255, Math.abs(gr - gc) * 3); out[i]=v; out[i+1]=v; out[i+2]=v; }
      out[i+3] = 255; // 必须显式给 alpha，否则整张叠加图全透明
      if (masked[p]) {
        n++; sumAbs += Math.abs(gr - gc); inkRef += dR; inkCur += dC;
        if (dR && dC) andN++; if (dR || dC) orN++;
        const rb = Math.min(bands-1, (y*bands/H)|0), cb = Math.min(bands-1, (x*bands/W)|0);
        rowRef[rb]+=dR; rowCur[rb]+=dC; rowN[rb]++; colRef[cb]+=dR; colCur[cb]+=dC; colN[cb]++;
        const bi = ((y / DS) | 0) * bw + ((x / DS) | 0);
        cntR[bi] += dR; cntC[bi] += dC; cntM[bi] += 1;
      }
    }

    /* 粗粒度：块内墨迹密度 > 0.06 视为"有结构"（4x4 块里有 1 个墨像素即 1/16=0.0625） */
    let cAnd = 0, cOr = 0;
    for (let b = 0; b < bw * bh; b++) {
      if (cntM[b] < 8) continue; // 遮罩吃掉大半的块不计入，避免边界噪声
      const a = cntR[b] / cntM[b] > 0.06 ? 1 : 0;
      const c = cntC[b] / cntM[b] > 0.06 ? 1 : 0;
      if (a && c) cAnd++;
      if (a || c) cOr++;
    }
    const coarseIou = cOr ? cAnd / cOr : 0;

    const r3 = (v) => Math.round(v*1000)/1000;
    const rowInkRef=[],rowInkCur=[],colInkRef=[],colInkCur=[];
    for (let b=0;b<bands;b++){
      rowInkRef.push(r3(rowRef[b]/rowN[b])); rowInkCur.push(r3(rowCur[b]/rowN[b]));
      colInkRef.push(r3(colRef[b]/colN[b])); colInkCur.push(r3(colCur[b]/colN[b]));
    }

    const ov = document.createElement('canvas'); ov.width=W; ov.height=H;
    ov.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    const GAP = 8;
    const comp = document.createElement('canvas');
    comp.width = W*3 + GAP*2; comp.height = H;
    const cx = comp.getContext('2d');
    cx.fillStyle='#fff'; cx.fillRect(0,0,comp.width,comp.height);
    cx.drawImage(refC,0,0,W,H); cx.drawImage(curC,W+GAP,0,W,H); cx.drawImage(ov,(W+GAP)*2,0,W,H);
    cx.fillStyle='rgba(0,0,0,0.75)'; cx.font='bold 20px monospace';
    cx.fillText('REFERENCE',10,26);
    cx.fillText('CURRENT',W+GAP+10,26);
    cx.fillText('DIFF  red=ref-only  green=cur-only',(W+GAP)*2+10,26);

    return JSON.stringify({
      paper: Math.round(paper), mad: r3(sumAbs/n), iou: r3(orN?andN/orN:0), coarseIou: r3(coarseIou),
      inkRef: r3(inkRef/n), inkCur: r3(inkCur/n),
      rowInkRef, rowInkCur, colInkRef, colInkCur,
      bandDiffRow: rowInkRef.map((v,i)=>r3(v-rowInkCur[i])),
      bandDiffCol: colInkRef.map((v,i)=>r3(v-colInkCur[i])),
      composite: comp.toDataURL('image/png'),
    });
  })()`;
}

/* ------------------------------------------------------------------ */

let browser = null;
const results = {};

try {
  if (!existsSync(BIN)) throw new Error(`找不到 headless chromium: ${BIN}`);
  const appUp = await fetch(TARGET, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);
  if (!appUp) throw new Error(`dev server 未在 ${TARGET} 运行：请先执行 npx vite --port 5199 --strictPort`);

  browser = spawn(
    BIN,
    ['--headless', `--remote-debugging-port=${PORT}`, '--no-first-run', '--disable-extensions',
     `--user-data-dir=${PROFILE_DIR}`, '--window-size=1440,820', 'about:blank'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let bout = '';
  browser.stdout.on('data', (d) => (bout += d));
  browser.stderr.on('data', (d) => (bout += d));

  let list = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (r.ok) { list = await r.json(); break; }
    } catch {}
    await sleep(200);
  }
  if (!list) throw new Error('CDP 端点未就绪\n' + bout.slice(-1500));

  const page = list.find((t) => t.type === 'page') ?? list[0];
  const { ws, send, errors } = connect(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send('Emulation.setDeviceMetricsOverride', {
    width: CFG.appWidth, height: CFG.appHeight, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: TARGET });
  await sleep(3200);

  const vp = CFG.viewportRectAtAppScale;

  for (const id of targets) {
    const refPath = join(ROOT, CFG.refs[id]);
    if (!existsSync(refPath)) { console.warn(`! 跳过 ${id}：找不到 ${CFG.refs[id]}`); continue; }

    await send('Runtime.evaluate', {
      expression: `(() => { const c = document.querySelectorAll('.leftrail__card')[${CFG.cardIndex[id]}];
        if (!c) return 'MISS'; c.click(); return 'OK'; })()`,
    });
    await sleep(2600); // 400ms morph + 阻尼/呼吸稳定

    const rectRes = await send('Runtime.evaluate', {
      expression: `(() => { const cs = [...document.querySelectorAll('canvas')];
        const c = cs.sort((a,b) => b.clientWidth*b.clientHeight - a.clientWidth*a.clientHeight)[0];
        if (!c) return ''; const r = c.getBoundingClientRect();
        return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()`,
    });
    const rect = JSON.parse(rectRes.result?.value || 'null');
    if (!rect) throw new Error(`取不到 canvas rect: ${id}`);

    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 },
      captureBeyondViewport: false,
    });
    writeFileSync(join(ROOT, 'shots/cur', `${id}.png`), Buffer.from(shot.data, 'base64'));

    const meta = imageSize(refPath);
    /* 参考图 = 本应用 1440x820 布局的等比例放大版（原始 2880x1640 即精确 2 倍），
     * 故视口矩形按 meta/app 的比例换算，而不是按 refWidth/refHeight。 */
    const sx = meta.w / CFG.appWidth;
    const sy = meta.h / CFG.appHeight;
    const crop = { x: vp.x * sx, y: vp.y * sy, w: vp.w * sx, h: vp.h * sy };
    const stamp = Date.now();
    const res = await send('Runtime.evaluate', {
      expression: buildCompareExpr({
        refUrl: `${TARGET}/${CFG.refs[id]}?v=${stamp}`,
        curUrl: `${TARGET}/shots/cur/${id}.png?v=${stamp}`,
        crop, masks: CFG.masks, bands: BANDS,
      }),
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(`比对失败(${id}): ` + JSON.stringify(res.exceptionDetails));

    const data = JSON.parse(res.result.value);
    writeFileSync(join(ROOT, 'shots/cmp', `${id}.png`), Buffer.from(data.composite.split(',')[1], 'base64'));
    delete data.composite;
    data.body = id;
    writeFileSync(join(ROOT, 'shots/cmp', `${id}.json`), JSON.stringify(data, null, 1));
    results[id] = data;

    const spark = (arr) => arr.map((v) => ' .:-=+*#%@'[Math.min(9, Math.round(v * 30))]).join('');
    const worst = (arr) => arr.map((v, i) => [Math.abs(v), i]).sort((a, b) => b[0] - a[0]).slice(0, 4)
      .map(([d, i]) => `${Math.round((i + 0.5) * 100 / BANDS)}%(${d.toFixed(3)})`).join(' ');
    console.log(`\n=== ${id.toUpperCase()} ===  coarseIou=${data.coarseIou}  mad=${data.mad}  iou=${data.iou}  inkRef=${data.inkRef}  inkCur=${data.inkCur}`);
    console.log('  rowInk ref |' + spark(data.rowInkRef) + '|   差异最大行带: ' + worst(data.bandDiffRow));
    console.log('  rowInk cur |' + spark(data.rowInkCur) + '|');
    console.log('  colInk ref |' + spark(data.colInkRef) + '|   差异最大列带: ' + worst(data.bandDiffCol));
    console.log('  colInk cur |' + spark(data.colInkCur) + '|');
    console.log('  三联图 -> shots/cmp/' + id + '.png');
  }

  if (errors.length) {
    console.log(`\n=== 页面控制台错误 (${errors.length}) ===`);
    errors.slice(0, 10).forEach((e) => console.log('  ' + e));
  }

  const vs = Object.values(results);
  if (vs.length) {
    const avg = (k) => (vs.reduce((a, r) => a + r[k], 0) / vs.length).toFixed(4);
    console.log(`\n===== 汇总（${vs.length} 个天体）: 平均 coarseIou=${avg('coarseIou')}  平均 mad=${avg('mad')}  平均 iou=${avg('iou')} =====`);
  }
} catch (err) {
  console.error('FATAL:', err.message);
  process.exitCode = 1;
} finally {
  try { browser?.kill('SIGKILL'); } catch {}
}
