/**
 * COLLECTION ROOM — CONSULTA DE LA COLECCIÓN Y SU ESTADO EN LA URL (Fase 37). PURO.
 *
 * Búsqueda, filtros y orden viven en la URL (`/coleccion?q=…&rareza=…`) para que atrás/adelante y los enlaces
 * conserven la exploración. Todo lo que llega de la URL se trata como texto hostil: lista blanca de claves y
 * valores, longitudes acotadas, nada de expresiones regulares con entrada del usuario. La URL NUNCA autoriza nada:
 * solo decide qué se enseña de lo que ya se tiene.
 *
 * Filtra y ordena con el motor de colección existente (`applyFilter` + `sortViewsBy`): no hay un segundo sistema.
 */
import type { CardView, FilterSpec, SortSpec } from "@/collection/types";
import { applyFilter, normalizeText, SEARCH_MAX_LENGTH } from "@/collection/filter";
import { sortViewsBy } from "@/collection/sort";
import type { RarityBucket } from "@/domain/packs/types";
import type { Region, RoleId, VariantId } from "@/domain/cards/types";
import { BUCKET_ORDER, EDITION_ORDER, REGION_ORDER, ROLE_ORDER } from "./room";

export type OwnershipFilter = "all" | "owned" | "missing";
/** F71.3 · sin «Jugador» ni «Equipo»: un `?orden=` antiguo con esos valores cae al orden por defecto (lista blanca). */
export type CollectionSort = "ovr-desc" | "ovr-asc" | "rarity" | "copies";

export const SORTS: readonly CollectionSort[] = ["ovr-desc", "ovr-asc", "rarity", "copies"];
export const SORT_LABEL: Record<CollectionSort, string> = {
  "ovr-desc": "OVR (mayor primero)", "ovr-asc": "OVR (menor primero)", rarity: "Rareza", copies: "Copias",
};
export const OWNERSHIP_LABEL: Record<OwnershipFilter, string> = { all: "Todas", owned: "Poseídas", missing: "No conseguidas" };

export interface CollectionQuery {
  q: string;
  own: OwnershipFilter;
  rarity: RarityBucket[];
  role: RoleId[];
  region: Region[];
  /** Claves de set de equipo (`teamKeyOf`). */
  team: string[];
  edition: VariantId[];
  dup: boolean;
  fav: boolean;
  minOvr: number | null;
  maxOvr: number | null;
  sort: CollectionSort;
}

export const DEFAULT_QUERY: CollectionQuery = Object.freeze({
  q: "", own: "all", rarity: [], role: [], region: [], team: [], edition: [], dup: false, fav: false, minOvr: null, maxOvr: null, sort: "ovr-desc",
}) as CollectionQuery;

export const QUERY_LIMITS = Object.freeze({ q: 48, values: 12, teamKey: 64, rawParam: 512 });

