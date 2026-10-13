/**
 * BALANCE LAB (Fase 65) — laboratorio de simulación sobre el MOTOR REAL.
 *
 * Nada aquí reimplementa el combate: una partida es `startDuelMatch` + `advanceBots` (los mismos bots de
 * `opponent/bots.ts`) + `confirmTurn` → `finishMatch` → `resolveCombat`. Los mazos pasan por el validador
 * canónico (`validateDuelDeck`) y se congelan con `takeDeckSnapshot`, igual que en el servidor.
 *
 * Puro y determinista: sin reloj, sin red, sin Supabase, sin `Math.random`. Misma semilla ⇒ mismo resultado.
 * Lo único que NO es del motor son los «desempates en sombra» (`shadowDecision`): re-deciden una partida YA
 * jugada con reglas alternativas para una PROPUESTA; el juego nunca los usa.
 */
import { CardRegistry } from "@/collection/registry";
import type { CombatStatKey } from "@/domain/cards/combat";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList,
  DUEL_ROLES, DUEL_COMPOSITION, type DuelDeckCard, type DuelDeckSnapshot,
} from "@/domain/cardgame";
import { startDuelMatch, type DuelMatch, type Side } from "@/domain/cardgame/match";
import {
  createRng, nextFloat, nextInt, createController, advanceBots, createDuelBot, createRandomBot, createSmartBot,
  type DuelOpponent, type RngState,
} from "@/domain/cardgame/opponent";

export const LAB_VERSION = "balance-lab-1";
export const STATS: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];
const NOW = 0;

/* ───────────────────────────── catálogo ───────────────────────────── */

export const labRegistry = new CardRegistry();

/** Todas las cartas del catálogo resueltas como las resolvería el validador (uid = cardId). */
export function catalogCards(registry: CardRegistry = labRegistry): DuelDeckCard[] {
  const ids = [...new Set(DUEL_ROLES.flatMap((r) => registry.forRole(r).map((c) => c.id)))];
  const owned: OwnedCard[] = ids.map((id) => ({ uid: id, cardId: id, obtainedAt: NOW }));
  const resolve = makeDeckResolver(registry, ownershipFromList(owned));
  const out: DuelDeckCard[] = [];
  for (const o of owned) { const r = resolve(o.uid); if (r.ok) out.push(r.card); }
  return out.sort((a, b) => a.cardId.localeCompare(b.cardId));
}

export const combatSum = (c: Pick<DuelDeckCard, "combat">): number => c.combat.stronghold + c.combat.gamesense + c.combat.entryfrag;
export const peakStat = (c: Pick<DuelDeckCard, "combat">): number => Math.max(c.combat.stronghold, c.combat.gamesense, c.combat.entryfrag);

/**
 * Congela un mazo de `cardIds` con el validador canónico. uids sintéticos `${deckId}:${i}` (la huella usa el uid).
 * Lanza si el mazo no es legal: el laboratorio nunca juega un estado imposible.
 */
