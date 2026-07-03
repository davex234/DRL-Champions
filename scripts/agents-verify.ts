/**
 * VALIDACIÓN DEL AGENT ENGINE.
 *
 * Comprueba que los agentes CAMBIAN la forma de jugar (no el aim): asignación con
 * variedad, composiciones distinguibles, modulación por ADN, sesgo de concepto del
 * Tactical según la composición, y determinismo del partido con agentes.
 *
 * Uso:  npx tsx scripts/agents-verify.ts
 */
import { createRound, makeIdentity, type Identity } from "../src/sim";
import type { Attributes, Role, RosterEntry } from "../src/sim";
import { simulateMatch, makeMatchConfig } from "../src/match";
import { makeRng } from "../src/sim/rng";
import { buildLineup, analyzeComposition } from "../src/agents";
import { buildAttackState } from "../src/tactics/planner";
import { emptyModel, type TeamSeed } from "../src/tactics";

const ROLES: Role[] = ["entry", "igl", "anchor", "lurk", "support"];
const ATTRS: Attributes = { aim: 75, gameSense: 75, utility: 75, leadership: 75 };

// Mismos atributos para todos → cualquier diferencia es de AGENTE/composición, no de aim.
function team(prefix: string, id: Partial<Identity>): RosterEntry[] {
  return ROLES.map((role, i) => ({
    name: `${prefix}${i + 1}`, role, attrs: ATTRS, identity: makeIdentity(id),
  }));
}

const CONTROL = team("C", { discipline: 85, utilityLean: 82, patience: 80, aggression: 25, entryDrive: 20, composure: 78, communication: 75, tacticalIQ: 82 });
const AGGRO = team("A", { aggression: 90, entryDrive: 92, riskAppetite: 82, discipline: 28, utilityLean: 35, composure: 45 });

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  ok ? pass++ : fail++;
};

console.log("# Verificación del Agent Engine\n");

// 1) Asignación: variedad + determinismo.
const l1 = buildLineup(CONTROL.map((e) => ({ name: e.name, role: e.role, identity: e.identity! })));
const l2 = buildLineup(CONTROL.map((e) => ({ name: e.name, role: e.role, identity: e.identity! })));
const distinct = new Set(l1.map((i) => i.agent.id)).size;
console.log("## Asignación");
console.log("  Control →", l1.map((i) => `${i.agent.codename}(${i.agent.class})`).join(" "));
const aggroLine = buildLineup(AGGRO.map((e) => ({ name: e.name, role: e.role, identity: e.identity! })));
console.log("  Aggro   →", aggroLine.map((i) => `${i.agent.codename}(${i.agent.class})`).join(" "));
check("variedad de agentes (≥3 distintos)", distinct >= 3, `${distinct} distintos`);
check("asignación determinista", JSON.stringify(l1.map((i) => i.agent.id)) === JSON.stringify(l2.map((i) => i.agent.id)));

// 2) Composiciones distinguibles.
const idBy = (r: RosterEntry[]) => Object.fromEntries(r.map((e) => [e.name, e.identity!]));
const compC = analyzeComposition(l1, idBy(CONTROL));
const compA = analyzeComposition(aggroLine, idBy(AGGRO));
console.log("\n## Composiciones");
console.log(`  Control  : ${compC.archetypeLabel} [${compC.playstyle.join(", ")}]`);
console.log(`             execute ${compC.ratings.execute} control ${compC.ratings.control} entry ${compC.ratings.entry} info ${compC.ratings.info} retake ${compC.ratings.retake} postplant ${compC.ratings.postplant}`);
console.log(`  Agresiva : ${compA.archetypeLabel} [${compA.playstyle.join(", ")}]`);
console.log(`             execute ${compA.ratings.execute} control ${compA.ratings.control} entry ${compA.ratings.entry} info ${compA.ratings.info} retake ${compA.ratings.retake} postplant ${compA.ratings.postplant}`);
check("arquetipos distintos", compC.archetype !== compA.archetype, `${compC.archetype} vs ${compA.archetype}`);
check("la agresiva tiene más ENTRADA", compA.ratings.entry > compC.ratings.entry, `${compA.ratings.entry} vs ${compC.ratings.entry}`);
check("la de control tiene más CONTROL", compC.ratings.control > compA.ratings.control, `${compC.ratings.control} vs ${compA.ratings.control}`);
check("ratings en rango 0..100", [compC, compA].every((c) => Object.values(c.ratings).every((v) => v >= 0 && v <= 100)));

