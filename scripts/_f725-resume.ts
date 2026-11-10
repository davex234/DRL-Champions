/**
 * F72.5 · «RETOMAR PARTIDA» (fuera de CI): abre una partida rápida REAL con la cuenta QA (JUGAR → DUELOS → PARTIDA RÁPIDA),
 * vuelve a /jugar y mide el CTA de campaña con la etiqueta más larga a 1440/1024/390 (una línea, sin corte), comprueba que
 * la banda «Continuar partida» sigue igual y retira la partida al final. Escribe docs/product/qa/fase72-5/resume.json.
 *   npx tsx scripts/_f725-resume.ts [persona=A]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, token, api } from "./_fase68-lib";

const P = process.argv[2] ?? "A";
const OUT = join(process.cwd(), "docs/product/qa/fase72-5");

(async () => {
  const t = await token(P);
  const duel = (body: unknown) => api(t, "/api/game/duel", body);
  const results: { width: number; id: string; ok: boolean; detail: string }[] = [];
  const check = (w: number, id: string, ok: boolean, detail = "") => { results.push({ width: w, id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${w}] ${id} ${detail}`); };
  let matchId: string | null = null;
  try {
    for (const width of [1440, 1024, 390]) {
      const c = await openBrowser(P, width, { label: "f725-resume" });
      try {
        await loginUi(c, P);
        if (!matchId) {
          await goto(c, "/jugar", 2500);
          await c.tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
          await waitFor(c.tab, `!!document.querySelector('[data-testid="duel-mode-cta-QUICK"]')`, 15000);
          await c.tab.js(`document.querySelector('[data-testid="duel-mode-cta-QUICK"]')?.click()`);
          await sleep(3500);
          if (await c.tab.js<boolean>(`/Comenzar duelo/i.test(document.body.innerText)`)) {
            await c.tab.js(`[...document.querySelectorAll('button')].find(b => /^Comenzar duelo$/i.test((b.innerText||'').trim()))?.click()`);
            await sleep(4000);
          }
          matchId = (await duel({ action: "active" })).json?.view?.matchId ?? null;
          check(width, "partida rápida real abierta", !!matchId, String(matchId));
        }
        await goto(c, "/jugar", 3000);
        await waitFor(c.tab, `!!document.querySelector('[data-testid="play-area-cta-RTC"]')`, 20000);
        await sleep(1200);
        const m = await c.tab.js<{ text: string; h: number; lines: number; cut: boolean; band: string | null; bandCta: string | null }>(`(() => {
          const a = document.querySelector('[data-testid="play-area-cta-RTC"]'); const l = a.querySelector('[data-cta-label]');
          const lh = parseFloat(getComputedStyle(l).lineHeight) || 24; const band = document.querySelector('[data-testid="play-hub-resume-cta"]');
          return { text: (l.innerText || '').trim(), h: Math.round(a.getBoundingClientRect().height), lines: Math.round(l.getBoundingClientRect().height / lh),
            cut: l.scrollWidth > l.clientWidth + 1, band: band ? (band.innerText || '').trim() : null, bandCta: band ? band.className : null }; })()`);
        const box = await c.tab.js<{ x: number; y: number; width: number; height: number }>(`(() => { const r = document.querySelector('[data-testid="play-areas"]').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top + scrollY - 8), width: r.width + 16, height: Math.min(r.height + 16, 1400) }; })()`);
        const s = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 }, captureBeyondViewport: true }).catch(() => null);
        if (s?.data) writeFileSync(join(OUT, "shots", `retomar-${width}.png`), Buffer.from(s.data, "base64"));
        check(width, "RTC dice RETOMAR PARTIDA (lógica intacta)", /retomar partida/i.test(m.text), m.text);
        check(width, "RETOMAR PARTIDA en UNA línea, sin corte, misma altura", m.lines === 1 && !m.cut && m.h <= 70, `líneas=${m.lines} h=${m.h}`);
        check(width, "banda «Continuar partida» intacta (su propio botón, no el de las tarjetas)", !!m.band && !/nx-mode-cta/.test(m.bandCta ?? ""), `${m.band}`);
        const errs = c.tab.takeErrors();
        check(width, "0 errores de consola", errs.length === 0, errs[0] ?? "");
      } finally { await c.browser.close(); }
    }
  } finally {
    const left = (await duel({ action: "active" })).json?.view?.matchId;
    if (left) await duel({ action: "abandon", matchId: left });
  }
  const pass = results.filter((r) => r.ok).length;
  writeFileSync(join(OUT, "resume.json"), JSON.stringify({ at: new Date().toISOString(), persona: P, matchId, pass, total: results.length, results }, null, 2) + "\n");
  console.log(`f72.5 resume: ${pass}/${results.length}`);
  process.exit(pass === results.length ? 0 : 1);
})();
