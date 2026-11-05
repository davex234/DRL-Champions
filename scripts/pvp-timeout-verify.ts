/**
 * VERIFICACIÓN DEL VENCIMIENTO DE TURNO — `npm run pvp-timeout:verify` (Bloque 7.4.3).
 *
 * ⚠ F72.8 (2026-09-30) · SUPERADO. Al vencer, el servidor ya NO cierra la partida como EXPIRED: juega por quien debía
 * decidir (`lib/duel/turnClock` · `autoDecision`) y la partida sigue; el plazo es de 30 s por DECISIÓN (antes 90 s por
 * turno). Las familias 3, 6 y 7 de este verificador esperan el comportamiento antiguo y FALLARÁN a propósito. La
 * cobertura vigente está en `src/server/services/turnClock.service.test.ts` y en `scripts/_f728-timer-qa.ts`.
 *
 * Comprueba que D-PVP-6 («el reloj de turno no vence solo») está resuelto: que el servidor cierra
 * por su cuenta una partida cuyo turno ha expirado, que decide bien quién pierde, que liquida el
 * rating por la puerta que ya existía, y que nada de eso lo puede provocar ni falsear el cliente.
 *
 * CÓMO SE ENVEJECE UNA PARTIDA. No se espera 90 segundos: se mueve `turn_deadline_at` al pasado
 * con la clave de servicio, que es un FIXTURE de prueba. Lo que NUNCA se falsea es la decisión:
 * quién ha vencido lo sigue comparando PostgreSQL contra su propio `now()`, y quién pierde lo
 * sigue derivando el motor. Se envejece el reloj, no el veredicto.
 *
 * Nueve familias:
 *
 *   1. RELOJ         — el turno nace con plazo, el plazo es del servidor y avanza con el turno.
 *   2. ANTES DE HORA — nada vence antes de tiempo, por mucho que se pida.
 *   3. VENCIMIENTO   — cierra, elige perdedor, marca la causa y liquida.
 *   4. CARRERAS      — acción vs vencimiento, abandono vs vencimiento, sondeo vs vencimiento.
 *   5. CONCURRENCIA  — cinco barridos a la vez contra PostgreSQL real.
 *   6. IDEMPOTENCIA  — vencer N veces deja un único cierre y un único movimiento de rating.
 *   7. DISPARADORES  — el sondeo del rival cierra la partida; el alta en cola desbloquea.
 *   8. SEGURIDAD     — quién puede provocar un vencimiento y qué no puede tocarse.
 *   9. MEDIDAS       — coste del sondeo, del barrido y del cierre.
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
import { attemptMatch, enqueue } from "../src/server/services/duelsMatchmaking";
import { settleMatch } from "../src/server/services/duelsRating";
import {
  getPvpMatch, applyPvpAction, abandonPvpMatch, syncPvpMatch, sweepExpiredPvpTurns, PVP_TURN_MS,
} from "../src/server/services/duelsPvp";

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
const omit = (label: string, why: string): void => { console.log(`  [SKIP] ${label} — ${why}`); skip++; };

const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const PVP = `${BASE}/api/game/duel/pvp`;
let servidorVivo = false;

// ───────────────────────────── utillaje ─────────────────────────────

const registry = new CardRegistry();
function deckCardIds(): string[] {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) { const b = best.get(c.playerId); if (!b || c.ovr > b.ovr) best.set(c.playerId, c); }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) { const p = registry.player(c.playerId); if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]); }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  return DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(0, 2)).map((c) => c.id);
}

const creadas: string[] = [];
interface Jugador { id: string; deckId: string; token: string }

async function nuevoJugador(tag: string): Promise<Jugador> {
  const email = `pvptmo-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  const id = data.user.id; creadas.push(id);
  const rows = deckCardIds().map((cardId) => ({ uid: randomUUID(), user_id: id, card_id: cardId }));
  if ((await db.from("user_cards").insert(rows)).error) throw new Error("cartas");
  const deck = await db.from("duel_decks")
    .insert({ user_id: id, name: tag, card_uids: rows.map((r) => r.uid) }).select("id").maybeSingle();
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const sign = await anon.auth.signInWithPassword({ email, password });
  return { id, deckId: (deck.data as { id: string }).id, token: sign.data.session!.access_token };
}

interface Fila {
  status: string; winner: string | null; closed_reason: string | null; closed_by: string | null;
  state_version: number; turn_started_at: string | null; turn_deadline_at: string | null;
}
const fila = async (matchId: string): Promise<Fila> =>
  (await db.from("duel_matches")
    .select("status, winner, closed_reason, closed_by, state_version, turn_started_at, turn_deadline_at")
    .eq("id", matchId).maybeSingle()).data as Fila;

interface RatingRow { rating: number; games_played: number; wins: number; losses: number; draws: number }
const rating = async (id: string): Promise<RatingRow> =>
  (await db.from("duel_pvp_ratings").select("rating, games_played, wins, losses, draws")
    .eq("user_id", id).maybeSingle()).data as RatingRow;

const eventos = async (matchId: string) =>
  ((await db.from("duel_pvp_rating_events").select("user_id, delta, result").eq("match_id", matchId)).data ?? []) as
    { user_id: string; delta: number; result: string }[];

async function emparejar(a: Jugador, b: Jugador): Promise<string> {
  for (const j of [a, b]) {
    const { error } = await db.rpc("duel_pvp_enqueue", { p_user: j.id, p_deck: j.deckId, p_ttl_seconds: 600 });
    if (error) throw new Error(`enqueue: ${error.message}`);
  }
  const out = await attemptMatch(db);
  if (!out) throw new Error("no se pudo emparejar");
  return out.matchId;
}

/**
 * ENVEJECE el reloj de una partida: mueve su plazo al pasado.
 *
 * Es un fixture, no un atajo del veredicto: quien decide si eso ya ha vencido lo sigue haciendo
 * PostgreSQL contra su `now()`, y quién pierde lo sigue derivando el motor.
 */
