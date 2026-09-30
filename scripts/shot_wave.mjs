// t2 粒子/波浪两帧截图 via raw CDP（无依赖，Node >= 22，仿 shot_t1.mjs）。
// 流程: 打开 http://127.0.0.1:5199 → 取 .stage 矩形写 shots/wave-rect.json
//   → SOL 视口隔 1.8s 截两帧 shots/wave-a.png / wave-b.png（并收集 console error）
//   → 点 .leftrail__card[3]（= cygnus-x-1）切天体，等 ~3s 稳定
//   → 再隔 1.8s 截 shots/wave-c.png / wave-d.png 两帧。
// 判定交给 scripts/diff_wave.mjs（stage 矩形内变化像素占比）。
// 用法: node scripts/shot_wave.mjs   （需 dev 服务在 http://127.0.0.1:5199）

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BIN = '/Users/liuzh/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = 9334;
const TARGET = 'http://127.0.0.1:5199';
const OUT_DIR = fileURLToPath(new URL('../shots/', import.meta.url));
const GAP_MS = 1800; // 两帧间隔（1.5~2s）

const args = [
  '--headless',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--disable-extensions',
  '--user-data-dir=/tmp/shot-wave-profile',
  '--window-size=1440,820',
];
args.push('about:blank');

const browser = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let browserOut = '';
browser.stdout.on('data', (d) => (browserOut += d));
browser.stderr.on('data', (d) => (browserOut += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.error('[TIMEOUT] 90s watchdog');
  browser.kill('SIGKILL');
  process.exit(1);
}, 90_000);

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

const readStage = `(() => {
  const el = document.querySelector('.stage');
  if (!el) return JSON.stringify({ missing: true });
  const r = el.getBoundingClientRect();
  const canvas = el.querySelector('canvas');
  return JSON.stringify({
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
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
  await sleep(3500); // 等 RUNTIME 起来、场景稳定

  const s1 = await send('Runtime.evaluate', { expression: readStage });
  const stage = JSON.parse(s1.result?.value);
  if (stage.missing) throw new Error('.stage not found');
  if (!stage.canvas) throw new Error('webgl canvas not found inside .stage');
  console.log('stageRect:', JSON.stringify(stage.rect));
  console.log('canvas backing store:', JSON.stringify(stage.canvas));
  writeFileSync(OUT_DIR + '/wave-rect.json', JSON.stringify(stage.rect));
  console.log('saved shots/wave-rect.json');

  const shotA = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT_DIR + '/wave-a.png', Buffer.from(shotA.data, 'base64'));
  console.log('saved shots/wave-a.png (SOL, 帧A)');

  await sleep(GAP_MS);

  const shotB = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT_DIR + '/wave-b.png', Buffer.from(shotB.data, 'base64'));
  console.log(`saved shots/wave-b.png (SOL, 帧B, 间隔 ${GAP_MS / 1000}s)`);

  console.log(`\n=== SOL 阶段 CONSOLE ERRORS (${errors.length}) ===`);
  errors.forEach((e) => console.log(e));

  /* 切换到 CYGNUS X-1（左栏第 4 张卡片，index 3） */
  const click = await send('Runtime.evaluate', {
    expression: `(() => {
      const card = document.querySelectorAll('.leftrail__card')[3];
      if (!card) return 'card3 missing';
      card.click();
      return 'clicked: ' + (card.querySelector('.leftrail__cardName')?.textContent || '');
    })()`,
  });
  console.log('\ncard click →', click.result?.value);
  await sleep(3000); // morph 420ms + 吸入粒子淡入 + 稳定

  const shotC = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT_DIR + '/wave-c.png', Buffer.from(shotC.data, 'base64'));
  console.log('saved shots/wave-c.png (CYGNUS, 帧C)');

  await sleep(GAP_MS);

  const shotD = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT_DIR + '/wave-d.png', Buffer.from(shotD.data, 'base64'));
  console.log(`saved shots/wave-d.png (CYGNUS, 帧D, 间隔 ${GAP_MS / 1000}s)`);

  const newErrors = errors.slice(-50);
  console.log(`\n=== CYGNUS 阶段 CONSOLE ERRORS (总 ${errors.length}, 最近 ${newErrors.length}) ===`);
  newErrors.forEach((e) => console.log(e));

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
