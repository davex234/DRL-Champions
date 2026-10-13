"use client";

/**
 * ARNÉS QA · FASE 38 — `/design-system/fase38?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES de la apertura (`PackStage`, `CardReveal`, `PackSummary`, `PackStatus`) con planes del
 * dominio REAL (`buildRevealPlan`) sobre resultados QA SYNTHETIC (`./fixtures`). Sin sesión, sin red, sin sorteo.
 */
import { useEffect, useMemo, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { buildRevealPlan, rarityRank, type RevealPlan } from "@/domain/packs/reveal";
import type { OpenedResult } from "@/store/useGameStore";
import { PackBackdrop, PackStage, type PackTease } from "@/components/packs/PackStage";
import { CardReveal } from "@/components/packs/CardReveal";
import { PackHand, type HandSlot } from "@/components/packs/PackHand";
import { PackSummary } from "@/components/packs/PackSummary";
import { PackStatus } from "@/components/packs/PackStatus";
import { PREMIUM, SCENES, STD, TEAM_PACK, type Scene } from "./fixtures";

const CAT = { cards: CARDS, getCard, getPlayer };

export default function Fase38QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "stage-ready"); }, []);
  if (scene === null) return null;
  const s = SCENES[scene];
  if (!s) return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {Object.keys(SCENES).join(", ")}</p>;
  return (
    <div data-scene={scene}>
      <View s={s} />
      {/* Por encima de la escena a pantalla completa (z-modal): la marca QA SYNTHETIC tiene que verse en cada captura. */}
      <p className="pointer-events-none fixed bottom-2 left-2 max-w-[70vw] border border-drl-gold/30 bg-black/80 px-2 py-0.5 text-[10px] text-drl-gold/90" style={{ zIndex: 2147483000 }} data-synthetic="true">
        QA SYNTHETIC · {s.note}
      </p>
    </div>
  );
}

function usePlan(s: Scene): RevealPlan | null {
  return useMemo(() => {
    if (s.kind === "status" || (s.kind === "stage" && !s.plan)) return null;
    const plan = s.kind === "stage" ? s.plan! : s.plan;
    return buildRevealPlan(plan.opened, plan.before, CAT, { reduced: "reduced" in s ? s.reduced : false });
  }, [s]);
}

function View({ s }: { s: Scene }) {
  const plan = usePlan(s);
  const [index, setIndex] = useState(s.kind === "reveal" ? s.index : 0);
  const [revealed, setRevealed] = useState(s.kind === "reveal" ? s.revealed : false);

  if (s.kind === "status") {
    return <PackStatus kind={s.status} title={s.title} message={s.message} packsLeft={s.packsLeft} onNavigate={() => {}} onRetry={s.retry ? () => {} : undefined} />;
  }

  if (s.kind === "summary") {
    return (
      <div className="fixed inset-0 z-modal overflow-y-auto bg-base-900 px-4 py-8">
        <PackSummary packName={STD.name} plan={plan!} available={s.available} packsLeft={s.packsLeft} recovered={s.recovered} repeated={s.repeated} reduced={s.reduced} onOpenAnother={() => {}} onNavigate={() => {}} onAddToDeck={() => {}} />
      </div>
    );
  }

  if (s.kind === "stage") {
    const pack = s.pack === "premium" ? PREMIUM : s.pack === "team" ? TEAM_PACK : STD;
    const best = plan?.summary.featured;
    const tease: PackTease | null = plan?.summary.bestRarity && best
      ? { color: getVariant(best.card.variantId).palette.primary, level: rarityRank(plan.summary.bestRarity) >= 3 ? "high" : rarityRank(plan.summary.bestRarity) === 2 ? "mid" : "low", rays: plan.summary.bestRarity === "legendary" }
      : null;
    const slots: HandSlot[] = (plan?.items ?? []).map(() => ({ revealed: false }));
    return (
      <div className="fixed inset-0 z-modal overflow-hidden bg-base-900" data-testid="pack-opening" data-phase={s.stage}>
        <PackBackdrop accent={pack.accent ?? "#ff2e63"} ambient={s.stage === "ready" || s.stage === "requesting"} reduced={!!s.reduced} />
        <PackStage pack={pack} stage={s.stage} count={plan?.items.length ?? pack.cardCount} cutProgress={s.stage === "requesting" ? 1 : 0} slots={slots} tease={s.stage === "hand" ? tease : null} reduced={!!s.reduced} onOpen={() => {}} onStartReveal={() => {}} onRevealAll={() => {}} freeze={s.stage === "opening"} />
      </div>
    );
  }

  const items = plan!.items;
  const it = items[index];
  const result: OpenedResult = { uid: it.uid, card: it.card, serial: it.serial ?? undefined, mintedVersion: it.mintedVersion, isNew: it.status === "new", value: 0 };
  const slots: HandSlot[] = items.map((x, i) => ({ revealed: i < index || (i === index && revealed), color: getVariant(x.card.variantId).palette.primary }));
  return (
    <div className="fixed inset-0 z-modal overflow-hidden bg-base-900" data-testid="pack-opening" data-phase="reveal">
      <PackBackdrop accent={STD.accent ?? "#ff2e63"} ambient={false} reduced={!!s.reduced} />
      <CardReveal
        key={`${it.uid}-${revealed}`}
        result={result}
        item={it}
        index={index}
        total={items.length}
        isLast={index === items.length - 1}
        onNext={() => { if (!revealed) setRevealed(true); else if (index + 1 < items.length) { setIndex(index + 1); setRevealed(false); } }}
        revealed={revealed}
        onShown={() => { /* el arnés congela la escena: no gira sola */ }}
        reducedOverride={s.reduced}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-surface flex flex-col items-center gap-2 pb-5">
        <PackHand slots={slots} accent={STD.accent ?? "#ff2e63"} mode="strip" activeIndex={index} />
        <span className="nx-readout text-label uppercase tracking-wide2 text-ink-faint">{index + 1} / {items.length}</span>
      </div>
      <button type="button" className="nx-focus absolute left-4 top-4 z-overlay inline-flex h-11 min-h-[44px] items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-4 font-display text-label font-bold uppercase tracking-wide2 text-white/75" aria-label="Saltar la animación y ver todas las cartas" data-testid="pack-skip">
        Saltar ⏭
      </button>
    </div>
  );
}
