/**
 * DUEL MATCH ORCHESTRATOR (Fase 5).
 *
 * Convierte dos snapshots congelados en una partida jugable de 10 turnos y, al terminar, delega el
 * resultado en el Combat Resolver.
 *
 * REGLAS DE FLUJO ADOPTADAS (el PDF no las define; ver informe de Fase 5):
 *   · OPD-01 — UNA comparación por enfrentamiento. 10 cartas × 1 estadística = 10 turnos.
 *   · OPD-02 — el atacante declara carta y estadística; el defensor responde con carta y con la
 *     estadística que impone la tabla.
 *   · OPD-03 — el rol de atacante ALTERNA: 5 ataques por bando.
 *
 * Ninguna de las tres vive en el resolver: son decisiones de flujo y viven aquí.
 *
 * PURO: sin reloj, sin azar, sin red, sin estado global. Todas las acciones devuelven un objeto
 * NUEVO; nada se muta.
 */
import { COMBAT_MATCHUP, type CombatStatKey } from "@/domain/cards/combat";
import {
  CURRENT_COMBAT_RULES, getCombatRuleset, resolveCombat, resolveEncounter,
  validateSnapshotsForCombat,
  type CombatPlan, type CombatRuleset, type DeclaredEncounter, type Side,
} from "../combat";
import type { DuelDeckCard, DuelDeckSnapshot } from "../types";
import {
  ATTACKS_PER_SIDE, ORCHESTRATOR_VERSION, TURNS_PER_MATCH, emptyDraft,
  type DuelMatch, type DuelMatchResult, type DuelTurn, type MatchAction, type MatchError,
  type MatchView, type TurnPhase,
} from "./types";
import { ns, td } from "@/i18n/runtime";

const tr = ns("cardgame");

const other = (s: Side): Side => (s === "A" ? "B" : "A");

const fail = (match: DuelMatch, error: MatchError): MatchAction => ({ ok: false, error, match });

/** Cartas del bando indicado. */
const cardsOf = (m: DuelMatch, side: Side): DuelDeckCard[] =>
  (side === "A" ? m.snapshotA : m.snapshotB).cards;

/** uids ya consumidos por el bando indicado. */
const usedOf = (m: DuelMatch, side: Side): string[] => (side === "A" ? m.usedA : m.usedB);

/** Cartas todavía disponibles de un bando. */
export function availableCards(m: DuelMatch, side: Side): DuelDeckCard[] {
  const used = new Set(usedOf(m, side));
  return cardsOf(m, side).filter((c) => !used.has(c.uid));
}

/** Comprueba fase y devuelve el error si no corresponde. */
function requirePhase(m: DuelMatch, expected: TurnPhase): MatchError | null {
  if (m.status === "COMPLETED" || m.status === "DRAW" || m.status === "UNRESOLVED") {
    return { code: "MATCH_ALREADY_COMPLETE", turn: m.currentTurn };
  }
  if (m.phase !== expected) {
    return { code: "WRONG_PHASE", expectedPhase: expected, actualPhase: m.phase, turn: m.currentTurn };
  }
  return null;
}

/** Valida que una carta sea seleccionable por ese bando ahora mismo. */
function checkCard(m: DuelMatch, side: Side, uid: string): MatchError | null {
  if (!cardsOf(m, side).some((c) => c.uid === uid)) {
    return { code: "CARD_NOT_IN_SNAPSHOT", side, uid };
  }
  if (usedOf(m, side).includes(uid)) return { code: "CARD_ALREADY_USED", side, uid };
  return null;
}

// ───────────────────────────── Arranque ─────────────────────────────

export interface StartMatchInput {
  /** Id inyectado. El dominio NUNCA genera identificadores. */
  id: string;
  snapshotA: DuelDeckSnapshot;
  snapshotB: DuelDeckSnapshot;
  /** Quién ataca el primer turno. Explícito para no depender de la paridad del turno. */
  firstAttacker?: Side;
  /**
   * Reglas de resultado con las que se jugará. Por defecto, las vigentes. Se congelan en la
   * partida: reanudar una partida guardada NO la reinterpreta con reglas nuevas.
   */
  rules?: CombatRuleset;
}

/**
 * Crea la partida y prepara el turno 1.
 *
 * Valida los dos snapshots con la MISMA función que usa el resolver, así que una partida nunca
 * empieza con una entrada que después el resolver rechazaría.
 */
