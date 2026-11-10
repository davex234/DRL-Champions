/**
 * POST-REEMPLAZO · ROAD TO CHAMPIONS DE PRINCIPIO A FIN (instrumento `_`, fuera de CI, SIN BD).
 *
 *   npx tsx scripts/_postreplace-campaign-qa.ts
 *
 * Con el catálogo REAL y el motor REAL, nodo a nodo en el orden de la campaña:
 *   1. el rival se construye (`buildOpponentPlan`) y su mazo es LEGAL para el validador canónico;
 *   2. las 10 cartas existen en el catálogo, con trío de combate, 2 por rol y sin jugador repetido;
 *   3. se juega una partida COMPLETA (10 turnos) con el motor: un bot NORMAL con un mazo legal del catálogo
 *      contra el bot de la dificultad del nodo;
 *   4. la progresión (`resolveStatuses` / `canStartNode` / `applyOutcome`) abre el nodo siguiente solo al
 *      completar el anterior, hasta cerrar el último.
 * Escribe `docs/product/qa/catalog-post-replace/campaign-qa.json`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS } from "../src/data/catalog";
import { ROAD_TO_CHAMPIONS } from "../src/data/roadToChampions";
import { CardRegistry } from "../src/collection/registry";
import { allNodes, nodeCardTier, buildOpponentPlan, botDifficultyOf, resolveStatuses, canStartNode, applyOutcome } from "../src/domain/campaign";
import type { NodeProgress } from "../src/domain/campaign/types";
import { createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList, DUEL_ROLES } from "../src/domain/cardgame";
import { startDuelMatch, confirmTurn } from "../src/domain/cardgame/match";
import { createRng, createController, advanceBots, createDuelBot } from "../src/domain/cardgame/opponent";
import { qaSnapshot } from "../src/lib/duel/qaSimulation";

const REG = new CardRegistry();
const NOW = 1_700_000_000_000;
const known = new Set(CARDS.map((c) => c.id));
const out: unknown[] = [];
let fails = 0;
const fail = (m: string) => { fails++; console.log(`  ✕ ${m}`); };

const mine = qaSnapshot(0, "qa-player-deck", "QA · mazo del jugador");
let progress: NodeProgress[] = [];

for (const node of allNodes(ROAD_TO_CHAMPIONS)) {
  const tier = nodeCardTier(ROAD_TO_CHAMPIONS, node.id)!;
  const plan = buildOpponentPlan(REG, node.opponent.teamId, tier);
  if (!plan.ok) { fail(`${node.id} (${node.opponent.teamId}): sin rival — ${plan.reason}`); continue; }

  // Legalidad canónica del mazo rival.
  const owned = plan.cards.map((c, i) => ({ uid: `rival-${node.id}-${i}`, cardId: c.cardId, obtainedAt: NOW }));
  const deck = createDuelDeck({ id: `rival-${node.id}`, name: plan.teamName, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(REG, ownershipFromList(owned)));
  const inexistentes = plan.cards.filter((c) => !known.has(c.cardId) || !REG.card(c.cardId)?.combat).map((c) => c.cardId);
  const porRol = Object.fromEntries(DUEL_ROLES.map((r) => [r, plan.cards.filter((c) => c.role === r).length]));
  const jugadores = new Set(plan.cards.map((c) => c.playerId)).size;
  if (!v.valid) fail(`${node.id}: mazo ilegal — ${v.errors.map((e) => e.code).join(",")}`);
  if (inexistentes.length) fail(`${node.id}: cartas inexistentes ${inexistentes.join(",")}`);
  if (plan.cards.length !== 10 || jugadores !== 10) fail(`${node.id}: ${plan.cards.length} cartas / ${jugadores} jugadores`);

  // Partida completa con el motor.
  const rival = takeDeckSnapshot(deck, v, NOW)!;
  const level = botDifficultyOf(node.difficulty);
  const start = startDuelMatch({ id: `qa-${node.id}`, snapshotA: mine, snapshotB: rival, firstAttacker: "A" });
  let result = "NO_ARRANCA";
  let turns = 0;
  if (start.ok) {
    let m = start.match;
    let rng = { a: createRng(11), b: createRng(12) };
    const both = createController({ side: "A", kind: "BOT", id: "qa" }, { side: "B", kind: "BOT", id: "rival" });
    const bots = { A: createDuelBot("qa", "NORMAL"), B: createDuelBot("rival", level) };
    for (let i = 0; i < 400 && m.status === "IN_PROGRESS"; i++) {
      const r = advanceBots(m, both, bots, rng.a, rng.b, 1);
      m = r.match; rng = { a: r.rngA, b: r.rngB };
      if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); if (c.ok) m = c.match; }
    }
    turns = m.turns.length;
    result = m.status === "IN_PROGRESS" ? "SIN_TERMINAR" : m.result?.isDraw ? "EMPATE" : `GANA_${m.result?.winner}`;
    if (m.status === "IN_PROGRESS") fail(`${node.id}: la partida no termina`);
  } else fail(`${node.id}: la partida no arranca`);

  // Progresión: este nodo está disponible; el siguiente, bloqueado hasta completarlo.
  const before = resolveStatuses(ROAD_TO_CHAMPIONS, progress);
  if (!canStartNode(ROAD_TO_CHAMPIONS, progress, node.id).ok) fail(`${node.id}: bloqueado con el anterior completado`);
  for (const next of node.nextNodes) if (before.get(next) !== "LOCKED") fail(`${next}: abierto antes de completar ${node.id}`);
  const applied = applyOutcome(progress.find((p) => p.nodeId === node.id) ?? null, { nodeId: node.id, version: ROAD_TO_CHAMPIONS.version, outcome: "WIN", matchId: `qa-${node.id}`, at: NOW });
  progress = [...progress.filter((p) => p.nodeId !== node.id), applied.next];

  const row = { node: node.id, type: node.type, difficulty: node.difficulty, bot: level, tier, rival: plan.teamName, core: plan.coreCount, sumOvr: plan.sumOvr, legal: v.valid, porRol, jugadores, inexistentes: inexistentes.length, turns, result, firstClear: applied.firstClear };
  out.push(row);
  console.log(`  ${v.valid && !inexistentes.length ? "✓" : "✕"} ${node.id.padEnd(6)} ${node.type.padEnd(5)} ${node.difficulty.padEnd(8)} ${plan.teamName.padEnd(14)} núcleo ${plan.coreCount} · OVR ${plan.sumOvr} · ${turns} turnos · ${result}`);
}

const final = resolveStatuses(ROAD_TO_CHAMPIONS, progress);
const done = [...final.values()].filter((s) => s === "COMPLETED").length;
if (done !== allNodes(ROAD_TO_CHAMPIONS).length) fail(`completados ${done}/${allNodes(ROAD_TO_CHAMPIONS).length}`);
console.log(`\n  campaña ${ROAD_TO_CHAMPIONS.version}: ${done}/${allNodes(ROAD_TO_CHAMPIONS).length} nodos completados en orden · ${fails === 0 ? "✓ TODO CORRECTO" : `✕ ${fails} fallos`}`);
const dir = join(process.cwd(), "docs/product/qa/catalog-post-replace");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "campaign-qa.json"), JSON.stringify({ version: ROAD_TO_CHAMPIONS.version, completed: done, nodes: out, fails }, null, 2));
process.exit(fails === 0 ? 0 : 1);
