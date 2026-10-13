/**
 * SERVICIO DE PARTIDAS PvP (Bloque 7.2).
 *
 * Es la capa que ATA el modelo puro (`@/domain/cardgame/pvp`) a la fila de `duel_matches`.
 * No decide reglas de juego —eso es del orquestador— y no decide identidad de bando por su
 * cuenta —eso es de `sideForPlayer`—: aquí solo se lee, se guarda y se condiciona la escritura.
 *
 * LO QUE ESTE FICHERO NO ES
 *   · No es matchmaking. Una partida PvP se crea con dos usuarios YA decididos; quién se
 *     empareja con quién es del bloque siguiente.
 *   · No es transporte. No hay WebSocket, Realtime, SSE ni polling. El rival no se entera de
 *     nada todavía: eso también es del bloque siguiente.
 *   · No es el bucle de juego PvP. `applyPvpAction` aplica UNA transición guardada; no hay
 *     bot que mover ni turno que encadenar.
 *
 * REUTILIZACIÓN — nada de esto se ha reimplementado:
 *   · Propiedad del mazo → `validateDuelDeck` + `makeDeckResolver` + `ownershipFromList`,
 *     exactamente la misma frontera que usa el duelo PvE.
 *   · Snapshot congelado → `takeDeckSnapshot`.
 *   · Arranque y reglas   → `startDuelMatch` y los selectores del orquestador.
 *   · «A quién le toca»   → `actingSide`, vía `guardAction`.
 */
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnedCard } from "@/domain/cards/types";
import { CURRENT_COMBAT_RULES } from "@/domain/cardgame/combat";
import {
  createDuelDeck, makeDeckResolver, ownershipFromList, takeDeckSnapshot, validateDuelDeck,
  explainDeckError,
} from "@/domain/cardgame";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { loadOwned as loadOwnedPaged } from "./duels";
import {
  requiredDefenderStat, selectAttackerCard, selectAttackerStat,
  selectDefenderCard, selectDefenderStat, startDuelMatch, confirmTurn,
  type CombatStatKey, type DuelMatch, type Side,
} from "@/domain/cardgame/match";
import {
  guardAction, lifecycleOf, nextVersion, opponentOf, playerForSide, projectMatchFor, sideForPlayer,
  turnWindow, expectedPlayer, acceptsActions, buildSnapshot, unchanged, changed as changedResponse,
  isPvpLike, type PvpActionEnvelope, type PvpLifecycle, type PvpMatchRecord, type PvpPlayableMode,
  type PvpSyncResponse, type ProjectedDuelMatch,
} from "@/domain/cardgame/pvp";
import { visualHintValue } from "@/lib/duel/hintVisuals";
import { TURN_DECISION_MS, autoDecision, decisionKey, deadlineFor, recordTimeout } from "@/lib/duel/turnClock";
import { settleMissionsForMatch } from "./missionEngine";
import { settleCupGame } from "./cupSettlement";

// ───────────────────────────── contrato de salida ─────────────────────────────

export interface PvpResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  code?: string;
  data?: T;
  /**
   * Jugador cuyo dato provocó el fallo, cuando el fallo es atribuible a UNO de los dos.
   *
   * Existe por el matchmaking (Bloque 7.4): si al emparejar el mazo de uno ha dejado de ser
   * legal, hay que cerrar SU entrada de cola y devolver la del rival a la cola sin penalizarlo.
   * Sin este dato, el emparejador tendría que volver a validar los dos mazos para averiguar de
   * quién era el problema, es decir, hacer dos veces el trabajo que esta función acaba de hacer.
   */
  offenderId?: string;
}

const fail = (status: number, error: string, code?: string, offenderId?: string): PvpResult<never> =>
  ({ ok: false, status, error, code, offenderId });
const done = <T>(data: T): PvpResult<T> => ({ ok: true, status: 200, data });

/**
 * Duración de cada DECISIÓN PvP, en milisegundos.
 *
 * F72.8 · antes eran 90 s por TURNO y al vencer se cerraba la partida (EXPIRED). Ahora es el plazo único de una
 * decisión humana (`TURN_DECISION_SECONDS`, el mismo que en PvE), se reinicia en cada decisión nueva y al vencer el
 * servidor juega por quien debía decidir: la partida sigue.
 */
export const PVP_TURN_MS = TURN_DECISION_MS;

// ───────────────────────────── fila ⇄ modelo ─────────────────────────────

interface PvpRow {
  id: string;
  mode: string;
  user_id: string;
  player_b_id: string | null;
  deck_id: string | null;
  deck_b_id: string | null;
  state: DuelMatch;
  state_version: number;
  closed_reason: string | null;
  closed_by: string | null;
  closed_at: string | null;
  turn_started_at: string | null;
  turn_deadline_at: string | null;
}

const COLS =
  "id, mode, user_id, player_b_id, deck_id, deck_b_id, state, state_version, " +
  "closed_reason, closed_by, closed_at, turn_started_at, turn_deadline_at";

const ms = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));

/** Traduce la fila al modelo del dominio. Es el ÚNICO sitio que conoce los nombres de columna. */
function toRecord(row: PvpRow): PvpMatchRecord {
  return {
    id: row.id,
    mode: row.mode === "PVP" || row.mode === "PVP_PRIVATE" ? row.mode : "PVE",
    playerAId: row.user_id,
    playerBId: row.player_b_id ?? "",
    deckAId: row.deck_id ?? "",
    deckBId: row.deck_b_id ?? "",
    match: row.state,
    stateVersion: row.state_version,
    closedReason:
      row.closed_reason === "ABANDONED" || row.closed_reason === "EXPIRED" ? row.closed_reason : null,
    closedBy: row.closed_by,
    closedAt: ms(row.closed_at),
    turnStartedAt: ms(row.turn_started_at),
    turnDeadlineAt: ms(row.turn_deadline_at),
  };
}

// ───────────────────────────── propiedad del mazo ─────────────────────────────

/*
 * F65 · la lectura PAGINADA de `duels.ts`. La de aquí pedía `user_cards` sin paginar y PostgREST corta en 1.000 filas:
 * con una colección mayor, cartas propias salían como «no es tuya» al entrar en cola (el mismo fallo que PvE ya corrigió).
 */
const loadOwned = (sb: SupabaseClient, userId: string): Promise<OwnedCard[]> => loadOwnedPaged(sb, userId);

