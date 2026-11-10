/**
 * RECUPERACIÓN DE UN REVELADO TRAS RECARGA (Fase 21.2).
 *
 * ────────────────────────── QUÉ PROBLEMA RESUELVE ──────────────────────────
 *
 * El resultado de un sobre (`lastOpened`) vive solo en memoria: NO está en la persistencia del
 * store (`partialize`), y así debe seguir —es estado de UI, no economía—. Pero eso deja un
 * agujero de UX: el jugador pulsa «Abrir», el SERVIDOR ya consumió el sobre e insertó las cartas
 * en `user_cards`, y si el navegador se RECARGA antes de terminar la animación, la pantalla de
 * apertura vuelve a montar sin resultado en memoria y el inventario ya está a cero → mostraría
 * «No tienes este sobre», como si las cartas se hubieran perdido.
 *
 * Esta es la CAPA MÍNIMA para evitarlo, sin tocar el motor económico: al completarse una apertura
 * se guarda el resultado en `sessionStorage` (por pestaña, efímero); al montar, si hay un
 * resultado fresco para ESE sobre, la pantalla lo restaura y salta directamente al resumen — no
 * vuelve a abrir nada (la operación ya la cerró el servidor de forma idempotente). No genera
 * cartas, no repite el sorteo, no crea otra idempotencia: solo recupera lo que ya pasó.
 */
import type { OpenedResult } from "@/store/useGameStore";

const KEY = "drl-open-reveal";
/** Un revelado guardado caduca pronto: es una red para una recarga inmediata, no un historial. */
const TTL_MS = 10 * 60 * 1000;

interface StoredReveal {
  packId: string;
  results: OpenedResult[];
  at: number;
  /** Fase 40 · el jugador ya llegó al resumen de esta apertura. */
  seen?: boolean;
}

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // modo privado / storage bloqueado
  }
}

/** Guarda el resultado recién abierto, para poder recuperarlo si el navegador recarga. */
export function saveOpenReveal(packId: string, results: OpenedResult[]): void {
  const s = store();
  if (!s || results.length === 0) return;
  try {
    s.setItem(KEY, JSON.stringify({ packId, results, at: Date.now() } satisfies StoredReveal));
  } catch {
    /* cuota / serialización: la recuperación es opcional, nunca rompe la apertura. */
  }
}

/**
 * Fase 40 · marca el revelado como VISTO (el jugador llegó al resumen). Un revelado visto solo se recupera al RECARGAR
 * esa misma pantalla (`allowSeen`); si el jugador vuelve a `/abrir/<sobre>` desde otra pantalla («Abrir el siguiente
 * sobre» en el vestíbulo), ve un sobre sellado, no el resumen del anterior.
 */
export function markOpenRevealSeen(packId: string): void {
  const s = store();
  if (!s) return;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredReveal;
    if (parsed.packId !== packId || parsed.seen) return;
    s.setItem(KEY, JSON.stringify({ ...parsed, seen: true } satisfies StoredReveal));
  } catch { /* opcional */ }
}

/** ¿La carga ACTUAL del documento es una recarga de esta misma ruta? (Navigation Timing; sin API → no). */
export function isReloadOf(pathname: string): boolean {
  try {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return false;
    const nav = performance.getEntriesByType("navigation")[0] as (PerformanceEntry & { type?: string }) | undefined;
    return !!nav && nav.type === "reload" && new URL(nav.name).pathname === pathname;
  } catch {
    return false;
  }
}

/**
 * Devuelve el resultado guardado si es fresco y corresponde a ESTE sobre; si no, `null`. No borra:
 * una segunda recarga seguida debe seguir recuperando. Caduca solo o lo sobrescribe la siguiente
 * apertura. Un revelado ya VISTO solo vuelve con `allowSeen` (recarga de la propia pantalla).
 */
export function loadOpenReveal(packId: string, opts: { allowSeen?: boolean } = { allowSeen: true }): OpenedResult[] | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredReveal;
    if (parsed.packId !== packId) return null;
    if (!Array.isArray(parsed.results) || parsed.results.length === 0) return null;
    if (Date.now() - parsed.at > TTL_MS) { clearOpenReveal(); return null; }
    if (parsed.seen && !opts.allowSeen) return null;
    return parsed.results;
  } catch {
    return null;
  }
}

/** Descarta el revelado guardado (al empezar otra apertura o al salir). */
export function clearOpenReveal(): void {
  const s = store();
  try { s?.removeItem(KEY); } catch { /* no-op */ }
}

/* ═══════════════════════ APERTURA PENDIENTE (Fase 25) ═══════════════════════
 *
 * El hueco que quedaba: el servidor abre el sobre, la respuesta se pierde (red, recarga) y el
 * cliente nunca llega a guardar el revelado. Antes, reintentar abría OTRO sobre. Ahora el gesto
 * (`ref`) se guarda ANTES de pedir la apertura; si la respuesta no llega, la siguiente visita
 * repite la petición con el MISMO gesto y el servidor devuelve el resultado ya persistido
 * (`economy_ops`) o, si nunca lo recibió, abre por primera vez. Una apertura = un gesto.
 */
const PENDING_KEY = "drl-open-pending";

interface PendingOpen { packId: string; ref: string; at: number }

/** Gesto único de una apertura (sin dependencias: `crypto.randomUUID` o un fallback). */
export function newOpenGesture(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* entornos sin WebCrypto */ }
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function savePendingOpen(packId: string, ref: string): void {
  const s = store();
  try { s?.setItem(PENDING_KEY, JSON.stringify({ packId, ref, at: Date.now() } satisfies PendingOpen)); } catch { /* opcional */ }
}

/** Gesto pendiente para ESTE sobre, si la apertura anterior no llegó a confirmarse. */
export function loadPendingOpen(packId: string): string | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingOpen;
    if (p.packId !== packId || typeof p.ref !== "string" || !p.ref) return null;
    if (Date.now() - p.at > TTL_MS) { clearPendingOpen(); return null; }
    return p.ref;
  } catch {
    return null;
  }
}

export function clearPendingOpen(): void {
  const s = store();
  try { s?.removeItem(PENDING_KEY); } catch { /* no-op */ }
}
