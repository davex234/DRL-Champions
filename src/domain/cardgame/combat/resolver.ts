/**
 * COMBAT RESOLVER (Fase 4).
 *
 * Recibe dos snapshots congelados y un plan de enfrentamientos, y produce un resultado
 * determinista, explicable y auditable.
 *
 * LO QUE IMPLEMENTA (reglas cerradas del PDF):
 *   · Tabla de emparejamientos SH↔EF y GS↔GS — CONSUMIDA de `@/domain/cards/combat`, no copiada.
 *   · Una estadística por carta; la carta no se vuelve a usar en la partida.
 *   · Gana el valor mayor del enfrentamiento.
 *   · Desempate por suma de las medias (OVR) de las 10 cartas, que otorga un punto.
 *
 * LO QUE EL PDF NO DEFINE, y que llega como REGLA EXPLÍCITA Y VERSIONADA desde `rules.ts`:
 *   · Qué pasa si dos valores son idénticos → OPD-05.
 *   · Qué pasa si las sumas del desempate también empatan → OPD-08.
 *
 * LO QUE SIGUE SIN DECIDIR: qué carta se enfrenta a cuál y quién declara la estadística. Eso llega
 * en el `CombatPlan` y lo produce el orquestador.
 *
 * SIGUE SIENDO LA ÚNICA AUTORIDAD MATEMÁTICA: marcador final, desempates, ganador y resultado
 * salen de aquí. El orquestador los adopta; nunca los recalcula.
 *
 * PROHIBIDO aquí, y verificado por tests: `Date.now`, `Math.random`, red, Supabase, localStorage,
 * React, catálogo, propiedad y cualquier estado global. El resolver solo mira lo que recibe.
 */
import { COMBAT_MATCHUP, type CombatStatKey } from "@/domain/cards/combat";
import { deckChecksum } from "../deck";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES, type DuelDeckCard, type RoleId } from "../types";
import { CURRENT_COMBAT_RULES, type CombatRuleset } from "./rules";
import {
  SUPPORTED_SNAPSHOT_SCHEMA,
  type CombatDecidedBy, type CombatError, type CombatPlan, type CombatResult,
  type DuelDeckSnapshot, type EncounterOutcome, type EncounterSide, type ResolvedEncounter,
  type Side, type SideInput,
} from "./types";

/** Lee una estadística del trío congelado. Único punto de acceso a `combat`. */
const statValue = (card: DuelDeckCard, stat: CombatStatKey): number => card.combat[stat];

/** Etiqueta legible de la estadística, para el audit trail. */
const STAT_LABEL: Record<CombatStatKey, string> = {
  stronghold: "Stronghold",
  gamesense: "Gamesense",
  entryfrag: "Entryfrag",
};

// ───────────────────────────── Validación de entrada ─────────────────────────────

/** Comprueba un snapshot contra el contrato. Devuelve los problemas encontrados. */
function validateSnapshot(snap: DuelDeckSnapshot, side: Side): CombatError[] {
  const errors: CombatError[] = [];

  if (snap.schemaVersion !== SUPPORTED_SNAPSHOT_SCHEMA) {
    errors.push({
      code: "SNAPSHOT_SCHEMA_UNSUPPORTED", side,
      expected: SUPPORTED_SNAPSHOT_SCHEMA, actual: snap.schemaVersion,
    });
  }

  if (snap.cards.length !== DUEL_DECK_SIZE) {
    errors.push({ code: "SNAPSHOT_SIZE", side, expected: DUEL_DECK_SIZE, actual: snap.cards.length });
  }

  // Composición 2 por rol.
  const counts = { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 } as Record<RoleId, number>;
  for (const c of snap.cards) counts[c.role]++;
  for (const role of DUEL_ROLES) {
    if (counts[role] !== DUEL_COMPOSITION[role]) {
      errors.push({ code: "SNAPSHOT_COMPOSITION", side, role, expected: DUEL_COMPOSITION[role], actual: counts[role] });
    }
  }

  // Instancias repetidas dentro del propio snapshot.
  const seen = new Set<string>();
  for (const c of snap.cards) {
    if (seen.has(c.uid)) errors.push({ code: "SNAPSHOT_DUPLICATE_CARD", side, uid: c.uid });
    seen.add(c.uid);
  }

  // Trío presente y en rango. Una carta sin combate no puede pelear.
  for (const c of snap.cards) {
    const t = c.combat;
    const bad = !t ||
      [t.stronghold, t.gamesense, t.entryfrag].some((v) => typeof v !== "number" || !Number.isFinite(v));
    if (bad) errors.push({ code: "SNAPSHOT_MISSING_COMBAT", side, uid: c.uid });
  }

  // Huella: si no cuadra, el snapshot se manipuló después de congelarlo.
  const expected = deckChecksum(snap.cards);
  if (expected !== snap.checksum) {
    errors.push({ code: "SNAPSHOT_CHECKSUM_MISMATCH", side, expected, actual: snap.checksum });
  }

  return errors;
}

