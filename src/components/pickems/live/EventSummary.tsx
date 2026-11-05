"use client";

/**
 * RESUMEN DEL EVENTO VIVO (Fase 24.5) — progreso, hoy, actividad reciente, pendientes, aviso.
 *
 * Presentación pura sobre `LiveEventSnapshot` (dominio). Nada se calcula aquí: ni ganadores,
 * ni puntos, ni horas. Las únicas horas que se pintan son las reales (inicio del partido,
 * asiento de la recompensa) y se formatean en la zona horaria del navegador.
 */
import { Plate, Recessed } from "@/components/ui/Surface";
import { Badge, StatusDot } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { TeamLogo } from "@/components/cards/layers/TeamLogo";
import { cn } from "@/lib/format";
import type { LiveEventSnapshot, LiveMatch, ActivityItem, LiveChange } from "@/domain/pickems/live";
import { isLiveMatch, isFinishedMatch, agoLabel } from "@/domain/pickems/live";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { ns, td, tdIn, getIntlLocale } from "@/i18n/runtime";
import { roundText } from "@/lib/bracket/roundText";
import { useLocale } from "@/i18n/react";

const tr = ns("pickems");

const hhmm = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString(getIntlLocale(), { hour: "2-digit", minute: "2-digit" }) : "—");

/* ─────────────── Progreso del torneo ─────────────── */

