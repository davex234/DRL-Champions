/**
 * VERIFICACIÓN — Duel Balance & Rules Resolution (DRL Champions, Duelos Fase 7/7).
 *
 *   npx tsx scripts/duel-balance-verify.ts          (10.000 partidas por configuración)
 *   npx tsx scripts/duel-balance-verify.ts 2000     (barrido rápido)
 *
 * Comprueba los criterios de aceptación de la fase sobre partidas REALES del motor completo
 * (orquestador + resolver + bots), no sobre reglas reimplementadas aquí:
 *
 *   OPD-05 cerrada · OPD-08 cerrada · OPD-42 cerrada · OPD-04 cerrada · cero UNRESOLVED ·
 *   espejos deterministas · sin ventaja del primer atacante · escalera EASY < NORMAL < HARD ·
 *   NORMAL lejos del 100 % · RNG determinista · replay · serialización · resolver como autoridad ·
 *   modelo de combate intacto · 10.000 simulaciones por configuración.
 *
 * 100 % DETERMINISTA: mismas semillas, mismos números en cada ejecución.
 */
import { readFileSync } from "node:fs";
import { COMBAT_MATCHUP } from "../src/domain/cards/combat";
import {
  resolveCombat, sumOvr, auditCombatResult, getCombatRuleset,
  COMBAT_RULES_V1, COMBAT_RULES_V2, CURRENT_COMBAT_RULES, RESOLVER_VERSION,
  type CombatResult, type DuelDeckSnapshot, type Side,
} from "../src/domain/cardgame/combat";
import {
  startDuelMatch, buildCombatPlan, ORCHESTRATOR_VERSION, type DuelMatch,
} from "../src/domain/cardgame/match";
import {
  createRng, createController, advanceBots, createDuelBot, createRandomBot, createSmartBot,
  DIFFICULTY_PROFILE, OPPONENT_ENGINE_VERSION,
  type BotDifficulty, type DuelOpponent, type DuelParticipant,
} from "../src/domain/cardgame/opponent";
import { buildDecks, mirrorSnapshot } from "./lib/duel-fixtures";

const N = Number(process.argv[2] ?? 10000);

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
console.log("# Verificación de Duel Balance & Rules Resolution — DRL Champions (Duelos Fase 7/7)\n");

// ───────────────────────────── Escenarios ─────────────────────────────

const decks = buildDecks();
const PAIRS: { label: string; a: DuelDeckSnapshot; b: DuelDeckSnapshot; mirror: boolean }[] = [
  { label: "M1 vs M1", a: decks.M1, b: mirrorSnapshot(decks.M1, "mirror-m1"), mirror: true },
  { label: "M2 vs M2", a: decks.M2, b: mirrorSnapshot(decks.M2, "mirror-m2"), mirror: true },
  { label: "M3 vs M3", a: decks.M3, b: mirrorSnapshot(decks.M3, "mirror-m3"), mirror: true },
  { label: "M1 vs M2", a: decks.M1, b: decks.M2, mirror: false },
  { label: "M1 vs M3", a: decks.M1, b: decks.M3, mirror: false },
  { label: "M2 vs M3", a: decks.M2, b: decks.M3, mirror: false },
];
const LEVELS: BotDifficulty[] = ["EASY", "NORMAL", "HARD"];

const BOT = (side: Side): DuelParticipant => ({ side, kind: "BOT", id: `bot-${side}` });
const seedPair = (i: number): [number, number] => [i * 7919 + 13, i * 6271 + 977];

function play(
  a: DuelDeckSnapshot, b: DuelDeckSnapshot, botA: DuelOpponent, botB: DuelOpponent,
  seedA: number, seedB: number, first: Side, rules = CURRENT_COMBAT_RULES,
): DuelMatch {
  const s = startDuelMatch({ id: "v", snapshotA: a, snapshotB: b, firstAttacker: first, rules });
  if (!s.ok) throw new Error(`no arranca: ${s.error.code}`);
  const r = advanceBots(
    s.match, createController(BOT("A"), BOT("B")), { A: botA, B: botB },
    createRng(seedA), createRng(seedB),
  );
  if (r.error) throw new Error(`partida abortada: ${r.error.code}`);
  return r.match;
}

interface Cell {
  n: number;
  winA: number; winB: number; draw: number; unresolved: number;
  firstWin: number; decisive: number;
  sumScoreA: number; sumScoreB: number; sumTies: number; sumOvrDiff: number;
  byLevel: Record<CombatResult["decidedBy"], number>;
  broken: number;
}

