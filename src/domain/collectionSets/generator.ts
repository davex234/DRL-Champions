/**
 * F82 · GENERADOR DE BORRADORES desde el catálogo REAL (puro, no publica nada).
 *
 * Criterios medidos en la auditoría F82 (2026-10-03, catálogo de 331 cartas / 196 jugadores / 41 equipos impresos):
 *
 *   TEAM
 *     · el equipo es el IMPRESO en la carta (`canonicalCardTeam`); un jugador con cartas de dos equipos (sociablee:
 *       FUT y NAVI) cuenta en cada set SOLO con las cartas de ese equipo — nunca «cualquier carta histórica suya».
 *     · NO_IDENTITY        la etiqueta no resuelve a una identidad canónica (`raw:`).
 *     · IDENTITY_CONFLICT  la auditoría 20.2 no pudo fijar el equipo sin una decisión de producto (`packTeam: null`).
 *     · NO_LOGO            no hay logo real en el producto (`hintTeamLogoSrc`): no se dibuja uno falso.
 *     · TOO_FEW_PLAYERS    menos de `MIN_TEAM_PLAYERS` jugadores con carta impresa (no es una plantilla).
 *     · UNOBTAINABLE       algún jugador requerido no tiene NINGUNA carta obtenible hoy (se descarta el set entero:
 *                          nunca se quita al jugador en silencio, ni se publica un requisito imposible).
 *   EDITION
 *     · TOO_SMALL / TOO_LARGE  el mismo umbral que la maestría (5 … min(60, 15 % del catálogo)): una edición de 1–2
 *                              cartas se completa sin querer; una de 169 es medio catálogo, no un objetivo.
 *     · UNOBTAINABLE           alguna carta no puede salir de ningún sobre activo.
 */
import { CARDS, getPlayer } from "@/data/catalog";
import { PACKS } from "@/data/packs";
import { CardRegistry } from "@/collection/registry";
import { canonicalCardTeam, resolveTeamIdentity, teamIdentityById } from "@/data/teamIdentities";
import { TEAM_PACK_AUDIT } from "@/data/teamPackCatalog";
import { hintTeamLogoSrc } from "@/data/teamLogos";
import { getVariant, DESIGNED_EDITIONS } from "@/domain/cards/variants";
import { packsThatCanContain } from "@/domain/collection/room";
import { packCardClass } from "@/domain/packs/packClass";
import type { CardDef, Player } from "@/domain/cards/types";
import { badgeIdFor, type SetKind, type SetRequirement } from "./types";

export const MIN_TEAM_PLAYERS = 4;
export const MIN_EDITION_CARDS = 5;
export const MAX_EDITION_CARDS = 60;
export const MAX_EDITION_SHARE = 0.15;

export type SkipReason = "NO_IDENTITY" | "IDENTITY_CONFLICT" | "NO_LOGO" | "TOO_FEW_PLAYERS" | "UNOBTAINABLE" | "TOO_SMALL" | "TOO_LARGE";

export interface DraftProposal {
  id: string;
  family: string;
  version: number;
  kind: SetKind;
  subjectId: string;
  title: string;
  requirements: SetRequirement[];
  reward: { badgeId: string };
  logo: string | null;
}

export interface DraftSkip {
  kind: SetKind;
  subjectId: string;
  title: string;
  skip: SkipReason[];
  detail: string;
}

export type DraftResult = DraftProposal | DraftSkip;
export const isSkip = (d: DraftResult): d is DraftSkip => "skip" in d;

/** Lo que el generador necesita del mundo. Por defecto, el catálogo vivo; los tests pasan uno propio. */
export interface GeneratorContext {
  cards: readonly CardDef[];
  player: (id: string) => Player | undefined;
  obtainable: (card: CardDef) => boolean;
  logo: (teamKey: string) => string | null;
}

let REG: CardRegistry | null = null;
/** Obtenible = algún sobre ACTIVO puede contenerla (mismas reglas que el motor) y tiene clase de sobre. */
export function liveObtainable(card: CardDef): boolean {
  REG ??= new CardRegistry();
  return packCardClass(card) !== null && packsThatCanContain(REG, PACKS, card).length > 0;
}

export function liveContext(): GeneratorContext {
  return { cards: CARDS, player: getPlayer, obtainable: liveObtainable, logo: hintTeamLogoSrc };
}

/** Identidades que la auditoría de equipos (20.2) dejó sin fijar: `packTeam: null` = hace falta una decisión. */
export function conflictIdentities(): Set<string> {
  const out = new Set<string>();
  for (const e of TEAM_PACK_AUDIT) {
    if (e.packTeam !== null) continue;
    const id = resolveTeamIdentity(e.canonical);
    if (id && id.status === "unverified") out.add(id.canonicalId);
  }
  return out;
}

