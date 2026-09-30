// Headless-browser screenshot via raw CDP (no deps; Node >= 22 has global WebSocket/fetch).
// Usage: node scripts/shot.mjs [--swiftshader]
// Writes shots/verify-sol.png and shots/verify-cygnus.png, prints console errors.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const BIN = '/Users/liuzh/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = 9333;
const TARGET = 'http://127.0.0.1:5199';
const OUT_DIR = new URL('../shots/', import.meta.url);
const SWIFTSHADER = process.argv.includes('--swiftshader');

const args = [
  '--headless',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--disable-extensions',
  '--user-data-dir=/tmp/shot-profile',
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
  const events = [];
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
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
  return { ws, send, events, errors };
}

const shot = async (send, path) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(data, 'base64'));
};

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
  await sleep(3500); // RUNTIME ticking, animations settle

  const probe1 = await send('Runtime.evaluate', { expression: `(() => { const cs = [...document.querySelectorAll('canvas')]; return JSON.stringify({ canvases: cs.length, sizes: cs.map(c => [c.width, c.height]), rootChildren: document.getElementById('root')?.childElementCount ?? -1 }); })()` });
  console.log('SOL probe:', probe1.result?.value);
  await shot(send, new URL('verify-sol.png', OUT_DIR));
  console.log('saved shots/verify-sol.png');

  const click = await send('Runtime.evaluate', { expression: `(() => { const c = document.querySelectorAll('.leftrail__card')[3]; if (!c) return 'MISS'; c.click(); return c.className + ' :: ' + c.textContent.slice(0, 40); })()` });
  console.log('click result:', click.result?.value);

  await sleep(2800); // wait out the 1s morph + settle
  const probe2 = await send('Runtime.evaluate', { expression: `(() => { const sel = document.querySelector('.leftrail__card--selected'); return JSON.stringify({ selected: sel ? sel.textContent.slice(0, 40) : null }); })()` });
  console.log('CYGNUS probe:', probe2.result?.value);
  await shot(send, new URL('verify-cygnus.png', OUT_DIR));
  console.log('saved shots/verify-cygnus.png');

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
