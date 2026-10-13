"use client";

/**
 * F85 · COMPARAR — lado a lado, con SOLO datos públicos del perfil F89 (la misma proyección pública para los dos lados).
 * Sin puntuación compuesta, sin porcentajes de «quién es mejor», sin ganadores marcados: cada fila enseña los dos valores
 * reales y ya está. Un dato que no existe se dice («—»), no se rellena.
 */
import Link from "next/link";
import type { SocialCompare, CompareSide } from "@/server/services/social";
import { playerHref } from "@/lib/player/href";
import { CompetitiveEmblem } from "@/components/competitive/ranked/CompetitiveEmblem";

const fmt = (n: number) => new Intl.NumberFormat("es-ES").format(n);

function Head({ s, align }: { s: CompareSide; align: "left" | "right" }) {
  return (
    <div className={`flex min-w-0 flex-col items-center gap-2 ${align === "right" ? "sm:items-end" : "sm:items-start"}`}>
      <span aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-white/[0.06] text-3xl">{s.player.avatar}</span>
      <Link href={playerHref(s.player.userId)} className="nx-focus -my-2 max-w-full truncate py-2 font-display text-[16px] font-bold uppercase tracking-wide text-white hover:underline">{s.player.username}</Link>
      <CompetitiveEmblem rank={s.rank?.rank ?? null} state={s.rank?.state ?? "UNRANKED"} placement={s.rank?.state === "PLACEMENT" ? parsePlacement(s.rank.label) : undefined} size="sm" animate={false} />
      <span className="font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white/75">{s.rank?.label ?? "Sin clasificar"}</span>
    </div>
  );
}
const parsePlacement = (label: string) => { const m = /(\d+)\/(\d+)/.exec(label); return m ? { played: Number(m[1]), total: Number(m[2]) } : undefined; };

export function CompareView({ data }: { data: SocialCompare }) {
  const { you, them } = data;
  const rows: { k: string; label: string; a: string; b: string }[] = [
    { k: "rating", label: "Rating ranked", a: you.rating !== null ? String(you.rating) : "—", b: them.rating !== null ? String(them.rating) : "—" },
    { k: "season", label: "Nivel de temporada", a: you.seasonLevel !== null ? String(you.seasonLevel) : "—", b: them.seasonLevel !== null ? String(them.seasonLevel) : "—" },
    { k: "matches", label: "Partidas públicas", a: fmt(you.matches), b: fmt(them.matches) },
    { k: "winrate", label: "% victorias", a: you.winrate !== null ? `${you.winrate}%` : "—", b: them.winrate !== null ? `${them.winrate}%` : "—" },
    { k: "cards", label: "Cartas distintas", a: `${fmt(you.uniqueCards)} / ${fmt(you.totalCards)}`, b: `${fmt(them.uniqueCards)} / ${fmt(them.totalCards)}` },
    { k: "collections", label: "Colecciones completadas", a: fmt(you.collectionsCompleted), b: fmt(them.collectionsCompleted) },
    { k: "badges", label: "Insignias destacadas", a: fmt(you.badges), b: fmt(them.badges) },
  ];
  return (
    <section className="mx-auto w-full max-w-3xl space-y-5" data-scene="social-compare" aria-labelledby="compare-title">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="font-display text-label uppercase tracking-wide2 text-drl">Social · comparar</span>
          <h1 id="compare-title" className="mt-1 font-display text-2xl font-bold uppercase tracking-wide text-white">Tú y {them.player.username}</h1>
          <p className="mt-1 text-sm text-ink-muted">Solo datos públicos de los dos perfiles. Sin puntuaciones inventadas.</p>
        </div>
        <Link href="/social" className="nx-action">‹ Social</Link>
      </header>
      <div className="nx-clip grid grid-cols-2 gap-4 border border-white/10 bg-white/[0.02] p-4 sm:p-6">
        <Head s={you} align="left" />
        <Head s={them} align="right" />
      </div>
      <table className="w-full table-fixed border-collapse text-sm" data-testid="compare-table">
        <caption className="sr-only">Comparación lado a lado</caption>
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-white/40">
            <th scope="col" className="w-1/3 py-2 text-left font-medium">Tú</th>
            <th scope="col" className="w-1/3 py-2 text-center font-medium">Dato</th>
            <th scope="col" className="w-1/3 py-2 text-right font-medium">{them.player.username}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t border-white/[0.06]" data-row={r.k}>
              <td className="nx-readout py-3 text-left text-[16px] text-white">{r.a}</td>
              <th scope="row" className="py-3 text-center text-[12px] font-normal text-white/55">{r.label}</th>
              <td className="nx-readout py-3 text-right text-[16px] text-white">{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-white/35">Partidas públicas = ranked, contra la IA y Draft (los duelos amistosos no cuentan). Las cartas son conteos: el inventario sigue siendo privado.</p>
    </section>
  );
}
