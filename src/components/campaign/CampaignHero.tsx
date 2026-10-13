"use client";

/**
 * CABECERA DE ROAD TO CHAMPIONS + AVISOS DE ESTADO (Fase 35).
 *
 * Progreso real y nada más: X/Y NODOS, CAPÍTULO X/Y y los créditos de primera victoria ya conseguidos sobre el
 * total acotado. Sin puntuación global inventada.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import type { CampaignSnapshot } from "@/domain/campaign/snapshot";
import { allNodeViews, nodeCode } from "@/lib/campaign/presentation";
import { playerMessage } from "@/components/ui/game/GameStates";

export function CampaignHero({ snapshot: s, onContinue, signedIn, className }: { snapshot: CampaignSnapshot; onContinue: (nodeId: string) => void; signedIn: boolean; className?: string }) {
  const next = s.summary.nextNodeId ? allNodeViews(s).find((n) => n.id === s.summary.nextNodeId) ?? null : null;
  const pct = s.summary.total ? Math.round((s.summary.completed / s.summary.total) * 100) : 0;
  const currentChapter = next ? next.chapterOrder : s.summary.chaptersComplete;

  return (
    <section
      aria-labelledby="rtc-title"
      data-testid="campaign-hero"
      className={cn("nx-clip relative isolate overflow-hidden border border-drl-cyan/30 px-5 py-6 sm:px-8 sm:py-8", className)}
      style={{ background: "radial-gradient(80% 140% at 90% 10%, rgba(25,227,255,0.20), transparent 60%), radial-gradient(60% 100% at 10% 110%, rgba(255,211,92,0.12), transparent 70%), linear-gradient(180deg, #0b0f1a, #06070d)" }}
    >
      <svg aria-hidden viewBox="0 0 400 200" className="pointer-events-none absolute -right-10 top-0 -z-10 hidden h-[58%] w-[62%] opacity-50 md:block" preserveAspectRatio="xMaxYMid slice">
        <polyline points="0,160 70,120 130,150 200,90 270,120 340,50 400,70" fill="none" stroke="rgba(25,227,255,0.55)" strokeWidth="1.5" className="nx-energy" />
        {[[70, 120], [200, 90], [340, 50]].map(([x, y]) => <polygon key={x} points={`${x},${y - 9} ${x + 8},${y - 4.5} ${x + 8},${y + 4.5} ${x},${y + 9} ${x - 8},${y + 4.5} ${x - 8},${y - 4.5}`} fill="rgba(25,227,255,0.15)" stroke="rgba(25,227,255,0.8)" />)}
      </svg>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />

      <Link href="/jugar" className="nx-focus -ml-2 inline-flex min-h-[44px] items-center rounded-control px-2 font-display text-label uppercase tracking-wide2 text-ink-muted hover:bg-white/[0.06] hover:text-white">
        ‹ Jugar
      </Link>
      <p className="nx-label mt-1 text-drl-cyan">Campaña PvE · {s.version}</p>
      <h1 id="rtc-title" className="mt-1 font-display text-[clamp(34px,6.2vw,72px)] font-bold uppercase leading-[0.9] text-white">
        Road to <span className="text-drl-cyan" style={{ textShadow: "0 0 40px rgba(25,227,255,0.45)" }}>Champions</span>
      </h1>
      <p className="mt-2 max-w-[56ch] text-body text-ink-secondary">{s.tagline}</p>

      <div className="mt-6 flex flex-col gap-5 border-t border-white/10 pt-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div data-testid="campaign-progress">
            <span className="nx-label">Progreso</span>
            <p className="nx-readout text-[30px] leading-none text-white">{s.summary.completed}<span className="text-[18px] text-white/40">/{s.summary.total} nodos</span></p>
          </div>
          <div>
            <span className="nx-label">Capítulos</span>
            <p className="nx-readout text-[22px] leading-none text-white/85">{s.summary.chaptersComplete}/{s.summary.chaptersTotal} <span className="text-[14px] text-white/45">completados</span></p>
          </div>
          <div>
            <span className="nx-label">Primera victoria</span>
            <p className="nx-readout text-[22px] leading-none text-drl-gold">{s.economy.firstClearEarned}<span className="text-[14px] text-white/45"> / {s.economy.firstClearTotal} créditos</span></p>
          </div>
          <div className="min-w-[200px] flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-black/60" role="progressbar" aria-label="Nodos completados" aria-valuemin={0} aria-valuemax={s.summary.total} aria-valuenow={s.summary.completed} aria-valuetext={`${s.summary.completed} de ${s.summary.total} nodos`}>
              <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, rgba(25,227,255,0.6), rgba(25,227,255,1))", boxShadow: "0 0 12px rgba(25,227,255,0.7)" }} />
            </div>
            <p className="nx-label mt-1">{s.summary.complete ? "Campaña completada" : `Capítulo ${Math.max(1, currentChapter)} de ${s.summary.chaptersTotal}`}</p>
          </div>
        </div>
        {s.available && next && (
          <NxButton variant="primary" size="lg" className="shrink-0" onClick={() => onContinue(next.id)} data-testid="campaign-continue">
            {s.summary.completed === 0 ? "Empezar" : "Continuar"} · {nodeCode(next)} {next.name}
          </NxButton>
        )}
        {s.available && !next && s.summary.complete && signedIn && (
          <p className="font-display text-[14px] font-bold uppercase tracking-[0.14em] text-[#6fe0a0]">◆ Todos los nodos superados</p>
        )}
      </div>
    </section>
  );
}

export type CampaignNoticeKind = "unavailable" | "offline" | "error" | "signin" | "complete" | "active";

export function CampaignNotice({ kind, message, onRetry, action, className }: {
  kind: CampaignNoticeKind; message?: string; onRetry?: () => void; action?: { label: string; href?: string; onClick?: () => void }; className?: string;
}) {
  const copy: Record<CampaignNoticeKind, { title: string; body: string; tone: string }> = {
    unavailable: { title: "Road to Champions todavía no disponible", body: "El mapa se enseña como vista previa. Cuando la campaña se active en el servidor, tu progreso empezará a guardarse aquí.", tone: "border-drl-gold text-drl-gold" },
    offline: { title: "Sin conexión · Tu progreso está seguro", body: "Nada se completa sin el servidor. En cuanto vuelva la conexión, el mapa se actualiza solo.", tone: "border-drl-gold text-drl-gold" },
    error: { title: "No se pudo leer la campaña", body: message ? playerMessage(message) : "Inténtalo de nuevo en unos segundos.", tone: "border-drl text-drl-glow" },
    signin: { title: "Inicia sesión para jugar", body: "Puedes ver el mapa y los rivales. Para jugar y guardar tu progreso necesitas una cuenta.", tone: "border-drl-cyan text-drl-cyan" },
    complete: { title: "Road to Champions completado", body: "Has superado todos los nodos. Puedes rejugar cualquiera; la recompensa de primera victoria ya es tuya.", tone: "border-[#3fc07a] text-[#6fe0a0]" },
    active: { title: "Tienes un nodo en marcha", body: message ?? "Termínalo o abandónalo antes de empezar otro.", tone: "border-drl-cyan text-drl-cyan" },
  };
  const c = copy[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} data-testid={`campaign-notice-${kind}`} className={cn("flex flex-col gap-3 border-l-2 bg-white/[0.03] px-4 py-3 sm:flex-row sm:items-center sm:justify-between", c.tone.split(" ")[0], className)}>
      <div className="min-w-0">
        <b className={cn("block font-display text-body font-bold uppercase tracking-wide", c.tone.split(" ")[1])}>{c.title}</b>
        <p className="mt-0.5 text-caption leading-relaxed text-ink-secondary">{c.body}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        {onRetry && <NxButton variant="secondary" size="md" onClick={onRetry}>Reintentar</NxButton>}
        {action && (action.href
          ? <NxButton variant="secondary" size="md" href={action.href}>{action.label}</NxButton>
          : <NxButton variant="secondary" size="md" onClick={action.onClick}>{action.label}</NxButton>)}
      </div>
    </div>
  );
}
