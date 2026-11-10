/**
 * FASE 62 · PROGRESSION & REWARDS 5.0 — EL MODELO DEL HUB (puro).
 *
 * Una pantalla, una lectura (`GET /api/game/meta`), cuatro respuestas: ¿qué estoy progresando?, ¿qué puedo conseguir
 * ahora?, ¿qué me falta para la siguiente recompensa?, ¿qué debería hacer hoy? Aquí se ORDENA y se ETIQUETA lo que el
 * servidor ya resolvió (pase, misiones, logros, colección, rating); no se decide ni un punto, ni un «completo», ni una
 * recompensa. Sin React, sin red, sin reloj propio: el tiempo es SIEMPRE `serverNow` de la lectura.
 *
 * LOS SISTEMAS REALES (auditoría F62):
 *   · NIVEL DE CUENTA — `profiles.xp` (XP DE CUENTA), curva `levelFromXp` sin tope; la conceden duelos, sobres y
 *     recompensas del libro mayor. No hay recompensa por nivel de cuenta (decisión F27/F62: sería un grifo nuevo).
 *   · TEMPORADA — pase `nexus-s1` (XP DE TEMPORADA, lineal 1.000/nivel, tope 30), sube SOLO al reclamar misiones;
 *     carriles libre / competitivo (se abre en Oro) / de pago (cosmético, no se vende: pagos OFF). Reclamo manual.
 *   · OBJETIVOS — misiones diaria / semanal / de temporada / hito, ventanas UTC del servidor, reclamo manual.
 *   · LOGROS — 7 (colección y sobres), evaluados en servidor, reclamo manual (créditos).
 *   · COMPETITIVO — rating PvP y escalera (F55): progreso APARTE, nunca mezclado con el nivel de cuenta.
 */
import type { RewardLike } from "@/domain/rewards/display";
import { ns } from "@/i18n/runtime";

const t = ns("progression");

/* ─────────────────────────── tipos de entrada (forma de la lectura) ─────────────────────────── */

export interface TrackLevelIn { level: number; reward: RewardLike; claimed: boolean; claimable: boolean }
export interface MissionIn {
  id: string; label: string; kind: string; current: number; goal: number; complete: boolean; claimed: boolean;
  rewardCredits: number; xp: number; metric: string; packId: string | null; packCount: number;
  assignedAt: number; expiresAt: number | null;
}
export interface AchievementIn { id: string; name: string; description: string; icon: string; reward: number; goal: number; current: number; complete: boolean; claimed: boolean; claimedAt: string | null }
export interface PassIn {
  level: number; xp: number; xpIntoLevel: number; xpForNext: number; progress: number;
  season: { id: string; name: string; maxLevel: number };
  competitiveUnlocked: boolean; competitiveMinPoints: number; points: number;
  tracks: { free: TrackLevelIn[]; competitive: TrackLevelIn[]; premium: TrackLevelIn[] };
  missions: MissionIn[]; achievements: AchievementIn[];
}

/* ─────────────────────────── reclamables ─────────────────────────── */

export type ClaimKind = "mission" | "level" | "achievement";

export interface Claimable {
  kind: ClaimKind;
  /** Clave de pantalla (estable). La del servidor la pone el servicio (`mission:`/`pass:`/`achievement:`). */
  key: string;
  id: string;
  label: string;
  reward: RewardLike;
  /** XP de temporada que suma al pase (solo misiones). */
  seasonXp: number;
  track?: "free" | "competitive";
  level?: number;
}

/**
 * Lo que se puede reclamar AHORA, según el servidor:
 *   · misiones completas y no reclamadas cuya tanda NO ha caducado (`expiresAt > serverNow`): una tanda caducada se
 *     borra al rotar y ya no se puede cobrar (F36/F42) — ofrecerla sería un botón que falla;
 *   · niveles del carril libre y competitivo con `claimable` (alcanzados, sin reclamar, carril abierto). El carril de
 *     pago no se ofrece (no se vende; pagos OFF);
 *   · logros completos y no reclamados.
 */
