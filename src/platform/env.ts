/**
 * PLATFORM — detección de entorno (desktop Tauri / navegador / node).
 *
 * El juego no cambia: esta capa solo informa DÓNDE corre para usar funciones nativas
 * cuando existan y caer a web/memoria si no. Sin dependencias duras de Tauri (se accede
 * a `window.__TAURI__` que Tauri inyecta con `withGlobalTauri`), así el build web no se rompe.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export const tauri = (): any | null =>
  (typeof window !== "undefined" && (window as any).__TAURI__) || null;

export const isTauri = (): boolean => tauri() != null;
export const isBrowser = (): boolean => typeof window !== "undefined";
export const isOnline = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true;

export type PlatformName = "tauri" | "web" | "node";
export const platformName = (): PlatformName => (isTauri() ? "tauri" : isBrowser() ? "web" : "node");

/** SO (mejor esfuerzo; "unknown" fuera de navegador). */
export function osName(): "windows" | "macos" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}
