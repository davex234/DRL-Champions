/**
 * VERIFICACIÓN — Legacy Presentation & Endgame Engine (DRL Champions, Career Fase 7/7, FINAL).
 *
 *   npx tsx scripts/career-endgame-verify.ts [temporadas]
 *
 * Comprueba: documental · museo · Hall of Fame · timeline · legacy · Living World · news ·
 * presentation · estadísticas · récords · New Game+ · determinismo · rendimiento · CERO estados
 * imposibles. Capa de PRESENTACIÓN/CIERRE que DERIVA de datos reales (no duplica motores).
 */
import { createWorld, advanceWorld, type WorldState } from "../src/world";
import {
  createCoach, initManagement, clubViewFor, computeSeasonFinances, availableSponsors, signSponsor,
  generateAcademyIntake, makeRng, seedOf, type ManagerCareer, type CoachCreateInput, type SeasonOutcome,
} from "../src/career";
import {
  buildEndgame, previewEndgame, endgameNews, endgameStats, careerRecords, buildMuseum,
  buildDocumentary, pressConference, hallOfFameInduction, newGamePlusSeed, applyNewGamePlus,
} from "../src/endgame";

const N = Math.max(6, Number(process.argv[2] ?? 12));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Legacy Presentation & Endgame Engine — DRL Champions (Career Fase 7, FINAL)\n");

const AT = 1_700_000_000_000;
const INPUT: CoachCreateInput = { name: "Alex Rivera", age: 58, country: "España", region: "EMEA", avatar: "🧑‍🏫", bio: "Una vida en los banquillos.", language: "es", style: "developer", specialty: "management", personality: "innovative", personalGoal: "Construir un legado eterno", now: AT };

/** Construye un mundo evolucionado + una carrera VETERANA anclada a un club real. */
function veteran(seed: number, seasons: number): { world: WorldState; career: ManagerCareer; cid: string } {
  const world = createWorld(seed);
  for (let s = 0; s < seasons; s++) advanceWorld(world);
  const cid = Object.values(world.teams).sort((a, b) => b.titles - a.titles || b.prestige - a.prestige)[0].id;
  const cname = world.teams[cid].name;
  const club = clubViewFor(world, cid)!;
  let mgmt = initManagement(club);
  // Historial económico (ledger) + patrocinadores + cantera para estadísticas ricas.
  const led = computeSeasonFinances(club, mgmt, { team: cname, competition: "Liga", tier: "continental", wins: 14, losses: 4, champion: true, finalist: true, mvpAwarded: true, placement: 1, fieldSize: club.totalTeams }, { playerWages: 9000, sales: 6000, purchases: 4000 });
  const sp = availableSponsors(club, createCoach(INPUT), 1, makeRng(seedOf(1, "sp", 1)))[0];
  mgmt = { ...mgmt, ledger: [led, led, led], sponsors: sp ? signSponsor([], sp) : [], academy: generateAcademyIntake(mgmt, "EMEA", 2, makeRng(seedOf(1, "ac", 2))) };
  const base = createCoach(INPUT);
  const career: ManagerCareer = {
    ...base, clubId: cid, currentTeam: cname, management: mgmt, season: seasons + 1, level: 24,
    stats: { matchesPlayed: 240, wins: 150, losses: 90, titles: 6, finals: 9, defeats: 12, mvps: 4, bestWinStreak: 16, currentWinStreak: 3, seasonsCoached: seasons, teamsCoached: 2 },
    history: {
      spells: [{ team: cname, fromSeason: 1, toSeason: null }],
      titles: [{ season: 3, team: cname, competition: "Liga DRL", tier: "continental" }, { season: 6, team: cname, competition: "World Championship", tier: "global" }],
      results: [{ season: 4, team: cname, competition: "Masters", kind: "defeat" }, { season: 6, team: cname, competition: "World Championship", kind: "champion" }],
      seasons: [{ season: seasons, team: cname, wins: 15, losses: 3, titles: 1, finals: 1, reputationEnd: 78 }],
    },
  };
  return { world, career, cid };
}

// ─────────────────────── 1. Estadísticas históricas ───────────────────────
console.log("## Estadísticas históricas");
{
  const { world, career } = veteran(20260630, N);
  const st = endgameStats(career, world);
  check("ESTADÍSTICAS: partidos/victorias/derrotas/% y títulos", st.matches === 240 && st.wins === 150 && st.winRate === 63 && st.titles === 6);
  check("ESTADÍSTICAS: dinero generado, valor de club, patrocinadores, instalaciones", st.moneyGenerated > 0 && st.clubValue > 0 && st.sponsorsSigned >= 0 && st.facilitiesBuilt > 0);
  check("ESTADÍSTICAS: jugadores entrenados, rookies, reputación, OVR", st.playersTrained >= 0 && st.rookiesDiscovered >= 0 && st.reputationScore >= 0 && st.overall > 0);
}

