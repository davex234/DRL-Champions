"use client";

/**
 * ESCALERA (Fase 28). Tabla semántica en escritorio; lista de tarjetas compactas en móvil
 * (#12 · nombre · rating · W/L), ≥44 px por fila. La fila propia lleva `aria-current` y la marca
 * «← TÚ», no solo un color. Cada fila enlaza al perfil competitivo público del jugador.
 *
 * F84 · cada fila lleva su RANGO (emblema mini + nombre escrito, derivado en el servidor) y el récord de la TEMPORADA
 * competitiva (V–D), no el de por vida. Solo identidad pública: nombre y avatar.
 */
import { playerHref } from "@/lib/player/href";
import Link from "next/link";
import { cn } from "@/lib/format";
import type { LadderEntry } from "@/server/services/competitive";
import { RankInline } from "@/components/competitive/ranked/CompetitiveEmblem";

const href = (e: LadderEntry) => playerHref(e.userId);

export function Leaderboard({ entries, title, caption, className, emptyText = "Todavía no hay nadie en la escalera. La primera partida liquidada la abre." }: {
  entries: LadderEntry[]; title?: string; caption?: string; className?: string; emptyText?: string;
}) {
  if (entries.length === 0) {
    return (
      <section aria-label={title ?? "Escalera"} className={className} data-leaderboard="empty">
        {title && <h3 className="nx-label mb-2">{title}</h3>}
        <p className="nx-clip-sm border-l-2 border-l-drl/60 bg-white/[0.03] px-4 text-left !text-[14px] !text-white/70 py-5 text-center text-caption text-ink-muted">{emptyText}</p>
      </section>
    );
  }
  return (
    <section aria-label={title ?? "Escalera"} className={className} data-leaderboard={entries.length}>
      {(title || caption) && (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h3 className="nx-label">{title}</h3>}
          {caption && <span className="text-caption text-ink-faint">{caption}</span>}
        </div>
      )}

      {/* Escritorio: tabla de verdad. */}
      <div className="nx-clip-sm hidden overflow-hidden border border-white/[0.09] bg-white/[0.02] sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-base-800/60 text-left text-[10px] uppercase tracking-widest text-white/40">
              <th scope="col" className="px-3 py-2.5 font-medium">#</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Jugador</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Rango</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Rating</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium" title="Victorias–derrotas en la temporada competitiva">Temporada</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.userId}
                aria-current={e.isSelf ? "true" : undefined}
                data-self={e.isSelf ? "true" : undefined}
                className={cn("border-t border-white/5", e.isSelf ? "bg-drl-cyan/[0.10]" : "hover:bg-white/[0.03]")}
              >
                <td className="nx-readout px-3 py-2 text-[14px] text-white/70">#{e.position}</td>
                <td className="px-3 py-2">
                  <Link href={href(e)} className="nx-focus inline-flex min-h-[32px] items-center gap-2 text-white">
                    <span aria-hidden>{e.avatar}</span>
                    <span className="max-w-[220px] truncate">{e.username}</span>
                    {e.isSelf && <span className="nx-label !text-drl-cyan">← tú</span>}
                  </Link>
                </td>
                <td className="px-3 py-2">{e.rank && <RankInline rank={e.rank} />}</td>
                <td className="nx-readout px-3 py-2 text-right text-[15px] text-white">{e.rating}</td>
                <td className="px-3 py-2 text-right tabular-nums text-white/60">{e.season ? `${e.season.wins}–${e.season.losses}${e.season.draws > 0 ? `–${e.season.draws}` : ""}` : `${e.wins}–${e.losses}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Móvil: tarjetas, ≥44 px. */}
      <ol className="space-y-1.5 sm:hidden" aria-label={title ?? "Escalera"}>
        {entries.map((e) => (
          <li key={e.userId} aria-current={e.isSelf ? "true" : undefined}>
            <Link
              href={href(e)}
              className={cn(
                "nx-focus nx-clip-sm flex min-h-[52px] items-center gap-3 border px-3 py-2",
                e.isSelf ? "border-drl-cyan/60 bg-drl-cyan/[0.10]" : "border-white/[0.09] bg-white/[0.02]",
              )}
            >
              <span className="nx-readout w-11 shrink-0 text-[14px] text-white/70">#{e.position}</span>
              <span aria-hidden className="shrink-0">{e.avatar}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-white">{e.username}{e.isSelf && <span className="nx-label ml-2 !text-drl-cyan">← tú</span>}</span>
                {e.rank && <RankInline rank={e.rank} className="mt-0.5 max-w-full" />}
              </span>
              <span className="text-right">
                <span className="nx-readout block text-[15px] text-white">{e.rating}</span>
                <span className="block text-[11px] tabular-nums text-white/45">{e.season ? `${e.season.wins}–${e.season.losses}${e.season.draws > 0 ? `–${e.season.draws}` : ""}` : `${e.wins}–${e.losses}`}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
