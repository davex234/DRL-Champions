"use client";

/**
 * ARNÉS QA · FASE 45 — `/design-system/fase45?scene=<escena>` · MATCH EXPERIENCE (solo revisión y capturas).
 *
 * Monta las piezas REALES del camino de jugar —selector de modos, preparación, intro, mesa, enfrentamiento, golpe
 * final y resultado— sobre partidas del MOTOR PURO. Nada se escribe ni se envía, y ninguna regla se evalúa aquí: los
 * veredictos, los ejes y las cifras llegan ya resueltos en la vista.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MotionConfig } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { GameEnvironment } from "@/components/visual/GameEnvironment";
import { GameModesHub } from "@/components/modes/GameModesHub";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { MatchIntro } from "@/components/duel/MatchIntro";
import { MatchComplete } from "@/components/duel/MatchComplete";
import { DuelMoment } from "@/components/duel/DuelMoment";
import { PreMatch } from "@/components/duel/PreMatch";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { TurnHistory } from "@/components/duel/TurnHistory";
import { MatchHud, TurnTimeline } from "@/components/duel/experience/MatchHud";
import { PreMatchVersus } from "@/components/duel/experience/PreMatchVersus";
import { ClashBanner } from "@/components/duel/arena/ClashBanner";
import { RatingDelta } from "@/components/duel/pvp/PvpOutcome";
import { CampaignResultBanner } from "@/components/campaign/CampaignResultBanner";
import { DraftResultBanner } from "@/components/draft/DraftResultBanner";
import { gameModes, type ModeFacts } from "@/lib/campaign/presentation";
import { draftResultCopy } from "@/lib/draft/presentation";
import { resultCopy } from "@/lib/campaign/presentation";
import { campaignSnap, PROGRESS } from "../fase35/fixtures";
import { fase45Fixtures, FASE45_SCENES, SECTIONS_45, withResult, type Fase45Fixtures, type Fase45Scene } from "./fixtures";
import type { RatingEvent } from "@/domain/cardgame/rating";
import type { DuelMatchView } from "@/lib/duel/types";

const noop = () => {};
const NOW = 1_700_000_000_000;

const FACTS: ModeFacts = {
  signedIn: true, hasValidDeck: true, activePve: false, activePvp: false, rankedProvisional: true,
  campaign: { available: true, completed: 2, total: 15, complete: false, nextName: "Lectura de mapa", chapter: "Capítulo 1" },
  draft: { available: true, status: null, pick: 0, stage: 0, lastStatus: null },
};

const RATING = (delta: number): RatingEvent => ({
  matchId: "qa-pvp", oldRating: 1201, delta, newRating: 1201 + delta, opponentRating: 1246, kFactor: 24,
  result: delta > 0 ? "WIN" : delta < 0 ? "LOSS" : "DRAW", createdAt: NOW,
});

export default function Fase45QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  const fx = useMemo(() => fase45Fixtures(), []);
  if (scene === null) return null;
  if (!scene) return <Index />;
  const s = FASE45_SCENES.find((x) => x.id === scene);
  if (!s) return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {FASE45_SCENES.map((x) => x.id).join(", ")}</p>;
  return (
    <MotionConfig reducedMotion={s.reduced ? "always" : "user"}>
      <div className="space-y-3" data-scene={s.id} data-section={s.section} data-narrow={s.narrow ? "true" : "false"}>
        <GameEnvironment variant="match" />
        <p className="nx-clip-sm inline-block border border-drl-gold/30 bg-black/45 px-3 py-1.5 text-[12px] text-drl-gold/90" data-synthetic="true">
          QA SYNTHETIC · {s.section} · {s.note}
        </p>
        <div className={s.narrow ? "mx-auto w-[390px] max-w-full" : ""}>
          <Scene s={s} fx={fx} />
        </div>
      </div>
    </MotionConfig>
  );
}

function Index() {
  return (
    <div className="space-y-6" data-testid="fase45-index">
      <header>
        <p className="nx-label text-drl">Arnés QA · Fase 45</p>
        <h1 className="font-display text-[44px] font-bold uppercase leading-none text-white">Match Experience</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-white/60">De pulsar JUGAR a volver a jugar: selector, preparación, intro, arena, turno, golpe final y resultado. {FASE45_SCENES.length} escenas.</p>
      </header>
      {SECTIONS_45.map((sec) => (
        <section key={sec} aria-labelledby={`sec-${sec}`}>
          <h2 id={`sec-${sec}`} className="nx-label mb-2">{sec}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FASE45_SCENES.filter((x) => x.section === sec).map((x) => (
              <li key={x.id}>
                <Link href={`/design-system/fase45?scene=${x.id}`} className="nx-clip-sm block min-h-[56px] border border-white/10 bg-black/30 px-3 py-2 hover:border-white/30">
                  <b className="block font-display text-[15px] uppercase text-white">{x.id}</b>
                  <span className="block text-[12.5px] text-white/55">{x.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** La mesa con una vista dada (las escenas de arena solo cambian la vista y los cerrojos). */
