"use client";

/**
 * FASE 44 · ESCENARIO DE JUEGO DEL VESTÍBULO — «qué puedo jugar», en los primeros tres segundos.
 * FASE 44.1 · EL CENTRO DEL LOBBY: más alto, translúcido sobre la arena del ambiente (se ve el mundo detrás), con
 * anillos de energía detrás de JUGAR y fichas de modo que, al apuntarlas o enfocarlas, tiñen el ambiente del lobby
 * (`nexus:env-focus`: PvE cian, ranked magenta, campaña azul profundo, draft ámbar) en ~320 ms.
 *
 * Presentación, no prioridad: el Live Service (`orderToday`) sigue decidiendo la acción del día y la enseña el héroe
 * justo debajo. Este escenario solo aparece cuando esa acción NO es ya jugar/continuar (entonces el héroe ES el
 * escenario) y fuera de la guía de la primera sesión (la guía manda). Dice con hechos reales con qué equipo juegas y
 * dónde está cada modo, y pone JUGAR como la acción dominante del lobby.
 */
import Link from "next/link";
import { PlayButton } from "@/components/ui/game/PlayButton";
import { playCta } from "@/design/gameShell";
import type { DailyLoopSnapshot } from "@/domain/dailyLoop";
import { DAILY_ROUTES } from "@/domain/dailyLoop";
import { campaignModel, competitiveModel } from "@/lib/dailyLoop/presentation";
import { PLACEMENT_GAMES } from "@/domain/cardgame/rating/types";
import { ENV_FOCUS_EVENT, type EnvironmentFocus } from "@/design/environment";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/format";

interface ModeLink { id: Exclude<EnvironmentFocus, null>; label: string; kicker: string; fact: string; href: string; rgb: string }

export function lobbyModes(snap: DailyLoopSnapshot): ModeLink[] {
  const camp = campaignModel(snap);
  const comp = competitiveModel(snap, PLACEMENT_GAMES);
  const run = snap.service?.draftRun ?? null;
  return [
    { id: "quick", label: "Partida rápida", kicker: "PvE", fact: "Contra un bot · 10 turnos", href: DAILY_ROUTES.quick, rgb: "25,227,255" },
    { id: "campaign", label: "Road to Champions", kicker: "Campaña", fact: camp ? `${camp.progressLabel} nodos` : "Campaña contra rosters reales", href: DAILY_ROUTES.campaign, rgb: "90,140,255" },
    { id: "ranked", label: "Competitivo", kicker: "Ranked", fact: comp ? (comp.stateLabel === "Sin partidas" ? "Sin rating todavía" : `Rating ${comp.ratingLabel}`) : "Rating y escalera", href: DAILY_ROUTES.competitive, rgb: "255,46,99" },
    { id: "draft", label: "Draft Gauntlet", kicker: "Draft", fact: run ? (run.status === "DRAFTING" ? "Draft a medias" : `Fase ${run.stage} de 5`) : "Plantilla carta a carta", href: "/jugar/draft-gauntlet", rgb: "255,176,61" },
  ];
}

/** Avisa al ambiente del modo apuntado (o de que ya no hay ninguno). Nunca decide nada. */
export function focusEnvironment(mode: EnvironmentFocus): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ENV_FOCUS_EVENT, { detail: mode }));
}

const GLYPH: Record<ModeLink["id"], React.ReactNode> = {
  quick: <path d="M20 12 44 30 20 48Z" />,
  campaign: <path d="M6 50 C 18 36, 26 44, 34 30 S 48 16, 58 12" strokeDasharray="4 5" />,
  ranked: <><path d="M10 50h12V38H10zM26 50h12V26H26zM42 50h12V14H42z" /></>,
  draft: <><path d="M14 16h14v26H14z" transform="rotate(-10 21 29)" /><path d="M25 12h14v26H25z" /><path d="M36 16h14v26H36z" transform="rotate(10 43 29)" /></>,
};