/**
 * Resuelve el mazo de UN jugador y lo congela.
 *
 * LA FRONTERA de propiedad: el mazo se lee filtrando por `user_id`, así que un `deckId` de
 * otra persona sencillamente NO APARECE —da 404, no 403, porque para este usuario no existe—
 * y además se revalida carta a carta contra el inventario REAL. El cliente no envía cartas,
 * ni OVR, ni estadísticas: solo un id de mazo, y ni siquiera eso se cree sin comprobarlo.
 */
export async function resolveDeckSnapshot(
  sb: SupabaseClient, userId: string, deckId: string,
): Promise<{ ok: true; snapshot: NonNullable<ReturnType<typeof takeDeckSnapshot>> } | { ok: false; status: number; error: string }> {
  const { data, error } = await sb.from("duel_decks")
    .select("id, name, card_uids, created_at")
    .eq("id", deckId).eq("user_id", userId).maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Mazo no encontrado" };

  const row = data as { id: string; name: string; card_uids: string[]; created_at: string };
  await serverCatalog(sb); // autoridad de existencia lista antes de resolver el mazo
  const owned = await loadOwned(sb, userId);
  const deck = createDuelDeck({
    id: row.id, name: row.name, cards: row.card_uids ?? [], now: Date.parse(row.created_at) || 0,
  });
  const validation = validateDuelDeck(deck, makeDeckResolver(reg(), ownershipFromList(owned), versionOf));
  if (!validation.valid) {
    return {
      ok: false, status: 409,
      error: `Ese mazo no es legal: ${validation.errors.map(explainDeckError)[0] ?? "revisa la composición"}`,
    };
  }
  const snapshot = takeDeckSnapshot(deck, validation, Date.now());
  if (!snapshot) return { ok: false, status: 500, error: "No se pudo preparar el mazo" };
  return { ok: true, snapshot };
}

// ───────────────────────────── creación ─────────────────────────────

export interface PvpMatchView {
  matchId: string;
  /** `PVP` = ranked (liquida rating). `PVP_PRIVATE` = duelo privado (FASE 29): NUNCA liquida. */
  mode: PvpPlayableMode;
  lifecycle: PvpLifecycle;
  stateVersion: number;
  /** Bando del solicitante. Lo dice el servidor; el cliente no lo elige. */
  yourSide: Side;
  /** Id del usuario que debe actuar ahora, o `null`. */
  expectedPlayer: string | null;
  /** Estado YA REDACTADO para el solicitante. Nunca trae las cartas ocultas del rival (sí sus pistas F71). */
  match: ProjectedDuelMatch;
  turnStartedAt: number | null;
  turnDeadlineAt: number | null;
}

/**
 * Crea una partida PvP entre DOS usuarios ya decididos.
 *
 * Quién es A y quién es B lo fija esta función a partir de sus argumentos, que vienen del
 * servidor. No hay ningún camino por el que el cliente pueda declarar bandos.
 *
 * `player_a !== player_b` se comprueba aquí Y lo impone la restricción `duel_matches_mode_shape`:
 * dos redes, porque una partida contra uno mismo rompería el modelo de propiedad entero.
 */
export async function createPvpMatch(
  sb: SupabaseClient,
  a: { playerId: string; deckId: string },
  b: { playerId: string; deckId: string },
  opts: { turnMs?: number | null; now?: number; matchId?: string; mode?: PvpPlayableMode } = {},
): Promise<PvpResult<{ view: PvpMatchView }>> {
  if (!a.playerId || !b.playerId) return fail(400, "Faltan jugadores", "NOT_A_PLAYER");
  if (a.playerId === b.playerId) return fail(400, "Un jugador no puede duelar contra sí mismo", "SAME_PLAYER");

  const snapA = await resolveDeckSnapshot(sb, a.playerId, a.deckId);
  if (!snapA.ok) return fail(snapA.status, snapA.error, "DECK_NOT_OWNED", a.playerId);
  const snapB = await resolveDeckSnapshot(sb, b.playerId, b.deckId);
  if (!snapB.ok) return fail(snapB.status, snapB.error, "DECK_NOT_OWNED", b.playerId);

  /*
   * El id se decide AQUÍ y se inserta explícitamente, en vez de dejar que lo genere la columna.
   *
   * Antes se insertaba sin id y luego se reescribía `state` con el id que hubiera puesto la base
   * de datos: dos escrituras, y una ventana entre ellas en la que `state.id` no coincidía con la
   * fila. Decidirlo antes elimina las dos cosas.
   *
   * Y habilita lo que el matchmaking necesita: el emparejador RESERVA un id al bloquear a los dos
   * jugadores y lo pasa por `opts.matchId`, así que si el proceso muere después de crear la
   * partida, la recuperación puede preguntar por ese id exacto en vez de adivinar. Ver
   * `_duel_pvp_sweep` en la migración 0032.
   */
  const matchId = opts.matchId ?? crypto.randomUUID();

  // Quién abre lo decide el servidor, igual que en PvE. El cliente no lo negocia.
  const firstAttacker: Side = randomInt(0, 2) === 0 ? "A" : "B";
  const started = startDuelMatch({
    id: matchId,
    snapshotA: snapA.snapshot,
    snapshotB: snapB.snapshot,
    firstAttacker,
    rules: CURRENT_COMBAT_RULES,
  });
  if (!started.ok) return fail(500, "La partida no puede empezar con esos mazos");

  const now = opts.now ?? Date.now();
  const turnMs = opts.turnMs === undefined ? PVP_TURN_MS : opts.turnMs;
  const win = turnWindow(now, turnMs);

  const { data, error } = await sb.from("duel_matches").insert({
    id: matchId,
    mode: opts.mode ?? "PVP",
    user_id: a.playerId,
    player_b_id: b.playerId,
    deck_id: a.deckId,
    deck_b_id: b.deckId,
    /*
     * `difficulty` es NOT NULL con CHECK de bot desde 0014 y esta migración no lo cambia
     * (D-PVP-3 sigue abierta). Se escribe 'NORMAL' como valor de relleno SIN significado en
     * PvP: nada lo lee, porque no hay bot al que graduar. Cambiar la columna a nullable es
     * una migración de su propio bloque, no un efecto colateral de este.
     */
    difficulty: "NORMAL",
    status: started.match.status,
    state: started.match as unknown as object,
    rng: {},
    rules_version: CURRENT_COMBAT_RULES.version,
    state_version: 0,
    turn_started_at: new Date(win.startedAt).toISOString(),
    turn_deadline_at: win.deadlineAt === null ? null : new Date(win.deadlineAt).toISOString(),
  }).select(COLS).maybeSingle();

  if (error) return fail(500, error.message);
  if (!data) return fail(500, "No se pudo crear la partida");

  const rec = toRecord(data as unknown as PvpRow);
  return done({ view: viewFor(rec, "A") });
}

