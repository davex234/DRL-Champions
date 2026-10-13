/**
 * NEXUS LAUNCHER — CONFIGURACIÓN.
 *
 * Valores por defecto, saneado y derivadas. La interfaz nunca escribe un ajuste sin pasar por
 * `sanitizeSettings`: un valor persistido de una versión anterior (o manipulado a mano en el
 * almacenamiento local) no puede dejar el launcher en un estado imposible.
 */
import { DEFAULT_INSTALL_PATH } from "./catalog";
import type { LauncherSettings, MotionLevel, ThemeId } from "./types";

export const DEFAULT_SETTINGS: LauncherSettings = {
  autoStart: true,
  minimizeToTray: true,
  language: "es",
  animations: "full",
  hardwareAcceleration: true,
  notifications: true,
  installPath: DEFAULT_INSTALL_PATH,
  speedLimitMbps: 0,
  backgroundDownloads: true,
  concurrentDownloads: 1,
  theme: "midnight",
  effectIntensity: 70,
};

const THEMES: ThemeId[] = ["midnight", "carbon", "abyss"];
const MOTIONS: MotionLevel[] = ["full", "reduced", "off"];

const clamp = (n: number, lo: number, hi: number): number =>
  !Number.isFinite(n) ? lo : Math.max(lo, Math.min(hi, n));

/** Devuelve SIEMPRE una configuración válida, sea cual sea la entrada. */
export function sanitizeSettings(input: Partial<LauncherSettings> | null | undefined): LauncherSettings {
  const s = input ?? {};
  return {
    autoStart: s.autoStart ?? DEFAULT_SETTINGS.autoStart,
    minimizeToTray: s.minimizeToTray ?? DEFAULT_SETTINGS.minimizeToTray,
    language: s.language === "en" ? "en" : "es",
    animations: MOTIONS.includes(s.animations as MotionLevel) ? (s.animations as MotionLevel) : DEFAULT_SETTINGS.animations,
    hardwareAcceleration: s.hardwareAcceleration ?? DEFAULT_SETTINGS.hardwareAcceleration,
    notifications: s.notifications ?? DEFAULT_SETTINGS.notifications,
    installPath: typeof s.installPath === "string" && s.installPath.trim() ? s.installPath : DEFAULT_SETTINGS.installPath,
    speedLimitMbps: Math.round(clamp(s.speedLimitMbps ?? 0, 0, 200)),
    backgroundDownloads: s.backgroundDownloads ?? DEFAULT_SETTINGS.backgroundDownloads,
    concurrentDownloads: Math.round(clamp(s.concurrentDownloads ?? 1, 1, 3)),
    theme: THEMES.includes(s.theme as ThemeId) ? (s.theme as ThemeId) : DEFAULT_SETTINGS.theme,
    effectIntensity: Math.round(clamp(s.effectIntensity ?? 70, 0, 100)),
  };
}

/**
 * Multiplicador de movimiento efectivo (0..1).
 *
 * Combina la preferencia del usuario con la intensidad de efectos. Es lo que consumen el
 * parallax, las partículas y los glows: un solo número, decidido en un solo sitio.
 */
export function motionScale(s: LauncherSettings, prefersReducedMotion = false): number {
  if (prefersReducedMotion || s.animations === "off") return 0;
  const base = s.animations === "reduced" ? 0.45 : 1;
  return base * (s.effectIntensity / 100);
}

/** ¿Se dibujan capas caras (partículas, bloom, barrido)? */
export function heavyEffectsEnabled(s: LauncherSettings, prefersReducedMotion = false): boolean {
  return motionScale(s, prefersReducedMotion) > 0.25 && s.hardwareAcceleration;
}

/** Fondos del lienzo por tema. Se aplican como variables CSS en la raíz del launcher. */
export const THEME_CANVAS: Record<ThemeId, { base: string; tintA: string; tintB: string }> = {
  midnight: { base: "#06070d", tintA: "rgba(255,46,99,0.14)", tintB: "rgba(25,227,255,0.10)" },
  carbon: { base: "#0a0a0c", tintA: "rgba(255,255,255,0.06)", tintB: "rgba(255,176,61,0.08)" },
  abyss: { base: "#03080f", tintA: "rgba(25,227,255,0.16)", tintB: "rgba(139,92,246,0.12)" },
};

export const THEME_LABEL: Record<ThemeId, string> = {
  midnight: "Medianoche",
  carbon: "Carbono",
  abyss: "Abismo",
};

export const MOTION_LABEL: Record<MotionLevel, string> = {
  full: "Completas",
  reduced: "Reducidas",
  off: "Desactivadas",
};