export function labSnapshot(cardIds: readonly string[], deckId: string, registry: CardRegistry = labRegistry): DuelDeckSnapshot {
  const owned: OwnedCard[] = cardIds.map((cardId, i) => ({ uid: `${deckId}:${i}`, cardId, obtainedAt: NOW }));
  const deck = createDuelDeck({ id: deckId, name: deckId, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  const snap = v.valid ? takeDeckSnapshot(deck, v, NOW) : null;
  if (!snap) throw new Error(`labSnapshot ${deckId}: mazo ilegal (${v.errors.map((e) => e.code).join(",")})`);
  return snap;
}

/** ¿Pasa el validador canónico? (para ataques de mazo inválido y tests). */
export function isLegalDeck(cardIds: readonly string[], registry: CardRegistry = labRegistry): { valid: boolean; codes: string[] } {
  const owned: OwnedCard[] = cardIds.map((cardId, i) => ({ uid: `chk:${i}`, cardId, obtainedAt: NOW }));
  const v = validateDuelDeck(createDuelDeck({ id: "chk", name: "chk", cards: owned.map((o) => o.uid), now: NOW }), makeDeckResolver(registry, ownershipFromList(owned)));
  return { valid: v.valid, codes: [...new Set(v.errors.map((e) => e.code))] };
}

/* ───────────────────────────── generadores de mazo ───────────────────────────── */

export type Pool = readonly DuelDeckCard[];
export type Score = (c: DuelDeckCard) => number;

export const byRole = (pool: Pool): Record<RoleId, DuelDeckCard[]> =>
  Object.fromEntries(DUEL_ROLES.map((r) => [r, pool.filter((c) => c.role === r)])) as Record<RoleId, DuelDeckCard[]>;

/** Mazo ALEATORIO válido: 2 por rol, jugador único. Orden de roles barajado para no favorecer a ninguno. */
export function randomDeck(rng: RngState, pool: Pool, roles = byRole(pool)): { cardIds: string[]; rng: RngState } {
  let r = rng;
  const order = [...DUEL_ROLES];
  for (let i = order.length - 1; i > 0; i--) { const j = nextInt(r, 0, i); r = j.rng; [order[i], order[j.value]] = [order[j.value], order[i]]; }
  const players = new Set<string>();
  const ids: string[] = [];
  for (const role of order) {
    for (let k = 0; k < DUEL_COMPOSITION[role]; k++) {
      const options = roles[role].filter((c) => !players.has(c.playerId));
      const p = nextInt(r, 0, options.length - 1); r = p.rng;
      const c = options[p.value];
      players.add(c.playerId); ids.push(c.cardId);
    }
  }
  return { cardIds: ids, rng: r };
}

/**
 * Mazo por PUNTUACIÓN: exacto (retroceso con poda por cota) — el mejor total de `score` con 2 por rol y jugador
 * único. `noise` > 0 muestrea de forma estable entre los mejores (variantes de una estrategia).
 */
export function scoredDeck(pool: Pool, score: Score, opts: { rng?: RngState; noise?: number; exclude?: ReadonlySet<string> } = {}): { cardIds: string[]; rng: RngState | undefined } {
  let r = opts.rng;
  const jitter = new Map<string, number>();
  if (opts.noise && r) for (const c of pool) { const f = nextFloat(r); r = f.rng; jitter.set(c.cardId, f.value * opts.noise); }
  const s = (c: DuelDeckCard) => score(c) + (jitter.get(c.cardId) ?? 0);
  const roles = byRole(pool.filter((c) => !opts.exclude?.has(c.cardId)));
  const sorted = DUEL_ROLES.map((role) => roles[role].slice().sort((a, b) => s(b) - s(a) || a.cardId.localeCompare(b.cardId)).slice(0, 12));
  const slots = DUEL_ROLES.flatMap((role, ri) => Array.from({ length: DUEL_COMPOSITION[role] }, () => ri));
  const best = { total: -Infinity, ids: [] as string[] };
  const used = new Set<string>(); const chosen: DuelDeckCard[] = [];
  const lastIdx: number[] = DUEL_ROLES.map(() => -1);
  const bound = (i: number) => { let t = 0; for (let k = i; k < slots.length; k++) t += s(sorted[slots[k]][0] ?? { combat: { stronghold: 0, gamesense: 0, entryfrag: 0 } } as DuelDeckCard); return t; };
  const dfs = (i: number, total: number) => {
    if (i === slots.length) { if (total > best.total) { best.total = total; best.ids = chosen.map((c) => c.cardId); } return; }
    if (total + bound(i) <= best.total) return;
    const ri = slots[i];
    const from = slots[i - 1] === ri ? lastIdx[ri] + 1 : 0;
    for (let j = from; j < sorted[ri].length; j++) {
      const c = sorted[ri][j];
      if (used.has(c.playerId)) continue;
      used.add(c.playerId); chosen.push(c); const prev = lastIdx[ri]; lastIdx[ri] = j;
      dfs(i + 1, total + s(c));
      used.delete(c.playerId); chosen.pop(); lastIdx[ri] = prev;
    }
  };
  dfs(0, 0);
  return { cardIds: best.ids, rng: r };
}

/** Estrategias de construcción (puntuación por carta). */
export const STRATEGIES: Record<string, Score> = {
  OVR_MAX: (c) => c.ovr,
  COMBAT_MAX: (c) => combatSum(c),
  PEAK_MAX: (c) => peakStat(c),
  BALANCED: (c) => Math.min(c.combat.stronghold, c.combat.gamesense, c.combat.entryfrag),
  SPEC_SH: (c) => c.combat.stronghold,
  SPEC_GS: (c) => c.combat.gamesense,
  SPEC_EF: (c) => c.combat.entryfrag,
  LOW_OVR: (c) => -c.ovr,
};

/**
 * Rival de PvE: MISMO algoritmo que `buildOpponentDeck` de `server/services/duels.ts` (no exportable: módulo de
 * servidor). Un test fija la huella del código fuente de aquella función para que no diverjan en silencio.
 */
export function pveOpponentDeck(targetSumOvr: number, pool: Pool): string[] {
  const byPlayerRole = new Map<RoleId, { cardId: string; ovr: number; playerId: string }[]>();
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { cardId: string; ovr: number; playerId: string }>();
    for (const c of pool) {
      if (c.role !== role) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, { cardId: c.cardId, ovr: c.ovr, playerId: c.playerId });
    }
    byPlayerRole.set(role, [...best.values()].sort((a, b) => b.ovr - a.ovr || a.cardId.localeCompare(b.cardId)));
  }
  const perRoleTarget = targetSumOvr / DUEL_ROLES.length / 2;
  const used = new Set<string>(); const ids: string[] = [];
  for (const role of DUEL_ROLES) {
    const arr = (byPlayerRole.get(role) ?? []).filter((c) => !used.has(c.playerId));
    let bestStart = 0, bestDist = Infinity;
    for (let i = 0; i + 1 < arr.length; i++) {
      const d = Math.abs((arr[i].ovr + arr[i + 1].ovr) / 2 - perRoleTarget);
      if (d < bestDist) { bestDist = d; bestStart = i; }
    }
    ids.push(arr[bestStart].cardId, arr[bestStart + 1].cardId);
    used.add(arr[bestStart].playerId); used.add(arr[bestStart + 1].playerId);
  }
  return ids;
}

