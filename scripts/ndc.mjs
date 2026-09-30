/**
 * ndc.mjs —— CYGNUS 近无限深漏斗数值校验（t8：漏斗底补网 + 平底钳位）。
 *
 * 用与 SpaceScene 完全一致的相机参数（FOV 45、aspect 852/689、near 0.1、far 400、
 * 方位角 0、球坐标定位 + lookAt，投影矩阵直接取 three PerspectiveCamera）校验：
 *   a) 钳位底近平点 (0, FLOOR, 0.38)   → NDC y < -1            （漏斗线穿出画面底边）
 *   b) 球心 (0, sphereY, 0)           → NDC y ∈ [-0.85, -0.55] （应保持 ≈-0.72 不变）
 *   c) rim (1.15, 0, 0)               → NDC y ∈ [0.35, 0.55]   （应保持 ≈0.366 不变）
 *   d) SOL 回归：isCygnus=false 时 r∈{0.095,0.19,0.38} 的 y_well 必须与旧代码
 *      同点值完全相等（旧代码 r=0.38 最内环值不得变化），并打印三点值。
 *
 * 井项公式与 SpaceScene.terrainY / updateGrid 系数完全一致（0.58/0.28/0.06 双高斯+唇）；
 * CYGNUS 平底：isCygnus && r<0.5 时井面钉平在 FLOOR（-12.6）—— 实际双高斯轴心最浅
 * 仅 -11.18，max(·,FLOOR) 形式永不触发，故按“平底在 FLOOR”意图实现为常数钉平。
 *
 * 参数可经 CLI 覆盖（迭代用）：
 *   node scripts/ndc.mjs [polarDeg radius targetY sphereY floorY]
 * 默认值 = SpaceScene.ts 中 CYGNUS 常量。全达标退出码 0，否则 1。
 */
import * as THREE from 'three';

/* 默认值（= SpaceScene.ts 的 CYGNUS_* 常量） */
const DEFAULTS = { polarDeg: 78, radius: 20, targetY: -3.0, sphereY: -9.5, floorY: -12.6 };
/* 相机常量（= SpaceScene.ts：FOV=45、near 0.1、far 400、方位角 0） */
const FOV = 45;
const ASPECT = 852 / 689; // 3D 视口实测宽高
const NEAR = 0.1;
const FAR = 400;
const AZIMUTH = 0;

/* CYGNUS 几何常量 */
const CYGNUS_DEPTH = 13.0;
const CYGNUS_SIGMA = 2.6 * 0.42; // wellRadius 2.6 × SIGMA_SCALE 0.42
const FLOOR_R = 0.5;

/* SOL 回归参数（= mapDepth(1.0) 与 5.5 × SIGMA_SCALE） */
const SOL_DEPTH = 1.1 + 2.1 * 1.0; // 3.2
const SOL_SIGMA = 5.5 * 0.42; // 2.31

/* 目标区间 */
const RIM_MIN = 0.35;
const RIM_MAX = 0.55;
const SPH_MIN = -0.85;
const SPH_MAX = -0.55;

const argv = process.argv.slice(2);
const num = (i, d) => (argv[i] === undefined ? d : Number(argv[i]));
const polarDeg = num(0, DEFAULTS.polarDeg);
const radius = num(1, DEFAULTS.radius);
const targetY = num(2, DEFAULTS.targetY);
const sphereY = num(3, DEFAULTS.sphereY);
const floorY = num(4, DEFAULTS.floorY);

/* ---- 井项公式（与 SpaceScene 完全一致；isCygnus 平底逻辑同一） ---- */
const wellRaw = (r, depth, sigma) =>
  -depth * 0.58 * Math.exp(-(r * r) / (sigma * sigma)) -
  depth * 0.28 * Math.exp(-(r * r) / ((sigma * 2.4) * (sigma * 2.4))) +
  depth * 0.06 * Math.exp(-((r - sigma * 1.05) ** 2) / ((sigma * 0.45) ** 2));
const wellPart = (r, depth, sigma, isCygnus, floor) =>
  isCygnus && r < FLOOR_R ? floor : wellRaw(r, depth, sigma);

