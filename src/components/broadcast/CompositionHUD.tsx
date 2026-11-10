"use client";

/**
 * HUD de COMPOSICIÓN — muestra en directo el ESTILO de cada equipo (Agent Engine):
 * arquetipo, control, utilidad disponible y probabilidad de execute. TONTO: consume
 * `RoundState.composition`. Hace que se "vea" cómo juega cada equipo sin estadísticas.
 */
import { motion } from "framer-motion";
import type { CompositionProfile } from "@/agents";
import { ATK, DEF } from "./theme";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("broadcast");

function Row({ comp, name, hex }: { comp: CompositionProfile; name: string; hex: string }) {
  useLocale();
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[10px] font-bold uppercase leading-tight text-white">{td(comp.archetypeLabel)}</p>
        <p className="truncate text-[8px] uppercase tracking-wider text-white/40">{td(comp.playstyle[0]) ?? ""}</p>
      </div>
      <span className="font-display text-[9px] tabular-nums text-white/45" title={t("Control")}>{t("CTL")} {comp.ratings.control}</span>
      <span className="font-display text-[9px] tabular-nums text-white/45" title={t("Utilidad")}>⚙{comp.utilityCharges}</span>
    </div>
  );
}

export function CompositionHUD({ composition, names }: {
  composition: { ATK: CompositionProfile; DEF: CompositionProfile };
  names: { atk: string; def: string };
}) {
  useLocale();
  const exec = Math.max(5, Math.min(95, Math.round(50 + (composition.ATK.ratings.execute - composition.DEF.ratings.retake) / 2)));
  return (
    <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
      className="pointer-events-none w-40 rounded-md border border-white/10 bg-black/55 px-2.5 py-1.5 backdrop-blur-md">
      <p className="mb-0.5 font-display text-[8px] uppercase tracking-[0.25em] text-white/35">{t("Composición")}</p>
      <Row comp={composition.ATK} name={names.atk} hex={ATK} />
      <Row comp={composition.DEF} name={names.def} hex={DEF} />
      <div className="mt-1 flex items-center gap-1.5 border-t border-white/10 pt-1">
        <span className="font-display text-[8px] uppercase tracking-widest text-white/35">{t("Exec")}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: `${exec}%`, background: ATK }} />
        </div>
        <span className="font-display text-[9px] tabular-nums text-white/55">{exec}%</span>
      </div>
    </motion.div>
  );
}
