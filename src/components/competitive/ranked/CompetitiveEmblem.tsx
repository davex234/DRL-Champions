"use client";

/**
 * F84 · EMBLEMA COMPETITIVO — identidad visual PROPIA de Valorosters (SVG dibujado aquí; ni iconos de otros juegos ni
 * assets externos). Cada tier tiene una FORMA distinta y la complejidad crece con el rango (marcos, detalle, brillo):
 *
 *   CANTERA  chevron sobre placa        PROMESA  rombo con chispa           TITULAR  escudo con banda
 *   VETERANO hexágono con alas          CAPITÁN  blasón con corona          ESTRELLA estrella en anillo
 *   CUMBRE   pico con rayos y doble anillo (élite, sin divisiones)
 *
 * Divisiones III → II → I: barras bajo el glifo (III = 1, II = 2, I = 3) y SIEMPRE el numeral escrito. Colocación: anillo
 * con N segmentos (los jugados encendidos). Sin clasificar: contorno discontinuo. El color nunca es la única señal: forma,
 * barras y texto identifican el rango (`aria-label` con el nombre completo).
 */
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import type { RankChip } from "@/domain/ranked/config";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("competitive");

export type EmblemState = "RANKED" | "PLACEMENT" | "UNRANKED";
export type EmblemSize = "xl" | "lg" | "md" | "sm" | "xs";

const DIM: Record<EmblemSize, string> = {
  xl: "h-[200px] w-[182px] sm:h-[232px] sm:w-[210px]",
  lg: "h-[160px] w-[146px]",
  md: "h-[112px] w-[102px]",
  sm: "h-[64px] w-[58px]",
  xs: "h-[34px] w-[31px]",
};

/** Capas de marco por tier (0..6): la complejidad sube con el rango. */
const FRAMES = [0, 1, 1, 2, 2, 3, 3];

function Glyph({ shape, color, tier }: { shape: RankChip["shape"]; color: string; tier: number }) {
  const fill = `${color}22`;
  const stroke = color;
  switch (shape) {
    case "chevron":
      return (
        <g>
          <path d="M100 36 L160 66 L160 142 L100 172 L40 142 L40 66 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
          <path d="M64 124 L100 88 L136 124" fill="none" stroke={stroke} strokeWidth="11" strokeLinecap="square" strokeLinejoin="miter" />
        </g>
      );
    case "diamond":
      return (
        <g>
          <path d="M100 28 L168 104 L100 180 L32 104 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
          <path d="M100 62 L134 104 L100 146 L66 104 Z" fill="none" stroke={stroke} strokeWidth="3" opacity="0.8" />
          <path d="M100 84 L106 98 L120 104 L106 110 L100 124 L94 110 L80 104 L94 98 Z" fill={stroke} />
        </g>
      );
    case "shield":
      return (
        <g>
          <path d="M100 28 L166 52 L166 104 C166 146 138 170 100 184 C62 170 34 146 34 104 L34 52 Z" fill={fill} stroke={stroke} strokeWidth="4" />
          <path d="M34 92 L166 92 L166 116 L34 116 Z" fill={stroke} opacity="0.85" />
          <path d="M100 44 L148 62 L148 84 L52 84 L52 62 Z" fill="none" stroke={stroke} strokeWidth="2.5" opacity="0.6" />
        </g>
      );
    case "hex":
      return (
        <g>
          <path d="M18 92 L34 76 L34 132 L18 116 Z M182 92 L166 76 L166 132 L182 116 Z" fill={stroke} opacity="0.75" />
          <path d="M100 28 L160 62 L160 146 L100 180 L40 146 L40 62 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
          <path d="M100 58 L134 78 L134 130 L100 150 L66 130 L66 78 Z" fill="none" stroke={stroke} strokeWidth="3" />
          <path d="M100 82 L114 104 L100 126 L86 104 Z" fill={stroke} />
        </g>
      );
    case "crest":
      return (
        <g>
          <path d="M58 46 L72 18 L86 40 L100 12 L114 40 L128 18 L142 46 Z" fill={stroke} />
          <path d="M100 48 L162 66 L162 108 C162 148 136 172 100 186 C64 172 38 148 38 108 L38 66 Z" fill={fill} stroke={stroke} strokeWidth="4" />
          <path d="M60 90 L140 90 L140 106 L60 106 Z" fill={stroke} opacity="0.9" />
          <path d="M78 122 L100 140 L122 122" fill="none" stroke={stroke} strokeWidth="6" />
        </g>
      );
    case "star":
      return (
        <g>
          <circle cx="100" cy="104" r="74" fill={fill} stroke={stroke} strokeWidth="4" />
          <circle cx="100" cy="104" r="62" fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.5" strokeDasharray="4 6" />
          <path d="M100 46 L114 88 L158 88 L122 114 L136 156 L100 130 L64 156 L78 114 L42 88 L86 88 Z" fill={stroke} />
        </g>
      );
    case "summit":
    default:
      return (
        <g>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * 30 - 90) * (Math.PI / 180);
            return <line key={i} x1={100 + Math.cos(a) * 70} y1={104 + Math.sin(a) * 70} x2={100 + Math.cos(a) * 92} y2={104 + Math.sin(a) * 92} stroke={stroke} strokeWidth={i % 3 === 0 ? 4 : 2} opacity={i % 3 === 0 ? 0.95 : 0.55} />;
          })}
          <circle cx="100" cy="104" r="66" fill={fill} stroke={stroke} strokeWidth="4" />
          <circle cx="100" cy="104" r="56" fill="none" stroke={stroke} strokeWidth="2" opacity="0.7" />
          <path d="M52 140 L84 82 L98 104 L112 70 L148 140 Z" fill={stroke} />
          <path d="M106 82 L112 70 L119 84 Z" fill="#fff" opacity="0.85" />
          {tier >= 6 && <path d="M70 150 L130 150" stroke={stroke} strokeWidth="4" />}
        </g>
      );
  }
}

