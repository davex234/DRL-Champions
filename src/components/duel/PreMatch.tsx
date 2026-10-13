"use client";

/**
 * PRE-PARTIDA (Fase 26) — la puerta de la arena.
 *
 * Era `Lobby`, dentro de la página de juego, y solo listaba los mazos LEGALES: un mazo a medias
 * desaparecía sin explicación y el jugador no sabía por qué no podía jugar. Ahora se enseñan
 * TODOS los mazos con su estado real —el que validó el servidor (`valid`, `missingByRole`)— y un
 * mazo incompleto se puede mirar, dice qué roles le faltan y lleva a completarlo. Con un mazo
 * ilegal elegido, «Comenzar duelo» no se habilita: el servidor lo rechazaría igualmente (409),
 * pero no se manda a sabiendas.
 *
 * Los textos que leen las verificaciones (`duel:e2e`, `duel:shots`) NO cambian: «Preparación»,
 * «Fácil» / «Normal» / «Difícil» en el DOM (leen `textContent`; las mayúsculas son solo CSS), «Comenzar duelo», `aria-pressed`.
 *
 * Ajuste UX: el selector de dificultad muestra SOLO el nombre (sin etiqueta, descripción ni barras) y las reglas
 * compactas solo se enseñan la primera vez (`showRules`, lo decide la página con `useDuelRulesIntro`).
 *
 * Aquí no se valida ningún mazo: se LEE la validación del servidor.
 */
