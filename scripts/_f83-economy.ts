/**
 * F83 · ECONOMÍA Y SIMULACIÓN DE LA TEMPORADA 2 (instrumento, fuera de CI). Sobre la DEFINICIÓN (plantilla), sin BD.
 *   npx tsx scripts/_f83-economy.ts [salida.json]
 * Compara con el carril libre del pase heredado (Temporada 1) y con el techo recurrente de F41/F62.
 */
import { writeFileSync } from "node:fs";
import { PACKS } from "../src/data/packs";
import { CURRENT_SEASON, SEASON_MAX_LEVEL } from "../src/data/season";
import { t2Draft } from "../src/domain/seasonTrack/template";
import { economyTotals, simulate } from "../src/domain/seasonTrack/economy";

const price = (id: string) => PACKS.find((p) => p.id === id)?.price ?? null;
const s = t2Draft();
const days = Math.round((s.endsAt - s.startsAt) / 86_400_000);
const totals = economyTotals(s.config, price);
const sim = simulate(s.config, days, price);

// Carril LIBRE del pase heredado (Temporada 1), para comparar.
let legacyCredits = 0; const legacyPacks = new Map<string, number>();
const free = (CURRENT_SEASON as unknown as { tracks?: { free: Record<number, { credits?: number; packId?: string; packCount?: number }> }; free?: Record<number, { credits?: number; packId?: string; packCount?: number }> });
const track = free.tracks?.free ?? free.free ?? {};
for (let l = 1; l <= SEASON_MAX_LEVEL; l++) { const r = track[l]; if (!r) continue; legacyCredits += r.credits ?? 0; if (r.packId) legacyPacks.set(r.packId, (legacyPacks.get(r.packId) ?? 0) + (r.packCount ?? 1)); }
const legacyPackValue = [...legacyPacks.entries()].reduce((a, [id, n]) => a + n * (price(id) ?? 0), 0);

const out = {
  season: { id: s.id, name: s.name, days, maxLevel: s.maxLevel, totalXp: s.config.levels.at(-1), curve: s.config.curve, xp: s.config.xp,
    dailyAvgXp: Math.round(s.config.challenges.daily.pool.reduce((a, c) => a + c.xp, 0) / s.config.challenges.daily.pool.length * s.config.challenges.daily.count),
    weeklyAvgXp: Math.round(s.config.challenges.weekly.pool.reduce((a, c) => a + c.xp, 0) / s.config.challenges.weekly.pool.length * s.config.challenges.weekly.count) },
  totals,
  perDayMaxValue: Math.round(totals.totalValue / days),
  legacyFreeTrack: { credits: legacyCredits, packs: Object.fromEntries(legacyPacks), packValue: legacyPackValue, totalValue: legacyCredits + legacyPackValue },
  ratioVsLegacy: +(totals.totalValue / Math.max(1, legacyCredits + legacyPackValue)).toFixed(2),
  simulation: sim,
};
console.log(JSON.stringify(out, null, 1));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
