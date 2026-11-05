/**
 * MISIONES (Collection Fase 6/7).
 *
 * 100% POR DATOS: cada misión mide una MÉTRICA acumulada real del juego (`MetricSnapshot`, que aporta
 * el store desde Gameplay/Career/Collection/Marketplace/Competitive/Online/Living World). El motor NO
 * duplica estadísticas: guarda un `baseline` al asignar y el progreso = snapshot − baseline (acotado al
 * goal). El sorteo de misiones usa el RNG del proyecto (determinista). Puro.
 */
import type { Rng } from "@/sim/rng";
import type { ActiveMission, MetricSnapshot, MissionDef } from "./types";
import { isMissionAvailable, LIVE_MISSION_FLAGS, type MissionFlags } from "@/domain/progression/missionAvailability";

/**
 * FASE 36.1 · MÉTRICAS CUYA FUENTE CAMBIÓ, con la versión vigente.
 *
 *   packs_opened  v1 (sin campo) = `profiles.packs_opened`: ningún camino del servidor lo incrementa (medido: 0 en
 *                                  todos los perfiles reales), así que las misiones de sobres no avanzaban nunca.
 *                 v2              = `user_game.packs_opened`: +1 dentro de `app_apply_pack_open`, en la misma
 *                                  transacción que la fila idempotente de `economy_ops` (kind `open_pack`). Comprar,
 *                                  recibir o poseer un sobre no lo mueven.
 *
 * Una misión cuya `metricVersion` no es la vigente tiene una baseline de la fuente antigua: se sigue midiendo con
 * esa fuente (clave `legacyMetricKey`) hasta que un rebase explícito o una rotación la traigan a la nueva.
 */
export const METRIC_VERSIONS: Readonly<Record<string, number>> = Object.freeze({ packs_opened: 2 });

/** Clave del snapshot con el valor de la FUENTE ANTIGUA de una métrica versionada (la aporta el servidor). */
export const legacyMetricKey = (metric: string): string => `${metric}@legacy`;

/** ¿La baseline de esta misión se tomó con una fuente que ya no es la vigente? */
export function isLegacyBaseline(m: Pick<ActiveMission, "metric" | "metricVersion">): boolean {
  const v = METRIC_VERSIONS[m.metric];
  return v !== undefined && m.metricVersion !== v;
}

/**
 * Valor de la métrica COMPARABLE con la baseline de la misión. Legacy → fuente antigua (si el snapshot la trae; el
 * modo local no la trae y conserva su comportamiento de siempre). Vigente → fuente nueva.
 */
export function metricValue(m: Pick<ActiveMission, "metric" | "metricVersion">, snapshot: MetricSnapshot): number {
  if (isLegacyBaseline(m)) {
    const legacy = snapshot[legacyMetricKey(m.metric)];
    if (legacy !== undefined) return legacy;
  }
  return snapshot[m.metric] ?? 0;
}

/**
 * CORE GAME LOOP (2026-10-07) · MÉTRICAS DE ESTADO (0/1): miden si algo ESTÁ hecho, no cuántas veces. «Declara tu
 * región» (`region_set`) restaba la baseline como un contador: una cuenta anterior a la temporada que ya tenía región
 * quedaba con baseline 1 y la misión era IMPOSIBLE (1 − 1 = 0 para siempre). En estas métricas el progreso es el valor.
 */
export const STATE_METRICS: ReadonlySet<string> = new Set(["region_set"]);

/** Progreso actual de una misión (acotado a [0, goal]). */
export function missionProgress(m: ActiveMission, snapshot: MetricSnapshot): number {
  const raw = metricValue(m, snapshot) - (STATE_METRICS.has(m.metric) ? 0 : m.baseline);
  return Math.max(0, Math.min(m.goal, raw));
}

export const isMissionComplete = (m: ActiveMission, snapshot: MetricSnapshot): boolean =>
  missionProgress(m, snapshot) >= m.goal;

/** Crea una misión activa fijando el baseline en la métrica actual (y la versión de su fuente, si la tiene). */
export function assignMission(def: MissionDef, snapshot: MetricSnapshot, now: number): ActiveMission {
  const v = METRIC_VERSIONS[def.metric];
  return {
    id: def.id, kind: def.kind, metric: def.metric, goal: def.goal, baseline: snapshot[def.metric] ?? 0, claimed: false, assignedAt: now,
    ...(v !== undefined ? { metricVersion: v } : {}),
  };
}

/** Tras reclamar una misión repetible: vuelve a empezar desde la fuente VIGENTE (y lo deja anotado). */
export function rebaselineForRepeat(m: ActiveMission, snapshot: MetricSnapshot): void {
  const v = METRIC_VERSIONS[m.metric];
  const current = snapshot[m.metric];
  m.baseline = current ?? m.baseline + m.goal;
  if (v !== undefined && current !== undefined) m.metricVersion = v;
}

/**
 * Sortea `count` misiones de un tipo del pool (ponderado por `weight`, sin ocultas, sin repetir),
 * de forma DETERMINISTA con el RNG del proyecto. Devuelve las definiciones elegidas.
 * Solo entran las misiones ELEGIBLES con los interruptores (`missionAvailability`: sin Marketplace, nada de
 * comprar o vender en él).
 */
export function rollMissions(pool: MissionDef[], kind: MissionDef["kind"], count: number, rng: Rng, flags: MissionFlags = LIVE_MISSION_FLAGS): MissionDef[] {
  const candidates = pool.filter((m) => m.kind === kind && !m.hidden && isMissionAvailable(m, flags));
  const chosen: MissionDef[] = [];
  const remaining = [...candidates];
  while (chosen.length < count && remaining.length > 0) {
    const total = remaining.reduce((s, m) => s + (m.weight ?? 1), 0);
    let roll = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < remaining.length; i++) { roll -= remaining[i].weight ?? 1; if (roll <= 0) { idx = i; break; } }
    chosen.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return chosen;
}
