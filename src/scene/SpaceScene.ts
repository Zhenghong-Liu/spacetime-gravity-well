/**
 * SpaceScene —— 引力时空膜场景引擎（纯 three.js，不依赖 React）。
 *
 * 分工：
 *   physics.ts    真实质量/半径 → 井深 depth、芯半径 a、引力参数 μ、自转 ω
 *   sheet.ts      膜高场 y(r,θ,t) = 软化牛顿势 + 环境行波 + 切换波前
 *   bodyVisuals.ts 机位 / 线型 / 装饰强度
 *   本文件         通用机器：极坐标网格、线框球、受势驱动的粒子、轨道控制、帧循环
 *
 * 为什么是极坐标网格：势是球对称的，Φ(r) 只依赖 r。于是
 *   同心环  ≡ 等势线（每条环是严格水平的圆，除了被波扰动的那部分）
 *   径向辐条 ≡ 场线（全部汇向井底，漏斗壁读作「被吸进去」而不是「折了一刀」）
 * 笛卡尔方格做深窄漏斗会斜切井壁、还会露出方形盘角，是这个版本之前观感不对的主因之一。
 *
 * 切换天体不再混合两个 surface：整张膜由同一族解析式给出，只需插值标量 (μ, a, …)，
 * 形状自然连续演化；同时在井底激发一个以有限速度外传的环形波前，
 * 让「新质量出现」这件事有因果感——先塌陷，再看着涟漪扫过整张膜。
 */
import * as THREE from 'three';
import type { CelestialBody } from '../data/bodies';
import { getPhysics, circularL, type BodyPhysics } from './physics';
import { getVisual, type BodyVisual } from './bodyVisuals';
import {
  sheetHeight, seatSphere, IDLE_FRONT, FRONT_GONE, AZ_MODES,
  ringBase as ringBaseAt, ringAz as ringAzAt, spokeFactor as spokeFactorAt,
  type SheetState,
} from './sheet';
import { clamp, smoothstep, lerp, easeInOutCubic, mulberry32 } from './util';

const POLAR_MIN = THREE.MathUtils.degToRad(15);
const POLAR_MAX = THREE.MathUtils.degToRad(86);
/** 机位距离的绝对上下限（对数跨度 ≈ 当前天体窗口的包络） */
const RADIUS_MIN = 8;
const RADIUS_MAX = 66;
/** 天体切换过渡时长（缓动 μ / a / 机位 / 明暗） */
const MORPH_MS = 1000;

/* ---- 极坐标网格：同心环 × 径向辐条 ---- */
const RING_COUNT = 92;
const SPOKE_COUNT = 128;
const R_MIN = 0.16;
const R_MAX = 30;
/** 盘缘淡出的软硬边界（相对 discR） */
const RIM_SOFT = 4.2;
/** 画出球体半径 / 势井芯半径：略小于 1，露出井口一圈下陷的膜 */
const SPHERE_FIT = 0.8;

/* ---- 装饰 ---- */
const DUST_COUNT = 260;
const BLOCK_COUNT = 12;
/** 受引力势驱动的轨道粒子数 */
const TRAFFIC_COUNT = 260;
/** 粒子积分的时间放大倍率：真实开普勒率在屏幕上太慢，整体等比加速不改变轨道形状 */
const ORBIT_TIME_SCALE = 2.6;
/** 积分子步，保证最内圈 ω·dt ≪ 1 */
const ORBIT_SUBSTEPS = 4;

const DUST_COLOR = new THREE.Color(0x33382f);
const BLOCK_COLOR = 0x2c312a;
const TRAFFIC_COLOR = 0x23271f;
const FILL_LIGHT = new THREE.Color(0xffffff);
const FILL_DARK = new THREE.Color(0x0a0b09);

/** 一帧所需的全部混合后标量 */
interface RunParams {
  mu: number;
  coreR: number;
  depth: number;
  spin: number;
  waveAmp: number;
  discR: number;
  gridOpacity: number;
  dust: number;
  blocks: number;
  traffic: number;
  inflow: number;
  dark: number;
  fov: number;
  camPolar: number;
  camRadius: number;
  camAzimuth: number;
  targetYFrac: number;
  bg: THREE.Color;
  gridColor: THREE.Color;
  wireColor: THREE.Color;
}

