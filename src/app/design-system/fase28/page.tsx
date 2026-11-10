"use client";

/**
 * ARNÉS QA · FASE 28 — `/design-system/fase28?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES del competitivo (`CompetitiveHub`, `Leaderboard`, `MatchDetailView`,
 * `PlayerProfile`, `PvpOutcome`, `PvpLobby`) con snapshots **QA SYNTHETIC** (`./fixtures`): jugadores,
 * ratings y partidas inventados; el detalle de partida usa una partida simulada con el MOTOR real
 * y proyectada con `projectMatchFor` + `buildMatchView`, como hace el servidor. Sin sesión, sin red.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import { createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList, DUEL_ROLES, type DuelDeckSnapshot } from "@/domain/cardgame";
import { startDuelMatch, confirmTurn, type DuelMatch } from "@/domain/cardgame/match";
import { createRng, createController, advanceBots, createDuelBot } from "@/domain/cardgame/opponent";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { buildMatchView } from "@/lib/duel/matchView";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { ErrorState } from "@/components/ui/States";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { CompetitiveHub } from "@/components/competitive/CompetitiveHub";
import { CompetitiveHero } from "@/components/competitive/CompetitiveHero";
import { Leaderboard } from "@/components/competitive/Leaderboard";
import { MatchHistoryList } from "@/components/competitive/MatchHistoryList";
import { MatchDetailView } from "@/components/competitive/MatchDetailView";
import { PlayerProfile } from "@/components/competitive/PlayerProfile";
import { RatingChart } from "@/components/competitive/RatingChart";
import { CompetitiveRewards } from "@/components/competitive/CompetitiveRewards";
import { CompetitiveSummaryCard } from "@/components/competitive/CompetitiveSummary";
import { PvpOutcome } from "@/components/duel/pvp/PvpOutcome";
import { PvpLobby } from "@/components/duel/pvp/PvpLobby";
import { RANKED, TOP10, PROVISIONAL, NEW_PLAYER, SMALL_POP, SAME_RATING, SOLO, PLAYER_VIEW, ROWS_FULL, detailFrom, QA_NOW } from "./fixtures";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

function snapshotDeck(block: number, id: string, name: string): DuelDeckSnapshot | null {
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const role of DUEL_ROLES) {
    const best = new Map<string, (typeof CARDS)[number]>();
    for (const c of registry.forRole(role)) { if (!c.combat) continue; const prev = best.get(c.playerId); if (!prev || c.ovr > prev.ovr) best.set(c.playerId, c); }
    byRole.set(role, [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)));
  }
  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  return v.valid ? takeDeckSnapshot(deck, v, NOW) : null;
}

function simulate(mine: DuelDeckSnapshot, rival: DuelDeckSnapshot, turns: number, seed: number): DuelMatch {
  const start = startDuelMatch({ id: `qa-${seed}`, snapshotA: mine, snapshotB: rival, firstAttacker: "A" });
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
  return m;
}

const SCENES = [
  "hub", "hub-top10", "hub-provisional", "hub-new", "hub-small", "hub-same-rating", "hub-solo", "hero", "leaderboard", "around-me",
  "history", "history-empty", "match-detail", "match-detail-timeout", "player-profile", "rating-up", "rating-down", "rating-draw",
  "post-match", "post-match-unranked", "rewards", "rewards-locked", "matchmaking", "reconnect", "backend-error", "summary",
] as const;

export default function Fase28QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);

  // Una partida terminada real (motor) proyectada para el bando A: lo no jugado del rival no viaja.
  const finished = useMemo(() => {
    const mine = snapshotDeck(0, "qa-mine", "QA SYNTHETIC · Mi equipo");
    const rival = snapshotDeck(1, "qa-rival", "QA SYNTHETIC · Rival");
    if (!mine || !rival) return null;
    const full = simulate(mine, rival, 10, 5);
    const partial = simulate(mine, rival, 4, 9);
    const opts = { side: "A" as const, registry, difficulty: "NORMAL" as const };
    return { full: buildMatchView(projectMatchFor(full, "A"), opts), partial: buildMatchView(projectMatchFor(partial, "A"), opts) };
  }, []);

  const noop = () => {};
  const lastUp = RANKED.ratingSeries[RANKED.ratingSeries.length - 1];

  const body = () => {
    switch (scene) {
      case "hub": return <CompetitiveHub snap={RANKED} />;
      case "hub-top10": return <CompetitiveHub snap={TOP10} />;
      case "hub-provisional": return <CompetitiveHub snap={PROVISIONAL} />;
      case "hub-new": return <CompetitiveHub snap={NEW_PLAYER} />;
      case "hub-small": return <CompetitiveHub snap={SMALL_POP} />;
      case "hub-same-rating": return <Leaderboard title="Top 10 · dos jugadores con el mismo rating (empate estable)" entries={SAME_RATING.leaderboardTop} />;
      case "hub-solo": return <CompetitiveHub snap={SOLO} />;
      case "hero": return <CompetitiveHero self={RANKED.self} stats={RANKED.stats} last={lastUp} />;
      case "leaderboard": return <Leaderboard title="Top 25" entries={TOP10.leaderboardTop} caption="500 jugadores clasificados" />;
      case "around-me": return <Leaderboard title="Alrededor de ti" entries={RANKED.aroundMe} caption="#121 – #127" />;
      case "history": return <MatchHistoryList matches={ROWS_FULL.slice(0, 10)} hasMore onMore={noop} />;
      case "history-empty": return <MatchHistoryList matches={[]} />;
      case "match-detail": return finished ? <MatchDetailView detail={detailFrom(finished.full, finished.full.result?.winner === "YOU" ? "WIN" : finished.full.result?.isDraw ? "DRAW" : "LOSS", finished.full.result?.winner === "YOU" ? 18 : -12)} /> : null;
      case "match-detail-timeout": return finished ? <MatchDetailView detail={detailFrom(finished.partial, "TIMEOUT_WIN", 15)} /> : null;
      case "player-profile": return <PlayerProfile view={PLAYER_VIEW} isSelf={false} />;
      case "rating-up": return <RatingChart points={RANKED.ratingSeries} />;
      case "rating-down": return <RatingChart points={RANKED.ratingSeries.map((p, i) => ({ ...p, rating: 1240 - i * 9, delta: i === 0 ? 0 : -9 }))} />;
      case "rating-draw": return <RatingChart points={RANKED.ratingSeries.slice(0, 1)} />;
      case "post-match": return finished ? (
        <PvpOutcome verdict="WIN" lifecycle="FINISHED" view={finished.full} rating={1219}
          outcome={{ matchId: "qa", oldRating: 1201, delta: 18, newRating: 1219, opponentRating: 1246, kFactor: 24, result: "WIN", createdAt: QA_NOW }}
          ladder={{ before: { position: 182 }, after: { position: 169, rankedTotal: 500 }, positions: 13 }} onAgain={noop} onBack={noop} />
      ) : null;
      case "post-match-unranked": return finished ? (
        <PvpOutcome verdict="LOSS" lifecycle="EXPIRED" view={finished.partial} rating={988} outcome={null}
          ladder={{ before: null, after: { position: 212, rankedTotal: 500 }, positions: null }} onAgain={noop} onBack={noop} />
      ) : null;
      case "rewards": return <CompetitiveRewards rewards={TOP10.rewards} />;
      case "rewards-locked": return <CompetitiveRewards rewards={RANKED.rewards} />;
      case "matchmaking": return <PvpLobby decks={[]} deckId={null} onDeck={noop} onSearch={noop} onCancel={noop} onDecks={noop} searching waitingSeconds={37} position={1} rating={1201} busy={false} />;
      case "reconnect": return <div className="max-w-xl"><ErrorState message="Rival encontrado · preparando la arena… (la partida se reconstruye desde el servidor)" onRetry={noop} /></div>;
      case "backend-error": return <ErrorState message="No se pudo leer el competitivo" onRetry={noop} />;
      case "summary": return <div className="max-w-2xl"><CompetitiveSummaryCard self={RANKED.self} stats={RANKED.stats} /></div>;
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase28?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-5xl px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 28 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">jugadores, ratings y partidas inventados · motor real en el detalle · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
