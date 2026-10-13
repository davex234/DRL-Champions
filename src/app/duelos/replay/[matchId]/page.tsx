"use client";

/**
 * `/duelos/replay/[matchId]` — REPETICIÓN (Fase 8).
 *
 * Pide la repetición al servidor, que solo la sirve si la partida terminó. Todo lo que se ve son
 * las decisiones reales de aquella partida: el motor es determinista, así que la repetición no es
 * una reconstrucción aproximada sino lo que ocurrió.
 */
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount, EmptyState } from "@/components/ui/States";
import { ReplayViewer } from "@/components/duel/ReplayViewer";
import { fetchDuelReplay, DuelError } from "@/lib/duel/client";
import { trackExperience } from "@/lib/duel/experienceTelemetry";
import type { DuelReplay } from "@/lib/duel/types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duelos");

export default function ReplayPage({ params }: { params: Promise<{ matchId: string }> }) {
  useLocale();
  const { matchId } = use(params);
  const { user, loading } = useAuth();

  if (loading) return <Loading label={t("Cargando repetición…")} />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what={t("ver repeticiones")} />;
  return <Replay matchId={matchId} />;
}

function Replay({ matchId }: { matchId: string }) {
  useLocale();
  const router = useRouter();
  const [replay, setReplay] = useState<DuelReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setStatus(null);
    try {
      setReplay(await fetchDuelReplay(matchId));
      trackExperience("replay_open");
    } catch (e) {
      // Fase 33 · 404 (no existe o no eres participante) y 409 (sin terminar) son estados, no errores.
      setStatus(e instanceof DuelError ? e.status : null);
      setError(e instanceof Error ? e.message : t("No se pudo cargar la repetición"));
    }
  }, [matchId]);

  useEffect(() => { void load(); }, [load]);

  if (status === 404 || status === 400) {
    return <EmptyState icon="🎞️" title={t("Partida no encontrada")} hint={t("Solo los jugadores de una partida pueden ver su repetición.")} action={{ href: "/duelos", label: t("Volver a Duelos") }} />;
  }
  if (status === 409) {
    return <EmptyState icon="⏳" title={t("La partida aún no ha terminado")} hint={t("La repetición se abre cuando termina: mientras se juega, lo no jugado sigue oculto.")} action={{ href: "/duelos", label: t("Volver a Duelos") }} />;
  }
  if (error) return <ErrorState message={td(error)} onRetry={load} />;
  if (!replay) return <Loading label={t("Cargando repetición…")} />;
  return <ReplayViewer replay={replay} onBack={() => router.push("/duelos")} />;
}
