"use client";

/**
 * Lectura del Collection Engine. Combina el proveedor LOCAL (eventos/catálogo,
 * offline) con las colecciones de Supabase (torneos reales, RLS pública).
 * Devuelve `CollectionDef` de dominio. Paginable para escalar a cientos.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { CollectionRow, CollectionItemRow } from "@/lib/supabase/collections.types";
import type { Reward } from "@/domain/events/types";
import type { CollectionDef, CollectionItem } from "@/domain/collections/types";
import { localCollections } from "@/domain/collections/local";
import { AWARD_CATEGORIES, type AwardKind, type AwardWinner } from "@/domain/collections/awards";

const AWARD_BY_KIND = new Map(AWARD_CATEGORIES.map((c) => [c.kind, c]));

function toDef(c: CollectionRow, items: CollectionItemRow[]): CollectionDef {
  const defItems: CollectionItem[] = items.map((it) => ({
    cardId: it.card_id,
    category: it.category,
    playerId: it.player_id ?? "",
    label: it.label ?? it.card_id,
  }));

  const awards: AwardWinner[] = [];
  for (const it of items) {
    const cat = AWARD_BY_KIND.get(it.category as AwardKind);
    if (!cat) continue;
    awards.push({
      kind: cat.kind, label: cat.label, accolade: cat.accolade, variantId: cat.variantId,
      playerId: it.player_id ?? "", nick: it.label ?? undefined, cardId: it.card_id, value: it.ovr ?? 0,
    });
  }

  return {
    id: c.id, slug: c.slug, name: c.name, source: "tournament",
    tournamentId: c.tournament_id ?? undefined, tier: c.tier ?? undefined, region: c.region ?? undefined,
    items: defItems, awards, reward: (c.reward ?? {}) as Reward, createdAt: c.created_at,
  };
}

/** Colecciones de Supabase (torneos) con sus miembros. */
export async function supabaseCollections(limit = 200): Promise<CollectionDef[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: collRows } = await sb.from("collections").select("*")
    .order("created_at", { ascending: false }).limit(limit);
  const colls = (collRows as CollectionRow[]) ?? [];
  if (!colls.length) return [];

  const { data: itemRows } = await sb.from("collection_items").select("*")
    .in("collection_id", colls.map((c) => c.id));
  const items = (itemRows as CollectionItemRow[]) ?? [];
  const byColl = new Map<string, CollectionItemRow[]>();
  for (const it of items) {
    const arr = byColl.get(it.collection_id);
    if (arr) arr.push(it); else byColl.set(it.collection_id, [it]);
  }
  return colls.map((c) => toDef(c, byColl.get(c.id) ?? []));
}

/** Local + Supabase, deduplicadas por slug (las reales sobrescriben a las locales). */
export async function mergedCollections(): Promise<CollectionDef[]> {
  const bySlug = new Map<string, CollectionDef>();
  for (const d of localCollections()) bySlug.set(d.slug, d);
  for (const d of await supabaseCollections()) bySlug.set(d.slug, d);
  return [...bySlug.values()];
}

export async function collectionBySlug(slug: string): Promise<CollectionDef | null> {
  return (await mergedCollections()).find((d) => d.slug === slug) ?? null;
}
