/**
 * F83 · TEMPORADAS — SERVIDOR (jugador). Ingesta de eventos, vista agregada de la ruta y reclamo de recompensas.
 *
 *   · INGESTA: la llaman los MISMOS ganchos que el motor de misiones de F73 (fin de partida ya persistido, crafteo ya
 *     aplicado) y el reclamo de un Collection Set de F82. Calcula la XP con las reglas CONGELADAS de la temporada activa
 *     y la aplica con `app_season_apply` (0064): temporada activa según la hora de la BD, idempotencia por
 *     (usuario, temporada, clave del evento), tope diario por fuente, retos del periodo actual. NUNCA lanza.
 *   · VISTA: una lectura agregada (temporada, progreso, ruta, reclamos, retos del día y de la semana, últimas XP,
 *     historial). Sin escrituras al leer.
 *   · RECLAMO: `app_season_claim` (nivel alcanzado según umbrales congelados, plazo de reclamo, una vez) y la recompensa
 *     por `award()` con clave `season:<temporada>:<nivel>` (exactamente una vez aunque lleguen ocho reclamos).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PACKS } from "@/data/packs";
import { loadSeasonCalendar } from "./season";
import { isMissingRelation } from "@/server/services/f73Config";
import { award } from "./rewards";
import { levelProgress, levelFor } from "@/domain/seasonTrack/curve";
import { activeChallenges } from "@/domain/seasonTrack/rotation";
import { baseXp, challengeOps, type SeasonEvent } from "@/domain/seasonTrack/rules";
import { buildOverview, type SeasonOverview } from "@/domain/seasonTrack/view";
import { phaseOf, SEASON_ID_RE, type GameSeason, type SeasonConfig, type SeasonReward } from "@/domain/seasonTrack/types";

export interface SeasonOut<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const ok = <T,>(data: T): SeasonOut<T> => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, error: string): SeasonOut<never> => ({ ok: false, status, code, error });
const ms = (iso: string | null | undefined): number | null => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Registro estructurado (sin PII: ids de usuario recortados, sin tokens). */
export function logSeason(level: "info" | "error", event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ scope: "season", event, ...data });
  if (level === "error") console.error(line); else console.info(line);
}

export const SEASON_COLS = "id, number, name, description, status, starts_at, ends_at, claim_until, max_level, config, config_version, checksum, published_at, row_version";
interface SeasonRow {
  id: string; number: number; name: string; description: string; status: string; starts_at: string; ends_at: string; claim_until: string;
  max_level: number; config: SeasonConfig; config_version: number; checksum: string | null; published_at: string | null; row_version: number;
}
export function fromSeasonRow(r: SeasonRow): GameSeason {
  return {
    id: r.id, number: r.number, name: r.name, description: r.description ?? "", status: r.status as GameSeason["status"],
    startsAt: ms(r.starts_at) ?? 0, endsAt: ms(r.ends_at) ?? 0, claimUntil: ms(r.claim_until) ?? 0, maxLevel: r.max_level,
    config: r.config, configVersion: r.config_version, checksum: r.checksum, publishedAt: ms(r.published_at), rowVersion: r.row_version,
  };
}

/** Temporadas PUBLICADAS (pocas; caché corta por cliente para no consultarlas en cada evento). */
const CACHE = new WeakMap<object, { at: number; seasons: GameSeason[] }>();
const TTL = 10_000;
export async function publishedSeasons(sb: SupabaseClient, now = Date.now()): Promise<GameSeason[] | null> {
  const hit = CACHE.get(sb);
  if (hit && now - hit.at < TTL) return hit.seasons;
  const { data, error } = await sb.from("game_seasons").select(SEASON_COLS).eq("status", "PUBLISHED").order("starts_at", { ascending: true });
  if (error) { if (isMissingRelation(error as never)) return null; throw new Error(error.message); }
  const seasons = ((data ?? []) as SeasonRow[]).map(fromSeasonRow);
  CACHE.set(sb, { at: now, seasons });
  return seasons;
}
export const invalidateSeasonCache = (sb: SupabaseClient) => CACHE.delete(sb);

/** Temporada que se enseña: la ACTIVA; si no, la que está en gracia; si no, la próxima programada. */
export function displaySeason(seasons: readonly GameSeason[], now: number): GameSeason | null {
  return seasons.find((s) => phaseOf(s, now) === "ACTIVE")
    ?? [...seasons].reverse().find((s) => phaseOf(s, now) === "GRACE")
    ?? seasons.find((s) => phaseOf(s, now) === "SCHEDULED")
    ?? null;
}

const sourceOf = (e: SeasonEvent): "MATCH" | "CRAFT" | "COLLECTION" | null =>
  e.kind === "MATCH" ? "MATCH" : e.kind === "CRAFT_PACK" || e.kind === "CRAFT_CARD" ? "CRAFT" : e.kind === "COLLECTION" ? "COLLECTION" : null;

export interface IngestResult { applied: boolean; xpGained: number; xp: number; completed: string[] }

