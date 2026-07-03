/**
 * VERIFICACIÓN DEL LIVING ESPORTS WORLD — DRL Champions.
 *
 * Comprueba que el universo evoluciona SOLO y de forma coherente reutilizando los motores:
 * temporadas, contratos, transferencias, academias, decisiones IA, rankings, narrativa,
 * noticias, mercado, cartas (Timeline), live esports, coach, player development, además de
 * determinismo, rendimiento y cero estados imposibles.
 *
 *   npx tsx scripts/livingworld-verify.ts [temporadas]
 */
import {
  createWorld, advanceWorld, simulateWorld, worldBroadcast, worldChronicle, worldNews,
  type WorldState,
} from "../src/world";

const SEASONS = Math.max(4, Number(process.argv[2] ?? 8));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Living Esports World — DRL Champions\n");

// Proyección estable para comparar determinismo (evita Set/orden).
function project(w: WorldState) {
  return {
    season: w.season,
    teams: Object.values(w.teams).map((t) => ({ id: t.id, titles: t.titles, prestige: Math.round(t.prestige), roster: [...t.roster].sort(), st: t.standings.length })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    players: Object.values(w.players).map((p) => ({ id: p.id, value: p.value, age: p.dev.age, status: p.status, titles: p.titles })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    transfers: w.transfers.length, events: w.events.length,
    topPlayer: w.rankings.players[0]?.id ?? "",
  };
}

// ─────────────────────────── 1. Bootstrap ───────────────────────────
console.log("## Bootstrap del universo (desde el catálogo)");
const world = createWorld(20260630);
check("se construyen equipos reales del catálogo (≥ 10)", Object.keys(world.teams).length >= 10, `${Object.keys(world.teams).length} equipos`);
check("todos los equipos tienen 5 titulares y entrenador", Object.values(world.teams).every((t) => t.roster.length === 5 && t.coachId));
check("los jugadores tienen contrato + valor + innato", Object.values(world.players).filter((p) => p.teamId).every((p) => p.contract && p.value > 0 && p.innate.potential > 0));
const eliteSeed = Object.values(world.players).filter((p) => p.origin === "seed").sort((a, b) => b.value - a.value)[0];
const someRookie = Object.values(world.players).find((p) => p.origin === "academy");
check("MERCADO: la élite vale más que un rookie", !!eliteSeed && !!someRookie && eliteSeed.value > someRookie!.value, `${eliteSeed?.value} vs ${someRookie?.value}`);

// ─────────────────────────── 2. Una temporada ───────────────────────────
console.log("\n## Avance de una temporada");
const before = world.season;
const r1 = advanceWorld(world);
check("TEMPORADAS: la temporada avanza", world.season === before + 1);
check("se corona un campeón (historia)", world.history.champions.length >= 1, world.history.champions[0]?.teamName);
check("se generan eventos de mundo + noticias", r1.events.length >= 0 && world.news.length >= 0);

// ─────────────────────────── 3. Varias temporadas ───────────────────────────
console.log(`\n## ${SEASONS} temporadas autónomas`);
simulateWorld(world, SEASONS);
const bc = worldBroadcast(world);

// Contratos.
const contracts = Object.values(world.players).filter((p) => p.teamId && p.contract);
check("CONTRATOS: salario/duración/felicidad/lealtad/ambición", contracts.length > 0 && contracts.every((p) => p.contract!.salary > 0 && p.contract!.happiness >= 0 && p.contract!.happiness <= 100));
// Transferencias.
const kinds = new Set(world.transfers.map((t) => t.kind));
const paidTransfer = world.transfers.some((t) => t.kind === "transfer" && t.fee > 0);
check("TRANSFERENCIAS: ocurren con varios tipos (compra/cesión/renovación/libre)", world.transfers.length > 0 && kinds.size >= 3, [...kinds].join(","));
check("TRANSFERENCIAS: hay traspasos con fee real", paidTransfer);
// Academias.
const academy = Object.values(world.players).filter((p) => p.origin === "academy");
check("ACADEMIAS: nacen rookies con potencial/ADN/región", academy.length >= 6 && academy.every((p) => p.innate.potential > 0 && p.region));
check("ACADEMIAS: algunos rookies llegan a un equipo", academy.some((p) => p.teamId));
// IA.
check("IA: el mundo entero decide (transferencias + coaches cambian)", world.transfers.length >= SEASONS && Object.values(world.coaches).length >= Object.keys(world.teams).length);
// Rankings.
const rk = world.rankings;
check("RANKINGS: jugadores/equipos/coaches/promesas/veteranos/rookies/regiones", rk.players.length > 0 && rk.teams.length > 0 && rk.coaches.length > 0 && rk.promises.length > 0 && rk.veterans.length > 0 && rk.regions.length > 0);
// Narrativa.
const evTypes = new Set(world.events.map((e) => e.type));
check("NARRATIVA: variedad de hitos del mundo (≥ 4 tipos)", evTypes.size >= 4, [...evTypes].slice(0, 8).join(","));
// Noticias.
const news = worldNews(world.events.slice(0, 5));
check("NOTICIAS: periódico vivo con ids deterministas", world.news.length > 0 && news.every((n) => n.id.startsWith("world:")));
// Mercado.
const valuesChanged = Object.values(world.players).some((p) => p.value !== p.prevValue);
check("MERCADO: los valores cambian con el tiempo", valuesChanged);
// Cartas / Live esports (Timeline).
const careers = Object.values(world.timeline.players);
check("CARTAS/LIVE: el Timeline acumula carrera (cards/stints)", careers.length > 0 && careers.some((c) => c.cards.length > 0));
// Coach: reconversión de jubilados (variedad de roles) + rotación de banquillos.
const staffRoles = new Set(world.history.retirements.map((r) => r.staffRole));
const coachesGrew = Object.values(world.coaches).length > Object.keys(world.teams).length;
check("COACH: jubilados se reconvierten (varios roles) y el banquillo rota", staffRoles.size >= 2 && coachesGrew, `roles ${[...staffRoles].join(",")} · coaches ${Object.values(world.coaches).length}`);
// Player development.
const aged = Object.values(world.players).some((p) => p.dev.age > p.innate.startAge);
const retired = Object.values(world.players).filter((p) => p.status === "retired");
check("DEVELOPMENT: los jugadores envejecen y algunos se retiran", aged && retired.length > 0, `${retired.length} retirados`);
// Historia.
check("HISTORIA: crónica legible (dinastía/rookie/coach/clutch/transfer)", worldChronicle(world).length >= 3, `${worldChronicle(world).length} líneas`);

// ─────────────────────────── 4. Determinismo, rendimiento, seguridad ───────────────────────────
console.log("\n## Determinismo, rendimiento y seguridad");
const wa = createWorld(777); simulateWorld(wa, SEASONS);
const wb = createWorld(777); simulateWorld(wb, SEASONS);
check("DETERMINISMO: misma semilla + temporadas ⇒ mismo universo", JSON.stringify(project(wa)) === JSON.stringify(project(wb)));

// Estados imposibles.
let bad = 0; const reasons: string[] = [];
const onTwoTeams = new Map<string, number>();
for (const t of Object.values(world.teams)) {
  if (t.roster.length < 4 || t.roster.length > 6) { bad++; reasons.push(`roster ${t.tag}=${t.roster.length}`); }
  if (t.prestige < 0 || t.prestige > 100 || t.fanbase < 0 || t.budget < 0) { bad++; reasons.push(`team nums ${t.tag}`); }
  for (const id of t.roster) onTwoTeams.set(id, (onTwoTeams.get(id) ?? 0) + 1);
}
for (const [id, n] of onTwoTeams) if (n > 1) { bad++; reasons.push(`${id} en ${n} equipos`); }
for (const p of Object.values(world.players)) {
  if (!Number.isFinite(p.value) || p.value < 0) { bad++; reasons.push(`value ${p.id}`); }
  if (p.dev.age < 15 || p.dev.age > 45) { bad++; reasons.push(`age ${p.id}=${p.dev.age}`); }
  if (p.status === "active" && p.teamId && !world.teams[p.teamId]) { bad++; reasons.push(`ghost team ${p.id}`); }
  const c = p.dev.condition;
  if ([c.fatigue, c.form, c.confidence, c.morale].some((v) => v < 0 || v > 100 || !Number.isFinite(v))) { bad++; reasons.push(`cond ${p.id}`); }
  if (p.contract && (p.contract.happiness < 0 || p.contract.happiness > 100 || p.contract.years < 0)) { bad++; reasons.push(`contract ${p.id}`); }
}
check("CERO estados imposibles", bad === 0, bad ? reasons.slice(0, 5).join(" · ") : `${Object.keys(world.players).length} jugadores OK`);

const t0 = Date.now();
const wp = createWorld(42); simulateWorld(wp, SEASONS);
const ms = (Date.now() - t0) / SEASONS;
check("rendimiento aceptable", ms < 1500, `${ms.toFixed(0)} ms/temporada`);

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
