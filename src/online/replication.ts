/**
 * REPLICATION SYSTEM — snapshot + delta + reconstrucción determinista (Online Fase 1/7).
 *
 * REUTILIZA el ÚNICO Gameplay: `createMatch`/`stepMatch` (flujo) + `tick` (sim) + `applyCommand`/
 * `applyCall` (intención). El `RoundState` YA es el World Snapshot (serializable). Dos formatos:
 *  • LOCKSTEP: seed + input log ⇒ reconstrucción BYTE A BYTE vía `tick` (jugadores + replay).
 *  • SNAPSHOT/DELTA: para observadores/late-join que no simulan (solo pintan). Determinista.
 */
import { createMatch, stepMatch, type MatchState, type MatchConfig } from "@/match";
import { tick, applyCall, type RoundState, type CoachCallId } from "@/sim";
import { applyCommand, type CoachCommandId } from "@/coach";
import type { TimedCommand, InputLog, RoundSnapshot, RoundDelta, PlayerDelta, MatchScalars } from "./types";

// ───────────────────────────── Input log (representación autoritativa) ─────────────────────────────

export function newInputLog(seed: number): InputLog { return { seed, commands: [] }; }
export function appendCommand(log: InputLog, cmd: TimedCommand): InputLog { return { ...log, commands: [...log.commands, cmd] }; }
export function commandsForRound(log: InputLog, round: number): TimedCommand[] { return log.commands.filter((c) => c.round === round); }

/** Aplica al tick actual de la ronda los comandos que le corresponden. Determinista. */
export function applyRoundCommands(round: RoundState, cmds: TimedCommand[]): RoundState {
  let r = round;
  for (const c of cmds) {
    if (c.tick !== r.tick) continue;
    r = c.kind === "command" ? applyCommand(r, c.id as CoachCommandId) : applyCall(r, { id: c.id as CoachCallId });
  }
  return r;
}

/** Conduce un partido COMPLETO reutilizando el flujo + sim, con los comandos por ronda. Determinista. */
export function driveMatch(config: MatchConfig, cmdsFor: (roundIdx: number) => TimedCommand[]): MatchState {
  let m = createMatch(config);
  let roundIdx = 0, guard = 0;
  while (m.phase !== "MATCH_END" && guard++ < 100000) {
    if (m.phase === "ROUND_RUNNING" && m.currentRound && m.currentRound.phase !== "ENDED") {
      let r = m.currentRound;
      const cmds = cmdsFor(roundIdx);
      let g2 = 0;
      while (r.phase !== "ENDED" && g2++ < 6000) { r = applyRoundCommands(r, cmds); r = tick(r); }
      m = stepMatch(m, () => r);
      roundIdx++;
    } else {
      m = stepMatch(m);
    }
  }
  return m;
}

/** Reconstruye un partido desde seed + input log (replay / lockstep). BYTE A BYTE con el servidor. */
export function reconstruct(config: MatchConfig, log: InputLog): MatchState {
  return driveMatch(config, (roundIdx) => commandsForRound(log, roundIdx));
}

// ───────────────────────────── Escalares + snapshot ─────────────────────────────

export function matchScalars(m: MatchState): MatchScalars {
  return { phase: m.phase, roundNumber: m.roundNumber, currentHomeSide: m.currentHomeSide, score: { home: m.score.home, away: m.score.away }, winner: m.winner };
}

export function snapshotRound(m: MatchState, serverTick: number): RoundSnapshot {
  return { serverTick, round: m.currentRound ? structuredClone(m.currentRound) : null, match: matchScalars(m) };
}

// ───────────────────────────── Delta (render, para observadores) ─────────────────────────────

export function diffRound(prev: RoundState | null, next: RoundState | null, serverTick: number, match?: MatchScalars): RoundDelta | null {
  if (!next) return null;
  const prevById = new Map((prev?.players ?? []).map((p) => [p.id, p]));
  const players: PlayerDelta[] = [];
  for (const p of next.players) {
    const q = prevById.get(p.id);
    if (!q || q.pos.x !== p.pos.x || q.pos.y !== p.pos.y || q.facing !== p.facing || q.alive !== p.alive || q.hp !== p.hp || q.intent !== p.intent || q.targetEnemyId !== p.targetEnemyId) {
      players.push({ id: p.id, pos: { x: p.pos.x, y: p.pos.y }, facing: p.facing, alive: p.alive, hp: p.hp, intent: p.intent, targetEnemyId: p.targetEnemyId });
    }
  }
  const sameRound = !!prev && prev.seed === next.seed;
  const events = next.events.slice(sameRound ? prev!.events.length : 0);
  return { serverTick, roundTick: next.tick, phase: next.phase, players, events, spike: next.spike, winner: next.winner, match };
}

/** Aplica un delta sobre el espejo del cliente (observador). Devuelve una ronda nueva. */
export function applyDelta(round: RoundState | null, delta: RoundDelta): RoundState | null {
  if (!round) return null;
  const r = structuredClone(round);
  r.tick = delta.roundTick; r.phase = delta.phase; r.spike = delta.spike; r.winner = delta.winner;
  const byId = new Map(r.players.map((p) => [p.id, p]));
  for (const d of delta.players) {
    const p = byId.get(d.id);
    if (!p) continue;
    if (d.pos) p.pos = d.pos;
    if (d.facing !== undefined) p.facing = d.facing;
    if (d.alive !== undefined) p.alive = d.alive;
    if (d.hp !== undefined) p.hp = d.hp;
    if (d.intent !== undefined) p.intent = d.intent as typeof p.intent;
    if (d.targetEnemyId !== undefined) p.targetEnemyId = d.targetEnemyId;
  }
  r.events = [...r.events, ...delta.events];
  return r;
}
