/**
 * DRL COLLECTION ENGINE — tipos PUROS.
 *
 * Una COLECCIÓN agrupa las cartas de un torneo (todos los jugadores + premios) y
 * concede una recompensa exclusiva al completarse. Es source-agnostic: la misma
 * forma sirve para colecciones locales (eventos/catálogo) y de Supabase (torneos).
 */
import type { Reward } from "@/domain/events/types";
import type { AwardWinner } from "./awards";

export type CollectionSource = "local" | "tournament";

export interface CollectionItem {
  cardId: string;
  /** 'player' | award kind | 'mvp' | 'champion'. */
  category: string;
  label: string;
  playerId: string;
}

export interface CollectionDef {
  id: string;
  slug: string;
  name: string;
  source: CollectionSource;
  tournamentId?: string;
  tier?: string;
  region?: string;
  /** Cartas miembro (definen el progreso). */
  items: CollectionItem[];
  /** Premiados destacados (display: MVP/Champion/Top…). */
  awards: AwardWinner[];
  /** Recompensa exclusiva al completar el 100%. */
  reward: Reward;
  createdAt?: string;
}

export interface CollectionProgress {
  owned: number;
  total: number;
  pct: number;
  /** cardIds que faltan. */
  missing: string[];
  complete: boolean;
}
