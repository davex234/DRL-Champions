/**
 * RESUMEN DE TEMPORADA («TU TEMPORADA») (Fase 34). PURO.
 *
 * Solo con HECHOS FECHADOS o con estado que pertenece a esa temporada:
 *
 *   · Pase       → `user_pass.state` si su `seasonId` es el de la temporada, o su entrada en `archive`.
 *   · Ranked     → `duel_pvp_rating_events.created_at` dentro de [startsAt, endsAt): partidas, V/D/E,
 *                  rating al final (último asiento de la ventana) y máximo alcanzado (máximo `new_rating`).
 *   · Logros     → `user_achievements.claimed_at` dentro de la ventana (reclamados en la temporada).
 *   · Pick'ems   → `pickem_scores.scored_at` dentro de la ventana (puntos y aciertos puntuados).
 *   · Colección  → ejemplares que CONSERVAS con `user_cards.obtained_at` dentro de la ventana. Solo si el
 *                  servidor lo marca fiable (el mercado reescribe `obtained_at`; lo vendido ya no está).
 *
 * NO existen aquí, a propósito: horas jugadas, mejor racha, carta o equipo favorito, «MVP de la
 * temporada», percentil. No hay datos persistidos que los sostengan.
 */
import type { SeasonStatus } from "./calendar";

export interface RatingEventFact { createdAt: number; result: "WIN" | "LOSS" | "DRAW"; oldRating: number; newRating: number }
export interface PickemScoreFact { scoredAt: number; points: number; correct: number; total: number }

export interface SeasonRecapFacts {
  season: { id: string; name: string; startsAtMs: number; endsAtMs: number; status: SeasonStatus };
  /** Pase de ESA temporada (estado vivo o archivado). `null` si el jugador no tiene registro de ella. */
  pass: { level: number; maxLevel: number | null; xp: number; missionsCompleted: number; claimedFree: number; claimedCompetitive: number; source: "LIVE" | "ARCHIVE" } | null;
  ratingEvents: RatingEventFact[] | null;
  achievementClaims: number[] | null;
  pickemScores: PickemScoreFact[] | null;
  /** `null` = métrica no fiable → se OMITE. */
  cardsObtainedInWindow: number | null;
}

export interface RankedRecap { games: number; wins: number; losses: number; draws: number; startRating: number | null; finalRating: number | null; highestRating: number | null }

export interface SeasonRecap {
  /** `FINAL`: temporada terminada. `SO_FAR`: en curso («hasta ahora»). `NONE`: aún no empezó. */
  kind: "FINAL" | "SO_FAR" | "NONE";
  seasonId: string;
  title: string;
  pass: SeasonRecapFacts["pass"];
  ranked: RankedRecap | null;
  achievementsClaimed: number | null;
  pickems: { scored: number; points: number; correct: number } | null;
  cardsObtained: number | null;
  /** Ninguna métrica con actividad: se enseña el resumen mínimo, sin rellenar con ceros vistosos. */
  minimal: boolean;
}

const inWindow = (t: number, s: number, e: number) => t >= s && t < e;

export function rankedRecap(events: RatingEventFact[], startsAtMs: number, endsAtMs: number): RankedRecap | null {
  const w = events.filter((x) => inWindow(x.createdAt, startsAtMs, endsAtMs)).sort((a, b) => a.createdAt - b.createdAt);
  if (w.length === 0) return { games: 0, wins: 0, losses: 0, draws: 0, startRating: null, finalRating: null, highestRating: null };
  return {
    games: w.length,
    wins: w.filter((x) => x.result === "WIN").length,
    losses: w.filter((x) => x.result === "LOSS").length,
    draws: w.filter((x) => x.result === "DRAW").length,
    startRating: w[0].oldRating,
    finalRating: w[w.length - 1].newRating,
    highestRating: Math.max(...w.map((x) => x.newRating)),
  };
}

export function buildSeasonRecap(f: SeasonRecapFacts): SeasonRecap {
  const { season } = f;
  const kind: SeasonRecap["kind"] = season.status === "ENDED" ? "FINAL" : season.status === "ACTIVE" ? "SO_FAR" : "NONE";
  const title = kind === "FINAL" ? `${season.name} completada` : kind === "SO_FAR" ? `${season.name} · hasta ahora` : season.name;
  if (kind === "NONE") {
    return { kind, seasonId: season.id, title, pass: null, ranked: null, achievementsClaimed: null, pickems: null, cardsObtained: null, minimal: true };
  }
  const ranked = f.ratingEvents ? rankedRecap(f.ratingEvents, season.startsAtMs, season.endsAtMs) : null;
  const achievementsClaimed = f.achievementClaims ? f.achievementClaims.filter((t) => inWindow(t, season.startsAtMs, season.endsAtMs)).length : null;
  const scores = f.pickemScores ? f.pickemScores.filter((p) => inWindow(p.scoredAt, season.startsAtMs, season.endsAtMs)) : null;
  const pickems = scores ? { scored: scores.length, points: scores.reduce((s, p) => s + p.points, 0), correct: scores.reduce((s, p) => s + p.correct, 0) } : null;
  const active = [
    f.pass && (f.pass.level > 0 || f.pass.xp > 0 || f.pass.missionsCompleted > 0),
    ranked && ranked.games > 0,
    (achievementsClaimed ?? 0) > 0,
    pickems && pickems.scored > 0,
    (f.cardsObtainedInWindow ?? 0) > 0,
  ].some(Boolean);
  return { kind, seasonId: season.id, title, pass: f.pass, ranked, achievementsClaimed, pickems, cardsObtained: f.cardsObtainedInWindow, minimal: !active };
}
