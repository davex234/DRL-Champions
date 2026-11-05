/**
 * PROYECCIÓN DE PARTIDA → MODELO DE VISTA (Bloque 7.5).
 *
 * Convierte un `DuelMatch` del motor en el `DuelMatchView` que consume el tablero, **desde el
 * punto de vista de un bando concreto**.
 *
 * ─────────────────────── POR QUÉ ESTE FICHERO EXISTE ───────────────────────
 *
 * Esta proyección vivía dentro de `server/services/duels.ts` como `toPublicView`, y tenía el
 * bando del jugador **cableado a `A`**: `snapshotA` era «lo mío» y `snapshotB` «lo del rival».
 * Para el duelo contra un bot eso era correcto —el humano siempre es A— y quedó anotado como
 * deuda **R11** desde el bloque 7.2: *«`toPublicView` de PvE cableado a `snapshotA`. PvP no lo
 * usa»*.
 *
 * En PvP el humano es A **o** B. Había dos salidas:
 *
 *   1. Escribir una segunda proyección para PvP → dos implementaciones del mismo mapeo, que es
 *      exactamente cómo dos vistas del mismo dato acaban discrepando.
 *   2. Sacar la que ya existe a un módulo PURO y parametrizar el bando.
 *
 * Se ha hecho lo segundo. `toPublicView` sigue existiendo y sigue significando lo mismo: ahora
 * es una llamada a `buildMatchView` con `side: "A"`, así que el PvE se comporta byte a byte
 * igual (lo comprueban las 7 llamadas de `duel.test.ts`). **R11 queda resuelta.**
 *
 * ─────────────────────── POR QUÉ AQUÍ Y NO EN `server/` ───────────────────────
 *
 * `server/services/duels.ts` importa `@supabase/supabase-js`. Importarlo desde un componente de
 * cliente arrastraría el SDK entero al paquete del navegador. Este módulo es **puro**: solo
 * depende de tipos y de funciones del dominio (`requiredDefenderStat`, `explainCombatReason`),
 * así que lo pueden usar el servidor y el navegador sin arrastrar nada.
 *
 * ─────────────────────── LO QUE ESTE FICHERO NO HACE ───────────────────────
 *
 * No decide nada. No calcula quién gana, ni el desempate, ni el marcador, ni el turno, ni la
 * estadística obligada: todo eso lo trae ya resuelto el `DuelMatch` que llega, que lo escribió
 * el motor en el servidor. Aquí solo se **reordena** desde una perspectiva.
 *
 * Tampoco calcula recompensas. `result.award` sale `null` y lo rellena el PvE, que es el único
 * modo que tiene economía. En PvP se queda en `null` y no se pinta.
 */
import { timeoutsOf } from "./turnClock";
import type { CombatStatKey } from "@/domain/cards/combat";
import { explainCombatReason } from "@/domain/cardgame/combat";
import { requiredDefenderStat, type DuelMatch, type Side } from "@/domain/cardgame/match";
import { DUEL_DECK_SIZE, type DuelDeckCard } from "@/domain/cardgame";
import type { CardRegistry } from "@/collection/registry";
import type { HiddenCardHint } from "@/domain/cardgame/hints";
import type { RoleId } from "@/domain/cards/types";
import type { DuelDeckCardDTO, DuelMatchView, DuelTurnView, BotDifficulty } from "./types";

/** El bando contrario. */
const other = (s: Side): Side => (s === "A" ? "B" : "A");

/**
 * Carta → DTO.
 *
 * El registro entra por parámetro porque `CardRegistry` se instancia una vez por proceso y este
 * módulo no debe crear la suya: en el servidor ya hay una viva y en el navegador también.
 */
export function toCardDTO(c: DuelDeckCard, registry: CardRegistry): DuelDeckCardDTO {
  const player = registry.player(c.playerId);
  return {
    uid: c.uid,
    cardId: c.cardId,
    playerId: c.playerId,
    nick: c.playerName,
    team: c.team,
    country: player?.country ?? "",
    role: c.role,
    region: c.region,
    variantId: c.variantId,
    ovr: c.ovr,
    combat: c.combat,
    serial: c.serial,
  };
}

