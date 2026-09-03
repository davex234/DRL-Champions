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
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { ReplayViewer } from "@/components/duel/ReplayViewer";
import { fetchDuelReplay } from "@/lib/duel/client";
import type { DuelReplay } from "@/lib/duel/types";

export default function ReplayPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const { user, loading } = useAuth();

  if (loading) return <Loading label="Cargando repetición…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="ver repeticiones" />;
  return <Replay matchId={matchId} />;
}

function Replay({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [replay, setReplay] = useState<DuelReplay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReplay(await fetchDuelReplay(matchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la repetición");
    }
  }, [matchId]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!replay) return <Loading label="Cargando repetición…" />;
  return <ReplayViewer replay={replay} onBack={() => router.push("/duelos")} />;
}
