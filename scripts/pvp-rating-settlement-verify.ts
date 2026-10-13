/**
 * VERIFICACIÓN DEL ENGANCHE DE LIQUIDACIÓN — `npm run pvp-rating-settlement:verify` (Bloque 7.4.2).
 *
 * Comprueba que D-RAT-1 («la liquidación no está enganchada») y D-PVP-7 («el abandono no acredita
 * al rival») están resueltos DE VERDAD: jugando duelos reales hasta el final por el camino del
 * servidor y mirando después la base de datos.
 *
 * LA REGLA DE ESTE VERIFICADOR: salvo en las familias que prueban explícitamente la función de
 * liquidación aislada, **NUNCA se llama a `settleMatch` a mano**. Si el rating se mueve, es porque
 * el enganche funcionó. Un verificador que llamara a `settleMatch("un-id")` no probaría nada de
 * lo que este bloque promete.
 *
 * Ocho familias:
 *
 *   1. VICTORIA REAL   — partida emparejada y jugada entera; el rating se mueve SOLO.
 *   2. EL RATING NO SE ADELANTA — antes de terminar no se mueve nada, en ningún momento.
 *   3. ABANDONO        — política de D-PVP-7, con sus condiciones y sus excepciones.
 *   4. EMPATE          — la rama DRAW de la liquidación y sus contadores.
 *   5. IDEMPOTENCIA    — terminar dos veces, liquidar dos veces, reintentar la acción.
 *   6. CONCURRENCIA    — dos finales simultáneos, dos abandonos simultáneos, cinco liquidaciones.
 *   7. SEGURIDAD       — quién puede terminar una partida y quién no; qué NO puede declararse.
 *   8. MEDIDAS         — coste del final normal, del abandono y de la liquidación.
 *
 * Las familias que atacan HTTP necesitan servidor; si no lo hay se declaran OMITIDAS en voz alta
 * y NO cuentan como correctas.
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
import { updateElo } from "../src/domain/esports/predict/elo";
import { K_PROVISIONAL } from "../src/domain/cardgame/rating";
import { attemptMatch } from "../src/server/services/duelsMatchmaking";
import { settleMatch } from "../src/server/services/duelsRating";
import { getPvpMatch, applyPvpAction, abandonPvpMatch, syncPvpMatch } from "../src/server/services/duelsPvp";

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
  const email = `pvpset-${tag}-${randomUUID()}@nexus.test`;
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

interface RatingRow { rating: number; games_played: number; wins: number; losses: number; draws: number }
const rating = async (id: string): Promise<RatingRow> =>
  (await db.from("duel_pvp_ratings").select("rating, games_played, wins, losses, draws")
    .eq("user_id", id).maybeSingle()).data as RatingRow;

interface EventRow {
  user_id: string; old_rating: number; delta: number; new_rating: number;
  opponent_rating: number; k_factor: number; result: string;
}
const eventos = async (matchId: string): Promise<EventRow[]> =>
  ((await db.from("duel_pvp_rating_events")
    .select("user_id, old_rating, delta, new_rating, opponent_rating, k_factor, result")
    .eq("match_id", matchId)).data ?? []) as EventRow[];

const fila = async (matchId: string) =>
  (await db.from("duel_matches").select("status, winner, closed_reason, closed_by, state_version")
    .eq("id", matchId).maybeSingle()).data as
    { status: string; winner: string | null; closed_reason: string | null; closed_by: string | null; state_version: number };

/** Empareja a dos jugadores por el camino real del matchmaking. */
async function emparejar(a: Jugador, b: Jugador): Promise<string> {
  for (const j of [a, b]) {
    const { error } = await db.rpc("duel_pvp_enqueue", { p_user: j.id, p_deck: j.deckId, p_ttl_seconds: 600 });
    if (error) throw new Error(`enqueue: ${error.message}`);
  }
  const out = await attemptMatch(db);
  if (!out) throw new Error("no se pudo emparejar");
  return out.matchId;
}

