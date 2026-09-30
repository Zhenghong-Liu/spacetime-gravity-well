/**
 * sheet.ts —— 时空膜的高度场：引力势 + 波动。
 *
 *   y(r, θ, t) = 势井（软化牛顿势，远场严格平直）+ 环境行波 + 切换波前
 *
 * 远场不再有任何静态丘陵/沙丘项：z → -μ/r → 0，斜率 ∝ 1/r²，视觉上就是水平面。
 * 「动」全部来自动态项：
 *   1) 环境行波：三列径向行波 + 两阶方位模（m=2、m=3），共 5 个独立频率。
 *      波长刻意拉开（λ ≈ 21 / 10 / 40 / 24 / 16），周期拉到 9～26 秒，
 *      其中一列径向波和 m=3 方位模反向传播，两阶方位模各自缓慢整体旋转
 *      （SPA/SPB）—— 叠加之后没有公共周期，起伏看起来是「涌」而不是「抖」。
 *      井口内被包络压掉，避免扰动盖掉井的剖面；盘缘前收干。
 *   2) 切换波前：换天体时在井底激发一个高斯环包，以有限速度 FRONT_SPEED 向外传播，
 *      振幅按柱面波 1/√r 几何扩散衰减 + 时间指数衰减。切换因此读作「一次扰动扫过整张膜」，
 *      而不是整张膜瞬时被捏成新形状。
 *
 * 求值按「环 × 辐条」分离：势与径向行波只依赖 r，方位模可分离变量，
 * 于是整张网格（≈1.2 万顶点）每帧只需 92 次环求值 + 128 次辐条求值 + 一次乘加，
 * 而不是 1.2 万次三角函数。sheetHeight() 走同一套分解，保证粒子与网格严格同相。
 */
import { smoothstep } from './util';

/**
 * 环境行波：三列径向行波 + 两阶方位模（m=2、m=3），共 5 个独立频率。
 *
 * 波长刻意拉开（λ ≈ 21 / 10 / 40 / 24 / 16），周期拉到 9～26 秒，
 * 其中一列径向波和 m=3 方位模反向传播，两阶方位模各自缓慢整体旋转
 * （SPA/SPB）—— 叠加之后没有公共周期，起伏看起来是「涌」而不是「抖」。
 * 各分量振幅之和归一化到 WAVE_NORM，于是 sheet.waveAmp 就是波峰的实际高度，
 * 调观感只需改这一个数。
 */
const K1 = 0.30, W1 = 0.42, A1 = 1.00, P1 = 0.0;   // λ≈21.0  周期 15.0s 向外，主 swell
const K2 = 0.62, W2 = 0.68, A2 = 0.52, P2 = 1.9;   // λ≈10.1  周期  9.2s 向内
const K3 = 0.155, W3 = 0.24, A3 = 0.68, P3 = 3.7;  // λ≈40.5  周期 26.2s 向外，超长缓波
const MA = 2, KA_A = 0.26, WA_A = 0.31, AA = 0.60, SPA = 0.19;  // 方位 m=2
const MB = 3, KA_B = 0.40, WA_B = 0.23, AB = 0.36, SPB = -0.13; // 方位 m=3
/** 方位模阶数个数；SpaceScene 按这个长度分配环/辐条系数数组 */
export const AZ_MODES = 2;
const WAVE_NORM = 1 / (A1 + A2 + A3 + AA + AB);

/** 切换波前 */
const FRONT_SPEED = 21; // 世界单位 / 秒
const FRONT_K = 1.15;
const FRONT_OMEGA = 4;
const FRONT_LIFE = 2.6; // 秒，超过后完全忽略
const FRONT_DECAY = 1.25; // 秒，振幅时间常数
export const FRONT_GONE = 3.2;

export interface SheetState {
  /** 场景时间（秒） */
  t: number;
  /** 显示引力参数 μ（切换时插值） */
  mu: number;
  /** 芯半径 a（切换时插值） */
  coreR: number;
  /** 环境行波振幅（0 = 静止） */
  waveAmp: number;
  /** 井深呼吸乘子（≈1±0.04），让整张膜连同井底的球一起缓慢起伏 */
  breath: number;
  /** 网格淡出半径（盘缘） */
  discR: number;
  /** 距上次切换的秒数；<0 表示没有波前 */
  frontAge: number;
  /** 波前强度，正比于本次切换的井深变化量 */
  frontAmp: number;
}

export const IDLE_FRONT = -1;

/** 波动项的径向包络：井口内不受扰（保住势井剖面），盘缘前收干 */
function waveEnvelope(r: number, s: SheetState): number {
  const a = s.coreR;
  const inner = smoothstep(r, a * 2.0, a * 5);
  if (inner < 1e-3) return 0;
  return inner * (1 - smoothstep(r, s.discR - 9, s.discR));
}

