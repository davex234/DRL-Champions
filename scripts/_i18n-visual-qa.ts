/**
 * QA VISUAL · I18N CON SESIÓN (instrumento, fuera de CI y de la release). Solo contra el stack de QA aislado.
 *
 *   QA_ENV=<qa.env> BASE_URL=http://127.0.0.1:3027 [I18N_LOCALES=de] [I18N_WIDTHS=390] npx tsx scripts/_i18n-visual-qa.ts
 *
 * es/en/de/it × 1440/768/390, con la cuenta QA sintética dentro: recorre las pantallas reales y sus estados
 * interactivos (menús, modal de compra, sobre sellado, apertura hasta el resumen, confirmación de crafteo, pestañas de
 * la cuenta) y, sin sesión, la portada y el acceso. Por pantalla: idioma, desbordes, textos cortados, botones
 * desbordados, restos de español, claves visibles, errores de consola y de hidratación, y que la navegación responde.
 * Capturas en docs/product/qa/i18n-visual/<idioma>/<ancho>-<pantalla>.png; informe en logs/i18n/rc/visual-qa.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { api, chooseLocale, clickTid, collect, goto, loginUi, open, probe, q, sleep, token, waitFor, type Client, type Loc, type Probe } from "./_i18n-auth-lib";

const OUT = join(process.cwd(), "docs/product/qa/i18n-visual");
const RAW = join(process.cwd(), "logs/i18n/rc");
const LOCS = (process.env.I18N_LOCALES ?? "es,en,de,it,fr,pt-PT,pt-BR,ja").split(",") as Loc[];
const WIDTHS = (process.env.I18N_WIDTHS ?? "1440,768,390").split(",").map(Number);
/** `I18N_ROUTES=/tienda,/packs` acota la pasada de jugador (re-verificación de un cambio puntual); sin ella, todas. */
const ROUTES = process.env.I18N_ROUTES ? process.env.I18N_ROUTES.split(",") : ["/", "/jugar", "/duelos", "/duelos/mazos", "/tienda", "/tienda/creditos", "/packs", "/coleccion", "/inventario", "/colecciones", "/temporada", "/temporada/pase", "/misiones", "/misiones/crafting", "/misiones/crafting/sobres", "/misiones/crafting/cartas", "/logros", "/ranking", "/competitivo", "/copas", "/torneos", "/pickems", "/social", "/entrenador", "/como-jugar", "/cuenta", "/cuenta?seccion=progresion", "/cuenta?seccion=cuenta", "/esta-ruta-no-existe"];

interface Row extends Probe { locale: string; width: number; screen: string; errors: string[]; note?: string }
const rows: Row[] = [];
/** Líneas que son CONTENIDO (cuentas QA, nicks, equipos, marcas): no cuentan como resto de español. */
const CONTENT = /qa-player|qa-admin|@example|^#[A-Z0-9]{7}$|^[A-Za-z0-9 .'&-]{2,22}$/;

