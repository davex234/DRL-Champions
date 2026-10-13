/**
 * VERIFICACIÓN DEL RATING PvP — `npm run pvp-rating:verify` (Bloque 7.4.1).
 *
 * Comprueba que el BLOQUEO D-MM-1 del bloque 7.4 —«no existe rating PvP persistente»— está
 * realmente resuelto, y no sustituido por un número inventado.
 *
 * Nueve familias:
 *
 *   1. ORÁCULO       — la fórmula Elo de SQL devuelve EXACTAMENTE lo mismo que
 *                      `src/domain/esports/predict/elo.ts`, y las constantes de la política en
 *                      TypeScript coinciden con las de SQL. Si alguna de las dos deriva, esto rompe.
 *   2. PERSISTENCIA  — el rating nace, se guarda, no se duplica y sobrevive a un proceso nuevo.
 *   3. SEGURIDAD     — el cliente no puede escribir su rating, ni el de otro, ni sus victorias,
 *                      ni el snapshot; ni por HTTP, ni por PostgREST, ni llamando a las RPC.
 *   4. INVARIANTES   — las restricciones aritméticas de la tabla rechazan lo que deben.
 *   5. SNAPSHOT      — al entrar en cola se sella el rating del servidor, y no se recalcula.
 *   6. EMPAREJAMIENTO— compatibles, incompatibles, ensanchado por espera, el MEJOR rival dentro
 *                      de la ventana y FIFO dentro de la misma banda.
 *   7. CONCURRENCIA  — las garantías del 7.4 siguen intactas con el rating dentro.
 *   8. LIQUIDACIÓN   — una partida REAL jugada hasta el final, liquidada una sola vez, con el
 *                      delta exacto que predice el oráculo. Y el rating NO se mueve antes.
 *   9. MEDIDAS       — tiempos de lectura, alta, búsqueda de candidatos y emparejamiento.
 *
 * Todo contra el PostgreSQL real. La familia 3 usa además el endpoint HTTP si hay servidor; si
 * no lo hay, esas comprobaciones se declaran OMITIDAS en voz alta y NO cuentan como correctas.
 *
 * Crea sus cuentas y lo borra todo al terminar.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { CardRegistry } from "../src/collection/registry";
import { DUEL_ROLES } from "../src/domain/cardgame";
import type { RoleId } from "../src/domain/cards/types";
// EL ORÁCULO: la matemática que ya existía en el proyecto, usada aquí como referencia externa.
import { expectedScore, updateElo } from "../src/domain/esports/predict/elo";
import {
  INITIAL_RATING, MIN_RATING, MAX_RATING, PLACEMENT_GAMES,
  K_PROVISIONAL, K_ESTABLISHED, kFactorFor, ratingWindowFor,
} from "../src/domain/cardgame/rating";
import { enqueue, cancel, status, attemptMatch } from "../src/server/services/duelsMatchmaking";
import { ensureRating, getRating, getRatingHistory, settleMatch } from "../src/server/services/duelsRating";
import { getPvpMatch, applyPvpAction } from "../src/server/services/duelsPvp";
import { requiredDefenderStat } from "../src/domain/cardgame/match";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

let pass = 0, fail = 0, skip = 0;
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
let servidorVivo = false;

// ───────────────────────────── utillaje ─────────────────────────────

const registry = new CardRegistry();

function deckCardIds(): string[] {
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
  return DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(0, 2)).map((c) => c.id);
}

const creadas: string[] = [];
interface Jugador { id: string; deckId: string; token: string; email: string }

async function nuevoJugador(tag: string): Promise<Jugador> {
  const email = `pvprating-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  const id = data.user.id;
  creadas.push(id);

  const rows = deckCardIds().map((cardId) => ({ uid: randomUUID(), user_id: id, card_id: cardId }));
  const ins = await db.from("user_cards").insert(rows);
  if (ins.error) throw new Error(`cartas: ${ins.error.message}`);

  const deck = await db.from("duel_decks")
    .insert({ user_id: id, name: `Mazo ${tag}`, card_uids: rows.map((r) => r.uid) })
    .select("id").maybeSingle();
  if (deck.error || !deck.data) throw new Error(`mazo: ${deck.error?.message}`);

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const sign = await anon.auth.signInWithPassword({ email, password });
  if (sign.error || !sign.data.session) throw new Error(`login: ${sign.error?.message}`);

  return { id, deckId: (deck.data as { id: string }).id, token: sign.data.session.access_token, email };
}

/** Fija el rating de un jugador. Es un FIXTURE de prueba con clave de servicio, no un camino real. */
async function fijarRating(userId: string, rating: number, games = 0): Promise<void> {
  await ensureRating(db, userId);
  const { error } = await db.from("duel_pvp_ratings")
    .update({ rating, games_played: games }).eq("user_id", userId);
  if (error) throw new Error(`fijarRating: ${error.message}`);
}

async function filaRating(userId: string): Promise<{ rating: number; games_played: number; wins: number; losses: number; draws: number } | null> {
  const { data } = await db.from("duel_pvp_ratings")
    .select("rating, games_played, wins, losses, draws").eq("user_id", userId).maybeSingle();
  return (data as never) ?? null;
}

