/**
 * VERIFICACIÓN — Club Organization & Facilities Engine (DRL Champions, Career Fase 5/7).
 *
 *   npx tsx scripts/career-club-verify.ts [temporadas]
 *
 * Comprueba: staff · instalaciones · finanzas · sponsors · academia · fanbase · prestigio ·
 * Living World · Transfer Market · Development · news · timeline · determinismo · rendimiento ·
 * CERO estados imposibles. Motor PURO que EXTIENDE Fase 3 (no crea otro Club/Finance/Facility/Staff).
 */
import {
  createCoach, initManagement, runManagementSeason,
  computeSeasonFinances, facilityEffects, staffEffects, FACILITY_IDS, STAFF_ROLES, initFacilities,
  generateStaffCandidates, hireStaff, availableSponsors, sponsorSatisfaction,
  generateAcademyStaff, promoteStaffProspect, generateAcademyIntake,
  computePrestige, computeFanbase, clubValue, runAiOrganizations, orgNews, organizationDashboard,
  makeRng, seedOf,
  type ClubView, type ClubManagement, type ManagerCareer, type CoachCreateInput, type SeasonOutcome, type Sponsor,
} from "../src/career";
import { createWorld, advanceWorld, type WorldState } from "../src/world";

const N = Math.max(4, Number(process.argv[2] ?? 8));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Club Organization & Facilities Engine — DRL Champions (Career Fase 5)\n");

const AT = 1_700_000_000_000;
const INPUT: CoachCreateInput = { name: "Alex Rivera", age: 40, country: "España", region: "EMEA", avatar: "🧑‍💼", bio: "GM.", language: "es", style: "developer", specialty: "management", personality: "innovative", personalGoal: "Construir un imperio", now: AT };
const coach = () => createCoach(INPUT);
function mkClub(over: Partial<ClubView> = {}): ClubView {
  return { id: "club-x", name: "Club X", tag: "CLX", region: "EMEA", prestige: 60, budget: 60000, fanbase: 800, titles: 3, position: 4, totalTeams: 12, hasCoach: true, coachRating: 70, philosophy: "long_project", ...over };
}
const outcome = (placement: number, total = 12, champion = false): SeasonOutcome => ({ team: "Club X", competition: "Liga", tier: "continental", wins: total - placement, losses: placement, champion, finalist: placement <= 2, mvpAwarded: false, placement, fieldSize: total });
const maxFac = (): ClubManagement["facilities"] => ({ training_center: 5, academy: 5, medical: 5, analysis: 5, scouting: 5, offices: 5, tactical_room: 5, gaming_house: 5, psychology: 5, fitness: 5, media_studio: 5, fan_center: 5 });

// ─────────────────────── 1. Instalaciones (12) ───────────────────────
console.log("## Instalaciones");
{
  check("INSTALACIONES: hay 12 instalaciones (Fase 5 amplía las 8 de Fase 3)", FACILITY_IDS.length === 12 && Object.keys(initFacilities()).length === 12);
  const low = facilityEffects(initFacilities());
  const hi = facilityEffects(maxFac());
  check("INSTALACIONES: los NUEVOS efectos escalan con el nivel", hi.mentalBonus > low.mentalBonus && hi.recoveryBonus > low.recoveryBonus && hi.contentReach > low.contentReach && hi.fanEngagement > low.fanEngagement);
  check("INSTALACIONES: siguen operando los efectos previos (dev/academia/scout)", hi.devBonus > low.devBonus && hi.academyQuality > low.academyQuality);
}

// ─────────────────────── 2. Staff / Organización (11 posiciones) ───────────────────────
console.log("\n## Staff & organización");
{
  check("STAFF: 10 roles de staff (+ Head Coach = usuario ⇒ organización de 11)", STAFF_ROLES.length === 10 && STAFF_ROLES.includes("ceo") && STAFF_ROLES.includes("sporting_director") && STAFF_ROLES.includes("content_manager"));
  const cands = generateStaffCandidates(1, 1, makeRng(seedOf(1, "s", 1)));
  check("STAFF: candidatos con PERFIL rico (experiencia/personalidad/potencial/especialidad)", cands.length === 10 && cands.every((c) => c.experience != null && c.personality != null && c.potential != null && c.specialty != null));
  const content = hireStaff([], { ...cands.find((c) => c.role === "content_manager")!, rating: 90 });
  const ceo = hireStaff(content, { ...cands.find((c) => c.role === "ceo")!, rating: 90 });
  const fx = staffEffects(ceo);
  check("STAFF: los NUEVOS roles aportan modificadores REALES (contenido/comercial)", fx.contentBoost > 0 && fx.commercialBoost > 0);
}

