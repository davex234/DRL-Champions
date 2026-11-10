/**
 * FASE 24.3 · INSTRUMENTO DE QA DEL CUADRO (fuera de package.json y de CI).
 *
 *   E2E_BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_fase24-3-qa.ts
 *
 *   A. APP REAL (`next start`): rutas de Pick'ems y de regresión cargan sin excepciones ni
 *      desbordamiento a 1440 / 1024 / 390. En este entorno NO hay backend (Supabase local
 *      caído): se ve la degradación honesta, no el flujo vivo.
 *
 *   B. RENDER ESTÁTICO con FIXTURES etiquetados, CSS de la build y logos servidos por la app:
 *      eliminación simple (forma del seed de demo), doble eliminación, grupos GSL
 *      (Opening/Winners/Decider) y grupos + playoffs, a 1440 / 1024 / 390. Las líneas SVG se
 *      miden en el navegador (necesitan DOM): se hidrata el conector con un script mínimo
 *      que reproduce la misma geometría que `BracketConnector`.
 *      NO es una prueba de datos reales: valida diseño, estructura, responsive y overflow.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { launch, sleep } from "./lib/cdp";
import { BracketPickemView } from "@/components/pickems/bracket/BracketPickemView";
import { buildBracketModel, type BracketMatchInput, type StageLike } from "@/domain/pickems/bracket";
import type { PickemQuestion } from "@/lib/game/client";
import type { AnswerMap } from "@/domain/pickems/progress";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(ROOT, "docs", "product", "qa", "fase24-3");
mkdirSync(OUT, { recursive: true });

const results: { label: string; ok: boolean; detail?: string }[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const isNetwork = (e: string) => /Failed to fetch|fetch failed|ERR_CONNECTION|ECONNREFUSED|NetworkError|net::/i.test(e);
const isResource = (e: string) => /Failed to load resource/i.test(e);
const VIEWPORTS: [number, number][] = [[1440, 960], [1024, 820], [390, 844]];

/* ═══════════════════════════ A · APP REAL ═══════════════════════════ */

async function partA() {
  console.log("\n# A · App real (sin backend en este entorno)\n");
  const browser = await launch({ width: 1440, height: 960 });
  const { tab } = browser;
  const routes = ["/pickems", "/pickems/historial", "/ranking", "/torneos", "/coleccion", "/inventario", "/packs", "/duelos", "/progresion", "/tienda", "/mercado"];
  try {
    for (const route of routes) {
      for (const [w, hh] of VIEWPORTS) {
        await tab.resize(w, hh);
        await tab.goto(`${BASE}${route}`, 3500);
        const errs = tab.takeErrors();
        const real = errs.filter((e) => !isNetwork(e) && !isResource(e));
        const overflow = await tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
        const text = await tab.js<number>("document.body.innerText.length");
        check(`${route} @${w} carga, sin excepciones de la app, sin desbordamiento`, Number(text) > 40 && real.length === 0 && Number(overflow) <= 0,
          real[0]?.slice(0, 80) ?? (Number(overflow) > 0 ? `${overflow}px` : ""));
        if (route === "/pickems") await tab.shot(join(OUT, `app-pickems-${w}.png`));
      }
    }
  } finally { await browser.close(); }
}

/* ═══════════════════════════ B · RENDER ESTÁTICO (FIXTURES) ═══════════════════════════ */

const NOW = Date.now();
const at = (hh: number) => new Date(NOW + hh * 3600_000).toISOString();
const mm = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({
  id, stage_id: "st-po", team_a: null, team_b: null, start_time: at(24), status: "upcoming",
  score_a: null, score_b: null, round: null, match_order: null, ...over,
});
const done = (id: string, a: string, b: string, round: string, sa: number, sb: number, hh: number, extra: Partial<BracketMatchInput> = {}) =>
  mm(id, { team_a: a, team_b: b, round, score_a: sa, score_b: sb, winner_team: sa > sb ? a : b, status: "finished", start_time: at(hh), ...extra });
