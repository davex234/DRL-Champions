/**
 * PACK OPENING 3.0 · RESULTADO DEL SOBRE EN PRODUCCIÓN, NAVEGADOR REAL (instrumento de operador, fuera de CI/release).
 *
 *   BASE_URL=https://valorosters.com QA_SESSION_KEY=sb-valorosters-auth-token QA_SESSION='<json>' QA_W=390 npx tsx scripts/pack3/_prod-browser.ts
 *
 * Persona QA con su Bronce de bienvenida: /abrir/estandar → ABRIR → OMITIR → resumen. Mide hero, resto, panel, una CTA,
 * y que el rótulo «OBJETIVO COMPLETADO» (si sale) no se solapa con el dock de acciones. F5 en el resumen: mismas cartas.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep } from "../_fase68-lib";

const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const W = Number(process.env.QA_W ?? 1440);
const OUT = join(process.cwd(), "docs/product/qa/pack3/prod");
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} [${W}] ${n}${ok ? "" : " " + JSON.stringify(d)?.slice(0, 400)}`); };

(async () => {
  const c = await openBrowser("QA", W, { label: `p3-prod-${W}` });
  try {
    await c.tab.goto(`${BASE}/robots.txt`, 300);
    await c.tab.setStorage(process.env.QA_SESSION_KEY!, process.env.QA_SESSION!);
    await c.tab.goto(`${BASE}/abrir/estandar`, 2500);
    for (let i = 0; i < 100; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="pack-open"]')`)) break; await sleep(200); }
    await sleep(800);
    await c.tab.js(`document.querySelector('[data-testid="pack-open"]')?.click()`);
    for (let i = 0; i < 100; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="pack-skip"]')`)) break; await sleep(150); }
    await sleep(400);
    await c.tab.js(`document.querySelector('[data-testid="pack-skip"]')?.click()`);
    for (let i = 0; i < 100; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="pack-summary"]')`)) break; await sleep(150); }
    // Espera al rótulo de momento (el objetivo «Abre un sobre») si llega.
    let moment = false;
    for (let i = 0; i < 40; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="game-moment"]')`)) { moment = true; break; } await sleep(200); }
    await sleep(600);
    const m = await c.tab.js<any>(`(() => {
      const r = (el) => el ? el.getBoundingClientRect() : null;
      const hero = document.querySelector('[data-testid="summary-card"][data-hero="true"]');
      const rest = [...document.querySelectorAll('[data-testid="summary-cards"] [data-testid="summary-card"]')];
      const dockBtns = r(document.querySelector('[data-testid="summary-actions"]'));
      const mom = r(document.querySelector('[data-testid="game-moment"]'));
      return { uids: [...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => e.dataset.uid), heroW: hero ? Math.round(hero.querySelector('[data-card-image]').getBoundingClientRect().width) : null,
        heroText: document.querySelector('[data-testid="summary-featured"]')?.innerText.slice(0, 120), rest: rest.length, restW: rest.map((li) => Math.round(li.querySelector('[data-card-image]').getBoundingClientRect().width)),
        badges: [...document.querySelectorAll('[data-testid="summary-card"] [data-caption-status]')].map((e) => e.textContent), primary: document.querySelectorAll('[data-testid="pack-summary"] [data-cta="primary"]').length,
        actions: [...document.querySelectorAll('[data-testid="summary-actions"] button')].map((b) => b.textContent.trim()),
        dock: dockBtns && { top: Math.round(dockBtns.top), bottom: Math.round(dockBtns.bottom) }, moment: mom && { top: Math.round(mom.top), bottom: Math.round(mom.bottom), text: document.querySelector('[data-testid="game-moment"]').innerText.replace(/\\s+/g, ' ').slice(0, 60) },
        overflow: document.documentElement.scrollWidth - innerWidth, pack: document.querySelector('[data-testid="summary-pack"]')?.textContent };
    })()`);
    check("resumen con 5 cartas del Bronce; hero 300 px arriba y marcada", m.uids.length === 5 && m.heroW === 300 && m.rest === 4, { n: m.uids.length, hw: m.heroW, rest: m.rest });
    check("resto ≥ 150 px y cada carta con su insignia (NUEVA / NUEVA VARIANTE / DUPLICADA ×N)", m.restW.every((w: number) => w >= 150) && m.badges.length === 5, { w: m.restW, b: m.badges });
    check("una CTA primaria; ABRIR/VER · IR A MI COLECCIÓN · JUGAR", m.primary === 1 && m.actions.some((a: string) => /Ir a mi colección/i.test(a)) && m.actions.some((a: string) => /^Jugar$/i.test(a)), m.actions);
    check(moment ? "el rótulo de objetivo NO se solapa con el dock de acciones" : "sin rótulo de objetivo en esta apertura (no hay solape posible)",
      !moment || (m.moment && m.dock && m.moment.bottom <= m.dock.top), { moment: m.moment, dock: m.dock });
    check("sin desbordamiento horizontal", m.overflow <= 0, m.overflow);
    console.log("hero:", m.heroText?.replace(/\n/g, " · "), "| sobre:", m.pack, "| rótulo:", m.moment?.text ?? "—");
    await c.tab.shot(join(OUT, `summary-bronce-${W}.png`));
    // F5: mismas cartas, sin reabrir.
    await c.tab.send("Page.reload", { ignoreCache: false }); await sleep(3500);
    for (let i = 0; i < 80; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="pack-summary"]')`)) break; await sleep(200); }
    const after = await c.tab.js<string[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => e.dataset.uid)`);
    check("F5 en el resumen: las MISMAS cartas (sin reabrir)", JSON.stringify(after) === JSON.stringify(m.uids), { before: m.uids, after });
  } finally { await c.browser.close().catch(() => null); }
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})();
