/**
 * F72.2 · PISTAS VISUALES DE LAS CARTAS OCULTAS — la ÚNICA fuente de qué pista se puede DIBUJAR y con qué asset.
 *
 * El dominio (`domain/cardgame/hints`) sigue decidiendo QUÉ tipo toca a cada carta (hash estable, orden cíclico). Este
 * módulo es el puerto `HintVisual`: traduce el campo crudo de la carta a un identificador canónico de ASSET —o `null` si
 * ese asset no existe— y el dominio salta al SIGUIENTE tipo (el mismo salto que ya hacía con un campo vacío). Así:
 *
 *   · nunca se elige una pista que no se pueda pintar (ni icono roto, ni texto, ni iniciales inventadas);
 *   · el valor que viaja al cliente es un id de asset, no un texto de la carta (ISO de 2 letras, rol oficial, liga VCT
 *     o el fichero del logo del equipo por su identidad CANÓNICA, no por comparar textos);
 *   · lo usan el servidor (PvE y PvP) y el cliente (el dorso), así que no puede haber dos versiones.
 *
 * FUENTES — TODAS LOCALES, ninguna URL externa en tiempo de ejecución (F72.3):
 *   COUNTRY → `flagSrc(iso)` → `public/flags/<iso>.svg` (flag-icons 7.5.0, MIT; solo los países de las 331 cartas).
 *             `UN` («sin nacionalidad» en VLR) no es un país: sin pista (F72.2 la pintaba como Naciones Unidas).
 *   TEAM    → `hintTeamLogoSrc(canonicalId)` → `public/hints/teams/<canonicalId>.png`: 25 logos de la biblioteca de trabajo
 *             (integración técnica aprobada; derechos de marca para release SIN RESOLVER). Los demás equipos: sin pista.
 *             El equipo es el de la CARTA (`canonicalCardTeam`: el impreso manda), no el roster actual del jugador: la carta
 *             de Derke impresa con VIT da el logo de Vitality aunque `Player.team` diga Fnatic (F72.3).
 *   ROLE    → `public/hints/roles/<id>.svg`   — NO importados (requieren licencia de Riot).
 *   REGION  → `public/hints/regions/<id>.svg` — NO importados (requieren licencia de Riot).
 * Añadir un icono son dos gestos: dejar el fichero y añadir su id a `HINT_ICONS_AVAILABLE` (un test compara con la carpeta).
 *
 * FLEX: no es un rol oficial. La fuente canónica (VLR 2026, `roleSource: "agents"`) marca a los 38 jugadores Flex con
 * `roleConfidence: "tie"`: no hay un rol oficial fiable, así que una carta Flex nunca lleva pista de ROL.
 */
import type { HintType } from "@/domain/cardgame/hints";
import type { Region, RoleId } from "@/domain/cards/types";
import { canonicalCardTeam, canonicalTeam, TEAM_IDENTITIES } from "@/data/teamIdentities";
import { hintTeamLogoSrc } from "@/data/teamLogos";
import { COUNTRIES, localizedCountryName } from "@/data/countries";
import { isNationalityFlag } from "@/data/flags";
import { getCard, getPlayer } from "@/data/catalog";
import { flagSrc } from "@/lib/assets";

export type ValorantRole = "DUELIST" | "CONTROLLER" | "INITIATOR" | "SENTINEL";
export type VctLeague = "AMERICAS" | "EMEA" | "PACIFIC" | "CHINA";

/** Rol de la carta → rol OFICIAL de VALORANT. Flex no tiene equivalente fiable (ver cabecera). */
export const VALORANT_ROLE_OF: Readonly<Record<RoleId, ValorantRole | null>> = Object.freeze({
  Duelista: "DUELIST", Controlador: "CONTROLLER", Iniciador: "INITIATOR", Centinela: "SENTINEL", Flex: null,
});
export const VCT_LEAGUE_OF: Readonly<Record<Region, VctLeague>> = Object.freeze({
  Americas: "AMERICAS", EMEA: "EMEA", Pacific: "PACIFIC", China: "CHINA",
});

export const HINT_ICON_DIR = "/hints";
/** Iconos de rol y de liga que EXISTEN en `public/hints/` (`roles/<id>`, `regions/<id>`, en minúsculas). Hoy ninguno. */
export const HINT_ICONS_AVAILABLE: ReadonlySet<string> = new Set<string>([]);
const iconId = (kind: "roles" | "regions", id: string) => `${kind}/${id.toLowerCase()}`;
const hasIcon = (kind: "roles" | "regions", id: string) => HINT_ICONS_AVAILABLE.has(iconId(kind, id));

