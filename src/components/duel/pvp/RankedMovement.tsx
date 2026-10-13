"use client";

/**
 * FASE 55 · ASCENSO / DESCENSO / CLASIFICADO tras una partida ranked.
 *
 * El «rango» del ranked es la escalera, así que la ceremonia cuenta el PUESTO: dos fotos del servidor (antes de
 * jugar y tras liquidar) → `rankedMovement`. ASCENSO si ganas puestos, DESCENSO si los pierdes (se dice con la
 * misma claridad, sin fiesta y sin protección que no existe), ENTRAS EN LA ESCALERA con la primera partida y
 * CLASIFICADO al cerrar las 10 de colocación. Sin foto previa (recarga a mitad) no hay ceremonia: no se afirma
 * un movimiento que no se midió.
 *
 * 2–3 s de animación; con movimiento reducido, todo aparece quieto. La palabra y el glifo van siempre escritos:
 * el color no es la única señal.
 */
import { motion, useReducedMotion } from "framer-motion";
import { positionLabel, type RankedMovement as Movement } from "@/domain/pvpLadder/ranked";

const COPY = {
  PROMOTION: { word: "Ascenso", glyph: "▲", color: "#19e3ff", rgb: "25,227,255" },
  DEMOTION: { word: "Descenso", glyph: "▼", color: "#ff5c85", rgb: "255,46,99" },
  ENTERED: { word: "Entras en la escalera", glyph: "◆", color: "#ffd35c", rgb: "255,211,92" },
  PLACED: { word: "Clasificado", glyph: "★", color: "#ffd35c", rgb: "255,211,92" },
} as const;

export function RankedMovement({ movement, rankedTotal }: { movement: Movement; rankedTotal: number | null }) {
  const reduced = useReducedMotion();
  if (!movement.ceremony) return null;
  const c = COPY[movement.ceremony];
  const t = (delay: number, duration = 0.45) => (reduced ? { duration: 0.01 } : { delay, duration, ease: [0.16, 1, 0.3, 1] as const });
  const sub = movement.ceremony === "PLACED"
    ? "Has cerrado tus 10 partidas de colocación: desde ahora cada partida mueve menos tu rating."
    : movement.ceremony === "ENTERED" ? "Tu primera partida liquidada te coloca en la clasificación global."
      : movement.ceremony === "PROMOTION" ? `Subes ${movement.positions} ${movement.positions === 1 ? "puesto" : "puestos"} en la escalera.`
        : `Bajas ${-(movement.positions ?? 0)} ${movement.positions === -1 ? "puesto" : "puestos"} en la escalera.`;

  return (
    <section
      aria-label={`${c.word}: ${positionLabel(movement.from)} a ${positionLabel(movement.to)}`}
      className="nx-clip relative mt-3 overflow-hidden border px-4 py-5 text-center"
      style={{ borderColor: `rgba(${c.rgb},0.5)`, background: `radial-gradient(90% 120% at 50% 0%, rgba(${c.rgb},0.22), rgba(0,0,0,0.35) 70%)` }}
      data-testid="ranked-movement" data-ceremony={movement.ceremony} data-kind={movement.kind}
    >
      {!reduced && movement.ceremony !== "DEMOTION" && [0, 1].map((i) => (
        <motion.span key={i} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border"
          style={{ borderColor: `rgba(${c.rgb},0.6)` }}
          initial={{ scale: 0.2, opacity: 0.9 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ delay: 0.5 + i * 0.35, duration: 1.4, ease: "easeOut" }} />
      ))}
      <motion.p className="font-display text-[clamp(28px,7vw,46px)] font-bold uppercase leading-none tracking-wide" style={{ color: c.color, textShadow: `0 0 28px rgba(${c.rgb},0.6)` }}
        initial={reduced ? false : { opacity: 0, scale: 1.6, y: movement.ceremony === "DEMOTION" ? -12 : 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={t(0.1, 0.5)}
        data-field="ceremony-word">
        <span aria-hidden className="mr-2">{c.glyph}</span>{c.word}
      </motion.p>
      <div className="mt-4 flex items-center justify-center gap-3 sm:gap-5" data-field="ceremony-positions">
        <motion.span className="flex flex-col items-center" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={t(0.6)}>
          <span className="nx-label !text-[10px]">Antes</span>
          <span className="nx-readout text-[24px] text-white/55 tabular-nums">{positionLabel(movement.from)}</span>
        </motion.span>
        <motion.span aria-hidden className="text-[22px] text-white/40" initial={reduced ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={t(0.95)}>→</motion.span>
        <motion.span className="flex flex-col items-center" initial={reduced ? false : { opacity: 0, scale: 1.4 }} animate={{ opacity: 1, scale: 1 }} transition={t(1.25)}>
          <span className="nx-label !text-[10px]">Ahora</span>
          <span className="nx-readout text-[38px] leading-none text-white tabular-nums" style={{ textShadow: `0 0 22px rgba(${c.rgb},0.55)` }}>{positionLabel(movement.to)}</span>
        </motion.span>
      </div>
      {rankedTotal !== null && movement.to !== null && <p className="mt-1 text-[11.5px] text-white/45">de {rankedTotal} en la clasificación global</p>}
      <motion.p className="mt-2 text-[13px] text-white/75" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={t(1.7)}>{sub}</motion.p>
    </section>
  );
}
