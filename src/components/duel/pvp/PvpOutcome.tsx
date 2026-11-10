"use client";

/**
 * RESULTADO DE UN DUELO PvP (Bloque 7.5) — adaptador de la pantalla única de resultados (`result/DuelResult`).
 *
 * Ranked, duelo privado (con su REVANCHA) y cruce de torneo terminan en la MISMA pantalla que el resto de duelos:
 * veredicto, marcador, una línea de recompensas y tres acciones. El modo solo cambia los datos:
 *
 *   · ranked   → la línea enseña el RATING (asiento de `duel_pvp_rating_events` vía `?outcome=1`; mientras la
 *                liquidación no llega, «…», nunca un número inventado). JUGAR OTRA = buscar otro rival.
 *   · privado  → sin rating (no liquida nada). La acción principal es REVANCHA: un reto nuevo que el rival acepta.
 *   · torneo   → sin rating y sin revancha (el resultado es el resultado): VOLVER AL TORNEO, y una nota de una línea
 *                con lo que el cuadro ya registró (avanzas, eliminado, campeón, en revisión).
 *
 * Quién ganó lo decide la página con datos del servidor (`verdict`); por qué (abandono, tiempo) llega en `lifecycle`.
 * El marcador es el final o, si la partida se cerró a medias, el del último turno guardado (`matchEndPresentation`).
 *
 * Ya no se pintan aquí la escalera, la ceremonia de rango, el cara a cara, la carta destacada ni el turno a turno: el
 * servidor los sigue liquidando igual y viven en Competitivo, el perfil y la repetición. Las props `ladder`, `rank`,
 * `extra`, `rivalName`, `rivalHref` y `backLabel` se aceptan por compatibilidad y no pintan nada.
 */
import type { RatingEvent } from "@/domain/cardgame/rating";
import type { PvpLifecycle } from "@/domain/cardgame/pvp";
import type { DuelMatchView } from "@/lib/duel/types";
import type { PrivateDuelPanelProps } from "./PrivateDuelPanel";
import { motion, useReducedMotion } from "framer-motion";
import { DuelResult, type DuelResultAction } from "@/components/duel/result/DuelResult";
import { matchEndPresentation } from "@/lib/duel/experience";
import { MAIN_MENU_HREF } from "@/lib/duel/quickResult";
import type { RankedMovement as Movement } from "@/domain/pvpLadder/ranked";
import type { RankMovement } from "@/domain/ranked/standing";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("duel");

export type PvpVerdict = "WIN" | "LOSS" | "DRAW";

const KIND = { WIN: "win", LOSS: "loss", DRAW: "draw" } as const;

export interface PvpOutcomeProps {
  verdict: PvpVerdict;
  lifecycle: PvpLifecycle;
  view: DuelMatchView | null;
  /** Movimiento de rating del solicitante. `null` mientras la liquidación no haya llegado. */
  outcome: RatingEvent | null;
  /** @deprecated El rating actual ya no se pinta; el movimiento sí (`outcome`). */
  rating?: number | null;
  /** JUGAR OTRA (ranked): buscar otro rival. */
  onAgain: () => void;
  /** VOLVER AL LOBBY: el lobby del modo (Competitivo para ranked, Duelos para el privado). */
  onBack: () => void;
  /** @deprecated Ya no se pinta en el resultado (vive en Competitivo). */
  ladder?: { before: { position: number | null } | null; after: { position: number | null; rankedTotal: number }; positions: number | null; movement?: Movement } | null;
  /** FASE 29 · DUELO PRIVADO: sin rating; la acción principal es la REVANCHA (`onRematch`). */
  privateDuel?: PrivateDuelPanelProps | null;
  /** @deprecated Ya no se pinta en el resultado. */
  extra?: React.ReactNode;
  /** @deprecated Ya no se pinta en el resultado. */
  rivalName?: string | null;
  /** @deprecated El destino de VOLVER AL LOBBY lo decide `onBack`; el rótulo es el común. */
  backLabel?: string;
  /** @deprecated Ya no se pinta en el resultado. */
  rivalHref?: string | null;
  /** @deprecated Ya no se pinta en el resultado (vive en Competitivo). */
  rank?: RankMovement | null;
  /**
   * F86 · CRUCE DE TORNEO (técnicamente PVP_PRIVATE). Sin rating, SIN revancha: VOLVER AL TORNEO, que el servidor ya
   * actualizó con este resultado oficial.
   */
  cupMatch?: { name: string; roundName: string; href: string; outcome?: "ADVANCED" | "ELIMINATED" | "CHAMPION" | "REVIEW" | null; nextRoundName?: string | null } | null;
}

