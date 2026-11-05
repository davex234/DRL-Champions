/**
 * F86 · TORNEOS — servicio real (`cups.ts`, `duelsPvp.ts`, `social.ts`, `collectionSets.ts`, `admin/cups.ts`) sobre
 * MemSupabase + el espejo de las RPC de 0069 (`testing/cupRpcMirror.ts`).
 *
 * Aquí se prueba el CAMINO entero del servidor: hub y ficha (fases, visibilidad, privacidad sin ids), inscripción
 * exactamente-una-vez y carrera de capacidad, cuadro perezoso una vez, «estoy listo» de los dos → UNA partida
 * PVP_PRIVATE del motor de siempre, jugada de verdad turno a turno, resultado DEL MOTOR que avanza al ganador por el
 * gancho de `duelsPvp`, campeón + trofeo en la Sala de Trofeos, retenciones/plazos resueltos por un admin con #TAG, y
 * aislamiento (ni rating, ni eventos de rating, ni misiones, ni cara a cara social).
 * Las carreras REALES (Postgres, 20 a la vez), los CHECK y las guardias se prueban en el ensayo de 0069.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { MemSupabase, type Row } from "./testing/memSupabase";
import { installCupRpcs } from "./testing/cupRpcMirror";
import { getCupHub, getCupDetail, getCupBadge, registerCup, readyCupMatch } from "./cups";
import { applyPvpAction, abandonPvpMatch, syncPvpMatch, type PvpMatchView } from "./duelsPvp";
import { getPrivateMatchInfo, getSocialPlayer } from "./social";
import { getTrophyRoom } from "./collectionSets";
import { createCup, updateCup, publishCup, cancelCup, resolveCupMatch } from "@/server/admin/cups";

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const U = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(999);
const TAG = (n: number) => `T${"ABCDEFGHJKMNPQRSTUVWXYZ"[n % 23]}${String(n).padStart(5, "2").replace(/[01]/g, "9")}`;
let seq = 0;
const uid = () => `eeee0000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

function giveDeck(db: MemSupabase, user: string, offset: number): string {
  const used = new Set<string>(); const team: string[] = [];
  for (const role of DUEL_ROLES) {
    let n = 0, skip = offset;
    for (const c of CARDS.filter((x) => x.combat && (x.role ?? getPlayer(x.playerId)?.role) === role)) {
      if (n === 2) break;
      if (used.has(c.playerId)) continue;
      if (skip-- > 0) continue;
      used.add(c.playerId); n++;
      const u = uid();
      db.table("user_cards").push({ uid: u, user_id: user, card_id: c.id, serial: null, origin: "pack", locked: false, obtained_at: iso(0) });
      team.push(u);
    }
  }
  const id = randomUUID();
  db.table("duel_decks").push({ id, user_id: user, name: "Equipo", card_uids: team, created_at: iso(0), updated_at: iso(0) });
  return id;
}

function world(players = 8) {
  const db = new MemSupabase();
  installCupRpcs(db);
  db.tables.profiles = [{ id: ADMIN, username: "organizador", avatar: "🛡", is_admin: true, public_tag: "ADM2345" }];
  for (let i = 1; i <= players; i++) db.tables.profiles.push({ id: U(i), username: `jugador_${i}`, avatar: "🎮", is_admin: false, public_tag: TAG(i), email: `p${i}@example.com` });
  db.tables.duel_pvp_ratings = Array.from({ length: players }, (_, i) => ({ user_id: U(i + 1), rating: 1400 - i * 25, games_played: 12, wins: 6, losses: 6, draws: 0, updated_at: iso(0) }));
  for (const t of ["cups", "cup_registrations", "cup_matches", "duel_matches", "duel_match_actions", "user_cosmetics", "content_audit_log", "duel_pvp_rating_events", "mission_events", "user_sanctions", "duel_pvp_queue", "duel_challenges", "duel_friendships", "social_blocks", "collection_sets", "user_collection_completions", "player_profile_customization", "competitive_seasons", "competitive_season_players"]) db.tables[t] ??= [];
  return db;
}

function cupRow(db: MemSupabase, o: Partial<Row> & { slug: string }): string {
  const id = randomUUID();
  db.table("cups").push({
    id, name: `Copa ${o.slug}`, description: "", rules: "Eliminación directa a partida única.", format: "SINGLE_ELIMINATION", seeding_policy: "RATING_SNAPSHOT",
    visibility: "PUBLIC", status: "PUBLISHED", registration_open_at: iso(NOW - 3_600_000), registration_close_at: iso(NOW + 3_600_000), starts_at: iso(NOW + 7_200_000),
    round_window_minutes: 60, min_participants: 4, max_participants: 8, participant_count: 0, bracket_size: null, rounds: null, rules_version: 1,
    published_at: iso(NOW - 7_200_000), started_at: null, completed_at: null, cancelled_at: null, cancel_reason: null, champion_id: null, version: 1,
    created_at: iso(NOW - 9_000_000), updated_at: iso(NOW - 9_000_000), ...o,
  });
  return id;
}
/** Como el paso del tiempo: la inscripción cierra y la ronda 1 empieza ya. */
function close(db: MemSupabase, id: string) {
  const c = db.table("cups").find((x) => x.id === id)!;
  Object.assign(c, { registration_open_at: iso(NOW - 7_200_000), registration_close_at: iso(Date.now() - 1000), starts_at: iso(Date.now() - 1000) });
}
const openAllWindows = (db: MemSupabase, id: string) => { for (const m of db.table("cup_matches").filter((x) => x.cup_id === id)) Object.assign(m, { available_at: iso(NOW - 60_000), deadline_at: iso(Date.now() + 3_600_000) }); };
const matchAt = (db: MemSupabase, cup: string, round: number, slot: number) => db.table("cup_matches").find((m) => m.cup_id === cup && m.round === round && m.slot === slot)!;

