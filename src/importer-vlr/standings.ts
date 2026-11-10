/**
 * CLASIFICACIÓN FINAL DEL EVENTO (/event/{id}, tabla «Prize Distribution»).
 *
 * ────────────────────────── POR QUÉ EXISTE ESTE FICHERO ──────────────────────────
 *
 * `champion-edition` estuvo bloqueada tres fases seguidas, y no por falta de dato: la cadena
 * entera que hay aguas abajo —`RawAwards.champion` → `ObjectiveAwards.championTeamId` →
 * `TeamReport.champion` → narrativeTag `champion` → regla `champion-roster` → accolade
 * `tournament-champion` → variante— ya existía y funcionaba. Lo único que faltaba era el
 * primer eslabón: **el conector nunca leyó la clasificación final, que está en la misma
 * página del evento que ya descarga.** `teams.ts` solo saca de esa página la bolsa TOTAL del
 * torneo (el par label/value «Prize» de la cabecera), no la tabla de reparto.
 *
 * ────────────────────────── MARKUP REAL ──────────────────────────
 *
 * Comprobado contra el HTML real de `vlr.gg/event/2976` (VCT 2026: EMEA Stage 2):
 *
 *   <div class="wf-label mod-large">Prize Distribution</div>
 *   <div class="wf-ptable wf-ptable--standings" role="table">
 *     <div class="row" role="row">                         ← CABECERA (sin enlace de equipo)
 *       <div class="cell" role="cell">Place</div> … </div>
 *     <div class="row " role="row">                        ← una por puesto
 *       <div class="cell" …>1<sup>st</sup></div>
 *       <div class="cell" …>$100,000</div>
 *       <div class="cell mod-team" …>
 *         <a href="/team/8877/karmine-corp"> … <div class="text-of">Karmine Corp
 *              <div class="ge-text-light">Europe</div></div></a>
 *         <div class="event-standings-spoiler">Spoiler hidden</div></div>
 *       <div class="cell" …>+8</div>                       ← puntos de circuito
 *
 * Tres trampas del markup, y las tres están contempladas abajo:
 *
 *   1. **El nombre del equipo lleva la región dentro.** `div.text-of` contiene «Karmine Corp»
 *      Y un `div.ge-text-light` anidado con «Europe». Un `textOf()` del bloque entero
 *      devolvería «Karmine Corp Europe», que no resuelve contra ningún equipo. Se toma solo
 *      el primer nodo de texto, antes del `<`.
 *   2. **Hay puestos EMPATADOS**, escritos como rango con raya larga: `5<sup>th</sup>–6<sup>th</sup>`.
 *      Se queda el primer número (5) y las dos filas comparten posición 5, que es la verdad.
 *      Por eso el campeón exige UNA sola fila en el puesto 1 (ver `prizeToAwards`).
 *   3. **Hay un `<a>` COMENTADO** dentro de la celda de puntos (`<!--<a href="/vct/standings">…`)
 *      con una copia del valor. `textOf` solo borra etiquetas, así que el texto del comentario
 *      sobrevivía y ensuciaba los puntos: se eliminan los comentarios antes de leer la fila.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * No deduce. Si la tabla no está, o no tiene una fila de puesto 1 inequívoca, devuelve vacío
 * y el torneo se queda SIN campeón —que es el estado correcto, no un fallo—. Deducir el
 * campeón como «ganador del último partido de playoffs» sería una inferencia que se equivoca
 * en cuanto haya un bracket bajo, un desempate o una final adelantada: esto lee un resultado
 * publicado, y solo eso.
 *
 * Y no sabe de qué torneo se trata: no hay un solo nombre de equipo ni de evento en este
 * fichero. El mismo código devuelve Karmine Corp para EMEA Stage 2 y lo que diga la tabla
 * para cualquier otro evento.
 */
import { findAll, num, textOf } from "./parser";
import type { VlrPlacement } from "./types";

/** `1<sup>st</sup>` → 1 · `5<sup>th</sup>–6<sup>th</sup>` → 5. `undefined` si no hay número. */
function parsePlace(cellHtml: string): number | undefined {
  const plain = textOf(cellHtml);
  // El PRIMER número manda: en un rango empatado, ambos equipos comparten el puesto de arriba.
  const m = /(\d+)/.exec(plain);
  return m ? Number(m[1]) : undefined;
}

