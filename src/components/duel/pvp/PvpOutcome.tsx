"use client";

/**
 * RESULTADO DE UN DUELO PvP (Bloque 7.5).
 *
 * Enseña cómo acabó y qué le hizo al rating. **Nada de eso se calcula aquí.**
 *
 *   quién ganó   → `snapshot.match.result.winner` comparado con `yourSide`, que dice el servidor.
 *   por qué      → `lifecycle`: FINISHED (se jugó), ABANDONED (alguien se fue), EXPIRED (se acabó
 *                  el tiempo). Son tres finales DISTINTOS y se cuentan como tales.
 *   el rating    → `outcome`, que viene de `duel_pvp_rating_events` por
 *                  `GET /api/game/duel/pvp?outcome=1`. El «+20» lo escribió la liquidación; aquí
 *                  se lee. No hay una resta en el cliente.
 *
 * Por qué el rating puede tardar un instante en aparecer: cerrar la partida y liquidar el rating
 * son dos transacciones (deuda D-RAT-3, documentada en el bloque 7.4.2). Entre una y otra pasan
 * milisegundos, así que la pantalla pide el resultado, y si el movimiento aún no está, lo vuelve
 * a pedir. No inventa un número mientras tanto: enseña que se está calculando.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { NxButton } from "@/components/ui/NxButton";
import { Plate, Stage } from "@/components/ui/Surface";
import { FeaturedCardPanel, DecisionPanel, RoundStrip } from "@/components/duel/MatchSummary";
import type { RatingEvent } from "@/domain/cardgame/rating";
import type { PvpLifecycle } from "@/domain/cardgame/pvp";
import type { DuelMatchView } from "@/lib/duel/types";
import { PrivateDuelPanel, type PrivateDuelPanelProps } from "./PrivateDuelPanel";
import { ResultStory } from "@/components/duel/experience/ResultStory";
import { MatchEndHero } from "@/components/duel/experience/MatchEndHero";
import { ratingPresentation } from "@/lib/duel/experience";
import { MatchStrategyPanel } from "../strategy/MatchStrategyPanel";
import type { RankedMovement as Movement } from "@/domain/pvpLadder/ranked";
// F84 · el cambio de RANGO (colocación, ascenso, descenso, misma división) sustituye a la ceremonia por puestos de F55.
import { RankChange } from "@/components/competitive/ranked/RankChange";
import type { RankMovement } from "@/domain/ranked/standing";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("duel");

export type PvpVerdict = "WIN" | "LOSS" | "DRAW";

/** Cómo se llama cada final. Tres causas distintas, tres textos distintos. */
const CAUSA: Record<PvpLifecycle, string | null> = {
  FINISHED: null,
  ABANDONED: "Por abandono",
  EXPIRED: "Tiempo agotado",
  CREATED: null,
  IN_TURN: null,
};

export interface PvpOutcomeProps {
  verdict: PvpVerdict;
  lifecycle: PvpLifecycle;
  view: DuelMatchView | null;
  /** Movimiento de rating del solicitante. `null` mientras la liquidación no haya llegado. */
  outcome: RatingEvent | null;
  rating: number | null;
  onAgain: () => void;
  onBack: () => void;
  /**
   * Fase 28 · la escalera tras la liquidación: posición actual (siempre, si existe) y cambio de
   * puestos SOLO si la página tomó la foto de antes. Dos lecturas del servidor; aquí no se calcula.
   */
  ladder?: { before: { position: number | null } | null; after: { position: number | null; rankedTotal: number }; positions: number | null; movement?: Movement } | null;
  /**
   * FASE 29 · DUELO PRIVADO. Si viene, esta pantalla NO enseña rating ni escalera (no existen:
   * un duelo privado no liquida nada) y ofrece las salidas sociales. Mismo veredicto, misma
   * puntuación, misma carta destacada y mismo turno a turno que el ranked.
   */
  privateDuel?: PrivateDuelPanelProps | null;
  /** Fase 42 · «qué sigue» (objetivo relacionado + siguiente acción del vestíbulo). Sin economía propia. */
  extra?: React.ReactNode;
  /** Fase 55 · nombre PÚBLICO del rival ranked (del servidor, `?matchup=`); sin él, «Rival». */
  rivalName?: string | null;
  /** Fase 55 · a dónde lleva «volver» (el centro competitivo para el ranked). */
  backLabel?: string;
  /** Fase 56 · perfil público del rival ranked (`/jugador/[id]`, del `?matchup=` del servidor). Sin él, no se ofrece. */
  rivalHref?: string | null;
  /** F84 · movimiento de rango del servidor (`?outcome=1` → `rank`), derivado del asiento. `null` mientras no hay asiento. */
  rank?: RankMovement | null;
  /**
   * F86 · CRUCE DE TORNEO (técnicamente PVP_PRIVATE). Sin rating, sin escalera, SIN revancha (el resultado es el
   * resultado): torneo, ronda y vuelta al cuadro, que el servidor ya actualizó con este resultado oficial.
   */
  cupMatch?: { name: string; roundName: string; href: string; outcome?: "ADVANCED" | "ELIMINATED" | "CHAMPION" | "REVIEW" | null; nextRoundName?: string | null } | null;
}