export function LobbyPlayStage({ snap, offline = false }: { snap: DailyLoopSnapshot; offline?: boolean }) {
  const deck = snap.deck;
  const ready = deck?.state === "READY";
  const modes = lobbyModes(snap);
  const deckLine = !snap.signedIn ? "Entra para jugar con tus cartas"
    : !deck ? "Tu equipo se comprueba al elegir modo"
      : ready && deck.active ? `${deck.active.name} · ${deck.active.sumOvr} OVR`
        : deck.state === "NONE" ? "Todavía no tienes equipo" : "Tu equipo está incompleto";
  return (
    <section
      aria-labelledby="lobby-play-title"
      data-testid="lobby-play-stage"
      data-motion-level="2"
      className="nx-clip nx-lobby-stage border border-drl/40 px-5 py-7 sm:px-10 sm:py-10 lg:min-h-[470px]"
      style={{ background: "radial-gradient(760px 520px at 18% 78%, rgba(255,46,99,0.30), transparent 64%), radial-gradient(620px 420px at 100% -10%, rgba(25,227,255,0.16), transparent 60%), linear-gradient(160deg, rgba(14,10,26,0.62), rgba(5,6,12,0.82))" }}
      onMouseLeave={() => focusEnvironment(null)}
    >
      <span aria-hidden className="nx-lobby-stage-lines" />
      {/* Anillos de la arena detrás de JUGAR: el foco del lobby. Estáticos (el movimiento lo pone el ambiente). */}
      <svg aria-hidden viewBox="0 0 600 600" className="nx-stage-rings pointer-events-none absolute -left-24 top-1/2 -z-10 hidden h-[640px] w-[640px] -translate-y-1/2 lg:block">
        {[120, 180, 245].map((r, i) => <polygon key={r} points={Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 3) * k - Math.PI / 2; return `${300 + r * Math.cos(a)},${330 + r * Math.sin(a)}`; }).join(" ")} fill="none" stroke={`rgba(255,46,99,${0.36 - i * 0.1})`} strokeWidth={i === 0 ? 2 : 1} />)}
        <line x1="300" y1="0" x2="300" y2="85" stroke="rgba(25,227,255,0.35)" /><line x1="300" y1="575" x2="300" y2="600" stroke="rgba(25,227,255,0.35)" />
      </svg>

      <div className="grid items-center gap-8 lg:min-h-[390px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <p className="nx-label text-drl">NEXUS · Lobby</p>
          <h2 id="lobby-play-title" className="mt-2 font-display text-[clamp(38px,5.8vw,76px)] font-bold uppercase leading-[0.88] text-white">
            Tu próxima <span className="block text-drl" style={{ textShadow: "0 0 40px rgba(255,46,99,0.55)" }}>partida</span>
          </h2>
          <p className="mt-4 flex flex-wrap items-center gap-2 text-[15px] text-white/80" data-testid="lobby-deck-line" data-ready={ready ? "true" : "false"}>
            <span className={cn("nx-clip-sm inline-flex items-center gap-1.5 border px-2 py-1 font-display text-[12px] font-bold uppercase tracking-[0.14em]", ready ? "border-ok/50 text-ok" : "border-warn/50 text-warn")}>
              <span aria-hidden className={cn("h-1.5 w-1.5", ready ? "bg-ok" : "bg-warn")} />
              {ready ? "Equipo listo" : "Equipo"}
            </span>
            {deckLine}
            {snap.signedIn && deck && !ready && (
              <Link href={deck.state === "NONE" ? DAILY_ROUTES.newDeck : DAILY_ROUTES.decks} className="font-display text-[13px] font-bold uppercase tracking-[0.12em] text-drl-cyan underline-offset-4 hover:underline">
                {deck.state === "NONE" ? "Crear equipo" : "Completar equipo"}
              </Link>
            )}
          </p>
          {/* Por debajo de `lg` el JUGAR dominante es el del dock (siempre visible): aquí no se repite. */}
          <div className="mt-8 hidden lg:block">
            <PlayButton cta={playCta(null)} size="hero" testId="lobby-play" />
          </div>
          {offline && <p role="status" className="mt-3 text-[13px] text-warn">Sin conexión: puedes elegir modo, las partidas empiezan al volver la red.</p>}
        </div>

        <nav aria-label="Modos de juego" className="grid grid-cols-2 gap-3" data-testid="lobby-modes">
          {modes.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              data-mode={m.id}
              onMouseEnter={() => { focusEnvironment(m.id); playSound("ui.hover"); }}
              onFocus={() => focusEnvironment(m.id)}
              onBlur={() => focusEnvironment(null)}
              onClick={() => playSound("ui.confirm")}
              className="nx-mode nx-clip-sm group relative isolate flex min-h-[132px] flex-col justify-between overflow-hidden border px-4 py-3.5 lg:min-h-[168px]"
              style={{ borderColor: `rgba(${m.rgb},0.42)`, background: `linear-gradient(160deg, rgba(${m.rgb},0.16), rgba(6,7,13,0.72) 72%)` }}
            >
              <span aria-hidden className="nx-mode-glow pointer-events-none absolute -right-10 -top-12 -z-10 h-36 w-36" style={{ background: `radial-gradient(closest-side, rgba(${m.rgb},0.55), transparent)` }} />
              <svg aria-hidden viewBox="0 0 64 64" className="nx-mode-art pointer-events-none absolute right-3 top-3 -z-10 h-9 w-9 opacity-40 xl:bottom-3 xl:top-auto xl:h-14 xl:w-14 xl:opacity-45" fill="none" stroke={`rgb(${m.rgb})`} strokeWidth="2">{GLYPH[m.id]}</svg>
              <span className="font-display text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: `rgb(${m.rgb})` }}>{m.kicker}</span>
              <span>
                <span className="block font-display text-[21px] font-bold uppercase leading-none text-white lg:text-[24px]">{m.label}</span>
                <span className="mt-1.5 block text-[13px] text-white/65">{m.fact}</span>
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
