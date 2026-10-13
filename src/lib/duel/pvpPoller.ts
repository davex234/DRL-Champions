/**
 * POLLER DE SINCRONIZACIÓN PvP (Bloque 7.3).
 *
 * Un bucle, uno solo, que pregunta al servidor cada cuánto conviene y publica el resultado.
 *
 * POR QUÉ ES UNA CLASE Y NO UN HOOK. Todo lo difícil de un sondeo —cuándo repetir, qué hacer
 * con una respuesta que llega tarde, cuánto esperar tras un fallo, cuándo parar— no tiene nada
 * que ver con React. Metido en un `useEffect` sería imposible de probar: el proyecto no tiene
 * jsdom ni testing-library, así que un hook con temporizadores no se puede ejercitar. Aquí el
 * reloj, los temporizadores, el transporte y la visibilidad ENTRAN INYECTADOS, y por eso los
 * 15 tests del bucle son deterministas y corren en `node:test` sin navegador. El hook de React
 * es una envoltura de veinte líneas encima.
 *
 * TRES INVARIANTES QUE EL BUCLE NO PUEDE ROMPER
 *
 *   1. **Un solo bucle.** Da igual cuántas veces se pida sincronizar: hay como mucho una
 *      petición en vuelo y como mucho un temporizador armado.
 *   2. **Una respuesta vieja NUNCA pisa una nueva.** La única regla de admisión es
 *      `versión recibida > versión actual`. Si la #10 llega después de la #11, se descarta —no
 *      por su orden de llegada, que no controlamos, sino por su contenido.
 *   3. **El servidor manda.** El poller no decide de quién es el turno ni si la partida acabó;
 *      solo transporta lo que el servidor dice y ajusta su propio ritmo.
 */
import type { PvpMatchSnapshot, PvpSyncResponse } from "@/domain/cardgame/pvp";
import {
  PvpSyncError, isRetryable,
  type PvpPlayInput, type PvpSyncErrorKind, type PvpSyncTransport,
} from "./pvpTransport";

// ───────────────────────────── estado de RED (no de juego) ─────────────────────────────

/**
 * Estado de la SINCRONIZACIÓN. No se mezcla con `MatchStatus` ni con `TurnPhase`, que son
 * estado de JUEGO: que la red vaya mal no cambia de quién es el turno, y que sea tu turno no
 * dice nada de la red. Son dos ejes y se cruzan.
 */
export type SyncStatus =
  | "IDLE"      // aún no ha empezado
  | "SYNCING"   // hay una petición en vuelo y todavía no tenemos nada
  | "SYNCED"    // al día
  | "STALE"     // tenemos estado, pero el último intento falló y se está reintentando
  | "ERROR"     // no se puede seguir (sesión inválida, partida inexistente)
  | "TERMINAL"; // la partida acabó; no habrá más cambios y el bucle está parado

export interface SyncState {
  status: SyncStatus;
  /** Versión conocida. `-1` mientras no se haya recibido nada. */
  stateVersion: number;
  lastSyncedAt: number | null;
  error: { kind: PvpSyncErrorKind; message: string } | null;
  snapshot: PvpMatchSnapshot | null;
  /**
   * `serverNow - clientNow` del último intercambio. SOLO para pintar una cuenta atrás estable.
   * Nunca para decidir si un turno venció: eso lo decide el servidor.
   */
  serverOffset: number;
  consecutiveFailures: number;
}

export const initialSyncState = (): SyncState => ({
  status: "IDLE",
  stateVersion: -1,
  lastSyncedAt: null,
  error: null,
  snapshot: null,
  serverOffset: 0,
  consecutiveFailures: 0,
});

// ───────────────────────────── ritmo ─────────────────────────────

/**
 * Cada cuánto preguntar, en milisegundos.
 *
 * El criterio NO es «la partida está viva», sino **«¿puede cambiar algo ahora mismo?»**:
 *
 *   · Turno del RIVAL → 1200 ms. Es el único momento en que el estado puede cambiar sin que
 *     hagamos nada, así que es cuando el sondeo sirve para algo.
 *   · Turno PROPIO    → 2500 ms. No va a cambiar nada hasta que actuemos, y cuando actuemos
 *     recibiremos el estado en la respuesta de la acción. Se sondea solo por si el rival
 *     abandona o vence el reloj.
 *   · Pestaña oculta  → 15 s. Nadie está mirando.
 *
 * El encargo proponía «partida activa 1000-1500 / no activa 2000-3000»; esto lo respeta y
 * además dice qué significa «activa» en un juego por turnos.
 */
export const POLL_MS = {
  rivalTurn: 1200,
  ownTurn: 2500,
  hidden: 15_000,
} as const;

