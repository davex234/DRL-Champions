import { ns } from "@/i18n/runtime";

const t = ns("telemetry");

/**
 * TELEMETRÍA — EL CONTRATO (Fase 14, bloque 4).
 *
 * Módulo PURO: sin red, sin base de datos, sin `window`, sin `process`. Lo importan el
 * cliente (para emitir) y el servidor (para validar), y por eso no puede depender de
 * ninguno de los dos.
 *
 * ────────────────────────── POR QUÉ ESTÁ TODO AQUÍ ──────────────────────────
 *
 * Los conjuntos cerrados —eventos, zonas, flujos, severidades— existen ya en la base de
 * datos como restricciones `CHECK` (migración 0029). Repetirlos aquí no es duplicar la
 * verdad: es adelantarla. La base de datos es la última barrera y sigue siéndolo; esto
 * permite rechazar en el borde, con un mensaje entendible, en vez de dejar que un
 * `CHECK` reviente a mitad de una inserción.
 *
 * Si los dos discrepan, manda la base de datos. Por eso el endpoint no atrapa el error de
 * restricción para reetiquetarlo: lo deja fallar.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No decide nada. Ni una regla de juego, ni un crédito, ni un punto. Si todo este fichero
 * desapareciera, el producto seguiría siendo correcto.
 */

// ═══════════════════════════ CONJUNTOS CERRADOS ═══════════════════════════
// Los cuatro deben coincidir EXACTAMENTE con los CHECK de 0029.

