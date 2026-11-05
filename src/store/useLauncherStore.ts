"use client";

/**
 * NEXUS LAUNCHER — ESTADO DEL CLIENTE.
 *
 * Único dueño del estado mutable del launcher: qué hay instalado, qué se está descargando,
 * qué juego está seleccionado y cómo está configurado. Todo el CÁLCULO vive en `@/launcher`
 * (puro); aquí solo se guarda, se persiste y se aplica.
 *
 * Se persiste la biblioteca, la configuración y los trabajos en curso: cerrar la ventana con
 * una descarga a medias y encontrarla al volver —en pausa, con sus bytes— es exactamente lo
 * que hace un cliente de escritorio serio. Al rehidratar, cualquier descarga que estuviera
 * viva pasa a PAUSA: el proceso que la movía ya no existe, y fingir lo contrario sería mentir.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_GAME_ID, DEFAULT_SETTINGS, GAMES, getGame,
  advanceJob, applyCompletedJob, applyRemoved, canCancel, canPause, canResume,
  createJob, downloadKindFor, failJob, initialEntry, isJobActive, pauseJob, resumeJob,
  sanitizeSettings,
  type DownloadJob, type DownloadKind, type LauncherSettings, type LibraryEntry,
} from "@/launcher";

/** Pantallas del launcher. No son rutas de Next: el cliente es una sola ventana. */
export type LauncherView = "home" | "game" | "news" | "store" | "settings" | "profile";

interface LauncherState {
  view: LauncherView;
  selectedGameId: string;
  entries: Record<string, LibraryEntry>;
  jobs: Record<string, DownloadJob>;
  settings: LauncherSettings;
  /** Se incrementa en cada cambio de biblioteca: sirve de disparador barato para efectos. */
  revision: number;

  setView: (view: LauncherView) => void;
  select: (gameId: string, view?: LauncherView) => void;

  startDownload: (gameId: string, installPath: string, kind?: DownloadKind) => void;
  pause: (gameId: string) => void;
  resume: (gameId: string) => void;
  cancel: (gameId: string) => void;
  fail: (gameId: string, message: string) => void;
  uninstall: (gameId: string) => void;
  markPlayed: (gameId: string) => void;

  /** Avanza TODOS los trabajos vivos. Lo llama el reloj del launcher, nadie más. */
  tick: (dtMs: number, now: number) => void;

  updateSettings: (patch: Partial<LauncherSettings>) => void;
  resetSettings: () => void;
  resetLibrary: () => void;
}

const seedEntries = (): Record<string, LibraryEntry> =>
  Object.fromEntries(GAMES.map((g) => [g.id, initialEntry(g)]));

/** Entrada garantizada: un juego nuevo en el catálogo no rompe una biblioteca antigua. */
function entryOf(state: Pick<LauncherState, "entries">, gameId: string): LibraryEntry {
  const existing = state.entries[gameId];
  if (existing) return existing;
  const game = getGame(gameId);
  return game ? initialEntry(game) : { gameId, state: "not-installed", installedVersion: null, installPath: null, bytesOnDisk: 0, lastPlayedAt: null, minutesPlayed: 0, error: null };
}