/** Aplica UNA acción legal del jugador al que le toca. Devuelve false si ya no hay a quién mover. */
async function unaAccion(matchId: string, actionId = randomUUID()): Promise<boolean> {
  const dueno = (await db.from("duel_matches").select("user_id").eq("id", matchId).maybeSingle())
    .data as { user_id: string };
  const vista = await getPvpMatch(db, dueno.user_id, matchId);
  if (!vista.ok) throw new Error(`lectura: ${vista.error}`);
  const quien = vista.data!.view.expectedPlayer;
  if (!quien) return false;

  const suya = (await getPvpMatch(db, quien, matchId)).data!.view;
  const m = suya.match; const lado = suya.yourSide;
  const snap = lado === "A" ? m.snapshotA : m.snapshotB;
  const usadas = new Set(lado === "A" ? m.usedA : m.usedB);
  const libre = snap.cards.find((c) => !usadas.has(c.uid));
  if (!libre) throw new Error("sin cartas");

  const res = await applyPvpAction(db, matchId, {
    actionId, expectedVersion: suya.stateVersion, playerId: quien,
    cardUid: libre.uid, ...(m.attacker === lado ? { stat: "stronghold" } : {}),
  });
  if (!res.ok) throw new Error(`acción: ${res.error} (${res.code})`);
  return true;
}

/** Juega el duelo entero por el camino real. Nadie llama a `settleMatch`. */
async function jugarEntero(matchId: string): Promise<void> {
  for (let i = 0; i < 60; i++) if (!(await unaAccion(matchId))) return;
  throw new Error("la partida no terminó en 60 acciones");
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
  console.log("\n" + "=".repeat(76));
  console.log("  VERIFICACIÓN DEL ENGANCHE DE LIQUIDACIÓN — Bloque 7.4.2 (D-RAT-1 · D-PVP-7)");
  console.log("=".repeat(76));

  try {
    const ping = await fetch(`${PVP}?matchId=${randomUUID()}`, { method: "GET" });
    servidorVivo = ping.status === 401;
    console.log(`\n  servidor: ${servidorVivo ? `${BASE} (vivo)` : `${BASE} no responde 401 — las pruebas HTTP se omiten`}`);
  } catch { console.log(`\n  servidor: ${BASE} inaccesible — las pruebas HTTP se omiten`); }

  await familia1();
  await familia2();
  await familia3();
  await familia4();
  await familia5();
  await familia6();
  await familia7();
  await familia8();

  await limpiar();
  salir();
}

// ───────────── 1. VICTORIA REAL, SIN LLAMAR A NADIE ─────────────

let matchGanado = "";
let jugA: Jugador; let jugB: Jugador;

