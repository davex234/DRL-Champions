/**
 * F86.1 · ESPERA DEL RIVAL, ESTADO LIGERO Y CARRERAS — servicio real (`cups.ts`, `duelsPvp.ts`) sobre MemSupabase + el
 * espejo de las RPC de 0069. La BD real (Postgres, 20 a la vez) se prueba en el ensayo de 0069 y en la QA de producción.
 *
 *   · estado ligero a lo largo de un cruce: sin rival → rival asignado → A listo → B ve «rival listo» → los dos → partida
 *     → resultado → el ganador espera rival / juega el siguiente → final → campeón; plazo vencido y revisión
 *   · nivel de sondeo que decide el servidor (hot / warm / idle / cold) y su coste (1 lectura sin torneos)
 *   · carreras: 20× listo A, 20× listo B, 20× A+B a la vez, 20 descubrimientos, 20 liquidaciones, 20 de la final
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { MemSupabase, type Row } from "./testing/memSupabase";
import { installCupRpcs } from "./testing/cupRpcMirror";
import { getCupStatus, getCupDetail, registerCup, readyCupMatch, cupPollTier } from "./cups";
import { abandonPvpMatch } from "./duelsPvp";
import { getPlayerHistory } from "./playerIdentity";

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const U = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let seq = 0;
const uid = () => `ffff0000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

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

/** Torneo de 4 en curso (cuadro generado, ventanas abiertas) con equipos legales. */
async function cup4() {
  const db = new MemSupabase();
  installCupRpcs(db);
  db.tables.profiles = [{ id: U(999), username: "organizador", avatar: "🛡", is_admin: true, public_tag: "ADM2345" }];
  for (let i = 1; i <= 5; i++) db.tables.profiles.push({ id: U(i), username: `jugador_${i}`, avatar: "🎮", is_admin: false, public_tag: `TAG${i}${"ABC"[i % 3]}2${i}` });
  db.tables.duel_pvp_ratings = [1, 2, 3, 4].map((i) => ({ user_id: U(i), rating: 1400 - i * 25, games_played: 12, wins: 6, losses: 6, draws: 0, updated_at: iso(0) }));
  for (const t of ["cup_registrations", "cup_matches", "duel_matches", "duel_match_actions", "user_cosmetics", "content_audit_log", "duel_pvp_rating_events", "mission_events", "user_sanctions", "duel_pvp_queue", "duel_challenges", "duel_friendships", "social_blocks"]) db.tables[t] ??= [];
  const decks = new Map([1, 2, 3, 4].map((i) => [U(i), giveDeck(db, U(i), i - 1)]));
  const id = randomUUID();
  db.tables.cups = [{ id, slug: "f861", name: "Copa F86.1", description: "", rules: "Eliminación directa.", format: "SINGLE_ELIMINATION", seeding_policy: "RATING_SNAPSHOT", visibility: "UNLISTED", status: "PUBLISHED",
    registration_open_at: iso(NOW - 3_600_000), registration_close_at: iso(NOW + 3_600_000), starts_at: iso(NOW + 3_600_000), round_window_minutes: 60, min_participants: 4, max_participants: 8, participant_count: 0,
    bracket_size: null, rounds: null, rules_version: 1, published_at: iso(NOW - 7_200_000), started_at: null, completed_at: null, cancelled_at: null, cancel_reason: null, champion_id: null, version: 1, created_at: iso(0), updated_at: iso(0) }];
  for (let i = 1; i <= 4; i++) await registerCup(db.client, U(i), "f861", true);
  const c = db.table("cups")[0];
  Object.assign(c, { registration_open_at: iso(NOW - 7_200_000), registration_close_at: iso(Date.now() - 1000), starts_at: iso(Date.now() - 1000) });
  await getCupDetail(db.client, null, "f861");
  for (const m of db.table("cup_matches")) Object.assign(m, { available_at: iso(NOW - 60_000), deadline_at: iso(Date.now() + 3_600_000) });
  const at = (round: number, slot: number) => db.table("cup_matches").find((m) => m.round === round && m.slot === slot)!;
  return { db, id, decks, at };
}
const st = async (db: MemSupabase, u: string) => (await getCupStatus(db.client, u)).data!;

