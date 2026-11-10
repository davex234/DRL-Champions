/**
 * FASE 24.4 · INSTRUMENTO DE QA DE LA ESTRUCTURA DEL CUADRO (fuera de package.json y de CI).
 *
 *   E2E_BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_fase24-4-qa.ts
 *
 * TRES PARTES, etiquetadas en cada captura:
 *
 *   A. APP REAL (`next start`, sin backend): rutas de Pick'ems y regresión cargan sin
 *      excepciones ni desbordamiento (1440 / 390).
 *
 *   B. REAL SOURCE → REAL IMPORTED (sin BD): se descargan de vlr.gg las páginas de un torneo
 *      real (Champions 2026, aún sin jugar; y Champions 2025, terminado) con el importador
 *      REAL (`importVlrTournament`, sin páginas de detalle), se pasa por el adaptador de sync
 *      (`snapshotToSource`) y por el dominio (`buildBracketModel`) y se renderiza el cuadro.
 *      No se escribe en ninguna base de datos: es el pipeline real hasta la fila que el sync
 *      escribiría. Si no hay red, esta parte se documenta como no ejecutada.
 *
 *   C. FIXTURES (QA SYNTHETIC): escenarios que no existen hoy en la fuente (doble eliminación
 *      con perdedores confirmados, historial), a 1440 y 390.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { launch, sleep } from "./lib/cdp";
import { importVlrTournament } from "@/importer-vlr/engine";
import { snapshotToSource } from "@/lib/esports/sync/vlrSnapshotSource";
import { BracketPickemView } from "@/components/pickems/bracket/BracketPickemView";
import { buildBracketModel, edgeKey, type BracketMatchInput, type StageLike } from "@/domain/pickems/bracket";
import type { PickemQuestion } from "@/lib/game/client";
import type { AnswerMap } from "@/domain/pickems/progress";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(ROOT, "docs", "product", "qa", "fase24-4");
mkdirSync(OUT, { recursive: true });

const results: { label: string; ok: boolean; detail?: string }[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const isNetwork = (e: string) => /Failed to fetch|fetch failed|ERR_CONNECTION|ECONNREFUSED|NetworkError|net::/i.test(e);
const isResource = (e: string) => /Failed to load resource/i.test(e);
const NOW = Date.now();

/* ═══════════════════════════ A · APP REAL ═══════════════════════════ */

async function partA() {
  console.log("\n# A · App real (sin backend en este entorno)\n");
  const browser = await launch({ width: 1440, height: 960 });
  const { tab } = browser;
  try {
    for (const route of ["/pickems", "/pickems/historial", "/ranking", "/torneos", "/coleccion", "/inventario", "/packs", "/duelos", "/progresion", "/tienda", "/mercado"]) {
      for (const [w, hh] of [[1440, 960], [390, 844]] as const) {
        await tab.resize(w, hh);
        await tab.goto(`${BASE}${route}`, 3500);
        const real = tab.takeErrors().filter((e) => !isNetwork(e) && !isResource(e));
        const overflow = await tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
        check(`${route} @${w} sin excepciones de la app ni desbordamiento`, real.length === 0 && Number(overflow) <= 0, real[0]?.slice(0, 80) ?? "");
      }
    }
  } finally { await browser.close(); }
}

/* ═══════════════════════════ B · REAL SOURCE → REAL IMPORTED ═══════════════════════════ */

