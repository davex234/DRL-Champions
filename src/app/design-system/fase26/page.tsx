"use client";

/**
 * ARNÉS QA · FASE 26 — `/design-system/fase26?scene=<escena>` (solo capturas y revisión).
 *
 * Los duelos son SERVIDOR-AUTORITATIVOS: sin sesión no hay partida. Para fotografiar la arena sin
 * cuenta, este arnés simula una partida con el MISMO motor puro (`domain/cardgame`, el que prueban
 * `duel.test.ts` y los verificadores) sobre cartas REALES del catálogo, con dos bots, en el
 * navegador, y proyecta la vista con `buildMatchView`, la misma función que usa el servidor.
 *
 * Todo es **QA SYNTHETIC**: mazos inventados con cartas reales, partida simulada, recompensa
 * calculada con la tabla real del dominio, rating no pedido. Nada se escribe en ninguna base de
 * datos ni se envía a ninguna API. Esta página NO es una pantalla de juego y no forma parte de
 * `UI_FILES`: importa el motor a propósito para fabricar los fixtures.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList, DUEL_ROLES,
  type DuelDeckSnapshot,
} from "@/domain/cardgame";
import { startDuelMatch, confirmTurn, type DuelMatch } from "@/domain/cardgame/match";
import { createRng, createController, advanceBots, createDuelBot } from "@/domain/cardgame/opponent";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { duelAward } from "@/domain/progression/duelRewards";
import { buildMatchView, toCardDTO } from "@/lib/duel/matchView";
import { rivalHintsFor, rivalRolesFor } from "@/domain/cardgame/hints";
import { visualHintValue } from "@/lib/duel/hintVisuals";
import { initialSyncState, type SyncState } from "@/lib/duel/pvpPoller";
import type { DuelDeckDTO, DuelMatchView, DuelTurnView, Side } from "@/lib/duel/types";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { DuelMoment } from "@/components/duel/DuelMoment";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { PreMatch } from "@/components/duel/PreMatch";
import { MatchIntro } from "@/components/duel/MatchIntro";
import { HelpSheet } from "@/components/duel/HelpSheet";
import { RoundStrip } from "@/components/duel/MatchSummary";
import { PvpArena } from "@/components/duel/pvp/PvpArena";
import { PvpOutcome } from "@/components/duel/pvp/PvpOutcome";
import { PvpLobby } from "@/components/duel/pvp/PvpLobby";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { HydrationGate } from "@/components/layout/HydrationGate";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

/** Mazo legal nº `block` con cartas reales del catálogo (mismo constructor que `duel.test.ts`). */
function snapshot(block: number, id: string, name: string): DuelDeckSnapshot | null {
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const role of DUEL_ROLES) {
    const best = new Map<string, (typeof CARDS)[number]>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, c);
    }
    byRole.set(role, [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)));
  }
  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  if (!v.valid) return null;
  return takeDeckSnapshot(deck, v, NOW);
}

/**
 * Simula `turns` turnos con dos bots. Si al parar le toca declarar al rival (B), se le deja declarar
 * para que la mesa quede «defendiendo» —exactamente el estado que el servidor devolvería.
 */