async function viewOf(db: MemSupabase, player: string, matchId: string) {
  const s = await syncPvpMatch(db.client, player, matchId);
  assert.ok(s.ok, s.error);
  return (s.data as unknown as { snapshot: PvpMatchView & { expectedSide: "A" | "B" | null } }).snapshot;
}
/** Juega la partida ENTERA con jugadas legales (el motor decide quién gana). */
async function playOut(db: MemSupabase, game: string, a: string, b: string) {
  for (let guard = 0; guard < 60; guard++) {
    const va = await viewOf(db, a, game);
    if (!va.expectedSide) return;
    const who = va.expectedSide === va.yourSide ? a : b;
    const v = who === a ? va : await viewOf(db, b, game);
    const mine = v.yourSide === "A" ? v.match.snapshotA : v.match.snapshotB;
    const used = new Set(v.yourSide === "A" ? v.match.usedA : v.match.usedB);
    const card = mine.cards.find((c) => !used.has(c.uid))!;
    const r = await applyPvpAction(db.client, game, { actionId: randomUUID(), expectedVersion: v.stateVersion, playerId: who, cardUid: card.uid, stat: v.match.attacker === v.yourSide ? "stronghold" : undefined });
    assert.ok(r.ok, r.error);
  }
  throw new Error("la partida no terminó");
}
/** Los dos jugadores de un cruce dicen «listo»; devuelve el id de la partida creada. */
async function startMatch(db: MemSupabase, slug: string, cup: string, round: number, slot: number, decks: Map<string, string>) {
  const m = matchAt(db, cup, round, slot);
  const a = m.player_a as string, b = m.player_b as string;
  const r1 = await readyCupMatch(db.client, a, { slug, round, slot, deckId: decks.get(a) });
  assert.ok(r1.ok, r1.error); assert.equal(r1.data!.code, "WAITING");
  const r2 = await readyCupMatch(db.client, b, { slug, round, slot, deckId: decks.get(b) });
  assert.ok(r2.ok, r2.error); assert.equal(r2.data!.code, "STARTED");
  return { game: r2.data!.gameMatchId as string, a, b };
}

