/**
 * REPLAY ENGINE — grabación, integridad, versión y reconstrucción (Online Fase 5/7).
 *
 * REUTILIZA el ÚNICO Gameplay: `reconstruct` (partido completo determinista) + `createMatch`/
 * `stepMatch`/`tick`/`applyRoundCommands`/`commandsForRound` para reconstruir los estados
 * tick-a-tick de una ronda concreta (playback/seek). NO crea otro Replay/Match Engine. Checksum
 * FNV, compat de versión. PURO y DETERMINISTA.
 */
import { createMatch, stepMatch, type MatchConfig, type MatchState } from "@/match";
import { tick, type RoundState } from "@/sim";
import { reconstruct, applyRoundCommands, commandsForRound, matchScalars, type InputLog } from "@/online";
import { FULL_VERSION } from "@/platform/version";
import { REPLAY_VERSION, MIN_REPLAY_VERSION, type Replay, type ReplayMeta, type RoundBoundary } from "./types";

// ── Integridad / versión ──
function fnv1a(s: string): number { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Checksum determinista de una grabación (seed + comandos). */
export function checksumReplay(config: MatchConfig, log: InputLog): number {
  const cmds = log.commands.map((c) => `${c.round}:${c.tick}:${c.kind}:${c.id}:${c.side}`).join("|");
  return fnv1a(`${config.seed}#${log.seed}#${cmds}`);
}

export function isReplayCompatible(replay: { version: number }): boolean {
  return replay.version >= MIN_REPLAY_VERSION && replay.version <= REPLAY_VERSION;
}

/** Verifica un replay: versión compatible + checksum íntegro. Detecta replays inválidos. */
export function verifyReplay(replay: Replay): { ok: boolean; error?: string } {
  if (!isReplayCompatible(replay)) return { ok: false, error: `versión incompatible (${replay.version})` };
  if (checksumReplay(replay.config, replay.log) !== replay.checksum) return { ok: false, error: "checksum inválido (replay corrupto)" };
  return { ok: true };
}

// ── Grabación ──
/** Deriva los metadatos desde el estado final del partido. */
export function metaFrom(config: MatchConfig, final: MatchState, matchId: string, mode: string, region: string, players: ReplayMeta["players"]): ReplayMeta {
  const sc = matchScalars(final);
  return { matchId, mode, region, players, teamNames: config.teamNames ?? { home: "Home", away: "Away" }, createdAt: 0, durationTicks: final.totalTicks ?? 0, rounds: final.roundNumber, score: sc.score, winner: sc.winner };
}

/** Graba un replay a partir de la config + input log (incremental, sin duplicar snapshots). */
export function recordReplay(config: MatchConfig, log: InputLog, meta: Omit<ReplayMeta, "durationTicks" | "rounds" | "score" | "winner">): Replay {
  const final = reconstruct(config, log);
  const full = metaFrom(config, final, meta.matchId, meta.mode, meta.region, meta.players);
  return { version: REPLAY_VERSION, build: FULL_VERSION, meta: { ...full, matchId: meta.matchId, createdAt: meta.createdAt, teamNames: meta.teamNames }, config, log, checksum: checksumReplay(config, log), bookmarks: [] };
}

/** Graba desde un servidor online (usa su `config` + `log` autoritativos). */
export function recordFromServer(server: { config: MatchConfig | null; log: InputLog; match: MatchState | null }, matchId: string, mode: string, region: string, players: ReplayMeta["players"]): Replay | null {
  if (!server.config || !server.match) return null;
  const full = metaFrom(server.config, server.match, matchId, mode, region, players);
  return { version: REPLAY_VERSION, build: FULL_VERSION, meta: full, config: server.config, log: server.log, checksum: checksumReplay(server.config, server.log), bookmarks: [] };
}

// ── Reconstrucción tick-a-tick de una ronda (playback / seek) ──
/**
 * Devuelve los `RoundState` tick-a-tick de la ronda `round` (0-based). Reutiliza el flujo del
 * Match Engine + el sim. Determinista: mismo replay ⇒ mismos estados byte a byte.
 */
export function reconstructRoundStates(config: MatchConfig, log: InputLog, round: number): RoundState[] {
  let m = createMatch(config);
  let idx = 0, guard = 0;
  while (m.phase !== "MATCH_END" && guard++ < 100000) {
    if (m.phase === "ROUND_RUNNING" && m.currentRound && m.currentRound.phase !== "ENDED") {
      const cmds = commandsForRound(log, idx);
      let r = m.currentRound;
      if (idx === round) {
        const states: RoundState[] = [r];
        let g2 = 0;
        while (r.phase !== "ENDED" && g2++ < 6000) { r = applyRoundCommands(r, cmds); r = tick(r); states.push(r); }
        return states;
      }
      let g2 = 0;
      while (r.phase !== "ENDED" && g2++ < 6000) { r = applyRoundCommands(r, cmds); r = tick(r); }
      m = stepMatch(m, () => r); idx++;
    } else {
      m = stepMatch(m);
    }
  }
  return [];
}

/** Límites de todas las rondas del replay (para la timeline). Determinista. */
export function roundBoundaries(config: MatchConfig, log: InputLog): RoundBoundary[] {
  const final = reconstruct(config, log);
  return final.rounds.map((r, i) => ({ round: i, seed: r.seed, ticks: r.tick, winner: r.winner, endReason: r.endReason }));
}
