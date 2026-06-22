/**
 * El panel de administración (/admin) solo es accesible mediante configuración.
 * - En desarrollo está activado por comodidad.
 * - En producción requiere la variable de entorno `NEXT_PUBLIC_ADMIN=1`.
 */
export const ADMIN_ENABLED =
  process.env.NEXT_PUBLIC_ADMIN === "1" || process.env.NODE_ENV !== "production";
