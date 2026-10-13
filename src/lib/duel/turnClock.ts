/**
 * F72.8 · EL RELOJ DE LAS DECISIONES HUMANAS — puro, compartido por PvE y PvP.
 *
 * Una partida no puede quedarse esperando para siempre a una persona. Cada decisión humana (atacar: carta + estadística
 * en la misma jugada; defender: carta, con la estadística que impone la tabla) tiene `TURN_DECISION_SECONDS`. Al vencer,
 * el SERVIDOR juega por ella una decisión válida y la partida sigue.
 *
 * ─────────────────────────── QUIÉN DECIDE QUÉ ───────────────────────────
 *
 *   · El plazo lo fija el servidor al empezar cada decisión (`turn_deadline_at` de `duel_matches`, la columna que el PvP
 *     ya tenía desde 0031 y que el PvE deja de ignorar: sin migración). Aquí solo se dice CUÁNDO empieza una decisión
 *     nueva (`decisionKey`) y cuánto dura.
 *   · La jugada automática la elige `autoDecision`: determinista (hash del id de la partida, el turno, el tipo de
 *     decisión y el bando) y validada por el ORQUESTADOR —se prueba carta a carta con las mismas funciones que una
 *     jugada humana—, así que nunca es ilegal y, para la misma decisión vencida, siempre es la misma: recargar no
 *     cambia la carta. No optimiza nada: es una jugada válida, no una IA.
 *   · El cliente solo PINTA `deadline − ahora del servidor`. Ni un `setTimeout` ni el reloj del navegador deciden nada.
 *
 * No toca el motor: `domain/cardgame/match` (orquestador y resolver) no cambia; esto se apoya en su API pública.
 */
import {
  requiredDefenderStat, selectAttackerCard, selectAttackerStat, selectDefenderCard, selectDefenderStat,
  type CombatStatKey, type DuelMatch, type Side,
} from "@/domain/cardgame/match";
import { actingSide } from "@/domain/cardgame/opponent/controller";
import { fnv1a32 } from "@/domain/cardgame/hints";

/** LA duración de una decisión humana. Único sitio donde se fija: todo lo demás deriva de aquí. */
export const TURN_DECISION_SECONDS = 30;
export const TURN_DECISION_MS = TURN_DECISION_SECONDS * 1000;
/** A partir de aquí el contador gana énfasis; y en los últimos, urgencia. */
export const TIMER_WARN_SECONDS = 10;
export const TIMER_CRITICAL_SECONDS = 5;

export type DecisionKind = "ATTACK" | "DEFENSE";

/** Registro público de una decisión que jugó el servidor. Sin carta ni estadística: solo cuándo y de quién. */
export interface DecisionTimeout { turn: number; side: Side; kind: DecisionKind }

/** El estado persistido lleva, junto al del motor, las decisiones que se agotaron (el motor lo ignora). */
export type ClockedMatch = DuelMatch & { timeouts?: DecisionTimeout[] };

export const timeoutsOf = (m: DuelMatch): DecisionTimeout[] => {
  const t = (m as ClockedMatch).timeouts;
  return Array.isArray(t) ? t : [];
};

const STATS: readonly CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

/**
 * Identidad de la decisión humana pendiente: turno + tipo + bando. `null` si no le toca decidir a nadie (partida
 * terminada o fase intermedia). El plazo se reinicia SOLO cuando esta clave cambia; recargar, reconectar o repetir
 * peticiones no la cambian, y por eso no reinician nada.
 */
export function decisionKey(m: DuelMatch): string | null {
  const side = actingSide(m);
  if (side === null) return null;
  return `${m.currentTurn}:${m.attacker === side ? "ATTACK" : "DEFENSE"}:${side}`;
}

/** Plazo de la decisión que empieza en `now` (`null` si no hay decisión pendiente). */
export const deadlineFor = (m: DuelMatch, now: number, ms = TURN_DECISION_MS): number | null =>
  decisionKey(m) === null ? null : now + ms;

/**
 * DUEL GAMEPLAY UX 2.0 · EL RELOJ SOLO EXISTE CONTRA PERSONAS. Contra un BOT (PvE, campaña, Draft) la persona puede
 * pensar lo que quiera: no hay plazo, ni jugada automática, ni derrota por tiempo. El reloj existe para que una persona
 * no deje esperando para siempre a OTRA persona; un bot no espera a nadie. PvP, ranked, privadas y torneos (todo lo que
 * pasa por `duelsPvp`) conservan EXACTAMENTE su reloj.
 *
 * Única regla para decidir el plazo de una decisión según el rival. `vsBot` lo decide el servicio por el MODO de la
 * fila (`duel_matches.mode`), nunca el cliente.
 */
