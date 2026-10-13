/**
 * F58 · LECTURAS DEL CONTROL CENTER — dashboard, sistema/salud, búsqueda global, competitivo, temporadas, recompensas,
 * jugadores y equipos. SOLO LECTURA: ninguna función de este fichero escribe.
 *
 * Regla de la fase: NADA INVENTADO. Cada cifra sale de una consulta o de una constante real del repositorio; lo que no
 * se puede medir se devuelve como `null` y el panel enseña un estado vacío.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type AdminResult } from "./http";
import { listAudit, type AuditRow } from "./audit";
import { drawSourceOf, economyHealth, packRows, packsMissingEligibilityPool, worstLevel, type HealthCheck, type HealthLevel, type PackBinding } from "@/domain/admin/packAdmin";
import { loadSeasonCalendar } from "@/server/services/season";
import { CURRENT_SEASON } from "@/data/season";
import { resolveCalendar, validateCalendar } from "@/domain/season/calendar";
import { PACKS } from "@/data/packs";
import { CARDS } from "@/data/catalog";
import { TEAM_IDENTITIES, canonicalTeam } from "@/data/teamIdentities";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { PAYMENTS_ENABLED } from "@/config/monetization";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { progressionHealth } from "@/domain/progression/health";
import { getPack } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { CHALLENGE_SETS } from "@/domain/events/challenges";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { marketValue } from "@/domain/economy/pricing";
import { packCardClass } from "@/domain/packs/packClass";
import { agentCatalogHealth, type AgentRow } from "@/domain/admin/agentCatalog";
import { AGENTS as ESPORTS_AGENTS } from "@/data/esports/agents";
import { canonicalState } from "@/domain/admin/events";
import { contentHealth, type ContentSummary } from "@/server/cms/health";
import { DESIGNED_EDITIONS, getVariant } from "@/domain/cards/variants";
import type { VariantId } from "@/domain/cards/types";
import { multiplayerHealth, type LiveMatchRow, type QueueRow } from "@/domain/cardgame/pvp/health";

export const APP_VERSION = "0.1.1";
// F67 · la cabeza esperada vive en `server/ops/release` (fuente única con /api/ready y production:check).
import { MIGRATION_HEAD } from "@/server/ops/release";
import { crafting0059Applied } from "@/server/ops/f73Probe";
// F84 · Ranked 2.0: temporada competitiva, fronteras versionadas y salud de la clasificación (solo lectura).
import { readActiveCompetitiveSeason } from "@/server/services/competitive";
import { deriveRank, rankLadder, rankConfig, validateRankConfig } from "@/domain/ranked/config";
export { MIGRATION_HEAD };

/* ────────────────────────── DASHBOARD ────────────────────────── */
export interface DashboardStats {
  users: number; admins: number; newUsers7d: number; seen24h: number; seen7d: number; creditsInCirculation: number;
  cardsOwned: number; packsOpened: number; unopenedPacks: number; activeSanctions: number; ratedPlayers: number;
  rankedResults: number; catalogCards: number; catalogPublished: number; eventDrafts: number;
}
export interface Alert { level: HealthLevel; title: string; detail: string; href: string }

export async function dashboard(sb: SupabaseClient, now = Date.now()): Promise<AdminResult<{
  stats: DashboardStats | null; season: ReturnType<typeof seasonsView>["current"]; activeEvents: number | null;
  upcomingEvents: { id: string; name: string; startsAt: string | null }[]; alerts: Alert[]; recent: AuditRow[];
  content: ContentSummary | null;
}>> {
  const [stats, events, recent, content] = await Promise.all([
    sb.rpc("app_admin_dashboard_stats"),
    sb.from("events").select("id, name, status, start_date, end_date").order("start_date", { ascending: false, nullsFirst: false }).limit(60),
    listAudit(sb, { pageSize: 12 }),
    // F60 · resumen de CONTENIDO desde datos reales (agentes, cartas, jugadores, sobres, assets, borradores, rotos).
    contentHealth(sb, TEAM_IDENTITIES.length).catch(() => null),
  ]);
  const evs = (events.data ?? []) as { id: string; name: string; status: string | null; start_date: string | null; end_date: string | null }[];
  const states = evs.map((e) => ({ e, s: canonicalState(e, now) }));
  const upcoming = states.filter((x) => x.s === "SCHEDULED" && x.e.start_date && Date.parse(x.e.start_date) - now < 7 * 86_400_000)
    .map((x) => ({ id: x.e.id, name: x.e.name, startsAt: x.e.start_date }));
  const s = stats.error ? null : (stats.data as DashboardStats);

  const alerts: Alert[] = [];
  for (const c of economyHealth().filter((c) => c.level !== "HEALTHY")) alerts.push({ level: c.level, title: c.label, detail: c.detail, href: "/admin/economy" });
  // F60 · las cartas creadas desde el panel no «desalinean» nada: se compara el catálogo DISEÑADO con su manifiesto.
  const seedCards = content ? content.summary.cards.total - content.summary.cards.cms : s?.catalogCards ?? null;
  if (seedCards !== null && seedCards !== CARDS.length) alerts.push({ level: "WARNING", title: "Catálogo desalineado", detail: `BD ${seedCards} cartas diseñadas · código ${CARDS.length}`, href: "/admin/cards" });
  if (content && content.summary.brokenReferences > 0) alerts.push({ level: "CRITICAL", title: "Referencias rotas", detail: `${content.summary.brokenReferences} en el contenido`, href: "/admin/system" });
  if (content && content.summary.drafts > 0) alerts.push({ level: "HEALTHY", title: "Borradores de contenido", detail: `${content.summary.drafts} sin publicar (agentes, cartas, sobres)`, href: "/admin/agents" });
  if (content && content.summary.missingArtwork > 0) alerts.push({ level: "WARNING", title: "Arte pendiente", detail: `${content.summary.missingArtwork} elementos sin arte`, href: "/admin/assets" });
  if (s && s.eventDrafts > 0) alerts.push({ level: "HEALTHY", title: "Borradores de evento", detail: `${s.eventDrafts} sin publicar`, href: "/admin/events" });
  for (const u of upcoming) alerts.push({ level: "HEALTHY", title: "Evento próximo", detail: `${u.name} · empieza ${u.startsAt?.slice(0, 10)}`, href: `/admin/events/${encodeURIComponent(u.id)}` });
  if (GLOBAL_MARKET_ENABLED) alerts.push({ level: "CRITICAL", title: "Mercado ACTIVADO", detail: "GLOBAL_MARKET_ENABLED=true: revisa el cerrojo de marketReadiness", href: "/admin/system" });
  if (PAYMENTS_ENABLED) alerts.push({ level: "WARNING", title: "Pagos ACTIVADOS", detail: "PAYMENTS_ENABLED=true", href: "/admin/system" });
  if (stats.error) alerts.push({ level: "CRITICAL", title: "KPIs no disponibles", detail: "No se pudo leer app_admin_dashboard_stats (¿migración 0055 aplicada?)", href: "/admin/system" });

  return ok({
    stats: s, season: seasonsView(now).current,
    activeEvents: events.error ? null : states.filter((x) => x.s === "ACTIVE").length,
    upcomingEvents: upcoming, alerts, recent: recent.ok ? recent.data.rows : [], content: content?.summary ?? null,
  });
}