// ───────────────────────────── lectura ─────────────────────────────

/**
 * Construye la respuesta de sincronización de UN jugador desde el registro autoritativo.
 *
 * Es el ÚNICO camino por el que sale estado PvP, venga de un sondeo o de una acción: así el
 * cliente interpreta un solo formato y no hay dos proyecciones que puedan divergir.
 */
function syncFor(rec: PvpMatchRecord, side: Side, serverNow: number): PvpSyncResponse {
  const snapshot = buildSnapshot(rec, playerForSide(rec, side), countryOf, visualHintValue);
  // `side` sale de `sideForPlayer` sobre este mismo registro: el snapshot no puede faltar.
  return snapshot
    ? changedResponse(snapshot, serverNow)
    : unchanged(rec.stateVersion, serverNow, false);
}

/** Construye la vista de UN jugador. Es el único constructor de respuesta PvP. */
function viewFor(rec: PvpMatchRecord, side: Side): PvpMatchView {
  return {
    matchId: rec.id,
    mode: rec.mode === "PVP_PRIVATE" ? "PVP_PRIVATE" : "PVP",
    lifecycle: lifecycleOf(rec),
    stateVersion: rec.stateVersion,
    yourSide: side,
    expectedPlayer: expectedPlayer(rec),
    // LA frontera del secreto. Se proyecta SIEMPRE, también al crear y al abandonar.
    match: projectMatchFor(rec.match, side, countryOf, visualHintValue),
    turnStartedAt: rec.turnStartedAt,
    turnDeadlineAt: rec.turnDeadlineAt,
  };
}

/**
 * Lee una partida PvP para un jugador concreto.
 *
 * La consulta NO filtra por `user_id`: en PvP hay dos dueños legítimos. Filtra por id y luego
 * comprueba que el solicitante es uno de los dos; si no lo es, la partida «no existe» para él.
 */
export async function getPvpMatch(
  sb: SupabaseClient, playerId: string, matchId: string,
): Promise<PvpResult<{ view: PvpMatchView }>> {
  const { data, error } = await sb.from("duel_matches").select(COLS).eq("id", matchId).maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Partida no encontrada");

  const rec = toRecord(data as unknown as PvpRow);
  if (!isPvpLike(rec.mode)) return fail(404, "Partida no encontrada", "NOT_PVP");
  const side = sideForPlayer(rec, playerId);
  if (side === null) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");

  return done({ view: viewFor(rec, side) });
}

// ───────────────────────────── liquidación de rating (Bloque 7.4.2) ─────────────────────────────

/**
 * Dispara la liquidación de rating de una partida que ACABA de quedar terminal.
 *
 * ─────────────────────── POR QUÉ AQUÍ Y NO EN LA BASE DE DATOS ───────────────────────
 *
 * Porque el resultado lo produce el MOTOR, que es TypeScript. `confirmTurn` decide que la
 * partida ha terminado y quién ha ganado; la fila solo recoge esa decisión. Un disparador de
 * Postgres sobre `duel_matches` podría liquidar al ver el `status`, pero entonces la liquidación
 * ocurriría dentro de la transacción de la escritura del estado y un fallo del rating tumbaría
 * la propia partida — el rating es lo accesorio, la partida es lo que no se puede perder.
 *
 * ─────────────────────── LA CONSISTENCIA ELEGIDA, DICHA SIN ADORNOS ───────────────────────
 *
 * Son DOS transacciones: la que cierra la partida y la que mueve los ratings. No pueden ser una,
 * porque entre ellas tiene que correr el motor. Así que la consistencia es EVENTUAL y con una
 * dirección elegida a propósito:
 *
 *   · Puede existir, durante milisegundos, una partida TERMINADA y AÚN NO liquidada.
 *   · NO puede existir lo contrario —rating movido con la partida sin cerrar— porque esto solo
 *     se llama DESPUÉS de que el `UPDATE` condicionado por `state_version` haya triunfado.
 *   · NO puede existir una liquidación a medias: las dos filas de rating y las dos del libro se
 *     escriben en la MISMA transacción de `duel_pvp_settle_match`.
 *
 * La ventana se cierra sola: `settleTerminalMatch` es idempotente, así que cualquier sondeo
 * posterior de cualquiera de los dos jugadores la vuelve a intentar y la cierra
 * (ver `syncPvpMatch`). Como el transporte del bloque 7.3 ES el sondeo, esa segunda oportunidad
 * está garantizada sin construir nada.
 *
 * Y por eso este método NO propaga errores: si el rating falla, la partida ya está terminada y
 * eso es lo que el jugador tiene que recibir. Perder la respuesta de una partida jugada por un
 * fallo al sumar puntos sería el peor intercambio posible.
 */
async function settleTerminalMatch(sb: SupabaseClient, matchId: string): Promise<void> {
  try {
    const { data, error } = await sb.rpc("duel_pvp_settle_match", { p_match: matchId });
    if (error) { console.error(`[pvp] liquidación de ${matchId} falló: ${error.message}`); return; }
    const code = (data as { code?: string } | null)?.code ?? "";
    // `SETTLED` y `ALREADY_SETTLED` son los dos finales buenos. El resto describe una partida que
    // todavía no toca liquidar (o que no se puede), y no es un error de este camino.
    if (code !== "SETTLED" && code !== "ALREADY_SETTLED") {
      console.warn(`[pvp] ${matchId} terminal pero no liquidada: ${code}`);
    }
  } catch (e) {
    console.error(`[pvp] liquidación de ${matchId}: ${e instanceof Error ? e.message : "error"}`);
  }
}

