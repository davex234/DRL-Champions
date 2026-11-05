"use client";

/**
 * FASE 44.1 · GAME ENVIRONMENT — el mundo que hay DETRÁS de la interfaz (sustituye a `DynamicGameBackground`).
 *
 * Capas (ver `src/design/environment.ts`):
 *   L0 base         degradado propio del lugar + viñeta (sin capa de grano: ver nota abajo)
 *   L1 arquitectura dibujo SVG original del lugar (arena, bóveda, cámara, sala táctica, mapa, tríptico, escalera…)
 *   L2 luz          focos de color con deriva lenta (transform), un barrido holográfico en algunos lugares
 *   L3 partículas   UN canvas acotado (se para con la pestaña oculta; quieto con movimiento reducido)
 *   L5 contexto     tinte del modo apuntado en el lobby (`nexus:env-focus`) y atenuado (`nexus:env-dim`)
 *
 * Nunca captura el puntero (`pointer-events: none`), es `aria-hidden`, fijo detrás de todo (no se corta al hacer scroll)
 * y solo anima `transform`/`opacity`. El parallax (4–12 px) escucha `pointermove` PASIVO y escribe dos variables CSS
 * en un rAF; sin puntero fino, en pantallas < 1024 px o con movimiento reducido, no existe.
 */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import {
  ENVIRONMENTS, ENV_DIM_EVENT, ENV_FOCUS_EVENT, FOCUS_TINT, particleBudget,
  type Architecture, type EnvironmentFocus, type EnvironmentVariant,
} from "@/design/environment";
import { td } from "@/i18n/runtime";

const c = (t: [number, number, number], a: number) => `rgba(${t[0]},${t[1]},${t[2]},${a})`;

/*
 * SIN CAPA DE GRANO (decisión medida). Hubo una capa de grano a pantalla completa (primero SVG `feTurbulence`, luego un
 * PNG en mosaico): sobre las luces animadas obliga a recomponer todo el ambiente en cada fotograma y, sin GPU, a partir
 * de ~1,5 M de píxeles físicos (768 px con DPR 2, 1920, 2560) el navegador dejaba de entregar fotogramas (CDP). La textura
 * la dan la arquitectura SVG, las luces y la viñeta.
 */

