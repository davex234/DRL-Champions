/**
 * PACK WALKOUT · EL INPUT VISUAL DE LA ESCENA (puro) y los PRESETS por edición.
 *
 * La escena no sabe de sobres, economía ni servidor: recibe lo que tiene que ENSEÑAR. `walkoutInputFromCard` lo deriva
 * de una carta del catálogo con las reglas canónicas que ya existen (bandera solo si el país es una nacionalidad real,
 * equipo IMPRESO en la carta con su logo si lo hay, rol de la carta, edición = variante). Es el punto de entrada de la
 * futura integración: `walkout.play({ hero: walkoutInputFromCard(serverResult.hero.card) })`.
 *
 * Nada se inventa: sin bandera → emblema de región; sin logo → emblema de texto del equipo; sin imagen → carta del sistema.
 */
import type { CardDef, Player, Region, RoleId } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { hintTeamLogoSrc } from "@/data/teamLogos";
import { isNationalityFlag } from "@/data/flags";
import { flagSrc } from "@/lib/assets";
import { ROLE_ABBR } from "@/lib/flags";
import { countryDisplayName } from "@/lib/duel/hintVisuals";
import { ISO3166_ALPHA3 } from "./iso3166";
import { NON_NATIONALITY_CODES } from "@/data/flags";
import { ns } from "@/i18n/runtime";

const t = ns("walkout");

/**
 * 0.4 · `WalkoutCardIdentity`: LA identidad de la carta que se revela, ÚNICA fuente de verdad de la escena entera (piezas,
 * arena, pantallas, retrato, carta final). Sale solo de la carta y su jugador (`walkoutIdentityFromCard`). Los ajustes del
 * panel DEV pasan por `applyDevOverrides`, que deja constancia en `overrides` (y la escena lo rotula como FORZADO).
 */
export interface WalkoutInput {
  cardId: string;
  /** Jugador de la carta. */
  playerId: string;
  playerName: string;
  /**
   * Nacionalidad canónica (`Player.country`, ISO-2). `status`: «country» (país real con bandera local) · «noflag» (país
   * real sin bandera en el juego: se muestran su código y su nombre, nunca otra bandera) · «unknown» (código que no es una
   * nacionalidad, p. ej. UN) · «missing» (sin dato). `code` = ISO 3166-1 alfa-3.
   */
  nationality: { iso: string | null; name: string | null; code: string | null; status: "country" | "noflag" | "unknown" | "missing" };
  /** Arte de la carta (el que se ve en la carta final y en el retrato de las pantallas). */
  artwork: string | null;
  /** Campos forzados en el panel DEV (vacío en modo normal: la carta manda). */
  overrides: readonly { field: "flag" | "team" | "role" | "ovr"; label: string }[];
  ovr: number;
  role: RoleId;
  /** Abreviatura canónica del rol (DUE · INI · CEN · CON · FLX). */
  roleAbbr: string;
  /** Bandera del país del jugador, solo si es una nacionalidad real del catálogo. */
  flag: { iso: string; src: string; name: string } | null;
  region: Region | null;
  /** `tag` = siglas impresas (respaldo de texto cuando no hay logo). */
  team: { name: string; tag: string; logoSrc: string | null };
  edition: { id: string; label: string };
  /** La carta del catálogo para el reveal final (la pinta el componente canónico). */
  card: CardDef;
}

export type WalkoutCardIdentity = WalkoutInput;

export function walkoutInputFromCard(card: CardDef, player: Pick<Player, "nick" | "country" | "region" | "role" | "team"> | undefined): WalkoutInput {
  const raw = typeof player?.country === "string" ? player.country.trim().toUpperCase() : "";
  const iso = /^[A-Z]{2}$/.test(raw) ? raw : "";
  const src = iso && isNationalityFlag(iso) ? flagSrc(iso) : null;
  const known = iso && !NON_NATIONALITY_CODES.has(iso) ? countryDisplayName(iso) : null;
  const name = src ? countryDisplayName(iso) : null;
  const team = canonicalCardTeam(card, player);
  const role = (card.role ?? player?.role ?? "Flex") as RoleId;
  return {
    cardId: card.id,
    playerId: card.playerId,
    nationality: !iso ? { iso: null, name: null, code: null, status: raw ? "unknown" : "missing" }
      : src ? { iso, name, code: ISO3166_ALPHA3[iso] ?? null, status: "country" }
        : known && ISO3166_ALPHA3[iso] ? { iso, name: known, code: ISO3166_ALPHA3[iso], status: "noflag" }
          : { iso, name: null, code: null, status: "unknown" },
    artwork: card.image ?? null,
    overrides: [],
    playerName: player?.nick ?? card.playerId,
    ovr: card.ovr,
    role,
    roleAbbr: ROLE_ABBR[role] ?? role.slice(0, 3).toUpperCase(),
    flag: src && name ? { iso, src, name } : null,
    region: player?.region ?? null,
    team: {
      name: team.label || t("Agente libre"),
      tag: team.identity?.tag ?? (card.team || team.label || "—"),
      logoSrc: team.identity ? hintTeamLogoSrc(team.identity.canonicalId) : null,
    },
    edition: { id: card.variantId, label: getVariant(card.variantId).label },
    card,
  };
}

