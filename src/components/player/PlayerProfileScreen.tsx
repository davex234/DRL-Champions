"use client";

/**
 * IA 2026-10-07 · LA PANTALLA del perfil de jugador como componente: la usan `/jugador/[id]` (perfil público y propio,
 * sin cambios) y MI CUENTA → PERFIL (`embedded`, con el id de la sesión). Mismo código, mismas lecturas y escrituras.
 *
 * `/jugador/[id]` — EL PERFIL DE JUGADOR (Fase 31). La ÚNICA ruta pública de identidad: Competitivo
 * (escalera, historial), Social (búsqueda, amigos) y el post-partida enlazan aquí, y la ruta antigua
 * `/duelos/competitivo/jugador/[id]` redirige. `/jugador/me` resuelve al perfil propio con la sesión.
 *
 * Se ve sin sesión (datos públicos); con sesión el servidor decide si la foto es SELF. Las acciones
 * sociales son las de la Fase 29 y se apagan solas si el social no está operativo (0048 sin aplicar).
 * Editar la vitrina, los logros y el avatar valida en servidor; `?editar=1` abre el editor.
 *
 * F89 PROFILE 2.0 · dos vistas explícitas (`ProfileOwnerView` / `PublicProfileView`) sobre el mismo layout; equipo
 * favorito (`?editar=equipo`); y la foto queda ATADA a (perfil pedido, cuenta que mira): al cambiar de cuenta o de
 * perfil, la foto anterior no se pinta ni un instante y una respuesta tardía de otra cuenta se descarta.
 *
 * PERFIL = IDENTIDAD · la página es UNA tarjeta (avatar, nombre, rango, equipo favorito, miembro desde) con EDITAR
 * PERFIL, CUENTA Y AJUSTES, SALA DE TROFEOS y CERRAR SESIÓN en el propio; acciones sociales F85 en el ajeno. Temporada,
 * campaña, estadísticas y vitrina ya no se pintan aquí (viven en sus pantallas; los datos no cambian).
 * CERRAR SESIÓN = el logout CANÓNICO (`useAuth().signOut`, el mismo de /cuenta): primero se suelta la foto propia (ni un
 * fotograma más), luego se cierra la sesión (CloudSync vacía la caché privada al confirmar «sin sesión», F81.2) y se va
 * a /cuenta (entrar o registrarse).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useGameStore } from "@/store/useGameStore";
import { useEconomyView } from "@/lib/game/serverEconomy";
import { useToast } from "@/lib/useToast";
import { Toast } from "@/components/ui/Toast";
import { Loading, ErrorState, EmptyState, NeedsAccount } from "@/components/ui/States";
import { fetchPlayerIdentity, saveShowcase, saveFeaturedAchievements, saveFeaturedBadges, saveFavoriteTeam, saveAvatar, PlayerError, type PlayerIdentitySnapshot } from "@/lib/player/client";
import { playerHref } from "@/lib/player/href";
import { trackProfile } from "@/lib/player/telemetry";
import { ProfileOwnerView, PublicProfileView } from "@/components/player/ProfileViews";
import { favoriteTeamOptions } from "@/domain/profile/favoriteTeam";
import { CARDS, getPlayer } from "@/data/catalog";
import { ShowcaseEditor, type EditorTab } from "@/components/player/ShowcaseEditor";
import { SocialActions } from "@/components/social/SocialActions";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("player");

export function PlayerProfileScreen({ id, embedded = false }: { id: string; embedded?: boolean }) {
  useLocale();
  const router = useRouter();
  const { user, loading, refreshProfile, signOut } = useAuth();
  const online = isSupabaseConfigured();
  // F81.2 · el editor de vitrina elige entre las cartas de ESTA cuenta: nunca las de la caché o la demo mientras carga.
  const ownedReady = useEconomyView() === "server";
  const storeOwned = useGameStore((s) => s.ownedCards);
  const owned = useMemo(() => (ownedReady ? storeOwned : []), [ownedReady, storeOwned]);
  const { toast, notify } = useToast(2600);
  // F89 · la foto lleva la clave (perfil, cuenta) con la que se pidió; solo se pinta si coincide con la actual.
  const viewKey = `${id}|${user?.id ?? "anon"}`;
  const keyRef = useRef(viewKey);
  keyRef.current = viewKey;
  const [loaded, setLoaded] = useState<{ key: string; snap: PlayerIdentitySnapshot } | null>(null);
  const snap = loaded?.key === viewKey ? loaded.snap : null;
  const teamOptions = useMemo(() => favoriteTeamOptions(CARDS, getPlayer), []);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [editor, setEditor] = useState<EditorTab | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // `/jugador/me` → el perfil propio, con la URL canónica por id (estable aunque cambie el nombre).
  useEffect(() => {
    // F82 · conserva `?editar=…` (la Sala de Trofeos abre el editor en la pestaña de insignias).
    if (id === "me" && !loading && user) router.replace(playerHref(user.id) + (typeof window !== "undefined" ? window.location.search : ""));
  }, [id, loading, user, router]);

  const load = useCallback(async () => {
    const key = keyRef.current;
    setError(null);
    try {
      const next = await fetchPlayerIdentity(id);
      if (keyRef.current === key) setLoaded({ key, snap: next }); // respuesta de otra cuenta/perfil: se descarta
    } catch (e) {
      if (keyRef.current === key) setError({ message: e instanceof Error ? e.message : t("No se pudo leer el perfil"), status: e instanceof PlayerError ? e.status : 500 });
    }
  }, [id]);
  useEffect(() => { if (online && !loading && id !== "me") void load(); }, [online, loading, user, id, load]);
  useEffect(() => { trackProfile("profile_view"); }, [id]);

  // `?editar=1` (desde la tarjeta de /cuenta) abre el editor cuando la foto propia ya está.
  useEffect(() => {
    const editar = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("editar") : null;
    if (snap?.view === "SELF" && (editar === "1" || editar === "insignias" || editar === "equipo")) {
      setEditor(editar === "insignias" ? "badges" : editar === "equipo" ? "team" : "cards");
      trackProfile("profile_edit");
    }
  }, [snap?.view]);

  const onSave = useCallback(async (fn: () => Promise<unknown>, ok: string, context: "showcase_edit" | "achievement_feature" | "profile_edit") => {
    if (busy) return;
    setBusy(true); setEditorError(null);
    try {
      await fn();
      trackProfile(context);
      notify(ok, true);
      await load();
      if (context === "profile_edit") refreshProfile();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("No se pudo guardar");
      setEditorError(msg);
      if (e instanceof PlayerError && e.code === "CONFLICT") { await load(); notify(msg, false); }
    } finally { setBusy(false); }
  }, [busy, notify, load, refreshProfile]);

  // CERRAR SESIÓN · el logout canónico. Se suelta la foto ANTES (nada de la cuenta saliente vuelve a pintarse), una sola
  // vez aunque se pulse dos veces, y se va a /cuenta. Si la red falla, supabase-js borra igualmente la sesión local.
  const [signingOut, setSigningOut] = useState(false);
  const signingRef = useRef(false);
  const onSignOut = useCallback(async () => {
    if (signingRef.current) return;
    signingRef.current = true;
    setSigningOut(true);
    setEditor(null);
    setLoaded(null);
    try { await signOut(); } catch { /* la sesión local se descarta igualmente */ }
    router.replace("/cuenta");
  }, [signOut, router]);

  if (!online) return <NeedsAccount what={t("Los perfiles de jugador")} />;
  if (loading) return <Loading kind="profile" label={t("Leyendo el perfil…")} />;
  if (id === "me") return user ? <Loading kind="profile" label={t("Abriendo tu perfil…")} /> : <NeedsAccount what={t("Tu perfil de jugador")} />;
  if (error?.status === 404 || error?.status === 400) {
    return <EmptyState icon="👤" title={t("Jugador no encontrado")} hint={t("Puede que el enlace sea incorrecto o que el perfil ya no esté disponible.")} action={{ href: "/social?tab=buscar", label: t("Buscar jugadores") }} />;
  }
  if (error && !snap) return <ErrorState message={td(error.message)} onRetry={() => void load()} />;
  if (!snap) return <Loading kind="profile" label={t("Leyendo el perfil…")} />;

  return (
    <div data-embedded={embedded ? "true" : undefined} data-testid="player-profile-screen">
      {snap.view === "SELF" ? (
        <ProfileOwnerView
          snap={snap}
          onEdit={(tab) => { setEditorError(null); setEditor(tab); trackProfile("profile_edit"); }}
          onSignOut={() => void onSignOut()}
          signingOut={signingOut}
        />
      ) : (
        <PublicProfileView
          snap={snap}
          social={user ? <SocialActions playerId={snap.player.userId} enabled={online && !!user} showH2H={false} /> : null}
        />
      )}
      {snap.self && (
        <ShowcaseEditor
          open={editor !== null}
          tab={editor ?? "cards"}
          onTab={setEditor}
          onClose={() => { if (!busy) setEditor(null); }}
          owned={owned}
          initialUids={snap.self.showcaseUids}
          claimed={snap.self.claimedAchievements}
          initialFeatured={snap.self.featuredIds}
          avatar={snap.player.avatar}
          busy={busy}
          error={td(editorError)}
          onSaveShowcase={(uids) => void onSave(() => saveShowcase(uids, snap.self!.version), t("Vitrina guardada"), "showcase_edit")}
          onSaveFeatured={(ids) => void onSave(() => saveFeaturedAchievements(ids, snap.self!.version), t("Logros destacados guardados"), "achievement_feature")}
          onSaveAvatar={(a) => void onSave(() => saveAvatar(a), t("Avatar actualizado"), "profile_edit")}
          badges={snap.self.ownedBadges}
          initialBadges={snap.self.featuredBadgeIds}
          onSaveBadges={(ids) => void onSave(() => saveFeaturedBadges(ids, snap.self!.version), t("Insignias destacadas guardadas"), "profile_edit")}
          teamOptions={teamOptions}
          initialTeam={snap.favoriteTeam?.id ?? null}
          onSaveTeam={(teamId) => void onSave(() => saveFavoriteTeam(teamId, snap.self!.version), teamId ? t("Equipo favorito guardado") : t("Equipo favorito quitado"), "profile_edit")}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
