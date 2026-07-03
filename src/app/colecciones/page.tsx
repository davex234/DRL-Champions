"use client";

/**
 * Colecciones — página PRIVADA ("Mis Colecciones").
 *
 * Lista todas las colecciones (local + Supabase) con MI progreso (%, obtenidas/
 * faltantes), filtros y reclamación de la recompensa exclusiva al completar.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useGameStore } from "@/store/useGameStore";
import { useRosterStore } from "@/store/useRosterStore";
import { useCollectionsStore } from "@/store/useCollectionsStore";
import { mergedCollections } from "@/lib/collections/repos";
import { collectionProgress, overallProgress } from "@/domain/collections/progress";
import { rewardSummary } from "@/lib/collections/format";
import type { CollectionDef } from "@/domain/collections/types";
import { cn } from "@/lib/format";

export default function ColeccionesPage() {
  return (
    <HydrationGate>
      <Colecciones />
    </HydrationGate>
  );
}

type StatusFilter = "todas" | "completas" | "incompletas";
type SourceFilter = "todas" | "tournament" | "local";

function Colecciones() {
  const { toast, notify } = useToast();
  const ownedCards = useGameStore((s) => s.ownedCards);
  const rosterVersion = useRosterStore((s) => s.version);
  const claimed = useCollectionsStore((s) => s.claimed);
  const claim = useCollectionsStore((s) => s.claim);

  const [defs, setDefs] = useState<CollectionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todas");
  const [source, setSource] = useState<SourceFilter>("todas");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    mergedCollections().then((d) => { if (alive) { setDefs(d); setLoading(false); } });
    return () => { alive = false; };
  }, [rosterVersion]);

  const ownedIds = useMemo(() => new Set(ownedCards.map((o) => o.cardId)), [ownedCards]);
  const overall = useMemo(() => overallProgress(defs, ownedIds), [defs, ownedIds]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return defs
      .map((d) => ({ def: d, prog: collectionProgress(d, ownedIds) }))
      .filter(({ def, prog }) => {
        if (q && !def.name.toLowerCase().includes(q)) return false;
        if (source !== "todas" && def.source !== source) return false;
        if (status === "completas" && !prog.complete) return false;
        if (status === "incompletas" && prog.complete) return false;
        return true;
      })
      .sort((a, b) => b.prog.pct - a.prog.pct);
  }, [defs, ownedIds, query, status, source]);

  return (
    <section className="animate-rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            Mis <span className="text-drl">Colecciones</span>
          </h1>
          <p className="mt-1 text-white/50">
            {overall.completed}/{overall.collections} completas · {overall.owned}/{overall.total} cartas ·{" "}
            {overall.pct}% global.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <input className={inputCls} placeholder="Buscar colección…" value={query}
          onChange={(e) => setQuery(e.target.value)} />
        <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
          <option value="todas">Todas las fuentes</option>
          <option value="tournament">Torneos</option>
          <option value="local">Eventos (local)</option>
        </select>
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="todas">Cualquier estado</option>
          <option value="completas">Completas</option>
          <option value="incompletas">Incompletas</option>
        </select>
      </div>

      {loading ? (
        <p className="text-white/40">Cargando colecciones…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-base-700/40 p-6 text-white/50">
          No hay colecciones que coincidan. Las colecciones de torneo aparecen cuando un admin finaliza un
          torneo; las de eventos están siempre disponibles.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map(({ def, prog }) => {
            const claimId = `coll:${def.id}`;
            const isClaimed = claimed.includes(claimId);
            return (
              <div key={def.id} className={cn("relative overflow-hidden rounded-2xl border bg-base-700/50 p-5",
                prog.complete ? "border-drl-cyan/40" : "border-white/10")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/colecciones/${def.slug}`}
                      className="font-display text-lg font-bold uppercase text-white hover:text-drl">
                      {def.name}
                    </Link>
                    <p className="text-[11px] uppercase tracking-widest text-white/40">
                      {def.source === "tournament" ? "Torneo" : "Evento"}{def.tier ? ` · ${def.tier}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-display text-2xl font-bold tabular-nums text-drl-cyan">{prog.pct}%</span>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className={cn("h-full rounded-full", prog.complete ? "bg-gradient-to-r from-drl-cyan to-drl" : "bg-white/30")}
                      style={{ width: `${prog.pct}%` }} />
                  </div>
                  <span className="font-display text-xs tabular-nums text-white/50">{prog.owned}/{prog.total}</span>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-xs text-drl-gold">🎁 {rewardSummary(def.reward)}</span>
                  {isClaimed ? (
                    <span className="rounded-lg bg-drl-cyan/15 px-3 py-1.5 font-display text-xs uppercase text-drl-cyan">✓ Reclamado</span>
                  ) : (
                    <button disabled={!prog.complete}
                      onClick={() => { if (claim(claimId, def.reward)) notify(`¡Recompensa de ${def.name} reclamada!`, true); }}
                      className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30">
                      Reclamar
                    </button>
                  )}
                </div>
                {prog.missing.length > 0 && (
                  <p className="mt-2 text-[11px] text-white/35">Faltan {prog.missing.length} cartas.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Toast toast={toast} />
    </section>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none";
