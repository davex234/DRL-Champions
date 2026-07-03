"use client";

/**
 * OBSERVER TAG — surfacea la cámara inteligente: a quién sigue, por qué y la situación
 * (clutch/retake/lurk/duel…), la fase táctica y la última orden del coach. Reutiliza el
 * `observer` del Broadcast (datos antes muertos: reason/priority) + la presentación viva.
 */
import type { LivePresentation } from "@/broadcast";
import { cn } from "@/lib/format";

const SIT: Record<string, string> = {
  clutch: "CLUTCH", defuse: "DESACTIVANDO", plant: "PLANTANDO", retake: "RETAKE",
  first_duel: "DUELO DE APERTURA", trade: "TRADE", duel: "DUELO", lurk: "LURK",
  rotation: "ROTACIÓN", default: "JUEGO", lull: "CALMA",
};

export function ObserverTag({ live }: { live: LivePresentation }) {
  const o = live.observer;
  const hot = ["clutch", "retake", "defuse", "plant"].includes(o.situation);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-base-900/70 px-3 py-1.5 backdrop-blur-sm">
      <span className={cn("rounded px-1.5 py-0.5 font-display text-[9px] font-black uppercase tracking-widest", hot ? "bg-drl text-white" : "bg-white/10 text-white/60")}>
        {SIT[o.situation] ?? o.situation}
      </span>
      {o.focusName && <span className="font-display text-[11px] font-bold uppercase text-white">{o.focusName}</span>}
      {o.reason && <span className="text-[10px] text-white/45">{o.reason}</span>}
      {live.tacticalPhase && <span className="ml-auto text-[9px] uppercase tracking-widest text-cyan-300/70">fase {live.tacticalPhase}</span>}
      {live.coachCall && <span className="rounded bg-drl/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-drl">call: {live.coachCall}</span>}
    </div>
  );
}
