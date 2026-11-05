/**
 * MANIFEST — índice completo del repositorio + detección de problemas: DUPLICADOS (misma
 * huella de contenido declarada), FALTANTES (sujetos vivos del juego sin asset real, solo
 * cubiertos por placeholder), HUÉRFANOS (assets de sujeto que ya nadie referencia) y
 * REFERENCIAS ROTAS (índices internos incoherentes). Puro y determinista (reloj inyectado).
 */
import { ARTWORK_CATEGORIES, ARTWORK_SCHEMA_VERSION } from "./types";
import type { ArtworkCategory, ArtworkManifest, ArtworkRefs } from "./types";
import type { ArtworkRegistry } from "./registry";
import { artworkHash } from "./assets";

export const emptyRefs = (): ArtworkRefs =>
  ({ players: [], teams: [], countries: [], tournaments: [], collections: [], badges: [] });

/** Categorías ligadas a sujetos del juego (para faltantes/huérfanos). */
const SUBJECT_CATEGORIES: { category: ArtworkCategory; refs: keyof ArtworkRefs }[] = [
  { category: "player", refs: "players" },
  { category: "team", refs: "teams" },
  { category: "country", refs: "countries" },
  { category: "tournament-logo", refs: "tournaments" },
  { category: "collection", refs: "collections" },
  { category: "badge", refs: "badges" },
];

export function buildManifest(reg: ArtworkRegistry, refs: ArtworkRefs, now: number): ArtworkManifest {
  const assets = reg.list().sort((a, b) => (a.id < b.id ? -1 : 1));

  const byCategory = Object.fromEntries(ARTWORK_CATEGORIES.map((c) => [c, 0])) as Record<ArtworkCategory, number>;
  for (const a of assets) byCategory[a.category]++;

  // Duplicados: huellas compartidas por más de un asset.
  const seenHash = new Set<string>();
  const duplicates: ArtworkManifest["duplicates"] = [];
  for (const a of assets) {
    if (seenHash.has(a.hash)) continue;
    seenHash.add(a.hash);
    const ids = reg.idsByHash(a.hash);
    if (ids.length > 1) duplicates.push({ hash: a.hash, assetIds: [...ids].sort() });
  }

  // Faltantes y huérfanos por categoría de sujeto.
  const missing: ArtworkManifest["missing"] = [];
  const orphans: string[] = [];
  for (const { category, refs: key } of SUBJECT_CATEGORIES) {
    const wanted = new Set(refs[key].map((s) => category === "country" ? s.toLowerCase() : s));
    for (const subjectId of [...wanted].sort()) {
      if (!reg.forSubject(category, subjectId)) missing.push({ category, subjectId });
    }
    for (const a of reg.list(category)) {
      if (!a.placeholder && a.subjectId && !wanted.has(a.subjectId)) orphans.push(a.id);
    }
  }
  orphans.sort();

  // Referencias rotas: índices internos incoherentes (alias → id inexistente,
  // asset de sujeto cuyo id no respeta su convención `<categoría>:<sujeto>`).
  const broken: string[] = [];
  for (const [alias, id] of reg.aliases()) {
    if (!reg.get(id)) broken.push(`alias:${alias}→${id}`);
  }
  for (const a of assets) {
    if (a.subjectId && !a.placeholder && a.id !== `${a.category}:${a.subjectId}`) {
      broken.push(`subject:${a.id}≠${a.category}:${a.subjectId}`);
    }
  }
  broken.sort();

  const core = { total: assets.length, byCategory, duplicates, missing, orphans, broken };
  return {
    schemaVersion: ARTWORK_SCHEMA_VERSION,
    generatedAt: now,
    ...core,
    fingerprint: artworkHash(JSON.stringify(core)),
  };
}
