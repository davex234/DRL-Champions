/**
 * VERIFICACIÓN — Manager & Club Management Engine (DRL Champions, Career Fase 3/7).
 *
 *   npx tsx scripts/career-management-verify.ts [temporadas]
 *
 * Comprueba: presupuesto · instalaciones · academia · scouting · plantilla · entrenamiento ·
 * economía · staff · patrocinadores · timeline · Living World · Career · Player Development ·
 * determinismo · rendimiento · cero estados imposibles. Motor PURO + integración real.
 */
import {
  createCoach, termsFor, acceptOffer as acceptOfferPure, dismiss,
  initManagement, initFacilities, upgradeFacility, upgradeCost, facilityEffects, facilitiesUpkeep,
  generateStaffCandidates, hireStaff, staffEffects, staffSalaries,
  availableSponsors, signSponsor, sponsorIncome,
  computeSeasonFinances, ledgerTotals,
  generateAcademyIntake, promoteProspect,
  runScouting, type ScoutPoolEntry,
  trainPlayer, trainingCapacity, trainingEffectiveness,
  runManagementSeason, clubDashboard,
  clubViewsFromWorld, seasonOutcomeFromWorld,
  makeRng, seedOf,
  type ManagerCareer, type ClubView, type Offer, type ClubManagement, type CoachCreateInput,
} from "../src/career";
import { createWorld, advanceWorld, playerValue, type WorldPlayer } from "../src/world";
import { deriveInnate, freshDevState, progress } from "../src/development";

const N = Math.max(4, Number(process.argv[2] ?? 8));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Manager & Club Management Engine — DRL Champions (Career Fase 3)\n");

const AT = 1_700_000_000_000;
const INPUT: Omit<CoachCreateInput, "now"> & { now: number } = {
  name: "Alex Rivera", age: 36, country: "España", region: "EMEA", avatar: "🧑‍🏫",
  bio: "GM.", language: "es", style: "developer", specialty: "scouting", personality: "innovative",
  personalGoal: "Construir un imperio", now: AT,
};
const fresh = () => createCoach(INPUT);
function mkClub(over: Partial<ClubView> = {}): ClubView {
  return { id: "club-x", name: "Club X", tag: "CLX", region: "EMEA", prestige: 60, budget: 40000, fanbase: 600, titles: 3, position: 4, totalTeams: 12, hasCoach: false, coachRating: 0, philosophy: "develop_youth", ...over };
}
function signTo(career: ManagerCareer, club: ClubView): ManagerCareer {
  const terms = termsFor(club, career, makeRng(seedOf(career.seed, "s", club.id)));
  const offer: Offer = { id: `o:${club.id}`, clubId: club.id, clubName: club.name, region: club.region, season: 1, prestige: club.prestige, philosophy: club.philosophy, terms, appeal: 50, status: "pending" };
  return acceptOfferPure({ ...career, offers: [offer] }, offer, club, AT).career;
}
function mkPlayer(i: number): WorldPlayer {
  const id = `pool-${i}`;
  const innate = deriveInnate(id);
  innate.potential = 55 + (i * 7) % 44;
  const dev = freshDevState(innate);
  const p: WorldPlayer = { id, nick: `P${i}`, region: "EMEA", role: "Duelista", teamId: null, innate, dev, contract: null, status: "active", value: 0, titles: i % 3, mvps: i % 2, origin: "seed", prevValue: 0 };
  p.value = playerValue(p);
  return p;
}
const outcome = (placement: number, total = 12) => ({ team: "Club X", competition: "Liga", tier: "regional" as const, wins: total - placement, losses: placement, champion: placement === 1, finalist: placement <= 2, mvpAwarded: false, placement, fieldSize: total });

