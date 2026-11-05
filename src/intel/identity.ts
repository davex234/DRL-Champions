/**
 * LIVE INTEL — RESOLUCIÓN DE IDENTIDAD.
 *
 * Distintas fuentes escriben el mismo jugador de formas distintas (TenZ / Tenz / TENZ /
 * "Tyson Ngo"). Este módulo da una IDENTIDAD ÚNICA y estable: normaliza el nombre y lo
 * resuelve contra un REGISTRO DE ALIAS (datos, no lógica) → un id canónico. Es la base
 * de "multi-fuente sin duplicados". Extensible: añadir un alias = un dato, sin tocar el
 * motor. No hardcodea jugadores en la lógica: solo consume el registro.
 */

/** Clave normalizada: minúsculas, sin diacríticos, solo alfanumérico. */
export const normalizeKey = (s: string): string =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Registro de alias (DATO, mutable/extensible). key normalizada → id canónico. */
const ALIASES: Record<string, string> = {};

/** Tipo de entidad resuelta. */
export type EntityKind = "player" | "team" | "tournament";

/**
 * Carga aliases (semilla o ampliaciones en runtime). Cada entrada: nombres/variantes
 * que se resuelven al mismo id canónico. Idempotente.
 */
export function registerAliases(canonicalId: string, variants: string[]): void {
  const canon = normalizeKey(canonicalId) || canonicalId;
  ALIASES[canon] = canon;
  for (const v of variants) {
    const k = normalizeKey(v);
    if (k) ALIASES[k] = canon;
  }
}

/** Semilla de ejemplo (DATOS — ampliable libremente / desde admin/fuente). */
registerAliases("tenz", ["TenZ", "Tenz", "TENZ", "Tyson Ngo"]);
registerAliases("derke", ["Derke", "Nikita Sirmitev"]);
registerAliases("boaster", ["Boaster", "Jake Howlett"]);

/**
 * Resuelve una entidad a su id CANÓNICO. Prioriza: alias conocido > id de fuente
 * (si parece estable) > clave normalizada del nombre. Nunca devuelve vacío.
 */
export function resolveIdentity(input: { id?: string; name: string; realName?: string }): string {
  const candidates = [input.realName, input.name, input.id].filter(Boolean) as string[];
  for (const c of candidates) {
    const k = normalizeKey(c);
    if (k && ALIASES[k]) return ALIASES[k];
  }
  // Sin alias: id canónico estable = clave normalizada del nombre (no del id de fuente,
  // que difiere entre fuentes). Así dos grafías → un id aunque no haya alias explícito.
  return normalizeKey(input.name) || normalizeKey(input.id ?? "") || "unknown";
}

/** ¿Dos referencias son el MISMO jugador/equipo? (para detección de duplicados). */
export function sameEntity(a: { id?: string; name: string; realName?: string }, b: { id?: string; name: string; realName?: string }): boolean {
  return resolveIdentity(a) === resolveIdentity(b);
}

/** Vista del registro (para el admin/debug). */
export function aliasRegistry(): Record<string, string> {
  return { ...ALIASES };
}
