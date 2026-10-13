"use client";

/**
 * CUERPO DEL EVENT HUB (Fase 30). Recibe UN `EventHubSnapshot` (del servidor o QA SYNTHETIC en
 * el arnés) y pinta, en el orden del brief y pensado para móvil: hero → en directo / próximo →
 * tus acciones → progreso → Pick'ems → partidos → cuadro / clasificación → equipos →
 * jugadores y cartas → objetivos → recompensas → actividad. Todo derivado; nada se decide aquí.
 */
import Link from "next/link";
import { Recessed } from "@/components/ui/Surface";
import type { EventHubSnapshot, ObjectiveView } from "@/server/services/liveEvents";
import type { EventAction } from "@/domain/liveEvents/eventState";
import { EventHero } from "./EventHero";
import { LiveStrip } from "./LiveStrip";
import { EventActionsPanel } from "./EventActionsPanel";
import { EventProgressChecklist } from "./EventProgressChecklist";
import { EventPickems } from "./EventPickems";
import { EventMatches } from "./EventMatches";
import { EventBracket } from "./EventBracket";
import { EventStandings } from "./EventStandings";
import { EventTeams } from "./EventTeams";
import { EventPlayersCards } from "./EventPlayersCards";
import { EventObjectives } from "./EventObjectives";
import { EventRewards } from "./EventRewards";
import { EventActivity } from "./EventActivity";
import { SyncNotice } from "./bits";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("liveEvents");

export interface EventHubProps {
  snap: EventHubSnapshot;
  now: number;
  /** El panel REAL de Pick'ems (`PickemPanel`), montado por la página con la sesión. */
  pickemPanel?: React.ReactNode;
  onClaim?: (o: ObjectiveView) => void;
  claiming?: string | null;
  onAction?: (a: EventAction) => void;
  onPickemCta?: () => void;
  onCollectionCta?: () => void;
  onPackCta?: () => void;
  forceBracketMode?: "desktop" | "mobile";
}

export function EventHub({ snap, now, pickemPanel, onClaim, claiming, onAction, onPickemCta, onCollectionCta, onPackCta, forceBracketMode }: EventHubProps) {
  useLocale();
  return (
    <div className="mx-auto w-full max-w-5xl space-y-7" data-scene="event-hub" data-event={snap.event.id} data-lifecycle={snap.state.lifecycle}>
      <Link href="/torneos" className="nx-focus -ml-2 inline-flex min-h-[44px] items-center rounded-control px-2 font-display text-label uppercase tracking-wide2 text-ink-muted transition hover:bg-white/[0.06] hover:text-white">{t("‹ Eventos")}</Link>
      <EventHero snap={snap} />
      <SyncNotice sync={snap.sync} />
      {snap.event.isDemo && (
        <Recessed depth="sm" className="border-l-2 border-l-drl-gold px-4 py-2.5"><p className="text-caption leading-relaxed text-ink-secondary">{t("Evento de demostración: los equipos son reales, pero los resultados no corresponden a partidos reales. Tus predicciones, puntos y recompensas sí son reales.")}</p></Recessed>
      )}
      <LiveStrip eventId={snap.event.id} live={snap.liveMatches} next={snap.nextMatches[0] ?? null} />
      <EventActionsPanel actions={snap.actions} onGo={onAction} />
      <EventProgressChecklist snap={snap} />
      <EventPickems pickem={snap.pickem} signedIn={snap.signedIn} panel={pickemPanel} onCta={onPickemCta} />
      <EventMatches snap={snap} />
      <EventBracket snap={snap} now={now} forceMode={forceBracketMode} />
      <EventStandings standings={snap.standings} stages={snap.stages} />
      <EventTeams teams={snap.participants} onPackCta={onPackCta} />
      <EventPlayersCards snap={snap} onCollectionCta={onCollectionCta} />
      <EventObjectives objectives={snap.objectives} eventId={snap.event.id} signedIn={snap.signedIn} onClaim={onClaim} busy={claiming} />
      <EventRewards rewards={snap.rewards} hasPickem={snap.pickem !== null} objectivesCount={snap.objectives.items.length} signedIn={snap.signedIn} />
      <EventActivity items={snap.activity} />
    </div>
  );
}
