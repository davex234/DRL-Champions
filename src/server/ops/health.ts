/**
 * F67 · SALUD PÚBLICA: liveness y readiness.
 *
 *   · liveness  (`/api/health`) — el proceso Node responde. Sin dependencias: si esto falla, hay que reiniciar el proceso.
 *   · readiness (`/api/ready`)  — las dependencias CRÍTICAS están listas: configuración, base de datos, esquema esperado
 *                                 y catálogo. Si falla, no hay que mandar tráfico (503), pero reiniciar no lo arregla.
 *
 * Es la vista MÍNIMA y pública. El detalle (flags, economía, progresión, contenido, multijugador) sigue en
 * `/admin/system`, que solo ve un admin: no hay dos sistemas que se contradigan, hay dos niveles de detalle sobre las
 * mismas sondas (`app_admin_schema_probe`, recuento de `content_cards`).
 *
 * Barato por construcción: el resultado se guarda `CACHE_MS` y dos peticiones simultáneas comparten la misma sonda.
 * No devuelve valores de configuración, hosts ni mensajes de error: solo ids de chequeo, ok y milisegundos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateEnv } from "./env";
import { EXPECTED_SCHEMA_KEYS, HEAD_BEFORE_0061, HEAD_BEFORE_0062, HEAD_BEFORE_0063, HEAD_BEFORE_0064, HEAD_BEFORE_0065, HEAD_BEFORE_0066, HEAD_BEFORE_0067, HEAD_BEFORE_0068, HEAD_BEFORE_0069, HEAD_BEFORE_0070, HEAD_BEFORE_0071, HEAD_BEFORE_0072, HEAD_BEFORE_0073, MIGRATION_HEAD, PREVIOUS_HEAD } from "./release";
import { accountTag0068Applied, alpha0070Applied, pickems0071Applied, cutover0072Applied, guard0073Applied, admin0067Applied, cups0069Applied, collections0062Applied, crafting0059Applied, favoriteTeam0063Applied, forge0061Applied, ranked0065Applied, seasonTrack0064Applied, social0066Applied } from "./f73Probe";
import { serverSupabaseOrigin } from "@/lib/supabase/serverUrl";

export interface Check { id: string; ok: boolean; critical: boolean; ms?: number; detail?: string }
export interface Readiness { status: "ready" | "degraded" | "not_ready"; checkedAt: string; migrationHead: string; checks: Check[] }

export const CACHE_MS = 15_000;
const TIMEOUT_MS = 3_000;
const started = Date.now();

export function liveness(version: string) {
  return { status: "ok" as const, uptimeS: Math.round((Date.now() - started) / 1000), version, node: process.version };
}

async function timed<T>(fn: () => PromiseLike<T>): Promise<{ ms: number; value: T | null; failed: boolean }> {
  const t = Date.now();
  try {
    const value = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))]);
    return { ms: Date.now() - t, value, failed: false };
  } catch { return { ms: Date.now() - t, value: null, failed: true }; }
}

/** Agrega los chequeos en un estado. Pura (se prueba sola). */
export function summarize(checks: Check[]): Readiness["status"] {
  if (checks.some((c) => c.critical && !c.ok)) return "not_ready";
  if (checks.some((c) => !c.ok)) return "degraded";
  return "ready";
}

