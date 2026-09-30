import { useEffect, useRef, useState } from 'react';
import type { CelestialBody } from '../data/bodies';
import './BottomBar.css';

/** DATA STREAM 值的固定前缀；末组 4 位十六进制每 2s 微变 */
const STREAM_PREFIX = '0xFE12-A8C4-';
const HEX = '0123456789ABCDEF';
/** ticker 无缝跑马灯速度（px/s） */
const TICKER_SPEED = 70;

function randomHexGroup(len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += HEX[Math.floor(Math.random() * HEX.length)];
  }
  return out;
}

/**
 * 跑马灯单组内容（8 段，尾部分隔符保证两组拼接处 “ · ” 连续 → 无缝循环）。
 * DATA STREAM / OBSERVER FRAME LOCKED 段末各有一个 2px 活动小点。
 */
function TickerSet({ streamTail }: { streamTail: string }) {
  return (
    <span className="bottombar__tickerSet">
      <span className="bottombar__item">OBSERVATION ESTABLISHED</span>
      <span className="bottombar__sep">·</span>
      <span className="bottombar__item">
        <b>FRAMEBUFFER</b> SYNC AT 60.00 Hz
      </span>
      <span className="bottombar__sep">·</span>
      <span className="bottombar__item">
        <span className="bottombar__warning">[WARNING]</span> GRAVITATIONAL
        DIFFERENTIAL EXCEEDS BASELINE
      </span>
      <span className="bottombar__sep">·</span>
      <span className="bottombar__item">SUBSPACE LATTICE COHERENT</span>
      <span className="bottombar__sep">·</span>
      <span className="bottombar__item">
        DATA STREAM <b>{STREAM_PREFIX + streamTail}</b>
        <i className="bottombar__itemDot" aria-hidden="true" />
      </span>
      <span className="bottombar__sep">·</span>
      <span className="bottombar__item">
        OBSERVER FRAME LOCKED
        <i className="bottombar__itemDot" aria-hidden="true" />
      </span>
      <span className="bottombar__sep">·</span>
      <span className="bottombar__item">SIMULATION CORE V02.2 BUILD 1845</span>
      <span className="bottombar__sep">·</span>
      <span className="bottombar__item">
        <span className="bottombar__note">[NOTE]</span> RE-CALIBRATION CYCLE
        PENDING T-00:14:22
      </span>
      <span className="bottombar__sep">·</span>
    </span>
  );
}

/**
 * 底部状态栏（38px，1px 黑竖线分格，等宽小字）。
 * 分格：REC（红点呼吸 + 底部白色指示条呼吸）/ 中部 ticker（rAF 驱动右→左无缝
 * 跑马灯 ~70px/s，内容复制两份；[WARNING] 常态 2.4s 轻闪、cygnus-x-1 下 0.8s
 * 快闪、切换天体瞬间一次性 350ms 高亮脉冲）/ FPS（真实帧率：rAF 计数，每 1s 更新）。
 */
export default function BottomBar({ body }: { body: CelestialBody }) {
  const [fps, setFps] = useState(60);
  const [streamTail, setStreamTail] = useState('0001');
  const [pulse, setPulse] = useState(false);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const prevBodyRef = useRef(body.id);

  // 真实 FPS：requestAnimationFrame 计数，每 1s 用过去 1s 的帧数更新显示
  useEffect(() => {
    let frames = 0;
    let raf = 0;
    const loop = () => {
      frames += 1;
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    const fpsTimer = window.setInterval(() => {
      setFps(frames);
      frames = 0;
    }, 1000);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(fpsTimer);
    };
  }, []);

  // DATA STREAM 末组 4 位十六进制每 2s 微变
  useEffect(() => {
    const streamTimer = window.setInterval(() => {
      setStreamTail(randomHexGroup(4));
    }, 2000);
    return () => window.clearInterval(streamTimer);
  }, []);

  // 跑马灯：rAF 驱动内层 track 的 translateX（右→左 ~70px/s）；
  // track = 两组相同内容，位移到 -一组宽度 时回加 → 无缝循环
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    let raf = 0;
    let last = performance.now();
    let x = 0;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      x -= TICKER_SPEED * dt;
      const half = track.scrollWidth / 2;
      if (half > 0 && x <= -half) {
        x += half;
      }
      track.style.transform = `translateX(${x}px)`;
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  // 天体切换瞬间：warning 段一次性 350ms 高亮脉冲
  useEffect(() => {
    const prev = prevBodyRef.current;
    if (prev === body.id) return undefined;
    prevBodyRef.current = body.id;
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 400);
    return () => window.clearTimeout(timer);
  }, [body.id]);

  return (
    <footer className="app__bottombar bottombar" data-body={body.id}>
      <div className="bottombar__row">
        <span className="bottombar__rec">
          <i className="bottombar__recDot" aria-hidden="true" />
          REC
        </span>

        <div className="bottombar__ticker">
          <span
            ref={trackRef}
            className={
              pulse
                ? 'bottombar__tickerTrack bottombar__tickerTrack--pulse'
                : 'bottombar__tickerTrack'
            }
          >
            <TickerSet streamTail={streamTail} />
            <TickerSet streamTail={streamTail} />
          </span>
        </div>

        <span className="bottombar__fps">FPS {fps}</span>
      </div>

      <i className="bottombar__strip" aria-hidden="true" />

      <i className="bottombar__corner" aria-hidden="true" />
    </footer>
  );
}
