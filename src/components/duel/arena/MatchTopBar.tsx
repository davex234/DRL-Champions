"use client";

/**
 * LA BARRA DE LA PARTIDA — Fase 50 (NEXUS ARENA).
 *
 * El cromo de arriba de la arena PvE. Antes era una cabecera de aplicación: el nombre del mazo, una
 * línea gris con «Turno 3 / 10 · Normal», el marcador en una cajita y los botones. Ahora es el HUD de
 * un evento:
 *
 *     ◆ NEXUS  │ PARTIDA RÁPIDA           TURNO 3 / 10               TÚ 2 – 0 RIVAL   ?  ♪  ⛶  SALIR
 *       DRL    │ vs Bot · Normal          ▰▰▱▱▱▱▱▱▱▱ FASE DE ATAQUE
 *
 * La pista de los diez turnos cuenta la partida sin abrir el historial: cian = punto tuyo, rojo =
 * punto del rival, ámbar = empate, blanco = el turno en juego, oscuro = lo que falta.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * No decide nada. Turno, marcador, quién ataca y el resultado de cada turno llegan en la vista del
 * servidor; la pista la construye `buildTimeline` (la misma que usa la línea de turnos). Los controles
 * —ayuda, sonido, pantalla completa, salir— los pone la página: esta barra solo les da sitio.
 */