export function GameEnvironment({ variant, className }: { variant: EnvironmentVariant; className?: string }) {
  const spec = ENVIRONMENTS[variant] ?? ENVIRONMENTS.lobby;
  // Hasta montar, el mismo árbol que el servidor (que no conoce la preferencia): sin desajuste de hidratación.
  const reducedPref = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const reduced = mounted && !!reducedPref;
  const root = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<EnvironmentFocus>(null);
  const [dim, setDim] = useState(0);
  const [width, setWidth] = useState(1440);

  useEffect(() => {
    const onFocus = (e: Event) => setFocus(((e as CustomEvent).detail ?? null) as EnvironmentFocus);
    const onDim = (e: Event) => setDim(Math.max(0, Math.min(1, Number((e as CustomEvent).detail) || 0)));
    const onResize = () => setWidth(window.innerWidth);
    onResize();
    window.addEventListener(ENV_FOCUS_EVENT, onFocus);
    window.addEventListener(ENV_DIM_EVENT, onDim);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener(ENV_FOCUS_EVENT, onFocus); window.removeEventListener(ENV_DIM_EVENT, onDim); window.removeEventListener("resize", onResize); };
  }, []);
  // Al cambiar de lugar se olvida el foco y el atenuado del lugar anterior.
  useEffect(() => { setFocus(null); setDim(0); }, [variant]);

  // Parallax: puntero fino, ≥ 1024 px, sin movimiento reducido. Pasivo + rAF: nunca bloquea la rueda ni el puntero.
  useEffect(() => {
    const el = root.current;
    if (!el || reduced || spec.parallax === 0 || !window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0; let nx = 0; let ny = 0;
    const onMove = (e: PointerEvent) => {
      nx = (e.clientX / window.innerWidth) * 2 - 1; ny = (e.clientY / window.innerHeight) * 2 - 1;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (window.innerWidth < 1024) return; el.style.setProperty("--env-px", nx.toFixed(3)); el.style.setProperty("--env-py", ny.toFixed(3)); });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); if (raf) cancelAnimationFrame(raf); el.style.setProperty("--env-px", "0"); el.style.setProperty("--env-py", "0"); };
  }, [reduced, spec.parallax, variant]);

  const P = spec.parallax;
  const layer = (depth: number) => ({ transform: `translate3d(calc(var(--env-px, 0) * ${(P * depth).toFixed(1)}px), calc(var(--env-py, 0) * ${(P * depth * 0.6).toFixed(1)}px), 0)` });

  return (
    <div
      ref={root}
      aria-hidden
      data-environment={variant}
      data-focus={focus ?? "none"}
      data-motion={reduced ? "static" : "ambient"}
      className={cn("nx-env pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}
      style={{ background: `radial-gradient(140% 100% at 50% 0%, ${spec.base[0]}, ${spec.base[1]} 72%)` }}
    >
      {/* L2 · luz (detrás de la arquitectura para que las formas se recorten contra ella) */}
      <div className="nx-env-layer" style={layer(0.25)}>
        <span className="nx-env-light nx-env-light-a" style={{ background: `radial-gradient(closest-side, ${c(spec.primary, 0.34)}, transparent)` }} />
        <span className="nx-env-light nx-env-light-b" style={{ background: `radial-gradient(closest-side, ${c(spec.secondary, 0.22)}, transparent)` }} />
        <span className="nx-env-light nx-env-light-c" style={{ background: `radial-gradient(closest-side, ${c(spec.primary, 0.16)}, transparent)` }} />
      </div>

      {/* L1 · arquitectura del lugar */}
      <div className="nx-env-layer" style={layer(0.55)}>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
          <ArchitectureLayer kind={spec.architecture} p={spec.primary} s={spec.secondary} />
        </svg>
      </div>

      {/* L5 · reacción al modo apuntado (solo lobby): cuatro tintes que se cruzan por opacidad */}
      {variant === "lobby" && (Object.keys(FOCUS_TINT) as Exclude<EnvironmentFocus, null>[]).map((k) => (
        <span key={k} data-tint={k} className="nx-env-focus" style={{ opacity: focus === k ? 1 : 0, background: `radial-gradient(70% 60% at 62% 38%, ${c(FOCUS_TINT[k], 0.26)}, transparent 70%), radial-gradient(90% 60% at 50% 110%, ${c(FOCUS_TINT[k], 0.18)}, transparent 70%)` }} />
      ))}

      {/* barrido holográfico (una sola línea, lento) */}
      {spec.motion.includes("sweep") && !reduced && <span className="nx-env-sweep" style={{ background: `linear-gradient(180deg, transparent, ${c(spec.secondary, 0.1)}, transparent)` }} />}

      {/* L3 · partículas */}
      {spec.motion.includes("particles") && <div className="nx-env-layer" style={layer(1)}><ParticleField count={particleBudget(spec, width, reduced)} drift={spec.drift} tint={spec.primary} reduced={reduced} /></div>}

      {/* L0 · grano + viñeta + atenuado del lugar */}
      <span className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(3,4,8,0.78) 100%)" }} />
      <span className="nx-env-dim" style={{ opacity: Math.min(0.75, spec.dim * 0.6 + dim * 0.6) }} />
    </div>
  );
}

/* ────────────────────────── L1 · arquitectura (SVG original) ────────────────────────── */