/** ¿Este registro ya no admite más juego? Es la condición que dispara la liquidación. */
function isSettleable(rec: PvpMatchRecord): boolean {
  // FASE 29: un duelo privado (`PVP_PRIVATE`) NUNCA se liquida. Ni rating, ni escalera, ni eventos.
  // El RPC `duel_pvp_settle_match` además lo rechaza con NOT_PVP: dos redes.
  if (rec.mode !== "PVP") return false;
  const life = lifecycleOf(rec);
  return life === "FINISHED" || life === "ABANDONED";
}

/**
 * F73 · MISIONES DE UNA PARTIDA PvP. Solo partidas TERMINADAS por reglas (un abandono no cuenta) y solo ranked: el PvP
 * privado no cuenta nunca (dos cuentas amigas podrían regalarse victorias). Evalúa a los DOS jugadores, cada uno con
 * SU equipo congelado. Idempotente por `match:<id>` y usuario; nunca lanza.
 */
async function settlePvpMissions(sb: SupabaseClient, rec: PvpMatchRecord): Promise<void> {
  // `isSettleable` = ranked (PVP) terminada o abandonada; aquí además solo TERMINADA por reglas.
  if (lifecycleOf(rec) !== "FINISHED" || !isSettleable(rec)) return;
  await settleMissionsForMatch(sb, rec.id, rec.match, [{ userId: rec.playerAId, side: "A" }, { userId: rec.playerBId, side: "B" }],
    { mode: "RANKED", difficulty: null, finished: true });
}

/**
 * F86 · Una partida de dos personas SIN rating (`PVP_PRIVATE`) que acaba de quedar cerrada puede ser un cruce de
 * torneo: la BD lee el resultado del MOTOR y lo lleva al cuadro una vez (`cup_settle_game`). Un duelo amistoso responde
 * NOT_CUP. Nunca lanza y no cambia nada del ranked (que sigue exigiendo `mode = 'PVP'`).
 */
async function settleCupIfTerminal(sb: SupabaseClient, rec: PvpMatchRecord): Promise<void> {
  if (rec.mode !== "PVP_PRIVATE") return;
  const life = lifecycleOf(rec);
  if (life === "FINISHED" || life === "ABANDONED" || life === "EXPIRED") await settleCupGame(sb, rec.id);
}

// ───────────────────────────── vencimiento del turno (Bloque 7.4.3) ─────────────────────────────

/**
 * F72.8 · Si la decisión en curso ha vencido, la JUEGA el servidor (antes: cerraba la partida como EXPIRED).
 *
 * Lo que sigue describe el diseño original del Bloque 7.4.3; en F72.8 cambian dos cosas: (1) quién decide si ha
 * vencido es el reloj de ESTE servidor, contra el plazo que él mismo escribió (sin RPC nueva, sin migración); (2) al
 * vencer no hay perdedor: hay una jugada automática válida y la partida continúa.
 *
 * ─────────────────────── QUIÉN DECIDE QUÉ ───────────────────────
 *
 *   PostgreSQL decide SI ha vencido y SI este intento gana la carrera. La comparación temporal
 *   (`turn_deadline_at <= now()`) y la de versión (`state_version = ...`) van las dos dentro del
 *   mismo `UPDATE` de `duel_pvp_expire_turn`. Este código no compara relojes para decidir nada.
 *
 *   TypeScript decide QUIÉN perdió, y solo porque no queda más remedio: el bando que debía actuar
 *   sale de `actingSide()`, que deriva del `status`, el `attacker` y la `phase` del motor.
 *   Reimplementar eso en SQL sería un segundo motor de duelo. Se REUTILIZA `expectedPlayer`, la
 *   misma función que decide de quién es el turno en cada acción; no hay una segunda regla.
 *
 * ─────────────────────── SOBRE EL RELOJ DE ESTE PROCESO ───────────────────────
 *
 * `now` se usa ÚNICAMENTE para no hacer trabajo inútil: evita leer la fila entera y llamar a la
 * base de datos en cada sondeo de una partida cuyo plazo obviamente no ha llegado. No es
 * autoridad. Si este reloj fuera por delante, la llamada se hace y Postgres responde `NOT_DUE`;
 * si fuera por detrás, el vencimiento simplemente ocurre en el siguiente sondeo — y, en el peor
 * caso, lo recoge el barrido global, que no mira este reloj en absoluto.
 */
async function expireTurnIfDue(sb: SupabaseClient, matchId: string, now: number = Date.now()): Promise<boolean> {
  const { data, error } = await sb.from("duel_matches").select(COLS).eq("id", matchId).maybeSingle();
  if (error || !data) return false;

  const row = data as unknown as PvpRow;
  const rec = toRecord(row);
  if (!isPvpLike(rec.mode) || rec.turnDeadlineAt === null) return false;
  if (!acceptsActions(lifecycleOf(rec))) return false;
  if (now < rec.turnDeadlineAt) return false;

  /*
   * F72.8 · VENCER YA NO CIERRA LA PARTIDA: el servidor juega por quien debía decidir. `autoDecision` elige una
   * decisión válida y determinista (misma decisión vencida ⇒ misma carta), y la aplica el ORQUESTADOR con las mismas
   * funciones que una acción humana. Si el motor dice que no le toca a nadie, no se juega nada.
   */
  const auto = autoDecision(rec.match);
  if (!auto) return false;
  let m: DuelMatch = auto.match;
  if (m.phase === "READY_TO_CONFIRM") {
    const c = confirmTurn(m);
    if (c.ok) m = c.match;
  }
  m = recordTimeout(m, rec.match, { turn: rec.match.currentTurn, side: auto.side, kind: auto.kind });

  const before = rec.stateVersion;
  const after = nextVersion(rec);
  const deadline = deadlineFor(m, now, PVP_TURN_MS);

  /*
   * LA MISMA PUERTA que una acción: versión leída, partida abierta… y además el MISMO plazo leído, ya vencido. De una
   * acción humana y un vencimiento nacidos de la misma versión solo triunfa uno; de cinco sondeos a la vez, uno.
   */
  const { data: upd, error: upErr } = await sb.from("duel_matches")
    .update({
      status: m.status,
      state: m as unknown as object,
      state_version: after,
      winner: m.result?.winner ?? null,
      turn_started_at: deadline === null ? null : new Date(now).toISOString(),
      turn_deadline_at: deadline === null ? null : new Date(deadline).toISOString(),
    })
    .eq("id", matchId)
    .eq("state_version", before)
    .is("closed_reason", null)
    .eq("turn_deadline_at", row.turn_deadline_at as string)
    .lte("turn_deadline_at", new Date(now).toISOString())
    .select(COLS).maybeSingle();
  if (upErr) { console.error(`[pvp] jugada automática de ${matchId}: ${upErr.message}`); return false; }
  if (!upd) return false;

  // Rastro, como cualquier acción: quién debía decidir y de qué versión a cuál.
  const ins = await sb.from("duel_match_actions").insert({
    match_id: matchId, action_id: crypto.randomUUID(), player_id: playerForSide(rec, auto.side),
    state_version_before: before, state_version_after: after,
  });
  if (ins.error) console.error(`[pvp] jugada automática de ${matchId} aplicada pero no registrada: ${ins.error.message}`);

  // MISMA puerta que el final normal. Si esta jugada cerró la partida, se liquida una vez.
  const recAfter = toRecord(upd as unknown as PvpRow);
  if (isSettleable(recAfter)) await settleTerminalMatch(sb, matchId);
  await settlePvpMissions(sb, recAfter); // F73 · misiones de los dos jugadores (idempotente; nunca lanza)
  await settleCupIfTerminal(sb, recAfter); // F86 · cruce de torneo, si lo es (idempotente; nunca lanza)
  return true;
}