export function startDuelMatch(input: StartMatchInput): MatchAction {
  const { id, snapshotA, snapshotB, firstAttacker = "A", rules = CURRENT_COMBAT_RULES } = input;

  const blank: DuelMatch = {
    id,
    orchestratorVersion: ORCHESTRATOR_VERSION,
    combatRulesVersion: rules.version,
    snapshotA, snapshotB,
    status: "WAITING",
    phase: "NOT_STARTED",
    currentTurn: 0,
    attacker: null,
    draft: emptyDraft(),
    turns: [],
    usedA: [], usedB: [],
    scoreA: 0, scoreB: 0, ties: 0,
    result: null,
  };

  const combatErrors = validateSnapshotsForCombat(snapshotA, snapshotB);
  if (combatErrors.length > 0) return fail(blank, { code: "INVALID_MATCH", combatErrors });

  return {
    ok: true,
    match: { ...blank, status: "IN_PROGRESS", phase: "ATTACKER_CARD", currentTurn: 1, attacker: firstAttacker },
  };
}

// ───────────────────────────── Selecciones ─────────────────────────────

/** El atacante elige con qué carta ataca. */
export function selectAttackerCard(m: DuelMatch, uid: string): MatchAction {
  const phaseErr = requirePhase(m, "ATTACKER_CARD");
  if (phaseErr) return fail(m, phaseErr);
  const cardErr = checkCard(m, m.attacker!, uid);
  if (cardErr) return fail(m, cardErr);
  return { ok: true, match: { ...m, phase: "ATTACKER_STAT", draft: { ...m.draft, attackerCardUid: uid } } };
}

/** El atacante declara la estadística. Cualquiera de las tres es legal para atacar. */
export function selectAttackerStat(m: DuelMatch, stat: CombatStatKey): MatchAction {
  const phaseErr = requirePhase(m, "ATTACKER_STAT");
  if (phaseErr) return fail(m, phaseErr);
  const uid = m.draft.attackerCardUid;
  if (!uid) return fail(m, { code: "MISSING_ATTACKER_CARD", turn: m.currentTurn });
  // Defensa en profundidad: la carta pudo quedar consumida en un estado cargado de fuera.
  if (usedOf(m, m.attacker!).includes(uid)) {
    return fail(m, { code: "STAT_ALREADY_CONSUMED", side: m.attacker!, uid });
  }
  return { ok: true, match: { ...m, phase: "DEFENDER_CARD", draft: { ...m.draft, attackerStat: stat } } };
}

/** El defensor elige con qué carta responde. */
export function selectDefenderCard(m: DuelMatch, uid: string): MatchAction {
  const phaseErr = requirePhase(m, "DEFENDER_CARD");
  if (phaseErr) return fail(m, phaseErr);
  const cardErr = checkCard(m, other(m.attacker!), uid);
  if (cardErr) return fail(m, cardErr);
  return { ok: true, match: { ...m, phase: "DEFENDER_STAT", draft: { ...m.draft, defenderCardUid: uid } } };
}

/**
 * El defensor declara su estadística. Solo es legal la que impone la tabla del PDF:
 * Stronghold↔Entryfrag y Gamesense↔Gamesense.
 */
export function selectDefenderStat(m: DuelMatch, stat: CombatStatKey): MatchAction {
  const phaseErr = requirePhase(m, "DEFENDER_STAT");
  if (phaseErr) return fail(m, phaseErr);
  const aStat = m.draft.attackerStat;
  if (!aStat) return fail(m, { code: "MISSING_ATTACKER_STAT", turn: m.currentTurn });
  if (COMBAT_MATCHUP[aStat] !== stat) {
    return fail(m, { code: "ILLEGAL_STAT_MATCHUP", stat, turn: m.currentTurn });
  }
  return { ok: true, match: { ...m, phase: "READY_TO_CONFIRM", draft: { ...m.draft, defenderStat: stat } } };
}

/** La estadística que el defensor DEBE declarar, dado lo que el atacante ya declaró. */
export function requiredDefenderStat(m: DuelMatch): CombatStatKey | null {
  return m.draft.attackerStat ? COMBAT_MATCHUP[m.draft.attackerStat] : null;
}

// ───────────────────────────── Confirmación del turno ─────────────────────────────

/**
 * Cierra el turno: resuelve el enfrentamiento con el resolver, actualiza el marcador y avanza.
 *
 * La comparación la hace `resolveEncounter`, que es del resolver. El orquestador NO compara valores.
 */