async function snap(c: Client, locale: Loc, width: number, screen: string, note?: string): Promise<Row> {
  const before = c.errors.length;
  collect(c, screen);
  const p = await probe(c);
  mkdirSync(join(OUT, locale), { recursive: true });
  await c.tab.shot(join(OUT, locale, `${width}-${screen}.png`)).catch(() => null);
  const row: Row = { locale, width, screen, ...p, spanish: locale === "es" ? [] : p.spanish.filter((l) => !CONTENT.test(l)), errors: c.errors.slice(before), note };
  rows.push(row);
  const flag = [row.lang !== locale && `lang=${row.lang}`, row.overflow > 1 && `desborda ${row.overflow}px`, row.clipped.length && `cortados ${row.clipped.length}`, row.spanish.length && `español ${row.spanish.length}`, row.keys.length && `claves ${row.keys.length}`, row.errors.length && `consola ${row.errors.length}`, row.hydration && "hidratación"].filter(Boolean).join(" · ");
  console.log(`${locale} ${String(width).padStart(4)} ${screen.padEnd(34)} ${flag || "ok"}`);
  return row;
}
const slug = (r: string) => (r === "/" ? "home" : r.replace(/^\//, "").replace(/[/?=&]/g, "_"));

async function run(locale: Loc, width: number) {
  /* sin sesión: portada y acceso */
  const g = await open(width, { acceptLanguage: "es-ES,es" });
  try {
    await g.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem('vr.locale', JSON.stringify({ locale: ${JSON.stringify(locale)}, at: 1 })); } catch {}` });
    for (const r of ["/", "/tienda", "/cuenta"]) { await goto(g, r, 1800); await snap(g, locale, width, `invitado-${slug(r)}`); }
  } finally { await g.browser.close(); }

  const c = await open(width, { acceptLanguage: "es-ES,es" });
  try {
    await goto(c, "/cuenta", 1500);
    await chooseLocale(c, locale);
    if (!(await loginUi(c, "PLAYER"))) { rows.push({ locale, width, screen: "LOGIN", lang: "", overflow: 0, clipped: [], lines: 0, spanish: [], keys: [], hydration: false, errors: ["no se pudo iniciar sesión"] }); return; }
    await sleep(2000);
    const t = await token("PLAYER");

    for (const r of ROUTES) { await goto(c, r, 2600); await snap(c, locale, width, slug(r)); }
    await goto(c, `/jugador/${t.userId}`, 3000); await snap(c, locale, width, "jugador-perfil");

    /* navegación: el menú principal se abre y lleva a otra pantalla */
    await goto(c, "/", 2200);
    const menu = await clickTid(c, "shell-menu"); await sleep(900);
    await snap(c, locale, width, "menu-abierto", menu ? undefined : "sin botón de menú");
    const before = await c.tab.js<string>("location.pathname");
    const moved = await c.tab.js<boolean>(`(() => { const a = [...document.querySelectorAll('nav a[href^="/"], [role="dialog"] a[href^="/"], [role="menu"] a[href^="/"]')].find((x) => x.getBoundingClientRect().width > 0 && x.getAttribute('href') !== location.pathname && x.getAttribute('href') !== '/'); if (!a) return false; a.click(); return true; })()`);
    await sleep(2500);
    const after = await c.tab.js<string>("location.pathname");
    rows.push({ locale, width, screen: "NAVEGACION", lang: locale, overflow: 0, clipped: [], lines: 0, spanish: [], keys: [], hydration: false, errors: moved && after !== before ? [] : [`el menú no navega (${before} → ${after})`] });
    await clickTid(c, "shell-play-menu"); await sleep(900); await goto(c, "/", 1500);
    await clickTid(c, "shell-play-menu"); await sleep(900); await snap(c, locale, width, "menu-jugar");
    await goto(c, "/", 1200); await clickTid(c, "shell-account"); await sleep(1200); await snap(c, locale, width, "menu-cuenta");

    /* tienda: modal de compra de Bronce e ICON Premium */
    for (const id of ["estandar", "icon"]) {
      await goto(c, "/tienda", 2200);
      await c.tab.js(`(() => { const a = document.querySelector('[data-product-id="pack:${id}"]'); const b = a && [...a.querySelectorAll('button,a')].pop(); b && b.click(); })()`);
      await waitFor(c.tab, q("store-purchase-modal"), 10000); await sleep(700);
      await snap(c, locale, width, `tienda-modal-${id}`);
    }

    /* apertura real de un Bronce: sellado → ceremonia → resumen */
    await api(t.access, "/api/game/packs", { action: "buy", packId: "estandar", ref: `i18nvis-${randomUUID()}`, expectedPrice: 2500 });
    await goto(c, "/abrir/estandar", 2500);
    await waitFor(c.tab, q("pack-open"), 20000);
    await snap(c, locale, width, "abrir-sellado");
    await clickTid(c, "pack-open"); await sleep(2500);
    await snap(c, locale, width, "abrir-ceremonia");
    for (let i = 0; i < 120; i++) {
      if (await c.tab.js<boolean>(q("pack-summary"))) break;
      const clicked = await clickTid(c, "pack-walkout-continue") || await clickTid(c, "walkout-skip") || await clickTid(c, "hero-continue") || await clickTid(c, "rest-continue") || await clickTid(c, "intro-advance") || await clickTid(c, "pack-reveal-all") || await clickTid(c, "pack-skip");
      if (!clicked) await c.tab.js(`(document.querySelector('[data-testid="rest-reveal"], [data-testid="reveal-card"], [data-testid="hero-reveal"], [data-testid="ceremony-pack"], [data-testid="pack-stage"]'))?.click()`).catch(() => null);
      await sleep(550);
    }
    await sleep(1200);
    await snap(c, locale, width, "abrir-resumen", (await c.tab.js<boolean>(q("pack-summary"))) ? undefined : "NO llegó al resumen");

    /* crafteo: diálogo de confirmación (sin confirmar) */
    const st = (await api(t.access, "/api/game/state")).json as { unopenedPacks: Record<string, number> };
    for (let i = st.unopenedPacks?.estandar ?? 0; i < 4; i++) await api(t.access, "/api/game/packs", { action: "buy", packId: "estandar", ref: `i18nvis-${randomUUID()}`, expectedPrice: 2500 });
    await goto(c, "/misiones/crafting/sobres", 3200);
    await c.tab.js(`(() => { const r = document.querySelector('[data-testid="pack-recipe"][data-recipe="pack-estandar-premium"]'); const b = r && r.querySelector('[data-testid="pack-recipe-craft"]'); b && !b.disabled && b.click(); })()`);
    await sleep(1200);
    await snap(c, locale, width, "crafteo-confirmacion", (await c.tab.js<boolean>(q("pack-craft-confirm"))) ? undefined : "sin diálogo");

    /* carta de la colección: detalle */
    await goto(c, "/coleccion", 3200);
    await c.tab.js(`(document.querySelector('[data-testid="collection-album"] button, [data-testid="collection-album"] a, [data-testid="collection-book"] button'))?.click()`);
    await sleep(1800);
    await snap(c, locale, width, "coleccion-detalle");
  } finally { await c.browser.close(); }
}

/**
 * PANEL DE ADMINISTRACIÓN con la cuenta QA admin (otra cuenta: puede correr en paralelo a la pasada de jugador).
 * Todas las pantallas a 1440 (es una herramienta de escritorio) y las principales también a 768 y 390.
 * El contenido de la base de datos y los diagnósticos del servidor salen en español a propósito: lo que el detector
 * marque como «español» aquí se INFORMA aparte (columna propia), no se da por bueno ni se oculta.
 */
const ADMIN_ALL = ["/admin", "/admin/admins", "/admin/agents", "/admin/agents/new", "/admin/alpha", "/admin/assets", "/admin/assets/legacy", "/admin/audit", "/admin/card-review", "/admin/cards", "/admin/cards/new", "/admin/cartas", "/admin/cartas/nueva", "/admin/collection-sets", "/admin/competitive", "/admin/content", "/admin/control", "/admin/copas", "/admin/crafting", "/admin/data-engine", "/admin/duel-themes", "/admin/economy", "/admin/events", "/admin/events/new", "/admin/live", "/admin/maps", "/admin/moderation", "/admin/operations", "/admin/packs", "/admin/packs/new", "/admin/pickems", "/admin/players", "/admin/players/new", "/admin/pools", "/admin/pools/nueva", "/admin/releases", "/admin/rewards", "/admin/roster", "/admin/seasons", "/admin/system", "/admin/teams", "/admin/torneos", "/admin/tournament-control", "/admin/users", "/admin/walkout"];
const ADMIN_MAIN = ["/admin", "/admin/admins", "/admin/alpha", "/admin/audit", "/admin/cartas", "/admin/copas", "/admin/crafting", "/admin/economy", "/admin/packs", "/admin/pools", "/admin/system", "/admin/users"];
async function runAdmin(locale: Loc, width: number) {
  const a = await open(width, { acceptLanguage: "es-ES,es" });
  try {
    await goto(a, "/cuenta", 1500);
    await chooseLocale(a, locale);
    if (!(await loginUi(a, "ADMIN"))) { rows.push({ locale, width, screen: "admin-LOGIN", lang: "", overflow: 0, clipped: [], lines: 0, spanish: [], keys: [], hydration: false, errors: ["no se pudo iniciar sesión (admin)"] }); return; }
    await sleep(2000);
    for (const r of process.env.I18N_ADMINROUTES ? process.env.I18N_ADMINROUTES.split(",") : width >= 1200 ? ADMIN_ALL : ADMIN_MAIN) { await goto(a, r, 2800); await snap(a, locale, width, slug(r)); }
  } finally { await a.browser.close(); }
}
const SECTIONS = (process.env.I18N_SECTIONS ?? "player,admin").split(",");

async function main() {
  for (const locale of LOCS) for (const width of WIDTHS) {
    try { if (SECTIONS.includes("player")) await run(locale, width); if (SECTIONS.includes("admin")) await runAdmin(locale, width); } catch (e) { rows.push({ locale, width, screen: "EJECUCION", lang: "", overflow: 0, clipped: [], lines: 0, spanish: [], keys: [], hydration: false, errors: [String((e as Error)?.message ?? e).slice(0, 300)] }); console.log(`${locale} ${width} EJECUCIÓN ROTA: ${String(e).slice(0, 200)}`); }
    writeFileSync(join(RAW, `visual-qa${process.env.I18N_TAG ? `-${process.env.I18N_TAG}` : ""}.json`), JSON.stringify(rows, null, 1));
  }
  const sum = LOCS.flatMap((l) => ["juego", "admin"].map((sec) => ({ l, sec }))).filter(({ sec }) => SECTIONS.includes(sec === "juego" ? "player" : "admin")).map(({ l, sec }) => { const r = rows.filter((x) => x.locale === l && x.screen.startsWith("admin") === (sec === "admin")); return { idioma: l, zona: sec, pantallas: r.length, idiomaMal: r.filter((x) => x.lang && x.lang !== l).length, desbordes: r.filter((x) => x.overflow > 1).length, cortados: r.filter((x) => x.clipped.length).length, conEspañol: r.filter((x) => x.spanish.length).length, claves: r.filter((x) => x.keys.length).length, consola: r.filter((x) => x.errors.length).length, hidratacion: r.filter((x) => x.hydration).length }; });
  console.table(sum);
}
main().catch((e) => { console.error(e); process.exit(1); });
