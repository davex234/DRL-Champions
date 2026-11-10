/**
 * VERIFICACIÓN DEL CONECTOR VLR (Tournament Automation · Fase 1/5).
 *
 * 100% OFFLINE y determinista: las "páginas de VLR" son fixtures HTML con el markup REAL de
 * vlr.gg (validado contra páginas reales de un evento internacional) servidas por un `VlrFetcher`
 * inyectado — cero red, apto para CI. Comprueba: URL · tournamentId · torneo · equipos ·
 * jugadores · estadísticas · RawSnapshot válido · determinismo · rendimiento · compatibilidad
 * con el Importer · cero estados imposibles. NO genera cartas ni OVR ni rarezas.
 */
import {
  importVlrTournament, vlrSnapshotToModel, createVlrProvider, parseVlrUrl, parseEventLinks,
  parseVlrDates, utcTsToIso, num, agentName,
  type VlrFetcher,
} from "@/importer-vlr";
import type { RawSnapshot } from "@/importer";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// ════════════════════════════════ FIXTURES (markup real de vlr.gg) ════════════════════════════════

const EVENT_URL = "https://www.vlr.gg/event/2765/valorant-masters-london-2026";
const STATS_URL = "https://www.vlr.gg/event/stats/2765/valorant-masters-london-2026";
const MATCHES_URL = "https://www.vlr.gg/event/matches/2765/valorant-masters-london-2026/?series_id=all";
const M1_URL = "https://www.vlr.gg/900001/london-lions-vs-madrid-wolves-valorant-masters-london-2026-gf";
const M2_URL = "https://www.vlr.gg/900002/london-lions-vs-berlin-bears-valorant-masters-london-2026-sf";

const LIONS = ["Lion1", "Lion2", "Lion3", "Lion4", "Lion5"];
const WOLVES = ["Wolf1", "Wolf2", "Wolf3", "Wolf4", "Wolf5"];

const rosterItem = (id: number, nick: string, cc: string, first: boolean): string => `
<a href="/player/${id}/${nick.toLowerCase()}" class="wf-module-item ${first ? "mod-first " : " "}event-team-players-item">
<i class="flag mod-${cc}" style="margin-right: 3px;"></i>
${nick}</a>`;

const teamCard = (teamId: number, slug: string, name: string, players: string[], cc: string, baseId: number): string => `
<div class="wf-card event-team">
<a class="wf-module-item event-team-name" href="/team/${teamId}/${slug}">

${name}</a>
<div class="event-team-players">
<div class="event-team-players-mask"><img src="//owcdn.net/img/x.png" class="event-team-players-mask-team"></div>
${players.map((p, i) => rosterItem(baseId + i, p, cc, i === 0)).join("")}
</div>
<div class="event-team-note wf-module-item">
<a href="${EVENT_URL}/playoffs">Seed #${teamId % 10}</a>
</div>
</div>`;

/**
 * Fila de la tabla «Prize Distribution» con el markup REAL de vlr.gg: puesto con `<sup>`,
 * nombre dentro de un `div.text-of` que TAMBIÉN contiene la región, y un `<a>` comentado con
 * un valor viejo en la celda de puntos. Las tres trampas del markup real, en el fixture.
 */
const placeRow = (place: string, prize: string, teamId: number, slug: string, name: string, points?: string): string => `
<div class="row " role="row">
  <div class="cell" role="cell" style="white-space: nowrap;">${place}</div>
  <div class="cell" role="cell" style="justify-content: flex-end">${prize}</div>
  <div class="cell mod-team" role="cell" style="">
    <a href="/team/${teamId}/${slug}" style="display: flex;">
      <img src="//owcdn.net/img/x.png" style="width: 25px; height: 25px;">
      <div style="margin-left: 12px;" class="text-of">${name}<div class="ge-text-light">Europe</div></div>
    </a>
    <div class="event-standings-spoiler">Spoiler hidden</div>
  </div>
  <div class="cell" role="cell" style="position: relative;">
    <!--<a href="/vct/standings"><span>+</span>999</a>-->
    ${points ? `<div style="color: var(--ncolor-text-link)"><span style="font-weight: 400;">+</span>${points}</div>` : ""}
  </div>
</div>`;

