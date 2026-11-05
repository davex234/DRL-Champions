/**
 * RELEASE/CORE/FSX — utilidades de sistema de ficheros (única implementación compartida).
 * Reemplaza las 3 copias previas de `walk` (release/gen-latest/changes).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Lista recursiva de ficheros (rutas absolutas). Determinista (orden del FS por nivel). */
export function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export const exists = existsSync;
export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const writeJson = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
export const readText = (p) => readFileSync(p, "utf8");
export const writeText = (p, s) => writeFileSync(p, s);
export const readBytes = (p) => readFileSync(p);
export const ensureDir = (p) => (mkdirSync(p, { recursive: true }), p);
export const fileSize = (p) => statSync(p).size;
