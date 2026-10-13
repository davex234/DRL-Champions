/**
 * FASE 66 · reparte la evidencia (API real, dos clientes, soak) en los entregables por tema. Sin red, sin BD.
 *   npx tsx scripts/multiplayer/_fase66-report.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
const D = join(process.cwd(), "docs/product/qa/fase66-multiplayer");
const rd = (f: string) => (existsSync(join(D, f)) ? JSON.parse(readFileSync(join(D, f), "utf8")) : null);
const wr = (f: string, o: unknown) => writeFileSync(join(D, f), JSON.stringify(o, null, 2) + "\n");

const e2e = rd("e2e-two-clients.json");
const soak = rd("soak.json");
const api = (n: string) => rd(`${n}.api.json`);
const m1 = e2e?.matches?.[0];
const chaos = (k: string) => (m1?.chaosLog ?? []).find((x: any) => x[k])?.[k] ?? null;

wr("queue-concurrency.json", { realServer: api("queue-concurrency"), e2eQueueF5: chaos("queueF5"), soakDoubleAccept: soak?.invariants?.doubleAcceptOneMatch, soakDoubleMatchGuard: soak?.doubleMatchGuard });
wr("turn-concurrency.json", { realServer: api("turn-concurrency"), unit: "src/server/services/{duels,duelsPvp}.concurrency.service.test.ts (13 casos, rojo→verde en pve-race-BEFORE.txt / pve-pvp-race-AFTER.txt)", pveRealServer: api("reward-integrity")?.pve?.sameTurnTen, e2eDoubleClick: (m1?.chaosLog ?? []).filter((x: any) => x.turn <= 2) });
wr("idempotency.json", { model: { pvp: "actionId (UUID por gesto) + PK (match_id, action_id); reintento = éxito idempotente, también si llega a la vez que el original (F66)", pve: "state_version condicionada + carta de un solo uso: el reintento de una jugada ya aplicada se rechaza (409) y nunca se aplica dos veces", queue: "índice único parcial por usuario (10 JOIN = 1 entrada)", rating: "índice único duel_pvp_rating_events_once", rewards: "ref duel:<matchId> en el libro mayor + cupo diario atómico" }, realServer: api("idempotency"), pveLostResponse: api("reward-integrity")?.pve?.lostResponseRetry });
wr("refresh-matrix.json", {
  method: "F5 real (Page.reload) en el cliente de Chrome durante la partida caos, más lecturas de estado por API",
  rows: [
    { when: "cola", result: chaos("queueF5"), expectation: "misma entrada, sin ticket nuevo" },
    { when: "turno 3 (cliente B)", result: chaos("f5B"), expectation: "vuelve a la misma partida y turno" },
    { when: "acción en vuelo (cliente A)", result: chaos("pendingActionF5"), expectation: "la jugada aparece como mucho UNA vez" },
    { when: "resultado", result: m1?.resultF5 ?? null, expectation: "no se repite Elo/recompensa" },
    { when: "PvE `active` tras F5", result: api("reward-integrity")?.pve?.refresh },
  ],
  notCoveredByAutomation: ["F5 exactamente en VS / presentación de equipo / desempate: cubiertos por F61 (?resultado=, recuperación desde servidor) y por la regla general: el cliente no guarda estado de partida, todo sale de GET"],
});
wr("disconnect.json", {
  definition: "No hay presencia en tiempo real (sin WebSocket). «Desconectado» = el cliente deja de sondear/actuar. El servidor no lo detecta como evento: el RELOJ DEL TURNO (90 s, turn_deadline_at) es lo único que corre. Si el que debía mover no lo hace, la partida VENCE (EXPIRED) en el primer sondeo del rival, en el siguiente alta en cola de cualquiera de los dos, o por el barrido oportunista (duel_pvp_expired_candidates). Cerrar la pestaña no depende de beforeunload (no existe ninguno).",
  temporaryDisconnect: chaos("tempDisconnect"),
});
wr("reconnect.json", { e2e: chaos("tempDisconnect"), client: "pvpPoller: fallos de red = STALE + backoff 1-10 s y sigue; al volver adopta el estado (versión estrictamente mayor). Cola: F66 sigue sondeando con backoff tras un fallo de red (antes se paraba)." });
wr("abandon.json", { rules: "PvP: abandonar = derrota (ranked mueve rating una vez; privado sin rating); la fila se conserva con closed_by. PvE: abandonar en curso borra la fila (sin pago); F66: una partida TERMINADA ya no se borra (409).", realServer: { finishedAbandonTen: api("result-integrity")?.finishedAbandonAttempts, pveFinished: api("reward-integrity")?.pve?.finish?.postFinishStatuses }, soak: { lifecycles: soak?.invariants?.lifecycles, chaos: soak?.invariants?.chaosEvents, playVsAbandon: (soak?.matches ?? []).filter((m: any) => m.raceOutcome).map((m: any) => ({ match: m.matchId, statuses: m.raceOutcome, final: m.final?.lifecycle })) }, unit: "duelsPvp.concurrency: jugar contra abandonar ×8 y abandonar ×10 concurrentes" });
wr("security.json", { realServer: api("security"), unit: "duelsPvp.concurrency.service.test.ts (IDOR, turno ajeno, versión vieja/futura)" });
wr("privacy.json", { realServer: api("privacy"), note: "404 idéntico byte a byte para partida ajena e inexistente (F66); sin correos ni ids de usuario del rival en el cable" });
wr("latency.json", { method: "Network.emulateNetworkConditions en el cliente A (Chrome) rotando 0/100/300/800/1500 ms por turno", perTurn: (m1?.chaosLog ?? []).filter((x: any) => x.turn), note: "fb = estado del botón justo tras el clic: debe estar deshabilitado/«enviando» y sin ganador optimista" });
wr("chaos.json", { match1: m1 ? { chaosLog: m1.chaosLog, turns: m1.turns, final: m1.final, allTurnsConsistent: m1.allTurnsConsistent } : null, soakChaos: soak?.invariants?.chaosEvents });
wr("soak.summary.json", soak ? { mode: soak.mode, seconds: soak.seconds, invariants: soak.invariants, doubleMatchGuard: soak.doubleMatchGuard } : null);
wr("rate-limits.json", { policy: { pvp_sync: "150/min", pvp_action: "40/min", mm_status: "90/min", mm_write: "20/min", social_write: "30/min" }, realServer: api("rate-limits"), normalMatchNever429: (e2e?.matches ?? []).every((m: any) => !((m.network?.A?.byStatus ?? {})["429"]) && !((m.network?.B?.byStatus ?? {})["429"])) });
wr("network-profile.json", { perMatch: (e2e?.matches ?? []).map((m: any) => ({ idx: m.idx, chaos: m.chaos, A: m.network?.A, B: m.network?.B, idleAfterResult: m.idleAfterResult })), pollingPolicy: "partida: 1,2 s turno rival · 2,5 s turno propio · 15 s pestaña oculta · backoff 1-10 s; cola: 2 s / 6 s oculta; una sola petición en vuelo; se para al terminar", note: "la partida caos recarga la página (los contadores se reinician): el perfil representativo es el de las partidas 2…N" });
wr("result-integrity.json", { realServer: api("result-integrity"), e2e: (e2e?.matches ?? []).map((m: any) => ({ idx: m.idx, final: m.final?.result, recomputed: m.final?.recomputed, sameFacts: m.final?.sameFacts })), soak: { recomputedAgrees: soak?.invariants?.resultRecomputedAgrees, played: soak?.invariants?.played } });
wr("elo-integrity.json", { realServer: api("elo-integrity"), e2e: (e2e?.matches ?? []).map((m: any) => ({ idx: m.idx, once: m.final?.elo?.once, before: m.final?.elo?.before, after: m.final?.elo?.after })), soakRatingUnchanged: soak?.invariants?.ratingUnchanged, resultF5: m1?.resultF5 });
wr("reward-integrity.json", { realServer: api("reward-integrity"), soakCreditsUnchanged: soak?.invariants?.creditsUnchanged, pvpRankedRewards: "PvP no paga créditos/XP (solo rating), comprobado en código: duelsPvp no llama a award()" });
console.log("entregables escritos");
