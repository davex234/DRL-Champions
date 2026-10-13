"use client";

/**
 * ANTESALA PvP (Bloque 7.5): elegir mazo y buscar rival.
 *
 * ─────────────────────── LO QUE NO SE ENVÍA Y LO QUE NO SE ENSEÑA ───────────────────────
 *
 * Se envía **el id del mazo y nada más**. Ni rating, ni MMR, ni rival preferido, ni matchId. El
 * servidor sella el rating con el que entras (bloque 7.4.1) y elige al rival (bloque 7.4).
 *
 * Y de la cola no se enseña nada que no sea tuyo: no hay lista de jugadores, ni ratings ajenos,
 * ni tamaño de cola. Lo único agregado que existe es `position` —cuántos llevan esperando más que
 * tú—, que es un entero y no nombra a nadie.
 *
 * ─────────────────────── VALIDEZ DEL MAZO ───────────────────────
 *
 * La legalidad la decide el servidor, siempre. Aquí se usa la marca `valid` que ya trae
 * `fetchDuelDecks` —la misma que usa el duelo contra el bot— para no ofrecer un mazo que se sabe
 * que va a ser rechazado. No se reimplementa ni una regla de composición.
 */
import { NxButton } from "@/components/ui/NxButton";
import { Plate, Stage } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { EmptyState } from "@/components/ui/States";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { PreMatchVersus } from "@/components/duel/experience/PreMatchVersus";
import { PreMatchStrategy } from "@/components/duel/strategy/PreMatchStrategy";

export interface PvpLobbyProps {
  decks: DuelDeckDTO[];
  deckId: string | null;
  onDeck: (id: string) => void;
  onSearch: () => void;
  onCancel: () => void;
  onDecks: () => void;
  searching: boolean;
  waitingSeconds: number;
  position: number | null;
  rating: number | null;
  busy: boolean;
  /** FASE 32 · equipo activo del jugador: se marca en la lista. */
  activeDeckId?: string | null;
}

function Reloj({ s }: { s: number }) {
  return (
    <span className="nx-readout text-[26px] tabular-nums text-white" data-testid="pvp-wait">
      {String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export function PvpLobby({
  decks, deckId, onDeck, onSearch, onCancel, onDecks,
  searching, waitingSeconds, position, rating, busy, activeDeckId = null,
}: PvpLobbyProps) {
  const validos = decks.filter((d) => d.valid);
  const elegido = decks.find((d) => d.id === deckId) ?? null;

  // ── BUSCANDO ──────────────────────────────────────────────────────────────
  if (searching) {
    return (
      <Stage className="mx-auto w-full max-w-xl px-4 py-8 text-center" data-testid="pvp-searching">
        <p className="nx-label">Ranked · Duelo PvP</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Buscando rival…</h1>
        <p className="mt-1 text-sm text-white/45">
          El servidor busca a alguien con un rating parecido. Cuanto más esperes, más se abre la
          búsqueda.
        </p>

        <Plate className="mt-5 flex items-center justify-center gap-8 px-4 py-5">
          <div className="text-center">
            <span className="nx-label">En cola</span>
            <Reloj s={waitingSeconds} />
          </div>
          {position !== null && (
            <div className="text-center">
              <span className="nx-label">Esperan más que tú</span>
              <span className="nx-readout mt-1 block text-[26px] tabular-nums text-white/70">{position}</span>
            </div>
          )}
          {rating !== null && (
            <div className="text-center">
              <span className="nx-label">Tu rating</span>
              <span className="nx-readout mt-1 block text-[26px] tabular-nums text-white/70">{rating}</span>
            </div>
          )}
        </Plate>

        {elegido && (
          <p className="mt-3 text-xs text-white/40">Con el equipo <b className="text-white/70">{elegido.name}</b></p>
        )}

        <div className="mt-6">
          <NxButton variant="ghost" onClick={onCancel} disabled={busy}>Cancelar búsqueda</NxButton>
        </div>
      </Stage>
    );
  }

  // ── ELECCIÓN DE MAZO ──────────────────────────────────────────────────────
  return (
    <Stage className="mx-auto w-full max-w-2xl px-4 py-6" data-testid="pvp-lobby">
      <SectionTitle as="h1">Duelo PvP</SectionTitle>
      <p className="-mt-2 mb-3 text-sm text-white/45">
        Contra otra persona. El rival lo elige el servidor según tu rating.
      </p>

      {rating !== null && (
        <Plate className="mt-3 flex items-center justify-between px-4 py-3">
          <span className="nx-label">Tu rating PvP</span>
          <span className="nx-readout text-[24px] tabular-nums text-white" data-testid="pvp-my-rating">{rating}</span>
        </Plate>
      )}

      {/* Fase 33 · tu equipo contra un rival que el servidor elegirá por rating (oculto). */}
      {elegido?.valid && <PreMatchVersus deck={elegido} rival={{ kind: "RANKED" }} className="mt-4" />}
      {/* Fase 43 · solo el perfil de TU equipo: del rival no existe nada que analizar hasta que juega. */}
      {elegido?.valid && <PreMatchStrategy cards={elegido.cards} className="mt-3" />}

      <div className="mt-4">
        <p className="nx-label mb-2">Elige equipo</p>

        {validos.length === 0 ? (
          <EmptyState
            icon="🃏"
            title="No tienes ningún equipo válido"
            hint="Un equipo de duelo son 10 cartas con la composición de roles exigida. Móntalo en Mis equipos."
            action={{ href: "/duelos/mazos", label: "Ir a Mis equipos" }}
          />
        ) : (
          <div className="grid gap-2">
            {decks.map((d) => {
              const sel = d.id === deckId;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => d.valid && onDeck(d.id)}
                  disabled={!d.valid}
                  aria-pressed={sel}
                  data-deck={d.id}
                  /* 44px de alto mínimo: es un control táctil, no una fila de tabla. */
                  className={[
                    "nx-clip flex min-h-[52px] items-center justify-between gap-3 px-3 py-2 text-left transition",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-drl-cyan",
                    d.valid ? "cursor-pointer" : "cursor-not-allowed opacity-45",
                    sel ? "bg-drl-cyan/12 ring-1 ring-drl-cyan/60" : "bg-white/[0.04] hover:bg-white/[0.07]",
                  ].join(" ")}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white">{d.name}</span>
                    <span className="block text-[11px] text-white/40">
                      {d.valid ? `${d.cards.length} cartas · listo` : "No es legal todavía"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {d.id === activeDeckId && <span className="nx-label text-ok">Activo</span>}
                    {sel && <span className="nx-label text-drl-cyan">Elegido</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <NxButton
          variant="primary"
          onClick={onSearch}
          disabled={busy || !deckId || !elegido?.valid}
          data-testid="pvp-search"
        >
          Buscar rival
        </NxButton>
        <NxButton variant="ghost" onClick={onDecks}>Mis equipos</NxButton>
      </div>
    </Stage>
  );
}