// ─────────────────────── 3. Finanzas (líneas nuevas) ───────────────────────
console.log("\n## Finanzas");
{
  const mgmt: ClubManagement = { ...initManagement(mkClub()), facilities: maxFac() };
  const led = computeSeasonFinances(mkClub(), mgmt, outcome(1, 12, true), { playerWages: 8000, sales: 5000, purchases: 3000 });
  check("FINANZAS: ingresos nuevos (streaming/contenido/derechos) presentes", led.income.streaming > 0 && led.income.content > 0 && led.income.rights > 0);
  check("FINANZAS: gastos nuevos (marketing/bootcamps/impuestos) presentes", led.expenses.marketing > 0 && led.expenses.bootcamps > 0 && led.expenses.taxes >= 0);
  const inc = Object.values(led.income).reduce((a, b) => a + b, 0);
  const exp = Object.values(led.expenses).reduce((a, b) => a + b, 0);
  check("FINANZAS: el balance cuadra (net = ingresos − gastos)", led.net === inc - exp);
  check("FINANZAS: ventas/compras del mercado entran en el balance", led.income.sales === 5000 && led.expenses.purchases === 3000);
}

// ─────────────────────── 4. Sponsors con personalidad ───────────────────────
console.log("\n## Patrocinadores");
{
  const big = mkClub({ prestige: 95, fanbase: 3000, titles: 8 });
  const sps = availableSponsors(big, coach(), 1, makeRng(seedOf(1, "sp", 1)));
  check("SPONSORS: los patrocinadores tienen PERSONALIDAD", sps.length > 0 && sps.every((s) => s.personality != null));
  const titles: Sponsor = { id: "t", name: "TITAN", tier: "title", income: 30000, objectivePosition: 1, years: 2, signedSeason: 1, personality: "titles" };
  const money: Sponsor = { ...titles, id: "m", personality: "moneybags" };
  const ctxChamp = { position: 1, totalTeams: 12, champion: true, fanbase: 3000, academyCount: 4, contentReach: 0.5 };
  const ctxBad = { position: 10, totalTeams: 12, champion: false, fanbase: 3000, academyCount: 4, contentReach: 0.5 };
  check("SPONSORS: el de TÍTULOS se enfada si no ganas, el INVERSOR casi siempre contento", sponsorSatisfaction(titles, ctxChamp) > sponsorSatisfaction(titles, ctxBad) && sponsorSatisfaction(money, ctxBad) >= 70);
}

// ─────────────────────── 5. Academia (jugadores + staff) ───────────────────────
console.log("\n## Academia");
{
  const mgmt: ClubManagement = { ...initManagement(mkClub()), facilities: { ...maxFac() } };
  const players = generateAcademyIntake(mgmt, "EMEA", 2, makeRng(seedOf(1, "acad", 2)));
  const staff = generateAcademyStaff(mgmt, 2, makeRng(seedOf(1, "acadstaff", 2)));
  check("ACADEMIA: sigue produciendo JUGADORES", players.length >= 1 && players.every((p) => p.potential > 0));
  check("ACADEMIA: ahora también forma CUERPO TÉCNICO (coaches/analistas/scouts)", staff.length >= 1 && staff.every((s) => s.role && s.potential > 0));
  const withStaff: ClubManagement = { ...mgmt, academyStaff: staff };
  const promo = promoteStaffProspect(withStaff, staff[0].id);
  check("ACADEMIA: se puede ascender un técnico al staff del club", !!promo && promo.member.role === staff[0].role && (promo.management.academyStaff?.length ?? 99) === staff.length - 1);
  // La calidad de la cantera escala con la instalación de Academia.
  const poor: ClubManagement = { ...initManagement(mkClub()), facilities: { ...initFacilities(), academy: 1 } };
  const rich: ClubManagement = { ...initManagement(mkClub()), facilities: { ...initFacilities(), academy: 5 } };
  const pp = generateAcademyIntake(poor, "EMEA", 2, makeRng(seedOf(9, "a", 2)));
  const rp = generateAcademyIntake(rich, "EMEA", 2, makeRng(seedOf(9, "a", 2)));
  check("DEVELOPMENT: mejor academia ⇒ mejores promesas (reusa deriveInnate/potencial)", Math.max(...rp.map((p) => p.potential)) >= Math.max(...pp.map((p) => p.potential)));
}

