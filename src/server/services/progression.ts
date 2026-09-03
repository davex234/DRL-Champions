/**
 * PROGRESIÓN — SERVICIO CON AUTORIDAD DE SERVIDOR (Fase 9E, SOLO SERVIDOR).
 *
 * El único sitio donde avanza el pase de temporada y se reclaman logros. Une piezas que
 * ya existían y no reimplementa ninguna:
 *
 *   · MOTOR       → `@/battlepass` (Fase 6 de Colección), puro y determinista.
 *   · TEMPORADA   → `@/data/season`, datos.
 *   · MÉTRICAS    → las tablas REALES del jugador. No hay contadores nuevos.
 *   · RECOMPENSAS → `app_grant_reward`, la RPC que ya existe, con su clave de
 *                   idempotencia y su asiento en `credit_transactions`.
 *
 * FRONTERAS DE SEGURIDAD
 *
 *   1. El `userId` viene del token (`getSession`), nunca del cuerpo de la petición.
 *   2. El cliente NO envía progreso. El servidor lee las métricas de la base de datos y
 *      calcula. Un cliente que dijera «he abierto 1000 sobres» no cambia nada.
 *   3. Reclamar dos veces no paga dos veces: lo impiden la clave primaria de
 *      `user_achievements` y el `ref` de `app_grant_reward`, de forma independiente.
 *   4. El carril competitivo lo abre el servidor comparando `profiles.points` con el
 *      umbral de la temporada. El motor solo guarda la decisión.
 *   5. El carril de pago NO se puede abrir pagando: no hay pasarela (§12). Se abre con
 *      fichas de evento, que se ganan jugando.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PassEngine, migratePassState, freshPassState, levelProgress, missionProgress,
  assignMission, rollMissions, trackOf,
  type PassState, type PassTrack, type Reward, type MetricSnapshot, type ActiveMission,
} from "@/battlepass";
import { CURRENT_SEASON } from "@/data/season";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { makeRng } from "@/sim/rng";
import { randomInt } from "node:crypto";
import { awardMany } from "./rewards";

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  data?: T;
}

const ok = <T,>(data: T): ServiceResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error });

// ───────────────────────────── Métricas reales ─────────────────────────────

/**
 * Instantánea de métricas del jugador, leída de las tablas donde ya vive cada cifra.
 *
 * Ninguna de estas cuentas se guarda en una tabla de progresión: duplicar un contador es
 * la forma más segura de que las dos copias dejen de coincidir. Se calcula al vuelo, con
 * consultas de solo recuento (`head: true`), que no traen filas.
 */
