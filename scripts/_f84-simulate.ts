/**
 * F84 · SIMULADOR DEL RANKED (instrumento, fuera de CI). `npx tsx scripts/_f84-simulate.ts`
 *
 * Usa la MISMA política de rating que gobierna en SQL (espejo `domain/cardgame/rating`: inicial 1000, K 40 < 10 partidas /
 * 24, suelo 0, techo 5000, redondeo de `round()`), y las fronteras `rank-v1` (`domain/ranked/config`). No toca BD.
 *
 *   A · poblaciones (10…1000) con habilidad real ~ N(0, σ) y emparejamiento por cercanía de rating → distribución de rating
 *       y de rangos, deriva de la suma (inflación/deflación) y cuántos llegan a CUMBRE.
 *   B · jugadores con winrate verdadero 40/50/55/60 % frente a la media, muestra baja (20) y alta (200) → rango final.
 *   C · colocaciones 5-0 … 0-5 desde semillas reales (1000/0 partidas, 1089/29, 885/30) → salto máximo.
 *   D · elegibilidad Top con poblaciones pequeñas (actividad reciente) → cuántos entran.
 * Salida: docs/product/qa/f84-ranked/simulation.json (+ resumen por consola).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { kFactorFor, INITIAL_RATING, MIN_RATING, MAX_RATING } from "../src/domain/cardgame/rating";
import { deriveRank, RANK_V1 } from "../src/domain/ranked/config";

/* ── PRNG determinista (mulberry32) ── */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r: () => number) { const u = Math.max(1e-12, r()); const v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const expected = (own: number, opp: number) => 1 / (1 + Math.pow(10, (opp - own) / 400));
/** Postgres `round()` sobre double: mitad lejos de cero. */
const pgRound = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));

interface P { id: number; skill: number; rating: number; games: number; wins: number; activity: number; lastRound: number }

function settle(a: P, b: P, aWins: boolean) {
  const sa = aWins ? 1 : 0;
  const ka = kFactorFor(a.games), kb = kFactorFor(b.games);
  let da = pgRound(ka * (sa - expected(a.rating, b.rating)));
  let db = pgRound(kb * ((1 - sa) - expected(b.rating, a.rating)));
  const na = Math.min(MAX_RATING, Math.max(MIN_RATING, a.rating + da));
  const nb = Math.min(MAX_RATING, Math.max(MIN_RATING, b.rating + db));
  da = na - a.rating; db = nb - b.rating;
  a.rating = na; b.rating = nb; a.games++; b.games++;
  if (aWins) a.wins++; else b.wins++;
  return da + db;
}

const pct = (xs: number[], q: number) => { const s = [...xs].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo)); };
const quantiles = (xs: number[]) => ({ n: xs.length, min: pct(xs, 0), p10: pct(xs, 0.1), p25: pct(xs, 0.25), p50: pct(xs, 0.5), p75: pct(xs, 0.75), p90: pct(xs, 0.9), p95: pct(xs, 0.95), p99: pct(xs, 0.99), max: pct(xs, 1) });
function tierShare(ratings: number[]) {
  const out: Record<string, number> = {};
  for (const t of RANK_V1.tiers) out[t.name] = 0;
  for (const r of ratings) out[deriveRank(r).tierName]++;
  for (const k of Object.keys(out)) out[k] = Math.round((out[k] / Math.max(1, ratings.length)) * 1000) / 10;
  return out;
}

/* ── A · poblaciones ──
 * Concurrencia realista: en cada «momento» solo hay una cola pequeña (k ≈ 8 jugadores, elegidos por actividad) y el
 * emparejador junta a los más cercanos DENTRO de esa cola (como `duel_pvp_claim_pair`: el rival más cercano disponible).
 * Emparejar siempre al vecino exacto de toda la población estira la escala sin límite (difusión sin fuerza de retorno):
 * no es lo que ocurre con poca gente conectada. Se corre hasta `gamesTarget` partidas de media por jugador. */
