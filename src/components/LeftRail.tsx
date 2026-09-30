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
 * 左栏天体列表 —— 排版逐行按 reference.png 实测（CSS px，栏宽 267）：
 * 卡片是「等距槽位」而不是「撑满的内容块」。参考图把整栏切成 7 个等高槽位，
 * 前 6 个放卡片，第 7 个是末尾空槽（虚线只画到第 6 张卡下面），所以再高的窗口
 * 也只是槽位等比变长，卡片内部的行距不会被拉开 —— 这里用 flex:1 的 6 个卡片项
 * + 1 个 tail 项复现。末尾空槽不参与等分，固定占整栏 7.5%（≈ 半张卡）：
 * 参考图那一格与卡片等高（1/7）是 820 高画布的比例，窗口更高时按等分会让栏底
 * 空白跟着翻倍，按百分比则始终是同一块留白。
 * 卡内行位（相对卡顶）：标题 11 / 「- TYPE」29 / hex 两行 47·59 / 进度行 77，
 * 虚线压在进度行下方 12px 处（参考图 86），卡顶到虚线之间的空隙属于卡片本体，
 * 黑底选中卡铺满整个槽位（参考图黑块高度 = 槽位高度，不是内容高度）。
 * 首行 “[NAME]” 粗体 + 右侧 4 根小竖条徽标；第二行 “- TYPE” 等宽（选中卡红字）；
 * 两行弱灰等宽 hex；进度行 = barPercent 数值 + 细轨道条 + barLeft 标签。
 * 动效：选中时进度条重播 0→fill 填充（~650ms ease-out，目标值经 --fill 注入）；
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
            <li
              key={body.id}
              className={
                selected ? 'leftrail__item leftrail__item--selected' : 'leftrail__item'
              }
            >
              <button
                type="button"
                className={selected ? 'leftrail__card leftrail__card--selected' : 'leftrail__card'}
                onClick={() => onSelect(body.id)}
                aria-pressed={selected}
              >
                <span className="leftrail__cardBody">
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
                </span>
              </button>
            </li>
          );
        })}
        {/* 参考图末尾的第 7 个空槽：固定占整栏 7.5%，虚线不画在它下面 */}
        <li className="leftrail__item leftrail__item--tail" aria-hidden="true" />
      </ul>
    </nav>
  );
}