/** Logo del equipo por su identidad CANÓNICA (TH y «Team Heretics» son el mismo): su `canonicalId` si hay logo, o null. */
export function teamLogoSlugFor(rawTeam: string): string | null {
  const c = canonicalTeam(rawTeam);
  return c.identity && hintTeamLogoSrc(c.identity.canonicalId) ? c.identity.canonicalId : null;
}

/**
 * Identidad canónica del equipo DE LA CARTA: la regla única del catálogo (`canonicalCardTeam`, el equipo impreso manda).
 * Sin `cardId` o con una carta fuera del catálogo estático, la del texto recibido (mismo registro de alias).
 */
export function cardTeamIdentityId(rawTeam: string, cardId?: string): string | null {
  const def = cardId ? getCard(cardId) : undefined;
  const c = def ? canonicalCardTeam(def, getPlayer(def.playerId)) : canonicalTeam(rawTeam);
  return c.identity?.canonicalId ?? null;
}

/**
 * PUERTO `HintVisual` del dominio: campo crudo → id canónico del asset, o `null` si no hay asset (el dominio pasa al
 * siguiente tipo). Nunca devuelve texto de la carta.
 */
export function visualHintValue(type: HintType, raw: string, card?: { cardId?: string }): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  switch (type) {
    case "COUNTRY": {
      const iso = v.toUpperCase();
      return isNationalityFlag(iso) && countryDisplayName(iso) ? iso : null;
    }
    case "ROLE": {
      const role = VALORANT_ROLE_OF[v as RoleId] ?? null;
      return role && hasIcon("roles", role) ? role : null;
    }
    case "REGION": {
      const league = VCT_LEAGUE_OF[v as Region] ?? null;
      return league && hasIcon("regions", league) ? league : null;
    }
    case "TEAM": {
      const id = cardTeamIdentityId(v, card?.cardId);
      return id && hintTeamLogoSrc(id) ? id : null;
    }
  }
}

/** Qué se dibuja para una pista YA decidida por el servidor. `null` = dorso normal, sin pista (nunca un icono roto). */
export interface HintArt { type: HintType; src: string; shape: "flag" | "icon" | "logo"; name: string }

export function hintArt(h: { type: HintType; value: string }): HintArt | null {
  const v = String(h.value ?? "");
  switch (h.type) {
    case "COUNTRY": {
      const iso = v.toUpperCase();
      const name = countryDisplayName(iso);
      const src = isNationalityFlag(iso) ? flagSrc(iso) : null;
      return name && src ? { type: h.type, src, shape: "flag", name } : null;
    }
    case "ROLE":
      return (["DUELIST", "CONTROLLER", "INITIATOR", "SENTINEL"] as string[]).includes(v) && hasIcon("roles", v)
        ? { type: h.type, src: `${HINT_ICON_DIR}/roles/${v.toLowerCase()}.svg`, shape: "icon", name: ROLE_NAME[v as ValorantRole] } : null;
    case "REGION":
      return (["AMERICAS", "EMEA", "PACIFIC", "CHINA"] as string[]).includes(v) && hasIcon("regions", v)
        ? { type: h.type, src: `${HINT_ICON_DIR}/regions/${v.toLowerCase()}.svg`, shape: "icon", name: LEAGUE_NAME[v as VctLeague] } : null;
    case "TEAM": {
      const src = /^[a-z0-9-]{1,48}$/.test(v) ? hintTeamLogoSrc(v) : null;
      return src ? { type: h.type, src, shape: "logo", name: TEAM_IDENTITIES.find((t) => t.canonicalId === v)?.displayName ?? v } : null;
    }
  }
}

/**
 * Nombre del país (y prueba de que el ISO es real): la tabla del proyecto y, si no está, `Intl.DisplayNames` (todas las
 * regiones ISO 3166, en Node y en el navegador). Un código que ninguno reconoce no es un país: no hay bandera.
 */
let regionNames: Intl.DisplayNames | null | undefined;
export function countryDisplayName(iso: string): string | null {
  const code = (iso ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "ZZ") return null;
  const localized = localizedCountryName(code);
  if (localized) return localized;
  if (COUNTRIES[code]) return COUNTRIES[code];
  if (regionNames === undefined) { try { regionNames = new Intl.DisplayNames(["es"], { type: "region" }); } catch { regionNames = null; } }
  const name = regionNames?.of(code);
  return name && name !== code && !/desconocid|unknown/i.test(name) ? name : null;
}

const ROLE_NAME: Record<ValorantRole, string> = { DUELIST: "Duelista", CONTROLLER: "Controlador", INITIATOR: "Iniciador", SENTINEL: "Centinela" };
const LEAGUE_NAME: Record<VctLeague, string> = { AMERICAS: "VCT Americas", EMEA: "VCT EMEA", PACIFIC: "VCT Pacific", CHINA: "VCT China" };
