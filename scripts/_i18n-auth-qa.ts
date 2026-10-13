/**
 * QA AUTENTICADA · I18N (instrumento, fuera de CI y de la release). Solo contra el stack de QA aislado.
 *
 *   QA_ENV=<qa.env> BASE_URL=http://127.0.0.1:3027 npx tsx scripts/_i18n-auth-qa.ts [es,en,de,it]
 *
 * Por idioma, con sesión REAL de una cuenta QA sintética y por la interfaz: selector de idioma → inicio de sesión →
 * idioma guardado en la cuenta → otro «dispositivo» lo hereda → tienda (precios y probabilidades) → compra → apertura
 * → WALKOUT → colección e inventario → crafteo de sobres → perfil → administración (cuenta QA admin).
 * Todo lo económico se compara con lo que dice el SERVIDOR y con la foto del español: el idioma no puede cambiar
 * precios, probabilidades, resultados ni identificadores.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BASE, LOCALES, api, bodyText, chooseLocale, clickTid, clickText, collect, goto, lang, loginUi, open, probe, q, sleep, token, waitFor, type Client, type Loc } from "./_i18n-auth-lib";

const OUT = join(process.cwd(), "docs/product/qa/i18n-auth");
const RAW = join(process.cwd(), "logs/i18n/rc");
mkdirSync(RAW, { recursive: true });
const wanted = (process.argv[2] ?? LOCALES.join(",")).split(",") as Loc[];
const digits = (s: string | null | undefined) => (s ?? "").replace(/[^\d]/g, "");
interface Row { locale: string; id: string; ok: boolean; detail: string }
const rows: Row[] = [];
let L: Loc = "es";
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ locale: L, id, ok, detail: (d ?? "").slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} · ${L} · ${id}${d ? ` — ${d.slice(0, 260)}` : ""}`); };
const shot = async (c: Client, name: string) => { const dir = join(OUT, L); mkdirSync(dir, { recursive: true }); await c.tab.shot(join(dir, `${name}.png`)).catch(() => null); };

/** Foto de pantalla: idioma, restos de español, claves, desbordes. `allow` = líneas que son contenido (nicks, equipos). */
async function screen(c: Client, name: string, opts: { allowSpanish?: RegExp } = {}) {
  const p = await probe(c);
  collect(c, name);
  await shot(c, name);
  const spanish = L === "es" ? [] : p.spanish.filter((l) => !(opts.allowSpanish?.test(l)));
  check(`${name} · idioma`, p.lang === L, p.lang);
  check(`${name} · sin restos de español`, spanish.length === 0, spanish.slice(0, 8));
  check(`${name} · sin claves visibles`, p.keys.length === 0, p.keys);
  check(`${name} · sin desbordes ni textos cortados`, p.overflow <= 1 && p.clipped.length === 0, { overflow: p.overflow, clipped: p.clipped.slice(0, 6) });
  return p;
}

const state = async (access: string) => (await api(access, "/api/game/state")).json as { credits: number; unopenedPacks: Record<string, number>; ownedCards: { uid: string; cardId: string }[]; packsOpened: number };

interface StoreShot { prices: Record<string, string>; odds: Record<string, Record<string, string>>; iconLines: Record<string, string> }
const BASELINE_FILE = join(RAW, "auth-baseline-es.json");

