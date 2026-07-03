"use client";

/**
 * CEREMONIA FINAL — no una tabla, un cierre de FINAL. Reúne lo que los motores ya
 * produjeron (Match, Narrative, Economy, Reward) en una pantalla espectacular:
 * ganador, marcador, MVP, revelación, momento del partido, punto de inflexión,
 * gráfico de momentum, nota del entrenador y resumen IA + recompensas. Solo MUESTRA.
 */
import { useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { MatchState } from "@/match";
import type { MatchReward } from "@/lib/match/rewards";
import { coachRating, utilityStory } from "@/lib/match/moments";
import { matchCompositions } from "@/lib/match/lineups";
import { playCue } from "@/lib/sound";
import { cn } from "@/lib/format";
import { useGameStore } from "@/store/useGameStore";

const GRADE_HEX: Record<string, string> = { S: "#ffce4f", A: "#37e6a0", B: "#19e3ff", C: "#ffd35c", D: "#ff6b6b" };

export function MatchCeremony({ match, reward, onAgain, onCollection }: {
  match: MatchState;
  reward: MatchReward | null;
  onAgain: () => void;
  onCollection: () => void;
}) {
  const won = match.winner === "home";
  const names = match.config.teamNames ?? { home: "Local", away: "Rival" };
  const ns = match.narrative;
  const rating = coachRating(match);
  const comp = matchCompositions(match.config.rosters.home, match.config.rosters.away);
  const utilBeat = utilityStory(match);

  useEffect(() => { playCue(won ? "victory" : "defeat"); }, [won]);

  // foto del MVP por nombre (de cualquiera de los dos rosters)
  const imgByName = new Map<string, string | undefined>();
  for (const r of [...match.config.rosters.home, ...match.config.rosters.away]) imgByName.set(r.name, r.meta?.image);
  const mvpName = match.mvp?.name ?? ns?.summary.mvp ?? null;

  // revelación = héroe que no es el MVP, si lo hay
  const breakout = ns?.heroes.find((h) => h.name !== mvpName) ?? ns?.heroes[0] ?? null;
  const villain = ns?.villains?.[0] ?? null;
  const keyMoment = ns?.keyMoments[0] ?? null;
  const accent = won ? "#37e6a0" : "#ff4d6a";
  const record = useGameStore((s) => s.record);

  return (
    <div className="animate-rise space-y-4">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-8 text-center"
        style={{ background: `radial-gradient(120% 120% at 50% -10%, ${accent}22, #0a0e14 70%)` }}>
        <ShineSweep />
        <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="font-display text-sm uppercase tracking-[0.5em]" style={{ color: accent }}>
          {won ? "Victoria" : "Derrota"}
        </motion.p>
        <motion.h1 initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}
          className="mt-1 font-display text-3xl font-black uppercase tracking-wide text-white md:text-4xl">
          {won ? names.home : names.away}
        </motion.h1>
        <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15, type: "spring", stiffness: 140, damping: 14 }}
          className="mt-2 font-display text-6xl font-black tabular-nums text-white md:text-7xl">
          {match.score.home}<span className="px-2 text-white/25">–</span>{match.score.away}
        </motion.div>
        <p className="mt-2 text-sm text-white/50">{names.home} vs {names.away} · {match.history.length} rondas</p>
        {ns?.summary.headline && <p className="mx-auto mt-2 max-w-lg text-sm text-white/75">{ns.summary.headline}</p>}
      </div>

      {/* DESTACADOS */}
      <div className="grid gap-3 sm:grid-cols-3">
        <HeroCard title="MVP del partido" accent="#ffce4f" image={mvpName ? imgByName.get(mvpName) : undefined}
          name={mvpName ?? "—"} sub={`${match.mvp?.kills ?? 0} bajas`} />
        <HeroCard title="Revelación" accent="#19e3ff" image={breakout ? imgByName.get(breakout.name) : undefined}
          name={breakout?.name ?? "—"} sub={breakout?.reason ?? "—"} />
        <div className="rounded-2xl border border-white/10 bg-base-800/60 p-4">
          <p className="text-[10px] uppercase tracking-widest text-white/40">Nota del entrenador</p>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-display text-5xl font-black leading-none" style={{ color: GRADE_HEX[rating.grade] }}>{rating.grade}</span>
            <div>
              <p className="font-display text-sm font-bold text-white">{rating.label}</p>
              <p className="text-[11px] text-white/45">Táctica {rating.tactical} · {Math.round(rating.roundWinRate * 100)}% rondas · {rating.variety} estrategias</p>
            </div>
          </div>
        </div>
      </div>

      {/* MOMENTUM + MOMENTO CLAVE */}
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-base-800/60 p-4">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-white/40">Momentum del partido</p>
          {ns && ns.momentum.series.length > 1
            ? <MomentumGraph series={ns.momentum.series} homeIsA={homeIsA(match)} />
            : <p className="text-sm text-white/40">Sin datos de momentum.</p>}
          <div className="mt-1 flex justify-between text-[9px] uppercase tracking-widest text-white/30">
            <span>R1</span><span>{ns?.summary.turningPoint != null ? `Inflexión: R${ns.summary.turningPoint}` : ""}</span><span>R{match.history.length}</span>
          </div>
        </div>
        <div className="space-y-3">
          <InfoCard title="Momento del partido">
            {keyMoment ? <p className="text-sm text-white/80">R{keyMoment.event.round} · {keyMoment.why}</p> : <p className="text-white/40">—</p>}
          </InfoCard>
          <InfoCard title="Estilo y forma">
            <p className="text-sm font-bold text-white">{comp.ours.archetypeLabel}</p>
            <p className="mt-0.5 text-[12px] text-white/60">{comp.ours.playstyle.slice(0, 2).join(" · ")}</p>
            <p className="mt-1 border-t border-white/10 pt-1 text-[12px] text-white/50">{ns?.match.shape.descriptors.join(" · ") || ns?.match.shape.id || "—"}</p>
            {utilBeat && <p className="mt-1 text-[12px] text-amber-200/80">⚙ {utilBeat}</p>}
          </InfoCard>
          <InfoCard title="Resumen IA">
            <p className="text-[13px] leading-snug text-white/70">{ns?.summary.beats[0]?.text ?? ns?.summary.headline ?? "—"}</p>
            {villain && <p className="mt-1 border-t border-white/10 pt-1 text-[12px] text-rose-300/80">Villano: <b className="text-white/80">{villain.name}</b> · {villain.reason}</p>}
          </InfoCard>
        </div>
      </div>

      {/* RECOMPENSAS */}
      {reward && (
        <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
          <Reward label="Créditos" value={`+${reward.credits}`} />
          <Reward label="Experiencia" value={`+${reward.xp} XP`} />
          <Reward label="Bajas del equipo" value={String(reward.teamKills)} />
          <Reward label="Récord" value={`${record.won}-${record.lost}`} />
          {record.streak > 1 && <Reward label="Racha" value={`🔥 ${record.streak}`} />}
        </div>
      )}

      {/* BOTONES */}
      <div className="flex flex-wrap gap-3">
        <button onClick={() => { playCue("ui"); onAgain(); }}
          className="flex-1 rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
          Revancha ▸
        </button>
        <button disabled title="Próximamente"
          className="rounded-xl border border-white/10 px-5 py-3.5 font-display text-sm uppercase tracking-wide text-white/30 cursor-not-allowed">
          Guardar replay
        </button>
        <Link href="/coleccion" onClick={onCollection}
          className="rounded-xl border border-white/15 bg-white/5 px-5 py-3.5 font-display text-sm uppercase tracking-wide text-white/70 transition hover:bg-white/10">
          Ir a la colección
        </Link>
      </div>
    </div>
  );
}

