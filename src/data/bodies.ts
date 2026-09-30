/**
 * 天体数据契约 —— 六个天体的全部文案与数值。
 *
 * hex 串、bar 两端小字、MASS RATIO / DIST TO SING 均已在 reference.png 上以 4x
 * 放大逐字核对，与任务书个别字符出入处以参考图为准（差异清单见提交说明）。
 *
 * 视口右上的 EVENT HORIZON DISTANCE / JET ALIGNMENT / FIELD DISTORTION 不在此处：
 * 它们由 scene/hudReadouts.ts 从 scene/physics.ts 的真实质量与半径算出。
 *
 * headline 约定为 “<NAME> <TYPE>”，左栏卡片标题由 headline 去掉尾部 typeLabel 推导。
 * shearSeed / hexSeed 为波形与蜂窝热图的伪随机种子（任务书未给定数值，取固定常数）。
 */

export interface CelestialBody {
  id: string;
  /** 左栏卡片第二行：类型标签，如 “MAIN-SEQUENCE STAR”（渲染时前缀 “- ”） */
  typeLabel: string;
  /** 左栏卡片十六进制串第一行 */
  hexTop: string;
  /** 左栏卡片十六进制串第二行 */
  hexBottom: string;
  /** 进度条百分比（0-100） */
  barPercent: number;
  /** 进度条两端小字（参考图中左端为百分数、右端为两位十六进制码） */
  barLeft: string;
  barRight: string;
  /** 中央视口红色大标题 */
  headline: string;
  /** 顶部栏：MASS RATIO / DIST TO SING */
  massRatio: string;
  distToSing: string;
  /** 右栏仪表 0-1 */
  accretionRate: number;
  /** 波形图伪随机种子 */
  shearSeed: number;
  /** 蜂窝热图伪随机种子 */
  hexSeed: number;
}

export const BODIES: CelestialBody[] = [
  {
    id: 'sol',
    typeLabel: 'MAIN-SEQUENCE STAR',
    hexTop: '7041C442301D96679EE9BDDD52EEBC50B11829E551ABE5',
    hexBottom: 'A54D02F6E624',
    barPercent: 74,
    barLeft: 'C1',
    barRight: '58%',
    headline: 'SOL MAIN-SEQUENCE STAR',
    massRatio: '15.5',
    distToSing: '212AU',
    accretionRate: 0.42,
    shearSeed: 1042,
    hexSeed: 209,
  },
  {
    id: 'sirius-b',
    typeLabel: 'WHITE DWARF',
    hexTop: 'CBFA9BF3E796C19E43A156D44F9B87F5911BBFF9C7198B',
    hexBottom: 'EF0EA535C7',
    barPercent: 93,
    barLeft: '08',
    barRight: '45%',
    headline: 'SIRIUS B WHITE DWARF',
    massRatio: '8.2',
    distToSing: '148AU',
    accretionRate: 0.55,
    shearSeed: 1177,
    hexSeed: 311,
  },
  {
    id: 'crab-pulsar',
    typeLabel: 'NEUTRON STAR',
    hexTop: 'F9BE845275F22547AE9D0F029C4356814A3553E5B44E3B',
    hexBottom: '36244AC',
    barPercent: 15,
    barLeft: '27',
    barRight: '62%',
    headline: 'CRAB PULSAR NEUTRON STAR',
    massRatio: '21.7',
    distToSing: '305AU',
    accretionRate: 0.68,
    shearSeed: 1289,
    hexSeed: 427,
  },
  {
    id: 'cygnus-x-1',
    typeLabel: 'BLACK HOLE',
    hexTop: '6EBCBE5162DA9D0EFAD794FFE06B1D9347641882733361',
    hexBottom: 'A204E893E45',
    barPercent: 87,
    barLeft: '80',
    barRight: '80%',
    headline: 'CYGNUS X-1 BLACK HOLE',
    massRatio: '32.4',
    distToSing: '89AU',
    accretionRate: 0.93,
    shearSeed: 1361,
    hexSeed: 538,
  },
  {
    id: 'procyon-b',
    typeLabel: 'WHITE DWARF',
    hexTop: '73DE844C00F1C3D08742FFAEFFCE84B8ECB0FFF3FF292A',
    hexBottom: 'EB51156D89A576',
    barPercent: 91,
    barLeft: 'F7',
    barRight: '38%',
    headline: 'PROCYON B WHITE DWARF',
    massRatio: '7.9',
    distToSing: '132AU',
    accretionRate: 0.51,
    shearSeed: 1471,
    hexSeed: 613,
  },
  {
    id: 'betelgeuse',
    typeLabel: 'RED SUPERGIANT',
    hexTop: '32877386943B3D8A1EC4E7536E384C95FEDAB3ECF1D223',
    hexBottom: '5F0F465CE402F',
    barPercent: 69,
    barLeft: '84',
    barRight: '52%',
    headline: 'BETELGEUSE RED SUPERGIANT',
    massRatio: '18.9',
    distToSing: '410AU',
    accretionRate: 0.37,
    shearSeed: 1607,
    hexSeed: 709,
  },
];

/** 默认选中项（SOL） */
export const DEFAULT_BODY_ID = BODIES[0].id;