export function claimables(pass: PassIn, serverNow: number): Claimable[] {
  const out: Claimable[] = [];
  for (const m of pass.missions) {
    if (!m.complete || m.claimed) continue;
    if (m.expiresAt !== null && m.expiresAt <= serverNow) continue;
    out.push({
      kind: "mission", key: `mission:${m.id}:${m.assignedAt}`, id: m.id, label: m.label,
      reward: { credits: m.rewardCredits || undefined, packId: m.packId ?? undefined, packCount: m.packId ? m.packCount : undefined },
      seasonXp: m.xp,
    });
  }
  for (const track of ["free", "competitive"] as const) {
    if (track === "competitive" && !pass.competitiveUnlocked) continue;
    for (const l of pass.tracks[track] ?? []) {
      if (!l.claimable || l.claimed) continue;
      out.push({ kind: "level", key: `level:${track}:${l.level}`, id: String(l.level), label: track === "competitive" ? t("Temporada · nivel {level} (competitivo)", { level: l.level }) : t("Temporada · nivel {level}", { level: l.level }), reward: l.reward, seasonXp: 0, track, level: l.level });
    }
  }
  for (const a of pass.achievements) {
    if (!a.complete || a.claimed) continue;
    out.push({ kind: "achievement", key: `achievement:${a.id}`, id: a.id, label: t("Logro · {name}", { name: a.name }), reward: { credits: a.reward || undefined }, seasonXp: 0 });
  }
  return out;
}

/**
 * Orden de «Reclamar todo»: primero las misiones (suben la XP de temporada y pueden ABRIR niveles del pase), después
 * los niveles y al final los logros. Tras cada reclamo se relee: el servidor decide qué queda.
 */
export function claimOrder(list: Claimable[]): Claimable[] {
  const w: Record<ClaimKind, number> = { mission: 0, level: 1, achievement: 2 };
  return [...list].sort((a, b) => w[a.kind] - w[b.kind] || (a.level ?? 0) - (b.level ?? 0));
}

/* ─────────────────────────── carril de temporada ─────────────────────────── */

export type TrackNodeState = "CLAIMED" | "CLAIMABLE" | "CURRENT" | "NEXT" | "LOCKED";

export interface TrackNode { level: number; state: TrackNodeState; reward: RewardLike }

export interface TrackWindow {
  nodes: TrackNode[];
  /** Nivel de temporada alcanzado (0 = ninguno). */
  level: number;
  maxLevel: number;
  /** El carril está completo: no hay «siguiente recompensa» (F62 §37). */
  complete: boolean;
  /** Siguiente nivel con recompensa, o `null` si no queda. */
  next: TrackNode | null;
  hiddenBefore: number;
  hiddenAfter: number;
}

/**
 * Ventana del carril libre alrededor del nivel actual: pasado (reclamado/reclamable), ACTUAL, siguiente y bloqueado. No
 * se pintan los 30 a la vez: `size` nodos (por defecto 7) con recuento de los ocultos a cada lado.
 */
export function trackWindow(levels: TrackLevelIn[], level: number, maxLevel: number, size = 7): TrackWindow {
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  const complete = level >= maxLevel;
  const firstClaimable = sorted.find((l) => l.claimable && !l.claimed)?.level ?? null;
  const anchor = firstClaimable ?? Math.min(maxLevel, level + 1);
  const start = Math.max(0, Math.min(sorted.findIndex((l) => l.level >= anchor) - 1, sorted.length - size));
  const slice = sorted.slice(Math.max(0, start), Math.max(0, start) + size);
  const nextLevel = complete ? null : level + 1;
  const nodes: TrackNode[] = slice.map((l) => ({
    level: l.level,
    reward: l.reward,
    state: l.claimed ? "CLAIMED" : l.claimable ? "CLAIMABLE" : l.level === nextLevel ? "NEXT" : l.level <= level ? "CURRENT" : "LOCKED",
  }));
  const nextNode = nextLevel === null ? null : sorted.find((l) => l.level >= nextLevel && !l.claimed) ?? null;
  return {
    nodes, level, maxLevel, complete,
    next: nextNode ? { level: nextNode.level, reward: nextNode.reward, state: "NEXT" } : null,
    hiddenBefore: Math.max(0, start),
    hiddenAfter: Math.max(0, sorted.length - (Math.max(0, start) + size)),
  };
}

