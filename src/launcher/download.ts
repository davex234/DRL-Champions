/**
 * NEXUS LAUNCHER — GESTOR DE DESCARGAS (núcleo PURO).
 *
 * ────────────────────────── POR QUÉ ASÍ ──────────────────────────
 *
 * Una barra de progreso metida en un `setInterval` dentro de un componente es un juguete:
 * se pierde al desmontar, no se puede pausar de verdad, no sobrevive a un cambio de pantalla
 * y es imposible de probar. Aquí la descarga es una MÁQUINA DE ESTADOS pura:
 *
 *     advanceJob(job, dtMs, opts) → job'
 *
 * Sin relojes internos, sin timers, sin efectos. Quien la mueve es el `runner` (un único
 * bucle para toda la aplicación) y quien la guarda es el store. Eso hace que la misma lógica
 * corra en un test de `node:test` sin DOM y produzca exactamente el mismo resultado.
 *
 * El progreso REAL (velocidad suavizada, ETA, porcentaje) no se reinventa: reutiliza
 * `advanceProgress` de la capa Platform, que ya alimenta al actualizador del cliente.
 *
 * El jitter de red es DETERMINISTA (LCG sembrado por juego + nº de tick): la descarga se ve
 * viva —la velocidad respira— pero dos ejecuciones idénticas dan el mismo resultado.
 */
import { advanceProgress, type ProgressSample } from "@/platform/updater";
import type { DownloadJob, DownloadKind, DownloadStatus, Game, DiskLocation } from "./types";

/** Ancho de banda nominal de la conexión, en bytes/s (≈ 12,5 MB/s). */
export const BASE_BANDWIDTH_BPS = 13_100_000;

/** Duración de la fase de verificación de archivos, en ms. */
export const VERIFY_MS = 2600;
/** Duración de la fase de instalación en disco, en ms. */
export const INSTALL_MS = 4200;

const MB = 1024 * 1024;

/* ── Aleatoriedad determinista ───────────────────────────────────────────── */

/** Hash entero estable de una cadena (FNV-1a de 32 bits). */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Ruido en [0,1) reproducible para (semilla, tick). No usa Math.random. */
export function noise(seed: number, tick: number): number {
  let x = (seed + tick * 0x9e3779b9) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39) >>> 0;
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/**
 * Ancho de banda efectivo del tick: nominal ±22 % de respiración, recortado por el límite
 * configurado por el usuario. `limitMbps = 0` significa sin límite.
 */
export function effectiveBandwidth(seed: number, tick: number, limitMbps: number): number {
  const wobble = 0.78 + noise(seed, tick) * 0.44;
  const base = BASE_BANDWIDTH_BPS * wobble;
  const limit = limitMbps > 0 ? limitMbps * MB : Infinity;
  return Math.max(64 * 1024, Math.min(base, limit));
}

/* ── Ciclo de vida del trabajo ───────────────────────────────────────────── */

/** Bytes que mueve este trabajo: el parche si es actualización, el juego entero si no. */
export function jobBytesFor(game: Game, kind: DownloadKind): number {
  if (kind === "update") return game.patchBytes ?? Math.round(game.sizeBytes * 0.18);
  if (kind === "repair") return Math.round(game.sizeBytes * 0.35);
  return game.sizeBytes;
}

export function createJob(
  game: Game,
  kind: DownloadKind,
  installPath: string,
  now: number,
  resumeFromBytes = 0,
): DownloadJob {
  const totalBytes = jobBytesFor(game, kind);
  const downloadedBytes = Math.max(0, Math.min(resumeFromBytes, totalBytes));
  return {
    gameId: game.id,
    kind,
    status: "downloading",
    installPath,
    totalBytes,
    downloadedBytes,
    speedBps: 0,
    etaSec: 0,
    percent: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
    phaseMs: 0,
    ticks: 0,
    startedAt: now,
    updatedAt: now,
    error: null,
  };
}

/** Fases que consumen tiempo (el runner solo necesita moverse mientras haya alguna). */
export function isJobActive(status: DownloadStatus): boolean {
  return status === "downloading" || status === "verifying" || status === "installing" || status === "queued";
}

export function canPause(status: DownloadStatus): boolean {
  return status === "downloading" || status === "queued";
}

export function canResume(status: DownloadStatus): boolean {
  return status === "paused" || status === "error";
}

/** Cancelar deja de tener sentido una vez el juego está escribiéndose en disco. */
export function canCancel(status: DownloadStatus): boolean {
  return status !== "installing" && status !== "done" && status !== "cancelled";
}

export interface AdvanceOptions {
  /** Límite de velocidad en MB/s (0 = sin límite). */
  limitMbps: number;
  /** Marca de tiempo del tick, en ms. */
  now: number;
}

/**
 * Avanza UN trabajo `dtMs` milisegundos. Función pura: mismo entrada → misma salida.
 *
 * Recorre descargando → verificando → instalando → hecho. Las fases posteriores a la
 * descarga son de tiempo fijo porque es lo que son en un cliente real: copiar y registrar.
 */