/**
 * Valida los dos snapshots y su compatibilidad, SIN necesidad de un plan.
 *
 * Lo usa el orquestador de turnos al arrancar una partida: así comparte exactamente el mismo
 * contrato de entrada que el resolver, sin duplicar ni una comprobación.
 */
export function validateSnapshotsForCombat(
  a: DuelDeckSnapshot, b: DuelDeckSnapshot,
): CombatError[] {
  const errors = [...validateSnapshot(a, "A"), ...validateSnapshot(b, "B")];
  if (a.dataVersion !== b.dataVersion) {
    errors.push({ code: "DATA_VERSION_MISMATCH", expected: a.dataVersion, actual: b.dataVersion });
  }
  return errors;
}

/** Comprueba el plan contra los dos snapshots. */
function validatePlan(plan: CombatPlan, a: SideInput, b: SideInput): CombatError[] {
  const errors: CombatError[] = [];

  // Cada carta se usa EXACTAMENTE una vez: es la regla explícita del PDF, y con 10 cartas por
  // bando implica exactamente 10 enfrentamientos, que es lo que hace posible el marcador 5-5.
  if (plan.encounters.length !== DUEL_DECK_SIZE) {
    errors.push({ code: "PLAN_SIZE", expected: DUEL_DECK_SIZE, actual: plan.encounters.length });
  }

  const usedA = new Set<string>();
  const usedB = new Set<string>();
  for (const e of plan.encounters) {
    if (!a.byUid.has(e.aUid)) errors.push({ code: "PLAN_CARD_NOT_IN_SNAPSHOT", side: "A", uid: e.aUid });
    else if (usedA.has(e.aUid)) errors.push({ code: "PLAN_CARD_REUSED", side: "A", uid: e.aUid });
    else usedA.add(e.aUid);

    if (!b.byUid.has(e.bUid)) errors.push({ code: "PLAN_CARD_NOT_IN_SNAPSHOT", side: "B", uid: e.bUid });
    else if (usedB.has(e.bUid)) errors.push({ code: "PLAN_CARD_REUSED", side: "B", uid: e.bUid });
    else usedB.add(e.bUid);

    // El par declarado debe estar en la tabla del PDF. La tabla es una involución:
    // SH↔EF y GS↔GS, así que basta comprobarla en un sentido.
    if (COMBAT_MATCHUP[e.aStat] !== e.bStat) {
      errors.push({ code: "PLAN_ILLEGAL_MATCHUP", matchup: [e.aStat, e.bStat] });
    }
  }

  // Ninguna carta puede quedarse sin jugar: el mazo se agota.
  for (const c of a.snapshot.cards) if (!usedA.has(c.uid)) errors.push({ code: "PLAN_CARD_UNUSED", side: "A", uid: c.uid });
  for (const c of b.snapshot.cards) if (!usedB.has(c.uid)) errors.push({ code: "PLAN_CARD_UNUSED", side: "B", uid: c.uid });

  return errors;
}

// ───────────────────────────── Resolución de un enfrentamiento ─────────────────────────────

const sideOf = (card: DuelDeckCard, stat: CombatStatKey): EncounterSide => ({
  uid: card.uid,
  cardId: card.cardId,
  playerId: card.playerId,
  playerName: card.playerName,
  team: card.team,
  role: card.role,
  variantId: card.variantId,
  stat,
  value: statValue(card, stat),
});

/**
 * Resuelve UN enfrentamiento. Gana el valor mayor; si son idénticos, `TIE`.
 *
 * Compara EXCLUSIVAMENTE la estadística declarada. No mira el OVR, ni suma el trío, ni consulta
 * las seis estadísticas heredadas.
 */
