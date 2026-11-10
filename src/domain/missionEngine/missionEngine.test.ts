/**
 * F73 · MOTOR DE MISIONES (puro) — evaluación de condiciones, anti-AFK, anti-farm, rachas, dependencias y validación.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, matchCounts, MIN_HUMAN_DECISIONS } from "./evaluate";
import { activeForProgress, missionStates, projectStates } from "./state";
import { hasCycle, validateMission, validateProject, type Lookup } from "./validate";
import type { DeckFact, MatchEvent, MissionDef, ProjectDef } from "./types";

const deck = (over: Partial<DeckFact>[] = []): DeckFact[] => Array.from({ length: 10 }, (_, i) => ({ cardId: `c${i}`, playerId: `p${i}`, team: `t${i}`, country: `C${i % 10}`.slice(0, 2), role: "Duelista", ...(over[i] ?? {}) }));
const ev = (over: Partial<MatchEvent> = {}): MatchEvent => ({ kind: "MATCH", key: "match:m1", mode: "PVE", difficulty: "NORMAL", won: true, draw: false, finished: true, turnsWon: 6, humanDecisions: 10, autoDecisions: 0, deck: deck(), ...over });
const M = (condition: MissionDef["condition"], over: Partial<MissionDef> = {}): MissionDef => ({ id: "m", name: "Misión", description: "", condition, target: 3, dependsOn: [], reward: {}, projectId: null, status: "ACTIVE", sortOrder: 0, availableFrom: null, availableTo: null, version: 1, ...over });

test("F73 M-EV1 · ganar/jugar cuentan con partida terminada; PvE/PvP/Draft restringen su modo", () => {
  assert.deepEqual(evaluate(M({ type: "MATCH_WIN" }), ev()), { missionId: "m", op: "INC", value: 1, target: 3 });
  assert.equal(evaluate(M({ type: "MATCH_WIN" }), ev({ won: false })), null);
  assert.ok(evaluate(M({ type: "MATCH_PLAY" }), ev({ won: false })));
  assert.equal(evaluate(M({ type: "WIN_PVE" }), ev({ mode: "RANKED" })), null, "WIN_PVE no cuenta ranked");
  assert.ok(evaluate(M({ type: "WIN_COMPETITIVE" }), ev({ mode: "RANKED", difficulty: null })));
  assert.equal(evaluate(M({ type: "WIN_DRAFT" }), ev({ mode: "PVE" })), null);
  assert.equal(evaluate(M({ type: "MATCH_WIN", modes: ["DRAFT"] }), ev()), null);
  assert.equal(evaluate(M({ type: "MATCH_WIN", minDifficulty: "HARD" }), ev({ difficulty: "NORMAL" })), null, "bot fácil no cuenta si se exige difícil");
});

test("F73 M-EV2 · ANTI-AFK: con menos de la mitad de decisiones humanas no cuenta; el reloj no se toca", () => {
  assert.equal(MIN_HUMAN_DECISIONS, 5);
  assert.equal(evaluate(M({ type: "MATCH_WIN" }), ev({ humanDecisions: 4, autoDecisions: 6 })), null);
  assert.ok(evaluate(M({ type: "MATCH_WIN" }), ev({ humanDecisions: 5, autoDecisions: 5 })));
  assert.equal(matchCounts(ev({ humanDecisions: 0, autoDecisions: 10 })), false, "partida entera automática: nada");
});

test("F73 M-EV3 · ANTI-FARM: abandono y PvP privado no cuentan nunca", () => {
  assert.equal(evaluate(M({ type: "MATCH_PLAY" }), ev({ finished: false })), null);
  assert.equal(evaluate(M({ type: "MATCH_WIN" }), ev({ mode: "PRIVATE" })), null);
  assert.equal(evaluate(M({ type: "WIN_PVP" }), ev({ mode: "PRIVATE" })), null);
});

test("F73 M-EV4 · condiciones de plantilla: mismo equipo, mismo país, jugador concreto, rol", () => {
  const sameTeam = deck([{ team: "fnatic" }, { team: "fnatic" }, { team: "fnatic" }]);
  assert.ok(evaluate(M({ type: "WIN_WITH_TEAM_COUNT", min: 2 }), ev({ deck: sameTeam })), "≥2 del MISMO equipo (cualquiera)");
  assert.equal(evaluate(M({ type: "WIN_WITH_TEAM_COUNT", min: 4 }), ev({ deck: sameTeam })), null);
  assert.ok(evaluate(M({ type: "DECK_MIN_TEAM", team: "fnatic", min: 3 }), ev({ won: false, deck: sameTeam })), "plantilla, no exige ganar");
  assert.equal(evaluate(M({ type: "DECK_MIN_TEAM", team: "g2", min: 2 }), ev({ deck: sameTeam })), null);
  const sameCountry = deck([{ country: "KR" }, { country: "KR" }, { country: "KR" }]);
  assert.ok(evaluate(M({ type: "WIN_WITH_COUNTRY_COUNT", min: 3 }), ev({ deck: sameCountry })));
  assert.equal(evaluate(M({ type: "WIN_WITH_COUNTRY_COUNT", min: 3 }), ev({ deck: deck() })), null, "10 países distintos");
  assert.ok(evaluate(M({ type: "WIN_WITH_PLAYER", playerId: "p4" }), ev()));
  assert.equal(evaluate(M({ type: "WIN_WITH_PLAYER", playerId: "nadie" }), ev()), null);
  assert.equal(evaluate(M({ type: "WIN_WITH_PLAYER", playerId: "p4" }), ev({ won: false })), null);
  assert.ok(evaluate(M({ type: "USE_CARD", cardId: "c2" }), ev({ won: false })));
  assert.ok(evaluate(M({ type: "WIN_WITH_ROLE_COUNT", role: "Duelista", min: 10 }), ev()));
});

test("F73 M-EV5 · turnos ganados, rachas y eventos de sobres/crafteo", () => {
  assert.deepEqual(evaluate(M({ type: "TURN_WIN" }, { target: 20 }), ev({ turnsWon: 7 })), { missionId: "m", op: "INC", value: 7, target: 20 });
  assert.deepEqual(evaluate(M({ type: "WIN_STREAK" }), ev()), { missionId: "m", op: "STREAK_WIN", target: 3 });
  assert.deepEqual(evaluate(M({ type: "WIN_STREAK" }), ev({ won: false })), { missionId: "m", op: "STREAK_RESET", target: 3 });
  assert.equal(evaluate(M({ type: "WIN_STREAK" }), ev({ humanDecisions: 1 })), null, "una partida AFK ni suma ni rompe la racha");
  assert.ok(evaluate(M({ type: "OPEN_PACK" }), { kind: "OPEN_PACK", key: "k", packId: "estandar" }));
  assert.equal(evaluate(M({ type: "OPEN_PACK", packId: "oro" }), { kind: "OPEN_PACK", key: "k", packId: "estandar" }), null);
  assert.ok(evaluate(M({ type: "CRAFT_PACK" }), { kind: "CRAFT_PACK", key: "k", packId: "premium" }));
  assert.ok(evaluate(M({ type: "CRAFT_CARD" }), { kind: "CRAFT_CARD", key: "k", recipeId: "card-base-plata" }));
  assert.equal(evaluate(M({ type: "CRAFT_CARD" }), ev()), null);
});

test("F73 M-ST1 · estados: dependencias (A → B y A,B,C → FINAL), completada, reclamada, fechas del servidor", () => {
  const a = M({ type: "MATCH_WIN" }, { id: "a", reward: { credits: 100 } }), b = M({ type: "MATCH_WIN" }, { id: "b", dependsOn: ["a"] }), c = M({ type: "OPEN_PACK" }, { id: "c" });
  const fin = M({ type: "MATCH_PLAY" }, { id: "fin", dependsOn: ["a", "b", "c"] });
  const later = M({ type: "MATCH_PLAY" }, { id: "later", availableFrom: 2_000 });
  let st = missionStates([a, b, c, fin, later], [], 1_000);
  assert.deepEqual(Object.fromEntries(st.map((v) => [v.id, v.state])), { a: "ACTIVE", b: "LOCKED", c: "ACTIVE", fin: "LOCKED", later: "LOCKED" });
  assert.deepEqual(activeForProgress([a, b, c, fin], [], 1_000).map((m) => m.id), ["a", "c"]);
  st = missionStates([a, b, c, fin], [{ missionId: "a", progress: 3, completedAt: 1, claimedAt: null }, { missionId: "b", progress: 3, completedAt: 1, claimedAt: null }, { missionId: "c", progress: 3, completedAt: 1, claimedAt: null }], 1_000);
  assert.deepEqual(Object.fromEntries(st.map((v) => [v.id, v.state])), { a: "COMPLETED", b: "CLAIMED", c: "CLAIMED", fin: "ACTIVE" }, "sin recompensa, completada = cerrada");
});

test("F73 M-ST2 · proyecto: completo solo con TODAS sus misiones; reclamado manda", () => {
  const p: ProjectDef = { id: "pj", name: "Proyecto", description: "", targetCardId: "x", status: "ACTIVE", sortOrder: 0, availableFrom: null, availableTo: null, version: 1 };
  const m1 = M({ type: "MATCH_WIN" }, { id: "m1", projectId: "pj" }), m2 = M({ type: "MATCH_WIN" }, { id: "m2", projectId: "pj" });
  const half = missionStates([m1, m2], [{ missionId: "m1", progress: 3, completedAt: 1, claimedAt: null }], 5);
  assert.equal(projectStates([p], half, new Set(), 5)[0].state, "ACTIVE");
  const full = missionStates([m1, m2], [{ missionId: "m1", progress: 3, completedAt: 1, claimedAt: null }, { missionId: "m2", progress: 3, completedAt: 1, claimedAt: null }], 5);
  assert.deepEqual(projectStates([p], full, new Set(), 5)[0], { id: "pj", name: "Proyecto", description: "", targetCardId: "x", state: "COMPLETED", completed: 2, total: 2, missionIds: ["m1", "m2"], sortOrder: 0 });
  assert.equal(projectStates([p], full, new Set(["pj"]), 5)[0].state, "CLAIMED");
});

const look: Lookup = { cardExists: (id) => id === "real-card", playerExists: (id) => id === "real-player", packExists: (id) => ["estandar", "premium"].includes(id), teamExists: (k) => k === "fnatic" };

test("F73 M-VAL · el admin no publica misiones inválidas: condición, parámetros, recompensa, dependencias y ciclos", () => {
  const codes = (m: MissionDef, all: MissionDef[] = [m]) => validateMission(m, all, look, []).map((p) => p.code);
  assert.deepEqual(codes(M({ type: "MATCH_WIN" }, { id: "ok" })), []);
  assert.ok(codes(M({ type: "NOPE" as never }, { id: "x1" })).includes("NO_CONDITION"));
  assert.ok(codes(M({ type: "WIN_WITH_PLAYER" }, { id: "x2" })).includes("MISSING_PARAM"));
  assert.ok(codes(M({ type: "USE_CARD", cardId: "inventada" }, { id: "x3" })).includes("UNKNOWN_CARD"));
  assert.ok(codes(M({ type: "USE_TEAM", team: "nadie" }, { id: "x4" })).includes("UNKNOWN_TEAM"));
  assert.ok(codes(M({ type: "MATCH_WIN" }, { id: "x5", target: 0 })).includes("BAD_TARGET"));
  assert.ok(codes(M({ type: "MATCH_WIN" }, { id: "x6", reward: { packId: "no-existe", packCount: 1 } })).includes("UNKNOWN_REWARD"));
  assert.ok(codes(M({ type: "MATCH_WIN" }, { id: "x7", reward: { credits: 999_999 } })).includes("BAD_REWARD"));
  assert.ok(codes(M({ type: "WIN_WITH_TEAM_COUNT", min: 1 }, { id: "x8" })).includes("BAD_MIN"));
  const a = M({ type: "MATCH_WIN" }, { id: "a", dependsOn: ["b"] }), b = M({ type: "MATCH_WIN" }, { id: "b", dependsOn: ["a"] });
  assert.ok(hasCycle([a, b]));
  assert.ok(codes(a, [a, b]).includes("CIRCULAR_DEPENDENCY"));
  assert.ok(codes(M({ type: "MATCH_WIN" }, { id: "c", dependsOn: ["fantasma"] })).includes("BAD_DEPENDENCY"));
  assert.ok(!hasCycle([M({ type: "MATCH_WIN" }, { id: "x", dependsOn: ["y"] }), M({ type: "MATCH_WIN" }, { id: "y" })]));
});

test("F73 M-VAL2 · proyecto: carta REAL y, para activarlo, misiones activas", () => {
  const p: ProjectDef = { id: "pj", name: "Proyecto", description: "", targetCardId: "real-card", status: "ACTIVE", sortOrder: 0, availableFrom: null, availableTo: null, version: 1 };
  assert.ok(validateProject({ ...p, targetCardId: "inventada" }, [], look).some((x) => x.code === "UNKNOWN_CARD"));
  assert.ok(validateProject(p, [], look, { forActivation: true }).some((x) => x.code === "NO_MISSIONS"));
  assert.deepEqual(validateProject(p, [M({ type: "MATCH_WIN" }, { id: "m", projectId: "pj" })], look, { forActivation: true }), []);
});