export function CompetitiveEmblem({
  rank, state, placement, size = "lg", position = null, className, animate = true,
}: {
  rank: RankChip | null;
  state: EmblemState;
  placement?: { played: number; total: number };
  size?: EmblemSize;
  /** Puesto numerado del Top (solo si es elegible). Se escribe al lado, nunca dentro del glifo. */
  position?: number | null;
  className?: string;
  animate?: boolean;
}) {
  useLocale();
  const reduced = useReducedMotion();
  const still = reduced || !animate;
  const ranked = state === "RANKED" && rank !== null;
  const color = ranked ? rank.color : state === "PLACEMENT" ? "#19e3ff" : "rgba(255,255,255,0.35)";
  const tier = ranked ? stepTier(rank) : 0;
  const frames = ranked ? FRAMES[tier] : 0;
  const label = ranked ? t("Rango: {label}", { label: td(rank.label) }) : state === "PLACEMENT" ? t("Colocación: {v} de {v2} partidas", { v: placement?.played ?? 0, v2: placement?.total ?? 5 }) : t("Sin clasificar");
  const pips = ranked && rank.division !== null ? 4 - rank.division : 0;

  return (
    <div
      role="img" aria-label={position ? t("{label} · puesto {position}", { label: td(label), position }) : td(label)}
      className={cn("relative grid shrink-0 place-items-center", DIM[size], className)}
      data-testid="competitive-emblem" data-state={state} data-tier={ranked ? rank.tierId : undefined} data-division={ranked ? rank.division ?? "elite" : undefined}
    >
      <motion.svg
        viewBox="0 0 200 230" className="absolute inset-0 h-full w-full" aria-hidden
        initial={still ? false : { opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        style={{ filter: ranked ? `drop-shadow(0 0 ${8 + stepTier(rank) * 3}px ${rank.color}66)` : state === "PLACEMENT" ? "drop-shadow(0 0 12px rgba(25,227,255,0.35))" : undefined }}
      >
        {/* marcos exteriores: más capas cuanto más alto el tier */}
        {Array.from({ length: frames }, (_, i) => (
          <circle key={i} cx="100" cy="104" r={97 - i * 5} fill="none" stroke={color} strokeWidth={1.2} opacity={0.22 + i * 0.12} strokeDasharray={i === 0 ? "2 5" : i === 1 ? undefined : "14 6"} transform={`rotate(${i * 22} 100 104)`} />
        ))}
        {ranked && <Glyph shape={rank.shape} color={rank.color} tier={tier} />}
        {state === "PLACEMENT" && (
          <g>
            {Array.from({ length: placement?.total ?? 5 }, (_, i) => {
              const n = placement?.total ?? 5;
              const gap = 8;
              const a0 = -90 + (i * 360) / n + gap / 2, a1 = -90 + ((i + 1) * 360) / n - gap / 2;
              const r = 78, rad = (d: number) => (d * Math.PI) / 180;
              const p = (d: number) => `${100 + Math.cos(rad(d)) * r} ${104 + Math.sin(rad(d)) * r}`;
              const lit = i < (placement?.played ?? 0);
              return <path key={i} d={`M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`} fill="none" stroke={lit ? "#19e3ff" : "rgba(255,255,255,0.16)"} strokeWidth="10" strokeLinecap="butt" />;
            })}
            <path d="M100 62 L134 82 L134 126 L100 146 L66 126 L66 82 Z" fill="rgba(25,227,255,0.08)" stroke="rgba(25,227,255,0.7)" strokeWidth="3" />
          </g>
        )}
        {state === "UNRANKED" && (
          <path d="M100 30 L160 64 L160 144 L100 178 L40 144 L40 64 Z" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.32)" strokeWidth="3" strokeDasharray="8 8" />
        )}
        {/* divisiones: III = 1 barra, II = 2, I = 3 */}
        {ranked && rank.division !== null && (
          <g>
            {[0, 1, 2].map((i) => {
              const x = 70 + i * 22;
              return <polygon key={i} points={`${x + 4},198 ${x + 20},198 ${x + 16},212 ${x},212`} fill={i < pips ? rank.color : "rgba(255,255,255,0.14)"} />;
            })}
          </g>
        )}
      </motion.svg>
      {state === "PLACEMENT" && size !== "xs" && (
        <span className="relative -mt-3 text-center">
          <span className="nx-readout block leading-none text-white tabular-nums" style={{ fontSize: size === "sm" ? 13 : size === "md" ? 20 : 30 }}>{placement?.played ?? 0}/{placement?.total ?? 5}</span>
        </span>
      )}
      {state === "UNRANKED" && size !== "xs" && size !== "sm" && (
        <span className="relative -mt-3 nx-readout text-[28px] leading-none text-white/50">—</span>
      )}
    </div>
  );
}

/** Índice de tier a partir del escalón (3 escalones por tier con divisiones; la cumbre es el último). */
function stepTier(rank: RankChip): number {
  return Math.min(6, Math.floor(rank.step / 3));
}

/** Chip en línea: emblema mini + nombre escrito («Titular II») para filas y listas. */
export function RankInline({ rank, state = "RANKED", placement, className }: { rank: RankChip | null; state?: EmblemState; placement?: { played: number; total: number }; className?: string }) {
  useLocale();
  const text = state === "RANKED" && rank ? rank.label : state === "PLACEMENT" ? t("Colocación {v}/{v2}", { v: placement?.played ?? 0, v2: placement?.total ?? 5 }) : t("Sin clasificar");
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} data-testid="rank-inline" data-tier={rank?.tierId}>
      <CompetitiveEmblem rank={rank} state={state} placement={placement} size="xs" animate={false} />
      <span className="truncate font-display text-[12.5px] font-bold uppercase tracking-[0.06em]" style={{ color: state === "RANKED" && rank ? rank.color : undefined }}>{td(text)}</span>
    </span>
  );
}
