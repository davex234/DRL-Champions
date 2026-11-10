/**
 * CORE GAME LOOP · SIMULACIÓN ECONÓMICA ANTES/DESPUÉS (instrumento de operador, fuera de CI y de la release).
 *
 *   npx tsx scripts/coreloop/_economy.mts            → docs/product/qa/core-loop/economy.json + tabla en consola
 *
 * Importes LEÍDOS DEL CÓDIGO: tabla PvE (`duelReward`/`duelPoints`), tope (`DAILY_DUEL_AWARD_CAP`), pool de misiones y
 * carriles del pase (`CURRENT_SEASON`), precios (`getPack`), sorteo real (`rollMissions` con interruptores).
 * Tasas de victoria MEDIDAS con el motor (scripts/coreloop/_difficulty.mts, mazo de bienvenida real, n=3.000/celda).
 * Duración: mediana real PvE en producción 174 s (n=8) + ~30 s de resultado/revancha → 3,5 min por partida.
 * Supuestos (declarados): una apertura de sobre al día si el ingreso lo permite (si no, la fracción); «Abre 10 sobres»
 * solo si el ingreso da para 10 Bronces por semana; «5 cartas nuevas» siempre (colección temprana).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { duelReward, duelPoints, DAILY_DUEL_AWARD_CAP, type DuelDifficulty } from "../../src/domain/progression/duelRewards";
import { CURRENT_SEASON, SEASON_XP_PER_LEVEL, SEASON_MAX_LEVEL } from "../../src/data/season";
import { rollMissions } from "../../src/battlepass/missions";
import { makeRng } from "../../src/sim/rng";
import { getPack } from "../../src/data/packs";
import type { MissionFlags } from "../../src/domain/progression/missionAvailability";

const MIN_PER_MATCH = 3.5;
const PACK_OPEN_MIN = 2;
interface Profile { id: string; label: string; minutes: number; difficulty: DuelDifficulty; win: number; draw: number; policy: string }
// Tasas medidas (mazo de bienvenida): NORMAL vs Normal 49,6 %; HARD vs Hard 45,6 %; SMART vs Hard 55,7 %.
const PROFILES: Profile[] = [
  { id: "casual", label: "Casual 30 min", minutes: 30, difficulty: "NORMAL", win: 0.496, draw: 0, policy: "NORMAL" },
  { id: "regular", label: "Regular 1 h", minutes: 60, difficulty: "NORMAL", win: 0.496, draw: 0, policy: "NORMAL" },
  { id: "active", label: "Activo 2 h", minutes: 120, difficulty: "HARD", win: 0.456, draw: 0.001, policy: "HARD" },
  { id: "hardcore", label: "Hardcore 4 h", minutes: 240, difficulty: "HARD", win: 0.557, draw: 0, policy: "SMART" },
];

const pool = CURRENT_SEASON.missionPool;
const def = (id: string) => pool.find((m) => m.id === id)!;
const credits = (id: string) => def(id).reward.credits ?? 0;

/** Probabilidad de que cada diaria salga en la tanda (sorteo REAL, 20.000 semillas). */
function inclusion(kind: "daily" | "weekly", flags: MissionFlags): Record<string, number> {
  const n = 20_000; const c: Record<string, number> = {};
  for (let s = 1; s <= n; s++) for (const m of rollMissions([...pool], kind, kind === "daily" ? 3 : 2, makeRng(s), flags)) c[m.id] = (c[m.id] ?? 0) + 1;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / n]));
}
const BEFORE: MissionFlags = { marketEnabled: false, legacyPickems: true }; // la diaria de Pick'em se sorteaba…
const AFTER: MissionFlags = { marketEnabled: false };                        // …y ahora no.

function perMatch(p: Profile) {
  const lose = 1 - p.win - p.draw;
  const c = p.win * (duelReward("win", p.difficulty).credits ?? 0) + p.draw * (duelReward("draw", p.difficulty).credits ?? 0) + lose * (duelReward("loss", p.difficulty).credits ?? 0);
  const xp = p.win * (duelReward("win", p.difficulty).xp ?? 0) + p.draw * (duelReward("draw", p.difficulty).xp ?? 0) + lose * (duelReward("loss", p.difficulty).xp ?? 0);
  const pts = p.win * duelPoints("win", p.difficulty) + p.draw * duelPoints("draw", p.difficulty);
  return { credits: c, xp, points: pts };
}

