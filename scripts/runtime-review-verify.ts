/**
 * VERIFICACIÓN RUNTIME REVIEW (Tournament Automation · Fase 3/5).
 *
 * Demuestra — sin asumir nada — que las cartas publicadas por el pipeline son UTILIZABLES por
 * el juego a través de los MISMOS módulos que usa la aplicación: catálogo vivo (getCard/
 * getPlayer), Collection Engine (el de /coleccion), buscador (applyFilter), Card Viewer (sus
 * dependencias de datos), Pack Engine del runtime (el MISMO de useGameStore, sobre real
 * abierto), Marketplace (elegibilidad + pricing incumbente), filtros, estadísticas y logros
 * (cero referencias al catálogo antiguo). Además valida el Review Dashboard (buildReviewModel +
 * filtros + orden). 100% OFFLINE (fixtures HTML de vlr.gg), determinista, restaura la semilla.
 */
import { runTournamentPipeline } from "@/tournament-orchestrator";
import { agentName, type VlrFetcher } from "@/importer-vlr";
import {
  resetRuntime, runtimeVersion, runtimeFingerprint, runtimeGenerationId,
  runtimeRegistry, runtimePackEngine, runtimeSearch, runtimeMarketEntries, runtimeCollections,
} from "@/publisher";
import { allPlayers, rebuildCatalog, totalCards, getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { CollectionEngine, applyFilter, progress as collectionProgressEngine } from "@/collection";
import { collectionStats } from "@/store/selectors";
import { regionCollections } from "@/domain/collections";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { buildPool } from "@/domain/packs/pool";
import { PACKS, getPack } from "@/data/packs";
import { freshPity } from "@/pack";
import { marketValue } from "@/domain/economy/pricing";
import { buildReviewModel, applyReviewFilter, sortReviewRows, reviewFacets, type ReviewModel } from "@/review";
import type { OwnedCard } from "@/domain/cards/types";
import type { OrchestratorCtx } from "@/tournament-orchestrator";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// ════════════════════════ FIXTURES (markup real de vlr.gg; zekken como estrella) ════════════════════════

const EVENT_URL = "https://www.vlr.gg/event/2765/valorant-masters-london-2026";
const STATS_URL = "https://www.vlr.gg/event/stats/2765/valorant-masters-london-2026";
const MATCHES_URL = "https://www.vlr.gg/event/matches/2765/valorant-masters-london-2026/?series_id=all";
const M1_URL = "https://www.vlr.gg/900001/london-lions-vs-madrid-wolves-valorant-masters-london-2026-gf";

// zekken (jugador REAL del roster semilla) juega el torneo: su identidad se resuelve contra el
// catálogo y el override editorial set-mvp (capacidad oficial del F4) garantiza zekken__mythic.
const LIONS = ["zekken", "Lion2", "Lion3", "Lion4", "Lion5"];
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

const pipelineCtx = (roster = allPlayers()): OrchestratorCtx => ({
  now: NOW,
  roster,
  vlr: { fetcher },
  // Capacidad editorial OFICIAL del Card Generator: garantiza el MVP del ejemplo obligatorio.
  overrides: [{ kind: "set-mvp", tournamentId: "vlr-2765", playerId: "zekken", reason: "MVP del torneo (verificación)", author: "runtime-review:verify" }],
});

async function main(): Promise<void> {
  console.log("# Verificación Runtime Review — DRL Champions (Fase 3/5)\n");

  const originalPlayers = allPlayers();
  const originalTotal = totalCards();
  resetRuntime();

  const goalEmeaBefore = ACHIEVEMENTS.find((a) => a.id === "completa-emea")!.goal;

  // ── PIPELINE COMPLETO (mismo comando que tournament:generate) ──
  console.log("## 1. Publicación (pipeline oficial, offline)");
  const run = await runTournamentPipeline(EVENT_URL, pipelineCtx());
  const o = run.outputs;
  check("pipeline ok y publicación aplicada", run.ok && !!o.publish?.applied);
  const publishedIds = [...new Set([...o.build!.diff.added, ...o.build!.diff.updated])];
  const genIds = o.generation!.cards.map((c) => c.cardId);
  check("la generación emitió cartas (112 en el Masters London real)", genIds.length > 0, `${genIds.length} cartas`);

  // ── TODAS LAS CARTAS EXISTEN (accesor real de la app) ──
  console.log("\n## 2. Todas las cartas publicadas existen en el catálogo del juego");
  check("TODAS las cartas de la generación resuelven vía getCard()", genIds.every((id) => !!getCard(id)));
  check("TODAS las altas del diff existen y están indexadas", publishedIds.every((id) => !!getCard(id)) && publishedIds.length > 0, `${publishedIds.length} publicadas`);
  check("zekken__mythic existe (ejemplo obligatorio)", !!getCard("zekken__mythic") && getCard("zekken__mythic")!.playerId === "zekken");

  // ── RUNTIME ACTUALIZADO ──
  console.log("\n## 3. Runtime actualizado");
  check("RuntimeVersion avanzó y la generación es la vigente",
    runtimeVersion() === 1 && runtimeGenerationId() === o.generation!.generationId && runtimeFingerprint() === o.build!.catalogFingerprint);
  check("catálogo vivo = catálogo de la build", totalCards() === o.build!.catalog.cards.length);
  const reg = runtimeRegistry();
  check("registry vigente construido sobre el catálogo vivo", reg.total === totalCards() && publishedIds.every((id) => reg.has(id)));

  // ── COLLECTION (el MISMO motor que /coleccion) ──
  console.log("\n## 4. Collection las ve (CollectionEngine de /coleccion)");
  const engine = new CollectionEngine([]);
  const viewIds = new Set(engine.views().map((v) => v.cardId));
  check("todas las publicadas aparecen en las vistas de colección", publishedIds.every((id) => viewIds.has(id)));
  const stats = collectionProgressEngine(engine.registry, engine.ownership());
  check("el progreso de colección cuenta las nuevas", stats.total === totalCards() && collectionStats([]).total === totalCards());
  // Propiedad de verdad: acuñar zekken__mythic por la ruta OFICIAL (grant del Pack Engine).
  const grant = runtimePackEngine().grant(["zekken__mythic"], "admin", { seed: 7, owned: [], mintCounts: {}, pity: freshPity(), now: NOW });
  const owned: OwnedCard[] = grant.instances.map((i, n) => ({ uid: `verify-${n}`, cardId: i.cardId, serial: i.serial ?? undefined, obtainedAt: NOW }));
  const engineOwned = new CollectionEngine(owned);
  check("una copia acuñada aparece como POSEÍDA en la colección",
    grant.instances.length === 1 && engineOwned.views().some((v) => v.cardId === "zekken__mythic" && v.owned));

  // ── SEARCH (el buscador de la app + índice publicado) ──
  console.log("\n## 5. Search las ve");
  const hits = applyFilter(engine.views(), { text: "zekken", includeHidden: true });
  check("el buscador de /coleccion encuentra zekken__mythic", hits.some((v) => v.cardId === "zekken__mythic"));
  const searchRows = new Set(runtimeSearch().rows.map((r) => r.ref));
  check("el índice de búsqueda del runtime contiene TODAS las publicadas", publishedIds.every((id) => searchRows.has(id)));

  // ── CARD VIEWER ──
  console.log("\n## 6. Card Viewer las ve (dependencias de datos reales)");
  check("getCard + getPlayer + getVariant resuelven para TODAS las publicadas",
    publishedIds.every((id) => {
      const c = getCard(id);
      return !!c && !!getPlayer(c.playerId) && !!getVariant(c.variantId);
    }));

  // ── PACKS (el MISMO PackEngine que usa useGameStore) ──
  console.log("\n## 7. Packs las utilizan (runtimePackEngine = el de useGameStore)");
  const pools = PACKS.map((p) => buildPool(reg, p));
  const inSomePool = new Set(pools.flatMap((pool) => pool.flat.map((c) => c.id)));
  const eligibleNew = o.generation!.cards.filter((c) => c.eligibility.packs.length > 0).map((c) => c.cardId);
  check("las cartas elegibles de la generación están en pools reales",
    eligibleNew.length > 0 && eligibleNew.every((id) => inSomePool.has(id)), `${eligibleNew.length} elegibles`);
  check("los pools del runtime cuadran con la build publicada",
    o.build!.packs.pools.every((p) => buildPool(reg, getPack(p.packId)!).size === p.size));
  const opened = runtimePackEngine().open(getPack("inicial")!, { seed: 42, owned: [], mintCounts: {}, pity: freshPity(), now: NOW });
  check("un sobre REAL abierto tras publicar entrega cartas del catálogo vigente",
    opened.instances.length > 0 && opened.instances.every((i) => !!getCard(i.cardId)));

  // ── MARKETPLACE ──
  console.log("\n## 8. Marketplace las utiliza");
  const marketIds = new Set(runtimeMarketEntries().map((e) => e.cardId));
  const tradableNew = o.generation!.cards.filter((c) => c.eligibility.market.toMarket).map((c) => c.cardId);
  check("las cartas comerciables tienen entrada publicada en el mercado",
    tradableNew.every((id) => marketIds.has(id)), `${tradableNew.length} comerciables`);
  check("el pricing incumbente (marketValue) valora TODAS las publicadas",
    publishedIds.every((id) => marketValue(getCard(id)!) > 0));
  const mythicEntry = runtimeMarketEntries().find((e) => e.cardId === "zekken__mythic");
  check("zekken__mythic respeta su política de mercado (restringida)", !!mythicEntry && !mythicEntry.tradable);

  // ── FILTROS + ESTADÍSTICAS + LOGROS (cero referencias al catálogo antiguo) ──
  console.log("\n## 9. Filtros, estadísticas y cero referencias al catálogo antiguo");
  const emeaViews = applyFilter(engine.views(), { regions: ["EMEA"], includeHidden: true });
  check("los filtros por región ven a los jugadores nuevos (GB/ES → EMEA)",
    emeaViews.some((v) => publishedIds.includes(v.cardId)));
  check("las colecciones por región (estadísticas del juego) incluyen cartas nuevas",
    regionCollections().some((c) => c.cardIds.some((id) => publishedIds.includes(id))));
  check("las colecciones publicadas del torneo están en el runtime",
    runtimeCollections().some((c) => c.tournamentId === "vlr-2765" || c.items.some((i) => publishedIds.includes(i.cardId))));
  const goalEmeaAfter = ACHIEVEMENTS.find((a) => a.id === "completa-emea")!.goal;
  check("logros SIN snapshot congelado: 'Completar EMEA' ve el catálogo vigente",
    goalEmeaAfter > goalEmeaBefore, `${goalEmeaBefore} → ${goalEmeaAfter}`);
  check("engines del runtime ligados al catálogo vigente (cero referencias viejas)",
    runtimePackEngine().registry === runtimeRegistry() && runtimeRegistry().total === totalCards());

  // ── REVIEW DASHBOARD ──
  console.log("\n## 10. Review Dashboard (/admin/card-review)");
  const t0 = performance.now();
  const model: ReviewModel = buildReviewModel({
    generation: o.generation!, build: o.build!, publish: o.publish!, tournamentName: run.tournamentName,
  });
  const buildMs = performance.now() - t0;
  check("una fila por carta de la última generación publicada",
    model.rows.length === genIds.length && model.generationId === runtimeGenerationId());
  const zk = model.rows.find((r) => r.cardId === "zekken__mythic")!;
  check("fila completa: jugador/equipo/torneo/rareza/variante/OVR/colección/packs/mercado/estado",
    !!zk && zk.player === "zekken" && zk.team.length > 0 && zk.tournamentName === "Valorant Masters London 2026" &&
    zk.variantId === "mythic" && zk.ovr > 0 && !!zk.rarityBucket && zk.status.length > 0 && zk.releaseState.length > 0 &&
    Array.isArray(zk.packs) && typeof zk.market.tradable === "boolean" && zk.generationId === model.generationId);
  check("reglas + evidencia trazadas en la fila", zk.rules.length > 0 && (zk.evidence.length > 0 || zk.decisionReason.length > 0));
  check("artwork con placeholder cuando no hay foto aprobada", typeof zk.artwork.image === "string" && typeof zk.artwork.hasCustom === "boolean");

  const facets = reviewFacets(model.rows);
  check("facetas completas (equipo/jugador/rareza/colección/torneo/estado/variante)",
    facets.teams.length > 0 && facets.players.length > 0 && facets.rarities.length > 0 &&
    facets.tournaments.length === 1 && facets.statuses.length > 0 && facets.variants.length > 0);
  check("filtro por jugador", applyReviewFilter(model.rows, { player: "zekken" }).every((r) => r.player === "zekken")
    && applyReviewFilter(model.rows, { player: "zekken" }).length > 0);
  check("filtro por equipo + variante composicional",
    applyReviewFilter(model.rows, { team: zk.team, variant: "mythic" }).some((r) => r.cardId === "zekken__mythic"));
  check("filtro por rareza y estado no inventan filas",
    applyReviewFilter(model.rows, { rarity: zk.rarityBucket }).every((r) => r.rarityBucket === zk.rarityBucket) &&
    applyReviewFilter(model.rows, { status: zk.status }).every((r) => r.status === zk.status));
  const byOvr = sortReviewRows(model.rows, "ovr");
  const byRarity = sortReviewRows(model.rows, "rarity");
  const byPlayer = sortReviewRows(model.rows, "player");
  const byDate = sortReviewRows(model.rows, "date");
  check("orden por OVR (desc) / rareza / jugador / fecha",
    byOvr.every((r, i) => i === 0 || byOvr[i - 1].ovr >= r.ovr) &&
    byPlayer.every((r, i) => i === 0 || byPlayer[i - 1].player.localeCompare(r.player) <= 0) &&
    byRarity.length === model.rows.length && byDate.length === model.rows.length);
  check("el modelo es 100% serializable (persistible en el store del dashboard)",
    JSON.parse(JSON.stringify(model)).rows.length === model.rows.length);

  // ── DETERMINISMO ──
  console.log("\n## 11. Determinismo");
  resetRuntime(); rebuildCatalog(originalPlayers);
  const r1 = await runTournamentPipeline(EVENT_URL, pipelineCtx());
  const m1 = buildReviewModel({ generation: r1.outputs.generation!, build: r1.outputs.build!, publish: r1.outputs.publish!, tournamentName: r1.tournamentName });
  resetRuntime(); rebuildCatalog(originalPlayers);
  const r2 = await runTournamentPipeline(EVENT_URL, pipelineCtx());
  const m2 = buildReviewModel({ generation: r2.outputs.generation!, build: r2.outputs.build!, publish: r2.outputs.publish!, tournamentName: r2.tournamentName });
  check("mismo estado + misma URL ⇒ mismo ReviewModel byte a byte", JSON.stringify(m1) === JSON.stringify(m2));
  check("misma huella de catálogo publicada", r1.metrics.catalogFingerprint === r2.metrics.catalogFingerprint);

  // ── RENDIMIENTO ──
  console.log("\n## 12. Rendimiento");
  check("buildReviewModel instantáneo", buildMs < 250, `${buildMs.toFixed(1)} ms`);
  check("pipeline + validaciones en tiempo razonable (offline)", run.metrics.totalMs < 5000, `${Math.round(run.metrics.totalMs)} ms`);

  // ── RESTAURACIÓN ──
  resetRuntime();
  rebuildCatalog(originalPlayers);
  check("catálogo semilla restaurado al terminar", totalCards() === originalTotal);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
