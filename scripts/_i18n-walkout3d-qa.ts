/**
 * QA · WALKOUT 0.9 EN 3D POR IDIOMA (instrumento, fuera de CI y de la release). Solo contra el stack de QA aislado.
 *
 *   QA_ENV=<qa.env> npx tsx scripts/_i18n-walkout3d-qa.ts [es,en,de,it]
 *
 * La QA autenticada corre con movimiento reducido (escena 2D). Aquí se abre un Sobre ICON real con animaciones
 * («Cinemática 3D», WebGL por software) y se comprueba que la escena 3D arranca, llega al final sin errores y que sus
 * rótulos están en el idioma. La carta la decide y guarda el servidor antes de la animación.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { api, chooseLocale, clickTid, collect, goto, loginUi, open, probe, q, sleep, token, type Loc } from "./_i18n-auth-lib";

const OUT = join(process.cwd(), "docs/product/qa/i18n-auth");
const rows: { locale: string; id: string; ok: boolean; detail: string }[] = [];

/**
 * Cartas que el servidor dice que se han ganado entre dos estados. COLECCIONES ILIMITADAS · el estado lleva un ejemplar
 * por carta y los RECUENTOS (`ownedCounts`): una copia repetida no aparece como ejemplar nuevo, pero sí sube su
 * recuento, y eso es exacto para cualquier tamaño de colección. Con una build anterior (sin recuentos) se comparan los
 * ejemplares, como antes.
 */
type CardState = { ownedCards: { uid: string; cardId: string }[]; ownedCounts?: Record<string, number>; ownedTotal?: number };
function gained(before: CardState, after: CardState): string[] {
  if (!before.ownedCounts || !after.ownedCounts) return after.ownedCards.filter((x) => !before.ownedCards.some((y) => y.uid === x.uid)).map((x) => x.cardId).sort();
  const out: string[] = [];
  for (const [id, n] of Object.entries(after.ownedCounts)) for (let i = before.ownedCounts[id] ?? 0; i < n; i++) out.push(id);
  return out.sort();
}

