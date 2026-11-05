"use client";

/**
 * ROAD TO CHAMPIONS EN EL PERFIL PROPIO (Fase 35). Solo se monta en la vista SELF: el perfil público NO enseña
 * el progreso de campaña de nadie (ni lo pide: el servidor solo sirve la foto del token).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { fetchCampaign, type CampaignSnapshot } from "@/lib/campaign/client";
import { CAMPAIGN_ROUTE } from "@/lib/campaign/presentation";

export function CampaignProfileBadgeView({ snapshot, className }: { snapshot: CampaignSnapshot | null; className?: string }) {
  if (!snapshot) return null;
  return (
    <Link
      href={CAMPAIGN_ROUTE}
      data-testid="campaign-profile"
      className={cn("nx-focus nx-clip-sm flex min-h-[44px] items-center justify-between gap-3 border border-drl-cyan/25 bg-white/[0.03] px-4 py-3 transition hover:border-drl-cyan/50", className)}
    >
      <span className="min-w-0">
        <span className="nx-label block text-drl-cyan">Road to Champions</span>
        {snapshot.available ? (
          <span className="block font-display text-[15px] font-bold uppercase text-white">
            {snapshot.summary.completed}/{snapshot.summary.total} nodos · capítulos {snapshot.summary.chaptersComplete}/{snapshot.summary.chaptersTotal}
          </span>
        ) : (
          <span className="block text-caption text-ink-muted">Todavía no disponible</span>
        )}
      </span>
      <span aria-hidden className="text-white/50">›</span>
    </Link>
  );
}

export function CampaignProfileBadge({ className }: { className?: string }) {
  const [snap, setSnap] = useState<CampaignSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    fetchCampaign().then((s) => { if (alive) setSnap(s); }).catch(() => { if (alive) setSnap(null); });
    return () => { alive = false; };
  }, []);
  return <CampaignProfileBadgeView snapshot={snap} className={className} />;
}
