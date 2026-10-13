"use client";

/**
 * HISTORIAL RANKED — `/duelos/competitivo/historial` (Fase 28). Páginas de 10 por cursor
 * (`before` = `updated_at` de la última fila); nunca el histórico entero.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchCompetitiveHistory, type CompetitiveMatchRow } from "@/lib/competitive/client";
import { trackCompetitive } from "@/lib/competitive/telemetry";
import { MatchHistoryList } from "@/components/competitive/MatchHistoryList";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { playerMessage } from "@/components/ui/game/GameStates";

export default function HistorialPage() {
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();
  const [rows, setRows] = useState<CompetitiveMatchRow[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before: number | null) => {
    setBusy(true); setError(null);
    try {
      const page = await fetchCompetitiveHistory(before, 10);
      if (!page) return;
      setRows((cur) => (before === null ? page.matches : [...(cur ?? []), ...page.matches]));
      setNext(page.nextBefore);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo leer el historial"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (online && user) void load(null); }, [online, user, load]);
  useEffect(() => { trackCompetitive("history_view"); }, []);

  if (loading) return <Loading label="Leyendo el historial…" />;
  if (!online || !user) return <NeedsAccount what="tu historial ranked" />;
  if (error && !rows) return <ErrorState message={error} onRetry={() => load(null)} />;
  if (!rows) return <Loading label="Leyendo el historial…" />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5" data-scene="competitive-history">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="font-display text-label uppercase tracking-wide2 text-drl">Competitivo</span>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-wide text-white md:text-3xl">Historial ranked</h1>
          <p className="mt-1 text-sm text-ink-muted">Cada partida con su desenlace real y el asiento de rating que la liquidó.</p>
        </div>
        <Link href="/competitivo" className="nx-action">‹ Competitivo</Link>
      </header>
      <MatchHistoryList matches={rows} hasMore={next !== null} loading={busy} onMore={() => load(next)} />
      {error && <p role="alert" className="text-caption text-drl">{playerMessage(error)}</p>}
    </div>
  );
}