/* ────────────────────────── SISTEMA / SALUD ────────────────────────── */
export interface SystemView {
  version: string; environment: string; migrationHead: string; schema: Record<string, boolean> | null;
  flags: { key: string; value: string; critical: boolean; note: string }[];
  checks: HealthCheck[]; overall: HealthLevel; catalog: { code: number; db: number | null; published: number | null };
  content: ContentSummary | null;
}

async function timed<T>(fn: () => PromiseLike<T>): Promise<{ ms: number; value: T | null; error: string | null }> {
  const t = Date.now();
  try { const value = await fn(); return { ms: Date.now() - t, value, error: null }; } catch (e) { return { ms: Date.now() - t, value: null, error: e instanceof Error ? e.message : "error" }; }
}

export async function systemView(sb: SupabaseClient): Promise<AdminResult<SystemView>> {
  const checks: HealthCheck[] = [];
  const db = await timed(() => sb.from("profiles").select("id", { count: "exact", head: true }));
  const dbOk = !db.error && !(db.value as { error?: unknown } | null)?.error;
  checks.push({ id: "database", label: "Base de datos", level: dbOk ? "HEALTHY" : "CRITICAL", detail: dbOk ? `Responde (${db.ms} ms)` : "Sin respuesta de PostgREST" });

  const probe = await timed(() => sb.rpc("app_admin_schema_probe"));
  const probed = (probe.value as { data?: Record<string, boolean> } | null)?.data ?? null;
  // F59.1 · la sonda de 0055 no conoce 0056: se mira el ESTADO REAL de public.agents (Miks/Veto y los 29 canónicos).
  const ag = await timed(() => sb.from("agents").select("id, name, role"));
  const agRows = ag.error || (ag.value as { error?: unknown } | null)?.error ? null : (((ag.value as { data?: AgentRow[] } | null)?.data) ?? null);
  const agents = agentCatalogHealth(agRows, ESPORTS_AGENTS);
  // F60 · 0057: la sonda v2 ya trae sus claves (estado real). Con la sonda de 0055 (0057 sin aplicar) se marca ausente.
  // F73 · 0059 por estado real (sus tablas), igual que 0056: la constante del código no basta.
  const f73 = await crafting0059Applied(sb).catch(() => null);
  const schema = probed ? { ...probed, "0056_agents_miks_veto": agents.applied0056, ...(probed["0057_content_packs"] === undefined ? { "0057_admin_cms": false } : {}), "0059_crafting_missions": f73 === true } : null;
  const missing = schema ? Object.entries(schema).filter(([, v]) => !v).map(([k]) => k) : [];
  checks.push({ id: "schema", label: "Migraciones", level: !schema ? "WARNING" : missing.length ? "CRITICAL" : "HEALTHY", detail: !schema ? "No se pudo sondear el esquema" : missing.length ? `Faltan: ${missing.join(", ")}` : `Cabeza ${MIGRATION_HEAD}` });

  // F60 · la BD es la fuente de los agentes: sin 0056 aplicada es CRITICAL; una diferencia con la instantánea del
  // código (p. ej. un agente publicado desde el panel antes de regenerarla) es sólo un aviso.
  checks.push({ id: "esports-agents", label: "Agentes de esports", level: !agents.applied0056 || agents.level !== "CRITICAL" ? agents.level : "WARNING", detail: agents.detail });

  const cat = await timed(() => sb.from("content_cards").select("card_id", { count: "exact", head: true }).neq("origin", "admin"));
  const pub = await timed(() => sb.from("content_cards").select("card_id", { count: "exact", head: true }).eq("lifecycle", "PUBLISHED").neq("origin", "admin"));
  const dbCards = (cat.value as { count?: number | null } | null)?.count ?? null;
  const published = (pub.value as { count?: number | null } | null)?.count ?? null;
  checks.push({ id: "catalog", label: "Catálogo", level: dbCards == null ? "WARNING" : dbCards === CARDS.length ? "HEALTHY" : "WARNING", detail: dbCards == null ? "No se pudo contar content_cards" : `${dbCards} en BD (${published ?? "?"} publicadas) · ${CARDS.length} en código` });

  // F58.1 · cada sobre público necesita su pool de ELEGIBILIDAD `pack-<id>` (también la línea principal: la tabla por
  // clase decide la probabilidad, el pool qué cartas entran). Se mide con la misma regla que la ficha del sobre.
  const pools = await timed(() => sb.from("content_pack_pools").select("pack_id, pool_id, priority, enabled"));
  const bindings = (((pools.value as { data?: PackBinding[] } | null)?.data) ?? []);
  const noPool = packsMissingEligibilityPool(PACKS, bindings);
  const byClass = PACKS.filter((p) => drawSourceOf(p, bindings).mode === "class-distribution").length;
  checks.push({ id: "packs", label: "Sobres y pools", level: pools.error ? "WARNING" : noPool.length ? "WARNING" : "HEALTHY",
    detail: pools.error ? "No se pudieron leer los pools" : noPool.length ? `Sin pool de elegibilidad pack-<id>: ${noPool.join(", ")}` : `Todos los sobres públicos con su pool de elegibilidad (${byClass} por clase F57.3 · ${PACKS.length - byClass} por rareza)` });

  const eco = economyHealth();
  checks.push({ id: "economy", label: "Economía", level: worstLevel(eco), detail: eco.filter((c) => c.level !== "HEALTHY").map((c) => c.label).join(" · ") || "Todos los chequeos en verde" });

  const comp = await timed(() => sb.from("duel_pvp_ratings").select("user_id", { count: "exact", head: true }));
  checks.push({ id: "competitive", label: "Competitivo", level: (comp.value as { error?: unknown } | null)?.error || comp.error ? "WARNING" : "HEALTHY", detail: comp.error ? "No se pudo leer duel_pvp_ratings" : `${(comp.value as { count?: number } | null)?.count ?? 0} jugadores con rating` });

  // F66 · MULTIJUGADOR: partidas colgadas, doble asignación, autopartida y cola huérfana. Lecturas acotadas (500 filas),
  // solo columnas técnicas; nada se corrige desde aquí (el barrido oportunista de enqueue/sondeo sigue siendo quien cierra).
  const liveQ = await timed(() => sb.from("duel_matches").select("id, user_id, player_b_id, turn_deadline_at, updated_at")
    .in("mode", ["PVP", "PVP_PRIVATE"]).eq("status", "IN_PROGRESS").is("closed_reason", null).limit(500));
  const queueQ = await timed(() => sb.from("duel_pvp_queue").select("id, user_id, state, match_id, pairing_expires_at")
    .in("state", ["QUEUED", "PAIRING", "MATCHED"]).order("updated_at", { ascending: false }).limit(500));
  const liveRows = (liveQ.value as { data?: LiveMatchRow[]; error?: unknown } | null);
  const queueRows = (queueQ.value as { data?: QueueRow[]; error?: unknown } | null);
  if (liveQ.error || queueQ.error || liveRows?.error || queueRows?.error) {
    checks.push({ id: "multiplayer", label: "Multijugador", level: "WARNING", detail: "No se pudo leer partidas o cola PvP" });
  } else {
    const wanted = [...new Set((queueRows?.data ?? []).filter((q) => q.state === "MATCHED" && q.match_id).map((q) => q.match_id as string))].slice(0, 500);
    const found = wanted.length ? await timed(() => sb.from("duel_matches").select("id").in("id", wanted)) : null;
    const existing = new Set((((found?.value as { data?: { id: string }[] } | null)?.data) ?? []).map((r) => r.id));
    const mh = multiplayerHealth(liveRows?.data ?? [], queueRows?.data ?? [], existing, Date.now());
    checks.push({ id: "multiplayer", label: "Multijugador", level: mh.level, detail: mh.detail });
  }

  const auth = await timed(() => sb.auth.admin.listUsers({ page: 1, perPage: 1 }));
  const authOk = !auth.error && !(auth.value as { error?: unknown } | null)?.error;
  checks.push({ id: "auth", label: "Auth (GoTrue)", level: authOk ? "HEALTHY" : "CRITICAL", detail: authOk ? `Responde (${auth.ms} ms)` : "GoTrue no responde" });

  const storage = await timed(() => sb.storage.listBuckets());
  const buckets = (storage.value as { data?: { id: string }[] | null; error?: unknown } | null);
  checks.push({ id: "storage", label: "Storage", level: storage.error || buckets?.error ? "WARNING" : "HEALTHY", detail: storage.error || buckets?.error ? "No se pudo listar buckets" : `${buckets?.data?.length ?? 0} buckets` });

  const cal = validateCalendar(loadSeasonCalendar());
  checks.push({ id: "seasons", label: "Calendario de temporadas", level: cal.length ? "CRITICAL" : "HEALTHY", detail: cal.length ? cal.map((i) => `${i.code} ${i.seasonId}`).join(", ") : `${loadSeasonCalendar().length} temporada(s) sin conflictos` });

  // F62 · SALUD DE LA PROGRESIÓN: temporada activa enlazada al pase, recompensas entregables (carril, misiones, logros),
  // métricas que el servidor sabe medir. Contenido en código: sin lecturas extra. Los pagos únicos los garantiza el libro mayor.
  const calRes = resolveCalendar(loadSeasonCalendar(), Date.now());
  const prog = progressionHealth({
    season: CURRENT_SEASON as unknown as Parameters<typeof progressionHealth>[0]["season"],
    calendarSeasonIds: loadSeasonCalendar().map((e) => e.passSeasonId),
    activeCalendarSeasonId: calRes.ok ? calRes.current?.passSeasonId ?? null : null,
    achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, goal: a.goal, reward: a.reward })),
    packExists: (id) => Boolean(getPack(id)),
    cardExists: (id) => Boolean(getCard(id)),
  });
  checks.push({ id: "progression", label: "Progresión y recompensas", level: prog.level, detail: prog.summary });

  // F60 · SALUD DEL CONTENIDO (estado real): agentes, cartas, sobres, assets y referencias rotas.
  const content = await contentHealth(sb, TEAM_IDENTITIES.length).catch(() => null);
  if (content) checks.push(...content.checks);
  else checks.push({ id: "content", label: "Contenido", level: "WARNING", detail: "No se pudo medir la salud del contenido" });

  const env = (k: string) => (process.env[k] ?? "").trim();
  const flags = [
    { key: "GLOBAL_MARKET_ENABLED", value: String(GLOBAL_MARKET_ENABLED), critical: true, note: "Mercado entre jugadores (código). Solo lectura aquí." },
    { key: "PAYMENTS_ENABLED", value: String(PAYMENTS_ENABLED), critical: true, note: "Pagos con dinero real (código). Solo lectura aquí." },
    { key: "NEXT_PUBLIC_ADMIN", value: env("NEXT_PUBLIC_ADMIN") === "1" ? "1" : "sin definir", critical: false, note: "Interruptor de despliegue del panel (no concede acceso)." },
    { key: "NEXUS_SANDBOX_CREDITS", value: env("NEXUS_SANDBOX_CREDITS") === "1" ? "1" : "sin definir", critical: true, note: "Tienda de créditos de prueba (F41: cerrada salvo =1)." },
    { key: "ESPORTS_AUTO_SYNC_ENABLED", value: env("ESPORTS_AUTO_SYNC_ENABLED") || "sin definir", critical: false, note: "Sincronización esports en este proceso (el worker vive en el VPS)." },
    { key: "SUPABASE_SERVICE_ROLE_KEY", value: env("SUPABASE_SERVICE_ROLE_KEY") ? "configurada" : "falta", critical: false, note: "Solo se informa si existe; el valor nunca sale del servidor." },
  ];
  return ok({
    version: APP_VERSION, environment: process.env.NODE_ENV ?? "unknown", migrationHead: MIGRATION_HEAD, schema, flags, checks, overall: worstLevel(checks),
    catalog: { code: CARDS.length, db: dbCards, published }, content: content?.summary ?? null,
  });
}