/**
 * Turno ya jugado, desde la perspectiva de `side`. Todo esto ocurrió a la vista de los dos.
 *
 * `you`/`rival` se cruzan según el bando: para B, «tú» es el encuentro `b` y el marcador tuyo es
 * `scoreAfterB`. Ese cruce es LA razón de ser del parámetro.
 *
 * FASE 33 · CORREGIDO. `attacker` y `outcome` se copiaban tal cual del motor (bando A/B absoluto)
 * mientras `you`/`rival` sí se cruzaban. Toda la presentación lee `outcome === "A"` como «ganas tú»
 * y `attacker === "A"` como «atacaste tú»: correcto para A (PvE, y el jugador A del PvP), pero al
 * jugador B de un PvP se le pintaba cada turno ganado como perdido. Ahora los dos se expresan desde
 * quien mira. Es la proyección, no el motor: el turno persistido no cambia.
 */
export function toTurnView(m: DuelMatch, i: number, side: Side): DuelTurnView {
  const t = m.turns[i];
  const mine = side === "A" ? t.encounter.a : t.encounter.b;
  const theirs = side === "A" ? t.encounter.b : t.encounter.a;
  return {
    number: t.number,
    attacker: side === "A" ? t.attacker : other(t.attacker),
    outcome: side === "A" || t.outcome === "TIE" ? t.outcome : t.outcome === "A" ? "B" : "A",
    scoreAfterYou: side === "A" ? t.scoreAfterA : t.scoreAfterB,
    scoreAfterRival: side === "A" ? t.scoreAfterB : t.scoreAfterA,
    you: { uid: mine.uid, nick: mine.playerName, team: mine.team, role: mine.role, stat: mine.stat, value: mine.value },
    rival: { uid: theirs.uid, nick: theirs.playerName, team: theirs.team, role: theirs.role, stat: theirs.stat, value: theirs.value },
    reason: t.encounter.reason,
  };
}

export interface BuildMatchViewOptions {
  /** Bando del espectador. `A` en PvE (el humano siempre es A); en PvP lo dice el servidor. */
  side: Side;
  registry: CardRegistry;
  /**
   * Concepto de PvE. En PvP no significa nada y no se pinta: la pantalla usa `rivalLabel`.
   * Se conserva en el tipo porque el tablero de PvE lo lee y cambiar eso sería tocar el PvE.
   */
  difficulty: BotDifficulty;
  /**
   * Texto con el que el tablero nombra al rival. En PvE se deja vacío y el tablero usa la
   * etiqueta de dificultad de siempre; en PvP se pasa «Rival», que es todo lo que se puede decir
   * de la otra persona sin filtrar quién es.
   */
  rivalLabel?: string;
  /**
   * F71 · Pistas de las cartas ocultas del rival, YA CALCULADAS EN EL SERVIDOR (PvE: `toPublicView` /
   * `toDraftView`, con el mazo del bot entero). En PvP no se pasan: llegan dentro del estado que
   * proyectó `projectMatchFor` (`rivalHints`). Aquí solo se copian; esta función no las calcula.
   */
  rivalHints?: readonly (HiddenCardHint | null)[];
  /** DUEL GAMEPLAY UX 2.0 · roles canónicos de las cartas ocultas, alineados con `rivalHints` (mismo origen, mismo orden). */
  rivalRoles?: readonly (RoleId | null)[];
  /** AJUSTE · pista + rol de la carta que el rival comprometió atacando (`committedRivalHint`, en servidor). */
  rivalCommitted?: RivalCommittedHint | null;
}

/** Pista pública + rol canónico de la carta comprometida del rival: lo ÚNICO que viaja de ella antes de la revelación. */
export type RivalCommittedHint = { hint: HiddenCardHint | null; role: RoleId | null };

const ROLES: ReadonlySet<string> = new Set(["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"]);

