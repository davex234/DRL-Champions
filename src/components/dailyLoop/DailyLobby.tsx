"use client";

/**
 * VESTÍBULO · COMPOSICIÓN (Fase 36).
 *
 * Jerarquía fija, la misma en todos los tamaños (en móvil se apila en este orden):
 *
 *   1. ACCIÓN PRINCIPAL (héroe)          ← lo que el servidor decidió con la prioridad única
 *      · Fase 40: si es un paso de la primera sesión, el héroe es el MISSION CONTROL del recorrido; si hay algo más
 *        urgente (partida a medias) o el jugador explora por libre, el recorrido baja a una tira; tras la primera
 *        partida, «Primera sesión completada» con los destinos reales.
 *   2. DESPUÉS (hasta 3 secundarias)
 *   3. HOY  +  TEMPORADA                 ← progreso (en escritorio y tablet, lado a lado)
 *   4. JUGAR: Road to Champions + Competitivo
 *   5. CIRCUITO: eventos + Pick'ems
 *   6. COLECCIÓN: sobres, cartas y logros
 *
 * Vista PURA: recibe la foto, el reloj y el estado de red. La usa la home y el arnés QA.
 */
import { MotionConfig } from "framer-motion";
import { NxButton } from "@/components/ui/NxButton";
import type { ShowcaseCard } from "@/components/lobby/LobbyShowcase";
import type { DailyLoopSnapshot } from "@/domain/dailyLoop";
import type { CardDef } from "@/domain/cards/types";
import { heroModel } from "@/lib/dailyLoop/presentation";
import { discoveryItems, homeJourneyMode } from "@/lib/journey/presentation";
import { JourneyMissionControl, JourneyStrip } from "@/components/journey/JourneyMissionControl";
import { JourneyDiscovery } from "@/components/journey/JourneyDiscovery";
import { DailyHero } from "./DailyHero";
import { LobbyPlayStage } from "./LobbyPlayStage";
import { LiveBlock, NextRail, PlayBlock, ReturningBanner, SeasonBlock, StashBlock, TodayBlock } from "./DailyPanels";

export type LobbyNetwork = "online" | "offline" | "error";