/* ─────────────────────────── objetivos ─────────────────────────── */

export type ObjectiveGroupId = "daily" | "weekly" | "seasonal" | "progressive";
export const OBJECTIVE_GROUP_LABEL: Record<ObjectiveGroupId, string> = {
  daily: "Hoy", weekly: "Esta semana", seasonal: "Temporada", progressive: "Hitos",
};

export type ObjectiveState = "CLAIMABLE" | "IN_PROGRESS" | "CLAIMED" | "EXPIRED";

export interface ObjectiveCard {
  id: string; key: string; label: string; current: number; goal: number; state: ObjectiveState;
  reward: RewardLike; seasonXp: number;
  /** A dónde ir para avanzarlo, si hay una ruta real que lo mueva. */
  cta: { href: string; label: string } | null;
}

export interface ObjectiveGroup { id: ObjectiveGroupId; label: string; resetsAt: number | null; items: ObjectiveCard[] }

/** Qué pantalla mueve cada MÉTRICA real (`WINDOW_METRICS` + las de temporada/hito). Sin métrica conocida: sin CTA. */
const METRIC_CTA: Record<string, { href: string; label: string }> = {
  duels_played: { href: "/jugar", label: "Jugar" },
  duels_won: { href: "/jugar", label: "Jugar" },
  points: { href: "/jugar", label: "Jugar" },
  packs_opened: { href: "/tienda", label: "Ir a sobres" },
  distinct_cards: { href: "/tienda", label: "Ir a sobres" },
  picks_made: { href: "/pickems", label: "Predecir" },
  decks_saved: { href: "/duelos/mazos", label: "Mis equipos" },
  region_set: { href: "/cuenta", label: "Mi cuenta" },
};
export const metricCta = (metric: string) => METRIC_CTA[metric] ?? null;

export function objectiveGroups(missions: MissionIn[], serverNow: number): ObjectiveGroup[] {
  const order: ObjectiveGroupId[] = ["daily", "weekly", "seasonal", "progressive"];
  return order.map((id) => {
    const list = missions.filter((m) => m.kind === id);
    const items: ObjectiveCard[] = list.map((m) => {
      const expired = m.expiresAt !== null && m.expiresAt <= serverNow;
      const state: ObjectiveState = m.claimed ? "CLAIMED" : expired ? "EXPIRED" : m.complete ? "CLAIMABLE" : "IN_PROGRESS";
      return {
        id: m.id, key: `mission:${m.id}:${m.assignedAt}`, label: m.label,
        current: Math.max(0, Math.min(m.goal, m.current)), goal: Math.max(1, m.goal), state,
        reward: { credits: m.rewardCredits || undefined, packId: m.packId ?? undefined, packCount: m.packId ? m.packCount : undefined },
        seasonXp: m.xp,
        cta: state === "IN_PROGRESS" ? metricCta(m.metric) : null,
      };
    }).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (b.current / b.goal) - (a.current / a.goal));
    const ends = list.map((m) => m.expiresAt).filter((x): x is number => typeof x === "number" && x > serverNow);
    return { id, label: OBJECTIVE_GROUP_LABEL[id], resetsAt: ends.length ? Math.min(...ends) : null, items };
  }).filter((g) => g.items.length > 0);
}
const STATE_ORDER: Record<ObjectiveState, number> = { CLAIMABLE: 0, IN_PROGRESS: 1, CLAIMED: 2, EXPIRED: 3 };

