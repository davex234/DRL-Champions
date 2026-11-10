/**
 * DUEL BALANCE LAB (Fase 7) — banco de experimentos para OPD-05, OPD-08, OPD-42 y OPD-04.
 *
 *   npm run duel-balance            (5.000 partidas por celda)
 *   npm run duel-balance -- 10000   (10.000 partidas por celda)
 *
 * CÓMO FUNCIONA, y por qué así:
 *
 * Las partidas se juegan UNA sola vez con el motor real (orquestador + resolver). Después, cada
 * regla candidata se evalúa POST-HOC sobre el audit trail de esas mismas partidas. Es legítimo
 * porque ninguna estrategia de bot mira el marcador para decidir: cambiar la regla de resultado no
 * cambia las decisiones, solo cómo se cuentan. Así se comparan todas las alternativas sobre EL
 * MISMO conjunto de partidas —comparación pareada, sin ruido de muestreo entre candidatas— y sin
 * modificar ni una regla durante el experimento (Fase 7 §5).
 *
 * El laboratorio NO decide nada: imprime evidencia. La decisión se documenta en el informe.
 */
import {
  sumOvr, type DuelDeckSnapshot, type ResolvedEncounter, type Side,
} from "@/domain/cardgame/combat";
import { startDuelMatch, type DuelMatch } from "@/domain/cardgame/match";
import {
  createRng, createController, advanceBots, createRandomBot, createSmartBot, createDuelBot,
  type DuelOpponent, type DuelParticipant,
} from "@/domain/cardgame/opponent";
import type { DuelDeckCard } from "@/domain/cardgame";
import { buildDecks, mirrorSnapshot } from "./lib/duel-fixtures";

const N = Number(process.argv[2] ?? 5000);

// ───────────────────────────── Partidas ─────────────────────────────

const BOT = (side: Side): DuelParticipant => ({ side, kind: "BOT", id: `bot-${side}` });

/** Juega una partida Bot vs Bot completa y devuelve el estado final. */
function play(
  a: DuelDeckSnapshot, b: DuelDeckSnapshot, botA: DuelOpponent, botB: DuelOpponent,
  seedA: number, seedB: number, first: Side,
): DuelMatch {
  const start = startDuelMatch({ id: "lab", snapshotA: a, snapshotB: b, firstAttacker: first });
  if (!start.ok) throw new Error(`no arranca: ${start.error.code}`);
  const res = advanceBots(
    start.match, createController(BOT("A"), BOT("B")), { A: botA, B: botB },
    createRng(seedA), createRng(seedB),
  );
  if (res.error) throw new Error(`partida abortada: ${res.error.code}`);
  if (res.match.turns.length !== 10) throw new Error(`partida incompleta: ${res.match.turns.length} turnos`);
  return res.match;
}

// ───────────────────────────── Candidatas OPD-05 ─────────────────────────────

/** Qué ocurre cuando un enfrentamiento individual empata. */
type Opd05 = "NO_POINT" | "ATTACKER" | "DEFENDER" | "CARD_OVR";

const OPD05: Opd05[] = ["NO_POINT", "ATTACKER", "DEFENDER", "CARD_OVR"];

/** Quién se lleva el punto de un enfrentamiento empatado, según la candidata. */
function tieAward(
  rule: Opd05, attacker: Side, cardA: DuelDeckCard, cardB: DuelDeckCard,
): Side | null {
  switch (rule) {
    case "NO_POINT": return null;
    case "ATTACKER": return attacker;
    case "DEFENDER": return attacker === "A" ? "B" : "A";
    case "CARD_OVR": return cardA.ovr > cardB.ovr ? "A" : cardB.ovr > cardA.ovr ? "B" : null;
  }
}

// ───────────────────────────── Candidatas OPD-08 ─────────────────────────────

/** Qué ocurre cuando marcador Y suma de OVR quedan igualados. */
type Opd08 = "UNRESOLVED" | "DRAW" | "MARGIN" | "ENCOUNTERS_WON" | "DOMINANT_STATS" | "FEWER_TIES";

const OPD08: Opd08[] = ["UNRESOLVED", "DRAW", "MARGIN", "ENCOUNTERS_WON", "DOMINANT_STATS", "FEWER_TIES"];