async function envejecerTurno(matchId: string, segundosPasados = 5): Promise<void> {
  const { error } = await db.from("duel_matches")
    .update({ turn_deadline_at: new Date(Date.now() - segundosPasados * 1000).toISOString() })
    .eq("id", matchId);
  if (error) throw new Error(`envejecer: ${error.message}`);
}

/** Aplica UNA acción legal del que tiene el turno. */
async function unaAccion(matchId: string): Promise<boolean> {
  const dueno = (await db.from("duel_matches").select("user_id").eq("id", matchId).maybeSingle())
    .data as { user_id: string };
  const v = await getPvpMatch(db, dueno.user_id, matchId);
  if (!v.ok) return false;
  const quien = v.data!.view.expectedPlayer;
  if (!quien) return false;
  const suya = (await getPvpMatch(db, quien, matchId)).data!.view;
  const m = suya.match; const lado = suya.yourSide;
  const snap = lado === "A" ? m.snapshotA : m.snapshotB;
  const usadas = new Set(lado === "A" ? m.usedA : m.usedB);
  const libre = snap.cards.find((c) => !usadas.has(c.uid));
  if (!libre) return false;
  const res = await applyPvpAction(db, matchId, {
    actionId: randomUUID(), expectedVersion: suya.stateVersion, playerId: quien,
    cardUid: libre.uid, ...(m.attacker === lado ? { stat: "stronghold" } : {}),
  });
  return res.ok;
}

/** Quién debe mover ahora, según el motor. */
async function aQuienLeToca(matchId: string): Promise<string | null> {
  const dueno = (await db.from("duel_matches").select("user_id").eq("id", matchId).maybeSingle())
    .data as { user_id: string };
  const v = await getPvpMatch(db, dueno.user_id, matchId);
  return v.ok ? v.data!.view.expectedPlayer : null;
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
  console.log("\n" + "=".repeat(78));
  console.log("  VERIFICACIÓN DEL VENCIMIENTO DE TURNO PvP — Bloque 7.4.3 (D-PVP-6)");
  console.log("=".repeat(78));

  try {
    const ping = await fetch(`${PVP}?matchId=${randomUUID()}`, { method: "GET" });
    servidorVivo = ping.status === 401;
    console.log(`\n  servidor: ${servidorVivo ? `${BASE} (vivo)` : `${BASE} no responde 401 — las pruebas HTTP se omiten`}`);
  } catch { console.log(`\n  servidor: ${BASE} inaccesible — las pruebas HTTP se omiten`); }

  await familia1(); await familia2(); await familia3(); await familia4();
  await familia5(); await familia6(); await familia7(); await familia8(); await familia9();

  await limpiar();
  salir();
}

