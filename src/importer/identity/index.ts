/**
 * IDENTITY RESOLVER (inyectable) — una IDENTIDAD ÚNICA para jugadores/equipos/coaches/torneos.
 *
 * EXTIENDE el enfoque de `@/intel/identity` (reutiliza su `normalizeKey`) pero SIN el estado global
 * mutable `ALIASES`: el registro de alias se INYECTA como dato. Añade el tipo de entidad `coach` y
 * es 100% puro/determinista. Distintas grafías (TenZ/Tenz/Tyson Ngo) → un id canónico estable.
 */
import { normalizeKey } from "@/intel/identity";

export type ImportEntityKind = "player" | "team" | "coach" | "tournament";

export interface IdentityRef { id?: string; name: string; realName?: string }

/** Registro de alias INYECTADO (dato, no global). clave normalizada → id canónico base. */
export interface IdentityRegistry {
  aliases: Record<string, string>;
}

export interface IdentityResolver {
  /** id canónico base (sin prefijo) — dedup por alias/grafía. */
  resolve: (ref: IdentityRef, kind: ImportEntityKind) => string;
  /** ¿misma entidad? (dos referencias colapsan al mismo id). */
  same: (a: IdentityRef, b: IdentityRef, kind: ImportEntityKind) => boolean;
}

/** Crea un resolutor puro sobre un registro inyectado (por defecto vacío). */
export function createIdentityResolver(registry: IdentityRegistry = { aliases: {} }): IdentityResolver {
  const aliases = registry.aliases;
  const resolve = (ref: IdentityRef): string => {
    for (const c of [ref.realName, ref.name, ref.id]) {
      if (!c) continue;
      const k = normalizeKey(c);
      if (k && aliases[k]) return aliases[k];
    }
    return normalizeKey(ref.name) || normalizeKey(ref.id ?? "") || "unknown";
  };
  return {
    resolve: (ref) => resolve(ref),
    same: (a, b) => resolve(a) === resolve(b),
  };
}

/** Construye un `IdentityRegistry` a partir de datos (canónico → variantes). Puro, sin global. */
export function buildRegistry(entries: { canonical: string; variants: string[] }[]): IdentityRegistry {
  const aliases: Record<string, string> = {};
  for (const e of entries) {
    const canon = normalizeKey(e.canonical) || e.canonical;
    aliases[canon] = canon;
    for (const v of e.variants) {
      const k = normalizeKey(v);
      if (k) aliases[k] = canon;
    }
  }
  return { aliases };
}
