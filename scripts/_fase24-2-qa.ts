/**
 * FASE 24.2 · INSTRUMENTO DE QA (fuera de package.json y de CI).
 *
 *   E2E_BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_fase24-2-qa.ts
 *
 * DOS PARTES, y es importante no confundirlas:
 *
 *   A. APP REAL en el navegador (`next start`). Comprueba que /pickems, /pickems/historial
 *      y las rutas de regresión cargan, no dejan excepciones en consola (las de red por el
 *      backend caído se separan y se cuentan aparte) y no desbordan a 1440 ni a 390.
 *      En este entorno NO hay backend (Supabase local caído, Docker desinstalado), así que
 *      aquí se ve la degradación: «Algo ha fallado · Reintentar». No es el flujo real.
 *
 *   B. RENDER ESTÁTICO con DATOS DE MUESTRA de las piezas nuevas, con el CSS compilado de la
 *      build y los logos servidos por la app. Sirve para validar el DISEÑO (jerarquía,
 *      estados, responsive, overflow) — NO es una prueba de datos reales ni de persistencia,
 *      y así se etiqueta en las capturas (`qa-estatica-*`).
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { launch, sleep } from "./lib/cdp";
import { PickemHero } from "@/components/pickems/PickemHero";
import { PickemBoard } from "@/components/pickems/PickemBoard";
import { PickemResults } from "@/components/pickems/PickemResults";
import { PickemRewards } from "@/components/pickems/PickemRewards";
import { EventSwitcher } from "@/components/pickems/EventSwitcher";
import { LeaderboardTable } from "@/components/pickems/TournamentLeaderboard";
import { HistoryCard } from "@/app/pickems/historial/page";
import type { PickemQuestion, TournamentRankingRow, LedgerRow, PickemHistoryRow } from "@/lib/game/client";
import type { AnswerMap } from "@/domain/pickems/progress";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(ROOT, "docs", "product", "qa", "fase24-2");
mkdirSync(OUT, { recursive: true });

const results: { label: string; ok: boolean; detail?: string }[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const isNetwork = (e: string) => /Failed to fetch|fetch failed|ERR_CONNECTION|ECONNREFUSED|NetworkError|net::/i.test(e);
/** Un recurso 404 (una imagen que falta) no es una excepción de la app: se cuenta aparte. */
const isResource = (e: string) => /Failed to load resource/i.test(e);

/* ═══════════════════════════ A · APP REAL ═══════════════════════════ */

async function partA() {
  console.log("\n# A · App real (sin backend en este entorno)\n");
  const browser = await launch({ width: 1440, height: 960 });
  const { tab } = browser;
  const routes = ["/pickems", "/pickems/historial", "/ranking", "/torneos", "/coleccion", "/inventario", "/packs", "/duelos", "/progresion", "/tienda", "/mercado"];
  try {
    for (const route of routes) {
      for (const width of [1440, 390]) {
        await tab.resize(width, width < 768 ? 844 : 960);
        await tab.goto(`${BASE}${route}`, route.startsWith("/pickems") ? 12000 : 3500);
        const errs = tab.takeErrors();
        const net = errs.filter(isNetwork);
        const res = errs.filter((e) => !isNetwork(e) && isResource(e));
        const real = errs.filter((e) => !isNetwork(e) && !isResource(e));
        const text = await tab.js<string>("document.body.innerText.length");
        const overflow = await tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
        check(`${route} @${width} carga con contenido`, Number(text) > 40, `${text} chars`);
        check(`${route} @${width} sin excepciones de la app`, real.length === 0, real.slice(0, 2).join(" | ") || [net.length ? `${net.length} de red (backend caído)` : "", res.length ? `${res.length} recursos 404` : ""].filter(Boolean).join(" · "));
        check(`${route} @${width} sin desbordamiento horizontal`, Number(overflow) <= 0, `${overflow}px`);
        if (route.startsWith("/pickems")) {
          await tab.shot(join(OUT, `app-${route.replace(/\//g, "_").replace(/^_/, "")}-${width}.png`));
        }
      }
    }
    /*
     * Degradación honesta en /pickems sin backend. Tarda ~20 s: supabase-js 2.108 reintenta
     * la lectura varias veces y cada conexión rechazada le cuesta ~2 s a Chrome sin cabeza.
     * No es un bucle de la pantalla: son los reintentos de la librería, medidos.
     */
    await tab.resize(1440, 960);
    await tab.goto(`${BASE}/pickems`, 26000);
    const body = await tab.js<string>("document.body.innerText");
    check("/pickems sin backend degrada con Reintentar (no crashea)", /reintentar/i.test(body) || /cuenta/i.test(body), body.slice(-160).replace(/\n/g, " "));
  } finally {
    await browser.close();
  }
}

/* ═══════════════════════════ B · RENDER ESTÁTICO (DATOS DE MUESTRA) ═══════════════════════════ */

