"use client";

/**
 * FIN DE RONDA — qué ha pasado, en un vistazo.
 *
 * ────────────────────────── EL ORDEN ES EL ARREGLO ──────────────────────────
 *
 * Antes esta pantalla decía las cosas en el orden equivocado: primero el resultado, luego un
 * panel de causas, luego un briefing, y al final —después de dos bloques de análisis— el
 * botón para seguir jugando. El jugador que solo quería la siguiente ronda tenía que
 * atravesar el estudio de la anterior.
 *
 * Ahora el resultado ocupa la parte alta y la orden está anclada al pie del escenario
 * (`PrimaryAction`), así que **nunca hace falta desplazarse para seguir**. El porqué se queda
 * debajo, intacto, para quien quiera leerlo: analizar la ronda es opcional; jugar la
 * siguiente, no.
 *
 * ────────────────────────── LOS NÚMEROS QUE SE QUEDAN ──────────────────────────
 *
 * El marcador y poco más. Las bajas del destacado y los momentos de la ronda son contexto y
 * se pintan como contexto —pequeños, debajo del titular— en vez de competir con él. Lo que
 * se ha ido es la repetición: la ronda y el marcador ya están en la franja de estado, así que
 * aquí el marcador aparece UNA vez, como cierre del titular, y no tres.
 */
import { motion, useReducedMotion } from "framer-motion";
import type { RoundEndView } from "@/components/sim/useCoachMatch";
import { Stage, Plate } from "@/components/ui/Surface";
import { cn } from "@/lib/format";

export function RoundOutcome({ view }: { view: RoundEndView }) {
  const reduced = useReducedMotion();
  const { causes } = view;

  return (
    <div className="mx-auto max-w-xl space-y-3">
      {/*
        ═══ EL TITULAR ═══
        Entra una vez, con un golpe corto. No parpadea ni late: una animación permanente en
        la pantalla de resultado convierte el resultado en decoración.
      */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
      >
        <Stage tone={view.won ? "success" : "primary"} className="px-5 py-6 text-center">
          <span className="nx-label">
            Ronda {view.roundNumber}
            {view.reason ? ` · ${view.reason}` : ""}
          </span>
          <h2
            className={cn(
              "mt-1 font-display text-[clamp(30px,6vw,52px)] font-bold uppercase leading-[0.95]",
              view.won ? "text-ok" : "text-drl-glow",
            )}
          >
            {causes.headline}
          </h2>
          <p className="nx-readout mt-2 text-[28px] leading-none text-white">
            {view.score.home}
            <span className="mx-1.5 text-ink-faint">–</span>
            {view.score.away}
          </p>

          {/* Contexto: pequeño, y solo si existe. Nada de huecos rellenados. */}
          {(view.topFragger || view.moments.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {view.topFragger && (
                <span className="nx-clip-sm bg-white/6 px-2.5 py-1 text-caption text-white/70">
                  Destacado <b className="text-white">{view.topFragger.name}</b> · {view.topFragger.kills} bajas
                </span>
              )}
              {view.moments.map((m, i) => (
                <span
                  key={i}
                  className="nx-clip-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: m.hex, background: `${m.hex}18`, boxShadow: `inset 0 0 0 1px ${m.hex}55` }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          )}
        </Stage>
      </motion.div>

      {/* ═══ POR QUÉ PASÓ ═══ Debajo, y sin prisa. */}
      <Plate className="px-4 py-3.5">
        <span className="nx-label">Por qué pasó</span>
        <ul className="mt-2 space-y-1.5">
          {causes.causes.map((c, i) => (
            <li
              key={i}
              className={cn(
                "flex gap-2 border-l-2 py-1 pl-2.5 text-[13px] leading-snug",
                c.tone === "good"
                  ? "border-ok/50 text-ok/90"
                  : c.tone === "bad"
                    ? "border-drl/50 text-drl-glow/90"
                    : "border-white/15 text-ink-muted",
              )}
            >
              {c.text}
            </li>
          ))}
        </ul>
      </Plate>
    </div>
  );
}
