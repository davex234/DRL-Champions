/**
 * F72.4 · QA REAL DE LA TIENDA SIMPLIFICADA (fuera de CI) — Chrome real contra :3005, cuentas QA.
 *
 *   npx tsx scripts/_f724-qa.ts before [persona=A]     capturas y texto de las tarjetas ANTES (1440/1024/390)
 *   npx tsx scripts/_f724-qa.ts after  [persona=A]     catálogo + detalle de cada clase de producto a 1440/1024/390:
 *                                                     tarjeta mínima, arte dominante, alturas iguales, sin overflow,
 *                                                     modal dentro del viewport, probabilidades = fuente del servidor,
 *                                                     teclado (Enter abre, Escape cierra, foco vuelve), 0 errores
 *   npx tsx scripts/_f724-qa.ts buy    [persona=D]     compra REAL: cancelar no cobra; doble clic + Enter repetido en
 *                                                     confirmar = UN cargo; inventario +1; recarga y API persisten
 * Escribe docs/product/qa/fase72-4/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, token, api, type Client } from "./_fase68-lib";
import { resolveStore } from "../src/domain/store/resolve";
import { getPack } from "../src/data/packs";
import { formatCredits } from "../src/lib/format";

const MODE = process.argv[2] ?? "after";
const P = process.argv[3] ?? (MODE === "buy" ? "D" : "A");
const OUT = join(process.cwd(), "docs/product/qa/fase72-4");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const WIDTHS = [1440, 1024, 390];

async function openStore(c: Client) {
  await goto(c, "/tienda", 3000);
  await waitFor(c.tab, `!!document.querySelector('#sobres article')`, 20000);
  await sleep(1200);
}

/** El texto VISIBLE de cada tarjeta del catálogo, por sección. */
const cardTexts = (c: Client) => c.tab.js<any>(`(() => {
  const out = {};
  for (const s of document.querySelectorAll('section[id]')) {
    const arts = [...s.querySelectorAll('article')];
    if (!arts.length) continue;
    out[s.id] = arts.map(a => { const r = a.getBoundingClientRect(); const img = a.querySelector('[data-product-art]') || a.querySelector('img, svg'); const ir = img ? img.getBoundingClientRect() : null;
      // Texto visible SIN el dibujado dentro de un SVG (el «×10» de la caja es arte, no información).
      const svgText = [...a.querySelectorAll('svg text')].map(t => t.textContent || '').join(' ');
      const raw = (a.innerText || '').replace(/\\s+/g, ' ').trim();
      // Arte CONTENIDO: la imagen (o el SVG) de un sobre, caja o carta no se sale de su zona (si se sale, se recorta).
      const zone = a.querySelector('[data-product-art]'); const zr = zone ? zone.getBoundingClientRect() : null;
      const artEl = a.getAttribute('data-kind') === 'BUNDLE' ? null : zone && zone.querySelector('img, svg');
      const er = artEl ? artEl.getBoundingClientRect() : null;
      const clipped = !!(zr && er && (er.bottom > zr.bottom + 1 || er.top < zr.top - 1 || er.left < zr.left - 1 || er.right > zr.right + 1));
      return { clipped, text: svgText ? raw.replace(svgText.trim(), '').replace(/\\s+/g, ' ').trim() : raw, h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top + scrollY), artH: ir ? Math.round(ir.height) : 0 }; });
  }
  return out;
})()`);

const overflowX = (c: Client) => c.tab.js<number>(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);

async function shotSection(c: Client, id: string, file: string) {
  await c.tab.js(`document.getElementById(${JSON.stringify(id)})?.scrollIntoView({ block: 'start' })`);
  await sleep(700);
  await c.tab.shot(join(SHOTS, file)).catch(() => null);
}