test("CUP-S1 · hub: fases por fecha (servidor), borrador invisible, no listado solo en «mis torneos», archivo paginado", async () => {
  const db = world(4);
  cupRow(db, { slug: "abierta" });
  cupRow(db, { slug: "pronto", registration_open_at: iso(NOW + 3_600_000), registration_close_at: iso(NOW + 7_200_000), starts_at: iso(NOW + 9_000_000) });
  cupRow(db, { slug: "borrador", status: "DRAFT", published_at: null });
  const hidden = cupRow(db, { slug: "oculta", visibility: "UNLISTED" });
  for (let i = 0; i < 12; i++) cupRow(db, { slug: `vieja-${i}`, status: "COMPLETED", started_at: iso(NOW - 9e7), completed_at: iso(NOW - 8e7 + i), bracket_size: 4, rounds: 2, updated_at: iso(NOW - 8e7 + i) });
  await registerCup(db.client, U(1), "oculta", true);
  const anon = (await getCupHub(db.client, null, { now: NOW })).data!;
  assert.deepEqual(anon.open.map((c) => c.slug), ["abierta"]);
  assert.deepEqual(anon.upcoming.map((c) => c.slug), ["pronto"]);
  assert.ok(![...anon.open, ...anon.upcoming, ...anon.live, ...anon.finished].some((c) => c.slug === "borrador" || c.slug === "oculta"), "ni borrador ni no listado en público");
  assert.equal(anon.finished.length, 10); assert.equal(anon.finishedHasMore, true);
  assert.equal(anon.mine, null); assert.equal(anon.history, null);
  const page2 = (await getCupHub(db.client, null, { now: NOW, offset: 10 })).data!;
  assert.equal(page2.finished.length, 2); assert.equal(page2.finishedHasMore, false);
  const me = (await getCupHub(db.client, U(1), { now: NOW })).data!;
  assert.ok(me.mine!.some((c) => c.slug === "oculta" && c.mine === "REGISTERED"), "mi torneo no listado sí aparece en «mis torneos»");
  assert.equal((await getCupDetail(db.client, null, "borrador")).status, 404, "un borrador no existe fuera del panel");
  assert.equal((await getCupDetail(db.client, U(2), "oculta")).status, 200, "no listado = accesible por enlace");
  void hidden;
});

test("CUP-S2 · inscripción exactamente una vez: 20 clics, dos pestañas y reintentos → UNA fila, contador +1", async () => {
  const db = world(4);
  const id = cupRow(db, { slug: "una-vez" });
  const rs = await Promise.all(Array.from({ length: 20 }, () => registerCup(db.client, U(1), "una-vez", true)));
  assert.ok(rs.every((r) => r.ok));
  assert.deepEqual([...new Set(rs.map((r) => r.data!.code))].sort(), ["ALREADY_REGISTERED", "REGISTERED"]);
  assert.equal(rs.filter((r) => r.data!.code === "REGISTERED").length, 1);
  assert.equal(db.table("cup_registrations").filter((r) => r.cup_id === id).length, 1);
  assert.equal(db.table("cups").find((c) => c.id === id)!.participant_count, 1);
  // Retirarse y volver: la MISMA fila, sin duplicar; 20 «inscribir ‖ retirar» acaban en un estado canónico.
  await Promise.all(Array.from({ length: 20 }, (_, i) => registerCup(db.client, U(1), "una-vez", i % 2 === 0)));
  const c = db.table("cups").find((x) => x.id === id)!;
  assert.equal(c.participant_count, db.table("cup_registrations").filter((r) => r.cup_id === id && r.status === "REGISTERED").length);
  assert.equal(db.table("cup_registrations").filter((r) => r.cup_id === id).length, 1);
});

test("CUP-S3 · capacidad: 63/64 y 20 a la vez → exactamente 64 (1 dentro, 19 «Torneo completo»)", async () => {
  const db = world(84);
  const id = cupRow(db, { slug: "llena", max_participants: 64 });
  for (let i = 1; i <= 63; i++) assert.ok((await registerCup(db.client, U(i), "llena", true)).ok);
  const rs = await Promise.all(Array.from({ length: 20 }, (_, k) => registerCup(db.client, U(64 + k), "llena", true)));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.ok(rs.filter((r) => !r.ok).every((r) => r.status === 409 && r.code === "FULL" && r.error === "Torneo completo"));
  assert.equal(db.table("cups").find((c) => c.id === id)!.participant_count, 64);
  const d = (await getCupDetail(db.client, U(84), "llena", { now: NOW })).data!;
  assert.equal(d.me!.canRegister, false, "lleno: la ficha ya no ofrece inscribirse");
});

test("CUP-S4 · retirarse solo con la inscripción abierta; sancionado no se inscribe; códigos traducidos", async () => {
  const db = world(6);
  const id = cupRow(db, { slug: "retirada" });
  assert.equal((await registerCup(db.client, U(1), "retirada", true)).data!.code, "REGISTERED");
  assert.equal((await registerCup(db.client, U(1), "retirada", false)).data!.code, "WITHDRAWN");
  db.table("user_sanctions").push({ user_id: U(2), type: "ban", expires_at: null, revoked_at: null });
  const s = await registerCup(db.client, U(2), "retirada", true);
  assert.equal(s.status, 403); assert.equal(s.code, "SANCTIONED");
  await registerCup(db.client, U(3), "retirada", true);
  close(db, id);
  const w = await registerCup(db.client, U(3), "retirada", false);
  assert.equal(w.status, 409); assert.equal(w.code, "CLOSED");
  assert.equal((await registerCup(db.client, U(4), "retirada", true)).code, "CLOSED");
  assert.equal((await registerCup(db.client, U(4), "no-existe", true)).status, 404);
});