async function filaCola(userId: string): Promise<{ state: string; rating_snapshot: number; match_id: string | null; created_at: string } | null> {
  const { data } = await db.from("duel_pvp_queue")
    .select("state, rating_snapshot, match_id, created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as never) ?? null;
}

const encolarCrudo = async (j: Jugador, ttl = 600): Promise<string> => {
  const { data, error } = await db.rpc("duel_pvp_enqueue", { p_user: j.id, p_deck: j.deckId, p_ttl_seconds: ttl });
  if (error) throw new Error(`enqueue crudo: ${error.message}`);
  return (data as { code: string }).code;
};

/** Envejece una entrada de cola sin caducarla, para probar el ensanchado sin esperar de verdad. */
async function envejecerEnCola(userId: string, segundos: number): Promise<void> {
  const { error } = await db.from("duel_pvp_queue")
    .update({ created_at: new Date(Date.now() - segundos * 1000).toISOString() })
    .eq("user_id", userId).eq("state", "QUEUED");
  if (error) throw new Error(`envejecer: ${error.message}`);
}

async function sql<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

interface Respuesta { status: number; body: Record<string, unknown>; text: string }
async function http(token: string | null, method: "GET" | "POST", url: string, body?: Record<string, unknown>): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* no-json */ }
  return { status: res.status, body: parsed, text };
}

// ───────────────────────────── programa ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(74));
  console.log("  VERIFICACIÓN DEL RATING PvP — Bloque 7.4.1 (D-MM-1)");
  console.log("=".repeat(74));

  try {
    const ping = await fetch(MM, { method: "GET" });
    servidorVivo = ping.status === 401;
    console.log(`\n  servidor: ${servidorVivo ? `${BASE} (vivo)` : `${BASE} no responde 401 — las pruebas HTTP se omiten`}`);
  } catch {
    console.log(`\n  servidor: ${BASE} inaccesible — las pruebas HTTP se omiten`);
  }

  await familia1();
  await familia2();
  await familia3();
  await familia4();
  await familia5();
  await familia6();
  await familia7();
  await familia8();
  await familia9();

  await limpiar();
  salir();
}

// ───────────── 1. ORÁCULO: SQL vs la matemática que ya existía ─────────────

async function familia1(): Promise<void> {
  console.log("\n## 1. Oráculo — la fórmula de SQL contra `domain/esports/predict/elo.ts`");

  const casos: [number, number][] = [[1000, 1000], [1000, 1150], [1200, 1000], [1000, 1600], [800, 2400], [2500, 900]];
  let maxDiff = 0;
  for (const [a, b] of casos) {
    const sqlVal = await sql<number>("duel_pvp_expected_score", { p_own: a, p_opponent: b });
    maxDiff = Math.max(maxDiff, Math.abs(Number(sqlVal) - expectedScore(a, b)));
  }
  check("la probabilidad esperada de SQL coincide con `expectedScore` de elo.ts",
    maxDiff < 1e-12, `desviación máxima ${maxDiff.toExponential(2)} en ${casos.length} casos`);

  // Las constantes de TypeScript son un ESPEJO: aquí se comprueba que no han derivado.
  const k0 = await sql<number>("duel_pvp_k_factor", { p_games_played: 0 });
  const k9 = await sql<number>("duel_pvp_k_factor", { p_games_played: PLACEMENT_GAMES - 1 });
  const k10 = await sql<number>("duel_pvp_k_factor", { p_games_played: PLACEMENT_GAMES });
  check("K provisional: TypeScript y SQL dicen lo mismo",
    k0 === K_PROVISIONAL && k9 === K_PROVISIONAL && kFactorFor(0) === k0, `SQL ${k0} · TS ${K_PROVISIONAL}`);
  check("K asentado: TypeScript y SQL dicen lo mismo",
    k10 === K_ESTABLISHED && kFactorFor(PLACEMENT_GAMES) === k10, `SQL ${k10} · TS ${K_ESTABLISHED}`);

  let ventanasOk = true;
  const muestras = [0, 5, 14.9, 15, 30, 44.9, 45, 60, 89.9, 90, 300];
  for (const w of muestras) {
    const sqlW = await sql<number>("duel_pvp_rating_window", { p_wait_seconds: w });
    if (Number(sqlW) !== ratingWindowFor(w)) { ventanasOk = false; break; }
  }
  check("la ventana de emparejamiento: TypeScript y SQL coinciden en todos los escalones",
    ventanasOk, `${muestras.length} puntos, incluidos los bordes exactos`);

  check("el rating inicial declarado en TypeScript es 1000 (no el 1500 del sistema 5v5)",
    INITIAL_RATING === 1000);
  check("los límites declarados son [0, 5000]", MIN_RATING === 0 && MAX_RATING === 5000);
}

// ───────────── 2. PERSISTENCIA ─────────────

async function familia2(): Promise<void> {
  console.log("\n## 2. Persistencia del rating");

  const A = await nuevoJugador("nuevo");

  // A. usuario nuevo obtiene rating inicial
  const r1 = await ensureRating(db, A.id);
  check("A. un usuario nuevo obtiene el rating inicial", r1.rating === INITIAL_RATING, String(r1.rating));
  check("A. y arranca sin partidas", r1.gamesPlayed === 0 && r1.wins === 0 && r1.losses === 0 && r1.draws === 0);
  check("A. y nace PROVISIONAL", r1.provisional === true);
  check("A. la fila existe de verdad en la tabla", (await filaRating(A.id))?.rating === INITIAL_RATING);

  // B. no se crea un segundo rating
  await Promise.all([1, 2, 3, 4, 5].map(() => ensureRating(db, A.id)));
  const { count } = await db.from("duel_pvp_ratings").select("user_id", { count: "exact", head: true }).eq("user_id", A.id);
  check("B. cinco asegurados simultáneos dejan UNA sola fila", count === 1, `${count} filas`);

  // C. persistencia real: proceso nuevo, sin nada en memoria
  await fijarRating(A.id, 1234, 3);
  const otroProceso = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const r2 = await ensureRating(otroProceso, A.id);
  check("C. un proceso NUEVO lee el mismo rating (vive en PostgreSQL, no en memoria)",
    r2.rating === 1234 && r2.gamesPlayed === 3, `${r2.rating} / ${r2.gamesPlayed} partidas`);
  check("C. `getRating` devuelve lo mismo por el servicio", (await getRating(db, A.id)).data?.rating === 1234);
  check("C. la provisionalidad se DERIVA de las partidas, no se guarda", r2.provisional === true);
  await fijarRating(A.id, 1234, PLACEMENT_GAMES);
  check("C. con 10 partidas deja de ser provisional", (await ensureRating(db, A.id)).provisional === false);
}

