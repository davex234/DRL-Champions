"use client";

/**
 * Kill feed superior derecho estilo broadcast. Chips de bando, marca de trade y de
 * "ángulo aguantado". Entradas animadas. TONTO: consume `KillFeedItem[]`.
 */
import { AnimatePresence, motion } from "framer-motion";
import type { KillFeedItem } from "@/broadcast";
import { sideHex } from "./theme";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("broadcast");

export function KillFeed({ items }: { items: KillFeedItem[] }) {
  useLocale();
  const recent = items.slice(-5);
  return (
    <div className="pointer-events-none flex flex-col items-end gap-1">
      <AnimatePresence initial={false}>
        {recent.map((k) => (
          <motion.div
            key={`${k.tick}-${k.killer}-${k.victim}`}
            initial={{ x: 40, opacity: 0, scale: 0.92 }} animate={{ x: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0, x: 16 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/65 py-1 pl-2 pr-1.5 text-[11px] shadow-[0_2px_10px_rgba(0,0,0,0.4)] backdrop-blur-sm">
            <span className="font-display font-bold uppercase tracking-wide" style={{ color: sideHex(k.killerSide) }}>{td(k.killer)}</span>
            {k.trade && <span className="rounded-sm bg-white/15 px-1 text-[8px] font-bold uppercase tracking-widest text-white/70">{t("TR")}</span>}
            <span className="px-0.5 text-white/35">{k.angle ? "✜" : "▸"}</span>
            <span className="font-display uppercase tracking-wide opacity-60" style={{ color: sideHex(k.victimSide) }}>{td(k.victim)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
