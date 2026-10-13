"use client";

/**
 * FINAL DE PARTIDA (Fase 33) — el «VICTORIA / DERROTA / EMPATE» que abre el resultado PvP y privado.
 *
 * Antes la pantalla saltaba del tablero a un titular plano y una ficha de marcador. Ahora hay una
 * transición corta (≈0,8 s): el veredicto entra con impacto, después el marcador y, debajo, el último
 * turno contado con su explicación real. Con movimiento reducido todo aparece a la vez.
 *
 * Nada se decide aquí: el veredicto llega del servidor (resultado del resolver, cierre por abandono o
 * asiento de rating) y el marcador es el del resultado o, si la partida se cerró a medias, el del último
 * turno guardado (`matchEndPresentation`).
 */
import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/design/motion";
import { cn } from "@/lib/format";
import type { DuelMatchView } from "@/lib/duel/types";
import { matchEndPresentation, type MatchVerdict } from "@/lib/duel/experience";

const TONE: Record<MatchVerdict, { rgb: string; cls: string }> = {
  WIN: { rgb: "63,210,255", cls: "text-drl-cyan" },
  LOSS: { rgb: "255,46,99", cls: "text-drl-red" },
  DRAW: { rgb: "255,211,92", cls: "text-drl-gold" },
};
const TURN_TONE = { WIN: "text-ok", LOSS: "text-drl-red", DRAW: "text-drl-gold" } as const;

export function MatchEndHero({
  verdict, view, modeLabel, cause = null, rivalName = null, className,
}: {
  verdict: MatchVerdict;
  view: Pick<DuelMatchView, "result" | "lastTurn"> | null;
  /** Rótulo del modo, tal cual lo nombra la pantalla que lo monta. */
  modeLabel: string;
  /** Causa del cierre si no fue la partida entera («Por abandono», «Tiempo agotado»). */
  cause?: string | null;
  rivalName?: string | null;
  className?: string;
}) {
  const reduced = !!useReducedMotion();
  const p = matchEndPresentation({ verdict, view });
  const tone = TONE[verdict];
  const at = (s: number) => (reduced ? 0 : s);

  return (
    <motion.section
      aria-label={`Resultado: ${p.title}`}
      data-testid="match-end-hero"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0.12 : 0.2 }}
      className={cn("nx-clip relative overflow-hidden border px-5 py-7 text-center sm:py-9", className)}
      style={{
        borderColor: `rgba(${tone.rgb},0.45)`,
        background: `radial-gradient(120% 90% at 50% 0%, rgba(${tone.rgb},0.22), transparent 64%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.3))`,
      }}
    >
      {/* Barrido de energía: UN nodo, una pasada, solo con movimiento. */}
      {!reduced && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
          style={{ background: `linear-gradient(90deg, transparent, rgba(${tone.rgb},0.18), transparent)` }}
          initial={{ x: "0%" }}
          animate={{ x: "420%" }}
          transition={{ duration: 0.9, ease: EASE.out }}
        />
      )}

      <p className="nx-label">
        {modeLabel}
        {rivalName && <span className="text-white/60"> · contra {rivalName}</span>}
      </p>

      <motion.h1
        data-verdict={verdict}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.4, letterSpacing: "0.22em" }}
        animate={{ opacity: 1, scale: 1, letterSpacing: "0.03em" }}
        transition={{ duration: 0.5, ease: EASE.out }}
        className={cn("mt-2 font-display text-[clamp(40px,10vw,78px)] font-bold uppercase leading-none", tone.cls)}
        style={{ textShadow: `0 0 44px rgba(${tone.rgb},0.55)` }}
      >
        {p.title}
      </motion.h1>
      {cause && <p className="mt-2 text-sm text-white/60">{cause}</p>}

      {p.score && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: at(0.28), duration: 0.3, ease: EASE.out }}
          className="mt-4"
          aria-label={`${p.score.label}: tú ${p.score.you}, rival ${p.score.rival}`}
        >
          <div className="nx-readout flex items-center justify-center gap-5 text-[clamp(40px,10vw,72px)] leading-none">
            <span className="flex flex-col items-center">
              <span className="nx-label !text-[10px]">Tú</span>
              <span className="text-white">{p.score.you}</span>
            </span>
            <span className="text-white/20">–</span>
            <span className="flex flex-col items-center">
              <span className="nx-label !text-[10px]">Rival</span>
              <span className="text-white/70">{p.score.rival}</span>
            </span>
          </div>
          <p className="mt-1 text-[11px] text-white/40">{p.score.label}{p.decision ? ` · ${p.decision}` : ""}</p>
        </motion.div>
      )}

      {p.lastTurn && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: at(0.55), duration: 0.3 }}
          className="mx-auto mt-4 max-w-[52ch] text-caption text-ink-secondary"
          data-testid="last-turn"
        >
          <span className="nx-label mr-1">Último turno · {p.lastTurn.number}</span>
          <b className={cn("font-display uppercase tracking-wide", p.lastTurn.result ? TURN_TONE[p.lastTurn.result] : "text-white/70")}>{p.lastTurn.headline}</b>
          <span className="block sm:inline sm:ml-1">{p.lastTurn.text}</span>
        </motion.p>
      )}
    </motion.section>
  );
}
