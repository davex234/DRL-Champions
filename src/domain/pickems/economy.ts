/**
 * F87 · ECONOMÍA DE UN PICK'EM (pura) — ¿cuánto se reparte si la gente juega así?
 *
 * Simula, sobre el GRAFO REAL de un ámbito, N torneos completos (ganadores al azar) y N jugadores que rellenan
 * su cuadro entero con una PRECISIÓN p por partido (si el ganador real está entre sus dos participantes predichos,
 * lo eligen con probabilidad p; si no, eligen al azar entre los suyos). p = 0,5 es elegir a ciegas; 0,65–0,7 es un
 * aficionado informado (los favoritos de VCT ganan ~60–70 % de las series); 0,8 es un pronosticador excelente.
 *
 * Devuelve la distribución de escalones (con la configuración de recompensas dada) y el valor esperado por
 * participante. Determinista con la semilla. Las semillas por definir se sustituyen por equipos SINTÉTICOS solo
 * dentro de la simulación (nunca se muestran ni se guardan).
 */
import { topoOrder, type FormatDescriptor, type TeamRef } from "./format";
import { predictedParticipants, scoreEntry, type RealState } from "./prediction";
import { tierFor, tierValue, type BracketRewardConfig, type CatalogLookup, type RewardTierId } from "./bracketRewards";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface SimResult {
  accuracy: number;
  runs: number;
  dist: Record<RewardTierId | "NONE", number>;
  meanRatio: number;
  perfectRate: number;
  /** Valor esperado por participante (créditos equivalentes, precio de tienda). */
  ev: number;
}

/** Torneo aleatorio completo sobre el grafo: participantes y ganador de cada partido. */
function randomReality(d: FormatDescriptor, rand: () => number, seedTeams: ReadonlyMap<string, [TeamRef | null, TeamRef | null]>): Map<string, RealState> {
  const real = new Map<string, RealState>();
  let synthetic = 0;
  const syn = (): TeamRef => ({ id: `sim-${++synthetic}`, name: `SIM ${synthetic}` });
  // Semillas: las reales si existen, sintéticas si no.
  for (const n of d.nodes) {
    const s = seedTeams.get(n.matchId);
    real.set(n.matchId, { teamA: s?.[0] ?? null, teamB: s?.[1] ?? null, winnerId: null, loserId: null, final: false, status: "upcoming", scoreA: null, scoreB: null, startTime: null });
  }
  const incoming = new Set(d.edges.map((e) => e.to));
  for (const n of d.nodes) {
    if (incoming.has(n.matchId)) continue;
    const r = real.get(n.matchId)!;
    real.set(n.matchId, { ...r, teamA: r.teamA ?? syn(), teamB: r.teamB ?? syn() });
  }
  // Partidos con un solo alimentador (p. ej. un hueco de semilla en un nodo intermedio): el otro, sintético.
  for (const id of topoOrder(d) ?? []) {
    const ctx = { descriptor: d, real };
    const pair = predictedParticipants(ctx, {}).get(id)!;
    const a = pair[0] ?? syn(), b = pair[1] ?? syn();
    const w = rand() < 0.5 ? a : b;
    real.set(id, { teamA: a, teamB: b, winnerId: w.id, loserId: w.id === a.id ? b.id : a.id, final: true, status: "finished", scoreA: null, scoreB: null, startTime: null });
  }
  return real;
}

export function simulateTiers(
  d: FormatDescriptor, cfg: BracketRewardConfig, cat: CatalogLookup, accuracy: number,
  opts: { runs?: number; seed?: number; seeds?: ReadonlyMap<string, [TeamRef | null, TeamRef | null]> } = {},
): SimResult {
  const runs = opts.runs ?? 2000;
  const rand = rng(opts.seed ?? 87);
  const dist: Record<RewardTierId | "NONE", number> = { NONE: 0, PARTICIPATION: 0, GOOD: 0, GREAT: 0, ELITE: 0, PERFECT: 0 };
  let ratioSum = 0, perfect = 0;
  const order = topoOrder(d) ?? [];
  for (let i = 0; i < runs; i++) {
    const real = randomReality(d, rand, opts.seeds ?? new Map());
    // El jugador predice SIN conocer resultados: su cuadro parte de las semillas reales.
    const blank = new Map<string, RealState>();
    const incoming = new Set(d.edges.map((e) => e.to));
    for (const n of d.nodes) {
      const r = real.get(n.matchId)!;
      blank.set(n.matchId, { ...r, winnerId: null, loserId: null, final: false, status: "upcoming", teamA: incoming.has(n.matchId) ? null : r.teamA, teamB: incoming.has(n.matchId) ? null : r.teamB });
    }
    const picks: Record<string, string> = {};
    for (const id of order) {
      const pair = predictedParticipants({ descriptor: d, real: blank }, picks).get(id)!;
      if (!pair[0] || !pair[1]) continue;
      const w = real.get(id)!.winnerId;
      const knows = (pair[0].id === w || pair[1].id === w) && rand() < accuracy;
      picks[id] = knows ? w! : (pair[0].id === w ? pair[1].id : pair[1].id === w ? pair[0].id : (rand() < 0.5 ? pair[0].id : pair[1].id));
    }
    const s = scoreEntry({ descriptor: d, real }, picks, () => true);
    ratioSum += s.ratio;
    if (s.perfect) perfect++;
    dist[tierFor(cfg, s) ?? "NONE"]++;
  }
  for (const k of Object.keys(dist) as (keyof typeof dist)[]) dist[k] = dist[k] / runs;
  const ev = cfg.tiers.reduce((s, t) => s + dist[t.id] * tierValue(t.reward, cat), 0);
  return { accuracy, runs, dist, meanRatio: ratioSum / runs, perfectRate: perfect / runs, ev };
}
