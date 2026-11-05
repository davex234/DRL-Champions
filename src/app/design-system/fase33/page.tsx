"use client";

/**
 * ARNÉS QA · FASE 33 — `/design-system/fase33?scene=<escena>` (solo capturas y revisión).
 *
 * MATCH EXPERIENCE 3.0 sin servidor: las partidas son del MOTOR PURO (`qaSimulation`: dos bots sobre
 * cartas reales del catálogo) y se proyectan con las MISMAS funciones que el servidor (`projectMatchFor`
 * + `buildMatchView`). Se renderizan los componentes REALES de la arena (`MatchBoard`, `MatchHud`,
 * `DuelMoment`, `MatchIntro`, `ResultScreen`, `PvpArena`, `PvpOutcome` + `MatchEndHero`, `ReplayViewer`,
 * `ChallengeSheet`, `MatchDetailView`).
 *
 * Todo es **QA SYNTHETIC**: mazos inventados con cartas reales, jugadores y asientos de rating inventados
 * (etiquetados). Cuando un caso no aparece en las semillas simuladas (p. ej. un empate total), el resultado
 * se FABRICA con la forma exacta de `DuelResultView` y la escena lo dice en pantalla. Nada se escribe ni se
 * envía. Esta página no es una pantalla de juego: importa la simulación a propósito.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import type { DuelMatch } from "@/domain/cardgame/match";
import type { RatingEvent } from "@/domain/cardgame/rating";
import { initialSyncState, type SyncState } from "@/lib/duel/pvpPoller";
import { qaSnapshot, qaSimulate, qaView, qaReplay, qaRegistry } from "@/lib/duel/qaSimulation";
import { toCardDTO } from "@/lib/duel/matchView";
import { turnHeader } from "@/lib/duel/experience";
import type { DuelDeckDTO, DuelMatchView, DuelResultView, DuelTurnView } from "@/lib/duel/types";
import type { DuelDeckSnapshot } from "@/domain/cardgame";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { DuelMoment } from "@/components/duel/DuelMoment";
import { MatchIntro } from "@/components/duel/MatchIntro";
import { PreMatch } from "@/components/duel/PreMatch";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { ReplayViewer } from "@/components/duel/ReplayViewer";
import { PvpArena } from "@/components/duel/pvp/PvpArena";
import { PvpLobby } from "@/components/duel/pvp/PvpLobby";
import { PvpOutcome, type PvpVerdict } from "@/components/duel/pvp/PvpOutcome";
import { PreMatchVersus } from "@/components/duel/experience/PreMatchVersus";
import { ChallengeSheet } from "@/components/social/ChallengeSheet";
import { MatchDetailView } from "@/components/competitive/MatchDetailView";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { detailFrom } from "../fase28/fixtures";
import { RIVAL as FRIEND, PRIVATE_INFO } from "../fase29/fixtures";

const NOW = 1_700_000_000_000;
const noop = () => {};

function deckDTO(s: DuelDeckSnapshot, id: string): DuelDeckDTO {
  const cards = s.cards.map((c) => toCardDTO(c, qaRegistry));
  const roleCounts = { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 };
  for (const c of cards) roleCounts[c.role] += 1;
  return {
    id, name: s.deckName, cardUids: cards.map((c) => c.uid), cards, valid: true, status: "READY_FOR_DUEL", roleCounts,
    missingByRole: { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 }, errors: [],
    sumOvr: cards.reduce((a, c) => a + c.ovr, 0), updatedAt: NOW,
  };
}

const EVENT = (delta: number, kFactor = 24, result: RatingEvent["result"] = delta > 0 ? "WIN" : delta < 0 ? "LOSS" : "DRAW"): RatingEvent => ({
  matchId: "qa-pvp", oldRating: 1201, delta, newRating: 1201 + delta, opponentRating: 1246, kFactor, result, createdAt: NOW,
});

type ErrKind = NonNullable<SyncState["error"]>["kind"];

function pvpState(m: DuelMatch, o: { status?: SyncState["status"]; yourTurn?: boolean; error?: { kind: string; message: string } | null; deadlineIn?: number; mode?: "PVP" | "PVP_PRIVATE" } = {}): SyncState {
  const now = Date.now();
  return {
    ...initialSyncState(),
    status: o.status ?? "SYNCED",
    stateVersion: 7,
    lastSyncedAt: now,
    error: o.error ? { kind: o.error.kind as ErrKind, message: o.error.message } : null,
    snapshot: {
      matchId: "qa-pvp", mode: o.mode ?? "PVP", lifecycle: "IN_TURN", stateVersion: 7, yourSide: "A",
      expectedSide: o.yourTurn ?? false ? "A" : "B", isYourTurn: o.yourTurn ?? false, closedBySide: null,
      match: projectMatchFor(m, "A"), turnStartedAt: now - 12_000, turnDeadlineAt: now + (o.deadlineIn ?? 78_000),
    },
  };
}

/** Resultado FABRICADO (misma forma que el servidor) para casos que las semillas no dan. Se etiqueta. */
function withResult(v: DuelMatchView, r: Partial<DuelResultView>): DuelMatchView {
  return { ...v, result: { ...v.result!, ...r } };
}

