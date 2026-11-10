/**
 * F87.2 · PREPARACIÓN DE LANZAMIENTO de un Pick'em 2.0 (puro). UN solo concepto canónico para el panel y el servidor:
 * ¿se puede PUBLICAR? ¿se puede lanzar CON RECOMPENSAS? Y si no, qué lo bloquea, en concreto.
 *
 *   ESTRUCTURA  formato soportado, sin ciclos, sin aristas obligatorias sin resolver, sin huecos imposibles, final alcanzable
 *   FUENTE      partidos/equipos/resultados/aristas del proveedor; aristas de admin solo donde no contradicen; sin deriva
 *   CIERRES     todo partido puntuable tiene un cierre válido
 *   PUNTUACIÓN  versión conocida (`pickem-scoring-v1`), puntos enteros > 0 y máximo coherente
 *   RECOMPENSAS reglas v1 exactas, sobres e insignia válidos, política de elegibilidad CONOCIDA
 *   ECONOMÍA    pasivo calculable (máximo por jugador y peor caso)
 *   LEGACY      el evento no tiene un Pick'em clásico con recompensas propias
 *   TIEMPO      ningún partido cerrado/empezado y el ámbito no está liquidado/cancelado
 *
 * Publicar SIN recompensas exige ESTRUCTURA + FUENTE + CIERRES + PUNTUACIÓN. Con recompensas, además RECOMPENSAS +
 * ECONOMÍA + LEGACY + TIEMPO. Publicar y activar recompensas siguen siendo acciones distintas. La BD vuelve a exigir lo
 * económico (0072/0073): reglas v1, política, autoridad legacy y tiempo.
 */
import { PICKEM_SCORING_VERSION, type FormatIssue } from "./format";
import { isRewardRulesV1, REWARD_RULES_V1, type BracketRewardConfig, type RewardIssue } from "./bracketRewards";
import { policyOf } from "./eligibility";

export type GateId = "STRUCTURE" | "SOURCE" | "LOCKS" | "SCORING" | "REWARDS" | "ECONOMY" | "LEGACY" | "TIME";
export type GateState = "PASS" | "FAIL";
export interface Gate { id: GateId; label: string; state: GateState; blockers: string[] }

export const GATE_LABEL: Record<GateId, string> = {
  STRUCTURE: "Estructura", SOURCE: "Fuente", LOCKS: "Cierres", SCORING: "Puntuación",
  REWARDS: "Recompensas", ECONOMY: "Economía", LEGACY: "Colisión legacy", TIME: "Tiempo",
};
export const PUBLISH_GATES: readonly GateId[] = ["STRUCTURE", "SOURCE", "LOCKS", "SCORING"];
export const REWARD_GATES: readonly GateId[] = ["REWARDS", "ECONOMY", "LEGACY", "TIME"];

/** Códigos del validador que hablan de la FUENTE (lo demás de nivel ERROR es estructura, salvo los de fechas). */
const SOURCE_CODES = new Set(["MATCH_MISSING", "MATCH_OTHER_EVENT", "ADMIN_CONTRADICTS_SOURCE", "RESULT_CONTRADICTS", "SEED_CHANGED", "EDGE_OUT_OF_SCOPE"]);
const LOCK_CODES = new Set(["DATE_MISSING", "DATE_ORDER"]);
const SCORING_CODES = new Set(["POINTS"]);

export interface LaunchNode { matchId: string; points: number; lockAt: string | null; start: string | null; realStatus: string | null; locked: boolean }
export interface LaunchInput {
  status: string;
  issues: FormatIssue[];
  /** ¿La fuente sigue derivando el mismo cuadro que el congelado? */
  sourceDerivable: boolean;
  driftChanged: boolean;
  nodes: LaunchNode[];
  scoringVersion: string;
  maxPoints: number;
  rewards: BracketRewardConfig;
  rewardIssues: RewardIssue[];
  slug: string;
  /** Máximo por jugador (precio de tienda) — `null` = no calculable. */
  maxTierValue: number | null;
  legacyAuthority: boolean;
  now: number;
}

export interface LaunchReadiness {
  /** Se puede publicar (sin recompensas): estructura + fuente + cierres + puntuación. */
  structure: "READY" | "NOT_READY";
  /** OFF = recompensas no configuradas para activar; READY/NOT_READY = ¿se podrían activar? */
  rewards: "OFF" | "READY" | "NOT_READY";
  /** Lanzamiento: con recompensas, sin recompensas o no listo. */
  launch: "READY_WITH_REWARDS" | "READY_WITHOUT_REWARDS" | "NOT_READY";
  gates: Gate[];
  /** Lo que bloquea PUBLICAR (vacío = se puede, si es borrador). */
  publishBlockers: string[];
  /** Lo que bloquea lanzar CON recompensas (incluye lo de publicar). */
  rewardedBlockers: string[];
}

const group = (issues: FormatIssue[]): string[] => {
  const by = new Map<string, FormatIssue[]>();
  for (const i of issues) by.set(i.code, [...(by.get(i.code) ?? []), i]);
  return [...by.entries()].map(([code, xs]) => (xs.length === 1 ? `${xs[0].message} (${code})` : `${xs.length} × ${xs[0].message} (${code})`));
};

const finite = (s: string | null) => (s ? Number.isFinite(Date.parse(s)) : false);

