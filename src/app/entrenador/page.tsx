"use client";

/**
 * "El Entrenador" — un PARTIDO como una producción profesional de esports.
 *
 * Cuatro modos: PREPARACIÓN (sala táctica), RONDA (broadcast a pantalla casi completa
 * con HUD VCT + deck de control minimizado), INTERRUPCIÓN (micro/timeout devuelven el
 * foco al entrenador) y FINAL (ceremonia). Solo CONECTA y PRESENTA los motores
 * existentes vía `useCoachMatch`. No toca ninguna lógica de juego.
 */
import Link from "next/link";
import { useCoachMatch } from "@/components/sim/useCoachMatch";
import { MatchSetup } from "@/components/sim/MatchSetup";
import { MatchCeremony } from "@/components/coach/MatchCeremony";
import { CoachTacticalPanel } from "@/components/coach/CoachTacticalPanel";
import { BuyPhasePanel } from "@/components/coach/BuyPhasePanel";
import { MicroDecisionPrompt, RoundEndBriefing } from "@/components/coach/CoachOverlays";
import { CoachCommandDeck } from "@/components/coach/CoachCommandDeck";
import { LivePlayerStrip } from "@/components/coach/LivePlayerStrip";
import { LiveReadsTicker } from "@/components/coach/LiveReadsTicker";
import { TimeoutDossierPanel } from "@/components/coach/TimeoutDossierPanel";
import { RoundBriefingPanel } from "@/components/coach/RoundBriefingPanel";
import { SpecialMomentBanner } from "@/components/coach/SpecialMomentBanner";
import { liveCoachReads } from "@/lib/match/coachLive";
import { detectSpecialMoments } from "@/lib/match/special";
import { BrainDebugPanel } from "@/components/sim/BrainDebugPanel";
import { useState, useEffect, useRef } from "react";
import { useCareerStore } from "@/store/useCareerStore";
import { BroadcastOverlay } from "@/components/broadcast/BroadcastOverlay";
import { buildBroadcastState, buildMatchIntro, buildLivePresentation, buildPostMatch, postMatchCasters } from "@/broadcast";
import { MatchIntro } from "@/components/broadcast/MatchIntro";
import { CasterFeed } from "@/components/broadcast/CasterFeed";
import { LiveStatsPanel } from "@/components/broadcast/LiveStatsPanel";
import { ObserverTag } from "@/components/broadcast/ObserverTag";
import { PostMatchShow } from "@/components/broadcast/PostMatchShow";
import { buildRenderFrame, getRenderer, type RenderBackend } from "@/visualizer";
import type { Side } from "@/sim";
import { matchBroadcastContext, makeMatchConfig } from "@/match";
import { economyBroadcastContext } from "@/economy";
import { coachBroadcastContext } from "@/coach";
import { prepBroadcastContext } from "@/preparation";
import { loadoutBroadcastContext } from "@/buy";
import { useGameStore } from "@/store/useGameStore";
import { useTeamStore, resolveCardRef } from "@/store/useTeamStore";
import { validateTeam } from "@/domain/teams/types";
import { buildHomeRoster, buildRivalRoster, type RivalDifficulty } from "@/lib/match/roster";
import { cardView } from "@/lib/match/cardView";
import { primeAudio, playCue } from "@/lib/sound";
import { cn } from "@/lib/format";

const SPEEDS = [1, 2, 4, 8];
const BACKEND: RenderBackend = "svg";
const Renderer = getRenderer(BACKEND);
const RIVAL_NAME: Record<RivalDifficulty, string> = { easy: "Rival (Fácil)", normal: "Rival (Normal)", hard: "Rival (Difícil)" };

