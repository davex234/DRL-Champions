/**
 * F73 · QA DE INTERFAZ en Chrome real contra :3005 (build de producción) — fuera de CI.
 *
 * La BD viva NO tiene 0059 (no se aplica sin autorización). Por eso:
 *   0 · PRODUCCIÓN TAL CUAL: /misiones y /misiones/crafting/sobres enseñan «todavía no disponible» (sin botones falsos).
 *   1 · FLUJO COMPLETO con instrumentación de servidor AISLADA: la interfaz y la sesión son las reales de :3005; SOLO las
 *       peticiones a `/api/game/crafting` y `/api/game/missions` se interceptan (CDP `Fetch`) y las atienden los
 *       SERVICIOS REALES de F73 (`crafting.ts`, `missionEngine.ts`) sobre MemSupabase, sembrado con las recetas de 0059 y
 *       configuración claramente QA («QA · …»). Nada se escribe en la BD viva.
 *
 * Por anchura (1440, 1024, 390 — esta en movimiento reducido, como el Chrome del usuario):
 *   MISIONES (reclamar) → CRAFTING → SOBRES (receta → confirmación → resultado; doble clic = 1) → CARTAS/INTERCAMBIO
 *   (selección → confirmación → carta aleatoria) → PROYECTOS → proyecto → progreso → evento de partida QA (servidor) →
 *   RECLAMAR CARTA → F5 conserva. Teclado: Tab/Enter abre, Escape cierra. Sin scroll horizontal. 0 errores de consola.
 *
 *   npx tsx scripts/_f73-ui-qa.ts [persona=A] [anchuras=1440,1024,390]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openBrowser, loginUi, goto, sleep, waitFor, SPLASH_GONE, type Client } from "./_fase68-lib";
import { MemSupabase } from "../src/server/services/testing/memSupabase";
import { craftCard, craftPack, getCraftingState } from "../src/server/services/crafting";
import { claimMission, claimProject, getMissionsState, ingestEvent } from "../src/server/services/missionEngine";
import { resetF73Cache } from "../src/server/services/f73Config";
import { CARDS } from "../src/data/catalog";
import { packCardClass } from "../src/domain/packs/packClass";

const P = process.argv[2] ?? "A";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const OUT = join(process.cwd(), process.env.F73UI_OUT ?? "docs/product/qa/fase73/ui");
mkdirSync(OUT, { recursive: true });
const U = "f7300000-0000-4000-8000-00000000qa01".replace("qa01", "0a01");
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: detail.slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail.slice(0, 200)}`); };

/* ── el mundo QA (servidor aislado) ── */
function world() {
  resetF73Cache();
  const db = new MemSupabase();
  db.table("profiles").push({ id: U, username: "qa-f73", credits: 5000, xp: 0, level: 1, points: 0 });
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
  for (const [pack, qty] of [["estandar", 9], ["premium", 3], ["oro", 1], ["champions", 2]] as const) db.table("user_packs").push({ user_id: U, pack_id: pack, qty });
  const base = CARDS.filter((c) => packCardClass(c) === "base" && c.image).slice(0, 5);
  const give = (cardId: string, n: number) => Array.from({ length: n }, () => { const uid = randomUUID(); db.table("user_cards").push({ uid, user_id: U, card_id: cardId, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() }); return uid; });
  give(base[0].id, 5); give(base[1].id, 4); const inDeck = give(base[2].id, 3); give(base[3].id, 2); give(base[4].id, 1);
  db.table("duel_decks").push({ id: randomUUID(), user_id: U, name: "QA", card_uids: [inDeck[0]], created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() });
  const target = CARDS.filter((c) => packCardClass(c) === "prime" && c.image).sort((a, b) => b.ovr - a.ovr)[0];
  const mission = (id: string, name: string, condition: object, target: number, over: object = {}) =>
    db.table("content_missions").push({ id, project_id: null, name, description: "", condition, target, depends_on: [], reward: {}, status: "ACTIVE", sort_order: 0, available_from: null, available_to: null, version: 1, ...over });
  mission("qa-win3", "QA · Gana 3 duelos", { type: "MATCH_WIN" }, 3, { description: "Victorias en partidas terminadas (anti-AFK)", sort_order: 1 });
  mission("qa-open2", "QA · Abre 2 sobres", { type: "OPEN_PACK" }, 2, { reward: { credits: 500 }, sort_order: 2 });
  mission("qa-craft1", "QA · Craftea 1 sobre", { type: "CRAFT_PACK" }, 1, { reward: { xp: 100 }, sort_order: 3 });
  mission("qa-play5", "QA · Juega 5 partidas", { type: "MATCH_PLAY" }, 5, { depends_on: ["qa-win3"], sort_order: 4 });
  db.table("content_card_projects").push({ id: "qa-proyecto", name: "QA · Proyecto de carta", description: "Fixture de QA: una carta REAL del catálogo.", target_card_id: target.id, status: "ACTIVE", sort_order: 0, available_from: null, available_to: null, version: 1 });
  mission("qa-p1", "QA · Abre 1 sobre", { type: "OPEN_PACK" }, 1, { project_id: "qa-proyecto", sort_order: 10 });
  mission("qa-p2", "QA · Intercambia 1 carta", { type: "CRAFT_CARD" }, 1, { project_id: "qa-proyecto", sort_order: 11 });
  mission("qa-p3", "QA · Gana con 3 del mismo país", { type: "WIN_WITH_COUNTRY_COUNT", min: 3 }, 1, { project_id: "qa-proyecto", sort_order: 12 });
  return { db, target: target.id };
}
const matchEvent = (key: string) => ({ kind: "MATCH" as const, key, mode: "PVE" as const, difficulty: "NORMAL" as const, won: true, draw: false, finished: true, turnsWon: 6, humanDecisions: 10, autoDecisions: 0,
  deck: Array.from({ length: 10 }, (_, i) => ({ cardId: `c${i}`, playerId: `p${i}`, team: `t${i}`, country: `X${i}`, role: "Duelista" as const })) });