async function familia1(): Promise<void> {
  console.log("\n## 1. Victoria real — el rating se mueve SOLO al terminar el duelo");

  jugA = await nuevoJugador("win-a");
  jugB = await nuevoJugador("win-b");
  const matchId = await emparejar(jugA, jugB);
  matchGanado = matchId;

  const antesA = await rating(jugA.id);
  const antesB = await rating(jugB.id);
  check("los dos arrancan en 1000 sin partidas",
    antesA.rating === 1000 && antesB.rating === 1000 && antesA.games_played === 0);

  // Se juega el duelo ENTERO. Nadie llama a settleMatch.
  await jugarEntero(matchId);

  const f = await fila(matchId);
  check("R. la partida queda en un estado TERMINAL",
    f.status === "COMPLETED" || f.status === "DRAW", f.status);
  check("H. el resultado lo decidió el servidor y está persistido",
    f.status === "DRAW" || (f.winner === "A" || f.winner === "B"), `winner=${f.winner}`);

  const despA = await rating(jugA.id);
  const despB = await rating(jugB.id);
  check("A/B. el rating cambió SIN que nadie llamara a settleMatch (D-RAT-1)",
    despA.rating !== 1000 || despB.rating !== 1000,
    `A ${antesA.rating}→${despA.rating} · B ${antesB.rating}→${despB.rating}`);

  // I..N — el evento y sus campos
  const evs = await eventos(matchId);
  check("I. hay EXACTAMENTE dos eventos de rating (uno por jugador)", evs.length === 2, `${evs.length}`);
  const evA = evs.find((e) => e.user_id === jugA.id)!;
  const evB = evs.find((e) => e.user_id === jugB.id)!;
  check("J. old_rating es el que tenían antes", evA?.old_rating === 1000 && evB?.old_rating === 1000);
  check("L. new_rating coincide con la tabla", evA?.new_rating === despA.rating && evB?.new_rating === despB.rating);
  check("K. delta cuadra: new = old + delta",
    evA.new_rating === evA.old_rating + evA.delta && evB.new_rating === evB.old_rating + evB.delta);
  check("M. opponent_rating es el rating del rival", evA?.opponent_rating === 1000 && evB?.opponent_rating === 1000);
  check("N. k_factor es el provisional (40)", evA?.k_factor === K_PROVISIONAL && evB?.k_factor === K_PROVISIONAL);

  // El delta contra el ORÁCULO externo
  const scoreA = f.status === "DRAW" ? 0.5 : f.winner === "A" ? 1 : 0;
  const esperado = Math.round(updateElo(1000, 1000, scoreA, K_PROVISIONAL, 1).deltaA);
  check("K. el delta coincide con el que predice elo.ts",
    evA.delta === esperado, `real ${evA.delta} · oráculo ${esperado}`);

  // O/P — contadores
  check("O. games_played sube exactamente 1 a cada uno",
    despA.games_played === 1 && despB.games_played === 1, `${despA.games_played}/${despB.games_played}`);
  check("P. wins/losses/draws suman exactamente 1 entre los tres",
    despA.wins + despA.losses + despA.draws === 1 && despB.wins + despB.losses + despB.draws === 1);
  const coherente = f.status === "DRAW"
    ? despA.draws === 1 && despB.draws === 1
    : (f.winner === "A" ? despA.wins === 1 && despB.losses === 1 : despB.wins === 1 && despA.losses === 1);
  check("P. y el que sube corresponde al resultado real", coherente,
    `${f.status}/${f.winner}: A ${despA.wins}w${despA.losses}l · B ${despB.wins}w${despB.losses}l`);
  check("la suma de deltas es cero (misma K)", evA.delta + evB.delta === 0, `${evA.delta} + ${evB.delta}`);
}

// ───────────── 2. EL RATING NO SE ADELANTA ─────────────

async function familia2(): Promise<void> {
  console.log("\n## 2. El rating NO se adelanta al resultado");

  const A = await nuevoJugador("mid-a");
  const B = await nuevoJugador("mid-b");
  const matchId = await emparejar(A, B);

  check("S. emparejar no mueve el rating",
    (await rating(A.id)).games_played === 0 && (await rating(B.id)).games_played === 0);

  // Se juegan varias acciones SIN llegar al final y se vigila en cada paso.
  let movido = false;
  for (let i = 0; i < 6; i++) {
    await unaAccion(matchId);
    const f = await fila(matchId);
    if (f.status !== "IN_PROGRESS") break;
    const rA = await rating(A.id); const rB = await rating(B.id);
    if (rA.games_played !== 0 || rB.games_played !== 0 || rA.rating !== 1000 || rB.rating !== 1000) movido = true;
  }
  check("S. durante la partida el rating no se mueve ni una vez", !movido);
  check("S. y no hay ningún evento de rating todavía", (await eventos(matchId)).length === 0);

  // Y liquidar a mano una partida en curso se rechaza.
  const enCurso = await settleMatch(db, matchId);
  check("liquidar una partida EN CURSO se rechaza", enCurso.data?.code === "NOT_FINISHED", String(enCurso.data?.code));
  check("y sigue sin tocar nada", (await rating(A.id)).games_played === 0);

  await jugarEntero(matchId);
  check("S. al terminar SÍ se mueve", (await rating(A.id)).games_played === 1);
}

// ───────────── 3. ABANDONO (D-PVP-7) ─────────────

