import type { CelestialBody } from '../data/bodies';
import ShearScope from '../instruments/ShearScope';
import AccretionDial from '../instruments/AccretionDial';
import HexHeatmap from '../instruments/HexHeatmap';
import './RightRail.css';
import '../instruments/instruments.css';

/**
 * 右栏仪表带（305px，格间 1px 分隔线 + 加粗黑色小节标题）：
 *   1. GRAVITATIONAL SHEAR GRADIENT —— canvas 示波器（ShearScope）
 *   2. MASS ACCRETION FLOW RATE —— SVG 圆形表盘（AccretionDial）
 *   3. TEMPERATURE DISTRIBUTION —— 蜂窝六边形热图（HexHeatmap）
 * 小节标题字重/字号、垂直节奏与浅灰分隔条均按 reference.png 实测。
 */
export default function RightRail({ body }: { body: CelestialBody }) {
  return (
    <aside className="app__rightrail rightrail">
      <h2 className="rightrail__h2 rightrail__h2--first">GRAVITATIONAL SHEAR GRADIENT</h2>
      <ShearScope body={body} />
      <div className="rightrail__divider rightrail__divider--1" />
      <h2 className="rightrail__h2 rightrail__h2--dial">MASS ACCRETION FLOW RATE</h2>
      <AccretionDial body={body} />
      <div className="rightrail__divider rightrail__divider--2" />
      <h2 className="rightrail__h2 rightrail__h2--heat">TEMPERATURE DISTRIBUTION</h2>
      <HexHeatmap body={body} />
    </aside>
  );
}
