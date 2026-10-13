"use client";

/**
 * F83 · ACCESO DE TEMPORADA EN LA PORTADA: nivel, XP y el próximo reto sin completar. Pequeño (no es un panel). Solo
 * aparece con una temporada ACTIVA o en periodo de reclamo; sin sesión, sin temporada o mientras carga, no pinta nada
 * (nunca un nivel falso ni el de otra cuenta).
 */
import Link from "next/link";
import { Meter } from "@/components/ui/Meter";
import { useAuth } from "@/lib/supabase/auth";
import { useSeasonTrack } from "@/lib/seasonTrack/client";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("seasonTrack");

export function SeasonDock({ className }: { className?: string }) {
  useLocale();
  const { user } = useAuth();
  const { data } = useSeasonTrack(user?.id ?? null);
  if (!data || !data.season || !data.progress || (data.phase !== "ACTIVE" && data.phase !== "GRACE")) return null;
  const p = data.progress;
  const next = [...(data.daily?.challenges ?? []), ...(data.weekly?.challenges ?? [])].find((c) => !c.completed) ?? null;
  return (
    <Link href="/temporada/pase" data-testid="season-dock" data-level={p.level}
      className={`nx-focus nx-clip-sm mt-3 block w-full max-w-[320px] border border-drl-gold/30 bg-black/35 px-3 py-2.5 transition hover:border-drl-gold/60 ${className ?? ""}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-drl-gold">{t("Temporada · nivel")} {p.level}</span>
        {data.claimable.length > 0 && <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-white">{data.claimable.length} {t("por reclamar")}</span>}
      </span>
      <Meter value={Math.round(p.progress * 100)} tone="gold" height={4} label={t("Nivel de temporada {level}", { level: p.level })} className="mt-1.5" />
      {next && <span className="mt-1.5 block truncate text-[11px] text-white/60">{td(next.label)} · {next.progress}/{next.target}</span>}
    </Link>
  );
}
