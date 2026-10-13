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

export function LiveStrip({ eventId, live, next }: { eventId: string; live: MatchSummary[]; next: MatchSummary | null }) {
  if (live.length === 0 && !next) return null;
  const list = live.length > 0 ? live : [next!];
  const mode = live.length > 0 ? "live" : "next";
  return (
    <section aria-label={mode === "live" ? "Partidos en directo" : "Próximo partido"} data-testid="live-strip" data-mode={mode} data-count={list.length} className="space-y-2">
      {list.map((m) => (
        <Plate key={m.id} tone={mode === "live" ? "cyan" : "neutral"} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <MatchStatusBadge label={m.label} />
            <span className="min-w-0 truncate font-display text-[15px] font-bold uppercase text-white">{m.teamA ?? "Por decidir"} <span className="text-white/40">vs</span> {m.teamB ?? "Por decidir"}</span>
            {m.bestOf ? <span className="nx-label hidden sm:inline">BO{m.bestOf}</span> : null}
          </div>
          <div className="flex items-center gap-3">
            {mode === "live" ? <Score m={m} /> : <span className="text-[12px] text-white/55">{fmtWhen(m.startTime)}{m.stageName ? ` · ${m.stageName}` : ""}</span>}
            <Link href={`/torneos/${eventId}/partido/${m.id}`} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-white/15 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/80 transition hover:bg-white/[0.08] hover:text-white">
              {mode === "live" ? "Seguir" : "Ver partido"}
            </Link>
          </div>
        </Plate>
      ))}
    </section>
  );
}