/** Suma del valor DECLARADO por cada bando en los 10 enfrentamientos. */
function statTotals(encounters: readonly ResolvedEncounter[]): { a: number; b: number } {
  let a = 0, b = 0;
  for (const e of encounters) { a += e.a.value; b += e.b.value; }
  return { a, b };
}

/** Suma de la estadística MÁS ALTA de cada carta del mazo. */
const dominantTotal = (cards: readonly DuelDeckCard[]): number =>
  cards.reduce((s, c) => s + Math.max(c.combat.stronghold, c.combat.gamesense, c.combat.entryfrag), 0);

// ───────────────────────────── Evaluación post-hoc ─────────────────────────────

interface Outcome {
  winner: Side | null;
  /** `true` si el resultado es un empate DECLARADO; `false` si quedó sin resolver. */
  draw: boolean;
  unresolved: boolean;
  scoreA: number;
  scoreB: number;
  ties: number;
  /** Nivel que decidió: enfrentamientos, OVR, la candidata, o ninguno. */
  decidedBy: "SCORE" | "OVR" | "CANDIDATE" | "NONE";
}

/**
 * Aplica una pareja de reglas candidatas al audit trail de una partida ya jugada.
 *
 * Reproduce EXACTAMENTE la cadena del resolver: enfrentamientos → marcador → suma de OVR →
 * (candidata) → terminal. No recalcula ninguna comparación: lee `outcome` y `value`, que ya
 * produjo `resolveEncounter`.
 */
function evaluate(m: DuelMatch, o5: Opd05, o8: Opd08): Outcome {
  const combat = m.result!.combat;
  const byUidA = new Map(m.snapshotA.cards.map((c) => [c.uid, c]));
  const byUidB = new Map(m.snapshotB.cards.map((c) => [c.uid, c]));

  let scoreA = 0, scoreB = 0, ties = 0;
  for (let i = 0; i < combat.encounters.length; i++) {
    const e = combat.encounters[i];
    if (e.outcome === "A") { scoreA++; continue; }
    if (e.outcome === "B") { scoreB++; continue; }
    ties++;
    const award = tieAward(o5, m.turns[i].attacker, byUidA.get(e.a.uid)!, byUidB.get(e.b.uid)!);
    if (award === "A") scoreA++;
    else if (award === "B") scoreB++;
  }

  if (scoreA !== scoreB) {
    return { winner: scoreA > scoreB ? "A" : "B", draw: false, unresolved: false, scoreA, scoreB, ties, decidedBy: "SCORE" };
  }

  // Desempate del PDF: suma de las medias de las 10 cartas.
  const ovrA = sumOvr(m.snapshotA.cards), ovrB = sumOvr(m.snapshotB.cards);
  if (ovrA !== ovrB) {
    const w: Side = ovrA > ovrB ? "A" : "B";
    if (w === "A") scoreA++; else scoreB++;
    return { winner: w, draw: false, unresolved: false, scoreA, scoreB, ties, decidedBy: "OVR" };
  }

  // Doble empate: entra la candidata de OPD-08.
  const base = { draw: false, unresolved: false, scoreA, scoreB, ties };
  const decide = (w: Side | null): Outcome =>
    w !== null
      ? { ...base, winner: w, decidedBy: "CANDIDATE" }
      : o8 === "UNRESOLVED"
        ? { ...base, winner: null, unresolved: true, decidedBy: "NONE" }
        : { ...base, winner: null, draw: true, decidedBy: "NONE" };

  switch (o8) {
    case "UNRESOLVED":
    case "DRAW":
      return decide(null);
    case "MARGIN": {
      const t = statTotals(combat.encounters);
      return decide(t.a > t.b ? "A" : t.b > t.a ? "B" : null);
    }
    case "ENCOUNTERS_WON": {
      // Enfrentamientos ganados SIN contar los puntos de desempate. Igual por construcción
      // cuando la candidata de OPD-05 no reparte los empates.
      const wonA = combat.encounters.filter((e) => e.outcome === "A").length;
      const wonB = combat.encounters.filter((e) => e.outcome === "B").length;
      return decide(wonA > wonB ? "A" : wonB > wonA ? "B" : null);
    }
    case "DOMINANT_STATS": {
      const dA = dominantTotal(m.snapshotA.cards), dB = dominantTotal(m.snapshotB.cards);
      return decide(dA > dB ? "A" : dB > dA ? "B" : null);
    }
    case "FEWER_TIES": {
      // Menos enfrentamientos empatados. Simétrico por definición ⇒ nunca decide nada.
      return decide(null);
    }
  }
}

