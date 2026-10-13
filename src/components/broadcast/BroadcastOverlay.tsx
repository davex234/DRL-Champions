"use client";

/**
 * Broadcast Overlay — la capa visual de retransmisión sobre el campo. Orquesta los
 * componentes tontos que muestran el `BroadcastState` + el RoundState en vivo (para
 * las fichas de jugador) + economía + momentum. `pointer-events-none` → no bloquea.
 *
 * Jerarquía: marcador VCT (ancla) > banner de momento (hype) > kill feed > fichas de
 * jugador (contexto) > dock integrado (plan/winprob/momentum/MVP/observado).
 */
import type { BroadcastState } from "@/broadcast";
import type { RoundState } from "@/sim";
import { executeProbability, mapReads } from "@/utility";
import { Scoreboard } from "./Scoreboard";
import { ProPlayerStrip } from "./ProPlayerStrip";
import { KillFeed } from "./KillFeed";
import { EventBanner } from "./EventBanner";
import { BroadcastDock } from "./BroadcastDock";
import { CompositionHUD } from "./CompositionHUD";
import { MapStateHUD, CoachReadTicker } from "./MapHUD";

export function BroadcastOverlay({ bs, snap, creditsByName, names, momentum, cardArtByName }: {
  bs: BroadcastState;
  /** FASE 51.1 · nombre (minúsculas) → WebP de SU carta, para los titulares del entrenador. Opcional. */
  cardArtByName?: Record<string, string>;
  snap: RoundState | null;
  creditsByName: Record<string, number>;
  names: { atk: string; def: string };
  momentum: number;
}) {
  const focusId = bs.observer.focusPlayerId;
  const execProb = snap ? executeProbability(snap) : 50;
  const read = snap?.map ? (mapReads(snap)[0] ?? null) : null;
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* Marcador (arriba-centro) */}
      <div className="absolute left-1/2 top-0 origin-top -translate-x-1/2 max-sm:scale-[0.8]" data-broadcast="scoreboard">
        <Scoreboard match={bs.match} atk={bs.teams.atk} def={bs.teams.def} names={names} loadout={bs.loadout} />
      </div>

      {/* Fichas de jugador (rails laterales) */}
      {snap && (
        <>
          <div className="absolute left-2 top-20 hidden md:block"><ProPlayerStrip snap={snap} side="ATK" align="left" creditsByName={creditsByName} focusId={focusId} cardArtByName={cardArtByName} /></div>
          <div className="absolute right-2 top-20 hidden md:block"><ProPlayerStrip snap={snap} side="DEF" align="right" creditsByName={creditsByName} focusId={focusId} cardArtByName={cardArtByName} /></div>
        </>
      )}

      {/* Composición + mapa vivo (arriba-izquierda) */}
      {snap?.composition && (
        <div className="absolute left-2 top-2 hidden space-y-1.5 lg:block">
          <CompositionHUD composition={snap.composition} names={names} />
          {snap.map && <MapStateHUD map={snap.map} execProb={execProb} />}
        </div>
      )}

      {/* Read del coach (centro-izquierda, sobre el dock) */}
      <div className="absolute bottom-16 left-2 hidden md:block"><CoachReadTicker read={read} /></div>

      {/* Kill feed (arriba-derecha, bajo el marcador en móvil) */}
      <div className="absolute right-2 top-2 md:right-44"><KillFeed items={bs.events.killFeed} /></div>

      {/* Banner central de momentos */}
      <EventBanner bs={bs} />

      {/* Dock integrado (franja inferior) */}
      <div className="absolute inset-x-2 bottom-2"><BroadcastDock bs={bs} momentum={momentum} /></div>
    </div>
  );
}