const nickOf = (ctx: GeneratorContext, playerId: string) => ctx.player(playerId)?.nick ?? playerId;

export function generateTeamDrafts(ctx: GeneratorContext = liveContext()): DraftResult[] {
  const conflicts = conflictIdentities();
  const teams = new Map<string, { label: string; byPlayer: Map<string, CardDef[]> }>();
  for (const c of ctx.cards) {
    const t = canonicalCardTeam(c, ctx.player(c.playerId));
    const e = teams.get(t.key) ?? { label: t.label, byPlayer: new Map<string, CardDef[]>() };
    e.byPlayer.set(c.playerId, [...(e.byPlayer.get(c.playerId) ?? []), c]);
    teams.set(t.key, e);
  }
  const out: DraftResult[] = [];
  for (const [key, e] of [...teams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const skip: SkipReason[] = [];
    const detail: string[] = [];
    const identity = key.startsWith("raw:") ? undefined : teamIdentityById(key);
    if (!identity) skip.push("NO_IDENTITY");
    if (identity && conflicts.has(identity.canonicalId)) { skip.push("IDENTITY_CONFLICT"); detail.push(identity.unverifiedReason ?? ""); }
    const logo = identity ? ctx.logo(identity.canonicalId) : null;
    if (!logo) skip.push("NO_LOGO");
    if (e.byPlayer.size < MIN_TEAM_PLAYERS) { skip.push("TOO_FEW_PLAYERS"); detail.push(`${e.byPlayer.size} jugadores con carta impresa`); }
    const blocked = [...e.byPlayer.entries()].filter(([, cs]) => !cs.some(ctx.obtainable)).map(([p]) => p);
    if (blocked.length) { skip.push("UNOBTAINABLE"); detail.push(`sin carta obtenible: ${blocked.join(", ")}`); }
    if (skip.length || !identity) {
      out.push({ kind: "TEAM", subjectId: key, title: identity?.displayName ?? e.label, skip, detail: detail.filter(Boolean).join(" · ") });
      continue;
    }
    const requirements: SetRequirement[] = [...e.byPlayer.entries()]
      .map(([playerId, cs]) => ({
        key: `player:${playerId}`, type: "PLAYER_ANY_CARD" as const, playerId, label: nickOf(ctx, playerId),
        // Solo cartas obtenibles: una carta sin vía de obtención nunca debe ser «lo que te falta».
        cardIds: cs.filter(ctx.obtainable).map((c) => c.id).sort(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es") || a.playerId.localeCompare(b.playerId));
    const slug = `team-${identity.canonicalId}`;
    out.push({
      id: `${slug}-v1`, family: `team:${identity.canonicalId}`, version: 1, kind: "TEAM", subjectId: identity.canonicalId,
      title: identity.displayName, requirements, reward: { badgeId: badgeIdFor(slug) }, logo,
    });
  }
  return out;
}

export function generateEditionDrafts(ctx: GeneratorContext = liveContext()): DraftResult[] {
  const byEdition = new Map<string, CardDef[]>();
  for (const c of ctx.cards) {
    if (!DESIGNED_EDITIONS.has(c.variantId)) continue;
    byEdition.set(c.variantId, [...(byEdition.get(c.variantId) ?? []), c]);
  }
  const cap = Math.min(MAX_EDITION_CARDS, Math.floor(ctx.cards.length * MAX_EDITION_SHARE));
  const out: DraftResult[] = [];
  for (const [variantId, cs] of [...byEdition.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const label = getVariant(variantId as never).label;
    const skip: SkipReason[] = [];
    const detail: string[] = [`${cs.length} cartas`];
    if (cs.length < MIN_EDITION_CARDS) skip.push("TOO_SMALL");
    if (cs.length > cap) skip.push("TOO_LARGE");
    const blocked = cs.filter((c) => !ctx.obtainable(c)).map((c) => c.id);
    if (blocked.length) { skip.push("UNOBTAINABLE"); detail.push(`no obtenibles: ${blocked.join(", ")}`); }
    if (skip.length) { out.push({ kind: "EDITION", subjectId: variantId, title: label, skip, detail: detail.join(" · ") }); continue; }
    const requirements: SetRequirement[] = cs
      .map((c) => ({ key: `card:${c.id}`, type: "SPECIFIC_CARD" as const, playerId: c.playerId, label: nickOf(ctx, c.playerId), cardIds: [c.id] }))
      .sort((a, b) => a.label.localeCompare(b.label, "es") || a.key.localeCompare(b.key));
    const slug = `edition-${variantId}`;
    out.push({
      id: `${slug}-v1`, family: `edition:${variantId}`, version: 1, kind: "EDITION", subjectId: variantId,
      title: label, requirements, reward: { badgeId: badgeIdFor(slug) }, logo: null,
    });
  }
  return out;
}
