"use client";

/**
 * DUELOS · `/duelos` — F72 · DUELS 2.0: SELECCIONAR MODO → VER LO NECESARIO → JUGAR.
 *
 * Cuatro tarjetas de la MISMA familia (arte protagonista, título enorme): PARTIDA RÁPIDA, COMPETITIVO, RETAR A UN
 * AMIGO y DRAFT GAUNTLET. Pulsar una la SELECCIONA (no navega): crece (2 de 5 columnas en escritorio; se despliega en
 * móvil) y enseña dentro lo mínimo y UN botón grande, el mismo para todos:
 *
 *   PARTIDA RÁPIDA → JUGAR (flujo de siempre, sin pasos nuevos)
 *   COMPETITIVO    → tu rango/rating REAL (sin clasificar · #puesto) → JUGAR = cola ranked directa (`?buscar=`)
 *   RETAR          → RETAR (flujo social existente)
 *   DRAFT          → ENTRADA + escalera de premios → ENTRAR · 2.000 (confirmación) · o CONTINUAR con la run activa
 *
 * `/competitivo` sigue siendo la página de detalle (clasificación, historial, temporada): aquí solo un enlace discreto.
 * Esta pieza no decide reglas ni datos: estados y destinos salen de `gameModes()` y `lib/duels/selector`.
 */
import { useState } from "react";
import Link from "next/link";
import { MotionConfig, motion } from "framer-motion";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { duelModes, type DraftModeFacts, type DuelModeId, type GameModeCard } from "@/lib/campaign/presentation";
import {
  draftCta, draftProgress, initialDuelMode, rankedCta, rankedHeadline, creditsLabel, type RankedInline, type SelectorCta,
} from "@/lib/duels/selector";
import type { RankedGate } from "@/domain/pvpLadder/ranked";
import type { DraftEconomyView } from "@/domain/draft/economy";
import type { EnvironmentFocus } from "@/design/environment";
import { focusEnvironment } from "@/components/dailyLoop/LobbyPlayStage";
import { playSound } from "@/lib/sound";
import { CompetitiveEmblem } from "@/components/competitive/ranked/CompetitiveEmblem";
import { DraftEntryButton, DraftRewardLadder } from "@/components/draft/DraftEntry";
import { AgentPanelArt, PanelImage } from "./ModePanel";

export const DUEL_TINT: Record<DuelModeId, string> = {
  QUICK: "63,192,122", RANKED: "255,46,99", FRIEND: "150,120,255", DRAFT_GAUNTLET: "255,211,92",
};
const DUEL_FOCUS: Record<DuelModeId, Exclude<EnvironmentFocus, null>> = { QUICK: "quick", RANKED: "ranked", FRIEND: "ranked", DRAFT_GAUNTLET: "draft" };

