/**
 * FASE 43 · CATÁLOGO DE LA CAPA ESTRATÉGICA — adapta el catálogo canónico (`@/data/catalog`) al tipo mínimo que lee
 * `@/domain/deckStrategy` y memoiza su perfil y su calibración. Solo definiciones públicas: ningún inventario.
 */
import { CARDS, getPlayer } from "@/data/catalog";
import { strategyContextFor, type CatalogCard, type StrategyContext } from "@/domain/deckStrategy/catalog";

let cached: { len: number; cards: CatalogCard[] } | null = null;

export function catalogCards(): CatalogCard[] {
  if (cached && cached.len === CARDS.length) return cached.cards;
  const cards: CatalogCard[] = [];
  for (const c of CARDS) {
    const p = getPlayer(c.playerId);
    if (!p || !c.combat || !c.dataVersion) continue;
    cards.push({ cardId: c.id, playerId: c.playerId, role: c.role ?? p.role, ovr: c.ovr, combat: c.combat, dataVersion: c.dataVersion });
  }
  cached = { len: CARDS.length, cards };
  return cards;
}

export const strategyContext = (): StrategyContext => strategyContextFor(catalogCards());

/* ───────────── ejemplares sintéticos (tests, simulaciones y arnés QA; nunca rutas reales) ───────────── */

import type { BuilderCard } from "@/domain/deckBuilder/builder";
import { makeRng } from "@/sim/rng";

const defIndex = () => new Map(CARDS.map((c) => [c.id, c]));

/** Un ejemplar sintético de una definición REAL del catálogo. uid, serial y fecha inventados. */
export function builderCardOf(cardId: string, n: number, serial: number | null = null): BuilderCard {
  const d = defIndex().get(cardId);
  if (!d || !d.combat) throw new Error(`definición desconocida: ${cardId}`);
  const p = getPlayer(d.playerId)!;
  return {
    uid: `00000000-0000-4000-8043-${String(n).padStart(12, "0")}`, cardId: d.id, playerId: d.playerId, nick: p.nick, team: p.team, country: p.country,
    role: d.role ?? p.role, region: p.region, variantId: d.variantId, ovr: d.ovr, combat: d.combat, serial, dataVersion: d.dataVersion ?? "VCT-2026",
    statBoost: d.statBoost ?? 0, obtainedAt: Date.UTC(2026, 8, 1) + n * 60_000,
  };
}

/** Colección sintética de `size` ejemplares sobre definiciones reales (con copias repetidas), determinista. */
export function syntheticCollection(size: number, seed: number, distinct = Math.min(size, CARDS.length)): BuilderCard[] {
  const rng = makeRng(seed);
  const ids = CARDS.filter((c) => c.combat).map((c) => c.id);
  const chosen: string[] = [];
  const pool = [...ids];
  for (let i = 0; i < distinct && pool.length; i++) chosen.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  const out: BuilderCard[] = [];
  for (let i = 0; i < size; i++) out.push(builderCardOf(i < chosen.length ? chosen[i] : chosen[Math.floor(rng.next() * chosen.length)], seed * 100_000 + i, rng.next() < 0.3 ? 1 + Math.floor(rng.next() * 500) : null));
  return out;
}
