/**
 * ARTWORK MANUAL DE UN EJEMPLAR — el tipo que cruza la frontera.
 *
 * Las cartas de NEXUS se diseñan a mano. Cuando existe el fichero final de una versión, el
 * servidor lo resuelve por `card_id` + `minted_version` y lo entrega ya atado al `uid` del
 * ejemplar. El cliente NO elige artwork: lo recibe elegido.
 *
 * Esa forma de repartir el trabajo es lo que hace imposible el cruce entre versiones. Si el
 * navegador recibiera «el artwork de esta carta» tendría que decidir cuál, y ahí es donde
 * aparecen las heurísticas —la última, la más nueva, la que se cargó antes— que el bloque
 * anterior se dedicó a prohibir.
 */

/** Lo mínimo para pintar. Un subconjunto deliberado de la fila de `assets`. */
export interface CardArtworkRef {
  /** URL pública del fichero. Es lo único que el navegador necesita. */
  url: string | null;
  /** La versión de la CARTA bajo la que se acuñó el ejemplar. Para trazar, no para elegir. */
  cardVersion: number;
  cardId: string;
  format: string;
}

/** `uid` de ejemplar → su artwork. Ausente = no hay artwork para esa versión. */
export type ArtworkByUid = Record<string, CardArtworkRef>;

/**
 * ¿Se puede pintar esto?
 *
 * Una entrada sin URL, con una URL vacía o con un esquema que no sea `http(s)` no es un
 * artwork: es un fallback. Se comprueba aquí y no en cada pantalla para que la respuesta sea
 * la misma en las tres, y para que una URL rara no acabe en un `<img src>`.
 */
export function artworkPintable(a: CardArtworkRef | undefined | null): a is CardArtworkRef & { url: string } {
  if (!a || typeof a.url !== "string" || a.url.trim() === "") return false;
  try {
    const p = new URL(a.url, typeof location !== "undefined" ? location.origin : "http://localhost");
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}
