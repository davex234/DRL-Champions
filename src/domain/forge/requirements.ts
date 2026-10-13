/**
 * F79 · REQUISITOS DE LA FORJA — POSEER (se comprueba, nunca se consume) frente a CONSUMIR (las copias desaparecen). PURO.
 *
 * Los dos se escriben y se pintan distinto a propósito: el jugador tiene que saber SIEMPRE qué cartas van a desaparecer.
 */
import type { CardDef } from "@/domain/cards/types";
import { packCardClass, PACK_CLASS_LABEL } from "@/domain/packs/packClass";
import type { ConsumeSlot, OwnRequirement } from "./types";
import type { InventorySummary } from "./progression";

export interface Labels {
  variant?: (variantId: string) => string;
  card?: (cardId: string) => string;
  team?: (teamKey: string) => string;
  player?: (playerId: string) => string;
}

export interface OwnCheck { kind: "OWN"; req: OwnRequirement; met: boolean; have: number; need: number; label: string }

export function checkOwn(req: OwnRequirement, inv: InventorySummary, labels: Labels = {}): OwnCheck {
  switch (req.type) {
    case "OWN_EDITION": {
      const have = inv.distinctByVariant[req.variantId] ?? 0;
      return { kind: "OWN", req, have, need: req.min, met: have >= req.min, label: `Posee ${req.min} carta${req.min === 1 ? "" : "s"} distinta${req.min === 1 ? "" : "s"} de ${labels.variant?.(req.variantId) ?? req.variantId}` };
    }
    case "OWN_DISTINCT_PLAYERS":
      return { kind: "OWN", req, have: inv.distinctPlayers, need: req.min, met: inv.distinctPlayers >= req.min, label: `Posee cartas de ${req.min} jugadores distintos` };
    case "OWN_CARD": {
      const has = inv.ownedCardIds.has(req.cardId);
      return { kind: "OWN", req, have: has ? 1 : 0, need: 1, met: has, label: `Posee ${labels.card?.(req.cardId) ?? req.cardId}` };
    }
  }
}

/** ¿Esta carta sirve para este hueco de consumo? Clase canónica + filtros (edición, equipo impreso, jugador). */
export function slotMatches(def: Pick<CardDef, "variantId" | "ovr" | "playerId"> & { team?: string }, slot: ConsumeSlot, teamOf: (def: Pick<CardDef, "playerId"> & { team?: string }) => string): boolean {
  if (packCardClass(def) !== slot.class) return false;
  if (slot.variantId && def.variantId !== slot.variantId) return false;
  if (slot.playerId && def.playerId !== slot.playerId) return false;
  if (slot.team && teamOf(def) !== slot.team) return false;
  return true;
}

export function slotLabel(slot: ConsumeSlot, labels: Labels = {}): string {
  const parts = [`${slot.qty} × ${PACK_CLASS_LABEL[slot.class]}`];
  if (slot.variantId) parts.push(labels.variant?.(slot.variantId) ?? slot.variantId);
  if (slot.team) parts.push(labels.team?.(slot.team) ?? slot.team);
  if (slot.playerId) parts.push(labels.player?.(slot.playerId) ?? slot.playerId);
  return parts.join(" · ");
}

export const totalConsumed = (slots: readonly ConsumeSlot[]) => slots.reduce((s, x) => s + x.qty, 0);
