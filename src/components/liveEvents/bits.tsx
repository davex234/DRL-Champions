"use client";

/**
 * PIEZAS PEQUEÑAS DE LIVE EVENTS (Fase 30): estado del evento/partido con texto, marcador
 * accesible, fecha, aviso de frescura y el chip de identidad de equipo. Presentación pura sobre
 * datos del servidor; nada decide un estado ni un ganador.
 */
import { Badge, StatusDot } from "@/components/ui/Badge";
import { Recessed } from "@/components/ui/Surface";
import { cn } from "@/lib/format";
import type { EventLifecycle } from "@/domain/liveEvents/eventState";
import type { MatchSummary, SyncView } from "@/server/services/liveEvents";

export const LIFECYCLE_TONE: Record<EventLifecycle, "key" | "info" | "muted"> = { ACTIVE: "key", UPCOMING: "info", COMPLETED: "muted" };

/**
 * Fase 44 · NO FAKE LIVE: un evento de DEMOSTRACIÓN con un partido marcado `live` en la BD no está «en directo» para
 * nadie. Se dice «Partido de demo» y sin pulso; el «En directo» queda para partidos reales.
 */
export function EventStatusBadge({ lifecycle, label, live, isDemo = false }: { lifecycle: EventLifecycle; label: string; live?: boolean; isDemo?: boolean }) {
  const realLive = !!live && !isDemo;
  return <Badge tone={LIFECYCLE_TONE[lifecycle]} dot pulse={realLive}>{realLive ? "En directo" : live && isDemo ? "Partido de demo" : label}</Badge>;
}

const MATCH_TONE: Record<MatchSummary["label"], "key" | "info" | "muted"> = { "EN CURSO": "key", PROGRAMADO: "info", FINALIZADO: "muted" };
const MATCH_TEXT: Record<MatchSummary["label"], string> = { "EN CURSO": "En directo", PROGRAMADO: "Programado", FINALIZADO: "Finalizado" };

export function MatchStatusBadge({ label }: { label: MatchSummary["label"] }) {
  return <Badge tone={MATCH_TONE[label]} dot pulse={label === "EN CURSO"}>{MATCH_TEXT[label]}</Badge>;
}

export const fmtWhen = (iso: string | null, opts: { time?: boolean } = { time: true }): string => {
  if (!iso) return "Sin fecha";
  const d = new Date(iso);
  const day = d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  return opts.time ? `${day} · ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : day;
};

export const fmtRange = (a: string | null, b: string | null): string => {
  if (!a) return "Por confirmar";
  return b ? `${fmtWhen(a, { time: false })} — ${fmtWhen(b, { time: false })}` : fmtWhen(a, { time: false });
};

/** Marcador accesible: «Equipo A 2, Equipo B 1» para lectores; VS antes de jugar. */
export function Score({ m, size = "md" }: { m: Pick<MatchSummary, "scoreA" | "scoreB" | "label" | "teamA" | "teamB">; size?: "md" | "lg" }) {
  const unplayed = m.label === "PROGRAMADO";
  const text = unplayed ? "VS" : `${m.scoreA ?? 0}–${m.scoreB ?? 0}`;
  const sr = unplayed ? `${m.teamA ?? "Por decidir"} contra ${m.teamB ?? "Por decidir"}` : `${m.teamA ?? "Por decidir"} ${m.scoreA ?? 0}, ${m.teamB ?? "Por decidir"} ${m.scoreB ?? 0}`;
  return (
    <Recessed depth="sm" className={cn("shrink-0 px-3 py-1 text-center", size === "lg" ? "min-w-[96px]" : "min-w-[64px]")}>
      <span aria-hidden className={cn("nx-readout tabular-nums", size === "lg" ? "text-[clamp(20px,3vw,32px)]" : "text-[15px]", unplayed ? "text-ink-faint" : m.label === "EN CURSO" ? "text-drl" : "text-white")}>{text}</span>
      <span className="sr-only">{sr}</span>
    </Recessed>
  );
}

/** Aviso de frescura: solo cuando los datos están viejos o el worker falla; nunca internos. */
export function SyncNotice({ sync, className }: { sync: SyncView; className?: string }) {
  if (!sync.notice) return null;
  return (
    <Recessed depth="sm" role="status" data-sync={sync.freshness} className={cn("flex items-center gap-2 border-l-2 border-l-warn px-4 py-2 text-caption text-ink-muted", className)}>
      <StatusDot tone="warn" size={5} />
      {sync.notice}
    </Recessed>
  );
}

/** Nombre del equipo: identidad verificada si existe; si no, el nombre tal cual llega. */
export function TeamName({ name, identity, className }: { name: string | null; identity?: { displayName: string; tag: string; verified: boolean } | null; className?: string }) {
  const shown = identity?.verified ? identity.displayName : name ?? "Por decidir";
  return <span className={cn("font-display font-bold uppercase tracking-[0.03em]", !name && "text-ink-faint", className)} data-verified={identity?.verified ? "yes" : "no"}>{shown}</span>;
}

export const DemoTag = ({ isDemo }: { isDemo: boolean }) => (isDemo ? <Badge tone="gold">Demo</Badge> : null);
