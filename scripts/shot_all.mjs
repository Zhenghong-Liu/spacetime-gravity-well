// 依次截取 3D 视口截图（raw CDP，无依赖；Node >= 22 自带 WebSocket/fetch）。
// 用法: node scripts/shot_all.mjs [--swiftshader]        全部 6 个 → shots/body-1..6.png
//       CARDS=0,5 node scripts/shot_all.mjs              只截第 1、6 张卡（调参时快速回归）
// 点 .leftrail__card[i] 切换天体（每张等 2s 过 morph），并打印 console errors。
// 复用已在跑的 5199 vite（本脚本不自起 dev server）。

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { findBin } from './browser.mjs';

const BIN = findBin();
const PORT = 9334;
const TARGET = 'http://127.0.0.1:5199';
const OUT_DIR = new URL('../shots/', import.meta.url);
const SWIFTSHADER = process.argv.includes('--swiftshader');
const CARDS = (process.env.CARDS ?? '0,1,2,3,4,5').split(',').map((s) => Number(s.trim()));

const args = [
  '--headless',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--disable-extensions',
  '--user-data-dir=/tmp/shot-all-profile',
  '--window-size=1440,820',
];
if (SWIFTSHADER) args.push('--enable-unsafe-swiftshader');
args.push('about:blank');

const browser = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let browserOut = '';
browser.stdout.on('data', (d) => (browserOut += d));
browser.stderr.on('data', (d) => (browserOut += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');
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

const shot = async (send, path) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(data, 'base64'));
};

const stageRect = async (send) =>
  send('Runtime.evaluate', {
    expression: `(() => { const s = document.querySelector('.stage'); if (!s) return 'null'; const b = s.getBoundingClientRect(); return JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height }); })()`,
  });

try {
  const targets = await waitDebugger();
  const page = targets.find((t) => t.type === 'page') ?? targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('no page target');
  const { ws, send, errors } = connect(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable').catch(() => {});

  await send('Page.navigate', { url: TARGET });
  await sleep(3500); // RUNTIME ticking, first body settles

  const rectRes = await stageRect(send);
  console.log('stage rect:', rectRes.result?.value);

  for (const i of CARDS) {
    const click = await send('Runtime.evaluate', {
      expression: `(() => { const c = document.querySelectorAll('.leftrail__card')[${i}]; if (!c) return 'MISS'; c.click(); return c.textContent.slice(0, 40); })()`,
    });
    console.log(`click card[${i}]:`, click.result?.value);
    await sleep(2000); // ≥1.5s 过 morph + settle
    const probe = await send('Runtime.evaluate', {
      expression: `(() => { const sel = document.querySelector('.leftrail__card--selected'); const fps = [...document.querySelectorAll('*')].map(e => e.textContent).find(t => /^FPS \\d+$/.test(t ?? '')); return JSON.stringify({ selected: sel ? sel.textContent.slice(0, 40) : null, fps }); })()`,
    });
    console.log(`body-${i + 1} probe:`, probe.result?.value);
    await shot(send, new URL(`body-${i + 1}.png`, OUT_DIR));
    console.log(`saved shots/body-${i + 1}.png`);
  }

  console.log('\n=== CONSOLE ERRORS (' + errors.length + ') ===');
  errors.forEach((e) => console.log(e));
  ws.close();
  process.exitCode = 0;
} catch (err) {
  console.error('FATAL:', err.message);
  console.error('--- browser output tail ---\n' + browserOut.slice(-2000));
  process.exitCode = 1;
} finally {
  browser.kill('SIGKILL');
}