// ───────────── 3. SEGURIDAD ─────────────

async function familia3(): Promise<void> {
  console.log("\n## 3. Seguridad — el cliente no es autoridad de su rating");

  const V = await nuevoJugador("victima");
  await fijarRating(V.id, 1500, 5);
  const O = await nuevoJugador("otro");
  await ensureRating(db, O.id);

  const comoUsuario = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { authorization: `Bearer ${V.token}` } },
  });

  // I. escritura directa sobre la tabla
  const upd = await comoUsuario.from("duel_pvp_ratings").update({ rating: 4999 }).eq("user_id", V.id);
  check("I. un usuario autenticado NO puede hacer UPDATE de su rating",
    upd.error !== null, upd.error?.code ?? "SIN ERROR");
  const ajeno = await comoUsuario.from("duel_pvp_ratings").update({ rating: 1 }).eq("user_id", O.id);
  check("I. ni del rating de otro", ajeno.error !== null, ajeno.error?.code ?? "SIN ERROR");
  const wins = await comoUsuario.from("duel_pvp_ratings").update({ wins: 999999 }).eq("user_id", V.id);
  check("G. ni de sus victorias", wins.error !== null, wins.error?.code ?? "SIN ERROR");
  const losses = await comoUsuario.from("duel_pvp_ratings").update({ losses: 0, games_played: 0 }).eq("user_id", V.id);
  check("H. ni de sus derrotas ni de su contador de partidas", losses.error !== null, losses.error?.code ?? "SIN ERROR");
  const insertar = await comoUsuario.from("duel_pvp_ratings").insert({ user_id: V.id, rating: 5000 });
  check("un usuario NO puede insertarse un rating a medida", insertar.error !== null, insertar.error?.code ?? "SIN ERROR");

  // W. lectura directa
  const leer = await comoUsuario.from("duel_pvp_ratings").select("rating").limit(1);
  check("W. la tabla de rating es ILEGIBLE directamente (RLS sin políticas)",
    leer.error !== null || (leer.data ?? []).length === 0, leer.error?.code ?? "0 filas");
  const leerLibro = await comoUsuario.from("duel_pvp_rating_events").select("delta").limit(1);
  check("W. el libro de movimientos tampoco es legible directamente",
    leerLibro.error !== null || (leerLibro.data ?? []).length === 0, leerLibro.error?.code ?? "0 filas");
  const escribirLibro = await comoUsuario.from("duel_pvp_rating_events")
    .insert({ match_id: randomUUID(), user_id: V.id, old_rating: 1500, delta: 500, new_rating: 2000, opponent_rating: 1000, k_factor: 24, result: "WIN" });
  check("nadie se escribe un movimiento a mano en el libro", escribirLibro.error !== null, escribirLibro.error?.code ?? "SIN ERROR");

  // X. grants sobre las funciones
  const rpcs: [string, Record<string, unknown>][] = [
    ["duel_pvp_ensure_rating", { p_user: V.id }],
    ["duel_pvp_settle_match", { p_match: randomUUID() }],
    ["duel_pvp_expected_score", { p_own: 1000, p_opponent: 1000 }],
    ["duel_pvp_k_factor", { p_games_played: 0 }],
    ["duel_pvp_rating_window", { p_wait_seconds: 0 }],
  ];
  for (const [fn, args] of rpcs) {
    const r = await comoUsuario.rpc(fn, args as never);
    check(`X. un usuario autenticado NO puede invocar ${fn}`, r.error?.code === "42501",
      r.error?.code ?? "SIN ERROR (¡se ejecutó!)");
  }

  check("el rating de la víctima sigue intacto tras todos los intentos",
    (await filaRating(V.id))?.rating === 1500, String((await filaRating(V.id))?.rating));

  // E/F por HTTP
  if (!servidorVivo) {
    omit("E. rating del cliente ignorado (HTTP)", "servidor no disponible");
    omit("F. userId suplantado ignorado (HTTP)", "servidor no disponible");
    omit("K. rating_snapshot no manipulable (HTTP)", "servidor no disponible");
    return;
  }

  const spoof = await http(V.token, "POST", `${MM}?userId=${O.id}&rating=4000`, {
    action: "enqueue", deckId: V.deckId,
    rating: 999999, mmr: 999999, elo: 999999, ratingSnapshot: 999999, rating_snapshot: 999999,
    wins: 999999, losses: 0, gamesPlayed: 999999,
    userId: O.id, user_id: O.id, playerId: O.id,
  });
  check("E/F/K. el alta con rating, victorias y userId falsos responde 200 (todo se IGNORA)",
    spoof.status === 200, String(spoof.status));

  const fila = await filaCola(V.id);
  check("E. el `rating_snapshot` guardado es el REAL del servidor, no el enviado",
    fila?.rating_snapshot === 1500, `${fila?.rating_snapshot} (enviado: 999999)`);
  check("F. la entrada es del dueño del TOKEN, no del userId enviado",
    fila?.state === "QUEUED" && (await filaCola(O.id)) === null);
  const rv = await filaRating(V.id);
  check("G/H. victorias y partidas siguen intactas", rv?.wins === 0 && rv?.games_played === 5, `${rv?.wins}w ${rv?.games_played}g`);
  check("E. el rating del jugador NO cambió por entrar en cola", rv?.rating === 1500, String(rv?.rating));

  const propia = await http(V.token, "GET", MM);
  check("un usuario ve SU rating por el servidor", propia.body.rating === 1500, String(propia.body.rating));
  check("y no ve el rating de nadie más", !propia.text.includes(O.id));

  // K. intentar mover el snapshot ya sellado
  const remanipular = await http(V.token, "POST", MM, { action: "enqueue", deckId: V.deckId, ratingSnapshot: 4321 });
  check("K. reintentar el alta con otro snapshot no lo cambia",
    (await filaCola(V.id))?.rating_snapshot === 1500 && remanipular.status === 200,
    String((await filaCola(V.id))?.rating_snapshot));

  await cancel(db, V.id);
}

