"use client";

/**
 * `/duelos/jugar` — LA ARENA (Fases 8 y 9G).
 *
 * Una sola pantalla con cuatro momentos: elegir mazo y rival → preparación → los diez turnos →
 * resultado. El estado de la partida NO vive aquí: vive en el servidor, y esta pantalla guarda
 * únicamente la última proyección recibida.
 *
 * FASE 9G — A PANTALLA COMPLETA. Esta ruta es INMERSIVA (`src/design/nav.ts`): el armazón se
 * aparta y la partida ocupa el viewport entero, sin barra de navegación ni menú de secciones.
 * Un juego no te enseña el menú principal mientras juegas. A cambio, la arena trae su propio
 * cromo —marcador, dificultad y una salida siempre visible—, porque una pantalla sin salida es
 * peor que una pantalla con menú.
 *
 * Lo que NO cambia con respecto a la Fase 8.5: el reparto interno del tablero, el orden de la
 * mano en móvil, la revelación y el marcador. Todo eso se revisó jugando y se cerró; aquí solo
 * cambia el marco que lo rodea.
 *
 * FLUJO DE UN TURNO
 *   1. El jugador elige carta (y estadística, si ataca).
 *   2. Se envía a `/api/game/duel`.
 *   3. El servidor valida con el orquestador, deja responder al bot, cierra el turno con el Combat
 *      Resolver y devuelve el estado nuevo.
 *   4. Aquí solo se pinta ese estado y, si el turno se resolvió, se enseña la revelación.
 *
 * No hay sondeo ni temporizadores: cada petición nace de una acción del jugador.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { cn } from "@/lib/format";
import { DuelCard } from "@/components/duel/DuelCard";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { DuelMoment } from "@/components/duel/DuelMoment";
import { ResultScreen } from "@/components/duel/ResultScreen";
import {
  fetchDuelDecks, fetchActiveDuel, startDuel, playDuelTurn, abandonDuel,
} from "@/lib/duel/client";
import {
  DIFFICULTY_INFO, type BotDifficulty, type CombatStatKey, type DuelDeckDTO,
  type DuelMatchView, type DuelTurnView,
} from "@/lib/duel/types";

const LEVELS: BotDifficulty[] = ["EASY", "NORMAL", "HARD"];

export default function JugarPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Preparando duelo…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="jugar duelos" />;
  return (
    <Suspense fallback={<Loading label="Preparando duelo…" />}>
      <Play />
    </Suspense>
  );
}

type Stage = "loading" | "lobby" | "match" | "result";

function Play() {
  const router = useRouter();
  const params = useSearchParams();

  const [stage, setStage] = useState<Stage>("loading");
  const [decks, setDecks] = useState<DuelDeckDTO[]>([]);
  const [deckId, setDeckId] = useState<string | null>(params.get("deck"));
  const [difficulty, setDifficulty] = useState<BotDifficulty>("NORMAL");
  const [view, setView] = useState<DuelMatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<DuelTurnView | null>(null);

  /** Evita el doble envío: una jugada en vuelo bloquea la siguiente. */
  const inFlight = useRef(false);

  const boot = useCallback(async () => {
    setFatal(null);
    try {
      // Una partida en curso manda sobre el lobby: se retoma donde quedó.
      const [active, d] = await Promise.all([fetchActiveDuel(), fetchDuelDecks()]);
      setDecks(d.decks);
      if (active.view) {
        setView(active.view);
        setStage(active.view.status === "IN_PROGRESS" ? "match" : "result");
        return;
      }
      const valid = d.decks.filter((x) => x.valid);
      setDeckId((cur) => cur ?? valid[0]?.id ?? null);
      setStage("lobby");
    } catch (e) {
      setFatal(e instanceof Error ? e.message : "No se pudo preparar el duelo");
      setStage("lobby");
    }
  }, []);

  useEffect(() => { void boot(); }, [boot]);

  async function begin() {
    if (!deckId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await startDuel(deckId, difficulty);
      setView(r.view);
      setStage("match");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo empezar el duelo");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function play(cardUid: string, stat?: CombatStatKey) {
    if (!view || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const before = view.history.length;
    try {
      const r = await playDuelTurn(view.matchId, cardUid, stat);
      setView(r.view);
      // Si el turno se resolvió, se enseña la revelación con el resultado YA aplicado.
      const last = r.view.lastTurn;
      if (last && r.view.history.length > before) setReveal(last);
      if (r.view.status !== "IN_PROGRESS" && !last) setStage("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo jugar el turno");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** Al cerrar la revelación se decide si la partida sigue o ha terminado. */
  function closeReveal() {
    setReveal(null);
    if (view && view.status !== "IN_PROGRESS") setStage("result");
  }

  async function quit() {
    if (!view) return;
    try { await abandonDuel(view.matchId); } catch { /* si ya no existe, da igual */ }
    setView(null);
    setReveal(null);
    setStage("lobby");
    await boot();
  }

  function again() {
    setView(null);
    setReveal(null);
    setError(null);
    setStage("lobby");
    void boot();
  }

  if (stage === "loading") {
    return (
      <Arena>
        <Loading label="Preparando duelo…" />
      </Arena>
    );
  }
  if (fatal && !view) {
    return (
      <Arena>
        <ErrorState message={fatal} onRetry={boot} />
      </Arena>
    );
  }

  return (
    <Arena
      bar={
        stage === "match" && view ? (
          <ArenaBar
            title={view.yourDeckName}
            subtitle={`Turno ${Math.min(view.turn, view.totalTurns)} / ${view.totalTurns} · ${DIFFICULTY_INFO[view.difficulty].label}`}
            score={`${view.scoreYou}–${view.scoreRival}`}
            onQuit={quit}
          />
        ) : null
      }
    >
      <AnimatePresence>
        {reveal && view && (
          <DuelMoment
            key={reveal.number}
            turn={reveal}
            yourCard={findCard(view, reveal.you.uid)}
            rivalCard={findCard(view, reveal.rival.uid)}
            onClose={closeReveal}
          />
        )}
      </AnimatePresence>

      {stage === "lobby" && (
        <Lobby
          decks={decks}
          deckId={deckId}
          onDeck={setDeckId}
          difficulty={difficulty}
          onDifficulty={setDifficulty}
          onStart={begin}
          busy={busy}
          error={error}
        />
      )}

      {stage === "match" && view && (
        <MatchBoard
          view={view}
          onPlay={play}
          busy={busy || reveal !== null}
          error={error}
          onDismissError={() => setError(null)}
        />
      )}

      {stage === "result" && view && (
        <ResultScreen
          view={view}
          onPlayAgain={again}
          onDecks={() => router.push("/duelos/mazos")}
          onReplay={() => router.push(`/duelos/replay/${view.matchId}`)}
        />
      )}
    </Arena>
  );
}

/**
 * El marco de la arena.
 *
 * Ocupa el viewport entero y respeta las zonas seguras del móvil (la muesca arriba, la
 * barra de gestos abajo): sin `env(safe-area-inset-*)`, en un iPhone la mano de cartas
 * queda debajo de la barra del sistema y no se puede tocar la última carta.
 */
function Arena({ children, bar }: { children: React.ReactNode; bar?: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {bar}
      {/*
        Más ancho que el resto del producto (1480 en el armazón, 1320 aquí): sin barra
        lateral ni menú, la arena puede usar el ancho, y el tablero respira.
      */}
      <div className="mx-auto w-full max-w-[1320px] flex-1 px-3 py-4 sm:px-6 sm:py-6">{children}</div>
    </div>
  );
}

/**
 * Cromo de la partida: quién juega, por dónde va y cómo salir.
 *
 * El marcador está aquí ADEMÁS de en el tablero a propósito: al hacer scroll en móvil el
 * marcador del tablero se va, y saber cómo vas es lo único que no se puede perder de vista.
 */
function ArenaBar({
  title, subtitle, score, onQuit,
}: {
  title: string;
  subtitle: string;
  score: string;
  onQuit: () => void;
}) {
  return (
    <header className="nx-chrome sticky top-0 z-40">
      <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center gap-3 px-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <b className="block truncate font-display text-[15px] font-bold leading-none text-white">{title}</b>
          <span className="mt-0.5 block truncate text-[11px] text-white/45">{subtitle}</span>
        </div>
        <span className="shrink-0 rounded-control border border-white/12 bg-white/[0.04] px-3 py-1.5 font-display text-lg font-bold tabular-nums">
          {score}
        </span>
        <button
          type="button"
          onClick={onQuit}
          className="shrink-0 rounded-control border border-white/12 px-3 py-2 font-display text-[11px] font-bold uppercase tracking-wide text-white/45 transition duration-fast hover:border-drl/50 hover:text-drl-glow"
        >
          Salir
        </button>
      </div>
    </header>
  );
}

/** Busca una carta en lo que la vista conoce. El rival solo aparece cuando ya jugó. */
function findCard(view: DuelMatchView, uid: string) {
  const all = [...view.yourHand, ...view.yourUsed, ...view.rivalUsed];
  if (view.pendingRival) all.push(view.pendingRival.card);
  return all.find((c) => c.uid === uid)!;
}

/* ───────────────────────────── preparación ───────────────────────────── */

function Lobby({
  decks, deckId, onDeck, difficulty, onDifficulty, onStart, busy, error,
}: {
  decks: DuelDeckDTO[];
  deckId: string | null;
  onDeck: (id: string) => void;
  difficulty: BotDifficulty;
  onDifficulty: (d: BotDifficulty) => void;
  onStart: () => void;
  busy: boolean;
  error: string | null;
}) {
  const valid = decks.filter((d) => d.valid);
  const chosen = valid.find((d) => d.id === deckId) ?? null;

  return (
    <div>
      <header className="mb-5">
        {/*
          Antes era un enlace de texto de 64×14 px. En una pantalla inmersiva es la ÚNICA
          salida, y a 390 px un objetivo de 14 px de alto no se acierta con el pulgar.
        */}
        <Link
          href="/duelos"
          className="-ml-2 inline-flex min-h-[40px] items-center rounded-control px-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-white/50 transition duration-fast hover:bg-white/[0.06] hover:text-white"
        >
          ‹ Duelos
        </Link>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Preparación</h1>
        <p className="text-sm text-white/50">Elige con qué mazo juegas y a quién te enfrentas.</p>
      </header>

      {valid.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 px-6 py-14 text-center">
          <p className="font-display text-xl text-white/70">No tienes ningún mazo listo</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-white/40">
            Para jugar necesitas un mazo de diez cartas con dos de cada rol.
          </p>
          <Link
            href="/duelos/mazos"
            className="mt-5 inline-block rounded-xl bg-drl px-6 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] shadow-glow transition hover:brightness-110"
          >
            Ir al constructor
          </Link>
        </div>
      ) : (
        <>
          {/* ── Mazo ── */}
          <section aria-label="Elegir mazo">
            <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Tu mazo</h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {valid.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onDeck(d.id)}
                  aria-pressed={d.id === deckId}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    d.id === deckId
                      ? "border-drl bg-drl/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <b className="truncate font-display text-lg">{d.name}</b>
                    <span className="shrink-0 font-display text-sm text-white/50">Σ {d.sumOvr}</span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {d.cards.map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* ── Rival ── */}
          <section className="mt-6" aria-label="Elegir dificultad">
            <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Tu rival</h2>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {LEVELS.map((lv) => {
                const info = DIFFICULTY_INFO[lv];
                const on = difficulty === lv;
                return (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => onDifficulty(lv)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-xl border p-4 text-left transition",
                      on ? "border-drl bg-drl/10" : "border-white/10 bg-white/[0.03] hover:border-white/25",
                    )}
                  >
                    <span className="font-display text-2xl font-bold">{info.label}</span>
                    <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-white/45">
                      {info.tagline}
                    </span>
                    <p className="mt-1.5 text-xs leading-relaxed text-white/55">{info.detail}</p>
                    <div className="mt-3 flex gap-1" aria-hidden>
                      {[1, 2, 3].map((i) => (
                        <i
                          key={i}
                          className={cn(
                            "h-1.5 flex-1 rounded-full",
                            i <= info.level ? "bg-drl" : "bg-white/12",
                          )}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 rounded-lg border-l-2 border-drl-cyan bg-drl-cyan/[0.07] px-3 py-2 text-xs text-white/60">
              Ningún nivel ve las cartas que no has jugado. La dificultad está en la calidad de la
              decisión, nunca en información que tú no tienes.
            </p>
          </section>

          {/* ── Reglas ── */}
          <section className="mt-6 grid gap-2 text-xs text-white/50 sm:grid-cols-3" aria-label="Reglas">
            <Rule n="10 turnos">Cada carta gasta una estadística y no vuelve a jugarse.</Rule>
            <Rule n="Declara y responde">Quien ataca elige la estadística; el rival responde con la que impone la tabla.</Rule>
            <Rule n="Gana el valor mayor">Si empatan, nadie puntúa. El ataque alterna cada turno.</Rule>
          </section>

          {error && (
            <p role="alert" className="mt-4 rounded-lg border border-drl/40 bg-drl/10 px-3 py-2 text-sm text-drl-glow">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={onStart}
            disabled={!chosen || busy}
            className="mt-5 w-full rounded-xl bg-drl px-6 py-3.5 font-display text-base font-bold uppercase tracking-[0.16em] shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 disabled:shadow-none"
          >
            {busy ? "Preparando…" : "Comenzar duelo"}
          </button>
        </>
      )}
    </div>
  );
}

function Rule({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
      <b className="block font-display text-sm text-white/80">{n}</b>
      <span className="mt-0.5 block leading-relaxed">{children}</span>
    </div>
  );
}
