"use client";

/**
 * REPETICIÓN DE UNA PARTIDA (Fase 8).
 *
 * No es un vídeo: el servidor guarda las DECISIONES de la partida y aquí se recorren. Por eso se
 * puede ir hacia delante, hacia atrás y saltar a cualquier turno, y por eso una repetición vuelve a
 * enseñar exactamente lo que pasó —el motor es determinista (Fase 6/7).
 *
 * El servidor solo sirve la repetición cuando la partida ha TERMINADO: mientras está en curso, el
 * historial completo del rival seguiría siendo información viva.
 */
import { useState } from "react";
import { cn } from "@/lib/format";
import { DuelCard } from "./DuelCard";
import { TurnHistory } from "./TurnHistory";
import { DIFFICULTY_INFO, STAT_INFO, type DuelReplay } from "@/lib/duel/types";

export function ReplayViewer({ replay, onBack }: { replay: DuelReplay; onBack: () => void }) {
  const [i, setI] = useState(0);
  const total = replay.turns.length;
  const turn = replay.turns[i];

  const byUid = new Map([...replay.yourCards, ...replay.rivalCards].map((c) => [c.uid, c]));
  const yourCard = turn ? byUid.get(turn.you.uid) : undefined;
  const rivalCard = turn ? byUid.get(turn.rival.uid) : undefined;

  const r = replay.result;
  const kind = r?.isDraw ? "draw" : r?.winner === "YOU" ? "win" : "loss";

  return (
    <div className="mx-auto max-w-4xl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40 transition hover:text-white"
          >
            ‹ Volver
          </button>
          <h1 className="truncate font-display text-2xl font-bold sm:text-3xl">Repetición</h1>
          <p className="text-xs text-white/45">
            {replay.yourDeckName} · dificultad {DIFFICULTY_INFO[replay.difficulty].label} ·{" "}
            {/* La versión interna de las reglas se conserva, pero no se le enseña al jugador. */}
            <span title={`Reglas ${replay.rulesVersion}`}>Reglas del duelo</span>
          </p>
        </div>
        {r && (
          <span
            className={cn(
              "rounded-lg px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wide",
              kind === "win" && "bg-emerald-400/15 text-emerald-300",
              kind === "loss" && "bg-drl/15 text-drl-glow",
              kind === "draw" && "bg-drl-gold/15 text-drl-gold",
            )}
          >
            {kind === "win" ? "Victoria" : kind === "loss" ? "Derrota" : "Empate"} {r.scoreYou}–{r.scoreRival}
          </span>
        )}
      </header>

      {/* ── Línea de turnos: saltar a cualquiera ── */}
      <div className="mt-4 flex gap-1" role="group" aria-label="Turnos">
        {replay.turns.map((t, k) => (
          <button
            key={t.number}
            type="button"
            onClick={() => setI(k)}
            aria-current={k === i}
            className={cn(
              "flex-1 rounded-md py-1.5 font-display text-[11px] font-bold transition",
              k === i && "ring-1 ring-drl-cyan",
              t.outcome === "A" && "bg-emerald-400/20 text-emerald-300",
              t.outcome === "B" && "bg-drl/20 text-drl-glow",
              t.outcome === "TIE" && "bg-white/10 text-white/70",
            )}
          >
            {t.number}
          </button>
        ))}
      </div>

      {/* ── El enfrentamiento ── */}
      {turn && yourCard && rivalCard && (
        <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
            Turno {turn.number} de {total} · {turn.attacker === "A" ? "atacas tú" : "ataca el rival"}
          </p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <ReplaySide card={yourCard} side={turn.you} label="Tú" win={turn.outcome === "A"} />
            <span className="font-display text-lg font-bold text-white/25">VS</span>
            <ReplaySide card={rivalCard} side={turn.rival} label="Bot" win={turn.outcome === "B"} />
          </div>
          <p
            className={cn(
              "mt-3 text-center font-display text-xl font-bold uppercase",
              turn.outcome === "A" && "text-emerald-400",
              turn.outcome === "B" && "text-drl",
              turn.outcome === "TIE" && "text-white/60",
            )}
          >
            {turn.outcome === "A" ? "Ganas el turno" : turn.outcome === "B" ? "Pierdes el turno" : "Empate · nadie puntúa"}
          </p>
          <p className="mt-1 text-center font-display text-lg font-bold tabular-nums text-white/70">
            {turn.scoreAfterYou} <span className="text-white/25">–</span> {turn.scoreAfterRival}
          </p>
        </section>
      )}

      {/* ── Controles ── */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <Ctrl onClick={() => setI(0)} disabled={i === 0} label="Primer turno">◀◀</Ctrl>
        <Ctrl onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0} label="Turno anterior">◀</Ctrl>
        <span className="w-20 text-center font-display text-sm font-bold tabular-nums text-white/60">
          {i + 1} / {total}
        </span>
        <Ctrl onClick={() => setI((v) => Math.min(total - 1, v + 1))} disabled={i >= total - 1} label="Turno siguiente">▶</Ctrl>
        <Ctrl onClick={() => setI(total - 1)} disabled={i >= total - 1} label="Último turno">▶▶</Ctrl>
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Todos los turnos</h2>
        <TurnHistory turns={replay.turns} openTurn={turn?.number ?? null} onOpenTurn={(n) => {
          const k = replay.turns.findIndex((t) => t.number === n);
          if (k >= 0) setI(k);
        }} />
      </section>
    </div>
  );
}

function ReplaySide({
  card, side, label, win,
}: {
  card: Parameters<typeof DuelCard>[0]["card"];
  side: DuelReplay["turns"][number]["you"];
  label: string;
  win: boolean;
}) {
  const info = STAT_INFO[side.stat];
  return (
    <div className="flex flex-col items-center gap-2">
      <DuelCard card={card} size="sm" highlightStat={side.stat} className={cn(!win && "opacity-80")} />
      <div className="text-center">
        <span className="block text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: info.color }}>
          {info.abbr}
        </span>
        <b className="font-display text-2xl font-bold leading-none sm:text-3xl">{side.value}</b>
        <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">{label}</span>
      </div>
    </div>
  );
}

function Ctrl({
  children, onClick, disabled, label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/[0.07] disabled:opacity-25"
    >
      {children}
    </button>
  );
}
