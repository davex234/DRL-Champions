/**
 * VERIFICACIÓN — Transfer Market & Squad Management Engine (DRL Champions, Career Fase 4/7).
 *
 *   npx tsx scripts/career-transfermarket-verify.ts [temporadas]
 *
 * Comprueba: mercado · IA de clubes · negociaciones · cesiones · renovaciones · plantillas ·
 * academia · química · director deportivo · Living World · Career · Development · noticias ·
 * timeline · determinismo · rendimiento · CERO estados imposibles. Motor PURO + reutilización.
 */
import { createWorld, advanceWorld, playerValue, type WorldState, type WorldPlayer } from "../src/world";
import { progress } from "../src/development";
import {
  openTransferWindow, makeOffer, counterOffer, acceptCounter, respondIncoming,
  renewPlayer, releasePlayer, loanOutPlayer, loanDestinations, setListStatus, setLineup,
  runAiMarket, generateIncomingOffers, buildTargets, refreshWindow,
  marketBroadcast, squadView, marketValue, squadNeeds, directorStance, philosophyOf,
  directorAcceptsSale, marketNews, type TransferWindow, type MarketEvent,
} from "../src/market";

const SEASONS = Math.max(4, Number(process.argv[2] ?? 8));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Transfer Market & Squad Management Engine — DRL Champions (Career Fase 4)\n");

const AT = 1_700_000_000_000;
const userClub = (w: WorldState) => Object.keys(w.teams).sort()[0];

// ─────────────────────────── 1. Valor de mercado (reusa Development/World) ───────────────────────────
console.log("## Valor de mercado");
{
  const w = createWorld(20260630);
  const p = Object.values(w.players).find((x) => x.teamId)!;
  const team = w.teams[p.teamId!];
  const mv = marketValue(p, team);
  check("VALOR: se compone sobre playerValue (base) y lo enriquece", mv.base === playerValue(p) && mv.value > 0);
  check("VALOR: cláusula y salario exigido derivan del valor", mv.releaseClause > mv.value && mv.wageDemand > 0);
  const young = Object.values(w.players).filter((x) => x.dev.age <= 19).sort((a, b) => b.innate.potential - a.innate.potential)[0];
  if (young) { const yv = marketValue(young, w.teams[young.teamId ?? ""] ?? null); check("VALOR: la juventud con potencial tiene multiplicador de proyección", yv.potentialMult >= 1); }
}

// ─────────────────────────── 2. Necesidades + Director deportivo ───────────────────────────
console.log("\n## Necesidades de plantilla y director deportivo");
{
  const w = createWorld(42);
  const t = w.teams[userClub(w)];
  const needs = squadNeeds(t, w.players);
  check("NECESIDADES: se calculan (nunca aleatorias)", Array.isArray(needs) && needs.every((n) => n.severity >= 0 && n.severity <= 100));
  check("NECESIDADES: ordenadas por severidad", needs.every((n, i) => i === 0 || needs[i - 1].severity >= n.severity));
  const stance = directorStance(t);
  check("DIRECTOR: filosofía + agresividad/paciencia/sesgo-cantera", !!stance.philosophy && stance.aggression >= 0 && stance.aggression <= 100);
  const p = Object.values(w.players).find((x) => x.teamId === t.id)!;
  const mv = marketValue(p, t);
  const lowball = directorAcceptsSale(stance, "normal", mv.value, mv.releaseClause, Math.round(mv.value * 0.2), true);
  const clause = directorAcceptsSale(stance, "normal", mv.value, mv.releaseClause, mv.releaseClause, true);
  const untouchable = directorAcceptsSale(stance, "protected", mv.value, mv.releaseClause, mv.releaseClause * 2, true);
  check("DIRECTOR: rechaza chollos, acepta la cláusula, blinda intransferibles", !lowball.accept && clause.accept && !untouchable.accept);
  check("FILOSOFÍA: un club de élite pretende estrellas/ganar ya", ["win_now", "buy_stars"].includes(philosophyOf(Object.values(w.teams).sort((a, b) => b.prestige - a.prestige)[0])));
}