/* ───────────────────────────── políticas (bots reales) ───────────────────────────── */

export type Policy = "RANDOM" | "EASY" | "NORMAL" | "HARD" | "SMART" | "ORACLE";
export const POLICIES: Policy[] = ["RANDOM", "EASY", "NORMAL", "HARD", "SMART", "ORACLE"];

/** RANDOM=EASY por construcción (createDuelBot con tasa 0 es el aleatorio); SMART=heurística 100 %; ORACLE=ve el mazo rival (offline). */
export function policyBot(p: Policy, id: string): DuelOpponent {
  switch (p) {
    case "RANDOM": return createRandomBot(id);
    case "SMART": return createSmartBot(id, "NORMAL", false);
    case "ORACLE": return createSmartBot(id, "HARD", true);
    default: return createDuelBot(id, p);
  }
}

/* ───────────────────────────── partida ───────────────────────────── */

export interface LabEncounter { attacker: Side; stat: CombatStatKey; atkValue: number; defValue: number; outcome: "A" | "B" | "TIE"; aUid: string; bUid: string }
export interface LabMatch {
  seed: number; first: Side;
  winner: Side | null; draw: boolean;
  rawA: number; rawB: number; ties: number;
  scoreA: number; scoreB: number;
  decidedBy: string;
  sumOvrA: number; sumOvrB: number; statTotalA: number; statTotalB: number;
  combatSumA: number; combatSumB: number;
  integrityOk: boolean;
  encounters: LabEncounter[];
}

