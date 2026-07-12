/**
 * EDITORIAL ENGINE — `publishApproved(case)`: publica SOLO las cartas aprobadas componiendo
 * los motores EXISTENTES (materialize → buildCatalog → publish) con una generación FILTRADA.
 * Nunca regenera cartas ni recalcula stats: filtra specs/grants de la generación ya decidida.
 *
 * Reglas de composición (el catálogo vivo se DERIVA de los accolades del jugador, invariante
 * de los motores congelados — cardsForPlayer):
 *   1. Una carta no aprobada JAMÁS viaja (rejected/hidden/blocked/review/draft).
 *   2. Un grant solo viaja si TODAS las variantes que desbloquea están aprobadas: si no, se
 *      descarta (y sus cartas derivadas no existirán).
 *   3. Red de seguridad de PUNTO FIJO: si tras construir el catálogo alguna carta no aprobada
 *      de la generación aparece derivada (p. ej. la base de un jugador nuevo), se excluye al
 *      jugador COMPLETO y se recompone. "Nunca las rechazadas" queda GARANTIZADO, no asumido.
 *   4. Las aprobadas excluidas por dependencia se reportan y conservan su estado editorial.
 */
import { variantsForAccolade, allPlayers } from "@/data/catalog";
import type { Player } from "@/domain/cards/types";
import type { CardGenerationResult } from "@/card-generator";
import { materialize } from "@/materializer";
import { buildCatalog } from "@/catalog-builder";
import { publish } from "@/publisher";
import { decide } from "./approvals";
import { cardsInState } from "./review";
import type { DecisionMeta, EditorialCase, ExcludedCard, PublishApprovedResult } from "./types";

export const EDITORIAL_SCHEMA_VERSION = 1;

export interface PublishApprovedCtx extends DecisionMeta {
  /** Roster vivo del catálogo (por defecto `allPlayers()`, igual que el pipeline). */
  roster?: Player[];
  /** Persistencia opcional del roster publicado (passthrough al Publisher). */
  persist?: (players: Player[]) => void;
}

interface Filtered {
  fgen: CardGenerationResult;
  dropped: PublishApprovedResult["droppedGrants"];
  includedCards: string[];
}

function filterGeneration(
  gen: CardGenerationResult,
  approved: Set<string>,
  roster: Player[],
  excludedPlayers: Set<string>,
): Filtered {
  const rosterById = new Map(roster.map((p) => [p.id, p]));
  const playerOf = (id: string): Player | undefined =>
    rosterById.get(id) ?? gen.players.find((r) => r.playerId === id)?.draft;
  const specIds = new Set(gen.cards.map((c) => c.cardId));

  const dropped: PublishApprovedResult["droppedGrants"] = [];
  const grants = gen.grants.filter((g) => {
    if (excludedPlayers.has(g.playerId)) {
      dropped.push({ playerId: g.playerId, accolade: g.accolade, reason: "jugador excluido por composición" });
      return false;
    }
    const p = playerOf(g.playerId);
    if (!p) return true; // sin jugador resoluble no deriva cartas: inofensivo
    const bad = variantsForAccolade(g.accolade, p)
      .find((v) => specIds.has(`${g.playerId}__${v}`) && !approved.has(`${g.playerId}__${v}`));
    if (bad) {
      dropped.push({ playerId: g.playerId, accolade: g.accolade, reason: `deriva ${g.playerId}__${bad}, no aprobada` });
      return false;
    }
    return true;
  });

  const cards = gen.cards.filter((s) => approved.has(s.cardId) && !excludedPlayers.has(s.playerId));
  const includedCards = cards.map((c) => c.cardId);
  const included = new Set(includedCards);
  return {
    fgen: {
      ...gen,
      cards,
      grants,
      collection: { ...gen.collection, items: gen.collection.items.filter((i) => included.has(i.cardId)) },
    },
    dropped,
    includedCards,
  };
}

/**
 * Publica lo aprobado del caso. El Publisher NUNCA se invoca automáticamente por el pipeline
 * editorial: esta función es la única puerta, y solo deja pasar cartas en estado `approved`.
 */
export async function publishApproved(c: EditorialCase, ctx: PublishApprovedCtx): Promise<PublishApprovedResult> {
  const roster = ctx.roster ?? allPlayers();
  const gen = c.generation;
  const approved = new Set(cardsInState(c, "approved"));
  const excludedBase: ExcludedCard[] = gen.cards
    .filter((s) => !approved.has(s.cardId))
    .map((s) => ({ cardId: s.cardId, state: c.states[s.cardId], reason: `estado editorial "${c.states[s.cardId]}"` }));

  if (!approved.size) {
    return { ok: false, error: "sin cartas aprobadas: nada que publicar", case: c, published: [], excluded: excludedBase, droppedGrants: [] };
  }

  const specPlayer = new Map(gen.cards.map((s) => [s.cardId, s.playerId]));
  const excludedPlayers = new Set<string>();
  let filtered = filterGeneration(gen, approved, roster, excludedPlayers);
  let mat = await materialize(filtered.fgen, { roster, now: ctx.at });
  let build = await buildCatalog(mat, { roster, now: ctx.at });

  // Punto fijo: ninguna carta NO aprobada de la generación puede acabar derivada en el catálogo.
  for (let i = 0; i < gen.cards.length; i++) {
    const offending = [...build.diff.added, ...build.diff.updated]
      .filter((id) => specPlayer.has(id) && !approved.has(id));
    if (!offending.length) break;
    for (const id of offending) excludedPlayers.add(specPlayer.get(id)!);
    filtered = filterGeneration(gen, approved, roster, excludedPlayers);
    if (!filtered.includedCards.length) break;
    mat = await materialize(filtered.fgen, { roster, now: ctx.at });
    build = await buildCatalog(mat, { roster, now: ctx.at });
  }

  const excluded: ExcludedCard[] = [
    ...excludedBase,
    ...gen.cards
      .filter((s) => approved.has(s.cardId) && excludedPlayers.has(s.playerId))
      .map((s) => ({ cardId: s.cardId, state: c.states[s.cardId], reason: "excluida por composición: su jugador deriva cartas no aprobadas" })),
  ];

  if (!filtered.includedCards.length) {
    return { ok: false, error: "todas las cartas aprobadas quedaron excluidas por composición", case: c, published: [], excluded, droppedGrants: filtered.dropped };
  }

  const pub = publish(build, { now: ctx.at, persist: ctx.persist });
  if (!pub.ok) {
    return {
      ok: false, error: `publicación ${pub.transaction.finalState}`, case: c,
      publish: pub, build, materialization: mat, published: [], excluded, droppedGrants: filtered.dropped,
    };
  }

  // approved → published (por la ÚNICA puerta de transición, con historial completo).
  const marked = decide(c, filtered.includedCards, "publish", {
    actor: ctx.actor, at: ctx.at,
    comment: ctx.comment ?? `publishApproved: runtime v${pub.runtimeVersion}`,
    reason: ctx.reason,
  });

  return {
    ok: true,
    case: marked.case,
    publish: pub,
    build,
    materialization: mat,
    published: filtered.includedCards,
    excluded,
    droppedGrants: filtered.dropped,
  };
}