export function PvpOutcome({ verdict, lifecycle, view, outcome, onAgain, onBack, privateDuel = null, cupMatch = null }: PvpOutcomeProps) {
  useLocale();
  const mode = cupMatch ? "CUP" : privateDuel ? "PVP_PRIVATE" : "PVP";
  const p = matchEndPresentation({ verdict, view });

  /* Una nota de una línea solo cuando hace falta para entender el resultado. */
  const cause = lifecycle === "ABANDONED" ? tr("Por abandono") : lifecycle === "EXPIRED" ? tr("Tiempo agotado") : null;
  const cupNote = !cupMatch ? null
    : !cupMatch.outcome ? tr("Torneo · {roundName}", { roundName: td(cupMatch.roundName) })
    : cupMatch.outcome === "ADVANCED" ? tr("✓ Has avanzado a {v}", { v: td(cupMatch.nextRoundName) ?? tr("la siguiente ronda") })
      : cupMatch.outcome === "CHAMPION" ? tr("♛ ¡Campeón del torneo!")
        : cupMatch.outcome === "REVIEW" ? tr("Cruce en revisión: lo resuelve la organización")
          : tr("Quedas eliminado en {roundName}", { roundName: td(cupMatch.roundName) });

  const primary: DuelResultAction = cupMatch
    ? { label: tr("Volver al torneo"), href: cupMatch.href, testId: "cup-back" }
    : privateDuel
      ? { label: tr("Revancha"), onClick: privateDuel.onRematch, disabled: !!privateDuel.busy || !privateDuel.rival, testId: "private-rematch" }
      : { label: tr("Jugar otra"), onClick: onAgain, once: true, testId: "ranked-again" };
  const lobby: DuelResultAction = cupMatch
    ? { label: tr("Volver al lobby"), href: MAIN_MENU_HREF }
    : { label: tr("Volver al lobby"), onClick: onBack, testId: "ranked-back" };

  return (
    <div data-testid="pvp-outcome" data-mode={mode} className="w-full px-4">
      <DuelResult
        mode={mode}
        kind={KIND[verdict]}
        score={p.score ? { you: p.score.you, rival: p.score.rival } : null}
        rating={mode === "PVP" ? (outcome ? { pending: false, delta: outcome.delta } : { pending: true }) : null}
        note={cupNote ?? cause}
        primary={primary}
        replayHref={view ? `/duelos/replay/${view.matchId}` : null}
        lobby={lobby}
      />
    </div>
  );
}

/**
 * Fase 44 · RATING ANTES → DESPUÉS con protagonismo (nivel 3): el valor anterior real aparece, la flecha avanza, el
 * nuevo real entra con impacto y el delta se asienta. Nunca hay cifras intermedias: solo los dos valores del asiento de
 * liquidación. Movimiento reducido: todo aparece a la vez, quieto.
 */
export function RatingDelta({ outcome }: { outcome: RatingEvent }) {
  useLocale();
  const reduced = useReducedMotion();
  const t = (delay: number) => (reduced ? { duration: 0.12 } : { delay, duration: 0.32, ease: [0.16, 1, 0.3, 1] as const });
  const tone = outcome.delta > 0 ? "border-drl-cyan/50 text-drl-cyan" : outcome.delta < 0 ? "border-drl-red/50 text-drl-red" : "border-white/20 text-white/70";
  return (
    <div className="mt-2 flex items-end justify-center gap-3 sm:gap-5" data-motion-level="3" data-testid="rating-delta">
      <motion.span className="flex flex-col items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(0.1)}>
        <span className="nx-label !text-[10px]">{tr("Antes")}</span>
        <span className="nx-readout text-[22px] text-white/45 tabular-nums">{outcome.oldRating}</span>
      </motion.span>
      <motion.span aria-hidden className="pb-1.5 text-white/30" initial={reduced ? { opacity: 0 } : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={t(0.35)}>→</motion.span>
      <motion.span className="flex flex-col items-center" initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.35 }} animate={{ opacity: 1, scale: 1 }} transition={t(0.55)}>
        <span className="nx-label !text-[10px]">{tr("Después")}</span>
        <span className="nx-readout text-[34px] text-white tabular-nums" data-field="newRating">
          {outcome.newRating}
        </span>
      </motion.span>
      {/* El delta es el del asiento de liquidación, tal cual: +N, −N o 0 (sin «+0»). */}
      <motion.span
        className={`nx-clip-sm nx-readout mb-1 border px-2 py-0.5 text-[20px] tabular-nums ${tone}`}
        data-field="delta"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={t(0.8)}
      >
        {outcome.delta > 0 ? "+" : ""}{outcome.delta}
      </motion.span>
    </div>
  );
}
