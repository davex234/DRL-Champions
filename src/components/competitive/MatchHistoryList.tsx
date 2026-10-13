"use client";

/**
 * HISTORIAL COMPETITIVO (Fase 28). Cada fila: fecha, rival (enlace a su perfil), desenlace REAL
 * (victoria/derrota/empate, por abandono, por tiempo), marcador, rating antes → después (asiento de
 * la liquidación, si ya existe) y enlace al detalle. Paginación por cursor con «Cargar más».
 */
import { playerHref } from "@/lib/player/href";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { OUTCOME_LABEL, type MatchOutcome } from "@/domain/pvpLadder/ladder";
import type { CompetitiveMatchRow } from "@/server/services/competitive";

const TONE: Record<"W" | "L" | "D", "ok" | "bad" | "gold"> = { W: "ok", L: "bad", D: "gold" };
const fmt = (ms: number) => new Date(ms).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function outcomeTone(o: MatchOutcome): "ok" | "bad" | "gold" | "muted" {
  if (o === "WIN" || o === "ABANDON_WIN" || o === "TIMEOUT_WIN") return "ok";
  if (o === "LOSS" || o === "ABANDON_LOSS" || o === "TIMEOUT_LOSS") return "bad";
  if (o === "DRAW") return "gold";
  return "muted";
}

export function MatchHistoryList({
  matches, onMore, hasMore, loading, className, emptyText = "Todavía no has jugado ninguna partida ranked.",
}: {
  matches: CompetitiveMatchRow[]; onMore?: () => void; hasMore?: boolean; loading?: boolean; className?: string; emptyText?: string;
}) {
  if (matches.length === 0) {
    return (
      <div className={className} data-history="empty">
        <p className="nx-clip-sm border-l-2 border-l-drl/60 bg-white/[0.03] px-4 text-left !text-[14px] !text-white/70 py-5 text-center text-caption text-ink-muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className={className} data-history={matches.length}>
      <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]" aria-label="Partidas">
        {matches.map((m) => (
          <li key={m.matchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5" data-outcome={m.outcome}>
            <Badge tone={outcomeTone(m.outcome)} className="w-[2.6rem] justify-center">{m.letter ?? "—"}</Badge>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-white/90">
                vs{" "}
                <Link href={playerHref(m.rival.userId)} className="nx-focus font-semibold text-white underline-offset-2 hover:underline">
                  <span aria-hidden>{m.rival.avatar} </span>{m.rival.username}
                </Link>
                <span className="ml-2 text-white/45">{OUTCOME_LABEL[m.outcome]}</span>
              </span>
              <time className="block text-[11px] text-white/35" dateTime={new Date(m.at).toISOString()}>{fmt(m.at)}</time>
            </span>
            <span className="nx-readout text-[14px] text-white/80">{m.scoreYou}–{m.scoreRival}</span>
            <span className="nx-readout w-[6.5rem] text-right text-[13px]" data-field="rating">
              {m.rating ? (
                <>
                  <span className="text-white/45">{m.rating.before}</span>
                  <span className={m.rating.delta >= 0 ? "text-ok" : "text-drl"}> {m.rating.delta >= 0 ? "+" : ""}{m.rating.delta}</span>
                </>
              ) : (
                <span className="text-white/35">sin liquidar</span>
              )}
            </span>
            <Link href={`/duelos/competitivo/partida/${m.matchId}`} className="nx-focus nx-clip-sm inline-flex min-h-[36px] items-center border border-white/12 px-3 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-white/70 hover:bg-white/[0.06]">
              Detalle
            </Link>
          </li>
        ))}
      </ol>
      {hasMore && onMore && (
        <div className="mt-2 flex justify-center">
          <NxButton variant="secondary" size="md" onClick={onMore} disabled={loading}>{loading ? "Cargando…" : "Cargar más"}</NxButton>
        </div>
      )}
    </div>
  );
}
