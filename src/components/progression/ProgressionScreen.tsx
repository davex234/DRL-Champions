"use client";

/**
 * PROGRESO — Mi cuenta → Progresión (Fase 22.1 → 27 → FASE 62 → IA 2026-10-07).
 *
 * FASE 62 · EL HUB CENTRAL DE PROGRESO. La auditoría encontró la progresión repartida en siete pantallas (progresión,
 * temporada, logros, recompensas, perfil, ranking, competitivo) y una consecuencia medible: una cuenta que juega a menudo
 * (QA 1ff2c0ef, 14 duelos) seguía en NIVEL 0 DE TEMPORADA con 4 objetivos completos sin recoger, porque la XP de
 * temporada solo sube al RECLAMAR y el reclamo solo existía en `/logros`. Ahora esta pantalla contesta todo y deja
 * reclamar aquí mismo, con los MISMOS reclamos del servidor (`POST /api/game/progression`, idempotentes por clave).
 *
 * Una sola lectura (`GET /api/game/meta`, cero escrituras). El nivel de cuenta sigue saliendo de `levelFromXp` sobre la
 * XP del servidor; sin cuenta, el nivel local del store y la guía de cómo ganar XP (derivada del código).
 *
 * IA 2026-10-07 · la pantalla se MUDA a Mi cuenta → Progresión (`/cuenta?seccion=progresion`); `/progresion` redirige
 * allí. Es el MISMO código (antes en `app/progresion/page.tsx`), ahora como componente; reclamos y lecturas sin cambios.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { levelFromXp } from "@/domain/progression/levels";
import { xpSources } from "@/domain/progression/xpSources";
import { accountLevel } from "@/domain/progression/meta";
import { fetchMetaSnapshot, type MetaSnapshot } from "@/lib/progression/meta";
import { trackMeta } from "@/lib/progression/telemetry";
import { LevelHero } from "@/components/progression/LevelHero";
import { ProgressionHub } from "@/components/progression/hub/ProgressionHub";
import { Plate } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { OnboardingProgressCoach } from "@/components/onboarding/OnboardingProgress";
import { useOnboarding } from "@/lib/onboarding/client";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("progression");

export function ProgressionScreen({ embedded = false }: { embedded?: boolean }) {
  useLocale();
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();
  // La XP del store viene del servidor (`applyServerState`); es la misma que pinta la cabecera.
  const xp = useGameStore((s) => s.xp);
  const info = useMemo(() => levelFromXp(xp), [xp]);
  const level = useMemo(() => accountLevel(xp), [xp]);
  const sources = useMemo(() => xpSources(), []);

  const [snap, setSnap] = useState<MetaSnapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await fetchMetaSnapshot();
      setSnap(s);
      setReceivedAt(Date.now());
    } catch (e) { setError(e instanceof Error ? e.message : t("No se pudo leer tu progresión")); }
  }, []);

  useEffect(() => { if (online && user) void load(); }, [online, user, load]);
  useEffect(() => { trackMeta("progression_view"); }, []);
  /* F63 · paso 6 de la guía: explica este hub y cierra el inicio (solo si la guía está en ese paso). */
  const onboarding = useOnboarding(user?.id ?? null, online);

  return (
    <div className={embedded ? "w-full" : "mx-auto w-full max-w-6xl px-4 py-6 md:py-8"} data-scene="progression-hub">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="font-display text-label uppercase tracking-wide2 text-drl">{t("Progreso")}</span>
          <h1 className="mt-1 font-display text-[clamp(28px,4vw,44px)] font-extrabold uppercase leading-none tracking-wide text-white">{t("Tu progreso")}</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-muted">
            {t("Nivel")} {info.level}{t(". Qué estás progresando, qué puedes recoger ya, qué hacer hoy y qué te falta para la siguiente recompensa.")}
          </p>
        </div>
        <span className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/logros" className="nx-action">{t("Logros y pase completos →")}</Link>
          {/* IA 2026-10-07 · el historial de recompensas sale del menú: se consulta desde lo conseguido. */}
          <Link href="/recompensas" className="nx-action" data-testid="progress-rewards-history">{t("Historial de recompensas →")}</Link>
        </span>
      </header>

      {onboarding.view && <OnboardingProgressCoach view={onboarding.view} />}

      {loading ? (
        <Loading kind="hub" label={t("Leyendo tu progresión…")} />
      ) : !online || !user ? (
        <>
          <LevelHero level={level} className="mb-6" />
          <NeedsAccount what={t("tus objetivos, la temporada y las recompensas")} />
        </>
      ) : error && !snap ? (
        <ErrorState message={td(error)} onRetry={load} />
      ) : !snap ? (
        <Loading kind="hub" label={t("Leyendo tu progresión…")} />
      ) : (
        <ProgressionHub snap={snap} receivedAt={receivedAt} reload={load} />
      )}

      {/* ── CÓMO GANAR XP (derivado del código, no escrito a mano) ── */}
      <section className="mt-10">
        <SectionTitle>{t("Cómo se progresa")}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {sources.map((s) => (
            <Plate key={s.id} className="flex items-start gap-3 p-4">
              <GameGlyph symbol={s.icon} className="mt-0.5 h-7 w-7 text-drl-cyan" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="font-display text-base font-bold text-white">{td(s.label)}</h3>
                  <span className="nx-readout text-caption text-drl-gold">{td(s.amount)}</span>
                </div>
                <p className="mt-1 text-caption leading-relaxed text-ink-muted">{td(s.hint)}</p>
              </div>
            </Plate>
          ))}
        </div>
      </section>
    </div>
  );
}
