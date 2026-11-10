/**
 * FASE 61 · EVIDENCIA (instrumento `_`, fuera de CI). Compone los JSON de `docs/product/qa/fase61-match/` a partir de
 * lo medido: baseline, huella del motor, flujo real (live/pve.json), idempotencia, recuperación, multijugador
 * (live/pvp*.json) y QA visual (screenshots/after/shots-*.json). No lee ni escribe la BD.
 *
 *   npx tsx scripts/_fase61-evidence.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
const Q = join(process.cwd(), "docs/product/qa/fase61-match");
const rd = (f: string): any => JSON.parse(readFileSync(join(Q, f), "utf8"));
const w = (f: string, o: unknown) => writeFileSync(join(Q, f), JSON.stringify(o, null, 2) + "\n");

const pve = rd("live/pve.json");
const pvp = rd("live/pvp.json");
const pvp1 = rd("live/pvp-run1.json");
const probe = rd("live/probe.json");
const polls = (c: any[]) => c.filter((x) => x.i !== undefined);
const mismatches = (c: any[]) => polls(c).filter((x) => x.turn[0] !== x.turn[1] || JSON.stringify(x.score[0]) !== JSON.stringify(x.score[1]) || (x.yourTurn[0] && x.yourTurn[1]));

w("baseline.json", {
  measuredAt: "2026-09-25T08:55Z (antes de editar)",
  git: { branch: "arch/stabilization", head: "48dac2a", statusLines: 1290, note: "árbol con trabajo sin commitear de fases anteriores; F61 no commitea" },
  tests: { command: "npm test", total: 5144, pass: 5144, fail: 0 },
  notMeasuredBeforeEditing: ["tsc web/scripts", "eslint", "next build"],
  notMeasuredReason: "no se corrieron antes del primer cambio; el lint final (27 avisos, 0 errores) coincide con el valor documentado tras F60",
  migrationHead: "0057_admin_cms.sql",
  cards: 331,
  agents: 29,
  flags: { GLOBAL_MARKET_ENABLED: false, PAYMENTS_ENABLED: false },
  port3005: "nada escuchando al empezar",
  tunnel: "cerrado al empezar",
  multiplayer: "PvP por sondeo (usePvpSync → /api/game/duel/pvp con actionId + expectedVersion); cola /api/game/duel/matchmaking; rating duel_pvp_ratings (Elo, sin tiers)",
  routes: { pve: "/duelos/jugar (inmersiva)", pvp: "/duelos/pvp (NO inmersiva antes de F61)", hubs: ["/jugar", "/competitivo"] },
  engine: {
    rules: "duel-combat-2",
    turns: "duel-turns-2 · 10 turnos (uno por carta)",
    attacker: "alterna (orchestrator: attacker = other(attacker))",
    defenderStat: "la impone la tabla SH↔EF, GS↔GS en servidor (requiredDefenderStat); el cliente no la envía",
    turnTie: "NO_POINT",
    final: "marcador → suma de OVR (+1 punto) → total de estadística declarada (sin punto) → DRAW explícito",
  },
  bots: ["EASY (Fácil)", "NORMAL (Normal)", "HARD (Difícil)"],
  rewards: "PvE: award del servidor tras persistir, ref duel:<matchId> (índice único), tope diario atómico; PvP: sin economía, solo rating",
  qaAccounts: probe,
});

w("engine-invariants.json", {
  engineTouched: false,
  engineFilesMtime: {
    "domain/cardgame/combat/resolver.ts": "2026-09-03", "domain/cardgame/combat/rules.ts": "2026-09-03",
    "domain/cardgame/match/orchestrator.ts": "2026-09-03", "server/services/duels.ts": "2026-09-21",
    "server/services/duelsPvp.ts": "2026-09-14", "server/services/duelsRating.ts": "2026-09-08",
  },
  goldenDigest: {
    seeds: 120, digest: "590d299795a9d5edc398ed23b942eef56bacef2664649641962a8022a8deca84",
    tally: { SCORE: 109, OVR_TIEBREAK: 11 }, measuredBeforeF61Edits: true,
    pinnedIn: "src/lib/duel/f61.match.test.tsx · F61 MOTOR 01", instrument: "scripts/_fase61-digest.ts",
  },
  tests: [
    "F61 MOTOR 01 huella dorada (resultado antes = después)", "F61 MOTOR 02 determinismo",
    "F61 MOTOR 03 la presentación no muta la vista (entradas congeladas)", "F61 MOTOR 04 reglas reales leídas del código",
    "F61 MOTOR 05 matchFlow sin reloj/azar/red/almacenamiento",
  ],
});

w("match-flow.json", {
  flow: [
    "JUGAR / Comenzar duelo", "FOUND (Rival preparado · bot / Rival encontrado · persona)", "VERSUS", "LINEUP (10 cartas reales)",
    "campo (ATACAS / DEFIENDES / ESPERANDO AL RIVAL)", "turno: cartas → eje → valores → comparación → veredicto → marcador",
    "recta final (turnos 8–9) / último turno (10)", "desempate en escena (solo si el marcador no decidió)",
    "golpe final VICTORIA / DERROTA / EMPATE", "resultado + recompensas del servidor", "JUGAR OTRA / Cambiar rival o mazo / Volver al lobby",
  ],
  timings: {
    entranceMs: { full: 3500, reduced: 2900 },
    momentBeatsS: { full: { cards: 0, stat: 0.34, values: 0.72, compare: 1.08, verdict: 1.28 }, reduced: { cards: 0, stat: 0.22, values: 0.48, compare: 0.72, verdict: 0.86 } },
    momentHoldMs: { normal: 3000, late: 3200, final: 3500, reducedNormal: 2600 },
    tiebreakStepMs: { full: 1150, reduced: 950 },
    matchCompleteMs: { full: 1200, reduced: 1000 },
  },
  realPvE: {
    account: pve.account, introBeats: pve.introBeats,
    turns: (pve.turns ?? []).map((t: any) => (t.moment ? `${t.moment.outcome}|${t.moment.climax}` : null)),
    endSequence: pve.endSequence, credits: [pve.before.credits, pve.after.credits], xp: [pve.before.xp, pve.after.xp],
  },
  modes: {
    quick: "MatchIntro FOUND → VERSUS → LINEUP", campaign: "misma arena, rótulo «Rival del nodo»",
    draft: "misma arena; «Salir» vuelve al gauntlet con el combate guardado", ranked: "RankedMatchFound (F55) → MatchIntro desde LINEUP",
    private: "MatchIntro desde FOUND (duelo privado)",
  },
});

w("idempotence.json", {
  doubleClickConfirm: pve.doubleClick,
  resultReload: pve.resultReload,
  playAgainAndAbandon: pve.playAgainAndAbandon,
  pvpRatingReload: { after: pvp.ratingAfter.A, afterReload: pvp.reload.ratingAfterReload },
  server: ["playTurn: partida terminada → 409 antes de pagar", "award ref duel:<matchId> (índice único del libro mayor)", "PvP: actionId + expectedVersion; rating liquidado por el servidor"],
  client: ["inFlight (cerrojo de red)", "closeReveal idempotente por matchId:turno", "MatchEnding no salta dos pasos", "el golpe final solo desde la revelación o la jugada final; el arranque (F5) nunca lo reproduce"],
});

w("recovery.json", {
  prematchF5: "sin partida activa → pre-partida (boot)",
  midTurnF5: pve.refreshMid,
  postTurnF5: "la revelación ya estaba aplicada: la mesa vuelve en el turno siguiente con el marcador del servidor (sin reproducir el turno)",
  resultF5: pve.resultReload,
  backButton: pve.backButton,
  pvpReconnect: "la primera foto no anima; con turnos jugados no hay entrada; el sondeo reintenta con retroceso (connectionCopy/syncBanner, F26/F33)",
  limitation: "PvE no sondea (cada petición nace de una acción): no hay «reconectando…» en PvE; un fallo de red se ve como error con reintento",
});

w("multiplayer.json", {
  accounts: { A: pvp.A, B: pvp.B },
  matches: [pvp1.matchId, pvp.matchId],
  run2: { matchFound: pvp.matchFound, introFrom: pvp.introFrom, endSequenceA: pvp.endSequenceA, final: pvp.final, ratingBefore: pvp.ratingBefore, ratingAfter: pvp.ratingAfter, consoleErrors: pvp.consoleErrors },
  consistency: { polls: polls(pvp.consistency).length, mismatches: mismatches(pvp.consistency).length, run1Polls: polls(pvp1.consistency).length, run1Mismatches: mismatches(pvp1.consistency).length, rule: "mismo turno, mismo marcador absoluto, nunca los dos con el turno" },
  run1: { final: pvp1.final, ratingBefore: pvp1.ratingBefore, ratingAfter: pvp1.ratingAfter },
  notDone: ["B jugó por API (no por navegador): se verificó su VISTA por API, no su pantalla", "no se provocó una desconexión forzada"],
});

/* QA visual: la última medición de cada captura. */
const dir = join(Q, "screenshots/after");
const rows: any[] = [];
for (const f of readdirSync(dir).filter((x) => x.startsWith("shots-") && x.endsWith(".json"))) rows.push(...JSON.parse(readFileSync(join(dir, f), "utf8")).rows.map((r: any) => ({ ...r, batch: f })));
const byFile = new Map<string, any>();
for (const r of rows) {
  const prev = byFile.get(r.file);
  // La medición refinada (tandas posteriores a `main`) manda sobre la primera.
  if (!prev || prev.batch === "shots-main.json") byFile.set(r.file, r);
}
const all = [...byFile.values()];
w("visual-qa.json", {
  runner: "scripts/_fase61-shots.ts (arnés /design-system/fase61 · motor puro + cartas reales · Chrome sin cabeza)",
  viewports: ["1440x900", "1024x768", "390x844"],
  reducedMotion: "también (--reduced)",
  shots: all.length,
  overflowAfterRefinedMeasure: all.filter((r) => r.batch !== "shots-main.json" && r.measure?.overflowCount > 0).map((r) => r.file),
  broken: all.filter((r) => r.measure?.broken?.length).map((r) => r.file),
  consoleErrorKinds: [...new Set(all.flatMap((r) => r.errors))],
  consoleErrorsNote: "503 = /api/telemetry sin Supabase en el arnés de desarrollo; en la app real (live/*.json) consoleErrors = []",
  overflowNote: "la tanda 'main' contaba carruseles con scroll propio y bloques invisibles a mitad de fundido; la medición refinada da 0",
  before: readdirSync(join(Q, "screenshots/before")).filter((f) => f.endsWith(".png")),
  live: readdirSync(join(Q, "screenshots/live")).filter((f) => f.endsWith(".png")),
  scenes: [...new Set(all.map((r) => r.scene))],
});
console.log("evidencia escrita", all.length, "capturas");