/** Abre el detalle de un producto por el aria-label de su botón. */
async function openProduct(c: Client, labelRe: string): Promise<boolean> {
  return c.tab.js<boolean>(`(async () => { const b = [...document.querySelectorAll('article button[aria-label]')].find(x => new RegExp(${JSON.stringify(labelRe)}, 'i').test(x.getAttribute('aria-label')));
    if (!b) return false; b.scrollIntoView({ block: 'center' }); b.focus(); b.click(); await new Promise(r => setTimeout(r, 900)); return !!document.querySelector('[data-testid="store-purchase-modal"]'); })()`);
}
const modalInfo = (c: Client) => c.tab.js<any>(`(() => { const m = document.querySelector('[data-testid="store-purchase-modal"]'); if (!m) return null; const r = m.getBoundingClientRect();
  const odds = [...m.querySelectorAll('[data-testid="odds-row"]')].map(e => ({ key: e.getAttribute('data-key'), pct: e.getAttribute('data-pct'), text: (e.innerText || '').replace(/\\s+/g, ' ').trim() }));
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  return { text: (m.innerText || '').replace(/\\s+/g, ' ').trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, vh: innerHeight,
    scrollH: m.scrollHeight, clientH: m.clientHeight, odds, oddsSource: m.querySelector('[data-odds-source]')?.getAttribute('data-odds-source') ?? null,
    balance: m.querySelector('[data-testid="balance-now"]')?.textContent?.trim() ?? null, after: m.querySelector('[data-testid="balance-after"]')?.textContent?.trim() ?? null,
    confirm: [...m.querySelectorAll('button')].filter(vis).map(b => ({ text: (b.innerText || '').trim(), disabled: b.disabled })), focusInside: m.contains(document.activeElement) }; })()`);
async function closeModal(c: Client) {
  await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
}