export function DailyLobby({
  snap, now, network = "online", stale = false, showcase = [], onRetry,
  journeyDismissed = false, onJourneyDismiss, onJourneyResume, welcomeCards = [],
}: {
  snap: DailyLoopSnapshot;
  /** Reloj estimado del servidor (nunca `Date.now()` a pelo). */
  now: number;
  network?: LobbyNetwork;
  stale?: boolean;
  showcase?: ShowcaseCard[];
  onRetry?: () => void;
  /** Fase 40 · «Explorar por mi cuenta» (preferencia de presentación, nunca estado del juego). */
  journeyDismissed?: boolean;
  onJourneyDismiss?: () => void;
  onJourneyResume?: () => void;
  /** Tres cartas reales del catálogo para la bienvenida. */
  welcomeCards?: CardDef[];
}) {
  const offline = network === "offline";
  const hero = heroModel(snap, { offline, now });
  const journeyMode = homeJourneyMode(snap, { dismissed: journeyDismissed });
  /* Fase 44 · si la acción del día ya es jugar o continuar, el héroe ES el escenario; si no, JUGAR va encima. */
  const playHero = snap.primaryAction.kind === "resume" || snap.primaryAction.kind === "play";
  const stage = journeyMode !== "mission" && !playHero;
  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-5 lg:space-y-6" data-testid="daily-lobby" data-network={network} data-stale={stale ? "true" : "false"} data-signed-in={snap.signedIn ? "true" : "false"}>
        {(network !== "online" || stale) && <NetworkNotice network={network} onRetry={onRetry} />}
        {snap.signedIn && snap.unavailable.length > 0 && network === "online" && (
          <p role="status" data-testid="daily-partial" className="text-caption text-ink-muted">Parte del vestíbulo no ha respondido; esos bloques se enseñan sin datos y no se recomiendan.</p>
        )}

        {journeyMode !== "mission" && <ReturningBanner snap={snap} />}
        {stage && <LobbyPlayStage snap={snap} offline={offline} />}
        {journeyMode === "mission" && snap.journey ? (
          <JourneyMissionControl journey={snap.journey} action={snap.primaryAction} welcomeCards={welcomeCards} offline={offline} onDismiss={() => onJourneyDismiss?.()} />
        ) : stage && snap.secondaryActions.length > 0 ? (
          /* Fase 44.1 · la acción del día y lo que viene después, en UNA fila: sin franjas anchas vacías. */
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-stretch" data-testid="lobby-today-row">
            <DailyHero hero={hero} actionId={snap.primaryAction.id} offline={offline} tier="context" play={playHero} />
            <NextRail actions={snap.secondaryActions} offline={offline} layout="stack" />
          </div>
        ) : (
          <DailyHero hero={hero} actionId={snap.primaryAction.id} offline={offline} tier={stage ? "context" : "stage"} play={playHero} />
        )}
        {journeyMode === "strip" && snap.journey && (
          <JourneyStrip journey={snap.journey} dismissed={journeyDismissed} offline={offline} onResume={() => onJourneyResume?.()}
            showCta={![snap.primaryAction, ...snap.secondaryActions].some((a) => a.id.startsWith("journey-"))} />
        )}
        {journeyMode === "discovery" && <JourneyDiscovery items={discoveryItems(snap)} offline={offline} />}
        {!(stage && snap.secondaryActions.length > 0) && <NextRail actions={snap.secondaryActions} offline={offline} />}

        {snap.signedIn ? (
          <>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <TodayBlock snap={snap} now={now} />
              <SeasonBlock snap={snap} now={now} />
            </div>
            <PlayBlock snap={snap} offline={offline} />
            <LiveBlock snap={snap} offline={offline} />
            <StashBlock snap={snap} showcase={showcase} offline={offline} />
          </>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <SeasonBlock snap={snap} now={now} />
            <LiveBlock snap={snap} offline={offline} />
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

function NetworkNotice({ network, onRetry }: { network: LobbyNetwork; onRetry?: () => void }) {
  const text = network === "offline"
    ? "Sin conexión. Enseñamos lo último que sabíamos; nada de esto es nuevo."
    : network === "error" ? "El servidor no ha respondido. Enseñamos la última foto que teníamos." : "Actualizando…";
  return (
    <div role="status" data-testid="daily-network" className="nx-clip-sm flex flex-wrap items-center justify-between gap-3 border border-warn/40 bg-warn/[0.08] px-4 py-2.5">
      <p className="font-display text-[13px] font-bold uppercase tracking-[0.1em] text-warn">{network === "offline" ? "Sin conexión" : "Sin respuesta"} <span className="ml-2 font-body text-[13px] normal-case tracking-normal text-white/80">{text}</span></p>
      {onRetry && network !== "offline" && <NxButton variant="secondary" size="md" onClick={onRetry}>Reintentar</NxButton>}
    </div>
  );
}

/** Esqueleto: la silueta del vestíbulo, sin una sola cifra (no se sabe nada todavía). */
export function DailyLobbySkeleton() {
  const bar = "nx-clip-sm animate-pulse bg-white/[0.05] motion-reduce:animate-none";
  return (
    <div aria-busy="true" aria-label="Cargando tu vestíbulo" data-testid="daily-skeleton" className="space-y-5 lg:space-y-6">
      <div className="nx-clip relative overflow-hidden border border-white/10 bg-[linear-gradient(160deg,rgba(12,15,26,0.96),rgba(6,8,14,0.98))] px-5 py-8 sm:px-9 sm:py-11">
        <div className={`${bar} h-3 w-40`} />
        <div className={`${bar} mt-4 h-12 w-3/4 max-w-xl`} />
        <div className={`${bar} mt-3 h-4 w-2/3 max-w-md`} />
        <div className={`${bar} mt-7 h-[52px] w-full sm:w-64`} />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className={`${bar} h-[64px]`} />)}</div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className={`${bar} h-64`} />
        <div className={`${bar} h-64`} />
      </div>
      <p className="sr-only" role="status">Cargando tu vestíbulo…</p>
    </div>
  );
}