export function resolveEncounter(
  index: number,
  cardA: DuelDeckCard,
  statA: CombatStatKey,
  cardB: DuelDeckCard,
  statB: CombatStatKey,
): ResolvedEncounter {
  const a = sideOf(cardA, statA);
  const b = sideOf(cardB, statB);

  const outcome: EncounterOutcome = a.value > b.value ? "A" : b.value > a.value ? "B" : "TIE";
  const sign = outcome === "A" ? ">" : outcome === "B" ? "<" : "=";
  const reason =
    `${a.playerName} ${STAT_LABEL[statA]} ${a.value} ${sign} ` +
    `${b.playerName} ${STAT_LABEL[statB]} ${b.value}`;

  return { index, a, b, outcome, reason };
}

// ───────────────────────────── Desempate ─────────────────────────────

/** Suma de las medias (OVR) de las 10 cartas. Es el criterio literal del PDF. */
export function sumOvr(cards: readonly DuelDeckCard[]): number {
  return cards.reduce((s, c) => s + c.ovr, 0);
}

/**
 * Suma del valor DECLARADO por cada bando en los enfrentamientos ya resueltos.
 *
 * Es el criterio del segundo desempate (OPD-08) y, a la vez, dato de auditoría que se guarda
 * siempre. No mira el mazo: mide lo que ocurrió en la partida, que es justo lo que permite
 * resolver un espejo, donde cualquier medida del mazo vale lo mismo para los dos bandos.
 */
export function statTotals(encounters: readonly ResolvedEncounter[]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const e of encounters) {
    a += e.a.value;
    b += e.b.value;
  }
  return { a, b };
}

// ───────────────────────────── Resolver ─────────────────────────────

const emptyResult = (
  a: DuelDeckSnapshot, b: DuelDeckSnapshot, errors: CombatError[], rules: CombatRuleset,
): CombatResult => ({
  status: "INVALID_INPUT",
  resolverVersion: rules.version,
  dataVersion: a.dataVersion === b.dataVersion ? a.dataVersion : "",
  schemaVersion: SUPPORTED_SNAPSHOT_SCHEMA,
  deckA: { deckId: a.deckId, deckName: a.deckName, checksum: a.checksum },
  deckB: { deckId: b.deckId, deckName: b.deckName, checksum: b.checksum },
  inputChecksumA: a.checksum,
  inputChecksumB: b.checksum,
  encounters: [],
  scoreA: 0,
  scoreB: 0,
  tiedEncounters: 0,
  statTotalA: 0,
  statTotalB: 0,
  tiebreak: null,
  marginTiebreak: null,
  decidedBy: "NONE",
  winner: null,
  loser: null,
  errors,
});

/**
 * Resuelve un combate completo.
 *
 * No muta las entradas: solo lee. Dos llamadas con las mismas entradas producen exactamente el
 * mismo resultado, incluido el audit trail.
 */