async function storeSnapshot(c: Client): Promise<StoreShot> {
  await goto(c, "/tienda", 2500);
  await waitFor(c.tab, q("store-product"), 20000);
  const prices = await c.tab.js<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('[data-testid="store-product"]')].map((e) => [e.getAttribute('data-product-id'), (e.querySelector('[data-testid="store-price"]')?.innerText ?? '').replace(/[^\\d]/g, '')]))`);
  const odds: StoreShot["odds"] = {}; const iconLines: StoreShot["iconLines"] = {};
  for (const id of ["estandar", "premium", "oro", "masters", "champions", "icon-single", "icon"]) {
    await c.tab.js(`(() => { const a = document.querySelector('[data-product-id="pack:${id}"]'); const b = a && [...a.querySelectorAll('button,a')].pop(); b && b.click(); })()`);
    if (!(await waitFor(c.tab, q("store-purchase-modal"), 12000))) { odds[id] = { ERROR: "sin modal" }; continue; }
    await sleep(500);
    odds[id] = await c.tab.js<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('[data-testid="store-purchase-modal"] [data-testid="odds-row"]')].map((e) => [e.getAttribute('data-key'), (e.getAttribute('data-pct') ?? '').replace(/[^\\d]/g, '')]))`);
    iconLines[id] = await c.tab.js<string>(`[...document.querySelectorAll('[data-testid="store-purchase-modal"] [data-testid="odds-icon"], [data-testid="store-purchase-modal"] [data-testid="odds-icon-cards"], [data-testid="store-purchase-modal"] [data-testid="odds-slots"]')].map((e) => e.innerText.replace(/[^\\d]+/g, ' ').trim()).join(' / ')`);
    if (id === "icon") await shot(c, "tienda-modal-icon-premium");
    if (id === "estandar") await shot(c, "tienda-modal-bronce");
    await c.tab.js(`(() => { const m = document.querySelector('[data-testid="store-purchase-modal"]'); m && [...m.querySelectorAll('button')][0]?.click(); })()`);
    await waitFor(c.tab, `!document.querySelector('[data-testid="store-purchase-modal"]')`, 8000);
  }
  return { prices, odds, iconLines };
}

/** Compra por la interfaz y devuelve lo que dice el servidor antes y después. */
async function buyUi(c: Client, access: string, packId: string) {
  const before = await state(access);
  await goto(c, "/tienda", 2200);
  await c.tab.js(`(() => { const a = document.querySelector('[data-product-id="pack:${packId}"]'); const b = a && [...a.querySelectorAll('button,a')].pop(); b && b.click(); })()`);
  const modal = await waitFor(c.tab, q("store-purchase-modal"), 12000);
  const shown = modal ? await c.tab.js<{ now: string; after: string; confirm: string }>(`(() => { const m = document.querySelector('[data-testid="store-purchase-modal"]'); const b = [...m.querySelectorAll('button')].pop(); return { now: m.querySelector('[data-testid="balance-now"]')?.innerText ?? '', after: m.querySelector('[data-testid="balance-after"]')?.innerText ?? '', confirm: b.innerText }; })()`) : { now: "", after: "", confirm: "" };
  await c.tab.js(`(() => { const m = document.querySelector('[data-testid="store-purchase-modal"]'); const b = m && [...m.querySelectorAll('button')].pop(); b && !b.disabled && b.click(); })()`);
  let after = before;
  for (let i = 0; i < 40; i++) { await sleep(500); after = await state(access); if (after.credits !== before.credits) break; }
  await sleep(1200);
  collect(c, `compra ${packId}`);
  return { before, after, shown };
}