/* ────────────────────────── BÚSQUEDA GLOBAL ────────────────────────── */
export interface SearchHit { group: "Usuarios" | "Cartas" | "Jugadores" | "Equipos" | "Sobres" | "Eventos" | "Agentes" | "Assets" | "Temporadas"; id: string; label: string; sub: string; href: string }

export async function globalSearch(sb: SupabaseClient, raw: string): Promise<AdminResult<{ hits: SearchHit[] }>> {
  const q = (raw ?? "").trim();
  if (q.length < 2) return ok({ hits: [] });
  if (!/^[\p{L}\p{N}_.@+\- ]{2,80}$/u.test(q)) return fail(400, "Búsqueda inválida");
  const t = q.toLowerCase();
  const hits: SearchHit[] = [];
  const like = q.replace(/[%,()]/g, "");
  const [users, events, agents, cmsPacks, cmsCards, assetsHits] = await Promise.all([
    sb.rpc("app_admin_search_users", { p_q: q, p_limit: 6, p_offset: 0 }),
    sb.from("events").select("id, name, type").or(`name.ilike.%${like}%,id.ilike.%${like}%`).limit(6),
    // F60 · contenido gestionado desde el panel
    sb.from("agents").select("id, name, role, lifecycle").or(`name.ilike.%${like}%,id.ilike.%${like}%`).limit(6),
    sb.from("content_packs").select("id, name, lifecycle").or(`name.ilike.%${like}%,id.ilike.%${like}%`).limit(6),
    sb.from("content_cards").select("card_id, lifecycle").eq("origin", "admin").ilike("card_id", `%${like}%`).limit(6),
    sb.from("assets").select("id, name, kind").in("kind", ["agent_face", "agent_full", "card_artwork", "pack_art", "event_art", "map_art", "player_photo", "team_logo"]).ilike("name", `%${like}%`).limit(6),
  ]);
  for (const a of (agents.data ?? []) as { id: string; name: string; role: string; lifecycle: string }[]) hits.push({ group: "Agentes", id: a.id, label: a.name, sub: `${a.role} · ${a.lifecycle}`, href: `/admin/agents/${encodeURIComponent(a.id)}` });
  for (const p of (cmsPacks.data ?? []) as { id: string; name: string; lifecycle: string }[]) hits.push({ group: "Sobres", id: p.id, label: p.name, sub: `panel · ${p.lifecycle}`, href: `/admin/packs/${encodeURIComponent(p.id)}` });
  for (const c of (cmsCards.data ?? []) as { card_id: string; lifecycle: string }[]) hits.push({ group: "Cartas", id: c.card_id, label: c.card_id, sub: `panel · ${c.lifecycle}`, href: `/admin/cards/${encodeURIComponent(c.card_id)}` });
  for (const a of (assetsHits.data ?? []) as { id: string; name: string; kind: string }[]) hits.push({ group: "Assets", id: a.id, label: a.name, sub: a.kind, href: `/admin/assets?id=${a.id}` });
  for (const s of loadSeasonCalendar().filter((s) => s.id.toLowerCase().includes(t) || s.name.toLowerCase().includes(t)).slice(0, 3)) hits.push({ group: "Temporadas", id: s.id, label: s.name, sub: `${s.startsAt.slice(0, 10)} → ${s.endsAt.slice(0, 10)}`, href: "/admin/seasons" });
  for (const u of (users.data ?? []) as { id: string; username: string; email: string | null }[]) hits.push({ group: "Usuarios", id: u.id, label: u.username, sub: u.email ? u.email.replace(/^(.{2}).*(@.*)$/, "$1…$2") : u.id, href: `/admin/users/${u.id}` });
  for (const c of CARDS.filter((c) => c.id.toLowerCase().includes(t)).slice(0, 8)) hits.push({ group: "Cartas", id: c.id, label: c.id, sub: `${c.variantId} · OVR ${c.ovr}`, href: `/admin/cartas/${encodeURIComponent(c.id)}` });
  const players = new Map<string, { id: string; nick: string; team?: string }>();
  for (const c of CARDS) if (!players.has(c.playerId)) players.set(c.playerId, { id: c.playerId, nick: c.playerId });
  const { data: cps } = await sb.from("content_players").select("id, nick, team").or(`nick.ilike.%${q.replace(/[%,()]/g, "")}%,id.ilike.%${q.replace(/[%,()]/g, "")}%`).limit(8);
  for (const p of (cps ?? []) as { id: string; nick: string; team: string | null }[]) hits.push({ group: "Jugadores", id: p.id, label: p.nick, sub: p.team ?? "sin equipo", href: `/admin/players/${encodeURIComponent(p.id)}` });
  for (const ti of TEAM_IDENTITIES.filter((x) => x.displayName.toLowerCase().includes(t) || x.tag.toLowerCase() === t || x.canonicalId.includes(t)).slice(0, 6)) hits.push({ group: "Equipos", id: ti.canonicalId, label: ti.displayName, sub: `${ti.tag} · ${ti.region}`, href: `/admin/teams/${ti.canonicalId}` });
  for (const p of PACKS.filter((p) => !p.cms && (p.name.toLowerCase().includes(t) || p.id.includes(t))).slice(0, 6)) hits.push({ group: "Sobres", id: p.id, label: p.name, sub: `${p.price.toLocaleString("es-ES")} cr · ${p.cardCount} cartas`, href: `/admin/packs/${p.id}` });
  for (const e of (events.data ?? []) as { id: string; name: string; type: string | null }[]) hits.push({ group: "Eventos", id: e.id, label: e.name, sub: e.type ?? "evento", href: `/admin/events/${encodeURIComponent(e.id)}` });
  return ok({ hits });
}

