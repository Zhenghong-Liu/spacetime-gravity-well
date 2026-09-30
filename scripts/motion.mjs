// 动效验证（raw CDP，无依赖）：
//   1) 同一帧位间隔 0.4s 连拍两帧 → 证明环境行波在动（截差值）
//   2) 点击切换后 ~420ms 抢一帧 → 证明切换波前从井底向外扫过
//   3) 读底部条 FPS
// 用法: node scripts/motion.mjs [bodyIndexToTestMorph]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const BIN = '/Users/liuzh/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = 9335;
const TARGET = 'http://127.0.0.1:5199';
const OUT = new URL('../shots/', import.meta.url);
mkdirSync(new URL('../shots/', import.meta.url), { recursive: true });
const MORPH_TARGET = Number(process.argv[2] ?? 3);

const browser = spawn(BIN, [
  '--headless', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--disable-extensions', '--user-data-dir=/tmp/motion-profile', '--window-size=1440,820',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let blog = '';
browser.stdout.on('data', (d) => (blog += d));
browser.stderr.on('data', (d) => (blog += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`); if (r.ok) return r.json(); } catch {}
    await sleep(200);
  }
  throw new Error('no CDP\n' + blog.slice(-1500));
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push('[uncaught] ' + (m.params.exception?.description || m.params.text));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, send, errors };
}

const clipShot = async (send, rect, path) => {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 0.72 },
  });
  writeFileSync(path, Buffer.from(data, 'base64'));
};

try {
  const t = await targets();
  const page = t.find((x) => x.type === 'page') ?? t[0];
  const { ws, send, errors } = connect(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: TARGET });
  await sleep(3500);

  const rectRes = await send('Runtime.evaluate', {
    expression: `(() => { const b = document.querySelector('.stage').getBoundingClientRect(); return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height}); })()`,
  });
  const rect = JSON.parse(rectRes.result.value);

  // 1) 行波动画：同一天体间隔 0.4s
  await clipShot(send, rect, new URL('wave-a.png', OUT));
  await sleep(400);
  await clipShot(send, rect, new URL('wave-b.png', OUT));
  console.log('saved wave-a.png / wave-b.png (0.4s apart, same body)');

  // 2) 切换波前：点击后 420ms
  await send('Runtime.evaluate', {
    expression: `document.querySelectorAll('.leftrail__card')[${MORPH_TARGET}].click()`,
  });
  await sleep(420);
  await clipShot(send, rect, new URL('morph-mid.png', OUT));
  await sleep(1600);
  await clipShot(send, rect, new URL('morph-settled.png', OUT));
  console.log('saved morph-mid.png / morph-settled.png');

  // 3) FPS
  const fps = await send('Runtime.evaluate', {
    expression: `(() => { const el=[...document.querySelectorAll('*')].find(e=>/^FPS\\s*\\d+/.test((e.textContent||'').trim()) && e.children.length===0); return el?el.textContent.trim():'n/a'; })()`,
  });
  console.log('fps readout:', fps.result?.value);

  console.log('errors:', errors.length, errors.slice(0, 5).join(' | '));
  ws.close();
} catch (e) {
  console.error('FATAL:', e.message, '\n', blog.slice(-1500));
  process.exitCode = 1;
} finally { browser.kill('SIGKILL'); }
