/**
 * SHOWCASE (Collection Fase 7/7) — vitrinas. SOLO LECTURA.
 *
 * REUTILIZA la meta de Collection (favoritos/etiquetas) + filtros/orden ya existentes: las vitrinas se
 * DERIVAN de esos datos (no crean estado nuevo). Determinista (orden estable por cardId).
 */
import type { CollectionEngine, CardView } from "@/collection";
import { bucketForRank } from "@/domain/packs/types";
import type { ShowcaseView, NamedGroup, DisplayCase, DynamicShelf } from "./types";

const byBest = (a: CardView, b: CardView): number => (b.rank - a.rank) || (b.ovr - a.ovr) || (a.cardId < b.cardId ? -1 : 1);

/** Agrupa vistas por una clave y devuelve grupos ordenados de forma estable. */
function groupBy(views: CardView[], keyOf: (v: CardView) => string, labelOf: (v: CardView) => string): NamedGroup[] {
  const map = new Map<string, CardView[]>();
  const labels = new Map<string, string>();
  for (const v of views) { const k = keyOf(v); (map.get(k) ?? map.set(k, []).get(k)!).push(v); if (!labels.has(k)) labels.set(k, labelOf(v)); }
  return [...map.entries()].sort((a, b) => (b[1].length - a[1].length) || (a[0] < b[0] ? -1 : 1))
    .map(([key, cards]) => ({ key, label: labels.get(key)!, cards: [...cards].sort(byBest) }));
}

export function showcaseView(col: CollectionEngine): ShowcaseView {
  const owned = col.ownedViews();
  const favorites = owned.filter((v) => v.favorite).sort(byBest);
  const rare = [...owned].sort(byBest).filter((v) => v.rank >= 8).slice(0, 24);
  const serials = owned.filter((v) => v.serialized && v.bestSerial != null).sort((a, b) => (a.bestSerial! - b.bestSerial!) || (a.cardId < b.cardId ? -1 : 1)).slice(0, 24);

  // Featured: lo más destacable (favoritas primero, luego lo más raro).
  const featured = [...favorites, ...rare.filter((v) => !v.favorite)].slice(0, 12);
  // Pinned: convención de etiqueta "pin" (reutiliza tags de la meta; sin estado nuevo).
  const pinned = owned.filter((v) => v.tags.includes("pin")).sort(byBest);

  // Vitrinas por etiqueta del usuario (cada tag ≠ "pin" es una vitrina).
  const tagCases = new Map<string, CardView[]>();
  for (const v of owned) for (const t of v.tags) if (t !== "pin") (tagCases.get(t) ?? tagCases.set(t, []).get(t)!).push(v);
  const cases: DisplayCase[] = [...tagCases.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, cards]) => ({ id, label: id, cards: [...cards].sort(byBest) }));

  // Estanterías dinámicas (reglas sobre datos existentes).
  const dynamic: DynamicShelf[] = [
    { id: "elite", label: "Élite (OVR 90+)", rule: "ovr>=90", cards: owned.filter((v) => v.ovr >= 90).sort(byBest).slice(0, 24) },
    { id: "gems", label: "Gemas (#1)", rule: "serial==1", cards: owned.filter((v) => v.bestSerial === 1).sort(byBest).slice(0, 24) },
    { id: "legendary", label: "Legendarias", rule: "bucket==legendary", cards: owned.filter((v) => bucketForRank(v.rank) === "legendary").sort(byBest).slice(0, 24) },
  ];

  return {
    featured,
    favorites,
    pinned,
    rare,
    serials,
    byPlayer: groupBy(owned, (v) => v.playerId, (v) => v.nick),
    byRegion: groupBy(owned, (v) => v.region, (v) => v.region),
    themes: groupBy(owned, (v) => v.variantId, (v) => v.label), // por edición
    dynamic,
    cases,
  };
}