function population(n: number, sigma: number, gamesTarget: number, seed: number) {
  const r = rng(seed);
  const ps: P[] = Array.from({ length: n }, (_, id) => ({ id, skill: gauss(r) * sigma, rating: INITIAL_RATING, games: 0, wins: 0, activity: 0.15 + r() * 0.85, lastRound: -1 }));
  const totalAct = ps.reduce((s, p) => s + p.activity, 0);
  let drift = 0;
  const k = Math.min(n, 8);
  const steps = Math.ceil((gamesTarget * n) / k);
  const rounds = steps;
  for (let round = 0; round < steps; round++) {
    const picked = new Set<P>();
    while (picked.size < k) {
      let x = r() * totalAct;
      for (const p of ps) { x -= p.activity; if (x <= 0) { picked.add(p); break; } }
    }
    const queue = [...picked].sort((x, y) => x.rating - y.rating);
    for (let i = 0; i + 1 < queue.length; i += 2) {
      const a = queue[i], b = queue[i + 1];
      drift += settle(a, b, r() < expected(a.skill, b.skill));
      a.lastRound = round; b.lastRound = round;
    }
  }
  const played = ps.filter((p) => p.games > 0);
  const ratings = played.map((p) => p.rating);
  const sum = played.reduce((s, p) => s + p.rating, 0);
  const cumbre = played.filter((p) => p.rating >= 1310);
  // Correlación habilidad ↔ rating (¿el rango mide rendimiento?).
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const ms = mean(played.map((p) => p.skill)), mr = mean(ratings);
  const cov = mean(played.map((p) => (p.skill - ms) * (p.rating - mr)));
  const sd = (xs: number[], m: number) => Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  const corr = cov / (sd(played.map((p) => p.skill), ms) * sd(ratings, mr) || 1);
  return {
    n, sigma, rounds, rated: played.length, ratings: quantiles(ratings), sd: Math.round(sd(ratings, mr)), tiers: tierShare(ratings),
    zeroSum: { netDriftTotal: drift, perPlayer: Math.round((sum - played.length * INITIAL_RATING) / Math.max(1, played.length) * 100) / 100 },
    cumbre: { count: cumbre.length, minSkillWinrateVsAvg: cumbre.length ? Math.round(Math.min(...cumbre.map((p) => expected(p.skill, 0))) * 100) : null, minGames: cumbre.length ? Math.min(...cumbre.map((p) => p.games)) : null },
    skillRatingCorrelation: Math.round(corr * 100) / 100,
    gamesPerPlayer: quantiles(played.map((p) => p.games)),
    activeLastRounds: played.filter((p) => p.lastRound >= rounds - Math.ceil(rounds * 0.1)).length,
  };
}

/* ── B · winrate fijo frente a la media en una población σ=100 asentada ── */
function fixedWinrate(winrate: number, games: number, trials: number, seed: number) {
  const r = rng(seed);
  const skill = 400 * Math.log10(winrate / (1 - winrate));
  const finals: number[] = [];
  for (let t = 0; t < trials; t++) {
    const me: P = { id: -1, skill, rating: INITIAL_RATING, games: 0, wins: 0, activity: 1, lastRound: 0 };
    for (let g = 0; g < games; g++) {
      // Rival emparejado por rating (±40) cuya habilidad está en el percentil de ese rating: aproximación σ=100 → habilidad ≈ (rating-1000)·0,8.
      const oppRating = Math.max(0, me.rating + (r() - 0.5) * 80);
      const opp: P = { id: -2, skill: (oppRating - 1000) * 0.8, rating: oppRating, games: 40, wins: 0, activity: 1, lastRound: 0 };
      settle(me, opp, r() < expected(me.skill, opp.skill));
    }
    finals.push(me.rating);
  }
  const share = tierShare(finals);
  return { winrate, games, trials, skillVsAvg: Math.round(skill), final: quantiles(finals), tiers: share, medianRank: deriveRank(pct(finals, 0.5) ?? 1000).label };
}