export async function readiness(
  sb: SupabaseClient | null, codeCatalog: { cards: number }, env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Readiness> {
  const checks: Check[] = [];
  let head = MIGRATION_HEAD;
  const e = validateEnv(env);
  checks.push({ id: "config", ok: e.ok, critical: true, detail: e.ok ? undefined : "falta configuración crítica" });
  if (!sb) {
    checks.push({ id: "database", ok: false, critical: true, detail: "sin cliente de servidor" });
    return { status: summarize(checks), checkedAt: new Date().toISOString(), migrationHead: MIGRATION_HEAD, checks };
  }
  const db = await timed(() => sb.from("profiles").select("id", { count: "exact", head: true }));
  const dbOk = !db.failed && !(db.value as { error?: unknown } | null)?.error;
  checks.push({ id: "database", ok: dbOk, critical: true, ms: db.ms });

  const probe = await timed(() => sb.rpc("app_admin_schema_probe"));
  const keys = (probe.value as { data?: Record<string, boolean> } | null)?.data ?? null;
  const schemaOk = !!keys && EXPECTED_SCHEMA_KEYS.every((k) => keys[k] === true);
  /*
   * F73 · la cabeza se informa por ESTADO REAL: 0059 solo cuenta si sus tablas existen en esta BD. Sin ellas la app
   * sigue sirviendo (el crafteo y las misiones se declaran no disponibles) → «degraded», y la cabeza dice 0058.
   */
  const f73 = await timed(() => crafting0059Applied(sb));
  const f73ok = f73.value === true;
  // F79.1 · 0061 también por estado real: sin `forge_config` la cabeza es 0060 y el intercambio/desguace de F79.1 no
  // funcionarían (llaman a las RPC guardadas) → «degraded» y lo dice.
  const f79 = await timed(() => forge0061Applied(sb));
  const f79ok = f79.value === true;
  // F82 · 0062 por estado real: sin `collection_sets` la cabeza es 0061 y la Sala de Trofeos responde «no disponible».
  const f82 = await timed(() => collections0062Applied(sb));
  const f82ok = f82.value === true;
  // F89 · 0063 por estado real: sin `favorite_team_id` la cabeza es 0062 y el perfil no enseña equipo favorito.
  const f89 = await timed(() => favoriteTeam0063Applied(sb));
  const f89ok = f89.value === true;
  // F83 · 0064 por estado real: sin `game_seasons` la cabeza es 0063 y la ruta de temporada responde «sin temporada».
  const f83 = await timed(() => seasonTrack0064Applied(sb));
  const f83ok = f83.value === true;
  // F84 · 0065 por estado real: sin `competitive_seasons` la cabeza es 0064 y el competitivo no tiene temporada competitiva.
  const f84 = await timed(() => ranked0065Applied(sb));
  const f84ok = f84.value === true;
  // F85 · 0066 por estado real: sin `social_blocks` la cabeza es 0065 y lo social sigue con las reglas de 0048.
  const f85 = await timed(() => social0066Applied(sb));
  const f85ok = f85.value === true;
  // 0067 por estado real: sin `app_admin_set_admin` la cabeza es 0066 y no se gestionan admins desde el panel.
  const a67 = await timed(() => admin0067Applied(sb));
  const a67ok = a67.value === true;
  // 0068 por estado real: sin `profiles.public_tag` / `account_tag_registry` la cabeza es 0067 y no hay tag público.
  const t68 = await timed(() => accountTag0068Applied(sb));
  const t68ok = t68.value === true;
  // F86 · 0069 por estado real: sin `cups` la cabeza es 0068 y no hay torneos de jugadores.
  const c69 = await timed(() => cups0069Applied(sb));
  const c69ok = c69.value === true;
  // F86.2 · 0070 por estado real: sin `alpha_feedback` la cabeza es 0069 y /feedback responde «no disponible».
  const a70 = await timed(() => alpha0070Applied(sb));
  const a70ok = a70.value === true;
  // F87 · 0071 por estado real: sin `pickem_brackets` la cabeza es 0070 y no hay Pick'ems 2.0 (lista vacía en el hub).
  const p71 = await timed(() => pickems0071Applied(sb));
  const p71ok = p71.value === true;
  // F87.1 · 0072 por estado real: sin `legacy_mode` la cabeza es 0071 (sin corte de autoridad de recompensas).
  const c72 = await timed(() => cutover0072Applied(sb));
  const c72ok = c72.value === true;
  // F87.2 · 0073 por estado real: sin `app_pickem_reward_eligibility` la cabeza es 0072 (sin elegibilidad en la BD).
  const g73 = await timed(() => guard0073Applied(sb));
  const g73ok = g73.value === true;
  head = schemaOk ? (!f73ok ? PREVIOUS_HEAD : !f79ok ? HEAD_BEFORE_0061 : !f82ok ? HEAD_BEFORE_0062 : !f89ok ? HEAD_BEFORE_0063 : !f83ok ? HEAD_BEFORE_0064 : !f84ok ? HEAD_BEFORE_0065 : !f85ok ? HEAD_BEFORE_0066 : !a67ok ? HEAD_BEFORE_0067 : !t68ok ? HEAD_BEFORE_0068 : !c69ok ? HEAD_BEFORE_0069 : !a70ok ? HEAD_BEFORE_0070 : !p71ok ? HEAD_BEFORE_0071 : !c72ok ? HEAD_BEFORE_0072 : g73ok ? MIGRATION_HEAD : HEAD_BEFORE_0073) : "desconocida";
  checks.push({ id: "schema", ok: schemaOk, critical: true, ms: probe.ms, detail: schemaOk ? head : "esquema distinto del esperado" });
  checks.push({ id: "crafting", ok: f73ok, critical: false, ms: f73.ms, detail: f73ok ? "0059 aplicada (crafteo y misiones)" : f73.value === false ? "0059 no aplicada" : "sin lectura" });
  checks.push({ id: "forge", ok: f79ok, critical: false, ms: f79.ms, detail: f79ok ? "0061 aplicada (NEXUS FORGE 2.0 y carta protegida)" : f79.value === false ? "0061 no aplicada" : "sin lectura" });
  checks.push({ id: "collections", ok: f82ok, critical: false, ms: f82.ms, detail: f82ok ? "0062 aplicada (Collection Sets e insignias)" : f82.value === false ? "0062 no aplicada" : "sin lectura" });
  checks.push({ id: "seasons", ok: f83ok, critical: false, ms: f83.ms, detail: f83ok ? "0064 aplicada (ruta de temporada)" : f83.value === false ? "0064 no aplicada" : "sin lectura" });
  checks.push({ id: "profile", ok: f89ok, critical: false, ms: f89.ms, detail: f89ok ? "0063 aplicada (equipo favorito del perfil)" : f89.value === false ? "0063 no aplicada" : "sin lectura" });
  checks.push({ id: "social", ok: f85ok, critical: false, ms: f85.ms, detail: f85ok ? "0066 aplicada (Social 2.0: bloqueos, límites y retos de 5 min)" : f85.value === false ? "0066 no aplicada" : "sin lectura" });
  checks.push({ id: "account_tag", ok: t68ok, critical: false, ms: t68.ms, detail: t68ok ? "0068 aplicada (tag público de cuenta, permanente y sin reutilización)" : t68.value === false ? "0068 no aplicada" : "sin lectura" });
  checks.push({ id: "cups", ok: c69ok, critical: false, ms: c69.ms, detail: c69ok ? "0069 aplicada (torneos de jugadores)" : c69.value === false ? "0069 no aplicada" : "sin lectura" });
  checks.push({ id: "pickems_launch_guard", ok: g73ok, critical: false, ms: g73.ms, detail: g73ok ? "0073 aplicada (Pick'ems: elegibilidad para cobrar y puerta de lanzamiento)" : g73.value === false ? "0073 no aplicada" : "sin lectura" });
  checks.push({ id: "pickems_cutover", ok: c72ok, critical: false, ms: c72.ms, detail: c72ok ? "0072 aplicada (Pick'ems: autoridad de recompensas única para eventos futuros)" : c72.value === false ? "0072 no aplicada" : "sin lectura" });
  checks.push({ id: "pickems", ok: p71ok, critical: false, ms: p71.ms, detail: p71ok ? "0071 aplicada (Pick'ems 2.0: cuadros, cierres, liquidación y reclamos)" : p71.value === false ? "0071 no aplicada" : "sin lectura" });
  checks.push({ id: "alpha", ok: a70ok, critical: false, ms: a70.ms, detail: a70ok ? "0070 aplicada (feedback de la Closed Alpha y embudo derivado)" : a70.value === false ? "0070 no aplicada" : "sin lectura" });
  checks.push({ id: "admins", ok: a67ok, critical: false, ms: a67.ms, detail: a67ok ? "0067 aplicada (gestión de administradores con guardia en BD)" : a67.value === false ? "0067 no aplicada" : "sin lectura" });
  checks.push({ id: "ranked", ok: f84ok, critical: false, ms: f84.ms, detail: f84ok ? "0065 aplicada (Ranked 2.0: temporada competitiva y clasificación)" : f84.value === false ? "0065 no aplicada" : "sin lectura" });

  /*
   * 0058 · solo cambia PRIVILEGIOS (no añade tablas ni claves a la sonda de esquema). Su efecto se comprueba como lo
   * vería un atacante: una lectura ANÓNIMA de `profiles` por REST debe ser rechazada (401/403). Si alguien la
   * deshace, la app sigue sirviendo (no crítico) pero la readiness queda «degraded» y lo dice.
   */
  const url = serverSupabaseOrigin(env), anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anon) {
    const priv = await timed(() => fetchImpl(`${url}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: anon }, cache: "no-store" }).then((r) => r.status));
    const denied = priv.value === 401 || priv.value === 403;
    checks.push({ id: "privacy", ok: denied, critical: false, ms: priv.ms, detail: denied ? "anon sin acceso a profiles (0058)" : priv.failed ? "sin lectura" : "anon lee profiles: 0058 no vigente" });
  }

  const cat = await timed(() => sb.from("content_cards").select("card_id", { count: "exact", head: true }).neq("origin", "admin"));
  const dbCards = (cat.value as { count?: number | null } | null)?.count ?? null;
  checks.push({ id: "catalog", ok: dbCards === codeCatalog.cards, critical: false, ms: cat.ms, detail: dbCards === null ? "sin lectura" : `${dbCards}/${codeCatalog.cards}` });

  const storage = await timed(() => sb.storage.listBuckets());
  const stOk = !storage.failed && !(storage.value as { error?: unknown } | null)?.error;
  checks.push({ id: "storage", ok: stOk, critical: false, ms: storage.ms });

  return { status: summarize(checks), checkedAt: new Date().toISOString(), migrationHead: head, checks };
}

/** Caché de un solo vuelo: como mucho una sonda cada CACHE_MS por proceso. */
let cached: { at: number; value: Readiness } | null = null;
let inflight: Promise<Readiness> | null = null;
export async function cachedReadiness(run: () => Promise<Readiness>, now = Date.now()): Promise<Readiness> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  if (inflight) return inflight;
  inflight = run().then((v) => { cached = { at: Date.now(), value: v }; return v; }).finally(() => { inflight = null; });
  return inflight;
}
export const __resetReadinessCache = () => { cached = null; inflight = null; };