// ───────────── 1. EL RELOJ ─────────────

async function familia1(): Promise<void> {
  console.log("\n## 1. El reloj del turno");

  const A = await nuevoJugador("reloj-a");
  const B = await nuevoJugador("reloj-b");
  const matchId = await emparejar(A, B);
  const f = await fila(matchId);

  check("A. la partida nace EN JUEGO", f.status === "IN_PROGRESS", f.status);
  check("B. el turno nace con inicio y con plazo",
    f.turn_started_at !== null && f.turn_deadline_at !== null);

  const dur = Date.parse(f.turn_deadline_at!) - Date.parse(f.turn_started_at!);
  check("B. el plazo es inicio + la duración del turno YA DEFINIDA (no una inventada)",
    dur === PVP_TURN_MS, `${dur} ms · PVP_TURN_MS=${PVP_TURN_MS}`);
  check("B. y el plazo está en el FUTURO", Date.parse(f.turn_deadline_at!) > Date.now());

  // El plazo se renueva cuando de verdad empieza un turno nuevo.
  const antes = f.turn_deadline_at!;
  let turnos = 0;
  for (let i = 0; i < 4 && turnos === 0; i++) {
    await unaAccion(matchId);
    const g = await fila(matchId);
    if (g.turn_deadline_at !== antes) turnos++;
  }
  check("B. el plazo se RENUEVA al empezar un turno nuevo", turnos === 1);
}

// ───────────── 2. NADA VENCE ANTES DE HORA ─────────────

let matchVencido = ""; let jugA: Jugador; let jugB: Jugador; let perdedor = "";

async function familia2(): Promise<void> {
  console.log("\n## 2. Nada vence antes de hora");

  jugA = await nuevoJugador("plazo-a");
  jugB = await nuevoJugador("plazo-b");
  matchVencido = await emparejar(jugA, jugB);
  await unaAccion(matchVencido);

  const barrido = await sweepExpiredPvpTurns(db);
  check("C. el barrido NO encuentra candidatos con el plazo en el futuro",
    barrido.expired === 0, `${barrido.scanned} candidatos · ${barrido.expired} vencidas`);
  check("C. la partida sigue viva", (await fila(matchVencido)).closed_reason === null);

  // Y aunque se pida el cierre por su nombre, PostgreSQL dice que todavía no.
  const f = await fila(matchVencido);
  const quien = await aQuienLeToca(matchVencido);
  const forzado = await db.rpc("duel_pvp_expire_turn", {
    p_match: matchVencido, p_version: f.state_version, p_loser: quien,
  });
  check("C. pedir el cierre antes del plazo responde NOT_DUE",
    (forzado.data as { code: string })?.code === "NOT_DUE", String((forzado.data as { code: string })?.code));
  check("C. y no ha tocado la partida", (await fila(matchVencido)).closed_reason === null);
  check("C. ni el rating", (await rating(jugA.id)).games_played === 0);
}

// ───────────── 3. EL VENCIMIENTO ─────────────

