/**
 * COLLECTION ENGINE — orquestador (Collection Fase 1/7).
 *
 * Compone Card Registry + Ownership + Meta y PROYECTA la vista unificada de colección (`CardView`),
 * exponiendo la API única: inventario, álbum, binder, sets/series/temporadas, progreso, estadística,
 * filtros/búsqueda/orden/agrupación, favoritos/etiquetas/bloqueos, comparación, historial y broadcast.
 *
 *   Card (Registry) → Collection → Inventory → Card(View) → Deck(elegibles) → Gameplay
 *
 * NO duplica cartas/inventario/catálogo/identidad: los reutiliza. Determinista (reloj lógico inyectado).
 */
import { CardRegistry } from "./registry";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { OwnershipIndex, type OwnershipValidation } from "./ownership";
import { qualityOf } from "./quality";
import * as M from "./meta";
import { applyFilter, search } from "./filter";
import { sortViews, groupViews } from "./sort";
import { album, binder, missing, completion, setProgress, allSetProgress } from "./album";
import { compareCards } from "./compare";
import { statistics, analytics, progress } from "./stats";
import { history, cardHistory, byOrigin } from "./history";
import { broadcast } from "./events";
import { emptyMeta } from "./types";
import type {
  CardDef, OwnedCard, CollectionMeta, CardView, CardInstanceView, FilterSpec, SortSpec, GroupKey,
} from "./types";

export class CollectionEngine {
  readonly registry: CardRegistry;
  private own: OwnershipIndex;
  private meta: CollectionMeta;
  private viewCache: CardView[] | null = null;

  constructor(owned: OwnedCard[] = [], meta: CollectionMeta = emptyMeta(), registry: CardRegistry = new CardRegistry()) {
    this.registry = registry;
    this.own = new OwnershipIndex(owned);
    this.meta = meta;
  }

  /** Reemplaza la instantánea de propiedad (p. ej. tras abrir un sobre) e invalida la caché. */
  setOwned(owned: OwnedCard[]): void { this.own = new OwnershipIndex(owned); this.viewCache = null; }
  getMeta(): CollectionMeta { return this.meta; }
  ownership(): OwnershipIndex { return this.own; }

  // ── Proyección (CardView) ──
  private build(def: CardDef): CardView {
    const v = this.registry.variant(def.variantId);
    const p = this.registry.player(def.playerId);
    return {
      cardId: def.id, playerId: def.playerId, variantId: def.variantId,
      // Equipo de la CARTA (el impreso, canónico): «Fnatic» agrupa FNATIC; Derke con VIT impreso es Team Vitality.
      nick: p?.nick ?? def.playerId, team: (def.team || p) ? canonicalCardTeam(def, p).label : "", teamTag: def.team ?? p?.teamTag ?? "",
      region: p?.region ?? "EMEA", role: def.role ?? p?.role ?? "Flex", country: p?.country ?? "", // rol de la CARTA si lo imprime (catálogo diseñado); si no, el del jugador
      label: v.label, group: v.group, rank: v.rank, ovr: def.ovr, stats: def.stats,
      serialized: v.serialized, serialLimit: v.serialLimit ?? null,
      owned: this.own.owns(def.id), count: this.own.countOf(def.id), bestSerial: this.own.bestSerial(def.id),
      favorite: M.isFavorite(this.meta, def.id), hidden: M.isHidden(this.meta, def.id), tags: M.tagsOf(this.meta, def.id),
    };
  }
  /** Todas las cartas del catálogo proyectadas (cacheado hasta que cambie la propiedad). */
  views(): CardView[] { return (this.viewCache ??= this.registry.cards.map((c) => this.build(c))); }
  view(cardId: string): CardView | null { const d = this.registry.card(cardId); return d ? this.build(d) : null; }
  ownedViews(): CardView[] { return this.views().filter((v) => v.owned); }

  /** Instancias concretas de una carta (Card Instance + calidad + origen + bloqueo). */
  instances(cardId: string): CardInstanceView[] {
    const def = this.registry.card(cardId); if (!def) return [];
    const v = this.registry.variant(def.variantId);
    return this.own.instancesOf(cardId).map((o) => ({
      uid: o.uid, cardId: o.cardId, serial: o.serial ?? null, obtainedAt: o.obtainedAt,
      origin: M.originOf(this.meta, o.uid), locked: M.isLocked(this.meta, o.uid), quality: qualityOf(v, o.serial),
    }));
  }

  // ── Filtro / búsqueda / orden / agrupación ──
  filter(f: FilterSpec): CardView[] { return applyFilter(this.views(), f); }
  search(query: string, includeHidden = false): CardView[] { return search(this.views(), query, includeHidden); }
  sort(views: CardView[], spec: SortSpec): CardView[] { return sortViews(views, spec); }
  group(views: CardView[], key: GroupKey): Map<string, CardView[]> { return groupViews(views, key); }

  // ── Álbum / binder / sets / progreso ──
  album() { return album(this.registry, this.own); }
  binder(pageSize = 12) { return binder(this.ownedViews(), pageSize); }
  missing() { return missing(this.registry, this.own); }
  completion() { return completion(this.registry, this.own); }
  setProgress(setId: string) { return setProgress(this.registry, this.own, setId); }
  sets() { return allSetProgress(this.registry, this.own); }
  progress() { return progress(this.registry, this.own); }
  statistics() { return statistics(this.registry, this.own); }
  analytics() { return analytics(this.registry, this.own); }
  broadcast(recent: string[] = []) { return broadcast(this.registry, this.own, recent); }

  // ── Historial / comparación / validación ──
  history() { return history(this.own, this.meta); }
  cardHistory(cardId: string) { return cardHistory(this.own, this.meta, cardId); }
  byOrigin() { return byOrigin(this.own, this.meta); }
  compare(aId: string, bId: string) { return compareCards(this.registry, aId, bId); }
  validate(): OwnershipValidation { return this.own.validate(this.registry); }

  // ── Meta (favoritos/etiquetas/bloqueos/ocultas/orígenes) — inmutable, invalida caché de vistas ──
  toggleFavorite(cardId: string): void { this.meta = M.toggleFavorite(this.meta, cardId); this.viewCache = null; }
  setHidden(cardId: string, hidden: boolean): void { this.meta = M.setHidden(this.meta, cardId, hidden); this.viewCache = null; }
  addTag(cardId: string, tag: string): void { this.meta = M.addTag(this.meta, cardId, tag); this.viewCache = null; }
  removeTag(cardId: string, tag: string): void { this.meta = M.removeTag(this.meta, cardId, tag); this.viewCache = null; }
  setLocked(uid: string, locked: boolean): void { this.meta = M.setLocked(this.meta, uid, locked); }
  isLocked(uid: string): boolean { return M.isLocked(this.meta, uid); }
  setOrigin(uid: string, origin: import("./types").CardOrigin): void { this.meta = M.setOrigin(this.meta, uid, origin); }

  // ── Puente al Deck / Gameplay: cartas poseídas elegibles (mejor OVR primero) ──
  deckEligible(): CardView[] { return sortViews(this.ownedViews(), { key: "ovr", dir: "desc" }); }
}
