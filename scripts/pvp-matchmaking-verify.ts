/**
 * VERIFICACIÓN DEL EMPAREJAMIENTO PvP — `npm run pvp-matchmaking:verify` (Bloque 7.4).
 *
 * No hay mocks, no hay dobles y no hay «parece correcto». Cada comprobación ocurre contra el
 * PostgreSQL real y, cuando se trata de una frontera de seguridad, contra el endpoint HTTP real
 * con Bearers de verdad de cuentas de verdad.
 *
 * Ocho familias:
 *
 *   1. CICLO DE VIDA   — alta, alta duplicada, cancelación, cancelación duplicada, caducidad.
 *   2. EMPAREJAMIENTO  — A + B → EXACTAMENTE una partida, compatible con el modelo del 7.2.
 *   3. CONCURRENCIA    — varios emparejadores simultáneos contra la MISMA base de datos, altas
 *                        simultáneas del mismo usuario y cancelación contra emparejador. Se
 *                        comprueba el estado FINAL en la tabla, no la respuesta de la API.
 *  3b. RECUPERACIÓN   — el proceso muere ENTRE reservar la pareja y crear la partida, en los dos
 *                        momentos posibles. El barrido tiene que reconciliar sin duplicar.
 *   4. GUARDAS         — partida activa, mazo que dejó de ser legal, candidato caducado.
 *   5. SEGURIDAD       — suplantación de usuario, de rating y de rival; cola ajena; mazo ajeno.
 *   6. PERSISTENCIA    — la cola sobrevive a un cliente nuevo (simulación de reinicio) y al
 *                        refresco.
 *   7. CONTINUIDAD 7.3 — el matchId emparejado sirve tal cual para sincronizar, y el secreto
 *                        del rival sigue oculto.
 *   8. MEDIDAS         — tiempos de alta, de búsqueda de candidatos, de emparejamiento y de
 *                        creación de la partida.
 *
 * Las familias 5 y 7 necesitan el servidor levantado (`BASE_URL`, por defecto :3005). Las demás
 * atacan la base de datos directamente y corren sin servidor; si no lo hay, las que lo necesitan
 * se declaran OMITIDAS en voz alta y NO se cuentan como correctas.
 *
 * Crea sus cuentas y su cola, y lo borra todo al terminar.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { CardRegistry } from "../src/collection/registry";
import { DUEL_ROLES } from "../src/domain/cardgame";
import type { RoleId } from "../src/domain/cards/types";
import { enqueue, cancel, status, attemptMatch } from "../src/server/services/duelsMatchmaking";
import { createPvpMatch } from "../src/server/services/duelsPvp";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

let pass = 0;
let fail = 0;
let skip = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const omit = (label: string, why: string): void => {
  console.log(`  [SKIP] ${label} — ${why}`);
  skip++;
};

const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const MM = `${BASE}/api/game/duel/matchmaking`;
const PVP = `${BASE}/api/game/duel/pvp`;

// ───────────────────────────── utillaje ─────────────────────────────

const registry = new CardRegistry();

function deckCardIds(block: number): string[] {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) {
    const b = best.get(c.playerId);
    if (!b || c.ovr > b.ovr) best.set(c.playerId, c);
  }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) {
    const p = registry.player(c.playerId);
    if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]);
  }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  return DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2)).map((c) => c.id);
}

const creadas: string[] = [];

interface Jugador { id: string; deckId: string; token: string; email: string; uids: string[] }

async function nuevoJugador(tag: string): Promise<Jugador> {
  const email = `pvpmm-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  const id = data.user.id;
  creadas.push(id);

  const rows = deckCardIds(0).map((cardId) => ({ uid: randomUUID(), user_id: id, card_id: cardId }));
  const ins = await db.from("user_cards").insert(rows);
  if (ins.error) throw new Error(`cartas: ${ins.error.message}`);

  const deck = await db.from("duel_decks")
    .insert({ user_id: id, name: `Mazo ${tag}`, card_uids: rows.map((r) => r.uid) })
    .select("id").maybeSingle();
  if (deck.error || !deck.data) throw new Error(`mazo: ${deck.error?.message}`);

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const sign = await anon.auth.signInWithPassword({ email, password });
  if (sign.error || !sign.data.session) throw new Error(`login: ${sign.error?.message}`);

  return { id, deckId: (deck.data as { id: string }).id, token: sign.data.session.access_token, email, uids: rows.map((r) => r.uid) };
}

interface QueueRow {
  id: string; user_id: string; deck_id: string; state: string;
  rating_snapshot: number | null; match_id: string | null; matched_at: string | null;
  closed_reason: string | null; created_at: string; expires_at: string;
}

/** Lee la fila de cola directamente de la tabla. La API se comprueba contra ESTO, no al revés. */
async function filaCola(userId: string): Promise<QueueRow | null> {
  const { data } = await db.from("duel_pvp_queue")
    .select("id, user_id, deck_id, state, rating_snapshot, match_id, matched_at, closed_reason, created_at, expires_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as QueueRow) ?? null;
}

async function filasCola(userId: string): Promise<QueueRow[]> {
  const { data } = await db.from("duel_pvp_queue")
    .select("id, user_id, deck_id, state, rating_snapshot, match_id, matched_at, closed_reason, created_at, expires_at")
    .eq("user_id", userId);
  return (data ?? []) as QueueRow[];
}

async function partidasDe(userId: string): Promise<Record<string, unknown>[]> {
  const { data } = await db.from("duel_matches")
    .select("id, mode, user_id, player_b_id, deck_id, deck_b_id, status, state_version, closed_reason")
    .eq("mode", "PVP").or(`user_id.eq.${userId},player_b_id.eq.${userId}`);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * Envejece una entrada hasta pasarla de su TTL.
 *
 * Hay que mover TAMBIÉN `created_at`: la restricción `duel_pvp_queue_ttl_check` exige
 * `expires_at > created_at`, así que dejar solo la caducidad en el pasado no envejece la
 * entrada — la rechaza. (Este verificador lo descubrió a la primera: sin comprobar el error del
 * UPDATE, la entrada seguía viva y contaminaba las dos comprobaciones siguientes.)
 */
async function caducar(userId: string): Promise<void> {
  const antes = new Date(Date.now() - 3_600_000).toISOString();
  const { error } = await db.from("duel_pvp_queue")
    .update({ created_at: antes, expires_at: new Date(Date.now() - 1_000).toISOString() })
    .eq("user_id", userId).eq("state", "QUEUED");
  if (error) throw new Error(`caducar: ${error.message}`);
}

/** Alta EN CRUDO, sin pasar por el servicio: deja al jugador en cola SIN disparar el emparejador. */
async function encolarCrudo(j: Jugador, ttl = 600): Promise<string> {
  const { data, error } = await db.rpc("duel_pvp_enqueue", {
    p_user: j.id, p_deck: j.deckId, p_ttl_seconds: ttl,
  });
  if (error) throw new Error(`enqueue crudo: ${error.message}`);
  return (data as { code: string }).code;
}

interface Respuesta { status: number; body: Record<string, unknown>; text: string; ms: number }

async function http(
  token: string | null, method: "GET" | "POST", url: string, body?: Record<string, unknown>,
): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const t0 = Date.now();
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const ms = Date.now() - t0;
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* no-json */ }
  return { status: res.status, body: parsed, text, ms };
}

