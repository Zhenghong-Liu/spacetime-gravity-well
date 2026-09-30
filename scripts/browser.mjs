// 共享的无头浏览器定位（scripts/*.mjs 都用 raw CDP，不装 playwright）。
// 顺序：CHROME_BIN 环境变量 → playwright 缓存里的 chrome-headless-shell → 系统 Chrome。
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

export function findBin() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const cache = `${homedir()}/Library/Caches/ms-playwright`;
  try {
    for (const d of readdirSync(cache).sort().reverse()) {
      if (!d.startsWith('chromium_headless_shell')) continue;
      const p = `${cache}/${d}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
      if (existsSync(p)) return p;
    }
  } catch {}
  const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(sys)) return sys;
  throw new Error('找不到 headless chromium，请用 CHROME_BIN=/path/to/chrome 指定');
}
