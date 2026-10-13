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
import { ns, td } from "@/i18n/runtime";

const tr = ns("match");

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
    reasons.push(tr("Economía tocada: conviene salvar y reconstruir."));
    return { concept: "save", reasons };
  }
  if (s.rounds >= 2 && s.pattern.strength >= 0.66) {
    reasons.push(tr("El rival repite {label}: una finta lo castiga.", { label: td(s.pattern.label) }));
    return { concept: "fake", reasons };
  }
  if (s.rounds >= 2) {
    reasons.push(tr("Defienden menos {label}: ataca por ahí.", { label: td(s.leastDefended.label) }));
    return { concept: s.leastDefended.lane === "tree" ? "explode_b" : "explode_a", reasons };
  }
  reasons.push(tr("Sin lecturas fiables aún: juega un default limpio."));
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
  if (s.rounds >= 2 && s.predictedAttack.confidence >= 0.5) learned.push(tr("Tienden a atacar por {label}.", { label: td(s.predictedAttack.label) }));
  if (s.dominantFragger) learned.push(tr("{dominantFragger} está caliente.", { dominantFragger: td(s.dominantFragger) }));

  // Qué cambió el entrenador (decisión persistida de la ronda).
  const lastEntry = match.history[match.history.length - 1];
  const changed = (lastEntry?.coach?.changes ?? []).map((c) => `Ajustamos: ${c}.`);
  if ((lastEntry?.coach?.deviated)) changed.push(tr("El equipo improvisó sobre el plan (ADN creativo)."));

  // Qué esperará el rival (nuestro último concepto + sus lecturas).
  const rivalExpects: string[] = [];
  const ourConcept = lastEntry?.coach?.concept;
  if (ourConcept) rivalExpects.push(tr("Nos vio jugar \"{ourConcept}\": esperará algo parecido.", { ourConcept }));
  if (s.rounds >= 2) rivalExpects.push(tr("Reforzará {label} si insistimos.", { label: td(s.predictedAttack.label) }));

  const aiRecommends = recommend(match, s);

  const canDo: BriefingOption[] = [
    { kind: "concept", id: aiRecommends.concept, label: tr("Aplicar recomendación") },
    { kind: "concept", id: "fake", label: tr("Fintar su lectura") },
    { kind: "concept", id: s.leastDefended.lane === "tree" ? "explode_b" : "explode_a", label: tr("Atacar {label}", { label: td(s.leastDefended.label) }) },
    { kind: "command", id: "motivate", label: tr("Hablar al equipo") },
  ];

  return {
    headline: a.headline,
    summary: tr("{result} ({reason}). Marcador {home}-{away}.", { result: homeWon ? tr("Ronda ganada") : tr("Ronda perdida"), reason: finished.endReason ?? "—", home: match.score.home, away: match.score.away }),
    wentWell: wentWell.length ? wentWell : [tr("Ejecución correcta en lo básico.")],
    wentWrong: wentWrong.length ? wentWrong : [tr("Pocos errores graves.")],
    learned: learned.length ? learned : [tr("Aún sin lecturas claras del rival.")],
    changed: changed.length ? changed : [tr("Mantuvimos el plan.")],
    rivalExpects: rivalExpects.length ? rivalExpects : [tr("El rival aún no tiene una lectura clara de nosotros.")],
    aiRecommends,
    canDo,
  };
}
