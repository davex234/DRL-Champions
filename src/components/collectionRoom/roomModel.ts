/**
 * COLLECTION ROOM · MODELO DE LA SALA (Fase 37). Lo que la pantalla necesita, sin hooks ni red: el hook real
 * (`useCollectionRoom`) y el arnés QA (`/design-system/fase37`) construyen lo mismo con estas piezas.
 */
import { getPlayer } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import { CollectionEngine, emptyMeta } from "@/collection";
import { cardTeamKeyOf, type CollectionSnapshot, type OwnedInstanceFact } from "@/domain/collection/room";
import type { TeamOption } from "./CollectionFilters";

export type CollectionAccess = "server" | "local" | "anon";

export interface CollectionRoomModel {
  access: CollectionAccess;
  loading: boolean;
  offline: boolean;
  stale: boolean;
  snap: CollectionSnapshot;
  engine: CollectionEngine;
  teamOptions: TeamOption[];
  aliasesOf: (key: string) => string[];
}

/** Motor de vistas del álbum. `obtainedAt: 0`: campo obligatorio del motor que la sala nunca enseña ni ordena. */
export function roomEngine(instances: readonly OwnedInstanceFact[], favorites: readonly string[], counts: Readonly<Record<string, number>> | null = null): CollectionEngine {
  return new CollectionEngine(
    instances.map((i) => ({ uid: i.uid, cardId: i.cardId, serial: i.serial ?? undefined, obtainedAt: 0, mintedVersion: i.mintedVersion })),
    { ...emptyMeta(), favorites: [...favorites] },
    undefined,
    counts,
  );
}

export type TeamIndex = Map<string, { label: string; aliases: Set<string>; total: number }>;

/** Equipos por identidad canónica del equipo de la CARTA (el impreso); el alias es la etiqueta de la vista. */
export function teamIndexOf(cards: readonly CardDef[]): TeamIndex {
  const map: TeamIndex = new Map();
  for (const c of cards) {
    const p = getPlayer(c.playerId);
    if (!p) continue;
    const t = cardTeamKeyOf(c, p);
    const row = map.get(t.key) ?? { label: t.label, aliases: new Set<string>(), total: 0 };
    // `CardView.team` es la etiqueta canónica (ver `collection/engine`): es lo que compara el filtro.
    row.aliases.add(t.label); row.total++;
    map.set(t.key, row);
  }
  return map;
}

export function teamOptionsOf(index: TeamIndex): TeamOption[] {
  return [...index.entries()].map(([key, v]) => ({ key, label: v.label, total: v.total })).sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export const aliasesFrom = (index: TeamIndex) => (key: string): string[] => [...(index.get(key)?.aliases ?? [])];