/**
 * «Renueva en X» desde el reloj del SERVIDOR (`resetsAt − serverNow`, con el avance local solo como contador). Cambiar
 * el reloj del equipo no mueve la fecha: `resetsAt` la fija el servidor en la lectura.
 */
export function resetLabel(resetsAt: number | null, serverNow: number): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt) || !Number.isFinite(serverNow)) return null;
  const ms = resetsAt - serverNow;
  if (ms <= 0) return t("Renovando…");
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return t("Renueva en {d} d {h} h", { d, h });
  if (h > 0) return t("Renueva en {h} h {m} min", { h, m });
  return t("Renueva en {Math} min", { Math: Math.max(1, m) });
}

/* ─────────────────────────── colección ─────────────────────────── */

export interface CollectionProgress {
  /** Cartas DISTINTAS del catálogo vigente que posees (`card_id` únicos). */
  unique: number;
  /** Tamaño del catálogo vigente (cada edición es una carta: 331). */
  total: number;
  /** Ejemplares (filas de `user_cards`): repetidas incluidas. */
  instances: number;
  progress: number;
  milestones: { at: number; reached: boolean }[];
}

/**
 * Colección: `unique` son CARTAS del catálogo distintas (no ejemplares, no jugadores). Solo cuentan ids del catálogo
 * vigente (una carta que ya no existe no infla el total). Los hitos son MARCAS VISUALES sobre esta cifra, sin
 * recompensa propia: las recompensas de colección ya existen como hitos del pase (50 y 150 distintas) y logros.
 */
export function collectionProgress(ownedCardIds: readonly string[], catalogIds: readonly string[], instances: number): CollectionProgress {
  const catalog = new Set(catalogIds);
  const unique = new Set(ownedCardIds.filter((id) => catalog.has(id))).size;
  const total = catalog.size;
  return {
    unique, total, instances: Math.max(unique, Math.floor(instances) || 0),
    progress: total > 0 ? unique / total : 0,
    milestones: [10, 50, 100, 150, 250, total].filter((m, i, a) => m <= total && a.indexOf(m) === i).map((at) => ({ at, reached: unique >= at })),
  };
}

/* ─────────────────────────── niveles ─────────────────────────── */

export interface MeterModel { value: number; max: number; ratio: number; label: string; complete: boolean }

/** Barra segura: nunca NaN, nunca negativa, nunca > 1; con tope → completa. */
export function meter(into: number, forNext: number, complete = false, label = ""): MeterModel {
  const max = Number.isFinite(forNext) && forNext > 0 ? forNext : 1;
  const value = complete ? max : Math.max(0, Math.min(max, Number.isFinite(into) ? into : 0));
  return { value, max, ratio: value / max, label, complete };
}

/* ─────────────────────────── después de la partida ─────────────────────────── */

export interface PostMatchInput {
  xpBefore: number; xpAfter: number; levelsGained: number[];
  objectives: { completed: boolean }[];
  achievementsReady: number;
  seasonXpBefore: number; seasonXpAfter: number;
  rewardGranted: boolean;
}
export type PostMatchSection = "REWARDS" | "ACCOUNT" | "SEASON" | "OBJECTIVES" | "ACHIEVEMENTS";

/** SOLO las secciones que cambiaron de verdad (F62 §16): nada de paneles con +0. */
export function postMatchSections(i: PostMatchInput): PostMatchSection[] {
  const out: PostMatchSection[] = [];
  if (i.rewardGranted) out.push("REWARDS");
  if (i.xpAfter > i.xpBefore || i.levelsGained.length > 0) out.push("ACCOUNT");
  if (i.seasonXpAfter > i.seasonXpBefore) out.push("SEASON");
  if (i.objectives.length > 0) out.push("OBJECTIVES");
  if (i.achievementsReady > 0) out.push("ACHIEVEMENTS");
  return out;
}
