import { useEffect, useRef } from 'react';
import type { CelestialBody } from '../data/bodies';
import { mulberry32, clamp } from './seeded';

/**
 * GRAVITATIONAL SHEAR GRADIENT —— canvas 实时滚动示波器。
 *
 * 每体参数（freq = 跨画面完整周期数，amp = 归一化振幅，1.0 = 峰值触及顶边）：
 *   sol 1.3/0.55 平滑 · betelgeuse 1.6/0.50 平滑 · sirius-b 2.3/0.70 ·
 *   procyon-b 2.7/1.00 最猛（峰值触顶）· crab-pulsar 3.4/0.85 叠加高频谐波呈锯齿 ·
 *   cygnus-x-1 4.0/0.90 多峰簇，高斯窗集中在画面中 1/3（最剧烈）。
 * 波形 = 低频正弦 + 种子抖动谐波 + （crab）锯齿高频谐波 + 种子高斯峰簇，
 * 高斯窗压两端；滚动相位以 ~0.12 cycles/s（约 8s 一个周期）连续推进，
 * 波形整体持续向右→左滚动。四条迹线共享每体参数，仅各自缩放/相位/线宽/颜色
 * 不同（保持 TRACE_COLORS/TRACE_WIDTHS 层级、图例、细网格底不变）。
 * 切换天体：全部参数每帧指数逼近目标（~0.8-1s 收敛，无跳变）；rAF 持续绘制。
 */

const TAU = Math.PI * 2;
const SCROLL_HZ = 0.12; // 滚动速度，~8.3s 滚过一个周期
const APPROACH_TAU = 0.3; // 指数逼近时间常数，~0.9s 收敛 95%

interface WaveForm {
  freq: number;
  amp: number;
  jag: number;
  win: number;
  jitterA: number;
  jf1: number;
  jp1: number;
  jf2: number;
  jp2: number;
  bc1: number;
  bw1: number;
  ba1: number;
  bc2: number;
  bw2: number;
  ba2: number;
}

interface WavePreset {
  freq: number;
  amp: number;
  jag: number;
  win: number;
  cluster: number;
  jitter: number;
}

/** 每体参数表（任务书给定 freq/amp，jag/win/cluster/jitter 按体性格配平） */
const WAVE_TABLE: Record<string, WavePreset> = {
  'sol':         { freq: 1.3, amp: 0.55, jag: 0.0,  win: 0.20,  cluster: 0.5,  jitter: 0.05 },
  'betelgeuse':  { freq: 1.6, amp: 0.50, jag: 0.0,  win: 0.22,  cluster: 0.45, jitter: 0.05 },
  'sirius-b':    { freq: 2.3, amp: 0.70, jag: 0.18, win: 0.21,  cluster: 0.4,  jitter: 0.07 },
  'procyon-b':   { freq: 2.7, amp: 1.0,  jag: 0.28, win: 0.17,  cluster: 0.6,  jitter: 0.09 },
  'crab-pulsar': { freq: 3.4, amp: 0.85, jag: 0.65, win: 0.20,  cluster: 0.35, jitter: 0.11 },
  'cygnus-x-1':  { freq: 4.0, amp: 0.90, jag: 0.35, win: 0.115, cluster: 0.65, jitter: 0.11 },
};
const WAVE_DEFAULT: WavePreset = WAVE_TABLE['sol'];

/** 图例顺序 = 绘制顺序（由浅到深），颜色与 css 中 .shear__swatch 保持一致 */
const TRACE_COLORS = ['#7c8374', '#5a6152', '#2c3128', '#15170f'];
const TRACE_WIDTHS = [1.1, 1.2, 1.5, 2.6];
/** 四条迹线各自缩放（GRAVITON 满幅，STATION 最弱）与固定相位差 */
const TRACE_SCALES = [0.5, 0.7, 0.86, 1.0];
const TRACE_PHASES = [0, 0.8, 1.6, 2.6];

/** 高斯包络 */
function gauss(u: number): number {
  return Math.exp(-u * u);
}

/** 折到 [-0.5, 0.5)，使峰簇随滚动周期性回卷 */
function wrap(d: number): number {
  return ((((d + 0.5) % 1) + 1) % 1) - 0.5;
}

/** 由每体表 + 种子生成完整参数集（抖动谐波/峰簇细节随种子变化） */
function waveFromBody(id: string, seed: number): WaveForm {
  const p = WAVE_TABLE[id] ?? WAVE_DEFAULT;
  const rnd = mulberry32(seed);
  return {
    freq: p.freq,
    amp: p.amp,
    jag: p.jag,
    win: p.win,
    jitterA: p.amp * p.jitter,
    jf1: 1.7 + rnd() * 0.6,
    jp1: rnd() * TAU,
    jf2: 2.8 + rnd() * 0.8,
    jp2: rnd() * TAU,
    bc1: rnd(),
    bw1: 0.05 + rnd() * 0.04,
    ba1: p.amp * p.cluster * (0.9 + rnd() * 0.5),
    bc2: rnd(),
    bw2: 0.04 + rnd() * 0.03,
    ba2: -p.amp * p.cluster * (0.6 + rnd() * 0.4),
  };
}

