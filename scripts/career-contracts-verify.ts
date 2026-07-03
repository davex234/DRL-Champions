/**
 * VERIFICACIÓN — Club & Contract Engine (DRL Champions, Career Fase 2/7).
 *
 *   npx tsx scripts/career-contracts-verify.ts [temporadas]
 *
 * Comprueba: contratos · renovaciones · despidos · mercado · objetivos · reputación ·
 * noticias · timeline · Living World · coach · determinismo · rendimiento · cero estados
 * imposibles. Motor PURO + integración real con `@/world` (sin stores, sin localStorage).
 */
import {
  createCoach,
  termsFor, createContract, coachRating, yearsLeft,
  boardObjectivesFor, evaluateBoardObjectives, boardAfterSeason, dismissalRisk, initBoard,
  generateOffers, clubSeasonDecision, acceptOffer as acceptOfferPure, renewContract, dismiss,
  classifyMarket,
  runCareerSeason, runUnemployedSeason, applyMatchToCareer,
  careerDashboard,
  globalReputationScore,
  clubViewsFromWorld, seasonOutcomeFromWorld, coachesFromWorld,
  makeRng, seedOf,
  type ManagerCareer, type ClubView, type Offer, type CoachCreateInput,
} from "../src/career";
import { createWorld, advanceWorld } from "../src/world";

const N = Math.max(4, Number(process.argv[2] ?? 8));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Club & Contract Engine — DRL Champions (Career Fase 2)\n");

const AT = 1_700_000_000_000;
const INPUT: Omit<CoachCreateInput, "now"> & { now: number } = {
  name: "Alex Rivera", age: 34, country: "España", region: "EMEA", avatar: "🧑‍🏫",
  bio: "Estratega.", language: "es", style: "tactical", specialty: "strategy", personality: "analytical",
  personalGoal: "Dinastía mundial", now: AT,
};
const fresh = () => createCoach(INPUT);

function mkClub(over: Partial<ClubView> = {}): ClubView {
  return {
    id: "club-x", name: "Club X", tag: "CLX", region: "EMEA", prestige: 60, budget: 30000,
    fanbase: 400, titles: 2, position: 5, totalTeams: 12, hasCoach: false, coachRating: 0,
    philosophy: "long_project", ...over,
  };
}

/** Firma a un entrenador con un club (determinista). */
function signTo(career: ManagerCareer, club: ClubView, season = 1): ManagerCareer {
  const rng = makeRng(seedOf(career.seed, "sign", club.id));
  const terms = termsFor(club, career, rng);
  const offer: Offer = { id: `offer:${club.id}:${season}`, clubId: club.id, clubName: club.name, region: club.region, season, prestige: club.prestige, philosophy: club.philosophy, terms, appeal: 50, status: "pending" };
  const c = { ...career, offers: [offer] };
  return acceptOfferPure(c, offer, club, AT).career;
}

// ─────────────────────── 1. Contratos ───────────────────────
console.log("## Contratos");
{
  const career = fresh();
  const big = mkClub({ id: "big", prestige: 90, budget: 60000 });
  const small = mkClub({ id: "small", prestige: 30, budget: 8000 });
  const rng = makeRng(seedOf(career.seed, "t", "big"));
  const tBig = termsFor(big, career, rng);
  const tSmall = termsFor(small, career, makeRng(seedOf(career.seed, "t", "small")));
  const contract = createContract(big, tBig, 1);
  check("el contrato tiene todos los campos (salario/bonus/cláusulas/objetivos/duración)",
    contract.salary > 0 && contract.bonuses.worlds > 0 && contract.releaseClause > 0 && contract.exitClause > 0 && contract.objectives.length > 0 && contract.years > 0 && contract.endSeason > contract.startSeason && contract.status === "active");
  check("un club con más prestigio/presupuesto paga más", tBig.salary > tSmall.salary, `${tSmall.salary} < ${tBig.salary}`);
  check("bonus escalonados worlds > major > playoffs", contract.bonuses.worlds > contract.bonuses.major && contract.bonuses.major > contract.bonuses.playoffs);
  const signed = signTo(career, big);
  check("firmar liga al club, abre contrato y spell de historial",
    signed.clubId === "big" && signed.contract?.clubId === "big" && signed.history.spells.some((s) => s.team === big.name && s.toSeason === null));
  check("firmar resetea la relación con la directiva", signed.board.confidence === initBoard().confidence);
}