test("F861-S1 · estado ligero a lo largo de un cruce (motor real): rival → A listo → B ve «rival listo» → partida → ganador espera rival → siguiente jugable", async () => {
  const { db, decks, at } = await cup4();
  const m = at(1, 0); const A = m.player_a as string, B = m.player_b as string;
  let sa = await st(db, A);
  assert.equal(sa.match!.state, "READY"); assert.equal(sa.tier, "warm", "cruce jugable, nadie listo → 5 s");
  assert.equal(sa.match!.opponent!.username.startsWith("jugador_"), true); assert.match(sa.match!.opponent!.tag ?? "", /^TAG/);
  assert.equal(sa.ready, 1);
  // A pulsa JUGAR → esperando: el servidor lo recuerda (sobrevive a F5) y el nivel pasa a «hot» (3 s).
  assert.equal((await readyCupMatch(db.client, A, { slug: "f861", round: 1, slot: 0, deckId: decks.get(A) })).data!.code, "WAITING");
  sa = await st(db, A);
  assert.equal(sa.match!.youReady, true); assert.equal(sa.tier, "hot");
  const sb = await st(db, B);
  assert.equal(sb.match!.opponentReady, true, "B ve que su rival le espera"); assert.equal(sb.tier, "hot");
  const detailA = (await getCupDetail(db.client, A, "f861")).data!;
  assert.equal(detailA.me!.match!.youReady, true, "F5: la ficha dice «estás listo» (del servidor, no de estado local)");
  // B listo → UNA partida; A la DESCUBRE por el estado ligero sin volver a pulsar.
  const r = await readyCupMatch(db.client, B, { slug: "f861", round: 1, slot: 0, deckId: decks.get(B) });
  assert.equal(r.data!.code, "STARTED");
  sa = await st(db, A);
  assert.equal(sa.match!.state, "ACTIVE"); assert.equal(sa.match!.gameMatchId, r.data!.gameMatchId, "A descubre la partida exacta de su cruce");
  assert.equal(sa.tier, "idle", "en juego: la arena manda, el sondeo se relaja");
  // Resultado del motor (abandono de B) → A avanza; su rival saldrá del otro cruce (aún sin empezar → idle; en juego → warm).
  assert.ok((await abandonPvpMatch(db.client, B, r.data!.gameMatchId!)).ok);
  sa = await st(db, A);
  assert.equal(sa.match!.round, 2); assert.equal(sa.match!.state, "PENDING"); assert.equal(sa.match!.opponent, null);
  assert.equal(sa.match!.rivalSource, "READY"); assert.equal(sa.tier, "idle");
  const dA = (await getCupDetail(db.client, A, "f861")).data!.me!.match!;
  assert.equal(dA.advancedFrom, "Semifinal", "«Has ganado Semifinal»"); assert.equal(dA.rivalSource, "READY");
  assert.equal((await st(db, B)).match, null, "B eliminado: sin cruce vivo → frío (60 s)"); assert.equal((await st(db, B)).tier, "cold");
  // El otro cruce empieza → mi próximo rival se decide AHORA → warm.
  const m2 = at(1, 1); const C = m2.player_a as string, D = m2.player_b as string;
  await readyCupMatch(db.client, C, { slug: "f861", round: 1, slot: 1, deckId: decks.get(C) });
  const g2 = (await readyCupMatch(db.client, D, { slug: "f861", round: 1, slot: 1, deckId: decks.get(D) })).data!.gameMatchId!;
  sa = await st(db, A);
  assert.equal(sa.match!.rivalSource, "ACTIVE"); assert.equal(sa.tier, "warm", "tu rival se decide ahora: 5 s");
  await abandonPvpMatch(db.client, C, g2);
  sa = await st(db, A);
  assert.equal(sa.match!.state, "READY"); assert.equal(sa.match!.opponent!.username, (db.table("profiles").find((p) => p.id === D)!.username));
  assert.equal(sa.tier, "warm", "la final ya es jugable");
});

