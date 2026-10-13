"use client";

/**
 * EMBLEMAS DE RANGO (Fase 9.6).
 *
 * EL PROBLEMA. La escalera competitiva ya existía y era buena —nueve escalones, tres
 * divisiones, cúspide posicional (`domain/progression/rank.ts`)— pero visualmente el
 * rango era **un cuadrado con un número dentro**. En la captura `17-ranking` se ve: un
 * recuadro con un «4» y, al lado, el texto «PLATINO II». Eso no es algo que nadie quiera
 * conseguir; es una celda de tabla.
 *
 * Un rango tiene que ser un OBJETO. Se enseña, se reconoce a distancia y se desea antes
 * de saber qué cuesta.
 *
 * LA SOLUCIÓN. Un emblema geométrico por escalón, construido con las MISMAS piezas y
 * distinto reparto. Que compartan vocabulario es justo lo que los hace legibles como una
 * escalera: se ve que Diamante viene después de Platino porque tiene lo de Platino y algo
 * más, no porque sea otro dibujo.
 *
 * Las piezas, y qué cuenta cada una:
 *
 *   · NÚCLEO    — la silueta. Escudo (rangos bajos) → rombo (medios) → estrella (cúspide).
 *   · ALAS      — 0 a 3 pares de cuñas laterales. Es el «peso» del rango de un vistazo.
 *   · CORONA    — púas sobre el núcleo. Solo a partir de Maestro; arriba, tres.
 *   · RAYOS     — corona radial completa. Solo Nexus y Champion: no puede llevarla nadie más.
 *   · FACETAS   — cortes internos que aparecen con la altura y dan materia al metal.
 *   · PÍLDORAS  — las divisiones (I / II / III), bajo el núcleo. Sin ellas, el ascenso
 *                 dentro de un rango no se ve en ninguna parte.
 *
 * TRES COSAS QUE NO SE NEGOCIAN
 *
 *   1. **Original.** Polígonos propios. Ni un asset, ni un trazado calcado, ni el emblema
 *      de nadie. Coincide con VALORANT en los NOMBRES de los rangos —es el público que
 *      viene— y en nada más.
 *   2. **SIN CLASIFICAR se ve distinto, no peor.** Un jugador nuevo no lleva un emblema
 *      apagado de bronce: lleva un contorno hueco, sin relleno, que dice «todavía no».
 *      Enseñarle un rango falso es lo que la Fase 9D vino a arreglar y no se deshace aquí.
 *   3. **SVG en línea y sin bucles.** Un emblema aparece hasta veinte veces en una
 *      clasificación. Cada `<animate>` se multiplicaría por veinte. El único movimiento
 *      es el de `ascending`, que se usa UNA vez y solo cuando alguien acaba de subir.
 */
import { useId } from "react";
import { RANKS, type RankTierId } from "@/domain/progression/rank";
import { cn } from "@/lib/format";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("progression");

/** Núcleo del emblema. Tres siluetas para nueve escalones: la escalera se lee por tramos. */
type Core = "hollow" | "shield" | "rhombus" | "star";

interface EmblemSpec {
  core: Core;
  /** Pares de cuñas laterales, 0..3. */
  wings: 0 | 1 | 2 | 3;
  /** Púas sobre el núcleo, 0..3. */
  crown: 0 | 1 | 2 | 3;
  /** Corona radial completa. Reservada a la cúspide. */
  rays: boolean;
  /** Cortes internos del metal. */
  facets: boolean;
  /** Color secundario del degradado del metal. */
  shade: string;
}

/**
 * La tabla vive AQUÍ y no en el dominio: son decisiones de presentación y el dominio no
 * debe saber qué forma tiene una insignia. La clave es la misma `RankTierId`, así que
 * añadir un rango a `RANKS` y olvidarse de esto da un fallo de tipos, no un hueco mudo.
 */
const SPEC: Record<RankTierId, EmblemSpec> = {
  unranked: { core: "hollow",  wings: 0, crown: 0, rays: false, facets: false, shade: "#2a303c" },
  bronce:   { core: "shield",  wings: 0, crown: 0, rays: false, facets: false, shade: "#5c3a1e" },
  plata:    { core: "shield",  wings: 1, crown: 0, rays: false, facets: false, shade: "#5d6875" },
  oro:      { core: "shield",  wings: 2, crown: 0, rays: false, facets: true,  shade: "#7d5f14" },
  platino:  { core: "rhombus", wings: 2, crown: 0, rays: false, facets: true,  shade: "#1c5f66" },
  diamante: { core: "rhombus", wings: 3, crown: 1, rays: false, facets: true,  shade: "#3d2f7a" },
  maestro:  { core: "rhombus", wings: 3, crown: 2, rays: false, facets: true,  shade: "#6b1526" },
  elite:    { core: "star",    wings: 3, crown: 3, rays: false, facets: true,  shade: "#8a3d10" },
  nexus:    { core: "star",    wings: 3, crown: 3, rays: true,  facets: true,  shade: "#7a6a2a" },
};