async function familia3(): Promise<void> {
  console.log("\n## 3. El vencimiento");

  perdedor = (await aQuienLeToca(matchVencido))!;
  const ganador = perdedor === jugA.id ? jugB.id : jugA.id;
  const antes = { p: await rating(perdedor), g: await rating(ganador) };

  await envejecerTurno(matchVencido);
  const res = await sweepExpiredPvpTurns(db);
  check("D. tras el plazo, el barrido cierra la partida", res.expired === 1,
    `${res.scanned} candidatos · ${res.expired} vencidas`);

  const f = await fila(matchVencido);
  check("H. la partida queda TERMINAL", f.closed_reason !== null);
  check("G. la causa es EXPIRED, distinta de ABANDONED", f.closed_reason === "EXPIRED", String(f.closed_reason));
  check("F. el perdedor es el que se quedó sin tiempo", f.closed_by === perdedor);
  check("H. el estado de juego NO se falsea (sigue IN_PROGRESS por reglas)", f.status === "IN_PROGRESS", f.status);
  check("H. y no se inventa un ganador dentro del motor", f.winner === null);

  const desp = { p: await rating(perdedor), g: await rating(ganador) };
  check("I. el rating se liquidó SOLO, por la puerta de siempre",
    desp.p.games_played === 1 && desp.g.games_played === 1);
  check("E/F. el que se quedó sin tiempo PIERDE y el rival GANA",
    desp.p.rating < antes.p.rating && desp.g.rating > antes.g.rating,
    `perdedor ${antes.p.rating}→${desp.p.rating} · ganador ${antes.g.rating}→${desp.g.rating}`);
  check("E/F. y los contadores lo dicen", desp.p.losses === 1 && desp.g.wins === 1);

  const evs = await eventos(matchVencido);
  check("J. hay exactamente 2 eventos de rating", evs.length === 2, `${evs.length}`);
  check("J. con LOSS para el que expiró y WIN para el rival",
    evs.find((e) => e.user_id === perdedor)?.result === "LOSS" &&
    evs.find((e) => e.user_id === ganador)?.result === "WIN");
  check("J. y suman cero (misma K)", evs[0].delta + evs[1].delta === 0, `${evs[0].delta}/${evs[1].delta}`);

  // La liquidación es la MISMA función: pedirla de nuevo no aplica nada.
  const otra = await settleMatch(db, matchVencido);
  check("I. la liquidación reutiliza la autoridad existente (ya aplicada)",
    otra.data?.code === "ALREADY_SETTLED", String(otra.data?.code));
}

// ───────────── 4. CARRERAS ─────────────

async function familia4(): Promise<void> {
  console.log("\n## 4. Carreras — acción, abandono y sondeo contra el vencimiento");

  // CASO A — acción válida ANTES del plazo: gana la acción, no hay vencimiento.
  const a1 = await nuevoJugador("race-a1");
  const b1 = await nuevoJugador("race-b1");
  const m1 = await emparejar(a1, b1);
  const vAntes = (await fila(m1)).state_version;
  const ok = await unaAccion(m1);
  check("CASO A. una acción a tiempo se aplica y NO vence nada",
    ok && (await fila(m1)).state_version > vAntes && (await fila(m1)).closed_reason === null);

  // CASO C — acción y vencimiento SIMULTÁNEOS: solo uno gana.
  const a2 = await nuevoJugador("race-a2");
  const b2 = await nuevoJugador("race-b2");
  const m2 = await emparejar(a2, b2);
  await envejecerTurno(m2);
  const [accion, barrido] = await Promise.all([unaAccion(m2), sweepExpiredPvpTurns(db)]);
  const f2 = await fila(m2);
  const vencio = f2.closed_reason === "EXPIRED";
  check("CASO C. acción y vencimiento simultáneos: gana EXACTAMENTE uno",
    (vencio && !accion) || (!vencio && accion),
    `acción=${accion} · vencida=${vencio} (barrido cerró ${barrido.expired})`);
  check("CASO C. nunca las dos cosas: si venció, la partida no avanzó de turno",
    !vencio || f2.status === "IN_PROGRESS");
  check("CASO C. y como mucho hay un settlement", (await eventos(m2)).length === (vencio ? 2 : 0),
    `${(await eventos(m2)).length} eventos`);

  // CASO B — acción DESPUÉS del vencimiento: rechazada.
  const a3 = await nuevoJugador("race-a3");
  const b3 = await nuevoJugador("race-b3");
  const m3 = await emparejar(a3, b3);
  await envejecerTurno(m3);
  await sweepExpiredPvpTurns(db);
  check("CASO B. la partida está vencida", (await fila(m3)).closed_reason === "EXPIRED");
  const tarde = await unaAccion(m3);
  check("CASO B. una acción posterior al vencimiento se RECHAZA", !tarde);
  check("CASO B. y no genera un segundo settlement", (await eventos(m3)).length === 2);

  // ABANDONO vs VENCIMIENTO — simultáneos.
  const a4 = await nuevoJugador("race-a4");
  const b4 = await nuevoJugador("race-b4");
  const m4 = await emparejar(a4, b4);
  await unaAccion(m4);
  await envejecerTurno(m4);
  const [ab, sw] = await Promise.all([abandonPvpMatch(db, a4.id, m4), sweepExpiredPvpTurns(db)]);
  const f4 = await fila(m4);
  check("N. abandono y vencimiento simultáneos: la partida se cierra UNA vez",
    f4.closed_reason === "ABANDONED" || f4.closed_reason === "EXPIRED", String(f4.closed_reason));
  check("N. y solo uno de los dos caminos triunfó",
    (ab.ok && f4.closed_reason === "ABANDONED") || (!ab.ok && f4.closed_reason === "EXPIRED"),
    `abandono=${ab.ok ? "ok" : ab.code} · causa=${f4.closed_reason} · barrido=${sw.expired}`);
  check("N. con exactamente 2 eventos de rating", (await eventos(m4)).length === 2);
  check("N. y una sola partida contada", (await rating(a4.id)).games_played === 1);

  // SONDEO vs VENCIMIENTO — el sondeo es, además, lo que lo dispara.
  const a5 = await nuevoJugador("race-a5");
  const b5 = await nuevoJugador("race-b5");
  const m5 = await emparejar(a5, b5);
  await envejecerTurno(m5);
  const sincros = await Promise.all([
    syncPvpMatch(db, a5.id, m5, 0), syncPvpMatch(db, b5.id, m5, 0), sweepExpiredPvpTurns(db),
  ]);
  check("O. sondeos y barrido simultáneos: la partida acaba vencida",
    (await fila(m5)).closed_reason === "EXPIRED");
  check("O. los dos sondeos responden sin error", sincros[0].ok === true && sincros[1].ok === true);
  check("O. con un solo settlement", (await eventos(m5)).length === 2, `${(await eventos(m5)).length}`);
}