/* ────────────────────────── COMPETITIVO ────────────────────────── */
/** F84 · bloque Ranked 2.0 del panel: configuración, fronteras, fórmula, distribución por rango y salud de la clasificación. */
export interface CompetitiveAdminF84 {
  season: { id: string; name: string; number: number; startsAt: number; endsAt: number | null; rankConfigVersion: string; formulaVersion: string; placementGames: number; top: { size: number; minSeasonMatches: number; activeDays: number }; pairCap: { matches: number; hours: number }; gameSeasonId: string | null } | null;
  thresholds: { label: string; floor: number; ceil: number | null; color: string }[];
  configIssues: string[];
  formula: { version: string; initial: number; kProvisional: number; kEstablished: number; provisionalGames: number; floor: number; ceiling: number };
  tiers: { tier: string; color: string; all: number; seasonRanked: number }[];
  health: { seasonPlayers: number; placementDone: number; eligible: number; seasonEvents: number; seasonMatchesSum: number; pairCapped: number; adjustments: number };
}

export async function competitiveView(sb: SupabaseClient): Promise<AdminResult<{
  players: number; rated: number; games: number; distribution: { from: number; to: number; count: number }[];
  top: { userId: string; username: string | null; rating: number; games: number; wins: number; losses: number; draws: number }[];
  recent: { at: string | null; matchId: string; userId: string; username: string | null; oldRating: number; newRating: number; delta: number; result: string }[];
  anomalies: { kind: string; detail: string }[];
  f84: CompetitiveAdminF84;
}>> {
  const [ratings, events] = await Promise.all([
    sb.from("duel_pvp_ratings").select("user_id, rating, games_played, wins, losses, draws, updated_at").order("rating", { ascending: false }).limit(2000),
    sb.from("duel_pvp_rating_events").select("match_id, user_id, old_rating, new_rating, delta, result, created_at").order("created_at", { ascending: false }).limit(25),
  ]);
  if (ratings.error) return fail(500, "No se pudo leer el competitivo");
  const rs = (ratings.data ?? []) as { user_id: string; rating: number; games_played: number; wins: number; losses: number; draws: number }[];
  const ev = (events.data ?? []) as { match_id: string; user_id: string; old_rating: number; new_rating: number; delta: number; result: string; created_at?: string }[];
  const ids = [...new Set([...rs.slice(0, 20).map((r) => r.user_id), ...ev.map((e) => e.user_id)])];
  const names = new Map<string, string>();
  if (ids.length) for (const p of ((await sb.from("profiles").select("id, username").in("id", ids)).data ?? []) as { id: string; username: string }[]) names.set(p.id, p.username);
  const rated = rs.filter((r) => r.games_played > 0);
  const buckets = new Map<number, number>();
  for (const r of rated) { const b = Math.floor(r.rating / 100) * 100; buckets.set(b, (buckets.get(b) ?? 0) + 1); }
  const anomalies: { kind: string; detail: string }[] = [];
  for (const r of rs) if (r.wins + r.losses + r.draws !== r.games_played) anomalies.push({ kind: "Contadores", detail: `${names.get(r.user_id) ?? r.user_id}: V+D+E (${r.wins + r.losses + r.draws}) ≠ partidas (${r.games_played})` });
  for (const e of ev) if (e.new_rating - e.old_rating !== e.delta) anomalies.push({ kind: "Delta", detail: `Partida ${e.match_id}: ${e.old_rating}→${e.new_rating} con delta ${e.delta}` });
  for (const e of ev) if (Math.abs(e.delta) > 64) anomalies.push({ kind: "Salto de rating", detail: `Partida ${e.match_id}: ${e.delta > 0 ? "+" : ""}${e.delta}` });

  // ── F84 · temporada competitiva, fronteras, distribución por rango y salud (recuentos acotados, sin datos privados) ──
  const cs = await readActiveCompetitiveSeason(sb).catch(() => null);
  const version = rankConfig(cs?.rankConfigVersion).version;
  const head = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0).catch(() => 0);
  const [csp, ladder, seasonEvents, pairCapped, adjustments] = cs ? await Promise.all([
    sb.from("competitive_season_players").select("user_id, matches, placement_completed_at, peak_ranked_rating").eq("season_id", cs.id).limit(5000),
    head(sb.from("competitive_ladder").select("user_id", { count: "exact", head: true }).eq("season_id", cs.id)),
    head(sb.from("duel_pvp_rating_events").select("match_id", { count: "exact", head: true }).eq("competitive_season_id", cs.id)),
    head(sb.from("duel_pvp_rating_events").select("match_id", { count: "exact", head: true }).eq("competitive_season_id", cs.id).eq("rule", "PAIR_CAP")),
    head(sb.from("competitive_rating_adjustments").select("id", { count: "exact", head: true })),
  ]) : [{ data: [] }, 0, 0, 0, 0] as const;
  const seasonRows = ((csp as { data?: unknown }).data ?? []) as { user_id: string; matches: number; placement_completed_at: string | null }[];
  const seasonRankedIds = new Set(seasonRows.filter((r) => r.placement_completed_at).map((r) => r.user_id));
  const tierCount = new Map<string, { all: number; seasonRanked: number }>();
  for (const r of rated) {
    const t = deriveRank(r.rating, version).tierName;
    const c = tierCount.get(t) ?? { all: 0, seasonRanked: 0 };
    c.all++; if (seasonRankedIds.has(r.user_id)) c.seasonRanked++;
    tierCount.set(t, c);
  }
  const seasonMatchesSum = seasonRows.reduce((a, r) => a + r.matches, 0);
  if (cs && seasonMatchesSum !== seasonEvents) anomalies.push({ kind: "Récord de temporada", detail: `Σ partidas de temporada (${seasonMatchesSum}) ≠ asientos con temporada (${seasonEvents})` });
  const cfg = rankConfig(version);
  const f84: CompetitiveAdminF84 = {
    season: cs ? { id: cs.id, name: cs.name, number: cs.number, startsAt: cs.startsAt, endsAt: cs.endsAt, rankConfigVersion: cs.rankConfigVersion, formulaVersion: cs.formulaVersion, placementGames: cs.placementGames, top: cs.top, pairCap: cs.pairCap, gameSeasonId: cs.gameSeasonId } : null,
    thresholds: rankLadder(version).map((s) => ({ label: s.label, floor: s.floor, ceil: s.ceil, color: s.color })),
    configIssues: validateRankConfig(cfg),
    formula: { version: cs?.formulaVersion ?? "ranked-rating-v1", initial: 1000, kProvisional: 40, kEstablished: 24, provisionalGames: 10, floor: 0, ceiling: 5000 },
    tiers: cfg.tiers.map((t) => ({ tier: t.name, color: t.color, all: tierCount.get(t.name)?.all ?? 0, seasonRanked: tierCount.get(t.name)?.seasonRanked ?? 0 })),
    health: { seasonPlayers: seasonRows.length, placementDone: seasonRankedIds.size, eligible: ladder as number, seasonEvents: seasonEvents as number, seasonMatchesSum, pairCapped: pairCapped as number, adjustments: adjustments as number },
  };
  return ok({
    f84,
    players: rs.length, rated: rated.length, games: rated.reduce((a, r) => a + r.games_played, 0) / 2,
    distribution: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([from, count]) => ({ from, to: from + 99, count })),
    top: rs.slice(0, 20).map((r) => ({ userId: r.user_id, username: names.get(r.user_id) ?? null, rating: r.rating, games: r.games_played, wins: r.wins, losses: r.losses, draws: r.draws })),
    recent: ev.map((e) => ({ at: e.created_at ?? null, matchId: e.match_id, userId: e.user_id, username: names.get(e.user_id) ?? null, oldRating: e.old_rating, newRating: e.new_rating, delta: e.delta, result: e.result })),
    anomalies,
  });
}

