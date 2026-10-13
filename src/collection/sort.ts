/**
 * CARD SORTING + GROUPING (Collection Fase 1/7).
 *
 * Orden estable y agrupación de `CardView[]`. Puro, determinista (desempate por cardId para orden
 * total estable). Sin estado.
 */
import type { CardView, SortSpec, SortKey, GroupKey } from "./types";

function value(v: CardView, key: SortKey): number | string {
  switch (key) {
    case "ovr": return v.ovr;
    case "rank": return v.rank;
    case "count": return v.count;
    case "serial": return v.bestSerial ?? Infinity;
    case "obtained": return v.owned ? 1 : 0;   // aproximación: poseídas primero (obtención real vive en la instancia)
    case "name": return v.nick.toLowerCase();
    case "team": return v.team.toLowerCase();
    case "region": return v.region;
  }
}

/**
 * Fase 37 · orden COMPUESTO: se aplican las claves en orden hasta que una desempata; al final, cardId. Así
 * «OVR ↓ → rareza ↓ → jugador» es un solo orden total y determinista.
 */
export function sortViewsBy(views: CardView[], specs: readonly SortSpec[]): CardView[] {
  return [...views].sort((a, b) => {
    for (const spec of specs) {
      const va = value(a, spec.key), vb = value(b, spec.key);
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") cmp = va === vb ? 0 : va < vb ? -1 : 1;
      else cmp = String(va).localeCompare(String(vb), "es");
      if (cmp !== 0) return spec.dir === "asc" ? cmp : -cmp;
    }
    return a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0;
  });
}

/** Ordena de forma ESTABLE (desempate por cardId ⇒ orden total determinista). */
export function sortViews(views: CardView[], spec: SortSpec): CardView[] {
  const mul = spec.dir === "asc" ? 1 : -1;
  return [...views].sort((a, b) => {
    const va = value(a, spec.key), vb = value(b, spec.key);
    let cmp = 0;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
    return cmp !== 0 ? cmp * mul : (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);
  });
}

function groupValue(v: CardView, key: GroupKey): string {
  switch (key) {
    case "region": return v.region;
    case "role": return v.role;
    case "group": return v.group;
    case "variant": return v.variantId;
    case "rarity": return String(v.rank);
    case "team": return v.team;
    case "owned": return v.owned ? "owned" : "missing";
  }
}

/** Agrupa las vistas por una clave. Devuelve un mapa insertion-ordered determinista. */
export function groupViews(views: CardView[], key: GroupKey): Map<string, CardView[]> {
  const out = new Map<string, CardView[]>();
  for (const v of views) {
    const k = groupValue(v, key);
    const arr = out.get(k);
    if (arr) arr.push(v); else out.set(k, [v]);
  }
  return out;
}