const NOW = Date.now();
const future = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const past = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const TEAMS = ["Team Heretics", "Fnatic", "Team Liquid", "Karmine Corp", "Natus Vincere", "KOI", "Gen.G", "Paper Rex"];
const key = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const mq = (id: string, a: string, b: string, over: Partial<PickemQuestion> = {}): PickemQuestion => ({
  id, pickem_event_id: "e1", kind: "match_winner", match_id: id, prompt: `¿Quién gana ${a} vs ${b}?`,
  options: [{ key: "a", label: a }, { key: "b", label: b }], points: 15, locks_at: future(3), order_idx: 1,
  locked: false, correct_option: null, ...over,
});

const questions: PickemQuestion[] = [
  { id: "champ", pickem_event_id: "e1", kind: "champion", match_id: null, prompt: "¿Quién será campeón?",
    options: TEAMS.map((t) => ({ key: key(t), label: t })), points: 50, locks_at: future(30), order_idx: -1, locked: false, correct_option: null },
  mq("m1", "Fnatic", "Team Heretics", { locks_at: future(2.2), points: 20, order_idx: 1 }),
  mq("m2", "Team Liquid", "Karmine Corp", { locks_at: future(5), order_idx: 2 }),
  mq("m3", "Natus Vincere", "KOI", { locks_at: future(0.7), order_idx: 3 }),
  mq("m4", "Gen.G", "Paper Rex", { locked: true, locks_at: past(1), order_idx: 4 }),
  mq("m5", "Fnatic", "KOI", { locked: true, locks_at: past(2), order_idx: 5 }),
  mq("r1", "Fnatic", "Team Heretics", { locked: true, locks_at: past(30), correct_option: "b", points: 25, order_idx: 6 }),
  mq("r2", "Gen.G", "Natus Vincere", { locked: true, locks_at: past(40), correct_option: "a", order_idx: 7 }),
  mq("r3", "Team Liquid", "Paper Rex", { locked: true, locks_at: past(50), correct_option: "a", order_idx: 8 }),
];
const answers: AnswerMap = {
  champ: { option: "team-heretics", isCorrect: null, pointsAward: null },
  m2: { option: "a", isCorrect: null, pointsAward: null },
  m4: { option: "b", isCorrect: null, pointsAward: null },
  r1: { option: "b", isCorrect: true, pointsAward: 25 },
  r2: { option: "b", isCorrect: false, pointsAward: 0 },
  r3: { option: "a", isCorrect: true, pointsAward: 15 },
};
const score = { points: 40, correct: 2, total: 3 };
const ranking: TournamentRankingRow[] = Array.from({ length: 14 }, (_, i) => ({
  user_id: i === 11 ? "me" : `u${i}`, username: i === 11 ? "davex" : ["nyx", "kairo", "vega", "sable", "orion", "mika", "rune", "zed", "lyra", "atlas", "juno", "x", "pax", "nova"][i],
  avatar: ["🦊", "🐺", "🦅", "🐍", "🦁", "🐯", "🦈", "🐉", "🦉", "🐻", "🦂", "🎯", "🐸", "🦋"][i],
  points: 120 - i * 7, correct: 9 - Math.floor(i / 2), total: 12,
}));
const reward: LedgerRow = { id: "t1", delta: 1500, reason: "pickem_reward:acertante", ref: "pickem:e1:acertante", balance_after: 12500, created_at: past(2) };

const history: PickemHistoryRow[] = [
  { pickemEventId: "e1", eventId: "ev1", name: "VCT EMEA Stage 2", isDemo: false, status: "scored", eventStatus: "live", startDate: past(60), endDate: future(200), locksAt: future(200), score, answered: 6, questions, answers, position: 12, reward },
  { pickemEventId: "e0", eventId: "ev0", name: "Masters Toronto", isDemo: false, status: "scored", eventStatus: "finished", startDate: past(900), endDate: past(700), locksAt: past(720),
    score: { points: 95, correct: 7, total: 9 }, answered: 9, questions: questions.slice(6).map((q) => ({ ...q, id: `h${q.id}` })), answers: {}, position: 3,
    reward: { ...reward, id: "t0", reason: "pickem_reward:oraculo", ref: "pickem:e0:oraculo" } },
];

