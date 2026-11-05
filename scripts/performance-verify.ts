/**
 * VERIFICACIÓN DEL PERFORMANCE ANALYZER (Card Generator Fase 3/7).
 *
 * Comprueba: determinismo · no-mutación · PerformanceMetrics · AgentMetrics · MapMetrics ·
 * Timeline · Outliers · NarrativeTags · HistoricalContext · PerformanceConfidence · MVP ·
 * All-Star · Highlights · Economía · compat Importer · compat Analyzer F2 · rendimiento ·
 * cero estados imposibles. 100% en memoria, reloj lógico inyectado. Falla de verdad.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze, analyzeTournament, OUTLIER_Z, type TournamentFact, type AnalyzerResult } from "@/analyzer";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const registry = buildRegistry([]);
const ctx = (): ImportCtx => ({ clock: makeClock(1_700_000_000_000), identity: createIdentityResolver(registry) });

/* ── Fixture principal: Champions 2025 (final SEN 2-0 NRG) + agentes + mapas + rounds ── */
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
  rounds: [
    // m1m1 (SEN 13-7 NRG): pistol/eco/force/buy con ganador y lado del ganador.
    { matchMapId: "m1m1", index: 1, winner: "Sentinels", side: "attack", type: "pistol" },
    { matchMapId: "m1m1", index: 2, winner: "Sentinels", side: "attack", type: "eco" },
    { matchMapId: "m1m1", index: 3, winner: "NRG", side: "defense", type: "force" },
    { matchMapId: "m1m1", index: 4, winner: "Sentinels", side: "attack", type: "buy" },
    { matchMapId: "m1m1", index: 13, winner: "NRG", side: "attack", type: "pistol" },
    { matchMapId: "m1m1", index: 14, winner: "Sentinels", side: "defense", type: "eco" },
  ],
  standings: [
    { team: "Sentinels", position: 1, wins: 2, losses: 0, mapsWon: 4, mapsLost: 1, status: "qualified" },
    { team: "NRG", position: 2, wins: 1, losses: 1, mapsWon: 2, mapsLost: 2 },
    { team: "G2", position: 3, wins: 1, losses: 1 },
    { team: "Fnatic", position: 4, wins: 0, losses: 1, status: "eliminated" },
  ],
  awards: { champion: "Sentinels", runnerUp: "NRG" },
};

/* ── Historial objetivo inyectable (Champions 2024: SEN campeón, zekken rating 60) ── */
const history: TournamentFact[] = [{
  tournamentId: "champions-2024", type: "champions", endDate: 1_690_000_000_000,
  championTeamId: "t:sentinels",
  placements: [{ position: 1, teamId: "t:sentinels" }, { position: 5, teamId: "t:nrg" }],
  teamIds: ["t:sentinels", "t:nrg"],
  playerIds: ["p:zekken"],
  playerRatings: [{ playerId: "p:zekken", rating: 60 }],
}];

/* ── Fixture de outliers: 8 jugadores uniformes (acs 200) + 1 plantado (acs 400) ── */
function outlierSnapshot(): RawSnapshot {
  const N = 8;
  const teams = Array.from({ length: N }, (_, i) => ({ id: `t${i}`, name: `Team ${i}`, active: true }));
  const players = teams.map((t, i) => ({ id: `q${i}`, nick: `q${i}`, team: t.name, role: "duelist" }));
  const matches: RawSnapshot["matches"] = [];
  const maps: NonNullable<RawSnapshot["maps"]> = [];
  const mapStats: NonNullable<RawSnapshot["mapStats"]> = [];
  for (let i = 0; i < N; i += 2) {
    const id = `om${i}`;
    matches.push({ id, teamA: teams[i].name, teamB: teams[i + 1].name, status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: teams[i].name, matchOrder: i });
    for (let k = 0; k < 2; k++) {
      const mid = `${id}_${k}`;
      maps.push({ id: mid, matchId: id, map: "Ascent", mapOrder: k, scoreA: 13, scoreB: 9, winner: teams[i].name });
      for (const pi of [i, i + 1]) {
        const planted = pi === 0; // q0 = outlier plantado
        mapStats.push({
          matchMapId: mid, matchId: id, player: `q${pi}`, team: teams[pi].name, agent: "Jett",
          acs: planted ? 400 : 200, kills: planted && k === 0 ? 40 : 15, deaths: 12, assists: 5,
          kast: 72, adr: planted ? 260 : 150, hsPct: 25, fk: 2, fd: 2, clutches: 1,
        });
      }
    }
  }
  return {
    tournament: { id: "out-t", name: "Outlier Open", type: "regional", status: "finished" },
    teams, players, matches, maps, mapStats,
    standings: teams.map((t, i) => ({ team: t.name, position: i + 1, wins: 1, losses: 0 })),
  };
}

