/**
 * CORE GAMEPLAY 2.0 — AYUDANTES DE PRESENTACIÓN (Fase 26).
 *
 * Módulo PURO: sin React, sin red, sin `window`. Traduce lo que el servidor YA decidió a textos y
 * selecciones de pantalla. Aquí no hay ni una regla del juego:
 *
 *   · la legalidad del mazo la dice `DuelDeckDTO.valid` / `missingByRole` (validada en servidor);
 *   · el veredicto de un turno es `DuelTurnView.outcome` (Combat Resolver);
 *   · cómo se decidió la partida es `DuelResultView.decidedBy` con sus cifras;
 *   · la «carta destacada» es una SELECCIÓN sobre el historial, no un cálculo de combate: se elige
 *     la carta tuya que ganó su turno por más margen. Si ninguna ganó, la de mayor valor jugado.
 *
 * Si este fichero desapareciera, el juego seguiría siendo correcto: solo cambiaría lo que se lee.
 */
import { DUEL_ROLES } from "@/domain/cardgame/types";
import type { RoleId } from "@/domain/cards/types";
import { STAT_INFO, type DuelDeckDTO, type DuelMatchView, type DuelResultView, type DuelTurnView } from "./types";
import { ns, td } from "@/i18n/runtime";

const tr = ns("duel");

/* ───────────────────────────── pre-partida ───────────────────────────── */

export interface DeckReadiness {
  ready: boolean;
  /** Roles que faltan, en el orden del dominio, con cuántas cartas faltan de cada uno. */
  missing: { role: RoleId; count: number }[];
  /** «Faltan 1 Duelista y 2 Centinelas», o «Listo para jugar». */
  summary: string;
}

const PLURAL: Record<RoleId, string> = {
  Duelista: "Duelistas", Controlador: "Controladores", Iniciador: "Iniciadores", Centinela: "Centinelas", Flex: "Flex",
};

/** Lee la validación que ya hizo el servidor y la pone en una frase. No revalida nada. */
export function deckReadiness(deck: Pick<DuelDeckDTO, "valid" | "missingByRole" | "cards" | "errors">): DeckReadiness {
  if (deck.valid) return { ready: true, missing: [], summary: tr("Listo para jugar") };
  const missing = DUEL_ROLES
    .map((role) => ({ role, count: deck.missingByRole?.[role] ?? 0 }))
    .filter((m) => m.count > 0);
  if (missing.length === 0) {
    // Ilegal por otro motivo (jugador repetido, carta que ya no se posee…): el servidor lo explica.
    const why = deck.errors?.[0]?.message ?? tr("El equipo no es válido todavía");
    return { ready: false, missing, summary: why };
  }
  const parts = missing.map((m) => `${m.count} ${td(m.count === 1 ? m.role : PLURAL[m.role])}`);
  const list = parts.length <= 1 ? parts.join("") : tr("{list} y {last}", { list: parts.slice(0, -1).join(", "), last: parts[parts.length - 1] });
  return { ready: false, missing, summary: missing.reduce((s, m) => s + m.count, 0) === 1 ? tr("Falta {list}", { list }) : tr("Faltan {list}", { list }) };
}

/** El mazo con el que se entra: el elegido si es legal; si no, el primero legal; si no, ninguno. */
export function pickStartableDeck(decks: DuelDeckDTO[], preferredId: string | null): DuelDeckDTO | null {
  const preferred = decks.find((d) => d.id === preferredId);
  if (preferred?.valid) return preferred;
  return decks.find((d) => d.valid) ?? null;
}

/* ───────────────────────────── turno ───────────────────────────── */

export type RoundKind = "win" | "loss" | "draw";

export interface RoundVerdict {
  kind: RoundKind;
  title: string;
  /** «Stronghold 78 contra Gamesense 71»: los nombres REALES de las estadísticas, nunca solo SH/GS/EF. */
  detail: string;
  /** Por qué no puntúa nadie, cuando empatan. */
  note: string | null;
}

export function roundVerdict(turn: Pick<DuelTurnView, "outcome" | "you" | "rival">): RoundVerdict {
  const you = `${STAT_INFO[turn.you.stat].label} ${turn.you.value}`;
  const rival = `${STAT_INFO[turn.rival.stat].label} ${turn.rival.value}`;
  if (turn.outcome === "TIE") {
    return { kind: "draw", title: tr("Empate"), detail: tr("{you} contra {rival}", { you, rival }), note: tr("Valores idénticos: nadie recibe punto y las dos cartas se gastan igual.") };
  }
  const win = turn.outcome === "A";
  return { kind: win ? "win" : "loss", title: win ? tr("Ganas el turno") : tr("Pierdes el turno"), detail: tr("{you} contra {rival}", { you, rival }), note: null };
}

