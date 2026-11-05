import { ns } from "@/i18n/runtime";

const tr = ns("admin");

/**
 * F58 · SANCIONES — el modelo de dominio de la moderación persistida (tabla `user_sanctions`, migración 0055).
 *
 * Reutiliza el VOCABULARIO de `platform/cloud/moderation.ts` (motor en memoria del modo online, que nunca se
 * persistió): una sanción tiene objetivo, tipo, autor, motivo, emisión, caducidad nullable (null = permanente) y
 * revocación. Aquí solo viven los dos tipos que el panel emite —`ban` y `suspension`— y las reglas puras:
 * validación de la entrada, «¿está activa?» y QUÉ PETICIONES BLOQUEA (la política de enforcement).
 *
 * Es puro: sin BD, sin reloj (el `now` llega como parámetro) y sin red.
 */

export type AdminSanctionType = "ban" | "suspension";

export interface SanctionRow {
  id: string;
  user_id: string;
  type: AdminSanctionType;
  reason: string;
  created_at: string;
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

/** Duraciones que ofrece el panel para una suspensión (horas). Un ban puede ser temporal o permanente. */
export const SUSPENSION_HOURS = [1, 24, 72, 168, 720] as const;
export const REASON_MIN = 8;
export const REASON_MAX = 500;
/** Tope de una sanción temporal: un año. Más que eso es un ban permanente y se dice así. */
export const MAX_TEMP_HOURS = 24 * 365;

export interface SanctionInput {
  userId: string;
  type: AdminSanctionType;
  reason: string;
  /** Horas; `null` = permanente (solo `ban`). */
  hours: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Limpia un motivo: sin caracteres de control, espacios colapsados, longitud acotada. */
export function cleanReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= REASON_MIN && t.length <= REASON_MAX ? t : null;
}

/** Valida la entrada de una sanción. No confía en el formulario: tipo, duración y motivo se comprueban aquí. */
export function parseSanctionInput(body: Record<string, unknown>): Parsed<SanctionInput> {
  if (!isUuid(body.userId)) return { ok: false, error: tr("Usuario inválido") };
  const type = body.type;
  if (type !== "ban" && type !== "suspension") return { ok: false, error: tr("Tipo de sanción inválido") };
  const reason = cleanReason(body.reason);
  if (!reason) return { ok: false, error: tr("El motivo es obligatorio ({REASON_MIN}–{REASON_MAX} caracteres)", { REASON_MIN, REASON_MAX }) };
  const rawHours = body.hours;
  let hours: number | null;
  if (rawHours === null || rawHours === undefined || rawHours === "permanent") {
    if (type === "suspension") return { ok: false, error: tr("Una suspensión necesita duración") };
    hours = null;
  } else {
    const h = Number(rawHours);
    if (!Number.isInteger(h) || h < 1 || h > MAX_TEMP_HOURS) return { ok: false, error: tr("Duración inválida (1–{MAX_TEMP_HOURS} h)", { MAX_TEMP_HOURS }) };
    hours = h;
  }
  return { ok: true, value: { userId: body.userId, type, reason, hours } };
}

export function expiresAtFor(hours: number | null, now: number): string | null {
  return hours == null ? null : new Date(now + hours * 3_600_000).toISOString();
}

/** ¿Sigue vigente? Revocada o caducada ⇒ no. */
export function isSanctionActive(s: Pick<SanctionRow, "revoked_at" | "expires_at">, now: number): boolean {
  if (s.revoked_at) return false;
  return s.expires_at == null || Date.parse(s.expires_at) > now;
}

export type SanctionStatus = "ACTIVE" | "EXPIRED" | "REVOKED";
export function sanctionStatus(s: Pick<SanctionRow, "revoked_at" | "expires_at">, now: number): SanctionStatus {
  if (s.revoked_at) return "REVOKED";
  return isSanctionActive(s, now) ? "ACTIVE" : "EXPIRED";
}

/** La sanción vigente que manda: un ban permanente gana; si no, la que caduca más tarde. */
export function governingSanction<T extends Pick<SanctionRow, "revoked_at" | "expires_at">>(rows: readonly T[], now: number): T | null {
  const active = rows.filter((s) => isSanctionActive(s, now));
  if (active.length === 0) return null;
  return [...active].sort((a, b) => (a.expires_at == null ? -1 : b.expires_at == null ? 1 : Date.parse(b.expires_at) - Date.parse(a.expires_at)))[0];
}

/*
 * ────────────────────────── ENFORCEMENT: QUÉ SE BLOQUEA ──────────────────────────
 *
 * Una sanción activa bloquea TODA MUTACIÓN del juego del usuario: comprar/abrir sobres, desguazar, reclamar,
 * partidas PvE/PvP, matchmaking, competitivo, campaña, Draft, social, mercado, pick'ems, mazos y estrategias.
 * No bloquea: iniciar sesión, las LECTURAS (GET) —su colección y su perfil se siguen viendo— ni las páginas
 * públicas. Tampoco la telemetría (no muta nada del jugador y medir el efecto de la sanción es útil).
 */
const GATED_PREFIXES = ["/api/game/", "/api/pickems", "/api/market"] as const;
const UNGATED = ["/api/telemetry"] as const;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isGatedRequest(method: string, pathname: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return false;
  if (UNGATED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  return GATED_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

export const SANCTION_DENIED_MESSAGE = "Tu cuenta tiene una sanción activa: no puedes realizar esta acción.";

/** Texto para el jugador. No revela quién sancionó ni notas internas: tipo y hasta cuándo. */
export function sanctionNotice(s: Pick<SanctionRow, "type" | "expires_at">): { type: AdminSanctionType; until: string | null; message: string } {
  return { type: s.type, until: s.expires_at, message: SANCTION_DENIED_MESSAGE };
}
