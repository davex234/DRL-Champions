/**
 * FASE 52 · SEASON COMMAND CENTER — vista derivada, PURA, de la foto del servidor (`SeasonHubSnapshot`).
 *
 * Aquí no hay ni una cifra de economía: niveles, XP, recompensas, misiones y estados salen tal cual de la
 * foto (que compone `services/season.ts` desde `peekProgression`). Este módulo solo los ORDENA y los NOMBRA
 * para pintarlos: el carril de recompensas por nivel, las misiones por su tipo real y el siguiente
 * objetivo concreto. Determinista: misma foto → misma vista.
 *
 * Reclamar no vive aquí ni en `/temporada`: sigue en `/logros` (`POST /api/game/progression`, idempotente
 * por clave en el libro mayor). Un nodo RECLAMABLE enlaza allí.
 */
import type { Reward } from "@/battlepass";
import type { MetaObjective } from "@/domain/progression/meta";
import { isMissionAvailable, LIVE_MISSION_FLAGS, type MissionFlags } from "@/domain/progression/missionAvailability";

/* ─────────────────────────── Recompensas ─────────────────────────── */

export type RewardPart =
  | { kind: "credits"; amount: number }
  | { kind: "pack"; packId: string; count: number }
  | { kind: "card"; cardId: string }
  | { kind: "xp"; amount: number };

/**
 * Las partes REALES de una recompensa, en orden de peso visual (carta, sobre, créditos, XP de cuenta).
 * Lo que el servidor no sabe entregar (`materials`, `cosmetics` del carril de pago) no se muestra: el Season
 * Hub solo enseña los carriles libre y competitivo, que solo llevan créditos y sobres.
 */
export function rewardParts(r: Reward | null | undefined): RewardPart[] {
  if (!r) return [];
  const out: RewardPart[] = [];
  if (r.cardId) out.push({ kind: "card", cardId: r.cardId });
  if (r.packId && (r.packCount ?? 1) > 0) out.push({ kind: "pack", packId: r.packId, count: r.packCount ?? 1 });
  if (r.credits && r.credits > 0) out.push({ kind: "credits", amount: r.credits });
  if (r.xp && r.xp > 0) out.push({ kind: "xp", amount: r.xp });
  return out;
}

/* ─────────────────────────── Carril de recompensas ─────────────────────────── */

/**
 * Estados de un nodo, SOLO los que el sistema soporta:
 *   · CLAIMED     — reclamado (`claimed`);
 *   · CLAIMABLE   — alcanzado y sin reclamar (`claimable`: el servidor lo decide);
 *   · LANE_LOCKED — nivel alcanzado pero el carril competitivo sigue cerrado (se abre en Oro);
 *   · LOCKED      — nivel aún no alcanzado.
 */
export type NodeState = "CLAIMED" | "CLAIMABLE" | "LANE_LOCKED" | "LOCKED";

export interface TrackLevelLike { level: number; reward: Reward; claimed: boolean; claimable: boolean }

export interface PassLike {
  level: number; maxLevel: number; xpIntoLevel: number; xpForNext: number; progress: number;
  competitiveUnlocked: boolean;
  tracks: { free: TrackLevelLike[]; competitive: TrackLevelLike[] };
}

export interface TrackNode { level: number; track: "free" | "competitive"; reward: Reward; state: NodeState }
export interface TrackColumn { level: number; free: TrackNode | null; competitive: TrackNode | null; current: boolean; next: boolean }

export function nodeState(l: TrackLevelLike, passLevel: number, laneOpen: boolean): NodeState {
  if (l.claimed) return "CLAIMED";
  if (l.claimable) return "CLAIMABLE";
  // Alcanzado pero no reclamable: el servidor manda. Solo el carril cerrado tiene nombre propio.
  if (l.level <= passLevel && !laneOpen) return "LANE_LOCKED";
  return "LOCKED";
}

/** Una columna por nivel (1..maxLevel) con sus dos carriles, alineados. */
export function trackColumns(pass: PassLike): TrackColumn[] {
  const free = new Map(pass.tracks.free.map((l) => [l.level, l]));
  const comp = new Map(pass.tracks.competitive.map((l) => [l.level, l]));
  const cols: TrackColumn[] = [];
  for (let level = 1; level <= pass.maxLevel; level++) {
    const f = free.get(level); const c = comp.get(level);
    if (!f && !c) continue;
    cols.push({
      level,
      free: f ? { level, track: "free", reward: f.reward, state: nodeState(f, pass.level, true) } : null,
      competitive: c ? { level, track: "competitive", reward: c.reward, state: nodeState(c, pass.level, pass.competitiveUnlocked) } : null,
      current: level === pass.level,
      next: level === pass.level + 1,
    });
  }
  return cols;
}

/** El índice de la columna a la que debe abrirse el carril: el nivel actual (o el primero). */
export function focusColumnIndex(cols: TrackColumn[]): number {
  const i = cols.findIndex((c) => c.current);
  if (i >= 0) return i;
  const n = cols.findIndex((c) => c.next);
  return n >= 0 ? n : 0;
}

