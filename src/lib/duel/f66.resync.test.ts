/**
 * F66 · RESINCRONIZACIÓN DEL CLIENTE PvP — el 409 trae el estado del servidor y el cliente lo adopta en el acto;
 * una respuesta vieja nunca pisa una nueva; un 4xx de jugada rechazada no se disfraza de «reconectando».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PvpMatchSnapshot, PvpSyncResponse } from "@/domain/cardgame/pvp";
import type { DuelMatch } from "@/domain/cardgame/match";
import { PvpSyncError, kindForStatus, createHttpTransport, type PvpSyncTransport, type PvpPlayInput } from "./pvpTransport";
import { PvpSyncPoller } from "./pvpPoller";

const MATCH = "11111111-1111-4111-8111-111111111111";
const match = (): DuelMatch => ({
  id: MATCH, orchestratorVersion: "duel-turns-2", combatRulesVersion: "duel-combat-2",
  snapshotA: { deckId: "", deckName: "", cards: [], dataVersion: "v", schemaVersion: 1, takenAt: 0, checksum: "c" },
  snapshotB: { deckId: "", deckName: "", cards: [], dataVersion: "v", schemaVersion: 1, takenAt: 0, checksum: "c" },
  status: "IN_PROGRESS", phase: "ATTACKER_CARD", currentTurn: 1, attacker: "A",
  draft: { attackerCardUid: null, attackerStat: null, defenderCardUid: null, defenderStat: null },
  turns: [], usedA: [], usedB: [], scoreA: 0, scoreB: 0, ties: 0, result: null,
});
const snap = (v: number): PvpMatchSnapshot => ({
  matchId: MATCH, mode: "PVP", lifecycle: "IN_TURN", stateVersion: v, yourSide: "A", expectedSide: "A", isYourTurn: true,
  closedBySide: null, match: match(), turnStartedAt: 0, turnDeadlineAt: null,
} as PvpMatchSnapshot);
const changed = (v: number): PvpSyncResponse => ({ changed: true, stateVersion: v, serverNow: 0, terminal: false, snapshot: snap(v) });

class ScriptTransport implements PvpSyncTransport {
  constructor(private onPlay: () => Promise<PvpSyncResponse>, private onFetch: () => Promise<PvpSyncResponse> = async () => changed(3)) {}
  fetchSince(): Promise<PvpSyncResponse> { return this.onFetch(); }
  play(_m: string, _i: PvpPlayInput): Promise<PvpSyncResponse> { return this.onPlay(); }
  abandon(): Promise<PvpSyncResponse> { return this.onPlay(); }
}
const deps = (t: PvpSyncTransport) => ({ transport: t, now: () => 0, setTimer: () => 0, clearTimer: () => undefined, createAbort: () => new AbortController() });

test("F66 · un 409 con estado se adopta AL MOMENTO (pestaña vieja / doble clic corregidos sin esperar al sondeo)", async () => {
  const p = new PvpSyncPoller(MATCH, deps(new ScriptTransport(async () => { throw new PvpSyncError("CONFLICT", "La partida cambió", 409, "STALE_VERSION", changed(7)); })));
  await p.play({ actionId: "x", expectedVersion: 5, cardUid: "c" });
  const s = p.getSnapshot();
  assert.equal(s.stateVersion, 7);
  assert.equal(s.snapshot?.stateVersion, 7);
  assert.equal(s.status, "SYNCED");
  p.dispose();
});

test("F66 · un 409 SIN estado deja el cliente marcado para pedir el estado completo (nunca se queda con el viejo)", async () => {
  const p = new PvpSyncPoller(MATCH, deps(new ScriptTransport(async () => { throw new PvpSyncError("CONFLICT", "cambió", 409, "STALE_VERSION"); })));
  await p.play({ actionId: "x", expectedVersion: 5, cardUid: "c" });
  assert.equal(p.getSnapshot().stateVersion, -1);
  assert.equal(p.getSnapshot().status, "STALE");
  p.dispose();
});

test("F66 · una jugada rechazada (400) es CONFLICTO que resincroniza, no «reconectando» con reintentos", () => {
  assert.equal(kindForStatus(400), "CONFLICT");
  assert.equal(kindForStatus(422), "CONFLICT");
  assert.equal(kindForStatus(409), "CONFLICT");
  assert.equal(kindForStatus(503), "SERVER");
  assert.equal(kindForStatus(401), "AUTH");
  assert.equal(kindForStatus(404), "NOT_FOUND");
});

test("F66 · el transporte HTTP entrega el estado del cuerpo del 409 al poller", async () => {
  const body = { error: "La partida cambió mientras jugabas", code: "STALE_VERSION", sync: changed(9) };
  const t = createHttpTransport(async () => ({}), (async () => new Response(JSON.stringify(body), { status: 409 })) as unknown as typeof fetch);
  await assert.rejects(t.play(MATCH, { actionId: "a", expectedVersion: 1, cardUid: "c" }), (e: unknown) => {
    assert.ok(e instanceof PvpSyncError);
    assert.equal(e.kind, "CONFLICT");
    assert.equal(e.sync?.stateVersion, 9);
    return true;
  });
});