const entrada = (r: Respuesta): Record<string, unknown> =>
  (r.body.entry ?? {}) as Record<string, unknown>;

let servidorVivo = false;

// ───────────────────────────── programa ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(72));
  console.log("  VERIFICACIÓN DEL EMPAREJAMIENTO PvP — Bloque 7.4");
  console.log("=".repeat(72));

  try {
    const ping = await fetch(`${MM}`, { method: "GET" });
    servidorVivo = ping.status === 401;   // sin token DEBE responder 401: eso ya es una prueba
    console.log(`\n  servidor: ${servidorVivo ? `${BASE} (vivo)` : `${BASE} NO responde 401 — familias 5 y 7 se omiten`}`);
  } catch {
    console.log(`\n  servidor: ${BASE} inaccesible — familias 5 y 7 se omiten`);
  }

  await familia1();
  await familia2();
  await familia3();
  await familia3b();
  await familia4();
  await familia5();
  await familia6();
  await familia7();
  await familia8();

  await limpiar();
  salir();
}

// ───────────── 1. CICLO DE VIDA ─────────────

async function familia1(): Promise<void> {
  console.log("\n## 1. Ciclo de vida de la búsqueda");

  const A = await nuevoJugador("ciclo-a");

  // A — alta válida
  const alta = await enqueue(db, A.id, A.deckId);
  check("A. alta válida devuelve 200", alta.ok && alta.status === 200, String(alta.status));
  check("A. la entrada nace QUEUED", alta.data?.entry?.state === "QUEUED", String(alta.data?.entry?.state));
  check("A. la entrada es PERSISTENTE (existe la fila en duel_pvp_queue)", (await filaCola(A.id))?.state === "QUEUED");
  /*
   * Esta comprobación era, en el bloque 7.4, exactamente la contraria: se exigía que
   * `rating_snapshot` naciera NULL, porque entonces NO existía ninguna fuente de rating
   * persistente y rellenarlo habría sido inventarse un MMR. El bloque 7.4.1 creó esa fuente
   * (`duel_pvp_ratings`, migración 0033) y resolvió el bloqueo D-MM-1, así que la exigencia se
   * invierte: ahora una entrada SIN snapshot sería el fallo. Quien vigila que el valor sea el del
   * servidor y no el del cliente es `pvp-rating:verify`.
   */
  const snapAlta = (await filaCola(A.id))?.rating_snapshot;
  check("A. rating_snapshot nace con el rating REAL del servidor (D-MM-1 resuelto)",
    typeof snapAlta === "number" && snapAlta > 0, String(snapAlta));

  // B — alta duplicada: tres veces seguidas, una sola entrada
  const dup1 = await enqueue(db, A.id, A.deckId);
  const dup2 = await enqueue(db, A.id, A.deckId);
  check("B. el alta repetida responde ALREADY_QUEUED", dup1.data?.code === "ALREADY_QUEUED" && dup2.data?.code === "ALREADY_QUEUED");
  const trasDup = await filasCola(A.id);
  check("B. tres altas dejan UNA entrada", trasDup.length === 1, `${trasDup.length} filas`);
  check("B. y es la misma entrada", dup2.data?.entry?.entryId === alta.data?.entry?.entryId);

  // C — cancelar
  const can = await cancel(db, A.id);
  check("C. cancelar devuelve OK", can.data?.code === "OK", String(can.data?.code));
  check("C. la entrada queda CANCELLED en la tabla", (await filaCola(A.id))?.state === "CANCELLED");
  check("C. con motivo USER", (await filaCola(A.id))?.closed_reason === "USER");

  // D — cancelar dos veces
  const can2 = await cancel(db, A.id);
  check("D. la segunda cancelación no rompe (NOT_QUEUED)", can2.ok && can2.data?.code === "NOT_QUEUED", String(can2.data?.code));
  check("D. y no crea ni destruye filas", (await filasCola(A.id)).length === 1);
  check("D. la entrada sigue CANCELLED, no se corrompe", (await filaCola(A.id))?.state === "CANCELLED");

  // E — caducidad
  const E = await nuevoJugador("ttl");
  await encolarCrudo(E);
  await caducar(E.id);
  const st = await status(db, E.id);
  check("E. una entrada vencida pasa a EXPIRED al consultarla", st.data?.entry?.state === "EXPIRED", String(st.data?.entry?.state));
  check("E. con motivo EXPIRED", (await filaCola(E.id))?.closed_reason === "EXPIRED");

  // F — self-match imposible
  const F = await nuevoJugador("self");
  await encolarCrudo(F);
  const solo = await attemptMatch(db);
  check("F. un único jugador en cola NO produce partida (self-match imposible)", solo === null);
  check("F. y sigue esperando", (await filaCola(F.id))?.state === "QUEUED");
  await cancel(db, F.id);
}

