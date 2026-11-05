"use client";

/**
 * ARNÉS QA · FASE 41 — `/design-system/fase41?scene=<escena>` (solo capturas y revisión).
 *
 * ECONOMÍA sobre piezas REALES: ficha de sobre (`PackPurchaseCta` + `starterOffer`, lo mismo que `/packs/[packId]`),
 * aviso de tienda de prueba cerrada, resultado (`ResultScreen` con la presentación de recompensa), objetivos
 * (`ObjectiveList`) y vestíbulo con el recorrido (`DailyLobby`). Hechos de cuenta QA SYNTHETIC. Sin sesión, sin red.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { SealedPack } from "@/components/packs/SealedPack";
import { Readout } from "@/components/ui/Readout";
import { PackPurchaseCta } from "@/components/economy/PackPurchaseCta";
import { CreditsClosedNotice } from "@/components/economy/CreditsClosedNotice";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { ObjectiveList } from "@/components/progression/ObjectiveList";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { getPack } from "@/data/packs";
import { CARDS, getPlayer } from "@/data/catalog";
import { ctaKindFor } from "@/components/packs/packCatalog";
import { starterOffer } from "@/lib/economy/starterOffer";
import { buildDailyLoop } from "@/domain/dailyLoop";
import { welcomeCards } from "@/lib/journey/presentation";
import { formatCredits } from "@/lib/format";
import { CURRENCY_NAME } from "@/domain/economy/drlCredits";
import { qaFindMatch, qaView } from "@/lib/duel/qaSimulation";
import { FASE41_SCENES, SCENES, type HomeScene, type ObjectivesScene, type PackScene, type RewardScene } from "./fixtures";

const noop = () => {};

export default function Fase41QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "starter-claim"); }, []);
  if (scene === null) return null;
  if (!(FASE41_SCENES as readonly string[]).includes(scene)) {
    return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {FASE41_SCENES.join(", ")}</p>;
  }
  const s = SCENES[scene as keyof typeof SCENES];
  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-3" data-scene={scene}>
        <p className="border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-1 text-[11px] text-drl-gold/90" data-synthetic="true">
          QA SYNTHETIC · {s.note} · piezas reales, hechos de cuenta inventados
        </p>
        {s.kind === "pack" && <Pack s={s} />}
        {s.kind === "credits" && <div className="mx-auto max-w-3xl px-4"><CreditsClosedNotice currency={CURRENCY_NAME} /></div>}
        {s.kind === "reward" && <Reward s={s} />}
        {s.kind === "objectives" && <Objectives s={s} />}
        {s.kind === "home" && <Home s={s} />}
      </div>
    </MotionConfig>
  );
}

function Pack({ s }: { s: PackScene }) {
  const pack = getPack(s.packId)!;
  const offer = pack.id === "inicial" ? starterOffer({ owned: s.owned, online: s.online, status: s.status }) : null;
  useEffect(() => {
    if (!s.focus) return;
    const id = window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="pack-cta"] button')?.focus(), 600);
    return () => window.clearTimeout(id);
  }, [s.focus]);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="grid gap-6 md:grid-cols-[minmax(0,300px)_1fr] md:gap-10">
        <div className="flex items-start justify-center"><SealedPack pack={pack} cutProgress={0} width={240} /></div>
        <div className="flex flex-col">
          <h1 className="font-display text-3xl font-bold uppercase leading-none text-white">{pack.name}</h1>
          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <Readout size="md" label="Precio" value={offer ? offer.priceLabel : pack.price <= 0 ? "Gratis" : formatCredits(pack.price)} unit={pack.price <= 0 ? undefined : "créditos"} tone={offer && offer.priceLabel !== "Gratis" ? undefined : pack.price <= 0 ? "var(--nx-ok)" : "var(--nx-gold)"} />
            <Readout size="sm" label="Contiene" value={pack.cardCount} unit="cartas" />
            <Readout size="sm" label="Tu saldo" value={formatCredits(s.credits)} unit="créditos" />
          </div>
          <PackPurchaseCta pack={pack} cta={ctaKindFor(pack)} credits={s.credits} owned={s.owned} offer={offer} busy={false} onAction={noop} />
        </div>
      </div>
    </div>
  );
}

function Reward({ s }: { s: RewardScene }) {
  const view = useMemo(() => {
    const m = qaFindMatch((x) => x.result?.winner === "A" && x.result.combat.decidedBy === "SCORE") ?? qaFindMatch(() => true)!;
    const v = qaView(m);
    return { ...v, result: { ...v.result!, award: s.award ?? undefined } } as typeof v;
  }, [s]);
  return <ResultScreen view={view} xp={s.award?.xp ?? 0} mode={s.mode} onPlayAgain={noop} onChange={noop} onDecks={noop} onReplay={noop} />;
}

function Objectives({ s }: { s: ObjectivesScene }) {
  return <div className="mx-auto max-w-5xl px-4 py-4"><ObjectiveList objectives={s.objectives} now={Date.UTC(2026, 8, 16, 12)} /></div>;
}

function Home({ s }: { s: HomeScene }) {
  const snap = useMemo(() => buildDailyLoop(s.facts), [s]);
  const cards = useMemo(() => welcomeCards(CARDS, getPlayer), []);
  return <DailyLobby snap={snap} now={s.facts.now} network={s.network ?? "online"} journeyDismissed={false} onJourneyDismiss={noop} onJourneyResume={noop} welcomeCards={cards} />;
}