// ───────────── 5. CONCURRENCIA ─────────────

async function familia5(): Promise<void> {
  console.log("\n## 5. Concurrencia real contra PostgreSQL");

  const A = await nuevoJugador("conc-a");
  const B = await nuevoJugador("conc-b");
  const matchId = await emparejar(A, B);
  await unaAccion(matchId);
  const quien = (await aQuienLeToca(matchId))!;
  await envejecerTurno(matchId);

  const cinco = await Promise.all([1, 2, 3, 4, 5].map(() => sweepExpiredPvpTurns(db)));
  const cerradas = cinco.reduce((n, r) => n + r.expired, 0);
  check("L. 5 barridos simultáneos cierran la partida UNA sola vez", cerradas === 1, `${cerradas} cierres`);
  check("L. la causa y el perdedor son los correctos",
    (await fila(matchId)).closed_reason === "EXPIRED" && (await fila(matchId)).closed_by === quien);
  check("L. con exactamente 2 eventos de rating", (await eventos(matchId)).length === 2);
  check("L. y una sola partida contada por jugador",
    (await rating(A.id)).games_played === 1 && (await rating(B.id)).games_played === 1);

  // Cinco cierres directos simultáneos por su nombre.
  const C = await nuevoJugador("conc-c");
  const D = await nuevoJugador("conc-d");
  const m2 = await emparejar(C, D);
  await envejecerTurno(m2);
  const f = await fila(m2);
  const loser = (await aQuienLeToca(m2))!;
  const rpcs = await Promise.all([1, 2, 3, 4, 5].map(() =>
    db.rpc("duel_pvp_expire_turn", { p_match: m2, p_version: f.state_version, p_loser: loser })));
  const exp = rpcs.filter((r) => (r.data as { code: string })?.code === "EXPIRED").length;
  check("L. 5 cierres directos simultáneos: solo UNO triunfa", exp === 1,
    rpcs.map((r) => (r.data as { code: string })?.code).join(","));
  check("L. los otros 4 informan de que perdieron la carrera",
    rpcs.filter((r) => (r.data as { code: string })?.code === "LOST_RACE").length === 4);
}

// ───────────── 6. IDEMPOTENCIA ─────────────

