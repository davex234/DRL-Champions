/**
 * F58.2 · QA del acceso «Administración» (instrumento `_`, fuera de CI, SOLO LECTURA). Chrome headless, perfil temporal.
 *
 * Tres personas: ANÓNIMO (sin sesión), USUARIO (sesión ficticia; el servidor dice «no admin») y ADMIN (sesión ficticia;
 * `/api/admin/session` responde admin). Las respuestas de Supabase/servidor para la sesión se simulan con un `fetch`
 * inyectado SOLO en ese perfil: no toca ninguna cuenta. A 1440 y 390 px:
 *   · muestrea el DOM cada 40 ms durante la carga (¿aparece «Administración» aunque sea un instante?);
 *   · abre el menú real (desplegable «Temporada» / hoja «Menú») y mira si está el acceso;
 *   · ADMIN: pulsa el acceso → /admin, y «Volver al juego» → la pantalla de origen;
 *   · ANÓNIMO/USUARIO: /admin escrito a mano → sin panel.
 *   npx tsx scripts/_fase58-2-entry-qa.ts [base]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.argv[2] ?? "http://localhost:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase58-2-admin-entry");
mkdirSync(OUT, { recursive: true });
const UID = "00000000-0000-4000-8000-0000000f58b2";

const inject = (who: "anon" | "user" | "admin") => `(() => {
  const who = ${JSON.stringify(who)};
  if (who !== "anon") {
    const session = { access_token: "qa-" + who, refresh_token: "qa", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user: { id: "${UID}", email: who + "@fixture.local", aud: "authenticated", role: "authenticated" } };
    try { localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); } catch {}
  }
  window.__adminSeen = 0;
  new MutationObserver(() => { if (document.querySelector('[data-testid="admin-entry"]')) window.__adminSeen++; }).observe(document, { childList: true, subtree: true });
  const json = (b, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } }));
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const p = url.pathname;
    if (p === "/api/admin/session") return who === "admin" ? json({ admin: true, userId: "${UID}" }) : json({ admin: false }, 401);
    if (p.startsWith("/rest/v1/profiles")) return json(who === "admin" ? { is_admin: true } : { is_admin: false });
    if (p === "/api/admin/dashboard" && who === "admin") return json({ stats: null, season: null, activeEvents: null, upcomingEvents: [], alerts: [], recent: [] });
    if (p.startsWith("/api/admin/")) return who === "admin" ? json({ overall: "HEALTHY", environment: "qa", version: "0.1.1", checks: [], flags: [], rows: [], hits: [] }) : json({ error: "No autorizado" }, 401);
    return real(input, init);
  };
})();`;

async function openMenu(tab: Tab, W: number): Promise<boolean> {
  if (W <= 1023) {
    await tab.js(`document.querySelector('[data-testid="shell-menu"]')?.click()`);
  } else {
    // El desplegable de la sección «Temporada» se abre al pasar el ratón por encima.
    const r = await tab.js<{ x: number; y: number } | null>(`(() => { const a = [...document.querySelectorAll('nav[aria-label="Secciones"] a')].find((x) => /temporada/i.test(x.textContent || "")); if (!a) return null; const b = a.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    if (!r) return false;
    await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  }
  await sleep(700);
  return tab.js<boolean>(`!!document.querySelector('[data-testid="admin-entry"]')`);
}

(async () => {
  const report: Record<string, unknown>[] = [];
  for (const W of [1440, 390]) {
    for (const who of ["anon", "user", "admin"] as const) {
      const b = await launch({ width: W, height: W <= 430 ? 844 : 900, args: ["--mute-audio"] });
      try {
        await b.tab.resize(W, W <= 430 ? 844 : 900, 1);
        await b.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: inject(who) });
        await b.tab.goto(`${BASE}/temporada`, 3000);
        await sleep(3500);
        const seenDuringLoad = await b.tab.js<number>("window.__adminSeen");
        const visibleInMenu = await openMenu(b.tab, W);
        await b.tab.shot(join(OUT, `menu-${who}-${W}.png`));
        const row: Record<string, unknown> = { width: W, who, seenDuringLoad, visibleInMenu };
        if (who === "admin" && visibleInMenu) {
          await b.tab.js(`document.querySelector('[data-testid="admin-entry"] a')?.click()`);
          await sleep(4000);
          row.afterClickPath = await b.tab.js<string>("location.pathname");
          row.panelShown = await b.tab.js<boolean>(`!!document.querySelector('[data-shell="admin"]')`);
          await b.tab.shot(join(OUT, `admin-opened-${W}.png`));
          const back = await b.tab.js<string | null>(`(() => { const a = document.querySelector('[data-testid="admin-back-to-game"]') || [...document.querySelectorAll('a')].find((x) => /Volver al juego/.test(x.textContent || "")); if (!a) return null; const h = a.getAttribute("href"); a.click(); return h; })()`);
          await sleep(3500);
          row.backHref = back;
          row.afterBackPath = await b.tab.js<string>("location.pathname");
        }
        if (who !== "admin") {
          await b.tab.goto(`${BASE}/admin`, 3000);
          await sleep(3000);
          row.manualAdmin = await b.tab.js<{ panel: boolean; text: string }>(`({ panel: !!document.querySelector('[data-shell="admin"]'), text: (document.body.innerText.match(/Acceso restringido|Comprobando permisos/i) || [""])[0] })`);
          await b.tab.shot(join(OUT, `manual-admin-${who}-${W}.png`));
        }
        report.push(row);
      } finally { await b.close(); }
    }
  }
  writeFileSync(join(OUT, "entry-qa.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})();
