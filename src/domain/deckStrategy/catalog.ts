/**
 * FASE 43 · PERFIL DEL CATÁLOGO Y CALIBRACIÓN DE EQUIPOS LEGALES (PURO).
 *
 *   · Percentiles de CARTA: rango percentil de OVR / Stronghold / Gamesense / Entryfrag de una carta frente a TODAS
 *     las definiciones del catálogo de su misma calibración (`dataVersion`). Se DERIVAN del catálogo recibido (nada
 *     fijado a mano): si cambia el catálogo, cambian.
 *   · Calibración de EQUIPO: una muestra DETERMINISTA (semilla fija) de equipos legales sintéticos construidos con el
 *     catálogo real (2 jugadores distintos por rol, una definición al azar de cada jugador, una sola calibración).
 *     De ella salen las distribuciones de medias de equipo y de dispersión de OVR con las que se dicen «alto»,
 *     «medio», «bajo», la orientación y la forma. `scripts/deck-strategy-lab.ts simulate` repite el cálculo con
 *     1.000.000 de equipos y comprueba que esta muestra lo representa.
 *
 * Solo entran estadísticas que ya existen en la carta. Rareza, serial, equipo, región y edición no se leen.
 */
import type { CombatStatKey, CombatStats } from "@/domain/cards/combat";
import type { RoleId } from "@/domain/cards/types";
import { DUEL_COMPOSITION, DUEL_ROLES } from "@/domain/cardgame/types";
import { makeRng } from "@/sim/rng";
import { summarize } from "./stats";

export type Axis = CombatStatKey;
export type Metric = "ovr" | Axis;
export const AXES: readonly Axis[] = ["stronghold", "gamesense", "entryfrag"];
export const METRICS: readonly Metric[] = ["ovr", "stronghold", "gamesense", "entryfrag"];

export const METRIC_LABEL: Record<Metric, string> = { ovr: "OVR", stronghold: "Stronghold", gamesense: "Gamesense", entryfrag: "Entryfrag" };
export const METRIC_ABBR: Record<Metric, string> = { ovr: "OVR", stronghold: "SH", gamesense: "GS", entryfrag: "EF" };

/** Lo único que la capa estratégica lee de una definición del catálogo. */
export interface CatalogCard {
  cardId: string;
  playerId: string;
  role: RoleId;
  ovr: number;
  combat: CombatStats;
  dataVersion: string;
}

export const metricOf = (c: { ovr: number; combat: CombatStats }, m: Metric): number => (m === "ovr" ? c.ovr : c.combat[m]);

/** Huella barata y estable del catálogo (tamaño + suma ponderada de valores), para memoizar. */
export function catalogSignature(cards: readonly CatalogCard[]): string {
  let h = 0;
  for (const c of cards) h = (h * 31 + c.ovr * 7 + c.combat.stronghold * 3 + c.combat.gamesense * 5 + c.combat.entryfrag * 11) % 2147483647;
  const versions = [...new Set(cards.map((c) => c.dataVersion))].sort().join("+");
  return `${versions}:${cards.length}:${h}`;
}

export interface CatalogProfile {
  signature: string;
  /** Calibración de referencia: la más numerosa del catálogo. */
  dataVersion: string;
  size: number;
  /** Valores ordenados (ascendente) por calibración y métrica. */
  sorted: Record<string, Record<Metric, number[]>>;
}

export function buildCatalogProfile(cards: readonly CatalogCard[]): CatalogProfile {
  const byVersion = new Map<string, CatalogCard[]>();
  for (const c of cards) byVersion.set(c.dataVersion, [...(byVersion.get(c.dataVersion) ?? []), c]);
  const sorted: CatalogProfile["sorted"] = {};
  let main = ""; let mainSize = -1;
  for (const [v, list] of [...byVersion.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sorted[v] = Object.fromEntries(METRICS.map((m) => [m, list.map((c) => metricOf(c, m)).sort((a, b) => a - b)])) as Record<Metric, number[]>;
    if (list.length > mainSize) { main = v; mainSize = list.length; }
  }
  return { signature: catalogSignature(cards), dataVersion: main, size: cards.length, sorted };
}

/* ───────────────────────────── calibración de equipos ───────────────────────────── */

export const CALIBRATION_SAMPLE = 20_000;
export const CALIBRATION_SEED = 43_043;

export interface DeckCalibration {
  signature: string;
  dataVersion: string;
  sample: number;
  seed: number;
  /** Medias de equipo ordenadas por métrica. */
  sorted: Record<Metric, number[]>;
  /** Media y desviación de la distribución de medias de equipo (unidad de la orientación). */
  mean: Record<Metric, number>;
  sd: Record<Metric, number>;
  /** Desviación típica del OVR de las 10 cartas de cada equipo, ordenada (forma: consistente / polarizado). */
  ovrDispersion: number[];
}

type RolePlayers = Record<RoleId, CatalogCard[][]>;

/** Jugadores de cada rol (cada uno con sus definiciones), en orden estable. */
export function rolePlayers(cards: readonly CatalogCard[], dataVersion: string): RolePlayers {
  const out = Object.fromEntries(DUEL_ROLES.map((r) => [r, [] as CatalogCard[][]])) as RolePlayers;
  const byPlayer = new Map<string, CatalogCard[]>();
  for (const c of cards) if (c.dataVersion === dataVersion) byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c]);
  for (const [, list] of [...byPlayer.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => a.cardId.localeCompare(b.cardId));
    // El rol es de la CARTA (catálogo diseñado, 2026-09-21): un jugador puede tener cartas de varios
    // roles. Entra en cada rol con SUS cartas de ese rol, nunca con las de otro.
    for (const role of DUEL_ROLES) {
      const ofRole = list.filter((c) => c.role === role);
      if (ofRole.length > 0) out[role].push(ofRole);
    }
  }
  return out;
}

