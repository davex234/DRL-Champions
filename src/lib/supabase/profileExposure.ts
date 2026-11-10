/**
 * FASE 69 · CONTRATO DE EXPOSICIÓN DE `profiles` — qué ve cada quién. Una sola fuente para la ruta
 * `/api/game/me`, la migración 0058 (APLICADA 2026-09-28), sus pruebas y el test de contrato.
 *
 * Principio: minimización. Un perfil público enseña lo que el producto necesita enseñar en público; lo privado
 * (saldo, `is_admin`, última conexión, contadores internos) solo lo lee su dueño, y siempre por el servidor.
 *
 *   · anon            → NADA de la tabla. Lo público sale por vistas (clasificaciones) y por la API del servidor
 *                       (`/api/game/player`, proyección PUBLIC de F31).
 *   · authenticated   → por REST, de CUALQUIER fila, solo `AUTHENTICATED_PROFILE_COLUMNS` (el cliente cuenta
 *                       posiciones por puntos/región y edita su avatar/región/nombre).
 *   · el propio jugador → además sus columnas privadas, por `GET /api/game/me` (service_role, filtrado por el Bearer).
 *   · admin           → lo mismo que cualquiera por REST; el panel lee por `/api/admin/*` con service_role y
 *                       `verifyAdmin` en cada ruta.
 */

/** Columnas que `authenticated` puede leer por REST de cualquier fila (tras 0058). */
export const AUTHENTICATED_PROFILE_COLUMNS = ["id", "username", "avatar", "level", "points", "region"] as const;

/** Columnas del perfil PROPIO que devuelve `/api/game/me` (las que usa `Profile` en el cliente). */
export const OWN_PROFILE_COLUMNS = [
  "id", "username", "avatar", "level", "xp", "credits", "collection_value", "distinct_cards", "rarest_rank",
  "market_volume", "packs_opened", "points", "region", "is_admin", "created_at", "updated_at",
] as const;

/** Columnas que nunca se exponen por REST a otro jugador (ni anon ni authenticated). */
export const PRIVATE_PROFILE_COLUMNS = [
  "xp", "credits", "tokens", "collection_value", "distinct_cards", "rarest_rank", "market_volume", "packs_opened",
  "created_at", "updated_at", "taxes_paid", "is_admin", "equipped", "last_seen_at",
] as const;
