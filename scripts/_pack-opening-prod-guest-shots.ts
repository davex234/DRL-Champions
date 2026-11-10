/**
 * APERTURA EN PRODUCCIÓN · CAPTURAS COMO INVITADO, SOLO LECTURA (instrumento; 2026-10-15).
 *
 *   npx tsx scripts/_pack-opening-prod-guest-shots.ts
 *
 * https://valorosters.com/abrir/estandar SIN sesión y SIN pulsar «Abrir»: el sobre cerrado tal como lo sirve producción, a
 * 390/768/1440 con movimiento normal y reducido. Comprueba la build activa (por el chunk de la sala nueva), que no hay
 * monigote (<canvas>/walkout dentro de la apertura) ni chunks del walkout descargados, consola limpia y ninguna respuesta
 * ≥ 400. No abre sobres, no inicia sesión, no escribe nada.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = "https://valorosters.com";
const OUT = join(process.cwd(), "docs/product/qa/pack-opening-production-2026-10-15/produccion-invitado");
mkdirSync(OUT, { recursive: true });
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, d: unknown = "") => { const s = typeof d === "string" ? d : JSON.stringify(d); rows.push({ id, ok, detail: s.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} · ${id}${ok ? "" : ` — ${s.slice(0, 200)}`}`); };

(async () => {
  for (const w of [390, 768, 1440]) for (const motion of ["normal", "reduced"]) {
    const S = `${w} · ${motion}`;
    const b = await launch({ args: ["--mute-audio", "--hide-scrollbars"] });
    const t = b.tab;
    const urls: string[] = [];
    await t.send("Network.enable");
    t.on("Network.responseReceived", (p: { response: { status: number; url: string } }) => urls.push(`${p.response.status} ${p.response.url}`));
    await t.resize(w, w < 600 ? 844 : w <= 1024 ? 1024 : 900, 1);
    await t.setMedia([{ name: "prefers-reduced-motion", value: motion === "reduced" ? "reduce" : "no-preference" }]);
    try {
      await t.goto(`${BASE}/abrir/estandar`, 2500);
      for (let i = 0; i < 40 && !(await t.js<boolean>(`!!document.querySelector('[data-testid="pack-open"]') && !document.querySelector('div.fixed.inset-0[class~="z-[100]"]')`)); i++) await sleep(250);
      await sleep(motion === "reduced" ? 400 : 1500);
      const st = await t.js<{ phase: string; open: boolean; canvas: number; atm: string }>(`({ phase: document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? '', open: !!document.querySelector('[data-testid="pack-open"]'),
        canvas: document.querySelectorAll('[data-testid="pack-opening"] canvas, [data-testid^="pack-walkout"]').length, atm: document.querySelector('[data-testid="reveal-atmosphere"]')?.dataset.atmosphere ?? 'ausente' })`);
      await t.shot(join(OUT, `${w}-${motion}-sobre-cerrado.png`));
      const js = urls.filter((u) => /\.js(\?|$)/.test(u)).map((u) => u.split(" ")[1]);
      let atmChunk = false, walkoutChunks = 0;
      for (const u of js) { const body = await (await fetch(u)).text(); if (body.includes("reveal-atmosphere")) atmChunk = true; if (/WalkoutStage|human3d/.test(body)) walkoutChunks++; }
      const bad = urls.filter((u) => /^[45]\d\d /.test(u));
      check(`${S} · producción sirve la apertura NUEVA (capa de sala presente; sobre cerrado, sin abrir)`, st.phase === "ready" && st.open && atmChunk && st.atm === "none", st);
      check(`${S} · sin monigote: 0 <canvas>/walkout en la apertura y 0 chunks del walkout`, st.canvas === 0 && walkoutChunks === 0, { canvas: st.canvas, walkoutChunks });
      check(`${S} · consola limpia y sin respuestas ≥ 400`, t.takeErrors().filter((e) => !/favicon|React DevTools/i.test(e)).length === 0 && bad.length === 0, bad.slice(0, 4));
    } finally { await b.close(); }
  }
  const fail = rows.filter((r) => !r.ok);
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), pass: rows.length - fail.length, fail: fail.length, rows }, null, 2));
  console.log(`\n${rows.length - fail.length} PASS · ${fail.length} FAIL`);
})();