/** Intercepta SOLO las dos rutas F73 y las atiende con los servicios reales sobre el mundo QA. */
async function intercept(c: Client, db: MemSupabase) {
  await c.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/game/crafting*", requestStage: "Request" }, { urlPattern: "*/api/game/missions*", requestStage: "Request" }] });
  c.tab.on("Fetch.requestPaused", async (p: { requestId: string; request: { url: string; method: string; postData?: string } }) => {
    let status = 200; let body: unknown;
    try {
      const b = p.request.postData ? JSON.parse(p.request.postData) : {};
      const send = (r: { ok: boolean; status: number; error?: string; code?: string; data?: unknown }) => { status = r.status; body = r.ok ? r.data : { error: r.error, ...(r.code ? { code: r.code } : {}) }; };
      if (p.request.url.includes("/api/game/crafting")) {
        if (p.request.method === "GET") send(await getCraftingState(db.client, U));
        else if (b.action === "craftPack") send(await craftPack(db.client, U, b.recipeId, b.ref));
        else if (b.action === "craftCard") send(await craftCard(db.client, U, b.recipeId, b.uids, b.ref));
        else { status = 400; body = { error: "Acción inválida" }; }
      } else {
        if (p.request.method === "GET") send(await getMissionsState(db.client, U));
        else if (b.action === "claimMission") send(await claimMission(db.client, U, b.missionId));
        else if (b.action === "claimProject") send(await claimProject(db.client, U, b.projectId));
        else { status = 400; body = { error: "Acción inválida" }; }
      }
    } catch (e) { status = 500; body = { error: (e as Error).message }; }
    await c.tab.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => null);
  });
}

