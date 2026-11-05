/**
 * INSTRUMENTO DE MEDIDA — APERTURA DE SOBRES REAL (Fase Packs).
 *
 *   npx next dev -p 3005                                   (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_faseP-packs-qa.ts
 *
 * Prefijado con `_` y FUERA de `package.json` y de CI a propósito: es el instrumento de una
 * fase, no un gate permanente. Mide, guarda capturas y se queda en el repositorio como
 * prueba de lo que se midió.
 *
 * ══════════════════════════ QUÉ HACE, Y QUÉ NO ══════════════════════════
 *
 * Abre sobres DE VERDAD. Crea un usuario real, le acredita créditos por la RPC de economía,
 * compra en `/tienda` pulsando el botón, abre en `/abrir/[packId]` pulsando el botón, revela
 * las cinco cartas una a una y después va a la BASE DE DATOS a comprobar que lo que se vio en
 * pantalla es lo que quedó escrito: ejemplares en `user_cards`, saldo en `profiles`, sobres en
 * `user_packs` y el asiento en `credit_transactions`.
 *
 * NO hay ni una carta inventada, ni un mock, ni un resultado forzado. El §22 del encargo lo
 * prohíbe expresamente y además haría inútil la medición: lo que se quiere saber es si la
 * ceremonia representa bien el sorteo REAL, y para eso el sorteo tiene que ser real.
 *
 * La rareza alta tampoco se fuerza: se abre el `icon`, que GARANTIZA legendaria por catálogo
 * (`guaranteedMin: "legendary"`). Es usar el sistema, no burlarlo.
 *
 * ══════════════════════════ POR QUÉ `no-preference` ══════════════════════════
 *
 * Chrome sin cabeza declara `prefers-reduced-motion: reduce`, así que por defecto
 * fotografiaría la ceremonia en reposo. La pasada principal pide `no-preference` para ver la
 * animación; al final hay una pasada EXTRA con `reduce` que comprueba lo que de verdad
 * importa de esa preferencia: que no se pierda ningún revelado.
 *
 * Limpia lo que crea: borra el usuario al terminar, pase lo que pase.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { PACKS, getPack } from "@/data/packs";
import { getVariant } from "@/domain/cards/variants";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !ANON || !SERVICE) {
  console.error("Faltan credenciales de Supabase en .env.local");
  process.exit(1);
}

const OUT = join(ROOT, "docs", "product", "qa", "packs");
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, detail = ""): boolean => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
  return cond;
};
const info = (label: string, detail = "") => console.log(`  · ${label}${detail ? ` — ${detail}` : ""}`);

/** Espera a que una expresión sea verdadera en la página. */
async function esperar(tab: Tab, expr: string, timeout = 15000, step = 200): Promise<boolean> {
  const fin = Date.now() + timeout;
  while (Date.now() < fin) {
    if (await tab.js<boolean>(`!!(${expr})`)) return true;
    await sleep(step);
  }
  return false;
}

