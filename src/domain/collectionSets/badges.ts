/**
 * F82 · PRESENTACIÓN DE INSIGNIAS (puro). Una insignia es un cosmético de la familia `insignia` (`user_cosmetics`):
 *   · `insignia:coleccion:*`  de un Collection Set → nombre del set y, si es de equipo, el LOGO REAL del equipo.
 *   · `insignia:equipo:*`, `insignia:region:*`… de la maestría (F13) → nombre y tono derivados del id (`cosmetic()`).
 *   · `insignia:temporada:*` de la ruta de temporada (F83) → «Temporada N · Oro/Plata», con el lenguaje visual propio.
 *   · `insignia:competitiva:*` del Ranked 2.0 (F84) → «Competitiva N · Estrella» (mejor rango de una temporada competitiva
 *     CERRADA). Arquitectura preparada: F84 no otorga ninguna (ninguna temporada competitiva ha terminado).
 *   · `insignia:torneo:<slug>` del campeón de un torneo de jugadores (F86) → «Campeón · <torneo>» con su fecha. Una por
 *     torneo y con UN dueño (índice de 0069). Sin el torneo COMPLETADO a mano no se pinta (nada a ciegas).
 *   · `insignia:regional:<región>` de las colecciones por equipo (0075) → la insignia de Americas, EMEA, Pacific o
 *     China, con el emblema propio de la región. Se concede al completar todos los equipos de la región y es permanente.
 * No inventa logos: sin set conocido, se pinta con el lenguaje visual propio (tono + glifo).
 */
import { cosmetic } from "@/domain/cosmetics/catalog";
import { getVariant } from "@/domain/cards/variants";
import { isCollectionBadge, type CollectionSetDef } from "./types";
import { RANK_V1 } from "@/domain/ranked/config";
import { REGION_BADGE_PREFIX, REGION_TINT, regionOfBadgeId } from "@/domain/teamCollections/model";
import { ns, td, getIntlLocale } from "@/i18n/runtime";

const tr = ns("collectionSets");

export type BadgeKind = "TEAM" | "EDITION" | "MASTERY" | "SEASON" | "COMPETITIVE" | "TOURNAMENT" | "PICKEM" | "REGION";

export interface BadgeFact {
  id: string;
  label: string;
  kind: BadgeKind;
  /** Logo real (solo insignias de equipo). */
  logo: string | null;
  /** Acento de la insignia (texto alternativo: `label`). */
  color: string;
  /** Subtítulo corto: «Equipo», «Edición», «Maestría». */
  caption: string;
  setId: string | null;
}

const EDITION_TINT = "#ffce4f";
const TEAM_TINT = "#19e3ff";

export function badgeFact(
  id: string, setsByBadge: ReadonlyMap<string, Pick<CollectionSetDef, "id" | "kind" | "title" | "logo" | "subjectId">>,
  cups?: ReadonlyMap<string, CupTrophyInfo>,
): BadgeFact | null {
  const set = setsByBadge.get(id);
  if (set) {
    const team = set.kind === "TEAM";
    return {
      id, label: set.title, kind: set.kind, logo: team ? set.logo : null,
      color: team ? TEAM_TINT : EDITION_TINT,
      caption: team ? tr("Equipo completado") : `Edición ${getVariant(set.subjectId as never)?.label ?? ""}`.trim(),
      setId: set.id,
    };
  }
  if (isCollectionBadge(id)) return null; // insignia de colección cuyo set ya no se conoce: no se pinta a ciegas
  if (id.startsWith(SEASON_PREFIX)) return seasonBadgeFact(id);
  if (id.startsWith(COMPETITIVE_PREFIX)) return competitiveBadgeFact(id);
  if (id.startsWith(CUP_PREFIX)) return cupBadgeFact(id, cups);
  if (id.startsWith(PICKEM_PREFIX)) return pickemBadgeFact(id);
  if (id.startsWith(REGION_BADGE_PREFIX)) return regionBadgeFact(id);
  const def = cosmetic(id);
  if (!def || def.family !== "insignia") return null;
  return { id, label: def.label, kind: "MASTERY", logo: null, color: def.color, caption: tr("Maestría"), setId: null };
}

export function badgeIndex<T extends Pick<CollectionSetDef, "reward">>(sets: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const s of sets) if (!m.has(s.reward.badgeId)) m.set(s.reward.badgeId, s);
  return m;
}

/* ───────────── F83 · insignias de temporada ───────────── */

const SEASON_PREFIX = "insignia:temporada:";
const SEASON_TIER: Record<string, { label: string; color: string }> = { oro: { label: "Oro", color: "#ffce4f" }, plata: { label: "Plata", color: "#c9d1e0" }, bronce: { label: "Bronce", color: "#e0975c" } };

