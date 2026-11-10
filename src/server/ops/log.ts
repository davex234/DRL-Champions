/**
 * F67 · LOG ESTRUCTURADO Y CÓDIGOS DE ERROR (sin proveedor externo).
 *
 * Una línea JSON por evento en stdout/stderr (lo recoge `next start`, systemd o el fichero de log del host). Cada error
 * interno recibe un `errorId` corto que viaja al cliente («Código: 7F3K9Q»): con él se encuentra la línea en el log sin
 * enseñarle al jugador ni el mensaje de la base de datos, ni rutas, ni SQL.
 *
 * Nunca registra cuerpos, cabeceras ni tokens: solo lo que se le pasa en `ctx`, que se filtra por nombre.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 6 caracteres sin ambigüedades (sin 0/O/1/I): cómodo para dictarlo por soporte. */
export function newErrorId(): string {
  const b = randomBytes(6);
  let s = "";
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return s;
}

const SENSITIVE = /pass|token|secret|authorization|cookie|key|email|jwt/i;

/** Quita del contexto cualquier campo con nombre sensible y recorta textos largos. */
export function scrub(ctx: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE.test(k)) { out[k] = "[redactado]"; continue; }
    out[k] = typeof v === "string" ? v.slice(0, 300) : v;
  }
  return out;
}

export type LogLevel = "info" | "warn" | "error";

export function logEvent(level: LogLevel, scope: string, msg: string, ctx: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, scope, msg: msg.slice(0, 500), ...scrub(ctx) });
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.info(line);
}

/** Texto de un error: `Error`, `PostgrestError` (objeto con `message`/`code`) o cualquier otra cosa. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { message?: unknown; code?: unknown };
    return `${String(o.message)}${o.code ? ` [${String(o.code)}]` : ""}`;
  }
  return String(e);
}

/** Id de la petición que puso el middleware (`x-request-id`), si lo hay. */
export const requestIdOf = (req?: Request | null): string | null => req?.headers.get("x-request-id") ?? null;

/**
 * Error INTERNO → registra el detalle con un código y devuelve al cliente un 500 genérico con ese código.
 * El mensaje de la excepción se queda en el servidor.
 */
export function internalError(scope: string, e: unknown, req?: Request | null, ctx: Record<string, unknown> = {}): NextResponse {
  const errorId = newErrorId();
  logEvent("error", scope, errorText(e), { errorId, requestId: requestIdOf(req), ...ctx });
  return NextResponse.json(
    { error: `Algo ha fallado en el servidor. Código: ${errorId}`, code: "INTERNAL", errorId },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}

/** Mensaje seguro para un fallo ≥ 500 que viene como texto (p. ej. `error.message` de Supabase). */
export function safeServerMessage(scope: string, status: number, message: string | undefined, req?: Request | null): { error: string; errorId?: string } {
  if (status < 500) return { error: message ?? "Solicitud no válida" };
  const errorId = newErrorId();
  logEvent("error", scope, message ?? "error", { errorId, status, requestId: requestIdOf(req) });
  return { error: `Algo ha fallado en el servidor. Código: ${errorId}`, errorId };
}