export function resolveCombat(
  snapshotA: DuelDeckSnapshot,
  snapshotB: DuelDeckSnapshot,
  plan: CombatPlan,
  /**
   * Reglas de resultado. Por defecto las VIGENTES; para volver a resolver una partida antigua se
   * pasan las suyas (`getCombatRuleset(result.resolverVersion)`) y devuelve lo mismo que devolvió.
   */
  rules: CombatRuleset = CURRENT_COMBAT_RULES,
): CombatResult {
  const errors: CombatError[] = [
    ...validateSnapshot(snapshotA, "A"),
    ...validateSnapshot(snapshotB, "B"),
  ];

  // Los dos mazos deben venir de la misma calibración: comparar cartas de temporadas distintas
  // no significaría nada.
  if (snapshotA.dataVersion !== snapshotB.dataVersion) {
    errors.push({
      code: "DATA_VERSION_MISMATCH",
      expected: snapshotA.dataVersion, actual: snapshotB.dataVersion,
    });
  }

  const a: SideInput = { snapshot: snapshotA, byUid: new Map(snapshotA.cards.map((c) => [c.uid, c])) };
  const b: SideInput = { snapshot: snapshotB, byUid: new Map(snapshotB.cards.map((c) => [c.uid, c])) };

  errors.push(...validatePlan(plan, a, b));

  // Con cualquier problema de contrato NO se resuelve nada. Nunca se corrige en silencio.
  if (errors.length > 0) return emptyResult(snapshotA, snapshotB, errors, rules);

  const encounters: ResolvedEncounter[] = [];
  let scoreA = 0;
  let scoreB = 0;
  let tied = 0;

  for (let i = 0; i < plan.encounters.length; i++) {
    const e = plan.encounters[i];
    const r = resolveEncounter(i, a.byUid.get(e.aUid)!, e.aStat, b.byUid.get(e.bUid)!, e.bStat);
    encounters.push(r);
    // OPD-05 · `NO_POINT`: un enfrentamiento sin valor mayor no puntúa para nadie. Es la única
    // política implementada, y la única que se deduce de «gana el valor mayor».
    if (r.outcome === "A") scoreA++;
    else if (r.outcome === "B") scoreB++;
    else tied++;
  }

  const totals = statTotals(encounters);

  let tiebreak: CombatResult["tiebreak"] = null;
  let marginTiebreak: CombatResult["marginTiebreak"] = null;
  let winner: Side | null = null;
  let decidedBy: CombatDecidedBy = "NONE";
  let status: CombatResult["status"] = "RESOLVED";

  if (scoreA !== scoreB) {
    winner = scoreA > scoreB ? "A" : "B";
    decidedBy = "SCORE";
  } else {
    // Desempate del PDF: suma de las medias de las 10 cartas. Es el ÚNICO que toca el marcador,
    // porque es el único que el documento define.
    const sA = sumOvr(snapshotA.cards);
    const sB = sumOvr(snapshotB.cards);
    const awardedTo: Side | null = sA > sB ? "A" : sB > sA ? "B" : null;
    tiebreak = { applied: true, sumOvrA: sA, sumOvrB: sB, awardedTo };

    if (awardedTo === "A") { scoreA++; winner = "A"; decidedBy = "OVR_TIEBREAK"; }
    else if (awardedTo === "B") { scoreB++; winner = "B"; decidedBy = "OVR_TIEBREAK"; }
    else if (rules.finalTiebreak === "STAT_MARGIN") {
      // OPD-08 · segundo y ÚLTIMO desempate: diferencia total de estadística declarada. NO otorga
      // punto: el marcador solo lo mueven las reglas que el PDF define.
      const to: Side | null = totals.a > totals.b ? "A" : totals.b > totals.a ? "B" : null;
      marginTiebreak = { applied: true, statTotalA: totals.a, statTotalB: totals.b, awardedTo: to };
      if (to !== null) { winner = to; decidedBy = "STAT_MARGIN"; }
      else status = rules.terminal === "DRAW" ? "DRAW" : "UNRESOLVED_TIEBREAK";
    } else {
      // Reglas antiguas: no hay segundo desempate y el resolver declara que no sabe.
      status = rules.terminal === "DRAW" ? "DRAW" : "UNRESOLVED_TIEBREAK";
    }
  }

  return {
    status,
    resolverVersion: rules.version,
    dataVersion: snapshotA.dataVersion,
    schemaVersion: SUPPORTED_SNAPSHOT_SCHEMA,
    deckA: { deckId: snapshotA.deckId, deckName: snapshotA.deckName, checksum: snapshotA.checksum },
    deckB: { deckId: snapshotB.deckId, deckName: snapshotB.deckName, checksum: snapshotB.checksum },
    inputChecksumA: snapshotA.checksum,
    inputChecksumB: snapshotB.checksum,
    encounters,
    scoreA,
    scoreB,
    tiedEncounters: tied,
    statTotalA: totals.a,
    statTotalB: totals.b,
    tiebreak,
    marginTiebreak,
    decidedBy,
    winner,
    loser: winner === null ? null : winner === "A" ? "B" : "A",
    errors: [],
  };
}

// ───────────────────────────── Explicación ─────────────────────────────

/** Frase de un código de rechazo. Los códigos nunca se muestran al jugador. */
export function explainCombatError(e: CombatError): string {
  const who = e.side ? `Mazo ${e.side}` : "El combate";
  switch (e.code) {
    case "SNAPSHOT_SCHEMA_UNSUPPORTED":
      return `${who}: versión de esquema no soportada (esperada ${e.expected}, recibida ${e.actual}).`;
    case "SNAPSHOT_SIZE":
      return `${who}: debe tener ${e.expected} cartas y tiene ${e.actual}.`;
    case "SNAPSHOT_COMPOSITION":
      return `${who}: necesita ${e.expected} cartas de ${e.role} y tiene ${e.actual}.`;
    case "SNAPSHOT_CHECKSUM_MISMATCH":
      return `${who}: la huella no coincide. El mazo se modificó después de congelarlo.`;
    case "SNAPSHOT_MISSING_COMBAT":
      return `${who}: una carta no tiene estadísticas de combate válidas.`;
    case "SNAPSHOT_DUPLICATE_CARD":
      return `${who}: contiene la misma carta dos veces.`;
    case "DATA_VERSION_MISMATCH":
      return `Los dos mazos son de temporadas distintas (${e.expected} y ${e.actual}).`;
    case "PLAN_SIZE":
      return `El plan debe tener ${e.expected} enfrentamientos y tiene ${e.actual}.`;
    case "PLAN_CARD_NOT_IN_SNAPSHOT":
      return `${who}: el plan usa una carta que no está en el mazo.`;
    case "PLAN_CARD_REUSED":
      return `${who}: una carta se usa dos veces; cada carta gasta una sola estadística.`;
    case "PLAN_CARD_UNUSED":
      return `${who}: una carta se queda sin jugar.`;
    case "PLAN_ILLEGAL_MATCHUP":
      return `Emparejamiento no permitido: ${e.matchup?.[0]} contra ${e.matchup?.[1]}.`;
  }
}

