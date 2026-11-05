/**
 * FASE 42 · ROTACIÓN PURA DE MISIONES — «lo que corresponde a `serverNow`», sin escribir.
 *
 * Hasta la Fase 41 la rotación diaria/semanal se MATERIALIZABA al leer (`getProgression`, que usaban `GET /meta`
 * y `GET /loop`) con un sorteo aleatorio (`randomInt`) y una baseline tomada en el instante de esa lectura. Dos
 * consecuencias: leer escribía, y el progreso hecho entre el reset y la primera lectura se perdía.
 *
 * Aquí la rotación es una FUNCIÓN del tiempo del servidor:
 *
 *   · SORTEO DETERMINISTA por (usuario, temporada, tipo, inicio de ventana): cualquier lectura —y la materialización
 *     posterior, cuando haga falta— obtiene LAS MISMAS misiones. Dos pestañas, dos reclamos o un reset con la home
 *     abierta convergen en el mismo estado canónico.
 *   · BASELINE ANCLADA AL INICIO DE LA VENTANA: valor de la métrica AHORA menos lo ocurrido DESDE el inicio de la
 *     ventana (hechos con marca de tiempo del servidor: partidas terminadas, aperturas, predicciones, cartas nuevas).
 *     El progreso no depende de cuándo se lee ni de cuándo se materializa.
 *   · `assignedAt` = inicio de la ventana: la clave del reclamo (`mission:<s>:<id>:<assignedAt>:<baseline>`) es la
 *     misma para toda la ventana.
 *
 * Una lectura usa `resolvePassWindows` y enseña el resultado. Un reclamo (mutación explícita) lo materializa antes de
 * reclamar. Una tanda de una ventana anterior desaparece al rotar: una diaria caducada es una diaria caducada.
 */
import type { ActiveMission, MetricSnapshot, MissionDef, MissionKind, PassState, SeasonDef } from "@/battlepass/types";
import { assignMission, missionProgress, rollMissions } from "@/battlepass/missions";
import { makeRng } from "@/sim/rng";
import { PERIODIC_KINDS, expiresAt as missionExpiresAt, periodWindow, rotationDue } from "./periods";

/** Cuántas misiones hay por tanda de cada tipo rotatorio. */
export const BATCH_SIZE: Record<string, number> = { daily: 3, weekly: 2 };

/**
 * Métricas cuyo «desde el inicio de la ventana» se puede contar con hechos fechados por el servidor. Una misión
 * rotatoria que mida otra cosa toma la baseline del valor actual (documentado; hoy no existe ninguna).
 */
export const WINDOW_METRICS = ["duels_played", "duels_won", "packs_opened", "picks_made", "distinct_cards"] as const;
export type WindowMetric = (typeof WINDOW_METRICS)[number];

