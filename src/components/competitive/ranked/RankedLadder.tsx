"use client";

/**
 * FASE 55 · CLASIFICACIÓN. Escalera GLOBAL (el único ámbito que tiene el rating PvP), paginada de 25 en 25:
 * el navegador nunca descarga la escalera entera (`GET ?ladder=1&offset=` acotado a ≤ 50 en el servidor).
 * «Mi zona» salta a la página donde estás. La fila propia se marca con `aria-current` y «← tú».
 * Identidad solo pública (nombre y avatar): ni correo ni datos de cuenta.
 *
 * F84 · es el TOP de la temporada competitiva: solo jugadores con la colocación completa, el mínimo de partidas y
 * actividad reciente, como mucho `topSize` (500). Con 17 elegibles se enseñan 17: nunca se fabrican filas. «Tu zona»
 * enseña los de encima y debajo de ti cuando no estás en la página visible.
 */
import { useCallback, useState } from "react";
import { cn } from "@/lib/format";
import type { CompetitiveLadderPage, LadderEntry } from "@/server/services/competitive";
import { Leaderboard } from "@/components/competitive/Leaderboard";
import { NxButton } from "@/components/ui/NxButton";
import { trackCompetitive } from "@/lib/competitive/telemetry";
import { playerMessage } from "@/components/ui/game/GameStates";

export interface RankedLadderProps {
  /** Primera página (top) que ya vino con el snapshot. */
  top: LadderEntry[];
  /** F84 · los de alrededor de ti (servidor), si no estás en el top visible. */
  aroundMe?: LadderEntry[];
  /** F84 · tamaño máximo del Top y reglas de entrada (para explicar una clasificación vacía o corta). */
  topSize?: number;
  rules?: { minSeasonMatches: number; activeDays: number; placementGames: number } | null;
  rankedTotal: number;
  selfPosition: number | null;
  /** Lector de páginas; en el arnés QA es un fixture, en la app `fetchCompetitiveLadder`. */
  loadPage?: (offset: number) => Promise<CompetitiveLadderPage | null>;
  pageSize?: number;
  className?: string;
}

export function RankedLadder({ top, aroundMe = [], topSize = 500, rules = null, rankedTotal, selfPosition, loadPage, pageSize = 25, className }: RankedLadderProps) {
  const [page, setPage] = useState<{ offset: number; entries: LadderEntry[]; hasPrev: boolean; hasNext: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(async (offset: number) => {
    if (!loadPage) return;
    setBusy(true); setError(null);
    try {
      const p = await loadPage(offset);
      if (p) setPage({ offset: p.offset, entries: p.entries, hasPrev: p.hasPrev, hasNext: p.hasNext });
      trackCompetitive("leaderboard_view");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la clasificación");
    } finally {
      setBusy(false);
    }
  }, [loadPage]);

  const view = page ?? { offset: 0, entries: top, hasPrev: false, hasNext: rankedTotal > top.length };
  const from = view.entries[0]?.position ?? 0;
  const to = view.entries[view.entries.length - 1]?.position ?? 0;
  const selfOffset = selfPosition !== null ? Math.floor((selfPosition - 1) / pageSize) * pageSize : null;
  const selfVisible = view.entries.some((e) => e.isSelf);

  return (
    <section aria-label="Clasificación" className={cn("space-y-3", className)} data-testid="ranked-ladder" data-offset={view.offset}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-[20px] font-bold uppercase tracking-wide text-white">Clasificación · Top {topSize}</h2>
          <p className="text-caption text-ink-faint">
            Global · {rankedTotal} {rankedTotal === 1 ? "jugador clasificado" : "jugadores clasificados"}
            {from > 0 && ` · #${from}–#${to}`}
          </p>
        </div>
        {selfPosition !== null && selfOffset !== null && !selfVisible && loadPage && (
          <NxButton variant="secondary" size="sm" onClick={() => void go(selfOffset)} disabled={busy} data-testid="ladder-me">Ir a mi posición (#{selfPosition})</NxButton>
        )}
      </div>

      <Leaderboard entries={view.entries} title={undefined} emptyText={rules
        ? `Todavía no hay nadie en el Top esta temporada. Entra completando tu colocación (${rules.placementGames} partidas), con al menos ${rules.minSeasonMatches} partidas de temporada y una en los últimos ${rules.activeDays} días.`
        : "Todavía no hay nadie en la escalera. Tu primera partida ranked liquidada la abre."} />

      {!page && !selfVisible && aroundMe.length > 0 && (
        <Leaderboard entries={aroundMe} title="Tu zona" caption={selfPosition !== null ? `Tú: #${selfPosition}` : undefined} className="pt-1" />
      )}

      {error && <p className="text-caption text-drl-glow" role="alert">{playerMessage(error)}</p>}

      {loadPage && (view.hasPrev || view.hasNext) && (
        <nav aria-label="Páginas de la clasificación" className="flex items-center justify-between gap-2">
          <NxButton variant="ghost" size="sm" onClick={() => void go(Math.max(0, view.offset - pageSize))} disabled={busy || !view.hasPrev} data-testid="ladder-prev">‹ Anteriores</NxButton>
          <span className="text-[11.5px] text-white/45">{busy ? "Cargando…" : `Página ${Math.floor(view.offset / pageSize) + 1} de ${Math.max(1, Math.ceil(rankedTotal / pageSize))}`}</span>
          <NxButton variant="ghost" size="sm" onClick={() => void go(view.offset + pageSize)} disabled={busy || !view.hasNext} data-testid="ladder-next">Siguientes ›</NxButton>
        </nav>
      )}
    </section>
  );
}
