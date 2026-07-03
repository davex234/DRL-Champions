/**
 * PLATFORM — MOTOR DE ACTUALIZACIÓN (AAA, estilo Riot/Epic/Battle.net).
 *
 * Usa el sistema OFICIAL de Tauri 2 (`@tauri-apps/plugin-updater` + `plugin-process`):
 * NO es un updater propio. El controlador añade por encima lo que un launcher profesional
 * necesita y que el plugin no da por sí solo: máquina de estados observable, métricas de
 * descarga (velocidad suavizada, ETA, %, tamaño), fases granulares (descargando → verificando
 * → instalando → finalizando → reiniciando), flujo separable (para auto-descarga/instalación/
 * reinicio configurables) y canales/ramas.
 *
 * Arquitectura: el controlador depende de un `UpdaterBackend` INYECTABLE. En producción el
 * backend real envuelve el plugin de Tauri (descarga firmada + verificación minisign). Fuera
 * de Tauri (web) el backend es no-op y reporta "al día". El harness inyecta un backend
 * determinista para probar la máquina de estados (DI real, no mocks en producción). Las
 * funciones de cálculo son puras y exportadas para testarlas.
 *
 * REGLA DE ORO: solo el LAUNCHER usa este módulo. El juego nunca se actualiza a sí mismo.
 */
import { APP_VERSION } from "./version";
import { recordUpdate, info as logInfo, error as logError } from "./log";
import { type Channel, channelHeaders } from "./channels";
import { isTauri, osName } from "./env";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────
export type UpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "verifying"
  | "downloaded" // descargado y firmado, esperando instalar (autoInstall off)
  | "installing"
  | "finalizing"
  | "ready" // instalado, esperando reinicio (autoRestart off)
  | "restarting"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  current: string;
  available: string | null;
  notes: string | null;
  date: string | null;
  availableSize: number | null; // tamaño de descarga conocido antes de empezar (meta.json)
  channel: Channel;
  bytesDownloaded: number;
  bytesTotal: number;
  percent: number; // 0..100
  speedBps: number; // bytes/seg (suavizado)
  etaSec: number; // segundos restantes estimados
  error: string | null;
  errorCode: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface RemoteUpdate {
  version: string;
  notes?: string | null;
  date?: string | null;
  _raw?: unknown; // handle opaco del backend (objeto Update de Tauri)
}

export interface UpdateMeta {
  size?: number;
  notes?: string;
}

export type DownloadEvent =
  | { kind: "started"; contentLength: number }
  | { kind: "progress"; chunkLength: number }
  | { kind: "finished" };

/** Abstracción del backend (DI). Producción = Tauri; harness = determinista. */
export interface UpdaterBackend {
  readonly name: string;
  /** Devuelve la actualización remota o null si ya estamos al día. */
  check(channel: Channel): Promise<RemoteUpdate | null>;
  /** Metadatos enriquecidos (tamaño/notas) desde meta.json. Best-effort. */
  meta?(channel: Channel): Promise<UpdateMeta | null>;
  /** Descarga el bundle firmado emitiendo eventos de progreso (firma verificada al acabar). */
  download(u: RemoteUpdate, onEvent: (e: DownloadEvent) => void): Promise<void>;
  /** Instala el bundle ya descargado. */
  install(u: RemoteUpdate): Promise<void>;
  /** Reinicia la app para aplicar la actualización. */
  relaunch(): Promise<void>;
  /** Reloj inyectable (ms) para cálculos deterministas en test. */
  now(): number;
}

export interface StartOptions {
  autoInstall?: boolean;
  autoRestart?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo de progreso (PURO — testeable)
// ─────────────────────────────────────────────────────────────────────────────
const KB = 1024,
  MB = KB * 1024,
  GB = MB * 1024;

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n >= GB) return `${(n / GB).toFixed(2)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(0)} MB`;
  if (n >= KB) return `${(n / KB).toFixed(0)} KB`;
  return `${n} B`;
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  return `${formatBytes(bps)}/s`;
}