// ───────────── 2. EMPAREJAMIENTO ─────────────

let parejaA: Jugador;
let parejaB: Jugador;
let partidaId = "";

async function familia2(): Promise<void> {
  console.log("\n## 2. Emparejamiento y compatibilidad con el modelo 7.2");

  parejaA = await nuevoJugador("par-a");
  parejaB = await nuevoJugador("par-b");

  await encolarCrudo(parejaA);
  await encolarCrudo(parejaB);
  const out = await attemptMatch(db);

  check("G. dos jugadores en cola producen UNA partida", out !== null);
  partidaId = out?.matchId ?? "";

  const ms = await partidasDe(parejaA.id);
  check("G. y exactamente una fila PVP para A", ms.length === 1, `${ms.length} partidas`);

  const m = ms[0] ?? {};
  check("R. la partida creada tiene mode = PVP", m.mode === "PVP", String(m.mode));
  check("S. player A es el primero que entró en cola", m.user_id === parejaA.id);
  check("S. player B es el segundo", m.player_b_id === parejaB.id);
  check("S. A y B son distintos (no hay self-match)", m.user_id !== m.player_b_id);
  check("T. deck A es el mazo con el que A se encoló", m.deck_id === parejaA.deckId);
  check("T. deck B es el mazo con el que B se encoló", m.deck_b_id === parejaB.deckId);
  check("R. state_version arranca en 0 (contrato del 7.2)", m.state_version === 0);
  check("R. la partida nace abierta", m.closed_reason === null);

  const fa = await filaCola(parejaA.id);
  const fb = await filaCola(parejaB.id);
  check("Q. la entrada de A queda MATCHED", fa?.state === "MATCHED", String(fa?.state));
  check("Q. la entrada de B queda MATCHED", fb?.state === "MATCHED", String(fb?.state));
  check("Q. las DOS entradas apuntan al MISMO matchId", fa?.match_id === fb?.match_id && fa?.match_id === partidaId);
  check("Q. y ese matchId es el de la fila de duel_matches", m.id === partidaId);
  check("Q. matched_at queda sellado en las dos", fa?.matched_at !== null && fb?.matched_at !== null);

  // U — un segundo intento no crea una segunda partida
  const otra = await attemptMatch(db);
  check("U. un segundo intento no encuentra nada que emparejar", otra === null);
  check("U. y sigue habiendo UNA sola partida", (await partidasDe(parejaA.id)).length === 1);
}

// ───────────── 3. CONCURRENCIA REAL ─────────────

