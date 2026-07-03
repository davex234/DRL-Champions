/**
 * PLATFORM — API pública de la capa de plataforma (desktop Tauri / web).
 *
 * El juego reutiliza TODO sin cambios; esto solo añade integración con el SO cuando se
 * ejecuta como app de escritorio (config/logs/paths/updates/crash), con fallback web.
 */
export { isTauri, isBrowser, isOnline, platformName, osName, tauri } from "./env";
export { getAdapter, setAdapter, MemoryAdapter, type KVAdapter } from "./store";
export { APP_VERSION, BUILD_NUMBER, BUILD_CHANNEL, FULL_VERSION, buildInfo, type BuildInfo } from "./version";
export { DIRS, plannedLayout, ensureDirs, type GameDir, type DirLayout } from "./paths";
export { DEFAULT_CONFIG, loadConfig, saveConfig, type GameConfig, type WindowMode, type RenderBackend } from "./config";
export {
  log, info, warn, error, getLogs, flushLogs, setLogConsole, memoryUsageMB,
  recordStart, recordLoadTime, recordUpdate, recordLive, recordSync, recordMemory,
  type LogLevel, type LogEntry,
} from "./log";
export { checkForUpdate, applyUpdate, type UpdateInfo } from "./update";
export {
  CHANNELS, DEFAULT_CHANNEL, channelInfo, channelHeaders, loadChannel, saveChannel, isChannel,
  type Channel, type ChannelInfo,
} from "./channels";
export {
  UpdateController, getUpdateController, setUpdateController, defaultBackend,
  formatBytes, formatSpeed, formatEta, advanceProgress, newProgress,
  type UpdateState, type UpdatePhase, type UpdaterBackend, type RemoteUpdate,
  type DownloadEvent, type ProgressSample, type StartOptions, type UpdateMeta,
} from "./updater";
export {
  DEFAULT_UPDATE_PREFS, loadUpdatePrefs, saveUpdatePrefs, clampPollMinutes, type UpdatePrefs,
} from "./updatePrefs";
export { loadLastSeenVersion, saveLastSeenVersion } from "./seenVersion";
export { exitApp } from "./app";
export {
  verifyManifest, verifyInstallation, fetchFileManifest, sha256Hex, tauriReader,
  type FileManifest, type FileEntry, type VerifyReport, type FileReader, type Digest,
} from "./verify";
export { reportCrash, installCrashHandler, type CrashReport } from "./crash";

/** Global Esports Platform (Online Fase 7/7) — capa superior desacoplada. Namespace para evitar colisiones. */
export * as cloud from "./cloud";

/** Arranque de la plataforma: logs + dirs + crash handler + carga de config. */
export async function initPlatform(): Promise<{ version: string; platform: string; config: import("./config").GameConfig }> {
  const { recordStart, recordLoadTime } = await import("./log");
  const { ensureDirs } = await import("./paths");
  const { installCrashHandler } = await import("./crash");
  const { loadConfig } = await import("./config");
  const { buildInfo } = await import("./version");
  const t0 = Date.now();
  recordStart();
  installCrashHandler();
  await ensureDirs();
  const config = await loadConfig();
  recordLoadTime(Date.now() - t0);
  const b = buildInfo();
  return { version: b.version, platform: b.platform, config };
}