/** ¿El equipo home corresponde al equipo "A" de la narrativa? (para orientar el momentum). */
function homeIsA(match: MatchState): boolean {
  const ns = match.narrative;
  if (!ns) return true;
  const homeNames = new Set(match.config.rosters.home.map((r) => r.name));
  return ns.match.teams.A.players.some((n) => homeNames.has(n));
}

function MomentumGraph({ series, homeIsA }: { series: { round: number; value: number }[]; homeIsA: boolean }) {
  const W = 600, H = 90, mid = H / 2;
  const n = series.length;
  // valor +100 = control de A; lo orientamos para que ARRIBA/verde sea el equipo home
  const val = (v: number) => (homeIsA ? v : -v);
  const pts = series.map((p, i) => {
    const x = (i / (n - 1)) * W;
    const y = mid - (val(p.value) / 100) * (mid - 6);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${mid} ${line} ${W},${mid}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
      <defs>
        <linearGradient id="mom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#37e6a0" stopOpacity="0.35" />
          <stop offset="50%" stopColor="#37e6a0" stopOpacity="0.02" />
          <stop offset="50%" stopColor="#ff4d6a" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#ff4d6a" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <line x1="0" y1={mid} x2={W} y2={mid} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 4" />
      <motion.polygon points={area} fill="url(#mom)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
      <motion.polyline points={line} fill="none" stroke="#e8eef5" strokeWidth="2" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeOut" }} />
    </svg>
  );
}

function ShineSweep() {
  return (
    <motion.div initial={{ x: "-120%" }} animate={{ x: "220%" }} transition={{ duration: 1.4, ease: "easeOut" }}
      className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-white/5" />
  );
}

function HeroCard({ title, accent, image, name, sub }: { title: string; accent: string; image?: string; name: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-base-800/60 p-4">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5" style={{ boxShadow: `0 0 18px ${accent}44` }}>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={name} className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>{title}</p>
        <p className="truncate font-display text-lg font-bold uppercase text-white">{name}</p>
        <p className="truncate text-[11px] text-white/45">{sub}</p>
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-base-800/60 p-4">
      <p className="mb-1 text-[10px] uppercase tracking-widest text-white/40">{title}</p>
      {children}
    </div>
  );
}

function Reward({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="font-display text-2xl font-black text-amber-200">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
    </div>
  );
}
