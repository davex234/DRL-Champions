/**
 * VERIFICACIÓN DEL TOURNAMENT CONTROL CENTER (Tournament Automation · Fase 5/5, FINAL).
 *
 * El panel es SOLO orquestación visual: cada acción compone motores terminados (Orchestrator ·
 * Editorial F4 · Publisher) y cada vista es una proyección pura del ControlLedger. Se verifica
 * con el ejemplo obligatorio (run OFICIAL offline de Masters London 2026 →
 * GEN-2026-VALORANT-MASTERS-LONDON-2026): dashboard · búsqueda · filtros · historial ·
 * comparador · métricas · integración Orchestrator/Editorial/Publisher (publicar solo
 * aprobadas, rollback, reabrir, duplicar) · determinismo · rendimiento · cero estados
 * imposibles. Muta el catálogo SOLO al publicar y lo RESTAURA al terminar. Falla de verdad.
 */
import { runTournamentPipeline, type OrchestratorCtx } from "@/tournament-orchestrator";
import { agentName, type VlrFetcher } from "@/importer-vlr";
import type { RawSnapshot } from "@/importer";
import { resetRuntime, runtimeVersion, runtimeGenerationId } from "@/publisher";
import { allPlayers, rebuildCatalog, totalCards, getCard, getPlayer, variantsForAccolade } from "@/data/catalog";
import { auditHistory, stateCounts } from "@/editorial";
import {
  createLedger, ingestRun, generateForReview, openReview, decideRecordCards,
  approveGenerationRecord, reopenReview, duplicateForReview, publishRecord, rollbackRecord,
  buildDashboard, dashboardRow, currentRuntimeInfo, generationDetail, compareGenerations,
  reviewRows, reviewCounts, buildHistory, buildMetrics, buildReport, searchControl,
  applyDashboardFilter, sortDashboardRows, RECORD_STATUSES,
  type ControlLedger, type RuntimeInfo,
} from "@/tournament-control";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

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
const META = (n = 0) => ({ actor: "control-admin", at: NOW + n });
const GEN = "GEN-2026-VALORANT-MASTERS-LONDON-2026";

const pipelineCtx = (roster = allPlayers()): OrchestratorCtx => ({
  now: NOW,
  roster,
  vlr: { fetcher },
  // Capacidad editorial OFICIAL del Card Generator (misma que runtime-review:verify).
  overrides: [{ kind: "set-mvp", tournamentId: "vlr-2765", playerId: "zekken", reason: "MVP del torneo (verificación)", author: "tournament-control:verify" }],
});