/** Pulsa el primer botón/enlace visible cuyo texto encaje. */
async function pulsar(tab: Tab, patron: string): Promise<boolean> {
  return tab.js<boolean>(`(() => {
    const re = ${patron};
    const el = [...document.querySelectorAll('button, a')]
      .filter(x => x.offsetParent !== null && !x.disabled)
      .find(x => re.test((x.textContent || '').trim()));
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

/** Geometría de la ventana: ¿desborda a lo ancho? ¿hay scroll vertical? */
interface Geometria { overflowX: boolean; scrollY: boolean; sw: number; iw: number; sh: number; ih: number }
const geometria = (tab: Tab) =>
  tab.js<Geometria>(`(() => {
    const d = document.documentElement;
    return {
      overflowX: d.scrollWidth > window.innerWidth + 1,
      scrollY: d.scrollHeight > window.innerHeight + 1,
      sw: d.scrollWidth, iw: window.innerWidth,
      sh: d.scrollHeight, ih: window.innerHeight,
    };
  })()`);

/**
 * ¿HAY ALGUNA CARTA CORTADA POR EL BORDE?
 *
 * La medida que faltaba, y la que cazó el fallo de verdad. El escenario de la ceremonia es
 * `fixed` con `overflow-hidden`: si el abanico es más ancho que la pantalla, NO aparece scroll
 * —lo recorta el contenedor— y `scrollWidth` sigue diciendo que todo está bien. Lo único que
 * se ve es la primera y la última carta partidas, que es exactamente el fallo que la mesa de
 * duelo ya sufrió. Aquí se comprueba carta por carta que su rectángulo cabe ENTERO.
 */
const cartasCortadas = (tab: Tab) =>
  tab.js<{ total: number; cortadas: { i: number; left: number; right: number }[] }>(`(() => {
    const el = [...document.querySelectorAll('.aspect-\\\\[5\\\\/7\\\\]')].filter(x => x.offsetParent !== null || x.getClientRects().length);
    const r = el.map((x, i) => { const q = x.getBoundingClientRect(); return { i, left: Math.round(q.left), right: Math.round(q.right) }; });
    return { total: el.length, cortadas: r.filter(x => x.left < -0.5 || x.right > window.innerWidth + 0.5) };
  })()`);

/** Controles por debajo del objetivo táctil mínimo (44 px). */
const tactiles = (tab: Tab) =>
  tab.js<{ total: number; pequenos: { t: string; w: number; h: number }[] }>(`(() => {
    const b = [...document.querySelectorAll('button, a')].filter(x => x.offsetParent !== null);
    const r = b.map(x => {
      const q = x.getBoundingClientRect();
      return { t: ((x.getAttribute('aria-label') || x.textContent || '').trim()).slice(0, 30), w: Math.round(q.width), h: Math.round(q.height) };
    });
    return { total: b.length, pequenos: r.filter(x => x.h > 0 && x.h < 44) };
  })()`);

const VIEWPORTS: [number, number, string][] = [
  [1440, 900, "1440"],
  [1024, 768, "1024"],
  [768, 1024, "768"],
  [390, 844, "390"],
];

/**
 * Lo que la ceremonia enseña en cada acto, leído de la propia pantalla.
 *
 * OJO: `texto` recorta a 400 caracteres y sirve para IMPRIMIR, no para comprobar. La primera
 * pasada del instrumento usaba este recorte en las aserciones del resumen y daba tres falsos
 * negativos: las cifras del botín («Cartas», «Nuevas», «Repetidas») y los botones caen DESPUÉS
 * de las estadísticas de la carta grande, o sea fuera del recorte. Para comprobar, `todo`.
 */
const texto = (tab: Tab) => tab.js<string>(`document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 400)`);
const todo = (tab: Tab) => tab.js<string>(`document.body.innerText`);
/** Cuántos dorsos hay en pantalla ahora mismo. */
const dorsos = (tab: Tab) =>
  tab.js<number>(`document.querySelectorAll('.aspect-\\\\[5\\\\/7\\\\]').length`);

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor NEXUS en ${BASE} (se esperaba 401 en /api/game/state).`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  console.log(`# Apertura de sobres REAL — ${BASE} → docs/product/qa/packs/\n`);

  const email = `qa-packs-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "qapacks" },
  });
  if (cErr || !created.user) throw new Error(cErr?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  const browser = await launch({ width: 1440, height: 900 });
  const { tab } = browser;

  try {
    /* ── Créditos por la vía real: la RPC de economía, con su asiento en el libro mayor. ── */
    const { error: credErr } = await admin.rpc("app_adjust_credits", {
      p_user: userId, p_delta: 120000, p_reason: "qa:packs", p_ref: `qa:packs:${userId}`,
    });
    if (credErr) throw new Error(`no se pudieron acreditar créditos: ${credErr.message}`);

    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;

    // La ceremonia se quiere ver EN MOVIMIENTO: sin esto, headless la fotografía en reposo.
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await tab.goto(`${BASE}/`, 800);
    await tab.setStorage(storageKey, JSON.stringify(session));

    /* ═══════════════════════ 1 · LA TIENDA ═══════════════════════ */
    console.log("## 1 · La tienda");
    await tab.goto(`${BASE}/tienda`, 3000);
    /*
     * La tienda pasa por `HydrationGate` y el saldo llega con la sincronización de `CloudSync`,
     * así que su contenido NO está en el primer fotograma. La primera pasada comprobaba a los
     * 3 s y leía solo el cromo: un falso negativo del instrumento, no un fallo de la pantalla.
     */
    const tiendaLista = await esperar(tab, `/precio/i.test(document.body.innerText)`, 20000);
    check("TIENDA · la vitrina se monta", tiendaLista);
    await tab.shot(join(OUT, "01-tienda-1440.png"));
    const tTienda = await todo(tab);
    /*
     * REGEX INSENSIBLE A MAYÚSCULAS, SIEMPRE. `.nx-label` lleva `text-transform: uppercase` y
     * `innerText` DEVUELVE EL TEXTO TRANSFORMADO: la pantalla dice «PRECIO», no «Precio». La
     * primera pasada del instrumento dio tres falsos negativos por esto — y las
     * comprobaciones que sí llevaban `/i` pasaron desde el principio.
     */
    check("TIENDA · la vitrina enseña sobre, precio y saldo", /precio/i.test(tTienda) && /tu saldo/i.test(tTienda), (await texto(tab)).slice(0, 90));

    /*
     * El saldo que debe verse es el REAL del servidor, y no es el que se acredita: el perfil
     * nuevo ya trae créditos de bienvenida. Se lee de la base de datos y se busca ESE.
     */
    const { data: perfil } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
    const saldoEsperado = new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(Number(perfil?.credits ?? 0));
    const saldoVisible = await esperar(tab, `document.body.innerText.includes(${JSON.stringify(saldoEsperado)})`, 15000) ? "sí" : "no";
    check("TIENDA · el saldo real del servidor llega a la pantalla", saldoVisible === "sí", `${saldoEsperado} créditos: ${saldoVisible}`);

    /* ═══════════════════════ 2 · COMPRA REAL ═══════════════════════ */
    console.log("\n## 2 · Compra real (botón de la tienda)");
    const objetivo = getPack("premium")!;
    // Seleccionar el sobre en el carril, como lo haría un jugador.
    const seleccionado = await tab.js<boolean>(`(() => {
      const el = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes(${JSON.stringify(objetivo.name)}));
      if (!el) return false; el.click(); return true;
    })()`);
    check("TIENDA · el carril selecciona el sobre", seleccionado, objetivo.name);
    await sleep(900);
    await tab.shot(join(OUT, "02-tienda-seleccion-1440.png"));

    const antesCompra = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
    const compró = await pulsar(tab, "/^(Comprar y abrir|Abrir sobre|Conseguir y abrir)$/i");
    check("TIENDA · el botón principal compra y lleva a la apertura", compró);
    const llegó = await esperar(tab, `location.pathname.startsWith('/abrir/')`, 15000);
    check("TIENDA → APERTURA · navega a la ceremonia", llegó, await tab.js<string>("location.pathname"));

    const trasCompra = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
    const cobrado = Number(antesCompra.data?.credits ?? 0) - Number(trasCompra.data?.credits ?? 0);
    check("ECONOMÍA · el servidor cobró el precio del CATÁLOGO", cobrado === objetivo.price, `cobrado ${cobrado}, catálogo ${objetivo.price}`);
    const { data: asiento } = await admin.from("credit_transactions")
      .select("delta, reason, ref").eq("user_id", userId).like("reason", "buy_pack:%").limit(1).maybeSingle();
    check("ECONOMÍA · la compra dejó asiento en el libro mayor", !!asiento && Number(asiento.delta) === -objetivo.price,
      asiento ? `${asiento.reason} ${asiento.delta}` : "sin asiento");
    check("SEGURIDAD · el asiento lleva clave de idempotencia", !!asiento?.ref, asiento?.ref ?? "—");

    /* ═══════════════════════ 3 · LA CEREMONIA, ACTO POR ACTO ═══════════════════════ */
    console.log("\n## 3 · La ceremonia (1440)");
    await sleep(1200);
    await tab.shot(join(OUT, "03-sobre-sellado-1440.png"));
    const tSellado = await texto(tab);
    check("ACTO 2 · el sobre se presenta con su nombre y su acción", /Abrir sobre/i.test(tSellado) && new RegExp(objetivo.name, "i").test(tSellado), tSellado.slice(0, 80));

    const geoSellado = await geometria(tab);
    check("RESPONSIVE 1440 · sin desbordamiento horizontal en el sobre sellado", !geoSellado.overflowX, `${geoSellado.sw}/${geoSellado.iw}`);
    check("RESPONSIVE 1440 · sin scroll vertical en el sobre sellado", !geoSellado.scrollY, `${geoSellado.sh}/${geoSellado.ih}`);

    const abrió = await pulsar(tab, "/^Abrir sobre$/i");
    check("ACTO 3 · el botón abre el sobre", abrió);

    // El acto 4: las cartas boca abajo. Es lo que no existía antes de esta fase.
    const hayMano = await esperar(tab, `/cartas/i.test(document.body.innerText) && /Revelar/i.test(document.body.innerText)`, 20000);
    check("ACTO 4 · aparecen las cartas boca abajo", hayMano);
    await sleep(700);
    await tab.shot(join(OUT, "04-cartas-boca-abajo-1440.png"));
    const nDorsos = await dorsos(tab);
    check("ACTO 4 · hay tantos dorsos como cartas trae el sobre", nDorsos === objetivo.cardCount, `${nDorsos} dorsos, catálogo ${objetivo.cardCount}`);
    const geoMano = await geometria(tab);
    check("RESPONSIVE 1440 · el abanico no provoca scroll", !geoMano.overflowX && !geoMano.scrollY, `${geoMano.sw}/${geoMano.iw} · ${geoMano.sh}/${geoMano.ih}`);

    /* ── El revelado, una a una ── */
    await pulsar(tab, "/^Revelar$/i");
    const rarezasVistas: string[] = [];
    for (let i = 0; i < objetivo.cardCount; i++) {
      const giró = await esperar(tab, `/Toca para/i.test(document.body.innerText)`, 20000);
      if (!giró) { check(`REVEAL ${i + 1} · la carta gira`, false, "no apareció la ficha"); break; }
      const ficha = await tab.js<string>(`(() => {
        const t = document.body.innerText;
        return t.split('\\n').filter(Boolean).slice(-9).join(' | ');
      })()`);
      rarezasVistas.push(ficha);
      if (i === 0) await tab.shot(join(OUT, `05-reveal-1-1440.png`));
      if (i === objetivo.cardCount - 1) await tab.shot(join(OUT, `06-reveal-ultima-1440.png`));
      // El abanico del pie debe seguir enseñando TODAS las cartas mientras se revela una.
      const enPie = await dorsos(tab);
      if (i === 0) {
        check("REVEAL · las demás cartas siguen a la vista mientras se revela una",
          enPie >= objetivo.cardCount, `${enPie} dorsos en pantalla (abanico + carta activa)`);
        const geoRev = await geometria(tab);
        check("RESPONSIVE 1440 · el revelado no provoca scroll", !geoRev.overflowX && !geoRev.scrollY, `${geoRev.sh}/${geoRev.ih}`);
      }
      await tab.js(`document.querySelector('[aria-label="Revelar la siguiente carta"], [aria-label="Ver el resumen del sobre"]')?.click()`);
      await sleep(500);
    }
    check("REVEAL · se revelaron las cartas UNA A UNA", rarezasVistas.length === objetivo.cardCount, `${rarezasVistas.length}/${objetivo.cardCount}`);
    for (const [i, f] of rarezasVistas.entries()) info(`carta ${i + 1}`, f.slice(0, 120));

    /* ── El resumen ── */
    const hayResumen = await esperar(tab, `/Tus cartas/i.test(document.body.innerText)`, 15000);
    check("ACTO 6 · el resumen enseña el botín", hayResumen);
    await sleep(800);
    await tab.shot(join(OUT, "07-resumen-1440.png"));
    const tResumen = await todo(tab);
    check("RESUMEN · dice cuántas son, cuántas nuevas y cuántas repetidas",
      /cartas/i.test(tResumen) && /nuevas/i.test(tResumen) && /repetidas/i.test(tResumen),
      (tResumen.match(/cartas|nuevas|repetidas|valor total/gi) ?? []).join(" "));
    check("RESUMEN · ofrece el bucle y la colección",
      /abrir otro sobre|abrir mis sobres|conseguir otro sobre/i.test(tResumen) && /ver en mi colección/i.test(tResumen));

    /* ═══════════════════════ 4 · LO QUE QUEDÓ ESCRITO ═══════════════════════ */
    console.log("\n## 4 · Persistencia (la pantalla contra la base de datos)");
    const { data: cartas } = await admin.from("user_cards")
      .select("uid, card_id, serial, origin").eq("user_id", userId);
    check("PERSISTENCIA · el sobre entregó sus cartas a la colección", (cartas?.length ?? 0) === objetivo.cardCount,
      `${cartas?.length ?? 0} ejemplares en user_cards`);
    check("PERSISTENCIA · cada ejemplar lleva su origen sellado", (cartas ?? []).every((c) => c.origin === "pack"),
      [...new Set((cartas ?? []).map((c) => c.origin))].join(", "));
    const { data: sobres } = await admin.from("user_packs").select("pack_id, qty").eq("user_id", userId);
    const qty = sobres?.find((s) => s.pack_id === objetivo.id)?.qty ?? 0;
    check("PERSISTENCIA · el sobre se consumió del inventario", qty === 0, `quedan ${qty}`);

    // Seriales: solo las variantes serializadas los llevan, y dentro de su límite.
    const seriales = (cartas ?? []).map((c) => {
      const v = c.card_id.includes("__") ? getVariant(c.card_id.split("__")[1] as never) : null;
      return { card: c.card_id, serial: c.serial, serializada: v?.serialized ?? null, limite: v?.serialLimit ?? null };
    });
    const serialesOk = seriales.every((s) =>
      s.serializada === null ? true : s.serializada ? s.serial != null && (!s.limite || s.serial <= s.limite) : s.serial === null);
    check("SERIALES · coherentes con la variante (y dentro del límite)", serialesOk,
      seriales.map((s) => `${s.serial ?? "—"}`).join(" "));
    for (const s of seriales) info(s.card, `serial ${s.serial ?? "—"}${s.limite ? ` / ${s.limite}` : ""}`);

    /* ═══════════════════════ 5 · RAREZA ALTA (sobre icon, garantía real) ═══════════════════════ */
    console.log("\n## 5 · Rareza alta — sobre Icon (garantiza legendaria por catálogo)");
    const icon = getPack("icon")!;
    await admin.rpc("app_grant_pack", { p_user: userId, p_pack_id: icon.id, p_count: 1 });
    await tab.goto(`${BASE}/abrir/${icon.id}`, 3000);
    await pulsar(tab, "/^Abrir sobre$/i");
    await esperar(tab, `/Revelar/i.test(document.body.innerText)`, 20000);
    await sleep(600);
    await tab.shot(join(OUT, "08-icon-cartas-boca-abajo-1440.png"));
    await pulsar(tab, "/^Revelar$/i");
    // El heraldo y la sala oscura son la ceremonia de la parte alta de la escalera.
    const heraldo = await esperar(tab, `/Legendaria|Icónica|Cinemática|MVP|Campeón|Exclusiva/i.test(document.body.innerText)`, 6000);
    check("RAREZA · la rareza alta se ANUNCIA antes de verse (heraldo)", heraldo, heraldo ? "cantado" : "no apareció");
    await tab.shot(join(OUT, "09-icon-anticipacion-1440.png"));
    await esperar(tab, `/Toca para/i.test(document.body.innerText)`, 20000);
    await sleep(400);
    await tab.shot(join(OUT, "10-icon-reveal-1440.png"));
    const tIcon = await texto(tab);
    info("ficha de la carta Icon", tIcon.slice(0, 200));
    for (let i = 0; i < icon.cardCount; i++) {
      await esperar(tab, `/Toca para/i.test(document.body.innerText)`, 20000);
      await tab.js(`document.querySelector('[aria-label="Revelar la siguiente carta"], [aria-label="Ver el resumen del sobre"]')?.click()`);
      await sleep(400);
    }
    await esperar(tab, `/Tus cartas/i.test(document.body.innerText)`, 15000);
    await sleep(600);
    await tab.shot(join(OUT, "11-icon-resumen-1440.png"));
    const { data: cartasIcon } = await admin.from("user_cards").select("card_id").eq("user_id", userId);
    const rangos = (cartasIcon ?? [])
      .map((c) => (c.card_id.includes("__") ? getVariant(c.card_id.split("__")[1] as never)?.rank ?? 0 : 0));
    check("RAREZA · la garantía del catálogo se cumplió en el sorteo real", Math.max(...rangos) >= 12,
      `rank máximo obtenido: ${Math.max(...rangos)}`);

    /* ═══════════════════════ 6 · EL BUCLE: ABRIR OTRO SIN SALIR ═══════════════════════ */
    console.log("\n## 6 · El bucle (abrir otro sobre sin salir de la ceremonia)");
    await admin.rpc("app_grant_pack", { p_user: userId, p_pack_id: objetivo.id, p_count: 2 });
    await tab.goto(`${BASE}/abrir/${objetivo.id}`, 3000);
    await pulsar(tab, "/^Abrir sobre$/i");
    await esperar(tab, `/Revelar/i.test(document.body.innerText)`, 20000);
    await pulsar(tab, "/^Revelar$/i");
    for (let i = 0; i < objetivo.cardCount; i++) {
      await esperar(tab, `/Toca para/i.test(document.body.innerText)`, 20000);
      await tab.js(`document.querySelector('[aria-label="Revelar la siguiente carta"], [aria-label="Ver el resumen del sobre"]')?.click()`);
      await sleep(350);
    }
    await esperar(tab, `/Tus cartas/i.test(document.body.innerText)`, 15000);
    const tieneBucle = await tab.js<boolean>(`/Abrir otro sobre/i.test(document.body.innerText)`);
    check("BUCLE · con otra unidad, el botón principal es «abrir otro sobre»", tieneBucle);
    const urlAntes = await tab.js<string>("location.pathname");
    await pulsar(tab, "/Abrir otro sobre/i");
    const siguióDentro = await esperar(tab, `/Abrir sobre/i.test(document.body.innerText)`, 12000);
    const urlDespués = await tab.js<string>("location.pathname");
    check("BUCLE · abre otro SIN salir de la pantalla", siguióDentro && urlAntes === urlDespués,
      `${urlAntes} → ${urlDespués}`);
    await tab.shot(join(OUT, "12-bucle-otro-sobre-1440.png"));

    /* ═══════════════════════ 7 · RESPONSIVE EN LOS CUATRO ANCHOS ═══════════════════════ */
    console.log("\n## 7 · Responsive (390 / 768 / 1024 / 1440)");
    for (const [w, h, tag] of VIEWPORTS) {
      await admin.rpc("app_grant_pack", { p_user: userId, p_pack_id: objetivo.id, p_count: 1 });
      await tab.resize(w, h);
      await tab.goto(`${BASE}/tienda`, 2600);
      const gT = await geometria(tab);
      check(`${tag} · TIENDA sin desbordamiento horizontal`, !gT.overflowX, `${gT.sw}/${gT.iw}`);
      await tab.shot(join(OUT, `20-tienda-${tag}.png`));

      await tab.goto(`${BASE}/abrir/${objetivo.id}`, 3000);
      const gS = await geometria(tab);
      check(`${tag} · SOBRE SELLADO sin desbordamiento ni scroll`, !gS.overflowX && !gS.scrollY,
        `x ${gS.sw}/${gS.iw} · y ${gS.sh}/${gS.ih}`);
      const tac = await tactiles(tab);
      check(`${tag} · los controles del sobre llegan a 44 px`, tac.pequenos.length === 0,
        tac.pequenos.length ? tac.pequenos.map((p) => `"${p.t}" ${p.w}×${p.h}`).join(", ") : `${tac.total} controles`);
      await tab.shot(join(OUT, `21-sobre-${tag}.png`));

      await pulsar(tab, "/^Abrir sobre$/i");
      await esperar(tab, `/Revelar/i.test(document.body.innerText)`, 20000);
      await sleep(800);
      const gM = await geometria(tab);
      check(`${tag} · CARTAS BOCA ABAJO sin desbordamiento ni scroll`, !gM.overflowX && !gM.scrollY,
        `x ${gM.sw}/${gM.iw} · y ${gM.sh}/${gM.ih}`);
      const cortes = await cartasCortadas(tab);
      check(`${tag} · ninguna carta del abanico cortada por el borde`, cortes.cortadas.length === 0,
        cortes.cortadas.length
          ? cortes.cortadas.map((c) => `#${c.i} [${c.left},${c.right}]`).join(" ")
          : `${cortes.total} cartas enteras en ${w}px`);
      await tab.shot(join(OUT, `22-cartas-${tag}.png`));

      await pulsar(tab, "/^Revelar$/i");
      await esperar(tab, `/Toca para/i.test(document.body.innerText)`, 20000);
      await sleep(400);
      const gR = await geometria(tab);
      check(`${tag} · REVELADO sin desbordamiento ni scroll`, !gR.overflowX && !gR.scrollY,
        `x ${gR.sw}/${gR.iw} · y ${gR.sh}/${gR.ih}`);
      const cortesR = await cartasCortadas(tab);
      check(`${tag} · ni la carta revelada ni el abanico del pie se cortan`, cortesR.cortadas.length === 0,
        cortesR.cortadas.length
          ? cortesR.cortadas.map((c) => `#${c.i} [${c.left},${c.right}]`).join(" ")
          : `${cortesR.total} cartas enteras`);
      await tab.shot(join(OUT, `23-reveal-${tag}.png`));

      for (let i = 0; i < objetivo.cardCount; i++) {
        await esperar(tab, `/Toca para/i.test(document.body.innerText)`, 20000);
        await tab.js(`document.querySelector('[aria-label="Revelar la siguiente carta"], [aria-label="Ver el resumen del sobre"]')?.click()`);
        await sleep(320);
      }
      await esperar(tab, `/Tus cartas/i.test(document.body.innerText)`, 15000);
      await sleep(700);
      const gF = await geometria(tab);
      // El resumen es la ÚNICA pantalla de la ceremonia donde se admite scroll vertical:
      // enseña las cartas completas y en un móvil no caben de otra forma.
      check(`${tag} · RESUMEN sin desbordamiento horizontal`, !gF.overflowX, `x ${gF.sw}/${gF.iw}`);
      info(`${tag} · resumen: scroll vertical`, gF.scrollY ? `sí (${gF.sh}/${gF.ih})` : "no");
      const tacF = await tactiles(tab);
      check(`${tag} · los controles del resumen llegan a 44 px`, tacF.pequenos.length === 0,
        tacF.pequenos.length ? tacF.pequenos.map((p) => `"${p.t}" ${p.w}×${p.h}`).join(", ") : `${tacF.total} controles`);
      await tab.shot(join(OUT, `24-resumen-${tag}.png`));
    }

    /* ═══════════════════════ 8 · MOVIMIENTO REDUCIDO ═══════════════════════ */
    console.log("\n## 8 · prefers-reduced-motion: reduce");
    await admin.rpc("app_grant_pack", { p_user: userId, p_pack_id: objetivo.id, p_count: 1 });
    await tab.resize(1440, 900);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await tab.goto(`${BASE}/abrir/${objetivo.id}`, 3000);
    await pulsar(tab, "/^Abrir sobre$/i");
    const manoReducida = await esperar(tab, `/Revelar/i.test(document.body.innerText)`, 20000);
    check("REDUCED · el acto de las cartas boca abajo sigue existiendo", manoReducida);
    await tab.shot(join(OUT, "30-reduced-cartas-1440.png"));
    await pulsar(tab, "/^Revelar$/i");
    let reveladasReducidas = 0;
    for (let i = 0; i < objetivo.cardCount; i++) {
      if (!(await esperar(tab, `/Toca para/i.test(document.body.innerText)`, 20000))) break;
      reveladasReducidas++;
      if (i === 0) await tab.shot(join(OUT, "31-reduced-reveal-1440.png"));
      await tab.js(`document.querySelector('[aria-label="Revelar la siguiente carta"], [aria-label="Ver el resumen del sobre"]')?.click()`);
      await sleep(300);
    }
    check("REDUCED · no se pierde NINGÚN revelado", reveladasReducidas === objetivo.cardCount,
      `${reveladasReducidas}/${objetivo.cardCount}`);
    const finReducido = await esperar(tab, `/Tus cartas/i.test(document.body.innerText)`, 15000);
    check("REDUCED · la ceremonia llega al resumen", finReducido);
    await tab.shot(join(OUT, "32-reduced-resumen-1440.png"));

    /* ═══════════════════════ 9 · ARTWORK Y ERRORES ═══════════════════════ */
    console.log("\n## 9 · Artwork y consola");
    const { count: assetsCount } = await admin.from("assets").select("id", { count: "exact", head: true });
    info("artwork manual en la base de datos", `${assetsCount ?? 0} filas en assets`);
    const imgs = await tab.js<number>(`document.querySelectorAll('img[alt^="Carta de"]').length`);
    const rotas = await tab.js<number>(`[...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length`);
    info("cartas con artwork pintado en el resumen", String(imgs));
    check("ARTWORK · ninguna imagen rota (el fallback por capas cubre lo que no tiene fichero)", rotas === 0, `${rotas} roto(s)`);

    const errores = tab.takeErrors().filter((e) => !/favicon|manifest|404 \(Not Found\)/i.test(e));
    check("CONSOLA · la ceremonia no deja errores", errores.length === 0, errores.slice(0, 3).join(" | ") || "limpia");
    check("ESTABILIDAD · sin bucle de recargas", tab.loadCount() < 60, `${tab.loadCount()} cargas`);

    /* ═══════════════════════ 10 · COLECCIÓN E INVENTARIO ═══════════════════════ */
    console.log("\n## 10 · La colección y el inventario, después");
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await tab.goto(`${BASE}/coleccion`, 3500);
    const { count: totalCartas } = await admin.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", userId);
    /*
     * La colección NO dibuja con `CardVisual`: usa su propia rejilla (`AlbumGrid`/`CardThumb`),
     * así que buscar `aria-label="Carta de…"` daba cero aunque la pantalla estuviera llena.
     * Lo que sí comparten todas las cartas del producto es el marco en proporción 5:7.
     */
    const enPantalla = await tab.js<number>(`document.querySelectorAll('[data-card-frame], .aspect-\\\\[5\\\\/7\\\\]').length`);
    const copias = await tab.js<string>(`(document.body.innerText.match(/(\\d+)\\s+copias en posesi/i) ?? [])[1] ?? '0'`);
    info("ejemplares en la base de datos", String(totalCartas ?? 0));
    info("cartas pintadas en /coleccion", String(enPantalla));
    check("COLECCIÓN · la pantalla carga con las cartas obtenidas", (totalCartas ?? 0) > 0 && enPantalla > 0);
    check("COLECCIÓN · el recuento de la pantalla cuadra con la base de datos",
      Number(copias) === (totalCartas ?? -1), `pantalla ${copias} · base de datos ${totalCartas}`);
    await tab.shot(join(OUT, "40-coleccion-1440.png"));
    await tab.goto(`${BASE}/inventario`, 3000);
    await tab.shot(join(OUT, "41-inventario-1440.png"));

    console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} comprobaciones`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    // Limpieza: el usuario y todo lo que cuelga de él.
    await admin.from("user_cards").delete().eq("user_id", userId);
    await admin.from("user_packs").delete().eq("user_id", userId);
    await admin.from("credit_transactions").delete().eq("user_id", userId);
    await admin.from("economy_ops").delete().eq("user_id", userId);
    await admin.from("user_game").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((e: unknown) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