export default function Fase33QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  const [deckId, setDeckId] = useState("qa-listo");
  const [difficulty, setDifficulty] = useState<"EASY" | "NORMAL" | "HARD">("NORMAL");

  const fx = useMemo(() => {
    const mine = qaSnapshot(0, "qa-you", "QA SYNTHETIC · Mi equipo");
    const rival = qaSnapshot(1, "qa-rival", "QA SYNTHETIC · Rival");
    const mirror = qaSnapshot(0, "qa-mirror", "QA SYNTHETIC · Espejo");

    const attack = qaView(qaSimulate(mine, rival, 0, "A"));
    const defense = qaView(qaSimulate(mine, rival, 0, "B"));
    const imposed = qaView(qaSimulate(mine, rival, 3, "A", 7));        // turno 4: ataca B y ya declaró
    const midM = qaSimulate(mine, rival, 4, "A", 7);
    const mid = qaView(midM);                                          // turno 5: atacas tú
    const t9 = qaView(qaSimulate(mine, rival, 8, "A", 7));             // turno 9
    const t10 = qaView(qaSimulate(mine, rival, 9, "A", 7));            // turno 10: ataca B, ya declaró

    // Partidas completas del motor: una victoria y una derrota de A; desempates y empate en espejo.
    let winM: DuelMatch | null = null, lossM: DuelMatch | null = null, ovrM: DuelMatch | null = null;
    for (let seed = 1; seed <= 400 && (!winM || !lossM || !ovrM); seed++) {
      const m = qaSimulate(mine, rival, 10, seed % 2 ? "A" : "B", seed);
      const r = m.result;
      if (!r) continue;
      if (r.winner === "A" && r.combat.decidedBy === "SCORE" && !winM) winM = m;
      if (r.winner === "B" && r.combat.decidedBy === "SCORE" && !lossM) lossM = m;
      if (r.combat.decidedBy === "OVR_TIEBREAK" && !ovrM) ovrM = m;
    }
    let marginM: DuelMatch | null = null, drawM: DuelMatch | null = null;
    for (let seed = 1; seed <= 400 && (!marginM || !drawM); seed++) {
      const m = qaSimulate(mine, mirror, 10, seed % 2 ? "A" : "B", seed);
      if (m.result?.combat.decidedBy === "STAT_MARGIN" && !marginM) marginM = m;
      if (m.result?.isDraw && !drawM) drawM = m;
    }
    // Punto de partida real (turnos 8–10 en vivo).
    let mpView: DuelMatchView | null = null;
    for (let seed = 1; seed <= 200 && !mpView; seed++) {
      for (const n of [7, 8, 9]) {
        const v = qaView(qaSimulate(mine, rival, n, seed % 2 ? "A" : "B", seed));
        if (v.status === "IN_PROGRESS" && turnHeader(v).matchPoint) { mpView = v; break; }
      }
    }
    // Sin carta de la partida: una partida cerrada pronto en la que no ganaste ningún turno.
    let noMvp: DuelMatchView | null = null;
    for (let seed = 1; seed <= 200 && !noMvp; seed++) {
      const v = qaView(qaSimulate(mine, rival, 2, "B", seed, false), "A", "PVP");
      if (v.history.length > 0 && v.history.every((t) => t.outcome !== "A")) noMvp = v;
    }

    const win = qaView(winM!);
    const loss = qaView(lossM!);
    const ovr = ovrM ? qaView(ovrM) : null;
    const margin = marginM ? qaView(marginM) : null;
    const draw = drawM ? qaView(drawM) : null;
    const fabricatedOvr = !ovr;
    const fabricatedMargin = !margin;
    const fabricatedDraw = !draw;

    const pick = (h: DuelTurnView[], o: DuelTurnView["outcome"]) => h.find((t) => t.outcome === o) ?? null;
    const all = [...win.history, ...loss.history];
    const tie = pick(all, "TIE");
    const partialM = qaSimulate(mine, rival, 4, "A", 9, false);

    return {
      mine, decks: [deckDTO(mine, "qa-listo")],
      attack, defense, imposed, mid, t9, t10, mpView, win, loss, noMvp,
      ovr: ovr ?? withResult(win, { decidedBy: "OVR_TIEBREAK", winner: "YOU", scoreYou: 6, scoreRival: 5, sumOvrYou: 845, sumOvrRival: 838, reason: "QA SYNTHETIC · desempate fabricado" }),
      margin: margin ?? withResult(win, { decidedBy: "STAT_MARGIN", winner: "YOU", scoreYou: 5, scoreRival: 5, sumOvrYou: 845, sumOvrRival: 845, statTotalYou: 812, statTotalRival: 797, reason: "QA SYNTHETIC · desempate fabricado" }),
      draw: draw ?? withResult(win, { decidedBy: "NONE", winner: null, isDraw: true, scoreYou: 5, scoreRival: 5, sumOvrYou: 845, sumOvrRival: 845, statTotalYou: 800, statTotalRival: 800, reason: "QA SYNTHETIC · empate fabricado" }),
      fabricatedOvr, fabricatedMargin, fabricatedDraw,
      winTurn: pick(win.history, "A"), lossTurn: pick(loss.history, "B"),
      tieTurn: tie ?? (win.history[0] ? { ...win.history[0], outcome: "TIE" as const, rival: { ...win.history[0].rival, value: win.history[0].you.value } } : null),
      fabricatedTie: !tie,
      pvpWin: qaView(winM!, "A", "PVP"), pvpLoss: qaView(lossM!, "A", "PVP"), pvpPartial: qaView(partialM, "A", "PVP"),
      privWin: qaView(winM!, "A", "PVP_PRIVATE", FRIEND.username),
      waiting: pvpState(qaSimulate(mine, rival, 3, "A", 11, false)),
      rivalReveal: pvpState(qaSimulate(mine, rival, 3, "A", 11, true), { yourTurn: true }),
      pvpAttack: pvpState(qaSimulate(mine, rival, 4, "A", 11), { yourTurn: true }),
      offline: pvpState(qaSimulate(mine, rival, 3, "A", 11, false), { status: "ERROR", error: { kind: "NETWORK", message: "QA" } }),
      reconnecting: pvpState(qaSimulate(mine, rival, 3, "A", 11, false), { status: "STALE", error: { kind: "NETWORK", message: "QA" } }),
      resync: pvpState(qaSimulate(mine, rival, 4, "A", 11), { status: "SYNCING", yourTurn: true, error: { kind: "CONFLICT", message: "QA" } }),
      stale: pvpState(qaSimulate(mine, rival, 4, "A", 11), { status: "STALE", yourTurn: true, error: { kind: "CONFLICT", message: "QA" } }),
      timeout: pvpState(qaSimulate(mine, rival, 3, "A", 11, false), { deadlineIn: -2_000 }),
      privateArena: pvpState(qaSimulate(mine, rival, 3, "A", 11, false), { mode: "PVP_PRIVATE" }),
      replay: qaReplay(winM!, "A", "PVE"),
      replayPartial: qaReplay(partialM, "A", "PVP", "Kaelis"),
      detail: detailFrom(qaView(winM!, "A", "PVP"), "WIN", 18),
    };
  }, []);

  const find = (view: DuelMatchView, uid: string) => [...view.yourHand, ...view.yourUsed, ...view.rivalUsed].find((c) => c.uid === uid);
  const moment = (turn: DuelTurnView | null, fabricated = false) => {
    if (!turn) return <p className="text-white/60">Sin turno con ese resultado en la simulación.</p>;
    const src = [fx.win, fx.loss].find((v) => find(v, turn.you.uid) && find(v, turn.rival.uid)) ?? fx.win;
    return (
      <div className="relative min-h-[720px]">
        {fabricated && <Synthetic text="turno empatado fabricado (mismo valor en los dos lados)" />}
        <MatchBoard view={fx.mid} onPlay={noop} busy revealing error={null} onDismissError={noop} />
        <DuelMoment turn={turn} yourCard={find(src, turn.you.uid)!} rivalCard={find(src, turn.rival.uid)!} onClose={noop} autoCloseMs={600_000} />
      </div>
    );
  };
  const board = (view: DuelMatchView, extra: Partial<Parameters<typeof MatchBoard>[0]> = {}) => (
    <MatchBoard view={view} onPlay={noop} busy={false} error={null} onDismissError={noop} {...extra} />
  );
  const arena = (state: SyncState, error: string | null = null, mode: "PVP" | "PVP_PRIVATE" = "PVP") => (
    <PvpArena state={state} busy={false} error={error} onPlay={noop} onAbandon={noop} onDismissError={noop} mode={mode} rival={mode === "PVP_PRIVATE" ? FRIEND : null} />
  );
  const outcome = (verdict: PvpVerdict, view: DuelMatchView | null, event: RatingEvent | null, extra: Partial<Parameters<typeof PvpOutcome>[0]> = {}) => (
    <PvpOutcome
      verdict={verdict} lifecycle="FINISHED" view={view} outcome={event} rating={1201} onAgain={noop} onBack={noop}
      ladder={event ? { before: { position: event.delta > 0 ? 130 : 118 }, after: { position: 124, rankedTotal: 500 }, positions: event.delta > 0 ? 6 : event.delta < 0 ? -6 : 0 } : null}
      {...extra}
    />
  );
  const privateDuel = { rival: FRIEND, h2h: PRIVATE_INFO.h2h, onRematch: noop, onSocial: noop, onProfile: noop, onOtherChallenge: noop };
  const result = (view: DuelMatchView, note?: string | false) => (
    <>
      {note && <Synthetic text={note} />}
      <ResultScreen view={view} xp={1_230} onPlayAgain={noop} onChange={noop} onDecks={noop} onReplay={noop} />
    </>
  );

  const body = () => {
    switch (scene) {
      /* ── pre-partida ── */
      case "prematch-pve": return <PreMatch decks={fx.decks} deckId={deckId} onDeck={setDeckId} difficulty={difficulty} onDifficulty={setDifficulty} onStart={noop} busy={false} error={null} onHelp={noop} activeDeckId="qa-listo" />;
      case "prematch-ranked": return <PvpLobby decks={fx.decks} deckId="qa-listo" onDeck={noop} onSearch={noop} onCancel={noop} onDecks={noop} searching={false} waitingSeconds={0} position={null} rating={1201} busy={false} activeDeckId="qa-listo" />;
      case "prematch-private": return <ChallengeSheet open mode="accept" target={FRIEND} decks={fx.decks} busy={false} error={null} onConfirm={noop} onClose={noop} activeDeckId="qa-listo" />;
      case "rival-hidden": return <PreMatchVersus deck={fx.decks[0]} rival={{ kind: "RANKED" }} />;
      case "own-team": return <PreMatchVersus deck={fx.decks[0]} rival={{ kind: "BOT", label: "Normal" }} />;
      case "intro": return <div className="relative min-h-[720px]"><MatchIntro view={fx.attack} rivalName="Normal" onDone={noop} /></div>;
      case "intro-pvp": return <div className="relative min-h-[720px]"><MatchIntro view={qaView(qaSimulate(fx.mine, fx.mine, 0, "B"), "A", "PVP")} rivalName="Kaelis" onDone={noop} /></div>;

      /* ── turno ── */
      case "turn1-attack": return board(fx.attack);
      case "turn-defense": return board(fx.defense);
      case "axis-selection": return board(fx.attack);          // el script elige carta → aparecen los tres ejes
      case "server-axis": return board(fx.imposed);
      case "card-selection": return board(fx.imposed);         // el script elige carta defendiendo → Responder
      case "selected-card": return board(fx.attack);           // el script elige carta y eje → CONFIRMA
      case "locked": return board(fx.attack, { busy: true });
      case "waiting": return arena(fx.waiting);
      case "rival-reveal": return arena(fx.rivalReveal);
      case "card-vs-card":
      case "stat-reveal": return moment(fx.winTurn);
      case "turn-win": return moment(fx.winTurn);
      case "turn-loss": return moment(fx.lossTurn);
      case "turn-draw": return moment(fx.tieTurn, fx.fabricatedTie);
      case "score-update":
      case "timeline-partial":
      case "turn-detail":
      case "turn5": return board(fx.mid);
      case "turn9": return board(fx.t9);
      case "final-turn": return board(fx.t10);
      case "match-point": return fx.mpView ? board(fx.mpView) : <p className="text-white/60">Ninguna semilla dio punto de partida.</p>;
      case "keyboard": return board(fx.attack);
      case "tablet": return board(fx.mid);

      /* ── final ── */
      case "ovr-tiebreak": return result(fx.ovr, fx.fabricatedOvr && "resultado con desempate por OVR fabricado (ninguna semilla lo dio)");
      case "stat-tiebreak": return result(fx.margin, fx.fabricatedMargin && "desempate por total de estadísticas fabricado (ninguna semilla lo dio)");
      case "match-win":
      case "pve-result":
      case "mvp":
      case "rewards": return result(fx.win);
      case "match-loss": return result(fx.loss);
      case "match-draw": return result(fx.draw, fx.fabricatedDraw && "empate total fabricado (ninguna semilla espejo lo dio)");
      case "ranked-result":
      case "rating-positive":
      case "search-another":
      case "no-reward": return outcome("WIN", fx.pvpWin, EVENT(18));
      case "rating-negative": return outcome("LOSS", fx.pvpLoss, EVENT(-12));
      case "provisional": return outcome("WIN", fx.pvpWin, EVENT(31, 40));
      case "rating-pending": return outcome("WIN", fx.pvpWin, null);
      case "private-result":
      case "rematch": return outcome("WIN", fx.privWin, null, { privateDuel });
      case "no-mvp": return fx.noMvp ? outcome("WIN", fx.noMvp, EVENT(9), { lifecycle: "ABANDONED" }) : null;
      case "finished-reconnect": return outcome("WIN", fx.pvpPartial, EVENT(15, 24, "WIN"), { lifecycle: "EXPIRED" });
      case "history-detail": return <MatchDetailView detail={fx.detail} />;

      /* ── repetición ── */
      case "replay":
      case "replay-turn1": return <ReplayViewer replay={fx.replay} onBack={noop} />;
      case "replay-middle": return <ReplayViewer replay={fx.replay} onBack={noop} initialIndex={4} />;
      case "replay-final": return <ReplayViewer replay={fx.replay} onBack={noop} initialIndex={9} />;
      case "replay-partial": return <ReplayViewer replay={fx.replayPartial} onBack={noop} initialIndex={3} />;
      case "replay-unavailable": return <ReplayViewer replay={{ ...fx.replay, turns: [] }} onBack={noop} />;

      /* ── red y errores ── */
      case "offline": return arena(fx.offline);
      case "reconnecting": return arena(fx.reconnecting);
      case "resync": return arena(fx.resync);
      case "stale": return arena(fx.stale, "La partida avanzó mientras decidías. Vuelve a intentarlo.");
      case "timeout": return arena(fx.timeout);
      case "private-arena": return arena(fx.privateArena, null, "PVP_PRIVATE");
      case "pvp-attack":
      case "sound-off": return arena(fx.pvpAttack);
      case "backend-error": return <ErrorState message="No se pudo preparar el duelo" onRetry={noop} />;
      case "invalid-match": return <EmptyState icon="🎞️" title="Partida no encontrada" hint="Solo los jugadores de una partida pueden ver su repetición." action={{ href: "/duelos", label: "Volver a Duelos" }} />;
      default:
        return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase33?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1320px] px-3 py-4 sm:px-6" data-qa-scene={scene || "index"}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 33 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">motor real · cartas reales · jugadores y rating inventados · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}

