/**
 * F72.5 · QA REAL DE LOS CTAs DE /jugar (fuera de CI) — Chrome real contra :3005, cuenta QA.
 *
 *   npx tsx scripts/_f725-qa.ts before [persona=A]   capturas + medidas de los 3 botones (1440/1024/390)
 *   npx tsx scripts/_f725-qa.ts after  [persona=A]   lo mismo + criterios: ancho ≈ tarjeta, alto ≥ 60 px, fondo sólido del
 *                                                    color del modo, contraste ≥ 4.5, texto entero, flecha, sin overflow;
 *                                                    hover (brillo + flecha), active, focus-visible por teclado, reducido
 *                                                    (sin desplazamientos), los 3 destinos, banda y JUGAR global intactos
 * Escribe docs/product/qa/fase72-5/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, type Client } from "./_fase68-lib";

const MODE = process.argv[2] ?? "after";
const P = process.argv[3] ?? "A";
const OUT = join(process.cwd(), "docs/product/qa/fase72-5");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const IDS = ["RTC", "DUELS", "COACH"] as const;
const TINT: Record<string, [number, number, number]> = { RTC: [255, 211, 92], DUELS: [255, 46, 99], COACH: [47, 224, 255] };
const EXPECT_PATH: Record<string, RegExp> = { RTC: /^\/(jugar\/road-to-champions|duelos)/, DUELS: /^\/duelos$/, COACH: /^\/entrenador/ };

async function openJugar(c: Client) {
  await goto(c, "/jugar", 3000);
  await waitFor(c.tab, `!!document.querySelector('[data-testid="play-area-cta-COACH"]')`, 20000);
  await sleep(1500);
}

/** Medidas de cada CTA: caja, tarjeta, tipografía, colores, contraste, flecha, texto cortado. */
const measure = (c: Client) => c.tab.js<any>(`(() => {
  const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 4).map(Number);
  return ${JSON.stringify(IDS)}.map(id => {
    const a = document.querySelector('[data-testid="play-area-cta-' + id + '"]'); const card = document.querySelector('[data-testid="play-area-' + id + '"]');
    if (!a || !card) return { id, missing: true };
    const r = a.getBoundingClientRect(), cr = card.getBoundingClientRect(), cs = getComputedStyle(a);
    const bg = rgb(cs.backgroundColor), fg = rgb(cs.color);
    const L1 = lum(bg[0], bg[1], bg[2]), L2 = lum(fg[0], fg[1], fg[2]);
    const label = a.querySelector('[data-cta-label]') || a;
    const arrow = a.querySelector('[data-cta-arrow]');
    return { id, href: a.getAttribute('href'), text: (a.innerText || '').replace(/\\s+/g, ' ').trim(), dataCta: a.getAttribute('data-cta'),
      w: Math.round(r.width), h: Math.round(r.height), cardW: Math.round(cr.width), widthRatio: +(r.width / cr.width).toFixed(3),
      padLeft: Math.round(r.left - cr.left), padBottom: Math.round(cr.bottom - r.bottom),
      fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight, transform: cs.textTransform, bg: cs.backgroundColor, fg: cs.color, bgAlpha: bg.length > 3 ? bg[3] : 1,
      contrast: +(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05))).toFixed(2),
      cut: label.scrollWidth > label.clientWidth + 1 || a.scrollWidth > a.clientWidth + 1, arrow: !!arrow && arrow.getBoundingClientRect().width > 0 };
  });
})()`);

