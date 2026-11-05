/**
 * QA · I18N — sonda puntual de la tarjeta de sobre del catálogo (`/packs`) a 390 px (instrumento, fuera de CI).
 * Mide, por idioma, si la fila precio + CTA cabe dentro de la tarjeta y guarda una captura de la tarjeta ICON Premium.
 * Sin sesión: solo lee. Solo contra el stack de QA aislado (lo impone `_i18n-auth-lib`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { goto, open, sleep, LOCALES } from "./_i18n-auth-lib";

const OUT = join("docs", "product", "qa", "i18n-visual", "_packcard");
const WIDTHS = (process.argv[2] ?? "390").split(",").map(Number);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const rows: unknown[] = [];
  for (const width of WIDTHS) for (const locale of LOCALES) {
    const c = await open(width);
    try {
      await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem('vr.locale', JSON.stringify({ locale: ${JSON.stringify(locale)}, at: 1 })); } catch {}` });
      await goto(c, "/packs", 2500);
      const m = await c.tab.js<unknown>(`(() => {
        const out = [];
        for (const a of document.querySelectorAll('a[href^="/packs/"]')) {
          const r = a.getBoundingClientRect(); if (!r.width) continue;
          const row = a.querySelector('div.mt-auto'); if (!row) continue;
          const kids = [...row.children].map((k) => { const kr = k.getBoundingClientRect(); return { text: k.textContent.trim(), left: Math.round(kr.left - r.left), right: Math.round(r.right - kr.right), w: Math.round(kr.width), h: Math.round(kr.height) }; });
          out.push({ href: a.getAttribute('href'), cardW: Math.round(r.width), rowH: Math.round(row.getBoundingClientRect().height), fuera: kids.some((k) => k.right < -3 || k.left < -3), kids });
        }
        return out;
      })()`);
      await c.tab.js(`document.querySelector('a[href="/packs/icon"]')?.scrollIntoView({ block: 'center' })`);
      await sleep(700);
      await c.tab.shot(join(OUT, `${width}-${locale}.png`)).catch(() => null);
      rows.push({ locale, width, lang: await c.tab.js<string>("document.documentElement.lang"), cards: m });
      const list = (m as { href: string; fuera: boolean; rowH: number }[]) ?? [];
      console.log(`${locale} ${width} · tarjetas ${list.length} · fuera ${list.filter((x) => x.fuera).map((x) => x.href).join(",") || "ninguna"} · altos de fila ${[...new Set(list.map((x) => x.rowH))].join("/")}`);
    } finally { await c.browser.close(); }
  }
  mkdirSync(join("logs", "i18n", "rc"), { recursive: true });
  writeFileSync(join("logs", "i18n", "rc", `packcard-probe${process.env.I18N_TAG ? `-${process.env.I18N_TAG}` : ""}.json`), JSON.stringify(rows, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
