import type { PlayerSource } from "./types";

/**
 * Fuente VLR.gg — ESTRUCTURA PREPARADA, NO IMPLEMENTADA TODAVÍA.
 *
 * Cuando se implemente, `load()` debería:
 *   1. Obtener jugadores/estadísticas (API propia o scraping de vlr.gg).
 *   2. Mapear cada registro crudo a `RawPlayer` (con `metrics` reales).
 *   3. Normalizarlo con `normalizeRawPlayer` (genera stats y resuelve país/rol).
 *
 * El normalizador ya está listo y compartido en `./normalize`.
 */
export const vlrSource: PlayerSource = {
  id: "vlr",
  label: "VLR.gg (próximamente)",
  load: async () => {
    throw new Error("Importación desde VLR.gg no implementada todavía.");
  },
};

export { normalizeRawPlayer } from "./normalize";
