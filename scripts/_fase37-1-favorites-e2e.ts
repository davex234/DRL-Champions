/**
 * FASE 37.1 · E2E REAL DE FAVORITOS (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase37-1-favorites-e2e.ts <credsFile> <fingerprintSqlFile>
 *
 * Navegador real → app local (`next start` :3005) → API → servidor → BD del VPS (túnel SSH), cuenta QA existente y
 * formulario real de /cuenta. Tras cada paso consulta la BD por SSH (solo lectura): filas de favoritos de ESA carta y
 * de ese usuario. Huella de la cuenta QA antes/después (cartas, créditos, sobres, pase, equipos, vitrina, rating…).
 * Única escritura: favoritos (marcar y desmarcar). Nunca imprime correo, contraseña, tokens ni el id completo.
 * Capturas en docs/product/qa/fase37-1/.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { CARDS, getCard, getPlayer } from "../src/data/catalog";
import { buildCollectionSnapshot, cardHref, isValidCardId, type OwnedInstanceFact } from "../src/domain/collection/room";

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
const OUT = join(process.cwd(), "docs", "product", "qa", "fase37-1");
mkdirSync(OUT, { recursive: true });
const [credsFile, fingerprintFile] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
if (!/^[0-9a-f-]{36}$/.test(creds.userId)) throw new Error("userId QA no válido");
const USER_SHORT = `${creds.userId.slice(0, 8)}…`;
const PROFILE = join(credsFile, "..", "f371-chrome-profile");
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };

/* ───────────── BD por SSH (solo lectura) ───────────── */

function psql(sql: string): string {
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}
function favRows(cardId?: string): number {
  if (cardId && !isValidCardId(cardId)) throw new Error("cardId no válido");
  const where = cardId ? ` and card_id = '${cardId}'` : "";
  return Number(psql(`select count(*) from public.user_card_favorites where user_id = '${creds.userId}'${where};`));
}
const fingerprint = () => psql(readFileSync(fingerprintFile, "utf8"));

/* ───────────── app ───────────── */