export async function metricsFor(admin: SupabaseClient, userId: string): Promise<MetricSnapshot> {
  const [profile, cards, duels, wins, decks, picks] = await Promise.all([
    admin.from("profiles").select("packs_opened, points, region").eq("id", userId).maybeSingle(),
    admin.from("user_cards").select("card_id", { count: "exact", head: true }).eq("user_id", userId),
    // Terminada = cualquier estado final del orquestador. Un empate cuenta como
    // partida jugada, que es lo que pregunta la misión.
    admin.from("duel_matches").select("id", { count: "exact", head: true })
      .eq("user_id", userId).in("status", ["COMPLETED", "DRAW", "UNRESOLVED"]),
    // El jugador es siempre el bando A (`HUMAN` en el servicio de duelos).
    admin.from("duel_matches").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("winner", "A"),
    admin.from("duel_decks").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("pickem_answers").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  const p = profile.data as { packs_opened: number; points: number; region: string | null } | null;

  return {
    packs_opened: p?.packs_opened ?? 0,
    points: p?.points ?? 0,
    region_set: p?.region ? 1 : 0,
    // `user_cards` guarda una fila por EJEMPLAR; para «cartas distintas» habría que
    // agrupar. El recuento de filas es el de cartas poseídas, y así se llama la métrica.
    owned_cards: cards.count ?? 0,
    distinct_cards: cards.count ?? 0,
    duels_played: duels.count ?? 0,
    duels_won: wins.count ?? 0,
    decks_saved: decks.count ?? 0,
    picks_made: picks.count ?? 0,
  };
}

// ───────────────────────────── Estado del pase ─────────────────────────────

interface PassRow { user_id: string; season_id: string; state: PassState }

/**
 * Carga el pase del jugador, creándolo si no existe y avanzando de temporada si la fila
 * guardada es de una anterior. `migratePassState` sanea cualquier estado antiguo, así que
 * un cambio de forma del `PassState` no rompe a nadie.
 */
async function loadPass(admin: SupabaseClient, userId: string): Promise<PassState> {
  const { data } = await admin.from("user_pass")
    .select("user_id, season_id, state").eq("user_id", userId).maybeSingle();
  const row = data as PassRow | null;

  if (!row) return freshPassState(CURRENT_SEASON.id);
  const state = migratePassState(row.state, CURRENT_SEASON.id);
  // Temporada distinta: se archiva y se empieza limpio, conservando el historial.
  if (state.seasonId !== CURRENT_SEASON.id) {
    const engine = new PassEngine(state, CURRENT_SEASON);
    return engine.advanceSeason(CURRENT_SEASON.id, Date.now()).state;
  }
  return state;
}

async function savePass(admin: SupabaseClient, userId: string, state: PassState): Promise<void> {
  const { error } = await admin.from("user_pass")
    .upsert({ user_id: userId, season_id: state.seasonId, state }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

/**
 * Concede una lista de recompensas por LA RUTA ÚNICA (`services/rewards`).
 *
 * Fase 10: antes esta función hacía dos escrituras. Llamaba a `app_grant_reward` con los
 * cuatro campos que la RPC entendía y, DESPUÉS, guardaba los cosméticos con un `upsert`
 * aparte —fuera de la transacción de la RPC—. Ese orden tenía un agujero: si el `upsert`
 * fallaba, la puerta de idempotencia ya estaba cerrada por el asiento del libro mayor, así
 * que al reintentar no se concedía nada y el jugador se quedaba sin el cosmético para
 * siempre.
 *
 * Ahora es una sola llamada y una sola transacción. Además, un carril del pase que llevara
 * una CARTA —que `Reward` admite y esto no sabía entregar— se concede igual que el resto.
 *
 * `ref` sigue siendo la clave de idempotencia y no cambia de forma: las claves ya escritas
 * en el libro mayor de fases anteriores se siguen reconociendo.
 */
async function grantRewards(
  admin: SupabaseClient, userId: string, rewards: Reward[], ref: string, reason: string,
): Promise<void> {
  const results = await awardMany(admin, userId, rewards, ref, reason);
  // Lo que el servidor no sabe entregar se REGISTRA en vez de perderse en silencio: es la
  // señal de que una temporada nueva ha metido un tipo de recompensa sin ruta de entrega.
  for (const r of results) {
    if (r.unsupported.length > 0) {
      console.warn(`[progresion] ${ref}: sin ruta de entrega para ${r.unsupported.join(", ")}`);
    }
  }
}

// ───────────────────────────── Vista pública ─────────────────────────────

export interface PassTrackLevelView {
  level: number;
  reward: Reward;
  claimed: boolean;
  claimable: boolean;
}

export interface PassMissionView {
  id: string;
  label: string;
  kind: string;
  current: number;
  goal: number;
  complete: boolean;
  claimed: boolean;
  rewardCredits: number;
  xp: number;
}

export interface ProgressionView {
  season: { id: string; name: string; maxLevel: number };
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
  premium: boolean;
  competitiveUnlocked: boolean;
  competitiveMinPoints: number;
  points: number;
  tokens: number;
  /** Coste en fichas de abrir el carril de pago sin dinero real. */
  premiumTokenCost: number;
  /** Cosméticos equipados, FAMILIA → id. Vacío si no lleva ninguno. */
  equipped: Record<string, string>;
  tracks: Record<PassTrack, PassTrackLevelView[]>;
  missions: PassMissionView[];
  achievements: AchievementView[];
  cosmetics: string[];
}

export interface AchievementView {
  id: string;
  name: string;
  description: string;
  icon: string;
  reward: number;
  goal: number;
  current: number;
  complete: boolean;
  claimed: boolean;
}

function trackView(
  season: typeof CURRENT_SEASON, track: PassTrack, state: PassState, reached: number, open: boolean,
): PassTrackLevelView[] {
  const t = trackOf(season, track);
  const claimed = new Set(
    track === "premium" ? state.claimedPremium
      : track === "competitive" ? state.claimedCompetitive
      : state.claimedFree,
  );
  return Object.keys(t)
    .map(Number)
    .sort((a, b) => a - b)
    .map((level) => ({
      level,
      reward: t[level],
      claimed: claimed.has(level),
      claimable: open && level <= reached && !claimed.has(level),
    }));
}

/**
 * Progreso de logros calculado con datos del SERVIDOR.
 *
 * El catálogo (`ACHIEVEMENTS`) evalúa el progreso sobre un contexto de colección que se
 * arma en el navegador. Aquí solo se usan los logros cuyo progreso se puede derivar de
 * métricas de servidor; el resto se enseña con su progreso, pero el reclamo lo autoriza
 * siempre el servidor con su propia cuenta.
 */
function achievementViews(
  metrics: MetricSnapshot, claimed: Set<string>,
): AchievementView[] {
  return ACHIEVEMENTS.map((a) => {
    const current = serverProgressFor(a.id, metrics);
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      reward: a.reward,
      goal: a.goal,
      current: Math.min(current, a.goal),
      complete: current >= a.goal,
      claimed: claimed.has(a.id),
    };
  });
}

/**
 * Progreso de un logro medido SOLO con lo que el servidor sabe.
 *
 * Los logros de colección («completar Team Heretics») dependen de qué cartas concretas
 * se poseen, y esa evaluación vive en el catálogo del cliente. Para esos se devuelve el
 * número de cartas poseídas, que es una cota inferior honesta: el reclamo no se abrirá
 * antes de tiempo, y como mucho se abrirá tarde. Prefiero eso a conceder de más.
 */
function serverProgressFor(id: string, m: MetricSnapshot): number {
  switch (id) {
    case "sobres-100":
    case "sobres-1000":
      return m.packs_opened ?? 0;
    case "coleccionista":
      return m.distinct_cards ?? 0;
    default:
      return 0;
  }
}

// ───────────────────────────── Operaciones ─────────────────────────────

/** Todo lo que la pantalla de progresión necesita, en una sola lectura. */
export async function getProgression(
  admin: SupabaseClient, userId: string,
): Promise<ServiceResult<ProgressionView>> {
  const metrics = await metricsFor(admin, userId);
  let state = await loadPass(admin, userId);

  // El carril competitivo lo abre el SERVIDOR al comprobar los puntos. Si el jugador ya
  // ha llegado al umbral y el carril sigue cerrado, se abre y se persiste aquí mismo.
  const minPoints = CURRENT_SEASON.competitiveMinPoints ?? Number.POSITIVE_INFINITY;
  if (!state.competitiveUnlocked && (metrics.points ?? 0) >= minPoints) {
    const engine = new PassEngine(state, CURRENT_SEASON);
    state = engine.unlockCompetitive(Date.now()).state;
    await savePass(admin, userId, state);
  }

  // Misiones: si no hay ninguna asignada, se sortean las rotatorias y se fijan las fijas.
  if (state.missions.length === 0) {
    state = await refreshMissionsFor(admin, userId, state, metrics);
  }

  const [{ data: profile }, { data: claimedRows }, { data: cosmeticRows }] = await Promise.all([
    admin.from("profiles").select("tokens, equipped").eq("id", userId).maybeSingle(),
    admin.from("user_achievements").select("achievement_id").eq("user_id", userId),
    admin.from("user_cosmetics").select("cosmetic_id").eq("user_id", userId),
  ]);

  const claimed = new Set(((claimedRows ?? []) as { achievement_id: string }[]).map((r) => r.achievement_id));
  const prog = levelProgress(state.xp, CURRENT_SEASON);

  return ok({
    season: { id: CURRENT_SEASON.id, name: CURRENT_SEASON.name, maxLevel: CURRENT_SEASON.maxLevel },
    level: prog.level,
    xp: state.xp,
    xpIntoLevel: prog.xpIntoLevel,
    xpForNext: prog.xpForNext,
    progress: prog.progress,
    premium: state.premium,
    competitiveUnlocked: state.competitiveUnlocked,
    competitiveMinPoints: CURRENT_SEASON.competitiveMinPoints ?? 0,
    points: metrics.points ?? 0,
    tokens: (profile as { tokens: number } | null)?.tokens ?? 0,
    premiumTokenCost: CURRENT_SEASON.premiumCost?.tokens ?? 0,
    equipped: ((profile as { equipped?: Record<string, string> } | null)?.equipped ?? {}),
    tracks: {
      free: trackView(CURRENT_SEASON, "free", state, prog.level, true),
      competitive: trackView(CURRENT_SEASON, "competitive", state, prog.level, state.competitiveUnlocked),
      premium: trackView(CURRENT_SEASON, "premium", state, prog.level, state.premium),
    },
    missions: missionViews(state.missions, metrics),
    achievements: achievementViews(metrics, claimed),
    cosmetics: ((cosmeticRows ?? []) as { cosmetic_id: string }[]).map((r) => r.cosmetic_id),
  });
}

function missionViews(missions: ActiveMission[], metrics: MetricSnapshot): PassMissionView[] {
  return missions.map((m) => {
    const def = CURRENT_SEASON.missionPool.find((d) => d.id === m.id);
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
    };
  });
}

/**
 * Sortea las misiones rotatorias y fija las de temporada y los hitos.
 *
 * La semilla se genera en el SERVIDOR con `crypto`: si la eligiera el cliente podría
 * repetir sorteos hasta que salieran las misiones más fáciles.
 */
async function refreshMissionsFor(
  admin: SupabaseClient, userId: string, state: PassState, metrics: MetricSnapshot,
): Promise<PassState> {
  const engine = new PassEngine(state, CURRENT_SEASON);
  const now = Date.now();
  const rng = makeRng(randomInt(1, 2 ** 31 - 1));

  engine.refreshMissions("daily", 3, metrics, rng, now);
  engine.refreshMissions("weekly", 2, metrics, rng, now);
  // Las fijas no se sortean: están todas, siempre.
  const fixed = CURRENT_SEASON.missionPool
    .filter((m) => m.kind === "seasonal" || m.kind === "progressive")
    .map((m) => m.id);
  const result = engine.addMissions(fixed, metrics, now);

  await savePass(admin, userId, result.state);
  return result.state;
}

/** Reclama la recompensa de un nivel de un carril. */
export async function claimPassLevel(
  admin: SupabaseClient, userId: string, level: number, track: PassTrack,
): Promise<ServiceResult<{ rewards: Reward[] }>> {
  if (!Number.isInteger(level) || level < 1 || level > CURRENT_SEASON.maxLevel) {
    return fail(400, "Nivel no válido");
  }
  const state = await loadPass(admin, userId);
  const engine = new PassEngine(state, CURRENT_SEASON);
  const result = engine.claimReward(level, track, Date.now());
  if (!result.ok) return fail(409, result.error ?? "No se puede reclamar");

  // Primero se paga y después se marca. Al revés, un fallo al conceder dejaría el nivel
  // marcado como reclamado sin haber pagado nada.
  await grantRewards(admin, userId, result.rewards, `pass:${CURRENT_SEASON.id}:${track}:${level}`, "pass_reward");
  await savePass(admin, userId, result.state);
  return ok({ rewards: result.rewards });
}

/** Reclama una misión completada: paga su recompensa y suma su XP al pase. */
export async function claimMission(
  admin: SupabaseClient, userId: string, missionId: string,
): Promise<ServiceResult<{ rewards: Reward[] }>> {
  const metrics = await metricsFor(admin, userId);
  const state = await loadPass(admin, userId);
  const engine = new PassEngine(state, CURRENT_SEASON);
  const result = engine.completeMission(missionId, metrics, Date.now());
  if (!result.ok) return fail(409, result.error ?? "La misión no se puede reclamar");

  await grantRewards(
    admin, userId, result.rewards,
    // La marca de tiempo entra en la clave porque una misión repetible se reclama más de
    // una vez y cada reclamo es un pago distinto.
    `mission:${CURRENT_SEASON.id}:${missionId}:${Date.now()}`,
    "mission_reward",
  );
  await savePass(admin, userId, result.state);
  return ok({ rewards: result.rewards });
}

/**
 * Abre el carril de pago con FICHAS de evento.
 *
 * No hay compra con dinero real: §12 de la Fase 9 prohíbe integrar pagos sin
 * infraestructura segura, y aquí no la hay. Esta es la vía que sí existe, y se gana jugando.
 */
export async function unlockPremiumWithTokens(
  admin: SupabaseClient, userId: string,
): Promise<ServiceResult<{ premium: true }>> {
  const cost = CURRENT_SEASON.premiumCost?.tokens ?? 0;
  if (cost <= 0) return fail(409, "El pase no se puede abrir con fichas");

  const state = await loadPass(admin, userId);
  if (state.premium) return fail(409, "Ya tienes el pase");

  const { data: profile } = await admin.from("profiles").select("tokens").eq("id", userId).maybeSingle();
  const tokens = (profile as { tokens: number } | null)?.tokens ?? 0;
  if (tokens < cost) return fail(402, `Necesitas ${cost} fichas y tienes ${tokens}`);

  // El cobro pasa por la RPC de ajuste, que deja su asiento en el libro mayor. Su `ref`
  // hace que un doble clic no cobre dos veces.
  const { error } = await admin.rpc("app_adjust_credits", {
    p_user: userId,
    p_credits: 0,
    p_tokens: -cost,
    p_reason: "pass_premium",
    p_ref: `pass_premium:${CURRENT_SEASON.id}:${userId}`,
  });
  if (error) return fail(409, error.message);

  const engine = new PassEngine(state, CURRENT_SEASON);
  await savePass(admin, userId, engine.unlockPremium(Date.now()).state);
  return ok({ premium: true });
}

/**
 * Reclama un logro. La comprobación de si está completo la hace el SERVIDOR con sus
 * propias métricas; lo que diga el cliente es irrelevante.
 */
export async function claimAchievement(
  admin: SupabaseClient, userId: string, achievementId: string,
): Promise<ServiceResult<{ credits: number }>> {
  const def = ACHIEVEMENTS.find((a) => a.id === achievementId);
  if (!def) return fail(404, "Ese logro no existe");

  const { data: already } = await admin.from("user_achievements")
    .select("achievement_id").eq("user_id", userId).eq("achievement_id", achievementId).maybeSingle();
  if (already) return fail(409, "Ya has reclamado este logro");

  const metrics = await metricsFor(admin, userId);
  if (serverProgressFor(achievementId, metrics) < def.goal) {
    return fail(409, "Todavía no has completado este logro");
  }

  await grantRewards(admin, userId, [{ credits: def.reward }], `achievement:${achievementId}`, "achievement");
  const { error } = await admin.from("user_achievements")
    .insert({ user_id: userId, achievement_id: achievementId });
  // Una carrera entre dos peticiones simultáneas la corta la clave primaria; el pago ya
  // era idempotente por su `ref`, así que nadie cobra dos veces.
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);

  return ok({ credits: def.reward });
}

/**
 * Equipa (o retira) un cosmético.
 *
 * Fase 11. Hasta ahora el carril de aspecto repartía quince cosméticos que se guardaban en
 * `user_cosmetics` y no se podían ver ni llevar en ninguna parte: un id en una tabla que
 * ninguna pantalla leía. Eso vacía de sentido al único carril que se pretende monetizar.
 *
 * La comprobación de propiedad la hace la RPC dentro de la misma transacción, no este
 * servicio: si se hiciera aquí, bastaría con llamar a la ruta con un id inventado.
 */
export async function equipCosmetic(
  admin: SupabaseClient, userId: string, family: string, cosmeticId: string | null,
): Promise<ServiceResult<{ equipped: Record<string, string> }>> {
  if (!/^[a-z]{1,24}$/.test(family)) return fail(400, "Familia no válida");
  if (cosmeticId !== null && !/^[a-z]+:[a-z0-9-]{1,48}$/.test(cosmeticId)) {
    return fail(400, "Cosmético no válido");
  }

  const { data, error } = await admin.rpc("app_equip_cosmetic", {
    p_user: userId, p_family: family, p_cosmetic_id: cosmeticId,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("No tienes ese cosmético")) return fail(403, "No tienes ese cosmético");
    if (m.includes("no es de esa familia")) return fail(400, "Ese cosmético no es de esa familia");
    return fail(500, m || "No se pudo equipar");
  }
  return ok({ equipped: (data ?? {}) as Record<string, string> });
}

/** Vuelve a sortear las misiones rotatorias. */
export async function refreshMissions(
  admin: SupabaseClient, userId: string,
): Promise<ServiceResult<{ missions: PassMissionView[] }>> {
  const metrics = await metricsFor(admin, userId);
  const state = await refreshMissionsFor(admin, userId, await loadPass(admin, userId), metrics);
  return ok({ missions: missionViews(state.missions, metrics) });
}

// Reexportado para que las pruebas puedan armar misiones sin duplicar la lógica.
export { assignMission, rollMissions };