/** `insignia:temporada:temporada-2-oro` → «Temporada 2 · Oro». Un id que no encaja no se pinta (nada a ciegas). */
export function seasonBadgeFact(id: string): BadgeFact | null {
  const m = /^insignia:temporada:temporada-(\d{1,3})-(oro|plata|bronce)$/.exec(id);
  if (!m) return null;
  const tier = SEASON_TIER[m[2]];
  return { id, label: tr("Temporada {v} · {label}", { v: td(m[1]), label: td(tier.label) }), kind: "SEASON", logo: null, color: tier.color, caption: tr("Ruta de temporada"), setId: null };
}

/* ───────────── F84 · insignias de temporada competitiva (preparadas; no se otorgan en F84) ───────────── */

const COMPETITIVE_PREFIX = "insignia:competitiva:";

/** Id canónico de la insignia de una temporada competitiva cerrada por su MEJOR rango (tier de `rank-v1`). */
export const competitiveBadgeId = (seasonNumber: number, tierId: string): string => `${COMPETITIVE_PREFIX}competitiva-${seasonNumber}-${tierId}`;

/** `insignia:competitiva:competitiva-1-estrella` → «Competitiva 1 · Estrella». Un id que no encaja no se pinta. */
export function competitiveBadgeFact(id: string): BadgeFact | null {
  const m = /^insignia:competitiva:competitiva-(\d{1,3})-([a-z]{3,12})$/.exec(id);
  if (!m) return null;
  const tier = RANK_V1.tiers.find((t) => t.id === m[2]);
  if (!tier) return null;
  return { id, label: tr("Competitiva {v} · {name}", { v: td(m[1]), name: td(tier.name) }), kind: "COMPETITIVE", logo: null, color: tier.color, caption: tr("Mejor rango de temporada"), setId: null };
}

/* ───────────── F86 · trofeo de campeón de torneo ───────────── */

export const CUP_PREFIX = "insignia:torneo:";
export const cupBadgeId = (slug: string): string => `${CUP_PREFIX}${slug}`;
export const cupSlugOf = (id: string): string | null => (id.startsWith(CUP_PREFIX) && /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(id.slice(CUP_PREFIX.length)) ? id.slice(CUP_PREFIX.length) : null);
/** Lo que el servidor sabe del torneo COMPLETADO (por slug). */
export interface CupTrophyInfo { name: string; completedAt: string | null }
const CUP_GOLD = "#ffce4f";

/** `insignia:torneo:valorosters-open-1` → «Campeón · Valorosters Open #1», «Torneo · 12 oct 2026». Sin el torneo, null. */
export function cupBadgeFact(id: string, cups?: ReadonlyMap<string, CupTrophyInfo>): BadgeFact | null {
  const slug = cupSlugOf(id);
  const info = slug ? cups?.get(slug) : undefined;
  if (!slug || !info) return null;
  const date = info.completedAt ? new Date(info.completedAt).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;
  return { id, label: tr("Campeón · {name}", { name: info.name }), kind: "TOURNAMENT", logo: null, color: CUP_GOLD, caption: date ? tr("Torneo · {date}", { date: td(date) }) : tr("Torneo"), setId: null };
}

/* ───────────── F87 · Pick'em perfecto (recompensa de un Pick'em 2.0 liquidado) ───────────── */

export const PICKEM_PREFIX = "insignia:pickem:";
const PICKEM_TINT = "#19e3ff";

/** `insignia:pickem:champions-2026-playoffs-perfecto` → «Pick'em perfecto · Champions 2026 Playoffs». Un id que no encaja no se pinta. */
export function pickemBadgeFact(id: string): BadgeFact | null {
  const m = /^insignia:pickem:([a-z0-9]+(?:-[a-z0-9]+)*)-perfecto$/.exec(id);
  if (!m) return null;
  const name = m[1].split("-").map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  return { id, label: tr("Pick'em perfecto · {name}", { name }), kind: "PICKEM", logo: null, color: PICKEM_TINT, caption: tr("Pick'em perfecto"), setId: null };
}

/* ───────────── Insignias regionales (colecciones por equipo, 0075) ───────────── */

/** `insignia:regional:emea` → «EMEA», «Insignia regional». Un id que no es una de las cuatro regiones no se pinta. */
export function regionBadgeFact(id: string): BadgeFact | null {
  const region = regionOfBadgeId(id);
  if (!region) return null;
  return { id, label: region, kind: "REGION", logo: null, color: REGION_TINT[region], caption: tr("Insignia regional"), setId: null };
}
