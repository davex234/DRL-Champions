"use client";

/**
 * INSIGNIA REGIONAL. El mismo escudo de la casa (chaflán, borde y halo del acento) con un emblema propio de la región:
 * una silueta geométrica, no la marca de ninguna liga. Se desbloquea con TODAS las cartas de TODOS los equipos de la
 * región; lo decide el servidor, aquí solo se pinta. Una vez desbloqueada queda guardada: el progreso de debajo puede
 * bajar si después se desguazan cartas, la insignia no.
 *
 * Bloqueada = borde apagado + emblema atenuado + candado + la palabra «Bloqueada» (no se depende solo del color).
 */
import { Meter } from "@/components/ui/Meter";
import { cn } from "@/lib/format";
import type { RegionBadgeView } from "@/domain/teamCollections/model";
import { REGION_TINT } from "./teamCollectionsModel";
import { RegionEmblem } from "./RegionEmblem";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("trophies");

const SHIELD = "polygon(50% 0, 100% 14%, 100% 64%, 50% 100%, 0 64%, 0 14%)";

export function RegionBadge({ badge }: { badge: RegionBadgeView }) {
  useLocale();
  const color = REGION_TINT[badge.region] ?? "#ffce4f";
  const since = badge.unlockedAt ? new Date(badge.unlockedAt).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short", year: "numeric" }) : null;
  const locked = !badge.unlocked;
  const px = 84;
  const status = badge.unlocked ? t("Desbloqueada") : t("Bloqueada");
  return (
    <li data-testid="region-badge" data-region={badge.region} data-unlocked={badge.unlocked ? "1" : "0"} data-configured={badge.configured ? "1" : "0"} data-permanent={badge.permanent ? "1" : "0"}
      aria-label={t("Insignia de {region}: {estado}. {owned} de {total} cartas.", { region: td(badge.region), estado: status, owned: badge.owned, total: badge.total })}
      className={cn("nx-clip relative flex min-w-0 flex-col items-center gap-3 p-4 text-center",
        "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]")}
      style={badge.unlocked ? { boxShadow: `inset 0 0 0 1px ${color}99`, background: `linear-gradient(180deg, ${color}14, rgba(255,255,255,0.03) 60%)` } : undefined}>
      <div className="relative grid place-items-center" style={{ width: px, height: px * 1.12 }}>
        {!locked && <div aria-hidden className="absolute -inset-[18%]" style={{ background: `radial-gradient(50% 50% at 50% 50%, ${color}55, transparent 70%)` }} />}
        <div aria-hidden className="absolute inset-0" style={{ clipPath: SHIELD, background: locked ? "rgba(255,255,255,0.18)" : `linear-gradient(160deg, ${color}, rgba(255,255,255,0.25) 45%, ${color}aa)` }} />
        <div aria-hidden className="absolute" style={{ inset: 3, clipPath: SHIELD, background: "radial-gradient(70% 60% at 50% 35%, rgba(255,255,255,0.10), rgba(7,8,14,0.96) 70%)" }} />
        <span className="relative -mt-2" style={{ opacity: locked ? 0.5 : 1 }}><RegionEmblem region={badge.region} size={Math.round(px * 0.6)} color={locked ? "#c9d1e0" : color} /></span>
        {locked && <span aria-hidden className="absolute -bottom-0.5 -right-1 grid h-[22px] w-[22px] place-items-center rounded-full bg-black/85 text-[11px] text-white/80 ring-1 ring-white/25">🔒</span>}
      </div>
      <div className="w-full min-w-0">
        <h3 className="truncate font-display text-[18px] font-black uppercase tracking-wide text-white">{td(badge.region)}</h3>
        <p className={cn("text-[11px] font-bold uppercase tracking-[0.18em]", badge.unlocked ? "text-emerald-300" : "text-white/55")} data-testid="region-status">{status}</p>
        {since && <p className="text-[11px] text-white/55" data-testid="region-since">{t("Tuya desde el {fecha}", { fecha: since })}</p>}
        {badge.configured || badge.permanent ? (
          <>
            <div className="mt-2 flex items-center gap-2">
              <Meter value={badge.pct} tone={badge.unlocked ? "ok" : "info"} height={6} label={t("Progreso de {title}", { title: td(badge.region) })} className="flex-1" />
              <span className="nx-readout shrink-0 text-[13px] font-bold text-white" data-testid="region-progress">{badge.owned}/{badge.total}</span>
            </div>
            <p className="mt-1 text-[12px] text-white/60">
              {t("{n, plural, one {# carta} other {# cartas}}", { n: badge.total })} · {t("{done}/{teams} equipos completos", { done: badge.teamsCompleted, teams: badge.teams })}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[12px] text-white/55" data-testid="region-empty">{t("Todavía no hay equipos de esta región en el catálogo.")}</p>
        )}
      </div>
    </li>
  );
}
