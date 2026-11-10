/**
 * NEXUS LAUNCHER — MODELO DE DATOS.
 *
 * Capa PURA (sin React, sin DOM, sin zustand): describe qué es un juego, en qué estado está,
 * qué descarga tiene en curso, quién está conectado y cómo está configurado el cliente.
 *
 * Se separa a propósito del catálogo mock (`catalog.ts`): el día que exista una API real solo
 * cambia el proveedor de datos, no estos tipos ni los motores que los consumen.
 */

// ───────────────────────────── Juego ─────────────────────────────

/** Estado de un título en la biblioteca. Es la ÚNICA fuente de la interfaz del CTA. */
export type GameStateId =
  /** No está en disco. */
  | "not-installed"
  /** Descarga de instalación en curso. */
  | "installing"
  /** En disco (puede tener actualización pendiente). */
  | "installed"
  /** Descarga de actualización en curso. */
  | "updating"
  /** Descarga detenida por el usuario. */
  | "paused"
  /** La última operación falló. */
  | "error"
  /** En disco, al día y verificado: se puede jugar ya. */
  | "ready";

/** Género editorial del título (etiqueta de la ficha). */
export type GameGenre = "Shooter táctico" | "Estrategia" | "Cartas competitivas" | "Arcade" | "Simulación";

/** Requisito de sistema mostrado en la ficha. */
export interface SystemRequirement {
  label: string;
  minimum: string;
  recommended: string;
}

/** Contenido destacado del título (temporada, modo, mapa…). */
export interface GameContentItem {
  id: string;
  kind: "Temporada" | "Modo" | "Mapa" | "Evento";
  title: string;
  summary: string;
}

/**
 * Un título del launcher.
 *
 * `route` es lo que separa un juego REAL (se abre en la aplicación: DRL Champions vive en "/")
 * de un título del escaparate, que no tiene destino y solo simula ciclo de instalación.
 */
export interface Game {
  id: string;
  /** Nombre corto para la barra lateral. */
  name: string;
  /** Titular del hero. */
  title: string;
  /** Subtítulo/claim de una línea. */
  tagline: string;
  description: string;
  genre: GameGenre;
  developer: string;
  /** Versión disponible en el canal actual. */
  version: string;
  /** ISO. Fecha de la última publicación. */
  updatedAt: string;
  /** Tamaño de la instalación completa, en bytes. */
  sizeBytes: number;
  /** Tamaño del parche pendiente, en bytes. Solo si hay actualización. */
  patchBytes?: number;
  /** Paleta cinematográfica del artwork procedural (hex). */
  palette: { key: string; accent: string; deep: string };
  /** Semilla determinista del artwork (misma semilla = mismo escenario). */
  artSeed: number;
  /** Iniciales del icono de la barra lateral. */
  monogram: string;
  tags: string[];
  requirements: SystemRequirement[];
  content: GameContentItem[];
  /** Ruta interna a la que salta JUGAR. `null` = título del escaparate. */
  route: string | null;
  /** Se instala de serie con el cliente (no se puede desinstalar). */
  bundled?: boolean;
}

// ───────────────────────────── Biblioteca ─────────────────────────────

/** Lo que el launcher recuerda de un título entre sesiones. */
export interface LibraryEntry {
  gameId: string;
  state: GameStateId;
  /** Versión instalada en disco (null si no está instalado). */
  installedVersion: string | null;
  /** Ruta de instalación elegida por el usuario. */
  installPath: string | null;
  /** Bytes ya presentes en disco (permite reanudar entre sesiones). */
  bytesOnDisk: number;
  /** ISO de la última partida. */
  lastPlayedAt: string | null;
  /** Minutos jugados acumulados. */
  minutesPlayed: number;
  /** Mensaje del último error, si el estado es "error". */
  error: string | null;
}

/** Acción principal derivada del estado. La calcula `library.ts`, nunca un componente. */
export type GameActionId = "install" | "play" | "update" | "pause" | "resume" | "retry" | "finalizing";

export interface GameAction {
  id: GameActionId;
  label: string;
  /** Peso visual del botón en el hero. */
  tone: "primary" | "gold" | "cyan" | "neutral" | "danger";
  /** Deshabilitado: la acción no está disponible todavía (fase no interrumpible). */
  disabled: boolean;
}

// ───────────────────────────── Descargas ─────────────────────────────

export type DownloadKind = "install" | "update" | "repair";

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "verifying"
  | "installing"
  | "done"
  | "error"
  | "cancelled";

/** Un trabajo del gestor de descargas. Serializable: sobrevive a un recargado de la ventana. */
export interface DownloadJob {
  gameId: string;
  kind: DownloadKind;
  status: DownloadStatus;
  installPath: string;
  /** Bytes totales de ESTE trabajo (instalación completa o parche). */
  totalBytes: number;
  downloadedBytes: number;
  /** Velocidad suavizada (EWMA) en bytes/s. */
  speedBps: number;
  /** Segundos restantes estimados. */
  etaSec: number;
  /** 0..100. */
  percent: number;
  /** Milisegundos acumulados dentro de la fase actual (verificando/instalando). */
  phaseMs: number;
  /** Contador de ticks: alimenta el generador determinista de jitter de red. */
  ticks: number;
  startedAt: number;
  updatedAt: number;
  error: string | null;
}

/** Unidad de disco disponible para instalar. */
export interface DiskLocation {
  id: string;
  label: string;
  path: string;
  totalBytes: number;
  freeBytes: number;
}

// ───────────────────────────── Social ─────────────────────────────

export type PresenceId = "online" | "in-game" | "in-queue" | "away" | "offline";

export interface Friend {
  id: string;
  name: string;
  tag: string;
  presence: PresenceId;
  /** Juego en el que está, si procede. */
  gameId?: string;
  /** Detalle de actividad ("Partida clasificatoria · 8-6"). */
  activity?: string;
  /** Color del avatar generado (hex). */
  color: string;
}

// ───────────────────────────── Novedades ─────────────────────────────

export type NewsCategory = "Actualización" | "Contenido" | "Evento" | "Esports" | "Comunidad";

export interface LauncherNews {
  id: string;
  gameId: string;
  category: NewsCategory;
  title: string;
  excerpt: string;
  /** Cuerpo en párrafos. */
  body: string[];
  /** ISO. */
  date: string;
  artSeed: number;
  accent: string;
}

// ───────────────────────────── Usuario ─────────────────────────────

export interface LauncherUser {
  id: string;
  name: string;
  tag: string;
  presence: PresenceId;
  level: number;
  /** 0..1 dentro del nivel actual. */
  levelProgress: number;
  color: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  text: string;
  gameId?: string;
}

// ───────────────────────────── Configuración ─────────────────────────────

export type ThemeId = "midnight" | "carbon" | "abyss";
export type MotionLevel = "full" | "reduced" | "off";
export type LanguageId = "es" | "en";

export interface LauncherSettings {
  // General
  autoStart: boolean;
  minimizeToTray: boolean;
  language: LanguageId;
  // Launcher
  animations: MotionLevel;
  hardwareAcceleration: boolean;
  notifications: boolean;
  // Descargas
  installPath: string;
  /** Límite en MB/s. 0 = sin límite. */
  speedLimitMbps: number;
  backgroundDownloads: boolean;
  /** Descargas simultáneas permitidas (1..3). */
  concurrentDownloads: number;
  // Interfaz
  theme: ThemeId;
  /** 0..100. Intensidad de partículas/parallax/glow. */
  effectIntensity: number;
}
