import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import type { CelestialBody } from '../data/bodies';
import { mulberry32 } from './seeded';

/**
 * MASS ACCRETION FLOW RATE —— 多层同心圆形表盘（SVG）。
 * 由外向内：细外环 + 四向十字刻度 → 双圈短线/虚线环 → 灰阶方块环 →
 * 多段粗黑/灰弧 → 放射线环 → 细内环 → 正中粗体 C 形（双层 C 弧 + 横杠）。
 * 一段粗黑主弧随 body.accretionRate 转动并伸缩并轻微呼吸（opacity 0.88±0.1）；
 * 全部环层（放射线、两组散布短划、6 段粗弧及原三层旋转环）绕中心持续公转，
 * 营造太阳系行星绕恒星观感：角速度由内向外开普勒式递减（26 → 3.6 °/s）、
 * 层间互不相同、方向混排（顺时针 + 逆时针）；角度取自绝对时间，切换天体不重置。
 * 最外层四向刻度（上/下/左/右四条短刻度）固定不旋转，不参与公转。
 * 中央 C 形以最快角速度独立旋转（29 °/s 逆时针，与 r20 层反向），保持整体观感协调。
 * 切换天体时 accretionRate 逐帧指数收敛（~0.6s 到目标，平滑过渡）；
 * 中央 C 形正下方显示 rate 的等宽两位数字，rAF 跟随 lerp 后的值直接改 textContent。
 * 周边散布等宽小标注与三条指示线，位置按 reference.png 实测摆放。
 */

const CX = 146;
const CY = 129;

