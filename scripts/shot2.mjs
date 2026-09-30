// t7 re-verify screenshots via raw CDP (no deps; Node >= 22 global WebSocket/fetch).
// Adapted from t4's scripts/shot.mjs. Adds:
//  - global 100s watchdog + 15s per-CDP-command timeout (prints collected info, exit 1)
//  - writes shots/geom.json (largest-canvas rect; CSS px == screenshot px @ DSF 1)
// Usage: node scripts/shot2.mjs [--swiftshader]

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BIN = '/Users/liuzh/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = 9333;
const TARGET = 'http://127.0.0.1:5199';
const OUT_DIR = fileURLToPath(new URL('../shots/', import.meta.url));
const SWIFTSHADER = process.argv.includes('--swiftshader');

const state = { stage: 'init', consoleErrors: [] };
let browser = null;
function fatal(msg) {
  console.error(`\n[TIMEOUT/FAIL] ${msg}`);
  console.error('stage:', state.stage, '| console errors so far:', JSON.stringify(state.consoleErrors));
  try { browser?.kill('SIGKILL'); } catch {}
  process.exit(1);
}
const watchdog = setTimeout(() => fatal('global 100s watchdog tripped'), 100_000);

const args = [
  '--headless',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--disable-extensions',
  '--user-data-dir=/tmp/shot2-profile',
  '--window-size=1440,820',
];
if (SWIFTSHADER) args.push('--enable-unsafe-swiftshader');
args.push('about:blank');

browser = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  fatal('CDP endpoint never came up\n' + browserOut.slice(-2000));
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');
        state.consoleErrors.push(`[console.error] ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        state.consoleErrors.push(`[uncaught] ${d.exception?.description || d.text || 'exception'}`);
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const settle = (fn) => (v) => { clearTimeout(timer); fn(v); };
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout (15s) on ${method}`)); }, 15_000);
      pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send };
}

const shot = async (send, name) => {
  state.stage = `screenshot:${name}`;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, name), Buffer.from(data, 'base64'));
  console.log(`saved shots/${name}`);
};

try {
  state.stage = 'wait-debugger';
  const targets = await waitDebugger();
  const page = targets.find((t) => t.type === 'page') ?? targets[0];
  if (!page?.webSocketDebuggerUrl) fatal('no page target');
  const { ws, send } = connect(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  state.stage = 'setup';
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Runtime.enable');

  state.stage = 'navigate';
  await send('Page.navigate', { url: TARGET });
  state.stage = 'settle-3.5s';
  await sleep(3500); // RUNTIME ticking, animations settle

  state.stage = 'probe-canvas-rect';
  const probe1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const cs = [...document.querySelectorAll('canvas')];
      const big = cs.reduce((a, c) => (c.width * c.height > (a ? a.width * a.height : 0) ? c : a), null);
      const r = big ? big.getBoundingClientRect() : null;
      return JSON.stringify({
        canvases: cs.length,
        sizes: cs.map((c) => [c.width, c.height]),
        scroll: [window.scrollX, window.scrollY],
        canvasRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      });
    })()`,
  });
  console.log('SOL probe:', probe1.result?.value);
  writeFileSync(join(OUT_DIR, 'geom.json'), probe1.result?.value ?? '{}');

  await shot(send, 'verify-sol.png');

  state.stage = 'click-cygnus';
  const click = await send('Runtime.evaluate', {
    expression: `(() => { const c = document.querySelectorAll('.leftrail__card')[3]; if (!c) return 'MISS'; c.click(); return c.className + ' :: ' + c.textContent.slice(0, 40); })()`,
  });
  console.log('click result:', click.result?.value);

  state.stage = 'settle-2.8s';
  await sleep(2800); // wait out the 1s morph + settle
  const probe2 = await send('Runtime.evaluate', {
    expression: `(() => { const sel = document.querySelector('.leftrail__card--selected'); return JSON.stringify({ selected: sel ? sel.textContent.slice(0, 40) : null }); })()`,
  });
  console.log('CYGNUS probe:', probe2.result?.value);
  await shot(send, 'verify-cygnus.png');

  console.log('\n=== CONSOLE ERRORS (' + state.consoleErrors.length + ') ===');
  state.consoleErrors.forEach((e) => console.log(e));
  ws.close();
  clearTimeout(watchdog);
  process.exitCode = 0;
} catch (err) {
  fatal(err.message + '\n--- browser output tail ---\n' + browserOut.slice(-1500));
} finally {
  browser.kill('SIGKILL');
}
