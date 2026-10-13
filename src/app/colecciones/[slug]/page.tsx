"use client";

/**
 * Colección — página PÚBLICA (escaparate compartible por URL `/colecciones/{slug}`).
 *
 * Muestra la colección completa: premiados destacados (MVP/Champion/Top…) y el
 * grid de todas las cartas miembro. No requiere login; lee de Supabase (RLS
 * pública) con fallback al proveedor local. Si hay estado local, añade mi progreso.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { useGameStore } from "@/store/useGameStore";
import { getCard } from "@/data/catalog";
import { collectionBySlug } from "@/lib/collections/repos";
import { collectionProgress } from "@/domain/collections/progress";
import { rewardSummary } from "@/lib/collections/format";
import type { CollectionDef } from "@/domain/collections/types";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("colecciones");

export default function CollectionShowcasePage() {
  return (
    <HydrationGate>
      <Showcase />
    </HydrationGate>
  );
}

function Showcase() {
  useLocale();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const ownedCards = useGameStore((s) => s.ownedCards);
  const ownedIds = useMemo(() => new Set(ownedCards.map((o) => o.cardId)), [ownedCards]);

  const [def, setDef] = useState<CollectionDef | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    collectionBySlug(slug).then((d) => { if (alive) { setDef(d); setLoading(false); } });
    return () => { alive = false; };
  }, [slug]);

  if (loading) return <p className="text-white/40">{t("Cargando colección…")}</p>;
  if (!def) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-center">
        <div>
          <p className="font-display text-2xl font-bold uppercase text-white">{t("Colección no encontrada")}</p>
          <Link href="/colecciones" className="mt-3 inline-block text-drl hover:underline">{t("← Ver todas")}</Link>
        </div>
      </div>
    );
  }

  const prog = collectionProgress(def, ownedIds);
  // Destacados: premios estadísticos + MVP/Champion (por categoría de los items).
  const specials = def.items.filter((i) => i.category !== "player");

  return (
    <section className="animate-rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/colecciones" className="text-xs text-white/40 hover:text-white">{t("← Colecciones")}</Link>
          <h1 className="font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">{td(def.name)}</h1>
          <p className="mt-1 text-white/50">
            {t("{tipo}{tier} · {n} cartas · 🎁 {premio}", {
              tipo: def.source === "tournament" ? t("Colección de torneo") : t("Colección de evento"),
              tier: def.tier ? ` · ${def.tier}` : "",
              n: def.items.length,
              premio: rewardSummary(def.reward),
            })}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-base-700/60 px-5 py-3 text-center">
          <p className="text-[10px] uppercase tracking-widest text-white/40">{t("Mi progreso")}</p>
          <p className="font-display text-2xl font-bold text-drl-cyan">{prog.pct}%</p>
          <p className="text-[11px] text-white/40">{prog.owned}/{prog.total}</p>
        </div>
      </header>

      {/* Premiados destacados */}
      {specials.length > 0 && (
        <div>
          <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">{t("Premiados")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {specials.map((it) => (
              <Tile key={it.cardId} cardId={it.cardId} label={td(it.label)}
                badge={categoryLabel(it.category)} owned={ownedIds.has(it.cardId)} />
            ))}
          </div>
        </div>
      )}

      {/* Todas las cartas */}
      <div>
        <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
          {t("Cartas")} <span className="text-white/40">({def.items.length})</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {def.items.map((it) => (
            <Tile key={it.cardId} cardId={it.cardId} label={td(it.label)} owned={ownedIds.has(it.cardId)} />
          ))}
        </div>
      </div>
    </section>
  );
}

const AWARD_LABELS: Record<string, string> = {
  mvp: "MVP", champion: "Champion", rookie: "Rookie", clutch: "Clutch",
  "top-acs": "Top ACS", "top-rating": "Top Rating", "top-hs": "Top HS%",
  "top-kills": "Top Kills", "top-assist": "Top Assist",
};
function categoryLabel(category: string): string {
  return AWARD_LABELS[category] ?? category;
}

/** Tarjeta: PlayerCard si la carta existe en el catálogo; si no, placeholder. */
function Tile({ cardId, label, owned, badge }: { cardId: string; label: string; owned: boolean; badge?: string }) {
  useLocale();
  const card = getCard(cardId);
  return (
    <div className={cn("relative rounded-xl", !owned && "opacity-60")}>
      {badge && (
        <span className="absolute -top-1 left-1 z-10 rounded-full bg-drl px-2 py-0.5 text-[10px] font-bold uppercase text-white shadow-glow">
          {td(badge)}
        </span>
      )}
      {card ? (
        <PlayerCard card={card} size="sm" interactive={false} />
      ) : (
        <div className="grid aspect-[3/4] place-items-center rounded-xl border border-white/10 bg-base-700/50 p-2 text-center">
          <span className="text-xs text-white/50">{td(label)}</span>
        </div>
      )}
      {!owned && (
        <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white/70">🔒</span>
      )}
    </div>
  );
}