test("CUP-S5 · cuadro perezoso: tras el cierre, 20 lecturas a la vez → UN cuadro (7 cruces de 8), auditado como sistema", async () => {
  const db = world(8);
  const id = cupRow(db, { slug: "perezosa" });
  for (let i = 1; i <= 6; i++) await registerCup(db.client, U(i), "perezosa", true);
  close(db, id);
  await Promise.all(Array.from({ length: 20 }, (_, i) => getCupDetail(db.client, i % 2 ? null : U(1), "perezosa")));
  assert.equal(db.table("cup_matches").filter((m) => m.cup_id === id).length, 7);
  assert.equal(db.table("content_audit_log").filter((a) => a.action === "cup_bracket_generated" && a.entity_id === id).length, 1);
  assert.equal(db.table("content_audit_log").find((a) => a.action === "cup_bracket_generated")!.actor, null);
  const d = (await getCupDetail(db.client, U(1), "perezosa")).data!;
  assert.equal(d.card.phase, "IN_PROGRESS");
  assert.deepEqual(d.bracket!.map((r) => r.name), ["Cuartos de final", "Semifinal", "Final"]);
  assert.equal(d.bracket![0].matches.filter((m) => m.state === "BYE").length, 2, "6 en cuadro de 8: 2 pases directos");
  // Los pases directos son de los seeds 1 y 2 (mejor rating) y ya están en semifinales.
  assert.deepEqual(d.bracket![0].matches.filter((m) => m.state === "BYE").map((m) => (m.a ?? m.b)!.seed).sort(), [1, 2]);
  // Seeds por rating ranked: U(1) es el mejor.
  assert.equal(d.participants[0].username, "jugador_1"); assert.equal(d.participants[0].seed, 1);
});

test("CUP-S6 · privacidad: el cuadro público no lleva ids de usuario ni correos; solo MI cruce trae el id de mi rival", async () => {
  const db = world(4);
  const id = cupRow(db, { slug: "privada" });
  for (let i = 1; i <= 4; i++) await registerCup(db.client, U(i), "privada", true);
  close(db, id);
  const anon = JSON.stringify((await getCupDetail(db.client, null, "privada")).data);
  assert.ok(!/c0000000-0000-4000-8000-/.test(anon), "sin ids de usuario en público");
  assert.ok(!anon.includes("@example.com"), "sin correos");
  assert.ok(anon.includes(`"tag":"${TAG(1)}"`), "identidad pública: #TAG");
  const mine = (await getCupDetail(db.client, U(1), "privada")).data!;
  const ids = JSON.stringify(mine).match(/c0000000-0000-4000-8000-\d{12}/g) ?? [];
  assert.deepEqual([...new Set(ids)], [mine.me!.match!.opponent!.userId], "el único id es el de MI rival (enlace a su perfil)");
  assert.equal(mine.me!.match!.opponent!.username === "jugador_1", false);
  assert.ok(mine.bracket![0].matches.some((m) => m.you), "mi cruce marcado por el servidor");
});

