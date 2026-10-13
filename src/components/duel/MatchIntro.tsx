"use client";

/**
 * LA ENTRADA A LA PARTIDA (Fase 26 → Fase 61).
 *
 * Fase 26 la inventó como un «VS» de 1,6 s; la QA de F61 la encontró siendo una página plana: dos nombres,
 * una fila de diez dorsos y una fila de diez miniaturas de 54 px. Nada decía «ha empezado una partida».
 *
 * F61 · TRES TIEMPOS, RÁPIDOS Y SALTABLES (`lib/duel/matchFlow`):
 *
 *   FOUND   ~0,85 s   quién hay enfrente — «Rival preparado» (bot) / «Rival encontrado» (persona) y el modo
 *   VERSUS  ~1,25 s   el VS: tu equipo a la izquierda, el rival a la derecha, fuerza (Σ OVR) y quién abre
 *   LINEUP  ~1,40 s   tus diez cartas REALES (CardArt vía `DuelCard`) saltan a la mesa por rol; el rival
 *                     solo enseña cuántas tiene, boca abajo (su mazo no está en la vista, y en PvP llega redactado)
 *
 * Es PRESENTACIÓN PURA: se monta con la vista que devolvió el servidor (la partida ya existe) y no habla con
 * nadie. Saltar o esperar da lo mismo: el tablero de debajo ya está en el estado del servidor. Una recarga no
 * la vuelve a reproducir (`shouldPlayEntrance`, lo decide quien la monta).
 *
 * Movimiento reducido: los tres tiempos se conservan (el PC del usuario reporta `reduce`), sin desplazamientos:
 * fundidos y el tiempo justo para leer.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DuelCard, DuelCardBack } from "./DuelCard";
import { trackExperience } from "@/lib/duel/experienceTelemetry";
import { EASE } from "@/design/motion";
import { playCue, playSound } from "@/lib/sound";
import { ROLE_ABBR } from "@/lib/flags";
import { cn } from "@/lib/format";
import { ARENA_ACCENT } from "@/lib/duel/arenas";
import { useMediaQuery } from "@/lib/useMediaQuery";
import {
  entranceBeatAt, entranceCopy, entranceTimeline, lineupSummary,
  type EntranceBeat, type FlowMode,
} from "@/lib/duel/matchFlow";
import { DIFFICULTY_INFO, type DuelMatchView } from "@/lib/duel/types";

const TONO = { tu: ARENA_ACCENT.player, rival: ARENA_ACCENT.opponent } as const;

export function MatchIntro({
  view, rivalName, onDone, mode = "quick", from = "FOUND", rivalAvatar = null,
}: {
  view: DuelMatchView;
  rivalName: string;
  onDone: () => void;
  /** F61 · contexto de la partida (rotula el primer tiempo). Por defecto, partida rápida contra el bot. */
  mode?: FlowMode;
  /** F61 · desde qué tiempo empieza. Ranked ya enseñó «Rival encontrado» (F55): entra directo al equipo. */
  from?: EntranceBeat;
  /** Avatar público del rival (PvP), si el servidor lo dio. */
  rivalAvatar?: string | null;
}) {
  const reduced = !!useReducedMotion();
  const human = mode === "ranked" || mode === "private";
  const copy = entranceCopy(mode, view, rivalName, human ? null : DIFFICULTY_INFO[view.difficulty]?.label ?? null);
  const lineup = useMemo(() => lineupSummary(view.yourHand), [view.yourHand]);
  const timeline = useMemo(() => entranceTimeline(reduced, from), [reduced, from]);
  /* Móvil: dos filas de cinco, carta sin el trío superpuesto (a 60 px no se lee; la carta impresa ya trae OVR y nombre). */
  const narrow = useMediaQuery("(max-width: 639px)");

  /* El tiempo en pantalla. Un reloj por tiempo (no un intervalo): tres `setTimeout` y el cierre. */
  const [beat, setBeat] = useState<EntranceBeat | "DONE">(from);
  useEffect(() => {
    playCue("whoosh");
    trackExperience("match_intro_view");
    const ids = timeline.steps.slice(1).map((s) => window.setTimeout(() => setBeat(entranceBeatAt(s.at, reduced, from)), s.at));
    ids.push(window.setTimeout(onDone, timeline.total));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [onDone, reduced, from, timeline]);

  /* Cada tiempo suena una vez (sintetizado, silencioso sin gesto previo o con el sonido apagado). */
  useEffect(() => {
    if (beat === "VERSUS") playSound("match.vs");
    if (beat === "LINEUP") playSound("match.lineup");
  }, [beat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); onDone(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
  const beatIndex = timeline.steps.findIndex((s) => s.beat === beat);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Presentación del duelo"
      data-scene="intro"
      data-beat={beat}
      data-f61="entrance"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.16 : 0.22 }}
      className="nx-f61-entrance fixed inset-0 z-50 grid place-items-center overflow-hidden px-4"
      onClick={onDone}
    >
      {/* El escenario: dos luces de bando que se enfrentan y una diagonal que parte la sala. */}
      <span aria-hidden className="nx-f61-entrance-light" data-side="you" />
      <span aria-hidden className="nx-f61-entrance-light" data-side="rival" />
      <span aria-hidden className={cn("nx-f61-entrance-split", beat !== "FOUND" && "is-open")} />

      <div className="relative z-10 w-full max-w-[min(96vw,1120px)]" onClick={(e) => e.stopPropagation()}>
        <AnimatePresence mode="wait">
          {beat === "FOUND" && (
            <motion.div key="found" {...fade} transition={{ duration: 0.2 }} className="flex flex-col items-center text-center" data-beat-panel="found">
              <motion.p
                className="nx-label !text-[11px] !tracking-[0.34em]"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE.out }}
              >
                {copy.mode}
              </motion.p>
              <motion.h2
                className="nx-f61-kicker mt-3 font-display font-bold uppercase leading-[0.9]"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.3, letterSpacing: "0.3em" }}
                animate={{ opacity: 1, scale: 1, letterSpacing: "0.04em" }}
                transition={{ duration: 0.42, ease: EASE.out }}
              >
                {copy.kicker}
              </motion.h2>
              <motion.div
                className="mt-6 flex items-center gap-3"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduced ? 0.15 : 0.22, duration: 0.3, ease: EASE.out }}
              >
                {rivalAvatar && <span aria-hidden className="text-[34px] leading-none">{rivalAvatar}</span>}
                <span className="text-left">
                  <b className="block font-display text-[clamp(22px,4vw,40px)] font-bold uppercase leading-none text-white">{copy.rival}</b>
                  <span className="nx-label mt-1 block" style={{ color: `${TONO.rival}cc` }}>{copy.rivalTag}</span>
                </span>
              </motion.div>
            </motion.div>
          )}

          {beat === "VERSUS" && (
            <motion.div key="versus" {...fade} transition={{ duration: 0.18 }} data-beat-panel="versus">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-8">
                <motion.div
                  className="min-w-0 text-right"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: -80 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.38, ease: EASE.out }}
                >
                  <span className="nx-label block" style={{ color: `${TONO.tu}cc` }}>Tú</span>
                  <b className="nx-f61-vs-name block truncate font-display font-bold uppercase leading-none text-white">{copy.you}</b>
                  <span className="nx-label mt-2 block">Fuerza Σ <b className="nx-readout text-[18px] text-white">{view.yourSumOvr}</b></span>
                </motion.div>

                <motion.span
                  aria-hidden
                  className="relative grid place-items-center"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 2.2, rotate: -12 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{ duration: 0.4, ease: EASE.out, delay: reduced ? 0.08 : 0.14 }}
                >
                  <span className="nx-a50-vs-ring" />
                  <span className="nx-a50-vs relative block font-display !text-[clamp(52px,11vw,132px)]" data-ready="true">VS</span>
                </motion.span>
                <span className="sr-only">contra</span>

                <motion.div
                  className="min-w-0 text-left"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: 80 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.38, ease: EASE.out }}
                >
                  <span className="nx-label block" style={{ color: `${TONO.rival}cc` }}>{copy.rivalTag}</span>
                  <b className="nx-f61-vs-name block truncate font-display font-bold uppercase leading-none text-white">{copy.rival}</b>
                  <span className="nx-label mt-2 block">Fuerza Σ <b className="nx-readout text-[18px] text-white">{view.rivalSumOvr}</b></span>
                </motion.div>
              </div>
              <motion.p
                className="mt-7 text-center font-display text-[13px] font-bold uppercase tracking-[0.2em] text-white/80"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduced ? 0.25 : 0.42, duration: 0.3 }}
              >
                {copy.opening} · {view.totalTurns} turnos
              </motion.p>
            </motion.div>
          )}

          {beat === "LINEUP" && (
            <motion.div key="lineup" {...fade} transition={{ duration: 0.18 }} className="flex flex-col items-center" data-beat-panel="lineup">
              {/*
                EL RIVAL, BOCA ABAJO. Solo cuántas cartas tiene (un número público), nunca cuáles: en PvP el
                snapshot llega redactado y en PvE su mazo no está en la vista.
              */}
              <div className="flex items-center gap-3" aria-label={`Equipo rival: ${view.rivalRemaining} cartas ocultas`} data-testid="intro-rival-backs">
                <span className="nx-label" style={{ color: `${TONO.rival}cc` }}>{copy.rival}</span>
                <span className="flex">
                  {Array.from({ length: Math.min(view.rivalRemaining, 10) }, (_, i) => (
                    <span key={i} className={cn("first:ml-0", narrow ? "-ml-8" : "-ml-4")} style={{ transform: `rotate(${(i - 4.5) * 3}deg)` }}>
                      <DuelCardBack size="xs" />
                    </span>
                  ))}
                </span>
              </div>

              <p className="nx-label mt-5 !text-[11px] !tracking-[0.3em]" style={{ color: `${TONO.tu}dd` }}>Tu equipo salta a la mesa</p>

              {/* TUS DIEZ, por rol y fuerza. El asset es la carta: `DuelCard` pinta el arte impreso del catálogo. */}
              <div className={cn("nx-f61-lineup mt-3 flex w-full items-end justify-center", narrow && "is-narrow flex-wrap")} aria-label="Tu mano">
                {lineup.cards.map((c, i) => {
                  const star = lineup.stars.some((s) => s.uid === c.uid);
                  return (
                    <motion.span
                      key={c.uid}
                      className={cn("nx-f61-lineup-card min-w-0", star && "is-star")}
                      data-star={star ? "true" : undefined}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 60, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: (reduced ? 0.035 : 0.05) * i, duration: reduced ? 0.2 : 0.32, ease: EASE.out }}
                    >
                      <DuelCard card={c} size={narrow ? "xs" : "md"} className="!w-full" glow={star ? `${TONO.tu}aa` : null} />
                    </motion.span>
                  );
                })}
              </div>

              <motion.ul
                className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1"
                aria-label="Roles del equipo"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduced ? 0.3 : 0.5, duration: 0.3 }}
              >
                {lineup.roles.map((r) => (
                  <li key={r.role} className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
                    <span className="text-white">{r.count}</span> {ROLE_ABBR[r.role] ?? r.role}
                  </li>
                ))}
                <li className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">Σ <span className="text-white">{lineup.sumOvr}</span></li>
              </motion.ul>
            </motion.div>
          )}
        </AnimatePresence>

        {/* El progreso de la entrada: tres marcas, la actual encendida. Sin datos: solo dónde estás. */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <span className="flex gap-1.5" aria-hidden>
            {timeline.steps.map((s, i) => (
              <span key={s.beat} className={cn("h-1 w-8 rounded-full transition-colors", i <= beatIndex ? "bg-white/80" : "bg-white/15")} />
            ))}
          </span>
          <button
            type="button"
            onClick={onDone}
            className="nx-focus inline-flex min-h-[44px] items-center rounded-lg border border-white/15 bg-black/30 px-5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Saltar
          </button>
        </div>
      </div>
    </motion.div>
  );
}
