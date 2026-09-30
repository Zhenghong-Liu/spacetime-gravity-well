// 布局自适应探针（raw CDP，无第三方依赖；Node >= 22 自带 WebSocket/fetch）。
// 用法: node scripts/layout.mjs [宽x高 ...]        例: node scripts/layout.mjs 1440x932 1280x800
// 需要 dev 服务在跑: npm run dev -- --port 5199（或 TARGET=http://host:port 覆盖）
// 产物: shots/layout-<W>x<H>.png + 标准输出的几何读数。
//
// 读数对应两条自适应规则，改动左右栏 CSS 后用来回归：
//   leftBlank  = 左栏末尾空槽高度（固定为整栏 7.5%，不随窗口高度翻倍）
//   cardH      = 卡片槽位高度（等分「栏高 − 末尾空槽」，卡内行距不被拉伸）
//   gaps       = 右栏节间距（26 起，长到 clamp(46px, 5svh, 64px) 封顶）
//   rightBlank = 右栏栏尾空白 + 16 内边距（间距到顶后剩下的富余高度全落在这里）
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { findBin } from './browser.mjs';

const TARGET = process.env.TARGET ?? 'http://127.0.0.1:5199';
const PORT = Number(process.env.CDP_PORT ?? 9345);
const SHOTS = new URL('../shots/', import.meta.url);
const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ['1440x932', '1920x1080', '1440x820', '1280x800'])
  .map((s) => s.split('x').map(Number));

const browser = spawn(findBin(), [
  '--headless', `--remote-debugging-port=${PORT}`, '--no-first-run', '--disable-extensions',
  `--user-data-dir=${process.env.TMPDIR ?? '/tmp'}/layout-probe-profile`,
  '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let blog = '';
browser.stdout.on('data', (d) => (blog += d));
browser.stderr.on('data', (d) => (blog += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP never came up\n' + blog.slice(-2000));
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('[uncaught] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('[console] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send, errors };
}

const PROBE = `(() => {
  const g = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
  const cards = [...document.querySelectorAll('.leftrail__card')].map((e) => e.getBoundingClientRect());
  const rail = g('.app__leftrail'), rrail = g('.app__rightrail');
  const heat = g('.heat__svg'), dial = g('.dial__svg'), shear = g('.shear');
  const h = g('.stage__headline'), ro = g('.stage__readouts'), tr = g('.stage__corner--tr');
  const f = (n) => (n == null ? null : +n.toFixed(1));
  const sameLine = h && ro && Math.abs(h.top - ro.top) < 4;
  return JSON.stringify({
    railW: [f(rail.width), f(rrail.width)],
    leftBlank: f(rail.bottom - cards[cards.length - 1].bottom),
    cardH: [...new Set(cards.map((b) => f(b.height)))],
    rightBlank: f(rrail.bottom - heat.bottom),
    plots: [f(shear.height), f(dial.height), f(heat.height)],
    gaps: [...document.querySelectorAll('.rightrail__gap')].map((e) => f(e.getBoundingClientRect().height)),
    readoutsInsideCornerArm: ro && tr ? f(tr.right - 1 - ro.right) : null,
    headlineBesideReadouts: sameLine ? f(ro.left - h.right) : 'wrapped',
  });
})()`;

const CLICK = `(async () => {
  const cards = [...document.querySelectorAll('.leftrail__card')];
  const sel = cards.findIndex((c) => c.closest('.leftrail__item--selected'));
  const target = cards[sel === 3 ? 0 : 3];
  const before = document.querySelector('.stage__headline').textContent.trim();
  target.click();
  await new Promise((r) => setTimeout(r, 900));
  const after = document.querySelector('.stage__headline').textContent.trim();
  return JSON.stringify({ before, after, changed: before !== after,
    selected: document.querySelectorAll('.leftrail__item--selected').length });
})()`;

try {
  const t = await targets();
  const page = t.find((x) => x.type === 'page') ?? t[0];
  const { ws, send, errors } = connect(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: sizes[0][0], height: sizes[0][1], deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: TARGET });
  await sleep(4500);
  mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    console.log(`\n===== ${w}x${h} =====`);
    const res = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    if (!res.result?.value) { console.log('probe failed', JSON.stringify(res).slice(0, 400)); continue; }
    for (const [k, v] of Object.entries(JSON.parse(res.result.value))) {
      console.log('  ' + k.padEnd(22), JSON.stringify(v));
    }
    const click = await send('Runtime.evaluate', { expression: CLICK, awaitPromise: true, returnByValue: true });
    console.log('  click                  ', click.result?.value);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await sleep(500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(new URL(`layout-${w}x${h}.png`, SHOTS),
      Buffer.from(shot.data, 'base64'));
  }
  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 12).forEach((e) => console.log(e));
  ws.close();
} catch (e) {
  console.error('FATAL', e.message, blog.slice(-1500));
  process.exitCode = 1;
} finally {
  browser.kill('SIGKILL');
}
