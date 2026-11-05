"use client";

/**
 * NOTICIAS — feed in-game de cartas nuevas / MVPs / ediciones, generado automáticamente
 * por el DRL Data Engine + capa Intel. Solo MUESTRA `useNewsStore`. Marca como leídas al
 * entrar. Es la cara visible de "me voy a dormir y al despertar hay novedades".
 */
import { useEffect } from "react";
import Link from "next/link";
import { useNewsStore } from "@/store/useNewsStore";
import type { NewsItem } from "@/intel";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("noticias");

/**
 * Los titulares del mundo se guardan en español canónico como «CABECERA: sujeto» (`world/news`). Si el titular entero
 * no está en el catálogo, se traduce la cabecera y se deja el sujeto (un equipo, un jugador) como llega.
 */
function newsTitle(title: string): string {
  const whole = td(title);
  const cut = title.indexOf(": ");
  if (whole !== title || cut <= 0) return whole;
  return `${td(title.slice(0, cut))}: ${td(title.slice(cut + 2))}`;
}

const KIND_ACCENT: Record<string, string> = {
  special: "#ffce4f", card: "#19e3ff", record: "#ff2e63", transfer: "#37e6a0", event: "#7b5cff",
};

export default function NoticiasPage() {
  useLocale();
  const items = useNewsStore((s) => s.items);
  const markSeen = useNewsStore((s) => s.markSeen);
  useEffect(() => { markSeen(); }, [markSeen]);

  return (
    <section className="animate-rise space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">{tr("Noticias")}</h1>
          <p className="mt-1 text-white/50">{tr("Cartas, MVPs y ediciones generadas automáticamente desde los torneos.")}</p>
        </div>
        <Link href="/coleccion" className="rounded-lg border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/70 transition hover:bg-white/10">
          {tr("Ver colección →")}
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-base-700/30 p-10 text-center">
          <p className="text-3xl">📰</p>
          <p className="mt-2 text-white/55">{tr("Aún no hay noticias. Cuando finalice un torneo, las cartas y MVPs aparecerán aquí solos.")}</p>
          <Link href="/admin/data-engine" className="nx-action mt-3 !text-sm !normal-case !tracking-normal">{tr("Abrir el motor de datos (admin)")}</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((n) => <NewsCard key={n.id} n={n} />)}
        </div>
      )}
    </section>
  );
}

function NewsCard({ n }: { n: NewsItem }) {
  useLocale();
  const accent = KIND_ACCENT[n.kind] ?? "#19e3ff";
  return (
    <article className="relative overflow-hidden rounded-2xl border border-white/10 bg-base-700/40 p-4 transition hover:bg-base-700/60">
      <div className="absolute left-0 top-0 h-full w-1" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold uppercase text-white">{newsTitle(n.title)}</h2>
            {n.rarity && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: `${accent}22`, color: accent }}>{td(n.rarity)}</span>}
          </div>
          <p className="mt-1 text-sm text-white/60">{td(n.body)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {n.tags.slice(0, 5).map((t, i) => (
              <span key={i} className={cn("rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/45")}>{td(t)}</span>
            ))}
          </div>
        </div>
        {n.player && <span className="shrink-0 rounded-lg bg-white/5 px-2 py-1 font-display text-xs text-white/70">{n.player}</span>}
      </div>
    </article>
  );
}