/** Avanza la ceremonia de apertura hasta el resumen, anotando si hubo WALKOUT. */
async function openUi(c: Client, packId: string, tag: string) {
  await goto(c, `/abrir/${packId}`, 2500);
  const ready = await waitFor(c.tab, q("pack-open"), 25000);
  await shot(c, `${tag}-sellado`);
  const sealed = await probe(c);
  await clickTid(c, "pack-open");
  const walkout = { seen: false, stage: "", text: "", lang: "", spanish: [] as string[], keys: [] as string[] };
  let phases = "";
  for (let i = 0; i < 160; i++) {
    if (await c.tab.js<boolean>(q("pack-summary"))) break;
    const ph = await c.tab.js<string>(`document.querySelector('[data-testid="pack-opening"]')?.getAttribute('data-phase') ?? ''`).catch(() => "");
    if (ph && !phases.endsWith(ph)) phases += (phases ? ">" : "") + ph;
    const w = await c.tab.js<{ on: boolean; stage: string; text: string }>(`(() => { const w = document.querySelector('[data-testid="pack-walkout"], [data-testid="walkout"]'); if (!w) return { on: false, stage: '', text: '' }; return { on: true, stage: document.querySelector('[data-testid="walkout-stage-3d"]') ? '3d' : document.querySelector('[data-testid="walkout-stage-2d"]') ? '2d' : '?', text: w.innerText.slice(0, 900) }; })()`).catch(() => ({ on: false, stage: "", text: "" }));
    if (w.on) {
      if (!walkout.seen) { await sleep(1500); const p = await probe(c); walkout.lang = p.lang; walkout.spanish = p.spanish; walkout.keys = p.keys; await shot(c, `${tag}-walkout`); }
      walkout.seen = true; walkout.stage = w.stage || walkout.stage; if (w.text.length > walkout.text.length) walkout.text = w.text;
    }
    const clicked = await clickTid(c, "pack-walkout-continue") || await clickTid(c, "walkout-skip") || await clickTid(c, "hero-continue") || await clickTid(c, "rest-continue") || await clickTid(c, "intro-advance") || await clickTid(c, "pack-reveal-all") || await clickTid(c, "pack-skip") || await clickTid(c, "pack-retry");
    if (!clicked) await c.tab.js(`(document.querySelector('[data-testid="rest-reveal"], [data-testid="reveal-card"], [data-testid="hero-reveal"], [data-testid="ceremony-pack"], [data-testid="pack-stage"]'))?.click()`).catch(() => null);
    await sleep(w.on ? 900 : 550);
  }
  const done = await waitFor(c.tab, q("pack-summary"), 20000);
  await sleep(900);
  const cards = done ? await c.tab.js<string[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => e.getAttribute('data-card-id'))`).catch(() => []) : [];
  await shot(c, `${tag}-resumen`);
  const summary = await probe(c);
  collect(c, `apertura ${packId}`);
  return { ready, done, cards: cards ?? [], walkout, phases, sealed, summary };
}

async function runLocale(l: Loc, baseline: StoreShot | null): Promise<StoreShot> {
  L = l;
  console.log(`\n══════════ ${l.toUpperCase()} ══════════`);
  const c = await open(1440, { acceptLanguage: "es-ES,es" });
  let snap: StoreShot = { prices: {}, odds: {}, iconLines: {} };
  try {
    /* 1 · Selector + inicio de sesión */
    await goto(c, "/cuenta", 1800);
    check("selector · el idioma se aplica antes de entrar", await chooseLocale(c, l), await lang(c));
    await shot(c, "cuenta-acceso");
    const access0 = await screen(c, "acceso");
    void access0;
    check("inicio de sesión por el formulario", await loginUi(c, "PLAYER"));
    await sleep(2500);
    check("tras entrar, el idioma se conserva", (await lang(c)) === l, await lang(c));
    let t = await token("PLAYER");
    for (let i = 0; i < 20 && t.meta.locale !== l; i++) { await sleep(700); t = await token("PLAYER"); }
    check("persistencia · el idioma queda guardado en la cuenta", t.meta.locale === l && typeof t.meta.locale_at === "number", { locale: t.meta.locale, at: t.meta.locale_at });
    const access = t.access;
    await screen(c, "cuenta-con-sesion", { allowSpanish: /qa-player|@example/i });

    /* 2 · Otro dispositivo: navegador nuevo, sin preferencia, en japonés → hereda el idioma de la cuenta */
    const d2 = await open(1440, { acceptLanguage: "ja-JP,ja" });
    try {
      await goto(d2, "/cuenta", 1800);
      const guestLang = await lang(d2);
      await loginUi(d2, "PLAYER");
      const inherited = await waitFor(d2.tab, `document.documentElement.lang === '${l}'`, 20000);
      check("otro dispositivo · hereda el idioma de la cuenta al entrar", inherited, { antes: guestLang, despues: await lang(d2) });
      const stored = await d2.tab.js<string>(`localStorage.getItem('vr.locale') ?? ''`);
      check("otro dispositivo · la preferencia se copia al dispositivo", stored.includes(`"${l}"`), stored);
      // 2b · el segundo dispositivo cambia de idioma y el primero lo recibe al recargar (gana la elección más reciente)
      const other: Loc = l === "it" ? "en" : "it";
      await chooseLocale(d2, other);
      let t2 = await token("PLAYER");
      for (let i = 0; i < 20 && t2.meta.locale !== other; i++) { await sleep(700); t2 = await token("PLAYER"); }
      await goto(c, "/cuenta", 2500);
      const propagated = await waitFor(c.tab, `document.documentElement.lang === '${other}'`, 20000);
      check("entre dispositivos · el cambio más reciente llega al primero", t2.meta.locale === other && propagated, { cuenta: t2.meta.locale, dispositivo1: await lang(c) });
      await chooseLocale(c, l);
      let t3 = await token("PLAYER");
      for (let i = 0; i < 20 && t3.meta.locale !== l; i++) { await sleep(700); t3 = await token("PLAYER"); }
      check("entre dispositivos · volver al idioma de la prueba", (await lang(c)) === l && t3.meta.locale === l, { cuenta: t3.meta.locale });
      collect(d2, "dispositivo 2");
      check("otro dispositivo · sin errores de consola", d2.errors.length === 0, d2.errors.slice(0, 4));
    } finally { await d2.browser.close(); }

    /* 3 · Tienda: precios y probabilidades */
    snap = await storeSnapshot(c);
    await goto(c, "/tienda", 2200);
    await screen(c, "tienda");
    check("tienda · ICON 30.000 e ICON Premium 80.000", snap.prices["pack:icon-single"] === "30000" && snap.prices["pack:icon"] === "80000", { single: snap.prices["pack:icon-single"], premium: snap.prices["pack:icon"] });
    check("tienda · línea principal 2.500/6.000/12.000/20.000/35.000", ["estandar", "premium", "oro", "masters", "champions"].map((k) => snap.prices[`pack:${k}`]).join("/") === "2500/6000/12000/20000/35000", snap.prices);
    check("tienda · Icon por sobre 1/5/10/15/20 %", ["estandar", "premium", "oro", "masters", "champions"].map((k) => /^(\d+) /.exec(snap.iconLines[k] ?? "")?.[1]).join("/") === "1/5/10/15/20", ["estandar", "premium", "oro", "masters", "champions"].map((k) => (snap.iconLines[k] ?? "").slice(0, 12)));
    if (baseline) {
      check("tienda · precios e identificadores idénticos a español", JSON.stringify(snap.prices) === JSON.stringify(baseline.prices), Object.keys(snap.prices).filter((k) => snap.prices[k] !== baseline.prices[k]));
      check("tienda · probabilidades idénticas a español (cifra a cifra)", JSON.stringify(snap.odds) === JSON.stringify(baseline.odds), Object.keys(snap.odds).filter((k) => JSON.stringify(snap.odds[k]) !== JSON.stringify(baseline.odds[k])));
      check("tienda · cifras de Icon y ranuras idénticas a español", JSON.stringify(snap.iconLines) === JSON.stringify(baseline.iconLines), Object.keys(snap.iconLines).filter((k) => snap.iconLines[k] !== baseline.iconLines[k]).map((k) => `${k}: ${snap.iconLines[k]} ≠ ${baseline.iconLines[k]}`));
    }

    /* 4 · Compra de sobres (interfaz) contra el libro del servidor */
    const b1 = await buyUi(c, access, "estandar");
    check("compra · Bronce cobra exactamente 2.500", b1.before.credits - b1.after.credits === 2500, { antes: b1.before.credits, despues: b1.after.credits });
    check("compra · el modal enseñaba el saldo real y el resultante", digits(b1.shown.now) === String(b1.before.credits) && digits(b1.shown.after) === String(b1.before.credits - 2500), b1.shown);
    check("compra · +1 sobre Bronce sin abrir", (b1.after.unopenedPacks?.estandar ?? 0) - (b1.before.unopenedPacks?.estandar ?? 0) === 1, { antes: b1.before.unopenedPacks?.estandar ?? 0, despues: b1.after.unopenedPacks?.estandar ?? 0 });
    const b2 = await buyUi(c, access, "icon-single");
    check("compra · ICON cobra exactamente 30.000 y da 1 sobre", b2.before.credits - b2.after.credits === 30000 && (b2.after.unopenedPacks?.["icon-single"] ?? 0) - (b2.before.unopenedPacks?.["icon-single"] ?? 0) === 1, { cobro: b2.before.credits - b2.after.credits });

    /* 5 · Apertura de sobres + WALKOUT */
    const s0 = await state(access);
    const o1 = await openUi(c, "estandar", "abrir-bronce");
    const s1 = await state(access);
    const new1 = s1.ownedCards.filter((x) => !s0.ownedCards.some((y) => y.uid === x.uid)).map((x) => x.cardId).sort();
    check("apertura · Bronce llega al resumen", o1.ready && o1.done, o1.phases);
    check("apertura · Bronce entrega 5 cartas y las del resumen son las del servidor", new1.length === 5 && JSON.stringify([...o1.cards].sort()) === JSON.stringify(new1), { servidor: new1, resumen: o1.cards });
    check("apertura · consume exactamente 1 sobre y no toca los créditos", (s0.unopenedPacks?.estandar ?? 0) - (s1.unopenedPacks?.estandar ?? 0) === 1 && s1.credits === s0.credits, { sobres: [s0.unopenedPacks?.estandar, s1.unopenedPacks?.estandar], creditos: [s0.credits, s1.credits] });
    check("apertura · pantallas en el idioma (sellado y resumen)", o1.sealed.lang === l && o1.summary.lang === l && (l === "es" || (o1.sealed.spanish.length === 0 && o1.summary.spanish.length === 0)), { sellado: o1.sealed.spanish.slice(0, 5), resumen: o1.summary.spanish.slice(0, 5) });
    check("apertura · sin claves ni textos cortados", o1.sealed.keys.length + o1.summary.keys.length === 0 && o1.summary.clipped.length === 0 && o1.sealed.clipped.length === 0, { sellado: o1.sealed.clipped.slice(0, 4), resumen: o1.summary.clipped.slice(0, 4) });

    const o2 = await openUi(c, "icon-single", "abrir-icon");
    const s2 = await state(access);
    const new2 = s2.ownedCards.filter((x) => !s1.ownedCards.some((y) => y.uid === x.uid)).map((x) => x.cardId);
    check("apertura · ICON entrega exactamente 1 carta (la del servidor)", o2.done && new2.length === 1 && o2.cards.length === 1 && o2.cards[0] === new2[0], { servidor: new2, resumen: o2.cards, fases: o2.phases });
    check("WALKOUT · aparece en la apertura ICON", o2.walkout.seen, { stage: o2.walkout.stage, fases: o2.phases });
    check("WALKOUT · en el idioma, sin español ni claves", o2.walkout.seen && o2.walkout.lang === l && o2.walkout.keys.length === 0 && (l === "es" || o2.walkout.spanish.length === 0), { lang: o2.walkout.lang, spanish: o2.walkout.spanish.slice(0, 6), texto: o2.walkout.text.replace(/\n+/g, " | ").slice(0, 220) });

    /* 6 · Colección e inventario */
    await goto(c, "/coleccion", 3500);
    await screen(c, "coleccion", { allowSpanish: /^[A-Za-z0-9 .'-]{2,24}$/ });
    await goto(c, "/inventario", 3500);
    const inv = await screen(c, "inventario", { allowSpanish: /^[A-Za-z0-9 .'-]{2,24}$/ });
    void inv;
    check("colección · el servidor tiene las cartas abiertas (≥ 6)", s2.ownedCards.length >= 6, s2.ownedCards.length);

    /* 7 · Crafteo de sobres: 4 Bronce → 1 Plata */
    const need = 4 - (s2.unopenedPacks?.estandar ?? 0);
    for (let i = 0; i < need; i++) await api(access, "/api/game/packs", { action: "buy", packId: "estandar", ref: `i18nqa-${randomUUID()}`, expectedPrice: 2500 });
    const c0 = await state(access);
    await goto(c, "/misiones/crafting/sobres", 3500);
    await waitFor(c.tab, q("pack-recipe"), 20000);
    await screen(c, "crafteo-sobres");
    const recipes = await c.tab.js<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('[data-testid="pack-recipe"]')].map((e) => [e.getAttribute('data-recipe'), (/^\\s*(\\d+)/.exec(e.innerText) || [])[1] || '']))`);
    check("crafteo · recetas 4/3/2/3/3 (Champions → ICON Premium 3:1)", JSON.stringify(recipes) === JSON.stringify({ "pack-estandar-premium": "4", "pack-premium-oro": "3", "pack-oro-masters": "2", "pack-masters-champions": "3", "pack-champions-icon": "3" }), recipes);
    const crafted = await c.tab.js<boolean>(`(() => { const r = document.querySelector('[data-testid="pack-recipe"][data-recipe="pack-estandar-premium"]'); const b = r && r.querySelector('[data-testid="pack-recipe-craft"]'); if (!b || b.disabled) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
    await sleep(1200);
    // confirmación, si la hay
    await waitFor(c.tab, q("pack-craft-confirm"), 8000); await shot(c, "crafteo-confirmacion"); await clickTid(c, "pack-craft-confirm"); await sleep(600);
    let c1 = c0;
    for (let i = 0; i < 30; i++) { await sleep(500); c1 = await state(access); if ((c1.unopenedPacks?.premium ?? 0) !== (c0.unopenedPacks?.premium ?? 0)) break; }
    await sleep(1500);
    await shot(c, "crafteo-resultado");
    const afterCraft = await probe(c);
    check("crafteo · el botón estaba disponible con 4 Bronce", crafted, { bronce: c0.unopenedPacks?.estandar });
    check("crafteo · −4 Bronce, +1 Plata, créditos intactos", (c0.unopenedPacks?.estandar ?? 0) - (c1.unopenedPacks?.estandar ?? 0) === 4 && (c1.unopenedPacks?.premium ?? 0) - (c0.unopenedPacks?.premium ?? 0) === 1 && c1.credits === c0.credits, { bronce: [c0.unopenedPacks?.estandar, c1.unopenedPacks?.estandar], plata: [c0.unopenedPacks?.premium ?? 0, c1.unopenedPacks?.premium ?? 0] });
    check("crafteo · resultado en el idioma", afterCraft.lang === l && (l === "es" || afterCraft.spanish.length === 0) && afterCraft.keys.length === 0, afterCraft.spanish.slice(0, 6));
    await goto(c, "/misiones/crafting", 3000);
    await screen(c, "crafteo-hub");

    /* 8 · Perfil */
    await goto(c, `/jugador/${t.userId}`, 3500);
    await screen(c, "perfil-publico", { allowSpanish: /qa-player/i });
    await goto(c, "/cuenta", 3000);
    await screen(c, "cuenta-perfil", { allowSpanish: /qa-player|@example/i });

    /* 9 · Navegación principal con sesión */
    for (const route of ["/", "/jugar", "/temporada", "/temporada/pase", "/misiones", "/duelos", "/competitivo", "/social", "/copas", "/pickems", "/colecciones", "/logros", "/packs"]) {
      await goto(c, route, 2800);
      await screen(c, `nav${route === "/" ? "-home" : route.replace(/\//g, "-")}`, { allowSpanish: /qa-player|qa-admin/i });
    }
    check("jugador · sin errores de consola en todo el recorrido", c.errors.length === 0, c.errors.slice(0, 6));
    check("jugador · sin errores de hidratación", !c.errors.some((e) => /hydrat|did not match|#418|#423|#425/i.test(e)), "");
  } finally { await c.browser.close(); }

  /* 10 · Administración con la cuenta QA admin */
  const a = await open(1440, { acceptLanguage: "es-ES,es" });
  try {
    await goto(a, "/cuenta", 1800);
    await chooseLocale(a, l);
    check("admin · inicio de sesión de la cuenta QA admin", await loginUi(a, "ADMIN"));
    await sleep(2500);
    await goto(a, "/admin", 4500);
    const inside = await waitFor(a.tab, q("admin-back-to-game"), 20000);
    check("admin · el panel abre para la cuenta autorizada", inside, (await bodyText(a)).slice(0, 120).replace(/\n/g, " | "));
    await screen(a, "admin-inicio", { allowSpanish: /qa-admin|qa-player|Temporada d|decisión del propietario/i });
    for (const route of ["/admin/packs", "/admin/cards", "/admin/crafting", "/admin/users", "/admin/system", "/admin/walkout", "/admin/copas", "/admin/alpha"]) {
      await goto(a, route, 3500);
      const body = await bodyText(a);
      if (/404|not found|no encontrad/i.test(body.slice(0, 200)) && body.length < 400) { check(`admin${route.replace(/\//g, "-")} · ruta existe`, false, "404"); continue; }
      await screen(a, `admin${route.replace(/^\/admin/, "").replace(/\//g, "-")}`, { allowSpanish: /qa-admin|qa-player|Sobre |Caja |→|Temporada d|decisión del propietario|pool de elegibilidad|WALKOUT|RARE|ICON.Pack|Sin especiales/i });
    }
    check("admin · sin errores de consola", a.errors.length === 0, a.errors.slice(0, 6));
    // la cuenta de jugador NO entra al panel
    const p = await open(1440, { acceptLanguage: "es-ES,es" });
    try {
      await goto(p, "/cuenta", 1800); await chooseLocale(p, l); await loginUi(p, "PLAYER"); await sleep(2000);
      await goto(p, "/admin", 5000);
      check("admin · la cuenta de jugador no entra", !(await p.tab.js<boolean>(q("admin-back-to-game"))), (await bodyText(p)).slice(0, 100).replace(/\n/g, " | "));
    } finally { await p.browser.close(); }
  } finally { await a.browser.close(); }
  void clickText; void BASE;
  return snap;
}

async function main() {
  let baseline: StoreShot | null = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : null;
  for (const l of wanted) {
    try {
      const snap = await runLocale(l, l === "es" ? null : baseline);
      if (l === "es") { baseline = snap; writeFileSync(BASELINE_FILE, JSON.stringify(snap, null, 1)); }
      writeFileSync(join(RAW, `auth-store-${l}.json`), JSON.stringify(snap, null, 1));
    } catch (e) { L = l; check("EJECUCIÓN", false, String((e as Error)?.stack ?? e).slice(0, 500)); }
    writeFileSync(join(RAW, `auth-qa-${l}.json`), JSON.stringify(rows.filter((r) => r.locale === l), null, 1));
  }
  const fails = rows.filter((r) => !r.ok);
  console.log(`\nRESULTADO · ${rows.length - fails.length} PASS · ${fails.length} FAIL`);
  for (const l of wanted) console.log(`  ${l}: ${rows.filter((r) => r.locale === l && r.ok).length} PASS · ${rows.filter((r) => r.locale === l && !r.ok).length} FAIL`);
}
main().catch((e) => { console.error(e); process.exit(1); });