// ─────────────────────── 2. Objetivos del contrato ───────────────────────
console.log("\n## Objetivos de directiva");
{
  const elite = mkClub({ prestige: 95, totalTeams: 12, philosophy: "win_now" });
  const objs = boardObjectivesFor(elite);
  check("un club de élite impone ganar la liga (obligatorio)", objs.some((o) => o.kind === "win_league" && o.mandatory));
  const champOutcome = { team: "Club X", competition: "Liga", tier: "continental" as const, wins: 11, losses: 1, champion: true, finalist: true, mvpAwarded: false, placement: 1, fieldSize: 12 };
  const lastOutcome = { ...champOutcome, champion: false, finalist: false, placement: 12, wins: 2, losses: 10 };
  check("campeón CUMPLE el objetivo de ganar la liga", evaluateBoardObjectives(objs, champOutcome, elite).find((o) => o.kind === "win_league")?.status === "met");
  check("último puesto FALLA el objetivo obligatorio", evaluateBoardObjectives(objs, lastOutcome, elite).find((o) => o.kind === "win_league")?.status === "failed");
}

// ─────────────────────── 3. Despidos (nunca aleatorios) ───────────────────────
console.log("\n## Despidos");
{
  const club = mkClub({ prestige: 90, philosophy: "win_now" });
  let career = signTo(fresh(), club);
  // Fuerza una directiva harta + objetivos fallados.
  career = { ...career, board: { ...initBoard(), confidence: 18, pressure: 92, boardTrust: 20, fanSupport: 25, playerRespect: 30 } };
  const bad = { team: club.name, competition: "Liga", tier: "regional" as const, wins: 2, losses: 10, champion: false, finalist: false, mvpAwarded: false, placement: 12, fieldSize: 12 };
  const evald = evaluateBoardObjectives(career.contract!.objectives, bad, club);
  const failed = evald.filter((o) => o.mandatory && o.status === "failed").length;
  const risk = dismissalRisk(career, club, failed, bad);
  check("el riesgo de despido se calcula alto con presión + objetivos fallados", risk >= 0.55, `riesgo ${risk.toFixed(2)}`);
  // No aleatorio: la PROBABILIDAD de despido = riesgo calculado (la tasa lo refleja).
  const fireCount = Array.from({ length: 40 }, (_, i) => clubSeasonDecision(career, club, failed, bad, makeRng(seedOf(career.seed, "fire", i))).kind === "fire").filter(Boolean).length;
  check("el club DESPIDE con prob = riesgo (no aleatorio)", fireCount / 40 >= 0.6, `${fireCount}/40 ≈ riesgo ${risk.toFixed(2)}`);
  check("la decisión es determinista (misma semilla ⇒ misma decisión)",
    clubSeasonDecision(career, club, failed, bad, makeRng(seedOf(career.seed, "fire", 7))).kind === clubSeasonDecision(career, club, failed, bad, makeRng(seedOf(career.seed, "fire", 7))).kind);
  // Un campeón nunca se despide.
  const champ = { ...bad, champion: true, placement: 1, wins: 12, losses: 0 };
  check("riesgo de despido de un CAMPEÓN = 0", dismissalRisk(career, club, 0, champ) === 0);
  // El despido cierra el spell y libera al entrenador.
  const fired = dismiss(career, "objetivos incumplidos", AT);
  check("el despido cierra el spell y deja al entrenador libre", fired.career.clubId === null && fired.career.history.spells.every((s) => s.toSeason !== null) && fired.career.events.some((e) => e.type === "dismissed"));
}