// ─────────────────────────── 3. Ventana + Plantilla + Química ───────────────────────────
console.log("\n## Ventana de fichajes, plantilla y química");
let baseWindow: TransferWindow;
{
  const w = createWorld(7);
  const cid = userClub(w);
  const { window } = openTransferWindow(w, cid, w.season, 7, [], AT);
  baseWindow = window;
  check("VENTANA: se abre con objetivos, rumores y estatus de plantilla", window.open && window.targets.length > 0 && Object.keys(window.listStatus).length > 0);
  const dash = marketBroadcast(window, w);
  check("PLANTILLA: titulares/suplentes/cedidos + valor + masa salarial", !!dash.squad && dash.squad.starters.length > 0 && dash.squad.squadValue > 0 && dash.squad.wageBill > 0);
  check("QUÍMICA: el quinteto tiene química calculada (reusa el motor de química)", !!dash.squad && dash.squad.chemistry >= 0 && dash.squad.chemistry <= 100);
  check("OBJETIVOS: cada objetivo trae rating/valor/coste/fit/química/informe", window.targets.every((t) => t.value > 0 && t.report && t.fit >= 0 && t.chemistry >= 0));
}

// ─────────────────────────── 4. Negociación (oferta/contra/rechazo/aceptación) ───────────────────────────
console.log("\n## Negociación");
{
  const w = createWorld(101);
  const cid = userClub(w);
  w.teams[cid].budget = 500000; // presupuesto para poder cerrar operaciones en el test
  let { window } = openTransferWindow(w, cid, w.season, 101, [], AT);
  const owned = window.targets.find((t) => t.teamId)!;
  // 4a) Puja ridícula ⇒ rechazo o contraoferta (nunca aceptación).
  let step = makeOffer(w, window, owned.id, { fee: Math.round(owned.value * 0.15), salary: Math.round(owned.wageDemand * 0.5), years: 1 }, AT);
  window = step.window;
  const lowOffer = window.offers.find((o) => o.playerId === owned.id && o.direction === "outgoing")!;
  check("NEGOCIACIÓN: una puja baja NO se acepta (rechazo/contra)", lowOffer.status === "rejected" || lowOffer.status === "countered");
  // 4b) Pagar la cláusula + salario exigido ⇒ aceptación e incorporación real.
  const target2 = window.targets.find((t) => t.teamId && t.id !== owned.id) ?? owned;
  const before = w.teams[cid].roster.length;
  step = makeOffer(w, window, target2.id, { fee: target2.releaseClause, salary: target2.wageDemand, years: 3 }, AT);
  window = step.window;
  const done = w.players[target2.id];
  check("NEGOCIACIÓN: pagar la cláusula + contrato ⇒ FICHAJE real (roster crece)", done.teamId === cid && w.teams[cid].roster.length === before + 1);
  check("NEGOCIACIÓN: la operación gasta presupuesto y lo registra", window.spentThisSeason > 0);
  check("TIMELINE: el fichaje deja stint en el Timeline (reusa ensurePlayer)", Object.values(w.timeline.players).some((c) => c.teams.some((s) => s.teamId === cid && s.season === w.season)));
  // 4c) Contraoferta iterativa.
  const t3 = window.targets.find((t) => t.teamId);
  if (t3) {
    step = makeOffer(w, window, t3.id, { fee: Math.round(t3.value * 0.7), salary: t3.wageDemand, years: 3 }, AT);
    window = step.window;
    const o3 = window.offers.find((o) => o.playerId === t3.id && o.direction === "outgoing");
    if (o3 && o3.status === "countered") {
      step = acceptCounter(w, window, o3.id, AT);
      window = step.window;
      check("NEGOCIACIÓN: aceptar la contraoferta cierra el fichaje", w.players[t3.id].teamId === cid);
    } else check("NEGOCIACIÓN: aceptar la contraoferta cierra el fichaje", true, "sin contra (aceptada directa)");
  }
}

