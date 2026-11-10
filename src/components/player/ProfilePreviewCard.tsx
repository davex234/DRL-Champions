"use client";

/**
 * TU PERFIL — la tarjeta de `/cuenta` (Fase 31). Cuenta es configuración; el perfil es la identidad
 * pública. Aquí solo se enseña cómo te ven (avatar, nombre, nivel, vitrina en miniatura) y se ofrece
 * ir a verlo o a editarlo. Se alimenta sola de `GET /api/game/player?me=1`; si falla, no pinta nada.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getCard } from "@/data/catalog";
import { CardThumb } from "@/components/cards/CardThumb";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { fetchMyIdentity } from "@/lib/player/client";
import { playerHref } from "@/lib/player/href";
import type { PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { PlayerAvatar } from "./bits";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("player");

export function ProfilePreviewCard({ enabled, className }: { enabled: boolean; className?: string }) {
  const [snap, setSnap] = useState<PlayerIdentitySnapshot | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchMyIdentity().then((s) => { if (alive) setSnap(s); }).catch(() => { /* la cuenta sigue */ });
    return () => { alive = false; };
  }, [enabled]);
  // F69 · /cuenta CLS: el hueco se reserva mientras llega la identidad (antes null → la tarjeta empujaba la página).
  if (!snap) return enabled ? <ProfilePreviewPending className={className} /> : null;
  return <ProfilePreviewCardView snap={snap} className={className} />;
}

function ProfilePreviewPending({ className }: { className?: string }) {
  useLocale();
  return (
    <Plate className={`flex flex-wrap items-center justify-between gap-4 p-4 ${className ?? ""}`} aria-busy="true" data-testid="profile-preview-loading">
      <div className="flex min-w-0 items-center gap-4">
        <span aria-hidden className="block h-14 w-14 shrink-0 bg-white/[0.05]" />
        <div className="min-w-0">
          <span className="nx-label">{t("Tu perfil")}</span>
          <p className="font-display text-[18px] font-bold uppercase text-white/30">—</p>
          <span aria-hidden className="block h-5" />
        </div>
      </div>
      <span aria-hidden className="block min-h-[44px] w-40" />
    </Plate>
  );
}

export function ProfilePreviewCardView({ snap, className }: { snap: PlayerIdentitySnapshot; className?: string }) {
  useLocale();
  const href = playerHref(snap.player.userId);
  return (
    <Plate className={`flex flex-wrap items-center justify-between gap-4 p-4 ${className ?? ""}`} data-testid="profile-preview" data-showcase={snap.showcase.length}>
      <div className="flex min-w-0 items-center gap-4">
        <PlayerAvatar avatar={snap.player.avatar} username={snap.player.username} frame={snap.player.frame} size="md" />
        <div className="min-w-0">
          <span className="nx-label">{t("Tu perfil")}</span>
          <p className="truncate font-display text-[18px] font-bold uppercase text-white">{snap.player.username}</p>
          <Badge tone="info">{t("Nivel")} {snap.player.level}</Badge>
        </div>
        <div className="hidden items-end gap-1.5 sm:flex" aria-label={t("Tu vitrina")}>
          {snap.showcase.length === 0
            ? <span className="text-[11px] text-white/40">{t("Vitrina vacía")}</span>
            : snap.showcase.map((s) => { const def = getCard(s.cardId); return def ? <CardThumb key={s.uid} card={def} width={s.slot === 1 ? 44 : 36} /> : null; })}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={href} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-drl-cyan/50 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan transition hover:bg-drl-cyan/10">{t("Ver perfil")}</Link>
        <Link href={`${href}?editar=1`} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-white/15 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/75 transition hover:bg-white/[0.08]">{t("Editar")}</Link>
      </div>
    </Plate>
  );
}