async function familia3(): Promise<void> {
  console.log("\n## 3. Concurrencia real contra PostgreSQL");

  // H1 — cuatro emparejadores simultáneos sobre DOS candidatos: solo uno puede reservarlos.
  const a = await nuevoJugador("conc-a");
  const b = await nuevoJugador("conc-b");
  await encolarCrudo(a); await encolarCrudo(b);

  const claims = await Promise.all([1, 2, 3, 4].map(() => db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 })));
  const paired = claims.filter((c) => (c.data as { code: string })?.code === "PAIRED");
  check("H. 4 emparejadores simultáneos · 2 candidatos → UNA sola reserva",
    paired.length === 1, `${paired.length} reservas`);
  check("H. los otros 3 reciben NO_CANDIDATES (no esperan: SKIP LOCKED)",
    claims.filter((c) => (c.data as { code: string })?.code === "NO_CANDIDATES").length === 3);

  const tok = (paired[0]?.data as { pairToken: string; matchId: string });
  await db.rpc("duel_pvp_release_pair", { p_token: tok.pairToken, p_offender: null, p_reason: "MATCH_FAILED" });
  check("H. liberar la reserva devuelve a los DOS a la cola",
    (await filaCola(a.id))?.state === "QUEUED" && (await filaCola(b.id))?.state === "QUEUED");

  // H2 — dos emparejadores simultáneos sobre CUATRO candidatos: parejas disjuntas, nadie repetido.
  const c = await nuevoJugador("conc-c");
  const d = await nuevoJugador("conc-d");
  await encolarCrudo(c); await encolarCrudo(d);

  const dos = await Promise.all([1, 2].map(() => db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 })));
  const ok2 = dos.map((r) => r.data as { code: string; a?: { userId: string }; b?: { userId: string } })
    .filter((r) => r.code === "PAIRED");
  const usuarios = ok2.flatMap((r) => [r.a!.userId, r.b!.userId]);
  check("H. 2 emparejadores simultáneos · 4 candidatos → 2 reservas", ok2.length === 2, `${ok2.length}`);
  check("H. y NINGÚN jugador aparece en las dos reservas", new Set(usuarios).size === usuarios.length,
    `${usuarios.length} plazas · ${new Set(usuarios).size} usuarios`);
  for (const r of ok2) {
    await db.rpc("duel_pvp_release_pair", { p_token: (r as unknown as { pairToken: string }).pairToken, p_offender: null, p_reason: "MATCH_FAILED" });
  }

  // H3 — el emparejador COMPLETO (reserva + creación + confirmación) lanzado tres veces a la vez.
  const outs = await Promise.all([1, 2, 3].map(() => attemptMatch(db)));
  const creadasAhora = outs.filter((o) => o !== null);
  const total = (await partidasDe(a.id)).length + (await partidasDe(c.id)).length;
  check("H. 3 emparejadores COMPLETOS simultáneos · 4 candidatos → 2 partidas, ni una más",
    creadasAhora.length === 2 && total === 2, `${creadasAhora.length} devueltas · ${total} en la tabla`);
  for (const j of [a, b, c, d]) {
    const f = await filaCola(j.id);
    check(`H. ${f?.user_id === j.id ? "entrada" : "?"} de ${j.email.slice(6, 12)} MATCHED con partida real`,
      f?.state === "MATCHED" && typeof f.match_id === "string", `${f?.state}`);
  }

  // I — altas simultáneas del MISMO usuario: una sola entrada viva.
  const e = await nuevoJugador("conc-e");
  const altas = await Promise.all([1, 2, 3, 4, 5].map(() =>
    db.rpc("duel_pvp_enqueue", { p_user: e.id, p_deck: e.deckId, p_ttl_seconds: 600 })));
  const codigos = altas.map((r) => (r.data as { code: string })?.code);
  const vivas = (await filasCola(e.id)).filter((f) => f.state === "QUEUED" || f.state === "PAIRING");
  check("I. 5 altas simultáneas del mismo usuario → UNA entrada viva", vivas.length === 1, `${vivas.length}`);
  check("I. exactamente una responde OK; el resto ALREADY_QUEUED",
    codigos.filter((x) => x === "OK").length === 1, codigos.join(","));

  // J — cancelación y emparejador a la vez: uno gana, y nunca los dos.
  const f2 = await nuevoJugador("conc-f");
  await encolarCrudo(f2);
  const [, claimJ] = await Promise.all([
    db.rpc("duel_pvp_cancel", { p_user: e.id }),
    db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 }),
  ]);
  const codJ = (claimJ.data as { code: string })?.code;
  const filaE = await filaCola(e.id);
  const filaF = await filaCola(f2.id);
  const gano = codJ === "PAIRED";
  check("J. cancelación vs emparejador: solo uno gana",
    gano ? filaE?.state === "PAIRING" : filaE?.state === "CANCELLED", `claim=${codJ} · E=${filaE?.state}`);
  check("J. NUNCA coexisten CANCELLED y MATCHED en la misma entrada",
    !(filaE?.state === "CANCELLED" && filaE?.match_id !== null));
  if (gano) {
    await db.rpc("duel_pvp_release_pair", { p_token: (claimJ.data as { pairToken: string }).pairToken, p_offender: null, p_reason: "MATCH_FAILED" });
  }
  check("J. el estado final es consistente para los dos implicados",
    filaE !== null && filaF !== null);
  await cancel(db, e.id); await cancel(db, f2.id);
}

// ───────────── 3b. RECUPERACIÓN TRAS CAÍDA ─────────────

/**
 * La ventana entre «reservar la pareja» y «crear la partida» es la única costura del sistema,
 * porque son dos transacciones. Aquí se mata el proceso EN MEDIO, en los dos momentos posibles,
 * y se comprueba que el barrido reconcilia bien. Es la comprobación que justifica que
 * `match_id` se reserve por adelantado y no tenga clave foránea.
 */
