"use client";

import { useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatCredits, cn } from "@/lib/format";

type Tab = "level" | "collection" | "market" | "rarities";

const TABS: [Tab, string, string][] = [
  ["level", "Top Nivel", "ranking_level"],
  ["collection", "Top Colección", "ranking_collection"],
  ["market", "Top Mercado", "ranking_market"],
  ["rarities", "Top Rarezas", "ranking_rarities"],
];

interface Row {
  id: string;
  username: string;
  avatar: string;
  level?: number;
  xp?: number;
  collection_value?: number;
  distinct_cards?: number;
  market_volume?: number;
  rarest_rank?: number;
}

export default function RankingPage() {
  const configured = isSupabaseConfigured();
  const [tab, setTab] = useState<Tab>("level");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const view = TABS.find((t) => t[0] === tab)![2];
    setLoading(true);
    getSupabase()!
      .from(view)
      .select("*")
      .then(({ data }) => {
        setRows((data as Row[]) ?? []);
        setLoading(false);
      });
  }, [tab, configured]);

  function metric(r: Row): string {
    switch (tab) {
      case "level":
        return `Nv ${r.level} · ${formatCredits(r.xp ?? 0)} XP`;
      case "collection":
        return `🪙 ${formatCredits(r.collection_value ?? 0)} · ${r.distinct_cards ?? 0} cartas`;
      case "market":
        return `🪙 ${formatCredits(r.market_volume ?? 0)}`;
      case "rarities":
        return `Rareza máx ${r.rarest_rank ?? 0} · ${r.distinct_cards ?? 0} cartas`;
    }
  }

  return (
    <section className="animate-rise">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Clasificaciones
        </h1>
        <p className="mt-1 text-white/50">Los mejores coleccionistas de DRL Champions.</p>
      </header>

      {!configured ? (
        <div className="rounded-2xl border border-white/10 bg-base-700/40 p-8 text-center text-white/55">
          Las clasificaciones requieren cuenta online (Supabase). Estás en modo local.
        </div>
      ) : (
        <>
          <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-base-700/40 p-1">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "shrink-0 rounded-lg px-4 py-2 font-display text-sm uppercase tracking-wide transition",
                  tab === id ? "bg-drl text-white shadow-glow" : "text-white/55 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid min-h-[20vh] place-items-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-drl border-t-transparent" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-white/40">Aún no hay datos en esta clasificación.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div
                  key={r.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-3",
                    i < 3 ? "border-drl-gold/30 bg-drl-gold/5" : "border-white/10 bg-base-700/50",
                  )}
                >
                  <span className="w-8 text-center font-display text-lg font-bold text-white/60">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </span>
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-base-800 text-xl">{r.avatar}</span>
                  <span className="min-w-0 flex-1 truncate font-display font-bold text-white">{r.username}</span>
                  <span className="shrink-0 font-display text-sm text-drl-gold">{metric(r)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
