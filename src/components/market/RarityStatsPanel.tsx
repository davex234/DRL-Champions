"use client";

import { useEffect, useState } from "react";
import { fetchRarityStats } from "@/lib/supabase/market";
import type { RarityStatRow } from "@/lib/supabase/types";
import { formatCredits } from "@/lib/format";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("market");

/** Estadística por rareza (rank): nº de cartas, valor medio y volumen. */
export function RarityStatsPanel() {
  useLocale();
  const [rows, setRows] = useState<RarityStatRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    fetchRarityStats().then((d) => { if (on) { setRows(d); setLoading(false); } });
    return () => { on = false; };
  }, []);

  if (loading) {
    return <div className="grid min-h-[20vh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-drl border-t-transparent" /></div>;
  }
  if (rows.length === 0) {
    return <p className="py-10 text-center text-white/40">{t("Aún no hay datos de rareza. Ejecuta la sincronización de referencia.")}</p>;
  }

  const maxAvg = Math.max(1, ...rows.map((r) => Number(r.avg_fair_value ?? 0)));

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const avg = Number(r.avg_fair_value ?? 0);
        const pct = Math.max(2, (avg / maxAvg) * 100);
        return (
          <div key={r.rank} className="rounded-xl border border-white/10 bg-base-700/50 p-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-display font-bold uppercase text-white">{t("Rareza")} {r.rank}</span>
              <span className="text-white/50">{t("{cartas} cartas · {ventas} ventas", { cartas: r.cards, ventas: r.trades })}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-gradient-to-r from-drl to-drl-gold" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
              <span>{t("valor medio 🪙 {n}", { n: formatCredits(avg) })}</span>
              <span>{t("volumen 🪙 {n}", { n: formatCredits(Number(r.volume ?? 0)) })}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
