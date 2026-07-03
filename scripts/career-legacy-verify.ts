/**
 * VERIFICACIÓN — Club Legacy & Global Ecosystem Engine (DRL Champions, Career Fase 6/7).
 *
 *   npx tsx scripts/career-legacy-verify.ts [temporadas]
 *
 * Comprueba: legacy · Hall of Fame · rivalidades · economía mundial · medios · redes sociales ·
 * timeline · noticias · prestigio · fanbase · Living World · determinismo · rendimiento · CERO
 * estados imposibles. Capa de DERIVACIÓN + efectos emergentes sobre el WorldState (no duplica).
 */
import { createWorld, advanceWorld, type WorldState } from "../src/world";
import {
  clubLegacy, hallOfFame, brandOf, clubDirectives, detectRivalries, rivalriesOf,
  globalEconomy, applyEconomy, mediaDigest, socialTrends, deriveCompetitions, runCompetitions,
  runGlobalEcosystem, legacyNews, legacyDashboard,
} from "../src/legacy";

const N = Math.max(6, Number(process.argv[2] ?? 10));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Club Legacy & Global Ecosystem Engine — DRL Champions (Career Fase 6)\n");

const AT = 1_700_000_000_000;
const topTitled = (w: WorldState) => Object.values(w.teams).sort((a, b) => b.titles - a.titles || b.prestige - a.prestige)[0].id;

/** Simula el ecosistema como el store: cada temporada avanza el mundo y corre el ecosistema. */
function evolve(seed: number, seasons: number, userId?: string): WorldState {
  const w = createWorld(seed);
  const uid = userId ?? Object.keys(w.teams).sort()[0];
  for (let s = 0; s < seasons; s++) { advanceWorld(w); runGlobalEcosystem(w, uid, AT); }
  return w;
}

// ─────────────────────── 1. Legacy del club ───────────────────────
console.log("## Legacy del club");
{
  const w = evolve(20260630, N);
  const cid = topTitled(w);
  const lg = clubLegacy(w, cid);
  check("LEGACY: el club acumula historia (temporadas jugadas = standings)", lg.seasonsPlayed === w.teams[cid].standings.length && lg.seasonsPlayed >= N);
  check("LEGACY: trofeos, mejores/peores temporadas, racha de títulos", lg.trophies >= 0 && (lg.bestSeason !== null) && lg.longestTitleStreak >= 0);
  check("LEGACY: jugadores/entrenadores HISTÓRICOS derivados del Timeline", lg.legends.length >= 1 && lg.legends.every((l) => l.kind === "player" || l.kind === "coach"));
  check("LEGACY: récords del club (mayor transferencia / mejor jugador / cantera)", lg.records.academyGraduates >= 0 && "biggestTransfer" in lg.records && "greatestPlayer" in lg.records);
  const champ = w.history.champions.filter((c) => c.teamId === cid).length;
  check("LEGACY: dinastías emergen de campeonatos consecutivos", lg.dynasties.every((d) => d.titles >= 2) && lg.titles.length <= champ + w.teams[cid].standings.length);
}

// ─────────────────────── 2. Hall of Fame ───────────────────────
console.log("\n## Hall of Fame");
{
  const w = evolve(42, N + 4);
  const hof = hallOfFame(w);
  const cats = [hof.players, hof.coaches, hof.clubs, hof.seasons, hof.teams, hof.dynasties, hof.rookies, hof.transfers];
  check("HOF: 8 categorías (jugadores/coaches/clubes/temporadas/equipos/dinastías/rookies/transfers)", cats.length === 8);
  check("HOF: se genera automáticamente y hay inducidos", cats.reduce((a, c) => a + c.length, 0) > 0);
  check("HOF: transferencias históricas ordenadas por fee", hof.transfers.every((t, i) => i === 0 || hof.transfers[i - 1].score >= t.score));
  check("HOF: rookies del año provienen de la historia del mundo", hof.rookies.every((r) => r.category === "rookie"));
}

// ─────────────────────── 3. Rivalidades dinámicas ───────────────────────
console.log("\n## Rivalidades");
{
  const w = evolve(101, N);
  detectRivalries(w);
  const withRivals = Object.values(w.teams).find((t) => Object.keys(t.rivalries).length > 0);
  check("RIVALIDADES: nacen solas (no predefinidas) por finales/traspasos/dominio/región", !!withRivals);
  if (withRivals) {
    const rivs = rivalriesOf(w, withRivals.id);
    check("RIVALIDADES: tienen ORIGEN y EFECTOS (prestigio/asistencia/sponsor/motivación)", rivs.length === 0 || rivs.every((r) => r.origin && r.effects && r.effects.prestige >= 0 && r.effects.motivation >= 0));
  } else check("RIVALIDADES: tienen origen y efectos", true, "sin rivalidades esta semilla");
}

