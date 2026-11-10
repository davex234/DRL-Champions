"use client";

/**
 * `/coleccion/trofeos` — COLECCIONES. Una colección por equipo (todas sus cartas), con TU progreso calculado en el
 * servidor, y las cuatro insignias regionales. Requiere cuenta: el progreso es de tu inventario real, nunca del caché
 * local. Al entrar, si ya cumples algo que aún no consta (un equipo completo por primera vez, una región), se le pide
 * al servidor que lo guarde: 300 XP de temporada por equipo, una vez, e insignia regional permanente.
 *
 * COLECCIONES POR EQUIPO (2026-10-13): los sets congelados de F82, su bloque de insignias, la Maestría (F13) y el
 * Prestigio (F14) dejan de pintarse aquí. Sus datos y sus rutas de servidor no se tocan.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { TrophyRoomScreen } from "@/components/trophies/TrophyRoomScreen";
import { fetchTeamCollections, settleTeamCollections, teamCollectionsErrorText, type TeamCollectionsView } from "@/lib/teamCollections/client";
import { summarizeSettle, useCollectionRewardStore } from "@/lib/teamCollections/rewardNotice";
import { ns } from "@/i18n/runtime";
import { trackCollections } from "@/lib/collectionSets/telemetry";
import { useLocale } from "@/i18n/react";

const t = ns("coleccion");

export default function TrophyRoomPage() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label={t("Cargando tus colecciones…")} />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what={t("tus colecciones")} />;
  return <TrophyRoomRoute />;
}

function TrophyRoomRoute() {
  useLocale();
  const [room, setRoom] = useState<TeamCollectionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settling = useRef(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      const view = await fetchTeamCollections();
      setRoom(view);
      trackCollections("collection_viewed");
      /*
       * El servidor dice que hay algo que guardar (un equipo completado por primera vez, sus XP o una insignia
       * regional). Se le pide que lo haga: él vuelve a comprobarlo todo, así que esto no decide nada. Una sola
       * petición en vuelo; si falla, la pantalla sigue como estaba y se reintenta en la próxima visita.
       */
      if (view.pending && !settling.current) {
        settling.current = true;
        try {
          const r = await settleTeamCollections();
          setRoom(r.view);
          // El aviso lo enseña el armazón (CollectionRewardNotice), el mismo que avisa de lo guardado en segundo plano.
          const gained = summarizeSettle(r);
          if (gained) useCollectionRewardStore.getState().push(gained);
        } catch { /* la lectura ya está pintada */ } finally { settling.current = false; }
      }
    } catch (e) { setError(teamCollectionsErrorText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!room) return <Loading kind="hub" label={t("Cargando tus colecciones…")} />;
  return <TrophyRoomScreen room={room} />;
}