/** FNV-1a de 32 bits: semilla estable (no criptográfica; predecir la tanda no da ventaja: no hay re-sorteo). */
export function windowSeed(userId: string, seasonId: string, kind: string, startsAt: number): number {
  const s = `${userId}|${seasonId}|${kind}|${startsAt}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 2147483646) + 1;
}

/** La tanda que corresponde a una ventana (determinista). */
export function batchFor(pool: readonly MissionDef[], userId: string, seasonId: string, kind: MissionKind, startsAt: number): MissionDef[] {
  return rollMissions([...pool], kind, BATCH_SIZE[kind] ?? 0, makeRng(windowSeed(userId, seasonId, kind, startsAt)));
}

/** Clave de un recuento «desde el inicio de ventana». */
export const countKey = (metric: string, startsAt: number) => `${metric}@${startsAt}`;

export interface WindowNeed { metric: WindowMetric; startsAt: number }

/** Qué tipos hay que (re)asignar ahora: rotación vencida o ninguna misión de ese tipo. */
export function dueKinds(state: PassState, now: number): MissionKind[] {
  const unassigned = state.missions.length === 0;
  return PERIODIC_KINDS.filter((kind) => {
    const ofKind = state.missions.filter((m) => m.kind === kind);
    if (unassigned || ofKind.length === 0) return true;
    return ofKind.some((m) => rotationDue(kind, m.assignedAt, now));
  });
}

/** Los recuentos que necesita `resolvePassWindows` para este estado y este instante (acotado: ≤ 5 por tipo). */
export function windowNeeds(state: PassState, season: SeasonDef, userId: string, now: number): WindowNeed[] {
  const out = new Map<string, WindowNeed>();
  for (const kind of dueKinds(state, now)) {
    const w = periodWindow(kind, now)!;
    for (const def of batchFor(season.missionPool, userId, season.id, kind, w.startsAt)) {
      if ((WINDOW_METRICS as readonly string[]).includes(def.metric)) out.set(countKey(def.metric, w.startsAt), { metric: def.metric as WindowMetric, startsAt: w.startsAt });
    }
  }
  return [...out.values()];
}

export interface ResolveInput {
  state: PassState;
  season: SeasonDef;
  userId: string;
  metrics: MetricSnapshot;
  /** `countKey(metric, startsAt)` → eventos de esa métrica desde el inicio de esa ventana. */
  sinceWindow: Readonly<Record<string, number>>;
  now: number;
  /** Alta de la cuenta y comienzo de la temporada (ms), para la baseline de las misiones fijas de una cuenta nueva. */
  accountCreatedAt: number | null;
  seasonStartsAt: number | null;
}

export interface ResolveResult {
  state: PassState;
  changed: boolean;
  rotated: MissionKind[];
  assigned: boolean;
  unlockedCompetitive: boolean;
}

/**
 * EL ESTADO DEL PASE QUE CORRESPONDE A `now`. Pura: no lee ni escribe. Idempotente: aplicarla al resultado devuelve
 * el mismo estado (`changed: false`).
 */
export function resolvePassWindows(input: ResolveInput): ResolveResult {
  const { season, userId, metrics, now } = input;
  const base = input.state;
  const missions: ActiveMission[] = base.missions.map((m) => ({ ...m }));
  const unassigned = missions.length === 0;
  const kinds = dueKinds(base, now);
  let next: ActiveMission[] = missions;

  for (const kind of kinds) {
    const w = periodWindow(kind, now)!;
    const snapshotAt: MetricSnapshot = { ...metrics };
    for (const m of WINDOW_METRICS) {
      const since = input.sinceWindow[countKey(m, w.startsAt)];
      if (since !== undefined) snapshotAt[m] = Math.max(0, (metrics[m] ?? 0) - since);
    }
    next = next.filter((m) => m.kind !== kind);
    for (const def of batchFor(season.missionPool, userId, season.id, kind, w.startsAt)) next.push(assignMission(def, snapshotAt, w.startsAt));
  }

  if (unassigned) {
    // Misiones fijas (temporada e hitos). Cuenta creada durante la temporada → todo lo hecho desde el alta cuenta
    // (baseline 0: equivale a la asignación inmediata tras el registro de antes). Cuenta anterior → desde ahora.
    const fresh = input.accountCreatedAt !== null && input.seasonStartsAt !== null && input.accountCreatedAt >= input.seasonStartsAt;
    const zero: MetricSnapshot = Object.fromEntries(Object.keys(metrics).map((k) => [k, 0]));
    for (const def of season.missionPool.filter((d) => d.kind === "seasonal" || d.kind === "progressive")) {
      // `assignedAt` estable (no el instante de la lectura): la misma asignación en cualquier lectura o pestaña.
      next.push(assignMission(def, fresh ? zero : metrics, fresh ? input.accountCreatedAt! : (input.seasonStartsAt ?? now)));
    }
  }

  const minPoints = season.competitiveMinPoints ?? Number.POSITIVE_INFINITY;
  const unlock = !base.competitiveUnlocked && (metrics.points ?? 0) >= minPoints;
  const changed = kinds.length > 0 || unassigned || unlock;
  return {
    state: changed ? { ...base, missions: next, competitiveUnlocked: base.competitiveUnlocked || unlock } : base,
    changed, rotated: unassigned ? [] : kinds, assigned: unassigned, unlockedCompetitive: unlock,
  };
}

/** Vista de misiones (la que sirve `progression` y consume el vestíbulo). Pura. */
export function missionViewsOf(missions: readonly ActiveMission[], metrics: MetricSnapshot, pool: readonly MissionDef[]) {
  return missions.map((m) => {
    const def = pool.find((d) => d.id === m.id);
    const current = missionProgress(m, metrics);
    return {
      id: m.id,
      label: def?.label ?? m.id,
      kind: m.kind,
      current: Math.min(current, m.goal),
      goal: m.goal,
      complete: current >= m.goal,
      claimed: m.claimed,
      rewardCredits: def?.reward.credits ?? 0,
      xp: def?.xp ?? 0,
      metric: m.metric,
      packId: def?.reward.packId ?? null,
      packCount: def?.reward.packId ? def.reward.packCount ?? 1 : 0,
      assignedAt: m.assignedAt,
      expiresAt: missionExpiresAt(m.kind, m.assignedAt),
    };
  });
}

/** Recuento de cartas DISTINTAS nuevas desde `startsAt` (primer ejemplar obtenido en la ventana). Puro. */
export function newDistinctSince(rows: readonly { card_id: string; obtainedAt: number | null }[], startsAt: number): number {
  const before = new Set<string>(); const all = new Set<string>();
  for (const r of rows) { all.add(r.card_id); if (r.obtainedAt !== null && r.obtainedAt < startsAt) before.add(r.card_id); }
  return all.size - before.size;
}
