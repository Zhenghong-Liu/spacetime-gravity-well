import { useEffect, useState } from 'react';
import type { CelestialBody } from '../data/bodies';
import './TopBar.css';

const pad2 = (n: number) => String(n).padStart(2, '0');

function formatDateDDMMYY(d: Date): string {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${pad2(d.getFullYear() % 100)}`;
}

function formatTimeHHMMSS(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * 顶部栏五格（1px 黑竖线分隔，尺寸见 TopBar.css，与 reference.png 实测对齐）：
 * ① SIMULATION TIMESTAMP / 本地当前日期（DD.MM.YY，随分钟边界自动更新）/ 条码块
 * ② 大标题 + SIMULATION TYPE · MASS RATIO · DIST TO SING（值加粗，随选中天体切换，
 *    切换时 ~250ms 快速淡入：b 以 key={值} 重挂载触发 CSS 动画）
 * ③④⑤ CORE STATUS ●ONLINE（红点呼吸）/ RUNTIME 本地实时时钟（HH:MM:SS，每秒刷新）/ SEED 0xA29F（偶发闪）
 */
export default function TopBar({ body }: { body: CelestialBody }) {
  // 本地当前时刻：TIMESTAMP 显示当前日期（DD.MM.YY），RUNTIME 显示当前时刻（HH:MM:SS），每秒刷新
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="app__topbar topbar">
      <div className="topbar__timestamp">
        <span className="topbar__label topbar__label--small">SIMULATION TIMESTAMP</span>
        <strong className="topbar__date">{formatDateDDMMYY(now)}</strong>
        <span className="topbar__barcode" aria-hidden="true" />
      </div>

      <div className="topbar__headline">
        <h1 className="topbar__title">GRAVITATIONAL SPACE-TIME DISTORTION SIMULATOR</h1>
        <p className="topbar__meta">
          <span className="topbar__metaItem">
            SIMULATION TYPE: <b>STELLAR</b>
          </span>
          <span className="topbar__metaItem">
            MASS RATIO: <b key={body.massRatio}>{body.massRatio}</b>
          </span>
          <span className="topbar__metaItem">
            DIST TO SING: <b key={body.distToSing}>{body.distToSing}</b>
          </span>
        </p>
      </div>

      <div className="topbar__cell">
        <span className="topbar__label">CORE STATUS</span>
        <span className="topbar__value topbar__value--online">
          <i className="topbar__dot" aria-hidden="true" />
          ONLINE
        </span>
      </div>

      <div className="topbar__cell">
        <span className="topbar__label">RUNTIME</span>
        <span className="topbar__value">{formatTimeHHMMSS(now)}</span>
      </div>

      <div className="topbar__cell">
        <span className="topbar__label">SEED</span>
        <span className="topbar__value topbar__seed">0xA29F</span>
      </div>

      <i className="topbar__corner" aria-hidden="true" />
    </header>
  );
}
