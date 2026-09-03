/**
 * LOCK — un único Runtime activo por cola: el segundo termina INMEDIATAMENTE con estado
 * controlado (lock-denied). InMemoryLock para proceso único/verifies y FileLock para CLI
 * (fichero con dueño; liberación solo por el propietario).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeLock } from "./types";

/** Lock en memoria (compartido por módulo: dos runtimes del mismo proceso compiten). */
export class InMemoryLock implements RuntimeLock {
  private static owners = new Map<string, string>();
  acquire(key: string, owner: string): boolean {
    const current = InMemoryLock.owners.get(key);
    if (current && current !== owner) return false;
    InMemoryLock.owners.set(key, owner);
    return true;
  }
  release(key: string, owner: string): void {
    if (InMemoryLock.owners.get(key) === owner) InMemoryLock.owners.delete(key);
  }
  ownerOf(key: string): string | null { return InMemoryLock.owners.get(key) ?? null; }
}

/** Lock por fichero (CLI): el dueño queda registrado; solo él puede liberar. */
export class FileLock implements RuntimeLock {
  constructor(private path: string) {}
  acquire(key: string, owner: string): boolean {
    const file = `${this.path}.${key}.lock`;
    if (existsSync(file)) {
      const current = readFileSync(file, "utf8").trim();
      if (current && current !== owner) return false;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, owner);
    return true;
  }
  release(key: string, owner: string): void {
    const file = `${this.path}.${key}.lock`;
    if (existsSync(file) && readFileSync(file, "utf8").trim() === owner) rmSync(file, { force: true });
  }
  ownerOf(key: string): string | null {
    const file = `${this.path}.${key}.lock`;
    return existsSync(file) ? readFileSync(file, "utf8").trim() || null : null;
  }
}
