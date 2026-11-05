/**
 * INSTRUMENTO DE MEDIDA — CATÁLOGO DE PACKS Y ARTWORK (Fase 20).
 *
 *   npx next dev -p 3005                              (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_fase20-qa.ts
 *
 * Prefijado con `_` y FUERA de CI: es el instrumento de una fase, no un gate permanente.
 *
 * ══════════════════════════ QUÉ MIDE ══════════════════════════
 *
 * La Fase 19 ya verificó la MECÁNICA de la apertura (74/74) y esta fase no la reabre. Aquí se
 * mide lo que la Fase 20 añade:
 *
 *   · el CATÁLOGO: que los dieciséis sobres estén en la tienda, agrupados por familia;
 *   · la IDENTIDAD: que cada producto se distinga (familia, símbolo, escudo del equipo) y que
 *     dos sobres no sean el mismo objeto de otro color;
 *   · el TEAM PACK: que la tienda diga cuántas cartas del equipo hay y que NO están
 *     garantizadas, y que abrirlo funcione de verdad;
 *   · el ARTWORK: que sin ficheros entregados no se pida ni una imagen (cero 404) y el sobre
 *     se dibuje;
 *   · que la apertura de la Fase 19 y su bucle SIGAN funcionando con un sobre nuevo;
 *   · responsive a 390/768/1024/1440.
 *
 * Abre sobres DE VERDAD: usuario real, créditos por la RPC de economía, compra pulsando el
 * botón y apertura pulsando el botón. Sin mocks. Limpia el usuario al terminar.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { PACKS, getPack } from "@/data/packs";
import { packIdentity } from "@/components/packs/packIdentity";
import { PACK_ART_AVAILABLE } from "@/data/packArtwork";

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
if (!URL_ || !ANON || !SERVICE) { console.error("Faltan credenciales de Supabase en .env.local"); process.exit(1); }

const OUT = join(ROOT, "docs", "product", "qa", "packs-catalogo");
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): boolean => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
  return cond;
};
const info = (label: string, detail = "") => console.log(`  · ${label}${detail ? ` — ${detail}` : ""}`);

/* Las regex sobre texto de pantalla van SIEMPRE con `/i`: `.nx-label` aplica
   `text-transform: uppercase` e `innerText` devuelve el texto ya transformado. */
async function esperar(tab: Tab, expr: string, timeout = 20000, step = 200): Promise<boolean> {
  const fin = Date.now() + timeout;
  while (Date.now() < fin) {
    if (await tab.js<boolean>(`!!(${expr})`)) return true;
    await sleep(step);
  }
  return false;
}
async function pulsar(tab: Tab, patron: string): Promise<boolean> {
  return tab.js<boolean>(`(() => {
    const re = ${patron};
    const el = [...document.querySelectorAll('button, a')]
      .filter(x => x.offsetParent !== null && !x.disabled)
      .find(x => re.test((x.textContent || '').trim()));
    if (!el) return false; el.click(); return true;
  })()`);
}
const todo = (tab: Tab) => tab.js<string>("document.body.innerText");

interface Geo { overflowX: boolean; scrollY: boolean; sw: number; iw: number; sh: number; ih: number }
const geometria = (tab: Tab) => tab.js<Geo>(`(() => { const d = document.documentElement; return {
  overflowX: d.scrollWidth > window.innerWidth + 1, scrollY: d.scrollHeight > window.innerHeight + 1,
  sw: d.scrollWidth, iw: window.innerWidth, sh: d.scrollHeight, ih: window.innerHeight }; })()`);

/**
 * RECURSOS QUE HAN FALLADO EN ESTA PÁGINA, CON SU URL.
 *
 * El mensaje de consola de un 404 («Failed to load resource…») no dice QUÉ recurso, así que un
 * contador de errores no distingue un fallo de esta fase de uno que ya venía. `responseStatus`
 * de la Resource Timing API sí da la URL y el código, y es la diferencia entre «hay 404» y
 * «hay 404 DE ESTO».
 */
const fallidos = (tab: Tab) => tab.js<string[]>(`(() => {
  try {
    return performance.getEntriesByType('resource')
      .filter(r => typeof r.responseStatus === 'number' && r.responseStatus >= 400)
      .map(r => r.responseStatus + ' ' + new URL(r.name).pathname);
  } catch { return []; }
})()`);

/** Imágenes pedidas y roturas. Con el manifiesto vacío no debe haber ni una de sobre. */
const imagenes = (tab: Tab) => tab.js<{ packImgs: number; rotas: number }>(`(() => {
  const imgs = [...document.querySelectorAll('img')];
  return {
    packImgs: imgs.filter(i => (i.getAttribute('src') || '').includes('/packs/')).length,
    rotas: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
  };
})()`);

