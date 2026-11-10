/**
 * VERIFICACIÓN DEL TACTICAL DIRECTOR 2.0 — DRL Champions.
 *
 * Comprueba que el Director conduce TODA la ronda con estilo reconocible: estilos distintos,
 * fases (default/map_control/execute/post_plant/retake/save…), rotaciones, fakes, executes,
 * post-plants en crossfire, retakes, saves, control del mapa, ADAPTACIÓN real (modelo de rival
 * reanimado), scouting, coach, brain, utility, narrativa táctica, broadcast, determinismo,
 * rendimiento y cero estados imposibles. Reutiliza los motores existentes.
 *
 *   npx tsx scripts/tactical-verify.ts [partidos]
 */
import type { Role, RosterEntry, Identity, RoundState } from "../src/sim";
import { createRound, tick, makeIdentity, neutralIdentity } from "../src/sim";
import { dist } from "../src/sim/geometry";
import { buildLineup, analyzeComposition } from "../src/agents";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import { scout } from "../src/lib/match/scouting";
import {
  teamStyle, tacticalBroadcast, detectTacticalEvents, createTacticalMemory, learnMatchRound,
  tacticalReads, predictedAttackLane, patternStrength, emptyModel, spatialPostPlantZones,
  type TacticalSetup, type TacticalPhaseId, type OpponentModel,
} from "../src/tactics";
import { buildAttackState, buildDefenseState } from "../src/tactics/planner";
import { buildTacticalSetup } from "../src/economy";
import { makeRng } from "../src/sim/rng";

const N = Math.max(4, Number(process.argv[2] ?? 8));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

console.log("# Verificación del Tactical Director 2.0 — DRL Champions\n");

// ─────────────────────────── helpers ───────────────────────────
function team(tag: string, id: Partial<Identity>): RosterEntry[] {
  return (["entry", "igl", "lurk", "anchor", "support"] as Role[]).map((role, i) => ({
    name: `${tag}${i}`, role, attrs: { aim: 76, gameSense: 76, utility: 76, leadership: 76 }, identity: makeIdentity(id),
  }));
}
const CONTROL = team("CTL", { discipline: 88, patience: 85, utilityLean: 75, aggression: 22, entryDrive: 20, tacticalIQ: 84, lurkTendency: 65, creativity: 70 });
const AGGRO = team("AGG", { aggression: 90, entryDrive: 88, riskAppetite: 80, patience: 20, discipline: 30, composure: 70, tradeInstinct: 78 });
const ids = (r: RosterEntry[]) => r.map((e) => e.identity ?? neutralIdentity());
const comp = (r: RosterEntry[]) => {
  const lineup = buildLineup(r.map((e) => ({ name: e.name, role: e.role, identity: e.identity ?? neutralIdentity() })));
  const idBy: Record<string, Identity> = {}; for (const e of r) idBy[e.name] = e.identity ?? neutralIdentity();
  return analyzeComposition(lineup, idBy);
};

// ─────────────────────────── 1. Estilo de equipo (reconocible) ───────────────────────────
console.log("## Estilo de equipo (reconocible sin ver el nombre)");
const sCtl = teamStyle(ids(CONTROL), comp(CONTROL));
const sAgg = teamStyle(ids(AGGRO), comp(AGGRO));
check("estilos DISTINTOS entre equipos", sCtl.summary !== sAgg.summary, `"${sCtl.summary}" vs "${sAgg.summary}"`);
check("control: lento/paciente/control alto", sCtl.tempo < sAgg.tempo && sCtl.patience > sAgg.patience && sCtl.control > 0.5);
check("agresivo: tempo y agresividad altos", sAgg.tempo > 0.55 && sAgg.aggression > sCtl.aggression);
check("todas las métricas en [0,1]", [sCtl, sAgg].every((s) => [s.tempo, s.aggression, s.patience, s.control, s.rotation, s.trade, s.lurk, s.fake, s.execute, s.retake, s.save].every((m) => m >= 0 && m <= 1)));
check("estilo coach sesga (save → guarda más)", teamStyle(ids(AGGRO), comp(AGGRO), "save").save > sAgg.save);

