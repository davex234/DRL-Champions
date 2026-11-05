/**
 * F71 · selector de stats y pistas del rival en navegador real a 1440, 1024 y 390 (fuera de CI, cuenta QA).
 *   npx tsx scripts/_fase71-duel-sizes.ts [persona=K]
 * Retoma (o empieza) una partida rápida y juega jugadas reales hasta pasar por un turno de ATAQUE (3 stats grandes,
 * elegir una, marca «Elegida») y uno de DEFENSA (stat obligada). Mide: panel visible dentro del viewport, a la derecha
 * en ≥1024 y abajo sin tapar la mano en 390, bloques ≥ 44 px, sin scroll horizontal, pistas visibles. 3 capturas.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, clickText, waitFor, type Client } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = process.argv[2] ?? "K";
const OUT = join(process.cwd(), "docs/product/qa/fase71");
mkdirSync(join(OUT, "shots"), { recursive: true });

const measure = (c: Client) => c.tab.js<any>(`(() => { const p = document.querySelector('[data-testid="stat-panel"]'); const hand = document.querySelector('[aria-label="Tu mano"]');
  /* F71.2 · SIN scroll: en 390 la hoja tiene que caber en el pliegue tal y como llega el turno. */ window.scrollTo(0, 0);
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) }; };
  const opts = p ? [...p.querySelectorAll('[data-testid^="stat-option-"]')].map(b => ({ id: b.getAttribute('data-testid'), tag: b.tagName, state: b.getAttribute('data-state'), ...R(b) })) : [];
  const rp = document.querySelector('[data-testid="rival-panel"]'); const rs = [...document.querySelectorAll('[data-testid="rival-stats"]')].find(e => e.offsetParent !== null);
  const extCombat = [...document.querySelectorAll('[data-combat]')].filter(e => !e.closest('[aria-label="Tu mano"]') && e.offsetParent !== null).length;
  const rivalVals = rs ? [...rs.querySelectorAll('[data-testid^="rival-stat-"]')].map(e => (e.innerText || '').replace(/\\s+/g, ' ').trim()) : [];
  return { vw: innerWidth, vh: innerHeight, panel: R(p), hand: R(hand), rivalPanel: rp && rp.offsetParent !== null ? R(rp) : null, rivalState: rs ? rs.getAttribute('data-rival-state') : null, history: R(document.querySelector('[data-testid="match-history-toggle"]')), rivalVals, extCombat, confirm: R(document.querySelector('[data-testid="stat-confirm"]')), opts, hints: document.querySelectorAll('[data-testid="rival-hint"]').length, hScroll: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);

async function atWidth(width: number) {
  const c = await openBrowser(P, width, { label: `f71-sizes-${width}` });
  const seen: any = { width, attack: null, defend: null, errors: [] as string[] };
  try {
    await loginUi(c, P);
    await goto(c, "/duelos/jugar", 3500);
    if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 6000)) { await clickText(c, "^Comenzar duelo$"); await sleep(3000); }
    for (let i = 0; i < 8 && !(seen.attack && seen.defend); i++) {
      const ready = await c.tab.js<boolean>(`new Promise(r => { const t0 = Date.now(); const f = () => { document.querySelector('[data-f61="moment"]')?.click(); const h = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); if (h.length && !document.querySelector('[data-scene="intro"]')) r(true); else if (Date.now() - t0 > 25000 || /Jugar otra|VICTORIA|DERROTA/i.test(document.body.innerText) && !h.length) r(false); else setTimeout(f, 400); }; f(); })`);
      if (!ready) break;
      await c.tab.js(`(() => { const h = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); h[0]?.click(); })()`);
      await sleep(700);
      const m = await measure(c);
      const attacking = m.opts.filter((o: any) => o.tag === "BUTTON").length === 3;
      if (attacking && !seen.attack) {
        await c.tab.js(`document.querySelector('[data-testid="stat-option-EF"]')?.focus()`);
        await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
        await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await sleep(400);
        const sel = await c.tab.js<any>(`({ state: document.querySelector('[data-testid="stat-option-EF"]')?.getAttribute('data-state'), badge: !!document.querySelector('[data-testid="stat-selected-badge"]'), focusVisible: document.activeElement?.matches(':focus-visible') ?? null })`);
        seen.attack = { ...m, keyboardSelect: sel };
        if (sel.state !== "selected") { await c.tab.js(`document.querySelector('[data-testid="stat-option-EF"]')?.click()`); await sleep(300); }
        await c.tab.shot(join(OUT, "shots", `attack-${width}.png`)).catch(() => null);
      } else if (!attacking && m.opts.length === 1 && !seen.defend) {
        seen.defend = m;
        await c.tab.shot(join(OUT, "shots", `defend-${width}.png`)).catch(() => null);
      }
      await c.tab.js(`document.querySelector('[data-testid="stat-confirm"]')?.click()`);
      await sleep(6000);
    }
    seen.errors = c.tab.takeErrors().slice(0, 5);
  } finally { await c.browser.close(); }
  return seen;
}

