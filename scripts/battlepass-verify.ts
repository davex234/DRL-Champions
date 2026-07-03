/**
 * VERIFICACIÓN — Battle Pass, Missions & Seasonal Progression Engine (DRL Champions, Collection Fase 6/7).
 *
 *   npx tsx scripts/battlepass-verify.ts
 *
 * Comprueba la capa de progresión de temporada ENCIMA del ecosistema, sin duplicar rewards/economy/
 * collection/craft/marketplace/career: XP/niveles/tiers · tracks libre/premium · claim/auto-claim/
 * premium · misiones por datos (MetricSnapshot real) · eventos · temporadas/archive/legacy · rewards
 * (ruta única) · determinismo · migraciones · rendimiento (100k jugadores · 100 temporadas · 10M
 * misiones) · cero estados imposibles. 100% DETERMINISTA (RNG del proyecto; reloj lógico inyectado).
 */
import "./_polyfill-localstorage";
import { makeRng } from "../src/sim/rng";
import {
  PassEngine, freshPassState, migratePassState, levelProgress, missionProgress, rollMissions,
  type SeasonDef, type MissionDef, type Reward, type MetricSnapshot,
} from "../src/battlepass";
import { CURRENT_SEASON } from "../src/data/seasons";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Battle Pass, Missions & Seasonal Progression Engine — DRL Champions (Collection Fase 6/7)\n");

const S = CURRENT_SEASON;
const fresh = () => new PassEngine(freshPassState(S.id), S);

// ─────────────────────── 1. XP / niveles ───────────────────────
console.log("## XP / niveles");
{
  const e = fresh();
  const r = e.gainXp(S.xpPerLevel * 5 + 500, 100);
  check("XP: sube de nivel según la curva (5 niveles)", e.level() === 5 && r.events.filter((x) => x.type === "level_up").length === 5);
  check("XP: nivel acotado a maxLevel (no infinito)", new PassEngine(freshPassState(S.id), S).gainXp(S.xpPerLevel * (S.maxLevel + 20), 1).state && levelProgress(S.xpPerLevel * (S.maxLevel + 20), S).level === S.maxLevel);
  check("XP: negativa se ignora (nunca baja)", fresh().gainXp(-500, 1).state.xp === 0);
}

// ─────────────────────── 2. Tracks / claim / free / premium ───────────────────────
console.log("\n## Tracks / claim (libre + premium)");
{
  let e = new PassEngine(fresh().gainXp(S.xpPerLevel * 5, 1).state, S);
  const c3 = e.claimReward(3, "free", 1);
  check("CLAIM libre: reclama nivel alcanzado y devuelve su recompensa", c3.ok && c3.rewards.length === 1);
  check("DOBLE CLAIM: reclamar el mismo nivel otra vez ⇒ falla", !e.claimReward(3, "free", 1).ok);
  check("NO ALCANZADO: reclamar nivel > actual ⇒ falla", !e.claimReward(40, "free", 1).ok);
  check("PREMIUM bloqueado: claim premium sin desbloqueo ⇒ falla", !e.claimReward(2, "premium", 1).ok);
  e = new PassEngine(e.unlockPremium(1).state, S);
  check("PREMIUM desbloqueado: claim premium ⇒ ok", e.claimReward(2, "premium", 1).ok);
  const track = e.claimTrack("free", 1);
  check("CLAIM TRACK: reclama todos los niveles libres pendientes de una vez", track.rewards.length >= 1 && e.snapshot().claimedFree.length === 5);
}

// ─────────────────────── 3. Auto-claim / boost ───────────────────────
console.log("\n## Auto-claim / boost");
{
  const e = fresh();
  e.setAutoClaim(true);
  const r = e.gainXp(S.xpPerLevel * 3, 1);
  check("AUTO-CLAIM: al subir de nivel reclama automáticamente las recompensas", r.rewards.length >= 3 && e.snapshot().claimedFree.length >= 3);
  const b = fresh();
  b.setBoost(2);
  check("BOOST: multiplica la XP ganada", b.gainXp(500, 1).state.xp === 1000);
}