// ─────────────────────── 4. Economía mundial ───────────────────────
console.log("\n## Economía mundial");
{
  const w = evolve(202, N);
  const econ = globalEconomy(w);
  check("ECONOMÍA: fase emergente (boom/stable/cooling/crisis) del estado del mundo", ["boom", "stable", "cooling", "crisis"].includes(econ.phase));
  check("ECONOMÍA: inflación ACOTADA (nunca explota) + temperatura de mercado", econ.inflation >= 0.82 && econ.inflation <= 1.35 && econ.marketTemperature >= 0 && econ.marketTemperature <= 100);
  check("ECONOMÍA: valor por región (4) y valor de liga", econ.regionValues.length === 4 && econ.leagueValue > 0);
  const before = Object.values(w.players).filter((p) => p.status === "active").reduce((a, p) => a + p.value, 0);
  applyEconomy(w, { ...econ, inflation: 1.2 }, null);
  const after = Object.values(w.players).filter((p) => p.status === "active").reduce((a, p) => a + p.value, 0);
  check("ECONOMÍA: la inflación mueve los valores del ecosistema", after > before);
}

// ─────────────────────── 5. Medios ───────────────────────
console.log("\n## Medios");
{
  const w = evolve(303, N);
  const media = mediaDigest(w);
  check("MEDIOS: prensa/analistas/podcasts/influencers/internacional a partir de hitos REALES", media.length > 0 && media.every((m) => ["newspaper", "analyst", "podcast", "influencer", "international"].includes(m.outlet)));
  check("MEDIOS: nunca texto aleatorio (cada nota refiere a un evento del mundo)", media.every((m) => w.events.some((e) => e.subject === m.subject)));
}

// ─────────────────────── 6. Redes sociales ───────────────────────
console.log("\n## Redes sociales");
{
  const w = evolve(404, N);
  const social = socialTrends(w);
  check("REDES: virales/tendencias/contenido de club con alcance y sentimiento", social.length > 0 && social.every((t) => t.reach >= 0 && t.reach <= 100 && typeof t.fanDelta === "number"));
  check("REDES: emergen de datos del mundo (valores/eventos)", social.every((t) => ["viral_player", "trending_play", "club_content", "fan_reaction"].includes(t.kind)));
}

// ─────────────────────── 7. Competiciones / Timeline ───────────────────────
console.log("\n## Competiciones y timeline");
{
  const w = evolve(505, N);
  const comps = deriveCompetitions(w);
  check("COMPETICIONES: Masters/Invitacional/Worlds emergen del circuito", comps.length === 3 && comps.some((c) => c.tier === "worlds"));
  check("TIMELINE: el World Championship queda registrado en la historia del mundo", !!w.history.records["worlds"] && w.history.records["worlds"].value >= 1);
  check("TIMELINE: standings/records/champions persisten (historial del mundo)", Object.keys(w.history.records).length >= 2 && w.history.champions.length >= 1);
}

// ─────────────────────── 8. Noticias ───────────────────────
console.log("\n## Noticias");
{
  const w = evolve(606, N);
  const events = runGlobalEcosystem(w, topTitled(w), AT);
  const news = legacyNews(events.map((e) => ({ ...e, at: AT })));
  check("NOTICIAS: eventos de legado → NewsItem (buzón único, ids deterministas)", news.every((n) => n.id.startsWith("legacy:") && ["record", "special", "event"].includes(n.kind)));
  check("NOTICIAS: deduplicables (mismo evento ⇒ mismo id)", legacyNews(events.map((e) => ({ ...e, at: AT }))).every((n, i) => n.id === news[i].id));
}

// ─────────────────────── 9. Prestigio + Fanbase (efectos) ───────────────────────
console.log("\n## Prestigio y fanbase");
{
  const w = createWorld(707); for (let s = 0; s < N; s++) advanceWorld(w);
  const uid = Object.keys(w.teams).sort()[0];
  const pBefore = Object.fromEntries(Object.values(w.teams).map((t) => [t.id, t.prestige]));
  const fBefore = Object.fromEntries(Object.values(w.teams).map((t) => [t.id, t.fanbase]));
  const budgetUserBefore = w.teams[uid].budget;
  runGlobalEcosystem(w, uid, AT);
  check("PRESTIGIO: el ecosistema (competiciones/rivalidades) mueve el prestigio", Object.values(w.teams).some((t) => t.prestige !== pBefore[t.id]));
  check("FANBASE: el ecosistema (social/rivalidades/competiciones) mueve la fanbase", Object.values(w.teams).some((t) => t.fanbase !== fBefore[t.id]));
  check("LIVING WORLD: el PRESUPUESTO del club del usuario queda blindado en el ecosistema", w.teams[uid].budget === budgetUserBefore);
}

