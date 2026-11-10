/**
 * POLÍTICA DE EMPAREJAMIENTO PvP (Bloque 7.4).
 *
 * Un solo fichero con las constantes que gobiernan la cola y —lo más importante— con el
 * criterio de emparejamiento escrito, porque «no hay criterio» y «el criterio es el tiempo de
 * espera» se parecen mucho en el código y no se parecen en nada en la conversación.
 *
 * PURO: aquí no se lee un reloj ni una fila.
 */

/**
 * TTL de una búsqueda. Diez minutos.
 *
 * No es una cifra de rendimiento: es una promesa al jugador. Una cola sin caducidad convierte a
 * quien cerró el navegador hace tres días en un rival fantasma al que se le crea una partida que
 * nunca va a jugar, y que además le bloquea la siguiente por la guarda de partida activa.
 */
export const QUEUE_TTL_SECONDS = 600;

/**
 * Arrendamiento de una reserva de pareja. Veinte segundos.
 *
 * Es el techo del tiempo que el servidor puede tardar en construir la partida: resolver dos
 * mazos contra el inventario real, congelarlos y escribir la fila. Medido, eso son decenas de
 * milisegundos (ver el verificador); veinte segundos es margen para un proceso muy castigado,
 * no una estimación. Si el arrendamiento vence, la reserva se recupera sola y sin ambigüedad,
 * porque el id de la partida estaba reservado y se puede preguntar por él.
 */
export const PAIR_LEASE_SECONDS = 20;

/**
 * CRITERIO DE EMPAREJAMIENTO — rating compatible, con prioridad al que más ha esperado.
 *
 * Hasta el bloque 7.4 esto era FIFO puro, y no por diseño sino por un BLOQUEO: no existía ninguna
 * fuente de rating PvP persistente y autoritativa, así que el tiempo de espera era el único dato
 * honesto disponible. El bloque 7.4.1 creó esa fuente (`duel_pvp_ratings`, migración 0033) y el
 * criterio pasó a tener dos pasos:
 *
 *   1. EL BUSCADOR es el que más lleva esperando. Esto conserva intacta la prioridad FIFO: nadie
 *      adelanta a quien lleva más tiempo por tener mejor rating.
 *   2. SU RIVAL es, de entre los compatibles, el de MENOR diferencia de rating; a igualdad de
 *      diferencia, el que más ha esperado. Determinista, sin azar.
 *
 * «Compatible» lo define la ventana de `@/domain/cardgame/rating`, que se ensancha con el tiempo
 * en cola. Con una población nueva (todos a 1000) la diferencia es 0 para todos y el desempate
 * por antigüedad reproduce EXACTAMENTE el comportamiento FIFO anterior.
 *
 * La política vive en SQL (`duel_pvp_rating_window`) porque la selección de candidatos es una
 * consulta; el espejo en TypeScript está en `@/domain/cardgame/rating` y el verificador comprueba
 * que los dos coinciden.
 */
export const PAIRING_CRITERION = "RATING_WINDOW_THEN_FIFO" as const;
