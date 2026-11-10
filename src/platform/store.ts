/**
 * PLATFORM — almacenamiento KV con ADAPTADOR (única abstracción de persistencia).
 *
 * Tauri (fs en el dir de config) → localStorage (web) → memoria (node/tests). El resto
 * de la plataforma (config, logs) solo conoce esta interfaz: nada hardcodea la ruta.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { tauri, isBrowser } from "./env";

export interface KVAdapter {
  name: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

class MemoryAdapter implements KVAdapter {
  name = "memory";
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
}

class LocalStorageAdapter implements KVAdapter {
  name = "localStorage";
  async get(k: string) { return localStorage.getItem(`drl:${k}`); }
  async set(k: string, v: string) { localStorage.setItem(`drl:${k}`, v); }
}

/** Tauri FS: persiste cada clave como `<AppConfig>/<key>.json`. Best-effort. */
class TauriFsAdapter implements KVAdapter {
  name = "tauri-fs";
  private fs = tauri()?.fs;
  private base = tauri()?.fs?.BaseDirectory?.AppConfig ?? 22; // BaseDirectory.AppConfig
  async get(k: string) {
    try { return await this.fs.readTextFile(`${k}.json`, { baseDir: this.base }); } catch { return null; }
  }
  async set(k: string, v: string) {
    try { await this.fs.mkdir("", { baseDir: this.base, recursive: true }); } catch { /* ya existe */ }
    await this.fs.writeTextFile(`${k}.json`, v, { baseDir: this.base });
  }
}

function autoAdapter(): KVAdapter {
  if (tauri()?.fs) return new TauriFsAdapter();
  if (isBrowser() && typeof localStorage !== "undefined") return new LocalStorageAdapter();
  return new MemoryAdapter();
}

let _adapter: KVAdapter | null = null;
export const getAdapter = (): KVAdapter => (_adapter ??= autoAdapter());
/** Inyección (tests/forzado). */
export const setAdapter = (a: KVAdapter): void => { _adapter = a; };
export { MemoryAdapter };