export function decisionDeadline(vsBot: boolean, m: DuelMatch, now: number): number | null {
  return vsBot ? null : deadlineFor(m, now);
}

export interface AutoDecision {
  side: Side;
  kind: DecisionKind;
  cardUid: string;
  stat: CombatStatKey;
  /** El estado tras aplicar la decisión, exactamente como si la hubiera enviado la persona (antes de confirmar). */
  match: DuelMatch;
}

/**
 * LA JUGADA AUTOMÁTICA de la decisión pendiente. Determinista y siempre legal.
 *
 * Cartas candidatas = la mano de quien debe decidir (snapshot menos usadas), en orden estable de uid. Se empieza en
 * `hash % n` y se prueba con el orquestador hasta la primera legal; atacando, la estadística se elige igual entre las
 * tres. Defendiendo, la estadística NO se elige: la impone `requiredDefenderStat`, como siempre.
 */
export function autoDecision(m: DuelMatch): AutoDecision | null {
  const side = actingSide(m);
  if (side === null) return null;
  const attacking = m.attacker === side;
  if (m.phase !== (attacking ? "ATTACKER_CARD" : "DEFENDER_CARD")) return null;

  const snap = side === "A" ? m.snapshotA : m.snapshotB;
  const used = new Set(side === "A" ? m.usedA : m.usedB);
  const hand = snap.cards.map((c) => c.uid).filter((u) => !used.has(u)).sort();
  if (hand.length === 0) return null;

  const kind: DecisionKind = attacking ? "ATTACK" : "DEFENSE";
  const seed = `${m.id}|${m.currentTurn}|${kind}|${side}`;
  const start = fnv1a32(`${seed}|card`) % hand.length;
  const statStart = fnv1a32(`${seed}|stat`) % STATS.length;

  for (let i = 0; i < hand.length; i++) {
    const cardUid = hand[(start + i) % hand.length];
    if (attacking) {
      const a = selectAttackerCard(m, cardUid);
      if (!a.ok) continue;
      for (let j = 0; j < STATS.length; j++) {
        const stat = STATS[(statStart + j) % STATS.length];
        const b = selectAttackerStat(a.match, stat);
        if (b.ok) return { side, kind, cardUid, stat, match: b.match };
      }
    } else {
      const d = selectDefenderCard(m, cardUid);
      if (!d.ok) continue;
      const forced = requiredDefenderStat(d.match);
      if (!forced) continue;
      const s = selectDefenderStat(d.match, forced);
      if (s.ok) return { side, kind, cardUid, stat: forced, match: s.match };
    }
  }
  return null;
}

/** Añade al estado el registro de la decisión agotada (conservando los anteriores del estado de partida). */
export function recordTimeout(next: DuelMatch, prev: DuelMatch, t: DecisionTimeout | null): ClockedMatch {
  const list = timeoutsOf(prev);
  return { ...next, timeouts: t ? [...list, t] : list };
}

// ───────────────────────────── presentación (cliente) ─────────────────────────────

/**
 * Milisegundos que quedan, en el reloj del SERVIDOR: `serverNow` es su hora al responder y `receivedAt` la del
 * navegador al recibirla, así que un reloj de dispositivo adelantado o atrasado no cambia la cuenta.
 */
export function remainingMs(deadlineAt: number | null | undefined, serverNow: number, receivedAt: number, clientNow: number): number | null {
  if (deadlineAt === null || deadlineAt === undefined || !Number.isFinite(deadlineAt)) return null;
  const nowOnServer = serverNow + (clientNow - receivedAt);
  return Math.max(0, deadlineAt - nowOnServer);
}

export type TimerUrgency = "normal" | "warn" | "critical" | "expired";

export function timerUrgency(ms: number): TimerUrgency {
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return "expired";
  if (s <= TIMER_CRITICAL_SECONDS) return "critical";
  if (s <= TIMER_WARN_SECONDS) return "warn";
  return "normal";
}

/** «00:30». Siempre redondeando hacia arriba: se ve 00:01 hasta que de verdad llega a cero. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
