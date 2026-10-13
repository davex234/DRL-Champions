/*
 * F73 final · comprobación ligera del dominio PÚBLICO (fuera de CI): UN Chrome, cuenta QA L ya existente (no se registra
 * nada), login por el formulario de https://valorosters.com y 6 pantallas. La red solo se OBSERVA.
 *   BASE_URL=https://valorosters.com npx tsx scripts/_f73z-public.ts
 */
import { writeFileSync } from "node:fs";
import { openBrowser, loginUi, goto, sleep } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") { console.error("BASE_URL=https://valorosters.com"); process.exit(2); }
(async () => {
  const c = await openBrowser("L", 1440, { label: "f73z" });
  const net = { hosts: {} as Record<string, number>, localhost: [] as string[], mixed: [] as string[], failed: [] as string[], bad: [] as string[] };
  const urls = new Map<string, string>();
  await c.tab.send("Network.enable", {});
  c.tab.on("Network.requestWillBeSent", (p: any) => { const u = String(p.request?.url ?? ""); urls.set(p.requestId, u); if (!/^https?:/.test(u)) return; const h = new URL(u).host; net.hosts[h] = (net.hosts[h] ?? 0) + 1; if (/^(localhost|127\.|\[::1\])/.test(h)) net.localhost.push(u.slice(0, 100)); if (u.startsWith("http://")) net.mixed.push(u.slice(0, 100)); });
  c.tab.on("Network.loadingFailed", (p: any) => { if (!p.canceled && !/ERR_ABORTED/.test(p.errorText ?? "")) net.failed.push(`${p.errorText} ${(urls.get(p.requestId) ?? "").slice(0, 100)}`); });
  c.tab.on("Network.responseReceived", (p: any) => { const s = p.response?.status ?? 0; if (s >= 400) net.bad.push(`${s} ${String(p.response?.url ?? "").slice(0, 100)}`); });
  const pages: { path: string; ok: boolean; broken: number }[] = [];
  let logged = false;
  try {
    logged = await loginUi(c, "L");
    for (const p of ["/", "/misiones", "/misiones/crafting", "/misiones/crafting/sobres", "/misiones/crafting/cartas", "/coleccion"]) {
      await goto(c, p, 2500); await sleep(1000);
      const i = await c.tab.js<any>(`({ path: location.pathname, broken: [...document.images].filter(x => x.complete && x.naturalWidth === 0 && x.src).length, text: (document.querySelector('main') || document.body).innerText.length, session: !!Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)) })`);
      pages.push({ path: p, ok: i.path === p && i.broken === 0 && i.text > 40 && i.session, broken: i.broken });
    }
  } finally { await c.browser.close(); }
  const errs = c.tab.takeErrors();
  const pass = logged && pages.every((p) => p.ok) && net.localhost.length === 0 && net.mixed.length === 0 && net.failed.length === 0 && net.bad.length === 0 && errs.length === 0;
  const out = { at: new Date().toISOString(), url: BASE, account: "QA L (existente)", logged, pages, hosts: net.hosts, localhost: net.localhost, mixed: net.mixed, failed: net.failed, bad: net.bad, console: errs.slice(0, 5), pass };
  writeFileSync("docs/product/qa/fase73-final/public-browser-final.json", JSON.stringify(out, null, 2));
  console.log(pass ? "PASS" : "FAIL", JSON.stringify({ logged, pages: pages.map((p) => `${p.path}:${p.ok}`), hosts: net.hosts, localhost: net.localhost.length, mixed: net.mixed.length, failed: net.failed.length, bad: net.bad.length, console: errs.length }));
  process.exit(pass ? 0 : 1);
})();