export default function EntrenadorPage() {
  const loop = useCoachMatch();
  const { phase, snap, view, match } = loop;
  const [brainDebug, setBrainDebug] = useState(false);
  const [brainSel, setBrainSel] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(false);

  const ownedCards = useGameStore((s) => s.ownedCards);
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const markUsed = useTeamStore((s) => s.markUsed);

  const active = teams.find((t) => t.id === activeTeamId) ?? null;
  const ready = active != null && validateTeam(active, resolveCardRef).length === 0;

  // PLAYER DEVELOPMENT: al terminar el partido, evoluciona a TODOS los participantes
  // (equipo del usuario + rival IA) una sola vez.
  const processedRef = useRef<unknown>(null);
  useEffect(() => {
    if (phase === "ended" && match && processedRef.current !== match) {
      processedRef.current = match;
      useCareerStore.getState().processMatch(match);
    }
  }, [phase, match]);

  const play = (side: Side, difficulty: RivalDifficulty) => {
    if (!active || !ready) return;
    primeAudio();
    const seed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const { roster: home, playerIds } = buildHomeRoster(active.starters, ownedCards);
    const away = buildRivalRoster((seed ^ 0x9e3779b9) >>> 0, playerIds, difficulty);
    // PLAYER DEVELOPMENT: inyecta la progresión persistida (deltas + química) en los
    // rosters. El sim consume los valores evolucionados sin cambios.
    const career = useCareerStore.getState();
    const config = makeMatchConfig({
      seed, rosters: { home: career.developRoster(home), away: career.developRoster(away) },
      homeSetup: { side, approach: "default", tempo: "mid", aggression: "balanced" },
      teamNames: { home: active.name, away: RIVAL_NAME[difficulty] },
      coach: { mode: "ai" },
      useEconomyTactics: true,
    });
    markUsed(active.id);
    setShowIntro(true);   // INTRO de "gran final" antes del primer saque
    loop.start(config);
  };

  // Retransmisión: datos REALES del partido.
  const bs = snap && view && match ? buildBroadcastState({
    state: snap, decision: view.decision, viewport: view.vp,
    match: matchBroadcastContext(match),
    economy: match.economy ? economyBroadcastContext(match.economy, match.currentHomeSide) : undefined,
    prep: match.currentDecision ? coachBroadcastContext(match.currentDecision)
      : match.currentPlan ? prepBroadcastContext(match.currentPlan) : undefined,
    loadout: match.currentLoadouts ? loadoutBroadcastContext(match.currentLoadouts, match.currentHomeSide) : undefined,
  }) : null;
  const frame = snap && view ? buildRenderFrame({ state: snap, viewport: view.vp, broadcast: bs }) : null;

  const homeSide = match?.currentHomeSide ?? "ATK";
  const tn = match?.config.teamNames ?? { home: "Local", away: "Rival" };
  const names = {
    atk: homeSide === "ATK" ? tn.home : tn.away,
    def: homeSide === "ATK" ? tn.away : tn.home,
  };
  const creditsByName: Record<string, number> = {};
  if (match?.economy) Object.assign(creditsByName, match.economy.home.players, match.economy.away.players);

  // MATCH PRESENTATION ENGINE: presentación viva (casters/stats/observer) + intro + post.
  const live = bs && snap && match ? buildLivePresentation(snap, bs, match, names) : null;
  const intro = match ? buildMatchIntro(match) : null;

  const showField = (phase === "playing" || phase === "roundEnd") && frame;

  return (
    <section className="animate-rise space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            El <span className="text-drl">Entrenador</span>
          </h1>
          <p className="mt-1 text-white/50">Diriges, no disparas. <strong className="text-white/70">Tu equipo, tu producción.</strong></p>
        </div>
        {phase !== "menu" && phase !== "ended" && (
          <button onClick={loop.reset}
            className="rounded-lg border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/60 transition hover:bg-white/10">
            ← Abandonar
          </button>
        )}
      </header>

      {/* MENÚ */}
      {phase === "menu" && (
        ready && active ? (
          <div className="space-y-4"><ActiveTeamBar /><MatchSetup onPlay={play} initial={null} /></div>
        ) : <TeamGate hasTeams={teams.length > 0} />
      )}

      {/* SALA TÁCTICA */}
      {phase === "preparation" && loop.prep && (
        <CoachTacticalPanel prep={loop.prep} onConfirm={(i) => { playCue("ui"); loop.confirmPreparation(i); }} />
      )}

      {/* COMPRA */}
      {phase === "buy" && loop.buy && (
        <BuyPhasePanel buy={loop.buy} onConfirm={(t) => { playCue("whoosh"); loop.confirmBuy(t); }} />
      )}

      {/* RONDA (broadcast + dirección en vivo) */}
      {phase === "playing" && (
        <div className="space-y-3">
          {match && snap && (
            <SpecialMomentBanner moments={detectSpecialMoments(match, snap)} onCommand={(c) => { playCue("ui"); loop.command(c); }} />
          )}
          <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
            <div className="space-y-3">
              {live && <ObserverTag live={live} />}
              <Stage live mapName={bs?.match.map}>
                {showField && <Renderer frame={frame!} />}
                {bs && <BroadcastOverlay bs={bs} snap={snap} creditsByName={creditsByName} names={names} momentum={match?.momentum ?? 0} />}
                {loop.micro && <MicroDecisionPrompt prompt={loop.micro} onRespond={(c) => { playCue("ui"); loop.respondMicro(c); }} />}
                {loop.timeoutPanel && <TimeoutDossierPanel dossier={loop.timeoutPanel} onRespond={(c) => { playCue("ui"); loop.respondTimeout(c); }} />}
                {brainDebug && snap && <BrainDebugPanel snap={snap} selectedId={brainSel} onSelect={setBrainSel} onClose={() => setBrainDebug(false)} />}
              </Stage>
              <ControlDeck loop={loop} brainDebug={brainDebug} onBrain={() => setBrainDebug((b) => !b)} />
              {live && <LiveStatsPanel stats={live.stats} />}
            </div>
            {/* Panel de dirección + cabina de comentaristas. */}
            <aside className="space-y-3">
              {live && <CasterFeed lines={live.casters} />}
              {snap && <CoachCommandDeck snap={snap} onCommand={(c) => { playCue("ui"); loop.command(c); }} />}
              {match && snap && <LiveReadsTicker reads={liveCoachReads(match, snap)} vozLeft={snap.voz.left} onCommand={(c) => { playCue("ui"); loop.command(c); }} />}
            </aside>
          </div>
          {snap && <LivePlayerStrip snap={snap} />}
        </div>
      )}

      {/* INTERRUPCIÓN: fin de ronda */}
      {phase === "roundEnd" && loop.roundEnd && (
        <div className="space-y-3">
          {showField && (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-[#070a0f] opacity-60">
              <Renderer frame={frame!} />
              {bs && <BroadcastOverlay bs={bs} snap={snap} creditsByName={creditsByName} names={names} momentum={match?.momentum ?? 0} />}
            </div>
          )}
          <RoundEndBriefing view={loop.roundEnd} onContinue={() => { playCue("ui"); loop.continueAfterRound(); }} isLast={loop.roundEnd.isLast} />
          {!loop.roundEnd.isLast && <RoundBriefingPanel briefing={loop.roundEnd.briefing} />}
        </div>
      )}

      {/* FINAL: ceremonia + producción televisiva post-partido */}
      {phase === "ended" && match && (
        <div className="space-y-5">
          <MatchCeremony match={match} reward={loop.reward} onAgain={() => { setShowIntro(true); play(homeSide, "normal"); }} onCollection={loop.reset} />
          <PostMatchShow post={buildPostMatch(match)} casters={postMatchCasters(match)} />
        </div>
      )}

      {/* INTRO DE PARTIDO (overlay cinemático antes del primer saque) */}
      {showIntro && intro && phase !== "menu" && phase !== "ended" && (
        <MatchIntro intro={intro} onStart={() => { playCue("whoosh"); setShowIntro(false); }} />
      )}
    </section>
  );
}

/** Escenario cinemático: marco de retransmisión con viñeta, letterbox y "EN VIVO". */
function Stage({ children, live, mapName }: { children: React.ReactNode; live?: boolean; mapName?: string }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-[#070a0f] shadow-[0_10px_50px_rgba(0,0,0,0.6)]">
      {children}
      {/* viñeta */}
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 140px rgba(0,0,0,0.75)" }} />
      {/* letterbox sutil */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/60 to-transparent" />
      {/* EN VIVO */}
      {live && (
        <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-1.5 rounded bg-black/55 px-2 py-0.5 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_6px_#ff0000]" />
          <span className="font-display text-[9px] font-bold uppercase tracking-[0.25em] text-white/80">En vivo</span>
        </div>
      )}
    </div>
  );
}

/** Deck de control minimizado durante la ronda (elegante, no debug). */
function ControlDeck({ loop, brainDebug, onBrain }: { loop: ReturnType<typeof useCoachMatch>; brainDebug: boolean; onBrain: () => void }) {
  const { match, snap } = loop;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-base-800/60 px-3 py-2 backdrop-blur-sm">
      <button onClick={() => loop.setPaused(!loop.paused)}
        className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 font-display text-xs uppercase tracking-wide text-white transition hover:bg-white/10">
        {loop.paused ? "▶ Reanudar" : "⏸ Pausa"}
      </button>
      <div className="flex gap-1 rounded-lg border border-white/10 bg-base-900/60 p-0.5">
        {SPEEDS.map((sp) => (
          <button key={sp} onClick={() => loop.setSpeed(sp)}
            className={cn("rounded-md px-3 py-1.5 font-display text-xs transition", loop.speed === sp ? "bg-drl text-white shadow-glow" : "text-white/50 hover:text-white")}>
            {sp}×
          </button>
        ))}
      </div>
      <button onClick={loop.callTimeout} disabled={loop.timeoutsLeft <= 0 || loop.timeoutPanel != null || loop.micro != null}
        className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 font-display text-xs uppercase tracking-wide text-cyan-200 transition enabled:hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-30">
        ⏸ Timeout · {loop.timeoutsLeft}
      </button>
      <button onClick={onBrain}
        className={cn("rounded-lg border px-4 py-2 font-display text-xs uppercase tracking-wide transition",
          brainDebug ? "border-drl/50 bg-drl/15 text-drl" : "border-white/15 text-white/60 hover:bg-white/10")}>
        🧠 Cerebro
      </button>
      {snap && (
        <span className="rounded-lg border border-white/10 bg-base-900/60 px-3 py-1.5 font-display text-xs text-white/55">
          🎙 Voz {snap.voz.left}/{snap.voz.total}
        </span>
      )}
      {match && (
        <span className="ml-auto rounded-lg border border-white/10 bg-base-900/60 px-3 py-1.5 font-display text-xs text-white/70">
          Ronda {match.roundNumber} · {match.score.home}-{match.score.away}
        </span>
      )}
    </div>
  );
}

/** Cabecera con el equipo activo y su quinteto real (de la colección). */
function ActiveTeamBar() {
  const ownedCards = useGameStore((s) => s.ownedCards);
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const active = teams.find((t) => t.id === activeTeamId);
  if (!active) return null;

  const byUid = new Map(ownedCards.map((o) => [o.uid, o]));
  const starters = active.starters
    .map((uid) => byUid.get(uid))
    .map((o) => (o ? cardView(o) : null))
    .filter((v): v is NonNullable<typeof v> => v != null);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-base-700/40 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-drl/15 text-lg">{active.logo ?? "🛡️"}</span>
        <div>
          <p className="font-display text-sm font-bold uppercase tracking-wide text-white">{active.name}</p>
          <p className="text-[11px] text-white/45">Tu quinteto · tus cartas</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {starters.map((c) => (
          <span key={c.uid} className="rounded-md border border-white/10 bg-base-800 px-2 py-1 text-[11px] text-white/80">
            <span className="font-semibold text-white">{c.nick}</span>
            <span className="ml-1 text-white/40">{c.ovr}</span>
          </span>
        ))}
      </div>
      <Link href="/entrenador/equipos"
        className="rounded-lg border border-white/15 px-3 py-1.5 font-display text-[11px] uppercase tracking-wide text-white/70 transition hover:bg-white/10">
        Cambiar equipo
      </Link>
    </div>
  );
}

/** Pantalla cuando no hay equipo válido: empuja al Roster Builder. */
function TeamGate({ hasTeams }: { hasTeams: boolean }) {
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-white/10 bg-base-700/40 p-8 text-center">
      <p className="text-3xl">🧩</p>
      <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">Necesitas un equipo</h2>
      <p className="text-sm text-white/55">
        El simulador juega con <strong className="text-white/80">tus cartas</strong>. Crea un equipo de 5 jugadores
        desde tu colección para poder jugar.
      </p>
      <Link href="/entrenador/equipos"
        className="inline-block rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
        {hasTeams ? "Gestionar equipos ▸" : "Crear mi primer equipo ▸"}
      </Link>
    </div>
  );
}
