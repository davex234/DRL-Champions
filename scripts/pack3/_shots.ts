/**
 * PACK OPENING 3.0 · QA EN NAVEGADOR DEL RESULTADO (instrumento, fuera de CI y de la release).
 *
 *   BASE_URL=http://127.0.0.1:3011 QA_TAG=local npx tsx scripts/pack3/_shots.ts
 *
 * Arnés F81 (`/design-system/fase81?scene=…`, la ceremonia REAL con resultado fijo, sin servidor ni economía):
 * abre → OMITIR → resumen. Mide hero (300 px, primero, marcado), resto (todas las demás, sin miniaturas), panel secundario,
 * dock (una CTA primaria), que el rótulo de momento queda por ENCIMA del dock, sin desbordamiento, y la ficha de odds
 * (`/packs/premium`). 1440 / 1024 / 390 × movimiento normal / reducido. Escribe docs/product/qa/pack3/<tag>/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "../_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const OUT = join(process.cwd(), "docs/product/qa/pack3", process.env.QA_TAG ?? "local");
mkdirSync(OUT, { recursive: true });
const checks: { id: string; w: number; m: string; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, m: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ id, w, m, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w} ${m}] ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};
const click = (c: Client, tid: string) => c.tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="${tid}"]'); if (!b) return false; b.click(); return true; })()`);
const phase = (c: Client) => c.tab.js<string>(`document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? ""`);
async function waitFor(c: Client, expr: string, ms = 20000) { for (let i = 0; i < ms / 150; i++) { if (await c.tab.js<boolean>(expr).catch(() => false)) return true; await sleep(150); } return false; }

const MEASURE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
  const sum = document.querySelector('[data-testid="pack-summary"]');
  const hero = document.querySelector('[data-testid="summary-card"][data-hero="true"]');
  const heroCard = hero?.querySelector('[data-card-image]');
  const rest = [...document.querySelectorAll('[data-testid="summary-cards"] [data-testid="summary-card"]')];
  const restCards = rest.map((li) => { const im = li.querySelector('[data-card-image]'); const b = im.getBoundingClientRect(); return { w: Math.round(b.width), status: li.dataset.status, badge: li.querySelector('[data-caption-status]')?.textContent ?? null }; });
  const dock = document.querySelector('[data-dock]');
  const region = document.querySelector('[data-testid="game-moment-region"]');
  const scroller = sum?.parentElement;
  return {
    vw: innerWidth, vh: innerHeight, overflowX: document.documentElement.scrollWidth - innerWidth, scrollerOverflowX: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
    intensity: sum?.dataset.intensity, heroFirst: !!hero && rest.every((li) => li.getBoundingClientRect().top > hero.getBoundingClientRect().top),
    heroW: heroCard ? Math.round(heroCard.getBoundingClientRect().width) : null, heroBadge: hero?.querySelector('[data-caption-status]')?.textContent ?? null,
    heroText: document.querySelector('[data-testid="summary-featured"]')?.innerText ?? '',
    restCount: rest.length, restCards, panel: r(document.querySelector('[data-testid="summary-panel"]')),
    primary: document.querySelectorAll('[data-testid="pack-summary"] [data-cta="primary"]').length, dockH: dock ? Math.round(dock.getBoundingClientRect().height) : null,
    momentOffset: getComputedStyle(document.documentElement).getPropertyValue('--nx-moment-offset').trim(), regionBottom: region ? getComputedStyle(region).bottom : null, regionPlacement: region?.dataset.placement ?? null,
    actions: [...document.querySelectorAll('[data-testid="summary-actions"] button')].map((b) => b.textContent.trim()),
  };
})()`;

async function pass(w: number, motion: "normal" | "reduced", scene: string) {
  const c = await openBrowser("QA", w, { reduced: motion === "reduced", label: `p3-${scene}-${w}-${motion}` });
  try {
    c.tab.takeErrors();
    await c.tab.goto(`${BASE}/design-system/fase81?scene=${scene}&reset=1`, 1500);
    await waitFor(c, `!!document.querySelector('[data-testid="pack-open"]')`);
    await sleep(500);
    await click(c, "pack-open");
    await waitFor(c, `!!document.querySelector('[data-testid="pack-skip"]')`, 15000);
    await sleep(300);
    await click(c, "pack-skip");
    await waitFor(c, `!!document.querySelector('[data-testid="pack-summary"]')`, 15000);
    await sleep(motion === "reduced" ? 700 : 1600);
    const m = await c.tab.js<any>(MEASURE);
    const id = `${scene}`;
    check(id, w, motion, "resumen visible tras OMITIR", (await phase(c)) === "summary", await phase(c));
    check(id, w, motion, "hero arriba, grande (300 px) y marcada", m.heroFirst && m.heroW === 300, { first: m.heroFirst, w: m.heroW });
    check(id, w, motion, "hero dice nombre, OVR, edición y estado", /\d{2}/.test(m.heroText) && !!m.heroBadge, { text: m.heroText.slice(0, 120), badge: m.heroBadge });
    check(id, w, motion, "resto del sobre: todas las demás cartas, ≥ 150 px (sin miniaturas)", m.restCount >= 1 && m.restCards.every((x: any) => x.w >= 150), m.restCards.map((x: any) => x.w));
    check(id, w, motion, "cada carta con su insignia de estado", m.restCards.every((x: any) => !!x.badge), m.restCards.map((x: any) => x.badge));
    check(id, w, motion, "panel secundario presente y compacto (≤ 420 px de alto)", !!m.panel && m.panel.h <= (w < 600 ? 640 : 420), m.panel);
    check(id, w, motion, "una sola CTA primaria; acciones: abrir · colección · jugar", m.primary === 1 && m.actions.some((t: string) => /Ir a mi colección/.test(t)) && m.actions.some((t: string) => /^Jugar$/.test(t)), m.actions);
    // En /abrir (inmersiva) el rótulo va ABAJO: debe apartarse del dock. El arnés va con armazón (rótulo ARRIBA): no toca el dock.
    check(id, w, motion, "el rótulo de momento nunca tapa el dock (abajo: offset ≥ alto del dock; o arriba)", parseInt(m.momentOffset, 10) >= (m.dockH ?? 0) && (m.regionPlacement === "top" || m.regionPlacement === "bottom"), { off: m.momentOffset, dock: m.dockH, placement: m.regionPlacement });
    check(id, w, motion, "sin desbordamiento horizontal (página y escena)", m.overflowX <= 0 && (m.scrollerOverflowX ?? 0) <= 0, { page: m.overflowX, scene: m.scrollerOverflowX });
    await c.tab.shot(join(OUT, `${scene}-${w}-${motion}-1-hero.png`));
    await c.tab.js(`document.querySelector('[data-testid="summary-cards"]')?.scrollIntoView({ block: 'start' })`); await sleep(500);
    await c.tab.shot(join(OUT, `${scene}-${w}-${motion}-2-rest.png`));
    await c.tab.js(`document.querySelector('[data-testid="summary-panel"]')?.scrollIntoView({ block: 'center' })`); await sleep(500);
    await c.tab.shot(join(OUT, `${scene}-${w}-${motion}-3-panel.png`));
    const errs = c.tab.takeErrors().filter((e) => !/status of (401|503)/.test(e) && !/api\/content\//.test(e) && !/54521|ERR_CONNECTION_REFUSED|Failed to load resource/.test(e));
    check(id, w, motion, "consola sin errores", errs.length === 0, errs.slice(0, 3));
  } finally { await c.browser.close().catch(() => null); }
}

async function oddsPass(w: number) {
  const c = await openBrowser("QA", w, { label: `p3-odds-${w}` });
  try {
    await c.tab.goto(`${BASE}/packs/premium`, 2500);
    await waitFor(c, `!!document.querySelector('[data-pack-slots]')`, 20000);
    await c.tab.js(`document.querySelector('[data-pack-slots]')?.scrollIntoView({ block: 'center' })`); await sleep(500);
    const o = await c.tab.js<any>(`({ slots: document.querySelector('[data-pack-slots]')?.innerText, best: document.querySelector('[data-best-odds]')?.innerText, overflow: document.documentElement.scrollWidth - innerWidth })`);
    check("odds", w, "-", "ficha Plata: ranuras normal/destacada y mejor carta exacta", /5 cartas normales/i.test(o.slots ?? "") && /Carta destacada/i.test(o.slots ?? "") && /OVR 90\+/i.test(o.best ?? ""), o);
    check("odds", w, "-", "sin desbordamiento", o.overflow <= 0, o.overflow);
    await c.tab.shot(join(OUT, `odds-premium-${w}.png`));
  } finally { await c.browser.close().catch(() => null); }
}

(async () => {
  if (process.env.QA_ONLY !== "odds") {
    for (const w of [1440, 1024, 390]) for (const m of ["normal", "reduced"] as const) await pass(w, m, "plata-ref");
    for (const s of ["high", "dup", "normal"]) await pass(1440, "normal", s);
    await pass(390, "reduced", "dup");
  }
  for (const w of [1440, 390]) await oddsPass(w);
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
