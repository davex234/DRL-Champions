"use client";

/**
 * «¿QUÉ HAGO AHORA?» (Fase 34). Máximo 5 acciones que decide el SERVIDOR con la misma prioridad que la
 * home (`seasonActions` → `todayActions`). Aquí solo se pintan.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import type { TodayAction } from "@/domain/progression/meta";
import { Panel } from "./SeasonPanels";

export function SeasonActionBoard({ actions, signedIn }: { actions: TodayAction[]; signedIn: boolean }) {
  if (!signedIn) {
    return (
      <Panel id="acciones" kicker="Tu temporada" title="¿Qué hago ahora?" action={<NxButton variant="primary" size="md" href="/cuenta">Entrar</NxButton>}>
        <p className="text-body text-ink-muted">Entra con tu cuenta para ver tus recompensas, objetivos y partidas pendientes.</p>
      </Panel>
    );
  }
  return (
    <Panel id="acciones" kicker="Tu temporada" title="¿Qué hago ahora?">
      {actions.length === 0 ? (
        <p className="text-body text-ink-muted" data-testid="no-actions">Nada pendiente ahora mismo. Juega un duelo o sigue el circuito cuando quieras.</p>
      ) : (
        <ol className="space-y-2" data-testid="season-actions">
          {actions.map((a, i) => (
            <li key={a.id}>
              <Link href={a.href} className={cn("nx-focus group flex min-h-[56px] items-center gap-3 rounded-[4px] border px-3 py-2 transition", i === 0 ? "border-drl-cyan/50 bg-drl-cyan/[0.07]" : "border-white/10 bg-black/30 hover:border-white/25")} data-kind={a.kind}>
                <span aria-hidden className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full font-display text-[14px] font-bold", i === 0 ? "bg-drl-cyan text-black" : "bg-white/10 text-white/70")}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <b className="block font-display text-[14px] font-bold uppercase tracking-[0.06em] text-white">{a.label}</b>
                  <span className="block truncate text-[12px] text-ink-muted">{a.detail}</span>
                </span>
                {a.urgent && <span className="shrink-0 rounded-[3px] border border-drl-gold/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-drl-gold">Caduca</span>}
                <span aria-hidden className="shrink-0 text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white">→</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