/** 把物理量 + 观感量摊平成一个可插值的 RunParams */
function snapshot(phys: BodyPhysics, vis: BodyVisual, out: RunParams): RunParams {
  out.mu = phys.mu;
  out.coreR = phys.coreR;
  out.depth = phys.depth;
  out.spin = phys.spin;
  out.waveAmp = vis.decor.waveAmp;
  out.discR = vis.style.discR;
  out.gridOpacity = vis.style.gridOpacity;
  out.dust = vis.decor.dustOpacity;
  out.blocks = vis.decor.blocksOpacity;
  out.traffic = vis.decor.trafficOpacity;
  out.inflow = vis.decor.inflow;
  out.dark = vis.sphere.dark;
  out.fov = vis.camera.fov;
  out.camPolar = vis.camera.polarDeg;
  out.camRadius = vis.camera.radius;
  out.camAzimuth = vis.camera.azimuthDeg;
  out.targetYFrac = vis.camera.targetYFrac;
  out.bg.setHex(vis.style.background);
  out.gridColor.setHex(vis.style.gridColor);
  out.wireColor.setHex(vis.sphere.wireColor);
  return out;
}

/** 复制一份混合结果，作为下一次切换的起点（morph 未完成时再次切换也不会跳变） */
function copyParams(src: RunParams, dst: RunParams): RunParams {
  dst.mu = src.mu;
  dst.coreR = src.coreR;
  dst.depth = src.depth;
  dst.spin = src.spin;
  dst.waveAmp = src.waveAmp;
  dst.discR = src.discR;
  dst.gridOpacity = src.gridOpacity;
  dst.dust = src.dust;
  dst.blocks = src.blocks;
  dst.traffic = src.traffic;
  dst.inflow = src.inflow;
  dst.dark = src.dark;
  dst.fov = src.fov;
  dst.camPolar = src.camPolar;
  dst.camRadius = src.camRadius;
  dst.camAzimuth = src.camAzimuth;
  dst.targetYFrac = src.targetYFrac;
  dst.bg.copy(src.bg);
  dst.gridColor.copy(src.gridColor);
  dst.wireColor.copy(src.wireColor);
  return dst;
}

function newRunParams(): RunParams {
  return {
    mu: 0, coreR: 1, depth: 1, spin: 0, waveAmp: 0, discR: 24,
    gridOpacity: 0.6, dust: 0, blocks: 0, traffic: 0, inflow: 0, dark: 0,
    fov: 34, camPolar: 76, camRadius: 16, camAzimuth: 42, targetYFrac: 0.45,
    bg: new THREE.Color(), gridColor: new THREE.Color(), wireColor: new THREE.Color(),
  };
}

/** 经纬线线框（四边形网格，无三角对角线），单位半径 */
function buildSphereWireGeometry(widthSeg: number, heightSeg: number): THREE.BufferGeometry {
  const cols = widthSeg + 1;
  const verts: number[] = [];
  const vid = (i: number, j: number) => i * cols + j;
  for (let i = 0; i <= heightSeg; i++) {
    const phi = (i / heightSeg) * Math.PI;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let j = 0; j <= widthSeg; j++) {
      const theta = (j / widthSeg) * Math.PI * 2;
      verts.push(sp * Math.sin(theta), cp, sp * Math.cos(theta));
    }
  }
  const indices: number[] = [];
  for (let i = 1; i < heightSeg; i++) {
    for (let j = 0; j < widthSeg; j++) indices.push(vid(i, j), vid(i, j + 1));
  }
  for (let j = 0; j <= widthSeg; j++) {
    for (let i = 0; i < heightSeg; i++) indices.push(vid(i, j), vid(i + 1, j));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setIndex(indices);
  return geometry;
}

