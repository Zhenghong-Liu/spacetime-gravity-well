import type { CelestialBody } from '../data/bodies';
import ShearScope from '../instruments/ShearScope';
import AccretionDial from '../instruments/AccretionDial';
import HexHeatmap from '../instruments/HexHeatmap';
import './RightRail.css';
import '../instruments/instruments.css';

/**
 * 右栏仪表带（3 个小节，每节 = 加粗黑色标题 + 仪表 + 浅灰分隔条）：
 *   1. GRAVITATIONAL SHEAR GRADIENT —— canvas 示波器（ShearScope）
 *   2. MASS ACCRETION FLOW RATE —— SVG 圆形表盘（AccretionDial）
 *   3. TEMPERATURE DISTRIBUTION —— 蜂窝六边形热图（HexHeatmap）
 * 自适应：小节之间插入 .rightrail__gap（flex:1，间距长到 46~64 封顶），其余富余
 * 高度落到栏尾 .rightrail__tail —— 仪表之间的节奏不会随窗口变高而松散，栏底留
 * 一块与左栏末尾空槽同量级的空白。窗口比参考图矮时间距先收到 26，再由仪表等比缩小。
 * 小节标题字重/字号与仪表面板宽度均按 reference.png 实测。
 */
export default function RightRail({ body }: { body: CelestialBody }) {
  return (
    <aside className="app__rightrail rightrail">
      <section className="rightrail__group">
        <h2 className="rightrail__h2">GRAVITATIONAL SHEAR GRADIENT</h2>
        <div className="rightrail__plot rightrail__plot--shear">
          <ShearScope body={body} />
        </div>
        <div className="rightrail__divider" />
      </section>

      <div className="rightrail__gap" />

      <section className="rightrail__group">
        <h2 className="rightrail__h2">MASS ACCRETION FLOW RATE</h2>
        <div className="rightrail__plot rightrail__plot--dial">
          <AccretionDial body={body} />
        </div>
        <div className="rightrail__divider" />
      </section>

      <div className="rightrail__gap" />

      <section className="rightrail__group">
        <h2 className="rightrail__h2">TEMPERATURE DISTRIBUTION</h2>
        <div className="rightrail__plot rightrail__plot--heat">
          <HexHeatmap body={body} />
        </div>
      </section>

      {/* 栏尾空白：节间距长到上限之后，剩下的富余高度全落在这里 */}
      <div className="rightrail__tail" />
    </aside>
  );
}
