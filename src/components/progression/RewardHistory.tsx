"use client";

/**
 * CENTRO DE RECOMPENSAS (Fase 27). Las últimas recompensas leídas del LIBRO MAYOR real
 * (`credit_transactions`), traducidas por `describeReward`: fuente que el `reason` dice (duelo,
 * logro, objetivo, pase, Pick'ems, evento, bienvenida), créditos del asiento, sobre y XP solo
 * cuando la definición referida los fija. Es lectura: mostrar aquí no vuelve a conceder nada.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatCredits } from "@/lib/format";
import { SOURCE_LABEL, type RewardEntry, type RewardSource } from "@/domain/progression/meta";

const TONE: Record<RewardSource, "key" | "gold" | "info" | "ok" | "warn" | "bad" | "muted"> = {
  duel: "key", achievement: "gold", mission: "info", pass: "info", pickem: "ok", event: "ok", starter: "muted", purchase: "muted", other: "muted",
};

const fmt = (s: string) => new Date(s).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function RewardHistory({ rewards, className, showLink = true }: { rewards: RewardEntry[]; className?: string; showLink?: boolean }) {
  return (
    <section aria-label="Recompensas recientes" className={className} data-rewards={rewards.length}>
      {rewards.length === 0 ? (
        <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-5 text-center text-caption text-ink-muted">
          Todavía no hay recompensas. Juega un duelo, abre un sobre o completa un objetivo.
        </p>
      ) : (
        <ol className="divide-y divide-white/[0.06] nx-clip-sm border border-white/[0.09] bg-white/[0.02]">
          {rewards.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5" data-source={r.source}>
              <Badge tone={TONE[r.source]}>{SOURCE_LABEL[r.source]}</Badge>
              <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{r.label}</span>
              <span className="flex flex-wrap items-center gap-2 text-[12px]">
                {r.credits > 0 && <span className="nx-readout text-drl-gold">+{formatCredits(r.credits)} créditos</span>}
                {r.pack && <span className="nx-readout text-drl-cyan">+{r.pack.count} {r.pack.label}</span>}
                {r.xp !== null && r.xp > 0 && <span className="nx-readout text-white/80">+{r.xp} XP{r.source === "mission" ? " de pase" : ""}</span>}
                {r.credits === 0 && !r.pack && !r.xp && <span className="text-white/35">sin importe</span>}
              </span>
              <time className="w-full text-[11px] text-white/35 sm:w-auto" dateTime={r.at}>{fmt(r.at)}</time>
            </li>
          ))}
        </ol>
      )}
      {showLink && (
        <div className="mt-2 text-right">
          <Link href="/recompensas" className="nx-action">Historial completo →</Link>
        </div>
      )}
    </section>
  );
}