async function main(): Promise<void> {
  console.log("# Verificación del Tournament Control Center — DRL Champions (Fase 5/5)\n");

  const originalPlayers = allPlayers();
  const originalTotal = totalCards();
  resetRuntime();

  // ── 1. INTEGRACIÓN CON EL TOURNAMENT ORCHESTRATOR (run oficial offline) ──
  console.log("## 1. Integración con el Tournament Orchestrator");
  const run = await runTournamentPipeline(EVENT_URL, pipelineCtx());
  check("run oficial ok (el Orchestrator publica, como tournament:generate)",
    run.ok && !!run.outputs.publish?.applied && runtimeVersion() === 1);
  check("generationId EXACTO del ejemplo obligatorio", run.metrics.generationId === GEN, run.metrics.generationId);
  const gen = run.outputs.generation!;
  const allIds = gen.cards.map((c) => c.cardId);

  let l: ControlLedger = createLedger();
  const r1 = ingestRun(l, run, META(0));
  check("ingestRun registra el run en el panel", !r1.error && r1.value?.recordId === GEN);
  l = r1.ledger;
  const again = ingestRun(l, run, META(1));
  check("doble ingest rechazado SIN mutar (misma referencia de ledger)", !!again.error && again.ledger === l);
  check("eventos de control: import + generate + publish del run",
    (["import", "generate", "publish"] as const).every((k) => l.events.some((e) => e.kind === k && e.recordId === GEN)));

  // ── 2. DASHBOARD ──
  console.log("\n## 2. Dashboard");
  let rt: RuntimeInfo = currentRuntimeInfo();
  let rows = buildDashboard(l, rt);
  const row0 = rows[0];
  check("fila completa: torneo · generationId · fecha · estado · cartas · runtime · catálogo",
    rows.length === 1 && row0.tournamentName === "Valorant Masters London 2026" && row0.generationId === GEN &&
    row0.date === NOW && row0.status === "published" && row0.cards === allIds.length &&
    row0.runtimeVersion === 1 && row0.catalogVersion === run.metrics.catalogVersion);
  check("generación vigente marcada como live", row0.live && rt.generationId === GEN);
  check("publicadas del run directo = métricas oficiales; sin editorial todo lo demás a 0",
    row0.published === run.metrics.cardsPublished && row0.approved === 0 && row0.pending === 0 &&
    row0.rejected === 0 && row0.blocked === 0);
  const det = generationDetail(l.records[GEN]);
  check("detalle de la generación (por rareza/kind, jugadores, grants)",
    det.cards === allIds.length && Object.values(det.byRarity).reduce((a, b) => a + b, 0) === det.cards &&
    det.players.resolved + det.players.created > 0);

  // Higiene de verificación (como editorial:verify): el circuito editorial se demuestra desde
  // la semilla; el registro CONSERVA su historia (import/generate/publish del run oficial).
  resetRuntime();
  rebuildCatalog(originalPlayers);

  // ── 3. REVISIÓN EDITORIAL DEL EJEMPLO OBLIGATORIO ──
  console.log("\n## 3. Revisión editorial (Editorial F4 vía panel)");
  const or = openReview(l, GEN, META(4));
  l = or.ledger;
  check("abrir revisión: todas las cartas en review", !or.error && reviewCounts(l.records[GEN])!.review === allIds.length);
  const or2 = openReview(l, GEN, META(5));
  check("abrir una revisión ya abierta → error sin mutar", !!or2.error && or2.ledger === l);
  check("reviewRows: estado + acciones legales por carta",
    reviewRows(l.records[GEN]).every((r) => r.state === "review" && r.actions.includes("approve")));

  const one = decideRecordCards(l, GEN, [allIds[0]], "approve", META(6));
  l = one.ledger;
  check("aprobación individual", !one.error && l.records[GEN].editorial!.states[allIds[0]] === "approved");
  const batch = decideRecordCards(l, GEN, [allIds[1], allIds[2]], "approve", META(7));
  l = batch.ledger;
  check("aprobación por lote", !batch.error && [allIds[1], allIds[2]].every((id) => l.records[GEN].editorial!.states[id] === "approved"));
  const bad = decideRecordCards(l, GEN, [allIds[0]], "archive", META(8));
  check("transición ilegal → error sin mutar (cero estados imposibles)", !!bad.error && bad.ledger === l);
  const ag = approveGenerationRecord(l, GEN, META(9));
  l = ag.ledger;
  check("aprobar generación completa", reviewCounts(l.records[GEN])!.approved === allIds.length);

  // Rechazo + bloqueo para "solo aprobadas".
  const draftRes = gen.players.find((p) => p.status === "created" && p.playerId && p.draft)!;
  const draftId = draftRes.playerId!;
  const granted = new Set(gen.grants.filter((g) => g.playerId === draftId).flatMap((g) => variantsForAccolade(g.accolade, draftRes.draft!)));
  const draftBase = gen.cards.find((s) => s.playerId === draftId && !granted.has(s.variantId))!.cardId;
  l = decideRecordCards(l, GEN, ["zekken__mythic", draftBase], "to_review", META(10)).ledger;
  l = decideRecordCards(l, GEN, ["zekken__mythic"], "reject", { ...META(11), reason: "revisión editorial" }).ledger;
  l = decideRecordCards(l, GEN, [draftBase], "block", { ...META(12), reason: "veto editorial" }).ledger;
  check("rechazo y bloqueo aplicados",
    l.records[GEN].editorial!.states["zekken__mythic"] === "rejected" && l.records[GEN].editorial!.states[draftBase] === "blocked");

  // ── 4. PUBLICAR (SOLO aprobadas, vía publishApproved) ──
  console.log("\n## 4. Publicación (Editorial + Publisher)");
  const pr = await publishRecord(l, GEN, { ...META(13), roster: allPlayers() });
  check("publicación aplicada", !pr.error && !!pr.value?.ok, pr.error);
  l = pr.ledger;
  rt = currentRuntimeInfo();
  check("la generación del ejemplo vuelve a estar vigente (live)",
    rt.generationId === GEN && dashboardRow(l, GEN, rt)!.status === "published" && dashboardRow(l, GEN, rt)!.live);
  check("TODAS las publicadas existen en el catálogo", pr.value!.published.length > 0 && pr.value!.published.every((id) => !!getCard(id)));
  check("la rechazada (zekken__mythic) NO llegó al runtime", !getCard("zekken__mythic"));
  check("la bloqueada excluye al jugador nuevo completo", !getPlayer(draftId));
  check("dashboard: published = aprobadas efectivamente publicadas",
    dashboardRow(l, GEN, rt)!.published === pr.value!.published.length);
  check("métricas del registro actualizadas con salidas reales (runtime/catálogo)",
    l.records[GEN].metrics.runtimeVersion === pr.value!.publish!.runtimeVersion &&
    l.records[GEN].metrics.catalogVersion === pr.value!.build!.catalogVersion);
  const prBad = await publishRecord(l, "NO-EXISTE", { ...META(14), roster: allPlayers() });
  check("publicar registro desconocido → error sin mutar", !!prBad.error && prBad.ledger === l);

  // ── 5. GENERAR PARA REVISIÓN (variante REV, sin publicar) ──
  console.log("\n## 5. generateForReview (importar + generar SIN publicar)");
  const snapB: RawSnapshot = JSON.parse(JSON.stringify(run.outputs.vlr!.snapshot));
  snapB.tournament = { ...snapB.tournament, id: `${snapB.tournament.id}-rev`, name: `${snapB.tournament.name} REV` };
  snapB.players = snapB.players.filter((p) => p.nick !== "Wolf5");
  snapB.mapStats = (snapB.mapStats ?? [])
    .filter((s) => s.player !== "Wolf5")
    .map((s) => ({ ...s, acs: (s.acs ?? 0) + 35, kills: (s.kills ?? 0) + 8 }));
  const g4r = generateForReview(l, snapB, { now: NOW + 20, roster: originalPlayers }, META(20));
  check("registro creado desde RawSnapshot (motores públicos)", !g4r.error && g4r.value?.source === "control", g4r.error);
  l = g4r.ledger;
  const BID = g4r.value!.recordId;
  check("el runtime NO cambió (generar para revisión JAMÁS publica)",
    currentRuntimeInfo().generationId === GEN && runtimeGenerationId() === GEN);
  check("estado generated y sin versión de catálogo aún",
    dashboardRow(l, BID, currentRuntimeInfo())!.status === "generated" && l.records[BID].metrics.runtimeVersion === 0);
  const prB0 = await publishRecord(l, BID, { ...META(21), roster: allPlayers() });
  check("publicar sin revisión abierta → rechazado (solo publishApproved)", !!prB0.error && prB0.ledger === l);
  const dupGen = generateForReview(l, snapB, { now: NOW + 20, roster: originalPlayers }, META(22));
  check("regenerar el mismo torneo → rechazado sin mutar", !!dupGen.error && dupGen.ledger === l);

  // ── 6. CICLO COMPLETO DE B: revisar → aprobar → publicar ──
  console.log("\n## 6. Ciclo completo de la variante (in-review → approved → published)");
  l = openReview(l, BID, META(23)).ledger;
  check("estado in-review", dashboardRow(l, BID, currentRuntimeInfo())!.status === "in-review");
  l = approveGenerationRecord(l, BID, META(24)).ledger;
  check("estado approved", dashboardRow(l, BID, currentRuntimeInfo())!.status === "approved");
  const prB = await publishRecord(l, BID, { ...META(25), roster: allPlayers() });
  check("publicación de la variante aplicada", !prB.error && !!prB.value?.ok, prB.error);
  l = prB.ledger;
  rt = currentRuntimeInfo();
  check("la variante pasa a ser la vigente; el ejemplo sigue published (no revertido)",
    rt.generationId === l.records[BID].generationId &&
    dashboardRow(l, BID, rt)!.status === "published" && dashboardRow(l, BID, rt)!.live &&
    dashboardRow(l, GEN, rt)!.status === "published" && !dashboardRow(l, GEN, rt)!.live);

  // ── 7. ROLLBACK (punto de restauración del Publisher) ──
  console.log("\n## 7. Rollback");
  const rb = rollbackRecord(l, GEN, META(30));
  check("rollback aplicado: el runtime vuelve a la publicación del ejemplo", !rb.error, rb.error);
  l = rb.ledger;
  rt = currentRuntimeInfo();
  check("la generación del ejemplo vuelve a estar live", rt.generationId === GEN && dashboardRow(l, GEN, rt)!.live);
  check("estados tras rollback: ejemplo published · variante rolled-back",
    dashboardRow(l, GEN, rt)!.status === "published" && dashboardRow(l, BID, rt)!.status === "rolled-back");
  check("la rechazada sigue SIN existir tras el rollback", !getCard("zekken__mythic"));
  const rbBad = rollbackRecord(l, "NO-EXISTE", META(31));
  check("rollback de registro desconocido → error sin mutar", !!rbBad.error && rbBad.ledger === l);

  // ── 8. DUPLICAR + REABRIR ──
  console.log("\n## 8. Duplicar generación y reabrir revisión");
  const dup = duplicateForReview(l, GEN, META(32));
  l = dup.ledger;
  const DUP = dup.value!.recordId;
  check("duplicado ~R2: MISMA generación, caso editorial NUEVO",
    DUP === `${GEN}~R2` && dup.value!.generation === l.records[GEN].generation &&
    reviewCounts(l.records[DUP])!.review === allIds.length);
  l = decideRecordCards(l, DUP, [allIds[0]], "reject", META(33)).ledger;
  l = decideRecordCards(l, DUP, [allIds[1]], "approve", META(34)).ledger;
  const ro = reopenReview(l, DUP, META(35));
  l = ro.ledger;
  check("reabrir revisión: aprobadas/rechazadas vuelven a review", !ro.error && reviewCounts(l.records[DUP])!.review === allIds.length);
  const ro2 = reopenReview(l, DUP, META(36));
  check("nada que reabrir → error sin mutar", !!ro2.error && ro2.ledger === l);

  // ── 9. COMPARADOR ──
  console.log("\n## 9. Comparador de generaciones");
  const wolfId = gen.players.find((p) => p.nick === "Wolf5")!.playerId!;
  const cmp = compareGenerations(l.records[GEN], l.records[BID]);
  check("cartas eliminadas: las del jugador quitado y la mythic (variante sin MVP)",
    gen.cards.filter((c) => c.playerId === wolfId).every((c) => cmp.removedCards.includes(c.cardId)) &&
    cmp.removedCards.includes("zekken__mythic"));
  check("OVR modificados detectados (stats infladas en la variante)",
    cmp.ovrChanged.length > 0 && cmp.ovrChanged.every((c) => c.to !== c.from), `${cmp.ovrChanged.length} cambios`);
  check("rarezas/badges/colección: diffs coherentes",
    cmp.rarityChanged.every((c) => c.from !== c.to) &&
    cmp.badgesChanged.every((c) => c.added.length + c.removed.length > 0) &&
    cmp.collectionChanged.every((c) => c.inA !== c.inB));
  check("cambios editoriales detectados entre casos distintos", cmp.editorialChanged.length > 0 && !cmp.identical);
  const cmpDup = compareGenerations(l.records[GEN], l.records[DUP]);
  check("original vs duplicado: CERO diffs de cartas, SOLO editoriales",
    cmpDup.addedCards.length === 0 && cmpDup.removedCards.length === 0 && cmpDup.ovrChanged.length === 0 &&
    cmpDup.rarityChanged.length === 0 && cmpDup.badgesChanged.length === 0 && cmpDup.editorialChanged.length > 0);
  check("comparación consigo mismo = idéntica", compareGenerations(l.records[GEN], l.records[GEN]).identical);

  // ── 10. BÚSQUEDA + FILTROS + ORDEN ──
  console.log("\n## 10. Búsqueda, filtros y orden");
  check("búsqueda por torneo", searchControl(l, "london").some((h) => h.kind === "tournament"));
  check("búsqueda por generationId", searchControl(l, GEN.toLowerCase()).some((h) => h.kind === "generation" && h.recordId === GEN));
  check("búsqueda por jugador/carta en varios registros",
    new Set(searchControl(l, "zekken").filter((h) => h.kind === "card").map((h) => h.recordId)).size >= 2);
  check("búsqueda vacía → sin resultados", searchControl(l, "   ").length === 0);
  rt = currentRuntimeInfo();
  rows = buildDashboard(l, rt);
  check("filtro por estado", applyDashboardFilter(rows, { status: "rolled-back" }).length === 1 &&
    applyDashboardFilter(rows, { status: "rolled-back" })[0].recordId === BID);
  check("filtro por origen y por live",
    applyDashboardFilter(rows, { source: "control" }).every((r) => r.recordId === BID) &&
    applyDashboardFilter(rows, { liveOnly: true }).every((r) => r.live && r.generationId === GEN));
  check("filtro por torneo (fragmento de nombre)", applyDashboardFilter(rows, { tournament: "rev" }).length === 1);
  const byCards = sortDashboardRows(rows, "cards", "desc");
  check("orden por cartas desc", byCards.every((r, i) => i === 0 || byCards[i - 1].cards >= r.cards));
  const byName = sortDashboardRows(rows, "tournament");
  check("orden por torneo total y estable", byName.length === rows.length &&
    byName.every((r, i) => i === 0 || byName[i - 1].tournamentName <= r.tournamentName ||
      (byName[i - 1].tournamentName === r.tournamentName && byName[i - 1].recordId <= r.recordId)));

  // ── 11. HISTORIAL ──
  console.log("\n## 11. Historial unificado");
  const h = buildHistory(l);
  check("cronología completa: importación → generación → publicación → rollback → revisión → decisiones",
    (["import", "generate", "publish", "rollback", "open-review", "decision", "duplicate", "reopen-review"] as const)
      .every((k) => h.some((e) => e.kind === k && e.source === "control")));
  check("incluye el historial editorial F4 (submit + transiciones con carta)",
    h.some((e) => e.source === "editorial" && e.kind === "submit") &&
    h.some((e) => e.source === "editorial" && !!e.cardId && !!e.detail));
  check("orden cronológico no decreciente", h.every((e, i) => i === 0 || h[i - 1].at <= e.at));
  check("cada entrada lleva usuario + fecha lógica + generationId",
    h.every((e) => e.actor === "control-admin" && e.at >= NOW && e.generationId.startsWith("GEN-")));
  const hDup = buildHistory(l, DUP);
  check("historial filtrado por registro", hDup.length > 0 && hDup.every((e) => e.recordId === DUP));

  // ── 12. MÉTRICAS ──
  console.log("\n## 12. Métricas");
  const m = buildMetrics(l);
  const recA = l.records[GEN], recB = l.records[BID];
  check("volúmenes = suma de métricas oficiales (duplicados no doblan)",
    m.records === 3 && m.tournaments === 2 &&
    m.teams === recA.metrics.teams + recB.metrics.teams &&
    m.players === recA.metrics.players + recB.metrics.players &&
    m.maps === recA.metrics.maps + recB.metrics.maps &&
    m.cardsGenerated === recA.metrics.cardsGenerated + recB.metrics.cardsGenerated);
  check("tiempo total y por etapa (8 etapas del run oficial)",
    m.totalMs === recA.metrics.totalMs + recB.metrics.totalMs && run.metrics.stages.length === 8 &&
    m.stages.length === 8);
  check("materializaciones, publicaciones y rollbacks proyectados",
    m.cardsMaterialized > 0 && m.cardsPublished > 0 && m.publications === 3 && m.rollbacks === 1);
  const expectedEditorial = [recA, recB, l.records[DUP]].filter((r) => r.editorial).map((r) => stateCounts(r.editorial!));
  check("agregado editorial cuadra con los casos",
    m.editorial.published === expectedEditorial.reduce((a, c) => a + c.published, 0) &&
    m.editorial.review === expectedEditorial.reduce((a, c) => a + c.review, 0) &&
    m.editorial.rejected === expectedEditorial.reduce((a, c) => a + c.rejected, 0));
  const report = buildReport(l, GEN, rt, NOW + 99);
  check("informe exportable completo (fila + métricas + editorial + historial)",
    !!report && report.row.generationId === GEN && report.metrics.generationId === GEN &&
    !!report.editorial && report.history.length > 0);
  check("informe de registro desconocido → null", buildReport(l, "NADA", rt, NOW) === null);

  // ── 13. DETERMINISMO ──
  console.log("\n## 13. Determinismo");
  const rtFixed: RuntimeInfo = { runtimeVersion: 7, generationId: GEN };
  const replay = (): ControlLedger => {
    let x = createLedger();
    x = ingestRun(x, run, META(0)).ledger;
    x = openReview(x, GEN, META(4)).ledger;
    x = decideRecordCards(x, GEN, [allIds[0]], "approve", META(6)).ledger;
    x = duplicateForReview(x, GEN, META(32)).ledger;
    return x;
  };
  check("misma secuencia de acciones ⇒ ledger byte a byte", JSON.stringify(replay()) === JSON.stringify(replay()));
  check("proyecciones deterministas (dashboard/historial/métricas/búsqueda/comparador)",
    JSON.stringify(buildDashboard(l, rtFixed)) === JSON.stringify(buildDashboard(l, rtFixed)) &&
    JSON.stringify(buildHistory(l)) === JSON.stringify(buildHistory(l)) &&
    JSON.stringify(buildMetrics(l)) === JSON.stringify(buildMetrics(l)) &&
    JSON.stringify(searchControl(l, "zekken")) === JSON.stringify(searchControl(l, "zekken")) &&
    JSON.stringify(compareGenerations(l.records[GEN], l.records[BID])) === JSON.stringify(compareGenerations(l.records[GEN], l.records[BID])));

  // ── 14. RENDIMIENTO ──
  console.log("\n## 14. Rendimiento");
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    buildDashboard(l, rtFixed);
    searchControl(l, "zekken");
    buildHistory(l);
    buildMetrics(l);
    compareGenerations(l.records[GEN], l.records[BID]);
  }
  const ms = Date.now() - t0;
  check("200 iteraciones de TODAS las proyecciones en tiempo razonable", ms < 3000, `${ms} ms`);

  // ── 15. CERO ESTADOS IMPOSIBLES ──
  console.log("\n## 15. Cero estados imposibles");
  rows = buildDashboard(l, currentRuntimeInfo());
  check("todo estado del panel pertenece al conjunto oficial", rows.every((r) => RECORD_STATUSES.includes(r.status)));
  check("los contadores editoriales cuadran con el total de cartas",
    rows.every((r) => {
      const rec = l.records[r.recordId];
      return !rec.editorial ||
        r.approved + r.pending + r.blocked + r.rejected + r.hidden + r.published + r.archived === r.cards;
    }));
  check("historiales editoriales íntegros en todos los casos",
    l.order.every((id) => !l.records[id].editorial || auditHistory(l.records[id].editorial!).length === 0));
  check("secuencia de eventos de control estrictamente monótona",
    l.events.every((e, i) => i === 0 || e.seq > l.events[i - 1].seq));
  check("ledger 100% serializable (persistible en el store)", (() => {
    const j = JSON.parse(JSON.stringify(l)) as ControlLedger;
    return j.order.length === l.order.length && j.events.length === l.events.length &&
      Object.keys(j.records).length === Object.keys(l.records).length;
  })());

  // ── RESTAURACIÓN ──
  resetRuntime();
  rebuildCatalog(originalPlayers);
  check("catálogo semilla restaurado al terminar", totalCards() === originalTotal);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