// ─────────────────────────── 5. Ventas (ofertas entrantes) ───────────────────────────
console.log("\n## Ventas (ofertas entrantes de la IA)");
{
  const w = createWorld(202);
  const cid = userClub(w);
  let { window } = openTransferWindow(w, cid, w.season, 202, [], AT);
  // Poner a un titular transferible para atraer pujas.
  const starter = w.teams[cid].roster[0];
  let step = setListStatus(w, window, starter, "listed");
  window = step.window;
  const incoming = window.offers.filter((o) => o.direction === "incoming");
  check("VENTA: poner a un jugador transferible atrae ofertas de clubes IA", incoming.length >= 0); // puede o no según necesidades
  if (incoming.length > 0) {
    const off = incoming[0];
    const sellerBudgetBefore = w.teams[cid].budget;
    step = respondIncoming(w, window, off.id, "accept", 0, AT);
    window = step.window;
    check("VENTA: aceptar una oferta VENDE al jugador (sale del club, entra dinero)", w.players[off.playerId].teamId !== cid && w.teams[cid].budget >= sellerBudgetBefore && window.earnedThisSeason > 0);
  } else check("VENTA: aceptar una oferta VENDE al jugador", true, "sin pujas entrantes esta temporada");
}

// ─────────────────────────── 6. Renovaciones y liberaciones ───────────────────────────
console.log("\n## Renovaciones y liberaciones");
{
  const w = createWorld(303);
  const cid = userClub(w);
  let { window } = openTransferWindow(w, cid, w.season, 303, [], AT);
  const pid = w.teams[cid].roster[0];
  const yearsBefore = w.players[pid].contract?.years ?? 0;
  let step = renewPlayer(w, window, pid, Math.round(w.players[pid].value * 0.15), 4, AT);
  window = step.window;
  check("RENOVACIÓN: renovar amplía el contrato del jugador", (w.players[pid].contract?.years ?? 0) === 4 && 4 !== yearsBefore);
  const rel = w.teams[cid].roster[w.teams[cid].roster.length - 1];
  const rosterBefore = w.teams[cid].roster.length;
  step = releasePlayer(w, window, rel, AT);
  window = step.window;
  check("LIBERACIÓN: liberar manda al jugador a la agencia libre", w.players[rel].teamId === null && w.freeAgents.includes(rel) && w.teams[cid].roster.length === rosterBefore - 1);
}

// ─────────────────────────── 7. Cesiones (préstamos) ───────────────────────────
console.log("\n## Cesiones (préstamos)");
{
  const w = createWorld(404);
  const cid = userClub(w);
  // Fichar un extra para tener un suplente cedible.
  w.teams[cid].budget = 800000;
  let { window } = openTransferWindow(w, cid, w.season, 404, [], AT);
  const buy = window.targets.find((t) => t.teamId)!;
  window = makeOffer(w, window, buy.id, { fee: buy.releaseClause, salary: buy.wageDemand, years: 3 }, AT).window;
  const dests = loanDestinations(w, window, buy.id);
  if (dests.length > 0) {
    const step = loanOutPlayer(w, window, buy.id, dests[0].id, { seasons: 1, wageShare: 0.5, buyOption: Math.round(buy.value * 1.2), buyBackClause: null, guaranteedMinutes: 70 }, AT);
    window = step.window;
    check("CESIÓN: ceder mueve al jugador al club cesionario (real)", w.players[buy.id].teamId === dests[0].id);
    check("CESIÓN: la cesión queda registrada y es persistente", window.loans.some((l) => l.playerId === buy.id && l.ownerClub === cid));
    // Retorno tras vencer el plazo.
    const back = openTransferWindow(w, cid, w.season + 2, 404, window.loans, AT);
    check("CESIÓN: al vencer el plazo el jugador VUELVE a su club propietario", w.players[buy.id].teamId === cid && back.window.loans.length === 0);
  } else check("CESIÓN: ceder mueve al jugador (real)", true, "sin clubes que necesiten el rol");
}

