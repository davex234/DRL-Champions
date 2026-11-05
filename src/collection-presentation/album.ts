/**
 * ALBUM (Collection Fase 7/7) — proyección de progreso/estadística. SOLO LECTURA.
 *
 * REUTILIZA `CollectionEngine` (album/sets/statistics/analytics/progress/completion): no recalcula
 * nada, solo reorganiza para la vista (regiones/variantes/seriales/duplicados/heatmap). Determinista.
 */
import type { CollectionEngine } from "@/collection";
import { bucketForRank } from "@/domain/packs/types";
import type { AlbumView, ProgressBucket, HeatCell, DuplicateAnalysis, SerialProgress } from "./types";

const REGIONS = ["EMEA", "Americas", "Pacific", "China"];
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];

export function albumView(col: CollectionEngine): AlbumView {
  const sets = col.sets();
  const views = col.views();
  const owned = col.ownedViews();

  const regions: ProgressBucket[] = sets.filter((s) => s.kind === "region").map((s) => ({ key: s.id, label: s.label, owned: s.owned, total: s.total, percent: s.percent }));
  const variants: ProgressBucket[] = sets.filter((s) => s.kind === "group").map((s) => ({ key: s.id, label: s.label, owned: s.owned, total: s.total, percent: s.percent }));

  // Seriales: gemas (#1) y mejores series de las cartas poseídas.
  const serializedOwned = owned.filter((v) => v.serialized).length;
  const bestSerials = owned.filter((v) => v.serialized && v.bestSerial != null).sort((a, b) => (a.bestSerial! - b.bestSerial!) || (a.cardId < b.cardId ? -1 : 1));
  const serials: SerialProgress = {
    serializedOwned,
    gems: bestSerials.filter((v) => v.bestSerial === 1).length,
    best: bestSerials.slice(0, 10).map((v) => ({ cardId: v.cardId, serial: v.bestSerial! })),
  };

  // Duplicados: cartas con >1 copia (reutiliza count de la vista).
  const dup = owned.filter((v) => v.count > 1).sort((a, b) => (b.count - a.count) || (a.cardId < b.cardId ? -1 : 1));
  const duplicates: DuplicateAnalysis = { totalDuplicates: dup.reduce((s, v) => s + (v.count - 1), 0), distinctDuplicated: dup.length, top: dup.slice(0, 10).map((v) => ({ cardId: v.cardId, count: v.count })) };

  // Heatmap región × rareza: poseídas distintas / total distinto por celda.
  const totalCell = new Map<string, number>();
  const ownedCell = new Map<string, number>();
  for (const v of views) { const k = `${v.region}|${bucketForRank(v.rank)}`; totalCell.set(k, (totalCell.get(k) ?? 0) + 1); if (v.owned) ownedCell.set(k, (ownedCell.get(k) ?? 0) + 1); }
  const heatmap: HeatCell[] = [];
  for (const region of REGIONS) for (const rarity of RARITIES) {
    const k = `${region}|${rarity}`;
    const total = totalCell.get(k) ?? 0;
    const ow = ownedCell.get(k) ?? 0;
    heatmap.push({ region, rarity, owned: ow, total, intensity: total > 0 ? Math.round((ow / total) * 100) / 100 : 0 });
  }

  return {
    completion: col.completion(),
    progress: col.progress(),
    statistics: col.statistics(),
    sets,
    regions,
    variants,
    serials,
    duplicates,
    missing: col.missing(),
    heatmap,
  };
}
