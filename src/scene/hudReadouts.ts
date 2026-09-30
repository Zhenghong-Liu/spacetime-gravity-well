/**
 * hudReadouts.ts —— 把 physics.ts 的真实量换算成视口右上三个读数。
 *
 * 全部只依赖质量与半径，不含任何手调数字：
 *   EVENT HORIZON DISTANCE  R / Rs   天体表面在自身史瓦西半径外多少个 Rs（黑洞恰为 1.00）
 *   JET ALIGNMENT           v_esc/c  表面逃逸速度 / 光速，相对论性喷流能否准直的物理判据
 *   FIELD DISTORTION        Ψ 档位   按紧致度 GM/(Rc²) 落在哪个数量级区间
 *
 * 三个量都随紧致度严格单调，所以六颗天体的读数天然保序 ——
 * 这一点和原来 bodies.ts 里手写的字符串不同（原来 Procyon B 比 Sirius B 低、
 * Betelgeuse 却标 MEDIUM，与物理顺序矛盾）。
 */
import type { BodyPhysics } from './physics';

/** FIELD DISTORTION 的取值（原在 data/bodies.ts，现由紧致度分档产生） */
export type FieldDistortion = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface HudReadouts {
  /** R/Rs，无量纲 */
  horizonRadii: number;
  /** 表面逃逸速度 / 光速，0..1 */
  escapeFraction: number;
  /** 表面引力红移 z */
  redshift: number;
  /** 紧致度 Ψ */
  compactness: number;
}

export function readouts(p: BodyPhysics): HudReadouts {
  return {
    horizonRadii: p.radiiToHorizon,
    escapeFraction: p.escapeFraction,
    redshift: p.surfaceRedshift,
    compactness: p.compactness,
  };
}

/** 紧致度分档：每档约两个数量级，覆盖超巨星 2.8e-8 → 黑洞 0.5 */
export function distortionLevel(psi: number): FieldDistortion {
  if (psi < 1e-5) return 'LOW';
  if (psi < 1e-3) return 'MEDIUM';
  if (psi < 0.3) return 'HIGH';
  return 'EXTREME';
}

/** 3 位有效数字：<0.01 或 ≥1e5 用科学计数，其余用定点，保证等宽列不跳动 */
function sig3(v: number): string {
  if (!Number.isFinite(v)) return 'inf';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 0.01 || a >= 1e5) return v.toExponential(2).replace('e+', 'e');
  if (a >= 1000) return String(Math.round(v));
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export const fmtHorizon = (rOverRs: number): string => `${sig3(rOverRs)} Rs`;
export const fmtEscape = (beta: number): string => `${sig3(beta)}c`;
export const fmtRedshift = (z: number): string => sig3(z);