const pq = (id: string, matchId: string | null, over: Partial<PickemQuestion> = {}): PickemQuestion => ({
  id, pickem_event_id: "e1", kind: "match_winner", match_id: matchId, prompt: "¿Quién gana?", points: 15,
  locks_at: at(24), order_idx: 0, locked: false, correct_option: null,
  options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], ...over,
});
const PLAYOFF: StageLike[] = [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }];

/** FIXTURE 1 · eliminación simple a 8: la forma exacta del seed de demo (Cuartos/Semifinal/Final). */
const single = {
  stages: PLAYOFF,
  matches: [
    done("qf1", "Team Heretics", "Karmine Corp", "Cuartos", 2, 0, -72, { match_order: 1 }),
    done("qf2", "Fnatic", "Team Liquid", "Cuartos", 1, 2, -48, { match_order: 2 }),
    mm("qf3", { team_a: "NRG", team_b: "Sentinels", round: "Cuartos", match_order: 3, status: "live", score_a: 1, score_b: 1, start_time: at(-1) }),
    mm("qf4", { team_a: "Gen.G", team_b: "DRX", round: "Cuartos", match_order: 4, start_time: at(26) }),
    mm("sf1", { team_a: "Team Heretics", team_b: "Team Liquid", round: "Semifinal", match_order: 5, start_time: at(72) }),
    mm("sf2", { round: "Semifinal", match_order: 6, start_time: at(96) }),
    mm("f", { round: "Final", match_order: 7, start_time: at(144) }),
  ],
  questions: [
    pq("q1", "qf1", { locked: true, locks_at: at(-72), correct_option: "a", points: 10 }),
    pq("q2", "qf2", { locked: true, locks_at: at(-48), correct_option: "b", points: 10 }),
    pq("q3", "qf3", { locked: true, locks_at: at(-1), points: 10 }),
    pq("q4", "qf4", { locks_at: at(26), points: 10 }),
    pq("q5", "sf1", { locks_at: at(72), points: 15 }),
    pq("q6", "sf2", { locks_at: at(96), points: 15 }),
    pq("champ", null, { kind: "champion", prompt: "¿Quién será campeón?", points: 50, locks_at: at(26), options: ["Team Heretics", "Fnatic", "Team Liquid", "Karmine Corp", "NRG", "Sentinels", "Gen.G", "DRX"].map((t) => ({ key: t.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: t })) }),
  ],
  answers: {
    q1: { option: "a", isCorrect: true, pointsAward: 10 },
    q2: { option: "a", isCorrect: false, pointsAward: 0 },
    q5: { option: "b", isCorrect: null, pointsAward: null },
    champ: { option: "team-heretics", isCorrect: null, pointsAward: null },
  } as AnswerMap,
};

