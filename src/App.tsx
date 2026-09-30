import { useState } from 'react';
import { BODIES, DEFAULT_BODY_ID } from './data/bodies';
import type { CelestialBody } from './data/bodies';
import TopBar from './components/TopBar';
import LeftRail from './components/LeftRail';
import CenterStage from './components/CenterStage';
import RightRail from './components/RightRail';
import BottomBar from './components/BottomBar';
import './App.css';

/**
 * 布局骨架（CSS Grid，尺寸来自 reference.png 实测，tokens 见 styles/tokens.css）：
 *   行：顶栏 82px / 中部 1fr / 底栏 30px
 *   列：左栏 267px / 3D 视口 1fr / 右栏 305px
 * 整体 2px 黑色外框，应用占满视口、无页面滚动条。
 */
export default function App() {
  const [selectedId, setSelectedId] = useState(DEFAULT_BODY_ID);
  const selected: CelestialBody =
    BODIES.find((body) => body.id === selectedId) ?? BODIES[0];

  return (
    <div className="app">
      <TopBar body={selected} />
      <LeftRail bodies={BODIES} selectedId={selectedId} onSelect={setSelectedId} />
      <CenterStage body={selected} />
      <RightRail body={selected} />
      <BottomBar body={selected} />
    </div>
  );
}
