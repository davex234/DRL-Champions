/**
 * QA EN NAVEGADOR · RESULTADO DE PARTIDA RÁPIDA (instrumento, fuera de CI) — arnés `/design-system/quick-result`.
 *
 *   BASE_URL=http://127.0.0.1:3086 npx tsx scripts/_quick-result-qa.ts --serve   (arranca SU propio next start con NEXUS_QA_HARNESS=1)
 *
 * 1440/1024/390 × normal/reducido: victoria, derrota, empate (resultado mínimo) y campaña (resultado COMPLETO: aislamiento).
 * Comprueba: sin desbordamiento horizontal, veredicto + marcador + motivo + DOS botones dentro de la primera pantalla, nada
 * de recompensas/progreso, en 390 los botones apilados, consola limpia, reducido sin barrido. Escribe docs/product/qa/quick-result/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3086";
const OUT = join(process.cwd(), "docs/product/qa/quick-result");
mkdirSync(join(OUT, "shots"), { recursive: true });
const checks: { w: number; motion: string; scene: string; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (w: number, motion: string, scene: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ w, motion, scene, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${scene} · ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};
const FORBIDDEN = "Puntos de rango|Créditos|XP de cuenta|Ver progreso|Objetivo|Logro|Reclamar|Temporada|Misión|Misiones|Recompensa";

async function pass(w: number, motion: "normal" | "reduced") {
  const c: Client = await openBrowser("QA", w, { reduced: motion === "reduced", label: `qr-${w}-${motion}` });
  try {
    for (const scene of ["win", "loss", "draw", "campaign"]) {
      c.tab.takeErrors();
      await c.tab.goto(`${BASE}/design-system/quick-result?scene=${scene}`, 1500);
      for (let i = 0; i < 60; i++) { if (await c.tab.js<boolean>(`document.querySelector('[data-qa-scene]')?.dataset.qaScene === ${JSON.stringify(scene)} && !!document.querySelector('[data-scene="result"]')`).catch(() => false)) break; await sleep(150); }
      await sleep(motion === "reduced" ? 400 : 1400);
      const f = await c.tab.js<any>(`(() => {
        const vh = innerHeight, r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        const box = document.querySelector('[data-scene="result"]');
        const actions = box ? [...box.querySelectorAll('[data-testid="result-actions"] a, [data-testid="result-actions"] button')] : [];
        return {
          overflow: document.documentElement.scrollWidth - innerWidth, vh,
          quick: !!document.querySelector('[data-result="quick"]'),
          verdict: r('[data-testid="quick-result-verdict"]'), score: r('[data-testid="quick-result-score"]'), reason: r('[data-testid="quick-result-reason"]'),
          actions: actions.map((a) => { const b = a.getBoundingClientRect(); return { text: a.textContent.trim(), top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height }; }),
          text: box ? box.textContent : '', sweep: !!document.querySelector('.nx-result-sweep'),
          // Nada DESPUÉS de los botones: el bloque de acciones es el último elemento del resultado (el aire de debajo es el centrado).
          afterActions: (() => { const a = box && box.querySelector('[data-testid="result-actions"]'); if (!a) return -1; let n = 0; for (let e = a.nextElementSibling; e; e = e.nextElementSibling) n++; return n; })(),
        };
      })()`);
      check(w, motion, scene, "sin desbordamiento horizontal", f.overflow <= 0, f.overflow);
      if (scene === "campaign") {
        check(w, motion, scene, "AISLAMIENTO: campaña = resultado COMPLETO (no el mínimo)", !f.quick && /Puntos de rango|Créditos|Ver la partida/.test(f.text), f.text.slice(0, 120));
      } else {
        check(w, motion, scene, "resultado mínimo", f.quick);
        check(w, motion, scene, "veredicto, marcador y motivo visibles en la primera pantalla", !!f.verdict && !!f.score && !!f.reason && f.verdict.top >= 0 && f.reason.bottom <= f.vh, { v: f.verdict, s: f.score, r: f.reason, vh: f.vh });
        check(w, motion, scene, "exactamente DOS botones (Seguir jugando · Volver al menú principal)", f.actions.length === 2 && /Seguir jugando/i.test(f.actions[0].text) && /Volver al menú principal/i.test(f.actions[1].text), f.actions.map((a: any) => a.text));
        check(w, motion, scene, "los botones caben en la primera pantalla y miden ≥ 44 px", f.actions.every((a: any) => a.bottom <= f.vh && a.h >= 44), f.actions);
        if (w <= 600) check(w, motion, scene, "390: botones apilados", f.actions.length === 2 && f.actions[1].top >= f.actions[0].bottom - 1, f.actions);
        else check(w, motion, scene, "escritorio: botones lado a lado", f.actions.length === 2 && Math.abs(f.actions[0].top - f.actions[1].top) < 2, f.actions);
        check(w, motion, scene, "nada de recompensas, progreso, objetivos, logros, temporada ni misiones", !new RegExp(FORBIDDEN, "i").test(f.text), f.text.match(new RegExp(FORBIDDEN, "i")));
        check(w, motion, scene, "la pantalla acaba en los botones (ningún panel después)", f.afterActions === 0, f.afterActions);
        if (motion === "reduced") check(w, motion, scene, "movimiento reducido: sin barrido de luz", !f.sweep);
      }
      const errs = c.tab.takeErrors().filter((e: string) => !/status of (401|503)/.test(e) && !/api\/content\//.test(e));
      check(w, motion, scene, "consola limpia", errs.length === 0, errs);
      await c.tab.shot(join(OUT, "shots", `${scene}-${w}-${motion}.png`)).catch(() => null);
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3086";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/quick-result`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}

async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  try { for (const motion of ["normal", "reduced"] as const) for (const w of [1440, 1024, 390]) await pass(w, motion); }
  finally { stop(); }
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "qa.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nQUICK RESULT QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
