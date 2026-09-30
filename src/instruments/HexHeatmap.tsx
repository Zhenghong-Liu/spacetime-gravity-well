import { useEffect, useMemo, useRef } from 'react';
import type { CelestialBody } from '../data/bodies';
import { mulberry32, clamp, mixHex } from './seeded';

/**
 * TEMPERATURE DISTRIBUTION —— 蜂窝六边形热力图面板（pointy-top）。
 * 基础灰阶由 body.hexSeed 播种：上浅下深渐变 + 逐格噪声 + 随机暗斑（分布保持不变）；
 * 六边形铺满左 ~225px，右侧为竖向灰阶标尺（800→100 小字 + 刻度），热区四角有 L 形取景括号。
 *
 * 动态（rAF 直接改 polygon fill，无 setState、无 React 高频重渲染）：
 *   每格亮度 = base(seed) + 全局亮度偏移(每体 bright，sol 0.55 为基准)
 *            + 行波 0.12*sin(0.8*(x*0.35+y*0.25) - t*0.9)（缓慢热流感）
 *            + 偶发闪烁（每秒随机 1-3 格，300ms 内 ±0.15 正弦凸起后恢复）；
 *   每体色温 tint ≤10%：冷蓝 #6a7a8a 或暖红 #8a6a5a 叠加在灰阶 ramp 上，
 *   整体保持参考图灰绿基调；切换天体时 bright/tint 以 ~0.8s 指数过渡。
 */

const HEX_R = 9; // 中心到顶点（参考图蜂窝点高 ≈18px、列距 ≈15.6px）
const COL_PITCH = Math.sqrt(3) * HEX_R; // ≈15.59
const ROW_PITCH = 1.5 * HEX_R; // =13.5
const COLS = 15;
const ROWS = 7;

interface Hex {
  x: number;
  y: number;
  t: number; // 0 暗 → 1 亮（base，seed 播种）
}

/** 灰阶 ramp：#16180f → #454a3e → #7d8276 → #b7bdae（首帧静态填充用） */
function rampColor(t: number): string {
  if (t < 0.33) return mixHex('#12140c', '#3c4136', t / 0.33);
  if (t < 0.62) return mixHex('#3c4136', '#6e7466', (t - 0.33) / 0.29);
  return mixHex('#6e7466', '#a8ae9e', (t - 0.62) / 0.38);
}

/** 同一条 ramp 的数值版（rAF 每帧用，避免字符串解析开销） */
function rampRGB(t: number): [number, number, number] {
  const mix3 = (
    a: [number, number, number],
    c: [number, number, number],
    u: number,
  ): [number, number, number] => [
    a[0] + (c[0] - a[0]) * u,
    a[1] + (c[1] - a[1]) * u,
    a[2] + (c[2] - a[2]) * u,
  ];
  if (t < 0.33) return mix3([18, 20, 12], [60, 65, 54], t / 0.33);
  if (t < 0.62) return mix3([60, 65, 54], [110, 116, 102], (t - 0.33) / 0.29);
  return mix3([110, 116, 102], [168, 174, 158], (t - 0.62) / 0.38);
}

/** 256 级 ramp 查找表 */
const RAMP_LUT: [number, number, number][] = Array.from(
  { length: 256 },
  (_, i) => rampRGB(i / 255),
);

/** 色温叠色：冷蓝 / 暖红（≤10% 混合） */
const COLD: [number, number, number] = [0x6a, 0x7a, 0x8a];
const WARM: [number, number, number] = [0x8a, 0x6a, 0x5a];