/** 极坐标 → 直角（y 向下，0°=东，90°=南） */
function pt(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/** 圆弧路径（start<end，顺时针扫过） */
function arc(r: number, start: number, end: number): string {
  const [x0, y0] = pt(r, start);
  const [x1, y1] = pt(r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** 切向短划环 */
function dashRing(
  r: number,
  n: number,
  len: number,
  w: number,
  color: string | ((i: number) => string),
  phase = 0,
): ReactElement[] {
  const out: ReactElement[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i * 360) / n;
    const rad = (a * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const mx = CX + r * cos;
    const my = CY + r * sin;
    const dx = (-sin * len) / 2;
    const dy = (cos * len) / 2;
    out.push(
      <line
        key={`${r}-${i}`}
        x1={mx - dx}
        y1={my - dy}
        x2={mx + dx}
        y2={my + dy}
        stroke={typeof color === 'function' ? color(i) : color}
        strokeWidth={w}
      />,
    );
  }
  return out;
}

export default function AccretionDial({ body }: { body: CelestialBody }) {
  const a1Ref = useRef<SVGPathElement>(null);
  const sqRef = useRef<SVGGElement>(null);
  const dashARef = useRef<SVGGElement>(null);
  const dashBRef = useRef<SVGGElement>(null);
  const rateTextRef = useRef<SVGTextElement>(null);
  /* 原静态环层 → 公转分组（角速度见 rAF 循环，由内向外递减、方向混排） */
  const cRef = useRef<SVGGElement>(null); // 中央 C 形（最快，29 °/s，与 r20 反向）
  const arc20Ref = useRef<SVGGElement>(null);
  const raysRef = useRef<SVGGElement>(null);
  const arc50Ref = useRef<SVGGElement>(null);
  const grayRef = useRef<SVGGElement>(null);
  const arc60Ref = useRef<SVGGElement>(null);
  const arc66Ref = useRef<SVGGElement>(null);
  const arc72Ref = useRef<SVGGElement>(null);
  const arc74Ref = useRef<SVGGElement>(null);
  const darkRef = useRef<SVGGElement>(null);
  // 最外层四向十字刻度为静态固定元素，不再挂 ref / 不参与 rAF 公转
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const rateRef = useRef(body.accretionRate);

  useEffect(() => {
    let raf = 0;
    let lastT = -1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastT < 0 ? 0 : Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      const t = now / 1000;
      // accretionRate 指数收敛，~0.6s 到目标（平滑无跳变）
      rateRef.current +=
        (bodyRef.current.accretionRate - rateRef.current) * (1 - Math.exp(-dt / 0.2));
      const rate = rateRef.current;

      const a1 = a1Ref.current;
      if (a1) {
        const start = -75 + 5 * Math.sin(t * 0.11);
        const span = 110 + 80 * rate;
        a1.setAttribute('d', arc(79, start, start + span));
        // 轻微呼吸
        a1.setAttribute('opacity', (0.88 + 0.1 * Math.sin(t * 0.9)).toFixed(3));
      }
      // 全部环层持续公转（太阳系观感）：角速度由内向外递减、层间互不相同、方向混排；
      // 角度取自绝对时间 t，切换天体时不重置、不跳变
      const spin = (el: SVGGElement | null, deg: number) =>
        el?.setAttribute(
          'transform',
          `rotate(${deg.toFixed(2)} ${CX} ${CY})`,
        );
      spin(arc20Ref.current, t * 26.0); //   r20   最内层弧
      spin(raysRef.current, -t * 18.0); //   r27–40 放射线环
      spin(arc50Ref.current, t * 11.0); //   r50   静态弧
      spin(grayRef.current, -t * 9.2); //   r55   散布短划（灰）
      spin(arc60Ref.current, t * 8.0); //   r60   静态弧
      spin(sqRef.current, -t * 7.0); //     r62   方块环
      spin(arc66Ref.current, t * 6.0); //   r66   静态弧
      spin(arc72Ref.current, -t * 5.2); //   r72   静态弧
      spin(arc74Ref.current, t * 4.8); //   r74   静态弧
      spin(darkRef.current, -t * 4.4); //   r78   散布短划（近黑）
      spin(dashBRef.current, t * 4.0); //   r91   虚线环
      spin(dashARef.current, -t * 3.6); //   r101  虚线环
      // r~109 最外层四向十字刻度：固定不旋转，已移出公转循环
      spin(cRef.current, -t * 29.0); //     r15–27 中央 C 形（最快，与 r20 反向）
      // 中央 C 形正下方的等宽两位数字：跟随 lerp 后的 rate 直接改 textContent
      const rt = rateTextRef.current;
      if (rt) {
        const s = String(Math.round(rate * 100));
        if (rt.textContent !== s) rt.textContent = s;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* 种子散布短划（r55 灰、r78 近黑） */
  const scattered = useMemo(() => {
    const rnd = mulberry32(body.shearSeed);
    const gray: ReactElement[] = [];
    for (let i = 0; i < 9; i++) {
      const a = rnd() * 360;
      const [x, y] = pt(55, a);
      const rad = (a * Math.PI) / 180;
      gray.push(
        <line
          key={`s55-${i}`}
          x1={x + Math.sin(rad) * 2.6}
          y1={y - Math.cos(rad) * 2.6}
          x2={x - Math.sin(rad) * 2.6}
          y2={y + Math.cos(rad) * 2.6}
          stroke="#4a4f45"
          strokeWidth={2.4}
        />,
      );
    }
    const dark: ReactElement[] = [];
    for (let i = 0; i < 4; i++) {
      const a = 20 + rnd() * 320;
      const [x, y] = pt(78, a);
      const rad = (a * Math.PI) / 180;
      dark.push(
        <line
          key={`s78-${i}`}
          x1={x + Math.sin(rad) * 2.6}
          y1={y - Math.cos(rad) * 2.6}
          x2={x - Math.sin(rad) * 2.6}
          y2={y + Math.cos(rad) * 2.6}
          stroke="#1a1c18"
          strokeWidth={2.5}
        />,
      );
    }
    return { gray, dark };
  }, [body.shearSeed]);

  /* 方块环：灰阶混杂（参考图 ~38 枚小方块密排） */
  const squares = useMemo(() => {
    const rnd = mulberry32(body.shearSeed + 7);
    const tones = ['#8a9082', '#82887a', '#5a5f55', '#6d7365'];
    return dashRing(62, 48, 5, 4.5, () => tones[Math.floor(rnd() * tones.length)]);
  }, [body.shearSeed]);

  /* 放射线环（右上留缺口走指示线） */
  const rays = useMemo(() => {
    const out: ReactElement[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i * 360) / 60;
      if (a > 22 && a < 60) continue;
      const rad = (a * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      out.push(
        <line
          key={`ray-${i}`}
          x1={CX + 27 * cos}
          y1={CY + 27 * sin}
          x2={CX + 40 * cos}
          y2={CY + 40 * sin}
          stroke="#8a9082"
          strokeWidth={1.1}
        />,
      );
    }
    return out;
  }, []);

  const [x0, y0] = pt(15, 115 - 360);
  const [x1, y1] = pt(15, -50);

  return (
    <svg
      className="dial__svg"
      viewBox="0 0 304 264"
      aria-hidden
    >
      {/* 指示线 */}
      <line x1={50} y1={110} x2={102} y2={110} className="dial__leader" />
      <line x1={55} y1={136} x2={80} y2={136} className="dial__leader" />
      <line x1={154} y1={89} x2={218} y2={89} className="dial__leader" />

      {/* 环与十字刻度 */}
      <circle cx={CX} cy={CY} r={111} className="dial__ring" />
      <circle cx={CX} cy={CY} r={50} className="dial__ring-thin" />
      <circle cx={CX} cy={CY} r={24} className="dial__ring-inner" />
      {/* 最外层四向十字刻度（上/右/下/左）：永久固定，不参与公转 */}
      <g>
        <line x1={146} y1={15} x2={146} y2={25} stroke="#1a1c18" strokeWidth={2.2} />
        <line x1={250} y1={129} x2={260} y2={129} stroke="#1a1c18" strokeWidth={2.2} />
        <line x1={146} y1={233} x2={146} y2={243} stroke="#1a1c18" strokeWidth={2.2} />
        <line x1={32} y1={129} x2={42} y2={129} stroke="#1a1c18" strokeWidth={2.2} />
      </g>

      {/* 放射线环（公转） */}
      <g ref={raysRef}>{rays}</g>

      {/* 旋进的虚线/方块环（外圈细密圆点环按参考图 ~44 枚） */}
      <g ref={dashARef}>{dashRing(101, 44, 3.2, 1.8, '#454a3e')}</g>
      <g ref={dashBRef}>{dashRing(91, 26, 5, 2.5, '#2a2e26')}</g>
      <g ref={sqRef}>{squares}</g>

      {/* 散布短划（公转） */}
      <g ref={grayRef}>{scattered.gray}</g>
      <g ref={darkRef}>{scattered.dark}</g>

      {/* 弧段（逐段独立公转，角速度由内向外递减）：深灰 / 中灰 / 灰 / 底部粗黑 */}
      <g ref={arc60Ref}>
        <path d={arc(60, 152, 212)} stroke="#7d8276" strokeWidth={5.5} fill="none" />
      </g>
      <g ref={arc66Ref}>
        <path d={arc(66, 192, 262)} stroke="#9aa091" strokeWidth={7} fill="none" />
      </g>
      <g ref={arc74Ref}>
        <path d={arc(74, 140, 188)} stroke="#4a4f45" strokeWidth={8} fill="none" />
      </g>
      <g ref={arc72Ref}>
        <path d={arc(72, 60, 135)} stroke="#191c16" strokeWidth={10} fill="none" />
      </g>
      <g ref={arc50Ref}>
        <path d={arc(50, 58, 132)} stroke="#14160f" strokeWidth={6.5} fill="none" />
      </g>
      <g ref={arc20Ref}>
        <path d={arc(20, 55, 110)} stroke="#14160f" strokeWidth={4} fill="none" />
      </g>

      {/* 主弧（随 accretionRate 转动/伸缩） */}
      <path
        ref={a1Ref}
        d={arc(79, -75, -75 + 110 + 80 * body.accretionRate)}
        stroke="#16181a"
        strokeWidth={9}
        fill="none"
      />

      {/* 正中粗体 C 形（独立公转分组）：外粗弧 + 粗 C + 右下钩 */}
      <g ref={cRef}>
        <path d={arc(27, -75, 110)} stroke="#101210" strokeWidth={4} fill="none" />
        <path
          d={`M ${x0.toFixed(2)} ${y0.toFixed(2)} A 15 15 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`}
          stroke="#101210"
          strokeWidth={6.5}
          fill="none"
        />
        <path d={arc(17, 8, 70)} stroke="#101210" strokeWidth={4.5} fill="none" />
      </g>

      {/* 中央 C 形正下方：accretionRate 等宽两位数字（rAF 更新 textContent） */}
      <text
        ref={rateTextRef}
        x={146}
        y={153.5}
        textAnchor="middle"
        className="dial__rate"
      >
        {Math.round(body.accretionRate * 100)}
      </text>

      {/* 顶部 / 底部标记 */}
      <text x={146} y={12.5} className="dial__tb" textAnchor="middle">T</text>
      <text x={146} y={258} className="dial__tb" textAnchor="middle">B</text>

      {/* 左上：EQUATORIAL KINETICS */}
      <g className="dial__t">
        <text x={21} y={59}>EQUATORIAL</text>
        <text x={21} y={67.5}>KINETICS</text>
        <text x={21} y={76}>0.485</text>
        <text x={21} y={84.5}>0.203</text>
        <text x={21} y={93}>1.002</text>
      </g>

      {/* 左中两组编号 */}
      <g className="dial__t-s">
        <text x={21} y={112.5}>L4811</text>
        <text x={21} y={119.5}>720</text>
        <text x={21} y={126.5}>001</text>
        <text x={21} y={136}>C200</text>
        <text x={21} y={143}>R389</text>
        <text x={21} y={150}>10 11</text>
        <text x={21} y={157}>00 00</text>
      </g>

      {/* 右上 / 右中 */}
      <g className="dial__t-s" textAnchor="end">
        <text x={258} y={37}>MASS ACCRETION</text>
        <text x={258} y={46}>DYNAMICS</text>
        <text x={258} y={55}>E=MC2</text>
      </g>
      <g className="dial__t-s" textAnchor="end">
        <text x={259} y={89.5}>SYS DIAGNOSTICS</text>
        <text x={259} y={95.5}>ACT</text>
        <text x={259} y={101.5}>RDY</text>
        <text x={259} y={107.5}>ERR</text>
        <text x={259} y={113.5}>OPR</text>
      </g>

      {/* 底部左右 */}
      <g className="dial__t-xs">
        <text x={21} y={256}>MASS FLUX</text>
        <text x={21} y={261.5}>0.0048M/YR</text>
      </g>
      <g className="dial__t-xs" textAnchor="end">
        <text x={285} y={256}>EDDINGTON</text>
        <text x={285} y={261.5}>RATIO: 0.12</text>
      </g>
    </svg>
  );
}