test("F861-S2 · plazo vencido y revisión: deja de decir «esperando»; nadie gana solo; nivel tranquilo", async () => {
  const { db, decks, at } = await cup4();
  const m = at(1, 0); const A = m.player_a as string;
  await readyCupMatch(db.client, A, { slug: "f861", round: 1, slot: 0, deckId: decks.get(A) });
  Object.assign(at(1, 0), { available_at: iso(NOW - 7_200_000), deadline_at: iso(Date.now() - 1000) });
  const s = await st(db, A);
  assert.equal(s.match!.state, "NO_SHOW_PENDING"); assert.equal(s.tier, "idle");
  const again = await readyCupMatch(db.client, A, { slug: "f861", round: 1, slot: 0, deckId: decks.get(A) });
  assert.equal(again.code, "DEADLINE_PASSED"); assert.equal(at(1, 0).winner_id, null);
  // Empate exacto → revisión.
  const m1 = at(1, 1);
  Object.assign(m1, { status: "ACTION_REQUIRED" });
  assert.equal((await st(db, m1.player_a as string)).match!.state, "ACTION_REQUIRED");
  assert.equal((await st(db, m1.player_a as string)).tier, "idle");
});

test("F861-S3 · coste: fuera de torneos el estado es UNA lectura; con cruce, ≤ 5 lecturas pequeñas (nunca el cuadro)", async () => {
  const { db, at } = await cup4();
  db.reads = 0; await st(db, U(5)); assert.equal(db.reads, 1, "sin cruces: 1 consulta");
  const A = at(1, 0).player_a as string;
  db.reads = 0; await st(db, A); assert.ok(db.reads <= 5, `${db.reads} lecturas`);
  db.reads = 0; await getCupDetail(db.client, A, "f861"); const detailReads = db.reads;
  assert.ok(detailReads >= 3, "la ficha (cuadro + inscritos + perfiles) es la lectura cara; el sondeo no la usa");
  assert.equal(cupPollTier(null), "cold");
});