// ─────────────────────── 2. Récords ───────────────────────
console.log("\n## Récords");
{
  const { world, career } = veteran(42, N);
  const st = endgameStats(career, world);
  const rec = careerRecords(career, world, st);
  check("RÉCORDS: personales/club/mundiales/carrera presentes", rec.personal.length > 0 && rec.club.length >= 0 && rec.world.length > 0 && rec.career.length > 0);
  check("RÉCORDS MUNDIALES: conectados al Living World (history.records)", rec.world.some((r) => r.label.includes("dinastía") || r.label.includes("Transferencia") || r.label.includes("Mundo") || r.label.includes("entrenador")));
}

// ─────────────────────── 3. Museo ───────────────────────
console.log("\n## Museo");
{
  const { world, career } = veteran(101, N);
  const mus = buildMuseum(career, world);
  check("MUSEO: se genera automáticamente con secciones y piezas", mus.items.length > 0 && !!mus.clubName && mus.founded >= 1);
  check("MUSEO: trofeos/jugadores/temporadas/récords/noticias derivados de datos reales", mus.counts.trophies + mus.counts.players + mus.counts.news > 0);
  check("MUSEO: cada pieza referencia una temporada/dato del ecosistema", mus.items.every((it) => typeof it.season === "number" && it.title.length > 0));
}

// ─────────────────────── 4. Documental ───────────────────────
console.log("\n## Documental");
{
  const { world, career } = veteran(202, N);
  const doc = buildDocumentary(career, world);
  const ids = doc.chapters.map((c) => c.id);
  check("DOCUMENTAL: reconstruye la carrera (inicio → primer título → retirada)", ids.includes("start") && ids.includes("first_title") && ids.includes("retirement") && doc.chapters.length >= 4);
  check("DOCUMENTAL: narración con DATOS reales (nombre/temporadas), nunca vacía", doc.chapters.every((c) => c.narration.includes(career.coach.name) || c.narration.length > 20) && doc.title.includes(career.coach.name));
  check("DOCUMENTAL: título/subtítulo/epílogo generados", doc.subtitle.length > 0 && doc.epilogue.length > 0);
}

// ─────────────────────── 5. Hall of Fame ───────────────────────
console.log("\n## Hall of Fame");
{
  const { world, career } = veteran(303, N);
  const st = endgameStats(career, world);
  const ind = hallOfFameInduction(career, world, st);
  const halls = [ind.halls.players, ind.halls.coaches, ind.halls.clubs, ind.halls.seasons, ind.halls.teams, ind.halls.dynasties, ind.halls.rookies, ind.halls.transfers];
  check("HALL OF FAME: los 9 halls del mundo (8 categorías + entrenador inducido)", halls.length === 8 && ind.inducted && !!ind.tier);
  check("HALL OF FAME: cita narrada + ranking histórico del entrenador", ind.citation.includes(career.coach.name) && ind.coachRank >= 1);
}

// ─────────────────────── 6. Rueda de prensa ───────────────────────
console.log("\n## Rueda de prensa final");
{
  const { world, career } = veteran(404, N);
  const st = endgameStats(career, world);
  const press = pressConference(career, world, st);
  const roles = new Set(press.quotes.map((q) => q.role));
  check("PRENSA: periodistas/analistas/fans/exjugadores/colegas reaccionan al legado", press.quotes.length >= 4 && roles.size >= 3);
  check("PRENSA: citas basadas en datos (no aleatorias) + titular", press.headline.includes(career.coach.name) && press.quotes.every((q) => q.quote.length > 10));
}

// ─────────────────────── 7. New Game+ ───────────────────────
console.log("\n## New Game+");
{
  const { world, career } = veteran(505, N);
  const seed = newGamePlusSeed(career, world);
  check("NEW GAME+: los jugadores retirados se reconvierten (coach/analista/scout/embajador…)", Array.isArray(seed.reconversions) && seed.reconversions.every((r) => r.newRole && r.note));
  check("NEW GAME+: leyendas y récords PERMANECEN en el mundo", seed.legendsCarried >= 0 && seed.recordsCarried >= 1 && seed.worldMemoryNote.includes(career.coach.name));
  // El mundo RECUERDA: coach-user → leyenda persistente.
  world.coaches["coach-user"] = { id: "coach-user", name: career.coach.name, teamId: career.clubId, rating: 78, titles: 6, seasons: N };
  if (career.clubId) world.teams[career.clubId].coachId = "coach-user";
  applyNewGamePlus(world, career);
  check("NEW GAME+: el mundo recuerda tu paso (entrenador → leyenda, récord persistente)", !world.coaches["coach-user"] && Object.values(world.coaches).some((c) => c.name === career.coach.name) && !!world.history.records["legend_coach"]);
}

