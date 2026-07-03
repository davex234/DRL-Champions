/**
 * DROP EVENTS + BROADCAST (Collection Fase 2/7).
 *
 * Cada apertura produce eventos. Los específicos del drop (pack_opened / legendary_pull / signed_pull
 * / serial_pull / jackpot / pity_triggered / card_obtained / new_card / duplicate) se derivan de las
 * instancias decididas; los de COLECCIÓN (set_completed / series_completed / milestone) se REUTILIZAN
 * del Collection Engine (`reconcile`) sin duplicar lógica. Determinista (reloj lógico `now`).
 */
import { CardRegistry, OwnershipIndex, reconcile, completion } from "@/collection";
import type { CardDef, DropInstance, DropEvent, OpenContext, OwnedCard } from "./types";

/** Grupos de variante considerados "firmados/exclusivos" (signed_pull). Reutiliza VariantGroup. */
const SIGNED_GROUPS = new Set(["exclusiva"]);

/** Produce los eventos de una apertura a partir de las instancias + la propiedad previa. */
export function dropEvents(
  registry: CardRegistry,
  packId: string,
  instances: DropInstance[],
  ctx: OpenContext,
): DropEvent[] {
  const now = ctx.now;
  const events: DropEvent[] = [{ type: "pack_opened", at: now, data: { packId, count: instances.length } }];

  for (const ins of instances) {
    events.push({ type: "card_obtained", at: now, cardId: ins.cardId, data: { serial: ins.serial, bucket: ins.bucket, origin: ins.origin } });
    events.push({ type: ins.isNew ? "new_card" : "duplicate", at: now, cardId: ins.cardId, data: ins.isNew ? undefined : { compensated: ins.compensated } });
    if (ins.bucket === "legendary") events.push({ type: "legendary_pull", at: now, cardId: ins.cardId });
    if (SIGNED_GROUPS.has(registry.variant(ins.variantId).group)) events.push({ type: "signed_pull", at: now, cardId: ins.cardId });
    if (ins.serial != null) events.push({ type: "serial_pull", at: now, cardId: ins.cardId, data: { serial: ins.serial } });
    if (ins.quality === "gem") events.push({ type: "jackpot", at: now, cardId: ins.cardId, data: { serial: ins.serial } });
    if (ins.byPity) events.push({ type: "pity_triggered", at: now, cardId: ins.cardId });
  }

  // Progreso / sets / series / hitos — REUTILIZA el Collection Engine (una sola verdad).
  const next: OwnedCard[] = [
    ...ctx.owned,
    ...instances.map((ins, i) => ({ uid: `drop:${now}:${i}`, cardId: ins.cardId, serial: ins.serial ?? undefined, obtainedAt: now })),
  ];
  const before = completion(registry, new OwnershipIndex(ctx.owned));
  const after = completion(registry, new OwnershipIndex(next));
  if (after !== before) events.push({ type: "collection_progress", at: now, data: { from: before, to: after } });

  for (const e of reconcile(registry, ctx.owned, next, now)) {
    if (e.type === "set_completed" || e.type === "series_completed" || e.type === "milestone") {
      events.push({ type: e.type, at: now, cardId: e.cardId, data: e.data });
    }
  }
  return events;
}

/** Grupos "firmados" expuestos (para UI/preview). */
export function isSignedCard(registry: CardRegistry, card: CardDef): boolean {
  return SIGNED_GROUPS.has(registry.variant(card.variantId).group);
}