const CONNECT_JS = (edges: unknown) => `
(() => {
  const root = document.querySelector('.nx-bracket-scroll'); if (!root) return;
  const content = root.firstElementChild; const edges = ${JSON.stringify(edges)};
  const base = root.getBoundingClientRect(); const boxes = new Map();
  root.querySelectorAll('[data-match-id]').forEach(el => boxes.set(el.dataset.matchId, el.getBoundingClientRect()));
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden','true'); svg.setAttribute('width', root.scrollWidth); svg.setAttribute('height', root.scrollHeight);
  svg.setAttribute('viewBox','0 0 ' + root.scrollWidth + ' ' + root.scrollHeight); svg.style.cssText='position:absolute;left:0;top:0;pointer-events:none';
  let n = 0;
  for (const e of edges) {
    const a = boxes.get(e.from), b = boxes.get(e.to); if (!a || !b) continue;
    const x1 = a.right - base.left + root.scrollLeft, y1 = a.top + a.height/2 - base.top + root.scrollTop;
    const x2 = b.left - base.left + root.scrollLeft, y2 = b.top + (e.slot === 'a' ? b.height*0.36 : e.slot === 'b' ? b.height*0.64 : b.height*0.5) - base.top + root.scrollTop;
    let d;
    if (x2 > x1 + 4) { const mx = x1 + (x2-x1)/2; d = 'M ' + x1 + ' ' + y1 + ' H ' + mx + ' V ' + y2 + ' H ' + x2; }
    else if (b.top > a.bottom) { const cx1 = a.left + a.width/2 - base.left + root.scrollLeft, cx2 = b.left + b.width/2 - base.left + root.scrollLeft, by1 = a.bottom - base.top + root.scrollTop, by2 = b.top - base.top + root.scrollTop, my = by1 + (by2-by1)/2; d = 'M ' + cx1 + ' ' + by1 + ' V ' + my + ' H ' + cx2 + ' V ' + by2; }
    else if (b.bottom < a.top) { const cx1 = a.left + a.width/2 - base.left + root.scrollLeft, cx2 = b.left + b.width/2 - base.left + root.scrollLeft, ty1 = a.top - base.top + root.scrollTop, ty2 = b.bottom - base.top + root.scrollTop, my = ty2 + (ty1-ty2)/2; d = 'M ' + cx1 + ' ' + ty1 + ' V ' + my + ' H ' + cx2 + ' V ' + ty2; }
    else continue;
    for (const [stroke, w, dash, glow, op] of [['rgba(0,0,0,0.6)', 4, null, false, 1], [e.source === 'WINNER' ? '#19e3ff' : 'rgba(238,241,248,0.35)', 1.5, e.source === 'LOSER' ? '5 4' : null, e.source === 'WINNER', e.kind === 'STRUCTURAL' ? 0.75 : 1]]) {
      const p = document.createElementNS(ns,'path'); p.setAttribute('d', d); p.setAttribute('fill','none'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', w); p.setAttribute('stroke-linejoin','round'); p.setAttribute('opacity', op);
      if (dash) p.setAttribute('stroke-dasharray', dash); if (glow) p.style.filter = 'drop-shadow(0 0 4px rgba(25,227,255,0.45))'; svg.appendChild(p);
    }
    n++;
  }
  svg.dataset.connectors = String(n);
  svg.dataset.candidates = String(edges.filter(e => boxes.has(e.from) && boxes.has(e.to)).length);
  content.prepend(svg);
})();`;

function page(title: string, banner: string, body: string, css: string, edges: unknown): string {
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8"><base href="${BASE}/">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="${css}"></head>
<body class="bg-base-900 text-white antialiased" style="margin:0">
<div style="position:fixed;top:0;left:0;right:0;z-index:99;background:#7a1b1b;color:#fff;font:600 11px/1.4 system-ui;padding:3px 10px;letter-spacing:.06em;text-transform:uppercase">${banner}</div>
<main class="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6">${body}</main>
<script>${CONNECT_JS(edges)}</script></body></html>`;
}

async function shoot(tab: Awaited<ReturnType<typeof launch>>["tab"], name: string, banner: string, model: ReturnType<typeof buildBracketModel>, questions: PickemQuestion[], answers: AnswerMap, readOnly: boolean, css: string) {
  const drawable = model.edges.map((e) => ({ ...e, kind: model.edgeMeta[edgeKey(e)]?.kind }));
  for (const [w, hh, mode] of [[1440, 960, "desktop"], [390, 844, "mobile"]] as const) {
    const body = renderToStaticMarkup(h("div", { className: "space-y-4" },
      h("h1", { className: "font-display text-[clamp(22px,3.4vw,32px)] font-bold uppercase leading-none text-white" }, name.replace(/-/g, " ")),
      h(BracketPickemView, { model, questions, answers, now: NOW, saving: null, feedback: null, canPick: !readOnly, readOnly, showResolved: readOnly, onPick: () => undefined, bracketMode: mode }),
    ));
    const file = join(OUT, `_qa-${name}-${mode}.html`);
    writeFileSync(file, page(`QA · ${name}`, banner, body, css, mode === "desktop" ? drawable : []));
    await tab.resize(w, hh);
    await tab.goto(`file:///${file.replace(/\\/g, "/")}`, 1200);
    await sleep(300);
    const overflow = await tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
    const lines = await tab.js<number>(`Number(document.querySelector("svg[data-connectors]")?.dataset.connectors ?? 0)`);
    const candidates = await tab.js<number>(`Number(document.querySelector("svg[data-connectors]")?.dataset.candidates ?? 0)`);
    const small = await tab.js<number>(`[...document.querySelectorAll("button")].filter(b => b.getBoundingClientRect().height < 44 && b.getBoundingClientRect().height > 0).length`);
    check(`${name} @${w}: sin desbordamiento, botones ≥ 44px`, Number(overflow) <= 0 && Number(small) === 0, `${overflow}px · ${small} pequeños`);
    if (mode === "desktop") check(`${name} @${w}: líneas dibujadas = aristas con los dos extremos en la fase visible`, Number(lines) === Number(candidates) && Number(candidates) > 0, `${lines} / ${candidates} (modelo: ${model.edges.length})`);
    const height = await tab.js<number>("document.documentElement.scrollHeight");
    await tab.resize(w, Math.min(Number(height) + 20, 7000));
    await sleep(250);
    await tab.shot(join(OUT, `${name}-${w}.png`));
  }
}