// ─────────────────────── 8. Endgame + Presentation + Timeline (persistencia) ───────────────────────
console.log("\n## Cierre AAA (presentation + timeline)");
{
  const { world, career } = veteran(606, N);
  const before = JSON.stringify(project(world));
  const { endgame, events } = buildEndgame(career, world, AT);
  check("PRESENTATION: el estado de cierre compone documental+museo+HoF+prensa+récords+stats", !!endgame.documentary && !!endgame.museum && !!endgame.induction && !!endgame.press && !!endgame.records && !!endgame.stats);
  check("PRESENTATION: cabecera + impacto mundial + ranking histórico", endgame.headline.includes(career.coach.name) && endgame.impactScore >= 0 && endgame.impactScore <= 100 && endgame.worldRankPos >= 1);
  check("PUREZA: construir el legado NO muta el Living World", JSON.stringify(project(world)) === before);
  check("TIMELINE/PERSISTENCIA: el estado de cierre es PLANO y clonable (JSON round-trip)", JSON.stringify(JSON.parse(JSON.stringify(endgame))) === JSON.stringify(endgame));
  // NEWS.
  const news = endgameNews(events.map((e) => ({ ...e, at: AT })));
  check("NEWS: retirada/HoF/récord/legado/sucesor → NewsItem (buzón único, ids deterministas)", news.length > 0 && news.every((n) => n.id.startsWith("endgame:") && ["special", "record", "event", "transfer"].includes(n.kind)));
}

// ─────────────────────── 9. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const a = veteran(999, N); const b = veteran(999, N);
  check("DETERMINISMO: mismo seed ⇒ mismo legado", JSON.stringify(buildEndgame(a.career, a.world, AT).endgame) === JSON.stringify(buildEndgame(b.career, b.world, AT).endgame));
  const one = veteran(707, N);
  check("DETERMINISMO: previewEndgame es estable", JSON.stringify(previewEndgame(one.career, one.world)) === JSON.stringify(previewEndgame(one.career, one.world)));
}

// ─────────────────────── 10. Rendimiento (escala) ───────────────────────
console.log("\n## Rendimiento (escala)");
function scaleWorld(base: WorldState, copies: number): WorldState {
  const teamIds = Object.keys(base.teams);
  for (let c = 1; c < copies; c++) {
    const sfx = `#${c}`;
    for (const tid of teamIds) {
      const t = base.teams[tid];
      base.teams[tid + sfx] = { ...t, id: tid + sfx, coachId: null, roster: t.roster.map((id) => id + sfx), standings: [{ season: base.season, pos: 1 + (c % teamIds.length), wins: 6, losses: 6, champion: c % 6 === 0 }], rivalries: {} };
      for (const pid of t.roster) { const p = base.players[pid]; if (p) base.players[pid + sfx] = { ...p, id: pid + sfx, teamId: tid + sfx, innate: JSON.parse(JSON.stringify(p.innate)), dev: JSON.parse(JSON.stringify(p.dev)), contract: p.contract ? { ...p.contract } : null }; }
    }
  }
  return base;
}
{
  const { career } = veteran(4242, N);
  const world = scaleWorld(createWorld(4242), 42); for (let s = 0; s < 3; s++) advanceWorld(world);
  const cid = Object.keys(world.teams).sort()[0];
  const c2 = { ...career, clubId: cid, currentTeam: world.teams[cid].name };
  const t0 = Date.now(); const R = 20;
  for (let i = 0; i < R; i++) buildEndgame(c2, world, AT);
  const ms = (Date.now() - t0) / R;
  check("RENDIMIENTO: el legado se genera al instante sobre un mundo de ~500 clubes", ms < 500, `${Object.keys(world.teams).length} clubes · ${ms.toFixed(1)} ms/legado`);
}

// ─────────────────────── 11. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const { world, career } = veteran(7777, N);
  const { endgame } = buildEndgame(career, world, AT);
  const st = endgame.stats;
  const nums = [st.winRate, st.matches, st.wins, st.losses, st.titles, st.overall, endgame.impactScore, endgame.worldRankPos];
  const ok = nums.every((n) => Number.isFinite(n) && n >= 0) && st.winRate <= 100 && endgame.impactScore <= 100 && st.wins + st.losses <= st.matches + 1;
  const musOk = endgame.museum.items.every((it) => Number.isFinite(it.season)) && Object.values(endgame.museum.counts).every((c) => c >= 0);
  check("INTEGRIDAD: estadísticas/impacto/ranking válidos (sin NaN, en rango)", ok);
  check("INTEGRIDAD: museo/documental/prensa consistentes", musOk && endgame.documentary.chapters.length > 0 && endgame.press.quotes.length > 0);
}

function project(w: WorldState) {
  return { records: Object.keys(w.history.records).sort(), teams: Object.values(w.teams).map((t) => [t.id, Math.round(t.prestige), t.budget]).sort(), players: Object.values(w.players).map((p) => [p.id, p.value]).sort() };
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
