/**
 * SOCIAL 1.0 · DOMINIO PURO (Fase 29). Amistades, presencia, retos, bandeja, búsqueda y cara a cara.
 * Bloques del brief: amistades (1–12), búsqueda y perfil (13–18), retos (25–36), cara a cara (49–55).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  pairKey, relationFor, actionsFor, canChallenge, RELATION_LABEL,
  presenceOf, PRESENCE_WINDOWS, HEARTBEAT_MS, sortFriends,
  effectiveStatus, challengeActions, directionOf, CHALLENGE_TTL_SECONDS, CHALLENGE_LABEL,
  inboxOf, badgeCount, normalizeQuery, SEARCH_MIN, SEARCH_LIMIT,
  h2hSplit, h2hText, recentOpponents, activityOf,
  type FriendshipRow, type ChallengeRow,
} from "./social";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const NOW = 1_800_000_000_000;

const row = (over: Partial<FriendshipRow> = {}): FriendshipRow => ({
  userLo: A, userHi: B, requesterId: A, status: "PENDING", blockedBy: null, createdAt: NOW - 1000, respondedAt: null, ...over,
});
const who = (id: string) => ({ userId: id, username: id.slice(-1), avatar: "🎮" });
const ch = (over: Partial<ChallengeRow> = {}): ChallengeRow => ({
  id: "c1", challengerId: A, challengedId: B, status: "PENDING", matchId: null, previousMatchId: null,
  createdAt: NOW - 60_000, expiresAt: NOW + 3600_000, respondedAt: null, ...over,
});

/* ───────────── amistades ───────────── */

test("1 · par canónico: lo < hi, sin orden de llegada y NUNCA uno mismo", () => {
  assert.deepEqual(pairKey(B, A), { lo: A, hi: B });
  assert.deepEqual(pairKey(A, B), { lo: A, hi: B });
  assert.equal(pairKey(A, A), null);
  assert.equal(pairKey("", A), null);
});

test("2 · relación desde la fila canónica: NONE, OUTGOING/INCOMING según quién pidió, FRIENDS, bloqueos, SELF", () => {
  assert.equal(relationFor(null, A, B), "NONE");
  assert.equal(relationFor(row(), A, B), "OUTGOING");
  assert.equal(relationFor(row(), B, A), "INCOMING");
  assert.equal(relationFor(row({ status: "ACCEPTED" }), B, A), "FRIENDS");
  assert.equal(relationFor(row({ status: "BLOCKED", blockedBy: A }), A, B), "BLOCKED_BY_ME");
  assert.equal(relationFor(row({ status: "BLOCKED", blockedBy: A }), B, A), "BLOCKED_ME");
  assert.equal(relationFor(row({ status: "DECLINED" }), A, B), "NONE", "rechazada = se puede volver a pedir");
  assert.equal(relationFor(row(), A, A), "SELF");
});

test("3 · acciones por relación: un bloqueo apaga todo lo demás; solo amigos retan", () => {
  assert.deepEqual(actionsFor("NONE"), { add: true, accept: false, decline: false, cancel: false, unfriend: false, challenge: false, block: true, unblock: false });
  assert.deepEqual(actionsFor("INCOMING"), { add: false, accept: true, decline: true, cancel: false, unfriend: false, challenge: false, block: true, unblock: false });
  assert.deepEqual(actionsFor("OUTGOING").cancel, true);
  assert.deepEqual(actionsFor("FRIENDS"), { add: false, accept: false, decline: false, cancel: false, unfriend: true, challenge: true, block: true, unblock: false });
  assert.deepEqual(actionsFor("BLOCKED_BY_ME"), { add: false, accept: false, decline: false, cancel: false, unfriend: false, challenge: false, block: false, unblock: true });
  assert.deepEqual(actionsFor("BLOCKED_ME"), { add: false, accept: false, decline: false, cancel: false, unfriend: false, challenge: false, block: false, unblock: false });
  assert.deepEqual(actionsFor("SELF"), { add: false, accept: false, decline: false, cancel: false, unfriend: false, challenge: false, block: false, unblock: false });
  for (const r of ["NONE", "OUTGOING", "INCOMING", "BLOCKED_BY_ME", "BLOCKED_ME", "SELF"] as const) assert.equal(canChallenge(r), false);
  assert.equal(canChallenge("FRIENDS"), true);
});