/**
 * Nombre del equipo de una celda `mod-team`.
 *
 * `div.text-of` abre con el nombre y CONTINÚA con un `div` de región. Solo interesa lo que
 * hay antes de la primera etiqueta: eso es el nombre, tal y como lo escribe la fuente, que es
 * como tiene que llegar al normalizador (las referencias del snapshot van por nombre).
 */
function teamName(rowHtml: string): string | undefined {
  const m = /class="[^"]*text-of[^"]*">\s*([^<]+?)\s*</i.exec(rowHtml);
  const name = m ? textOf(m[1]) : "";
  return name || undefined;
}

/**
 * Filas de la tabla «Prize Distribution» de la página del evento.
 *
 * Devuelve `[]` cuando la tabla no está (torneo en curso, evento sin reparto publicado o
 * markup cambiado). Nunca lanza: un evento sin clasificación es un caso normal.
 */
export function parseEventPlacements(html: string): VlrPlacement[] {
  const label = html.indexOf("wf-ptable--standings");
  if (label < 0) return [];

  /*
   * La tabla termina donde empieza el siguiente rótulo grande de la página. Sin este corte,
   * el bloque se comería las tablas siguientes (la página encadena varias `wf-ptable`).
   */
  const rest = html.slice(label);
  const end = rest.indexOf("wf-label mod-large", 1);
  const table = end > 0 ? rest.slice(0, end) : rest;

  const out: VlrPlacement[] = [];
  const rowStarts = findAll(/<div class="row ?"[^>]*role="row"[^>]*>/g, table).map((m) => m.index);
  for (let i = 0; i < rowStarts.length; i++) {
    /*
     * Los COMENTARIOS se quitan antes de nada. La celda de puntos de circuito lleva una
     * versión antigua del enlace comentada (`<!--<a href="/vct/standings">…+8…-->`), y como
     * `textOf` solo borra etiquetas, el texto de dentro del comentario sobrevivía y se
     * mezclaba con el valor vivo: los puntos salían ilegibles. Un comentario no es contenido.
     */
    const row = table.slice(rowStarts[i], rowStarts[i + 1] ?? table.length).replace(/<!--[\s\S]*?-->/g, "");

    /*
     * La cabecera se descarta por AUSENCIA de enlace de equipo, no por su texto: es la única
     * marca que no depende del idioma ni del orden de las columnas.
     */
    const team = /<a href="\/team\/(\d+)\/([a-z0-9-]*)"/i.exec(row);
    if (!team) continue;

    const cells = findAll(/<div class="cell[^"]*"[^>]*role="cell"[^>]*>([\s\S]*?)(?=<div class="cell|$)/gi, row);
    const position = parsePlace(cells[0]?.[1] ?? "");
    const name = teamName(row);
    if (position === undefined || !name) continue;

    /* El premio es la segunda celda; si el puesto no cobra, la celda viene vacía. */
    const prize = num(textOf(cells[1]?.[1] ?? ""));
    /* Los puntos de circuito llegan como «+8»; `num` ya tolera el signo. */
    const points = num(textOf(cells[3]?.[1] ?? "").replace(/^\+/, ""));

    out.push({
      position,
      teamName: name,
      vlrTeamId: team[1],
      slug: team[2] || undefined,
      prize,
      points,
    });
  }
  return out;
}

/**
 * Campeón y subcampeón a partir de la clasificación.
 *
 * **Exige que el puesto sea INEQUÍVOCO.** Si dos equipos comparten el 1 —empate en la tabla,
 * markup raro, torneo con dos ganadores— no hay campeón: `undefined`. Es preferible que
 * `champion-edition` no se emita a que se la lleve el equipo que la fuente listó primero.
 */
export function prizeToAwards(placements: VlrPlacement[]): { champion?: string; runnerUp?: string } {
  const at = (pos: number): string | undefined => {
    const hits = placements.filter((p) => p.position === pos);
    return hits.length === 1 ? hits[0].teamName : undefined;
  };
  return { champion: at(1), runnerUp: at(2) };
}