/**
 * ESTADO DEL CERROJO DE LA JUGADA. Un solo sitio decide qué dice el botón de confirmar y si la mano
 * responde, para que PvE y PvP no tengan dos vocabularios.
 */
export interface LockCopy {
  /** Texto del botón de confirmar. */
  button: string;
  /** Texto corto sobre los controles. */
  status: string | null;
  /** La mano y los ejes no responden. */
  locked: boolean;
}

export function lockCopy(input: {
  busy: boolean;
  waitingRival: boolean;
  attacking: boolean;
  hasCard: boolean;
  hasStat: boolean;
}): LockCopy {
  if (input.waitingRival) return { button: tr("Esperando al rival…"), status: tr("El rival está decidiendo"), locked: true };
  // «Resolviendo…» es el texto que ya leen los scripts de QA mientras la jugada está en vuelo.
  if (input.busy) return { button: tr("Resolviendo…"), status: tr("Jugada enviada y bloqueada: el servidor resuelve el turno"), locked: true };
  if (!input.hasCard) return { button: tr("Elige una carta"), status: null, locked: false };
  if (input.attacking && !input.hasStat) return { button: tr("Elige una estadística"), status: null, locked: false };
  return { button: input.attacking ? tr("Declarar y atacar") : tr("Responder"), status: null, locked: false };
}

/* ───────────────────────────── final ───────────────────────────── */

export interface DecisionCopy {
  /** «Por marcador», «Desempate por suma de OVR»… */
  title: string;
  /** Explicación con las cifras que mandó el servidor. Vacía cuando decidió el marcador. */
  lines: string[];
  /** Hubo desempate más allá del marcador. */
  tiebreak: boolean;
}

/** Explica cómo se decidió la partida SOLO cuando hizo falta algo más que el marcador. */
export function decisionCopy(r: Pick<DuelResultView, "decidedBy" | "scoreYou" | "scoreRival" | "sumOvrYou" | "sumOvrRival" | "statTotalYou" | "statTotalRival" | "tiedEncounters">): DecisionCopy {
  switch (r.decidedBy) {
    case "OVR_TIEBREAK":
      return {
        title: tr("Desempate por suma de OVR"),
        tiebreak: true,
        lines: [
          r.tiedEncounters > 0
            ? tr("Los diez turnos acabaron igualados ({n, plural, one {# turno empatado} other {# turnos empatados}}).", { n: r.tiedEncounters })
            : tr("Los diez turnos acabaron igualados."),
          tr("Decidió la suma de OVR de los equipos: {v} contra {v2}. El desempate otorga un punto, por eso el marcador final es {scoreYou}–{scoreRival}.", { v: r.sumOvrYou ?? "—", v2: r.sumOvrRival ?? "—", scoreYou: r.scoreYou, scoreRival: r.scoreRival }),
        ],
      };
    case "STAT_MARGIN":
      return {
        title: tr("Desempate por estadística total"),
        tiebreak: true,
        lines: [
          tr("Marcador y suma de OVR quedaron igualados."),
          tr("Decidió la estadística total declarada en los diez turnos: {statTotalYou} contra {statTotalRival}. Este desempate no otorga punto.", { statTotalYou: r.statTotalYou, statTotalRival: r.statTotalRival }),
        ],
      };
    case "NONE":
      return { title: tr("Empate total"), tiebreak: true, lines: [tr("Marcador, suma de OVR y estadística total quedaron igualados. El empate es el resultado.")] };
    default:
      return { title: tr("Por marcador"), tiebreak: false, lines: [] };
  }
}

export interface FeaturedCard {
  uid: string;
  turn: number;
  /** Diferencia con la que ganó ese turno (0 si no ganó ninguno). */
  margin: number;
  /** Por qué es la destacada, en una frase. */
  why: string;
}

/**
 * LA CARTA DESTACADA. Se elige entre TUS cartas mirando el historial que mandó el servidor: la que
 * ganó su turno por más margen; a igualdad, la de valor más alto; si ninguna ganó, la de mayor valor
 * jugado. No se llama «MVP»: no mide nada del jugador, solo qué carta marcó la partida.
 */
