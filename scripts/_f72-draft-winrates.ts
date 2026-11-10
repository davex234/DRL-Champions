/**
 * F72 · DRAFT GAUNTLET — distribución REAL de victorias por run (fuera de CI).
 *
 * Motor real (`balance/lab.playMatch`), draft real (`simulateDraft` con el pool del catálogo), rivales reales
 * (`rivalDeckFor`), bots reales por etapa (`STAGE_DIFFICULTY`), primer atacante 50/50 como `launchPve`.
 * Un empate termina la run (regla F39). Escribe `docs/product/qa/fase72/draft-winrates.json`.
 *
 *   npx tsx scripts/_f72-draft-winrates.ts [runsPorPerfil=4000]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "../src/collection/registry";
import { buildDraftPool, eligibleDataVersion, rivalDeckFor, simulateDraft } from "../src/domain/draft/generate";
import { STAGE_DIFFICULTY } from "../src/domain/draft/rules";
import { catalogCards, labSnapshot, playMatch, peakStat, type Policy } from "../src/domain/balance/lab";
import { createRng, nextInt, type RngState } from "../src/domain/cardgame/opponent/rng";

const RUNS = Number(process.argv[2] ?? 4000);
const REG = new CardRegistry();
const INPUT = { cards: REG.cards, player: (id: string) => REG.player(id), droppable: () => true };
const DV = eligibleDataVersion(INPUT);
if (!DV) throw new Error("pool no elegible");
const POOL = buildDraftPool(INPUT, DV);
const BY_ID = new Map(catalogCards(REG).map((c) => [c.cardId, c]));

type Chooser = (offer: readonly string[]) => string;
const random = (seed: number): Chooser => { let r: RngState = createRng(seed ^ 0x5eed); return (o) => { const n = nextInt(r, 0, o.length - 1); r = n.rng; return o[n.value]; }; };
const best = (score: (id: string) => number): Chooser => (o) => [...o].sort((a, b) => score(b) - score(a))[0];
const ovr = (id: string) => POOL.byId.get(id)?.ovr ?? 0;
const peak = (id: string) => { const c = BY_ID.get(id); return c ? peakStat(c) * 100 + ovr(id) : ovr(id); };

interface Profile { id: string; label: string; chooser: (seed: number) => Chooser; policy: Policy }
const PROFILES: Profile[] = [
  { id: "CASUAL", label: "elige al azar y juega al azar", chooser: random, policy: "RANDOM" },
  { id: "REGULAR", label: "elige por OVR y juega como el bot NORMAL", chooser: () => best(ovr), policy: "NORMAL" },
  { id: "SKILLED", label: "elige por pico de stat y juega con heurística completa (SMART)", chooser: () => best(peak), policy: "SMART" },
  { id: "ORACLE", label: "cota superior: pico de stat + ve el mazo rival (imposible para un humano)", chooser: () => best(peak), policy: "ORACLE" },
];
const BOT: Record<string, Policy> = { EASY: "EASY", NORMAL: "NORMAL", HARD: "HARD" };

const out: Record<string, unknown> = { runs: RUNS, dataVersion: DV, stageDifficulty: STAGE_DIFFICULTY, profiles: {} };
const t0 = Date.now();
for (const p of PROFILES) {
  const wins = [0, 0, 0, 0, 0, 0];
  const stageTried = [0, 0, 0, 0, 0]; const stageWon = [0, 0, 0, 0, 0]; let draws = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const picks = simulateDraft(POOL, seed, p.chooser(seed)).picks;
    const mine = labSnapshot(picks, `me-${seed}`, REG);
    let w = 0;
    for (let stage = 1; stage <= 5; stage++) {
      stageTried[stage - 1]++;
      const rival = labSnapshot(rivalDeckFor(POOL, seed, stage), `rv-${seed}-${stage}`, REG);
      const ms = (seed * 7919 + stage * 104729) >>> 0;
      const m = playMatch(mine, rival, p.policy, BOT[STAGE_DIFFICULTY[stage - 1]], ms % 2 === 0 ? "A" : "B", ms);
      if (m.draw) draws++;
      if (m.winner === "A") { w++; stageWon[stage - 1]++; } else break;
    }
    wins[w]++;
  }
  (out.profiles as Record<string, unknown>)[p.id] = {
    label: p.label, policy: p.policy,
    winsDistribution: wins.map((n) => +(n / RUNS).toFixed(4)),
    stageWinRate: stageWon.map((n, i) => +(n / Math.max(1, stageTried[i])).toFixed(4)),
    meanWins: +(wins.reduce((s, n, k) => s + n * k, 0) / RUNS).toFixed(3),
    drawShare: +(draws / (RUNS * 1)).toFixed(4),
  };
  console.log(p.id, JSON.stringify((out.profiles as Record<string, { winsDistribution: number[]; stageWinRate: number[] }>)[p.id]));
}
out.elapsedMs = Date.now() - t0;
const dir = join(process.cwd(), "docs/product/qa/fase72");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "draft-winrates.json"), JSON.stringify(out, null, 2) + "\n");