export function PvpOutcome({ verdict, lifecycle, view, outcome, rating, onAgain, onBack, ladder = null, privateDuel = null, extra = null, rivalName = null, backLabel = tr("Volver a Duelos"), rivalHref = null, rank = null, cupMatch = null }: PvpOutcomeProps) {
  useLocale();
  const causa = CAUSA[lifecycle];
  // Sin rating: duelo privado o cruce de torneo (F86). Los dos son PVP_PRIVATE y no liquidan nada.
  const unrated = !!privateDuel || !!cupMatch;
  const positions = ladder?.positions ?? null;
  const positionLabel = positions === null ? null
    : positions > 0 ? tr("{n, plural, one {Subes # puesto} other {Subes # puestos}}", { n: positions })
      : positions < 0 ? tr("{n, plural, one {Bajas # puesto} other {Bajas # puestos}}", { n: -positions }) : tr("Mantienes tu puesto");

  return (
    <Stage className="mx-auto w-full max-w-2xl px-4 py-6" data-testid="pvp-outcome" data-mode={cupMatch ? "CUP" : privateDuel ? "PVP_PRIVATE" : "PVP"}>
      {/*
        FASE 33 · EL FINAL NO SALTA A UNA TABLA: veredicto con impacto, marcador (final, o al cierre si fue
        abandono/tiempo) y el último turno contado. El veredicto es el que ya decidió la página con datos
        del servidor; aquí no se deduce nada.
      */}
      <MatchEndHero
        verdict={verdict}
        view={view}
        modeLabel={cupMatch ? tr("Torneo · {roundName}", { roundName: td(cupMatch.roundName) }) : privateDuel ? tr("Duelo privado · sin rating") : tr("Duelo PvP")}
        cause={causa}
        rivalName={privateDuel?.rival?.username ?? rivalName}
      />

      {/*
        FASE 55 · el resultado competitivo va PRIMERO, debajo del veredicto: rating antes → cambio → después (el
        asiento de la liquidación, del servidor) y, si la escalera se movió, la ceremonia de ascenso/descenso.
      */}
      {/* ── Rating. El número lo trae el servidor; aquí no se resta nada. ── */}
      {!unrated && (
      <Plate className="mt-3 px-4 py-4" data-testid="pvp-rating">
        <p className="nx-label text-center">{tr("Rating PvP")}</p>
        {outcome && ratingPresentation("PVP", outcome).provisional && (
          <p className="mt-1 text-center text-[11px] text-drl-gold" data-field="provisional">{td(ratingPresentation("PVP", outcome).note)}</p>
        )}
        {outcome ? (
          <RatingDelta outcome={outcome} />
        ) : (
          <p className="mt-2 text-center text-sm text-white/45" data-field="pending">
            {tr("Calculando el rating…")}
            {rating !== null && <span className="ml-2 text-white/30">{tr("(actual: {n})", { n: rating })}</span>}
          </p>
        )}
      </Plate>
      )}

      {/* F84 · RANGO: colocación X/N, rango obtenido, ascenso (ceremonia), descenso (sobrio) o misma división. */}
      {!unrated && rank && outcome && (
        <RankChange movement={rank} matchId={outcome?.matchId ?? null} positions={ladder?.positions ?? null} position={ladder?.after.position ?? null} rankedTotal={ladder?.after.rankedTotal ?? null} />
      )}

      {/* ── Cómo se decidió (solo con desempate) y la carta destacada (Fase 26). Todo del servidor. ── */}
      {view?.result && <DecisionPanel result={view.result} className="mt-3" />}
      {view && <FeaturedCardPanel history={view.history} cards={[...view.yourUsed, ...view.yourHand]} className="mt-3" />}

      {/* ── Fase 33 · la partida contada: cómo se decidió paso a paso y los diez turnos. Sin rating inventado. ── */}
      {view?.result && <ResultStory view={view} mode={unrated ? "PVP_PRIVATE" : "PVP"} className="mt-3" />}

      {/* ── Fase 43 · lectura estratégica de la partida: solo turnos ya jugados (proyección del servidor). ── */}
      {view?.result && <MatchStrategyPanel history={view.history} result={view.result} className="mt-3" />}

      {/* ── Fase 29 · duelo privado: cara a cara y salidas sociales; ni rating ni escalera. ── */}
      {privateDuel && <PrivateDuelPanel {...privateDuel} />}

      {/* ── F86 · cruce de torneo: torneo, ronda y vuelta al cuadro. Sin revancha ni rating. ── */}
      {cupMatch && (
        <Plate className="mt-3 px-4 py-4 text-center" data-testid="cup-outcome">
          <p className="nx-label">{tr("Torneo")}</p>
          <p className="mt-1 font-display text-[18px] font-black uppercase text-white">{cupMatch.name}</p>
          {cupMatch.outcome && (
            <p className="mt-2 font-display text-[16px] font-black uppercase tracking-[0.12em]" style={{ color: cupMatch.outcome === "ELIMINATED" ? "rgba(255,255,255,0.75)" : cupMatch.outcome === "REVIEW" ? "#ffce4f" : "#19e3ff" }} data-testid="cup-outcome-result" data-outcome={cupMatch.outcome}>
              {cupMatch.outcome === "ADVANCED" ? tr("✓ Has avanzado a {v}", { v: td(cupMatch.nextRoundName) ?? tr("la siguiente ronda") }) : cupMatch.outcome === "CHAMPION" ? tr("♛ ¡Campeón del torneo!") : cupMatch.outcome === "REVIEW" ? tr("Cruce en revisión: lo resuelve la organización") : tr("Quedas eliminado en {roundName}", { roundName: td(cupMatch.roundName) })}
            </p>
          )}
          <p className="mt-1 text-[13px] text-white/65">{tr("{ronda} · el cuadro ya refleja este resultado oficial. Sin revancha: el resultado es el resultado.", { ronda: td(cupMatch.roundName) })}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <NxButton variant="primary" accent="cyan" href={cupMatch.href} data-testid="cup-back">{tr("Volver al torneo")}</NxButton>
          </div>
        </Plate>
      )}

      {/* ── Escalera (Fase 28). Posición actual siempre; cambio de puestos solo con las dos fotos. ── */}
      {!unrated && ladder && (
        <Plate className="mt-3 px-4 py-4" data-testid="pvp-ladder" data-positions={positions ?? "unknown"}>
          <p className="nx-label text-center">{tr("Escalera ranked")}</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            {ladder.before?.position != null && ladder.after.position != null && ladder.before.position !== ladder.after.position ? (
              <>
                <span className="nx-readout text-[22px] text-white/45 tabular-nums">#{ladder.before.position}</span>
                <span className="text-white/30">→</span>
              </>
            ) : null}
            <span className="nx-readout text-[30px] text-white tabular-nums" data-field="position">
              {ladder.after.position != null ? `#${ladder.after.position}` : tr("Sin clasificar")}
            </span>
            {ladder.after.position != null && <span className="text-caption text-ink-muted">{tr("de {total}", { total: ladder.after.rankedTotal })}</span>}
          </div>
          {positionLabel && (
            <p className={`mt-1 text-center font-display text-[12px] font-bold uppercase tracking-[0.1em] ${positions! > 0 ? "text-drl-cyan" : positions! < 0 ? "text-drl-red" : "text-white/60"}`} data-field="delta-positions">
              {td(positionLabel)}
            </p>
          )}
          <p className="mt-1 text-center text-[11px] text-white/35">
            <Link href="/competitivo" className="nx-focus underline-offset-2 hover:underline">{tr("Ver la escalera →")}</Link>
          </p>
        </Plate>
      )}

      {/*
        Sin «Revancha»: el backend PvP no tiene acción de revancha (7.x), y ofrecerla sería
        prometer un emparejamiento que el servidor no puede garantizar. Se busca OTRO rival.
      */}
      {!unrated && (
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <NxButton variant="primary" onClick={onAgain} data-testid="ranked-again">{tr("Buscar otro rival")}</NxButton>
        <NxButton variant="ghost" onClick={onBack} data-testid="ranked-back">{td(backLabel)}</NxButton>
        {rivalHref && <NxButton variant="ghost" href={rivalHref} data-testid="rival-profile">{tr("Ver perfil del rival")}</NxButton>}
      </div>
      )}
      {extra}

      {view && (
        <p className="mt-3 text-center">
          <Link href={`/duelos/replay/${view.matchId}`} className="nx-focus nx-action inline-flex min-h-[44px] items-center" data-action="replay">{tr("Ver la partida →")}</Link>
        </p>
      )}

      {view && view.history.length > 0 && (
        <section className="mt-6" aria-label={tr("Turno a turno")}>
          <p className="nx-label mb-2">{tr("Turno a turno")}</p>
          <RoundStrip history={view.history} yours={[...view.yourUsed, ...view.yourHand]} theirs={view.rivalUsed} />
        </section>
      )}
    </Stage>
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
