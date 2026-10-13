/**
 * TRANSPORTE DE SINCRONIZACIÓN PvP (Bloque 7.3).
 *
 * LA FRONTERA. Todo lo que hay por encima de esta interfaz —el bucle, el estado de red, la
 * pantalla— no sabe ni debe saber CÓMO llegan los cambios. Hoy llegan preguntando por HTTP;
 * mañana podrían llegar empujados por Supabase Realtime. Sustituir el adaptador no debe obligar
 * a tocar el modelo de partida ni el bucle.
 *
 * Por eso la interfaz es DELIBERADAMENTE pequeña y está escrita en términos del caso real:
 *
 *   · `fetchSince(since)` — dame el estado si cambió desde esta versión.
 *   · `play(...)` / `abandon(...)` — actúa y devuélveme el estado resultante.
 *
 * NO hay `subscribe()` en esta versión, y es una decisión, no un olvido. Un `subscribe` que por
 * dentro es un `setInterval` es una mentira útil para nadie: quien sondea necesita decidir CADA
 * CUÁNTO, y esa decisión depende del estado de la partida y de si la pestaña se ve. Ese control
 * vive en el poller, que es donde se puede razonar sobre él. Cuando exista un transporte que de
 * verdad empuje, se le añadirá `subscribe()` a la interfaz y el poller pasará a ser un adaptador
 * de compatibilidad. Ver `docs/pvp/PVP-SYNCHRONIZATION.md`.
 */
import type { PvpSyncResponse } from "@/domain/cardgame/pvp";

/** Motivo por el que una petición no devolvió estado. Cada uno se trata distinto. */
export type PvpSyncErrorKind =
  | "AUTH"        // 401 — sesión inválida. No se reintenta sola.
  | "FORBIDDEN"   // 403 — reservado; hoy el servidor responde 404 para no filtrar existencia.
  | "NOT_FOUND"   // 404 — no existe, o no es tuya. Terminal para el bucle.
  | "CONFLICT"    // 409 — versión vieja o partida cerrada. NO es un fallo de red.
  | "RATE_LIMIT"  // 429 — hay que aflojar.
  | "SERVER"      // 5xx — reintentable.
  | "NETWORK"     // sin respuesta. Reintentable.
  | "ABORTED";    // la cancelamos nosotros. No es un error.

export class PvpSyncError extends Error {
  constructor(
    readonly kind: PvpSyncErrorKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
    /** F66 · un 409 del servidor trae el estado ACTUAL de quien pregunta: con él se resincroniza sin esperar al sondeo. */
    readonly sync?: PvpSyncResponse,
  ) {
    super(message);
    this.name = "PvpSyncError";
  }
}

/** ¿Merece la pena reintentar este fallo? Un 404 o un 401 no se arreglan insistiendo. */
export const isRetryable = (kind: PvpSyncErrorKind): boolean =>
  kind === "SERVER" || kind === "NETWORK" || kind === "RATE_LIMIT";

export interface PvpPlayInput {
  actionId: string;
  expectedVersion: number;
  cardUid: string;
  /** Solo cuando atacas. Defendiendo la impone el servidor. */
  stat?: string;
}

/**
 * El contrato del transporte. Pequeño a propósito.
 *
 * `signal` viaja en cada llamada para que el bucle pueda abortar una petición en vuelo al
 * desmontarse o al lanzar una más nueva.
 */
export interface PvpSyncTransport {
  /** Estado si cambió desde `since`; `{ changed: false }` si no. `since: null` fuerza completo. */
  fetchSince(matchId: string, since: number | null, signal?: AbortSignal): Promise<PvpSyncResponse>;
  play(matchId: string, input: PvpPlayInput, signal?: AbortSignal): Promise<PvpSyncResponse>;
  abandon(matchId: string, signal?: AbortSignal): Promise<PvpSyncResponse>;
}

const ENDPOINT = "/api/game/duel/pvp";

/** Traduce un código HTTP al motivo del fallo. Distinguirlos es lo que permite reaccionar bien. */
export function kindForStatus(status: number): PvpSyncErrorKind {
  if (status === 401) return "AUTH";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "SERVER";
  // F66 · cualquier otro 4xx es una petición RECHAZADA (p. ej. 400 de una jugada mal formada): no es una caída que haya
  // que reintentar mostrando «Reconectando…», sino un desacuerdo con el servidor que se resuelve resincronizando.
  return "CONFLICT";
}

/** Cómo obtener la cabecera de autorización. Se inyecta para poder probar sin Supabase. */
export type AuthHeaderFn = () => Promise<Record<string, string>>;

/**
 * Adaptador HTTP. Es el único sitio del cliente que conoce la URL y el formato del cable.
 *
 * `fetch` se inyecta para que los tests puedan ejercitar el bucle sin red y sin navegador.
 */
export function createHttpTransport(
  authHeaders: AuthHeaderFn,
  fetchImpl: typeof fetch = fetch,
): PvpSyncTransport {
  async function call(url: string, init: RequestInit, signal?: AbortSignal): Promise<PvpSyncResponse> {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal, headers: { ...(init.headers ?? {}), ...(await authHeaders()) } });
    } catch (e) {
      // `AbortError` no es un fallo del servidor: es que nosotros la cancelamos.
      if (e instanceof Error && e.name === "AbortError") throw new PvpSyncError("ABORTED", "cancelada");
      throw new PvpSyncError("NETWORK", e instanceof Error ? e.message : "Sin conexión");
    }

    const json = (await res.json().catch(() => ({}))) as Partial<PvpSyncResponse> & { error?: string; code?: string; sync?: PvpSyncResponse };
    if (!res.ok) {
      throw new PvpSyncError(kindForStatus(res.status), json.error ?? `Error ${res.status}`, res.status, json.code, json.sync);
    }
    return json as PvpSyncResponse;
  }

  return {
    fetchSince(matchId, since, signal) {
      const q = new URLSearchParams({ matchId });
      if (since !== null) q.set("since", String(since));
      return call(`${ENDPOINT}?${q.toString()}`, { method: "GET" }, signal);
    },
    play(matchId, input, signal) {
      return call(ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ action: "play", matchId, ...input }),
      }, signal);
    },
    abandon(matchId, signal) {
      return call(ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ action: "abandon", matchId }),
      }, signal);
    },
  };
}
