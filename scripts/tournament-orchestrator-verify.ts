/**
 * VERIFICACIÓN DEL TOURNAMENT ORCHESTRATOR (Tournament Automation · Fase 2/5).
 *
 * 100% OFFLINE y determinista: las "páginas de VLR" son fixtures HTML con markup real de vlr.gg
 * servidas por un `VlrFetcher` inyectado (cero red, apto para CI). Comprueba: ejecución completa
 * del pipeline F1→F7 · orden exacto de las 8 etapas · determinismo · rollback (del Publisher,
 * intacto) · compatibilidad con todos los motores · CLI · manejo de errores (detención inmediata
 * con stack) · rendimiento · cero estados imposibles. Este verify SÍ publica en el catálogo vivo
 * (etapa 8 = efectos) y lo RESTAURA al terminar. Falla de verdad.
 */
import {
  runTournamentPipeline, runCli, computeMetrics, STAGES, STAGE_ORDER,
  type OrchestratorResult, type StageId,
} from "@/tournament-orchestrator";
import { agentName, type VlrFetcher } from "@/importer-vlr";
import {
  rollback, resetRuntime,
  runtimeVersion, runtimeFingerprint, runtimeRegistry, runtimePackEngine, runtimeSnapshots,
} from "@/publisher";
import { allPlayers, rebuildCatalog, totalCards, getCard } from "@/data/catalog";
import type { Player } from "@/domain/cards/types";
import { MIN_ROUNDS } from "@/domain/cards/combat";

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

const LIONS = ["Lion1", "Lion2", "Lion3", "Lion4", "Lion5"];
const WOLVES = ["Wolf1", "Wolf2", "Wolf3", "Wolf4", "Wolf5"];

/*
 * ─────────────────────── ROSTER DEL FIXTURE (y por qué hace falta) ───────────────────────
 *
 * El catálogo NO fabrica cartas sin datos: `cardsForPlayer` devuelve [] si el jugador no tiene
 * ni `metrics` reales (con `rounds >= MIN_ROUNDS`) ni una autoría `editorial` explícita. Es la
 * regla de «cero estadísticas por defecto», y es deliberada.
 *
 * Un jugador que el conector descubre en un torneo llega como BORRADOR y no lleva `metrics`, así
 * que por sí solo no genera carta — que es exactamente lo que debe pasar. En un torneo de verdad
 * eso no se nota porque sus jugadores YA están en el catálogo con sus métricas: las 6 cartas que
 * produjo VCT 2026 EMEA Stage 2 fueron para Kachoww, kamo, sociablEE y al0rante, los cuatro del
 * roster y con entre 352 y 1.394 rondas registradas.
 *
 * Este fixture inventa un torneo, así que debe inventar también su catálogo: sin estos diez
 * jugadores el pipeline termina correctamente y con CERO cartas, y las comprobaciones de
 * generación/materialización/publicación no verifican nada. Las métricas de abajo son de FIXTURE
 * —como los marcadores del HTML—, no entran en el catálogo del producto: viven solo en el roster
 * que este verify inyecta y se restaura al terminar.
 */
const fixturePlayer = (
  id: string, nick: string, team: string, tag: string, cc: string, role: Player["role"], i: number,
): Player => ({
  id, nick, team, teamTag: tag, region: "EMEA", role, country: cc,
  stats: { dmg: 78 + i, scr: 80 + i, com: 76 + i, hs: 70 + i, ast: 68 + i, clu: 66 + i },
  accolades: [],
  // Muestra suficiente (MIN_ROUNDS = 100) y los ocho componentes que `deriveCombat` exige:
  // sin uno solo de ellos el dominio se niega a derivar, en vez de rellenarlo con un neutro.
  metrics: {
    rounds: 4 * MIN_ROUNDS + i, kills: 300 + 4 * i, deaths: 250 + 2 * i, assists: 90 + 3 * i,
    fk: 55 + i, fd: 40 + i, acs: 210 + 4 * i, adr: 145 + 2 * i,
    kd: 1.2 - i * 0.02, kast: 72 + i, hsPct: 24 + i, clutches: 6 + (i % 4),
  },
});

