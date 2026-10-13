/**
 * SERVICIO DE EMPAREJAMIENTO PvP (Bloque 7.4).
 *
 * Ata la cola persistente (`duel_pvp_queue`, migración 0032) con la creación de partidas del
 * Bloque 7.2 (`createPvpMatch`). No decide reglas, no proyecta estado y no habla con el cliente:
 * eso es de la ruta y del servicio de partida.
 *
 * ─────────────────────────── DÓNDE ESTÁ LA ATOMICIDAD ───────────────────────────
 *
 * NO está en este fichero, y eso es lo importante.
 *
 * El cliente de Supabase no sabe abrir una transacción de varias sentencias. Simular una aquí
 * —leer candidatos, decidir, escribir— es exactamente la carrera que este bloque tiene que
 * eliminar: dos procesos leerían los mismos dos jugadores y crearían dos partidas. Así que las
 * decisiones indivisibles viven en funciones de PostgreSQL, donde una llamada ES una
 * transacción, y este servicio solo las encadena.
 *
 * El emparejamiento son TRES llamadas, y hay una razón para que no sea una:
 *
 *   1. `duel_pvp_claim_pair`  — RESERVA a dos jugadores con `for update skip locked` y reserva
 *                               también el id de la futura partida. Indivisible.
 *   2. `createPvpMatch`       — construye el estado inicial con el MOTOR (que es TypeScript y no
 *                               puede ejecutarse dentro de la base de datos) e inserta la fila
 *                               con ESE id.
 *   3. `duel_pvp_commit_pair` — confirma las dos entradas contra la partida ya existente, o
 *                               `duel_pvp_release_pair` si el paso 2 falló.
 *
 * El paso 2 es el que impide que todo sea una sola transacción: el `state` de la partida son dos
 * mazos resueltos, validados contra el inventario real y congelados por `takeDeckSnapshot`.
 * Reescribir eso en plpgsql sería un segundo motor de duelo, que es justo lo que el encargo
 * prohíbe.
 *
 * La ventana entre 1 y 3 está cubierta por el ARRENDAMIENTO de la reserva: si el proceso muere
 * en medio, `_duel_pvp_sweep` recupera las entradas y —como el id estaba reservado— puede
 * PREGUNTAR si la partida llegó a existir, en vez de adivinarlo. Nunca deja a un jugador
 * MATCHED sin partida ni a dos jugadores con dos partidas.
 *
 * ─────────────────────────── QUIÉN DISPARA EL EMPAREJADOR ───────────────────────────
 *
 * El propio tráfico. No hay `cron`, ni worker, ni temporizador: cada `enqueue` y cada `status`
 * de alguien que está en cola ejecutan un intento. Como el transporte ya definido es HTTP +
 * sondeo (Bloque 7.3), los dos jugadores que buscan partida están, por definición, generando
 * peticiones — y son esas peticiones las que los emparejan. Un scheduler solo añadiría una pieza
 * que puede caerse sin que nadie se entere.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUEUE_TTL_SECONDS, PAIR_LEASE_SECONDS, matchedEntryVerdict,
  type MatchedMatchFacts, type MatchmakingCode, type MatchmakingView, type QueueEntryView,
} from "@/domain/cardgame/matchmaking";
import { createPvpMatch, resolveDeckSnapshot, sweepExpiredPvpTurns, type PvpResult } from "./duelsPvp";
import { ensureRating } from "./duelsRating";

// ───────────────────────────── contrato de salida ─────────────────────────────

const fail = (status: number, error: string, code?: string): PvpResult<never> =>
  ({ ok: false, status, error, code });
const done = <T>(data: T): PvpResult<T> => ({ ok: true, status: 200, data });

/** Forma cruda de lo que devuelven las funciones de la migración 0032. */
interface RpcEnvelope {
  code: string;
  entry?: QueueEntryView & { userId: string };
  position?: number | null;
}

/**
 * Lee el rating del solicitante para adjuntarlo a su propia vista.
 *
 * Es lectura, no autoridad: el valor que gobierna el emparejamiento es el `rating_snapshot` que
 * `duel_pvp_enqueue` selló dentro de su transacción, no este. Si falla, la vista sale con
 * `rating: null` en vez de romper la consulta de cola — saber si estás emparejado importa más
 * que ver tu número.
 */
async function ratingOf(sb: SupabaseClient, userId: string): Promise<number | null> {
  try {
    return (await ensureRating(sb, userId)).rating;
  } catch {
    return null;
  }
}

interface ClaimEnvelope {
  code: string;
  pairToken?: string;
  matchId?: string;
  a?: { entryId: string; userId: string; deckId: string };
  b?: { entryId: string; userId: string; deckId: string };
}

