/**
 * F60 · MAPAS (SOLO SERVIDOR, SOLO LECTURA) — los 12 del Tactical Coach con su PREPARACIÓN real.
 *
 * Un mapa es jugable en el entrenador sólo si tiene TODO: asset y miniatura en `public/maps`, encuadre medido, anclajes
 * de navegación y grafo generado (`NAV_GRAPHS`). Los datos de mapa son hoy REGLA DE JUEGO versionada (pathfinding y
 * proyección sim→mapa se derivan de ellos): el panel los enseña y dice qué falta; no genera navegación.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ok, type AdminResult } from "@/server/admin/http";
import { TACTICAL_MAPS } from "@/domain/tactics/maps";
import { NAV_GRAPHS } from "@/domain/tactics/navigation/maps";
import { NAV_ANCHORS } from "@/domain/tactics/navigation/anchors";
import { mapImageSrc, mapThumbSrc } from "@/lib/assets";

export interface MapReadiness {
  id: string; name: string; width: number; height: number; sites: number; asset: string; thumb: string;
  checks: { key: string; label: string; ok: boolean }[]; ready: boolean; esportsPool: boolean | null; assetBytes: number | null;
}

export async function mapsView(sb: SupabaseClient | null): Promise<AdminResult<{ maps: MapReadiness[]; esportsOnly: string[] }>> {
  const pub = join(process.cwd(), "public");
  const { data } = sb ? await sb.from("maps").select("id, name, active_pool") : { data: null };
  const esports = new Map(((data ?? []) as { id: string; name: string; active_pool: boolean }[]).map((m) => [m.id, m]));
  const maps = TACTICAL_MAPS.map((m) => {
    const assetPath = join(pub, mapImageSrc(m.asset)); const thumbPath = join(pub, mapThumbSrc(m.asset));
    const checks = [
      { key: "asset", label: "Asset del mapa", ok: existsSync(assetPath) },
      { key: "thumb", label: "Miniatura", ok: existsSync(thumbPath) },
      { key: "frame", label: "Encuadre medido", ok: !!m.frame },
      { key: "anchors", label: "Anclajes de navegación", ok: !!NAV_ANCHORS[m.id] },
      { key: "graph", label: "Grafo de navegación (pathfinding)", ok: !!NAV_GRAPHS[m.id] },
    ];
    return {
      id: m.id, name: m.name, width: m.width, height: m.height, sites: (m as { sites?: number }).sites ?? 0,
      asset: mapImageSrc(m.asset), thumb: mapThumbSrc(m.asset), checks, ready: checks.every((c) => c.ok),
      esportsPool: esports.get(m.id)?.active_pool ?? null, assetBytes: existsSync(assetPath) ? statSync(assetPath).size : null,
    };
  });
  const esportsOnly = [...esports.keys()].filter((id) => !TACTICAL_MAPS.some((m) => m.id === id));
  return ok({ maps, esportsOnly });
}