test("4 · etiquetas de relación: las del perfil (AÑADIR AMIGO · SOLICITUD ENVIADA · ACEPTAR · AMIGOS)", () => {
  assert.equal(RELATION_LABEL.NONE, "Añadir amigo");
  assert.equal(RELATION_LABEL.OUTGOING, "Solicitud enviada");
  assert.equal(RELATION_LABEL.INCOMING, "Aceptar");
  assert.equal(RELATION_LABEL.FRIENDS, "Amigos");
  assert.equal(RELATION_LABEL.SELF, "Tú");
});

/* ───────────── presencia ───────────── */

test("19 · F85 · presencia con semántica explícita: en línea < 2 min desde el latido; sin latido = desconectado; sin «reciente»", () => {
  assert.equal(PRESENCE_WINDOWS.onlineMs, 2 * 60_000);
  assert.equal(presenceOf(NOW - 10_000, NOW), "ONLINE");
  assert.equal(presenceOf(NOW - PRESENCE_WINDOWS.onlineMs + 1, NOW), "ONLINE");
  assert.equal(presenceOf(NOW - PRESENCE_WINDOWS.onlineMs, NOW), "OFFLINE", "TTL: un navegador muerto cae solo a desconectado");
  assert.equal(presenceOf(null, NOW), "OFFLINE");
  assert.equal(presenceOf(NaN, NOW), "OFFLINE");
  assert.ok(!("recentMs" in PRESENCE_WINDOWS), "ya no existe «activo recientemente»");
});

test("20 · F85 · el pulso (20 s) es más rápido que el TTL (2 min): una pestaña viva nunca cae a desconectado", () => {
  assert.equal(HEARTBEAT_MS, 20_000);
  assert.ok(HEARTBEAT_MS * 2 < PRESENCE_WINDOWS.onlineMs);
});

test("21 · F85 · EN PARTIDA sale del ciclo de vida (sin latido); EN COLA exige latido fresco", () => {
  assert.equal(presenceOf(null, NOW, { inMatch: true }), "IN_MATCH", "partida viva aunque el navegador se cerrara");
  assert.equal(presenceOf(NOW - 5_000, NOW, { inQueue: true }), "IN_QUEUE");
  assert.equal(presenceOf(NOW - 10 * 60_000, NOW, { inQueue: true }), "OFFLINE", "entrada de cola vieja sin latido: no se afirma que busque");
  assert.equal(presenceOf(NOW + 5_000, NOW), "ONLINE", "reloj adelantado no castiga");
});

test("22 · F85 · orden de amigos: en partida → en cola → en línea → desconectado; dentro, por nombre (sin ranking)", () => {
  const list = sortFriends([
    { username: "zed", presence: "OFFLINE" },
    { username: "ana", presence: "ONLINE" },
    { username: "bob", presence: "IN_QUEUE" },
    { username: "cyd", presence: "IN_MATCH" },
    { username: "amy", presence: "ONLINE" },
  ] as const);
  assert.deepEqual(list.map((f) => f.username), ["cyd", "bob", "amy", "ana", "zed"]);
});

/* ───────────── retos ───────────── */

