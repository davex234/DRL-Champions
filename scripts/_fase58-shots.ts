/**
 * F58 · QA VISUAL DEL CONTROL CENTER A 1440 / 1024 / 768 (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 * 1. FIXTURES REALES: llama a los handlers de `/api/admin/*` DIRECTAMENTE (lecturas GET) contra la BD con las
 *    credenciales de servidor de `.env.local`, como admin `ADMIN_ID`. No escribe nada.
 * 2. HEADLESS con perfil temporal: un script inyectado antes de la app responde a `/api/admin/*`, `/rest/v1/profiles` y
 *    `/auth/v1/*` con esos fixtures (la sesión es ficticia y solo vive en ese perfil temporal). Captura cada ruta a tres
 *    anchos y mide el desbordamiento horizontal y los errores de consola.
 *
 *   npx tsx scripts/_fase58-shots.ts [base]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { launch, sleep } from "./lib/cdp";

const BASE = process.argv[2] ?? "http://localhost:3005";
const ADMIN_ID = "2f86cbe8-f663-40fb-a87c-4896b9a45b62";
const QA_USER = "8c326e52-776a-43f4-ba05-3ad7945c40c3";
const OUT = join(process.cwd(), "docs/product/qa/fase58-admin");
mkdirSync(join(OUT, "screenshots"), { recursive: true });

async function fixtures(): Promise<Record<string, unknown>> {
  const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
  const h = await import("@/server/admin/handlers");
  const { listCards } = await import("@/server/services/adminCards");
  const deps = { verify: async () => ({ userId: ADMIN_ID }), db: getSupabaseAdmin };
  const call = async (fn: (r: Request) => Promise<Response>, path: string) => (await fn(new Request(`http://x${path}`))).json();
  const sb = getSupabaseAdmin()!;
  const cards = await listCards(sb, { sort: "ovr" as never, dir: "desc", page: 1, pageSize: 50 });
  return {
    "/api/admin/dashboard": await call(h.dashboardHandlers(deps).GET, "/api/admin/dashboard"),
    "/api/admin/system": await call(h.systemHandlers(deps).GET, "/api/admin/system"),
    "/api/admin/users": await call(h.usersHandlers(deps).GET, "/api/admin/users?q=&page=1&pageSize=25"),
    [`/api/admin/users#${QA_USER}`]: await call(h.usersHandlers(deps).GET, `/api/admin/users?id=${QA_USER}`),
    "/api/admin/moderation": await call(h.moderationHandlers(deps).GET, "/api/admin/moderation?status=ACTIVE"),
    "/api/admin/events": await call(h.eventsHandlers(deps).GET, "/api/admin/events"),
    "/api/admin/packs": await call(h.packsHandlers(deps).GET, "/api/admin/packs"),
    "/api/admin/packs#estandar": await call(h.packsHandlers(deps).GET, "/api/admin/packs?id=estandar"),
    "/api/admin/packs#economy": await call(h.packsHandlers(deps).GET, "/api/admin/packs?view=economy"),
    "/api/admin/catalog#players": await call(h.catalogHandlers(deps).GET, "/api/admin/catalog?view=players&page=1&pageSize=50"),
    "/api/admin/catalog#teams": await call(h.catalogHandlers(deps).GET, "/api/admin/catalog?view=teams"),
    "/api/admin/catalog#seasons": await call(h.catalogHandlers(deps).GET, "/api/admin/catalog?view=seasons"),
    "/api/admin/catalog#competitive": await call(h.catalogHandlers(deps).GET, "/api/admin/catalog?view=competitive"),
    "/api/admin/catalog#rewards": await call(h.catalogHandlers(deps).GET, "/api/admin/catalog?view=rewards"),
    "/api/admin/audit": await call(h.auditHandlers(deps).GET, "/api/admin/audit?page=1&pageSize=50"),
    "/api/admin/cards": cards.ok ? cards.data : { rows: [], total: 0, page: 1, pageSize: 50 },
  };
}

const ROUTES = ["/admin", "/admin/cards", "/admin/players", "/admin/teams", "/admin/packs", "/admin/packs/estandar", "/admin/events", "/admin/events/new",
  "/admin/users", `/admin/users/${QA_USER}`, "/admin/moderation", "/admin/economy", "/admin/seasons", "/admin/competitive", "/admin/rewards", "/admin/audit", "/admin/system"];

(async () => {
  const fx = await fixtures();
  const inject = `(() => {
    const FX = ${JSON.stringify(fx)};
    const session = { access_token: "qa-fixture", refresh_token: "qa-fixture", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user: { id: "${ADMIN_ID}", email: "admin@fixture.local", aud: "authenticated", role: "authenticated" } };
    try { localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); } catch {}
    const json = (b, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } }));
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      const p = url.pathname, q = url.searchParams;
      if (p === "/api/admin/session") return json({ admin: true, userId: "${ADMIN_ID}" });
      if (p.startsWith("/rest/v1/profiles")) return json([{ is_admin: true }]);
      if (p.startsWith("/auth/v1/user")) return json(session.user);
      if (p.startsWith("/api/admin/")) {
        const view = q.get("view"), id = q.get("id");
        const key = p === "/api/admin/cards" ? p : view ? p + "#" + view : id ? p + "#" + id : p;
        if (FX[key]) return json(FX[key]);
        if (p === "/api/admin/search") return json({ hits: [] });
        return json({ error: "sin fixture: " + key }, 404);
      }
      return real(input, init);
    };
  })();`;
  const report: Record<string, unknown>[] = [];
  for (const W of [1440, 1024, 768]) {
    const b = await launch({ width: W, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    try {
      await b.tab.resize(W, 900, 1);
      await b.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: inject });
      for (const r of ROUTES) {
        b.tab.takeErrors();
        await b.tab.goto(`${BASE}${r}`, 3500);
        await sleep(2500);
        const name = (r.replace(/^\/admin\/?/, "") || "dashboard").replace(/\//g, "_").replace(QA_USER, "qa-user");
        await b.tab.shot(join(OUT, "screenshots", `${name}-${W}.png`));
        const m = await b.tab.js<{ overflowX: number; wide: string[]; h1: string; denied: boolean; noFixture: boolean }>(`(() => {
          const vw = window.innerWidth;
          const wide = [...document.querySelectorAll("#admin-main *")].filter((el) => { const x = el.getBoundingClientRect(); return x.width > 0 && x.right > vw + 1 && !el.closest(".overflow-x-auto") && getComputedStyle(el).position !== "fixed"; }).map((el) => (el.className || el.tagName).toString().slice(0, 60)).slice(0, 5);
          const t = document.body.innerText;
          return { overflowX: document.documentElement.scrollWidth - vw, wide, h1: (document.querySelector("h1")?.textContent || "").slice(0, 40), denied: /Acceso restringido/.test(t), noFixture: /sin fixture/.test(t) };
        })()`);
        report.push({ width: W, route: r, ...m, consoleErrors: b.tab.takeErrors().slice(0, 5) });
      }
    } finally { await b.close(); }
  }
  writeFileSync(join(OUT, "visual-qa.json"), JSON.stringify(report, null, 1));
  const bad = report.filter((x) => (x.overflowX as number) > 0 || (x.wide as string[]).length || x.denied || x.noFixture || !(x.h1 as string) || (x.consoleErrors as string[]).length);
  console.log(`${report.length} capturas · con incidencias: ${bad.length}`);
  console.log(JSON.stringify(bad, null, 1).slice(0, 6000));
})();
