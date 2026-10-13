"use client";

/**
 * FASE 55 · ÚLTIMAS PARTIDAS como fichas de juego: resultado con PALABRA y letra (no solo color), rival
 * público, fecha, rating antes → cambio → después (el asiento real de la liquidación; sin asiento, se dice),
 * marcador persistido y acceso al detalle (que el servidor ya reconstruye: `?match=`).
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { OUTCOME_LABEL } from "@/domain/pvpLadder/ladder";
import { playerHref } from "@/lib/player/href";
import type { CompetitiveMatchRow } from "@/server/services/competitive";

const TONE: Record<"W" | "L" | "D" | "N", { box: string; letter: string; word: string }> = {
  W: { box: "border-ok/35 bg-ok/[0.07]", letter: "bg-ok/20 text-ok", word: "text-ok" },
  L: { box: "border-drl/35 bg-drl/[0.06]", letter: "bg-drl/20 text-drl-glow", word: "text-drl-glow" },
  D: { box: "border-white/15 bg-white/[0.04]", letter: "bg-white/10 text-white/75", word: "text-white/75" },
  N: { box: "border-white/10 bg-white/[0.02]", letter: "bg-white/5 text-white/50", word: "text-white/55" },
};
const LETTER = { W: "V", L: "D", D: "E", N: "·" } as const;

const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function RecentMatchCards({ matches, className }: { matches: CompetitiveMatchRow[]; className?: string }) {
  if (matches.length === 0) {
    return (
      <p className={cn("nx-clip-sm border border-white/10 bg-white/[0.03] px-4 py-4 text-caption text-ink-muted", className)} data-testid="ranked-history-empty">
        Aún no has jugado ninguna partida ranked. Tu primera partida aparecerá aquí con el cambio de rating.
      </p>
    );
  }
  return (
    <ol className={cn("grid gap-2", className)} data-testid="ranked-history">
      {matches.map((m) => {
        const k = m.letter ?? "N";
        const t = TONE[k];
        return (
          <li key={m.matchId}>
            {/* Fase 56 · la ficha entera abre el detalle (enlace estirado) y el rival abre SU perfil (enlace propio encima). */}
            <div className={cn("nx-clip-sm relative grid min-h-[64px] grid-cols-[auto_1fr_auto] items-center gap-3 border px-3 py-2 transition hover:bg-white/[0.06]", t.box)}
              data-outcome={m.outcome} data-match={m.matchId}>
              <Link href={`/duelos/competitivo/partida/${m.matchId}`} className="nx-focus absolute inset-0 z-0" aria-label={`Ver la partida contra ${m.rival.username}`} />
              <span className={cn("grid h-11 w-11 place-items-center font-display text-[20px] font-bold", t.letter)} aria-hidden>{LETTER[k]}</span>
              <span className="min-w-0">
                <span className={cn("block font-display text-[13px] font-bold uppercase tracking-[0.06em]", t.word)}>{OUTCOME_LABEL[m.outcome]}</span>
                <span className="block truncate text-[12.5px] text-white/80">
                  vs <Link href={playerHref(m.rival.userId)} className="nx-focus relative z-10 underline-offset-2 hover:underline" data-action="rival-profile"><span aria-hidden>{m.rival.avatar}</span> <b className="text-white">{m.rival.username}</b></Link>
                  <span className="text-white/45"> · {m.scoreYou}–{m.scoreRival}</span>
                </span>
                <span className="block text-[11px] text-white/40"><time dateTime={new Date(m.at).toISOString()}>{dateFmt.format(m.at)}</time></span>
              </span>
              <span className="text-right" data-field="rating-move">
                {m.rating ? (
                  <>
                    <span className={cn("nx-readout block text-[18px] leading-none", m.rating.delta > 0 ? "text-ok" : m.rating.delta < 0 ? "text-drl-glow" : "text-white/70")}>
                      {m.rating.delta > 0 ? "+" : ""}{m.rating.delta}
                    </span>
                    <span className="nx-readout block text-[11.5px] text-white/50 tabular-nums">{m.rating.before} → {m.rating.after}</span>
                  </>
                ) : (
                  <span className="block text-[11px] text-white/40">Sin cambio de rating</span>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
