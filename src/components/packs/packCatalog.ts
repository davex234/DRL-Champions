/**
 * CATÁLOGO DE SOBRES — el modelo de presentación, DERIVADO del backend (Fase 21.1).
 *
 * ────────────────────────── QUÉ ES, Y QUÉ NO DUPLICA ──────────────────────────
 *
 * Es la capa que la pantalla `/packs` consume. **No define productos, precios, lifecycle ni
 * probabilidades**: lo lee todo de la fuente de verdad existente —`PACKS` (catálogo), la
 * autoridad de ciclo de vida (`isStoreVisible`, Fase 20.4) y `packIdentity` (categoría/artwork)—.
 * Si un pack no es público (DRAFT/RETIRED), no aparece: la misma regla que aplica el servidor en
 * `buyPack`. Aquí solo se AGRUPA y se ETIQUETA para enseñarlo; ninguna regla nueva.
 */
import type { PackDef } from "@/domain/packs/types";
import { PACKS } from "@/data/packs";
import { isStoreVisible } from "@/domain/packs/lifecycle";
import { packIdentity, type PackCategory } from "./packIdentity";
import { guidanceFor } from "@/domain/packs/guidance";
import { teamPackIdentity } from "@/data/teamIdentities";
import { plural } from "@/lib/format";
import { ns } from "@/i18n/runtime";

const tr = ns("packs");

/** Las pestañas del catálogo, de cara al jugador. Derivan de `packIdentity.category`. */
export type CatalogTab = "rareza" | "regiones" | "equipos" | "eventos";

export const CATALOG_TAB_LABEL: Record<CatalogTab | "todos", string> = {
  todos: "Todos",
  rareza: "Rareza",
  regiones: "Regiones",
  equipos: "Equipos",
  eventos: "Eventos",
};

/** Orden de las pestañas cuando tienen contenido. */
export const CATALOG_TAB_ORDER: CatalogTab[] = ["rareza", "regiones", "equipos", "eventos"];

/** Mapea la categoría técnica de `packIdentity` a la pestaña de cara al jugador. */
export function tabForCategory(category: PackCategory): CatalogTab {
  switch (category) {
    case "regional": return "regiones";
    case "team": return "equipos";
    case "event": return "eventos";
    // inicial / nexus / icono → la familia de rareza/casa.
    default: return "rareza";
  }
}

/** La pestaña de un sobre. */
export function tabForPack(pack: Pick<PackDef, "id" | "team" | "eventId" | "guaranteedMin" | "price" | "restrictRegion">): CatalogTab {
  return tabForCategory(packIdentity(pack).category);
}

/**
 * La acción que ofrece la card:
 *   · `event`  → sobre de evento; no se compra en el catálogo, se va al Centro de Eventos.
 *   · `free`   → sobre gratuito (precio 0): se abre sin cobrar.
 *   · `buy`    → compra normal por el flujo existente.
 * No decide disponibilidad (eso ya lo hizo `isStoreVisible`): solo qué CTA pintar.
 */
export type PackCtaKind = "event" | "free" | "buy";

export function ctaKindFor(pack: Pick<PackDef, "eventId" | "price">): PackCtaKind {
  if (pack.eventId) return "event";
  if (pack.price <= 0) return "free";
  return "buy";
}

/** Todos los sobres PÚBLICOS (ACTIVE), en el orden del catálogo. DRAFT/RETIRED quedan fuera. */
export function publicPacks(): PackDef[] {
  return PACKS.filter((p) => isStoreVisible(p));
}

/** ¿Es este sobre visible en el catálogo público? (autoridad de ciclo de vida compartida). */
export function isCatalogVisible(pack: Pick<PackDef, "lifecycle" | "retired">): boolean {
  return isStoreVisible(pack);
}

export interface CatalogGroup {
  tab: CatalogTab;
  label: string;
  packs: PackDef[];
}

/**
 * Los sobres públicos agrupados por pestaña, en el orden de `CATALOG_TAB_ORDER`, omitiendo las
 * pestañas vacías. `tab` opcional filtra a una sola (además de «todos»).
 */
export function catalogGroups(tab?: CatalogTab | "todos"): CatalogGroup[] {
  const visible = publicPacks();
  return CATALOG_TAB_ORDER
    .filter((t) => tab == null || tab === "todos" || tab === t)
    .map((t) => ({ tab: t, label: CATALOG_TAB_LABEL[t], packs: visible.filter((p) => tabForPack(p) === t) }))
    .filter((g) => g.packs.length > 0);
}

/** Las pestañas que hoy tienen contenido (para no pintar filtros vacíos). */
export function availableTabs(): (CatalogTab | "todos")[] {
  const withContent = new Set(publicPacks().map((p) => tabForPack(p)));
  return ["todos", ...CATALOG_TAB_ORDER.filter((t) => withContent.has(t))];
}

/**
 * DESTACADOS: el primer sobre de cada familia visible. No hay una lista editorial escrita a
 * mano: si mañana un sobre pasa a RETIRED, desaparece solo. El motivo sale de `guidanceFor`
 * (cifras medidas) o de la propia identidad del sobre (equipo → probabilidad aumentada).
 */
export function featuredPacks(visible: PackDef[]): { pack: PackDef; why: string }[] {
  const out: { pack: PackDef; why: string }[] = [];
  const seen = new Set<string>();
  // Los sobres de equipo van primero: son el producto que mejor cuenta el bucle (equipo → colección).
  const PRIORITY: PackCategory[] = ["team", "nexus", "regional", "event", "inicial", "icono"];
  const ordered = [...visible].sort((a, b) => PRIORITY.indexOf(packIdentity(a).category) - PRIORITY.indexOf(packIdentity(b).category));
  for (const p of ordered) {
    const id = packIdentity(p);
    if (seen.has(id.category)) continue;
    seen.add(id.category);
    const g = guidanceFor(p.id);
    const why = p.team
      ? tr("Probabilidad aumentada de {v}", { v: teamPackIdentity(p.team)?.displayName ?? p.team })
      : g?.headline ?? (p.price <= 0 ? tr("Gratis") : plural(p.cardCount, "carta", "cartas"));
    out.push({ pack: p, why });
    if (out.length >= 3) break;
  }
  return out;
}

