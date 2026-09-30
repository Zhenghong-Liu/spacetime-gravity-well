/** 场景层共用的标量数学件（不依赖 three，供 physics / sheet / 引擎共用） */

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

/** Hermite 平滑阶跃：x<=min 返回 0，x>=max 返回 1 */
export function smoothstep(x: number, min: number, max: number): number {
  if (max - min <= 1e-9) return x >= max ? 1 : 0;
  const t = clamp((x - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 缓动：先慢后快再慢，用于天体切换时的参数插值 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 确定性伪随机（mulberry32）：粒子初值/尘埃分布需要可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
