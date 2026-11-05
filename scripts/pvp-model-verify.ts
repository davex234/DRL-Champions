/**
 * VERIFICACIÓN DEL MODELO PvP — `npm run pvp:verify` (Bloque 7.2).
 *
 * Ataca `duel_matches` y `duel_match_actions` contra la base de datos REAL, con DOS cuentas
 * de verdad. Lo que se comprueba aquí no es que TypeScript valide: es que **la base de datos
 * y el servicio se nieguen**. Una defensa que solo vive en Node se salta con otro cliente.
 *
 * Cuatro familias:
 *
 *   MODELO       — dos jugadores reales, bandos decididos por el servidor, A ≠ B.
 *   PROPIEDAD    — cada mazo es de su dueño; el mazo del rival no se puede usar ni ver.
 *   CONCURRENCIA — `state_version` excluye la segunda escritura; `action_id` es idempotente.
 *   CICLO/SECRETO— los estados terminales rechazan acciones, el abandono NO borra la fila y
 *                  ninguna proyección lleva las cartas ocultas del rival.
 *
 * Crea sus propias cuentas, cartas, mazos y partidas, y lo borra todo al terminar.
 *
 * NO comprueba matchmaking, transporte ni recompensas PvP: nada de eso existe todavía.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { CardRegistry } from "../src/collection/registry";
import { DUEL_ROLES } from "../src/domain/cardgame";
import type { RoleId } from "../src/domain/cards/types";
import {
  createPvpMatch, getPvpMatch, applyPvpAction, abandonPvpMatch, PVP_TURN_MS,
} from "../src/server/services/duelsPvp";
import { startMatch as startPveMatch } from "../src/server/services/duels";

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
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

// ───────────────────────────── utillaje ─────────────────────────────

const registry = new CardRegistry();

/** Diez cartas legales (2 por rol) de un bloque del catálogo, para que A y B no coincidan. */
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