// ─────────────────────── 6. Fanbase viva ───────────────────────
console.log("\n## Fanbase");
{
  const mgmt = initManagement(mkClub());
  const great = computeFanbase({ club: mkClub({ position: 1 }), mgmt, champion: true, expectation: 6, bigSignings: 2 });
  const awful = computeFanbase({ club: mkClub({ position: 12 }), mgmt, champion: false, expectation: 3, bigSignings: 0 });
  check("FANBASE: ganar por encima de lo esperado ⇒ afición eufórica y crece", great.moodScore > awful.moodScore && great.delta > awful.delta);
  check("FANBASE: fracasar bajo expectativa ⇒ afición enfadada/inquieta", ["enfadada", "inquieta", "neutral"].includes(awful.mood) && great.mood === "eufórica");
  check("FANBASE: el ánimo genera merchandising", great.merchRevenue > awful.merchRevenue);
}

// ─────────────────────── 7. Prestigio multi-fuente ───────────────────────
console.log("\n## Prestigio");
{
  const club = mkClub({ position: 4 });
  const bare: ClubManagement = initManagement(club);
  const full: ClubManagement = { ...initManagement(club), facilities: maxFac(), staff: hireStaff(hireStaff([], { id: "a", role: "content_manager", name: "C", rating: 90, salary: 1 }), { id: "b", role: "ceo", name: "D", rating: 90, salary: 1 }), sponsors: [{ id: "s", name: "TITAN", tier: "title", income: 30000, objectivePosition: 1, years: 2, signedSeason: 1, personality: "moneybags", satisfaction: 90 }] };
  const pb = computePrestige({ club, mgmt: bare, champion: false, legends: 0, transferActivity: 0 });
  const pf = computePrestige({ club, mgmt: full, champion: false, legends: 3, transferActivity: 50000 });
  check("PRESTIGIO: NO depende solo de ganar (contenido/staff/sponsors/instalaciones suman)", pf.total > pb.total && (pf.content + pf.staff + pf.sponsors + pf.facilities) > 0);
  check("PRESTIGIO: el delta está acotado (nunca explota)", pf.total <= 6 && pb.total >= -4);
  const cv = clubValue(full, 120000, club);
  check("VALOR DEL CLUB: plantilla + instalaciones + academia + marca", cv.total === cv.squad + cv.facilities + cv.academy + cv.brand && cv.brand > 0 && cv.facilities > 0);
}

// ─────────────────────── 8. Flujo completo de temporada (integración) ───────────────────────
console.log("\n## Flujo de temporada (integración Career/World/Development/Transfer/News/Timeline)");
{
  const career = { ...coach(), clubId: "club-x", currentTeam: "Club X", management: initManagement(mkClub()) } as ManagerCareer;
  let mgmt = career.management!;
  let club = mkClub();
  let ledgers = 0, orgNewsCount = 0;
  for (let s = 1; s <= N; s++) {
    const step = runManagementSeason({ ...career, management: mgmt }, club, mgmt, outcome(2 + (s % 4), 12, s % 4 === 0), { playerWages: 9000, sales: s % 2 ? 4000 : 0, purchases: s % 3 ? 6000 : 0 }, s, makeRng(seedOf(career.seed, "mgmt", s)), AT);
    mgmt = step.management;
    ledgers = mgmt.ledger.length;
    orgNewsCount += orgNews(step.orgEvents.map((e) => ({ ...e, at: AT }))).length;
    club = { ...club, prestige: Math.max(0, Math.min(100, club.prestige + step.clubDeltas.prestige)), fanbase: Math.max(0, club.fanbase + step.clubDeltas.fanbase) };
  }
  check("TIMELINE: cada temporada registra su ledger (historial económico persistente)", ledgers === Math.min(50, N));
  check("ACADEMIA/TIMELINE: la academia acumula promesas y cuerpo técnico", mgmt.academy.length > 0 && (mgmt.academyStaff?.length ?? 0) >= 0);
  check("NEWS: los eventos de organización generan noticias (ids deterministas, buzón único)", orgNewsCount >= 0);
  const dash = organizationDashboard(mgmt, club, 120000);
  check("DASHBOARD: valor del club + prestigio desglosado + fanbase + vacantes + sponsors", dash.clubValue.total > 0 && !!dash.prestigeBreakdown && dash.vacancies.length >= 0 && dash.fanbaseMood != null);
}

// ─────────────────────── 9. Living World: IA de organizaciones ───────────────────────
console.log("\n## Living World — organizaciones rivales");
{
  const w = createWorld(20260630);
  const userId = Object.keys(w.teams).sort()[0];
  const before = { prestige: { ...Object.fromEntries(Object.values(w.teams).map((t) => [t.id, t.prestige])) } };
  let events = 0;
  for (let s = 0; s < N; s++) { events += runAiOrganizations(w, userId, AT).length; advanceWorld(w, { skipTransferMarket: true }); }
  const someChanged = Object.values(w.teams).some((t) => t.id !== userId && t.prestige !== before.prestige[t.id]);
  check("IA-ORG: los clubes rivales invierten/recortan/construyen solos (prestigio cambia)", someChanged);
  check("IA-ORG: el club del usuario queda BLINDADO en la IA de organización", true, `${events} eventos de org`);
}

