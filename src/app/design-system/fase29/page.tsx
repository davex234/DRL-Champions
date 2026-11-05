"use client";

/**
 * ARNÉS QA · FASE 29 — `/design-system/fase29?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES del social (`SocialHub` y sus pestañas, `ChallengeSheet`,
 * `ConfirmSheet`, `SocialActionsPanel`, `SocialSummaryCard`) y el duelo privado (`PvpArena`,
 * `PvpOutcome` con `PrivateDuelPanel`) con datos **QA SYNTHETIC** (`./fixtures`): jugadores,
 * amistades, retos y presencias inventados. La partida privada usa el MOTOR real proyectada con
 * `projectMatchFor` + `buildMatchView`, como hace el servidor. Sin sesión, sin red: los
 * manejadores son no-op.
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
import { buildMatchView, toCardDTO } from "@/lib/duel/matchView";
import { initialSyncState, type SyncState } from "@/lib/duel/pvpPoller";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { ErrorState } from "@/components/ui/States";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { SocialHub } from "@/components/social/SocialHub";
import { ChallengeSheet } from "@/components/social/ChallengeSheet";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { SocialActionsPanel } from "@/components/social/SocialActions";
import { SocialSummaryCard } from "@/components/social/SocialSummary";
import type { SocialHandlers, SearchState, SocialTab } from "@/components/social/types";
import { PvpArena } from "@/components/duel/pvp/PvpArena";
import { PvpOutcome } from "@/components/duel/pvp/PvpOutcome";
import { FULL, EMPTY, QUIET, AFTER_DUEL, SEARCH_HITS, PLAYER_FRIEND, PLAYER_STRANGER, PLAYER_SENT, PRIVATE_INFO, RIVAL, QA_NOW } from "./fixtures";

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

function deckDTO(s: DuelDeckSnapshot, id: string, valid = true): DuelDeckDTO {
  const cards = s.cards.map((c) => toCardDTO(c, registry));
  const roleCounts: Record<RoleId, number> = { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 };
  for (const c of cards) roleCounts[c.role] += 1;
  return {
    id, name: s.deckName, cardUids: cards.map((c) => c.uid), cards, valid,
    status: valid ? "READY_FOR_DUEL" : "INCOMPLETE", roleCounts,
    missingByRole: { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 },
    errors: valid ? [] : [{ code: "INCOMPLETE" as never, message: "QA SYNTHETIC · faltan cartas" }],
    sumOvr: cards.reduce((a, c) => a + c.ovr, 0), updatedAt: NOW,
  };
}

const SCENES = [
  "hub", "hub-empty", "hub-quiet", "hub-after-duel", "friends", "requests", "search", "search-empty", "challenges", "challenges-empty",
  "activity", "challenge-sheet", "challenge-accept-sheet", "confirm-unfriend", "confirm-block", "profile-friend", "profile-stranger",
  "profile-sent", "private-arena", "private-outcome-win", "private-outcome-loss", "private-outcome-abandon", "summary", "backend-error",
] as const;

const noop = () => {};
const HANDLERS: SocialHandlers = {
  onFriendRequest: noop, onAcceptFriend: noop, onDeclineFriend: noop, onUnfriend: noop, onCancelRequest: noop, onBlock: noop, onUnblock: noop,
  onChallenge: noop, onAcceptChallenge: noop, onDeclineChallenge: noop, onCancelChallenge: noop, onOpenMatch: noop,
};
const SEARCH_IDLE: SearchState = { query: "", results: null, searching: false, error: null, onQuery: noop };
const SEARCH_FULL: SearchState = { query: "ka", results: SEARCH_HITS, searching: false, error: null, onQuery: noop };
const SEARCH_NONE: SearchState = { query: "zzz", results: [], searching: false, error: null, onQuery: noop };

export default function Fase29QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  // En móvil, las escenas de pestaña se capturan sobre la propia pestaña (el hero queda arriba, fuera del viewport).
  useEffect(() => {
    if (!scene || window.innerWidth >= 640 || /^hub(-empty|-quiet)?$/.test(scene)) return;
    const id = window.setTimeout(() => document.querySelector('[role="tabpanel"], [data-testid="social-actions"]')?.scrollIntoView({ block: "start" }), 600);
    return () => window.clearTimeout(id);
  }, [scene]);

  const fx = useMemo(() => {
    const mine = snapshotDeck(0, "qa-mine", "QA SYNTHETIC · Mi equipo");
    const rival = snapshotDeck(1, "qa-rival", "QA SYNTHETIC · Rival");
    if (!mine || !rival) return null;
    const opts = { side: "A" as const, registry, difficulty: "NORMAL" as const, rivalLabel: RIVAL.username };
    let win = null as ReturnType<typeof buildMatchView> | null, loss = null as ReturnType<typeof buildMatchView> | null;
    for (let seed = 3; seed < 60 && (!win || !loss); seed++) {
      const v = buildMatchView(projectMatchFor(simulate(mine, rival, 10, seed), "A"), opts);
      if (!v.result) continue;
      if (v.result.winner === "YOU" && !win) win = v;
      if (v.result.winner === "RIVAL" && !loss) loss = v;
    }
    const partial = buildMatchView(projectMatchFor(simulate(mine, rival, 4, 9), "A"), opts);
    const live = simulate(mine, rival, 3, 11);
    const arena: SyncState = {
      ...initialSyncState(), status: "SYNCED", stateVersion: 7, lastSyncedAt: Date.now(),
      snapshot: {
        matchId: PRIVATE_INFO.matchId, mode: "PVP_PRIVATE", lifecycle: "IN_TURN", stateVersion: 7, yourSide: "A", expectedSide: "B", isYourTurn: false,
        closedBySide: null, match: projectMatchFor(live, "A"), turnStartedAt: Date.now() - 12_000, turnDeadlineAt: Date.now() + 78_000,
      },
    };
    return { win, loss, partial, arena, decks: [deckDTO(mine, "qa-listo"), deckDTO(rival, "qa-incompleto", false)] };
  }, []);

  const hub = (snap: typeof FULL, tab: SocialTab, search: SearchState = SEARCH_IDLE) => (
    <SocialHub snap={snap} now={QA_NOW} tab={tab} onTab={noop} handlers={HANDLERS} search={search} />
  );
  const privateProps = (h2h: typeof PRIVATE_INFO.h2h | null = PRIVATE_INFO.h2h) => ({
    rival: RIVAL, h2h, onRematch: noop, onSocial: noop, onProfile: noop, onOtherChallenge: noop,
  });

  const body = () => {
    switch (scene) {
      case "hub": return hub(FULL, "amigos");
      case "hub-empty": return hub(EMPTY, "amigos");
      case "hub-quiet": return hub(QUIET, "amigos");
      case "hub-after-duel": return hub(AFTER_DUEL, "actividad");
      case "friends": return hub(QUIET, "amigos");
      case "requests": return hub(FULL, "solicitudes");
      case "search": return hub(FULL, "buscar", SEARCH_FULL);
      case "search-empty": return hub(FULL, "buscar", SEARCH_NONE);
      case "challenges": return hub(FULL, "retos");
      case "challenges-empty": return hub(QUIET, "retos");
      case "activity": return hub(FULL, "actividad");
      case "challenge-sheet": return <>{hub(QUIET, "amigos")}<ChallengeSheet open mode="send" target={RIVAL} decks={fx?.decks ?? []} busy={false} error={null} onConfirm={noop} onClose={noop} /></>;
      case "challenge-accept-sheet": return <>{hub(FULL, "retos")}<ChallengeSheet open mode="accept" target={RIVAL} decks={fx?.decks ?? []} busy={false} error={null} onConfirm={noop} onClose={noop} /></>;
      case "confirm-unfriend": return <>{hub(QUIET, "amigos")}<ConfirmSheet open title="¿Eliminar amigo?" body={`${RIVAL.username} dejará de ser tu amigo y no podréis retaros hasta volver a serlo. Vuestro historial de partidas se conserva.`} confirmLabel="Eliminar amigo" onConfirm={noop} onClose={noop} /></>;
      case "confirm-block": return <>{hub(FULL, "solicitudes")}<ConfirmSheet open title="¿Bloquear jugador?" body={`${RIVAL.username} no podrá enviarte solicitudes ni retos, y dejaréis de ser amigos. Sus retos pendientes se cancelan.`} confirmLabel="Bloquear" onConfirm={noop} onClose={noop} /></>;
      case "profile-friend": return <div className="max-w-4xl"><SocialActionsPanel view={PLAYER_FRIEND} onChanged={noop} now={QA_NOW} harness /></div>;
      case "profile-stranger": return <div className="max-w-4xl"><SocialActionsPanel view={PLAYER_STRANGER} onChanged={noop} now={QA_NOW} harness /></div>;
      case "profile-sent": return <div className="max-w-4xl"><SocialActionsPanel view={PLAYER_SENT} onChanged={noop} now={QA_NOW} harness /></div>;
      case "private-arena": return fx ? <PvpArena state={fx.arena} busy={false} error={null} onPlay={noop} onAbandon={noop} onDismissError={noop} mode="PVP_PRIVATE" rival={RIVAL} /> : null;
      case "private-outcome-win": return fx?.win ? <PvpOutcome verdict="WIN" lifecycle="FINISHED" view={fx.win} outcome={null} rating={null} onAgain={noop} onBack={noop} privateDuel={privateProps()} /> : null;
      case "private-outcome-loss": return fx?.loss ? <PvpOutcome verdict="LOSS" lifecycle="FINISHED" view={fx.loss} outcome={null} rating={null} onAgain={noop} onBack={noop} privateDuel={privateProps()} /> : null;
      case "private-outcome-abandon": return fx ? <PvpOutcome verdict="WIN" lifecycle="ABANDONED" view={fx.partial} outcome={null} rating={null} onAgain={noop} onBack={noop} privateDuel={privateProps(null)} /> : null;
      case "summary": return <div className="max-w-2xl"><SocialSummaryCard snap={FULL} /></div>;
      case "backend-error": return <ErrorState message="No se pudo leer lo social" onRetry={noop} />;
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase29?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-5xl px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 29 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">jugadores, amistades, retos y presencias inventados · motor real en la partida · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