const emptyCell = (): Cell => ({
  n: 0, winA: 0, winB: 0, draw: 0, unresolved: 0, firstWin: 0, decisive: 0,
  sumScoreA: 0, sumScoreB: 0, sumTies: 0, sumOvrDiff: 0,
  byLevel: { SCORE: 0, OVR_TIEBREAK: 0, STAT_MARGIN: 0, NONE: 0 }, broken: 0,
});

/**
 * Simula una configuración completa y agrega sus métricas.
 * `first` alterna para que el sesgo del primer atacante se mida sobre las dos orientaciones.
 */
function simulate(
  a: DuelDeckSnapshot, b: DuelDeckSnapshot, la: BotDifficulty, lb: BotDifficulty, n: number,
): Cell {
  const c = emptyCell();
  for (let i = 0; i < n; i++) {
    const [sa, sb] = seedPair(i);
    const first: Side = i % 2 === 0 ? "A" : "B";
    const m = play(a, b, createDuelBot("x", la), createDuelBot("y", lb), sa, sb, first);
    const r = m.result;
    c.n++;
    // Invariantes duras de cada partida. Un solo fallo marca la configuración entera.
    if (
      m.turns.length !== 10 || !r || !r.integrityOk ||
      m.usedA.length !== 10 || m.usedB.length !== 10 ||
      new Set(m.usedA).size !== 10 || new Set(m.usedB).size !== 10 ||
      m.turns.filter((t) => t.attacker === "A").length !== 5 ||
      r.combat.errors.length > 0
    ) { c.broken++; continue; }

    c.sumScoreA += r.scoreA; c.sumScoreB += r.scoreB; c.sumTies += r.tiedEncounters;
    c.sumOvrDiff += Math.abs(sumOvr(m.snapshotA.cards) - sumOvr(m.snapshotB.cards));
    c.byLevel[r.combat.decidedBy]++;
    if (m.status === "UNRESOLVED") c.unresolved++;
    else if (r.winner === "A") c.winA++;
    else if (r.winner === "B") c.winB++;
    else c.draw++;
    if (r.winner !== null) { c.decisive++; if (r.winner === first) c.firstWin++; }
  }
  return c;
}

const pc = (x: number, n: number) => (n === 0 ? "n/a" : `${((100 * x) / n).toFixed(2)}%`);

// ─────────────────────── 1. Auditoría de reglas y versiones ───────────────────────

console.log("## Reglas, versiones y autoridad");
{
  check("OPD-05 cerrada: la política de empate de enfrentamiento es NO_POINT y está declarada",
    COMBAT_RULES_V2.encounterTie === "NO_POINT" && COMBAT_RULES_V1.encounterTie === "NO_POINT");
  check("OPD-08 cerrada: segundo desempate STAT_MARGIN y terminal DRAW",
    COMBAT_RULES_V2.finalTiebreak === "STAT_MARGIN" && COMBAT_RULES_V2.terminal === "DRAW");
  check("NO TERCER DESEMPATE: la cadena tiene exactamente dos niveles y un terminal",
    CURRENT_COMBAT_RULES.finalTiebreak === "STAT_MARGIN" && CURRENT_COMBAT_RULES.terminal === "DRAW");
  check("VERSIONADO: reglas vigentes duel-combat-2, orquestador duel-turns-2, oponente duel-opponent-2",
    RESOLVER_VERSION === "duel-combat-2" && ORCHESTRATOR_VERSION === "duel-turns-2" && OPPONENT_ENGINE_VERSION === "duel-opponent-2");
  check("VERSIONADO: la versión antigua sigue disponible y no se sobrescribe",
    getCombatRuleset("duel-combat-1") === COMBAT_RULES_V1 && getCombatRuleset("duel-combat-2") === COMBAT_RULES_V2);
  check("VERSIONADO: una versión desconocida NO se reinterpreta con las actuales",
    getCombatRuleset("duel-combat-99") === null);

  const orch = readFileSync(new URL("../src/domain/cardgame/match/orchestrator.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("AUTORIDAD: el orquestador no calcula desempates ni suma OVR",
    !orch.includes("sumOvr") && !orch.includes("statTotals") && !orch.includes("tiebreak"));

  check("MODELO DE COMBATE INTACTO: la tabla del PDF no ha cambiado",
    JSON.stringify(COMBAT_MATCHUP) === JSON.stringify({ stronghold: "entryfrag", gamesense: "gamesense", entryfrag: "stronghold" }));
  check("OVR INTACTO: la suma de medias sigue siendo la suma de los OVR congelados",
    sumOvr(decks.M1.cards) === decks.M1.cards.reduce((s, c) => s + c.ovr, 0));

  for (const file of ["../src/domain/cardgame/combat/rules.ts", "../src/domain/cardgame/combat/resolver.ts",
    "../src/domain/cardgame/match/orchestrator.ts", "../src/domain/cardgame/opponent/bots.ts"]) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const bad = ["Math.random", "Date.now", "supabase", "fetch(", "localStorage", "process.env", "react", "@/store"]
      .filter((f) => code.includes(f));
    check(`SEGURIDAD: ${file.split("/").pop()} sigue siendo dominio puro`, bad.length === 0, bad.join(", "));
  }
}

