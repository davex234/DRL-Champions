"use client";

/**
 * TELEMETRÍA — CAPA DE CLIENTE (Fase 14, bloque 4).
 *
 * Un único punto de entrada: `track()`. No hay un segundo rastreador, ni un framework, ni
 * una cola persistente.
 *
 * ────────────────────────── LA REGLA QUE MANDA SOBRE TODAS ──────────────────────────
 *
 * **Si la telemetría falla, no pasa nada.**
 *
 * Eso no es una aspiración: está impuesto por la forma del código. `track()` no devuelve
 * una promesa que nadie pueda esperar, no lanza nunca, no reintenta, no enseña un aviso y
 * no bloquea la navegación. Todo lo que puede salir mal —no hay red, el servidor devuelve
 * 500, `sessionStorage` está bloqueado, el JSON no serializa— acaba en el mismo sitio: se
 * pierde el evento y el jugador no se entera.
 *
 * Perder un evento es gratis. Romper una partida por contar una visita, no.
 *
 * ────────────────────────── POR QUÉ NO HAY COLA NI REINTENTOS ──────────────────────────
 *
 * Porque una cola que sobrevive al cierre de la pestaña necesita almacenamiento, y un
 * reintento necesita saber si el fallo era temporal. Las dos cosas son infraestructura
 * para un dato que, por definición, es prescindible. `keepalive` cubre el caso que de
 * verdad importa —que el evento salga aunque la página se esté cerrando— y ahí se acaba.
 */
import { getSupabase } from "@/lib/supabase/client";
import {
  zoneFromPath, SESSION_IDLE_MS,
  type EventName, type Zone, type Flow, type Source, type Severity,
} from "./contract";

const ENDPOINT = "/api/telemetry";
const STORAGE_KEY = "nexus.telemetry.session";

/* ═══════════════════════════ SESIÓN ═══════════════════════════ */

interface StoredSession {
  id: string;
  /** Última actividad conocida, en milisegundos. Decide si la sesión sigue viva. */
  seen: number;
}

/**
 * `sessionStorage` y no `localStorage`.
 *
 * Una sesión es de una pestaña y de un rato, no de un navegador y de siempre. Con
 * `localStorage`, dos pestañas abiertas compartirían sesión y el recorrido saldría
 * entrelazado; y una sesión de hace tres días reviviría al volver, que es justo lo que la
 * ventana de 30 minutos existe para evitar.
 *
 * Que perder `sessionStorage` cuente como sesión nueva es el comportamiento correcto, no
 * un efecto colateral: si el navegador lo ha tirado, el jugador ha vuelto a empezar.
 */
function readStored(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredSession>;
    return typeof p.id === "string" && typeof p.seen === "number" ? { id: p.id, seen: p.seen } : null;
  } catch {
    // Ventana privada, almacenamiento bloqueado, JSON corrupto. Todo da lo mismo.
    return null;
  }
}

function writeStored(s: StoredSession): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* da igual */ }
}

/** UUID v4. `randomUUID` no existe en contextos no seguros, así que hay respaldo. */
function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* sigue abajo */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Devuelve la sesión vigente y si acaba de nacer.
 *
 * Una sesión muere tras 30 minutos sin actividad. Cada llamada refresca la marca, así que
 * navegar la mantiene viva y dejar la pestaña abierta sin tocar nada, no.
 *
 * `isNew` es lo que garantiza **una sesión → un `session_started`**: solo es cierto
 * cuando no había sesión o la anterior había caducado. Ni un render, ni un refresco, ni
 * un cambio de zona lo vuelven a poner a cierto.
 */
function currentSession(now = Date.now()): { id: string; isNew: boolean } {
  const prev = readStored();
  if (prev && now - prev.seen < SESSION_IDLE_MS) {
    writeStored({ id: prev.id, seen: now });
    return { id: prev.id, isNew: false };
  }
  const id = uuid();
  writeStored({ id, seen: now });
  return { id, isNew: true };
}

