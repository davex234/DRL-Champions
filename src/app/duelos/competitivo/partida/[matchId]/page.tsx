"use client";

/**
 * DETALLE DE PARTIDA RANKED — `/duelos/competitivo/partida/[matchId]` (Fase 28).
 * Solo los dos participantes (el servidor responde 404 al resto); solo partidas terminadas.
 */
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchCompetitiveMatch, CompetitiveError, type CompetitiveMatchDetail } from "@/lib/competitive/client";
import { trackCompetitive } from "@/lib/competitive/telemetry";
import { MatchDetailView } from "@/components/competitive/MatchDetailView";
import { Loading, ErrorState, EmptyState, NeedsAccount } from "@/components/ui/States";

export default function PartidaPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();
  const [detail, setDetail] = useState<CompetitiveMatchDetail | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setDetail(await fetchCompetitiveMatch(matchId)); }
    catch (e) { setError({ message: e instanceof Error ? e.message : "No se pudo leer la partida", status: e instanceof CompetitiveError ? e.status : 500 }); }
  }, [matchId]);
  useEffect(() => { if (online && user) void load(); }, [online, user, load]);
  useEffect(() => { trackCompetitive("match_detail_view"); }, []);

  if (loading) return <Loading label="Leyendo la partida…" />;
  if (!online || !user) return <NeedsAccount what="el detalle de la partida" />;
  // F68 · un id mal formado (400) es, para el jugador, lo mismo que uno que no existe: nada que reintentar.
  if (error?.status === 404 || error?.status === 400) {
    return <EmptyState icon="🔒" title="Partida no encontrada" hint="Solo los dos jugadores de una partida pueden ver su detalle." action={{ href: "/competitivo", label: "Volver al competitivo" }} />;
  }
  if (error?.status === 409) {
    return <EmptyState icon="⏳" title="La partida no ha terminado" hint="El detalle se abre cuando el servidor la cierra." action={{ href: "/duelos/pvp", label: "Ir a la arena" }} />;
  }
  if (error && !detail) return <ErrorState message={error.message} onRetry={load} />;
  if (!detail) return <Loading label="Leyendo la partida…" />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <Link href="/duelos/competitivo/historial" className="nx-action">‹ Historial</Link>
      <MatchDetailView detail={detail} />
    </div>
  );
}