/**
 * BARRIDO GLOBAL. Cierra las partidas cuyo turno venció, sin que nadie tenga que nombrarlas.
 *
 * Los candidatos los elige PostgreSQL (`duel_pvp_expired_candidates`), comparando contra su
 * propio `now()` y por un índice parcial que solo contiene partidas VIVAS. Este proceso no
 * aporta ninguna hora.
 *
 * Está acotado por `limit` a propósito: es un trabajo oportunista enganchado a tráfico real, no
 * un `cron`, y no debe convertir una petición de usuario en un barrido de la tabla entera.
 */
export async function sweepExpiredPvpTurns(
  sb: SupabaseClient, limit = 20,
): Promise<{ scanned: number; expired: number }> {
  const { data, error } = await sb.rpc("duel_pvp_expired_candidates", { p_limit: limit });
  if (error) { console.error(`[pvp] barrido de vencidas: ${error.message}`); return { scanned: 0, expired: 0 }; }

  const rows = (data ?? []) as unknown as PvpRow[];
  let expired = 0;
  for (const row of rows) {
    // Se vuelve a resolver por id en vez de fiarse de la fila leída: entre la lectura y el cierre
    // puede haber entrado una acción, y quien tiene que darse cuenta es el `UPDATE` condicionado.
    if (await expireTurnIfDue(sb, row.id)) expired++;
  }
  return { scanned: rows.length, expired };
}

// ───────────────────────────── acción ─────────────────────────────

export interface PvpActionInput extends PvpActionEnvelope {
  cardUid: string;
  /** Solo cuando atacas. Defendiendo la impone la tabla del documento de diseño. */
  stat?: string;
}

/** BLOQUE 8.1 — registro del catálogo PERSISTIDO. Ver `server/catalog` y `services/duels`. */
const reg = () => serverCatalogSync().registry;
/** F71 · país de un jugador para las pistas de las cartas ocultas (se calculan aquí, nunca en el cliente). */
const countryOf = (playerId: string): string => reg().player(playerId)?.country ?? "";
/** BLOQUE 8.2 — resolución por versión acuñada. Mismo puerto que en el PvE. */
const versionOf = (cardId: string, v: number | null | undefined) => serverCatalogSync().instance(cardId, v);

const STATS: ReadonlySet<string> = new Set(["stronghold", "gamesense", "entryfrag"]);

/**
 * Aplica UNA acción PvP: guardada, versionada e idempotente.
 *
 * El orden es deliberado y cada paso cierra un agujero distinto:
 *
 *   1. `guardAction` — modo, pertenencia, ciclo de vida, versión, reloj y turno.
 *   2. El ORQUESTADOR decide legalidad. Aquí no se valida ni una carta a mano.
 *   3. `insert` en el libro de acciones — si la `action_id` ya estaba, CHOCA y se devuelve el
 *      estado actual sin aplicar nada. Esa es la idempotencia, y la impone la clave primaria.
 *   4. `update ... eq("state_version", esperada)` — si otra acción ganó la carrera, afecta a
 *      CERO filas y esta se rechaza. Esa es la exclusión mutua, y la impone Postgres.
 *
 * Los pasos 3 y 4 están en ese orden a propósito: reservar la acción antes de escribir el
 * estado significa que un fallo entre medias deja una acción reservada sin efecto —detectable
 * y reintentable— en vez de un estado avanzado que se podría volver a avanzar.
 */
/**
 * F66 · un conflicto (versión vieja, no es tu turno, partida cerrada, jugada rechazada) responde con el estado ACTUAL
 * de quien pregunta, ya proyectado, para que el cliente se resincronice sin esperar al siguiente sondeo. Se relee la
 * fila (el conflicto significa justamente que cambió). Solo a jugadores de la partida: a un tercero, 404 sin estado.
 */
async function conflictWithState(
  sb: SupabaseClient, matchId: string, playerId: string, status: number, error: string, code: string | undefined, now: number,
): Promise<PvpResult<{ view: PvpMatchView; sync: PvpSyncResponse }>> {
  const again = await sb.from("duel_matches").select(COLS).eq("id", matchId).maybeSingle();
  if (again.error || !again.data) return fail(status, error, code);
  const rec = toRecord(again.data as unknown as PvpRow);
  const side = sideForPlayer(rec, playerId);
  if (side === null) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");
  return { ok: false, status, error, code, data: { view: viewFor(rec, side), sync: syncFor(rec, side, now) } };
}