export function confirmTurn(m: DuelMatch): MatchAction {
  const phaseErr = requirePhase(m, "READY_TO_CONFIRM");
  if (phaseErr) return fail(m, phaseErr);

  const { attackerCardUid, attackerStat, defenderCardUid, defenderStat } = m.draft;
  if (!attackerCardUid) return fail(m, { code: "MISSING_ATTACKER_CARD", turn: m.currentTurn });
  if (!attackerStat) return fail(m, { code: "MISSING_ATTACKER_STAT", turn: m.currentTurn });
  if (!defenderCardUid) return fail(m, { code: "MISSING_DEFENDER_CARD", turn: m.currentTurn });
  if (!defenderStat) return fail(m, { code: "MISSING_DEFENDER_STAT", turn: m.currentTurn });

  const attacker = m.attacker!;
  const defender = other(attacker);

  // El resolver siempre razona en términos de bando A y bando B, no de atacante y defensor.
  const aUid = attacker === "A" ? attackerCardUid : defenderCardUid;
  const aStat = attacker === "A" ? attackerStat : defenderStat;
  const bUid = attacker === "A" ? defenderCardUid : attackerCardUid;
  const bStat = attacker === "A" ? defenderStat : attackerStat;

  const cardA = m.snapshotA.cards.find((c) => c.uid === aUid)!;
  const cardB = m.snapshotB.cards.find((c) => c.uid === bUid)!;
  const encounter = resolveEncounter(m.turns.length, cardA, aStat, cardB, bStat);

  const scoreA = m.scoreA + (encounter.outcome === "A" ? 1 : 0);
  const scoreB = m.scoreB + (encounter.outcome === "B" ? 1 : 0);
  const ties = m.ties + (encounter.outcome === "TIE" ? 1 : 0);

  const turn: DuelTurn = {
    number: m.currentTurn,
    attacker, defender,
    attackerCardUid, attackerStat, defenderCardUid, defenderStat,
    outcome: encounter.outcome,
    encounter,
    scoreAfterA: scoreA,
    scoreAfterB: scoreB,
  };

  const usedA = attacker === "A" ? [...m.usedA, attackerCardUid] : [...m.usedA, defenderCardUid];
  const usedB = attacker === "A" ? [...m.usedB, defenderCardUid] : [...m.usedB, attackerCardUid];

  const next: DuelMatch = {
    ...m,
    turns: [...m.turns, turn],
    usedA, usedB,
    scoreA, scoreB, ties,
    draft: emptyDraft(),
    currentTurn: m.currentTurn + 1,
    // OPD-03: el rol de atacante alterna. Se guarda explícito, no se deduce de la paridad.
    attacker: other(attacker),
    phase: "ATTACKER_CARD",
  };

  if (next.turns.length < TURNS_PER_MATCH) return { ok: true, match: next };

  return { ok: true, match: finishMatch(next) };
}

// ───────────────────────────── Cierre ─────────────────────────────

/** Reconstruye el `CombatPlan` a partir de los turnos jugados. */
export function buildCombatPlan(m: DuelMatch): CombatPlan {
  const encounters: DeclaredEncounter[] = m.turns.map((t) => {
    const attackerIsA = t.attacker === "A";
    return {
      aUid: attackerIsA ? t.attackerCardUid : t.defenderCardUid,
      aStat: attackerIsA ? t.attackerStat : t.defenderStat,
      bUid: attackerIsA ? t.defenderCardUid : t.attackerCardUid,
      bStat: attackerIsA ? t.defenderStat : t.attackerStat,
    };
  });
  return { encounters };
}

/**
 * Cierra la partida: pasa el plan completo al resolver y adopta SU resultado.
 *
 * El marcador final —incluido el punto del desempate— sale del resolver, no del recuento
 * incremental. El recuento incremental solo se usa para una comprobación de integridad: si no
 * coincide con el del resolver, se marca `integrityOk: false` y NO se corrige nada.
 */
function finishMatch(m: DuelMatch): DuelMatch {
  const plan = buildCombatPlan(m);
  // Las reglas de la partida, no las del binario: una partida guardada se cierra con las suyas.
  // Si la versión guardada es desconocida NO se sustituye por las actuales; se deja sin resultado.
  const rules = getCombatRuleset(m.combatRulesVersion);
  if (rules === null) return { ...m, phase: "FINISHED", status: "WAITING", result: null };
  const combat = resolveCombat(m.snapshotA, m.snapshotB, plan, rules);

  if (combat.status === "INVALID_INPUT") {
    // No debería ocurrir: el orquestador ya impidió cada jugada ilegal. Si pasa, es un error
    // interno y se deja visible en vez de fabricar un resultado.
    return { ...m, phase: "FINISHED", status: "WAITING", result: null };
  }

  // Integridad: el recuento turno a turno debe coincidir con el del resolver ANTES del desempate.
  const raw = combat.encounters.reduce(
    (acc, e) => ({ ...acc, [e.outcome]: acc[e.outcome] + 1 }),
    { A: 0, B: 0, TIE: 0 } as Record<"A" | "B" | "TIE", number>,
  );
  const integrityOk = raw.A === m.scoreA && raw.B === m.scoreB && raw.TIE === m.ties;

  const result: DuelMatchResult = {
    matchId: m.id,
    orchestratorVersion: m.orchestratorVersion,
    combat,
    winner: combat.winner,
    loser: combat.loser,
    isDraw: combat.status === "DRAW",
    scoreA: combat.scoreA,
    scoreB: combat.scoreB,
    tiedEncounters: combat.tiedEncounters,
    integrityOk,
  };

  // El estado de la partida se ADOPTA del resolver; el orquestador no vuelve a decidir nada.
  const status: DuelMatch["status"] =
    combat.status === "DRAW" ? "DRAW"
    : combat.status === "UNRESOLVED_TIEBREAK" ? "UNRESOLVED"
    : "COMPLETED";

  return { ...m, phase: "FINISHED", status, attacker: null, result };
}

