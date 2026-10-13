/**
 * F67 · Decisiones PURAS del borde (middleware): tamaño máximo de cuerpo y arneses de QA. Sin Node, sin red.
 */

/** Rutas de subida de ficheros: su propio límite (y su validación de firma/decodificación) vive en la ruta. */
const UPLOAD_PREFIXES = ["/api/admin/assets", "/api/admin/cms", "/api/admin/cards"];

export const BODY_LIMIT = { game: 256 * 1024, admin: 1024 * 1024, upload: 25 * 1024 * 1024 } as const;

/** Bytes máximos aceptados para una petición a `pathname` (por `Content-Length`). `null` = no es una API. */
export function bodyLimitFor(pathname: string): number | null {
  if (!pathname.startsWith("/api/")) return null;
  if (UPLOAD_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return BODY_LIMIT.upload;
  if (pathname.startsWith("/api/admin/")) return BODY_LIMIT.admin;
  return BODY_LIMIT.game;
}

/** ¿Se rechaza por tamaño? Solo con `Content-Length` declarado (los cuerpos sin longitud los acota cada ruta). */
export function tooLarge(pathname: string, method: string, contentLength: string | null): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  const limit = bodyLimitFor(pathname);
  if (limit === null || contentLength === null) return false;
  const n = Number(contentLength);
  return Number.isFinite(n) && n > limit;
}

/**
 * Arneses `/design-system/*` (fixtures de QA de F25–F62): en producción solo con `NEXUS_QA_HARNESS=1` (QA local). En
 * desarrollo siempre. Así la release pública no expone páginas de prueba, y la QA visual sigue funcionando.
 */
export function qaHarnessBlocked(pathname: string, env: { NODE_ENV?: string; NEXUS_QA_HARNESS?: string }): boolean {
  if (pathname !== "/design-system" && !pathname.startsWith("/design-system/")) return false;
  if (env.NODE_ENV !== "production") return false;
  return env.NEXUS_QA_HARNESS !== "1";
}
