"use client";

/**
 * EL HÉROE DEL TORNEO (Fase 24.2) — dónde estoy y qué me falta, de un vistazo.
 *
 *     ACTIVO · demo                                   TU POSICIÓN   PUNTOS   ACIERTOS
 *     VCT EMEA STAGE 2                                    #24       1.240      12
 *     PREDICCIONES  8 / 12 · 67 %  ▰▰▰▰▰▰▰▰▱▱▱▱
 *     3 PENDIENTES → ir        Siguiente cierre: FNC vs TH · en 2 h 14 min
 *
 * Presentación pura sobre datos ya resueltos:
 *   · posición ........ índice en `ranking_pickem_event` (orden del servidor) o «Sin clasificar»
 *   · puntos/aciertos . `pickem_scores` (el corrector)
 *   · progreso ........ preguntas de la vista pública × mis respuestas (contar, no puntuar)
 *   · fase ............ estado real del torneo y de sus preguntas
 */
import { Stage } from "@/components/ui/Surface";
import { Badge, StatusDot } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { NxButton } from "@/components/ui/NxButton";
import { DemoBadge } from "@/components/ui/States";
import { Countdown } from "./Countdown";
import { formatCredits, cn } from "@/lib/format";
import type { PickemQuestion, TournamentRankingRow, MyScore } from "@/lib/game/client";
import {
  progressOf, nextToLock, positionOf, PHASE_LABEL,
  type AnswerMap, type EventPhase,
} from "@/domain/pickems/progress";

const PHASE_TONE: Record<EventPhase, "key" | "info" | "muted"> = { activo: "key", proximo: "info", finalizado: "muted" };