function Art({ id, on = false }: { id: DuelModeId; on?: boolean }) {
  const rgb = DUEL_TINT[id];
  const glow = <span className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 50% 45%, rgba(${rgb},0.34), transparent 72%)` }} />;
  if (id === "QUICK") return <>{glow}<AgentPanelArt agentId="raze" side="center" /></>;
  if (id === "RANKED") {
    return (
      <>
        <PanelImage src="/game/arenas/nexus-champions/stage-960.webp" eager position="50% 45%" />
        <span className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,46,99,0.12), rgba(30,0,10,0.35))" }} />
      </>
    );
  }
  if (id === "FRIEND") return <>{glow}<AgentPanelArt agentId="phoenix" side="left" width="62%" opacity={0.8} /><AgentPanelArt agentId="reyna" side="right" width="62%" /></>;
  return (
    <>
      {glow}
      <svg viewBox="0 0 160 120" className={cn("absolute inset-x-0 mx-auto w-full transition-all duration-300", on ? "top-[2%] h-[30%] opacity-70" : "top-[4%] h-[56%]")}>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={48 + i * 26} y={24 + (i === 1 ? -8 : 4)} width="40" height="60" rx="2"
            fill={`rgba(${rgb},${i === 1 ? 0.2 : 0.1})`} stroke={`rgba(${rgb},0.9)`} strokeWidth={i === 1 ? 1.6 : 1}
            transform={`rotate(${(i - 1) * 12} ${68 + i * 26} 54)`} />
        ))}
      </svg>
    </>
  );
}

/** El botón del modo seleccionado: SIEMPRE el grande (mismo peso para los cuatro). */
const HERO_CTA = "min-h-[60px] !text-[20px] font-bold tracking-[0.18em]";

function Cta({ id, cta, onDraftEnter, draftBusy }: { id: DuelModeId; cta: SelectorCta; onDraftEnter?: () => void; draftBusy?: boolean }) {
  const testId = `duel-mode-cta-${id}`;
  if (cta.kind === "enter") {
    return (
      <>
        <DraftEntryButton fee={cta.fee} disabled={cta.disabled || !onDraftEnter} busy={draftBusy} onConfirm={() => onDraftEnter?.()} testId={testId} className={HERO_CTA} />
        {cta.reason && <p className="mt-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-drl-gold" data-testid="duel-draft-short">{cta.reason}</p>}
      </>
    );
  }
  if (cta.kind === "wait") {
    return <NxButton variant="primary" size="lg" block disabled className={HERO_CTA} data-cta="primary" data-testid={testId}>{cta.label}</NxButton>;
  }
  return (
    <NxButton variant="primary" size="lg" block href={cta.href} className={HERO_CTA} data-cta="primary" data-testid={testId} onClick={() => playSound("play.confirm")}>
      {cta.label}
    </NxButton>
  );
}

function RankedBlock({ ranked }: { ranked: RankedInline | null | "loading" | "error" }) {
  if (ranked === "loading" || ranked === null) {
    return <div data-testid="duel-ranked-inline" data-state="loading" className="h-[120px] animate-pulse rounded bg-white/[0.05]" aria-busy="true" />;
  }
  if (ranked === "error") return null;
  const h = rankedHeadline(ranked);
  return (
    <div data-testid="duel-ranked-inline" data-state={ranked.state} className="flex items-center gap-4">
      <CompetitiveEmblem rank={ranked.rank ?? null} state={ranked.rank || ranked.state !== "RANKED" ? ranked.state : "UNRANKED"} placement={{ played: ranked.placementPlayed, total: ranked.placementTotal }} position={ranked.position} size="md" />
      <div className="min-w-0">
        <p className="font-display text-[clamp(30px,3vw,44px)] font-bold uppercase leading-none text-white" data-field="rank" style={{ textShadow: "0 0 24px rgba(255,46,99,0.45)" }}>{h.big}</p>
        <p className="nx-readout mt-2 text-[22px] leading-none text-white/90" data-field="rating">{h.label}</p>
      </div>
    </div>
  );
}

export interface DuelModesHubProps {
  /** `gameModes(facts)` completo; aquí se usan los cuatro de duelo. */
  cards: GameModeCard[];
  /** Modo pedido por la URL (`?modo=`). */
  requested?: string | null;
  onSelect?: (id: DuelModeId) => void;
  /** Rango REAL del competitivo (del servidor). `null` = aún no pedido. */
  ranked?: RankedInline | null | "loading" | "error";
  /** Puerta de juego ranked (equipos legales / partida abierta), de `rankedGate` (F55). */
  rankedGate?: RankedGate | null | "error";
  draftFacts?: DraftModeFacts | null | "loading";
  draftEconomy?: DraftEconomyView | null;
  /** Saldo conocido por el cliente (solo para avisar antes; el cobro lo decide el servidor). */
  credits?: number | null;
  onDraftEnter?: () => void;
  draftBusy?: boolean;
  draftNotice?: string | null;
  replays?: { matchId: string; status: string; scoreYou: number; scoreRival: number; deckName: string }[];
  offline?: boolean;
  className?: string;
}

export function DuelModesHub({
  cards, requested = null, onSelect, ranked = null, rankedGate = null, draftFacts, draftEconomy = null, credits = null,
  onDraftEnter, draftBusy = false, draftNotice = null, replays = [], offline = false, className,
}: DuelModesHubProps) {
  const modes = duelModes(cards);
  const [selected, setSelected] = useState<DuelModeId>(() => initialDuelMode(modes, requested));
  const choose = (id: DuelModeId) => {
    if (id === selected) return;
    setSelected(id);
    playSound("ui.confirm");
    onSelect?.(id);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("space-y-4", className)} data-testid="duel-modes-hub" data-selected={selected}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <Link href="/jugar" data-testid="duels-back" className="nx-focus inline-flex min-h-[36px] items-center font-display text-label uppercase tracking-wide2 text-ink-muted hover:text-white">‹ Jugar</Link>
            <h1 className="font-display text-[clamp(28px,4vw,44px)] font-bold uppercase leading-none text-white">Duelos</h1>
          </div>
          <NxButton variant="ghost" size="md" href="/duelos/mazos" data-testid="duels-decks">Mis equipos</NxButton>
        </div>

        {offline && <p role="status" className="border-l-2 border-drl-gold bg-white/[0.03] px-4 py-2 text-caption text-drl-gold">Sin conexión · tu progreso está a salvo.</p>}

        <section aria-label="Modos de duelo" data-testid="duel-modes" className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {modes.map((c) => {
            const id = c.id as DuelModeId;
            const on = id === selected;
            const rgb = DUEL_TINT[id];
            const cta: SelectorCta = id === "RANKED" ? rankedCta(c, rankedGate)
              : id === "DRAFT_GAUNTLET" ? draftCta(c, draftFacts, draftEconomy?.entryFee ?? 0, credits)
              : { kind: "link", label: c.status === "DISPONIBLE" ? (id === "FRIEND" ? "Retar" : "Jugar") : c.cta.label, href: c.cta.href };
            const status = c.status !== "DISPONIBLE" && c.status !== "PROVISIONAL" && c.status !== "CARGANDO" ? c.status : null;
            const progress = id === "DRAFT_GAUNTLET" ? draftProgress(draftFacts) : null;
            return (
              <motion.article
                key={id}
                layout
                transition={{ layout: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }}
                data-testid={`duel-mode-${id}`}
                data-mode={id}
                data-selected={on ? "true" : "false"}
                onMouseEnter={() => focusEnvironment(DUEL_FOCUS[id])}
                onMouseLeave={() => focusEnvironment(null)}
                className={cn(
                  "nx-mode nx-duel-mode nx-clip relative isolate flex flex-col justify-end overflow-hidden transition-[box-shadow,filter] duration-300",
                  on ? "min-h-[380px] sm:min-h-[420px] lg:col-span-2 lg:min-h-[540px]" : "min-h-[116px] sm:min-h-[140px] lg:min-h-[540px]",
                  !on && "lg:brightness-[0.8] lg:hover:brightness-100",
                )}
                style={{
                  background: `linear-gradient(180deg, rgba(8,10,18,0.2), rgba(6,7,13,0.98)), radial-gradient(90% 70% at 50% 0%, rgba(${rgb},${on ? 0.36 : 0.22}), transparent 70%), #06070d`,
                  boxShadow: on
                    ? `inset 0 0 0 2px rgba(${rgb},0.9), 0 18px 48px -12px rgba(${rgb},0.55), 0 0 0 1px rgba(${rgb},0.35)`
                    : `inset 0 0 0 1px rgba(${rgb},0.32), inset 0 1px 0 rgba(${rgb},0.7)`,
                }}
              >
                <div aria-hidden className={cn("nx-mode-art pointer-events-none absolute inset-0 -z-10", !on && "opacity-80")}><Art id={id} on={on} /></div>
                <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: `linear-gradient(0deg, rgba(5,6,12,0.97) 0%, rgba(5,6,12,${on ? 0.8 : 0.7}) ${on ? 46 : 34}%, rgba(5,6,12,0) ${on ? 78 : 70}%)` }} />

                {/* Toda la tarjeta elige el modo (no navega). El contenido interactivo va por encima. */}
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`Elegir ${c.title}`}
                  data-testid={`duel-mode-select-${id}`}
                  onClick={() => choose(id)}
                  onFocus={() => focusEnvironment(DUEL_FOCUS[id])}
                  className="nx-focus absolute inset-0 z-0 cursor-pointer"
                />

                <div className="pointer-events-none relative z-10 px-5 pb-5 pt-10 sm:px-6 sm:pb-6">
                  <h2
                    className={cn("font-display font-bold uppercase leading-[0.88] text-white", on ? "text-[clamp(36px,3.6vw,58px)]" : "text-[clamp(26px,2.4vw,36px)]")}
                    style={{ textShadow: `0 0 34px rgba(${rgb},0.45), 0 2px 12px rgba(0,0,0,0.8)` }}
                  >
                    {c.title}
                  </h2>
                  {(status || progress) && (
                    <p data-testid="mode-note" className="nx-readout mt-2 font-display text-[14px] font-bold uppercase tracking-[0.14em]" style={{ color: `rgb(${rgb})` }}>
                      {progress ?? status}
                    </p>
                  )}

                  {on && (
                    <motion.div
                      key={`${id}-detail`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, delay: 0.08 }}
                      className="pointer-events-auto mt-4 space-y-4"
                      data-testid={`duel-mode-detail-${id}`}
                    >
                      {id === "RANKED" && c.status !== "INICIA SESIÓN" && <RankedBlock ranked={ranked} />}
                      {id === "DRAFT_GAUNTLET" && draftEconomy && !progress && c.status !== "INICIA SESIÓN" && (
                        <div className="space-y-2" data-testid="duel-draft-entry">
                          <p className="flex items-baseline gap-2">
                            <span className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white/60">Entrada</span>
                            <span className="nx-readout text-[26px] leading-none text-drl-gold" data-field="entry-fee">{creditsLabel(draftEconomy.entryFee)}</span>
                            <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-drl-gold/80">créditos</span>
                          </p>
                          <DraftRewardLadder economy={draftEconomy} />
                        </div>
                      )}
                      {id === "DRAFT_GAUNTLET" && draftNotice && (
                        <p role="status" data-testid="duel-draft-notice" className="border-l-2 border-drl-gold bg-black/40 px-3 py-1.5 text-[12.5px] text-drl-gold">{draftNotice}</p>
                      )}
                      <div>
                        <Cta id={id} cta={cta} onDraftEnter={onDraftEnter} draftBusy={draftBusy} />
                        {id === "RANKED" && (
                          <Link href="/competitivo" data-testid="duel-ranked-details" className="nx-focus mt-2 inline-flex min-h-[36px] items-center font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white/55 hover:text-white">
                            Ver clasificación ›
                          </Link>
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.article>
            );
          })}
        </section>

        {replays.length > 0 && (
          <details data-testid="duel-replays" className="nx-clip-sm border border-white/10 bg-white/[0.02] px-4 py-2">
            <summary className="nx-focus flex min-h-[40px] cursor-pointer items-center font-display text-label uppercase tracking-wide2 text-ink-muted hover:text-white">
              Repeticiones · {replays.length}
            </summary>
            <div className="mt-2 flex flex-col gap-1.5 pb-2">
              {replays.slice(0, 8).map((m) => {
                const tone = m.status === "DRAW" ? "gold" : m.scoreYou > m.scoreRival ? "ok" : "bad";
                return (
                  <Link key={m.matchId} href={`/duelos/replay/${m.matchId}`} className="nx-focus nx-clip-sm flex items-center gap-3 border border-edge bg-white/[0.03] px-3 py-2 transition duration-fast hover:bg-white/[0.06]">
                    <span className="w-16 shrink-0 text-center"><Badge tone={tone}>{m.scoreYou}–{m.scoreRival}</Badge></span>
                    <span className="min-w-0 flex-1 truncate text-body text-ink-secondary">{m.deckName}</span>
                  </Link>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </MotionConfig>
  );
}
