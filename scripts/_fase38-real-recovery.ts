/**
 * FASE 38 · VERIFICACIÓN REAL SIN CONSUMIR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase38-real-recovery.ts <credsFile> <fingerprintSqlFile>
 *
 * Tras la apertura REAL del único Sobre Estándar autorizado (comprado con créditos QA), esta pasada NO compra ni abre
 * nada. Toma de `economy_ops` (lectura por SSH) el gesto de esa apertura y ejercita, con la app local contra la BD del
 * VPS y la cuenta QA:
 *
 *   1. RECUPERACIÓN REAL: gesto pendiente en la pestaña → `/abrir/estandar` → «Recuperando» → la MISMA clave → el
 *      servidor devuelve lo guardado → resumen recuperado.
 *   2. UI ↔ BD: cada carta del resumen (uid, carta, serial, versión acuñada) contra `user_cards`; delta de colección
 *      (únicas antes de ESA apertura → después) contra la BD; NUEVA contra las demás copias.
 *   3. RECARGA: el resumen se vuelve a recuperar sin abrir otro.
 *   4. REINTENTO por la API con la MISMA clave: `repeated`, mismas cartas, +0 en todo.
 *   5. SEGURIDAD: campos elegidos por el cliente → 400; clave de otro sobre → 409.
 *   6. FICHA: «Ver en mi colección» → ficha real poseída.
 *
 * Huella de la cuenta QA antes/después: debe ser idéntica. Nunca imprime correo, contraseña, tokens ni el id completo.
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
const PROFILE = join(credsFile, "..", "f38r-chrome-profile");
const PACK = "estandar";
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const shot = async (tab: Tab, name: string) => { await tab.shot(join(OUT, `recovery-${name}.png`)); };

function psql(sql: string): string {
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}
const fingerprint = () => psql(readFileSync(fingerprintFile, "utf8"));
const PHASE = `(document.querySelector('[data-testid="pack-opening"]')?.getAttribute("data-phase") ?? null)`;

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
  return { status: r.status, json };
}
const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(200); }
  return false;
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

async function main() {
  const token = await apiToken();

  // ── la apertura real ya hecha: gesto y uids desde economy_ops (el userId no se imprime)
  const op = psql(`select split_part(ref, ':', 4) || ' | ' || (result->'uids')::text || ' | ' || to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') from public.economy_ops where user_id = '${creds.userId}' and kind = 'open_pack' and result->>'packId' = '${PACK}' order by created_at desc limit 1;`);
  const [gesture, uidsJson, at] = op.split(" | ");
  const storedUids = JSON.parse(uidsJson ?? "[]") as string[];
  check("existe la apertura real del Sobre Estándar en economy_ops", /^[\w-]{8,}$/.test(gesture ?? "") && storedUids.length === getPack(PACK)!.cardCount, `${storedUids.length} uids · ${at} UTC`);
  const opensTotal = Number(psql(`select count(*) from public.economy_ops where user_id = '${creds.userId}' and kind = 'open_pack' and created_at > now() - interval '2 hours';`));
  check("doble clic de la pasada anterior: UNA sola apertura registrada", opensTotal === 1, `${opensTotal} aperturas en las últimas 2 h`);

  const idList = storedUids.filter((u) => /^[0-9a-f-]{36}$/.test(u)).map((u) => `'${u}'`).join(",");
  const dbRows = psql(`select uid || ' | ' || card_id || ' | ' || coalesce(serial::text, '') || ' | ' || coalesce(minted_version::text, '') from public.user_cards where user_id = '${creds.userId}' and uid in (${idList});`).split("\n").filter(Boolean)
    .map((l) => { const [uid, cardId, serial, minted] = l.split(" | "); return { uid, cardId, serial, minted }; });
  const openedIds = new Set(dbRows.map((r) => r.cardId));
  const uniqueBefore = Number(psql(`select count(distinct card_id) from public.user_cards where user_id = '${creds.userId}' and uid not in (${idList});`));
  const uniqueNow = Number(psql(`select count(distinct card_id) from public.user_cards where user_id = '${creds.userId}';`));
  const otherCopies = new Set(psql(`select distinct card_id from public.user_cards where user_id = '${creds.userId}' and uid not in (${idList});`).split("\n").filter(Boolean));
  const expectedNew = [...openedIds].filter((id) => !otherCopies.has(id)).length;
  log(`bd: ${dbRows.length} filas de la apertura · únicas antes ${uniqueBefore} → ahora ${uniqueNow} · nuevas esperadas ${expectedNew}`);

  const pre = fingerprint();
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  let uiCards: any[] = [];
  try {
    check("login por el formulario real", await login(tab));
    await tab.goto(`${BASE}/inventario`, 3000);
    await sleep(1200);
    await shot(tab, "01-inventory-after-open");

    // ── 1 · recuperación real con el gesto pendiente en la pestaña
    await tab.js(`(() => { sessionStorage.removeItem("drl-open-reveal"); sessionStorage.setItem("drl-open-pending", JSON.stringify({ packId: ${esc(PACK)}, ref: ${esc(gesture)}, at: Date.now() })); })()`);
    await tab.goto(`${BASE}/abrir/${PACK}`, 600);
    const sawRecovering = await waitFor(tab, `${PHASE} === "recovering" || document.querySelector('[data-testid="pack-status"]')?.getAttribute("data-kind") === "recovering" || ${PHASE} === "summary"`, 15000);
    if (await tab.js<boolean>(`document.querySelector('[data-testid="pack-status"]')?.getAttribute("data-kind") === "recovering"`)) await shot(tab, "02-recovering");
    check("recarga con apertura enviada → «Recuperando tu sobre» / resumen, nunca «ABRIR SOBRE»", sawRecovering);
    const recovered = await waitFor(tab, `${PHASE} === "summary" && document.querySelector('[data-testid="pack-summary"]')?.getAttribute("data-recovered") === "true"`, 30000);
    check("resumen recuperado con el resultado guardado por el servidor", recovered);
    await sleep(2000);
    await shot(tab, "03-recovered-summary");
    await tab.resize(1440, 2600); await sleep(900);
    await shot(tab, "04-recovered-summary-full");
    await tab.resize(1440, 900);

    uiCards = await tab.js<any[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => ({ uid: e.getAttribute("data-uid"), cardId: e.getAttribute("data-card-id"), serial: e.getAttribute("data-serial"), minted: e.getAttribute("data-minted"), status: e.getAttribute("data-status") }))`);
    const collection = await tab.js<any>(`(() => { const c = document.querySelector('[data-testid="summary-collection"]'); return c ? { before: Number(c.getAttribute("data-before")), after: Number(c.getAttribute("data-after")), total: Number(c.getAttribute("data-total")), text: c.innerText.replace(/\\s+/g, " ") } : null; })()`);
    const text = await tab.js<string>(`document.querySelector('[data-testid="pack-summary"]')?.innerText.replace(/\\s+/g, " ").slice(0, 400) ?? ""`);
    log(`ui: ${uiCards.length} cartas · colección ${JSON.stringify(collection)} · «${text.slice(0, 160)}…»`);

    // ── 2 · UI ↔ BD
    check("mismas cartas y mismo orden que la operación guardada", JSON.stringify(uiCards.map((c) => c.uid)) === JSON.stringify(storedUids));
    const byUid = new Map(dbRows.map((r) => [r.uid, r]));
    const matches = uiCards.filter((c) => { const r = byUid.get(c.uid); return r && r.cardId === c.cardId && r.serial === c.serial && r.minted === c.minted; }).length;
    check(`UI ↔ BD: ${matches}/${uiCards.length} coinciden en uid, carta, serial y versión acuñada`, matches === uiCards.length && uiCards.length === getPack(PACK)!.cardCount);
    check("NUEVA según la BD (0 copias de esa definición fuera de esta apertura)", uiCards.filter((c) => c.status === "new").length === expectedNew, `ui ${uiCards.filter((c) => c.status === "new").length} · bd ${expectedNew}`);
    check("delta de colección = BD: únicas antes de la apertura → ahora", !!collection && collection.before === uniqueBefore && collection.after === uniqueNow, `ui ${collection?.before}→${collection?.after} · bd ${uniqueBefore}→${uniqueNow}`);
    check("el resumen dice que el sobre ya se abrió (no uno nuevo)", /El sobre ya se abrió correctamente/.test(text));
    check("sin valor en monedas ni venta", !/🪙|Valor total|Vender/i.test(text));

    // ── 3 · recarga en el resumen recuperado
    await tab.goto(`${BASE}/abrir/${PACK}`, 2500);
    const again = await waitFor(tab, `${PHASE} === "summary" && document.querySelector('[data-testid="pack-summary"]')?.getAttribute("data-recovered") === "true"`, 20000);
    const againUids = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => e.getAttribute("data-uid"))`);
    check("segunda recarga: el mismo resumen, sin otra apertura", again && JSON.stringify(againUids) === JSON.stringify(storedUids));
    await sleep(1000);
    await shot(tab, "05-reload-recovered-again");

    // ── 6 · ficha
    await tab.js(`document.querySelector('[data-testid="summary-view-collection"]')?.click()`);
    const detail = await waitFor(tab, `location.pathname.startsWith("/coleccion/carta/") && document.querySelector('[data-testid="card-detail"]')?.getAttribute("data-owned") === "true"`, 25000);
    const path = await tab.js<string>("location.pathname");
    check("«Ver en mi colección» → ficha real, poseída, de una carta de este sobre", detail && uiCards.some((c) => path === `/coleccion/carta/${encodeURIComponent(c.cardId)}`), path);
    await sleep(1500);
    await shot(tab, "06-card-detail");
    const errs = tab.takeErrors().filter((e) => !/players\/.*\.(png|webp)|teams\/.*\.(png|webp)|flagcdn|404|Failed to load resource/i.test(e));
    check("sin errores de consola propios", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally {
    await b.close();
  }

  // ── 4 · reintento por la API con la MISMA clave
  const retry = await api(token, { action: "open", packId: PACK, ref: gesture });
  check("reintento misma clave: 200 y `repeated`", retry.status === 200 && retry.json?.repeated === true, `status=${retry.status}`);
  check("reintento: mismas cartas (uid, carta, serial)", JSON.stringify((retry.json?.opened ?? []).map((c: any) => [c.uid, c.cardId, c.serial ?? ""])) === JSON.stringify(dbRows.length ? storedUids.map((u) => { const r = dbRows.find((x) => x.uid === u)!; return [u, r.cardId, r.serial ? Number(r.serial) : ""]; }) : []));

  // ── 5 · seguridad
  const injected = await api(token, { action: "open", packId: PACK, ref: gesture, cardId: "aspas__gold", serial: 1, rarity: "legendary" });
  check("campos elegidos por el cliente (carta, serial, rareza) → 400", injected.status === 400, `status=${injected.status}`);
  const otherPack = await api(token, { action: "open", packId: "premium", ref: gesture });
  check("la clave de este sobre usada con otro sobre → 409 (no reutiliza ni filtra cartas)", otherPack.status === 409, `status=${otherPack.status}`);

  const post = fingerprint();
  const diff = pre.split("\n").filter((l, i) => l !== post.split("\n")[i]);
  check("huella QA idéntica tras recuperación, recargas y reintentos (+0 en todo)", pre === post, diff.join(" ; "));
  log(`\nverificación real sin consumir: ${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