test("25 · F85 · TTL del reto: 5 min, y el estado efectivo caduca por reloj del servidor aunque la fila diga PENDING", () => {
  assert.equal(CHALLENGE_TTL_SECONDS, 5 * 60);
  assert.equal(effectiveStatus(ch(), NOW), "PENDING");
  assert.equal(effectiveStatus(ch({ expiresAt: NOW }), NOW), "EXPIRED");
  assert.equal(effectiveStatus(ch({ expiresAt: NOW - 1 }), NOW), "EXPIRED");
  assert.equal(effectiveStatus(ch({ status: "ACCEPTED", expiresAt: NOW - 1 }), NOW), "ACCEPTED", "solo caduca lo pendiente");
  assert.equal(effectiveStatus(ch({ status: "MATCHED", expiresAt: NOW - 1 }), NOW), "MATCHED");
});

test("26 · dirección: retado = INCOMING, retador = OUTGOING, tercero = null", () => {
  assert.equal(directionOf(ch(), B), "INCOMING");
  assert.equal(directionOf(ch(), A), "OUTGOING");
  assert.equal(directionOf(ch(), C), null);
});

test("27 · acciones sobre un reto: solo el retado acepta/rechaza, solo el retador cancela, y solo mientras está pendiente", () => {
  assert.deepEqual(challengeActions(ch(), B, NOW), { accept: true, decline: true, cancel: false, open: false });
  assert.deepEqual(challengeActions(ch(), A, NOW), { accept: false, decline: false, cancel: true, open: false });
  assert.deepEqual(challengeActions(ch(), C, NOW), { accept: false, decline: false, cancel: false, open: false });
  assert.deepEqual(challengeActions(ch({ expiresAt: NOW - 1 }), B, NOW), { accept: false, decline: false, cancel: false, open: false }, "caducado: nada");
  assert.deepEqual(challengeActions(ch({ status: "DECLINED" }), A, NOW).cancel, false);
  assert.deepEqual(challengeActions(ch({ status: "MATCHED", matchId: "m1" }), A, NOW), { accept: false, decline: false, cancel: false, open: true });
  assert.deepEqual(challengeActions(ch({ status: "MATCHED", matchId: "m1" }), C, NOW).open, false, "un tercero no abre la partida");
});

test("28 · etiquetas de estado de reto: las seis del modelo", () => {
  assert.deepEqual(Object.keys(CHALLENGE_LABEL).sort(), ["ACCEPTED", "CANCELLED", "DECLINED", "EXPIRED", "MATCHED", "PENDING"]);
  assert.equal(CHALLENGE_LABEL.EXPIRED, "Caducado");
});

/* ───────────── bandeja y badge ───────────── */

test("57 · bandeja derivada: solicitudes recibidas + retos recibidos pendientes + «tu reto fue aceptado»; nunca lo caducado ni lo propio", () => {
  const items = inboxOf({
    incomingRequests: [{ ...who(C), at: NOW - 5000 }],
    challenges: [
      { ...ch({ id: "in" }), challenger: who(A), challenged: who(B) },
      { ...ch({ id: "old", expiresAt: NOW - 1 }), challenger: who(A), challenged: who(B) },
      { ...ch({ id: "mine", challengerId: B, challengedId: A }), challenger: who(B), challenged: who(A) },
      { ...ch({ id: "ok", challengerId: B, challengedId: C, status: "MATCHED", matchId: "m9", respondedAt: NOW - 100 }), challenger: who(B), challenged: who(C) },
    ],
    me: B, now: NOW,
  });
  assert.deepEqual(items.map((i) => `${i.kind}:${i.id}`), ["CHALLENGE_ACCEPTED:chok:ok", "FRIEND_REQUEST:req:" + C, "CHALLENGE:ch:in"]);
  assert.equal(items[0].matchId, "m9");
  assert.equal(badgeCount(items), 2, "el número de la navegación cuenta solo lo que espera MI acción");
});

/* ───────────── búsqueda ───────────── */