// ─────────────────────── 2. Determinismo, replay y serialización ───────────────────────

console.log("\n## Determinismo, replay y serialización");
{
  const mk = () => play(decks.M1, PAIRS[0].b, createDuelBot("x", "NORMAL"), createDuelBot("y", "HARD"), 4242, 999, "A");
  check("RNG DETERMINISTA: dos ejecuciones idénticas dan el mismo JSON", JSON.stringify(mk()) === JSON.stringify(mk()));

  const m = mk();
  const revived = JSON.parse(JSON.stringify(m)) as DuelMatch;
  check("SERIALIZACIÓN: la partida sobrevive a JSON sin perder nada", JSON.stringify(revived) === JSON.stringify(m));
  check("SERIALIZACIÓN: el estado nuevo viaja en el JSON",
    typeof revived.combatRulesVersion === "string" && typeof revived.result!.isDraw === "boolean" &&
    typeof revived.result!.combat.statTotalA === "number" && typeof revived.result!.combat.decidedBy === "string");

  const again = resolveCombat(m.snapshotA, m.snapshotB, buildCombatPlan(m), getCombatRuleset(m.combatRulesVersion)!);
  check("AUTORIDAD: el resultado guardado es exactamente el del resolver sobre el plan completo",
    JSON.stringify(again) === JSON.stringify(m.result!.combat));

  const old = play(decks.M1, PAIRS[0].b, createRandomBot("x"), createRandomBot("y"), 31, 41, "A", COMBAT_RULES_V1);
  const replayed = resolveCombat(old.snapshotA, old.snapshotB, buildCombatPlan(old), getCombatRuleset(old.combatRulesVersion)!);
  check("REPLAY: una partida con reglas v1 se reproduce EXACTA bajo sus reglas",
    old.combatRulesVersion === "duel-combat-1" && JSON.stringify(replayed) === JSON.stringify(old.result!.combat));
  check("REPLAY: la partida v1 no adquiere el segundo desempate por resolverse hoy",
    old.result!.combat.marginTiebreak === null && old.result!.combat.resolverVersion === "duel-combat-1");

  // El mismo plan bajo las dos versiones: solo puede diferir el estado terminal del doble empate.
  const plan = buildCombatPlan(old);
  const v1 = resolveCombat(old.snapshotA, old.snapshotB, plan, COMBAT_RULES_V1);
  const v2 = resolveCombat(old.snapshotA, old.snapshotB, plan, COMBAT_RULES_V2);
  check("REPLAY: cambiar de reglas NO reescribe enfrentamientos, marcador ni desempate del PDF",
    JSON.stringify(v1.encounters) === JSON.stringify(v2.encounters) &&
    v1.scoreA === v2.scoreA && v1.scoreB === v2.scoreB &&
    JSON.stringify(v1.tiebreak) === JSON.stringify(v2.tiebreak));
}

// ─────────────────────── 3. Simulación masiva ───────────────────────