/** El identificador de la sesión viva, sin crear ninguna. Para los tests y el arranque. */
export function peekSessionId(): string | null {
  const s = readStored();
  return s && Date.now() - s.seen < SESSION_IDLE_MS ? s.id : null;
}

/* ═══════════════════════════ PROTECCIÓN DE BUCLES ═══════════════════════════ */

/**
 * Un error al reportar un error no se reporta.
 *
 * Sin esta bandera existe el bucle evidente: falla la red → el manejador global captura el
 * fallo → intenta reportarlo → vuelve a fallar la red → captura → … Y no es teórico: es
 * exactamente lo que pasa cuando alguien pierde la conexión.
 */
let sendingError = false;

/**
 * Techo de errores por sesión.
 *
 * Un bucle de render que lance en cada pasada generaría miles de eventos idénticos. Los
 * primeros veinte ya cuentan la historia entera; los demás solo llenan la tabla y tapan
 * los errores distintos.
 */
const MAX_ERRORS_PER_SESSION = 20;
let errorsSent = 0;

/** Últimas huellas vistas: el mismo error repetido no se manda una y otra vez. */
const seenFingerprints = new Set<string>();

/* ═══════════════════════════ ENVÍO ═══════════════════════════ */

interface TrackOptions {
  zone?: Zone;
  flow?: Flow;
  source?: Source;
  severity?: Severity;
  metadata?: Record<string, string | number | boolean>;
  /** Fuerza el identificador de sesión (solo lo usa el arranque). */
  sessionId?: string;
}

/**
 * Manda un evento. **No devuelve nada y no lanza nunca.**
 *
 * El tipo de retorno es `void` a propósito, no `Promise<void>`: si devolviera una promesa,
 * alguien acabaría escribiendo `await track(...)` en un manejador de clic y la telemetría
 * pasaría a estar en el camino crítico de una acción del jugador. No poder esperarla es la
 * garantía de que no bloquea.
 */
export function track(eventName: EventName, opts: TrackOptions = {}): void {
  try {
    if (typeof window === "undefined") return;

    const sessionId = opts.sessionId ?? currentSession().id;

    void send({
      event_name: eventName,
      session_id: sessionId,
      zone: opts.zone,
      flow: opts.flow,
      source: opts.source,
      severity: opts.severity,
      metadata: opts.metadata,
    });
  } catch {
    /* Ni el propio `track` puede tumbar a quien lo llama. */
  }
}

async function send(payload: Record<string, unknown>): Promise<void> {
  try {
    /*
     * El token, cuando lo hay.
     *
     * Sin él la petición sigue saliendo y el evento se guarda con `user_id = null`, que es
     * lo correcto para un visitante anónimo. El servidor deriva la identidad de este
     * encabezado y NUNCA del cuerpo — por eso aquí no se envía ningún `user_id`.
     */
    const headers: Record<string, string> = { "content-type": "application/json" };
    try {
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb.auth.getSession();
        const token = data.session?.access_token;
        if (token) headers.authorization = `Bearer ${token}`;
      }
    } catch { /* sin token: se manda igual, como anónimo */ }

    await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      // Que el evento salga aunque la pestaña se esté cerrando.
      keepalive: true,
      // La telemetría no necesita cookies y no debe arrastrarlas.
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    /* Sin red, servidor caído, petición abortada. Se pierde el evento y ya está. */
  }
}

/* ═══════════════════════════ LOS CUATRO EVENTOS ═══════════════════════════ */

/**
 * Arranque de sesión. Idempotente: si la sesión ya estaba viva, no emite nada.
 *
 * Devuelve el identificador para que quien arranca pueda encadenar la primera zona con la
 * misma sesión sin volver a leer el almacenamiento.
 */
export function startSession(pathname: string): { sessionId: string; isNew: boolean } {
  try {
    if (typeof window === "undefined") return { sessionId: "", isNew: false };
    const { id, isNew } = currentSession();
    if (!isNew) return { sessionId: id, isNew: false };

    errorsSent = 0;
    seenFingerprints.clear();

    track("session_started", {
      sessionId: id,
      metadata: {
        entry_zone: zoneFromPath(pathname),
        referrer_kind: referrerKind(),
        viewport: window.innerWidth < 768 ? "mobile" : "desktop",
      },
    });
    return { sessionId: id, isNew: true };
  } catch {
    return { sessionId: "", isNew: false };
  }
}

