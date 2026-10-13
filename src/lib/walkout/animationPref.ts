/**
 * WALKOUT 0.8 · «ANIMACIONES DE APERTURA» — preferencia del jugador para el walkout de las cartas especiales.
 *
 *   CINEMÁTICA 3D  ("cinematic")  pide el walkout completo (persona 3D, túnel, celebración) aunque el sistema pida
 *                                  movimiento reducido. NUNCA salta una incompatibilidad técnica: sin WebGL, con el
 *                                  contexto perdido o si el 3D no carga, el respaldo 2D sigue mandando (`chooseStage`).
 *   AUTOMÁTICO     ("auto")       por defecto: respeta `prefers-reduced-motion` del sistema y las capacidades del equipo.
 *   REDUCIDAS      ("reduced")    siempre 2D corto; el escenario 3D (y three.js) ni se descargan.
 *
 * Por qué existe: en Windows con «Efectos de animación» desactivado, Chrome responde `prefers-reduced-motion: reduce`
 * (DevTools lo enseña como «No emulation», que es «el valor real del sistema») y el walkout caía SIEMPRE a 2D: el
 * jugador no tenía forma de ver el 3D sin tocar Windows o DevTools.
 *
 * Solo PRESENTACIÓN y solo en este dispositivo (localStorage, como el sonido): ni cuenta, ni servidor, ni economía.
 */
import { useSyncExternalStore } from "react";
import { ns } from "@/i18n/runtime";

const t = ns("walkout");

export type OpeningAnimation = "cinematic" | "auto" | "reduced";
export const OPENING_ANIMATION_KEY = "drl:opening-animation:v1";
export const DEFAULT_OPENING_ANIMATION: OpeningAnimation = "auto";
export const OPENING_ANIMATIONS: readonly { id: OpeningAnimation; label: string; hint: string }[] = [
  { id: "cinematic", label: "Cinemática 3D", hint: "El walkout completo cuando tu navegador puede mostrar 3D" },
  { id: "auto", label: "Automático", hint: "Respeta la accesibilidad de tu sistema y la capacidad del equipo" },
  { id: "reduced", label: "Reducidas", hint: "Presentación 2D corta, sin escena 3D" },
];

export function parseOpeningAnimation(raw: unknown): OpeningAnimation {
  return raw === "cinematic" || raw === "auto" || raw === "reduced" ? raw : DEFAULT_OPENING_ANIMATION;
}

const listeners = new Set<() => void>();
let memory: OpeningAnimation | null = null;   // sin almacenamiento (modo privado estricto): vale para esta sesión

export function getOpeningAnimation(): OpeningAnimation {
  if (typeof window === "undefined") return DEFAULT_OPENING_ANIMATION;
  try { const v = window.localStorage.getItem(OPENING_ANIMATION_KEY); if (v !== null) return parseOpeningAnimation(v); } catch { /* sin almacenamiento */ }
  return memory ?? DEFAULT_OPENING_ANIMATION;
}

export function setOpeningAnimation(v: OpeningAnimation): OpeningAnimation {
  const next = parseOpeningAnimation(v);
  memory = next;
  try { window.localStorage.setItem(OPENING_ANIMATION_KEY, next); } catch { /* solo esta sesión */ }
  for (const fn of listeners) fn();
  return next;
}

export function onOpeningAnimationChange(fn: () => void): () => void {
  listeners.add(fn);
  const storage = (e: StorageEvent) => { if (e.key === OPENING_ANIMATION_KEY) fn(); };
  if (typeof window !== "undefined") window.addEventListener("storage", storage);
  return () => { listeners.delete(fn); if (typeof window !== "undefined") window.removeEventListener("storage", storage); };
}

/** La preferencia viva (se actualiza al cambiarla en ajustes, en el propio walkout o en otra pestaña). */
export function useOpeningAnimation(): OpeningAnimation {
  return useSyncExternalStore(onOpeningAnimationChange, getOpeningAnimation, () => DEFAULT_OPENING_ANIMATION);
}

/** ¿Se presenta el walkout en su versión reducida (2D corto)? La única decisión que la preferencia toma. */
export function walkoutReduced(pref: OpeningAnimation, systemReduced: boolean): boolean {
  if (pref === "cinematic") return false;
  if (pref === "reduced") return true;
  return systemReduced;
}

/** Qué modo está activo, en palabras del jugador (ajustes y reproductor). */
export function describeOpeningMode(pref: OpeningAnimation, systemReduced: boolean): string {
  if (pref === "cinematic") return t("Cinemática 3D");
  if (pref === "reduced") return t("Reducidas (2D)");
  return systemReduced ? t("Automático · 2D (tu sistema pide menos movimiento)") : t("Automático · 3D");
}
