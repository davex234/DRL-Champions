/**
 * CORE GAME LOOP · QA EN NAVEGADOR (instrumento, fuera de CI y de la release).
 *
 *   BASE_URL=http://127.0.0.1:3011 npx tsx scripts/coreloop/_shots.ts
 *
 * Resultado de partida rápida con el cupo diario (arnés /design-system/quick-result): «win-rewards» (cupo 7 de 20) y
 * «capped» (partida 21, sin recompensas y con explicación). 1440 / 1024 / 390, normal y movimiento reducido.
 * La portada y /progresion con cuenta se revisan en producción (`_prod-browser.ts`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "../_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const OUT = join(process.cwd(), "docs/product/qa/core-loop", process.env.QA_TAG ?? "local");
mkdirSync(OUT, { recursive: true });
const checks: { id: string; w: number; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, w, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w}] ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 300)}`}`); };
async function waitFor(c: Client, expr: string, ms = 20000) { for (let i = 0; i < ms / 150; i++) { if (await c.tab.js<boolean>(expr).catch(() => false)) return true; await sleep(150); } return false; }

async function pass(w: number, reduced: boolean) {
  const c = await openBrowser("QA", w, { reduced, label: `cl-${w}${reduced ? "-r" : ""}` });
  try {
    for (const scene of ["win-rewards", "capped"]) {
      await c.tab.goto(`${BASE}/design-system/quick-result?scene=${scene}`, 1500);
      const ok = await waitFor(c, `!!document.querySelector('[data-testid="daily-reward-slot"]')`);
      await sleep(reduced ? 400 : 1400);
      const m = await c.tab.js<any>(`(() => { const s = document.querySelector('[data-testid="daily-reward-slot"]'); const r = s?.getBoundingClientRect();
        return { text: s?.innerText ?? '', capped: s?.dataset.capped, rewards: !!document.querySelector('[data-testid="quick-result-rewards"]'), primary: document.querySelectorAll('[data-testid="result-actions"] [data-cta="primary"]').length,
          visible: r ? r.width > 0 && r.height > 0 : false, overflow: document.documentElement.scrollWidth - innerWidth, opacity: s ? getComputedStyle(s.closest('section') ?? s).opacity : null }; })()`);
      if (scene === "win-rewards") {
        check(scene, w, "cupo ocupado: «Partida con recompensa 7 de 20 hoy» bajo las recompensas", ok && /Partida con recompensa 7 de 20 hoy/.test(m.text) && m.capped === "false" && m.rewards, m);
      } else {
        check(scene, w, "partida topada: sin recompensas, tope dicho, se puede seguir jugando, cuándo vuelve", ok && m.capped === "true" && !m.rewards && /Tope diario alcanzado: 20/.test(m.text) && /Puedes seguir jugando/.test(m.text) && /00:00 UTC/.test(m.text), m);
      }
      check(scene, w, "visible, una sola acción principal, sin desbordamiento", m.visible && m.primary === 1 && m.overflow <= 0, m);
      await c.tab.shot(join(OUT, `result-${scene}-${w}${reduced ? "-reduced" : ""}.png`));
    }
  } finally { await c.browser.close().catch(() => null); }
}

(async () => {
  for (const w of [1440, 1024, 390]) { await pass(w, false); await pass(w, true); }
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
