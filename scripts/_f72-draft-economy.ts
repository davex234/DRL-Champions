/**
 * F72 · DRAFT GAUNTLET — SIMULACIÓN ECONÓMICA (fuera de CI).
 *
 * Entrada: `docs/product/qa/fase72/draft-winrates.json` (motor real, `_f72-draft-winrates.ts`). Aplica la tabla REAL de
 * `domain/draft/economy.ts` y mide, por perfil: EV por run (base y con el sobre semanal), distribución de victorias,
 * trayectorias de saldo (Monte Carlo), peor caso razonable (P5), granja semanal máxima y el efecto en cuentas nuevas.
 * También compara tablas alternativas descartadas. Escribe `docs/product/qa/fase72/draft-economy.json`.
 *
 *   npx tsx scripts/_f72-draft-economy.ts [trayectorias=20000]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DRAFT_ENTRY_FEE, DRAFT_JACKPOT, DRAFT_REWARD_CREDITS, draftExpectedValue } from "../src/domain/draft/economy";
import { createRng, nextFloat, type RngState } from "../src/domain/cardgame/opponent/rng";
import { duelPayoutTable, DAILY_DUEL_AWARD_CAP } from "../src/domain/progression/duelRewards";

const DIR = join(process.cwd(), "docs/product/qa/fase72");
const W = JSON.parse(readFileSync(join(DIR, "draft-winrates.json"), "utf8")) as { runs: number; profiles: Record<string, { winsDistribution: number[]; meanWins: number; stageWinRate: number[] }> };
const TRAJ = Number(process.argv[2] ?? 20_000);
const START_CREDITS = 6_000; // alta (trigger handle_new_user, 0011)

function sample(rng: RngState, dist: readonly number[]): { k: number; rng: RngState } {
  const f = nextFloat(rng); let acc = 0;
  for (let k = 0; k < dist.length; k++) { acc += dist[k]; if (f.value < acc) return { k, rng: f.rng }; }
  return { k: dist.length - 1, rng: f.rng };
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const out: Record<string, unknown> = {
  table: { entry: DRAFT_ENTRY_FEE, credits: DRAFT_REWARD_CREDITS, jackpot: DRAFT_JACKPOT },
  winratesRuns: W.runs, trajectories: TRAJ, profiles: {},
};

for (const [id, p] of Object.entries(W.profiles)) {
  const d = p.winsDistribution;
  const base = draftExpectedValue(d, 0);
  const firstOfWeek = draftExpectedValue(d, 1);
  // Runs hasta la primera completada (geométrica) y beneficio neto máximo de una semana dedicada a cazar el sobre.
  const pComplete = d[5];
  const runsToComplete = pComplete > 0 ? 1 / pComplete : Infinity;
  const weeklyHunt = pComplete > 0 ? runsToComplete * base.ev + DRAFT_JACKPOT.packPrice : null;

  // Monte Carlo: 10 runs seguidas (una sesión larga) desde saldo holgado; y una cuenta nueva (6.000) hasta no poder entrar.
  let rng = createRng(0xf72 ^ id.length * 7919);
  const session: number[] = []; const newAcct: { runs: number; end: number }[] = [];
  for (let t = 0; t < TRAJ; t++) {
    let bal = 0; let jackpotTaken = false;
    for (let r = 0; r < 10; r++) {
      const s = sample(rng, d); rng = s.rng;
      bal += DRAFT_REWARD_CREDITS[s.k] - DRAFT_ENTRY_FEE;
      if (s.k === 5 && !jackpotTaken) { jackpotTaken = true; bal += DRAFT_JACKPOT.packPrice; }
    }
    session.push(bal);
    let c = START_CREDITS; let n = 0;
    while (c >= DRAFT_ENTRY_FEE && n < 200) { const s = sample(rng, d); rng = s.rng; c += DRAFT_REWARD_CREDITS[s.k] - DRAFT_ENTRY_FEE; n++; }
    newAcct.push({ runs: n, end: c });
  }
  (out.profiles as Record<string, unknown>)[id] = {
    winsDistribution: d, meanWins: p.meanWins, completionRate: pComplete,
    evBase: Math.round(base.ev), evBasePct: +(base.evPct * 100).toFixed(1), meanRewardBase: Math.round(base.reward),
    evFirstRunOfWeek: Math.round(firstOfWeek.ev),
    runsToFirstCompletion: Number.isFinite(runsToComplete) ? +runsToComplete.toFixed(2) : null,
    weeklyJackpotHuntNet: weeklyHunt === null ? null : Math.round(weeklyHunt),
    session10: { mean: Math.round(session.reduce((s, x) => s + x, 0) / TRAJ), p5: pct(session, 0.05), p50: pct(session, 0.5), p95: pct(session, 0.95), note: "10 runs seguidas, créditos + sobre semanal a precio de tienda" },
    newAccount: { runsBeforeBroke_p50: pct(newAcct.map((x) => x.runs), 0.5), runsBeforeBroke_p5: pct(newAcct.map((x) => x.runs), 0.05), capped200: newAcct.filter((x) => x.runs >= 200).length / TRAJ },
  };
  console.log(id, JSON.stringify((out.profiles as Record<string, unknown>)[id]));
}

// Referencias de la economía existente (no se tocan): cuánto paga el mismo tiempo en PvE.
const t = duelPayoutTable();
out.reference = {
  pve5MatchesNormal: Math.round(5 * (0.52 * t.win.NORMAL.credits + 0.07 * t.draw.NORMAL.credits + 0.41 * t.loss.NORMAL.credits)),
  pveDailyCap: DAILY_DUEL_AWARD_CAP, pveMaxDailyHard: DAILY_DUEL_AWARD_CAP * t.win.HARD.credits,
  f41RecurringCeilingPerDay: 11_150, f41MeasuredMaxPerDay: 10_330,
  jackpotPerDayEquivalent: Math.round(DRAFT_JACKPOT.packPrice / 7),
};

// Tablas alternativas descartadas (misma forma): ¿alguna es imprenta para SKILLED/ORACLE?
const ALT: Record<string, { entry: number; credits: number[]; jackpot: number }> = {
  "A · 1.500 / escalado ×0,75": { entry: 1_500, credits: [0, 150, 375, 750, 1_200, 1_575], jackpot: 5_000 },
  "B · 2.000 / 5W 3.000 (más tocho sin tope)": { entry: 2_000, credits: [0, 200, 500, 1_000, 1_600, 3_000], jackpot: 0 },
  "C · 2.000 / 5W = Sobre Champions cada vez": { entry: 2_000, credits: [0, 200, 500, 1_000, 1_600, 8_000], jackpot: 0 },
  "D · ELEGIDA 2.000 / 2.100 + Masters semanal": { entry: 2_000, credits: [...DRAFT_REWARD_CREDITS], jackpot: 5_000 },
};
out.alternatives = Object.fromEntries(Object.entries(ALT).map(([k, a]) => [k, Object.fromEntries(Object.entries(W.profiles).map(([id, p]) => {
  const ev = p.winsDistribution.reduce((s, q, i) => s + q * a.credits[i], 0) - a.entry;
  return [id, Math.round(ev)];
}))]));
console.log("alternatives", JSON.stringify(out.alternatives));
writeFileSync(join(DIR, "draft-economy.json"), JSON.stringify(out, null, 2) + "\n");