/* ── Fixture uniforme SIN outliers ── */
function uniformSnapshot(): RawSnapshot {
  const s = outlierSnapshot();
  s.tournament = { id: "uni-t", name: "Uniform Open", type: "regional", status: "finished" };
  s.mapStats = s.mapStats!.map((st) => ({ ...st, acs: 200, kills: 15, adr: 150 }));
  return s;
}

/* ── Fixture grande (rendimiento, sin O(n²)) ── */
function bigSnapshot(T: number): RawSnapshot {
  const teams = Array.from({ length: T }, (_, i) => ({ id: `T${i}`, name: `Team ${i}`, active: true }));
  const players = teams.flatMap((t, ti) => Array.from({ length: 5 }, (_, pi) => ({ id: `p${ti}_${pi}`, nick: `p${ti}_${pi}`, team: t.name, role: ["duelist", "controller", "initiator", "sentinel", "duelist"][pi] })));
  const matches: RawSnapshot["matches"] = [];
  const maps: NonNullable<RawSnapshot["maps"]> = [];
  const mapStats: NonNullable<RawSnapshot["mapStats"]> = [];
  const rounds: NonNullable<RawSnapshot["rounds"]> = [];
  const agents = ["Jett", "Sova", "Omen", "Killjoy", "Raze"];
  const mapNames = ["Ascent", "Bind", "Haven"];
  let order = 0;
  for (let i = 0; i < T; i++) for (let j = i + 1; j < T; j++) {
    const id = `m_${i}_${j}`;
    matches.push({ id, teamA: teams[i].name, teamB: teams[j].name, status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: teams[i].name, matchOrder: order++ });
    for (let k = 0; k < 3; k++) {
      const mid = `${id}_${k}`;
      maps.push({ id: mid, matchId: id, map: mapNames[k], mapOrder: k, scoreA: 13, scoreB: 10, winner: teams[i].name });
      rounds.push({ matchMapId: mid, index: 1, winner: teams[i].name, side: "attack", type: "pistol" });
      for (let s = 0; s < 5; s++) {
        mapStats.push({ matchMapId: mid, matchId: id, player: `p${i}_${s}`, team: teams[i].name, agent: agents[s], acs: 200 + s, kills: 15, deaths: 12, assists: 5, kast: 72, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 1 });
        mapStats.push({ matchMapId: mid, matchId: id, player: `p${j}_${s}`, team: teams[j].name, agent: agents[(s + 1) % 5], acs: 190 + s, kills: 13, deaths: 14, assists: 5, kast: 70, adr: 140, hsPct: 24, fk: 1, fd: 2, clutches: 1 });
      }
    }
  }
  return { tournament: { id: "big", name: "Big", type: "masters", status: "finished" }, teams, players, matches, maps, mapStats, rounds, standings: teams.map((t, i) => ({ team: t.name, position: i + 1, wins: 1, losses: 0 })) };
}

console.log("# Verificación del Performance Analyzer — DRL Champions (Fase 3/7)\n");
const imp = importSnapshot(fixture, ctx());
const model = imp.model;
const res = analyze(model, history);
const star = (id: string) => res.report.players.find((p) => p.playerId === id)!;

// COMPATIBILIDAD
console.log("## Compatibilidad (Importer + Analyzer F2)");
check("compat importer: modelo importado OK", imp.ok, `${imp.issues.length} issues`);
check("compat F2: result.report ≡ analyzeTournament(model) byte a byte",
  JSON.stringify(res.report) === JSON.stringify(analyzeTournament(model)));
check("schemaVersion del resultado = 2 (F2 sigue en 1)", res.schemaVersion === 2 && res.report.schemaVersion === 1);

// NO MUTACIÓN
console.log("\n## No mutación");
const snapModel = (): string => JSON.stringify({ ...importSnapshot(fixture, ctx()).model, index: undefined });
const before = snapModel();
{ const m2 = importSnapshot(fixture, ctx()).model; analyze(m2, history); check("analyze() no muta el Canonical Model", JSON.stringify({ ...m2, index: undefined }) === before); }