/** Los diez del fixture, con la misma forma que una fila real del roster VLR. */
const FIXTURE_ROSTER: Player[] = [
  ...LIONS.map((nick, i) => fixturePlayer(`fx-lion-${i + 1}`, nick, "London Lions", "LLN", "GB",
    (["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"] as const)[i], i)),
  ...WOLVES.map((nick, i) => fixturePlayer(`fx-wolf-${i + 1}`, nick, "Madrid Wolves", "MWV", "ES",
    (["Controlador", "Flex", "Duelista", "Iniciador", "Centinela"] as const)[i], i + 5)),
];

/**
 * El roster que recibe el pipeline: el catálogo vivo MÁS los diez del fixture. Deduplica por id
 * porque tras publicar el catálogo vivo ya los contiene, y el mismo jugador dos veces haría
 * ambigua la resolución por nick.
 */
const pipelineRoster = (): Player[] => {
  const byId = new Map<string, Player>();
  for (const p of [...allPlayers(), ...FIXTURE_ROSTER]) byId.set(p.id, p);
  return [...byId.values()];
};

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
<div class="event-teams-container" style="margin-bottom: 30px;">
${teamCard(701, "london-lions", "London Lions", LIONS, "gb", 9001)}
${teamCard(702, "madrid-wolves", "Madrid Wolves", WOLVES, "es", 9011)}
</div>
</body></html>`;

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

const mapBlock = (gameId: string, mapName: string, sLeft: number, sRight: number, pickedMod: 1 | 2): string => `
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
${sbTable(LIONS.map((p, i) => sbRow(9001 + i, p, "LLN", "gb", i === 0 ? "jett" : "kayo", i)).join(""))}
${sbTable(WOLVES.map((p, i) => sbRow(9011 + i, p, "MWV", "es", i === 0 ? "omen" : "sova", 5 + i)).join(""))}
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

// El partido 900002 NO tiene fixture a propósito: ejercita la degradación por-partido del
// conector (warning, sin abortar) atravesando TODO el pipeline.
const PAGES: Record<string, string> = {
  [EVENT_URL]: EVENT_HTML,
  [STATS_URL]: STATS_HTML,
  [MATCHES_URL]: MATCHES_HTML,
  [M1_URL]: MATCH1_HTML,
};

const fetcher: VlrFetcher = async (url: string) => {
  const page = PAGES[url];
  if (!page) throw new Error(`fixture no disponible: ${url}`);
  return page;
};

// ════════════════════════════════════════ VERIFICACIÓN ════════════════════════════════════════

const NOW = 1_700_000_000_000;

