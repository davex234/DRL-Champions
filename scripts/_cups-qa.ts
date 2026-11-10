/**
 * QA EN NAVEGADOR · F86 TORNEOS (instrumento, fuera de CI) — arnés `/design-system/cups`.
 *
 *   BASE_URL=http://127.0.0.1:3086 npx tsx scripts/_cups-qa.ts --serve   (arranca SU next start con NEXUS_QA_HARNESS=1)
 *
 * 1440 / 1024 / 390 × normal / movimiento reducido, todas las escenas del arnés. Comprueba: sin desbordamiento
 * horizontal de la página; árbol en escritorio (≥ 1024) y pestañas por ronda en móvil; «Ver mi partida» lleva a MI cruce
 * (pestaña correcta en móvil, tarjeta enfocada); el árbol de 64 se desplaza DENTRO de su región; estados en texto; táctil
 * ≥ 44 px; titulares semánticos; momento de campeón quieto con movimiento reducido; consola limpia.
 * Escribe docs/product/qa/cups/visual.json y las capturas en docs/product/qa/cups/shots/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3086";
const OUT = join(process.cwd(), "docs/product/qa/cups");
mkdirSync(join(OUT, "shots"), { recursive: true });
const checks: { w: number; motion: string; scene: string; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (w: number, motion: string, scene: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ w, motion, scene, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${scene} · ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 300)}`}`);
};
const SCENES = ["hub", "hub-empty", "open", "registered", "full", "scheduled", "live-8", "active-8", "live-64", "eliminated", "champion", "completed", "cancelled", "anon-open",
  // F86.1 · la espera del rival y el avance
  "before-ready", "waiting", "deadline", "review", "advanced", "next-playable", "notice"];

async function pass(w: number, motion: "normal" | "reduced") {
  const c: Client = await openBrowser("QA", w, { reduced: motion === "reduced", label: `cups-${w}-${motion}` });
  try {
    for (const scene of SCENES) {
      c.tab.takeErrors();
      await c.tab.goto(`${BASE}/design-system/cups?scene=${scene}`, 1200);
      for (let i = 0; i < 60; i++) { if (await c.tab.js<boolean>(`document.querySelector('[data-qa-scene]')?.dataset.qaScene === ${JSON.stringify(scene)}`).catch(() => false)) break; await sleep(150); }
      await sleep(600);
      const f = await c.tab.js<any>(`(() => {
        const vis = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
        const tree = document.querySelector('[data-testid="cup-tree"]'), tabs = document.querySelector('[data-testid="cup-rounds"]');
        const small = [...document.querySelectorAll('[data-testid="cup-register"],[data-testid="cup-withdraw"],[data-testid="cup-play"],[data-testid="cup-go-mine"],[data-testid="cup-round-tab"],[data-testid="cup-enter"],[data-testid="cups-more"],[data-testid="cup-signin"],[data-testid="cup-stop-waiting"],[data-testid="cup-live-cta"],[data-testid="cup-live-dismiss"]')]
          .filter(vis).map((b) => ({ t: b.dataset.testid, h: Math.round(b.getBoundingClientRect().height) })).filter((b) => b.h < 44);
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          h1: document.querySelectorAll('h1').length,
          tree: vis(tree), tabs: vis(tabs),
          treeScroll: tree ? tree.scrollWidth - tree.clientWidth : 0,
          matches: [...document.querySelectorAll('[data-testid="cup-match"]')].filter(vis).length,
          unlabeled: [...document.querySelectorAll('[data-testid="cup-match"]')].filter((m) => !m.getAttribute('aria-label')).length,
          states: [...document.querySelectorAll('[data-field="cup-match-state"]')].filter(vis).every((s) => s.textContent.trim().length > 0),
          small,
          text: document.body.innerText,
          champion: (() => { const el = document.querySelector('[data-testid="cup-champion"]'); return el ? { op: getComputedStyle(el).opacity, tf: getComputedStyle(el).transform } : null; })(),
        };
      })()`);
      check(w, motion, scene, "sin desbordamiento horizontal de la página", f.overflow <= 0, f.overflow);
      check(w, motion, scene, "un titular h1", f.h1 === 1, f.h1);
      check(w, motion, scene, "acciones táctiles ≥ 44 px", f.small.length === 0, f.small);
      const hasBracket = ["live-8", "active-8", "live-64", "eliminated", "champion", "completed", "before-ready", "waiting", "deadline", "review", "advanced", "next-playable"].includes(scene);
      if (hasBracket) {
        check(w, motion, scene, w >= 1024 ? "escritorio: árbol visible, pestañas ocultas" : "móvil: pestañas por ronda, árbol oculto (nada encogido)", w >= 1024 ? f.tree && !f.tabs : f.tabs && !f.tree, { tree: f.tree, tabs: f.tabs });
        check(w, motion, scene, "cada cruce con nombre accesible y estado en texto", f.unlabeled === 0 && f.states, { unlabeled: f.unlabeled });
      }
      if (scene === "live-64" && w >= 1024) check(w, motion, scene, "el árbol de 64 se desplaza DENTRO de su región (no la página)", f.treeScroll > 0 && f.overflow <= 0, { treeScroll: f.treeScroll });
      if (scene === "live-64" || scene === "live-8") {
        // «Ver mi partida»: pestaña de mi ronda en móvil, tarjeta MÍA enfocada y a la vista.
        await c.tab.js(`(() => { const t = document.querySelector('[data-testid="cup-round-tab"]'); if (t && t.offsetParent) t.click(); })()`);
        await sleep(200);
        await c.tab.js(`document.querySelector('[data-testid="cup-go-mine"]')?.click()`);
        await sleep(motion === "reduced" ? 300 : 900);
        const g = await c.tab.js<any>(`(() => { const a = document.activeElement; const r = a?.getBoundingClientRect(); return { you: a?.dataset?.you, testid: a?.dataset?.testid, inView: !!r && r.top >= 0 && r.bottom <= innerHeight + 2 && r.left >= -2 && r.right <= innerWidth + 2 }; })()`);
        check(w, motion, scene, "«Ver mi partida» enfoca MI cruce y lo deja a la vista", g.testid === "cup-match" && g.you === "1" && g.inView, g);
      }
      if (scene === "before-ready") check(w, motion, scene, "TU PARTIDA ESTÁ LISTA: rival con #TAG, plazo y JUGAR", /Tu partida está lista/i.test(f.text) && /#[2-9A-Z]{7}/.test(f.text) && /Plazo:/.test(f.text) && /\bJugar\b/i.test(f.text));
      if (scene === "full") check(w, motion, scene, "COMPLETO sin botón de inscribirse", /Completo/i.test(f.text) && !/Inscribirme/i.test(f.text));
      if (scene === "registered") check(w, motion, scene, "INSCRITO ✓ y RETIRARME", /Inscrito ✓/i.test(f.text) && /Retirarme/i.test(f.text));
      if (scene === "hub-empty") check(w, motion, scene, "vacío honesto", /No hay torneos abiertos ahora/i.test(f.text));
      // F86.1 · estados de la espera: texto (no solo color), anuncio accesible y sin «esperando» cuando ya no toca.
      const panel = await c.tab.js<any>(`(() => { const p = document.querySelector('[data-testid="cup-my-match"]'); if (!p) return null; const dot = p.querySelector('[data-testid="cup-waiting"] span[aria-hidden]');
        return { waiting: p.dataset.waiting, state: p.dataset.state, announce: p.querySelector('[data-testid="cup-announce"]')?.textContent ?? '', play: !!p.querySelector('[data-testid="cup-play"]'), text: p.innerText, anim: dot ? getComputedStyle(dot).animationName : null }; })()`);
      if (scene === "before-ready") check(w, motion, scene, "antes de listo: JUGAR, sin «esperando»", !!panel && panel.play && panel.waiting === "0" && /Tu partida est[aá] lista/i.test(panel.text), panel);
      if (scene === "live-8") check(w, motion, scene, "rival listo: «Tu rival ya está listo» + JUGAR YA, anunciado", !!panel && panel.play && /Tu rival ya est[aá] listo/i.test(panel.text) && /rival ya est[aá] listo/i.test(panel.announce), panel);
      if (scene === "waiting") {
        check(w, motion, scene, "ESPERANDO AL RIVAL (del servidor): ✓ listo, sin JUGAR, explicación, anuncio y salida", !!panel && panel.waiting === "1" && !panel.play && /Listo · esperando a/i.test(panel.text) && /autom[aá]ticamente/i.test(panel.text) && /Est[aá]s listo/i.test(panel.announce) && /Dejar de esperar/i.test(panel.text), panel);
        check(w, motion, scene, motion === "reduced" ? "movimiento reducido: el punto de espera no se anima" : "punto de espera presente (animación discreta)", motion === "reduced" ? (panel?.anim === "none" || panel?.anim === null) : !!panel, panel?.anim);
      }
      if (scene === "deadline") check(w, motion, scene, "plazo vencido: «en revisión», sin JUGAR ni «esperando», anunciado", !!panel && !panel.play && panel.waiting === "0" && /Plazo vencido/i.test(panel.text) && /revisi[oó]n/i.test(panel.announce), panel);
      if (scene === "review") check(w, motion, scene, "empate exacto: cruce en revisión, sin sorteo", !!panel && !panel.play && /revisi[oó]n/i.test(panel.text) && /no hay sorteo/i.test(panel.text), panel);
      if (scene === "advanced") check(w, motion, scene, "avance: ✓ Has ganado + esperando rival que se juega ahora", !!panel && /Has ganado Semifinal/i.test(panel.text) && /Esperando rival/i.test(panel.text) && /se est[aá] jugando ahora/i.test(panel.text), panel);
      if (scene === "next-playable") check(w, motion, scene, "siguiente cruce jugable: ✓ Has ganado + JUGAR", !!panel && panel.play && /Has ganado/i.test(panel.text), panel);
      if (scene === "notice") check(w, motion, scene, "aviso global: «Tu rival te espera» con JUGAR, accesible", await c.tab.js<boolean>(`(() => { const n = document.querySelector('[data-testid="cup-live-notice"]'); return !!n && n.getAttribute('role') === 'status' && /Tu rival te espera/i.test(n.innerText) && n.querySelector('[data-testid="cup-live-cta"]').getBoundingClientRect().height >= 44; })()`));
      if (scene === "champion") {
        check(w, motion, scene, "momento de campeón: «¡Eres el campeón!», trofeo y torneo", /Eres el campeón/i.test(f.text) && /Sala de Trofeos/i.test(f.text));
        if (motion === "reduced") check(w, motion, scene, "movimiento reducido: el campeón aparece quieto (sin escala ni desplazamiento)", f.champion && f.champion.op === "1" && (f.champion.tf === "none" || f.champion.tf === "matrix(1, 0, 0, 1, 0, 0)"), f.champion);
      }
      const errs = c.tab.takeErrors().filter((e: string) => !/status of (401|503)/.test(e));
      check(w, motion, scene, "consola limpia", errs.length === 0, errs);
      await c.tab.shot(join(OUT, "shots", `${scene}-${w}-${motion}.png`)).catch(() => null);
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3086";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/cups`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}

async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  try { for (const motion of ["normal", "reduced"] as const) for (const w of [1440, 1024, 390]) await pass(w, motion); }
  finally { stop(); }
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "visual.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nCUPS VISUAL QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