/* ────────────────────────── TEMPORADAS ────────────────────────── */
export function seasonsView(now = Date.now()) {
  const r = resolveCalendar(loadSeasonCalendar(), now);
  const seasons = r.ok ? r.seasons : [];
  const withProgress = seasons.map((s) => ({
    id: s.id, name: s.displayName ?? s.name, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, presentation: s.presentation,
    progress: s.durationMs > 0 ? s.elapsedMs / s.durationMs : 0,
    daysLeft: Math.ceil(s.remainingMs / 86_400_000),
  }));
  return {
    phase: r.ok ? r.phase : "INVALID", seasons: withProgress, current: withProgress.find((s) => s.status === "ACTIVE") ?? null,
    issues: validateCalendar(loadSeasonCalendar()), pass: { id: CURRENT_SEASON.id, name: CURRENT_SEASON.name },
    closeProcess: "No existe proceso de cierre: la temporada termina por calendario (el calendario de temporadas del código). El panel no ofrece un botón que no hace nada.",
  };
}

export async function seasonsDetail(sb: SupabaseClient, now = Date.now()) {
  const view = seasonsView(now);
  const { count } = await sb.from("user_pass").select("user_id", { count: "exact", head: true }).eq("season_id", CURRENT_SEASON.id);
  return ok({ ...view, passHolders: count ?? null });
}

