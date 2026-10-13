/**
 * F82 · VISTA de un set para el jugador (pura): progreso + estado + insignia. La usan el servidor (Sala de Trofeos) y el
 * arnés de QA con los MISMOS números; el cliente nunca la recalcula sobre su caché.
 */
import { progressOf, stateOf, type RequirementProgress, type SetState } from "./progress";
import { badgeFact, type BadgeFact } from "./badges";
import type { CollectionSetDef, SetKind } from "./types";

export interface SetView {
  id: string;
  family: string;
  version: number;
  kind: SetKind;
  subjectId: string;
  title: string;
  logo: string | null;
  retired: boolean;
  state: SetState;
  required: number;
  owned: number;
  missing: number;
  pct: number;
  /** Lo tiene completo AHORA (independiente de haberlo reclamado). */
  completeNow: boolean;
  completedAt: string | null;
  badge: BadgeFact | null;
  requirements: RequirementProgress[];
}

export interface TrophyRoomView {
  totals: {
    teamSets: number; teamsCompleted: number; sets: number; setsCompleted: number; claimable: number;
    badgesUnlocked: number; collectionBadges: number; ownedDistinct: number; catalogCards: number; collectionPct: number;
  };
  sets: SetView[];
  badges: { unlocked: BadgeFact[]; locked: BadgeFact[] };
  recent: { setId: string; title: string; completedAt: string; badge: BadgeFact | null }[];
  featuredBadgeIds: string[];
  profileVersion: number;
}

export function buildSetView(set: CollectionSetDef, owned: ReadonlySet<string>, completedAt: string | null, index: ReadonlyMap<string, CollectionSetDef>): SetView {
  const p = progressOf(set, owned);
  return {
    id: set.id, family: set.family, version: set.version, kind: set.kind, subjectId: set.subjectId, title: set.title, logo: set.logo,
    retired: set.status === "RETIRED", state: stateOf(p, completedAt !== null), required: p.required, owned: p.owned, missing: p.missing,
    pct: p.pct, completeNow: p.complete, completedAt, badge: badgeFact(set.reward.badgeId, index), requirements: p.requirements,
  };
}

