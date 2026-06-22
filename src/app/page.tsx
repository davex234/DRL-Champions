"use client";

import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { levelFromXp } from "@/domain/progression/levels";
import { collectionStats, squadRating } from "@/store/selectors";
import { getCard } from "@/data/catalog";
import { PACKS } from "@/data/packs";
import { formatCredits } from "@/lib/format";

export default function HomePage() {
  return (
    <HydrationGate>
      <Dashboard />
    </HydrationGate>
  );
}

function Dashboard() {
  const xp = useGameStore((s) => s.xp);
  const credits = useGameStore((s) => s.credits);
  const ownedCards = useGameStore((s) => s.ownedCards);
  const unopenedPacks = useGameStore((s) => s.unopenedPacks);
  const packsOpened = useGameStore((s) => s.packsOpened);

  const level = levelFromXp(xp);
  const stats = collectionStats(ownedCards);
  const squad = squadRating(ownedCards);
  const totalUnopened = Object.values(unopenedPacks).reduce((a, b) => a + b, 0);

  const recent = [...ownedCards]
    .sort((a, b) => b.obtainedAt - a.obtainedAt)
    .slice(0, 6)
    .map((o) => ({ o, def: getCard(o.cardId) }))
    .filter((x) => x.def);

  const featured = PACKS.filter((p) => ["premium", "prime", "icon"].includes(p.id));

  return (
    <div className="animate-rise space-y-8">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-base-700/80 to-base-800/80 p-6 md:p-10">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-drl/20 blur-3xl" />
        <div className="absolute -bottom-24 left-10 h-64 w-64 rounded-full bg-drl-cyan/10 blur-3xl" />
        <div className="relative">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-drl">
            Bienvenido, Champion
          </p>
          <h1 className="mt-2 max-w-xl font-display text-4xl font-bold uppercase leading-tight text-white md:text-5xl">
            Colecciona a las leyendas de <span className="text-drl text-glow">Valorant</span>
          </h1>
          <p className="mt-3 max-w-lg text-white/60">
            Abre sobres, consigue cartas legendarias, completa colecciones y domina el mercado.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/tienda"
              className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110"
            >
              Abrir sobres
            </Link>
            <Link
              href="/coleccion"
              className="rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-display text-sm uppercase tracking-wide text-white transition hover:bg-white/10"
            >
              Mi colección
            </Link>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Nivel" value={String(level.level)} sub={`${Math.round(level.progress * 100)}% al ${level.level + 1}`} accent="#19e3ff" progress={level.progress} />
        <StatCard label="Colección" value={`${stats.percent}%`} sub={`${stats.distinct} / ${stats.total} cartas`} accent="#37e6a0" progress={stats.percent / 100} />
        <StatCard label="OVR Plantilla" value={squad ? String(squad) : "—"} sub="media de tus cartas" accent="#ffd35c" />
        <StatCard label="Sobres" value={String(totalUnopened)} sub={`${packsOpened} abiertos`} accent="#ff2e63" />
      </section>

      {/* RECIENTES */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
            Últimas cartas
          </h2>
          <Link href="/coleccion" className="text-sm text-drl hover:underline">
            Ver todas →
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-wrap gap-4">
            {recent.map(({ o, def }) => (
              <PlayerCard key={o.uid} card={def!} size="sm" serial={o.serial} />
            ))}
          </div>
        )}
      </section>

      {/* SOBRES DESTACADOS */}
      <section>
        <h2 className="mb-4 font-display text-xl font-bold uppercase tracking-wide text-white">
          Sobres destacados
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {featured.map((pack) => (
            <Link
              key={pack.id}
              href="/tienda"
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-base-700/50 p-5 transition hover:-translate-y-1"
            >
              <div
                className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40"
                style={{ background: pack.accent }}
              />
              <h3 className="font-display text-lg font-bold uppercase text-white">{pack.name}</h3>
              <p className="mt-1 text-sm text-white/50">{pack.description}</p>
              <p className="mt-3 font-display font-bold text-drl-gold">
                {pack.price === 0 ? "GRATIS" : `🪙 ${formatCredits(pack.price)}`}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  progress,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  progress?: number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/50 p-4">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold" style={{ color: accent }}>
        {value}
      </p>
      <p className="text-xs text-white/45">{sub}</p>
      {progress != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: accent }} />
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-base-700/30 p-10 text-center">
      <p className="text-white/50">Todavía no tienes cartas.</p>
      <Link
        href="/tienda"
        className="mt-3 inline-block rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm uppercase tracking-wide text-white shadow-glow"
      >
        Abre tu primer sobre gratis
      </Link>
    </div>
  );
}
