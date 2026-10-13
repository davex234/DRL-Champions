/**
 * COMPETITIVO 4.0 — PRESENTACIÓN PURA DEL RANKED (Fase 55).
 *
 * Todo lo que el centro competitivo (`/competitivo`), la búsqueda, el «rival encontrado» y el resultado
 * necesitan DECIDIR sobre datos que ya calculó el servidor. No hay aquí ni una fórmula de rating: el
 * rating, el delta y la posición llegan hechos (`duel_pvp_settle_match`, `duel_pvp_rating_events`,
 * recuento de escalera). Este módulo solo los ORDENA para contarlos.
 *
 * ─────────────────────────── EL RANGO RANKED ES LA ESCALERA ───────────────────────────
 *
 * El competitivo PvP no tiene tiers (Fase 28, contrato «sin tiers inventados»): es rating Elo +
 * escalera ordenada. Así que «rango anterior → actual → siguiente» es, literalmente, el puesto de
 * detrás, el tuyo y el de delante, con sus ratings reales y los puntos que faltan para superar al de
 * delante. «Ascenso» es ganar puestos; «descenso», perderlos; «clasificado», cerrar las 10 partidas de
 * colocación (K 40 → 24). Nada de Oro II: los rangos por PUNTOS (`domain/progression/rank.ts`) son otra
 * escalera (Pick'ems + duelos contra el bot) y no se mezclan con el rating.
 *
 * Sin React, sin red, sin reloj implícito.
 */
import { PLACEMENT_GAMES, INITIAL_RATING } from "@/domain/cardgame/rating";
import type { RatingResult } from "@/domain/cardgame/rating";
import { rankedRecap } from "@/domain/season/recap";

/* ───────────────────────────── entradas mínimas ───────────────────────────── */

export interface StandingSelf {
  rating: number;
  gamesPlayed: number;
  position: number | null;
  rankedTotal: number;
  pointsToAbove: number | null;
}

export interface StandingEntry { position: number; rating: number; username: string; isSelf: boolean }

/* ───────────────────────────── escalera: dónde estoy ───────────────────────────── */

export type StandingState = "UNRANKED" | "PLACEMENT" | "RANKED";

export interface LadderNeighbor { position: number; rating: number; username: string }

export interface LadderStanding {
  state: StandingState;
  position: number | null;
  rankedTotal: number;
  rating: number;
  /** El puesto de delante (el «siguiente rango»). `null` si eres el #1 o no hay dato. */
  above: (LadderNeighbor & { gap: number }) | null;
  /** El puesto de detrás (el «rango anterior»). `null` si eres el último o no hay dato. */
  below: (LadderNeighbor & { lead: number }) | null;
  /** Avance entre el de detrás y el de delante, 0..1. Solo con los dos vecinos; si no, `null`. */
  progress: number | null;
  placement: { played: number; total: number; remaining: number };
  isFirst: boolean;
}

/**
 * Vecinos reales a partir de las filas que el servidor ya mandó (top + alrededor). Si un vecino no
 * vino en la ventana, NO se inventa: queda `null` y el hueco se cuenta con `pointsToAbove`.
 */