console.log(`\n## ${N} simulaciones por configuración (6 emparejamientos × 3 niveles = ${6 * 3 * N} partidas)`);
const t0 = Date.now();
const cells = new Map<string, Cell>();
for (const p of PAIRS) {
  for (const lvl of LEVELS) {
    cells.set(`${p.label}|${lvl}`, simulate(p.a, p.b, lvl, lvl, N));
  }
}
console.log(`   (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);

console.log("   escenario   nivel     A        B       draw    sin-res  1er-atac  sesgo    marcador    empates  ΔOVR");
for (const p of PAIRS) {
  for (const lvl of LEVELS) {
    const c = cells.get(`${p.label}|${lvl}`)!;
    const bias = c.decisive === 0 ? 0 : 100 * (c.firstWin / c.decisive - 0.5);
    console.log(
      `   ${p.label}   ${lvl.padEnd(7)} ${pc(c.winA, c.n).padStart(7)} ${pc(c.winB, c.n).padStart(7)}` +
      ` ${pc(c.draw, c.n).padStart(7)} ${pc(c.unresolved, c.n).padStart(8)} ${pc(c.firstWin, c.decisive).padStart(8)}` +
      ` ${(bias >= 0 ? "+" : "") + bias.toFixed(2)}%`.padStart(9) +
      `  ${(c.sumScoreA / c.n).toFixed(2)}-${(c.sumScoreB / c.n).toFixed(2)}` +
      `    ${(c.sumTies / c.n).toFixed(2)}     ${(c.sumOvrDiff / c.n).toFixed(0)}`,
    );
  }
}

console.log("\n   Nivel que decide el resultado:");
for (const p of PAIRS) {
  const c = cells.get(`${p.label}|NORMAL`)!;
  console.log(`   ${p.label} (NORMAL): marcador ${pc(c.byLevel.SCORE, c.n)} · ovr ${pc(c.byLevel.OVR_TIEBREAK, c.n)}` +
    ` · margen ${pc(c.byLevel.STAT_MARGIN, c.n)} · empate ${pc(c.byLevel.NONE, c.n)}`);
}

console.log("\n## Criterios sobre las simulaciones");
{
  const all = [...cells.values()];
  check("INTEGRIDAD: ninguna de las partidas rompe un invariante",
    all.every((c) => c.broken === 0), `${all.reduce((s, c) => s + c.broken, 0)} rotas de ${all.reduce((s, c) => s + c.n, 0)}`);
  check("CERO UNRESOLVED: ninguna partida queda sin resolver con las reglas vigentes",
    all.every((c) => c.unresolved === 0), `${all.reduce((s, c) => s + c.unresolved, 0)} sin resolver`);
  check("TERMINACIÓN: toda partida acaba en victoria o en empate explícito",
    all.every((c) => c.winA + c.winB + c.draw === c.n));

  // Espejos: mismo mazo y mismo nivel deben rondar el 50 %.
  for (const p of PAIRS.filter((x) => x.mirror)) {
    for (const lvl of LEVELS) {
      const c = cells.get(`${p.label}|${lvl}`)!;
      const rate = c.winA / c.decisive;
      check(`SIMETRÍA ${p.label} · ${lvl}: el espejo no favorece a ningún bando`,
        rate > 0.42 && rate < 0.58, `A ${pc(c.winA, c.decisive)} de las decisivas`);
    }
  }

  // Sesgo del primer atacante, agregado por nivel sobre TODOS los escenarios.
  for (const lvl of LEVELS) {
    let firstWin = 0, decisive = 0;
    for (const p of PAIRS) { const c = cells.get(`${p.label}|${lvl}`)!; firstWin += c.firstWin; decisive += c.decisive; }
    const bias = 100 * (firstWin / decisive - 0.5);
    check(`PRIMER ATACANTE · ${lvl}: sin ventaja significativa por empezar`,
      Math.abs(bias) < 5, `sesgo ${(bias >= 0 ? "+" : "") + bias.toFixed(2)} puntos`);
  }

  // Sesgo atribuible a las REGLAS, aislado del bot: con EASY (azar puro) las decisiones no tienen
  // estructura, así que cualquier ventaja del primer atacante solo puede venir de las reglas.
  {
    let firstWin = 0, decisive = 0;
    for (const p of PAIRS.filter((x) => x.mirror)) {
      const c = cells.get(`${p.label}|EASY`)!; firstWin += c.firstWin; decisive += c.decisive;
    }
    const bias = 100 * (firstWin / decisive - 0.5);
    check("PRIMER ATACANTE · aislado de la estrategia (espejo + azar puro): las REGLAS no favorecen a quien empieza",
      Math.abs(bias) < 2, `sesgo ${(bias >= 0 ? "+" : "") + bias.toFixed(2)} puntos`);
  }

  // Fuerza de mazo: el mazo mejor debe ganar más, pero el resultado no puede ser trivial.
  for (const [label] of [["M1 vs M2"], ["M1 vs M3"], ["M2 vs M3"]] as const) {
    const c = cells.get(`${label}|NORMAL`)!;
    check(`FUERZA DE MAZO ${label}: el mazo mejor gana más de la mitad`,
      c.winA / c.decisive > 0.5, `A ${pc(c.winA, c.decisive)}`);
  }
}

// ─────────────────────── 4. Escalera de dificultad ───────────────────────

console.log("\n## OPD-42 · escalera de dificultad (mazos idénticos M1 vs M1)");
const LADDER_N = Math.max(500, Math.round(N / 10));
const mirror1 = PAIRS[0];

/** Tasa de victoria de `la` contra `lb` sobre partidas decisivas. */
function head(la: BotDifficulty, lb: BotDifficulty, n = LADDER_N): number {
  const c = simulate(mirror1.a, mirror1.b, la, lb, n);
  return c.winA / c.decisive;
}

const M: Record<string, Record<string, number>> = {};
for (const row of LEVELS) {
  M[row] = {};
  for (const col of LEVELS) M[row][col] = head(row, col);
}
console.log("              " + LEVELS.map((x) => x.padStart(10)).join(""));
for (const row of LEVELS) {
  console.log(`   ${row.padEnd(10)}` + LEVELS.map((col) => `${(100 * M[row][col]).toFixed(1)}%`.padStart(10)).join(""));
}

{
  check("PERFILES: 0 = EASY < NORMAL < HARD < 1 (HARD no es un bot perfecto)",
    DIFFICULTY_PROFILE.EASY.heuristicRate === 0 &&
    DIFFICULTY_PROFILE.EASY.heuristicRate < DIFFICULTY_PROFILE.NORMAL.heuristicRate &&
    DIFFICULTY_PROFILE.NORMAL.heuristicRate < DIFFICULTY_PROFILE.HARD.heuristicRate &&
    DIFFICULTY_PROFILE.HARD.heuristicRate < 1,
    `0 / ${DIFFICULTY_PROFILE.NORMAL.heuristicRate} / ${DIFFICULTY_PROFILE.HARD.heuristicRate}`);
  check("EASY es el nivel más débil", M.NORMAL.EASY > 0.6 && M.HARD.EASY > 0.6, `NORMAL ${(100 * M.NORMAL.EASY).toFixed(1)}% · HARD ${(100 * M.HARD.EASY).toFixed(1)}%`);
  check("NORMAL es intermedio", M.NORMAL.EASY > 0.6 && M.HARD.NORMAL > 0.6, `vs EASY ${(100 * M.NORMAL.EASY).toFixed(1)}% · contra HARD ${(100 * (1 - M.HARD.NORMAL)).toFixed(1)}%`);
  check("HARD es el más fuerte", M.HARD.EASY > M.NORMAL.EASY && M.HARD.NORMAL > 0.6, `HARD vs NORMAL ${(100 * M.HARD.NORMAL).toFixed(1)}%`);
  check("NORMAL NO se aproxima al 100 %", M.NORMAL.EASY < 0.95, `${(100 * M.NORMAL.EASY).toFixed(1)}% contra EASY`);
  for (const lvl of LEVELS) {
    check(`ESPEJO DE NIVEL ${lvl}: contra sí mismo, aproximadamente simétrico`,
      M[lvl][lvl] > 0.42 && M[lvl][lvl] < 0.58, `${(100 * M[lvl][lvl]).toFixed(1)}%`);
  }

  // Variedad: un nivel 100 % determinista jugaría siempre la misma partida en un espejo.
  const distinct = (make: (id: string) => DuelOpponent, n = 200) => {
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const [sa, sb] = seedPair(i);
      const m = play(mirror1.a, mirror1.b, make("x"), make("y"), sa, sb, i % 2 === 0 ? "A" : "B");
      seen.add(m.turns.map((t) => `${t.attackerCardUid}|${t.attackerStat}|${t.defenderCardUid}`).join(","));
    }
    return seen.size;
  };
  const pure = distinct((id) => createSmartBot(id, "HARD"));
  const hard = distinct((id) => createDuelBot(id, "HARD"));
  check("VARIEDAD: HARD no degenera en una única partida repetida en el espejo",
    hard > 100 && pure <= 2, `heurística pura ${pure}/200 · HARD ${hard}/200`);
}

// ─────────────────────── 5. Información oculta ───────────────────────

console.log("\n## OPD-04 · información oculta");
{
  for (const d of LEVELS) {
    check(`${d} no ve las cartas no jugadas del rival`, DIFFICULTY_PROFILE[d].perfectInformation === false && createDuelBot("b", d).perfectInformation === false);
  }
  // Se instrumenta el bot para comprobar lo que el controlador le entrega de verdad.
  let leak = 0;
  for (const d of LEVELS) {
    const base = createDuelBot("spy", d);
    const spy: DuelOpponent = {
      ...base,
      chooseAttackerCard(ctx) {
        if (ctx.visibleOpponentCards.length > ctx.turn - 1) leak++;
        return base.chooseAttackerCard(ctx);
      },
      chooseDefenderCard(ctx) {
        if (ctx.visibleOpponentCards.length > ctx.turn - 1) leak++;
        return base.chooseDefenderCard(ctx);
      },
    };
    for (let i = 0; i < 50; i++) {
      const [sa, sb] = seedPair(i);
      play(mirror1.a, mirror1.b, spy, createDuelBot("y", "EASY"), sa, sb, i % 2 === 0 ? "A" : "B");
    }
  }
  check("MEDIDO: en 150 partidas ningún bot recibe una carta que el rival no haya jugado", leak === 0, `${leak} fugas`);

  // Cuánto aportaría la información oculta, con el nivel FIJO. Es la evidencia de la decisión.
  const perfect = (id: string) => createDuelBot(id, "HARD", { perfectInformation: true });
  const publicOnly = (id: string) => createDuelBot(id, "HARD", { perfectInformation: false });
  const headToHead = (() => {
    let winA = 0, dec = 0;
    for (let i = 0; i < LADDER_N; i++) {
      const [sa, sb] = seedPair(i);
      const m = play(mirror1.a, mirror1.b, perfect("x"), publicOnly("y"), sa, sb, i % 2 === 0 ? "A" : "B");
      if (m.result!.winner === null) continue;
      dec++; if (m.result!.winner === "A") winA++;
    }
    return winA / dec;
  })();
  console.log(`   info perfecta contra info pública, mismo nivel: ${(100 * headToHead).toFixed(2)}% (50 % = no aportaría)`);
  check("EVIDENCIA: la información oculta SÍ aporta, y por eso se retira en vez de asumirla",
    headToHead > 0.5, `${(100 * headToHead).toFixed(2)}%`);
  check("DECISIÓN: la escalera se construye sin información oculta",
    M.HARD.EASY > 0.9 && M.NORMAL.EASY > 0.6 && LEVELS.every((d) => !DIFFICULTY_PROFILE[d].perfectInformation));
}

// ─────────────────────── 6. Audit trail ───────────────────────

console.log("\n## Audit trail");
{
  const samples: CombatResult[] = [];
  for (const p of PAIRS) {
    for (let i = 0; i < 20; i++) {
      const [sa, sb] = seedPair(i);
      samples.push(play(p.a, p.b, createDuelBot("x", "NORMAL"), createDuelBot("y", "HARD"), sa, sb, i % 2 === 0 ? "A" : "B").result!.combat);
    }
  }
  check("EXPLICABLE: todo resultado produce un audit trail con marcador, reglas y motivo",
    samples.every((r) => {
      const a = auditCombatResult(r);
      return a.includes("FINAL RESULT") && a.includes("Reason:") && a.includes(r.resolverVersion) && a.includes(`${r.scoreA}-${r.scoreB}`);
    }));
  check("DETERMINISTA: el mismo resultado produce siempre el mismo texto",
    samples.every((r) => auditCombatResult(r) === auditCombatResult(r)));
  const covered = new Set(samples.map((r) => r.decidedBy));
  check("COBERTURA: la muestra cubre los tres niveles de decisión",
    covered.has("SCORE") && covered.has("OVR_TIEBREAK") && covered.has("STAT_MARGIN"), [...covered].join(", "));

  const drawPlan = {
    encounters: decks.M1.cards.map((c, i) => ({
      aUid: c.uid, aStat: "gamesense" as const,
      bUid: mirror1.b.cards[i].uid, bStat: "gamesense" as const,
    })),
  };
  const draw = resolveCombat(decks.M1, mirror1.b, drawPlan);
  check("EMPATE EXPLÍCITO: el empate absoluto se explica como empate, no como fallo",
    draw.status === "DRAW" && auditCombatResult(draw).includes("Result:\nDRAW") && draw.winner === null);
  console.log("\n" + auditCombatResult(draw).split("\n").map((l) => `   │ ${l}`).join("\n"));
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
