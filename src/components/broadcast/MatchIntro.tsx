"use client";

/**
 * INTRO DE PARTIDO — la presentación de "gran final": equipos, quintetos, favorito,
 * underdog, win probability, mapa y storyline. Consume `MatchIntro` (datos puros). Es la
 * antesala cinemática antes del primer saque.
 */
import type { MatchIntro } from "@/broadcast";
import { cn } from "@/lib/format";

function TeamCol({ team, side, fav }: { team: MatchIntro["home"]; side: "home" | "away"; fav: boolean }) {
  const accent = side === "home" ? "#ff2e63" : "#19e3ff";
  return (
    <div className="flex-1 space-y-2 text-center">
      <p className="font-display text-2xl font-black uppercase tracking-wide text-white" style={{ textShadow: `0 0 24px ${accent}66` }}>{team.name}</p>
      {fav && <span className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 font-display text-[9px] uppercase tracking-widest text-amber-200">Favorito</span>}
      <div className="mx-auto inline-flex flex-col gap-1">
        {team.players.map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-[12px]">
            <span className="w-7 text-right font-display tabular-nums text-white/40">{p.ovr}</span>
            <span className="font-display font-bold text-white">{p.name}</span>
            <span className="text-[9px] uppercase tracking-wide text-white/35">{p.role}</span>
          </div>
        ))}
      </div>
      <p className="font-display text-sm text-white/50">Fuerza {team.strength}</p>
    </div>
  );
}

export function MatchIntro({ intro, onStart }: { intro: MatchIntro; onStart: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="w-full max-w-3xl animate-rise space-y-5 rounded-3xl border border-white/10 bg-gradient-to-b from-base-800/90 to-base-900/95 p-6 shadow-2xl">
        <div className="text-center">
          <p className="font-display text-[11px] uppercase tracking-[0.4em] text-drl">NEXUS · {intro.map}</p>
          <p className="mt-1 font-display text-[10px] uppercase tracking-widest text-white/40">Coach {intro.coachMode === "ai" ? "IA" : "manual"}</p>
        </div>

        <div className="flex items-start gap-4">
          <TeamCol team={intro.home} side="home" fav={intro.favorite === "home"} />
          <div className="shrink-0 pt-6 text-center">
            <p className="font-display text-3xl font-black text-white/30">VS</p>
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="font-display font-bold text-rose-300">{intro.winProbability.home}%</span>
              <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-cyan-400/30">
                <div className="absolute inset-y-0 left-0 bg-rose-400" style={{ width: `${intro.winProbability.home}%` }} />
              </div>
              <span className="font-display font-bold text-cyan-300">{intro.winProbability.away}%</span>
            </div>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-white/30">Win probability</p>
          </div>
          <TeamCol team={intro.away} side="away" fav={intro.favorite === "away"} />
        </div>

        <p className="text-center text-[13px] italic text-white/60">{intro.storyline}</p>

        <button onClick={onStart}
          className="w-full rounded-2xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3.5 font-display text-base font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
          Empezar el partido ▸
        </button>
      </div>
    </div>
  );
}