/**
 * Trazados del núcleo. Lienzo de 100×100, núcleo centrado en (50, 46).
 *
 * El núcleo es DELIBERADAMENTE estrecho —ocupa poco más de la mitad del ancho—. La primera
 * versión lo llenaba casi entero y, a 44 px en el HUD del vestíbulo, las alas quedaban
 * reducidas a dos manchas de tres píxeles: el emblema se leía como un rombo de color y
 * nada más. La silueta de una insignia la hace lo que sobresale, no el centro.
 */
const CORE_PATH: Record<Core, string> = {
  // Contorno hueco: la ausencia de rango tiene su propia forma, no es un bronce apagado.
  hollow: "M50 16 L70 28 L70 56 L50 74 L30 56 L30 28 Z",
  // Escudo: base ancha, punta abajo. La forma más antigua de «esto es un rango».
  shield: "M50 14 L72 25 L72 50 Q72 66 50 78 Q28 66 28 50 L28 25 Z",
  // Rombo facetado: el salto de escudo a piedra. Aquí empieza la parte alta.
  rhombus: "M50 11 L73 46 L50 81 L27 46 Z",
  // Estrella de cuatro puntas con la vertical alargada: cúspide, y se nota.
  star: "M50 7 L59 37 L81 46 L59 55 L50 85 L41 55 L19 46 L41 37 Z",
};