function page(title: string, body: string, css: string): string {
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8"><base href="${BASE}/">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="${css}"></head>
<body class="bg-base-900 text-white antialiased" style="margin:0">
<div style="position:fixed;top:0;left:0;right:0;z-index:99;background:#7a1b1b;color:#fff;font:600 11px/1.4 system-ui;padding:3px 10px;letter-spacing:.06em;text-transform:uppercase">QA ESTÁTICA · DATOS DE MUESTRA · NO ES UNA PRUEBA REAL</div>
<main class="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6">${body}</main></body></html>`;
}

async function partB() {
  console.log("\n# B · Render estático con datos de muestra (validación de diseño)\n");
  const cssDir = join(ROOT, ".next", "static", "chunks");
  const cssFile = readdirSync(cssDir).find((f) => f.endsWith(".css"));
  if (!cssFile) throw new Error("No hay CSS compilado: ejecuta `npm run build` antes.");
  const css = `/_next/static/chunks/${cssFile}`;

  const hub = renderToStaticMarkup(
    h("div", { className: "space-y-5" },
      h("header", null,
        h("span", { className: "nx-label" }, "Jugar · Predicciones"),
        h("h1", { className: "mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white" }, "Nexus Pick'ems")),
      h(EventSwitcher, { selected: "e1", onSelect: () => undefined, events: [
        { id: "e1", name: "VCT EMEA Stage 2", phase: "activo" }, { id: "e2", name: "Masters Toronto", phase: "finalizado" }, { id: "e3", name: "Champions Paris", phase: "proximo" },
      ] }),
      h(PickemHero, { name: "VCT EMEA Stage 2", description: "Acierta los ganadores y suma puntos de rango.", phase: "activo", eventHref: "/torneos/ev1",
        questions, answers, score, ranking, userId: "me", now: NOW, onGoPending: () => undefined }),
      h(PickemBoard, { questions, answers, now: NOW, saving: null, feedback: { questionId: "m2", kind: "saved", message: "Predicción guardada" }, canPick: true, showResolved: false, onPick: () => undefined }),
      h("section", null, h("h2", { className: "nx-label mb-3" }, "Resultados recientes"),
        h(PickemResults, { questions: questions.filter((q) => q.correct_option), answers })),
      h(PickemRewards, { score, reward }),
      h("section", null, h("h2", { className: "nx-label mb-3" }, "Clasificación del torneo"),
        h(LeaderboardTable, { rows: ranking, currentUserId: "me" })),
    ),
  );
  const hist = renderToStaticMarkup(
    h("div", { className: "space-y-5" },
      h("h1", { className: "font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white" }, "Mi historial"),
      h("ol", { className: "grid gap-3" }, ...history.map((row) => h(HistoryCard, { key: row.pickemEventId, row, now: NOW }))),
    ),
  );

  const hubFile = join(OUT, "_qa-hub.html");
  const histFile = join(OUT, "_qa-historial.html");
  writeFileSync(hubFile, page("QA · Pick'ems hub", hub, css));
  writeFileSync(histFile, page("QA · Historial", hist, css));

  const browser = await launch({ width: 1440, height: 960 });
  const { tab } = browser;
  try {
    for (const [name, file] of [["hub", hubFile], ["historial", histFile]] as const) {
      for (const width of [1440, 390]) {
        await tab.resize(width, width < 768 ? 844 : 960);
        await tab.goto(`file:///${file.replace(/\\/g, "/")}`, 1500);
        await sleep(400);
        const overflow = await tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
        const buttonsSmall = await tab.js<number>(`[...document.querySelectorAll("button")].filter(b => b.getBoundingClientRect().height < 44 && b.getBoundingClientRect().height > 0).length`);
        // Un elemento recortado por un antepasado con `overflow: hidden` (un `truncate`) no desborda: se descarta.
        const wideList = await tab.js<string[]>(`[...document.querySelectorAll("main *")].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).filter(e => { for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if ((o === "hidden" || o === "clip") && a.getBoundingClientRect().right <= window.innerWidth + 1) return false; } return true; }).map(e => e.tagName + "." + String(e.className).slice(0, 40) + " «" + (e.textContent || "").trim().slice(0, 24) + "» +" + Math.round(e.getBoundingClientRect().right - window.innerWidth))`);
        const wide = wideList.length;
        if (wide > 0) console.log("    fuera:", wideList.slice(0, 6).join(" ; "));
        check(`estática ${name} @${width} sin desbordamiento`, Number(overflow) <= 0 && Number(wide) === 0, `scroll ${overflow}px · ${wide} piezas fuera`);
        check(`estática ${name} @${width} botones ≥ 44px`, Number(buttonsSmall) === 0, `${buttonsSmall} por debajo`);
        // Captura de página completa: se estira el viewport a la altura del documento.
        const height = await tab.js<number>("document.documentElement.scrollHeight");
        await tab.resize(width, Math.min(Number(height) + 20, 6000));
        await sleep(300);
        await tab.shot(join(OUT, `qa-estatica-${name}-${width}.png`));
      }
    }
    const txt = await (async () => { await tab.resize(1440, 960); await tab.goto(`file:///${hubFile.replace(/\\/g, "/")}`, 800); return tab.js<string>("document.body.innerText"); })();
    for (const needle of ["#12", "6 / 9", "Quién será campeón", "Pendientes", "Tus elecciones", "En juego", "Acertada", "Fallada", "Conseguida", "Te faltan", "Predicción guardada", "Bloqueada", "Sin predicción", "tú"]) {
      check(`estática hub muestra «${needle}»`, txt.toLowerCase().includes(needle.toLowerCase()));
    }
  } finally {
    await browser.close();
  }
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
