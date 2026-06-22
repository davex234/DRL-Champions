import type { Player } from "@/domain/cards/types";

/**
 * Capa de FUENTES DE DATOS de jugadores. Preparada para soportar múltiples
 * orígenes (datos semilla locales, importación desde VLR.gg, una API propia…)
 * sin tocar el resto del juego.
 *
 * El catálogo (`src/data/catalog.ts`) consume `Player[]`; cualquier fuente solo
 * tiene que entregar datos en ese formato (o un `RawPlayer` que se normaliza).
 */

/** Forma "cruda" que podría venir de una fuente externa antes de normalizar. */
export interface RawPlayer {
  id?: string;
  nick: string;
  fullName?: string;
  team: string;
  teamTag?: string;
  region: string;
  role?: string;
  country: string; // ISO-2 o nombre; el normalizador lo resuelve
  /** Estadísticas del juego ya calculadas (opcional si se dan `metrics`). */
  stats?: Partial<Player["stats"]>;
  /** Métricas reales (ACS, K/D, HS%…) para generar las stats. */
  metrics?: import("@/domain/cards/statsFromMetrics").RawMetrics;
  accolades?: string[];
  image?: string;
  status?: "active" | "inactive";
}

/** Una fuente de jugadores. */
export interface PlayerSource {
  id: string;
  label: string;
  /** Carga los jugadores ya normalizados al modelo del juego. */
  load: () => Promise<Player[]>;
}