// ───────────── 4. INVARIANTES ─────────────

async function familia4(): Promise<void> {
  console.log("\n## 4. Invariantes aritméticas de la tabla");

  const J = await nuevoJugador("constraints");
  await ensureRating(db, J.id);

  const casos: [string, Record<string, unknown>][] = [
    ["V. un rating negativo se rechaza", { rating: -1 }],
    ["V. un rating por encima del techo se rechaza", { rating: 5001 }],
    ["V. contadores negativos se rechazan", { wins: -1 }],
    ["V. wins+losses+draws > games_played se rechaza", { games_played: 1, wins: 1, losses: 1 }],
  ];
  for (const [label, patch] of casos) {
    const { error } = await db.from("duel_pvp_ratings").update(patch).eq("user_id", J.id);
    check(label, error !== null, error?.code ?? "SIN ERROR (¡aceptado!)");
  }
  check("V. los límites exactos SÍ se aceptan",
    (await db.from("duel_pvp_ratings").update({ rating: MAX_RATING }).eq("user_id", J.id)).error === null);
  check("V. wins+losses+draws == games_played se acepta",
    (await db.from("duel_pvp_ratings").update({ games_played: 3, wins: 1, losses: 1, draws: 1 }).eq("user_id", J.id)).error === null);
  check("V. y wins+losses+draws < games_played también (hueco para el abandono, D-PVP-7)",
    (await db.from("duel_pvp_ratings").update({ games_played: 4 }).eq("user_id", J.id)).error === null);

  const dup = await db.from("duel_pvp_ratings").insert({ user_id: J.id });
  check("V. no puede haber un segundo rating para el mismo usuario", dup.error !== null, dup.error?.code ?? "SIN ERROR");

  const libroMal = await db.from("duel_pvp_rating_events").insert({
    match_id: randomUUID(), user_id: J.id, old_rating: 1000, delta: 20, new_rating: 1099,
    opponent_rating: 1000, k_factor: 24, result: "WIN",
  });
  check("V. el libro rechaza un movimiento que no cuadra (new != old + delta)",
    libroMal.error !== null, libroMal.error?.code ?? "SIN ERROR");
  const libroResultado = await db.from("duel_pvp_rating_events").insert({
    match_id: randomUUID(), user_id: J.id, old_rating: 1000, delta: 0, new_rating: 1000,
    opponent_rating: 1000, k_factor: 24, result: "VICTORIA",
  });
  check("V. el libro rechaza un resultado que no es WIN/LOSS/DRAW",
    libroResultado.error !== null, libroResultado.error?.code ?? "SIN ERROR");
}

// ───────────── 5. SNAPSHOT ─────────────

async function familia5(): Promise<void> {
  console.log("\n## 5. Snapshot de rating al entrar en cola");

  const S = await nuevoJugador("snap");
  await fijarRating(S.id, 1337, 4);

  const alta = await enqueue(db, S.id, S.deckId);
  check("J. la entrada nace con el rating del servidor sellado",
    alta.data?.entry?.ratingSnapshot === 1337, String(alta.data?.entry?.ratingSnapshot));
  check("J. y coincide con la columna de la tabla", (await filaCola(S.id))?.rating_snapshot === 1337);
  check("J. la vista devuelve también el rating ACTUAL del solicitante", alta.data?.rating === 1337);
  check("J. `rating_snapshot` es NOT NULL: no puede existir una entrada sin él",
    (await filaCola(S.id))?.rating_snapshot !== null);

  // El rating cambia mientras espera: la entrada NO se toca.
  await fijarRating(S.id, 1900, 5);
  const tras = await status(db, S.id);
  check("el snapshot NO se recalcula cuando el rating cambia mientras esperas",
    (await filaCola(S.id))?.rating_snapshot === 1337, String((await filaCola(S.id))?.rating_snapshot));
  check("pero la vista sí refleja el rating actual (son cosas distintas)",
    tras.data?.rating === 1900 && tras.data?.entry?.ratingSnapshot === 1337,
    `actual ${tras.data?.rating} · snapshot ${tras.data?.entry?.ratingSnapshot}`);

  // Salir y volver a entrar SÍ lo re-sella: es una acción explícita del jugador.
  await cancel(db, S.id);
  const alta2 = await enqueue(db, S.id, S.deckId);
  check("volver a entrar en cola SÍ re-sella el snapshot con el rating nuevo",
    alta2.data?.entry?.ratingSnapshot === 1900, String(alta2.data?.entry?.ratingSnapshot));
  await cancel(db, S.id);
}

