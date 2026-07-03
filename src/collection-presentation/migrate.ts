/**
 * MIGRACIÓN DE CONFIG DE PRESENTACIÓN (Collection Fase 7/7).
 *
 * La presentación es DERIVADA: no crea estado de colección. Lo único opcionalmente persistible es la
 * config de vitrinas (orden/pinned), que se sanea aquí para compat futura. Determinista.
 */
import { CP_SCHEMA_VERSION, freshShowcaseConfig, type ShowcaseConfig } from "./types";

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function migrateShowcaseConfig(raw: unknown): ShowcaseConfig {
  if (!raw || typeof raw !== "object") return freshShowcaseConfig();
  const r = raw as Partial<ShowcaseConfig>;
  return { version: CP_SCHEMA_VERSION, caseOrder: strArr(r.caseOrder), pinned: strArr(r.pinned) };
}
