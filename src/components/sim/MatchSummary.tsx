"use client";

/**
 * Pantalla FINAL del partido: reúne lo que ya producen los motores (Match, Narrative,
 * Economy, Buy, Combat) en una sola vista — marcador, ganador, MVP, narrativa, eventos,
 * economía, estadísticas y recompensas. No calcula nada de juego: solo muestra.
 */
import Link from "next/link";
import type { MatchState } from "@/match";
import type { MatchReward } from "@/lib/match/rewards";
import { cn } from "@/lib/format";

export function MatchSummary({ match, reward, onAgain, onCollection }: {
  match: MatchState;
  reward: MatchReward | null;
  onAgain: () => void;
  onCollection: () => void;
}) {
  const won = match.winner === "home";
  const names = match.config.teamNames ?? { home: "Local", away: "Rival" };
  const ns = match.narrative;
  const sideSwitches = match.events.filter((e) => e.type === "SIDE_SWITCHED").length;
  const econHome = match.economy ? sum(match.economy.home.players) : 0;
  const econAway = match.economy ? sum(match.economy.away.players) : 0;
  const keyMoments = (ns?.keyMoments ?? []).slice(0, 4);
  const heroes = (ns?.heroes ?? []).slice(0, 2);

  return (
    <div className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-white/10 bg-base-700/50 p-6">
      {/* Marcador y resultado */}
      <div className="text-center">
        <p className={cn("font-display text-3xl font-bold uppercase tracking-wide", won ? "text-emerald-300" : "text-rose-300")}>
          {won ? "Victoria" : "Derrota"}
        </p>
        <p className="mt-1 font-display text-5xl font-bold text-white">
          {match.score.home} <span className="text-white/30">—</span> {match.score.away}
        </p>
        <p className="mt-1 text-sm text-white/45">{names.home} vs {names.away} · {match.history.length} rondas</p>
        {ns?.summary.headline && <p className="mt-2 text-sm text-white/70">{ns.summary.headline}</p>}
      </div>

      {/* MVP + recompensa */}
      <div className="grid grid-cols-2 gap-3">
        <Card title="MVP del partido">
          <p className="font-display text-lg font-bold text-white">{match.mvp?.name ?? "—"}</p>
          <p className="text-xs text-white/45">{match.mvp?.kills ?? 0} bajas · {match.mvp?.team === "home" ? names.home : names.away}</p>
        </Card>
        <Card title="Recompensa">
          {reward ? (
            <div className="flex items-center gap-3">
              <span className="font-display text-lg font-bold text-amber-200">+{reward.credits}</span><span className="text-xs text-white/45">créditos</span>
              <span className="font-display text-lg font-bold text-amber-200">+{reward.xp}</span><span className="text-xs text-white/45">XP</span>
            </div>
          ) : <p className="text-white/40">—</p>}
        </Card>
      </div>

      {/* Narrativa + momentos clave */}
      {ns && (
        <Card title="Historia del partido">
          <p className="text-xs text-white/60">
            Forma: <span className="text-white/85">{ns.match.shape.descriptors.join(", ") || ns.match.shape.id}</span>
            {ns.summary.turningPoint != null && <> · Punto de inflexión: ronda {ns.summary.turningPoint}</>}
          </p>
          {heroes.length > 0 && (
            <p className="mt-1 text-xs text-white/60">Héroes: {heroes.map((h) => h.name).join(", ")}</p>
          )}
          {keyMoments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {keyMoments.map((k, i) => (
                <li key={i} className="text-[11px] text-white/55">R{k.event.round} · {k.why}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Economía + estadísticas + eventos */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cambios de lado" value={String(sideSwitches)} />
        <Stat label="Créditos finales" value={`${econHome} / ${econAway}`} />
        <Stat label="Eventos compra" value={String(match.buyEvents.length)} />
        <Stat label="Eventos combate" value={String(match.combatEvents.length)} />
      </div>

      <div className="flex gap-3">
        <button onClick={onAgain}
          className="flex-1 rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
          Otro partido ▸
        </button>
        <Link href="/coleccion" onClick={onCollection}
          className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 font-display text-sm uppercase tracking-wide text-white/70 transition hover:bg-white/10">
          Ir a la colección
        </Link>
      </div>
    </div>
  );
}

const sum = (rec: Record<string, number>): number => Object.values(rec).reduce((a, b) => a + b, 0);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-base-800/60 p-4">
      <p className="mb-1 text-[10px] uppercase tracking-widest text-white/40">{title}</p>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-base-800/60 p-3 text-center">
      <p className="font-display text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}
