/**
 * PLATFORM — estructura de directorios del juego (profesional, configurable).
 *
 *   DRL Champions/  data cache logs config assets replays screenshots mods temp userdata
 *
 * En Tauri se crean bajo AppData; en web/node se devuelve el PLAN (sin crear). Nada
 * hardcodeado: las rutas de datos/replays/capturas también son configurables (config.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { tauri } from "./env";

export const DIRS = ["data", "cache", "logs", "config", "assets", "replays", "screenshots", "mods", "temp", "userdata"] as const;
export type GameDir = (typeof DIRS)[number];

export interface DirLayout {
  root: string;
  dirs: Record<GameDir, string>;
}

export function plannedLayout(root = "DRL Champions"): DirLayout {
  const dirs = {} as Record<GameDir, string>;
  for (const d of DIRS) dirs[d] = `${root}/${d}`;
  return { root, dirs };
}

/** Crea (Tauri) o planifica (web/node) la estructura. Devuelve qué se hizo. */
export async function ensureDirs(): Promise<{ created: GameDir[]; adapter: string; layout: DirLayout }> {
  const layout = plannedLayout();
  const t = tauri();
  if (!t?.fs?.mkdir) return { created: [], adapter: "plan-only", layout };
  const base = t.fs.BaseDirectory?.AppData;
  const created: GameDir[] = [];
  for (const d of DIRS) {
    try { await t.fs.mkdir(d, { baseDir: base, recursive: true }); created.push(d); } catch { /* ya existe */ }
  }
  return { created, adapter: "tauri-fs", layout };
}
