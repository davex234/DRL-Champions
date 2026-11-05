/**
 * F87 · ANÁLISIS ECONÓMICO DE LAS RECOMPENSAS DE PICK'EMS 2.0 (instrumento, fuera de CI). No escribe nada.
 *
 *   npx tsx scripts/_f87-economy.mts > docs/product/qa/pickems-2/economy.json
 *
 * Valores = precio de tienda vigente de los sobres (F80). Simulación sobre los GRAFOS REALES de Champions 2026 (grupos
 * GSL tal cual; playoffs con la estructura de doble a 8 —sus cruces de perdedores de prueba no cambian la economía:
 * 14 partidos, 27 puntos—) y un 8 a eliminación simple de referencia. Comparación con las fuentes vivas del catálogo.
 */
import snapshot from "../src/domain/pickems/fixtures/vlr-2766-champions-2026.snapshot.json" with { type: "json" };
import { deriveFormat, type RealMatchRow, type StageRow } from "../src/domain/pickems/format";
import { liabilityOf, proposedRewards, tierValue, TIER_LABEL, type CatalogLookup } from "../src/domain/pickems/bracketRewards";
import { simulateTiers } from "../src/domain/pickems/economy";
import { getPack } from "../src/data/packs";
import { seasonBudget, dailyRecurringCeiling } from "../src/domain/economy/catalog";
import { REWARD_TIERS } from "../src/domain/pickems/rewards";
import { t2Config } from "../src/domain/seasonTrack/template";
import { economyTotals, simulate as simulateSeason } from "../src/domain/seasonTrack/economy";
import { se8 } from "../src/domain/pickems/testing/formatFixtures";

const cat: CatalogLookup = { packPrice: (id) => getPack(id)?.price ?? null, cardExists: () => false };
const real = snapshot.matches as unknown as RealMatchRow[];
const stages = snapshot.stages as StageRow[];
const G = stages.find((s) => s.kind === "group")!;
const P = stages.find((s) => s.kind === "playoff")!;
const TEST_EDGES = [
  { from: "754732", to: "754738", source: "LOSER" as const, slot: 1 as const }, { from: "754733", to: "754738", source: "LOSER" as const, slot: 2 as const },
  { from: "754730", to: "754739", source: "LOSER" as const, slot: 1 as const }, { from: "754731", to: "754739", source: "LOSER" as const, slot: 2 as const },
  { from: "754734", to: "754741", source: "LOSER" as const, slot: null }, { from: "754735", to: "754740", source: "LOSER" as const, slot: null },
];
const scopes = {
  "champions-2026-playoffs (doble a 8, 14 partidos)": deriveFormat({ eventId: "vlr-2766", stages: [P], matches: real.filter((m) => m.stage_id === P.id), adminEdges: TEST_EDGES }).descriptor!,
  "champions-2026-grupos (4×GSL, 20 partidos)": deriveFormat({ eventId: "vlr-2766", stages: [G], matches: real.filter((m) => m.stage_id === G.id) }).descriptor!,
  "referencia: eliminación simple a 8 (7 partidos)": deriveFormat({ eventId: "x", stages: se8().stages, matches: se8().matches }).descriptor!,
};
const cfg = proposedRewards("ambito");
const prices = Object.fromEntries(["estandar", "premium", "oro", "masters", "champions", "icon"].map((id) => [id, getPack(id)?.price ?? null]));
const liab = liabilityOf(cfg, cat);

const sims = Object.fromEntries(Object.entries(scopes).map(([k, d]) => [k, {
  maxPoints: d.nodes.reduce((s, n) => s + n.points, 0),
  runs: [0.5, 0.6, 0.65, 0.7, 0.8].map((p) => {
    const r = simulateTiers(d, cfg, cat, p, { runs: 4000, seed: 87 });
    return { accuracy: p, meanRatio: +r.meanRatio.toFixed(3), perfectRate: +r.perfectRate.toFixed(5), ev: Math.round(r.ev), dist: Object.fromEntries(Object.entries(r.dist).map(([t, x]) => [t, +x.toFixed(4)])) };
  }),
}]));

const sb = seasonBudget();
const t2 = economyTotals(t2Config(), (id) => getPack(id)?.price ?? null);
const t2sim = simulateSeason(t2Config(), 56, (id) => getPack(id)?.price ?? null);
const v1 = REWARD_TIERS.map((t) => ({ id: t.id, minPoints: t.minPoints, credits: t.reward.credits ?? 0, pack: t.reward.packId ?? null, value: (t.reward.credits ?? 0) + (t.reward.packId ? (getPack(t.reward.packId)?.price ?? 0) * (t.reward.packCount ?? 1) : 0) }));

console.log(JSON.stringify({
  at: new Date().toISOString(),
  packPrices: prices,
  proposal: { minCompletion: cfg.minCompletion, tiers: cfg.tiers.map((t) => ({ id: t.id, label: TIER_LABEL[t.id], minRatio: t.minRatio, reward: t.reward, value: tierValue(t.reward, cat) })) },
  liability: { maxTierValue: liab.maxTierValue, worstCase: { users2: liab.worstCase(2), users100: liab.worstCase(100), users1000: liab.worstCase(1000) } },
  simulations: sims,
  comparison: {
    starterGrant: "6.000 créditos + 3 Sobres Iniciales + 1 Bronce (una vez)",
    dailyRecurringCeiling: dailyRecurringCeiling(),
    pveMaxPerDay: sb.pveMaxPerDay, dailyMissionsMaxPerDay: sb.dailyMissionMaxPerDay, weeklyMissionsMaxPerWeek: sb.weeklyMissionMaxPerWeek,
    battlePassFree: { credits: sb.passFreeCredits, packs: sb.passFreePacks }, battlePassCompetitive: { credits: sb.passCompetitiveCredits, packs: sb.passCompetitivePacks },
    achievementsTotal: sb.achievementsCredits, campaignTotal: sb.campaignCredits,
    f83Season2Track: { totalValue: t2.totalValue, credits: t2.credits, packValue: t2.packValue, packs: t2.packs, profiles56d: t2sim.map((p) => ({ id: p.id, credits: p.credits, packValue: p.packValue, level: p.levelAtEnd })) },
    pickemV1Live: v1,
  },
}, null, 1));
