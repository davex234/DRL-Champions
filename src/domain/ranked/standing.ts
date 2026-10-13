/**
 * F84 · RANKED 2.0 — ESTADO COMPETITIVO (puro).
 *
 * Decide QUÉ contar a partir de datos que ya calculó el servidor: el rating canónico, el récord de la temporada
 * competitiva (`competitive_season_players`, escrito solo por la liquidación) y el asiento de cada partida
 * (`duel_pvp_rating_events` con `season_match_number`). Aquí no hay ni una fórmula de rating.
 *
 *   SIN CLASIFICAR → 0 partidas en la temporada competitiva activa.
 *   COLOCACIÓN     → 1..N-1 partidas: el rating interno se mueve, pero el rango NO se enseña (X / N).
 *   CLASIFICADO    → N partidas: rango + división derivados del rating (`deriveRank`, versión de la temporada).
 *
 * Mejor rango de la temporada = `deriveRank(peak_ranked_rating)`: el máximo rating DESDE que completó la colocación,
 * guardado por la liquidación (no se reconstruye con el rating actual, que pudo bajar). Antes de F84 no hay picos.
 *
 * Sin React, sin red, sin reloj implícito.
 */
import { deriveRank, type DerivedRank } from "./config";
import { ns, td } from "@/i18n/runtime";

const t = ns("ranked");

export interface CompetitiveTopRules {
  /** Tamaño máximo de la clasificación numerada (Top 500). */
  size: number;
  minSeasonMatches: number;
  activeDays: number;
}

export interface CompetitiveSeasonInfo {
  id: string;
  number: number;
  name: string;
  startsAt: number;
  /** `null` = abierta hasta que se programe la siguiente. */
  endsAt: number | null;
  rankConfigVersion: string;
  formulaVersion: string;
  placementGames: number;
  top: CompetitiveTopRules;
  pairCap: { matches: number; hours: number };
  /** Temporada F83 enlazada (solo calendario; XP de temporada ≠ rating). */
  gameSeasonId: string | null;
}

export interface SeasonRecordRow {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  seedRating: number;
  placementCompletedAt: number | null;
  peakRating: number;
  peakRankedRating: number | null;
  lastMatchAt: number;
}

export type CompetitiveState = "UNRANKED" | "PLACEMENT" | "RANKED";

export interface CompetitiveStanding {
  state: CompetitiveState;
  rating: number;
  placement: { played: number; total: number; remaining: number };
  /** Solo CLASIFICADO: el rango derivado del rating actual. */
  rank: DerivedRank | null;
  /** Mejor rango alcanzado en la temporada (desde la colocación). */
  peakRank: DerivedRank | null;
  peakRating: number | null;
  record: { matches: number; wins: number; losses: number; draws: number; winrate: number | null };
}

/** Estado competitivo de un jugador en la temporada activa. Sin temporada: se trata como SIN CLASIFICAR. */
export function competitiveStanding(input: { rating: number; season: Pick<CompetitiveSeasonInfo, "placementGames" | "rankConfigVersion"> | null; record: SeasonRecordRow | null }): CompetitiveStanding {
  const total = Math.max(1, input.season?.placementGames ?? 5);
  const rec = input.record;
  const played = Math.max(0, rec?.matches ?? 0);
  const state: CompetitiveState = !input.season || played <= 0 ? "UNRANKED" : played >= total ? "RANKED" : "PLACEMENT";
  const version = input.season?.rankConfigVersion;
  const decided = (rec?.wins ?? 0) + (rec?.losses ?? 0);
  return {
    state,
    rating: input.rating,
    placement: { played: Math.min(played, total), total, remaining: Math.max(0, total - played) },
    rank: state === "RANKED" ? deriveRank(input.rating, version) : null,
    peakRank: state === "RANKED" && rec?.peakRankedRating != null ? deriveRank(rec.peakRankedRating, version) : null,
    peakRating: rec?.peakRating ?? null,
    record: {
      matches: played, wins: rec?.wins ?? 0, losses: rec?.losses ?? 0, draws: rec?.draws ?? 0,
      winrate: decided > 0 ? Math.round(((rec?.wins ?? 0) / decided) * 100) : null,
    },
  };
}

/* ───────────────────────────── elegibilidad Top ───────────────────────────── */

export interface TopEligibility {
  eligible: boolean;
  /** Qué falta, en frases de producto (vacío si es elegible). */
  missing: string[];
}

/**
 * Espejo de la vista `competitive_ladder` (0065), solo para EXPLICAR qué falta: el puesto lo decide el servidor.
 *   colocación completa + ≥ `minSeasonMatches` partidas de temporada + una partida en los últimos `activeDays` días.
 */