test("13 · consulta normalizada: mínimo 2 letras, sin comodines de like, minúsculas, acotada; nunca por correo", () => {
  assert.equal(SEARCH_MIN, 2);
  assert.equal(SEARCH_LIMIT, 10);
  assert.equal(normalizeQuery("K"), null);
  assert.equal(normalizeQuery("  Ka "), "ka");
  assert.equal(normalizeQuery("k%_a\\"), "k_a", "F85 · el _ es parte del nombre (literal); % y \\ se quitan");
  assert.equal(normalizeQuery("alguien@correo.com"), null);
  assert.equal(normalizeQuery(42), null);
  assert.equal(normalizeQuery("%%"), null, "solo comodines = nada");
  assert.equal(normalizeQuery("a".repeat(80))?.length, 32);
});

/* ───────────── cara a cara ───────────── */

const m = (mode: "PVP" | "PVP_PRIVATE" | "PVE", winner: "A" | "B" | null, a = A, b = B, status = "COMPLETED") => ({
  mode, status, winner, closedReason: null, closedBy: null, playerAId: a, playerBId: b,
});

test("49 · cara a cara partido en RANKED / PRIVADO / TOTAL desde mi perspectiva, sin mezclar", () => {
  const h = h2hSplit([
    m("PVP", "A"), m("PVP", "B"), m("PVP", "B", B, A), // ranked: gano, pierdo, gano (soy B y gana B)
    m("PVP_PRIVATE", "A"), m("PVP_PRIVATE", null, A, B, "DRAW"), // privado: gano, empate
    m("PVE", "A"), // el bot no cuenta
    m("PVP", "A", A, C), // otro rival no cuenta
  ], A, B);
  assert.deepEqual(h.ranked, { wins: 2, losses: 1, draws: 0, matches: 3 });
  assert.deepEqual(h.private, { wins: 1, losses: 0, draws: 1, matches: 2 });
  assert.deepEqual(h.total, { wins: 3, losses: 1, draws: 1, matches: 5 });
});

test("50 · el texto del cara a cara: «victorias–derrotas» y el empate solo si existe", () => {
  assert.equal(h2hText({ wins: 3, losses: 1, draws: 0, matches: 4 }), "3–1");
  assert.equal(h2hText({ wins: 3, losses: 1, draws: 2, matches: 6 }), "3–1–2");
});

test("51 · una partida en curso no suma al cara a cara", () => {
  const h = h2hSplit([m("PVP_PRIVATE", null, A, B, "IN_PROGRESS")], A, B);
  assert.equal(h.total.matches, 0);
});

/* ───────────── rivales recientes y actividad ───────────── */

test("23 · rivales recientes: únicos, por partida más reciente, con recuento, acotados", () => {
  const r = recentOpponents([
    { at: NOW - 3000, rivalId: B }, { at: NOW - 1000, rivalId: C }, { at: NOW - 2000, rivalId: B }, { at: NOW - 500, rivalId: "" },
  ], 8);
  assert.deepEqual(r, [{ rivalId: C, lastAt: NOW - 1000, games: 1 }, { rivalId: B, lastAt: NOW - 2000, games: 2 }]);
  assert.equal(recentOpponents(Array.from({ length: 20 }, (_, i) => ({ at: NOW - i, rivalId: `r${i}` })), 8).length, 8);
});

test("60 · actividad derivada: sin texto libre; amistades aceptadas y duelos de dos personas, más reciente primero", () => {
  const items = activityOf({
    friendships: [{ username: "ana", respondedAt: NOW - 100, status: "ACCEPTED" }, { username: "bob", respondedAt: null, status: "PENDING" }],
    matches: [
      { id: "1", at: NOW - 50, rivalName: "cyd", mode: "PVP_PRIVATE", letter: "W" },
      { id: "2", at: NOW - 500, rivalName: "dan", mode: "PVE", letter: "L" },
      { id: "3", at: NOW - 200, rivalName: "eve", mode: "PVP", letter: "D" },
    ],
  });
  assert.deepEqual(items.map((i) => i.kind), ["PRIVATE_DUEL", "FRIENDS_NOW", "RANKED_DUEL"]);
});
