/**
 * 仪表共用小工具：确定性伪随机（mulberry32）与数值插值。
 * 右栏三个仪表的形状参数全部由 body.shearSeed / body.hexSeed 播种，
 * 保证同一数据每次渲染形状一致、不同天体观感不同。
 */

/** mulberry32 —— 32 位确定性 PRNG，返回 [0,1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 线性插值 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 数值夹取 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 按 t(0-1) 在两色间插值，返回 #rrggbb */
export function mixHex(c0: string, c1: string, t: number): string {
  const p = (c: string): [number, number, number] => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
  const [r0, g0, b0] = p(c0);
  const [r1, g1, b1] = p(c1);
  const h = (v: number) =>
    Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(lerp(r0, r1, t))}${h(lerp(g0, g1, t))}${h(lerp(b0, b1, t))}`;
}
