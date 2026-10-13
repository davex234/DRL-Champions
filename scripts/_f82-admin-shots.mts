/**
 * F82 · CAPTURAS DEL PANEL /admin/collection-sets en PRODUCCIÓN sin cuenta admin (instrumento, fuera de CI).
 *
 * Mismo método que F58: navegador headless con una cuenta QA y CDP Fetch que responde SOLO a `/api/admin/session` y a
 * `/api/admin/cms/collection-sets` con datos REALES de la BD (las 25 filas exportadas por SSH a `allsets.json`, los
 * usuarios que ya cumplen cada set en `estimates.json`) y el generador/validador reales sobre el catálogo vivo. Ninguna
 * petición de admin llega al servidor: no se escribe nada (un POST distinto de `preview` se responde 418 y se cuenta).
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f82-admin-shots.mts   (cwd = prodqa)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { fromRow } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/src/server/services/collectionSets.ts");
const { generateTeamDrafts, generateEditionDrafts, liveContext } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/src/domain/collectionSets/generator.ts");
const { validateForPublish } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/src/domain/collectionSets/validate.ts");
const { canonicalCardTeam } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/src/data/teamIdentities.ts");
const { readFileSync, mkdirSync } = await import("node:fs");
const { openBrowser, loginUi, sleep, waitFor } = lib;
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f82-collection-sets/prod/shots";
mkdirSync(OUT, { recursive: true });

const rows = JSON.parse(readFileSync("allsets.json", "utf8"));
const est = JSON.parse(readFileSync("estimates.json", "utf8"));
const done: Record<string, number> = { "team-eternal-fire-v1": 1 }; // compleciones reales tras la QA de K
const sets = rows.map((r: any) => ({ ...fromRow(r), completions: done[r.id] ?? 0 }));
const ctx = liveContext();
const families = new Set(sets.map((s: any) => s.family));
const list = { sets, proposals: [...generateTeamDrafts(ctx), ...generateEditionDrafts(ctx)].map((result: any) => ({ result, exists: !("skip" in result) && families.has(result.family) })) };
const byId = new Map(ctx.cards.map((c: any) => [c.id, c]));
const preview = (id: string) => {
  const set = sets.find((s: any) => s.id === id);
  const issues = validateForPublish({ ...set, status: "DRAFT" }, ctx).filter((i: any) => i.code !== "NOT_DRAFT" || set.status === "DRAFT");
  const requirements = set.requirements.map((r: any) => ({ ...r, cards: r.cardIds.map((cid: string) => { const c: any = byId.get(cid); return { id: cid, ovr: c?.ovr ?? 0, variantId: c?.variantId ?? "?", team: c ? canonicalCardTeam(c, ctx.player(c.playerId)).label : "?", obtainable: c ? ctx.obtainable(c) : false }; }) }));
  return { set, issues, players: new Set(set.requirements.map((r: any) => r.playerId)).size, requirements, estimatedCompleters: est[id] ?? 0 };
};

const H = [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }];
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
let blockedWrites = 0;
const c = await openBrowser("K", 1440, { label: "f82-admin" });
try {
  console.log("login", await loginUi(c, "K"));
  // `/api/game/me` (la marca is_admin del perfil propio, F69) se deja llegar al servidor y SOLO se retoca la respuesta en
  // el navegador: la precomprobación de useAdminSession no molesta al servidor si la marca es false.
  await c.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/admin/*" }, { urlPattern: "*/api/game/me", requestStage: "Response" }] });
  c.tab.on("Fetch.requestPaused", async (p: any) => {
    const url: string = p.request.url;
    const reply = (code: number, body: unknown) => c.tab.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: code, responseHeaders: H, body: b64(body) }).catch(() => null);
    if (/\/api\/game\/me$/.test(url) && p.responseStatusCode !== undefined) {
      const raw = await c.tab.send("Fetch.getResponseBody", { requestId: p.requestId }).catch(() => null) as any;
      try {
        const j = JSON.parse(raw?.base64Encoded ? Buffer.from(raw.body, "base64").toString("utf8") : raw?.body ?? "{}");
        if (j?.profile) j.profile.is_admin = true;
        return reply(p.responseStatusCode, j);
      } catch { return c.tab.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => null); }
    }
    if (url.endsWith("/api/admin/session")) return reply(200, { admin: true });
    if (url.includes("/api/admin/cms/collection-sets")) {
      if (p.request.method === "GET") return reply(200, list);
      const body = JSON.parse(p.request.postData ?? "{}");
      if (body.action === "preview") return reply(200, preview(body.id));
      blockedWrites++;
      return reply(418, { error: "QA: escritura bloqueada en el arnés" });
    }
    return reply(404, { error: "QA" });
  });
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) {
    await c.tab.resize(w, h, 1);
    await c.tab.goto(`${BASE}/admin/collection-sets`, 3000);
    console.log(w, "lista", await waitFor(c.tab, `!!document.querySelector('[data-testid="admin-set-list"]')`, 20000));
    await sleep(800);
    await c.tab.shot(`${OUT}/admin-list-${w}.png`);
    for (const id of ["team-100t-v1", "team-g2-v1"]) {
      await c.tab.js(`document.querySelector('[data-testid="admin-set-list"] [data-set="${id}"]')?.click()`);
      console.log(w, id, await waitFor(c.tab, `!!document.querySelector('[data-testid="admin-requirements"]')`, 15000));
      await sleep(900);
      const facts = await c.tab.js(`({ ok: !!document.querySelector('[data-testid="publish-ok"]'), issues: document.querySelector('[data-testid="publish-issues"]')?.innerText ?? null, est: document.querySelector('[data-testid="estimated"]')?.innerText, publish: !!document.querySelector('[data-testid="publish"]'), ox: document.documentElement.scrollWidth - window.innerWidth })`);
      console.log(w, id, JSON.stringify(facts));
      await c.tab.shot(`${OUT}/admin-${id}-${w}.png`);
    }
    if (w === 1440) {
      await c.tab.js(`[...document.querySelectorAll('button')].find(b => /Generador/i.test(b.innerText))?.click()`);
      console.log("generador", await waitFor(c.tab, `!!document.querySelector('[data-testid="generator-table"]')`, 10000));
      await sleep(700);
      await c.tab.shot(`${OUT}/admin-generator-1440.png`);
    }
  }
  console.log("escrituras bloqueadas", blockedWrites);
} finally { await c.browser.close().catch(() => null); }
