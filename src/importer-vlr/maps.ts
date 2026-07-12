/**
 * PÁGINA DE PARTIDO (/{matchId}/{slug}) — mapas jugados + scoreboard por mapa.
 *
 * Parsing PURO. Markup real: timestamp UTC exacto (data-utc-ts), "Bo3" en match-header-vs-note,
 * un contenedor div.vm-stats-game[data-game-id] por mapa (el "all" agregado se ignora) con
 * cabecera (nombre del mapa, PICK, marcadores, mod-win) y dos tablas mod-overview (una por
 * equipo) cuyas celdas mod-stat llevan el valor "both sides" en span.mod-both. El orden de
 * columnas del scoreboard de VLR es fijo: R · ACS · K · D · A · +/- · KAST · ADR · HS% · FK · FD · +/-.
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

/** Filas de una tabla de scoreboard (un equipo en un mapa). */
function parseScoreboard(tableHtml: string, tableIdx: number): VlrMapPlayerRow[] {
  const rows: VlrMapPlayerRow[] = [];
  for (const tr of findAll(/<tr>([\s\S]*?)<\/tr>/g, tableHtml)) {
    const row = tr[1];
    const player = /<a href="\/player\/(\d+)\/[a-z0-9-]*">([\s\S]*?)<\/a>/i.exec(row);
    if (!player) continue;
    const nick = textOf(/class="text-of">([\s\S]*?)<\/div>/i.exec(player[2])?.[1] ?? "");
    if (!nick) continue;
    const teamTag = textOf(/class="ge-text-light"[^>]*>([\s\S]*?)<\/div>/i.exec(player[2])?.[1] ?? "") || undefined;
    const agent = findAll(/<img src="([^"]*\/agents\/[^"]+)"/gi, row)
      .map((m) => agentFromSrc(m[1]))
      .find((a): a is string => !!a);
    // Orden fijo de VLR: 0 R · 1 ACS · 2 K · 3 D · 4 A · 5 +/- · 6 KAST · 7 ADR · 8 HS% · 9 FK · 10 FD · 11 +/-
    const cells = findAll(/<td class="mod-stat[^"]*"[^>]*>([\s\S]*?)<\/td>/gi, row).map((m) => bothValue(m[1]));
    rows.push({
      vlrPlayerId: player[1], nick, teamTag, tableIdx, agent,
      rating: num(cells[0]), acs: num(cells[1]), kills: num(cells[2]), deaths: num(cells[3]),
      assists: num(cells[4]), kast: num(cells[6]), adr: num(cells[7]), hsPct: num(cells[8]),
      fk: num(cells[9]), fd: num(cells[10]),
    });
  }
  return rows;
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
    const tables = findAll(/<table class="wf-table-inset mod-overview">([\s\S]*?)<\/table>/g, block);
    const playerStats = tables.flatMap((t, idx) => parseScoreboard(t[1], idx));
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