// ─────────────────────── 1. Instalaciones ───────────────────────
console.log("## Instalaciones");
{
  const f = initFacilities();
  check("instalaciones iniciales a nivel 1", Object.values(f).every((l) => l === 1) && Object.keys(f).length === 12);
  const up = upgradeFacility(f, "academy")!;
  check("subir una instalación incrementa el nivel y cuesta upgradeCost", up.facilities.academy === 2 && up.cost === upgradeCost(1));
  const low = facilityEffects(initFacilities());
  const hi = facilityEffects({ training_center: 5, academy: 5, medical: 5, analysis: 5, scouting: 5, offices: 5, tactical_room: 5, gaming_house: 5, psychology: 5, fitness: 5, media_studio: 5, fan_center: 5 });
  check("las instalaciones afectan REALMENTE (efectos escalan con el nivel)", hi.devBonus > low.devBonus && hi.academyQuality > low.academyQuality && hi.scoutBonus > low.scoutBonus);
  check("el mantenimiento crece con los niveles", facilitiesUpkeep(hi.devBonus ? { ...initFacilities(), academy: 5 } : initFacilities()) > facilitiesUpkeep(initFacilities()));
}

// ─────────────────────── 2. Staff ───────────────────────
console.log("\n## Staff");
{
  const cands = generateStaffCandidates(123, 1, makeRng(seedOf(123, "staff", 1)));
  check("el mercado genera un candidato por rol (10)", cands.length === 10 && new Set(cands.map((c) => c.role)).size === 10);
  const assistant = { ...cands.find((c) => c.role === "assistant_coach")!, rating: 90 };
  const staff = hireStaff([], assistant);
  check("contratar staff añade el miembro y aporta modificador REAL", staff.length === 1 && staffEffects(staff).trainingBoost > 0);
  check("contratar el mismo rol reemplaza (no duplica)", hireStaff(staff, { ...assistant, id: "other" }).length === 1);
  check("los sueldos del staff se suman", staffSalaries(staff) > 0);
}

// ─────────────────────── 3. Patrocinadores ───────────────────────
console.log("\n## Patrocinadores");
{
  const big = mkClub({ prestige: 95, fanbase: 1500, titles: 8 });
  const small = mkClub({ prestige: 20, fanbase: 100, titles: 0 });
  const sBig = availableSponsors(big, { ...fresh(), stats: { ...fresh().stats, titles: 10 } }, 1, makeRng(seedOf(1, "sp", "big")));
  const sSmall = availableSponsors(small, fresh(), 1, makeRng(seedOf(1, "sp", "small")));
  const bestTier = (xs: { tier: string }[]) => xs.map((s) => ["local", "regional", "global", "title"].indexOf(s.tier)).reduce((a, b) => Math.max(a, b), 0);
  check("un club grande accede a patrocinios de más nivel", bestTier(sBig) > bestTier(sSmall), `${bestTier(sSmall)} < ${bestTier(sBig)}`);
  check("los patrocinios de élite EXIGEN objetivos", sBig.some((s) => s.objectivePosition > 0));
  const signed = signSponsor([], sBig[0]);
  check("firmar patrocinador genera ingreso por temporada", sponsorIncome(signed) > 0);
}

// ─────────────────────── 4. Economía / Presupuesto ───────────────────────
console.log("\n## Economía y presupuesto");
{
  const club = mkClub({ prestige: 70, fanbase: 800, budget: 50000 });
  const mgmt: ClubManagement = { ...initManagement(club), sponsors: availableSponsors(club, fresh(), 1, makeRng(seedOf(1, "e"))).slice(0, 1) };
  const champ = computeSeasonFinances(club, mgmt, outcome(1), { playerWages: 12000, sales: 0, purchases: 0 });
  const last = computeSeasonFinances(club, mgmt, outcome(12), { playerWages: 12000, sales: 0, purchases: 0 });
  check("el balance desglosa ingresos y gastos REALES", champ.income.sponsors > 0 && champ.income.tickets > 0 && champ.expenses.salaries === 12000 && champ.expenses.facilities > 0);
  check("ganar reporta más premios que quedar último", champ.income.prizes > last.income.prizes, `${last.income.prizes} < ${champ.income.prizes}`);
  check("balanceEnd = saldo + neto", champ.balanceEnd === mgmt.balance + champ.net);
  const totals = ledgerTotals(champ);
  check("ingresos totales = suma de partidas", totals.income === Object.values(champ.income).reduce((a, b) => a + b, 0));
  // Más instalaciones de oficinas ⇒ más ingresos comerciales.
  const mgmtOffices: ClubManagement = { ...mgmt, facilities: { ...mgmt.facilities, offices: 5 } };
  check("las oficinas aumentan los ingresos comerciales", computeSeasonFinances(club, mgmtOffices, outcome(1), { playerWages: 12000, sales: 0, purchases: 0 }).income.sponsors > champ.income.sponsors);
}

