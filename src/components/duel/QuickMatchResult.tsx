"use client";

/**
 * RESULTADO DE PARTIDA RÁPIDA — la pantalla final mínima.
 *
 * Solo: el veredicto (VICTORIA · DERROTA · EMPATE), el marcador final, el motivo que ya redactó el resolver
 * (`result.reason`), las RECOMPENSAS que el servidor concedió por esta partida (DUEL GAMEPLAY UX 2.0: el recibo del
 * libro mayor, `result.rewards`; si no hubo ninguna, no hay bloque) y dos salidas: SEGUIR JUGANDO (otra partida rápida
 * por el flujo canónico de la página) y VOLVER AL MENÚ PRINCIPAL (`/`). Nada de progreso, objetivos, logros, temporada
 * ni misiones: el servidor los procesó igual al terminar la partida; aquí simplemente no se enseñan.
 *
 * Misma identidad que el resultado completo (`ResultScreen`): tonos, sonido, corona solo en victoria, barrido una vez, y
 * todo respeta `prefers-reduced-motion`. Centrado en el estadio, sin paneles debajo.
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotionConfig } from "framer-motion";
import { playCue, playSound } from "@/lib/sound";
import { stingDuck } from "@/lib/audio/musicEngine";
import { useMusicOverride } from "@/components/audio/MusicDirector";
import { NxButton } from "@/components/ui/NxButton";
import { EASE } from "@/design/motion";
import { trackExperience } from "@/lib/duel/experienceTelemetry";
import { buzz } from "@/lib/haptics";
import { MAIN_MENU_HREF } from "@/lib/duel/quickResult";
import type { DuelMatchView } from "@/lib/duel/types";
import { TONE } from "./ResultScreen";
import { RewardDisplay } from "@/components/rewards/RewardDisplay";
import { DailyRewardSlot } from "./DailyRewardSlot";

export function QuickMatchResult({ view, onContinue }: {
  view: DuelMatchView;
  /** SEGUIR JUGANDO: otra partida rápida (la página la crea por su camino canónico, con su propio cerrojo). */
  onContinue: () => void;
}) {
  // La arena monta `MotionConfig reducedMotion="user"`: esto es la preferencia del sistema (y se puede fijar en pruebas).
  const reduced = useReducedMotionConfig();
  const r = view.result;
  const kind = r ? (r.isDraw ? "draw" : r.winner === "YOU" ? "win" : "loss") : null;
  /* Un clic basta: el botón se bloquea al pulsarlo (y la página tiene además su cerrojo `inFlight`). */
  const [starting, setStarting] = useState(false);

  useMusicOverride(kind ? "RESULT" : null);
  useEffect(() => {
    if (!kind) return;
    stingDuck();
    playCue(kind === "win" ? "victory" : kind === "loss" ? "defeat" : "ui");
    if (kind === "draw") playSound("match.draw");
    buzz("match");
    trackExperience("match_result_view");
  }, [kind]);

  if (!r || !kind) return null;
  const tone = TONE[kind];

  return (
    <div
      className="relative mx-auto flex min-h-[calc(100svh-48px)] w-full max-w-3xl flex-col items-center justify-center px-1 py-10"
      data-scene="result" data-result="quick" data-kind={kind}
    >
      <motion.section
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.3 }}
        className="relative w-full overflow-hidden px-5 py-12 text-center sm:px-10 sm:py-16"
        style={{
          background: `radial-gradient(72% 92% at 50% 0%, rgba(${tone.rgb},0.32), transparent 68%), radial-gradient(60% 60% at 50% 100%, rgba(3,4,10,0.55), transparent 80%)`,
          boxShadow: `inset 0 -1px 0 rgba(${tone.rgb},0.55), 0 1px 28px -6px rgba(${tone.rgb},0.6)`,
        }}
        aria-labelledby="quick-result-title"
      >
        {tone.rays && !reduced && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[130vmin] w-[130vmin] -translate-x-1/2 -translate-y-1/2 opacity-[0.18]"
            style={{ background: `conic-gradient(from 0deg, transparent 0deg, rgb(${tone.rgb}) 5deg, transparent 11deg, transparent 28deg, rgb(${tone.rgb}) 34deg, transparent 40deg)` }}
            initial={{ rotate: -14, scale: 0.85, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 0.18 }}
            transition={{ duration: 1.1, ease: EASE.out }}
          />
        )}
        {kind !== "loss" && !reduced && <span aria-hidden className="nx-result-sweep" style={{ ["--sweep-rgb" as string]: tone.rgb }} />}

        <motion.h1
          id="quick-result-title"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.35 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduced ? 0 : 0.6, ease: EASE.out, delay: reduced ? 0 : 0.05 }}
          className={`font-display text-[clamp(52px,14vw,112px)] font-bold uppercase leading-none tracking-[0.02em] ${tone.cls}`}
          style={{ textShadow: `0 0 52px rgba(${tone.rgb},0.55)` }}
          data-testid="quick-result-verdict"
        >
          {tone.title}
        </motion.h1>

        <div
          className="nx-readout mt-6 flex items-center justify-center gap-5 text-[clamp(56px,15vw,112px)] leading-none sm:gap-7"
          aria-label={`Marcador final: tú ${r.scoreYou}, rival ${r.scoreRival}`}
          data-testid="quick-result-score"
        >
          <span className="text-[#2fe0ff]" style={{ textShadow: "0 0 30px rgba(47,224,255,0.55)" }}>{r.scoreYou}</span>
          <span aria-hidden className="text-white/20">–</span>
          <span className="text-drl" style={{ textShadow: "0 0 30px rgba(255,46,99,0.55)" }}>{r.scoreRival}</span>
        </div>

        {r.reason && <p className="mx-auto mt-6 max-w-xl text-[15px] text-white/70 sm:text-base" data-testid="quick-result-reason">{r.reason}</p>}

        {/*
          DUEL GAMEPLAY UX 2.0 · RECOMPENSAS OBTENIDAS. Exactamente lo que el servidor CONCEDIÓ (recibo del libro mayor,
          `result.rewards`): nada calculado aquí. Sin concesiones (o sin lectura) → no hay bloque. Volver a esta pantalla
          (F5, enlace) solo vuelve a LEER el recibo.
        */}
        {r.rewards && r.rewards.grants.length > 0 && (
          <motion.div
            data-testid="quick-result-rewards"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduced ? 0 : 0.4, duration: reduced ? 0 : 0.3, ease: EASE.out }}
            className="mx-auto mt-8 max-w-xl"
          >
            <p className="font-display text-[11px] font-bold uppercase tracking-[0.24em] text-white/55">Recompensas obtenidas</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              {r.rewards.grants.map((g, i) => (
                <RewardDisplay key={`${g.source}:${i}`} reward={g.reward} points={g.points || undefined} size="md" className="justify-center" />
              ))}
            </div>
          </motion.div>
        )}
        {/* CORE GAME LOOP · el cupo diario que ocupó esta partida (o el tope): sin él, la partida 21 no decía nada. */}
        <DailyRewardSlot receipt={r.rewards} className="mt-4" />
      </motion.section>

      <motion.div
        data-testid="result-actions"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduced ? 0 : 0.55, duration: reduced ? 0 : 0.25, ease: EASE.out }}
        className="mt-8 flex w-full max-w-xl flex-col gap-3 sm:flex-row"
      >
        <NxButton
          variant="primary" size="lg" className="flex-1 !text-[17px]" data-cta="primary" data-action="continue"
          disabled={starting}
          onClick={() => { if (starting) return; setStarting(true); trackExperience("rematch_click"); onContinue(); }}
        >
          {starting ? "Preparando…" : "Seguir jugando"}
        </NxButton>
        <NxButton variant="secondary" size="lg" className="flex-1" href={MAIN_MENU_HREF} data-action="menu">
          Volver al menú principal
        </NxButton>
      </motion.div>
    </div>
  );
}
