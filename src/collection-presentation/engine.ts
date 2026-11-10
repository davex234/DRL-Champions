/**
 * PRESENTATION ENGINE — orquestador de SOLO LECTURA (Collection Fase 7/7, FINAL).
 *
 * Compone las vistas (Museum/Showcase/Album/Analytics/Presentation) sobre un `PresentationContext`
 * inmutable. Cachea cada vista (se calcula una vez). NUNCA modifica inventario/cartas/economía/progreso:
 * solo proyecta. Determinista. Cierra el módulo Collection.
 */
import type { PresentationContext } from "./context";
import { museumView } from "./museum";
import { showcaseView } from "./showcase";
import { albumView } from "./album";
import { analyticsView } from "./analytics";
import { collectionSummary, timeline, cardDetail, profileView, seasonReview, careerReview } from "./presentation";
import type { MuseumView, ShowcaseView, AlbumView, AnalyticsView, CollectionSummary, CardDetailView, ProfileView, SeasonReview, CareerReview, TimelineEntry } from "./types";
import type { BinderPage } from "@/collection";

export class PresentationEngine {
  private ctx: PresentationContext;
  private cache: Partial<{ museum: MuseumView; showcase: ShowcaseView; album: AlbumView; analytics: AnalyticsView; summary: CollectionSummary }> = {};

  constructor(ctx: PresentationContext) { this.ctx = ctx; }

  museum(): MuseumView { return (this.cache.museum ??= museumView(this.ctx.collection)); }
  showcase(): ShowcaseView { return (this.cache.showcase ??= showcaseView(this.ctx.collection)); }
  album(): AlbumView { return (this.cache.album ??= albumView(this.ctx.collection)); }
  analytics(): AnalyticsView { return (this.cache.analytics ??= analyticsView(this.ctx)); }
  summary(): CollectionSummary { return (this.cache.summary ??= collectionSummary(this.ctx.collection)); }

  binder(pageSize = 12): BinderPage[] { return this.ctx.collection.binder(pageSize); }
  timeline(limit = 60): TimelineEntry[] { return timeline(this.ctx.collection, limit); }
  cardDetail(cardId: string): CardDetailView | null { return cardDetail(this.ctx, cardId); }
  profile(): ProfileView { return profileView(this.ctx); }
  seasonReview(): SeasonReview | null { return seasonReview(this.ctx); }
  careerReview(): CareerReview { return careerReview(this.ctx); }
}
