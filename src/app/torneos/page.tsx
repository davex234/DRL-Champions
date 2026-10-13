"use client";

/**
 * `/torneos` — EVENTS OVERVIEW (Fase 30). EN CURSO · PRÓXIMAMENTE · FINALIZADOS con los eventos
 * REALES del pipeline, leídos de `GET /api/game/live-events` (una foto derivada en el servidor:
 * estado por partidos, próximo partido, participantes, predicciones pendientes con sesión).
 * Se refresca con la política de Pick'ems (más rápido si hay un partido en directo). Sin sesión se
 * ve igual, sin la parte personal. No inventa eventos: sin filas, «no hay eventos publicados».
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchEventsOverview, useLiveRefresh, type EventsOverviewSnapshot } from "@/lib/liveEvents/client";
import { trackLiveEvent } from "@/lib/liveEvents/telemetry";
import { EventsOverview } from "@/components/liveEvents/EventsOverview";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";

export default function TorneosPage() {
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();
  const [snap, setSnap] = useState<EventsOverviewSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setSnap(await fetchEventsOverview()); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudieron leer los eventos"); throw e; }
  }, []);
  useEffect(() => { if (online && !loading) void load().catch(() => null); }, [online, loading, user, load]);
  useEffect(() => { trackLiveEvent("event_view"); }, []);

  const hasLive = (snap?.active ?? []).some((e) => e.liveCount > 0);
  useLiveRefresh({ enabled: online && snap !== null, status: (snap?.active.length ?? 0) > 0 ? "live" : (snap?.upcoming.length ?? 0) > 0 ? "upcoming" : "finished", hasLive, reload: load });

  if (!online) return <NeedsAccount what="El circuito competitivo" />;
  if (loading || (!snap && !error)) return <Loading label="Leyendo el circuito…" />;
  if (error && !snap) return <ErrorState message={error} onRetry={() => void load().catch(() => null)} />;
  return <EventsOverview snap={snap!} />;
}
