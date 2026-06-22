"use client";

import { getSupabase } from "./client";
import type { ProfileSyncFields } from "./types";
import { useGameStore } from "@/store/useGameStore";
import { useEventsStore } from "@/store/useEventsStore";
import { levelFromXp } from "@/domain/progression/levels";
import { groupCollection } from "@/store/selectors";
import { getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { instanceValue } from "@/domain/economy/pricing";

/** Snapshot del estado local del motor (compatibilidad: migración progresiva). */
export interface GameSnapshot {
  v: 1;
  game: Record<string, unknown>;
  events: Record<string, unknown>;
}

export function buildSnapshot(): GameSnapshot {
  const g = useGameStore.getState();
  const e = useEventsStore.getState();
  return {
    v: 1,
    game: {
      credits: g.credits,
      xp: g.xp,
      ownedCards: g.ownedCards,
      unopenedPacks: g.unopenedPacks,
      mintCounts: g.mintCounts,
      packsOpened: g.packsOpened,
      claimedAchievements: g.claimedAchievements,
    },
    events: {
      tokens: e.tokens,
      seasonStart: e.seasonStart,
      progress: e.progress,
      weeklyProgress: e.weeklyProgress,
      claimedMissions: e.claimedMissions,
      claimedWeekly: e.claimedWeekly,
      passXp: e.passXp,
      claimedPassLevels: e.claimedPassLevels,
      shopPurchases: e.shopPurchases,
      cosmetics: e.cosmetics,
      daily: e.daily,
    },
  };
}

export function applySnapshot(snap: GameSnapshot) {
  if (!snap || snap.v !== 1) return;
  useGameStore.setState((s) => ({ ...s, ...snap.game }));
  useEventsStore.setState((s) => ({ ...s, ...snap.events }));
}

/** Campos de ranking derivados del estado local. */
export function computeProfileFields(): ProfileSyncFields {
  const g = useGameStore.getState();
  const grouped = groupCollection(g.ownedCards);
  let value = 0;
  let rarest = 0;
  for (const entry of grouped.values()) {
    const def = getCard(entry.cardId);
    if (!def) continue;
    value += instanceValue(def, entry.instances[0]?.serial);
    rarest = Math.max(rarest, getVariant(def.variantId).rank);
  }
  return {
    level: levelFromXp(g.xp).level,
    xp: g.xp,
    credits: g.credits,
    tokens: useEventsStore.getState().tokens,
    collection_value: value,
    distinct_cards: grouped.size,
    rarest_rank: rarest,
    packs_opened: g.packsOpened,
  };
}

/** Sube el estado local a la nube (game_state) + campos de ranking (profiles). */
export async function pushState(userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("game_state").upsert({ user_id: userId, data: buildSnapshot(), updated_at: new Date().toISOString() });
  await sb.from("profiles").update(computeProfileFields()).eq("id", userId);
}

/** Descarga el estado de la nube y lo aplica. Devuelve true si había datos. */
export async function pullState(userId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb.from("game_state").select("data").eq("user_id", userId).single();
  const snap = data?.data as GameSnapshot | undefined;
  if (snap && snap.v === 1 && (snap.game?.ownedCards || snap.game?.credits != null)) {
    applySnapshot(snap);
    return true;
  }
  return false;
}