const EVENT_HTML = `<!DOCTYPE html>
<html><head><title>Valorant Masters London 2026 | VLR.gg</title></head><body>
<div class="event-header" style="overflow: hidden;">
<div class="event-header-main">
<div class="event-header-main-bc">

<a href="/vct-2026" style="white-space: nowrap;">Valorant Champions Tour 2026</a>

<div class="event-header-main-bc-tags"></div>
</div>
<h1 class="event-header-main-title">
Valorant Masters London 2026
</h1>

<h2 class="event-header-main-desc">
The second international event of the 2026 season</h2>

<div class="event-header-main-meta" style="flex: 1 1 0;">
<div>
<div class="ge-text-light label">
Dates
</div>
<div class="value" style="white-space: nowrap;">
Jun 5–21, 2026
</div>
</div>
<div>
<div class="ge-text-light label">
Prize
</div>
<div class="value">
$1,000,000</div>
</div>
<div style="flex: 1 1 0; min-width: 0;">
<div class="ge-text-light label">
Location
</div>
<div class="value" style="white-space: nowrap;">
<i class="flag mod-gb zx-m-hidden" style="vertical-align: -4px;"></i>
Copper Box Arena, London</div>
</div>
</div>
</div>
</div>
<div class="wf-label mod-large">
Prize Distribution
</div>
<div class="wf-card mod-dark" style="margin-bottom: 30px; ">
<div class="wf-ptable wf-ptable--standings" role="table" style="overflow-x: auto">
  <div class="row" role="row">
    <div class="cell" role="cell">Place</div>
    <div class="cell" role="cell" style="justify-content: flex-end;">Prize</div>
    <div class="cell" role="cell">Team</div>
    <div class="cell" role="cell" title="Circuit Points">Points</div>
  </div>
  ${placeRow("1<sup>st</sup>", "$400,000", 701, "london-lions", "London Lions", "8")}
  ${placeRow("2<sup>nd</sup>", "$200,000", 702, "madrid-wolves", "Madrid Wolves", "6")}
  ${placeRow("3<sup>rd</sup>&ndash;4<sup>th</sup>", "$90,000", 703, "berlin-bears", "Berlin Bears")}
</div>
</div>
<div class="event-teams-container" style="margin-bottom: 30px;">
${teamCard(701, "london-lions", "London Lions", LIONS, "gb", 9001)}
${teamCard(702, "madrid-wolves", "Madrid Wolves", WOLVES, "es", 9011)}
</div>
</body></html>`;

// Página de stats: fila por jugador con data-col (markup real). El jugador 11 ("Extra", sub de
// LLN) NO está en ningún roster: ejercita el camino stats-only + tag→equipo.
const statsRow = (id: number, nick: string, tag: string, cc: string, agents: string[], i: number): string => `
<tr>
<td class="mod-player mod-a">
<a href="/player/${id}/${nick.toLowerCase()}">
<i class="flag mod-${cc}"></i>
<div class="st-pl-meta">
<div class="st-pl-name text-of">${nick}</div>
<div class="st-pl-country">${tag}</div></div>
</a>
</td>
<td class="mod-agents" data-col="agents">
<div>${agents.map((a) => `<span class="st-agent"><img src="/img/vlr/game/agents/${a}.png"><span class="st-agent-n">50%</span></span>`).join("")}</div>
</td>
<td data-col="maps">2</td><td data-col="rnd">${40 + i}</td><td class="mod-color-sq" data-col="rating2" title="R">1.${10 + i}</td><td class="mod-color-sq" data-col="acs" title="ACS">${200 + i * 7}</td><td class="mod-color-sq" data-col="kd" title="K:D">1.${20 + i}</td><td class="mod-color-sq" data-col="kast" title="KAST">${70 + i}%</td><td class="mod-color-sq" data-col="adr" title="ADR">${140 + i}.5</td><td class="mod-color-sq" data-col="kpr" title="KPR">0.8${i}</td><td class="mod-color-sq" data-col="apr" title="APR">0.2${i}</td><td class="mod-color-sq" data-col="fkfd" title="FK:FD">1.${i}</td><td class="mod-color-sq" data-col="fbpr" title="FKPR">0.0${i}</td><td class="mod-color-sq" data-col="fdpr" title="FDPR">0.0${i}</td><td class="mod-color-sq" data-col="hsp" title="HS%">${20 + i}%</td><td class="mod-color-sq" data-col="clp" title="CL%">1${i}%</td><td data-col="cl"><span class="st-cl"><span class="st-cl-x">${i}</span>/<span class="st-cl-y">10</span></span></td><td class="mod-a mod-kmax" data-col="kmax"><a href="/900001/x/?game=777001">2${i}</a></td><td data-col="k">${30 + i * 2}</td><td data-col="d">${20 + i}</td><td data-col="a">${8 + i}</td><td data-col="fk">${4 + i}</td><td data-col="fd">${2 + i}</td></tr>`;

const STATS_HTML = `<!DOCTYPE html>
<html><body>
<table class="wf-table mod-stats st-table mod-hide-maps">
<thead><tr><th>Player</th></tr></thead>
<tbody>
${LIONS.map((p, i) => statsRow(9001 + i, p, "LLN", "gb", ["jett", "kayo"], i)).join("")}
${WOLVES.map((p, i) => statsRow(9011 + i, p, "MWV", "es", ["omen", "sova"], 5 + i)).join("")}
${statsRow(9021, "Extra", "LLN", "fr", ["viper"], 10)}
</tbody>
</table>
</body></html>`;

const matchItem = (path: string, time: string, a: string, aFlag: string, sa: number, b: string, bFlag: string, sb: number, aWins: boolean, series: string, stage: string, first: boolean): string => `
<a href="${path}" class="wf-module-item match-item mod-color${first ? " mod-first" : ""}">

<div class="match-item-time">
${time}</div>

<div class="match-item-vs">
<div class="match-item-vs-team${aWins ? " mod-winner" : " "}">
<div class="match-item-vs-team-name">
<div class="text-of">
<span class="flag mod-${aFlag}"></span>
${a}</div>
</div>
<div class="match-item-vs-team-score  js-spoiler ">
${sa}</div>
</div>
<div class="match-item-vs-team${aWins ? " " : " mod-winner"}">
<div class="match-item-vs-team-name">
<div class="text-of">
<span class="flag mod-${bFlag}"></span>
${b}</div>
</div>
<div class="match-item-vs-team-score  js-spoiler ">
${sb}</div>
</div>
</div>

<div class="match-item-eta">
<div class="ml mod-completed">
<div class="ml-status">Completed</div>
<div class="ml-eta mod-completed">1d</div>
</div>
</div>

<div class="match-item-event text-of">
<div class="match-item-event-series text-of">
${series}</div>
${stage}</div>
</a>`;