/** Reintento tras fallo: 1s, 2s, 4s, 8s y tope de 10s. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;

export const backoffFor = (failures: number): number =>
  BACKOFF_MS[Math.min(Math.max(failures, 1) - 1, BACKOFF_MS.length - 1)];

export type Visibility = "visible" | "hidden";

/** Intervalo que toca, dado el estado. Puro: es la pieza que más conviene poder probar sola. */
export function intervalFor(state: SyncState, visibility: Visibility): number | null {
  // Terminal o error irrecuperable: no se vuelve a preguntar. Nunca.
  if (state.status === "TERMINAL" || state.status === "ERROR") return null;
  if (state.consecutiveFailures > 0) return backoffFor(state.consecutiveFailures);
  if (visibility === "hidden") return POLL_MS.hidden;
  // Sin snapshot todavía, se asume el ritmo vivo hasta saber de quién es el turno.
  if (!state.snapshot) return POLL_MS.rivalTurn;
  return state.snapshot.isYourTurn ? POLL_MS.ownTurn : POLL_MS.rivalTurn;
}

// ───────────────────────────── el bucle ─────────────────────────────

export interface PollerDeps {
  transport: PvpSyncTransport;
  /** Reloj del cliente. Inyectado para poder probar el desfase. */
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Crea el controlador de aborto. Inyectado porque los tests no tienen DOM. */
  createAbort?: () => AbortController;
}

export type SyncListener = (state: SyncState) => void;

export class PvpSyncPoller {
  private state: SyncState = initialSyncState();
  private listeners = new Set<SyncListener>();
  private timer: unknown = null;
  private inFlight: AbortController | null = null;
  private visibility: Visibility = "visible";
  private disposed = false;
  /** Contador de peticiones: sirve para descartar respuestas de una generación anterior. */
  private generation = 0;

  constructor(private readonly matchId: string, private readonly deps: PollerDeps) {}

  getSnapshot(): SyncState { return this.state; }

