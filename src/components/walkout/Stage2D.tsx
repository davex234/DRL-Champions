"use client";

/**
 * PACK WALKOUT · ESCENARIO 2D (CSS + SVG). Respaldo sin WebGL y versión de movimiento reducido.
 *
 * El mismo túnel en perspectiva (marcos de luz que se encienden del fondo hacia delante), suelo con reflejo, conos de
 * luz y una silueta a contraluz que crece al acercarse. Todo sale del fotograma de la timeline (nada de animaciones CSS
 * con su propio reloj): SALTAR o congelar un instante pintan exactamente lo mismo.
 */
import { clamp01, easeInOutCubic, easeOutCubic, type WalkoutFrame } from "@/domain/walkout/timeline";
import type { EditionPreset } from "@/domain/walkout/input";

const FRAMES = 9;

export function Stage2D({ frame, walk, preset, reduced }: { frame: WalkoutFrame; walk: boolean; preset: EditionPreset; reduced: boolean }) {
  const p = (id: keyof WalkoutFrame["p"]) => frame.p[id] ?? 0;
  // Con movimiento reducido no hay beat de luces: el escenario está encendido (quieto) desde el principio.
  const lights = reduced ? 1 : p("lights");
  const flash = p("flash");
  const reveal = Math.max(p("name"), p("card"));
  const teamHit = p("team") > 0.55 && p("team") < 1 ? Math.sin(((p("team") - 0.55) / 0.45) * Math.PI) : 0;
  const hp = walk ? p("human") : 0;
  const k = clamp01(hp / 0.82);
  const travel = k < 0.85 ? (k / 0.85) * 0.92 : 0.92 + easeOutCubic((k - 0.85) / 0.15) * 0.08;
  const stride = (travel * 14) * Math.PI;
  const amt = k < 0.85 ? 1 : 1 - easeOutCubic((k - 0.85) / 0.15);
  const swing = Math.sin(stride) * 24 * amt;
  const scale = 0.18 + travel * 0.82;
  const humanOpacity = (hp > 0 ? Math.min(1, hp * 8) : 0) * (1 - easeInOutCubic(p("card")));
  const lit = clamp01(flash);
  const push = reduced ? 1 : 1 + (walk ? easeInOutCubic(hp) * 0.05 : easeInOutCubic(lights) * 0.02) + easeInOutCubic(Math.max(flash, p("name"))) * 0.03;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#030409" }} data-testid="walkout-stage-2d" aria-hidden>
      <div className="absolute inset-0" style={{ transform: `scale(${push})`, transformOrigin: "50% 55%" }}>
        {/* pantalla del fondo */}
        <div className="absolute left-1/2 top-[38%] h-[30%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
          style={{ background: `radial-gradient(closest-side, ${preset.light}, transparent)`, opacity: Math.min(1, lights * 0.55 + teamHit * 0.4 + lit * 0.5) * (1 - reveal * 0.3), filter: "blur(18px)" }} />
        {/* marcos del túnel en perspectiva */}
        {Array.from({ length: FRAMES }, (_, i) => {
          const depth = i / (FRAMES - 1);                    // 0 = el del fondo
          const size = 14 + depth ** 1.6 * 110;
          const on = clamp01(lights * 1.6 - (depth) * 0.6);
          return (
            <div key={i} className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2"
              style={{
                width: `${size}%`, height: `${size * 0.72}%`,
                border: `${1 + depth * 2}px solid ${preset.light}`, borderBottom: "none",
                boxShadow: `0 0 ${8 + depth * 18}px ${preset.light}`,
                opacity: Math.min(1, on * 0.6 + teamHit * 0.35 + lit * 0.4) * (1 - reveal * 0.45) * (0.35 + depth * 0.65),
              }} />
          );
        })}
        {/* suelo reflectante + tiras LED hacia el punto de fuga */}
        <div className="absolute inset-x-0 bottom-0 h-[51%]"
          style={{ background: `radial-gradient(40% 60% at 50% 0%, ${preset.light}38, transparent 70%), linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.7) 100%)`, opacity: lights }} />
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ opacity: clamp01(lights * 1.4 - 0.2) }}>
          <line x1="43" y1="49" x2="-28" y2="100" stroke={preset.light} strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 3px ${preset.light})` }} />
          <line x1="57" y1="49" x2="128" y2="100" stroke={preset.light} strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 3px ${preset.light})` }} />
        </svg>
        {/* conos de luz */}
        {[-1, 1].map((s) => (
          <div key={s} className="absolute top-0 h-[78%] w-[26%]"
            style={{ left: s < 0 ? "16%" : "58%", background: `linear-gradient(to bottom, ${preset.accent}55, transparent)`, clipPath: "polygon(40% 0, 60% 0, 100% 100%, 0 100%)", opacity: lights * 0.35 + lit * 0.25, mixBlendMode: "screen", transform: `rotate(${s * -7}deg)` }} />
        ))}
        {/* silueta a contraluz (placeholder propio: sin cara, sin logos) */}
        {walk && (
          <div className="absolute left-1/2 bottom-[16%]" style={{ height: "62%", aspectRatio: "0.42", transform: `translateX(-50%) translateY(${(1 - travel) * -32}%) scale(${scale})`, transformOrigin: "50% 100%", opacity: humanOpacity }}>
            <Silhouette swing={swing} lit={lit} rim={preset.light} />
            <div className="absolute inset-x-0 top-full h-full origin-top scale-y-[-1] opacity-25 blur-[2px]"><Silhouette swing={swing} lit={lit} rim={preset.light} /></div>
          </div>
        )}
        {/* bruma */}
        <div className="absolute inset-0" style={{ background: `radial-gradient(70% 45% at 50% 60%, ${preset.light}22, transparent)`, opacity: lights * 0.8 }} />
      </div>
    </div>
  );
}

function Silhouette({ swing, lit, rim }: { swing: number; lit: number; rim: string }) {
  const body = `rgb(${12 + lit * 120}, ${13 + lit * 120}, ${20 + lit * 120})`;
  return (
    <svg viewBox="0 0 84 200" className="h-full w-full" style={{ filter: `drop-shadow(0 0 3px ${rim}) drop-shadow(0 0 10px ${rim}88)` }}>
      <g fill={body}>
        <g transform={`rotate(${swing * 0.7} 30 58)`}><rect x="22" y="56" width="11" height="58" rx="5.5" /></g>
        <g transform={`rotate(${-swing * 0.7} 54 58)`}><rect x="51" y="56" width="11" height="58" rx="5.5" /></g>
        <g transform={`rotate(${-swing} 36 108)`}><rect x="29" y="104" width="13" height="86" rx="6.5" /><rect x="27" y="184" width="17" height="9" rx="4" /></g>
        <g transform={`rotate(${swing} 48 108)`}><rect x="42" y="104" width="13" height="86" rx="6.5" /><rect x="40" y="184" width="17" height="9" rx="4" /></g>
        <path d="M24 56 Q42 44 60 56 L58 112 Q42 118 26 112 Z" />
        <ellipse cx="42" cy="34" rx="12.5" ry="15" />
        <path d="M27 50 Q42 40 57 50 L54 58 Q42 52 30 58 Z" />
      </g>
    </svg>
  );
}
