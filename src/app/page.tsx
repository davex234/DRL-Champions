"use client";

/**
 * HUB del juego — el INICIO ya no vende cromos: es el lanzador del manager. Centra la
 * experiencia en JUGAR (entrenador), muestra tu plantilla activa, tu récord de carrera
 * y el bucle (jugar → recompensas → mejorar → jugar). Solo CONSUME datos existentes
 * (game store, team store, selectores). Sin motores nuevos.
 */
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useNewsStore } from "@/store/useNewsStore";
import { useTeamStore, resolveCardRef } from "@/store/useTeamStore";
import { validateTeam } from "@/domain/teams/types";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { BrandMark } from "@/branding/Logo";
import { levelFromXp } from "@/domain/progression/levels";
import { collectionStats } from "@/store/selectors";
import { cardView, type CardView } from "@/lib/match/cardView";
import { PACKS } from "@/data/packs";
import { formatCredits, cn } from "@/lib/format";

export default function HomePage() {
  return (
    <HydrationGate>
      <Hub />
    </HydrationGate>
  );
}

function Hub() {
  const xp = useGameStore((s) => s.xp);
  const credits = useGameStore((s) => s.credits);
  const ownedCards = useGameStore((s) => s.ownedCards);
  const record = useGameStore((s) => s.record);
  const unopenedPacks = useGameStore((s) => s.unopenedPacks);
  const news = useNewsStore((s) => s.items).slice(0, 3);

  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const active = teams.find((t) => t.id === activeTeamId) ?? teams[0] ?? null;
  const ready = active != null && validateTeam(active, resolveCardRef).length === 0;

  const level = levelFromXp(xp);
  const stats = collectionStats(ownedCards);
  const totalUnopened = Object.values(unopenedPacks).reduce((a, b) => a + b, 0);

  const byUid = new Map(ownedCards.map((o) => [o.uid, o]));
  const starters = (active?.starters ?? [])
    .map((uid) => byUid.get(uid))
    .map((o) => (o ? cardView(o) : null))
    .filter((v): v is CardView => v != null);
  const teamOvr = starters.length ? Math.round(starters.reduce((a, c) => a + c.ovr, 0) / starters.length) : 0;

  // CTA adaptativo = onboarding/bucle guiado.
  const cta =
    ownedCards.length === 0 ? { label: "Abre tu primer sobre", href: "/tienda", hint: "Consigue jugadores para tu plantilla" }
    : !ready ? { label: "Crea tu equipo", href: "/entrenador/equipos", hint: "Forma un quinteto de 5 para competir" }
    : { label: "Jugar partido", href: "/entrenador", hint: `Dirige a ${active!.name}` };

  const winRate = record.played ? Math.round((record.won / record.played) * 100) : 0;
  const featured = PACKS.filter((p) => ["premium", "prime", "icon"].includes(p.id)).slice(0, 3);

  return (
    <div className="animate-rise space-y-6">
      {/* HERO — el partido es el centro */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-base-700/70 to-base-900 p-6 md:p-10">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-drl/20 blur-3xl" />
        <div className="absolute -bottom-28 left-10 h-72 w-72 rounded-full bg-drl-cyan/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-drl">
              <BrandMark size={26} />
              <p className="font-display text-xs uppercase tracking-[0.35em]">DRL Champions</p>
            </div>
            <h1 className="mt-3 max-w-xl font-display text-4xl font-black uppercase leading-[0.95] text-white md:text-6xl">
              No disparas.<br /><span className="text-drl text-glow">Piensas.</span>
            </h1>
            <p className="mt-3 max-w-md text-white/55">
              Eres el entrenador de un equipo profesional de Valorant. Prepara, lee al rival, decide cada ronda y gana.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href={cta.href}
                className="group rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-7 py-3.5 font-display text-base font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110 hover:-translate-y-0.5">
                ▸ {cta.label}
              </Link>
              <Link href="/coleccion"
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-3.5 font-display text-sm uppercase tracking-wide text-white/80 transition hover:bg-white/10">
                Mejorar plantilla
              </Link>
              <span className="text-xs text-white/40">{cta.hint}</span>
            </div>
          </div>

          {/* Récord de carrera */}
          <div className="shrink-0 rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur-sm md:w-64">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Tu carrera</p>
            <p className="mt-1 font-display text-4xl font-black text-white">
              {record.won}<span className="text-white/25"> - </span>{record.lost}
            </p>
            <p className="text-xs text-white/45">{record.played} partidos · {winRate}% victorias</p>
            <div className="mt-3 flex gap-2">
              <Mini label="Racha" value={record.streak > 0 ? `🔥 ${record.streak}` : "—"} />
              <Mini label="Mejor" value={record.best > 0 ? String(record.best) : "—"} />
            </div>
          </div>
        </div>
      </section>

      {/* PLANTILLA ACTIVA + PROGRESIÓN */}
      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-base-700/40 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-white">Tu equipo</p>
            <Link href="/entrenador/equipos" className="text-xs text-drl hover:underline">Gestionar →</Link>
          </div>
          {active && starters.length > 0 ? (
            <>
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-drl/15 text-xl">{active.logo ?? "🛡️"}</span>
                <div>
                  <p className="font-display text-lg font-bold uppercase text-white">{active.name}</p>
                  <p className="text-[11px] text-white/45">OVR {teamOvr} · {ready ? "Listo para jugar" : "Quinteto incompleto"}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {starters.map((c) => (
                  <div key={c.uid} className="rounded-lg border border-white/10 bg-base-800/60 px-2 py-1.5">
                    <p className="truncate font-display text-xs font-bold uppercase text-white">{c.nick}</p>
                    <p className="text-[10px] text-white/40">{c.role} · {c.ovr}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 bg-base-800/40 p-6 text-center">
              <p className="text-sm text-white/55">{ownedCards.length === 0 ? "Abre sobres para conseguir jugadores." : "Aún no tienes un quinteto."}</p>
              <Link href={ownedCards.length === 0 ? "/tienda" : "/entrenador/equipos"}
                className="mt-3 inline-block rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow">
                {ownedCards.length === 0 ? "Abrir sobre" : "Crear equipo"}
              </Link>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Nivel" value={String(level.level)} sub={`${Math.round(level.progress * 100)}% al ${level.level + 1}`} accent="#19e3ff" progress={level.progress} />
          <Stat label="Créditos" value={formatCredits(credits)} sub="para sobres y mercado" accent="#ffd35c" />
          <Stat label="Colección" value={`${stats.percent}%`} sub={`${stats.distinct}/${stats.total}`} accent="#37e6a0" progress={stats.percent / 100} />
          <Stat label="Sobres" value={String(totalUnopened)} sub="sin abrir" accent="#ff2e63" />
        </div>
      </section>

      {/* EL BUCLE — pasos conectados */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Loop href="/entrenador" icon="🎧" title="Dirige" desc="Prepara, decide y gana rondas" accent="#ff2e63" primary={ready} />
        <Loop href="/coleccion" icon="🗂️" title="Mejora" desc="Refuerza tu quinteto con mejores cartas" accent="#37e6a0" />
        <Loop href="/tienda" icon="🛒" title="Consigue" desc="Abre sobres y amplía tu plantilla" accent="#ffd35c" />
      </section>

      {/* Últimas noticias (generadas automáticamente desde torneos) */}
      {news.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-white/70">📰 Últimas noticias</h2>
            <Link href="/noticias" className="text-xs text-drl hover:underline">Ver todas →</Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {news.map((n) => (
              <Link key={n.id} href="/noticias" className="rounded-xl border border-white/10 bg-base-700/40 p-3 transition hover:bg-base-700/60">
                <p className="line-clamp-2 font-display text-xs font-bold uppercase text-white">{n.title}</p>
                {n.rarity && <p className="mt-1 text-[10px] uppercase tracking-wider text-drl-gold">{n.rarity}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Sobres destacados (secundario) */}
      <section>
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-white/70">Refuerza tu plantilla</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {featured.map((pack) => (
            <Link key={pack.id} href="/tienda"
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-base-700/50 p-5 transition hover:-translate-y-1">
              <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40" style={{ background: pack.accent }} />
              <h3 className="font-display text-lg font-bold uppercase text-white">{pack.name}</h3>
              <p className="mt-1 text-sm text-white/50">{pack.description}</p>
              <p className="mt-3 font-display font-bold text-drl-gold">{pack.price === 0 ? "GRATIS" : `🪙 ${formatCredits(pack.price)}`}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-lg bg-white/5 px-2 py-1.5 text-center">
      <p className="font-display text-sm font-bold text-white">{value}</p>
      <p className="text-[9px] uppercase tracking-widest text-white/35">{label}</p>
    </div>
  );
}

function Stat({ label, value, sub, accent, progress }: { label: string; value: string; sub: string; accent: string; progress?: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/50 p-4">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold" style={{ color: accent }}>{value}</p>
      <p className="text-[11px] text-white/45">{sub}</p>
      {progress != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: accent }} />
        </div>
      )}
    </div>
  );
}

function Loop({ href, icon, title, desc, accent, primary }: { href: string; icon: string; title: string; desc: string; accent: string; primary?: boolean }) {
  return (
    <Link href={href}
      className={cn("group relative overflow-hidden rounded-2xl border p-5 transition hover:-translate-y-1",
        primary ? "border-drl/40 bg-drl/5" : "border-white/10 bg-base-700/40")}>
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-15 blur-2xl transition-opacity group-hover:opacity-35" style={{ background: accent }} />
      <span className="text-2xl">{icon}</span>
      <p className="mt-2 font-display text-lg font-bold uppercase text-white">{title}</p>
      <p className="text-xs text-white/45">{desc}</p>
      {primary && <span className="mt-2 inline-block rounded-full bg-drl/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-drl">recomendado</span>}
    </Link>
  );
}