function simulate(p: Profile, flags: MissionFlags, days: number) {
  const inc = inclusion("daily", flags); const incW = inclusion("weekly", flags);
  const matches = Math.floor((p.minutes - PACK_OPEN_MIN) / MIN_PER_MATCH);
  const paid = Math.min(matches, DAILY_DUEL_AWARD_CAP);
  const pm = perMatch(p);
  const matchCredits = paid * pm.credits;
  const pWin1 = 1 - Math.pow(1 - p.win, matches);
  const bronze = getPack("estandar")!.price;
  // Diarias: «Juega 1» y «Gana 1» dependen de jugar; «Abre 1» de poder abrir un sobre ese día; Pick'em = imposible.
  const openFrac = Math.min(1, (matchCredits + 850) / bronze);
  const dailyDone: Record<string, number> = { "d-duelo-1": matches > 0 ? 1 : 0, "d-duelo-win": pWin1, "d-abrir-1": openFrac, "d-pickem-1": 0 };
  let dCred = 0, dPass = 0;
  for (const [id, pr] of Object.entries(inc)) { dCred += pr * dailyDone[id] * credits(id); dPass += pr * dailyDone[id] * def(id).xp; }
  const packsWeek = Math.min(7 * Math.max(1, (matchCredits + dCred) / bronze), 99);
  const weeklyDone: Record<string, number> = { "w-duelos-5": matches * 7 >= 5 ? 1 : 0, "w-victorias": matches * 7 * p.win >= 3 ? 1 : 0, "w-sobres-10": packsWeek >= 10 ? 1 : 0, "w-cartas-5": 1 };
  let wCred = 0, wPass = 0;
  for (const [id, pr] of Object.entries(incW)) { wCred += pr * weeklyDone[id] * credits(id); wPass += pr * weeklyDone[id] * def(id).xp; }
  const weeks = days / 7;
  // Pase: XP solo por misiones (diarias + semanales + fijas alcanzables en la ventana).
  const totalMatches = matches * days, totalWins = totalMatches * p.win, points = paid * days * pm.points;
  const fixed: { id: string; done: boolean }[] = [
    { id: "s-duelos-25", done: totalMatches >= 25 }, { id: "s-mazo", done: true },
    // «Declara tu región»: cuenta nueva = siempre posible (antes y después). Cuenta ANTERIOR con región: antes imposible.
    { id: "s-region", done: true }, { id: "p-puntos-400", done: points >= 400 },
  ];
  const fixedCred = fixed.filter((f) => f.done).reduce((s, f) => s + credits(f.id), 0);
  const fixedPass = fixed.filter((f) => f.done).reduce((s, f) => s + def(f.id).xp, 0);
  const passXp = dPass * days + wPass * weeks + fixedPass;
  const level = Math.min(SEASON_MAX_LEVEL, Math.floor(passXp / SEASON_XP_PER_LEVEL));
  let passCred = 0, passPacks = 0;
  for (let l = 1; l <= level; l++) { passCred += CURRENT_SEASON.free[l]?.credits ?? 0; passPacks += CURRENT_SEASON.free[l]?.packCount ?? 0; }
  const competitive = points >= 400;
  if (competitive) for (let l = 1; l <= level; l++) { passCred += CURRENT_SEASON.competitive?.[l]?.credits ?? 0; passPacks += CURRENT_SEASON.competitive?.[l]?.packCount ?? 0; }
  const recurring = matchCredits * days + dCred * days + wCred * weeks;
  const total = recurring + fixedCred + passCred;
  return {
    matchesPerDay: matches, paidPerDay: paid, creditsPerMatch: Math.round(pm.credits),
    creditsPerDayRecurring: Math.round(recurring / days), creditsPerDayAll: Math.round(total / days),
    dailyMissionCredits: Math.round(dCred), weeklyMissionCreditsPerWeek: Math.round(wCred),
    accountXpPerDay: Math.round(paid * pm.xp), passXpPerDay: Math.round(passXp / days), passLevel: level, competitiveTrack: competitive,
    rankPoints: Math.round(points), wins: Math.round(totalWins),
    bronzeEquivPerWeek: +(total / days * 7 / bronze).toFixed(1), cardsPerWeekBronzeEquiv: Math.round(total / days * 7 / bronze * getPack("estandar")!.cardCount),
    grantedPacks: passPacks + (fixed.find((f) => f.id === "s-duelos-25")!.done ? 2 : 0),
  };
}

const TIERS = ["estandar", "premium", "oro", "masters", "champions", "icon"];
const out: Record<string, unknown> = { assumptions: { MIN_PER_MATCH, PACK_OPEN_MIN, medianRealPveSeconds: 174, sampleN: 8 }, inclusionBefore: inclusion("daily", BEFORE), inclusionAfter: inclusion("daily", AFTER), weeklyInclusion: inclusion("weekly", AFTER), profiles: {} as Record<string, unknown> };
for (const p of PROFILES) {
  const row: Record<string, unknown> = {};
  for (const [tag, flags] of [["before", BEFORE], ["after", AFTER]] as const) for (const d of [1, 7, 30]) row[`${tag}_${d}d`] = simulate(p, flags, d);
  const a = row.after_7d as ReturnType<typeof simulate>;
  const perMatchAll = a.creditsPerDayRecurring / a.paidPerDay;
  row.matchesToPack = Object.fromEntries(TIERS.map((t) => {
    const price = getPack(t)!.price;
    return [getPack(t)!.name, { price, matchesOnly: Math.ceil(price / a.creditsPerMatch), withMissions: Math.ceil(price / perMatchAll), days: +(price / a.creditsPerDayRecurring).toFixed(1) }];
  }));
  (out.profiles as Record<string, unknown>)[p.id] = { profile: p, ...row };
  const b1 = row.before_1d as ReturnType<typeof simulate>, a1 = row.after_1d as ReturnType<typeof simulate>, a30 = row.after_30d as ReturnType<typeof simulate>, b30 = row.before_30d as ReturnType<typeof simulate>;
  console.log(`${p.label}: ${a1.matchesPerDay} partidas/día (${a1.paidPerDay} pagadas) · ${a1.creditsPerMatch} cr/partida · cr/día ANTES ${b1.creditsPerDayRecurring} → DESPUÉS ${a1.creditsPerDayRecurring} · 30 d: ${b30.creditsPerDayAll}→${a30.creditsPerDayAll} cr/día, pase nivel ${b30.passLevel}→${a30.passLevel}, Bronce-eq/sem ${a30.bronzeEquivPerWeek}`);
  console.log("   partidas hasta: " + Object.entries(row.matchesToPack as Record<string, { matchesOnly: number; withMissions: number; days: number }>).map(([k, v]) => `${k} ${v.matchesOnly}/${v.withMissions} (${v.days} d)`).join(" · "));
}
console.log("diarias ANTES", out.inclusionBefore, "DESPUÉS", out.inclusionAfter);
const dir = join(process.cwd(), "docs/product/qa/core-loop");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "economy.json"), JSON.stringify(out, null, 2) + "\n");
