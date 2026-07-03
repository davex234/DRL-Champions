"use client";

/**
 * HUD del MAPA VIVO (Utility Engine) — muestra control de mapa, utilidad restante,
 * probabilidad de execute y zonas calientes/bloqueadas, además del "read" del coach.
 * TONTO: consume `RoundState.map` + helpers del Utility Engine. Hace VISIBLE quién
 * controla, quién presiona y quién creó espacio, sin un solo efecto gráfico.
 */
import { AnimatePresence, motion } from "framer-motion";
import type { MapState } from "@/utility";
import { hotZones } from "@/utility";
import { ATK, DEF } from "./theme";

const ZL: Record<string, string> = {
  a_main: "Main", a_main_choke: "Main", tree: "Tree", tree_choke: "Tree", mid: "Mid",
  site: "Site", plant: "Plante", generator: "Gen", heaven: "Heaven", ct: "CT",
};

function UtilPips({ remaining, total, hex }: { remaining: number; total: number; hex: string }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: Math.min(12, total) }).map((_, i) => (
        <span key={i} className="h-1.5 w-1 rounded-sm" style={{ background: i < remaining ? hex : "rgba(255,255,255,0.14)" }} />
      ))}
    </div>
  );
}

export function MapStateHUD({ map, execProb }: { map: MapState; execProb: number }) {
  const totalZones = Math.max(1, map.control.ATK + map.control.DEF);
  const atkPct = Math.round((map.control.ATK / totalZones) * 100);
  const hot = hotZones(map);
  const blocked = Object.entries(map.zones).filter(([, z]) => z.status.includes("blocked")).map(([id]) => ZL[id] ?? id);

  return (
    <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}
      className="pointer-events-none w-44 space-y-1 rounded-md border border-white/10 bg-black/55 px-2.5 py-1.5 backdrop-blur-md">
      <p className="font-display text-[8px] uppercase tracking-[0.25em] text-white/35">Control del mapa</p>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-0" style={{ width: `${atkPct}%`, background: ATK }} />
        <div className="absolute inset-y-0 right-0" style={{ width: `${100 - atkPct}%`, background: DEF }} />
      </div>
      <div className="flex items-center justify-between text-[8px] uppercase tracking-wider text-white/40">
        <span>ATK · util</span><span>DEF · util</span>
      </div>
      <div className="flex items-center justify-between">
        <UtilPips remaining={Math.max(0, map.charges.ATK - map.spent.ATK)} total={map.charges.ATK} hex={ATK} />
        <UtilPips remaining={Math.max(0, map.charges.DEF - map.spent.DEF)} total={map.charges.DEF} hex={DEF} />
      </div>
      <div className="flex items-center gap-1.5 border-t border-white/10 pt-1">
        <span className="font-display text-[8px] uppercase tracking-widest text-white/35">Exec</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full transition-all" style={{ width: `${execProb}%`, background: ATK }} />
        </div>
        <span className="font-display text-[9px] tabular-nums text-white/55">{execProb}%</span>
      </div>
      {(hot.length > 0 || blocked.length > 0) && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {hot.slice(0, 2).map((h) => (
            <span key={h.zone} className="rounded bg-rose-500/20 px-1 text-[8px] font-bold uppercase text-rose-200">🔥 {ZL[h.zone] ?? h.zone}</span>
          ))}
          {blocked.slice(0, 1).map((b, i) => (
            <span key={i} className="rounded bg-white/15 px-1 text-[8px] font-bold uppercase text-white/60">🚫 {b}</span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function CoachReadTicker({ read }: { read: string | null }) {
  return (
    <div className="pointer-events-none">
      <AnimatePresence mode="wait">
        {read && (
          <motion.div key={read} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}
            className="flex items-center gap-1.5 rounded border-l-2 border-amber-300 bg-black/60 px-2.5 py-1 backdrop-blur-sm">
            <span className="font-display text-[8px] uppercase tracking-[0.25em] text-amber-300">Read</span>
            <span className="font-display text-[11px] uppercase tracking-wide text-white/85">{read}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
