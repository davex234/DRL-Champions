/**
 * POST-RONDA — cada ronda termina con su historia: MVP, razón, qué cambió, qué decidió
 * el coach, qué cambió tácticamente y qué habilidad fue decisiva. Compone `analyze`
 * (causas verbalizadas), moments, los eventos de coach/tácticos/habilidad ya detectados y
 * el runtime táctico de la ronda. PURO. Reutiliza; no calcula combate de nuevo.
 */
import type { MatchState } from "../match";
import { analyze, type RoundState, type Cause } from "../sim";
import { detectRoundMoments, type MomentBadge } from "../lib/match/moments";
import { detectAbilityEvents } from "../abilities";
import { detectTacticalEvents } from "../tactics";
import { ns, td } from "@/i18n/runtime";

const t = ns("broadcast");

export interface PostRound {
  round: number;
  won: boolean;
  headline: string;
  mvp: { name: string; kills: number } | null;
  reason: string;
  whatChanged: string;
  brainLearned: string;
  coachDecided: string;
  tacticalChange: string;
  decisiveAbility: string | null;
  causes: Cause[];
  moments: MomentBadge[];
}

function roundMvp(round: RoundState): { name: string; kills: number } | null {
  const k: Record<string, number> = {};
  for (const e of round.events) if (e.type === "kill") { const n = String((e.data as { byName?: string }).byName ?? ""); if (n) k[n] = (k[n] ?? 0) + 1; }
  const top = Object.entries(k).sort((a, b) => b[1] - a[1])[0];
  return top ? { name: top[0], kills: top[1] } : null;
}

export function buildPostRound(match: MatchState, finished: RoundState): PostRound {
  const a = analyze(finished);
  const moments = detectRoundMoments(match, finished);
  const won = finished.winner === finished.coachSide;
  const us = finished.coachSide;
  const ours = us === "ATK" ? finished.tactical?.ATK : finished.tactical?.DEF;

  // Qué decidió el coach esta ronda (última llamada o concepto).
  const calls = finished.events.filter((e) => e.type === "coachCall");
  const lastCall = calls.length ? String((calls[calls.length - 1].data as { id?: string }).id ?? "") : null;
  const coachDecided = lastCall ? t("Orden del entrenador: {lastCall}.", { lastCall: td(lastCall) })
    : match.currentDecision ? `Plan: ${match.currentDecision.concept}.` : t("Sin intervención del entrenador.");

  // Qué cambió tácticamente.
  const tacticalChange = ours
    ? (ours.adapted
      ? t("Fase {fase} · concepto {concepto} (adaptado en caliente).", { fase: ours.phase, concepto: ours.concept })
      : t("Fase {fase} · concepto {concepto}.", { fase: ours.phase, concepto: ours.concept }))
    : t("Plan ejecutado sin adaptaciones.");

  // Qué aprendió el "cerebro" del equipo (lecturas del rival).
  const reads = ours?.reads ?? [];
  const brainLearned = reads.length ? reads[0] : (won ? t("Confirma su lectura del rival.") : t("Toca recalibrar la lectura del rival."));

  // Habilidad decisiva.
  const abEvents = detectAbilityEvents([finished]);
  const decisiveAbility = abEvents.sort((x, y) => y.magnitude - x.magnitude)[0]?.detail
    ?? abEvents[0]?.type.replace(/_/g, " ") ?? null;

  // Qué cambió (táctico de alto nivel).
  const tac = detectTacticalEvents([finished]).sort((x, y) => y.magnitude - x.magnitude)[0];
  const whatChanged = tac ? tac.detail ?? tac.type.replace(/_/g, " ") : (moments[0]?.label ?? t("Ronda de control."));

  return {
    round: match.roundNumber,
    won,
    headline: a.headline,
    mvp: roundMvp(finished),
    reason: a.causes[0]?.text ?? t("Ronda equilibrada."),
    whatChanged,
    brainLearned,
    coachDecided,
    tacticalChange,
    decisiveAbility,
    causes: a.causes,
    moments,
  };
}
