/**
 * IMPORTAR / EXPORTAR / CLONAR / MIGRAR DECKS (Collection Fase 3/7).
 *
 * Formato portable que guarda SOLO la composición (uids), nunca datos de carta (la fuente sigue siendo
 * la colección). Versionado + migración para compatibilidad futura. Puro y determinista: el id y el
 * reloj (`now`) entran por parámetro (sin `Math.random`/`Date.now`).
 */
import { DECK_SCHEMA_VERSION } from "@/domain/teams/types";
import type { Deck, DeckExport, DeckKind } from "./types";

const KINDS: DeckKind[] = ["competitive", "ranked", "casual", "event", "tournament", "training", "custom"];
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * MIGRA cualquier deck/team antiguo o corrupto al esquema actual (nunca rompe): rellena defaults,
 * sanea arrays y fija la versión. Determinista. Preserva id/nombre/fechas si existen.
 */
export function migrateDeck(raw: unknown): Deck {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Deck>;
  const kind: DeckKind = KINDS.includes(r.kind as DeckKind) ? (r.kind as DeckKind) : "custom";
  return {
    id: typeof r.id === "string" ? r.id : "",
    name: typeof r.name === "string" && r.name.trim() ? r.name : "Deck",
    logo: typeof r.logo === "string" ? r.logo : undefined,
    starters: strArr(r.starters),
    subs: strArr(r.subs),
    reserves: strArr(r.reserves),
    captainUid: typeof r.captainUid === "string" ? r.captainUid : undefined,
    iglUid: typeof r.iglUid === "string" ? r.iglUid : undefined,
    coachUid: typeof r.coachUid === "string" ? r.coachUid : undefined,
    favorite: !!r.favorite,
    tags: strArr(r.tags),
    kind,
    version: DECK_SCHEMA_VERSION,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
    lastUsedAt: typeof r.lastUsedAt === "number" ? r.lastUsedAt : null,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : undefined,
  };
}

/** Clona/copia un deck con nuevo id (composición idéntica; deja de ser favorito). */
export function cloneDeck(deck: Deck, opts: { id: string; name?: string; now: number }): Deck {
  return {
    ...migrateDeck(deck),
    id: opts.id,
    name: opts.name ?? `${deck.name} (copia)`,
    favorite: false,
    createdAt: opts.now,
    lastUsedAt: null,
    updatedAt: opts.now,
  };
}

/** Exporta un deck a su formato portable (sin fechas locales). */
export function exportDeck(deck: Deck): DeckExport {
  const migrated = migrateDeck(deck);
  const { createdAt: _c, lastUsedAt: _l, ...rest } = migrated;
  return { format: "drl-deck", version: DECK_SCHEMA_VERSION, deck: rest };
}

/** Serializa un deck a JSON portable. */
export function serializeDeck(deck: Deck): string {
  return JSON.stringify(exportDeck(deck));
}

/** Importa un deck desde JSON/objeto portable. Devuelve null si el formato no es válido. */
export function importDeck(raw: unknown, opts: { id: string; now: number }): Deck | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") { try { parsed = JSON.parse(raw); } catch { return null; } }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Partial<DeckExport>;
  if (p.format !== "drl-deck" || !p.deck) return null;
  return { ...migrateDeck(p.deck), id: opts.id, createdAt: opts.now, lastUsedAt: null, updatedAt: opts.now };
}
