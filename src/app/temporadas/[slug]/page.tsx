"use client";

/** `/temporadas/[slug]` — UNA temporada del archivo (Fase 34): estado, calendario y, si terminó, tu resumen. */
import { use, useState, useEffect } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useSeasonHub } from "@/lib/season/client";
import { SEASON_KEY } from "@/domain/season/calendar";
import { Loading, ErrorState, EmptyState } from "@/components/ui/States";
import { SeasonHub } from "@/components/season/SeasonHub";

export default function SeasonArchivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const valid = SEASON_KEY.test(slug);
  const { loading } = useAuth();
  const { snap, clock, error, loading: fetching, refresh } = useSeasonHub(slug, valid && !loading);
  const [clientNow, setClientNow] = useState<number | undefined>(undefined);
  useEffect(() => { const id = window.setInterval(() => setClientNow(Date.now()), 60_000); return () => window.clearInterval(id); }, []);

  if (!isSupabaseConfigured()) return <EmptyState icon="🗓️" title="Temporada no disponible sin conexión" hint="Las temporadas se leen del servidor." action={{ href: "/", label: "Volver al inicio" }} />;
  if (!valid || error?.status === 404 || error?.status === 400) {
    return <EmptyState icon="🗓️" title="Temporada no encontrada" hint="Esa temporada no existe en el calendario de NEXUS." action={{ href: "/temporadas", label: "Ver el archivo" }} />;
  }
  if (loading || (fetching && !snap)) return <Loading label="Leyendo la temporada…" />;
  if (error && !snap) return <ErrorState message="No se pudo leer la temporada" onRetry={() => void refresh()} />;
  if (!snap) return <Loading label="Leyendo la temporada…" />;
  return <SeasonHub snap={snap} clock={clock} onRefresh={() => void refresh()} clientNow={clientNow} />;
}