/**
 * Motivo del resultado, en una frase. Se deriva de `decidedBy`, que ya viene decidido: esta
 * función NO vuelve a razonar quién ganó.
 */
export function explainCombatReason(r: CombatResult): string {
  switch (r.decidedBy) {
    case "SCORE":
      return `Ganó más enfrentamientos (${r.scoreA}-${r.scoreB}).`;
    case "OVR_TIEBREAK":
      return `Empate a ${Math.min(r.scoreA, r.scoreB)}; desempate por suma de las medias: ${r.tiebreak?.sumOvrA} contra ${r.tiebreak?.sumOvrB}.`;
    case "STAT_MARGIN":
      return `Empate en enfrentamientos y en suma de medias (${r.tiebreak?.sumOvrA}); desempate por estadística total declarada: ${r.marginTiebreak?.statTotalA} contra ${r.marginTiebreak?.statTotalB}.`;
    case "NONE":
      if (r.status === "DRAW") {
        return `Empate en enfrentamientos (${r.scoreA}-${r.scoreB}), en suma de medias (${r.tiebreak?.sumOvrA}) y en estadística total declarada (${r.statTotalA}). Empate.`;
      }
      if (r.status === "UNRESOLVED_TIEBREAK") {
        return `Empate a ${r.scoreA} y las medias de los dos mazos coinciden (${r.tiebreak?.sumOvrA}). Estas reglas no tienen desempate para este caso.`;
      }
      return "El combate no llegó a resolverse.";
  }
}

/**
 * Audit trail completo del resultado (Fase 7 §19): marcador, medias, resultado y motivo.
 * Determinista: el mismo `CombatResult` produce siempre exactamente el mismo texto.
 */
export function auditCombatResult(r: CombatResult): string {
  if (r.status === "INVALID_INPUT") {
    return `FINAL RESULT\n\nResult:\nINVALID INPUT\n\nReason:\n${explainCombatResult(r)}`;
  }
  const result =
    r.status === "DRAW" ? "DRAW"
    : r.status === "UNRESOLVED_TIEBREAK" ? "UNRESOLVED"
    : `${r.winner} WIN`;
  return (
    "FINAL RESULT\n\n" +
    `Score:\n${r.scoreA}-${r.scoreB}\n\n` +
    `OVR:\n${r.tiebreak ? `${r.tiebreak.sumOvrA}-${r.tiebreak.sumOvrB}` : "no aplicado"}\n\n` +
    `Stat total:\n${r.statTotalA}-${r.statTotalB}\n\n` +
    `Rules:\n${r.resolverVersion}\n\n` +
    `Result:\n${result}\n\n` +
    `Reason:\n${explainCombatReason(r)}`
  );
}

/** Resumen del combate en una frase. */
export function explainCombatResult(r: CombatResult): string {
  if (r.status === "INVALID_INPUT") {
    return r.errors.length === 1
      ? explainCombatError(r.errors[0])
      : `El combate no se puede resolver: ${r.errors.length} problemas en la entrada.`;
  }
  if (r.status === "UNRESOLVED_TIEBREAK" || r.status === "DRAW") {
    return explainCombatReason(r);
  }
  const marcador = `${r.scoreA}-${r.scoreB}`;
  const nombre = r.winner === "A" ? r.deckA.deckName : r.deckB.deckName;
  if (r.decidedBy === "STAT_MARGIN") {
    return `Gana ${nombre} (${marcador}) por estadística total declarada: ${r.marginTiebreak?.statTotalA} contra ${r.marginTiebreak?.statTotalB}.`;
  }
  return r.tiebreak
    ? `Gana ${nombre} (${marcador}) por desempate: ${r.tiebreak.sumOvrA} contra ${r.tiebreak.sumOvrB} de media acumulada.`
    : `Gana ${nombre} (${marcador}).`;
}