export const EVENT_NAMES = [
  "session_started",
  "zone_entered",
  "flow_started",
  "error_captured",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Las 30 zonas de producto.
 *
 * Una ZONA no es una ruta. La diferencia no es estética: una ruta puede llevar
 * identificadores en el camino o en la consulta, y un enum cerrado no puede filtrar nada
 * por construcción. Además `/colecciones/champions-paris` y `/colecciones/ewc-2026` son
 * la misma respuesta a «¿qué zonas usa el jugador?».
 */
export const ZONES = [
  "home", "inventory", "store", "pack_ceremony",
  "collection", "collections",
  "market",
  "duel_hub", "deck_list", "duel_play", "duel_replay",
  "tournaments", "tournament_detail", "pickems",
  "pass", "rewards", "ranking", "account", "events",
  "trainer", "trainer_maps", "trainer_strats", "trainer_match", "trainer_teams",
  "career", "news", "world", "manager", "launcher",
  "other",
] as const;
export type Zone = (typeof ZONES)[number];

/**
 * Los cuatro flujos instrumentados.
 *
 * Son exactamente aquellos cuyo INICIO no cambia la ruta y por tanto no deja rastro en
 * ninguna tabla autoritativa. El caso que los justifica se midió en la Fase 13: pulsar
 * «Crear mi primer mazo» abre el constructor SIN cambiar de URL, así que quien lo abre y
 * se rinde es hoy invisible.
 */
export const FLOWS = [
  "deck_builder", "pack_ceremony", "pickem_form", "market_listing_form",
] as const;
export type Flow = (typeof FLOWS)[number];

export const SOURCES = ["client", "server"] as const;
export type Source = (typeof SOURCES)[number];

export const SEVERITIES = ["warn", "error", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Los nueve flujos críticos.
 *
 * `critical` NO significa «un error grave». Significa «un error que impide completar uno
 * de estos». Sin esta lista, «crítico» acabaría queriendo decir «el que escribió el
 * código estaba enfadado», y la consola de operaciones dejaría de servir para lo único
 * que tiene que servir: distinguir lo que impide jugar de lo que no.
 */
export const CRITICAL_FLOWS = [
  "login", "ftue", "pack_ceremony", "inventory", "deck_builder",
  "duel_play", "pickem_form", "market_listing_form", "reward_claim",
] as const;

export const isEventName = (v: unknown): v is EventName =>
  typeof v === "string" && (EVENT_NAMES as readonly string[]).includes(v);
export const isZone = (v: unknown): v is Zone =>
  typeof v === "string" && (ZONES as readonly string[]).includes(v);
export const isFlow = (v: unknown): v is Flow =>
  typeof v === "string" && (FLOWS as readonly string[]).includes(v);
export const isSource = (v: unknown): v is Source =>
  typeof v === "string" && (SOURCES as readonly string[]).includes(v);
export const isSeverity = (v: unknown): v is Severity =>
  typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// ═══════════════════════════ RUTA → ZONA ═══════════════════════════

/**
 * Traduce una ruta a su zona.
 *
 * SE APLICA EN LOS DOS LADOS. El cliente la usa para saber qué mandar; el servidor la
 * usa para no fiarse. Que sea la misma función es lo que garantiza que no puedan
 * discrepar — y que sea PURA es lo que permite probarla sin navegador.
 *
 * Las rutas dinámicas se normalizan a su zona: `/torneos/vlr-2976-emea` y
 * `/torneos/demo-masters` son las dos `tournament_detail`. El identificador se descarta
 * aquí, no más tarde: nunca llega a viajar.
 *
 * Lo desconocido cae en `other` en vez de perderse. Una ruta nueva sin entrada en este
 * mapa sigue contando como uso del producto, aunque no se sepa de qué.
 */
export function zoneFromPath(pathname: string): Zone {
  // Sin consulta, sin ancla, sin barra final. Antes de mirar nada.
  const p = (pathname.split("?")[0].split("#")[0] || "/").replace(/\/+$/, "") || "/";

  if (p === "/") return "home";

  const seg = p.split("/").filter(Boolean);
  const [a, b] = seg;

  switch (a) {
    case "abrir":        return "pack_ceremony";
    case "inventario":   return "inventory";
    case "tienda":       return "store";           // incluye /tienda/creditos
    case "coleccion":    return "collection";
    case "colecciones":  return "collections";     // incluye /colecciones/[slug]
    case "mercado":      return "market";
    case "duelos":
      if (b === "jugar")  return "duel_play";
      if (b === "mazos")  return "deck_list";
      if (b === "replay") return "duel_replay";
      return "duel_hub";
    // Fase 35: el hub de modos y Road to Champions son la entrada a los duelos; zona cerrada existente, sin ampliar 0029.
    case "jugar":        return "duel_hub";
    case "torneos":      return b ? "tournament_detail" : "tournaments";
    case "pickems":      return "pickems";
    case "logros":       return "pass";
    // Fase 34: la temporada es la casa del pase; la taxonomía de zonas es cerrada (CHECK 0029) y no se amplía.
    case "temporada":
    case "temporadas":   return "pass";
    case "recompensas":  return "rewards";
    case "ranking":      return "ranking";
    case "jugador":
    case "cuenta":       return "account";
    case "eventos":      return "events";
    case "entrenador":
      if (b === "mapas")   return "trainer_maps";
      if (b === "strats")  return "trainer_strats"; // incluye /strats/revisar
      if (b === "partido") return "trainer_match";
      if (b === "equipos") return "trainer_teams";
      return "trainer";
    case "carrera":      return "career";
    case "noticias":     return "news";
    case "mundo":        return "world";
    case "manager":      return "manager";
    case "launcher":     return "launcher";
    default:             return "other";
  }
}

// ═══════════════════════════ LISTA BLANCA DE METADATA ═══════════════════════════

/**
 * Qué claves admite cada evento. **Todo lo demás se descarta en silencio.**
 *
 * Descartar y no rechazar es deliberado, y solo para las CLAVES: una versión antigua del
 * cliente que mande una clave de más no debe perder el evento entero. Los campos de
 * primer nivel (evento, zona, flujo, severidad) sí se rechazan, porque ahí un valor
 * desconocido significa que alguien se ha inventado algo.
 */
export const METADATA_WHITELIST: Record<EventName, readonly string[]> = {
  session_started: ["entry_zone", "referrer_kind", "viewport"],
  zone_entered:    ["from_zone", "is_first_of_session"],
  flow_started:    ["flow", "context"],
  error_captured:  ["code", "message", "fingerprint", "flow"],
};

/** Valores cerrados dentro de la metadata. Un enum suelto es una puerta abierta. */
export const REFERRER_KINDS = ["direct", "internal", "external"] as const;
export const VIEWPORTS = ["mobile", "desktop"] as const;

// ═══════════════════════════ SANEADO ═══════════════════════════

/** Límites. Pequeños a propósito: la metadata es una etiqueta, no un documento. */
export const LIMITS = {
  /** Máximo de claves por evento tras la lista blanca. */
  maxKeys: 8,
  /** Longitud de cualquier cadena de la metadata. */
  maxStringLength: 300,
  /** Tamaño total del objeto serializado. El CHECK de la base de datos es 2048. */
  maxBytes: 1536,
} as const;

/**
 * PATRONES PROHIBIDOS.
 *
 * Se redactan por FORMA, no por nombre de clave, porque un secreto no llega siempre en un
 * campo que se llame «token»: llega dentro de un mensaje de error, pegado a una URL, o en
 * mitad de una frase. Buscar la forma es lo único que funciona.
 */
const REDACTIONS: [RegExp, string][] = [
  /*
   * JWT. La forma de un token de Supabase: cabecera base64url —que siempre empieza por
   * `ey`, porque `{"` codificado es `eyJ`— seguida de uno o dos bloques más.
   *
   * CORREGIDO EN EL QA DEL BLOQUE 4. La primera versión exigía cuatro caracteres mínimos
   * en cada bloque y dejaba pasar `ey….eyJzIjoxfQ.zzz`, con la firma de tres. Los tokens
   * reales tienen firmas largas, pero apostar a eso es exactamente la clase de suposición
   * que hace que un secreto acabe en una tabla. Ahora basta con la cabecera y un punto.
   */
  [/\bey[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+){1,2}/g, "[REDACTED_JWT]"],
  // Cualquier «Bearer …».
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED_BEARER]"],
  // Claves de API de las formas habituales.
  [/\b(sk|pk|api[_-]?key|secret)[_-][A-Za-z0-9_-]{8,}\b/gi, "[REDACTED_KEY]"],
  // Correo electrónico.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]"],
  // UUID: puede ser el identificador de otra persona o de una sesión.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED_UUID]"],
  // Cabecera de autorización, escrita de cualquier manera.
  [/\bauthorization\s*[:=]\s*\S+/gi, "[REDACTED_AUTH]"],
  // Cookies.
  [/\bcookie\s*[:=]\s*\S+/gi, "[REDACTED_COOKIE]"],
  // Cualquier URL con consulta: se queda el camino, se tira la consulta entera.
  [/(https?:\/\/[^\s?]+)\?\S*/gi, "$1?[REDACTED_QUERY]"],
  // Una consulta suelta, sin URL delante.
  [/\?[A-Za-z0-9_]+=[^\s]*/g, "?[REDACTED_QUERY]"],
  // Rutas absolutas del sistema de ficheros de quien ejecuta (Windows y POSIX).
  [/\b[A-Za-z]:\\[^\s"']{4,}/g, "[REDACTED_PATH]"],
  [/\/(?:home|Users|var|opt|root)\/[^\s"']{2,}/g, "[REDACTED_PATH]"],
  // Direcciones IPv4.
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[REDACTED_IP]"],
];

/** Redacta y trunca una cadena. Siempre en ese orden: truncar antes cortaría un patrón. */
export function sanitizeString(raw: string): string {
  let s = raw;
  for (const [re, to] of REDACTIONS) s = s.replace(re, to);
  return s.length > LIMITS.maxStringLength ? `${s.slice(0, LIMITS.maxStringLength)}…` : s;
}

/**
 * Aplica la lista blanca y sanea. Devuelve SIEMPRE un objeto plano de un solo nivel.
 *
 * PROFUNDIDAD UNO, sin excepciones. Un objeto anidado no se recorre: se descarta. No es
 * pereza — es la garantía de que ningún volcado de estado entre por accidente en un campo
 * que parecía inofensivo. Ningún evento de la taxonomía necesita anidar.
 */
export function sanitizeMetadata(
  eventName: EventName, raw: unknown,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;

  const allowed = METADATA_WHITELIST[eventName];
  let keys = 0;

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.includes(k)) continue;              // fuera de la lista blanca
    if (keys >= LIMITS.maxKeys) break;

    if (typeof v === "string") out[k] = sanitizeString(v);
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else continue;                                    // objeto, array, null, función: fuera
    keys++;
  }

  // Techo de tamaño. Se quitan claves por el final hasta caber; es preferible un evento
  // recortado a ninguno.
  const size = (o: object) => new TextEncoder().encode(JSON.stringify(o)).length;
  while (size(out) > LIMITS.maxBytes) {
    const last = Object.keys(out).pop();
    if (!last) break;
    delete out[last];
  }
  return out;
}

// ═══════════════════════════ FORMA DEL EVENTO ═══════════════════════════

/** Lo que el cliente puede mandar. Ni un campo más: el resto lo pone el servidor. */
export interface TelemetryInput {
  event_name: EventName;
  session_id?: string;
  zone?: Zone;
  flow?: Flow;
  source?: Source;
  severity?: Severity;
  metadata?: Record<string, unknown>;
}

/**
 * Coherencia entre campos, la misma que impone `telemetry_events_shape_check`.
 *
 * Comprobarla aquí no es duplicar la verdad: es poder responder «un zone_entered necesita
 * zona» en vez de devolver un error de restricción de PostgreSQL al navegador.
 */
export function shapeError(e: TelemetryInput): string | null {
  switch (e.event_name) {
    case "error_captured":
      if (!e.source) return "error_captured requiere source";
      if (!e.severity) return "error_captured requiere severity";
      return null;
    case "zone_entered":
      if (!e.zone) return "zone_entered requiere zone";
      if (e.severity || e.source) return t("zone_entered no lleva severity ni source");
      return null;
    case "flow_started":
      if (!e.flow) return "flow_started requiere flow";
      if (e.severity || e.source) return t("flow_started no lleva severity ni source");
      return null;
    case "session_started":
      if (e.flow || e.severity || e.source) return t("session_started no lleva flow, severity ni source");
      return null;
    default:
      return "event_name desconocido";
  }
}

/** La ventana de sesión: 30 minutos de inactividad. Aquí porque la usan cliente y tests. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