// DETERMINISMO
console.log("\n## Determinismo");
const runA = JSON.stringify(analyze(importSnapshot(fixture, ctx()).model, history));
const runB = JSON.stringify(analyze(importSnapshot(fixture, ctx()).model, history));
check("mismo modelo + mismo historial ⇒ mismo AnalyzerResult (byte a byte)", runA === runB);

// PERFORMANCE METRICS + CONFIDENCE
console.log("\n## PerformanceMetrics + PerformanceConfidence");
const perf = (id: string) => res.performance.find((p) => p.playerId === id)!;
const zk = perf("p:zekken"), zl = perf("p:zellsis");
check("todos los jugadores presentes (3) y ordenados por id", res.performance.length === 3 && res.performance.every((p, i) => i === 0 || res.performance[i - 1].playerId <= p.playerId));
check("entryScore/supportScore ≡ RoleScores de F2 (promoción, no recálculo)",
  zk.entryScore === star("p:zekken").roles.entry && zk.supportScore === star("p:zekken").roles.support);
check("efficiency/clutchScore en rango y coherentes (zekken clutcher)", zk.efficiency > 0 && zk.efficiency <= 100 && zk.clutchScore > 50, `eff=${zk.efficiency} clutch=${zk.clutchScore}`);
check("flexScore > 0 con 2 agentes observados (zekken) y 0 con 1 (zellsis)", zk.flexScore > 0 && zl.flexScore === 0, `flex=${zk.flexScore}`);
check("confidence zekken=medium (2 mapas, 43 rondas) y zellsis=low (1 mapa)",
  zk.confidence.level === "medium" && zl.confidence.level === "low",
  `zk=${zk.confidence.level}(${zk.confidence.maps}m/${zk.confidence.rounds}r/cov${zk.confidence.coverage}) zl=${zl.confidence.level}`);
check("coverage ∈ [0,1] y calculada (zellsis sin hsPct ⇒ cov<1)", zl.confidence.coverage > 0 && zl.confidence.coverage < 1, `cov=${zl.confidence.coverage}`);

// AGENT METRICS
console.log("\n## AgentMetrics");
const ag = (p: string, a: string) => res.agents.find((x) => x.playerId === p && x.agentId === a);
check("zekken×Jett: 1 mapa, winrate 1, acs 300", ag("p:zekken", "Jett")?.maps === 1 && ag("p:zekken", "Jett")?.winrate === 1 && ag("p:zekken", "Jett")?.acs === 300);
check("zekken×Raze existe (2º agente observado)", !!ag("p:zekken", "Raze"));
check("pool del torneo: 4 picks totales, agentes con winrate ∈ [0,1]",
  res.agentPool.reduce((a, u) => a + u.picks, 0) === 4 && res.agentPool.every((u) => u.winrate >= 0 && u.winrate <= 1));

// MAP METRICS
console.log("\n## MapMetrics");
const ascent = res.maps.find((m) => m.mapId.toLowerCase().includes("ascent"));
check("Ascent: 3 veces jugado, dominante Sentinels", ascent?.played === 3 && ascent?.dominantTeamId === "t:sentinels", `played=${ascent?.played}`);
check("avgRoundsPerMap coherente (Ascent: (23+24+20)/3 ≈ 22.3)", ascent?.avgRoundsPerMap === 22.3, `avg=${ascent?.avgRoundsPerMap}`);
check("lados solo donde hay rounds con side (Ascent sí, Bind no)",
  typeof ascent?.attackWinPct === "number" && res.maps.find((m) => m.mapId.toLowerCase().includes("bind"))?.attackWinPct === undefined);
check("attack+defense = 100 en mapas con dato", ascent ? Math.abs((ascent.attackWinPct ?? 0) + (ascent.defenseWinPct ?? 0) - 100) < 0.2 : false, `atk=${ascent?.attackWinPct}`);

// ECONOMÍA
console.log("\n## Economía (desde model.rounds)");
const eco = (id: string) => res.economy.find((e) => e.teamId === id);
check("SEN pistol 50% (1/2) y NRG pistol 50%", eco("t:sentinels")?.pistolWinPct === 50 && eco("t:nrg")?.pistolWinPct === 50);
check("SEN eco 100% (2/2), force 0% (0/1), buy 100% (1/1)",
  eco("t:sentinels")?.ecoWinPct === 100 && eco("t:sentinels")?.forceWinPct === 0 && eco("t:sentinels")?.buyWinPct === 100);