function simulate(mine: DuelDeckSnapshot, rival: DuelDeckSnapshot, turns: number, first: Side, seed = 7, letRivalDeclare = true): DuelMatch {
  const start = startDuelMatch({ id: `qa-${first}-${turns}-${seed}`, snapshotA: mine, snapshotB: rival, firstAttacker: first });
  if (!start.ok) throw new Error("fixture: no arranca");
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

function deckDTO(s: DuelDeckSnapshot, id: string, drop: RoleId[] = []): DuelDeckDTO {
  let cards = s.cards.map((c) => toCardDTO(c, registry));
  const missingByRole: Record<RoleId, number> = { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 };
  for (const role of drop) {
    const i = cards.findIndex((c) => c.role === role);
    if (i >= 0) { cards = [...cards.slice(0, i), ...cards.slice(i + 1)]; missingByRole[role] += 1; }
  }
  const roleCounts: Record<RoleId, number> = { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 };
  for (const c of cards) roleCounts[c.role] += 1;
  const valid = drop.length === 0;
  return {
    id, name: s.deckName, cardUids: cards.map((c) => c.uid), cards, valid,
    status: valid ? "READY_FOR_DUEL" : "INCOMPLETE",
    roleCounts, missingByRole,
    errors: valid ? [] : [{ code: "INCOMPLETE" as never, message: "QA SYNTHETIC · faltan cartas" }],
    sumOvr: cards.reduce((n, c) => n + c.ovr, 0), updatedAt: NOW,
  };
}

const SCENES = [
  "prematch", "prematch-invalid", "intro", "arena", "defending", "reveal", "round-win", "round-loss", "round-draw",
  "history", "pvp-lobby", "pvp-waiting", "reconnect", "win", "loss", "pvp-outcome", "help",
] as const;

export default function Fase26QaPage() {
  return (
    <HydrationGate>
      <Harness />
    </HydrationGate>
  );
}

function Harness() {
  const [scene, setScene] = useState<string>("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  const [deckId, setDeckId] = useState<string>("qa-listo");
  const [difficulty, setDifficulty] = useState<"EASY" | "NORMAL" | "HARD">("NORMAL");
  useEffect(() => { if (scene === "prematch-invalid") setDeckId("qa-incompleto"); }, [scene]);

  const fx = useMemo(() => {
    const mine = snapshot(0, "qa-mine", "QA SYNTHETIC · Mi equipo");
    const rival = snapshot(1, "qa-rival", "QA SYNTHETIC · Rival");
    if (!mine || !rival) return null;
    const opts = { side: "A" as Side, registry, difficulty: "NORMAL" as const };
    // DUEL GAMEPLAY UX 2.0 · pistas y ROLES del reverso con las MISMAS funciones del servidor (`toPublicView`).
    const countryOf = (pid: string) => registry.player(pid)?.country ?? "";
    const at = (turns: number, first: Side, seed?: number) => {
      const m = simulate(mine, rival, turns, first, seed);
      return buildMatchView(m, { ...opts, rivalHints: rivalHintsFor(m, "A", countryOf, visualHintValue), rivalRoles: rivalRolesFor(m, "A", countryOf, visualHintValue) });
    };

    // Partida terminada. Se buscan una que gane A y otra que pierda A entre varias semillas.
    let win: DuelMatchView | null = null, loss: DuelMatchView | null = null;
    for (let seed = 3; seed < 40 && (!win || !loss); seed++) {
      const m = simulate(mine, rival, 10, seed % 2 ? "A" : "B", seed);
      const v = buildMatchView(m, opts);
      if (!v.result) continue;
      if (v.result.winner === "YOU" && !win) win = v;
      if (v.result.winner === "RIVAL" && !loss) loss = v;
    }
    const withAward = (v: DuelMatchView | null): DuelMatchView | null => {
      if (!v?.result) return v;
      const a = duelAward(v.result, "NORMAL");
      return { ...v, result: { ...v.result, award: { points: a.points, credits: a.reward.credits ?? 0, xp: a.reward.xp ?? 0 } } };
    };
    const full = win ?? loss;
    const history: DuelTurnView[] = full?.history ?? [];
    const draw: DuelTurnView | null = history.find((t) => t.outcome === "TIE") ?? (history[0]
      ? { ...history[0], outcome: "TIE", rival: { ...history[0].rival, value: history[0].you.value }, reason: "QA SYNTHETIC · empate fabricado para la captura" }
      : null);

    // PvP: la partida se proyecta con la MISMA redacción que aplica el servidor (`projectMatchFor`).
    // Tras 3 turnos con A abriendo ataca B, y aún NO ha declarado: «el rival está decidiendo».
    const pvpMatch = simulate(mine, rival, 3, "A", 11, false);
    const pvpState = (status: SyncState["status"]): SyncState => ({
      ...initialSyncState(),
      status,
      stateVersion: 7,
      lastSyncedAt: Date.now(),
      snapshot: {
        matchId: "qa-pvp", lifecycle: "IN_TURN", stateVersion: 7, yourSide: "A", expectedSide: "B", isYourTurn: false,
        match: projectMatchFor(pvpMatch, "A"), turnStartedAt: Date.now() - 12_000, turnDeadlineAt: Date.now() + 78_000,
      },
    });

    return {
      decks: [deckDTO(mine, "qa-listo"), deckDTO(rival, "qa-incompleto", ["Duelista", "Centinela"])],
      intro: at(0, "A"),
      arena: at(3, "B"),          // tras 3 turnos con B abriendo, ataca A: mesa lista para elegir carta y eje
      defending: at(2, "B"),      // tras 2 turnos, ataca B: ya declaró → «Obligado a responder con…»
      history: at(6, "A"),
      reveal: at(4, "A").lastTurn,
      roundWin: history.find((t) => t.outcome === "A") ?? null,
      roundLoss: history.find((t) => t.outcome === "B") ?? null,
      roundDraw: draw,
      win: withAward(win), loss: withAward(loss),
      pvpWaiting: pvpState("SYNCED"),
      pvpStale: pvpState("STALE"),
    };
  }, []);

  if (!fx) return <p className="p-8 text-white">No se pudieron construir los mazos QA con el catálogo actual.</p>;

  const find = (view: DuelMatchView, uid: string) => [...view.yourHand, ...view.yourUsed, ...view.rivalUsed].find((c) => c.uid === uid)!;
  const noop = () => {};
  const forReveal = fx.history;

  const moment = (turn: DuelTurnView | null) => turn ? (
    <div className="relative min-h-[720px]">
      <MatchBoard view={forReveal} onPlay={noop} busy error={null} onDismissError={noop} />
      <DuelMoment turn={turn} yourCard={find(forReveal, turn.you.uid) ?? find(fx.win ?? forReveal, turn.you.uid)} rivalCard={find(forReveal, turn.rival.uid) ?? find(fx.win ?? forReveal, turn.rival.uid)} onClose={noop} autoCloseMs={600_000} />
    </div>
  ) : <p className="text-white/60">Sin turno con ese resultado en la simulación.</p>;

  const body = () => {
    switch (scene) {
      case "prematch":
      case "prematch-invalid":
        return <PreMatch decks={fx.decks} deckId={deckId} onDeck={setDeckId} difficulty={difficulty} onDifficulty={setDifficulty} onStart={noop} busy={false} error={null} onHelp={noop} />;
      case "intro":
        return <div className="relative min-h-[720px]"><MatchIntro view={fx.intro} rivalName="Normal" onDone={noop} /></div>;
      case "arena":
        return <MatchBoard view={fx.arena} onPlay={noop} busy={false} error={null} onDismissError={noop} />;
      case "defending":
        return <MatchBoard view={fx.defending} onPlay={noop} busy={false} error={null} onDismissError={noop} />;
      case "history":
        return (
          <div className="flex flex-col gap-4">
            <MatchBoard view={fx.history} onPlay={noop} busy={false} error={null} onDismissError={noop} />
            <RoundStrip history={fx.history.history} yours={[...fx.history.yourUsed, ...fx.history.yourHand]} theirs={fx.history.rivalUsed} />
          </div>
        );
      case "reveal": return moment(fx.reveal);
      case "round-win": return moment(fx.roundWin);
      case "round-loss": return moment(fx.roundLoss);
      case "round-draw": return moment(fx.roundDraw);
      case "pvp-lobby":
        return <PvpLobby decks={fx.decks} deckId="qa-listo" onDeck={noop} onSearch={noop} onCancel={noop} onDecks={noop} searching waitingSeconds={47} position={2} rating={1000} busy={false} />;
      case "pvp-waiting":
        return <PvpArena state={fx.pvpWaiting} busy={false} error={null} onPlay={noop} onAbandon={noop} onDismissError={noop} />;
      case "reconnect":
        return <PvpArena state={fx.pvpStale} busy={false} error={null} onPlay={noop} onAbandon={noop} onDismissError={noop} />;
      case "win":
        return fx.win ? <ResultScreen view={fx.win} xp={1_230} onPlayAgain={noop} onChange={noop} onDecks={noop} onReplay={noop} /> : null;
      case "loss":
        return fx.loss ? <ResultScreen view={fx.loss} xp={1_230} onPlayAgain={noop} onChange={noop} onDecks={noop} onReplay={noop} /> : null;
      case "pvp-outcome":
        return fx.win ? <PvpOutcome verdict="WIN" lifecycle="FINISHED" view={fx.win} outcome={null} rating={1000} onAgain={noop} onBack={noop} /> : null;
      case "help":
        return (
          <div className="relative min-h-[720px]">
            <MatchBoard view={fx.arena} onPlay={noop} busy={false} error={null} onDismissError={noop} />
            <HelpSheet open onClose={noop} mode="PVE" />
          </div>
        );
      default:
        return (
          <div className="flex flex-wrap gap-2">
            {SCENES.map((s) => (
              <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase26?scene=${s}`}>{s}</NxButton>
            ))}
          </div>
        );
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1320px] px-3 py-4 sm:px-6" data-qa-scene={scene || "index"}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 26 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">motor real en el navegador · cartas reales · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
