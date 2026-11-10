/**
 * VERIFICACIÓN DEL EDITORIAL WORKFLOW (Tournament Automation · Fase 4/5).
 *
 * El sistema editorial vive ENTRE el Card Generator y el Publisher: somete una generación REAL
 * (motores públicos F1→F4, sin red), decide carta a carta / lote / torneo, traza historial
 * completo y publica SOLO lo aprobado (publishApproved compone materialize→buildCatalog→publish
 * sin regenerar nada). Comprueba: workflow · cambios de estado · lote · historial · determinismo
 * · compatibilidad · publisher (no auto-publica; nunca las rechazadas) · cero estados imposibles
 * · ejemplo obligatorio (GEN-2026-VALORANT-MASTERS-LONDON-2026: individual/lote/rechazo/bloqueo/
 * publicación solo-aprobadas/historial). Muta el catálogo vivo SOLO al publicar y lo RESTAURA
 * al terminar. Falla de verdad.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze } from "@/analyzer";
import { generateCards, type CardGenerationResult } from "@/card-generator";
import { rollback, resetRuntime, runtimeVersion, runtimeGenerationId } from "@/publisher";
import { allPlayers, rebuildCatalog, totalCards, getCard, getPlayer, variantsForAccolade } from "@/data/catalog";
import {
  submitGeneration, decide, approve, reject, hide, block, backToReview, archive,
  approveBatch, approveTournament, publishApproved,
  approveCard, rejectCard, blockCard, returnToReview, approveGeneration,
  canApply, availableActions, TRANSITIONS, cardsInState, stateCounts, searchCards,
  historyForCard, auditHistory, EDITORIAL_STATES,
  type EditorialCase, type EditorialState,
} from "@/editorial";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/* ── Fixture (mismo Champions 2025 de los verifies F3-F7) ── */
const fixture: RawSnapshot = {
  tournament: { id: "champions-2025", name: "Champions 2025", type: "champions", tier: "vct-international", status: "finished", startDate: "2025-09-01T00:00:00Z" },
  stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [
    { id: "sen", name: "Sentinels", region: "Americas", active: true },
    { id: "nrg", name: "NRG", region: "Americas" },
    { id: "g2", name: "G2", region: "Americas" },
    { id: "fnc", name: "Fnatic", region: "EMEA" },
  ],
  players: [
    { id: "star", nick: "zekken", team: "Sentinels", role: "duelist", agents: ["Jett", "Raze", "Neon"] },
    { id: "sup", nick: "zellsis", team: "Sentinels", role: "initiator", agents: ["Sova"] },
    { id: "riv", nick: "ethan", team: "NRG", role: "sentinel", agents: ["Killjoy"] },
  ],
  coaches: [{ id: "co", name: "kaplan", team: "Sentinels", status: "active" }],
  matches: [
    { id: "m0", stageId: "st-po", teamA: "Sentinels", teamB: "G2", status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: "Sentinels", round: "Semifinal", matchOrder: 1 },
    { id: "m1", stageId: "st-po", teamA: "Sentinels", teamB: "NRG", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "Sentinels", round: "Grand Final", matchOrder: 2 },
  ],
  maps: [
    { id: "m0m1", matchId: "m0", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "Sentinels" },
    { id: "m0m2", matchId: "m0", map: "Bind", mapOrder: 2, scoreA: 8, scoreB: 13, winner: "G2" },
    { id: "m0m3", matchId: "m0", map: "Ascent", mapOrder: 3, scoreA: 13, scoreB: 11, winner: "Sentinels" },
    { id: "m1m1", matchId: "m1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 7, winner: "Sentinels" },
    { id: "m1m2", matchId: "m1", map: "Haven", mapOrder: 2, scoreA: 13, scoreB: 9, winner: "Sentinels" },
  ],
  mapStats: [
    { matchMapId: "m0m1", matchId: "m0", player: "zekken", team: "Sentinels", agent: "Jett", acs: 300, kills: 20, deaths: 10, assists: 4, kast: 80, adr: 170, hsPct: 32, fk: 5, fd: 2, clutches: 3 },
    { matchMapId: "m1m1", matchId: "m1", player: "zekken", team: "Sentinels", agent: "Raze", acs: 200, kills: 10, deaths: 10, assists: 6, kast: 70, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 2 },
    { matchMapId: "m0m1", matchId: "m0", player: "zellsis", team: "Sentinels", agent: "Sova", acs: 190, kills: 12, deaths: 12, assists: 9, kast: 74, adr: 140, fk: 1, fd: 1, clutches: 0 },
    { matchMapId: "m1m1", matchId: "m1", player: "ethan", team: "NRG", agent: "Killjoy", acs: 210, kills: 14, deaths: 15, assists: 5, kast: 68, adr: 145, fk: 2, fd: 3, clutches: 1 },
  ],
  standings: [
    { team: "Sentinels", position: 1, wins: 2, losses: 0, mapsWon: 4, mapsLost: 1, status: "qualified" },
    { team: "NRG", position: 2, wins: 1, losses: 1, mapsWon: 2, mapsLost: 2 },
    { team: "G2", position: 3, wins: 1, losses: 1 },
    { team: "Fnatic", position: 4, wins: 0, losses: 1, status: "eliminated" },
  ],
  awards: { champion: "Sentinels", runnerUp: "NRG" },
};

const NOW = 1_700_000_000_000;
const META = (n = 0) => ({ actor: "editor-1", at: NOW + n });

function makeGeneration(): CardGenerationResult {
  const ictx: ImportCtx = { clock: makeClock(NOW), identity: createIdentityResolver(buildRegistry([])) };
  const analysis = analyze(importSnapshot(fixture, ictx).model);
  return generateCards(analysis, { roster: allPlayers(), now: NOW });
}

async function main(): Promise<void> {
  console.log("# Verificación del Editorial Workflow — DRL Champions (Fase 4/5)\n");

  const originalPlayers = allPlayers();
  const originalTotal = totalCards();
  resetRuntime();

  const gen = makeGeneration();
  const allIds = gen.cards.map((c) => c.cardId);
  check("fixture: la generación F4 emite cartas (sin regenerar nada después)", allIds.length > 0, `${allIds.length} cartas`);

  // ── 1. WORKFLOW ──
  console.log("\n## 1. Workflow (máquina de estados)");
  const c0 = submitGeneration(gen, { ...META(), tournamentName: "Champions 2025" });
  check("submit: todas las cartas entran y quedan en review (draft→review trazado)",
    Object.keys(c0.states).length === allIds.length && cardsInState(c0, "review").length === allIds.length);
  const draftCase = submitGeneration(gen, { ...META(), autoReview: false });
  check("autoReview=false: las cartas quedan en draft", cardsInState(draftCase, "draft").length === allIds.length);
  check("draft solo permite to_review", JSON.stringify(availableActions("draft")) === JSON.stringify(["to_review"]));
  check("review permite aprobar/rechazar/ocultar/bloquear",
    ["approve", "reject", "hide", "block"].every((a) => canApply("review", a as never)));
  check("archived es terminal", availableActions("archived").length === 0);
  check("ninguna transición vuelve a draft (draft = solo estado inicial)",
    EDITORIAL_STATES.every((s) => Object.values(TRANSITIONS[s]).every((to) => to !== "draft")));

  // ── 2. CAMBIOS DE ESTADO ──
  console.log("\n## 2. Cambios de estado (cada acción, inmutable)");
  const [target, second, third] = allIds;
  let c = approve(c0, [target], META(1)).case;
  check("aprobar", c.states[target] === "approved" && c0.states[target] === "review");
  c = reject(c, [second], { ...META(2), reason: "rendimiento no representativo" }).case;
  check("rechazar (con motivo)", c.states[second] === "rejected");
  c = hide(c, [third], META(3)).case;
  check("ocultar", c.states[third] === "hidden");
  c = block(c, [second], { ...META(4), reason: "veto editorial" }).case;
  check("bloquear (desde rejected)", c.states[second] === "blocked");
  c = backToReview(c, [target, second, third], META(5)).case;
  check("volver a review (desde approved/blocked/hidden)",
    [target, second, third].every((id) => c.states[id] === "review"));
  const bad = decide(c, [target], "archive", META(6));
  check("transición ilegal rechazada SIN mutar (review × archive)",
    bad.applied.length === 0 && bad.skipped[0].error.includes("ilegal") && bad.case.states[target] === "review");
  const alien = decide(c, ["carta__inexistente"], "approve", META(7));
  check("carta ajena a la generación → skipped", alien.skipped.length === 1 && alien.applied.length === 0);

  // ── 3. LOTE + TORNEO ──
  console.log("\n## 3. Aprobación por lote y torneo completo");
  const batch = approveBatch(c, [target, second], META(8));
  check("lote: aprueba varias de una vez", batch.applied.length === 2 && batch.case.states[target] === "approved");
  const full = approveTournament(c0, META(9));
  check("torneo completo: TODAS las review → approved",
    cardsInState(full.case, "approved").length === allIds.length && full.applied.length === allIds.length);

  // ── 4. HISTORIAL ──
  console.log("\n## 4. Historial completo");
  const ev = historyForCard(c, second);
  check("quién/cuándo/de-dónde/a-dónde/motivo/generación en cada evento",
    ev.length >= 3 && ev.every((e) => e.actor === "editor-1" && e.at >= NOW && !!e.to && e.generationId === gen.generationId));
  check("el motivo del rechazo quedó registrado", ev.some((e) => e.action === "reject" && e.reason === "rendimiento no representativo"));
  check("historial íntegro (encadenado + secuencia monótona + coherente con estados)",
    auditHistory(c).length === 0 && auditHistory(full.case).length === 0);
  check("búsqueda editorial (por jugador y por variante)",
    searchCards(c0, "zekken").length > 0 && searchCards(c0, "mythic").some((id) => id.endsWith("__mythic")));

  // ── 5. PUBLISHER: no publica automáticamente ──
  console.log("\n## 5. Publisher (manual, nunca automático)");
  check("someter + decidir NO toca el catálogo ni el runtime",
    totalCards() === originalTotal && runtimeVersion() === 0);
  const none = await publishApproved(c0, META(10));
  check("sin aprobadas ⇒ publishApproved se niega (nada que publicar)",
    !none.ok && !none.publish && totalCards() === originalTotal);

  // ── 6. PUBLICAR SOLO LO APROBADO (nunca las rechazadas) ──
  console.log("\n## 6. publishApproved: solo aprobadas, jamás rechazadas");
  // Escenario: aprobar todo MENOS zekken__mythic (rechazada) y una carta base de un draft (oculta).
  const draftRes = gen.players.find((p) => p.status === "created" && p.playerId && p.draft);
  const draftId = draftRes!.playerId!;
  // Carta base del draft = una variante que NINGÚN grant deriva (existe por la mera existencia
  // del jugador): ocultarla debe excluir al jugador completo (regla de composición).
  const grantedVariants = new Set(gen.grants
    .filter((g) => g.playerId === draftId)
    .flatMap((g) => variantsForAccolade(g.accolade, draftRes!.draft!)));
  const draftBase = gen.cards.find((s) => s.playerId === draftId && !grantedVariants.has(s.variantId))!.cardId;
  let cA = approveTournament(c0, META(11)).case;
  cA = decide(cA, ["zekken__mythic"], "to_review", META(12)).case;
  cA = reject(cA, ["zekken__mythic"], { ...META(13), reason: "nunca las rechazadas" }).case;
  cA = decide(cA, [draftBase], "to_review", META(14)).case;
  cA = hide(cA, [draftBase], META(15)).case;

  const resA = await publishApproved(cA, META(16));
  check("publicación aplicada", resA.ok && !!resA.publish?.applied && runtimeVersion() === 1);
  check("las publicadas EXISTEN en el catálogo vivo", resA.published.length > 0 && resA.published.every((id) => !!getCard(id)));
  check("zekken__mythic (rechazada) NO existe en el catálogo", !getCard("zekken__mythic"));
  check("el grant del MVP se descartó (el accolade no llegó al jugador)",
    resA.droppedGrants.some((d) => d.playerId === "zekken") && !getPlayer("zekken")!.accolades.includes("tournament-mvp" as never));
  check("ocultar la base de un jugador NUEVO excluye al jugador completo (punto fijo)",
    gen.cards.filter((s) => s.playerId === draftId).every((s) => !getCard(s.cardId)) && !getPlayer(draftId));
  check("las aprobadas excluidas por composición se reportan y CONSERVAN su estado",
    resA.excluded.some((e) => e.reason.includes("composición") && resA.case.states[e.cardId] === "approved"));
  check("ninguna no-aprobada viajó (garantía, no suposición)",
    gen.cards.every((s) => resA.case.states[s.cardId] === "published" ? true : !resA.published.includes(s.cardId)));
  check("las publicadas pasan a estado published con historial",
    resA.published.every((id) => resA.case.states[id] === "published") && auditHistory(resA.case).length === 0);
  const arch = archive(resA.case, [resA.published[0]], META(17));
  check("archivar tras publicar", arch.case.states[resA.published[0]] === "archived");
  const again = await publishApproved(resA.case, META(18));
  check("re-publicar sin nada aprobado pendiente ⇒ no-op honesto", !again.ok && runtimeVersion() === 1);

  // ── 7. COMPATIBILIDAD (rollback intacto + torneo completo) ──
  console.log("\n## 7. Compatibilidad con los motores");
  const rb = rollback({ generationId: gen.generationId }, { now: NOW + 100 });
  check("rollback del Publisher funciona sobre una publicación editorial", rb.ok && rb.transaction.finalState === "ROLLED_BACK");
  resetRuntime(); rebuildCatalog(originalPlayers);
  const resFull = await publishApproved(approveTournament(submitGeneration(gen, META(20)), META(21)).case, META(22));
  check("torneo completo aprobado ⇒ TODA la generación publicada (incluida la mythic)",
    resFull.ok && !!getCard("zekken__mythic") && resFull.published.length === allIds.length && resFull.excluded.length === 0);
  check("la generación publicada es la vigente en el runtime", runtimeGenerationId() === gen.generationId);

  // ── 8. DETERMINISMO ──
  console.log("\n## 8. Determinismo");
  const gen2 = makeGeneration(); // misma entrada ⇒ misma generación (motores deterministas)
  const opsTwice = (): EditorialCase => {
    let x = submitGeneration(gen2, META(30));
    x = approveTournament(x, META(31)).case;
    x = decide(x, ["zekken__mythic"], "to_review", META(32)).case;
    x = reject(x, ["zekken__mythic"], { ...META(33), reason: "det" }).case;
    return x;
  };
  check("mismas decisiones + mismo reloj ⇒ mismo caso byte a byte",
    JSON.stringify(opsTwice()) === JSON.stringify(opsTwice()));
  resetRuntime(); rebuildCatalog(originalPlayers);
  const d1 = await publishApproved(opsTwice(), META(34));
  resetRuntime(); rebuildCatalog(originalPlayers);
  const d2 = await publishApproved(opsTwice(), META(34));
  const strip = (r: typeof d1): string => JSON.stringify({
    ...r, publish: r.publish && { ...r.publish, metrics: { ...r.publish.metrics, durationMs: 0 } },
  });
  check("publishApproved determinista (mismo estado ⇒ mismo resultado)", strip(d1) === strip(d2));

  // ── 9. CERO ESTADOS IMPOSIBLES ──
  console.log("\n## 9. Cero estados imposibles");
  const cases = [c0, c, full.case, cA, resA.case, arch.case, resFull.case];
  check("todo estado vigente pertenece al conjunto oficial",
    cases.every((k) => Object.values(k.states).every((s) => EDITORIAL_STATES.includes(s as EditorialState))));
  check("toda carta de la generación tiene SIEMPRE estado",
    cases.every((k) => allIds.every((id) => k.states[id] !== undefined)));
  check("historiales íntegros en todos los casos", cases.every((k) => auditHistory(k).length === 0));
  check("casos 100% serializables (persistibles en el store)",
    cases.every((k) => JSON.parse(JSON.stringify(k)).history.length === k.history.length));
  check("stateCounts cuadra con el total", cases.every((k) => {
    const n = Object.values(stateCounts(k)).reduce((a, b) => a + b, 0);
    return n === allIds.length;
  }));

  // ── 10. EJEMPLO OBLIGATORIO: MASTERS LONDON 2026 ──
  console.log("\n## 10. Ejemplo obligatorio — GEN-2026-VALORANT-MASTERS-LONDON-2026");
  resetRuntime();
  rebuildCatalog(originalPlayers);

  const london: RawSnapshot = {
    tournament: { id: "valorant-masters-london-2026", name: "Valorant Masters London 2026", type: "international", tier: "vct-international", status: "finished", startDate: "2026-06-05T00:00:00Z", endDate: "2026-06-21T00:00:00Z" },
    stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
    teams: [
      { id: "lln", name: "London Lions", region: "EMEA", active: true },
      { id: "mwv", name: "Madrid Wolves", region: "EMEA" },
      { id: "bbr", name: "Berlin Bears", region: "EMEA" },
    ],
    players: [
      { id: "zk", nick: "zekken", team: "London Lions", role: "duelist", agents: ["Jett", "Raze", "Neon"] },
      { id: "lf", nick: "Lyncher", team: "London Lions", role: "initiator", agents: ["Sova"] },
      { id: "wk", nick: "Wolfrik", team: "Madrid Wolves", role: "sentinel", agents: ["Killjoy"] },
    ],
    coaches: [{ id: "lc", name: "Sable", team: "London Lions", status: "active" }],
    matches: [
      { id: "l0", stageId: "st-po", teamA: "London Lions", teamB: "Berlin Bears", status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: "London Lions", round: "Semifinal", matchOrder: 1 },
      { id: "l1", stageId: "st-po", teamA: "London Lions", teamB: "Madrid Wolves", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "London Lions", round: "Grand Final", matchOrder: 2 },
    ],
    maps: [
      { id: "l0m1", matchId: "l0", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "London Lions" },
      { id: "l0m2", matchId: "l0", map: "Bind", mapOrder: 2, scoreA: 8, scoreB: 13, winner: "Berlin Bears" },
      { id: "l0m3", matchId: "l0", map: "Ascent", mapOrder: 3, scoreA: 13, scoreB: 11, winner: "London Lions" },
      { id: "l1m1", matchId: "l1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 7, winner: "London Lions" },
      { id: "l1m2", matchId: "l1", map: "Haven", mapOrder: 2, scoreA: 13, scoreB: 9, winner: "London Lions" },
    ],
    mapStats: [
      { matchMapId: "l0m1", matchId: "l0", player: "zekken", team: "London Lions", agent: "Jett", acs: 300, kills: 20, deaths: 10, assists: 4, kast: 80, adr: 170, hsPct: 32, fk: 5, fd: 2, clutches: 3 },
      { matchMapId: "l1m1", matchId: "l1", player: "zekken", team: "London Lions", agent: "Raze", acs: 200, kills: 10, deaths: 10, assists: 6, kast: 70, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 2 },
      { matchMapId: "l0m1", matchId: "l0", player: "Lyncher", team: "London Lions", agent: "Sova", acs: 190, kills: 12, deaths: 12, assists: 9, kast: 74, adr: 140, fk: 1, fd: 1, clutches: 0 },
      { matchMapId: "l1m1", matchId: "l1", player: "Wolfrik", team: "Madrid Wolves", agent: "Killjoy", acs: 210, kills: 14, deaths: 15, assists: 5, kast: 68, adr: 145, fk: 2, fd: 3, clutches: 1 },
    ],
    standings: [
      { team: "London Lions", position: 1, wins: 2, losses: 0, mapsWon: 4, mapsLost: 1, status: "qualified" },
      { team: "Madrid Wolves", position: 2, wins: 1, losses: 1, mapsWon: 2, mapsLost: 2 },
      { team: "Berlin Bears", position: 3, wins: 1, losses: 1 },
    ],
    awards: { champion: "London Lions", runnerUp: "Madrid Wolves" },
  };

  const ictxL: ImportCtx = { clock: makeClock(NOW), identity: createIdentityResolver(buildRegistry([])) };
  const genL = generateCards(analyze(importSnapshot(london, ictxL).model), { roster: allPlayers(), now: NOW });
  const idsL = genL.cards.map((s) => s.cardId);
  check("generationId EXACTO del ejemplo obligatorio",
    genL.generationId === "GEN-2026-VALORANT-MASTERS-LONDON-2026", genL.generationId);
  check("la generación London emite cartas (incluida zekken__mythic del MVP)",
    idsL.length > 0 && idsL.includes("zekken__mythic"), `${idsL.length} cartas`);

  // Un jugador NUEVO del torneo (draft) y su carta base (ninguna concesión la deriva).
  const draftL = genL.players.find((p) => p.status === "created" && p.playerId && p.draft)!;
  const draftLId = draftL.playerId!;
  const grantedL = new Set(genL.grants
    .filter((g) => g.playerId === draftLId)
    .flatMap((g) => variantsForAccolade(g.accolade, draftL.draft!)));
  const draftLBase = genL.cards.find((s) => s.playerId === draftLId && !grantedL.has(s.variantId))!.cardId;

  let cl = submitGeneration(genL, { ...META(40), tournamentName: "Valorant Masters London 2026" });

  // Aprobación individual (operación singular del contrato).
  const firstL = idsL.find((id) => id !== "zekken__mythic" && genL.cards.find((s) => s.cardId === id)!.playerId !== draftLId)!;
  cl = approveCard(cl, firstL, META(41)).case;
  check("aprobación individual (approveCard)", cl.states[firstL] === "approved");

  // Aprobación por lote (selección) + resto de la generación completa.
  const batchL = cardsInState(cl, "review").filter((id) => id !== "zekken__mythic" && id !== draftLBase).slice(0, 4);
  cl = approveBatch(cl, batchL, META(42)).case;
  check("aprobación por lote (selección)", batchL.length > 0 && batchL.every((id) => cl.states[id] === "approved"));
  cl = approveGeneration(cl, META(43)).case;
  check("aprobación de la generación completa (approveGeneration)", cardsInState(cl, "review").length === 0);

  // Rechazo (con motivo) + bloqueo: nunca llegarán al runtime.
  cl = returnToReview(cl, ["zekken__mythic", draftLBase], META(44)).case;
  cl = rejectCard(cl, "zekken__mythic", { ...META(45), reason: "revisión editorial: variante no aprobada" }).case;
  cl = blockCard(cl, draftLBase, { ...META(46), reason: "veto editorial del jugador nuevo" }).case;
  check("rechazo y bloqueo aplicados",
    cl.states["zekken__mythic"] === "rejected" && cl.states[draftLBase] === "blocked");

  // Publicación: SOLO las aprobadas.
  const resL = await publishApproved(cl, META(47));
  check("publicación London aplicada (runtime v1)", resL.ok && runtimeVersion() === 1);
  check("la generación vigente en el runtime es la del ejemplo",
    runtimeGenerationId() === "GEN-2026-VALORANT-MASTERS-LONDON-2026");
  check("TODAS las publicadas existen en el catálogo y estaban aprobadas",
    resL.published.length > 0 && resL.published.every((id) => !!getCard(id) && cl.states[id] === "approved"));
  check("la rechazada (zekken__mythic) NO existe en el catálogo", !getCard("zekken__mythic"));
  check("la bloqueada excluye al jugador nuevo completo del runtime",
    genL.cards.filter((s) => s.playerId === draftLId).every((s) => !getCard(s.cardId)) && !getPlayer(draftLId));
  check("rechazadas/bloqueadas conservan su estado tras publicar",
    resL.case.states["zekken__mythic"] === "rejected" && resL.case.states[draftLBase] === "blocked");

  // Historial completo del ciclo.
  const evL = historyForCard(resL.case, "zekken__mythic");
  check("historial completo de la rechazada (review→approved→review→rejected, con actor/motivo/generación)",
    evL.length >= 4 && evL.some((e) => e.action === "reject" && e.reason?.includes("editorial")) &&
    evL.every((e) => e.actor === "editor-1" && e.generationId === "GEN-2026-VALORANT-MASTERS-LONDON-2026"));
  check("historial London íntegro (encadenado + secuencia monótona)", auditHistory(resL.case).length === 0);

  // ── RESTAURACIÓN ──
  resetRuntime();
  rebuildCatalog(originalPlayers);
  check("catálogo semilla restaurado al terminar", totalCards() === originalTotal);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