check("roundsSampled = 6 por equipo (solo tipos económicos con ganador)", eco("t:sentinels")?.roundsSampled === 6 && eco("t:nrg")?.roundsSampled === 6);
check("equipos sin rounds ⇒ sin entrada de economía (no se inventa)", !eco("t:g2") && !eco("t:fnatic"));

// TIMELINE
console.log("\n## PerformanceTimeline");
const tl = res.timelines.find((t) => t.playerId === "p:zekken")!;
check("zekken: 2 puntos ordenados (semifinal → final)", tl?.points.length === 2 && tl.points[0].matchId === "m0" && tl.points[1].matchId === "m1");
check("impacto por partido coherente (300acs > 200acs)", tl.points[0].impact > tl.points[1].impact, `${tl.points[0].impact} > ${tl.points[1].impact}`);
check("puntos con maps/acs/kills/deaths del partido", tl.points[0].acs === 300 && tl.points[0].kills === 20 && tl.points[0].maps === 1);

// OUTLIERS
console.log("\n## StatisticalOutliers");
const outRes = analyze(importSnapshot(outlierSnapshot(), ctx()).model);
const planted = outRes.outliers.filter((o) => o.playerId === "p:q0");
check("outlier plantado detectado (q0, acs 400 vs 200, z ≥ 2, high)",
  planted.some((o) => o.metric === "acs" && o.zscore >= OUTLIER_Z && o.direction === "high"),
  planted.map((o) => `${o.metric}:z=${o.zscore}`).join(" "));
check("población uniforme ⇒ 0 outliers", analyze(importSnapshot(uniformSnapshot(), ctx()).model).outliers.length === 0);
check("fixture principal (3 jugadores < población mínima) ⇒ 0 outliers", res.outliers.length === 0);
check("outliers con media/desviación/z finitos", outRes.outliers.every((o) => [o.value, o.mean, o.stdev, o.zscore].every(Number.isFinite)));

// MVP + ALL-STAR + HIGHLIGHTS
console.log("\n## Candidatos (MVP · All-Star · Highlights)");
check("MVP candidates ≡ los de F2 (sin recálculo)", JSON.stringify(res.candidates.mvp) === JSON.stringify(res.report.mvpCandidates));
const slots = res.candidates.allStar;
check("all-star sin jugador repetido y ≤ 5 puestos", new Set(slots.map((s) => s.playerId)).size === slots.length && slots.length <= 5);
check("all-star duelist = zekken (mejor duelist score)", slots.find((s) => s.slot === "duelist")?.playerId === "p:zekken");
check("con 3 jugadores se cubren exactamente 3 puestos (no se inventa)", slots.length === 3);
const hi = outRes.candidates.highlights;
check("highlight plantado (q0, kills 40) con z ≥ 2 y refs válidas",
  hi.some((h) => h.playerId === "p:q0" && h.metric === "kills" && h.zscore >= OUTLIER_Z) &&
  hi.every((h) => outRes.report.timeline.some((t) => t.matchId === h.matchId)),
  hi.slice(0, 3).map((h) => `${h.metric}:z=${h.zscore}`).join(" "));

// NARRATIVE TAGS
console.log("\n## NarrativeTags (solo hechos)");
const tag = (k: string, team: string) => res.narrativeTags.some((t) => t.kind === k && t.teamId === team);
check("champion + grand-finalist (SEN) y runner-up + grand-finalist (NRG)",
  tag("champion", "t:sentinels") && tag("grand-finalist", "t:sentinels") && tag("runner-up", "t:nrg") && tag("grand-finalist", "t:nrg"));
check("undefeated SEN (2-0 en series)", tag("undefeated", "t:sentinels"));
check("top4 para G2/Fnatic (buckets excluyentes, no para finalistas)",
  tag("top4", "t:g2") && tag("top4", "t:fnatic") && !tag("top4", "t:sentinels") && !tag("top8", "t:g2"));
