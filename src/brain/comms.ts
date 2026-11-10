/**
 * BRAIN ENGINE — COMUNICACIÓN entre compañeros.
 *
 * No se comparte texto: se comparte INFORMACIÓN, y VIAJA (llega con retraso y con menos
 * confianza). Un IGL/jugador comunicativo difunde mejor; uno callado, peor. La comms
 * modifica la MEMORIA del resto del equipo — nunca teletransporta la verdad.
 */
import type { Identity } from "../sim/identity/traits";
import type { RoundState, SimPlayer } from "../sim/types";
import type { CommMessage } from "./types";

/** Calidad de la información que emite un jugador (0..1) según su ADN social. */
export function commQuality(id: Identity): number {
  return Math.max(0.3, Math.min(1, 0.4 + (id.communication / 100) * 0.5 + (id.leadershipDrive / 100) * 0.12));
}

/** Retardo (ticks) hasta que la llamada "llega": el comunicativo informa antes. */
export function commDelay(id: Identity): number {
  return 5 + Math.round((1 - id.communication / 100) * 16);
}

/** Encola un mensaje (lo emite quien percibe algo relevante). */
export function emitComm(s: RoundState, p: SimPlayer, type: CommMessage["type"], extra: Partial<CommMessage> = {}): void {
  if (!s.comms) return;
  const id = p.identity;
  s.comms.push({
    id: `${p.id}-${type}-${s.tick}`,
    from: p.id, side: p.side, type,
    sentTick: s.tick, arriveTick: s.tick + commDelay(id), quality: commQuality(id),
    ...extra,
  });
}

/**
 * Entrega a `p` las llamadas de sus compañeros que YA han llegado, modificando su
 * memoria con confianza reducida (info de segunda mano). No borra los mensajes (otros
 * compañeros también los reciben); el motor los caduca después.
 */
export function deliverComms(s: RoundState, p: SimPlayer): void {
  if (!s.comms || !p.brain) return;
  const mem = p.brain.memory;
  for (const m of s.comms) {
    if (m.side !== p.side || m.from === p.id || m.arriveTick > s.tick) continue;
    const conf = m.quality * 0.7; // info de un compañero: fiable, no perfecta
    switch (m.type) {
      case "contact":
        if (m.enemyId && m.pos) {
          const prev = mem.enemies[m.enemyId];
          if (!prev || m.sentTick > prev.tick) mem.enemies[m.enemyId] = { pos: m.pos, tick: m.sentTick, baseConf: conf, source: "comm" };
        }
        break;
      case "spike":
        if (m.pos && (!mem.spike || m.sentTick > mem.spike.tick)) mem.spike = { pos: m.pos, tick: m.sentTick, conf };
        break;
      case "util_spent":
        if (m.zone) mem.utilSeen.push({ zone: m.zone, tick: m.sentTick, conf });
        break;
      // "clear" / "rotate" / "need_help": el cerebro los lee del estado del equipo;
      // aquí solo refrescan la confianza de la memoria de zona.
      default:
        break;
    }
  }
}

/** Caduca mensajes ya entregados hace tiempo (mantiene la cola pequeña). */
export function expireComms(s: RoundState): void {
  if (!s.comms) return;
  s.comms = s.comms.filter((m) => s.tick - m.arriveTick < 50);
}