// ───────────────────────────── Vista ─────────────────────────────

const ALL_STATS: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

/** Proyección de solo lectura para la interfaz. Se calcula; no se guarda. */
export function matchView(m: DuelMatch): MatchView {
  const attacker = m.attacker;
  const defender = attacker ? other(attacker) : null;
  const usedASet = new Set(m.usedA);
  const usedBSet = new Set(m.usedB);

  const attackerChoices = attacker && m.phase === "ATTACKER_CARD" ? availableCards(m, attacker) : [];
  const defenderChoices = defender && m.phase === "DEFENDER_CARD" ? availableCards(m, defender) : [];
  const required = requiredDefenderStat(m);
  const statChoices =
    m.phase === "ATTACKER_STAT" ? ALL_STATS
    : m.phase === "DEFENDER_STAT" && required ? [required]
    : [];

  return {
    matchId: m.id,
    status: m.status,
    phase: m.phase,
    turn: m.currentTurn,
    attacker, defender,
    scoreA: m.scoreA, scoreB: m.scoreB, ties: m.ties,
    attackerChoices, defenderChoices, statChoices,
    draft: m.draft,
    usedA: m.snapshotA.cards.filter((c) => usedASet.has(c.uid)),
    usedB: m.snapshotB.cards.filter((c) => usedBSet.has(c.uid)),
    availableA: m.snapshotA.cards.filter((c) => !usedASet.has(c.uid)),
    availableB: m.snapshotB.cards.filter((c) => !usedBSet.has(c.uid)),
    history: m.turns,
    result: m.result,
  };
}

// ───────────────────────────── Explicación ─────────────────────────────

/** Frase de un rechazo del orquestador. Los códigos nunca se muestran al jugador. */
export function explainMatchError(e: MatchError): string {
  switch (e.code) {
    case "INVALID_MATCH":
      return tr("La partida no puede empezar: los mazos no cumplen el contrato ({v} problemas).", { v: e.combatErrors?.length ?? 0 });
    case "WRONG_PHASE":
      return tr("Ahora no toca esa acción: la partida espera «{expectedPhase}» y se intentó «{actualPhase}».", { expectedPhase: td(e.expectedPhase), actualPhase: td(e.actualPhase) });
    case "CARD_ALREADY_USED":
      return tr("Esa carta ya se usó en un turno anterior y no puede volver a jugarse.");
    case "CARD_NOT_IN_SNAPSHOT":
      return tr("Esa carta no está en tu mazo de esta partida.");
    case "STAT_ALREADY_CONSUMED":
      return tr("Esa carta ya gastó su estadística.");
    case "ILLEGAL_STAT_MATCHUP":
      return tr("Esa estadística no puede enfrentarse a la declarada por el atacante.");
    case "MISSING_ATTACKER_CARD":
      return tr("Falta elegir la carta atacante.");
    case "MISSING_ATTACKER_STAT":
      return tr("Falta declarar la estadística del atacante.");
    case "MISSING_DEFENDER_CARD":
      return tr("Falta elegir la carta defensora.");
    case "MISSING_DEFENDER_STAT":
      return tr("Falta declarar la estadística del defensor.");
    case "MATCH_ALREADY_COMPLETE":
      return tr("La partida ya ha terminado.");
    case "INVALID_PLAN":
      return tr("El plan de la partida no es válido.");
  }
}

/** Línea de historial de un turno, lista para mostrar. */
export function explainTurn(t: DuelTurn): string {
  const winner = t.outcome === "TIE" ? "empate" : `gana ${t.outcome}`;
  return tr("Turno {number} · ataca {attacker} · {reason} · {winner}", { number: t.number, attacker: t.attacker, reason: td(t.encounter.reason), winner });
}