test("CUP-S7 · torneo de 4 de punta a punta con el MOTOR: listo → una partida PVP_PRIVATE, resultado del motor, avance, final, campeón y trofeo; aislado de ranked, misiones y social", async () => {
  const db = world(4);
  const decks = new Map([1, 2, 3, 4].map((i) => [U(i), giveDeck(db, U(i), i - 1)]));
  const ratingsBefore = JSON.stringify(db.table("duel_pvp_ratings"));
  const id = cupRow(db, { slug: "copa-e2e" });
  for (let i = 1; i <= 4; i++) await registerCup(db.client, U(i), "copa-e2e", true);
  close(db, id);
  await getCupDetail(db.client, null, "copa-e2e");
  openAllWindows(db, id);

  // Semifinal 1: «listo» del primero espera; el segundo arranca UNA partida; repetir no crea otra.
  const s1 = await startMatch(db, "copa-e2e", id, 1, 0, decks);
  const again = await readyCupMatch(db.client, s1.a, { slug: "copa-e2e", round: 1, slot: 0, deckId: decks.get(s1.a) });
  assert.equal(again.data!.code, "STARTED"); assert.equal(again.data!.gameMatchId, s1.game, "misma partida");
  const game = db.table("duel_matches").find((d) => d.id === s1.game)!;
  assert.equal(game.mode, "PVP_PRIVATE", "motor canónico, modo sin rating");
  assert.equal(db.table("duel_matches").filter((d) => d.mode === "PVP_PRIVATE").length, 1, "exactamente una partida por cruce");
  assert.equal(matchAt(db, id, 1, 0).status, "ACTIVE");
  const live = (await getCupDetail(db.client, null, "copa-e2e")).data!;
  assert.equal(live.bracket![0].matches[0].state, "ACTIVE", "EN JUEGO para todos");

  // La partida se juega entera; al terminar, el gancho de duelsPvp lleva el resultado DEL MOTOR al cuadro.
  await playOut(db, s1.game, s1.a, s1.b);
  const done1 = db.table("duel_matches").find((d) => d.id === s1.game)!;
  const m1 = matchAt(db, id, 1, 0);
  if (done1.status === "COMPLETED" && done1.winner) {
    const expect = done1.winner === "A" ? done1.user_id : done1.player_b_id;
    assert.equal(m1.status, "COMPLETED"); assert.equal(m1.winner_id, expect, "el ganador es el del motor");
    assert.equal(matchAt(db, id, 2, 0).player_a, expect, "avanza a la final");
    assert.ok(typeof m1.score_a === "number" && typeof m1.score_b === "number", "marcador real del motor");
  } else {
    assert.equal(m1.status, "ACTION_REQUIRED", "sin ganador canónico → retenido");
    await resolveCupMatch(db.client, ADMIN, { id, round: 1, slot: 0, decision: "A", reason: "Empate exacto: decide la organización", confirm: `#${TAG(Number(String(m1.player_a).slice(-2)))}` });
  }
  // 20 liquidaciones más del mismo resultado: nada cambia.
  const snap = JSON.stringify(db.table("cup_matches"));
  for (let i = 0; i < 20; i++) await db.client.rpc("cup_settle_game", { p_game: s1.game });
  assert.equal(JSON.stringify(db.table("cup_matches")), snap, "una sola propagación");

  // Semifinal 2 y final.
  const s2 = await startMatch(db, "copa-e2e", id, 1, 1, decks);
  await playOut(db, s2.game, s2.a, s2.b);
  for (const slot of [0, 1]) {
    const m = matchAt(db, id, 1, slot);
    if (m.status === "ACTION_REQUIRED") await resolveCupMatch(db.client, ADMIN, { id, round: 1, slot, decision: "B", reason: "Empate exacto: decide la organización", confirm: `#${(db.table("profiles").find((p) => p.id === m.player_b)!.public_tag)}` });
  }
  const fin = matchAt(db, id, 2, 0);
  assert.equal(fin.status, "READY", "la final solo con los dos finalistas FINALES");
  const sf = await startMatch(db, "copa-e2e", id, 2, 0, decks);
  await playOut(db, sf.game, sf.a, sf.b);
  if (matchAt(db, id, 2, 0).status === "ACTION_REQUIRED") await resolveCupMatch(db.client, ADMIN, { id, round: 2, slot: 0, decision: "A", reason: "Final empatada: decide la organización", confirm: `#${(db.table("profiles").find((p) => p.id === fin.player_a)!.public_tag)}` });
  const cup = db.table("cups").find((c) => c.id === id)!;
  assert.equal(cup.status, "COMPLETED");
  const champ = cup.champion_id as string;
  assert.equal(champ, matchAt(db, id, 2, 0).winner_id, "campeón = ganador de la final, derivado del cuadro");
  assert.deepEqual(db.table("user_cosmetics").filter((x) => x.cosmetic_id === "insignia:torneo:copa-e2e").map((x) => x.user_id), [champ], "UN trofeo, del campeón");
  assert.deepEqual(db.table("cup_registrations").filter((r) => r.cup_id === id).map((r) => r.placement).sort(), ["CHAMPION", "RUNNER_UP", "SEMIFINAL", "SEMIFINAL"]);

  // Sala de Trofeos: el trofeo con referencia real (torneo + fecha), tipo TOURNAMENT.
  db.tables.collection_sets = [];
  const room = (await getTrophyRoom(db.client, champ)).data!;
  const trophy = room.badges.unlocked.find((b) => b.id === "insignia:torneo:copa-e2e")!;
  assert.equal(trophy.kind, "TOURNAMENT"); assert.equal(trophy.label, "Campeón · Copa copa-e2e"); assert.match(trophy.caption, /^Torneo · /);
  assert.equal(room.totals.collectionBadges, 0, "no cuenta como insignia de colección");

  // Aislamiento: rating intacto, 0 eventos de rating, 0 misiones; Social no cuenta los cruces de torneo.
  assert.equal(JSON.stringify(db.table("duel_pvp_ratings")), ratingsBefore, "rating, colocación y pico intactos");
  assert.equal(db.table("duel_pvp_rating_events").length, 0, "ni Top 500 ni tope de parejas ni récord competitivo");
  assert.equal(db.table("mission_events").length, 0, "sin misiones F73");
  const info = (await getPrivateMatchInfo(db.client, sf.a, sf.game)).data!;
  const { outcome, nextRoundName, ...where } = info.cup!;
  assert.deepEqual(where, { slug: "copa-e2e", name: "Copa copa-e2e", round: 2, roundName: "Final" });
  // F86.1 · la arena dice qué significó el cruce para quien mira, ya liquidado: campeón o eliminado (final), sin siguiente ronda.
  assert.equal(outcome, sf.a === champ ? "CHAMPION" : "ELIMINATED"); assert.equal(nextRoundName, null);
  assert.equal(info.h2h.total.matches, 0, "el cara a cara social no cuenta partidas de torneo");
  assert.equal(db.table("duel_friendships").length, 0, "nadie se hace amigo por jugar un torneo");
  const sp = (await getSocialPlayer(db.client, sf.a, sf.b)).data!;
  assert.equal(sp.recentPrivate.length, 0, "ni «duelos privados recientes»");

  // La ficha final: campeón para todos y celebración solo para él.
  const pub = (await getCupDetail(db.client, null, "copa-e2e")).data!;
  assert.equal(pub.card.phase, "COMPLETED"); assert.ok(pub.card.champion && !pub.card.champion.you);
  assert.equal((await getCupDetail(db.client, champ, "copa-e2e")).data!.card.champion!.you, true);
  const hub = (await getCupHub(db.client, champ)).data!;
  assert.equal(hub.history!.titles, 1); assert.equal(hub.history!.best, "CHAMPION");
});