/* ────────────────────────── RECOMPENSAS (solo lectura, fuentes reales) ────────────────────────── */
export async function rewardsView(sb: SupabaseClient) {
  const { data } = await sb.rpc("app_admin_ledger_summary", { p_days: 30 });
  return ok({
    pass: { free: Object.keys(CURRENT_SEASON.free ?? {}).length, competitive: Object.keys(CURRENT_SEASON.competitive ?? {}).length, premium: Object.keys((CURRENT_SEASON as { premium?: object }).premium ?? {}).length },
    achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, label: a.name, goal: a.goal, reward: a.reward })),
    eventSets: CHALLENGE_SETS.map((s) => ({ id: s.id, label: s.label, challenges: s.challenges.map((c) => ({ id: c.id, label: c.label, goal: c.goal, reward: c.reward })) })),
    pickemTiers: REWARD_TIERS.map((t) => ({ ...t })),
    ledger30d: (data ?? []) as { bucket: string; entries: number; credits_in: number; credits_out: number }[],
  });
}

/* ────────────────────────── JUGADORES / EQUIPOS ────────────────────────── */
export interface PlayerRow { id: string; nick: string; fullName: string | null; team: string | null; teamTag: string | null; region: string | null; role: string | null; status: string | null; cards: number; image: string | null }