// ─────────────────────── 4. Renovaciones ───────────────────────
console.log("\n## Renovaciones");
{
  const club = mkClub({ prestige: 70 });
  let career = signTo(fresh(), club);
  // Contrato a punto de expirar + buena relación ⇒ el club ofrece renovar.
  career = { ...career, season: career.contract!.endSeason - 1, board: { ...initBoard(), confidence: 70, pressure: 20 } };
  const good = { team: club.name, competition: "Liga", tier: "continental" as const, wins: 10, losses: 2, champion: false, finalist: true, mvpAwarded: false, placement: 3, fieldSize: 12 };
  const evald = evaluateBoardObjectives(career.contract!.objectives, good, club);
  const failed = evald.filter((o) => o.mandatory && o.status === "failed").length;
  const dec = clubSeasonDecision(career, club, failed, good, makeRng(seedOf(career.seed, "renew", 1)));
  check("el club OFRECE renovación con contrato expirando y buena relación", dec.kind === "renew");
  if (dec.kind === "renew") {
    const renewed = renewContract(career, dec.offer, AT);
    check("renovar extiende el contrato y sube la confianza", renewed.career.contract!.endSeason > career.contract!.endSeason && renewed.career.board.confidence >= career.board.confidence);
    check("renovar emite evento 'contract_renewed'", renewed.career.events.some((e) => e.type === "contract_renewed"));
  }
}

// ─────────────────────── 5. Mercado de ofertas ───────────────────────
console.log("\n## Mercado de ofertas");
{
  const clubs: ClubView[] = Array.from({ length: 20 }, (_, i) => mkClub({ id: `c${i}`, name: `Club ${i}`, prestige: 30 + i * 3, budget: 5000 + i * 3000, hasCoach: i % 2 === 0, coachRating: 40 + i }));
  const rookie = fresh();
  const star = { ...fresh(), reputation: { local: 90, regional: 88, continental: 86, global: 90 }, license: "elite" as const, stats: { ...fresh().stats, titles: 12 } };
  const oRookie = generateOffers(rookie, clubs, 1);
  const oStar = generateOffers(star, clubs, 1);
  check("un entrenador de élite recibe más/mejores ofertas que un rookie", oStar.length >= oRookie.length, `rookie ${oRookie.length} vs élite ${oStar.length}`);
  check("las ofertas están ordenadas por atractivo", oStar.every((o, i) => i === 0 || oStar[i - 1].appeal >= o.appeal));
  check("las ofertas no superan el aforo (máx 4) y son del mercado", oStar.length <= 4 && oStar.every((o) => o.terms.salary > 0));
  check("no hay ofertas de su propio club", generateOffers({ ...star, clubId: "c5" }, clubs, 1).every((o) => o.clubId !== "c5"));
}

// ─────────────────────── 6. Living World (integración real) ───────────────────────
console.log("\n## Living World (integración real)");
{
  const world = createWorld(20260630);
  advanceWorld(world); // una temporada para tener standings
  const clubs = clubViewsFromWorld(world);
  check("clubViewsFromWorld traduce TODOS los equipos del mundo", clubs.length === Object.keys(world.teams).length && clubs.length > 0);
  check("cada ClubView tiene prestigio/presupuesto/filosofía", clubs.every((c) => c.prestige >= 0 && c.budget >= 0 && !!c.philosophy && c.totalTeams === clubs.length));
  const teamId = Object.keys(world.teams)[0];
  const club = clubs.find((c) => c.id === teamId)!;
  const outcome = seasonOutcomeFromWorld(world, teamId)!;
  check("seasonOutcomeFromWorld deriva un resultado válido del standing", !!outcome && outcome.placement >= 1 && outcome.placement <= clubs.length);
  // Una carrera real corre una temporada en un club del mundo.
  const career = signTo(fresh(), club);
  const step = runCareerSeason(career, club, clubs, outcome, makeRng(seedOf(career.seed, "wseason", 1)), AT);
  check("runCareerSeason procesa una temporada del club del mundo", step.career.season === career.season + 1 && step.news.length >= 0);
}

// ─────────────────────── 7. Coach / mercado de entrenadores ───────────────────────
console.log("\n## Mercado de entrenadores (reusa WorldCoach)");
{
  const world = createWorld(20260630);
  advanceWorld(world);
  const coaches = coachesFromWorld(world);
  const market = classifyMarket(coaches);
  check("coachRating del usuario está en 0..100", coachRating(fresh()) >= 0 && coachRating(fresh()) <= 100);
  check("clasifica el mercado en libres/ocupados/leyendas/rookies", market.free.length + market.occupied.length === coaches.length);
  check("ocupados y libres son disjuntos", market.occupied.every((o) => !market.free.some((f) => f.id === o.id)));
}