/**
 * Aplica UN evento a UN usuario en la temporada ACTIVA. Sin temporada activa, sin XP ni retos que tocar, o sin 0064:
 * no hace nada. Nunca lanza (una temporada no puede romper una partida, un crafteo ni un reclamo).
 */
export async function ingestSeasonEvent(sb: SupabaseClient, userId: string, event: SeasonEvent, now = Date.now()): Promise<IngestResult | null> {
  try {
    const seasons = await publishedSeasons(sb, now);
    const season = seasons?.find((s) => phaseOf(s, now) === "ACTIVE");
    if (!season || !userId) return null;
    const source = sourceOf(event);
    if (!source) return null;
    const grant = baseXp(season.config, event);
    const ops = challengeOps(activeChallenges(season.id, season.config, now), event);
    if (!grant && ops.length === 0) return null;
    const { data, error } = await sb.rpc("app_season_apply", {
      p_user: userId, p_season: season.id, p_event_key: event.key, p_source: source,
      p_amount: grant?.amount ?? 0, p_daily_cap: grant?.dailyCap ?? null, p_ops: ops,
      p_meta: event.kind === "MATCH" ? { mode: event.mode, won: event.won } : { kind: event.kind },
    });
    if (error) { logSeason("error", "season_event_failed", { source, key: event.key.slice(0, 80), code: error.code ?? null }); return null; }
    const r = (data ?? {}) as { code?: string; xpGained?: number; xp?: number; completed?: string[] };
    if (r.code === "REPEATED") { logSeason("info", "season_event_duplicate", { source, key: event.key.slice(0, 80) }); return { applied: false, xpGained: 0, xp: 0, completed: [] }; }
    if (r.code !== "APPLIED") return null;
    if ((r.completed ?? []).length) logSeason("info", "season_challenges_completed", { season: season.id, count: r.completed!.length });
    return { applied: true, xpGained: r.xpGained ?? 0, xp: r.xp ?? 0, completed: r.completed ?? [] };
  } catch (e) {
    logSeason("error", "season_event_hook_failed", { error: (e as Error).message.slice(0, 200) });
    return null;
  }
}

/* ═══════════════════════════ VISTA ═══════════════════════════ */

const legacyCurrent = (now: number) => {
  const l = loadSeasonCalendar().find((e) => Date.parse(e.startsAt) <= now && now < Date.parse(e.endsAt));
  return l ? { name: l.displayName ?? l.name, endsAt: Date.parse(l.endsAt) } : null;
};