/** Juega una partida completa con el motor real. `seed` fija las dos semillas de los bots (seed, seed^0x9e3779b9). */
export function playMatch(a: DuelDeckSnapshot, b: DuelDeckSnapshot, pa: Policy, pb: Policy, first: Side, seed: number): LabMatch {
  const start = startDuelMatch({ id: `lab-${seed}`, snapshotA: a, snapshotB: b, firstAttacker: first });
  if (!start.ok) throw new Error(`playMatch: no arranca (${start.error.code})`);
  const ctrl = createController({ side: "A", kind: "BOT", id: "a" }, { side: "B", kind: "BOT", id: "b" });
  const r = advanceBots(start.match, ctrl, { A: policyBot(pa, "a"), B: policyBot(pb, "b") }, createRng(seed), createRng((seed ^ 0x9e3779b9) >>> 0), 200);
  if (r.error) throw new Error(`playMatch: ${r.error.code}`);
  return summarize(r.match, seed, first);
}

export function summarize(m: DuelMatch, seed: number, first: Side): LabMatch {
  const res = m.result;
  if (!res) throw new Error(`partida sin resultado (status ${m.status})`);
  const c = res.combat;
  const encounters: LabEncounter[] = m.turns.map((t, i) => {
    const e = c.encounters[i];
    const atkIsA = t.attacker === "A";
    return {
      attacker: t.attacker, stat: t.attackerStat,
      atkValue: atkIsA ? e.a.value : e.b.value, defValue: atkIsA ? e.b.value : e.a.value,
      outcome: e.outcome, aUid: e.a.uid, bUid: e.b.uid,
    };
  });
  const raw = { A: 0, B: 0, TIE: 0 };
  for (const e of c.encounters) raw[e.outcome]++;
  return {
    seed, first, winner: res.winner, draw: res.isDraw,
    rawA: raw.A, rawB: raw.B, ties: raw.TIE, scoreA: c.scoreA, scoreB: c.scoreB, decidedBy: c.decidedBy,
    sumOvrA: m.snapshotA.cards.reduce((s, x) => s + x.ovr, 0), sumOvrB: m.snapshotB.cards.reduce((s, x) => s + x.ovr, 0),
    statTotalA: c.statTotalA, statTotalB: c.statTotalB,
    combatSumA: m.snapshotA.cards.reduce((s, x) => s + combatSum(x), 0), combatSumB: m.snapshotB.cards.reduce((s, x) => s + combatSum(x), 0),
    integrityOk: res.integrityOk, encounters,
  };
}

/* ───────────────────────────── desempates en sombra (solo propuesta) ───────────────────────────── */

export type ShadowRule = "CURRENT" | "NO_OVR" | "COMBAT_SUM" | "STAT_FIRST" | "TIE_TO_SECOND";
export const SHADOW_RULES: ShadowRule[] = ["CURRENT", "NO_OVR", "COMBAT_SUM", "STAT_FIRST", "TIE_TO_SECOND"];

/**
 * Ganador de una partida YA jugada bajo otra regla de desempate. Los enfrentamientos no dependen del desempate (ningún
 * bot lo mira), así que re-decidir es exacto para esta población. `CURRENT` debe coincidir con el motor (test).
 */
