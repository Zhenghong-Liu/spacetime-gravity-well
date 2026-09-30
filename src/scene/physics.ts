/**
 * physics.ts —— 六个天体的真实参数，以及它们如何被换算成屏幕上的引力势。
 *
 * 一张时空膜在这里只有两个自由度：
 *   a   芯半径（软化长度）＝ 天体的显示半径，决定井口/喉部有多窄
 *   μ   显示引力参数 ＝ depth · a，决定井有多深
 * 膜高 z(r) = -μ / √(r² + a²)   ← 软化（regularized）牛顿势
 *   r ≫ a 时回到 -μ/r（正确的 1/r 长尾，远场自然摊平）
 *   r = 0 处有限，z = -μ/a = -depth（井底），避免真实 1/r 的发散
 * 这个形式对均匀球体外壳是精确的正则化，因此「越致密 → 井又深又窄」是自动涌现的，
 * 不需要给每个天体手工拼形状。
 *
 * 真实紧致度 Ψ = GM/(Rc²) 横跨 7 个数量级（超巨星 2.8e-8 → 黑洞 0.5），
 * 线性映射无法显示，所以用幂律压缩。压缩后严格保序：
 *   depth ∝ Ψ^0.18      越致密井越深
 *   a     ∝ R^(1/9)     体积越大井越宽
 *   ω     = √(μ/(r²+a²)^1.5) 在 r=a 处取值 —— 即天体表面的开普勒角速度，
 *                         半径越小自转越快（角动量守恒的直接结果）
 */

/** 天体真实参数（IAU/NASA 常用值；黑洞取事件视界半径 Rs = 2GM/c²） */
export interface RealBody {
  id: string;
  /** 质量，单位太阳质量 */
  massSolar: number;
  /** 半径，单位 km */
  radiusKm: number;
  note: string;
}

export const REAL_BODIES: Record<string, RealBody> = {
  sol: { id: 'sol', massSolar: 1.0, radiusKm: 695_700, note: 'G2V 主序星' },
  'sirius-b': { id: 'sirius-b', massSolar: 1.02, radiusKm: 5_850, note: 'DA2 白矮星' },
  'crab-pulsar': { id: 'crab-pulsar', massSolar: 1.4, radiusKm: 12, note: '毫秒级脉冲星' },
  'cygnus-x-1': { id: 'cygnus-x-1', massSolar: 14.8, radiusKm: 43.71, note: '恒星质量黑洞，取 Rs' },
  'procyon-b': { id: 'procyon-b', massSolar: 0.6, radiusKm: 1_450, note: 'DA 白矮星' },
  betelgeuse: { id: 'betelgeuse', massSolar: 16.5, radiusKm: 8.83e8, note: 'M2Iab 红超巨星' },
};

/* SI 常数 */
const G = 6.6743e-11;
const C2 = 8.98755179e16; // c²
const M_SUN = 1.98892e30;
const R_SUN = 6.957e8;

/** 显示标定：太阳的井深 / 芯半径（世界单位），其余天体按幂律相对它缩放 */
const DEPTH_UNIT = 1.05;
const CORE_UNIT = 1.5;
/** 幂律压缩指数 */
const DEPTH_EXP = 0.18;
const CORE_EXP = 1 / 9;
/**
 * 视界发散因子：井深再乘 (1 − 2Ψ)^−DEPTH_HANG。
 * 2Ψ = Rs/R → 1 时天体表面就是事件视界，膜在那里继续往下无限延伸（没有「底」可坐），
 * 所以井深应当发散。中子星 2Ψ≈0.34 几乎不受影响，黑洞被截断在一个可渲染的有限值上，
 * 于是「中子星看得见尖底 / 黑洞扎出画面下沿」这个差别是公式自己给出的，不是手调的。
 */
const DEPTH_HANG = 0.18;
const HANG_LIMIT = 0.97;
/** 自转显示系数：表面开普勒角速度 × 该系数（1 rad/s 已经转得很快，直接取会糊） */
const SPIN_GAIN = 0.4;