function Board({ view, busy = false, waiting = false, revealing = false }: { view: DuelMatchView; busy?: boolean; waiting?: boolean; revealing?: boolean }) {
  return <MatchBoard view={view} onPlay={noop} busy={busy} error={null} onDismissError={noop} waitingRival={waiting} revealing={revealing} />;
}

function Result({ view, xp = 4_200, mode = "PVE", extra = null }: { view: DuelMatchView; xp?: number | null; mode?: "PVE" | "PVP" | "DRAFT_GAUNTLET"; extra?: React.ReactNode }) {
  return (
    <ResultScreen
      view={view} xp={xp} onPlayAgain={noop} onDecks={noop} onReplay={noop}
      mode={mode} deckId={mode === "DRAFT_GAUNTLET" ? null : "qa-listo"} extra={extra}
    />
  );
}

/** La revelación de un turno con sus dos cartas REALES (se buscan en la vista por uid). */
function Moment({ view, turn }: { view: DuelMatchView; turn: NonNullable<Fase45Fixtures["winTurn"]> }) {
  const find = (uid: string) => [...view.yourHand, ...view.yourUsed, ...view.rivalUsed].find((c) => c.uid === uid) ?? null;
  const you = find(turn.you.uid);
  const rival = find(turn.rival.uid);
  if (!you || !rival) return <p className="text-caption text-ink-muted">QA SYNTHETIC · esta semilla no trae las dos cartas del turno.</p>;
  return <DuelMoment turn={turn} yourCard={you} rivalCard={rival} onClose={noop} />;
}

function Hub({ facts }: { facts: ModeFacts }) {
  return <GameModesHub cards={gameModes(facts)} rtcProgress={facts.signedIn ? { completed: 2, total: 15 } : null} offline={false} />;
}