export async function listPlayers(sb: SupabaseClient, f: { q?: string; team?: string; region?: string; page?: number; pageSize?: number }): Promise<AdminResult<{ rows: PlayerRow[]; total: number; page: number; pageSize: number }>> {
  const page = Math.max(1, Math.trunc(f.page ?? 1)), pageSize = Math.min(Math.max(Math.trunc(f.pageSize ?? 50), 1), 100);
  let q = sb.from("content_players").select("id, nick, full_name, team, team_tag, region, role, status, image", { count: "exact" });
  const clean = (s?: string) => (s ?? "").replace(/[%,()]/g, "").trim().slice(0, 60);
  if (f.q) q = q.or(`nick.ilike.%${clean(f.q)}%,id.ilike.%${clean(f.q)}%,full_name.ilike.%${clean(f.q)}%`);
  if (f.team) q = q.eq("team", clean(f.team));
  if (f.region) q = q.eq("region", clean(f.region));
  const { data, error, count } = await q.order("nick").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return fail(500, "No se pudieron leer los jugadores");
  const rows = (data ?? []) as { id: string; nick: string; full_name: string | null; team: string | null; team_tag: string | null; region: string | null; role: string | null; status: string | null; image: string | null }[];
  const counts = new Map<string, number>();
  if (rows.length) for (const c of ((await sb.from("content_cards").select("player_id").in("player_id", rows.map((r) => r.id))).data ?? []) as { player_id: string }[]) counts.set(c.player_id, (counts.get(c.player_id) ?? 0) + 1);
  return ok({ rows: rows.map((r) => ({ id: r.id, nick: r.nick, fullName: r.full_name, team: r.team, teamTag: r.team_tag, region: r.region, role: r.role, status: r.status, cards: counts.get(r.id) ?? 0, image: r.image })), total: count ?? rows.length, page, pageSize });
}

export async function playerDetail(sb: SupabaseClient, id: string) {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(id)) return fail(400, "Jugador inválido");
  const { data } = await sb.from("content_players").select("id, nick, full_name, team, team_tag, region, role, country, status, image, stats, accolades, origin, created_at, updated_at").eq("id", id).maybeSingle();
  if (!data) return fail(404, "Jugador no encontrado");
  const { data: cards } = await sb.from("content_cards").select("card_id, variant_id, ovr, lifecycle, rarity_bucket").eq("player_id", id).order("ovr", { ascending: false });
  const p = data as { team: string | null };
  const team = canonicalTeam(p.team);
  return ok({
    player: data,
    team: { key: team.key, label: team.label, canonicalId: team.identity?.canonicalId ?? null },
    cards: ((cards ?? []) as { card_id: string; variant_id: string; ovr: number; lifecycle: string; rarity_bucket: string }[]).map((c) => {
      const def = CARDS.find((x) => x.id === c.card_id);
      return { ...c, packClass: def ? packCardClass(def) : null, marketValue: def ? marketValue(def) : null, printedTeam: def?.team ?? null };
    }),
  });
}

export async function teamsView(sb: SupabaseClient) {
  const { data } = await sb.from("content_players").select("id, team, region").limit(2000);
  const players = (data ?? []) as { id: string; team: string | null; region: string | null }[];
  const cardsByPlayer = new Map<string, number>();
  for (const c of CARDS) cardsByPlayer.set(c.playerId, (cardsByPlayer.get(c.playerId) ?? 0) + 1);
  const rows = TEAM_IDENTITIES.map((ti) => {
    const aliases = new Set([...ti.currentAliases, ...ti.historicalAliases, ti.displayName]);
    const members = players.filter((p) => p.team && aliases.has(p.team));
    return {
      id: ti.canonicalId, name: ti.displayName, tag: ti.tag, region: ti.region, status: ti.status,
      players: members.length, cards: members.reduce((a, p) => a + (cardsByPlayer.get(p.id) ?? 0), 0),
      packs: PACKS.filter((p) => p.team && aliases.has(p.team) || p.team === ti.tag).map((p) => ({ id: p.id, name: p.name })),
    };
  });
  return ok({ rows: rows.sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name)) });
}

