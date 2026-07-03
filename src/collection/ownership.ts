/**
 * OWNERSHIP ENGINE + CARD INSTANCE (Collection Fase 1/7).
 *
 * Índice de propiedad sobre `OwnedCard[]` (la ÚNICA fuente de propiedad, del `useGameStore`) — NO crea
 * otro inventario. Reutiliza `groupCollection` de `@/store/selectors`. Añade validación de instancias
 * (uids únicos, cardId válido, serie dentro de límite) y consultas O(1). Puro y determinista.
 */
import { groupCollection, type CollectionEntry } from "@/store/selectors";
import type { CardRegistry } from "./registry";
import type { OwnedCard } from "./types";

export interface OwnershipIssue { uid: string; cardId: string; reason: string }
export interface OwnershipValidation { ok: boolean; issues: OwnershipIssue[] }

/** Índice inmutable de la propiedad del jugador (agrupado por carta). */
export class OwnershipIndex {
  private grouped: Map<string, CollectionEntry>;
  private byUid = new Map<string, OwnedCard>();

  constructor(private owned: OwnedCard[]) {
    this.grouped = groupCollection(owned);           // REUTILIZA el selector existente (no duplica)
    for (const o of owned) this.byUid.set(o.uid, o);
  }

  owns(cardId: string): boolean { return this.grouped.has(cardId); }
  countOf(cardId: string): number { return this.grouped.get(cardId)?.count ?? 0; }
  instancesOf(cardId: string): OwnedCard[] { return this.grouped.get(cardId)?.instances ?? []; }
  instance(uid: string): OwnedCard | undefined { return this.byUid.get(uid); }
  /** Menor nº de serie poseído de una carta (la instancia más valiosa). */
  bestSerial(cardId: string): number | null {
    const insts = this.instancesOf(cardId);
    const serials = insts.map((i) => i.serial).filter((s): s is number => s != null);
    return serials.length ? Math.min(...serials) : null;
  }
  distinctOwned(): string[] { return [...this.grouped.keys()]; }
  distinctCount(): number { return this.grouped.size; }
  totalInstances(): number { return this.owned.length; }
  entries(): CollectionEntry[] { return [...this.grouped.values()]; }
  all(): OwnedCard[] { return this.owned; }

  /**
   * Valida la consistencia de las instancias frente al registro (SEGURIDAD):
   * uids únicos · cardId existe · serie dentro de [1, serialLimit] y solo si la variante es serializada.
   */
  validate(registry: CardRegistry): OwnershipValidation {
    const issues: OwnershipIssue[] = [];
    const seen = new Set<string>();
    for (const o of this.owned) {
      if (seen.has(o.uid)) issues.push({ uid: o.uid, cardId: o.cardId, reason: "uid duplicado" });
      seen.add(o.uid);
      const def = registry.card(o.cardId);
      if (!def) { issues.push({ uid: o.uid, cardId: o.cardId, reason: "cardId inexistente" }); continue; }
      const v = registry.variant(def.variantId);
      if (o.serial != null) {
        if (!v.serialized) issues.push({ uid: o.uid, cardId: o.cardId, reason: "serie en variante no serializada" });
        else if (o.serial < 1 || (v.serialLimit != null && o.serial > v.serialLimit)) issues.push({ uid: o.uid, cardId: o.cardId, reason: "serie fuera de límite" });
      }
    }
    return { ok: issues.length === 0, issues };
  }
}