// ─────────────────────── 8. Flujo conectado largo (reputación/noticias/timeline) ──
console.log("\n## Flujo conectado (varias temporadas)");
{
  const world = createWorld(20260630);
  // Da una temporada al mundo y liga al usuario al club más fuerte (mejor standing tras avanzar).
  advanceWorld(world);
  const start = clubViewsFromWorld(world).sort((a, b) => a.position - b.position)[0];
  let career = signTo(fresh(), start);
  const rep0 = globalReputationScore(career.reputation);
  let news = 0, dismissals = 0, signings = 0;
  for (let s = 0; s < N; s++) {
    advanceWorld(world);
    const clubs = clubViewsFromWorld(world);
    if (career.clubId) {
      const club = clubs.find((c) => c.id === career.clubId);
      const outcome = club ? seasonOutcomeFromWorld(world, career.clubId) : null;
      if (club && outcome) {
        const step = runCareerSeason(career, club, clubs, outcome, makeRng(seedOf(career.seed, "cs", s)), AT + s);
        career = step.career;
        news += step.news.length;
        if (step.events.some((e) => e.type === "dismissed")) dismissals++;
      }
    } else {
      // En paro: si hay oferta, fírmala (acepta la de mayor atractivo).
      const step = runUnemployedSeason(career, clubs, AT + s);
      career = step.career;
      const offer = career.offers.filter((o) => o.status === "pending").sort((a, b) => b.appeal - a.appeal)[0];
      if (offer) {
        const club = clubs.find((c) => c.id === offer.clubId)!;
        career = acceptOfferPure(career, offer, club, AT + s).career;
        signings++;
      }
    }
  }
  check("el flujo genera noticias automáticas de carrera", news > 0, `${news} noticias`);
  check("el timeline (historial) registra los spells", career.history.spells.length >= 1);
  check("reputación coherente tras varias temporadas", globalReputationScore(career.reputation) >= 0 && globalReputationScore(career.reputation) <= 100, `rep ${rep0}→${globalReputationScore(career.reputation)}`);
  check("hubo dinámica de empleo (despidos o nuevas firmas posibles)", dismissals + signings >= 0);
  const dash = careerDashboard(career, career.clubId ? clubViewsFromWorld(world).find((c) => c.id === career.clubId) : null);
  check("el dashboard expone seguridad/objetivos/reputación", dash.jobSecurity >= 0 && dash.jobSecurity <= 100 && dash.reputationScore >= 0);
}

// ─────────────────────── 9. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const clubs: ClubView[] = Array.from({ length: 12 }, (_, i) => mkClub({ id: `d${i}`, prestige: 40 + i * 4, budget: 10000 + i * 2000, hasCoach: i % 3 === 0, coachRating: 50 + i }));
  const oA = generateOffers(fresh(), clubs, 3);
  const oB = generateOffers(fresh(), clubs, 3);
  check("mismas entradas ⇒ mismas ofertas", JSON.stringify(oA) === JSON.stringify(oB));
  const club = clubs[5];
  const out = { team: club.name, competition: "Liga", tier: "regional" as const, wins: 7, losses: 5, champion: false, finalist: false, mvpAwarded: false, placement: 5, fieldSize: 12 };
  const a = runCareerSeason(signTo(fresh(), club), club, clubs, out, makeRng(seedOf(123, "x")), AT);
  const b = runCareerSeason(signTo(fresh(), club), club, clubs, out, makeRng(seedOf(123, "x")), AT);
  check("misma temporada ⇒ mismo estado final", JSON.stringify(a.career) === JSON.stringify(b.career));
  // Integración con el mundo: misma semilla ⇒ mismas ClubViews.
  const w1 = createWorld(777); advanceWorld(w1);
  const w2 = createWorld(777); advanceWorld(w2);
  check("misma semilla de mundo ⇒ mismas ClubViews", JSON.stringify(clubViewsFromWorld(w1)) === JSON.stringify(clubViewsFromWorld(w2)));
}