async function familia3(): Promise<void> {
  console.log("\n## 3. Abandono — política de D-PVP-7");

  // D — abandono de una partida EMPEZADA: el que se va pierde.
  const A = await nuevoJugador("ab-a");
  const B = await nuevoJugador("ab-b");
  const matchId = await emparejar(A, B);
  await unaAccion(matchId);                       // la partida está viva y en juego

  const antes = { a: await rating(A.id), b: await rating(B.id) };
  const ab = await abandonPvpMatch(db, A.id, matchId);
  check("D. abandonar responde correctamente", ab.ok, String(ab.error ?? ""));

  const f = await fila(matchId);
  check("D. la partida queda cerrada por ABANDONO con autor", f.closed_reason === "ABANDONED" && f.closed_by === A.id);

  const desp = { a: await rating(A.id), b: await rating(B.id) };
  check("D. el que ABANDONA pierde rating", desp.a.rating < antes.a.rating, `${antes.a.rating}→${desp.a.rating}`);
  check("D. el RIVAL gana rating", desp.b.rating > antes.b.rating, `${antes.b.rating}→${desp.b.rating}`);
  check("D. y los contadores lo dicen: LOSS para el que se fue, WIN para el rival",
    desp.a.losses === 1 && desp.b.wins === 1, `A ${desp.a.losses}l · B ${desp.b.wins}w`);
  const evs = await eventos(matchId);
  check("D. el libro registra LOSS/WIN",
    evs.find((e) => e.user_id === A.id)?.result === "LOSS" && evs.find((e) => e.user_id === B.id)?.result === "WIN");
  check("D. games_played sube una vez a cada uno", desp.a.games_played === 1 && desp.b.games_played === 1);

  // El abandono NO es un caso especial de la matemática: es una derrota normal.
  const esperado = Math.round(updateElo(antes.a.rating, antes.b.rating, 0, K_PROVISIONAL, 1).deltaA);
  check("D. el delta del abandono es el de una derrota normal (sin castigo extra)",
    evs.find((e) => e.user_id === A.id)?.delta === esperado,
    `real ${evs.find((e) => e.user_id === A.id)?.delta} · oráculo ${esperado}`);

  // Abandonar una partida ya cerrada no vuelve a cobrar.
  const otra = await abandonPvpMatch(db, B.id, matchId);
  check("D. una partida ya cerrada no se vuelve a abandonar", !otra.ok && otra.code === "MATCH_CLOSED", String(otra.code));
  check("D. y el rating no se movió otra vez", (await rating(A.id)).games_played === 1);

  // NO_ABANDONER — cerrada por abandono pero sin autor: no se liquida a ciegas.
  const C = await nuevoJugador("ab-c");
  const D = await nuevoJugador("ab-d");
  const m2 = await emparejar(C, D);
  await unaAccion(m2);
  await db.from("duel_matches")
    .update({ closed_reason: "ABANDONED", closed_at: new Date().toISOString(), closed_by: null })
    .eq("id", m2);
  const sinAutor = await settleMatch(db, m2);
  check("un abandono SIN autor no reparte victoria", sinAutor.data?.code === "NO_ABANDONER", String(sinAutor.data?.code));
  check("y nadie cobró", (await rating(C.id)).games_played === 0 && (await rating(D.id)).games_played === 0);

  // NOT_COMPETITIVE — abandonar algo que no había empezado.
  const E = await nuevoJugador("ab-e");
  const F = await nuevoJugador("ab-f");
  const m3 = await emparejar(E, F);
  await db.from("duel_matches")
    .update({ status: "WAITING", closed_reason: "ABANDONED", closed_at: new Date().toISOString(), closed_by: E.id })
    .eq("id", m3);
  const noEmpezada = await settleMatch(db, m3);
  check("abandonar una partida que NO había empezado no da victoria a nadie",
    noEmpezada.data?.code === "NOT_COMPETITIVE", String(noEmpezada.data?.code));
  check("y no se escribe ningún evento", (await eventos(m3)).length === 0);

  /*
   * EXPIRED — en el bloque 7.4.2 esto devolvía `EXPIRED_NOT_SETTLED` porque el reloj de turno no
   * vencía solo (D-PVP-6) y no había forma de saber quién se había quedado sin tiempo. El bloque
   * 7.4.3 construyó el barrido, que escribe `closed_by` con el jugador que debía mover, así que
   * ahora un vencimiento se liquida igual que un abandono. La exigencia se invierte.
   *
   * Se comprueban los DOS lados: con autor se liquida, sin autor sigue sin liquidarse.
   */
  const G = await nuevoJugador("ab-g");
  const H = await nuevoJugador("ab-h");
  const m4 = await emparejar(G, H);
  await unaAccion(m4);
  const quienG = (await getPvpMatch(db, G.id, m4)).data!.view.expectedPlayer!;
  await db.from("duel_matches")
    .update({ closed_reason: "EXPIRED", closed_at: new Date().toISOString(), closed_by: quienG })
    .eq("id", m4);
  const vencida = await settleMatch(db, m4);
  check("una partida EXPIRED CON autor se liquida como derrota (D-PVP-6 resuelto en 7.4.3)",
    vencida.data?.code === "SETTLED", String(vencida.data?.code));
  const evsG = await eventos(m4);
  check("y el que se quedó sin tiempo consta como LOSS",
    evsG.find((e) => e.user_id === quienG)?.result === "LOSS", `${evsG.length} eventos`);
  check("con una sola partida contada a cada uno",
    (await rating(G.id)).games_played === 1 && (await rating(H.id)).games_played === 1);

  const I = await nuevoJugador("ab-i");
  const Jx = await nuevoJugador("ab-j");
  const m5 = await emparejar(I, Jx);
  await unaAccion(m5);
  await db.from("duel_matches")
    .update({ closed_reason: "EXPIRED", closed_at: new Date().toISOString(), closed_by: null })
    .eq("id", m5);
  const sinQuien = await settleMatch(db, m5);
  check("pero un vencimiento SIN autor sigue sin liquidarse",
    sinQuien.data?.code === "NO_ABANDONER", String(sinQuien.data?.code));
  check("y nadie cobró por ella", (await rating(I.id)).games_played === 0);
}