export function ladderStanding(self: StandingSelf, rows: readonly StandingEntry[]): LadderStanding {
  const played = Math.max(0, Math.min(PLACEMENT_GAMES, self.gamesPlayed));
  const placement = { played, total: PLACEMENT_GAMES, remaining: PLACEMENT_GAMES - played };
  const state: StandingState = self.gamesPlayed <= 0 || self.position === null ? "UNRANKED"
    : self.gamesPlayed < PLACEMENT_GAMES ? "PLACEMENT" : "RANKED";
  const base = { state, position: self.position, rankedTotal: self.rankedTotal, rating: self.rating, placement, isFirst: self.position === 1 };
  if (self.position === null) return { ...base, above: null, below: null, progress: null };

  const byPos = new Map<number, StandingEntry>();
  for (const r of rows) if (!r.isSelf) byPos.set(r.position, r);
  const a = byPos.get(self.position - 1) ?? null;
  const b = byPos.get(self.position + 1) ?? null;
  // El hueco con el de delante: el del servidor (`pointsToAbove`) manda; si falta, el de la fila.
  const gap = self.pointsToAbove ?? (a ? Math.max(0, a.rating - self.rating + 1) : null);
  const above = a && gap !== null ? { position: a.position, rating: a.rating, username: a.username, gap } : null;
  const below = b ? { position: b.position, rating: b.rating, username: b.username, lead: Math.max(0, self.rating - b.rating) } : null;
  let progress: number | null = null;
  if (above && below) {
    const span = above.rating + 1 - below.rating;
    progress = span > 0 ? clamp01((self.rating - below.rating) / span) : 0;
  }
  return { ...base, above, below, progress };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** Etiqueta del puesto. Nunca «#0». */
export function positionLabel(position: number | null): string {
  return position !== null && position >= 1 ? `#${position}` : "Sin clasificar";
}

/* ───────────────────────────── movimiento tras una partida ───────────────────────────── */

export interface LadderPhoto { rating: number; position: number | null; gamesPlayed?: number }

export type MovementKind = "PROMOTION" | "DEMOTION" | "HOLD" | "ENTERED" | "UNKNOWN";

export interface RankedMovement {
  kind: MovementKind;
  from: number | null;
  to: number | null;
  /** Puestos ganados (+) o perdidos (−). `null` sin foto previa. */
  positions: number | null;
  /** Se cerraron en ESTA partida las 10 de colocación (de provisional a clasificado). */
  placementDone: boolean;
  /** Merece ceremonia (ascenso, entrada en la escalera o fin de colocación). El descenso se dice, sin fiesta. */
  ceremony: "PROMOTION" | "DEMOTION" | "ENTERED" | "PLACED" | null;
}

/**
 * Qué le hizo la partida a tu puesto, con DOS fotos del servidor (antes de jugar y tras liquidar).
 * Sin foto previa (recargaste a mitad de partida) no se afirma ningún movimiento: `UNKNOWN`.
 */
export function rankedMovement(before: LadderPhoto | null, after: LadderPhoto): RankedMovement {
  const to = after.position;
  if (!before) return { kind: "UNKNOWN", from: null, to, positions: null, placementDone: false, ceremony: null };
  const from = before.position;
  const placementDone = before.gamesPlayed !== undefined && after.gamesPlayed !== undefined
    && before.gamesPlayed < PLACEMENT_GAMES && after.gamesPlayed >= PLACEMENT_GAMES;
  if (from === null && to !== null) return { kind: "ENTERED", from, to, positions: null, placementDone, ceremony: placementDone ? "PLACED" : "ENTERED" };
  if (from === null || to === null) return { kind: "UNKNOWN", from, to, positions: null, placementDone, ceremony: null };
  const positions = from - to;
  const kind: MovementKind = positions > 0 ? "PROMOTION" : positions < 0 ? "DEMOTION" : "HOLD";
  const ceremony = placementDone ? "PLACED" : kind === "PROMOTION" ? "PROMOTION" : kind === "DEMOTION" ? "DEMOTION" : null;
  return { kind, from, to, positions, placementDone, ceremony };
}

/** Texto del movimiento: con palabras, nunca solo con color. */
export function movementLabel(m: RankedMovement): string | null {
  switch (m.kind) {
    case "PROMOTION": return `Subes ${m.positions} ${m.positions === 1 ? "puesto" : "puestos"}`;
    case "DEMOTION": return `Bajas ${-(m.positions ?? 0)} ${m.positions === -1 ? "puesto" : "puestos"}`;
    case "HOLD": return "Mantienes tu puesto";
    case "ENTERED": return "Entras en la escalera";
    default: return null;
  }
}

/* ───────────────────────────── mazo y acceso ───────────────────────────── */

export interface ReadinessDeck {
  id: string;
  name: string;
  valid: boolean;
  errors: readonly { message: string }[];
  missingByRole?: Partial<Record<string, number>>;
  cards: readonly unknown[];
}

export type RankedGate =
  | { kind: "SIGN_IN" }
  | { kind: "RESUME"; matchId: string }
  | { kind: "NO_DECKS" }
  | { kind: "INVALID_DECK"; deck: ReadinessDeck; issues: string[] }
  | { kind: "READY"; deck: ReadinessDeck };

/**
 * ¿Se puede jugar ranked AHORA? El backend exige exactamente esto y nada más (inspeccionado en Fase 55):
 * cuenta (Bearer), un mazo legal y propio (`resolveDeckSnapshot` + `duel_pvp_enqueue`) y no tener otra
 * partida PvP viva (`ACTIVE_MATCH`). NO hay requisito de puntos ni de rango para entrar en la cola:
 * los 400 puntos (Oro) abren el CARRIL COMPETITIVO DEL PASE, que es otra cosa (`rewardsLane`).
 *
 * Mazo propuesto, igual que la antesala PvP: el elegido si es legal → el activo si es legal → el
 * primero legal. Si no hay ninguno legal, se explica el primero (el activo si existe) con los mensajes
 * que ya calculó el validador canónico en el servidor: aquí no se reimplementa ni una regla.
 */
export function rankedGate(input: { signedIn: boolean; decks: readonly ReadinessDeck[]; activeDeckId: string | null; chosenId?: string | null; activeMatchId?: string | null }): RankedGate {
  if (!input.signedIn) return { kind: "SIGN_IN" };
  if (input.activeMatchId) return { kind: "RESUME", matchId: input.activeMatchId };
  const { decks } = input;
  if (decks.length === 0) return { kind: "NO_DECKS" };
  const legal = (id: string | null | undefined) => (id ? decks.find((d) => d.id === id && d.valid) ?? null : null);
  const ready = legal(input.chosenId) ?? legal(input.activeDeckId) ?? decks.find((d) => d.valid) ?? null;
  if (ready) return { kind: "READY", deck: ready };
  const explain = decks.find((d) => d.id === input.activeDeckId) ?? decks[0];
  return { kind: "INVALID_DECK", deck: explain, issues: deckIssues(explain) };
}

/** Qué le falta a un mazo, en frases del validador del servidor (sin duplicados, acotado). */
export function deckIssues(deck: ReadinessDeck): string[] {
  const out = [...new Set(deck.errors.map((e) => e.message).filter(Boolean))];
  if (out.length === 0) out.push("Este mazo no es legal todavía: revísalo en el editor.");
  return out.slice(0, 4);
}

/** Enlace directo al editor de ESE mazo (el constructor abre `?deck=`). */
export const editDeckHref = (deckId: string | null): string =>
  deckId ? `/duelos/mazos?deck=${encodeURIComponent(deckId)}` : "/duelos/mazos?nuevo=1";

/** Enlace de JUGAR: la arena PvP con el mazo elegido; la arena entra en cola al llegar. */
export const rankedPlayHref = (deckId: string): string => `/duelos/pvp?buscar=${encodeURIComponent(deckId)}`;

/* ───────────────────────────── recompensas: el carril del pase ───────────────────────────── */

export interface RewardsLane { unlocked: boolean; points: number; minPoints: number; remaining: number; progress: number }

/** Carril competitivo del pase: se abre con los puntos de rango (Oro), NO con el rating ranked. */
export function rewardsLane(r: { unlocked: boolean; points: number; minPoints: number }): RewardsLane {
  const min = Math.max(0, r.minPoints);
  const pts = Math.max(0, r.points);
  return {
    unlocked: r.unlocked, points: pts, minPoints: min,
    remaining: r.unlocked ? 0 : Math.max(0, min - pts),
    progress: r.unlocked || min === 0 ? 1 : clamp01(pts / min),
  };
}

/* ───────────────────────────── temporada ───────────────────────────── */

export interface SeasonRatingEvent { createdAt: number; delta: number; newRating: number; oldRating: number; result: RatingResult }

export interface SeasonRecord {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winrate: number | null;
  /** Suma de los deltas liquidados dentro de la ventana de la temporada. */
  net: number;
  /** Mejor rating ALCANZADO en la temporada (máximo `new_rating` de sus asientos). */
  best: number | null;
  /** Rating con el que empezó la temporada: el `old_rating` de su primer asiento. */
  start: number | null;
  /** La lectura se cortó en el tope: las cifras son de las últimas N partidas, y se dice. */
  truncated: boolean;
}

/**
 * Récord de LA TEMPORADA a partir de los asientos reales de `duel_pvp_rating_events` dentro de su
 * ventana `[startsAt, endsAt)`. NO es lógica nueva: delega en `rankedRecap` (`domain/season/recap`), la
 * MISMA función con la que `/temporada` cuenta su tramo ranked, así que las dos pantallas no pueden
 * discrepar. El rating NO se reinicia por temporada (no hay cierre implementado): esto es solo el tramo
 * de la temporada leído del libro, nunca un rating paralelo.
 */
export function seasonRecord(events: readonly SeasonRatingEvent[], window: { startsAtMs: number; endsAtMs: number }, truncated = false): SeasonRecord {
  const r = rankedRecap(events.map((e) => ({ createdAt: e.createdAt, result: e.result, oldRating: e.oldRating, newRating: e.newRating })), window.startsAtMs, window.endsAtMs)
    ?? { games: 0, wins: 0, losses: 0, draws: 0, startRating: null, finalRating: null, highestRating: null };
  return {
    matches: r.games, wins: r.wins, losses: r.losses, draws: r.draws,
    winrate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : null,
    // Los asientos encadenan (old de uno = new del anterior): neto = final − inicio = suma de deltas.
    net: r.startRating !== null && r.finalRating !== null ? r.finalRating - r.startRating : 0,
    best: r.highestRating, start: r.startRating,
    truncated,
  };
}

/* ───────────────────────────── clasificación paginada ───────────────────────────── */

export const LADDER_PAGE = 25;
export const LADDER_PAGE_MAX = 50;

/** Página acotada de la escalera. `offset` 0-based; nunca negativa ni más allá del total. */
export function ladderPage(offset: unknown, total: number, size: unknown = LADDER_PAGE): { offset: number; size: number; hasPrev: boolean; hasNext: boolean; pageOf: (position: number) => number } {
  const s = clampInt(size, LADDER_PAGE, 1, LADDER_PAGE_MAX);
  const maxOffset = Math.max(0, Math.floor(Math.max(0, total - 1) / s) * s);
  const o = Math.min(maxOffset, clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER));
  const aligned = Math.floor(o / s) * s;
  return { offset: aligned, size: s, hasPrev: aligned > 0, hasNext: aligned + s < total, pageOf: (position: number) => Math.floor(Math.max(0, position - 1) / s) * s };
}

function clampInt(n: unknown, def: number, min: number, max: number): number {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() !== "" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

/* ───────────────────────────── rival ───────────────────────────── */

export interface MatchupSide { username: string; avatar: string; rating: number; gamesPlayed: number; position: number | null }

/** Diferencia de rating contada desde tu lado («+34 sobre ti», «−12»). Solo cifras del servidor. */
export function matchupEdge(you: MatchupSide, rival: MatchupSide): { diff: number; label: string } {
  const diff = rival.rating - you.rating;
  const label = diff === 0 ? "Mismo rating" : diff > 0 ? `Rival +${diff} de rating` : `Tú +${-diff} de rating`;
  return { diff, label };
}

/** El rival es SIEMPRE una persona: la cola ranked no tiene bots (inspeccionado: `duel_pvp_claim_pair`). */
export const RANKED_RIVAL_KIND = "HUMAN" as const;

export { PLACEMENT_GAMES, INITIAL_RATING };