check("sin group-stage-exit (el torneo no tiene fase de grupos)", !res.narrativeTags.some((t) => t.kind === "group-stage-exit"));
check("tags con teamId y razón factual (sin texto libre inventado)", res.narrativeTags.every((t) => t.teamId.startsWith("t:") && t.reason.length > 0));

// HISTORICAL CONTEXT
console.log("\n## HistoricalContext (solo con historial inyectado)");
const h = res.historicalContext;
const htag = (k: string, ref: string) => h.tags.some((t) => t.kind === k && (t.teamId === ref || t.playerId === ref));
check("provided=true con 1 torneo previo", h.provided && h.tournaments === 1);
check("second-title + repeat + back-to-back (SEN ya ganó Champions 2024)",
  htag("second-title", "t:sentinels") && htag("repeat-champion", "t:sentinels") && htag("back-to-back-champion", "t:sentinels"));
check("career-high zekken (rating actual > 60 previo)", htag("career-high", "p:zekken"));
check("debut-lan para jugadores sin registro previo (zellsis/ethan) y NO para zekken",
  htag("debut-lan", "p:zellsis") && htag("debut-lan", "p:ethan") && !htag("debut-lan", "p:zekken"));
check("first-champions solo para equipos sin Champions previo (G2, no SEN/NRG)",
  htag("first-champions", "t:g2") && !htag("first-champions", "t:sentinels") && !htag("first-champions", "t:nrg"));
check("best-placement NRG (2º ahora < 5º en 2024)", htag("best-placement", "t:nrg"));
const noHist = analyze(importSnapshot(fixture, ctx()).model);
check("sin historial ⇒ provided=false y 0 tags (no se afirma nada)", !noHist.historicalContext.provided && noHist.historicalContext.tags.length === 0);
const emptyHist = analyze(importSnapshot(fixture, ctx()).model, []);
check("historial vacío ⇒ first-title (primer título del registro conocido)",
  emptyHist.historicalContext.provided && emptyHist.historicalContext.tags.some((t) => t.kind === "first-title" && t.teamId === "t:sentinels"));

// CERO ESTADOS IMPOSIBLES
console.log("\n## Cero estados imposibles");
const fin = Number.isFinite;
const all0to100 = res.performance.every((p) => [p.efficiency, p.clutchScore, p.entryScore, p.supportScore, p.flexScore].every((v) => fin(v) && v >= 0 && v <= 100));
check("scores de performance finitos y en 0..100", all0to100);
check("winrates ∈ [0,1], pcts ∈ [0,100], confianza válida",
  res.agents.every((a) => a.winrate >= 0 && a.winrate <= 1) &&
  res.maps.every((m) => (m.attackWinPct ?? 0) >= 0 && (m.attackWinPct ?? 0) <= 100) &&
  res.economy.every((e) => [e.pistolWinPct, e.ecoWinPct, e.forceWinPct, e.buyWinPct].every((v) => v === undefined || (fin(v) && v >= 0 && v <= 100))) &&
  res.performance.every((p) => ["low", "medium", "high"].includes(p.confidence.level) && p.confidence.coverage >= 0 && p.confidence.coverage <= 1));
const serialized = JSON.stringify(res);
check("SIN artefactos de carta (cardId/variantId/ovr/rareza/serial)",
  !serialized.includes('"cardId"') && !serialized.includes('"variantId"') && !serialized.includes('"ovr"') && !serialized.includes('"rarity"') && !serialized.includes('"serial"'));
check("resultado 100% serializable (sin Map/undefined raíz)", JSON.parse(serialized).schemaVersion === 2);

// RENDIMIENTO
console.log("\n## Rendimiento (modelo grande, sin O(n²))");
const big = importSnapshot(bigSnapshot(30), ctx()).model;
const startNs = process.hrtime.bigint();
const bigRes: AnalyzerResult = analyze(big, history);
const ms = Number(process.hrtime.bigint() - startNs) / 1e6;
check("30 equipos · 435 series · 1305 mapas · 13050 stats analizados",
  bigRes.performance.length === 150 && bigRes.timelines.length === 150 && bigRes.agents.length > 0 && bigRes.maps.length === 3, `${Math.round(ms)} ms`);
check("confianza high alcanzable con muestra grande", bigRes.performance.some((p) => p.confidence.level === "high"));
check("rendimiento aceptable (sin O(n²) patológico)", ms < 4000, `${Math.round(ms)} ms`);

console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
if (fail > 0) process.exitCode = 1;