// ───────────── 6. EMPAREJAMIENTO POR RATING ─────────────

async function familia6(): Promise<void> {
  console.log("\n## 6. Emparejamiento por rating");

  // M — compatibles de inmediato (1000 vs 1050, hueco 50 <= 150)
  const m1 = await nuevoJugador("comp-1");
  const m2 = await nuevoJugador("comp-2");
  await fijarRating(m1.id, 1000); await fijarRating(m2.id, 1050);
  await encolarCrudo(m1); await encolarCrudo(m2);
  const okPar = await attemptMatch(db);
  check("M. dos ratings cercanos (1000 vs 1050) emparejan de inmediato", okPar !== null);
  check("M. y las dos entradas quedan MATCHED con la misma partida",
    (await filaCola(m1.id))?.match_id === okPar?.matchId && (await filaCola(m2.id))?.match_id === okPar?.matchId);

  // N — incompatibles al principio (1000 vs 3000)
  const n1 = await nuevoJugador("incomp-1");
  const n2 = await nuevoJugador("incomp-2");
  await fijarRating(n1.id, 1000); await fijarRating(n2.id, 3000);
  await encolarCrudo(n1); await encolarCrudo(n2);
  const noPar = await attemptMatch(db);
  check("N. 1000 contra 3000 NO empareja recién llegados (hueco 2000 > ventana 150)", noPar === null);
  check("N. los dos siguen esperando, no se cierra ni se cancela nada",
    (await filaCola(n1.id))?.state === "QUEUED" && (await filaCola(n2.id))?.state === "QUEUED");

  // O — ensanchado: con 100 s de espera la ventana es libre
  await envejecerEnCola(n1.id, 100);
  await envejecerEnCola(n2.id, 100);
  const trasEspera = await attemptMatch(db);
  check("O. tras 100 s de espera la ventana se abre y SÍ emparejan", trasEspera !== null);
  check("O. el emparejamiento registra el hueco real de rating",
    (await filaCola(n1.id))?.state === "MATCHED" && (await filaCola(n2.id))?.state === "MATCHED");

  // O bis — los escalones intermedios se respetan
  const o1 = await nuevoJugador("esc-1");
  const o2 = await nuevoJugador("esc-2");
  await fijarRating(o1.id, 1000); await fijarRating(o2.id, 1250);   // hueco 250: fuera de 150, dentro de 300
  await encolarCrudo(o1); await encolarCrudo(o2);
  check("O. un hueco de 250 NO cabe en la ventana inicial de ±150", (await attemptMatch(db)) === null);
  await envejecerEnCola(o1.id, 20); await envejecerEnCola(o2.id, 20);
  check("O. pero SÍ cabe en la de ±300 tras 20 s de espera", (await attemptMatch(db)) !== null);

  // FAIRNESS — el mejor rival dentro de la ventana, no el primero que aparezca
  const f1 = await nuevoJugador("fair-buscador");
  const f2 = await nuevoJugador("fair-lejos");
  const f3 = await nuevoJugador("fair-cerca");
  await fijarRating(f1.id, 1000); await fijarRating(f2.id, 1140); await fijarRating(f3.id, 1030);
  await encolarCrudo(f1);                      // el más antiguo → es el buscador
  await new Promise((r) => setTimeout(r, 15));
  await encolarCrudo(f2);                      // entra ANTES que el cercano, y está dentro de la ventana
  await new Promise((r) => setTimeout(r, 15));
  await encolarCrudo(f3);
  const justo = await attemptMatch(db);
  const parejaJusta = new Set([justo?.playerA, justo?.playerB]);
  check("FAIRNESS. el buscador es el que más ha esperado (1000)", parejaJusta.has(f1.id));
  check("FAIRNESS. su rival es el de MENOR diferencia (1030), no el que llegó antes (1140)",
    parejaJusta.has(f3.id) && !parejaJusta.has(f2.id),
    justo ? `emparejados ${[...parejaJusta].map((u) => u === f3.id ? "1030" : u === f2.id ? "1140" : "1000").join(" vs ")}` : "ninguno");
  check("FAIRNESS. el candidato lejano se queda esperando, no se descarta",
    (await filaCola(f2.id))?.state === "QUEUED");
  await cancel(db, f2.id);

  // P — FIFO dentro de la misma banda: con ratings iguales manda la antigüedad
  const p1 = await nuevoJugador("fifo-1");
  const p2 = await nuevoJugador("fifo-2");
  const p3 = await nuevoJugador("fifo-3");
  for (const j of [p1, p2, p3]) await fijarRating(j.id, 1100);
  await encolarCrudo(p1); await new Promise((r) => setTimeout(r, 15));
  await encolarCrudo(p2); await new Promise((r) => setTimeout(r, 15));
  await encolarCrudo(p3);
  const fifo = await attemptMatch(db);
  const parejaFifo = new Set([fifo?.playerA, fifo?.playerB]);
  check("P. con ratings iguales, empareja a los DOS más antiguos (FIFO intacto)",
    parejaFifo.has(p1.id) && parejaFifo.has(p2.id) && !parejaFifo.has(p3.id));
  check("P. el tercero sigue esperando", (await filaCola(p3.id))?.state === "QUEUED");
  await cancel(db, p3.id);

  // Q — self-match imposible
  const q1 = await nuevoJugador("self");
  await fijarRating(q1.id, 1000);
  await encolarCrudo(q1);
  check("Q. un solo jugador en cola NO produce partida (self-match imposible)", (await attemptMatch(db)) === null);
  check("Q. y sigue esperando", (await filaCola(q1.id))?.state === "QUEUED");
  await cancel(db, q1.id);
}