test("CUP-S8 · abandono: gana quien se queda (cierre canónico del motor), resolución ABANDON", async () => {
  const db = world(4);
  const decks = new Map([1, 2, 3, 4].map((i) => [U(i), giveDeck(db, U(i), i - 1)]));
  const id = cupRow(db, { slug: "abandono" });
  for (let i = 1; i <= 4; i++) await registerCup(db.client, U(i), "abandono", true);
  close(db, id); await getCupDetail(db.client, null, "abandono"); openAllWindows(db, id);
  const s = await startMatch(db, "abandono", id, 1, 0, decks);
  assert.ok((await abandonPvpMatch(db.client, s.a, s.game)).ok);
  const m = matchAt(db, id, 1, 0);
  assert.equal(m.winner_id, s.b); assert.equal(m.resolution, "ABANDON");
  assert.equal(db.table("duel_pvp_rating_events").length, 0, "abandonar un cruce de torneo no toca el rating");
});

test("CUP-S9 · retenido (empate) y plazo vencido: nadie avanza solo; el admin resuelve con el #TAG exacto; doble no presentado = pase directo aguas abajo", async () => {
  const db = world(8);
  const id = cupRow(db, { slug: "revision" });
  for (let i = 1; i <= 8; i++) await registerCup(db.client, U(i), "revision", true);
  close(db, id); await getCupDetail(db.client, null, "revision");
  // Simula una partida que terminó en EMPATE (el motor lo permite en reglas antiguas): retenido.
  const m0 = matchAt(db, id, 1, 0);
  const game = randomUUID();
  Object.assign(m0, { game_match_id: game, status: "ACTIVE" });
  db.table("duel_matches").push({ id: game, mode: "PVP_PRIVATE", user_id: m0.player_a, player_b_id: m0.player_b, status: "DRAW", winner: null, closed_reason: null, closed_by: null, state: {} });
  assert.equal(((await db.client.rpc("cup_settle_game", { p_game: game })).data as Row).code, "HELD");
  assert.equal(matchAt(db, id, 2, 0).player_a, null, "la semifinal no recibe a nadie");
  const d = (await getCupDetail(db.client, U(1), "revision")).data!;
  assert.equal(d.bracket![0].matches[0].state, "ACTION_REQUIRED");
  const bTag = db.table("profiles").find((p) => p.id === m0.player_b)!.public_tag as string;
  const aTag = db.table("profiles").find((p) => p.id === m0.player_a)!.public_tag as string;
  assert.equal((await resolveCupMatch(db.client, ADMIN, { id, round: 1, slot: 0, decision: "B", reason: "corto", confirm: `#${bTag}` })).ok, false, "motivo obligatorio");
  const wrong = await resolveCupMatch(db.client, ADMIN, { id, round: 1, slot: 0, decision: "B", reason: "Empate exacto: decide la organización", confirm: `#${aTag}` });
  assert.equal(wrong.ok, false); if (!wrong.ok) assert.match(wrong.error, /confirmación no coincide/);
  const notAdmin = await resolveCupMatch(db.client, U(5), { id, round: 1, slot: 0, decision: "B", reason: "Empate exacto: decide la organización", confirm: `#${bTag}` });
  assert.equal(notAdmin.ok, false); if (!notAdmin.ok) assert.equal(notAdmin.status, 403);
  assert.ok((await resolveCupMatch(db.client, ADMIN, { id, round: 1, slot: 0, decision: "B", reason: "Empate exacto: decide la organización", confirm: bTag.toLowerCase() })).ok, "#TAG sin «#» y en minúsculas también vale");
  assert.equal(matchAt(db, id, 2, 0).player_a, m0.player_b);
  assert.equal(db.table("content_audit_log").filter((a) => a.action === "cup_match_resolved").length, 1);

  // Plazo vencido sin partida: «listo» ya no vale; nadie gana por tiempo; el admin elimina a los dos.
  const m1 = matchAt(db, id, 1, 1);
  Object.assign(m1, { available_at: iso(NOW - 7_200_000), deadline_at: iso(Date.now() - 1000) });
  const late = await readyCupMatch(db.client, m1.player_a as string, { slug: "revision", round: 1, slot: 1, deckId: randomUUID() });
  assert.equal(late.ok, false);
  assert.equal(matchAt(db, id, 1, 1).winner_id, null, "jamás un ganador por sorteo o por tiempo");
  assert.equal((await getCupDetail(db.client, null, "revision")).data!.bracket![0].matches[1].state, "NO_SHOW_PENDING");
  assert.ok((await resolveCupMatch(db.client, ADMIN, { id, round: 1, slot: 1, decision: "NONE", reason: "Ninguno de los dos se presentó", confirm: "ELIMINAR A LOS DOS" })).ok);
  assert.equal(matchAt(db, id, 1, 1).status, "VOID");
  const semi = matchAt(db, id, 2, 0);
  assert.equal(semi.status, "BYE", "el que ya esperaba en semifinal pasa por pase directo administrativo");
  assert.equal(semi.winner_id, m0.player_b);
  assert.equal(matchAt(db, id, 3, 0).player_a, m0.player_b, "y llega a la final sin romper el árbol");
});

