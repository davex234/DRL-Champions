/**
 * PÁGINA DE STATS DEL EVENTO (/event/stats/{id}) — agregados por jugador de TODO el torneo.
 *
 * Parsing PURO. Markup real: tabla st-table con una fila por jugador; el jugador va en
 * td.mod-player (nick en .st-pl-name, TAG del equipo en .st-pl-country, flag de país) y cada
 * métrica en un td[data-col] (rating2/acs/kd/kast/adr/hsp/k/d/a/fk/fd/maps/rnd). Los agentes son
 * imágenes /img/vlr/game/agents/{slug}.png. Nada se calcula: solo se extrae.
 *
 * ESTA PÁGINA ES LA ÚNICA FUENTE DE CLUTCH. El scoreboard por mapa de vlr.gg no tiene columna
 * de clutch —sus columnas son rating2, acs, k, d, a, kd-diff, kast, adr, hsp, fb, fd y
 * fk-diff—, así que el agregado del torneo que se lee aquí es el único dato de clutch que
 * publica la fuente. Ver `clutch()` más abajo.
 */
import { textOf, findAll, num, flagCountry } from "./parser";
import { agentFromSrc } from "./agents";
import type { VlrStatsRow } from "./types";

/** Valores por data-col de una fila (texto plano por celda). */
function dataCols(rowHtml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of findAll(/<td[^>]*data-col="([a-z0-9]+)"[^>]*>([\s\S]*?)<\/td>/gi, rowHtml)) {
    out[m[1]] = textOf(m[2]);
  }
  return out;
}

/**
 * CLUTCH de una fila — el único dato que `dataCols` no puede dar hecho.
 *
 * La celda `data-col="cl"` no es un número: es una fracción con dos `span` («9/40» =
 * ganadas/jugadas). Aplanarla con `textOf` daría «9/40», que `num()` descarta por no ser un
 * número, y ahí es donde se perdía el dato: `dataCols` YA lo capturaba y se tiraba una línea
 * más abajo al construir la fila.
 *
 * Se leen los dos números por separado y se exige que existan los dos. Sin `st-cl-y` no hay
 * denominador, y un recuento de clutches sin saber cuántas situaciones hubo no es la
 * estadística que publica la fuente: en ese caso no se devuelve nada.
 */
function clutch(rowHtml: string): { clutchesWon?: number; clutchSituations?: number; clutchPct?: number } {
  const cell = /<td[^>]*data-col="cl"[^>]*>([\s\S]*?)<\/td>/i.exec(rowHtml)?.[1] ?? "";
  const won = num(/class="st-cl-x">\s*(\d+)\s*</i.exec(cell)?.[1]);
  const played = num(/class="st-cl-y">\s*(\d+)\s*</i.exec(cell)?.[1]);
  if (won === undefined || played === undefined) return {};
  const pctCell = /<td[^>]*data-col="clp"[^>]*>([\s\S]*?)<\/td>/i.exec(rowHtml)?.[1];
  return { clutchesWon: won, clutchSituations: played, clutchPct: num(textOf(pctCell ?? "")) };
}

/** Filas de la tabla de stats del evento. Filas sin jugador se ignoran (no se inventa nada). */
export function parseEventStats(html: string): VlrStatsRow[] {
  const body = html.slice(html.indexOf("<tbody"));
  const rows: VlrStatsRow[] = [];
  const rowStarts = findAll(/<tr>/g, body).map((m) => m.index);
  for (let i = 0; i < rowStarts.length; i++) {
    const row = body.slice(rowStarts[i], rowStarts[i + 1] ?? body.indexOf("</tbody>"));
    const player = /<a href="\/player\/(\d+)\/[a-z0-9-]*">([\s\S]*?)<\/a>/i.exec(row);
    if (!player || !row.includes("mod-player")) continue;
    const nick = textOf(/class="st-pl-name[^"]*">([\s\S]*?)<\/div>/i.exec(player[2])?.[1] ?? "");
    if (!nick) continue;
    const teamTag = textOf(/class="st-pl-country">([\s\S]*?)<\/div>/i.exec(player[2])?.[1] ?? "") || undefined;
    const country = flagCountry(/class="flag ([^"]+)"/.exec(player[2])?.[1]);
    const agents = findAll(/<img src="([^"]*\/agents\/[^"]+)"/gi, row)
      .map((m) => agentFromSrc(m[1]))
      .filter((a): a is string => !!a);
    const c = dataCols(row);
    rows.push({
      vlrPlayerId: player[1], nick, teamTag, country, agents: [...new Set(agents)],
      mapsPlayed: num(c.maps), roundsPlayed: num(c.rnd),
      rating: num(c.rating2), acs: num(c.acs), kd: num(c.kd), kast: num(c.kast), adr: num(c.adr),
      hsPct: num(c.hsp), kills: num(c.k), deaths: num(c.d), assists: num(c.a), fk: num(c.fk), fd: num(c.fd),
      ...clutch(row),
    });
  }
  return rows;
}
