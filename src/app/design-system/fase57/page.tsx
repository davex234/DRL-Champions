"use client";

/**
 * ARNÉS QA · FASE 57 — PACK OPENING 5.0 · `/design-system/fase57?scene=<escena>` (solo capturas y revisión).
 *
 * Monta las piezas REALES de la ceremonia (`PackBackdrop`, `PackStage`, `CardReveal`, `PackHand`, `PackSummary`) con
 * planes del dominio REAL (`buildRevealPlan`) sobre resultados QA SYNTHETIC (los del arnés de la Fase 38) y sobres
 * REALES del catálogo (arte por `packArtwork`). Sin sesión, sin red, sin sorteo, sin escribir cartas ni inventario.
 * Los actos animados se congelan (`freeze`) para poder fotografiarlos.
 */
import { useEffect, useMemo, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { getVariant } from "@/domain/cards/variants";
import type { PackDef } from "@/domain/packs/types";
import { buildRevealPlan, rarityRank, type RevealPlan } from "@/domain/packs/reveal";
import type { OpenedResult } from "@/store/useGameStore";
import { PackBackdrop, PackStage, type PackTease, type StageKind, type FrozenBeat } from "@/components/packs/PackStage";
import { CardReveal } from "@/components/packs/CardReveal";
import { PackHand, type HandSlot } from "@/components/packs/PackHand";
import { PackSummary } from "@/components/packs/PackSummary";
import { getPack as _gp } from "@/data/packs";
import { ICON_PACK, LEGENDARY_IN, MIXED, SIX, ALL_DUP, single, ONE_COMMON, RARE, EPIC, LEGEND, type PlanFixture } from "./fixtures";

const CAT = { cards: CARDS, getCard, getPlayer };
const STD = _gp("estandar")!;
const pack = (id: string): PackDef => getPack(id) ?? STD;

type Scene =
  | { kind: "stage"; note: string; pack: string; stage: StageKind; plan?: PlanFixture; beat?: FrozenBeat; reduced?: boolean }
  | { kind: "reveal"; note: string; pack: string; plan: PlanFixture; index: number; revealed: boolean; armed: boolean; reduced?: boolean }
  | { kind: "summary"; note: string; pack: string; plan: PlanFixture; available: number; reduced?: boolean };

const SCENES: Record<string, Scene> = {
  "01-sealed": { kind: "stage", note: "sobre sellado · Icon (arte oficial)", pack: "icon", stage: "ready" },
  "01b-sealed-oro": { kind: "stage", note: "sobre sellado · Oro", pack: "oro", stage: "ready" },
  "01c-sealed-team": { kind: "stage", note: "sobre sellado · sobre de equipo", pack: "team-heretics", stage: "ready" },
  "01d-sealed-procedural": { kind: "stage", note: "sobre sin arte (procedimental)", pack: "team-loud", stage: "ready" },
  "02-anticipation": { kind: "stage", note: "anticipación: petición enviada, sin rareza", pack: "icon", stage: "requesting" },
  "03-tearing": { kind: "stage", note: "apertura: la solapa del propio arte se rasga", pack: "icon", stage: "opening", plan: ICON_PACK, beat: "tear" },
  "04-emerging": { kind: "stage", note: "las cartas salen del sobre", pack: "icon", stage: "opening", plan: ICON_PACK, beat: "emerge" },
  "05-face-down": { kind: "stage", note: "cartas boca abajo (legendarias: corona)", pack: "icon", stage: "hand", plan: ICON_PACK },
  "05b-face-down-6": { kind: "stage", note: "cartas boca abajo · otro tamaño de sobre", pack: "premium", stage: "hand", plan: SIX },
  "06a-idle": { kind: "reveal", note: "carta boca abajo esperando el gesto", pack: "icon", plan: ICON_PACK, index: 0, revealed: false, armed: false },
  "06-reveal-common": { kind: "reveal", note: "común revelada", pack: "estandar", plan: ONE_COMMON, index: 0, revealed: true, armed: true },
  "07-reveal-rare": { kind: "reveal", note: "rara revelada", pack: "premium", plan: single(RARE), index: 0, revealed: true, armed: true },
  "08a-epic-charging": { kind: "reveal", note: "épica: anticipación (sala a oscuras, energía)", pack: "oro", plan: single(EPIC), index: 0, revealed: false, armed: true },
  "08-reveal-epic": { kind: "reveal", note: "épica revelada", pack: "oro", plan: single(EPIC), index: 0, revealed: true, armed: true },
  "09a-max-charging": { kind: "reveal", note: "legendaria: anticipación máxima", pack: "icon", plan: single(LEGEND), index: 0, revealed: false, armed: true },
  "09-reveal-max": { kind: "reveal", note: "legendaria revelada (momento máximo)", pack: "icon", plan: single(LEGEND), index: 0, revealed: true, armed: true },
  "10-summary": { kind: "summary", note: "resultado del sobre · quedan 2", pack: "icon", plan: ICON_PACK, available: 2 },
  "11-duplicate": { kind: "reveal", note: "duplicada ×3", pack: "estandar", plan: MIXED, index: 0, revealed: true, armed: true },
  "11b-summary-duplicates": { kind: "summary", note: "resumen con duplicadas", pack: "estandar", plan: ALL_DUP, available: 0 },
  "13-reduced-sealed": { kind: "stage", note: "movimiento reducido · sellado", pack: "icon", stage: "ready", reduced: true },
  "13b-reduced-hand": { kind: "stage", note: "movimiento reducido · boca abajo", pack: "icon", stage: "hand", plan: ICON_PACK, reduced: true },
  "13c-reduced-reveal": { kind: "reveal", note: "movimiento reducido · legendaria", pack: "icon", plan: single(LEGEND), index: 0, revealed: true, armed: true, reduced: true },
};

export default function Fase57QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "01-sealed"); }, []);
  if (scene === null) return null;
  const s = SCENES[scene];
  if (!s) return <p className="p-6 text-caption text-ink-muted">Escenas: {Object.keys(SCENES).join(", ")}</p>;
  return (
    <div data-scene={scene}>
      <View s={s} />
      <p className="pointer-events-none fixed bottom-2 left-2 max-w-[70vw] border border-drl-gold/30 bg-black/80 px-2 py-0.5 text-[10px] text-drl-gold/90" style={{ zIndex: 2147483000 }} data-synthetic="true">
        QA SYNTHETIC · Fase 57 · {s.note}
      </p>
    </div>
  );
}

