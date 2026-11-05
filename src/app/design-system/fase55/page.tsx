"use client";

/**
 * ARNÉS QA · FASE 55 — `/design-system/fase55?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES del Competitivo 4.0 (`RankedCenter`, `RankedSearch`, `RankedMatchFound`, `PvpArena`,
 * `PvpOutcome` + `RankedMovement`, `RecentMatchCards`, `RankedLadder`, `SeasonStrip`, panel ranked de `/temporada`)
 * con datos **QA SYNTHETIC** (`./fixtures`). Las partidas se simulan con el MOTOR real y se proyectan con
 * `projectMatchFor` + `buildMatchView`, como hace el servidor. Sin sesión, sin red, sin tocar la cuenta real.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import { createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList, DUEL_ROLES, type DuelDeckSnapshot } from "@/domain/cardgame";
import { startDuelMatch, confirmTurn, type DuelMatch, type Side } from "@/domain/cardgame/match";
import { createRng, createController, advanceBots, createDuelBot } from "@/domain/cardgame/opponent";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { buildMatchView } from "@/lib/duel/matchView";
import { initialSyncState, type SyncState } from "@/lib/duel/pvpPoller";
import type { DuelMatchView } from "@/lib/duel/types";
import { rankedGate } from "@/domain/pvpLadder/ranked";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { RankedCenter } from "@/components/competitive/ranked/RankedCenter";
import { RecentMatchCards } from "@/components/competitive/ranked/RecentMatchCards";
import { RankedLadder } from "@/components/competitive/ranked/RankedLadder";
import { SeasonStrip } from "@/components/competitive/ranked/SeasonStrip";
import { MatchHistoryList } from "@/components/competitive/MatchHistoryList";
import { CompetitivePanel } from "@/components/season/SeasonPanels";
import { RankedSearch } from "@/components/duel/pvp/RankedSearch";
import { RankedMatchFound } from "@/components/duel/pvp/RankedMatchFound";
import { PvpArena } from "@/components/duel/pvp/PvpArena";
import { PvpOutcome } from "@/components/duel/pvp/PvpOutcome";
import {
  HUB, NEW, PLACEMENT, FIRST, DECK_OK, DECK_OK_2, DECK_BAD, ladderPage, MATCHUP, MOVE_HOLD, MOVE_UP, MOVE_DOWN, MOVE_PLACED, MOVE_ENTERED, HISTORY, QA_NOW,
} from "./fixtures";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

function snapshotDeck(block: number, id: string, name: string): DuelDeckSnapshot | null {
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const role of DUEL_ROLES) {
    const best = new Map<string, (typeof CARDS)[number]>();
    for (const c of registry.forRole(role)) { if (!c.combat) continue; const prev = best.get(c.playerId); if (!prev || c.ovr > prev.ovr) best.set(c.playerId, c); }
    byRole.set(role, [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)));
  }
  // Un jugador puede figurar en dos roles (manda el rol de la CARTA): se evita repetirlo en el mazo.
  const used = new Set<string>();
  const picks = DUEL_ROLES.flatMap((r) => {
    const pool = (byRole.get(r) ?? []).filter((c) => !used.has(c.playerId)).slice(block * 2, block * 2 + 2);
    for (const c of pool) used.add(c.playerId);
    return pool;
  });
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  return v.valid ? takeDeckSnapshot(deck, v, NOW) : null;
}

function simulate(mine: DuelDeckSnapshot, rival: DuelDeckSnapshot, turns: number, first: Side, seed: number, letRivalDeclare = true): DuelMatch {
  const start = startDuelMatch({ id: `qa55-${first}-${turns}-${seed}`, snapshotA: mine, snapshotB: rival, firstAttacker: first });
  if (!start.ok) throw new Error("fixture");
  let m = start.match;
  let rng = { a: createRng(seed), b: createRng(seed + 1) };
  const both = createController({ side: "A", kind: "BOT", id: "you" }, { side: "B", kind: "BOT", id: "bot" });
  const bots = { A: createDuelBot("you", "NORMAL"), B: createDuelBot("bot", "HARD") };
  for (let i = 0; i < turns * 8 && m.turns.length < turns && m.status === "IN_PROGRESS"; i++) {
    const r = advanceBots(m, both, bots, rng.a, rng.b, 1);
    m = r.match; rng = { a: r.rngA, b: r.rngB };
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); if (c.ok) m = c.match; }
  }
  if (letRivalDeclare && m.status === "IN_PROGRESS" && m.attacker === "B" && m.phase === "ATTACKER_CARD") {
    const human = createController({ side: "A", kind: "HUMAN", id: "you" }, { side: "B", kind: "BOT", id: "bot" });
    m = advanceBots(m, human, { B: bots.B }, rng.a, rng.b).match;
  }
  return m;
}

const SCENES = [
  "01-hub", "03-locked", "03b-no-decks", "04-ready", "04b-placement", "05-searching", "05b-searching-long", "06-match-found", "07-match",
  "08-victory", "09-defeat", "10-rating-up", "11-rating-down", "12-promotion", "12b-placed", "12c-entered", "13-history", "14-leaderboard",
  "15-season-integration", "16-first", "17-resume",
] as const;

export default function Fase55QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);

  const fx = useMemo(() => {
    const mine = snapshotDeck(0, "qa-mine", "QA · Ofensiva EMEA");
    const rival = snapshotDeck(1, "qa-rival", "QA · Rival");
    if (!mine || !rival) return null;
    const opts = { side: "A" as const, registry, difficulty: "NORMAL" as const, rivalLabel: MATCHUP.rival.username };
    let win: DuelMatchView | null = null, loss: DuelMatchView | null = null;
    for (let seed = 3; seed < 60 && (!win || !loss); seed++) {
      const v = buildMatchView(projectMatchFor(simulate(mine, rival, 10, seed % 2 ? "A" : "B", seed), "A"), opts);
      if (v.result?.winner === "YOU" && !win) win = v;
      if (v.result?.winner === "RIVAL" && !loss) loss = v;
    }
    const live = simulate(mine, rival, 3, "B", 11);
    const arena: SyncState = {
      ...initialSyncState(), status: "SYNCED", stateVersion: 7, lastSyncedAt: Date.now(),
      snapshot: {
        matchId: MATCHUP.matchId, lifecycle: "IN_TURN", stateVersion: 7, yourSide: "A", expectedSide: "A", isYourTurn: true,
        match: projectMatchFor(live, "A"), turnStartedAt: Date.now() - 9_000, turnDeadlineAt: Date.now() + 81_000,
      },
    };
    return { win, loss, arena };
  }, []);

  const noop = () => {};
  const ready = rankedGate({ signedIn: true, decks: [DECK_OK, DECK_OK_2, DECK_BAD], activeDeckId: DECK_OK.id });
  const invalid = rankedGate({ signedIn: true, decks: [DECK_BAD], activeDeckId: DECK_BAD.id });
  const none = rankedGate({ signedIn: true, decks: [], activeDeckId: null });
  const resume = rankedGate({ signedIn: true, decks: [DECK_OK], activeDeckId: DECK_OK.id, activeMatchId: "resume-ranked" });
  const load = async (o: number) => ladderPage(o);
  const ev = (delta: number, old: number, result: "WIN" | "LOSS" | "DRAW", k = 24) => ({ matchId: "qa", oldRating: old, delta, newRating: old + delta, opponentRating: 1236, kFactor: k, result, createdAt: QA_NOW });
  const outcome = (verdict: "WIN" | "LOSS", view: DuelMatchView | null, delta: number, old: number, movement: typeof MOVE_HOLD, k = 24) => (
    <PvpOutcome verdict={verdict} lifecycle="FINISHED" view={view} rating={old + delta} outcome={ev(delta, old, verdict, k)}
      ladder={{ before: { position: movement.from }, after: { position: movement.to, rankedTotal: 500 }, positions: movement.positions, movement }}
      rivalName={MATCHUP.rival.username} backLabel="Volver a Competitivo" onAgain={noop} onBack={noop} />
  );

  const body = () => {
    switch (scene) {
      case "01-hub": return <RankedCenter snap={HUB} gate={ready} legalDecks={[DECK_OK, DECK_OK_2]} onChooseDeck={noop} loadLadderPage={load} />;
      case "03-locked": return <RankedCenter snap={NEW} gate={invalid} legalDecks={[]} />;
      case "03b-no-decks": return <RankedCenter snap={NEW} gate={none} legalDecks={[]} />;
      case "04-ready": return <RankedCenter snap={NEW} gate={rankedGate({ signedIn: true, decks: [DECK_OK], activeDeckId: DECK_OK.id })} legalDecks={[DECK_OK]} />;
      case "04b-placement": return <RankedCenter snap={PLACEMENT} gate={ready} legalDecks={[DECK_OK, DECK_OK_2]} onChooseDeck={noop} loadLadderPage={load} />;
      case "05-searching": return <RankedSearch waitingSeconds={23} position={0} rating={1201} deckName={DECK_OK.name} busy={false} onCancel={noop} />;
      case "05b-searching-long": return <RankedSearch waitingSeconds={134} position={0} rating={1201} deckName={DECK_OK.name} busy={false} onCancel={noop} />;
      case "06-match-found": return <RankedMatchFound matchup={MATCHUP} deckName={DECK_OK.name} onDone={noop} />;
      case "07-match": return fx ? <PvpArena state={fx.arena} busy={false} error={null} onPlay={noop} onAbandon={noop} onDismissError={noop} mode="PVP" rival={MATCHUP.rival} skipIntro /> : null;
      case "08-victory": return fx ? outcome("WIN", fx.win, 18, 1201, MOVE_HOLD) : null;
      case "09-defeat": return fx ? outcome("LOSS", fx.loss, -14, 1201, MOVE_DOWN) : null;
      case "10-rating-up": return fx ? outcome("WIN", fx.win, 18, 1201, MOVE_HOLD) : null;
      case "11-rating-down": return fx ? outcome("LOSS", fx.loss, -14, 1201, MOVE_DOWN) : null;
      case "12-promotion": return fx ? outcome("WIN", fx.win, 18, 1201, MOVE_UP) : null;
      case "12b-placed": return fx ? outcome("WIN", fx.win, 22, 1071, MOVE_PLACED, 40) : null;
      case "12c-entered": return fx ? outcome("WIN", fx.win, 20, 1000, MOVE_ENTERED, 40) : null;
      case "13-history": return (
        <div className="grid gap-6 lg:grid-cols-2">
          <section><p className="nx-label mb-2">Centro competitivo · últimas partidas</p><RecentMatchCards matches={HISTORY.slice(0, 5)} /></section>
          <section><p className="nx-label mb-2">Historial completo</p><MatchHistoryList matches={HISTORY} hasMore onMore={noop} /></section>
        </div>
      );
      case "14-leaderboard": return <div className="max-w-3xl"><RankedLadder top={HUB.leaderboardTop} rankedTotal={500} selfPosition={124} loadPage={load} /></div>;
      case "15-season-integration": return (
        <div className="space-y-6">
          <section><p className="nx-label mb-2">/competitivo · temporada actual</p><SeasonStrip season={HUB.season} /></section>
          <section className="max-w-2xl"><p className="nx-label mb-2">/temporada · panel ranked → «Ver competitivo»</p>
            <CompetitivePanel competitive={{
              rating: 1201, gamesPlayed: 27, wins: 15, losses: 10, draws: 2, provisional: false, position: 124, rankedTotal: 500,
              inSeason: { games: HUB.season?.record.matches ?? 0, wins: HUB.season?.record.wins ?? 0, losses: HUB.season?.record.losses ?? 0, draws: HUB.season?.record.draws ?? 0, startRating: HUB.season?.record.start ?? null, finalRating: null, highestRating: HUB.season?.record.best ?? null },
              recent: HISTORY.slice(0, 5).filter((m) => m.rating).map((m) => ({ at: m.at, result: m.letter === "W" ? "WIN" : m.letter === "L" ? "LOSS" : "DRAW", delta: m.rating!.delta, newRating: m.rating!.after })),
            }} />
          </section>
        </div>
      );
      case "16-first": return <RankedCenter snap={FIRST} gate={ready} legalDecks={[DECK_OK, DECK_OK_2]} onChooseDeck={noop} loadLadderPage={load} />;
      case "17-resume": return <RankedCenter snap={HUB} gate={resume} legalDecks={[DECK_OK]} resumeHref="/duelos/pvp?match=qa" />;
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase55?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-6xl px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 55 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">jugadores, ratings y partidas inventados · motor real en las partidas · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