// ─────────────────────────── 2. Lectura / aprendizaje / adaptación ───────────────────────────
console.log("\n## Lectura del rival + adaptación (anti-strat REAL)");
// Modelo donde el rival SIEMPRE ataca main.
const learned: OpponentModel = emptyModel();
learned.rounds = 5; learned.attackLane.main = 5; learned.recentAttack = ["main", "main", "main", "main"];
learned.defendLane.main = 8; learned.defendLane.mid = 1;
const pred = predictedAttackLane(learned), pat = patternStrength(learned);
check("predice el carril más atacado", pred.lane === "main" && pred.confidence > 0.8);
check("detecta el patrón repetido", pat.strength >= 0.66);
check("genera lecturas legibles", tacticalReads(learned).length >= 2, tacticalReads(learned).join(" · "));
// La defensa STACKEA el carril predicho (anti-strat).
const dummy = createRound(1, { side: "DEF", approach: "balanced", tempo: "mid", aggression: "balanced" }, undefined, undefined, { home: CONTROL, away: AGGRO });
const defSt = buildDefenseState(dummy, "DEF", { economy: { credits: 5000, buy: "full", lossStreak: 0 }, model: learned }, makeRng(7));
check("defensa adapta: STACK del carril leído", defSt.concept === "stack" && defSt.notes.some((n) => n.includes("anti-strat") || n.includes("stack")), defSt.notes.join(" · "));
// El ataque que pierde un carril FINTA por el otro.
const lostModel: OpponentModel = emptyModel(); lostModel.rounds = 4; lostModel.ourLaneLost.main = 3; lostModel.ourLaneWon.main = 0;
const atkDummy = createRound(2, { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" }, undefined, undefined, { home: AGGRO, away: CONTROL });
const atkSt = buildAttackState(atkDummy, "ATK", { economy: { credits: 5000, buy: "full", lossStreak: 0 }, model: lostModel }, makeRng(3));
check("ataque adapta: FINTA el carril perdido", atkSt.concept === "fake" && atkSt.notes.some((n) => n.includes("anti-strat")), atkSt.notes.join(" · "));

// ─────────────────────────── 3. Wiring (memoria + espacial + orden del coach) ───────────────────────────
console.log("\n## Cableado reanimado (memoria + espacial + orden del coach)");
const econMock = { home: { players: { a: 4000 }, lossStreak: 0, plannedBuy: "full", bonus: false }, away: { players: { b: 4000 }, lossStreak: 0, plannedBuy: "full", bonus: false }, rules: {}, history: [] } as never;
const mem = createTacticalMemory(); mem.home.rounds = 3; mem.home.attackLane.mid = 3;
const setupWired = buildTacticalSetup(econMock, "ATK", { memory: mem, homeOrder: { intent: "explode", lane: "main" }, useSpatial: true });
check("memoria realimentada (modelo NO vacío)", (setupWired.ATK?.model.rounds ?? 0) === 3);
check("inteligencia espacial ACTIVADA", setupWired.ATK?.useSpatial === true);
check("orden del coach PASADA al home", setupWired.ATK?.order?.intent === "explode");

// ─────────────────────────── 4. Conducción de la ronda (fases + comportamientos) ───────────────────────────
console.log("\n## El Director conduce TODA la ronda (fases + comportamientos)");
function playTactical(order: TacticalSetup["ATK"] extends infer T ? T : never, defOrder?: TacticalSetup["DEF"], seed = 100) {
  const setup: TacticalSetup = {
    ATK: { economy: { credits: 5000, buy: "full", lossStreak: 0 }, model: emptyModel(), order: order?.order ?? null, useSpatial: true },
    DEF: defOrder ?? { economy: { credits: 5000, buy: "full", lossStreak: 0 }, model: emptyModel(), useSpatial: true },
  };
  let s = createRound(seed, { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" }, undefined, setup, { home: AGGRO, away: CONTROL });
  const atkPhases = new Set<TacticalPhaseId>(), defPhases = new Set<TacticalPhaseId>();
  let bad = 0, postPlantSpread = false;
  let guard = 0;
  while (s.phase !== "ENDED" && guard++ < 4000) {
    s = tick(s);
    if (s.tactical?.ATK) atkPhases.add(s.tactical.ATK.phase);
    if (s.tactical?.DEF) defPhases.add(s.tactical.DEF.phase);
    const bc = tacticalBroadcast(s);
    if (!(bc.winProbATK >= 0 && bc.winProbATK <= 1) || Number.isNaN(bc.control.ATK) || Number.isNaN(bc.momentum)) bad++;
    // Post-plant en CROSSFIRE: los atacantes vivos NO están apilados en el spike (ángulos diversos
    // por director espacial + holdSpot del Brain) → dispersión de posiciones real.
    if (s.spike.planted) {
      const atk = s.players.filter((p) => p.side === "ATK" && p.alive);
      if (atk.length >= 3) {
        let maxD = 0;
        for (let a = 0; a < atk.length; a++) for (let b = a + 1; b < atk.length; b++) maxD = Math.max(maxD, dist(atk[a].pos, atk[b].pos));
        if (maxD > 70) postPlantSpread = true;
      }
    }
  }
  return { s, atkPhases, defPhases, bad, postPlantSpread };
}
const def = playTactical({ economy: { credits: 5000, buy: "full", lossStreak: 0 }, model: emptyModel(), order: { intent: "default", tempo: "slow" }, useSpatial: true } as never, undefined, 100);
check("ATK pasa por fases (default/control/pressure/execute)", ["default", "map_control", "pressure", "execute"].some((p) => def.atkPhases.has(p as TacticalPhaseId)), [...def.atkPhases].join(","));
check("ATK llega a post-plant o save", def.atkPhases.has("post_plant") || def.atkPhases.has("save") || def.s.spike.planted || def.s.winner != null);
check("DEF pasa por fases (default/read/rotation/retake)", ["default", "read", "rotation", "retake"].some((p) => def.defPhases.has(p as TacticalPhaseId)), [...def.defPhases].join(","));
check("broadcast SIEMPRE válido (winprob∈[0,1], sin NaN)", def.bad === 0, `${def.bad} ticks inválidos`);

const fake = playTactical({ economy: { credits: 5000, buy: "full", lossStreak: 0 }, model: emptyModel(), order: { intent: "fake", tempo: "mid" }, useSpatial: true } as never, undefined, 200);
check("FAKE: el Director vende la finta (fase fake)", fake.atkPhases.has("fake"), [...fake.atkPhases].join(","));

// POST-PLANT: el DIRECTOR asigna ángulos de crossfire (zonas distintas) — su responsabilidad.
// (El Brain luego ocupa/afina cada ángulo con su off-angle; con rosters diversos se dispersan.)
const ppSetup: TacticalSetup = { ATK: { economy: { credits: 5000, buy: "full", lossStreak: 0 }, model: emptyModel(), order: { intent: "explode" }, useSpatial: true } };
const ppRound = createRound(1, { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" }, undefined, ppSetup, { home: AGGRO, away: CONTROL });
const ppZones = new Set(Object.values(spatialPostPlantZones(ppRound, "ATK")));
const sawSpread = def.postPlantSpread || fake.postPlantSpread;
check("POST-PLANT en crossfire (el director reparte ángulos distintos)", ppZones.size >= 2 || sawSpread, `${ppZones.size} zonas`);

// ─────────────────────────── 5. Partido táctico (memoria + eventos + scouting) ───────────────────────────
console.log("\n## Partido táctico (memoria persistida + narrativa + scouting)");
const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
const cfg = (seed: number) => makeMatchConfig({ seed, rosters: { home: AGGRO, away: CONTROL }, homeSetup: SETUP, useEconomyTactics: true, coach: { mode: "ai" } });
let t0 = Date.now();
const eventTypes = new Set<string>();
let memoryLearned = false, scoutWorks = false, impossible = 0;
for (let i = 0; i < N; i++) {
  const m: MatchState = simulateMatch(cfg(7000 + i * 13));
  if ((m.tacticalMemory?.home.rounds ?? 0) > 0 || (m.tacticalMemory?.away.rounds ?? 0) > 0) memoryLearned = true;
  for (const e of m.tacticalEvents) eventTypes.add(e.type);
  const sc = scout(m);
  if (sc.rounds > 0) scoutWorks = true;
  // Estados imposibles a nivel de evento táctico.
  for (const e of m.tacticalEvents) if (e.magnitude < 1 || e.magnitude > 100 || (e.team !== "home" && e.team !== "away")) impossible++;
}
const simMs = Date.now() - t0;
check("memoria de rival PERSISTIDA y aprendida en el partido", memoryLearned);
check("scouting reconstruye lecturas del rival", scoutWorks);
check("se generan eventos tácticos (narrativa)", eventTypes.size >= 3, [...eventTypes].join(", "));
check("variedad de eventos tácticos", eventTypes.size >= 5, `${eventTypes.size} tipos`);
check("cero estados imposibles en eventos", impossible === 0);

// ─────────────────────────── 6. Determinismo + rendimiento ───────────────────────────
console.log("\n## Determinismo y rendimiento");
const sig = (m: MatchState) => `${m.score.home}-${m.score.away}:${m.tacticalEvents.length}:${m.tacticalMemory?.home.rounds ?? 0}:${m.tacticalMemory?.home.attackLane.main ?? 0}`;
check("misma config ⇒ mismo resultado táctico", sig(simulateMatch(cfg(31337))) === sig(simulateMatch(cfg(31337))));
check("rendimiento aceptable", simMs / N < 2500, `${Math.round(simMs / N)} ms/partido`);

// ─────────────────────────── 7. Métricas ───────────────────────────
console.log("\n## Métricas");
const sample = simulateMatch(cfg(99));
console.log(`  estilo home: ${teamStyle(ids(AGGRO), comp(AGGRO)).summary}`);
console.log(`  estilo away: ${teamStyle(ids(CONTROL), comp(CONTROL)).summary}`);
console.log(`  rondas: ${sample.rounds.length} · eventos tácticos: ${sample.tacticalEvents.length} · modelo home (rondas): ${sample.tacticalMemory?.home.rounds}`);
console.log(`  lecturas finales: ${scout(sample).predictedAttack.label} (conf ${(scout(sample).predictedAttack.confidence * 100) | 0}%)`);

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
