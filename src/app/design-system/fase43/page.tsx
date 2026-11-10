"use client";

/**
 * ARNÉS QA · FASE 43 — `/design-system/fase43?scene=<escena>` (solo capturas y revisión).
 *
 * CARD MASTERY & DECK STRATEGY sobre las piezas REALES: constructor (`DeckBuilder` con laboratorio, foco de carta,
 * vista previa y plantilla por objetivo), comparador de equipos, pre-partida, resultado, lectura por ejes y
 * repetición. Datos QA SYNTHETIC (`./fixtures`): definiciones y motor reales, ejemplares inventados. Sin red, sin BD.
 */
import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { DeckBuilder } from "@/components/duel/DeckBuilder";
import { PreMatch } from "@/components/duel/PreMatch";
import { PreMatchVersus } from "@/components/duel/experience/PreMatchVersus";
import { PreMatchStrategy } from "@/components/duel/strategy/PreMatchStrategy";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { ReplayViewer } from "@/components/duel/ReplayViewer";
import { MatchStrategyPanel } from "@/components/duel/strategy/MatchStrategyPanel";
import { DeckCompareView } from "@/components/duel/strategy/DeckCompareView";
import { FASE43_SCENES, SCENES } from "./fixtures";

const noop = () => {};

export default function Fase43QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "legal-balanced"); }, []);
  if (scene === null) return null;
  if (!(FASE43_SCENES as readonly string[]).includes(scene)) {
    return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {FASE43_SCENES.join(", ")}</p>;
  }
  const s = SCENES[scene as keyof typeof SCENES];
  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-3" data-scene={scene}>
        <p className="border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-1 text-[11px] text-drl-gold/90" data-synthetic="true">
          QA SYNTHETIC · {s.note} · catálogo, validador, análisis y motor reales; ejemplares inventados
        </p>
        {s.kind === "builder" && (
          <DeckBuilder
            deck={s.deck}
            collection={s.collection}
            activeSupported
            defaultName="Equipo QA"
            onSave={async (d) => ({ ok: true, deck: { ...s.deck!, name: d.name, cardUids: d.cardUids } })}
            onExit={noop}
            initial={s.initial}
          />
        )}
        {s.kind === "compare" && (
          <section className="nx-clip mx-auto max-w-3xl border border-white/10 bg-white/[0.03] p-5">
            <h1 className="mb-3 font-display text-h2 font-bold uppercase text-white">Comparar equipos</h1>
            <DeckCompareView decks={s.decks} />
          </section>
        )}
        {s.kind === "prematch" && (s.rival === "BOT" ? (
          <PreMatch decks={s.decks} deckId={s.deckId} onDeck={noop} difficulty={s.difficulty} onDifficulty={noop} onStart={noop} busy={false} error={null} activeDeckId={s.decks[0].id} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            <h1 className="font-display text-h2 font-bold uppercase text-white">Ranked · preparación</h1>
            <PreMatchVersus deck={s.decks[0]} rival={{ kind: "RANKED" }} />
            <PreMatchStrategy cards={s.decks[0].cards} />
          </div>
        ))}
        {s.kind === "result" && (
          <ResultScreen view={s.view} deckId={s.deckId} onPlayAgain={noop} onDecks={noop} onReplay={noop} />
        )}
        {s.kind === "axis" && (
          <div className="mx-auto max-w-4xl"><MatchStrategyPanel history={s.view.history} result={s.view.result} deckId="0000dec4-3000-4000-8000-000000000001" /></div>
        )}
        {s.kind === "replay" && <ReplayViewer replay={s.replay} onBack={noop} />}
      </div>
    </MotionConfig>
  );
}