export function advanceJob(job: DownloadJob, dtMs: number, opts: AdvanceOptions): DownloadJob {
  if (dtMs <= 0 || !isJobActive(job.status)) return job;
  const dt = Math.min(dtMs, 2000); // una pestaña que vuelve del segundo plano no teletransporta la descarga

  if (job.status === "queued") {
    return { ...job, status: "downloading", updatedAt: opts.now };
  }

  if (job.status === "downloading") {
    const remaining = job.totalBytes - job.downloadedBytes;
    if (remaining <= 0) return { ...job, status: "verifying", phaseMs: 0, updatedAt: opts.now };

    const bps = effectiveBandwidth(seedOf(job.gameId), job.ticks, opts.limitMbps);
    const chunk = Math.min(Math.round((bps * dt) / 1000), remaining);
    const prev: ProgressSample = {
      bytesDownloaded: job.downloadedBytes,
      bytesTotal: job.totalBytes,
      speedBps: job.speedBps,
      etaSec: job.etaSec,
      percent: job.percent,
      lastTickMs: job.updatedAt,
    };
    const next = advanceProgress(prev, chunk, opts.now);
    const finished = next.bytesDownloaded >= job.totalBytes;
    return {
      ...job,
      downloadedBytes: next.bytesDownloaded,
      speedBps: next.speedBps,
      etaSec: finished ? 0 : next.etaSec,
      percent: next.percent,
      ticks: job.ticks + 1,
      status: finished ? "verifying" : "downloading",
      phaseMs: finished ? 0 : job.phaseMs,
      updatedAt: opts.now,
    };
  }

  if (job.status === "verifying") {
    const phaseMs = job.phaseMs + dt;
    return phaseMs >= VERIFY_MS
      ? { ...job, status: "installing", phaseMs: 0, speedBps: 0, etaSec: 0, updatedAt: opts.now }
      : { ...job, phaseMs, speedBps: 0, etaSec: 0, updatedAt: opts.now };
  }

  // installing
  const phaseMs = job.phaseMs + dt;
  return phaseMs >= INSTALL_MS
    ? { ...job, status: "done", phaseMs: INSTALL_MS, percent: 100, downloadedBytes: job.totalBytes, updatedAt: opts.now }
    : { ...job, phaseMs, updatedAt: opts.now };
}

export function pauseJob(job: DownloadJob, now: number): DownloadJob {
  return canPause(job.status) ? { ...job, status: "paused", speedBps: 0, etaSec: 0, updatedAt: now } : job;
}

export function resumeJob(job: DownloadJob, now: number): DownloadJob {
  return canResume(job.status)
    ? { ...job, status: "downloading", error: null, speedBps: 0, updatedAt: now, ticks: job.ticks + 1 }
    : job;
}

export function failJob(job: DownloadJob, message: string, now: number): DownloadJob {
  return { ...job, status: "error", error: message, speedBps: 0, etaSec: 0, updatedAt: now };
}

/* ── Lecturas para la interfaz ───────────────────────────────────────────── */

/** Progreso 0..100 REAL del trabajo, contando las fases posteriores a la descarga. */
export function overallPercent(job: DownloadJob): number {
  if (job.status === "done") return 100;
  // La descarga vale el 90 % del trabajo; verificar e instalar, un 5 % cada una.
  const download = job.totalBytes > 0 ? Math.min(1, job.downloadedBytes / job.totalBytes) : 0;
  if (job.status === "verifying") return 90 + (job.phaseMs / VERIFY_MS) * 5;
  if (job.status === "installing") return 95 + (job.phaseMs / INSTALL_MS) * 5;
  return download * 90;
}

const PHASE_LABEL: Record<DownloadStatus, string> = {
  queued: "En cola",
  downloading: "Descargando",
  paused: "En pausa",
  verifying: "Verificando archivos",
  installing: "Instalando",
  done: "Completado",
  error: "Error",
  cancelled: "Cancelado",
};

export function phaseLabel(status: DownloadStatus): string {
  return PHASE_LABEL[status];
}

/* ── Disco ───────────────────────────────────────────────────────────────── */

export interface SpaceCheck {
  ok: boolean;
  requiredBytes: number;
  freeBytes: number;
  /** Bytes que faltan (0 si cabe). */
  missingBytes: number;
}

/**
 * ¿Cabe la instalación? Se exige un 12 % de holgura sobre el tamaño anunciado: los archivos
 * temporales de descompresión son reales y un launcher que promete lo justo miente.
 */
export function checkSpace(disk: DiskLocation, bytes: number): SpaceCheck {
  const requiredBytes = Math.round(bytes * 1.12);
  const missingBytes = Math.max(0, requiredBytes - disk.freeBytes);
  return { ok: missingBytes === 0, requiredBytes, freeBytes: disk.freeBytes, missingBytes };
}