export async function getSeasonOverview(sb: SupabaseClient, userId: string, now = Date.now()): Promise<SeasonOut<SeasonOverview>> {
  let seasons: GameSeason[] | null;
  try { seasons = await publishedSeasons(sb, now); } catch (e) { logSeason("error", "season_overview_failed", { error: (e as Error).message.slice(0, 200) }); throw e; }
  const legacy = legacyCurrent(now);
  if (!seasons) return ok(buildOverview({ now, season: null, legacy, xp: 0, claims: [], challengeRows: [], recent: [], history: [] }));
  const season = displaySeason(seasons, now);
  const pastIds = seasons.filter((s) => s.id !== season?.id && ["GRACE", "ARCHIVED"].includes(phaseOf(s, now))).map((s) => s.id);
  const [prog, claims, challenges, recent, past, pastClaims] = await Promise.all([
    season ? sb.from("season_progress").select("xp").eq("user_id", userId).eq("season_id", season.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    season ? sb.from("season_reward_claims").select("level").eq("user_id", userId).eq("season_id", season.id) : Promise.resolve({ data: [], error: null }),
    season && phaseOf(season, now) === "ACTIVE" ? sb.from("season_challenge_progress").select("period_key, challenge_id, progress, completed_at").eq("user_id", userId).eq("season_id", season.id) : Promise.resolve({ data: [], error: null }),
    season ? sb.from("season_xp_ledger").select("source, event_key, amount, created_at, meta").eq("user_id", userId).eq("season_id", season.id).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [], error: null }),
    pastIds.length ? sb.from("season_progress").select("season_id, xp").eq("user_id", userId).in("season_id", pastIds) : Promise.resolve({ data: [], error: null }),
    pastIds.length ? sb.from("season_reward_claims").select("season_id, level").eq("user_id", userId).in("season_id", pastIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [prog, claims, challenges, recent, past, pastClaims]) if (r.error) throw new Error(r.error.message);
  const byPast = new Map(seasons.map((s) => [s.id, s]));
  const pastClaimCount = new Map<string, number>();
  for (const c of (pastClaims.data ?? []) as { season_id: string }[]) pastClaimCount.set(c.season_id, (pastClaimCount.get(c.season_id) ?? 0) + 1);
  return ok(buildOverview({
    now, season, legacy,
    xp: Number((prog.data as { xp?: number } | null)?.xp ?? 0),
    claims: ((claims.data ?? []) as { level: number }[]).map((c) => c.level),
    challengeRows: ((challenges.data ?? []) as { period_key: string; challenge_id: string; progress: number; completed_at: string | null }[])
      .map((r) => ({ periodKey: r.period_key, challengeId: r.challenge_id, progress: r.progress, completed: r.completed_at !== null })),
    recent: ((recent.data ?? []) as { source: string; event_key: string; amount: number; created_at: string; meta: { by?: string } | null }[])
      .map((r) => ({ source: r.source, eventKey: r.event_key, amount: r.amount, at: ms(r.created_at) ?? 0, by: r.meta?.by ?? null })),
    history: ((past.data ?? []) as { season_id: string; xp: number }[]).map((p) => {
      const s = byPast.get(p.season_id)!;
      return { seasonId: s.id, number: s.number, name: s.name, xp: p.xp, finalLevel: levelFor(p.xp, s.config.levels), maxLevel: s.maxLevel, rewardsClaimed: pastClaimCount.get(s.id) ?? 0, endedAt: s.endsAt };
    }).sort((a, b) => b.number - a.number),
  }));
}

/* ═══════════════════════════ RECLAMO ═══════════════════════════ */

export interface ClaimResult { seasonId: string; level: number; outcome: "CLAIMED" | "ALREADY"; reward: SeasonReward; overview: SeasonOverview | null }

const rewardFor = (r: SeasonReward) => ({
  credits: r.credits ?? 0,
  ...(r.packId && (r.packCount ?? 0) > 0 ? { packId: r.packId, packCount: r.packCount } : {}),
  ...(r.badge ? { cosmetics: [r.badge] } : {}),
});

export async function claimSeasonLevel(sb: SupabaseClient, userId: string, seasonId: unknown, level: unknown, now = Date.now()): Promise<SeasonOut<ClaimResult>> {
  if (typeof seasonId !== "string" || !SEASON_ID_RE.test(seasonId)) return fail(400, "BAD_SEASON", "Temporada no válida");
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 100) return fail(400, "BAD_LEVEL", "Nivel no válido");
  const { data, error } = await sb.rpc("app_season_claim", { p_user: userId, p_season: seasonId, p_level: level });
  if (error) {
    if (/app_season_claim|PGRST202|does not exist/i.test(error.message ?? "")) return fail(503, "NOT_READY", "Las temporadas aún no están disponibles");
    throw new Error(error.message);
  }
  const r = (data ?? {}) as { code?: string; reward?: SeasonReward; xp?: number; need?: number };
  switch (r.code) {
    case "CLAIMED": case "ALREADY": {
      const reward = r.reward ?? {};
      // La recompensa sale por award() con clave estable: un reintento tras un fallo a medias la completa, nunca la duplica.
      const out = await award(sb, { userId, ref: `season:${seasonId}:${level}`, reason: `season_reward: ${seasonId} nivel ${level}`, reward: rewardFor(reward) });
      const outcome = r.code === "CLAIMED" && out.applied ? "CLAIMED" : "ALREADY";
      logSeason("info", outcome === "CLAIMED" ? "season_reward_claimed" : "season_reward_duplicate", { season: seasonId, level });
      const view = await getSeasonOverview(sb, userId, now).catch(() => null);
      return ok({ seasonId, level, outcome, reward, overview: view?.data ?? null });
    }
    case "LOCKED": return fail(409, "LOCKED", "Todavía no has alcanzado ese nivel");
    case "CLOSED": return fail(409, "CLOSED", "El plazo para reclamar esta temporada ha terminado");
    case "NO_REWARD": return fail(404, "NO_REWARD", "Ese nivel no tiene recompensa");
    case "BAD_LEVEL": return fail(400, "BAD_LEVEL", "Nivel no válido");
    case "NOT_FOUND": return fail(404, "NOT_FOUND", "Esa temporada no existe o no ha empezado");
    default: return fail(500, "UNAVAILABLE", "No se pudo reclamar");
  }
}

/* ═══════════════════════════ PERFIL (resumen público) ═══════════════════════════ */

/** F89 · nivel de temporada para el perfil: solo nombre, nivel y máximo de la temporada activa o en gracia. Nada del libro. */
export async function seasonSummaryFor(sb: SupabaseClient, playerId: string, now = Date.now()): Promise<{ seasonId: string; name: string; level: number; maxLevel: number; phase: "ACTIVE" | "GRACE" } | null> {
  try {
    const seasons = await publishedSeasons(sb, now);
    const s = seasons ? displaySeason(seasons, now) : null;
    if (!s) return null;
    const phase = phaseOf(s, now);
    if (phase !== "ACTIVE" && phase !== "GRACE") return null;
    const { data } = await sb.from("season_progress").select("xp").eq("user_id", playerId).eq("season_id", s.id).maybeSingle();
    const xp = Number((data as { xp?: number } | null)?.xp ?? 0);
    return { seasonId: s.id, name: s.name, level: levelProgress(xp, s.config.levels).level, maxLevel: s.maxLevel, phase };
  } catch { return null; }
}

export const packPrice = (packId: string): number | null => PACKS.find((p) => p.id === packId)?.price ?? null;