async function main(): Promise<void> {
  console.log("# Verificación del Tournament Orchestrator — DRL Champions (Fase 2/5)\n");

  const originalPlayers = allPlayers();
  const originalTotal = totalCards();
  resetRuntime();
  const roster = pipelineRoster();

  // 1) EJECUCIÓN COMPLETA + ORDEN (eventos grabados)
  console.log("## 1. Ejecución completa del pipeline (offline, fixtures)");
  const seq: string[] = [];
  const run1 = await runTournamentPipeline(EVENT_URL, {
    now: NOW, roster, vlr: { fetcher },
    events: {
      onStageStart: (s) => seq.push(`start:${s}`),
      onStageEnd: (s) => seq.push(`end:${s}`),
      onStageError: (s) => seq.push(`error:${s}`),
    },
  });
  const o = run1.outputs;
  check("pipeline completo ok (8/8 etapas)", run1.ok && run1.metrics.stages.length === 8);
  check("las 8 salidas presentes e íntegras",
    !!o.vlr && !!o.importResult && !!o.report && !!o.analysis && !!o.generation && !!o.materialization && !!o.build && !!o.publish);
  check("torneo identificado", run1.tournamentName === "Valorant Masters London 2026" && run1.ref?.eventId === "2765");
  check("modelo canónico con volumen real",
    run1.metrics.teams >= 2 && run1.metrics.players >= 10 && run1.metrics.matches >= 2 && run1.metrics.maps >= 2,
    `${run1.metrics.teams} equipos · ${run1.metrics.players} jugadores · ${run1.metrics.matches} partidos · ${run1.metrics.maps} mapas`);
  check("cartas generadas y materializadas", run1.metrics.cardsGenerated > 0 && run1.metrics.cardsMaterialized > 0,
    `${run1.metrics.cardsGenerated} generadas · ${run1.metrics.cardsMaterialized} CardDefs`);
  check("publicación aplicada al runtime", !!o.publish?.applied && o.publish.transaction.finalState === "COMPLETED" && runtimeVersion() === 1);
  check("catálogo VIVO actualizado (cartas nuevas accesibles)",
    totalCards() === o.build!.catalog.cards.length && o.build!.diff.added.length > 0 && o.build!.diff.added.every((id) => !!getCard(id)));
  check("fallo por-partido degradado a warning SIN abortar (partido 900002)", o.vlr!.warnings.length === 1 && run1.ok);

  // 2) ORDEN CORRECTO
  console.log("\n## 2. Orden exacto de las 8 etapas");
  check("definición del pipeline = orden oficial", JSON.stringify(STAGES.map((s) => s.id)) === JSON.stringify(STAGE_ORDER));
  check("etapas ejecutadas en orden", JSON.stringify(run1.metrics.stages.map((s) => s.stage)) === JSON.stringify(STAGE_ORDER));
  check("eventos start/end intercalados en orden",
    JSON.stringify(seq) === JSON.stringify(STAGE_ORDER.flatMap((s: StageId) => [`start:${s}`, `end:${s}`])));

  // 5) COMPATIBILIDAD CON TODOS LOS MOTORES (sobre run1)
  console.log("\n## 3. Compatibilidad con los motores (salidas intactas)");
  check("informe F2 byte a byte dentro del AnalyzerResult (nada se modifica)",
    JSON.stringify(o.report) === JSON.stringify(o.analysis!.report));
  check("GenerationId único a través de F4→F7",
    o.generation!.generationId === o.build!.generationId && o.build!.generationId === o.publish!.generationId && o.generation!.generationId.length > 0);
  check("CatalogFingerprint de la build = publicado = runtime",
    o.publish!.catalogFingerprint === o.build!.catalogFingerprint && runtimeFingerprint() === o.build!.catalogFingerprint);
  check("materialización enlazada (patch del catálogo dentro de la build)",
    o.build!.manifest.materializationFingerprints.length > 0 && o.materialization!.generationId === o.generation!.generationId);
  check("engines de runtime recreados sobre el catálogo publicado", runtimePackEngine().registry === runtimeRegistry());
  check("instantánea registrada para rollback exacto",
    runtimeSnapshots().some((s) => s.manifest?.generationId === o.generation!.generationId));
  check("métricas completas y coherentes",
    run1.metrics.generationId === o.generation!.generationId && run1.metrics.catalogVersion === o.build!.catalogVersion &&
    run1.metrics.runtimeVersion === 1 && run1.metrics.cardsPublished === o.build!.diff.added.length + o.build!.diff.updated.length &&
    run1.metrics.stages.every((s) => s.ms >= 0) && run1.metrics.totalMs >= 0);

  // IDEMPOTENCIA A TRAVÉS DEL ORQUESTADOR
  console.log("\n## 4. Idempotencia (re-ejecutar el MISMO torneo)");
  const run2 = await runTournamentPipeline(EVENT_URL, { now: NOW, roster, vlr: { fetcher } });
  check("segunda ejecución ⇒ publish no-op (huella ya publicada)",
    run2.ok && !run2.outputs.publish!.applied && runtimeVersion() === 1 && run2.metrics.cardsPublished === 0);

  // 4) ROLLBACK (la transacción del Publisher sigue intacta)
  console.log("\n## 5. Rollback (Publisher intacto a través del orquestador)");
  const preTotal = totalCards();
  const rb = rollback({ generationId: run1.metrics.generationId }, { now: NOW + 1 });
  check("rollback exacto por GenerationId", rb.ok && rb.transaction.finalState === "ROLLED_BACK");
  check("estado restaurado EXACTO tras rollback",
    totalCards() === preTotal && runtimeFingerprint() === o.build!.catalogFingerprint && runtimeVersion() === 2);
  check("rollback a objetivo inexistente ⇒ FAILED sin tocar nada",
    !rollback({ generationId: "GEN-NO-EXISTE" }).ok && totalCards() === preTotal);

  // 3) DETERMINISMO
  console.log("\n## 6. Determinismo (mismo estado + misma URL ⇒ mismo resultado)");
  const strip = (r: OrchestratorResult): string => JSON.stringify({
    ...r,
    metrics: { ...r.metrics, totalMs: 0, stages: r.metrics.stages.map((s) => ({ ...s, ms: 0 })) },
    outputs: {
      ...r.outputs,
      publish: r.outputs.publish ? { ...r.outputs.publish, metrics: { ...r.outputs.publish.metrics, durationMs: 0 } } : undefined,
    },
  });
  resetRuntime(); rebuildCatalog(originalPlayers);
  const d1 = await runTournamentPipeline(EVENT_URL, { now: NOW, roster: pipelineRoster(), vlr: { fetcher } });
  resetRuntime(); rebuildCatalog(originalPlayers);
  const d2 = await runTournamentPipeline(EVENT_URL, { now: NOW, roster: pipelineRoster(), vlr: { fetcher } });
  check("dos ejecuciones idénticas (sin los tiempos reales)", strip(d1) === strip(d2));
  check("misma huella de catálogo en ambas", d1.metrics.catalogFingerprint === d2.metrics.catalogFingerprint && d1.metrics.catalogFingerprint.length === 64);

  // 7) MANEJO DE ERRORES
  console.log("\n## 7. Manejo de errores (detención inmediata + stack conservado)");
  resetRuntime(); rebuildCatalog(originalPlayers);
  const untouched = totalCards();
  const e1 = await runTournamentPipeline("https://google.com/event/123/x", { now: NOW, vlr: { fetcher } });
  check("URL ajena ⇒ falla en importer-vlr y se DETIENE (1 sola etapa ejecutada)",
    !e1.ok && e1.failedStage === "importer-vlr" && e1.metrics.stages.length === 1);
  check("stack del error conservado", !!e1.error?.stack && e1.error.stack.includes("PipelineError") && e1.error.stage === "importer-vlr");
  check("nada pipeline abajo se ejecutó", !e1.outputs.importResult && !e1.outputs.generation && !e1.outputs.publish);

  const brokenFetcher: VlrFetcher = async (url: string) => {
    if (url === STATS_URL) throw new Error("stats caído (simulado)");
    return fetcher(url);
  };
  const e2 = await runTournamentPipeline(EVENT_URL, { now: NOW, vlr: { fetcher: brokenFetcher } });
  check("fallo de red a MITAD de la importación ⇒ misma etapa, causa original visible",
    !e2.ok && e2.failedStage === "importer-vlr" && !!e2.error?.stack?.includes("stats caído (simulado)"));
  check("un pipeline fallido JAMÁS toca el catálogo vivo", totalCards() === untouched && runtimeVersion() === 0);

  const e3 = await runTournamentPipeline(EVENT_URL, {
    now: NOW, roster: pipelineRoster(), vlr: { fetcher },
    events: { onStageStart: () => { throw new Error("observador roto"); }, onStageEnd: () => { throw new Error("observador roto"); } },
  });
  check("un observador de eventos que lanza NO rompe el pipeline", e3.ok && e3.metrics.stages.length === 8);

  // 6) CLI
  console.log("\n## 8. CLI (tournament:generate)");
  resetRuntime(); rebuildCatalog(originalPlayers);
  const lines: string[] = [];
  const cli = await runCli([EVENT_URL], { now: NOW, vlr: { fetcher } }, (l) => lines.push(l));
  const outTxt = lines.join("\n");
  check("CLI ok (exit 0) con URL de evento", cli.exitCode === 0 && !!cli.result?.ok);
  check("cabecera con el nombre del torneo", outTxt.includes("Tournament:") && outTxt.includes("Valorant Masters London 2026"));
  check("resumen de importación", /✓ \d+ equipos/.test(outTxt) && /✓ \d+ jugadores/.test(outTxt) && /✓ \d+ partidos/.test(outTxt) && /✓ \d+ mapas/.test(outTxt));
  check("análisis y generación", outTxt.includes("✓ Analyzer completado") && outTxt.includes("✓ Performance completado") && /✓ \d+ cartas generadas/.test(outTxt) && /✓ \d+ CardDefs/.test(outTxt));
  check("catálogo y runtime", outTxt.includes("✓ Catálogo actualizado") && outTxt.includes("✓ Runtime actualizado"));
  check("cierre con identificadores",
    outTxt.includes("Pipeline completado correctamente.") && outTxt.includes("GenerationId:") && outTxt.includes("CatalogVersion:")
    && outTxt.includes("RuntimeVersion:") && outTxt.includes("Tiempo total:"));

  const statsLines: string[] = [];
  resetRuntime(); rebuildCatalog(originalPlayers);
  const cliStats = await runCli([STATS_URL], { now: NOW, vlr: { fetcher } }, (l) => statsLines.push(l));
  check("la URL /event/stats/ también se acepta (mismo torneo)",
    cliStats.exitCode === 0 && cliStats.result?.ref?.eventId === "2765");

  const failLines: string[] = [];
  const cliFail = await runCli(["https://google.com/x"], { now: NOW, vlr: { fetcher } }, (l) => failLines.push(l));
  check("CLI con URL ajena ⇒ exit 1 + paso fallido visible",
    cliFail.exitCode === 1 && failLines.join("\n").includes("Pipeline FALLIDO en el paso: Importer VLR"));
  const usageLines: string[] = [];
  const cliUsage = await runCli([], {}, (l) => usageLines.push(l));
  check("CLI sin argumentos ⇒ uso + exit 1", cliUsage.exitCode === 1 && usageLines.join("\n").includes("Uso: npm run tournament:generate"));

  // 8) RENDIMIENTO
  console.log("\n## 9. Rendimiento");
  check("pipeline completo offline en tiempo razonable", d1.metrics.totalMs < 5000, `${Math.round(d1.metrics.totalMs)} ms`);

  // 9) CERO ESTADOS IMPOSIBLES
  console.log("\n## 10. Cero estados imposibles");
  const all = [run1, run2, d1, d2, e1, e2, e3];
  check("ok ⇔ sin failedStage/error; fallo ⇔ ambos presentes",
    all.every((r) => (r.ok ? !r.failedStage && !r.error : !!r.failedStage && !!r.error && r.failedStage === r.error.stage)));
  check("etapas ejecutadas siempre prefijo del orden oficial",
    all.every((r) => r.metrics.stages.every((s, i) => s.stage === STAGE_ORDER[i] && s.ms >= 0)));
  check("un fallo nunca deja PublishResult aplicado", all.filter((r) => !r.ok).every((r) => !r.outputs.publish?.applied));
  check("resultado 100% serializable (JSON round-trip)",
    all.every((r) => JSON.parse(JSON.stringify(r)).metrics.stages.length === r.metrics.stages.length));
  check("STAGE_ORDER: 8 etapas únicas", STAGE_ORDER.length === 8 && new Set(STAGE_ORDER).size === 8);
  check("computeMetrics sin salidas ⇒ neutro (sin NaN/undefined)", (() => {
    const m = computeMetrics({}, [], 0);
    return m.teams === 0 && m.cardsGenerated === 0 && m.generationId === "" && m.runtimeVersion === 0;
  })());

  // RESTAURACIÓN FINAL (higiene: el verify deja el catálogo semilla intacto)
  resetRuntime();
  rebuildCatalog(originalPlayers);
  check("catálogo semilla restaurado al terminar", totalCards() === originalTotal);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