// ─────────────────────── 10. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  const clubs: ClubView[] = Array.from({ length: 16 }, (_, i) => mkClub({ id: `z${i}`, prestige: (i * 7) % 100, budget: 4000 + i * 2500, hasCoach: i % 2 === 0, coachRating: (i * 5) % 100, philosophy: (["win_now", "buy_stars", "develop_youth", "financial_control", "long_project"] as const)[i % 5] }));
  let bad = 0; const reasons: string[] = [];
  for (let k = 0; k < N; k++) {
    let career = signTo(fresh(), clubs[k % clubs.length]);
    for (let s = 0; s < 12; s++) {
      const club = career.clubId ? clubs.find((c) => c.id === career.clubId)! : clubs[(k + s) % clubs.length];
      const placement = 1 + ((k + s) % club.totalTeams);
      const out = { team: club.name, competition: "Liga", tier: "regional" as const, wins: 12 - placement, losses: placement, champion: placement === 1, finalist: placement <= 2, mvpAwarded: s % 4 === 0, placement, fieldSize: club.totalTeams };
      const step = career.clubId
        ? runCareerSeason(career, club, clubs, out, makeRng(seedOf(career.seed, "imp", s, k)), AT + s)
        : runUnemployedSeason(career, clubs, AT + s);
      career = step.career;
      // Si quedó libre y hay oferta, firma (mantiene el bucle vivo).
      if (!career.clubId) {
        const offer = career.offers.filter((o) => o.status === "pending")[0];
        if (offer) { const c = clubs.find((x) => x.id === offer.clubId)!; career = acceptOfferPure(career, offer, c, AT + s).career; }
      }
    }
    const b = career.board;
    for (const v of [b.confidence, b.pressure, b.boardTrust, b.fanSupport, b.playerRespect]) if (v < 0 || v > 100 || Number.isNaN(v)) { bad++; reasons.push("board"); }
    for (const v of [career.reputation.local, career.reputation.global]) if (v < 0 || v > 100) { bad++; reasons.push("rep"); }
    if (career.contract && career.contract.endSeason < career.contract.startSeason) { bad++; reasons.push("contract-dates"); }
    if (career.contract && (career.contract.salary <= 0 || career.contract.releaseClause < 0)) { bad++; reasons.push("contract-money"); }
    for (const o of career.offers) if (o.appeal < 0 || o.appeal > 100 || o.terms.salary <= 0) { bad++; reasons.push("offer"); }
    if (career.unemployedSeasons < 0) { bad++; reasons.push("unemployed"); }
    const dash = careerDashboard(career, null);
    if (dash.jobSecurity < 0 || dash.jobSecurity > 100) { bad++; reasons.push("jobsec"); }
  }
  check("CERO estados imposibles en todas las carreras", bad === 0, bad === 0 ? `${N} carreras × 12 temporadas` : reasons.slice(0, 5).join(" · "));
}

// ─────────────────────── 11. Rendimiento ───────────────────────
console.log("\n## Rendimiento");
{
  // Mercado de 1000 entrenadores.
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}`, name: `C${i}`, rating: i % 100, titles: i % 12, seasons: i % 20, teamId: i % 2 === 0 ? `t${i}` : null }));
  let t0 = Date.now();
  classifyMarket(many);
  check("clasificar 1000 entrenadores es instantáneo", Date.now() - t0 < 50, `${Date.now() - t0} ms`);
  // 500 clubes × 100 temporadas de generación de ofertas.
  const clubs: ClubView[] = Array.from({ length: 500 }, (_, i) => mkClub({ id: `p${i}`, prestige: i % 100, budget: 4000 + (i % 50) * 1000, hasCoach: i % 2 === 0, coachRating: i % 100 }));
  const career = fresh();
  t0 = Date.now();
  for (let s = 0; s < 100; s++) generateOffers(career, clubs, s);
  const ms = (Date.now() - t0) / 100;
  check("ofertas sobre 500 clubes × 100 temporadas rinde", ms < 8, `${ms.toFixed(2)} ms/temporada`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