/** 逐字段线性混合（含相位/峰位，连续无跳变） */
function lerpWave(cur: WaveForm, tgt: WaveForm, k: number): WaveForm {
  const m = (a: number, b: number) => a + (b - a) * k;
  return {
    freq: m(cur.freq, tgt.freq),
    amp: m(cur.amp, tgt.amp),
    jag: m(cur.jag, tgt.jag),
    win: m(cur.win, tgt.win),
    jitterA: m(cur.jitterA, tgt.jitterA),
    jf1: m(cur.jf1, tgt.jf1),
    jp1: m(cur.jp1, tgt.jp1),
    jf2: m(cur.jf2, tgt.jf2),
    jp2: m(cur.jp2, tgt.jp2),
    bc1: m(cur.bc1, tgt.bc1),
    bw1: m(cur.bw1, tgt.bw1),
    ba1: m(cur.ba1, tgt.ba1),
    bc2: m(cur.bc2, tgt.bc2),
    bw2: m(cur.bw2, tgt.bw2),
    ba2: m(cur.ba2, tgt.ba2),
  };
}

/** 波形采样：x∈[0,1] 屏幕横坐标，sc 滚动相位（周期数），phase/scale 为迹线各自参数 */
function waveAt(w: WaveForm, x: number, sc: number, phase: number, scale: number): number {
  const u = x + sc;
  // 低频正弦主波（每体 freq/amp）
  let v = w.amp * Math.sin(TAU * w.freq * u + phase);
  // 种子抖动谐波（非整数倍频，有机感）
  v += w.jitterA * Math.sin(TAU * w.freq * w.jf1 * u + w.jp1);
  v += w.jitterA * 0.7 * Math.sin(TAU * w.freq * w.jf2 * u + w.jp2);
  // 锯齿高频谐波（crab-pulsar：叠加呈锯齿）
  if (w.jag > 0.002) {
    v += w.jag * w.amp * 0.38 * Math.sin(TAU * w.freq * 3.1 * u + phase * 0.6 + 1.1);
    v += w.jag * w.amp * 0.16 * Math.sin(TAU * w.freq * 5.7 * u + 2.4);
  }
  // 种子高斯峰簇（随波形滚动，周期性回卷）
  v += w.ba1 * gauss(wrap(u - w.bc1) / w.bw1);
  v += w.ba2 * gauss(wrap(u - w.bc2) / w.bw2);
  // 高斯窗：两端收束；cygnus-x-1 的窄窗把峰簇集中在画面中 1/3
  const dw = (x - 0.5) / w.win;
  return v * scale * Math.exp(-dw * dw);
}

export default function ShearScope({ body }: { body: CelestialBody }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const liveRef = useRef<WaveForm | null>(null);
  const cacheRef = useRef(new Map<string, WaveForm>());

  useEffect(() => {
    const box = boxRef.current;
    const cv = cvRef.current;
    if (!box || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastT = -1;
    let cw = 0;
    let ch = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cw = box.clientWidth;
      ch = box.clientHeight;
      cv.width = Math.max(1, Math.round(cw * dpr));
      cv.height = Math.max(1, Math.round(ch * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    const target = (b: CelestialBody): WaveForm => {
      const key = `${b.id}:${b.shearSeed}`;
      let w = cacheRef.current.get(key);
      if (!w) {
        w = waveFromBody(b.id, b.shearSeed);
        cacheRef.current.set(key, w);
      }
      return w;
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (cw < 4 || ch < 4) return;
      const dt = lastT < 0 ? 0 : Math.min((now - lastT) / 1000, 0.1);
      lastT = now;

      // 逐帧指数逼近目标参数（切换天体平滑过渡，~0.8-1s 收敛）
      const tgt = target(bodyRef.current);
      const cur = liveRef.current;
      liveRef.current = cur
        ? lerpWave(cur, tgt, 1 - Math.exp(-dt / APPROACH_TAU))
        : tgt;
      const w = liveRef.current;

      const t = now / 1000;
      const sc = SCROLL_HZ * t; // 滚动相位：~0.12 cycles/s，持续向右→左
      const midY = ch * 0.5;
      const ampPx = ch * 0.5 - 3;

      ctx.clearRect(0, 0, cw, ch);

      // 细网格：10 列（9 条内线）+ 25/50/75% 三条横线（保持不变）
      ctx.strokeStyle = '#b3bdb2';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k < 10; k++) {
        const x = Math.round((cw * k) / 10) + 0.5;
        ctx.moveTo(x, 0.5);
        ctx.lineTo(x, ch - 0.5);
      }
      for (const f of [0.25, 0.5, 0.75]) {
        const y = Math.round(ch * f) + 0.5;
        ctx.moveTo(0.5, y);
        ctx.lineTo(cw - 0.5, y);
      }
      ctx.stroke();

      // 四条滚动波形迹线（共享每体参数，各自缩放/相位/线宽/颜色）
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = TRACE_COLORS[i];
        ctx.lineWidth = TRACE_WIDTHS[i];
        ctx.beginPath();
        for (let px = 0; px <= cw; px += 2) {
          const v = clamp(
            waveAt(w, px / cw, sc, TRACE_PHASES[i], TRACE_SCALES[i]),
            -1.05,
            1.05,
          );
          const y = midY - v * ampPx;
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
        }
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="shear" ref={boxRef}>
      <canvas className="shear__cv" ref={cvRef} />
      <div className="shear__legend" aria-hidden>
        <div className="shear__row">
          <span className="shear__swatch" style={{ width: 19, height: 2, background: '#565d50' }} />
          <span className="shear__lbl">STATION</span>
        </div>
        <div className="shear__row">
          <span className="shear__swatch" style={{ width: 19, height: 2, background: '#565d50' }} />
          <span className="shear__lbl">RAILWAY</span>
        </div>
        <div className="shear__row">
          <span className="shear__swatch" style={{ width: 15, height: 3, background: '#23271f' }} />
          <span className="shear__lbl">EARTHQUAKE</span>
        </div>
        <div className="shear__row">
          <span className="shear__swatch" style={{ width: 14, height: 4, background: '#0e100d' }} />
          <span className="shear__lbl">GRAVITON</span>
        </div>
      </div>
    </div>
  );
}