/* ─────────────────────────── Misiones ─────────────────────────── */

export type MissionState = "ACTIVE" | "COMPLETE" | "CLAIMED";

/** Los tipos REALES de misión del pase, en el orden en que se enseñan. Otros tipos, si llegan, van al final. */
export const MISSION_KIND_ORDER = ["daily", "weekly", "seasonal", "progressive"] as const;
export const MISSION_KIND_LABEL: Record<string, string> = {
  daily: "Diarias", weekly: "Semanales", seasonal: "De temporada", progressive: "Hitos",
};

export interface MissionView extends MetaObjective {
  state: MissionState;
  /** 0..1, recortado. */
  ratio: number;
  remaining: number;
}

export function missionView(o: MetaObjective): MissionView {
  const goal = Math.max(1, o.goal);
  const current = Math.max(0, Math.min(o.current, goal));
  const state: MissionState = o.claimed ? "CLAIMED" : o.complete ? "COMPLETE" : "ACTIVE";
  return { ...o, state, ratio: state === "ACTIVE" ? current / goal : 1, remaining: state === "ACTIVE" ? Math.max(0, goal - current) : 0 };
}

/**
 * Misiones por tipo real. Las que piden el Marketplace no se ofrecen con él cerrado (mismo contrato que
 * el sorteo de misiones: `missionAvailability`). Dentro de cada grupo: primero lo que se puede hacer ya
 * (en curso, lo más cercano a completarse), después lo completado por reclamar y al final lo reclamado.
 */
export function missionGroups(list: readonly MetaObjective[], flags: MissionFlags = LIVE_MISSION_FLAGS): { kind: string; label: string; missions: MissionView[] }[] {
  const byKind = new Map<string, MissionView[]>();
  for (const o of list) {
    if (!isMissionAvailable(o, flags)) continue;
    const k = String(o.kind);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(missionView(o));
  }
  const rank: Record<MissionState, number> = { ACTIVE: 0, COMPLETE: 1, CLAIMED: 2 };
  const kinds = [...MISSION_KIND_ORDER.filter((k) => byKind.has(k)), ...[...byKind.keys()].filter((k) => !(MISSION_KIND_ORDER as readonly string[]).includes(k)).sort()];
  return kinds.map((kind) => ({
    kind,
    label: MISSION_KIND_LABEL[kind] ?? kind,
    missions: byKind.get(kind)!.sort((a, b) => rank[a.state] - rank[b.state] || b.ratio - a.ratio || a.id.localeCompare(b.id)),
  }));
}

/* ─────────────────────────── Siguiente objetivo ─────────────────────────── */

export type NextStep =
  | { kind: "claim"; count: number; href: "/logros" }
  | { kind: "mission"; id: string; label: string; remaining: number; goal: number; current: number; xp: number; rewardCredits: number; packId: string | null; packCount: number }
  | { kind: "level"; xpRemaining: number; nextLevel: number; reward: Reward | null };

/**
 * Lo que el jugador puede hacer AHORA, derivado sin interpretación:
 *   1. si hay recompensas reclamables (niveles + misiones), reclamarlas;
 *   2. la misión en curso a la que MENOS le falta (empates: la de mayor proporción, luego id);
 *   3. la XP de pase que falta para el siguiente nivel y lo que da.
 * Devuelve los pasos que existan, en ese orden (como mucho uno de cada).
 */
export function nextSteps(input: {
  pass: (PassLike & { nextReward?: { level: number; reward: Reward } | null }) | null;
  objectives: readonly MetaObjective[];
  claimableLevels: number;
  claimableMissions: number;
}, flags: MissionFlags = LIVE_MISSION_FLAGS): NextStep[] {
  const out: NextStep[] = [];
  const claim = input.claimableLevels + input.claimableMissions;
  if (claim > 0) out.push({ kind: "claim", count: claim, href: "/logros" });
  const activas = input.objectives.filter((o) => isMissionAvailable(o, flags)).map(missionView).filter((m) => m.state === "ACTIVE" && m.remaining > 0);
  activas.sort((a, b) => a.remaining - b.remaining || b.ratio - a.ratio || a.id.localeCompare(b.id));
  const m = activas[0];
  if (m) out.push({ kind: "mission", id: m.id, label: m.label, remaining: m.remaining, goal: m.goal, current: Math.min(m.current, m.goal), xp: m.xp, rewardCredits: m.rewardCredits, packId: m.packId, packCount: m.packCount });
  const p = input.pass;
  if (p && p.level < p.maxLevel) {
    const nextLevel = p.level + 1;
    const free = p.tracks.free.find((l) => l.level === nextLevel)?.reward ?? null;
    out.push({ kind: "level", xpRemaining: Math.max(0, p.xpForNext - p.xpIntoLevel), nextLevel, reward: free });
  }
  return out;
}
