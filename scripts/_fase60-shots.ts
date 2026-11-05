/**
 * F60 · QA VISUAL DEL CMS a 1440 / 1024 / 390 (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 * Patrón de `_fase58-shots.ts`: fixtures REALES de los handlers GET (lecturas contra la BD con credenciales de servidor;
 * no escribe nada) + sesión admin ficticia sólo en un perfil temporal de Chrome headless. Las fichas de BORRADOR
 * (agente, sobre) y la biblioteca de assets son SINTÉTICAS y se marcan así en el informe: la QA de producción los
 * creó y los borró sin dejar residuos, así que en la BD no queda nada que fotografiar. Las imágenes sintéticas apuntan a
 * ficheros reales de `public/` para que se vea el render de verdad.
 *
 *   npx tsx scripts/_fase60-shots.ts [base]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { launch, sleep } from "./lib/cdp";

const BASE = process.argv[2] ?? "http://localhost:3005";
const ADMIN_ID = "2f86cbe8-f663-40fb-a87c-4896b9a45b62";
const OUT = join(process.cwd(), "docs/product/qa/fase60-admin-cms");
mkdirSync(join(OUT, "screenshots"), { recursive: true });

async function fixtures(): Promise<{ fx: Record<string, unknown>; synthetic: string[]; seedCard: string }> {
  const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
  const h = await import("@/server/admin/handlers");
  const c = await import("@/server/cms/handlers");
  const { listCards } = await import("@/server/services/adminCards");
  const deps = { verify: async () => ({ userId: ADMIN_ID }), db: getSupabaseAdmin };
  const call = async (fn: (r: Request) => Promise<Response>, path: string) => (await fn(new Request(`http://x${path}`))).json();
  const sb = getSupabaseAdmin()!;
  const cards = await listCards(sb, { sort: "ovr" as never, dir: "desc", page: 1, pageSize: 50 });
  const seedCard = cards.ok ? cards.data.rows[0].cardId : "leaf__champions-s";
  const now = new Date().toISOString();
  const art = (path: string, w: number, hh: number) => ({ id: "00000000-0000-4000-8000-00000000a0f6", url: path, runtimeUrl: path, smallUrl: path, width: w, height: hh, alpha: true, checksum: "synthetic" });
  const synthAgent = {
    agent: { id: "tejoqa", name: "QA Tejo (sintético)", role: "initiator", code: "TQA", abilities: [{ slot: "C", name: "Guided Salvo" }, { slot: "Q", name: "Special Delivery" }, { slot: "E", name: "Stealth Drone" }, { slot: "X", name: "Armageddon" }],
      lifecycle: "DRAFT", origin: "admin", faceAssetId: "a", fullAssetId: "b", version: 3, createdAt: now, updatedAt: now, publishedAt: null, retiredAt: null },
    face: art("/agents/tejo/face.webp", 250, 250), full: art("/agents/tejo/full.webp", 352, 540),
    references: { mapPlayerStats: 0, playerStats: 0, compositions: 0, strats: 0 },
    checklist: [{ key: "name", label: "Nombre", ok: true }, { key: "role", label: "Rol", ok: true }, { key: "code", label: "Código de ficha", ok: true }, { key: "abilities", label: "Cuatro habilidades C/Q/E/X", ok: true }, { key: "face", label: "Cara (retrato)", ok: true }, { key: "full", label: "Cuerpo entero", ok: true }],
    inSnapshot: false, history: [],
  };
  const baseCards = cards.ok ? cards.data.rows.filter((r) => r.variantId === "base").slice(0, 12).map((r) => ({ cardId: r.cardId, weight: 1, mode: "INCLUDE" })) : [];
  const synthPack = {
    pack: { id: "cms-qa-demo", name: "Sobre QA (sintético)", description: "Ejemplo de sobre del panel: economía de Bronce, pool propio.", template_pack_id: "estandar", price: 1000, card_count: 5, art_asset_id: "x", accent: null, lifecycle: "DRAFT",
      available_from: null, available_to: null, sim_summary: null, version: 2, created_at: now, updated_at: now, published_at: null, retired_at: null },
    template: { id: "estandar", name: "Sobre Bronce", price: 1000, cardCount: 5, drawMode: "clase" },
    art: { id: "x", url: "/packs/pack-estandar.webp", runtimeUrl: "/packs/pack-estandar.webp" },
    pool: { id: "pack-cms-qa-demo", exists: true, lifecycle: "DRAFT", mode: "EXPLICIT", revision: 3, entries: baseCards, bound: true },
    references: { inventories: 0, inventoryUnits: 0, purchases: 0, opens: 0, poolBindings: 1 },
    gate: { ok: false, blockers: ["Falta la simulación"], warnings: [] }, band: { lo: 0.86, hi: 1.1, median: 0.98 }, history: [],
  };
  const synthAssets = {
    rows: [
      { ...art("/agents/jett/face.webp", 256, 256), kind: "agent_face", name: "jett-face.png", format: "png", bytes: 30000, status: "approved", version: 1, isCurrent: true, createdAt: now, usage: [{ type: "agent", id: "jett" }], orphan: false },
      { ...art("/agents/jett/full.webp", 352, 470), id: "00000000-0000-4000-8000-00000000a0f7", kind: "agent_full", name: "jett-full.png", format: "png", bytes: 60000, status: "approved", version: 1, isCurrent: true, createdAt: now, usage: [{ type: "agent", id: "jett" }], orphan: false },
      { ...art("/packs/pack-oro.webp", 780, 1140), id: "00000000-0000-4000-8000-00000000a0f8", kind: "pack_art", name: "sobre-oro.png", format: "png", bytes: 200000, status: "approved", version: 2, isCurrent: true, createdAt: now, usage: [], orphan: true },
    ], total: 3, page: 1, pageSize: 24, kinds: [], orphans: 1,
  };
  const fx: Record<string, unknown> = {
    "/api/admin/dashboard": await call(h.dashboardHandlers(deps).GET, "/api/admin/dashboard"),
    "/api/admin/system": await call(h.systemHandlers(deps).GET, "/api/admin/system"),
    "/api/admin/packs": await call(h.packsHandlers(deps).GET, "/api/admin/packs"),
    "/api/admin/catalog#players": await call(h.catalogHandlers(deps).GET, "/api/admin/catalog?view=players&page=1&pageSize=50"),
    "/api/admin/catalog#teams": await call(h.catalogHandlers(deps).GET, "/api/admin/catalog?view=teams"),
    "/api/admin/events": await call(h.eventsHandlers(deps).GET, "/api/admin/events"),
    "/api/admin/cards": cards.ok ? cards.data : { rows: [], total: 0, page: 1, pageSize: 50 },
    "/api/admin/cms/health": await call(c.contentHealthHandlers(deps).GET, "/api/admin/cms/health"),
    "/api/admin/cms/agents": await call(c.agentsCmsHandlers(deps).GET, "/api/admin/cms/agents"),
    "/api/admin/cms/agents#jett": await call(c.agentsCmsHandlers(deps).GET, "/api/admin/cms/agents?id=jett"),
    "/api/admin/cms/agents#tejoqa": synthAgent,
    "/api/admin/cms/packs": await call(c.packsCmsHandlers(deps).GET, "/api/admin/cms/packs"),
    "/api/admin/cms/packs#cms-qa-demo": synthPack,
    "/api/admin/cms/cards": await call(c.cardsCmsHandlers(deps).GET, "/api/admin/cms/cards"),
    [`/api/admin/cms/cards#${seedCard}`]: await call(c.cardsCmsHandlers(deps).GET, `/api/admin/cms/cards?id=${seedCard}`),
    "/api/admin/cms/assets": synthAssets,
    "/api/admin/cms/maps": await call(c.mapsCmsHandlers(deps).GET, "/api/admin/cms/maps"),
  };
  return { fx, synthetic: ["/api/admin/cms/agents#tejoqa", "/api/admin/cms/packs#cms-qa-demo", "/api/admin/cms/assets"], seedCard };
}

(async () => {
  const { fx, synthetic, seedCard } = await fixtures();
  const ROUTES = ["/admin", "/admin/content", "/admin/agents", "/admin/agents/new", "/admin/agents/tejoqa", "/admin/agents/jett", "/admin/cards", "/admin/cards/new",
    `/admin/cards/${encodeURIComponent(seedCard)}`, "/admin/players", "/admin/players/new", "/admin/teams", "/admin/packs", "/admin/packs/new", "/admin/packs/cms-qa-demo",
    "/admin/events", "/admin/assets", "/admin/maps", "/admin/system"];
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
  for (const [W, H] of [[1440, 900], [1024, 800], [390, 844]] as const) {
    const b = await launch({ width: W, height: H, args: ["--in-process-gpu", "--mute-audio"] });
    try {
      await b.tab.resize(W, H, 1);
      await b.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: inject });
      for (const r of ROUTES) {
        b.tab.takeErrors();
        await b.tab.goto(`${BASE}${r}`, 3500);
        await sleep(2600);
        const name = (decodeURIComponent(r).replace(/^\/admin\/?/, "") || "dashboard").replace(/\//g, "_").replace(seedCard, "seed-card");
        await b.tab.shot(join(OUT, "screenshots", `${name}-${W}.png`));
        const m = await b.tab.js<{ overflowX: number; wide: string[]; h1: string; denied: boolean; noFixture: boolean; brokenImgs: number }>(`(() => {
          const vw = window.innerWidth;
          const wide = [...document.querySelectorAll("#admin-main *")].filter((el) => { const x = el.getBoundingClientRect(); return x.width > 0 && x.right > vw + 1 && !el.closest(".overflow-x-auto") && getComputedStyle(el).position !== "fixed"; }).map((el) => (el.className || el.tagName).toString().slice(0, 60)).slice(0, 5);
          const t = document.body.innerText;
          const brokenImgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src")).length;
          return { overflowX: document.documentElement.scrollWidth - vw, wide, h1: (document.querySelector("h1")?.textContent || "").slice(0, 40), denied: /Acceso restringido/.test(t), noFixture: /sin fixture/.test(t), brokenImgs };
        })()`);
        report.push({ width: W, route: r, synthetic: synthetic.some((k) => k.endsWith(r.split("/").pop() ?? "#")) || r === "/admin/assets", ...m, consoleErrors: b.tab.takeErrors().slice(0, 5) });
      }
    } finally { await b.close(); }
  }
  writeFileSync(join(OUT, "visual-qa.json"), JSON.stringify({ note: "fixtures reales de lectura; borradores y biblioteca de assets SINTÉTICOS (marcados)", report }, null, 1));
  const bad = report.filter((x) => (x.overflowX as number) > 0 || (x.wide as string[]).length || x.denied || x.noFixture || !(x.h1 as string) || (x.brokenImgs as number) > 0);
  console.log(`${report.length} capturas · con incidencias: ${bad.length}`);
  console.log(JSON.stringify(bad.map((x) => ({ w: x.width, r: x.route, o: x.overflowX, wide: x.wide, h1: x.h1, nf: x.noFixture, bi: x.brokenImgs, err: x.consoleErrors })), null, 1).slice(0, 5000));
})();