export function formatEta(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m} m ${r.toString().padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${(m % 60).toString().padStart(2, "0")} m`;
}

export interface ProgressSample {
  bytesDownloaded: number;
  bytesTotal: number;
  speedBps: number;
  etaSec: number;
  percent: number;
  lastTickMs: number;
}

export function newProgress(nowMs: number, total = 0): ProgressSample {
  return { bytesDownloaded: 0, bytesTotal: total, speedBps: 0, etaSec: 0, percent: 0, lastTickMs: nowMs };
}

/** Avanza el progreso con un chunk recibido. Velocidad suavizada (EWMA). Función PURA. */
export function advanceProgress(prev: ProgressSample, chunkLen: number, nowMs: number): ProgressSample {
  const bytesDownloaded = prev.bytesDownloaded + chunkLen;
  const dtSec = Math.max((nowMs - prev.lastTickMs) / 1000, 1e-3);
  const instBps = chunkLen / dtSec;
  const speedBps = prev.speedBps <= 0 ? instBps : prev.speedBps * 0.7 + instBps * 0.3;
  const total = prev.bytesTotal;
  const percent = total > 0 ? Math.min(100, (bytesDownloaded / total) * 100) : 0;
  const remaining = Math.max(total - bytesDownloaded, 0);
  const etaSec = speedBps > 0 && total > 0 ? remaining / speedBps : 0;
  return { bytesDownloaded, bytesTotal: total, speedBps, etaSec, percent, lastTickMs: nowMs };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Backend de PRODUCCIÓN — Tauri 2 oficial
// ─────────────────────────────────────────────────────────────────────────────
const UPDATE_BASE = "https://update.drlchampions.com";

function currentPlatformKey(): string {
  const os = osName();
  if (os === "macos") return "darwin-x86_64";
  if (os === "linux") return "linux-x86_64";
  return "windows-x86_64";
}

class TauriBackend implements UpdaterBackend {
  readonly name = "tauri";
  now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }
  async check(channel: Channel): Promise<RemoteUpdate | null> {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ headers: channelHeaders(channel) });
    if (!update) return null;
    return { version: update.version, notes: update.body ?? null, date: update.date ?? null, _raw: update };
  }
  async meta(channel: Channel): Promise<UpdateMeta | null> {
    try {
      const res = await fetch(`${UPDATE_BASE}/${channel}/meta.json`, { headers: channelHeaders(channel) });
      if (!res.ok) return null;
      const j = (await res.json()) as { notes?: string; platforms?: Record<string, { size?: number }> };
      const size = j.platforms?.[currentPlatformKey()]?.size;
      return { size: typeof size === "number" ? size : undefined, notes: typeof j.notes === "string" ? j.notes : undefined };
    } catch {
      return null;
    }
  }
  async download(u: RemoteUpdate, onEvent: (e: DownloadEvent) => void): Promise<void> {
    const update = u._raw as { download: (cb: (e: TauriDownloadEvent) => void) => Promise<void> };
    await update.download((e) => onEvent(mapTauriEvent(e)));
  }
  async install(u: RemoteUpdate): Promise<void> {
    const update = u._raw as { install: () => Promise<void> };
    await update.install();
  }
  async relaunch(): Promise<void> {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  }
}

interface TauriDownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: { contentLength?: number; chunkLength?: number };
}
function mapTauriEvent(e: TauriDownloadEvent): DownloadEvent {
  if (e.event === "Started") return { kind: "started", contentLength: e.data?.contentLength ?? 0 };
  if (e.event === "Progress") return { kind: "progress", chunkLength: e.data?.chunkLength ?? 0 };
  return { kind: "finished" };
}

/** Backend no-op para web/navegador: nunca hay actualización, sin romper. */
class NoopBackend implements UpdaterBackend {
  readonly name = "noop";
  now() {
    return Date.now();
  }
  async check(): Promise<RemoteUpdate | null> {
    return null;
  }
  async download(): Promise<void> {}
  async install(): Promise<void> {}
  async relaunch(): Promise<void> {
    if (typeof location !== "undefined") location.reload();
  }
}

export function defaultBackend(): UpdaterBackend {
  return isTauri() ? new TauriBackend() : new NoopBackend();
}

// ─────────────────────────────────────────────────────────────────────────────
// Controlador observable
// ─────────────────────────────────────────────────────────────────────────────
type Listener = (s: UpdateState) => void;

export class UpdateController {
  private state: UpdateState;
  private listeners = new Set<Listener>();
  private prog: ProgressSample;
  private pending: RemoteUpdate | null = null;

  constructor(
    private backend: UpdaterBackend = defaultBackend(),
    channel: Channel = "stable",
    current: string = APP_VERSION,
    /** Pausa cosmética entre fases (ms) para que el usuario vea verificar/finalizar. 0 en tests. */
    private paceMs = 600,
  ) {
    this.prog = newProgress(this.backend.now());
    this.state = {
      phase: "idle",
      current,
      available: null,
      notes: null,
      date: null,
      availableSize: null,
      channel,
      bytesDownloaded: 0,
      bytesTotal: 0,
      percent: 0,
      speedBps: 0,
      etaSec: 0,
      error: null,
      errorCode: null,
      startedAt: null,
      finishedAt: null,
    };
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  setChannel(channel: Channel): void {
    if (channel !== this.state.channel) this.patch({ channel });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private patch(p: Partial<UpdateState>): void {
    this.state = { ...this.state, ...p };
    const snap = this.getState();
    for (const l of this.listeners) l(snap);
  }

  private async pace(): Promise<void> {
    if (this.paceMs > 0) await delay(this.paceMs);
  }

  private fail(code: string, e: unknown): false {
    const msg = (e as Error)?.message || String(e);
    logError("update", `[${code}] ${msg}`);
    this.patch({ phase: "error", error: msg, errorCode: code });
    return false;
  }

  /** Comprueba si hay actualización en el canal actual. Lanza si la red falla (para offline). */
  async check(): Promise<UpdateState> {
    if (this.state.phase === "downloading" || this.state.phase === "installing") return this.getState();
    this.patch({ phase: "checking", error: null, errorCode: null });
    const u = await this.backend.check(this.state.channel); // si lanza → lo gestiona el llamante (offline)
    if (!u) {
      this.pending = null;
      recordUpdate(`Sin actualizaciones (canal ${this.state.channel})`);
      this.patch({ phase: "up-to-date", available: null, notes: null, date: null, availableSize: null });
      return this.getState();
    }
    this.pending = u;
    recordUpdate(`Actualización disponible: v${u.version} (canal ${this.state.channel})`);
    this.patch({ phase: "available", available: u.version, notes: u.notes ?? null, date: u.date ?? null });
    // Enriquecer con tamaño/notas (best-effort, no bloquea).
    try {
      const m = await this.backend.meta?.(this.state.channel);
      if (m) this.patch({ availableSize: m.size ?? null, notes: m.notes ?? this.state.notes });
    } catch {
      /* meta opcional */
    }
    return this.getState();
  }

  /**
   * Inicia la actualización. Flujo separable según opciones (toggles de configuración):
   *   descargar → verificar → [instalar → finalizar → [reiniciar]]
   */
  async start(opts: StartOptions = {}): Promise<boolean> {
    const autoInstall = opts.autoInstall ?? true;
    const autoRestart = opts.autoRestart ?? true;
    if (!this.pending) {
      try {
        await this.check();
      } catch (e) {
        return this.fail("CHECK_FAILED", e);
      }
      if (!this.pending) return false;
    }
    const u = this.pending;
    this.prog = newProgress(this.backend.now());
    this.patch({
      phase: "downloading",
      error: null,
      errorCode: null,
      startedAt: Date.now(),
      finishedAt: null,
      bytesDownloaded: 0,
      bytesTotal: 0,
      percent: 0,
      speedBps: 0,
      etaSec: 0,
    });
    try {
      await this.backend.download(u, (e) => this.onDownloadEvent(e));
    } catch (e) {
      return this.fail("DOWNLOAD_FAILED", e);
    }
    // Al resolver download(), Tauri ya verificó la firma minisign.
    this.patch({ phase: "verifying", percent: 100, etaSec: 0 });
    logInfo("update", `Descarga completada v${u.version} (firma verificada)`);
    await this.pace();
    if (!autoInstall) {
      this.patch({ phase: "downloaded" });
      return true;
    }
    return this.install(autoRestart);
  }

  /** Instala el bundle ya descargado (fase manual tras "downloaded", o encadenado desde start). */
  async install(autoRestart = true): Promise<boolean> {
    const u = this.pending;
    if (!u) return false;
    this.patch({ phase: "installing", error: null, errorCode: null });
    try {
      await this.backend.install(u);
    } catch (e) {
      return this.fail("INSTALL_FAILED", e);
    }
    this.patch({ phase: "finalizing" });
    logInfo("update", `Instalada v${u.version}`);
    await this.pace();
    if (!autoRestart) {
      this.patch({ phase: "ready", finishedAt: Date.now() });
      return true;
    }
    return this.restart();
  }

  /** Reinicia la app para aplicar la actualización (cierra y reabre). */
  async restart(): Promise<boolean> {
    this.patch({ phase: "restarting", finishedAt: Date.now() });
    recordUpdate("Reiniciando para aplicar la actualización…");
    try {
      await this.backend.relaunch();
      return true;
    } catch (e) {
      return this.fail("RESTART_FAILED", e);
    }
  }

  /** Compatibilidad: descarga + instala + (opcional) reinicia en un paso. */
  async downloadAndInstall(relaunchAfter = true): Promise<boolean> {
    return this.start({ autoInstall: true, autoRestart: relaunchAfter });
  }

  private onDownloadEvent(e: DownloadEvent): void {
    if (e.kind === "started") {
      this.prog = newProgress(this.backend.now(), e.contentLength);
      this.patch({ bytesTotal: e.contentLength });
    } else if (e.kind === "progress") {
      this.prog = advanceProgress(this.prog, e.chunkLength, this.backend.now());
      this.patch({
        bytesDownloaded: this.prog.bytesDownloaded,
        bytesTotal: this.prog.bytesTotal,
        percent: this.prog.percent,
        speedBps: this.prog.speedBps,
        etaSec: this.prog.etaSec,
      });
    } else {
      this.patch({ percent: this.state.bytesTotal > 0 ? 100 : this.state.percent, etaSec: 0 });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton para la app (el launcher lo usa; el juego NO)
// ─────────────────────────────────────────────────────────────────────────────
let _controller: UpdateController | null = null;
export function getUpdateController(channel: Channel = "stable"): UpdateController {
  if (!_controller) _controller = new UpdateController(defaultBackend(), channel);
  else _controller.setChannel(channel);
  return _controller;
}
/** Inyección para tests/harness. */
export function setUpdateController(c: UpdateController | null): void {
  _controller = c;
}
