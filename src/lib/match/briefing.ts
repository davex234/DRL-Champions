/**
 * BRIEFING ENTRE RONDAS — la sala de análisis, no solo "comprar".
 *
 * Tras cada ronda compone: resumen, qué salió bien/mal, qué aprendimos del rival, qué
 * cambió el entrenador, qué esperará el rival y qué recomienda la IA — todo alimentando
 * la siguiente decisión táctica. Reutiliza `analyze` (Sim), el scouting (Tactical) y la
 * decisión persistida (Coach). PURO: solo compone lo que ya producen los motores.
 */
import type { MatchState } from "@/match";
import { analyze, type RoundState } from "@/sim";
import type { CoachConcept, CoachCommandId } from "@/coach";
import { scout, type ScoutReport } from "./scouting";

export interface BriefingOption { kind: "concept" | "command"; id: CoachConcept | CoachCommandId; label: string }

export interface RoundBriefing {
  headline: string;
  summary: string;
  wentWell: string[];
  wentWrong: string[];
  learned: string[];
  changed: string[];
  rivalExpects: string[];
  aiRecommends: { concept: CoachConcept; reasons: string[] };
  /** Lo que el entrenador PUEDE hacer la próxima ronda (alimenta al Director). */
  canDo: BriefingOption[];
}

/** Recomendación ligera de concepto a partir del scouting + inercia. */
function recommend(match: MatchState, s: ScoutReport): { concept: CoachConcept; reasons: string[] } {
  const reasons: string[] = [];
  const lossStreak = match.economy?.home.lossStreak ?? 0;
  if (lossStreak >= 2 && (match.economy?.home.lastDecision?.shouldSave ?? false)) {
    reasons.push("Economía tocada: conviene salvar y reconstruir.");
    return { concept: "save", reasons };
  }
  if (s.rounds >= 2 && s.pattern.strength >= 0.66) {
    reasons.push(`El rival repite ${s.pattern.label}: una finta lo castiga.`);
    return { concept: "fake", reasons };
  }
  if (s.rounds >= 2) {
    reasons.push(`Defienden menos ${s.leastDefended.label}: ataca por ahí.`);
    return { concept: s.leastDefended.lane === "tree" ? "explode_b" : "explode_a", reasons };
  }
  reasons.push("Sin lecturas fiables aún: juega un default limpio.");
  return { concept: "default", reasons };
}

export function roundBriefing(match: MatchState, finished: RoundState): RoundBriefing {
  const a = analyze(finished);
  const homeWon = finished.winner === finished.coachSide;
  const s = scout(match);

  const wentWell = a.causes.filter((c) => c.tone === "good").map((c) => c.text);
  const wentWrong = a.causes.filter((c) => c.tone === "bad").map((c) => c.text);

  // Qué aprendimos del rival esta ronda.
  const learned: string[] = [];
  const t = finished.tactical;
  const theirs = finished.coachSide === "ATK" ? t?.DEF : t?.ATK;
  if (theirs?.reads?.length) learned.push(...theirs.reads.slice(0, 2));
  if (s.rounds >= 2 && s.predictedAttack.confidence >= 0.5) learned.push(`Tienden a atacar por ${s.predictedAttack.label}.`);
  if (s.dominantFragger) learned.push(`${s.dominantFragger} está caliente.`);

  // Qué cambió el entrenador (decisión persistida de la ronda).
  const lastEntry = match.history[match.history.length - 1];
  const changed = (lastEntry?.coach?.changes ?? []).map((c) => `Ajustamos: ${c}.`);
  if ((lastEntry?.coach?.deviated)) changed.push("El equipo improvisó sobre el plan (ADN creativo).");

  // Qué esperará el rival (nuestro último concepto + sus lecturas).
  const rivalExpects: string[] = [];
  const ourConcept = lastEntry?.coach?.concept;
  if (ourConcept) rivalExpects.push(`Nos vio jugar "${ourConcept}": esperará algo parecido.`);
  if (s.rounds >= 2) rivalExpects.push(`Reforzará ${s.predictedAttack.label} si insistimos.`);

  const aiRecommends = recommend(match, s);

  const canDo: BriefingOption[] = [
    { kind: "concept", id: aiRecommends.concept, label: "Aplicar recomendación" },
    { kind: "concept", id: "fake", label: "Fintar su lectura" },
    { kind: "concept", id: s.leastDefended.lane === "tree" ? "explode_b" : "explode_a", label: `Atacar ${s.leastDefended.label}` },
    { kind: "command", id: "motivate", label: "Hablar al equipo" },
  ];

  return {
    headline: a.headline,
    summary: `${homeWon ? "Ronda ganada" : "Ronda perdida"} (${finished.endReason ?? "—"}). Marcador ${match.score.home}-${match.score.away}.`,
    wentWell: wentWell.length ? wentWell : ["Ejecución correcta en lo básico."],
    wentWrong: wentWrong.length ? wentWrong : ["Pocos errores graves."],
    learned: learned.length ? learned : ["Aún sin lecturas claras del rival."],
    changed: changed.length ? changed : ["Mantuvimos el plan."],
    rivalExpects: rivalExpects.length ? rivalExpects : ["El rival aún no tiene una lectura clara de nosotros."],
    aiRecommends,
    canDo,
  };
}
