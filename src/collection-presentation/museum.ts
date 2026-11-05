/**
 * MUSEUM (Collection Fase 7/7) — salón de la fama, líneas de tiempo, colecciones históricas. SOLO LECTURA.
 *
 * REUTILIZA Collection (views/sets/history/analytics/registry/ownership): proyecta sin recalcular. Las
 * colecciones (temporadas/torneos/campeones/legado) DERIVAN de los sets del registro. Determinista.
 */
import type { CollectionEngine } from "@/collection";
import type { MuseumView, HallEntry, NamedCollection, TimelineEntry, PersonalRecord, Milestone } from "./types";

/** Colección con nombre a partir de una lista de cardIds del catálogo. */
function named(col: CollectionEngine, id: string, label: string, cardIds: string[]): NamedCollection {
  const own = col.ownership();
  const ownedIds = cardIds.filter((c) => own.owns(c));
  const total = cardIds.length;
  return { id, label, owned: ownedIds.length, total, percent: total > 0 ? Math.round((ownedIds.length / total) * 100) : 0, cardIds: ownedIds };
}

export function museumView(col: CollectionEngine): MuseumView {
  const owned = col.ownedViews();
  const sets = col.registry.allSets();

  // Hall of Fame: las 12 mejores poseídas (rareza, luego serie más baja, luego OVR).
  const hallOfFame: HallEntry[] = [...owned]
    .sort((a, b) => (b.rank - a.rank) || ((a.bestSerial ?? Infinity) - (b.bestSerial ?? Infinity)) || (b.ovr - a.ovr) || (a.cardId < b.cardId ? -1 : 1))
    .slice(0, 12)
    .map((v) => ({ cardId: v.cardId, nick: v.nick, label: v.label, rank: v.rank, ovr: v.ovr, serial: v.bestSerial, reason: v.bestSerial === 1 ? "Gema #1" : v.rank >= 14 ? "Leyenda" : v.serialized ? "Serializada" : "Élite" }));

  // Línea de tiempo (reutiliza el historial de Collection).
  const collectionTimeline: TimelineEntry[] = col.history().slice(0, 60).map((h) => {
    const view = col.view(h.cardId);
    return { at: h.at, cardId: h.cardId, label: view?.label ?? h.cardId, origin: h.origin, serial: h.serial };
  });

  const seasons = sets.filter((s) => s.kind === "season").map((s) => named(col, s.id, s.label, s.cardIds));
  const tournaments = sets.filter((s) => s.kind === "series").map((s) => named(col, s.id, s.label, s.cardIds));
  const champions = [named(col, "champions", "Champions", col.registry.cards.filter((c) => c.variantId.startsWith("champions")).map((c) => c.id))].filter((n) => n.total > 0);
  const historic = [named(col, "historic", "Icónicas & HOF", col.registry.cards.filter((c) => col.registry.variant(c.variantId).rank >= 14).map((c) => c.id))].filter((n) => n.total > 0);
  const legacy = sets.filter((s) => s.kind === "series" && s.id.includes("icon")).map((s) => named(col, s.id, s.label, s.cardIds));

  // Records personales (reutiliza analytics/statistics).
  const an = col.analytics();
  const st = col.statistics();
  const topOvr = [...owned].sort((a, b) => b.ovr - a.ovr)[0];
  const records: PersonalRecord[] = [
    { key: "distinct", label: "Cartas distintas", value: st.progress.distinct },
    { key: "instances", label: "Instancias totales", value: st.totalInstances },
    { key: "duplicates", label: "Duplicados", value: st.duplicates },
    { key: "serialized", label: "Serializadas", value: an.serializedOwned },
    { key: "squad", label: "Media OVR (squad)", value: st.squadRating },
    ...(topOvr ? [{ key: "topOvr", label: "OVR más alto", value: topOvr.ovr, cardId: topOvr.cardId }] : []),
    ...(an.rarestOwned ? [{ key: "rarest", label: "Más rara", value: col.view(an.rarestOwned)?.rank ?? 0, cardId: an.rarestOwned }] : []),
  ];

  // Hitos (progreso hacia cada uno; reutiliza completion).
  const comp = col.completion();
  const milestones: Milestone[] = [25, 50, 75, 100].map((pct) => ({ key: `complete-${pct}`, label: `Colección al ${pct}%`, reached: comp >= pct, progress: Math.min(1, comp / pct) }))
    .concat([
      { key: "own-100", label: "100 cartas distintas", reached: st.progress.distinct >= 100, progress: Math.min(1, st.progress.distinct / 100) },
      { key: "legendary-1", label: "Primera legendaria", reached: (st.byRarity["15"] ?? 0) + (st.byRarity["14"] ?? 0) > 0, progress: (st.byRarity["15"] ?? 0) + (st.byRarity["14"] ?? 0) > 0 ? 1 : 0 },
    ]);

  return { hallOfFame, collectionTimeline, historic, seasons, tournaments, champions, legacy, records, milestones };
}
