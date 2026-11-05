"use client";

/**
 * ARNÉS QA · FASE 30 — `/design-system/fase30?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES de Live Events (`EventsOverview`, `EventHub` y sus secciones,
 * `MatchCenter`, `LobbyCircuit`) con snapshots **QA SYNTHETIC** (`./fixtures`): eventos, equipos,
 * jugadores, partidos y cartas inventados con nombres ficticios. El cuadro se construye con el
 * motor real de la Fase 24 sobre esos partidos. Sin sesión, sin red: manejadores no-op.
 */
import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { ErrorState, NeedsAccount } from "@/components/ui/States";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { EventsOverview } from "@/components/liveEvents/EventsOverview";
import { EventHub } from "@/components/liveEvents/EventHub";
import { MatchCenter } from "@/components/liveEvents/MatchCenter";
import { EventBracket } from "@/components/liveEvents/EventBracket";
import { LobbyCircuit } from "@/components/lobby/LobbyCircuit";
import {
  OVERVIEW, OVERVIEW_MULTI, OVERVIEW_EMPTY, OVERVIEW_STALE, HUB_LIVE, HUB_TWO_LIVE, HUB_NO_LIVE, HUB_UPCOMING, HUB_COMPLETED, HUB_NO_PICKEMS,
  HUB_PICKEMS_DONE, HUB_LEAGUE, HUB_NO_PACK, HUB_NO_OBJECTIVES, HUB_REWARD, HUB_NO_CARDS, HUB_STALE, HUB_ANON, HUB_DEMO, MATCH_LIVE, MATCH_DONE, MATCH_TBD, QA_NOW,
} from "./fixtures";

const SCENES = [
  "overview", "overview-multi", "overview-upcoming", "overview-completed", "overview-empty", "overview-stale",
  "hub", "hub-two-live", "hub-no-live", "hub-upcoming", "hub-completed", "hub-no-pickems", "hub-pickems-done", "hub-league", "hub-no-pack",
  "hub-no-objectives", "hub-reward", "hub-no-cards", "hub-stale", "hub-anon", "hub-demo", "bracket", "bracket-mobile",
  "match", "match-done", "match-tbd", "home-card", "backend-error", "no-session",
] as const;

const noop = () => {};

export default function Fase30QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  // En móvil, las escenas de sección se capturan sobre la sección (el hero queda arriba, fuera del viewport).
  useEffect(() => {
    const anchor: Record<string, string> = { "hub-no-pickems": "#pickems", "hub-pickems-done": "#pickems", "hub-no-pack": "#equipos", "hub-no-objectives": "#objetivos", "hub-reward": "#objetivos", "hub-no-cards": "#cartas", "hub-league": "#cuadro" };
    const sel = anchor[scene];
    if (!sel || window.innerWidth >= 640) return;
    const id = window.setTimeout(() => document.querySelector(sel)?.scrollIntoView({ block: "start" }), 600);
    return () => window.clearTimeout(id);
  }, [scene]);

  const hubOf = (snap: typeof HUB_LIVE) => <EventHub snap={snap} now={QA_NOW} pickemPanel={<div className="nx-clip-sm border border-dashed border-white/15 px-4 py-6 text-center text-caption text-ink-muted">Aquí se monta el panel real de Pick&apos;ems (`PickemPanel`), que necesita sesión y red.</div>} onClaim={noop} onAction={noop} />;

  const body = () => {
    switch (scene) {
      case "overview": return <EventsOverview snap={OVERVIEW} />;
      case "overview-multi": return <EventsOverview snap={OVERVIEW_MULTI} />;
      case "overview-upcoming": return <EventsOverview snap={{ ...OVERVIEW, active: [], completed: [] }} />;
      case "overview-completed": return <EventsOverview snap={{ ...OVERVIEW, active: [], upcoming: [] }} />;
      case "overview-empty": return <EventsOverview snap={OVERVIEW_EMPTY} />;
      case "overview-stale": return <EventsOverview snap={OVERVIEW_STALE} />;
      case "hub": return hubOf(HUB_LIVE);
      case "hub-two-live": return hubOf(HUB_TWO_LIVE);
      case "hub-no-live": return hubOf(HUB_NO_LIVE);
      case "hub-upcoming": return hubOf(HUB_UPCOMING);
      case "hub-completed": return hubOf(HUB_COMPLETED);
      case "hub-no-pickems": return hubOf(HUB_NO_PICKEMS);
      case "hub-pickems-done": return hubOf(HUB_PICKEMS_DONE);
      case "hub-league": return hubOf(HUB_LEAGUE);
      case "hub-no-pack": return hubOf(HUB_NO_PACK);
      case "hub-no-objectives": return hubOf(HUB_NO_OBJECTIVES);
      case "hub-reward": return hubOf(HUB_REWARD);
      case "hub-no-cards": return hubOf(HUB_NO_CARDS);
      case "hub-stale": return hubOf(HUB_STALE);
      case "hub-anon": return <EventHub snap={HUB_ANON} now={QA_NOW} />;
      case "hub-demo": return hubOf(HUB_DEMO);
      case "bracket": return <EventBracket snap={HUB_LIVE} now={QA_NOW} forceMode="desktop" />;
      case "bracket-mobile": return <EventBracket snap={HUB_LIVE} now={QA_NOW} forceMode="mobile" />;
      case "match": return <MatchCenter snap={MATCH_LIVE} />;
      case "match-done": return <MatchCenter snap={MATCH_DONE} />;
      case "match-tbd": return <MatchCenter snap={MATCH_TBD} />;
      case "home-card": return (
        <div className="max-w-5xl">
          <LobbyCircuit
            tournament={{ id: "qa-ev-live", name: "QA Invitational 2026", demo: false }}
            live={{ label: "En curso", lifecycle: "ACTIVE", liveCount: 1, nextWhen: "hoy 20:30" }}
            matches={[{ id: "qa-m-q3", teamA: "Basalto Club", teamB: "Cierzo Esports", live: true, when: "" }, { id: "qa-m-q4", teamA: "Fulgor", teamB: "Granizo", live: false, when: "hoy 20:30" }]}
            pickem={{ open: 5, pending: 3 }} ranking={[]} reward={null}
          />
        </div>
      );
      case "backend-error": return <ErrorState message="No se pudo leer el evento" onRetry={noop} />;
      case "no-session": return <NeedsAccount what="Tus predicciones" />;
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase30?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-5xl px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 30 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">eventos, equipos, jugadores, partidos y cartas inventados · motor real del cuadro · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