export async function applyPvpAction(
  sb: SupabaseClient, matchId: string, input: PvpActionInput,
  opts: { now?: number; turnMs?: number | null } = {},
): Promise<PvpResult<{ view: PvpMatchView; sync: PvpSyncResponse }>> {
  const now = opts.now ?? Date.now();
  const turnMs = opts.turnMs === undefined ? PVP_TURN_MS : opts.turnMs;

  const { data, error } = await sb.from("duel_matches").select(COLS).eq("id", matchId).maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Partida no encontrada");

  const rec = toRecord(data as unknown as PvpRow);
  if (!isPvpLike(rec.mode)) return fail(404, "Partida no encontrada", "NOT_PVP");

  /*
   * IDEMPOTENCIA, primer paso: ¿ya se aplicó esta acción?
   *
   * Va ANTES del guard a propósito. Un reintento legítimo tras un corte de red llega con la
   * versión que el cliente conocía —ya vieja, porque la acción SÍ se aplicó— y el guard lo
   * rechazaría por `STALE_VERSION`. Reconocer la `action_id` primero convierte ese caso en lo
   * que de verdad es: un éxito que el cliente no llegó a ver.
   */
  const seen = await sb.from("duel_match_actions")
    .select("action_id").eq("match_id", matchId).eq("action_id", input.actionId).maybeSingle();
  if (seen.error) return fail(500, seen.error.message);
  if (seen.data) {
    const side = sideForPlayer(rec, input.playerId);
    if (side === null) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");
    return done({ view: viewFor(rec, side), sync: syncFor(rec, side, now) });
  }

  const guard = guardAction(rec, input, now);
  if (!guard.ok) {
    const e = guard.error;
    /*
     * Llegar tarde no es solo un rechazo (Bloque 7.4.3).
     *
     * Antes, `TURN_EXPIRED` devolvía un 409 y la partida se quedaba abierta: el jugador sabía que
     * se le había pasado el turno, pero nadie cerraba nada. Ahora ese intento tardío es una
     * ocasión más de resolverla — y de las mejores, porque prueba que el propio interesado ha
     * vuelto. Quién pierde no lo decide esta rama: lo vuelve a derivar `expireTurnIfDue` del
     * estado, y Postgres comprueba otra vez que de verdad ha vencido.
     */
    if (e.code === "TURN_EXPIRED") await expireTurnIfDue(sb, matchId, now);
    if (e.code === "NOT_A_PLAYER" || e.code === "NOT_PVP") return fail(404, humanizePvp(e.code), e.code);
    return conflictWithState(sb, matchId, input.playerId, 409, humanizePvp(e.code), e.code, now);
  }
  const side = guard.side;

  if (!input.cardUid) return fail(400, "Carta no válida");

  // ── El ORQUESTADOR decide. Aquí no se valida ni una carta a mano. ──
  const isAttacker = rec.match.attacker === side;
  let m: DuelMatch;
  if (isAttacker) {
    const raw = typeof input.stat === "string" ? input.stat : "";
    if (!STATS.has(raw)) return fail(400, "Estadística no válida");
    const a = selectAttackerCard(rec.match, input.cardUid);
    if (!a.ok) return conflictWithState(sb, matchId, input.playerId, 409, humanizePvp(a.error.code), a.error.code, now);
    const b = selectAttackerStat(a.match, raw as CombatStatKey);
    if (!b.ok) return conflictWithState(sb, matchId, input.playerId, 409, humanizePvp(b.error.code), b.error.code, now);
    m = b.match;
  } else {
    const d = selectDefenderCard(rec.match, input.cardUid);
    if (!d.ok) return conflictWithState(sb, matchId, input.playerId, 409, humanizePvp(d.error.code), d.error.code, now);
    // La estadística del defensor la impone la tabla: el cliente no la elige ni la envía.
    const forced = requiredDefenderStat(d.match);
    if (!forced) return fail(500, "No se pudo determinar la respuesta obligada");
    const s = selectDefenderStat(d.match, forced);
    if (!s.ok) return fail(409, humanizePvp(s.error.code), s.error.code);
    m = s.match;
  }

  // Ambos han declarado: el turno lo cierra el orquestador, nunca la interfaz.
  if (m.phase === "READY_TO_CONFIRM") {
    const c = confirmTurn(m);
    if (c.ok) m = c.match;
  }

  const before = rec.stateVersion;
  const after = nextVersion(rec);
  // F72.8 · el registro de decisiones agotadas se conserva, y el plazo es por DECISIÓN: empieza uno nuevo cada vez que
  // cambia quién debe decidir qué (antes solo al cambiar de turno, con 90 s para las dos decisiones del turno).
  m = recordTimeout(m, rec.match, null);
  const turnChanged = decisionKey(m) !== decisionKey(rec.match);
  const win = turnWindow(now, turnMs);
  const nextDeadline = decisionKey(m) === null ? null : win.deadlineAt;

  /*
   * LA PUERTA DE CONCURRENCIA. `eq("state_version", before)` es lo que hace imposible que dos
   * acciones nacidas de la misma versión triunfen las dos: la segunda afecta a CERO filas.
   * Lo garantiza Postgres, no este código.
   */
  const { data: upd, error: upErr } = await sb.from("duel_matches")
    .update({
      status: m.status,
      state: m as unknown as object,
      state_version: after,
      winner: m.result?.winner ?? null,
      // El reloj se reinicia solo cuando de verdad empieza una decisión nueva (F72.8; antes, un turno nuevo).
      ...(turnChanged
        ? {
            turn_started_at: new Date(win.startedAt).toISOString(),
            turn_deadline_at: nextDeadline === null ? null : new Date(nextDeadline).toISOString(),
          }
        : {}),
    })
    .eq("id", matchId)
    .eq("state_version", before)
    .is("closed_reason", null)
    .select(COLS).maybeSingle();

  if (upErr) return fail(500, upErr.message);
  if (!upd) {
    /*
     * F66 · perdió la carrera. Si fue un REINTENTO de la misma acción que ya ganó (misma `action_id`, dos peticiones a
     * la vez), el libro de acciones lo reconoce y se responde el éxito que el cliente no llegó a ver. Si no, 409 con el
     * estado actual.
     */
    const again = await sb.from("duel_match_actions")
      .select("action_id").eq("match_id", matchId).eq("action_id", input.actionId).maybeSingle();
    if (again.data) {
      const cur = await sb.from("duel_matches").select(COLS).eq("id", matchId).maybeSingle();
      if (cur.data) { const r2 = toRecord(cur.data as unknown as PvpRow); return done({ view: viewFor(r2, side), sync: syncFor(r2, side, now) }); }
    }
    return conflictWithState(sb, matchId, input.playerId, 409, "La partida cambió mientras jugabas", "STALE_VERSION", now);
  }

  /*
   * Rastro de la acción. Va DESPUÉS del UPDATE porque el UPDATE es la puerta real: si se
   * insertara antes y el UPDATE fallase, quedaría una acción marcada como aplicada que no lo
   * está, y el reintento devolvería un éxito falso.
   *
   * En este orden, el peor caso es el contrario y es seguro: si el INSERT falla con el estado
   * ya avanzado, el reintento no encuentra la acción, el guard ve la versión nueva y responde
   * `STALE_VERSION`. Se pierde la comodidad de la respuesta idempotente, nunca la corrección:
   * la transición no puede aplicarse dos veces. Hacer ambas cosas atómicas exige una función
   * de Postgres — anotado como deuda P2, no simulado aquí.
   */
  const ins = await sb.from("duel_match_actions").insert({
    match_id: matchId, action_id: input.actionId, player_id: input.playerId,
    state_version_before: before, state_version_after: after,
  });
  if (ins.error) {
    console.error(`[pvp] acción ${input.actionId} aplicada pero no registrada: ${ins.error.message}`);
  }

  const recAfter = toRecord(upd as unknown as PvpRow);

  /*
   * EL ENGANCHE (Bloque 7.4.2). Va DESPUÉS del `UPDATE` condicionado, y por eso el rating no
   * puede moverse antes que el resultado: si esa escritura no triunfó, esta línea no se alcanza.
   *
   * Y va después del libro de acciones a propósito: la acción es el hecho, la liquidación es su
   * consecuencia. Se ejecuta como mucho UNA vez por partida —solo cuando la transición que
   * acabamos de aplicar es la que la deja terminal— y aun así `duel_pvp_settle_match` es
   * idempotente, así que dos caminos que llegaran aquí a la vez seguirían produciendo un solo
   * movimiento de rating.
   */
  if (isSettleable(recAfter)) await settleTerminalMatch(sb, matchId);
  await settlePvpMissions(sb, recAfter); // F73 · misiones de los dos jugadores (idempotente; nunca lanza)
  await settleCupIfTerminal(sb, recAfter); // F86 · cruce de torneo, si lo es (idempotente; nunca lanza)

  return done({ view: viewFor(recAfter, side), sync: syncFor(recAfter, side, now) });
}