export function shadowDecision(m: LabMatch, rule: ShadowRule): { winner: Side | null; by: string } {
  if (m.rawA !== m.rawB) return { winner: m.rawA > m.rawB ? "A" : "B", by: "SCORE" };
  const cmp = (x: number, y: number): Side | null => (x > y ? "A" : y > x ? "B" : null);
  const steps: [string, number, number][] =
    rule === "CURRENT" ? [["OVR_TIEBREAK", m.sumOvrA, m.sumOvrB], ["STAT_MARGIN", m.statTotalA, m.statTotalB]]
    : rule === "NO_OVR" ? [["STAT_MARGIN", m.statTotalA, m.statTotalB]]
    : rule === "COMBAT_SUM" ? [["COMBAT_SUM", m.combatSumA, m.combatSumB], ["STAT_MARGIN", m.statTotalA, m.statTotalB]]
    : rule === "STAT_FIRST" ? [["STAT_MARGIN", m.statTotalA, m.statTotalB], ["OVR_TIEBREAK", m.sumOvrA, m.sumOvrB]]
    // Empate a puntos → gana quien atacó SEGUNDO (compensación exploratoria de la asimetría de posición, al revés).
    : [["SECOND_ATTACKER", m.first === "A" ? 0 : 1, m.first === "A" ? 1 : 0]];
  for (const [by, x, y] of steps) { const w = cmp(x, y); if (w) return { winner: w, by }; }
  return { winner: null, by: "DRAW" };
}

/* ───────────────────────────── estadística ───────────────────────────── */

/** Intervalo de Wilson al 95 % para una proporción. */
export function wilson(k: number, n: number, z = 1.959964): { p: number; lo: number; hi: number } {
  if (n <= 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Media y IC 95 % normal a partir de sumas (n, Σx, Σx²): lo que se puede agregar en streaming y fusionar. */
export function meanCi(n: number, sum: number, sumSq: number, z = 1.959964): { mean: number; sd: number; lo: number; hi: number; se: number } {
  if (n <= 0) return { mean: NaN, sd: NaN, lo: NaN, hi: NaN, se: NaN };
  const mean = sum / n;
  const v = n > 1 ? Math.max(0, (sumSq - n * mean * mean) / (n - 1)) : 0;
  const sd = Math.sqrt(v), se = sd / Math.sqrt(n);
  return { mean, sd, se, lo: mean - z * se, hi: mean + z * se };
}

/**
 * Contracción empírico-bayesiana (normal-normal): estima τ² entre cartas a partir de la varianza observada de las medias
 * menos el error medio, y encoge cada media hacia la media global en proporción a su ruido. Evita premiar la suerte.
 */
export function shrink(rows: { mean: number; se: number }[]): { tau2: number; grand: number; shrunk: number[] } {
  const ok = rows.filter((r) => Number.isFinite(r.mean) && Number.isFinite(r.se));
  const grand = ok.reduce((s, r) => s + r.mean, 0) / Math.max(1, ok.length);
  const varMeans = ok.reduce((s, r) => s + (r.mean - grand) ** 2, 0) / Math.max(1, ok.length - 1);
  const meanSe2 = ok.reduce((s, r) => s + r.se * r.se, 0) / Math.max(1, ok.length);
  const tau2 = Math.max(0, varMeans - meanSe2);
  const shrunk = rows.map((r) => {
    if (!Number.isFinite(r.mean) || !Number.isFinite(r.se)) return NaN;
    const w = tau2 / (tau2 + r.se * r.se || 1);
    return grand + w * (r.mean - grand);
  });
  return { tau2, grand, shrunk };
}

/** Correlación de Pearson. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length); if (n < 2) return NaN;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
  let c = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; c += dx * dy; sx += dx * dx; sy += dy * dy; }
  return c / Math.sqrt(sx * sy);
}

/* ───────────────────────────── agregación en streaming ───────────────────────────── */

/** Contador plano y fusionable: todas las métricas se derivan de sumas, así los fragmentos se unen sumando. */
export type Tally = Record<string, number>;
export const add = (t: Tally, k: string, v = 1): void => { t[k] = (t[k] ?? 0) + v; };
export function mergeTallies(into: Tally, from: Tally): Tally { for (const [k, v] of Object.entries(from)) add(into, k, v); return into; }

/** Hash estable de un texto (FNV-1a), para semillas derivadas y huellas de configuración. */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
