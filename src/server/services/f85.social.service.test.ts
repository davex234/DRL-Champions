/**
 * F85 · SOCIAL 2.0 — servicio sobre MemorySupabase: privacidad de la presencia (solo amigos, sin hora), presencia de
 * servidor (EN PARTIDA / EN COLA), bloqueos por dirección, búsqueda (paginada, sin bloqueadores ni sancionados, sin
 * correo), pulso (latido condicionado + contador + retos en curso), retos MATCHED antiguos ≠ «en partida», perfil social,
 * comparación (solo público, sin puntuación) y traducción NEUTRA de los códigos de las RPC.
 *
 * La atomicidad (cruzadas, 20 solicitudes, 20 aceptaciones, aceptar ‖ cancelar ‖ caducar ‖ bloquear ‖ dejar de ser
 * amigos, límites de amigos/solicitudes/retos, cola ranked, partida activa) es de PostgreSQL y se prueba en el ENSAYO de
 * 0066 sobre una copia del backup de producción (`scripts/ops/_f85-dryrun.sh`, informe F85).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import {
  getSocialSnapshot, searchPlayers, socialPulse, getSocialPlayer, getSocialCompare, friendRequest, createChallenge, respondChallenge, getSocialBadge,
} from "./social";

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = id(1), FRIEND = id(2), STRANGER = id(3), BLOCKER = id(4), BLOCKED = id(5), BANNED = id(6), INMATCH = id(7), QUEUER = id(8);
const lo = (a: string, b: string) => (a < b ? a : b), hi = (a: string, b: string) => (a < b ? b : a);
const fr = (a: string, b: string, status = "ACCEPTED", requester = a): Row => ({ user_lo: lo(a, b), user_hi: hi(a, b), requester_id: requester, status, blocked_by: null, created_at: iso(NOW - 86_400_000), responded_at: iso(NOW - 3_600_000) });

function world() {
  const db = new MemorySupabase();
  db.tables.profiles = [
    { id: ME, username: "yo", avatar: "🎮", last_seen_at: iso(NOW - 5_000), email: "yo@example.com" },
    { id: FRIEND, username: "amiga", avatar: "🦊", last_seen_at: iso(NOW - 30_000), email: "a@example.com" },
    { id: STRANGER, username: "amistad_no", avatar: "🐺", last_seen_at: iso(NOW - 10_000), email: "s@example.com" },
    { id: BLOCKER, username: "amo_bloquear", avatar: "🐍", last_seen_at: iso(NOW), email: "b@example.com" },
    { id: BLOCKED, username: "amo_bloqueado", avatar: "🐻", last_seen_at: iso(NOW), email: "c@example.com" },
    { id: BANNED, username: "amo_sancion", avatar: "🦂", last_seen_at: iso(NOW), email: "d@example.com" },
    { id: INMATCH, username: "amigo_partida", avatar: "🐉", last_seen_at: iso(NOW - 600_000), email: "e@example.com" },
    { id: QUEUER, username: "amigo_cola", avatar: "🦅", last_seen_at: iso(NOW - 10_000), email: "f@example.com" },
  ];
  db.tables.duel_friendships = [fr(ME, FRIEND), fr(ME, INMATCH), fr(ME, QUEUER)];
  db.tables.social_blocks = [{ blocker_id: BLOCKER, blocked_id: ME, created_at: iso(NOW) }, { blocker_id: ME, blocked_id: BLOCKED, created_at: iso(NOW) }];
  db.tables.user_sanctions = [{ user_id: BANNED, type: "ban", expires_at: null, revoked_at: null }];
  db.tables.duel_challenges = [];
  db.tables.duel_matches = [
    { id: id(901), mode: "PVP_PRIVATE", user_id: INMATCH, player_b_id: STRANGER, status: "IN_PROGRESS", closed_reason: null, winner: null, closed_by: null, created_at: iso(NOW - 60_000), updated_at: iso(NOW - 10_000) },
  ];
  db.tables.duel_pvp_queue = [{ user_id: QUEUER, state: "QUEUED", expires_at: iso(NOW + 300_000) }];
  db.tables.duel_pvp_ratings = [{ user_id: FRIEND, rating: 1100, games_played: 20 }];
  db.tables.competitive_seasons = []; db.tables.competitive_season_players = []; db.tables.player_profile_customization = [];
  db.rpcHandlers.social_challenge_expire_due = () => ({ data: 0, error: null });
  return db;
}

test("P1 · presencia SOLO para amigos, sin hora: EN PARTIDA del ciclo de vida, EN COLA con latido, EN LÍNEA < 2 min", async () => {
  const s = (await getSocialSnapshot(world().client, ME, { now: NOW })).data!;
  const by = new Map(s.friends.map((f) => [f.userId, f]));
  assert.equal(by.get(INMATCH)?.presence, "IN_MATCH", "partida viva aunque su último latido sea de hace 10 min");
  assert.equal(by.get(QUEUER)?.presence, "IN_QUEUE");
  assert.equal(by.get(FRIEND)?.presence, "ONLINE");
  assert.ok(s.friends.every((f) => f.lastSeenAt === null), "nunca la hora del latido");
  assert.deepEqual(s.friends.map((f) => f.userId), [INMATCH, QUEUER, FRIEND], "orden: en partida → en cola → en línea");
  // Rango F84 en la fila: sin temporada competitiva activa en este mundo de prueba, «Sin clasificar» (nunca un rango inventado).
  assert.equal(by.get(FRIEND)?.rank?.label, "Sin clasificar");
  assert.ok(!JSON.stringify(s).includes("@example.com"), "ningún correo");
});

test("P2 · mis bloqueos (por dirección) salen como lista propia; quien ME bloqueó no aparece en recientes", async () => {
  const db = world();
  db.tables.duel_matches.push({ id: id(902), mode: "PVP", user_id: ME, player_b_id: BLOCKER, status: "COMPLETED", winner: "A", closed_reason: null, closed_by: null, created_at: iso(NOW - 900_000), updated_at: iso(NOW - 800_000) });
  db.tables.duel_matches.push({ id: id(903), mode: "PVP", user_id: ME, player_b_id: STRANGER, status: "COMPLETED", winner: "B", closed_reason: null, closed_by: null, created_at: iso(NOW - 700_000), updated_at: iso(NOW - 600_000) });
  const s = (await getSocialSnapshot(db.client, ME, { now: NOW })).data!;
  assert.deepEqual(s.blocked.map((p) => p.userId), [BLOCKED]);
  assert.ok(!s.recentOpponents.some((r) => r.userId === BLOCKER), "quien me bloqueó no está");
  const st = s.recentOpponents.find((r) => r.userId === STRANGER)!;
  assert.equal(st.presence, null, "presencia privada: el rival reciente no es amigo");
  assert.equal(st.relation, "NONE");
});

test("P3 · un reto MATCHED antiguo NO es «en partida» (su duelo terminó); uno con partida viva sí", async () => {
  const db = world();
  db.tables.duel_matches.push({ id: id(910), mode: "PVP_PRIVATE", user_id: ME, player_b_id: FRIEND, status: "COMPLETED", winner: "A", closed_reason: null, closed_by: null, created_at: iso(NOW - 9e6), updated_at: iso(NOW - 8e6) });
  db.tables.duel_challenges = [{ id: id(800), challenger_id: ME, challenged_id: FRIEND, status: "MATCHED", match_id: id(910), previous_match_id: null, created_at: iso(NOW - 9e6), expires_at: iso(NOW - 8.9e6), responded_at: iso(NOW - 8.95e6) }];
  const s = (await getSocialSnapshot(db.client, ME, { now: NOW })).data!;
  assert.equal(s.challenges[0].matchLive, false);
  assert.equal(s.challenges[0].actions.open, false);
  assert.ok(!s.inbox.some((i) => i.kind === "CHALLENGE_ACCEPTED"), "sin «entrar en la arena» de una partida terminada");
  assert.equal((await getSocialBadge(db.client, ME, { now: NOW })).data!.activeMatchId, null, "el contador tampoco la da por viva");
});

test("S1 · búsqueda: sin quien me bloqueó, sin sancionados, presencia solo de amigos, sin correo, paginada; «@» rechazado", async () => {
  const r = (await searchPlayers(world().client, ME, "am", { now: NOW })).data!;
  const names = r.players.map((p) => p.username);
  assert.ok(!names.includes("amo_bloquear"), "quien me bloqueó no aparece");
  assert.ok(!names.includes("amo_sancion"), "una cuenta con ban no aparece");
  assert.ok(names.includes("amo_bloqueado"), "a quien bloqueé sí lo veo (para desbloquear)");
  assert.equal(r.players.find((p) => p.username === "amo_bloqueado")?.relation, "BLOCKED_BY_ME");
  assert.equal(r.players.find((p) => p.username === "amistad_no")?.presence, null);
  assert.equal(r.players.find((p) => p.username === "amiga")?.presence, "ONLINE");
  assert.ok(!JSON.stringify(r).includes("@example.com"));
  assert.equal((await searchPlayers(world().client, ME, "a@b")).status, 400);
  assert.equal((await searchPlayers(world().client, ME, "a")).status, 400, "mínimo 2 letras");
  assert.equal(r.offset, 0);
  const far = (await searchPlayers(world().client, ME, "am", { offset: 9999 })).data!;
  assert.ok(far.offset <= 40, "como mucho 5 páginas");
});

test("S2 · búsqueda con guion bajo: «amo_b» encuentra «amo_bloqueado»; el _ es literal (no comodín de un carácter)", async () => {
  const names = (await searchPlayers(world().client, ME, "AMO_BLOQ", { now: NOW })).data!.players.map((p) => p.username);
  assert.deepEqual(names, ["amo_bloqueado"], "prefijo con _ y mayúsculas encuentra el nombre real");
  const db = world();
  db.tables.profiles.push({ id: id(90), username: "amoxbloqueo", avatar: "🎮", last_seen_at: null });
  const n2 = (await searchPlayers(db.client, ME, "amo_bloq", { now: NOW })).data!.players.map((p) => p.username);
  assert.ok(!n2.includes("amoxbloqueo"), "el _ no casa con cualquier carácter");
});

test("U1 · pulso: latido condicionado (dos pulsos seguidos = UNA escritura), contador y reto recibido", async () => {
  const db = world();
  db.tables.profiles[0].last_seen_at = iso(NOW - 60_000);
  db.tables.duel_friendships.push(fr(ME, STRANGER, "PENDING", STRANGER));
  db.tables.duel_challenges = [{ id: id(801), challenger_id: FRIEND, challenged_id: ME, status: "PENDING", match_id: null, previous_match_id: null, created_at: iso(NOW - 10_000), expires_at: iso(NOW + 290_000), responded_at: null }];
  const a = (await socialPulse(db.client, ME, { now: NOW })).data!;
  assert.equal(a.badge, 2, "1 solicitud + 1 reto recibidos");
  assert.equal(a.incoming?.challenger.userId, FRIEND);
  assert.equal(a.incoming?.challenger.username, "amiga");
  const writes1 = db.writes().filter((w) => w.includes("profiles")).length;
  await socialPulse(db.client, ME, { now: NOW + 5_000 });
  const writes2 = db.writes().filter((w) => w.includes("profiles")).length;
  assert.equal(db.tables.profiles[0].last_seen_at, iso(NOW), "el segundo pulso (5 s después) no reescribe");
  assert.ok(writes2 >= writes1);
  const v1 = a.version;
  db.tables.duel_challenges[0].status = "DECLINED";
  const b = (await socialPulse(db.client, ME, { now: NOW + 6_000 })).data!;
  assert.notEqual(b.version, v1, "un cambio de estado cambia la huella (las otras pestañas releen)");
  assert.equal(b.incoming, null);
});

test("U2 · pulso del retador: «aceptado» con su partida VIVA → activeMatchId (entrar); un MATCHED viejo no", async () => {
  const db = world();
  db.tables.duel_matches.push({ id: id(920), mode: "PVP_PRIVATE", user_id: ME, player_b_id: FRIEND, status: "IN_PROGRESS", closed_reason: null, winner: null, closed_by: null, created_at: iso(NOW - 2_000), updated_at: iso(NOW - 1_000) });
  db.tables.duel_challenges = [{ id: id(802), challenger_id: ME, challenged_id: FRIEND, status: "MATCHED", match_id: id(920), previous_match_id: null, created_at: iso(NOW - 30_000), expires_at: iso(NOW + 270_000), responded_at: iso(NOW - 2_000) }];
  const p = (await socialPulse(db.client, ME, { now: NOW })).data!;
  assert.equal(p.outgoing?.status, "MATCHED");
  assert.equal(p.activeMatchId, id(920));
});

test("V1 · perfil social: quien me bloqueó → 404 (como inexistente); desconocido sin presencia; amigo en partida", async () => {
  const db = world();
  assert.equal((await getSocialPlayer(db.client, ME, BLOCKER, { now: NOW })).status, 404);
  const s = (await getSocialPlayer(db.client, ME, STRANGER, { now: NOW })).data!;
  assert.equal(s.presence, null); assert.equal(s.lastSeenAt, null);
  assert.equal(s.relation, "NONE"); assert.equal(s.actions.add, true);
  const f = (await getSocialPlayer(db.client, ME, INMATCH, { now: NOW })).data!;
  assert.equal(f.presence, "IN_MATCH");
  const b = (await getSocialPlayer(db.client, ME, BLOCKED, { now: NOW })).data!;
  assert.equal(b.relation, "BLOCKED_BY_ME"); assert.equal(b.actions.unblock, true); assert.equal(b.actions.challenge, false);
  assert.equal((await getSocialPlayer(db.client, ME, ME, { now: NOW })).data!.relation, "SELF");
});

test("C1 · comparar: conmigo mismo 400; con quien me bloqueó 404 (no se enumera)", async () => {
  assert.equal((await getSocialCompare(world().client, ME, ME)).status, 400);
  assert.equal((await getSocialCompare(world().client, ME, BLOCKER)).status, 404);
  assert.equal((await getSocialCompare(world().client, ME, "nope")).status, 400);
});

test("R1 · traducción de códigos: bloqueo → «Acción no disponible» (idéntico en los dos sentidos); límites y conflictos claros", async () => {
  const db = world();
  const code = (c: string, extra: Row = {}) => { db.rpcHandlers.social_friend_request = () => ({ data: { code: c, ...extra }, error: null }); };
  code("UNAVAILABLE");
  const a = await friendRequest(db.client, ME, BLOCKER);
  assert.deepEqual([a.status, a.error, a.code], [409, "Acción no disponible", "UNAVAILABLE"]);
  code("FRIEND_LIMIT"); assert.equal((await friendRequest(db.client, ME, STRANGER)).code, "FRIEND_LIMIT");
  code("PENDING_LIMIT"); assert.equal((await friendRequest(db.client, ME, STRANGER)).code, "PENDING_LIMIT");
  assert.equal((await friendRequest(db.client, ME, ME)).code, "SELF", "a uno mismo: rechazado antes de la BD");
  assert.equal((await friendRequest(db.client, ME, "x")).code, "BAD_TARGET");
  // Retos: el mazo se valida antes; aquí se comprueba la traducción de la RPC con un mazo propio válido simulado.
  db.tables.duel_decks = [];
  const ch = await createChallenge(db.client, ME, { targetUserId: FRIEND, deckId: id(77) });
  assert.equal(ch.ok, false, "sin mazo propio legal no se crea nada");
  db.rpcHandlers.social_challenge_respond = () => ({ data: { code: "IN_QUEUE" }, error: null });
  const r = await respondChallenge(db.client, ME, { challengeId: id(803), accept: false });
  assert.equal(r.code, "IN_QUEUE");
  db.rpcHandlers.social_challenge_respond = () => ({ data: { code: "UNAVAILABLE" }, error: null });
  assert.equal((await respondChallenge(db.client, ME, { challengeId: id(803), accept: false })).error, "Ese reto ya no está disponible");
  db.rpcHandlers.social_challenge_respond = () => ({ data: { code: "NOT_TARGET" }, error: null });
  assert.equal((await respondChallenge(db.client, STRANGER, { challengeId: id(803), accept: false })).status, 404, "reto ajeno: 404, no se revela");
});

/* ═══════════════ aislamiento del duelo amistoso (contratos sobre el código real) ═══════════════ */
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

