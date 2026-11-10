/**
 * F76 · RANKED QUEUE HARDENING — la cola nunca presenta una partida TERMINADA como «tu partida».
 *
 * Servicio REAL (`duelsMatchmaking` + `duelsPvp`: crear, jugar, abandonar) sobre MemSupabase, con las funciones SQL de la
 * cola (0032/0033) reproducidas aquí con su semántica exacta: índice único parcial de búsqueda viva, guarda de partida
 * activa, `status` = entrada viva o, si no hay, la ÚLTIMA conocida (eso es lo que dejaba el MATCHED muerto a la vista),
 * cancelación condicionada y reserva/confirmación de pareja. Cada RPC de MemSupabase es atómica (una transacción).
 *
 * El estado roto NO se limpia antes de probar: se CONSTRUYE (A y B emparejan, la partida termina, la entrada sigue
 * MATCHED) y se comprueba que el servidor lo trata bien. Contra el servicio anterior estas pruebas fallan (ver informe).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { matchedEntryVerdict } from "@/domain/cardgame/matchmaking";
import { lifecycleFromStatus, isTerminal } from "@/domain/cardgame/pvp";
import { readFileSync } from "node:fs";
import { MemSupabase } from "./testing/memSupabase";
import { enqueue, status, cancel, attemptMatch } from "./duelsMatchmaking";
import { abandonPvpMatch, syncPvpMatch } from "./duelsPvp";

type Row = Record<string, any>;
const ms = (iso: string | null) => (iso === null ? null : Date.parse(iso));

/** Las funciones de cola de 0032/0033, con la misma semántica. Solo lo que el servicio llama. */
class QueueDb extends MemSupabase {
  clock = Date.parse("2026-10-01T10:00:00Z");
  private tick(): string { this.clock += 1000; return new Date(this.clock).toISOString(); }
  private q(): Row[] { return this.table("duel_pvp_queue"); }
  private touch(r: Row, patch: Row) { Object.assign(r, patch, { updated_at: this.tick() }); }
  private entry(r: Row) {
    return { entryId: r.id, userId: r.user_id, deckId: r.deck_id, state: r.state, ratingSnapshot: r.rating_snapshot,
      matchId: r.state === "MATCHED" ? r.match_id : null, reason: r.closed_reason,
      createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), expiresAt: ms(r.expires_at), matchedAt: ms(r.matched_at) };
  }
  private hasActive(user: string): boolean {
    return (this.table("duel_matches") as Row[]).some((m) => ["PVP", "PVP_PRIVATE"].includes(m.mode) && (m.closed_reason ?? null) === null
      && ["WAITING", "IN_PROGRESS"].includes(m.status) && (m.user_id === user || m.player_b_id === user));
  }
  private sweep() {
    for (const r of this.q()) if (r.state === "QUEUED" && Date.parse(r.expires_at) <= this.clock) this.touch(r, { state: "EXPIRED", closed_reason: "EXPIRED" });
  }
  private live(user: string) { return this.q().find((r) => r.user_id === user && (r.state === "QUEUED" || r.state === "PAIRING")); }
  private latest(user: string) { return this.q().filter((r) => r.user_id === user).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]; }

  rpc_duel_pvp_enqueue(a: Row) {
    this.sweep();
    if (!this.table("duel_decks").some((d) => d.id === a.p_deck && d.user_id === a.p_user)) return { code: "DECK_NOT_OWNED" };
    if (this.hasActive(a.p_user)) return { code: "ACTIVE_MATCH" };
    const cur = this.live(a.p_user); // índice único parcial: la segunda alta viola la unicidad
    if (cur) return { code: "ALREADY_QUEUED", entry: this.entry(cur) };
    const at = this.tick();
    const r = { id: randomUUID(), user_id: a.p_user, deck_id: a.p_deck, state: "QUEUED", rating_snapshot: 1000, pair_token: null, pairing_expires_at: null,
      match_id: null, matched_at: null, closed_reason: null, created_at: at, updated_at: at, expires_at: new Date(this.clock + a.p_ttl_seconds * 1000).toISOString() };
    this.q().push(r);
    return { code: "OK", entry: this.entry(r) };
  }
  rpc_duel_pvp_status(a: Row) {
    this.sweep();
    const v = this.live(a.p_user) ?? this.latest(a.p_user);
    if (!v) return { code: "IDLE" };
    const position = v.state === "QUEUED" ? this.q().filter((r) => r.state === "QUEUED" && r.created_at < v.created_at).length : null;
    return { code: "OK", entry: this.entry(v), position };
  }
  rpc_duel_pvp_cancel(a: Row) {
    this.sweep();
    const v = this.q().find((r) => r.user_id === a.p_user && r.state === "QUEUED");
    if (v) { this.touch(v, { state: "CANCELLED", closed_reason: "USER" }); return { code: "OK", entry: this.entry(v) }; }
    const p = this.q().find((r) => r.user_id === a.p_user && r.state === "PAIRING");
    if (p) return { code: "PAIRING", entry: this.entry(p) };
    const l = this.latest(a.p_user);
    return l ? { code: "NOT_QUEUED", entry: this.entry(l) } : { code: "NOT_QUEUED" };
  }
  rpc_duel_pvp_claim_pair() {
    this.sweep();
    const cand = this.q().filter((r) => r.state === "QUEUED" && Date.parse(r.expires_at) > this.clock && !this.hasActive(r.user_id))
      .sort((x, y) => (x.created_at < y.created_at ? -1 : 1)).slice(0, 2);
    if (cand.length < 2 || cand[0].user_id === cand[1].user_id) return { code: "NO_CANDIDATES" };
    const token = randomUUID(), matchId = randomUUID();
    for (const r of cand) this.touch(r, { state: "PAIRING", pair_token: token, match_id: matchId });
    const side = (r: Row) => ({ entryId: r.id, userId: r.user_id, deckId: r.deck_id });
    return { code: "PAIRED", pairToken: token, matchId, a: side(cand[0]), b: side(cand[1]) };
  }
  rpc_duel_pvp_commit_pair(a: Row) {
    if (!this.table("duel_matches").some((m) => m.id === a.p_match && m.mode === "PVP")) return { code: "NO_MATCH_ROW" };
    const rows = this.q().filter((r) => r.pair_token === a.p_token && r.state === "PAIRING" && r.match_id === a.p_match);
    if (rows.length !== 2) return { code: "STALE_TOKEN", updated: rows.length };
    for (const r of rows) this.touch(r, { state: "MATCHED", matched_at: new Date(this.clock).toISOString(), pair_token: null });
    return { code: "OK" };
  }
  rpc_duel_pvp_release_pair(a: Row) {
    for (const r of this.q().filter((x) => x.pair_token === a.p_token && x.state === "PAIRING")) this.touch(r, { state: "QUEUED", pair_token: null, match_id: null });
    return { code: "OK" };
  }
}