/* ── C · colocaciones ── */
function placement(seed: { rating: number; games: number; label: string }, wins: number) {
  const me: P = { id: -1, skill: 0, rating: seed.rating, games: seed.games, wins: 0, activity: 1, lastRound: 0 };
  const seq: number[] = [];
  // Peor y mejor caso de orden: victorias primero (dif. pequeña) — el delta depende del rival; se usa rival = mismo rating.
  for (let g = 0; g < 5; g++) {
    const opp: P = { id: -2, skill: 0, rating: me.rating, games: 40, wins: 0, activity: 1, lastRound: 0 };
    const before = me.rating;
    settle(me, opp, g < wins);
    seq.push(me.rating - before);
  }
  return { seed: seed.label, record: `${wins}-${5 - wins}`, from: seed.rating, to: me.rating, jump: me.rating - seed.rating, deltas: seq, rank: deriveRank(me.rating).label };
}

/* ── D · elegibilidad Top con población pequeña ── */
function eligibility(n: number, seed: number) {
  const pop = population(n, 100, 40, seed);
  return { n, rated: pop.rated, activeLast14: pop.activeLastRounds, note: "elegible = colocación completa (5) + ≥ 5 partidas de temporada + partida en los últimos 14 días" };
}

const out = {
  generatedAt: new Date().toISOString(),
  config: { version: RANK_V1.version, divisionWidth: RANK_V1.divisionWidth, tiers: RANK_V1.tiers.map((t) => ({ name: t.name, floor: t.floor })) },
  populations: [10, 50, 100, 500, 1000].flatMap((n) => [50, 100, 150].map((s) => population(n, s, 40, 1000 + n + s))),
  longRun: [100, 150].map((s) => population(500, s, 200, 77 + s)),
  winrates: [0.4, 0.5, 0.55, 0.6, 0.7].flatMap((w) => [20, 200].map((g) => fixedWinrate(w, g, 400, Math.round(w * 1000) + g))),
  placements: [{ rating: 1000, games: 0, label: "nuevo (1000, 0 partidas, K40)" }, { rating: 1089, games: 29, label: "veterano real (1089, 29 partidas, K24)" }, { rating: 885, games: 30, label: "bajo real (885, 30 partidas, K24)" }]
    .flatMap((s) => [5, 4, 3, 2, 1, 0].map((w) => placement(s, w))),
  lowPopulation: [10, 50, 100, 500, 1000].map((n) => eligibility(n, 5 + n)),
};

mkdirSync("docs/product/qa/f84-ranked", { recursive: true });
writeFileSync("docs/product/qa/f84-ranked/simulation.json", JSON.stringify(out, null, 2));
for (const p of out.populations) console.log(`pop n=${p.n} σ=${p.sigma}: P10 ${p.ratings.p10} P50 ${p.ratings.p50} P90 ${p.ratings.p90} P99 ${p.ratings.p99} sd ${p.sd} · cumbre ${p.cumbre.count} · drift/jug ${p.zeroSum.perPlayer} · tiers ${JSON.stringify(p.tiers)}`);
for (const p of out.longRun) console.log(`LARGO n=500 σ=${p.sigma} ~200 partidas/jugador: P10 ${p.ratings.p10} P50 ${p.ratings.p50} P90 ${p.ratings.p90} P99 ${p.ratings.p99} max ${p.ratings.max} sd ${p.sd} corr ${p.skillRatingCorrelation} cumbre ${p.cumbre.count} (winrate≥${p.cumbre.minSkillWinrateVsAvg}%) tiers ${JSON.stringify(p.tiers)}`);
for (const w of out.winrates) console.log(`winrate ${w.winrate} × ${w.games}: P10 ${w.final.p10} P50 ${w.final.p50} P90 ${w.final.p90} → ${w.medianRank} ${JSON.stringify(w.tiers)}`);
for (const p of out.placements) console.log(`colocación ${p.seed} ${p.record}: ${p.from} → ${p.to} (${p.jump >= 0 ? "+" : ""}${p.jump}) ${p.rank}`);
for (const e of out.lowPopulation) console.log(`población ${e.n}: con rating ${e.rated}, activos en el último 10 % del periodo ${e.activeLast14}`);
