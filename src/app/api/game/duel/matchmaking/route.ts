/**
 * `/api/game/duel/matchmaking` — COLA DE EMPAREJAMIENTO PvP (Bloque 7.4).
 *
 *   GET                                  → estado de MI búsqueda (+ intento de emparejamiento)
 *   POST { action: "enqueue", deckId }    → entrar en cola
 *   POST { action: "cancel" }             → salir de la cola
 *
 * SOBRE LA RUTA. Se sigue la convención que ya audita y documenta `/api/game/duel/pvp`: rutas
 * PLANAS bajo `/api/game/*` —en `src/app/api` no existe ni un segmento dinámico— y un
 * discriminador `action` en el cuerpo para las escrituras. No se estrena estilo de enrutado.
 *
 * NO HAY ACCIÓN `attempt`, Y ES DELIBERADO. Un endpoint público que dispare el emparejador sería
 * una palanca que cualquiera podría accionar en bucle. El emparejamiento lo mueve el propio
 * tráfico legítimo: `enqueue` y el `GET` de quien está en cola ejecutan un intento. Como el
 * transporte es HTTP + sondeo, los que buscan partida ya están generando esas peticiones.
 *
 * AUTORIDAD. `userId` sale SIEMPRE de `getSession(req)`, es decir del Bearer. Esta ruta NO lee
 * `userId`, `playerId`, `opponentId`, `rating`, `mmr` ni `side` de ninguna parte de la petición.
 * No existe forma de pedir «emparéjame con B»: el servidor elige al rival y ni siquiera dice
 * quién es hasta que hay partida, y entonces lo dice el Bloque 7.3, no esta ruta.
 *
 * LO QUE NO SALE DE AQUÍ. Ni la lista de la cola, ni cuánta gente hay, ni el mazo de nadie, ni
 * un rating. Lo único agregado que se devuelve es `position`: cuántos llevan esperando más que
 * tú, que es exactamente el significado del criterio FIFO y no nombra a nadie.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { enqueue, cancel, status } from "@/server/services/duelsMatchmaking";
import {
  takeRate, maybeSweepRates, rateHeaders, TOO_MANY, isDependencyDown, UNAVAILABLE,
} from "@/server/services/rateLimit";
import { internalError } from "@/server/ops/log";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** El estado de la cola NUNCA se cachea: una respuesta guardada es una búsqueda congelada. */
const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (error: string, status_ = 400) =>
  NextResponse.json({ error }, { status: status_, headers: NO_STORE });

/** Límite superado (Bloque 7.6). Anodina y siempre igual: no enumera nada. */
const tooMany = (retryAfter: number) =>
  NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(retryAfter) });

function message(e: unknown): string {
  return e instanceof Error ? e.message : "Error inesperado";
}

/**
 * Fallo del que no tiene la culpa el cliente (Bloque 7.6).
 *
 * Si lo que falló es la dependencia —la base no contesta— se responde **503 con `Retry-After`**,
 * no 500: 500 dice «me he roto yo», y aquí lo cierto es «vuelve en un momento». Se descubrió
 * midiendo: bajo una ráfaga fuerte se agotan los sockets contra la pila de Supabase y este
 * `catch` respondía 500 con el texto interno del error. Para el cliente no cambia nada
 * (`kindForStatus` trata todo 5xx igual, como reintentable), pero deja de mentir y deja de
 * filtrar internals.
 */
function failed(e: unknown) {
  if (isDependencyDown(e)) {
    return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  }
  // F67 · el texto interno se queda en el log; al cliente, un código para localizarlo.
  return internalError("api/game/duel/matchmaking", e);
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);

  // CONSULTA de cola: cubeta permisiva (90/min contra 30 reales). Sondear el estado es barato y
  // es lo que hace el jugador mientras espera; no es lo que hay que frenar.
  const rate = await takeRate(session.admin, session.userId, "mm_status");
  if (!rate.allowed) return tooMany(rate.retryAfter);
  void maybeSweepRates(session.admin);

  try {
    const res = await status(session.admin, session.userId);
    if (!res.ok) {
      return NextResponse.json({ error: res.error, code: res.code }, { status: res.status, headers: NO_STORE });
    }
    return NextResponse.json(res.data, { headers: NO_STORE });
  } catch (e) {
    return failed(e);
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);

  /*
   * ESCRITURA de cola: la cubeta estricta (20/min). Entrar y salir son ~2 acciones por búsqueda.
   *
   * Y esto NO sustituye a nada: el índice único parcial de `duel_pvp_queue` sigue siendo lo que
   * impide dos entradas vivas, y la guarda de partida activa lo que impide encolarse jugando. El
   * límite solo evita que se gaste el servidor intentándolo.
   */
  const rate = await takeRate(session.admin, session.userId, "mm_write");
  if (!rate.allowed) return tooMany(rate.retryAfter);

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500

  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "enqueue": {
        // Lo ÚNICO que el cliente elige. Y aun así el servicio lo revalida contra el inventario
        // real antes de dejarlo entrar en cola.
        const deckId = typeof body.deckId === "string" && UUID.test(body.deckId) ? body.deckId : "";
        if (!deckId) return bad("Equipo no válido");

        const res = await enqueue(session.admin, session.userId, deckId);
        if (!res.ok) {
          // F76 · un ACTIVE_MATCH de tu propia cola ranked trae su vista (entrada MATCHED viva) para retomarla.
          return NextResponse.json({ ...(res.data ?? {}), error: res.error, code: res.code }, { status: res.status, headers: NO_STORE });
        }
        return NextResponse.json(res.data, { headers: NO_STORE });
      }

      case "cancel": {
        // No lleva parámetros A PROPÓSITO: se cancela LA TUYA, la que dice el token. Aceptar un
        // `entryId` sería aceptar el id de la cola de otro, y eso solo puede acabar de una forma.
        const res = await cancel(session.admin, session.userId);
        if (!res.ok) {
          return NextResponse.json({ error: res.error, code: res.code }, { status: res.status, headers: NO_STORE });
        }
        return NextResponse.json(res.data, { headers: NO_STORE });
      }

      default:
        return bad("Acción inválida");
    }
  } catch (e) {
    return failed(e);
  }
}
