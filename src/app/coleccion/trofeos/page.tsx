"use client";

/**
 * `/coleccion/trofeos` — COLECCIONES. Una colección por equipo (todas sus cartas), con TU progreso calculado en el
 * servidor, y las cuatro insignias regionales. Requiere cuenta: el progreso es de tu inventario real, nunca del caché
 * local.
 *
 * COLECCIONES POR EQUIPO (2026-10-13): los sets congelados de F82, su bloque de insignias, la Maestría (F13) y el
 * Prestigio (F14) dejan de pintarse aquí. Sus datos y sus rutas de servidor no se tocan.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { TrophyRoomScreen } from "@/components/trophies/TrophyRoomScreen";
import { fetchTeamCollections, teamCollectionsErrorText, type TeamCollectionsView } from "@/lib/teamCollections/client";
import { trackCollections } from "@/lib/collectionSets/telemetry";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coleccion");

export default function TrophyRoomPage() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label={t("Cargando tu Sala de Trofeos…")} />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what={t("la Sala de Trofeos")} />;
  return <TrophyRoomRoute />;
}

function TrophyRoomRoute() {
  useLocale();
  const [room, setRoom] = useState<TeamCollectionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setRoom(await fetchTeamCollections()); trackCollections("collection_viewed"); } catch (e) { setError(teamCollectionsErrorText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!room) return <Loading kind="hub" label={t("Cargando tu Sala de Trofeos…")} />;
  return <TrophyRoomScreen room={room} />;
}