// 3) Modulación por ADN: mismos agentes, distinto ADN → distinta entrada realizada.
const calmIds = idBy(team("X", { aggression: 20, discipline: 85 }));
const hotIds = idBy(team("X", { aggression: 95, entryDrive: 95 }));
const baseLine = buildLineup(AGGRO.map((e, i) => ({ name: `X${i + 1}`, role: e.role, identity: AGGRO[i].identity! })));
const calm = analyzeComposition(baseLine, calmIds);
const hot = analyzeComposition(baseLine, hotIds);
console.log("\n## Modulación por ADN (mismos agentes)");
console.log(`  ADN calmado: entry ${calm.ratings.entry} · ADN agresivo: entry ${hot.ratings.entry}`);
check("el ADN agresivo materializa más entrada con los MISMOS agentes", hot.ratings.entry > calm.ratings.entry);

// 4) El Tactical sesga el CONCEPTO según la composición.
function tallyConcepts(roster: RosterEntry[], runs: number): Record<string, number> {
  const setup = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
  const tally: Record<string, number> = {};
  for (let i = 0; i < runs; i++) {
    const state = createRound(1000 + i, setup, undefined, undefined, { home: roster, away: CONTROL });
    const seed: TeamSeed = { economy: { credits: 5000, buy: "full", lossStreak: 0 }, model: emptyModel(), useSpatial: false };
    const ts = buildAttackState(state, "ATK", seed, makeRng((7777 + i) >>> 0));
    tally[ts.concept] = (tally[ts.concept] ?? 0) + 1;
  }
  return tally;
}
const RUNS = 200;
const tC = tallyConcepts(CONTROL, RUNS);
const tA = tallyConcepts(AGGRO, RUNS);
const fast = (t: Record<string, number>) => (t.explode ?? 0) + (t.split ?? 0) + (t.contact ?? 0);
const slow = (t: Record<string, number>) => (t.default ?? 0) + (t.play_picks ?? 0) + (t.lurk ?? 0);
console.log("\n## Concepto elegido por composición (ataque, full buy)");
console.log("  Control  :", tC);
console.log("  Agresiva :", tA);
check("la composición agresiva ejecuta más rápido (explode/split)", fast(tA) > fast(tC), `${fast(tA)} vs ${fast(tC)}`);
check("la de control juega más lento (default/picks/lurk)", slow(tC) > slow(tA), `${slow(tC)} vs ${slow(tA)}`);

// 5) Determinismo del partido CON agentes + composición presente.
const cfg = (seed: number) => makeMatchConfig({
  seed, rosters: { home: AGGRO, away: CONTROL },
  homeSetup: { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" },
  useEconomyTactics: true,
});
const m1 = simulateMatch(cfg(42));
const m2 = simulateMatch(cfg(42));
console.log("\n## Partido con agentes");
console.log(`  Resultado: ${m1.score.home}-${m1.score.away} · ganador ${m1.winner}`);
check("determinismo: misma config ⇒ mismo marcador", m1.score.home === m2.score.home && m1.score.away === m2.score.away);
check("las rondas llevan composición de ambos lados", m1.rounds.length > 0 && !!m1.rounds[0].composition?.ATK && !!m1.rounds[0].composition?.DEF);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} comprobaciones`);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (fail > 0) process.exitCode = 1;