export class SpaceScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  /* 网格：顶点按 (ring, spoke) 规则排布，x/z/r/θ 全部预计算，每帧只重算 y 与亮度 */
  private gridGeometry = new THREE.BufferGeometry();
  private gridPositions!: THREE.BufferAttribute;
  private gridColors!: THREE.BufferAttribute;
  private gridMaterial!: THREE.LineBasicMaterial;
  private readonly vertexCount = RING_COUNT * SPOKE_COUNT;
  private ringR = new Float32Array(RING_COUNT);
  private spokeTheta = new Float32Array(SPOKE_COUNT);
  private termBase = new Float32Array(RING_COUNT);
  /** 每阶方位模一套环系数 / 一套辐条系数，逐顶点只做 AZ_MODES 次乘加 */
  private termAz = Array.from({ length: AZ_MODES }, () => new Float32Array(RING_COUNT));
  private termSpoke = Array.from({ length: AZ_MODES }, () => new Float32Array(SPOKE_COUNT));
  private ringShade = new Float32Array(RING_COUNT * 3);

  private sphereGroup: THREE.Group;
  private sphereFillMaterial: THREE.MeshBasicMaterial;
  private sphereWireMaterial: THREE.LineBasicMaterial;
  private fillTextureKey = '';
  private fillTexture: THREE.CanvasTexture | null = null;

  private dust: THREE.Points;
  private dustMaterial: THREE.PointsMaterial;
  private dustVelocities: Float32Array;
  private blocks: THREE.Points;
  private blockMaterial: THREE.PointsMaterial;
  private blockVelocities: Float32Array;

  /* 轨道粒子：(r, θ, vr, L, hover) —— 在中心力场里做数值积分 */
  private traffic: THREE.Points;
  private trafficMaterial: THREE.PointsMaterial;
  private tR = new Float32Array(TRAFFIC_COUNT);
  private tTheta = new Float32Array(TRAFFIC_COUNT);
  private tVr = new Float32Array(TRAFFIC_COUNT);
  private tL = new Float32Array(TRAFFIC_COUNT);
  private tHover = new Float32Array(TRAFFIC_COUNT);
  private trafficRng = mulberry32(7301);
  /** 上一帧粒子状态所对应的 μ，用于切换时把 L/ṙ 换算到新势场 */
  private trafficMu = 0;

  private disposables: Array<{ dispose(): void }> = [];

  /* 轨道状态：当前值 + 目标值（指数阻尼追赶） */
  private azimuth = 0;
  private polar = THREE.MathUtils.degToRad(76);
  private radius = 16;
  private azimuthTarget = 0;
  private polarTarget = THREE.MathUtils.degToRad(76);
  private radiusTarget = 16;
  private target = new THREE.Vector3(0, -1, 0);
  private targetYGoal = -1;

  /* 切换过渡：from 是切换瞬间的混合快照（支持中途改主意），to 是新天体 */
  private from = newRunParams();
  private to = newRunParams();
  private cur = newRunParams();
  private morphStart = -1;
  private sheet: SheetState = {
    t: 0, mu: 1, coreR: 1, waveAmp: 0.1, breath: 1, discR: 24,
    frontAge: IDLE_FRONT, frontAmp: 0,
  };
  private toFillKey: [string, string, string] = ['', '', ''];

  private waveT = 0;
  private rafId = 0;
  private lastTime = -1;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;

    const initialPhys = getPhysics('sol');
    const initialVis = getVisual('sol');
    snapshot(initialPhys, initialVis, this.from);
    snapshot(initialPhys, initialVis, this.to);
    snapshot(initialPhys, initialVis, this.cur);
    this.toFillKey = initialVis.sphere.fill;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(initialVis.style.background, 1);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(initialVis.style.background);
    this.scene.fog = new THREE.Fog(initialVis.style.background, 20, 46);

    this.camera = new THREE.PerspectiveCamera(initialVis.camera.fov, 1, 0.1, 500);
    this.azimuth = this.azimuthTarget = THREE.MathUtils.degToRad(initialVis.camera.azimuthDeg);
    this.polar = this.polarTarget = THREE.MathUtils.degToRad(initialVis.camera.polarDeg);
    this.radius = this.radiusTarget = initialVis.camera.radius;
    this.targetYGoal = this.target.y = -initialPhys.depth * initialVis.camera.targetYFrac;
    this.applyCamera();

    this.buildGrid();

    /* 线框球 */
    this.sphereGroup = new THREE.Group();
    this.sphereFillMaterial = new THREE.MeshBasicMaterial();
    this.sphereWireMaterial = new THREE.LineBasicMaterial({ color: initialVis.sphere.wireColor });
    const wire = buildSphereWireGeometry(40, 30);
    const fill = new THREE.SphereGeometry(1, 48, 34);
    this.sphereGroup.add(new THREE.LineSegments(wire, this.sphereWireMaterial));
    this.sphereGroup.add(new THREE.Mesh(fill, this.sphereFillMaterial));
    this.sphereGroup.rotation.set(0.12, 0, 2.2);
    this.scene.add(this.sphereGroup);
    this.disposables.push(wire, fill, this.sphereWireMaterial, this.sphereFillMaterial);
    this.rebuildFillTexture(initialVis.sphere.fill);

    /* 尘埃 / 贴地小方块 / 轨道粒子 */
    const dustGeometry = this.buildDustGeometry();
    this.dustVelocities = this.buildDustVelocities();
    this.dustMaterial = new THREE.PointsMaterial({
      size: 3.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0,
    });
    this.dust = new THREE.Points(dustGeometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this.disposables.push(dustGeometry, this.dustMaterial);

    this.blockVelocities = this.buildBlockVelocities();
    const blockGeometry = this.buildBlockGeometry();
    this.blockMaterial = new THREE.PointsMaterial({
      size: 9, sizeAttenuation: false, color: BLOCK_COLOR, transparent: true, opacity: 0,
    });
    this.blocks = new THREE.Points(blockGeometry, this.blockMaterial);
    this.blocks.frustumCulled = false;
    this.scene.add(this.blocks);
    this.disposables.push(blockGeometry, this.blockMaterial);

    const trafficGeometry = this.buildTrafficGeometry();
    this.trafficMaterial = new THREE.PointsMaterial({
      size: 2.4, sizeAttenuation: false, color: TRAFFIC_COLOR, transparent: true, opacity: 0,
    });
    this.traffic = new THREE.Points(trafficGeometry, this.trafficMaterial);
    this.traffic.frustumCulled = false;
    this.scene.add(this.traffic);
    this.disposables.push(trafficGeometry, this.trafficMaterial);

    this.bindEvents();
    this.resetTraffic();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.rafId = requestAnimationFrame(this.frame);
  }

  /** 切换天体：拍快照做 from，新档案做 to，~1s 缓动插值，并激发一道外传波前 */
  setBody(body: CelestialBody): void {
    const phys = getPhysics(body.id);
    const vis = getVisual(body.id);

    copyParams(this.cur, this.from); // cur 已是上一帧的混合结果
    snapshot(phys, vis, this.to);
    this.toFillKey = vis.sphere.fill;
    this.morphStart = performance.now();

    /* 井深突变 = 一次扰动，振幅正比于变化量；波前在 sheet 里以有限速度外传 */
    const jump = Math.abs(phys.depth - this.cur.depth);
    this.sheet.frontAge = 0;
    this.sheet.frontAmp = clamp(jump * 0.11, 0.05, 0.62);

    this.rebuildFillTexture(vis.sphere.fill);

    const c = vis.camera;
    this.azimuthTarget = THREE.MathUtils.degToRad(c.azimuthDeg);
    this.polarTarget = clamp(THREE.MathUtils.degToRad(c.polarDeg), POLAR_MIN, POLAR_MAX);
    this.radiusTarget = clamp(c.radius, RADIUS_MIN, RADIUS_MAX);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);

    for (const item of this.disposables) item.dispose();
    this.gridGeometry.dispose();
    this.gridMaterial.dispose();
    this.renderer.dispose();
    if (canvas.parentElement === this.container) this.container.removeChild(canvas);
  }

  /* ---------------- 网格 ---------------- */

  private buildGrid(): void {
    const n = this.vertexCount;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3).fill(1);
    const ratio = R_MAX / R_MIN;
    const q = Math.pow(ratio, 1 / (RING_COUNT - 1));

    for (let j = 0; j < SPOKE_COUNT; j++) {
      this.spokeTheta[j] = (j / SPOKE_COUNT) * Math.PI * 2;
    }

    let v = 0;
    for (let i = 0; i < RING_COUNT; i++) {
      const r = R_MIN * Math.pow(q, i);
      this.ringR[i] = r;
      for (let j = 0; j < SPOKE_COUNT; j++) {
        const theta = this.spokeTheta[j];
        positions[v * 3] = r * Math.cos(theta);
        positions[v * 3 + 1] = 0;
        positions[v * 3 + 2] = r * Math.sin(theta);
        v++;
      }
    }

    const indices = new Uint16Array(2 * SPOKE_COUNT * (2 * RING_COUNT - 1));
    let m = 0;
    /* 环：固定 r，沿 θ 闭合 */
    for (let i = 0; i < RING_COUNT; i++) {
      const base = i * SPOKE_COUNT;
      for (let j = 0; j < SPOKE_COUNT; j++) {
        indices[m++] = base + j;
        indices[m++] = base + ((j + 1) % SPOKE_COUNT);
      }
    }
    /* 辐条：固定 θ，沿 r 由内向外 */
    for (let i = 0; i < RING_COUNT - 1; i++) {
      const a = i * SPOKE_COUNT;
      const b = (i + 1) * SPOKE_COUNT;
      for (let j = 0; j < SPOKE_COUNT; j++) {
        indices[m++] = a + j;
        indices[m++] = b + j;
      }
    }

    this.gridPositions = new THREE.BufferAttribute(positions, 3);
    this.gridPositions.setUsage(THREE.DynamicDrawUsage);
    this.gridColors = new THREE.BufferAttribute(colors, 3);
    this.gridColors.setUsage(THREE.DynamicDrawUsage);
    this.gridGeometry.setAttribute('position', this.gridPositions);
    this.gridGeometry.setAttribute('color', this.gridColors);
    this.gridGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

    /* 线色 = 顶点色（纸底→墨的插值结果），材质色恒白：
     * WebGL 线没有逐顶点 alpha，把线混到纸底色即视觉消失（盘缘软淡出） */
    this.gridMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 });
    this.gridMaterial.color.set(0xffffff);
    const mesh = new THREE.LineSegments(this.gridGeometry, this.gridMaterial);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** 膜高 + 盘缘亮度淡出。
   *  高度场可分离：h(r,θ) = ringBase(r) + Σ_m ringAz_m(r)·spokeFactor_m(θ)，
   *  故每帧只需 RING_COUNT·(1+AZ_MODES) + SPOKE_COUNT·AZ_MODES 次三角求值（456），
   *  而非逐顶点（11776 顶点 × 5 个波分量）。 */
  private updateGrid(): void {
    const arr = this.gridPositions.array as Float32Array;
    const colArr = this.gridColors.array as Float32Array;
    const sheet = this.sheet;
    const { ringR, spokeTheta, termBase, termAz, termSpoke, ringShade } = this;
    const rimIn = this.cur.discR - RIM_SOFT;
    const ink = this.cur.gridColor;
    const paper = this.cur.bg;

    for (let i = 0; i < RING_COUNT; i++) {
      const r = ringR[i];
      termBase[i] = ringBaseAt(r, sheet);
      for (let m = 0; m < AZ_MODES; m++) termAz[m][i] = ringAzAt(r, sheet, m);
      const c = 1 - smoothstep(r, rimIn, this.cur.discR);
      const k = i * 3;
      ringShade[k] = paper.r + (ink.r - paper.r) * c;
      ringShade[k + 1] = paper.g + (ink.g - paper.g) * c;
      ringShade[k + 2] = paper.b + (ink.b - paper.b) * c;
    }
    for (let j = 0; j < SPOKE_COUNT; j++) {
      const th = spokeTheta[j];
      for (let m = 0; m < AZ_MODES; m++) termSpoke[m][j] = spokeFactorAt(th, sheet, m);
    }

    const az0 = termAz[0];
    const az1 = termAz[1];
    const sp0 = termSpoke[0];
    const sp1 = termSpoke[1];
    let v = 0;
    for (let i = 0; i < RING_COUNT; i++) {
      const base = termBase[i];
      const a0 = az0[i];
      const a1 = az1[i];
      const k = i * 3;
      const cr = ringShade[k];
      const cg = ringShade[k + 1];
      const cb = ringShade[k + 2];
      for (let j = 0; j < SPOKE_COUNT; j++, v++) {
        const o = v * 3;
        arr[o + 1] = base + a0 * sp0[j] + a1 * sp1[j];
        colArr[o] = cr;
        colArr[o + 1] = cg;
        colArr[o + 2] = cb;
      }
    }
    this.gridPositions.needsUpdate = true;
    this.gridColors.needsUpdate = true;
  }

  /* ---------------- 球体 ---------------- */

  private rebuildFillTexture(fill: [string, string, string]): void {
    const key = fill.join('|');
    if (key === this.fillTextureKey) return;
    this.fillTextureKey = key;
    const old = this.fillTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(140, 112, 12, 128, 128, 132);
      gradient.addColorStop(0, fill[0]);
      gradient.addColorStop(0.55, fill[1]);
      gradient.addColorStop(1, fill[2]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.fillTexture = texture;
    this.sphereFillMaterial.map = texture;
    this.sphereFillMaterial.needsUpdate = true;
    if (old) {
      old.dispose();
      this.disposables = this.disposables.filter((d) => d !== old);
    }
    this.disposables.push(texture);
  }

  /* ---------------- 装饰几何 ---------------- */

  private buildDustGeometry(): THREE.BufferGeometry {
    const rng = mulberry32(1042);
    const positions = new Float32Array(DUST_COUNT * 3);
    const colors = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      positions[i * 3] = (rng() * 2 - 1) * 34;
      positions[i * 3 + 1] = 0.6 + rng() * 9.5;
      positions[i * 3 + 2] = (rng() * 2 - 1) * 34;
      const intensity = 0.3 + rng() * 0.7;
      colors[i * 3] = DUST_COLOR.r * intensity;
      colors[i * 3 + 1] = DUST_COLOR.g * intensity;
      colors[i * 3 + 2] = DUST_COLOR.b * intensity;
    }
    const geometry = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attr);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  private buildDustVelocities(): Float32Array {
    const rng = mulberry32(209);
    const velocities = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      velocities[i * 3] = (rng() * 2 - 1) * 0.12;
      velocities[i * 3 + 1] = (rng() * 2 - 1) * 0.05;
      velocities[i * 3 + 2] = (rng() * 2 - 1) * 0.12;
    }
    return velocities;
  }

  private buildBlockGeometry(): THREE.BufferGeometry {
    const SPOTS: Array<[number, number]> = [
      [-4.5, 3.5], [5.5, -1], [-14, 6], [8, 6.5], [-7, -12], [12, -9],
      [-18, -2], [3, 10], [-11, 12], [17, 3], [-24, 8], [9, -16],
    ];
    const positions = new Float32Array(BLOCK_COUNT * 3);
    for (let i = 0; i < BLOCK_COUNT; i++) {
      positions[i * 3] = SPOTS[i][0];
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = SPOTS[i][1];
    }
    const geometry = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attr);
    return geometry;
  }

  private buildBlockVelocities(): Float32Array {
    const rng = mulberry32(511);
    const velocities = new Float32Array(BLOCK_COUNT * 2);
    for (let i = 0; i < BLOCK_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = 0.3 + rng() * 0.5;
      velocities[i * 2] = Math.cos(angle) * speed;
      velocities[i * 2 + 1] = Math.sin(angle) * speed;
    }
    return velocities;
  }

  /** 投放一颗测试粒子：半径按吸积盘面密度 ∝ r^-1.15 采样（越靠喉口越密），
   *  比角动量取接近圆轨道的值，剩余径向速度造成缓慢旋进。 */
  private spawnTraffic(i: number, mu: number, coreR: number, discR: number): void {
    const rng = this.trafficRng;
    const rIn = coreR * 2.2 + 1.2;
    const rOut = Math.max(rIn + 2.5, Math.min(discR * 0.55, 14));
    const u = rng();
    const p = -0.15;                       /* 1 - 幂指数 */
    const r = Math.pow(
      Math.pow(rIn, p) + u * (Math.pow(rOut, p) - Math.pow(rIn, p)),
      1 / p,
    );
    this.tR[i] = r;
    this.tTheta[i] = rng() * Math.PI * 2;
    this.tVr[i] = (rng() * 2 - 1) * 0.12 * Math.sqrt(mu / Math.max(r, 1));
    this.tL[i] = circularL(r, mu, coreR) * (0.86 + rng() * 0.22);
    this.tHover[i] = 0.05 + rng() * 0.3;
  }

  /** 全部粒子重新投放到当前天体允许的轨道带内 */
  private resetTraffic(): void {
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      this.spawnTraffic(i, this.cur.mu, this.cur.coreR, this.cur.discR);
    }
    this.trafficMu = this.cur.mu;
  }

  private buildTrafficGeometry(): THREE.BufferGeometry {
    const positions = new Float32Array(TRAFFIC_COUNT * 3);
    const geometry = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attr);
    return geometry;
  }

  /**
   * 轨道粒子积分：中心力场里的二体问题（单位质量）
   *   r̈ = -μr/(r²+a²)^1.5 + L²/r³ - c_r·ṙ
   *   θ̇ = L/r²,  L̇ = -c_L·L   （黏性损耗角动量 → 螺旋内落 = 吸积）
   * ω = θ̇ = L/r² 严格随半径平方反比增大 —— 这就是「半径越小转得越快」的来源；
   * 势与膜高共用同一组 (μ, a)，所以粒子是真的沿着屏幕上那张势面在跑。
   */
  private updateTraffic(dt: number, mu: number, coreR: number, discR: number, inflow: number): void {
    const attr = this.traffic.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    const h = (dt * ORBIT_TIME_SCALE) / ORBIT_SUBSTEPS;
    const radialDrag = inflow * 0.4;
    const lDecay = Math.max(0, 1 - inflow * 0.2 * h);
    const rPlunge = coreR * 1.25;
    const rEsc = discR * 0.92;

    /* 势场变了（切换天体 / morph 途中每帧都在变）：把每颗粒子的 L 和 ṙ 换算到新场。
     * 圆轨道角动量 ∝ √μ、特征速度 √(μ/r) ∝ √μ，所以两者同乘 √(μ新/μ旧) 后，
     * 「相对圆轨道的偏离程度」逐字保持不变 —— 粒子不会记得上一个天体的速度。
     * 不做这步的话：太阳→黑洞时旧 L 太小会集体坠入（看着快），黑洞→太阳时旧 L 太大
     * 会集体外抛，要等粒子飘到盘缘重生才恢复，回程就表现为「速度降不下来」。 */
    const prevMu = this.trafficMu;
    if (prevMu > 0 && mu > 0 && mu !== prevMu) {
      const k = Math.sqrt(mu / prevMu);
      for (let i = 0; i < TRAFFIC_COUNT; i++) {
        this.tL[i] *= k;
        this.tVr[i] *= k;
      }
    }
    this.trafficMu = mu;

    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      let r = this.tR[i];
      let th = this.tTheta[i];
      let vr = this.tVr[i];
      let L = this.tL[i];

      for (let s = 0; s < ORBIT_SUBSTEPS; s++) {
        if (r <= rPlunge) break; // 已坠入视界/星体，交给下面的重生逻辑
        const d2 = r * r + coreR * coreR;
        const d32 = d2 * Math.sqrt(d2);
        const acc = (-mu * r) / d32 + (L * L) / (r * r * r);
        vr += acc * h;
        vr -= radialDrag * vr * h;
        r += vr * h;
        L *= lDecay;
        th += (L / (r * r)) * h;
      }

      if (r < rPlunge || r > rEsc || !Number.isFinite(r)) {
        this.spawnTraffic(i, mu, coreR, discR);
        r = this.tR[i];
        th = this.tTheta[i];
      }
      this.tR[i] = r;
      this.tTheta[i] = th;
      this.tVr[i] = vr;
      this.tL[i] = L;

      pos[i * 3] = r * Math.cos(th);
      pos[i * 3 + 1] = sheetHeight(r, th, this.sheet) + this.tHover[i] * (0.35 + 0.65 * inflow);
      pos[i * 3 + 2] = r * Math.sin(th);
    }
    attr.needsUpdate = true;
  }

  /* ---------------- 交互 ---------------- */

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 1) return;
    this.azimuthTarget -= event.movementX * 0.0052;
    this.polarTarget = clamp(this.polarTarget - event.movementY * 0.0052, POLAR_MIN, POLAR_MAX);
    this.applyCameraConstraints();
  };

  private onPointerUp = (event: PointerEvent): void => {
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.radiusTarget *= Math.exp(event.deltaY * 0.0011);
    this.applyCameraConstraints();
  };

  /**
   * 交互窗口约束：缩放范围随当前天体尺度收（避免缩进井里看到一片空白），
   * 并且保证相机永远在远场平面之上 —— 否则平视时会钻到膜下面，什么都不剩。
   */
  private applyCameraConstraints(): void {
    const cur = this.cur;
    const lo = Math.max(RADIUS_MIN, cur.coreR * 5, cur.depth * 0.5);
    const hi = Math.max(lo, Math.min(RADIUS_MAX, cur.discR * 2.4));
    this.radiusTarget = clamp(this.radiusTarget, lo, hi);

    const clearance = Math.max(0.8, cur.coreR * 0.9);
    const needCos = (clearance - cur.depth * cur.targetYFrac) / this.radiusTarget;
    const polarCap = Math.acos(clamp(needCos, Math.cos(POLAR_MAX), Math.cos(POLAR_MIN)));
    this.polarTarget = clamp(this.polarTarget, POLAR_MIN, polarCap);
  }

  private applyCamera(): void {
    this.camera.position.set(
      this.target.x + this.radius * Math.sin(this.polar) * Math.sin(this.azimuth),
      this.target.y + this.radius * Math.cos(this.polar),
      this.target.z + this.radius * Math.sin(this.polar) * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- 帧循环 ---------------- */

  private blendParams(e: number): void {
    const from = this.from;
    const to = this.to;
    const cur = this.cur;
    cur.mu = lerp(from.mu, to.mu, e);
    cur.coreR = lerp(from.coreR, to.coreR, e);
    cur.depth = lerp(from.depth, to.depth, e);
    cur.spin = lerp(from.spin, to.spin, e);
    cur.waveAmp = lerp(from.waveAmp, to.waveAmp, e);
    cur.discR = lerp(from.discR, to.discR, e);
    cur.gridOpacity = lerp(from.gridOpacity, to.gridOpacity, e);
    cur.dust = lerp(from.dust, to.dust, e);
    cur.blocks = lerp(from.blocks, to.blocks, e);
    cur.traffic = lerp(from.traffic, to.traffic, e);
    cur.inflow = lerp(from.inflow, to.inflow, e);
    cur.dark = lerp(from.dark, to.dark, e);
    cur.fov = lerp(from.fov, to.fov, e);
    cur.camPolar = lerp(from.camPolar, to.camPolar, e);
    cur.camRadius = lerp(from.camRadius, to.camRadius, e);
    cur.camAzimuth = lerp(from.camAzimuth, to.camAzimuth, e);
    cur.targetYFrac = lerp(from.targetYFrac, to.targetYFrac, e);
    cur.bg.copy(from.bg).lerp(to.bg, e);
    cur.gridColor.copy(from.gridColor).lerp(to.gridColor, e);
    cur.wireColor.copy(from.wireColor).lerp(to.wireColor, e);
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const dt = this.lastTime < 0 ? 0.016 : Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.waveT += dt;

    /* 切换过渡：几何量用 easeInOutCubic（两端都慢，读作「膜被缓缓压下去」） */
    let e = 1;
    if (this.morphStart >= 0) {
      const t = Math.min((now - this.morphStart) / MORPH_MS, 1);
      e = easeInOutCubic(t);
      if (t >= 1) this.morphStart = -1;
    }
    this.blendParams(e);
    const cur = this.cur;

    /* 膜状态 */
    const sheet = this.sheet;
    sheet.t = this.waveT;
    sheet.mu = cur.mu;
    sheet.coreR = cur.coreR;
    sheet.waveAmp = cur.waveAmp;
    sheet.discR = cur.discR;
    // 井深呼吸：整张膜（含井底的球）一起缓慢起伏
    sheet.breath = 1 + 0.026 * Math.sin(this.waveT * 0.82) + 0.012 * Math.sin(this.waveT * 0.31 + 1.2);
    if (sheet.frontAge >= 0) {
      sheet.frontAge += dt;
      if (sheet.frontAge > FRONT_GONE) sheet.frontAge = IDLE_FRONT;
    }

    this.updateGrid();

    /* 相机：用户拖拽目标 + 指数阻尼；注视点高度跟着井深走 */
    this.applyCameraConstraints();
    const damp = 1 - Math.exp(-dt * 7);
    this.azimuth += (this.azimuthTarget - this.azimuth) * damp;
    this.polar += (this.polarTarget - this.polar) * damp;
    this.radius += (this.radiusTarget - this.radius) * damp;
    this.targetYGoal = -cur.depth * cur.targetYFrac;
    this.target.y += (this.targetYGoal - this.target.y) * damp;
    if (Math.abs(this.camera.fov - cur.fov) > 1e-3) {
      this.camera.fov = cur.fov;
      this.camera.updateProjectionMatrix();
    }
    this.applyCamera();

    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(cur.bg);
    fog.near = cur.camRadius * 1.15;
    fog.far = cur.camRadius * 2.5;
    (this.scene.background as THREE.Color).copy(cur.bg);
    this.renderer.setClearColor(cur.bg, 1);
    this.gridMaterial.opacity = cur.gridOpacity;

    /* 线框球：半径 = 芯半径 a × SPHERE_FIT，球心由 seatSphere 求解 ——
     * 膜把球托住，球沉到「刚好不穿过膜」的最低位置（井比球弯时点接触在井底，
     * 否则在井壁上形成一圈接触环），所以恒星始终坐在引力势上而不穿模。 */
    const sphereR = cur.coreR * SPHERE_FIT;
    const pulse = cur.dark > 0.8 ? 1 + 0.03 * Math.sin(this.waveT * 2.6) : 1;
    const drawnR = sphereR * pulse;
    this.sphereGroup.scale.setScalar(drawnR);
    this.sphereGroup.position.y = seatSphere(cur.mu * sheet.breath, cur.coreR, drawnR);
    this.sphereGroup.rotation.y += dt * cur.spin;
    this.sphereFillMaterial.color.lerpColors(FILL_LIGHT, FILL_DARK, cur.dark);
    this.sphereWireMaterial.color.copy(cur.wireColor);
    this.rebuildFillTexture(this.toFillKey);

    /* 尘埃漂移 */
    this.dustMaterial.opacity = cur.dust;
    const dustAttr = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const dustArray = dustAttr.array as Float32Array;
    for (let i = 0; i < DUST_COUNT; i++) {
      const o = i * 3;
      dustArray[o] += this.dustVelocities[o] * dt;
      dustArray[o + 1] += this.dustVelocities[o + 1] * dt;
      dustArray[o + 2] += this.dustVelocities[o + 2] * dt;
      if (dustArray[o] > 34) dustArray[o] = -34;
      else if (dustArray[o] < -34) dustArray[o] = 34;
      if (dustArray[o + 1] > 10.2) dustArray[o + 1] = 0.5;
      else if (dustArray[o + 1] < 0.4) dustArray[o + 1] = 10;
      if (dustArray[o + 2] > 34) dustArray[o + 2] = -34;
      else if (dustArray[o + 2] < -34) dustArray[o + 2] = 34;
    }
    dustAttr.needsUpdate = true;

    /* 贴地小方块：漂移动 + 始终坐在膜面上 */
    this.blockMaterial.opacity = cur.blocks;
    const blockAttr = this.blocks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const blockArray = blockAttr.array as Float32Array;
    for (let i = 0; i < BLOCK_COUNT; i++) {
      const o = i * 3;
      let x = blockArray[o] + this.blockVelocities[i * 2] * dt;
      let z = blockArray[o + 2] + this.blockVelocities[i * 2 + 1] * dt;
      if (x > 26) x = -26; else if (x < -26) x = 26;
      if (z > 26) z = -26; else if (z < -26) z = 26;
      blockArray[o] = x;
      blockArray[o + 2] = z;
      blockArray[o + 1] = sheetHeight(Math.hypot(x, z), Math.atan2(z, x), sheet) + 0.06;
    }
    blockAttr.needsUpdate = true;

    /* 轨道粒子：唯一由引力势动力学驱动的一层 */
    this.trafficMaterial.opacity = cur.traffic;
    this.traffic.visible = cur.traffic > 0.02;
    if (this.traffic.visible) {
      this.updateTraffic(dt, cur.mu, cur.coreR, cur.discR, cur.inflow);
    }

    this.renderer.render(this.scene, this.camera);
  };
}
