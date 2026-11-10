/**
 * DRL COLLECTION ENGINE — logros automáticos (PURO).
 *
 * Genera un logro por colección ("Completa {name}") más metas agregadas
 * ("Completa N colecciones"), con progreso calculado al vuelo. Forma compatible
 * con la UI de `/logros`. El claim vive en `useCollectionsStore` (una sola fuente
 * de verdad anti-doble-claim).
 */
import type { Reward } from "@/domain/events/types";
import type { CollectionDef } from "./types";
import { collectionProgress } from "./progress";

export interface AchievementView {
  id: string;
  name: string;
  description: string;
  icon: string;
  reward: Reward;
  goal: number;
  current: number;
  complete: boolean;
}

export function collectionAchievements(defs: CollectionDef[], owned: Set<string>): AchievementView[] {
  const views: AchievementView[] = [];
  let completed = 0;

  for (const d of defs) {
    const p = collectionProgress(d, owned);
    if (p.complete) completed++;
    views.push({
      id: `coll:${d.id}`,
      name: `Completa ${d.name}`,
      description: `Consigue las ${p.total} cartas de la colección ${d.name}.`,
      icon: "📚",
      reward: d.reward,
      goal: p.total,
      current: p.owned,
      complete: p.complete,
    });
  }

  // Metas agregadas.
  for (const g of [1, 3, 5]) {
    if (defs.length < g) continue;
    views.push({
      id: `coll-meta:${g}`,
      name: `Completa ${g} ${g === 1 ? "colección" : "colecciones"}`,
      description: `Completa ${g} colecciones distintas para una recompensa mayor.`,
      icon: "🏅",
      reward: { credits: 5000 * g},
      goal: g,
      current: completed,
      complete: completed >= g,
    });
  }

  return views;
}
