"use client";

/**
 * ARNÉS QA · FASE 35 — `/design-system/fase35?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES de Game Modes Hub y Road to Champions (`GameModesHub`, `CampaignHero`,
 * `CampaignMap`, `NodeSheet`, `CampaignPreMatch`, `CampaignResultBanner`, la arena de Fase 33) con fotos QA
 * SYNTHETIC (`./fixtures`): definición y rivales reales, progreso inventado. Sin sesión, sin red, sin BD.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { ErrorState } from "@/components/ui/States";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { GameModesHub } from "@/components/modes/GameModesHub";
import { CampaignHero, CampaignNotice } from "@/components/campaign/CampaignHero";
import { CampaignMap } from "@/components/campaign/CampaignMap";
import { NodeSheet } from "@/components/campaign/NodeSheet";
import { CampaignPreMatch } from "@/components/campaign/CampaignPreMatch";
import { CampaignResultBanner } from "@/components/campaign/CampaignResultBanner";
import { CampaignProfileBadgeView } from "@/components/campaign/CampaignProfileBadge";
import { NextUp } from "@/components/loop/NextUp";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { MatchIntro } from "@/components/duel/MatchIntro";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { NAV_SECTIONS, MOBILE_NAV } from "@/design/nav";
import { findNodeView, type CampaignSnapshot } from "@/domain/campaign";
import type { LoopStep } from "@/server/services/loop";
import {
  allNodeViews, chapterOf, gameModes, nextNodeAfter, resultCopy, type DeckLite, type ModeFacts,
} from "@/lib/campaign/presentation";
import { DAILY, DECK_INVALID, DECK_READY, PROGRESS, campaignSnap, resultViews, settled } from "./fixtures";

export default function Fase35QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

const noop = () => {};
const READY: DeckLite = { id: DECK_READY.id, name: DECK_READY.name, valid: true, sumOvr: DECK_READY.sumOvr };
const INVALID: DeckLite = { id: DECK_INVALID.id, name: DECK_INVALID.name, valid: false, sumOvr: DECK_INVALID.sumOvr };

function Synthetic({ note }: { note?: string }) {
  return (
    <p className="mb-3 rounded border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-1 text-[11px] text-drl-gold/90" data-synthetic="true">
      QA SYNTHETIC · definición y rivales reales (rtc-2, catálogo), progreso inventado{note ? ` · ${note}` : ""}
    </p>
  );
}

function hubFacts(snap: CampaignSnapshot | null, o: Partial<ModeFacts> = {}): ModeFacts {
  const next = snap?.summary.nextNodeId ? allNodeViews(snap).find((n) => n.id === snap.summary.nextNodeId) ?? null : null;
  return {
    signedIn: true, hasValidDeck: true, activePve: false, activePvp: false, rankedProvisional: false,
    campaign: snap ? { available: snap.available, completed: snap.summary.completed, total: snap.summary.total, complete: snap.summary.complete, nextName: next?.name ?? null, chapter: next ? `Capítulo ${next.chapterOrder}` : null } : null,
    ...o,
  };
}

function Harness() {
  const [scene, setScene] = useState("");
  const [deckId, setDeckId] = useState<string | null>(DECK_READY.id);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);

  const body = useMemo(() => {
    const hub = (snap: CampaignSnapshot | null, o: Partial<ModeFacts> = {}, x: { daily?: typeof DAILY | null | "loading"; offline?: boolean; note?: string } = {}) => {
      const facts = hubFacts(snap, o);
      return (
        <>
          <Synthetic note={x.note} />
          <GameModesHub
            cards={gameModes(facts)}
            rtcProgress={facts.signedIn && snap?.available ? { completed: snap.summary.completed, total: snap.summary.total } : null}
            offline={x.offline}
          />
        </>
      );
    };

    const map = (snap: CampaignSnapshot, x: { signedIn?: boolean; offline?: boolean; error?: string; selected?: string | null; deck?: DeckLite | null; decksKnown?: boolean; noDecks?: boolean; note?: string } = {}) => {
      const signedIn = x.signedIn ?? true;
      const node = x.selected ? findNodeView(snap, x.selected) : null;
      const open = snap.activeAttempt ? allNodeViews(snap).find((n) => n.id === snap.activeAttempt!.nodeId) ?? null : null;
      return (
        <div className="space-y-4" data-testid="road-to-champions">
          <Synthetic note={x.note} />
          <CampaignHero snapshot={snap} onContinue={noop} signedIn={signedIn} />
          <div className="space-y-2">
            {x.offline && <CampaignNotice kind="offline" onRetry={noop} />}
            {x.error && <CampaignNotice kind="error" message={x.error} onRetry={noop} />}
            {!snap.available && <CampaignNotice kind="unavailable" />}
            {snap.available && !signedIn && <CampaignNotice kind="signin" action={{ label: "Iniciar sesión", href: "/cuenta" }} />}
            {snap.available && signedIn && open && <CampaignNotice kind="active" message={`«${open.name}» está en marcha. Termínalo o abandónalo antes de empezar otro nodo.`} action={{ label: "Retomar", href: "#" }} />}
            {snap.available && signedIn && snap.summary.complete && <CampaignNotice kind="complete" />}
            {x.noDecks && <CampaignNotice kind="active" message="Necesitas un equipo válido (diez cartas, dos por rol) para jugar cualquier nodo." action={{ label: "Crear equipo", href: "#" }} />}
          </div>
          <CampaignMap snapshot={snap} selectedId={x.selected ?? null} onSelect={noop} />
          {node && (
            <NodeSheet snapshot={snap} node={node} deck={x.deck === undefined ? READY : x.deck} decksKnown={x.decksKnown ?? true}
              signedIn={signedIn} online={!x.offline} onClose={noop} onAbandon={noop} />
          )}
        </div>
      );
    };

    const prematch = (snap: CampaignSnapshot, nodeId: string, decks = [DECK_READY, DECK_INVALID], error: string | null = null) => (
      <>
        <Synthetic />
        <CampaignPreMatch snapshot={snap} node={findNodeView(snap, nodeId)!} decks={decks} deckId={decks.length ? deckId : null} onDeck={setDeckId}
          onStart={noop} busy={false} error={error} onHelp={noop} activeDeckId={DECK_READY.id} />
      </>
    );

    const result = (snap: CampaignSnapshot, nodeId: string, kind: "win" | "loss" | "draw", o: { firstClear: boolean; wasCompleted: boolean; pending?: boolean }) => {
      const node = findNodeView(snap, nodeId)!;
      const views = resultViews(nodeId);
      const wanted = kind === "win" ? views.win : kind === "loss" ? views.loss : views.draw;
      const view = wanted ?? views.win ?? views.loss!;
      const fabricated = !wanted;
      const s = o.pending ? snap : { ...snap, lastAttempt: settled(nodeId, view.matchId, kind === "win" ? "WIN" : kind === "loss" ? "LOSS" : "DRAW", o.firstClear) };
      const last = s.lastAttempt && s.lastAttempt.matchId === view.matchId ? s.lastAttempt : null;
      const chapter = chapterOf(s, nodeId);
      const copy = resultCopy({
        outcome: last?.result ?? null, firstClear: !!last?.firstClear, wasCompleted: o.wasCompleted,
        chapterClosed: last?.firstClear && chapter?.complete ? chapter : null, campaignComplete: s.summary.complete,
        credits: last?.firstClear ? node.firstClearCredits : 0, nodeName: node.name,
      });
      return (
        <>
          <Synthetic note={kind === "draw" && views.drawMirror ? "sin empate en 400 semillas contra este rival: empate REAL del motor en espejo (mismo mazo a ambos lados)" : fabricated ?`sin ${kind === "draw" ? "empate" : kind === "win" ? "victoria" : "derrota"} en las semillas contra este rival: el tablero es de otra partida real y el banner usa el resultado de la escena` : "partida del motor canónico contra el mazo real del rival"} />
          {/* Como la arena: en campaña no hay «Cambiar rival o mazo» (el rival lo fija el nodo). */}
          <ResultScreen view={view} xp={4_200} onPlayAgain={noop} onDecks={noop} onReplay={noop}
            extra={<CampaignResultBanner copy={copy} node={node} next={last?.result === "WIN" ? nextNodeAfter(s, nodeId) : null} onRetrySync={noop} />} />
        </>
      );
    };

    const S = {
      fresh: campaignSnap(PROGRESS.fresh),
      mid: campaignSnap(PROGRESS.mid),
      ch1: campaignSnap(PROGRESS.chapter1),
      near: campaignSnap(PROGRESS.nearEnd),
      complete: campaignSnap(PROGRESS.complete),
      unavailable: campaignSnap([], { available: false }),
      firstLoss: campaignSnap(PROGRESS.firstLoss),
    };

    switch (scene) {
      /* ── hub ── */
      case "hub-full": case "hub-tablet": return hub(S.mid, { rankedProvisional: false });
      case "hub-new-player": return hub(S.fresh, { hasValidDeck: true }, { daily: [] });
      case "hub-no-deck": return hub(S.fresh, { hasValidDeck: false });
      case "hub-in-match": return hub(S.mid, { activePve: true });
      case "hub-provisional": return hub(S.mid, { rankedProvisional: true });
      case "hub-signed-out": return hub(S.fresh, { signedIn: false });
      case "hub-campaign-unavailable": return hub(S.unavailable);
      case "hub-offline": return hub(S.mid, {}, { offline: true });
      case "hub-campaign-complete": return hub(S.complete);
      case "daily-challenges": return hub(S.mid);
      case "daily-none": return hub(S.mid, {}, { daily: [] });
      case "daily-error": return hub(S.mid, {}, { daily: null });

      /* ── mapa ── */
      case "map-fresh": case "empty-first-node": case "keyboard": case "reduced-motion": return map(S.fresh);
      case "map-mid": case "map-tablet": case "map-mobile": case "energy-lines": case "boss-node": return map(S.mid);
      case "map-chapter1-complete": case "chapter-locked": return map(S.ch1);
      case "map-near-end": return map(S.near);
      case "map-complete": return map(S.complete);
      case "map-unavailable": return map(S.unavailable);
      case "map-signed-out": return map(S.fresh, { signedIn: false });
      case "map-offline": return map(S.mid, { offline: true });
      case "map-backend-error": return <><Synthetic /><ErrorState message="Road to Champions no responde ahora mismo" onRetry={noop} /></>;
      case "map-stale-error": return map(S.mid, { error: "Road to Champions no responde ahora mismo" });
      case "map-active-attempt": return map(campaignSnap(PROGRESS.mid, { active: { nodeId: "c2-n3", matchId: "qa-active", status: "STARTED", result: null, firstClear: false, settledAt: null } }));
      case "map-no-deck": return map(S.fresh, { noDecks: true, deck: null });
      case "map-first-loss": return map(S.firstLoss);

      /* ── detalle de nodo ── */
      case "node-locked": return map(S.mid, { selected: "c2-n5" });
      case "node-available": case "node-mobile-sheet": return map(S.mid, { selected: "c2-n3" });
      case "node-completed": return map(S.mid, { selected: "c1-n2" });
      case "node-elite": return map(S.mid, { selected: "c1-n4" });
      case "node-boss": return map(S.near, { selected: "c3-n5" });
      case "node-invalid-deck": return map(S.mid, { selected: "c2-n3", deck: INVALID });
      case "node-no-deck": return map(S.fresh, { selected: "c1-n1", deck: null });
      case "node-unavailable": return map(S.unavailable, { selected: "c1-n1" });
      case "node-offline": return map(S.mid, { selected: "c2-n3", offline: true });
      case "node-resume": return map(campaignSnap(PROGRESS.mid, { active: { nodeId: "c2-n3", matchId: "qa-active", status: "STARTED", result: null, firstClear: false, settledAt: null } }), { selected: "c2-n3" });
      case "node-busy-elsewhere": return map(campaignSnap(PROGRESS.mid, { active: { nodeId: "c2-n3", matchId: "qa-active", status: "STARTED", result: null, firstClear: false, settledAt: null } }), { selected: "c1-n2" });
      case "node-signed-out": return map(S.fresh, { selected: "c1-n1", signedIn: false, deck: null, decksKnown: false });

      /* ── pre-partida ── */
      case "prematch-available": case "rival-composition": return prematch(S.mid, "c2-n3");
      case "prematch-replay": return prematch(S.mid, "c1-n2");
      case "prematch-boss": return prematch(S.near, "c3-n5");
      case "prematch-invalid-deck": return prematch(S.mid, "c2-n3");
      case "prematch-no-decks": return prematch(S.fresh, "c1-n1", []);
      case "prematch-locked": return prematch(S.mid, "c3-n1");
      case "prematch-error": return prematch(S.mid, "c2-n3", [DECK_READY], "Tienes una partida en curso. Termínala o abandónala antes de jugar este nodo.");

      /* ── partida y resultado ── */
      case "match-intro": { const n = findNodeView(S.mid, "c2-n3")!; return <><Synthetic note="rival = mazo real de XLG del nodo 2-3" /><MatchIntro view={resultViews("c2-n3").board} rivalName={n.opponent.name} onDone={noop} /></>; }
      case "match-board": return <><Synthetic note="rival = mazo real de XLG del nodo 2-3" /><MatchBoard view={resultViews("c2-n3").board} onPlay={noop} busy={false} error={null} onDismissError={noop} /></>;
      case "result-first-clear": return result(campaignSnap([...PROGRESS.mid.filter((p) => p.nodeId !== "c2-n3"), { ...PROGRESS.complete.find((p) => p.nodeId === "c2-n3")! }]), "c2-n3", "win", { firstClear: true, wasCompleted: false });
      case "result-loss": return result(S.mid, "c2-n3", "loss", { firstClear: false, wasCompleted: false });
      case "result-draw": return result(S.near, "c3-n5", "draw", { firstClear: false, wasCompleted: false });
      case "result-replay-win": return result(S.mid, "c1-n2", "win", { firstClear: false, wasCompleted: true });
      case "result-chapter-complete": return result(S.ch1, "c1-n5", "win", { firstClear: true, wasCompleted: false });
      case "result-campaign-complete": return result(S.complete, "c3-n5", "win", { firstClear: true, wasCompleted: false });
      case "result-pending-sync": return result(S.mid, "c2-n3", "win", { firstClear: false, wasCompleted: false, pending: true });

      /* ── piezas sueltas e integraciones ── */
      case "hero-progress": case "economy": return <><Synthetic /><CampaignHero snapshot={S.mid} onContinue={noop} signedIn /></>;
      case "notices": return (
        <div className="space-y-2"><Synthetic />
          {(["unavailable", "offline", "error", "signin", "active", "complete"] as const).map((k) => <CampaignNotice key={k} kind={k} onRetry={k === "error" || k === "offline" ? noop : undefined} />)}
        </div>
      );
      case "profile-badge": return (
        <div className="mx-auto max-w-xl space-y-3"><Synthetic note="perfil PROPIO (el público no lo muestra)" />
          <CampaignProfileBadgeView snapshot={S.mid} />
          <CampaignProfileBadgeView snapshot={S.unavailable} />
        </div>
      );
      case "home-nextup": {
        const steps: LoopStep[] = [
          { id: "play-duel", kind: "play", label: "Juega un duelo", detail: "Ganar en normal suma 14 puntos hacia Plata.", href: "/duelos/jugar", priority: 6 },
          { id: "campaign", kind: "play", label: "Continúa Road to Champions", detail: "7/15 nodos · siguiente: Doble filo contra XLG.", href: "/jugar/road-to-champions?node=c2-n3", priority: 6.5 },
        ];
        return <><Synthetic note="pasos del vestíbulo con la campaña como secundaria" /><NextUp steps={steps} /></>;
      }
      case "navigation": return (
        <div className="mx-auto max-w-xl"><Synthetic />
          <SectionTitle as="h1">Navegación · Jugar</SectionTitle>
          <ol className="mt-2 space-y-1 text-body text-ink-secondary">
            {NAV_SECTIONS.find((s) => s.id === "jugar")!.items.map((i) => <li key={i.href}><b className="text-white">{i.label}</b> · {i.href}</li>)}
          </ol>
          <p className="mt-3 text-caption text-ink-muted">Barra móvil: {MOBILE_NAV.map((m) => `${m.label} → ${m.href}`).join(" · ")}</p>
        </div>
      );
      default:
        return <p className="text-body text-ink-muted">Escena desconocida: «{scene}».</p>;
    }
  }, [scene, deckId]);

  return <MotionConfig reducedMotion="user"><div className="mx-auto w-full max-w-[1320px] px-3 py-4 sm:px-6">{body}</div></MotionConfig>;
}
