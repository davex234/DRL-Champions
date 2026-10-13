"use client";

/**
 * INSIGNIA REGIONAL. El mismo escudo de la casa (chaflán, borde y halo del acento) con un emblema propio de la región:
 * una silueta geométrica, no la marca de ninguna liga. Se desbloquea con TODAS las cartas de TODOS los equipos de la
 * región; lo decide el servidor, aquí solo se pinta.
 *
 * Bloqueada = borde apagado + emblema atenuado + candado + la palabra «Bloqueada» (no se depende solo del color).
 */
import { Meter } from "@/components/ui/Meter";
import { cn } from "@/lib/format";
import type { RegionBadgeView } from "@/domain/teamCollections/model";
import { REGION_TINT } from "./teamCollectionsModel";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("trophies");

const SHIELD = "polygon(50% 0, 100% 14%, 100% 64%, 50% 100%, 0 64%, 0 14%)";

/** Siluetas en una caja de 48 × 48. */
const EMBLEM: Record<string, string[]> = {
  Americas: [
    "M6 9 13 6 22 5 30 7 27 12 29 16 24 20 21 19 19 23 22 27 20 28 15 24 11 18 7 14Z",
    "M22 28 28 27 34 31 35 37 31 41 28 46 26 46 25 39 22 34Z",
    "M31 4 37 4 35 9 32 9Z",
  ],
  EMEA: [
    "M17 8 21 5 27 6 33 5 34 10 30 13 26 12 23 15 18 14 15 11Z",
    "M15 18 22 17 28 18 31 23 35 25 32 30 29 37 26 43 23 43 21 36 21 30 15 26 13 22Z",
    "M30 15 36 14 40 19 37 23 33 21Z",
  ],
  Pacific: [
    "M8 8 18 6 22 10 19 14 21 20 17 24 14 19 9 15Z",
    "M27 6 30 5 31 11 27 16 25 15 28 10Z",
    "M24 20 26 20 27 25 25 26Z",
    "M12 28 20 29 20 31 13 31Z",
    "M23 29 30 30 29 32 23 31Z",
    "M24 36 30 33 37 34 40 39 36 44 30 43 25 42Z",
    "M42 42 44 41 44 45 42 46Z",
  ],
  China: [
    "M5 19 11 14 17 16 22 13 28 14 33 9 39 6 43 10 39 14 41 18 36 21 39 27 36 33 31 38 26 39 22 36 17 36 13 31 8 29 4 24Z",
    "M27 41 30 41 29 44Z",
    "M40 31 42 30 42 34Z",
  ],
};

export function RegionEmblem({ region, size, color }: { region: string; size: number; color: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" width={size} height={size} className="relative">
      <circle cx="24" cy="24" r="22.5" fill="none" stroke={color} strokeOpacity="0.28" strokeWidth="1" />
      <path d="M1.5 24h45M24 1.5c-9 6-9 39 0 45M24 1.5c9 6 9 39 0 45" fill="none" stroke={color} strokeOpacity="0.16" strokeWidth="1" />
      {(EMBLEM[region] ?? []).map((d) => <path key={d} d={d} fill={color} stroke={color} strokeWidth="0.8" strokeLinejoin="round" />)}
    </svg>
  );
}

export function RegionBadge({ badge }: { badge: RegionBadgeView }) {
  useLocale();
  const color = REGION_TINT[badge.region] ?? "#ffce4f";
  const locked = !badge.unlocked;
  const px = 84;
  const status = badge.unlocked ? t("Desbloqueada") : t("Bloqueada");
  return (
    <li data-testid="region-badge" data-region={badge.region} data-unlocked={badge.unlocked ? "1" : "0"} data-configured={badge.configured ? "1" : "0"}
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
        {badge.configured ? (
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