import Link from "next/link";
import { useEffect } from "react";
import { cn } from "@/lib/format";
import { DuelCard } from "./DuelCard";
import { Plate, Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { DIFFICULTY_INFO, STAT_INFO, type BotDifficulty, type DuelDeckDTO } from "@/lib/duel/types";
import { deckReadiness } from "@/lib/duel/gameplayUx";
import { PreMatchVersus } from "./experience/PreMatchVersus";
import { PreMatchStrategy } from "./strategy/PreMatchStrategy";

const LEVELS: BotDifficulty[] = ["EASY", "NORMAL", "HARD"];

export function PreMatch({
  decks, deckId, onDeck, difficulty, onDifficulty, onStart, busy, error, onHelp, activeDeckId = null, intro = null,
  showRules = true, onRulesShown,
}: {
  decks: DuelDeckDTO[];
  deckId: string | null;
  onDeck: (id: string) => void;
  difficulty: BotDifficulty;
  onDifficulty: (d: BotDifficulty) => void;
  onStart: () => void;
  busy: boolean;
  error: string | null;
  /** Abre la ayuda («?»). */
  onHelp?: () => void;
  /** FASE 32 · el equipo activo del jugador: se marca en la lista y es el que se propone primero. */
  activeDeckId?: string | null;
  /** Fase 40 · contexto del primer combate (coach de la primera sesión), encima de la preparación. */
  intro?: React.ReactNode;
  /** Reglas compactas: solo en la primera entrada (por defecto visibles, p. ej. en los arneses). */
  showRules?: boolean;
  /** Se llama UNA vez cuando las reglas ya se han pintado (para no volver a enseñarlas). */
  onRulesShown?: () => void;
}) {
  const chosen = decks.find((d) => d.id === deckId) ?? null;
  const readiness = chosen ? deckReadiness(chosen) : null;
  const canStart = Boolean(chosen && readiness?.ready) && !busy;

  return (
    <div data-scene="prematch">
      {intro}
      <header className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/duelos"
            className="nx-focus -ml-2 inline-flex min-h-[44px] items-center rounded-control px-2 font-display text-label uppercase tracking-wide2 text-ink-muted transition duration-fast hover:bg-white/[0.06] hover:text-white"
          >
            ‹ Duelos
          </Link>
          {onHelp && (
            <button
              type="button"
              onClick={onHelp}
              aria-label="Cómo se juega"
              className="nx-focus grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.04] font-display text-[15px] font-bold text-white/75 transition hover:bg-white/[0.1] hover:text-white"
            >
              ?
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-display text-[clamp(28px,4.6vw,44px)] font-bold uppercase leading-none text-white">
              Preparación
            </h1>
            <p className="mt-1.5 text-body text-ink-muted">Elige con qué equipo juegas y a quién te enfrentas.</p>
          </div>
          {chosen && readiness?.ready && (
            <div className="flex flex-wrap items-stretch gap-2.5">
              <Plate className="flex items-center px-4 py-2.5">
                <Readout size="sm" label="Tu equipo" value={chosen.name} tone="var(--nx-ok)" />
              </Plate>
              <Plate className="flex items-center px-4 py-2.5">
                <Readout size="sm" label="Fuerza" value={"Σ " + chosen.sumOvr} tone="var(--nx-cyan)" />
              </Plate>
            </div>
          )}
        </div>
      </header>

      {decks.length === 0 ? (
        <Plate className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">
            No tienes ningún equipo listo
          </p>
          <p className="max-w-[46ch] text-body text-ink-muted">
            Para jugar necesitas un equipo de diez cartas con dos de cada rol.
          </p>
          <NxButton variant="primary" size="lg" href="/duelos/mazos">
            Ir al constructor
          </NxButton>
        </Plate>
      ) : (
        <>
          {/* ── Fase 33 · tu equipo contra el rival (oculto) ── */}
          {chosen && <PreMatchVersus deck={chosen} rival={{ kind: "BOT", label: DIFFICULTY_INFO[difficulty].label }} className="mb-5" />}
          {/* Fase 43 · perfil del PROPIO equipo (del rival no se sabe nada antes de que juegue). */}
          {chosen && readiness?.ready && <PreMatchStrategy cards={chosen.cards} className="mb-5" />}

          {/* ── Mazo ── */}
          <section aria-label="Elegir equipo">
            <SectionTitle as="h2">Tu equipo</SectionTitle>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {decks.map((d) => {
                const r = deckReadiness(d);
                const on = d.id === deckId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onDeck(d.id)}
                    aria-pressed={on}
                    data-deck-ready={r.ready}
                    className={cn(
                      "nx-focus nx-clip-sm border p-3 text-left transition duration-fast",
                      on
                        ? r.ready ? "border-drl bg-drl/10" : "border-drl-gold/70 bg-drl-gold/10"
                        : "border-edge bg-white/[0.03] hover:border-white/25",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <b className="truncate font-display text-h3 font-bold uppercase tracking-wide text-white">{d.name}</b>
                      <span className="flex shrink-0 items-center gap-2">
                        {d.id === activeDeckId && <Badge tone="info">Activo</Badge>}
                        <Badge tone={r.ready ? "ok" : "warn"}>{r.ready ? "Listo" : "Incompleto"}</Badge>
                        <span className="nx-label">
                          Σ <b className="nx-readout text-[13px] text-ink-secondary">{d.sumOvr}</b>
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 flex gap-1">
                      {d.cards.map((c) => (
                        <span key={c.uid} className="min-w-0 flex-1">
                          <DuelCard card={c} size="xs" className="!w-full" />
                        </span>
                      ))}
                      {Array.from({ length: Math.max(0, 10 - d.cards.length) }).map((_, i) => (
                        <span key={`hueco-${i}`} aria-hidden className="min-w-0 flex-1">
                          <span className="block aspect-[5/7] w-full rounded-[4px] border border-dashed border-white/15" />
                        </span>
                      ))}
                    </div>
                    {!r.ready && (
                      <p className="mt-2 text-caption text-drl-gold">{r.summary}</p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* FASE 32 · con un equipo listo, el camino al constructor sin salir de la selección rápida. */}
            {chosen && readiness?.ready && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2" data-testid="prematch-edit">
                <p className="text-caption text-ink-muted">
                  {chosen.id === activeDeckId ? "Juegas con tu equipo activo." : "Puedes elegir cualquiera de tus equipos listos."}
                </p>
                <NxButton variant="ghost" size="sm" href={`/duelos/mazos?deck=${chosen.id}`}>
                  Editar equipo
                </NxButton>
              </div>
            )}

            {/* El mazo elegido no puede jugar: se dice por qué y se ofrece el camino, no un error. */}
            {chosen && readiness && !readiness.ready && (
              <Recessed className="mt-3 flex flex-col gap-3 border-l-2 border-l-drl-gold px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="status">
                <div className="min-w-0">
                  <b className="block font-display text-body font-bold uppercase tracking-wide text-white">
                    No puedes empezar con «{chosen.name}»
                  </b>
                  <p className="mt-0.5 text-caption leading-relaxed text-ink-secondary">
                    {readiness.summary}. Un equipo de duelo son diez cartas con dos de cada rol.
                  </p>
                  {readiness.missing.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Roles que faltan">
                      {readiness.missing.map((m) => (
                        <li key={m.role}>
                          <Badge tone="warn">{m.count} × {m.role}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <NxButton variant="secondary" size="md" className="shrink-0" href={`/duelos/mazos?deck=${chosen.id}`}>
                  Completar equipo
                </NxButton>
              </Recessed>
            )}
          </section>

          {/* ── Rival ── */}
          <section className="mt-6" aria-label="Elegir dificultad">
            <SectionTitle as="h2">Tu rival</SectionTitle>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Dificultad">
              {LEVELS.map((lv) => {
                const info = DIFFICULTY_INFO[lv];
                const on = difficulty === lv;
                return (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => onDifficulty(lv)}
                    aria-pressed={on}
                    data-difficulty={lv}
                    className={cn(
                      "nx-focus nx-clip-sm relative flex min-h-[56px] min-w-0 items-center justify-center border px-2 py-3 text-center transition duration-fast",
                      on ? "border-drl bg-drl/10 text-white" : "border-edge bg-white/[0.03] text-ink-secondary hover:border-white/25 hover:text-white",
                    )}
                  >
                    {/* Mayúsculas SOLO por CSS: el DOM sigue diciendo «Fácil», «Normal», «Difícil» (lo leen `duel:e2e`/`duel:shots`). */}
                    <span className="truncate font-display text-body font-bold uppercase tracking-wide2 sm:text-h2">{info.label}</span>
                    {/* Seleccionada: además del color, una barra de acento (forma) — nunca solo color. */}
                    {on && <i aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-drl" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Cómo se juega: solo la PRIMERA entrada (después, la ayuda «?» las tiene). Sin hueco cuando no está. ── */}
          {showRules && <RulesIntro onShown={onRulesShown} />}

          {error && (
            <p role="alert" className="nx-clip-sm mt-4 border border-drl/40 bg-drl/10 px-3 py-2 text-body text-drl-glow">
              {error}
            </p>
          )}

          {/* El texto NO cambia: `duel:e2e` y `duel:shots` entran a la partida por él. */}
          <NxButton
            variant="primary"
            size="lg"
            block
            className="mt-5"
            onClick={onStart}
            disabled={!canStart}
            aria-disabled={!canStart}
          >
            {busy ? "Preparando…" : "Comenzar duelo"}
          </NxButton>
          {chosen && readiness && !readiness.ready && (
            <p className="mt-2 text-center text-caption text-ink-faint">Completa el equipo para poder empezar.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Reglas compactas de siempre (3 claves). `onShown` se llama una vez, tras pintarse: así se marcan como vistas. */
function RulesIntro({ onShown }: { onShown?: () => void }) {
  useEffect(() => { onShown?.(); }, [onShown]);
  return (
    <section className="mt-6 grid gap-2 text-xs text-white/50 sm:grid-cols-3" aria-label="Reglas" data-testid="prematch-rules">
      <Rule n="10 turnos">Cada carta gasta una estadística y no vuelve a jugarse. El ataque alterna cada turno.</Rule>
      <Rule n="Declara y responde">
        Quien ataca elige la estadística; el rival responde con la que impone la tabla del juego.
      </Rule>
      <Rule n="Gana el valor mayor">
        {Object.values(STAT_INFO).map((s, i) => (
          <span key={s.abbr}>
            {i > 0 && " · "}
            <b style={{ color: s.color }}>{s.label}</b>
          </span>
        ))}
        . Si empatan, nadie puntúa.
      </Rule>
    </section>
  );
}

function Rule({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <Plate className="px-3.5 py-2.5">
      <b className="block font-display text-body font-bold uppercase tracking-wide text-white/85">{n}</b>
      <span className="mt-0.5 block leading-relaxed">{children}</span>
    </Plate>
  );
}