async function realImported(url: string, tag: string, tab: Awaited<ReturnType<typeof launch>>["tab"], css: string) {
  console.log(`\n## REAL SOURCE · ${url}`);
  let out;
  try {
    out = await importVlrTournament(url, { includeMatchDetails: false });
  } catch (e) {
    check(`${tag}: descarga de la fuente real`, false, e instanceof Error ? e.message : String(e));
    return;
  }
  const st = out.meta.structure!;
  check(`${tag}: importador real → cuadro presente, ${st.edges} aristas, ${st.qualification} clasificaciones, ${st.unknown} desconocidas, ${st.conflicts} conflictos`, st.present && st.conflicts === 0);
  const { source } = snapshotToSource(out.snapshot, { eventId: `vlr-${out.ref.eventId}`, agents: new Map(), maps: new Map() });
  const [raw, teams, stages] = await Promise.all([source.getMatches(`vlr-${out.ref.eventId}`), source.getTeams(`vlr-${out.ref.eventId}`), source.getStages(`vlr-${out.ref.eventId}`)]);
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const stageId = (slug?: string) => (slug ? `st-${slug}` : null);
  const stagesLike: StageLike[] = stages.map((s, i) => ({ id: `st-${s.slug}`, name: s.name, kind: s.kind ?? null, order_idx: s.orderIdx ?? i }));
  // La misma proyección que hará el sync al escribir `matches` (+ las columnas 0045 de `progressionRow`).
  const matches: BracketMatchInput[] = raw.map((m) => ({
    id: m.id, stage_id: stageId(m.stageSlug), team_a: nameOf.get(m.teamAId) ?? null, team_b: nameOf.get(m.teamBId) ?? null,
    team_a_id: m.teamAId, team_b_id: m.teamBId, start_time: m.startTime ?? null, status: m.status ?? "upcoming",
    score_a: m.scoreA ?? null, score_b: m.scoreB ?? null, winner_team_id: m.winnerTeamId ?? null, winner_team: m.winnerTeamId ? nameOf.get(m.winnerTeamId) ?? null : null,
    round: m.round ?? null, match_order: m.matchOrder ?? null,
    winner_to_match_id: m.progression?.winnerTo?.matchId ?? null, winner_to_slot: m.progression?.winnerTo?.slot ?? null,
    loser_to_match_id: m.progression?.loserTo?.matchId ?? null, loser_to_slot: m.progression?.loserTo?.slot ?? null,
    winner_qualifies: m.progression?.winnerQualifies?.key ?? null, winner_qualifies_label: m.progression?.winnerQualifies?.label ?? null,
    progression_evidence: m.progression?.evidence ?? null, progression_confidence: m.progression?.confidence ?? null,
  }));
  // Los equipos «TBD» de la fuente no son equipos: se dejan en blanco, como hará el sync (equipo no resuelto).
  for (const m of matches) { if (/^tbd$/i.test(m.team_a ?? "")) m.team_a = null; if (/^tbd$/i.test(m.team_b ?? "")) m.team_b = null; }
  const model = buildBracketModel({ stages: stagesLike, matches, questions: [], answers: {}, now: NOW });
  const structural = model.edges.filter((e) => model.edgeMeta[edgeKey(e)].kind === "STRUCTURAL").length;
  check(`${tag}: modelo ${model.format}, ${model.rounds.length} rondas, ${model.edges.length} aristas (${structural} estructurales), ${model.qualificationNodes.length} clasificados, ${model.conflicts.length} conflictos`, model.reliable && model.conflicts.length === 0);
  writeFileSync(join(OUT, `_real-${tag}.json`), JSON.stringify({ url, meta: out.meta, warnings: out.warnings, edges: model.edges, edgeMeta: model.edgeMeta, qualificationNodes: model.qualificationNodes, conflicts: model.conflicts, issues: model.issues }, null, 2));
  await shoot(tab, `real-${tag}`, `REAL IMPORTED · ${url} · PIPELINE REAL SIN BD · NO ES UNA PRUEBA DE PERSISTENCIA`, model, [], {}, false, css);
}

/* ═══════════════════════════ C · FIXTURES ═══════════════════════════ */

