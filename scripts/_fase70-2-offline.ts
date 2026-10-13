// F70.2 · con el service worker cargado, :3005 cae unos segundos (lo mata el operador) → el navegador debe enseñar
// la página offline y NO otra ruta; al volver, recargar → la página normal. Fuera de CI.
//   npx tsx scripts/_fase70-2-offline.ts <perfil-dir>
import { writeFileSync } from "node:fs";
import { launch } from "./lib/cdp";

const BASE = "http://127.0.0.1:3005";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const info = `({ url: location.pathname, offline: !!document.querySelector('[data-offline]'), head: [...document.querySelectorAll('h1,h2')].map(e => e.innerText.trim()).join(' | ').slice(0, 80), sw: !!navigator.serviceWorker?.controller })`;
(async () => {
  const b = await launch({ userDataDir: process.argv[2] });
  const t = b.tab;
  await t.goto(`${BASE}/coleccion`, 3000); await sleep(1500);
  const before = await t.js(info);
  console.log("READY_FOR_KILL", JSON.stringify(before));
  // Espera a que el servidor caiga (lo mata el operador) y navega a rutas mientras está caído.
  for (let i = 0; i < 60; i++) { const ok = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false); if (!ok) break; await sleep(250); }
  const during: unknown[] = [];
  for (const r of ["/temporada", "/tienda/creditos", "/jugador/x"]) { await t.goto(`${BASE}${r}`, 1500).catch(() => null); during.push(await t.js(info)); }
  console.log("DURING", JSON.stringify(during));
  let upAt = 0; for (let i = 0; i < 120; i++) { if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) { upAt = i; break; } await sleep(500); }
  await t.js("location.reload()").catch(() => null); await sleep(4000);
  const after = await t.js(info);
  console.log("AFTER", JSON.stringify(after));
  const ok = (during as { offline: boolean }[]).every((d) => d.offline) && !(after as { offline: boolean }).offline;
  writeFileSync("docs/product/qa/fase70-1/runtime-offline.json", JSON.stringify({ before, during, afterReload: after, recoveredAfterPolls: upAt, ok }, null, 2) + "\n");
  console.log(ok ? "OFFLINE_TEST PASS" : "OFFLINE_TEST FAIL");
  await b.close(); process.exit(ok ? 0 : 1);
})();