// ─────────────────────── 5. Academia (reusa Player Development) ───────────────────────
console.log("\n## Academia");
{
  const base = initManagement(mkClub());
  const low: ClubManagement = { ...base, facilities: { ...base.facilities, academy: 1 } };
  const high: ClubManagement = { ...base, facilities: { ...base.facilities, academy: 5 } };
  const pLow = generateAcademyIntake(low, "EMEA", 2, makeRng(seedOf(1, "ac", "low")));
  const pHigh = generateAcademyIntake(high, "EMEA", 2, makeRng(seedOf(1, "ac", "high")));
  check("la academia produce jóvenes con ADN/dev/scout (reusa Development)", pLow.length >= 1 && pLow.every((p) => p.innate.playerId === p.id && !!p.dev && p.scout.potential === p.potential));
  check("mejor instalación ⇒ más y mejores promesas", pHigh.length >= pLow.length && (pHigh.reduce((a, p) => a + p.potential, 0) / pHigh.length) >= (pLow.reduce((a, p) => a + p.potential, 0) / pLow.length));
  check("cada promesa tiene edad juvenil, rol, región y valor", pHigh.every((p) => p.age >= 16 && p.age <= 18 && !!p.role && p.region === "EMEA" && p.value >= 40));
  const withProspects: ClubManagement = { ...high, academy: pHigh };
  const promoted = promoteProspect(withProspects, pHigh[0].id)!;
  check("promocionar saca al joven de la academia", promoted.management.academy.length === pHigh.length - 1 && promoted.prospect.id === pHigh[0].id);
  const a = generateAcademyIntake(low, "EMEA", 2, makeRng(seedOf(9, "z")));
  const b = generateAcademyIntake(low, "EMEA", 2, makeRng(seedOf(9, "z")));
  check("academia determinista (misma semilla ⇒ mismas promesas)", JSON.stringify(a) === JSON.stringify(b));
}

// ─────────────────────── 6. Scouting (reusa scoutPlayer) ───────────────────────
console.log("\n## Scouting");
{
  const pool: ScoutPoolEntry[] = Array.from({ length: 60 }, (_, i) => mkPlayer(i));
  const weak: ClubManagement = { ...initManagement(mkClub()), facilities: { ...initFacilities(), scouting: 1 } };
  const strong: ClubManagement = { ...initManagement(mkClub()), facilities: { ...initFacilities(), scouting: 5 }, staff: hireStaff([], { id: "sc", role: "scout", name: "Eye", rating: 95, salary: 3000 }) };
  const tWeak = runScouting(weak, fresh(), pool, makeRng(seedOf(1, "sc", "w")));
  const tStrong = runScouting(strong, fresh(), pool, makeRng(seedOf(1, "sc", "s")));
  check("el scouting DESCUBRE objetivos con informe (reusa scoutPlayer)", tWeak.length >= 1 && tWeak.every((t) => !!t.report && t.report.playerId === t.id));
  check("cada objetivo tiene coste/riesgo/compatibilidad/química", tStrong.every((t) => t.cost > 0 && t.risk >= 0 && t.risk <= 100 && t.compatibility >= 0 && t.compatibility <= 100 && t.chemistry >= 0 && t.chemistry <= 100));
  check("mejor scouting ⇒ más objetivos y menos riesgo medio", tStrong.length >= tWeak.length && (tStrong.reduce((a, t) => a + t.risk, 0) / tStrong.length) <= (tWeak.reduce((a, t) => a + t.risk, 0) / tWeak.length) + 1);
  const r1 = runScouting(strong, fresh(), pool, makeRng(seedOf(5, "k")));
  const r2 = runScouting(strong, fresh(), pool, makeRng(seedOf(5, "k")));
  check("scouting determinista", JSON.stringify(r1) === JSON.stringify(r2));
}

