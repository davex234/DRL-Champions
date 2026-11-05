/**
 * F67 · VALIDACIÓN DE CONFIGURACIÓN AL ARRANCAR. Pura: recibe el entorno, no lo lee de fuera.
 *
 * Antes no existía: sin `NEXT_PUBLIC_SUPABASE_URL` la app arrancaba en «modo local» (localStorage) y sin la clave de
 * servicio respondía 401/503 a todo — se descubría con el primer usuario. Ahora `instrumentation.ts` la ejecuta al
 * iniciar el servidor y, en producción, un fallo CRÍTICO impide arrancar con un mensaje claro.
 *
 * Nunca devuelve valores: solo nombres de variables y el motivo.
 */
export type EnvLevel = "CRITICAL" | "DEGRADED" | "OPTIONAL";
export interface EnvIssue { name: string; level: EnvLevel; problem: string }
export interface EnvReport { ok: boolean; production: boolean; issues: EnvIssue[]; present: string[] }

type Env = Record<string, string | undefined>;

/** Rol de un JWT de Supabase sin verificar la firma (solo para detectar una clave de servicio mal puesta). */
function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json.role === "string" ? json.role : null;
  } catch { return null; }
}

export function validateEnv(env: Env): EnvReport {
  const production = env.NODE_ENV === "production";
  const issues: EnvIssue[] = [];
  const val = (k: string) => (env[k] ?? "").trim();
  const need = (k: string, level: EnvLevel, problem = "falta") => { if (!val(k)) issues.push({ name: k, level, problem }); };

  need("NEXT_PUBLIC_SUPABASE_URL", "CRITICAL");
  need("NEXT_PUBLIC_SUPABASE_ANON_KEY", "CRITICAL");
  need("SUPABASE_SERVICE_ROLE_KEY", "CRITICAL");

  const url = val("NEXT_PUBLIC_SUPABASE_URL");
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") issues.push({ name: "NEXT_PUBLIC_SUPABASE_URL", level: "CRITICAL", problem: "no es una URL http(s)" });
      else if (production && u.protocol === "http:" && !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) {
        issues.push({ name: "NEXT_PUBLIC_SUPABASE_URL", level: "DEGRADED", problem: "http sin TLS hacia un host no local" });
      }
    } catch { issues.push({ name: "NEXT_PUBLIC_SUPABASE_URL", level: "CRITICAL", problem: "no es una URL válida" }); }
  }
  // La clave PÚBLICA nunca puede ser la de servicio: acabaría en el JS del navegador.
  const anon = val("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (anon && jwtRole(anon) === "service_role") issues.push({ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", level: "CRITICAL", problem: "es una clave service_role (se publicaría en el navegador)" });
  const service = val("SUPABASE_SERVICE_ROLE_KEY");
  if (service && jwtRole(service) && jwtRole(service) !== "service_role") issues.push({ name: "SUPABASE_SERVICE_ROLE_KEY", level: "CRITICAL", problem: "no es una clave service_role" });

  const sync = val("SYNC_SECRET");
  if (!sync) issues.push({ name: "SYNC_SECRET", level: "DEGRADED", problem: "falta: la sincronización esports manual responde 401" });
  else if (sync.length < 16) issues.push({ name: "SYNC_SECRET", level: "DEGRADED", problem: "demasiado corto (<16)" });

  if (!val("ANTHROPIC_API_KEY")) issues.push({ name: "ANTHROPIC_API_KEY", level: "OPTIONAL", problem: "falta: predicciones con heurística" });
  if (!val("NEXT_PUBLIC_VLR_API")) issues.push({ name: "NEXT_PUBLIC_VLR_API", level: "OPTIONAL", problem: "falta: fuente VLR desactivada" });
  if (val("NEXT_PUBLIC_TELEGRAM_WEBHOOK")) issues.push({ name: "NEXT_PUBLIC_TELEGRAM_WEBHOOK", level: "DEGRADED", problem: "es NEXT_PUBLIC_: la URL del webhook viaja en el JS del navegador" });

  // Interruptores que en producción deben estar APAGADOS.
  if (production && val("NEXUS_SANDBOX_CREDITS") === "1") issues.push({ name: "NEXUS_SANDBOX_CREDITS", level: "DEGRADED", problem: "=1 en producción (el servidor lo ignora, pero no debería estar)" });
  if (production && val("NEXUS_QA_HARNESS") === "1") issues.push({ name: "NEXUS_QA_HARNESS", level: "DEGRADED", problem: "=1 en producción: expone los arneses /design-system" });

  // F70 · MODO PÚBLICO (`DRL_PUBLIC_RELEASE=1`). Apagado, nada de esto se evalúa: el modo local queda idéntico.
  // Encendido, un origen canónico que no sea https público es CRÍTICO (en producción el servidor no arranca).
  if (isPublicRelease(env)) {
    const site = publicUrlProblem(val("NEXT_PUBLIC_SITE_URL"));
    if (site) issues.push({ name: "NEXT_PUBLIC_SITE_URL", level: "CRITICAL", problem: `modo público: ${site}` });
    const sb = url ? publicUrlProblem(url) : null;
    if (sb) issues.push({ name: "NEXT_PUBLIC_SUPABASE_URL", level: "CRITICAL", problem: `modo público: ${sb} (el navegador del jugador no llega)` });
    if (val("NEXUS_SANDBOX_CREDITS") === "1") issues.push({ name: "NEXUS_SANDBOX_CREDITS", level: "CRITICAL", problem: "=1 en modo público" });
    if (val("NEXUS_QA_HARNESS") === "1") issues.push({ name: "NEXUS_QA_HARNESS", level: "CRITICAL", problem: "=1 en modo público" });
  }

  const present = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SYNC_SECRET", "ANTHROPIC_API_KEY", "NEXT_PUBLIC_VLR_API", "NEXT_PUBLIC_ADMIN"].filter((k) => !!val(k));
  return { ok: !issues.some((i) => i.level === "CRITICAL"), production, issues, present };
}