/** Puerta de TIEMPO (también la usa `activationBlockers`): mensajes estables para el panel. */
export function timeBlockers(status: string, anyClosed: boolean): string[] {
  const out: string[] = [];
  if (status !== "DRAFT" && status !== "PUBLISHED") out.push("El Pick'em está liquidado o cancelado.");
  else if (anyClosed) out.push("Ya se cerró alguna predicción o empezó un partido: las recompensas quedaron congeladas.");
  return out;
}

/** Puerta de RECOMPENSAS (configuración): reglas v1, sobres/insignia válidos y política de elegibilidad conocida. */
export function rewardConfigBlockers(rewards: BracketRewardConfig, rewardIssues: RewardIssue[], slug: string): string[] {
  const out: string[] = [];
  if (!isRewardRulesV1(rewards, slug)) out.push(`La configuración no es la regla aprobada ${REWARD_RULES_V1}: carga las reglas v1.`);
  for (const i of rewardIssues.filter((x) => x.severity === "ERROR")) out.push(`${i.message} (${i.code})`);
  if (!policyOf(rewards.eligibilityPolicy)) out.push("Falta la política de elegibilidad para cobrar (reward-eligibility-v1): carga las reglas v1.");
  return out;
}

export function launchReadiness(x: LaunchInput): LaunchReadiness {
  const errors = x.issues.filter((i) => i.severity === "ERROR");
  const structureIssues = errors.filter((i) => !SOURCE_CODES.has(i.code) && !LOCK_CODES.has(i.code) && !SCORING_CODES.has(i.code));
  const gate = (id: GateId, blockers: string[]): Gate => ({ id, label: GATE_LABEL[id], state: blockers.length ? "FAIL" : "PASS", blockers });

  const structure = gate("STRUCTURE", [...(x.nodes.length === 0 ? ["El cuadro no tiene partidos."] : []), ...group(structureIssues)]);
  const source = gate("SOURCE", [
    ...(x.sourceDerivable ? [] : ["La fuente ya no permite derivar este formato."]),
    ...(x.driftChanged ? ["La fuente cambió desde que se guardó el borrador: refréscalo y revísalo."] : []),
    ...group(errors.filter((i) => SOURCE_CODES.has(i.code))),
  ]);
  const badLocks = x.nodes.filter((n) => !finite(n.lockAt) && !finite(n.start));
  const locks = gate("LOCKS", [
    ...(badLocks.length ? [`${badLocks.length} partido(s) sin cierre válido (sin hora): ${badLocks.slice(0, 4).map((n) => n.matchId).join(", ")}`] : []),
    ...group(errors.filter((i) => LOCK_CODES.has(i.code))),
  ]);
  const badPoints = x.nodes.filter((n) => !Number.isInteger(n.points) || n.points <= 0);
  const sum = x.nodes.reduce((s, n) => s + (Number.isFinite(n.points) ? n.points : 0), 0);
  const scoring = gate("SCORING", [
    ...(x.scoringVersion !== PICKEM_SCORING_VERSION ? [`Versión de puntuación desconocida (${x.scoringVersion || "ninguna"}): se espera ${PICKEM_SCORING_VERSION}.`] : []),
    ...(badPoints.length ? [`${badPoints.length} partido(s) con puntos no válidos.`] : []),
    ...(x.maxPoints !== sum || sum <= 0 ? [`Máximo de puntos incoherente (${x.maxPoints} guardado, ${sum} por partidos).`] : []),
    ...group(errors.filter((i) => SCORING_CODES.has(i.code))),
  ]);
  const rewards = gate("REWARDS", rewardConfigBlockers(x.rewards, x.rewardIssues, x.slug));
  const economy = gate("ECONOMY", x.maxTierValue !== null && Number.isFinite(x.maxTierValue) && x.maxTierValue > 0 ? [] : ["No se puede calcular el pasivo máximo por jugador."]);
  const legacy = gate("LEGACY", x.legacyAuthority ? ["Este evento tiene un Pick'em clásico con recompensas propias (autoridad legacy): Pick'ems 2.0 no puede premiarlo."] : []);
  const anyClosed = x.nodes.some((n) => n.locked || (!!n.realStatus && n.realStatus.toLowerCase() !== "upcoming")
    || [n.lockAt, n.start].some((t) => finite(t) && Date.parse(t!) <= x.now));
  const time = gate("TIME", timeBlockers(x.status, anyClosed));

  const gates = [structure, source, locks, scoring, rewards, economy, legacy, time];
  const pub = gates.filter((g) => PUBLISH_GATES.includes(g.id));
  const rew = gates.filter((g) => REWARD_GATES.includes(g.id));
  const publishBlockers = pub.flatMap((g) => g.blockers.map((b) => `${g.label}: ${b}`));
  const rewardedBlockers = [...publishBlockers, ...rew.flatMap((g) => g.blockers.map((b) => `${g.label}: ${b}`))];
  const structureReady = publishBlockers.length === 0;
  const rewardsReady = rew.every((g) => g.state === "PASS");
  const rewardsState = x.rewards.status === "OFF" && x.rewards.tiers.length === 0 ? "OFF" : rewardsReady ? "READY" : "NOT_READY";
  return {
    structure: structureReady ? "READY" : "NOT_READY",
    rewards: rewardsState,
    launch: !structureReady ? "NOT_READY" : rewardsReady && rewardsState !== "OFF" ? "READY_WITH_REWARDS" : "READY_WITHOUT_REWARDS",
    gates, publishBlockers, rewardedBlockers,
  };
}