/**
 * Un equipo legal sintético: por rol, 2 JUGADORES distintos elegidos uniformemente; de cada jugador, una de sus
 * definiciones uniformemente. Legal por construcción (composición, jugador único, carta única, una calibración).
 */
export function sampleLegalDeck(players: RolePlayers, next: () => number): CatalogCard[] {
  const deck: CatalogCard[] = [];
  // Jugador único en TODO el equipo: con roles de carta, un jugador puede estar en dos listas.
  const usados = new Set<string>();
  for (const role of DUEL_ROLES) {
    const list = players[role];
    const need = DUEL_COMPOSITION[role];
    const picked = new Set<number>();
    for (let guard = 0; picked.size < need && guard < 10_000; guard++) {
      const i = Math.floor(next() * list.length);
      if (!usados.has(list[i][0].playerId)) picked.add(i);
    }
    for (const i of [...picked].sort((a, b) => a - b)) {
      const variants = list[i];
      usados.add(variants[0].playerId);
      deck.push(variants[Math.floor(next() * variants.length)]);
    }
  }
  return deck;
}

export function canSampleLegalDecks(players: RolePlayers): boolean {
  return DUEL_ROLES.every((r) => players[r].length >= DUEL_COMPOSITION[r]);
}

export interface DeckAggregate { ovr: number; stronghold: number; gamesense: number; entryfrag: number; ovrSd: number }

export function aggregateDeck(deck: readonly { ovr: number; combat: CombatStats }[]): DeckAggregate {
  const n = deck.length || 1;
  let o = 0; let s = 0; let g = 0; let e = 0;
  for (const c of deck) { o += c.ovr; s += c.combat.stronghold; g += c.combat.gamesense; e += c.combat.entryfrag; }
  return { ovr: o / n, stronghold: s / n, gamesense: g / n, entryfrag: e / n, ovrSd: summarize(deck.map((c) => c.ovr)).sd };
}

export function buildDeckCalibration(cards: readonly CatalogCard[], sample = CALIBRATION_SAMPLE, seed = CALIBRATION_SEED): DeckCalibration {
  const profile = buildCatalogProfile(cards);
  const players = rolePlayers(cards, profile.dataVersion);
  const values: Record<Metric, number[]> = { ovr: [], stronghold: [], gamesense: [], entryfrag: [] };
  const disp: number[] = [];
  if (canSampleLegalDecks(players)) {
    const rng = makeRng(seed);
    for (let i = 0; i < sample; i++) {
      const a = aggregateDeck(sampleLegalDeck(players, rng.next));
      for (const m of METRICS) values[m].push(a[m]);
      disp.push(a.ovrSd);
    }
  }
  const mean = {} as Record<Metric, number>;
  const sd = {} as Record<Metric, number>;
  for (const m of METRICS) {
    const s = summarize(values[m]);
    mean[m] = s.mean; sd[m] = s.sd;
    values[m].sort((a, b) => a - b);
  }
  disp.sort((a, b) => a - b);
  return { signature: profile.signature, dataVersion: profile.dataVersion, sample: values.ovr.length, seed, sorted: values, mean, sd, ovrDispersion: disp };
}

/* ───────────────────────────── contexto memoizado ───────────────────────────── */

export interface StrategyContext {
  catalog: CatalogProfile;
  calibration: DeckCalibration;
}

let memo: { signature: string; ctx: StrategyContext } | null = null;

/** Perfil + calibración del catálogo recibido; se recalcula solo si el catálogo cambia. */
export function strategyContextFor(cards: readonly CatalogCard[]): StrategyContext {
  const signature = catalogSignature(cards);
  if (memo && memo.signature === signature) return memo.ctx;
  const ctx = { catalog: buildCatalogProfile(cards), calibration: buildDeckCalibration(cards) };
  memo = { signature, ctx };
  return ctx;
}
