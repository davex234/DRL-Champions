/**
 * PÁGINA DE PARTIDO (/{matchId}/{slug}) — mapas jugados + scoreboard por mapa.
 *
 * Parsing PURO. Markup real: timestamp UTC exacto (data-utc-ts), "Bo3" en match-header-vs-note,
 * un contenedor div.vm-stats-game[data-game-id] por mapa (el "all" agregado se ignora) con
 * cabecera (nombre del mapa, PICK, marcadores, mod-win) y DOS scoreboards (uno por equipo).
 *
 * VLR ha servido ese scoreboard con dos markups distintos, y aquí se leen LOS DOS:
 *
 *   · ACTUAL (div): div.ovw-table › div.ovw-row › div.ovw-cell[data-col]. Cada celda se
 *     identifica por NOMBRE (rating2/acs/kast/adr/hsp/fb/fd) y K/D/A viven en spans
 *     span.ovw-kda-stat[data-col] anidados. No hay <table> en la página.
 *   · LEGACY (tabla): table.wf-table-inset.mod-overview › tr › td.mod-stat, con el orden de
 *     columnas fijo R · ACS · K · D · A · +/- · KAST · ADR · HS% · FK · FD · +/-.
 *
 * En ambos, el valor "both sides" de una celda va en span.mod-both.
 *
 * Leer por NOMBRE (el markup actual) es lo que evita que un cambio de orden de columnas se
 * convierta en estadísticas silenciosamente equivocadas; el camino posicional se conserva solo
 * para el markup antiguo, que ya no distingue columnas de otra forma.
 */
import { textOf, findAll, num, sliceBetween, looseName } from "./parser";
import { agentFromSrc } from "./agents";
import type { VlrMap, VlrMapPlayerRow, VlrMatch } from "./types";

/** Detalle extraído de la página de un partido. */
export interface VlrMatchDetail {
  utcTs?: string;
  bestOf?: number;
  maps: VlrMap[];
  /** Equipos de la cabecera con su id de VLR (complementa a la página del evento). */
  teamRefs: { name: string; vlrId: string }[];
}

/** Valor "both sides" de una celda mod-stat ("1.60", "72%", "+12"). */
const bothValue = (td: string): string =>
  textOf(/class="side(?: mod-side)? mod-both[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(td)?.[1] ?? "");

/**
 * Trozos de `html` que empiezan en cada aparición de `marker`. Los bloques del markup actual son
 * <div> cuyo cierre no se puede localizar con regex, así que se delimitan por el siguiente inicio.
 */
function blocksFrom(html: string, marker: string): string[] {
  const starts: number[] = [];
  for (let i = html.indexOf(marker); i >= 0; i = html.indexOf(marker, i + marker.length)) starts.push(i);
  return starts.map((start, i) => html.slice(start, starts[i + 1] ?? html.length));
}

/** Identidad del jugador de una fila (sirve para los dos markups). */
function rowPlayer(row: string): { vlrPlayerId: string; nick: string; teamTag?: string } | undefined {
  const link = /<a href="\/player\/(\d+)\/[a-z0-9-]*">([\s\S]*?)<\/a>/i.exec(row);
  if (!link) return undefined;
  // Actual: div.ovw-player-name.text-of + div.ovw-player-tag. Legacy: div.text-of + div.ge-text-light.
  const nick = textOf(/class="[^"]*text-of[^"]*">([\s\S]*?)<\/div>/i.exec(link[2])?.[1] ?? "");
  if (!nick) return undefined;
  const teamTag = textOf(
    /class="[^"]*(?:ovw-player-tag|ge-text-light)[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(link[2])?.[1] ?? "",
  ) || undefined;
  return { vlrPlayerId: link[1], nick, teamTag };
}

/** Primer agente de la fila (los dos markups usan /img/vlr/game/agents/{slug}.png). */
function rowAgent(row: string): string | undefined {
  return findAll(/<img src="([^"]*\/agents\/[^"]+)"/gi, row)
    .map((m) => agentFromSrc(m[1]))
    .find((a): a is string => !!a);
}

/**
 * Valores por `data-col` de una fila del markup ACTUAL. Cada `data-col` abre un tramo que llega
 * hasta el siguiente, y el valor es el primer span.mod-both de ese tramo. Así K/D/A —anidados
 * dentro de la celda mod-kda— se leen igual que el resto: por NOMBRE, no por posición.
 */
function ovwCols(row: string): Record<string, string> {
  const marks = findAll(/data-col="([a-z0-9-]+)"/gi, row);
  const out: Record<string, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const key = marks[i][1];
    if (key in out) continue;
    const value = bothValue(row.slice(marks[i].index, marks[i + 1]?.index ?? row.length));
    if (value) out[key] = value;
  }
  return out;
}

