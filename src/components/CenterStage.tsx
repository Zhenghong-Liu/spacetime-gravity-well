import { useEffect, useRef, useState } from 'react';
import type { CelestialBody } from '../data/bodies';
import { SpaceScene } from '../scene/SpaceScene';
import { getPhysics } from '../scene/physics';
import { readouts, distortionLevel, fmtHorizon, fmtEscape } from '../scene/hudReadouts';
import { clamp, easeInOutCubic, lerp } from '../scene/util';
import './CenterStage.css';

/**
 * 中间 3D 视口：three.js 场景（SpaceScene）+ 叠加标注层。
 * 叠加层（标题/读数/角标/底部标注）均 pointer-events:none，不挡轨道拖拽。
 *
 * 右上三个读数由 physics.ts 的真实量算出（R/Rs、v_esc/c、紧致度分档），
 * 切换天体时在**对数空间**用 easeInOutCubic 滚到新值，时长与 3D 网格的
 * morph 一致（1000ms），所以数字滚动和井的形变是同一个动作。
 * 对数插值是因为这些量横跨 5 个数量级（R/Rs 从 1.00 到 1.8e7），
 * 线性插值会在第一帧就冲到头。
 */

/** 与 SpaceScene.MORPH_MS 对齐 */
const ROLL_MS = 1000;

/** 在两个标量数组之间做对数空间缓动；符号改变或过零时退回线性 */
function useLogRoll(targets: number[], ms: number): number[] {
  const [shown, setShown] = useState(targets);
  const currentRef = useRef(targets);
  const key = targets.join(',');

  useEffect(() => {
    const from = currentRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const e = easeInOutCubic(clamp((now - start) / ms, 0, 1));
      const next = targets.map((t, i) => {
        const a = from[i] ?? t;
        return a > 0 && t > 0 ? Math.exp(lerp(Math.log(a), Math.log(t), e)) : lerp(a, t, e);
      });
      currentRef.current = next;
      setShown(next);
      if (e < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // targets 由 body.id 决定，用序列化结果做依赖，避免每次 render 都重启动画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);

  return shown;
}

export default function CenterStage({ body }: { body: CelestialBody }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: SpaceScene | null = null;
    try {
      scene = new SpaceScene(host);
      sceneRef.current = scene;
    } catch (error) {
      // WebGL 上下文不可用时 three.js 会 throw；降级为纯叠加层，不拖垮整棵组件树
      console.error('SpaceScene init failed:', error);
      sceneRef.current = null;
    }
    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setBody(body);
  }, [body]);

  const r = readouts(getPhysics(body.id));
  const [horizon, escape, psi] = useLogRoll(
    [r.horizonRadii, r.escapeFraction, r.compactness],
    ROLL_MS,
  );
  /* 档位跟着滚动中的紧致度走，所以在数字越过数量级边界的那一刻才改字 ——
   * 读起来像「数值滚上去了，评级才被顶到下一档」，而不是同时硬切。 */
  const distortion = distortionLevel(psi);

  return (
    <section className="app__stage stage">
      <div ref={hostRef} className="stage__viewport" />

      <i className="stage__corner stage__corner--tl" aria-hidden="true" />
      <i className="stage__corner stage__corner--tr" aria-hidden="true" />
      <i className="stage__corner stage__corner--bl" aria-hidden="true" />
      <i className="stage__corner stage__corner--br" aria-hidden="true" />

      <div className="stage__hud">
        <header className="stage__headlineBlock">
          <h1 key={body.id} className="stage__headline">{body.headline}</h1>
          <p className="stage__version">02.2</p>
          <p className="stage__corever">SIMULATION CORE VER. 02.2</p>
        </header>

        <dl className="stage__readouts">
          <div className="stage__readout">
            <dt className="stage__readoutLabel">EVENT HORIZON DISTANCE:</dt>
            <dd className="stage__readoutValue">{fmtHorizon(horizon)}</dd>
          </div>
          <div className="stage__readout">
            <dt className="stage__readoutLabel">JET ALIGNMENT:</dt>
            <dd className="stage__readoutValue">{fmtEscape(escape)}</dd>
          </div>
          <div className="stage__readout">
            <dt className="stage__readoutLabel">FIELD DISTORTION:</dt>
            <dd key={`fd-${distortion}`} className="stage__readoutValue">{distortion}</dd>
          </div>
        </dl>
      </div>

      <footer className="stage__engine">
        <p className="stage__engineTitle">SINGULARITY ENGINE</p>
        <p className="stage__engineVersion">02.2</p>
        <p className="stage__engineMeta">
          <span className="stage__engineGroup">
            <i className="stage__triangle" aria-hidden="true" />
            SUBSCIENCE@NB CORE V02.2
          </span>
          <span className="stage__engineGroup">
            <i className="stage__triangle" aria-hidden="true" />
            PARAMETER SET
          </span>
        </p>
      </footer>
    </section>
  );
}