export function EventProgress({ progress, className }: { progress: LiveEventSnapshot["progress"]; className?: string }) {
  useLocale();
  if (progress.total === 0) return null;
  const multi = progress.stages.length > 1;
  return (
    <Plate className={cn("px-4 py-3", className)} aria-label={tr("Progreso del torneo")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className="nx-label">{tr("Torneo")}</span>
          <span className="nx-readout text-[20px] tabular-nums text-white">{progress.finished} / {progress.total}</span>
          <span className="nx-label">{tr("partidos completados ·")} {progress.pct}%</span>
        </span>
        <span className="nx-label">
          {progress.live > 0 && <span className="text-drl-cyan">{progress.live} {tr("en directo ·")} </span>}
          {progress.upcoming} {tr("por jugar")}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label={tr("{finished} de {total} partidos completados", { finished: progress.finished, total: progress.total })}>
        <span className="block h-full transition-[width] duration-normal motion-reduce:transition-none" style={{ width: `${progress.pct}%`, background: "var(--nx-cyan)" }} />
      </div>
      {multi && (
        <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3" aria-label={tr("Fases")}>
          {progress.stages.map((s) => (
            <li key={s.id ?? "-"} className="flex items-center gap-2">
              <span className="nx-label w-[120px] truncate">{s.name}</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full" style={{ width: `${s.pct}%`, background: s.pct === 100 ? "var(--nx-ok)" : "var(--nx-cyan)" }} /></span>
              <span className="nx-label tabular-nums">{s.finished}/{s.total}</span>
            </li>
          ))}
        </ul>
      )}
    </Plate>
  );
}

/* ─────────────── Hoy ─────────────── */

const STATUS_BADGE = (m: LiveMatch) =>
  isLiveMatch(m) ? <Badge tone="key" dot pulse>{tr("En directo")}</Badge>
    : isFinishedMatch(m) ? <Badge tone="muted">{tr("Finalizado")}</Badge>
      : <Badge tone="info" dot>{tr("Próximo")}</Badge>;

const PICK_TXT: Record<string, string> = {
  pendiente: "Pendiente", elegida: "Elegido", bloqueada: "Bloqueada", "sin-prediccion": "Sin predicción",
  acertada: "Acertada", fallada: "Fallada", "sin-participar": "No jugada",
};

export function EventToday({ matches, className }: { matches: LiveMatch[]; className?: string }) {
  useLocale();
  if (matches.length === 0) return null;
  return (
    <section className={className} aria-label={tr("Partidos de hoy")}>
      <SectionTitle as="h2">{tr("Hoy")} <span className="text-ink-faint">({matches.length})</span></SectionTitle>
      <ol className="grid gap-1.5">
        {matches.map((m) => {
          const mine = m.selectedOption === m.optionA ? m.teamA : m.selectedOption === m.optionB ? m.teamB : null;
          return (
            <li key={m.id}>
              <Plate tone={isLiveMatch(m) ? "cyan" : "neutral"} className="flex items-center gap-3 px-3 py-2">
                <span className="nx-readout w-12 shrink-0 text-[14px] tabular-nums text-white">{hhmm(m.startsAt)}</span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5 font-display text-[13px] font-bold uppercase tracking-wide">
                  <span className={cn("truncate", m.winner === "a" ? "text-white" : m.winner === "b" ? "text-ink-faint" : "text-ink-primary")}>{m.teamA?.name ?? tr("Por definir")}</span>
                  <span className="nx-readout shrink-0 tabular-nums text-ink-muted">{m.scoreA ?? "–"}:{m.scoreB ?? "–"}</span>
                  <span className={cn("truncate", m.winner === "b" ? "text-white" : m.winner === "a" ? "text-ink-faint" : "text-ink-primary")}>{m.teamB?.name ?? tr("Por definir")}</span>
                </span>
                {m.pickState && <span className="nx-label hidden sm:inline">{tdIn("pickems", PICK_TXT[m.pickState])}{mine ? ` · ${mine.name}` : ""}</span>}
                {STATUS_BADGE(m)}
              </Plate>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ─────────────── Actividad reciente ─────────────── */

const KIND_ICON: Record<ActivityItem["kind"], string> = { MATCH_FINISHED: "▸", PREDICTION_RESOLVED: "✓", QUALIFIED: "→", REWARD_EARNED: "★" };

export function RecentEventActivity({ items, className }: { items: ActivityItem[]; className?: string }) {
  useLocale();
  if (items.length === 0) return null;
  return (
    <section className={className} aria-label={tr("Actividad reciente")}>
      <SectionTitle as="h2">{tr("Actividad reciente")}</SectionTitle>
      <ol className="grid gap-1.5">
        {items.map((it) => {
          const hit = it.outcome === "acertada", miss = it.outcome === "fallada";
          const tierLabel = it.kind === "REWARD_EARNED" ? REWARD_TIERS.find((t) => t.id === it.detail)?.label ?? it.detail : null;
          return (
            <li key={it.id} className="min-w-0">
              <Recessed depth="sm" className={cn("flex min-w-0 items-center gap-3 px-3 py-2", hit && "border-l-2 border-l-ok", miss && "border-l-2 border-l-bad", it.kind === "QUALIFIED" && "border-l-2 border-l-drl-gold")} data-kind={it.kind}>
                <span className="nx-label w-11 shrink-0 tabular-nums">{it.at ? hhmm(it.at) : ""}</span>
                <span aria-hidden className={cn("w-4 text-center font-display text-[13px]", hit ? "text-ok" : miss ? "text-bad" : it.kind === "QUALIFIED" ? "text-drl-gold" : "text-ink-faint")}>
                  {miss ? "✕" : td(KIND_ICON[it.kind])}
                </span>
                {it.team && <span aria-hidden className="shrink-0"><TeamLogo team={it.team} size={18} /></span>}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate font-display text-[13px] font-bold uppercase tracking-wide", hit ? "text-ok" : miss ? "text-bad" : "text-white")}>
                    {it.kind === "REWARD_EARNED" ? `${it.title} · ${tierLabel}` : td(it.title)}
                  </span>
                  <span className="block truncate nx-label">{it.kind === "REWARD_EARNED" ? tr("Ya en tu cuenta") : it.kind === "MATCH_FINISHED" ? roundText(it.detail) : td(it.detail)}</span>
                </span>
                {it.kind === "PREDICTION_RESOLVED" && (
                  <span className={cn("nx-readout shrink-0 text-[15px] tabular-nums", hit ? "text-ok" : "text-ink-faint")}>
                    +{it.points ?? 0}{hit && it.points === null && <span className="nx-label ml-1">{tr("pend.")}</span>}
                  </span>
                )}
              </Recessed>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ─────────────── Pendientes ─────────────── */

export function PendingPredictions({ count, onGo, className }: { count: number; onGo?: () => void; className?: string }) {
  useLocale();
  if (count <= 0) return null;
  return (
    <Recessed depth="sm" className={cn("flex flex-wrap items-center justify-between gap-3 border-l-2 border-l-drl-cyan px-4 py-2.5", className)} aria-label={tr("Predicciones pendientes")}>
      <span className="flex items-center gap-2.5">
        <StatusDot tone="info" pulse size={6} />
        <span className="font-display text-[14px] font-bold uppercase tracking-wide text-white">
          {count} {count === 1 ? tr("predicción pendiente") : tr("predicciones pendientes")}
        </span>
      </span>
      {/* Fase 44 · el héroe ya lleva la acción dominante («N predicciones pendientes»): aquí va como secundaria. */}
      {onGo && <NxButton variant="secondary" size="md" onClick={onGo}>{tr("Completar ahora →")}</NxButton>}
    </Recessed>
  );
}

/* ─────────────── Aviso de actualización ─────────────── */

export function LiveUpdateNotice({
  online, refreshError, lastUpdatedAt, now, onRetry, className,
}: {
  online: boolean;
  refreshError: string | null;
  lastUpdatedAt: number | null;
  now: number;
  onRetry?: () => void;
  className?: string;
}) {
  useLocale();
  const stale = lastUpdatedAt !== null && now - lastUpdatedAt > 2 * 60_000;
  if (online && !refreshError && !stale) return null;
  return (
    <Recessed
      depth="sm"
      className={cn("flex flex-wrap items-center justify-between gap-2 px-4 py-2", !online || refreshError ? "border-l-2 border-l-warn" : "", className)}
      role="status"
      aria-live={!online || refreshError ? "polite" : "off"}
      data-live-notice={!online ? "offline" : refreshError ? "error" : "stale"}
    >
      <span className="flex items-center gap-2 text-caption text-ink-muted">
        <StatusDot tone={!online || refreshError ? "warn" : "muted"} size={5} />
        {!online
          ? tr("Sin conexión · se muestra la última actualización")
          : refreshError
            ? tr("No se ha podido actualizar")
            : tr("Datos del evento")}
        {lastUpdatedAt !== null && <span className="nx-label">{tr("· última actualización")} {agoLabel(lastUpdatedAt, now)}</span>}
      </span>
      {online && onRetry && refreshError && <NxButton variant="secondary" size="md" onClick={onRetry}>{tr("Reintentar")}</NxButton>}
    </Recessed>
  );
}

/* ─────────────── Cambios en sesión (aria-live) ─────────────── */

export function describeChange(c: LiveChange): string | null {
  switch (c.kind) {
    case "PREDICTION_RESOLVED": return c.outcome === "acertada" ? tr("Tu predicción se ha resuelto: acertada · +{v} pts", { v: c.points ?? 0 }) : tr("Tu predicción se ha resuelto: fallada · +0 pts");
    case "QUALIFIED": return tr("{team} se clasifica", { team: c.team });
    case "RANK_CHANGED": return tr("Tu posición: #{from} → #{to} ({v}{Math})", { from: c.from, to: c.to, v: c.to < c.from ? "+" : "−", Math: Math.abs(c.from - c.to) });
    case "POINTS_CHANGED": return tr("{delta} pts", { delta: `${c.to - c.from > 0 ? "+" : ""}${c.to - c.from}` });
    case "REWARD_EARNED": return tr("Recompensa conseguida · {v}", { v: td(REWARD_TIERS.find((t) => t.id === c.tier)?.label) ?? td(c.tier) });
    case "MATCH_FINISHED": return c.winner ? tr("{winner} gana el partido", { winner: c.winner }) : null;
    default: return null;
  }
}

export function LiveChangesBanner({ changes, onDismiss, className }: { changes: LiveChange[]; onDismiss?: () => void; className?: string }) {
  useLocale();
  const lines = changes.map(describeChange).filter((s): s is string => !!s);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={className} data-live-changes={lines.length}>
      {lines.length > 0 && (
        <Plate tone="success" className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
          <ul className="grid gap-0.5">
            {lines.slice(-4).map((l, i) => <li key={i} className="font-display text-[13px] font-bold uppercase tracking-wide text-white">{td(l)}</li>)}
          </ul>
          {onDismiss && <NxButton variant="tertiary" size="md" onClick={onDismiss} aria-label={tr("Cerrar avisos")}>{tr("Cerrar")}</NxButton>}
        </Plate>
      )}
    </div>
  );
}

/* ─────────────── Navegación del evento ─────────────── */

export function EventNav({ items, className }: { items: { id: string; label: string }[]; className?: string }) {
  useLocale();
  return (
    <nav aria-label={tr("Secciones del evento")} className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((it) => (
        <a key={it.id} href={`#${it.id}`} className="nx-clip-sm nx-focus inline-flex min-h-[44px] items-center bg-white/[0.04] px-3.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-ink-secondary hover:bg-white/[0.08]" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}>
          {td(it.label)}
        </a>
      ))}
    </nav>
  );
}