test("CUP-S10 · cancelar EN CURSO: exige el identificador, cancela lo pendiente, conserva lo jugado, sin campeón ni trofeo", async () => {
  const db = world(4);
  const id = cupRow(db, { slug: "cancelada" });
  for (let i = 1; i <= 4; i++) await registerCup(db.client, U(i), "cancelada", true);
  close(db, id); await getCupDetail(db.client, null, "cancelada");
  const bad = await cancelCup(db.client, ADMIN, id, "Problema grave con el servidor", "otra");
  assert.equal(bad.ok, false);
  const ok = await cancelCup(db.client, ADMIN, id, "Problema grave con el servidor", "cancelada");
  assert.ok(ok.ok);
  assert.equal(db.table("cups").find((c) => c.id === id)!.status, "CANCELLED");
  assert.ok(db.table("cup_matches").filter((m) => m.cup_id === id).every((m) => m.status === "CANCELLED"));
  assert.equal(db.table("user_cosmetics").length, 0);
  const d = (await getCupDetail(db.client, null, "cancelada")).data!;
  assert.equal(d.card.phase, "CANCELLED"); assert.equal(d.cancelled!.reason, "La organización canceló el torneo.");
  assert.equal((await registerCup(db.client, U(4), "cancelada", true)).code, "CANCELLED");
});

