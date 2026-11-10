/**
 * FASE 49 · QA FUNCIONAL Y DE SEGURIDAD REAL DE LA TIENDA 4.0 (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_f49-live.ts <credsFile> [base=http://127.0.0.1:3006]
 *
 * ESCRIBE en la cuenta QA indicada (y solo en ella): compra 2 Sobres Estándar con créditos (uno por la API de
 * la tienda con un replay del mismo gesto, otro por la interfaz). La reversión se hace aparte, con backup.
 * No abre sobres (no acuña cartas) y no toca dinero real: no existe pasarela.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";

for (const f of [".env.local", ".env"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const creds = JSON.parse(readFileSync(process.argv[2], "utf8")) as { email: string; password: string };
const BASE = process.argv[3] ?? "http://127.0.0.1:3006";
const OUT = join(process.cwd(), "docs/product/qa/fase49");
const esc = (s: string) => JSON.stringify(s);
const results: { caso: string; ok: boolean; detalle: unknown }[] = [];
const check = (caso: string, ok: boolean, detalle: unknown) => { results.push({ caso, ok, detalle }); console.log(`${ok ? "✓" : "✕"} ${caso} ${JSON.stringify(detalle)}`); };

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: auth, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !auth.session) throw new Error(`login: ${error?.message}`);
  const token = auth.session.access_token;
  const post = async (path: string, body: unknown, withAuth = true) => {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(withAuth ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null };
  };
  const state = async () => {
    const r = await fetch(`${BASE}/api/game/state`, { headers: { authorization: `Bearer ${token}` } });
    const j = await r.json() as { credits: number; unopenedPacks: Record<string, number> };
    return { credits: j.credits, estandar: j.unopenedPacks?.estandar ?? 0 };
  };

  const s0 = await state();
  check("estado inicial leído", typeof s0.credits === "number", s0);

  // ── Seguridad: el servidor manda ──
  let r = await post("/api/game/store", { action: "checkout", productId: "pack:estandar", method: "GAME_CURRENCY" }, false);
  check("sin sesión → 401", r.status === 401, r);
  for (const extra of [{ price: 1 }, { qty: 10 }, { quantity: 10 }, { cardId: "mada__moments" }, { contents: { packs: [] } }, { credits: 999999 }, { userId: "otro" }]) {
    r = await post("/api/game/store", { action: "checkout", productId: "pack:estandar", method: "GAME_CURRENCY", ...extra });
    check(`campo manipulado ${Object.keys(extra)[0]} → 400`, r.status === 400, r);
  }
  r = await post("/api/game/store", { action: "checkout", productId: "pack:no-existe", method: "GAME_CURRENCY" });
  check("productId inexistente → 404", r.status === 404, r);
  r = await post("/api/game/store", { action: "checkout", productId: "../../pack", method: "GAME_CURRENCY" });
  check("productId con forma inválida → 400", r.status === 400, r);
  r = await post("/api/game/store", { action: "checkout", productId: "pack:team-tyl", method: "GAME_CURRENCY" });
  check("TYL (DRAFT) por la tienda → 404", r.status === 404, r);
  r = await post("/api/game/packs", { action: "buy", packId: "team-tyl" });
  check("TYL (DRAFT) por la ruta de sobres → 404", r.status === 404, r);
  r = await post("/api/game/packs", { action: "buy", packId: "team-xlg" });
  check("XLG (DRAFT) por la ruta de sobres → 404", r.status === 404, r);
  r = await post("/api/game/store", { action: "checkout", productId: "box:caja-masters", method: "REAL_MONEY" });
  check("caja con dinero real sin pasarela → 503 (nada concedido)", r.status === 503, r);
  r = await post("/api/game/store", { action: "checkout", productId: "box:caja-masters", method: "GAME_CURRENCY" });
  check("caja con créditos (método no ofrecido) → 400", r.status === 400, r);
  r = await post("/api/game/store", { action: "checkout", productId: "card:mada__moments", method: "GAME_CURRENCY" });
  check("carta sin precio → 409", r.status === 409, r);
  r = await post("/api/game/store", { action: "checkout", productId: "bundle:pack-inicio", method: "REAL_MONEY" });
  check("pack especial con dinero real → 503", r.status === 503, r);
  r = await post("/api/game/store", { action: "checkout", productId: "pack:premium", method: "REAL_MONEY" });
  check("sobre con dinero real → 503", r.status === 503, r);
  r = await post("/api/game/store", { action: "checkout", productId: "pack:icon", method: "GAME_CURRENCY", ref: "f49-icon-short" });
  check("saldo insuficiente (Icon 20.000) → rechazo", r.status >= 400 && r.status < 500, r);
  const s1 = await state();
  check("tras los rechazos: saldo y sobres intactos", s1.credits === s0.credits && s1.estandar === s0.estandar, { s0, s1 });

  // ── Compra real por la API de la tienda + replay del mismo gesto ──
  const ref = `f49-live-${Date.now()}`;
  const a = await post("/api/game/store", { action: "checkout", productId: "pack:estandar", method: "GAME_CURRENCY", ref });
  const b = await post("/api/game/store", { action: "checkout", productId: "pack:estandar", method: "GAME_CURRENCY", ref });
  const s2 = await state();
  check("compra con créditos por la tienda → 200 y saldo − 750", a.status === 200 && s2.credits === s0.credits - 750 && s2.estandar === s0.estandar + 1, { a, s2 });
  check("replay del mismo gesto → no cobra dos veces", b.status === 200 && s2.credits === s0.credits - 750, { b });

  // ── Compra por la INTERFAZ (modal → confirmar → saldo → abrir) ──
  const br = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
  const tab: Tab = br.tab;
  try {
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/cuenta`, 3500);
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(creds.email)}); set(document.querySelector('input[type="password"]'), ${esc(creds.password)});
      document.querySelector('form button[type="submit"]').click(); })()`);
    for (let i = 0; i < 60 && await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`); i++) await sleep(500);
    await sleep(1500);
    await tab.goto(`${BASE}/tienda`, 3500);
    for (let i = 0; i < 60 && !(await tab.js<boolean>(`!!document.querySelector('#sobres article')`)); i++) await sleep(500);
    await sleep(2500);
    const header0 = await tab.js<string>(`document.querySelector('header')?.innerText.replace(/\\s+/g,' ')`);
    await tab.js(`document.querySelector('#sobres article button[aria-label^="Comprar Sobre Est"], #sobres article button[aria-label^="Comprar o abrir"]')?.click() || [...document.querySelectorAll('#sobres article')].find((a) => /Sobre Estándar/.test(a.getAttribute('aria-label')))?.querySelector('button').click()`);
    await sleep(900);
    const modal0 = await tab.js<string>(`document.querySelector('[data-testid="store-purchase-modal"]')?.innerText.replace(/\\s+/g,' ')`);
    await tab.shot(join(OUT, "live-1440-modal-confirmar.png"));
    await tab.js(`[...document.querySelectorAll('[data-testid="store-purchase-modal"] button')].find((b) => /Confirmar/.test(b.textContent)).click()`);
    for (let i = 0; i < 40 && !(await tab.js<boolean>(`/añadido a tu inventario/i.test(document.querySelector('[data-testid="store-purchase-modal"]')?.innerText || '')`)); i++) await sleep(500);
    await sleep(1200);
    const modal1 = await tab.js<string>(`document.querySelector('[data-testid="store-purchase-modal"]')?.innerText.replace(/\\s+/g,' ')`);
    await tab.shot(join(OUT, "live-1440-modal-comprado.png"));
    const header1 = await tab.js<string>(`document.querySelector('header')?.innerText.replace(/\\s+/g,' ')`);
    const s3 = await state();
    check("interfaz: modal con saldo antes/después", /Tu saldo/i.test(modal0 ?? "") && /Después/i.test(modal0 ?? ""), { modal0: modal0?.slice(0, 220) });
    check("interfaz: compra confirmada, saldo − 750 en el servidor y +1 sobre", s3.credits === s2.credits - 750 && s3.estandar === s2.estandar + 1, { s3, modal1: modal1?.slice(0, 200) });
    check("interfaz: la cabecera refleja el saldo del servidor", header1 !== header0 && header1.includes(new Intl.NumberFormat("es-ES", { useGrouping: "always" } as Intl.NumberFormatOptions).format(s3.credits)), { header0, header1 });
    // «Abrir ahora» lleva a la apertura con el sobre disponible (no se abre: no se acuñan cartas en QA).
    await tab.js(`[...document.querySelectorAll('[data-testid="store-purchase-modal"] button')].find((b) => /Abrir ahora/.test(b.textContent)).click()`);
    for (let i = 0; i < 30 && !(await tab.js<boolean>(`location.pathname.startsWith('/abrir/estandar')`)); i++) await sleep(500);
    await sleep(3500);
    const abrir = await tab.js<{ path: string; texto: string }>(`({ path: location.pathname, texto: document.body.innerText.replace(/\\s+/g,' ').slice(0, 300) })`);
    await tab.shot(join(OUT, "live-1440-abrir-despues.png"));
    check("abrir posteriormente: /abrir/estandar carga con el sobre listo", abrir.path === "/abrir/estandar" && !/no tienes/i.test(abrir.texto), abrir);
    const errs = tab.takeErrors();
    check("interfaz: 0 errores de consola", errs.length === 0, errs.slice(0, 6));
  } finally { await br.close(); }

  writeFileSync(join(OUT, "live-report.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  const fails = results.filter((x) => !x.ok).length;
  console.log(fails ? `✕ ${fails} fallos` : "✓ TODO CORRECTO");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
