"use client";

/**
 * F60 · Re-render al llegar el catálogo real de agentes. Cualquier componente que lea el roster o el arte de agentes
 * (listas, retratos, selectores) lo llama: cuando `applyAgentCatalog` cambia algo, vuelve a pintarse. En servidor y en
 * la hidratación devuelve la versión de la instantánea (0), así que no hay desajuste de HTML.
 */
import { useSyncExternalStore } from "react";
import { getRosterVersion, subscribeRoster } from "@/domain/tactics/roster";

export function useRosterVersion(): number {
  return useSyncExternalStore(subscribeRoster, getRosterVersion, () => 0);
}
