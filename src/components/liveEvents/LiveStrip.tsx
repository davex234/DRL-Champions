"use client";

/**
 * EN DIRECTO / PRÓXIMO PARTIDO (Fase 30). Si hay partidos con `status = live` confirmado por el
 * backend, se listan TODOS arriba (no es un singleton) con marcador real y SEGUIR. Si no, el
 * próximo con su hora real. Sin partidos, no se pinta nada: no se inventa uno para llenar el hueco.
 */
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import type { MatchSummary } from "@/server/services/liveEvents";
import { MatchStatusBadge, Score, fmtWhen } from "./bits";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("liveEvents");

export function LiveStrip({ eventId, live, next }: { eventId: string; live: MatchSummary[]; next: MatchSummary | null }) {
  useLocale();
  if (live.length === 0 && !next) return null;
  const list = live.length > 0 ? live : [next!];
  const mode = live.length > 0 ? "live" : "next";
  return (
    <section aria-label={mode === "live" ? t("Partidos en directo") : t("Próximo partido")} data-testid="live-strip" data-mode={mode} data-count={list.length} className="space-y-2">
      {list.map((m) => (
        <Plate key={m.id} tone={mode === "live" ? "cyan" : "neutral"} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <MatchStatusBadge label={td(m.label)} />
            <span className="min-w-0 truncate font-display text-[15px] font-bold uppercase text-white">{td(m.teamA) ?? t("Por decidir")} <span className="text-white/40">{t("vs")}</span> {td(m.teamB) ?? t("Por decidir")}</span>
            {m.bestOf ? <span className="nx-label hidden sm:inline">{t("BO")}{m.bestOf}</span> : null}
          </div>
          <div className="flex items-center gap-3">
            {mode === "live" ? <Score m={m} /> : <span className="text-[12px] text-white/55">{fmtWhen(m.startTime)}{m.stageName ? ` · ${m.stageName}` : ""}</span>}
            <Link href={`/torneos/${eventId}/partido/${m.id}`} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-white/15 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/80 transition hover:bg-white/[0.08] hover:text-white">
              {mode === "live" ? t("Seguir") : t("Ver partido")}
            </Link>
          </div>
        </Plate>
      ))}
    </section>
  );
}
