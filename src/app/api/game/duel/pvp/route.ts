/**
 * `/api/game/duel/pvp` — SINCRONIZACIÓN DE PARTIDA PvP (Bloque 7.3).
 *
 *   GET  ?matchId=<uuid>[&since=<n>]            → PvpSyncResponse
 *   POST { action: "play",    matchId, actionId, expectedVersion, cardUid, stat? }
 *   POST { action: "abandon", matchId }
 *
 * SOBRE LA RUTA. El encargo sugería `GET /api/duels/pvp/[matchId]`, pero pedía auditar antes
 * las convenciones. En NEXUS **no existe ni un solo segmento dinámico** en `src/app/api`: las
 * 23 rutas son planas bajo `/api/game/*` y las que escriben usan un discriminador `action` en
 * el cuerpo. Se sigue esa convención —`matchId` va en la query— para no estrenar un estilo de
 * enrutado por una sola ruta.
 *
 * AUTORIDAD. El usuario sale SIEMPRE de `getSession(req)`, es decir del Bearer. No se lee
 * ningún `userId`, `playerId` ni `side` del cuerpo ni de la query: ese es exactamente el vector
 * que permitiría operar en nombre de otro.
 *
 * SECRETO. Lo que se devuelve lo construye `syncPvpMatch`/`applyPvpAction` con `buildSnapshot`,
 * que proyecta con `projectMatchFor`. Esta ruta NO arma respuestas por su cuenta y NO toca la
 * fila: si mañana cambia la proyección, cambia en un sitio.
 *
 * ORÁCULO DE ENUMERACIÓN. Una partida que existe pero no es tuya responde **404, no 403**. Un
 * 403 confirmaría que ese id existe, que es justo lo que no queremos regalar.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { syncPvpMatch, applyPvpAction, abandonPvpMatch } from "@/server/services/duelsPvp";
import { getMatchRatingOutcome } from "@/server/services/duelsRating";
import {
  takeRate, maybeSweepRates, rateHeaders, TOO_MANY, isDependencyDown, UNAVAILABLE,
} from "@/server/services/rateLimit";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** El sondeo NUNCA se cachea: una respuesta guardada es una partida congelada. */
const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATS = new Set(["stronghold", "gamesense", "entryfrag"]);

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE });

/**
 * F66 · ORÁCULO DE ENUMERACIÓN, segunda mitad. El 404 ya se usaba para «no es tuya», pero el cuerpo delataba la
 * diferencia: una partida ajena respondía con `code: "NOT_A_PLAYER"` y una inexistente sin código. Todo 404 sale
 * idéntico, byte a byte, exista la partida o no.
 */
const NOT_FOUND_BODY = { error: "Partida no encontrada" };
const notFound = () => NextResponse.json(NOT_FOUND_BODY, { status: 404, headers: NO_STORE });

/** FASE 33 · un 5xx del servicio (p. ej. un error de base de datos) no viaja crudo. */
function safeError(status: number, error: string | undefined): string | undefined {
  if (status < 500) return error;
  console.error("[pvp]", error);
  return "Error en la partida";
}

/**
 * Respuesta de límite superado (Bloque 7.6). Siempre la misma y sin datos: ni id, ni partida, ni
 * cuántas peticiones llevas. Lo único que varía es `Retry-After`, que habla de la política y no
 * de nadie.
 */
const tooMany = (retryAfter: number) =>
  NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(retryAfter) });

function message(e: unknown): string {
  return e instanceof Error ? e.message : "Error inesperado";
}

/**
 * Fallo del que no tiene la culpa el cliente (Bloque 7.6). Misma regla que en la ruta de cola:
 * si lo que falló es la dependencia, es **503 con `Retry-After`**, no 500 con el error crudo.
 */
