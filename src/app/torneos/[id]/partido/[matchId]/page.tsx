"use client";

/**
 * `/torneos/[id]/partido/[matchId]` — MATCH CENTER (Fase 30). Un partido real leído de
 * `GET /api/game/live-events?match=`: equipos, estado, marcador, formato, mapas (TBD sigue siendo
 * TBD), estadísticas y la predicción relacionada. Ganador solo si el backend lo confirma.
 * Refresco con la política de Pick'ems (20 s en directo).
 */
import { use, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchEventMatch, useLiveRefresh, LiveEventsError, type EventMatchSnapshot } from "@/lib/liveEvents/client";
import { trackLiveEvent } from "@/lib/liveEvents/telemetry";
import { MatchCenter } from "@/components/liveEvents/MatchCenter";
import { Loading, ErrorState, EmptyState, NeedsAccount } from "@/components/ui/States";

export default function PartidoPage({ params }: { params: Promise<{ id: string; matchId: string }> }) {
  const { id, matchId } = use(params);
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();
  const [snap, setSnap] = useState<EventMatchSnapshot | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setSnap(await fetchEventMatch(matchId)); }
    catch (e) { setError({ message: e instanceof Error ? e.message : "No se pudo leer el partido", status: e instanceof LiveEventsError ? e.status : 500 }); throw e; }
  }, [matchId]);
  useEffect(() => { if (online && !loading) void load().catch(() => null); }, [online, loading, user, load]);
  useEffect(() => { trackLiveEvent("event_match_view"); }, []);

  const label = snap?.match.label;
  useLiveRefresh({ enabled: online && snap !== null, status: label === "EN CURSO" ? "live" : label === "FINALIZADO" ? "finished" : "upcoming", hasLive: label === "EN CURSO", reload: load });

  if (!online) return <NeedsAccount what="El circuito competitivo" />;
  if (loading || (!snap && !error)) return <Loading label="Leyendo el partido…" />;
  if (error?.status === 404 || error?.status === 400) {
    return <EmptyState icon="🏟️" title="Partido no encontrado" hint="Puede que se haya retirado del calendario." action={{ href: `/torneos/${id}`, label: "Volver al evento" }} />;
  }
  if (error && !snap) return <ErrorState message={error.message} onRetry={() => void load().catch(() => null)} />;
  return <MatchCenter snap={snap!} onPickemCta={() => trackLiveEvent("event_pickem_cta")} />;
}
