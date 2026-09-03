/**
 * Interruptores de funcionalidad del producto.
 *
 * NO son configuración de entorno ni control de acceso: son constantes de código,
 * revisables en el diff y cambiables en un solo sitio. La seguridad real vive en la
 * base de datos (RLS + privilegios de EXECUTE), nunca aquí — este fichero solo evita
 * que la UI ofrezca algo que el servidor va a rechazar.
 */

/**
 * MERCADO GLOBAL (jugador ↔ jugador) — DESACTIVADO en Fase A.
 *
 * Motivo: la propiedad de las cartas tiene HOY dos autoridades sin reconciliar —
 * `useGameStore.ownedCards` en localStorage y la tabla `public.inventory` en Supabase.
 * De ahí salen tres fallos de la auditoría:
 *
 *   BUG-01  comprar sale gratis: `buy_listing` descuenta `profiles.credits` en el
 *           servidor, pero CloudSync vuelve a subir el saldo local, que nunca se
 *           decrementó, y lo sobrescribe.
 *   BUG-02  el bucle publicar→cancelar duplica cartas sin límite: `cancel_listing`
 *           las devuelve al inventario del servidor y el cliente añade además una
 *           copia local.
 *   SEC-01  `deposit_card` permite acuñar cualquier carta, porque el servidor no
 *           conoce la posesión real del usuario.
 *
 * El cierre efectivo está en la base de datos (`supabase/migrations/0010_market_lockdown.sql`,
 * que revoca EXECUTE de las RPC que acuñan o mueven valor). Esta constante solo
 * impide que la UI ofrezca una operación que ya va a fallar con 403.
 *
 * Se reactiva en FASE E, cuando el inventario sea server-authoritative. Nada del
 * mercado global se ha borrado: RPC, esquema, antifraude, dominio y componentes
 * siguen en el repositorio.
 */
export const GLOBAL_MARKET_ENABLED = false;