export const useLauncherStore = create<LauncherState>()(
  persist(
    (set, get) => ({
      view: "home",
      selectedGameId: DEFAULT_GAME_ID,
      entries: seedEntries(),
      jobs: {},
      settings: DEFAULT_SETTINGS,
      revision: 0,

      setView: (view) => set({ view }),
      select: (gameId, view) => set((s) => ({ selectedGameId: gameId, view: view ?? s.view })),

      startDownload: (gameId, installPath, kind) => {
        const game = getGame(gameId);
        if (!game) return;
        const s = get();
        if (s.jobs[gameId] && isJobActive(s.jobs[gameId].status)) return; // ya se está bajando
        const entry = entryOf(s, gameId);
        const effectiveKind = kind ?? downloadKindFor(game, entry);
        const resumeFrom = effectiveKind === "install" ? entry.bytesOnDisk : 0;
        const job = createJob(game, effectiveKind, installPath, Date.now(), resumeFrom);
        set({
          jobs: { ...s.jobs, [gameId]: job },
          entries: {
            ...s.entries,
            [gameId]: { ...entry, installPath, error: null, state: effectiveKind === "update" ? "updating" : "installing" },
          },
          revision: s.revision + 1,
        });
      },

      pause: (gameId) => {
        const job = get().jobs[gameId];
        if (!job || !canPause(job.status)) return;
        set((s) => ({ jobs: { ...s.jobs, [gameId]: pauseJob(job, Date.now()) }, revision: s.revision + 1 }));
      },

      resume: (gameId) => {
        const job = get().jobs[gameId];
        if (!job || !canResume(job.status)) return;
        set((s) => ({ jobs: { ...s.jobs, [gameId]: resumeJob(job, Date.now()) }, revision: s.revision + 1 }));
      },

      cancel: (gameId) => {
        const s = get();
        const job = s.jobs[gameId];
        if (!job || !canCancel(job.status)) return;
        const jobs = { ...s.jobs };
        delete jobs[gameId];
        const entry = entryOf(s, gameId);
        // Cancelar una ACTUALIZACIÓN no borra el juego: se queda en disco con su versión vieja.
        const restored: LibraryEntry =
          job.kind === "update"
            ? { ...entry, state: "installed", error: null }
            : applyRemoved(entry);
        set({ jobs, entries: { ...s.entries, [gameId]: restored }, revision: s.revision + 1 });
      },

      fail: (gameId, message) => {
        const job = get().jobs[gameId];
        if (!job) return;
        set((s) => ({
          jobs: { ...s.jobs, [gameId]: failJob(job, message, Date.now()) },
          entries: { ...s.entries, [gameId]: { ...entryOf(s, gameId), state: "error", error: message } },
          revision: s.revision + 1,
        }));
      },

      uninstall: (gameId) => {
        const game = getGame(gameId);
        if (!game || game.bundled) return; // el título del cliente no se desinstala desde aquí
        const s = get();
        const jobs = { ...s.jobs };
        delete jobs[gameId];
        set({
          jobs,
          entries: { ...s.entries, [gameId]: applyRemoved(entryOf(s, gameId)) },
          revision: s.revision + 1,
        });
      },

      markPlayed: (gameId) => {
        const s = get();
        const entry = entryOf(s, gameId);
        set({
          entries: {
            ...s.entries,
            [gameId]: { ...entry, lastPlayedAt: new Date().toISOString(), minutesPlayed: entry.minutesPlayed + 1 },
          },
        });
      },

      tick: (dtMs, now) => {
        const s = get();
        const live = Object.values(s.jobs).filter((j) => isJobActive(j.status));
        if (live.length === 0) return;

        // Cupo de descargas simultáneas: las que no entran esperan en cola, no se pierden.
        const ordered = [...live].sort((a, b) => a.startedAt - b.startedAt);
        const allowed = new Set(ordered.slice(0, s.settings.concurrentDownloads).map((j) => j.gameId));

        const jobs = { ...s.jobs };
        const entries = { ...s.entries };
        let changed = false;

        for (const job of ordered) {
          if (!allowed.has(job.gameId)) {
            if (job.status === "downloading") {
              jobs[job.gameId] = { ...job, status: "queued", speedBps: 0, etaSec: 0, updatedAt: now };
              changed = true;
            }
            continue;
          }
          const next = advanceJob(job, dtMs, { limitMbps: s.settings.speedLimitMbps, now });
          if (next === job) continue;
          changed = true;

          if (next.status === "done") {
            const game = getGame(job.gameId);
            delete jobs[job.gameId];
            if (game) entries[job.gameId] = applyCompletedJob(game, entryOf(s, job.gameId), next);
          } else {
            jobs[job.gameId] = next;
            // Mantener los bytes en disco al día permite reanudar tras cerrar la ventana.
            if (next.kind === "install") {
              const entry = entryOf(s, job.gameId);
              entries[job.gameId] = { ...entry, bytesOnDisk: next.downloadedBytes };
            }
          }
        }
        if (changed) set({ jobs, entries });
      },

      updateSettings: (patch) =>
        set((s) => ({ settings: sanitizeSettings({ ...s.settings, ...patch }) })),

      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),

      resetLibrary: () =>
        set((s) => ({ entries: seedEntries(), jobs: {}, selectedGameId: DEFAULT_GAME_ID, revision: s.revision + 1 })),
    }),
    {
      name: "drl-champions-launcher",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        selectedGameId: s.selectedGameId,
        entries: s.entries,
        jobs: s.jobs,
        settings: s.settings,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LauncherState>;
        const entries = { ...seedEntries(), ...(p.entries ?? {}) };
        // Una descarga viva sin proceso que la mueva no existe: vuelve como pausa.
        const jobs: Record<string, DownloadJob> = {};
        for (const [id, job] of Object.entries(p.jobs ?? {})) {
          if (!job || job.status === "done" || job.status === "cancelled") continue;
          jobs[id] = isJobActive(job.status) ? { ...job, status: "paused", speedBps: 0, etaSec: 0 } : job;
          const entry = entries[id];
          if (entry) entries[id] = { ...entry, state: "paused" };
        }
        return {
          ...current,
          selectedGameId: p.selectedGameId && getGame(p.selectedGameId) ? p.selectedGameId : DEFAULT_GAME_ID,
          entries,
          jobs,
          settings: sanitizeSettings(p.settings),
        };
      },
    },
  ),
);

/* ── Selectores ──────────────────────────────────────────────────────────── */

export const selectEntry = (gameId: string) => (s: LauncherState): LibraryEntry => entryOf(s, gameId);
export const selectJob = (gameId: string) => (s: LauncherState): DownloadJob | null => s.jobs[gameId] ?? null;
export const selectActiveJobs = (s: LauncherState): DownloadJob[] =>
  Object.values(s.jobs).filter((j) => j.status !== "done" && j.status !== "cancelled");
