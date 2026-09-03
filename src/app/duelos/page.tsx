"use client";

/**
 * `/duelos` — ENTRADA AL MODO DUELOS (Fase 8).
 *
 * Punto de partida del recorrido: jugar, mis mazos y repeticiones. Si hay una partida en curso la
 * ofrece para retomarla —el estado vive en servidor, así que sobrevive a recargar la página.
 *
 * Todos los datos llegan de `/api/game/duel*`. Esta pantalla no conoce ninguna regla del juego.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { fetchDuelDecks, fetchActiveDuel, fetchDuelReplays } from "@/lib/duel/client";
import { DuelCard } from "@/components/duel/DuelCard";
import { DIFFICULTY_INFO, type BotDifficulty, type DuelDeckDTO, type DuelMatchView, type DuelReplayRow } from "@/lib/duel/types";

export default function DuelosPage() {
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();

  if (loading) return <Loading label="Cargando duelos…" />;
  if (!online || !user) return <NeedsAccount what="jugar duelos" />;
  return <DuelHub />;
}

function DuelHub() {
  const router = useRouter();
  const [decks, setDecks] = useState<DuelDeckDTO[] | null>(null);
  const [active, setActive] = useState<DuelMatchView | null>(null);
  const [replays, setReplays] = useState<DuelReplayRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Tres lecturas independientes en paralelo, UNA vez al montar. Sin sondeo.
      const [d, a, r] = await Promise.all([fetchDuelDecks(), fetchActiveDuel(), fetchDuelReplays()]);
      setDecks(d.decks);
      setActive(a.view);
      setReplays(r.matches);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los duelos");
      setDecks([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error && decks === null) return <ErrorState message={error} onRetry={load} />;
  if (decks === null) return <Loading label="Cargando duelos…" />;

  const ready = decks.filter((d) => d.valid);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5">
        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-drl">Modo de juego</span>
        <h1 className="mt-1 font-display text-4xl font-bold sm:text-5xl">Duelos</h1>
        <p className="mt-1 max-w-xl text-sm text-white/55">
          Enfrenta tu mazo al de un rival. Diez cartas, diez turnos, una estadística por carta.
        </p>
      </header>

      {active && (
        <section className="mb-4 rounded-2xl border border-drl-cyan/40 bg-drl-cyan/[0.07] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-drl-cyan">Partida en curso</span>
              <p className="font-display text-xl font-bold">
                {active.yourDeckName} · turno {Math.min(active.turn, active.totalTurns)} / {active.totalTurns}
              </p>
              <p className="text-xs text-white/50">
                Marcador {active.scoreYou}–{active.scoreRival} · dificultad {DIFFICULTY_INFO[active.difficulty].label}
              </p>
            </div>
            <Link
              href="/duelos/jugar"
              className="rounded-xl bg-drl-cyan px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] text-base-900 transition hover:brightness-110"
            >
              Continuar
            </Link>
          </div>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/duelos/jugar"
          className="group rounded-2xl border border-drl/40 bg-gradient-to-br from-drl/20 to-transparent p-5 transition hover:border-drl"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-drl-glow">Jugar</span>
          <h2 className="mt-1 font-display text-3xl font-bold">Nuevo duelo</h2>
          <p className="mt-1 text-sm text-white/55">
            {ready.length > 0
              ? `${ready.length} ${ready.length === 1 ? "mazo listo" : "mazos listos"} para competir.`
              : "Necesitas un mazo válido de 10 cartas."}
          </p>
        </Link>

        <Link
          href="/duelos/mazos"
          className="group rounded-2xl border border-white/12 bg-white/[0.03] p-5 transition hover:border-white/25"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Preparar</span>
          <h2 className="mt-1 font-display text-3xl font-bold">Mis mazos</h2>
          <p className="mt-1 text-sm text-white/55">
            {decks.length === 0 ? "Crea tu primer mazo." : `${decks.length} guardados.`}
          </p>
        </Link>
      </div>

      {/* ── Mazos ── */}
      <section className="mt-6">
        <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Tus mazos</h2>
        {decks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/12 px-4 py-8 text-center text-sm text-white/40">
            Todavía no tienes ningún mazo.{" "}
            <Link href="/duelos/mazos" className="text-drl underline-offset-2 hover:underline">Crea uno</Link>.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {decks.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => router.push(`/duelos/mazos?deck=${d.id}`)}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-white/25"
              >
                <div className="flex items-center justify-between gap-2">
                  <b className="truncate font-display text-lg">{d.name}</b>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                      d.valid ? "bg-emerald-400/15 text-emerald-300" : "bg-drl/15 text-drl-glow"
                    }`}
                  >
                    {d.valid ? "Listo" : d.status === "INCOMPLETE" ? "Incompleto" : "Revisar"}
                  </span>
                </div>
                <div className="mt-2 flex gap-1">
                  {d.cards.slice(0, 10).map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}
                </div>
                <p className="mt-2 text-[11px] text-white/40">
                  {d.cards.length}/10 cartas · Σ OVR {d.sumOvr}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Repeticiones ── */}
      {replays.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Repeticiones</h2>
          <div className="flex flex-col gap-1.5">
            {replays.slice(0, 8).map((m) => {
              const won = m.scoreYou > m.scoreRival;
              const draw = m.status === "DRAW";
              return (
                <Link
                  key={m.matchId}
                  href={`/duelos/replay/${m.matchId}`}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:bg-white/[0.06]"
                >
                  <span
                    className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center font-display text-[11px] font-bold ${
                      draw ? "bg-drl-gold/15 text-drl-gold" : won ? "bg-emerald-400/15 text-emerald-300" : "bg-drl/15 text-drl-glow"
                    }`}
                  >
                    {m.scoreYou}–{m.scoreRival}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white/70">{m.deckName}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-white/30">{DIFFICULTY_INFO[m.difficulty as BotDifficulty]?.label ?? m.difficulty}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
