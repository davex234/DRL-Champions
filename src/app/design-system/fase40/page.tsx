"use client";

/**
 * ARNÉS QA · FASE 40 — `/design-system/fase40?scene=<escena>` (solo capturas y revisión).
 *
 * PLAYER JOURNEY sobre las pantallas REALES: vestíbulo (`DailyLobby` + `buildDailyLoop`), colección
 * (`CollectionRoomScreen`), constructor (`DeckBuilder`, `TeamHub`), pre-partida (`PreMatch` + coach) y resultado
 * (`ResultScreen` con partidas del motor puro). Hechos de cuenta QA SYNTHETIC (`./fixtures`). Sin sesión, sin red, sin BD.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { CollectionRoomScreen } from "@/components/collectionRoom/CollectionRoomScreen";
import { aliasesFrom, roomEngine, teamIndexOf, teamOptionsOf, type CollectionRoomModel } from "@/components/collectionRoom/roomModel";
import { DeckBuilder, type SaveOutcome } from "@/components/duel/DeckBuilder";
import { TeamHub } from "@/components/duel/deck/TeamHub";
import { PreMatch } from "@/components/duel/PreMatch";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { Toast } from "@/components/ui/Toast";
import { FirstMatchCoach } from "@/components/journey/FirstMatchCoach";
import { JourneyDiscovery } from "@/components/journey/JourneyDiscovery";
import { CARDS, getPlayer } from "@/data/catalog";
import { buildDailyLoop } from "@/domain/dailyLoop";
import { buildCollectionSnapshot } from "@/domain/collection/room";
import { DEFAULT_QUERY, type CollectionQuery } from "@/domain/collection/query";
import { DISCOVERY } from "@/domain/journey";
import { welcomeCards } from "@/lib/journey/presentation";
import { AUTO_ACTIVATED_NOTICE } from "@/lib/journey/deck";
import { qaFindMatch, qaView } from "@/lib/duel/qaSimulation";
import type { DuelMatchView, DuelResultView } from "@/lib/duel/types";
import { COLLECTION, DECK_FULL, PARTIAL_UIDS, deckDto } from "../fase32/fixtures";
import { FASE40_SCENES, SCENES, type CollectionScene, type HomeScene, type ResultScene } from "./fixtures";

const noop = () => {};

export default function Fase40QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "welcome"); }, []);
  useEffect(() => {
    if (scene !== "keyboard") return;
    const id = window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="journey-primary-cta"]')?.focus(), 900);
    return () => window.clearTimeout(id);
  }, [scene]);
  useEffect(() => {
    if (scene !== "deck-autocomplete") return;
    const id = window.setTimeout(() => {
      const b = document.querySelector<HTMLButtonElement>('[data-testid="autocomplete"]');
      b?.click();
      window.setTimeout(() => document.querySelector('[data-testid="autocomplete-result"]')?.scrollIntoView({ block: "center" }), 300);
    }, 900);
    return () => window.clearTimeout(id);
  }, [scene]);
  if (scene === null) return null;
  if (!(FASE40_SCENES as readonly string[]).includes(scene)) {
    return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {FASE40_SCENES.join(", ")}</p>;
  }
  const s = SCENES[scene as keyof typeof SCENES];
  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-3" data-scene={scene}>
        <p className="border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-1 text-[11px] text-drl-gold/90" data-synthetic="true">
          QA SYNTHETIC · {s.note} · pantallas y dominio reales, hechos de cuenta inventados
        </p>
        {s.kind === "home" && <Home s={s} />}
        {s.kind === "collection" && <Collection s={s} />}
        {s.kind === "builder" && <Builder partial={s.partial} />}
        {s.kind === "team-hub" && <Hub />}
        {s.kind === "prematch" && <Prematch />}
        {s.kind === "result" && <Result s={s} />}
      </div>
    </MotionConfig>
  );
}

function Home({ s }: { s: HomeScene }) {
  const [dismissed, setDismissed] = useState(!!s.dismissed);
  const snap = useMemo(() => buildDailyLoop(s.facts), [s]);
  const cards = useMemo(() => welcomeCards(CARDS, getPlayer), []);
  return (
    <DailyLobby snap={snap} now={s.facts.now} network={s.network ?? "online"} journeyDismissed={dismissed}
      onJourneyDismiss={() => setDismissed(true)} onJourneyResume={() => setDismissed(false)} welcomeCards={cards} />
  );
}

function Collection({ s }: { s: CollectionScene }) {
  const [query, setQuery] = useState<CollectionQuery>(DEFAULT_QUERY);
  const room = useMemo<CollectionRoomModel>(() => {
    const snap = buildCollectionSnapshot(CARDS, getPlayer, s.facts);
    const index = teamIndexOf(CARDS);
    return { access: "server", loading: false, offline: false, stale: false, snap, engine: roomEngine(s.facts.instances, snap.favorites), teamOptions: teamOptionsOf(index), aliasesOf: aliasesFrom(index) };
  }, [s]);
  return <CollectionRoomScreen room={room} query={query} onQuery={setQuery} onOpen={noop} packs={s.packs} forge={<p className="text-caption text-ink-muted">Forja: pieza existente, fuera del arnés.</p>} />;
}

function Builder({ partial }: { partial: boolean }) {
  const save = async (draft: { name: string; cardUids: string[] }): Promise<SaveOutcome> => ({ ok: true, deck: deckDto(40, draft.name, draft.cardUids) });
  return (
    <DeckBuilder deck={null} collection={COLLECTION} activeSupported defaultName="Equipo 1" unopenedPacks={0} firstTeam
      onSave={save} onExit={noop} initial={partial ? { uids: PARTIAL_UIDS } : undefined} />
  );
}

function Hub() {
  return (
    <>
      <Toast toast={{ id: 1, msg: AUTO_ACTIVATED_NOTICE, ok: true }} />
      <TeamHub decks={[DECK_FULL]} activeDeckId={DECK_FULL.id} activeSupported maxDecks={8} collectionCount={COLLECTION.length} unopenedPacks={0}
        now={Date.UTC(2026, 8, 16, 12)} busyId={null} onCreate={noop} onEdit={noop} onActivate={noop} onDuplicate={noop} onRename={noop} onDelete={noop} />
    </>
  );
}

function Prematch() {
  const [difficulty, setDifficulty] = useState<"EASY" | "NORMAL" | "HARD">("EASY");
  return <PreMatch decks={[DECK_FULL]} deckId={DECK_FULL.id} onDeck={noop} difficulty={difficulty} onDifficulty={setDifficulty} onStart={noop} busy={false} error={null} onHelp={noop} activeDeckId={DECK_FULL.id} intro={<FirstMatchCoach onHelp={noop} />} />;
}

const withResult = (v: DuelMatchView, r: Partial<DuelResultView>): DuelMatchView => ({ ...v, result: { ...v.result!, ...r } });

function Result({ s }: { s: ResultScene }) {
  const view = useMemo(() => {
    const win = qaFindMatch((m) => m.result?.winner === "A" && m.result.combat.decidedBy === "SCORE");
    const loss = qaFindMatch((m) => m.result?.winner === "B" && m.result.combat.decidedBy === "SCORE");
    const base = qaView((win ?? loss)!);
    if (s.outcome === "win" && win) return qaView(win);
    if (s.outcome === "loss" && loss) return qaView(loss);
    return withResult(base, { decidedBy: "NONE", winner: null, isDraw: true, scoreYou: 5, scoreRival: 5, sumOvrYou: 845, sumOvrRival: 845, statTotalYou: 800, statTotalRival: 800, reason: "QA SYNTHETIC · empate fabricado" });
  }, [s]);
  return (
    <ResultScreen view={view} xp={60} onPlayAgain={noop} onChange={noop} onDecks={noop} onReplay={noop}
      extra={<JourneyDiscovery items={[...DISCOVERY]} className="mt-3" />} />
  );
}
