/**
 * ORCHESTRATOR — el ÚNICO flujo online en proceso (Online Fase 1/7).
 *
 *   Cliente → Online Session → Lobby → Server (autoritativo) → Match → Gameplay existente
 *
 * Monta un servidor + N clientes sobre un loopback DETERMINISTA (juego local / servidor en
 * proceso / tests). El mismo montaje sirve para dedicado/LAN/online cambiando solo el transporte.
 * Reloj LÓGICO por pasos. Sin Date.now/Math.random.
 */
import { LoopbackHub, loopbackClient, loopbackServerBus } from "./transport";
import { createServer, type OnlineServer } from "./server";
import { OnlineClient } from "./client";
import { makeIdentity } from "./identity";
import type { LobbyDraft } from "./lobby";
import type { ClientKind } from "./types";

export interface ClientSpec { name: string; kind?: ClientKind }

export interface LocalGame {
  hub: LoopbackHub;
  server: OnlineServer;
  clients: OnlineClient[];
  host: OnlineClient;
  /** Entrega todos los paquetes pendientes (drena el bus). */
  drain(): void;
  /** Un paso lógico completo: entrega + servidor + clientes + entrega. */
  step(): void;
  now(): number;
}

/** Crea un juego local (loopback) con un servidor y varios clientes. */
export function createLocalGame(draft: LobbyDraft, specs: ClientSpec[], opts: { latency?: number } = {}): LocalGame {
  const hub = new LoopbackHub(opts.latency ?? 0);
  const server = createServer(loopbackServerBus(hub), { lobbyDraft: draft });
  const clients = specs.map((s) => {
    const identity = makeIdentity(s.name, s.kind ?? "player");
    return new OnlineClient(loopbackClient(hub, identity.id), identity);
  });

  const drain = (): void => { let g = 0; while (hub.pendingCount() > 0 && g++ < 100) hub.pump(); };
  const step = (): void => {
    const now = hub.now;
    drain();                                   // procesa lo recibido (handshake/replies)
    server.tick(now);
    for (const c of clients) c.tick(now);
    drain();                                   // entrega lo enviado este paso
    hub.advance(1);
  };

  return { hub, server, clients, host: clients[0], drain, step, now: () => hub.now };
}

/** Conecta todos los clientes y estabiliza el handshake/auth. */
export function connectAll(game: LocalGame, steps = 6): void {
  for (const c of game.clients) c.connect(game.hub.now);
  for (let i = 0; i < steps; i++) game.step();
}

/** Corre el partido hasta MATCH_END (o `maxTicks`). Devuelve los ticks consumidos. */
export function runUntilMatchEnd(game: LocalGame, maxTicks = 200000): number {
  let t = 0;
  while (game.server.match && game.server.match.phase !== "MATCH_END" && t++ < maxTicks) game.step();
  return t;
}