async function nuevoJugador(tag: string, block: number): Promise<{ id: string; deckId: string; email: string; password: string }> {
  const email = `pvp-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`no se pudo crear la cuenta: ${error?.message}`);
  const id = data.user.id;
  creadas.push(id);

  const rows = deckCardIds(block).map((cardId) => ({ uid: randomUUID(), user_id: id, card_id: cardId }));
  const ins = await db.from("user_cards").insert(rows);
  if (ins.error) throw new Error(`no se pudieron dar cartas: ${ins.error.message}`);

  const deck = await db.from("duel_decks")
    .insert({ user_id: id, name: `Mazo ${tag}`, card_uids: rows.map((r) => r.uid) })
    .select("id").maybeSingle();
  if (deck.error || !deck.data) throw new Error(`no se pudo crear el mazo: ${deck.error?.message}`);
  return { id, deckId: (deck.data as { id: string }).id, email, password };
}

/** Lee la fila cruda. Solo para comprobar lo que de verdad quedó guardado. */
async function fila(matchId: string) {
  const { data } = await db.from("duel_matches")
    .select("id, mode, user_id, player_b_id, deck_id, deck_b_id, status, state_version, closed_reason, closed_by, closed_at, turn_started_at, turn_deadline_at")
    .eq("id", matchId).maybeSingle();
  return data as Record<string, unknown> | null;
}

// ───────────────────────────── ejecución ─────────────────────────────

async function main(): Promise<void> {
  console.log("# Verificación del modelo de partida PvP — NEXUS (Bloque 7.2)\n");

  const A = await nuevoJugador("a", 0);
  const B = await nuevoJugador("b", 1);

  // ─────────────── 1. MODELO ───────────────
  console.log("## 1. Modelo de dos jugadores");

  const created = await createPvpMatch(db, { playerId: A.id, deckId: A.deckId }, { playerId: B.id, deckId: B.deckId });
  check("CREAR: dos usuarios reales producen una partida PvP", created.ok, created.error ?? "");
  if (!created.ok || !created.data) { await limpiar(); return salir(); }
  const matchId = created.data.view.matchId;

  const row = await fila(matchId);
  check("MODELO: la fila identifica A y B explícitamente",
    !!row && row.mode === "PVP" && row.user_id === A.id && row.player_b_id === B.id,
    `A=${String(row?.user_id).slice(0, 8)} B=${String(row?.player_b_id).slice(0, 8)}`);
  check("MODELO: cada bando guarda SU mazo",
    !!row && row.deck_id === A.deckId && row.deck_b_id === B.deckId);
  check("MODELO: el servidor asigna el bando; el cliente no lo elige",
    created.data.view.yourSide === "A");
  check("MODELO: nace con state_version 0 y reloj de turno del servidor",
    row?.state_version === 0 && row?.turn_started_at !== null && row?.turn_deadline_at !== null,
    `v=${String(row?.state_version)} turnMs=${PVP_TURN_MS}`);

  const mismo = await createPvpMatch(db, { playerId: A.id, deckId: A.deckId }, { playerId: A.id, deckId: A.deckId });
  check("SEGURIDAD: player_a === player_b se rechaza", !mismo.ok && mismo.code === "SAME_PLAYER");

  // La restricción de base de datos, no solo el servicio.
  const rawSame = await db.from("duel_matches").insert({
    mode: "PVP", user_id: A.id, player_b_id: A.id, deck_id: A.deckId, deck_b_id: A.deckId,
    difficulty: "NORMAL", status: "IN_PROGRESS", state: {}, rng: {}, rules_version: "x",
  });
  check("SEGURIDAD: la BASE DE DATOS también prohíbe A contra A",
    !!rawSame.error, rawSame.error?.code ?? "no falló");

  const rawPveWithB = await db.from("duel_matches").insert({
    mode: "PVE", user_id: A.id, player_b_id: B.id, deck_id: A.deckId,
    difficulty: "NORMAL", status: "IN_PROGRESS", state: {}, rng: {}, rules_version: "x",
  });
  check("SEGURIDAD: una fila PvE no puede llevar jugador B (no se falsean PvP)",
    !!rawPveWithB.error, rawPveWithB.error?.code ?? "no falló");

  // ─────────────── 2. PROPIEDAD ───────────────
  console.log("\n## 2. Propiedad de mazo (server-side)");

  const aUsaMazoDeB = await createPvpMatch(db, { playerId: A.id, deckId: B.deckId }, { playerId: B.id, deckId: B.deckId });
  check("SEGURIDAD: A no puede jugar con el mazo de B", !aUsaMazoDeB.ok, aUsaMazoDeB.code ?? "");
  const bUsaMazoDeA = await createPvpMatch(db, { playerId: A.id, deckId: A.deckId }, { playerId: B.id, deckId: A.deckId });
  check("SEGURIDAD: B no puede jugar con el mazo de A", !bUsaMazoDeA.ok, bUsaMazoDeA.code ?? "");
  const inventado = await createPvpMatch(db, { playerId: A.id, deckId: randomUUID() }, { playerId: B.id, deckId: B.deckId });
  check("SEGURIDAD: un mazo inexistente no crea partida", !inventado.ok);

  // ─────────────── 3. LECTURA Y SECRETO ───────────────
  console.log("\n## 3. Estado privado");

  const vistaA = await getPvpMatch(db, A.id, matchId);
  const vistaB = await getPvpMatch(db, B.id, matchId);
  check("LECTURA: los DOS jugadores pueden leer la partida", vistaA.ok && vistaB.ok);
  check("LECTURA: cada uno recibe SU bando",
    vistaA.data?.view.yourSide === "A" && vistaB.data?.view.yourSide === "B");

  const secretosDeB = vistaA.data!.view.match.snapshotB.cards.length;
  const secretosDeA = vistaB.data!.view.match.snapshotA.cards.length;
  check("SECRETO: A no recibe ni una carta oculta de B", secretosDeB === 0, `${secretosDeB} cartas`);
  check("SECRETO: B no recibe ni una carta oculta de A", secretosDeA === 0, `${secretosDeA} cartas`);
  check("SECRETO: cada uno sí conserva su propio mazo entero",
    vistaA.data!.view.match.snapshotA.cards.length === 10 &&
    vistaB.data!.view.match.snapshotB.cards.length === 10);

  const tercero = await nuevoJugador("c", 2);
  const vistaC = await getPvpMatch(db, tercero.id, matchId);
  check("SEGURIDAD: un tercero no puede leer la partida", !vistaC.ok && vistaC.status === 404);

  // ─────────────── 4. TURNO Y AUTORIDAD ───────────────
  console.log("\n## 4. Autoridad de turno");

  const esperado = vistaA.data!.view.expectedPlayer;
  check("TURNO: el servidor dice quién debe actuar", esperado === A.id || esperado === B.id, `esperado=${esperado?.slice(0, 8)}`);
  const enTurno = esperado === A.id ? A : B;
  const fueraDeTurno = esperado === A.id ? B : A;
  const vistaEnTurno = esperado === A.id ? vistaA.data!.view : vistaB.data!.view;
  const cartaPropia = (esperado === A.id ? vistaA.data!.view.match.snapshotA : vistaB.data!.view.match.snapshotB).cards[0].uid;

  const fuera = await applyPvpAction(db, matchId, {
    actionId: randomUUID(), expectedVersion: 0, playerId: fueraDeTurno.id,
    cardUid: cartaPropia, stat: "stronghold",
  });
  check("SEGURIDAD: actuar fuera de turno se rechaza", !fuera.ok && fuera.code === "NOT_YOUR_TURN", fuera.code ?? "");

  const ajeno = await applyPvpAction(db, matchId, {
    actionId: randomUUID(), expectedVersion: 0, playerId: tercero.id,
    cardUid: cartaPropia, stat: "stronghold",
  });
  check("SEGURIDAD: un tercero no puede actuar", !ajeno.ok && ajeno.code === "NOT_A_PLAYER", ajeno.code ?? "");

  const vieja = await applyPvpAction(db, matchId, {
    actionId: randomUUID(), expectedVersion: 99, playerId: enTurno.id,
    cardUid: cartaPropia, stat: "stronghold",
  });
  check("SEGURIDAD: una versión que no es la actual se rechaza", !vieja.ok && vieja.code === "STALE_VERSION", vieja.code ?? "");

  // ─────────────── 5. CONCURRENCIA E IDEMPOTENCIA ───────────────
  console.log("\n## 5. Concurrencia e idempotencia");

  const accion = randomUUID();
  const primera = await applyPvpAction(db, matchId, {
    actionId: accion, expectedVersion: vistaEnTurno.stateVersion, playerId: enTurno.id,
    cardUid: cartaPropia, stat: "stronghold",
  });
  check("ACCIÓN: la jugada legal del jugador en turno se aplica", primera.ok, primera.error ?? "");
  check("VERSIÓN: state_version avanza exactamente +1",
    primera.data?.view.stateVersion === vistaEnTurno.stateVersion + 1,
    `${vistaEnTurno.stateVersion} → ${primera.data?.view.stateVersion}`);

  const repetida = await applyPvpAction(db, matchId, {
    actionId: accion, expectedVersion: vistaEnTurno.stateVersion, playerId: enTurno.id,
    cardUid: cartaPropia, stat: "stronghold",
  });
  check("IDEMPOTENCIA: la MISMA action_id no produce una segunda transición",
    repetida.ok && repetida.data?.view.stateVersion === primera.data?.view.stateVersion,
    `v=${repetida.data?.view.stateVersion}`);

  const { count: nAcciones } = await db.from("duel_match_actions")
    .select("action_id", { count: "exact", head: true }).eq("match_id", matchId).eq("action_id", accion);
  check("IDEMPOTENCIA: solo hay UNA fila de acción para esa action_id", nAcciones === 1, `${nAcciones} filas`);

  // Dos acciones nacidas de la misma versión: solo una puede triunfar.
  const trasPrimera = await getPvpMatch(db, enTurno.id, matchId);
  const vActual = trasPrimera.data!.view.stateVersion;
  const quienSigue = trasPrimera.data!.view.expectedPlayer;
  if (quienSigue) {
    const jug = quienSigue === A.id ? A : B;
    const v = await getPvpMatch(db, jug.id, matchId);
    const snap = quienSigue === A.id ? v.data!.view.match.snapshotA : v.data!.view.match.snapshotB;
    const libres = snap.cards.filter((c) => !v.data!.view.match.usedA.includes(c.uid) && !v.data!.view.match.usedB.includes(c.uid));
    const [r1, r2] = await Promise.all([
      applyPvpAction(db, matchId, { actionId: randomUUID(), expectedVersion: vActual, playerId: jug.id, cardUid: libres[0].uid, stat: "stronghold" }),
      applyPvpAction(db, matchId, { actionId: randomUUID(), expectedVersion: vActual, playerId: jug.id, cardUid: libres[1]?.uid ?? libres[0].uid, stat: "stronghold" }),
    ]);
    check("CONCURRENCIA: dos acciones sobre la misma versión NO triunfan las dos",
      [r1.ok, r2.ok].filter(Boolean).length === 1,
      `r1=${r1.ok ? "ok" : r1.code} r2=${r2.ok ? "ok" : r2.code}`);
  } else {
    check("CONCURRENCIA: dos acciones sobre la misma versión NO triunfan las dos", false, "no hay turno siguiente");
  }

  // ─────────────── 6. ABANDONO ───────────────
  console.log("\n## 6. Abandono (NO borra la partida)");

  const abandono = await abandonPvpMatch(db, B.id, matchId);
  check("ABANDONO: el jugador puede abandonar", abandono.ok, abandono.error ?? "");

  const trasAbandono = await fila(matchId);
  check("ABANDONO: la partida SIGUE EXISTIENDO (no se borra)", trasAbandono !== null);
  check("ABANDONO: queda el motivo, el autor y el momento",
    trasAbandono?.closed_reason === "ABANDONED" && trasAbandono?.closed_by === B.id && trasAbandono?.closed_at !== null,
    `reason=${String(trasAbandono?.closed_reason)} by=${String(trasAbandono?.closed_by).slice(0, 8)}`);
  check("ABANDONO: el ciclo de vida efectivo pasa a ABANDONED",
    abandono.data?.view.lifecycle === "ABANDONED", String(abandono.data?.view.lifecycle));

  const trasCierre = await applyPvpAction(db, matchId, {
    actionId: randomUUID(), expectedVersion: abandono.data!.view.stateVersion, playerId: A.id,
    cardUid: cartaPropia, stat: "stronghold",
  });
  check("SEGURIDAD: una partida ABANDONED no acepta acciones",
    !trasCierre.ok && trasCierre.code === "MATCH_CLOSED", trasCierre.code ?? "");

  const doble = await abandonPvpMatch(db, A.id, matchId);
  check("ABANDONO: no se puede cerrar dos veces (el primer motivo manda)",
    !doble.ok && doble.code === "MATCH_CLOSED", doble.code ?? "");

  // ─────────────── 7. COMPATIBILIDAD PvE ───────────────
  console.log("\n## 7. Compatibilidad PvE");

  const pve = await startPveMatch(db, A.id, A.deckId, "NORMAL");
  check("PvE: una partida contra la IA sigue creándose igual", pve.ok, pve.error ?? "");
  if (pve.ok && pve.data) {
    const rowPve = await fila(pve.data.view.matchId);
    check("PvE: la fila nace en modo PVE, sin jugador B y con state_version 0",
      rowPve?.mode === "PVE" && rowPve?.player_b_id === null && rowPve?.state_version === 0,
      `mode=${String(rowPve?.mode)}`);
    const comoPvp = await getPvpMatch(db, A.id, pve.data.view.matchId);
    check("AISLAMIENTO: una partida PvE no se puede leer por la puerta PvP",
      !comoPvp.ok && comoPvp.code === "NOT_PVP", comoPvp.code ?? "");
  }

  // ─────────────── 8. RLS — el cliente no ve NADA ───────────────
  console.log("\n## 8. RLS (la frontera no es React)");

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const anonMatches = await anon.from("duel_matches").select("id").eq("id", matchId);
  check("RLS: sin auth no se leen partidas",
    !!anonMatches.error || (anonMatches.data?.length ?? 0) === 0, anonMatches.error?.code ?? "0 filas");
  const anonActions = await anon.from("duel_match_actions").select("action_id").eq("match_id", matchId);
  check("RLS: sin auth no se lee el libro de acciones",
    !!anonActions.error || (anonActions.data?.length ?? 0) === 0, anonActions.error?.code ?? "0 filas");

  const comoA = createClient(URL_, ANON, { auth: { persistSession: false } });
  const signin = await comoA.auth.signInWithPassword({ email: A.email, password: A.password });
  check("RLS: el jugador A puede autenticarse (control del test)", !signin.error && !!signin.data.user);
  if (!signin.error) {
    const suya = await comoA.from("duel_matches").select("id").eq("id", matchId);
    check("RLS: NI SIQUIERA su propio jugador lee la fila cruda de la partida",
      !!suya.error || (suya.data?.length ?? 0) === 0, suya.error?.code ?? "0 filas");
    const acciones = await comoA.from("duel_match_actions").select("action_id").eq("match_id", matchId);
    check("RLS: un jugador autenticado no lee el libro de acciones",
      !!acciones.error || (acciones.data?.length ?? 0) === 0, acciones.error?.code ?? "0 filas");
    const escribe = await comoA.from("duel_matches").update({ state_version: 999 }).eq("id", matchId);
    check("RLS: un jugador autenticado no puede escribir state_version",
      !!escribe.error, escribe.error?.code ?? "no falló");
  }

  await limpiar();
  salir();
}

async function limpiar(): Promise<void> {
  // `duel_matches`, `duel_match_actions`, `duel_decks` y `user_cards` cuelgan de la cuenta
  // por `on delete cascade`: borrar el usuario se lo lleva todo.
  for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
}

function salir(): void {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${pass} correctas · ${fail} fallidas`);
  console.log(fail === 0 ? "  ✅ EL MODELO PvP SE DEFIENDE" : "  ❌ EL MODELO PvP TIENE HUECOS");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e: unknown) => {
  console.error(e);
  await limpiar();
  process.exit(1);
});