// ───────────────────────────── Agregación ─────────────────────────────

interface Stats {
  n: number;
  winA: number; winB: number; draw: number; unresolved: number;
  /** Victorias del bando que atacó PRIMERO, y partidas decisivas, para el sesgo. */
  firstWin: number; decisive: number;
  sumScoreA: number; sumScoreB: number; sumTies: number;
  byLevel: Record<Outcome["decidedBy"], number>;
}

const emptyStats = (): Stats => ({
  n: 0, winA: 0, winB: 0, draw: 0, unresolved: 0, firstWin: 0, decisive: 0,
  sumScoreA: 0, sumScoreB: 0, sumTies: 0,
  byLevel: { SCORE: 0, OVR: 0, CANDIDATE: 0, NONE: 0 },
});

function record(s: Stats, o: Outcome, first: Side): void {
  s.n++;
  s.sumScoreA += o.scoreA; s.sumScoreB += o.scoreB; s.sumTies += o.ties;
  s.byLevel[o.decidedBy]++;
  if (o.winner === "A") s.winA++;
  else if (o.winner === "B") s.winB++;
  else if (o.unresolved) s.unresolved++;
  else s.draw++;
  if (o.winner !== null) { s.decisive++; if (o.winner === first) s.firstWin++; }
}

const pct = (x: number, n: number) => (n === 0 ? "  n/a" : `${((100 * x) / n).toFixed(2).padStart(5)}%`);

// ───────────────────────────── Escenarios ─────────────────────────────

const decks = buildDecks();
/** Espejo real: mismas cartas, otro dueño. */
const mirrorOf = (s: DuelDeckSnapshot, id: string) => mirrorSnapshot(s, id);

const PAIRS: { label: string; a: DuelDeckSnapshot; b: DuelDeckSnapshot; mirror: boolean }[] = [
  { label: "M1 vs M1", a: decks.M1, b: mirrorOf(decks.M1, "mirror-m1"), mirror: true },
  { label: "M2 vs M2", a: decks.M2, b: mirrorOf(decks.M2, "mirror-m2"), mirror: true },
  { label: "M3 vs M3", a: decks.M3, b: mirrorOf(decks.M3, "mirror-m3"), mirror: true },
  { label: "M1 vs M2", a: decks.M1, b: decks.M2, mirror: false },
  { label: "M1 vs M3", a: decks.M1, b: decks.M3, mirror: false },
  { label: "M2 vs M3", a: decks.M2, b: decks.M3, mirror: false },
];

/** Semillas deterministas: la partida i de un escenario siempre es la misma. */
const seedPair = (i: number): [number, number] => [i * 7919 + 13, i * 6271 + 977];

// ───────────────────────────── Experimento 1: reglas de resultado ─────────────────────────────

console.log("═".repeat(96));
console.log(`DUEL BALANCE LAB · Fase 7 · ${N} partidas por celda`);
console.log("═".repeat(96));

console.log("\nMAZOS");
for (const [k, s] of Object.entries(decks)) {
  console.log(`  ${k}  ovr Σ ${sumOvr(s.cards)}  ·  ${s.cards.map((c) => c.ovr).join(" ")}`);
}

// Un solo pase de partidas por escenario; todas las candidatas leen de él.
interface Played { match: DuelMatch; first: Side }
const played = new Map<string, Played[]>();