function Synthetic({ text }: { text: string }) {
  return <p className="mb-3 rounded border border-drl-gold/40 bg-drl-gold/10 px-3 py-1.5 text-caption text-drl-gold" data-synthetic="true">QA SYNTHETIC · {text}</p>;
}

const SCENES = [
  "prematch-pve", "prematch-ranked", "prematch-private", "rival-hidden", "own-team", "intro", "intro-pvp",
  "turn1-attack", "turn-defense", "axis-selection", "server-axis", "card-selection", "selected-card", "locked", "waiting",
  "rival-reveal", "card-vs-card", "stat-reveal", "turn-win", "turn-loss", "turn-draw", "score-update", "timeline-partial",
  "turn-detail", "turn5", "turn9", "final-turn", "match-point", "ovr-tiebreak", "stat-tiebreak", "match-win", "match-loss",
  "match-draw", "ranked-result", "rating-positive", "rating-negative", "provisional", "rating-pending", "pve-result",
  "private-result", "mvp", "no-mvp", "rewards", "no-reward", "rematch", "search-another", "history-detail", "replay",
  "replay-turn1", "replay-middle", "replay-final", "replay-partial", "replay-unavailable", "offline", "reconnecting",
  "resync", "stale", "timeout", "finished-reconnect", "private-arena", "pvp-attack", "backend-error", "keyboard",
  "tablet", "sound-off", "invalid-match",
] as const;
