"use client";

/**
 * `/coleccion/trofeos/[setId]` — DETALLE DE LA COLECCIÓN DE UN EQUIPO: todas sus cartas, las que tienes y las que te
 * faltan. Solo lectura: no hay nada que reclamar, el estado es el de tu inventario.
 *
 * El parámetro es la clave del equipo (`g2`). Los enlaces antiguos a un set de F82 (`team-g2-v1`) llevan al mismo equipo.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { TeamDetailScreen } from "@/components/trophies/TeamDetailScreen";
import { fetchTeamCollection, teamCollectionsErrorText, type TeamDetailView } from "@/lib/teamCollections/client";
import { legacySetTeamId } from "@/domain/teamCollections/model";
import { trackCollections } from "@/lib/collectionSets/telemetry";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coleccion");

export default function TrophySetPage() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label={t("Cargando colección…")} />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what={t("tus colecciones")} />;
  return <TrophySetRoute />;
}

function TrophySetRoute() {
  useLocale();
  const params = useParams<{ setId: string }>();
  const teamId = legacySetTeamId(decodeURIComponent(String(params?.setId ?? "")));
  const [team, setTeam] = useState<TeamDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setTeam(await fetchTeamCollection(teamId)); trackCollections("collection_set_viewed"); } catch (e) { setError(teamCollectionsErrorText(e)); }
  }, [teamId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!team) return <Loading kind="hub" label={t("Cargando colección…")} />;
  return <TeamDetailScreen team={team} />;
}