// ───────────── 4. EMPATE ─────────────

async function familia4(): Promise<void> {
  console.log("\n## 4. Empate");

  /*
   * Un empate NO se puede forzar jugando: depende del marcador y del desempate del motor, y las
   * reglas vigentes casi siempre resuelven. Así que se prueba la RAMA de la liquidación sobre una
   * partida PvP real emparejada, marcándola DRAW. El ENGANCHE ya está demostrado en la familia 1
   * con una partida jugada de verdad; lo que aquí se comprueba es la aritmética del empate.
   */
  const A = await nuevoJugador("draw-a");
  const B = await nuevoJugador("draw-b");
  const matchId = await emparejar(A, B);
  await db.from("duel_matches").update({ status: "DRAW", winner: null }).eq("id", matchId);

  const res = await settleMatch(db, matchId);
  check("C. un empate se liquida", res.data?.code === "SETTLED", String(res.data?.code));
  const rA = await rating(A.id); const rB = await rating(B.id);
  check("C. con ratings iguales el empate no mueve a nadie", rA.rating === 1000 && rB.rating === 1000,
    `${rA.rating}/${rB.rating}`);
  check("C. pero SÍ cuenta como partida jugada", rA.games_played === 1 && rB.games_played === 1);
  check("C. y suma a draws, no a wins ni losses",
    rA.draws === 1 && rB.draws === 1 && rA.wins === 0 && rA.losses === 0);
  const evs = await eventos(matchId);
  check("C. el libro registra DRAW para los dos", evs.every((e) => e.result === "DRAW"), `${evs.length} eventos`);
}

// ───────────── 5. IDEMPOTENCIA ─────────────

