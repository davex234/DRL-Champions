/**
 * FASE 38 · E2E REAL DE LA APERTURA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase38-real-e2e.ts <credsFile> <fingerprintSqlFile>
 *
 * Chrome → app local (`next start` :3005) → `/api/game/packs` → servicio → PostgreSQL del VPS (túnel SSH), con la
 * cuenta QA existente y el formulario real de /cuenta. Si la cuenta no tiene ningún Sobre Estándar, compra UNO por la
 * ruta REAL (`action: "buy"`, precio del catálogo, créditos QA). Después:
 *
 *   inventario → /abrir/estandar → doble clic en «Abrir sobre» (espía de fetch: 1 petición) → ceremonia completa
 *   (capturas por carta) → resumen → UI ↔ BD (uid, carta, serial, versión) → delta de colección real → reintento con
 *   la MISMA clave (+0) → recarga en el resumen (recuperado, sin segunda apertura) → ficha de la carta destacada.
 *
 * La BD se lee por SSH (solo lectura). Nunca imprime correo, contraseña, tokens ni el id completo.
 * Capturas en docs/product/qa/fase38/real/.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { getPack } from "../src/data/packs";

for (const f of [".env.local"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase38", "real");
mkdirSync(OUT, { recursive: true });
const [credsFile, fingerprintFile] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
if (!/^[0-9a-f-]{36}$/.test(creds.userId)) throw new Error("userId QA no válido");
const PROFILE = join(credsFile, "..", "f38-chrome-profile");
const PACK = "estandar";
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
let shotN = 0;
const shot = async (tab: Tab, name: string) => { await tab.shot(join(OUT, `real-${String(++shotN).padStart(2, "0")}-${name}.png`)); };

function psql(sql: string): string {
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}
const fingerprint = (): Record<string, string> => Object.fromEntries(psql(readFileSync(fingerprintFile, "utf8")).split("\n").map((l) => { const [k, ...v] = l.split(" | "); return [k, v.join(" | ")]; }));
const uuidList = (uids: string[]) => uids.filter((u) => /^[0-9a-f-]{36}$/.test(u)).map((u) => `'${u}'`).join(",");

async function apiToken(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error("login QA falló");
  return data.session.access_token;
}
async function api(token: string, body: unknown) {
  const r = await fetch(`${BASE}/api/game/packs`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: r.status, json, text };
}

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(200); }
  return false;
};
const key = async (tab: Tab, k: "Enter") => {
  await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: 13 });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: 13 });
};

async function login(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 3500);
  const signedIn = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión|salir/i.test(document.body.innerText))()`;
  if (!(await tab.js<boolean>(signedIn))) {
    await tab.js<boolean>(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const e = document.querySelector('input[type="email"]'); const p = document.querySelector('input[type="password"]');
      if (!e || !p) return false; set(e, ${esc(creds.email)}); set(p, ${esc(creds.password)}); return true; })()`);
    await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
    await waitFor(tab, signedIn, 20000);
  }
  return tab.js<boolean>(signedIn);
}

// Entre paréntesis: `a ?? null === "x" && b` es un SyntaxError en JS (no se puede mezclar ?? con && sin paréntesis).
const PHASE = `(document.querySelector('[data-testid="pack-opening"]')?.getAttribute("data-phase") ?? null)`;

async function main() {
  const token = await apiToken();
  const price = getPack(PACK)!.price;

  // ── 0 · huella PRE (y compra de UN sobre si no hay)
  const pre0 = fingerprint();
  log(`pre0 ${JSON.stringify({ credits: pre0.credits, estandar: pre0.user_packs_estandar, total: pre0.user_packs_total, opened: pre0.packs_opened_game, cards: pre0.cards, unique: pre0.cards_unique, ops: pre0.economy_ops, tx: pre0.credit_tx, missions: pre0.pack_missions })}`);
  let bought = false;
  if (Number(pre0.user_packs_estandar) === 0) {
    const buy = await api(token, { action: "buy", packId: PACK, ref: `f38-e2e-buy-${Date.now()}` });
    bought = buy.status === 200;
    log(`buy status=${buy.status} credits=${buy.json?.credits} qty=${buy.json?.qty}`);
  }
  const pre = fingerprint();
  if (bought) {
    check("compra real: −precio del catálogo en créditos", Number(pre0.credits) - Number(pre.credits) === price, `${pre0.credits} → ${pre.credits} (precio ${price})`);
    check("compra real: +1 sobre estándar", Number(pre.user_packs_estandar) === Number(pre0.user_packs_estandar) + 1);
    check("compra NO incrementa packs_opened (Fase 36.1)", pre.packs_opened_game === pre0.packs_opened_game);
    check("compra: +1 movimiento de créditos y +1 operación", Number(pre.credit_tx) === Number(pre0.credit_tx) + 1 && Number(pre.economy_ops) === Number(pre0.economy_ops) + 1);
  }
  check("hay un Sobre Estándar para abrir", Number(pre.user_packs_estandar) >= 1, pre.user_packs_estandar);
  const beforeIds = new Set(psql(`select distinct card_id from public.user_cards where user_id = '${creds.userId}';`).split("\n").filter(Boolean));

  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  let ref = ""; let uids: string[] = []; const reveals: any[] = [];
  try {
    check("login por el formulario real", await login(tab));
    await tab.js(`try { sessionStorage.removeItem("drl-open-reveal"); sessionStorage.removeItem("drl-open-pending"); } catch {}`);

    // ── 1 · inventario → apertura
    await tab.goto(`${BASE}/inventario`, 2500);
    const link = await waitFor(tab, `!!document.querySelector('a[href="/abrir/${PACK}"]')`, 20000);
    check("inventario enlaza a la nueva ceremonia", link);
    await sleep(800);
    await shot(tab, "inventory");
    await tab.js(`document.querySelector('a[href="/abrir/${PACK}"]').click()`);
    check("pantalla de apertura lista (sobre sellado)", await waitFor(tab, `${PHASE} === "ready" && !!document.querySelector('[data-testid="pack-open"]')`, 25000));
    // El espía se instala EN la pantalla de apertura (una navegación completa desde el inventario lo perdería).
    await tab.js(`(() => { window.__packCalls = []; const f = window.fetch; window.fetch = function(u, init) { try { const url = typeof u === "string" ? u : u.url; if (url.includes("/api/game/packs")) window.__packCalls.push(String(init && init.body || "")); } catch {} return f.apply(this, arguments); }; })()`);
    const readyFacts = await tab.js<any>(`({ name: document.querySelector('[data-testid="pack-name"]')?.textContent, count: document.querySelector('[data-testid="pack-count"]')?.textContent })`);
    check("antes de abrir: nombre y número real de cartas", readyFacts.name === getPack(PACK)!.name && readyFacts.count === `${getPack(PACK)!.cardCount} cartas`, JSON.stringify(readyFacts));
    await sleep(1200);
    await shot(tab, "pack-ready");

    // ── 2 · doble clic
    await tab.js(`(() => { const b = document.querySelector('[data-testid="pack-open"]'); b.click(); b.click(); })()`);
    await sleep(120);
    await shot(tab, "requesting-or-opening");
    check("resultado recibido → rotura → mano", await waitFor(tab, `${PHASE} === "hand"`, 30000));
    const calls = await tab.js<string[]>(`window.__packCalls`);
    const opens = calls.filter((c) => c.includes('"open"'));
    check("doble clic: UNA sola petición de apertura", opens.length === 1, `${opens.length} peticiones`);
    ref = (JSON.parse(opens[0] ?? "{}") as { ref?: string }).ref ?? "";
    check("la petición lleva clave de gesto y solo action/packId/ref", /^[\w:-]{1,128}$/.test(ref) && Object.keys(JSON.parse(opens[0] ?? "{}")).sort().join() === "action,packId,ref");
    await sleep(1400);
    await shot(tab, "hand-face-down");

    // ── 3 · revelado carta a carta
    await tab.js(`document.querySelector('[data-testid="pack-reveal"]')?.click()`);
    for (let i = 0; i < 12; i++) {
      const ok = await waitFor(tab, `${PHASE} === "reveal" && !!document.querySelector('[data-testid="reveal-card"]')`, 8000);
      if (!ok) break;
      await sleep(250);
      if (i < 1) await shot(tab, `card-${i + 1}-anticipation`);
      await waitFor(tab, `document.querySelector('[data-testid="reveal-card"]')?.getAttribute("data-revealed") === "true"`, 9000);
      await sleep(900);
      const facts = await tab.js<any>(`(() => { const c = document.querySelector('[data-testid="reveal-card"]'); return {
        uid: c.getAttribute("data-uid"), cardId: c.getAttribute("data-card-id"), serial: c.getAttribute("data-serial"), rarity: c.getAttribute("data-rarity"), status: c.getAttribute("data-status"),
        badges: [...c.querySelectorAll('[data-testid="reveal-badges"] span')].map((s) => s.textContent.trim()), announce: c.querySelector('[data-testid="reveal-announcement"]')?.textContent };
      })()`);
      reveals.push(facts);
      log(`card ${i + 1}: ${facts.cardId} serial=${facts.serial || "-"} rarity=${facts.rarity} status=${facts.status} badges=${JSON.stringify(facts.badges)}`);
      await shot(tab, `card-${i + 1}-revealed`);
      await key(tab, "Enter");
      await sleep(400);
      if ((await tab.js<string | null>(PHASE)) === "summary") break;
    }
    check("resumen tras revelar todas", await waitFor(tab, `${PHASE} === "summary" && !!document.querySelector('[data-testid="pack-summary"]')`, 15000));
    await sleep(1500);
    await shot(tab, "summary");
    const summary = await tab.js<any>(`(() => ({
      cards: [...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => ({ uid: e.getAttribute("data-uid"), cardId: e.getAttribute("data-card-id"), serial: e.getAttribute("data-serial"), minted: e.getAttribute("data-minted"), status: e.getAttribute("data-status"), rarity: e.getAttribute("data-rarity") })),
      collection: (() => { const c = document.querySelector('[data-testid="summary-collection"]'); return c ? { before: c.getAttribute("data-before"), after: c.getAttribute("data-after"), total: c.getAttribute("data-total"), text: c.innerText.replace(/\\s+/g, " ").slice(0, 160) } : null; })(),
      moments: document.querySelector('[data-testid="summary-moments"]')?.innerText.replace(/\\s+/g, " "),
      sets: document.querySelector('[data-testid="summary-sets"]')?.innerText.replace(/\\s+/g, " ").slice(0, 200) ?? null,
      actions: document.querySelector('[data-testid="summary-actions"]')?.innerText.replace(/\\s+/g, " "),
      noValue: !/🪙|Valor total|Vender/i.test(document.body.innerText),
    }))()`);
    log(`summary ${JSON.stringify({ n: summary.cards.length, collection: summary.collection, moments: summary.moments, sets: summary.sets, actions: summary.actions })}`);
    uids = summary.cards.map((c: any) => c.uid);
    check("revelado = resumen: mismas cartas en el mismo orden", JSON.stringify(reveals.map((r) => r.uid)) === JSON.stringify(uids), `${reveals.length} reveladas / ${uids.length} en resumen`);
    check("resumen sin valor en monedas ni venta", summary.noValue);
    await tab.resize(1440, 2600); await sleep(900);
    await shot(tab, "summary-full");
    await tab.resize(1440, 900);

    // ── 4 · UI ↔ BD
    if (uids.length === 0) throw new Error("el resumen no tiene cartas: no hay nada que comparar con la BD");
    const rows = psql(`select uid || ' | ' || card_id || ' | ' || coalesce(serial::text, '') || ' | ' || coalesce(minted_version::text, '') from public.user_cards where user_id = '${creds.userId}' and uid in (${uuidList(uids)});`).split("\n").filter(Boolean)
      .map((l) => { const [uid, cardId, serial, minted] = l.split(" | "); return { uid, cardId, serial, minted }; });
    const byUid = new Map(rows.map((r) => [r.uid, r]));
    const matches = summary.cards.filter((c: any) => { const r = byUid.get(c.uid); return r && r.cardId === c.cardId && r.serial === c.serial && r.minted === c.minted; }).length;
    check(`UI ↔ BD: ${matches}/${summary.cards.length} cartas coinciden en uid, carta, serial y versión acuñada`, matches === summary.cards.length && summary.cards.length === getPack(PACK)!.cardCount);
    const expectedNew = new Set(summary.cards.map((c: any) => c.cardId).filter((id: string) => !beforeIds.has(id)));
    const uiNew = summary.cards.filter((c: any) => c.status === "new").length;
    check("NUEVA = definiciones sin copias antes de ESTA apertura (contra la BD)", uiNew === expectedNew.size, `ui ${uiNew} · bd ${expectedNew.size}`);
    const mid = fingerprint();
    const uniqueAfter = Number(mid.cards_unique);
    check("delta de colección del resumen = BD (únicas antes → después)", summary.collection && Number(summary.collection.before) === beforeIds.size && Number(summary.collection.after) === uniqueAfter, `ui ${summary.collection?.before}→${summary.collection?.after} · bd ${beforeIds.size}→${uniqueAfter}`);
    check("apertura: packs_opened +1 exacto", Number(mid.packs_opened_game) === Number(pre.packs_opened_game) + 1, `${pre.packs_opened_game} → ${mid.packs_opened_game}`);
    check("apertura: −1 sobre estándar, +N cartas", Number(mid.user_packs_estandar) === Number(pre.user_packs_estandar) - 1 && Number(mid.cards) === Number(pre.cards) + getPack(PACK)!.cardCount);
    check("apertura: créditos intactos y 0 movimientos de créditos nuevos", mid.credits === pre.credits && mid.credit_tx === pre.credit_tx, `${pre.credits} → ${mid.credits}`);
    check("apertura: +1 operación económica (la del sobre), sin ledger extra", Number(mid.economy_ops) === Number(pre.economy_ops) + 1);
    check("objetivos: el estado del pase no lo toca el cliente (baseline intacto)", mid.pack_missions === pre.pack_missions, mid.pack_missions);
    log(`xp ${pre.xp} → ${mid.xp} (XP de cartas del servidor, como antes de la fase)`);

    // ── 5 · recarga en el resumen
    await tab.goto(`${BASE}/abrir/${PACK}`, 2500);
    const recovered = await waitFor(tab, `${PHASE} === "summary" && document.querySelector('[data-testid="pack-summary"]')?.getAttribute("data-recovered") === "true"`, 20000);
    await sleep(1200);
    const recUids = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => e.getAttribute("data-uid"))`);
    check("recarga: resumen recuperado con las MISMAS cartas", recovered && JSON.stringify(recUids) === JSON.stringify(uids));
    await shot(tab, "refresh-recovered-summary");
    const afterReload = fingerprint();
    check("recarga: no abre otro sobre (+0 aperturas, +0 cartas)", afterReload.packs_opened_game === mid.packs_opened_game && afterReload.cards === mid.cards);

    // ── 6 · ficha desde el resumen
    await tab.js(`document.querySelector('[data-testid="summary-view-collection"]')?.click()`);
    const detail = await waitFor(tab, `location.pathname.startsWith("/coleccion/carta/") && document.querySelector('[data-testid="card-detail"]')?.getAttribute("data-owned") === "true"`, 25000);
    const path = await tab.js<string>("location.pathname");
    check("«Ver en mi colección» → ficha real de una carta del sobre, poseída", detail && uids.length > 0 && summary.cards.some((c: any) => path === `/coleccion/carta/${encodeURIComponent(c.cardId)}`), path);
    await sleep(1500);
    await shot(tab, "card-detail-deep-link");
    const errs = tab.takeErrors().filter((e) => !/players\/.*\.(png|webp)|teams\/.*\.(png|webp)|flagcdn|404|Failed to load resource/i.test(e));
    check("sin errores de consola propios", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally {
    await b.close();
  }

  // ── 7 · reintento real con la MISMA clave
  const beforeRetry = fingerprint();
  const retry = await api(token, { action: "open", packId: PACK, ref });
  check("reintento misma clave: 200 y marcado como repetido", retry.status === 200 && retry.json?.repeated === true, `status=${retry.status}`);
  check("reintento: MISMAS cartas (uids, cartas, seriales)", JSON.stringify((retry.json?.opened ?? []).map((c: any) => c.uid)) === JSON.stringify(uids));
  const afterRetry = fingerprint();
  check("reintento: +0 aperturas, +0 cartas, +0 sobres, +0 créditos, +0 operaciones", ["packs_opened_game", "cards", "user_packs_estandar", "credits", "economy_ops", "credit_tx", "xp"].every((k) => afterRetry[k] === beforeRetry[k]), ["packs_opened_game", "cards", "user_packs_estandar", "credits", "economy_ops", "credit_tx", "xp"].map((k) => `${k} ${beforeRetry[k]}→${afterRetry[k]}`).join(" · "));
  const extra = await api(token, { action: "open", packId: PACK, ref: "x", cardId: "aspas__gold", serial: 1 });
  check("campos elegidos por el cliente (carta, serial) → 400", extra.status === 400, `status=${extra.status}`);

  const post = fingerprint();
  log(`post ${JSON.stringify({ credits: post.credits, estandar: post.user_packs_estandar, opened: post.packs_opened_game, cards: post.cards, unique: post.cards_unique, ops: post.economy_ops, tx: post.credit_tx, favorites: post.favorites, decks: post.decks_md5, showcase: post.showcase, ach: post.achievements, missions: post.pack_missions })}`);
  check("vitrina, equipos y favoritos intactos", post.decks_md5 === pre.decks_md5 && post.showcase === pre.showcase && post.favorites === pre.favorites);
  log(`\nE2E apertura: ${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
