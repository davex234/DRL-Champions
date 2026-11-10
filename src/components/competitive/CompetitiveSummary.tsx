"use client";

/**
 * RESUMEN COMPETITIVO (Fase 28) — la tarjeta pequeña para el perfil (`/cuenta`) y el Meta Hub:
 * rating, posición (o «Sin clasificar»), récord, y el enlace al Competitive Hub. Se alimenta sola
 * de `GET /api/game/competitive?position=1` + rating; si no hay sesión o falla, no pinta nada.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { Badge } from "@/components/ui/Badge";
import { fetchCompetitive, type CompetitiveSnapshot } from "@/lib/competitive/client";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("competitive");

export function CompetitiveSummary({ enabled, className }: { enabled: boolean; className?: string }) {
  const [snap, setSnap] = useState<CompetitiveSnapshot | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchCompetitive(10).then((s) => { if (alive) setSnap(s); }).catch(() => { /* la pantalla sigue */ });
    return () => { alive = false; };
  }, [enabled]);
  // F69 · /cuenta CLS: mientras llega la foto se reserva el MISMO hueco (antes null → la tarjeta empujaba todo al llegar).
  if (!snap) return enabled ? <CompetitiveSummaryPending className={className} /> : null;
  return <CompetitiveSummaryCard self={snap.self} stats={snap.stats} className={className} />;
}

function CompetitiveSummaryPending({ className }: { className?: string }) {
  useLocale();
  return (
    <Plate className={`flex flex-wrap items-center justify-between gap-4 p-4 ${className ?? ""}`} aria-busy="true" data-competitive-summary="loading">
      <div className="flex flex-wrap items-end gap-5">
        <Readout size="sm" label={t("Rating ranked (Elo)")} value="—" tone="var(--nx-cyan)" />
        <Readout size="sm" label={t("Puesto ranked")} value="—" />
        <Readout size="sm" label={t("Récord")} value="—" tone="var(--nx-ok)" />
      </div>
      <Link href="/competitivo" className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-drl-cyan/50 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan transition hover:bg-drl-cyan/10">
        {t("Competitivo →")}
      </Link>
    </Plate>
  );
}

export function CompetitiveSummaryCard({ self, stats, className }: { self: CompetitiveSnapshot["self"]; stats: CompetitiveSnapshot["stats"]; className?: string }) {
  useLocale();
  const r = self.rating;
  return (
    <Plate className={`flex flex-wrap items-center justify-between gap-4 p-4 ${className ?? ""}`} data-competitive-summary={self.position ?? "unranked"}>
      <div className="flex flex-wrap items-end gap-5">
        {/* F69 · F68-013: rating Elo y puesto de la escalera ranked; nunca un rango con nombre (contrato F55). */}
        <Readout size="sm" label={t("Rating ranked (Elo)")} value={r.rating} tone="var(--nx-cyan)" />
        <Readout size="sm" label={t("Puesto ranked")} value={self.position !== null ? `#${self.position}` : t("Sin clasificar")} />
        <Readout size="sm" label={t("Récord")} value={`${stats.wins}–${stats.losses}${stats.draws > 0 ? `–${stats.draws}` : ""}`} tone="var(--nx-ok)" />
        {r.provisional && <Badge tone="warn" dot>{t("Provisional")} {r.gamesPlayed}/{self.placementGames}</Badge>}
      </div>
      <Link href="/competitivo" className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-drl-cyan/50 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan transition hover:bg-drl-cyan/10">
        {t("Competitivo →")}
      </Link>
    </Plate>
  );
}
