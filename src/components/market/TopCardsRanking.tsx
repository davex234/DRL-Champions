"use client";

import { useEffect, useState } from "react";
import { fetchTopCards } from "@/lib/supabase/market";
import type { TopCardRow } from "@/lib/supabase/types";
import { getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { CardThumb } from "@/components/cards/CardThumb";
import { formatCredits } from "@/lib/format";

/** Ranking de las cartas más valiosas del mercado. */
export function TopCardsRanking({ limit = 25 }: { limit?: number }) {
  const [rows, setRows] = useState<TopCardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    fetchTopCards(limit).then((d) => { if (on) { setRows(d); setLoading(false); } });
    return () => { on = false; };
  }, [limit]);

  if (loading) {
    return <div className="grid min-h-[20vh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-drl border-t-transparent" /></div>;
  }
  if (rows.length === 0) {
    return <p className="py-10 text-center text-white/40">Aún no hay datos de mercado. Ejecuta la sincronización de referencia.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const def = getCard(r.card_id);
        const variant = def ? getVariant(def.variantId) : null;
        return (
          <div key={r.card_id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-700/50 p-3">
            <span className="w-6 text-center font-display text-lg font-bold text-white/40">{i + 1}</span>
            {def && <CardThumb card={def} />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-bold uppercase text-white">{r.nick ?? r.card_id}</p>
              <p className="truncate text-xs" style={{ color: variant?.palette.primary ?? "#8b96a3" }}>
                {variant?.label ?? `Rareza ${r.rank}`} · OVR {r.ovr ?? "—"} · {r.team ?? ""}
              </p>
              <p className="text-[11px] text-white/40">
                {r.trade_count ? `${r.trade_count} ventas` : "sin ventas"}
                {r.cheapest_active != null ? ` · desde 🪙 ${formatCredits(r.cheapest_active)}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-sm font-bold text-drl-gold">🪙 {formatCredits(r.value ?? 0)}</p>
              <p className="text-[10px] uppercase tracking-widest text-white/40">valor</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