function ArchitectureLayer({ kind, p, s }: { kind: Architecture; p: [number, number, number]; s: [number, number, number] }) {
  const pl = (a: number) => c(p, a);
  const sl = (a: number) => c(s, a);
  switch (kind) {
    case "arena": return (
      <g fill="none">
        {/* skyline de bloques chaflanados en el horizonte */}
        <path d="M0 560 L120 560 L140 500 L260 500 L280 530 L420 530 L440 470 L520 470 L540 520 L700 520 L720 480 L880 480 L900 440 L980 440 L1000 500 L1160 500 L1180 460 L1300 460 L1320 520 L1460 520 L1480 490 L1600 490 L1600 1000 L0 1000 Z" fill="rgba(3,4,10,0.55)" />
        <line x1="0" y1="560" x2="1600" y2="560" stroke={sl(0.35)} strokeWidth="1.5" />
        {/* suelo en perspectiva */}
        {Array.from({ length: 21 }, (_, i) => <line key={`v${i}`} x1={800} y1={560} x2={-1200 + i * 200} y2={1000} stroke={pl(0.12)} />)}
        {[590, 630, 690, 770, 880].map((y) => <line key={y} x1="0" y1={y} x2="1600" y2={y} stroke={pl(0.1)} />)}
        {/* anillos hexagonales detrás del escenario de JUGAR */}
        {[260, 360, 470].map((r, i) => <polygon key={r} points={hex(440, 380, r)} stroke={pl(0.16 - i * 0.04)} strokeWidth={i === 0 ? 2 : 1} />)}
        {/* pilares de luz */}
        {[1180, 1360].map((x) => <rect key={x} x={x} y="0" width="46" height="560" fill={`url(#pillar)`} />)}
        <defs><linearGradient id="pillar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sl(0)} /><stop offset="0.6" stopColor={sl(0.12)} /><stop offset="1" stopColor={sl(0)} /></linearGradient></defs>
      </g>
    );
    case "vault": return (
      <g fill="none">
        <defs>
          <linearGradient id="shaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(255,255,255,0.09)" /><stop offset="1" stopColor="rgba(255,255,255,0)" /></linearGradient>
          <linearGradient id="slot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={pl(0.22)} /><stop offset="1" stopColor={pl(0.02)} /></linearGradient>
        </defs>
        {/* paredes en perspectiva */}
        <path d="M0 0 L380 170 L380 830 L0 1000 Z" fill="rgba(3,3,10,0.5)" stroke={pl(0.18)} />
        <path d="M1600 0 L1220 170 L1220 830 L1600 1000 Z" fill="rgba(3,3,10,0.5)" stroke={pl(0.18)} />
        {/* huecos de cartas en las paredes */}
        {Array.from({ length: 4 }, (_, col) => Array.from({ length: 5 }, (_, row) => {
          const t = col / 4; const x = 40 + col * 84; const top = 60 + t * 110 + row * (150 - t * 26); const h = 110 - t * 22;
          const lit = (col * 7 + row * 3) % 5 === 0;
          return <g key={`l${col}-${row}`}><polygon points={`${x},${top} ${x + 58},${top + 22} ${x + 58},${top + 22 + h} ${x},${top + h}`} fill={lit ? "url(#slot)" : "none"} stroke={pl(0.2)} /><polygon points={`${1600 - x},${top} ${1542 - x},${top + 22} ${1542 - x},${top + 22 + h} ${1600 - x},${top + h}`} fill={(col * 5 + row * 2) % 4 === 0 ? "url(#slot)" : "none"} stroke={pl(0.2)} /></g>;
        }))}
        {/* pared del fondo: vitrinas */}
        {Array.from({ length: 7 }, (_, i) => <rect key={i} x={430 + i * 108} y="250" width="74" height="104" stroke={sl(0.14)} fill={i % 3 === 1 ? sl(0.05) : "none"} />)}
        {Array.from({ length: 7 }, (_, i) => <rect key={`b${i}`} x={430 + i * 108} y="380" width="74" height="104" stroke={sl(0.1)} />)}
        {/* bóveda y haces de luz */}
        {[120, 200, 290].map((y) => <path key={y} d={`M380 ${y + 50} Q800 ${y - 140} 1220 ${y + 50}`} stroke={pl(0.12)} />)}
        {[640, 790, 940].map((x) => <polygon key={x} points={`${x},0 ${x + 60},0 ${x + 180},760 ${x - 60},760`} fill="url(#shaft)" />)}
        <line x1="380" y1="830" x2="1220" y2="830" stroke={sl(0.25)} />
      </g>
    );
    case "chamber": return (
      <g fill="none">
        <defs>
          <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={pl(0.26)} /><stop offset="1" stopColor={pl(0)} /></linearGradient>
        </defs>
        <polygon points="740,0 860,0 1120,800 480,800" fill="url(#cone)" />
        {[1, 2, 3, 4].map((i) => <ellipse key={i} cx="800" cy="800" rx={180 + i * 150} ry={36 + i * 30} stroke={pl(0.2 - i * 0.04)} />)}
        <ellipse cx="800" cy="790" rx="190" ry="34" fill="rgba(0,0,0,0.5)" stroke={pl(0.4)} />
        <rect x="610" y="790" width="380" height="60" fill="rgba(0,0,0,0.35)" />
        {[0, 1].map((side) => <polygon key={side} points={side ? "1600,0 1400,0 1340,1000 1600,1000" : "0,0 200,0 260,1000 0,1000"} fill="rgba(0,0,0,0.45)" stroke={sl(0.12)} />)}
      </g>
    );
    case "tactical": return (
      <g fill="none">
        <defs><pattern id="tgrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" stroke={pl(0.07)} /></pattern></defs>
        <rect width="1600" height="1000" fill="url(#tgrid)" />
        {[[1250, 260], [300, 760], [1360, 780]].map(([x, y]) => <g key={x}><circle cx={x} cy={y} r="70" stroke={sl(0.2)} /><circle cx={x} cy={y} r="4" fill={sl(0.4)} /><line x1={x - 100} y1={y} x2={x + 100} y2={y} stroke={sl(0.14)} /><line x1={x} y1={y - 100} x2={x} y2={y + 100} stroke={sl(0.14)} /></g>)}
        {["DUE", "CON", "INI", "CEN", "FLX"].map((r, i) => <g key={r}><polygon points={hex(1510, 240 + i * 120, 34)} stroke={pl(0.25)} /><text x="1510" y={245 + i * 120} textAnchor="middle" fontSize="15" fontFamily="Rajdhani, sans-serif" fontWeight="700" fill={pl(0.32)}>{td(r)}</text></g>)}
        <path d="M120 180 L520 180 L560 220 L560 420" stroke={pl(0.16)} />
      </g>
    );
    case "terrain": return (
      <g fill="none">
        {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M-50 ${420 + i * 60} C 300 ${340 + i * 58}, 520 ${520 + i * 50}, 820 ${430 + i * 60} S 1350 ${360 + i * 62}, 1700 ${460 + i * 55}`} stroke={pl(0.12 - i * 0.008)} />)}
        <path d="M0 320 L180 250 L320 300 L520 190 L700 280 L900 170 L1100 260 L1300 200 L1600 290" stroke={sl(0.25)} strokeWidth="1.5" />
        <path d="M200 860 C 420 760, 600 820, 800 700 S 1180 560, 1420 500" stroke={pl(0.35)} strokeDasharray="6 10" strokeWidth="2" />
        {[[200, 860], [520, 780], [800, 700], [1100, 600], [1420, 500]].map(([x, y], i) => <polygon key={i} points={hex(x, y, i === 4 ? 18 : 11)} stroke={pl(0.6)} fill={pl(0.12)} />)}
      </g>
    );
    case "triptych": return (
      <g fill="none">
        <defs><linearGradient id="spot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={pl(0.2)} /><stop offset="1" stopColor={pl(0)} /></linearGradient></defs>
        {/* F72 · solo los focos: los tres «huecos de carta» vacíos se leían como marcos descuadrados alrededor de las
            cartas reales del draft (que ya tienen su propio foco y suelo detrás). */}
        {[-1, 0, 1].map((i) => <polygon key={i} points={`${800 + i * 300 - 40},0 ${800 + i * 300 + 40},0 ${800 + i * 300 + 170},820 ${800 + i * 300 - 170},820`} fill="url(#spot)" />)}
        <line x1="0" y1="840" x2="1600" y2="840" stroke={sl(0.22)} />
      </g>
    );
    case "ladder": return (
      <g fill="none">
        {Array.from({ length: 8 }, (_, i) => <polygon key={i} points={`${1040 + i * 60},${860 - i * 80} ${1180 + i * 60},${860 - i * 80} ${1160 + i * 60},${900 - i * 80} ${1020 + i * 60},${900 - i * 80}`} fill={pl(0.04 + i * 0.012)} stroke={pl(0.18 + i * 0.02)} />)}
        {Array.from({ length: 6 }, (_, i) => <line key={`h${i}`} x1="0" y1={220 + i * 110} x2="1600" y2={220 + i * 110} stroke={sl(0.06)} />)}
        {Array.from({ length: 5 }, (_, i) => <line key={`d${i}`} x1={-200 + i * 180} y1="1000" x2={400 + i * 180} y2="0" stroke={pl(0.07)} />)}
      </g>
    );
    case "horizon": return (
      <g fill="none">
        {Array.from({ length: 6 }, (_, i) => <path key={i} d={`M${800 - (220 + i * 150)} 900 A ${220 + i * 150} ${220 + i * 150} 0 0 1 ${800 + 220 + i * 150} 900`} stroke={i === 0 ? sl(0.35) : pl(0.14 - i * 0.015)} strokeWidth={i === 0 ? 2 : 1} />)}
        {Array.from({ length: 14 }, (_, i) => { const a = Math.PI + (i / 13) * Math.PI; return <line key={`r${i}`} x1={800 + Math.cos(a) * 260} y1={900 + Math.sin(a) * 260} x2={800 + Math.cos(a) * 1100} y2={900 + Math.sin(a) * 1100} stroke={pl(0.05)} />; })}
        <line x1="0" y1="900" x2="1600" y2="900" stroke={sl(0.3)} />
        {Array.from({ length: 40 }, (_, i) => <circle key={`s${i}`} cx={(i * 397) % 1600} cy={(i * 211) % 560} r={i % 5 === 0 ? 1.8 : 1} fill="rgba(255,255,255,0.35)" />)}
      </g>
    );
    case "rings": return (
      <g fill="none">
        {[180, 300, 440, 600].map((r, i) => <ellipse key={r} cx="800" cy="620" rx={r * 1.6} ry={r * 0.5} stroke={pl(0.2 - i * 0.04)} />)}
        {Array.from({ length: 16 }, (_, i) => <line key={i} x1="800" y1="620" x2={800 + Math.cos((i / 16) * Math.PI * 2) * 1400} y2={620 + Math.sin((i / 16) * Math.PI * 2) * 440} stroke={sl(0.05)} />)}
      </g>
    );
    case "bracket": return (
      <g fill="none" stroke={pl(0.16)}>
        {[0, 1, 2, 3].map((i) => <path key={i} d={`M140 ${180 + i * 180} H320 V${270 + i * 180 - (i % 2 ? 180 : 0)} H500`} />)}
        <path d="M500 270 H620 V450 H760" /><path d="M500 630 H620 V450" /><path d="M1460 270 H1280 V450 H1140" /><path d="M1460 630 H1280 V450" />
        <polygon points={hex(950, 450, 70)} stroke={sl(0.35)} />
      </g>
    );
    case "gallery": return (
      <g fill="none">
        {[[200, 220], [520, 180], [1060, 180], [1380, 220]].map(([x, y], i) => <polygon key={i} points={chamferRect(x - 80, y, 160, 220, 14)} stroke={pl(0.22)} fill={i % 2 ? sl(0.04) : "none"} />)}
        <line x1="0" y1="760" x2="1600" y2="760" stroke={sl(0.2)} />
      </g>
    );
    case "globe": return (
      <g fill="none">
        <circle cx="1180" cy="620" r="420" stroke={pl(0.2)} />
        {[0.3, 0.6, 0.85].map((k) => <ellipse key={k} cx="1180" cy="620" rx={420 * k} ry="420" stroke={pl(0.1)} />)}
        {[-0.6, -0.2, 0.2, 0.6].map((k) => <ellipse key={k} cx="1180" cy={620 + k * 420} rx={420 * Math.sqrt(1 - k * k)} ry="40" stroke={sl(0.1)} />)}
      </g>
    );
  }
}

function hex(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 3) * k - Math.PI / 2; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(" ");
}
function chamferRect(x: number, y: number, w: number, h: number, k: number): string {
  return `${x},${y} ${x + w - k},${y} ${x + w},${y + k} ${x + w},${y + h} ${x + k},${y + h} ${x},${y + h - k}`;
}

/* ────────────────────────── L3 · partículas (canvas único, acotado) ────────────────────────── */

function ParticleField({ count, drift, tint, reduced }: { count: number; drift: number; tint: [number, number, number]; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || count <= 0) return;
    let width = 0; let height = 0;
    const dots: { x: number; y: number; r: number; vx: number; vy: number; phase: number }[] = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (dots.length === 0) for (let i = 0; i < count; i++) dots.push({ x: Math.random() * width, y: Math.random() * height, r: 0.6 + Math.random() * 1.7, vx: (Math.random() - 0.5) * drift, vy: -(0.25 + Math.random()) * drift * 0.5, phase: Math.random() * Math.PI * 2 });
      if (reduced) draw(performance.now());
    };
    let raf = 0; let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      ctx.clearRect(0, 0, width, height);
      for (const d of dots) {
        if (!reduced) {
          d.x += d.vx * dt; d.y += d.vy * dt;
          if (d.y < -8) { d.y = height + 8; d.x = Math.random() * width; }
          if (d.x < -8) d.x = width + 8; if (d.x > width + 8) d.x = -8;
        }
        const tw = reduced ? 0.5 : 0.35 + 0.35 * Math.sin(now / 1400 + d.phase);
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.4 * tw})`; ctx.fill();
      }
      if (!reduced && !document.hidden) raf = requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener("resize", resize);
    if (!reduced) raf = requestAnimationFrame(draw);
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !reduced) { last = performance.now(); raf = requestAnimationFrame(draw); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", onVis); };
  }, [count, drift, tint, reduced]);
  return <canvas ref={ref} data-testid="env-particles" data-count={count} className="absolute inset-0 h-full w-full" />;
}
