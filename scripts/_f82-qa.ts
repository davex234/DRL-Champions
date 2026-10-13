/**
 * F82 · QA EN NAVEGADOR DE LA SALA DE TROFEOS (instrumento, fuera de CI) — arnés `/design-system/fase82`.
 *
 *   BASE_URL=http://127.0.0.1:3082 npx tsx scripts/_f82-qa.ts --serve        (arranca SU propio next start con NEXUS_QA_HARNESS=1)
 *
 * Por anchura (1440/1024/390) y movimiento (normal/reducido): rejilla, filtros/búsqueda/orden, detalle (falta/tiene/
 * reclamar/completada/edición), momento de colección completada (foco, Escape, movimiento reducido), perfil propio y
 * público con insignias, editor de insignias (equipar/reordenar/límite 3). Overflow horizontal, consola, ARIA, alt de
 * logos, objetivos táctiles. Escribe docs/product/qa/f82-collection-sets/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3082";
const OUT = join(process.cwd(), "docs/product/qa/f82-collection-sets");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

interface Check { w: number; motion: string; name: string; ok: boolean; detail?: unknown }
const checks: Check[] = [];
const check = (w: number, motion: string, name: string, ok: boolean, detail?: unknown) => { checks.push({ w, motion, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`); };

async function open(c: Client, scene: string) {
  c.tab.takeErrors();
  await c.tab.goto(`${BASE}/design-system/fase82?scene=${scene}`, 1500);
  for (let i = 0; i < 40; i++) { if (await c.tab.js<boolean>(c, `document.querySelector('main[data-harness="fase82"]')?.dataset.scene === ${JSON.stringify(scene)}`).catch(() => false)) break; await sleep(150); }
  await sleep(400);
}
const ox = (c: Client) => c.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
const errs = (c: Client) => c.tab.takeErrors().filter((e) => !/Failed to load resource: the server responded with a status of (401|503)/.test(e) && !/api\/content\//.test(e));
const js = <T,>(c: Client, s: string) => c.tab.js<T>(s);

async function pass(w: number, motion: "normal" | "reduced") {
  const c = await openBrowser("A", w, { reduced: motion === "reduced", label: `f82-${motion}` });
  const shot = async (name: string) => { if (motion === "normal" || name.startsWith("moment")) await c.tab.shot(join(SHOTS, `${name}-${w}-${motion}.png`)); };
  try {
    // ── rejilla ──
    await open(c, "room");
    const g = await js<{ tiles: number; states: string[]; first: string; firstState: string; stats: number; logoAlt: number; logos: number; banner: boolean; ariaTiles: boolean }>(c, `(() => {
      const t = [...document.querySelectorAll('[data-testid="set-tile"]')];
      const imgs = [...document.querySelectorAll('[data-testid="set-tile"] img')];
      return { tiles: t.length, states: [...new Set(t.map(x => x.dataset.state))], first: t[0]?.dataset.set, firstState: t[0]?.dataset.state,
        stats: document.querySelectorAll('[data-testid^="stat-"]').length, logos: imgs.length, logoAlt: imgs.filter(i => /^Escudo de /.test(i.alt)).length,
        banner: !!document.querySelector('[data-testid="claimable-banner"]'), ariaTiles: t.every(x => /de \\d+/.test(x.getAttribute('aria-label') || '')) };
    })()`);
    check(w, motion, "rejilla: 25 sets reales (23 equipos + 2 ediciones), 4 estados, orden «más cerca» empieza por lo reclamable", g.tiles === 25 && g.states.length === 4 && g.firstState === "CLAIMABLE", g);
    check(w, motion, "rejilla: logos reales con alt «Escudo de …», tarjetas con aria-label de progreso, banner de reclamables, 4 estadísticas", g.logos === g.logoAlt && g.logos >= 23 && g.ariaTiles && g.banner && g.stats === 4, g);
    check(w, motion, "rejilla: sin overflow horizontal", (await ox(c)) <= 0, await ox(c));
    await shot("room");
    // búsqueda y filtros
    await js(c, `(() => { const i = document.querySelector('[data-testid="trophy-search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'heretics'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(300);
    const s1 = await js<string[]>(c, `[...document.querySelectorAll('[data-testid="set-tile"]')].map(x => x.dataset.set)`);
    check(w, motion, "búsqueda «heretics» → solo Team Heretics", s1.length === 1 && s1[0] === "team-team-heretics-v1", s1);
    await js(c, `(() => { const i = document.querySelector('[data-testid="trophy-search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await js(c, `[...document.querySelectorAll('[role="radio"]')].find(b => /Completadas/i.test(b.textContent))?.click()`);
    await sleep(300);
    const s2 = await js<string[]>(c, `[...document.querySelectorAll('[data-testid="set-tile"]')].map(x => x.dataset.state)`);
    check(w, motion, "filtro Completadas → solo COMPLETED (incluida la que hoy no tiene entera)", s2.length === 2 && s2.every((x) => x === "COMPLETED"), s2);
    await js(c, `[...document.querySelectorAll('[role="radio"]')].find(b => /Ediciones/i.test(b.textContent))?.click()`);
    await js(c, `[...document.querySelectorAll('[role="radio"]')].find(b => /^Todas$/i.test(b.textContent.trim()))?.click()`);
    await sleep(300);
    const s3 = await js<number>(c, `document.querySelectorAll('[data-testid="set-tile"]').length`);
    check(w, motion, "tipo Ediciones → 2 sets de edición", s3 === 2, s3);
    check(w, motion, "rejilla: consola limpia", errs(c).length === 0);

    await open(c, "room-empty");
    const e = await js<{ tiles: number; locked: number; badgesEmpty: boolean }>(c, `({ tiles: document.querySelectorAll('[data-testid="set-tile"]').length, locked: document.querySelectorAll('[data-testid="set-tile"][data-state="LOCKED"]').length, badgesEmpty: !!document.querySelector('[data-testid="badges-empty"]') })`);
    check(w, motion, "0 %: los 25 objetivos siguen visibles (LOCKED, descubribles), insignias vacías explicadas", e.tiles === 25 && e.locked === 25 && e.badgesEmpty, e);
    if (w === 390) await shot("room-empty");

    // ── detalle ──
    for (const [scene, want] of [["detail-progress", { state: "IN_PROGRESS", missing: 1, have: 4 }], ["detail-claimable", { state: "CLAIMABLE", missing: 0, have: 6 }], ["detail-completed", { state: "COMPLETED", missing: 1, have: 3 }], ["detail-edition", { state: "IN_PROGRESS", missing: 13, have: 7 }]] as const) {
      await open(c, scene);
      const d = await js<{ state: string; missing: number; have: number; claim: number; claimH: number; arts: number; artsAlt: number; where: number; variants: number; marks: boolean }>(c, `(() => {
        const det = document.querySelector('[data-testid="set-detail"]');
        const rq = [...document.querySelectorAll('[data-testid="requirement"]')];
        const b = document.querySelector('[data-testid="claim-badge"]');
        const arts = [...document.querySelectorAll('[data-testid="requirement"] img[data-card-art]')];
        return { state: det?.dataset.state, missing: rq.filter(x => x.dataset.satisfied === '0').length, have: rq.filter(x => x.dataset.satisfied === '1').length,
          claim: b ? 1 : 0, claimH: b ? b.getBoundingClientRect().height : 0, arts: arts.length, artsAlt: arts.filter(i => i.alt && i.alt.length > 3).length,
          where: [...document.querySelectorAll('[data-testid="missing-list"] p')].filter(p => /Puede salir en/.test(p.textContent)).length,
          variants: document.querySelectorAll('[data-testid="owned-variants"]').length,
          marks: rq.every(x => /Conseguido|Te falta/.test(x.textContent)) };
      })()`);
      check(w, motion, `${scene}: estado ${want.state}, ${want.have} tiene / ${want.missing} falta(n), textos «Conseguido/Te falta» (no solo color)`, d.state === want.state && d.missing === want.missing && d.have === want.have && d.marks, d);
      check(w, motion, `${scene}: CardArt real por requisito con alt; «dónde conseguirla» en cada falta`, d.arts === want.have + want.missing && d.artsAlt === d.arts && d.where === want.missing, d);
      check(w, motion, `${scene}: RECLAMAR solo si CLAIMABLE (≥44 px)`, scene === "detail-claimable" ? d.claim === 1 && d.claimH >= 44 : d.claim === 0, d);
      if (scene === "detail-progress") check(w, motion, "variantes poseídas listadas (≥2 jugadores con varias variantes; la Champions S de la escena suma otra de G2)", d.variants >= 2, d);
      check(w, motion, `${scene}: sin overflow y consola limpia`, (await ox(c)) <= 0 && errs(c).length === 0, await ox(c));
      await shot(scene);
    }

    // ── momento ──
    await open(c, "moment");
    await sleep(motion === "reduced" ? 400 : 1600);
    const m = await js<{ open: boolean; reduced: string; role: boolean; labelled: boolean; focusIn: boolean; logo: boolean; title: string }>(c, `(() => {
      const m = document.querySelector('[data-testid="completion-moment"]'); const d = m?.querySelector('[role="dialog"]');
      return { open: !!m, reduced: m?.dataset.reduced, role: !!d && d.getAttribute('aria-modal') === 'true', labelled: !!document.getElementById(d?.getAttribute('aria-labelledby') || '_'),
        focusIn: !!d && d.contains(document.activeElement), logo: !!m?.querySelector('img[alt^="Escudo de"]'), title: document.getElementById('completion-title')?.textContent || '' };
    })()`);
    check(w, motion, `momento: diálogo modal con título, foco dentro, escudo real; movimiento ${motion}`, m.open && m.role && m.labelled && m.focusIn && m.logo && /Heretics/i.test(m.title) && m.reduced === (motion === "reduced" ? "1" : "0"), m);
    await shot("moment");
    await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(600);
    check(w, motion, "momento: Escape lo cierra", !(await js<boolean>(c, `!!document.querySelector('[data-testid="completion-moment"]')`)));
    check(w, motion, "momento: consola limpia", errs(c).length === 0);

    // ── perfil ──
    for (const scene of ["profile-own", "profile-public", "profile-empty"]) {
      await open(c, scene);
      const p = await js<{ section: boolean; count: number; logos: number; locked: number; edit: boolean; size: number }>(c, `(() => {
        const s = document.querySelector('[data-testid="profile-badges"]');
        const b = [...(s?.querySelectorAll('[data-testid="trophy-badge"]') || [])];
        return { section: !!s, count: b.length, logos: s ? s.querySelectorAll('img[alt^="Escudo de"]').length : 0, locked: b.filter(x => x.dataset.locked === '1').length,
          edit: !!s && /Elegir insignias/.test(s.textContent), size: b[0] ? b[0].getBoundingClientRect().width : 0 };
      })()`);
      if (scene === "profile-empty") check(w, motion, "perfil propio sin destacadas: invita a elegir (sin insignias falsas)", p.section && p.count === 0 && p.edit, p);
      else check(w, motion, `${scene}: 3 insignias destacadas grandes (logo real en las de equipo), ninguna bloqueada${scene === "profile-own" ? ", acceso a elegir" : ", sin edición"}`,
        p.count === 3 && p.logos === 2 && p.locked === 0 && p.size >= 100 && (scene === "profile-own" ? p.edit : !p.edit), p);
      check(w, motion, `${scene}: sin overflow, consola limpia`, (await ox(c)) <= 0 && errs(c).length === 0, await ox(c));
      await js(c, `document.querySelector('[data-testid="profile-badges"]')?.scrollIntoView({ block: 'center' })`); await sleep(300);
      await shot(scene);
    }

    // ── editor ──
    await open(c, "editor-badges");
    const ed = await js<{ panel: boolean; slots: number; filled: number; options: number; disabled: number; save: boolean }>(c, `(() => ({
      panel: !!document.querySelector('[data-testid="editor-badges"]'), slots: document.querySelectorAll('[data-badge-slot]').length,
      filled: [...document.querySelectorAll('[data-badge-slot]')].filter(s => s.querySelector('[data-testid="trophy-badge"]')).length,
      options: document.querySelectorAll('[data-badge-option]').length,
      disabled: [...document.querySelectorAll('[data-badge-option]')].filter(b => b.disabled).length,
      save: !!document.querySelector('[data-testid="save-badges"]') }))()`);
    check(w, motion, "editor: 3 huecos llenos, opciones = insignias desbloqueadas, las no elegidas deshabilitadas al tope (límite 3)", ed.panel && ed.slots === 3 && ed.filled === 3 && ed.options === 4 && ed.disabled === 1 && ed.save, ed);
    await js(c, `document.querySelector('[aria-label="Bajar insignia 1"]')?.click()`);
    await sleep(200);
    const order = await js<string[]>(c, `[...document.querySelectorAll('[data-badge-slot] [data-testid="trophy-badge"]')].map(b => b.dataset.badge)`);
    check(w, motion, "editor: reordenar (bajar la 1.ª) cambia el orden y habilita Guardar", order.length === 3 && order[1].includes("fnatic") && !(await js<boolean>(c, `document.querySelector('[data-testid="save-badges"]').disabled`)), order);
    await js(c, `document.querySelector('[aria-label="Quitar insignia 3"]')?.click()`);
    await sleep(200);
    check(w, motion, "editor: quitar una libera el tope (ninguna opción deshabilitada)", (await js<number>(c, `[...document.querySelectorAll('[data-badge-option]')].filter(b => b.disabled).length`)) === 0);
    check(w, motion, "editor: sin overflow, consola limpia", (await ox(c)) <= 0 && errs(c).length === 0, await ox(c));
    await shot("editor-badges");
  } finally { await c.browser.close(); }
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3082";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/fase82`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}

async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  const motions = (arg("--motion") ? [arg("--motion")] : ["normal", "reduced"]) as ("normal" | "reduced")[];
  const widths = arg("--width") ? [Number(arg("--width"))] : [1440, 1024, 390];
  try {
    for (const motion of motions) for (const w of widths) await pass(w, motion);
  } finally { stop(); }
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, `qa-${motions.join("+")}-${widths.join("+")}.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nF82 QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