export interface BodyPhysics {
  id: string;
  massSolar: number;
  radiusKm: number;
  /** 真实紧致度 GM/(Rc²)，黑洞恰为 0.5 */
  compactness: number;
  /** 相对于太阳的紧致度比（HUD 与调试用） */
  compactnessVsSun: number;
  /** 视界发散因子 (1−2Ψ)^−0.18，越接近事件视界越大 */
  horizonHang: number;
  /** 井深（世界单位，r=0 处的膜高绝对值） */
  depth: number;
  /** 芯半径 a ＝ 线框球的显示半径 */
  coreR: number;
  /** 显示引力参数 μ = depth · a */
  mu: number;
  /** 自转角速度 rad/s（表面开普勒率 × SPIN_GAIN） */
  spin: number;
  /** 井口（膜高为井深一半）半径 = a */
  throatR: number;
  /** 逃逸到无穷远所需的特征半径：μ 衰减到井口处 1/10 的位置 */
  influenceR: number;
  /* ---- 以下为 HUD 读数用的真实量（不做显示压缩，纯 SI） ---- */
  /** 该质量对应的史瓦西半径 Rs = 2GM/c²，单位 km */
  schwarzschildKm: number;
  /** 天体表面在自身史瓦西半径外多少个 Rs —— 黑洞恰为 1.00 */
  radiiToHorizon: number;
  /** 表面逃逸速度 / 光速 = √(2Ψ)，相对论性喷流的物理判据 */
  escapeFraction: number;
  /** 表面引力红移 z = 1/√(1−2Ψ) − 1 */
  surfaceRedshift: number;
}

function derive(real: RealBody, sunPsi: number): BodyPhysics {
  const massKg = real.massSolar * M_SUN;
  const radiusM = real.radiusKm * 1e3;
  const compactness = (G * massKg) / (radiusM * C2);
  const ratio = compactness / sunPsi;
  const twoPsi = Math.min(2 * compactness, HANG_LIMIT);
  const hang = Math.pow(1 - twoPsi, -DEPTH_HANG);
  const depth = DEPTH_UNIT * Math.pow(ratio, DEPTH_EXP) * hang;
  const coreR = CORE_UNIT * Math.pow(radiusM / R_SUN, CORE_EXP);
  const mu = depth * coreR;
  // ω(r) = √(μ / (r²+a²)^1.5)，取 r = a：天体表面的开普勒角速度
  const spin = SPIN_GAIN * Math.sqrt(mu / Math.pow(2 * coreR * coreR, 1.5));
  /* HUD 真实量：与显示压缩无关，纯 SI 推导 */
  const schwarzschildKm = (2 * G * massKg) / (C2 * 1e3);
  const escapeFraction = Math.sqrt(Math.min(2 * compactness, 1));
  const redshiftArg = Math.min(2 * compactness, HANG_LIMIT);
  return {
    id: real.id,
    massSolar: real.massSolar,
    radiusKm: real.radiusKm,
    compactness,
    compactnessVsSun: ratio,
    horizonHang: hang,
    depth,
    coreR,
    mu,
    spin,
    throatR: coreR,
    influenceR: mu * 10 / depth, // z 降到井深 1/10 处：√(r²+a²)=10a → r≈9.95a
    schwarzschildKm,
    radiiToHorizon: real.radiusKm / schwarzschildKm,
    escapeFraction,
    surfaceRedshift: 1 / Math.sqrt(1 - redshiftArg) - 1,
  };
}

const SUN_PSI = (G * M_SUN) / (R_SUN * C2);

export const PHYSICS: Record<string, BodyPhysics> = Object.fromEntries(
  Object.values(REAL_BODIES).map((real) => [real.id, derive(real, SUN_PSI)]),
);

export function getPhysics(id: string): BodyPhysics {
  return PHYSICS[id] ?? PHYSICS.sol;
}

/**
 * 开普勒角速度场：ω(r) = √(μ / (r² + a²)^1.5)。
 * r≫a 时退化为 √(μ/r³)（开普勒第三定律），r→0 有限。
 * 半径越小转得越快 —— 网格上的粒子与球体自转都走这一个公式。
 */
export function keplerOmega(r: number, mu: number, coreR: number): number {
  const d = r * r + coreR * coreR;
  return Math.sqrt(mu / (d * Math.sqrt(d)));
}

/** 半径 r 处近圆轨道所需的比角动量 L = ω·r² */
export function circularL(r: number, mu: number, coreR: number): number {
  return keplerOmega(r, mu, coreR) * r * r;
}