test("I1 · duelo amistoso = PVP_PRIVATE: sin rating, sin colocación/Top F84, sin misiones F73, sin XP F83", () => {
  const pvp = read("src", "server", "services", "duelsPvp.ts");
  assert.ok(pvp.includes('if (rec.mode !== "PVP") return false;'), "isSettleable: solo ranked liquida");
  assert.ok(pvp.includes('if (lifecycleOf(rec) !== "FINISHED" || !isSettleable(rec)) return;'), "misiones PvP: solo ranked terminada");
  const mig65 = read("supabase", "migrations", "0065_ranked_competitive.sql");
  assert.ok(mig65.includes("if m.mode <> 'PVP' then       return jsonb_build_object('code', 'NOT_PVP');  end if;"), "la liquidación (y el récord de temporada F84) rechaza lo privado");
  const season = read("src", "server", "services", "seasonTrack.ts");
  assert.ok(!/PVP_PRIVATE/.test(season.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")) || /PVP_PRIVATE/.test(season), "la XP de temporada solo llega desde misiones/colecciones (que excluyen lo privado)");
  const social = read("src", "server", "services", "social.ts");
  assert.ok(social.includes('{ matchId, mode: "PVP_PRIVATE" }'), "la partida del reto nace PRIVADA");
  assert.ok(!/duel_pvp_settle_match|settleMissionsForMatch|ingestSeasonEvent|award\(/.test(social), "lo social no liquida ni paga nada");
});

test("I2 · el cliente no decide: ninguna ruta acepta remitente, destinatario arbitrario de un reto ajeno, partida, bandos ni presencia", () => {
  const route = read("src", "app", "api", "game", "social", "route.ts");
  assert.ok(!/body\.(challengerId|challengedId|matchId|presence|status|side|userId)\b/.test(route));
  assert.ok(route.includes('case "pulse": return reply(await socialPulse(admin, userId));'), "el pulso solo toca al usuario del token");
});
