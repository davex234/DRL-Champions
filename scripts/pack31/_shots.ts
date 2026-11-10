/**
 * PACK OPENING 3.1 · QA EN NAVEGADOR DE LOS SOBRES ESPECIALES (instrumento, fuera de CI y de la release).
 *
 *   BASE_URL=http://127.0.0.1:3011 QA_TAG=local npx tsx scripts/pack31/_shots.ts       (QA_ONLY=odds para solo las fichas)
 *
 * Fichas públicas `/packs/<id>` de los 10 especiales comprables (reparto del PLAN, ranuras, mejor carta, sesgo de equipo,
 * garantía de EWC, precio nuevo), y el resultado del sobre de equipo en el arnés F81 (`scene=team-g2`). 1440 / 1024 / 390.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "../_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const OUT = join(process.cwd(), "docs/product/qa/pack31", process.env.QA_TAG ?? "local");
mkdirSync(OUT, { recursive: true });
const checks: { id: string; w: number; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, w, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w}] ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 300)}`}`); };
async function waitFor(c: Client, expr: string, ms = 20000) { for (let i = 0; i < ms / 150; i++) { if (await c.tab.js<boolean>(expr).catch(() => false)) return true; await sleep(150); } return false; }
const PRICE: Record<string, string> = { ewc: "8.500", china: "9.500", emea: "3.500", americas: "3.500", pacific: "3.500", "team-heretics": "3.500", "team-fnatic": "3.500", "team-g2": "3.500", "team-liquid": "3.500", "team-karmine": "3.500" };

async function oddsPass(w: number) {
  const c = await openBrowser("QA", w, { label: `p31-odds-${w}` });
  try {
    for (const id of Object.keys(PRICE)) {
      await c.tab.goto(`${BASE}/packs/${id}`, 1800);
      const ok = await waitFor(c, `!!document.querySelector('[data-pack-slots]')`, 20000);
      const o = await c.tab.js<any>(`({ text: document.querySelector('main')?.innerText ?? '', slots: document.querySelector('[data-pack-slots]')?.innerText ?? '', best: document.querySelector('[data-best-odds]')?.innerText ?? '', mode: document.querySelector('[data-draw-mode]')?.dataset.drawMode, overflow: document.documentElement.scrollWidth - innerWidth })`);
      check(id, w, "ficha por PLAN: ranuras normal/destacada + mejor carta exacta", ok && o.mode === "class-distribution" && /carta destacada/i.test(o.slots) && /OVR 90\+/i.test(o.best), { mode: o.mode, slots: o.slots.slice(0, 120), best: o.best });
      check(id, w, `precio ${PRICE[id]} en la ficha`, o.text.includes(PRICE[id]), o.text.slice(0, 200));
      if (id.startsWith("team-")) check(id, w, "sesgo de equipo dicho con honestidad (probabilidad aumentada, no garantía)", /Probabilidad aumentada/i.test(o.text), null);
      if (id === "ewc") check(id, w, "garantía de EWC en la carta destacada", /Champions o Icon garantizada en la carta destacada/i.test(o.text), null);
      check(id, w, "sin desbordamiento", o.overflow <= 0, o.overflow);
      if (["pacific", "ewc", "china", "team-g2"].includes(id)) { await c.tab.js(`document.querySelector('[data-pack-slots]').scrollIntoView({ block: 'center' })`); await sleep(400); await c.tab.shot(join(OUT, `odds-${id}-${w}.png`)); }
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function resultPass(w: number, reduced: boolean) {
  const c = await openBrowser("QA", w, { reduced, label: `p31-res-${w}` });
  try {
    await c.tab.goto(`${BASE}/design-system/fase81?scene=team-g2&reset=1`, 1500);
    await waitFor(c, `!!document.querySelector('[data-testid="pack-open"]')`);
    await sleep(500);
    await c.tab.js(`document.querySelector('[data-testid="pack-open"]').click()`);
    await waitFor(c, `!!document.querySelector('[data-testid="pack-skip"]')`, 15000); await sleep(300);
    await c.tab.js(`document.querySelector('[data-testid="pack-skip"]').click()`);
    await waitFor(c, `!!document.querySelector('[data-testid="pack-summary"]')`, 15000); await sleep(reduced ? 700 : 1600);
    const m = await c.tab.js<any>(`(() => { const hero = document.querySelector('[data-testid="summary-card"][data-hero="true"]'); const rest = [...document.querySelectorAll('[data-testid="summary-cards"] [data-testid="summary-card"]')];
      return { pack: document.querySelector('[data-testid="summary-pack"]')?.textContent, accent: getComputedStyle(document.querySelector('[data-testid="pack-summary"]')).getPropertyValue('--pack-accent').trim(), intensity: document.querySelector('[data-testid="pack-summary"]')?.dataset.intensity,
        heroW: hero ? Math.round(hero.querySelector('[data-card-image]').getBoundingClientRect().width) : null, rest: rest.length, badges: document.querySelectorAll('[data-testid="pack-summary"] [data-caption-status]').length,
        primary: document.querySelectorAll('[data-testid="pack-summary"] [data-cta="primary"]').length, panel: !!document.querySelector('[data-testid="summary-panel"]'), overflow: document.documentElement.scrollWidth - innerWidth }; })()`);
    check("team-g2", w, "resultado compartido: hero 300 px, resto, insignias, panel y una CTA", m.heroW === 300 && m.rest === 4 && m.badges === 5 && m.panel && m.primary === 1, m);
    check("team-g2", w, "identidad del sobre: su nombre y su acento (G2) en la escena", /G2/.test(m.pack ?? "") && m.accent.toLowerCase() === "#8e97a8" && m.intensity === "3", { pack: m.pack, accent: m.accent, i: m.intensity });
    check("team-g2", w, "sin desbordamiento", m.overflow <= 0, m.overflow);
    await c.tab.shot(join(OUT, `result-team-g2-${w}${reduced ? "-reduced" : ""}.png`));
  } finally { await c.browser.close().catch(() => null); }
}

(async () => {
  for (const w of [1440, 390]) await oddsPass(w);
  if (process.env.QA_ONLY !== "odds") { await resultPass(1440, false); await resultPass(1024, false); await resultPass(390, true); }
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