  subscribe(fn: SyncListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Arranca el bucle. Llamarlo dos veces NO crea dos bucles. */
  start(): void {
    if (this.disposed || this.state.status !== "IDLE") return;
    this.emit({ status: "SYNCING" });
    void this.tick();
  }

  /**
   * Sincroniza AHORA (refresco manual, o vuelta de la pestaña al primer plano).
   *
   * Protegido contra el doble clic y contra las peticiones solapadas: si ya hay una en vuelo,
   * no lanza otra. No crea un segundo bucle jamás — reutiliza el único que hay.
   */
  syncNow(): void {
    if (this.disposed || this.inFlight) return;
    if (this.state.status === "TERMINAL" || this.state.status === "ERROR") return;
    this.clearTimer();
    void this.tick();
  }

  /** Notifica un cambio de visibilidad. Al volver a primer plano, sincroniza de inmediato. */
  setVisibility(v: Visibility): void {
    if (this.disposed || this.visibility === v) return;
    this.visibility = v;
    if (v === "visible") this.syncNow();
    else this.schedule();
  }

  /** Corta todo: temporizador, petición en vuelo y suscriptores. Idempotente. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.inFlight?.abort();
    this.inFlight = null;
    this.listeners.clear();
  }

  /** Aplica una acción y adopta el estado que devuelve el servidor, sin esperar al sondeo. */
  async play(input: PvpPlayInput): Promise<PvpSyncResponse | null> {
    if (this.disposed) return null;
    try {
      const res = await this.deps.transport.play(this.matchId, input);
      this.accept(res);
      return res;
    } catch (e) {
      this.onError(e);
      return null;
    }
  }

  async abandon(): Promise<PvpSyncResponse | null> {
    if (this.disposed) return null;
    try {
      const res = await this.deps.transport.abandon(this.matchId);
      this.accept(res);
      return res;
    } catch (e) {
      this.onError(e);
      return null;
    }
  }

  // ─────────────── interior ───────────────

  private clearTimer(): void {
    if (this.timer !== null) { this.deps.clearTimer(this.timer); this.timer = null; }
  }

  private schedule(): void {
    if (this.disposed) return;
    this.clearTimer();
    const ms = intervalFor(this.state, this.visibility);
    if (ms === null) return;                       // terminal o error: se acabó el bucle
    this.timer = this.deps.setTimer(() => { this.timer = null; void this.tick(); }, ms);
  }

  private async tick(): Promise<void> {
    if (this.disposed || this.inFlight) return;    // nunca dos peticiones a la vez

    const gen = ++this.generation;
    const ctrl = this.deps.createAbort ? this.deps.createAbort() : new AbortController();
    this.inFlight = ctrl;

    try {
      const since = this.state.stateVersion >= 0 ? this.state.stateVersion : null;
      const res = await this.deps.transport.fetchSince(this.matchId, since, ctrl.signal);
      if (this.disposed) return;
      // Una respuesta de una generación anterior no manda: ya hay otra más nueva en curso.
      if (gen !== this.generation) return;
      this.accept(res);
    } catch (e) {
      if (this.disposed) return;
      if (gen !== this.generation) return;
      this.onError(e);
    } finally {
      if (this.inFlight === ctrl) this.inFlight = null;
      if (!this.disposed) this.schedule();
    }
  }

  /**
   * Admite —o descarta— una respuesta del servidor.
   *
   * LA REGLA: solo entra estado cuya versión sea ESTRICTAMENTE MAYOR que la conocida. Con eso
   * una respuesta que llega tarde es inofensiva por construcción, sin depender del orden de
   * llegada ni de relojes.
   */
  private accept(res: PvpSyncResponse): void {
    const offset = res.serverNow - this.deps.now();

    if (!res.changed) {
      // Sin cambios: se refresca el desfase y la marca de tiempo, y NADA más. El snapshot
      // que ya teníamos sigue siendo el bueno.
      this.emit({
        status: res.terminal ? "TERMINAL" : "SYNCED",
        lastSyncedAt: this.deps.now(),
        serverOffset: offset,
        error: null,
        consecutiveFailures: 0,
      });
      return;
    }

    if (res.stateVersion <= this.state.stateVersion) {
      // Llegó tarde. Se cuenta como sincronización correcta —el servidor respondió— pero no
      // se toca el estado de juego.
      this.emit({
        status: this.state.status === "TERMINAL" ? "TERMINAL" : "SYNCED",
        lastSyncedAt: this.deps.now(),
        serverOffset: offset,
        error: null,
        consecutiveFailures: 0,
      });
      return;
    }

    this.emit({
      status: res.terminal ? "TERMINAL" : "SYNCED",
      stateVersion: res.stateVersion,
      snapshot: res.snapshot,
      lastSyncedAt: this.deps.now(),
      serverOffset: offset,
      error: null,
      consecutiveFailures: 0,
    });
  }

  private onError(e: unknown): void {
    const err = e instanceof PvpSyncError ? e : new PvpSyncError("NETWORK", e instanceof Error ? e.message : "Error");
    if (err.kind === "ABORTED") return;            // la cancelamos nosotros: no es un fallo

    // Un 409 no es un fallo de red: es que nuestra versión iba atrasada. Se resuelve pidiendo
    // el estado completo en el siguiente ciclo, no contándolo como caída.
    if (err.kind === "CONFLICT") {
      this.emit({ status: "STALE", error: { kind: err.kind, message: err.message }, stateVersion: -1 });
      // F66 · si el 409 trae el estado actual, se adopta YA (una versión es siempre > -1): la pestaña vieja o el doble
      // clic se ven corregidos en la misma respuesta, sin esperar al siguiente sondeo ni pedir nada más.
      if (err.sync && err.sync.changed) this.accept(err.sync);
      return;
    }

    if (!isRetryable(err.kind)) {
      this.emit({ status: "ERROR", error: { kind: err.kind, message: err.message } });
      return;
    }

    const failures = this.state.consecutiveFailures + 1;
    this.emit({
      // Si ya teníamos estado, seguimos mostrándolo mientras se reintenta: STALE, no ERROR.
      status: this.state.snapshot ? "STALE" : "SYNCING",
      error: { kind: err.kind, message: err.message },
      consecutiveFailures: failures,
    });
  }
}

// ───────────────────────────── presentación ─────────────────────────────

/**
 * Etiqueta para la pantalla. Es PRESENTACIÓN: la autoridad sobre el turno sigue siendo del
 * servidor, y este texto no habilita ni deshabilita nada por sí mismo.
 */
export function syncLabel(state: SyncState): string {
  switch (state.status) {
    case "IDLE": return "Conectando…";
    case "SYNCING": return state.snapshot ? "Sincronizando…" : "Conectando…";
    case "STALE": return "Reconectando…";
    case "ERROR": return "No se pudo sincronizar";
    case "TERMINAL": return "Partida terminada";
    case "SYNCED":
      if (!state.snapshot) return "Sincronizado";
      return state.snapshot.isYourTurn ? "Tu turno" : "Turno rival";
  }
}

/**
 * Milisegundos que quedan de turno, corrigiendo el desfase de reloj.
 *
 * SOLO para pintar. Que esto llegue a cero no vence el turno: el turno lo vence el servidor.
 */
export function turnRemainingMs(state: SyncState, clientNow: number): number | null {
  const deadline = state.snapshot?.turnDeadlineAt;
  if (deadline === null || deadline === undefined) return null;
  return Math.max(0, deadline - (clientNow + state.serverOffset));
}