console.log(`\n[1/4] Jugando ${PAIRS.length * N} partidas Bot aleatorio vs Bot aleatorio…`);
const t0 = Date.now();
for (const p of PAIRS) {
  const list: Played[] = [];
  for (let i = 0; i < N; i++) {
    const [sa, sb] = seedPair(i);
    const first: Side = i % 2 === 0 ? "A" : "B";
    list.push({ match: play(p.a, p.b, createRandomBot("ra"), createRandomBot("rb"), sa, sb, first), first });
  }
  played.set(p.label, list);
}
console.log(`      hecho en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ── OPD-05: frecuencia de empates de enfrentamiento y efecto de cada candidata ──
console.log("\n" + "─".repeat(96));
console.log("OPD-05 · ¿qué ocurre cuando un enfrentamiento individual empata?");
console.log("─".repeat(96));

{
  let encounters = 0, tied = 0;
  for (const list of played.values()) {
    for (const { match } of list) {
      encounters += 10;
      tied += match.result!.combat.tiedEncounters;
    }
  }
  console.log(`\n  Frecuencia base: ${tied} de ${encounters} enfrentamientos empatan (${pct(tied, encounters)}).`);
  console.log(`  Partidas con al menos un empate de enfrentamiento: ${pct(
    [...played.values()].flat().filter((p) => p.match.result!.combat.tiedEncounters > 0).length,
    PAIRS.length * N,
  )}`);
}

console.log("\n  Con OPD-08 = DRAW fijo, para aislar el efecto de OPD-05:\n");
console.log("  regla        escenario     A       B      draw    1er-atac.  sesgo    marcador   empates");
for (const rule of OPD05) {
  for (const p of PAIRS) {
    const s = emptyStats();
    for (const { match, first } of played.get(p.label)!) record(s, evaluate(match, rule, "DRAW"), first);
    const bias = s.decisive === 0 ? 0 : s.firstWin / s.decisive - 0.5;
    console.log(
      `  ${rule.padEnd(11)}  ${p.label}  ${pct(s.winA, s.n)} ${pct(s.winB, s.n)} ${pct(s.draw, s.n)}` +
      `   ${pct(s.firstWin, s.decisive)}  ${(bias >= 0 ? "+" : "") + (100 * bias).toFixed(2)}%` +
      `   ${(s.sumScoreA / s.n).toFixed(2)}-${(s.sumScoreB / s.n).toFixed(2)}   ${(s.sumTies / s.n).toFixed(2)}`,
    );
  }
  console.log("");
}

// ── OPD-08: poder de resolución de cada candidata ──
console.log("─".repeat(96));
console.log("OPD-08 · ¿qué ocurre cuando marcador Y suma de OVR quedan igualados?");
console.log("─".repeat(96));

{
  // Con OPD-05 = NO_POINT (la regla vigente), cuántas partidas llegan al doble empate.
  let doubles = 0, total = 0;
  for (const p of PAIRS) {
    let d = 0;
    for (const { match } of played.get(p.label)!) {
      const o = evaluate(match, "NO_POINT", "UNRESOLVED");
      if (o.unresolved) d++;
    }
    doubles += d; total += N;
    console.log(`  ${p.label}: doble empate en ${pct(d, N)} de las partidas`);
  }
  console.log(`  TOTAL: ${pct(doubles, total)}\n`);
}

console.log("  Poder de resolución de cada candidata sobre las partidas en doble empate:\n");
console.log("  candidata        escenario     resuelve   A       B      draw");
for (const rule of OPD08) {
  for (const p of PAIRS) {
    const s = emptyStats();
    let doubles = 0, solved = 0;
    for (const { match, first } of played.get(p.label)!) {
      const ref = evaluate(match, "NO_POINT", "UNRESOLVED");
      if (!ref.unresolved) continue;
      doubles++;
      const o = evaluate(match, "NO_POINT", rule);
      if (o.winner !== null) solved++;
      record(s, o, first);
    }
    if (doubles === 0) { console.log(`  ${rule.padEnd(15)}  ${p.label}  (sin dobles empates)`); continue; }
    console.log(
      `  ${rule.padEnd(15)}  ${p.label}  ${pct(solved, doubles)}   ${pct(s.winA, s.n)} ${pct(s.winB, s.n)} ${pct(s.draw + s.unresolved, s.n)}`,
    );
  }
  console.log("");
}

// ── Simetría de la candidata MARGIN sobre TODAS las partidas ──
console.log("─".repeat(96));
console.log("SIMETRÍA · candidata elegida (OPD-05 = NO_POINT, OPD-08 = MARGIN) sobre todas las partidas");
console.log("─".repeat(96));
console.log("\n  escenario      A       B      draw   sin resolver   1er-atac.  sesgo    decidido por");
for (const p of PAIRS) {
  const s = emptyStats();
  for (const { match, first } of played.get(p.label)!) record(s, evaluate(match, "NO_POINT", "MARGIN"), first);
  const bias = s.decisive === 0 ? 0 : s.firstWin / s.decisive - 0.5;
  console.log(
    `  ${p.label}  ${pct(s.winA, s.n)} ${pct(s.winB, s.n)} ${pct(s.draw, s.n)}  ${pct(s.unresolved, s.n)}` +
    `        ${pct(s.firstWin, s.decisive)}  ${(bias >= 0 ? "+" : "") + (100 * bias).toFixed(2)}%` +
    `   marcador ${pct(s.byLevel.SCORE, s.n)} · ovr ${pct(s.byLevel.OVR, s.n)} · margen ${pct(s.byLevel.CANDIDATE, s.n)} · nada ${pct(s.byLevel.NONE, s.n)}`,
  );
}

// ───────────────────────────── Experimento 2: dificultad ─────────────────────────────

console.log("\n" + "─".repeat(96));
console.log("OPD-42 · escalera de dificultad");
console.log("─".repeat(96));

/** Estrategia de referencia «jugador casual»: elige carta al azar, pero declara su mejor eje. */
function createCasualBot(id: string): DuelOpponent {
  const random = createRandomBot(id, "EASY");
  const smart = createSmartBot(id, "NORMAL");
  return {
    id, kind: "BOT", difficulty: "EASY", perfectInformation: false,
    chooseAttackerCard: (ctx) => random.chooseAttackerCard(ctx),
    // Con la carta ya fijada, declarar su valor más alto es el instinto humano evidente.
    chooseAttackerStat: (ctx) => smart.chooseAttackerStat(ctx),
    chooseDefenderCard: (ctx) => random.chooseDefenderCard(ctx),
    chooseDefenderStat: (ctx) => random.chooseDefenderStat(ctx),
  };
}

/** Enfrenta dos estrategias sobre un escenario y devuelve la tasa de victoria de A. */
function duelStrategies(
  a: DuelDeckSnapshot, b: DuelDeckSnapshot,
  makeA: (id: string) => DuelOpponent, makeB: (id: string) => DuelOpponent, n: number,
): Stats {
  const s = emptyStats();
  for (let i = 0; i < n; i++) {
    const [sa, sb] = seedPair(i);
    const first: Side = i % 2 === 0 ? "A" : "B";
    const m = play(a, b, makeA("x"), makeB("y"), sa, sb, first);
    record(s, evaluate(m, "NO_POINT", "MARGIN"), first);
  }
  return s;
}

const LADDER_N = Math.max(400, Math.round(N / 5));
const mirror1 = { a: decks.M1, b: mirrorOf(decks.M1, "mirror-m1") };

/** Cuántas partidas DISTINTAS produce una configuración. Un bot 100 % determinista produce una. */
function distinctGames(
  a: DuelDeckSnapshot, b: DuelDeckSnapshot,
  makeA: (id: string) => DuelOpponent, makeB: (id: string) => DuelOpponent, n: number,
): number {
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const [sa, sb] = seedPair(i);
    const m = play(a, b, makeA("x"), makeB("y"), sa, sb, i % 2 === 0 ? "A" : "B");
    seen.add(m.turns.map((t) => `${t.attackerCardUid}|${t.attackerStat}|${t.defenderCardUid}`).join(","));
  }
  return seen.size;
}

const rate = (r: number, perfect = false) => (id: string) =>
  createDuelBot(id, "NORMAL", { heuristicRate: r, perfectInformation: perfect });

console.log(`\n  ESCALERA ACTUAL (Fase 6), mazos idénticos M1 vs M1, ${LADDER_N} partidas por celda.`);
console.log("  Cada celda: tasa de victoria de la FILA.\n");

const LEGACY: Record<string, (id: string) => DuelOpponent> = {
  EASY: (id) => createRandomBot(id, "EASY"),
  NORMAL: (id) => createSmartBot(id, "NORMAL"),
  HARD: (id) => createSmartBot(id, "HARD"),
};

function matrix(make: Record<string, (id: string) => DuelOpponent>, n: number): void {
  const names = Object.keys(make);
  console.log("               " + names.map((x) => x.padStart(10)).join("") + "   partidas distintas (X vs X)");
  for (const row of names) {
    const cells = names.map((col) => {
      const s = duelStrategies(mirror1.a, mirror1.b, make[row], make[col], n);
      return `${((100 * s.winA) / s.n).toFixed(1)}%`.padStart(10);
    });
    const d = distinctGames(mirror1.a, mirror1.b, make[row], make[row], Math.min(n, 200));
    console.log(`  ${row.padEnd(13)}` + cells.join("") + `        ${d} de ${Math.min(n, 200)}`);
  }
}
matrix(LEGACY, LADDER_N);

console.log("\n  BARRIDO de la tasa de heurística p, contra EASY (p=0), CASUAL y heurística pura (p=1).\n");
console.log("     p     vs EASY   vs CASUAL   vs p=1     partidas distintas (p vs p)");
for (const p of [0.15, 0.25, 0.4, 0.5, 0.6, 0.75, 0.85, 0.95, 1]) {
  const easy = duelStrategies(mirror1.a, mirror1.b, rate(p), rate(0), LADDER_N);
  const casual = duelStrategies(mirror1.a, mirror1.b, rate(p), createCasualBot, LADDER_N);
  const pure = duelStrategies(mirror1.a, mirror1.b, rate(p), rate(1), LADDER_N);
  const d = distinctGames(mirror1.a, mirror1.b, rate(p), rate(p), Math.min(LADDER_N, 200));
  console.log(
    `  ${(100 * p).toFixed(0).padStart(4)}%   ${pct(easy.winA, easy.n)}     ${pct(casual.winA, casual.n)}` +
    `   ${pct(pure.winA, pure.n)}        ${d} de ${Math.min(LADDER_N, 200)}`,
  );
}

console.log("\n  ESCALERA PROPUESTA — perfiles vigentes de `DIFFICULTY_PROFILE`.\n");
const LADDER: Record<string, (id: string) => DuelOpponent> = {
  EASY: (id) => createDuelBot(id, "EASY"),
  NORMAL: (id) => createDuelBot(id, "NORMAL"),
  HARD: (id) => createDuelBot(id, "HARD"),
  CASUAL: createCasualBot,
};
matrix(LADDER, LADDER_N);

console.log("\n  HUMANO CASUAL contra la escalera (§15). Tasa de victoria del jugador casual:\n");
for (const level of ["EASY", "NORMAL", "HARD"] as const) {
  for (const [label, a, b] of [["M1 vs M1", mirror1.a, mirror1.b], ["M1 vs M2", decks.M1, decks.M2]] as const) {
    const s = duelStrategies(a, b, createCasualBot, LADDER[level], LADDER_N);
    console.log(`    casual vs ${level.padEnd(6)} · ${label}: ${pct(s.winA, s.n)}  (empates ${pct(s.draw, s.n)})`);
  }
}

// ───────────────────────────── Experimento 3: información oculta ─────────────────────────────

console.log("\n" + "─".repeat(96));
console.log("OPD-04 · ¿cuánto aporta ver el mazo rival?");
console.log("─".repeat(96));
console.log("\n  Medido con bots ESTOCÁSTICOS (p = 0,85) para que exista distribución y no una única partida.\n");

const perfect = rate(0.85, true);
const publicOnly = rate(0.85, false);

for (const [label, a, b] of [["M1 vs M1 (espejo)", mirror1.a, mirror1.b], ["M1 vs M2", decks.M1, decks.M2]] as const) {
  const head = duelStrategies(a, b, perfect, publicOnly, LADDER_N);
  const vsEasy = duelStrategies(a, b, perfect, rate(0), LADDER_N);
  const vsEasyPub = duelStrategies(a, b, publicOnly, rate(0), LADDER_N);
  const vsCasual = duelStrategies(a, b, perfect, createCasualBot, LADDER_N);
  const vsCasualPub = duelStrategies(a, b, publicOnly, createCasualBot, LADDER_N);
  console.log(`  ${label}`);
  console.log(`     info perfecta vs info pública, cara a cara : ${pct(head.winA, head.n)}  (50 % = no aporta)`);
  console.log(`     vs EASY   — perfecta ${pct(vsEasy.winA, vsEasy.n)} · pública ${pct(vsEasyPub.winA, vsEasyPub.n)}` +
    `  ⇒ ${((100 * (vsEasy.winA - vsEasyPub.winA)) / vsEasy.n).toFixed(2)} puntos`);
  console.log(`     vs CASUAL — perfecta ${pct(vsCasual.winA, vsCasual.n)} · pública ${pct(vsCasualPub.winA, vsCasualPub.n)}` +
    `  ⇒ ${((100 * (vsCasual.winA - vsCasualPub.winA)) / vsCasual.n).toFixed(2)} puntos\n`);
}

console.log("═".repeat(96));
console.log("FIN. El laboratorio no decide: la decisión se documenta en el informe de Fase 7.");
console.log("═".repeat(96));
