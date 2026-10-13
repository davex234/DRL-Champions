"use client";

/**
 * Dock inferior de la retransmisión — integra TODO el contexto de la ronda en una
 * sola franja elegante: plan del entrenador (objetivo/concepto/coach call), win
 * probability + momentum, MVP en directo y jugador observado. TONTO: consume el
 * BroadcastState + el momentum del partido. Reemplaza al win-prob/lower-third sueltos.
 */
import { AnimatePresence, motion } from "framer-motion";
import type { BroadcastState } from "@/broadcast";
import { ATK, DEF, sideHex } from "./theme";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("broadcast");

const SIT: Record<string, string> = {
  clutch: "CLUTCH", defuse: "DEFUSE", plant: "PLANT", retake: "RETAKE",
  first_duel: "PRIMER DUELO", trade: "TRADE", duel: "DUELO", lurk: "LURK",
  rotation: "ROTACIÓN", default: "CONTROL", lull: "CALMA",
};
const OBJ: Record<string, string> = {
  execute_site: "Ejecutar sitio", map_control: "Control de mapa", hold_default: "Defensa estándar",
  bait_rotation: "Fintar rotación", surprise_pick: "Buscar pick", gather_info: "Sacar info",
  win_duels: "Ganar duelos", stack_site: "Apilar sitio",
};

export function BroadcastDock({ bs, momentum }: { bs: BroadcastState; momentum: number }) {
  useLocale();
  const atkPct = Math.round(bs.stats.winProb.atk * 100);
  const plan = bs.plan;
  // momentum hacia el equipo entrenado → conviértelo a ATK/DEF para colorear
  const momTowardAtk = bs.match.coachSide === "ATK" ? momentum : -momentum;
  const momPct = Math.round((momTowardAtk + 100) / 2);

  return (
    <motion.div initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, type: "spring", stiffness: 170, damping: 24 }}
      className="pointer-events-none flex items-stretch gap-2">
      {/* PLAN del entrenador */}
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur-md">
        <span className="font-display text-[8px] uppercase tracking-[0.25em] text-drl">{t("Plan")}</span>
        {plan ? (
          <div className="min-w-0">
            <p className="truncate font-display text-[12px] font-bold uppercase tracking-wide text-white">
              {td(plan.concept) ?? td(plan.entry)}{plan.changed && <span className="ml-1 text-[8px] text-amber-300">●</span>}
            </p>
            <p className="truncate text-[9px] text-white/45">{td(OBJ[plan.objective]) ?? td(plan.objective)} · {td(plan.tempo)} {t("· riesgo")} {td(plan.risk)}</p>
          </div>
        ) : <span className="text-[10px] text-white/40">—</span>}
      </div>

      {/* WIN PROB + MOMENTUM */}
      <div className="flex flex-1 flex-col justify-center rounded-md border border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur-md">
        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.18em]">
          <span className="font-bold" style={{ color: ATK }}>{atkPct}%</span>
          <span className="text-white/35">{td(bs.stats.prediction.label)}</span>
          <span className="font-bold" style={{ color: DEF }}>{100 - atkPct}%</span>
        </div>
        <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out" style={{ width: `${atkPct}%`, backgroundColor: ATK }} />
          <div className="absolute inset-y-0 right-0 transition-[width] duration-500 ease-out" style={{ width: `${100 - atkPct}%`, backgroundColor: DEF }} />
          <div className="absolute inset-y-[-2px] w-0.5 bg-white shadow-[0_0_6px_#fff] transition-[left] duration-500 ease-out" style={{ left: `${atkPct}%` }} />
        </div>
        {/* momentum */}
        <div className="mt-1 flex items-center gap-1.5">
          <span className="font-display text-[8px] uppercase tracking-[0.2em] text-white/35">{t("Mom.")}</span>
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
            <div className="absolute inset-y-0 transition-all duration-500" style={{
              left: `${Math.min(50, momPct)}%`, width: `${Math.abs(momPct - 50)}%`,
              background: momTowardAtk >= 0 ? ATK : DEF,
            }} />
          </div>
        </div>
      </div>

      {/* MVP + OBSERVADO */}
      <div className="flex items-center gap-3 rounded-md border border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur-md">
        {bs.mvp && (
          <div className="text-right">
            <p className="font-display text-[8px] uppercase tracking-[0.2em] text-amber-300">{t("MVP ronda")}</p>
            <p className="font-display text-[12px] font-bold uppercase text-white">{bs.mvp.name} <span className="text-white/40">{bs.mvp.kills}K</span></p>
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div key={bs.observer.focusPlayerId ?? "tac"}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}
            className="border-l border-white/10 pl-3 text-right">
            <p className="font-display text-[12px] font-bold uppercase text-white">{td(bs.observer.focusName) ?? t("Vista táctica")}</p>
            <p className="font-display text-[9px] uppercase tracking-[0.2em]" style={{ color: sideHex(bs.match.coachSide) }}>
              {td(SIT[bs.observer.situation]) ?? bs.observer.situation}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
