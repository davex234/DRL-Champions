"use client";

/**
 * DETALLE DE TORNEO — partidos, Pick'ems y clasificación del torneo.
 *
 * El panel de predicciones es el MISMO componente que usa `/pickems`
 * (`components/pickems/PickemPanel`), para que no existan dos comportamientos de
 * guardado ni dos formas de mostrar el cierre. Aquí se le añade el contexto que
 * esta pantalla aporta: el calendario de partidos y la clasificación.
 */
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  fetchTournament, fetchMatches, fetchPickemEvent, fetchTournamentRanking,
  type TournamentRow, type MatchRow, type PickemEventRow, type TournamentRankingRow,
  type MyScore,
} from "@/lib/game/client";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { PickemPanel } from "@/components/pickems/PickemPanel";
import { Loading, ErrorState, EmptyState, DemoBadge, NeedsAccount } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { cn } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  ongoing: "En curso", upcoming: "Próximo", finished: "Finalizado", live: "En vivo",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function TorneoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const configured = isSupabaseConfigured();
  const { user, profile, refreshProfile } = useAuth();
  const { toast, notify } = useToast();

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [pickem, setPickem] = useState<PickemEventRow | null>(null);
  const [ranking, setRanking] = useState<TournamentRankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const t = await fetchTournament(id);
      setTournament(t);
      if (!t) { setLoading(false); return; }

      const [ms, pe] = await Promise.all([fetchMatches(id), fetchPickemEvent(id)]);
      setMatches(ms);
      setPickem(pe);
      if (pe) setRanking(await fetchTournamentRanking(pe.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el torneo");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (configured) load(); else setLoading(false); }, [configured, load]);

  // Cuando cambian los puntos, la clasificación del torneo y el perfil se quedan
  // desfasados: se refrescan en vez de mostrar cifras viejas.
  const handleScoreChange = useCallback(async (_score: MyScore | null) => {
    if (!pickem) return;
    setRanking(await fetchTournamentRanking(pickem.id).catch(() => []));
    refreshProfile();
  }, [pickem, refreshProfile]);

  const byRound = useMemo(() => {
    const map = new Map<string, MatchRow[]>();
    for (const m of matches) {
      const key = m.round ?? "Partidos";
      const arr = map.get(key);
      if (arr) arr.push(m); else map.set(key, [m]);
    }
    return [...map.entries()];
  }, [matches]);

  if (!configured) return <NeedsAccount what="El circuito competitivo" />;
  if (loading) return <Loading label="Cargando torneo" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!tournament) {
    return (
      <EmptyState icon="🔍" title="Torneo no encontrado"
        hint="Puede que se haya retirado del circuito."
        action={{ href: "/torneos", label: "Ver todos los torneos" }} />
    );
  }

  return (
    <section className="animate-rise space-y-8">
      {/* ── Cabecera ── */}
      <header>
        <Link href="/torneos" className="text-xs uppercase tracking-widest text-white/40 hover:text-white">
          ← Torneos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            {tournament.name}
          </h1>
          {tournament.source === "demo" && <DemoBadge />}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/50">
          <span>{STATUS_LABEL[tournament.status] ?? tournament.status}</span>
          {tournament.region && <span>· {tournament.region}</span>}
          {tournament.location && <span>· 📍 {tournament.location}</span>}
          {tournament.prize_pool ? <span>· 💰 {tournament.prize_pool.toLocaleString("es-ES")} $</span> : null}
        </div>
        {tournament.source === "demo" && (
          <p className="mt-3 rounded-xl border border-drl-gold/25 bg-drl-gold/5 px-4 py-2 text-xs text-drl-gold/90">
            Torneo de demostración: los equipos son reales, pero los resultados no corresponden a
            partidos reales. Tus predicciones, puntos y recompensas sí son reales y se guardan en tu cuenta.
          </p>
        )}
      </header>

      {/* ── Pick'ems (panel compartido con /pickems) ── */}
      <div>
        <div className="mb-3">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
            Pick&apos;ems
          </h2>
          <p className="text-sm text-white/50">
            {pickem?.description ?? "Predice los resultados y suma puntos."}
          </p>
        </div>

        {!pickem ? (
          <EmptyState icon="🗳️" title="Sin Pick'ems"
            hint="Este torneo todavía no tiene predicciones abiertas." />
        ) : !user ? (
          <NeedsAccount what="Tus predicciones" />
        ) : (
          <PickemPanel
            pickemEventId={pickem.id}
            userId={user.id}
            onNotify={notify}
            onScoreChange={handleScoreChange}
            eventName={tournament.name}
            totalPoints={profile?.points ?? 0}
          />
        )}
      </div>

      {/* ── Partidos ── */}
      <div>
        <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
          Partidos
        </h2>
        {matches.length === 0 ? (
          <EmptyState icon="📅" title="Sin partidos" hint="El calendario todavía no está publicado." />
        ) : (
          <div className="space-y-5">
            {byRound.map(([round, list]) => (
              <div key={round}>
                <p className="mb-2 text-[11px] uppercase tracking-widest text-white/40">{round}</p>
                <div className="space-y-2">
                  {list.map((m) => {
                    const aWon = m.winner_team_id === m.team_a_id;
                    const bWon = m.winner_team_id === m.team_b_id;
                    return (
                      <div key={m.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-base-700/40 px-4 py-3">
                        <span className={cn("min-w-0 flex-1 truncate font-display text-sm",
                          aWon ? "font-bold text-white" : "text-white/60")}>{m.team_a}</span>
                        <span className="shrink-0 font-display text-sm tabular-nums text-white/70">
                          {m.status === "upcoming" ? "vs" : `${m.score_a ?? 0} – ${m.score_b ?? 0}`}
                        </span>
                        <span className={cn("min-w-0 flex-1 truncate text-right font-display text-sm",
                          bWon ? "font-bold text-white" : "text-white/60")}>{m.team_b}</span>
                        <span className={cn("w-24 shrink-0 text-right text-[10px] uppercase tracking-widest",
                          m.status === "live" ? "text-drl-cyan" : "text-white/35")}>
                          {m.status === "live" ? "● En vivo" : m.status === "finished" ? "Final" : fmtDate(m.start_time)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Clasificación del torneo ── */}
      {pickem && (
        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
              Clasificación del torneo
            </h2>
            <Link href="/ranking" className="nx-action">
              Clasificación global →
            </Link>
          </div>
          {ranking.length === 0 ? (
            <EmptyState icon="🏅" title="Aún sin clasificación"
              hint="Aparecerá cuando se corrijan las primeras predicciones." />
          ) : (
            <div className="space-y-2">
              {ranking.map((r, i) => (
                <div key={r.user_id}
                  className={cn("flex items-center gap-3 rounded-xl border px-4 py-2.5",
                    r.user_id === user?.id ? "border-drl/40 bg-drl/5" : "border-white/10 bg-base-700/40")}>
                  <span className="w-7 text-center font-display text-sm font-bold text-white/50">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </span>
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-base-800 text-base">{r.avatar}</span>
                  <span className="min-w-0 flex-1 truncate font-display text-sm text-white">
                    {r.username}{r.user_id === user?.id && <span className="ml-2 text-xs text-drl">tú</span>}
                  </span>
                  <span className="shrink-0 text-xs text-white/45">{r.correct}/{r.total}</span>
                  <span className="shrink-0 font-display text-sm font-bold tabular-nums text-drl-gold">
                    {r.points} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Toast toast={toast} />
    </section>
  );
}
