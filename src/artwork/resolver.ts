/**
 * RESOLVER — resolución AUTOMÁTICA de la cascada del spec para una carta:
 *
 *   player → team → country → tournament → background → frame → icons → effects
 *
 * y placeholder oficial si falta cualquier recurso: la resolución NUNCA falla ni devuelve
 * huecos. Además resuelve por id, por alias y por hash. Puro: no carga ni genera nada.
 */
import { playerAsset, teamAsset, countryAsset, tournamentLogoAsset, placeholderFor } from "./assets";
import type { ArtworkRegistry } from "./registry";
import type {
  ArtworkAsset, ArtworkCategory, ArtworkRequest, CardArtworkResolution, ResolvedArtwork,
} from "./types";

/** Resuelve un recurso de una categoría para un sujeto; placeholder si falta. */
export function resolveSubject(
  reg: ArtworkRegistry, category: ArtworkCategory, subjectId: string | undefined,
): ResolvedArtwork {
  const real = subjectId ? reg.forSubject(category, subjectId) : undefined;
  if (real) return { category, asset: real, isPlaceholder: false };
  const ph = reg.get(`placeholder:${category}`) ?? placeholderFor(category);
  return { category, asset: ph, isPlaceholder: true };
}

/** Primer asset real de una categoría (recursos globales: fondo, marco); placeholder si no hay. */
function resolveFirst(reg: ArtworkRegistry, category: ArtworkCategory, preferId?: string): ResolvedArtwork {
  const preferred = preferId ? reg.get(preferId) : undefined;
  const real = preferred ?? reg.list(category).find((a) => !a.placeholder);
  if (real) return { category, asset: real, isPlaceholder: false };
  return { category, asset: reg.get(`placeholder:${category}`) ?? placeholderFor(category), isPlaceholder: true };
}

/** Cascada completa para una carta. Determinista; jamás lanza; jamás deja huecos. */
export function resolveCardArtwork(reg: ArtworkRegistry, req: ArtworkRequest): CardArtworkResolution {
  const player = resolveSubject(reg, "player", req.playerId);
  const team = resolveSubject(reg, "team", req.teamSlug);
  const country = resolveSubject(reg, "country", req.countryIso?.toLowerCase());
  const tournament = resolveSubject(reg, "tournament-logo", req.tournamentId);
  const background = resolveFirst(reg, "background");
  const frame = resolveFirst(reg, "frame", req.rarity ? `frame:${req.rarity}` : undefined);

  const icons: ResolvedArtwork[] = [
    resolveSubject(reg, "role", req.role),
    resolveSubject(reg, "region", req.region),
    ...(req.agent ? [resolveSubject(reg, "agent", req.agent)] : []),
    ...(req.map ? [resolveSubject(reg, "map", req.map)] : []),
  ];
  const effects: ResolvedArtwork[] = [resolveFirst(reg, "effect")];
  const badges: ResolvedArtwork[] = (req.badges ?? []).map((b) => resolveSubject(reg, "badge", b));

  const all = [player, team, country, tournament, background, frame, ...icons, ...effects, ...badges];
  const missing = [...new Set(all.filter((r) => r.isPlaceholder).map((r) => r.category))];

  return { player, team, country, tournament, background, frame, icons: [...icons, ...badges], effects, missing };
}

/**
 * CONVENCIONES por sujeto: el asset ESPERADO de un sujeto aunque aún no esté registrado
 * (mismas rutas que `src/lib/assets.ts`). Útil para poblar el registro desde el catálogo.
 */
export function conventionalAsset(category: ArtworkCategory, subjectId: string): ArtworkAsset | null {
  switch (category) {
    case "player": return playerAsset(subjectId);
    case "team": return teamAsset(subjectId);
    case "country": return countryAsset(subjectId);
    case "tournament-logo": return tournamentLogoAsset(subjectId);
    default: return null;
  }
}

/** Resolución por referencia libre: id exacto → alias → hash. Null si nada coincide. */
export function resolveRef(reg: ArtworkRegistry, ref: string): ArtworkAsset | null {
  const direct = reg.byAliasOrId(ref);
  if (direct) return direct;
  const byHash = reg.idsByHash(ref);
  if (byHash.length) return reg.get(byHash[0]) ?? null;
  return null;
}
