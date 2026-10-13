"use client";

/**
 * PIEZAS PEQUEÑAS DEL PERFIL (Fase 31): avatar con marco equipado, tonos por rareza real y fechas
 * a nivel de día. Presentación pura sobre la foto del servidor.
 */
import { useState } from "react";
import { cn } from "@/lib/format";
import type { RarityBucket } from "@/domain/packs/types";
import { ns, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("player");

/** Tono semántico del sistema por cubo de rareza REAL (`RarityBucket`). No inventa tiers. */
export const RARITY_TONE: Record<RarityBucket, "muted" | "info" | "key" | "gold" | "warn"> = {
  common: "muted", uncommon: "info", rare: "key", epic: "warn", legendary: "gold",
};

export function PlayerAvatar({ avatar, username, frame, size = "lg", className }: { avatar: string; username: string; frame?: { color: string } | null; size?: "sm" | "md" | "lg"; className?: string }) {
  useLocale();
  const box = size === "lg" ? "h-24 w-24 text-5xl sm:h-28 sm:w-28" : size === "md" ? "h-14 w-14 text-3xl" : "h-10 w-10 text-xl";
  return (
    <span
      role="img"
      aria-label={t("Avatar de {username}", { username })}
      className={cn("nx-plate nx-clip-sm grid shrink-0 place-items-center", box, className)}
      style={frame ? { boxShadow: `0 0 0 2px ${frame.color}, 0 0 22px ${frame.color}66` } : undefined}
      data-frame={frame ? "yes" : "no"}
    >
      {avatar}
    </span>
  );
}

export const fmtDay = (ms: number): string => new Date(ms).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" });

/** F89 · día con año (historial y momentos: pueden ser de otro año). UTC: el servidor ya redondeó al día UTC. */
export const fmtDate = (ms: number): string => new Date(ms).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** F89 · «octubre de 2026» (miembro desde: el servidor solo publica el mes). */
export const fmtMonth = (ms: number): string => new Date(ms).toLocaleDateString(getIntlLocale(), { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * F89 · EQUIPO ESPORTS (favorito) como sello: logo REAL del producto tal cual (sin filtros ni recolor) + nombre. Sin
 * logo, la sigla con el lenguaje visual propio. Si la imagen falla, cae a la sigla: nunca un icono roto.
 */
export function TeamMark({ team, size = "md" }: { team: { name: string; tag: string; logo: string | null }; size?: "md" | "lg" }) {
  useLocale();
  const [broken, setBroken] = useState(false);
  const px = size === "lg" ? 40 : 24;
  return (
    <span className="nx-clip-sm inline-flex max-w-full items-center gap-2 border border-white/12 bg-white/[0.04] py-1 pl-1.5 pr-3">
      {team.logo && !broken
        ? <img src={team.logo} alt={t("Escudo de {name}", { name: team.name })} width={px} height={px} className="shrink-0 object-contain" style={{ width: px, height: px }} onError={() => setBroken(true)} />
        : <span aria-hidden className="grid shrink-0 place-items-center bg-white/10 font-display text-[10px] font-black text-white/80" style={{ width: px, height: px }}>{team.tag.slice(0, 4)}</span>}
      <span className="min-w-0 truncate font-display text-[12px] font-bold uppercase tracking-[0.08em] text-white">{team.name}</span>
    </span>
  );
}

export const serialText = (serial: number | null, limit: number | null): string =>
  serial === null ? t("Sin serie") : limit ? `#${serial} / ${limit}` : `#${serial}`;

/** Botón de acción del perfil (táctil ≥ 44). */
export function ProfileButton({ tone = "ghost", className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" }) {
  return (
    <button
      type="button"
      className={cn(
        "nx-focus nx-clip-sm inline-flex min-h-[44px] items-center justify-center gap-2 border px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-45",
        tone === "primary" ? "border-drl-cyan/60 bg-drl-cyan/10 text-drl-cyan hover:bg-drl-cyan/20" : "border-white/15 text-white/80 hover:bg-white/[0.08] hover:text-white",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