/** 只依赖 r 的部分：势井 + 三列径向行波 + 切换波前 */
export function ringBase(r: number, s: SheetState): number {
  const a = s.coreR;
  let y = (-s.mu * s.breath) / Math.sqrt(r * r + a * a);

  const env = waveEnvelope(r, s);
  if (env > 1e-3) {
    if (s.waveAmp > 1e-4) {
      const amp = s.waveAmp * WAVE_NORM * env;
      const t = s.t;
      y += amp * (
        A1 * Math.sin(r * K1 - t * W1 + P1) +
        A2 * Math.sin(r * K2 + t * W2 + P2) +
        A3 * Math.sin(r * K3 - t * W3 + P3)
      );
    }
    const fa = s.frontAge;
    if (s.frontAmp > 1e-4 && fa >= 0 && fa <= FRONT_LIFE) {
      const front = FRONT_SPEED * fa;
      const d = r - front;
      const sigma = 1.5 + 0.9 * fa;
      if (d > -3 * sigma && d < 3 * sigma) {
        const g = Math.exp(-(d * d) / (2 * sigma * sigma));
        const spread = 1 / Math.sqrt(1 + 0.16 * front);
        y += s.frontAmp * env * g * spread * Math.exp(-fa / FRONT_DECAY) *
          Math.sin(d * FRONT_K - fa * FRONT_OMEGA);
      }
    }
  }
  return y;
}

/**
 * 第 m 阶方位模的可分离系数（只依赖 r），与 spokeFactor 相乘得到该项的高度贡献。
 * m=0 → 二阶（四瓣），m=1 → 三阶（六瓣）。
 */
export function ringAz(r: number, s: SheetState, m: number): number {
  if (s.waveAmp <= 1e-4) return 0;
  const env = waveEnvelope(r, s);
  if (env <= 1e-3) return 0;
  const amp = s.waveAmp * WAVE_NORM * env;
  return m === 0
    ? amp * AA * Math.sin(r * KA_A - s.t * WA_A)
    : amp * AB * Math.sin(r * KA_B + s.t * WA_B + 2.3);
}

/** 只依赖 θ 的部分（每个辐条、每一阶方位模求值一次） */
export function spokeFactor(theta: number, s: SheetState, m: number): number {
  return m === 0
    ? Math.sin(MA * theta + s.t * SPA)
    : Math.cos(MB * theta + s.t * SPB);
}

/** 膜高。粒子 / 贴地小方块 / 球体走这个入口，与网格共用同一分解 */
export function sheetHeight(r: number, theta: number, s: SheetState): number {
  let y = ringBase(r, s);
  for (let m = 0; m < AZ_MODES; m++) y += ringAz(r, s, m) * spokeFactor(theta, s, m);
  return y;
}

/** 势井本身（不含波动）在半径 r 处的高度 —— 用来安放球体，让它始终贴在井底 */
export function potentialAt(r: number, s: SheetState): number {
  const a = s.coreR;
  return (-s.mu * s.breath) / Math.sqrt(r * r + a * a);
}

/**
 * 球心高度：恒星「坐在」膜上，被引力势托住，且绝不穿过膜。
 *
 * 球面下缘 g(ρ) = y_c − √(R²−ρ²)，膜 z(ρ) = −μ/√(ρ²+a²)。
 * 不接触的条件是 y_c ≥ z(ρ) + √(R²−ρ²) 对所有 ρ∈[0,R] 成立；
 * 取右侧的最大值 = 球在重力下沉到「刚好被膜托住」的最低位置。
 *
 * 该函数导数符号由 h(ρ) = μ/(ρ²+a²)^1.5 − 1/√(R²−ρ²) 给出，h 严格单调递减，
 * 所以极值唯一：井比球弯（h(0) ≤ 0，即 R ≤ a²/depth）时点接触在轴上，
 * 否则在 h 的零点处形成一圈接触环（球楔进井口）。
 */
export function seatSphere(mu: number, a: number, R: number): number {
  const f = (rho: number) => -mu / Math.sqrt(rho * rho + a * a) + Math.sqrt(R * R - rho * rho);
  if (mu / (a * a * a) <= 1 / R) return f(0);
  let lo = 0;
  let hi = R * (1 - 1e-7);
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) * 0.5;
    const h = mu / Math.pow(m * m + a * a, 1.5) - 1 / Math.sqrt(R * R - m * m);
    if (h > 0) lo = m;
    else hi = m;
  }
  return f((lo + hi) * 0.5);
}
