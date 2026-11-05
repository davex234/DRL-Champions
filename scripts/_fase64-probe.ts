/**
 * FASE 64 · SONDA de una pantalla (instrumento `_`): qué peticiones hace, cuáles fallan y qué texto «técnico» enseña.
 *   npx tsx scripts/_fase64-probe.ts <credsFile> /ruta [/ruta…]
 */
import { readFileSync } from "node:fs";
import { launch, sleep } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const [credsFile, ...paths] = process.argv.slice(2);
const esc = (s: string) => JSON.stringify(s);

async function main() {
  const c = JSON.parse(readFileSync(credsFile, "utf8"));
  const b = await launch({ args: ["--mute-audio"] });
  try {
    if (process.env.W) await b.tab.resize(Number(process.env.W), 844, 1);
    await b.tab.goto(`${BASE}/cuenta`, 3000);
    await b.tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    await sleep(4000);
    for (const p of paths) {
      await sleep(2500);
      b.tab.takeErrors();
      await b.tab.goto(`${BASE}${p}`, 5000);
      const r = await b.tab.js<any>(`(() => {
        const res = performance.getEntriesByType('resource').filter(e => /\\/api\\/|supabase|:54521|rest\\/v1/.test(e.name)).map(e => e.name.replace(location.origin, '').replace(/https?:\\/\\/[^/]+/, '').slice(0, 110));
        const counts = {}; for (const n of res) { const k = n.split('?')[0]; counts[k] = (counts[k] || 0) + 1; }
        const text = (document.querySelector('main') || document.body).innerText;
        const m = text.match(/.{0,60}(failed to fetch|networkerror|internal server error|typeerror|pgrst|supabase|undefined).{0,60}/i);
        const failed = performance.getEntriesByType('resource').filter(e => (e.responseStatus || 0) >= 400).map(e => e.responseStatus + ' ' + e.name.replace(location.origin, '').slice(0, 140));
        const W = innerWidth; const over = [];
        for (const e of document.querySelectorAll('body *')) { const b = e.getBoundingClientRect(); if (b.width && b.height && (b.right > W + 1 || b.left < -1)) { let skip = false; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible') { const r = a.getBoundingClientRect(); if (r.left >= -1 && r.right <= W + 1) { skip = true; break; } } } if (!skip && over.length < 8) over.push(e.tagName + '.' + String(e.className).slice(0, 90) + ' ' + Math.round(b.left) + '..' + Math.round(b.right) + ' parent=' + String(e.parentElement?.className).slice(0, 80)); } }
        return { counts, tech: m ? m[0] : null, failed, over };
      })()`);
      console.log(`\n== ${p}`);
      console.log(JSON.stringify(r.counts, null, 1));
      if (r.tech) console.log("TECH:", r.tech);
      if (r.failed?.length) console.log("FAILED:", r.failed.join(" | "));
      if (r.over?.length) console.log("OVER:" + String.fromCharCode(10) + "  " + r.over.join(String.fromCharCode(10) + "  "));
      const errs = b.tab.takeErrors();
      if (errs.length) console.log("ERR:", errs.slice(0, 6).join(" | "));
    }
  } finally { await b.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