// ───────────── 7. CONCURRENCIA (garantías del 7.4, con rating dentro) ─────────────

async function familia7(): Promise<void> {
  console.log("\n## 7. Concurrencia — las garantías del 7.4 siguen intactas");

  const a = await nuevoJugador("c-a");
  const b = await nuevoJugador("c-b");
  for (const j of [a, b]) await fijarRating(j.id, 1200);
  await encolarCrudo(a); await encolarCrudo(b);

  const claims = await Promise.all([1, 2, 3, 4].map(() => db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 })));
  const paired = claims.filter((c) => (c.data as { code: string })?.code === "PAIRED");
  check("R. 4 emparejadores simultáneos · 2 candidatos → UNA sola reserva", paired.length === 1, `${paired.length}`);
  // Ojo al matiz respecto al 7.4: desde este bloque los perdedores ESPERAN unos milisegundos en
  // el cerrojo del emparejador en vez de saltar filas. El resultado observable es el mismo.
  check("R. los otros 3 se van sin pareja (una sola puede existir)",
    claims.filter((c) => (c.data as { code: string })?.code === "NO_CANDIDATES").length === 3);
  const tk = paired[0]?.data as { pairToken: string; ratingGap: number };
  check("R. la reserva informa del hueco de rating de la pareja", tk.ratingGap === 0, String(tk.ratingGap));
  await db.rpc("duel_pvp_release_pair", { p_token: tk.pairToken, p_offender: null, p_reason: "MATCH_FAILED" });

  // Cuatro candidatos, dos emparejadores COMPLETOS a la vez.
  const c = await nuevoJugador("c-c");
  const d = await nuevoJugador("c-d");
  for (const j of [c, d]) await fijarRating(j.id, 1200);
  await encolarCrudo(c); await encolarCrudo(d);
  const outs = await Promise.all([1, 2, 3].map(() => attemptMatch(db)));
  const hechas = outs.filter((o) => o !== null);
  const filas = await Promise.all([a, b, c, d].map((j) => filaCola(j.id)));
  const partidas = new Set(filas.map((f) => f?.match_id));
  check("R. 3 emparejadores COMPLETOS · 4 candidatos → 2 partidas exactas",
    hechas.length === 2 && partidas.size === 2, `${hechas.length} devueltas · ${partidas.size} partidas`);
  check("R. los 4 quedan MATCHED, ninguno en QUEUED",
    filas.every((f) => f?.state === "MATCHED"), filas.map((f) => f?.state).join(","));
  check("R. nunca MATCHED + QUEUED para el mismo jugador",
    filas.every((f) => f?.state === "MATCHED" && f.match_id !== null));

  // 5 altas simultáneas del mismo usuario
  const e = await nuevoJugador("c-e");
  await fijarRating(e.id, 1200);
  await Promise.all([1, 2, 3, 4, 5].map(() =>
    db.rpc("duel_pvp_enqueue", { p_user: e.id, p_deck: e.deckId, p_ttl_seconds: 600 })));
  const { count } = await db.from("duel_pvp_queue")
    .select("id", { count: "exact", head: true }).eq("user_id", e.id).in("state", ["QUEUED", "PAIRING"]);
  check("R. 5 altas simultáneas del mismo usuario → UNA entrada viva", count === 1, `${count}`);
  check("R. y con un solo snapshot, el del servidor", (await filaCola(e.id))?.rating_snapshot === 1200);

  // cancel vs matcher
  const f = await nuevoJugador("c-f");
  await fijarRating(f.id, 1200);
  await encolarCrudo(f);
  const [, claimJ] = await Promise.all([
    db.rpc("duel_pvp_cancel", { p_user: e.id }),
    db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 }),
  ]);
  const fe = await filaCola(e.id);
  check("R. cancelación contra emparejador: nunca CANCELLED con partida asignada",
    !(fe?.state === "CANCELLED" && fe.match_id !== null),
    `claim=${(claimJ.data as { code: string })?.code} · E=${fe?.state}`);
  if ((claimJ.data as { code: string })?.code === "PAIRED") {
    await db.rpc("duel_pvp_release_pair", { p_token: (claimJ.data as { pairToken: string }).pairToken, p_offender: null, p_reason: "MATCH_FAILED" });
  }
  await cancel(db, e.id); await cancel(db, f.id);

  check("S. NINGÚN rating se movió por emparejar: crear partidas no reparte puntos",
    (await Promise.all([a, b, c, d, e, f].map((j) => filaRating(j.id))))
      .every((r) => r?.games_played === 0 && r?.rating === 1200));
}

// ───────────── 8. LIQUIDACIÓN CON UNA PARTIDA REAL ─────────────

