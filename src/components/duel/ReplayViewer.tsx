"use client";

/**
 * REPETICIÓN 1.0 (Fase 8 → Fase 33).
 *
 * No es un vídeo ni una re-simulación: reproduce los HECHOS que el servidor guardó de cada turno
 * (`buildReplayTimeline`). El motor no se vuelve a ejecutar. Se puede ir turno a turno, saltar a
 * cualquiera, reproducir solo (1x / 2x) y usar el teclado (← → Inicio Fin, Espacio).
 *
 * Privacidad: lo que llega ya viene filtrado por el servidor (solo participantes; del rival, solo lo
 * que jugó). Si la partida terminó antes del turno 10 o falta algún dato, se dice («parcial»); si no
 * hay turnos, «Detalle no disponible para esta partida.». Nada se reconstruye a ojo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { DuelCard, DuelCardBack } from "./DuelCard";
import { TurnHistory } from "./TurnHistory";
import { MatchStrategyPanel } from "./strategy/MatchStrategyPanel";
import { DIFFICULTY_INFO, STAT_INFO, type DuelDeckCardDTO, type DuelEncounterSideView, type DuelReplay } from "@/lib/duel/types";
import {
  buildReplayTimeline, replayStep, REPLAY_STEP_MS, VERDICT_TITLE, type ReplayFrame,
} from "@/lib/duel/experience";

const TONE = { WIN: "#3fc07a", LOSS: "#ff2e63", DRAW: "#ffd35c" } as const;

export function ReplayViewer({
  replay, onBack, initialIndex = 0, initialPlaying = false,
}: {
  replay: DuelReplay;
  onBack: () => void;
  /** Solo arnés QA: turno inicial y reproducción automática. */
  initialIndex?: number;
  initialPlaying?: boolean;
}) {
  const reduced = useReducedMotion();
  const timeline = useMemo(() => buildReplayTimeline(replay), [replay]);
  const total = timeline.frames.length;
  const [i, setI] = useState(() => Math.max(0, Math.min(initialIndex, Math.max(0, total - 1))));
  const [playing, setPlaying] = useState(initialPlaying && total > 1);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const frame: ReplayFrame | undefined = timeline.frames[i];

  const go = useCallback((cmd: "first" | "prev" | "next" | "last") => setI((v) => replayStep(v, total, cmd)), [total]);

  // Reproducción: un paso cada 1,8 s (0,9 s a 2x). Se para sola en el último turno.
  useEffect(() => {
    if (!playing) return;
    if (i >= total - 1) { setPlaying(false); return; }
    const id = window.setTimeout(() => setI((v) => replayStep(v, total, "next")), REPLAY_STEP_MS[speed]);
    return () => window.clearTimeout(id);
  }, [playing, i, total, speed]);

  // Teclado: ← → para moverse, Inicio/Fin para los extremos, Espacio para reproducir/pausar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); go("prev"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); go("next"); }
      else if (e.key === "Home") { e.preventDefault(); setPlaying(false); go("first"); }
      else if (e.key === "End") { e.preventDefault(); setPlaying(false); go("last"); }
      else if (e.key === " " && (e.target as HTMLElement | null)?.tagName !== "BUTTON") { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const mode = replay.mode ?? "PVE";
  const rivalName = mode === "PVE" ? `Bot · ${DIFFICULTY_INFO[replay.difficulty]?.label ?? "Normal"}` : replay.rivalName ?? "Rival";
  const modeLabel = mode === "PVP" ? "Ranked" : mode === "PVP_PRIVATE" ? "Duelo privado" : `dificultad ${DIFFICULTY_INFO[replay.difficulty]?.label ?? "Normal"}`;
  const r = replay.result;
  const verdict = timeline.verdict;

  return (
    <div className="mx-auto max-w-4xl" data-scene="replay" data-availability={timeline.availability}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="nx-focus inline-flex min-h-[44px] items-center text-[11px] font-bold uppercase tracking-[0.14em] text-white/40 transition hover:text-white">
            ‹ Volver
          </button>
          <h1 className="truncate font-display text-2xl font-bold sm:text-3xl">Repetición</h1>
          <p className="text-xs text-white/45">
            {replay.yourDeckName} · {modeLabel}{mode !== "PVE" ? ` · vs ${rivalName}` : ""} ·{" "}
            {/* La versión interna de las reglas se conserva, pero no se le enseña al jugador. */}
            <span title={`Reglas ${replay.rulesVersion}`}>Reglas del duelo</span>
          </p>
        </div>
        {r && verdict && (
          <span
            data-verdict={verdict}
            className={cn(
              "rounded-lg px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wide",
              verdict === "WIN" && "bg-emerald-400/15 text-emerald-300",
              verdict === "LOSS" && "bg-drl/15 text-drl-glow",
              verdict === "DRAW" && "bg-drl-gold/15 text-drl-gold",
            )}
          >
            {VERDICT_TITLE[verdict]} {r.scoreYou}–{r.scoreRival}
          </span>
        )}
      </header>

      {timeline.availability !== "FULL" && (
        <p role="status" data-testid="replay-note" className={cn("nx-clip-sm mt-3 border-l-2 bg-white/[0.03] px-3 py-2 text-caption", timeline.availability === "UNAVAILABLE" ? "border-l-drl-red text-white/80" : "border-l-drl-gold text-drl-gold")}>
          {timeline.availability === "PARTIAL" ? `Repetición parcial. ${timeline.note ?? ""}` : timeline.note}
        </p>
      )}

      {total > 0 && (
        <>
          {/* ── Línea de turnos: saltar a cualquiera ── */}
          <div className="mt-4 flex gap-1" role="group" aria-label="Turnos">
            {timeline.frames.map((f, k) => (
              <button
                key={f.number}
                type="button"
                onClick={() => { setPlaying(false); setI(k); }}
                aria-current={k === i}
                aria-label={`Turno ${f.number}: ${f.explanation.headline.toLowerCase()}`}
                className={cn(
                  "nx-focus min-h-[44px] flex-1 rounded-md font-display text-[11px] font-bold transition",
                  k === i && "ring-2 ring-drl-cyan",
                  f.result === "WIN" && "bg-emerald-400/20 text-emerald-300",
                  f.result === "LOSS" && "bg-drl/20 text-drl-glow",
                  f.result === "DRAW" && "bg-white/10 text-white/70",
                )}
              >
                {f.number}
              </button>
            ))}
          </div>

          {/* ── El enfrentamiento ── */}
          {frame && (
            <motion.section
              key={frame.number}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="nx-stage nx-clip mt-4 p-4"
              aria-live="polite"
              data-testid="replay-frame"
              data-turn={frame.number}
              data-result={frame.result}
            >
              <p className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                Turno {frame.number} de {timeline.expectedTurns} · {frame.attackerYou ? "atacas tú" : "ataca el rival"}
                {frame.number === timeline.expectedTurns && <span className="text-drl-gold"> · último turno</span>}
              </p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <ReplaySide card={frame.yourCard} side={replay.turns.find((t) => t.number === frame.number)!.you} label="Tú" win={frame.result === "WIN"} />
                <span className="font-display text-lg font-bold text-white/25">VS</span>
                <ReplaySide card={frame.rivalCard} side={replay.turns.find((t) => t.number === frame.number)!.rival} label={rivalName} win={frame.result === "LOSS"} />
              </div>
              <p className="mt-3 text-center font-display text-xl font-bold uppercase" style={{ color: TONE[frame.result] }}>
                {frame.explanation.headline}
              </p>
              <p className="mt-1 text-center text-caption text-ink-secondary" data-reason={frame.explanation.reason}>{frame.explanation.text}</p>
              <p className="mt-1 text-center font-display text-lg font-bold tabular-nums text-white/70">
                {frame.scoreYou} <span className="text-white/25">–</span> {frame.scoreRival}
              </p>

              {frame.final && timeline.decision && r && (
                <ol className="mx-auto mt-4 max-w-md space-y-1" aria-label="Cómo se decidió la partida">
                  {timeline.decision.map((s, k) => (
                    <li key={s.key} className="flex items-center justify-between gap-2 rounded-md bg-black/25 px-3 py-1.5 text-[12px]" data-step={s.key} data-outcome={s.outcome}>
                      <span className="text-white/80">{k + 1}. {s.label}</span>
                      <b className="nx-readout tabular-nums text-white">{s.you ?? "—"} – {s.rival ?? "—"}</b>
                      <span className="text-ink-muted">{s.outcome === "YOU" ? "Para ti" : s.outcome === "RIVAL" ? "Para el rival" : s.outcome === "TIE" ? "Empate" : "Sin dato"}</span>
                    </li>
                  ))}
                </ol>
              )}
            </motion.section>
          )}

          {/* ── Controles ── */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Ctrl onClick={() => { setPlaying(false); go("first"); }} disabled={i === 0} label="Primer turno">◀◀</Ctrl>
            <Ctrl onClick={() => { setPlaying(false); go("prev"); }} disabled={i === 0} label="Turno anterior">◀</Ctrl>
            <button
              type="button"
              onClick={() => { if (i >= total - 1) setI(0); setPlaying((p) => !p); }}
              aria-label={playing ? "Pausar" : "Reproducir"}
              aria-pressed={playing}
              disabled={total <= 1}
              className="nx-focus min-h-[44px] rounded-lg bg-drl px-4 font-display text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:brightness-110 disabled:opacity-30"
            >
              {playing ? "❚❚ Pausar" : "▶ Reproducir"}
            </button>
            <span className="w-20 text-center font-display text-sm font-bold tabular-nums text-white/60">
              {i + 1} / {total}
            </span>
            <Ctrl onClick={() => { setPlaying(false); go("next"); }} disabled={i >= total - 1} label="Turno siguiente">▶</Ctrl>
            <Ctrl onClick={() => { setPlaying(false); go("last"); }} disabled={i >= total - 1} label="Último turno">▶▶</Ctrl>
            <div className="ml-1 flex gap-1" role="group" aria-label="Velocidad">
              {([1, 2] as const).map((s) => (
                <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} className={cn("nx-focus min-h-[44px] min-w-[44px] rounded-lg border px-2 text-xs font-bold", speed === s ? "border-drl-cyan text-drl-cyan" : "border-white/12 text-white/50")}>
                  {s}x
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-center text-[11px] text-ink-faint">Teclado: ← → para moverte · Espacio para reproducir o pausar</p>

          {/* FASE 43 · la misma lectura estratégica, reconstruida de los turnos guardados (sin volver a jugar). */}
          <MatchStrategyPanel history={replay.turns} result={replay.result} deckId={replay.deckId ?? null} context="replay" className="mt-6" />

          <section className="mt-6">
            <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Todos los turnos</h2>
            <TurnHistory turns={replay.turns} openTurn={frame?.number ?? null} onOpenTurn={(n) => {
              const k = timeline.frames.findIndex((f) => f.number === n);
              if (k >= 0) { setPlaying(false); setI(k); }
            }} />
          </section>
        </>
      )}
    </div>
  );
}

function ReplaySide({ card, side, label, win }: { card: DuelDeckCardDTO | null; side: DuelEncounterSideView; label: string; win: boolean }) {
  const info = STAT_INFO[side.stat];
  return (
    <div className="flex flex-col items-center gap-2">
      {card ? <DuelCard card={card} size="md" highlightStat={side.stat} className={cn(!win && "opacity-80")} /> : <DuelCardBack size="md" />}
      <div className="text-center">
        <span className="block text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: info.color }}>
          {info.label}
        </span>
        <b className="font-display text-2xl font-bold leading-none sm:text-3xl">{side.value}</b>
        <span className="mt-0.5 block max-w-[140px] truncate text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">{label}</span>
      </div>
    </div>
  );
}

function Ctrl({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="nx-focus min-h-[44px] min-w-[44px] rounded-lg border border-white/12 px-3 text-xs text-white/60 transition hover:bg-white/[0.07] disabled:opacity-25"
    >
      {children}
    </button>
  );
}