function failed(e: unknown) {
  if (isDependencyDown(e)) {
    return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  }
  // FASE 33 · el mensaje interno se registra en servidor; al cliente, un texto genérico.
  console.error("[pvp]", message(e));
  return bad("Error en la partida", 500);
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);

  /*
   * SONDEO: la cubeta permisiva. Es el camino que se recorre cada 1,2–2,5 s mientras se juega, y
   * el límite (150/min) está puesto para no notarse nunca jugando. Va DESPUÉS de resolver la
   * sesión a propósito: el sujeto del contador es el usuario del Bearer, no algo que el cliente
   * pueda elegir.
   */
  const rate = await takeRate(session.admin, session.userId, "pvp_sync");
  if (!rate.allowed) return tooMany(rate.retryAfter);
  void maybeSweepRates(session.admin);

  const url = new URL(req.url);
  const matchId = url.searchParams.get("matchId") ?? "";
  if (!UUID.test(matchId)) return bad("Partida no válida");

  // `since` es una pista de caché, no autoridad: si no es un entero válido, se ignora y se
  // devuelve el estado completo. Nunca puede provocar que se salte una comprobación.
  const rawSince = url.searchParams.get("since");
  const parsed = rawSince === null ? NaN : Number(rawSince);
  const since = Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;

  /*
   * `outcome=1` (Bloque 7.5) adjunta lo que la partida le hizo al RATING DEL SOLICITANTE.
   *
   * Es OPT-IN a propósito: sin el parámetro la respuesta es byte a byte la del bloque 7.3, así
   * que el sondeo normal —que ocurre cada dos segundos— no paga una consulta extra y el contrato
   * de sincronización no cambia. La pantalla de resultado lo pide UNA vez, al terminar.
   *
   * Y sigue sin haber cálculo en el cliente: el delta lo escribió la liquidación y aquí solo se
   * lee. Del rival no sale nada.
   */
  const conOutcome = url.searchParams.get("outcome") === "1";

  try {
    const res = await syncPvpMatch(session.admin, session.userId, matchId, since);
    if (!res.ok && res.status === 404) return notFound();
    if (!res.ok) return NextResponse.json({ error: safeError(res.status, res.error), code: res.code }, { status: res.status, headers: NO_STORE });

    if (!conOutcome) return NextResponse.json(res.data, { headers: NO_STORE });

    const rat = await getMatchRatingOutcome(session.admin, session.userId, matchId);
    return NextResponse.json(
      // F84 · `rank`: movimiento de rango (colocación, ascenso, descenso, misma división) derivado del asiento en el servidor.
      { ...res.data, outcome: rat.ok ? rat.data!.outcome : null, rating: rat.ok ? rat.data!.rating : null, rank: rat.ok ? rat.data!.rank : null },
      { headers: NO_STORE },
    );
  } catch (e) {
    return failed(e);
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);

  /*
   * ACCIÓN: la cubeta estricta (40/min). Una partida entera son 20 acciones repartidas en
   * minutos, así que este techo no lo roza nadie jugando — y corta en seco al que intente generar
   * acciones en bucle con `action_id` distintos.
   *
   * Se toma ANTES de leer el cuerpo: si alguien está inundando, no vale la pena ni parsear su
   * JSON.
   */
  const rate = await takeRate(session.admin, session.userId, "pvp_action");
  if (!rate.allowed) return tooMany(rate.retryAfter);

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500

  const action = typeof body.action === "string" ? body.action : "";
  const matchId = typeof body.matchId === "string" && UUID.test(body.matchId) ? body.matchId : "";
  if (!matchId) return bad("Partida no válida");

  try {
    switch (action) {
      case "play": {
        const actionId = typeof body.actionId === "string" && UUID.test(body.actionId) ? body.actionId : "";
        if (!actionId) return bad("Identificador de acción no válido");

        const rawVersion = body.expectedVersion;
        if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion) || rawVersion < 0) {
          return bad("Versión de estado no válida");
        }
        const cardUid = typeof body.cardUid === "string" && UUID.test(body.cardUid) ? body.cardUid : "";
        if (!cardUid) return bad("Carta no válida");

        // Defendiendo, la estadística la impone la tabla del documento de diseño: el cliente ni
        // la envía. Si manda una basura atacando, se rechaza antes de tocar la partida.
        const raw = typeof body.stat === "string" ? body.stat : undefined;
        const stat = raw && STATS.has(raw) ? raw : undefined;
        if (raw && !stat) return bad("Estadística no válida");

        const res = await applyPvpAction(session.admin, matchId, {
          actionId, expectedVersion: rawVersion, playerId: session.userId, cardUid, stat,
        });
        if (!res.ok) {
          if (res.status === 404) return notFound();
          // F66 · un conflicto trae el estado actual (ya proyectado para quien pregunta) para resincronizar al momento.
          return NextResponse.json({ error: safeError(res.status, res.error), code: res.code, ...(res.status === 409 && res.data?.sync ? { sync: res.data.sync } : {}) }, { status: res.status, headers: NO_STORE });
        }
        // El que actúa recibe su estado nuevo AQUÍ: no espera al siguiente sondeo.
        return NextResponse.json(res.data!.sync, { headers: NO_STORE });
      }

      case "abandon": {
        const res = await abandonPvpMatch(session.admin, session.userId, matchId);
        if (!res.ok) {
          if (res.status === 404) return notFound();
          return NextResponse.json({ error: safeError(res.status, res.error), code: res.code, ...(res.status === 409 && res.data?.sync ? { sync: res.data.sync } : {}) }, { status: res.status, headers: NO_STORE });
        }
        return NextResponse.json(res.data!.sync, { headers: NO_STORE });
      }

      default:
        return bad("Acción inválida");
    }
  } catch (e) {
    return failed(e);
  }
}
