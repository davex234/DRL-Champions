/**
 * FASE 62 · IMPACTO ECONÓMICO (instrumento `_`, fuera de CI, sin BD). Lee el CONTENIDO real (pool de misiones, tandas,
 * carril libre, logros, pagos de duelo, precios de sobres) y calcula los máximos por día/semana/temporada.
 *
 * F62 no añade ninguna fuente nueva de créditos, sobres ni cartas. Lo que cambia es la FRICCIÓN para cobrar lo ya
 * existente (reclamar en el hub y tras la partida). Por eso el techo teórico no cambia; lo que puede subir es la tasa
 * de cobro REAL hacia ese techo, que el simulador de F41 ya suponía (salud 12/12 con cobro completo).
 *
 *   npx tsx scripts/_fase62-economy.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_SEASON } from "@/data/season";
import { BATCH_SIZE } from "@/domain/progression/rotation";
import { duelPayoutTable, DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { getPack } from "@/data/packs";

const pool = CURRENT_SEASON.missionPool;
const topN = (kind: string, n: number, key: (m: (typeof pool)[number]) => number) =>
  pool.filter((m) => m.kind === kind).map(key).sort((a, b) => b - a).slice(0, n).reduce((s, x) => s + x, 0);

const dailyCredits = topN("daily", BATCH_SIZE.daily, (m) => m.reward.credits ?? 0);
const dailySeasonXp = topN("daily", BATCH_SIZE.daily, (m) => m.xp ?? 0);
const weeklyCredits = topN("weekly", BATCH_SIZE.weekly, (m) => m.reward.credits ?? 0);
const weeklySeasonXp = topN("weekly", BATCH_SIZE.weekly, (m) => m.xp ?? 0);
const table = duelPayoutTable();
const bestDuel = Math.max(...Object.values(table).flatMap((d) => Object.values(d).map((p) => p.credits ?? 0)));
const duelDailyMax = bestDuel * DAILY_DUEL_AWARD_CAP;
const freeTrack = Object.values(CURRENT_SEASON.free).reduce((s, r) => s + (r?.credits ?? 0), 0);
const freePacks = Object.values(CURRENT_SEASON.free).filter((r) => r?.packId).map((r) => r!.packId!);
const seasonXpToMax = CURRENT_SEASON.maxLevel * CURRENT_SEASON.xpPerLevel;
const weekSeasonXp = 7 * dailySeasonXp + weeklySeasonXp;
const prices = Object.fromEntries(["estandar", "premium", "bronce", "plata", "oro"].map((id) => [id, getPack(id)?.price ?? null]));

const out = {
  generatedAt: new Date().toISOString(),
  newSources: { credits: 0, packs: 0, cards: 0, note: "F62 no añade recompensas: ni por nivel de cuenta, ni logros nuevos, ni hitos de colección con premio." },
  existingCeilings: {
    missionsPerDay: { credits: dailyCredits, seasonXp: dailySeasonXp, batch: BATCH_SIZE.daily },
    missionsPerWeek: { credits: 7 * dailyCredits + weeklyCredits, seasonXp: weekSeasonXp, weeklyBatch: BATCH_SIZE.weekly, weeklyCredits },
    duelsPerDay: { bestCreditsPerDuel: bestDuel, cap: DAILY_DUEL_AWARD_CAP, credits: duelDailyMax },
    freeTrackSeason: { credits: freeTrack, packs: freePacks, levels: CURRENT_SEASON.maxLevel, seasonXpToMax, weeksAtDailyMax: +(seasonXpToMax / weekSeasonXp).toFixed(2) },
    achievementsLifetime: { credits: ACHIEVEMENTS.reduce((s, a) => s + a.reward, 0), count: ACHIEVEMENTS.length },
  },
  packPrices: prices,
  creditEquivalent: {
    // Diarias + duelos al tope + semanales amortizadas + carril libre amortizado al ritmo máximo de XP de temporada.
    maxDailyRecurring: Math.round(dailyCredits + duelDailyMax + weeklyCredits / 7 + freeTrack / ((seasonXpToMax / weekSeasonXp) * 7)),
    parts: { dailyMissions: dailyCredits, duels: duelDailyMax, weeklyAmortized: Math.round(weeklyCredits / 7), freeTrackAmortized: Math.round(freeTrack / ((seasonXpToMax / weekSeasonXp) * 7)) },
    estandarPacksPerDay: 0,
  },
  f41Reference: { maxRecurringPerDay: 10330, ceiling: 11150, source: "memoria/economy-fase41 (simulador 1M, salud 12/12)" },
  verdict: "",
};
out.creditEquivalent.estandarPacksPerDay = prices.estandar ? +(out.creditEquivalent.maxDailyRecurring / prices.estandar).toFixed(2) : 0;
out.verdict = out.creditEquivalent.maxDailyRecurring <= out.f41Reference.ceiling
  ? `Sin cambio de techo: ${out.creditEquivalent.maxDailyRecurring} créditos/día recurrentes ≤ techo F41 ${out.f41Reference.ceiling}. F62 solo reduce la fricción para cobrar lo que ya existía.`
  : `REVISAR: ${out.creditEquivalent.maxDailyRecurring} > ${out.f41Reference.ceiling}`;

const dir = join(process.cwd(), "docs/product/qa/fase62-progression");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "economy-impact.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
