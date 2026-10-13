"use client";

/**
 * OBJETIVOS (Fase 27). Las misiones del pase leídas como objetivos: estado claro (En progreso ·
 * Pendiente de recoger · Recompensa conseguida), barra, cifras del servidor, recompensa REAL de la
 * definición y cuenta atrás de la tanda (derivada de `expiresAt`, que fija el servidor).
 *
 * No hay botón de reclamar aquí: el reclamo existe y es manual, y vive en «Logros y pase»
 * (`/logros`). Un objetivo pendiente de recoger enlaza allí.
 */
import Link from "next/link";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";
import { cn, formatCredits } from "@/lib/format";
import { packLabel } from "@/domain/pickems/ledger";
import { remainingLabel } from "@/domain/progression/periods";
import {
  objectiveStatus, objectivePct, OBJECTIVE_STATUS_LABEL, type MetaObjective, type ObjectiveStatus,
} from "@/domain/progression/meta";

const KIND_LABEL: Record<string, string> = {
  daily: "Diaria", weekly: "Semanal", seasonal: "De temporada", progressive: "Hito", event: "Evento",
  special: "Especial", repeatable: "Repetible", hidden: "Oculta", community: "Comunidad",
};

const TONE: Record<ObjectiveStatus, "info" | "gold" | "ok"> = { EN_PROGRESO: "info", PENDIENTE_DE_RECOGER: "gold", RECOMPENSA_CONSEGUIDA: "ok" };

export function rewardText(o: Pick<MetaObjective, "rewardCredits" | "packId" | "packCount" | "xp">): string {
  const parts: string[] = [];
  if (o.rewardCredits > 0) parts.push(`${formatCredits(o.rewardCredits)} créditos`);
  if (o.packId) parts.push(`${o.packCount}× ${packLabel(o.packId)}`);
  if (o.xp > 0) parts.push(`${o.xp} XP de pase`);
  return parts.join(" · ") || "Sin recompensa definida";
}

export function ObjectiveCard({ objective: o, now, compact = false }: { objective: MetaObjective; now: number; compact?: boolean }) {
  const status = objectiveStatus(o);
  const pct = objectivePct(o);
  const expires = o.expiresAt !== null && status === "EN_PROGRESO" ? remainingLabel(o.expiresAt, now) : null;
  return (
    <article
      data-objective={o.id}
      data-status={status}
      className={cn(
        "nx-clip-sm flex flex-col gap-2 border p-3.5 transition duration-fast",
        status === "PENDIENTE_DE_RECOGER" ? "border-drl-gold/50 bg-drl-gold/[0.07]"
          : status === "RECOMPENSA_CONSEGUIDA" ? "border-ok/30 bg-ok/[0.04] opacity-75"
            : "border-white/[0.09] bg-white/[0.025]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="nx-label block !text-white/45">{KIND_LABEL[o.kind] ?? o.kind}{expires ? ` · caduca en ${expires}` : ""}</span>
          <b className="block font-display text-[15px] font-bold text-white">{o.label}</b>
        </div>
        <Badge tone={TONE[status]} dot={status !== "RECOMPENSA_CONSEGUIDA"}>{OBJECTIVE_STATUS_LABEL[status]}</Badge>
      </div>
      <Meter height={6} tone={TONE[status]} value={pct} label={`${o.label}: ${o.current} de ${o.goal}`} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="nx-readout text-[12px] text-white/60">{o.current} / {o.goal}</span>
        {!compact && <span className="text-[11.5px] text-white/45">{rewardText(o)}</span>}
      </div>
      {status === "PENDIENTE_DE_RECOGER" && (
        <Link href="/logros" className="nx-focus nx-clip-sm inline-flex min-h-[40px] items-center justify-center border border-drl-gold/50 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-gold transition hover:bg-drl-gold/10">
          Recoger en Logros y pase →
        </Link>
      )}
    </article>
  );
}

export function ObjectiveList({ objectives, now, max, compact }: { objectives: MetaObjective[]; now: number; max?: number; compact?: boolean }) {
  const list = typeof max === "number" ? objectives.slice(0, max) : objectives;
  if (list.length === 0) {
    return <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-5 text-center text-caption text-ink-muted">No hay objetivos activos ahora mismo.</p>;
  }
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" data-objectives={list.length}>
      {list.map((o) => <ObjectiveCard key={`${o.id}-${o.assignedAt}`} objective={o} now={now} compact={compact} />)}
    </div>
  );
}