let seq = 0;
const uid = () => `f7600000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const A = "aaaaaaaa-0000-4000-8000-0000000f76aa", B = "bbbbbbbb-0000-4000-8000-0000000f76bb", C = "cccccccc-0000-4000-8000-0000000f76cc";

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
      db.table("user_cards").push({ uid: u, user_id: user, card_id: c.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() });
      team.push(u);
    }
  }
  const id = randomUUID(); const at = new Date(0).toISOString();
  db.table("duel_decks").push({ id, user_id: user, name: "Equipo", card_uids: team, created_at: at, updated_at: at });
  return id;
}

function world() {
  const db = new QueueDb();
  return { db, deck: { [A]: giveDeck(db, A, 0), [B]: giveDeck(db, B, 3), [C]: giveDeck(db, C, 6) } as Record<string, string> };
}
const ok = <T>(r: { ok: boolean; data?: T; error?: string; status: number }): T => { assert.ok(r.ok, `${r.status} ${r.error}`); return r.data as T; };

/** A y B entran, emparejan y la partida termina (abandono de A). Deja EXACTAMENTE el estado del bug. */
async function finishedPair() {
  const w = world();
  ok(await enqueue(w.db.client, A, w.deck[A]));
  const eb = ok(await enqueue(w.db.client, B, w.deck[B]));
  const matchId = eb.entry?.matchId;
  assert.ok(eb.entry?.state === "MATCHED" && matchId, "A + B emparejan");
  ok(await abandonPvpMatch(w.db.client, A, matchId));
  const m = (w.db.table("duel_matches") as Row[]).find((x) => x.id === matchId)!;
  assert.ok(isTerminal(lifecycleFromStatus(m.status, m.closed_reason)), "la partida es terminal");
  // El estado roto, construido a propósito: las dos entradas siguen MATCHED apuntando a la partida terminada.
  assert.deepEqual(w.db.table("duel_pvp_queue").map((r) => [r.state, r.match_id]), [["MATCHED", matchId], ["MATCHED", matchId]]);
  assert.equal(w.db.table("duel_pvp_queue").filter((r) => r.state === "QUEUED" || r.state === "PAIRING").length, 0);
  return { ...w, matchId };
}
const liveRows = (db: MemSupabase, u: string) => db.table("duel_pvp_queue").filter((r) => r.user_id === u && (r.state === "QUEUED" || r.state === "PAIRING"));

test("F76 · 1 · REGRESIÓN PRINCIPAL: MATCHED → partida terminal NO se presenta; JUGAR entra en una cola nueva y empareja", async () => {
  const { db, deck, matchId } = await finishedPair();
  // El modelo SQL sigue devolviendo la última conocida (MATCHED muerto): es lo que llegaba antes al cliente.
  const raw = (await db.client.rpc("duel_pvp_status", { p_user: A })).data as Row;
  assert.equal(raw.entry.state, "MATCHED"); assert.equal(raw.entry.matchId, matchId);

  const st = ok(await status(db.client, A));
  assert.equal(st.entry, null, "el servidor NO devuelve la entrada MATCHED muerta");
  assert.equal(st.code, "IDLE");
  assert.ok(!JSON.stringify(st).includes(matchId), "el matchId terminal no viaja");

  const again = ok(await enqueue(db.client, A, deck[A]));
  assert.equal(again.code, "OK"); assert.equal(again.entry?.state, "QUEUED", "búsqueda NUEVA, no la partida vieja");
  assert.equal(liveRows(db, A).length, 1);
  // La fila MATCHED histórica no se toca (sigue siendo la historia de aquella búsqueda).
  assert.equal(db.table("duel_pvp_queue").filter((r) => r.match_id === matchId && r.state === "MATCHED").length, 2);

  const eb = ok(await enqueue(db.client, B, deck[B]));
  assert.equal(eb.entry?.state, "MATCHED", "el emparejamiento continúa con normalidad");
  assert.notEqual(eb.entry?.matchId, matchId, "partida NUEVA");
  const ea = ok(await status(db.client, A));
  assert.equal(ea.entry?.matchId, eb.entry?.matchId, "A ve la partida nueva");
});

test("F76 · 2 · terminal por FINISHED (COMPLETED), por EXPIRED o partida inexistente: misma regla", async () => {
  for (const kind of ["COMPLETED", "EXPIRED", "MISSING"] as const) {
    const w = world();
    ok(await enqueue(w.db.client, A, w.deck[A]));
    const mid = ok(await enqueue(w.db.client, B, w.deck[B])).entry!.matchId!;
    const m = w.db.table("duel_matches").find((x) => x.id === mid)!;
    if (kind === "COMPLETED") m.status = "COMPLETED";
    if (kind === "EXPIRED") m.closed_reason = "EXPIRED";
    if (kind === "MISSING") w.db.tables.duel_matches = w.db.table("duel_matches").filter((x) => x.id !== mid);
    for (const u of [A, B]) {
      const st = ok(await status(w.db.client, u));
      assert.equal(st.entry, null, `${kind}: no se presenta`);
      const c = ok(await cancel(w.db.client, u));
      assert.equal(c.code, "NOT_QUEUED"); assert.equal(c.entry, null, `${kind}: cancel tampoco la devuelve`);
    }
  }
});

test("F76 · 3 · CONTROL POSITIVO: MATCHED con partida VIVA se recupera exactamente (F5 / volver a JUGAR)", async () => {
  const w = world();
  ok(await enqueue(w.db.client, A, w.deck[A]));
  const mid = ok(await enqueue(w.db.client, B, w.deck[B])).entry!.matchId!;
  for (let i = 0; i < 3; i++) {
    const st = ok(await status(w.db.client, A)); // F5
    assert.equal(st.entry?.state, "MATCHED"); assert.equal(st.entry?.matchId, mid);
  }
  // Volver a pulsar JUGAR: 409 ACTIVE_MATCH (contrato), pero con la partida viva adjunta para retomarla.
  const r = await enqueue(w.db.client, A, w.deck[A]);
  assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.code, "ACTIVE_MATCH");
  assert.equal(r.data?.entry?.state, "MATCHED"); assert.equal(r.data?.entry?.matchId, mid, "se retoma ESA partida");
  assert.equal(w.db.table("duel_matches").length, 1, "no se crea otra partida");
  assert.equal(liveRows(w.db, A).length, 0, "ni otra búsqueda");
  const s = await syncPvpMatch(w.db.client, A, mid);
  assert.ok(s.ok, "reconectar a la partida viva funciona");
});

test("F76 · 4 · DOS USUARIOS: emparejan, terminan, vuelven: no recuperan la vieja y emparejan de nuevo", async () => {
  const { db, deck, matchId } = await finishedPair();
  const [ra, rb] = await Promise.all([enqueue(db.client, A, deck[A]), enqueue(db.client, B, deck[B])]);
  ok(ra); ok(rb);
  const [sa, sb] = [ok(await status(db.client, A)), ok(await status(db.client, B))];
  assert.equal(sa.entry?.state, "MATCHED"); assert.equal(sb.entry?.state, "MATCHED");
  assert.equal(sa.entry?.matchId, sb.entry?.matchId, "los dos en la MISMA partida nueva");
  assert.notEqual(sa.entry?.matchId, matchId);
  assert.equal(db.table("duel_matches").length, 2, "exactamente una partida nueva");
});

test("F76 · 5 · 10× JUGAR simultáneo con MATCHED muerto: UNA búsqueda; 10× cancelar: coherente; volver a JUGAR: funciona", async () => {
  const { db, deck } = await finishedPair();
  const joins = await Promise.all(Array.from({ length: 10 }, () => enqueue(db.client, A, deck[A])));
  assert.ok(joins.every((j) => j.ok), "ninguna alta falla");
  const ids = new Set(joins.map((j) => j.data!.entry!.entryId));
  assert.equal(ids.size, 1, "las 10 respuestas describen LA MISMA búsqueda");
  assert.equal(joins.filter((j) => j.data!.code === "OK").length, 1, "una alta; nueve ALREADY_QUEUED");
  assert.equal(liveRows(db, A).length, 1, "una fila viva");

  const cancels = await Promise.all(Array.from({ length: 10 }, () => cancel(db.client, A)));
  assert.equal(cancels.filter((c) => c.data!.code === "OK").length, 1, "se cancela una vez");
  assert.ok(cancels.every((c) => c.data!.entry === null || c.data!.entry.state !== "MATCHED"), "ningún cancel devuelve la partida muerta");
  assert.equal(liveRows(db, A).length, 0);

  const back = ok(await enqueue(db.client, A, deck[A]));
  assert.equal(back.code, "OK"); assert.equal(liveRows(db, A).length, 1);
});

test("F76 · 6 · CARRERAS: termina mientras vuelve a JUGAR; cancel contra emparejador; reconectar mientras termina", async () => {
  // a) la partida termina EXACTAMENTE mientras el jugador vuelve a JUGAR: o 409 con la viva, o cola nueva. Nunca la muerta.
  {
    const w = world();
    ok(await enqueue(w.db.client, A, w.deck[A]));
    const mid = ok(await enqueue(w.db.client, B, w.deck[B])).entry!.matchId!;
    const [j, ab] = await Promise.all([enqueue(w.db.client, A, w.deck[A]), abandonPvpMatch(w.db.client, B, mid)]);
    ok(ab);
    if (j.ok) assert.equal(j.data!.entry?.state, "QUEUED");
    else { assert.equal(j.code, "ACTIVE_MATCH"); assert.ok(!j.data?.entry || j.data.entry.matchId === mid); }
    const st = ok(await status(w.db.client, A));
    assert.ok(st.entry === null || st.entry.state === "QUEUED", "después: nunca la partida terminada");
    assert.ok(liveRows(w.db, A).length <= 1);
  }
  // b) cancelar contra el emparejador: o cancela o empareja; nunca las dos cosas, nunca dos partidas.
  {
    const w = world();
    ok(await enqueue(w.db.client, A, w.deck[A]));
    const rowB = (await w.db.client.rpc("duel_pvp_enqueue", { p_user: B, p_deck: w.deck[B], p_ttl_seconds: 600 })).data as Row;
    assert.equal(rowB.code, "OK");
    const [c, m] = await Promise.all([cancel(w.db.client, A), attemptMatch(w.db.client)]);
    ok(c);
    const a = w.db.table("duel_pvp_queue").find((r) => r.user_id === A)!;
    assert.ok(a.state === "CANCELLED" || a.state === "MATCHED", `estado final coherente: ${a.state}`);
    assert.equal(c.data!.code === "OK", a.state === "CANCELLED", "cancel dice OK si y solo si ganó");
    assert.ok(w.db.table("duel_matches").length <= 1, "como mucho una partida");
    if (m) assert.equal(a.state, "MATCHED");
  }
  // c) reconectar (status) mientras termina: o la viva o nada; jamás una terminal presentada como viva.
  {
    const w = world();
    ok(await enqueue(w.db.client, A, w.deck[A]));
    const mid = ok(await enqueue(w.db.client, B, w.deck[B])).entry!.matchId!;
    const [st, ab] = await Promise.all([status(w.db.client, A), abandonPvpMatch(w.db.client, A, mid)]);
    ok(ab);
    const v = ok(st);
    if (v.entry) assert.equal(v.entry.matchId, mid, "si se vio, era la viva en ese instante");
    assert.equal(ok(await status(w.db.client, A)).entry, null, "terminada: ya no se presenta");
  }
});

test("F76 · 7 · SEGURIDAD: el otro no ve, no cancela ni recupera la cola/partida ajena", async () => {
  const w = world();
  ok(await enqueue(w.db.client, A, w.deck[A]));
  const mid = ok(await enqueue(w.db.client, B, w.deck[B])).entry!.matchId!;
  const sc = ok(await status(w.db.client, C));
  assert.equal(sc.entry, null, "C no ve la partida de A/B");
  const cc = ok(await cancel(w.db.client, C));
  assert.equal(cc.entry, null);
  assert.ok(w.db.table("duel_pvp_queue").every((r) => r.state === "MATCHED"), "las entradas de A/B intactas");
  // Una entrada MATCHED cuyo match_id apunta a una partida en la que el usuario NO juega no se presenta (asociación inválida).
  const ac = ok(await enqueue(w.db.client, C, w.deck[C]));
  const rowC = w.db.table("duel_pvp_queue").find((r) => r.id === ac.entry!.entryId)!;
  Object.assign(rowC, { state: "MATCHED", match_id: mid, updated_at: new Date(w.db.clock + 99_000).toISOString() });
  assert.equal(ok(await status(w.db.client, C)).entry, null, "C no recupera la partida de A/B aunque su fila la nombre");
  assert.equal(matchedEntryVerdict(C, mid, w.db.table("duel_matches").find((x) => x.id === mid) as any), "STALE");
});

test("F76 · 8 · UNA definición de «viva»: la TS canónica coincide con la guarda SQL (0048) en todas las combinaciones", () => {
  const sql = readFileSync("supabase/migrations/0048_social_friends_private_duels.sql", "utf8");
  assert.match(sql, /m\.closed_reason is null\s+and m\.status in \('WAITING','IN_PROGRESS'\)/, "guarda SQL vigente");
  for (const status of ["WAITING", "IN_PROGRESS", "COMPLETED", "DRAW", "UNRESOLVED"]) {
    for (const closed of [null, "ABANDONED", "EXPIRED"]) {
      const sqlActive = closed === null && (status === "WAITING" || status === "IN_PROGRESS");
      assert.equal(!isTerminal(lifecycleFromStatus(status, closed)), sqlActive, `${status}/${closed}`);
      const v = matchedEntryVerdict(A, "m", { id: "m", mode: "PVP", user_id: A, player_b_id: B, status, closed_reason: closed });
      assert.equal(v === "LIVE", sqlActive, `veredicto ${status}/${closed}`);
    }
  }
  assert.equal(matchedEntryVerdict(A, "m", { id: "m", mode: "PVP_PRIVATE", user_id: A, player_b_id: B, status: "IN_PROGRESS", closed_reason: null }), "STALE", "la cola ranked nunca resucita un privado");
  assert.equal(matchedEntryVerdict(A, null, null), "STALE");
  // Las pantallas leen la MISMA definición (sin listas locales de terminales).
  const page = readFileSync("src/app/duelos/pvp/page.tsx", "utf8");
  assert.ok(page.includes("isTerminal(lifecycle as PvpLifecycle)") && !/new Set\(\["FINISHED"/.test(page));
  assert.ok(readFileSync("src/lib/duel/autoSearch.ts", "utf8").includes("!isTerminal("));
});

test("F76 · 9 · el cliente: un sondeo viejo no pisa una alta/cancelación más reciente, y el 409 con la viva se retoma", () => {
  const hook = readFileSync("src/lib/duel/usePvpQueue.ts", "utf8");
  assert.match(hook, /const mia = epoca\.current;[\s\S]*if \(!vivo\.current \|\| mia !== epoca\.current\) return;/, "sondeo descartado si hubo escritura después");
  assert.match(hook, /const mia = \+\+epoca\.current;/, "enqueue abre época");
  assert.match(hook, /\+\+epoca\.current;\s*try \{/, "cancel abre época");
  assert.match(hook, /res\.status === 409 && body\.code === "ACTIVE_MATCH" && body\.entry\?\.state === "MATCHED"/);
  const svc = readFileSync("src/server/services/duelsMatchmaking.ts", "utf8");
  for (const call of ['"duel_pvp_status", { p_user: userId }), "IDLE")', '"duel_pvp_cancel", { p_user: userId }), "NOT_QUEUED")']) assert.ok(svc.includes(call), call);
});
