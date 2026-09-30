/**
 * bodyVisuals.ts —— 每个天体「与物理无关」的观感参数：机位、线型、装饰强度。
 *
 * 井的形状/球的半径/自转速度全部来自 physics.ts（真实质量与半径推出来），
 * 这里只保留「这台仪器怎么拍它」：相机距离与俯仰、盘缘淡出半径、
 * 波纹振幅、吸入粒子浓度与黏性、球体明暗。
 *
 *   polarDeg  极角，自 +Y 轴量起：90 = 平视，越小越俯视
 *   discR     网格线亮度淡出的半径（世界单位），决定「时空薄片」看起来有多大
 *   inflow    吸积盘黏性强度 0..1：0 = 纯测地线轨道（不内落），1 = 快速螺旋坠入
 *   traffic   轨道粒子整体不透明度 0..1
 */

export interface BodyVisual {
  id: string;
  camera: { polarDeg: number; radius: number; azimuthDeg: number; targetYFrac: number; fov: number };
  style: {
    background: number;
    gridColor: number;
    gridOpacity: number;
    /** 网格线亮度按半径淡出（盘缘） */
    discR: number;
  };
  decor: {
    dustOpacity: number;
    blocksOpacity: number;
    /** 轨道粒子（受引力势驱动）不透明度 */
    trafficOpacity: number;
    /** 吸积黏性 0..1 */
    inflow: number;
    /** 环境行波振幅（世界单位） */
    waveAmp: number;
  };
  sphere: {
    /** 明暗 0..1：0 亮灰，1 近黑剪影（黑洞） */
    dark: number;
    wireColor: number;
    fill: [string, string, string];
  };
}

export const VISUALS: Record<string, BodyVisual> = {
  sol: {
    id: 'sol',
    camera: { polarDeg: 73, radius: 15.2, azimuthDeg: 42, targetYFrac: 0.62, fov: 34 },
    style: { background: 0xd4ddd1, gridColor: 0x4a5145, gridOpacity: 0.6, discR: 27 },
    decor: { dustOpacity: 0.8, blocksOpacity: 0.5, trafficOpacity: 0.5, inflow: 0.04, waveAmp: 0.34 },
    sphere: { dark: 0.06, wireColor: 0x12140f, fill: ['#dfe0dc', '#d8dad5', '#bfc4bb'] },
  },
  'sirius-b': {
    id: 'sirius-b',
    camera: { polarDeg: 77, radius: 16.4, azimuthDeg: 42, targetYFrac: 0.42, fov: 34 },
    style: { background: 0xd4ddd1, gridColor: 0x4a5145, gridOpacity: 0.58, discR: 26 },
    decor: { dustOpacity: 0.85, blocksOpacity: 0.45, trafficOpacity: 0.62, inflow: 0.12, waveAmp: 0.32 },
    sphere: { dark: 0.1, wireColor: 0x12140f, fill: ['#e2e3df', '#dbddd8', '#c2c7be'] },
  },
  'crab-pulsar': {
    id: 'crab-pulsar',
    camera: { polarDeg: 70, radius: 22, azimuthDeg: 42, targetYFrac: 0.35, fov: 34 },
    style: { background: 0xd4ddd1, gridColor: 0x4a5145, gridOpacity: 0.6, discR: 22 },
    decor: { dustOpacity: 0.7, blocksOpacity: 0.14, trafficOpacity: 0.85, inflow: 0.42, waveAmp: 0.28 },
    sphere: { dark: 0.72, wireColor: 0x12140f, fill: ['#dfe0dc', '#d8dad5', '#bfc4bb'] },
  },
  'cygnus-x-1': {
    id: 'cygnus-x-1',
    camera: { polarDeg: 67, radius: 30, azimuthDeg: 42, targetYFrac: 0.25, fov: 34 },
    style: { background: 0xd4ddd1, gridColor: 0x4a5145, gridOpacity: 0.62, discR: 20 },
    decor: { dustOpacity: 0.75, blocksOpacity: 0.06, trafficOpacity: 1, inflow: 0.72, waveAmp: 0.24 },
    sphere: { dark: 0.97, wireColor: 0x0b0c09, fill: ['#dfe0dc', '#d8dad5', '#bfc4bb'] },
  },
  'procyon-b': {
    id: 'procyon-b',
    camera: { polarDeg: 74.5, radius: 11.6, azimuthDeg: 42, targetYFrac: 0.42, fov: 34 },
    style: { background: 0xd4ddd1, gridColor: 0x4a5145, gridOpacity: 0.55, discR: 24 },
    decor: { dustOpacity: 0.85, blocksOpacity: 0.45, trafficOpacity: 0.6, inflow: 0.14, waveAmp: 0.32 },
    sphere: { dark: 0.05, wireColor: 0x12140f, fill: ['#e0e1dd', '#d9dbd6', '#c0c5bc'] },
  },
  betelgeuse: {
    id: 'betelgeuse',
    camera: { polarDeg: 72, radius: 24, azimuthDeg: 42, targetYFrac: 0.68, fov: 34 },
    style: { background: 0xd4ddd1, gridColor: 0x4a5145, gridOpacity: 0.45, discR: 28 },
    decor: { dustOpacity: 0.8, blocksOpacity: 0.45, trafficOpacity: 0.42, inflow: 0.03, waveAmp: 0.36 },
    sphere: { dark: 0.03, wireColor: 0x12140f, fill: ['#dfe0dc', '#d8dad5', '#bfc4bb'] },
  },
};

export function getVisual(id: string): BodyVisual {
  return VISUALS[id] ?? VISUALS.sol;
}
