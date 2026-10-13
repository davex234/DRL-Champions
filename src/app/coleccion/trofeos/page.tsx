"use client";

/**
 * F82 · `/coleccion/trofeos` — SALA DE TROFEOS. Sets de equipo y edición con TU progreso (calculado en el servidor),
 * insignias desbloqueadas y por desbloquear, y compleciones recientes. Requiere cuenta: el progreso es de tu inventario
 * real, nunca del caché local.
 *
 * LIMPIEZA DE /COLECCION (2026-10-07): la Maestría (F13, conjuntos que pagan insignias) y el Prestigio (F14, mejorar esas
 * insignias) se pintaban bajo el álbum de `/coleccion`; ahora viven aquí, con las demás insignias. Mismos componentes,
 * mismas lecturas y mismos reclamos del servidor; aislados: si fallan, la sala sigue.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { TrophyRoomScreen } from "@/components/trophies/TrophyRoomScreen";
import { fetchTrophyRoom, trophyErrorText, type TrophyRoomView } from "@/lib/collectionSets/client";
import { trackCollections } from "@/lib/collectionSets/telemetry";
import { MasteryPanel } from "@/components/collection/MasteryPanel";
import { PrestigePanel } from "@/components/collection/PrestigePanel";
import { fetchMastery, type MasteryView } from "@/lib/game/mastery";
import { fetchPrestige, type PrestigeView } from "@/lib/game/prestige";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";

export default function TrophyRoomPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label="Cargando tu Sala de Trofeos…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="la Sala de Trofeos" />;
  return <TrophyRoomRoute />;
}

function TrophyRoomRoute() {
  const [room, setRoom] = useState<TrophyRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setRoom(await fetchTrophyRoom()); trackCollections("collection_viewed"); } catch (e) { setError(trophyErrorText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const { toast, notify } = useToast();
  const [mastery, setMastery] = useState<MasteryView | null>(null);
  const [prestige, setPrestige] = useState<PrestigeView | null>(null);
  const reloadMastery = useCallback(() => {
    fetchMastery().then(setMastery).catch(() => setMastery(null));
    fetchPrestige().then(setPrestige).catch(() => setPrestige(null));
  }, []);
  useEffect(() => { reloadMastery(); }, [reloadMastery]);
  // Reclamar maestría o mejorar una insignia cambia las insignias de la sala: se relee también la foto de la sala.
  const onBadgesChanged = useCallback(() => { reloadMastery(); void load(); }, [reloadMastery, load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!room) return <Loading kind="hub" label="Cargando tu Sala de Trofeos…" />;
  return (
    <TrophyRoomScreen room={room}>
      {mastery && <MasteryPanel view={mastery} onChanged={onBadgesChanged} notify={notify} />}
      {prestige && <PrestigePanel view={prestige} onChanged={onBadgesChanged} notify={notify} />}
      <Toast toast={toast} />
    </TrophyRoomScreen>
  );
}
