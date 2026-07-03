/**
 * VALIDACIÓN DEL MATCH NARRATIVE ENGINE.
 *
 * Un "match runner" mínimo (NO forma parte del engine ni del sim) juega partidos a
 * 13 con cambio de lado, arrastre mental y timeouts ocasionales, y alimenta al
 * MatchNarrator. Se simulan cientos de partidos y se comprueba que NINGUNA historia
 * es igual: cambian héroes, puntos de inflexión, formas y resúmenes.
 *
 * Uso:  npx tsx scripts/narrative-report.ts [partidos]
 */
import { createRound, tick, applyCall, nextRoundMemory, type MatchMemory } from "../src/sim";
import type { RoundState, CoachSetup, Side, CoachCallId } from "../src/sim";
import { buildMatchNarrative, answerQuestions, type NarrativeState } from "../src/narrative";

const TARGET = 13;
const ATK_APPROACHES = ["default", "rush-main", "split"];
const DEF_APPROACHES = ["balanced", "stack-a", "aggro-info"];
const TEMPOS = ["slow", "mid", "fast"] as const;
const ATK_CALLS: CoachCallId[] = ["rush", "rotate-tree", "play-picks", "execute"];
const DEF_CALLS: CoachCallId[] = ["rush", "play-picks", "execute"];

const h = (a: number, b: number) => (Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 1, 40503)) >>> 0;
const pick = <T>(arr: readonly T[], seed: number) => arr[seed % arr.length];

/** Juega un partido completo y devuelve sus rondas (RoundState terminados). */
function runMatch(matchSeed: number): RoundState[] {
  const rounds: RoundState[] = [];
  let memory: MatchMemory | undefined;
  let homeScore = 0, awayScore = 0, r = 0;
  // Base táctica estable por mitad (varía por partido): así un cambio de plan = adaptación real.
  const atkApproach = pick(ATK_APPROACHES, h(matchSeed, 1));
  const defApproach = pick(DEF_APPROACHES, h(matchSeed, 2));
  const tempo = pick(TEMPOS, h(matchSeed, 3));

  while (homeScore < TARGET && awayScore < TARGET && r < 30) {
    r++;
    const side: Side = r <= 12 ? "ATK" : "DEF";
    const setup: CoachSetup = {
      side,
      approach: side === "ATK" ? atkApproach : defApproach,
      tempo,
      aggression: "balanced",
    };
    let s = createRound(matchSeed * 131 + r, setup, memory);

    // Timeout/adaptación del coach en ~1 de cada 4 rondas (cambia el plan → tactical_shift).
    const callHash = h(matchSeed, r * 7);
    const doCall = callHash % 4 === 0;
    const callId = pick(side === "ATK" ? ATK_CALLS : DEF_CALLS, callHash >> 3);
    const callTick = 20 + (callHash % 24);

    let g = 0;
    while (s.phase !== "ENDED" && g++ < 4000) {
      s = tick(s);
      if (doCall && s.tick === callTick && s.voz.left > 0) s = applyCall(s, { id: callId });
    }
    rounds.push(s);
    if (s.winner === side) homeScore++; else awayScore++;
    memory = nextRoundMemory(s);
  }
  return rounds;
}

/** Firma compacta de una historia (para medir unicidad). */
function storySignature(ns: NarrativeState): string {
  return [
    ns.match.shape.id,
    ns.match.winner,
    `${ns.match.score.A}-${ns.match.score.B}`,
    ns.summary.mvp,
    ns.summary.turningPoint,
    ns.heroes.map((x) => x.name).join(","),
    ns.momentum.shifts.map((x) => `${x.to}@${x.round}`).join("|"),
  ].join(" · ");
}

// --------------------------- EJECUCIÓN ---------------------------
const N = Number(process.argv[2] ?? 200);
const states: NarrativeState[] = [];
for (let seed = 1; seed <= N; seed++) states.push(buildMatchNarrative(runMatch(seed)));

// Determinismo: misma semilla ⇒ misma historia.
const det = storySignature(buildMatchNarrative(runMatch(7))) === storySignature(buildMatchNarrative(runMatch(7)));

// --------------------------- MÉTRICAS ---------------------------
const sigs = states.map(storySignature);
const uniqueStories = new Set(sigs).size;
const shapeCounts: Record<string, number> = {};
const mvps = new Set<string>();
const inflections: number[] = [];
let withGraph = 0, edgeTotal = 0, nodeTotal = 0, withComeback = 0, withDisappeared = 0;
const heroSet = new Set<string>();
for (const ns of states) {
  shapeCounts[ns.match.shape.id] = (shapeCounts[ns.match.shape.id] ?? 0) + 1;
  if (ns.summary.mvp) mvps.add(ns.summary.mvp);
  for (const hh of ns.heroes) heroSet.add(hh.name);
  if (ns.summary.turningPoint != null) inflections.push(ns.summary.turningPoint);
  if (ns.graph.edges.length) { withGraph++; edgeTotal += ns.graph.edges.length; nodeTotal += ns.graph.nodes.length; }
  if (ns.graph.nodes.some((n) => n.type === "comeback_started")) withComeback++;
  if (ns.players.some((p) => p.states.includes("disappeared"))) withDisappeared++;
}
const allWon = states.every((ns) => ns.match.winner != null);