/** Filas de un scoreboard (un equipo en un mapa). Acepta el markup actual y el legacy. */
function parseScoreboard(tableHtml: string, tableIdx: number): VlrMapPlayerRow[] {
  const rows: VlrMapPlayerRow[] = [];

  // ── Markup ACTUAL (div.ovw-row). La cabecera (ovw-row mod-head) no lleva jugador: se descarta sola.
  const ovwRows = blocksFrom(tableHtml, '<div class="ovw-row">');
  if (ovwRows.length) {
    for (const row of ovwRows) {
      const player = rowPlayer(row);
      if (!player) continue;
      const c = ovwCols(row);
      rows.push({
        ...player, tableIdx, agent: rowAgent(row),
        rating: num(c.rating2), acs: num(c.acs), kills: num(c.kills), deaths: num(c.deaths),
        assists: num(c.assists), kast: num(c.kast), adr: num(c.adr), hsPct: num(c.hsp),
        // La columna de first kills se llama "fb" en la página de partido y "fk" en la del evento.
        fk: num(c.fb ?? c.fk), fd: num(c.fd),
      });
    }
    return rows;
  }

  // ── Markup LEGACY (<tr> con td.mod-stat en orden fijo):
  // 0 R · 1 ACS · 2 K · 3 D · 4 A · 5 +/- · 6 KAST · 7 ADR · 8 HS% · 9 FK · 10 FD · 11 +/-
  for (const tr of findAll(/<tr>([\s\S]*?)<\/tr>/g, tableHtml)) {
    const row = tr[1];
    const player = rowPlayer(row);
    if (!player) continue;
    const cells = findAll(/<td class="mod-stat[^"]*"[^>]*>([\s\S]*?)<\/td>/gi, row).map((m) => bothValue(m[1]));
    rows.push({
      ...player, tableIdx, agent: rowAgent(row),
      rating: num(cells[0]), acs: num(cells[1]), kills: num(cells[2]), deaths: num(cells[3]),
      assists: num(cells[4]), kast: num(cells[6]), adr: num(cells[7]), hsPct: num(cells[8]),
      fk: num(cells[9]), fd: num(cells[10]),
    });
  }
  return rows;
}

/**
 * Los dos scoreboards de un mapa (uno por equipo), en el orden en que aparecen en la página.
 * Prefiere el markup ACTUAL (div.ovw-table) y cae al LEGACY (table.mod-overview) si no lo hay.
 */
function scoreboardsOf(block: string): string[] {
  const ovw = blocksFrom(block, '<div class="ovw-table">');
  if (ovw.length) return ovw;
  return findAll(/<table class="wf-table-inset mod-overview">([\s\S]*?)<\/table>/g, block).map((m) => m[1]);
}

interface HeaderSide { name?: string; score?: number; won: boolean }

