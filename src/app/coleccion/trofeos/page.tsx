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
import { fetchTeamCollections, settleTeamCollections, teamCollectionsErrorText, type SettleView, type TeamCollectionsView } from "@/lib/teamCollections/client";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { ns, td } from "@/i18n/runtime";
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

/** Lo que se acaba de guardar, en una frase: «G2 completado · +300 XP de temporada · Insignia de EMEA desbloqueada». */
function settledText(r: SettleView): string | null {
  const parts: string[] = [];
  const first = r.teams.filter((x) => x.first);
  if (first.length === 1) parts.push(t("{equipo} completado", { equipo: first[0].title }));
  else if (first.length > 1) parts.push(t("{n} equipos completados", { n: first.length }));
  if (r.xpGained > 0) parts.push(t("+{xp} XP de temporada", { xp: r.xpGained }));
  for (const region of r.regions) parts.push(t("Insignia de {region} desbloqueada", { region: td(region) }));
  return parts.length ? parts.join(" · ") : null;
}

function TrophyRoomRoute() {
  useLocale();
  const [room, setRoom] = useState<TeamCollectionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El aviso de una recompensa dura más que un aviso corriente: en la primera carga la cortinilla de arranque lo tapaba entero.
  const { toast, notify } = useToast(6500);
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
          const text = settledText(r);
          if (text) notify(text);
        } catch { /* la lectura ya está pintada */ } finally { settling.current = false; }
      }
    } catch (e) { setError(teamCollectionsErrorText(e)); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!room) return <Loading kind="hub" label={t("Cargando tus colecciones…")} />;
  return <><TrophyRoomScreen room={room} /><Toast toast={toast} /></>;
}