async function apiToken(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error("login QA falló");
  return data.session.access_token;
}
async function api(token: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}/api/game/collection`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: r.status, json: json?.data ?? json, text };
}
const setFav = (token: string, cardId: string, favorite: boolean) => api(token, { method: "POST", body: JSON.stringify({ action: "favorite", cardId, favorite }) });

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(250); }
  return false;
};
const waitDb = async (cardId: string, want: number, ms = 12000) => {
  for (let i = 0; i < ms / 1000; i++) { const n = favRows(cardId); if (n === want) return n; await sleep(1000); }
  return favRows(cardId);
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

const FAV_READY = (owned: boolean) => `(() => {
  const d = document.querySelector('[data-testid="card-detail"]'); const b = document.querySelector('[data-testid="card-favorite"]');
  return !!d && d.getAttribute("data-owned") === ${esc(String(owned))} && !!b && !b.hasAttribute("disabled");
})()`;
const PRESSED = `document.querySelector('[data-testid="card-favorite"]')?.getAttribute("aria-pressed")`;
const LABEL = `document.querySelector('[data-testid="card-favorite"]')?.getAttribute("aria-label")`;
const SERIALS = `(document.querySelector('[data-testid="card-detail"]')?.innerText.match(/#\\d+\\/\\d+/g) ?? []).length`;
const ROOM_READY = `(() => { const r = document.querySelector('[data-testid="collection-room"]'); const h = document.querySelector('[data-testid="collection-hero"]'); return !!r && r.getAttribute("data-access") === "server" && !!h && /\\d+\\s*\\/\\s*\\d+/.test(h.innerText); })()`;
const ALBUM_COUNT = `(() => { const p = document.querySelector('[data-testid="collection-album"] [aria-live]'); return p ? Number((p.textContent || "").replace(/\\D+/g, "")) : -1; })()`;

async function openDetail(tab: Tab, cardId: string, owned: boolean) {
  await tab.goto(`${BASE}${cardHref(cardId)}`, 1500);
  const ready = await waitFor(tab, FAV_READY(owned), 25000);
  await sleep(900);
  return ready;
}
async function clickFavorite(tab: Tab, want: "true" | "false") {
  await tab.js(`document.querySelector('[data-testid="card-favorite"]')?.click()`);
  return waitFor(tab, `${PRESSED} === ${esc(want)} && !document.querySelector('[data-testid="card-favorite"]')?.hasAttribute("disabled")`, 10000);
}
const shot = async (tab: Tab, name: string) => { await sleep(600); await tab.shot(join(OUT, name)); };

async function main() {
  const token = await apiToken();
  const me = await api(token);
  const instances: OwnedInstanceFact[] = me.json?.instances ?? [];
  const snap = buildCollectionSnapshot(CARDS, getPlayer, { instances, favorites: me.json?.favorites ?? null, showcaseUids: me.json?.showcase?.uids ?? null, decks: me.json?.decks ?? null });
  const owned = getCard(snap.best!.cardId)!;
  const unowned = CARDS.find((c) => !snap.byCard.has(c.id) && c.playerId !== owned.playerId)!;
  log(`qa_user=${USER_SHORT} copies=${instances.length} unique=${snap.uniqueOwned} owned_card=${owned.id} unowned_card=${unowned.id}`);
  check("API: favoritos disponibles (0052 aplicada, no 503)", me.status === 200 && Array.isArray(me.json?.favorites), `status=${me.status} favorites=${JSON.stringify(me.json?.favorites)}`);

  const fpBefore = fingerprint();
  const cardsBefore = Number(psql(`select count(*) from public.user_cards where user_id = '${creds.userId}';`));
  check("BD antes: 0 favoritos de la cuenta QA", favRows() === 0);
  check(`BD antes: 0 filas para ${owned.id}`, favRows(owned.id) === 0);

  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  try {
    check("login por el formulario real", await login(tab));

    // 01 · antes: filtro Favoritas vacío
    await tab.goto(`${BASE}/coleccion?fav=1`, 1500);
    await waitFor(tab, ROOM_READY, 25000); await sleep(2500);
    const before = await tab.js<number>(ALBUM_COUNT);
    check("colección: filtro Favoritas vacío antes", before === 0, `resultados=${before}`);
    await tab.js(`document.querySelector('[data-testid="collection-album"]')?.scrollIntoView({ block: "start" })`);
    await shot(tab, "01-favorites-before.png");

    // 02 · ficha de una carta propia
    check("ficha: botón de favorito activo (disponible)", await openDetail(tab, owned.id, true));
    check("ficha: estado inicial no favorita", (await tab.js<string>(PRESSED)) === "false" && (await tab.js<string>(LABEL)) === "Añadir a favoritos");
    await shot(tab, "02-card-detail.png");

    // 03 · añadir
    check("clic «Añadir a favoritos» → aria-pressed=true", await clickFavorite(tab, "true"));
    check("BD tras añadir: exactamente 1 fila", (await waitDb(owned.id, 1)) === 1);
    check("etiqueta accesible pasa a «Quitar de favoritos»", (await tab.js<string>(LABEL)) === "Quitar de favoritos");
    await shot(tab, "03-favorite-added.png");

    // 04 · recargar
    check("recarga completa: sigue favorita", await openDetail(tab, owned.id, true) && (await tab.js<string>(PRESSED)) === "true");
    check("BD tras recargar: sigue 1", favRows(owned.id) === 1);
    await shot(tab, "04-after-refresh.png");

    // duplicado por el contrato de la API
    const dup = await setFav(token, owned.id, true);
    check("añadir otra vez por la API → 200 idempotente", dup.status === 200, `status=${dup.status}`);
    check("BD tras duplicado: sigue 1 (no 2)", favRows(owned.id) === 1 && favRows() === 1);

    // 05 · filtro Favoritas
    await tab.goto(`${BASE}/coleccion?fav=1`, 1500);
    await waitFor(tab, ROOM_READY, 25000);
    await waitFor(tab, `${ALBUM_COUNT} === 1`, 15000);
    const favIds = await tab.js<string[]>(`[...document.querySelectorAll('[data-card]')].map((e) => e.getAttribute("data-card"))`);
    check("filtro Favoritas: aparece exactamente esa carta", favIds.length === 1 && favIds[0] === owned.id, JSON.stringify(favIds));
    check("sala: «Tus favoritas» la muestra", await tab.js<boolean>(`!!document.querySelector('[data-testid="collection-discovery"] a[href="${cardHref(owned.id)}"]')`));
    await tab.js(`document.querySelector('[data-testid="collection-album"]')?.scrollIntoView({ block: "start" })`);
    await shot(tab, "05-favorites-filter.png");

    // 06 · quitar
    await openDetail(tab, owned.id, true);
    check("clic «Quitar de favoritos» → aria-pressed=false", await clickFavorite(tab, "false"));
    check("BD tras quitar: 0 filas", (await waitDb(owned.id, 0)) === 0);
    await shot(tab, "06-favorite-removed.png");

    // 07 · recargar tras quitar
    check("recarga completa: ya no es favorita", await openDetail(tab, owned.id, true) && (await tab.js<string>(PRESSED)) === "false");
    const del2 = await setFav(token, owned.id, false);
    check("quitar otra vez por la API → 200, estado final 0", del2.status === 200 && favRows(owned.id) === 0, `status=${del2.status}`);
    await shot(tab, "07-after-remove-refresh.png");
    await tab.goto(`${BASE}/coleccion?fav=1`, 1500);
    await waitFor(tab, ROOM_READY, 25000); await sleep(2500);
    check("filtro Favoritas vuelve a 0", (await tab.js<number>(ALBUM_COUNT)) === 0);

    // 08-10 · carta NO poseída
    check("ficha no poseída: favoritos disponibles, sin serial", await openDetail(tab, unowned.id, false) && (await tab.js<number>(SERIALS)) === 0);
    check("clic en carta no poseída → favorita", await clickFavorite(tab, "true"));
    check(`BD: 1 fila para ${unowned.id}`, (await waitDb(unowned.id, 1)) === 1);
    await shot(tab, "08-unowned-favorite.png");
    const reUnowned = await openDetail(tab, unowned.id, false);
    const ownedAttr = await tab.js<string>(`document.querySelector('[data-testid="card-detail"]')?.getAttribute("data-owned")`);
    check("recarga: sigue favorita, sigue «no conseguida», sin serial ni copias", reUnowned && (await tab.js<string>(PRESSED)) === "true" && ownedAttr === "false" && (await tab.js<number>(SERIALS)) === 0 && (await tab.js<boolean>(`/No conseguida/i.test(document.body.innerText)`)));
    const cardsMid = Number(psql(`select count(*) from public.user_cards where user_id = '${creds.userId}';`));
    const unownedCopies = Number(psql(`select count(*) from public.user_cards where user_id = '${creds.userId}' and card_id = '${unowned.id}';`));
    check("favorito no poseído NO crea propiedad (user_cards igual, 0 copias de esa carta)", cardsMid === cardsBefore && unownedCopies === 0, `user_cards ${cardsBefore}→${cardsMid}, copias=${unownedCopies}`);
    await shot(tab, "09-unowned-after-refresh.png");
    check("quitar la no poseída", await clickFavorite(tab, "false"));
    check("BD: 0 filas para la no poseída", (await waitDb(unowned.id, 0)) === 0);
    check("recarga: ya no es favorita", await openDetail(tab, unowned.id, false) && (await tab.js<string>(PRESSED)) === "false");
    await shot(tab, "10-unowned-removed.png");

    const storageFav = (await tab.js<string[]>("Object.keys(localStorage)")).filter((k) => /favor/i.test(k)).length;
    check("sin localStorage de favoritos", storageFav === 0, `claves=${storageFav}`);
    const errs = tab.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|Failed to load resource/i.test(e));
    check("sin errores de consola propios", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally {
    await b.close();
  }

  const end = await api(token);
  check("API final: favoritos []", end.status === 200 && Array.isArray(end.json?.favorites) && end.json.favorites.length === 0);
  check("BD final: 0 favoritos de la cuenta QA", favRows() === 0);
  const fpAfter = fingerprint();
  const diff = fpBefore.split("\n").filter((l, i) => l !== fpAfter.split("\n")[i]);
  check("huella QA idéntica (cartas, créditos, sobres, pase, equipos, vitrina, rating, logros, cosméticos)", fpBefore === fpAfter, diff.join(" ; "));
  log(`fingerprint:\n${fpAfter.split("\n").map((l) => `    ${l}`).join("\n")}`);
  log(`\nE2E favoritos: ${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
