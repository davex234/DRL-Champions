/**
 * PRESENTATION (Collection Fase 7/7) — vistas de alto nivel. SOLO LECTURA.
 *
 * Ensambla resúmenes/detalle/perfil/reviews a partir de los sub-motores de proyección + el contexto
 * inyectado. Nunca modifica nada. Determinista.
 */
import { instanceValue } from "@/domain/economy/pricing";
import type { CollectionEngine } from "@/collection";
import type { PresentationContext } from "./context";
import { showcaseView } from "./showcase";
import { museumView } from "./museum";
import type { CollectionSummary, CardDetailView, ProfileView, SeasonReview, CareerReview, TimelineEntry } from "./types";

export function collectionSummary(col: CollectionEngine): CollectionSummary {
  const st = col.statistics();
  const an = col.analytics();
  let value = 0;
  for (const v of col.ownedViews()) { const def = col.registry.card(v.cardId); if (def) value += instanceValue(def, v.bestSerial ?? undefined); }
  return {
    owned: st.progress.owned, total: st.progress.total, completion: col.completion(),
    distinct: st.progress.distinct, duplicates: st.duplicates, squadRating: st.squadRating,
    serializedOwned: an.serializedOwned, collectionValue: value,
  };
}

export function timeline(col: CollectionEngine, limit = 60): TimelineEntry[] {
  return col.history().slice(0, limit).map((h) => ({ at: h.at, cardId: h.cardId, label: col.view(h.cardId)?.label ?? h.cardId, origin: h.origin, serial: h.serial }));
}

export function cardDetail(ctx: PresentationContext, cardId: string): CardDetailView | null {
  const col = ctx.collection;
  const card = col.view(cardId);
  if (!card) return null;
  return {
    card,
    instances: col.instances(cardId),
    history: col.cardHistory(cardId),
    marketValue: ctx.marketValue ? ctx.marketValue(cardId, card.bestSerial) : null,
    bestSerial: card.bestSerial,
  };
}

export function profileView(ctx: PresentationContext): ProfileView {
  const col = ctx.collection;
  return {
    summary: collectionSummary(col),
    showcase: showcaseView(col),
    hallOfFame: museumView(col).hallOfFame,
    pass: ctx.pass ?? null,
    topDecks: (ctx.decks ?? []).slice(0, 5),
  };
}

export function seasonReview(ctx: PresentationContext): SeasonReview | null {
  const p = ctx.pass as { seasonId?: string; level?: number; percentComplete?: number; missionsCompleted?: number } | undefined;
  if (!p) return null;
  return {
    seasonId: p.seasonId ?? "", level: p.level ?? 0, percentComplete: p.percentComplete ?? 0,
    missionsCompleted: p.missionsCompleted ?? 0, archive: ctx.passArchive ?? [],
  };
}

export function careerReview(ctx: PresentationContext): CareerReview {
  const col = ctx.collection;
  return { records: museumView(col).records, timeline: timeline(col, 40), history: ctx.careerHistory ?? [] };
}