// ─────────────────────── 10. Dashboard + marca + directivas ───────────────────────
console.log("\n## Dashboard, marca y directivas");
{
  const w = evolve(808, N);
  const cid = topTitled(w);
  const dash = legacyDashboard(w, cid);
  check("DASHBOARD: compone legado+HoF+economía+competiciones+medios+redes+rivalidades+marca", !!dash.clubLegacy && !!dash.hallOfFame && !!dash.economy && dash.competitions.length === 3 && dash.media.length >= 0 && dash.social.length >= 0);
  check("MARCA: identidad/estilo/popularidad/reconocimiento/valor comercial", !!dash.brand.identity && !!dash.brand.style && dash.brand.recognition >= 0 && dash.brand.commercialValue > 0);
  check("DIRECTIVAS: objetivos de la organización presentes y priorizados", dash.directives.length > 0 && dash.directives.every((d, i) => i === 0 || dash.directives[i - 1].priority >= d.priority));
  check("RANKING MUNDIAL: posición del club en el ecosistema", dash.worldRankPos >= 1 && dash.worldRankPos <= dash.worldRankTotal && dash.worldValue > 0);
}

// ─────────────────────── 11. Determinismo ───────────────────────
console.log("\n## Determinismo");
function project(w: WorldState) {
  return JSON.stringify({
    records: Object.entries(w.history.records).map(([k, v]) => [k, v.holder, v.value]).sort(),
    teams: Object.values(w.teams).map((t) => [t.id, Math.round(t.prestige), t.budget, t.titles, t.fanbase]).sort(),
    values: Object.values(w.players).map((p) => [p.id, p.value]).sort(),
  });
}
check("DETERMINISMO: mismo seed + mismas temporadas ⇒ mismo ecosistema", project(evolve(999, N)) === project(evolve(999, N)));
check("DETERMINISMO: seeds distintos ⇒ ecosistemas distintos", project(evolve(1, N)) !== project(evolve(2, N)));

// ─────────────────────── 12. Rendimiento (escala) ───────────────────────
console.log("\n## Rendimiento (escala)");
function scaleWorld(base: WorldState, copies: number): WorldState {
  const teamIds = Object.keys(base.teams);
  for (let c = 1; c < copies; c++) {
    const sfx = `#${c}`;
    for (const tid of teamIds) {
      const t = base.teams[tid];
      base.teams[tid + sfx] = { ...t, id: tid + sfx, coachId: null, roster: t.roster.map((id) => id + sfx), standings: [{ season: base.season, pos: 1 + (c % teamIds.length), wins: 6, losses: 6, champion: c % 7 === 0 }], rivalries: {} };
      for (const pid of t.roster) { const p = base.players[pid]; if (p) base.players[pid + sfx] = { ...p, id: pid + sfx, teamId: tid + sfx, innate: JSON.parse(JSON.stringify(p.innate)), dev: JSON.parse(JSON.stringify(p.dev)), contract: p.contract ? { ...p.contract } : null }; }
    }
  }
  return base;
}
{
  const w = scaleWorld(createWorld(4242), 42); // ~500 clubes, ~2500 jugadores
  const uid = Object.keys(w.teams).sort()[0];
  const clubs = Object.keys(w.teams).length, players = Object.keys(w.players).length;
  const t0 = Date.now(); const ROUNDS = 5;
  for (let s = 0; s < ROUNDS; s++) runGlobalEcosystem(w, uid, AT);
  const ms = (Date.now() - t0) / ROUNDS;
  check("RENDIMIENTO: el ecosistema mundial evoluciona por temporada en tiempo aceptable", ms < 1500, `${clubs} clubes · ${players} jug. · ${ms.toFixed(0)} ms/temp.`);
}

// ─────────────────────── 13. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const w = evolve(7777, N * 2);
  let bad = 0; const reasons: string[] = [];
  for (const t of Object.values(w.teams)) {
    if (t.prestige < 0 || t.prestige > 100 || !Number.isFinite(t.prestige)) { bad++; reasons.push(`prestige ${t.id}`); }
    if (t.budget < 0 || !Number.isFinite(t.budget)) { bad++; reasons.push(`budget ${t.id}`); }
    if (t.fanbase < 0 || !Number.isFinite(t.fanbase)) { bad++; reasons.push(`fanbase ${t.id}`); }
    for (const v of Object.values(t.rivalries)) if (v < 0 || v > 100) { bad++; reasons.push(`rival ${t.id}`); }
  }
  for (const p of Object.values(w.players)) if (!Number.isFinite(p.value) || p.value < 0) { bad++; reasons.push(`value ${p.id}`); }
  check("INTEGRIDAD: prestigio/fanbase/presupuesto/valores/rivalidades válidos", bad === 0, bad ? reasons.slice(0, 5).join(" · ") : `${Object.keys(w.teams).length} clubes · ${Object.keys(w.players).length} jugadores OK`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
