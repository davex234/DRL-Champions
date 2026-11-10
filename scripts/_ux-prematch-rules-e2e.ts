/**
 * AJUSTE UX · E2E de la pre-partida (instrumento, fuera de CI): Chrome real sobre el arnés `/design-system/prematch-rules`
 * (PreMatch REAL + hook REAL `useDuelRulesIntro` → adaptador KV → localStorage). Sin sesión, red ni BD.
 *
 *   BASE_URL=http://127.0.0.1:3011 npx tsx scripts/_ux-prematch-rules-e2e.ts      (build local con NEXUS_QA_HARNESS=1)
 *
 * 1 primera entrada → reglas · 2 segunda entrada → no · 3 F5 → no · 4 salir y volver → no · 5 cerrar el navegador y
 * abrir otra sesión con el MISMO perfil → no · 6 otra cuenta → sí · 7 dificultades (ratón y teclado) · 8 «Comenzar
 * duelo» · 9 responsive 1440/1024/390 con y sin reglas (sin desbordamiento, tres opciones en fila, ≥ 44 px, sin hueco).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, type Browser } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/prematch-rules";
mkdirSync(OUT, { recursive: true });
const PROFILE = mkdtempSync(join(tmpdir(), "ux-prematch-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: d.slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 200)}`); };

async function open(width: number): Promise<Browser> {
  const b = await launch({ width, height: width < 600 ? 844 : width <= 1024 ? 768 : 900, userDataDir: PROFILE });
  await b.tab.resize(width, width < 600 ? 844 : width <= 1024 ? 768 : 900, 1);
  return b;
}
const state = async (b: Browser, user: string, opts: { reload?: boolean } = {}) => {
  if (opts.reload) await b.tab.send("Page.reload", {}); else await b.tab.goto(`${BASE}/design-system/prematch-rules?u=${user}`, 600);
  for (let i = 0; i < 40; i++) {
    const s = await b.tab.js<string>(`document.querySelector('[data-rules-state]')?.getAttribute('data-rules-state') ?? 'none'`).catch(() => "none");
    if (s === "show" || s === "hidden") break;
    await sleep(150);
  }
  // El splash de la app tapa la página al entrar: se espera a que se vaya antes de medir o fotografiar.
  for (let i = 0; i < 60; i++) { if (await b.tab.js<boolean>(`!document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`).catch(() => false)) break; await sleep(150); }
  await sleep(400);
  return b.tab.js<{ state: string; rules: boolean; stored: string | null }>(`({ state: document.querySelector('[data-rules-state]')?.getAttribute('data-rules-state'), rules: !!document.querySelector('[data-testid="prematch-rules"]'), stored: localStorage.getItem('drl:duel-rules-seen-${user}') })`);
};
const LAYOUT = `(() => {
  const btns = [...document.querySelectorAll('[aria-label="Dificultad"] button')].map(b => { const r = b.getBoundingClientRect(); return { t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), label: b.textContent.trim(), shown: b.innerText.trim(), pressed: b.getAttribute('aria-pressed') }; });
  const group = document.querySelector('[aria-label="Dificultad"]').getBoundingClientRect();
  const start = [...document.querySelectorAll('button')].find(b => /Comenzar duelo/i.test(b.textContent)).getBoundingClientRect();
  return { overflow: document.documentElement.scrollWidth - window.innerWidth, btns, gap: Math.round(start.top - group.bottom) };
})()`;

async function main() {
  // 1–4 · misma sesión
  let b = await open(1440);
  try {
    const s1 = await state(b, "qa-a");
    check("1 · primera entrada: reglas visibles", s1.state === "show" && s1.rules, s1);
    check("1b · marcada como vista SOLO tras pintarse", s1.stored === "1", s1);
    await b.tab.js(`document.querySelector('[aria-label="Dificultad"]').closest('section').scrollIntoView({ block: 'start' })`); await sleep(500);
    await b.tab.shot(`${OUT}/1440-primera.png`);
    const s2 = await state(b, "qa-a");
    check("2 · segunda entrada: SIN reglas", s2.state === "hidden" && !s2.rules, s2);
    await b.tab.shot(`${OUT}/1440-siguientes.png`);
    const s3 = await state(b, "qa-a", { reload: true });
    check("3 · F5: SIN reglas", s3.state === "hidden" && !s3.rules, s3);
    await b.tab.goto("about:blank", 300);
    const s4 = await state(b, "qa-a");
    check("4 · salir y volver: SIN reglas", s4.state === "hidden" && !s4.rules, s4);
    await sleep(4000); // Chrome guarda localStorage en disco de forma diferida: cierre «normal», no un corte en seco.
  } finally { await b.close(); }

  // 5–9 · navegador cerrado y otra sesión con el mismo perfil
  b = await open(1440);
  try {
    const s5 = await state(b, "qa-a");
    check("5 · cerrar el navegador y nueva sesión: SIN reglas", s5.state === "hidden" && !s5.rules, s5);
    const s6 = await state(b, "qa-b");
    check("6 · otra cuenta que nunca entró: reglas visibles", s6.state === "show" && s6.rules, s6);
    const s6b = await state(b, "qa-a");
    check("6b · volver a la primera cuenta: sigue sin reglas", s6b.state === "hidden" && !s6b.rules, s6b);

    // 7 · dificultades: ratón y teclado
    for (const d of ["EASY", "HARD", "NORMAL"]) {
      await b.tab.js(`document.querySelector('[data-difficulty="${d}"]').click()`); await sleep(150);
      const p = await b.tab.js<string[]>(`[...document.querySelectorAll('[aria-label="Dificultad"] button[aria-pressed="true"]')].map(x => x.dataset.difficulty)`);
      check(`7 · clic en ${d}: única seleccionada`, p.length === 1 && p[0] === d, p);
    }
    await b.tab.js(`document.querySelector('[data-difficulty="HARD"]').focus()`);
    await b.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
    await b.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await sleep(200);
    const kb = await b.tab.js<{ pressed: string | null; focused: string | null; outline: string }>(`(() => { const a = document.activeElement; return { pressed: document.querySelector('[aria-label="Dificultad"] [aria-pressed="true"]')?.dataset.difficulty ?? null, focused: a?.dataset?.difficulty ?? null, outline: getComputedStyle(a).outlineStyle + '/' + getComputedStyle(a).boxShadow.slice(0, 30) }; })()`);
    check("7b · teclado: foco en el botón y Enter selecciona Difícil", kb.pressed === "HARD" && kb.focused === "HARD", kb);
    const labels = await b.tab.js<{ dom: string[]; shown: string[] }>(`({ dom: [...document.querySelectorAll('[aria-label="Dificultad"] button')].map(x => x.textContent.trim()), shown: [...document.querySelectorAll('[aria-label="Dificultad"] button')].map(x => x.innerText.trim()) })`);
    check("7c · se ve FÁCIL · NORMAL · DIFÍCIL; el DOM conserva Fácil · Normal · Difícil", JSON.stringify(labels.shown) === JSON.stringify(["FÁCIL", "NORMAL", "DIFÍCIL"]) && JSON.stringify(labels.dom) === JSON.stringify(["Fácil", "Normal", "Difícil"]), labels);
    const body = await b.tab.js<string>("document.body.innerText");
    check("7d · sin etiquetas, descripciones ni párrafo inferior", !/Imprevisible|Competitivo|Exigente|Ningún nivel ve/i.test(body));
    // 8 · Comenzar duelo
    await b.tab.js(`[...document.querySelectorAll('button')].find(x => /Comenzar duelo/i.test(x.textContent)).click()`); await sleep(200);
    check("8 · «Comenzar duelo» funciona con la dificultad elegida", (await b.tab.js<string>(`document.querySelector('[data-started]').getAttribute('data-started')`)) === "HARD");
  } finally { await b.close(); }

  // 9 · responsive con y sin reglas
  for (const w of [1440, 1024, 390]) {
    b = await open(w);
    try {
      for (const [user, tag] of [[`qa-new-${w}`, "con-reglas"], ["qa-a", "sin-reglas"]] as const) {
        const s = await state(b, user);
        const l = await b.tab.js<{ overflow: number; btns: { t: number; w: number; h: number }[]; gap: number }>(LAYOUT);
        const oneRow = l.btns.length === 3 && new Set(l.btns.map((x) => x.t)).size === 1;
        const same = Math.max(...l.btns.map((x) => x.w)) - Math.min(...l.btns.map((x) => x.w)) <= 2;
        check(`9 · ${w} ${tag}: sin desbordamiento, 3 en fila, mismo ancho, ≥ 44 px`, l.overflow <= 0 && oneRow && same && l.btns.every((x) => x.h >= 44), { overflow: l.overflow, btns: l.btns, rules: s.rules });
        if (tag === "sin-reglas") check(`9 · ${w} sin reglas: compacto (sin hueco antes de «Comenzar duelo»)`, !s.rules && l.gap <= 48, { gap: l.gap });
        await b.tab.js(`document.querySelector('[aria-label="Dificultad"]').closest('section').scrollIntoView({ block: 'start' })`); await sleep(500);
        await b.tab.shot(`${OUT}/${w}-${tag}.png`);
      }
    } finally { await b.close(); }
  }
  writeFileSync(`${OUT}/e2e.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, total: rows.length, pass: rows.filter((r) => r.ok).length, rows }, null, 1));
  console.log(`\nPREMATCH RULES E2E: ${rows.filter((r) => r.ok).length}/${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
