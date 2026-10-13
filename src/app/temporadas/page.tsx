"use client";

/** `/temporadas` — ARCHIVO (Fase 34): la temporada actual y las anteriores que existen en el calendario. */
import { useSeasonCalendar } from "@/lib/season/client";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, EmptyState } from "@/components/ui/States";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { SeasonArchive } from "@/components/season/SeasonArchive";

export default function TemporadasPage() {
  const { snap } = useSeasonCalendar();
  if (!isSupabaseConfigured()) return <EmptyState icon="🗓️" title="Archivo no disponible sin conexión" hint="Las temporadas se leen del servidor." action={{ href: "/", label: "Volver al inicio" }} />;
  if (!snap) return <Loading label="Leyendo las temporadas…" />;
  return (
    <div className="mx-auto max-w-3xl">
      <SectionTitle as="h1">Temporadas de NEXUS</SectionTitle>
      <SeasonArchive calendar={snap} />
    </div>
  );
}