/** Cabecera de un mapa: nombre, PICK y los dos lados con marcador. */
function parseMapHeader(block: string): { mapName?: string; pickedSide?: 1 | 2; left: HeaderSide; right: HeaderSide } {
  const header = sliceBetween(block, 'class="vm-stats-game-header"', 'class="vlr-rounds') ?? block;
  const mapDiv = sliceBetween(header, '<div class="map">', "</div>") ?? "";
  const rawName = mapDiv.split('<span class="picked')[0];
  const mapName = textOf(rawName.replace(/<div[^>]*>/g, " ")) || undefined;
  const pickedM = /class="picked mod-(\d)/.exec(header);
  const side = (teamBlock: string): HeaderSide => ({
    name: textOf(/class="team-name">([\s\S]*?)<\/div>/i.exec(teamBlock)?.[1] ?? "") || undefined,
    score: num(textOf(/class="score[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(teamBlock)?.[1] ?? "")),
    won: /class="score mod-win/.test(teamBlock),
  });
  const rightAt = header.indexOf('class="team mod-right"');
  const leftBlock = rightAt >= 0 ? header.slice(0, rightAt) : header;
  const rightBlock = rightAt >= 0 ? header.slice(rightAt) : "";
  return {
    mapName,
    pickedSide: pickedM ? ((+pickedM[1] === 2 ? 2 : 1) as 1 | 2) : undefined,
    left: side(leftBlock),
    right: side(rightBlock),
  };
}

/**
 * Parsea la página de detalle de un partido. Los marcadores por mapa se ALINEAN a
 * `match.teamA/teamB` comparando nombres (nunca se asume el lado izquierdo a ciegas salvo
 * que los nombres no casen, en cuyo caso izquierda=A, que es el orden que usa VLR).
 */
export function parseMatchPage(html: string, match: Pick<VlrMatch, "teamA" | "teamB">): VlrMatchDetail {
  const utcTs = /data-utc-ts="(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)"/.exec(html)?.[1];
  const boM = /class="match-header-vs-note">\s*Bo(\d)\s*</i.exec(html);
  const teamRefs = findAll(
    /<a class="match-header-link[^"]*"[^>]*href="\/team\/(\d+)\/[a-z0-9-]*"[^>]*>([\s\S]*?)<\/a>/g,
    html,
  ).map((m) => ({
    vlrId: m[1],
    name: textOf(/class="wf-title-med[^"]*">([\s\S]*?)<\/div>/i.exec(m[2])?.[1] ?? ""),
  })).filter((t) => t.name.length > 0);
  // El agregado "All Maps" (data-game-id="all") delimita bloques pero NO es un mapa.
  const containers = findAll(/<div class="vm-stats-game[^"]*" data-game-id="(\d+|all)">/g, html);
  const maps: VlrMap[] = [];
  let order = 0;
  for (let i = 0; i < containers.length; i++) {
    if (containers[i][1] === "all") continue;
    const start = containers[i].index;
    const end = containers[i + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const h = parseMapHeader(block);
    const playerStats = scoreboardsOf(block).flatMap((t, idx) => parseScoreboard(t, idx));
    // Alineación izquierda/derecha → teamA/teamB del partido por nombre. Si los nombres no
    // casan, izquierda = A (el orden que usa VLR en cabecera y listado es el mismo).
    const leftIsB = looseName(h.left.name) === looseName(match.teamB) || looseName(h.right.name) === looseName(match.teamA);
    const leftIsA = !leftIsB;
    const a = leftIsA ? h.left : h.right;
    const b = leftIsA ? h.right : h.left;
    const winner = h.left.won ? h.left.name : h.right.won ? h.right.name : undefined;
    const pickedBy = h.pickedSide === 1 ? h.left.name : h.pickedSide === 2 ? h.right.name : undefined;
    // tableIdx pasa a ser SIEMPRE relativo a teamA/teamB del partido (0=A, 1=B), no al HTML.
    const aligned = leftIsA ? playerStats : playerStats.map((r) => ({ ...r, tableIdx: r.tableIdx === 0 ? 1 : 0 }));
    order++;
    maps.push({
      gameId: containers[i][1],
      name: h.mapName,
      order,
      scoreA: a.score,
      scoreB: b.score,
      winner,
      pickedBy,
      playerStats: aligned,
    });
  }
  return { utcTs, bestOf: boM ? +boM[1] : undefined, maps, teamRefs };
}
