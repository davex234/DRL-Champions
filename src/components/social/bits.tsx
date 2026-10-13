"use client";

/**
 * PIEZAS PEQUEÑAS DEL SOCIAL (Fase 29): presencia, avatar con nombre, botón de acción compacto y
 * cuenta atrás de reto. Presentación pura sobre datos del servidor; ninguna decide nada.
 */
import { playerHref } from "@/lib/player/href";
import Link from "next/link";
import { StatusDot } from "@/components/ui/Badge";
import { PRESENCE_LABEL, type Presence } from "@/domain/social/social";
import type { SocialPlayer } from "@/server/services/social";
import type { RankBadge } from "@/server/services/competitive";
import { RankInline } from "@/components/competitive/ranked/CompetitiveEmblem";

export const PRESENCE_TONE: Record<Presence, "ok" | "warn" | "muted" | "info"> = { IN_MATCH: "warn", IN_QUEUE: "info", ONLINE: "ok", OFFLINE: "muted" };

/** F85 · presencia con PALABRA (nunca solo color). Solo se pinta si el servidor la manda (amigos). */
export function PresenceDot({ presence, className }: { presence: Presence; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] text-white/60 ${className ?? ""}`} data-presence={presence}>
      <StatusDot tone={PRESENCE_TONE[presence]} pulse={presence === "ONLINE" || presence === "IN_MATCH"} />
      <span>{PRESENCE_LABEL[presence]}</span>
    </span>
  );
}

/** F85 · rango F84 compacto (emblema mini + nombre) y equipo favorito F89 (logo SOLO si ya existe; si no, la sigla). */
export function SocialTags({ rank, team }: { rank?: RankBadge | null; team?: { name: string; tag: string; logo: string | null } | null }) {
  if (!rank && !team) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {rank && <RankInline rank={rank.rank} state={rank.state} placement={rank.state === "PLACEMENT" ? placementOf(rank.label) : undefined} className="max-w-[160px]" />}
      {team && (
        <span className="inline-flex items-center gap-1 text-[11px] text-white/55" data-testid="social-team">
          {team.logo ? <img src={team.logo} alt={team.name} className="h-4 w-4 object-contain" /> : <span aria-hidden className="font-display text-[9px] font-bold">{team.tag}</span>}
          <span className="sr-only sm:not-sr-only">{team.name}</span>
        </span>
      )}
    </span>
  );
}
const placementOf = (label: string) => { const m = /(\d+)\/(\d+)/.exec(label); return m ? { played: Number(m[1]), total: Number(m[2]) } : undefined; };

export const profileHref = (userId: string) => playerHref(userId);

export function PlayerLine({ player, presence, sub, size = "md", tags }: { player: SocialPlayer; presence?: Presence | null; sub?: React.ReactNode; size?: "sm" | "md"; tags?: React.ReactNode }) {
  const av = size === "sm" ? "h-9 w-9 text-lg" : "h-11 w-11 text-2xl";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className={`grid ${av} shrink-0 place-items-center rounded-full bg-white/[0.06]`}>{player.avatar}</span>
      <div className="min-w-0">
        <Link href={profileHref(player.userId)} className="nx-focus -my-2.5 block truncate py-2.5 font-display text-[14px] font-bold uppercase tracking-wide text-white underline-offset-2 hover:underline">
          {player.username}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/45">
          {presence && <PresenceDot presence={presence} />}
          {tags}
          {sub}
        </div>
      </div>
    </div>
  );
}

/** Botón compacto de fila (44 px de alto mínimo: es táctil). */
export function RowButton({ tone = "ghost", className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "danger" }) {
  const look = tone === "primary"
    ? "border-drl-cyan/50 text-drl-cyan hover:bg-drl-cyan/10"
    : tone === "danger" ? "border-drl-red/40 text-drl-red hover:bg-drl-red/10" : "border-white/15 text-white/75 hover:bg-white/[0.08] hover:text-white";
  return (
    <button
      type="button"
      className={`nx-focus nx-clip-sm inline-flex min-h-[44px] items-center justify-center border px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-45 ${look} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Tiempo que le queda a un reto, en palabras. Solo presentación: quien caduca es el servidor. */
export function remainingText(expiresAt: number, now: number): string {
  const left = expiresAt - now;
  if (left <= 0) return "Caducado";
  const h = Math.floor(left / 3600_000);
  if (h >= 1) return `Caduca en ${h} h`;
  // F85 · un reto dura 5 min: cuenta atrás m:ss.
  const s = Math.floor(left / 1000);
  return `Caduca en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const ago = (at: number, now: number): string => {
  const d = Math.max(0, now - at);
  if (d < 60_000) return "ahora mismo";
  if (d < 3600_000) return `hace ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `hace ${Math.floor(d / 3600_000)} h`;
  return `hace ${Math.floor(d / 86_400_000)} d`;
};