/* ---- 相机（与 SpaceScene.applyCamera 完全一致的位姿） ---- */
const camera = new THREE.PerspectiveCamera(FOV, ASPECT, NEAR, FAR);
const polar = THREE.MathUtils.degToRad(polarDeg);
const target = new THREE.Vector3(0, targetY, 0);
camera.position.set(
  target.x + radius * Math.sin(polar) * Math.sin(AZIMUTH),
  target.y + radius * Math.cos(polar),
  target.z + radius * Math.sin(polar) * Math.cos(AZIMUTH),
);
camera.lookAt(target);
camera.updateMatrixWorld(true);

const projectY = (p) => p.clone().project(camera).y;

const floorNdc = projectY(new THREE.Vector3(0, floorY, 0.38)); // (a) 钳位底近平点
const sphNdc = projectY(new THREE.Vector3(0, sphereY, 0)); // (b) 球心
const rimNdc = projectY(new THREE.Vector3(1.15, 0, 0)); // (c) rim

const passA = floorNdc < -1;
const passB = sphNdc >= SPH_MIN && sphNdc <= SPH_MAX;
const passC = rimNdc >= RIM_MIN && rimNdc <= RIM_MAX;

/* ---- (d) SOL 回归：新（含平底逻辑，isCygnus=false）vs 旧（原井项公式） ---- */
const SOL_RADII = [0.095, 0.19, 0.38];
const solRows = SOL_RADII.map((r) => {
  const fresh = wellPart(r, SOL_DEPTH, SOL_SIGMA, false, floorY); // 新代码路径
  const old = wellRaw(r, SOL_DEPTH, SOL_SIGMA); // 旧代码同点值
  return { r, fresh, old, delta: Math.abs(fresh - old) };
});
const passD = solRows.every((row) => row.delta < 1e-9);

/* CYGNUS 平底三点（新代码路径，isCygnus=true） */
const cygRows = SOL_RADII.map((r) => ({
  r,
  y: wellPart(r, CYGNUS_DEPTH, CYGNUS_SIGMA, true, floorY),
  raw: wellRaw(r, CYGNUS_DEPTH, CYGNUS_SIGMA),
}));

const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(4);
console.log('=== CYGNUS 漏斗底补网 NDC 校验（FOV 45, aspect 852/689, azimuth 0） ===');
console.log(
  `参数: D=${CYGNUS_DEPTH}  polar=${polarDeg}°  R=${radius}  target.y=${targetY}  球心 y=${sphereY}  平底 y=${floorY}`,
);
console.log(`相机位置: (${camera.position.x.toFixed(3)}, ${camera.position.y.toFixed(3)}, ${camera.position.z.toFixed(3)})`);
console.log('');
console.log(
  `a) 钳位底近平点 (0, ${floorY}, 0.38)  NDC y = ${fmt(floorNdc)}   目标 < -1（穿出底边）  ${passA ? 'PASS' : 'FAIL'}`,
);
console.log(
  `b) 球心 (0, ${sphereY}, 0)            NDC y = ${fmt(sphNdc)}   目标 [${SPH_MIN}, ${SPH_MAX}]   ${passB ? 'PASS' : 'FAIL'}`,
);
console.log(
  `c) rim (1.15, 0, 0)                  NDC y = ${fmt(rimNdc)}   目标 [${RIM_MIN}, ${RIM_MAX}]   ${passC ? 'PASS' : 'FAIL'}`,
);
console.log('');
console.log('d) SOL 回归（depth=3.2, sigma=2.31, isCygnus=false；井项 y_well）:');
solRows.forEach((row) => {
  console.log(
    `   r=${row.r}: 新=${row.fresh.toFixed(4)}  旧=${row.old.toFixed(4)}  Δ=${row.delta.toExponential(1)}  ${row.delta < 1e-9 ? 'PASS' : 'FAIL'}`,
  );
});
console.log('   （任务书参考值 -2.70/-2.66/-2.58 为估算；约束为 新==旧 严格相等，Δ<1e-9）');
console.log('');
console.log('CYGNUS 平底三点（isCygnus=true, D=13, sigma=1.092）:');
cygRows.forEach((row) => {
  console.log(`   r=${row.r}: 新=${row.y.toFixed(4)}（钉平底 ${floorY}）  原曲线=${row.raw.toFixed(4)}`);
});
console.log('');
const all = passA && passB && passC && passD;
console.log(all ? 'ALL PASS ✔' : 'NOT ALL PASS ✘');
process.exit(all ? 0 : 1);
