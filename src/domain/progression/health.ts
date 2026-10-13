/**
 * FASE 62 · SALUD DE LA PROGRESIÓN (puro). La usa `/admin/system` y los tests de contenido.
 *
 * Comprueba que el CONTENIDO de progresión se puede servir y pagar tal y como está escrito — no reequilibra nada:
 *   · temporada activa en el calendario canónico, enlazada al pase vigente;
 *   · cada recompensa del carril (libre, competitivo, de pago) y de cada misión es ENTREGABLE (`validateReward`);
 *   · los niveles del carril están dentro de 1..maxLevel;
 *   · cada misión mide una MÉTRICA que el servidor sabe calcular (`loadFacts`), con meta entera positiva y XP ≥ 0;
 *   · los logros tienen id único, meta y recompensa válidas.
 * La idempotencia de los pagos no se «comprueba» aquí: la garantiza el índice único del libro mayor (`app_grant_reward`
 * con `ref`), y la prueban los tests de servicio.
 */
import { validateReward, type RewardIssue } from "@/domain/rewards/display";

/** Métricas que calcula `services/progression.loadFacts` (la fuente de verdad del progreso de misiones). */
export const SERVER_METRICS = ["packs_opened", "points", "region_set", "owned_cards", "distinct_cards", "duels_played", "duels_won", "decks_saved", "picks_made"] as const;

export type HealthLevel = "HEALTHY" | "WARNING" | "CRITICAL";
export interface ProgressionIssue { where: string; code: string }
export interface ProgressionHealth { level: HealthLevel; issues: ProgressionIssue[]; summary: string }

interface TrackLike { [level: number]: Record<string, unknown> | undefined }
export interface SeasonLike {
  id: string; maxLevel: number; xpPerLevel: number;
  free: TrackLike; competitive?: TrackLike; premium: TrackLike;
  missionPool: { id: string; metric: string; goal: number; xp?: number; reward: Record<string, unknown> }[];
}

export function progressionHealth(input: {
  season: SeasonLike;
  calendarSeasonIds: (string | null)[];
  activeCalendarSeasonId: string | null;
  achievements: { id: string; goal: number; reward: number }[];
  packExists: (id: string) => boolean;
  cardExists: (id: string) => boolean;
}): ProgressionHealth {
  const issues: ProgressionIssue[] = [];
  const { season } = input;
  const known = { packExists: input.packExists, cardExists: input.cardExists };
  const push = (where: string, list: RewardIssue[]) => { for (const i of list) issues.push({ where, code: `${i.code}:${i.field}` }); };

  if (!input.calendarSeasonIds.includes(season.id)) issues.push({ where: "calendar", code: "PASS_SEASON_NOT_IN_CALENDAR" });
  if (input.activeCalendarSeasonId !== season.id) issues.push({ where: "calendar", code: "ACTIVE_SEASON_MISMATCH" });
  if (!(season.maxLevel > 0) || !(season.xpPerLevel > 0)) issues.push({ where: "season", code: "BAD_LEVEL_CURVE" });

  for (const [name, track] of [["free", season.free], ["competitive", season.competitive ?? {}], ["premium", season.premium]] as const) {
    for (const [k, r] of Object.entries(track)) {
      const lvl = Number(k);
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > season.maxLevel) issues.push({ where: `track:${name}:${k}`, code: "LEVEL_OUT_OF_RANGE" });
      push(`track:${name}:${k}`, validateReward(r as Record<string, unknown>, known));
    }
  }

  const ids = new Set<string>();
  for (const m of season.missionPool) {
    if (ids.has(m.id)) issues.push({ where: `mission:${m.id}`, code: "DUPLICATE_ID" });
    ids.add(m.id);
    if (!(SERVER_METRICS as readonly string[]).includes(m.metric)) issues.push({ where: `mission:${m.id}`, code: "UNKNOWN_METRIC" });
    if (!Number.isInteger(m.goal) || m.goal <= 0) issues.push({ where: `mission:${m.id}`, code: "BAD_GOAL" });
    if (m.xp !== undefined && (!Number.isFinite(m.xp) || m.xp < 0)) issues.push({ where: `mission:${m.id}`, code: "BAD_XP" });
    push(`mission:${m.id}`, validateReward(m.reward, known));
  }

  const aIds = new Set<string>();
  for (const a of input.achievements) {
    if (aIds.has(a.id)) issues.push({ where: `achievement:${a.id}`, code: "DUPLICATE_ID" });
    aIds.add(a.id);
    if (!(a.goal > 0)) issues.push({ where: `achievement:${a.id}`, code: "BAD_GOAL" });
    if (!Number.isInteger(a.reward) || a.reward < 0) issues.push({ where: `achievement:${a.id}`, code: "BAD_REWARD" });
  }

  const critical = issues.some((i) => /UNKNOWN_PACK|UNKNOWN_CARD|NEGATIVE|UNKNOWN_METRIC|BAD_LEVEL_CURVE|NO_DELIVERY/.test(i.code));
  const level: HealthLevel = issues.length === 0 ? "HEALTHY" : critical ? "CRITICAL" : "WARNING";
  const levels = Object.keys(season.free).length + Object.keys(season.competitive ?? {}).length + Object.keys(season.premium).length;
  return {
    level, issues,
    summary: issues.length === 0
      ? `Temporada ${season.id} activa · ${levels} recompensas de carril y ${season.missionPool.length} misiones entregables · ${input.achievements.length} logros`
      : `${issues.length} problema(s): ${issues.slice(0, 4).map((i) => `${i.where} ${i.code}`).join(" · ")}`,
  };
}