(async () => {
  const results: any[] = []; const byWidth: any = {};
  const check = (w: number, id: string, ok: boolean, detail = "") => { results.push({ width: w, id, ok, detail: String(detail).slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} [${w}] ${id} ${String(detail).slice(0, 170)}`); };
  for (const width of [1440, 1024, 390]) {
    const c = await openBrowser(P, width, { label: `f725-${MODE}` });
    const out: any = { width };
    try {
      await loginUi(c, P);
      await openJugar(c);
      c.tab.takeErrors();
      await c.tab.shot(join(SHOTS, `${MODE}-jugar-${width}.png`));
      // Recorte de las tres tarjetas (zona del botón incluida).
      const box = await c.tab.js<any>(`(() => { const r = document.querySelector('[data-testid="play-areas"]').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top + scrollY - 8), width: r.width + 16, height: r.height + 16 }; })()`);
      const s = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 }, captureBeyondViewport: true }).catch(() => null);
      if (s?.data) writeFileSync(join(SHOTS, `${MODE}-tarjetas-${width}.png`), Buffer.from(s.data, "base64"));
      const m = await measure(c);
      out.ctas = m;
      if (MODE === "before") { byWidth[width] = out; continue; }

      const ox = await c.tab.js<number>(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      check(width, "sin scroll horizontal", ox <= 0, `overflowX=${ox}`);
      for (const x of m) {
        // «Ancho útil» = la tarjeta menos su margen interior; el botón lo llena entero y conserva aire (12–28 px) alrededor.
        const useful = x.cardW - 2 * x.padLeft;
        check(width, `${x.id}: todo el ancho útil de la tarjeta, con aire alrededor (12–28 px)`, x.w >= useful - 2 && x.padLeft >= 12 && x.padLeft <= 28 && x.padBottom >= 12, `w=${x.w} útil=${useful} (${x.widthRatio} de la tarjeta) pad=${x.padLeft}/${x.padBottom}`);
        check(width, `${x.id}: alto ≥ 60 px, texto ≥ 16 px en mayúsculas y negrita`, x.h >= 60 && x.fontSize >= 16 && x.transform === "uppercase" && Number(x.fontWeight) >= 700, `h=${x.h} font=${x.fontSize} ${x.fontWeight}`);
        const [r, g, b] = TINT[x.id]; const bg = (x.bg.match(/[\d.]+/g) || []).map(Number);
        check(width, `${x.id}: fondo SÓLIDO del color de su modo`, x.bgAlpha === 1 && Math.abs(bg[0] - r) <= 6 && Math.abs(bg[1] - g) <= 6 && Math.abs(bg[2] - b) <= 6, `${x.bg}`);
        // WCAG AA: 4,5:1, o 3:1 si es texto GRANDE (≥ 18,66 px en negrita).
        const large = x.fontSize >= 18.66 && Number(x.fontWeight) >= 700;
        check(width, `${x.id}: contraste texto/fondo AA (${large ? "texto grande ≥ 3" : "≥ 4.5"})`, x.contrast >= (large ? 3 : 4.5), `${x.contrast} (${x.fg} sobre ${x.bg}, ${x.fontSize}px)`);
        check(width, `${x.id}: texto entero y flecha visible`, !x.cut && x.arrow, x.text);
      }
      const hs = m.map((x: any) => x.h);
      check(width, "los tres con el mismo peso (misma altura, ±2 px)", Math.max(...hs) - Math.min(...hs) <= 2, hs.join("/"));
      check(width, "la acción dominante sigue siendo UNA (data-cta=primary)", m.filter((x: any) => x.dataCta === "primary").length <= 1, m.map((x: any) => `${x.id}:${x.dataCta}`).join(" "));

      // Hover (ratón real vía CDP): brillo, flecha desplazada.
      const center = (id: string) => c.tab.js<any>(`(() => { const r = document.querySelector('[data-testid="play-area-cta-${id}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await c.tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]').scrollIntoView({ block: 'center' })`); await sleep(400);
      const idle = await c.tab.js<any>(`(() => { const a = document.querySelector('[data-testid="play-area-cta-DUELS"]'); return { f: getComputedStyle(a).filter, t: getComputedStyle(a.querySelector('[data-cta-arrow]')).transform }; })()`);
      const p = await center("DUELS");
      await c.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await sleep(450);
      const hov = await c.tab.js<any>(`(() => { const a = document.querySelector('[data-testid="play-area-cta-DUELS"]'); return { f: getComputedStyle(a).filter, t: getComputedStyle(a.querySelector('[data-cta-arrow]')).transform, cursor: getComputedStyle(a).cursor }; })()`);
      await c.tab.send("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, p.x - 260), y: Math.max(0, p.y - 70), width: 520, height: 140, scale: 2 } }).then((r: any) => writeFileSync(join(SHOTS, `hover-duels-${width}.png`), Buffer.from(r.data, "base64"))).catch(() => null);
      check(width, "hover: más luminoso, flecha se desplaza, cursor de enlace", hov.f !== idle.f && hov.t !== idle.t && hov.cursor === "pointer", `filter ${idle.f}→${hov.f} · flecha ${idle.t}→${hov.t}`);
      // Active: pulsación (mousePressed sin soltar).
      await c.tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }); await sleep(120);
      const act = await c.tab.js<string>(`getComputedStyle(document.querySelector('[data-testid="play-area-cta-DUELS"]')).transform`);
      check(width, "active: respuesta inmediata al pulsar", act !== "none", act);
      await c.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
      // Soltar fuera del botón: no navega.
      await c.tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 2, y: 2, button: "left", clickCount: 1 }); await sleep(300);
      // Focus-visible por TECLADO (Tab real hasta el botón de Coach).
      await c.tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]').focus()`);
      await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); await sleep(300);
      const foc = await c.tab.js<any>(`(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { tid: a.getAttribute('data-testid'), fv: a.matches(':focus-visible'), ring: cs.boxShadow, outline: cs.outlineStyle + ' ' + cs.outlineWidth }; })()`);
      const fp = await center("COACH");
      await c.tab.send("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, fp.x - 260), y: Math.max(0, fp.y - 70), width: 520, height: 140, scale: 2 } }).then((r: any) => writeFileSync(join(SHOTS, `focus-coach-${width}.png`), Buffer.from(r.data, "base64"))).catch(() => null);
      check(width, "focus-visible por teclado: anillo reconocible", foc.tid === "play-area-cta-COACH" && foc.fv && (/rgb/.test(foc.ring) && foc.ring !== "none" || !/none/.test(foc.outline)), JSON.stringify(foc));
      // Reducido: el hover no desplaza nada.
      await c.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await c.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await sleep(400);
      const red = await c.tab.js<any>(`(() => { const a = document.querySelector('[data-testid="play-area-cta-DUELS"]'); return { t: getComputedStyle(a).transform, at: getComputedStyle(a.querySelector('[data-cta-arrow]')).transform, tr: getComputedStyle(a).transitionDuration }; })()`);
      check(width, "movimiento reducido: sin desplazamientos (botón y flecha quietos)", red.t === "none" && (red.at === "none" || red.at === "matrix(1, 0, 0, 1, 0, 0)"), JSON.stringify(red));
      await c.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      await c.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
      // Los tres destinos, con clic real.
      for (const id of IDS) {
        await openJugar(c);
        const q = await center(id);
        await c.tab.js(`document.querySelector('[data-testid="play-area-cta-${id}"]').scrollIntoView({ block: 'center' })`); await sleep(300);
        const q2 = await center(id);
        await c.tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: q2.x, y: q2.y, button: "left", clickCount: 1 });
        await c.tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: q2.x, y: q2.y, button: "left", clickCount: 1 });
        await waitFor(c.tab, `location.pathname !== '/jugar'`, 15000);
        const path = await c.tab.js<string>(`location.pathname`);
        check(width, `${id}: el clic lleva a su destino de siempre`, EXPECT_PATH[id].test(path), `${path} (href ${m.find((x: any) => x.id === id)?.href}, q=${Math.round(q.y)})`);
      }
      const errs = c.tab.takeErrors();
      check(width, "0 errores de consola y 0 «Failed to fetch»", errs.length === 0, errs[0] ?? "");
    } finally { await c.browser.close(); }
    byWidth[width] = out;
  }
  const pass = results.filter((r) => r.ok).length;
  writeFileSync(join(OUT, `${MODE}.json`), JSON.stringify({ at: new Date().toISOString(), persona: P, pass, total: results.length, results, byWidth }, null, 2) + "\n");
  console.log(`f72.5 ${MODE}: ${pass}/${results.length}`);
  process.exit(MODE === "before" || pass === results.length ? 0 : 1);
})();