const judge = (s: any) => {
  const one = (m: any) => {
    if (!m?.panel) return false;
    const inView = m.panel.x >= 0 && m.panel.r <= m.vw + 1 && m.panel.y >= 0 && m.panel.b <= m.vh + 1;
    const big = m.opts.every((o: any) => o.h >= 44);
    const place = s.width >= 1024 ? m.panel.x > m.vw / 2 : !m.hand || m.panel.y >= m.hand.b - 2 || m.panel.b <= m.hand.y + 2;
    // F71.1 · el confirmar entero y visible; en escritorio los tercios llenan el panel (no «tarjeta flotante»).
    const confirmOk = !!m.confirm && m.confirm.b <= Math.min(m.panel.b, m.vh) + 1 && m.confirm.h >= 40;
    const fill = s.width >= 1024 ? m.opts.reduce((a: number, o: any) => a + o.h, 0) / m.panel.h : 1;
    const full = s.width < 1024 || (m.opts.length === 1 ? m.opts[0].h >= m.panel.h * 0.2 : fill >= 0.55);
    // F71.2 · simetría: rival a la izquierda, tú a la derecha, mismo ancho; sin fila SH/GS/EF fuera de la mano.
    const sym = s.width < 1024 || (!!m.rivalPanel && m.rivalPanel.r <= m.vw / 2 && m.panel.x >= m.vw / 2 && Math.abs(m.rivalPanel.w - m.panel.w) <= 2 && Math.abs(m.rivalPanel.h - m.panel.h) <= 2);
    const rivalOk = m.rivalState === "hidden" ? m.rivalVals.every((v: string) => /\?$/.test(v)) : m.rivalState === "revealed" ? m.rivalVals.every((v: string) => /\d+$/.test(v)) : false;
    const overlap = (a: any, b: any) => !!a && !!b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
    const noCover = !overlap(m.history, m.rivalPanel) && !overlap(m.history, m.panel);
    return inView && big && place && confirmOk && full && sym && rivalOk && noCover && m.extCombat === 0 && !m.hScroll && m.hints >= 0;
  };
  return { attack: one(s.attack) && s.attack.keyboardSelect.state === "selected" && s.attack.keyboardSelect.badge, defend: s.defend ? one(s.defend) : null, noErrors: s.errors.length === 0 };
};

(async () => {
  const runs = [];
  for (const w of [1440, 1024, 390]) { const s = await atWidth(w); runs.push({ ...s, verdict: judge(s) }); console.log(w, JSON.stringify(judge(s)), JSON.stringify({ attackPanel: s.attack?.panel, hand: s.attack?.hand, hints: s.attack?.hints ?? s.defend?.hints, errors: s.errors })); }
  const ok = runs.every((r) => r.verdict.attack && r.verdict.defend !== false && r.verdict.noErrors);
  writeFileSync(join(OUT, "duel-sizes.json"), JSON.stringify({ at: new Date().toISOString(), ok, runs }, null, 2) + "\n");
  console.log(ok ? "DUEL_SIZES PASS" : "DUEL_SIZES FAIL");
  process.exit(ok ? 0 : 1);
})();
