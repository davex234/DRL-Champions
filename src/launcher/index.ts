/**
 * NEXUS LAUNCHER — API pública de la capa de dominio.
 *
 * Todo lo que hay aquí debajo es PURO: sin React, sin DOM, sin zustand. La interfaz consume
 * este módulo; nunca al revés.
 */
export * from "./types";
export { GAMES, DISKS, DEFAULT_GAME_ID, DEFAULT_INSTALL_PATH, getGames, getGame } from "./catalog";
export {
  BASE_BANDWIDTH_BPS, VERIFY_MS, INSTALL_MS,
  seedOf, noise, effectiveBandwidth, jobBytesFor, createJob,
  isJobActive, canPause, canResume, canCancel,
  advanceJob, pauseJob, resumeJob, failJob,
  overallPercent, phaseLabel, checkSpace,
  type AdvanceOptions, type SpaceCheck,
} from "./download";
export {
  initialEntry, hasUpdate, effectiveState, primaryAction, stateLabel, stateTone,
  downloadKindFor, applyCompletedJob, applyRemoved, sortLibrary,
} from "./library";
export {
  FRIENDS, USER, ACTIVITY, PRESENCE_LABEL, PRESENCE_TONE,
  getFriends, sortFriends, isConnected, countConnected,
} from "./social";
export { NEWS, CATEGORY_ACCENT, getNews, newsForGame, formatDate } from "./feed";
export {
  DEFAULT_SETTINGS, THEME_CANVAS, THEME_LABEL, MOTION_LABEL,
  sanitizeSettings, motionScale, heavyEffectsEnabled,
} from "./settings";
export { LauncherClock, launcherClock, type TickFn } from "./runner";