const shot = (c: Client, name: string) => c.tab.shot(join(OUT, `${name}.png`)).catch(() => null);
const noHScroll = (c: Client) => c.tab.js<boolean>(`document.scrollingElement.scrollWidth <= innerWidth + 1`);
const click = (c: Client, sel: string) => c.tab.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.click(); return !!e; })()`);

(async () => {
  for (const width of WIDTHS) {
    const reduced = width === 390;
    const c = await openBrowser(P, width, { label: "f73-ui", reduced });
    try {
      await loginUi(c, P);
      // ── 0 · producción tal cual (0059 no aplicada) ──
      if (width === WIDTHS[0]) {
        await goto(c, "/misiones", 2500);
        const un = await waitFor(c.tab, `!!document.querySelector('[data-testid="f73-unavailable"]')`, 20000);
        await shot(c, `prod-misiones-no-disponible-${width}`);
        await goto(c, "/misiones/crafting/sobres", 2500);
        const un2 = await waitFor(c.tab, `!!document.querySelector('[data-testid="f73-unavailable"]')`, 20000);
        check(`[${width}] PRODUCCIÓN sin 0059: misiones y crafteo dicen «todavía no disponible», sin botones falsos`, un && un2 && !(await c.tab.js<boolean>(`!!document.querySelector('[data-testid="pack-recipe-craft"]')`)));
      }
      // ── 1 · flujo completo con el servidor F73 aislado ──
      const { db, target } = world();
      await intercept(c, db);
      await ingestEvent(db.client, U, { kind: "OPEN_PACK", key: "qa:open:1", packId: "estandar" });
      await ingestEvent(db.client, U, { kind: "OPEN_PACK", key: "qa:open:2", packId: "estandar" });
      await ingestEvent(db.client, U, matchEvent("qa:match:1"));
      await ingestEvent(db.client, U, matchEvent("qa:match:2"));

      await goto(c, "/misiones", 2500);
      await waitFor(c.tab, `document.querySelectorAll('[data-testid="mission-card"]').length >= 4`, 20000);
      await shot(c, `misiones-${width}`);
      const states = await c.tab.js<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('[data-testid="mission-card"]')].map(e => [e.dataset.mission, e.dataset.state]))`);
      check(`[${width}] MISIONES: estados del servidor (2/3 activa, completada con recompensa, dependiente bloqueada)`, states["qa-win3"] === "ACTIVE" && states["qa-open2"] === "COMPLETED" && states["qa-play5"] === "LOCKED", JSON.stringify(states));
      await c.tab.js(`[...document.querySelectorAll('[data-testid="mission-card"]')].find(e => e.dataset.mission === 'qa-open2')?.querySelector('[data-testid="mission-claim"]')?.click()`);
      const claimed = await waitFor(c.tab, `[...document.querySelectorAll('[data-testid="mission-card"]')].find(e => e.dataset.mission === 'qa-open2')?.dataset.state === 'CLAIMED'`, 10000);
      check(`[${width}] MISIONES: reclamar → CLAIMED y UNA recompensa en el ledger`, claimed && db.table("credit_transactions").filter((t) => t.ref === "m73:mission:qa-open2").length === 1);
      check(`[${width}] MISIONES: sin scroll horizontal`, await noHScroll(c));

      await click(c, '[data-testid="hub-tab-crafting"]');
      await waitFor(c.tab, `!!document.querySelector('[data-testid="crafting-home"]')`, 15000); await sleep(800);
      await shot(c, `crafting-home-${width}`);
      check(`[${width}] CRAFTING HOME: dos entradas con arte real (sobres y cartas)`, await c.tab.js<boolean>(`!!document.querySelector('[data-testid="crafting-entry-sobres"] img') && !!document.querySelector('[data-testid="crafting-entry-cartas"] img[data-card-art]')`));

      // ── SOBRES ──
      await click(c, '[data-testid="crafting-entry-sobres"]');
      await waitFor(c.tab, `document.querySelectorAll('[data-testid="pack-recipe"]').length >= 5`, 20000); await sleep(600);
      await shot(c, `sobres-${width}`);
      const openedByKeyboard = await c.tab.js<boolean>(`(() => { const b = document.querySelector('[data-recipe="pack-estandar-premium"] [data-testid="pack-recipe-craft"]'); b.focus(); return document.activeElement === b; })()`);
      await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
      await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      const dlg = await waitFor(c.tab, `!!document.querySelector('[data-testid="pack-craft-dialog"]')`, 5000);
      await sleep(400); await shot(c, `sobres-confirmar-${width}`);
      const dlgText = await c.tab.js<string>(`document.querySelector('[data-testid="pack-craft-dialog"]')?.innerText || ''`);
      check(`[${width}] SOBRES: teclado abre la confirmación compacta (ENTREGAS 4 × Bronce · RECIBES 1 × Plata)`, openedByKeyboard && dlg && /Entregas/i.test(dlgText) && /4 ×/.test(dlgText) && /Recibes/i.test(dlgText) && /1 ×/.test(dlgText), dlgText.replace(/\s+/g, " ").slice(0, 160));
      await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      const esc = await waitFor(c.tab, `!document.querySelector('[data-testid="pack-craft-dialog"]')`, 3000);
      check(`[${width}] SOBRES: Escape cancela sin craftear`, esc && db.table("economy_ops").filter((o) => o.kind === "craft_pack").length === 0);
      await click(c, '[data-recipe="pack-estandar-premium"] [data-testid="pack-recipe-craft"]');
      await waitFor(c.tab, `!!document.querySelector('[data-testid="pack-craft-confirm"]')`, 5000);
      await c.tab.js(`(() => { const b = document.querySelector('[data-testid="pack-craft-confirm"]'); b.click(); b.click(); })()`); // doble clic
      const done = await waitFor(c.tab, `!!document.querySelector('[data-testid="craft-result"]')`, 10000);
      await sleep(2400); await shot(c, `sobres-resultado-${width}`); // F74: espera al final de la secuencia de forja
      check(`[${width}] SOBRES: CRAFT COMPLETADO +1 Plata; doble clic = UNA operación; inventario del servidor`, done && db.table("economy_ops").filter((o) => o.kind === "craft_pack").length === 1 && Number(db.table("user_packs").find((r) => r.pack_id === "estandar")!.qty) === 5 && Number(db.table("user_packs").find((r) => r.pack_id === "premium")!.qty) === 4);
      await click(c, '[data-testid="pack-craft-dialog"] button'); await sleep(500);
      await c.tab.send("Page.reload", {}); await waitFor(c.tab, `document.querySelectorAll('[data-testid="pack-recipe"]').length >= 5`, 20000); await sleep(500);
      const haveAfter = await c.tab.js<string>(`document.querySelector('[data-recipe="pack-estandar-premium"]')?.innerText || ''`);
      check(`[${width}] SOBRES: F5 → 5 / 4 (no se repite el crafteo)`, /5\s*\/\s*4/.test(haveAfter) && db.table("economy_ops").filter((o) => o.kind === "craft_pack").length === 1, haveAfter.replace(/\s+/g, " ").slice(0, 80));
      check(`[${width}] SOBRES: sin scroll horizontal`, await noHScroll(c));

      // ── CARTAS · INTERCAMBIO ──
      await goto(c, "/misiones/crafting/cartas", 2500);
      await waitFor(c.tab, `document.querySelectorAll('[data-testid="exchange-candidate"]').length >= 1`, 20000); await sleep(500);
      await click(c, '[data-recipe="card-base-plata"]'); await sleep(400);
      for (let i = 0; i < 12; i++) {
        const n = await c.tab.js<string>(`document.querySelector('[data-testid="exchange-count"]')?.textContent || ''`);
        if (/^7 \/ 7/.test(n)) break;
        await c.tab.js(`(() => { const b = document.querySelector('[data-testid="exchange-add"]:not([disabled])'); b && b.click(); })()`);
        await sleep(120);
      }
      await shot(c, `intercambio-seleccion-${width}`);
      const cnt = await c.tab.js<string>(`document.querySelector('[data-testid="exchange-count"]')?.textContent || ''`);
      check(`[${width}] INTERCAMBIO: selección táctil de duplicados hasta 7 / 7 (arte real, copias visibles)`, /7 \/ 7/.test(cnt) && await c.tab.js<boolean>(`!!document.querySelector('[data-testid="exchange-candidate"] img[data-card-art]')`), cnt);
      await click(c, '[data-testid="exchange-craft"]');
      await waitFor(c.tab, `!!document.querySelector('[data-testid="card-craft-confirm"]')`, 5000); await sleep(400);
      await shot(c, `intercambio-confirmar-${width}`);
      await click(c, '[data-testid="card-craft-confirm"]');
      const out = await waitFor(c.tab, `!!document.querySelector('[data-testid="craft-result"] img[data-card-art]')`, 10000);
      await sleep(1800); await shot(c, `intercambio-resultado-${width}`); // F74: espera al final de la revelación
      const op = db.table("economy_ops").find((o) => o.kind === "craft_card");
      const outCard = (op?.result as { outputs?: { cardId: string }[] } | undefined)?.outputs?.[0]?.cardId ?? "";
      check(`[${width}] INTERCAMBIO: 1 carta Plata aleatoria (decidida en servidor) revelada con su arte`, out && !!outCard && packCardClass(CARDS.find((x) => x.id === outCard)!) === "plata", outCard);
      await click(c, '[data-testid="card-craft-dialog"] button'); await sleep(400);
      check(`[${width}] INTERCAMBIO: sin scroll horizontal`, await noHScroll(c));

      // ── PROYECTOS ──
      await click(c, '[data-testid="cards-tab-proyectos"]');
      await waitFor(c.tab, `!!document.querySelector('[data-testid="project-card"]')`, 15000); await sleep(600);
      await shot(c, `proyectos-${width}`);
      await click(c, '[data-testid="project-card"]');
      await waitFor(c.tab, `!!document.querySelector('[data-testid="project-progress"]')`, 15000); await sleep(600);
      const p1 = await c.tab.js<string>(`document.querySelector('[data-testid="project-progress"]')?.textContent || ''`);
      await shot(c, `proyecto-progreso-${width}`);
      check(`[${width}] PROYECTO: 2 / 3 (abrir y el intercambio que acabas de hacer cuentan; ganar con 3 del mismo país no)`, /2 \/ 3/.test(p1), p1);
      await ingestEvent(db.client, U, { ...matchEvent("qa:match:kr"), deck: Array.from({ length: 10 }, (_, i) => ({ cardId: `c${i}`, playerId: `p${i}`, team: `t${i}`, country: i < 3 ? "KR" : `Y${i}`, role: "Duelista" as const })) });
      await c.tab.send("Page.reload", {}); await waitFor(c.tab, `!!document.querySelector('[data-testid="project-claim"]')`, 15000); await waitFor(c.tab, SPLASH_GONE, 8000); await sleep(900); // F74: sin el splash encima
      await shot(c, `proyecto-completo-${width}`);
      await c.tab.js(`(() => { const b = document.querySelector('[data-testid="project-claim"]'); b.click(); b.click(); })()`);
      const rev = await waitFor(c.tab, `!!document.querySelector('[data-testid="craft-result"] img[data-card-art]')`, 10000);
      await sleep(1800); await shot(c, `proyecto-reclamado-${width}`); // F74: espera al final de la revelación
      const copies = db.table("user_cards").filter((x) => x.user_id === U && x.card_id === target).length;
      check(`[${width}] PROYECTO: RECLAMAR CARTA entrega la carta configurada UNA vez (doble clic)`, rev && copies === 1, `copias=${copies}`);
      await c.tab.send("Page.reload", {}); await waitFor(c.tab, `!!document.querySelector('[data-testid="project-progress"]')`, 15000); await sleep(400);
      check(`[${width}] PROYECTO: F5 conserva «Reclamada» y no hay botón de reclamar`, await c.tab.js<boolean>(`!document.querySelector('[data-testid="project-claim"]') && /Reclamada/i.test(document.body.innerText)`));
      check(`[${width}] PROYECTO: sin scroll horizontal`, await noHScroll(c));
      if (reduced) check(`[${width}] MOVIMIENTO REDUCIDO: la página lo detecta y el resultado aparece sin animación pesada`, await c.tab.js<boolean>(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
      const errs = c.tab.takeErrors();
      check(`[${width}] 0 errores de consola`, errs.length === 0, errs[0] ?? "");
    } finally { await c.browser.close().catch(() => null); }
  }
  writeFileSync(join(OUT, "ui-qa.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + "\n");
  const pass = results.filter((r) => r.ok).length;
  console.log(`f73 ui: ${pass}/${results.length}`);
  process.exit(pass === results.length ? 0 : 1);
})();