import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/format";
import { EASE } from "@/design/motion";
import { buildTimeline, turnHeader } from "@/lib/duel/experience";
import { ARENA_ACCENT, ARENA_MODE_LABEL, arenaFor, type ArenaMode } from "@/lib/duel/arenas";
import type { DuelMatchView } from "@/lib/duel/types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export function MatchTopBar({
  view, mode = "quick", rivalName, difficultyLabel, controls, timer, className,
}: {
  view: DuelMatchView;
  mode?: ArenaMode;
  /** Cómo se llama el rival (dificultad del bot o nombre real en campaña). */
  rivalName: string;
  /** Etiqueta de la dificultad, tal cual la da `DIFFICULTY_INFO`. */
  difficultyLabel: string;
  /** Ayuda, sonido, pantalla completa y salida: los monta la página. */
  controls: React.ReactNode;
  /** F72.8 · el contador de la decisión (`TurnTimer`), junto al marcador: visible también en móvil. */
  timer?: React.ReactNode;
  className?: string;
}) {
  useLocale();
  const arena = arenaFor(mode);
  const header = useMemo(() => turnHeader(view), [view]);
  const turno = Math.min(view.turn, view.totalTurns);
  const enJuego = view.status === "IN_PROGRESS";

  return (
    <header className={cn("nx-a50-topbar sticky top-0 z-40", className)} data-hud="partida" data-arena-id={arena.arenaId}>
      <div className="mx-auto flex h-14 w-full max-w-[1680px] items-center gap-2 px-3 sm:h-16 sm:gap-4 sm:px-6">
        {/* ── MARCA Y MODO ── */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-4">
          <span className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden
              className="h-7 w-7 shrink-0 sm:h-8 sm:w-8"
              style={{
                backgroundColor: ARENA_ACCENT.opponent,
                WebkitMaskImage: "url(/branding/icon/icon-mono.svg)",
                maskImage: "url(/branding/icon/icon-mono.svg)",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                filter: `drop-shadow(0 0 8px ${ARENA_ACCENT.opponent})`,
              }}
            />
            {arena.branding && (
              <span className="hidden flex-col leading-none lg:flex">
                <b className="font-display text-[20px] font-extrabold tracking-[0.06em] text-white">{td(arena.branding.wordmark)}</b>
                <span className="mt-0.5 font-display text-[9px] font-bold uppercase tracking-[0.34em] text-white/45">{td(arena.branding.sub)}</span>
              </span>
            )}
          </span>
          <span aria-hidden className="hidden h-8 w-px shrink-0 bg-white/12 lg:block" />
          <span className="min-w-0 leading-tight">
            <b className="block truncate font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white sm:text-[13px]">
              {td(ARENA_MODE_LABEL[mode])}
            </b>
            <span className="block truncate text-[11px] text-white/55">
              {t("vs")} {rivalName} · {td(difficultyLabel)}
            </span>
          </span>
        </div>

        {/* ── TURNO, PISTA Y FASE ── (a partir de `sm`; en móvil lo dice la tira del tablero) */}
        {enJuego && (
          <div className="hidden w-[clamp(220px,26vw,380px)] shrink-0 flex-col items-center gap-1 sm:flex" data-testid="topbar-turn">
            <span className="flex items-baseline gap-1.5 font-display font-bold uppercase tracking-[0.14em] text-white">
              <span className="text-[12px] text-white/60">{t("Turno")}</span>
              <span className="relative inline-grid overflow-hidden text-[20px] leading-none tabular-nums">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={turno}
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -12, opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE.out }}
                  >
                    {turno}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="text-[13px] text-white/40">/ {view.totalTurns}</span>
            </span>
            <TurnSegments view={view} className="w-full" />
            <span className="flex items-center gap-2 font-display text-[10px] font-bold uppercase tracking-[0.22em]">
              <span style={{ color: view.youAreAttacker ? ARENA_ACCENT.player : ARENA_ACCENT.opponent }}>
                {view.youAreAttacker ? t("▲ Fase de ataque") : t("▼ Fase de defensa")}
              </span>
              {/* Último turno y punto de partida: los decide `turnHeader` sobre la vista, no esta barra. */}
              {header.finalLabel && <span style={{ color: ARENA_ACCENT.draw }} data-testid="topbar-final">· {td(header.finalLabel)}</span>}
              {!header.finalLabel && header.matchPointLabel && (
                <span className="truncate text-drl-cyan" data-testid="topbar-match-point">◆ {td(header.matchPointLabel)}</span>
              )}
            </span>
          </div>
        )}

        {/* ── MARCADOR Y CONTROLES ── */}
        <div className="flex flex-1 items-center justify-end gap-1.5 sm:gap-2.5">
          {enJuego && timer}
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-white/10 bg-black/45 px-2.5 py-1 sm:px-3"
            aria-label={t("Marcador: tú {scoreYou}, {rivalName} {scoreRival}", { scoreYou: view.scoreYou, rivalName, scoreRival: view.scoreRival })}
            role="status"
          >
            <span className="nx-label hidden !text-[#2fe0ff]/80 md:inline">{t("Tú")}</span>
            <b className="nx-readout text-[20px] leading-none tabular-nums" style={{ color: ARENA_ACCENT.player, textShadow: `0 0 14px ${ARENA_ACCENT.player}88` }}>
              {view.scoreYou}
            </b>
            <span className="text-white/30">–</span>
            <b className="nx-readout text-[20px] leading-none tabular-nums" style={{ color: ARENA_ACCENT.opponent, textShadow: `0 0 14px ${ARENA_ACCENT.opponent}88` }}>
              {view.scoreRival}
            </b>
            <span className="nx-label hidden !text-drl/80 md:inline">{t("Rival")}</span>
          </span>
          {controls}
        </div>
      </div>
    </header>
  );
}

/**
 * LA PISTA DE LOS DIEZ TURNOS. Diez segmentos, uno por turno canónico. Cada uno dice su estado con
 * color Y con texto accesible (el `title` y la etiqueta de la lista), nunca solo con color.
 */
export function TurnSegments({ view, className }: { view: DuelMatchView; className?: string }) {
  useLocale();
  const cells = useMemo(() => buildTimeline(view), [view]);
  return (
    <ol className={cn("flex items-center gap-[3px]", className)} aria-label={t("Pista de turnos")}>
      {cells.map((c) => (
        <li key={c.number} className="nx-a50-seg" data-cell={c.state} title={td(c.label)}>
          <span className="sr-only">{td(c.label)}</span>
        </li>
      ))}
    </ol>
  );
}
