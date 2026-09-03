"use client";

/**
 * THE DUEL MOMENT — la revelación del enfrentamiento (Fase 8).
 *
 * Es el momento importante de la partida: las dos cartas boca arriba, sus valores y quién gana.
 * NO decide nada: recibe el turno YA RESUELTO por el Combat Resolver y lo enseña.
 *
 * La animación es una entrada corta y respeta `prefers-reduced-motion`: si el sistema pide menos
 * movimiento, aparece sin desplazamiento. Nunca oculta información ni bloquea la partida —se puede
 * cerrar en cualquier momento y el estado ya está aplicado.
 */
import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { DuelCard } from "./DuelCard";
import { STAT_INFO, type DuelDeckCardDTO, type DuelTurnView } from "@/lib/duel/types";

export function DuelMoment({
  turn, yourCard, rivalCard, onClose, autoCloseMs = 2600,
}: {
  turn: DuelTurnView;
  yourCard: DuelDeckCardDTO;
  rivalCard: DuelDeckCardDTO;
  onClose: () => void;
  autoCloseMs?: number;
}) {
  const reduced = useReducedMotion();

  // Se cierra sola, pero el estado del turno YA está aplicado: si el jugador cierra antes o el
  // temporizador se pierde, la partida sigue siendo correcta.
  useEffect(() => {
    const id = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(id);
  }, [onClose, autoCloseMs, turn.number]);

  const youWin = turn.outcome === "A";
  const rivalWin = turn.outcome === "B";
  const tie = turn.outcome === "TIE";

  const verdict = youWin ? "Ganas el turno" : rivalWin ? "Pierdes el turno" : "Empate";
  const tone = youWin ? "text-emerald-400" : rivalWin ? "text-drl" : "text-white/70";

  return (
    <motion.div
      role="dialog"
      aria-live="polite"
      aria-label={`Turno ${turn.number}: ${verdict}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 grid place-items-center bg-base-900/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-4 text-center text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
          Turno {turn.number} · {turn.attacker === "A" ? "atacas tú" : "ataca el rival"}
        </p>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
          <RevealSide
            card={yourCard} side={turn.you} label="Tú" win={youWin} from={-40} reduced={!!reduced}
          />

          <div className="text-center">
            <span className="font-display text-lg font-bold text-white/30 sm:text-2xl">VS</span>
          </div>

          <RevealSide
            card={rivalCard} side={turn.rival} label="Bot" win={rivalWin} from={40} reduced={!!reduced} align="right"
          />
        </div>

        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: reduced ? 0.1 : 0.42, duration: 0.22 }}
          className="mt-5 text-center"
        >
          <p className={cn("font-display text-2xl font-bold uppercase tracking-wide sm:text-4xl", tone)}>
            {verdict}
          </p>
          <p className="mt-1 text-xs text-white/45">
            {tie
              ? "Valores idénticos: nadie recibe punto, y las dos cartas se gastan igual."
              : `${turn.you.value} ${youWin ? ">" : "<"} ${turn.rival.value}`}
          </p>
          <p className="mt-3 font-display text-xl font-bold tabular-nums">
            {turn.scoreAfterYou} <span className="text-white/30">–</span> {turn.scoreAfterRival}
          </p>
        </motion.div>

        <button
          type="button"
          onClick={onClose}
          className="mx-auto mt-5 block rounded-lg border border-white/15 px-5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/60 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl"
        >
          Continuar
        </button>
      </div>
    </motion.div>
  );
}

function RevealSide({
  card, side, label, win, from, reduced, align = "left",
}: {
  card: DuelDeckCardDTO;
  side: DuelTurnView["you"];
  label: string;
  win: boolean;
  from: number;
  reduced: boolean;
  align?: "left" | "right";
}) {
  const info = STAT_INFO[side.stat];
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: from }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("flex flex-col items-center gap-2", win && "drop-shadow-[0_0_24px_rgba(255,46,99,0.35)]")}
    >
      <DuelCard card={card} size="md" highlightStat={side.stat} className={cn(!win && "opacity-75")} />
      <div className={cn("text-center", align === "right" && "text-center")}>
        <span className="block text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: info.color }}>
          {info.label}
        </span>
        <b className="font-display text-4xl font-bold leading-none sm:text-5xl">{side.value}</b>
        <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">{label}</span>
      </div>
    </motion.div>
  );
}
