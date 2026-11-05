/**
 * F81.1 · BARRERA ESTRUCTURAL DEL MOTOR LOCAL DE SOBRES.
 *
 * El motor local (`useGameStore.openPackFromInventory` / `buyPack`) es el modo de un solo jugador SIN cuenta: un
 * visitante sin sesión juega con un saldo e inventario de demostración que nunca toca el servidor. Con cuenta, los
 * sobres los compra y abre EL SERVIDOR y ninguna apertura puede generarse en el navegador.
 *
 * La pantalla decidía «local o servidor» con la foto de `useAuth()` en el instante del clic; esa foto puede decir «sin
 * usuario» con una sesión GUARDADA (recarga en frío, refresco de token a medias): medido en F81, una apertura local con
 * sesión iniciada. Por eso la barrera NO es la foto de React sino una señal síncrona e independiente, comprobada DENTRO
 * de las acciones locales del store (cualquier llamador queda cubierto):
 *
 *   · backend configurado (producción)  Y  hay artefactos de sesión de Supabase guardados  →  motor local PROHIBIDO.
 *
 * Sin backend (build local/escritorio) o sin rastro de sesión (visitante de verdad) el modo local sigue existiendo.
 */
import { isSupabaseConfigured } from "@/lib/supabase/client";

/** Claves que guarda supabase-js para la sesión (`sb-<ref>-auth-token`, troceada como `.0`, `.1`… si es grande). */
export const SESSION_KEY_RE = /^sb-.+-auth-token(\.\d+)?$/;

export const LOCAL_ECONOMY_BLOCKED =
  "Con tu cuenta, los sobres los abre el servidor. Estamos recuperando tu cuenta: vuelve a intentarlo en un momento.";

/** Error tipado: quien lo recibe sabe que NO hubo apertura (ni local ni de servidor). */
export class LocalEconomyBlockedError extends Error {
  constructor() { super(LOCAL_ECONOMY_BLOCKED); this.name = "LocalEconomyBlockedError"; }
}

type KeyedStorage = Pick<Storage, "length" | "key">;

function browserStorage(): KeyedStorage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

/** ¿Hay una sesión de Supabase guardada en este navegador (aunque React aún no la haya resuelto)? */
export function storedSessionPresent(storage: KeyedStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && SESSION_KEY_RE.test(k)) return true;
  }
  return false;
}

/**
 * Motivo por el que el motor local NO puede usarse ahora (o `null` si es un visitante de verdad / build sin backend).
 * `signedIn` = lo que sepa el llamador de React (usuario o sesión resolviéndose): también bloquea.
 */
export function localEconomyBlockReason(opts: { configured?: boolean; storage?: KeyedStorage | null; signedIn?: boolean } = {}): string | null {
  const configured = opts.configured ?? isSupabaseConfigured();
  if (!configured) return null;
  if (opts.signedIn) return LOCAL_ECONOMY_BLOCKED;
  if (storedSessionPresent(opts.storage === undefined ? browserStorage() : opts.storage)) return LOCAL_ECONOMY_BLOCKED;
  return null;
}

/* ───────────────────── F81.2 · ¿QUÉ INVENTARIO PUEDE VERSE AHORA? ───────────────────── */

/**
 * F81.2 · VISTA DE LA ECONOMÍA. El store persistido (`drl-champions`) arranca con lo último guardado o con el
 * inventario de demostración (6.000 créditos, sobres de inicio); `hydrated` solo dice que Zustand ya leyó esa caché, no
 * que sea de esta cuenta. Medido en producción: un jugador con sesión veía 6.000 créditos y sobres de demo hasta que
 * llegaba su estado (2.120). Tres estados que NUNCA se confunden:
 *
 *   · `unknown`    — la sesión o el estado del servidor aún no se conocen: NADA de cifras (ni demo ni caché).
 *   · `server`     — hay usuario y el store contiene SU estado, leído del servidor en esta carga.
 *   · `guest`      — visitante confirmado (sesión resuelta, ningún usuario y ningún rastro de sesión): modo demo.
 *
 * y dos salidas que tampoco enseñan cifras, para no cargar para siempre:
 *
 *   · `error`      — hay usuario pero su estado no se pudo leer: reintento.
 *   · `unverified` — no hay usuario pero queda una sesión guardada (refresco de token fallido sin borrarla): reintento.
 *
 * `null` en `userId` mientras `loading` NO significa «visitante»: ese es exactamente el error que se cierra aquí.
 */
export type EconomyView = "unknown" | "server" | "guest" | "error" | "unverified";

export interface EconomyFacts {
  configured: boolean;
  /** La sesión de Supabase aún se está resolviendo. */
  loading: boolean;
  userId: string | null;
  /** Dueño del estado de servidor volcado en el store EN ESTA CARGA (no se persiste). */
  serverOwner: string | null;
  /** Dueño del estado guardado en la caché persistida (null = demo o nunca hubo cuenta). */
  cacheOwner: string | null;
  /** Hay claves `sb-*-auth-token` guardadas. */
  sessionStored: boolean;
  /** Fallo de la última lectura del estado de servidor (null = sin fallo). */
  syncError: string | null;
}

export function economyView(f: EconomyFacts): EconomyView {
  if (!f.configured) return "guest"; // build sin backend: el modo local es el único que hay
  if (f.loading) return "unknown";
  if (f.userId) {
    if (f.serverOwner === f.userId) return "server";
    return f.syncError ? "error" : "unknown";
  }
  if (f.sessionStored) return "unverified";
  // Visitante confirmado con la caché de una cuenta anterior: se limpia (CloudSync) antes de enseñar la demo.
  if (f.cacheOwner) return "unknown";
  return "guest";
}

/** F81.2 · dueño de una caché anterior a F81.2 encontrada junto a una sesión guardada (ver `mergePersisted`). */
export const LEGACY_CACHE_OWNER = "legacy-cache";

/** ¿Puede pintarse el inventario del store (saldo, XP, sobres, cartas) en esta vista? */
export const economyVisible = (v: EconomyView): boolean => v === "server" || v === "guest";

/** Lo que se ve cuando la cuenta no se pudo recuperar (nunca el texto técnico). */
export const ECONOMY_UNAVAILABLE = "No hemos podido recuperar tu cuenta. Comprueba la conexión y vuelve a intentarlo.";