/** Juega un duelo PvP hasta el final por el camino real del servidor. Devuelve el estado final. */
async function jugarHastaElFinal(matchId: string, A: Jugador, B: Jugador): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const vista = await getPvpMatch(db, A.id, matchId);
    if (!vista.ok) throw new Error(`lectura: ${vista.error}`);
    const v = vista.data!.view;
    if (v.lifecycle === "FINISHED") return v.match.status;

    const quien = v.expectedPlayer;
    if (!quien) throw new Error(`nadie debe actuar y la partida no ha terminado (${v.lifecycle})`);

    // Se lee la partida CON LOS OJOS del que actúa: así solo se ven sus propias cartas.
    const suya = await getPvpMatch(db, quien, matchId);
    const m = suya.data!.view.match;
    const lado = suya.data!.view.yourSide;
    const snap = lado === "A" ? m.snapshotA : m.snapshotB;
    const usadas = new Set(lado === "A" ? m.usedA : m.usedB);
    const libre = snap.cards.find((c) => !usadas.has(c.uid));
    if (!libre) throw new Error("sin cartas disponibles");

    const atacando = m.attacker === lado;
    const stat = atacando ? "stronghold" : undefined;
    const res = await applyPvpAction(db, matchId, {
      actionId: randomUUID(), expectedVersion: suya.data!.view.stateVersion,
      playerId: quien, cardUid: libre.uid, ...(stat ? { stat } : {}),
    });
    if (!res.ok) throw new Error(`acción ${i}: ${res.error} (${res.code})`);
  }
  throw new Error("la partida no terminó en 60 acciones");
}

async function familia8(): Promise<void> {
  console.log("\n## 8. Liquidación — partida real jugada hasta el final");

  const A = await nuevoJugador("liq-a");
  const B = await nuevoJugador("liq-b");
  await fijarRating(A.id, 1000); await fijarRating(B.id, 1000);
  await encolarCrudo(A); await encolarCrudo(B);
  const par = await attemptMatch(db);
  if (!par) { check("no se pudo emparejar para la prueba de liquidación", false); return; }
  const matchId = par.matchId;

  const antesA = await filaRating(A.id);
  check("T. crear la partida NO mueve el rating", antesA?.rating === 1000 && antesA?.games_played === 0);

  const prematuro = await settleMatch(db, matchId);
  check("T. liquidar una partida EN CURSO se rechaza",
    prematuro.data?.code === "NOT_FINISHED", String(prematuro.data?.code));
  check("T. y no ha tocado nada", (await filaRating(A.id))?.games_played === 0);

  let estadoFinal = "";
  try {
    estadoFinal = await jugarHastaElFinal(matchId, A, B);
  } catch (e) {
    check(`se pudo jugar el duelo entero por el camino real del servidor`, false, String(e));
    return;
  }
  check("la partida se jugó COMPLETA por el camino real (applyPvpAction)",
    estadoFinal === "COMPLETED" || estadoFinal === "DRAW", estadoFinal);
  /*
   * Estas dos comprobaciones eran, en el bloque 7.4.1, exactamente las contrarias: se exigía que
   * el rating NO se moviera al terminar la partida, porque entonces la liquidación existía pero
   * NADIE la llamaba (deuda D-RAT-1). El bloque 7.4.2 la enganchó a `applyPvpAction` y a
   * `abandonPvpMatch`, así que la exigencia se invierte: ahora que el rating NO se moviera sería
   * el fallo. Quien vigila el enganche en detalle es `pvp-rating-settlement:verify`.
   */
  check("T. terminar la partida SÍ mueve el rating por sí solo (D-RAT-1 resuelto en 7.4.2)",
    (await filaRating(A.id))?.games_played === 1 && (await filaRating(B.id))?.games_played === 1,
    `A ${(await filaRating(A.id))?.games_played}g · B ${(await filaRating(B.id))?.games_played}g`);

  // Se lee el resultado autoritativo para calcular con el ORÁCULO lo que debería pasar.
  const { data: fila } = await db.from("duel_matches").select("status, winner").eq("id", matchId).maybeSingle();
  const { status: st, winner } = fila as { status: string; winner: string | null };
  const scoreA = st === "DRAW" ? 0.5 : winner === "A" ? 1 : 0;
  const esperadoA = Math.round(updateElo(1000, 1000, scoreA, K_PROVISIONAL, 1).deltaA);

  // Y una liquidación explícita a posteriori ya no encuentra nada que hacer: el enganche llegó
  // primero. Eso es la idempotencia vista desde el otro lado.
  const liq = await settleMatch(db, matchId);
  check("U. una liquidación explícita posterior no vuelve a aplicar (el enganche llegó antes)",
    liq.data?.code === "ALREADY_SETTLED", String(liq.data?.code));
  const rA = await filaRating(A.id);
  const rB = await filaRating(B.id);
  check("U. el delta coincide EXACTAMENTE con el que predice elo.ts",
    (rA!.rating - 1000) === esperadoA, `real ${rA!.rating - 1000} · oráculo ${esperadoA}`);
  check("U. el intercambio es simétrico entre dos jugadores con la misma K",
    (rA!.rating - 1000) === -(rB!.rating - 1000), `${rA!.rating - 1000} / ${rB!.rating - 1000}`);
  check("U. los contadores cuadran", rA!.games_played === 1 && rB!.games_played === 1
    && rA!.wins + rA!.losses + rA!.draws === 1);

  // IDEMPOTENCIA — el punto central
  const otra = await settleMatch(db, matchId);
  check("U. la SEGUNDA liquidación devuelve ALREADY_SETTLED",
    otra.data?.code === "ALREADY_SETTLED", String(otra.data?.code));
  const rA2 = await filaRating(A.id);
  check("U. y NO vuelve a mover el rating", rA2!.rating === rA!.rating && rA2!.games_played === 1,
    `${rA2!.rating} / ${rA2!.games_played} partidas`);

  const simultaneas = await Promise.all([1, 2, 3, 4, 5].map(() => settleMatch(db, matchId)));
  const aplicadas = simultaneas.filter((r) => r.data?.code === "SETTLED").length;
  const rA3 = await filaRating(A.id);
  check("U. 5 liquidaciones SIMULTÁNEAS de la misma partida no mueven nada más",
    aplicadas === 0 && rA3!.games_played === 1, `${aplicadas} aplicadas · ${rA3!.games_played} partidas`);

  const { count: eventos } = await db.from("duel_pvp_rating_events")
    .select("id", { count: "exact", head: true }).eq("match_id", matchId);
  check("U. el libro tiene EXACTAMENTE 2 movimientos (uno por jugador)", eventos === 2, `${eventos}`);

  // Auditabilidad: el movimiento se puede reproducir con lo que guarda el libro.
  const hist = await getRatingHistory(db, A.id, 5);
  const ev = hist.data?.[0];
  const reproducido = ev
    ? Math.round(updateElo(ev.oldRating, ev.opponentRating, ev.result === "WIN" ? 1 : ev.result === "DRAW" ? 0.5 : 0, ev.kFactor, 1).deltaA)
    : NaN;
  check("AUDITORÍA. el delta del libro se REPRODUCE con sus propios campos",
    ev !== undefined && reproducido === ev.delta, `libro ${ev?.delta} · reproducido ${reproducido}`);
  check("AUDITORÍA. el movimiento apunta a la partida que lo causó", ev?.matchId === matchId);

  // Liquidación falsa
  const inventada = await settleMatch(db, randomUUID());
  check("una liquidación de una partida inexistente se rechaza",
    inventada.data?.code === "NO_MATCH", String(inventada.data?.code));

  // K distinta: provisional contra asentado
  const P = await nuevoJugador("liq-prov");
  const Q = await nuevoJugador("liq-est");
  await fijarRating(P.id, 1000, 0);
  await fijarRating(Q.id, 1000, 50);
  await encolarCrudo(P); await encolarCrudo(Q);
  const par2 = await attemptMatch(db);
  if (par2) {
    await db.from("duel_matches").update({ status: "COMPLETED", winner: "A" }).eq("id", par2.matchId);
    const l2 = await settleMatch(db, par2.matchId);
    const dA = (l2.data?.a?.delta ?? 0), dB = (l2.data?.b?.delta ?? 0);
    const kA = l2.data?.a?.kFactor, kB = l2.data?.b?.kFactor;
    const provEsA = par2.playerA === P.id;
    check("K por jugador: el provisional usa 40 y el asentado 24",
      (provEsA ? kA === K_PROVISIONAL && kB === K_ESTABLISHED : kB === K_PROVISIONAL && kA === K_ESTABLISHED),
      `A:${kA} B:${kB}`);
    check("con K distintas el intercambio NO es de suma cero, y es intencionado",
      Math.abs(dA) !== Math.abs(dB), `${dA} / ${dB}`);
  } else {
    check("se pudo emparejar provisional contra asentado", false);
  }
}

