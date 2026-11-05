/**
 * SPECTATOR SESSION — un observador READ-ONLY sobre el stream de `RoundState` (Online Fase 5/7).
 *
 * Consume el MISMO dato en vivo (del servidor) o en replay (del ReplayPlayer) — un único sistema.
 * NUNCA modifica el estado (seguridad: observador ≠ jugador). Reutiliza `LiveDirector`/
 * `ReplayDirector` + los modos de cámara. Determinista dado el mismo stream.
 */
import type { RoundState, SimEvent } from "../sim";
import type { Director, DirectorDecision } from "./types";
import { createLiveDirector } from "./director";
import { createReplayDirector } from "./replayDirector";
import { initCamera, resolveCamera, type ObserverCameraMode, type ObserverCameraState } from "./cameras";

export type SpectatorKind = "live" | "replay";

export interface ObserverFrame { tick: number; decision: DirectorDecision; camera: ObserverCameraState }

export class SpectatorSession {
  readonly kind: SpectatorKind;
  private director: Director;
  private cam: ObserverCameraState = initCamera();
  private history: RoundState[] = [];

  constructor(kind: SpectatorKind = "live") { this.kind = kind; this.director = kind === "replay" ? createReplayDirector() : createLiveDirector(); }

  setMode(mode: ObserverCameraMode): void { this.cam = { ...this.cam, mode }; }
  focus(playerId: string | null): void { this.cam = { ...this.cam, focusPlayerId: playerId, mode: playerId ? "player" : this.cam.mode }; }
  setFree(pos: { x: number; y: number }): void { this.cam = { ...this.cam, mode: "free", freePos: pos }; }
  camera(): ObserverCameraState { return this.cam; }
  reset(): void { this.director.reset(); this.history = []; this.cam = initCamera(); }

  /** Observa un `RoundState` (NUNCA lo muta) y devuelve el frame de realización. */
  observe(state: RoundState, events?: SimEvent[]): ObserverFrame {
    this.history = [...this.history, state].slice(-40);
    const decision = this.director.decide({ state, tick: state.tick, events: events ?? state.events, history: this.kind === "replay" ? this.history : undefined });
    this.cam = resolveCamera(this.cam.mode, decision, this.cam.focusPlayerId, this.cam.freePos);
    return { tick: state.tick, decision, camera: this.cam };
  }
}