test("CUP-S11 · panel: borrador validado, publicado solo admite texto, publicar con versión, el no-admin no publica", async () => {
  const db = world(2);
  const bad = await createCup(db.client, ADMIN, { slug: "x", name: "a", rules: "", registrationOpenAt: "ayer", registrationCloseAt: "", startsAt: "", minParticipants: 8, maxParticipants: 4, roundWindowMinutes: 1, visibility: "PUBLIC" });
  assert.equal(bad.ok, false);
  const fields = { slug: "valorosters-open-1", name: "Valorosters Open #1", description: "Primer torneo oficial.", rules: "Eliminación directa a partida única.", registrationOpenAt: iso(NOW + 86_400_000), registrationCloseAt: iso(NOW + 3 * 86_400_000), startsAt: iso(NOW + 3 * 86_400_000 + 3_600_000), minParticipants: 4, maxParticipants: 64, roundWindowMinutes: 1440, visibility: "PUBLIC" };
  const c = await createCup(db.client, ADMIN, fields);
  assert.ok(c.ok); if (!c.ok) return;
  const row = db.table("cups").find((x) => x.id === c.data.id)!;
  // El servicio no escribe estado ni fechas de sistema: los pone la BD por defecto (DRAFT, versión 0) y la guardia de
  // 0069 rechaza nacer publicado. El doble en memoria no aplica DEFAULT: se completan aquí como lo haría Postgres.
  assert.ok(!("status" in row) && !("published_at" in row) && !("participant_count" in row), "crear NUNCA publica ni toca columnas de sistema");
  const cid = randomUUID();
  Object.assign(row, { id: cid, status: "DRAFT", version: 0, participant_count: 0, published_at: null, started_at: null, completed_at: null, cancelled_at: null, champion_id: null, visibility: "PUBLIC" });
  assert.equal(db.table("content_audit_log").filter((a) => a.action === "cup_draft_created").length, 1);
  // Slug único: lo impone `cups.slug UNIQUE` (23505 → 409 «Ya existe un torneo con ese identificador»); ensayo de 0069.
  const stale = await publishCup(db.client, ADMIN, cid, 999);
  assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.status, 409, "versión vieja = 409");
  const notAdmin = await publishCup(db.client, U(1), cid, row.version as number);
  assert.equal(notAdmin.ok, false); if (!notAdmin.ok) assert.equal(notAdmin.status, 403);
  // (un RPC que falla deshace su transacción en el doble y recrea las filas: se relee la fila, como haría la app)
  const cur = () => db.table("cups").find((x) => x.id === cid)!;
  assert.ok((await publishCup(db.client, ADMIN, cid, cur().version as number)).ok);
  assert.equal(cur().status, "PUBLISHED");
  const locked = await updateCup(db.client, ADMIN, cid, cur().version, { maxParticipants: 32 });
  assert.equal(locked.ok, false); if (!locked.ok) assert.match(locked.error, /solo se corrige texto/);
  assert.ok((await updateCup(db.client, ADMIN, cid, cur().version, { description: "Primer torneo oficial (corregido)." })).ok, "el texto sí");
  assert.equal(cur().description, "Primer torneo oficial (corregido).");
});

test("CUP-S12 · jugar: equipo ajeno 404, en cola ranked 409, indicador del menú solo con mi cruce listo", async () => {
  const db = world(4);
  const decks = new Map([1, 2, 3, 4].map((i) => [U(i), giveDeck(db, U(i), i - 1)]));
  const id = cupRow(db, { slug: "jugar" });
  for (let i = 1; i <= 4; i++) await registerCup(db.client, U(i), "jugar", true);
  close(db, id); await getCupDetail(db.client, null, "jugar"); openAllWindows(db, id);
  const m = matchAt(db, id, 1, 0);
  const a = m.player_a as string, b = m.player_b as string;
  const other = await readyCupMatch(db.client, a, { slug: "jugar", round: 1, slot: 0, deckId: decks.get(b) });
  assert.equal(other.status, 404, "el equipo de otro no existe para mí");
  db.table("duel_pvp_queue").push({ user_id: a, state: "QUEUED", expires_at: iso(Date.now() + 60_000) });
  const q = await readyCupMatch(db.client, a, { slug: "jugar", round: 1, slot: 0, deckId: decks.get(a) });
  assert.equal(q.code, "IN_QUEUE");
  db.tables.duel_pvp_queue = [];
  assert.equal((await getCupBadge(db.client, a)).data!.ready, 1);
  const outsider = (await readyCupMatch(db.client, b, { slug: "jugar", round: 1, slot: 1, deckId: decks.get(b) }));
  assert.equal(outsider.status, 404, "no puedo marcarme listo en un cruce ajeno");
});