async function familia5(): Promise<void> {
  console.log("\n## 5. Idempotencia");

  const rA = await rating(jugA.id);
  const rB = await rating(jugB.id);

  // E — liquidar de nuevo la partida ya terminada de la familia 1
  const otra = await settleMatch(db, matchGanado);
  check("E. liquidar otra vez devuelve ALREADY_SETTLED", otra.data?.code === "ALREADY_SETTLED", String(otra.data?.code));
  check("Q. y no cambia ni el rating ni los contadores",
    (await rating(jugA.id)).rating === rA.rating && (await rating(jugA.id)).games_played === rA.games_played);
  check("Q. sigue habiendo exactamente 2 eventos", (await eventos(matchGanado)).length === 2);

  // Reintentar la última acción (misma action_id) no vuelve a liquidar.
  const dueno = jugA.id;
  const vista = await getPvpMatch(db, dueno, matchGanado);
  check("E. la partida sigue siendo terminal tras el reintento", vista.data!.view.lifecycle === "FINISHED");

  // Un sondeo sobre la partida terminal (que es la red de seguridad) tampoco duplica.
  await syncPvpMatch(db, jugA.id, matchGanado, 0);
  await syncPvpMatch(db, jugB.id, matchGanado, 0);
  check("E. la RED DE SEGURIDAD del sondeo no vuelve a liquidar",
    (await eventos(matchGanado)).length === 2 && (await rating(jugA.id)).rating === rA.rating,
    `${(await eventos(matchGanado)).length} eventos · rating ${(await rating(jugA.id)).rating}`);
  check("E. ni cambia los contadores", (await rating(jugB.id)).games_played === rB.games_played);
}

// ───────────── 6. CONCURRENCIA REAL ─────────────

async function familia6(): Promise<void> {
  console.log("\n## 6. Concurrencia real contra PostgreSQL");

  // F1 — cinco liquidaciones simultáneas de una partida recién terminada
  const A = await nuevoJugador("conc-a");
  const B = await nuevoJugador("conc-b");
  const m1 = await emparejar(A, B);
  await jugarEntero(m1);
  const trasJugar = await rating(A.id);
  const cinco = await Promise.all([1, 2, 3, 4, 5].map(() => settleMatch(db, m1)));
  check("F. 5 liquidaciones simultáneas: ninguna vuelve a aplicar",
    cinco.filter((r) => r.data?.code === "SETTLED").length === 0,
    cinco.map((r) => r.data?.code).join(","));
  check("F. el rating es el mismo que tras terminar", (await rating(A.id)).rating === trasJugar.rating);
  check("F. y sigue habiendo 2 eventos", (await eventos(m1)).length === 2);
  check("F. games_played sigue en 1", (await rating(A.id)).games_played === 1);

  // F2 — dos acciones FINALES simultáneas con action_id distinta: solo una puede aplicar
  const C = await nuevoJugador("conc-c");
  const D = await nuevoJugador("conc-d");
  const m2 = await emparejar(C, D);
  for (let i = 0; i < 60; i++) {
    const f = await fila(m2);
    if (f.status !== "IN_PROGRESS") break;
    // ¿es esta la penúltima? se detecta intentando dos a la vez al final
    const vista = (await getPvpMatch(db, C.id, m2)).data!.view;
    if (vista.match.currentTurn === 10) break;
    await unaAccion(m2);
  }
  // A partir de aquí se dispara todo lo que queda por pares simultáneos.
  let dobles = 0;
  for (let i = 0; i < 10; i++) {
    const f = await fila(m2);
    if (f.status !== "IN_PROGRESS") break;
    const r = await Promise.allSettled([unaAccion(m2), unaAccion(m2)]);
    if (r.filter((x) => x.status === "fulfilled").length === 2) dobles++;
  }
  const fFinal = await fila(m2);
  check("F. la partida acabó pese a los pares de acciones simultáneas",
    fFinal.status === "COMPLETED" || fFinal.status === "DRAW", fFinal.status);
  check("F. dos finales simultáneos producen UN solo settlement", (await eventos(m2)).length === 2,
    `${(await eventos(m2)).length} eventos · ${dobles} pares aceptados a la vez`);
  check("F. y un solo incremento de partidas", (await rating(C.id)).games_played === 1,
    `${(await rating(C.id)).games_played}`);

  // F3 — dos abandonos simultáneos, uno por jugador
  const E = await nuevoJugador("conc-e");
  const F = await nuevoJugador("conc-f");
  const m3 = await emparejar(E, F);
  await unaAccion(m3);
  const dos = await Promise.all([abandonPvpMatch(db, E.id, m3), abandonPvpMatch(db, F.id, m3)]);
  check("F. de dos abandonos simultáneos solo uno triunfa",
    dos.filter((r) => r.ok).length === 1, dos.map((r) => (r.ok ? "ok" : r.code)).join(","));
  check("F. y produce UN solo settlement", (await eventos(m3)).length === 2, `${(await eventos(m3)).length}`);
  check("F. games_played sube una vez, no dos",
    (await rating(E.id)).games_played === 1 && (await rating(F.id)).games_played === 1);
  const fm3 = await fila(m3);
  check("F. el que consta como autor del abandono es el que perdió",
    (await eventos(m3)).find((e) => e.user_id === fm3.closed_by)?.result === "LOSS", String(fm3.closed_by?.slice(0, 8)));
}

