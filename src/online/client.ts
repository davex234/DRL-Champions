/**
 * ONLINE CLIENT — el cliente de juego (Online Fase 1/7).
 *
 * Compone el Connection Manager y maneja los paquetes de juego. Los JUGADORES hacen LOCKSTEP:
 * acumulan el input log (echo del servidor) y reconstruyen el MISMO partido byte a byte con `tick`
 * — no hay segunda simulación. Los OBSERVADORES mantienen un espejo por snapshot+delta. Offline:
 * el juego offline (`useCoachMatch`) NO cambia; el cliente puede además reconstruir localmente.
 */
import type { MatchState, MatchConfig } from "@/match";
import type { RoundState } from "@/sim";
import type { Transport } from "./transport";
import type { ClientIdentity, Packet, TimedCommand, InputLog, RoundSnapshot, RoundDelta, MatchScalars } from "./types";
import { ConnectionManager } from "./connection";
import { newInputLog, appendCommand, reconstruct, applyDelta } from "./replication";
import type { Lobby } from "./lobby";

type MatchStatePayload = { config?: MatchConfig; started?: boolean; log?: InputLog; scalars?: MatchScalars; ended?: boolean };

export class OnlineClient {
  readonly cm: ConnectionManager;
  config: MatchConfig | null = null;
  log: InputLog = newInputLog(0);
  lobby: Lobby | null = null;
  observerRound: RoundState | null = null;
  scalars: MatchScalars | null = null;
  matchEnded = false;

  constructor(transport: Transport, identity: ClientIdentity) {
    this.cm = new ConnectionManager(transport, identity);
    this.cm.onGamePacket((p) => this.onGame(p));
  }

  get identity(): ClientIdentity { return this.cm.identity; }
  get state() { return this.cm.getState(); }
  connect(now: number): void { this.cm.connect(now); }
  reconnect(now: number): void { this.cm.reconnect(now); }
  tick(now: number): void { this.cm.tick(now); }

  // ── lobby / control ──
  joinLobby(): void { this.cm.send("join_lobby", {}); }
  ready(v = true): void { this.cm.send("ready", { ready: v }); }
  start(): void { this.cm.send("start", {}); }
  resync(): void { this.cm.send("resync", {}); }
  /** Envía intención (comando de coach). El servidor valida y es autoritativo. */
  sendCommand(kind: "command" | "call", id: string, side: "home" | "away"): void {
    this.cm.send("command", { kind, id, side });
  }

  private onGame(p: Packet): void {
    switch (p.type) {
      case "lobby_state": this.lobby = p.payload as Lobby; break;
      case "match_state": {
        const pl = p.payload as MatchStatePayload;
        if (pl.config) { this.config = pl.config; if (pl.log) this.log = pl.log; }
        if (pl.scalars) { this.scalars = pl.scalars; if (pl.ended) this.matchEnded = true; }
        break;
      }
      case "command": this.log = appendCommand(this.log, p.payload as TimedCommand); break;
      case "snapshot": { const s = p.payload as RoundSnapshot; this.observerRound = s.round; this.scalars = s.match; break; }
      case "delta": { const d = p.payload as RoundDelta; this.observerRound = applyDelta(this.observerRound, d); if (d.match) this.scalars = d.match; break; }
      default: break;
    }
  }

  /** Reconstrucción AUTORITATIVA (lockstep): idéntica byte a byte al servidor. */
  reconstructMatch(): MatchState | null { return this.config ? reconstruct(this.config, this.log) : null; }
}