const at = (hh: number) => new Date(NOW + hh * 3600_000).toISOString();
const Cf = { progression_evidence: "SOURCE_STRUCTURED_HTML", progression_confidence: "CONFIRMED" } as const;
const mm = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({
  id, stage_id: "st-po", team_a: null, team_b: null, start_time: at(24), status: "upcoming", score_a: null, score_b: null, round: null, match_order: null, ...over,
});
const done = (id: string, a: string, b: string, round: string, sa: number, sb: number, hh: number, extra: Partial<BracketMatchInput> = {}) =>
  mm(id, { team_a: a, team_b: b, round, score_a: sa, score_b: sb, winner_team: sa > sb ? a : b, status: "finished", start_time: at(hh), ...extra });
const pq = (id: string, matchId: string, over: Partial<PickemQuestion> = {}): PickemQuestion => ({
  id, pickem_event_id: "e1", kind: "match_winner", match_id: matchId, prompt: "¿Quién gana?", points: 15, locks_at: at(24), order_idx: 0, locked: false, correct_option: null,
  options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], ...over,
});
const PLAYOFF: StageLike[] = [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }];

/** Doble eliminación con perdedores CONFIRMADOS (lo que una fuente explícita podría publicar). */
const dblConfirmed = (): BracketMatchInput[] => [
  done("u1", "Fnatic", "KOI", "Upper Semifinal", 2, 0, -50, { match_order: 1, ...Cf, winner_to_match_id: "uf", winner_to_slot: 1, loser_to_match_id: "l1", loser_to_slot: 1 }),
  mm("u2", { team_a: "Team Heretics", team_b: "Team Liquid", round: "Upper Semifinal", match_order: 2, start_time: at(2), ...Cf, winner_to_match_id: "uf", winner_to_slot: 2, loser_to_match_id: "l1", loser_to_slot: 2 }),
  mm("uf", { team_a: "Fnatic", round: "Upper Final", start_time: at(30), ...Cf, winner_to_match_id: "gf", winner_to_slot: 1, loser_to_match_id: "lf", loser_to_slot: 1 }),
  mm("l1", { team_a: "KOI", round: "Lower Round 1", start_time: at(20), ...Cf, winner_to_match_id: "lf", winner_to_slot: 2 }),
  mm("lf", { round: "Lower Final", start_time: at(40), ...Cf, winner_to_match_id: "gf", winner_to_slot: 2 }),
  mm("gf", { round: "Grand Final", start_time: at(60) }),
];
const dblQuestions = [pq("d1", "u1", { locked: true, locks_at: at(-50), correct_option: "a" }), pq("d2", "u2", { locks_at: at(2), points: 20 })];
const dblAnswers: AnswerMap = { d1: { option: "a", isCorrect: true, pointsAward: 15 }, d2: { option: "b", isCorrect: null, pointsAward: null } };

async function main() {
  await partA();
  const cssFile = readdirSync(join(ROOT, ".next", "static", "chunks")).find((f) => f.endsWith(".css"));
  if (!cssFile) throw new Error("No hay CSS compilado: ejecuta `npm run build` antes.");
  const css = `/_next/static/chunks/${cssFile}`;
  const browser = await launch({ width: 1440, height: 960 });
  try {
    console.log("\n# B · Fuente real → importador real → dominio (sin BD)\n");
    await realImported("https://www.vlr.gg/event/2766/valorant-champions-2026", "champions-2026-pre", browser.tab, css);
    await realImported("https://www.vlr.gg/event/2283/valorant-champions-2025", "champions-2025-final", browser.tab, css);

    console.log("\n# C · Fixtures (QA SYNTHETIC)\n");
    const dbl = buildBracketModel({ stages: PLAYOFF, matches: dblConfirmed(), questions: dblQuestions, answers: dblAnswers, now: NOW });
    check("fixture doble: perdedores confirmados → aristas LOSER antes del resultado", dbl.edges.filter((e) => e.source === "LOSER").length === 3 && dbl.conflicts.length === 0);
    await shoot(browser.tab, "fixture-double-confirmed", "QA SYNTHETIC · FIXTURE ETIQUETADO · NO ES UNA PRUEBA REAL", dbl, dblQuestions, dblAnswers, false, css);
    await shoot(browser.tab, "fixture-historial", "QA SYNTHETIC · FIXTURE ETIQUETADO · HISTORIAL SOLO LECTURA", dbl, dblQuestions, dblAnswers, true, css);
  } finally { await browser.close(); }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n━━━ Resultado: ${results.length - bad.length} ✓ / ${bad.length} ✗ ━━━`);
  writeFileSync(join(OUT, "_resultados.json"), JSON.stringify(results, null, 2));
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error("💥", e instanceof Error ? e.stack : e); process.exit(1); });
