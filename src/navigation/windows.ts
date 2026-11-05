/**
 * WINDOW ENGINE — z-order y clasificación de ventanas (Render/UI Fase 2/7).
 *
 * REUTILIZA los tokens de apilamiento `Z` de `@/ui-core` (no inventa capas). El z resuelto = capa base
 * del tipo + orden de apertura, para un orden determinista y estable. Puro.
 */
import { Z } from "@/ui-core";
import type { WindowKind } from "./types";

/** Capa base por tipo de ventana (tokens de ui-core). */
export const Z_BUCKET: Record<WindowKind, number> = {
  screen: Z.base,
  inspector: Z.sticky,
  popup: Z.dropdown,
  contextmenu: Z.dropdown,
  overlay: Z.overlay,
  drawer: Z.drawer,
  modal: Z.modal,
  dialog: Z.modal,
  loading: Z.modal,
  error: Z.modal,
  notification: Z.toast,
  tooltip: Z.tooltip,
};

/** z resuelto de una ventana: capa base + desplazamiento por orden de apertura (acotado a la capa). */
export function resolveZ(kind: WindowKind, openOrder: number): number {
  return Z_BUCKET[kind] + Math.min(99, openOrder);
}

/** ¿El tipo es una superficie "por encima" (bloquea foco de la principal)? */
export const isOverlayKind = (kind: WindowKind): boolean =>
  kind !== "screen" && kind !== "tooltip" && kind !== "notification" && kind !== "inspector";