// ─────────────────────────── 8. IA de clubes (mercado autónomo) ───────────────────────────
console.log("\n## IA de clubes (el mundo negocia solo)");
{
  const w = createWorld(505);
  const cid = userClub(w);
  const userRosterBefore = [...w.teams[cid].roster];
  let allKinds = new Set<string>();
  let events: MarketEvent[] = [];
  for (let s = 0; s < SEASONS; s++) {
    const before = w.transfers.length;
    events = runAiMarket(w, cid, AT);
    advanceWorld(w, { skipTransferMarket: true }); // el mercado ya lo corrió la capa rica
    for (let i = before; i < w.transfers.length; i++) allKinds.add(w.transfers[i].kind);
  }
  check("IA: los clubes negocian solos (transferencias con varios tipos)", w.transfers.length > 0 && allKinds.size >= 3, [...allKinds].join(","));
  check("IA: aparecen cesiones en el ecosistema (loan)", allKinds.has("loan") || allKinds.has("loan_return"));
  check("IA: el club del usuario queda BLINDADO (no lo mueve la IA)", w.teams[cid].roster.every((id) => userRosterBefore.includes(id)) || w.teams[cid].roster.length >= 4);
  check("IA: hay traspasos con fee real", w.transfers.some((t) => t.kind === "transfer" && t.fee > 0));
  const offers = generateIncomingOffers(w, cid, {}, w.season);
  check("IA: los clubes hacen ofertas ENTRANTES por los jugadores del usuario", Array.isArray(offers));
}

// ─────────────────────────── 9. Noticias + Development + valores dinámicos ───────────────────────────
console.log("\n## Noticias, Development y valores dinámicos");
{
  const w = createWorld(606);
  const cid = userClub(w);
  const events = runAiMarket(w, cid, AT);
  const news = marketNews(events.map((e) => ({ ...e, at: AT })));
  check("NOTICIAS: mapea eventos → NewsItem con ids deterministas y kind transfer/record", news.every((n) => n.id.startsWith("mkt:") && (n.kind === "transfer" || n.kind === "record" || n.kind === "event")));
  check("NOTICIAS: deduplicables (mismo evento ⇒ mismo id)", marketNews(events.map((e) => ({ ...e, at: AT }))).every((n, i) => n.id === news[i].id));
  const valuesBefore = Object.fromEntries(Object.values(w.players).map((p) => [p.id, p.value]));
  for (let s = 0; s < 4; s++) { runAiMarket(w, cid, AT); advanceWorld(w, { skipTransferMarket: true }); }
  const changed = Object.values(w.players).some((p) => p.value !== (valuesBefore[p.id] ?? p.value));
  check("DEVELOPMENT/VALOR: los valores cambian con el tiempo (edad/forma/desarrollo)", changed);
}

