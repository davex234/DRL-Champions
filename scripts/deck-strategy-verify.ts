/**
 * FASE 43 · VERIFICADOR DE ESTRATEGIA — `npm run deck-strategy:verify` (todo) o por sección:
 *
 *   deck-strategy-analysis:verify     stats canónicas, agregados exactos, percentiles del catálogo, orientación, balance,
 *                                     roles, aportación, orden/serial/metadatos sin efecto
 *   deck-strategy-suggestion:verify   objetivos (eje exacto, equilibrado con suelo de OVR), legalidad, propiedad,
 *                                     determinismo, Pareto sin «mejor», autocompletar intacto
 *   deck-strategy-security:verify     cuerpos estrictos (sin stats/usuario), ajenas no accionables, rival oculto en
 *                                     PvE/PvP/privado, sin rutas nuevas, sin red en la capa, Marketplace cerrado, sin migración
 *   deck-strategy-match:verify        resumen por eje/carta exacto con el MOTOR REAL, desempates, empates, repetición sin
 *                                     volver a jugar, sin causas inventadas
 *   deck-strategy-performance:verify  p50/p95/p99 de análisis, alternativas, sugerencia y comparación con 5.000 ejemplares
 *   deck-strategy-content:verify      catálogo real, motor/reglas/bots intactos, salidas máquina de la fase presentes y sanas
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { CARDS } from "../src/data/catalog";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES } from "../src/domain/cardgame/types";
import { CURRENT_COMBAT_RULES } from "../src/domain/cardgame/combat/rules";
import { ORCHESTRATOR_VERSION, TURNS_PER_MATCH } from "../src/domain/cardgame/match/types";
import { DIFFICULTY_PROFILE } from "../src/domain/cardgame/opponent/bots";
import { projectMatchFor } from "../src/domain/cardgame/pvp";
import { autocomplete, checkDraft, indexPool, tryReplace } from "../src/domain/deckBuilder/builder";
import { parseDeckRequest } from "../src/domain/deckBuilder/request";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";
import {
  AXES, METRICS, analyzeDeck, compareDecks, informativeImpact, orientationOf, paretoOptions, percentileRank, quantile, suggestDeck,
  summarizeMatch, swapAlternatives, totalsOf, type TurnFact,
} from "../src/domain/deckStrategy";
import { builderCardOf, catalogCards, strategyContext, syntheticCollection } from "../src/lib/deckStrategy/catalog";
import { qaFindMatch, qaRegistry, qaSimulate, qaSnapshot, qaView } from "../src/lib/duel/qaSimulation";
import { buildMatchView } from "../src/lib/duel/matchView";

const section = process.argv[2] ?? "all";
const want = (s: string) => section === "all" || section === s;
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const json = (rel: string) => (existsSync(join(ROOT, rel)) ? JSON.parse(read(rel)) : null);
const ctx = strategyContext();
const COLL = syntheticCollection(600, 43_1, 600);
const POOL = indexPool(COLL);
const BAL = suggestDeck(POOL, "BALANCED", ctx);
const cards = BAL.cards;

function main() {
  console.log(`FASE 43 · estrategia · sección ${section}`);

  if (want("analysis")) {
    console.log("\n· ANÁLISIS");
    const a = analyzeDeck(cards, ctx);
    check("stats canónicas: OVR y trío idénticos al catálogo", COLL.every((c) => { const d = CARDS.find((x) => x.id === c.cardId)!; return d.ovr === c.ovr && AXES.every((ax) => d.combat![ax] === c.combat[ax]); }));
    check("medias exactas", METRICS.every((m) => a.metrics[m].mean === cards.reduce((s, c) => s + (m === "ovr" ? c.ovr : c.combat[m]), 0) / 10));
    const vals = catalogCards().map((c) => c.combat.entryfrag);
    const c0 = a.contributions[0];
    check("percentil de carta derivado del catálogo", c0.catalogPercentile.entryfrag === (100 * (vals.filter((v) => v < c0.values.entryfrag).length + vals.filter((v) => v === c0.values.entryfrag).length / 2)) / vals.length);
    check("percentil de equipo frente a la calibración", a.deckPercentile!.gamesense === percentileRank(ctx.calibration.sorted.gamesense, a.metrics.gamesense.mean));
    check("orientación por reglas en σ (1 y 0,5)", orientationOf({ stronghold: 1, gamesense: 0, entryfrag: 0 }).kind === "ORIENTED" && orientationOf({ stronghold: 0.4, gamesense: 0, entryfrag: 0 }).kind === "BALANCED" && orientationOf({ stronghold: 0.8, gamesense: 0.6, entryfrag: 0 }).kind === "MIXED");
    check("orden de cartas irrelevante", JSON.stringify(analyzeDeck([...cards].reverse(), ctx)) === JSON.stringify(a));
    check("serial/rareza/equipo/región/edición sin efecto", JSON.stringify(analyzeDeck(BAL.uids.map((u) => ({ ...POOL.get(u)!, serial: 1, team: "X", region: "China" as never, variantId: "icon-series" as never, statBoost: 12 })), ctx)) === JSON.stringify(a));
    check("roles: 5 perfiles de 2 cartas", a.roles.length === 5 && a.roles.every((r) => r.count === 2));
    check("≤ 3 fortalezas y ≤ 3 puntos flojos", a.strengths.length <= 3 && a.weaknesses.length <= 3);
    check("sin «puntuación de estrategia» (ningún X/100)", !/\/100|score|puntuación/i.test(code(read("src/domain/deckStrategy/analysis.ts"))));
  }

  if (want("suggestion")) {
    console.log("\n· SUGERENCIAS");
    const all = (["BALANCED", ...AXES] as const).map((o) => suggestDeck(POOL, o, ctx));
    check("4 objetivos legales y con cartas poseídas", all.every((s) => s.ok && checkDraft(s.uids, POOL).ready && s.uids.every((u) => POOL.has(u))));
    check("deterministas", all.every((s) => suggestDeck(POOL, s.objective, ctx).uids.join() === s.uids.join()));
    check("cada eje, su máximo entre las sugerencias", AXES.every((ax) => all.every((s) => all.find((x) => x.objective === ax)!.totals![ax] >= s.totals![ax])));
    check("equilibrado: la menor distancia entre ejes", AXES.every((ax) => analyzeDeck(all[0].cards, ctx).orientation!.spreadSd <= analyzeDeck(all.find((x) => x.objective === ax)!.cards, ctx).orientation!.spreadSd + 1e-9));
    const opts = paretoOptions(POOL, ctx);
    check("Pareto: opciones «Más …», sin «mejor»", opts.length >= 2 && opts.every((o) => o.labels.every((l) => l.startsWith("Más ") && !/mejor/i.test(l))));
    const auto = autocomplete([], POOL);
    check("autocompletar intacto (legal, máxima OVR)", auto.ok && checkDraft(auto.uids, POOL).ready && totalsOf(auto.uids.map((u) => POOL.get(u)!)).ovr >= Math.max(...all.map((s) => s.totals!.ovr)));
    const sim = json("docs/product/qa/fase43/suggestion-simulation.json");
    check("simulación de sugerencias: 0 violaciones y equilibrado exacto en colecciones pequeñas", !!sim && sim.violations === 0 && sim.balancedVsBruteForce.exactPct === 100, sim ? `${sim.balancedVsBruteForce.exactSpread}/${sim.balancedVsBruteForce.collections}` : "falta");
    check("sin «MEJOR DECK» en la interfaz", !/mejor equipo|mejor deck|best deck/i.test(readdirSync(join(ROOT, "src/components/duel/strategy")).filter((f) => !f.includes(".test.")).map((f) => code(read(`src/components/duel/strategy/${f}`))).join("\n").replace(/No existe «el mejor equipo»/g, "")));
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD");
    check("cuerpo de mutación: rechaza ovr/combat/role/serial/userId", [{ ovr: 99 }, { combat: {} }, { role: "Flex" }, { serial: 1 }, { userId: "x" }].every((x) => !parseDeckRequest({ action: "save", name: "x", cardUids: [], ...x }).ok));
    check("ajena no accionable", !tryReplace(BAL.uids, BAL.uids[0], "ffffffff-0000-4000-8000-000000000001", POOL).ok);
    const def = catalogCards().find((d) => !COLL.some((c) => c.cardId === d.cardId) && d.role === cards[0].role)!;
    check("no poseída: comparación informativa sin acción", !("nextUids" in informativeImpact(cards, cards[0].uid, { ...def, uid: "x", nick: "x" }, ctx)));
    const a = qaSnapshot(0, "v-a", "A"); const b = qaSnapshot(1, "v-b", "B");
    let leak = 0;
    for (const t of [1, 3, 5, 8]) for (const mode of ["PVE", "PVP"] as const) {
      const m = qaSimulate(a, b, t, "A", t + 3);
      const v = mode === "PVE" ? buildMatchView(m, { side: "A", registry: qaRegistry, difficulty: "NORMAL" }) : buildMatchView(projectMatchFor(m, "A"), { side: "A", registry: qaRegistry, difficulty: "NORMAL", rivalLabel: "Rival" });
      const j = JSON.stringify(v) + JSON.stringify(summarizeMatch(v.history as unknown as TurnFact[], null));
      for (const u of b.cards.map((c) => c.uid).filter((u) => !m.usedB.includes(u))) if (j.includes(`"${u}"`)) leak++;
    }
    check("rival oculto: 0 cartas no jugadas en vista + lectura (PvE y PvP)", leak === 0, `${leak}`);
    check("sin ruta API nueva para estrategia", !readdirSync(join(ROOT, "src/app/api/game")).some((d) => /strateg|analis/i.test(d)));
    check("capa estratégica sin red ni almacenamiento", ![...readdirSync(join(ROOT, "src/domain/deckStrategy")).map((f) => `src/domain/deckStrategy/${f}`), "src/lib/deckStrategy/catalog.ts", "src/lib/deckStrategy/presentation.ts", ...readdirSync(join(ROOT, "src/components/duel/strategy")).map((f) => `src/components/duel/strategy/${f}`)].filter((f) => !f.includes(".test.")).some((f) => /fetch\(|supabase|localStorage/i.test(code(read(f)))));
    check("parámetros del laboratorio con listas cerradas", read("src/app/duelos/mazos/page.tsx").includes("isAxis(eje)"));
    check("Marketplace cerrado", GLOBAL_MARKET_ENABLED === false);
    check("sin migración nueva en la Fase 43 (última 0053)", !readdirSync(join(ROOT, "supabase/migrations")).some((f) => /^005[4-9]|^00[6-9]\d/.test(f)));
    const sec = json("docs/product/qa/fase43/security-fuzz.json");
    check("security-fuzz.json: ≥ 100.000 casos y 0 violaciones", !!sec && sec.cases >= 100_000 && sec.violations === 0 && !sec.mutate);
    const swap = json("docs/product/qa/fase43/swap-fuzz.json");
    check("swap-fuzz.json: ≥ 100.000 cambios y 0 violaciones", !!swap && swap.swaps >= 100_000 && swap.violations === 0 && !swap.mutate);
  }

  if (want("match")) {
    console.log("\n· PARTIDA");
    const kinds = ["SCORE", "OVR_TIEBREAK"] as const;
    for (const k of kinds) {
      const m = qaFindMatch((x) => x.result?.combat.decidedBy === k, 1, 3000)!;
      const v = qaView(m);
      const s = summarizeMatch(v.history as unknown as TurnFact[], v.result);
      check(`motor real · ${k}: lectura coherente con el marcador`, s.consistent && s.resolution!.decidedBy === k);
      check(`motor real · ${k}: victorias+derrotas+empates por eje = comparaciones`, s.axes.every((x) => x.wins + x.losses + x.ties === x.timesCompared) && s.axes.reduce((n, x) => n + x.timesCompared, 0) === 10);
    }
    const A0 = qaSnapshot(0, "mm-a", "A"); const B0 = qaSnapshot(0, "mm-b", "B");
    let stat = null; let draw = null;
    for (let i = 1; i < 3000 && (!stat || !draw); i++) { const m = qaSimulate(A0, B0, 10, i % 2 ? "A" : "B", i); if (m.result?.combat.decidedBy === "STAT_MARGIN" && !stat) stat = m; if (m.result?.combat.status === "DRAW" && !draw) draw = m; }
    const sv = qaView(stat!); const ss = summarizeMatch(sv.history as unknown as TurnFact[], sv.result);
    check("motor real · STAT_MARGIN: sin punto de desempate", ss.consistent && ss.resolution!.tiebreakPointYou === 0 && ss.resolution!.tiebreakPointRival === 0);
    const dv = qaView(draw!); const ds = summarizeMatch(dv.history as unknown as TurnFact[], dv.result);
    check("motor real · empate explícito", ds.consistent && dv.result!.isDraw && ds.resolution!.decidedBy === "NONE");
    const svc = read("src/server/services/duels.ts");
    const rep = svc.slice(svc.indexOf("export async function getReplay"), svc.indexOf("export async function listReplays"));
    check("repetición sin volver a ejecutar el motor", !/resolveCombat|confirmTurn|advanceBots|startDuelMatch/.test(rep) && rep.includes("turns: view.history"));
    check("sin causas inventadas en la lectura", !/porque|por culpa|debido a/.test(code(read("src/domain/deckStrategy/match.ts"))));
    const mf = json("docs/product/qa/fase43/match-insight-fuzz.json");
    check("match-insight-fuzz.json: ≥ 100.000 historiales + motor real, 0 violaciones", !!mf && mf.histories >= 100_000 && mf.engineMatches > 0 && mf.violations === 0 && !mf.mutate);
    const mut = json("docs/product/qa/fase43/match-insight-fuzz-mutation-tiebreak-point.json");
    check("el fuzzer detecta un desempate mal puntuado (mutación)", !!mut && mut.violations > 0);
  }

  if (want("performance")) {
    console.log("\n· RENDIMIENTO");
    const big = indexPool(syntheticCollection(5000, 5_043, 772));
    const t = (fn: () => void, n: number) => { const xs: number[] = []; for (let i = 0; i < n; i++) { const s = performance.now(); fn(); xs.push(performance.now() - s); } xs.sort((a, b) => a - b); return { p50: quantile(xs, 0.5), p95: quantile(xs, 0.95), p99: quantile(xs, 0.99) }; };
    const sug = suggestDeck(big, "gamesense", ctx);
    const an = t(() => analyzeDeck(sug.cards, ctx), 200);
    const sw = t(() => swapAlternatives(sug.uids, sug.uids[3], big, ctx), 30);
    const sg = t(() => suggestDeck(big, "BALANCED", ctx), 20);
    const cp = t(() => compareDecks("A", sug.cards, "B", BAL.cards, ctx), 100);
    const f = (x: { p50: number; p95: number; p99: number }) => `p50 ${x.p50.toFixed(2)} · p95 ${x.p95.toFixed(2)} · p99 ${x.p99.toFixed(2)} ms`;
    check("análisis < 20 ms (p95)", an.p95 < 20, f(an));
    check("alternativas < 50 ms (p95)", sw.p95 < 50, f(sw));
    check("sugerencia < 150 ms (p95)", sg.p95 < 150, f(sg));
    check("comparación < 20 ms (p95)", cp.p95 < 20, f(cp));
    check("alternativas sin consultas por carta (dominio puro, sin await)", !/await|fetch|supabase/.test(code(read("src/domain/deckStrategy/swap.ts"))));
    const st = json("docs/product/qa/fase43/strategy-fuzz.json");
    check("strategy-fuzz.json: ≥ 100.000 equipos, 0 violaciones", !!st && st.decks >= 100_000 && st.violations === 0 && !st.mutate, st ? `análisis p99 ${st.analysisTimingMs.p99} ms` : "falta");
  }

  if (want("content")) {
    console.log("\n· CONTENIDO Y REGLAS");
    check("catálogo real: 772 definiciones con trío", CARDS.length === 772 && CARDS.every((c) => !!c.combat));
    check("motor intacto: duel-turns-2 · duel-combat-2 · 10 turnos", ORCHESTRATOR_VERSION === "duel-turns-2" && CURRENT_COMBAT_RULES.version === "duel-combat-2" && TURNS_PER_MATCH === 10);
    check("bots intactos: 0 · 0,5 · 0,85", DIFFICULTY_PROFILE.EASY.heuristicRate === 0 && DIFFICULTY_PROFILE.NORMAL.heuristicRate === 0.5 && DIFFICULTY_PROFILE.HARD.heuristicRate === 0.85);
    check("equipo: 10 cartas, 2 por rol, 5 roles", DUEL_DECK_SIZE === 10 && DUEL_ROLES.length === 5 && Object.values(DUEL_COMPOSITION).every((x) => x === 2));
    check("sin química/bonus/sinergia en el dominio", !/chemistry|química|synergy|sinergia|bonus|buff/i.test(readdirSync(join(ROOT, "src/domain/deckStrategy")).filter((f) => !f.includes(".test.")).map((f) => code(read(`src/domain/deckStrategy/${f}`))).join("\n")));
    const cat = json("docs/product/qa/fase43/catalog-strategy.json");
    check("catalog-strategy.json: 772 definiciones y correlaciones", !!cat && cat.definitions === 772 && typeof cat.correlations["ovr~entryfrag"] === "number");
    const sim = json("docs/product/qa/fase43/legal-deck-simulation.json");
    check("legal-deck-simulation.json: ≥ 1.000.000 equipos y calibración representativa (≤ 2 puntos de percentil)", !!sim && sim.decks >= 1_000_000 && Object.values(sim.calibrationSample.check as Record<string, { maxPercentileGap: number }>).every((c) => c.maxPercentileGap <= 2));
    check("análisis de dominancia de OVR presente", !!sim?.dominance?.verdict, sim?.dominance?.verdict ?? "");
    check("orientaciones no forzadas (distribución medida)", !!sim && Object.keys(sim.orientation).length >= 4);
    check("gemelos reales disponibles para «cambio sin efecto»", !!builderCardOf("zhe__silver", 1) && !!builderCardOf("runner__silver", 2));
  }

  console.log(`\n${ok} ✓ · ${ko} ✗`);
  if (ko > 0) process.exitCode = 1;
}
main();