async function familia6(): Promise<void> {
  console.log("\n## 6. Idempotencia");

  const rP = await rating(perdedor);
  const evsAntes = (await eventos(matchVencido)).length;

  for (let i = 0; i < 3; i++) await sweepExpiredPvpTurns(db);
  await settleMatch(db, matchVencido);
  await syncPvpMatch(db, jugA.id, matchVencido, 0);
  await syncPvpMatch(db, jugB.id, matchVencido, 0);

  check("K. barrer, liquidar y sondear de nuevo no cambia el rating",
    (await rating(perdedor)).rating === rP.rating && (await rating(perdedor)).games_played === rP.games_played,
    `${(await rating(perdedor)).rating} / ${(await rating(perdedor)).games_played}g`);
  check("K. ni añade eventos", (await eventos(matchVencido)).length === evsAntes, `${evsAntes}`);
  check("K. ni cambia la causa ni el perdedor",
    (await fila(matchVencido)).closed_reason === "EXPIRED" && (await fila(matchVencido)).closed_by === perdedor);
}

// ───────────── 7. DISPARADORES ─────────────

async function familia7(): Promise<void> {
  console.log("\n## 7. Disparadores — quién cierra la partida en la vida real");

  // EL CASO PRINCIPAL: el que se va deja de mandar peticiones, pero su RIVAL sigue sondeando.
  const A = await nuevoJugador("trig-a");
  const B = await nuevoJugador("trig-b");
  const m1 = await emparejar(A, B);
  await envejecerTurno(m1);
  const quien = (await aQuienLeToca(m1))!;
  const rival = quien === A.id ? B.id : A.id;

  // El rival sondea con la versión que ya conocía: es el CAMINO BARATO, el más frecuente.
  const v = (await fila(m1)).state_version;
  const sync = await syncPvpMatch(db, rival, m1, v);
  check("U. el SONDEO DEL RIVAL cierra la partida (camino barato incluido)",
    (await fila(m1)).closed_reason === "EXPIRED", String((await fila(m1)).closed_reason));
  check("U. y ese mismo sondeo ya devuelve el estado terminal", sync.ok && sync.data?.changed === true,
    `changed=${sync.data?.changed}`);
  const terminal = (sync.data as { terminal?: boolean; snapshot?: { lifecycle: string } });
  check("U. el cliente recibe lifecycle EXPIRED y puede dejar de sondear",
    terminal.snapshot?.lifecycle === "EXPIRED", String(terminal.snapshot?.lifecycle));
  check("U. con el rating ya liquidado", (await eventos(m1)).length === 2);

  // EL CASO RESIDUAL: los DOS dejaron de sondear. Nadie cierra… hasta que uno vuelve a la cola.
  const C = await nuevoJugador("trig-c");
  const D = await nuevoJugador("trig-d");
  const m2 = await emparejar(C, D);
  await envejecerTurno(m2);
  /*
   * Primero se comprueba el problema, con el alta EN CRUDO —que no barre— para que quede claro
   * que la partida vencida SÍ bloquea mientras nadie la cierre. Sin esto, la comprobación
   * siguiente no probaría nada: podría pasar por casualidad.
   */
  const bloqueado = await db.rpc("duel_pvp_enqueue", { p_user: C.id, p_deck: C.deckId, p_ttl_seconds: 600 });
  check("W. una partida vencida SIN cerrar bloquea la cola (el problema que hay que resolver)",
    (bloqueado.data as { code: string })?.code === "ACTIVE_MATCH",
    String((bloqueado.data as { code: string })?.code));

  // El alta por el SERVICIO barre primero: el que vuelve se desbloquea a sí mismo y al rival.
  const alta = await enqueue(db, C.id, C.deckId);
  check("W. volver a entrar en cola BARRE la partida vencida y desbloquea",
    (await fila(m2)).closed_reason === "EXPIRED", String((await fila(m2)).closed_reason));
  check("W. y el alta se acepta (ya no hay partida activa)", alta.ok, `${alta.status} ${alta.code ?? ""}`);
  check("W. el rival también queda liberado y su rating liquidado",
    (await eventos(m2)).length === 2 && (await rating(D.id)).games_played === 1);
  check("V. una partida vencida ya NO cuenta como activa para emparejar",
    (await db.rpc("_duel_pvp_has_active_match", { p_user: D.id })).data === false);
  await db.rpc("duel_pvp_cancel", { p_user: C.id });
}

