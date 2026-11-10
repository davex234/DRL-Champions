"use client";

/**
 * `/temporada/pase` — PASE DE BATALLA.
 *
 * IA 2026-10-07 · esta pantalla vivía en `/temporada`; ahora `/temporada` es el HUB de la sección (Pase de batalla ·
 * Objetivos · Crafteo) y el pase canónico se abre aquí.
 *
 * BATTLE PASS CLEANUP (2026-10-07) · solo lo necesario para USAR el pase: temporada → nivel + XP → track → reclamar.
 *
 *   · F83 RUTA DE TEMPORADA (si hay una temporada de la BD activa o en reclamo): su pantalla, en variante «pase» (cabecera
 *     + ruta con reclamos; los retos son Objetivos y viven allí). Reclamo: `claimSeasonReward` (servidor).
 *   · Si no (hoy: corre el pase de la Temporada 1, `nexus-s1`): `BattlePassScreen` sobre la vista CANÓNICA del pase
 *     (`fetchProgression`, la misma de `/logros`) y su reclamo real (`claimPassLevel`). Tras reclamar se RELEE el estado del
 *     servidor y se sincroniza el HUD: nada optimista.
 *
 * Fuera de esta pantalla (siguen en su sitio): objetivos, crafteo, ranked, eventos, colección, logros, calendario,
 * resumen y archivo (`SeasonHub` sigue sirviendo a `/temporadas/[slug]`). Nada se decide con el reloj del navegador.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { trackSeason } from "@/lib/season/telemetry";
import { claimSeasonReward, useSeasonTrack, SeasonError } from "@/lib/seasonTrack/client";
import { fetchProgression, claimPassLevel, type PassTrack, type ProgressionView } from "@/lib/progression/client";
import { syncFromServer } from "@/lib/game/sync";
import { useToast } from "@/lib/useToast";
import { Toast } from "@/components/ui/Toast";
import { Loading, ErrorState, EmptyState, NeedsAccount } from "@/components/ui/States";
import { SeasonTrackScreen, remaining } from "@/components/seasonTrack/SeasonTrackScreen";
import { BattlePassScreen } from "@/components/season/BattlePassScreen";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("temporada");

export default function BattlePassPage() {
  useLocale();
  const { loading, user } = useAuth();
  const online = isSupabaseConfigured();
  const track = useSeasonTrack(!loading && user ? user.id : null);
  const routeMode = !!track.data && (track.data.phase === "ACTIVE" || track.data.phase === "GRACE");
  const [claiming, setClaiming] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { trackSeason("season_hub_view"); }, []);

  const onClaim = useCallback(async (level: number) => {
    const s = track.data?.season;
    if (!s || claiming !== null) return;
    setClaiming(level); setNotice(null);
    try {
      const out = await claimSeasonReward(s.id, level);
      if (out.overview) track.setData(out.overview); else void track.reload();
      setNotice({ ok: true, text: out.outcome === "CLAIMED" ? tr("Recompensa del nivel {level} reclamada.", { level }) : tr("La recompensa del nivel {level} ya era tuya.", { level }) });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof SeasonError ? e.message : tr("No se pudo reclamar. Inténtalo de nuevo.") });
      void track.reload();
    } finally { setClaiming(null); }
  }, [track, claiming]);

  if (!online) return <EmptyState icon="🗓️" title={tr("Pase no disponible sin conexión")} hint={tr("El pase se lee del servidor.")} action={{ href: "/temporada", label: tr("Volver a Temporada") }} />;
  if (loading || (user && track.loading && !track.data)) return <Loading kind="hub" label={tr("Leyendo el pase…")} />;
  if (routeMode && track.data) return <SeasonTrackScreen data={track.data} onClaim={(l) => void onClaim(l)} claimingLevel={claiming} notice={notice} variant="pass" />;
  if (!user) return <NeedsAccount what={tr("tu pase de batalla")} />;

  const next = track.data?.phase === "SCHEDULED" ? track.data.season : null;
  return (
    <>
      {next && (
        <p className="nx-clip mx-auto mt-4 max-w-6xl border border-drl-cyan/40 bg-drl-cyan/[0.07] px-4 py-3 text-[13px] text-white/80" data-testid="season-next-banner">
          {fill(tr("{titulo} {nombre} empieza en {tiempo}.", { ...slots("titulo"), nombre: td(next.name), tiempo: remaining(Math.max(0, next.startsAt - (track.data?.serverNow ?? 0))) }), {
            titulo: <b className="font-display uppercase tracking-wide text-drl-cyan">{tr("Próxima temporada:")}</b>,
          })}
        </p>
      )}
      <LegacyPass />
    </>
  );
}

/** El pase de la temporada del calendario (`nexus-s1`): vista canónica + reclamo real por carril y nivel. */
function LegacyPass() {
  useLocale();
  const { toast, notify } = useToast();
  const [view, setView] = useState<ProgressionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setView(await fetchProgression()); } catch (e) { setError(e instanceof Error ? e.message : tr("No se pudo leer el pase")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** Reclamo SERVIDOR (idempotente por su clave del libro mayor) → relectura del estado real → HUD sincronizado. */
  const claim = useCallback(async (level: number, track: PassTrack) => {
    if (busy) return;
    setBusy(`${track}:${level}`);
    try {
      await claimPassLevel(level, track);
      notify(tr("Recompensa del nivel {level} reclamada", { level }), true);
    } catch (e) {
      notify(e instanceof Error ? e.message : tr("No se pudo reclamar"), false);
    } finally {
      await load();
      await syncFromServer().catch(() => undefined);
      setBusy(null);
    }
  }, [busy, load, notify]);

  if (error && !view) return <ErrorState message={td(error)} onRetry={load} />;
  if (!view) return <Loading kind="hub" label={tr("Leyendo el pase…")} />;
  return (
    <>
      <BattlePassScreen view={view} busyKey={busy} onClaim={(l, t) => void claim(l, t)} />
      <Toast toast={toast} />
    </>
  );
}
