// t1 两帧对比截图（间隔 1s）via raw CDP（无依赖，Node >= 22）。
// 验证 AccretionDial 全部环层 + 中央 C 形 1s 内位置明显变化，并收集 console error。
// 用法: node scripts/shot_t1.mjs   （需 preview 服务在 http://127.0.0.1:5199）
// 产物: shots/t1-a.png / shots/t1-b.png + 控制台输出（两帧各环 transform + 表盘区域信息）

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BIN = '/Users/liuzh/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = 9333;
const TARGET = 'http://127.0.0.1:5199';
const OUT_DIR = fileURLToPath(new URL('../shots/', import.meta.url));

const args = [
  '--headless',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--disable-extensions',
  '--user-data-dir=/tmp/shot-t1-profile',
  '--window-size=1440,820',
];
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

const readDial = `(() => {
  const svg = document.querySelector('svg.dial__svg');
  if (!svg) return JSON.stringify({ missing: true });
  const r = svg.getBoundingClientRect();
  const gs = [...svg.querySelectorAll('g[transform]')];
  return JSON.stringify({
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    rings: gs.map(g => g.getAttribute('transform')),
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
  await sleep(3500); // RUNTIME ticking, animations settle

  const a1 = await send('Runtime.evaluate', { expression: readDial });
  const dialA = JSON.parse(a1.result?.value);
  if (dialA.missing) throw new Error('dial svg not found');
  const shotA = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT_DIR + '/t1-a.png', Buffer.from(shotA.data, 'base64'));
  console.log('saved shots/t1-a.png');

  await sleep(1000); // 1s 间隔

  const b1 = await send('Runtime.evaluate', { expression: readDial });
  const dialB = JSON.parse(b1.result?.value);
  const shotB = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT_DIR + '/t1-b.png', Buffer.from(shotB.data, 'base64'));
  console.log('saved shots/t1-b.png');

  console.log('dialRect:', JSON.stringify(dialA.rect));
  writeFileSync(OUT_DIR + '/t1-dial-rect.json', JSON.stringify(dialA.rect));
  console.log('ringsA (14 组, 含中央 C 形):');
  console.log(JSON.stringify(dialA.rings, null, 1));
  console.log('ringsB:');
  console.log(JSON.stringify(dialB.rings, null, 1));

  console.log('\n=== 1s 角度增量 (deg) ===');
  const parse = (s) => { const m = /rotate\((-?[\d.]+)/.exec(s || ''); return m ? parseFloat(m[1]) : NaN; };
  dialA.rings.forEach((ra, i) => {
    const da = parse(ra), db = parse(dialB.rings[i]);
    let d = db - da;
    if (d > 180) d -= 360; if (d < -180) d += 360;
    console.log(`  g${i}: A=${da}  B=${db}  Δ=${d.toFixed(2)}°/s`);
  });

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