(async () => {
  if (MODE === "before") {
    const all: any = {};
    for (const width of WIDTHS) {
      const c = await openBrowser(P, width, { label: "f724-before" });
      try {
        await loginUi(c, P);
        await openStore(c);
        await c.tab.shot(join(SHOTS, `before-catalogo-${width}.png`));
        await shotSection(c, "sobres", `before-sobres-${width}.png`);
        await shotSection(c, "cajas", `before-cajas-${width}.png`);
        await shotSection(c, "cartas", `before-cartas-${width}.png`);
        const texts = await cardTexts(c);
        const opened = await openProduct(c, "^Comprar (o abrir )?Sobre Bronce$");
        await sleep(500);
        await c.tab.shot(join(SHOTS, `before-modal-bronce-${width}.png`));
        all[width] = { texts, modal: opened ? await modalInfo(c) : null, overflowX: await overflowX(c) };
        await closeModal(c);
      } finally { await c.browser.close(); }
    }
    writeFileSync(join(OUT, "before.json"), JSON.stringify({ at: new Date().toISOString(), persona: P, byWidth: all }, null, 2) + "\n");
    console.log("before: ok");
    return;
  }

  if (MODE === "after") {
    const { productOdds } = await import("../src/components/store/storeView");
    const view = resolveStore(Date.now());
    const results: any[] = []; const byWidth: any = {};
    const check = (w: number, id: string, ok: boolean, detail = "") => { results.push({ width: w, id, ok, detail: String(detail).slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"} [${w}] ${id} ${String(detail).slice(0, 180)}`); };
    // Productos a abrir: un sobre de la línea principal, uno regional, uno de equipo, una caja, una carta y un pack.
    const pick = (f: (p: any) => boolean) => view.packs.find(f);
    const targets = [
      { tag: "sobre-oro", p: pick((p) => p.packId === "oro") },
      { tag: "sobre-regional", p: pick((p) => !!getPack(p.packId!)?.restrictRegion) },
      { tag: "sobre-equipo", p: pick((p) => !!getPack(p.packId!)?.team) },
      { tag: "caja", p: view.boxes[0] },
      { tag: "carta", p: view.cards[0] },
      { tag: "pack", p: view.bundles[0] },
    ].filter((t) => t.p);
    for (const width of WIDTHS) {
      const c = await openBrowser(P, width, { label: "f724-after" });
      const out: any = { width };
      try {
        await loginUi(c, P);
        await openStore(c);
        c.tab.takeErrors();
        await c.tab.shot(join(SHOTS, `catalogo-${width}.png`));
        for (const s of ["sobres", "cajas", "cartas", "packs"]) await shotSection(c, s, `seccion-${s}-${width}.png`);
        const texts = await cardTexts(c);
        out.cards = texts;
        const flat = Object.values(texts).flat() as any[];
        // Tarjeta mínima: nombre + precio + CTA (+ insignias). Sin %, sin «cartas», sin €, sin ediciones/rarezas.
        const noisy = flat.filter((x) => /%|cartas|carta aleatoria|€|Por anunciar ·|Base \d|Edición|OVR|×|Se guardan|Puede traer/i.test(x.text));
        check(width, "catálogo: tarjetas SOLO imagen + nombre + precio + CTA (sin %, nº de cartas, €, rarezas ni contenido)", flat.length > 0 && noisy.length === 0, noisy.slice(0, 3).map((x) => x.text).join(" | ") || `${flat.length} tarjetas`);
        const words = flat.map((x) => x.text.split(" ").length);
        check(width, "catálogo: texto por tarjeta ≤ 9 palabras", Math.max(...words) <= 9, `max=${Math.max(...words)} ${flat.find((x) => x.text.split(" ").length === Math.max(...words))?.text}`);
        // El arte domina: ≥ 50 % de la altura de la tarjeta.
        const ratios = flat.map((x) => x.artH / x.h);
        check(width, "catálogo: el arte ocupa ≥ 50 % de la altura de cada tarjeta", Math.min(...ratios) >= 0.5, `min=${Math.min(...ratios).toFixed(2)}`);
        const clippedArt = flat.filter((x) => x.clipped);
        check(width, "catálogo: arte entero, sin recortar (sobre, caja y carta caben en su zona)", clippedArt.length === 0, clippedArt.map((x) => x.text).slice(0, 3).join(" | ") || "0 recortados");
        const cut = await c.tab.js<string[]>(`[...document.querySelectorAll('article[data-testid="store-product"] h3')].filter(h => h.scrollHeight > h.clientHeight + 1 || h.scrollWidth > h.clientWidth + 1).map(h => h.textContent)`);
        check(width, "catálogo: ningún nombre cortado", cut.length === 0, cut.join(", ") || "0");
        // Alturas iguales dentro de cada fila de cada sección.
        let uneven = 0;
        for (const arr of Object.values(texts) as any[][]) {
          const rows = new Map<number, number[]>();
          for (const x of arr) rows.set(x.top, [...(rows.get(x.top) ?? []), x.h]);
          for (const hs of rows.values()) if (Math.max(...hs) - Math.min(...hs) > 2) uneven++;
        }
        check(width, "catálogo: alturas iguales en cada fila", uneven === 0, `filas desiguales=${uneven}`);
        const perRow = (texts.sobres ?? []).filter((x: any) => x.top === texts.sobres[0].top).length;
        check(width, "catálogo: varios productos a la vista por fila", width >= 1024 ? perRow >= 4 : perRow >= 2, `sobres por fila=${perRow}`);
        check(width, "sin scroll horizontal", (await overflowX(c)) <= 0, `overflowX=${await overflowX(c)}`);
        // Detalle de cada clase de producto.
        out.modals = {};
        for (const t of targets) {
          const name = t.p!.kind === "CARD" ? null : t.p!.name;
          const re = name ? `^(Comprar|Ver) ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` : "^(Comprar|Ver) .+";
          const sel = t.p!.kind === "CARD" ? `^(Comprar|Ver) ` : re;
          await c.tab.js(`document.getElementById(${JSON.stringify(t.p!.kind === "PACK" ? "sobres" : t.p!.kind === "BOX" ? "cajas" : t.p!.kind === "CARD" ? "cartas" : "packs")})?.scrollIntoView()`);
          await sleep(300);
          let ok = false;
          if (t.p!.kind === "CARD") ok = await c.tab.js<boolean>(`(async () => { const b = document.querySelector('#cartas article button[aria-label]'); if (!b) return false; b.focus(); b.click(); await new Promise(r => setTimeout(r, 900)); return !!document.querySelector('[data-testid="store-purchase-modal"]'); })()`);
          else {
            // Los sobres pasados los 8 primeros están plegados tras «Ver todos»: se despliega como lo haría el jugador.
            await c.tab.js(`(() => { const b = [...document.querySelectorAll('#sobres button[aria-expanded="false"]')][0]; if (b) b.click(); })()`);
            await sleep(400);
            ok = await openProduct(c, sel);
          }
          await sleep(500);
          const m = ok ? await modalInfo(c) : null;
          await c.tab.shot(join(SHOTS, `detalle-${t.tag}-${width}.png`)).catch(() => null);
          out.modals[t.tag] = m;
          check(width, `detalle ${t.tag}: se abre al pulsar (no compra), dentro del viewport, foco dentro`, !!m && m.left >= 0 && m.right <= m.vw && m.top >= 0 && m.focusInside, m ? `${m.left},${m.top}→${m.right},${m.bottom} vw=${m.vw} vh=${m.vh}` : "no abre");
          if (m && t.p!.kind !== "CARD") {
            const expected = productOdds(t.p!);
            const flatExp = expected.flatMap((g) => g.rows.map((r) => ({ key: `${g.packId}:${r.key}`, pct: r.pct })));
            const got = m.odds.map((o: any) => ({ key: o.key, pct: o.pct }));
            check(width, `detalle ${t.tag}: probabilidades = fuente del servidor (${expected.map((g) => g.source).join(",")})`, got.length > 0 && JSON.stringify(got) === JSON.stringify(flatExp), JSON.stringify(got).slice(0, 200));
          }
          if (m && t.p!.kind === "PACK") check(width, `detalle ${t.tag}: precio, nº de cartas, saldo y saldo después`, !!m.balance && !!m.after && /carta/i.test(m.text) && m.confirm.some((b: any) => /^Confirmar compra/i.test(b.text)), `${m.balance} → ${m.after}`);
          if (m && t.p!.kind === "CARD") check(width, "detalle carta: edición, rareza, OVR y equipo SOLO en el detalle", /OVR \d+/.test(m.text), m.text.slice(0, 160));
          await closeModal(c);
          const closed = await c.tab.js<boolean>(`!document.querySelector('[data-testid="store-purchase-modal"]')`);
          const refocus = await c.tab.js<boolean>(`!!document.activeElement && document.activeElement.tagName === 'BUTTON' && !!document.activeElement.closest('article')`);
          check(width, `detalle ${t.tag}: Escape cierra y el foco vuelve a su tarjeta`, closed && refocus, `closed=${closed} refocus=${refocus}`);
        }
        // Teclado: Enter sobre el botón de un sobre abre el detalle.
        await c.tab.js(`document.getElementById('sobres')?.scrollIntoView()`);
        await c.tab.js(`document.querySelector('#sobres article button[aria-label]')?.focus()`);
        await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
        await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await sleep(700);
        check(width, "teclado: Enter en COMPRAR abre el detalle (no compra)", await c.tab.js<boolean>(`!!document.querySelector('[data-testid="store-purchase-modal"]')`));
        await closeModal(c);
        const errs = c.tab.takeErrors();
        check(width, "0 errores de consola", errs.length === 0, errs[0] ?? "");
        out.overflowX = await overflowX(c);
      } finally { await c.browser.close(); }
      byWidth[width] = out;
    }
    const pass = results.filter((r) => r.ok).length;
    writeFileSync(join(OUT, "after.json"), JSON.stringify({ at: new Date().toISOString(), persona: P, pass, total: results.length, results, byWidth }, null, 2) + "\n");
    console.log(`f72.4 after: ${pass}/${results.length}`);
    process.exit(pass === results.length ? 0 : 1);
  }

  if (MODE === "buy") {
    const t = await token(P);
    const state = async () => { const s = (await api(t, "/api/game/state")).json ?? {}; return { credits: s.credits as number, unopened: (s.unopenedPacks ?? {}) as Record<string, number> }; };
    const results: any[] = [];
    const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`); };
    const PACK = "estandar";
    const price = getPack(PACK)!.price;
    const s0 = await state();
    const c = await openBrowser(P, 1440, { label: "f724-buy" });
    const log: any = { persona: P, pack: PACK, price, initial: s0 };
    try {
      await loginUi(c, P);
      await openStore(c);
      c.tab.takeErrors();
      // 1 · abrir y CANCELAR.
      const opened = await openProduct(c, "^Comprar Sobre Bronce$");
      const m1 = await modalInfo(c);
      await c.tab.shot(join(SHOTS, "compra-1-detalle.png"));
      log.detail = m1;
      check("abrir COMPRAR = detalle con precio, probabilidades, saldo y saldo después (sin cobrar)", opened && !!m1 && m1.odds.length > 0 && !!m1.balance && !!m1.after, `${m1?.balance} → ${m1?.after} · ${m1?.odds.length} filas`);
      await c.tab.js(`[...document.querySelectorAll('[data-testid="store-purchase-modal"] button')].find(b => /^Cancelar$/i.test((b.innerText||'').trim()))?.click()`);
      await sleep(1500);
      const s1 = await state();
      await c.tab.shot(join(SHOTS, "compra-2-cancelado.png"));
      check("CANCELAR: saldo e inventario intactos", s1.credits === s0.credits && (s1.unopened[PACK] ?? 0) === (s0.unopened[PACK] ?? 0), `${s0.credits} → ${s1.credits}`);
      // 2 · reabrir y CONFIRMAR con doble clic + Enter repetido (un gesto).
      await openProduct(c, "^Comprar Sobre Bronce$");
      await c.tab.shot(join(SHOTS, "compra-3-confirmacion.png"));
      const fired = await c.tab.js<number>(`(() => { const b = [...document.querySelectorAll('[data-testid="store-purchase-modal"] button')].find(x => /^Confirmar compra/i.test((x.innerText||'').trim()) && !x.disabled); if (!b) return 0;
        b.click(); b.click(); b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); b.focus();
        for (let i = 0; i < 3; i++) { b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); b.click(); } return 1; })()`);
      await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
      await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await waitFor(c.tab, `/añadido a tu inventario/i.test(document.querySelector('[data-testid="store-purchase-modal"]')?.innerText || '')`, 20000);
      await sleep(2500);
      await c.tab.shot(join(SHOTS, "compra-4-completada.png"));
      const s2 = await state();
      log.afterBuy = s2;
      check("CONFIRMAR (2 clics + dblclick + Enter ×4): EXACTAMENTE un cargo", fired === 1 && s2.credits === s0.credits - price, `${s0.credits} − ${price} = ${s0.credits - price}; real ${s2.credits}`);
      check("inventario +1 sobre", (s2.unopened[PACK] ?? 0) === (s0.unopened[PACK] ?? 0) + 1, `${s0.unopened[PACK] ?? 0} → ${s2.unopened[PACK] ?? 0}`);
      const doneTxt = (await modalInfo(c))?.text ?? "";
      check("el modal enseña el saldo nuevo del servidor", doneTxt.includes(formatCredits(s2.credits)), doneTxt.slice(0, 160));
      await closeModal(c);
      // 3 · refresh: persiste en servidor y en la página.
      await c.tab.send("Page.reload", {}); await sleep(4000);
      await waitFor(c.tab, `!!document.querySelector('#sobres article')`, 20000);
      const s3 = await state();
      const pageHas = await c.tab.js<boolean>(`document.body.innerText.includes(${JSON.stringify(formatCredits(s3.credits))})`);
      const ownedChip = await c.tab.js<string>(`[...document.querySelectorAll('#sobres article')].find(a => /Sobre Bronce/i.test(a.innerText))?.innerText ?? ''`);
      await c.tab.shot(join(SHOTS, "compra-5-tras-recargar.png"));
      log.afterReload = s3;
      check("recargar: saldo e inventario persisten (API y página)", s3.credits === s2.credits && (s3.unopened[PACK] ?? 0) === (s2.unopened[PACK] ?? 0) && pageHas && /sin abrir/i.test(ownedChip), `credits=${s3.credits} · tarjeta «${ownedChip.replace(/\s+/g, " ")}»`);
      const errs = c.tab.takeErrors();
      check("0 errores de consola", errs.length === 0, errs[0] ?? "");
    } finally { await c.browser.close(); }
    const pass = results.filter((r) => r.ok).length;
    writeFileSync(join(OUT, "purchase.json"), JSON.stringify({ at: new Date().toISOString(), ...log, pass, total: results.length, results }, null, 2) + "\n");
    console.log(`f72.4 buy: ${pass}/${results.length}`);
    process.exit(pass === results.length ? 0 : 1);
  }
})();