/** 每体全局参数：bright 为亮度水平（sol 0.55 = 基准/中性），cold/warm 为 ≤10% 色温占比 */
const HEAT_PARAMS: Record<string, { bright: number; cold: number; warm: number }> = {
  'sol':         { bright: 0.55, cold: 0,    warm: 0 },
  'sirius-b':    { bright: 0.6,  cold: 0.08, warm: 0 },
  'crab-pulsar': { bright: 0.62, cold: 0.1,  warm: 0 },
  'cygnus-x-1':  { bright: 0.52, cold: 0.03, warm: 0 },
  'procyon-b':   { bright: 0.6,  cold: 0.08, warm: 0 },
  'betelgeuse':  { bright: 0.42, cold: 0,    warm: 0.1 },
};
const HEAT_DEFAULT = HEAT_PARAMS['sol'];

function hexPoints(x: number, y: number, r: number): string {
  const hw = (Math.sqrt(3) / 2) * r;
  return [
    [x, y - r],
    [x + hw, y - r / 2],
    [x + hw, y + r / 2],
    [x, y + r],
    [x - hw, y + r / 2],
    [x - hw, y - r / 2],
  ]
    .map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`)
    .join(' ');
}

function buildHexes(seed: number): Hex[] {
  const rnd = mulberry32(seed);
  const out: Hex[] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let k = 0; k < COLS; k++) {
      const x = 7 + k * COL_PITCH + (j % 2 ? COL_PITCH / 2 : 0);
      const y = -2 + j * ROW_PITCH;
      // 参考图蜂窝簇呈大六边形轮廓：中部整行最宽，上下数行逐行收窄
      const dy = Math.abs(y - 38.5);
      const dxMax = dy <= 20 ? 107 : 107 - (dy - 20) * 1.9;
      if (Math.abs(x - 113) > dxMax) continue;
      // 参考图渐变方向：上浅下深（顶部亮、底部暗）+ 逐格噪声；少数离群暗斑
      const vert = clamp((y + 4) / 86, 0, 1);
      let t = clamp(0.72 - 0.42 * vert + (rnd() - 0.5) * 0.3, 0.02, 0.98);
      if (rnd() < 0.06) t = clamp(t - 0.35, 0.02, 0.4);
      out.push({ x, y, t });
    }
  }
  return out;
}

export default function HexHeatmap({ body }: { body: CelestialBody }) {
  // 仅天体切换时重算一次几何/基础亮度（一次受控重渲染，非高频）
  const hexes = useMemo(() => buildHexes(body.hexSeed), [body.hexSeed]);
  const polysRef = useRef<(SVGPolygonElement | null)[]>([]);
  const hexesRef = useRef<Hex[]>(hexes);
  hexesRef.current = hexes;
  const bodyRef = useRef(body);
  bodyRef.current = body;

  useEffect(() => {
    polysRef.current.length = hexes.length;
  }, [hexes]);

  /* rAF 循环：直接更新每个 polygon 的 fill（无 setState） */
  useEffect(() => {
    let raf = 0;
    let lastT = -1;
    const g = {
      bright: HEAT_PARAMS[bodyRef.current.id]?.bright ?? HEAT_DEFAULT.bright,
      cold: HEAT_PARAMS[bodyRef.current.id]?.cold ?? 0,
      warm: HEAT_PARAMS[bodyRef.current.id]?.warm ?? 0,
    };
    interface Flick {
      idx: number;
      amp: number;
      start: number;
    }
    const flicks: Flick[] = [];
    let nextFlickAt = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastT < 0 ? 0 : Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      const t = now / 1000;

      // 全局 bright/tint 指数过渡（~0.8s 收敛）
      const tgt = HEAT_PARAMS[bodyRef.current.id] ?? HEAT_DEFAULT;
      const k = 1 - Math.exp(-dt / 0.25);
      g.bright += (tgt.bright - g.bright) * k;
      g.cold += (tgt.cold - g.cold) * k;
      g.warm += (tgt.warm - g.warm) * k;

      // 偶发闪烁：每秒随机 1-3 格，300ms 正弦凸起后恢复
      if (now >= nextFlickAt) {
        const n = 1 + Math.floor(Math.random() * 3);
        const count = hexesRef.current.length;
        for (let i = 0; i < n; i++) {
          flicks.push({
            idx: Math.floor(Math.random() * count),
            amp: (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.07),
            start: now,
          });
        }
        nextFlickAt = now + 1000;
      }
      for (let i = flicks.length - 1; i >= 0; i--) {
        if (now - flicks[i].start > 300) flicks.splice(i, 1);
      }

      const hexList = hexesRef.current;
      const polys = polysRef.current;
      const brightOff = g.bright - HEAT_DEFAULT.bright; // sol 基准 = 0
      for (let i = 0; i < hexList.length; i++) {
        const el = polys[i];
        if (!el) continue;
        const h = hexList[i];
        let v =
          h.t +
          brightOff +
          0.12 * Math.sin(0.8 * (h.x * 0.35 + h.y * 0.25) - t * 0.9);
        for (const f of flicks) {
          if (f.idx === i) {
            v += f.amp * Math.sin(Math.PI * clamp((now - f.start) / 300, 0, 1));
          }
        }
        const rgb = RAMP_LUT[Math.round(clamp(v, 0, 1) * 255)];
        let R = rgb[0];
        let G = rgb[1];
        let B = rgb[2];
        if (g.cold > 0.002) {
          R += (COLD[0] - R) * g.cold;
          G += (COLD[1] - G) * g.cold;
          B += (COLD[2] - B) * g.cold;
        }
        if (g.warm > 0.002) {
          R += (WARM[0] - R) * g.warm;
          G += (WARM[1] - G) * g.warm;
          B += (WARM[2] - B) * g.warm;
        }
        el.setAttribute(
          'fill',
          `rgb(${Math.round(R)},${Math.round(G)},${Math.round(B)})`,
        );
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cells = useMemo(
    () =>
      hexes.map((h, i) => (
        <polygon
          key={i}
          className="heat__hex"
          points={hexPoints(h.x, h.y, HEX_R)}
          fill={rampColor(h.t)}
          ref={(el) => {
            polysRef.current[i] = el;
          }}
        />
      )),
    [hexes],
  );

  const scaleLabels = ['800', '700', '600', '500', '400', '300', '200'];

  return (
    <svg
      className="heat__svg"
      viewBox="0 0 267 94"
      aria-hidden
    >
      <defs>
        <linearGradient id="heat-ruler-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d5dcd2" />
          <stop offset="1" stopColor="#262926" />
        </linearGradient>
        <clipPath id="heat-clip">
          <rect x={1} y={1} width={226} height={92} />
        </clipPath>
      </defs>

      {/* 面板底与边框 */}
      <rect x={0.5} y={0.5} width={266} height={93} fill="#cad5c9" stroke="#757b6e" />

      {/* 蜂窝热区（裁剪到热区矩形；参考图六边形之间为深色细描边） */}
      <g clipPath="url(#heat-clip)" stroke="#6a7063" strokeWidth={1}>
        {cells}
      </g>

      {/* 四角 L 括号 */}
      <g stroke="#1a1c18" strokeWidth={2} fill="none">
        <path d="M22 8 L8 8 L8 22" />
        <path d="M218 22 L218 8 L204 8" />
        <path d="M8 72 L8 86 L22 86" />
        <path d="M218 72 L218 86 L204 86" />
      </g>

      {/* 灰阶标尺 */}
      <rect
        x={229}
        y={8}
        width={29}
        height={75}
        fill="url(#heat-ruler-grad)"
        stroke="#2c302a"
        strokeWidth={0.8}
      />
      <g className="heat__lbl">
        {scaleLabels.map((s, i) => (
          <text key={s} x={233} y={13 + i * 10.71}>
            {s}
          </text>
        ))}
      </g>
      <g stroke="#3f443c" strokeWidth={1.2}>
        {scaleLabels.map((_, i) => (
          <line key={i} x1={252} y1={9.8 + i * 10.71} x2={258.7} y2={9.8 + i * 10.71} />
        ))}
      </g>
    </svg>
  );
}
