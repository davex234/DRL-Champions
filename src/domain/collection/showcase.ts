/**
 * EL BUCLE DE COLECCIÓN, EN NÚMEROS (Fase 25) — funciones PURAS sobre datos reales.
 *
 *   sobres en el inventario  → grupos «PACK × n» (nunca cuatro tarjetas iguales)
 *   cartas poseídas          → recientes (por `obtainedAt` real), duplicadas, serie baja
 *   cartas de un sobre       → la mejor (rareza → OVR → serial), lo que abre la ceremonia
 *   colección + equipos      → cifras del hero (únicas, copias, %, equipos completos)
 *
 * Nada aquí inventa un objetivo: todo sale del catálogo, de las instancias y de los sobres.
 */
import type { OwnedCard } from "@/domain/cards/types";
import type { PackDef } from "@/domain/packs/types";
import { getVariant } from "@/domain/cards/variants";
import { getCard } from "@/data/catalog";
import { isPubliclyOpenable } from "@/domain/packs/lifecycle";

/* ─────────────── SOBRES ─────────────── */

export interface OwnedPackGroup {
  pack: PackDef;
  count: number;
  /** RETIRED que se posee: se abre pero ya no se compra. */
  retired: boolean;
}

/** Agrupa el inventario de sobres por producto, solo los que existen y se pueden abrir. */
export function ownedPackGroups(unopened: Record<string, number>, resolve: (id: string) => PackDef | undefined): OwnedPackGroup[] {
  const out: OwnedPackGroup[] = [];
  for (const [id, n] of Object.entries(unopened)) {
    if (!n || n <= 0) continue;
    const pack = resolve(id);
    if (!pack || !isPubliclyOpenable(pack)) continue;
    out.push({ pack, count: n, retired: pack.lifecycle === "RETIRED" || pack.retired === true });
  }
  return out.sort((a, b) => b.count - a.count || a.pack.name.localeCompare(b.pack.name));
}

export const totalOwnedPacks = (unopened: Record<string, number>): number =>
  Object.values(unopened).reduce((s, n) => s + (n > 0 ? n : 0), 0);

/* ─────────────── CARTAS ─────────────── */

/** Serie baja: las 10 primeras, o el 1 % de la tirada si es más exigente. Presentación, no economía. */
export function isLowSerial(serial: number | null | undefined, serialLimit: number | null | undefined): boolean {
  if (serial == null || serial <= 0) return false;
  if (serial <= 10) return true;
  if (serialLimit && serialLimit > 0) return serial <= Math.max(1, Math.floor(serialLimit * 0.01));
  return false;
}

export interface ScoredResult { cardId: string; rank: number; ovr: number; serial?: number | null }

/** La mejor carta de un sobre: rareza, luego OVR, luego serial más bajo. Estable y sin azar. */
export function bestOf<T extends ScoredResult>(results: T[]): T | null {
  if (results.length === 0) return null;
  return [...results].sort((a, b) =>
    b.rank - a.rank || b.ovr - a.ovr || (a.serial ?? Infinity) - (b.serial ?? Infinity) || a.cardId.localeCompare(b.cardId),
  )[0];
}

export interface RecentCard { uid: string; cardId: string; serial?: number; obtainedAt: number }

/** Cartas conseguidas dentro de una ventana, más nuevas primero. Solo con `obtainedAt` real. */
export function recentlyAcquired(owned: OwnedCard[], now: number, windowMs = 24 * 3600_000, limit = 12): RecentCard[] {
  return owned
    .filter((o) => typeof o.obtainedAt === "number" && o.obtainedAt > 0 && now - o.obtainedAt <= windowMs && o.obtainedAt <= now + 60_000)
    .sort((a, b) => b.obtainedAt - a.obtainedAt)
    .slice(0, limit)
    .map((o) => ({ uid: o.uid, cardId: o.cardId, serial: o.serial, obtainedAt: o.obtainedAt }));
}

/** Definiciones con más de una copia. */
export function duplicateCardIds(owned: OwnedCard[]): Set<string> {
  const counts = new Map<string, number>();
  for (const o of owned) counts.set(o.cardId, (counts.get(o.cardId) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
}

/** Instancias de una definición, ordenadas por serial (sin serial al final) y luego por fecha. */
export function instancesOf(owned: OwnedCard[], cardId: string): OwnedCard[] {
  return owned
    .filter((o) => o.cardId === cardId)
    .sort((a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity) || a.obtainedAt - b.obtainedAt);
}

/** Rango de rareza de una carta poseída (para «mejor carta» y ordenaciones), 0 si no existe. */
export function rankOf(cardId: string): number {
  const def = getCard(cardId);
  return def ? getVariant(def.variantId).rank : 0;
}

/* ─────────────── HERO ─────────────── */

export interface TeamProgressLike { total: number; ownedDistinct: number }

export interface CollectionHeroMetrics {
  distinct: number;
  total: number;
  percent: number;
  instances: number;
  duplicates: number;
  teamsComplete: number;
  teamsStarted: number;
  teamsTotal: number;
}

export function heroMetrics(
  progress: { distinct: number; total: number; percent: number },
  owned: OwnedCard[],
  teams: TeamProgressLike[],
): CollectionHeroMetrics {
  const dup = duplicateCardIds(owned);
  return {
    distinct: progress.distinct,
    total: progress.total,
    percent: progress.percent,
    instances: owned.length,
    duplicates: [...dup].reduce((s, id) => s + Math.max(0, owned.filter((o) => o.cardId === id).length - 1), 0),
    teamsComplete: teams.filter((t) => t.total > 0 && t.ownedDistinct >= t.total).length,
    teamsStarted: teams.filter((t) => t.ownedDistinct > 0).length,
    teamsTotal: teams.filter((t) => t.total > 0).length,
  };
}