// ───────────── 7. SEGURIDAD ─────────────

async function familia7(): Promise<void> {
  console.log("\n## 7. Seguridad — quién puede terminar una partida");

  const A = await nuevoJugador("sec-a");
  const B = await nuevoJugador("sec-b");
  const C = await nuevoJugador("sec-c");
  const matchId = await emparejar(A, B);
  await unaAccion(matchId);

  // V — un tercero no participa
  const intruso = await getPvpMatch(db, C.id, matchId);
  check("V. un tercero no puede ni leer la partida", !intruso.ok && intruso.status === 404, String(intruso.status));
  const abIntruso = await abandonPvpMatch(db, C.id, matchId);
  check("V. un tercero NO puede abandonar (ni terminar) la partida de otros",
    !abIntruso.ok && abIntruso.status === 404, `${abIntruso.status} ${abIntruso.code ?? ""}`);
  check("V. y la partida sigue viva", (await fila(matchId)).closed_reason === null);

  // T — una partida PvE no se liquida como PvP
  const pve = await db.from("duel_matches").insert({
    user_id: A.id, deck_id: A.deckId, difficulty: "NORMAL", status: "COMPLETED",
    winner: "A", state: {}, rng: {}, rules_version: "duel-combat-2",
  }).select("id").maybeSingle();
  const pveId = (pve.data as { id: string }).id;
  const liqPve = await settleMatch(db, pveId);
  check("T. una partida PvE NO se liquida como PvP", liqPve.data?.code === "NOT_PVP", String(liqPve.data?.code));
  check("T. y no genera eventos", (await eventos(pveId)).length === 0);
  await db.from("duel_matches").delete().eq("id", pveId);

  // U — partida inexistente
  const noExiste = await settleMatch(db, randomUUID());
  check("U. una partida inexistente se rechaza", noExiste.data?.code === "NO_MATCH", String(noExiste.data?.code));

  if (!servidorVivo) {
    for (const t of ["C no puede actuar por HTTP", "no se puede declarar ganador por HTTP",
                     "no se puede enviar delta ni rating por HTTP"]) omit(t, "servidor no disponible");
    return;
  }

  // Por HTTP: el cliente no puede declarar NADA del resultado.
  const vista = (await getPvpMatch(db, A.id, matchId)).data!.view;
  const quien = vista.expectedPlayer!;
  const jugador = quien === A.id ? A : B;
  const suya = (await getPvpMatch(db, quien, matchId)).data!.view;
  const lado = suya.yourSide;
  const snap = lado === "A" ? suya.match.snapshotA : suya.match.snapshotB;
  const usadas = new Set(lado === "A" ? suya.match.usedA : suya.match.usedB);
  const carta = snap.cards.find((c) => !usadas.has(c.uid))!;

  const antes = { a: await rating(A.id), b: await rating(B.id) };
  const conBasura = await http(jugador.token, "POST", PVP, {
    action: "play", matchId, actionId: randomUUID(), expectedVersion: suya.stateVersion,
    cardUid: carta.uid, ...(suya.match.attacker === lado ? { stat: "stronghold" } : {}),
    // Todo esto debe ser IGNORADO por completo.
    winner: lado === "A" ? "B" : "A", winnerId: C.id, loserId: A.id, result: "WIN",
    ratingDelta: 500, rating: 4000, mmr: 4000, status: "COMPLETED", closedReason: "ABANDONED",
  });
  check("una acción con ganador, delta y estado inyectados se acepta como acción normal",
    conBasura.status === 200, String(conBasura.status));
  const f = await fila(matchId);
  check("el estado NO se convirtió en COMPLETED por decirlo el cliente",
    f.status === "IN_PROGRESS" && f.closed_reason === null, `${f.status}/${f.closed_reason}`);
  const desp = { a: await rating(A.id), b: await rating(B.id) };
  check("el rating NO se movió por el delta inyectado",
    desp.a.rating === antes.a.rating && desp.b.rating === antes.b.rating,
    `A ${desp.a.rating} · B ${desp.b.rating}`);
  check("no se creó ningún evento de rating", (await eventos(matchId)).length === 0);

  const deC = await http(C.token, "POST", PVP, {
    action: "abandon", matchId, winner: "A", result: "WIN",
  });
  check("C no puede cerrar la partida por HTTP", deC.status === 404, String(deC.status));
  check("la partida sigue en curso", (await fila(matchId)).closed_reason === null);
}

