"use client";

/**
 * RESUMEN SOCIAL (Fase 29) — la tarjeta pequeña para `/cuenta`: amigos, en línea ahora, lo que
 * espera tu respuesta y la puerta al hub. Se alimenta sola de `GET /api/game/social`; si no hay
 * sesión o falla, no pinta nada. Cifras reales del snapshot, sin inventar.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { Badge } from "@/components/ui/Badge";
import { fetchSocial, type SocialSnapshot } from "@/lib/social/client";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("social");

export function SocialSummary({ enabled, className }: { enabled: boolean; className?: string }) {
  const [snap, setSnap] = useState<SocialSnapshot | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchSocial().then((s) => { if (alive) setSnap(s); }).catch(() => { /* la pantalla sigue */ });
    return () => { alive = false; };
  }, [enabled]);
  // F69 · /cuenta CLS: mismo hueco mientras llega la foto (antes null → empujaba la página al llegar).
  if (!snap) return enabled ? <SocialSummaryPending className={className} /> : null;
  return <SocialSummaryCard snap={snap} className={className} />;
}

function SocialSummaryPending({ className }: { className?: string }) {
  useLocale();
  return (
    <Plate className={`flex flex-wrap items-center justify-between gap-4 p-4 ${className ?? ""}`} aria-busy="true" data-social-summary="loading">
      <div className="flex flex-wrap items-end gap-5">
        <Readout size="sm" label={t("Amigos")} value="—" tone="var(--nx-cyan)" />
        <Readout size="sm" label={t("En línea")} value="—" tone="var(--nx-ok)" />
      </div>
      <Link href="/social" className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-drl-cyan/50 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan transition hover:bg-drl-cyan/10">
        {t("Social →")}
      </Link>
    </Plate>
  );
}

export function SocialSummaryCard({ snap, className }: { snap: SocialSnapshot; className?: string }) {
  useLocale();
  const online = snap.friends.filter((f) => f.presence === "ONLINE").length;
  const pending = snap.counts.incoming + snap.counts.challengesIn;
  return (
    <Plate className={`flex flex-wrap items-center justify-between gap-4 p-4 ${className ?? ""}`} data-social-summary={snap.counts.friends}>
      <div className="flex flex-wrap items-end gap-5">
        <Readout size="sm" label={t("Amigos")} value={snap.counts.friends} tone="var(--nx-cyan)" />
        <Readout size="sm" label={t("En línea")} value={online} tone="var(--nx-ok)" />
        {pending > 0 && <Badge tone="warn" dot>{pending} {pending === 1 ? t("pendiente") : t("pendientes")}</Badge>}
      </div>
      <Link href={pending > 0 ? "/social?tab=solicitudes" : "/social"} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-drl-cyan/50 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan transition hover:bg-drl-cyan/10">
        {t("Social →")}
      </Link>
    </Plate>
  );
}