/** F70 · Interruptor del modo público (release abierta). Solo `1` exacto lo enciende. */
export const PUBLIC_RELEASE_FLAG = "DRL_PUBLIC_RELEASE";
export function isPublicRelease(env: Env): boolean { return (env[PUBLIC_RELEASE_FLAG] ?? "").trim() === "1"; }

const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\])$/i;
/** Problema de una URL que debe ser pública: `null` si es https hacia un host no local. Nunca devuelve el valor. */
export function publicUrlProblem(raw: string): string | null {
  if (!raw.trim()) return "falta";
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return "no es una URL válida"; }
  if (u.protocol !== "https:") return "no es https";
  if (LOCAL_HOST.test(u.hostname) || u.hostname.endsWith(".localhost")) return "apunta a localhost/127.0.0.1";
  return null;
}

/** Buzón de pruebas o SMTP local: no entrega correo real. */
export const LOCAL_MAIL_CATCHER = /inbucket|mailpit|mailhog|mailcatcher|localhost|127\.0\.0\.1|^::1$/i;

/**
 * F70 · Configuración de GoTrue (claves SIN secretos leídas del VPS) frente a una release pública. Devuelve los
 * problemas legibles (vacío = apta). `siteUrl` es el NEXT_PUBLIC_SITE_URL de la app, si se conoce: GoTrue debe coincidir.
 */
export function gotruePublicProblems(g: Record<string, string | undefined>, siteUrl?: string): string[] {
  const v = (k: string) => (g[k] ?? "").trim();
  const out: string[] = [];
  const smtp = v("GOTRUE_SMTP_HOST");
  if (!smtp || LOCAL_MAIL_CATCHER.test(smtp)) out.push(`SMTP=${smtp || "sin configurar"} (no entrega correo real)`);
  const site = publicUrlProblem(v("GOTRUE_SITE_URL"));
  if (site) out.push(`GOTRUE_SITE_URL ${site}`);
  else if (siteUrl && !publicUrlProblem(siteUrl) && new URL(v("GOTRUE_SITE_URL")).origin !== new URL(siteUrl.trim()).origin) out.push("GOTRUE_SITE_URL ≠ NEXT_PUBLIC_SITE_URL");
  const allow = v("GOTRUE_URI_ALLOW_LIST").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allow.length) out.push("allow-list vacía");
  else if (allow.some((a) => publicUrlProblem(a.replace(/\*\*?/g, "x")))) out.push("allow-list con entradas locales o sin https");
  if (v("GOTRUE_MAILER_AUTOCONFIRM").toLowerCase() === "true") out.push("autoconfirmación ON (registro sin verificar correo)");
  return out;
}

/** Mensaje legible para el log de arranque (sin valores). */
export function describeEnv(r: EnvReport): string {
  if (!r.issues.length) return "[env] configuración completa";
  return r.issues.map((i) => `[env] ${i.level} ${i.name}: ${i.problem}`).join("\n");
}