/**
 * Construye la vista de UNA partida para UN bando.
 *
 * LA FRONTERA DEL SECRETO NO ESTÁ AQUÍ, y conviene decirlo: en PvP el `DuelMatch` que llega ya
 * viene redactado por `projectMatchFor` (bloque 7.2), así que el mazo oculto del rival
 * sencillamente no está en los datos de entrada. Esta función no «esconde» nada — no puede
 * enseñar lo que no ha recibido. Lo único que hace con las cartas del rival es lo mismo que
 * hacía en PvE: enseñar las jugadas y contar las que quedan.
 */
export function buildMatchView(m: DuelMatch & { rivalHints?: readonly (HiddenCardHint | null)[]; rivalRoles?: readonly (RoleId | null)[]; rivalCommitted?: RivalCommittedHint | null }, opts: BuildMatchViewOptions): DuelMatchView {
  const { side, registry, difficulty, rivalLabel } = opts;
  // Una por carta oculta; si faltan o no cuadran con el recuento público, no se enseña ninguna.
  const hintsIn = opts.rivalHints ?? m.rivalHints ?? [];
  const rolesIn = opts.rivalRoles ?? m.rivalRoles ?? [];
  const committedIn = opts.rivalCommitted ?? m.rivalCommitted ?? null;
  const rivalSide = other(side);

  const mySnap = side === "A" ? m.snapshotA : m.snapshotB;
  const rivalSnap = side === "A" ? m.snapshotB : m.snapshotA;
  const usedMine = new Set(side === "A" ? m.usedA : m.usedB);
  const usedRival = new Set(side === "A" ? m.usedB : m.usedA);

  const attacker = m.attacker;
  const iAmAttacker = attacker === side;
  const draft = m.draft;
  const card = (c: DuelDeckCard): DuelDeckCardDTO => toCardDTO(c, registry);

  /*
   * DUEL GAMEPLAY UX 2.0 · el rival atacó y COMPROMETIÓ su carta, pero la carta es SECRETA hasta que respondas: de ella
   * solo es pública la ESTADÍSTICA declarada (tu respuesta la impone la tabla). La carta aparece en `lastTurn` cuando el
   * turno se cierra con tu respuesta ya comprometida. Aquí no se busca ni se proyecta la carta: solo se copian su pista y
   * su rol públicos (`committedIn`), calculados en servidor igual que los de la fila superior.
   */
  const rivalCommitted = !iAmAttacker && attacker !== null && Boolean(draft.attackerStat);

  const result = m.result;
  const myScore = (a: number, b: number): number => (side === "A" ? a : b);
  const rivalScore = (a: number, b: number): number => (side === "A" ? b : a);

  return {
    matchId: m.id,
    difficulty,
    rivalLabel,
    status: m.status,
    phase: m.phase,
    turn: m.currentTurn,
    totalTurns: 10,
    attacker,
    youAreAttacker: iAmAttacker,
    /*
     * Durante la partida el marcador es el recuento turno a turno del orquestador. Al TERMINAR
     * pasa a ser el del Combat Resolver, que puede diferir en un punto por el desempate. El
     * resolver es la autoridad, así que la cabecera no puede seguir enseñando el recuento
     * intermedio cuando ya hay resultado.
     */
    scoreYou: result ? myScore(result.scoreA, result.scoreB) : myScore(m.scoreA, m.scoreB),
    scoreRival: result ? rivalScore(result.scoreA, result.scoreB) : rivalScore(m.scoreA, m.scoreB),
    ties: m.ties,
    yourHand: mySnap.cards.filter((c) => !usedMine.has(c.uid)).map(card),
    yourUsed: mySnap.cards.filter((c) => usedMine.has(c.uid)).map(card),
    // Del rival solo lo jugado. Lo que le queda es un número, no una lista.
    rivalUsed: rivalSnap.cards.filter((c) => usedRival.has(c.uid)).map(card),
    /*
     * FASE 26 · CORREGIDO. Se restaba sobre `rivalSnap.cards.length`, y en PvP ese snapshot llega
     * REDACTADO (solo cartas jugadas + la declarada): la mano rival salía con 0 o 1 reversos y
     * la mesa decía «Rival · 1 carta» a mitad de partida. Un mazo de duelo tiene SIEMPRE
     * `DUEL_DECK_SIZE` cartas (lo garantiza la validación del dominio), así que lo que le queda
     * al rival es ese tamaño menos lo jugado — un número público que no revela ninguna carta.
     */
    rivalRemaining: Math.max(0, DUEL_DECK_SIZE - usedRival.size),
    /*
     * F71 · UNA pista pública por carta oculta ({ tipo, valor }: país, liga, equipo o rol). Copia
     * defensiva de solo dos campos: aunque llegara algo más en el objeto, no se reenvía.
     */
    rivalHints: hintsIn.length === Math.max(0, DUEL_DECK_SIZE - usedRival.size)
      ? hintsIn.map((h) => (h ? { type: h.type, value: h.value } : null))
      : [],
    // DUEL GAMEPLAY UX 2.0 · el rol de cada carta oculta, alineado con sus pistas; solo valores canónicos.
    rivalRoles: hintsIn.length === Math.max(0, DUEL_DECK_SIZE - usedRival.size) && rolesIn.length === hintsIn.length
      ? rolesIn.map((r) => (r && ROLES.has(r) ? r : null))
      : [],
    yourDeckName: mySnap.deckName,
    // Fase 43 · id del equipo PROPIO (para «Ajustar equipo»); nunca el del rival.
    yourDeckId: mySnap.deckId ?? null,
    yourSumOvr: mySnap.cards.reduce((s, c) => s + c.ovr, 0),
    /*
     * En PvP esto NO es la suma real del mazo del rival: el snapshot que llega solo tiene sus
     * cartas jugadas, así que la suma es de lo visible. Es correcto —no se puede sumar lo que no
     * se ve— y la pantalla de PvP no lo enseña como un total de mazo.
     */
    rivalSumOvr: rivalSnap.cards.reduce((s, c) => s + c.ovr, 0),
    // Copia defensiva: de la carta comprometida solo salen { tipo, valor } de su pista y un rol canónico.
    pendingRival: rivalCommitted && draft.attackerStat
      ? { committed: true, stat: draft.attackerStat, hint: committedIn?.hint ? { type: committedIn.hint.type, value: committedIn.hint.value } : null, role: committedIn?.role && ROLES.has(committedIn.role) ? committedIn.role : null }
      : null,
    requiredStat: requiredDefenderStat(m),
    yourDraftCardUid: iAmAttacker ? draft.attackerCardUid : draft.defenderCardUid,
    yourDraftStat: iAmAttacker ? draft.attackerStat : draft.defenderStat,
    history: m.turns.map((_, i) => toTurnView(m, i, side)),
    lastTurn: m.turns.length > 0 ? toTurnView(m, m.turns.length - 1, side) : null,
    result: result
      ? {
          winner: result.winner === null ? null : result.winner === side ? "YOU" : "RIVAL",
          isDraw: result.isDraw,
          scoreYou: myScore(result.scoreA, result.scoreB),
          scoreRival: rivalScore(result.scoreA, result.scoreB),
          tiedEncounters: result.tiedEncounters,
          decidedBy: result.combat.decidedBy,
          reason: explainCombatReason(result.combat),
          sumOvrYou: side === "A"
            ? result.combat.tiebreak?.sumOvrA ?? null
            : result.combat.tiebreak?.sumOvrB ?? null,
          sumOvrRival: side === "A"
            ? result.combat.tiebreak?.sumOvrB ?? null
            : result.combat.tiebreak?.sumOvrA ?? null,
          statTotalYou: myScore(result.combat.statTotalA, result.combat.statTotalB),
          statTotalRival: rivalScore(result.combat.statTotalA, result.combat.statTotalB),
          rulesVersion: result.combat.resolverVersion,
          /*
           * La recompensa es de PvE y la rellena `toPublicView` después de llamar aquí. Este
           * módulo no sabe de economía y no debe: PvP no paga créditos ni XP.
           */
          award: null,
        }
      : null,
    // F72.8 · decisiones agotadas que jugó el servidor, desde este bando. Solo turno y tipo: ninguna carta.
    timeouts: timeoutsOf(m).map((t) => ({ turn: t.turn, kind: t.kind, you: t.side === side })),
  };
}

export type { CombatStatKey };
