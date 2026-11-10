"use client";

/**
 * FASE 42 · «UNA MÁS» — después de una partida, un sobre, un nodo, un combate de Draft o un ranked.
 *
 * Pide la foto del vestíbulo (la MISMA lectura canónica, sin escrituras) y enseña: el objetivo relacionado que se
 * acaba de mover (sin recompensa extra) y la siguiente acción que ya decidió el servidor, con su razón. Nunca obliga a
 * seguir: «Volver al lobby» está siempre. Sin sesión o sin respuesta, no pinta nada (el resultado sigue igual).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { NxButton } from "@/components/ui/NxButton";
import { Meter } from "@/components/ui/Meter";
import { fetchDailyLoop, type DailyLoopSnapshot } from "@/lib/dailyLoop/client";
import { afterActivityModel, type AfterContext } from "@/lib/liveService/presentation";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("liveService");

export function NextUpAfter({ context, snap: given, currentPath = null, className }: {
  context: AfterContext;
  /** Arnés/tests: foto ya dada. En producción se pide al montar. */
  snap?: DailyLoopSnapshot | null;
  currentPath?: string | null;
  className?: string;
}) {
  useLocale();
  const [snap, setSnap] = useState<DailyLoopSnapshot | null>(given ?? null);
  useEffect(() => {
    if (given !== undefined) return;
    let alive = true;
    fetchDailyLoop().then((r) => { if (alive) setSnap(r.data); }).catch(() => undefined);
    return () => { alive = false; };
  }, [given]);

  const m = afterActivityModel(snap, context, currentPath);
  if (!snap || !snap.signedIn) return null;
  return (
    <section aria-label={t("Qué sigue")} data-testid="next-up-after" data-context={context} className={cn("nx-clip-sm border border-white/10 bg-[linear-gradient(160deg,rgba(18,22,36,0.92),rgba(8,10,18,0.96))] p-4", className)}>
      <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">{t("Qué sigue")}</p>
      {m.draft && <p className="mt-1 text-[14px] text-white" data-testid="next-up-draft">{td(m.draft)}</p>}
      {m.progress.length > 0 && (
        <ul className="mt-2 space-y-2">
          {m.progress.map((p) => (
            <li key={p.id} data-testid="next-up-progress" data-claimable={p.claimable ? "true" : "false"}>
              <p className="flex items-baseline justify-between gap-3 text-[14px] text-white"><span className="min-w-0 truncate font-semibold">{td(p.label)}</span><span className="nx-readout shrink-0 text-white/85">{td(p.progressLabel)}</span></p>
              <Meter value={p.pct} tone={p.claimable ? "gold" : "info"} height={5} label={`${p.label}: ${p.progressLabel}`} />
              <p className="mt-0.5 text-caption text-ink-muted">{td(p.line)}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {m.next && <NxButton variant="primary" size="md" href={m.next.href} data-testid="next-up-cta" className="w-full sm:w-auto">{td(m.next.label)}</NxButton>}
        <Link href={m.lobbyHref} data-testid="next-up-lobby" className="nx-focus inline-flex min-h-[44px] items-center justify-center font-display text-[12px] font-bold uppercase tracking-[0.12em] text-drl-cyan hover:text-white">{t("Volver al lobby")}</Link>
      </div>
      {m.next && <p className="mt-1 text-caption text-ink-muted" data-testid="next-up-reason">{td(m.next.reason)}</p>}
    </section>
  );
}
