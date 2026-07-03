/**
 * EVENTOS DE CRAFTING (Collection Fase 4/7).
 *
 * Superset de los eventos de colección: por cada operación se emite su evento de tipo (crafted/upgraded/
 * evolved/fused/salvaged/reforged/promoted) + duplicate_used por cada entrada duplicada + materials_spent/
 * materials_gained + card_obtained/new_card por cada salida acuñada. Puro y determinista.
 */
import type { CardRegistry, OwnershipIndex } from "@/collection";
import { totalMaterials } from "./materials";
import type { CraftEvent, CraftEventType, DropInstance, Materials, OwnedCard, RecipeKind } from "./types";

const KIND_EVENT: Record<RecipeKind, CraftEventType> = {
  craft: "crafted", upgrade: "upgraded", evolution: "evolved", fusion: "fused",
  salvage: "salvaged", reforge: "reforged", promotion: "promoted",
};

export function craftEvents(
  registry: CardRegistry, own: OwnershipIndex, kind: RecipeKind, picked: OwnedCard[], instances: DropInstance[],
  gained: Materials, spent: Partial<Materials>, now: number,
): CraftEvent[] {
  const ev: CraftEvent[] = [{ type: KIND_EVENT[kind], at: now, data: { inputs: picked.length, outputs: instances.length } }];

  for (const o of picked) {
    if (own.countOf(o.cardId) > 1) ev.push({ type: "duplicate_used", at: now, cardId: o.cardId, uid: o.uid });
  }
  if (Object.values(spent).some((n) => (n ?? 0) > 0)) ev.push({ type: "materials_spent", at: now, data: spent });
  if (totalMaterials(gained) > 0) ev.push({ type: "materials_gained", at: now, data: gained });

  for (const ins of instances) {
    ev.push({ type: "card_obtained", at: now, cardId: ins.cardId, data: { serial: ins.serial, origin: ins.origin } });
    if (ins.isNew) ev.push({ type: "new_card", at: now, cardId: ins.cardId });
  }
  return ev;
}
