"use client";

/**
 * `/torneos/[id]` — EVENT HUB (Fase 30). Una experiencia alrededor de un evento REAL: hero, en
 * directo / próximo, tus acciones, progreso, Pick'ems (el MISMO `PickemPanel` de `/pickems`),
 * partidos, cuadro (motor de la Fase 24, solo lectura), clasificación si existe, equipos, jugadores
 * y cartas con propiedad real, objetivos (desafíos de evento existentes, reclamación canónica),
 * recompensas canónicas y actividad derivada. Todo sale de `GET /api/game/live-events?event=`.
 *
 * Refresco: política de Pick'ems (20 s con partido en directo, 45 s en curso, 2 min futuro, 5 min
 * terminado; nada con la pestaña oculta o sin red). Un evento terminado sigue siendo esta misma
 * página: los enlaces históricos no se rompen.
 */
import { use, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchEventHub, useLiveRefresh, LiveEventsError, type EventHubSnapshot } from "@/lib/liveEvents/client";
import { trackLiveEvent } from "@/lib/liveEvents/telemetry";
import { claimChallenge } from "@/lib/game/events";
import { useToast } from "@/lib/useToast";
import { formatCredits } from "@/lib/format";
import { Toast } from "@/components/ui/Toast";
import { EventHub } from "@/components/liveEvents/EventHub";
import { PickemPanel } from "@/components/pickems/PickemPanel";
import { Loading, ErrorState, EmptyState, NeedsAccount } from "@/components/ui/States";
import type { ObjectiveView } from "@/server/services/liveEvents";

const STATUS: Record<EventHubSnapshot["state"]["lifecycle"], "upcoming" | "live" | "finished"> = { UPCOMING: "upcoming", ACTIVE: "live", COMPLETED: "finished" };

export default function EventoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, profile, loading, refreshProfile } = useAuth();
  const online = isSupabaseConfigured();
  const { toast, notify } = useToast(2600);
  const [snap, setSnap] = useState<EventHubSnapshot | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setError(null);
    try { const s = await fetchEventHub(id); setSnap(s); setNow(s.serverNow); }
    catch (e) { setError({ message: e instanceof Error ? e.message : "No se pudo leer el evento", status: e instanceof LiveEventsError ? e.status : 500 }); throw e; }
  }, [id]);
  useEffect(() => { if (online && !loading) void load().catch(() => null); }, [online, loading, user, load]);
  useEffect(() => { trackLiveEvent("event_view"); }, []);

  useLiveRefresh({ enabled: online && snap !== null, status: snap ? STATUS[snap.state.lifecycle] : "upcoming", hasLive: (snap?.liveMatches.length ?? 0) > 0, reload: load });

  const onClaim = useCallback(async (o: ObjectiveView) => {
    if (!snap || claiming) return;
    setClaiming(o.id);
    try {
      const r = await claimChallenge(snap.event.id, o.id);
      notify(r.applied ? `Recompensa reclamada · ${formatCredits(r.credits)} créditos` : "Esa recompensa ya estaba reclamada", true);
      await load().catch(() => null);
      refreshProfile();
    } catch (e) { notify(e instanceof Error ? e.message : "No se pudo reclamar", false); }
    finally { setClaiming(null); }
  }, [snap, claiming, notify, load, refreshProfile]);

  if (!online) return <NeedsAccount what="El circuito competitivo" />;
  if (loading || (!snap && !error)) return <Loading label="Leyendo el evento…" />;
  if (error?.status === 404 || error?.status === 400) {
    return <EmptyState icon="🏟️" title="Evento no encontrado" hint="Puede que se haya retirado del circuito." action={{ href: "/torneos", label: "Ver todos los eventos" }} />;
  }
  if (error && !snap) return <ErrorState message={error.message} onRetry={() => void load().catch(() => null)} />;

  return (
    <>
      <EventHub
        snap={snap!}
        now={now}
        pickemPanel={user && snap!.pickem ? (
          <PickemPanel pickemEventId={snap!.pickem.id} userId={user.id} onNotify={notify} onScoreChange={() => { void load().catch(() => null); refreshProfile(); }} eventName={snap!.event.name} totalPoints={profile?.points ?? 0} />
        ) : null}
        onClaim={onClaim}
        claiming={claiming}
        onAction={(a) => { if (a.kind === "pickem") trackLiveEvent("event_pickem_cta"); if (a.kind === "collection") trackLiveEvent("event_collection_cta"); if (a.kind === "pack") trackLiveEvent("event_pack_cta"); }}
        onPickemCta={() => trackLiveEvent("event_pickem_cta")}
        onCollectionCta={() => trackLiveEvent("event_collection_cta")}
        onPackCta={() => trackLiveEvent("event_pack_cta")}
      />
      <Toast toast={toast} />
    </>
  );
}