/** Selecciona un sobre en el carril por su nombre exacto. */
const seleccionar = (tab: Tab, name: string) => tab.js<boolean>(`(() => {
  const el = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes(${JSON.stringify(name)}));
  if (!el) return false; el.click(); return true;
})()`);

/** Abre un sobre completo desde /abrir/<id> y devuelve cuántas cartas se revelaron. */
async function abrirCompleto(tab: Tab, packId: string, cardCount: number): Promise<number> {
  await tab.goto(`${BASE}/abrir/${packId}`, 2600);
  if (!(await pulsar(tab, "/^Abrir sobre$/i"))) return -1;
  if (!(await esperar(tab, `/revelar/i.test(document.body.innerText)`))) return -2;
  await pulsar(tab, "/^Revelar$/i");
  let n = 0;
  for (let i = 0; i < cardCount; i++) {
    if (!(await esperar(tab, `/toca para/i.test(document.body.innerText)`))) break;
    n++;
    await tab.js(`document.querySelector('[aria-label="Revelar la siguiente carta"], [aria-label="Ver el resumen del sobre"]')?.click()`);
    await sleep(340);
  }
  await esperar(tab, `/tus cartas/i.test(document.body.innerText)`);
  return n;
}

const VIEWPORTS: [number, number, string][] = [[1440, 900, "1440"], [1024, 768, "1024"], [768, 1024, "768"], [390, 844, "390"]];