export async function teamDetail(sb: SupabaseClient, id: string) {
  const ti = TEAM_IDENTITIES.find((t) => t.canonicalId === id);
  if (!ti) return fail(404, "Equipo no encontrado");
  const aliases = [...new Set([...ti.currentAliases, ...ti.historicalAliases, ti.displayName])];
  const { data } = await sb.from("content_players").select("id, nick, team, role, region, image").in("team", aliases).order("nick");
  const players = (data ?? []) as { id: string; nick: string; team: string; role: string | null; region: string | null; image: string | null }[];
  const ids = new Set(players.map((p) => p.id));
  const cards = CARDS.filter((c) => ids.has(c.playerId)).map((c) => ({ id: c.id, playerId: c.playerId, variantId: c.variantId, ovr: c.ovr, printedTeam: c.team ?? null, packClass: packCardClass(c), marketValue: marketValue(c) }));
  return ok({
    team: { id: ti.canonicalId, name: ti.displayName, tag: ti.tag, region: ti.region, status: ti.status, unverifiedReason: ti.unverifiedReason ?? null, currentAliases: ti.currentAliases, historicalAliases: ti.historicalAliases },
    players: players.map((p) => ({ ...p, current: ti.currentAliases.includes(p.team) })),
    cards, packs: PACKS.filter((p) => (p.team && aliases.includes(p.team)) || p.team === ti.tag).map((p) => ({ id: p.id, name: p.name, price: p.price })),
    editable: false,
    note: "La identidad de los equipos vive en código (teamIdentities.ts) y el equipo IMPRESO de cada carta es histórico: cambiar el equipo actual de un jugador no reescribe ninguna carta. No hay escritura de equipos desde el panel.",
  });
}

export const packsList = () => ok({ rows: packRows() });

/* ────────────────────────── IMPORTACIÓN DE CARTAS: DRY RUN ──────────────────────────
 *
 * Solo valida (no escribe). Confirmar crea BORRADORES uno a uno con la acción existente `create` de
 * `/api/admin/cards` (`createCard` → `app_content_create_card`), que vuelve a validar todo en servidor.
 */
export interface ImportRow { playerId: string; variantId: string; reason: string }
export interface ImportVerdict { line: number; playerId: string; variantId: string; cardId: string; status: "valid" | "warning" | "error" | "duplicate"; messages: string[] }
export const IMPORT_MAX = 200;

export async function importDryRun(sb: SupabaseClient, raw: unknown): Promise<AdminResult<{ rows: ImportVerdict[]; summary: Record<ImportVerdict["status"], number> }>> {
  if (!Array.isArray(raw)) return fail(400, "Formato inválido: se espera una lista de filas");
  if (raw.length === 0) return fail(400, "El fichero no tiene filas");
  if (raw.length > IMPORT_MAX) return fail(400, `Máximo ${IMPORT_MAX} filas por importación`);
  const rows: ImportRow[] = raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { playerId: String(o.playerId ?? "").trim().slice(0, 80), variantId: String(o.variantId ?? "").trim().slice(0, 40), reason: String(o.reason ?? "").trim().slice(0, 300) };
  });
  const ids = [...new Set(rows.map((r) => r.playerId).filter((x) => /^[A-Za-z0-9_.-]{1,80}$/.test(x)))];
  const known = new Set<string>();
  if (ids.length) for (const p of ((await sb.from("content_players").select("id").in("id", ids)).data ?? []) as { id: string }[]) known.add(p.id);
  const cardIds = rows.map((r) => `${r.playerId}__${r.variantId}`);
  const existing = new Set<string>();
  const valid = cardIds.filter((c) => /^[A-Za-z0-9_.-]{1,130}$/.test(c));
  if (valid.length) for (const c of ((await sb.from("content_cards").select("card_id").in("card_id", valid)).data ?? []) as { card_id: string }[]) existing.add(c.card_id);
  const seen = new Set<string>();
  const out: ImportVerdict[] = rows.map((r, i) => {
    const cardId = `${r.playerId}__${r.variantId}`;
    const msgs: string[] = [];
    let status: ImportVerdict["status"] = "valid";
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(r.playerId)) { status = "error"; msgs.push("playerId inválido"); }
    else if (!known.has(r.playerId)) { status = "error"; msgs.push("El jugador no existe en content_players"); }
    let variantOk = true;
    try { getVariant(r.variantId as VariantId); } catch { variantOk = false; }
    if (!variantOk) { status = "error"; msgs.push("Edición desconocida"); }
    else if (!DESIGNED_EDITIONS.has(r.variantId as VariantId) && status === "valid") { status = "warning"; msgs.push("Edición fuera del catálogo diseñado (base, masters-l/sdc, future-star, champions-s, record-breaker, moments)"); }
    if (r.reason.length < 8) { if (status !== "error") status = "error"; msgs.push("Motivo obligatorio (mín. 8 caracteres)"); }
    if (existing.has(cardId)) { status = "duplicate"; msgs.push("La carta ya existe en el catálogo"); }
    else if (seen.has(cardId)) { status = "duplicate"; msgs.push("Repetida dentro del fichero"); }
    seen.add(cardId);
    return { line: i + 1, playerId: r.playerId, variantId: r.variantId, cardId, status, messages: msgs };
  });
  const summary = { valid: 0, warning: 0, error: 0, duplicate: 0 } as Record<ImportVerdict["status"], number>;
  for (const r of out) summary[r.status]++;
  return ok({ rows: out, summary });
}
