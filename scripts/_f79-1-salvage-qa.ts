/**
 * F79.1 · QA DE NAVEGADOR del DESGUACE con cartas protegidas (/inventario) contra el build LOCAL — fuera de CI.
 * Sesión simulada + `/api/game/economy` atendido por los SERVICIOS REALES (`previewSalvage`/`salvageCards`) sobre
 * MemSupabase con la RPC guardada de 0061 emulada. Comprueba que una favorita/vitrina NUNCA se desguaza sin marcarla.
 *
 *   npx tsx scripts/_f79-1-salvage-qa.ts [base=http://127.0.0.1:3011] [anchuras=1440,1024,390]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { launch, sleep, type Tab } from "./lib/cdp";
import { MemSupabase } from "../src/server/services/testing/memSupabase";
import { previewSalvage, salvageCards } from "../src/server/services/economy";
import { CARDS } from "../src/data/catalog";
import { packCardClass } from "../src/domain/packs/packClass";

const BASE = process.argv[2] ?? "http://127.0.0.1:3011";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const OUT = join(process.cwd(), "docs/product/qa/f79-1/salvage");
mkdirSync(OUT, { recursive: true });
const U = "f7910000-0000-4000-8000-0000000c5a1e";
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: String(detail).slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${String(detail).slice(0, 160)}`); return ok; };
const J = JSON.stringify;
const base = CARDS.filter((c) => packCardClass(c) === "base" && !!c.image).sort((a, b) => a.id.localeCompare(b.id));

function world() {
  const db = new MemSupabase();
  db.table("profiles").push({ id: U, username: "qa-f791-salv", credits: 1000, xp: 0, level: 1, points: 0, is_admin: false });
  const give = (cardId: string, n: number) => Array.from({ length: n }, () => { const uid = randomUUID(); db.table("user_cards").push({ uid, user_id: U, card_id: cardId, serial: null, origin: "pack", locked: false, minted_version: null, obtained_at: new Date(0).toISOString() }); return uid; }).sort();
  give(base[0].id, 3);                       // 2 duplicados libres
  const fav = base[1].id; give(fav, 3);      // favorita: 2 duplicados PROTEGIDOS
  db.table("user_card_favorites").push({ user_id: U, card_id: fav, created_at: new Date().toISOString() });
  const deck = give(base[2].id, 3);          // 2 en equipos: una cuenta como la que se conserva, la otra NO se desguaza; la 3ª, libre
  db.table("duel_decks").push({ id: randomUUID(), user_id: U, name: "QA", card_uids: [deck[0], deck[1]] });
  return { db, fav, free: base[0].id };
}
const boot = `(() => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const exp = 4102444800;
  const user = { id: ${J(U)}, aud: "authenticated", role: "authenticated", email: "qa-f791-salv@example.invalid", app_metadata: {}, user_metadata: {} };
  const jwt = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: user.id, exp, role: "authenticated", email: user.email }) + ".qa";
  const s = JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "qa-f791", user });
  for (const k of ["sb-127-auth-token", "sb-localhost-auth-token", "sb-valorosters-auth-token"]) { try { localStorage.setItem(k, s); } catch {} }
})();`;

async function intercept(t: Tab, db: MemSupabase, calls: unknown[]) {
  await t.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/game/*", requestStage: "Request" }, { urlPattern: "*/api/telemetry*", requestStage: "Request" }] });
  t.on("Fetch.requestPaused", async (p: { requestId: string; request: { url: string; method: string; postData?: string } }) => {
    const u = new URL(p.request.url);
    let status = 200; let body: unknown = {};
    try {
      const b = p.request.postData ? JSON.parse(p.request.postData) : {};
      if (u.pathname === "/api/game/economy" && b.action === "salvagePreview") { const r = await previewSalvage(db.client, U); status = r.ok ? 200 : r.status; body = r.ok ? r.data : { error: r.error }; }
      else if (u.pathname === "/api/game/economy" && b.action === "salvage") { calls.push(b); const r = await salvageCards(db.client, U, b.uids, `salvage:${U}:${b.ref}`, b.confirmProtected ?? []); status = r.ok ? 200 : r.status; body = r.ok ? r.data : { error: r.error, code: (r as { code?: string }).code }; }
      else if (u.pathname === "/api/game/me") body = { profile: db.table("profiles")[0] };
      else if (u.pathname.startsWith("/api/telemetry")) { status = 204; body = null; }
      else { status = 401; body = { error: "No autenticado" }; }
    } catch (e) { status = 500; body = { error: String(e) }; }
    const raw = body === null ? "" : JSON.stringify(body);
    await t.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "content-type", value: "application/json" }], ...(raw ? { body: Buffer.from(raw).toString("base64") } : {}) }).catch(() => undefined);
  });
}
const has = (tid: string) => `!!document.querySelector('[data-testid="${tid}"]')`;
async function waitFor(t: Tab, expr: string, ms = 15000) { for (let i = 0; i < ms / 200; i++) { if (await t.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; }

async function run(width: number) {
  const { db, fav, free } = world();
  const calls: { uids: string[]; confirmProtected?: string[] }[] = [];
  const browser = await launch({ width, height: width < 600 ? 844 : width <= 1024 ? 768 : 900, args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const copies = (id: string) => db.table("user_cards").filter((c) => c.card_id === id).length;
  try {
    await t.setMedia([{ name: "prefers-reduced-motion", value: width <= 390 ? "reduce" : "no-preference" }]);
    await t.send("Page.addScriptToEvaluateOnNewDocument", { source: boot });
    await intercept(t, db, calls as unknown[]);
    await t.goto(`${BASE}/inventario`, 2500);
    check(`[${width}] PROTEGIDAS · el bloque aparte enumera las 2 copias de la favorita y la del equipo`, await waitFor(t, `${has("salvage-protected")} && document.querySelectorAll('[data-testid="salvage-protected-copy"]').length === 2 && /equipos/i.test(document.querySelector('[data-testid="salvage-protected"]').innerText)`), await t.js<string>(`document.querySelector('[data-testid="salvage-protected"]')?.innerText ?? ""`));
    check(`[${width}] BOTÓN · solo cuenta las NO protegidas (2 libres + 1 junto al equipo = 3)`, await waitFor(t, `/Desguazar 3/i.test(document.querySelector('[data-testid="salvage-confirm"]')?.textContent ?? "")`, 5000), await t.js<string>(`document.querySelector('[data-testid="salvage-confirm"]')?.textContent ?? ""`));
    check(`[${width}] sin scroll horizontal`, await t.js<boolean>(`document.scrollingElement.scrollWidth <= innerWidth + 1`));
    await t.shot(join(OUT, `01-protected-${width}.png`)).catch(() => undefined);
    // Marcar UNA favorita: entra en el desguace y en la confirmación explícita; la otra no.
    await t.js(`document.querySelector('[data-testid="salvage-protected-copy"]').click()`);
    check(`[${width}] MARCAR · una favorita suma al botón (4)`, await waitFor(t, `/Desguazar 4/i.test(document.querySelector('[data-testid="salvage-confirm"]')?.textContent ?? "")`, 3000));
    await t.js(`document.querySelector('[data-testid="salvage-confirm"]').click()`);
    check(`[${width}] DESGUACE · el servidor recibe la favorita marcada como CONFIRMADA (y solo esa)`, await waitFor(t, `true`, 100) && (await (async () => { for (let i = 0; i < 40 && calls.length === 0; i++) await sleep(150); return calls.length === 1 && calls[0].confirmProtected?.length === 1 && calls[0].uids.includes(calls[0].confirmProtected[0]); })()), J(calls[0] ?? null));
    await sleep(800);
    check(`[${width}] RESULTADO · favorita: 3 → 2 (solo la marcada); libre: 3 → 1; equipo intacto`, copies(fav) === 2 && copies(free) === 1 && db.table("user_cards").some((c) => (db.table("duel_decks")[0].card_uids as string[]).includes(String(c.uid))), J({ fav: copies(fav), free: copies(free) }));
    await t.shot(join(OUT, `02-after-${width}.png`)).catch(() => undefined);
  } finally { await browser.close(); }
}

(async () => {
  for (const w of WIDTHS) await run(w);
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n→ ${ok}/${results.length}`);
  writeFileSync(join(OUT, "salvage-qa.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