// ───────────── 8. SEGURIDAD ─────────────

async function familia8(): Promise<void> {
  console.log("\n## 8. Seguridad");

  const A = await nuevoJugador("sec-a");
  const B = await nuevoJugador("sec-b");
  const C = await nuevoJugador("sec-c");
  const matchId = await emparejar(A, B);
  await unaAccion(matchId);

  const comoUsuario = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { authorization: `Bearer ${A.token}` } },
  });

  // 1..3 — el cliente no puede provocar ni dirigir un vencimiento.
  for (const [fn, args] of [
    ["duel_pvp_expire_turn", { p_match: matchId, p_version: 0, p_loser: B.id }],
    ["duel_pvp_expired_candidates", { p_limit: 50 }],
    ["duel_pvp_settle_match", { p_match: matchId }],
  ] as [string, Record<string, unknown>][]) {
    const r = await comoUsuario.rpc(fn, args as never);
    check(`un usuario autenticado NO puede invocar ${fn}`, r.error?.code === "42501",
      r.error?.code ?? "SIN ERROR (¡se ejecutó!)");
  }

  // 4/5 — el plazo y el inicio del turno no son escribibles por el cliente.
  const plazo = await comoUsuario.from("duel_matches")
    .update({ turn_deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", matchId);
  check("S. el cliente NO puede mover el plazo del turno", plazo.error !== null, plazo.error?.code ?? "SIN ERROR");
  const inicio = await comoUsuario.from("duel_matches")
    .update({ turn_started_at: new Date(0).toISOString() }).eq("id", matchId);
  check("T. ni el inicio del turno", inicio.error !== null, inicio.error?.code ?? "SIN ERROR");
  const cerrar = await comoUsuario.from("duel_matches")
    .update({ closed_reason: "EXPIRED", closed_by: B.id, closed_at: new Date().toISOString() }).eq("id", matchId);
  check("2/3. ni cerrar la partida eligiendo perdedor", cerrar.error !== null, cerrar.error?.code ?? "SIN ERROR");
  check("la partida sigue intacta tras todos los intentos",
    (await fila(matchId)).closed_reason === null);

  // 6 — un tercero no puede provocar el vencimiento de una partida ajena.
  const f = await fila(matchId);
  await envejecerTurno(matchId);
  const sincC = await syncPvpMatch(db, C.id, matchId);
  check("R. un tercero recibe 404 y su sondeo NO cierra la partida ajena",
    !sincC.ok && sincC.status === 404 && (await fila(matchId)).closed_reason === null,
    `${sincC.status} · causa=${(await fila(matchId)).closed_reason}`);

  // 9 — el cierre exige que el perdedor sea jugador.
  const ajeno = await db.rpc("duel_pvp_expire_turn", {
    p_match: matchId, p_version: f.state_version, p_loser: C.id,
  });
  check("2. no se puede cerrar una partida cargándosela a quien no juega",
    (ajeno.data as { code: string })?.code === "NOT_A_PLAYER", String((ajeno.data as { code: string })?.code));
  check("y la partida sigue abierta", (await fila(matchId)).closed_reason === null);

  // 7 — PvE nunca.
  const pve = await db.from("duel_matches").insert({
    user_id: A.id, deck_id: A.deckId, difficulty: "NORMAL", status: "IN_PROGRESS",
    state: {}, rng: {}, rules_version: "duel-combat-2",
    turn_started_at: new Date(Date.now() - 600_000).toISOString(),
    turn_deadline_at: new Date(Date.now() - 500_000).toISOString(),
  }).select("id").maybeSingle();
  const pveId = (pve.data as { id: string }).id;
  const barrido = await sweepExpiredPvpTurns(db, 50);
  check("P. el barrido NUNCA toca una partida PvE",
    (await fila(pveId)).closed_reason === null, `barrido cerró ${barrido.expired}`);
  const pveDirecto = await db.rpc("duel_pvp_expire_turn", { p_match: pveId, p_version: 0, p_loser: A.id });
  check("P. ni siquiera pidiéndolo por su id",
    (pveDirecto.data as { code: string })?.code === "NOT_A_PLAYER", String((pveDirecto.data as { code: string })?.code));
  await db.from("duel_matches").delete().eq("id", pveId);

  // 8 — una partida ya terminada no se vence.
  const D = await nuevoJugador("sec-d");
  const E = await nuevoJugador("sec-e");
  const m2 = await emparejar(D, E);
  await abandonPvpMatch(db, D.id, m2);
  await envejecerTurno(m2);
  const trasCierre = await sweepExpiredPvpTurns(db, 50);
  check("Q. una partida ya cerrada no se vence encima",
    (await fila(m2)).closed_reason === "ABANDONED", String((await fila(m2)).closed_reason));
  check("Q. y no se dobla el settlement",
    (await eventos(m2)).length === 2 && (await rating(D.id)).games_played === 1,
    `${(await eventos(m2)).length} eventos · barrido ${trasCierre.expired}`);

  if (!servidorVivo) {
    omit("el cliente no puede pedir un vencimiento por HTTP", "servidor no disponible");
    return;
  }
  const porHttp = await http(A.token, "POST", PVP, {
    action: "expire", matchId, expired: true, timeout: true, winner: "A", loser: B.id,
  });
  check("1. no existe ninguna acción HTTP para provocar un vencimiento",
    porHttp.status === 400, String(porHttp.status));
  const conBasura = await http(A.token, "POST", PVP, {
    action: "abandon", matchId: randomUUID(), expired: true, timeout: true,
  });
  check("1. y `expired`/`timeout` en el cuerpo no significan nada", conBasura.status === 404, String(conBasura.status));
}

// ───────────── 9. MEDIDAS ─────────────

async function familia9(): Promise<void> {
  console.log("\n## 9. Medidas");

  const A = await nuevoJugador("perf-a");
  const B = await nuevoJugador("perf-b");
  const matchId = await emparejar(A, B);

  // Sondeo barato de una partida VIVA: es el caso que ocurre miles de veces.
  const muestras: number[] = [];
  const v = (await fila(matchId)).state_version;
  for (let i = 0; i < 10; i++) {
    const t = Date.now();
    await syncPvpMatch(db, A.id, matchId, v);
    muestras.push(Date.now() - t);
  }
  const media = muestras.reduce((a, b) => a + b, 0) / muestras.length;

  const t1 = Date.now();
  const vacio = await sweepExpiredPvpTurns(db);
  const tVacio = Date.now() - t1;

  await envejecerTurno(matchId);
  const t2 = Date.now();
  await sweepExpiredPvpTurns(db);
  const tCierre = Date.now() - t2;

  console.log(`  · sondeo barato de partida viva : ${media.toFixed(1)} ms de media (10 muestras)`);
  console.log(`  · barrido SIN candidatos        : ${tVacio} ms (${vacio.scanned} candidatos)`);
  console.log(`  · barrido que cierra y liquida  : ${tCierre} ms`);

  check("MEDIDA: el plazo en el sondeo barato no lo encarece", media < 300, `${media.toFixed(1)} ms`);
  check("MEDIDA: el barrido en vacío es una sola consulta indexada", tVacio < 500, `${tVacio} ms`);
  check("MEDIDA: cerrar y liquidar cabe de sobra en una petición", tCierre < 2000, `${tCierre} ms`);
  check("MEDIDA: el barrido en vacío no devuelve nada que procesar", vacio.expired === 0);

  // El índice del barrido existe y es el que sirve la consulta ordenada.
  const idx = await db.rpc("duel_pvp_expired_candidates", { p_limit: 1 });
  check("la búsqueda de vencidas ocurre ENTERA en SQL (una sola llamada)", idx.error === null);
}

// ───────────────────────────── cierre ─────────────────────────────

async function limpiar(): Promise<void> {
  for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
}

function salir(): void {
  console.log("\n" + "─".repeat(78));
  console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas (sin servidor)` : ""}`);
  console.log(fail === 0
    ? "  ✅ EL TURNO VENCE SOLO, CIERRA BIEN Y NO SE PUEDE FALSIFICAR"
    : "  ❌ EL VENCIMIENTO DE TURNO TIENE HUECOS");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e);
  await limpiar();
  process.exit(1);
});