// ─────────────────────── 7. Entrenamiento (reusa Player Development) ───────────────────────
console.log("\n## Entrenamiento");
{
  const club = mkClub();
  const weak: ClubManagement = { ...initManagement(club), facilities: { ...initFacilities(), training_center: 1 } };
  const strong: ClubManagement = { ...initManagement(club), facilities: { ...initFacilities(), training_center: 5 }, staff: hireStaff([], { id: "a", role: "assistant_coach", name: "Coach", rating: 95, salary: 3000 }) };
  const innate = deriveInnate("trainee");
  let devW = freshDevState(innate), devS = freshDevState(innate);
  const before = progress(devW);
  for (let i = 0; i < 6; i++) { devW = trainPlayer(innate, devW, { id: "aim", intensity: "hard" }, weak, 1).state; devS = trainPlayer(innate, devS, { id: "aim", intensity: "hard" }, strong, 1).state; }
  check("entrenar MEJORA al jugador (reusa Development train)", progress(devW) > before, `${before.toFixed(1)}→${progress(devW).toFixed(1)}`);
  check("mejores instalaciones/staff ⇒ más desarrollo", progress(devS) >= progress(devW));
  check("la capacidad de entrenamiento escala con el centro", trainingCapacity(strong) > trainingCapacity(weak) && trainingEffectiveness(strong) > trainingEffectiveness(weak));
}

// ─────────────────────── 8. Living World + Career + flujo de gestión ───────────────────────
console.log("\n## Living World + flujo de gestión");
{
  const world = createWorld(20260630);
  advanceWorld(world);
  const clubs = clubViewsFromWorld(world);
  const club = clubs[0];
  const career = signTo(fresh(), club);
  check("al firmar, la gestión del club se inicializa (saldo = presupuesto)", career.management != null && career.management!.clubId === club.id && career.management!.balance === club.budget);
  check("al ser despedido, la gestión se libera", dismiss(career, "x", AT).career.management === null);
  const o = seasonOutcomeFromWorld(world, club.id)!;
  const step = runManagementSeason(career, club, career.management!, o, { playerWages: 8000, sales: 0, purchases: 0 }, career.season, makeRng(seedOf(career.seed, "mg", 1)), AT);
  check("la temporada de gestión produce balance + hornada de cantera + deltas del club",
    step.management.ledger.length === 1 && step.management.academy.length >= 1 && typeof step.clubDeltas.budget === "number" && typeof step.clubDeltas.prestige === "number");
  check("la academia se nutre desde el Living World (región del club)", step.management.academy.every((p) => p.region === club.region));
  // Pool de scouting desde agentes libres del mundo.
  const pool = world.freeAgents.map((id) => world.players[id]).filter(Boolean) as ScoutPoolEntry[];
  if (pool.length >= 1) check("scouting sobre agentes libres del mundo", runScouting(career.management!, career, pool, makeRng(seedOf(1, "fa"))).length >= 1);
  else check("scouting sobre agentes libres del mundo (sin libres esta temporada)", true);
}

// ─────────────────────── 9. Timeline / Noticias ───────────────────────
console.log("\n## Timeline y noticias");
{
  const club = mkClub({ budget: 1000, fanbase: 50, prestige: 20 });
  const career = signTo(fresh(), club);
  // Fuerza números rojos: gastos > ingresos.
  const step = runManagementSeason(career, club, career.management!, outcome(12), { playerWages: 90000, sales: 0, purchases: 0 }, 1, makeRng(seedOf(1, "rojo")), AT);
  check("balance negativo genera evento + noticia 'financial_trouble'", step.management.balance < 0 && step.events.some((e) => e.type === "financial_trouble") && step.news.length >= 1);
  check("el ledger registra la temporada (timeline económico)", step.management.ledger.length === 1 && step.management.ledger[0].net < 0);
}

// ─────────────────────── 10. Dashboard ───────────────────────
console.log("\n## Dashboard del club");
{
  const club = mkClub();
  const mgmt: ClubManagement = { ...initManagement(club), sponsors: availableSponsors(club, fresh(), 1, makeRng(seedOf(1, "d"))).slice(0, 1), academy: generateAcademyIntake(initManagement(club), "EMEA", 2, makeRng(seedOf(1, "d2"))) };
  const dash = clubDashboard(mgmt, club, 120000);
  check("el dashboard expone presupuesto/valor plantilla/academia/instalaciones/staff/patrocinadores",
    dash.balance === mgmt.balance && dash.squadValue === 120000 && dash.academyValue >= 0 && dash.facilities.length === 12 && dash.sponsorIncome > 0 && typeof dash.financialHealth === "number");
}