export function PickemHero({
  name, description, isDemo, phase, eventHref,
  questions, answers, score, ranking, userId, now,
  onGoPending, onExpire, className,
  statusLabel, stageLabel, tournamentProgress, previousPosition, pointsDelta,
}: {
  name: string;
  /** 24.5 · estado real del torneo («En curso»), fase actual y progreso de partidos. */
  statusLabel?: string;
  stageLabel?: string | null;
  tournamentProgress?: { finished: number; total: number; pct: number } | null;
  /** Posición anterior en esta sesión, si el servidor cambió la actual. */
  previousPosition?: number | null;
  /** Puntos ganados en esta sesión (diferencia entre dos totales del servidor). */
  pointsDelta?: number | null;
  description?: string | null;
  isDemo?: boolean;
  phase: EventPhase;
  eventHref?: string;
  questions: PickemQuestion[];
  answers: AnswerMap;
  score: MyScore | null;
  ranking: TournamentRankingRow[];
  userId: string | null;
  now: number;
  /** Lleva al jugador a la primera predicción pendiente. */
  onGoPending?: () => void;
  onExpire?: () => void;
  className?: string;
}) {
  const p = progressOf(questions, answers, now);
  const next = nextToLock(questions, now);
  const position = positionOf(ranking, userId);
  const classified = !!score;

  return (
    <Stage tone={phase === "activo" ? "cyan" : "neutral"} grid className={cn("p-5 sm:p-6", className)} aria-label="Torneo activo">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        {/* ── Identidad del torneo ── */}
        <div className="min-w-0 flex-1 basis-[280px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PHASE_TONE[phase]} dot pulse={phase === "activo"}>{statusLabel ?? PHASE_LABEL[phase]}</Badge>
            {stageLabel && <Badge tone="muted">{stageLabel}</Badge>}
            {p.pending > 0 && <Badge tone="info" dot>{p.pending} {p.pending === 1 ? "pendiente" : "pendientes"}</Badge>}
            {isDemo && <DemoBadge />}
          </div>
          <h2 className="mt-2 font-display text-[clamp(24px,4vw,40px)] font-bold uppercase leading-none text-white">
            {name}
          </h2>
          {description && <p className="mt-1.5 max-w-[56ch] text-body text-ink-muted">{description}</p>}
          {eventHref && (
            <NxButton variant="tertiary" size="md" href={eventHref} className="mt-1.5 -ml-3">
              Ver torneo y partidos →
            </NxButton>
          )}
        </div>

        {/* ── Tu marcador ── */}
        {userId && (
          <div className="grid shrink-0 grid-cols-3 gap-x-6 gap-y-2" aria-label="Tu marcador en este torneo">
            <Readout
              size="md"
              label="Tu posición"
              value={position ? `#${position}` : classified ? "+100" : "—"}
              unit={previousPosition && position && previousPosition !== position
                ? <span data-rank-delta={position - previousPosition}>#{previousPosition} → {position < previousPosition ? "+" : "−"}{Math.abs(previousPosition - position)}</span>
                : undefined}
              tone={position ? "var(--nx-accent)" : undefined}
              aria-label={position ? `Posición ${position}${previousPosition && previousPosition !== position ? `, antes ${previousPosition}` : ""}` : classified ? "Fuera del top 100" : "Sin clasificar"}
            />
            <Readout size="md" label="Puntos" value={classified ? formatCredits(score!.points) : "—"} tone="var(--nx-gold)"
              unit={pointsDelta ? <span className="text-ok" data-points-delta={pointsDelta}>{pointsDelta > 0 ? "+" : ""}{pointsDelta}</span> : undefined} />
            <Readout size="md" label="Aciertos" value={classified ? String(score!.correct) : "—"} tone="var(--nx-ok)" />
            {!classified && (
              <span className="col-span-3 nx-label">Sin clasificar · se corrige con el primer resultado</span>
            )}
          </div>
        )}
      </div>

      {/* ── Progreso del torneo (24.5): partidos reales completados ── */}
      {tournamentProgress && tournamentProgress.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Progreso del torneo">
          <span className="nx-label">Torneo</span>
          <span className="nx-readout text-[16px] tabular-nums text-white">{tournamentProgress.finished} / {tournamentProgress.total}</span>
          <span className="nx-label">partidos completados · {tournamentProgress.pct}%</span>
          <span className="h-1 min-w-[120px] flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={tournamentProgress.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Partidos del torneo completados">
            <span className="block h-full" style={{ width: `${tournamentProgress.pct}%`, background: "var(--nx-cyan)" }} />
          </span>
        </div>
      )}

      {/* ── Progreso real ── */}
      {userId && p.total > 0 && (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="flex items-baseline gap-2">
              <span className="nx-label">Predicciones</span>
              <span className="nx-readout text-[22px] tabular-nums text-white">{p.answered} / {p.total}</span>
              <span className="nx-label">{p.pct}% completado</span>
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 nx-label">
              {p.pending > 0 && <span className="text-drl-cyan">{p.pending} pendientes</span>}
              {p.lockedUnanswered > 0 && <span className="text-warn">{p.lockedUnanswered} cerradas sin responder</span>}
              {p.inPlay > 0 && <span>{p.inPlay} en juego</span>}
              {p.resolved > 0 && <span>{p.resolved} resueltas</span>}
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={p.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${p.answered} de ${p.total} predicciones completadas`}
          >
            <span
              className="block h-full transition-[width] duration-normal motion-reduce:transition-none"
              style={{ width: `${p.pct}%`, background: "linear-gradient(90deg, var(--nx-cyan, #19e3ff), var(--nx-accent, #ff2e63))" }}
            />
          </div>
        </div>
      )}

      {/* ── Qué toca ahora ── */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        {userId && p.pending > 0 && onGoPending && (
          <NxButton variant="primary" size="md" onClick={onGoPending}>
            {p.pending === 1 ? "1 predicción pendiente →" : `${p.pending} predicciones pendientes →`}
          </NxButton>
        )}
        {next ? (
          <span className="flex min-w-0 items-center gap-2 nx-label">
            <StatusDot tone="info" pulse size={5} />
            <span className="min-w-0 truncate">Siguiente cierre: <b className="text-white">{next.prompt}</b></span>
            <Countdown to={next.locks_at} onExpire={onExpire} prefix="·" className="shrink-0" />
          </span>
        ) : p.total > 0 ? (
          <span className="nx-label">Todas las predicciones de este torneo están cerradas.</span>
        ) : null}
      </div>
    </Stage>
  );
}
