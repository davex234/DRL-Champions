"use client";

/**
 * FASE 55 · RIVAL ENCONTRADO (ranked). Transición breve (~1,8 s) entre la cola y la arena: tu lado y el del rival
 * con la identidad PÚBLICA que da el servidor (`GET /api/game/competitive?matchup=`, solo a los dos jugadores):
 * nombre, avatar, rating, puesto y si está en colocación. El rival es una PERSONA (la cola no tiene bots) y se
 * etiqueta así. Nada de su mazo ni de su mano.
 *
 * No retrasa la partida: la arena ya está sincronizándose por debajo; la barra avanza y la transición se cierra
 * sola (o con «Empezar» / Intro / Esc). Con movimiento reducido no hay desplazamientos, solo la barra.
 */
import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { NxButton } from "@/components/ui/NxButton";
import { playSound } from "@/lib/sound";
import { matchupEdge, positionLabel } from "@/domain/pvpLadder/ranked";
import type { CompetitiveMatchup } from "@/lib/competitive/client";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export const MATCH_FOUND_MS = 1800;

type Side = CompetitiveMatchup["you"];

export function RankedMatchFound({ matchup, deckName, onDone }: { matchup: CompetitiveMatchup | null; deckName: string | null; onDone: () => void }) {
  useLocale();
  const reduced = useReducedMotion();
  // F64 · «rival encontrado» suena UNA vez al aparecer (tras el gesto de buscar partida: el audio ya está desbloqueado).
  useEffect(() => { playSound("match.found"); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") onDone(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  const edge = matchup ? matchupEdge(matchup.you, matchup.rival) : null;

  return (
    <section
      role="dialog" aria-modal="false" aria-labelledby="match-found-title"
      className="relative mx-auto flex w-full max-w-4xl flex-col items-center overflow-hidden px-4 py-8 text-center sm:py-12"
      data-testid="ranked-match-found"
    >
      <motion.p className="nx-label !text-drl" initial={reduced ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>{t("Ranked · duelo PvP")}</motion.p>
      <motion.h1 id="match-found-title" className="mt-1 font-display text-[clamp(34px,8vw,64px)] font-bold uppercase leading-none tracking-wide text-white"
        initial={reduced ? false : { opacity: 0, scale: 1.25 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        style={{ textShadow: "0 0 32px rgba(255,46,99,0.55)" }}>
        {t("Rival encontrado")}
      </motion.h1>

      <div className="mt-7 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
        <SideCard side={matchup?.you ?? null} tag="Tú" sub={deckName ? t("Equipo: {deckName}", { deckName: td(deckName) }) : null} from={reduced ? 0 : -40} tone="cyan" />
        <motion.span className="font-display text-[clamp(26px,6vw,46px)] font-bold text-white/85" aria-hidden
          initial={reduced ? false : { opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25, duration: 0.3 }}>{t("VS")}</motion.span>
        <SideCard side={matchup?.rival ?? null} tag={t("Jugador real")} sub={matchup?.rival.provisional ? t("En colocación") : null} from={reduced ? 0 : 40} tone="red" />
      </div>

      {edge && <p className="mt-4 text-[13px] text-white/60" data-field="edge">{td(edge.label)}</p>}

      <div className="mt-6 w-full max-w-sm" aria-hidden>
        <div className="nx-clip-sm h-1.5 overflow-hidden bg-white/10">
          <motion.div className="h-full bg-gradient-to-r from-drl to-drl-cyan" initial={{ width: "0%" }} animate={{ width: "100%" }}
            transition={{ duration: MATCH_FOUND_MS / 1000, ease: "linear" }} onAnimationComplete={onDone} />
        </div>
      </div>
      <div className="mt-4">
        <NxButton variant="primary" onClick={onDone} data-testid="match-found-go">{t("Empezar")}</NxButton>
      </div>
    </section>
  );
}

function SideCard({ side, tag, sub, from, tone }: { side: Side | null; tag: string; sub: string | null; from: number; tone: "cyan" | "red" }) {
  useLocale();
  const border = tone === "cyan" ? "border-drl-cyan/45" : "border-drl/50";
  const glow = tone === "cyan" ? "rgba(25,227,255,0.18)" : "rgba(255,46,99,0.2)";
  return (
    <motion.div className={`nx-clip min-w-0 border ${border} px-3 py-4 sm:px-5 sm:py-6`} style={{ background: `radial-gradient(100% 90% at 50% 0%, ${glow}, rgba(0,0,0,0.3) 70%)` }}
      initial={from === 0 ? false : { opacity: 0, x: from }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      data-side={tone === "cyan" ? "you" : "rival"}>
      <span className="nx-label block !text-[10px] !text-white/60">{tag}</span>
      <span className="mt-1 block text-[34px] leading-none sm:text-[44px]" aria-hidden>{side?.avatar ?? "…"}</span>
      <span className="mt-2 block truncate font-display text-[16px] font-bold uppercase text-white sm:text-[20px]" data-field="name">{side?.username ?? t("Cargando…")}</span>
      {side && (
        <span className="mt-1 block text-[12.5px] text-white/70">
          <b className="nx-readout text-[18px] text-white" data-field="rating">{side.rating}</b> · {positionLabel(side.position)}
        </span>
      )}
      {sub && <span className="mt-1 block truncate text-[11px] text-white/45">{td(sub)}</span>}
    </motion.div>
  );
}