/**
 * Traduce la respuesta cruda de una función SQL a la vista del cliente.
 *
 * Aquí se cae `userId`: el cliente no necesita que le digan quién es y devolverlo abriría la
 * puerta a que una respuesta de cola llevase el id de otra persona el día que alguien cambie
 * una consulta. Lo que no sale, no se puede filtrar.
 */
function toView(raw: RpcEnvelope, now: number, rating: number | null): MatchmakingView {
  const entry = raw.entry ?? null;
  return {
    code: raw.code as MatchmakingCode,
    entry: entry === null ? null : {
      entryId: entry.entryId,
      deckId: entry.deckId,
      state: entry.state,
      ratingSnapshot: Number(entry.ratingSnapshot),
      matchId: entry.matchId ?? null,
      reason: entry.reason ?? null,
      createdAt: Number(entry.createdAt),
      updatedAt: Number(entry.updatedAt),
      expiresAt: Number(entry.expiresAt),
      matchedAt: entry.matchedAt === null || entry.matchedAt === undefined ? null : Number(entry.matchedAt),
    },
    position: raw.position ?? null,
    rating,
    serverNow: now,
  };
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/**
 * F76 · UNA ENTRADA `MATCHED` SOLO ES «TU PARTIDA» SI LA PARTIDA SIGUE VIVA.
 *
 * `duel_pvp_status` / `duel_pvp_cancel` devuelven la ÚLTIMA entrada conocida cuando no hay búsqueda viva. Si esa
 * entrada es `MATCHED` y su partida ya terminó (o no existe, o no es de este usuario), presentarla era enviar al jugador
 * a una partida muerta: la pantalla pintaba el resultado viejo, el sondeo de cola se paraba y no había nada que
 * cancelar. Aquí se decide con la regla canónica (`matchedEntryVerdict` → `lifecycleFromStatus`) y, si es historia,
 * se responde como si no hubiera búsqueda (`idleCode`, sin entrada): el cliente vuelve a la antesala o encola.
 *
 * No se reescribe la fila (MATCHED es terminal y es la historia verdadera de esa búsqueda) y no se adivina: si la
 * lectura falla, se propaga el error (503/500 en la ruta y el cliente reintenta) en vez de afirmar nada.
 */
const MATCH_FACTS = "id, mode, user_id, player_b_id, status, closed_reason";

async function settle(sb: SupabaseClient, userId: string, raw: RpcEnvelope, idleCode: MatchmakingCode): Promise<RpcEnvelope> {
  const entry = raw.entry;
  if (!entry || entry.state !== "MATCHED") return raw;
  let facts: MatchedMatchFacts | null = null;
  if (entry.matchId) {
    const { data, error } = await sb.from("duel_matches").select(MATCH_FACTS).eq("id", entry.matchId).maybeSingle();
    if (error) throw new Error(`duel_matches: ${error.message}`);
    facts = (data as MatchedMatchFacts | null) ?? null;
  }
  if (matchedEntryVerdict(userId, entry.matchId ?? null, facts) === "LIVE") return raw;
  return { code: idleCode, position: null };
}

// ───────────────────────────── entrar en cola ─────────────────────────────

/**
 * Entra en cola con un mazo propio.
 *
 * `userId` viene SIEMPRE del Bearer, nunca del cuerpo. `deckId` es lo único que el cliente
 * elige, y ni eso se cree: se valida dos veces, y las dos son necesarias porque comprueban cosas
 * distintas.
 *
 *   1. `resolveDeckSnapshot` — la validación COMPLETA, la misma que usa el duelo PvE y la
 *      creación de partida: el mazo es tuyo, tiene diez cartas, cumple los roles y cada
 *      instancia sigue existiendo en TU inventario. Se reutiliza tal cual; no hay una segunda
 *      implementación de las reglas de mazo en ninguna parte de este bloque.
 *   2. La propiedad, OTRA VEZ, dentro de `duel_pvp_enqueue`. No es redundancia inútil: la
 *      comprobación de la base de datos ocurre en la MISMA transacción que el INSERT, así que
 *      no hay ventana entre comprobar y escribir.
 *
 * Y es idempotente sin necesidad de un `operation_id`: la clave natural es «este usuario ya está
 * buscando», y la impone un índice único parcial. Tres POST seguidos dejan UNA entrada.
 *
 * EL RATING NO PASA POR AQUÍ (Bloque 7.4.1). `duel_pvp_enqueue` lo lee de `duel_pvp_ratings`
 * dentro de su propia transacción y lo sella en `rating_snapshot`. Este servicio no lo calcula,
 * no lo toca y no tiene por dónde recibirlo: no es que se ignore un `rating` del cuerpo, es que
 * no existe ningún parámetro por el que pudiera viajar.
 */
export async function enqueue(
  sb: SupabaseClient, userId: string, deckId: string,
): Promise<PvpResult<MatchmakingView>> {
  /*
   * BARRIDO DE TURNOS VENCIDOS (Bloque 7.4.3), y aquí por una razón muy concreta.
   *
   * La guarda de partida activa rechaza a quien ya tiene un PvP vivo. Si los DOS jugadores de una
   * partida dejaron de sondear, esa partida sigue IN_PROGRESS y los deja a los dos fuera de la
   * cola — bloqueados por algo que nadie va a terminar.
   *
   * El sondeo del rival cierra el caso normal; esto cierra el que queda: **el primero de los dos
   * que vuelve al juego desbloquea a los dos**, antes incluso de que se compruebe su guarda. Con
   * esto, ninguna partida vencida puede bloquear a nadie más allá de su propia vuelta.
   *
   * Es un barrido acotado, oportunista y sin `cron`: exactamente el mismo patrón con el que el
   * bloque 7.4 caduca las entradas de cola.
   */
  await sweepExpiredPvpTurns(sb).catch(() => null);

  const deck = await resolveDeckSnapshot(sb, userId, deckId);
  if (!deck.ok) return fail(deck.status, deck.error, "DECK_NOT_OWNED");

  const raw = await rpc<RpcEnvelope>(sb, "duel_pvp_enqueue", {
    p_user: userId, p_deck: deckId, p_ttl_seconds: QUEUE_TTL_SECONDS,
  });

  if (raw.code === "DECK_NOT_OWNED") return fail(404, "Mazo no encontrado", "DECK_NOT_OWNED");
  if (raw.code === "ACTIVE_MATCH") {
    /*
     * F76 · idempotencia de JUGAR: si la partida viva es la que emparejó TU cola ranked, el 409 lleva su vista
     * (entrada `MATCHED` + `matchId`) para que el cliente la RETOME en vez de enseñar un error. Si es otra partida
     * (un duelo privado, que no pasa por la cola), el 409 sigue sin entrada: hay que terminarla primero.
     */
    const live = await settle(sb, userId, await rpc<RpcEnvelope>(sb, "duel_pvp_status", { p_user: userId }), "IDLE");
    const resume = live.entry?.state === "MATCHED" ? { ...toView(live, Date.now(), await ratingOf(sb, userId)), code: "ACTIVE_MATCH" as MatchmakingCode } : undefined;
    return { ...fail(409, "Ya tienes un duelo PvP en curso", "ACTIVE_MATCH"), data: resume };
  }
  if (raw.code === "RETRY") return fail(409, "Vuelve a intentarlo", "RETRY");

  // Ya que hay alguien nuevo esperando, se intenta emparejar ahora mismo: si el rival llevaba
  // rato en cola, la partida existe antes de que este jugador llegue a sondear.
  await attemptMatch(sb).catch(() => null);

  // Se relee el estado —puede haber quedado emparejado en la línea anterior— pero se conserva el
  // código del alta, que es lo único que distingue «acabas de entrar» de «ya estabas buscando».
  const after = await settle(sb, userId, await rpc<RpcEnvelope>(sb, "duel_pvp_status", { p_user: userId }), "IDLE");
  return done({
    ...toView(after, Date.now(), await ratingOf(sb, userId)),
    code: raw.code as MatchmakingCode,
  });
}

// ───────────────────────────── estado ─────────────────────────────

/**
 * Estado de MI búsqueda. Es también el latido que mueve el emparejador (ver la cabecera).
 *
 * Devuelve la entrada viva si la hay y, si no, la última conocida: así quien recarga la página
 * descubre que le emparejaron mientras no miraba. Ese es el mecanismo completo de «sobrevive al
 * refresco»: no hay nada guardado en el navegador que haga falta recuperar, porque el estado
 * nunca estuvo allí.
 */
export async function status(sb: SupabaseClient, userId: string): Promise<PvpResult<MatchmakingView>> {
  const first = await settle(sb, userId, await rpc<RpcEnvelope>(sb, "duel_pvp_status", { p_user: userId }), "IDLE");

  // Si sigue buscando, se intenta emparejar y se vuelve a leer: el sondeo que descubre el
  // emparejamiento es el mismo que lo ha provocado.
  if (first.code === "OK" && first.entry?.state === "QUEUED") {
    const paired = await attemptMatch(sb).catch(() => null);
    if (paired) {
      const again = await settle(sb, userId, await rpc<RpcEnvelope>(sb, "duel_pvp_status", { p_user: userId }), "IDLE");
      return done(toView(again, Date.now(), await ratingOf(sb, userId)));
    }
  }
  return done(toView(first, Date.now(), await ratingOf(sb, userId)));
}

// ───────────────────────────── cancelar ─────────────────────────────

/**
 * Salir de la cola.
 *
 * La transición la hace la base de datos con `state = 'QUEUED'` en el WHERE, así que si un
 * emparejador ya había reservado la entrada, la cancelación afecta a cero filas y PIERDE. Es la
 * única forma de garantizar que nunca coexistan CANCELLED y MATCHED, y por eso la decisión no se
 * toma aquí.
 *
 * Cancelar dos veces no es un error: la segunda devuelve la última entrada conocida con su
 * estado real. No se miente diciendo que se canceló algo que se emparejó.
 */
export async function cancel(sb: SupabaseClient, userId: string): Promise<PvpResult<MatchmakingView>> {
  // F76 · `NOT_QUEUED` adjunta la última entrada: si es un `MATCHED` muerto, no se devuelve como partida.
  const raw = await settle(sb, userId, await rpc<RpcEnvelope>(sb, "duel_pvp_cancel", { p_user: userId }), "NOT_QUEUED");
  return done(toView(raw, Date.now(), await ratingOf(sb, userId)));
}

// ───────────────────────────── emparejar ─────────────────────────────

export interface PairOutcome {
  matchId: string;
  playerA: string;
  playerB: string;
}

/**
 * UN intento de emparejamiento. Devuelve la partida creada, o `null` si no había dos candidatos.
 *
 * Es seguro llamarla desde cualquier petición y desde varios procesos a la vez: dos
 * emparejadores simultáneos NO pueden reservar a los mismos jugadores, porque el que llega
 * segundo SALTA las filas bloqueadas en vez de esperarlas. El resultado es una partida o
 * ninguna, nunca dos.
 *
 * Los tres finales posibles, y ninguno deja estado a medias:
 *
 *   · partida creada       → `commit_pair` marca las dos entradas MATCHED con el mismo id.
 *   · mazo ilegal de uno   → `release_pair` cierra SU entrada y devuelve la del rival a la cola
 *                            CONSERVANDO su antigüedad. El inocente no pierde su turno.
 *   · fallo al escribir    → `release_pair` devuelve a los dos a la cola.
 */
export async function attemptMatch(sb: SupabaseClient): Promise<PairOutcome | null> {
  const claim = await rpc<ClaimEnvelope>(sb, "duel_pvp_claim_pair", { p_lease_seconds: PAIR_LEASE_SECONDS });
  if (claim.code !== "PAIRED" || !claim.a || !claim.b || !claim.matchId || !claim.pairToken) return null;

  const { a, b, matchId, pairToken } = claim;

  const created = await createPvpMatch(
    sb,
    { playerId: a.userId, deckId: a.deckId },
    { playerId: b.userId, deckId: b.deckId },
    { matchId },
  );

  if (!created.ok) {
    /*
     * `offenderId` sale de `createPvpMatch`, que acaba de resolver los dos mazos y sabe cuál
     * falló. Sin ese dato habría que volver a validarlos aquí solo para repartir culpas, es
     * decir, repetir el trabajo caro. Si el fallo no es de nadie (error de escritura), no hay
     * culpable y los dos vuelven a la cola.
     */
    await rpc(sb, "duel_pvp_release_pair", {
      p_token: pairToken,
      p_offender: created.offenderId ?? null,
      p_reason: created.code === "DECK_NOT_OWNED" ? "DECK_INVALID" : "MATCH_FAILED",
    });
    // El emparejador no propaga el error: no hay ninguna petición esperando ESTE resultado. El
    // jugador afectado lo verá como el estado de su entrada en el siguiente sondeo.
    console.warn(`[pvp-mm] pareja liberada (${created.code ?? "ERROR"})`);
    return null;
  }

  const commit = await rpc<{ code: string }>(sb, "duel_pvp_commit_pair", {
    p_token: pairToken, p_match: matchId,
  });
  if (commit.code !== "OK") {
    /*
     * La partida EXISTE pero la confirmación no encontró las dos entradas reservadas: el
     * arrendamiento venció mientras se creaba. No se toca nada — y no hace falta, porque el
     * barrido pregunta por este mismo id y las pondrá en MATCHED. Anular la partida sería peor:
     * es una fila legítima y los dos jugadores pueden estar ya sincronizando contra ella.
     */
    console.warn(`[pvp-mm] confirmación tardía de ${matchId}: ${commit.code}`);
  }

  return { matchId, playerA: a.userId, playerB: b.userId };
}