/** Traduce un código del modelo PvP a un mensaje. Los códigos son la autoridad; esto es texto. */
function humanizePvp(code: string): string {
  switch (code) {
    case "NOT_PVP": return "Partida no encontrada";
    case "NOT_A_PLAYER": return "Partida no encontrada";
    case "NOT_YOUR_TURN": return "Ahora no te toca";
    case "MATCH_CLOSED": return "La partida ya está cerrada";
    case "STALE_VERSION": return "La partida cambió mientras jugabas";
    case "TURN_EXPIRED": return "Se agotó el tiempo: el servidor jugó por ti";
    default: return "Acción no válida";
  }
}

/**
 * Cierra una partida PvP por abandono. NO la borra.
 *
 * Este es el cambio de fondo respecto a PvE. `abandonMatch` (PvE) hace `DELETE` y eso es
 * defendible allí: sin fila no hay recompensa, y así se corta el «empiezo, voy perdiendo y me
 * salgo». En PvP borrar sería destruir la partida de OTRA persona: se llevaría por delante su
 * resultado, su acreditación y cualquier posibilidad de auditar la disputa.
 *
 * Por eso el abandono PvP es una TRANSICIÓN persistente: la fila se queda, con motivo, autor y
 * momento. El estado de juego NO se falsea —no se inventa un ganador dentro del motor—; quién
 * cobra lo decidirá la capa de resultado del bloque correspondiente, leyendo `closed_by`.
 */
export async function abandonPvpMatch(
  sb: SupabaseClient, playerId: string, matchId: string, opts: { now?: number } = {},
): Promise<PvpResult<{ view: PvpMatchView; sync: PvpSyncResponse }>> {
  const now = opts.now ?? Date.now();

  const { data, error } = await sb.from("duel_matches").select(COLS).eq("id", matchId).maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Partida no encontrada");

  const rec = toRecord(data as unknown as PvpRow);
  if (!isPvpLike(rec.mode)) return fail(404, "Partida no encontrada", "NOT_PVP");
  const side = sideForPlayer(rec, playerId);
  if (side === null) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");

  const lifecycle = lifecycleOf(rec);
  // Una partida ya cerrada no se vuelve a cerrar: el primer motivo es el que vale.
  if (lifecycle === "FINISHED" || lifecycle === "ABANDONED" || lifecycle === "EXPIRED") {
    return { ok: false, status: 409, error: "La partida ya está cerrada", code: "MATCH_CLOSED", data: { view: viewFor(rec, side), sync: syncFor(rec, side, now) } };
  }

  const { data: upd, error: upErr } = await sb.from("duel_matches")
    .update({
      closed_reason: "ABANDONED",
      closed_by: playerId,
      closed_at: new Date(now).toISOString(),
      state_version: nextVersion(rec),
    })
    .eq("id", rec.id)
    // Condicionada igual que una acción: dos abandonos simultáneos no pueden ganar los dos.
    .eq("state_version", rec.stateVersion)
    .is("closed_reason", null)
    .select(COLS).maybeSingle();

  if (upErr) return fail(500, upErr.message);
  if (!upd) return conflictWithState(sb, rec.id, playerId, 409, "La partida cambió mientras se abandonaba", "STALE_VERSION", now);

  const recAfter = toRecord(upd as unknown as PvpRow);

  /*
   * EL ENGANCHE DEL ABANDONO (Bloque 7.4.2), que resuelve D-PVP-7.
   *
   * Quién pierde NO se decide aquí: se decide en `duel_pvp_settle_match`, leyendo `closed_by` de
   * la fila que el `UPDATE` de arriba acaba de escribir. Este servicio no le pasa un ganador, ni
   * un perdedor, ni un delta — solo el id de la partida. Así, el único camino por el que se puede
   * declarar un abandono es abandonar de verdad.
   *
   * Igual que en la acción: va DESPUÉS del `UPDATE` condicionado, así que de dos abandonos
   * simultáneos solo el que escribió llega hasta aquí.
   */
  await settleTerminalMatch(sb, rec.id);
  // F86 · un abandono en un cruce de torneo lo decide `closed_by` (gana el que se quedó), leído por la BD.
  await settleCupIfTerminal(sb, recAfter);

  return done({ view: viewFor(recAfter, side), sync: syncFor(recAfter, side, now) });
}

