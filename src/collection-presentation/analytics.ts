/**
 * ANALYTICS (Collection Fase 7/7) — proyección de valor/records. SOLO LECTURA.
 *
 * REUTILIZA los motores existentes: valor de instancia de `pricing`, valor de mercado inyectado desde
 * el Marketplace, química/uso desde los decks, historiales de Career/Battle Pass/Marketplace tal cual.
 * NUNCA recalcula datos de otros motores: solo proyecta. Determinista.
 */
import { instanceValue } from "@/domain/economy/pricing";
import type { RarityBucket } from "@/domain/packs/types";
import type { PresentationContext } from "./context";
import type { AnalyticsView, ValuedCard, TimelineEntry } from "./types";

const MAT_WEIGHT: Record<RarityBucket, number> = { common: 10, uncommon: 25, rare: 60, epic: 150, legendary: 400 };

export function analyticsView(ctx: PresentationContext): AnalyticsView {
  const col = ctx.collection;
  const owned = col.ownedViews();

  let collectionValue = 0;
  let marketValue = 0;
  let mostValuable: ValuedCard | null = null;
  let mostRare: ValuedCard | null = null;

  for (const v of owned) {
    const def = col.registry.card(v.cardId);
    if (!def) continue;
    const iv = instanceValue(def, v.bestSerial ?? undefined);
    collectionValue += iv;
    const mv = ctx.marketValue ? ctx.marketValue(v.cardId, v.bestSerial) : iv;
    marketValue += mv;
    if (!mostValuable || mv > mostValuable.value) mostValuable = { cardId: v.cardId, value: mv, nick: v.nick, label: v.label };
    if (!mostRare || v.rank > mostRare.value) mostRare = { cardId: v.cardId, value: v.rank, nick: v.nick, label: v.label };
  }

  // Valor en materiales de crafting (reutiliza tiers de rareza; sin economía nueva).
  let craftValue = 0;
  if (ctx.materials) for (const [k, n] of Object.entries(ctx.materials)) craftValue += (MAT_WEIGHT[k as RarityBucket] ?? 0) * (n ?? 0);

  // Newest / oldest desde el historial de Collection (obtainedAt).
  const hist = col.history();
  const toTimeline = (i: number): TimelineEntry | null => {
    const h = hist[i]; if (!h) return null;
    return { at: h.at, cardId: h.cardId, label: col.view(h.cardId)?.label ?? h.cardId, origin: h.origin, serial: h.serial };
  };
  const newest = toTimeline(0);
  const oldest = toTimeline(hist.length - 1);

  // Fastest growing: carta con más adquisiciones en las últimas 20 entradas del historial.
  const recent = hist.slice(0, 20);
  const growth = new Map<string, number>();
  for (const h of recent) growth.set(h.cardId, (growth.get(h.cardId) ?? 0) + 1);
  const fg = [...growth.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0];
  const fastestGrowing: ValuedCard | null = fg ? { cardId: fg[0], value: fg[1], label: col.view(fg[0])?.label } : null;

  // Más usada: reutiliza los decks (resuelve uid → cardId por la propiedad). SOLO LECTURA.
  let mostUsed: { cardId: string; decks: number } | null = null;
  if (ctx.decks && ctx.decks.length) {
    const use = new Map<string, number>();
    for (const d of ctx.decks) for (const uid of d.starters) { const inst = col.ownership().instance(uid); if (inst) use.set(inst.cardId, (use.get(inst.cardId) ?? 0) + 1); }
    const mu = [...use.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0];
    if (mu) mostUsed = { cardId: mu[0], decks: mu[1] };
  }

  return {
    collectionValue,
    marketValue,
    craftValue,
    investment: marketValue - collectionValue,
    mostRare,
    mostValuable,
    fastestGrowing,
    newest,
    oldest,
    mostUsed,
    byOrigin: col.byOrigin() as unknown as Record<string, number>,
    careerHistory: ctx.careerHistory ?? [],
    passHistory: ctx.passArchive ?? [],
    marketHistory: ctx.marketHistory ?? [],
  };
}
