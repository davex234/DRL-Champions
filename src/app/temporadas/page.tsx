"use client";

/** `/temporadas` — ARCHIVO (Fase 34): la temporada actual y las anteriores que existen en el calendario. */
import { useSeasonCalendar } from "@/lib/season/client";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, EmptyState } from "@/components/ui/States";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { SeasonArchive } from "@/components/season/SeasonArchive";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("temporadas");

export default function TemporadasPage() {
  useLocale();
  const { snap } = useSeasonCalendar();
  if (!isSupabaseConfigured()) return <EmptyState icon="🗓️" title={t("Archivo no disponible sin conexión")} hint={t("Las temporadas se leen del servidor.")} action={{ href: "/", label: t("Volver al inicio") }} />;
  if (!snap) return <Loading label={t("Leyendo las temporadas…")} />;
  return (
    <div className="mx-auto max-w-3xl">
      <SectionTitle as="h1">{t("Temporadas de NEXUS")}</SectionTitle>
      <SeasonArchive calendar={snap} />
    </div>
  );
}