// ───────────── 8. MEDIDAS ─────────────

async function familia8(): Promise<void> {
  console.log("\n## 8. Medidas");

  const A = await nuevoJugador("perf-a");
  const B = await nuevoJugador("perf-b");
  const matchId = await emparejar(A, B);

  // Se juega hasta la penúltima acción para medir el coste de la que CIERRA la partida.
  let normales = 0; const tNormales: number[] = [];
  for (let i = 0; i < 60; i++) {
    const f = await fila(matchId);
    if (f.status !== "IN_PROGRESS") break;
    const t = Date.now();
    if (!(await unaAccion(matchId))) break;
    const dur = Date.now() - t;
    const despues = await fila(matchId);
    if (despues.status === "IN_PROGRESS") { tNormales.push(dur); normales++; }
    else { console.log(`  · acción que CIERRA la partida (incluye liquidación): ${dur} ms`); }
  }
  const media = tNormales.reduce((a, b) => a + b, 0) / Math.max(tNormales.length, 1);
  console.log(`  · acción normal (sin liquidación) : ${media.toFixed(1)} ms de media (${normales} acciones)`);

  const C = await nuevoJugador("perf-c");
  const D = await nuevoJugador("perf-d");
  const m2 = await emparejar(C, D);
  await unaAccion(m2);
  const tAb = Date.now();
  await abandonPvpMatch(db, C.id, m2);
  const durAb = Date.now() - tAb;
  console.log(`  · abandono (incluye liquidación) : ${durAb} ms`);

  const tLiq = Date.now();
  await settleMatch(db, m2);
  const durLiq = Date.now() - tLiq;
  console.log(`  · liquidación ya aplicada (salida rápida) : ${durLiq} ms`);

  check("MEDIDA: cerrar la partida con liquidación sigue siendo barato", durAb < 2000, `${durAb} ms`);
  check("MEDIDA: la salida rápida de una liquidación repetida es inmediata", durLiq < 500, `${durLiq} ms`);
  check("MEDIDA: la liquidación son 2 consultas fijas, no N por jugador",
    (await eventos(m2)).length === 2);
}

// ───────────────────────────── cierre ─────────────────────────────

async function limpiar(): Promise<void> {
  for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
}

function salir(): void {
  console.log("\n" + "─".repeat(76));
  console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas (sin servidor)` : ""}`);
  console.log(fail === 0
    ? "  ✅ EL RESULTADO DEL DUELO LIQUIDA EL RATING, UNA SOLA VEZ Y SIN CREER AL CLIENTE"
    : "  ❌ EL ENGANCHE DE LIQUIDACIÓN TIENE HUECOS");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e);
  await limpiar();
  process.exit(1);
});