/** FIXTURE 2 · doble eliminación (etiquetas oficiales VLR). */
const dbl = {
  stages: PLAYOFF,
  matches: [
    done("u1", "Fnatic", "KOI", "Upper Quarterfinal", 2, 0, -120, { match_order: 1 }),
    done("u2", "Team Heretics", "Natus Vincere", "Upper Quarterfinal", 2, 1, -118, { match_order: 2 }),
    done("u3", "Team Liquid", "Gen.G", "Upper Quarterfinal", 0, 2, -116, { match_order: 3 }),
    done("u4", "Karmine Corp", "Paper Rex", "Upper Quarterfinal", 2, 1, -114, { match_order: 4 }),
    done("us1", "Fnatic", "Team Heretics", "Upper Semifinal", 1, 2, -80, { match_order: 5 }),
    mm("us2", { team_a: "Gen.G", team_b: "Karmine Corp", round: "Upper Semifinal", match_order: 6, status: "live", score_a: 1, score_b: 0, start_time: at(-1) }),
    mm("uf", { team_a: "Team Heretics", round: "Upper Final", match_order: 7, start_time: at(48) }),
    done("l1", "KOI", "Natus Vincere", "Lower Round 1", 2, 1, -90, { match_order: 8 }),
    done("l2", "Team Liquid", "Paper Rex", "Lower Round 1", 2, 0, -88, { match_order: 9 }),
    mm("l3", { team_a: "KOI", team_b: "Fnatic", round: "Lower Round 2", match_order: 10, start_time: at(20) }),
    mm("l4", { team_a: "Team Liquid", round: "Lower Round 2", match_order: 11, start_time: at(22) }),
    mm("l5", { round: "Lower Round 3", match_order: 12, start_time: at(60) }),
    mm("lf", { round: "Lower Final", match_order: 13, start_time: at(80) }),
    mm("gf", { round: "Grand Final", match_order: 14, start_time: at(120) }),
  ],
  questions: [
    pq("d1", "u1", { locked: true, locks_at: at(-120), correct_option: "a" }),
    pq("d2", "us1", { locked: true, locks_at: at(-80), correct_option: "b", points: 20 }),
    pq("d3", "us2", { locked: true, locks_at: at(-1), points: 20 }),
    pq("d4", "l3", { locks_at: at(20) }),
  ],
  answers: {
    d1: { option: "a", isCorrect: true, pointsAward: 15 },
    d2: { option: "a", isCorrect: false, pointsAward: 0 },
    d3: { option: "a", isCorrect: null, pointsAward: null },
    d4: { option: "a", isCorrect: null, pointsAward: null },
  } as AnswerMap,
};

/** FIXTURE 3 · grupo GSL: Opening → Winners / Elimination → Decider. */
const gsl = {
  stages: [{ id: "st-g", name: "Group A", kind: "group", order_idx: 0 }] as StageLike[],
  matches: [
    done("o1", "Fnatic", "KOI", "Opening (A)", 2, 1, -50, { stage_id: "st-g", match_order: 1 }),
    done("o2", "Team Heretics", "Paper Rex", "Opening (A)", 0, 2, -48, { stage_id: "st-g", match_order: 2 }),
    done("w", "Fnatic", "Paper Rex", "Winners (A)", 2, 0, -30, { stage_id: "st-g", match_order: 3 }),
    done("e", "KOI", "Team Heretics", "Elimination (A)", 1, 2, -28, { stage_id: "st-g", match_order: 4 }),
    mm("d", { stage_id: "st-g", team_a: "Paper Rex", team_b: "Team Heretics", round: "Decider (A)", match_order: 5, start_time: at(30) }),
  ],
  questions: [pq("g1", "d", { locks_at: at(30), points: 12 })],
  answers: {} as AnswerMap,
};

/** FIXTURE 4 · grupos (jornadas) + playoffs: pestañas de fase. */
const mixed = {
  stages: [{ id: "st-g", name: "Fase de grupos", kind: "group", order_idx: 0 }, ...PLAYOFF] as StageLike[],
  matches: [
    done("g1", "Fnatic", "KOI", "Week 1", 2, 0, -300, { stage_id: "st-g" }),
    mm("g2", { stage_id: "st-g", team_a: "Team Heretics", team_b: "Gen.G", round: "Week 2", start_time: at(-200), status: "finished", score_a: 2, score_b: 1, winner_team: "Team Heretics" }),
    ...single.matches,
  ],
  questions: [pq("gq1", "g1", { locked: true, locks_at: at(-300), correct_option: "a" }), ...single.questions],
  answers: { gq1: { option: "a", isCorrect: true, pointsAward: 10 }, ...single.answers } as AnswerMap,
};