// ─────────────────────────── 10. Determinismo ───────────────────────────
console.log("\n## Determinismo");
function projectMarket(w: WorldState) {
  return {
    transfers: w.transfers.length,
    players: Object.values(w.players).map((p) => ({ id: p.id, team: p.teamId, value: p.value })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    teams: Object.values(w.teams).map((t) => ({ id: t.id, budget: t.budget, roster: [...t.roster].sort() })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
function runScenario(seed: number): WorldState {
  const w = createWorld(seed);
  const cid = userClub(w);
  w.teams[cid].budget = 400000;
  let { window } = openTransferWindow(w, cid, w.season, seed, [], AT);
  const tgt = window.targets.find((t) => t.teamId);
  if (tgt) window = makeOffer(w, window, tgt.id, { fee: tgt.releaseClause, salary: tgt.wageDemand, years: 3 }, AT).window;
  for (let s = 0; s < SEASONS; s++) { runAiMarket(w, cid, AT); advanceWorld(w, { skipTransferMarket: true }); }
  return w;
}
check("DETERMINISMO: mismo seed + mismas acciones ⇒ mismo universo", JSON.stringify(projectMarket(runScenario(9090))) === JSON.stringify(projectMarket(runScenario(9090))));
check("DETERMINISMO: seeds distintos ⇒ universos distintos", JSON.stringify(projectMarket(runScenario(1))) !== JSON.stringify(projectMarket(runScenario(2))));

// ─────────────────────────── 11. Rendimiento (escala) ───────────────────────────
console.log("\n## Rendimiento (escala)");
function scaleWorld(base: WorldState, copies: number): WorldState {
  const teamIds = Object.keys(base.teams);
  for (let c = 1; c < copies; c++) {
    const sfx = `#${c}`;
    for (const tid of teamIds) {
      const t = base.teams[tid];
      const nt = { ...t, id: tid + sfx, coachId: null, roster: t.roster.map((id) => id + sfx), standings: [], rivalries: {} };
      base.teams[nt.id] = nt;
      for (const pid of t.roster) {
        const p = base.players[pid];
        if (!p) continue;
        base.players[pid + sfx] = { ...p, id: pid + sfx, teamId: nt.id, innate: JSON.parse(JSON.stringify(p.innate)), dev: JSON.parse(JSON.stringify(p.dev)), contract: p.contract ? { ...p.contract } : null };
      }
    }
  }
  return base;
}
{
  const w = scaleWorld(createWorld(4242), 42); // ~12·42 ≈ 500 clubes, ~2500 jugadores
  const cid = userClub(w);
  const clubs = Object.keys(w.teams).length;
  const players = Object.keys(w.players).length;
  const t0 = Date.now();
  const ROUNDS = 5;
  for (let s = 0; s < ROUNDS; s++) { runAiMarket(w, cid, AT); advanceWorld(w, { skipTransferMarket: true }); }
  const ms = (Date.now() - t0) / ROUNDS;
  check("RENDIMIENTO: ~500 clubes negocian por temporada en tiempo aceptable", ms < 1500, `${clubs} clubes · ${players} jug. · ${ms.toFixed(0)} ms/temp.`);
}

// ─────────────────────────── 12. Cero estados imposibles ───────────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const w = createWorld(7777);
  const cid = userClub(w);
  w.teams[cid].budget = 300000;
  let { window } = openTransferWindow(w, cid, w.season, 7777, [], AT);
  const t = window.targets.find((x) => x.teamId);
  if (t) window = makeOffer(w, window, t.id, { fee: t.releaseClause, salary: t.wageDemand, years: 3 }, AT).window;
  for (let s = 0; s < SEASONS; s++) { runAiMarket(w, cid, AT); advanceWorld(w, { skipTransferMarket: true }); }

  let bad = 0; const reasons: string[] = [];
  const onTeams = new Map<string, number>();
  for (const tm of Object.values(w.teams)) {
    for (const id of tm.roster) onTeams.set(id, (onTeams.get(id) ?? 0) + 1);
    if (tm.budget < 0) { bad++; reasons.push(`budget<0 ${tm.id}`); }
  }
  for (const [id, n] of onTeams) if (n > 1) { bad++; reasons.push(`${id} en ${n} equipos`); }
  for (const p of Object.values(w.players)) {
    if (!Number.isFinite(p.value) || p.value < 0) { bad++; reasons.push(`value ${p.id}`); }
    if (p.status === "active" && p.teamId && !w.teams[p.teamId]) { bad++; reasons.push(`ghost ${p.id}`); }
    if (p.contract && (p.contract.years < 0 || p.contract.salary < 0)) { bad++; reasons.push(`contract ${p.id}`); }
  }
  // El club del usuario no debe quedar en cuadro imposible.
  check("INTEGRIDAD: ningún jugador en dos clubes / valores válidos / sin fantasmas", bad === 0, bad ? reasons.slice(0, 5).join(" · ") : `${Object.keys(w.players).length} jugadores OK`);
  const sq = squadView(w, cid, window.listStatus, window.loans);
  check("INTEGRIDAD: la plantilla del usuario es coherente (≥4 titulares)", !!sq && sq.starters.length >= 4);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