export function topEligibility(standing: Pick<CompetitiveStanding, "state" | "record">, lastMatchAt: number | null, rules: CompetitiveTopRules, now: number): TopEligibility {
  const missing: string[] = [];
  if (standing.state !== "RANKED") missing.push(t("Completa tu colocación"));
  const left = rules.minSeasonMatches - standing.record.matches;
  if (left > 0) missing.push(t("Juega {left} {v} más esta temporada", { left, v: left === 1 ? t("partida") : t("partidas") }));
  const fresh = lastMatchAt !== null && now - lastMatchAt <= rules.activeDays * 86_400_000;
  if (standing.state === "RANKED" && !fresh) missing.push(t("Juega una partida (actividad en los últimos {activeDays} días)", { activeDays: rules.activeDays }));
  return { eligible: missing.length === 0, missing };
}

/* ───────────────────────────── movimiento tras una partida ───────────────────────────── */

export type RankMovementKind =
  /** Partida de colocación que no la cierra (1..N-1): el rango no se enseña. */
  | "PLACEMENT_PROGRESS"
  /** La N-ésima: se revela el rango. */
  | "PLACEMENT_COMPLETE"
  | "PROMOTION"
  | "DEMOTION"
  | "SAME"
  /** Partida sin temporada competitiva activa (anterior a F84 o entre temporadas): solo rating. */
  | "UNSEASONED";

export interface RankMovement {
  kind: RankMovementKind;
  oldRating: number;
  newRating: number;
  delta: number;
  /** Rango antes (solo si ya estaba clasificado antes de esta partida). */
  before: DerivedRank | null;
  /** Rango después (clasificado tras esta partida). */
  after: DerivedRank | null;
  /** Cambió de TIER (no solo de división): merece la ceremonia grande. */
  tierChange: boolean;
  /** Divisiones subidas (+) o bajadas (−). */
  steps: number;
  placement: { played: number; total: number } | null;
  /** La partida cayó bajo el tope de pareja: se jugó y contó, pero no movió rating. */
  pairCapped: boolean;
}

/**
 * Lo que UNA partida le hizo a tu rango, desde su asiento (servidor): rating viejo/nuevo, número de partida de temporada
 * y regla. Determinista y estable ante recargas: dos pestañas calculan exactamente lo mismo.
 */
export function rankMovement(ev: { oldRating: number; newRating: number; seasonMatchNumber: number | null; rule?: string | null }, season: Pick<CompetitiveSeasonInfo, "placementGames" | "rankConfigVersion"> | null): RankMovement {
  const delta = ev.newRating - ev.oldRating;
  const pairCapped = ev.rule === "PAIR_CAP";
  const base = { oldRating: ev.oldRating, newRating: ev.newRating, delta, pairCapped };
  if (!season || ev.seasonMatchNumber === null || ev.seasonMatchNumber < 1) {
    return { ...base, kind: "UNSEASONED", before: null, after: null, tierChange: false, steps: 0, placement: null };
  }
  const total = Math.max(1, season.placementGames);
  const n = ev.seasonMatchNumber;
  const v = season.rankConfigVersion;
  if (n < total) {
    return { ...base, kind: "PLACEMENT_PROGRESS", before: null, after: null, tierChange: false, steps: 0, placement: { played: n, total } };
  }
  const after = deriveRank(ev.newRating, v);
  if (n === total) {
    return { ...base, kind: "PLACEMENT_COMPLETE", before: null, after, tierChange: false, steps: 0, placement: { played: n, total } };
  }
  const before = deriveRank(ev.oldRating, v);
  const steps = after.step - before.step;
  const kind: RankMovementKind = steps > 0 ? "PROMOTION" : steps < 0 ? "DEMOTION" : "SAME";
  return { ...base, kind, before, after, tierChange: after.tierIndex !== before.tierIndex, steps, placement: null };
}

/** Frase del movimiento, con palabras (nunca solo color). */
export function rankMovementLabel(m: RankMovement): string {
  const sign = m.delta > 0 ? `+${m.delta}` : `${m.delta}`;
  switch (m.kind) {
    case "PLACEMENT_PROGRESS": return t("Colocación {played} / {total} · {sign}", { played: m.placement!.played, total: m.placement!.total, sign: td(sign) });
    case "PLACEMENT_COMPLETE": return t("Rango obtenido: {rank}", { rank: td(m.after!.label) });
    case "PROMOTION": return t("Ascenso a {rank}", { rank: td(m.after!.label) });
    case "DEMOTION": return t("Descenso a {rank}", { rank: td(m.after!.label) });
    case "SAME": return `${td(m.after!.label)} · ${sign}`;
    default: return t("Rating {sign}", { sign });
  }
}

/** Etiqueta corta del estado para chips y listas. */
export function standingLabel(s: Pick<CompetitiveStanding, "state" | "rank" | "placement">): string {
  if (s.state === "RANKED" && s.rank) return s.rank.label;
  if (s.state === "PLACEMENT") return t("Colocación {played}/{total}", { played: s.placement.played, total: s.placement.total });
  return t("Sin clasificar");
}

/** Defaults de la Temporada competitiva 1 (espejo de 0065; la BD manda). */
export const SEASON_1_DEFAULTS = { placementGames: 5, top: { size: 500, minSeasonMatches: 5, activeDays: 14 }, pairCap: { matches: 5, hours: 24 } } as const;