function Scene({ s, fx }: { s: Fase45Scene; fx: ReturnType<typeof fase45Fixtures> }) {
  const deck = fx.decks[0];
  switch (s.id) {
    /* ── PLAY HUB ── */
    case "hub": return <Hub facts={FACTS} />;
    case "hub-resume": return <Hub facts={{ ...FACTS, activePve: true }} />;
    case "hub-no-deck": return <Hub facts={{ ...FACTS, hasValidDeck: false }} />;
    case "hub-signed-out": return <Hub facts={{ ...FACTS, signedIn: false, hasValidDeck: null, campaign: null, draft: null }} />;
    case "hub-offline": return <GameModesHub cards={gameModes(FACTS)} offline />;
    case "hub-campaign-complete": return <Hub facts={{ ...FACTS, campaign: { available: true, completed: 15, total: 15, complete: true, nextName: null, chapter: "Capítulo 3" } }} />;

    /* ── PRE MATCH ── */
    case "prematch": return <PreMatch decks={fx.decks} deckId={deck.id} onDeck={noop} difficulty="NORMAL" onDifficulty={noop} onStart={noop} busy={false} error={null} activeDeckId={deck.id} />;
    case "prematch-first": return <PreMatch decks={fx.decks} deckId={deck.id} onDeck={noop} difficulty="EASY" onDifficulty={noop} onStart={noop} busy={false} error={null} activeDeckId={deck.id} />;
    case "prematch-versus": return <PreMatchVersus deck={deck} rival={{ kind: "BOT", label: "Normal" }} />;

    /* ── MATCH INTRO ── */
    case "intro":
    case "intro-reduced":
      return <MatchIntro view={fx.attack} rivalName="Bot · Normal" onDone={noop} />;

    /* ── ARENA ── */
    case "arena-idle": case "arena-attacker-you": case "arena-reduced": case "mobile-arena": return <Board view={fx.attack} />;
    case "arena-defense": case "arena-attacker-rival": return <Board view={fx.defense} />;
    case "arena-mid": return <Board view={fx.mid} />;
    case "arena-selected": return <Board view={fx.imposed} />;
    case "arena-locked": return <Board view={fx.mid} busy />;

    /* ── TURN ── */
    case "turn-win": return fx.winTurn ? <Moment view={fx.win} turn={fx.winTurn} /> : null;
    case "turn-loss": return fx.lossTurn ? <Moment view={fx.loss} turn={fx.lossTurn} /> : null;
    case "turn-tie": return fx.tieTurn ? <Moment view={fx.win} turn={fx.tieTurn} /> : null;
    case "turn-history": return <TurnHistory turns={fx.win.history} />;
    case "turn-timeline": return <TurnTimeline view={fx.mid} rivalName="Bot · Normal" layout="row" />;
    case "turn-detail": return <TurnTimeline view={fx.win} rivalName="Bot · Normal" layout="block" />;

    /* ── CLASH ── */
    case "clash-undeclared": return <ClashBanner youStat={null} youValue={null} rivalStat={null} rivalValue={null} hint="Elige carta y estadística" />;
    case "clash-declared": return <ClashBanner youStat="stronghold" youValue={87} rivalStat={null} rivalValue={null} />;
    case "clash-imposed": return <ClashBanner youStat="gamesense" youValue={74} rivalStat="entryfrag" rivalValue={91} />;
    case "clash-resolved": case "mobile-clash": return <ClashBanner youStat="stronghold" youValue={87} rivalStat="gamesense" rivalValue={82} winner="A" />;
    case "clash-same-axis": return <ClashBanner youStat="entryfrag" youValue={78} rivalStat="entryfrag" rivalValue={84} winner="B" />;

    /* ── SCORE ── */
    case "score-lead": return <MatchHud view={fx.mid} rivalName="Bot · Normal" />;
    case "score-behind": return <MatchHud view={fx.defense} rivalName="Bot · Normal" />;
    case "score-tied": return <MatchHud view={fx.imposed} rivalName="Bot · Normal" />;

    /* ── FINAL TURN ── */
    case "final-turn": return <Board view={fx.t10} />;
    case "match-point": return fx.matchPoint ? <Board view={fx.matchPoint} /> : <Board view={fx.t10} />;

    /* ── WAITING ── */
    case "waiting-rival": return <Board view={fx.pvpPartial} waiting />;
    case "resync": return <Board view={fx.mid} busy />;
    case "offline": return <Board view={fx.mid} busy waiting />;
    case "reconnect": return <Board view={fx.mid} revealing />;

    /* ── MATCH COMPLETE ── */
    case "complete-win": case "complete-reduced": case "mobile-complete": return <MatchComplete result={fx.win.result!} onDone={noop} />;
    case "complete-loss": return <MatchComplete result={fx.loss.result!} onDone={noop} />;
    case "complete-draw": return <MatchComplete result={fx.draw.result!} onDone={noop} />;

    /* ── RESULT ── */
    case "result-win": case "result-reduced": case "mobile-result": return <Result view={fx.win} />;
    case "result-loss": return <Result view={fx.loss} />;
    case "result-draw": return <Result view={fx.draw} />;
    case "result-ovr": return <Result view={fx.ovr} />;
    case "result-history": return <Result view={fx.win} xp={null} />;

    /* ── REWARDS ── */
    case "rewards": return <Result view={fx.win} />;
    case "no-rewards": return <Result view={withResult(fx.loss, { award: null })} />;
    case "level-up": return <Result view={fx.win} xp={11_960} />;

    /* ── RANKED ── */
    case "ranked-win": return <Result view={fx.pvpWin} mode="PVP" />;
    case "ranked-rating-up": return <RatingDelta outcome={RATING(18)} />;
    case "ranked-rating-down": return <RatingDelta outcome={RATING(-14)} />;
    case "ranked-pending": return <p className="text-body text-ink-secondary">Calculando el rating…</p>;

    /* ── CAMPAIGN ── */
    case "campaign-result": case "campaign-loss": {
      const snap = campaignSnap(PROGRESS.mid);
      const node = snap.chapters[0].nodes.find((n) => n.status !== "LOCKED") ?? snap.chapters[0].nodes[0];
      const copy = resultCopy({ outcome: s.id === "campaign-result" ? "WIN" : "LOSS", firstClear: s.id === "campaign-result", wasCompleted: false, chapterClosed: null, campaignComplete: false, credits: node.firstClearCredits, nodeName: node.name });
      return <CampaignResultBanner copy={copy} node={node} next={null} />;
    }

    /* ── DRAFT ── */
    case "draft-result": return <DraftResultBanner copy={draftResultCopy(null, "qa-match")} onBack={noop} />;
    case "draft-economy": return <Result view={fx.win} mode="DRAFT_GAUNTLET" xp={null} />;

    default: return null;
  }
}