/** El rival de un jugador en una partida. Expuesto para la acreditación del bloque siguiente. */
// ───────────────────────────── sincronización (Bloque 7.3) ─────────────────────────────

/**
 * Columnas MÍNIMAS para decidir si algo cambió. Nótese lo que NO está: `state`.
 *
 * Ese jsonb es la partida entera —dos mazos de diez cartas con sus estadísticas congeladas— y
 * es, con diferencia, lo más caro de la fila. Un sondeo sin cambios no tiene por qué pagarlo,
 * así que no lo pide. Esta es LA optimización del bloque y es de las que se justifican solas.
 */
const SYNC_COLS =
  "id, mode, user_id, player_b_id, state_version, closed_reason, status, turn_deadline_at";

interface SyncProbe {
  id: string;
  mode: string;
  user_id: string;
  player_b_id: string | null;
  state_version: number;
  closed_reason: string | null;
  status: string;
  /**
   * Añadido en el bloque 7.4.3. Es un escalar, así que el sondeo barato sigue siendo barato — y
   * sin él ese camino no podría enterarse NUNCA de que el turno del rival ha vencido, que es
   * justo el caso que este bloque tiene que resolver.
   */
  turn_deadline_at: string | null;
}

/**
 * Sincroniza una partida para UN jugador.
 *
 * Dos caminos, y el barato es el habitual:
 *
 *   1. **Sondeo sin cambios** — se leen siete columnas escalares. Si `since` coincide con
 *      `state_version`, se responde `{ changed: false, … }` y NO se llega a tocar el `state`.
 *   2. **Hay algo nuevo** — se lee la fila completa y se proyecta con `buildSnapshot`, que a su
 *      vez usa `projectMatchFor`. No hay una segunda proyección en ninguna parte.
 *
 * La pertenencia se comprueba en el camino barato TAMBIÉN: quien no juega esta partida recibe
 * 404 tanto si pregunta con `since` como sin él. Nunca 403, para no confirmar que existe.
 */
export async function syncPvpMatch(
  sb: SupabaseClient, playerId: string, matchId: string,
  since?: number, opts: { now?: number } = {},
): Promise<PvpResult<PvpSyncResponse>> {
  const serverNow = opts.now ?? Date.now();

  const probe = await sb.from("duel_matches").select(SYNC_COLS).eq("id", matchId).maybeSingle();
  if (probe.error) return fail(500, probe.error.message);
  if (!probe.data) return fail(404, "Partida no encontrada");

  const p = probe.data as unknown as SyncProbe;
  if (!isPvpLike(p.mode)) return fail(404, "Partida no encontrada", "NOT_PVP");
  // Pertenencia ANTES de contar nada, ni siquiera la versión.
  if (playerId !== p.user_id && playerId !== p.player_b_id) {
    return fail(404, "Partida no encontrada", "NOT_A_PLAYER");
  }

  /*
   * EL VENCIMIENTO DEL TURNO (Bloque 7.4.3), y va ANTES de decidir qué responder.
   *
   * Esta es LA garantía de que una partida no se queda colgada: quien deja de jugar deja de
   * mandar peticiones, pero **su rival sigue sondeando**, y es ese sondeo el que la cierra. Por
   * eso la comprobación tiene que estar aquí y no solo en el camino completo: un rival que ya
   * conoce la versión actual entra por el camino barato, y si no mirásemos el plazo aquí, el
   * único que puede cerrar la partida pasaría de largo en cada sondeo.
   *
   * `serverNow` solo evita trabajo inútil; quien decide si ha vencido es Postgres.
   */
  const vencido = p.status === "IN_PROGRESS" && p.closed_reason === null
    && p.turn_deadline_at !== null && Date.parse(p.turn_deadline_at) <= serverNow
    && await expireTurnIfDue(sb, matchId, serverNow);

  const closed = p.closed_reason === "ABANDONED" || p.closed_reason === "EXPIRED";
  const finished = p.status === "COMPLETED" || p.status === "DRAW" || p.status === "UNRESOLVED";
  const terminal = closed || finished;

  // ── Camino barato: nada que enviar. El `state` no se ha leído siquiera. ──
  // Si acabamos de vencer la partida, el estado SÍ cambió: se cae al camino completo para que el
  // cliente reciba el cierre y deje de sondear.
  if (!vencido && typeof since === "number" && since === p.state_version) {
    return done(unchanged(p.state_version, serverNow, terminal));
  }

  // ── Camino completo ──
  const full = await sb.from("duel_matches").select(COLS).eq("id", matchId).maybeSingle();
  if (full.error) return fail(500, full.error.message);
  if (!full.data) return fail(404, "Partida no encontrada");

  const recFull = toRecord(full.data as unknown as PvpRow);

  /*
   * RED DE SEGURIDAD DE LA LIQUIDACIÓN (Bloque 7.4.2).
   *
   * Cerrar la partida y mover los ratings son dos transacciones (ver `settleTerminalMatch`), así
   * que existe una ventana —milisegundos— en la que un proceso que muriese dejaría una partida
   * terminada sin liquidar. Aquí se cierra esa ventana sin construir nada: el transporte del
   * bloque 7.3 ES el sondeo, así que cualquiera de los dos jugadores volverá a pedir el estado, y
   * ese sondeo reintenta la liquidación.
   *
   * Solo ocurre en el camino COMPLETO, no en el sondeo barato: cuando el cliente ya conoce la
   * versión terminal responde `changed: false` sin llegar hasta aquí. Es decir, como mucho un
   * intento por jugador y por transición, no uno por sondeo. Y `duel_pvp_settle_match` empieza
   * comprobando si ya está liquidada, así que el caso normal es una consulta barata que no
   * escribe nada.
   */
  if (isSettleable(recFull)) await settleTerminalMatch(sb, matchId);
  // F73 · red de seguridad de las misiones, igual que la de la liquidación: `mission_events` impide contarla dos veces.
  await settlePvpMissions(sb, recFull);
  // F86 · y la del cruce de torneo (si la partida lo es): la misma red, `cup_settle_game` es idempotente.
  await settleCupIfTerminal(sb, recFull);

  const snapshot = buildSnapshot(recFull, playerId, countryOf, visualHintValue);
  if (!snapshot) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");
  return done(changedResponse(snapshot, serverNow));
}

export { opponentOf, sideForPlayer, guardAction };
export type { PvpMatchRecord, PvpLifecycle };