test("F861-S4 · carreras (20×): listo A, listo B, A+B a la vez, descubrimiento, liquidación y final → 1 estado, 1 partida, 1 avance, 1 campeón, 1 trofeo", async () => {
  const { db, decks, at } = await cup4();
  const m = at(1, 0); const A = m.player_a as string, B = m.player_b as string;
  const ra = await Promise.all(Array.from({ length: 20 }, () => readyCupMatch(db.client, A, { slug: "f861", round: 1, slot: 0, deckId: decks.get(A) })));
  assert.ok(ra.every((r) => r.data?.code === "WAITING"), "20× listo A = un único «listo» lógico (sin partida)");
  assert.equal(db.table("duel_matches").length, 0);
  const rb = await Promise.all(Array.from({ length: 20 }, () => readyCupMatch(db.client, B, { slug: "f861", round: 1, slot: 0, deckId: decks.get(B) })));
  const games = new Set(rb.map((r) => r.data?.gameMatchId));
  assert.equal(games.size, 1, "20× listo B → UNA partida"); assert.equal(db.table("duel_matches").length, 1);
  assert.ok(rb.every((r) => r.data?.code === "STARTED"));
  // A+B a la vez (20 de cada uno) en el otro cruce.
  const m2 = at(1, 1); const C = m2.player_a as string, D = m2.player_b as string;
  const both = await Promise.all(Array.from({ length: 40 }, (_, i) => readyCupMatch(db.client, i % 2 ? C : D, { slug: "f861", round: 1, slot: 1, deckId: decks.get(i % 2 ? C : D) })));
  const g2 = new Set(both.map((r) => r.data?.gameMatchId).filter(Boolean));
  assert.equal(g2.size, 1, "A+B a la vez → 1 partida"); assert.equal(db.table("duel_matches").length, 2);
  const created = db.table("duel_matches").find((d) => d.id === [...g2][0])!;
  assert.deepEqual([created.user_id, created.player_b_id].sort(), [C, D].sort(), "mismos participantes, mismo cruce");
  // 20 descubrimientos: todos ven la misma partida.
  const seen = await Promise.all(Array.from({ length: 20 }, () => st(db, A)));
  assert.ok(seen.every((s) => s.match?.gameMatchId === [...games][0]));
  // 20 liquidaciones del mismo resultado → 1 avance.
  await abandonPvpMatch(db.client, B, [...games][0]!);
  const snap = JSON.stringify(db.table("cup_matches"));
  await Promise.all(Array.from({ length: 20 }, () => db.client.rpc("cup_settle_game", { p_game: [...games][0] })));
  assert.equal(JSON.stringify(db.table("cup_matches")), snap, "1 avance");
  await abandonPvpMatch(db.client, C, [...g2][0]!);
  // Final: 20 liquidaciones → 1 campeón, 1 trofeo.
  const f = at(2, 0);
  await readyCupMatch(db.client, f.player_a as string, { slug: "f861", round: 2, slot: 0, deckId: decks.get(f.player_a as string) });
  const gf = (await readyCupMatch(db.client, f.player_b as string, { slug: "f861", round: 2, slot: 0, deckId: decks.get(f.player_b as string) })).data!.gameMatchId!;
  await abandonPvpMatch(db.client, f.player_b as string, gf);
  await Promise.all(Array.from({ length: 20 }, () => db.client.rpc("cup_settle_game", { p_game: gf })));
  const cup = db.table("cups")[0];
  assert.equal(cup.status, "COMPLETED"); assert.equal(cup.champion_id, f.player_a);
  assert.equal(db.table("user_cosmetics").filter((x: Row) => x.cosmetic_id === "insignia:torneo:f861").length, 1, "1 trofeo");
  assert.equal((await st(db, f.player_a as string)).tier, "cold", "campeón: sin cruces vivos");
  assert.equal(db.table("duel_pvp_rating_events").length, 0); assert.equal(db.table("mission_events").length, 0);
});

test("F861-S5 · carrera del perfil: un cruce de torneo es TOURNAMENT (categoría propia), nunca «Duelo privado»; ajeno no lo ve", async () => {
  const { db, decks, at } = await cup4();
  const m = at(1, 0); const A = m.player_a as string, B = m.player_b as string;
  await readyCupMatch(db.client, A, { slug: "f861", round: 1, slot: 0, deckId: decks.get(A) });
  const g = (await readyCupMatch(db.client, B, { slug: "f861", round: 1, slot: 0, deckId: decks.get(B) })).data!.gameMatchId!;
  await abandonPvpMatch(db.client, B, g);
  // Un amistoso real entre los mismos dos, para comprobar que NO se mezclan.
  db.table("duel_matches").push({ id: randomUUID(), mode: "PVP_PRIVATE", user_id: A, player_b_id: B, status: "COMPLETED", winner: "A", closed_reason: null, closed_by: null, closed_at: null, updated_at: iso(NOW), difficulty: "NORMAL", state: {} });
  const own = (await getPlayerHistory(db.client, A, A, null)).data!;
  const kinds = own.items.map((i) => i.mode).sort();
  assert.deepEqual(kinds, ["PRIVATE", "TOURNAMENT"], "uno de cada, sin mezclar");
  assert.equal(own.items.find((i) => i.mode === "TOURNAMENT")!.modeLabel, "Torneo");
  assert.equal(own.items.find((i) => i.mode === "TOURNAMENT")!.opponent.kind, "PLAYER");
  const pub = (await getPlayerHistory(db.client, B, A, null)).data!;
  assert.ok(!pub.items.some((i) => i.mode === "TOURNAMENT" || i.mode === "PRIVATE"), "la carrera pública no lleva privados ni torneos (la historia pública vive en /copas)");
});
