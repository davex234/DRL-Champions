/**
 * F89 · EQUIPO FAVORITO DEL PERFIL — dominio puro.
 *
 * El equipo favorito es un EQUIPO ESPORTS REAL, no una cuenta de Valorosters: se elige entre las identidades de equipo
 * canónicas que existen en nuestro catálogo (el equipo IMPRESO en al menos una carta, `canonicalCardTeam`, el mismo
 * criterio que la colección y los Collection Sets de F82). Se excluyen:
 *   · etiquetas sin identidad canónica (`raw:`), y
 *   · identidades que la auditoría de equipos 20.2 dejó sin fijar (`packTeam: null` + `unverified`): DRX, EDG, Gen.G,
 *     Sentinels… — elegir un equipo cuya identidad no está probada sería inventar.
 *
 * El logo NUNCA viene del usuario: sale del id (`hintTeamLogoSrc`, los logos reales del producto). Sin logo real, el
 * equipo se enseña con su sigla (lenguaje visual propio), no con un escudo dibujado.
 */
import { canonicalCardTeam, resolveTeamIdentity, teamIdentityById } from "@/data/teamIdentities";
import { TEAM_PACK_AUDIT } from "@/data/teamPackCatalog";
import { hintTeamLogoSrc } from "@/data/teamLogos";

export const TEAM_ID_PATTERN = /^[a-z0-9-]{1,48}$/;

/** Lo que el perfil enseña de un equipo esports. */
export interface FavoriteTeamFact {
  id: string;
  name: string;
  tag: string;
  region: string;
  /** Logo real del producto o `null` (se pinta la sigla). */
  logo: string | null;
}

/** Identidades que la auditoría 20.2 no pudo fijar: no se ofrecen como favorito. */
function unresolvedIdentities(): Set<string> {
  const out = new Set<string>();
  for (const e of TEAM_PACK_AUDIT) {
    if (e.packTeam !== null) continue;
    const id = resolveTeamIdentity(e.canonical);
    if (id && id.status === "unverified") out.add(id.canonicalId);
  }
  return out;
}

export function teamFact(id: string): FavoriteTeamFact | null {
  const t = teamIdentityById(id);
  if (!t) return null;
  return { id: t.canonicalId, name: t.displayName, tag: t.tag, region: t.region, logo: hintTeamLogoSrc(t.canonicalId) };
}

/**
 * Opciones válidas, ordenadas (con logo real primero, luego por nombre). `cards` y `player` son el catálogo vivo (el
 * servidor pasa el suyo; el editor del cliente, el del bundle): la validación de verdad la hace siempre el servidor.
 */
export function favoriteTeamOptions(
  cards: readonly { team?: string; playerId: string }[],
  player: (id: string) => { team?: string } | undefined,
): FavoriteTeamFact[] {
  const blocked = unresolvedIdentities();
  const ids = new Set<string>();
  for (const c of cards) {
    const t = canonicalCardTeam(c, player(c.playerId));
    if (!t.identity || t.key.startsWith("raw:") || blocked.has(t.key)) continue;
    ids.add(t.key);
  }
  return [...ids].map(teamFact).filter((f): f is FavoriteTeamFact => f !== null)
    .sort((a, b) => Number(!!b.logo) - Number(!!a.logo) || a.name.localeCompare(b.name, "es"));
}

export type FavoriteTeamError = "BAD_BODY" | "UNKNOWN_TEAM";

/** `null` quita el favorito; un string debe ser EXACTAMENTE un id de las opciones (nada de nombres, URLs ni logos). */
export function parseFavoriteTeam(input: unknown, validIds: ReadonlySet<string>): { ok: true; value: string | null } | { ok: false; code: FavoriteTeamError } {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "string" || !TEAM_ID_PATTERN.test(input)) return { ok: false, code: "BAD_BODY" };
  if (!validIds.has(input)) return { ok: false, code: "UNKNOWN_TEAM" };
  return { ok: true, value: input };
}