/** 0.4 · el nombre canónico de la derivación: la carta (y su jugador) deciden toda la escena. */
export const walkoutIdentityFromCard = walkoutInputFromCard;

/**
 * Ajustes del panel DEV sobre la identidad de la carta: SOLO para pruebas explícitas. Cada campo forzado queda en
 * `overrides` (la escena enseña «DEV · FORZADO»). Sin ajustes devuelve la identidad intacta.
 */
export function applyDevOverrides(id: WalkoutInput, o: {
  flag?: { iso: string; src: string; name: string } | "none" | null;
  team?: { name: string; tag: string; logoSrc: string | null } | null;
  role?: { role: RoleId; abbr: string } | null;
  ovr?: number | null;
}): WalkoutInput {
  const overrides: { field: "flag" | "team" | "role" | "ovr"; label: string }[] = [];
  let out: WalkoutInput = id;
  if (o.flag) {
    const f = o.flag === "none" ? null : o.flag;
    out = { ...out, flag: f, nationality: f ? { iso: f.iso, name: f.name, code: ISO3166_ALPHA3[f.iso] ?? null, status: "country" } : { iso: null, name: null, code: null, status: "missing" } };
    overrides.push({ field: "flag", label: f ? t("país {iso}", { iso: f.iso }) : t("sin país") });
  }
  if (o.team) { out = { ...out, team: o.team }; overrides.push({ field: "team", label: `equipo ${o.team.tag}` }); }
  if (o.role) { out = { ...out, role: o.role.role, roleAbbr: o.role.abbr }; overrides.push({ field: "role", label: `rol ${o.role.role}` }); }
  if (typeof o.ovr === "number" && Number.isFinite(o.ovr) && o.ovr >= 1 && o.ovr <= 99) { out = { ...out, ovr: Math.round(o.ovr) }; overrides.push({ field: "ovr", label: `media ${Math.round(o.ovr)}` }); }
  return overrides.length ? { ...out, overrides } : id;
}

/* ───────── presets por EDICIÓN (solo luz, partículas e intensidad del reveal; nunca probabilidades) ───────── */

export interface EditionPreset {
  /** Color principal de las luces del escenario («#rrggbb»). */
  light: string;
  /** Color de acento (borde, destellos). */
  accent: string;
  /** Partículas de polvo en el aire (con tope por intensidad). */
  particles: number;
  /** 0..1: cuánto empuja el flash y la luz del reveal. */
  revealIntensity: number;
  /** Tratamiento del acento en el rótulo de la edición. */
  accentTreatment: "plain" | "metal" | "prism" | "gold";
}

/** Las siete ediciones REALES del catálogo diseñado (`DESIGNED_EDITIONS`). Otra cualquiera usa la base. */
export const EDITION_PRESETS: Readonly<Record<string, EditionPreset>> = {
  base:             { light: "#7f8aa3", accent: "#c9d2e3", particles: 40,  revealIntensity: 0.45, accentTreatment: "plain" },
  "masters-l":      { light: "#3fb4ff", accent: "#9fe0ff", particles: 70,  revealIntensity: 0.65, accentTreatment: "metal" },
  "masters-sdc":    { light: "#ff4f7b", accent: "#ffb0c4", particles: 70,  revealIntensity: 0.65, accentTreatment: "metal" },
  "future-star":    { light: "#2ff0c2", accent: "#b8fff0", particles: 90,  revealIntensity: 0.75, accentTreatment: "prism" },
  "champions-s":    { light: "#ffcc4d", accent: "#fff0b3", particles: 110, revealIntensity: 0.85, accentTreatment: "gold" },
  "record-breaker": { light: "#b46bff", accent: "#e8d1ff", particles: 130, revealIntensity: 1,    accentTreatment: "prism" },
  moments:          { light: "#ff8a3d", accent: "#ffd8b8", particles: 130, revealIntensity: 1,    accentTreatment: "gold" },
};

export const editionPreset = (id: string): EditionPreset => EDITION_PRESETS[id] ?? EDITION_PRESETS.base;

/** Tope de partículas por intensidad (rendimiento): MEGA no se distingue por «más partículas», sino por luz y ritmo. */
export const PARTICLE_CAP: Readonly<Record<string, number>> = { STANDARD: 30, RARE: 60, WALKOUT: 110, MEGA_WALKOUT: 140 };