/** Los productos que el §19 del encargo exige probar de verdad. */
const OBJETIVO = ["inicial", "estandar", "champions", "team-fnatic"];

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) { console.error(`❌ No hay servidor NEXUS en ${BASE}.`); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  console.log(`# Catálogo de packs y artwork — ${BASE} → docs/product/qa/packs-catalogo/\n`);

  const email = `qa-cat-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "qacat" },
  });
  if (cErr || !created.user) throw new Error(cErr?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  const browser = await launch({ width: 1440, height: 900 });
  const { tab } = browser;

  try {
    const { error: credErr } = await admin.rpc("app_adjust_credits", {
      p_user: userId, p_delta: 200000, p_reason: "qa:fase20", p_ref: `qa:fase20:${userId}`,
    });
    if (credErr) throw new Error(`créditos: ${credErr.message}`);

    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;

    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await tab.goto(`${BASE}/`, 800);
    await tab.setStorage(storageKey, JSON.stringify(session));

    /* ═══════════════════ 1 · EL CATÁLOGO EN LA TIENDA ═══════════════════ */
    console.log("## 1 · El catálogo en la tienda");
    await tab.goto(`${BASE}/tienda`, 3000);
    await esperar(tab, `/precio/i.test(document.body.innerText)`);
    await tab.shot(join(OUT, "01-tienda-catalogo-1440.png"));
    const tTienda = await todo(tab);

    const vendibles = PACKS.filter((p) => !p.eventId && !p.retired);
    const ausentes = vendibles.filter((p) => !tTienda.toLowerCase().includes(p.name.toLowerCase()));
    check("CATÁLOGO · todos los sobres vendibles están en la tienda", ausentes.length === 0,
      ausentes.length ? ausentes.map((p) => p.id).join(", ") : `${vendibles.length} sobres`);

    const deEvento = PACKS.filter((p) => p.eventId && !p.retired);
    const eventosVisibles = deEvento.filter((p) => tTienda.toLowerCase().includes(p.name.toLowerCase()));
    check("CATÁLOGO · los sobres de evento se enseñan en su banda", eventosVisibles.length === deEvento.length,
      `${eventosVisibles.length}/${deEvento.length}`);

    check("CATÁLOGO · el sobre retirado NO se vende", !/sobre prime/i.test(tTienda),
      "prime sigue en el catálogo y fuera del escaparate");

    // Las familias, agrupadas en el carril.
    const familias = [...new Set(vendibles.map((p) => packIdentity(p).categoryLabel))];
    const familiasVisibles = familias.filter((f) => new RegExp(f, "i").test(tTienda));
    check("CATÁLOGO · el carril agrupa por familia", familiasVisibles.length === familias.length,
      familiasVisibles.join(" · "));

    /* ═══════════════════ 2 · ARTWORK: EL HUECO, SIN 404 ═══════════════════ */
    console.log("\n## 2 · Artwork de sobre");
    info("manifiesto de artwork entregado", `${PACK_ART_AVAILABLE.size} de ${PACKS.length} sobres`);
    const img = await imagenes(tab);
    /*
     * FASE 20.1 · EL CONTRATO SE HA INVERTIDO, Y ES LA BUENA NOTICIA.
     *
     * En la Fase 20 esta comprobación exigía CERO peticiones a `/packs/`: el manifiesto estaba
     * vacío y pedir imágenes inexistentes habría sido un 404 por sobre. Ahora los dieciséis
     * productos tienen su fichero, así que lo que se exige es lo contrario — que la tienda los
     * pida de verdad y que ninguno falle.
     */
    check("ARTWORK · la tienda pinta el artwork real de los sobres", img.packImgs > 0,
      `${img.packImgs} imágenes de sobre servidas`);
    check("ARTWORK · ninguna imagen rota en la tienda", img.rotas === 0, `${img.rotas} roto(s)`);
    /*
     * Los 404 se miden POR URL, no contando errores de consola.
     *
     * La tienda dibuja dieciséis sobres y, dentro de la ceremonia, cartas con escudo de equipo
     * y foto de jugador. `public/teams/` y `public/players/` solo tienen un README —los assets
     * nunca se subieron— así que CADA logo y CADA foto devuelven 404 desde antes de esta fase;
     * el dibujado por capas los cubre con monograma y silueta, que es su diseño.
     *
     * Mezclar esos 404 preexistentes con los de esta fase habría hecho imposible comprobar lo
     * único que aquí se promete: que el artwork de SOBRE no pide nada que no exista.
     */
    const fallosTienda = await fallidos(tab);
    const dePacks = fallosTienda.filter((f) => f.includes("/packs/"));
    check("ARTWORK · ni un 404 de artwork de sobre", dePacks.length === 0,
      dePacks.join(", ") || "0 peticiones fallidas a /packs/");
    const preexistentes = fallosTienda.filter((f) => /\/teams\/|\/players\//.test(f));
    info("404 PREEXISTENTES (no de esta fase)", preexistentes.length
      ? `${preexistentes.length} · logos de equipo y fotos de jugador sin subir (fallback por capas)`
      : "ninguno");
    const erroresTienda = tab.takeErrors()
      .filter((e) => !/favicon|manifest/i.test(e))
      .filter((e) => !/404 \(Not Found\)|Failed to load resource/i.test(e));
    check("ARTWORK · la tienda no deja errores de JavaScript", erroresTienda.length === 0,
      erroresTienda.slice(0, 2).join(" | ") || "limpia");

    /* ═══════════════════ 3 · IDENTIDAD POR PRODUCTO ═══════════════════ */
    console.log("\n## 3 · Identidad de cada producto");
    for (const id of OBJETIVO) {
      const pack = getPack(id)!;
      const ident = packIdentity(pack);
      await tab.goto(`${BASE}/tienda`, 2600);
      await esperar(tab, `/precio/i.test(document.body.innerText)`);
      const sel = await seleccionar(tab, pack.name);
      if (!sel && pack.eventId) {
        // Los de evento no están en el carril: viven en su banda con salida al evento.
        info(`${id}`, "sobre de evento: no se selecciona en el carril");
      }
      await sleep(900);
      const t = await todo(tab);
      if (sel) {
        check(`IDENTIDAD · ${id} · la vitrina lo enseña con su familia «${ident.categoryLabel}»`,
          new RegExp(ident.categoryLabel, "i").test(t) && t.toLowerCase().includes(pack.name.toLowerCase()));
        check(`IDENTIDAD · ${id} · precio y saldo se leen juntos`,
          /precio/i.test(t) && /tu saldo/i.test(t));
        await tab.shot(join(OUT, `10-vitrina-${id}-1440.png`));
      }
    }

    /* ═══════════════════ 4 · EL TEAM PACK, LO QUE PROMETE Y LO QUE NO ═══════════════════ */
    console.log("\n## 4 · Sobre de equipo (Fnatic)");
    const fnatic = getPack("team-fnatic")!;
    await tab.goto(`${BASE}/tienda`, 2600);
    await esperar(tab, `/precio/i.test(document.body.innerText)`);
    await seleccionar(tab, fnatic.name);
    await sleep(1000);
    await tab.shot(join(OUT, "20-vitrina-team-fnatic-1440.png"));
    const tFnatic = await todo(tab);

    check("EQUIPO · la vitrina dice cuántas cartas del equipo pueden salir", /\d+\s*cartas de/i.test(tFnatic),
      (tFnatic.match(/\d+\s*cartas de\s*\S+/i) ?? ["—"])[0]);
    check("EQUIPO · dice que son MÁS PROBABLES", /más probables/i.test(tFnatic));
    check("EQUIPO · dice que NO están garantizadas", /no están garantizadas/i.test(tFnatic),
      "es la mitad de la frase que el §11 exige");
    /*
     * El monograma ya no está en el HTML: con el artwork entregado, las siglas van COMPUESTAS
     * dentro del fichero (el troquel se rasteriza con ellas). Lo que se comprueba aquí es que
     * el sobre de equipo pinta SU asset; que el troquel lleva las siglas reales lo fija
     * `packs.test.tsx` sobre el camino dibujado, donde sí es marcado inspeccionable.
     */
    check("EQUIPO · la vitrina pinta el artwork del sobre de equipo",
      await tab.js<boolean>(`!!document.querySelector('img[src="/packs/pack-team-fnatic.webp"]')`),
      `monograma compuesto en el asset: ${packIdentity(fnatic).monogram}`);

    /* ═══════════════════ 5 · APERTURA REAL DE CADA PRODUCTO ═══════════════════ */
    console.log("\n## 5 · Apertura real");
    for (const id of OBJETIVO) {
      const pack = getPack(id)!;
      await admin.rpc("app_grant_pack", { p_user: userId, p_pack_id: id, p_count: 1 });
      const reveladas = await abrirCompleto(tab, id, pack.cardCount);
      check(`APERTURA · ${id} · se revelan sus ${pack.cardCount} cartas`, reveladas === pack.cardCount,
        reveladas < 0 ? `falló en el paso ${reveladas}` : `${reveladas}/${pack.cardCount}`);
      const tFin = await todo(tab);
      check(`APERTURA · ${id} · el resumen enseña el botín`, /tus cartas/i.test(tFin));
      await tab.shot(join(OUT, `30-apertura-${id}-1440.png`));
    }

    /* El sesgo de equipo, comprobado contra la base de datos tras varias aperturas reales. */
    console.log("\n## 6 · El sesgo de equipo, en aperturas reales");
    await admin.from("user_cards").delete().eq("user_id", userId);
    const VECES = 8;
    await admin.rpc("app_grant_pack", { p_user: userId, p_pack_id: "team-fnatic", p_count: VECES });
    for (let i = 0; i < VECES; i++) await abrirCompleto(tab, "team-fnatic", fnatic.cardCount);
    const { data: obtenidas } = await admin.from("user_cards").select("card_id").eq("user_id", userId);
    const { data: jugadoresFnatic } = await admin.from("content_players").select("id").eq("team", "Fnatic");
    const idsFnatic = new Set(((jugadoresFnatic ?? []) as { id: string }[]).map((r) => r.id));
    const filas = (obtenidas ?? []) as { card_id: string }[];
    const suyas = filas.filter((r) => idsFnatic.has(r.card_id.split("__")[0])).length;
    const cuota = filas.length > 0 ? suyas / filas.length : 0;
    info(`${VECES} sobres abiertos`, `${filas.length} cartas · ${suyas} de Fnatic (${(cuota * 100).toFixed(0)} %)`);
    /*
     * Sin sesgo, Fnatic es el 24,6 % del pool EMEA medido (`content-pools:verify`). Con el pool
     * puesto sube al 43,2 %. Ocho sobres son 40 cartas: se exige superar el 24,6 % con margen,
     * no acertar el 43,2 % —con esa muestra, exigir la cifra exacta sería un test que falla por
     * azar—. La comprobación estadística fina vive en `content-pools:verify`, con 1.500 sobres.
     */
    check("EQUIPO · las aperturas reales se sesgan hacia el equipo", cuota > 0.28,
      `cuota real ${(cuota * 100).toFixed(0)} % · sin sesgo sería ~25 %`);
    check("EQUIPO · y NO es una garantía: entran cartas de otros equipos", suyas < filas.length,
      `${filas.length - suyas} cartas de otros equipos`);

    /* ═══════════════════ 7 · EL BUCLE MANTIENE EL CONTEXTO ═══════════════════ */
    console.log("\n## 7 · «Abrir otro sobre» mantiene el sobre");
    await admin.rpc("app_grant_pack", { p_user: userId, p_pack_id: "team-fnatic", p_count: 2 });
    await abrirCompleto(tab, "team-fnatic", fnatic.cardCount);
    const urlAntes = await tab.js<string>("location.pathname");
    const hayBucle = await pulsar(tab, "/abrir otro sobre/i");
    await esperar(tab, `/abrir sobre/i.test(document.body.innerText)`, 12000);
    const urlDespues = await tab.js<string>("location.pathname");
    const tBucle = await todo(tab);
    check("BUCLE · el botón «abrir otro sobre» existe con otra unidad", hayBucle);
    check("BUCLE · sigue en el MISMO sobre (Fase 16 del encargo)",
      urlAntes === urlDespues && urlDespues.includes("team-fnatic"),
      `${urlAntes} → ${urlDespues}`);
    check("BUCLE · y la escena vuelve a enseñar ESE producto", /sobre fnatic/i.test(tBucle),
      (tBucle.match(/sobre \w+/i) ?? ["—"])[0]);
    await tab.shot(join(OUT, "40-bucle-team-fnatic-1440.png"));

    /* ═══════════════════ 8 · RESPONSIVE ═══════════════════ */
    console.log("\n## 8 · Responsive (390 / 768 / 1024 / 1440)");
    for (const [w, h, tag] of VIEWPORTS) {
      await tab.resize(w, h);
      await tab.goto(`${BASE}/tienda`, 2800);
      await esperar(tab, `/precio/i.test(document.body.innerText)`);
      const gT = await geometria(tab);
      check(`${tag} · TIENDA sin desbordamiento horizontal`, !gT.overflowX, `${gT.sw}/${gT.iw}`);
      await tab.shot(join(OUT, `50-tienda-${tag}.png`));

      // Con el sobre de equipo seleccionado: es el que más texto añade a la vitrina.
      await seleccionar(tab, fnatic.name);
      await sleep(900);
      const gS = await geometria(tab);
      check(`${tag} · VITRINA del sobre de equipo sin desbordamiento`, !gS.overflowX, `${gS.sw}/${gS.iw}`);
      const tac = await tab.js<{ n: number; ej: string[] }>(`(() => {
        const b = [...document.querySelectorAll('button, a')].filter(x => x.offsetParent !== null);
        const ch = b.filter(x => { const r = x.getBoundingClientRect(); return r.height > 0 && r.height < 44; });
        return { n: ch.length, ej: ch.slice(0, 4).map(x => ((x.getAttribute('aria-label') || x.textContent || '').trim()).slice(0, 24)) };
      })()`);
      /*
       * El carril de la tienda son filas de selección de 40 px de alto por diseño (una lista
       * densa de dieciséis productos), no acciones: se informa sin exigir 44 px, que es el
       * suelo de los CTA. Los CTA de la vitrina sí se miden abajo.
       */
      info(`${tag} · controles por debajo de 44 px`, tac.n ? `${tac.n} (${tac.ej.join(", ")})` : "ninguno");
      const ctas = await tab.js<{ n: number; bajos: number }>(`(() => {
        const b = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null
          && /^(comprar y abrir|abrir sobre|conseguir y abrir|comprar sin abrir)$/i.test((x.textContent||'').trim()));
        return { n: b.length, bajos: b.filter(x => x.getBoundingClientRect().height < 44).length };
      })()`);
      check(`${tag} · los CTA de la vitrina llegan a 44 px`, ctas.bajos === 0, `${ctas.n} CTA, ${ctas.bajos} bajos`);
      await tab.shot(join(OUT, `51-vitrina-team-${tag}.png`));

      // Y la apertura del sobre nuevo, en este ancho.
      await admin.rpc("app_grant_pack", { p_user: userId, p_pack_id: "team-fnatic", p_count: 1 });
      await tab.goto(`${BASE}/abrir/team-fnatic`, 2600);
      const gA = await geometria(tab);
      check(`${tag} · APERTURA del sobre de equipo sin desbordamiento ni scroll`,
        !gA.overflowX && !gA.scrollY, `x ${gA.sw}/${gA.iw} · y ${gA.sh}/${gA.ih}`);
      await tab.shot(join(OUT, `52-apertura-team-${tag}.png`));
    }

    /*
     * El recorrido entero, otra vez por URL: lo que esta fase no puede tolerar es un 404 de
     * `/packs/`. Los de `/teams/` y `/players/` son la deuda de assets que ya existía.
     */
    const fallosFinales = await fallidos(tab);
    check("ARTWORK · ni un 404 de sobre en la apertura tampoco",
      fallosFinales.filter((f) => f.includes("/packs/")).length === 0,
      fallosFinales.filter((f) => f.includes("/packs/")).join(", ") || "limpio");
    const erroresFinales = tab.takeErrors()
      .filter((e) => !/favicon|manifest/i.test(e))
      .filter((e) => !/404 \(Not Found\)|Failed to load resource/i.test(e));
    check("CONSOLA · sin errores de JavaScript en todo el recorrido", erroresFinales.length === 0,
      erroresFinales.slice(0, 3).join(" | ") || "limpia");

    console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} comprobaciones`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    await browser.close();
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
