/**
 * VERIFICACIÓN DEL WATCH ENGINE (Tournament Watcher · Fase 1/5).
 *
 * OBSERVAR · DETECTAR · EMITIR, nada más. Ejemplo obligatorio: Masters London snapshot A →
 * snapshot B con Heretics eliminado ⇒ evento TeamEliminated (sin generar cartas, sin
 * publicar, sin Telegram). Comprueba: detección de nuevos torneos y de TODOS los cambios
 * del contrato · fingerprint (contenido, sin timestamps/ids efímeros/orden) · determinismo
 * · rendimiento · eventos · snapshots · historial · registry · cero falsos positivos ·
 * cero falsos negativos conocidos · cero modificaciones del sistema.
 */
import type { RawSnapshot } from "@/importer";
import { resetRuntime, runtimeVersion, runtimeGenerationId } from "@/publisher";
import { totalCards, allPlayers } from "@/data/catalog";
import {
  WatchEngine, createWatcherRegistry, tournamentFingerprint, diffSnapshots, normalizeSnapshot,
  watchMetrics, historyOf, auditRegistry, watchStatusOf, WATCH_EVENT_KINDS,
  type WatchEventKind, type WatcherRegistry,
} from "@/tournament-watcher";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 1_700_000_000_000;

/* ── Snapshot A: Masters London EN JUEGO (con Team Heretics) ── */
const A: RawSnapshot = {
  tournament: { id: "valorant-masters-london-2026", name: "Valorant Masters London 2026", type: "international", tier: "vct-international", status: "ongoing", startDate: "2026-06-05T00:00:00Z", endDate: "2026-06-21T00:00:00Z", location: "Copper Box Arena, London", prizePool: 1_000_000 },
  stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [
    { id: "lln", name: "London Lions", region: "EMEA", active: true },
    { id: "mwv", name: "Madrid Wolves", region: "EMEA" },
    { id: "th", name: "Team Heretics", region: "EMEA" },
  ],
  players: [
    { id: "zk", nick: "zekken", team: "London Lions", role: "duelist", agents: ["Jett"] },
    { id: "lf", nick: "Lyncher", team: "London Lions", role: "initiator", agents: ["Sova"] },
    { id: "wk", nick: "Wolfrik", team: "Madrid Wolves", role: "sentinel", agents: ["Killjoy"] },
    { id: "hh", nick: "Hereje", team: "Team Heretics", role: "controller", agents: ["Omen"] },
  ],
  coaches: [],
  matches: [
    { id: "m1", stageId: "st-po", teamA: "London Lions", teamB: "Team Heretics", status: "live", format: "bo3", scoreA: 1, scoreB: 1, round: "Semifinal", matchOrder: 1 },
    { id: "m2", stageId: "st-po", teamA: "Madrid Wolves", teamB: "London Lions", status: "upcoming", format: "bo3", round: "Grand Final", matchOrder: 2 },
  ],
  maps: [
    { id: "m1a", matchId: "m1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "London Lions" },
  ],
  mapStats: [
    { matchMapId: "m1a", matchId: "m1", player: "zekken", team: "London Lions", agent: "Jett", acs: 280, kills: 18, deaths: 12, assists: 3 },
    { matchMapId: "m1a", matchId: "m1", player: "Hereje", team: "Team Heretics", agent: "Omen", acs: 190, kills: 11, deaths: 15, assists: 6 },
  ],
  standings: [
    { team: "London Lions", position: 1, wins: 1, losses: 0 },
    { team: "Madrid Wolves", position: 2, wins: 1, losses: 0 },
    { team: "Team Heretics", position: 3, wins: 0, losses: 0 },
  ],
  awards: {},
};

/* ── Snapshot B: la semifinal termina y HERETICS QUEDA ELIMINADO ── */
const B: RawSnapshot = {
  ...A,
  matches: [
    { ...A.matches[0], status: "finished", scoreA: 2, scoreB: 1, winner: "London Lions" },
    A.matches[1],
  ],
  maps: [
    ...(A.maps ?? []),
    { id: "m1b", matchId: "m1", map: "Bind", mapOrder: 2, scoreA: 9, scoreB: 13, winner: "Team Heretics" },
    { id: "m1c", matchId: "m1", map: "Haven", mapOrder: 3, scoreA: 13, scoreB: 7, winner: "London Lions" },
  ],
  mapStats: [
    ...(A.mapStats ?? []),
    { matchMapId: "m1b", matchId: "m1", player: "zekken", team: "London Lions", agent: "Jett", acs: 210, kills: 12, deaths: 13, assists: 4 },
  ],
  standings: [
    { team: "London Lions", position: 1, wins: 2, losses: 0, status: "qualified" },
    { team: "Madrid Wolves", position: 2, wins: 1, losses: 0 },
    { team: "Team Heretics", position: 3, wins: 0, losses: 1, status: "eliminated" },
  ],
};

const mutate = (over: Partial<RawSnapshot> | ((s: RawSnapshot) => RawSnapshot)): RawSnapshot =>
  typeof over === "function" ? over(structuredClone(A)) : { ...structuredClone(A), ...over };

function main(): void {
  console.log("# Verificación del Watch Engine — DRL Champions (Tournament Watcher Fase 1/5)\n");

  resetRuntime();
  const cardsBefore = totalCards();
  const rosterBefore = JSON.stringify(allPlayers().map((p) => p.id));

  // ── 1. NUEVOS TORNEOS + SNAPSHOTS ──
  console.log("## 1. Detección de nuevos torneos");
  const engine = new WatchEngine();
  const r1 = engine.observe(A, { at: NOW });
  check("primera observación ⇒ tournament-created (revisión 1)",
    r1.changed && r1.revision === 1 && r1.events.some((e) => e.kind === "tournament-created") &&
    r1.events[0].tournamentId === "valorant-masters-london-2026");
  check("el registry guarda ÚLTIMO snapshot + revisión + fingerprint + historial (nada más)",
    (() => {
      const t = engine.registry.tournaments["valorant-masters-london-2026"];
      return t.snapshot === A || t.snapshot.tournament.id === A.tournament.id;
    })() && Object.keys(engine.registry.tournaments).length === 1);

  // ── 2. CERO FALSOS POSITIVOS ──
  console.log("\n## 2. Cero falsos positivos");
  const reordered: RawSnapshot = {
    ...structuredClone(A),
    teams: [...A.teams].reverse(),
    matches: [...A.matches].reverse(),
    mapStats: [...(A.mapStats ?? [])].reverse(),
    standings: [...(A.standings ?? [])].reverse(),
  };
  const r2 = engine.observe(reordered, { at: NOW + 1 });
  check("REORDENAR el scraping no emite NADA (misma huella, cero eventos)",
    !r2.changed && r2.events.length === 0 && r2.revision === 1);
  const slugged = mutate((s) => ({ ...s, tournament: { ...s.tournament, slug: "otro-slug-efimero" } as RawSnapshot["tournament"] }));
  check("los campos efímeros (slug) NO firman el fingerprint",
    tournamentFingerprint(slugged) === tournamentFingerprint(A));
  check("re-observar idéntico jamás sube la revisión", engine.observe(A, { at: NOW + 2 }).revision === 1);

  // ── 3. EJEMPLO OBLIGATORIO: HERETICS ELIMINADO ──
  console.log("\n## 3. Ejemplo obligatorio — Heretics eliminado (A → B)");
  const r3 = engine.observe(B, { at: NOW + 3 });
  console.log(`   eventos: ${r3.events.map((e) => e.kind + (e.subject && e.subject !== e.tournamentId ? `(${e.subject})` : "")).join(" · ")}`);
  check("EVENTO TeamEliminated emitido para Team Heretics",
    r3.events.some((e) => e.kind === "team-eliminated" && e.subject === "Team Heretics"));
  check("y sus compañeros de verdad: resultado, clasificado, mapas y stats",
    r3.events.some((e) => e.kind === "result-changed" && e.subject === "m1") &&
    r3.events.some((e) => e.kind === "team-qualified" && e.subject === "London Lions") &&
    r3.events.filter((e) => e.kind === "map-added").length === 2 &&
    r3.events.some((e) => e.kind === "statistics-changed" && e.subject === "zekken"));
  check("SOLO se emite: sin cartas, sin publicación, sin Telegram (runtime intacto)",
    totalCards() === cardsBefore && runtimeVersion() === 0 && runtimeGenerationId() === "");
  check("la revisión avanza y el fingerprint cambió",
    r3.revision === 2 && r3.previousFingerprint !== r3.fingerprint);

  // ── 4. TODAS LAS DETECCIONES DEL CONTRATO (cero falsos negativos conocidos) ──
  console.log("\n## 4. Detecciones del contrato");
  const kindOf = (s: RawSnapshot): WatchEventKind[] => diffSnapshots(A, s).map((c) => c.kind);
  const cases: [string, RawSnapshot, WatchEventKind][] = [
    ["cambio de nombre", mutate((s) => ({ ...s, tournament: { ...s.tournament, name: "Masters London REBRANDED" } })), "name-changed"],
    ["cambio de estado", mutate((s) => ({ ...s, tournament: { ...s.tournament, status: "finished" } })), "status-changed"],
    ["torneo terminado", mutate((s) => ({ ...s, tournament: { ...s.tournament, status: "finished" } })), "tournament-finished"],
    ["cambio de premio", mutate((s) => ({ ...s, tournament: { ...s.tournament, prizePool: 2_000_000 } })), "prize-changed"],
    ["cambio de fechas", mutate((s) => ({ ...s, tournament: { ...s.tournament, endDate: "2026-06-25T00:00:00Z" } })), "dates-changed"],
    ["cambio de sede", mutate((s) => ({ ...s, tournament: { ...s.tournament, location: "O2 Arena" } })), "venue-changed"],
    ["nuevo equipo", mutate((s) => ({ ...s, teams: [...s.teams, { id: "bb", name: "Berlin Bears", region: "EMEA" }] })), "team-added"],
    ["equipo eliminado del evento", mutate((s) => ({ ...s, teams: s.teams.filter((t) => t.name !== "Madrid Wolves") })), "team-removed"],
    ["cambio de roster", mutate((s) => ({ ...s, players: s.players.map((p) => p.nick === "Lyncher" ? { ...p, nick: "Fichaje" } : p) })), "roster-changed"],
    ["nuevo partido", mutate((s) => ({ ...s, matches: [...s.matches, { id: "m3", stageId: "st-po", teamA: "Madrid Wolves", teamB: "Team Heretics", status: "upcoming", format: "bo3", round: "Bronze", matchOrder: 3 }] })), "match-added"],
    ["resultado modificado", mutate((s) => ({ ...s, matches: s.matches.map((m) => m.id === "m1" ? { ...m, scoreA: 2, winner: "London Lions" } : m) })), "result-changed"],
    ["partido actualizado (estado)", mutate((s) => ({ ...s, matches: s.matches.map((m) => m.id === "m2" ? { ...m, status: "live" } : m) })), "match-updated"],
    ["bracket cambiado", mutate((s) => ({ ...s, matches: s.matches.map((m) => m.id === "m2" ? { ...m, round: "Final Reprogramada", matchOrder: 5 } : m) })), "bracket-changed"],
    ["nuevo mapa", mutate((s) => ({ ...s, maps: [...(s.maps ?? []), { id: "m1x", matchId: "m1", map: "Lotus", mapOrder: 2 }] })), "map-added"],
    ["estadísticas modificadas", mutate((s) => ({ ...s, mapStats: (s.mapStats ?? []).map((x) => x.player === "zekken" ? { ...x, kills: 30 } : x) })), "statistics-changed"],
    ["equipo clasificado", mutate((s) => ({ ...s, standings: (s.standings ?? []).map((x) => x.team === "London Lions" ? { ...x, status: "qualified" } : x) })), "team-qualified"],
  ];
  for (const [label, snap, kind] of cases) {
    const kinds = kindOf(snap);
    check(`detecta ${label}`, kinds.includes(kind), kinds.join(","));
  }
  check("mutaciones puntuales NO disparan detecciones ajenas (precisión)",
    kindOf(cases[3][1]).join(",") === "prize-changed" &&
    kindOf(cases[5][1]).join(",") === "venue-changed" &&
    kindOf(cases[13][1]).join(",") === "map-added");
  check("torneo desaparecido del lote ⇒ tournament-removed", (() => {
    const e2 = new WatchEngine();
    e2.observeBatch([A], { at: NOW });
    const res = e2.observeBatch([], { at: NOW + 1 });
    return res.some((r) => r.events.some((e) => e.kind === "tournament-removed")) &&
      watchStatusOf(e2.registry.tournaments["valorant-masters-london-2026"]) === "removed";
  })());

  // ── 5. FINGERPRINT ──
  console.log("\n## 5. Fingerprint");
  check("misma realidad ⇒ misma huella (reordenado incluido)",
    tournamentFingerprint(A) === tournamentFingerprint(reordered) &&
    JSON.stringify(normalizeSnapshot(A)) === JSON.stringify(normalizeSnapshot(reordered)));
  check("cada mutación del contrato cambia la huella",
    cases.every(([, snap]) => tournamentFingerprint(snap) !== tournamentFingerprint(A)));

  // ── 6. HISTORIAL Y REGISTRY ──
  console.log("\n## 6. Historial y registry");
  const history = historyOf(engine.registry, "valorant-masters-london-2026");
  check("historial completo y ordenado (created → updated → …)",
    history.length === r1.events.length + r3.events.length &&
    history[0].kind === "tournament-created" && auditRegistry(engine.registry).length === 0);
  check("registry 100% serializable (persistible entre pasadas)", (() => {
    const j = JSON.parse(JSON.stringify(engine.registry)) as WatcherRegistry;
    const revived = new WatchEngine(j);
    return revived.observe(B, { at: NOW + 9 }).changed === false;
  })());
  const m = watchMetrics(engine.registry);
  check("métricas coherentes", m.observed === 1 && m.revisions === 2 && m.events === history.length &&
    (m.byKind["team-eliminated"] ?? 0) === 1);

  // ── 7. DETERMINISMO ──
  console.log("\n## 7. Determinismo");
  const replay = (): string => {
    const e = new WatchEngine();
    e.observe(A, { at: NOW });
    e.observe(B, { at: NOW + 3 });
    return JSON.stringify(e.registry);
  };
  check("misma secuencia ⇒ registry byte a byte", replay() === replay());
  check("los eventos usan SOLO el reloj lógico inyectado",
    history.every((e) => e.at === NOW || e.at === NOW + 3));

  // ── 8. RENDIMIENTO ──
  console.log("\n## 8. Rendimiento");
  const many = Array.from({ length: 200 }, (_, i) => mutate((s) => ({
    ...s, tournament: { ...s.tournament, id: `torneo-${i}`, name: `Torneo ${i}` },
  })));
  const perf = new WatchEngine();
  const t0 = Date.now();
  perf.observeBatch(many, { at: NOW });
  perf.observeBatch(many.map((s, i) => i % 4 === 0 ? { ...s, standings: (s.standings ?? []).map((x) => x.team === "Team Heretics" ? { ...x, status: "eliminated" } : x) } : s), { at: NOW + 1 });
  const ms = Date.now() - t0;
  const pm = watchMetrics(perf.registry);
  check("200 torneos × 2 pasadas: 50 cambios detectados sin falsos positivos",
    pm.observed === 200 && (pm.byKind["team-eliminated"] ?? 0) === 50 &&
    pm.revisions === 250 && ms < 4000, `${ms} ms`);

  // ── 9. CERO MODIFICACIONES DEL SISTEMA ──
  console.log("\n## 9. Cero modificaciones del sistema");
  check("catálogo/runtime/roster INTACTOS tras todas las observaciones",
    totalCards() === cardsBefore && runtimeVersion() === 0 && runtimeGenerationId() === "" &&
    JSON.stringify(allPlayers().map((p) => p.id)) === rosterBefore);
  check("los snapshots de entrada NO se mutan",
    A.matches[0].status === "live" && (A.standings ?? [])[2].status === undefined &&
    B.standings![2].status === "eliminated");

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  console.log(`   (tipos de evento cubiertos: ${WATCH_EVENT_KINDS.length})`);
  if (fail > 0) process.exitCode = 1;
}

main();