/**
 * De dónde vino, en tres categorías y sin guardar la dirección.
 *
 * La URL de origen puede llevar identificadores de terceros, así que no viaja. Saber si
 * alguien llegó de fuera, de dentro o directo responde la pregunta sin traer el problema.
 */
function referrerKind(): "direct" | "internal" | "external" {
  try {
    const r = document.referrer;
    if (!r) return "direct";
    return new URL(r).origin === window.location.origin ? "internal" : "external";
  } catch {
    return "direct";
  }
}

/** La última zona emitida, para no contar dos veces la misma. */
let lastZone: Zone | null = null;

/**
 * Cambio de zona.
 *
 * NO se emite si la zona no ha cambiado. Eso descarta de un plumazo lo que el encargo
 * pedía evitar: un filtro, una paginación, un cambio de consulta o un refresco no son
 * zonas nuevas. Lo que se quiere saber es «¿qué zonas usa el jugador?», no «¿cuántos
 * renders hizo React?».
 */
export function trackZone(pathname: string, isFirstOfSession = false): void {
  try {
    const zone = zoneFromPath(pathname);
    if (zone === lastZone) return;
    const from = lastZone;
    lastZone = zone;

    track("zone_entered", {
      zone,
      metadata: {
        is_first_of_session: isFirstOfSession,
        ...(from ? { from_zone: from } : {}),
      },
    });
  } catch { /* nunca rompe la navegación */ }
}

/** Apertura de un flujo cuyo inicio no cambia la ruta. */
export function trackFlow(flow: Flow, context?: string): void {
  track("flow_started", {
    flow,
    metadata: { flow, ...(context ? { context } : {}) },
  });
}

/**
 * Un error.
 *
 * Tres cortafuegos, en este orden:
 *   1. si ya se está mandando un error, este se descarta (bucle);
 *   2. si la huella ya se vio en esta sesión, se descarta (repetición);
 *   3. si se llegó al techo de la sesión, se descarta (avalancha).
 *
 * El mensaje se sanea en el SERVIDOR, que es donde manda el contrato. Aquí solo se recorta
 * para no mandar un megabyte por la red.
 */
export function trackError(input: {
  code: string;
  message: string;
  source: Source;
  severity: Severity;
  zone?: Zone;
  flow?: Flow;
}): void {
  try {
    if (sendingError) return;
    if (errorsSent >= MAX_ERRORS_PER_SESSION) return;

    const fingerprint = shortHash(`${input.code}|${input.message.slice(0, 120)}`);
    if (seenFingerprints.has(fingerprint)) return;
    seenFingerprints.add(fingerprint);
    errorsSent++;

    sendingError = true;
    try {
      track("error_captured", {
        source: input.source,
        severity: input.severity,
        zone: input.zone ?? (typeof window !== "undefined" ? zoneFromPath(window.location.pathname) : undefined),
        flow: input.flow,
        metadata: {
          code: input.code.slice(0, 60),
          message: input.message.slice(0, 500),
          fingerprint,
        },
      });
    } finally {
      /*
       * Se libera en el siguiente tic, no de inmediato: `track` dispara la petición sin
       * esperarla, así que un fallo síncrono de esa petición todavía llegaría dentro de
       * esta pila. Soltar la bandera aquí mismo reabriría el bucle que cierra.
       */
      setTimeout(() => { sendingError = false; }, 0);
    }
  } catch {
    sendingError = false;
  }
}

/** Huella corta y estable. No es criptográfica: solo tiene que agrupar repeticiones. */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Solo para los tests: devuelve el estado interno a cero. */
export function __resetTelemetryForTests(): void {
  lastZone = null;
  sendingError = false;
  errorsSent = 0;
  seenFingerprints.clear();
}
