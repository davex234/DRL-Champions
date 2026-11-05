/**
 * FASE 37 · SMOKE REAL LOCAL DE LA COLECCIÓN (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase37-live-smoke.ts <credsFile>
 *
 * App LOCAL (`next start`, :3005) → API real → Supabase del VPS por túnel SSH, con la cuenta QA y el formulario real de
 * /cuenta. SIN ECONOMÍA: no compra, no abre sobres, no reclama, no juega. Única escritura: vitrina (añadir una copia y
 * revertir con la versión devuelta). La hoja «Añadir al equipo» se abre y se cierra sin guardar. Nunca imprime correo,
 * contraseña ni tokens. Capturas en docs/product/qa/fase37/real/.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { CARDS, getCard, getPlayer } from "../src/data/catalog";
import { buildCollectionSnapshot, cardHref, type OwnedInstanceFact } from "../src/domain/collection/room";
import { OWNERSHIP_LABEL } from "../src/domain/collection/query";

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
const OUT = process.env.SMOKE_OUT ? join(process.cwd(), process.env.SMOKE_OUT) : join(process.cwd(), "docs", "product", "qa", "fase37", "real");
mkdirSync(OUT, { recursive: true });
const [credsFile] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
const PROFILE = join(credsFile, "..", "f37-chrome-profile");
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);
let shot = 0;
const snap = async (tab: Tab, name: string) => { await tab.shot(join(OUT, `real-${String(++shot).padStart(2, "0")}-${name}.png`)); };

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(250); }
  return false;
};

async function apiToken(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error("login QA falló");
  return data.session.access_token;
}

async function login(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 3500);
  const signedIn = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión|salir/i.test(document.body.innerText))()`;
  if (!(await tab.js<boolean>(signedIn))) {
    const filled = await tab.js<boolean>(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const e = document.querySelector('input[type="email"]'); const p = document.querySelector('input[type="password"]');
      if (!e || !p) return false; set(e, ${esc(creds.email)}); set(p, ${esc(creds.password)}); return true; })()`);
    log(`login_form_found=${filled}`);
    await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
    await waitFor(tab, signedIn, 20000);
  }
  log(`session_via_real_form=${await tab.js<boolean>(signedIn)}`);
}

async function api(token: string | null, path = "/api/game/collection", init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: r.status, cache: r.headers.get("cache-control"), json, text };
}

const post = (token: string | null, body: unknown, path = "/api/game/collection") => api(token, path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

const ROOM_READY = `(() => { const r = document.querySelector('[data-testid="collection-room"]'); const h = document.querySelector('[data-testid="collection-hero"]'); return !!r && r.getAttribute("data-access") === "server" && !!h && /\\d+\\s*\\/\\s*\\d+/.test(h.innerText) && !/Leyendo/.test(h.innerText); })()`;
const ALBUM_COUNT = `(() => { const p = document.querySelector('[data-testid="collection-album"] [aria-live]'); return p ? Number((p.textContent || "").replace(/\\D+/g, "")) : -1; })()`;
const DETAIL_READY = (owned: boolean) => `(() => { const d = document.querySelector('[data-testid="card-detail"]'); return !!d && d.getAttribute("data-owned") === ${esc(String(owned))} && !/Leyendo tu colección/.test(d.innerText); })()`;

async function main() {
  const token = await apiToken();

  // ── API real
  const me = await api(token);
  const d = me.json?.data ?? me.json;
  const instances: OwnedInstanceFact[] = d?.instances ?? [];
  const facts = { instances, favorites: d?.favorites ?? null, showcaseUids: d?.showcase?.uids ?? null, decks: d?.decks ?? null };
  const view = buildCollectionSnapshot(CARDS, getPlayer, facts);
  log(`api_collection status=${me.status} cache=${me.cache} copies=${instances.length} unique=${view.uniqueOwned} catalog=${view.catalogTotal} pct=${view.completionPct} dups=${view.duplicates} serials=${view.serials.owned} unknown=${view.unknownInstances} truncated=${d?.truncated}`);
  log(`api_personal favorites=${facts.favorites === null ? "null (0052 no aplicada)" : facts.favorites.length} showcase=${JSON.stringify(d?.showcase ? { n: d.showcase.uids.length, version: d.showcase.version } : null)} decks=${JSON.stringify((facts.decks ?? []).map((x: any) => ({ name: x.name, active: x.active, size: x.cardUids.length })))}`);
  const leaks = [creds.email, "is_admin", "\"email\"", "\"credits\"", "obtained_at", "\"origin\"", "user_id"].filter((k) => me.text.includes(k));
  log(`api_leaks=${leaks.length === 0 ? "none" : leaks.map((k) => (k === creds.email ? "<own-email>" : k)).join(",")}`);
  const again = await api(token);
  log(`api_second_read status=${again.status} same_copies=${(again.json?.data ?? again.json)?.instances?.length === instances.length}`);
  log(`api_anonymous status=${(await api(null)).status}`);
  const userParam = await api(token, `/api/game/collection?userId=${creds.userId}`);
  log(`api_userId_param status=${userParam.status} code=${userParam.json?.code}`);
  log(`api_bad_token status=${(await api("not-a-token")).status}`);
  const extra = await post(token, { action: "favorite", cardId: CARDS[0].id, favorite: true, userId: "00000000-0000-4000-8000-000000000000" });
  log(`api_post_extra_field status=${extra.status} code=${extra.json?.code}`);
  const traversal = await post(token, { action: "favorite", cardId: "../../etc/passwd", favorite: true });
  log(`api_post_path_traversal status=${traversal.status} code=${traversal.json?.code}`);
  const huge = await post(token, JSON.stringify({ action: "favorite", cardId: "x".repeat(5000), favorite: true }));
  log(`api_post_oversized status=${huge.status}`);
  const unknownCard = await post(token, { action: "favorite", cardId: "nadie__gold", favorite: true });
  log(`api_post_unknown_card status=${unknownCard.status} code=${unknownCard.json?.code}`);
  const anonPost = await post(null, { action: "favorite", cardId: CARDS[0].id, favorite: true });
  log(`api_post_anonymous status=${anonPost.status}`);

  for (const path of ["/api/game/meta", "/api/game/player?me=1"]) {
    const r = await api(token, path);
    const m = r.text.match(/"packsOpened":(\d+|null)/);
    log(`packs_opened ${path} status=${r.status} packsOpened=${m ? m[1] : "—"}`);
  }

  const bestId = view.best?.cardId ?? null;
  const ownedBest = bestId ? getCard(bestId)! : null;
  const activeDeck = (facts.decks ?? []).find((x: any) => x.active);
  const deckCardId = activeDeck ? instances.find((i) => i.uid === activeDeck.cardUids[0])?.cardId ?? null : null;
  const unowned = CARDS.find((c) => !view.byCard.has(c.id))!;
  const searchNick = ownedBest ? getPlayer(ownedBest.playerId)!.nick : "";

  // ── Navegador real
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  try {
    await login(tab);
    for (const [w, h] of [[1440, 900], [1024, 800], [390, 844]] as const) {
      await tab.resize(w, h);
      const started = Date.now();
      await tab.goto(`${BASE}/coleccion`, 1500);
      const ready = await waitFor(tab, ROOM_READY, 25000);
      const info = await tab.js<any>(`(() => ({
        hero: document.querySelector('[data-testid="collection-hero"]')?.innerText.replace(/\\s+/g, " ").slice(0, 220),
        album: ${ALBUM_COUNT}, cards: document.querySelectorAll("[data-card]").length,
        overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        book: !!document.querySelector('[data-testid="collection-book"]'), discovery: !!document.querySelector('[data-testid="collection-discovery"]'),
      }))()`);
      log(`coleccion_${w} ready=${ready} in=${((Date.now() - started) / 1000).toFixed(1)}s ${JSON.stringify(info)}`);
      await sleep(2500);
      await snap(tab, `coleccion-hero-${w}`);
      if (w === 1440) { await tab.resize(1440, 4200); await sleep(700); await snap(tab, "coleccion-full-1440"); await tab.resize(1440, 900); }
    }
    await tab.resize(1440, 900); // el resto del recorrido (y sus capturas «-1440») a escritorio

    // total visible = API
    const heroText = await tab.js<string>(`document.querySelector('[data-testid="collection-hero"]')?.innerText ?? ""`);
    log(`hero_matches_api=${heroText.includes(String(view.uniqueOwned)) && heroText.includes(String(view.catalogTotal))}`);

    // búsqueda de un jugador propio
    await tab.goto(`${BASE}/coleccion`, 1500); await waitFor(tab, ROOM_READY, 25000);
    await tab.js(`(() => { const el = document.querySelector('[data-testid="collection-search"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${esc(searchNick)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(1200);
    const search = await tab.js<any>(`({ url: location.search, album: ${ALBUM_COUNT}, owned: document.querySelectorAll('[data-owned="true"][data-card]').length })`);
    log(`search_owned_player url_has_q=${/[?&]q=/.test(search.url)} results=${search.album} owned_in_grid=${search.owned}`);
    await tab.js(SCROLL_ALBUM); await sleep(500);
    await snap(tab, "search-owned-player-1440");

    // filtro «Poseídas»
    await tab.goto(`${BASE}/coleccion`, 1500); await waitFor(tab, ROOM_READY, 25000);
    await tab.js(`[...document.querySelectorAll('[data-testid="collection-album"] button')].find((x) => x.textContent.trim() === ${esc(OWNERSHIP_LABEL.owned)})?.click()`);
    await sleep(1200);
    const owned = await tab.js<any>(`({ url: location.search, album: ${ALBUM_COUNT}, unowned: document.querySelectorAll('[data-owned="false"][data-card]').length })`);
    log(`filter_owned url=${owned.url} results=${owned.album} equals_api_unique=${owned.album === view.uniqueOwned} unowned_in_grid=${owned.unowned}`);
    await tab.js(SCROLL_ALBUM); await sleep(500);
    await snap(tab, "filter-owned-1440");
    await tab.js(`document.querySelector('[data-testid="collection-filters-toggle"]')?.click()`); await sleep(700);
    await snap(tab, "filters-panel-1440");
    await tab.goto(`${BASE}/coleccion${owned.url}`, 1500); await waitFor(tab, ROOM_READY, 25000); await sleep(800);
    log(`url_state_survives_reload results=${await tab.js<number>(ALBUM_COUNT)}`);

    // ficha de la carta propia de mayor OVR
    if (ownedBest) {
      await tab.goto(`${BASE}${cardHref(ownedBest.id)}`, 1500);
      const ok = await waitFor(tab, DETAIL_READY(true), 25000);
      const det = await tab.js<any>(`(() => { const c = document.querySelector('[data-testid="card-copies"]'); return {
        h1: document.querySelector('[data-testid="card-detail"] h1')?.textContent, copiesText: c?.innerText.replace(/\\s+/g, " ").slice(0, 260),
        serials: (c?.innerText.match(/#\\d+\\/\\d+/g) ?? []), favorite: document.querySelector('[data-testid="card-favorite"]')?.textContent?.trim(),
        favoriteDisabled: document.querySelector('[data-testid="card-favorite"]')?.hasAttribute("disabled"),
        availability: document.querySelector('[data-testid="card-availability"]')?.innerText.replace(/\\s+/g, " ").slice(0, 160),
      }; })()`);
      log(`detail_best ready=${ok} ${JSON.stringify(det)} api_copies=${view.byCard.get(ownedBest.id)?.count}`);
      await sleep(1500);
      await snap(tab, "detail-best-owned-1440");
      await tab.js(`document.querySelector('[data-testid="card-copies"]')?.scrollIntoView({ block: "start" })`); await sleep(500);
      await snap(tab, "detail-copies-serials-1440");
      await tab.js(`window.scrollTo(0, 0); document.querySelector('[data-testid="card-flip"]')?.click()`); await sleep(1200);
      log(`flip aria_pressed=${await tab.js<string>(`document.querySelector('[data-testid="card-flip"]')?.getAttribute("aria-pressed")`)}`);
      await snap(tab, "detail-flip-back-1440");
      await tab.js(`document.querySelector('[data-testid="card-flip"]')?.click()`); await sleep(600);

      // comparar
      await tab.js(`document.querySelector('[data-testid="card-compare-link"]')?.click()`);
      await waitFor(tab, `!!document.querySelector('[data-testid="card-compare"]')`, 15000);
      await sleep(800);
      await tab.js(`[...document.querySelectorAll('[data-testid="card-compare"] button, [data-testid="card-compare"] a')].find((x) => /Tuya/.test(x.textContent) && !x.closest('[data-testid="compare-table"]'))?.click()`);
      const table = await waitFor(tab, `!!document.querySelector('[data-testid="compare-table"]')`, 10000);
      log(`compare url=${await tab.js<string>("location.pathname + location.search")} table=${table} rows=${await tab.js<number>(`document.querySelectorAll('[data-testid="compare-table"] tr').length`)} verdict_free=${await tab.js<boolean>(`/Sin veredicto/.test(document.body.innerText)`)}`);
      await tab.js(`document.querySelector('[data-testid="compare-table"]')?.scrollIntoView({ block: "center" })`); await sleep(500);
      await snap(tab, "compare-own-cards-1440");
    }

    // uso en equipos + hoja «Añadir al equipo» (se cierra sin guardar)
    if (deckCardId) {
      await tab.goto(`${BASE}${cardHref(deckCardId)}`, 1500);
      await waitFor(tab, DETAIL_READY(true), 25000); await sleep(1000);
      log(`deck_usage text=${JSON.stringify(await tab.js<string>(`(document.body.innerText.match(/Usada en[^\\n.]*\\.|No la usas en ningún equipo\\./) ?? [""])[0]`))} marks=${JSON.stringify(await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="card-copies"] li')].map((li) => li.innerText.replace(/\\s+/g, " ").slice(0, 90))`))}`);
      await tab.js(`document.querySelector('[data-testid="card-copies"]')?.scrollIntoView({ block: "start" })`); await sleep(500);
      await snap(tab, "detail-deck-usage-1440");
      await tab.js(`window.scrollTo(0, 0); document.querySelector('[data-testid="card-add-deck"]')?.click()`);
      const sheet = await waitFor(tab, `!!document.querySelector('[role="dialog"][aria-labelledby="add-to-deck-title"]')`, 10000);
      await sleep(1500);
      log(`add_to_deck_sheet_open=${sheet}`);
      await snap(tab, "add-to-deck-sheet-1440");
      await tab.js(`document.querySelector('[role="dialog"] button[aria-label="Cerrar"]')?.click()`); await sleep(600);
      log(`add_to_deck_sheet_closed=${await tab.js<boolean>(`!document.querySelector('[role="dialog"][aria-labelledby="add-to-deck-title"]')`)}`);
    }

    // vitrina: añadir y revertir
    const before = (await api(token)).json;
    const sBefore = (before?.data ?? before)?.showcase;
    if (process.env.SKIP_SHOWCASE === "1") {
      log(`showcase_add SKIPPED por SKIP_SHOWCASE=1 (vitrina=${JSON.stringify(sBefore)})`);
    } else if (ownedBest && sBefore && sBefore.uids.length < 3) {
      await tab.goto(`${BASE}${cardHref(ownedBest.id)}`, 1500);
      await waitFor(tab, DETAIL_READY(true), 25000); await sleep(800);
      await tab.js(`[...document.querySelectorAll('[data-testid="card-copies"] button')].find((x) => /Poner en vitrina/.test(x.textContent))?.click()`);
      const added = await waitFor(tab, `/Añadida a tu vitrina\\./.test(document.body.innerText)`, 15000);
      await sleep(1200);
      await snap(tab, "showcase-added-1440");
      await tab.goto(`${BASE}${cardHref(ownedBest.id)}`, 1500);
      await waitFor(tab, DETAIL_READY(true), 25000); await sleep(1200);
      // innerText aplica text-transform (MAYÚSCULAS): comparar sin distinguir mayúsculas.
      const shown = await tab.js<boolean>(`/En vitrina/i.test(document.querySelector('[data-testid="card-copies"]')?.innerText ?? "")`);
      const mid = (await api(token)).json; const sMid = (mid?.data ?? mid)?.showcase;
      log(`showcase_add ui_message=${added} after_refresh_marked=${shown} api=${JSON.stringify({ before: { n: sBefore.uids.length, v: sBefore.version }, after: { n: sMid?.uids.length, v: sMid?.version } })}`);
      await snap(tab, "showcase-after-refresh-1440");
      const revert = await post(token, { action: "set_showcase", cardUids: sBefore.uids, expectedVersion: sMid?.version ?? null }, "/api/game/player");
      const end = (await api(token)).json; const sEnd = (end?.data ?? end)?.showcase;
      log(`showcase_revert status=${revert.status} restored=${JSON.stringify(sEnd?.uids) === JSON.stringify(sBefore.uids)} version=${sEnd?.version}`);
    } else {
      log(`showcase_add SKIPPED (vitrina=${JSON.stringify(sBefore)})`);
    }

    // carta no conseguida y carta inexistente
    await tab.goto(`${BASE}${cardHref(unowned.id)}`, 1500);
    await waitFor(tab, DETAIL_READY(false), 25000); await sleep(1200);
    log(`detail_unowned no_conseguida=${await tab.js<boolean>(`/No conseguida/i.test(document.body.innerText)`)} serials=${await tab.js<number>(`(document.querySelector('[data-testid="card-detail"]')?.innerText.match(/#\\d+\\/\\d+/g) ?? []).length`)} availability=${await tab.js<boolean>(`!!document.querySelector('[data-testid="card-availability"]')`)}`);
    await snap(tab, "detail-unowned-1440");
    await tab.goto(`${BASE}/coleccion/carta/..%2F..%2Fetc%2Fpasswd`, 4000);
    log(`detail_invalid not_found=${await tab.js<boolean>(`!!document.querySelector('[data-testid="card-not-found"]')`)}`);

    // recargar la sala: todo igual
    await tab.goto(`${BASE}/coleccion`, 1500); await waitFor(tab, ROOM_READY, 25000); await sleep(800);
    log(`refresh album=${await tab.js<number>(ALBUM_COUNT)} storage_keys_with_favorite=${(await tab.js<string[]>("Object.keys(localStorage)")).filter((k) => /favor/i.test(k)).length}`);
    const errs = tab.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|Failed to load resource/i.test(e));
    log(`console_errors=${errs.length}`);
    for (const e of errs.slice(0, 10)) log(`  ✗ ${e.slice(0, 200)}`);
  } finally {
    await b.close();
  }

  // ── Anónimo (perfil limpio): definición pública sí, colección privada no
  const a = await launch({ width: 1440, height: 900 });
  try {
    await a.tab.goto(`${BASE}${cardHref(CARDS[0].id)}`, 1500);
    await waitFor(a.tab, `!!document.querySelector('[data-testid="card-detail"]')`, 25000); await sleep(1500);
    const anonInfo = await a.tab.js<any>(`({ login: /Inicia sesión/.test(document.body.innerText), favorite: !!document.querySelector('[data-testid="card-favorite"]'), copies: !!document.querySelector('[data-testid="card-copies"]'), serials: (document.body.innerText.match(/#\\d+\\/\\d+/g) ?? []).length })`);
    log(`anon_detail ${JSON.stringify(anonInfo)}`);
    await snap(a.tab, "anon-public-card-1440");
    await a.tab.goto(`${BASE}/coleccion`, 6000);
    log(`anon_room access=${await a.tab.js<string>(`document.querySelector('[data-testid="collection-room"]')?.getAttribute("data-access") ?? "?"`)}`);
    await snap(a.tab, "anon-collection-1440");
  } finally {
    await a.close();
  }
}

const SCROLL_ALBUM = `(() => { document.querySelector('[data-testid="collection-album"]')?.scrollIntoView({ block: "start" }); window.scrollBy(0, -12); })()`;

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