async function run(l: Loc) {
  const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ locale: l, id, ok, detail: d.slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"} · ${l} · ${id} — ${d.slice(0, 300)}`); };
  const c = await open(1440, { reduced: false, gpu: true });
  try {
    await goto(c, "/cuenta", 1500);
    await chooseLocale(c, l);
    await c.tab.js(`localStorage.setItem('drl:opening-animation:v1', 'cinematic')`);
    await loginUi(c, "PLAYER");
    await sleep(1500);
    const t = await token("PLAYER");
    const buy = await api(t.access, "/api/game/packs", { action: "buy", packId: "icon-single", ref: `i18nw3d-${randomUUID()}`, expectedPrice: 30000 });
    check("compra del Sobre ICON (servidor)", buy.status === 200, buy.status);
    const before = (await api(t.access, "/api/game/state")).json as CardState;
    await goto(c, "/cuenta?seccion=cuenta", 1500);
    const pref = await clickTid(c, "opening-animation-cinematic"); await sleep(500);
    await goto(c, "/abrir/icon-single", 2500);
    await clickTid(c, "pack-open");
    let seen = false, stage = "", text = "", reason = "", lang = "", spanish: string[] = [], keys: string[] = [];
    const trace: string[] = [];
    for (let i = 0; i < 220; i++) {
      if (await c.tab.js<boolean>(q("pack-summary"))) break;
      const w = await c.tab.js<{ on: boolean; stage: string; text: string; reason: string }>(`(() => { const w = document.querySelector('[data-testid="pack-walkout"], [data-testid="walkout"]'); if (!w) return { on: false, stage: '', text: '', reason: '' }; return { on: true, stage: document.querySelector('[data-testid="walkout-stage-3d"]') ? '3d' : document.querySelector('[data-testid="walkout-stage-2d"]') ? '2d' : '?', text: w.innerText.slice(0, 700), reason: document.querySelector('[data-testid="walkout-stage-2d"]')?.getAttribute('data-reason') ?? '' }; })()`).catch(() => ({ on: false, stage: "", text: "", reason: "" }));
      if (w.on) {
        if (!seen) { await sleep(6000); const p = await probe(c); lang = p.lang; spanish = p.spanish; keys = p.keys; mkdirSync(join(OUT, l), { recursive: true }); await c.tab.shot(join(OUT, l, "walkout-3d.png")).catch(() => null); }
        seen = true; if (w.stage === "3d" || !stage) stage = w.stage; if (w.text.length > text.length) text = w.text; reason = w.reason || reason;
        await sleep(1500);
        await clickTid(c, "pack-walkout-continue");
        continue;
      }
      // El walkout se carga bajo demanda: entre la fase `walkout` y el montaje de la escena hay un «Preparando…» sin
      // `pack-walkout`. Ahí no se pulsa nada («Omitir» existe en esa fase y se llevaría el walkout entero al resumen).
      // La fase se lee y se pulsa en UNA sola evaluación (leer y pulsar en llamadas separadas dejaba un hueco en el que la
      // fase pasaba a `walkout` y se pulsaba «Omitir» igualmente). Con walkouts pendientes, el instrumento NUNCA omite.
      const step = await c.tab.js<{ phase: string; walkouts: number; clicked: string }>(`(() => {
        const root = document.querySelector('[data-testid="pack-opening"]');
        const phase = root?.getAttribute('data-phase') ?? '', walkouts = Number(root?.getAttribute('data-walkouts') ?? 0);
        if (phase === 'walkout') return { phase, walkouts, clicked: '' };
        const ids = ['hero-continue', 'rest-continue', 'intro-advance', ...(walkouts > 0 && !${seen} ? [] : ['pack-reveal-all', 'pack-skip'])];
        for (const id of ids) { const e = document.querySelector('[data-testid="' + id + '"]'); if (e && !e.disabled) { e.click(); return { phase, walkouts, clicked: id }; } }
        if (phase !== 'opening' && phase !== 'requesting') document.querySelector('[data-testid="rest-reveal"], [data-testid="reveal-card"], [data-testid="hero-reveal"], [data-testid="ceremony-pack"], [data-testid="pack-stage"]')?.click();
        return { phase, walkouts, clicked: '' };
      })()`).catch(() => ({ phase: "?", walkouts: 0, clicked: "" }));
      const mark = `${step.phase}${step.clicked ? `>${step.clicked}` : ""}`;
      if (trace[trace.length - 1] !== mark) trace.push(mark);
      await sleep(step.phase === "walkout" ? 300 : 700);
    }
    const done = await c.tab.js<boolean>(q("pack-summary"));
    const after = (await api(t.access, "/api/game/state")).json as CardState;
    const got = gained(before, after);
    collect(c, "walkout 3d");
    check("preferencia «Cinemática 3D» seleccionable", pref);
    check("WALKOUT aparece", seen, { stage, reason, traza: trace.join(" | ").slice(0, 240) });
    check("WALKOUT en 3D (WebGL por software)", stage === "3d", { stage, reason });
    check("WALKOUT en el idioma, sin español ni claves", seen && lang === l && keys.length === 0 && (l === "es" || spanish.length === 0), { lang, spanish: spanish.slice(0, 5), texto: text.replace(/\n+/g, " | ").slice(0, 200) });
    check("la apertura termina en el resumen con 1 carta del servidor", done && got.length === 1, { got });
    check("sin errores de consola durante el WALKOUT", c.errors.length === 0, c.errors.slice(0, 4));
  } finally { await c.browser.close(); }
}

async function main() {
  for (const l of (process.argv[2] ?? "es,en,de,it,fr,pt-PT,pt-BR,ja").split(",") as Loc[]) { try { await run(l); } catch (e) { rows.push({ locale: l, id: "EJECUCIÓN", ok: false, detail: String(e).slice(0, 300) }); console.log(`FAIL · ${l} · EJECUCIÓN — ${String(e).slice(0, 200)}`); } }
  writeFileSync(join(process.cwd(), "logs/i18n/rc/walkout3d-qa.json"), JSON.stringify(rows, null, 1));
  console.log(`RESULTADO · ${rows.filter((r) => r.ok).length} PASS · ${rows.filter((r) => !r.ok).length} FAIL`);
}
main().catch((e) => { console.error(e); process.exit(1); });