const MATCHES_HTML = `<!DOCTYPE html>
<html><body>
<div class="wf-label mod-large">
Sat, June 20, 2026
</div>
<div class="wf-card" style="margin-bottom: 30px;">
${matchItem("/900002/london-lions-vs-berlin-bears-valorant-masters-london-2026-sf", "3:00 PM", "London Lions", "gb", 2, "Berlin Bears", "de", 1, true, "Semifinal", "Playoffs", true)}
</div>
<div class="wf-label mod-large">
Sun, June 21, 2026
</div>
<div class="wf-card" style="margin-bottom: 30px;">
${matchItem("/900001/london-lions-vs-madrid-wolves-valorant-masters-london-2026-gf", "5:00 PM", "London Lions", "gb", 2, "Madrid Wolves", "es", 0, true, "Grand Final", "Playoffs", true)}
</div>
</body></html>`;

// Página de detalle del partido 900001: cabecera con /team/{id}, Bo3, contenedor "all" (que debe
// IGNORARSE) + 2 mapas con scoreboards completos (markup real de celdas mod-stat/mod-both).
const sbRow = (id: number, nick: string, tag: string, cc: string, agent: string, i: number): string => `
<tr>
<td class="mod-player" style="padding-right: 10px;">
<div style="display: flex;">
<i class="flag mod-${cc}" style="opacity: .7;"></i>
<a href="/player/${id}/${nick.toLowerCase()}">
<div style="font-weight: 700;" class="text-of">
${nick}
</div>
<div class="ge-text-light" style="text-transform: uppercase; font-size: 11px;">
${tag}</div>
</a>
</div>
</td>
<td class="mod-agents">
<div style="white-space: nowrap;">
<span class="stats-sq mod-agent small"><img src="/img/vlr/game/agents/${agent}.png" alt="${agent}" title="${agentName(agent)}"></span>
</div>
</td>
<td class="mod-stat"><span class="stats-sq" style="width: 36px;"><span class="side mod-side mod-both">1.${10 + i}</span><span class="side mod-side mod-t">1.2</span><span class="side mod-side mod-ct">1.0</span></span></td>
<td class="mod-stat"><span class="stats-sq" style="width: 36px;"><span class="side mod-side mod-both">${210 + i * 5}</span><span class="side mod-side mod-t">220</span><span class="side mod-side mod-ct">200</span></span></td>
<td class="mod-stat mod-vlr-kills"><span class="stats-sq"><span class="side mod-side mod-both">${15 + i}</span><span class="side mod-side mod-t">8</span><span class="side mod-side mod-ct">7</span></span></td>
<td class="mod-stat mod-vlr-deaths"><span class="stats-sq"><span class="num-space">/</span><span style="margin: 0 4px;"><span class="side mod-both">${10 + i}</span><span class="side mod-t">5</span><span class="side mod-ct">5</span></span><span class="num-space">/</span></span></td>
<td class="mod-stat mod-vlr-assists"><span class="stats-sq"><span class="side mod-both">${3 + i}</span><span class="side mod-t">2</span><span class="side mod-ct">1</span></span></td>
<td class="mod-stat mod-kd-diff"><span class="stats-sq" style="width: 32px;"><span class="side mod-both mod-positive">+${5 - i}</span></span></td>
<td class="mod-stat"><span class="stats-sq" style="width: 38px;"><span class="side mod-side mod-both">${68 + i}%</span></span></td>
<td class="mod-stat"><span class="stats-sq" style="width: 38px;"><span class="side mod-side mod-both">${150 + i}.0</span></span></td>
<td class="mod-stat"><span class="stats-sq" style="width: 34px;"><span class="side mod-side mod-both">${22 + i}%</span></span></td>
<td class="mod-stat mod-fb"><span class="stats-sq"><span class="side mod-both">${2 + (i % 3)}</span></span></td>
<td class="mod-stat mod-fd"><span class="stats-sq"><span class="side mod-both">${1 + (i % 2)}</span></span></td>
<td class="mod-stat"><span class="stats-sq"><span class="side mod-both mod-positive">+1</span></span></td>
</tr>`;

