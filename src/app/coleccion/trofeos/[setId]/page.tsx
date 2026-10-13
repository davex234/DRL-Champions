"use client";

/**
 * F82 · `/coleccion/trofeos/[setId]` — DETALLE DE UNA COLECCIÓN: requisitos, lo que tienes, lo que falta, la insignia y
 * RECLAMAR INSIGNIA (solo si el servidor dice que la cumples y no la has reclamado). Tras reclamar, el momento de
 * colección completada; desde él se puede destacar la insignia en el perfil (hasta 3; si ya hay 3, te lleva al editor).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { SetDetailScreen } from "@/components/trophies/SetDetailScreen";
import { CompletionMoment, type CompletionMomentData } from "@/components/trophies/CompletionMoment";
import { claimCollectionSet, fetchTrophyRoom, trophyErrorText, type TrophyRoomView } from "@/lib/collectionSets/client";
import { saveFeaturedBadges } from "@/lib/player/client";
import { trackCollections } from "@/lib/collectionSets/telemetry";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coleccion");

export default function TrophySetPage() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label={t("Cargando colección…")} />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what={t("la Sala de Trofeos")} />;
  return <TrophySetRoute />;
}

function TrophySetRoute() {
  useLocale();
  const params = useParams<{ setId: string }>();
  const setId = decodeURIComponent(String(params?.setId ?? ""));
  const router = useRouter();
  const [room, setRoom] = useState<TrophyRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [equipping, setEquipping] = useState(false);
  const [moment, setMoment] = useState<CompletionMomentData | null>(null);
  const busy = useRef(false); // doble clic: una sola petición en vuelo (el servidor es idempotente igualmente)

  const load = useCallback(async () => {
    setError(null);
    try { setRoom(await fetchTrophyRoom()); trackCollections("collection_set_viewed"); } catch (e) { setError(trophyErrorText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const set = room?.sets.find((s) => s.id === setId) ?? null;

  const claim = useCallback(async () => {
    if (busy.current || !set) return;
    busy.current = true; setClaiming(true); setClaimError(null);
    try {
      const r = await claimCollectionSet(set.id);
      setMoment({ title: set.title, kind: set.kind, badge: r.badge ?? set.badge, already: r.outcome === "ALREADY" });
      if (r.outcome === "COMPLETED") { trackCollections("collection_completed"); trackCollections("badge_unlocked"); }
      setRoom(await fetchTrophyRoom());
    } catch (e) {
      setClaimError(trophyErrorText(e, t("No se pudo reclamar la insignia. Inténtalo de nuevo.")));
      void load();
    } finally { busy.current = false; setClaiming(false); }
  }, [set, load]);

  const equip = useCallback(async () => {
    const badgeId = moment?.badge?.id;
    if (!badgeId || !room) return;
    const current = room.featuredBadgeIds.filter((b) => b !== badgeId);
    if (current.length >= 3) { router.push("/jugador/me?editar=insignias"); return; }
    setEquipping(true);
    try {
      await saveFeaturedBadges([badgeId, ...current], room.profileVersion);
      trackCollections("badge_equipped");
      setMoment(null);
      setRoom(await fetchTrophyRoom());
    } catch {
      router.push("/jugador/me?editar=insignias");
    } finally { setEquipping(false); }
  }, [moment, room, router]);

  if (error) return <ErrorState message={td(error)} onRetry={load} />;
  if (!room) return <Loading kind="hub" label={t("Cargando colección…")} />;
  if (!set) return <ErrorState message={t("Esa colección no existe o ya no está disponible.")} />;
  const alreadyFeatured = !!moment?.badge && room.featuredBadgeIds.includes(moment.badge.id);
  return (
    <>
      <SetDetailScreen set={set} onClaim={claim} claiming={claiming} error={td(claimError)} />
      <CompletionMoment data={moment} onClose={() => setMoment(null)} onEquip={moment?.badge && !alreadyFeatured ? equip : undefined} equipping={equipping} />
    </>
  );
}
