/**
 * CATALOG APPLIER (Fase 7) — EL efecto secundario: aplica el catálogo lógico de la build al
 * catálogo VIVO vía `rebuildCatalog` (el choke point existente; no se inventa otra escritura)
 * e invalida los engines del runtime (se recrean solos sobre el catálogo nuevo). Persistencia
 * opcional delegada al llamador (ctx.persist).
 */
import { rebuildCatalog } from "@/data/catalog";
import type { Player } from "@/domain/cards/types";
import { internal } from "./runtime";

export function applyCatalogRuntime(players: Player[], persist?: (players: Player[]) => void): void {
  rebuildCatalog(players);
  internal.invalidateEngines();
  persist?.(players);
}