const sbTable = (rows: string): string => `
<div>
<table class="wf-table-inset mod-overview">
<thead><tr><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;

/** Los dos scoreboards (local, visitante) con el markup en <table> de siempre. */
const legacyScoreboards = (): string =>
  sbTable(LIONS.map((p, i) => sbRow(9001 + i, p, "LLN", "gb", i === 0 ? "jett" : "kayo", i)).join(""))
  + "\n" + sbTable(WOLVES.map((p, i) => sbRow(9011 + i, p, "MWV", "es", i === 0 ? "omen" : "sova", 5 + i)).join(""));

const mapBlock = (gameId: string, mapName: string, sLeft: number, sRight: number, pickedMod: 1 | 2, scoreboards: string = legacyScoreboards()): string => `
<div class="vm-stats-game " data-game-id="${gameId}">
<div class="vm-stats-game-header">
<div class="team">
<div class="score${sLeft > sRight ? " mod-win" : " "}" style="margin-right: 12px;">${sLeft} </div>
<div >
<div class="team-name">
London Lions</div>
<span class="mod-ct">7</span> /
<span class="mod-t">6</span>
</div>
</div>
<div class="map">
<div style="font-weight: 700; font-size: 20px; text-align: center;">
<span style="position: relative;">
${mapName}<span class="picked mod-${pickedMod} ge-text-light">
PICK
</span>
</span>
</div>
<div class="map-duration ge-text-light" style="text-align: center;">
48:0${pickedMod}
</div>
</div>
<div class="team mod-right">
<div >
<div class="team-name">
Madrid Wolves</div>
<span class="mod-t">4</span> /
<span class="mod-ct">3</span>
</div>
<div class="score${sRight > sLeft ? " mod-win" : " "}" style="margin-left: 8px;">${sRight}</div>
</div>
</div>
<div style="text-align: center; margin-top: 15px;">
<div class="vlr-rounds">
<div class="vlr-rounds-row"><div class="vlr-rounds-row-col"><div class="team"><img src="//x.png">LLN</div></div></div>
</div>
</div>
${scoreboards}
</div>`;

const MATCH1_HTML = `<!DOCTYPE html>
<html><body>
<div class="match-header">
<div class="match-header-super">
<div class="match-header-date">
<div class="moment-tz-convert" data-utc-ts="2026-06-21 16:00:00" data-moment-format="MMMM D, YYYY">June 21, 2026</div>
</div>
</div>
<div class="match-header-vs">
<a class="match-header-link wf-link-hover mod-1"  href="/team/701/london-lions" >
<div class="match-header-link-name mod-1">
<div class="wf-title-med mod-single">
London Lions</div>
</div>
<img src="//owcdn.net/img/a.png" alt="London Lions team logo">
</a>
<div class="match-header-vs-score">
<div class="match-header-vs-note">
final
</div>
<div class="match-header-vs-score">
<div class="js-spoiler "><span class="match-header-vs-score-winner">2</span><span class="match-header-vs-score-colon">:</span><span class="match-header-vs-score-loser">0</span></div>
</div>
<div class="match-header-vs-note">
Bo3</div>
</div>
<a class="match-header-link wf-link-hover mod-2"  href="/team/702/madrid-wolves" >
<img src="//owcdn.net/img/b.png" alt="Madrid Wolves team logo">
<div class="match-header-link-name mod-2">
<div class="wf-title-med mod-single">
Madrid Wolves</div>
</div>
</a>
</div>
<div class="match-header-note">
MWV ban Icebox; LLN pick Ascent; MWV pick Bind; Haven remains</div>
</div>
<div class="vm-stats-container">
<div class="vm-stats-game mod-active" data-game-id="all">
${sbTable(LIONS.map((p, i) => sbRow(9001 + i, p, "LLN", "gb", "jett", i)).join(""))}
${sbTable(WOLVES.map((p, i) => sbRow(9011 + i, p, "MWV", "es", "omen", 5 + i)).join(""))}
</div>
${mapBlock("777001", "Ascent", 13, 7, 1)}
${mapBlock("777002", "Bind", 13, 11, 2)}
</div>
</body></html>`;

/*
 * ─────────────────────── MARKUP ACTUAL DEL SCOREBOARD (div.ovw-*) ───────────────────────
 *
 * Todo lo de arriba usa el markup de scoreboard en <table> (mod-overview). vlr.gg lo sustituyó
 * por uno de <div> —no queda ni un <table> en la página de partido— y como estas verificaciones
 * son 100% offline, siguieron en verde mientras el conector real devolvía CERO filas de
 * scoreboard. El pipeline entero terminaba correctamente con todas las métricas por jugador a
 * cero: sin líderes, sin premios y sin cartas de rendimiento.
 *
 * Este bloque fija el markup ACTUAL, copiado de una página real de vlr.gg (los nombres y los
 * números son de fixture; la ESTRUCTURA es la de la página). Las celdas se identifican por
 * `data-col` —no por posición— y K/D/A van anidados en spans ovw-kda-stat.
 */
const OVW_COLS = ["rating2", "acs", "kd-diff", "kast", "adr", "hsp", "fb", "fd", "fk-diff"] as const;

const ovwCell = (col: string, value: string): string =>
  `<div class="ovw-cell" data-col="${col}"><span class="stats-sq"><span class="side mod-both">${value}</span><span class="side mod-t">0</span><span class="side mod-ct">0</span></span></div>`;

const ovwKda = (k: number, d: number, a: number): string =>
  `<div class="ovw-cell mod-kda"><span class="stats-sq mod-kda">`
  + `<span class="ovw-kda-stat" data-col="kills"><span class="side mod-both">${k}</span><span class="side mod-t">0</span></span><span class="num-space">/</span>`
  + `<span class="ovw-kda-stat" data-col="deaths"><span class="side mod-both">${d}</span><span class="side mod-t">0</span></span><span class="num-space">/</span>`
  + `<span class="ovw-kda-stat" data-col="assists"><span class="side mod-both">${a}</span><span class="side mod-t">0</span></span>`
  + `</span></div>`;

/** Una fila del scoreboard actual. El orden de las celdas se altera a propósito (ver más abajo). */
const ovwRow = (id: number, nick: string, tag: string, cc: string, agent: string, i: number): string => `
<div class="ovw-row">
<div class="ovw-cell mod-player">
<div class="ovw-player">
<i class="flag mod-${cc}" title="País"></i>
<a href="/player/${id}/${nick.toLowerCase()}">
<div class="ovw-player-name text-of">${nick}</div>
<div class="ovw-player-tag ge-text-light">${tag}</div>
</a>
</div>
<div class="ovw-agents">
<span class="stats-sq mod-agent small"><img src="/img/vlr/game/agents/${agent}.png" alt="${agent}" title="${agentName(agent)}"></span>
</div>
</div>
${ovwCell("rating2", `1.${10 + i}`)}
${ovwCell("acs", String(210 + i * 5))}
${ovwKda(15 + i, 10 + i, 3 + i)}
${ovwCell("kd-diff", `+${5 - i}`)}
${ovwCell("kast", `${68 + i}%`)}
${ovwCell("adr", `${150 + i}.0`)}
${ovwCell("hsp", `${22 + i}%`)}
${ovwCell("fb", String(2 + (i % 3)))}
${ovwCell("fd", String(1 + (i % 2)))}
${ovwCell("fk-diff", "+1")}
</div>`;

const ovwTable = (rows: string): string => `
<div class="ovw-scroll-wrap"><div class="ovw-scroll js-drag-scroll"><div class="ovw-table">
<div class="ovw-row mod-head">
<div class="ovw-th"></div>
${OVW_COLS.map((c) => `<div class="ovw-th ovw-sort js-ovw-sort" data-col="${c}">${c}</div>`).join("")}
</div>
${rows}
</div></div></div>`;

/** Los dos scoreboards con el markup ACTUAL (div.ovw-table). */
const ovwScoreboards = (): string =>
  ovwTable(LIONS.map((p, i) => ovwRow(9001 + i, p, "LLN", "gb", i === 0 ? "jett" : "kayo", i)).join(""))
  + "\n" + ovwTable(WOLVES.map((p, i) => ovwRow(9011 + i, p, "MWV", "es", i === 0 ? "omen" : "sova", 5 + i)).join(""));

/** Página de partido idéntica a MATCH1 salvo en el markup del scoreboard (div en vez de tabla). */
const MATCH1_OVW_HTML = MATCH1_HTML
  .replace(mapBlock("777001", "Ascent", 13, 7, 1), mapBlock("777001", "Ascent", 13, 7, 1, ovwScoreboards()))
  .replace(mapBlock("777002", "Bind", 13, 11, 2), mapBlock("777002", "Bind", 13, 11, 2, ovwScoreboards()));

/** La misma página SIN ningún scoreboard: mapas sí, filas no (el fallo silencioso a detectar). */
const MATCH1_NO_SB_HTML = MATCH1_HTML
  .replace(mapBlock("777001", "Ascent", 13, 7, 1), mapBlock("777001", "Ascent", 13, 7, 1, ""))
  .replace(mapBlock("777002", "Bind", 13, 11, 2), mapBlock("777002", "Bind", 13, 11, 2, ""));

const EVENTS_LIST_HTML = `<html><body>
<a href="/event/2765/valorant-masters-london-2026" class="wf-card"></a>
<a href="/event/2800/challengers-spain-split-2" class="wf-card"></a>
</body></html>`;

const PAGES: Record<string, string> = {
  [EVENT_URL]: EVENT_HTML,
  [STATS_URL]: STATS_HTML,
  [MATCHES_URL]: MATCHES_HTML,
  [M1_URL]: MATCH1_HTML,
  "https://www.vlr.gg/events": EVENTS_LIST_HTML,
  "https://www.vlr.gg/event/2765": EVENT_HTML,
  "https://www.vlr.gg/event/stats/2765": STATS_HTML,
  "https://www.vlr.gg/event/matches/2765/?series_id=all": MATCHES_HTML,
};

let fetchCount = 0;
const fetcher: VlrFetcher = async (url: string) => {
  fetchCount++;
  const page = PAGES[url];
  // El partido 900002 "falla" a propósito: ejercita la degradación por-partido (warning, sin abortar).
  if (!page) throw new Error(`fixture no disponible: ${url}`);
  return page;
};

// ════════════════════════════════════════ VERIFICACIÓN ════════════════════════════════════════

async function main(): Promise<void> {
  console.log("# Verificación del Conector VLR — DRL Champions\n");

  // 1) URL VÁLIDA
  console.log("## 1. URL válida → tournamentId + slug");
  const r1 = parseVlrUrl(EVENT_URL);
  const r2 = parseVlrUrl(STATS_URL);
  const r3 = parseVlrUrl("vlr.gg/event/2765");
  check("URL de evento → {eventId, slug}", r1?.eventId === "2765" && r1?.slug === "valorant-masters-london-2026");
  check("URL de /event/stats/ → mismo torneo", r2?.eventId === "2765" && r2?.slug === r1?.slug);
  check("URL sin esquema ni slug también resuelve", r3?.eventId === "2765" && r3?.slug === undefined);
  check("URLs ajenas rechazadas (cero estados imposibles)",
    parseVlrUrl("https://google.com/event/123/x") === undefined
    && parseVlrUrl("https://www.vlr.gg/rankings") === undefined
    && parseVlrUrl("no-es-una-url") === undefined);

  // Import completo con fixtures (offline)
  const out = await importVlrTournament(EVENT_URL, { fetcher });
  const snap: RawSnapshot = out.snapshot;

  // 2) TORNEO
  console.log("\n## 2. Torneo correctamente identificado");
  check("tournamentId correcto y estable", out.ref.eventId === "2765" && snap.tournament.id === "vlr-2765");
  check("nombre + slug", snap.tournament.name === "Valorant Masters London 2026" && snap.tournament.slug === "valorant-masters-london-2026");
  check("fechas ISO parseadas del rango de VLR", snap.tournament.startDate === "2026-06-05" && snap.tournament.endDate === "2026-06-21" && snap.tournament.year === 2026);
  check("región + tier inferidos (Masters → internacional)", snap.tournament.tier === "vct-international" && snap.tournament.region === "International");
  check("premio + sede + país", snap.tournament.prizePool === 1_000_000 && snap.tournament.location === "Copper Box Arena, London" && snap.tournament.country === "GB");
  check("circuito del breadcrumb", snap.circuit?.id === "vct-2026" && snap.circuit?.name === "Valorant Champions Tour 2026");
  check("estado derivado de los partidos (todos terminados)", snap.tournament.status === "finished");

  // 3) EQUIPOS
  console.log("\n## 3. Equipos completos");
  const teamNames = snap.teams.map((t) => t.name);
  check("equipos de tarjetas ∪ partidos (incluye al que VLR no lista)", snap.teams.length === 3 && teamNames.includes("Berlin Bears"), teamNames.join(", "));
  check("ids de VLR presentes donde existen", snap.teams.find((t) => t.name === "London Lions")?.id === "701" && snap.teams.find((t) => t.name === "Madrid Wolves")?.id === "702");
  check("tag derivado del cruce stats⋈roster", snap.teams.find((t) => t.name === "London Lions")?.tag === "LLN" && snap.teams.find((t) => t.name === "Madrid Wolves")?.tag === "MWV");

  // 4) JUGADORES
  console.log("\n## 4. Jugadores completos");
  check("roster completo + sub solo-stats (5+5+1)", snap.players.length === 11);
  const lion1 = snap.players.find((p) => p.nick === "Lion1");
  const extra = snap.players.find((p) => p.nick === "Extra");
  check("nick + equipo + país", lion1?.team === "London Lions" && lion1?.country === "GB");
  check("agentes desde la página de stats (canónicos)", (lion1?.agents ?? []).includes("Jett") && (lion1?.agents ?? []).includes("KAY/O"));
  check("sub sin roster asignado por TAG→equipo", extra?.team === "London Lions" && extra?.country === "FR");
  check("sin duplicados por fusión roster⋈stats", new Set(snap.players.map((p) => p.nick.toLowerCase())).size === snap.players.length);

  // 5) PARTIDOS / MAPAS / RESULTADOS
  console.log("\n## 5. Partidos, mapas y resultados");
  check("todos los partidos listados", snap.matches.length === 2 && out.meta.matchesListed === 2);
  const gf = snap.matches.find((m) => m.id === "900001");
  check("marcador + ganador + serie + fase", gf?.scoreA === 2 && gf?.scoreB === 0 && gf?.winner === "London Lions" && gf?.round === "Grand Final" && gf?.stageId === "st-playoffs");
  check("startTime UTC exacto de la página de detalle", gf?.startTime === "2026-06-21T16:00:00Z");
  check("fallback de fecha por label del listado (partido sin detalle)", snap.matches.find((m) => m.id === "900002")?.startTime === "2026-06-20");
  check("bestOf/format del detalle", gf?.bestOf === 3 && gf?.format === "bo3");
  const maps = snap.maps ?? [];
  check("mapas del detalle (contenedor 'all' ignorado)", maps.length === 2 && maps.every((m) => m.matchId === "900001"));
  check("nombre + orden + marcador + ganador por mapa", maps[0]?.map === "Ascent" && maps[0]?.mapOrder === 1 && maps[0]?.scoreA === 13 && maps[0]?.scoreB === 7 && maps[0]?.winner === "London Lions");
  check("pick del veto por lado", maps[0]?.pickedBy === "London Lions" && maps[1]?.pickedBy === "Madrid Wolves");
  check("partido con detalle roto degrada con warning (no aborta)", out.warnings.length === 1 && out.warnings[0].includes("900002"));

  // 6) ESTADÍSTICAS
  console.log("\n## 6. Estadísticas completas");
  const stats = snap.mapStats ?? [];
  check("10 jugadores × 2 mapas", stats.length === 20);
  const s0 = stats.find((s) => s.player === "Lion1" && s.matchMapId === "777001");
  check("métricas completas (rating/ACS/ADR/KAST/K/D/A/HS%/FK/FD)",
    s0?.rating === 1.10 && s0?.acs === 210 && s0?.adr === 150 && s0?.kast === 68
    && s0?.kills === 15 && s0?.deaths === 10 && s0?.assists === 3 && s0?.hsPct === 22 && s0?.fk === 2 && s0?.fd === 1);
  check("agente por mapa", s0?.agent === "Jett" && stats.find((s) => s.player === "Wolf1" && s.matchMapId === "777001")?.agent === "Omen");
  check("equipo asignado en cada fila", stats.every((s) => s.team === "London Lions" || s.team === "Madrid Wolves"));
  check("porcentajes en [0,100], nunca NaN", stats.every((s) =>
    [s.kast, s.hsPct].every((v) => v == null || (v >= 0 && v <= 100))
    && [s.acs, s.kills, s.deaths, s.assists, s.adr, s.rating, s.fk, s.fd].every((v) => v == null || Number.isFinite(v))));

  /*
   * 6-bis) EL MARKUP ACTUAL DEL SCOREBOARD, Y EL AVISO CUANDO NO SE ENTIENDE.
   *
   * Los checks de arriba usan el scoreboard en <table>. vlr.gg lo cambió a <div> y estas
   * verificaciones —offline— siguieron en verde mientras el conector real devolvía 0 filas.
   * Aquí se exige lo único que lo habría detectado: que el markup ACTUAL dé exactamente las
   * mismas filas, y que "mapas sin scoreboard" deje de ser silencioso.
   */
  console.log("\n## 6-bis. Scoreboard: markup actual (div.ovw-*) y aviso de markup no entendido");
  const outOvw = await importVlrTournament(EVENT_URL, {
    fetcher: async (url) => (url === M1_URL ? MATCH1_OVW_HTML : fetcher(url)),
  });
  const statsOvw = outOvw.snapshot.mapStats ?? [];
  check("el markup actual también da 10 jugadores × 2 mapas", statsOvw.length === 20, `${statsOvw.length} filas`);
  check("markup actual ⇒ MISMAS estadísticas que el legacy (celdas por nombre, no por posición)",
    JSON.stringify(statsOvw) === JSON.stringify(stats));
  check("markup actual: mapas y marcadores intactos",
    JSON.stringify(outOvw.snapshot.maps) === JSON.stringify(snap.maps));

  const outNoSb = await importVlrTournament(EVENT_URL, {
    fetcher: async (url) => (url === M1_URL ? MATCH1_NO_SB_HTML : fetcher(url)),
  });
  check("mapas sin scoreboard ⇒ 0 filas (no se inventa nada)", (outNoSb.snapshot.mapStats ?? []).length === 0);
  check("mapas sin scoreboard ⇒ AVISO explícito (deja de ser un fallo silencioso)",
    outNoSb.warnings.some((w) => w.includes("NINGUNA fila de scoreboard")),
    outNoSb.warnings.join(" · "));
  check("con scoreboards NO se avisa (el aviso no es ruido)",
    !out.warnings.some((w) => w.includes("NINGUNA fila de scoreboard")));

  // 7) RAWSNAPSHOT VÁLIDO + COMPATIBILIDAD CON EL IMPORTER
  console.log("\n## 7. RawSnapshot válido y compatible con el Importer");
  const res = vlrSnapshotToModel(snap, 1_700_000_000_000);
  check("importSnapshot OK (0 errores del validador oficial)", res.ok, `${res.issues.filter((i) => i.severity === "error").length} errores / ${res.issues.length} issues`);
  check("ids canónicos prefijados", res.model.teams.every((t) => t.id.startsWith("t:")) && res.model.players.every((p) => p.id.startsWith("p:")));
  check("referencias remapeadas (match→equipo, stat→jugador)",
    res.model.matches.every((m) => res.model.index.teamById.has(m.teamAId ?? "") && res.model.index.teamById.has(m.teamBId ?? ""))
    && res.model.mapStats.every((s) => res.model.index.playerById.has(s.playerId ?? "") && res.model.index.mapById.has(s.matchMapId)));
  check("modelo canónico completo (equipos/jugadores/partidos/mapas/stats)",
    res.model.teams.length === 3 && res.model.players.length === 11 && res.model.matches.length === 2
    && res.model.maps.length === 2 && res.model.mapStats.length === 20);
  check("ganador siempre dentro del enfrentamiento", res.model.matches.every((m) => !m.winnerTeamId || m.winnerTeamId === m.teamAId || m.winnerTeamId === m.teamBId));

  // 8) DETERMINISMO
  /*
   * 7.5) LAS TRES VARIANTES QUE ESTUVIERON BLOQUEADAS.
   *
   * Sin este apartado el verify pasaba en verde aunque el conector dejase de leer la
   * clasificación o el clutch: son datos NUEVOS que nadie más comprobaba de extremo a extremo.
   */
  console.log("\n## 7.5 Clasificación final y clutch (champion-edition · clutch · rookie)");
  check("clasificación leída de la tabla Prize Distribution", snap.standings?.length === 3,
    (snap.standings ?? []).map((p) => `${p.position}:${p.team}`).join(" · "));
  check("campeón y subcampeón salen del DATO, no del código",
    snap.awards?.champion === "London Lions" && snap.awards?.runnerUp === "Madrid Wolves",
    `${snap.awards?.champion} / ${snap.awards?.runnerUp}`);
  check("el nombre del equipo no arrastra la región anidada",
    !(snap.awards?.champion ?? "").includes("Europe"));
  check("premios y puntos del reparto",
    snap.awards?.placements?.[0]?.prize === 400_000 && snap.awards?.placements?.[0]?.points === 8);
  check("un comentario HTML no se cuela como puntos",
    snap.awards?.placements?.every((p) => p.points !== 999) === true);
  check("puesto empatado se lee sin inventar desempate", snap.awards?.placements?.[2]?.position === 3);

  const conClutch = (snap.playerTournamentStats ?? []).filter((p) => p.clutchesWon !== undefined);
  check("agregados de clutch por jugador y torneo", conClutch.length === snap.players.length,
    `${conClutch.length}/${snap.players.length}`);
  check("clutch trae ganadas Y jugadas (nunca solo el numerador)",
    conClutch.every((p) => typeof p.clutchesWon === "number" && typeof p.clutchSituations === "number"));
  check("el clutch NO viaja por las stats de mapa (la fuente no lo publica por mapa)",
    (snap.mapStats ?? []).every((m) => m.clutches === undefined));
  check("ningún jugador trae `status` (rookie sigue bloqueada, sin inventar)",
    snap.players.every((p) => p.status === undefined));

  // Sin tabla de clasificación no puede haber campeón: es el estado de un torneo en curso.
  const cut = EVENT_HTML.indexOf('<div class="wf-label mod-large">');
  const sinTabla = EVENT_HTML.slice(0, cut) + EVENT_HTML.slice(EVENT_HTML.indexOf('<div class="event-teams-container"'));
  const outSinTabla = await importVlrTournament(EVENT_URL, {
    fetcher: async (u: string) => (u === EVENT_URL ? sinTabla : fetcher(u)),
    includeMatchDetails: false,
  });
  check("sin tabla de clasificación no hay campeón (torneo en curso)",
    outSinTabla.snapshot.awards === undefined && (outSinTabla.snapshot.standings ?? []).length === 0);

  console.log("\n## 8. Determinismo");
  const again = await importVlrTournament(EVENT_URL, { fetcher });
  check("mismo HTML ⇒ mismo RawSnapshot (byte a byte)", JSON.stringify(out.snapshot) === JSON.stringify(again.snapshot) && JSON.stringify(out.warnings) === JSON.stringify(again.warnings));
  const viaStatsUrl = await importVlrTournament(STATS_URL, { fetcher });
  check("URL de /event/stats/ ⇒ mismo snapshot que la URL del evento", JSON.stringify(viaStatsUrl.snapshot) === JSON.stringify(out.snapshot));
  check("helpers puros anclados", parseVlrDates("Aug 1–25, 2024").start === "2024-08-01" && parseVlrDates("Jun 30 – Jul 13, 2025").end === "2025-07-13" && utcTsToIso("2024-08-01 04:00:00") === "2024-08-01T04:00:00Z");

  // 9) RENDIMIENTO
  console.log("\n## 9. Rendimiento");
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) await importVlrTournament(EVENT_URL, { fetcher });
  const ms = Date.now() - t0;
  check("50 imports completos offline < 5s", ms < 5000, `${ms}ms (${(ms / 50).toFixed(1)}ms/import)`);

  // 10) CERO ESTADOS IMPOSIBLES
  console.log("\n## 10. Cero estados imposibles");
  let badUrlThrew = false;
  try { await importVlrTournament("https://www.vlr.gg/rankings", { fetcher }); } catch { badUrlThrew = true; }
  check("URL no-torneo lanza (no devuelve snapshot vacío)", badUrlThrew);
  let notEventThrew = false;
  try {
    await importVlrTournament("https://www.vlr.gg/event/999/x", { fetcher: async () => "<html><body>404</body></html>" });
  } catch { notEventThrew = true; }
  check("página sin cabecera de evento lanza", notEventThrew);
  check("números basura → undefined (nunca NaN)", num("no-num") === undefined && num("") === undefined && num("1.2.3") === undefined && num("250") === 250 && num("72%") === 72 && num("$1,000,000") === 1_000_000);
  check("todo mapa referencia un partido existente", (snap.maps ?? []).every((m) => snap.matches.some((x) => x.id === m.matchId)));
  check("toda stat referencia un mapa existente", stats.every((s) => (snap.maps ?? []).some((m) => m.id === s.matchMapId)));
  const dump = JSON.stringify(snap).toLowerCase();
  check("el snapshot NO contiene cartas/OVR/rareza (solo datos objetivos)", !dump.includes('"ovr"') && !dump.includes("rarity") && !dump.includes('"card'));

  // 11) PROVIDER OFICIAL
  console.log("\n## 11. ImportProvider oficial (contrato de @/importer)");
  const provider = createVlrProvider({ fetcher });
  check("id/priority/supports", provider.id === "vlr" && provider.priority() === 10 && provider.supports("valorant") && !provider.supports("lol"));
  check("discover parsea el listado de eventos", (await provider.discover()).join(",") === "2765,2800");
  const viaProvider = await provider.fetchTournament("2765");
  check("fetchTournament(id) ⇒ snapshot equivalente (difiere solo el slug, ausente en la URL por id)",
    viaProvider.tournament.id === snap.tournament.id
    && JSON.stringify(viaProvider.teams) === JSON.stringify(snap.teams)
    && JSON.stringify(viaProvider.players) === JSON.stringify(snap.players)
    && JSON.stringify(viaProvider.matches) === JSON.stringify(snap.matches)
    && JSON.stringify(viaProvider.maps) === JSON.stringify(snap.maps)
    && JSON.stringify(viaProvider.mapStats) === JSON.stringify(snap.mapStats));
  check("parseEventLinks puro y sin duplicados", parseEventLinks(EVENTS_LIST_HTML + EVENTS_LIST_HTML).length === 2);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error("💥 error fatal:", e); process.exitCode = 1; });
