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

/**
 * PACK WALKOUT 3D (Walkout 0.5) — la entrada humana en 3D DENTRO de la apertura real de sobres.
 * WALKOUT 0.7 (2026-10-08): ENCENDIDO PARA TODOS («all») por autorización expresa del propietario.
 *
 * Es solo PRESENTACIÓN: el servidor decide y guarda las cartas antes de que empiece ninguna animación; esto únicamente
 * cambia cómo se enseñan las especiales (Champions S breve, Future Star walkout, Record Breaker/Moments mega). Con
 * «off» la apertura es exactamente la de siempre (hero + resto + resumen): ese es también el ROLLBACK.
 *
 *   "off"     nadie (producción hasta Walkout 0.6; release drl-0.1.1-1-69e4b672 = rollback inmediato).
 *   "admins"  solo las cuentas con `profiles.is_admin` (cuentas autorizadas explícitamente; veredicto del servidor).
 *   "all"     todos los jugadores.
 *
 * En `next dev`, un navegador puede activarlo SOLO para sí con `localStorage["drl:walkout3d"] = "1"`; en una build de
 * producción esa vía no existe (ver `domain/walkout/packWalkout · packWalkoutAllowed`).
 */
export const PACK_WALKOUT_3D_ENABLED: "off" | "admins" | "all" = "all";

/**
 * TRADUCCIONES OPCIONALES DEL CONTENIDO EDITABLE (i18n, 2026-10-11) — APAGADO.
 *
 * El contenido del CMS se guarda en español. Sus traducciones opcionales son una capa aparte (`i18n/content.ts`) que
 * sale de la tabla ADITIVA `content_translations` (propuesta en `docs/i18n/proposals/`, SIN aplicar). Mientras esto esté
 * en `false` el juego no pide la capa y el contenido se ve en español, que es el respaldo. Encenderlo exige aplicar
 * antes esa tabla; apagarlo no pierde nada.
 */
export const CONTENT_TRANSLATIONS_ENABLED = false;