/** Reproduce `BracketConnector.measure` en la página estática (sin React) para poder capturar las líneas. */
const CONNECT_JS = (edges: unknown) => `
(() => {
  const root = document.querySelector('.nx-bracket-scroll'); if (!root) return;
  const content = root.firstElementChild;
  const edges = ${JSON.stringify(edges)};
  const base = root.getBoundingClientRect();
  const boxes = new Map(); root.querySelectorAll('[data-match-id]').forEach(el => boxes.set(el.dataset.matchId, el.getBoundingClientRect()));
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('width', root.scrollWidth); svg.setAttribute('height', root.scrollHeight);
  svg.setAttribute('viewBox', '0 0 ' + root.scrollWidth + ' ' + root.scrollHeight);
  svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  let n = 0;
  for (const e of edges) {
    const a = boxes.get(e.from), b = boxes.get(e.to); if (!a || !b) continue;
    const x1 = a.right - base.left + root.scrollLeft, y1 = a.top + a.height/2 - base.top + root.scrollTop;
    const x2 = b.left - base.left + root.scrollLeft, y2 = b.top + (e.slot === 'a' ? b.height*0.36 : b.height*0.64) - base.top + root.scrollTop;
    let d;
    if (x2 > x1 + 4) { const mx = x1 + (x2-x1)/2; d = 'M ' + x1 + ' ' + y1 + ' H ' + mx + ' V ' + y2 + ' H ' + x2; }
    else if (b.top > a.bottom) { const cx1 = a.left + a.width/2 - base.left + root.scrollLeft, cx2 = b.left + b.width/2 - base.left + root.scrollLeft, by1 = a.bottom - base.top + root.scrollTop, by2 = b.top - base.top + root.scrollTop, my = by1 + (by2-by1)/2; d = 'M ' + cx1 + ' ' + by1 + ' V ' + my + ' H ' + cx2 + ' V ' + by2; }
    else continue;
    for (const [stroke, w, dash, glow] of [['rgba(0,0,0,0.6)', 4, null, false], [e.source === 'WINNER' ? '#19e3ff' : 'rgba(238,241,248,0.35)', 1.5, e.source === 'LOSER' ? '5 4' : null, e.source === 'WINNER']]) {
      const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', w); p.setAttribute('stroke-linejoin', 'round');
      if (dash) p.setAttribute('stroke-dasharray', dash); if (glow) p.style.filter = 'drop-shadow(0 0 4px rgba(25,227,255,0.45))'; svg.appendChild(p);
    }
    n++;
  }
  svg.dataset.connectors = String(n); content.prepend(svg);
})();`;

