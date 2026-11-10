/**
 * TACTICAL COACH · ROSTER REAL — QA del recorrido completo (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_realroster-qa.ts <credsFile> [baseUrl]
 *
 * Entrenador → Composiciones → mapa → cinco agentes REALES → guardar → recargar → siguen los cinco
 * → Pizarra → asignar esos cinco a las fichas → habilidad real → paso → guardar → recargar →
 * Presentar → Plan Táctico. Además, la composición antigua (modelo anterior) sigue abriéndose.
 *
 * ESCRIBE en la BD, sólo en la cuenta QA: una composición y una estrategia `__QA_REALROSTER__`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _realroster-qa.ts <credsFile> [baseUrl]"); process.exit(1); }
const OUT = join(process.cwd(), "docs/product/qa/roster-real");
mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };
const MAPA = "Ascent";
const CINCO = ["omen", "sova", "jett", "killjoy", "kayo"];
const COMP = "__QA_REALROSTER__";
const STRAT = "__QA_REALROSTER_STRAT__";

const r: Record<string, any> = {};
const ok = (k: string, v: boolean, extra?: unknown) => { r[k] = extra === undefined ? v : { ok: v, ...(extra as object) }; console.log(`  ${v ? "PASS" : "FAIL"} · ${k}${extra ? " " + JSON.stringify(extra) : ""}`); };

async function entrar(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 4000);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  }
  for (let i = 0; i < 180; i++) {
    if (await tab.js<boolean>(`/cerrar sesi/i.test(document.body.innerText)`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

const SET_INPUT = (sel: string, v: string) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const CLICK_TEXT = (tag: string, re: string) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(tag)})].find((x) => new RegExp(${JSON.stringify(re)}, 'i').test((x.textContent || '').trim())); if (!b) return false; b.click(); return true; })()`;
const CLICK_TID = (tid: string) => `(() => { const b = document.querySelector('[data-testid="${tid}"]'); if (!b) return false; b.click(); return true; })()`;

/** Clic de ratón REAL (eventos de puntero) en el centro de un elemento o en un punto. */
async function mouse(tab: Tab, x: number, y: number) {
  await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const rectOf = (tab: Tab, expr: string) => tab.js<{ x: number; y: number; w: number; h: number } | null>(`(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);

const TOKENS = `[...document.querySelectorAll('svg g[role="button"][aria-label]')]`;
const MAP_SVG = `[...document.querySelectorAll('svg')].map((s) => ({ s, a: s.getBoundingClientRect().width * s.getBoundingClientRect().height })).sort((a, b) => b.a - a.a)[0].s`;

async function main() {
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }
    console.log("sesion iniciada");

    /* ═══ 1 · COMPOSICIONES ═══ */
    await tab.goto(`${BASE}/entrenador/composiciones`, 3000);
    ok("mapa Ascent elegido", await tab.js<boolean>(CLICK_TEXT("button", `^${MAPA}`)));
    await sleep(700);
    await tab.js(CLICK_TID("new-composition")); await sleep(700);
    const roster = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid^="roster-"]')].map((b) => b.getAttribute('data-testid').slice(7)).filter((x) => x !== 'search')`);
    ok("roster real de 29 agentes", roster.length === 29, { n: roster.length, sinFicticios: !roster.some((x) => ["veil", "haze", "probe", "warden"].includes(x)) });
    const roles = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="composition-builder"] button')].map((b) => (b.textContent || '').trim()).filter((t) => /^(Duelista|Iniciador|Controlador|Centinela|Flexible|Flex)$/i.test(t))`);
    ok("filtro de rol: los cuatro reales", JSON.stringify(roles.slice(0, 4)) === JSON.stringify(["Duelista", "Iniciador", "Controlador", "Centinela"]) && !roles.some((t) => /flex/i.test(t)), { roles });
    await tab.js(SET_INPUT('[data-testid="roster-search"]', "kay")); await sleep(300);
    const busca = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid^="roster-"]')].map((b) => b.getAttribute('data-testid').slice(7)).filter((x) => x !== 'search')`);
    ok("buscador", JSON.stringify(busca) === JSON.stringify(["kayo"]), { busca });
    await tab.js(SET_INPUT('[data-testid="roster-search"]', "")); await sleep(300);
    await tab.js(SET_INPUT('[data-testid="composition-name"]', COMP));
    for (const id of CINCO) { await tab.js(CLICK_TID(`roster-${id}`)); await sleep(140); }
    // Duplicado: pulsar uno ya puesto lo QUITA (no lo repite); se vuelve a poner.
    await tab.js(CLICK_TID("roster-omen")); await sleep(140);
    const trasQuitar = await tab.js<number>(`document.querySelectorAll('[data-testid^="slot-"][data-filled="true"]').length`);
    await tab.js(CLICK_TID("roster-omen")); await sleep(140);
    const sextoDeshabilitado = await tab.js<boolean>(`document.querySelector('[data-testid="roster-raze"]').disabled`);
    ok("sin duplicados y tope de cinco", trasQuitar === 4 && sextoDeshabilitado, { trasQuitar, sextoDeshabilitado });
    const slots = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid^="slot-"] [role="img"]')].map((s) => s.getAttribute('aria-label'))`);
    ok("cinco huecos con agentes reales y su rol", slots.length === 5, { slots });
    await tab.shot(join(OUT, "01-composicion-cinco-reales-1440.png"));
    await tab.js(CLICK_TID("composition-save")); await sleep(2500);
    const err = await tab.js<string>(`(document.querySelector('[data-testid="composition-issue"]') || {}).textContent || ''`);
    ok("guardada sin error", !err, err ? { err } : undefined);

    /* Recargar y comprobar que siguen los cinco */
    await tab.goto(`${BASE}/entrenador/composiciones`, 3500);
    await tab.js(CLICK_TEXT("button", `^${MAPA}`)); await sleep(1200);
    const tira = await tab.js<string[]>(`(() => { const li = [...document.querySelectorAll('li, article, div')].filter((x) => (x.textContent || '').includes(${JSON.stringify(COMP)}) && x.querySelector('[data-testid="composition-strip"]')).sort((a, b) => a.textContent.length - b.textContent.length)[0]; return li ? [...li.querySelectorAll('[data-testid="composition-strip"] [role="img"]')].map((s) => s.getAttribute('aria-label')) : []; })()`);
    ok("tras recargar siguen los cinco", tira.length === 5 && tira.every((t) => /(Omen|Sova|Jett|Killjoy|KAY\/O) · /.test(t)), { tira });
    await tab.shot(join(OUT, "02-composiciones-lista-recargada-1440.png"));

    /* La composición antigua sigue abriéndose, identificada */
    const vieja = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="composition-strip"] [data-agent-kind="legacy"]')].map((s) => s.getAttribute('aria-label'))`);
    r["composicion antigua (otro mapa o ésta)"] = vieja;

    /* Responsive del editor con los cinco reales */
    for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]]) {
      await tab.resize(w, h, 1);
      await tab.goto(`${BASE}/entrenador/composiciones`, 2600);
      await tab.js(CLICK_TEXT("button", `^${MAPA}`)); await sleep(600);
      await tab.js(CLICK_TID("new-composition")); await sleep(600);
      for (const id of CINCO) { await tab.js(CLICK_TID(`roster-${id}`)); await sleep(90); }
      const m = await tab.js<any>(`(() => { const vw = innerWidth; const fuera = [...document.querySelectorAll('[data-testid^="slot-"], [data-testid^="roster-"]')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.left < -1 || b.right > vw + 1); }).length; return { scrollX: document.documentElement.scrollWidth > vw + 1, fuera, llenos: document.querySelectorAll('[data-testid^="slot-"][data-filled="true"]').length }; })()`);
      ok(`editor responsive ${w}`, !m.scrollX && m.fuera === 0 && m.llenos === 5, m);
      await tab.shot(join(OUT, `03-editor-${w}.png`));
    }
    await tab.resize(1440, 900, 1);

    /* ═══ 2 · PIZARRA ═══ */
    await tab.goto(`${BASE}/entrenador/strats`, 3500);
    await tab.js(CLICK_TEXT("button", "Nueva estrategia")); await sleep(900);
    await tab.js(SET_INPUT('input[aria-label="Nombre de la estrategia"]', STRAT)); await sleep(200);
    const tokens = await tab.js<number>(`${TOKENS}.length`);
    ok("cinco fichas en el mapa", tokens === 5, { tokens });
    for (let i = 0; i < 5; i++) {
      const c = await rectOf(tab, `${TOKENS}[${i}]`);
      if (!c) continue;
      await mouse(tab, c.x, c.y); await sleep(350);
      const ok2 = await tab.js<boolean>(CLICK_TID(`pick-agent-${CINCO[i]}`));
      if (!ok2) console.log(`   (no aparece pick-agent-${CINCO[i]} tras seleccionar la ficha ${i})`);
      await sleep(350);
    }
    const nombres = await tab.js<string[]>(`[...document.querySelectorAll('svg text')].map((t) => t.textContent.trim()).filter((t) => /^(OMEN|SOVA|JETT|KILLJOY|KAY\\/O)$/.test(t))`);
    ok("las cinco fichas llevan agentes reales", new Set(nombres).size === 5, { nombres });
    const codigos = await tab.js<string[]>(`[...document.querySelectorAll('svg text')].map((t) => t.textContent.trim()).filter((t) => /^(OME|SOV|JET|KIL|KAY)$/.test(t))`);
    const imgsAgente = await tab.js<number>(`[...document.querySelectorAll('svg image, img')].filter((i) => /agents|valorant/i.test(i.getAttribute('href') || i.getAttribute('src') || '')).length`);
    ok("fichas del mapa: código del agente (sin retratos)", codigos.length >= 5 && imgsAgente === 0, { codigos, imgsAgente });

    // Habilidad real: Omen E con marca de humo, colocada en el mapa.
    const cOmen = await rectOf(tab, `${TOKENS}[0]`);
    if (cOmen) { await mouse(tab, cOmen.x, cOmen.y); await sleep(350); }
    const habs = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid^="pick-ability-"]')].map((b) => b.getAttribute('data-testid').slice(13))`);
    ok("habilidades reales de Omen (C/Q/E/X)", JSON.stringify(habs) === JSON.stringify(["omen_c", "omen_q", "omen_e", "omen_x"]), { habs });
    await tab.js(CLICK_TID("pick-ability-omen_e")); await sleep(300);
    const marcas = await tab.js<number>(`document.querySelectorAll('[data-testid="ability-mark"] button').length`);
    await tab.js(`(() => { const b = [...document.querySelectorAll('[data-testid="ability-mark"] button')].find((x) => /humo/i.test(x.textContent)); if (b) b.click(); })()`); await sleep(300);
    const mapa = await rectOf(tab, MAP_SVG);
    if (mapa) { await mouse(tab, mapa.x, mapa.y - mapa.h * 0.12); await sleep(600); }
    const util = await tab.js<number>(`document.querySelectorAll('svg g[role="button"][aria-label]').length`);
    ok("habilidad real colocada (marca de humo elegida por el entrenador; persistencia verificada en BD aparte)", util >= 6 && marcas === 7, { fichasYMarcas: util, marcas });

    // Un paso más.
    await tab.js(CLICK_TEXT("button", "^\\+ Paso$")); await sleep(500);
    await tab.shot(join(OUT, "04-pizarra-agentes-reales-1440.png"));
    await tab.js(CLICK_TEXT("button", "^Guardar( nueva)?$")); await sleep(2500);

    /* Recargar y abrir la estrategia guardada */
    await tab.goto(`${BASE}/entrenador/strats`, 3500);
    await tab.js(`(() => { const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || '')); if (d) d.open = true; })()`); await sleep(300);
    const abierta = await tab.js<boolean>(`(() => { const row = [...document.querySelectorAll('li, div')].filter((x) => (x.textContent || '').includes(${JSON.stringify(STRAT)}) && [...x.querySelectorAll('button')].some((b) => /^abrir$/i.test(b.textContent.trim()))).sort((a, b) => a.textContent.length - b.textContent.length)[0]; if (!row) return false; [...row.querySelectorAll('button')].find((b) => /^abrir$/i.test(b.textContent.trim())).click(); return true; })()`);
    await sleep(1800);
    const tras = await tab.js<string[]>(`[...document.querySelectorAll('svg text')].map((t) => t.textContent.trim()).filter((t) => /^(OMEN|SOVA|JETT|KILLJOY|KAY\\/O)$/.test(t) || /dark cover/i.test(t))`);
    const pasos = await tab.js<string>(`(document.body.innerText.match(/\\b\\d{2}\\s*\\/\\s*\\d{2}\\b/) || [''])[0]`);
    // La marca atada a Omen dice de qué habilidad es en el panel de selección. El tablero la
    // etiqueta por su MARCA («Humo»); la habilidad real sale en el panel.
    const cMarca = await rectOf(tab, `[...document.querySelectorAll('svg g[role="button"][aria-label]')].find((g) => /^humo$/i.test(g.getAttribute('aria-label')))`);
    if (cMarca) { await mouse(tab, cMarca.x, cMarca.y); await sleep(400); }
    // Dentro de una plantilla, `\\s` y `\\n` tienen que ir dobles para llegar a la página.
    const habilidad = await tab.js<string>(`(document.body.innerText.match(/Habilidad:\\s*([^\\n]+)/i) || ['', ''])[1]`);
    ok("guardada y reabierta: agentes y habilidad intactos", abierta && new Set(tras).size === 5 && /dark cover \(e\)/i.test(habilidad), { abierta, tras: [...new Set(tras)], habilidad, pasos });
    await tab.shot(join(OUT, "04b-pizarra-reabierta-1440.png"));

    /* ═══ 3 · PRESENTAR ═══ */
    await tab.js(CLICK_TID("open-theater")); await sleep(2000);
    const teatro = await tab.js<string[]>(`[...document.querySelectorAll('[role="img"][aria-label]')].map((s) => s.getAttribute('aria-label')).filter((t) => / · (Duelista|Iniciador|Controlador|Centinela)$/.test(t))`);
    ok("Presentar lista los cinco reales", new Set(teatro).size >= 5, { teatro: [...new Set(teatro)] });
    await tab.shot(join(OUT, "05-presentar-1440.png"));
    await tab.resize(390, 844, 1); await sleep(900);
    await tab.shot(join(OUT, "06-presentar-390.png"));
    await tab.resize(1440, 900, 1);

    /* ═══ 2b · UNA JUGADA DEL MODELO ANTERIOR SIGUE ABRIENDO ═══ */
    {
      await tab.goto(`${BASE}/entrenador/strats`, 3500);
      await tab.js(`(() => { const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || '')); if (d) d.open = true; })()`); await sleep(300);
      const vieja = await tab.js<boolean>(`(() => { const row = [...document.querySelectorAll('li, div')].filter((x) => (x.textContent || '').includes('__QA_F471_STRAT__') && [...x.querySelectorAll('button')].some((b) => /^abrir$/i.test(b.textContent.trim()))).sort((a, b) => a.textContent.length - b.textContent.length)[0]; if (!row) return false; [...row.querySelectorAll('button')].find((b) => /^abrir$/i.test(b.textContent.trim())).click(); return true; })()`);
      await sleep(1800);
      const nombresViejos = await tab.js<string[]>(`[...new Set([...document.querySelectorAll('svg text')].map((t) => t.textContent.trim()).filter((t) => /^(VEIL|PROBE|SPEAR|WARDEN|ECHO)$/.test(t)))]`);
      const c0 = await rectOf(tab, `[...document.querySelectorAll('svg g[role="button"][aria-label]')].find((g) => /warden/i.test(g.getAttribute('aria-label')))`);
      if (c0) { await mouse(tab, c0.x, c0.y); await sleep(400); }
      const nota = await tab.js<boolean>(`!!document.querySelector('[data-testid="legacy-agent-note"]')`);
      ok("jugada antigua: abre con sus agentes del modelo anterior identificados", vieja && nombresViejos.length === 5 && nota, { nombresViejos, nota });
      await tab.shot(join(OUT, "04c-pizarra-modelo-anterior-1440.png"));
    }

    /* ═══ 4 · PLAN TÁCTICO ═══ */
    await tab.goto(`${BASE}/entrenador/partidos`, 3000);
    const href = await tab.js<string>(`(() => { const a = [...document.querySelectorAll('a')].map((x) => x.getAttribute('href') || '').find((h) => h.includes('/entrenador/plan?match=')); return a || ''; })()`);
    if (href) {
      await tab.goto(`${BASE}${href}`, 3500);
      const plan = await tab.js<any>(`(() => { const t = document.body.innerText; return { comp: t.includes(${JSON.stringify(COMP)}), strat: t.includes(${JSON.stringify(STRAT)}), reales: [...document.querySelectorAll('[data-testid="composition-strip"] [data-agent-kind="real"]')].length, legado: [...document.querySelectorAll('[data-testid="composition-strip"] [data-agent-kind="legacy"]')].length }; })()`);
      ok("Plan Táctico ve la composición real y la estrategia", plan.comp && plan.strat && plan.reales >= 5, plan);
      await tab.shot(join(OUT, "07-plan-1440.png"));
    } else ok("Plan Táctico", false, { motivo: "sin partida con plan" });

    writeFileSync(join(OUT, "_qa.json"), JSON.stringify(r, null, 2));
    console.log(`\nlisto → ${OUT}`);
  } finally {
    if (browser) await browser.close();
  }
}

void main();
