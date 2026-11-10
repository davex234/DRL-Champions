/**
 * F58 · CAPA HTTP DE LAS RUTAS DEL CONTROL CENTER (SOLO SERVIDOR).
 *
 * Todas las rutas nuevas de `/api/admin/*` pasan por `runAdmin`, que hace, en este orden y sin excepciones:
 *
 *   1. AUTORIZACIÓN — `verifyAdmin` (Bearer → GoTrue → `profiles.is_admin` con service_role). Anónimo, token inválido
 *      o usuario normal ⇒ 401 idéntico: no se distingue «token válido pero no admin» (sería un oráculo).
 *   2. LÍMITE DE FRECUENCIA — `app_rate_take` (0036) con cubeta de lectura o de escritura, sujeto = el admin.
 *   3. CUERPO — tamaño máximo y lista blanca de campos: un campo inesperado es 400 (mass assignment).
 *   4. RESPUESTA — siempre `no-store`, y los errores internos NUNCA salen tal cual (ni SQL ni stack): mensaje genérico
 *      salvo los errores de dominio que el servicio marca como públicos.
 *
 * El verificador y el cliente de BD se INYECTAN (`AdminDeps`): las rutas usan los de verdad y las pruebas usan un
 * verificador que responde «anónimo», «usuario normal» o «admin» y un `MemSupabase`.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyAdmin } from "@/lib/supabase/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { takeRate, rateHeaders, TOO_MANY, type RateBucket } from "@/server/services/rateLimit";

export const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" } as const;
export const MAX_BODY = 16_000;
export const GENERIC_ERROR = "No se pudo completar la operación";

export interface AdminContext { userId: string; sb: SupabaseClient }
export interface AdminDeps {
  verify: (req: Request) => Promise<{ userId: string } | null>;
  db: () => SupabaseClient | null;
  /** Límite de frecuencia; las pruebas lo sustituyen para no depender de la RPC. */
  rate?: (sb: SupabaseClient, userId: string, bucket: RateBucket) => Promise<{ allowed: boolean; retryAfter: number }>;
}
export const DEFAULT_DEPS: AdminDeps = { verify: verifyAdmin, db: getSupabaseAdmin, rate: takeRate };

/** Resultado de un servicio de admin. `public: true` ⇒ el mensaje se puede enseñar (error de dominio, no interno). */
export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
export const ok = <T>(data: T): AdminResult<T> => ({ ok: true, data });
export const fail = (status: number, error: string): AdminResult<never> => ({ ok: false, status, error });

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

export const DENIED = () => json({ error: "No autorizado" }, 401);

/** Lee y valida el cuerpo JSON: tamaño, objeto plano y lista blanca de claves. */
export async function readBody(req: Request, allowed: readonly string[]): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: NextResponse }> {
  let raw = "";
  try { raw = await req.text(); } catch { /* ilegible */ }
  if (raw.length > MAX_BODY) return { ok: false, res: json({ error: "Cuerpo demasiado grande" }, 413) };
  let body: unknown = {};
  if (raw) { try { body = JSON.parse(raw); } catch { return { ok: false, res: json({ error: "JSON inválido" }, 400) }; } }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, res: json({ error: "Cuerpo inválido" }, 400) };
  const extra = Object.keys(body as object).filter((k) => !allowed.includes(k));
  if (extra.length) return { ok: false, res: json({ error: `Campo no permitido: ${extra[0].slice(0, 40)}` }, 400) };
  return { ok: true, body: body as Record<string, unknown> };
}

/**
 * Ejecuta un handler de admin con autorización + frecuencia. `bucket` decide la cubeta (lecturas vs escrituras).
 * Cualquier excepción del handler se convierte en 500 GENÉRICO (el detalle va al log del servidor, no al cliente).
 */
