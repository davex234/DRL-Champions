"use client";

/**
 * CARRERA — el centro de DESARROLLO de los jugadores del entrenador.
 *
 * Muestra la evolución de cada titular (fichas de desarrollo + scouting), permite al
 * entrenador ENTRENAR (qué/quién/intensidad) y CERRAR TEMPORADA (envejece a todos y
 * progresa al resto del mundo). Solo CONECTA el Development Engine vía `useCareerStore`.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useTeamStore } from "@/store/useTeamStore";
import { useCareerStore } from "@/store/useCareerStore";
import { buildHomeRoster } from "@/lib/match/roster";
import { allPlayers } from "@/data/catalog";
import {
  deriveInnate, freshDevState, scoutPlayer, developmentBroadcast, developmentEventsBroadcast,
  type TrainingSessionId, type TrainingIntensity,
} from "@/development";
import { DevelopmentCard } from "@/components/career/DevelopmentCard";
import { TrainingPanel } from "@/components/career/TrainingPanel";
import { primeAudio, playCue } from "@/lib/sound";

export default function CarreraPage() {
  const ownedCards = useGameStore((s) => s.ownedCards);
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const active = teams.find((t) => t.id === activeTeamId) ?? null;

  const dev = useCareerStore((s) => s.dev);
  const innate = useCareerStore((s) => s.innate);
  const season = useCareerStore((s) => s.season);
  const events = useCareerStore((s) => s.events);
  const runTraining = useCareerStore((s) => s.runTraining);
  const advanceSeason = useCareerStore((s) => s.advanceSeason);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const players = useMemo(() => {
    if (!active) return [];
    return buildHomeRoster(active.starters, ownedCards).roster.map((e) => ({ id: e.meta?.playerId ?? e.name, name: e.name }));
  }, [active, ownedCards]);

  if (!active || players.length === 0) {
    return (
      <section className="animate-rise space-y-4">
        <Header season={season} />
        <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-white/10 bg-base-700/40 p-8 text-center">
          <p className="text-3xl">📈</p>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">Necesitas un equipo</h2>
          <p className="text-sm text-white/55">Crea un equipo de 5 jugadores para seguir y desarrollar su carrera.</p>
          <Link href="/entrenador/equipos" className="inline-block rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow">
            Gestionar equipos ▸
          </Link>
        </div>
      </section>
    );
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const train = (sid: TrainingSessionId, intensity: TrainingIntensity) => {
    if (selected.size === 0) return;
    primeAudio(); playCue("ui");
    runTraining([...selected], { id: sid, intensity });
  };
  const closeSeason = () => {
    playCue("whoosh");
    advanceSeason(allPlayers().map((p) => p.id)); // todos progresan (live esports)
  };

  const recentEvents = developmentEventsBroadcast(events).slice(0, 5);

  return (
    <section className="animate-rise space-y-4">
      <Header season={season} onCloseSeason={closeSeason} />

      <TrainingPanel count={selected.size} onTrain={train} />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {players.map((p) => {
          const inn = innate[p.id] ?? deriveInnate(p.id);
          const d = dev[p.id];
          const scout = scoutPlayer(inn, d ?? freshDevState(inn));
          const info = d ? developmentBroadcast(d, inn, p.name) : null;
          return (
            <DevelopmentCard key={p.id} name={p.name} info={info} scout={scout}
              selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />
          );
        })}
      </div>

      {recentEvents.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-base-800/60 p-4">
          <p className="mb-2 font-display text-[11px] uppercase tracking-widest text-white/45">Historias de desarrollo</p>
          <ul className="space-y-1">
            {recentEvents.map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-[12px] text-white/70">
                <span className="rounded bg-drl/15 px-1.5 py-0.5 font-display text-[9px] uppercase tracking-wide text-drl">{e.type.replace(/_/g, " ")}</span>
                <span className="text-white/80">{e.name ?? ""}</span>
                <span className="text-white/45">{e.detail ?? ""}</span>
                <span className="ml-auto text-[10px] text-white/30">T{e.season}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Header({ season, onCloseSeason }: { season: number; onCloseSeason?: () => void }) {
  return (
    <header className="flex items-center justify-between">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          <span className="text-drl">Carrera</span> · Temporada {season}
        </h1>
        <p className="mt-1 text-white/50">Desarrolla personas, no números. <strong className="text-white/70">Cada carrera es única.</strong></p>
      </div>
      {onCloseSeason && (
        <button onClick={onCloseSeason}
          className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-display text-xs uppercase tracking-wide text-amber-200 transition hover:bg-amber-400/20">
          Cerrar temporada ▸
        </button>
      )}
    </header>
  );
}