function View({ s }: { s: Scene }) {
  const p = pack(s.pack);
  const accent = p.accent ?? "#ff2e63";
  const plan: RevealPlan | null = useMemo(() => {
    const f = s.kind === "stage" ? s.plan : s.plan;
    return f ? buildRevealPlan(f.opened, f.before, CAT, { reduced: !!s.reduced }) : null;
  }, [s]);
  const reduced = !!s.reduced;

  if (s.kind === "summary") {
    return (
      <div className="fixed inset-0 z-modal overflow-y-auto bg-[#03040a] px-4 py-8">
        <PackBackdrop accent={accent} ambient={false} reduced={reduced} intensity={0.45} />
        <div className="relative"><PackSummary packName={p.name} plan={plan!} available={s.available} packsLeft={s.available + 1} reduced={reduced} onOpenAnother={() => {}} onNavigate={() => {}} onAddToDeck={() => {}} /></div>
      </div>
    );
  }

  const results: OpenedResult[] = (plan?.items ?? []).map((it) => ({ uid: it.uid, card: it.card, serial: it.serial ?? undefined, isNew: it.status === "new" }) as OpenedResult);

  if (s.kind === "stage") {
    const best = plan?.summary.featured;
    const tease: PackTease | null = plan?.summary.bestRarity && best
      ? { color: getVariant(best.card.variantId).palette.primary, level: rarityRank(plan.summary.bestRarity) >= 3 ? "high" : rarityRank(plan.summary.bestRarity) === 2 ? "mid" : "low", rays: plan.summary.bestRarity === "legendary" }
      : null;
    const slots: HandSlot[] = results.map(() => ({ revealed: false }));
    return (
      <div className="fixed inset-0 z-modal overflow-hidden bg-[#03040a]" data-testid="pack-opening" data-phase={s.stage}>
        <PackBackdrop accent={accent} ambient={s.stage === "ready" || s.stage === "requesting"} reduced={reduced} intensity={s.stage === "ready" ? 0.6 : 1} />
        <PackStage pack={p} stage={s.stage} count={results.length || p.cardCount} slots={slots} tease={s.stage === "hand" ? tease : null} reduced={reduced}
          onOpen={() => {}} onStartReveal={() => {}} onRevealAll={() => {}} freeze={s.stage === "opening"} frozenBeat={s.beat} />
      </div>
    );
  }

  const r = results[s.index];
  const slots: HandSlot[] = results.map((x, i) => ({ revealed: i < s.index || (i === s.index && s.revealed), color: getVariant(x.card.variantId).palette.primary }));
  return (
    <div className="fixed inset-0 z-modal overflow-hidden bg-[#03040a]" data-testid="pack-opening" data-phase="reveal">
      <PackBackdrop accent={accent} ambient={false} reduced={reduced} intensity={0.45} />
      <CardReveal result={r} item={plan!.items[s.index]} index={s.index} total={results.length} isLast={s.index === results.length - 1}
        onNext={() => {}} revealed={s.revealed} armed={s.armed} onShown={() => {}} reducedOverride={reduced} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-surface flex flex-col items-center gap-2 pb-5">
        {/* Fase 57.3 · igual que la ceremonia real: con una sola carta no hay tira ni contador. */}
        {results.length > 1 && (<>
          <PackHand slots={slots} accent={accent} mode="strip" activeIndex={s.index} />
          <span className="nx-readout text-label uppercase tracking-wide2 text-ink-faint">{s.index + 1} / {results.length}</span>
        </>)}
      </div>
    </div>
  );
}
