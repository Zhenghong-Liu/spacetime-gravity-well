// t3 两帧对比截图（间隔 1.5s）via raw CDP（无依赖，Node >= 22）。
// SOL 默认态：整页两帧（覆盖中央 3D 视口 + 右侧表盘），每帧记录表盘环层 transform。
// 用法: node scripts/shot_t3.mjs   （需 dev 服务在 http://127.0.0.1:5199）
// 产物: shots/t3-a.png / shots/t3-b.png + shots/t3-geom.json（canvasRect + dialRect + 两帧 rings）

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BIN = '/Users/liuzh/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = 9333;
const TARGET = 'http://127.0.0.1:5199';
const OUT_DIR = fileURLToPath(new URL('../shots/', import.meta.url));
const SWIFTSHADER = process.argv.includes('--swiftshader');

const args = [
  '--headless',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--disable-extensions',
  '--user-data-dir=/tmp/shot-t3-profile',
  '--window-size=1440,820',
];
if (SWIFTSHADER) args.push('--enable-unsafe-swiftshader');
args.push('about:blank');

const browser = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let browserOut = '';
browser.stdout.on('data', (d) => (browserOut += d));
browser.stderr.on('data', (d) => (browserOut += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => { console.error('[TIMEOUT] 60s watchdog'); browser.kill('SIGKILL'); process.exit(1); }, 60_000);

async function waitDebugger() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (res.ok) return res.json();
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP endpoint never came up\n' + browserOut.slice(-2000));
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
    } else if (msg.method) {
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        errors.push(`[console.error] ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(`[uncaught] ${d.exception?.description || d.text || 'exception'}`);
      }
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

// 表盘环层 transform 探针 + 画布/表盘 rect（同 shot_t1.mjs 模式）
const probe = `(() => {
  const cs = [...document.querySelectorAll('canvas')];
  const big = cs.reduce((a, c) => (c.width * c.height > (a ? a.width * a.height : 0) ? c : a), null);
  const cr = big ? big.getBoundingClientRect() : null;
  const svg = document.querySelector('svg.dial__svg');
  const dr = svg ? svg.getBoundingClientRect() : null;
  const gs = svg ? [...svg.querySelectorAll('g[transform]')] : [];
  const rect = (el) => (el ? (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })() : null);
  const hud = ['stage__headlineBlock', 'stage__readouts', 'stage__engine'].map((c) => rect(document.querySelector('.' + c)));
  const corners = [...document.querySelectorAll('.stage__corner')].map((el) => rect(el));
  return JSON.stringify({
    canvasRect: cr ? { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) } : null,
    dialRect: dr ? { x: Math.round(dr.x), y: Math.round(dr.y), w: Math.round(dr.width), h: Math.round(dr.height) } : null,
    rings: gs.map((g) => g.getAttribute('transform')),
    hud,
    corners,
  });
})()`;

try {
  const targets = await waitDebugger();
  const page = targets.find((t) => t.type === 'page') ?? targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('no page target');
  const { ws, send, errors } = connect(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Runtime.enable');

  await send('Page.navigate', { url: TARGET });
  await sleep(3500); // RUNTIME ticking, animations settle（SOL 默认态）

  const pa = await send('Runtime.evaluate', { expression: probe });
  const frameA = JSON.parse(pa.result?.value);
  if (!frameA.canvasRect || !frameA.dialRect) throw new Error('probe failed: ' + pa.result?.value);
  const shotA = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT_DIR + '/t3-a.png', Buffer.from(shotA.data, 'base64'));
  console.log('saved shots/t3-a.png (rings: ' + frameA.rings.length + ')');

  await sleep(1500); // 1.5s 间隔

  const pb = await send('Runtime.evaluate', { expression: probe });
  const frameB = JSON.parse(pb.result?.value);
  const shotB = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT_DIR + '/t3-b.png', Buffer.from(shotB.data, 'base64'));
  console.log('saved shots/t3-b.png');

  writeFileSync(OUT_DIR + '/t3-geom.json', JSON.stringify({ canvasRect: frameA.canvasRect, dialRect: frameA.dialRect, ringsA: frameA.rings, ringsB: frameB.rings, hud: frameA.hud, corners: frameA.corners }, null, 1));
  console.log('canvasRect:', JSON.stringify(frameA.canvasRect));
  console.log('dialRect:', JSON.stringify(frameA.dialRect));
  console.log('ringsA:', JSON.stringify(frameA.rings));
  console.log('ringsB:', JSON.stringify(frameB.rings));

  console.log('\n=== CONSOLE ERRORS (' + errors.length + ') ===');
  errors.forEach((e) => console.log(e));
  ws.close();
  process.exitCode = errors.length ? 2 : 0;
} catch (err) {
  console.error('FATAL:', err.message);
  console.error('--- browser output tail ---\n' + browserOut.slice(-2000));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  browser.kill('SIGKILL');
}