// ─────────────────────── 4. Misiones (por datos, MetricSnapshot real) ───────────────────────
console.log("\n## Misiones (100% por datos)");
{
  const e = fresh();
  e.refreshMissions("daily", 3, { packs_opened: 0 }, makeRng(42), 1);
  const active = e.snapshot().missions;
  check("REFRESH: sortea 3 misiones diarias del pool (sin ocultas)", active.length === 3 && active.every((m) => m.kind === "daily"));
  const m = active[0];
  const snap: MetricSnapshot = { [m.metric]: m.baseline + m.goal };   // métrica real alcanza el goal
  check("PROGRESO: se mide como snapshot − baseline (no duplica estadística)", missionProgress({ ...m }, snap) === m.goal);
  const done = e.completeMission(m.id, snap, 1);
  check("COMPLETAR: da recompensa + XP al pase; incrementa el contador", done.ok && done.rewards.length >= 1 && e.snapshot().missionsCompleted === 1);
  check("NO COMPLETA: métrica por debajo del goal ⇒ falla", !e.completeMission(active[1].id, { [active[1].metric]: active[1].baseline }, 1).ok);
  // Repetible: re-baseline al completar.
  const rep = e.snapshot().missions.find((x) => x.id === m.id);
  check("REPETIBLE: tras completar se re-baseline (vuelve a empezar, no queda 'claimed')", !!rep && !rep.claimed && rep.baseline === snap[m.metric]);
  check("OCULTAS: no aparecen en los sorteos", rollMissions(S.missionPool, "hidden", 5, makeRng(1)).length >= 0 && !e.snapshot().missions.some((x) => x.kind === "hidden"));
}

// ─────────────────────── 5. Rewards (ruta única) ───────────────────────
console.log("\n## Rewards (el motor SOLO devuelve Reward[]; el store aplica)");
{
  const e = new PassEngine(fresh().gainXp(S.xpPerLevel * 10, 1).state, S);
  const r = e.claimReward(10, "free", 1);
  const rw = r.rewards[0] as Reward;
  check("REWARD: nivel 10 libre incluye un sobre (se aplica por PackEngine/Minter en el store)", !!rw.packId);
  // Tipos soportados en la temporada: credits/tokens/packs/cards/materials/cosmetics.
  const kinds = new Set<string>();
  for (const lvl of Object.values(S.free).concat(Object.values(S.premium))) for (const k of Object.keys(lvl)) kinds.add(k);
  check("REWARD: tipos variados (credits/tokens/packs/materials/cosmetics)", kinds.has("credits") && kinds.has("packId") && kinds.has("materials") && kinds.has("cosmetics"));
}

// ─────────────────────── 6. Temporadas / archive / legacy ───────────────────────
console.log("\n## Temporadas / archive / legacy");
{
  const e = new PassEngine(fresh().gainXp(S.xpPerLevel * 8, 1).state, S);
  const adv = e.advanceSeason("s2", 999);
  check("ADVANCE: archiva la temporada y hace soft-reset (XP/premium a 0)", adv.state.archive.length === 1 && adv.state.xp === 0 && adv.state.premium === false && adv.state.seasonId === "s2");
  check("LEGACY: el historial conserva nivel/xp de la temporada anterior (nunca se pierde)", adv.state.archive[0].level === 8 && adv.state.archive[0].seasonId === S.id);
  const arch = fresh().archiveSeason(1);
  check("ARCHIVE: archiva sin avanzar", arch.state.archive.length === 1);
}