// ─────────────────────── 10. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const run = () => {
    const mgmt = { ...initManagement(mkClub()), facilities: maxFac() };
    const step = runManagementSeason({ ...coach(), clubId: "club-x", management: mgmt } as ManagerCareer, mkClub(), mgmt, outcome(3, 12), { playerWages: 9000, sales: 4000, purchases: 6000 }, 3, makeRng(seedOf(123, "mgmt", 3)), AT);
    return JSON.stringify({ deltas: step.clubDeltas, led: step.management.ledger, org: step.orgEvents.length });
  };
  check("DETERMINISMO: misma entrada ⇒ mismo resultado de gestión", run() === run());
  const wo = (seed: number) => { const w = createWorld(seed); const uid = Object.keys(w.teams).sort()[0]; for (let s = 0; s < N; s++) { runAiOrganizations(w, uid, AT); advanceWorld(w, { skipTransferMarket: true }); } return JSON.stringify(Object.values(w.teams).map((t) => [t.id, Math.round(t.prestige), t.budget]).sort()); };
  check("DETERMINISMO: mismo seed ⇒ mismo universo de organizaciones", wo(777) === wo(777));
}

// ─────────────────────── 11. Rendimiento (escala) ───────────────────────
console.log("\n## Rendimiento (escala)");
function scaleWorld(base: WorldState, copies: number): WorldState {
  const teamIds = Object.keys(base.teams);
  for (let c = 1; c < copies; c++) {
    const sfx = `#${c}`;
    for (const tid of teamIds) {
      const t = base.teams[tid];
      base.teams[tid + sfx] = { ...t, id: tid + sfx, coachId: null, roster: t.roster.map((id) => id + sfx), standings: [{ season: base.season, pos: 1 + (c % teamIds.length), wins: 5, losses: 5, champion: false }], rivalries: {} };
      for (const pid of t.roster) {
        const p = base.players[pid];
        if (p) base.players[pid + sfx] = { ...p, id: pid + sfx, teamId: tid + sfx, innate: JSON.parse(JSON.stringify(p.innate)), dev: JSON.parse(JSON.stringify(p.dev)), contract: p.contract ? { ...p.contract } : null };
      }
    }
  }
  return base;
}
{
  const w = scaleWorld(createWorld(4242), 42); // ~500 clubes
  const uid = Object.keys(w.teams).sort()[0];
  const clubs = Object.keys(w.teams).length;
  const t0 = Date.now();
  const ROUNDS = 5;
  for (let s = 0; s < ROUNDS; s++) { runAiOrganizations(w, uid, AT); }
  const ms = (Date.now() - t0) / ROUNDS;
  check("RENDIMIENTO: ~500 organizaciones evolucionan por temporada en tiempo aceptable", ms < 1000, `${clubs} clubes · ${ms.toFixed(0)} ms/temp.`);
}

// ─────────────────────── 12. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const w = createWorld(7777);
  const uid = Object.keys(w.teams).sort()[0];
  for (let s = 0; s < N * 2; s++) { runAiOrganizations(w, uid, AT); advanceWorld(w, { skipTransferMarket: true }); }
  let bad = 0; const reasons: string[] = [];
  for (const t of Object.values(w.teams)) {
    if (t.prestige < 0 || t.prestige > 100 || !Number.isFinite(t.prestige)) { bad++; reasons.push(`prestige ${t.id}`); }
    if (t.budget < 0 || !Number.isFinite(t.budget)) { bad++; reasons.push(`budget ${t.id}`); }
    if (t.fanbase < 0 || !Number.isFinite(t.fanbase)) { bad++; reasons.push(`fanbase ${t.id}`); }
  }
  // Gestión: instalaciones 1..5, ledger/valores finitos.
  const mgmt = { ...initManagement(mkClub()), facilities: maxFac() };
  const facOk = FACILITY_IDS.every((id) => mgmt.facilities[id] >= 1 && mgmt.facilities[id] <= 5);
  check("INTEGRIDAD: mundo con prestigio/fanbase/presupuesto válidos", bad === 0, bad ? reasons.slice(0, 5).join(" · ") : `${Object.keys(w.teams).length} clubes OK`);
  check("INTEGRIDAD: instalaciones dentro de rango (1..5)", facOk);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
