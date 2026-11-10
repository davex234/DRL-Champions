"use client";

/**
 * INSIGNIA DE RANGO — el rango como OBJETO (Fase 9.6).
 *
 * Existe para que las pantallas que muestran el rango (inicio, Pick'ems, clasificación y
 * perfil) usen exactamente la misma representación en vez de repetir la barra de progreso
 * con matices distintos.
 *
 * El diseño es propio: escalera de `domain/progression/rank.ts`, con nuestra
 * nomenclatura, nuestros colores y nuestros emblemas (`RankEmblem`). No reproduce ningún
 * emblema de Riot.
 *
 * Fase 9D — divisiones, doble posición y campeón.
 *
 * Fase 9.6 — la pieza deja de ser una fila de datos y pasa a ser una PLACA:
 *
 *   · **Emblema, no número.** Antes el rango era un recuadro con la cifra del escalón
 *     dentro. Ahora es `RankEmblem`, que se reconoce a distancia y crece con el rango.
 *   · **El siguiente rango se ve.** No basta con escribir «faltan 260 para Diamante»: el
 *     emblema de Diamante aparece al final de la barra, apagado. Lo que se persigue tiene
 *     que estar a la vista, o no se persigue.
 *   · **Sin clasificar tiene su propio estado.** Contorno hueco y una frase que dice qué
 *     hacer, no un rango de mentira.
 */
import Link from "next/link";
import {
  rankProgress, rankDisplay, REGION_LABEL, CHAMPION_COLOR, type RankRegion,
} from "@/domain/progression/rank";
import { RankEmblem } from "./RankEmblem";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("progression");

export function RankBadge({
  points,
  position,
  regionPosition,
  region,
  action,
  compact,
  className,
}: {
  points: number;
  /** Puesto en la clasificación global, si se conoce. */
  position?: number | null;
  /** Puesto dentro de su región, si la ha declarado. */
  regionPosition?: number | null;
  region?: RankRegion | null;
  action?: { href: string; label: string };
  /** Versión reducida para tarjetas pequeñas. */
  compact?: boolean;
  className?: string;
}) {
  useLocale();
  const r = rankProgress(points);
  const display = rankDisplay(points, position ?? null);
  const pct = Math.round(r.progress * 100);
  const color = display.color;

  return (
    <div
      className={cn(
        "nx-clip relative flex flex-wrap items-center gap-x-5 gap-y-4 overflow-hidden p-5",
        className,
      )}
      style={{
        border: `1px solid ${color}44`,
        background: `linear-gradient(115deg, ${color}1f, ${color}08 42%, rgba(255,255,255,0.02))`,
      }}
    >
      {/*
        Luz del rango detrás del emblema. Es estática: la insignia aparece en la
        clasificación hasta veinte veces y un halo animado se multiplicaría por veinte.
      */}
      <span
        aria-hidden
        className="nx-bloom"
        style={{
          left: compact ? -20 : -30,
          top: "50%",
          width: compact ? 120 : 170,
          height: compact ? 120 : 170,
          transform: "translateY(-50%)",
          background: color,
        }}
      />

      <RankEmblem
        tierId={display.champion ? "nexus" : r.tier.id}
        color={color}
        champion={display.champion}
        division={r.division}
        divisions={r.tier.divisions}
        size={compact ? 56 : 84}
        className="relative shrink-0 drop-shadow-[0_6px_18px_rgba(0,0,0,0.7)]"
      />

      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <p
            className={cn(
              "font-display font-bold uppercase tracking-[0.06em]",
              compact ? "text-lg" : "text-[26px] leading-none",
            )}
            style={{ color, textShadow: `0 0 22px ${color}66` }}
          >
            {td(display.label)}
          </p>
          <p className="nx-readout text-sm text-white/70">{r.points} {t("pts")}</p>
          {position != null && <p className="text-xs text-white/45">{t("· #{n} del mundo en puntos", { n: position })}</p>}
          {regionPosition != null && region && (
            <p className="text-xs text-white/45">{t("· #{n} de {region}", { n: regionPosition, region: td(REGION_LABEL[region]) })}</p>
          )}
        </div>

        {r.unranked ? (
          <p className="mt-2 text-[13px] text-white/55">
            {t("Todavía no tienes puntos. Gana duelos contra el bot o acierta predicciones de Pick'ems para entrar en los rangos de puntos.")}
          </p>
        ) : (
          <>
            {/* Barra fina: la división. Se mueve cada pocos puntos, así el avance se nota. */}
            {r.division > 0 && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full transition-[width] duration-slow ease-out"
                  style={{ width: `${Math.round(r.divisionProgress * 100)}%`, background: `${color}99` }}
                />
              </div>
            )}

            {/*
              Barra gruesa con el DESTINO al final. El emblema del siguiente rango, apagado,
              cierra la barra: la recompensa de seguir jugando deja de ser una palabra y
              pasa a ser una pieza que ya se puede ver.
            */}
            <div className="mt-1.5 flex items-center gap-2.5">
              <div
                className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={r.next ? t("Progreso hacia {label}", { label: td(r.next.label) }) : t("Rango máximo alcanzado")}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-slow ease-out"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${color}77, ${color})`,
                    boxShadow: `0 0 14px ${color}aa`,
                  }}
                />
              </div>
              {r.next && !compact && (
                <RankEmblem
                  tierId={r.next.id}
                  color={r.next.color}
                  size={34}
                  className="shrink-0 opacity-40"
                />
              )}
            </div>

            <p className="nx-label mt-2 flex flex-wrap items-baseline gap-x-2 !tracking-[0.12em]">
              {r.next ? (
                <>
                  <span className="tabular-nums">
                    {r.points - r.tier.min} / {r.next.min - r.tier.min}
                  </span>
                  {r.toNextDivision > 0 && (
                    <span className="tabular-nums">{t("· {n} para subir de división", { n: r.toNextDivision })}</span>
                  )}
                  <span>{t("· faltan {n} para", { n: r.toNext })}</span>
                  <span style={{ color: r.next.color }}>{td(r.next.label)}</span>
                </>
              ) : (
                <span style={{ color: display.champion ? CHAMPION_COLOR : undefined }}>
                  {display.champion ? t("Primero del mundo") : t("Rango máximo alcanzado")}
                </span>
              )}
            </p>
          </>
        )}
      </div>

      {action && (
        <Link
          href={action.href}
          /* FASE 11 · 44 px. Eran 36, y es la única acción de la insignia de rango. */
          className="nx-focus nx-clip-sm relative inline-flex min-h-[44px] shrink-0 items-center border border-white/15 bg-white/[0.05] px-4 font-display text-xs font-bold uppercase tracking-[0.12em] text-white/80 transition duration-fast hover:bg-white/12 hover:text-white"
        >
          {td(action.label)}
        </Link>
      )}
    </div>
  );
}
