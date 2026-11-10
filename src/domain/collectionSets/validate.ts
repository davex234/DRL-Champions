/**
 * F82 · VALIDACIÓN de un set antes de publicarlo (pura). «No publicar basura»: un set publicado es una promesa
 * permanente a los jugadores, así que se comprueba todo lo que el catálogo real puede comprobar.
 */
import { canonicalCardTeam, teamIdentityById } from "@/data/teamIdentities";
import { getVariant, DESIGNED_EDITIONS } from "@/domain/cards/variants";
import type { CardDef } from "@/domain/cards/types";
import type { GeneratorContext } from "./generator";
import { BADGE_ID_PATTERN, SET_ID_PATTERN, type CollectionSetDef } from "./types";

export type PublishError =
  | "BAD_ID" | "EMPTY" | "DUPLICATE_REQUIREMENT" | "DUPLICATE_PLAYER" | "EMPTY_REQUIREMENT" | "UNKNOWN_PLAYER" | "UNKNOWN_CARD"
  | "CARD_PLAYER_MISMATCH" | "CARD_TEAM_MISMATCH" | "CARD_EDITION_MISMATCH" | "SPECIFIC_NEEDS_ONE_CARD" | "UNOBTAINABLE"
  | "BAD_REWARD" | "UNKNOWN_SUBJECT" | "NO_LOGO" | "BAD_VERSION" | "NOT_DRAFT" | "BAD_TITLE";

export interface PublishIssue { code: PublishError; detail: string }

export function validateForPublish(
  set: Pick<CollectionSetDef, "id" | "family" | "version" | "kind" | "subjectId" | "title" | "status" | "requirements" | "reward" | "logo">,
  ctx: GeneratorContext,
): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const add = (code: PublishError, detail = "") => issues.push({ code, detail });
  const byId = new Map(ctx.cards.map((c) => [c.id, c] as [string, CardDef]));

  if (set.status !== "DRAFT") add("NOT_DRAFT", set.status);
  if (!SET_ID_PATTERN.test(set.id)) add("BAD_ID", set.id);
  if (!Number.isInteger(set.version) || set.version < 1) add("BAD_VERSION", String(set.version));
  if (!set.title.trim() || set.title.length > 80) add("BAD_TITLE");
  if (!BADGE_ID_PATTERN.test(set.reward?.badgeId ?? "")) add("BAD_REWARD", set.reward?.badgeId ?? "∅");
  if (set.requirements.length === 0) add("EMPTY");

  if (set.kind === "TEAM") {
    const identity = teamIdentityById(set.subjectId);
    if (!identity) add("UNKNOWN_SUBJECT", set.subjectId);
    if (!set.logo || set.logo !== ctx.logo(set.subjectId)) add("NO_LOGO", set.logo ?? "∅");
  } else if (!DESIGNED_EDITIONS.has(set.subjectId as never)) {
    add("UNKNOWN_SUBJECT", set.subjectId);
  }

  const keys = new Set<string>();
  const players = new Set<string>();
  for (const r of set.requirements) {
    if (keys.has(r.key)) add("DUPLICATE_REQUIREMENT", r.key);
    keys.add(r.key);
    if (set.kind === "TEAM") {
      if (players.has(r.playerId)) add("DUPLICATE_PLAYER", r.playerId);
      players.add(r.playerId);
    }
    if (!ctx.player(r.playerId)) add("UNKNOWN_PLAYER", r.playerId);
    if (r.cardIds.length === 0) { add("EMPTY_REQUIREMENT", r.key); continue; }
    if (r.type === "SPECIFIC_CARD" && r.cardIds.length !== 1) add("SPECIFIC_NEEDS_ONE_CARD", r.key);
    let anyObtainable = false;
    for (const id of r.cardIds) {
      const card = byId.get(id);
      if (!card) { add("UNKNOWN_CARD", id); continue; }
      if (card.playerId !== r.playerId) add("CARD_PLAYER_MISMATCH", `${id} ≠ ${r.playerId}`);
      if (set.kind === "TEAM" && canonicalCardTeam(card, ctx.player(card.playerId)).key !== set.subjectId) add("CARD_TEAM_MISMATCH", `${id} no es de ${set.subjectId}`);
      if (set.kind === "EDITION" && card.variantId !== set.subjectId) add("CARD_EDITION_MISMATCH", `${id} no es ${getVariant(set.subjectId as never)?.label ?? set.subjectId}`);
      if (ctx.obtainable(card)) anyObtainable = true;
    }
    // Un requisito sin NINGUNA carta obtenible haría el set imposible para quien no la tenga ya.
    if (!anyObtainable) add("UNOBTAINABLE", r.key);
  }
  return issues;
}
