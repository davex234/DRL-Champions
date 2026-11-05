/**
 * COLLECTION META — favoritos · etiquetas · bloqueos · visibilidad · orígenes (Collection Fase 1/7).
 *
 * La ÚNICA información NUEVA de la colección (todo lo demás se reutiliza). Plano/serializable, operado
 * de forma INMUTABLE (cada función devuelve una meta nueva) y con migración de versión para
 * compatibilidad futura. Sin efectos, sin reloj de pared.
 */
import { COLLECTION_SCHEMA_VERSION, emptyMeta, type CollectionMeta, type CardOrigin } from "./types";

const addTo = (arr: string[], v: string): string[] => (arr.includes(v) ? arr : [...arr, v]);
const removeFrom = (arr: string[], v: string): string[] => arr.filter((x) => x !== v);
const toggle = (arr: string[], v: string): string[] => (arr.includes(v) ? removeFrom(arr, v) : [...arr, v]);

export function toggleFavorite(meta: CollectionMeta, cardId: string): CollectionMeta { return { ...meta, favorites: toggle(meta.favorites, cardId) }; }
export function isFavorite(meta: CollectionMeta, cardId: string): boolean { return meta.favorites.includes(cardId); }

export function setHidden(meta: CollectionMeta, cardId: string, hidden: boolean): CollectionMeta {
  return { ...meta, hidden: hidden ? addTo(meta.hidden, cardId) : removeFrom(meta.hidden, cardId) };
}
export function isHidden(meta: CollectionMeta, cardId: string): boolean { return meta.hidden.includes(cardId); }

export function setLocked(meta: CollectionMeta, uid: string, locked: boolean): CollectionMeta {
  return { ...meta, locks: locked ? addTo(meta.locks, uid) : removeFrom(meta.locks, uid) };
}
export function isLocked(meta: CollectionMeta, uid: string): boolean { return meta.locks.includes(uid); }

export function addTag(meta: CollectionMeta, cardId: string, tag: string): CollectionMeta {
  const cur = meta.tags[cardId] ?? [];
  if (cur.includes(tag)) return meta;
  return { ...meta, tags: { ...meta.tags, [cardId]: [...cur, tag] } };
}
export function removeTag(meta: CollectionMeta, cardId: string, tag: string): CollectionMeta {
  const cur = meta.tags[cardId] ?? [];
  if (!cur.includes(tag)) return meta;
  const next = cur.filter((t) => t !== tag);
  const tags = { ...meta.tags };
  if (next.length) tags[cardId] = next; else delete tags[cardId];
  return { ...meta, tags };
}
export function tagsOf(meta: CollectionMeta, cardId: string): string[] { return meta.tags[cardId] ?? []; }

export function setOrigin(meta: CollectionMeta, uid: string, origin: CardOrigin): CollectionMeta {
  return { ...meta, origins: { ...meta.origins, [uid]: origin } };
}
export function originOf(meta: CollectionMeta, uid: string): CardOrigin { return meta.origins[uid] ?? "unknown"; }

/** Serializa la meta (persistencia). */
export function serializeMeta(meta: CollectionMeta): string { return JSON.stringify(meta); }

/**
 * Deserializa + MIGRA a la versión actual (compatibilidad futura). Una meta corrupta/antigua nunca
 * rompe: se rellena con defaults. Determinista.
 */
export function migrateMeta(raw: unknown): CollectionMeta {
  const base = emptyMeta();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<CollectionMeta>;
  return {
    version: COLLECTION_SCHEMA_VERSION,
    favorites: Array.isArray(r.favorites) ? r.favorites.filter((x) => typeof x === "string") : [],
    tags: r.tags && typeof r.tags === "object" ? sanitizeTags(r.tags) : {},
    locks: Array.isArray(r.locks) ? r.locks.filter((x) => typeof x === "string") : [],
    hidden: Array.isArray(r.hidden) ? r.hidden.filter((x) => typeof x === "string") : [],
    origins: r.origins && typeof r.origins === "object" ? (r.origins as Record<string, CardOrigin>) : {},
  };
}
export function deserializeMeta(json: string): CollectionMeta {
  try { return migrateMeta(JSON.parse(json)); } catch { return emptyMeta(); }
}

function sanitizeTags(tags: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(tags)) if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
  return out;
}
