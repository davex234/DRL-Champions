"use client";

/**
 * F83 · MOMENTOS DE TEMPORADA: subida de nivel (UNA celebración aunque se suban varios niveles a la vez) y el resumen
 * post-partida (+XP de la partida y de los retos, barra de nivel, retos tocados). Todo sale del servidor: el
 * post-partida lee la ruta y localiza en el libro mayor los asientos de ESTA partida.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { Plate } from "@/components/ui/Surface";
import { Meter } from "@/components/ui/Meter";
import { useAuth } from "@/lib/supabase/auth";
import { fetchSeasonTrack, type SeasonOverview } from "@/lib/seasonTrack/client";
import { matchGain } from "@/domain/seasonTrack/view";

const fmt = (n: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always" } as Intl.NumberFormatOptions).format(n);

export function SeasonLevelUp({ from, to, rewards, onClose }: { from: number; to: number; rewards: number; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    btn.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const n = to - from;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 px-4 backdrop-blur-sm" data-testid="season-levelup" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="season-levelup-title" onClick={(e) => e.stopPropagation()}
        className="nx-clip relative w-full max-w-sm overflow-hidden border border-drl-gold/40 bg-[#0b0e17] px-6 py-8 text-center">
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 50% at 50% 0%, rgba(255,206,79,0.28), transparent 70%)" }} />
        <p className="relative font-display text-[12px] font-bold uppercase tracking-[0.3em] text-drl-gold">Subes de nivel</p>
        <p id="season-levelup-title" className="relative mt-2 font-display text-[84px] font-black leading-none text-white">{to}</p>
        {n > 1 && <p className="relative mt-1 font-display text-[14px] font-bold uppercase tracking-[0.14em] text-white/70">+{n} niveles</p>}
        <p className="relative mt-3 text-[14px] text-white/70">{rewards > 0 ? (rewards === 1 ? "Tienes una recompensa nueva para reclamar." : `Tienes ${rewards} recompensas para reclamar.`) : "Sigue sumando XP de temporada."}</p>
        <div className="relative mt-6 flex flex-wrap justify-center gap-2">
          {rewards > 0 && <Link href="/temporada/pase#ruta" className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center bg-drl-gold px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-[#221703]">Ver la ruta</Link>}
          <button ref={btn} type="button" onClick={onClose} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-white/20 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white">Continuar</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Post-partida: lee la ruta (una petición; reintenta una vez por si el gancho aún escribía) y enseña lo que dejó la
 * partida `matchId`. Sin temporada activa, o sin XP de esta partida (privada, abandonada, jugada por el reloj), no pinta nada.
 */
export function SeasonPostMatch({ matchId, className }: { matchId: string; className?: string }) {
  const { user } = useAuth();
  const [data, setData] = useState<SeasonOverview | null>(null);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (async () => {
      for (let i = 0; i < 2 && alive; i++) {
        try {
          const o = await fetchSeasonTrack();
          if (!alive) return;
          if (o.phase !== "ACTIVE") return;
          if (matchGain(o, matchId) || i === 1) { setData(o); return; }
        } catch { return; }
        await new Promise((r) => setTimeout(r, 1200));
      }
    })();
    return () => { alive = false; };
  }, [matchId, user]);
  return data ? <SeasonPostMatchView data={data} matchId={matchId} className={className} /> : null;
}

/** La pieza visual del post-partida (sin red): la usan `SeasonPostMatch`, el arnés y los tests. */
export function SeasonPostMatchView({ data, matchId, className }: { data: SeasonOverview; matchId: string; className?: string }) {
  const [moment, setMoment] = useState(false);
  const g = matchGain(data, matchId);
  useEffect(() => { if (g && g.levelAfter > g.levelBefore) setMoment(true); }, [g?.levelAfter, g?.levelBefore]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g || !data.progress) return null;
  const p = data.progress;
  const touched = [...(data.daily?.challenges ?? []), ...(data.weekly?.challenges ?? [])].filter((c) => c.progress > 0).slice(0, 3);
  return (
    <>
      <Plate className={cn("p-4", className)} data-testid="season-postmatch" data-xp={g.matchXp + g.challengeXp}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="nx-label">Ruta de temporada</span>
          <span className="font-display text-[20px] font-bold tabular-nums text-drl-gold">+{fmt(g.matchXp + g.challengeXp)} XP</span>
        </div>
        {g.challengeXp > 0 && <p className="mt-1 text-[12px] text-white/60">Partida +{fmt(g.matchXp)} · {g.challenges === 1 ? "reto completado" : `${g.challenges} retos completados`} +{fmt(g.challengeXp)}</p>}
        <div className="mt-3 flex justify-between text-[12px] text-white/60"><span>Nivel {p.level}</span><span className="tabular-nums">{p.isMax ? "Máximo" : `${fmt(p.xpIntoLevel)} / ${fmt(p.xpForNext)}`}</span></div>
        <Meter value={Math.round(p.progress * 100)} tone="gold" height={6} label={`Nivel ${p.level}`} className="mt-1" />
        {touched.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12px] text-white/70">
            {touched.map((c) => <li key={c.id} className="flex justify-between gap-2"><span className="truncate">{c.label}</span><span className="tabular-nums">{c.completed ? "✓" : `${c.progress}/${c.target}`}</span></li>)}
          </ul>
        )}
        <Link href="/temporada/pase" className="nx-focus nx-action mt-3 inline-flex min-h-[44px] items-center">Ver la ruta de temporada</Link>
      </Plate>
      {moment && <SeasonLevelUp from={g.levelBefore} to={g.levelAfter} rewards={data.claimable.length} onClose={() => setMoment(false)} />}
    </>
  );
}
