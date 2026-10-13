"use client";

/**
 * FASE 55 · EMBLEMA RANKED — identidad visual PROPIA (geometría de la casa, sin assets externos ni logos de
 * otros juegos). No es un tier: pinta el ESTADO real de la escalera.
 *
 *   SIN CLASIFICAR → escudo apagado y discontinuo, «—».
 *   COLOCACIÓN     → escudo cian con 10 muescas: las encendidas son las partidas de colocación jugadas.
 *   CLASIFICADO    → escudo rojo NEXUS macizo con el puesto; el #1 añade la corona de galones dorada.
 *
 * El texto (puesto, estado) va SIEMPRE escrito: el color nunca es la única señal.
 */
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import type { StandingState } from "@/domain/pvpLadder/ranked";

const TONE: Record<StandingState, { stroke: string; fill: string; glow: string }> = {
  UNRANKED: { stroke: "rgba(255,255,255,0.28)", fill: "rgba(255,255,255,0.03)", glow: "rgba(255,255,255,0.0)" },
  PLACEMENT: { stroke: "rgba(25,227,255,0.85)", fill: "rgba(25,227,255,0.07)", glow: "rgba(25,227,255,0.45)" },
  RANKED: { stroke: "rgba(255,46,99,0.9)", fill: "rgba(255,46,99,0.10)", glow: "rgba(255,46,99,0.55)" },
};

const SHIELD = "M100 8 L178 38 L178 104 C178 150 144 182 100 196 C56 182 22 150 22 104 L22 38 Z";
const SHIELD_IN = "M100 26 L162 50 L162 104 C162 140 136 166 100 178 C64 166 38 140 38 104 L38 50 Z";

export function LadderEmblem({
  state, position, placementPlayed, placementTotal, first = false, size = "lg", className,
}: {
  state: StandingState;
  position: number | null;
  placementPlayed: number;
  placementTotal: number;
  first?: boolean;
  size?: "lg" | "md" | "sm";
  className?: string;
}) {
  const reduced = useReducedMotion();
  const t = TONE[state];
  const gold = first && state === "RANKED";
  const dim = size === "lg" ? "h-[168px] w-[152px] sm:h-[200px] sm:w-[180px]" : size === "md" ? "h-[120px] w-[108px]" : "h-[72px] w-[64px]";
  const label = state === "UNRANKED" ? "Sin clasificar" : state === "PLACEMENT" ? "Colocación" : "Clasificado";
  const big = position !== null && position >= 1 ? `#${position}` : "—";
  const digits = big.length;
  const fontPx = size === "sm" ? (digits > 4 ? 15 : 20) : size === "md" ? (digits > 4 ? 24 : 32) : digits > 5 ? 34 : digits > 4 ? 42 : 52;

  return (
    <div className={cn("relative grid shrink-0 place-items-center", dim, className)} data-testid="ladder-emblem" data-state={state} data-first={gold || undefined}>
      <motion.svg
        viewBox="0 -16 200 220" className="absolute inset-0 h-full w-full" aria-hidden
        initial={reduced ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <defs>
          <linearGradient id="nx-emb-sheen" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(255,255,255,0.16)" />
            <stop offset="0.5" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        {gold && (
          <g fill="rgba(255,211,92,0.95)">
            <path d="M72 14 L80 -6 L90 12 Z" />
            <path d="M90 10 L100 -14 L110 10 Z" />
            <path d="M110 12 L120 -6 L128 14 Z" />
          </g>
        )}
        <path d={SHIELD} fill={t.fill} stroke={gold ? "rgba(255,211,92,0.95)" : t.stroke} strokeWidth="3"
          strokeDasharray={state === "UNRANKED" ? "7 7" : undefined} style={{ filter: `drop-shadow(0 0 18px ${gold ? "rgba(255,211,92,0.5)" : t.glow})` }} />
        <path d={SHIELD} fill="url(#nx-emb-sheen)" />
        <path d={SHIELD_IN} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="1.2" />
        {/* galones: dos chevrones de la casa bajo la cifra */}
        <path d="M70 150 L100 164 L130 150" fill="none" stroke={state === "UNRANKED" ? "rgba(255,255,255,0.18)" : gold ? "rgba(255,211,92,0.8)" : t.stroke} strokeWidth="4" strokeLinejoin="miter" />
        <path d="M78 136 L100 146 L122 136" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3" />
        {state === "PLACEMENT" && Array.from({ length: placementTotal }, (_, i) => {
          const a = (-150 + (i * 120) / Math.max(1, placementTotal - 1)) * (Math.PI / 180);
          const x = 100 + Math.cos(a) * 88, y = 108 + Math.sin(a) * 88;
          return <rect key={i} x={x - 4} y={y - 4} width="8" height="8" transform={`rotate(45 ${x} ${y})`}
            fill={i < placementPlayed ? "rgba(25,227,255,0.95)" : "rgba(255,255,255,0.14)"} />;
        })}
      </motion.svg>
      <span className="relative -mt-4 text-center">
        <span className="nx-label block !text-[10px] !text-white/60">{label}</span>
        <span className="nx-readout block leading-none text-white tabular-nums" style={{ fontSize: fontPx, textShadow: `0 0 26px ${gold ? "rgba(255,211,92,0.6)" : t.glow}` }} data-field="emblem-position">{big}</span>
      </span>
    </div>
  );
}