function page(title: string, body: string, css: string, edges: unknown): string {
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8"><base href="${BASE}/">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="${css}"></head>
<body class="bg-base-900 text-white antialiased" style="margin:0">
<div style="position:fixed;top:0;left:0;right:0;z-index:99;background:#7a1b1b;color:#fff;font:600 11px/1.4 system-ui;padding:3px 10px;letter-spacing:.06em;text-transform:uppercase">QA ESTÁTICA · FIXTURE ETIQUETADO · NO ES UNA PRUEBA REAL</div>
<main class="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6">${body}</main>
<script>${CONNECT_JS(edges)}</script></body></html>`;
}

async function partB() {
  console.log("\n# B · Render estático del cuadro con fixtures (validación de diseño)\n");
  const cssFile = readdirSync(join(ROOT, ".next", "static", "chunks")).find((f) => f.endsWith(".css"));
  if (!cssFile) throw new Error("No hay CSS compilado: ejecuta `npm run build` antes.");
  const css = `/_next/static/chunks/${cssFile}`;

  const fixtures: [string, typeof single, boolean][] = [["single", single, false], ["double", dbl, false], ["gsl", gsl, false], ["mixed", mixed, false], ["historial", single, true]];
  const browser = await launch({ width: 1440, height: 960 });
  const { tab } = browser;
  try {
    for (const [name, fx, readOnly] of fixtures) {
      const model = buildBracketModel({ stages: fx.stages, matches: fx.matches, questions: fx.questions, answers: fx.answers, now: NOW });
      check(`fixture ${name}: formato ${model.format}, ${model.rounds.length} rondas, ${model.edges.length} aristas verificadas, fiable`, model.reliable && model.rounds.length > 0);
      const render = (mode: "desktop" | "mobile") => renderToStaticMarkup(h("div", { className: "space-y-4" },
        h("h1", { className: "font-display text-[clamp(24px,4vw,36px)] font-bold uppercase leading-none text-white" }, `Cuadro · ${name}`),
        h(BracketPickemView, { model, questions: fx.questions, answers: fx.answers, now: NOW, saving: null, feedback: null, canPick: !readOnly, readOnly, showResolved: readOnly, onPick: () => undefined, bracketMode: mode }),
      ));
      // El render estático no puede leer matchMedia: a 390 se fuerza el reparto móvil, el que la app elige por viewport.
      const file = join(OUT, `_qa-${name}.html`);
      const fileMobile = join(OUT, `_qa-${name}-mobile.html`);
      writeFileSync(file, page(`QA · ${name}`, render("desktop"), css, model.edges));
      writeFileSync(fileMobile, page(`QA · ${name} · móvil`, render("mobile"), css, []));
      for (const [w, hh] of VIEWPORTS) {
        await tab.resize(w, hh);
        await tab.goto(`file:///${(w < 768 ? fileMobile : file).replace(/\\/g, "/")}`, 1200);
        await sleep(300);
        const pageOverflow = await tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
        const small = await tab.js<number>(`[...document.querySelectorAll("button")].filter(b => b.getBoundingClientRect().height < 44 && b.getBoundingClientRect().height > 0).length`);
        const lines = await tab.js<number>(`Number(document.querySelector("svg[data-connectors]")?.dataset.connectors ?? 0)`);
        const scrollable = await tab.js<boolean>(`(() => { const r = document.querySelector(".nx-bracket-scroll"); return !!r && r.scrollWidth > r.clientWidth; })()`);
        check(`estática ${name} @${w}: la página no desborda (el cuadro se desplaza dentro de su área)`, Number(pageOverflow) <= 0, `${pageOverflow}px · área desplazable: ${scrollable}`);
        check(`estática ${name} @${w}: botones ≥ 44px`, Number(small) === 0, `${small} por debajo`);
        if (w === 1440) check(`estática ${name} @${w}: líneas dibujadas = aristas del modelo`, Number(lines) === model.edges.length, `${lines} / ${model.edges.length}`);
        if (w === 390) {
          const mobile = await tab.js<boolean>(`!!document.querySelector('[data-bracket-mode="mobile"]') && !document.querySelector('[data-bracket-mode="desktop"]')`);
          const noSaving = await tab.js<boolean>(`!document.body.innerText.includes("Guardando")`);
          check(`estática ${name} @${w}: reparto móvil (selector de ronda + tarjetas verticales), sin «Guardando…» fantasma`, mobile && noSaving);
        }
        const height = await tab.js<number>("document.documentElement.scrollHeight");
        await tab.resize(w, Math.min(Number(height) + 20, 6000));
        await sleep(250);
        await tab.shot(join(OUT, `qa-estatica-${name}-${w}.png`));
      }
      if (name === "single") {
        await tab.resize(1440, 960);
        await tab.goto(`file:///${file.replace(/\\/g, "/")}`, 800);
        const txt = (await tab.js<string>("document.body.innerText")).toLowerCase();
        for (const needle of ["cuartos", "semifinal", "final", "por definir", "en juego", "acertada", "fallada", "tu pick", "quién será campeón", "elige un ganador", "+15 pts", "conexiones verificadas"]) {
          check(`estática single muestra «${needle}»`, txt.includes(needle));
        }
        const buttons = await tab.js<number>(`document.querySelectorAll('article button[aria-label^="Seleccionar"]').length`);
        check("estática single: solo los partidos abiertos con equipos tienen filas seleccionables (qf4 + sf1 = 4 botones)", Number(buttons) === 4, `${buttons}`);
      }
    }
  } finally { await browser.close(); }
}

async function main() {
  await partA();
  await partB();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n━━━ Resultado: ${results.length - bad.length} ✓ / ${bad.length} ✗ ━━━`);
  writeFileSync(join(OUT, "_resultados.json"), JSON.stringify(results, null, 2));
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error("💥", e instanceof Error ? e.stack : e); process.exit(1); });