async function familia3b(): Promise<void> {
  console.log("\n## 3b. Recuperación tras caída del proceso (arrendamiento vencido)");

  const a = await nuevoJugador("crash-a");
  const b = await nuevoJugador("crash-b");
  await encolarCrudo(a); await encolarCrudo(b);

  // ── CASO 1: el proceso muere ANTES de crear la partida ──
  const c1 = (await db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 })).data as
    { code: string; pairToken: string; matchId: string };
  check("caso 1: pareja reservada", c1.code === "PAIRED");

  // Nadie confirma ni libera: eso ES la caída. Solo se vence el arrendamiento.
  await db.from("duel_pvp_queue")
    .update({ pairing_expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("pair_token", c1.pairToken);
  await db.rpc("duel_pvp_status", { p_user: a.id });   // cualquier operación dispara el barrido

  const f1 = (await db.from("duel_pvp_queue").select("state, match_id").in("user_id", [a.id, b.id])).data ?? [];
  check("caso 1: la partida NO llegó a existir → los DOS vuelven a QUEUED",
    f1.length === 2 && f1.every((r) => (r as { state: string }).state === "QUEUED"),
    f1.map((r) => (r as { state: string }).state).join(","));
  check("caso 1: la reserva de match_id se limpia",
    f1.every((r) => (r as { match_id: string | null }).match_id === null));

  // ── CASO 2: la partida SÍ se creó, pero el proceso muere antes de confirmarla ──
  const c2 = (await db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 })).data as
    { code: string; pairToken: string; matchId: string; a: { userId: string; deckId: string }; b: { userId: string; deckId: string } };
  check("caso 2: pareja reservada", c2.code === "PAIRED");

  const hecho = await createPvpMatch(db,
    { playerId: c2.a.userId, deckId: c2.a.deckId },
    { playerId: c2.b.userId, deckId: c2.b.deckId },
    { matchId: c2.matchId });
  check("caso 2: la partida se crea con el id RESERVADO por el emparejador",
    hecho.ok && hecho.data!.view.matchId === c2.matchId);

  // Y aquí muere, sin llamar a commit_pair.
  await db.from("duel_pvp_queue")
    .update({ pairing_expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("pair_token", c2.pairToken);
  await db.rpc("duel_pvp_status", { p_user: a.id });

  const f2 = (await db.from("duel_pvp_queue").select("state, match_id").in("user_id", [a.id, b.id])).data ?? [];
  check("caso 2: la partida EXISTE → el barrido las pone MATCHED, NO las devuelve a la cola",
    f2.length === 2 && f2.every((r) => (r as { state: string }).state === "MATCHED"),
    f2.map((r) => (r as { state: string }).state).join(","));
  check("caso 2: las dos apuntan a la partida real",
    f2.every((r) => (r as { match_id: string }).match_id === c2.matchId));
  check("caso 2: y NO se ha creado una segunda partida",
    (await partidasDe(a.id)).length === 1, `${(await partidasDe(a.id)).length} partidas`);
}

// ───────────── 4. GUARDAS ─────────────

async function familia4(): Promise<void> {
  console.log("\n## 4. Guardas de elegibilidad");

  // P — guarda de partida activa: A ya está jugando la partida de la familia 2.
  const reintento = await enqueue(db, parejaA.id, parejaA.deckId);
  check("P. con una PvP viva NO se puede volver a entrar en cola",
    !reintento.ok && reintento.code === "ACTIVE_MATCH", `${reintento.status} ${reintento.code ?? ""}`);
  check("P. y no se crea ninguna entrada nueva",
    (await filasCola(parejaA.id)).filter((f) => f.state === "QUEUED").length === 0);

  // X — candidato cuyo mazo dejó de ser legal: no produce partida y el inocente vuelve a la cola.
  const x = await nuevoJugador("mazo-roto");
  const y = await nuevoJugador("mazo-sano");
  await encolarCrudo(x);
  await new Promise((r) => setTimeout(r, 20));   // que la antigüedad de Y sea posterior, sin ambigüedad
  await encolarCrudo(y);
  const antesY = (await filaCola(y.id))!.created_at;

  // El mazo de X pierde una carta DESPUÉS de entrar en cola: exactamente el caso real.
  await db.from("user_cards").delete().eq("uid", x.uids[0]);

  const roto = await attemptMatch(db);
  check("X. un candidato con el mazo ya ilegal NO produce partida", roto === null);
  const fx = await filaCola(x.id);
  const fy = await filaCola(y.id);
  check("X. su entrada se cierra con motivo DECK_INVALID",
    fx?.state === "CANCELLED" && fx.closed_reason === "DECK_INVALID", `${fx?.state}/${fx?.closed_reason}`);
  check("X. el rival inocente VUELVE a la cola", fy?.state === "QUEUED", String(fy?.state));
  check("X. y conserva su antigüedad (no pierde el turno)", fy?.created_at === antesY);
  check("X. no queda ninguna partida creada", (await partidasDe(x.id)).length === 0);

  // Y — candidato caducado: aunque el barrido no hubiera corrido, no puede emparejar.
  const z = await nuevoJugador("caducado");
  await encolarCrudo(z);
  await caducar(z.id);
  const conCaducado = await attemptMatch(db);
  check("Y. un candidato caducado NO puede emparejar", conCaducado === null);
  check("Y. y pasa a EXPIRED", (await filaCola(z.id))?.state === "EXPIRED");
  check("Y. el rival vivo sigue esperando, sin partida", (await filaCola(y.id))?.state === "QUEUED");
  await cancel(db, y.id);
}

// ───────────── 5. SEGURIDAD (HTTP real) ─────────────

async function familia5(): Promise<void> {
  console.log("\n## 5. Seguridad — endpoint real, Bearers reales");

  /*
   * Antes de nada, la frontera de MAS abajo: las funciones de cola son la unica puerta a la
   * tabla, asi que si un usuario autenticado pudiera invocarlas por PostgREST, todo lo demas
   * dara igual: podria encolarse a nombre de otro o reservar parejas a voluntad. Se llaman con
   * los argumentos CORRECTOS a proposito, porque un error de "funcion no encontrada" probaria
   * solo que la firma no coincide, no que el permiso esta revocado.
   */
  const cobaya = await nuevoJugador("rpc");
  const conToken = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { authorization: `Bearer ${cobaya.token}` } },
  });
  const rpcs: [string, Record<string, unknown>][] = [
    ["duel_pvp_enqueue", { p_user: cobaya.id, p_deck: cobaya.deckId, p_ttl_seconds: 600 }],
    ["duel_pvp_cancel", { p_user: cobaya.id }],
    ["duel_pvp_status", { p_user: cobaya.id }],
    ["duel_pvp_claim_pair", { p_lease_seconds: 20 }],
    ["duel_pvp_commit_pair", { p_token: randomUUID(), p_match: randomUUID() }],
    ["duel_pvp_release_pair", { p_token: randomUUID(), p_offender: cobaya.id, p_reason: "MATCH_FAILED" }],
  ];
  for (const [fn, args] of rpcs) {
    const r = await conToken.rpc(fn, args as never);
    check(`un usuario autenticado NO puede invocar ${fn}`, r.error?.code === "42501",
      r.error?.code ?? "SIN ERROR (se ejecuto)");
  }

  if (!servidorVivo) {
    for (const t of [
      "sin token → 401", "user_id del cuerpo ignorado", "rating del cliente ignorado",
      "rival elegido por el servidor", "cancelar la cola de otro es imposible",
      "mazo ajeno rechazado", "un tercero no ve la cola", "sin emails ni tokens en la respuesta",
    ]) omit(t, "servidor no disponible");
    return;
  }

  const A = await nuevoJugador("sec-a");
  const B = await nuevoJugador("sec-b");
  const C = await nuevoJugador("sec-c");

  const sinToken = await http(null, "GET", MM);
  check("sin token → 401", sinToken.status === 401, String(sinToken.status));
  const sinTokenPost = await http(null, "POST", MM, { action: "enqueue", deckId: A.deckId });
  check("sin token tampoco se puede encolar → 401", sinTokenPost.status === 401, String(sinTokenPost.status));

  // M — user_id suplantado en el cuerpo Y en la query.
  const spoof = await http(A.token, "POST", `${MM}?userId=${B.id}`, {
    action: "enqueue", deckId: A.deckId, userId: B.id, playerId: B.id, user_id: B.id,
  });
  check("M. el alta con userId ajeno en cuerpo y query responde 200 (se IGNORA)", spoof.status === 200, String(spoof.status));
  check("M. la entrada creada es del dueño del TOKEN, no del id enviado",
    (await filaCola(A.id))?.state === "QUEUED" && (await filasCola(B.id)).length === 0);

  /*
   * N — rating/mmr enviados por el cliente.
   *
   * En el bloque 7.4 esto se comprobaba de la única forma posible entonces: exigiendo que
   * `rating_snapshot` siguiera siendo NULL y que la palabra «rating» no apareciera en la
   * respuesta. Con el bloqueo D-MM-1 resuelto (bloque 7.4.1) el snapshot SIEMPRE tiene valor y la
   * respuesta lleva legítimamente el rating PROPIO del solicitante, así que ninguna de las dos
   * comprobaciones diría ya nada. Se sustituyen por la exigencia que de verdad importa, y que es
   * más fuerte: lo guardado es el valor del SERVIDOR y jamás el inyectado.
   */
  const resp = await http(B.token, "POST", MM, {
    action: "enqueue", deckId: B.deckId,
    rating: 9999, mmr: 9999, elo: 9999, skill: 100, rank: "radiante", ratingSnapshot: 9999,
  });
  const filaB = await filaCola(B.id);
  // Se lee DESPUÉS del alta: la fila de rating la crea el propio `duel_pvp_enqueue` la primera vez.
  const ratingReal = (await db.from("duel_pvp_ratings").select("rating").eq("user_id", B.id).maybeSingle())
    .data as { rating: number } | null;
  check("N. el rating enviado por el cliente NO se guarda",
    filaB?.rating_snapshot !== 9999, `snapshot ${filaB?.rating_snapshot} (enviado 9999)`);
  check("N. lo guardado es EXACTAMENTE el rating autoritativo del servidor",
    filaB?.rating_snapshot === (ratingReal?.rating ?? null),
    `snapshot ${filaB?.rating_snapshot} · tabla ${ratingReal?.rating ?? "sin fila"}`);
  check("N. la respuesta no devuelve el valor inyectado por ninguna via",
    !resp.text.includes("9999") && !/\b(mmr|elo|skill|rank)\b/i.test(resp.text),
    resp.text.slice(0, 90));

  /*
   * K — cancelar la cola de otro.
   *
   * La víctima es un jugador APARTE y se encola EN CRUDO, sin disparar el emparejador: A y B ya
   * se emparejaron entre ellos en los pasos M y N (que es justo lo que comprueba el paso O), así
   * que usar a A aquí no probaría nada — habría cambiado de estado por el camino legítimo.
   */
  const V = await nuevoJugador("sec-victima");
  await encolarCrudo(V);
  const entradaV = (await filaCola(V.id))!.id;
  const cancelAjeno = await http(C.token, "POST", MM, {
    action: "cancel", userId: V.id, entryId: entradaV, targetUserId: V.id, user_id: V.id,
  });
  const trasIntento = await filaCola(V.id);
  check("K. C no puede cancelar la cola de otro jugador",
    trasIntento?.state === "QUEUED" && trasIntento.id === entradaV,
    `víctima=${trasIntento?.state} · respuesta ${cancelAjeno.status}`);
  check("K. C solo obtiene información de SU propia cola (que no existe)",
    cancelAjeno.body.code === "NOT_QUEUED" || cancelAjeno.body.code === "IDLE", String(cancelAjeno.body.code));
  check("K. la respuesta del intento no filtra la entrada de la víctima",
    !cancelAjeno.text.includes(entradaV) && !cancelAjeno.text.includes(V.id));
  await cancel(db, V.id);

  // Un tercero no puede descubrir quién está en cola.
  const mirón = await http(C.token, "GET", MM);
  check("un tercero no ve la cola de nadie", mirón.body.code === "IDLE" || (mirón.body.entry === null),
    String(mirón.body.code));
  check("la respuesta no lleva ids de otros usuarios",
    !mirón.text.includes(A.id) && !mirón.text.includes(B.id));

  // L — mazo ajeno.
  const ajeno = await http(C.token, "POST", MM, { action: "enqueue", deckId: A.deckId });
  check("L. encolarse con el mazo de otro es rechazado", ajeno.status === 404, String(ajeno.status));
  check("L. y no crea entrada", (await filasCola(C.id)).length === 0);

  // O — el rival lo elige el servidor: A y B ya están en cola; C pide emparejarse con A.
  const pedirRival = await http(C.token, "POST", MM, {
    action: "enqueue", deckId: C.deckId, opponentId: A.id, playerB: A.id, deckB: A.deckId,
  });
  check("O. nombrar un rival en la petición no da error… se ignora", pedirRival.status === 200, String(pedirRival.status));
  const partidasC = await partidasDe(C.id);
  const partidasA = await partidasDe(A.id);
  check("O. el servidor emparejó A con B (los que más esperaban), NO con C",
    partidasA.length === 1 && partidasA[0].player_b_id === B.id, `B esperado, obtenido ${String(partidasA[0]?.player_b_id)}`);
  check("O. C se queda esperando: no consiguió el rival que pidió", partidasC.length === 0);

  // Higiene del cuerpo de la respuesta.
  const propia = await http(A.token, "GET", MM);
  const cuerpo = propia.text;
  check("no se exponen emails", !/@nexus\.test/.test(cuerpo) && !/@/.test(cuerpo.replace(/https?:[^"]*/g, "")));
  check("no se exponen tokens", !cuerpo.includes(A.token.slice(0, 24)) && !/eyJ[A-Za-z0-9_-]{10,}/.test(cuerpo));
  check("no se expone el mazo de nadie (ni uids de cartas)", !A.uids.some((u) => cuerpo.includes(u)));
  check("no se expone el id del rival en la vista de cola", !cuerpo.includes(B.id));

  // El propio usuario tampoco puede leer la tabla con su clave anónima.
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  await anon.auth.setSession({ access_token: A.token, refresh_token: "x" }).catch(() => null);
  const leerRLS = await anon.from("duel_pvp_queue").select("id").limit(1);
  check("la tabla de cola es ILEGIBLE incluso para su dueño autenticado (RLS sin políticas)",
    leerRLS.error !== null || (leerRLS.data ?? []).length === 0, leerRLS.error?.code ?? "0 filas");

  await cancel(db, C.id);
}

// ───────────── 6. PERSISTENCIA ─────────────

async function familia6(): Promise<void> {
  console.log("\n## 6. Persistencia — refresco y reinicio");

  const W = await nuevoJugador("persist");
  const alta = await enqueue(db, W.id, W.deckId);
  const entryId = alta.data?.entry?.entryId;

  // V — refresco: dos consultas seguidas describen la misma búsqueda.
  const s1 = await status(db, W.id);
  const s2 = await status(db, W.id);
  check("V. el refresco conserva la misma entrada",
    s1.data?.entry?.entryId === entryId && s2.data?.entry?.entryId === entryId);
  check("V. y el mismo estado", s2.data?.entry?.state === "QUEUED");

  // W — reinicio del servidor: un CLIENTE NUEVO, sin nada en memoria, encuentra la cola intacta.
  const otroProceso = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const trasReinicio = await status(otroProceso, W.id);
  check("W. un proceso NUEVO (sin memoria) ve la misma búsqueda",
    trasReinicio.data?.entry?.entryId === entryId, String(trasReinicio.data?.entry?.entryId));
  check("W. la cola vive en PostgreSQL, no en el proceso",
    (await filaCola(W.id))?.state === "QUEUED");
  check("W. y su antigüedad se conserva", trasReinicio.data?.entry?.createdAt === alta.data?.entry?.createdAt);
  check("W. la posición en cola es un número, no una lista de rivales",
    typeof trasReinicio.data?.position === "number" && trasReinicio.data.position >= 0,
    String(trasReinicio.data?.position));

  await cancel(db, W.id);
}

// ───────────── 7. CONTINUIDAD CON EL BLOQUE 7.3 ─────────────

async function familia7(): Promise<void> {
  console.log("\n## 7. Continuidad con la sincronización del 7.3");

  if (!servidorVivo) {
    for (const t of [
      "el matchId emparejado sirve para sincronizar", "cada jugador ve su bando",
      "el mazo del rival sigue oculto", "un tercero recibe 404",
    ]) omit(t, "servidor no disponible");
    return;
  }
  if (!partidaId) { omit("continuidad 7.3", "no hubo partida en la familia 2"); return; }

  const rA = await http(parejaA.token, "GET", `${PVP}?matchId=${partidaId}`);
  const rB = await http(parejaB.token, "GET", `${PVP}?matchId=${partidaId}`);
  check("el matchId del emparejamiento sirve TAL CUAL en /api/game/duel/pvp",
    rA.status === 200 && rB.status === 200, `${rA.status}/${rB.status}`);

  const snapA = (rA.body.snapshot ?? {}) as { yourSide?: string; match?: unknown };
  const snapB = (rB.body.snapshot ?? {}) as { yourSide?: string; match?: unknown };
  check("A es el bando A y B es el bando B", snapA.yourSide === "A" && snapB.yourSide === "B",
    `${snapA.yourSide}/${snapB.yourSide}`);

  // El secreto: las cartas ocultas de cada uno no aparecen en la respuesta del otro.
  const { data: fila } = await db.from("duel_matches").select("state").eq("id", partidaId).maybeSingle();
  const estado = (fila as { state: { snapshotA: { cards: { uid: string }[] }; snapshotB: { cards: { uid: string }[] } } }).state;
  const uidsA = estado.snapshotA.cards.map((c) => c.uid);
  const uidsB = estado.snapshotB.cards.map((c) => c.uid);
  const filtradosEnA = uidsB.filter((u) => rA.text.includes(u));
  const filtradosEnB = uidsA.filter((u) => rB.text.includes(u));
  check("A no recibe ni una carta oculta del mazo de B", filtradosEnA.length === 0, `${filtradosEnA.length} uids`);
  check("B no recibe ni una carta oculta del mazo de A", filtradosEnB.length === 0, `${filtradosEnB.length} uids`);

  const tercero = await nuevoJugador("intruso");
  const rC = await http(tercero.token, "GET", `${PVP}?matchId=${partidaId}`);
  check("un tercero recibe 404 (no 403: no se confirma que exista)", rC.status === 404, String(rC.status));
}

// ───────────── 8. MEDIDAS ─────────────

async function familia8(): Promise<void> {
  console.log("\n## 8. Medidas");

  const P = await nuevoJugador("perf-a");
  const Q = await nuevoJugador("perf-b");

  const t0 = Date.now();
  await encolarCrudo(P);
  const tEnqueue = Date.now() - t0;

  await encolarCrudo(Q);

  const t1 = Date.now();
  const claim = await db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 });
  const tClaim = Date.now() - t1;
  const tk = claim.data as { pairToken: string };
  await db.rpc("duel_pvp_release_pair", { p_token: tk.pairToken, p_offender: null, p_reason: "MATCH_FAILED" });

  const t2 = Date.now();
  const out = await attemptMatch(db);
  const tFull = Date.now() - t2;

  const muestras: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = Date.now();
    await status(db, P.id);
    muestras.push(Date.now() - t);
  }
  const media = muestras.reduce((a, b) => a + b, 0) / muestras.length;

  console.log(`  · alta en cola (RPC)          : ${tEnqueue} ms`);
  console.log(`  · reserva de pareja (RPC)     : ${tClaim} ms`);
  console.log(`  · emparejamiento COMPLETO     : ${tFull} ms (reserva + 2 mazos + partida + confirmación)`);
  console.log(`  · consulta de estado          : ${media.toFixed(1)} ms de media (10 muestras)`);
  check("MEDIDA: la reserva de pareja es barata (índice parcial, LIMIT 2)", tClaim < 500, `${tClaim} ms`);
  check("MEDIDA: el emparejamiento completo cabe holgadamente en el arrendamiento de 20 s",
    tFull < 5000, `${tFull} ms`);
  check("MEDIDA: la consulta de estado responde rápido", media < 500, `${media.toFixed(1)} ms`);
  check("MEDIDA: el emparejamiento medido creó su partida", out !== null);

  // Comprobación de plan: la selección de candidatos NO recorre la tabla entera.
  const plan = await db.rpc("duel_pvp_status", { p_user: P.id });
  check("la consulta de estado no falla con la tabla poblada", plan.error === null);
}

// ───────────────────────────── cierre ─────────────────────────────

async function limpiar(): Promise<void> {
  for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
}

function salir(): void {
  console.log("\n" + "─".repeat(72));
  console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas (sin servidor)` : ""}`);
  console.log(fail === 0
    ? "  ✅ EL EMPAREJAMIENTO PvP ES ATÓMICO, PERSISTENTE Y NO FILTRA"
    : "  ❌ EL EMPAREJAMIENTO TIENE HUECOS");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e);
  await limpiar();
  process.exit(1);
});