// ─────────────────────── 11. Determinismo (flujo completo) ───────────────────────
console.log("\n## Determinismo");
{
  const club = mkClub();
  const c1 = signTo(fresh(), club), c2 = signTo(fresh(), club);
  const s1 = runManagementSeason(c1, club, c1.management!, outcome(3), { playerWages: 9000, sales: 1000, purchases: 0 }, 1, makeRng(seedOf(42, "x")), AT);
  const s2 = runManagementSeason(c2, club, c2.management!, outcome(3), { playerWages: 9000, sales: 1000, purchases: 0 }, 1, makeRng(seedOf(42, "x")), AT);
  check("misma temporada de gestión ⇒ mismo estado", JSON.stringify(s1.management) === JSON.stringify(s2.management) && JSON.stringify(s1.clubDeltas) === JSON.stringify(s2.clubDeltas));
}

// ─────────────────────── 12. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  let bad = 0; const reasons: string[] = [];
  for (let k = 0; k < N; k++) {
    const club = mkClub({ id: `z${k}`, prestige: (k * 11) % 100, budget: 2000 + k * 5000, fanbase: 50 + k * 120 });
    let mgmt = initManagement(club);
    // Sube instalaciones variadas + staff + patrocinador.
    for (let u = 0; u < k % 5; u++) { const up = upgradeFacility(mgmt.facilities, "academy"); if (up) mgmt = { ...mgmt, facilities: up.facilities }; }
    mgmt = { ...mgmt, staff: hireStaff([], { id: "s", role: "analyst", name: "A", rating: (k * 9) % 100, salary: 2000 }) };
    mgmt = { ...mgmt, sponsors: availableSponsors(club, fresh(), 1, makeRng(seedOf(k, "sp"))).slice(0, 1) };
    for (let s = 0; s < 12; s++) {
      const placement = 1 + ((k + s) % club.totalTeams);
      const step = runManagementSeason(fresh(), club, mgmt, outcome(placement), { playerWages: 5000 + s * 1000, sales: (s % 3) * 2000, purchases: (s % 4) * 1500 }, s, makeRng(seedOf(k, "imp", s)), AT + s);
      mgmt = step.management;
    }
    for (const id of Object.keys(mgmt.facilities) as (keyof typeof mgmt.facilities)[]) if (mgmt.facilities[id] < 0 || mgmt.facilities[id] > 5) { bad++; reasons.push("facility"); }
    if (Number.isNaN(mgmt.balance)) { bad++; reasons.push("balance"); }
    for (const l of mgmt.ledger) { for (const v of [...Object.values(l.income), ...Object.values(l.expenses)]) if (v < 0 || Number.isNaN(v)) { bad++; reasons.push("ledger"); } }
    for (const p of mgmt.academy) if (p.potential < 0 || p.potential > 99 || p.rating < 0 || p.rating > 100 || p.value < 40) { bad++; reasons.push("prospect"); }
  }
  check("CERO estados imposibles", bad === 0, bad === 0 ? `${N} clubes × 12 temporadas` : reasons.slice(0, 5).join(" · "));
}

// ─────────────────────── 13. Rendimiento ───────────────────────
console.log("\n## Rendimiento");
{
  // Scouting sobre 5000 jugadores.
  const pool: ScoutPoolEntry[] = Array.from({ length: 5000 }, (_, i) => mkPlayer(i));
  const mgmt = { ...initManagement(mkClub()), facilities: { ...initFacilities(), scouting: 5 } };
  let t0 = Date.now();
  runScouting(mgmt, fresh(), pool, makeRng(seedOf(1, "perf")));
  check("ojear 5000 jugadores rinde", Date.now() - t0 < 200, `${Date.now() - t0} ms`);
  // 100 temporadas de gestión.
  const club = mkClub();
  let m = initManagement(club);
  t0 = Date.now();
  for (let s = 0; s < 100; s++) m = runManagementSeason(fresh(), club, m, outcome(1 + (s % 12)), { playerWages: 8000, sales: 0, purchases: 0 }, s, makeRng(seedOf(1, "p", s)), AT).management;
  const ms = (Date.now() - t0) / 100;
  check("100 temporadas de gestión rinden", ms < 8, `${ms.toFixed(2)} ms/temporada`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