export function featuredCard(history: readonly Pick<DuelTurnView, "number" | "outcome" | "you" | "rival">[]): FeaturedCard | null {
  if (history.length === 0) return null;
  let best: FeaturedCard | null = null;
  for (const t of history) {
    const margin = t.outcome === "A" ? t.you.value - t.rival.value : 0;
    const cand: FeaturedCard = {
      uid: t.you.uid,
      turn: t.number,
      margin,
      why: t.outcome === "A"
        ? tr("Ganó el turno {number} con {label} {value} contra {value2}.", { number: t.number, label: td(STAT_INFO[t.you.stat].label), value: t.you.value, value2: t.rival.value })
        : tr("Tu valor más alto de la partida: {label} {value} en el turno {number}.", { label: td(STAT_INFO[t.you.stat].label), value: t.you.value, number: t.number }),
    };
    if (!best) { best = cand; continue; }
    const better = margin > best.margin || (margin === best.margin && t.you.value > valueOf(history, best.turn));
    if (better) best = cand;
  }
  return best;
}

function valueOf(history: readonly Pick<DuelTurnView, "number" | "you">[], turn: number): number {
  return history.find((t) => t.number === turn)?.you.value ?? 0;
}

/** Cuenta los turnos por resultado leyendo `outcome`. Es un recuento del historial, no un marcador. */
export function roundTally(history: readonly Pick<DuelTurnView, "outcome">[]): { won: number; lost: number; tied: number } {
  let won = 0, lost = 0, tied = 0;
  for (const t of history) { if (t.outcome === "A") won++; else if (t.outcome === "B") lost++; else tied++; }
  return { won, lost, tied };
}

/* ───────────────────────────── intro ───────────────────────────── */

/**
 * Duración de la intro del duelo (entrada COMPLETA: rival → VS → equipo).
 * FASE 61 · es la suma de `ENTRANCE_MS` (`lib/duel/matchFlow`), fijada por test. Era 1,6 s / 0,5 s: con 0,5 s el
 * modo reducido —el que ve el usuario en su PC— se comía la presentación entera. Ahora conserva los tres tiempos.
 */
export const INTRO_MS = { full: 3_500, reduced: 2_900 } as const;
export const introDuration = (reduced: boolean): number => (reduced ? INTRO_MS.reduced : INTRO_MS.full);

/** Texto de la intro a partir de la vista que devolvió `start`. */
export function introCopy(view: Pick<DuelMatchView, "yourDeckName" | "yourSumOvr" | "rivalSumOvr" | "rivalLabel" | "youAreAttacker" | "totalTurns">, rivalName: string) {
  return {
    you: view.yourDeckName,
    rival: rivalName,
    youOvr: view.yourSumOvr,
    rivalOvr: view.rivalSumOvr,
    opening: view.youAreAttacker ? tr("Abres tú el primer turno") : tr("Abre el rival"),
    turns: tr("{totalTurns} turnos · una carta y una estadística por turno", { totalTurns: view.totalTurns }),
  };
}

/* ───────────────────────────── PvP ───────────────────────────── */

export type PvpConnectionKind = "IDLE" | "SYNCING" | "SYNCED" | "STALE" | "ERROR" | "TERMINAL";

/** Qué decir sobre la conexión. Solo se enseña algo cuando el jugador debe saber que se está recuperando. */
export function connectionCopy(status: PvpConnectionKind, hasSnapshot: boolean): { text: string; tone: "info" | "warn" | "bad" } | null {
  switch (status) {
    case "IDLE":
    case "SYNCING":
      return hasSnapshot ? null : { text: tr("Recuperando la partida…"), tone: "info" };
    case "STALE":
      // F66 · STALE cubre la red caída (reintenta sola) y el conflicto (se resincroniza al momento con el estado del 409).
      return { text: tr("Reconectando… sincronizando partida con el servidor"), tone: "warn" };
    case "ERROR":
      // F66 · ERROR solo llega con fallos que NO se reintentan (sesión caducada, partida inexistente): decirlo tal cual.
      return { text: tr("No se pudo recuperar la partida. Vuelve a entrar desde JUGAR"), tone: "bad" };
    default:
      return null;
  }
}

/** mm:ss de una cuenta que fija el servidor. Solo formato. */
export function mmss(ms: number | null): string | null {
  if (ms === null) return null;
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