const TEAM_KEY = /^(?:[a-z0-9-]{1,48}|raw:[\p{L}\p{N} .&'!-]{1,48})$/u;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
const getParam = (p: Params, k: string): string | null => {
  const v = p instanceof URLSearchParams ? p.get(k) : p[k];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.length <= QUERY_LIMITS.rawParam ? s : null;
};
const list = <T extends string>(raw: string | null, allowed: readonly T[]): T[] => {
  if (!raw) return [];
  const out: T[] = [];
  for (const part of raw.split(",").slice(0, QUERY_LIMITS.values)) {
    const v = part.trim() as T;
    if (allowed.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
};
const ovr = (raw: string | null): number | null => {
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= 99 ? n : null;
};

export function parseCollectionQuery(params: Params): CollectionQuery {
  const q = normalizeText(getParam(params, "q")).slice(0, QUERY_LIMITS.q);
  const own = getParam(params, "tener");
  const sort = getParam(params, "orden");
  const teams = (getParam(params, "equipo") ?? "").split(",").slice(0, QUERY_LIMITS.values).map((t) => t.trim()).filter((t) => t.length <= QUERY_LIMITS.teamKey && TEAM_KEY.test(t));
  let minOvr = ovr(getParam(params, "min"));
  let maxOvr = ovr(getParam(params, "max"));
  if (minOvr !== null && maxOvr !== null && minOvr > maxOvr) [minOvr, maxOvr] = [maxOvr, minOvr];
  return {
    q,
    own: own === "owned" || own === "missing" ? own : "all",
    rarity: list(getParam(params, "rareza"), BUCKET_ORDER),
    role: list(getParam(params, "rol"), ROLE_ORDER),
    region: list(getParam(params, "region"), REGION_ORDER),
    team: [...new Set(teams)],
    edition: list(getParam(params, "edicion"), EDITION_ORDER),
    dup: getParam(params, "dup") === "1",
    fav: getParam(params, "fav") === "1",
    minOvr, maxOvr,
    sort: SORTS.includes(sort as CollectionSort) ? (sort as CollectionSort) : "ovr-desc",
  };
}

/** Solo lo que difiere del estado por defecto, en orden estable. Vacío = `""`. */
export function serializeCollectionQuery(q: CollectionQuery): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q.slice(0, QUERY_LIMITS.q));
  if (q.own !== "all") p.set("tener", q.own);
  if (q.rarity.length) p.set("rareza", q.rarity.join(","));
  if (q.role.length) p.set("rol", q.role.join(","));
  if (q.region.length) p.set("region", q.region.join(","));
  if (q.team.length) p.set("equipo", q.team.join(","));
  if (q.edition.length) p.set("edicion", q.edition.join(","));
  if (q.dup) p.set("dup", "1");
  if (q.fav) p.set("fav", "1");
  if (q.minOvr !== null) p.set("min", String(q.minOvr));
  if (q.maxOvr !== null) p.set("max", String(q.maxOvr));
  if (q.sort !== "ovr-desc") p.set("orden", q.sort);
  return p.toString();
}

export const SORT_SPECS: Record<CollectionSort, readonly SortSpec[]> = {
  "ovr-desc": [{ key: "ovr", dir: "desc" }, { key: "rank", dir: "desc" }, { key: "name", dir: "asc" }],
  "ovr-asc": [{ key: "ovr", dir: "asc" }, { key: "rank", dir: "asc" }, { key: "name", dir: "asc" }],
  rarity: [{ key: "rank", dir: "desc" }, { key: "ovr", dir: "desc" }, { key: "name", dir: "asc" }],
  copies: [{ key: "count", dir: "desc" }, { key: "ovr", dir: "desc" }, { key: "name", dir: "asc" }],
};

/** Traduce la consulta al `FilterSpec` del motor. `aliasesOf` expande una clave de equipo a sus nombres del catálogo. */
export function toFilterSpec(q: CollectionQuery, aliasesOf: (teamKey: string) => string[]): FilterSpec {
  return {
    text: q.q || undefined,
    owned: q.own === "owned" ? true : q.own === "missing" ? false : undefined,
    rarities: q.rarity.length ? q.rarity : undefined,
    roles: q.role.length ? q.role : undefined,
    regions: q.region.length ? q.region : undefined,
    variants: q.edition.length ? q.edition : undefined,
    teams: q.team.length ? q.team.flatMap(aliasesOf) : undefined,
    minCount: q.dup ? 2 : undefined,
    favorite: q.fav || undefined,
    minOvr: q.minOvr ?? undefined,
    maxOvr: q.maxOvr ?? undefined,
  };
}

export function runCollectionQuery(views: CardView[], q: CollectionQuery, aliasesOf: (teamKey: string) => string[]): CardView[] {
  return sortViewsBy(applyFilter(views, toFilterSpec(q, aliasesOf)), SORT_SPECS[q.sort]);
}

/** Filtros activos (la búsqueda y el orden no cuentan como filtro). */
export function activeFilterCount(q: CollectionQuery): number {
  return (q.own !== "all" ? 1 : 0) + q.rarity.length + q.role.length + q.region.length + q.team.length + q.edition.length
    + (q.dup ? 1 : 0) + (q.fav ? 1 : 0) + (q.minOvr !== null ? 1 : 0) + (q.maxOvr !== null ? 1 : 0);
}

export const withQuery = (q: CollectionQuery, patch: Partial<CollectionQuery>): CollectionQuery => ({ ...q, ...patch });

/** Alterna un valor de una lista de la consulta. */
export function toggleIn<K extends "rarity" | "role" | "region" | "team" | "edition">(q: CollectionQuery, key: K, value: CollectionQuery[K][number]): CollectionQuery {
  const cur = q[key] as string[];
  const next = cur.includes(value as string) ? cur.filter((v) => v !== value) : [...cur, value as string].slice(0, QUERY_LIMITS.values);
  return { ...q, [key]: next } as CollectionQuery;
}

export { SEARCH_MAX_LENGTH };