// --------------------------- INFORME ---------------------------
const L: string[] = [];
const log = (s = "") => L.push(s);
const pct = (n: number) => `${Math.round((n / N) * 100)}%`;

log("# Match Narrative Engine — Informe de validación");
log("");
log(`Partidos simulados: **${N}** (a ${TARGET}, cambio de lado, arrastre mental, timeouts).`);
log(`Determinismo (misma semilla ⇒ misma historia): **${det ? "OK ✓" : "FALLO ✗"}**`);
log(`Todos los partidos con ganador: **${allWon ? "OK ✓" : "FALLO ✗"}**`);
log("");
log("## ¿Es única cada historia?");
log("");
log(`Historias únicas: **${uniqueStories}/${N}** (${pct(uniqueStories)}).`);
log(`MVPs distintos: **${mvps.size}** · Héroes distintos: **${heroSet.size}**.`);
log(`Puntos de inflexión: rango ronda ${Math.min(...inflections)}–${Math.max(...inflections)}, ${new Set(inflections).size} valores distintos.`);
log(`Story graph: media de **${(nodeTotal / Math.max(1, withGraph)).toFixed(1)} nodos** y **${(edgeTotal / Math.max(1, withGraph)).toFixed(1)} aristas** por partido.`);
log(`Partidos con remontada detectada: **${pct(withComeback)}** · con algún jugador "desaparecido": **${pct(withDisappeared)}**.`);
log("");
log("## Distribución de FORMAS de partido (emergentes)");
log("");
log("| Forma | Partidos | % |");
log("|---|---|---|");
for (const [k, v] of Object.entries(shapeCounts).sort((a, b) => b[1] - a[1])) {
  log(`| ${k} | ${v} | ${pct(v)} |`);
}
log("");

// --------------------------- HISTORIAS DE EJEMPLO ---------------------------
function sample(predicate: (ns: NarrativeState, i: number) => boolean, label: string): NarrativeState | null {
  for (let i = 0; i < states.length; i++) if (predicate(states[i], i)) return states[i];
  return null;
}
const examples: { title: string; ns: NarrativeState }[] = [];
const comeback = sample((ns) => ns.match.shape.id === "comeback" || ns.match.shape.id === "miracle", "remontada");
const blowout = sample((ns) => ns.match.shape.id === "blowout" || ns.match.shape.id === "snowball", "paliza");
const nail = sample((ns) => ns.match.shape.id === "nail_biter" || ns.match.shape.id === "trading_blows", "ajustado");
if (comeback) examples.push({ title: "REMONTADA / MILAGRO", ns: comeback });
if (blowout) examples.push({ title: "PALIZA / BOLA DE NIEVE", ns: blowout });
if (nail) examples.push({ title: "AL FILO / INTERCAMBIO", ns: nail });

for (const { title, ns } of examples) {
  const q = answerQuestions(ns);
  log(`## Historia de ejemplo — ${title}`);
  log("");
  log(`**${ns.summary.headline}** · ${ns.match.teams.A.name} ${ns.match.score.A}–${ns.match.score.B} ${ns.match.teams.B.name} · forma: ${ns.match.shape.id}`);
  log("");
  log("Resumen (verbalización determinista por plantilla):");
  for (const b of ns.summary.beats) log(`- ${b.text}`);
  log("");
  log("Preguntas respondidas por el motor:");
  log(`- **¿Por qué ganó?** ${q.whyWon.text}`);
  log(`- **¿Cuándo cambió?** ${q.whenItChanged.text}`);
  log(`- **¿MVP real?** ${q.realMVP.text}`);
  log(`- **¿Quién desapareció?** ${q.whoDisappeared.text}`);
  log(`- **¿Decisión decisiva?** ${q.decisiveDecision.text}`);
  log(`- **¿Momento clave?** ${q.biggestMoment.text}`);
  log("");
  log("Cadena causal del Story Graph (extracto):");
  const chain = ns.graph.edges.slice(0, 8).map((e) => {
    const f = ns.graph.nodes.find((n) => n.id === e.from)!;
    const t = ns.graph.nodes.find((n) => n.id === e.to)!;
    return `  - \`${f.type}(r${f.round})\` —${e.relation}→ \`${t.type}(r${t.round})\` _(peso ${e.weight})_`;
  });
  for (const c of chain) log(c);
  log("");
}

const out = L.join("\n");
console.log(out);
import { writeFileSync } from "fs";
writeFileSync(new URL("./narrative-report.out.md", import.meta.url), out);
