import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vite';

/**
 * 两种构建：
 *  - 默认 `npm run build` → dist/，常规多文件站点（部署到任意静态托管）。
 *  - `npm run build:desktop` → desktop/web/index.html，整站内联成单个 HTML。
 *    桌面壁纸壳（macOS 原生 app / Windows Lively / Ubuntu 浏览器 kiosk）用 file://
 *    直接读盘即可：WebKit 和 Chromium 都不允许在 file:// 或自定义 scheme 上跨源
 *    加载 ES module，内联之后没有任何外部请求，所以不需要任何本地 HTTP 服务器。
 */
export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
    // 相对资源路径：产物既能挂在任意子目录托管，也能被 file:// 直接打开
    base: './',
    plugins: desktop ? [react(), viteSingleFile()] : [react()],
    build: {
      outDir: desktop ? 'desktop/web' : 'dist',
      emptyOutDir: true,
    },
  };
});
