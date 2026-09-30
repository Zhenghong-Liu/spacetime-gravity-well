import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CelestialBody } from '../data/bodies';
import './LeftRail.css';

/** 左栏卡片标题 = headline 去掉尾部 “ <typeLabel>”（headline 约定为 “<NAME> <TYPE>”） */
function shortName(body: CelestialBody): string {
  return body.headline.slice(0, body.headline.length - body.typeLabel.length - 1);
}

/**
 * 参考图进度条实测填充百分比（与 barPercent 数值无对应，两端小字才用
 * String(barPercent) / barLeft —— 见任务书差异②，以 reference.png 放大核对为准）。
 */
const BAR_RENDER_PCT: Record<string, number> = {
  sol: 88,
  'sirius-b': 62,
  'crab-pulsar': 74,
  'cygnus-x-1': 91,
  'procyon-b': 48,
  betelgeuse: 79,
};

/**
 * 左栏天体列表（6 张整行可点卡片，卡片间 1px 虚线分隔）：
 * 首行 “[NAME]” 粗体 + 右侧 4 根小竖条徽标；第二行 “- TYPE” 等宽（选中卡红字）；
 * 两行弱灰等宽 hex；进度行 = barPercent 数值 + 细轨道条 + barLeft 标签。
 * 选中卡黑底白字、红进度填充：左缘 3px 红色指示条 scaleY 0→1 滑入（200ms），
 * 进度条重播 0→fill 填充动画（~650ms ease-out，目标值经 --fill 注入 CSS 动画）；
 * 非选中卡保持静态填充；卡片 :active 轻微按压反馈。
 */
export default function LeftRail({ bodies, selectedId, onSelect }: {
  bodies: CelestialBody[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setArmed(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <nav className="app__leftrail leftrail">
      <ul className="leftrail__list">
        {bodies.map((body) => {
          const selected = body.id === selectedId;
          const fill = BAR_RENDER_PCT[body.id] ?? body.barPercent;
          return (
            <li key={body.id}>
              <button
                type="button"
                className={
                  selected ? 'leftrail__card leftrail__card--selected' : 'leftrail__card'
                }
                onClick={() => onSelect(body.id)}
                aria-pressed={selected}
              >
                <span className="leftrail__cardHead">
                  <span className="leftrail__cardName">[{shortName(body)}]</span>
                  <span className="leftrail__mark" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="leftrail__cardType">- {body.typeLabel}</span>
                <span className="leftrail__cardHex">
                  {body.hexTop}
                  <br />
                  {body.hexBottom}
                </span>
                <span className="leftrail__cardBar">
                  <span className="leftrail__barVal">{body.barPercent}</span>
                  <span className="leftrail__barTrack">
                    <span
                      className="leftrail__barFill"
                      style={
                        {
                          transform: `scaleX(${armed ? fill / 100 : 0})`,
                          '--fill': String(fill / 100),
                        } as CSSProperties
                      }
                    />
                  </span>
                  <span className="leftrail__barVal">{body.barLeft}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
