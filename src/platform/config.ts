/**
 * PLATFORM — configuración persistente del cliente (resolución, audio, render, rutas…).
 *
 * Persistida vía el adaptador KV (Tauri fs / localStorage / memoria). Merge seguro con
 * defaults (saves antiguos no rompen). NO toca la lógica del juego: solo preferencias.
 */
import { getAdapter } from "./store";

export type WindowMode = "windowed" | "borderless" | "fullscreen";
export type RenderBackend = "svg" | "canvas" | "auto";

export interface GameConfig {
  resolution: { w: number; h: number };
  windowMode: WindowMode;
  language: "es" | "en";
  volume: number;        // 0..1
  fps: number;           // tope objetivo
  uiScale: number;       // 0.75..1.5
  renderBackend: RenderBackend;
  dataPath: string;
  replaysPath: string;
  screenshotsPath: string;
  theme: "dark" | "light";
  debug: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  resolution: { w: 1600, h: 900 },
  windowMode: "windowed",
  language: "es",
  volume: 0.8,
  fps: 60,
  uiScale: 1,
  renderBackend: "svg",
  dataPath: "DRL Champions/data",
  replaysPath: "DRL Champions/replays",
  screenshotsPath: "DRL Champions/screenshots",
  theme: "dark",
  debug: false,
};

const KEY = "config";

export async function loadConfig(): Promise<GameConfig> {
  try {
    const raw = await getAdapter().get(KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<GameConfig>) };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export async function saveConfig(patch: Partial<GameConfig>): Promise<GameConfig> {
  const next = { ...(await loadConfig()), ...patch };
  await getAdapter().set(KEY, JSON.stringify(next));
  return next;
}