export async function runAdmin(
  req: Request, deps: AdminDeps, bucket: "admin_read" | "admin_write",
  handler: (ctx: AdminContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  const who = await deps.verify(req).catch(() => null);
  if (!who) return DENIED();
  const sb = deps.db();
  if (!sb) return json({ error: "Servidor sin configurar" }, 503);
  if (deps.rate) {
    const r = await deps.rate(sb, who.userId, bucket);
    if (!r.allowed) return json({ error: TOO_MANY }, 429, rateHeaders(r.retryAfter));
  }
  try {
    return await handler({ userId: who.userId, sb });
  } catch (e) {
    console.error(`[admin] ${new URL(req.url).pathname}: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: GENERIC_ERROR }, 500);
  }
}

export function respond<T>(r: AdminResult<T>): NextResponse {
  return r.ok ? json(r.data) : json({ error: r.error }, r.status);
}

/**
 * Traduce los códigos de error de las RPC de 0055 a mensajes para el panel. Lo que no está en la tabla sale como
 * error genérico: nunca se reenvía el mensaje crudo de PostgreSQL.
 */
const RPC_ERRORS: Record<string, [number, string]> = {
  NOT_ADMIN: [403, "Solo un administrador puede hacer esto"],
  SELF_SANCTION: [409, "No puedes sancionar tu propia cuenta"],
  TARGET_IS_ADMIN: [409, "No se puede sancionar a otro administrador"],
  USER_NOT_FOUND: [404, "Usuario no encontrado"],
  ALREADY_SANCTIONED: [409, "El usuario ya tiene una sanción activa"],
  SANCTION_NOT_FOUND: [404, "Sanción no encontrada"],
  ALREADY_REVOKED: [409, "La sanción ya estaba revocada"],
  REASON_REQUIRED: [400, "El motivo es obligatorio"],
  SUSPENSION_NEEDS_EXPIRY: [400, "Una suspensión necesita duración"],
  BAD_EXPIRY: [400, "Fecha de fin inválida"],
  BAD_TYPE: [400, "Tipo inválido"],
  STALE_BALANCE: [409, "El saldo cambió desde que lo revisaste. Recarga la ficha y vuelve a confirmar."],
  BAD_AMOUNT: [400, "Cantidad inválida"],
  REF_REQUIRED: [400, "Falta la clave de la operación"],
  "Saldo insuficiente": [409, "El saldo quedaría en negativo"],
  EVENT_NOT_FOUND: [404, "Evento no encontrado"],
  NOT_A_DRAFT: [409, "Solo se publica un borrador"],
  STALE_EVENT: [409, "Otro administrador cambió este evento. Recarga y revisa antes de publicar."],
  EVENT_ALREADY_ENDED: [409, "El evento ya habría terminado: cambia las fechas antes de publicar"],
  BAD_ACTION: [400, "Acción inválida"],
  // F60 · 0057 (CMS de contenido)
  STALE_CONTENT: [409, "Este contenido ha cambiado desde que lo abriste. Recarga y revisa antes de guardar."],
  CONTENT_NOT_FOUND: [404, "Contenido no encontrado"],
  CONTENT_INCOMPLETE: [409, "Falta completar el contenido antes de publicarlo (arte, pool o datos obligatorios)"],
  HAS_REFERENCES: [409, "Tiene referencias reales: no se puede borrar. Retíralo en su lugar."],
  ECONOMY_FROZEN: [409, "La economía de un sobre publicado no se puede cambiar"],
  BAD_TRANSITION: [409, "Ese cambio de estado no está permitido"],
  BAD_FIELD: [400, "Campo no permitido"],
  BAD_ROLE: [400, "Rol inválido"],
  BAD_ABILITIES: [400, "Habilidades inválidas: cuatro (C, Q, E, X) con nombre"],
  BAD_ASSET: [400, "El asset no existe, no es del tipo correcto o no está aprobado"],
  BAD_ID: [400, "Identificador inválido"],
  BAD_STATS: [400, "Estadísticas inválidas"],
  BAD_TEAM: [400, "Equipo impreso inválido"],
  // 0067 · gestión de administradores
  LAST_ADMIN: [409, "No puede quedar ningún administrador: concede admin a otra cuenta antes de quitar este"],
  TARGET_SANCTIONED: [409, "Esa cuenta tiene una sanción vigente: no se le puede dar admin"],
  BAD_REASON: [400, "El motivo es demasiado largo (máximo 300 caracteres)"],
  ADMIN_WRITE_FORBIDDEN: [403, "Solo un administrador puede hacer esto"],
  // F86 · 0069 (torneos de jugadores)
  CUP_NOT_FOUND: [404, "Torneo no encontrado"],
  STALE_CUP: [409, "Otro administrador cambió este torneo. Recarga y revisa antes de publicar."],
  CUP_DATES_PAST: [409, "La inscripción ya habría cerrado: cambia las fechas antes de publicar"],
  CUP_RULES_REQUIRED: [409, "Escribe las reglas antes de publicar"],
  CUP_FINAL: [409, "Un torneo terminado o cancelado no cambia"],
  CUP_LOCKED: [409, "Con el torneo publicado solo se corrige texto (nombre, descripción, reglas)"],
  CUP_IMMUTABLE: [409, "Un torneo publicado no se borra: cancélalo"],
  CUP_WRITE_FORBIDDEN: [403, "El estado del torneo solo cambia con sus acciones"],
  CONFIRM_MISMATCH: [400, "La confirmación no coincide: escribe exactamente lo que se pide"],
  CUP_MATCH_NOT_FOUND: [404, "Cruce no encontrado"],
  CUP_NOT_IN_PROGRESS: [409, "El torneo no está en curso"],
  CUP_NOT_RESOLVABLE: [409, "Ese cruce no está retenido ni tiene el plazo vencido: no se puede resolver"],
  BAD_DECISION: [400, "Decisión inválida"],
  CUP_INTEGRITY: [500, "El cuadro rechazó la operación por integridad"],
};
export function rpcFailure(message: string | undefined): AdminResult<never> {
  const m = message ?? "";
  const hit = Object.keys(RPC_ERRORS).find((k) => m.includes(k));
  if (hit) { const [status, text] = RPC_ERRORS[hit]; return fail(status, text); }
  console.error(`[admin] rpc: ${m}`);
  return fail(500, GENERIC_ERROR);
}
