/**
 * PITY SYSTEM (Collection Fase 2/7) — parte interna del decisor `openPack`.
 *
 * Garantía por acumulación: tras `threshold` cartas SIN alcanzar `minBucket`, la siguiente se fuerza a
 * `minBucket` y el contador se reinicia. Totalmente configurable por sobre (`PackDef.pity`), con
 * contador independiente (`counterKey`) para compartir pity entre sobres de un mismo evento/temporada.
 * Puro, sin acoplarse al sobre: opera sobre un `PityState` plano/serializable/inmutable. Migrable.
 */
import { BUCKET_INDEX } from "./pool";
import type { PackDef, RarityBucket } from "./types";

/** Versión del estado persistible del pity (migraciones/compat futura). */
export const PACK_SCHEMA_VERSION = 1;

/** Contador de pity por clave (cartas fallidas desde el último premio). Plano/serializable. */
export interface PityState {
  version: number;
  counters: Record<string, number>;
}

export const freshPity = (): PityState => ({ version: PACK_SCHEMA_VERSION, counters: {} });

/** Clave de contador de un sobre (permite pity compartido). */
export function pityKey(pack: PackDef): string | null {
  if (!pack.pity) return null;
  return pack.pity.counterKey ?? `pack:${pack.id}`;
}

/** ¿Debe forzarse `minBucket` ANTES de sortear la siguiente carta? */
export function pityDue(pack: PackDef, pity: PityState): boolean {
  if (!pack.pity) return false;
  const key = pityKey(pack)!;
  return (pity.counters?.[key] ?? 0) >= pack.pity.threshold;
}

/**
 * Actualiza el contador tras conocer el bucket obtenido (inmutable):
 * alcanza `minBucket` ⇒ contador a 0; si no ⇒ +1.
 */
export function updatePity(pack: PackDef, pity: PityState, obtained: RarityBucket): PityState {
  if (!pack.pity) return pity;
  const key = pityKey(pack)!;
  const met = BUCKET_INDEX[obtained] >= BUCKET_INDEX[pack.pity.minBucket];
  const counters = { ...pity.counters };
  counters[key] = met ? 0 : (counters[key] ?? 0) + 1;
  return { ...pity, counters };
}

/** MIGRA un estado de pity antiguo/corrupto al esquema actual (nunca rompe). Determinista. */
export function migratePity(raw: unknown): PityState {
  const base = freshPity();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<PityState>;
  const counters: Record<string, number> = {};
  if (r.counters && typeof r.counters === "object") {
    for (const [k, v] of Object.entries(r.counters)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) counters[k] = Math.floor(v);
  }
  return { version: PACK_SCHEMA_VERSION, counters };
}