export function RankEmblem({
  tierId,
  color,
  division = 0,
  divisions = 0,
  size = 64,
  champion = false,
  ascending = false,
  className,
}: {
  tierId: RankTierId;
  /** Color del rango. Viene de `RANKS`; el campeón trae el suyo. */
  color: string;
  /** División actual dentro del rango (1..divisions). 0 = el rango no se divide. */
  division?: number;
  /** Divisiones que tiene el rango. */
  divisions?: number;
  size?: number;
  /** Champion es POSICIONAL, no un escalón: se presenta con oro y corona propia. */
  champion?: boolean;
  /** Un ascenso reciente: el emblema respira una vez. No es un bucle de fondo. */
  ascending?: boolean;
  className?: string;
}) {
  useLocale();
  // `useId` da identificadores únicos por instancia: con veinte emblemas en una
  // clasificación, un `id="metal"` repetido hace que todos usen el degradado del primero.
  const uid = useId().replace(/:/g, "");
  const spec = SPEC[tierId] ?? SPEC.unranked;
  const hollow = spec.core === "hollow";

  const metal = `m${uid}`;
  const shine = `s${uid}`;
  const clip = `c${uid}`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn(ascending && "motion-safe:animate-rise-in", className)}
      role="img"
      aria-label={t("Emblema de rango {tierId}", { tierId })}
    >
      <defs>
        {/*
          Metal: claro arriba, oscuro abajo. Es lo que convierte un polígono plano en algo
          con volumen; sin él, un emblema es una mancha de color con forma bonita.
        */}
        <linearGradient id={metal} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={hollow ? 0.18 : 0.98} />
          <stop offset="52%" stopColor={color} stopOpacity={hollow ? 0.1 : 0.72} />
          <stop offset="100%" stopColor={spec.shade} stopOpacity={hollow ? 0.06 : 0.95} />
        </linearGradient>

        {/* Reflejo especular: una banda diagonal en la mitad superior del núcleo. */}
        <linearGradient id={shine} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="46%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        {/* El reflejo y las facetas se recortan contra el núcleo: nada se sale del metal. */}
        <clipPath id={clip}>
          <path d={CORE_PATH[spec.core]} />
        </clipPath>
      </defs>

      {/* ── Corona radial. Solo la cúspide. ── */}
      {(spec.rays || champion) && (
        <g opacity="0.5">
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * 30 * Math.PI) / 180;
            const r1 = 40;
            const r2 = i % 2 === 0 ? 49 : 44;
            return (
              <line
                key={i}
                x1={50 + Math.cos(a) * r1}
                y1={46 + Math.sin(a) * r1}
                x2={50 + Math.cos(a) * r2}
                y2={46 + Math.sin(a) * r2}
                stroke={champion ? "#ffd35c" : color}
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            );
          })}
        </g>
      )}

      {/*
        ── Alas ──
        Cuñas laterales simétricas; cuantas más, más pesa el rango. Salen hasta el borde
        del lienzo y llevan filo propio: son la mitad de la silueta y tienen que aguantar
        a 40 px, que es el tamaño al que más veces se ve el emblema (HUD y listas).
      */}
      {Array.from({ length: spec.wings }, (_, i) => {
        const y = 26 + i * 13;
        const reach = 24 - i * 4;
        const inner = spec.core === "shield" ? 27 : 25;
        const left = `M${inner} ${y} L${inner - reach} ${y + 6} L${inner - reach + 7} ${y + 12} L${inner} ${y + 10} Z`;
        const right = `M${100 - inner} ${y} L${100 - inner + reach} ${y + 6} L${100 - inner + reach - 7} ${y + 12} L${100 - inner} ${y + 10} Z`;
        return (
          <g key={i} fill={color} fillOpacity={0.42 + i * 0.16} stroke={color} strokeWidth="1.4" strokeLinejoin="round">
            <path d={left} />
            <path d={right} />
          </g>
        );
      })}

      {/* ── Corona de púas. Sobre el núcleo, centrada. La central siempre es la más alta. ── */}
      {spec.crown > 0 && (
        <g fill={champion ? "#ffd35c" : color} opacity="0.9">
          {(spec.crown === 1 ? [0] : spec.crown === 2 ? [-11, 11] : [-13, 0, 13]).map((dx) => {
            const tall = dx === 0;
            const h = tall ? 13 : 9;
            const base = spec.core === "star" ? 8 : 12;
            return (
              <path
                key={dx}
                d={`M${50 + dx} ${base - h} L${50 + dx + 4} ${base} L${50 + dx - 4} ${base} Z`}
              />
            );
          })}
        </g>
      )}

      {/* ── Núcleo ── */}
      <path
        d={CORE_PATH[spec.core]}
        fill={`url(#${metal})`}
        stroke={champion ? "#ffd35c" : color}
        strokeWidth={hollow ? 1.6 : 2.2}
        strokeLinejoin="round"
        strokeDasharray={hollow ? "5 4" : undefined}
      />

      <g clipPath={`url(#${clip})`}>
        {/* Reflejo. */}
        {!hollow && <rect x="0" y="0" width="100" height="100" fill={`url(#${shine})`} />}

        {/*
          Facetas. Dos cortes oscuros que rompen la superficie: sin ellos, los rangos altos
          son manchas de color grandes y planas. Van dentro del recorte para que sigan la
          silueta del núcleo sea cual sea.
        */}
        {spec.facets && (
          <g fill="#000" opacity="0.26">
            <path d="M50 6 L50 92 L20 50 Z" />
            <path d="M50 92 L92 44 L92 96 Z" />
          </g>
        )}
      </g>

      {/*
        Monograma. Solo en SIN CLASIFICAR y solo un guion: un rango que no se tiene no
        lleva número, y un «0» dentro del emblema se lee como si fuera un escalón.
      */}
      {hollow && (
        <text
          x="50"
          y="52"
          textAnchor="middle"
          fill={color}
          fontSize="26"
          fontFamily="var(--font-display)"
          fontWeight="700"
          opacity="0.8"
        >
          –
        </text>
      )}

      {/* ── Divisiones. Píldoras bajo el núcleo: la I es la de entrada (`DIVISION_I_IS_ENTRY`). ── */}
      {divisions > 0 && division > 0 && (
        <g>
          {Array.from({ length: divisions }, (_, i) => (
            <rect
              key={i}
              x={50 - (divisions * 11 - 4) / 2 + i * 11}
              y={88}
              width="7"
              height="7"
              rx="1.5"
              fill={i < division ? color : "transparent"}
              stroke={color}
              strokeWidth="1.4"
              opacity={i < division ? 1 : 0.35}
            />
          ))}
        </g>
      )}
    </svg>
  );
}

/**
 * La escalera completa, para pantallas que enseñan «a qué puedes llegar».
 *
 * Devuelve los escalones REALES —los ocho que se conquistan— dejando fuera «Sin
 * clasificar», que es un estado, no una meta. Enseñarlo en la galería de rangos sugeriría
 * que hay algo que ganar por no haber jugado.
 */
export function rankLadder() {
  return RANKS.filter((r) => r.id !== "unranked");
}
