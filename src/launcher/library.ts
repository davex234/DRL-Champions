/**
 * NEXUS LAUNCHER — BIBLIOTECA.
 *
 * Traduce (juego + entrada de biblioteca + descarga en curso) a lo ÚNICO que la interfaz
 * necesita saber: en qué estado está y qué botón se enseña. Puro y testeable.
 *
 * La regla que evita el desastre clásico de los launchers: el estado NO lo escribe el
 * componente que pulsa el botón. El componente pide una acción; el estado se deriva aquí.
 */
import type {
  DownloadJob, Game, GameAction, GameStateId, LibraryEntry, DownloadKind,
} from "./types";
import { ns } from "@/i18n/runtime";

const t = ns("launcher");

/** Entrada por defecto de un título que el usuario nunca ha tocado. */
export function initialEntry(game: Game): LibraryEntry {
  const bundled = game.bundled === true;
  return {
    gameId: game.id,
    state: bundled ? "ready" : "not-installed",
    installedVersion: bundled ? game.version : null,
    installPath: null,
    bytesOnDisk: bundled ? game.sizeBytes : 0,
    lastPlayedAt: null,
    minutesPlayed: 0,
    error: null,
  };
}

/** ¿Hay parche pendiente? Un título instalado con versión distinta a la publicada. */
export function hasUpdate(game: Game, entry: LibraryEntry): boolean {
  if (entry.installedVersion == null) return false;
  return entry.installedVersion !== game.version;
}

/**
 * Estado efectivo: el trabajo en curso manda sobre lo guardado en la biblioteca.
 *
 * Acepta una entrada AUSENTE a propósito: un título añadido al catálogo después de que el
 * usuario guardara su biblioteca no tiene fila todavía, y eso no puede reventar la interfaz.
 */
export function effectiveState(entry: LibraryEntry | undefined, job?: DownloadJob | null): GameStateId {
  if (job) {
    if (job.status === "paused") return "paused";
    if (job.status === "error") return "error";
    if (job.status === "downloading" || job.status === "verifying" || job.status === "installing" || job.status === "queued") {
      return job.kind === "update" ? "updating" : "installing";
    }
  }
  return entry?.state ?? "not-installed";
}

const ACTION: Record<GameAction["id"], Omit<GameAction, "id" | "disabled">> = {
  install: { label: "Instalar", tone: "primary" },
  play: { label: "Jugar", tone: "primary" },
  update: { label: "Actualizar", tone: "gold" },
  pause: { label: "Pausar", tone: "neutral" },
  resume: { label: "Reanudar", tone: "cyan" },
  retry: { label: "Reintentar", tone: "danger" },
  finalizing: { label: "Instalando…", tone: "neutral" },
};

/**
 * Acción principal del hero. Es la traducción canónica estado → botón:
 *
 *   sin instalar      → INSTALAR
 *   descargando       → PAUSAR
 *   en pausa          → REANUDAR
 *   verificando/inst. → INSTALANDO… (no interrumpible)
 *   instalado + parche→ ACTUALIZAR
 *   listo             → JUGAR
 *   error             → REINTENTAR
 */
export function primaryAction(game: Game, entry: LibraryEntry, job?: DownloadJob | null): GameAction {
  const state = effectiveState(entry, job);

  if (state === "installing" || state === "updating") {
    if (job && (job.status === "verifying" || job.status === "installing")) {
      return { id: "finalizing", ...ACTION.finalizing, disabled: true };
    }
    return { id: "pause", ...ACTION.pause, disabled: false };
  }
  if (state === "paused") return { id: "resume", ...ACTION.resume, disabled: false };
  if (state === "error") return { id: "retry", ...ACTION.retry, disabled: false };
  if (state === "not-installed") return { id: "install", ...ACTION.install, disabled: false };
  if (hasUpdate(game, entry)) return { id: "update", ...ACTION.update, disabled: false };
  return { id: "play", ...ACTION.play, disabled: false };
}

/** Etiqueta corta del estado para la barra lateral y las insignias. */
export function stateLabel(state: GameStateId, game?: Game, entry?: LibraryEntry): string {
  switch (state) {
    case "not-installed":
      return t("No instalado");
    case "installing":
      return t("Instalando");
    case "updating":
      return t("Actualizando");
    case "paused":
      return t("En pausa");
    case "error":
      return t("Error");
    case "installed":
      return game && entry && hasUpdate(game, entry) ? t("Actualización disponible") : t("Instalado");
    case "ready":
      return t("Listo para jugar");
  }
}

/** Tono semántico del estado (lo consumen insignias y puntos de color). */
export function stateTone(state: GameStateId): "ok" | "warn" | "bad" | "info" | "muted" {
  switch (state) {
    case "ready":
      return "ok";
    case "installed":
      return "ok";
    case "installing":
    case "updating":
      return "info";
    case "paused":
      return "warn";
    case "error":
      return "bad";
    case "not-installed":
      return "muted";
  }
}

/** Qué clase de descarga corresponde lanzar según el estado actual. */
export function downloadKindFor(game: Game, entry: LibraryEntry): DownloadKind {
  return hasUpdate(game, entry) ? "update" : "install";
}

/** Entrada resultante de completar un trabajo. No muta: devuelve la nueva. */
export function applyCompletedJob(game: Game, entry: LibraryEntry, job: DownloadJob): LibraryEntry {
  return {
    ...entry,
    state: "ready",
    installedVersion: game.version,
    installPath: job.installPath,
    bytesOnDisk: game.sizeBytes,
    error: null,
  };
}

/** Entrada resultante de cancelar o desinstalar. */
export function applyRemoved(entry: LibraryEntry): LibraryEntry {
  return { ...entry, state: "not-installed", installedVersion: null, bytesOnDisk: 0, error: null };
}

/** Orden de la barra lateral: primero lo jugable, luego lo que se está moviendo. */
const ORDER: Record<GameStateId, number> = {
  ready: 0,
  installed: 1,
  installing: 2,
  updating: 2,
  paused: 3,
  error: 4,
  "not-installed": 5,
};

export function sortLibrary(
  games: Game[],
  stateOf: (gameId: string) => GameStateId,
): Game[] {
  return [...games].sort((a, b) => {
    const d = ORDER[stateOf(a.id)] - ORDER[stateOf(b.id)];
    return d !== 0 ? d : a.name.localeCompare(b.name, "es");
  });
}