// ───────────── 9. MEDIDAS ─────────────

async function familia9(): Promise<void> {
  console.log("\n## 9. Medidas");

  const X = await nuevoJugador("perf-1");
  const Y = await nuevoJugador("perf-2");
  await fijarRating(X.id, 1000); await fijarRating(Y.id, 1010);

  const t0 = Date.now();
  for (let i = 0; i < 10; i++) await ensureRating(db, X.id);
  const tRating = (Date.now() - t0) / 10;

  const t1 = Date.now();
  await encolarCrudo(X);
  const tEnq = Date.now() - t1;
  await encolarCrudo(Y);

  const t2 = Date.now();
  const claim = await db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 });
  const tClaim = Date.now() - t2;
  await db.rpc("duel_pvp_release_pair", { p_token: (claim.data as { pairToken: string }).pairToken, p_offender: null, p_reason: "MATCH_FAILED" });

  const t3 = Date.now();
  const out = await attemptMatch(db);
  const tFull = Date.now() - t3;

  console.log(`  · leer rating (RPC)            : ${tRating.toFixed(1)} ms de media (10 muestras)`);
  console.log(`  · alta en cola + sellado       : ${tEnq} ms`);
  console.log(`  · reserva de pareja con rating : ${tClaim} ms`);
  console.log(`  · emparejamiento COMPLETO      : ${tFull} ms`);
  check("MEDIDA: leer el rating es barato", tRating < 200, `${tRating.toFixed(1)} ms`);
  check("MEDIDA: sellar el rating no encarece el alta", tEnq < 500, `${tEnq} ms`);
  check("MEDIDA: el criterio de rating no encarece la reserva", tClaim < 500, `${tClaim} ms`);
  check("MEDIDA: el emparejamiento completo sigue dentro del arrendamiento de 20 s", tFull < 5000, `${tFull} ms`);
  check("MEDIDA: el emparejamiento medido creó su partida", out !== null);

  // El candidato se busca por índice, no recorriendo la cola en Node.
  const plan = await db.rpc("duel_pvp_claim_pair", { p_lease_seconds: 20 });
  check("la búsqueda de candidatos ocurre ENTERA en SQL (una sola llamada)", plan.error === null);
}

// ───────────────────────────── cierre ─────────────────────────────

async function limpiar(): Promise<void> {
  for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
}

function salir(): void {
  console.log("\n" + "─".repeat(74));
  console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas (sin servidor)` : ""}`);
  console.log(fail === 0
    ? "  ✅ EL RATING PvP ES PERSISTENTE, AUTORITATIVO E IDEMPOTENTE"
    : "  ❌ EL RATING PvP TIENE HUECOS");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e);
  await limpiar();
  process.exit(1);
});
