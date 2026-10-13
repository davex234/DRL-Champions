"use client";

/**
 * F60 · Re-render al llegar los sobres del panel (`applyRuntimePacks`). La tienda y el inventario lo usan para
 * resolver de nuevo cuando aparece o se retira un sobre, sin recargar. En servidor/hidratación: 0.
 */
import { useSyncExternalStore } from "react";
import { getPacksVersion, subscribePacks } from "@/data/packs";

export function usePacksVersion(): number {
  return useSyncExternalStore(subscribePacks, getPacksVersion, () => 0);
}