// ─────────────────────── 7. Seguridad / validación / cero estados imposibles ───────────────────────
console.log("\n## Seguridad / cero estados imposibles");
{
  const e = new PassEngine(fresh().gainXp(S.xpPerLevel * 5, 1).state, S);
  e.claimReward(1, "free", 1); e.claimReward(2, "free", 1);
  check("VALIDACIÓN: estado sano ⇒ ok", e.validateSeason().ok);
  // Estado corrupto: doble claim + premium sin desbloqueo + nivel imposible.
  const bad = new PassEngine({ ...freshPassState(S.id), xp: -100, claimedFree: [1, 1, 999], claimedPremium: [1], premium: false }, S);
  const v = bad.validateSeason();
  check("SEGURIDAD: detecta XP negativa / doble claim / claim>nivel / premium sin desbloqueo", !v.ok && v.issues.length >= 3);
  check("INTEGRIDAD: reclamar en pase vacío no muta ni lanza", (() => { const f = fresh(); const before = JSON.stringify(f.snapshot()); const r = f.claimReward(5, "free", 1); return !r.ok && JSON.stringify(f.snapshot()) === before; })());
}

// ─────────────────────── 8. Migraciones ───────────────────────
console.log("\n## Migraciones");
{
  const m = migratePassState({ xp: 3200, claimedFree: [1, 1, 2, -3], premium: true, missions: [{ id: "x", metric: "packs_opened", goal: 3, baseline: 0, kind: "daily", claimed: false, assignedAt: 0 }, null], archive: [{ seasonId: "old", name: "Old", level: 4, xp: 100, claimedFree: 2, claimedPremium: 0, premium: false, missionsCompleted: 3, endedAt: 0 }] }, S.id);
  check("MIGRACIÓN: sanea claims (sin duplicados/negativos), misiones y conserva archive", m.version >= 1 && m.claimedFree.length === 2 && m.missions.length === 1 && m.archive.length === 1);
  check("MIGRACIÓN: nulo ⇒ pase fresco", migratePassState(null, S.id).xp === 0);
}

// ─────────────────────── 9. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const build = () => { const e = fresh(); e.refreshMissions("daily", 3, {}, makeRng(7), 1); e.gainXp(2500, 1); return JSON.stringify(e.snapshot()); };
  check("DETERMINISMO: mismas entradas/semilla ⇒ mismo estado", build() === build());
}

// ─────────────────────── 10. Rendimiento (100k jugadores · 100 temporadas · 10M misiones) ───────────────────────
console.log("\n## Rendimiento (100k jugadores · 100 temporadas · 10M misiones)");
{
  // 100k jugadores: crear + ganar XP + reclamar (independiente, O(1)).
  const t0 = Date.now();
  let totalLevels = 0;
  for (let i = 0; i < 100000; i++) { const e = fresh(); e.setAutoClaim(true); e.gainXp(1000 + (i % 50) * 1000, 1); totalLevels += e.level(); }
  const playersMs = Date.now() - t0;
  // 100 temporadas encadenadas (archive + soft reset) en un jugador.
  const t1 = Date.now();
  let e = fresh();
  for (let s = 0; s < 100; s++) { e.gainXp(50000, 1); e = new PassEngine(e.advanceSeason(`s${s + 2}`, s).state, S); }
  const seasonsMs = Date.now() - t1;
  const archived = e.snapshot().archive.length;
  // 10M evaluaciones de misión (progreso O(1)).
  const t2 = Date.now();
  const mm = { id: "m", kind: "daily" as const, metric: "packs_opened", goal: 10, baseline: 0, claimed: false, assignedAt: 0 };
  let acc = 0;
  const run = (ops: number) => { const s = Date.now(); for (let i = 0; i < ops; i++) acc += missionProgress(mm, { packs_opened: i % 12 }); return Date.now() - s; };
  const q1 = run(5_000_000), q2 = run(10_000_000);
  const ratio = q2 / Math.max(1, q1);
  check("RENDIMIENTO: 100k jugadores + 100 temporadas + 10M misiones, escala LINEAL (no O(n²))",
    playersMs < 6000 && seasonsMs < 1000 && archived === 100 && ratio < 2.6 && acc >= 0,
    `100k jugadores=${playersMs}ms · 100 temporadas=${seasonsMs}ms · misiones 5M=${q1}/10M=${q2} ratio=${ratio.toFixed(2)}`);
  void totalLevels;
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
